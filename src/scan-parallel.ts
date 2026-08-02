// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { GcpProject, ParsedApiKey } from './types';
import { fetchProjectApiKeys, ServiceDisabledError, AppError } from './api';
import { parseApiKey, logDebug, delay, runConcurrentTasks } from './utils';

// Concurrency constants
const BATCH_SIZE = 12;
const CONCURRENCY = 4;
const STAGGER_MS = 30; // 30ms stagger between concurrent task starts
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 100;

/**
 * Checks if a parsed error represents a transient issue (rate-limiting or backend collisions)
 * that is safe to retry.
 */
function isTransientError(err: any): boolean {
  if (err instanceof ServiceDisabledError) {
    return false; // Permanent service disabled
  }

  // If we have an AppError, check statuses and reasons
  if (err instanceof AppError) {
    const status = err.status;

    // Standard HTTP 429 or 5xx is always transient
    if (status === 429 || (status && status >= 500)) {
      return true;
    }

    // Check Google-specific structured error reasons
    const msg = err.message || '';
    if (
      msg.includes('RATE_LIMIT_EXCEEDED') ||
      msg.includes('USER_RATE_LIMIT_EXCEEDED') ||
      msg.includes('QUOTA_EXCEEDED') ||
      msg.includes('RESOURCE_EXHAUSTED')
    ) {
      return true;
    }
  }

  // Check generic DOM or Network Exceptions
  const name = err.name || '';
  if (name === 'TypeError' && err.message?.includes('Failed to fetch')) {
    return true; // Transient network drops
  }

  return false;
}

/**
 * Executes a high-performance parallel scan with queue worker staggers,
 * transient-error retries, and dynamic backlog sweeping.
 */
export async function executeParallelScan(
  projects: GcpProject[],
  signal: AbortSignal,
  onProgress: (index: number, projectId: string) => void,
  onResult: (keys: ParsedApiKey[], projectId: string) => void,
  onError: (err: any, projectId: string) => void
): Promise<{ quotaProject: string | null }> {
  let quotaProjectId: string | null = null;
  const backlogProjects: string[] = [];
  let completedCount = 0;

  logDebug(`Starting parallel scan of ${projects.length} projects with concurrency of ${CONCURRENCY} and staggers of ${STAGGER_MS}ms.`);

  // Process projects in batches of 12
  for (let batchStart = 0; batchStart < projects.length; batchStart += BATCH_SIZE) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const batch = projects.slice(batchStart, batchStart + BATCH_SIZE);
    const serviceDisabledToRetry: string[] = [];
    let workerIndex = 0;

    logDebug(`[Parallel Scan] Starting Batch [${batchStart} to ${batchStart + batch.length}]`);

    // A. DIRECT SCAN PASS
    await runConcurrentTasks(batch, CONCURRENCY, async (project) => {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Microscopic stagger spacing between starting concurrent requests
      const staggerIndex = workerIndex++;
      if (staggerIndex > 0) {
        await delay(staggerIndex * STAGGER_MS);
      }

      const projectId = project.projectId;
      let attempt = 0;
      let success = false;

      while (attempt <= MAX_RETRIES && !success) {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        try {
          logDebug(`[Parallel Scan] [Direct] Scanning project ${projectId} (Attempt ${attempt + 1})`);
          const keys = await fetchProjectApiKeys(projectId, signal);

          // SUCCESS! Update quotaProjectId anchor if scanning directly
          quotaProjectId = projectId;
          logDebug(`[Parallel Scan] [Direct] SUCCESS on project: ${projectId}. Established quotaProjectId: ${quotaProjectId}`);

          const parsedKeys = keys.map(k => parseApiKey(k, projectId));
          onResult(parsedKeys, projectId);
          success = true;
        } catch (err: any) {
          if (err.name === 'AbortError') {
            throw err;
          }

          if (err instanceof ServiceDisabledError) {
            // Service is disabled. No amount of retrying direct will help.
            logDebug(`[Parallel Scan] [Direct] SERVICE_DISABLED on project: ${projectId}. Skipping retries.`);
            serviceDisabledToRetry.push(projectId);
            success = true; // Break loop
          } else if (isTransientError(err)) {
            attempt++;
            if (attempt <= MAX_RETRIES) {
              const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
              logDebug(`[Parallel Scan] [Direct] Transient error on project ${projectId}: ${err.message}. Retrying in ${backoff}ms...`);
              await delay(backoff);
            } else {
              logDebug(`[Parallel Scan] [Direct] Permanent failure on project ${projectId} after ${MAX_RETRIES + 1} attempts.`);
              onError(err, projectId);
            }
          } else {
            // GFE Backend Collision Detection (403 without details block)
            const isBackendCollision =
              err instanceof AppError &&
              err.status === 403 &&
              (!err.message || !err.message.includes('permission') && !err.message.includes('denied'));

            if (isBackendCollision) {
              attempt++;
              if (attempt <= MAX_RETRIES) {
                const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
                console.warn(`[BACKEND_COLLISION] Suspected concurrent token lock on project ${projectId}. Retrying with jitter in ${backoff}ms...`);
                await delay(backoff + Math.random() * 50); // Added jitter
              } else {
                console.error(`[BACKEND_COLLISION] Failed to resolve collision on project ${projectId} after maximum retries.`);
                onError(err, projectId);
              }
            } else {
              // True Permanent IAM Deny
              logDebug(`[Parallel Scan] [Direct] Permanent error on project ${projectId}: ${err.message}`);
              onError(err, projectId);
              success = true; // Break loop
            }
          }
        }
      }

      completedCount++;
      onProgress(completedCount, projectId);
    });

    // B. INTRA-BATCH RETRY PASS
    if (serviceDisabledToRetry.length > 0) {
      if (quotaProjectId) {
        const currentQuota = quotaProjectId;
        logDebug(`[Parallel Scan] [Intra-Batch Retry] Retrying ${serviceDisabledToRetry.length} service-disabled projects using anchor: ${currentQuota}`);
        
        let retryWorkerIndex = 0;
        await runConcurrentTasks(serviceDisabledToRetry, CONCURRENCY, async (projectId) => {
          if (signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }

          const retryStaggerIndex = retryWorkerIndex++;
          if (retryStaggerIndex > 0) {
            await delay(retryStaggerIndex * STAGGER_MS);
          }

          let attempt = 0;
          let success = false;

          while (attempt <= MAX_RETRIES && !success) {
            if (signal.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }

            try {
              logDebug(`[Parallel Scan] [Intra-Batch Retry] Scanning ${projectId} borrowing quota from ${currentQuota} (Attempt ${attempt + 1})`);
              const keys = await fetchProjectApiKeys(projectId, signal, currentQuota);
              logDebug(`[Parallel Scan] [Intra-Batch Retry] SUCCESS on project: ${projectId}`);
              
              const parsedKeys = keys.map(k => parseApiKey(k, projectId));
              onResult(parsedKeys, projectId);
              success = true;
            } catch (err: any) {
              if (err.name === 'AbortError') {
                throw err;
              }

              if (isTransientError(err)) {
                attempt++;
                if (attempt <= MAX_RETRIES) {
                  const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
                  await delay(backoff);
                } else {
                  onError(err, projectId);
                }
              } else {
                onError(err, projectId);
                success = true; // Permanent
              }
            }
          }
        });
      } else {
        // No quota project found in this batch. Defer all disabled projects to global backlog.
        logDebug(`[Parallel Scan] [Intra-Batch] No quotaProjectId established yet. Deferring ${serviceDisabledToRetry.length} projects to global backlog.`);
        backlogProjects.push(...serviceDisabledToRetry);
      }
    }
  }

  // C. POST-SCAN GLOBAL BACKLOG SWEEP
  if (backlogProjects.length > 0) {
    if (quotaProjectId) {
      const currentQuota = quotaProjectId;
      logDebug(`[Parallel Scan] Starting post-scan global backlog sweep of ${backlogProjects.length} projects borrowing quota from: ${currentQuota}`);

      let backlogWorkerIndex = 0;
      await runConcurrentTasks(backlogProjects, CONCURRENCY, async (projectId) => {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const backlogStaggerIndex = backlogWorkerIndex++;
        if (backlogStaggerIndex > 0) {
          await delay(backlogStaggerIndex * STAGGER_MS);
        }

        let attempt = 0;
        let success = false;

        while (attempt <= MAX_RETRIES && !success) {
          if (signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }

          try {
            logDebug(`[Parallel Scan] [Backlog Sweep] Scanning ${projectId} borrowing quota from ${currentQuota} (Attempt ${attempt + 1})`);
            const keys = await fetchProjectApiKeys(projectId, signal, currentQuota);
            logDebug(`[Parallel Scan] [Backlog Sweep] SUCCESS on project: ${projectId}`);

            const parsedKeys = keys.map(k => parseApiKey(k, projectId));
            onResult(parsedKeys, projectId);
            success = true;
          } catch (err: any) {
            if (err.name === 'AbortError') {
              throw err;
            }

            if (isTransientError(err)) {
              attempt++;
              if (attempt <= MAX_RETRIES) {
                const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
                await delay(backoff);
              } else {
                onError(err, projectId);
              }
            } else {
              onError(err, projectId);
              success = true; // Permanent
            }
          }
        }
      });
    } else {
      logDebug(`[Parallel Scan] Finished scan, but no active quota project was established to scan backlog of ${backlogProjects.length} projects.`);
      const backlogError = new Error('API Keys service is disabled in all scanned projects and no other project has it enabled to borrow quota.');
      for (const projectId of backlogProjects) {
        onError(backlogError, projectId);
      }
    }
  }

  return { quotaProject: quotaProjectId };
}

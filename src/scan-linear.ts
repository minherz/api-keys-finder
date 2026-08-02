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
import { fetchProjectApiKeys, ServiceDisabledError } from './api';
import { parseApiKey, logDebug } from './utils';

/**
 * Executes a pure sequential, race-free scan of all projects.
 * Guaranteed to run in low-latency conditions when project counts are < 64.
 *
 * @returns The established quotaProjectId anchor (if any working project is found)
 */
export async function executeLinearScan(
  projects: GcpProject[],
  signal: AbortSignal,
  onProgress: (index: number, projectId: string) => void,
  onResult: (keys: ParsedApiKey[], projectId: string) => void,
  onError: (err: any, projectId: string) => void
): Promise<{ quotaProject: string | null }> {
  let quotaProjectId: string | null = null;
  const serviceDisabledBacklog: string[] = [];

  logDebug(`Starting linear scan of ${projects.length} project(s).`);

  // Pass 1: Direct sequential scan
  for (let i = 0; i < projects.length; i++) {
    const projectId = projects[i].projectId;
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    onProgress(i + 1, projectId);
    logDebug(`[Linear Scan] [Direct] Fetching keys for: ${projectId}`);

    try {
      const keys = await fetchProjectApiKeys(projectId, signal);

      // Since this scan succeeded direct, establish it as our quota anchor!
      quotaProjectId = projectId;
      logDebug(`[Linear Scan] [Direct] SUCCESS on project: ${projectId}. Established quotaProjectId: ${quotaProjectId}`);

      const parsedKeys = keys.map(k => parseApiKey(k, projectId));
      onResult(parsedKeys, projectId);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw err;
      }

      if (err instanceof ServiceDisabledError) {
        logDebug(`[Linear Scan] [Direct] SERVICE_DISABLED error on project: ${projectId}`);
        if (quotaProjectId) {
          // Rule: If we already have a quota project, retry immediately borrowing quota
          logDebug(`[Linear Scan] [Direct] Retrying immediately in-line borrowing quota from: ${quotaProjectId}`);
          try {
            const keys = await fetchProjectApiKeys(projectId, signal, quotaProjectId);
            logDebug(`[Linear Scan] [Direct] SUCCESS on retry (borrowing from ${quotaProjectId})`);
            const parsedKeys = keys.map(k => parseApiKey(k, projectId));
            onResult(parsedKeys, projectId);
          } catch (retryErr: any) {
            logDebug(`[Linear Scan] [Direct] FAILED retry on project: ${projectId}. Error: ${retryErr.message}`);
            onError(retryErr, projectId);
          }
        } else {
          // Defer to backlog because no anchor is established yet
          logDebug(`[Linear Scan] [Direct] No quotaProjectId established yet. Deferring to post-scan backlog.`);
          serviceDisabledBacklog.push(projectId);
        }
      } else {
        logDebug(`[Linear Scan] [Direct] Permanent Error on project: ${projectId}. Error: ${err.message}`);
        onError(err, projectId);
      }
    }
  }

  // Pass 2: Sweep backlog using final quotaProjectId (if found)
  if (serviceDisabledBacklog.length > 0) {
    if (quotaProjectId) {
      logDebug(`[Linear Scan] Starting post-scan backlog sweep of ${serviceDisabledBacklog.length} project(s) using: ${quotaProjectId}`);
      for (const projectId of serviceDisabledBacklog) {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        logDebug(`[Linear Scan] [Backlog] Scanning ${projectId} borrowing quota from ${quotaProjectId}...`);
        try {
          const keys = await fetchProjectApiKeys(projectId, signal, quotaProjectId);
          logDebug(`[Linear Scan] [Backlog] SUCCESS on project: ${projectId}`);
          const parsedKeys = keys.map(k => parseApiKey(k, projectId));
          onResult(parsedKeys, projectId);
        } catch (err: any) {
          if (err.name === 'AbortError') {
            throw err;
          }
          logDebug(`[Linear Scan] [Backlog] FAILED on project: ${projectId}. Error: ${err.message}`);
          onError(err, projectId);
        }
      }
    } else {
      // Throw a specific error explaining we couldn't borrow quota
      logDebug(`[Linear Scan] Finished scan, but no active quota project was established to scan backlog of ${serviceDisabledBacklog.length} projects.`);
      const backlogError = new Error('API Keys service is disabled in all scanned projects and no other project has it enabled to borrow quota.');
      for (const projectId of serviceDisabledBacklog) {
        onError(backlogError, projectId);
      }
    }
  }

  return { quotaProject: quotaProjectId };
}

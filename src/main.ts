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

import { AppState, GcpProject } from './types';
import { AppError, ServiceDisabledError, fetchUserProfile, fetchProjects, fetchProjectApiKeys } from './api';
import { copyToClipboard, formatDate, formatCopyrightVersion, getRecommendationText, hasApiRestrictions, hasAppRestrictions, parseApiKey, runConcurrentTasks } from './utils';
import { login, logout, getAuthToken, getAuthScope } from './auth';

// SVGs for Copy and Checked/Copied indicators (with pointer-events disabled for clean event bubbling)
const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// Initial Application State
const state: AppState = {
  user: null,
  projects: [],
  keys: [],
  statusMessage: 'System Ready. Please sign in to begin.',
  isClientError: false,
  searchProgress: {
    status: 'idle',
    totalProjects: 0,
    completedProjects: 0,
    percentage: 0
  }
};

// Active AbortController for cancelable operations
let activeSearchController: AbortController | null = null;

// DOM Elements
const btnSearchKeys = document.getElementById('btn-search-keys') as HTMLButtonElement;
const btnCancelSearch = document.getElementById('btn-cancel-search') as HTMLButtonElement;
const btnShowSignIn = document.getElementById('btn-show-sign-in') as HTMLButtonElement;
const btnSignOut = document.getElementById('btn-sign-out') as HTMLButtonElement;
const userProfileContainer = document.getElementById('user-profile') as HTMLDivElement;
const userNameDisplay = document.getElementById('user-name') as HTMLSpanElement;
const userAvatarDisplay = document.getElementById('user-avatar') as HTMLImageElement;

// Profile dropdown selectors
const btnProfileToggle = document.getElementById('btn-profile-toggle') as HTMLButtonElement;
const profileDropdown = document.getElementById('profile-dropdown') as HTMLDivElement;
const dropdownUserName = document.getElementById('dropdown-user-name') as HTMLDivElement;
const dropdownUserEmail = document.getElementById('dropdown-user-email') as HTMLDivElement;

const emptyStateContainer = document.getElementById('empty-state') as HTMLDivElement;
const keysListContainer = document.getElementById('keys-list') as HTMLDivElement;

const progressContainer = document.getElementById('progress-container') as HTMLDivElement;
const progressTextTitle = document.getElementById('progress-text-title') as HTMLDivElement;
const progressTextDetails = document.getElementById('progress-text-details') as HTMLDivElement;
const progressBarFill = document.getElementById('progress-bar-fill') as HTMLDivElement;
const btnProgressCancel = document.getElementById('btn-progress-cancel') as HTMLButtonElement;

const statusNotification = document.getElementById('status-notification') as HTMLSpanElement;
const permissionLevelPill = document.getElementById('permission-level') as HTMLSpanElement;


const errorsModal = document.getElementById('errors-modal') as HTMLDivElement;
const btnCloseErrorsModal = document.getElementById('btn-close-errors-modal') as HTMLButtonElement;
const btnConfirmErrorsModal = document.getElementById('btn-confirm-errors-modal') as HTMLButtonElement;
const errorsModalSummary = document.getElementById('errors-modal-summary') as HTMLParagraphElement;

/**
 * Updates the Status Bar UI with the current notification message and style.
 */
function updateStatusBar(message: string, isError: boolean = false, isClient: boolean = false) {
  state.statusMessage = message;
  state.isClientError = isClient;

  statusNotification.textContent = message;

  // Reset classes
  statusNotification.className = '';

  if (isError) {
    statusNotification.classList.add('status-error');
    statusNotification.title = isClient ? 'Client-side error' : 'Server-side API error';
  } else {
    statusNotification.classList.add('status-neutral');
    statusNotification.title = '';
  }
}


/**
 * Shows/Hides the Errors Popup Modal.
 */
function setErrorsModalVisible(visible: boolean, summaryText: string = '') {
  if (visible) {
    if (summaryText) {
      errorsModalSummary.textContent = summaryText;
    }
    errorsModal.classList.remove('hidden');
  } else {
    errorsModal.classList.add('hidden');
  }
}

/**
 * Renders the empty state container based on the current authentication state.
 */
function renderEmptyState() {
  if (getAuthToken()) {
    const userDisplay = state.user ? (state.user.name || state.user.email) : 'Authenticated User';
    emptyStateContainer.innerHTML = `
      <div class="empty-icon">🔍</div>
      <h2>Ready to Scan Projects</h2>
      <p>You are signed in as <strong>${userDisplay}</strong>. Click below to scan your accessible Google Cloud projects and inspect active API keys.</p>
      <button id="btn-empty-scan" class="btn btn-primary btn-large">Scan API Keys</button>
    `;

    const btnEmptyScan = document.getElementById('btn-empty-scan') as HTMLButtonElement;
    if (btnEmptyScan) {
      btnEmptyScan.addEventListener('click', executeSearchWorkflow);
    }
  } else {
    emptyStateContainer.innerHTML = `
      <div class="empty-icon">🔓</div>
      <h2>Review Your Google Cloud API Keys</h2>
      <p>Please sign in with your Google account to scan your active projects and review their restriction levels.</p>
      <button id="btn-empty-sign-in" class="btn btn-primary btn-large">Sign In Now</button>
    `;

    const btnEmptySignInDynamic = document.getElementById('btn-empty-sign-in') as HTMLButtonElement;
    if (btnEmptySignInDynamic) {
      btnEmptySignInDynamic.addEventListener('click', () => redirectToGoogleOAuth('readonly'));
    }
  }
}

/**
 * Triggers Google OAuth sign-in popup using the modern Google Identity Services library.
 */
function redirectToGoogleOAuth(scopeType: 'readonly' | 'full') {
  updateStatusBar('Opening Google Sign-In popup...');
  login(
    scopeType,
    () => {
      handleOAuthSession();
    },
    (errMessage) => {
      updateStatusBar(errMessage, true, true);
    }
  );
}

/**
 * Applies the authenticated session to the application state and fetches the user profile.
 */
async function handleOAuthSession() {
  const token = getAuthToken();
  const scope = getAuthScope();

  if (token && scope) {
    // Update toolbar profile elements to loading state
    btnShowSignIn.classList.add('hidden');
    userProfileContainer.classList.remove('hidden');
    userNameDisplay.textContent = 'Loading Profile...';
    userAvatarDisplay.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23CBD5E0"/><text x="12" y="16" font-size="12" font-family="system-ui" font-weight="bold" fill="%23718096" text-anchor="middle">👤</text></svg>';

    // Enable the "Find Keys" button
    btnSearchKeys.disabled = false;

    // Set status bar permission pill
    permissionLevelPill.textContent = scope === 'readonly' ? 'Read-Only' : 'Full Access';
    permissionLevelPill.className = 'permission-pill';
    permissionLevelPill.classList.add(scope === 'readonly' ? 'level-readonly' : 'level-full');

    renderEmptyState();

    try {
      updateStatusBar('Fetching user profile...');
      const userProfile = await fetchUserProfile();
      state.user = userProfile;

      // Render profile
      userNameDisplay.textContent = userProfile.name || userProfile.email;
      if (dropdownUserName) {
        dropdownUserName.textContent = userProfile.name || 'GCP Auditor';
      }
      if (dropdownUserEmail) {
        dropdownUserEmail.textContent = userProfile.email;
      }
      if (userProfile.picture) {
        userAvatarDisplay.src = userProfile.picture;
        userAvatarDisplay.alt = `Signed in as ${userProfile.name}. Click to Sign Out.`;
      } else {
        // Fallback placeholder icon
        userAvatarDisplay.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="darkgrey"><circle cx="12" cy="12" r="12"/></svg>';
      }

      renderEmptyState();
      updateStatusBar('Successfully authenticated. Ready to scan keys.');
    } catch (err: any) {
      console.error('Error loading user profile:', err);
      // If our token is invalid/expired, prompt sign-in again
      if (err instanceof AppError && err.status === 401) {
        handleSignOut();
        updateStatusBar('Session expired. Please sign in again.', true, false);
      } else {
        userNameDisplay.textContent = 'Auth Error';
        updateStatusBar(`Authentication warning: ${err.message}`, true, err.source === 'client');
      }
    }
  } else {
    // Not signed in
    handleSignOutState();
  }
}

/**
 * Resets application state variables to signed-out values (internal helper).
 */
function handleSignOutState() {
  state.user = null;
  state.projects = [];
  state.keys = [];

  // Reset UI elements
  btnShowSignIn.classList.remove('hidden');
  userProfileContainer.classList.add('hidden');
  btnSearchKeys.disabled = true;

  if (profileDropdown) {
    profileDropdown.classList.add('hidden');
  }

  emptyStateContainer.classList.remove('hidden');
  keysListContainer.classList.add('hidden');

  permissionLevelPill.textContent = 'None';
  permissionLevelPill.className = 'permission-pill';

  renderEmptyState();
  updateStatusBar('Signed out. Please sign in to begin.');
}

/**
 * Performs full Sign Out, revoking the token from Google if possible.
 */
async function handleSignOut() {
  updateStatusBar('Signing out and revoking session token...');
  await logout();
  handleSignOutState();
}

// Dynamic badge configuration is computed inline inside renderKeysList based on active security profiles.

/**
 * Displays/Updates the list of API Keys in the main area.
 */
function renderKeysList() {
  if (state.keys.length === 0) {
    keysListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <h2>No Active API Keys Found</h2>
        <p>We scanned ${state.projects.length} project(s) and found no active Google Cloud API Keys.</p>
      </div>
    `;
    return;
  }

  // Sort keys: Unrestricted (none) first, then Partially restricted (some), then Fully restricted (full)
  const sortedKeys = [...state.keys].sort((a, b) => {
    const weights = { none: 0, some: 1, full: 2 };
    return weights[a.restrictionLevel] - weights[b.restrictionLevel];
  });

  keysListContainer.innerHTML = '';

  const fragment = document.createDocumentFragment();

  for (const key of sortedKeys) {
    const row = document.createElement('div');
    row.className = `key-item-row level-${key.restrictionLevel}`;

    const tooltipText = key.humanReadableRestrictions.join('\n');

    // Dynamic badge and emoji configuration based on security profile
    const api = hasApiRestrictions(key.rawRestrictions);
    const app = hasAppRestrictions(key.rawRestrictions);
    const hasSa = !!key.serviceAccountEmail;

    let badgeIconEmoji = '🔓';
    let badgeText = 'Some';
    let badgeClass = 'badge-some';

    if (!api && !app) {
      // 🚨 None -- No restrictions found regardless whether key is bound or not to a service account
      badgeIconEmoji = '🚨';
      badgeText = 'None';
      badgeClass = 'badge-none';
    } else if (hasSa) {
      // 🔐 Locked -- When API or Application restrictions are set and key is bound to a service account
      badgeIconEmoji = '🔐';
      badgeText = 'Locked';
      badgeClass = 'badge-full';
    } else if (api && app) {
      // 🔒 Restricted -- When both API and Application restrictions are set but key is not bound to a service account
      badgeIconEmoji = '🔒';
      badgeText = 'Restricted';
      badgeClass = 'badge-full';
    } else {
      // 🔓 Some -- If either API or Application restrictions are set but key is not bound to a service account
      badgeIconEmoji = '🔓';
      badgeText = 'Some';
      badgeClass = 'badge-some';
    }

    row.innerHTML = `
      <!-- Column 1: Display Name -->
      <div class="text-truncate-wrapper">
        <span class="text-truncate" id="name-${key.uid}" title="${key.displayName}">
          <a class="key-link" href="https://console.cloud.google.com/apis/credentials/key/${key.uid}?project=${key.projectId}" target="_blank" rel="noopener noreferrer">
            ${key.displayName}
          </a>
        </span>
        <button class="btn btn-copy" data-copy-target="name-${key.uid}" title="Copy Name">${COPY_SVG}</button>
      </div>
      
      <!-- Column 2: UID -->
      <div class="text-truncate-wrapper">
        <div class="text-truncate" style="font-family: monospace;" id="uid-${key.uid}" title="${key.uid}">
          ${key.uid}
          <div class="key-uid-sub">Created ${formatDate(key.createTime)}</div>
        </div>
        <button class="btn btn-copy" data-copy-target="uid-${key.uid}" title="Copy UID">${COPY_SVG}</button>
      </div>
      
      <!-- Column 3: Project ID -->
      <div class="text-truncate-wrapper">
        <span class="text-truncate" id="proj-${key.uid}" title="${key.projectId}">${key.projectId}</span>
        <button class="btn btn-copy" data-copy-target="proj-${key.uid}" title="Copy Project ID">${COPY_SVG}</button>
      </div>
      
      <!-- Column 4: Restriction Badge -->
      <div class="restriction-badge-container">
        <div class="restriction-badge ${badgeClass}" title="${tooltipText}">
          <span class="badge-icon">${badgeIconEmoji}</span>
          <span>${badgeText}</span>
        </div>
      </div>

      <!-- Column 5: Recommendations -->
      <div class="key-recommendation-text">
        ${getRecommendationText(key.rawRestrictions, key.serviceAccountEmail)}
      </div>
    `;

    fragment.appendChild(row);
  }

  keysListContainer.appendChild(fragment);

  // Setup click listeners for all Copy buttons
  const copyButtons = keysListContainer.querySelectorAll('.btn-copy');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      const targetId = button.getAttribute('data-copy-target');
      if (!targetId) return;

      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      // Extract only the direct text (avoid copy-sub text)
      // We clone the node and remove subtext if any
      const cloned = targetEl.cloneNode(true) as HTMLElement;
      const sub = cloned.querySelector('.key-uid-sub, .key-project-sub');
      if (sub) cloned.removeChild(sub);

      const textToCopy = cloned.textContent?.trim() || '';

      const success = await copyToClipboard(textToCopy);
      if (success) {
        const originalTitle = button.getAttribute('title') || '';
        button.innerHTML = CHECK_SVG;
        button.classList.add('copied');
        button.setAttribute('title', 'Copied!');
        setTimeout(() => {
          button.innerHTML = COPY_SVG;
          button.classList.remove('copied');
          button.setAttribute('title', originalTitle);
        }, 2000);
      } else {
        updateStatusBar('Failed to copy to clipboard', true, true);
      }
    });
  });
}

/**
 * Cancels any active search workflow and resets UI.
 */
function cancelSearch() {
  if (activeSearchController) {
    activeSearchController.abort();
    activeSearchController = null;
  }

  state.searchProgress.status = 'cancelled';
  progressContainer.classList.add('hidden');
  btnSearchKeys.classList.remove('hidden');
  btnCancelSearch.classList.add('hidden');

  updateStatusBar('Search cancelled by user.');
}

/**
 * Main Search Workflow: Scans all active projects and retrieves active API keys.
 */
async function executeSearchWorkflow() {
  if (!getAuthToken()) {
    updateStatusBar('Error: You must be signed in to search API keys.', true, true);
    return;
  }

  // Setup AbortController for cancelable fetch operations
  activeSearchController = new AbortController();
  const signal = activeSearchController.signal;

  // Initialize progress state
  state.searchProgress = {
    status: 'searching-projects',
    totalProjects: 0,
    completedProjects: 0,
    percentage: 0
  };
  state.keys = [];

  // Track findings/errors
  const permissionDeniedProjects: { projectId: string; message: string }[] = [];
  const otherErrors: { projectId: string; message: string }[] = [];

  // Update UI Layout
  emptyStateContainer.classList.add('hidden');
  keysListContainer.classList.remove('hidden');
  keysListContainer.innerHTML = ''; // Clear previous lists

  progressContainer.classList.remove('hidden');
  btnSearchKeys.classList.add('hidden');
  btnCancelSearch.classList.remove('hidden');

  progressTextTitle.textContent = 'Scanning Google Cloud Projects...';
  progressTextDetails.textContent = 'Requesting the list of all accessible projects...';
  progressBarFill.style.width = '0%';

  updateStatusBar('Scanning Google Cloud projects...');

  let projects: GcpProject[] = [];

  // STEP 1: Handle Project List Failure separately
  try {
    projects = await fetchProjects(signal);
    state.projects = projects;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      cancelSearch();
      return;
    }
    console.error('Failed to list Google Cloud projects:', err);
    progressContainer.classList.add('hidden');
    btnSearchKeys.classList.remove('hidden');
    btnCancelSearch.classList.add('hidden');

    let friendlyMessage = 'Failed to retrieve projects. ';
    if (err instanceof AppError && (err.status === 401 || err.status === 403)) {
      friendlyMessage += 'Please verify that your Google account has active access to Google Cloud and has granted "Cloud Platform" or "Cloud Platform (Read-Only)" scopes.';
    } else {
      friendlyMessage += err.message || 'Unknown network error.';
    }
    updateStatusBar(friendlyMessage, true, err.source === 'client');
    return;
  }

  if (projects.length === 0) {
    progressContainer.classList.add('hidden');
    btnSearchKeys.classList.remove('hidden');
    btnCancelSearch.classList.add('hidden');
    renderKeysList();
    updateStatusBar('Search complete. No projects found.');
    return;
  }

  // STEP 2: Configure state for Keys scanning
  state.searchProgress.status = 'searching-keys';
  state.searchProgress.totalProjects = projects.length;

  progressTextTitle.textContent = 'Scanning Active API Keys...';

  // State variables for batching & dynamic quota routing
  let quotaProjectId: string | null = null;
  const backlogProjects: string[] = [];
  let completedUniqueCount = 0;

  const BATCH_SIZE = 12;
  const CONCURRENCY = 4;

  console.log(`[SCANNER_DEBUG] Starting search workflow. Total projects to scan: ${projects.length}`);

  // Process projects in batches of 12
  try {
    for (let batchStart = 0; batchStart < projects.length; batchStart += BATCH_SIZE) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const batchProjects = projects.slice(batchStart, batchStart + BATCH_SIZE);
      const serviceDisabledToRetry: string[] = [];

      console.log(`[SCANNER_DEBUG] --- Starting Batch [${batchStart} to ${batchStart + batchProjects.length}] ---`);
      console.log(`[SCANNER_DEBUG] Batch projects:`, batchProjects.map(p => p.projectId));
      console.log(`[SCANNER_DEBUG] Active quotaProjectId anchor: ${quotaProjectId}`);

      // A. DIRECT CONCURRENT SCAN PASS
      await runConcurrentTasks(batchProjects, CONCURRENCY, async (project) => {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        // Update progress bar detail
        const itemIndex = completedUniqueCount + 1;
        const percent = Math.round((itemIndex / projects.length) * 100);
        progressTextDetails.textContent = `Scanning project ${itemIndex} of ${projects.length}: ${project.projectId} (${percent}%)`;
        progressBarFill.style.width = `${percent}%`;

        try {
          updateStatusBar(`Scanning project: ${project.projectId}...`);
          console.log(`[SCANNER_DEBUG] [Direct Scan] Fetching keys for: ${project.projectId}`);
          // Fetch direct (no quota borrow)
          const keys = await fetchProjectApiKeys(project.projectId, signal);

          // RULES 2 & 4: Successful direct scan updates the quotaProjectId
          quotaProjectId = project.projectId;
          console.log(`[SCANNER_DEBUG] [Direct Scan] SUCCESS on project: ${project.projectId}. Found ${keys.length} keys. NEW quotaProjectId anchor: ${quotaProjectId}`);

          // Parse and add keys
          const parsedKeys = keys.map(k => parseApiKey(k, project.projectId));
          state.keys = state.keys.concat(parsedKeys);
          renderKeysList();
        } catch (err: any) {
          console.log(`[SCANNER_DEBUG] [Direct Scan] ERROR on project: ${project.projectId}. ErrorName: ${err.name || err.constructor.name}, Status: ${err.status}, Message: "${err.message}"`);
          if (err.name === 'AbortError') {
            throw err;
          }
          if (err instanceof ServiceDisabledError) {
            serviceDisabledToRetry.push(project.projectId);
          } else if (err instanceof AppError && err.status === 403) {
            // RULE 5: Keep track of actual permission denied issues as warnings
            permissionDeniedProjects.push({
              projectId: project.projectId,
              message: err.message || 'Permission denied'
            });
          } else {
            otherErrors.push({
              projectId: project.projectId,
              message: err.message || 'Unknown scan error'
            });
          }
        } finally {
          completedUniqueCount++;
        }
      });

      // B. INTRA-BATCH RETRY PASS
      console.log(`[SCANNER_DEBUG] Batch direct scan completed. Projects flagged as SERVICE_DISABLED to retry in-batch:`, serviceDisabledToRetry);
      if (serviceDisabledToRetry.length > 0) {
        if (quotaProjectId) {
          // Case A: We have a quota project, retry concurrently using it
          const currentQuota = quotaProjectId; // Capture local reference
          console.log(`[SCANNER_DEBUG] [Intra-Batch Retry] Retrying service-disabled projects borrowing quota from: ${currentQuota}`);
          await runConcurrentTasks(serviceDisabledToRetry, CONCURRENCY, async (projectId) => {
            if (signal.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }

            try {
              console.log(`[SCANNER_DEBUG] [Intra-Batch Retry] Scanning ${projectId} borrowing quota from ${currentQuota}...`);
              const keys = await fetchProjectApiKeys(projectId, signal, currentQuota);

              console.log(`[SCANNER_DEBUG] [Intra-Batch Retry] SUCCESS on project: ${projectId} (borrowing from ${currentQuota}). Found ${keys.length} keys.`);

              const parsedKeys = keys.map(k => parseApiKey(k, projectId));
              state.keys = state.keys.concat(parsedKeys);
              renderKeysList();
            } catch (err: any) {
              console.log(`[SCANNER_DEBUG] [Intra-Batch Retry] FAILED on project: ${projectId} (borrowing from ${currentQuota}). ErrorName: ${err.name || err.constructor.name}, Status: ${err.status}, Message: "${err.message}"`);
              if (err.name === 'AbortError') {
                throw err;
              }
              if (err instanceof AppError && err.status === 403) {
                permissionDeniedProjects.push({
                  projectId,
                  message: err.message || 'Permission denied'
                });
              } else {
                otherErrors.push({
                  projectId,
                  message: err.message || 'Quota retry failed'
                });
              }
            }
          });
        } else {
          // Case B: No quota project found yet, push all to global backlog
          console.log(`[SCANNER_DEBUG] [Intra-Batch Retry] No quotaProjectId available yet. Deferring projects to global backlog:`, serviceDisabledToRetry);
          backlogProjects.push(...serviceDisabledToRetry);
        }
      }
    }

    // STEP B: POST-SCAN BACKLOG RETRIES
    console.log(`[SCANNER_DEBUG] === Direct Batches Complete ===`);
    console.log(`[SCANNER_DEBUG] Final global backlogProjects to retry:`, backlogProjects);
    console.log(`[SCANNER_DEBUG] Final quotaProjectId anchor established: ${quotaProjectId}`);

    if (backlogProjects.length > 0) {
      if (quotaProjectId) {
        const currentQuota = quotaProjectId;
        updateStatusBar(`Retrying ${backlogProjects.length} backlog project(s) using final quota project ${currentQuota}...`);
        console.log(`[SCANNER_DEBUG] [Backlog Retry] Starting backlog retry of ${backlogProjects.length} projects borrowing quota from: ${currentQuota}`);

        await runConcurrentTasks(backlogProjects, CONCURRENCY, async (projectId) => {
          if (signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          try {
            console.log(`[SCANNER_DEBUG] [Backlog Retry] Scanning ${projectId} borrowing quota from ${currentQuota}...`);
            const keys = await fetchProjectApiKeys(projectId, signal, currentQuota);

            console.log(`[SCANNER_DEBUG] [Backlog Retry] SUCCESS on project: ${projectId} (borrowing from ${currentQuota}). Found ${keys.length} keys.`);

            // NOTE: We do NOT update quotaProjectId here, because this project
            // has the service disabled and only succeeded via quota borrowing.

            const parsedKeys = keys.map(k => parseApiKey(k, projectId));
            state.keys = state.keys.concat(parsedKeys);
            renderKeysList();
          } catch (err: any) {
            console.log(`[SCANNER_DEBUG] [Backlog Retry] FAILED on project: ${projectId} (borrowing from ${currentQuota}). ErrorName: ${err.name || err.constructor.name}, Status: ${err.status}, Message: "${err.message}"`);
            if (err.name === 'AbortError') {
              throw err;
            }
            if (err instanceof AppError && err.status === 403) {
              permissionDeniedProjects.push({
                projectId,
                message: err.message || 'Permission denied'
              });
            } else {
              otherErrors.push({
                projectId,
                message: err.message || 'Backlog scan failed'
              });
            }
          }
        });
      } else {
        // No quota project could be established throughout the entire scan
        console.log(`[SCANNER_DEBUG] [Backlog Retry] CRITICAL: No valid quotaProjectId was established throughout the entire run. All backlog projects will report service disabled errors.`);
        for (const failedProjId of backlogProjects) {
          otherErrors.push({
            projectId: failedProjId,
            message: 'API Keys service has not been used before and no other project could be established to borrow quota.'
          });
        }
      }
    }

    // STEP 3: Complete scan
    state.searchProgress.status = 'complete';
    state.searchProgress.percentage = 100;
    progressBarFill.style.width = '100%';
    progressContainer.classList.add('hidden');

    btnSearchKeys.classList.remove('hidden');
    btnCancelSearch.classList.add('hidden');

    // RULE 5 & UI update: Present summary/warnings
    if (permissionDeniedProjects.length === 0) {
      updateStatusBar(`Search complete. Found ${state.keys.length} API key(s) across ${projects.length} project(s).`);
    } else {
      // Report lacking permissions only as warning on status bar
      updateStatusBar(`⚠️ Scan complete. Lacked permissions to list keys on ${permissionDeniedProjects.length} project(s).`, true, false);

      const summaryText = `During the scan, you lacked permissions to view keys on ${permissionDeniedProjects.length} project(s). These have been logged.`;
      setErrorsModalVisible(true, summaryText);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      cancelSearch();
      return;
    }

    console.error('Error during search workflow:', err);
    progressContainer.classList.add('hidden');
    btnSearchKeys.classList.remove('hidden');
    btnCancelSearch.classList.add('hidden');

    const isClient = err.source === 'client' || !(err instanceof AppError);
    updateStatusBar(`Search failed: ${err.message}`, true, isClient);
  } finally {
    activeSearchController = null;
  }
}

/**
 * Attaches event listeners to DOM controls.
 */
function setupEventListeners() {
  btnShowSignIn.addEventListener('click', () => redirectToGoogleOAuth('readonly'));

  btnCloseErrorsModal.addEventListener('click', () => setErrorsModalVisible(false));
  btnConfirmErrorsModal.addEventListener('click', () => setErrorsModalVisible(false));

  // Profile dropdown toggle behaviour
  if (btnProfileToggle) {
    btnProfileToggle.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent document click listener from instantly closing the dropdown
      profileDropdown.classList.toggle('hidden');
    });
  }

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (
      profileDropdown &&
      !profileDropdown.classList.contains('hidden') &&
      !profileDropdown.contains(target) &&
      !btnProfileToggle.contains(target)
    ) {
      profileDropdown.classList.add('hidden');
    }
  });

  // Sign Out click on dropdown sign-out button
  btnSignOut.addEventListener('click', handleSignOut);

  // Fallback if Google picture fails to load
  userAvatarDisplay.addEventListener('error', () => {
    userAvatarDisplay.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23CBD5E0"/><text x="12" y="16" font-size="12" font-family="system-ui" font-weight="bold" fill="%234A5568" text-anchor="middle">👤</text></svg>';
  });

  // Search API keys click trigger
  btnSearchKeys.addEventListener('click', executeSearchWorkflow);

  // Cancel button clicks
  btnCancelSearch.addEventListener('click', cancelSearch);
  btnProgressCancel.addEventListener('click', cancelSearch);
}

function init() {
  setupEventListeners();

  handleOAuthSession();

  // Set the application version dynamically in the status bar
  const copyrightElement = document.getElementById('copyright');
  if (copyrightElement) {
    copyrightElement.innerHTML = formatCopyrightVersion(import.meta.env.APP_VERSION);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

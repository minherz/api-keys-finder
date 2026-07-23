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

import { AppState, ParsedApiKey, ApiKey } from './types';
import { AppError, ServiceDisabledError, fetchUserProfile, fetchProjects, fetchProjectApiKeys } from './api';
import { getRestrictionLevel, getHumanReadableRestrictions, copyToClipboard, formatDate } from './utils';
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

const emptyStateContainer = document.getElementById('empty-state') as HTMLDivElement;
const keysListContainer = document.getElementById('keys-list') as HTMLDivElement;

const progressContainer = document.getElementById('progress-container') as HTMLDivElement;
const progressTextTitle = document.getElementById('progress-text-title') as HTMLDivElement;
const progressTextDetails = document.getElementById('progress-text-details') as HTMLDivElement;
const progressBarFill = document.getElementById('progress-bar-fill') as HTMLDivElement;
const btnProgressCancel = document.getElementById('btn-progress-cancel') as HTMLButtonElement;

const statusNotification = document.getElementById('status-notification') as HTMLSpanElement;
const permissionLevelPill = document.getElementById('permission-level') as HTMLSpanElement;

const signInModal = document.getElementById('sign-in-modal') as HTMLDivElement;
const btnCloseModal = document.getElementById('btn-close-modal') as HTMLButtonElement;
const btnCancelModal = document.getElementById('btn-cancel-modal') as HTMLButtonElement;
const signInForm = document.getElementById('sign-in-form') as HTMLFormElement;

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
 * Shows/Hides the Sign In Modal.
 */
function setModalVisible(visible: boolean) {
  if (visible) {
    signInModal.classList.remove('hidden');
  } else {
    signInModal.classList.add('hidden');
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
      btnEmptySignInDynamic.addEventListener('click', () => setModalVisible(true));
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

// Static configuration mapping for restriction level visual badges (Color-blind friendly)
const RESTRICTION_BADGE_CONFIGS = {
  full: {
    badgeClass: 'badge-full',
    badgeIcon: '●',
    badgeText: 'Fully Restricted'
  },
  some: {
    badgeClass: 'badge-some',
    badgeIcon: '◐',
    badgeText: 'Partially Restricted'
  },
  none: {
    badgeClass: 'badge-none',
    badgeIcon: '○ ⚠',
    badgeText: 'Unrestricted'
  }
} as const;

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

    const config = RESTRICTION_BADGE_CONFIGS[key.restrictionLevel];
    const tooltipText = key.humanReadableRestrictions.join('\n');

    row.innerHTML = `
      <!-- Column 1: Display Name -->
      <div class="text-truncate-wrapper">
        <span class="text-truncate" id="name-${key.uid}" title="${key.displayName}">${key.displayName}</span>
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
        <div class="restriction-badge ${config.badgeClass}" title="${tooltipText}">
          <span class="badge-icon">${config.badgeIcon}</span>
          <span>${config.badgeText}</span>
        </div>
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
  const scanErrors: { projectId: string; message: string }[] = [];

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

  try {
    // STEP 1: Fetch Projects
    const projects = await fetchProjects(signal);
    state.projects = projects;

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

    // Tracking variables for dynamic quota routing
    let goodProjectId: string | null = null;
    const disabledProjectsToRetry: string[] = [];
    let nextPhase1Index = 0;

    // Phase 1: Loop through projects sequentially until the first goodProjectId is found
    for (let i = 0; i < projects.length; i++) {
      // Check cancellation state
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const project = projects[i];
      const percent = Math.round((i / projects.length) * 100);

      // Update loading UI
      progressTextDetails.textContent = `Scanning project ${i + 1} of ${projects.length}: ${project.projectId} (${percent}%)`;
      progressBarFill.style.width = `${percent}%`;

      updateStatusBar(`Scanning project: ${project.projectId}...`);

      let keys: ApiKey[] = [];
      let isSuccess = false;
      let isServiceDisabled = false;

      try {
        // Fetch keys for this project
        keys = await fetchProjectApiKeys(project.projectId, signal);
        isSuccess = true;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw err;
        }
        if (err instanceof ServiceDisabledError) {
          isServiceDisabled = true;
        } else {
          console.error(`Error scanning keys for project ${project.projectId}:`, err);
          scanErrors.push({
            projectId: project.projectId,
            message: err.message || 'Unknown error'
          });
        }
      }

      if (isServiceDisabled) {
        disabledProjectsToRetry.push(project.projectId);
      }

      if (isSuccess) {
        // Remember the successful project ID for billing/quota
        goodProjectId = project.projectId;

        // Enrich keys with project metadata and parse restrictions
        const parsedKeys: ParsedApiKey[] = keys.map(k => {
          const restrictionLevel = getRestrictionLevel(k.restrictions);
          const humanReadableRestrictions = getHumanReadableRestrictions(k.restrictions);

          return {
            uid: k.uid,
            displayName: k.displayName || 'Unnamed Key',
            projectId: project.projectId,
            createTime: k.createTime,
            rawRestrictions: k.restrictions || {},
            restrictionLevel,
            humanReadableRestrictions
          };
        });

        // Add to state and re-render incremental list immediately
        state.keys = state.keys.concat(parsedKeys);
        renderKeysList();

        nextPhase1Index = i + 1;
        break; // Break loop on first success!
      }

      nextPhase1Index = i + 1;
    }

    // Phase 2: If a goodProjectId is found, run any remaining projects and previously queued
    // disabled projects concurrently using a chunked promise queue (concurrency limit 4).
    if (goodProjectId) {
      const remainingProjects = projects.slice(nextPhase1Index);
      const phase2ProjectIds = [
        ...disabledProjectsToRetry,
        ...remainingProjects.map(p => p.projectId)
      ];

      if (phase2ProjectIds.length > 0) {
        const CONCURRENCY = 4;
        let taskIndex = 0;
        let completedUniqueCount = nextPhase1Index - disabledProjectsToRetry.length;

        const runWorker = async () => {
          while (taskIndex < phase2ProjectIds.length) {
            if (signal.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }

            const currentProjectId = phase2ProjectIds[taskIndex++];

            try {
              updateStatusBar(`Scanning project: ${currentProjectId} (concurrent)...`);
              const keys = await fetchProjectApiKeys(currentProjectId, signal, goodProjectId);

              const parsedKeys: ParsedApiKey[] = keys.map(k => {
                const restrictionLevel = getRestrictionLevel(k.restrictions);
                const humanReadableRestrictions = getHumanReadableRestrictions(k.restrictions);

                return {
                  uid: k.uid,
                  displayName: k.displayName || 'Unnamed Key',
                  projectId: currentProjectId,
                  createTime: k.createTime,
                  rawRestrictions: k.restrictions || {},
                  restrictionLevel,
                  humanReadableRestrictions
                };
              });

              state.keys = state.keys.concat(parsedKeys);
              renderKeysList();
            } catch (err: any) {
              if (err.name === 'AbortError') {
                throw err;
              }
              console.error(`Concurrent scan failed for project ${currentProjectId} using quota project ${goodProjectId}:`, err);
              scanErrors.push({
                projectId: currentProjectId,
                message: err.message || 'Unknown error'
              });
            } finally {
              completedUniqueCount++;
              const percent = Math.round((completedUniqueCount / projects.length) * 100);
              progressTextDetails.textContent = `Scanning project ${completedUniqueCount} of ${projects.length}: ${currentProjectId} (${percent}%)`;
              progressBarFill.style.width = `${percent}%`;
            }
          }
        };

        const workers = Array.from(
          { length: Math.min(CONCURRENCY, phase2ProjectIds.length) },
          () => runWorker()
        );
        await Promise.all(workers);
      }
    } else {
      // Fallback: No successful project found anywhere to borrow quota from. Report all as errors.
      for (const failedProjId of disabledProjectsToRetry) {
        console.warn(`API Keys service is disabled for project ${failedProjId} and no other project has it enabled to borrow quota.`);
        scanErrors.push({
          projectId: failedProjId,
          message: `API Keys service has not been used in project ${failedProjId} before or it is disabled.`
        });
      }
    }

    // STEP 3: Complete scan
    state.searchProgress.status = 'complete';
    state.searchProgress.percentage = 100;
    progressBarFill.style.width = '100%';
    progressContainer.classList.add('hidden');

    btnSearchKeys.classList.remove('hidden');
    btnCancelSearch.classList.add('hidden');

    if (scanErrors.length === 0) {
      updateStatusBar(`Search complete. Found ${state.keys.length} API key(s) across ${projects.length} project(s).`);
    } else if (scanErrors.length === 1) {
      const rawMsg = scanErrors[0].message;
      const truncated = rawMsg.length > 80 ? rawMsg.substring(0, 77) + '...' : rawMsg;
      updateStatusBar(`⚠️ ${truncated}`, true, false);
    } else {
      const summaryText = `During the scan, ${scanErrors.length} projects returned errors (such as disabled API Keys service or permission issues).`;
      setErrorsModalVisible(true, summaryText);
      updateStatusBar(`⚠️ Scan complete with ${scanErrors.length} project errors. See Developer Console for details.`, true, false);
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
  btnShowSignIn.addEventListener('click', () => setModalVisible(true));
  btnCloseModal.addEventListener('click', () => setModalVisible(false));
  btnCancelModal.addEventListener('click', () => setModalVisible(false));

  btnCloseErrorsModal.addEventListener('click', () => setErrorsModalVisible(false));
  btnConfirmErrorsModal.addEventListener('click', () => setErrorsModalVisible(false));

  // Sign Out click on avatar icon
  btnSignOut.addEventListener('click', handleSignOut);

  // Fallback if Google picture fails to load
  userAvatarDisplay.addEventListener('error', () => {
    userAvatarDisplay.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23CBD5E0"/><text x="12" y="16" font-size="12" font-family="system-ui" font-weight="bold" fill="%234A5568" text-anchor="middle">👤</text></svg>';
  });

  // Form submit -> redirects to Google
  signInForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const scopeType = (signInForm.elements.namedItem('input-scope') as RadioNodeList).value as 'readonly' | 'full';

    setModalVisible(false);
    redirectToGoogleOAuth(scopeType);
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

  // Set the application version dynamically from package.json in the status bar
  const copyrightElement = document.getElementById('copyright');
  if (copyrightElement) {
    const version = `v${import.meta.env.APP_VERSION}` || '<unknown>';
    copyrightElement.innerHTML = `&copy; 2026 Google API Key Reviewer ${version}. All rights reserved.`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

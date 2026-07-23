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

// Declare the external Google Identity Services library global variable
declare const google: any;

// Hardcoded Google OAuth 2.0 Client ID (Configure your registered Client ID here)
const GOOGLE_OAUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '315151726413-pqojn55eu1vqup2rq4q3ebl7qo17670a.apps.googleusercontent.com';

interface AuthSession {
  token: string | null;
  scope: 'readonly' | 'full' | null;
}

// Global In-Memory state for the active session
let activeSession: AuthSession | null = null;


/**
 * Initializes the auth session by restoring any saved credentials from sessionStorage.
 * This is called exactly once when the application boots up.
 */
function initializeSession(): AuthSession {
  const token = sessionStorage.getItem('gcp_reviewer_token');
  const scope = sessionStorage.getItem('gcp_reviewer_scope') as 'readonly' | 'full' | null;

  if (token && scope) {
    activeSession = { token, scope };
  } else {
    activeSession = { token: null, scope: null };
  }

  return activeSession;
}

/**
 * Retrieves the active OAuth access token.
 */
export function getAuthToken(): string | null {
  let s: AuthSession = (activeSession ??= initializeSession());
  return s.token;
}

/**
 * Retrieves the active scope level.
 */
export function getAuthScope(): 'readonly' | 'full' | null {
  let s: AuthSession = (activeSession ??= initializeSession());
  return s.scope;
}

/**
 * Triggers the modern Google Identity Services popup login flow.
 */
export function login(
  scopeType: 'readonly' | 'full',
  onSuccess: () => void,
  onError: (errorMessage: string) => void
): void {
  // Defensive check: Verify that Google Identity Services script loaded successfully
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    onError(
      'Google Sign-In library is unavailable. Please disable any ad-blockers, tracking protection, or check your network connection and reload.'
    );
    return;
  }

  // Construct target scopes
  const scopesList = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  if (scopeType === 'readonly') {
    scopesList.push('https://www.googleapis.com/auth/cloud-platform.read-only');
  } else if (scopeType === 'full') {
    scopesList.push('https://www.googleapis.com/auth/cloud-platform');
  }

  try {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      scope: scopesList.join(' '),
      callback: (tokenResponse: any) => {
        if (tokenResponse.error) {
          console.error('Google Sign-In callback error:', tokenResponse.error);
          onError(`Google Sign-In failed: ${tokenResponse.error_description || tokenResponse.error}`);
          return;
        }

        // Validate that requested scopes were actually granted by the user
        const requiredScope = scopeType === 'readonly'
          ? 'https://www.googleapis.com/auth/cloud-platform.read-only'
          : 'https://www.googleapis.com/auth/cloud-platform';

        if (!google.accounts.oauth2.hasGrantedAllScopes(tokenResponse, requiredScope)) {
          onError('Access Denied: You must grant the application permissions to access Google Cloud Platform resources to perform key reviews.');
          return;
        }

        // Store session in memory and sessionStorage
        activeSession = {
          token: tokenResponse.access_token,
          scope: scopeType
        };
        sessionStorage.setItem('gcp_reviewer_token', tokenResponse.access_token);
        sessionStorage.setItem('gcp_reviewer_scope', scopeType);

        onSuccess();
      },
      error_callback: (err: any) => {
        console.error('Google Sign-In initialization runtime error:', err);
        onError(`Sign-In client initialization error: ${err.message || 'Unknown error'}`);
      }
    });

    // Request the token opening the popup window
    client.requestAccessToken();
  } catch (err: any) {
    console.error('Error during initTokenClient flow:', err);
    onError(`Failed to open Google Sign-In: ${err.message || err}`);
  }
}

/**
 * Revokes Google OAuth access token on Sign Out and wipes session data.
 */
export async function logout(): Promise<void> {
  const currentToken = getAuthToken();

  // Wipe active session from memory and storage first
  activeSession = { token: null, scope: null };
  sessionStorage.removeItem('gcp_reviewer_token');
  sessionStorage.removeItem('gcp_reviewer_scope');
  sessionStorage.removeItem('gcp_reviewer_oauth_state');

  // Trigger server-side token revocation if a token was active
  if (currentToken) {
    await revokeOAuthToken(currentToken);
  }
}

/**
 * Revokes Google OAuth access token on the server.
 */
async function revokeOAuthToken(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      mode: 'no-cors' // Google's revoke endpoint allows no-cors
    });
  } catch (err) {
    console.error('Failed to revoke OAuth token on server:', err);
  }
}

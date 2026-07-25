# Google Cloud API Keys Finder

[![CI](https://github.com/minherz/api-keys-finder/actions/workflows/ci.yml/badge.svg)](https://github.com/minherz/api-keys-finder/actions/workflows/ci.yml)

An ultra-lightweight, high-performance Single Page Application (SPA) designed to audit and inspect active API keys across all accessible Google Cloud projects. Running entirely inside the browser with **zero backend dependencies**, it communicates directly with Google Cloud REST APIs to perform real-time security scanning, categorization, and restriction checks.

---

## 📂 Project Structure

```
/
├── .devcontainer/       # Dev container configuration for instant workspace setup
├── deploy/              # Cloud Run Dockerfile, Nginx config, and Firebase deployment specs
├── firebase.json        # Firebase hosting configuration
├── index.html          # Main HTML5 entrypoint and layout structure for the SPA
├── skills-lock.json    # Version lockfile for Antigravity AI custom developer skills
├── vite.config.ts       # Vite bundler configuration and environment setup
└── src/                # Core application source code
    ├── api.ts          # Direct GCP REST API handshakes, customized errors, and headers
    ├── api.test.ts     # Mock REST client API tests (Vitest)
    ├── auth.ts         # Google OAuth 2.0 token management and session handling
    ├── main.ts         # SPA orchestration, OAuth flow, and hybrid scanner logic
    ├── style.css       # Clean, color-blind friendly modern CSS layout rules
    ├── types.ts        # Shared TypeScript interfaces for GCP resources and state
    ├── utils.ts        # Helper libraries for date parsing, version formatting, and clipboard copying
    ├── utils.test.ts   # Unit tests for core utilities and restriction evaluators
    ├── vite-env.d.ts   # Ambient TypeScript declarations for Vite environment variables
    └── vite.config.test.ts # Unit tests for Vite configuration factory
```

---

## 🛠️ Local Development & Configuration

To run or build the application locally, you **must explicitly define** the `VITE_GOOGLE_OAUTH_CLIENT_ID` environment variable containing a registered Google OAuth 2.0 Client ID.

### Environment Variables
* `VITE_GOOGLE_OAUTH_CLIENT_ID` (**Required**): Google OAuth 2.0 Client ID for GCP authentication.
* `VITE_APP_VERSION` (*Optional*): Custom version string (e.g. `v0.0.1+a1b2c3d`). Defaults to `v0.0.1` if omitted.

### 1. Using a `.env` File (Recommended)
Create a `.env` file in the project root directory:

```env
VITE_GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### 2. Available Development Commands
```bash
export VITE_GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"

# Run local development server
npm run dev

# Run Vitest unit tests
npm test

# Build production bundle to dist/
npm run build
```

---

## 🚀 Deployment & Versioning

### Path-Based Hosting
The application is configured with `base: '/api-keys/'` in `vite.config.ts` to support path-based reverse proxy hosting (e.g. `https://your-domain.com/api-keys/`).

### Hybrid Versioning & Traceability
The footer status bar displays the active application version using a hybrid format (`v<semver>+<commit-sha>`, e.g., `v0.0.1+a1b2c3d`).
* The commit SHA is rendered as a clickable link leading directly to the commit on GitHub for operational traceability.
* Pass `VITE_APP_VERSION` during CI/CD build steps to override the version string dynamically.

---

## 📋 Expectations & Pre-requisites

Before using this application, please ensure your environment and account meet the following operational expectations:

### 1. Supported Account Types
The application utilizes standard Google OAuth 2.0 User-Agent flow. You can sign in using:
*   A native **Google Cloud Identity** directory account (such as Google Workspace enterprise identities).
*   A standard, public **Gmail account** (`@gmail.com`).
*   An account from an **external Identity Provider (IdP)** (e.g., Okta, Ping, Azure AD) that is federated with Google Cloud via SAML or OIDC.

### 2. IAM Permissions & Role Requirements
The scanner cannot bypass Cloud IAM resource policies. To see keys:
*   **Project Visibility:** You will only discover keys in GCP projects that your authenticated identity has permissions to list via the Cloud Resource Manager API.
*   **Key Inspection Permissions:** You must have permissions equivalent to the **API Keys Viewer** (`roles/serviceusage.apiKeysViewer`) role on the targeted projects. Specifically, the identity needs `serviceusage.apiKeys.list` to fetch key metadata and check restrictions.

### 3. Service Enablement Constraints
*   The scanner relies on the API Keys API (`apikeys.googleapi.com`) to query keys.
*   At least **one** project in your accessible list **must have the API Keys API active**. Without at least one active project, the scanner cannot establish a `goodProjectId` to act as a billing anchor. In this rare scenario, the scan will gracefully complete with errors reporting that the API is disabled.

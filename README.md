# Google Cloud API Keys Finder

[![CI](https://github.com/minherz/api-keys-finder/actions/workflows/ci.yml/badge.svg)](https://github.com/minherz/api-keys-finder/actions/workflows/ci.yml)

An ultra-lightweight, high-performance Single Page Application (SPA) designed to audit and inspect active API keys across all accessible Google Cloud projects. Running entirely inside the browser with **zero backend dependencies**, it communicates directly with Google Cloud REST APIs to perform real-time security scanning, categorization, and restriction checks.

---

## 📂 Project Structure

```
/
├── .devcontainer/       # Dev container configuration for instant workspace setup
├── .gitignore          # Ignored files (including dependencies and local CLI skills)
├── index.html          # Main HTML5 entrypoint and layout structure for the SPA
├── package.json        # Project metadata, dev dependencies (Vite, TypeScript, Vitest)
├── package-lock.json   # Exact dependency resolution lockfile
├── skills-lock.json    # Version lockfile for Antigravity AI custom developer skills
├── tsconfig.json       # TypeScript compiler configuration
└── src/                # Core application source code
    ├── api.ts          # Direct GCP REST API handshakes, customized errors, and headers
    ├── api.test.ts     # Mock REST client API tests (Vitest)
    ├── main.ts         # SPA orchestration, OAuth flow, and hybrid scanner logic
    ├── style.css       # Clean, color-blind friendly modern CSS layout rules
    ├── types.ts        # Shared TypeScript interfaces for GCP resources and state
    ├── utils.ts        # Helper libraries for date parsing, URL hashing, and clipboard copying
    └── utils.test.ts   # Unit tests for core utilities and restriction evaluators
```

---

## 🛠️ Local Development & Configuration

To run or build the application locally, you **must explicitly define** the `VITE_GOOGLE_OAUTH_CLIENT_ID` environment variable containing a registered Google OAuth 2.0 Client ID.

### 1. Using a `.env` File (Recommended)
Create a `.env` file inside `web/api-keys/`:

```env
VITE_GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### 2. Exporting in Shell
```bash
export VITE_GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"

# Run development server
npm run dev

# Or run build
npm run build
```

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

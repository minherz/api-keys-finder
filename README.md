# GCP Security Toolbox

[![CI](https://github.com/minherz/gcp-security-toolbox/actions/workflows/test.yml/badge.svg)](https://github.com/minherz/gcp-security-toolbox/actions/workflows/test.yml)

A monorepo containing security tools and utilities for Google Cloud Platform (GCP). The applications in this repository are designed as lightweight, client-side web applications hosted on **Firebase Hosting**.

---

## 📂 Repository Structure

All web applications and tools reside under the `web/` directory:

```
gcp-security-toolbox/
├── .github/              # GitHub Actions CI/CD workflows
├── web/                  # Monorepo web applications and security tools
│   ├── api-keys/         # API Keys Finder (Audit & review GCP API key restrictions)
│   └── mindmap/          # Security Mindmap visualizer
├── LICENSE               # Apache-2.0 License
└── README.md             # Repository documentation
```

---

## 🛠️ Applications

| Application | Description | Path |
| :--- | :--- | :--- |
| **API Keys Finder** | Browser-based tool to scan, inspect, and review restriction levels of Google Cloud API keys across accessible projects. | [`web/api-keys`](web/api-keys/README.md) |
| **Security Mindmap** | Security visualizer and diagram tool for Google Cloud infrastructure. | `web/mindmap` |

---

## 🚀 Getting Started

Each application under `web/` is self-contained with its own dependencies and configuration.

### Running an Application Locally

1. Navigate to the desired application directory:
   ```bash
   cd web/api-keys
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the local development server:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   ```

5. Run unit tests:
   ```bash
   npm test
   ```

---

## 🌐 Hosting & Deployment

The applications in this monorepo are designed for static hosting on **Firebase Hosting**. Each tool operates purely client-side without requiring dedicated backend services, leveraging direct Google Cloud REST APIs and Google Identity Services (GIS) for authentication.

---

## 🔄 CI/CD

Continuous Integration is managed via GitHub Actions ([`.github/workflows/test.yml`](.github/workflows/test.yml)). On pushes to `main` or pull requests touching the `web/` directory, the workflow automatically discovers changed applications under `web/` and executes verification, builds, and test suites in parallel.

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).

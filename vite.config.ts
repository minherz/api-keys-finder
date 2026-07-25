import { defineConfig, loadEnv } from 'vite';
import pkg from './package.json';

declare const process: {
  cwd: () => string;
  env: Record<string, string | undefined>;
};

// Expected format: <project-number>-<hash>.apps.googleusercontent.com
const GOOGLE_OAUTH_CLIENT_ID_REGEX = /^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/;

export default defineConfig(({ mode }) => {
  // Load environment variables for the current mode
  const env = loadEnv(mode, process.cwd(), '');
  const clientId = env.VITE_GOOGLE_OAUTH_CLIENT_ID || process.env.VITE_GOOGLE_OAUTH_CLIENT_ID;

  // Validate existence
  if (!clientId) {
    throw new Error(
      '[Vite Build Error] VITE_GOOGLE_OAUTH_CLIENT_ID is not defined in environment variables or .env file.'
    );
  }

  // Validate format
  if (!GOOGLE_OAUTH_CLIENT_ID_REGEX.test(clientId)) {
    throw new Error(
      `[Vite Build Error] VITE_GOOGLE_OAUTH_CLIENT_ID has an invalid format: "${clientId}". ` +
      `Expected format: "<project-number>-<client-id>.apps.googleusercontent.com"`
    );
  }

  const appVersion = env.VITE_APP_VERSION || process.env.VITE_APP_VERSION || pkg.version;

  return {
    base: '/api-keys/',
    define: {
      'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
    },
  };
});

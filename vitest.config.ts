import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    'import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID': JSON.stringify(
      '1234567890-testclientid.apps.googleusercontent.com'
    ),
    'import.meta.env.APP_VERSION': JSON.stringify('v0.0.1-test'),
  },
});

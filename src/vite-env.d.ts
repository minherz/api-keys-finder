/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

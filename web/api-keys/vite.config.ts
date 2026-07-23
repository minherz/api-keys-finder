import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(pkg.version),
  },
});

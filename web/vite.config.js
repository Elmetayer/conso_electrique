import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base relative : fonctionne sur https://<user>.github.io/<repo>/ sans configuration
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        docs: resolve(import.meta.dirname, 'docs.html'),
      },
    },
  },
  test: { environment: 'node' },
});

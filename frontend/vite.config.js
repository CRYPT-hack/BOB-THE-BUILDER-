import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(frontendRoot, 'index.html'),
        city: resolve(frontendRoot, 'city.html'),
      },
    },
  },
  server: {
    // Honour the port the harness assigns; 3000 is only a local fallback.
    // Nothing here is tied to a fixed origin — the API is reached through the
    // proxy below, and the backend's CORS is open — so any port works.
    port: Number(process.env.PORT) || 3000,
    // Proxy API calls to the Express backend (which stays on 3001).
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});


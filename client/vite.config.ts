// Vite configuration for the React client.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In development the client runs on :5173 and the API on :3001 — two different
      // origins, which the browser would normally block as a cross-origin request.
      //
      // This proxy makes the dev server forward anything starting with /api to the API
      // server. As far as the browser is concerned every request goes to :5173, so it
      // is same-origin and there is no CORS involved at all. That is why this project
      // has no `cors` package: we removed the cross-origin situation instead of
      // permitting it.
      //
      // It also mirrors production, where one Express process serves both the API and
      // the built client from a single origin — so relative URLs like "/api/polls"
      // work unchanged in both environments.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Where `npm run build` puts the bundle. In production Express serves this folder.
    outDir: 'dist',
  },
});

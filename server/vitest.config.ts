// Vitest configuration. The only thing we need to set is the database path, and it has
// to be set BEFORE any test file imports db.ts, because db.ts opens the connection at
// import time. setupFiles run first, which is exactly the hook we need.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
  },
});

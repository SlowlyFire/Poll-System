// Production/development entry point: builds the app and starts listening.
// Kept separate from app.ts so that importing the app (in tests) never opens a port.

import { createApp } from './app.js';

// The host assigns the port in production via this environment variable; 3001 locally.
const PORT = Number(process.env.PORT) || 3001;

const app = createApp();

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});

// Entry point: builds the app and starts listening.
// Kept separate from app.ts so importing the app (in tests) never opens a port.

import { createApp } from './app.js';

// The platform assigns the port in production — Railway injects PORT and routes traffic
// to it. Hard-coding 3001 in production would mean the platform's router talks to a port
// nothing is listening on. 3001 is only the local fallback.
const PORT = Number(process.env.PORT) || 3001;

// "0.0.0.0" means "accept connections on every network interface". The default is
// localhost only, which is right on your laptop and fatal in a container: the proxy
// sits outside the container, so a server bound to localhost is unreachable and the
// deployment fails its health check with no obvious error.
const HOST = '0.0.0.0';

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

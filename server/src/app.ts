// Builds the Express app: middleware, API routes, the built client, error handling.
// It does NOT start listening on a port — index.ts does that.
//
// The split matters for testing: the tests import this app and hand it to supertest,
// which calls it directly in memory. No port to bind, no server to shut down, no chance
// of two test files fighting over :3001.

import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pollsRouter } from './routes/polls.js';
import { ApiError } from './errors.js';

// ES modules have no __dirname, so we rebuild it from this file's own URL. Paths must be
// resolved relative to the FILE, not to the working directory: in production this code
// runs from server/dist/, and the process could be started from anywhere.
const thisDir = path.dirname(fileURLToPath(import.meta.url));

// Where Vite puts the built client. From server/dist/ that is ../../client/dist.
const CLIENT_DIST = process.env.CLIENT_DIST || path.resolve(thisDir, '../../client/dist');

export function createApp() {
  const app = express();

  // Parses JSON request bodies into req.body. Without it req.body is undefined on POSTs.
  app.use(express.json());

  // Cheap "is the server alive" endpoint. Railway pings it to decide whether a new
  // deployment came up healthy before sending it traffic.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/polls', pollsRouter);

  // Any /api path that matched nothing above is a 404 in JSON. Without this, Express
  // would answer with its default HTML error page, and the client's res.json() would
  // choke trying to parse HTML.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // --- Serving the built client ---
  //
  // In production there is ONE process on ONE port serving both the API and the page.
  // That is why the client can fetch("/api/polls") with no hostname, and why there is no
  // CORS configuration anywhere in this project: same origin, no cross-origin request.
  //
  // Gated on the folder existing rather than on NODE_ENV: in development the client is
  // served by Vite on :5173 and this folder simply isn't there, so the check answers
  // both questions at once — and it can't be broken by a missing environment variable.
  if (fs.existsSync(CLIENT_DIST)) {
    // Serves index.html, the JS bundle, the CSS — anything that is a real file on disk.
    app.use(express.static(CLIENT_DIST));

    // The catch-all, and the reason it has to exist:
    //
    // React Router runs in the BROWSER. When you click a link to /poll/abc123 it never
    // touches the server — the router just swaps the component. But when someone opens
    // that share link cold, or hits refresh, the browser asks the SERVER for /poll/abc123.
    // There is no such file, so without this route the answer is 404 and the share link
    // — the whole feature — is broken on first load.
    //
    // So: hand back index.html for anything we didn't recognise. The browser boots React,
    // React Router reads the URL, and renders the right page.
    //
    // Order is everything. This must come AFTER the API routes, or it would swallow every
    // /api request and answer HTML. The /api 404 above is what keeps unknown API paths
    // from falling through to here.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  // Error handler. Express identifies it by its four arguments — remove `next` and it
  // silently becomes ordinary middleware that never runs. It must be registered last.
  //
  // Our route handlers are all synchronous (better-sqlite3 doesn't return promises), and
  // Express catches synchronous throws automatically. That is why the routes can just
  // `throw new ApiError(404, ...)` with no try/catch. If any handler became async we
  // would have to pass errors to next() by hand, or Express 4 would miss them entirely.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    // Anything else is unexpected: log it for us, send the client something generic.
    // Raw database errors must never reach the browser — they leak table and column
    // names, which is free reconnaissance for anyone probing the API.
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

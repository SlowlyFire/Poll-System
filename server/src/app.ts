// Builds the Express app: middleware, routes, error handling. It does NOT start
// listening on a port — index.ts does that.
//
// The split matters for testing: the tests import this app and hand it to supertest,
// which calls it directly in memory. No port to bind, no server to shut down, no chance
// of two test files fighting over :3001.

import express, { type NextFunction, type Request, type Response } from 'express';
import { pollsRouter } from './routes/polls.js';
import { ApiError } from './errors.js';

export function createApp() {
  const app = express();

  // Parses JSON request bodies into req.body. Without it req.body is undefined on POSTs.
  app.use(express.json());

  // Cheap "is the server alive" endpoint, used in development and by the host's health check.
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

  // Error handler. Express identifies it by its four arguments — remove `next` and it
  // silently becomes ordinary middleware that never runs. It must be registered last.
  //
  // Our route handlers are all synchronous (better-sqlite3 doesn't return promises),
  // and Express catches synchronous throws automatically. That is why the routes above
  // can just `throw new ApiError(404, ...)` with no try/catch. If any handler became
  // async we would have to pass errors to next() by hand, or Express 4 would miss them.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    // Anything else is unexpected: log it for us, but send the client a generic message.
    // Raw database errors must never reach the browser — they leak table and column
    // names, which is free reconnaissance for anyone probing the API.
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

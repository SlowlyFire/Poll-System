// Entry point for the API server: creates the Express app, mounts middleware and
// routes, and starts listening. Everything else lives in its own file.

import express from 'express';

// PORT comes from the environment in production (Railway injects it); 3001 locally.
// The client's dev server runs on 5173 and proxies /api here, so the two never clash.
const PORT = Number(process.env.PORT) || 3001;

const app = express();

// Parses incoming JSON request bodies into req.body. Without this, req.body is undefined
// on POST requests. Express has included this since v4.16, so no separate body-parser package.
app.use(express.json());

// Health check. Useful for two things: proving the server is up while developing, and
// giving the hosting platform a cheap endpoint to poll to see if the app is alive.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});

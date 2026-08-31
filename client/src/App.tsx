// Temporary placeholder app for session 0. Its only job right now is to prove that the
// client can reach the API server through the Vite dev proxy. Session 3 replaces this
// with the real router and pages.

import { useEffect, useState } from 'react';

export default function App() {
  const [status, setStatus] = useState<string>('checking...');

  useEffect(() => {
    // Note the relative URL. There is no hostname or port here on purpose: in dev the
    // Vite proxy forwards it to :3001, and in production Express serves both the page
    // and the API from the same origin. Same code path in both cases.
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.ok ? 'API reachable' : 'API responded, but not ok'))
      .catch(() => setStatus('API unreachable'));
  }, []); // empty dependency array = run once, after the first render

  return (
    <main>
      <h1>Poll System</h1>
      <p>Server status: {status}</p>
    </main>
  );
}

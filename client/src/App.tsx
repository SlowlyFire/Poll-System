// Defines the app's three routes. Everything else is a page.

import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import HomePage from './pages/HomePage';
import CreatePollPage from './pages/CreatePollPage';
import PollPage from './pages/PollPage';

export default function App() {
  return (
    // BrowserRouter uses real URLs (/poll/abc123) via the browser's History API, rather
    // than hash URLs (/#/poll/abc123). Real URLs are what make a poll link look like a
    // normal link — but they come with a cost: the browser will ask the SERVER for
    // /poll/abc123 on a refresh or a cold open, and that path is not a real file. In
    // production Express has a catch-all that returns index.html for any non-/api path,
    // which hands the URL back to React Router. In dev, Vite does the same thing.
    <BrowserRouter>
      <header className="header">
        <Link to="/" className="header__title">
          Poll System
        </Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/create" element={<CreatePollPage />} />
          {/* :id is a URL parameter — PollPage reads it with useParams(). This one route
              definition serves every poll that will ever exist. */}
          <Route path="/poll/:id" element={<PollPage />} />
          {/* Anything else. Without this, an unknown URL renders a blank page. */}
          <Route path="*" element={<p className="card">Page not found.</p>} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

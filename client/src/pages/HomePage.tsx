// The list of every poll, with a link into each one.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listPolls } from '../api';
import type { PollSummary } from '../types';

export default function HomePage() {
  const [polls, setPolls] = useState<PollSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // In useCallback so the retry button and the effect below can share one function
  // without the effect re-running on every render.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPolls(await listPolls());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The empty dependency array means this runs once, after the first render. Fetching
    // during render instead would fire on every re-render, in a loop.
    load();
  }, [load]);

  // Three states, and all three have to be handled explicitly: still loading, failed,
  // and loaded. Skipping the first two is how a page ends up rendering a blank screen
  // when the network is slow or the server is down.
  if (loading) return <p className="muted">Loading polls…</p>;

  if (error) {
    return (
      <div className="card">
        <p className="error">Couldn&apos;t load polls: {error}</p>
        {/* A retry beats telling the user to refresh: the failure is usually transient,
            and re-running one fetch is cheaper than reloading the whole app. */}
        <button className="button" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="row-between">
        <h1>Polls</h1>
        <Link className="button" to="/create">
          New poll
        </Link>
      </div>

      {polls.length === 0 ? (
        // Empty is not an error — a brand new install has no polls, and the page should
        // say so and point at the next step rather than showing nothing at all.
        <div className="card empty">
          <p>No polls yet.</p>
          <Link className="button button--primary" to="/create">
            Create the first one
          </Link>
        </div>
      ) : (
        polls.map((poll) => (
          // key lets React tell list items apart between renders, so it updates the one
          // that changed instead of rebuilding the list. The poll id is a natural key:
          // stable and unique. An array index would break as soon as the order changes.
          <Link key={poll.id} to={`/poll/${poll.id}`} className="card card--link">
            <h2 className="card__title">{poll.question}</h2>
            <p className="muted">
              by {poll.createdBy} · {poll.optionCount} options · {poll.totalVotes}{' '}
              {poll.totalVotes === 1 ? 'vote' : 'votes'}
            </p>
          </Link>
        ))
      )}
    </>
  );
}

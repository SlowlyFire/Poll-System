// The list of every poll, with a link into each one.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listPolls } from '../api';
import type { PollSummary } from '../types';

export default function HomePage() {
  const [polls, setPolls] = useState<PollSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The empty dependency array below means this runs once, after the first render.
    // Fetching during render instead would fire on every re-render, in a loop.
    listPolls()
      .then(setPolls)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading polls...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="row-between">
        <h1>Polls</h1>
        <Link className="button" to="/create">
          New poll
        </Link>
      </div>

      {polls.length === 0 ? (
        <p className="muted">No polls yet. Create the first one.</p>
      ) : (
        polls.map((poll) => (
          // key lets React tell list items apart between renders, so it can update the
          // changed one instead of rebuilding the whole list. The poll id is a natural
          // key: stable and unique. An array index would break the moment order changes.
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

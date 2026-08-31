// One poll: vote on it, or see the results if you already have.
// This is the page the share link points at, so it has to work for a stranger who
// arrives with no history in the app at all.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { castVote, getPoll } from '../api';
import { useUsername } from '../hooks/useUsername';
import UsernameGate from '../components/UsernameGate';
import ResultBar from '../components/ResultBar';
import type { PollDetail } from '../types';

export default function PollPage() {
  // Reads the :id segment from the URL defined in App.tsx.
  const { id } = useParams<{ id: string }>();
  const { username, setUsername } = useUsername();

  const [poll, setPoll] = useState<PollDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Wrapped in useCallback so the function identity is stable, which lets us list it in
  // the useEffect dependency array below without the effect re-running on every render.
  const load = useCallback(async () => {
    if (!id) return;
    try {
      setPoll(await getPoll(id, username));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, username]);

  // Re-runs whenever `load` changes, i.e. when the poll id or the username changes.
  // The username matters: entering a name has to refetch, because whether this person
  // has already voted is decided by the server, not remembered in the browser.
  useEffect(() => {
    load();
  }, [load]);

  async function handleVote(optionId: number): Promise<void> {
    if (!id) return;
    setVoting(true);
    setError(null);
    try {
      await castVote(id, username, optionId);
      await load(); // refetch so the counts come from the database, not from a guess
    } catch (err) {
      const status = (err as { status?: number }).status;
      // 409 means this username already voted — most likely in another tab, or by
      // double-clicking. It is not really a failure: show the message, then reload so
      // the page switches to the results view instead of sitting on a dead screen.
      if (status === 409) await load();
      setError((err as Error).message);
    } finally {
      setVoting(false);
    }
  }

  function copyLink(): void {
    // window.location.href IS the share link — the poll page and its URL are the same
    // thing. There is no separate "generate link" step or shortlink table to maintain.
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) return <p className="muted">Loading poll...</p>;
  if (!poll) return <p className="error">{error ?? 'Poll not found.'}</p>;

  // The server decides this, from the votes table — so it survives a refresh, a new
  // device, or clearing the page state, unlike a flag kept only in React.
  const hasVoted = poll.yourVote !== null;

  return (
    <>
      <h1>{poll.question}</h1>
      <p className="muted">
        Created by {poll.createdBy} · {poll.totalVotes} {poll.totalVotes === 1 ? 'vote' : 'votes'}
      </p>

      {/* Anyone can READ a poll without giving a name. The gate only appears when they
          try to take part — asking a stranger to identify themselves just to look would
          be friction for nothing. */}
      {!username ? (
        <UsernameGate purpose="record your vote" onSubmit={setUsername} />
      ) : hasVoted ? (
        <div className="card">
          {poll.options.map((option) => (
            <ResultBar
              key={option.id}
              text={option.text}
              voteCount={option.voteCount}
              totalVotes={poll.totalVotes}
              isYourVote={option.id === poll.yourVote}
            />
          ))}
        </div>
      ) : (
        <div className="card">
          <p className="muted">Voting as {username}. You can only vote once.</p>
          {poll.options.map((option) => (
            <button
              key={option.id}
              className="option-button"
              onClick={() => handleVote(option.id)}
              // Disabled during the request so an impatient double-click cannot fire two
              // votes. The UNIQUE constraint in the database is the real guarantee —
              // this is only here to stop the second request being sent at all.
              disabled={voting}
            >
              {option.text}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <button className="button button--ghost" onClick={copyLink}>
        {copied ? 'Link copied' : 'Copy share link'}
      </button>
    </>
  );
}

// One poll: vote on it, or see the results if you already have.
// This is the page the share link points at, so it has to work for a stranger who
// arrives with no history in the app at all — including when the link is wrong.

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { castVote, getPoll } from '../api';
import { useUsername } from '../hooks/useUsername';
import UsernameGate from '../components/UsernameGate';
import ResultBar from '../components/ResultBar';
import type { PollDetail } from '../types';

export default function PollPage() {
  // Reads the :id segment from the route defined in App.tsx.
  const { id } = useParams<{ id: string }>();
  const { username, setUsername } = useUsername();

  const [poll, setPoll] = useState<PollDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept separately from the message because a 404 is a different situation from a
  // network failure: one means "this poll does not exist", the other means "try again".
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [copied, setCopied] = useState(false);

  // useCallback keeps this function's identity stable, so listing it in the effect's
  // dependency array below doesn't cause the effect to re-run on every render.
  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    setErrorStatus(null);
    try {
      setPoll(await getPoll(id, username));
    } catch (err) {
      setError((err as Error).message);
      setErrorStatus((err as { status?: number }).status ?? null);
    } finally {
      setLoading(false);
    }
  }, [id, username]);

  // Re-runs when the poll id or the username changes. The username matters: entering a
  // name has to refetch, because whether this person already voted is decided by the
  // server, not remembered in the browser.
  useEffect(() => {
    load();
  }, [load]);

  async function handleVote(optionId: number): Promise<void> {
    if (!id) return;
    setVoting(true);
    setError(null);
    try {
      await castVote(id, username, optionId);
      await load(); // refetch, so the counts come from the database rather than a guess
    } catch (err) {
      const status = (err as { status?: number }).status;
      // 409 means this username has already voted — most likely in another tab, or from
      // a double-click that beat the disabled button. It is not really a failure: reload
      // so the page flips to the results view instead of sitting on a dead screen, and
      // still show the message so the user understands why their click did nothing.
      if (status === 409) {
        await load();
        setError('You have already voted in this poll.');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setVoting(false);
    }
  }

  function copyLink(): void {
    // window.location.href IS the share link — the poll page and its URL are the same
    // thing. No "generate link" step, no shortlink table to keep.
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      // The clipboard API can be blocked (an insecure origin, or a browser permission),
      // and an unhandled rejection here would leave the button silently doing nothing.
      .catch(() => setError('Could not copy the link — you can copy it from the address bar.'));
  }

  if (loading) return <p className="muted">Loading poll…</p>;

  // A wrong or deleted id is an ordinary thing to happen to a shared link, so it gets a
  // real screen with a way out — not a raw error string and a dead end.
  if (errorStatus === 404) {
    return (
      <div className="card empty">
        <h1>Poll not found</h1>
        <p className="muted">This link may be wrong, or the poll may have been removed.</p>
        <Link className="button button--primary" to="/">
          Back to all polls
        </Link>
      </div>
    );
  }

  // Any other failure to load: probably the network or the server, so offer a retry.
  if (!poll) {
    return (
      <div className="card">
        <p className="error">Couldn&apos;t load this poll: {error}</p>
        <button className="button" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  // The server decides this, from the votes table — so it survives a refresh, a new
  // device, or cleared page state, unlike a flag kept only in React.
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
              // Disabled during the request so an impatient double-click cannot send two
              // votes. The UNIQUE constraint in the database is the real guarantee; this
              // only stops the second request from being sent at all.
              disabled={voting}
            >
              {option.text}
            </button>
          ))}
        </div>
      )}

      {/* aria-live tells a screen reader to announce this when it appears, instead of
          the user never finding out their vote was rejected. */}
      {error && (
        <p className="error" role="status" aria-live="polite">
          {error}
        </p>
      )}

      <button className="button button--ghost" onClick={copyLink}>
        {copied ? 'Link copied' : 'Copy share link'}
      </button>
    </>
  );
}

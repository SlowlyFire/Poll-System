// The form for creating a poll: a question plus 2 to 8 options.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPoll } from '../api';
import { useUsername } from '../hooks/useUsername';
import UsernameGate from '../components/UsernameGate';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

export default function CreatePollPage() {
  const navigate = useNavigate();
  const { username, setUsername } = useUsername();

  const [question, setQuestion] = useState('');
  // The options are one piece of state: an array of strings. The inputs below are
  // "controlled" — React holds the value and the input just displays it — so this array
  // is always the single source of truth for what the user typed.
  const [options, setOptions] = useState<string[]>(['', '']);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!username) return <UsernameGate purpose="credit you as the creator" onSubmit={setUsername} />;

  function updateOption(index: number, value: string): void {
    // Build a NEW array instead of mutating the existing one. React compares state by
    // reference to decide whether to re-render; options[i] = value keeps the same array
    // object, so React would see no change and the screen would not update.
    setOptions((current) => current.map((option, i) => (i === index ? value : option)));
  }

  function addOption(): void {
    setOptions((current) => [...current, '']);
  }

  function removeOption(index: number): void {
    setOptions((current) => current.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const cleaned = options.map((option) => option.trim()).filter(Boolean);

    // The same rules the server enforces, checked here too. This is not redundant: the
    // client version gives instant feedback without a round trip. The server version is
    // the one that actually protects the data, because anyone can bypass this page.
    if (!question.trim()) return setError('Please write a question.');
    if (cleaned.length < MIN_OPTIONS) return setError(`Please fill in at least ${MIN_OPTIONS} options.`);
    if (new Set(cleaned.map((o) => o.toLowerCase())).size !== cleaned.length) {
      return setError('Options must be different from each other.');
    }

    setSubmitting(true);
    try {
      const { id } = await createPoll({ question: question.trim(), createdBy: username, options: cleaned });
      // Straight to the new poll — which is also its share link.
      navigate(`/poll/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false); // only on failure; on success we navigate away
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>New poll</h1>

      <label className="label" htmlFor="question">Question</label>
      <input
        id="question"
        className="input"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="What should we order for lunch?"
        maxLength={200}
      />

      <label className="label">Options</label>
      {options.map((option, index) => (
        // The key here is the index, which is normally a mistake — but these inputs have
        // no id of their own until the poll is saved, and removing one re-labels the rest
        // by design. Worth knowing it is a deliberate exception, not an oversight.
        <div className="option-row" key={index}>
          <input
            className="input"
            value={option}
            onChange={(event) => updateOption(index, event.target.value)}
            placeholder={`Option ${index + 1}`}
            maxLength={100}
          />
          <button
            type="button"
            className="button button--ghost"
            onClick={() => removeOption(index)}
            // Never let the user drop below the minimum the server would reject anyway.
            disabled={options.length <= MIN_OPTIONS}
            aria-label={`Remove option ${index + 1}`}
          >
            ×
          </button>
        </div>
      ))}

      {options.length < MAX_OPTIONS && (
        <button type="button" className="button button--ghost" onClick={addOption}>
          + Add option
        </button>
      )}

      {error && <p className="error">{error}</p>}

      {/* Disabled while the request is in flight so a double-click cannot create two polls. */}
      <button className="button button--primary" type="submit" disabled={submitting}>
        {submitting ? 'Creating...' : 'Create poll'}
      </button>
    </form>
  );
}

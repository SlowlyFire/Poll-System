// Asks for a name before the visitor can create a poll or vote. Shown by any page that
// needs to know who the user is, when useUsername() comes back empty.

import { useState } from 'react';

interface Props {
  /** What the name is needed for, e.g. "vote" — used in the prompt text. */
  purpose: string;
  onSubmit: (username: string) => void;
}

export default function UsernameGate({ purpose, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();

  return (
    <div className="card">
      <h2>What&apos;s your name?</h2>
      <p className="muted">
        We use it to {purpose} and to make sure nobody votes twice. No account needed.
      </p>
      {/* A <form> rather than a button with onClick, so pressing Enter also submits
          and the browser announces it correctly to screen readers. */}
      <form
        onSubmit={(event) => {
          event.preventDefault(); // stop the browser reloading the page, the default for a form
          if (trimmed) onSubmit(trimmed);
        }}
      >
        <input
          className="input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="e.g. gal"
          maxLength={30}
          autoFocus
        />
        <button className="button" type="submit" disabled={!trimmed}>
          Continue
        </button>
      </form>
    </div>
  );
}

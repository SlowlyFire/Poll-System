// Remembers who the visitor says they are, in localStorage.
//
// This is identity WITHOUT authentication, which the spec explicitly allows. Be clear
// about what that means: nothing stops someone typing a different name and voting again,
// or opening a private window. The username is a convenience, not a security control.
//
// What real auth would change: the client would send a session cookie or a JWT instead
// of a name, the server would derive the user from it rather than trusting the body, and
// votes.username would become a user_id foreign key. The schema shape barely moves — the
// duplicate-vote constraint would just be UNIQUE(poll_id, user_id) instead.

import { useState } from 'react';

const STORAGE_KEY = 'poll-username';

export function useUsername() {
  // The initial value is read from localStorage via a function passed to useState.
  // Passing a function means React only runs it on the first render, instead of hitting
  // localStorage on every single render and throwing the result away.
  const [username, setUsernameState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  });

  function setUsername(next: string): void {
    // Normalise once, here, so every part of the app sends the same string. Without the
    // trim, " gal" and "gal" would be two different voters as far as the UNIQUE
    // constraint is concerned, and one person could vote twice by adding a space.
    const cleaned = next.trim();
    localStorage.setItem(STORAGE_KEY, cleaned);
    setUsernameState(cleaned);
  }

  return { username, setUsername };
}

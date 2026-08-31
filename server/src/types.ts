// The shapes of our data. Two groups, and the distinction matters:
//   - "Row" types  = exactly what a table looks like (snake_case, like the SQL).
//   - API types    = what we send to the browser (camelCase, JavaScript convention).
// Keeping them separate means renaming a column doesn't silently change the public API.

// --- Database row types (snake_case, mirroring the columns in db.ts) ---

export interface PollRow {
  id: string;
  question: string;
  created_by: string;
  created_at: string;
}

export interface PollOptionRow {
  id: number;
  poll_id: string;
  text: string;
  position: number;
}

// --- API response types (camelCase, what the client actually receives) ---

/** One option plus how many votes it has. Counts are computed at read time, never stored. */
export interface OptionWithCount {
  id: number;
  text: string;
  voteCount: number;
}

/** A poll in the list on the home page — enough to render a card, no per-option detail. */
export interface PollSummary {
  id: string;
  question: string;
  createdBy: string;
  createdAt: string;
  optionCount: number;
  totalVotes: number;
}

/** A single poll with full results. This is what the poll page renders. */
export interface PollDetail {
  id: string;
  question: string;
  createdBy: string;
  createdAt: string;
  options: OptionWithCount[];
  totalVotes: number;
  // The option id this username picked, or null if they haven't voted yet.
  // The server decides this, not the client, so refreshing or opening the link on
  // another device shows the same thing. Note there are no percentages here:
  // counts are the fact, percentages are presentation, so the client computes those.
  yourVote: number | null;
}

// Owns the SQLite connection and creates the schema. Every other file imports `db`
// from here — there is exactly one connection for the whole process.

import Database from 'better-sqlite3';

// Where the database file lives. In production (Railway) this points at a mounted
// volume so the file survives redeploys; locally it is just a file in the server folder.
// SQLite is a single file — no server process, no connection string, no docker.
const DB_PATH = process.env.DB_PATH || 'poll.db';

// better-sqlite3 is SYNCHRONOUS: `db.prepare(...).get()` returns the row directly
// instead of a Promise. That looks wrong if you're used to async database drivers,
// but SQLite reads a local file — a query here takes microseconds, not the milliseconds
// a network round-trip to Postgres would. Blocking the event loop for microseconds is
// cheaper than the overhead of making it async. This would NOT be acceptable for a
// database over the network, or for very long-running queries.
export const db = new Database(DB_PATH);

// --- Pragmas: SQLite settings that must be set on every connection ---

// SQLite ignores FOREIGN KEY constraints unless you turn them on. It is OFF by default
// for backwards compatibility with old databases. Without this line our REFERENCES
// clauses below would be documentation only — they would never actually be enforced.
db.pragma('foreign_keys = ON');

// Write-Ahead Logging. By default SQLite locks the whole database during a write, so
// readers block. In WAL mode writers append to a separate log file, which lets readers
// keep reading while a write is in progress. For a poll app where many people read
// results while a few write votes, this is the right trade-off.
db.pragma('journal_mode = WAL');

// --- Schema ---
// `IF NOT EXISTS` means this is safe to run on every startup: first boot creates the
// tables, later boots do nothing. For a project this size that beats a migration tool;
// a real app with evolving schemas would use migrations so changes are versioned.

db.exec(`
  -- One row per poll. The id is a nanoid string, not an auto-incrementing integer,
  -- because this id IS the public share link (/poll/V1StGXR8_Z). Sequential integers
  -- would let anyone walk /poll/1, /poll/2, /poll/3 and read every poll ever created.
  CREATE TABLE IF NOT EXISTS polls (
    id          TEXT PRIMARY KEY,
    question    TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    -- SQLite has no date/time type. We store an ISO 8601 string ("2026-08-31T18:00:00.000Z")
    -- because it sorts correctly as plain text and parses directly into a JS Date.
    created_at  TEXT NOT NULL
  );

  -- The answer choices for a poll. Between 2 and 8 of them (enforced in the API layer,
  -- since SQLite cannot easily express "this parent must have 2-8 children").
  CREATE TABLE IF NOT EXISTS poll_options (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id  TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    text     TEXT NOT NULL,
    -- Preserves the order the creator typed the options in. Without this, "ORDER BY id"
    -- happens to work today but is not something the schema actually promises.
    position INTEGER NOT NULL
  );

  -- One row per vote cast.
  CREATE TABLE IF NOT EXISTS votes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    -- poll_id is technically redundant: option_id already tells us which poll this is.
    -- We store it anyway for two reasons, and it is a deliberate, mild denormalization:
    --   1. It makes the UNIQUE constraint below possible at all — a unique index can only
    --      span columns in this table.
    --   2. Counting a poll's votes becomes a single-table lookup instead of a join.
    -- The cost: poll_id and option_id could theoretically disagree, so the API layer
    -- verifies the option belongs to the poll before inserting.
    poll_id    TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id  INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    username   TEXT NOT NULL,
    created_at TEXT NOT NULL,

    -- ============================================================================
    -- THIS LINE IS THE ENTIRE "no duplicate voting" FEATURE.
    -- One row per (poll, username) — a second insert for the same pair fails.
    --
    -- Why here and not in JavaScript? The obvious alternative is:
    --     const existing = SELECT ... WHERE poll_id = ? AND username = ?
    --     if (existing) return 409;
    --     INSERT ...
    -- That is a race condition. Two requests from the same user can both run the
    -- SELECT before either runs the INSERT, both see "no vote yet", and both insert.
    -- The window is small but real — a double-click is enough.
    --
    -- A UNIQUE constraint is checked by the database at write time, atomically. There
    -- is no window. The second insert throws SQLITE_CONSTRAINT_UNIQUE and the API
    -- turns that into a 409. We let the database say no instead of asking it politely.
    -- ============================================================================
    UNIQUE (poll_id, username)
  );

  -- Speeds up "how many votes does this poll have" and "has this user voted", both of
  -- which filter by poll_id. Without an index SQLite scans every row in votes; with it,
  -- it jumps straight to the rows for one poll. (The UNIQUE constraint above also creates
  -- an index on (poll_id, username), which covers poll_id lookups too — this explicit one
  -- documents the intent and stays correct if the constraint ever changes.)
  CREATE INDEX IF NOT EXISTS idx_votes_poll_id ON votes(poll_id);

  -- Speeds up counting votes per option, which is the main results query.
  CREATE INDEX IF NOT EXISTS idx_votes_option_id ON votes(option_id);
`);

// Current time as an ISO string. One helper so every table stores timestamps the
// same way, instead of each insert site deciding for itself.
export function nowIso(): string {
  return new Date().toISOString();
}

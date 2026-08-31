// Runs before any test file is imported.
//
// ":memory:" is a special SQLite path meaning "keep this database in RAM". The tests get
// a real database with real constraints — the UNIQUE rule and the foreign keys genuinely
// fire — but it never touches the disk and disappears when the process exits. No test
// file can leave state behind for the next one, and nobody's poll.db gets clobbered.
process.env.DB_PATH = ':memory:';

# Poll System

A small polling app in the spirit of WhatsApp polls: anyone can create a poll with 2–8
options, share it as a link, and vote once. Results show live counts, percentages and a
total. There is no sign-up — a voter just types a name.

Live: _(add your Railway URL here)_

---

## Architecture

```
  Browser
    │  React 18 + TypeScript, built by Vite
    │  React Router owns the URL: / · /create · /poll/:id
    │
    │  fetch("/api/polls")        ← relative URL, no hostname
    ▼
  Express (TypeScript)
    │  dev:  Vite dev server on :5173 proxies /api → :3001
    │  prod: ONE process serves the API *and* the built client on one port
    │
    │  raw SQL, no ORM
    ▼
  SQLite  (better-sqlite3, synchronous)
     single file on disk — on Railway, a mounted volume at /data
```

One process in production is the load-bearing decision. Because the page and the API come
from the same origin, the client can use relative URLs, there is **no CORS configuration
anywhere in this project**, and there is no `VITE_API_URL` to keep in sync per environment.

## Database schema

Three tables, normalised. Vote counts are never stored — they are computed on read.

```sql
polls (
  id          TEXT PRIMARY KEY,   -- nanoid; this id IS the public share link
  question    TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL       -- ISO string; SQLite has no date type
)

poll_options (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id  TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  text     TEXT NOT NULL,
  position INTEGER NOT NULL       -- preserves the order the creator typed them
)

votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id    TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id  INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  username   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (poll_id, username)      -- the entire "no duplicate voting" feature
)

CREATE INDEX idx_votes_poll_id   ON votes(poll_id);
CREATE INDEX idx_votes_option_id ON votes(option_id);
```

| Element | Why it exists |
|---|---|
| `UNIQUE(poll_id, username)` | Prevents duplicate voting **in the database**, atomically. An `if (alreadyVoted)` check in JavaScript is a race: two concurrent requests can both pass it before either inserts. |
| `poll_id` on `votes` | Technically implied by `option_id`. Stored anyway because a unique index can only span columns of one table — without it the constraint above is impossible. A deliberate, mild denormalisation; the API verifies the option belongs to the poll to keep the two consistent. |
| `ON DELETE CASCADE` | Deleting a poll removes its options and votes. Only enforced because `db.ts` sets `PRAGMA foreign_keys = ON` — SQLite ignores foreign keys by default. |
| `position` | Without it, `ORDER BY id` happens to work but is not something the schema promises. |
| Two indexes | Counting votes filters by `poll_id` and groups by `option_id`. Without them SQLite scans the whole votes table. |
| `PRAGMA journal_mode = WAL` | Default SQLite locks the database during a write, blocking readers. WAL lets reads continue during a write — right for a poll app where many read and few write. |

## API

| Method | Path | Returns | Codes |
|---|---|---|---|
| `GET` | `/api/health` | `{ ok: true }` | 200 |
| `GET` | `/api/polls` | list with `optionCount`, `totalVotes` | 200 |
| `POST` | `/api/polls` | `{ id }` | **201** · 400 |
| `GET` | `/api/polls/:id?username=` | poll + per-option counts + `yourVote` | 200 · 404 |
| `POST` | `/api/polls/:id/vote` | `{ ok: true }` | **201** · 400 · 404 · **409** |

Errors always come back as `{ "error": "..." }`, including for unknown `/api` paths —
never Express's default HTML page, which would break `res.json()` on the client.

- **400** the input is wrong (bad body, or an option from a different poll)
- **404** no poll with that id
- **409** well-formed request that conflicts with existing state — this username already voted

## The lifecycle of one vote

```
1. PollPage.tsx        user clicks an option → handleVote(optionId)
                       button disabled immediately (stops a double-submit)
2. api.ts              castVote() → POST /api/polls/:id/vote  {username, optionId}
                       one fetch wrapper: throws on non-2xx, attaches res.status
3. (transport)         dev: Vite proxy :5173 → :3001 · prod: same origin, same process
4. app.ts              express.json() parses the body → router
5. routes/polls.ts     voteSchema.safeParse()          → 400
                       SELECT 1 FROM polls             → 404
                       SELECT 1 FROM poll_options
                         WHERE id=? AND poll_id=?      → 400
                       INSERT INTO votes …
6. db.ts / SQLite      UNIQUE(poll_id, username) fires on a repeat
7. routes/polls.ts     catch SQLITE_CONSTRAINT_UNIQUE  → 409
8. app.ts              error middleware → { error: message }
9. PollPage.tsx        on success: load() refetches, so counts come from the database
                       rather than a local guess
10. ResultBar.tsx      percentage computed here: count / total, guarded against 0/0
```

## Design decisions and trade-offs

**1. SQLite instead of Postgres.** One file, no server, no container, no connection string;
the whole database is inspectable with the `sqlite3` CLI. It is a real SQL database with
real constraints and transactions, which is all this app needs. *At scale:* the ceiling is
one writer at a time and one machine — move to Postgres when you need concurrent writers or
more than one instance.

**2. Duplicate voting enforced by a constraint, not an if-statement.** `UNIQUE(poll_id,
username)` is checked atomically at write time. The vote route doesn't check first — it
inserts and catches `SQLITE_CONSTRAINT_UNIQUE`. *At scale:* unchanged. This is the same
answer at any size.

**3. Counts computed on read, never stored.** `LEFT JOIN votes … GROUP BY option_id` on
every read. One source of truth, nothing to drift. *At scale:* with 100k votes on one poll
this query gets expensive — that is when you add a `vote_count` column updated in the same
transaction as the insert, or a cache. Denormalisation is a performance fix to reach for
when you have the problem, not before.

**4. `nanoid` ids instead of auto-increment.** The poll id is the public share link.
Sequential integers let anyone walk `/poll/1`, `/poll/2` and read every poll ever created.
*At scale:* unchanged, though a real product would add access control on top.

**5. Poll and options created in one transaction.** A poll with zero options is invalid
state that nothing in the app knows how to render. All-or-nothing. *At scale:* unchanged.

**6. Identity without authentication.** A username in `localStorage`, sent in the request
body. The spec allows it; it is trivially spoofable. *At scale:* a session cookie or JWT,
the server derives the user from it instead of trusting the body, and `votes.username`
becomes a `user_id` foreign key. The constraint becomes `UNIQUE(poll_id, user_id)` — **the
schema shape does not change.**

**7. Usernames normalised to lowercase, server-side.** Otherwise pressing Shift is a
one-keystroke way to vote twice. *Cost:* we no longer remember how someone capitalised their
own name. *At scale:* store the name as typed plus a normalised column, and enforce
uniqueness on the normalised one.

**8. No state management library.** No state is shared across routes; each page owns its own
fetch. *At scale:* React Query before Redux — this is server state, not client state, and
the real wins are caching, deduplication and background refetching, not a global store.

**9. One Express process serves both API and client.** No second deployment, no CORS, no
per-environment API URL. *At scale:* put the client on a CDN and the API behind its own
domain — at which point CORS becomes a real thing you configure on purpose.

**10. Integration tests, not unit tests.** 22 tests drive the real Express app through
supertest against an in-memory SQLite database. The interesting behaviour lives in the SQL
and the constraints; a unit test with a mocked database would be testing the mock.

## Running it

```bash
npm install
npm test        # 22 integration tests
npm run seed    # sample polls — destructive, wipes existing data
npm run dev     # client :5173, server :3001
```

Production build, as it runs on Railway:

```bash
npm run build   # vite build + tsc
npm start       # one process, serves API and client
```

`better-sqlite3` is a native module, so `node_modules` is platform-specific — after moving
the project between machines, `rm -rf node_modules && npm install`.

## Deployment

Railway, one service, deployed from `main`. Express serves the built client; a volume
mounted at `/data` holds the SQLite file, and `DB_PATH=/data/poll.db` points at it. Without
that volume the container filesystem is ephemeral and every redeploy silently wipes the
data. See **DEPLOY.md** for the full walkthrough, including the Node-version gotcha that
broke the first build.

Known limit: a volume attaches to one instance, so this service cannot scale horizontally —
two containers cannot share one SQLite file.

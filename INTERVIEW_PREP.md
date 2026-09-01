# Interview prep — Poll System

21 questions, grouped. Each answer is written the length you would actually **say it**:
3–5 sentences, then stop and let them ask the follow-up. Every answer is based on code that
is really in this repo — the file names and queries are real, so you can open them.

Two rules for the room:
1. **Name the alternative you rejected.** "I did X" is a fact; "I did X instead of Y because Z"
   is engineering judgement, and it is what they are grading.
2. **Volunteer the limits.** Saying "this breaks when…" before they ask reads as confidence.

---

## Database (5)

### 1. Why SQLite and not Postgres or MongoDB?

The data is relational — polls have options, options have votes — so a relational database
is the honest fit; the duplicate-vote rule is a unique constraint across two columns, which
is exactly what SQL is good at. I picked SQLite because it is a single file: no server, no
container, no connection string, and I can inspect the whole thing with the `sqlite3` CLI.
It is still real SQL with real transactions and real constraint enforcement, so nothing
about the design is a toy. The ceiling is one writer at a time and one machine, and when I
need concurrent writers or a second instance, that is the moment to move to Postgres.

> *Follow-up:* "When exactly would you switch?" → When you need more than one app instance,
> because a volume attaches to one container and two containers can't share a SQLite file.

### 2. How do you stop someone voting twice?

One line in the schema: `UNIQUE(poll_id, username)` on the votes table. The vote endpoint
does **not** check whether the user already voted — it just inserts, and catches the
`SQLITE_CONSTRAINT_UNIQUE` error, which it turns into a 409. The obvious alternative is
`SELECT` to see if a vote exists and then `INSERT` if not, and that is a race condition:
two concurrent requests can both run the SELECT before either runs the INSERT, both see
nothing, and both insert. The constraint is checked by the database atomically at write
time, so there is no window at all.

> *Follow-up:* "Is a double-click really that likely?" → The window is milliseconds, but a
> double-click or two open tabs is enough — and a correctness bug I can't reproduce is worse
> than one I can.

### 3. Two people vote at exactly the same millisecond. What happens?

Two different people are not a conflict — different usernames, so both inserts satisfy the
constraint and both succeed. If it is the *same* username twice, SQLite serialises the two
writes and the second one fails the unique check; my catch block turns that into a 409, and
the client reloads into the results view. SQLite allows one writer at a time, so the second
write waits rather than interleaving. In WAL mode readers aren't blocked while that happens,
so people looking at results never see a partial state.

> *Follow-up:* "What if writes queue up?" → SQLite serialises them, so under heavy write
> load you'd see latency, then `SQLITE_BUSY`. That's the pressure that pushes you to Postgres.

### 4. Why compute vote counts instead of storing a counter?

Counts are derived data, so I compute them on read with a `LEFT JOIN … GROUP BY` in
`routes/polls.ts`. Storing a `vote_count` column means the same fact lives in two places,
and any bug or crash between the insert and the increment leaves them disagreeing — with a
join, the count cannot be wrong by construction. The trade-off is that every read does
aggregation work instead of a single column lookup. At a scale where that hurts, I'd add a
counter updated **in the same transaction** as the vote insert, so they can't drift.

> *Follow-up:* "At what point would you denormalise?" → When reads are actually slow — say
> 100k votes on one poll. Denormalisation is a fix for a measured problem, not a default.

### 5. Walk me through your schema. Why is `poll_id` on the votes table when `option_id` already implies it?

Three tables: polls, poll_options, votes. `poll_id` on votes is redundant in pure
normalisation terms, and I put it there deliberately for one reason: a unique index can only
span columns of a single table, so `UNIQUE(poll_id, username)` is impossible without it. It
also makes counting a poll's votes a single-table lookup. The cost is that `poll_id` and
`option_id` could theoretically disagree, so the vote endpoint verifies the option actually
belongs to that poll before inserting — that check is the price of the denormalisation.

> *Follow-up:* "Could you enforce that in the database instead?" → Yes — a composite foreign
> key on `(poll_id, option_id)` referencing a matching unique key on poll_options. More
> schema, same guarantee.

---

## Server / API (6)

### 6. Why is the poll id a nanoid and not an auto-incrementing integer?

Because the id *is* the share link — the URL is `/poll/V1StGXR8_Z`. With sequential
integers, anyone could walk `/poll/1`, `/poll/2`, `/poll/3` and read every poll ever created,
including ones they were never sent. A random id makes the link unguessable, which is the
only access control this app has. Options still use auto-increment integers, because those
ids never appear in a URL.

> *Follow-up:* "Is an unguessable URL real security?" → No — it's obscurity, fine for a poll,
> not for anything private. Real access control means auth and a permissions check.

### 7. What does the transaction in the create endpoint protect against?

A poll and all of its options are inserted inside one `db.transaction(...)`. Without it, a
crash or an error between the poll insert and the option inserts would leave a poll with
zero options in the database — a row that violates the 2–8 options rule and that no part of
the UI knows how to render. The transaction makes it all-or-nothing: either the whole poll
exists or nothing does. better-sqlite3 wraps it in BEGIN/COMMIT and rolls back automatically
if anything inside throws.

> *Follow-up:* "Does the vote endpoint need one?" → No — it's a single insert, and a single
> statement is already atomic.

### 8. What is the N+1 problem, and where would it have shown up here?

N+1 is when you run one query for a list and then one more query per item to fill in the
details — 1 + N round trips where one query would do. It would have appeared in
`GET /api/polls`: the naive version selects all polls, then loops running a COUNT per poll,
so 100 polls means 101 queries. Instead I use one query that joins polls to options and
votes and aggregates in the database. There's a subtlety: joining to two tables multiplies
rows — 4 options × 6 votes = 24 intermediate rows — so it needs `COUNT(DISTINCT ...)`, or
it would report 24 votes instead of 6. There's a test asserting exactly that.

> *Follow-up:* "How would you catch that in production?" → Query logging or an APM trace —
> N+1 shows up as a burst of near-identical queries per request.

### 9. In the results query, why LEFT JOIN and not INNER JOIN?

An INNER JOIN only keeps rows that match on both sides, so an option nobody voted for would
have no matching vote row and would disappear from the results entirely — a brand-new poll
would render as an empty list. LEFT JOIN keeps every option and fills nothing in for the
missing side, which COUNT reads as zero. There's a related detail: I use `COUNT(v.id)`, not
`COUNT(*)`, because `COUNT(*)` counts the empty row the LEFT JOIN invents and a zero-vote
option would report 1. Counting a specific column skips NULLs.

> *Follow-up:* "Show me." → Open the app: the seeded lunch poll has "Burgers" at 0 votes,
> still listed.

### 10. Walk me through your status codes. Why 409 for a duplicate vote and not 400?

201 for both creates, because a new resource exists. 400 means the input itself is wrong —
a missing username, nine options, or an option belonging to a different poll. 404 means no
poll with that id. 409 Conflict is the right one for a duplicate vote because nothing is
wrong with the request — it's well-formed and would have succeeded a moment earlier; it
conflicts with existing state. It's not 403 either, since this isn't a permissions problem.
The client keys off that status specifically: on a 409 it reloads into the results view
instead of showing a dead error.

> *Follow-up:* "Why not 422?" → 422 is for semantically invalid content. The body here is
> perfectly valid; the conflict is with state, which is what 409 means.

### 11. How does error handling work? I don't see try/catch in your routes.

There's one error middleware in `app.ts`, identified by its four arguments, registered last.
Routes just `throw new ApiError(404, 'Poll not found')` and it lands there — that works
because **all my handlers are synchronous** (better-sqlite3 returns rows directly, not
promises) and Express catches synchronous throws automatically. The one explicit try/catch is
around the vote insert, because I need to inspect the error code to distinguish a duplicate
from a real failure. The middleware also makes sure raw database errors never reach the
browser — those leak table and column names.

> *Follow-up:* "What breaks if a handler becomes async?" → Express 4 stops catching it and
> the request hangs. You'd need `next(err)` by hand, an async wrapper, or Express 5.

---

## Client (4)

### 12. Why no Redux or Zustand?

There's no state shared across routes — each page fetches exactly what it renders, so
`useState` and `useEffect` cover it. Adding a store would mean actions, reducers and
provider setup to manage data that lives inside a single component. If polls did need to
stay in sync across screens, I'd reach for React Query before Redux, because this is
**server** state, not client state — the real wins are caching, deduplication and background
refetching, not a global object.

> *Follow-up:* "When would you add one?" → Genuine cross-cutting client state: a logged-in
> user, a theme, a multi-step wizard.

### 13. After a vote, why refetch instead of just incrementing the count locally?

Because the number on screen should be what the database says, not what the browser guesses.
An optimistic local update would feel faster, but it would be wrong the moment anyone else
voted between my page load and my click — and it duplicates the counting logic on the client.
Refetching costs one extra round trip on an action that happens once per user per poll, which
is a good trade. The same reasoning applies to `yourVote`: the server decides whether you've
voted, so it survives a refresh, a new tab, or another device.

> *Follow-up:* "Wouldn't optimistic UI be better?" → For high-frequency actions, yes — with a
> rollback path. Once per poll, correctness is worth more than 200ms.

### 14. Why is there no CORS configuration anywhere?

Because there's never a cross-origin request to permit. In production one Express process
serves both the API and the built React files, so the page and its API calls share an origin.
In development the client runs on :5173 and the API on :3001, which *would* be cross-origin —
so `vite.config.ts` proxies `/api` to the API server, and as far as the browser is concerned
every request goes to :5173. I removed the cross-origin situation rather than permitting it.
That's also why every fetch uses a relative URL and there's no `VITE_API_URL` per environment.

> *Follow-up:* "When would you need CORS?" → The moment the client is served from a different
> domain — a CDN, or a separate mobile app hitting the API.

### 15. How does sharing work, and why does client-side routing need a server catch-all?

There's no "generate link" step — the poll page's URL *is* the share link, `/poll/<nanoid>`,
and the Copy button just copies `window.location.href`. The catch-all exists because React
Router runs in the browser: clicking a link never touches the server, but when someone opens
that link cold or hits refresh, the browser asks the **server** for `/poll/abc123`, which
isn't a real file. So Express returns `index.html` for any non-`/api` path, React boots, and
the router reads the URL. Order matters — that route is registered after the API routes, or
it would swallow every API request and answer with HTML.

> *Follow-up:* "How did you verify it?" → Hard-refreshed a poll URL against the production
> build, and opened a share link in a fresh browser profile with empty localStorage.

---

## Architecture and scale (4)

### 16. How would you scale this to 100,000 votes on one poll? What breaks first?

The results query breaks first: it aggregates every vote row on every page load, so it goes
from microseconds to something you notice. The fix in order of cost — add the indexes (already
there), then denormalise a `vote_count` column updated in the same transaction as the insert,
then cache the results with a short TTL since a few seconds of staleness is fine for a poll.
Writes become the next wall, because SQLite allows one writer at a time; that's where you move
to Postgres and get concurrent writers. The list endpoint would also need pagination — it
currently returns every poll.

> *Follow-up:* "What about the frontend?" → 100k votes still renders as 8 bars. The client
> doesn't care; only the query does.

### 17. Why no authentication, and what would adding it change?

The brief explicitly said no auth, so identity is a username kept in `localStorage` and sent
with the request. I want to be clear about what that means: it's spoofable in seconds — type
a different name, or open a private window. Adding real auth would mean a session cookie or
JWT, the server deriving the user from that instead of trusting the request body, and
`votes.username` becoming a `user_id` foreign key. The important part is that **the schema
shape doesn't change** — the constraint just becomes `UNIQUE(poll_id, user_id)`.

> *Follow-up:* "Could you make it harder without auth?" → Somewhat — an IP or device
> fingerprint — but they punish shared networks and still don't stop a determined person.

### 18. What's the weakest part of this system?

Persistence. SQLite is a file on the container's disk, and a container filesystem is
ephemeral — without a volume, every redeploy silently wipes the data while the app keeps
working. I mounted a Railway volume at `/data` and pointed `DB_PATH` at it, then verified it
by forcing a redeploy and checking the polls survived. The remaining limit is real: a volume
attaches to exactly one instance, so this service can't scale horizontally — two containers
would each have their own file and diverge. Vertical scaling works; horizontal needs Postgres.

> *Follow-up:* "What does that migration actually involve?" → Swap better-sqlite3 for `pg`
> and make every query `await`. That cascades: async handlers mean Express 4 no longer catches
> thrown errors, so the error middleware needs rework. The SQL barely changes.

### 19. How did you test this, and why that approach?

22 integration tests with vitest and supertest, driving the real Express app against an
in-memory SQLite database. They're integration rather than unit tests on purpose: the
interesting behaviour lives in the SQL and the database constraints, and a unit test with a
mocked database would be testing the mock instead of the thing that enforces the rules. The
duplicate-vote test is the one I care about most — it votes twice and asserts a 409 and that
the rejected vote left no trace. supertest calls the app in memory, so there's no port to
bind and no server to shut down, which is why `app.ts` is separate from `index.ts`.

> *Follow-up:* "What's not covered?" → The React components. No client tests at all — see below.

---

## What would you change (2)

### 20. What would you refactor first?

The duplicated types. `server/src/types.ts` and `client/src/types.ts` describe the same API
contract twice, by hand, so changing a server response shape doesn't break the client until
runtime. The fix is a shared workspace package both import, or generating client types from
the server. I skipped it deliberately — it's build configuration, and this project's whole
point was being readable in one sitting — but it's the first thing that would bite as the API
grew. Second would be splitting `routes/polls.ts`, which is 193 lines; I kept the SQL next to
each route so one endpoint reads in one place.

> *Follow-up:* "Why not just use tRPC or generate an OpenAPI client?" → Both are right answers
> for a bigger project; both add tooling I'd then have to justify for four endpoints.

### 21. What would you test or build next?

Client tests — there are none, and the vote flow has real branching worth covering:
the username gate, the 409 path, the retry. React Testing Library with the fetch layer mocked.
After that, feature-wise: closing a poll (a `closed_at` column and a check in the vote route),
pagination on the list endpoint, and rate limiting, since right now one script could create
ten thousand polls. If I wanted one thing that would most change how the app *feels*, it's
live results — Server-Sent Events would fit better than WebSockets here, because updates only
flow one direction.

> *Follow-up:* "Why SSE over WebSockets?" → One-directional, works over plain HTTP, reconnects
> automatically. WebSockets are for when the client also needs to push.

---

## Rapid-fire facts

| | |
|---|---|
| Stack | React 18 + TS (Vite) · Express + TS · SQLite (better-sqlite3) |
| Tables | `polls`, `poll_options`, `votes` |
| Endpoints | 4, plus `/api/health` |
| Codes | 201 created · 400 input · 404 missing · 409 duplicate vote |
| Tests | 22 integration (vitest + supertest, `:memory:` database) |
| Bundle | 172 kB, 56 kB gzipped |
| Deploy | Railway, one service, volume at `/data`, Node pinned to 22.x |
| No | ORM · state library · CORS config · auth · stored counts |

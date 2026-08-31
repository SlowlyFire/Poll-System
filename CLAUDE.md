# Project rules — read this before writing any code

This is a **poll application built for a 45-minute technical interview**. The author has to
explain every file out loud: the client, the server, and the database. Readability beats
cleverness every single time. If a reviewer would need a diagram to follow it, it is wrong.

## Non-negotiable rules

1. **Explain, don't impress.** No abstraction with fewer than 3 call sites. No design pattern
   unless it earns its place. Boring, obvious code is the goal.
2. **Comment the _why_, not the _what_.** `// increment i` is noise. `// DB enforces this, not
   JS, because two concurrent requests could both pass an if-check` is the point. Where we
   rejected an alternative, name the alternative in the comment.
3. **Every SQL query gets a plain-English comment above it** saying what it returns.
4. **No ORM.** Raw SQL only, so the author can read and defend each query.
5. **No state management library** (no Redux/Zustand/etc). `useState` + `useEffect` only.
   This app has no state shared across routes; each page owns its own fetch.
6. **Small files.** Past ~150 lines, split it and say why.
7. **No new dependency without telling the author** what it does and what it replaces.
8. **TypeScript:** explicit types on every function signature and API boundary. No `any`.
9. **Top of every source file:** a one-line comment saying what that file is responsible for.

## Stack (already decided — don't re-litigate)

- Client: React + TypeScript, built with Vite. Plain CSS, no UI library.
- Server: Express + TypeScript, run with `tsx` in dev, compiled with `tsc` for production.
- Database: SQLite via `better-sqlite3`, raw SQL.
- Validation: `zod`. IDs: `nanoid`. Tests: `vitest` + `supertest`.
- Production: one Express process serves the API *and* the built client. Deployed to Railway
  with a persistent volume so the SQLite file survives redeploys.

## Architecture (decided in the plan)

Tables: `polls`, `poll_options`, `votes`.
Duplicate voting is prevented by `UNIQUE(poll_id, username)` on `votes` — enforced by the
database, not by an if-statement, because an if-statement is a race condition.
Vote counts are **computed on read** with a `LEFT JOIN ... GROUP BY`, never stored.
Percentages are computed in the client — counts are the fact, percentages are presentation.
Poll IDs are `nanoid()` strings, not auto-increment, because the ID is the public share link.

## API

| Method | Path                  | Purpose                                    |
|--------|-----------------------|--------------------------------------------|
| GET    | /api/polls            | list polls with total vote counts          |
| POST   | /api/polls            | create poll + options (one transaction)    |
| GET    | /api/polls/:id        | one poll with per-option counts            |
| POST   | /api/polls/:id/vote   | cast a vote; 409 if this username voted    |

Status codes: 201 created · 400 validation · 404 not found · 409 duplicate vote.

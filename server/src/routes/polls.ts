// All four poll endpoints, with their SQL inline.
//
// A note on file length: this is longer than the ~150-line guideline in CLAUDE.md, and
// that is deliberate. The obvious split would move the SQL into a separate "repository"
// file, but then explaining one endpoint means reading two files. Keeping each query
// directly under the route that runs it is worth more here than a shorter file.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, nowIso } from '../db.js';
import { ApiError } from '../errors.js';
import { createPollSchema, voteSchema } from '../validation.js';
import type { OptionWithCount, PollDetail, PollRow, PollSummary } from '../types.js';

export const pollsRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/polls — every poll, newest first, for the home page list.
// ---------------------------------------------------------------------------
pollsRouter.get('/', (_req, res) => {
  // Returns one row per poll with how many options and how many votes it has.
  //
  // The naive version of this is: SELECT all polls, then loop over them running a
  // COUNT query for each one. That is the N+1 problem — 1 query for the list plus N
  // more for the details. With 100 polls it is 101 round trips. One query with joins
  // does it in a single pass.
  //
  // COUNT(DISTINCT ...) is required, not decoration. Joining polls to BOTH options and
  // votes multiplies the rows: a poll with 4 options and 6 votes produces 4 x 6 = 24
  // intermediate rows. A plain COUNT would report 24 votes. DISTINCT counts each real
  // id once, undoing that fan-out.
  const rows = db
    .prepare(
      `SELECT p.id                    AS id,
              p.question              AS question,
              p.created_by            AS createdBy,
              p.created_at            AS createdAt,
              COUNT(DISTINCT o.id)    AS optionCount,
              COUNT(DISTINCT v.id)    AS totalVotes
       FROM polls p
       LEFT JOIN poll_options o ON o.poll_id = p.id
       LEFT JOIN votes v        ON v.poll_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at DESC`
    )
    .all() as PollSummary[];

  res.json(rows);
});

// ---------------------------------------------------------------------------
// POST /api/polls — create a poll and its options.
// ---------------------------------------------------------------------------
pollsRouter.post('/', (req, res) => {
  // safeParse returns a result object instead of throwing, so we control the message.
  const parsed = createPollSchema.safeParse(req.body);
  if (!parsed.success) {
    // Surface the first problem only. The client validates too, so this is a backstop,
    // and one clear sentence is more useful to a human than a nested error tree.
    throw new ApiError(400, parsed.error.errors[0].message);
  }
  const { question, createdBy, options } = parsed.data;

  const pollId = nanoid();
  const createdAt = nowIso();

  const insertPoll = db.prepare(
    'INSERT INTO polls (id, question, created_by, created_at) VALUES (?, ?, ?, ?)'
  );
  const insertOption = db.prepare(
    'INSERT INTO poll_options (poll_id, text, position) VALUES (?, ?, ?)'
  );

  // A transaction: either the poll AND all of its options are written, or nothing is.
  // Without it, a crash between the two inserts would leave a poll with zero options in
  // the database — a row that no part of the app knows how to render, and that the
  // "2-8 options" rule says cannot exist. better-sqlite3 wraps the function in
  // BEGIN/COMMIT and rolls back automatically if anything inside throws.
  const createPoll = db.transaction(() => {
    insertPoll.run(pollId, question, createdBy, createdAt);
    options.forEach((text, index) => insertOption.run(pollId, text, index));
  });
  createPoll();

  // 201 Created, not 200 OK, because a new resource now exists. We return just the id:
  // it is all the client needs to redirect to /poll/<id>, which is also the share link.
  res.status(201).json({ id: pollId });
});

// ---------------------------------------------------------------------------
// GET /api/polls/:id — one poll with its results.
// Optional ?username= tells us whether that person has already voted.
// ---------------------------------------------------------------------------
pollsRouter.get('/:id', (req, res) => {
  const pollId = req.params.id;

  // Returns the poll itself, or undefined if that id doesn't exist.
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId) as PollRow | undefined;
  if (!poll) throw new ApiError(404, 'Poll not found');

  // Returns every option of this poll with the number of votes it received.
  //
  // LEFT JOIN, not INNER JOIN: an INNER JOIN only keeps options that have a matching
  // vote row, so an option nobody picked would vanish from the results entirely. LEFT
  // keeps every option and fills in nothing for the missing side, which COUNT reads as 0.
  //
  // COUNT(v.id) rather than COUNT(*): COUNT(*) counts rows including the empty one the
  // LEFT JOIN invents, so a zero-vote option would report 1. COUNT of a column skips NULLs.
  const options = db
    .prepare(
      `SELECT o.id            AS id,
              o.text          AS text,
              COUNT(v.id)     AS voteCount
       FROM poll_options o
       LEFT JOIN votes v ON v.option_id = o.id
       WHERE o.poll_id = ?
       GROUP BY o.id
       ORDER BY o.position`
    )
    .all(pollId) as OptionWithCount[];

  // Summing the per-option counts is free here — we already have them in memory, so
  // asking the database for the total again would be a pointless second query.
  const totalVotes = options.reduce((sum, option) => sum + option.voteCount, 0);

  // Which option this visitor picked, if any. Read from the database rather than
  // trusted from the client, so the answer is the same on any device or after a refresh.
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  let yourVote: number | null = null;
  if (username) {
    // Returns the option this username voted for in this poll, if they voted at all.
    const row = db
      .prepare('SELECT option_id FROM votes WHERE poll_id = ? AND username = ?')
      .get(pollId, username) as { option_id: number } | undefined;
    yourVote = row ? row.option_id : null;
  }

  const detail: PollDetail = {
    id: poll.id,
    question: poll.question,
    createdBy: poll.created_by,
    createdAt: poll.created_at,
    options,
    totalVotes,
    yourVote,
  };
  res.json(detail);
});

// ---------------------------------------------------------------------------
// POST /api/polls/:id/vote — cast one vote.
// ---------------------------------------------------------------------------
pollsRouter.post('/:id/vote', (req, res) => {
  const pollId = req.params.id;

  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, parsed.error.errors[0].message);
  const { username, optionId } = parsed.data;

  // Returns 1 if this poll exists. SELECT 1 instead of SELECT * because we only care
  // whether a row is there, not what is in it.
  const pollExists = db.prepare('SELECT 1 FROM polls WHERE id = ?').get(pollId);
  if (!pollExists) throw new ApiError(404, 'Poll not found');

  // Returns 1 if this option belongs to THIS poll. Checking the option exists is not
  // enough: without the poll_id condition, someone could post option 7 from a different
  // poll to this one and we would happily store a vote that makes no sense. This is the
  // check that keeps votes.poll_id and votes.option_id consistent — the price of storing
  // both columns (see the comment in db.ts).
  const optionBelongs = db
    .prepare('SELECT 1 FROM poll_options WHERE id = ? AND poll_id = ?')
    .get(optionId, pollId);
  if (!optionBelongs) throw new ApiError(400, 'That option does not belong to this poll');

  try {
    db.prepare(
      'INSERT INTO votes (poll_id, option_id, username, created_at) VALUES (?, ?, ?, ?)'
    ).run(pollId, optionId, username, nowIso());
  } catch (err) {
    // We deliberately did NOT check "has this user already voted?" before inserting.
    // That check-then-insert pattern is a race: two requests can both pass the check
    // before either writes. Instead we just try, and let UNIQUE(poll_id, username) in
    // the schema reject the second one atomically. This is the catch for that rejection.
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      // 409 Conflict: the request was well-formed, but it conflicts with existing state.
      // Not 400 (nothing is wrong with the input) and not 403 (this isn't a permissions issue).
      throw new ApiError(409, 'You have already voted in this poll');
    }
    throw err; // anything else is a real bug — let the error middleware handle it
  }

  res.status(201).json({ ok: true });
});

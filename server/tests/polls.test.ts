// Integration tests for the API. These go through the real Express app and the real
// SQL — supertest calls the app in memory, so there is no port and no network.
//
// They are integration tests, not unit tests, on purpose: the interesting behaviour of
// this app lives in the SQL and the database constraints, and a unit test with a mocked
// database would test the mock instead of the thing that actually enforces the rules.

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db.js';

const app = createApp();

// A valid body, so each test only has to state what it changes.
const validPoll = {
  question: 'What should we order?',
  createdBy: 'gal',
  options: ['Pizza', 'Sushi', 'Falafel'],
};

// Clear the tables between tests so each one starts from a known state and the order
// they run in cannot matter. Deleting from polls cascades to options and votes.
beforeEach(() => {
  db.exec('DELETE FROM polls');
});

/** Creates a poll and returns its id, so tests don't repeat this three lines at a time. */
async function createPoll(overrides: Partial<typeof validPoll> = {}): Promise<string> {
  const res = await request(app).post('/api/polls').send({ ...validPoll, ...overrides });
  expect(res.status).toBe(201);
  return res.body.id;
}

describe('POST /api/polls', () => {
  it('creates a poll and returns its id', async () => {
    const res = await request(app).post('/api/polls').send(validPoll);

    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
  });

  it('stores the options in the order they were given', async () => {
    const id = await createPoll();
    const res = await request(app).get(`/api/polls/${id}`);

    expect(res.body.options.map((o: { text: string }) => o.text)).toEqual([
      'Pizza',
      'Sushi',
      'Falafel',
    ]);
  });

  it('rejects fewer than 2 options', async () => {
    const res = await request(app).post('/api/polls').send({ ...validPoll, options: ['Only one'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2/i);
  });

  it('rejects more than 8 options', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `Option ${i}`);
    const res = await request(app).post('/api/polls').send({ ...validPoll, options: nine });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 8/i);
  });

  it('rejects duplicate options, ignoring case', async () => {
    const res = await request(app)
      .post('/api/polls')
      .send({ ...validPoll, options: ['Pizza', 'pizza'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unique/i);
  });

  it('rejects an empty question', async () => {
    const res = await request(app).post('/api/polls').send({ ...validPoll, question: '   ' });

    expect(res.status).toBe(400);
  });

  // The poll and its options are written in one transaction, so a rejected poll must
  // leave nothing behind at all — not even a half-written row.
  it('writes nothing when validation fails', async () => {
    await request(app).post('/api/polls').send({ ...validPoll, options: [] });

    const count = db.prepare('SELECT COUNT(*) AS n FROM polls').get() as { n: number };
    expect(count.n).toBe(0);
  });
});

describe('GET /api/polls/:id', () => {
  it('returns every option, including ones with zero votes', async () => {
    const id = await createPoll();
    const res = await request(app).get(`/api/polls/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.options).toHaveLength(3);
    // This is the LEFT JOIN doing its job: no votes exist yet, and every option is
    // still present with a count of 0. An INNER JOIN would return an empty list here.
    expect(res.body.options.every((o: { voteCount: number }) => o.voteCount === 0)).toBe(true);
    expect(res.body.totalVotes).toBe(0);
  });

  it('404s for a poll that does not exist', async () => {
    const res = await request(app).get('/api/polls/not-a-real-id');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('reports yourVote for the given username, and null for anyone else', async () => {
    const id = await createPoll();
    const detail = await request(app).get(`/api/polls/${id}`);
    const optionId = detail.body.options[1].id;

    await request(app).post(`/api/polls/${id}/vote`).send({ username: 'dana', optionId });

    const asDana = await request(app).get(`/api/polls/${id}?username=dana`);
    expect(asDana.body.yourVote).toBe(optionId);

    const asYossi = await request(app).get(`/api/polls/${id}?username=yossi`);
    expect(asYossi.body.yourVote).toBeNull();
  });
});

describe('POST /api/polls/:id/vote', () => {
  it('records a vote and increments only that option', async () => {
    const id = await createPoll();
    const before = await request(app).get(`/api/polls/${id}`);
    const optionId = before.body.options[0].id;

    const res = await request(app).post(`/api/polls/${id}/vote`).send({ username: 'gal', optionId });
    expect(res.status).toBe(201);

    const after = await request(app).get(`/api/polls/${id}`);
    expect(after.body.totalVotes).toBe(1);
    expect(after.body.options[0].voteCount).toBe(1);
    expect(after.body.options[1].voteCount).toBe(0);
  });

  // The headline rule from the spec, and the reason for UNIQUE(poll_id, username).
  it('409s when the same username votes twice in the same poll', async () => {
    const id = await createPoll();
    const detail = await request(app).get(`/api/polls/${id}`);
    const [first, second] = detail.body.options;

    const one = await request(app).post(`/api/polls/${id}/vote`).send({ username: 'gal', optionId: first.id });
    expect(one.status).toBe(201);

    // Voting for a *different* option is still a second vote, and still refused.
    const two = await request(app).post(`/api/polls/${id}/vote`).send({ username: 'gal', optionId: second.id });
    expect(two.status).toBe(409);
    expect(two.body.error).toMatch(/already voted/i);

    // And the rejected vote left no trace.
    const after = await request(app).get(`/api/polls/${id}`);
    expect(after.body.totalVotes).toBe(1);
  });

  it('lets the same username vote in a different poll', async () => {
    const pollA = await createPoll();
    const pollB = await createPoll({ question: 'A different question' });

    const a = await request(app).get(`/api/polls/${pollA}`);
    const b = await request(app).get(`/api/polls/${pollB}`);

    expect((await request(app).post(`/api/polls/${pollA}/vote`).send({ username: 'gal', optionId: a.body.options[0].id })).status).toBe(201);
    // The constraint is on (poll_id, username), not username alone — so this must pass.
    expect((await request(app).post(`/api/polls/${pollB}/vote`).send({ username: 'gal', optionId: b.body.options[0].id })).status).toBe(201);
  });

  // Normalisation tests. These pin down the decision that "Gal", "gal" and " gal " are
  // all the same voter — the kind of rule that is easy to break by accident later.
  it('treats usernames as case-insensitive', async () => {
    const id = await createPoll();
    const detail = await request(app).get(`/api/polls/${id}`);
    const [first, second] = detail.body.options;

    expect((await request(app).post(`/api/polls/${id}/vote`).send({ username: 'Gal', optionId: first.id })).status).toBe(201);
    expect((await request(app).post(`/api/polls/${id}/vote`).send({ username: 'gal', optionId: second.id })).status).toBe(409);
  });

  it('treats surrounding whitespace as the same username', async () => {
    const id = await createPoll();
    const detail = await request(app).get(`/api/polls/${id}`);
    const [first, second] = detail.body.options;

    expect((await request(app).post(`/api/polls/${id}/vote`).send({ username: 'gal', optionId: first.id })).status).toBe(201);
    expect((await request(app).post(`/api/polls/${id}/vote`).send({ username: '  gal  ', optionId: second.id })).status).toBe(409);
  });

  it('finds yourVote regardless of how the username is capitalised', async () => {
    const id = await createPoll();
    const detail = await request(app).get(`/api/polls/${id}`);
    const optionId = detail.body.options[0].id;

    await request(app).post(`/api/polls/${id}/vote`).send({ username: 'Gal', optionId });

    const res = await request(app).get(`/api/polls/${id}?username=GAL`);
    expect(res.body.yourVote).toBe(optionId);
  });

  it('rejects an option belonging to another poll', async () => {
    const pollA = await createPoll();
    const pollB = await createPoll({ question: 'A different question' });
    const bOptions = await request(app).get(`/api/polls/${pollB}`);

    const res = await request(app)
      .post(`/api/polls/${pollA}/vote`)
      .send({ username: 'gal', optionId: bOptions.body.options[0].id });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not belong/i);
  });

  it('404s when voting on a poll that does not exist', async () => {
    const res = await request(app).post('/api/polls/nope/vote').send({ username: 'gal', optionId: 1 });

    expect(res.status).toBe(404);
  });

  it('400s on a missing username', async () => {
    const id = await createPoll();
    const detail = await request(app).get(`/api/polls/${id}`);

    const res = await request(app).post(`/api/polls/${id}/vote`).send({ optionId: detail.body.options[0].id });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/polls', () => {
  it('lists polls newest first with correct counts', async () => {
    const id = await createPoll();
    const detail = await request(app).get(`/api/polls/${id}`);

    await request(app).post(`/api/polls/${id}/vote`).send({ username: 'a', optionId: detail.body.options[0].id });
    await request(app).post(`/api/polls/${id}/vote`).send({ username: 'b', optionId: detail.body.options[1].id });

    const res = await request(app).get('/api/polls');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    // Both counts come from one query with two LEFT JOINs. If COUNT(DISTINCT ...) were
    // just COUNT(...), the joins would multiply rows and this would read 6, not 2.
    expect(res.body[0].optionCount).toBe(3);
    expect(res.body[0].totalVotes).toBe(2);
  });

  it('returns an empty array when there are no polls', async () => {
    const res = await request(app).get('/api/polls');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('unknown routes', () => {
  it('404s unknown /api paths as JSON, not HTML', async () => {
    const res = await request(app).get('/api/nonsense');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

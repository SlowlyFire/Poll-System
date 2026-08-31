// Fills the database with sample data so there is something to look at while developing.
// Run with `npm run seed`. Destructive: it wipes existing data first.

import { nanoid } from 'nanoid';
import { db, nowIso } from './db.js';

// The sample polls. Plain data, separate from the insert logic below.
const SAMPLE_POLLS = [
  {
    question: 'What should we order for the team lunch?',
    createdBy: 'gal',
    options: ['Pizza', 'Sushi', 'Falafel', 'Burgers'],
    // Which option index each person voted for.
    votes: { dana: 0, yossi: 2, maya: 0, amit: 1, noa: 2, tal: 0 },
  },
  {
    question: 'Best day for the sprint retro?',
    createdBy: 'dana',
    options: ['Monday', 'Wednesday', 'Friday'],
    votes: { gal: 1, yossi: 1, maya: 2 },
  },
  {
    question: 'Tabs or spaces?',
    createdBy: 'yossi',
    options: ['Tabs', 'Spaces'],
    votes: {}, // a poll with no votes yet — makes sure the UI handles zero correctly
  },
];

// Deleting from `polls` is enough to clear everything: poll_options and votes both
// declare ON DELETE CASCADE, so SQLite removes their rows automatically. This only
// works because db.ts turned foreign keys ON — without that pragma these two tables
// would be left full of orphaned rows.
function wipe(): void {
  db.exec('DELETE FROM polls');
}

function seed(): void {
  wipe();

  // Prepared statements are compiled once and reused for every insert. Besides being
  // faster, the `?` placeholders are what make this safe from SQL injection: the value
  // is sent to SQLite separately from the query text, so it can never be parsed as SQL.
  const insertPoll = db.prepare(
    'INSERT INTO polls (id, question, created_by, created_at) VALUES (?, ?, ?, ?)'
  );
  const insertOption = db.prepare(
    'INSERT INTO poll_options (poll_id, text, position) VALUES (?, ?, ?)'
  );
  const insertVote = db.prepare(
    'INSERT INTO votes (poll_id, option_id, username, created_at) VALUES (?, ?, ?, ?)'
  );

  for (const sample of SAMPLE_POLLS) {
    const pollId = nanoid();
    insertPoll.run(pollId, sample.question, sample.createdBy, nowIso());

    // Keep the generated option ids so the votes below can reference them. The id is
    // assigned by SQLite (AUTOINCREMENT), so we read it back from the insert result.
    const optionIds: number[] = sample.options.map((text, index) => {
      const result = insertOption.run(pollId, text, index);
      return Number(result.lastInsertRowid);
    });

    for (const [username, optionIndex] of Object.entries(sample.votes)) {
      insertVote.run(pollId, optionIds[optionIndex], username, nowIso());
    }

    console.log(`  seeded "${sample.question}" -> /poll/${pollId}`);
  }
}

seed();
console.log('\nSeed complete.');

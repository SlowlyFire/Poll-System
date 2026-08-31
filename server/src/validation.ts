// Request body validation. Every rule from the spec lives here, in one place, so the
// route handlers only deal with data that is already known to be valid.
//
// Why validate at all when the client already checks? Because the client is not the only
// caller. Anyone can curl this API. Client-side validation is a convenience for the user;
// server-side validation is the actual rule.

import { z } from 'zod';

// Reusable pieces, so the same limits can't drift apart between endpoints.
const username = z
  .string()
  .trim()          // " gal " and "gal" must be the same person
  // A DECISION, not an accident: usernames are compared case-insensitively, so "Gal"
  // and "gal" are one voter. Without this, capitalising a letter is a trivial way to
  // vote twice, which defeats the entire point of UNIQUE(poll_id, username).
  //
  // The cost is that we no longer remember how someone capitalised their own name —
  // the poll says "created by gal" even if they typed "Gal". The alternative is to
  // store the name as typed plus a normalised column to enforce uniqueness on. That is
  // the right answer for a real product; here it is a second column and a second thing
  // to keep in sync, in exchange for prettier capitalisation.
  //
  // Normalising on the SERVER, not just the client, is the part that matters: the
  // client can be bypassed with curl, so this is where the rule actually holds.
  .toLowerCase()
  .min(1, 'Username is required')
  .max(30, 'Username must be 30 characters or fewer');

export const createPollSchema = z.object({
  question: z.string().trim().min(1, 'Question is required').max(200, 'Question is too long'),
  createdBy: username,
  options: z
    .array(z.string().trim().min(1, 'Options cannot be empty').max(100, 'Option is too long'))
    // The 2-8 range comes straight from the spec: a poll needs at least a choice between
    // two things, and more than eight is unreadable on a phone.
    .min(2, 'A poll needs at least 2 options')
    .max(8, 'A poll can have at most 8 options')
    // Duplicate options would produce two identical bars in the results, and a voter
    // couldn't tell them apart. Compared case-insensitively so "Pizza" and "pizza" clash.
    .refine(
      (options) => new Set(options.map((o) => o.toLowerCase())).size === options.length,
      { message: 'Options must be unique' }
    ),
});

export const voteSchema = z.object({
  username,
  // coerce lets the value arrive as either 3 or "3" and end up a number either way.
  // .int() rejects 3.5; .positive() rejects 0 and negatives — neither can be a real row id.
  optionId: z.coerce.number().int().positive(),
});

// Inferring the TypeScript types from the zod schemas means the schema is the single
// source of truth: change a rule and the type changes with it, instead of the two
// silently drifting apart.
export type CreatePollBody = z.infer<typeof createPollSchema>;
export type VoteBody = z.infer<typeof voteSchema>;

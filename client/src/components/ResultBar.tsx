// One row of the results view: the option text, its share of the vote as a bar, and the
// count. Purely presentational — it is given numbers and draws them.

interface Props {
  text: string;
  voteCount: number;
  totalVotes: number;
  /** True if this is the option the current user picked, so we can highlight it. */
  isYourVote: boolean;
}

export default function ResultBar({ text, voteCount, totalVotes, isYourVote }: Props) {
  // Percentages are computed here, in the client, and never stored in the database.
  // Counts are the fact; a percentage is a way of displaying that fact. Storing it would
  // mean recalculating every row on every vote, and the two could drift apart.
  //
  // The totalVotes check is not paranoia: a brand new poll has zero votes, and 0/0 in
  // JavaScript is NaN, which would render as "NaN%" and a bar of width "NaN%".
  const percent = totalVotes === 0 ? 0 : (voteCount / totalVotes) * 100;

  return (
    <div className={isYourVote ? 'result result--yours' : 'result'}>
      <div className="result__header">
        <span className="result__text">
          {text}
          {isYourVote && <span className="badge">your vote</span>}
        </span>
        <span className="result__count">
          {/* Math.round keeps it readable. The bar below uses the exact value, so the
              bar stays proportional even when two labels round to the same number. */}
          {Math.round(percent)}% · {voteCount} {voteCount === 1 ? 'vote' : 'votes'}
        </span>
      </div>
      <div className="bar">
        <div className="bar__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

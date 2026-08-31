// The shapes the API sends back. These mirror server/src/types.ts by hand.
//
// Yes, that is duplication. In a monorepo the honest fix is a shared package that both
// sides import, so the contract can only be changed in one place. We kept two copies
// because a shared package means build config, and this project's whole point is being
// readable in one sitting. The trade-off is real: change a server response shape and
// nothing here complains until runtime.

export interface OptionWithCount {
  id: number;
  text: string;
  voteCount: number;
}

/** A poll as it appears in the list on the home page. */
export interface PollSummary {
  id: string;
  question: string;
  createdBy: string;
  createdAt: string;
  optionCount: number;
  totalVotes: number;
}

/** A single poll with full results — what the poll page renders. */
export interface PollDetail {
  id: string;
  question: string;
  createdBy: string;
  createdAt: string;
  options: OptionWithCount[];
  totalVotes: number;
  /** The option id this username picked, or null if they have not voted. */
  yourVote: number | null;
}

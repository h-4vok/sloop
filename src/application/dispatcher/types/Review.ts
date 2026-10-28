/** Review submission details read from a pull request. */
export type Review = {
  body?: string;
  commitId?: string;
  submittedAt?: string;
  state?: string;
};

import {
  createIsolatedTemporaryDirectory,
  assert,
  rmSync,
  tmpdir,
  join,
  test,
  resolveReviewCap,
  readState,
  writeState,
  createMockGitHubHost,
} from '../dispatcher-test-support.mjs';

test('review-cap waiver requires a clean PR with green checks', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-unhealthy-'));
  const statePath = join(root, 'state.json');
  writeState(
    {
      issue: 1,

      pr: 7,

      status: 'review_cap_pending',

      reviewRound: 2,

      reviewCap: {
        capRound: 2,

        outstandingFindingIds: ['Q1'],

        additionalRounds: 0,

        waivedFindingIds: [],
      },
    },
    statePath,
  );
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        mergeable: 'CONFLICTING',

        mergeStateStatus: 'DIRTY',

        comments: [],

        statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'FAILURE' }],
      });
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ comments: [] });
    return '';
  });

  assert.throws(
    () =>
      resolveReviewCap(
        {
          steer: 'waive after review',

          abandon: false,

          waiveAllOutstanding: false,

          waivedFindingIds: ['Q1'],

          additionalRounds: 0,
        },
        { requiredPrChecks: ['pr-checks'] },
        statePath,
        root,
        undefined,
        fake.host,
      ),
    /green required checks and be clean\/mergeable/,
  );
  assert.equal(readState(statePath).status, 'review_cap_pending');
  rmSync(root, { recursive: true, force: true });
});

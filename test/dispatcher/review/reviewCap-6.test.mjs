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
  createReviewCapGitHubHost,
} from '../dispatcher-test-support.mjs';

function createUnhealthyReviewCapFixture() {
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
  const fake = createReviewCapGitHubHost({
    pullRequest: {
      number: 7,
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      comments: [],
      statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'FAILURE' }],
    },
  });
  return { root, statePath, host: fake.host };
}

test('review-cap waiver requires a clean PR with green checks', () => {
  const fixture = createUnhealthyReviewCapFixture();
  const request = {
    steer: 'waive after review',
    abandon: false,
    waiveAllOutstanding: false,
    waivedFindingIds: ['Q1'],
    additionalRounds: 0,
  };

  assert.throws(
    () =>
      resolveReviewCap(
        request,
        { requiredPrChecks: ['pr-checks'] },
        fixture.statePath,
        fixture.root,
        undefined,
        fixture.host,
      ),
    /green required checks and be clean\/mergeable/,
  );
  assert.equal(readState(fixture.statePath).status, 'review_cap_pending');
  rmSync(fixture.root, { recursive: true, force: true });
});

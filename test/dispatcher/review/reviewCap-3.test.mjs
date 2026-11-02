import {
  createIsolatedTemporaryDirectory,
  assert,
  tmpdir,
  join,
  test,
  prepareRecovery,
  resolveReviewCap,
  readState,
  writeState,
  createMockGitHubHost,
  rmSync,
} from '../dispatcher-test-support.mjs';

test('review-cap resolution creates an empty cap when resuming a ready PR recovery', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-recovery-'));
  const statePath = join(root, 'state.json');
  const recovered = prepareRecovery(
    { issue: 1, pr: 7, status: 'ready_for_human_merge', reviewRound: 1, completedIssues: [1] },
    1,
    7,
    1000,
    100,
  );
  writeState(recovered, statePath);
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ comments: [] });
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        mergeable: 'MERGEABLE',

        mergeStateStatus: 'CLEAN',

        comments: [],

        statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      });
    return '';
  });

  resolveReviewCap(
    {
      steer: 'resume with the local listing reproduction',

      abandon: false,

      waiveAllOutstanding: false,

      waivedFindingIds: [],

      additionalRounds: 2,
    },
    { requiredPrChecks: ['pr-checks'] },
    statePath,
    root,
    'o/r',
    fake.host,
  );

  const next = readState(statePath);

  assert.equal(next.status, 'worker_recovery_pending');
  assert.equal(next.reviewCap.capRound, 1);
  assert.deepEqual(next.reviewCap.outstandingFindingIds, []);
  assert.equal(next.reviewCap.additionalRounds, 0);
  assert.equal(next.reviewCap.steer, 'resume with the local listing reproduction');
});

test('review-cap abandonment requires an active review-cap run', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-abandon-inactive-'));
  const statePath = join(root, 'state.json');
  writeState({}, statePath);

  assert.throws(
    () =>
      resolveReviewCap(
        {
          steer: 'stop this run',

          abandon: true,

          waiveAllOutstanding: false,

          waivedFindingIds: [],

          additionalRounds: 0,
        },
        {},
        statePath,
        root,
      ),
    /abandonment requires the active review-cap run/,
  );

  rmSync(root, { recursive: true, force: true });
});

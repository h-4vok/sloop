import {
  createIsolatedTemporaryDirectory,
  assert,
  tmpdir,
  join,
  test,
  resolveReviewCap,
  readState,
  writeState,
  createMockGitHubHost,
} from '../dispatcher-test-support.mjs';

test('review-cap resolution uses the host for identity and publication while enforcing waiver safety', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-host-'));
  const statePath = join(root, 'state.json');
  writeState(
    {
      issue: 1,

      pr: 7,

      status: 'review_cap_pending',

      reviewRound: 2,

      reviewCap: {
        capRound: 2,

        outstandingFindingIds: ['Q1', 'Q2'],

        additionalRounds: 0,

        waivedFindingIds: [],
      },
    },
    statePath,
  );
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'issue' && args[1] === 'view')
      return JSON.stringify({ comments: [{ body: 'An unrelated issue comment.' }] });
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        mergeable: 'MERGEABLE',

        mergeStateStatus: 'CLEAN',

        comments: [{ body: 'An unrelated pull request comment.' }],

        statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      });
    return '';
  });
  const options = {
    steer: 'ship this',

    abandon: false,

    waiveAllOutstanding: false,

    waivedFindingIds: ['q1', 'q2'],

    additionalRounds: 0,
  };

  assert.throws(
    () =>
      resolveReviewCap(
        { ...options, waivedFindingIds: ['Q99'] },
        { requiredPrChecks: ['pr-checks'] },
        statePath,
        root,
        'o/r',
        fake.host,
      ),
    /waivers must name outstanding findings/,
  );
  assert.throws(
    () =>
      resolveReviewCap(
        { ...options, waivedFindingIds: ['Q1'] },
        { requiredPrChecks: ['pr-checks'] },
        statePath,
        root,
        'o/r',
        fake.host,
      ),
    /findings remain/,
  );

  resolveReviewCap(options, { requiredPrChecks: ['pr-checks'] }, statePath, root, 'o/r', fake.host);
  const next = readState(statePath);

  assert.equal(next.status, 'ready_for_human_merge');
  assert.deepEqual(next.reviewCap.waivedFindingIds, ['Q1', 'Q2']);
  assert.equal(next.reviewCap.resolvedBy, 'octocat');
  assert.equal(next.reviewCap.resolvedAt, new Date(1_700_000_000_000).toISOString());
  assert.equal(
    fake.calls.some(({ args }) => args[0] === 'api'),
    true,
  );
  assert.equal(fake.calls.find(({ args }) => args[0] === 'api').args.includes('--repo'), false);
  assert.throws(
    () =>
      resolveReviewCap(
        { ...options, abandon: true, additionalRounds: 1 },
        {},
        statePath,
        root,
        undefined,
        fake.host,
      ),
    /cannot be combined/,
  );
});

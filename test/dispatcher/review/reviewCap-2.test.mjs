import {
  createIsolatedTemporaryDirectory,
  assert,
  tmpdir,
  join,
  test,
  resolveReviewCap,
  readState,
  writeState,
  createReviewCapGitHubHost,
} from '../dispatcher-test-support.mjs';

function createReviewCapFixture() {
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
  const fake = createReviewCapGitHubHost({
    issue: { comments: [{ body: 'An unrelated issue comment.' }] },
    pullRequest: {
      number: 7,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      comments: [{ body: 'An unrelated pull request comment.' }],
      statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    },
  });
  return {
    root,
    statePath,
    host: fake.host,
    calls: fake.calls,
    options: {
      steer: 'ship this',
      abandon: false,
      waiveAllOutstanding: false,
      waivedFindingIds: ['q1', 'q2'],
      additionalRounds: 0,
    },
  };
}

test('review-cap waiver rejects findings that are not outstanding', () => {
  const fixture = createReviewCapFixture();

  assert.throws(
    () =>
      resolveReviewCap(
        { ...fixture.options, waivedFindingIds: ['Q99'] },
        { requiredPrChecks: ['pr-checks'] },
        fixture.statePath,
        fixture.root,
        'o/r',
        fixture.host,
      ),
    /waivers must name outstanding findings/,
  );
});

test('review-cap waiver rejects unresolved findings omitted from the waiver list', () => {
  const fixture = createReviewCapFixture();

  assert.throws(
    () =>
      resolveReviewCap(
        { ...fixture.options, waivedFindingIds: ['Q1'] },
        { requiredPrChecks: ['pr-checks'] },
        fixture.statePath,
        fixture.root,
        'o/r',
        fixture.host,
      ),
    /findings remain/,
  );
});

test('review-cap waiver records resolution identity and publishes the update', () => {
  const fixture = createReviewCapFixture();

  resolveReviewCap(
    fixture.options,
    { requiredPrChecks: ['pr-checks'] },
    fixture.statePath,
    fixture.root,
    'o/r',
    fixture.host,
  );
  const next = readState(fixture.statePath);

  assert.equal(next.status, 'ready_for_human_merge');
  assert.deepEqual(next.reviewCap.waivedFindingIds, ['Q1', 'Q2']);
  assert.equal(next.reviewCap.resolvedBy, 'octocat');
  assert.equal(next.reviewCap.resolvedAt, new Date(1_700_000_000_000).toISOString());
  assert.ok(fixture.calls.some(({ args }) => args[0] === 'api'));
  assert.equal(fixture.calls.find(({ args }) => args[0] === 'api').args.includes('--repo'), false);
});

test('review-cap abandon cannot be combined with additional rounds', () => {
  const fixture = createReviewCapFixture();

  assert.throws(
    () =>
      resolveReviewCap(
        { ...fixture.options, abandon: true, additionalRounds: 1 },
        {},
        fixture.statePath,
        fixture.root,
        undefined,
        fixture.host,
      ),
    /cannot be combined/,
  );
});

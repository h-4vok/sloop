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
  artifactKey,
  createMockGitHubHost,
} from '../dispatcher-test-support.mjs';

test('review-cap resume rejects a PR head that changed after remote reconciliation', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-head-mismatch-'));
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
  const manifest = {
    protocol: 1,

    runId: 'remote-run',

    issue: 1,

    pr: 7,

    branch: 'codex/issue-1',

    baseSha: 'abc1234',

    configFingerprint: 'config-v1',

    phase: 'blocked',

    reviewRound: 2,

    contextCursor: '',

    artifacts: [artifactKey('run', { issue: 1, runId: 'remote-run' })],
  };
  const remote = {
    snapshot: () => ({
      issue: 1,

      pr: 7,

      prState: 'OPEN',

      branch: 'codex/issue-1',

      manifest,
    }),
  };
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        state: 'OPEN',

        headRefName: 'codex/issue-1-updated',

        headRefOid: 'def5678',

        mergeable: 'MERGEABLE',

        mergeStateStatus: 'CLEAN',

        comments: [],
      });
    return '';
  });

  assert.throws(
    () =>
      resolveReviewCap(
        {
          steer: 'resume the reviewed work',

          abandon: false,

          waiveAllOutstanding: false,

          waivedFindingIds: [],

          additionalRounds: 1,
        },
        {},
        statePath,
        root,
        undefined,
        fake.host,
        remote,
      ),
    /PR head changed while reconciling remote state/,
  );
  assert.equal(readState(statePath).status, 'review_cap_pending');
  rmSync(root, { recursive: true, force: true });
});

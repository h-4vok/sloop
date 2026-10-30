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

test('review-cap resume republishes the updated remote manifest after granting a round', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-publish-'));
  const statePath = join(root, 'state.json');
  writeState(
    {
      issue: 1,

      pr: 7,

      branch: 'codex/issue-1',

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
  const published = [];
  const remote = {
    snapshot: () => ({
      issue: 1,

      pr: 7,

      prState: 'OPEN',

      branch: 'codex/issue-1',

      sha: 'abc1234',

      manifest,
    }),

    publish: (issue, nextManifest) => published.push({ issue, manifest: nextManifest }),
  };
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        state: 'OPEN',

        headRefName: 'codex/issue-1',

        headRefOid: 'abc1234',

        mergeable: 'MERGEABLE',

        mergeStateStatus: 'CLEAN',

        comments: [],
      });
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ comments: [] });
    return '';
  });

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
  );

  assert.equal(readState(statePath).status, 'worker_recovery_pending');
  assert.equal(published.length, 1);
  assert.deepEqual(published[0], {
    issue: 1,

    manifest: {
      ...manifest,

      phase: 'blocked',

      lease: undefined,
    },
  });
  rmSync(root, { recursive: true, force: true });
});

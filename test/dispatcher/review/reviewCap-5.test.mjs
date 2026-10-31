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

function createHeadMismatchFixture() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-head-mismatch-'));
  const statePath = join(root, 'state.json');
  writeState(createPendingReviewCapState(), statePath);
  const manifest = createRemoteReviewCapManifest();
  const remote = createRemoteReviewCapSnapshot(manifest);
  const github = createChangedHeadGitHubHost();
  return { root, statePath, remote, host: github.host };
}

function createPendingReviewCapState() {
  return {
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
  };
}

function createRemoteReviewCapManifest() {
  return {
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
}

function createRemoteReviewCapSnapshot(manifest) {
  return {
    snapshot: () => ({
      issue: 1,
      pr: 7,
      prState: 'OPEN',
      branch: 'codex/issue-1',
      manifest,
    }),
  };
}

function createChangedHeadGitHubHost() {
  return createMockGitHubHost((args) => {
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
}

test('review-cap resume rejects a PR head changed after remote reconciliation', () => {
  const fixture = createHeadMismatchFixture();
  const request = {
    steer: 'resume reviewed work',
    abandon: false,
    waiveAllOutstanding: false,
    waivedFindingIds: [],
    additionalRounds: 1,
  };

  assert.throws(
    () =>
      resolveReviewCap(
        request,
        {},
        fixture.statePath,
        fixture.root,
        undefined,
        fixture.host,
        fixture.remote,
      ),
    /PR head changed while reconciling remote state/,
  );
  assert.equal(readState(fixture.statePath).status, 'review_cap_pending');
  rmSync(fixture.root, { recursive: true, force: true });
});

import {
  createIsolatedTemporaryDirectory,
  assert,
  rmSync,
  tmpdir,
  join,
  test,
  resolveReviewCap,
  writeState,
  artifactKey,
  createMockGitHubHost,
} from '../dispatcher-test-support.mjs';

test('review-cap resume rejects a remote manifest for a different PR', () => {
  const { root, statePath, fake, remote } = createPrMismatchScenario();

  assert.throws(
    () => resolveReviewCap(resumeDecision(), {}, statePath, root, undefined, fake.host, remote),
    /remote manifest belongs to a different PR/,
  );

  rmSync(root, { recursive: true, force: true });
});

function createPrMismatchScenario() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-pr-mismatch-'));
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
    pr: 8,
    branch: 'codex/issue-1',
    baseSha: 'abc1234',
    configFingerprint: 'config-v1',
    phase: 'blocked',
    reviewRound: 2,
    contextCursor: '',
    artifacts: [artifactKey('run', { issue: 1, runId: 'remote-run' })],
  };
  const remote = {
    snapshot: () => ({ issue: 1, pr: 7, prState: 'OPEN', branch: 'codex/issue-1', manifest }),
  };
  const fake = createMismatchGitHubHost();
  return { root, statePath, fake, remote };
}

function createMismatchGitHubHost() {
  return createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify({
        number: 7,
        state: 'OPEN',
        headRefName: 'codex/issue-1',
        headRefOid: 'abc1234',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        comments: [],
      });
    }
    return '';
  });
}

function resumeDecision() {
  return {
    steer: 'resume the reviewed work',
    abandon: false,
    waiveAllOutstanding: false,
    waivedFindingIds: [],
    additionalRounds: 1,
  };
}

import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, vi } from 'vitest';
import {
  acquire,
  childProcessInvocation,
  checkoutWorkerBranch,
  CliFailure,
  command,
  dispatcherLockPath,
  defaultProcessAlive,
  dispatch,
  eligible,
  linkIssueToActiveRun,
  pullRequest,
  pullRequestBody,
  prepareWorkerBranch,
  prepareRecovery,
  recoverStaleLock,
  resolveReviewCap,
  resolveExecutable,
  runSyncCommand,
  redactDiagnostic,
  readState,
  reviewFeedback,
  workerBranchName,
  withIssueClosingReference,
  resetRunState,
  runCommand,
  hasCommit,
  runDispatcherCli,
  updatePullRequestBody,
  commentPullRequest,
  writeState,
  maxRoundsForUserBudget,
  selectIssues,
} from '../src/dispatcher.js';
import { parseDispatcherCommand as parseDispatcherCommandResult } from '../src/runtime.js';
import { issueLabelNames } from '../src/issue-selection.js';
import { artifactKey, runManifestMarker } from '../src/remote-state.js';

const parseDispatcherCommand = (args) => {
  const parseResult = parseDispatcherCommandResult(args);
  if (parseResult.ok) return parseResult.value;
  throw new Error(parseResult.error);
};

test('additional rounds mean future rounds from the current round', () => {
  assert.equal(maxRoundsForUserBudget(3, 9, 2), 10);
  assert.equal(maxRoundsForUserBudget(3, 2, 2), 3);
  assert.equal(maxRoundsForUserBudget(3, 9, 6), 14);
  assert.equal(maxRoundsForUserBudget(3, 9, 0), 3);
});

test('shared issue selector orders configured priorities then numeric ties', () => {
  const issues = [
    { number: 20, title: 'unprioritized' },
    { number: 12, title: 'p1', labels: ['Priority: P1'] },
    { number: 8, title: 'p0 later', labels: ['Priority: P0'] },
    { number: 3, title: 'p0 first', labels: ['Priority: P0'] },
  ];

  assert.deepEqual(
    selectIssues(issues, ['Priority: P0', 'Priority: P1']).map(({ number }) => number),
    [3, 8, 12, 20],
  );
});

test('issue label normalization accepts GitHub label objects', () => {
  assert.deepEqual(issueLabelNames([{ name: 'Priority: P0' }, 'Automation Ready']), [
    'Priority: P0',
    'Automation Ready',
  ]);
});

test('public command and commit helpers cover optional and invalid inputs', async () => {
  assert.equal(command(undefined, 1), undefined);
  assert.deepEqual(command(['node', '-e', ''], 1), {
    command: 'node',
    args: ['-e', ''],
    timeoutMs: 120000,
    retries: 0,
    logInvocation: undefined,
  });
  assert.deepEqual(command({ command: 'node', args: [] }, 1), {
    command: 'node',
    args: [],
    timeoutMs: 120000,
    retries: 0,
    logInvocation: undefined,
  });
  assert.throws(() => command({ command: 'node && bad', args: [] }, 1), /shell operators/);
  assert.throws(() => command({ command: 'node', args: ['ok', 1] }, 1), /string array/);
  assert.equal(await runCommand(undefined), '');
  assert.equal(hasCommit(undefined, undefined), true);
  assert.equal(hasCommit(undefined, 'abc'), false);
  assert.equal(hasCommit('not evidence', 'abc'), false);
  assert.equal(hasCommit('commit=abc\n', 'abcdef'), true);
  assert.equal(hasCommit('commit=abcdef', 'abc'), false);
  assert.equal(
    withIssueClosingReference('Closes #2\nBody', 2, [2, 4]),
    'Body\n\nCloses #2\nCloses #4',
  );
  assert.equal(withIssueClosingReference('Body', 2), 'Body\n\nCloses #2');
  assert.equal(withIssueClosingReference('', 7), 'Closes #7');
  assert.throws(() => maxRoundsForUserBudget(-1, 1, 0), /base review-round/);
  assert.throws(() => maxRoundsForUserBudget(1, 0, 0), /current review round/);
  assert.throws(() => maxRoundsForUserBudget(1, 1, -1), /additional review rounds/);
});

test('remaining public failure boundaries are deterministic', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-dispatcher-boundaries-'));

  assert.equal(recoverStaleLock(root), 'No dispatcher lock found.');
  mkdirSync(dispatcherLockPath(root), { recursive: true });
  writeFileSync(join(dispatcherLockPath(root), 'owner.json'), 'not-json');
  assert.throws(() => recoverStaleLock(root), /owner is invalid/);
  assert.equal(defaultProcessAlive(2147483647), false);
  await assert.rejects(
    runCommand(
      command(
        { command: 'sloop-definitely-missing-executable-coverage', args: [], timeoutMs: 100 },
        1,
      ),
      root,
    ),
    /failed/,
  );
});

test('review feedback includes only matching QA review bodies for the requested round', () => {
  assert.equal(
    reviewFeedback(
      {
        number: 7,
        headRefOid: 'abc',
        reviews: [
          { body: '[QA/SDET Review] round=1 verdict=passed', commitId: 'abc' },
          { body: '[QA/SDET Review] round=2 verdict=blocked', commitId: 'abc' },
          { body: '[Staff Review] round=2 verdict=approved', commitId: 'abc' },
        ],
      },
      '[QA/SDET Review]',
      2,
    ),
    '[QA/SDET Review] round=2 verdict=blocked',
  );
});

function createMockGitHubHost(respond) {
  const calls = [];
  return {
    calls,
    host: {
      platform: 'linux',
      pid: () => 123,
      now: () => 1_700_000_000_000,
      resolveExecutable: () => 'gh',
      runSyncCommand: (_command, args, _input, _platform, _comSpec, cwd) => {
        calls.push({ args, cwd });
        return respond(args, cwd);
      },
    },
  };
}

test('native dispatcher GitHub operations preserve argv, repository scoping, and response normalization', () => {
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'issue' && args[1] === 'list')
      return JSON.stringify([
        { number: 9, title: 'later' },
        { number: 2, title: 'first' },
      ]);
    if (args[0] === 'pr' && args[1] === 'view' && args.some((arg) => arg.includes('number,state')))
      return JSON.stringify({
        number: 7,
        body: undefined,
        merge_state_status: 'CLEAN',
        reviews: [{ body: 'review', submitted_at: 'two', commit: { oid: 'abc' } }],
        comments: [{ body: 'comment', created_at: 'one' }],
        statusCheckRollup: [{ context: 'pr-checks', state: 'SUCCESS', details_url: 'https://x' }],
      });
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({});
    return '';
  });

  // Arrange / Act / Assert: each operation receives only the adapter host.
  assert.deepEqual(
    eligible('/repo', 'owner/repo', 'ready', fake.host).map(({ number }) => number),
    [2, 9],
  );
  const normalized = pullRequest(7, '/repo', 'owner/repo', fake.host);
  assert.equal(normalized.number, 7);
  assert.equal(normalized.body, '');
  assert.equal(normalized.mergeStateStatus, 'CLEAN');
  assert.deepEqual(normalized.reviews, [
    { body: 'review', state: undefined, submittedAt: 'two', commitId: 'abc' },
  ]);
  assert.deepEqual(normalized.comments, [{ body: 'comment', createdAt: 'one' }]);
  assert.deepEqual(normalized.statusCheckRollup, [
    { name: 'pr-checks', status: 'SUCCESS', conclusion: 'SUCCESS', detailsUrl: 'https://x' },
  ]);
  assert.equal(pullRequestBody(7, '/repo', 'owner/repo', fake.host), '');
  assert.equal(
    fake.calls.every(({ args }) => args.slice(-2).join(' ') === '--repo owner/repo'),
    true,
  );
});

test('native dispatcher GitHub writes redact bodies, clean temporary files, and classify execution failures', () => {
  let bodyFile;
  const fake = createMockGitHubHost((args) => {
    if (args.includes('--body-file')) {
      bodyFile = args.at(-1);
      assert.equal(readFileSync(bodyFile, 'utf8'), 'safe body');
    }
    return '';
  });

  updatePullRequestBody(7, 'safe body', '/repo', undefined, fake.host);
  commentPullRequest(7, 'safe body', '/repo', undefined, fake.host);

  assert.equal(existsSync(bodyFile), false);
  assert.deepEqual(
    fake.calls.map(({ args }) => args.slice(0, 3)),
    [
      ['pr', 'edit', '7'],
      ['pr', 'comment', '7'],
    ],
  );
  assert.throws(
    () => commentPullRequest(7, { invalid: true }, '/repo', undefined, fake.host),
    TypeError,
  );

  const failing = createMockGitHubHost(() => {
    throw new Error('offline');
  });
  assert.throws(
    () => eligible('/repo', undefined, 'ready', failing.host),
    (error) => error instanceof CliFailure && error.exitCode === 5 && /offline/.test(error.message),
  );
  const invalidJson = createMockGitHubHost(() => '{broken');
  assert.throws(
    () => pullRequestBody(7, '/repo', undefined, invalidJson.host),
    /gh returned invalid JSON/,
  );
});

test('dispatcher state persistence, PID probe, and link operations remain deterministic through injected GitHub host', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-dispatcher-host-'));
  const statePath = join(root, 'state.json');

  assert.deepEqual(readState(statePath), {});
  writeFileSync(statePath, '{bad');
  assert.match(readState(statePath).lastError, /state corruption/);
  writeState({ issue: 1, status: 'claimed' }, statePath);
  assert.equal(readState(statePath).issue, 1);
  assert.throws(
    () => linkIssueToActiveRun(2, statePath, root),
    /one active run with an existing PR/,
  );
  assert.equal(defaultProcessAlive(-1), false);
  assert.equal(defaultProcessAlive(process.pid), true);

  writeState({ issue: 1, pr: 7, status: 'claimed', linkedClosingIssues: [4] }, statePath);
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({ body: 'Summary', comments: [] });
    if (args[0] === 'issue' && args[1] === 'view')
      return JSON.stringify({ number: 2, state: 'OPEN', comments: [] });
    return '';
  });
  linkIssueToActiveRun(2, statePath, root, undefined, fake.host);
  assert.deepEqual(readState(statePath).linkedClosingIssues, [4, 2]);
  assert.equal(
    fake.calls.some(({ args }) => args[0] === 'pr' && args[1] === 'edit'),
    true,
  );
  assert.equal(
    fake.calls.filter(({ args }) => args[0] === 'issue' && args[1] === 'comment').length,
    2,
  );
  assert.equal(
    fake.calls.some(({ args }) => args[0] === 'pr' && args[1] === 'comment'),
    true,
  );
});

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

test.each([
  [
    'missing remote manifest',
    { issue: 1, pr: 7, prState: 'OPEN', branch: 'codex/issue-1' },
    /requires a valid remote run manifest/,
  ],
  [
    'closed remote PR',
    {
      issue: 1,
      pr: 7,
      prState: 'CLOSED',
      branch: 'codex/issue-1',
      manifest: {
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
      },
    },
    /could not reconcile the same open PR and head branch/,
  ],
])('review-cap resume rejects %s before changing local state', (_name, snapshot, expectedError) => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-remote-guard-'));
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
  const remote = { snapshot: () => snapshot };
  const options = {
    steer: 'resume the reviewed work',
    abandon: false,
    waiveAllOutstanding: false,
    waivedFindingIds: [],
    additionalRounds: 1,
  };

  assert.throws(
    () => resolveReviewCap(options, {}, statePath, root, undefined, {}, remote),
    expectedError,
  );
  assert.equal(readState(statePath).status, 'review_cap_pending');
  rmSync(root, { recursive: true, force: true });
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

test('review-cap resume rejects a remote manifest for a different PR', () => {
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
        headRefName: 'codex/issue-1',
        headRefOid: 'abc1234',
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
    /remote manifest belongs to a different PR/,
  );

  rmSync(root, { recursive: true, force: true });
});

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

test('prepared remote recovery rejects a manifest branch mismatch', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    prNumber: 7,
    initialState: {
      issue: 1,
      pr: 7,
      branch: 'codex/issue-1',
      status: 'worker_recovery_pending',
      workerRunId: 'prepared-run',
      preparedRecovery: true,
      reviewRound: 1,
    },
  });
  const manifest = {
    protocol: 1,
    runId: 'prepared-run',
    issue: 1,
    branch: 'codex/issue-99',
    baseSha: 'abc1234',
    configFingerprint: 'config-v1',
    phase: 'blocked',
    reviewRound: 1,
    contextCursor: '',
    artifacts: [artifactKey('run', { issue: 1, runId: 'prepared-run' })],
  };
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      protocol: 1,
      issue: 1,
      pr: 7,
      prState: 'OPEN',
      branch: 'pending',
      manifest,
      markers: ['sloop/v1/run/prepared-run'],
    }),
    reconcile: () => true,
    claim: () => {},
    publish: () => {},
  };

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /manifest branch/);
});

test('dispatcher rejects unsupported production configuration before starting a run', async () => {
  const dispatcherHarness = createMockDispatcherHarness();

  await assert.rejects(
    () =>
      dispatch(
        { ...dispatcherHarness.cfg, codexSandbox: 'read-only' },
        dispatcherHarness.dependencies,
      ),
    /codexSandbox is no longer supported/,
  );
  await assert.rejects(
    () =>
      dispatch({ ...dispatcherHarness.cfg, baseBranch: 'develop' }, dispatcherHarness.dependencies),
    /baseBranch must be main/,
  );
  await assert.rejects(
    () =>
      dispatch(dispatcherHarness.cfg, {
        ...dispatcherHarness.dependencies,
        remoteRequired: true,
        remote: undefined,
      }),
    /remote authority is required/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('dispatcher reports missing required role commands after acquiring its lock', async () => {
  const dispatcherHarness = createMockDispatcherHarness();

  await assert.rejects(
    () =>
      dispatch(
        { ...dispatcherHarness.cfg, workerCommand: undefined },
        dispatcherHarness.dependencies,
      ),
    /workerCommand and qaCommand are required/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('dispatcher requires a valid Codex sandbox on role commands', async () => {
  const dispatcherHarness = createMockDispatcherHarness();

  await assert.rejects(
    () =>
      dispatch(
        {
          ...dispatcherHarness.cfg,
          workerCommand: { command: 'codex', args: ['exec'] },
        },
        dispatcherHarness.dependencies,
      ),
    /exactly one valid --sandbox/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('dispatcher rejects legacy argv arrays for role commands', async () => {
  const dispatcherHarness = createMockDispatcherHarness();

  await assert.rejects(
    () =>
      dispatch(
        {
          ...dispatcherHarness.cfg,
          workerCommand: ['codex', 'exec'],
        },
        dispatcherHarness.dependencies,
      ),
    /role commands must be/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('workflow command delegates to dispatch and completes when no issue is eligible', async () => {
  const dispatcherHarness = createMockDispatcherHarness([]);
  dispatcherHarness.dependencies.eligible = () => [];

  const result = await runDispatcherCli({ kind: 'workflow' }, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'done');
  assert.equal(dispatcherHarness.runs.length, 0);
});

test('dispatcher CLI worktree controls and checkout retain their direct contracts', async () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  dispatcherHarness.dependencies.listAllWorktrees = () => ['one'];
  dispatcherHarness.dependencies.clearAllWorktrees = () => calls.push('clear');
  await runDispatcherCli({ kind: 'list-all-worktrees' }, dispatcherHarness.dependencies);
  await runDispatcherCli({ kind: 'clear-all-worktrees' }, dispatcherHarness.dependencies);

  assert.deepEqual(calls, ['clear']);

  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-checkout-'));
  const runGitCommand = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  runGitCommand(['init', '--initial-branch=main']);
  runGitCommand(['config', 'user.email', 'test@example.test']);
  runGitCommand(['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'README.md'), 'one');
  runGitCommand(['add', '.']);
  runGitCommand(['commit', '-m', 'initial']);
  runGitCommand(['branch', 'worker']);
  checkoutWorkerBranch('worker', root);
  const current = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
  assert.equal(current.stdout.trim(), 'worker');
});

test('review-cap abandonment resumes safely after partial side effects', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-abandon-host-'));
  const statePath = join(root, 'state.json');
  const state = {
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
  writeState(state, statePath);
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ comments: [] });
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ number: 7, comments: [] });
    return '';
  });
  const abandon = {
    steer: 'stop safely',
    abandon: true,
    waiveAllOutstanding: false,
    waivedFindingIds: [],
    additionalRounds: 0,
  };

  resolveReviewCap(abandon, {}, statePath, root, undefined, fake.host);

  assert.equal(readState(statePath).status, 'abandoned');
  assert.equal(
    fake.calls.some(({ args }) => args.slice(0, 2).join(' ') === 'pr close'),
    true,
  );
  assert.equal(
    fake.calls.some(({ args }) => args.slice(0, 2).join(' ') === 'issue edit'),
    true,
  );
  assert.equal(
    fake.calls.some(({ args }) => args.slice(0, 2).join(' ') === 'issue close'),
    true,
  );

  writeState(
    {
      ...state,
      status: 'abandon_pending',
      abandonment: {
        steer: 'stop safely',
        commentPublished: true,
        prClosed: true,
        labelled: true,
        issueClosed: true,
      },
    },
    statePath,
  );
  const resumed = createMockGitHubHost(() => {
    throw new Error('completed actions must not repeat');
  });
  resolveReviewCap(abandon, {}, statePath, root, undefined, resumed.host);
  assert.equal(readState(statePath).status, 'abandoned');
});

test('Windows batch commands use cmd.exe without Node shell mode', () => {
  assert.deepEqual(
    childProcessInvocation(
      'C:\\tools\\codex.cmd',
      ['exec', '--full-auto'],
      'win32',
      'C:\\Windows\\System32\\cmd.exe',
    ),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/v:off', '/c', '""C:\\tools\\codex.cmd" "exec" "--full-auto""'],
      windowsVerbatimArguments: true,
    },
  );
});

test('Windows executable resolution selects an npm command shim', () => {
  assert.equal(
    resolveExecutable('codex', 'win32', () => [
      'C:\\Program Files\\nodejs\\codex',
      'C:\\Program Files\\nodejs\\codex.cmd',
      'C:\\tools\\codex.exe',
    ]),
    'C:\\Program Files\\nodejs\\codex.cmd',
  );
});

test('executable resolution leaves Unix commands and explicit paths unchanged', () => {
  const unexpectedLookup = () => {
    throw new Error('lookup should not run');
  };

  assert.equal(resolveExecutable('codex', 'linux', unexpectedLookup), 'codex');
  assert.equal(
    resolveExecutable('C:\\tools\\codex.exe', 'win32', unexpectedLookup),
    'C:\\tools\\codex.exe',
  );
});

test('Windows batch commands execute from paths containing spaces', (t) => {
  if (process.platform !== 'win32') {
    t.skip('requires Windows cmd.exe');
    return;
  }

  const directory = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop batch command-'));
  const executable = join(directory, 'echo argument.cmd');
  writeFileSync(executable, '@echo off\r\necho %~1\r\n');

  try {
    const launch = childProcessInvocation(executable, ['expected'], 'win32', process.env.ComSpec);
    const result = spawnSync(launch.command, launch.args, {
      encoding: 'utf8',
      shell: false,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'expected');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows batch commands reject cmd.exe syntax in argv before launch', () => {
  assert.throws(
    () =>
      childProcessInvocation(
        'C:\\tools\\codex.cmd',
        ['SAFE" & echo INJECTED & rem "'],
        'win32',
        'C:\\Windows\\System32\\cmd.exe',
      ),
    /unsafe cmd\.exe syntax/,
  );
});

test('synchronous Windows batch shims preserve verbatim cmd.exe command text', () => {
  let invocation;
  const output = runSyncCommand(
    'C:\\Program Files\\GitHub CLI\\gh.cmd',
    ['pr', 'view', '40'],
    (command, args, options) => {
      invocation = { command, args, options };
      return 'ok';
    },
    'win32',
    'C:\\Windows\\System32\\cmd.exe',
  );

  assert.equal(output, 'ok');
  assert.deepEqual(invocation, {
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: [
      '/d',
      '/s',
      '/v:off',
      '/c',
      '""C:\\Program Files\\GitHub CLI\\gh.cmd" "pr" "view" "40""',
    ],
    options: {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: true,
    },
  });
});

test('non-batch commands preserve their executable and arguments', () => {
  assert.deepEqual(childProcessInvocation('codex', ['exec'], 'win32'), {
    command: 'codex',
    args: ['exec'],
  });
});

const baseConfig = {
  baseBranch: 'main',
  workerCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },
  staffReviewCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },
  qaCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },
  requiredPrChecks: ['pr-checks'],
  checkPollIntervalMs: 0,
  checkTimeoutMs: 1000,
  evidencePollIntervalMs: 0,
  evidenceTimeoutMs: 1000,
  workerLeaseMs: 100,
  maxReviewRounds: 5,
};

function createExistingHumanReviewGuide(commit = 'abc1') {
  return `[Human Review Guide] round=1 commit=${commit}\n<!-- sloop-dispatcher-human-review-guide -->\n\nSummary\nExercise the CLI change.\n\nSteps\n1. Run the focused command in a temporary directory.\n\nExpected results\n- The documented output appears.\n\nIsolation\nUse a temporary checkout and no credentials.\n\nLimitations / diagnostics\n- A failed command indicates the change is not ready.\n\nApproval checklist\n- [ ] Behavior matches the acceptance criteria.`;
}

function createMockDispatcherHarness(
  issues = [{ number: 1, title: 'one', body: 'acceptance criteria' }],
  overrides = {},
) {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-'));
  let state = overrides.initialState ?? {};
  const saves = [];
  const comments = [];
  const runs = [];
  const prBodyUpdates = [];
  const createdPrBodies = [];
  const createdIssues = [];
  const reviews = [];
  let activeLogger;
  const pr = {
    number: overrides.prNumber ?? 14,
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: overrides.headRefName ?? 'codex/issue-1',
    headRefOid: 'abc0',
    body: overrides.prBody ?? 'Summary',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    comments: [],
    reviews,
    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
  let workerCount = 0;
  let qaCount = 0;
  let staffCount = 0;
  const qaVerdicts = overrides.qaVerdicts ?? ['passed'];
  const staffVerdicts = overrides.staffVerdicts ?? ['approved'];
  const qaBodies = overrides.qaBodies;
  const staffBodies = overrides.staffBodies;
  const publishEvidence = {
    worker: true,
    qa: true,
    staff: true,
    ...(overrides.publishEvidence ?? {}),
  };
  const humanVerification = overrides.humanVerification ?? true;
  for (let guide = 0; guide < (overrides.existingHumanGuides ?? 0); guide += 1)
    pr.comments.push({ body: createExistingHumanReviewGuide() });
  if (overrides.malformedHumanGuide)
    pr.comments.push({
      body: '[Human Review Guide] round=1 commit=abc1\n<!-- sloop-dispatcher-human-review-guide -->',
    });
  const checkSequences = overrides.checkSequences ?? [pr.statusCheckRollup];
  let checkIndex = 0;

  const getAgentRole = (spec) => {
    if (spec.input?.includes('Use the worker skill')) return 'worker';
    if (spec.input?.includes('Use the sloop-qa skill')) return 'qa';
    if (spec.input?.includes('Use the staff-reviewer skill')) return 'staff';
    if (spec.input?.includes('Use the Arbiter contract')) return 'arbiter';
    return 'unknown';
  };

  const dependencies = {
    root,
    load: () => state,
    save: (next) => {
      saves.push(structuredClone(next));
      state = next;
    },
    loadConfig: () => ({ ...baseConfig, ...overrides.config }),
    setRunLogger: (logger) => {
      activeLogger = logger;
    },
    runContext: () => ({ originalRepository: root, executionRoot: root }),
    status: (verbose) =>
      verbose
        ? state
        : { issue: state.issue, pr: state.pr, status: state.status, lastError: state.lastError },
    list: () => issues.map(({ number, title }) => ({ number, title })),
    recoverLock: () => 'recovered',
    reset: () => {
      state = resetRunState(state, () => false);
    },
    resolveReviewCap: () => {},
    linkIssue: () => {},
    prepareRecovery: (issue, requestedPr) => {
      const number = requestedPr ?? state.pr;
      state = prepareRecovery(state, issue, number, Date.now(), 100);
      return number;
    },
    eligible: () => issues,
    comment: (issue, body) => comments.push([issue, body]),
    run: async (spec) => {
      runs.push(spec);
      const role = getAgentRole(spec);
      spec.onStdout?.(`${role} stdout ✓\nline two\n`);
      spec.onStderr?.(`${role} stderr\nline err\n`);
      const round = Number(spec.input?.match(/review round (\d+)/)?.[1] ?? 1);
      if (role === 'worker') {
        workerCount += 1;
        pr.headRefOid = `abc${workerCount}`;
        if (overrides.workerCreatesPr) {
          // Model the Worker passing the dispatcher-owned payload directly to
          // `gh pr create --body-file`; this is the initial remote PR body.
          pr.body = spec.env.SLOOP_PR_BODY;
          createdPrBodies.push(pr.body);
        }
        spec.onStart?.(1000 + workerCount);
        spec.onHeartbeat?.();
        if (publishEvidence.worker) {
          const verification = humanVerification
            ? '\n\n[Human Verification]\n1. Run the focused command in a temporary directory.\n2. Confirm the documented output appears.'
            : '';
          pr.comments.push({
            body: `[Worker] round=${round} status=ready_for_review pr=${pr.number} base=main commit=${pr.headRefOid}${verification}`,
            createdAt: `${workerCount}`,
          });
        }
        return `WORKER_RESULT pr=${pr.number} base=main`;
      }
      if (role === 'qa') {
        qaCount += 1;
        const verdict = qaVerdicts[qaCount - 1] ?? qaVerdicts.at(-1);
        if (publishEvidence.qa)
          (overrides.qaPublication === 'review' ? reviews : pr.comments).push({
            body:
              qaBodies?.[qaCount - 1] ??
              `[QA/SDET Review] round=${round} verdict=${verdict} commit=${pr.headRefOid}`,
            commitId: pr.headRefOid,
            submittedAt: `${qaCount}`,
            createdAt: `${qaCount}`,
          });
        return 'QA completed';
      }
      if (role === 'staff') {
        staffCount += 1;
        const verdict = staffVerdicts[staffCount - 1] ?? staffVerdicts.at(-1);
        if (publishEvidence.staff)
          reviews.push({
            body:
              staffBodies?.[staffCount - 1] ??
              `[Staff Review] round=${round} verdict=${verdict} commit=${pr.headRefOid}`,
            commitId: pr.headRefOid,
            submittedAt: `${staffCount}`,
          });
        return 'Staff completed';
      }
      if (role === 'arbiter') {
        const record = JSON.parse(spec.input.split('Record:\n')[1]);
        return JSON.stringify({
          schema: 'sloop.agent-output/v1',
          context: {
            run: record.state.workerRunId ?? `arbiter-${record.round}`,
            issue: record.issue.number,
            pr: record.pr.number,
            round: record.round,
            sha: record.pr.headRefOid ?? 'unknown',
            cursor: `arbiter-${record.round}`,
          },
          producer: 'arbiter',
          status: overrides.arbiterAction ?? 'uphold',
          payload: {
            rationale: 'Conflict analysis against the contract justifies this decision.',
            references: ['QA feedback'],
            decisions: [
              {
                findingId: overrides.arbiterFindingId ?? 'Q1',
                owner: 'qa',
                action: overrides.arbiterAction ?? 'uphold',
                rationale:
                  'Conflict between the review arguments; analysis against contract, product and UX justifies this decision.',
                direction: 'Apply the requested correction.',
                verification: 'Run the repository gate and repeat QA.',
                ...(overrides.arbiterAction === 'defer'
                  ? {
                      followUp: {
                        title: 'Deferred Arbiter follow-up',
                        acceptance: 'The deferred finding is implemented and verified.',
                        context: 'Relevant review context and source evidence.',
                      },
                    }
                  : {}),
              },
            ],
          },
        });
      }
      return 'completed';
    },
    pullRequest: () => {
      pr.statusCheckRollup = checkSequences[Math.min(checkIndex++, checkSequences.length - 1)];
      return structuredClone(pr);
    },
    updatePullRequestBody: async (number, body) => {
      assert.equal(number, pr.number);
      pr.body = body;
      prBodyUpdates.push({ number, body });
    },
    pullRequestBody: () => pr.body,
    prComment: (number, body) => {
      assert.equal(number, pr.number);
      pr.comments.push({ body });
    },
    createIssue: (title, body) => {
      createdIssues.push({ title, body });
      return 99;
    },
    now: () => Date.now(),
    pid: () => process.pid,
    processAlive: (pid) => pid > 0 && pid !== -1,
    sleep: async () => {},
    onReclaim: () => {},
    tryAcquire: () => true,
    readOwner: () => {
      throw new Error('lock owner unavailable');
    },
    tryBeginReclaim: () => true,
    readReclaimOwner: () => {
      throw new Error('reclaim owner unavailable');
    },
    reclaimAgeMs: () => 0,
    finishReclaim: () => {},
    abandonReclaim: () => {},
    release: () => {},
    prepareWorkerBranch: (issue) => ({
      branch: workerBranchName(issue),
      mainBaseSha: 'main-sha-1',
    }),
    checkoutWorkerBranch: () => {},
  };

  return {
    root,
    pr,
    comments,
    runs,
    reviews,
    saves,
    dependencies,
    state: () => state,
    setState: (next) => {
      state = next;
    },
    counts: () => ({ workerCount, qaCount, staffCount }),
    prBodyUpdates,
    createdPrBodies,
    createdIssues,
    cfg: { ...baseConfig, ...overrides.config },
  };
}

// Reduced response from the failing PR #109 query: old GitHub reviews and a
// current QA comment. No gh process or agent is launched by these tests.
function createQaCommentResponse() {
  const head = '43bc61cc0c7b0476f668a6e4f3a920386497f329';
  return {
    number: 109,
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: 'codex/issue-100-6224',
    headRefOid: head,
    body: 'Closes #100',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    reviews: [
      {
        body: '[QA/SDET Review] round=1 verdict=changes_requested',
        commit: { oid: '58787024de7f99884f00d57480bc76edf66cb2a1' },
        submittedAt: '2026-09-30T16:24:27Z',
      },
      {
        body: '[QA/SDET Review] round=2 verdict=changes_requested',
        commit: { oid: '497a24db1037c4a1da331b18d4ef0922a29031a7' },
        submittedAt: '2026-09-30T16:33:03Z',
      },
    ],
    comments: [
      {
        body: `[Worker] round=2 status=ready_for_review pr=109 base=main commit=${head}\n\n[Human Verification]\n1. Load configuration with an unknown key.\n2. Confirm it warns and loads successfully.`,
        createdAt: '2026-10-01T08:47:27Z',
      },
      {
        body: `[QA/SDET Review] round=2 verdict=passed\n\ncommit=${head}\n\n- [Q1] pass - Unknown keys warn and are ignored.`,
        createdAt: '2026-10-01T08:48:42Z',
      },
    ],
    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
}

test('gh response with a current QA comment selects passed instead of old GitHub reviews', () => {
  // Arrange
  const raw = createQaCommentResponse();
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  // Act: use the real gh adapter and the real dispatcher evidence selector.
  const pr = pullRequest(109, '/repo', 'h-4vok/sloop', fake.host);
  const feedback = reviewFeedback(pr, '[QA/SDET Review]', 2);
  // Assert
  assert.equal(feedback, raw.comments[1].body);
  assert.ok(
    fake.calls[0].args.includes('comments,statusCheckRollup') ||
      fake.calls[0].args.some((arg) => arg.includes('reviews,comments')),
  );
  assert.deepEqual(fake.calls[0].args.slice(-2), ['--repo', 'h-4vok/sloop']);
});

test('recovery consumes current Worker and QA comments without rerunning agents or creating a branch', async () => {
  // Arrange
  const raw = createQaCommentResponse();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 100, title: 'Unknown keys' }], {
    prNumber: 109,
    headRefName: raw.headRefName,
    initialState: {
      issue: 100,
      pr: 109,
      branch: raw.headRefName,
      headSha: raw.headRefOid,
      workerRunId: 'recovery-run',
      status: 'worker_recovery_pending',
      reviewRound: 2,
      lastError: 'QA evidence missing',
      lastErrorVerbose: 'QA evidence missing',
    },
  });
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  dispatcherHarness.dependencies.pullRequest = () =>
    pullRequest(109, dispatcherHarness.root, 'h-4vok/sloop', fake.host);
  dispatcherHarness.dependencies.run = async () => {
    throw new Error('existing valid evidence must not rerun agents');
  };
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('recovery must not create a branch');
  };
  // Act
  const exit = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(exit, 0);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.state().pr, 109);
  assert.equal(dispatcherHarness.state().branch, raw.headRefName);
  assert.equal(dispatcherHarness.state().lastQaFeedback, raw.comments[1].body);
  assert.equal(dispatcherHarness.state().lastError, undefined);
  assert.equal(dispatcherHarness.state().lastErrorVerbose, undefined);
});

test('recovery continues to QA when valid Worker evidence exists without a QA comment', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      headSha: 'abc0',
      workerRunId: 'recovery-run',
      status: 'worker_recovery_pending',
      reviewRound: 1,
    },
  });
  const loadPullRequest = dispatcherHarness.dependencies.pullRequest;
  const workerEvidence =
    '[Worker] round=1 status=ready_for_review pr=14 base=main commit=abc0\n\n[Human Verification]\n\n1. Open the file.\n2. Confirm its content.';
  dispatcherHarness.dependencies.pullRequest = async (...args) => {
    const evidence = await loadPullRequest(...args);
    return {
      ...evidence,
      comments: [
        { body: workerEvidence, createdAt: '1' },
        ...evidence.comments.filter((comment) => !comment.body?.startsWith('[Worker]')),
      ],
    };
  };

  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(dispatcherHarness.counts().workerCount, 0);
  assert.equal(dispatcherHarness.counts().qaCount, 1);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

for (const [condition, body] of [
  ['another round', '[QA/SDET Review] round=1 verdict=passed commit=HEAD'],
  ['another SHA', '[QA/SDET Review] round=2 verdict=passed commit=stale'],
  ['missing SHA', '[QA/SDET Review] round=2 verdict=passed'],
  ['missing verdict', '[QA/SDET Review] round=2 commit=HEAD'],
  ['unknown verdict', '[QA/SDET Review] round=2 verdict=looks_good commit=HEAD'],
  ['quoted marker', 'Copied: [QA/SDET Review] round=2 verdict=passed commit=HEAD'],
]) {
  test(`QA comment with ${condition} is not accepted as current evidence`, () => {
    // Arrange
    const raw = createQaCommentResponse();
    raw.comments[1].body = body.replace('HEAD', raw.headRefOid);
    const fake = createMockGitHubHost(() => JSON.stringify(raw));
    // Act
    const feedback = reviewFeedback(
      pullRequest(109, '/repo', 'h-4vok/sloop', fake.host),
      '[QA/SDET Review]',
      2,
    );
    // Assert
    assert.equal(feedback, '');
  });
}

test('latest matching QA publication wins across comments and legacy reviews regardless of array order', () => {
  // Arrange
  const raw = createQaCommentResponse();
  const older = {
    body: `[QA/SDET Review] round=2 verdict=blocked commit=${raw.headRefOid}`,
    createdAt: '2026-10-01T08:48:00Z',
  };
  const newest = {
    body: '[QA/SDET Review] round=2 verdict=changes_requested',
    commit: { oid: raw.headRefOid },
    submittedAt: '2026-10-01T08:49:00Z',
  };
  raw.comments.push(older);
  raw.reviews.unshift(newest);
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  // Act
  const feedback = reviewFeedback(
    pullRequest(109, '/repo', 'h-4vok/sloop', fake.host),
    '[QA/SDET Review]',
    2,
  );
  // Assert
  assert.equal(feedback, newest.body);
});

test('legacy QA review with contradictory native and declared SHAs is rejected', () => {
  // Arrange
  const pr = {
    headRefOid: 'abc123',
    reviews: [{ body: '[QA/SDET Review] round=2 verdict=passed commit=stale', commitId: 'abc123' }],
  };
  // Act
  const feedback = reviewFeedback(pr, '[QA/SDET Review]', 2);
  // Assert
  assert.equal(feedback, '');
});

test('dispatcher still accepts a legacy GitHub QA review', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaPublication: 'review',
  });
  // Act
  const exit = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(exit, 0);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('blocked QA comment requests changes and preserves feedback at the round cap', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['blocked'],
    config: { maxReviewRounds: 1 },
  });
  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.ok(dispatcherHarness.saves.some((state) => state.status === 'qa_changes_requested'));
  assert.match(dispatcherHarness.state().lastQaFeedback, /verdict=blocked/);
});

test('QA comment is accepted when GitHub has no Pull Request Review objects', () => {
  // Arrange
  const raw = createQaCommentResponse();
  delete raw.reviews;
  const fake = createMockGitHubHost(() => JSON.stringify(raw));
  // Act
  const feedback = reviewFeedback(
    pullRequest(109, '/repo', 'h-4vok/sloop', fake.host),
    '[QA/SDET Review]',
    2,
  );
  // Assert
  assert.equal(feedback, raw.comments[1].body);
});

test('dispatcher rejects a QA comment for another SHA even when QA exits successfully', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaBodies: ['[QA/SDET Review] round=1 verdict=passed commit=stale'],
    config: { evidenceTimeoutMs: 1, evidencePollIntervalMs: 1 },
  });
  let clock = 0;
  dispatcherHarness.dependencies.now = () => clock;
  dispatcherHarness.dependencies.sleep = async () => {
    clock += 1;
  };
  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /round=1 commit=abc1/);
  assert.match(dispatcherHarness.state().lastError, /checked PR comments and GitHub reviews/);
});

test('dispatcher reconciles a PR when the Worker omits its result marker', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  const runWorkerRole = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    const output = await runWorkerRole(spec);
    return spec.input?.includes('Use the worker skill')
      ? 'Done. PR [#14](https://github.com/example/repo/pull/14) targets main.'
      : output;
  };

  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(dispatcherHarness.state().pr, 14);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(
    dispatcherHarness.runs.map(({ input }) => input.includes('Use the sloop-qa skill')),
    [false, true],
  );
});

test('dispatcher rejects an unrelated summary PR before changing its body', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    headRefName: 'codex/unrelated',
  });
  const runWorkerRole = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    const output = await runWorkerRole(spec);
    return spec.input?.includes('Use the worker skill') ? 'Done. PR #14 targets main.' : output;
  };

  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(dispatcherHarness.prBodyUpdates.length, 0);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /must use worker branch/);
});

test('HEAD changing during QA prevents acceptance of its passed comment', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  const originalRun = dispatcherHarness.dependencies.run;
  const originalPullRequest = dispatcherHarness.dependencies.pullRequest;
  let hasQaFinished = false;
  dispatcherHarness.dependencies.run = async (spec) => {
    const result = await originalRun(spec);
    if (spec.input?.includes('Use the sloop-qa skill')) hasQaFinished = true;
    return result;
  };
  dispatcherHarness.dependencies.pullRequest = async (...args) => {
    const pr = await originalPullRequest(...args);
    return hasQaFinished ? { ...pr, headRefOid: 'another-head' } : pr;
  };
  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // Assert
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /HEAD changed/);
});

test('post-preflight external adapter failures preserve exit 5', async () => {
  const dispatcherHarness = createMockDispatcherHarness([
    { number: 1, title: 'one', body: 'acceptance criteria' },
  ]);
  dispatcherHarness.dependencies.comment = () => {
    throw new CliFailure(5, 'gh issue comment failed: service unavailable');
  };

  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => error instanceof CliFailure && error.exitCode === 5,
  );

  assert.equal(dispatcherHarness.state().status, 'claimed');
});

test('reconciles a terminal persisted run before selecting another issue', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 2, title: 'next', body: 'criteria' }],
    {
      initialState: { issue: 1, pr: 14, branch: 'codex/issue-1', status: 'in_progress' },
    },
  );
  dispatcherHarness.dependencies.reconcileActiveRun = () => ({
    outcome: 'terminal',
    reason: 'PR merged; branch aligned',
    localSha: 'abc1',
    remoteSha: 'abc1',
  });

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().completedIssues.includes(1), true);
  assert.equal(dispatcherHarness.runs[0].env.SLOOP_ISSUE_NUMBER, '2');
  assert.equal(
    dispatcherHarness.saves.filter((state) => state.issue === 1 && state.status === 'done')
      .length >= 1,
    true,
  );
});

test('blocks before selection when terminal reconciliation cannot verify local work', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 2, title: 'next', body: 'criteria' }],
    {
      initialState: { issue: 1, pr: 14, branch: 'codex/issue-1', status: 'in_progress' },
    },
  );
  dispatcherHarness.dependencies.reconcileActiveRun = () => ({
    outcome: 'blocked',
    reason: 'uncommitted local work remains',
  });

  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    /uncommitted local work remains/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
  assert.equal(dispatcherHarness.state().status, 'blocked');
  assert.equal(dispatcherHarness.state().issue, 1);
});

test('repeated terminal reconciliation does not duplicate completed issues', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      status: 'in_progress',
      completedIssues: [1],
    },
  });
  dispatcherHarness.dependencies.reconcileActiveRun = () => ({
    outcome: 'terminal',
    reason: 'issue closed; branch aligned',
  });

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.deepEqual(dispatcherHarness.state().completedIssues, [1]);
  assert.equal(
    dispatcherHarness.saves.filter((state) => state.issue === 1 && state.status === 'done')
      .length >= 1,
    true,
  );
});

test('open persisted runs keep the existing active-run guard', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 2, title: 'next', body: 'criteria' }],
    {
      initialState: { issue: 1, pr: 14, branch: 'codex/issue-1', status: 'in_progress' },
    },
  );
  dispatcherHarness.dependencies.reconcileActiveRun = () => ({
    outcome: 'open',
    reason: 'PR remains open',
  });

  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    /active run exists for issue #1/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('public CLI commands invoke only the injected control seams', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: { issue: 28, pr: 49, status: 'blocked' },
  });
  const calls = [];
  dispatcherHarness.dependencies.loadConfig = () => (
    calls.push(['loadConfig']),
    dispatcherHarness.cfg
  );
  dispatcherHarness.dependencies.status = (verbose) => (
    calls.push(['status', verbose]),
    { status: 'injected' }
  );
  dispatcherHarness.dependencies.list = () => (
    calls.push(['list']),
    [{ number: 28, title: 'injected' }]
  );
  dispatcherHarness.dependencies.recoverLock = () => (
    calls.push(['recoverLock']),
    'injected recovery'
  );
  dispatcherHarness.dependencies.reset = () => calls.push(['reset']);
  dispatcherHarness.dependencies.resolveReviewCap = (args, config) =>
    calls.push(['resolveReviewCap', args, config]);
  dispatcherHarness.dependencies.linkIssue = (issue) => calls.push(['linkIssue', issue]);
  dispatcherHarness.dependencies.prepareRecovery = (issue, pr, config) => (
    calls.push(['prepareRecovery', issue, pr, config]),
    49
  );
  const originalLog = console.log;
  console.log = () => {};
  try {
    const dispatcherArgs = ['--status', '--verbose'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
    await runDispatcherCli(parsedDispatcherCommand, dispatcherHarness.dependencies);
    const dispatcherArgs2 = ['--list'];
    const parsedDispatcherCommand2 = parseDispatcherCommand(dispatcherArgs2);
    await runDispatcherCli(parsedDispatcherCommand2, dispatcherHarness.dependencies);
    const dispatcherArgs3 = ['--recover-lock'];
    const parsedDispatcherCommand3 = parseDispatcherCommand(dispatcherArgs3);
    await runDispatcherCli(parsedDispatcherCommand3, dispatcherHarness.dependencies);
    const dispatcherArgs4 = ['--reset'];
    const parsedDispatcherCommand4 = parseDispatcherCommand(dispatcherArgs4);
    await runDispatcherCli(parsedDispatcherCommand4, dispatcherHarness.dependencies);
    const dispatcherArgs5 = [
      '--resolve-review-cap',
      '--steer',
      'continue',
      '--additional-rounds',
      '1',
    ];
    const parsedDispatcherCommand5 = parseDispatcherCommand(dispatcherArgs5);
    await runDispatcherCli(parsedDispatcherCommand5, dispatcherHarness.dependencies);
    const dispatcherArgs6 = ['--link-issue', '29'];
    const parsedDispatcherCommand6 = parseDispatcherCommand(dispatcherArgs6);
    await runDispatcherCli(parsedDispatcherCommand6, dispatcherHarness.dependencies);
    const dispatcherArgs7 = ['--prepare-recovery', '28', '--pr', '49'];
    const parsedDispatcherCommand7 = parseDispatcherCommand(dispatcherArgs7);
    await runDispatcherCli(parsedDispatcherCommand7, dispatcherHarness.dependencies);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(
    calls.map(([name]) => name),
    [
      'status',
      'list',
      'recoverLock',
      'reset',
      'loadConfig',
      'resolveReviewCap',
      'linkIssue',
      'loadConfig',
      'prepareRecovery',
    ],
  );
  assert.deepEqual(
    calls.find(([name]) => name === 'status'),
    ['status', true],
  );
  assert.deepEqual(
    calls.find(([name]) => name === 'linkIssue'),
    ['linkIssue', 29],
  );
  assert.deepEqual(calls.find(([name]) => name === 'prepareRecovery').slice(0, 3), [
    'prepareRecovery',
    28,
    49,
  ]);
});

test('commands use argv, exit codes, retries, timeout and no shell contract', async () => {
  assert.deepEqual(command(['node', '-e', 'process.exit(0)'], 42, true).args, [
    '-e',
    'process.exit(0)',
  ]);
  assert.throws(() => command({ command: 'node; malicious' }, 1), /shell operators/);
  assert.throws(
    () => command({ command: 'codex' }, 1),
    /args as a string array; migrate each role command/,
  );
  assert.throws(
    () => command({ command: 'codex', args: ['exec', 1] }, 1),
    /args as a string array; migrate each role command/,
  );
  await assert.rejects(
    runCommand(command({ command: 'node', args: ['-e', 'process.exit(2)'], retries: 1 }, 0)),
    /failed after 2 attempt/,
  );
  await assert.rejects(
    () =>
      runCommand(
        command({ command: 'node', args: ['-e', 'setTimeout(()=>{},1000)'], timeoutMs: 10 }, 0),
      ),
    /failed/,
  );
});

test('role commands preserve distinct argv and logging configuration', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 1, title: 'one', body: 'criteria' }],
    {
      config: {
        workerCommand: {
          command: 'worker-codex',
          args: ['exec', '--sandbox', 'read-only', '--worker'],
        },
        qaCommand: { command: 'qa-codex', args: ['exec', '--sandbox', 'workspace-write', '--qa'] },
      },
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.deepEqual(
    dispatcherHarness.runs.map(({ command, args, logInvocation }) => ({
      command,
      args,
      logInvocation,
    })),
    [
      {
        command: 'worker-codex',
        args: ['exec', '--sandbox', 'read-only', '--worker'],
        logInvocation: true,
      },
      {
        command: 'qa-codex',
        args: ['exec', '--sandbox', 'workspace-write', '--qa'],
        logInvocation: true,
      },
    ],
  );
});

test('invalid role commands fail before any process launch with migration guidance', async () => {
  for (const invalid of [
    { command: 'codex', args: ['exec'] },
    { command: 'C:\\tools\\codex.exe', args: ['exec'] },
    { command: 'codex', args: ['exec', '--sandbox', 'read-only', '--sandbox', 'read-only'] },
    { command: 'codex', args: ['exec', '--sandbox', 'invalid'] },
  ]) {
    const dispatcherHarness = createMockDispatcherHarness(undefined, {
      config: { workerCommand: invalid },
    });
    await assert.rejects(
      () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
      /exactly one valid --sandbox/,
    );
    assert.equal(dispatcherHarness.runs.length, 0);
  }
  const legacy = createMockDispatcherHarness(undefined, { config: { codexSandbox: 'read-only' } });
  await assert.rejects(
    () => dispatch(legacy.cfg, legacy.dependencies),
    /codexSandbox is no longer supported/,
  );
  assert.equal(legacy.runs.length, 0);
});

test('logRoleInvocation false suppresses role invocation logging metadata', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, {
    config: { logRoleInvocation: false },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.logInvocation),
    [false, false],
  );
});

test('failed commands preserve complete multiline stdout and stderr diagnostics', async () => {
  await assert.rejects(
    () =>
      runCommand(
        command(
          {
            command: 'node',
            args: [
              '-e',
              "process.stdout.write('worker stdout one\\nworker stdout two\\n'); process.stderr.write('worker stderr one\\nworker stderr two\\n'); process.exit(17)",
            ],
          },
          0,
        ),
      ),
    (error) => {
      assert.match(error.message, /exit 17/);
      assert.match(error.message, /stdout:\nworker stdout one\nworker stdout two\n/);
      assert.match(error.message, /stderr:\nworker stderr one\nworker stderr two\n/);
      return true;
    },
  );
});

test('failed retries retain diagnostics from every unsuccessful attempt', async () => {
  await assert.rejects(
    () =>
      runCommand(
        command(
          {
            command: 'node',
            args: [
              '-e',
              "process.stdout.write('retry stdout\\n'); process.stderr.write('retry stderr\\n'); process.exit(17)",
            ],
            retries: 1,
          },
          0,
        ),
      ),
    (error) => {
      assert.match(error.message, /failed after 2 attempt\(s\)/);
      assert.match(error.message, /attempt 1: exit 17/);
      assert.match(error.message, /attempt 2: exit 17/);
      assert.equal((error.message.match(/retry stdout/g) ?? []).length, 2);
      assert.equal((error.message.match(/retry stderr/g) ?? []).length, 2);
      return true;
    },
  );
});

test('PR closing reference uses the claimed issue exactly once for creation and recovery', () => {
  assert.equal(withIssueClosingReference('Summary', 17), 'Summary\n\nCloses #17');
  assert.equal(
    withIssueClosingReference('Summary\n\nCloses #1\nClose #17\nclosed #99', 17),
    'Summary\n\nCloses #17',
  );
  assert.throws(() => withIssueClosingReference('', 0), /issue number must be positive/);
});

test('Worker commit evidence accepts escaped newline delimiters from Windows comments', () => {
  assert.equal(hasCommit('[Worker] round=2 commit=abc123\\n\\nVerification', 'abc123456789'), true);
  assert.equal(hasCommit('[Worker] round=2 commit=abc123', 'def456789'), false);
});

test('dispatcher runs Worker and QA and uses Markdown PR evidence', async () => {
  const dispatcherHarness = createMockDispatcherHarness();
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(dispatcherHarness.counts(), { workerCount: 1, qaCount: 1, staffCount: 0 });
  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.input?.match(/Use the ([^ ]+)/)?.[1]),
    ['worker', 'sloop-qa'],
  );
  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.args.slice(-2)),
    [
      ['--sandbox', 'read-only'],
      ['--sandbox', 'read-only'],
    ],
  );
  assert.equal(dispatcherHarness.runs[0].env.SLOOP_ISSUE_NUMBER, '1');
  assert.match(dispatcherHarness.runs[0].input, /exactly one \[Worker\] evidence comment/);
  assert.match(
    dispatcherHarness.runs[0].input,
    /repository's own AGENTS\.md, scripts, and workflow instructions/,
  );
  assert.doesNotMatch(dispatcherHarness.runs[0].input, /npm run pr-checks|canonical gate/);
  const published = await dispatcherHarness.dependencies.pullRequest(14);
  assert.equal(
    published.comments.filter((comment) => comment.body.startsWith('[QA/SDET Review]')).length,
    1,
  );
  assert.equal(dispatcherHarness.reviews.length, 0);
  assert.match(dispatcherHarness.runs[1].input, /gh pr comment --body-file/);
  const guide =
    dispatcherHarness.comments.find(([, body]) => body.startsWith('[Human Review Guide]'))?.[1] ??
    '';
  assert.match(guide, /commit=abc1/);
  assert.match(guide, /Run the focused command/);
  assert.match(guide, /documented output appears/);
  assert.equal(dispatcherHarness.state().branch, 'codex/issue-1');
  assert.equal(dispatcherHarness.state().mainBaseSha, 'main-sha-1');
  const runDirectories = readdirSync(join(dispatcherHarness.root, '.sloop', 'runs'));
  const events = runDirectories.flatMap((directory) =>
    readFileSync(join(dispatcherHarness.root, '.sloop', 'runs', directory, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
  assert.ok(events.some((event) => event.type === 'context'));
  assert.ok(events.some((event) => event.type === 'transition'));
  assert.ok(events.some((event) => event.type === 'prompt'));
  assert.ok(events.some((event) => event.type === 'result'));
  assert.ok(events.some((event) => event.type === 'stdout'));
  assert.ok(events.some((event) => event.type === 'stderr'));
  assert.ok(events.some((event) => event.type === 'codex'));
  assert.ok(events.every((event) => Number.isInteger(event.seq)));
});

test('existing human guide for the current commit is not published twice', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { existingHumanGuides: 1 });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(
    dispatcherHarness.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length,
    0,
  );
});

test('duplicate human guides for the current commit block ready_for_human_merge', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { existingHumanGuides: 2 });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(
    dispatcherHarness.state().lastError,
    /Expected exactly one \[Human Review Guide\].*duplicates/,
  );
  assert.equal(
    dispatcherHarness.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length,
    0,
  );
});

test('malformed current human guide blocks ready_for_human_merge', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { malformedHumanGuide: true });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /not dispatcher-rendered/);
  assert.equal(
    dispatcherHarness.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length,
    0,
  );
});

test('incomplete Worker human-verification evidence blocks before ready_for_human_merge', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { humanVerification: false });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /complete \[Human Verification\] guide/);
});

test('create and recovery smoke paths capture the persisted claimed-issue PR body', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 17, title: 'seventeen', body: 'criteria' }],
    {
      headRefName: 'codex/issue-17',
      prBody: 'Summary\n\nCloses #1\nClose #99',
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  // This is the create-path handoff: the Worker receives the exact body contract
  // that it must pass to `gh pr create`.
  const workerInput =
    dispatcherHarness.runs.find((run) => run.input?.includes('Use the worker skill'))?.input ?? '';

  // This is the recovery/update path: the captured `gh pr edit --body-file`
  // equivalent receives one normalized reference and no stale references.
  assert.deepEqual(dispatcherHarness.prBodyUpdates, [
    { number: 14, body: 'Summary\n\nCloses #17' },
  ]);
  assert.equal((dispatcherHarness.prBodyUpdates[0].body.match(/^Closes #17$/gm) ?? []).length, 1);
});

test('dispatcher-generated body is used by the initial PR creation path', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 17, title: 'seventeen', body: 'criteria' }],
    {
      workerCreatesPr: true,
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  const workerInput =
    dispatcherHarness.runs.find((run) => run.input?.includes('Use the worker skill'))?.input ?? '';

  assert.equal(dispatcherHarness.runs[0].env.SLOOP_PR_BODY, 'Closes #17');
  assert.deepEqual(dispatcherHarness.createdPrBodies, ['Closes #17']);
  assert.equal((dispatcherHarness.createdPrBodies[0].match(/^Closes #17$/gm) ?? []).length, 1);
});

test('worker branch convention is deterministic and rejects invalid issue numbers', () => {
  assert.equal(workerBranchName(16), 'codex/issue-16');
  assert.throws(() => workerBranchName(0), /issue number must be positive/);
});

test('PR closing references preserve authorized linked issues and remove stale ones', () => {
  assert.equal(
    withIssueClosingReference('Summary\n\nCloses #1\nClose #17\nClosed #99', 17, [39]),
    'Summary\n\nCloses #17\nCloses #39',
  );
});

test('review cap pauses before a replacement Worker is launched', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],
    config: { maxReviewRounds: 1 },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(dispatcherHarness.state().reviewRound, 2);
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.deepEqual(dispatcherHarness.state().reviewCap.outstandingFindingIds, []);
});

test('stale remote run restores explicit HITL round and existing PR branch before Worker and QA', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    prNumber: 14,
    headRefName: 'codex/issue-1',
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1-40ae',
      workerRunId: 'replacement-run',
      status: 'worker_recovery_pending',
      reviewRound: 1,
    },
    qaVerdicts: ['passed'],
  });
  const original = {
    protocol: 1,
    runId: 'original-run',
    issue: 1,
    pr: 14,
    branch: 'codex/issue-1',
    baseSha: '1234567',
    configFingerprint: 'config-v1',
    phase: 'complete',
    reviewRound: 4,
    contextCursor: '',
    artifacts: [artifactKey('run', { issue: 1, runId: 'original-run' })],
  };
  const previous = {
    ...original,
    runId: 'previous-run',
    phase: 'review',
    reviewRound: 3,
    artifacts: [artifactKey('run', { issue: 1, runId: 'previous-run' })],
  };
  let current = {
    protocol: 1,
    runId: 'replacement-run',
    issue: 1,
    pr: 14,
    branch: 'codex/issue-1-40ae',
    baseSha: '1234567',
    configFingerprint: 'config-v1',
    phase: 'review',
    reviewRound: 1,
    contextCursor: '',
    artifacts: [artifactKey('run', { issue: 1, runId: 'replacement-run' })],
  };
  const comments = [
    { body: runManifestMarker(previous), createdAt: '2026-10-20T09:59:00Z' },
    { body: runManifestMarker(original), createdAt: '2026-10-20T10:00:00Z' },
    {
      body: '[HITL Review Cap] action=resume issue=#1 pr=#14 round=3 sha=older-sha waived=none additionalRounds=2 steer=Continue the prior request.',
      createdAt: '2026-10-20T10:00:30Z',
    },
    {
      body: '[HITL Review Cap] round=4 cap=3 sha=abc0 outstanding=Q1,Q2. Resolve with additional rounds.',
      createdAt: '2026-10-20T10:01:00Z',
    },
    {
      body: '[HITL Review Cap] action=resume issue=#1 pr=#14 round=4 sha=abc0 waived=none additionalRounds=4 steer=Fix Q1 and Q2, then request QA.',
      createdAt: '2026-10-20T10:02:00Z',
    },
  ];
  const published = [];
  let claimCount = 0;
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      issue: 1,
      pr: 14,
      prState: 'OPEN',
      branch: 'codex/issue-1',
      sha: 'abc0',
      manifest: current,
      markers: [`sloop/v1/run/${current.runId}`],
      comments,
      now: Date.now(),
      leaseOwner: 'this-dispatcher',
    }),
    reconcile: (_issue, key) => original.artifacts.includes(key),
    claim: () => {
      claimCount += 1;
    },
    publish: (_issue, manifest) => {
      current = manifest;
      published.push(manifest);
    },
  };
  const checkedOut = [];
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => checkedOut.push(branch);
  const prepared = [];
  dispatcherHarness.dependencies.prepareWorkerBranch = (issue) => {
    prepared.push(issue);
    return { branch: workerBranchName(issue), mainBaseSha: 'new-base' };
  };

  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  const workerInput =
    dispatcherHarness.runs.find((run) => run.input?.includes('Use the worker skill'))?.input ?? '';
  const qaInput =
    dispatcherHarness.runs.find((run) => run.input?.includes('Use the sloop-qa skill'))?.input ??
    '';

  assert.equal(claimCount, 0);
  assert.deepEqual(prepared, []);
  assert.deepEqual(checkedOut, ['codex/issue-1']);
  assert.match(workerInput, /review round 4/);
  assert.match(workerInput, /Fix Q1 and Q2, then request QA/);
  assert.match(qaInput, /review round 4/);
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(dispatcherHarness.counts().qaCount, 1);
  assert.equal(dispatcherHarness.state().branch, 'codex/issue-1');
  assert.equal(dispatcherHarness.state().reviewRound, 4);
  assert.equal(dispatcherHarness.state().reviewCap.additionalRounds, 2);
  assert.equal(dispatcherHarness.state().reviewCap.steer, 'Fix Q1 and Q2, then request QA.');
  assert.ok(published.some((manifest) => manifest.phase === 'blocked'));
});

test('branch mismatch stops before Worker executes', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    prNumber: 14,
    headRefName: 'codex/issue-1',
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1-40ae',
      status: 'worker_recovery_pending',
      reviewRound: 2,
    },
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  // Act
  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(result, 4);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
  assert.equal(dispatcherHarness.counts().qaCount, 0);
  assert.match(
    dispatcherHarness.state().lastError,
    /refusing to launch Worker.*must use worker branch codex\/issue-1-40ae; found codex\/issue-1/,
  );
});

test('configured Arbiter upholds a finding and adds a Worker round', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested', 'passed'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
      '[QA/SDET Review] round=2 verdict=passed commit=abc2',
    ],
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 1,
      arbiterCommand: { command: 'codex', args: [] },
    },
  });
  dispatcherHarness.pr.comments.push({
    body: '[Worker] round=1 status=ready_for_review pr=14 base=main commit=abc1\n\n[Human Verification]\n1. Repeat the check.',
    createdAt: '0',
  });
  dispatcherHarness.reviews.push({ body: '[Staff Review] round=1 verdict=approved commit=abc1' });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.counts().workerCount, 2);
  assert.equal(dispatcherHarness.state().arbiterInterventions, 1);
  assert.match(dispatcherHarness.state().lastQaFeedback, /Worker steering/);
  assert.ok(dispatcherHarness.comments.some(([, body]) => body.startsWith('[Sloop Arbiter]')));
  const arbiterRun = dispatcherHarness.runs.find((spec) =>
    spec.input?.includes('Use the Arbiter contract'),
  );
  const arbiterRecord = JSON.parse(arbiterRun.input.split('Record:\n')[1]);
  assert.deepEqual(arbiterRecord.openFindings, [
    { id: 'Q1', owner: 'qa', summary: '- [Q1] fail - contract finding' },
  ]);
});

test('Arbiter excludes findings already closed by an overrule decision', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      status: 'worker_recovery_pending',
      reviewRound: 1,
      workerRunId: 'arbiter-filter-test',
      arbiterDecisions: [{ findingId: 'Q1', action: 'overrule' }],
    },
    qaVerdicts: ['changes_requested', 'passed'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - previously overruled finding\n- [Q2] fail - still open finding',
      '[QA/SDET Review] round=2 verdict=passed commit=abc2',
    ],
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 1,
      arbiterStagnatingAppearances: 1,
      arbiterCommand: { command: 'codex', args: [] },
    },
    arbiterFindingId: 'Q2',
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  const arbiterRun = dispatcherHarness.runs.find((spec) =>
    spec.input?.includes('Use the Arbiter contract'),
  );
  const arbiterRecord = JSON.parse(arbiterRun.input.split('Record:\n')[1]);
  assert.deepEqual(arbiterRecord.openFindings, [
    { id: 'Q2', owner: 'qa', summary: '- [Q2] fail - still open finding' },
  ]);
});

test('legacy dispatcher entry point forwards its command line to the CLI', async () => {
  const originalArgv = process.argv;
  const runCli = vi.fn(async () => {});
  vi.doMock('../src/cli.js', () => ({ cli: { runCli } }));

  try {
    process.argv = [process.execPath, '/legacy/dispatcher.js', 'status', '--json'];
    vi.resetModules();
    await import('../src/dispatcher.js');
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(runCli.mock.calls, [[['status', '--json']]]);
  } finally {
    process.argv = originalArgv;
    vi.doUnmock('../src/cli.js');
    vi.resetModules();
  }
});

test('configured Codex Arbiter receives the output schema and returns its structured result', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested', 'passed'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
      '[QA/SDET Review] round=2 verdict=passed commit=abc2',
    ],
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 1,
      arbiterCommand: {
        command: 'codex',
        args: [
          'exec',
          '--sandbox',
          'read-only',
          '--output-schema',
          'stale-schema-path',
          '--output-last-message',
        ],
      },
    },
  });
  const originalRun = dispatcherHarness.dependencies.run;
  let schema;
  let prompt;
  dispatcherHarness.dependencies.run = async (spec) => {
    if (!spec.input?.includes('Use the Arbiter contract')) return originalRun(spec);
    prompt = spec.input;
    const schemaIndex = spec.args.indexOf('--output-schema');
    const outputIndex = spec.args.indexOf('--output-last-message');
    assert.notEqual(schemaIndex, -1);
    assert.notEqual(outputIndex, -1);
    schema = JSON.parse(readFileSync(spec.args[schemaIndex + 1], 'utf8'));
    assert.deepEqual(schema.required, ['schema', 'context', 'producer', 'status', 'payload']);
    assert.equal(schema.oneOf, undefined);
    assert.deepEqual(schema.properties.producer, { type: 'string', const: 'arbiter' });
    assert.deepEqual(schema.$defs.arbiter.required, ['rationale', 'references', 'decisions']);
    assert.equal(schema.$defs.arbiter.properties.decisions.items.additionalProperties, false);
    assert.deepEqual(schema.$defs.arbiter.properties.decisions.items.required, [
      'findingId',
      'owner',
      'action',
      'rationale',
      'direction',
      'verification',
      'followUp',
    ]);
    // Every object sent to Codex must be closed and require all its properties,
    // even within nullable objects, arrays and local references.
    const visitNode = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.$ref) assert.ok(node.$ref.startsWith('#/$defs/'));
      if (node.properties) {
        assert.equal(node.additionalProperties, false);
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      }
      if (node.enum || node.const) assert.ok(node.type);
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(visitNode);
        else visitNode(child);
      }
    };
    visitNode(schema);
    const result = await originalRun(spec);
    writeFileSync(spec.args[outputIndex + 1], result);
    return 'Codex execution metadata is not the structured result';
  };

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.ok(schema);
  assert.match(prompt, /Do not add fields or use "version" in place of "schema"/);
  assert.match(prompt, /This is the first intervention: all four actions are allowed/);
  assert.deepEqual(JSON.parse(prompt.split('Record:\n')[1]).openFindings, [
    { id: 'Q1', owner: 'qa', summary: '- [Q1] fail - contract finding' },
  ]);
  assert.match(prompt, /"run":"/);
  assert.equal(dispatcherHarness.state().arbiterInterventions, 1);
  assert.ok(dispatcherHarness.comments.some(([, body]) => body.startsWith('[Sloop Arbiter]')));
});

test('configured Arbiter defer creates backlog follow-up without Automation Ready', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
    ],
    arbiterAction: 'defer',
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 1,
      arbiterCommand: { command: 'codex', args: [] },
    },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.createdIssues.length, 1);
  assert.match(dispatcherHarness.createdIssues[0].body, /not Automation Ready/);
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
});

test('configured Arbiter protocol failure stops the loop and preserves intervention budget', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
    ],
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 1,
      arbiterCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },
    },
  });
  const originalRun = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    if (spec.input?.includes('Use the Arbiter contract')) {
      const outputIndex = spec.args.indexOf('--output-last-message');
      writeFileSync(spec.args[outputIndex + 1], '{invalid');
      return 'Codex execution metadata';
    }
    return originalRun(spec);
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().arbiterInterventions ?? 0, 0);
  assert.match(dispatcherHarness.state().lastErrorVerbose, /Expected property name/);
});

test('a local HITL budget and steer are included in the resumed Worker context', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      workerRunId: 'resumed-worker-session',
      status: 'worker_recovery_pending',
      reviewRound: 2,
      reviewCap: {
        capRound: 1,
        additionalRounds: 1,
        waivedFindingIds: ['Q4'],
        outstandingFindingIds: ['Q4'],
        decisionSha: 'abc0',
        steer: 'Do not change GitHub configuration.',
      },
    },
    config: {
      maxReviewRounds: 1,
      workerCommand: {
        command: 'codex',
        args: ['exec', '--sandbox', 'read-only'],
        sessions: true,
      },
    },
  });
  mkdirSync(join(dispatcherHarness.root, '.sloop'), { recursive: true });
  writeFileSync(
    join(dispatcherHarness.root, '.sloop', 'sessions.json'),
    JSON.stringify({ 'resumed-worker-session\u00001\u0000worker': 'saved-session' }),
  );
  const observedRunSpecs = [];
  const originalRun = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    observedRunSpecs.push(spec);
    return originalRun(spec);
  };
  vi.doMock('node:crypto', async (importOriginal) => {
    const crypto = await importOriginal();
    return { ...crypto, randomUUID: () => 'resumed-worker-session' };
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};
  try {
    vi.resetModules();
    const dispatcherModule = await import('../src/dispatcher.js');
    await dispatcherModule.dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    vi.doUnmock('node:crypto');
    vi.resetModules();
  }

  assert.match(
    dispatcherHarness.runs[0].input,
    /HITL steer \(binding\): Do not change GitHub configuration/,
  );
  assert.equal(observedRunSpecs[0].env.SLOOP_SESSION, 'saved-session');
});

test('new branch preparation refuses to overwrite an existing worker branch', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-git-'));
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  runGit(['init', '-b', 'main']);
  runGit(['config', 'user.email', 'test@example.com']);
  runGit(['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'README.md'), 'main');
  runGit(['add', 'README.md']);
  runGit(['commit', '-m', 'initial']);
  const remoteResult = spawnSync('git', ['init', '--bare', remote], { encoding: 'utf8' });

  assert.equal(remoteResult.status, 0, remoteResult.stderr);
  runGit(['remote', 'add', 'origin', remote]);
  runGit(['push', 'origin', 'main']);
  runGit(['branch', 'codex/issue-1']);
  assert.throws(
    () => prepareWorkerBranch(1, root),
    /worker branch codex\/issue-1 already exists; refusing to overwrite it/,
  );
  assert.equal(runGit(['rev-parse', 'codex/issue-1']), runGit(['rev-parse', 'HEAD']));
  rmSync(root, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

test('new branch preparation uses main updated by fetch', () => {
  const seed = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-seed-'));
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  const work = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-work-'));
  const runGit = (cwd, args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    runGit(seed, ['init', '-b', 'main']);
    runGit(seed, ['config', 'user.email', 'test@example.com']);
    runGit(seed, ['config', 'user.name', 'Test']);
    writeFileSync(join(seed, 'README.md'), 'initial');
    runGit(seed, ['add', 'README.md']);
    runGit(seed, ['commit', '-m', 'initial']);
    const remoteResult = spawnSync('git', ['init', '--bare', remote], { encoding: 'utf8' });
    assert.equal(remoteResult.status, 0, remoteResult.stderr);
    runGit(seed, ['remote', 'add', 'origin', remote]);
    runGit(seed, ['push', 'origin', 'main']);
    runGit(work, ['clone', remote, '.']);
    writeFileSync(join(seed, 'README.md'), 'updated main');
    runGit(seed, ['add', 'README.md']);
    runGit(seed, ['commit', '-m', 'advance main']);
    const updatedMainSha = runGit(seed, ['rev-parse', 'HEAD']);
    runGit(seed, ['push', 'origin', 'main']);

    const prepared = prepareWorkerBranch(16, work);

    assert.equal(prepared.branch, 'codex/issue-16');
    assert.equal(prepared.mainBaseSha, updatedMainSha);
    assert.equal(runGit(work, ['rev-parse', 'codex/issue-16']), updatedMainSha);
  } finally {
    rmSync(seed, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test('worker branch preparation classifies a failed fetch as an external dependency failure', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-git-fetch-failure-'));
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };

  try {
    runGit(['init', '-b', 'main']);
    runGit(['config', 'user.email', 'test@example.com']);
    runGit(['config', 'user.name', 'Test']);
    writeFileSync(join(root, 'README.md'), 'main');
    runGit(['add', 'README.md']);
    runGit(['commit', '-m', 'initial']);
    runGit(['remote', 'add', 'origin', join(root, 'missing-remote')]);

    assert.throws(
      () => prepareWorkerBranch(31, root),
      (error) => error instanceof CliFailure && error.exitCode === 5,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

test('dispatcher rejects a PR whose worker branch violates the convention', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 1, title: 'branch validation' }],
    {
      headRefName: 'codex/other-branch',
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.match(
    dispatcherHarness.state().lastError,
    /must use worker branch codex\/issue-1; found codex\/other-branch/,
  );
});

test('dispatcher rejects a configurable non-main PR base explicitly', async () => {
  const dispatcherHarness = createMockDispatcherHarness();
  await assert.rejects(
    () =>
      dispatch({ ...dispatcherHarness.cfg, baseBranch: 'develop' }, dispatcherHarness.dependencies),
    /Worker PR baseBranch must be main; found develop/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('Worker revalidates the PR base if configuration changes during dispatch', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  const config = { ...dispatcherHarness.cfg, baseBranch: 'main' };
  dispatcherHarness.dependencies.eligible = () => {
    config.baseBranch = 'develop';
    return [{ number: 1, title: 'one' }];
  };
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(config, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /baseBranch must be main; found develop/);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
});

test('dispatcher stops after one issue instead of draining the queue', async () => {
  const dispatcherHarness = createMockDispatcherHarness([
    { number: 1, title: 'first' },
    { number: 2, title: 'second' },
  ]);
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(dispatcherHarness.counts(), { workerCount: 1, qaCount: 1, staffCount: 0 });
  assert.deepEqual(dispatcherHarness.state().completedIssues, [1]);
});

test('new issue claim clears the completed issue PR context before validation', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [
      { number: 16, title: 'completed' },
      { number: 17, title: 'next issue', body: 'new acceptance criteria' },
    ],
    {
      headRefName: 'codex/issue-17',
      initialState: {
        issue: 16,
        status: 'ready_for_human_merge',
        pr: 16,
        branch: 'codex/issue-16',
        headSha: 'old-head',
        mainBaseSha: 'old-main',
        reviewRound: 9,
        lastCiFeedback: 'old CI feedback',
        lastQaFeedback: 'old QA feedback',
        lastStaffFeedback: 'old Staff feedback',
        taskContext: 'old task context',
        workerRunId: 'old-run',
        workerPid: 123,
        workerStartedAt: 1,
        workerHeartbeatAt: 1,
        workerRecoveryCount: 4,
        lastError: 'old error',
        completedIssues: [16],
        mainGreen: true,
      },
    },
  );
  const validatedPrs = [];
  const pullRequest = dispatcherHarness.dependencies.pullRequest;
  dispatcherHarness.dependencies.pullRequest = (pr) => {
    validatedPrs.push(pr);
    return pullRequest(pr);
  };

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  const claimSave = dispatcherHarness.saves.find((saved) => saved.status === 'claimed');

  assert.deepEqual(claimSave, {
    completedIssues: [16],
    mainGreen: true,
    issue: 17,
    status: 'claimed',
    reviewRound: 1,
    drainStatus: 'running',
    updatedAt: claimSave.updatedAt,
  });
  assert.equal(dispatcherHarness.runs[0].input.includes('An existing PR is #16'), false);
  assert.equal(dispatcherHarness.runs[0].input.includes('old task context'), false);
  assert.equal(dispatcherHarness.state().branch, 'codex/issue-17');
  assert.equal(dispatcherHarness.state().pr, 14);
  assert.equal(validatedPrs.length > 0, true);
  assert.equal(
    validatedPrs.every((pr) => pr === 14),
    true,
  );
  assert.deepEqual(dispatcherHarness.state().completedIssues, [16, 17]);
  assert.equal(dispatcherHarness.state().mainGreen, true);
});

test('QA changes return to Worker and QA is repeated', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    qaVerdicts: ['changes_requested', 'passed'],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(dispatcherHarness.counts(), { workerCount: 2, qaCount: 2, staffCount: 0 });
  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.input?.match(/Use the ([^ ]+)/)?.[1]),
    ['worker', 'sloop-qa', 'worker', 'sloop-qa'],
  );
});

test('recovery detects stale Worker state, starts a new Worker and reuses the existing PR', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1' },
      1,
      14,
      now,
      100,
    ),
  });
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('recovery must reuse the existing branch');
  };
  let checkedOut;
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => {
    checkedOut = branch;
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.state().pr, 14);
  assert.equal(checkedOut, 'codex/issue-1');
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(
    dispatcherHarness.comments.some(([, body]) => body.includes('Worker perdido')),
    true,
  );
});

test('recovery with a stale remote branch adopts the existing PR branch and reaches QA', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    headRefName: 'codex/issue-1-137e',
    initialState: {
      issue: 1,
      pr: 14,
      status: 'worker_recovery_pending',
      reviewRound: 4,
      workerPid: -1,
      workerStartedAt: now - 101,
      workerHeartbeatAt: now - 101,
    },
  });
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      protocol: 1,
      issue: 1,
      pr: 14,
      manifest: {
        protocol: 1,
        runId: 'recovery-run',
        issue: 1,
        pr: 14,
        branch: 'codex/issue-1-stale',
        baseSha: 'abcdef1',
        configFingerprint: 'test-config',
        phase: 'working',
        reviewRound: 4,
        contextCursor: '',
        artifacts: ['sloop-v1/run/recovery-artifact'],
      },
      markers: ['sloop/v1/run/recovery-run'],
    }),
    reconcile: () => true,
    claim: () => {},
    publish: () => {},
  };
  let prepared = 0;
  let checkedOut;
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    prepared += 1;
    throw new Error('must not create a second branch for an existing PR');
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => {
    checkedOut = branch;
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(prepared, 0);
  assert.equal(checkedOut, 'codex/issue-1-137e');
  assert.equal(dispatcherHarness.counts().qaCount, 1);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.state().reviewRound, 4);
});

test('recovery accepts a collision-suffixed Worker branch', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1-071f' },
      1,
      14,
      now,
      100,
    ),
  });
  let checkedOut;
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => {
    checkedOut = branch;
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(checkedOut, 'codex/issue-1-071f');
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
});

test('recovery explains why an issue is not eligible', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: {
      issue: 31,
      status: 'worker_running',
      pr: 54,
      branch: 'codex/issue-31',
      reviewRound: 9,
      workerPid: -1,
    },
  });
  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => {
      assert.match(error.message, /Issue #31 cannot be recovered/);
      assert.match(error.message, /Automation Ready/);
      assert.match(error.message, /status=worker_running, pr=54, branch=codex\/issue-31/);
      assert.match(error.message, /gh issue view 31/);
      return true;
    },
  );
});

test('new branch preparation failure is persisted and does not leave a claimed run stuck', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('fetch failed');
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'blocked');
  assert.match(dispatcherHarness.state().lastError, /The loop stopped during blocked/);
  assert.equal(dispatcherHarness.state().lastErrorVerbose, 'fetch failed');
});

test('dispatcher preserves the external exit class from post-preflight branch preparation', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new CliFailure(5, 'git fetch failed: service unavailable');
  };
  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => error instanceof CliFailure && error.exitCode === 5,
  );

  assert.notEqual(dispatcherHarness.state().status, 'blocked');
});

function assertPersistedDiagnostic(state, phase, diagnostic, context) {
  assert.ok((state.lastError.match(/[.!?]+/g) ?? []).length <= 4, state.lastError);
  assert.match(state.lastError, new RegExp(`during ${phase}`));
  for (const value of context) assert.match(state.lastError, value);
  assert.equal(state.lastErrorVerbose, diagnostic);
}

test('empty diagnostic fallback persists concise blocked context separately from verbose output', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('');
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  assertPersistedDiagnostic(
    dispatcherHarness.state(),
    'blocked',
    'No diagnostic output was captured during blocked.',
    [/issue #1/],
  );

  assert.match(dispatcherHarness.state().lastError, /No diagnostic output was available/);
});

test('QA feedback persists concise context and the complete diagnostic', async () => {
  const diagnostic =
    '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n[Q1] fail - café output';
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    qaVerdicts: ['changes_requested', 'passed'],
    qaBodies: [diagnostic],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  const persisted = dispatcherHarness.saves.find(
    (state) => state.status === 'qa_changes_requested',
  );
  assertPersistedDiagnostic(persisted, 'qa changes requested', diagnostic, [/issue #1/, /PR #14/]);
});

test('recovery failure persists concise issue and PR context with complete diagnostics', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1' },
      1,
      14,
      Date.now(),
      100,
    ),
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {
    throw new Error('recovery checkout failed\nexit 2');
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  assertPersistedDiagnostic(
    dispatcherHarness.state(),
    'worker recovery pending',
    'recovery checkout failed\nexit 2',
    [/issue #1/, /PR #14/],
  );
});

test('blocked issue with PR context enters recovery instead of a fresh claim', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'recover me' }], {
    initialState: {
      issue: 1,
      status: 'blocked',
      pr: 14,
      branch: 'codex/issue-1',
      headSha: 'old-head',
      reviewRound: 3,
      lastQaFeedback: 'actionable QA finding',
    },
  });
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('fresh claim path must not run');
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.runs[0].input.includes('An existing PR is #14'), true);
  assert.equal(dispatcherHarness.runs[0].input.includes('actionable QA finding'), true);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('recovery rejects a conflicting persisted branch', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'main',
      status: 'worker_running',
      workerRunId: 'corrupt-recovery-state',
      workerPid: -1,
      workerStartedAt: now - 1000,
      workerHeartbeatAt: now - 1000,
      workerRecoveryCount: 0,
      reviewRound: 1,
      completedIssues: [],
      drainStatus: 'running',
      updatedAt: now,
    },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(
    dispatcherHarness.state().lastError,
    /must use worker branch main; found codex\/issue-1/,
  );
});

test('conflicting Worker PR is rejected before reviews', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.pullRequest = () => ({
    number: 14,
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: 'codex/issue-1',
    headRefOid: 'abc1',
    mergeStateStatus: 'DIRTY',
    mergeable: 'CONFLICTING',
    comments: [{ body: '[Worker] round=1 status=ready_for_review pr=14 base=main commit=abc1' }],
    reviews: [],
    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.counts().qaCount, 0);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /remains conflicting or dirty/);
});

test('failed PR CI returns the issue to a recovered Worker without local npm gates', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    checkSequences: [
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'FAILURE' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.counts().workerCount, 2);
  assert.equal(
    dispatcherHarness.runs.some((run) => run.command === 'npm'),
    false,
  );
  const ciFailure = dispatcherHarness.saves.find((state) => state.status === 'ci_failed');
  assertPersistedDiagnostic(ciFailure, 'ci failed', '[CI] pr-checks: FAILURE', [
    /issue #1/,
    /PR #14/,
  ]);
});

test('successful role process without a published review blocks the dispatcher', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    publishEvidence: { qa: false },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /did not publish \[QA\/SDET Review\]/);
});

test('active live run remains exclusive while stale recovery is allowed', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: {
      issue: 1,
      status: 'worker_running',
      workerPid: process.pid,
      workerHeartbeatAt: Date.now(),
    },
  });
  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => error.exitCode === 3 && /active run exists/.test(error.message),
  );
});

test('stale locks recover safely and reclaim markers are atomic', () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  dispatcherHarness.dependencies.tryAcquire = () => (calls.push('tryAcquire'), false);
  dispatcherHarness.dependencies.readOwner = () => {
    calls.push('readOwner');
    throw new Error('corrupt owner');
  };
  dispatcherHarness.dependencies.tryBeginReclaim = () => (calls.push('tryBeginReclaim'), true);
  dispatcherHarness.dependencies.finishReclaim = () => calls.push('finishReclaim');
  dispatcherHarness.dependencies.onReclaim = () => calls.push('onReclaim');
  const first = acquire(dispatcherHarness.dependencies, 1);

  assert.match(first, /^[0-9a-f-]+$/);
  assert.deepEqual(calls, [
    'tryAcquire',
    'readOwner',
    'tryBeginReclaim',
    'onReclaim',
    'finishReclaim',
  ]);
});

test('stale lock recovery validates owner PIDs and removes dead owners', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lock-owner-'));
  const lock = dispatcherLockPath(root);
  const ownerFile = join(lock, 'owner.json');
  mkdirSync(lock, { recursive: true });

  try {
    writeFileSync(ownerFile, JSON.stringify({ pid: 0 }));
    assert.throws(() => recoverStaleLock(root), /no valid PID/);

    writeFileSync(ownerFile, JSON.stringify({ pid: 4321 }));
    assert.throws(
      () => recoverStaleLock(root, (pid) => pid === 4321),
      (error) => error instanceof CliFailure && error.exitCode === 3,
    );

    assert.match(
      recoverStaleLock(root, () => false),
      /Recovered stale dispatcher lock/,
    );
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(lock, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatcher lock acquisition reclaims a stale owner after stale marker recovery', () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  let beginCount = 0;
  const dependencies = dispatcherHarness.dependencies;
  dependencies.tryAcquire = () => false;
  dependencies.readOwner = () => ({ pid: 4321, createdAt: 0 });
  dependencies.processAlive = () => false;
  dependencies.now = () => 1000;
  dependencies.tryBeginReclaim = () => {
    calls.push('begin');
    beginCount += 1;
    return beginCount === 2;
  };
  dependencies.readReclaimOwner = () => {
    throw new Error('reclaim owner is missing');
  };
  dependencies.reclaimAgeMs = () => 100;
  dependencies.abandonReclaim = () => calls.push('abandon');
  dependencies.onReclaim = () => calls.push('reclaim');
  dependencies.finishReclaim = () => calls.push('finish');

  const token = acquire(dependencies, 10);

  assert.equal(typeof token, 'string');
  assert.deepEqual(calls, ['begin', 'abandon', 'begin', 'reclaim', 'finish']);

  const liveOwnerDependencies = createMockDispatcherHarness().dependencies;
  liveOwnerDependencies.tryAcquire = () => false;
  liveOwnerDependencies.readOwner = () => ({ pid: 4321, createdAt: 1000 });
  liveOwnerDependencies.processAlive = () => true;

  assert.throws(
    () => acquire(liveOwnerDependencies, 10),
    (error) => error instanceof CliFailure && error.exitCode === 3,
  );
});

test('dispatcher exhausts lock reclaim attempts when every stale marker reacquire fails', () => {
  const dependencies = createMockDispatcherHarness().dependencies;
  let abandonCount = 0;
  dependencies.tryAcquire = () => false;
  dependencies.readOwner = () => ({ pid: 4321, createdAt: 0 });
  dependencies.processAlive = () => false;
  dependencies.now = () => 1000;
  dependencies.tryBeginReclaim = () => false;
  dependencies.readReclaimOwner = () => {
    throw new Error('reclaim marker is missing');
  };
  dependencies.reclaimAgeMs = () => 100;
  dependencies.abandonReclaim = () => {
    abandonCount += 1;
  };

  assert.throws(
    () => acquire(dependencies, 10),
    (error) => error instanceof CliFailure && error.exitCode === 3,
  );
  assert.equal(abandonCount, 3);
});

test('worker branch preparation rejects a dirty checkout before changing branches', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-dirty-worktree-'));
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };

  try {
    runGit(['init', '-b', 'main']);
    writeFileSync(join(root, 'untracked.txt'), 'local work');

    assert.throws(
      () => prepareWorkerBranch(12, root),
      (error) =>
        error instanceof CliFailure &&
        error.exitCode === 5 &&
        /working tree is dirty/.test(error.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatcher records role command errors as recoverable Worker failures', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  dispatcherHarness.dependencies.run = async () => {
    throw new Error('agent command failed');
  };
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /agent command failed/);
});

test('dispatcher times out when required PR checks remain pending', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    checkSequences: [[{ name: 'pr-checks', status: 'IN_PROGRESS' }]],
    config: { checkTimeoutMs: -1 },
  });
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /PR checks did not finish before timeout/);
});

test('dispatcher polls pending PR checks until they pass', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    checkSequences: [
      [{ name: 'pr-checks', status: 'IN_PROGRESS' }],
      [{ name: 'pr-checks', status: 'IN_PROGRESS' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ],
    config: { checkTimeoutMs: 60_000, checkPollIntervalMs: 0 },
  });
  const observedWaits = [];
  dispatcherHarness.dependencies.sleep = async (duration) => observedWaits.push(duration);
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 0);
  assert.deepEqual(observedWaits, [0]);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('dispatcher records malformed Worker completion metadata', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  dispatcherHarness.dependencies.run = async () => 'Worker output omitted its PR result.';
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /WORKER_RESULT pr=<number> base=main/);
});

test('dispatcher rejects Worker metadata with an invalid PR base', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  dispatcherHarness.dependencies.run = async () => 'WORKER_RESULT pr=14 base=develop';
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /report an existing PR based on main/);
});

test('dispatcher rejects Worker evidence when the PR targets another base branch', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  dispatcherHarness.dependencies.pullRequest = () => ({
    ...dispatcherHarness.pr,
    baseRefName: 'develop',
  });
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /must target main/);
});

test('recovery refuses to run Worker against a closed PR', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      workerRunId: 'closed-pr-recovery',
      status: 'worker_recovery_pending',
      reviewRound: 1,
    },
  });
  dispatcherHarness.dependencies.pullRequest = () => ({
    ...dispatcherHarness.pr,
    state: 'CLOSED',
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /no recoverable open head branch/);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
});

test('recovery refuses to run Worker when the PR has no head branch', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      workerRunId: 'headless-pr-recovery',
      status: 'worker_recovery_pending',
      reviewRound: 1,
    },
  });
  let pullRequestCalls = 0;
  dispatcherHarness.dependencies.pullRequest = () => {
    pullRequestCalls += 1;
    return { ...dispatcherHarness.pr, headRefName: undefined };
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 4);
  assert.equal(pullRequestCalls, 2);
  assert.match(dispatcherHarness.state().lastError, /no recoverable open head branch/);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
});

test('failed CI pauses at the review cap instead of launching another Worker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    checkSequences: [
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'FAILURE' }],
    ],
    config: { maxReviewRounds: 1 },
  });
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(dispatcherHarness.state().lastCiFeedback, '[CI] pr-checks: FAILURE');
});

test('escalated Arbiter findings move the run to human review without another Worker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - unresolved contract finding',
    ],
    arbiterAction: 'escalate',
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 1,
      arbiterCommand: { command: 'codex', args: [] },
    },
  });

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'human_review_required');
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(dispatcherHarness.state().arbiterInterventions, 1);
});

test.each([
  ['claim rejected before reconciliation', 'claim'],
  ['claim marker not reconciled', 'marker'],
  ['manifest publication rejected', 'publish'],
])('dispatcher preserves remote authority failures when %s', async (_scenario, failurePoint) => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  let reconciliationCalls = 0;
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({ issue: 1, markers: [] }),
    claim: () => {
      if (failurePoint === 'claim') throw new Error('remote claim rejected');
    },
    reconcile: () => {
      reconciliationCalls += 1;
      return failurePoint === 'publish' && reconciliationCalls === 1;
    },
    publish: () => {
      if (failurePoint === 'publish') throw new Error('remote manifest rejected');
    },
  };
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /remote (claim|manifest)/);
  if (failurePoint === 'publish') assert.equal(reconciliationCalls, 2);
});

test('dispatcher continues when remote claim failure is reconciled by its artifact marker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  let claimAttempts = 0;
  let reconciliations = 0;
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({ issue: 1, markers: [] }),
    claim: () => {
      claimAttempts += 1;
      throw new Error('remote claim response was lost');
    },
    reconcile: () => {
      reconciliations += 1;
      return true;
    },
    publish: () => {},
  };

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(claimAttempts, 1);
  assert.equal(reconciliations >= 1, true);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('dispatcher continues when failed remote publication is reconciled', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      workerRunId: 'remote-recovery-run',
      status: 'worker_recovery_pending',
      reviewRound: 1,
    },
  });
  const manifest = {
    protocol: 1,
    runId: 'remote-recovery-run',
    issue: 1,
    pr: 14,
    branch: 'codex/issue-1',
    baseSha: 'abc1234',
    configFingerprint: 'config-v1',
    phase: 'blocked',
    reviewRound: 1,
    contextCursor: '',
    artifacts: [artifactKey('run', { issue: 1, runId: 'remote-recovery-run' })],
  };
  const published = [];
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      issue: 1,
      pr: 14,
      prState: 'OPEN',
      branch: 'codex/issue-1',
      manifest,
      markers: ['sloop/v1/run/remote-recovery-run'],
    }),
    claim: () => assert.fail('existing remote run must not be claimed again'),
    reconcile: () => true,
    publish: () => {
      published.push('attempted');
      throw new Error('remote publication response was lost');
    },
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(published.length > 0, true);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('dispatcher pauses an over-budget recovery before launching a replacement Worker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      workerRunId: 'over-budget-recovery',
      status: 'worker_recovery_pending',
      reviewRound: 3,
    },
    config: { maxReviewRounds: 1 },
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(dispatcherHarness.counts().workerCount, 0);
  assert.equal(
    dispatcherHarness.comments.some(([, body]) => body.includes('[HITL Review Cap]')),
    true,
  );
});

test('Arbiter waits for its configured review threshold before intervening', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
    ],
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 3,
      arbiterStagnatingAppearances: 99,
      arbiterCommand: { command: 'codex', args: [] },
    },
  });
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(
    dispatcherHarness.runs.some((spec) => spec.input?.includes('Use the Arbiter contract')),
    false,
  );
});

test('status returns only the concise summary by default', async () => {
  const injected = createMockDispatcherHarness([], {
    initialState: {
      issue: 9,
      pr: 42,
      status: 'worker_running',
      lastError: 'short summary',
      lastErrorVerbose: 'line one\nUnicode: café\nline three',
      branch: 'codex/issue-9',
      workerRecoveryCount: 3,
    },
  });
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);

  try {
    const dispatcherArgs = ['--status'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);

    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  const expectedStatus = {
    issue: 9,
    pr: 42,
    status: 'worker_running',
    lastError: 'short summary',
  };

  assert.deepEqual(JSON.parse(output[0]), expectedStatus);
});

test('verbose status returns the complete diagnostic state', async () => {
  const injected = createMockDispatcherHarness([], {
    initialState: {
      issue: 9,
      pr: 42,
      status: 'worker_running',
      lastError: 'short summary',
      lastErrorVerbose: 'line one\nUnicode: café\nline three',
      branch: 'codex/issue-9',
      workerRecoveryCount: 3,
    },
  });
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);

  try {
    const verboseStatusArgs = ['--status', '--verbose'];
    const parsedDispatcherCommand = parseDispatcherCommand(verboseStatusArgs);
    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  const verboseStatus = JSON.parse(output[0]);

  assert.deepEqual(verboseStatus, injected.state());
});

test('status recommends safe recovery only for valid pending Worker context', async () => {
  const cases = [
    {
      state: { issue: 31, pr: 54, status: 'worker_recovery_pending' },
      expected: {
        issue: 31,
        pr: 54,
        status: 'worker_recovery_pending',
        nextAction: {
          command: 'sloop --prepare-recovery 31 --pr 54',
          description: 'Prepare local recovery for the failed Worker.',
          mutates: true,
        },
      },
    },
    {
      state: { issue: 31, pr: 54, status: 'worker_running' },
      expected: { issue: 31, pr: 54, status: 'worker_running' },
    },
    {
      state: { issue: 0, pr: 54, status: 'worker_recovery_pending' },
      expected: { issue: 0, pr: 54, status: 'worker_recovery_pending' },
    },
    {
      state: { issue: 31, pr: -1, status: 'worker_recovery_pending' },
      expected: { issue: 31, pr: -1, status: 'worker_recovery_pending' },
    },
    {
      state: { issue: '31', pr: 54, status: 'worker_recovery_pending' },
      expected: { issue: '31', pr: 54, status: 'worker_recovery_pending' },
    },
    {
      state: { issue: 31, status: 'worker_recovery_pending' },
      expected: { issue: 31, status: 'worker_recovery_pending' },
    },
  ];

  for (const { state, expected } of cases) {
    const injected = createMockDispatcherHarness([], { initialState: state });
    let output;
    const originalLog = console.log;
    console.log = (value) => (output = value);
    try {
      const dispatcherArgs = ['--status'];
      const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
      await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
    } finally {
      console.log = originalLog;
    }
    assert.deepEqual(JSON.parse(output), expected);
    assert.deepEqual(injected.state(), state);
  }
});

test('status rejects unsupported flag combinations', () => {
  const dispatcherHarness = createMockDispatcherHarness();

  for (const args of [
    ['--status', '--list'],
    ['--status', '--verbose', '--list'],
    ['--status', '--unknown'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'dispatcher.js'), ...args],
      { cwd: dispatcherHarness.root, encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /mixed, duplicate, unknown, or unsupported|no longer supported; use `sloop status`/,
    );
    assert.equal(result.stdout, '');
  }
});

test('--list prints only issue number and title while eligible issues retain body data', async () => {
  const injectedIssues = [
    { number: 7, title: 'Earlier issue', body: 'other internal context' },
    { number: 25, title: 'Structured agent output', body: 'internal acceptance criteria' },
  ];
  const injected = createMockDispatcherHarness(injectedIssues);
  let output;
  const originalLog = console.log;
  console.log = (value) => (output = value);
  try {
    const dispatcherArgs = ['--list'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(
    JSON.parse(output),
    injectedIssues.map(({ number, title }) => ({ number, title })),
  );
  assert.doesNotMatch(output, /body|internal acceptance criteria|other internal context/);
  assert.deepEqual(injected.dependencies.eligible(), injectedIssues);
});

test('diagnostic redaction preserves safe multiline output and hides common credentials', () => {
  const output = redactDiagnostic(
    'exit 1\nGITHUB_TOKEN=secret-value\n{"password":"p@ss"}\nhttps://example.test/log',
  );

  assert.match(output, /exit 1/);
  assert.match(output, /https:\/\/example.test\/log/);
  assert.doesNotMatch(output, /secret-value|p@ss/);
  assert.match(output, /\[REDACTED\]/);
});

test('diagnostic redaction exactly preserves hyphenated credential-key assignments', () => {
  const diagnostic = [
    'X-Secret-Value: secret-123',
    'X-Credentials-Blob=credentials-123',
    'X-Password-Hint: password-123',
  ].join('\n');
  const expected = [
    'X-Secret-Value: [REDACTED]',
    'X-Credentials-Blob=[REDACTED]',
    'X-Password-Hint: [REDACTED]',
  ].join('\n');
  const output = redactDiagnostic(diagnostic);

  assert.equal(output, expected);
  assert.equal(redactDiagnostic(output), expected);
});

test('diagnostic redaction exactly preserves bare and prefixed header diagnostics', () => {
  const diagnostic = [
    'Authorization: Basic dXNlcjpwYXNzd29yZA==',
    'Proxy-Authorization: Bearer proxy-secret',
    'Cookie: session=one; csrf=two',
    'Set-Cookie: session=three; HttpOnly',
    '> Authorization: Basic dXNlcjpwYXNzd29yZA==',
    'curl: Proxy-Authorization: Basic cHJveHk6c2VjcmV0',
    'request headers: Cookie: session=one; csrf=two',
    'trace: Set-Cookie: session=three; HttpOnly',
  ].join('\n');
  const expected = [
    'Authorization: [REDACTED]',
    'Proxy-Authorization: [REDACTED]',
    'Cookie: [REDACTED]',
    'Set-Cookie: [REDACTED]',
    '> Authorization: [REDACTED]',
    'curl: Proxy-Authorization: [REDACTED]',
    'request headers: Cookie: [REDACTED]',
    'trace: Set-Cookie: [REDACTED]',
  ].join('\n');
  const output = redactDiagnostic(diagnostic);

  assert.equal(output, expected);
  assert.equal(redactDiagnostic(output), expected);
});

test('diagnostic redaction removes short Bearer credentials', () => {
  const output = redactDiagnostic('Bearer abc\nBearer secret\nBearer a');

  assert.equal(output, 'Bearer [REDACTED]\nBearer [REDACTED]\nBearer [REDACTED]');
});

test('diagnostic redaction removes URL userinfo and complete cookie header values', () => {
  const output = redactDiagnostic(
    'https://alice:supersecret@example.test/log\nCookie: session=one; csrf=two\nSet-Cookie: session=three; HttpOnly\nhttps://example.test/safe',
  );

  assert.match(output, /https:\/\/\[REDACTED\]@example\.test\/log/);
  assert.match(output, /Cookie: \[REDACTED\]/);
  assert.match(output, /Set-Cookie: \[REDACTED\]/);
  assert.match(output, /https:\/\/example\.test\/safe/);
  assert.doesNotMatch(output, /alice|supersecret|session=one|csrf=two|session=three/);
});

test('legacy lastError-only state remains readable in both status modes', async () => {
  const injected = createMockDispatcherHarness([], {
    initialState: { issue: 9, status: 'blocked', lastError: 'legacy failure summary' },
  });
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);
  try {
    const dispatcherArgs = ['--status'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
    const dispatcherArgs2 = ['--status', '--verbose'];
    const parsedDispatcherCommand2 = parseDispatcherCommand(dispatcherArgs2);
    await runDispatcherCli(parsedDispatcherCommand2, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  for (const value of output)
    assert.deepEqual(JSON.parse(value), {
      issue: 9,
      status: 'blocked',
      lastError: 'legacy failure summary',
    });
});

test('successful state without errors remains unchanged in both status modes', async () => {
  const injected = createMockDispatcherHarness([], {
    initialState: { issue: 9, status: 'claimed' },
  });
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);
  try {
    const dispatcherArgs = ['--status'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
    const dispatcherArgs2 = ['--status', '--verbose'];
    const parsedDispatcherCommand2 = parseDispatcherCommand(dispatcherArgs2);
    await runDispatcherCli(parsedDispatcherCommand2, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  for (const value of output) assert.deepEqual(JSON.parse(value), { issue: 9, status: 'claimed' });
});

test('verbose status preserves quotes and shell-like diagnostic text exactly', async () => {
  const injectedDiagnostic = 'stdout: "quoted"\nstderr: $(whoami) & echo %PATH%\nexit=17';
  const injected = createMockDispatcherHarness([], {
    initialState: {
      issue: 9,
      status: 'blocked',
      lastError: 'short summary',
      lastErrorVerbose: injectedDiagnostic,
    },
  });
  let output;
  const originalLog = console.log;
  console.log = (value) => (output = value);
  try {
    const dispatcherArgs = ['--status', '--verbose'];
    const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
    await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
  } finally {
    console.log = originalLog;
  }

  assert.equal(JSON.parse(output).lastErrorVerbose, injectedDiagnostic);
});

test('prepareRecovery preserves PR and removes only the issue from completion', () => {
  const state = prepareRecovery(
    {
      pr: 15,
      headSha: 'head-15',
      mainBaseSha: 'main-10',
      reviewRound: 4,
      lastQaFeedback: 'fix the boundary case',
      taskContext: 'recovered task context',
      completedIssues: [1, 2],
      status: 'done',
    },
    1,
    15,
    1000,
    100,
  );

  assert.equal(state.pr, 15);
  assert.equal(state.branch, 'codex/issue-1');
  assert.equal(state.status, 'worker_running');
  assert.deepEqual(state.completedIssues, [2]);
  assert.equal(state.workerPid, -1);
  assert.equal(state.workerHeartbeatAt, 899);
  assert.equal(state.reviewRound, 4);
  assert.equal(state.lastQaFeedback, 'fix the boundary case');
  assert.equal(state.taskContext, 'recovered task context');
  assert.equal(state.headSha, 'head-15');
});

test('prepareRecovery preserves an existing collision-suffixed branch', () => {
  const state = prepareRecovery(
    { branch: 'codex/issue-1-071f', status: 'blocked' },
    1,
    15,
    1000,
    100,
  );

  assert.equal(state.branch, 'codex/issue-1-071f');
});

test('prepareRecovery persists the canonical branch from empty state', () => {
  const state = prepareRecovery({}, 31, 54, 1000, 100);

  assert.equal(state.issue, 31);
  assert.equal(state.pr, 54);
  assert.equal(state.branch, 'codex/issue-31');
  assert.equal(state.status, 'worker_running');
});

test('no-work done state clears all prior run context', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: {
      issue: 9,
      status: 'blocked',
      pr: 14,
      branch: 'codex/issue-9',
      headSha: 'old-head',
      mainBaseSha: 'old-main',
      reviewRound: 4,
      lastCiFeedback: 'old CI',
      lastQaFeedback: 'old QA',
      lastStaffFeedback: 'old Staff',
      taskContext: 'old context',
      workerRunId: 'old-run',
      workerPid: 123,
      workerStartedAt: 1,
      workerHeartbeatAt: 1,
      workerRecoveryCount: 2,
      lastError: 'old error',
      completedIssues: [8],
      mainGreen: true,
    },
  });
  dispatcherHarness.setState({
    completedIssues: [8],
    mainGreen: true,
    status: undefined,
    issue: undefined,
    pr: undefined,
    branch: undefined,
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.deepEqual(dispatcherHarness.state(), {
    completedIssues: [8],
    mainGreen: true,
    status: 'done',
    drainStatus: 'done',
    updatedAt: dispatcherHarness.state().updatedAt,
  });
});

test('resetRunState clears stale run context and preserves completed issues', () => {
  const state = resetRunState(
    {
      issue: 21,
      pr: 20,
      branch: 'codex/issue-3',
      status: 'worker_recovery_pending',
      workerPid: -1,
      completedIssues: [1, 2, 3],
      mainGreen: true,
      lastError: 'stale worker',
    },
    () => false,
  );

  assert.deepEqual(state.completedIssues, [1, 2, 3]);
  assert.equal(state.status, undefined);
  assert.equal(state.pr, undefined);
  assert.equal(state.branch, undefined);
  assert.equal(state.lastError, undefined);
  assert.equal(state.drainStatus, 'running');
});

test('resetRunState refuses a live Worker', () => {
  assert.throws(
    () => resetRunState({ status: 'worker_running', workerPid: 123 }, () => true),
    /cannot reset while Worker process 123 is still running/,
  );
});

test('recoverStaleLock removes only a lock owned by a dead process', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lock-'));
  const lock = dispatcherLockPath(root);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 9999 }));

  assert.match(
    recoverStaleLock(root, () => false),
    /Recovered stale dispatcher lock/,
  );
  assert.equal(existsSync(lock), false);
  rmSync(root, { recursive: true, force: true });
});

test('recoverStaleLock refuses a live owner', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lock-'));
  const lock = dispatcherLockPath(root);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 9999 }));

  assert.throws(
    () => recoverStaleLock(root, () => true),
    (error) => error.exitCode === 3 && /owner PID 9999 is still running/.test(error.message),
  );
  assert.equal(existsSync(lock), true);
  rmSync(root, { recursive: true, force: true });
});

test('lock reclaim uses injected storage and process liveness seams', () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  dispatcherHarness.dependencies.now = () => 100;
  dispatcherHarness.dependencies.tryAcquire = () => false;
  dispatcherHarness.dependencies.readOwner = () => ({ pid: 41, createdAt: 0, token: 'old' });
  dispatcherHarness.dependencies.processAlive = (pid) => (calls.push(`processAlive:${pid}`), false);
  dispatcherHarness.dependencies.tryBeginReclaim = (() => {
    let attempt = 0;
    return () => ++attempt > 1;
  })();
  dispatcherHarness.dependencies.readReclaimOwner = () => ({
    pid: 42,
    createdAt: 0,
    token: 'reclaimer',
  });
  dispatcherHarness.dependencies.abandonReclaim = () => calls.push('abandonReclaim');
  dispatcherHarness.dependencies.finishReclaim = () => calls.push('finishReclaim');
  const token = acquire(dispatcherHarness.dependencies, 10);

  assert.match(token, /^[0-9a-f-]+$/);
  assert.deepEqual(calls, [
    'processAlive:41',
    'processAlive:42',
    'abandonReclaim',
    'finishReclaim',
  ]);
});

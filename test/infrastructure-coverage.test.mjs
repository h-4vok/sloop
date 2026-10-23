import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { productionConfigReconciler, productionDependencies } from '../src/adapters.js';
import { canonicalConfigYaml, loadConfigText } from '../src/config.js';
import { CliFailure } from '../src/dispatcher.js';
import { withEphemeralMutex, withEphemeralMutexAsync } from '../src/mutex.js';
import { RunLogger, applyRunRetention, runDirectory } from '../src/run-log.js';
import { runManifestMarker } from '../src/remote-state.js';

const createTemporaryDirectory = (prefix) => createIsolatedTemporaryDirectory(join(tmpdir(), prefix));
const createTestRunManifest = (overrides = {}) => ({
  protocol: 1,
  runId: 'adapter-run',
  issue: 81,
  pr: 9,
  branch: 'codex/issue-81-x',
  baseSha: 'abcdef1',
  configFingerprint: 'config',
  phase: 'working',
  reviewRound: 1,
  contextCursor: '',
  artifacts: [],
  ...overrides,
});

// This builds the real production adapter dependencies with a mocked GitHub CLI boundary.

function createAdapterDependenciesWithMockGitHubCommand(execute, repository = 'owner/repository') {
  return productionDependencies(
    createTemporaryDirectory('sloop-infra-adapter-'),
    loadConfigText(canonicalConfigYaml()),
    repository,
    {
      execFileSync: execute,
    },
  );
}

test('remote snapshot normalizes issue and pull-request state', () => {
  const issueNumber = 81;
  const manifestOptions = { artifacts: ['saved-key'] };
  const runManifest = createTestRunManifest(manifestOptions);
  const manifestMarker = runManifestMarker(runManifest);

  // The issue marker links this snapshot request to PR 9, which the adapter then loads.

  const mockIssueResponse = {
    labels: [{ name: 'eligible' }],
    comments: [{ body: manifestMarker }],
  };
  const mockPullRequestResponse = {
    number: 9,
    headRefName: 'codex/issue-81-x',
    comments: [{ body: 'sloop-v1/legacy' }],
  };
  const mockReviewThreadsResponse = {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
        },
      },
    },
  };
  const mockGitHubCommand = (_commandFile, commandArgs) => {
    const isIssueSnapshotRequest = commandArgs[0] === 'issue' && commandArgs[1] === 'view';
    const isPullRequestSnapshotRequest = commandArgs[0] === 'pr' && commandArgs[1] === 'view';
    const isReviewThreadQuery = commandArgs[0] === 'api';

    if (isIssueSnapshotRequest) return JSON.stringify(mockIssueResponse);
    if (isPullRequestSnapshotRequest) return JSON.stringify(mockPullRequestResponse);
    if (isReviewThreadQuery) return JSON.stringify(mockReviewThreadsResponse);

    throw new Error(`Unexpected mock GitHub command: ${commandArgs.join(' ')}`);
  };
  const adapterDependencies = createAdapterDependenciesWithMockGitHubCommand(mockGitHubCommand);
  const expectedLabels = ['eligible'];
  const expectedInlineThreads = [{ resolved: true }, { resolved: false }];

  const remoteSnapshot = adapterDependencies.remote.snapshot(issueNumber);

  assert.deepEqual(remoteSnapshot.labels, expectedLabels);
  assert.equal(remoteSnapshot.pr, 9);
  assert.equal(remoteSnapshot.branch, 'codex/issue-81-x');
  assert.deepEqual(remoteSnapshot.inlineThreads, expectedInlineThreads);
  assert.ok(remoteSnapshot.markers.includes('sloop-v1/legacy'));
});

test('remote claims publish string leases and manifest leases', () => {
  const calls = [];
  const events = [];
  const adapterDependencies = createAdapterDependenciesWithMockGitHubCommand((_file, args) => {
    calls.push(args);
    return '';
  });
  adapterDependencies.setRunLogger({ write: (type, data) => events.push({ type, data }) });

  adapterDependencies.remote.claim(81, 'key', 'lease');
  adapterDependencies.remote.claim(
    81,
    'key',
    createTestRunManifest({ artifacts: ['existing'], lease: { owner: 'lease-owner', expiresAt: 7 } }),
  );

  assert.ok(calls.some((args) => args.includes('sloop/v1/lease/81/key/lease')));
  assert.ok(calls.some((args) => args.some((arg) => String(arg).includes('lease-owner/7'))));
  assert.ok(events.some((event) => event.type === 'github-response'));
});

test('remote snapshot rejects a repository identifier outside owner/repository form', () => {
  const marker = runManifestMarker(createTestRunManifest());
  const invalidRepo = createAdapterDependenciesWithMockGitHubCommand(
    () => JSON.stringify({ comments: [{ body: marker }] }),
    'invalid',
  );

  assert.throws(() => invalidRepo.remote.snapshot(81), /GitHub snapshot unavailable/);
});

test('production adapter methods preserve failures from the GitHub command boundary', () => {
  const failing = createAdapterDependenciesWithMockGitHubCommand(() => {
    throw 'raw failure';
  });

  assert.throws(() => failing.list(), /raw failure/);
  assert.throws(() => failing.eligible(), /raw failure/);
  assert.throws(() => failing.pullRequest(9), /raw failure/);
  assert.throws(() => failing.updatePullRequestBody(9, 'body'), /raw failure/);
  assert.throws(() => failing.remote.reconcile(81, 'key'), /GitHub reconciliation unavailable/);
  assert.throws(() => failing.pullRequestBody(9), /raw failure/);
  assert.throws(() => failing.prComment(9, 'body'), /raw failure/);
  assert.throws(() => failing.remote.claim(81, 'key', 'lease'), /raw failure/);
  assert.throws(() => failing.remote.publish(81, createTestRunManifest()), /raw failure/);
});
test('adapter local callback surface preserves dispatcher contracts without GitHub access', async () => {
  const adapterDependencies = createAdapterDependenciesWithMockGitHubCommand(() => undefined);

  assert.equal(adapterDependencies.loadConfig().workerCommand.command, 'codex');
  assert.deepEqual(adapterDependencies.status(true), {});
  assert.equal(adapterDependencies.recoverLock(), 'No dispatcher lock found.');
  adapterDependencies.reset();
  assert.equal(adapterDependencies.load().drainStatus, 'running');
  assert.throws(
    () =>
      adapterDependencies.resolveReviewCap(
        {
          steer: '',
          abandon: false,
          waiveAllOutstanding: false,
          waivedFindingIds: [],
          additionalRounds: 0,
        },
        {},
      ),
    /choose --additional-rounds/,
  );
  assert.throws(() => adapterDependencies.linkIssue(0), /positive issue number/);
  assert.equal(await adapterDependencies.run(undefined), '');
  assert.throws(() => adapterDependencies.prepareWorkerBranch(0), /git status/);
  assert.throws(() => adapterDependencies.checkoutWorkerBranch('does-not-exist'), /git/);
  adapterDependencies.release('not-held');
});

test('production config reconciler delegates validated synchronization through its host seam', async () => {
  const dir = createTemporaryDirectory('sloop-infra-reconciler-');
  writeFileSync(join(dir, 'sloop.config.yaml'), canonicalConfigYaml());
  const calls = [];
  const reconciler = productionConfigReconciler(dir, (path, config) => {
    calls.push({ path, config });
  });
  await reconciler(dir, 'github');
  await reconciler(dir, 'skills');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].config.schemaVersion, 1);
  const failing = productionConfigReconciler(dir, () => {
    throw 'sync down';
  });
  await assert.rejects(() => failing(dir, 'github'), /github synchronization failed: sync down/);
});

test('adapter workspace callbacks use the configured checkout lifecycle', () => {
  const checkout = createTemporaryDirectory('sloop-infra-checkout-');
  const remote = createTemporaryDirectory('sloop-infra-checkout-remote-');
  const runGitCommand = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
  runGitCommand('init', '-b', 'main');
  runGitCommand('config', 'user.email', 'test@example.com');
  runGitCommand('config', 'user.name', 'Sloop Test');
  writeFileSync(join(checkout, 'README.md'), 'base\n');
  runGitCommand('add', '.');
  runGitCommand('commit', '-m', 'base');
  execFileSync('git', ['init', '--bare'], { cwd: remote, encoding: 'utf8' });
  runGitCommand('remote', 'add', 'origin', remote);
  runGitCommand('push', '-u', 'origin', 'main');
  const config = loadConfigText(canonicalConfigYaml());
  const adapterDependencies = productionDependencies(checkout, config, 'owner/repository', {
    execFileSync: () => '{}',
  });
  const worker = adapterDependencies.prepareWorkerBranch(81);

  assert.match(worker.branch, /^codex\/issue-81-/);
  adapterDependencies.checkoutWorkerBranch(worker.branch);
  const facts = adapterDependencies.workspaceAdapter.prepare(82);
  assert.equal(facts.executionRoot, checkout);
  adapterDependencies.workspaceAdapter.cleanup(facts);
  assert.equal(adapterDependencies.workspaceAdapter.context().executionRoot, checkout);
});

// These are production adapters; only the GitHub CLI boundary is mocked so the tests exercise remote snapshot behavior.

const createSnapshotAdapterDependenciesWithMockGitHubCommand = (issueResponse) => {
  const issueNumber = 81;
  const mockGitHubCommand = (_file, commandArgs) => {
    const isIssueSnapshotRequest = commandArgs[0] === 'issue' && commandArgs[1] === 'view';
    const isPullRequestRequest = commandArgs[0] === 'pr';
    const isReviewThreadRequest = commandArgs[0] === 'api';

    if (isIssueSnapshotRequest) return JSON.stringify(issueResponse);
    if (isPullRequestRequest) {
      const mockPullRequestResponse = { statusCheckRollup: [{}] };
      return JSON.stringify(mockPullRequestResponse);
    }
    if (isReviewThreadRequest) {
      const emptyReviewThreadsResponse = {};
      return JSON.stringify(emptyReviewThreadsResponse);
    }
    return '';
  };

  return createAdapterDependenciesWithMockGitHubCommand(mockGitHubCommand);
};

test('remote snapshot returns no inline threads when the API response has none', () => {
  const issueNumber = 81;
  const mockIssueResponse = {};
  const adapterDependencies = createSnapshotAdapterDependenciesWithMockGitHubCommand(mockIssueResponse);

  const snapshot = adapterDependencies.remote.snapshot(issueNumber);

  assert.deepEqual(snapshot.inlineThreads, []);
});

test('remote snapshot preserves a legacy marker comment', () => {
  const issueNumber = 81;
  const mockIssueResponse = { comments: [{ body: 'sloop/v1/marker' }] };
  const adapterDependencies = createSnapshotAdapterDependenciesWithMockGitHubCommand(mockIssueResponse);

  const snapshot = adapterDependencies.remote.snapshot(issueNumber);

  const expectedComments = [{ body: 'sloop/v1/marker' }];

  assert.deepEqual(snapshot.comments, expectedComments);
});

test('remote snapshot uses pull-request metadata when a manifest marker is present', () => {
  const issueNumber = 81;
  const runManifest = createTestRunManifest({ artifacts: [] });
  const manifestMarker = runManifestMarker(runManifest);
  const mockIssueResponse = { comments: [{ body: manifestMarker }] };
  const adapterDependencies = createSnapshotAdapterDependenciesWithMockGitHubCommand(mockIssueResponse);

  const snapshot = adapterDependencies.remote.snapshot(issueNumber);
  const hasUnregisteredArtifact = adapterDependencies.remote.reconcile(issueNumber, 'missing');

  assert.equal(snapshot.pr, 9);
  assert.equal(snapshot.branch, 'codex/issue-81-x');
  assert.equal(hasUnregisteredArtifact, false);
});

test('production adapter methods preserve non-Error failures', () => {
  const rawFailure = createAdapterDependenciesWithMockGitHubCommand(() => {
    throw 'raw failure';
  });
  assert.throws(() => rawFailure.comment(81, 'body'), /raw failure/);
  assert.throws(() => rawFailure.prComment(81, 'body'), /raw failure/);
  assert.throws(() => rawFailure.updatePullRequestBody(81, 'body'), /raw failure/);
  assert.throws(() => rawFailure.pullRequestBody(81), /raw failure/);
  assert.throws(() => rawFailure.remote.snapshot(81), /raw failure/);
  assert.throws(() => rawFailure.remote.reconcile(81, 'key'), /raw failure/);
  assert.throws(() => rawFailure.remote.claim(81, 'key', 'lease'), /raw failure/);
  assert.throws(() => rawFailure.remote.publish(81, createTestRunManifest()), /raw failure/);
});

test('production adapters preserve already-normalized CLI failures', () => {
  const cliFailure = createAdapterDependenciesWithMockGitHubCommand(() => {
    throw new CliFailure(5, 'already normalized');
  });
  assert.throws(
    () => cliFailure.list(),
    (error) => error instanceof CliFailure && error.message === 'already normalized',
  );
});

test('local mutex removes its lease after sync and async results or failures', async () => {
  const dir = createTemporaryDirectory('sloop-infra-mutex-');

  assert.equal(
    withEphemeralMutex(dir, 'one', () => 'done'),
    'done',
  );
  assert.equal(existsSync(join(dir, '.sloop', 'mutex', 'active')), false);
  assert.throws(
    () =>
      withEphemeralMutex(dir, 'one', () => {
        throw new Error('work failed');
      }),
    /work failed/,
  );
  assert.equal(await withEphemeralMutexAsync(dir, 'two', async () => 2), 2);
  await assert.rejects(
    () =>
      withEphemeralMutexAsync(dir, 'two', async () => {
        throw new Error('async failed');
      }),
    /async failed/,
  );
  mkdirSync(join(dir, '.sloop', 'mutex', 'active'), { recursive: true });
  assert.throws(() => withEphemeralMutex(dir, 'three', () => undefined), /another sloop process/);
  await assert.rejects(
    () => withEphemeralMutexAsync(dir, 'three', async () => undefined),
    /another sloop process/,
  );
  assert.throws(() => withEphemeralMutex('\0', 'invalid', () => undefined));
  await assert.rejects(() => withEphemeralMutexAsync('\0', 'invalid', async () => undefined));
});

test('run directory names include timestamp, issue, and normalized run ID', () => {
  const dir = createTemporaryDirectory('sloop-infra-log-');

  assert.match(
    runDirectory(dir, 7, 'run/id', new Date('2026-01-02T03:04:05.678Z')),
    /20260102T030405Z-issue-7-run_id$/,
  );
});

test('run retention preserves recent entries and removes old entries', () => {
  const dir = createTemporaryDirectory('sloop-infra-retention-');
  const logs = join(dir, '.sloop', 'runs', '20200101T000000Z-issue-1-old');
  mkdirSync(logs, { recursive: true });
  const current = join(dir, '.sloop', 'runs', '20260101T000000Z-issue-2-current');
  mkdirSync(current, { recursive: true });
  mkdirSync(join(dir, '.sloop', 'runs', 'not-a-run'), { recursive: true });
  applyRunRetention(dir);
  assert.equal(existsSync(logs), true);
  assert.throws(() => applyRunRetention(dir, -1), /non-negative/);
  applyRunRetention(dir, 0, Date.parse('2026-01-01T00:00:01Z'));
  assert.equal(existsSync(logs), false);
  assert.equal(existsSync(current), false);
  applyRunRetention(createTemporaryDirectory('sloop-infra-no-runs-'), 0);
});

test('run logger restores sequence after a corrupt tail and records event payloads', () => {
  const dir = createTemporaryDirectory('sloop-infra-event-log-');
  const eventRunDirectory = join(dir, 'event-run');
  mkdirSync(eventRunDirectory, { recursive: true });
  writeFileSync(join(eventRunDirectory, 'events.jsonl'), '{"seq":4}\nnot-json\n');
  const logger = new RunLogger(eventRunDirectory);
  logger.write('plain');
  logger.command('git status', 'out', 'err', dir);
  logger.stream('stdout', 'chunk');
  const events = readFileSync(join(eventRunDirectory, 'events.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/);
  assert.equal(JSON.parse(events.at(-3)).seq, 1);
  assert.deepEqual(JSON.parse(events.at(-2)).data, {
    command: 'git status',
    stdout: 'out',
    stderr: 'err',
    cwd: dir,
  });
  assert.equal(JSON.parse(events.at(-1)).data, 'chunk');

  const restoredRunDirectory = join(dir, 'restored-run');
  mkdirSync(restoredRunDirectory, { recursive: true });
  writeFileSync(join(restoredRunDirectory, 'events.jsonl'), '{"seq":4}\n');
  const next = new RunLogger(restoredRunDirectory);
  next.write('next', { value: true });
  assert.equal(JSON.parse(readFileSync(next.file, 'utf8').trim().split(/\r?\n/).at(-1)).seq, 5);
});

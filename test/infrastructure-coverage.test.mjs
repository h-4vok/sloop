import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { productionConfigReconciler, productionDependencies } from '../dist/adapters.js';
import { canonicalConfigYaml, loadConfigText } from '../dist/config.js';
import { CliFailure } from '../dist/dispatcher.js';
import { withEphemeralMutex, withEphemeralMutexAsync } from '../dist/mutex.js';
import { RunLogger, applyRunRetention, runDirectory } from '../dist/run-log.js';
import { runManifestMarker } from '../dist/remote-state.js';

const root = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const manifest = (overrides = {}) => ({
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

function dependencies(execute, repository = 'owner/repository') {
  return productionDependencies(
    root('sloop-infra-adapter-'),
    loadConfigText(canonicalConfigYaml()),
    repository,
    {
      execFileSync: execute,
    },
  );
}

test('adapter covers successful remote snapshot, claim forms, and GitHub error reporting', () => {
  const calls = [];
  const events = [];
  const marker = runManifestMarker(manifest({ artifacts: ['saved-key'] }));
  const deps = dependencies((_file, args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'view' && args.includes('labels,comments'))
      return JSON.stringify({
        labels: [{ name: 'eligible' }],
        comments: [{ body: `old sloop/v1/x ${marker}` }],
      });
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 9,
        headRefName: 'codex/issue-81-x',
        headRefOid: 'deadbeef',
        comments: [{ body: `${marker} sloop-v1/legacy` }],
        reviews: [{ state: 'APPROVED' }],
        statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      });
    if (args[0] === 'api')
      return JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
            },
          },
        },
      });
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ comments: [] });
    return '';
  });
  deps.setRunLogger({ write: (type, data) => events.push({ type, data }) });

  const snapshot = deps.remote.snapshot(81);
  assert.deepEqual(snapshot.labels, ['eligible']);
  assert.equal(snapshot.pr, 9);
  assert.equal(snapshot.branch, 'codex/issue-81-x');
  assert.deepEqual(snapshot.inlineThreads, [{ resolved: true }, { resolved: false }]);
  assert.ok(snapshot.markers.includes('sloop-v1/legacy'));
  deps.remote.claim(81, 'key', 'lease');
  deps.remote.claim(
    81,
    'key',
    manifest({ artifacts: ['existing'], lease: { owner: 'lease-owner', expiresAt: 7 } }),
  );
  assert.ok(calls.some((args) => args.includes('sloop/v1/lease/81/key/lease')));
  assert.ok(calls.some((args) => args.some((arg) => String(arg).includes('lease-owner/7'))));
  assert.ok(events.some((event) => event.type === 'github-response'));

  const invalidRepo = dependencies(
    () => JSON.stringify({ comments: [{ body: marker }] }),
    'invalid',
  );
  assert.throws(() => invalidRepo.remote.snapshot(81), /GitHub snapshot unavailable/);
  const failing = dependencies(() => {
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
  assert.throws(() => failing.remote.publish(81, manifest()), /raw failure/);
});

test('adapter local callback surface preserves dispatcher contracts without GitHub access', async () => {
  const deps = dependencies(() => undefined);
  assert.equal(deps.loadConfig().workerCommand.command, 'codex');
  assert.deepEqual(deps.status(true), {});
  assert.equal(deps.recoverLock(), 'No dispatcher lock found.');
  deps.reset();
  assert.equal(deps.load().drainStatus, 'running');
  assert.throws(
    () =>
      deps.resolveReviewCap(
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
  assert.throws(() => deps.linkIssue(0), /positive issue number/);
  assert.equal(await deps.run(undefined), '');
  assert.throws(() => deps.prepareWorkerBranch(0), /git status/);
  assert.throws(() => deps.checkoutWorkerBranch('does-not-exist'), /git/);
  deps.release('not-held');
});

test('production config reconciler delegates validated synchronization through its host seam', async () => {
  const dir = root('sloop-infra-reconciler-');
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
  const checkout = root('sloop-infra-checkout-');
  const remote = root('sloop-infra-checkout-remote-');
  const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Sloop Test');
  writeFileSync(join(checkout, 'README.md'), 'base\n');
  git('add', '.');
  git('commit', '-m', 'base');
  execFileSync('git', ['init', '--bare'], { cwd: remote, encoding: 'utf8' });
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main');
  const config = loadConfigText(canonicalConfigYaml());
  const deps = productionDependencies(checkout, config, 'owner/repository', {
    execFileSync: () => '{}',
  });
  const worker = deps.prepareWorkerBranch(81);
  assert.match(worker.branch, /^codex\/issue-81-/);
  deps.checkoutWorkerBranch(worker.branch);
  const facts = deps.workspaceAdapter.prepare(82);
  assert.equal(facts.executionRoot, checkout);
  deps.workspaceAdapter.cleanup(facts);
  assert.equal(deps.workspaceAdapter.context().executionRoot, checkout);
});

test('adapter covers non-Error failures and every optional remote snapshot shape', () => {
  const base = manifest({ artifacts: [] });
  let issueMode = 'empty';
  const deps = dependencies((_file, args) => {
    if (args[0] === 'issue' && args[1] === 'view') {
      if (issueMode === 'manifest')
        return JSON.stringify({ comments: [{ body: runManifestMarker(base) }] });
      if (issueMode === 'comments')
        return JSON.stringify({ comments: [{ body: 'sloop/v1/marker' }] });
      return JSON.stringify({});
    }
    if (args[0] === 'pr') return JSON.stringify({ statusCheckRollup: [{}] });
    if (args[0] === 'api') return JSON.stringify({});
    return '';
  });
  assert.deepEqual(deps.remote.snapshot(81).inlineThreads, []);
  issueMode = 'comments';
  assert.deepEqual(deps.remote.snapshot(81).comments, [{ body: 'sloop/v1/marker' }]);
  issueMode = 'manifest';
  const fallback = deps.remote.snapshot(81);
  assert.equal(fallback.pr, 9);
  assert.equal(fallback.branch, 'codex/issue-81-x');
  assert.equal(deps.remote.reconcile(81, 'missing'), false);

  const rawFailure = dependencies(() => {
    throw 'raw failure';
  });
  assert.throws(() => rawFailure.comment(81, 'body'), /raw failure/);
  assert.throws(() => rawFailure.prComment(81, 'body'), /raw failure/);
  assert.throws(() => rawFailure.updatePullRequestBody(81, 'body'), /raw failure/);
  assert.throws(() => rawFailure.pullRequestBody(81), /raw failure/);
  assert.throws(() => rawFailure.remote.snapshot(81), /raw failure/);
  assert.throws(() => rawFailure.remote.reconcile(81, 'key'), /raw failure/);
  assert.throws(() => rawFailure.remote.claim(81, 'key', 'lease'), /raw failure/);
  assert.throws(() => rawFailure.remote.publish(81, base), /raw failure/);

  const cliFailure = dependencies(() => {
    throw new CliFailure(5, 'already normalized');
  });
  assert.throws(
    () => cliFailure.list(),
    (error) => error instanceof CliFailure && error.message === 'already normalized',
  );
});

test('local mutex removes its lease after sync and async results or failures', async () => {
  const dir = root('sloop-infra-mutex-');
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

test('run logging restores valid sequence, tolerates corrupt tails, and expires only old directories', () => {
  const dir = root('sloop-infra-log-');
  assert.match(
    runDirectory(dir, 7, 'run/id', new Date('2026-01-02T03:04:05.678Z')),
    /20260102T030405Z-issue-7-run_id$/,
  );
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
  applyRunRetention(root('sloop-infra-no-runs-'), 0);

  const run = join(dir, 'event-run');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'events.jsonl'), '{"seq":4}\nnot-json\n');
  const logger = new RunLogger(run);
  logger.write('plain');
  logger.command('git status', 'out', 'err', dir);
  logger.stream('stdout', 'chunk');
  const events = readFileSync(join(run, 'events.jsonl'), 'utf8').trim().split(/\r?\n/);
  assert.equal(JSON.parse(events.at(-3)).seq, 1);
  assert.deepEqual(JSON.parse(events.at(-2)).data, {
    command: 'git status',
    stdout: 'out',
    stderr: 'err',
    cwd: dir,
  });
  assert.equal(JSON.parse(events.at(-1)).data, 'chunk');

  const restored = join(dir, 'restored-run');
  mkdirSync(restored, { recursive: true });
  writeFileSync(join(restored, 'events.jsonl'), '{"seq":4}\n');
  const next = new RunLogger(restored);
  next.write('next', { value: true });
  assert.equal(JSON.parse(readFileSync(next.file, 'utf8').trim().split(/\r?\n/).at(-1)).seq, 5);
});

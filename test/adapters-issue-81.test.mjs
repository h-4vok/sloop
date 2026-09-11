import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { canonicalConfigYaml, loadConfigText } from '../dist/config.js';
import { productionConfigReconciler, productionDependencies } from '../dist/adapters.js';
import { CliFailure } from '../dist/dispatcher.js';
import { runManifestMarker } from '../dist/remote-state.js';

function setup(execute) {
  const root = mkdtempSync(join(tmpdir(), 'sloop-81-adapters-'));
  return productionDependencies(root, loadConfigText(canonicalConfigYaml()), 'o/r', {
    execFileSync: execute,
  });
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'sloop-adapter-workspace-'));
  const remote = mkdtempSync(join(tmpdir(), 'sloop-adapter-remote-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Sloop Test');
  writeFileSync(join(root, 'README.md'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  return root;
}

test('adapter wraps GitHub launch failures and reconciles published keys', () => {
  const calls = [];
  const dependencies = setup((_file, args) => {
    calls.push(args);
    if (args[0] === 'issue' && args.includes('--json'))
      return JSON.stringify({ comments: [{ body: 'artifact-key' }] });
    throw new Error('permission denied');
  });
  assert.throws(
    () => dependencies.comment(81, 'body'),
    (error) => {
      assert.ok(error instanceof CliFailure);
      assert.equal(error.exitCode, 5);
      return true;
    },
  );
  assert.equal(dependencies.remote.reconcile(81, 'artifact-key'), true);
  assert.ok(calls.some((args) => args[0] === 'issue' && args[1] === 'view'));
});

test('adapter rejects malformed snapshots and preserves GraphQL scope rules', () => {
  const dependencies = setup((_file, args) => {
    if (args[0] === 'issue')
      return JSON.stringify({
        labels: [],
        comments: [
          {
            body: runManifestMarker({
              protocol: 1,
              runId: 'x',
              issue: 81,
              pr: 9,
              branch: 'b',
              baseSha: 'abcdef1',
              configFingerprint: 'cfg',
              phase: 'working',
              reviewRound: 1,
              contextCursor: '',
              artifacts: [],
            }),
          },
        ],
      });
    if (args[0] === 'pr') return '{not-json';
    return '';
  });
  assert.throws(() => dependencies.remote.snapshot(81), /GitHub snapshot unavailable/);
});

test('adapter publishes manifests, cleans temporary PR bodies, and exposes lock recovery', () => {
  const calls = [];
  const dependencies = setup((_file, args) => {
    calls.push({
      args: [...args],
      body: args.includes('--body-file')
        ? readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
        : undefined,
    });
    return '';
  });
  const manifest = {
    protocol: 1,
    runId: 'run',
    issue: 81,
    branch: 'b',
    baseSha: 'abcdef1',
    configFingerprint: 'cfg',
    phase: 'working',
    reviewRound: 1,
    contextCursor: '',
    artifacts: [],
  };
  dependencies.remote.publish(81, manifest);
  dependencies.updatePullRequestBody(9, 'safe');
  assert.match(calls[0].args.join(' '), /issue comment 81/);
  assert.match(calls[0].args.join(' '), /sloop\/v1\/run\/run/);
  assert.equal(
    readdirSync(dependencies.root).some((name) => name.startsWith('.sloop-pr-')),
    false,
  );
  assert.equal(dependencies.tryAcquire({ pid: 1, createdAt: 1, token: 't' }), true);
  assert.equal(dependencies.tryAcquire({ pid: 2, createdAt: 2, token: 'u' }), false);
  dependencies.release('t');
});

test('production reconciler supports configured sync kinds and rejects unsupported kinds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-81-reconciler-'));
  const config = loadConfigText(canonicalConfigYaml());
  const reconciler = productionConfigReconciler(root);
  reconciler.preflight(root, 'github');
  reconciler.preflight(root, 'none');
  assert.throws(() => reconciler.preflight(root, 'unknown'), /No production reconciler/);
  await assert.rejects(() => reconciler(root, 'unknown'), /No production reconciler/);
  await assert.doesNotReject(() => reconciler(root, 'none'));
  assert.equal(config.schemaVersion, 1);
});

test('production adapters expose deterministic local, GitHub, and lock contracts through one executor seam', async () => {
  const calls = [];
  const events = [];
  const dependencies = setup((_file, args) => {
    calls.push([...args]);
    if (args[0] === 'issue' && args[1] === 'list')
      return JSON.stringify([
        { number: 4, title: 'four', body: 'body' },
        { number: 2, title: 'two', body: 'body' },
      ]);
    if (args[0] === 'pr' && args[1] === 'view' && args.includes('body'))
      return JSON.stringify({ body: 'PR body' });
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 9,
        body: 'PR body',
        reviews: [{ commit: { oid: 'abcdef1' }, submitted_at: 'now' }],
        comments: [{ body: 'comment', created_at: 'then' }],
        statusCheckRollup: [{ context: 'pr-checks', state: 'SUCCESS', details_url: 'url' }],
      });
    return JSON.stringify({ comments: [] });
  });
  dependencies.setRunLogger({ write: (type, data) => events.push({ type, data }) });

  assert.deepEqual(dependencies.list(), [
    { number: 2, title: 'two' },
    { number: 4, title: 'four' },
  ]);
  assert.deepEqual(
    dependencies.eligible().map(({ number }) => number),
    [2, 4],
  );
  assert.equal(dependencies.pullRequest(9).reviews[0].commitId, 'abcdef1');
  assert.equal(dependencies.pullRequest(9).statusCheckRollup[0].name, 'pr-checks');
  assert.equal(dependencies.pullRequestBody(9), 'PR body');
  assert.ok(events.some(({ type }) => type === 'github-request'));
  assert.ok(events.some(({ type }) => type === 'github-response'));
  assert.ok(calls.every((args) => args[0] === 'api' || args.includes('--repo')));

  dependencies.save({ issue: 2, pr: 9, status: 'claimed' });
  assert.equal(dependencies.load().pr, 9);
  assert.deepEqual(dependencies.status(false), {
    issue: 2,
    pr: 9,
    status: 'claimed',
    lastError: undefined,
  });
  assert.equal(dependencies.prepareRecovery(2, undefined, { workerLeaseMs: 1 }), 9);
  assert.throws(() => dependencies.prepareRecovery(0, 9, {}), /issue number/);
  dependencies.save({});
  assert.throws(() => dependencies.prepareRecovery(2, undefined, {}), /requires --pr/);

  const owner = { pid: 1, createdAt: 1, token: 'token' };
  assert.equal(dependencies.tryAcquire(owner), true);
  assert.deepEqual(dependencies.readOwner(), owner);
  assert.equal(dependencies.tryBeginReclaim({ ...owner, token: 'reclaim' }), true);
  assert.equal(dependencies.tryBeginReclaim(owner), false);
  assert.equal(dependencies.readReclaimOwner().token, 'reclaim');
  assert.ok(dependencies.reclaimAgeMs(Date.now()) >= 0);
  dependencies.finishReclaim(owner);
  dependencies.abandonReclaim();
  dependencies.release('different-token');
  assert.deepEqual(dependencies.readOwner(), owner);
  dependencies.release('token');
  assert.throws(() => dependencies.readOwner());
  assert.equal(typeof dependencies.pid(), 'number');
  assert.equal(typeof dependencies.now(), 'number');
  await dependencies.sleep(0);
  dependencies.onReclaim();
});

test('production workspace adapter owns and cleans an isolated worktree lifecycle', () => {
  const root = repository();
  const config = loadConfigText(
    canonicalConfigYaml().replace('    checkout\n  path:', '    worktree\n  path:'),
  );
  const dependencies = productionDependencies(root, config, 'o/r', { execFileSync: () => '{}' });
  dependencies.save({ workerRunId: 'adapter-run' });
  const facts = dependencies.workspaceAdapter.prepare(81);
  assert.equal(dependencies.workspaceAdapter.context().executionRoot, facts.executionRoot);
  assert.equal(dependencies.runContext().executionRoot, facts.executionRoot);
  assert.equal(
    dependencies.workspaceAdapter.recover(81, 'adapter-run', facts.branch).branch,
    facts.branch,
  );
  assert.equal(dependencies.listAllWorktrees().length, 1);
  dependencies.workspaceAdapter.cleanup(facts);
  assert.equal(dependencies.workspaceAdapter.context().executionRoot, root);
  assert.equal(dependencies.listAllWorktrees().length, 0);
  dependencies.clearAllWorktrees();
});

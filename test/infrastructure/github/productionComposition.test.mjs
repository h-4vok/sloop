import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import { test } from 'vitest';

import assert from 'node:assert/strict';

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { execFileSync } from 'node:child_process';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

function createAdapterDependenciesWithMockGitHubCommand(execute) {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-81-adapters-'));
  return productionDependencies(root, loadConfigText(canonicalConfigYaml()), 'o/r', {
    execFileSync: execute,
  });
}

const runGitCommand = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function createRepository() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-workspace-'));
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-remote-'));
  runGitCommand(root, 'init', '-b', 'main');
  runGitCommand(root, 'config', 'user.email', 'test@example.com');
  runGitCommand(root, 'config', 'user.name', 'Sloop Test');
  writeFileSync(join(root, 'README.md'), 'base\n');
  runGitCommand(root, 'add', '.');
  runGitCommand(root, 'commit', '-m', 'base');
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  return root;
}

test('production reconciler supports configured sync kinds and rejects unsupported kinds', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-81-reconciler-'));
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
  const responses = new Map([
    [
      'issue list',
      JSON.stringify([
        { number: 4, title: 'four', body: 'body' },
        { number: 2, title: 'two', body: 'body' },
      ]),
    ],
    ['pr view body', JSON.stringify({ body: 'PR body' })],
    [
      'pr view summary',
      JSON.stringify({
        number: 9,
        body: 'PR body',
        reviews: [{ commit: { oid: 'abcdef1' }, submitted_at: 'now' }],
        comments: [{ body: 'comment', created_at: 'then' }],
        statusCheckRollup: [{ context: 'pr-checks', state: 'SUCCESS', details_url: 'url' }],
      }),
    ],
  ]);
  const dependencies = createAdapterDependenciesWithMockGitHubCommand((_file, args) => {
    calls.push([...args]);
    return respondToProductionCompositionCommand(args, responses);
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

  await assertLocalAndLockContracts(dependencies);
});

function respondToProductionCompositionCommand(args, responses) {
  const route = args.slice(0, 2).join(' ');
  const viewKind = args.includes('body') ? 'body' : 'summary';
  const key = route === 'pr view' ? `${route} ${viewKind}` : route;
  return responses.get(key) ?? JSON.stringify({ comments: [] });
}

async function assertLocalAndLockContracts(dependencies) {
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
  assert.ok(dependencies.reclaimAgeMs(Date.now() + 1000) >= 0);
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
}

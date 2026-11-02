import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { test, vi } from 'vitest';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

import { dispatcherControlsFactory } from '../../../src/infrastructure/adapters/createDispatcherControls.js';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

const createTemporaryDirectory = (prefix) =>
  createIsolatedTemporaryDirectory(join(tmpdir(), prefix));

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

test('adapter workspace callbacks use the configured checkout lifecycle', () => {
  const checkout = createTemporaryDirectory('sloop-infra-checkout-');
  const remote = createTemporaryDirectory('sloop-infra-checkout-remote-');
  const runGitCommand = (...args) =>
    execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
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
}, 15_000);

test('dispatcher controls list delegates to its eligible-issues port', () => {
  const eligibleIssues = [{ number: 7, title: 'Repair adapter boundary' }];
  const controls = dispatcherControlsFactory.create({
    root: tmpdir(),

    stateFile: join(tmpdir(), 'sloop-dispatcher-controls-state.json'),

    repository: 'owner/repository',

    remoteAuthority: {},

    config: loadConfigText(canonicalConfigYaml()),

    listEligibleIssues: () => eligibleIssues,

    loadPullRequest: () => ({ number: 7 }),
  });

  assert.equal(controls.list(), eligibleIssues);
});

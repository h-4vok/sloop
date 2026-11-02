import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { test, vi } from 'vitest';

import { activeRunReconcilerFactory } from '../../../src/infrastructure/adapters/createActiveRunReconciler.js';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

const createTemporaryDirectory = (prefix) =>
  createIsolatedTemporaryDirectory(join(tmpdir(), prefix));

function createAlignedWorkerRepository(branch) {
  const root = createTemporaryDirectory('sloop-active-run-reconcile-');
  const remote = createTemporaryDirectory('sloop-active-run-remote-');
  const runGitCommand = (directory, ...args) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();

  runGitCommand(root, 'init', '-b', 'main');
  runGitCommand(root, 'config', 'user.email', 'test@example.com');
  runGitCommand(root, 'config', 'user.name', 'Sloop Test');
  writeFileSync(join(root, 'README.md'), 'base\n');
  runGitCommand(root, 'add', '.');
  runGitCommand(root, 'commit', '-m', 'base');
  runGitCommand(remote, 'init', '--bare');
  runGitCommand(root, 'remote', 'add', 'origin', remote);
  runGitCommand(root, 'push', '-u', 'origin', 'main');
  runGitCommand(root, 'checkout', '-b', branch);
  writeFileSync(join(root, 'worker.txt'), 'worker change\n');
  runGitCommand(root, 'add', 'worker.txt');
  runGitCommand(root, 'commit', '-m', 'worker change');
  runGitCommand(root, 'push', '-u', 'origin', branch);

  return root;
}

test('active-run reconciliation classifies open and unverifiable runs', () => {
  assertReconciliationOutcomes(collectActiveRunOutcomes());
}, 15_000);

function collectActiveRunOutcomes() {
  const { config, state, client, reconcile } = createActiveRunScenario();
  const openResult = reconcile({ issue: 81, pr: 9, branch: 'codex/issue-81-x' });
  state.issueState = 'CLOSED';
  state.pullRequest = { ...state.pullRequest, body: 'Unrelated change' };
  const missingClosingReference = reconcile({ issue: 81, pr: 9, branch: 'codex/issue-81-x' });
  state.pullRequest = { ...state.pullRequest, body: 'Fixes #81' };
  const verifiedIdentity = reconcile({ issue: 81, pr: 9, branch: 'codex/issue-81-x' });
  const unavailableReconcile = activeRunReconcilerFactory.create({
    client,
    config,
    root: tmpdir(),
  })({ issue: 81, pr: 9, branch: 'codex/issue-81-x' });
  state.pullRequest = { ...state.pullRequest, state: 'MERGED' };
  state.issueState = 'OPEN';
  const mergedPullRequest = reconcile({ issue: 81, pr: 9, branch: 'codex/issue-81-x' });
  state.pullRequest = {
    number: 9,
    state: 'MERGED',
    baseRefName: config.repository.baseBranch,
    body: 'Fixes #81',
  };
  const missingBranch = reconcile({ issue: 81, pr: 9 });

  return {
    openResult,
    missingClosingReference,
    verifiedIdentity,
    unavailableReconcile,
    mergedPullRequest,
    missingBranch,
  };
}

function createActiveRunScenario() {
  const config = loadConfigText(canonicalConfigYaml());
  const state = {
    issueState: 'OPEN',
    pullRequest: {
      number: 9,
      state: 'OPEN',
      baseRefName: config.repository.baseBranch,
      headRefName: 'codex/issue-81-x',
      body: 'Fixes #81',
    },
  };
  const client = {
    runJson: (args) => (args[0] === 'issue' ? { state: state.issueState } : state.pullRequest),
  };
  const workerRoot = createAlignedWorkerRepository('codex/issue-81-x');
  const reconcile = activeRunReconcilerFactory.create({ client, config, root: workerRoot });

  return { config, state, client, reconcile };
}

function assertReconciliationOutcomes({
  openResult,
  missingClosingReference,
  verifiedIdentity,
  unavailableReconcile,
  mergedPullRequest,
  missingBranch,
}) {
  assert.deepEqual(openResult, {
    outcome: 'open',

    reason: 'issue and associated PR are not terminal',
  });
  assert.deepEqual(missingClosingReference, {
    outcome: 'blocked',

    reason: 'issue, PR, and branch identity could not be verified',
  });
  assert.equal(verifiedIdentity.outcome, 'terminal');
  assert.equal(verifiedIdentity.reason, 'issue closed; branch aligned');
  assert.match(unavailableReconcile.reason, /^could not verify local\/remote branch:/);
  assert.equal(mergedPullRequest.outcome, 'terminal');
  assert.equal(mergedPullRequest.reason, 'PR merged; branch aligned');
  assert.deepEqual(missingBranch, {
    outcome: 'blocked',

    reason: 'persisted worker branch is missing',
  });
}

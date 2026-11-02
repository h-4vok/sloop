import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { test, vi } from 'vitest';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

import { ExternalServiceError } from '../../../src/core/ExternalServiceError.js';

const createTemporaryDirectory = (prefix) =>
  createIsolatedTemporaryDirectory(join(tmpdir(), prefix));

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

test('eligible issue adapters select priority issues and list their public fields', () => {
  const issueResponses = [
    {
      number: 7,

      title: 'Normal issue',

      body: 'normal',

      labels: [{ name: 'eligible' }],
    },
    {
      number: 8,

      title: 'Priority issue',

      body: 'priority',

      labels: [{ name: 'eligible' }, { name: 'Priority: P0' }],
    },
  ];
  const adapterDependencies = createAdapterDependenciesWithMockGitHubCommand(() =>
    JSON.stringify(issueResponses),
  );

  const eligibleIssues = adapterDependencies.eligible();
  const listedIssues = adapterDependencies.list();

  assert.deepEqual(
    eligibleIssues.map(({ number }) => number),
    [8, 7],
  );
  assert.deepEqual(listedIssues, [
    { number: 8, title: 'Priority issue' },

    { number: 7, title: 'Normal issue' },
  ]);
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

test('production adapters preserve typed external-service failures', () => {
  const githubFailure = createAdapterDependenciesWithMockGitHubCommand(() => {
    throw new ExternalServiceError('github', 'already normalized');
  });
  assert.throws(
    () => githubFailure.list(),
    (error) =>
      error instanceof ExternalServiceError &&
      error.service === 'github' &&
      error.message === 'already normalized',
  );
});

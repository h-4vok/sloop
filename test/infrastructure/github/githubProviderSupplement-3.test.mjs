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

test('issue creation normalizes command failures and records the adapter error', () => {
  const events = [];
  const adapterDependencies = createAdapterDependenciesWithMockGitHubCommand(() => {
    throw new Error('issue creation denied');
  });
  adapterDependencies.setRunLogger({ write: (type, data) => events.push({ type, data }) });

  assert.throws(
    () => adapterDependencies.createIssue('title', 'body'),
    (error) => {
      assert.ok(error instanceof ExternalServiceError);
      assert.equal(error.service, 'github');
      assert.equal(error.message, 'issue creation denied');
      return true;
    },
  );
  assert.ok(
    events.some(({ type, data }) => type === 'github-error' && data.operation === 'issue.create'),
  );
});

test('issue creation returns IDs from GitHub URLs and reuses idempotent issues', () => {
  const calls = [];
  const adapterDependencies = createAdapterDependenciesWithMockGitHubCommand((_file, args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list')
      return JSON.stringify([{ number: 52, body: 'Idempotency key: request-52' }]);
    if (args[0] === 'issue' && args[1] === 'create')
      return 'https://github.com/owner/repo/issues/51\n';
    return '';
  });

  const createdIssue = adapterDependencies.createIssue('new issue', 'description');
  const reusedIssue = adapterDependencies.createIssue(
    'same request',
    'Idempotency key: request-52',
  );

  assert.equal(createdIssue, 51);
  assert.equal(reusedIssue, 52);
  assert.equal(calls.filter((args) => args[1] === 'create').length, 1);
});

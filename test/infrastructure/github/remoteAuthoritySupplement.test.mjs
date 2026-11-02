import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { test, vi } from 'vitest';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

import { runManifestMarker } from '../../../src/remote-state.js';

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
  const mockGitHubCommand = (_commandFile, commandArgs) =>
    respondToMockGitHubCommand(commandArgs, {
      'issue view': mockIssueResponse,
      'pr view': mockPullRequestResponse,
      api: mockReviewThreadsResponse,
    });
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

function respondToMockGitHubCommand(commandArgs, responses) {
  const command = commandArgs[0] === 'api' ? 'api' : commandArgs.slice(0, 2).join(' ');
  const response = responses[command];
  if (response) return JSON.stringify(response);
  throw new Error(`Unexpected mock GitHub command: ${commandArgs.join(' ')}`);
}

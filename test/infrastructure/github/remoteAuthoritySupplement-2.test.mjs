import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

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
  const adapterDependencies =
    createSnapshotAdapterDependenciesWithMockGitHubCommand(mockIssueResponse);

  const snapshot = adapterDependencies.remote.snapshot(issueNumber);

  assert.deepEqual(snapshot.inlineThreads, []);
});

test('remote snapshot preserves a legacy marker comment', () => {
  const issueNumber = 81;
  const mockIssueResponse = { comments: [{ body: 'sloop/v1/marker' }] };
  const adapterDependencies =
    createSnapshotAdapterDependenciesWithMockGitHubCommand(mockIssueResponse);

  const snapshot = adapterDependencies.remote.snapshot(issueNumber);

  const expectedComments = [{ body: 'sloop/v1/marker' }];

  assert.deepEqual(snapshot.comments, expectedComments);
});

test('remote snapshot uses pull-request metadata when a manifest marker is present', () => {
  const issueNumber = 81;
  const runManifest = createTestRunManifest({ artifacts: [] });
  const manifestMarker = runManifestMarker(runManifest);
  const mockIssueResponse = { comments: [{ body: manifestMarker }] };
  const adapterDependencies =
    createSnapshotAdapterDependenciesWithMockGitHubCommand(mockIssueResponse);

  const snapshot = adapterDependencies.remote.snapshot(issueNumber);
  const hasUnregisteredArtifact = adapterDependencies.remote.reconcile(issueNumber, 'missing');

  assert.equal(snapshot.pr, 9);
  assert.equal(snapshot.branch, 'codex/issue-81-x');
  assert.equal(hasUnregisteredArtifact, false);
});

import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';
import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';
import { ExternalServiceError } from '../../../src/core/ExternalServiceError.js';
import { runManifestMarker } from '../../../src/remote-state.js';

test('production adapters read, claim, and publish remote run state', () => {
  const scenario = createRemotePublicationScenario();
  const snapshot = scenario.dependencies.remote.snapshot(81);

  assert.deepEqual(snapshot.labels, ['eligible']);
  assert.deepEqual(snapshot.inlineThreads, [{ resolved: true }]);
  assert.match(snapshot.markers.join(' '), /sloop\/v1\/run\/old/);
  assert.equal(scenario.dependencies.remote.reconcile(81, 'missing'), false);
  scenario.dependencies.remote.claim(81, 'new', 'lease-token');
  scenario.dependencies.remote.claim(81, 'new', {
    ...scenario.manifest,
    lease: { owner: 'owner', expiresAt: 10 },
  });
  scenario.dependencies.remote.publish(81, { ...scenario.manifest, artifacts: [] });
  assert.ok(scenario.calls.some((args) => args[0] === 'api'));
});

test('production adapters report GitHub failures and reconcile local config', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-failures-'));
  const config = loadConfigText(canonicalConfigYaml());
  const failing = createOfflineDependencies(root, config);

  assert.throws(
    () => failing.list(),
    (error) => error instanceof ExternalServiceError && error.service === 'github',
  );
  assert.throws(() => failing.eligible(), /offline/);
  assert.throws(() => failing.remote.reconcile(81, 'x'), /GitHub reconciliation unavailable/);
  assert.throws(() => failing.remote.claim(81, 'x', 'y'), /offline/);
  assert.throws(() => failing.remote.publish(81, createRemoteManifest()), /offline/);
  assert.throws(() => failing.pullRequest(9), /offline/);
  assert.throws(() => failing.pullRequestBody(9), /offline/);
  assert.throws(() => failing.comment(81, 'x'), /offline/);
  assert.throws(() => failing.prComment(9, 'x'), /offline/);
  assert.throws(() => failing.updatePullRequestBody(9, 'x'), /offline/);
  assert.throws(() => failing.remote.snapshot(81), /GitHub snapshot unavailable/);

  await assert.doesNotReject(() => productionConfigReconciler(root)(root, 'none'));
  writeFileSync(join(root, 'sloop.config.yaml'), canonicalConfigYaml());
  let hasSynchronizedSkills = false;
  await productionConfigReconciler(root, () => {
    hasSynchronizedSkills = true;
  })(root, 'github');
  assert.equal(hasSynchronizedSkills, true);
  await assert.rejects(
    () =>
      productionConfigReconciler(root, () => {
        throw new Error('sync failed');
      })(root, 'skills'),
    /skills synchronization failed: sync failed/,
  );
});

function createRemotePublicationScenario() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-remote-'));
  const config = loadConfigText(canonicalConfigYaml());
  const calls = [];
  const manifest = createRemoteManifest();
  const marker = runManifestMarker(manifest);
  const dependencies = productionDependencies(root, config, 'owner/repo', {
    execFileSync: (_file, args) => respondToRemoteCommand(args, calls, marker),
  });

  return { dependencies, calls, manifest };
}

function respondToRemoteCommand(args, calls, marker) {
  calls.push(args);
  if (args[0] === 'issue')
    return JSON.stringify({
      labels: [{ name: 'eligible' }],
      comments: [{ body: `sloop/v1/run/old\\n${marker}` }],
    });
  if (args[0] === 'pr' && args[1] === 'view') {
    return JSON.stringify({
      number: 9,
      headRefName: 'codex/issue-81',
      headRefOid: 'abcdef1',
      comments: [{ body: 'sloop-v1/review/1' }],
      reviews: [{ state: 'APPROVED' }],
      statusCheckRollup: [{ name: 'checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    });
  }
  return JSON.stringify({
    data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: true }] } } } },
  });
}

function createOfflineDependencies(root, config) {
  return productionDependencies(root, config, 'owner/repo', {
    execFileSync: () => {
      throw new Error('offline');
    },
  });
}

function createRemoteManifest() {
  return {
    protocol: 1,
    runId: 'run',
    issue: 81,
    pr: 9,
    branch: 'codex/issue-81',
    baseSha: 'abcdef1',
    configFingerprint: 'cfg',
    phase: 'working',
    reviewRound: 1,
    contextCursor: '',
    artifacts: ['old'],
  };
}

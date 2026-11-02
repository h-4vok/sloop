import assert from 'node:assert/strict';
import { test } from 'vitest';
import { artifactKey, projectRemoteState } from '../../src/remote-state.js';

test('remote projection is deterministic and ignores unrelated markers', () => {
  const remoteState = { issue: 33, markers: ['other/In Progress'], labels: ['In Progress'] };
  const reorderedLabels = { ...remoteState, labels: [...remoteState.labels].reverse() };

  assert.deepEqual(projectRemoteState(remoteState), projectRemoteState(reorderedLabels));
  assert.equal(projectRemoteState(remoteState).phase, 'idle');
  assert.equal(artifactKey('run', { b: 2, a: 1 }), artifactKey('run', { a: 1, b: 2 }));
});

test('projection identifies active lease ownership and review gates', () => {
  const manifest = createProjectionManifest({
    lease: { owner: 'a', expiresAt: new Date(Date.now() + 60_000).toISOString() },
  });
  const projected = projectRemoteState({
    issue: 33,
    markers: ['sloop/v1/run/r'],
    manifest,
    labels: ['Automation Blocked'],
    branch: 'wrong',
    sha: 'bad',
    leaseOwner: 'b',
  });

  assert.equal(projected.phase, 'review');
  assert.ok(projected.openGates.includes('lease:owned'));
});

test('projection rejects unsupported protocols and invalid issues', () => {
  assert.throws(() => projectRemoteState({ issue: 33, protocol: 99 }), /unsupported/);
  assert.throws(() => projectRemoteState({ issue: 0 }), /invalid issue/);
});

test('projection reports a complete manifest with no open gates', () => {
  const manifest = createProjectionManifest({ phase: 'complete' });
  const complete = projectRemoteState({
    issue: 33,
    comments: [{ marker: 'sloop/v1/run/r' }],
    manifest,
    checks: [{ name: 'pr-checks', conclusion: 'success' }],
    reviews: [{ state: 'APPROVED' }, { state: 'dismissed' }],
    inlineThreads: [{ resolved: true }],
    branch: 'b',
    sha: 'abcdef1',
  });

  assert.equal(complete.phase, 'complete');
  assert.deepEqual(complete.openGates, []);
});

function createProjectionManifest(overrides = {}) {
  return {
    protocol: 1,
    runId: 'r',
    issue: 33,
    branch: 'b',
    baseSha: 'abcdef1',
    configFingerprint: 'f',
    phase: 'working',
    reviewRound: 1,
    contextCursor: 'c',
    artifacts: [],
    ...overrides,
  };
}

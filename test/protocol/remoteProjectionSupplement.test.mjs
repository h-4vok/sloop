import assert from 'node:assert/strict';
import { test } from 'vitest';
import { REMOTE_PROTOCOL, projectRemoteState } from '../../src/remote-state.js';

test('remote state projects artifact keys and lease ownership', () => {
  const manifest = createSupplementManifest({
    lease: { owner: 'worker-a', expiresAt: new Date(2).toISOString() },
  });
  const projection = projectRemoteState({
    issue: 7,
    comments: [{ marker: 'sloop/v1/run/run' }, { marker: 'sloop/v1/artifact/a' }],
    manifest,
    checks: [{ name: 'green', status: 'COMPLETED', conclusion: 'success' }],
    reviews: [{ state: 'APPROVED' }, { state: 'DISMISSED' }],
    inlineThreads: [{ resolved: true }],
    labels: ['ordinary'],
    branch: manifest.branch,
    sha: manifest.baseSha,
    now: 1,
    leaseOwner: 'worker-b',
  });

  assert.equal(projection.phase, 'claimed');
  assert.deepEqual(projection.openGates, ['lease:owned']);
  assert.equal(projection.lease.active, true);
  assert.deepEqual(projection.artifactKeys, [
    'sloop/v1/artifact/a',
    'sloop/v1/artifact/z',
    'sloop/v1/run/run',
  ]);
});

test('remote state ignores an expired lease owned by the current worker', () => {
  const manifest = createSupplementManifest({
    lease: { owner: 'worker-a', expiresAt: new Date(1).toISOString() },
  });
  const projection = projectRemoteState({
    issue: 7,
    markers: ['sloop/v1/run/run'],
    manifest,
    now: 1,
    leaseOwner: 'worker-a',
  });
  const emptyProjection = projectRemoteState({ issue: 7, comments: [{}] });

  assert.deepEqual(projection.openGates, []);
  assert.deepEqual(emptyProjection.artifactKeys, []);
});

test('remote state recognizes future leases and rejects invalid protocol input', () => {
  const manifest = createSupplementManifest({
    lease: { owner: 'worker-a', expiresAt: '2099-01-01T00:00:00.000Z' },
  });
  const projection = projectRemoteState({
    issue: 7,
    markers: ['sloop/v1/run/run'],
    manifest,
  });

  assert.equal(projection.lease.active, true);
  assert.throws(() => projectRemoteState({ issue: 0 }), /invalid issue/);
  assert.throws(() => projectRemoteState({ issue: 7, protocol: 2 }), /unsupported remote protocol/);
});

function createSupplementManifest(overrides = {}) {
  return {
    protocol: REMOTE_PROTOCOL,
    runId: 'run',
    issue: 7,
    branch: 'codex/issue-7',
    baseSha: 'abcdef1',
    configFingerprint: 'cfg',
    phase: 'claimed',
    reviewRound: 1,
    contextCursor: 'c',
    artifacts: ['sloop/v1/artifact/z'],
    ...overrides,
  };
}

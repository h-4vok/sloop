import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  REMOTE_PROTOCOL,
  artifactKey,
  leaseIsActive,
  parseRunManifestMarker,
  projectRemoteState,
  runManifestMarker,
} from '../../src/remote-state.js';

test('remote projection is deterministic and ignores unrelated markers', () => {
  const s = { issue: 33, markers: ['other/In Progress'], labels: ['In Progress'] };

  assert.deepEqual(
    projectRemoteState(s),
    projectRemoteState({ ...s, labels: [...s.labels].reverse() }),
  );
  assert.equal(projectRemoteState(s).phase, 'idle');
  assert.equal(artifactKey('run', { b: 2, a: 1 }), artifactKey('run', { a: 1, b: 2 }));
});

test('projection handles leases, gates, unsupported protocols, and marker reconciliation', () => {
  const manifest = {
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

    lease: { owner: 'a', expiresAt: new Date(Date.now() + 60000).toISOString() },
  };
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
  assert.throws(() => projectRemoteState({ issue: 33, protocol: 99 }), /unsupported/);
  assert.throws(() => projectRemoteState({ issue: 0 }), /invalid issue/);
  const complete = projectRemoteState({
    issue: 33,

    comments: [{ marker: 'sloop/v1/run/r' }],

    manifest: { ...manifest, phase: 'complete' },

    checks: [{ name: 'pr-checks', conclusion: 'success' }],

    reviews: [{ state: 'APPROVED' }, { state: 'dismissed' }],

    inlineThreads: [{ resolved: true }],

    branch: 'b',

    sha: 'abcdef1',
  });
  assert.equal(complete.phase, 'complete');
  assert.deepEqual(complete.openGates, []);
});

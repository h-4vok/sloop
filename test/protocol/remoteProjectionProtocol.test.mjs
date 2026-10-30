import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  REMOTE_PROTOCOL,
  leaseIsActive,
  parseRunManifestMarker,
  projectRemoteState,
  runManifestMarker,
} from '../../src/remote-state.js';

test('remote protocol projects idle, complete, review, and lease edge states', () => {
  const manifest = {
    protocol: REMOTE_PROTOCOL,

    runId: 'run',

    issue: 7,

    branch: 'codex/issue-7',

    baseSha: 'abcdef1',

    configFingerprint: 'cfg',

    phase: 'working',

    reviewRound: 1,

    contextCursor: 'c',

    artifacts: ['key'],
  };
  const marker = runManifestMarker(manifest);

  assert.equal(parseRunManifestMarker(marker, 7).runId, 'run');
  assert.equal(parseRunManifestMarker('plain text', 7), undefined);
  assert.deepEqual(projectRemoteState({ issue: 7, markers: ['unrelated'] }).openGates, []);
  const review = projectRemoteState({
    issue: 7,

    markers: ['sloop/v1/run/run'],

    manifest,

    checks: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'failure', detailsUrl: 'url' }],

    reviews: [{ state: 'COMMENTED' }],

    inlineThreads: [{ resolved: false }],

    labels: ['Blocked'],

    branch: 'wrong',

    sha: 'wrong',
  });
  assert.equal(review.phase, 'review');
  assert.deepEqual(review.openGates, [
    'check:pr-checks',
    'review',
    'inline:1',
    'label:Blocked',
    'branch:mismatch',
    'sha:mismatch',
  ]);
  assert.equal(
    projectRemoteState({
      issue: 7,

      markers: ['sloop/v1/run/run'],

      manifest: { ...manifest, phase: 'complete' },

      branch: manifest.branch,

      sha: manifest.baseSha.slice(0, 7),
    }).phase,
    'complete',
  );
  assert.equal(leaseIsActive({ expiresAt: new Date(2).toISOString() }, 1), true);
  assert.equal(leaseIsActive({ expiresAt: new Date(1).toISOString() }, 1), false);
});

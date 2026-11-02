import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  REMOTE_PROTOCOL,
  artifactKey,
  leaseIsActive,
  parseRunManifestMarker,
  reconcileArtifact,
  runManifestMarker,
  validateRunManifest,
} from '../../src/remote-state.js';

test('remote manifest contracts reject malformed markers and validate boundaries', () => {
  const manifest = {
    protocol: 1,

    runId: 'run-1',

    issue: 33,

    branch: 'codex/issue-33',

    baseSha: 'abcdef1',

    configFingerprint: 'cfg',

    phase: 'working',

    reviewRound: 1,

    contextCursor: '',

    artifacts: [],
  };

  assert.deepEqual(parseRunManifestMarker(runManifestMarker(manifest), 33), manifest);
  assert.equal(parseRunManifestMarker('<!-- sloop/v1/manifest !!! -->', 33), undefined);
  assert.equal(parseRunManifestMarker(runManifestMarker(manifest), 34), undefined);
  assert.equal(validateRunManifest({ ...manifest, baseSha: 'short' }, 33), false);
  assert.equal(validateRunManifest({ ...manifest, reviewRound: 0 }, 33), false);
  assert.equal(validateRunManifest(undefined, 33), false);
  for (const broken of [
    { ...manifest, protocol: 2 },
    { ...manifest, runId: '' },
    { ...manifest, issue: 34 },
    { ...manifest, branch: '' },
    { ...manifest, configFingerprint: '' },
    { ...manifest, phase: 'unknown' },
    { ...manifest, contextCursor: 1 },
    { ...manifest, artifacts: {} },
  ])
    assert.equal(validateRunManifest(broken, 33), false);
  assert.equal(reconcileArtifact(['key/child'], 'key'), true);
  assert.equal(reconcileArtifact(['other'], 'key'), false);
  assert.equal(
    leaseIsActive({ expiresAt: '2026-01-02T00:00:00.000Z' }, Date.parse('2026-01-01')),
    true,
  );
  assert.equal(
    leaseIsActive({ expiresAt: '2026-01-01T00:00:00.000Z' }, Date.parse('2026-01-01')),
    false,
  );
  assert.throws(() => leaseIsActive({ expiresAt: 'not-a-date' }), /invalid lease/);
});

test('remote state validates durable records and canonical helper contracts', () => {
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

    artifacts: [],
  };

  assert.equal(validateRunManifest(manifest, 7), true);
  for (const invalid of [
    undefined,
    { ...manifest, protocol: 2 },
    { ...manifest, runId: '' },
    { ...manifest, issue: 8 },
    { ...manifest, branch: '' },
    { ...manifest, baseSha: 'not-a-sha' },
    { ...manifest, configFingerprint: '' },
    { ...manifest, phase: 'unknown' },
    { ...manifest, reviewRound: 0 },
    { ...manifest, contextCursor: 1 },
    { ...manifest, artifacts: {} },
  ])
    assert.equal(validateRunManifest(invalid, 7), false);
  assert.equal(
    artifactKey('comment', { issue: 7, body: 'x' }),
    artifactKey('comment', { body: 'x', issue: 7 }),
  );
  assert.equal(reconcileArtifact(['key'], 'key'), true);
  assert.equal(reconcileArtifact(['key/next'], 'key'), true);
  assert.equal(reconcileArtifact(['other'], 'key'), false);
  assert.throws(() => leaseIsActive({ expiresAt: 'invalid' }), /invalid lease expiry/);
  assert.equal(parseRunManifestMarker('<!-- sloop/v1/manifest aW52YWxpZA -->', 7), undefined);
  assert.equal(parseRunManifestMarker(runManifestMarker({ ...manifest, issue: 8 }), 7), undefined);
});

import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  artifactKey,
  decodeRunManifestMarker,
  leaseIsActiveResult,
  runManifestMarker,
} from '../src/remote-state/runManifestMarker.ts';

test('manifest marker preserves wire format and returns parse failures as Results', () => {
  // Arrange
  const manifest = {
    protocol: 1,
    runId: 'run-41',
    issue: 41,
    branch: 'worker/41',
    baseSha: 'abcdef1234567',
    configFingerprint: 'config-hash',
    phase: 'working',
    reviewRound: 1,
    contextCursor: 'cursor-1',
    artifacts: [],
  };
  const marker = runManifestMarker(manifest);

  // Act
  const decoded = decodeRunManifestMarker(marker, 41);
  const wrongIssue = decodeRunManifestMarker(marker, 42);
  const expiredLease = leaseIsActiveResult({ expiresAt: 'not-a-date' }, 0);
  const firstKey = artifactKey('review', { pr: 41, sha: 'abc' });
  const reorderedKey = artifactKey('review', { sha: 'abc', pr: 41 });

  // Assert
  assert.match(marker, /^<!-- sloop\/v1\/manifest [A-Za-z0-9_-]+ -->$/);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.runId, 'run-41');
  assert.equal(wrongIssue.ok, false);
  assert.equal(expiredLease.ok, false);
  assert.equal(firstKey, reorderedKey);
});

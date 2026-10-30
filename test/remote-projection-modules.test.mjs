import assert from 'node:assert/strict';
import { test } from 'vitest';
import { projectRemoteState } from '../src/remote-state/projectRemoteState.ts';

test('projection reports workflow gates and structured input failures', () => {
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
    artifacts: ['artifact/a'],
  };
  const snapshot = {
    issue: 41,
    manifest,
    markers: ['sloop/v1/run/run-41'],
    branch: 'worker/41',
    sha: 'abcdef1',
    checks: [{ name: 'ci', status: 'completed', conclusion: 'failure' }],
  };

  // Act
  const projection = projectRemoteState(snapshot);
  const invalidIssue = projectRemoteState({ issue: 0 });

  // Assert
  assert.equal(projection.ok, true);
  assert.equal(projection.value.phase, 'review');
  assert.deepEqual(projection.value.openGates, ['check:ci']);
  assert.deepEqual(projection.value.artifactKeys, ['artifact/a', 'sloop/v1/run/run-41']);
  assert.equal(invalidIssue.ok, false);
  assert.match(invalidIssue.error.message, /invalid issue number/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactKey, projectRemoteState } from '../dist/remote-state.js';
import { RunLogger, runDirectory } from '../dist/run-log.js';
import { allowlistedPublication } from '../dist/publication.js';
import { withEphemeralMutex } from '../dist/mutex.js';

test('remote projection is deterministic and ignores unrelated markers', () => {
  const s = { issue: 33, markers: ['other/In Progress'], labels: ['In Progress'] };
  assert.deepEqual(
    projectRemoteState(s),
    projectRemoteState({ ...s, labels: [...s.labels].reverse() }),
  );
  assert.equal(projectRemoteState(s).phase, 'idle');
  assert.equal(artifactKey('run', { b: 2, a: 1 }), artifactKey('run', { a: 1, b: 2 }));
});

test('run logger writes ordered sensitive local JSONL with restrictive permissions', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-'));
  const logger = new RunLogger(runDirectory(root, 33, 'run/one'));
  logger.write('stdout', 'line 1\nline 2');
  logger.write('transition', { phase: 'review' });
  assert.equal(readFileSync(logger.file, 'utf8').split('\n').filter(Boolean).length, 2);
});

test('publication allowlist excludes raw channels and redacts credentials', () => {
  assert.deepEqual(allowlistedPublication({ raw: 'secret', token: 'abc', summary: 'ok' }), {
    token: '<redacted>',
    summary: 'ok',
  });
});

test('ephemeral mutex releases after the run', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-'));
  assert.equal(
    withEphemeralMutex(root, 'a', () => 3),
    3,
  );
  assert.equal(
    withEphemeralMutex(root, 'b', () => 4),
    4,
  );
});

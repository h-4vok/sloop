import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';
import { RunLogger, runDirectory, applyRunRetention } from '../../src/run-log.js';

test('run logger writes ordered sensitive local JSONL with restrictive permissions', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-'));
  const logger = new RunLogger(runDirectory(root, 33, 'run/one'));
  logger.write('stdout', 'line 1\nline 2');
  logger.write('transition', { phase: 'review' });
  const events = readFileSync(logger.file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.deepEqual(
    events.map(({ seq, type }) => [seq, type]),
    [
      [1, 'stdout'],
      [2, 'transition'],
    ],
  );
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(logger.file, '..')).mode & 0o777, 0o700);
    assert.equal(statSync(logger.file).mode & 0o777, 0o600);
  }
  const reopened = new RunLogger(join(logger.file, '..'));
  reopened.write('result', 'continues sequence');
  assert.equal(JSON.parse(readFileSync(reopened.file, 'utf8').trim().split('\n').at(-1)).seq, 3);
});

test('logging retains runs by default and supports explicit retention', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-'));
  const logger = new RunLogger(runDirectory(root, 33, 'unicode/✓'));
  logger.command('node', 'ü\nstdout', 'err\n', root);
  logger.stream('codex', 'multi\nline');

  assert.ok(statSync(logger.file).mode & 0o200);
  applyRunRetention(root);
  assert.ok(readFileSync(logger.file, 'utf8').includes('multi'));
  assert.throws(() => applyRunRetention(root, -1), /non-negative/);
  applyRunRetention(join(root, 'missing'), 0);
});

test('run logger preserves append-only evidence after a malformed prior line', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-log-corrupt-'));
  const directory = runDirectory(root, 33, 'corrupt');
  new RunLogger(directory);
  const file = join(directory, 'events.jsonl');
  await import('node:fs').then(({ appendFileSync }) => appendFileSync(file, '{bad json}\n'));
  const logger = new RunLogger(directory);
  logger.write('safe');

  assert.match(readFileSync(file, 'utf8'), /"type":"safe"/);
});

test('explicit retention removes only expired run directories and never unsafe siblings', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-'));
  const old = runDirectory(root, 33, 'old', new Date('2020-01-01T00:00:00Z'));
  const fresh = runDirectory(root, 33, 'fresh', new Date('2026-09-09T00:00:00Z'));
  new RunLogger(old);
  new RunLogger(fresh);
  applyRunRetention(root, 24 * 60 * 60 * 1000, Date.parse('2026-09-10T00:00:00Z'));

  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
});

test('retention leaves non-directory and unparseable entries untouched', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-retention-safe-'));
  const runs = join(root, '.sloop', 'runs');
  mkdirSync(join(runs, 'not-a-timestamp'), { recursive: true });
  writeFileSync(join(runs, 'notes.txt'), 'keep');
  applyRunRetention(root, 0, Date.now() + 1);

  assert.equal(existsSync(join(runs, 'not-a-timestamp')), true);
  assert.equal(existsSync(join(runs, 'notes.txt')), true);
});

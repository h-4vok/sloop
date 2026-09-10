import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactKey, projectRemoteState } from '../dist/remote-state.js';
import { RunLogger, runDirectory, applyRunRetention } from '../dist/run-log.js';
import { allowlistedPublication } from '../dist/publication.js';
import { withEphemeralMutex } from '../dist/mutex.js';
import { command, runCommand } from '../dist/dispatcher.js';

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

test('real command execution captures Unicode and multiline stdout/stderr in arrival order', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-'));
  const logger = new RunLogger(runDirectory(root, 33, 'streams/✓'));
  const seen = [];
  const output = await runCommand(
    {
      ...command(
        {
          command: process.execPath,
          args: [
            '-e',
            "process.stdout.write('salut ✓\\nline two\\n'); process.stderr.write('ошибка\\nline err\\n')",
          ],
        },
        33,
      ),
      onStdout: (chunk) => {
        seen.push('stdout');
        logger.stream('stdout', chunk);
      },
      onStderr: (chunk) => {
        seen.push('stderr');
        logger.stream('stderr', chunk);
      },
    },
    root,
  );
  assert.match(output, /salut ✓/);
  const text = readFileSync(logger.file, 'utf8');
  assert.match(text, /ошибка/);
  assert.match(text, /line two/);
  assert.deepEqual(new Set(seen), new Set(['stdout', 'stderr']));
  const events = text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.seq),
    events.map((_, index) => index + 1),
  );
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
});

test('logging retains runs by default and supports explicit retention', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-'));
  const logger = new RunLogger(runDirectory(root, 33, 'unicode/✓'));
  logger.command('node', 'ü\nstdout', 'err\n', root);
  logger.stream('codex', 'multi\nline');
  assert.ok(statSync(logger.file).mode & 0o200);
  applyRunRetention(root);
  assert.ok(readFileSync(logger.file, 'utf8').includes('multi'));
});

test('explicit retention removes only expired run directories and never unsafe siblings', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-'));
  const old = runDirectory(root, 33, 'old', new Date('2020-01-01T00:00:00Z'));
  const fresh = runDirectory(root, 33, 'fresh', new Date('2026-09-09T00:00:00Z'));
  new RunLogger(old);
  new RunLogger(fresh);
  applyRunRetention(root, 24 * 60 * 60 * 1000, Date.parse('2026-09-10T00:00:00Z'));
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
});

test('publication boundary removes bearer, cookie, and URL credentials', () => {
  const value = allowlistedPublication(
    'Authorization: Bearer abc\nCookie: sid=xyz https://u:p@example.test/x',
  );
  assert.equal(String(value).includes('abc'), false);
  assert.equal(String(value).includes('xyz'), false);
  assert.equal(String(value).includes('u:p@'), false);
});

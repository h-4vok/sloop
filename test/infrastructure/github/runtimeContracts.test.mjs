import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { test, vi } from 'vitest';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

import { createNodeHost } from '../../../src/infrastructure/host/createNodeHost.js';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

import { withEphemeralMutex, withEphemeralMutexAsync } from '../../../src/mutex.js';

import { RunLogger, applyRunRetention, runDirectory } from '../../../src/run-log.js';

import {
  RunLogger as infrastructureRunLogger,
  applyRunRetention as infrastructureApplyRunRetention,
  runDirectory as infrastructureRunDirectory,
} from '../../../src/infrastructure/logging/index.js';

const createTemporaryDirectory = (prefix) =>
  createIsolatedTemporaryDirectory(join(tmpdir(), prefix));

test('production harness rejects roles with an unsupported harness type', () => {
  const validatedConfig = loadConfigText(canonicalConfigYaml());
  const config = {
    ...validatedConfig,

    agents: {
      ...validatedConfig.agents,

      worker: { ...validatedConfig.agents.worker, harness: 'unsupported' },
    },
  };
  const adapterDependencies = productionDependencies(
    createTemporaryDirectory('sloop-invalid-harness-'),
    config,
    'owner/repository',
    { execFileSync: () => '{}' },
  );

  assert.throws(
    () => adapterDependencies.harness('worker', { timeoutMs: 1000 }, {}, { write: () => {} }),
    /unsupported harness for role worker/,
  );
});

test('local mutex removes its lease after sync and async results or failures', async () => {
  const dir = createTemporaryDirectory('sloop-infra-mutex-');

  assert.equal(
    withEphemeralMutex(dir, 'one', () => 'done'),
    'done',
  );
  assert.equal(existsSync(join(dir, '.sloop', 'mutex', 'active')), false);
  assert.throws(
    () =>
      withEphemeralMutex(dir, 'one', () => {
        throw new Error('work failed');
      }),
    /work failed/,
  );
  assert.equal(await withEphemeralMutexAsync(dir, 'two', async () => 2), 2);
  await assert.rejects(
    () =>
      withEphemeralMutexAsync(dir, 'two', async () => {
        throw new Error('async failed');
      }),
    /async failed/,
  );
  mkdirSync(join(dir, '.sloop', 'mutex', 'active'), { recursive: true });
  assert.throws(() => withEphemeralMutex(dir, 'three', () => undefined), /another sloop process/);
  await assert.rejects(
    () => withEphemeralMutexAsync(dir, 'three', async () => undefined),
    /another sloop process/,
  );
  assert.throws(() => withEphemeralMutex('\0', 'invalid', () => undefined));
  await assert.rejects(() => withEphemeralMutexAsync('\0', 'invalid', async () => undefined));
});

test('run directory names include timestamp, issue, and normalized run ID', () => {
  const dir = createTemporaryDirectory('sloop-infra-log-');

  assert.match(
    runDirectory(dir, 7, 'run/id', new Date('2026-01-02T03:04:05.678Z')),
    /20260102T030405Z-issue-7-run_id$/,
  );
});

test('run retention preserves recent entries and removes old entries', () => {
  const dir = createTemporaryDirectory('sloop-infra-retention-');
  const logs = join(dir, '.sloop', 'runs', '20200101T000000Z-issue-1-old');
  mkdirSync(logs, { recursive: true });
  const current = join(dir, '.sloop', 'runs', '20260101T000000Z-issue-2-current');
  mkdirSync(current, { recursive: true });
  mkdirSync(join(dir, '.sloop', 'runs', 'not-a-run'), { recursive: true });
  applyRunRetention(dir);
  assert.equal(existsSync(logs), true);
  assert.throws(() => applyRunRetention(dir, -1), /non-negative/);
  applyRunRetention(dir, 0, Date.parse('2026-01-01T00:00:01Z'));
  assert.equal(existsSync(logs), false);
  assert.equal(existsSync(current), false);
  applyRunRetention(createTemporaryDirectory('sloop-infra-no-runs-'), 0);
});

test('run logger restores sequence after a corrupt tail and records event payloads', () => {
  const dir = createTemporaryDirectory('sloop-infra-event-log-');
  const eventRunDirectory = join(dir, 'event-run');
  mkdirSync(eventRunDirectory, { recursive: true });
  writeFileSync(join(eventRunDirectory, 'events.jsonl'), '{"seq":4}\nnot-json\n');
  const logger = new RunLogger(eventRunDirectory);
  logger.write('plain');
  logger.command('git status', 'out', 'err', dir);
  logger.stream('stdout', 'chunk');
  const events = readFileSync(join(eventRunDirectory, 'events.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/);
  assert.equal(JSON.parse(events.at(-3)).seq, 1);
  assert.deepEqual(JSON.parse(events.at(-2)).data, {
    command: 'git status',

    stdout: 'out',

    stderr: 'err',

    cwd: dir,
  });
  assert.equal(JSON.parse(events.at(-1)).data, 'chunk');

  const restoredRunDirectory = join(dir, 'restored-run');
  mkdirSync(restoredRunDirectory, { recursive: true });
  writeFileSync(join(restoredRunDirectory, 'events.jsonl'), '{"seq":4}\n');
  const next = new RunLogger(restoredRunDirectory);
  next.write('next', { value: true });
  assert.equal(JSON.parse(readFileSync(next.file, 'utf8').trim().split(/\r?\n/).at(-1)).seq, 5);
});

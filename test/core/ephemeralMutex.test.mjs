import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ephemeralMutex } from '../../src/mutex.js';

test('ephemeral mutex releases after the run', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-'));

  assert.equal(
    ephemeralMutex.run(root, 'a', () => 3),
    3,
  );
  assert.equal(
    ephemeralMutex.run(root, 'b', () => 4),
    4,
  );
});

test('ephemeral mutex rejects contention and always releases after failure', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-mutex-contract-'));

  assert.throws(
    () =>
      ephemeralMutex.run(root, 'first', () => {
        assert.equal(
          readFileSync(join(root, '.sloop', 'mutex', 'active', 'owner'), 'utf8'),
          'first',
        );
        assert.throws(
          () => ephemeralMutex.run(root, 'second', () => 'unreachable'),
          /another sloop/,
        );
        throw new Error('callback failure');
      }),
    /callback failure/,
  );
  assert.equal(existsSync(join(root, '.sloop', 'mutex', 'active')), false);
});

test('async ephemeral mutex preserves the lease until resolution and cleanup', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-async-mutex-contract-'));
  const result = await ephemeralMutex.runAsync(root, 'async-owner', async () => {
    assert.equal(
      readFileSync(join(root, '.sloop', 'mutex', 'active', 'owner'), 'utf8'),
      'async-owner',
    );
    return 42;
  });

  assert.equal(result, 42);
  assert.equal(existsSync(join(root, '.sloop', 'mutex', 'active')), false);
});

test('mutex surfaces filesystem failures that are not normal contention', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-mutex-filesystem-'));
  const impossibleRoot = join(root, 'file');
  writeFileSync(impossibleRoot, 'not a directory');

  assert.throws(() => ephemeralMutex.run(impossibleRoot, 'owner', () => {}));
  await assert.rejects(() => ephemeralMutex.runAsync(impossibleRoot, 'owner', async () => {}));
});

test('reset removes a stale repository mutex and its contents', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-stale-mutex-'));
  const activeDirectory = join(root, '.sloop', 'mutex', 'active');
  mkdirSync(activeDirectory, { recursive: true });
  writeFileSync(join(activeDirectory, 'owner'), '7004:168');

  const resetResult = ephemeralMutex.reset(root, () => false);

  assert.deepEqual(resetResult, { ok: true, value: 'Repository mutex reset.' });
  assert.equal(existsSync(join(root, '.sloop', 'mutex')), false);
});

test('reset preserves a repository mutex owned by a live process', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-live-mutex-'));
  const activeDirectory = join(root, '.sloop', 'mutex', 'active');
  mkdirSync(activeDirectory, { recursive: true });
  writeFileSync(join(activeDirectory, 'owner'), '7004:168');

  const resetResult = ephemeralMutex.reset(root, (pid) => pid === 7004);

  assert.deepEqual(resetResult, {
    ok: false,
    error: 'Cannot reset the repository mutex while Sloop process 7004 is active.',
  });
  assert.equal(existsSync(join(activeDirectory, 'owner')), true);
});

test('reset succeeds when no repository mutex exists', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-no-mutex-'));

  const resetResult = ephemeralMutex.reset(root, () => false);

  assert.deepEqual(resetResult, { ok: true, value: 'No repository mutex found.' });
});

test('reset removes the mutex directory when there is no active lease', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-inactive-mutex-'));
  const mutexDirectory = join(root, '.sloop', 'mutex');
  mkdirSync(mutexDirectory, { recursive: true });

  const resetResult = ephemeralMutex.reset(root, () => false);

  assert.deepEqual(resetResult, { ok: true, value: 'Repository mutex reset.' });
  assert.equal(existsSync(mutexDirectory), false);
});

test.each([
  [undefined, 'unknown'],
  ['not-a-pid:168', 'invalid'],
  ['1e3:168', 'invalid'],
  ['0x10:168', 'invalid'],
  ['7004:168:extra', 'invalid'],
  ['9007199254740992:168', 'invalid'],
  ['7004:not-an-issue', 'invalid'],
])('reset preserves a mutex with an %s owner record', (owner, ownerStatus) => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-unverified-mutex-'));
  const activeDirectory = join(root, '.sloop', 'mutex', 'active');
  mkdirSync(activeDirectory, { recursive: true });
  if (owner) writeFileSync(join(activeDirectory, 'owner'), owner);

  const resetResult = ephemeralMutex.reset(root, () => false);

  assert.deepEqual(resetResult, {
    ok: false,
    error: `Cannot reset the repository mutex because its owner is ${ownerStatus}.`,
  });
  assert.equal(existsSync(activeDirectory), true);
});

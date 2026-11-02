import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { withEphemeralMutex, withEphemeralMutexAsync } from '../../src/mutex.js';

test('ephemeral mutex releases after the run', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-'));

  assert.equal(
    withEphemeralMutex(root, 'a', () => 3),
    3,
  );
  assert.equal(
    withEphemeralMutex(root, 'b', () => 4),
    4,
  );
});

test('ephemeral mutex rejects contention and always releases after failure', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-mutex-contract-'));

  assert.throws(
    () =>
      withEphemeralMutex(root, 'first', () => {
        assert.equal(
          readFileSync(join(root, '.sloop', 'mutex', 'active', 'owner'), 'utf8'),
          'first',
        );
        assert.throws(
          () => withEphemeralMutex(root, 'second', () => 'unreachable'),
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
  const result = await withEphemeralMutexAsync(root, 'async-owner', async () => {
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

  assert.throws(() => withEphemeralMutex(impossibleRoot, 'owner', () => {}));
  await assert.rejects(() => withEphemeralMutexAsync(impossibleRoot, 'owner', async () => {}));
});

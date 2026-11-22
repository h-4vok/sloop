import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { test, vi } from 'vitest';
import { ephemeralMutex } from '../../src/mutex.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),

  readFileSync: vi.fn(),

  rmSync: vi.fn(),
}));

test('reset preserves the mutex when reading the owner throws', () => {
  const readError = new Error('cannot read owner');
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockImplementationOnce(() => {
    throw readError;
  });

  const resetMutex = () => ephemeralMutex.reset('repository-root', () => false);

  assert.throws(resetMutex, (error) => error === readError);
  assert.equal(vi.mocked(rmSync).mock.calls.length, 0);
});

test('reset surfaces a removal failure after finding a stale owner', () => {
  const removalError = new Error('cannot remove mutex directory');
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValueOnce('7004:168');
  vi.mocked(rmSync).mockImplementationOnce(() => {
    throw removalError;
  });

  const resetMutex = () => ephemeralMutex.reset('repository-root', () => false);

  assert.throws(resetMutex, (error) => error === removalError);
});

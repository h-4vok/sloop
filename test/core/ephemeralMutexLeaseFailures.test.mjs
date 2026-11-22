import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, test, vi } from 'vitest';
import { ephemeralMutex } from '../../src/mutex.js';

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),

  rmSync: vi.fn(),

  writeFileSync: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

const root = 'repository-root';
const activeDirectory = join(root, '.sloop', 'mutex', 'active');

test('removes the partial lease and rethrows the owner write error', () => {
  const writeError = Object.assign(new Error('cannot write owner'), { code: 'EEXIST' });
  vi.mocked(writeFileSync).mockImplementationOnce(() => {
    throw writeError;
  });

  const acquireMutex = () => ephemeralMutex.run(root, '7004:216', () => {});

  assert.throws(acquireMutex, (error) => error === writeError);
  assert.deepEqual(vi.mocked(rmSync).mock.calls, [
    [activeDirectory, { recursive: true, force: true }],
  ]);
});

test('preserves the existing lease when active directory creation fails with EEXIST', () => {
  const contentionError = Object.assign(new Error('directory exists'), { code: 'EEXIST' });
  vi.mocked(mkdirSync).mockImplementationOnce(() => undefined);
  vi.mocked(mkdirSync).mockImplementationOnce(() => {
    throw contentionError;
  });

  const acquireMutex = () => ephemeralMutex.run(root, '7004:216', () => {});

  assert.throws(acquireMutex, /another sloop process holds the local mutex/);
  assert.equal(vi.mocked(writeFileSync).mock.calls.length, 0);
  assert.equal(vi.mocked(rmSync).mock.calls.length, 0);
});

test('keeps the owner write error when removal of the partial lease also fails', () => {
  const writeError = new Error('cannot write owner');
  const cleanupError = new Error('cannot remove lease');
  vi.mocked(writeFileSync).mockImplementationOnce(() => {
    throw writeError;
  });
  vi.mocked(rmSync).mockImplementationOnce(() => {
    throw cleanupError;
  });

  const acquireMutex = () => ephemeralMutex.run(root, '7004:216', () => {});

  assert.throws(acquireMutex, (error) => error === writeError);
  assert.equal(vi.mocked(rmSync).mock.calls.length, 1);
});

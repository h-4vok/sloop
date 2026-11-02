import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import assert from 'node:assert/strict';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { test, vi } from 'vitest';

import { createProductionRuntimeIo } from '../../../src/infrastructure/host/createProductionRuntimeIo.js';

const createTemporaryDirectory = (prefix) =>
  createIsolatedTemporaryDirectory(join(tmpdir(), prefix));

test('production runtime I/O exposes file, stream, and command boundaries', () => {
  const directory = createTemporaryDirectory('sloop-runtime-io-');
  const readableFile = join(directory, 'readable.txt');
  writeFileSync(readableFile, 'runtime fixture');
  const runtimeIo = createProductionRuntimeIo();
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  try {
    assert.equal(runtimeIo.canRead(readableFile), true);
    assert.equal(runtimeIo.canRead(join(directory, 'missing.txt')), false);
    assert.equal(runtimeIo.readFile(readableFile), 'runtime fixture');
    runtimeIo.stdout('stdout fixture');
    runtimeIo.stderr('stderr fixture');
    assert.deepEqual(
      runtimeIo.run(process.execPath, ['-e', 'process.stdout.write("runtime-ok")']),
      {
        stdout: 'runtime-ok',

        stderr: '',

        status: 0,
      },
    );
    assert.deepEqual(
      runtimeIo.run(process.execPath, [
        '-e',
        'process.stderr.write("runtime-failure"); process.exit(7)',
      ]),
      { stdout: '', stderr: 'runtime-failure', status: 7 },
    );
    assert.equal(stdoutWrite.mock.calls[0][0], 'stdout fixture\n');
    assert.equal(stderrWrite.mock.calls[0][0], 'stderr fixture\n');
  } finally {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  }
});

import { accessSync, constants, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { stdin, stdout, stderr } from 'node:process';
import { processAdapter } from '../process/index.js';
import type { RuntimeIo } from '../../application/cli/RuntimeIo.js';

/** Creates the production CLI host used by direct runtime API calls. */
export function createProductionRuntimeIo(): RuntimeIo {
  const runtimeIo: RuntimeIo = {
    cwd: process.cwd(),
    platform: process.platform,
    nodeVersion: process.version,
    homeDirectory: homedir(),
    run(file, args, cwd) {
      try {
        return {
          stdout: processAdapter.runSyncCommand(
            processAdapter.resolveExecutable(file),
            [...args],
            undefined,
            process.platform,
            process.env.ComSpec,
            cwd ?? process.cwd(),
          ),
          stderr: '',
          status: 0,
        };
      } catch (error) {
        const failure = error as {
          stdout?: string | Buffer;
          stderr?: string | Buffer;
          status?: number;
        };

        return {
          stdout: String(failure.stdout ?? ''),
          stderr: String(failure.stderr ?? ''),
          status: failure.status ?? 1,
        };
      }
    },
    readFile: (file) => readFileSync(file, 'utf8'),
    canRead(file) {
      try {
        accessSync(file, constants.R_OK);
        return true;
      } catch {
        return false;
      }
    },
    stdout: (text) => stdout.write(`${text}\n`),
    stderr: (text) => stderr.write(`${text}\n`),
  };

  return runtimeIo;
}

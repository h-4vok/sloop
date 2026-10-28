import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { stdin, stdout } from 'node:process';
import { childProcessInvocation, resolveExecutable } from '../../process.js';
import type { NodeHost } from './NodeHost.js';

// Adapts Node.js process, stream, filesystem, and child-process APIs to NodeHost.
export function createNodeHost(): NodeHost {
  const nodeHost: NodeHost = {
    cwd: process.cwd(),

    platform: process.platform,

    nodeVersion: process.version,

    homeDirectory: homedir(),

    stdin,

    stdout,

    run(file, args, cwd) {
      const executable = resolveExecutable(file);
      const invocation = childProcessInvocation(executable, [...args]);
      const result = spawnSync(invocation.command, invocation.args, {
        cwd: cwd ?? process.cwd(),

        encoding: 'utf8',

        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      });
      const commandOutput = {
        stdout: result.stdout ?? '',

        stderr: result.stderr ?? '',

        status: result.status ?? 1,
      };

      return commandOutput;
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
  };

  return nodeHost;
}

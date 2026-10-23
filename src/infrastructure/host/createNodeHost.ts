import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import type { NodeHost } from './NodeHost.js';

// Adapts Node.js process, stream, filesystem, and child-process APIs to NodeHost.
export function createNodeHost(): NodeHost {
  const nodeHost: NodeHost = {
    cwd: process.cwd(),
    platform: process.platform,
    nodeVersion: process.version,
    stdin,
    stdout,
    run(file, args, cwd) {
      const result = spawnSync(file, [...args], {
        cwd: cwd ?? process.cwd(),
        encoding: 'utf8',
      });
      const commandOutput = {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        status: result.status ?? 1,
      };

      return commandOutput;
    },
    readFile: (file) => readFileSync(file, 'utf8'),
  };

  return nodeHost;
}

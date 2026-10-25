import type { Readable, Writable } from 'node:stream';

// Describes the Node.js process and filesystem operations exposed to the application.
export type NodeHost = Readonly<{
  cwd: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  homeDirectory: string;
  stdin: Readable & { isTTY?: boolean };
  stdout: Writable & { isTTY?: boolean };
  run: (
    file: string,
    args: readonly string[],
    cwd?: string,
  ) => {
    stdout: string;
    stderr: string;
    status: number;
  };
  readFile: (file: string) => string;
  canRead: (file: string) => boolean;
}>;

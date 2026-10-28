/** Host operations consumed by CLI command execution and preflight checks. */
export type RuntimeIo = Readonly<{
  cwd: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  homeDirectory: string;
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
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}>;

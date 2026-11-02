import { execFileSync } from 'node:child_process';
import { extname, isAbsolute } from 'node:path';

type ExecutableLocator = (commandName: string) => readonly string[];

/** Immutable command invocation returned to infrastructure callers. */
type ProcessInvocation = Readonly<{
  command: string;
  args: readonly string[];
  windowsVerbatimArguments?: boolean;
}>;

const locateExecutable: ExecutableLocator = (commandName) =>
  execFileSync('where.exe', [commandName], {
    encoding: 'utf8',

    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

/** Resolve Windows npm shims before launching without Node shell mode. */
function resolveExecutable(
  commandName: string,
  platform = process.platform,
  locate: ExecutableLocator = locateExecutable,
): string {
  if (platform !== 'win32') return commandName;
  if (isAlreadyResolvedExecutable(commandName)) return commandName;
  try {
    return selectWindowsExecutable(locate(commandName), commandName);
  } catch {
    return commandName;
  }
}

function isAlreadyResolvedExecutable(commandName: string): boolean {
  return isAbsolute(commandName) || Boolean(extname(commandName));
}

function selectWindowsExecutable(paths: readonly string[], commandName: string): string {
  return (
    paths.find((path) => /\.cmd$/i.test(path)) ??
    paths.find((path) => /\.exe$/i.test(path)) ??
    paths[0] ??
    commandName
  );
}

function childProcessInvocation(
  executable: string,
  args: readonly string[],
  platform = process.platform,
  commandProcessor = process.env.ComSpec,
): ProcessInvocation {
  if (!isWindowsBatchCommand(executable, platform)) return { command: executable, args: [...args] };
  assertSafeBatchCommand(executable, args);
  return windowsBatchInvocation(executable, args, commandProcessor);
}

function isWindowsBatchCommand(executable: string, platform: string): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
}

function assertSafeBatchCommand(executable: string, args: readonly string[]): void {
  // cmd.exe must parse batch files, so reject syntax that can alter the command.
  const unsafe = /["%&|<>()^!\r\n]/;
  if (unsafe.test(executable) || args.some((argument) => unsafe.test(argument)))
    throw new Error('Windows batch command contains unsafe cmd.exe syntax');
}

function windowsBatchInvocation(
  executable: string,
  args: readonly string[],
  commandProcessor: string | undefined,
): ProcessInvocation {
  return {
    command: commandProcessor || 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/v:off',
      '/c',
      `""${executable}" ${args.map((arg) => `"${arg}"`).join(' ')}"`,
    ],
    windowsVerbatimArguments: true,
  };
}

type SyncCommandExecutor = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    encoding: 'utf8';
    stdio: ['ignore', 'pipe', 'pipe'];
    windowsVerbatimArguments?: boolean;
  },
) => string;

function runSyncCommand(
  executable: string,
  args: readonly string[],
  execute: SyncCommandExecutor = (command, commandArgs, options) =>
    execFileSync(command, [...commandArgs], options) as string,
  platform = process.platform,
  commandProcessor = process.env.ComSpec,
  cwd = process.cwd(),
): string {
  const launch = childProcessInvocation(executable, args, platform, commandProcessor);
  return execute(launch.command, launch.args, {
    cwd,

    encoding: 'utf8',

    stdio: ['ignore', 'pipe', 'pipe'],

    windowsVerbatimArguments: launch.windowsVerbatimArguments,
  }).trim();
}

/** Process launching helpers for direct executables and Windows command shims. */
export const processAdapter = Object.freeze({
  resolveExecutable,

  childProcessInvocation,

  runSyncCommand,
});

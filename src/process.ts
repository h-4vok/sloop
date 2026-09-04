import { execFileSync } from 'node:child_process';
import { extname, isAbsolute } from 'node:path';

type ExecutableLocator = (commandName: string) => readonly string[];

const locateExecutable: ExecutableLocator = (commandName) =>
  execFileSync('where.exe', [commandName], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

/** Resolve Windows npm shims before launching without Node shell mode. */
export function resolveExecutable(
  commandName: string,
  platform = process.platform,
  locate: ExecutableLocator = locateExecutable,
): string {
  if (platform !== 'win32' || isAbsolute(commandName) || extname(commandName)) return commandName;
  try {
    const paths = locate(commandName);
    return (
      paths.find((path) => /\.cmd$/i.test(path)) ??
      paths.find((path) => /\.exe$/i.test(path)) ??
      paths[0] ??
      commandName
    );
  } catch {
    return commandName;
  }
}

export function childProcessInvocation(
  executable: string,
  args: string[],
  platform = process.platform,
  commandProcessor = process.env.ComSpec,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    // cmd.exe must parse batch files, so never pass arbitrary argv entries to
    // its command parser. The dispatcher only needs fixed CLI flags for batch
    // shims; reject syntax that could change the command before spawning it.
    const unsafe = /["%&|<>()^!\r\n]/;
    if (unsafe.test(executable) || args.some((arg) => unsafe.test(arg)))
      throw new Error('Windows batch command contains unsafe cmd.exe syntax');
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
  return { command: executable, args };
}

type SyncCommandExecutor = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    encoding: 'utf8';
    stdio: ['ignore', 'pipe', 'pipe'];
    windowsVerbatimArguments?: boolean;
  },
) => string;

export function runSyncCommand(
  executable: string,
  args: string[],
  execute: SyncCommandExecutor = (command, commandArgs, options) =>
    execFileSync(command, commandArgs, options) as string,
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

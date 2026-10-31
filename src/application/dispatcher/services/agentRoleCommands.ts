import type { Command, Spec, Config } from '../../../application/dispatcher/types/index.js';

function command(
  value: Command | undefined,
  _issue: number,
  _appendIssue = false,
): Spec | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return createLegacyCommandSpec(value);

  return createStructuredCommandSpec(value);
}

function createLegacyCommandSpec(commandArgs: string[]): Spec {
  return {
    command: commandArgs[0],

    args: commandArgs.slice(1),

    timeoutMs: 120000,

    retries: 0,

    logInvocation: undefined,
  };
}

function createStructuredCommandSpec(command: Exclude<Command, string[]>): Spec {
  validateStructuredCommand(command);

  return {
    command: command.command,

    args: command.args,

    timeoutMs: command.timeoutMs ?? 120000,

    retries: command.retries ?? 0,

    ...(command.sessions === true ? { sessions: true } : {}),

    logInvocation: undefined,
  };
}

function validateStructuredCommand(command: Exclude<Command, string[]>): void {
  if (hasUnsafeCommandName(command.command))
    throw new Error(
      'commands must be argv arrays or {command,args}; shell operators are not allowed',
    );

  if (!hasStringArguments(command.args))
    throw new Error(
      'commands must provide args as a string array; migrate each role command to { command, args, timeoutMs, retries }',
    );
}

function hasUnsafeCommandName(commandName: string): boolean {
  return !commandName || /&&|\||;/.test(commandName);
}

function hasStringArguments(commandArguments: unknown): boolean {
  return (
    Array.isArray(commandArguments) &&
    commandArguments.every((argument) => typeof argument === 'string')
  );
}

function roleCommand(value: Command | undefined, issue: number, cfg: Config): Spec | undefined {
  const spec = command(value, issue);
  if (!spec) return undefined;
  if (Array.isArray(value))
    throw new Error(
      'role commands must be { command, args, timeoutMs, retries }; migrate each role command from argv arrays',
    );
  validateCodexSandbox(spec);
  return { ...spec, logInvocation: cfg.logRoleInvocation !== false };
}

function validateCodexSandbox(spec: Spec): void {
  if (!isCodexExecCommand(spec)) return;

  const sandboxIndexes = spec.args.reduce<number[]>(
    (indexes, arg, index) => (arg === '--sandbox' ? [...indexes, index] : indexes),
    [],
  );
  if (!hasOneValidSandbox(spec.args, sandboxIndexes))
    throw new Error(
      `${spec.command} exec must include exactly one valid --sandbox in args; migrate each role command and remove legacy codexSandbox`,
    );
}

function isCodexExecCommand(spec: Spec): boolean {
  return /^(?:.*[\\/])?codex(?:\.cmd|\.exe)?$/i.test(spec.command) && spec.args[0] === 'exec';
}

function hasOneValidSandbox(args: readonly string[], sandboxIndexes: readonly number[]): boolean {
  const sandboxModes = ['read-only', 'workspace-write', 'danger-full-access'];
  const sandboxMode = args[sandboxIndexes[0] + 1] ?? '';

  return sandboxIndexes.length === 1 && sandboxModes.includes(sandboxMode);
}

/** Adapts and validates configured commands for dispatcher roles. */
export const agentRoleCommands = {
  command,

  roleCommand,
};

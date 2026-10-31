import { invalid, listParser, valid, type ParserResult } from './configValueParsers.js';
import {
  allowedExecutables,
  environmentAssignment,
  executableBasename,
  executableIndirectionOptions,
  gitConfigDispatchesShell,
  shellExecutable,
} from './agentArgvSecurity.js';

export function validateEnvironmentArgument(
  executable: string,
  argument: string,
  index: number,
  path: string,
): ParserResult<undefined> {
  if (executable !== 'env' || index === 0) return valid(undefined);
  if (isEnvironmentSplitStringOption(argument))
    return invalid(
      path,
      'env split-string options are forbidden; provide each argument as a separate argv item',
    );
  if (environmentAssignment(argument))
    return invalid(
      path,
      'environment assignments are forbidden; inherit values from the external environment',
    );
  return valid(undefined);
}

function isEnvironmentSplitStringOption(argument: string): boolean {
  return argument.startsWith('-S') || argument.startsWith('--split-string');
}

export function gitConfigForArgument(
  executable: string,
  argv: readonly string[],
  index: number,
): string | undefined {
  if (executable !== 'git' || index === 0) return undefined;
  const argument = argv[index]!;
  if (isSeparateGitConfigValue(index, argv[index - 1])) return argument;
  return inlineGitConfigValue(argument);
}

function isSeparateGitConfigValue(index: number, previousArgument: string | undefined): boolean {
  return index > 1 && (previousArgument === '-c' || previousArgument === '--config-env');
}

function inlineGitConfigValue(argument: string): string | undefined {
  if (argument.startsWith('-c')) return argument.slice(2);
  if (argument.startsWith('--config-env=')) return argument.slice('--config-env='.length);
  return undefined;
}

export function validateArgument(
  executable: string,
  argv: readonly string[],
  index: number,
  path: string,
): ParserResult<undefined> {
  const argument = argv[index]!;
  const syntaxResult = validateArgumentSyntax(executable, argument, index, path);
  if (!syntaxResult.ok) return syntaxResult;
  const environmentResult = validateEnvironmentArgument(executable, argument, index, path);
  if (!environmentResult.ok) return environmentResult;
  const gitConfig = gitConfigForArgument(executable, argv, index);
  if (gitConfig !== undefined && gitConfigDispatchesShell(gitConfig))
    return invalid(
      path,
      'Git configuration that dispatches a shell is forbidden; use non-executable configuration',
    );
  return valid(undefined);
}

function validateArgumentSyntax(
  executable: string,
  argument: string,
  index: number,
  path: string,
): ParserResult<undefined> {
  if (containsShellOperators(argument))
    return invalid(path, 'shell operators are forbidden; provide an argv array without a shell');
  if (shellExecutable(argument))
    return invalid(path, 'shell interpreters are forbidden; invoke the executable directly');
  if (isExecutableIndirection(executable, argument, index))
    return invalid(
      path,
      'executable indirection is forbidden by this direct-process command profile',
    );
  return valid(undefined);
}

function containsShellOperators(argument: string): boolean {
  const shellOperators = ['&&', '||', '|', ';', '<', '>', '`', '$('];
  return argument.includes('\0') || shellOperators.some((operator) => argument.includes(operator));
}

function isExecutableIndirection(executable: string, argument: string, index: number): boolean {
  if (index === 0) return false;
  return executableIndirectionOptions[executable]!.some((pattern) => pattern.test(argument));
}

export const argvParser = (value: unknown, path: string): ParserResult<readonly string[]> => {
  const parsedArguments = listParser(value, path);
  if (!parsedArguments.ok) return parsedArguments;
  const argv = parsedArguments.value;
  const executableResult = validateExecutable(argv, path);
  if (!executableResult.ok) return executableResult;
  const argumentResult = validateArguments(executableResult.value, argv, path);
  if (!argumentResult.ok) return argumentResult;
  return valid(argv);
};

function validateExecutable(argv: readonly string[], path: string): ParserResult<string> {
  if (argv.length === 0) return invalid(path, 'argv must contain an executable');
  const executable = executableBasename(argv[0]!);
  if (shellExecutable(argv[0]!))
    return invalid(
      `${path}[0]`,
      'shell interpreters are forbidden; invoke the executable directly',
    );
  if (!allowedExecutables.has(executable))
    return invalid(
      `${path}[0]`,
      `unsupported executable ${JSON.stringify(executable)}; allowed direct-process profiles: ${[
        ...allowedExecutables,
      ].join(', ')}`,
    );
  return valid(executable);
}

function validateArguments(
  executable: string,
  argv: readonly string[],
  path: string,
): ParserResult<undefined> {
  for (const [index] of argv.entries()) {
    const argumentResult = validateArgument(executable, argv, index, `${path}[${index}]`);
    if (!argumentResult.ok) return argumentResult;
  }
  return valid(undefined);
}

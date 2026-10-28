import type { Result } from './Result.js';
import { ConfigValidationError } from './types.js';

type ParserResult<T> = Result<T, ConfigValidationError>;

const invalid = (path: string, message: string): ParserResult<never> => ({
  ok: false,

  error: new ConfigValidationError([{ path, message }]),
});

const valid = <T>(value: T): ParserResult<T> => ({ ok: true, value });

const stringParser = (value: unknown, path: string): ParserResult<string> =>
  typeof value === 'string' && value.trim()
    ? valid(value)
    : invalid(path, 'expected a non-empty string');

const booleanParser = (value: unknown, path: string): ParserResult<boolean> =>
  typeof value === 'boolean' ? valid(value) : invalid(path, 'expected a boolean');

const integerParser = (value: unknown, path: string): ParserResult<number> =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? valid(value as number)
    : invalid(path, 'expected a non-negative integer');

const enumParser =
  <T extends string>(choices: readonly T[]) =>
  (value: unknown, path: string): ParserResult<T> =>
    typeof value === 'string' && choices.includes(value as T)
      ? valid(value as T)
      : invalid(path, `expected one of: ${choices.join(', ')}`);

const listParser = (value: unknown, path: string): ParserResult<readonly string[]> => {
  if (!Array.isArray(value)) return invalid(path, 'expected a list');
  const items: string[] = [];
  for (const [index, item] of value.entries()) {
    const parsedItem = stringParser(item, `${path}[${index}]`);
    if (!parsedItem.ok) return parsedItem;
    items.push(parsedItem.value);
  }
  return valid(items);
};

const durationParser = (value: unknown, path: string): ParserResult<number> => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return valid(value);
  if (typeof value !== 'string') return invalid(path, 'expected a duration such as 5m');
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) return invalid(path, 'expected a duration such as 5m');
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]!;
  const result = Number(match[1]) * multiplier;
  return Number.isSafeInteger(result) ? valid(result) : invalid(path, 'duration is too large');
};

const executableBasename = (argument: string): string =>
  argument
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)!
    .toLowerCase()
    .replace(/\.exe$/, '');

const shellExecutables = new Set([
  'ash',
  'bash',
  'bsh',
  'cmd',
  'csh',
  'dash',
  'elvish',
  'es',
  'fish',
  'hush',
  'ion',
  'ksh',
  'mksh',
  'nu',
  'osh',
  'powershell',
  'pdksh',
  'pwsh',
  'rc',
  'sh',
  'tcsh',
  'xonsh',
  'yash',
  'zsh',
]);

const shellExecutable = (argument: string): boolean => {
  const basename = executableBasename(argument);
  if (shellExecutables.has(basename)) return true;
  return [...shellExecutables].some(
    (shell) =>
      basename.startsWith(`${shell}-`) ||
      (basename.startsWith(shell) && /^\d/.test(basename.slice(shell.length))),
  );
};

const allowedExecutables = new Set(['codex', 'env', 'gh', 'git', 'npm']);
const executableIndirectionOptions: Readonly<Record<string, readonly RegExp[]>> = Object.freeze({
  codex: [],

  env: [],

  gh: [/^(?:alias|extension)$/i],

  git: [/^(?:alias|difftool|filter-branch|mergetool|shell)$/i, /^--exec(?:=|$)/i],

  npm: [/^(?:exec|x|explore)$/i],
});

const gitConfigDispatchesShell = (argument: string): boolean => {
  const separator = argument.indexOf('=');
  if (separator < 1) return false;
  const name = argument.slice(0, separator).toLowerCase();
  const configuredValue = argument.slice(separator + 1).trimStart();
  return (
    (name.startsWith('alias.') && configuredValue.startsWith('!')) ||
    /^(?:core\.(?:editor|gitproxy|pager|sshcommand)|sequence\.editor|gpg\.program|diff\.external|credential\.helper)$/.test(
      name,
    ) ||
    /^pager\..+$/.test(name) ||
    /^(?:difftool\.[^.]+\.cmd|filter\.[^.]+\.(?:clean|process|smudge))$/.test(name)
  );
};

const environmentAssignment = (argument: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*=/.test(argument);

function validateEnvironmentArgument(
  executable: string,
  argument: string,
  index: number,
  path: string,
): ParserResult<undefined> {
  if (executable !== 'env' || index === 0) return valid(undefined);
  if (argument.startsWith('-S') || argument.startsWith('--split-string'))
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

function gitConfigForArgument(
  executable: string,
  argv: readonly string[],
  index: number,
): string | undefined {
  if (executable !== 'git' || index === 0) return undefined;
  const argument = argv[index]!;
  const previousArgument = argv[index - 1];
  if (index > 1 && (previousArgument === '-c' || previousArgument === '--config-env'))
    return argument;
  if (argument.startsWith('-c')) return argument.slice(2);
  if (argument.startsWith('--config-env=')) return argument.slice('--config-env='.length);
  return undefined;
}

function validateArgument(
  executable: string,
  argv: readonly string[],
  index: number,
  path: string,
): ParserResult<undefined> {
  const argument = argv[index]!;
  if (argument.includes('\0') || /(?:&&|\|\||[|;<>`]|\$\()/.test(argument))
    return invalid(path, 'shell operators are forbidden; provide an argv array without a shell');
  if (shellExecutable(argument))
    return invalid(path, 'shell interpreters are forbidden; invoke the executable directly');
  if (
    index > 0 &&
    executableIndirectionOptions[executable]!.some((pattern) => pattern.test(argument))
  )
    return invalid(
      path,
      'executable indirection is forbidden by this direct-process command profile',
    );
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

const argvParser = (value: unknown, path: string): ParserResult<readonly string[]> => {
  const parsedArguments = listParser(value, path);
  if (!parsedArguments.ok) return parsedArguments;
  const argv = parsedArguments.value;
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
  for (const [index] of argv.entries()) {
    const argumentResult = validateArgument(executable, argv, index, `${path}[${index}]`);
    if (!argumentResult.ok) return argumentResult;
  }
  return valid(argv);
};

const pathParser = (value: unknown, path: string): ParserResult<string> => {
  const result = stringParser(value, path);
  if (!result.ok) return result;
  return result.value.includes('\0') ? invalid(path, 'path contains a NUL byte') : result;
};

const unrestrictedStringParser = (value: unknown, path: string): ParserResult<string> =>
  typeof value === 'string' ? valid(value) : invalid(path, 'expected a string');

export const configValueParsers = Object.freeze({
  stringParser,

  booleanParser,

  integerParser,

  enumParser,

  listParser,

  durationParser,

  argvParser,

  pathParser,

  unrestrictedStringParser,
});

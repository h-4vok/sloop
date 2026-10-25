import { ConfigValidationError } from './types.js';

const fail = (path: string, message: string): never => {
  throw new ConfigValidationError([{ path, message }]);
};
const stringParser = (value: unknown, path: string): string =>
  typeof value === 'string' && value.trim() ? value : fail(path, 'expected a non-empty string');
const booleanParser = (value: unknown, path: string): boolean =>
  typeof value === 'boolean' ? value : fail(path, 'expected a boolean');
const integerParser = (value: unknown, path: string): number =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : fail(path, 'expected a non-negative integer');
const enumParser =
  <T extends string>(choices: readonly T[]) =>
  (value: unknown, path: string): T =>
    typeof value === 'string' && choices.includes(value as T)
      ? (value as T)
      : fail(path, `expected one of: ${choices.join(', ')}`);
const listParser = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) return fail(path, 'expected a list');
  return value.map((item, index) => stringParser(item, `${path}[${index}]`));
};
const durationParser = (value: unknown, path: string): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return fail(path, 'expected a duration such as 5m');
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) return fail(path, 'expected a duration such as 5m');
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]!;
  const result = Number(match[1]) * multiplier;
  return Number.isSafeInteger(result) ? result : fail(path, 'duration is too large');
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
const argvParser = (value: unknown, path: string): readonly string[] => {
  const argv = listParser(value, path);
  if (argv.length === 0) fail(path, 'argv must contain an executable');
  const executable = executableBasename(argv[0]!);
  if (shellExecutable(argv[0]!))
    fail(`${path}[0]`, 'shell interpreters are forbidden; invoke the executable directly');
  if (!allowedExecutables.has(executable))
    fail(
      `${path}[0]`,
      `unsupported executable ${JSON.stringify(executable)}; allowed direct-process profiles: ${[
        ...allowedExecutables,
      ].join(', ')}`,
    );
  for (const [index, arg] of argv.entries()) {
    if (arg.includes('\0') || /&&|\|\||[|;<>`]|\$\(/.test(arg))
      fail(
        `${path}[${index}]`,
        'shell operators are forbidden; provide an argv array without a shell',
      );
    if (shellExecutable(arg))
      fail(`${path}[${index}]`, 'shell interpreters are forbidden; invoke the executable directly');
    if (index > 0 && executableIndirectionOptions[executable]!.some((pattern) => pattern.test(arg)))
      fail(
        `${path}[${index}]`,
        'executable indirection is forbidden by this direct-process command profile',
      );
    if (
      executable === 'env' &&
      index > 0 &&
      (arg.startsWith('-S') || arg.startsWith('--split-string'))
    )
      fail(
        `${path}[${index}]`,
        'env split-string options are forbidden; provide each argument as a separate argv item',
      );
    if (executable === 'env' && index > 0 && environmentAssignment(arg))
      fail(
        `${path}[${index}]`,
        'environment assignments are forbidden; inherit values from the external environment',
      );
    const gitConfig =
      executable === 'git' && index > 1 && argv[index - 1] === '-c'
        ? arg
        : executable === 'git' && index > 0 && arg.startsWith('-c')
          ? arg.slice(2)
          : executable === 'git' && index > 1 && argv[index - 1] === '--config-env'
            ? arg
            : executable === 'git' && index > 0 && arg.startsWith('--config-env=')
              ? arg.slice('--config-env='.length)
              : undefined;
    if (gitConfig !== undefined && gitConfigDispatchesShell(gitConfig))
      fail(
        `${path}[${index}]`,
        'Git configuration that dispatches a shell is forbidden; use non-executable configuration',
      );
  }
  return argv;
};
const pathParser = (value: unknown, path: string): string => {
  const result = stringParser(value, path);
  if (result.includes('\0')) fail(path, 'path contains a NUL byte');
  return result;
};

export const configValueParsers = Object.freeze({
  stringParser,
  booleanParser,
  integerParser,
  enumParser,
  listParser,
  durationParser,
  argvParser,
  pathParser,
});

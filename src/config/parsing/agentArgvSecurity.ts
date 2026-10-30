export const executableBasename = (argument: string): string =>
  argument
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)!
    .toLowerCase()
    .replace(/\.exe$/, '');

export const shellExecutables = new Set([
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

export const shellExecutable = (argument: string): boolean => {
  const basename = executableBasename(argument);
  if (shellExecutables.has(basename)) return true;
  return [...shellExecutables].some(
    (shell) =>
      basename.startsWith(`${shell}-`) ||
      (basename.startsWith(shell) && /^\d/.test(basename.slice(shell.length))),
  );
};

export const allowedExecutables = new Set(['codex', 'env', 'gh', 'git', 'npm']);

export const executableIndirectionOptions: Readonly<Record<string, readonly RegExp[]>> =
  Object.freeze({
    codex: [],

    env: [],

    gh: [/^(?:alias|extension)$/i],

    git: [/^(?:alias|difftool|filter-branch|mergetool|shell)$/i, /^--exec(?:=|$)/i],

    npm: [/^(?:exec|x|explore)$/i],
  });

export const gitConfigDispatchesShell = (argument: string): boolean => {
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

export const environmentAssignment = (argument: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*=/.test(argument);

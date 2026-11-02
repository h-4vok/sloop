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
  return [...shellExecutables].some((shell) => isVersionedShell(basename, shell));
};

function isVersionedShell(basename: string, shell: string): boolean {
  return basename.startsWith(`${shell}-`) || hasNumericShellVersion(basename, shell);
}

function hasNumericShellVersion(basename: string, shell: string): boolean {
  return basename.startsWith(shell) && /^\d/.test(basename.slice(shell.length));
}

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
    isShellAlias(name, configuredValue) ||
    isShellLaunchingProgram(name) ||
    isPagerProgram(name) ||
    isExternalToolCommand(name)
  );
};

function isShellAlias(name: string, value: string): boolean {
  return name.startsWith('alias.') && value.startsWith('!');
}

function isShellLaunchingProgram(name: string): boolean {
  return /^(?:core\.(?:editor|gitproxy|pager|sshcommand)|sequence\.editor|gpg\.program|diff\.external|credential\.helper)$/.test(
    name,
  );
}

function isPagerProgram(name: string): boolean {
  return /^pager\..+$/.test(name);
}

function isExternalToolCommand(name: string): boolean {
  return /^(?:difftool\.[^.]+\.cmd|filter\.[^.]+\.(?:clean|process|smudge))$/.test(name);
}

export const environmentAssignment = (argument: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*=/.test(argument);

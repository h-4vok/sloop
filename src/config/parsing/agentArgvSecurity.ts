const numericShellVersionPattern = /^\d/;
const windowsPathSeparatorPattern = /\\/g;
const windowsExecutableSuffixPattern = /\.exe$/;
const ghAliasOrExtensionIndirectionPattern = /^(?:alias|extension)$/i;

// Blocks Git subcommands that can dispatch aliases, shells, or external tools.
const gitCommandIndirectionPattern = /^(?:alias|difftool|filter-branch|mergetool|shell)$/i;
const gitExecOptionPattern = /^--exec(?:=|$)/i;
const npmExecutableIndirectionPattern = /^(?:exec|x|explore)$/i;
const environmentAssignmentPattern = /^[A-Za-z_][A-Za-z0-9_]*=/;
const gitPagerConfigPattern = /^pager\..+$/;

// This pattern covers Git settings that can start shells or external commands.
const shellLaunchingGitConfigPattern =
  /^(?:core\.(?:editor|gitproxy|pager|sshcommand)|sequence\.editor|gpg\.program|diff\.external|credential\.helper)$/;

// These keys configure commands invoked by Git's difftool and filter mechanisms.
const externalGitToolConfigPattern =
  /^(?:difftool\.[^.]+\.cmd|filter\.[^.]+\.(?:clean|process|smudge))$/;

// Centralizes the argv security rules used by the configuration parser.
export const agentArgvSecurity = {
  executableBasename(argument: string): string {
    return argument
      .replace(windowsPathSeparatorPattern, '/')
      .split('/')
      .at(-1)!
      .toLowerCase()
      .replace(windowsExecutableSuffixPattern, '');
  },

  shellExecutables: new Set([
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
  ]),

  shellExecutable(argument: string): boolean {
    const basename = this.executableBasename(argument);
    if (this.shellExecutables.has(basename)) return true;

    return [...this.shellExecutables].some((shell) => this.isVersionedShell(basename, shell));
  },

  isVersionedShell(basename: string, shell: string): boolean {
    return basename.startsWith(`${shell}-`) || this.hasNumericShellVersion(basename, shell);
  },

  hasNumericShellVersion(basename: string, shell: string): boolean {
    return (
      basename.startsWith(shell) && numericShellVersionPattern.test(basename.slice(shell.length))
    );
  },

  allowedExecutables: new Set(['codex', 'env', 'gh', 'git', 'npm']),

  executableIndirectionOptions: Object.freeze({
    codex: [],

    env: [],

    gh: [ghAliasOrExtensionIndirectionPattern],

    git: [gitCommandIndirectionPattern, gitExecOptionPattern],

    npm: [npmExecutableIndirectionPattern],
  }) as Readonly<Record<string, readonly RegExp[]>>,

  gitConfigDispatchesShell(argument: string): boolean {
    const separator = argument.indexOf('=');
    if (separator < 1) return false;

    const name = argument.slice(0, separator).toLowerCase();
    const configuredValue = argument.slice(separator + 1).trimStart();

    return (
      this.isShellAlias(name, configuredValue) ||
      this.isShellLaunchingProgram(name) ||
      this.isPagerProgram(name) ||
      this.isExternalToolCommand(name)
    );
  },

  isShellAlias(name: string, value: string): boolean {
    return name.startsWith('alias.') && value.startsWith('!');
  },

  isShellLaunchingProgram(name: string): boolean {
    return shellLaunchingGitConfigPattern.test(name);
  },

  isPagerProgram(name: string): boolean {
    return gitPagerConfigPattern.test(name);
  },

  isExternalToolCommand(name: string): boolean {
    return externalGitToolConfigPattern.test(name);
  },

  environmentAssignment(argument: string): boolean {
    return environmentAssignmentPattern.test(argument);
  },
};

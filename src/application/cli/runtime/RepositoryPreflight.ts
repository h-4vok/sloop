import { join, relative, resolve, isAbsolute, sep } from 'node:path';
import { loadConfigTextResult, type SloopConfig } from '../../../config.js';
import type { DispatcherCommand } from '../../dispatcher/DispatcherCommand.js';
import { createProductionRuntimeIo } from '../../../infrastructure/host/createProductionRuntimeIo.js';
import { EXIT, type ExitCode } from '../ExitCode.js';
import type { RuntimeIo } from '../RuntimeIo.js';
import type { Diagnostic } from '../RuntimeResult.js';
import { resultOutput } from './ResultOutput.js';
import { result } from '../../../core/Result.js';
import type { Result } from '../../../core/Result.js';

type LoadedRepositoryConfig = Readonly<{ config: SloopConfig; ref: string }>;

type DispatcherPreflight = Readonly<{
  code: ExitCode;
  root?: string;
  config?: SloopConfig;
  repository?: string;
}>;

type GitHubIdentity = Readonly<{ repository?: string; failures: Diagnostic[] }>;

/** Discovers repository configuration and validates prerequisites for commands. */
export const repositoryPreflight = Object.freeze({
  clean(value: string): string {
    return value.trim().replace(/\r/g, '');
  },

  diagnostic(
    check: string,
    message: string,
    remediation: string,
    extra: Omit<Diagnostic, 'check' | 'message' | 'remediation'> = {},
  ): Diagnostic {
    return resultOutput.createDiagnostic(check, message, remediation, extra);
  },

  discoverRepository(io: RuntimeIo): Result<string, Diagnostic> {
    const found = io.run('git', ['rev-parse', '--show-toplevel'], io.cwd);
    if (found.status !== 0 || !this.clean(found.stdout))
      return result.failure(
        this.diagnostic(
          'repository',
          'The current directory is not inside a Git repository.',
          'Change to the target repository or one of its subdirectories.',
        ),
      );

    const root = resolve(this.clean(found.stdout));
    const pathFromRoot = relative(root, resolve(io.cwd));
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot))
      return result.failure(
        this.diagnostic(
          'repository',
          'Git selected a repository that does not contain the current directory.',
          'Remove Git repository-routing environment overrides and change to the target repository or one of its subdirectories.',
        ),
      );

    return result.success(root);
  },

  loadBaseConfig(root: string, io: RuntimeIo): Result<LoadedRepositoryConfig, Diagnostic> {
    const file = join(root, 'sloop.config.yaml');
    let source: string;
    try {
      source = io.readFile(file);
    } catch {
      return result.failure(
        this.diagnostic(
          'configuration',
          'sloop.config.yaml is absent from the working tree.',
          'No safe repair command is available; create a valid sloop.config.yaml in the repository root.',
        ),
      );
    }

    const configResult = loadConfigTextResult(source);
    if (!configResult.ok) {
      return result.failure(
        this.diagnostic(
          'configuration',
          String(configResult.error),
          'No safe repair command is available; repair sloop.config.yaml in the working tree.',
        ),
      );
    }

    return result.success({ config: configResult.value, ref: 'working-tree' });
  },

  checkExecutable(name: string, io: RuntimeIo, root: string): Diagnostic | undefined {
    const execution = io.run(name, ['--version'], root);
    if (execution.status === 0) return undefined;

    const output = this.clean(execution.stderr || execution.stdout)
      .replace(/\s+/g, ' ')
      .slice(0, 200);
    const details = output ? ` Output: ${output}` : '';
    return this.diagnostic(
      name,
      `${name} --version failed with exit status ${execution.status}.${details}`,
      `Install ${name} and ensure it is on PATH.`,
    );
  },

  commonChecks(root: string, config: SloopConfig, io: RuntimeIo): Diagnostic[] {
    const failures: Diagnostic[] = [];
    failures.push(...this.checkPlatform(io));
    failures.push(...this.checkNodeVersion(io));
    failures.push(...this.checkGitAndRepository(config, io, root));

    return failures;
  },

  checkPlatform(io: RuntimeIo): Diagnostic[] {
    if (['win32', 'linux', 'darwin'].includes(io.platform)) return [];

    return [
      this.diagnostic(
        'platform',
        `Platform ${io.platform} is unsupported.`,
        'Run Sloop on Windows, Linux, or macOS.',
      ),
    ];
  },

  checkNodeVersion(io: RuntimeIo): Diagnostic[] {
    const major = Number(io.nodeVersion.replace(/^v/, '').split('.')[0]);
    if (Number.isInteger(major) && major >= 22) return [];

    return [
      this.diagnostic(
        'node',
        `Node.js ${io.nodeVersion} is unsupported.`,
        'Install Node.js 22 or newer.',
      ),
    ];
  },

  checkGitAndRepository(config: SloopConfig, io: RuntimeIo, root: string): Diagnostic[] {
    const failures: Diagnostic[] = [];
    const gitFailure = this.checkExecutable('git', io, root);
    if (gitFailure) failures.push(gitFailure);
    failures.push(...this.checkRemoteAndBase(config, io, root));

    return failures;
  },

  checkRemoteAndBase(config: SloopConfig, io: RuntimeIo, root: string): Diagnostic[] {
    const failures: Diagnostic[] = [];
    const remote = io.run('git', ['remote', 'get-url', config.repository.remote], root);
    if (remote.status !== 0) {
      failures.push(
        this.diagnostic(
          'remote',
          `Configured remote ${config.repository.remote} does not exist.`,
          `Add the ${config.repository.remote} remote with the GitHub repository URL.`,
        ),
      );
    }

    const base = `${config.repository.remote}/${config.repository.baseBranch}^{commit}`;
    const branch = io.run('git', ['rev-parse', '--verify', base], root);
    if (branch.status !== 0) {
      failures.push(
        this.diagnostic(
          'base-branch',
          `Configured base ${config.repository.remote}/${config.repository.baseBranch} is unavailable.`,
          `Fetch ${config.repository.remote} ${config.repository.baseBranch}.`,
        ),
      );
    }

    return failures;
  },

  githubChecks(root: string, config: SloopConfig, io: RuntimeIo, allLabels = false): Diagnostic[] {
    const ghFailure = this.checkExecutable('gh', io, root);
    if (ghFailure) return [ghFailure];

    const failures = this.checkGitHubAuthentication(io, root);
    const remote = io.run('git', ['remote', 'get-url', config.repository.remote], root);
    const remoteUrl = this.clean(remote.stdout);
    if (remote.status !== 0 || !remoteUrl) return failures;

    const identity = this.readGitHubIdentity(remoteUrl, root, io, allLabels);
    failures.push(...identity.failures);
    if (!identity.repository) return failures;

    failures.push(...this.checkRequiredLabels(identity.repository, config, io, root, allLabels));

    return failures;
  },

  checkGitHubAuthentication(io: RuntimeIo, root: string): Diagnostic[] {
    if (io.run('gh', ['auth', 'status'], root).status === 0) return [];

    return [
      this.diagnostic('github-auth', 'GitHub CLI is not authenticated.', 'Run `gh auth login`.'),
    ];
  },

  readGitHubIdentity(
    remoteUrl: string,
    root: string,
    io: RuntimeIo,
    allLabels: boolean,
  ): GitHubIdentity {
    const failures: Diagnostic[] = [];
    const identity = io.run(
      'gh',
      ['repo', 'view', remoteUrl, '--json', 'nameWithOwner,viewerPermission'],
      root,
    );
    if (identity.status !== 0) {
      failures.push(
        this.diagnostic(
          'repository-identity',
          'The configured Git remote does not resolve to an accessible GitHub repository.',
          'Correct the configured remote or request repository access.',
        ),
      );
    } else {
      failures.push(...this.validateGitHubPermissions(identity.stdout, allLabels));
    }

    const repositoryResult = this.githubRepository(remoteUrl);
    if (!repositoryResult.ok) {
      failures.push(
        this.diagnostic(
          'repository-identity',
          'The configured remote is not a GitHub repository URL.',
          'Set the configured remote to the target GitHub repository URL.',
        ),
      );
    }

    return { repository: repositoryResult.ok ? repositoryResult.value : undefined, failures };
  },

  validateGitHubPermissions(response: string, allLabels: boolean): Diagnostic[] {
    const repository = this.parseGitHubRepository(response);
    if (!repository) {
      return [
        this.diagnostic(
          'repository-identity',
          'GitHub returned invalid repository identity data.',
          'Retry the command.',
        ),
      ];
    }

    return [
      ...this.validateGitHubIdentity(repository.nameWithOwner),
      ...this.validateGitHubPermission(repository.viewerPermission, allLabels),
    ];
  },

  parseGitHubRepository(response: string):
    | {
        nameWithOwner?: string;
        viewerPermission?: string;
      }
    | undefined {
    try {
      const repository: unknown = JSON.parse(response);
      if (!repository || typeof repository !== 'object' || Array.isArray(repository))
        return undefined;
      return repository as { nameWithOwner?: string; viewerPermission?: string };
    } catch {
      return undefined;
    }
  },

  validateGitHubIdentity(nameWithOwner?: string): Diagnostic[] {
    if (nameWithOwner) return [];
    return [
      this.diagnostic(
        'repository-identity',
        'GitHub returned no repository identity.',
        'Correct the configured remote.',
      ),
    ];
  },

  validateGitHubPermission(viewerPermission: string | undefined, allLabels: boolean): Diagnostic[] {
    const acceptedPermissions = allLabels
      ? ['WRITE', 'MAINTAIN', 'ADMIN']
      : ['READ', 'TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'];
    if (acceptedPermissions.includes(viewerPermission ?? '')) return [];
    return [
      this.diagnostic(
        'permissions',
        allLabels
          ? 'Repository write permission is unavailable.'
          : 'Repository read permission is unavailable.',
        `Request repository ${allLabels ? 'write' : 'read'} access.`,
      ),
    ];
  },

  checkRequiredLabels(
    repository: string,
    config: SloopConfig,
    io: RuntimeIo,
    root: string,
    allLabels: boolean,
  ): Diagnostic[] {
    const response = io.run(
      'gh',
      ['label', 'list', '--repo', repository, '--limit', '1000', '--json', 'name'],
      root,
    );
    if (response.status !== 0) {
      return [
        this.diagnostic(
          'permissions',
          'Repository labels could not be read.',
          'Request repository read access.',
        ),
      ];
    }

    return this.validateRequiredLabels(response.stdout, config, allLabels);
  },

  validateRequiredLabels(response: string, config: SloopConfig, allLabels: boolean): Diagnostic[] {
    const requiredLabels = allLabels
      ? [
          config.github.labels.eligible,
          config.github.labels.claimed,
          config.github.labels.blocked,
          ...config.github.labels.priority,
        ]
      : [config.github.labels.eligible];
    let names: string[];
    try {
      names = (JSON.parse(response) as { name: string }[]).map(({ name }) => name);
    } catch {
      return [
        this.diagnostic('labels', 'GitHub returned invalid label data.', 'Retry the command.'),
      ];
    }

    const missingLabels = requiredLabels.filter((name) => !names.includes(name));
    if (!missingLabels.length) return [];

    return [
      this.diagnostic(
        'labels',
        `Required labels are missing: ${missingLabels.join(', ')}.`,
        'Create the required labels.',
      ),
    ];
  },

  githubRepository(remoteUrl: string): Result<string, string> {
    const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (!match) return { ok: false, error: 'configured remote is not a GitHub repository URL' };

    return { ok: true, value: `${match[1]}/${match[2]}` };
  },

  doctorChecks(root: string, config: SloopConfig, io: RuntimeIo): Diagnostic[] {
    const failures = [
      ...this.commonChecks(root, config, io),
      ...this.githubChecks(root, config, io, true),
    ];
    failures.push(...this.checkCodex(io, root));
    failures.push(...this.checkRequiredSkills(root, config, io));
    failures.push(...this.checkWorkingTree(root, io));
    failures.push(...this.checkBranchPolicy(root, config, io));

    return failures;
  },

  checkCodex(io: RuntimeIo, root: string): Diagnostic[] {
    const codexFailure = this.checkExecutable('codex', io, root);

    return codexFailure ? [codexFailure] : [];
  },

  checkRequiredSkills(root: string, config: SloopConfig, io: RuntimeIo): Diagnostic[] {
    const failures: Diagnostic[] = [];
    for (const skill of config.skills.required) {
      const base =
        config.skills.scope === 'repository'
          ? join(root, '.codex', 'skills')
          : join(io.homeDirectory, '.codex', 'skills');
      const skillFile = join(base, skill, 'SKILL.md');
      if (io.canRead(skillFile)) continue;

      failures.push(
        this.diagnostic(
          'skills',
          `Required skill ${skill} is missing.`,
          `No safe repair command is available; install ${skill} in ${base}.`,
        ),
      );
    }

    return failures;
  },

  checkWorkingTree(root: string, io: RuntimeIo): Diagnostic[] {
    if (io.run('git', ['status', '--porcelain'], root).status === 0) return [];

    return [
      this.diagnostic(
        'working-tree',
        'Working tree status failed.',
        'No safe repair command is available because the checkout status could not be inspected.',
      ),
    ];
  },

  checkBranchPolicy(root: string, config: SloopConfig, io: RuntimeIo): Diagnostic[] {
    const branch = io.run('git', ['symbolic-ref', '--short', 'HEAD'], root);
    const branchName = this.clean(branch.stdout);
    if (branch.status !== 0 || !branchName) {
      return [
        this.diagnostic(
          'branch-policy',
          'The checkout has a detached HEAD.',
          'Check out the configured base or a Sloop worker branch.',
        ),
      ];
    }
    if (
      branchName === config.repository.baseBranch ||
      branchName.startsWith(config.repository.branchPrefix)
    ) {
      return [];
    }

    return [
      this.diagnostic(
        'branch-policy',
        `Branch ${branchName} violates the configured branch policy.`,
        `Use ${config.repository.baseBranch} or ${config.repository.branchPrefix}<issue>.`,
      ),
    ];
  },

  runDispatcherPreflight(command: DispatcherCommand, providedIo?: RuntimeIo): DispatcherPreflight {
    const io = providedIo ?? createProductionRuntimeIo();
    const context = this.loadDispatcherContext(command, io);
    if (!context.root || !context.config) return context.result;

    const failures = this.checkCommandPrerequisites(command, context.root, context.config, io);
    if (failures.length) return this.emitPreflightFailure(command, failures, io);

    return this.validateRepositoryIdentity(command, context.root, context.config, io);
  },

  loadDispatcherContext(
    command: DispatcherCommand,
    io: RuntimeIo,
  ): Readonly<{
    root?: string;
    config?: SloopConfig;
    result: DispatcherPreflight;
  }> {
    const rootResult = this.discoverRepository(io);
    if (!rootResult.ok) {
      const item = rootResult.error;
      const result = resultOutput.createEnvelope(
        this.commandNameForDispatcher(command),
        'failed',
        'discovery',
        'Repository startup failed.',
        null,
        [item],
      );

      return {
        result: {
          code: resultOutput.emit(result, false, EXIT.preflight, io),
        },
      };
    }
    const configResult = this.loadBaseConfig(rootResult.value, io);
    if (!configResult.ok) {
      const result = resultOutput.createEnvelope(
        this.commandNameForDispatcher(command),
        'failed',
        'discovery',
        'Repository startup failed.',
        null,
        [configResult.error],
      );
      return { result: { code: resultOutput.emit(result, false, EXIT.preflight, io) } };
    }
    return { root: rootResult.value, config: configResult.value.config, result: { code: EXIT.ok } };
  },

  checkCommandPrerequisites(
    command: DispatcherCommand,
    root: string,
    config: SloopConfig,
    io: RuntimeIo,
  ): Diagnostic[] {
    if (this.isLocalCommand(command)) return this.commonChecks(root, config, io);
    if (command.kind === 'list')
      return [...this.commonChecks(root, config, io), ...this.githubChecks(root, config, io)];
    if (this.isGitHubWriteCommand(command))
      return [...this.commonChecks(root, config, io), ...this.githubChecks(root, config, io, true)];

    return this.doctorChecks(root, config, io);
  },

  isLocalCommand(command: DispatcherCommand): boolean {
    return ['status', 'recover-lock', 'reset', 'prepare-recovery'].includes(command.kind);
  },

  isGitHubWriteCommand(command: DispatcherCommand): boolean {
    return command.kind === 'link-issue' || command.kind === 'resolve-review-cap';
  },

  emitPreflightFailure(
    command: DispatcherCommand,
    failures: readonly Diagnostic[],
    io: RuntimeIo,
  ): DispatcherPreflight {
    const result = resultOutput.createEnvelope(
      this.commandNameForDispatcher(command),
      'failed',
      'preflight',
      'Preflight validation failed.',
      null,
      failures,
    );

    return { code: resultOutput.emit(result, false, EXIT.preflight, io) };
  },

  validateRepositoryIdentity(
    command: DispatcherCommand,
    root: string,
    config: SloopConfig,
    io: RuntimeIo,
  ): DispatcherPreflight {
    const remote = io.run('git', ['remote', 'get-url', config.repository.remote], root);
    const repositoryResult = this.githubRepository(this.clean(remote.stdout));
    if (!repositoryResult.ok) {
      const failure = this.diagnostic(
        'repository-identity',
        'The configured remote is not a GitHub repository URL.',
        'Set the configured remote to the target GitHub repository URL.',
      );
      const result = resultOutput.createEnvelope(
        this.commandNameForDispatcher(command),
        'failed',
        'preflight',
        'Preflight validation failed.',
        null,
        [failure],
      );

      return { code: resultOutput.emit(result, false, EXIT.preflight, io) };
    }
    return { code: EXIT.ok, root, config, repository: repositoryResult.value };
  },

  commandNameForDispatcher(command: DispatcherCommand): string {
    switch (command.kind) {
      case 'workflow':
        return 'sloop';
      case 'list':
        return '--list';
      case 'recover-lock':
        return '--recover-lock';
      case 'reset':
        return '--reset';
      case 'prepare-recovery':
        return '--prepare-recovery';
      case 'resolve-review-cap':
        return '--resolve-review-cap';
      case 'link-issue':
        return '--link-issue';
      case 'list-all-worktrees':
        return '--list-all-worktrees';
      case 'clear-all-worktrees':
        return '--clear-all-worktrees';
      case 'status':
        return '--status';
    }
  },
});

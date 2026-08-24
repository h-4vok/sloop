import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadConfigText, type SloopConfig } from './config.js';

export const EXIT = Object.freeze({ ok: 0, preflight: 2, busy: 3, blocked: 4, external: 5 });
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
export type ResultStatus = 'completed' | 'idle' | 'waiting' | 'busy' | 'blocked' | 'failed';
export type Diagnostic = Readonly<{
  check: string;
  message: string;
  remediation: string;
}>;
export type ResultEnvelope = Readonly<{
  command: string;
  status: ResultStatus;
  phase: 'discovery' | 'preflight' | 'result';
  summary: string;
  result: unknown;
  diagnostics: readonly Diagnostic[];
  references: Readonly<{ issues: readonly number[]; pullRequests: readonly number[] }>;
}>;

type CommandResult = { stdout: string; stderr: string; status: number };
export type RuntimeIo = Readonly<{
  cwd: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  run: (file: string, args: readonly string[], cwd?: string) => CommandResult;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}>;

const productionIo = (): RuntimeIo => ({
  cwd: process.cwd(),
  platform: process.platform,
  nodeVersion: process.version,
  run(file, args, cwd) {
    try {
      return {
        stdout: execFileSync(file, [...args], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        }),
        stderr: '',
        status: 0,
      };
    } catch (error) {
      const failure = error as {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        status?: number;
      };
      return {
        stdout: String(failure.stdout ?? ''),
        stderr: String(failure.stderr ?? ''),
        status: failure.status ?? 1,
      };
    }
  },
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
});

const diagnostic = (check: string, message: string, remediation: string): Diagnostic => ({
  check,
  message,
  remediation,
});
const clean = (value: string): string => value.trim().replace(/\r/g, '');
const envelope = (
  command: string,
  status: ResultStatus,
  phase: ResultEnvelope['phase'],
  summary: string,
  result: unknown = null,
  diagnostics: readonly Diagnostic[] = [],
  issues: readonly number[] = [],
  pullRequests: readonly number[] = [],
): ResultEnvelope => ({
  command,
  status,
  phase,
  summary,
  result,
  diagnostics,
  references: { issues, pullRequests },
});

function commandName(args: readonly string[]): string {
  const positional = args.filter((arg) => !arg.startsWith('--'));
  return positional.length ? positional.join(' ') : (args[0] ?? 'sloop');
}

function emit(value: ResultEnvelope, json: boolean, code: ExitCode, io: RuntimeIo): ExitCode {
  if (json) io.stdout(JSON.stringify(value));
  else {
    const lines = [value.summary];
    for (const item of value.diagnostics)
      lines.push(`[${item.check}] ${item.message} Remediation: ${item.remediation}`);
    (code === EXIT.ok ? io.stdout : io.stderr)(lines.join('\n'));
  }
  return code;
}

export function emitNodeVersionFailure(
  args: readonly string[],
  nodeVersion: string,
  providedIo?: RuntimeIo,
): ExitCode {
  const io = providedIo ?? productionIo();
  return emit(
    envelope(commandName(args), 'failed', 'preflight', 'Preflight validation failed.', null, [
      diagnostic(
        'node',
        `Sloop requires Node.js 22 or newer; current runtime is ${nodeVersion}.`,
        'Install Node.js 22 or newer.',
      ),
    ]),
    args.includes('--json'),
    EXIT.preflight,
    io,
  );
}

export function discoverRepository(io: RuntimeIo): string {
  const found = io.run('git', ['rev-parse', '--show-toplevel'], io.cwd);
  if (found.status !== 0 || !clean(found.stdout))
    throw diagnostic(
      'repository',
      'The current directory is not inside a Git repository.',
      'Change to the target repository or one of its subdirectories.',
    );
  const root = resolve(clean(found.stdout));
  const pathFromRoot = relative(root, resolve(io.cwd));
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot))
    throw diagnostic(
      'repository',
      'Git selected a repository that does not contain the current directory.',
      'Remove Git repository-routing environment overrides and change to the target repository or one of its subdirectories.',
    );
  return root;
}

function loadBaseConfig(root: string, io: RuntimeIo): { config: SloopConfig; ref: string } {
  const local = io.run('git', ['show', 'HEAD:sloop.config.yaml'], root);
  if (local.status !== 0)
    throw diagnostic(
      'configuration',
      'sloop.config.yaml is absent from HEAD.',
      'Commit a valid sloop.config.yaml before running Sloop.',
    );
  let bootstrap: SloopConfig;
  try {
    bootstrap = loadConfigText(local.stdout);
  } catch (error) {
    throw diagnostic('configuration', String(error), 'Repair and commit sloop.config.yaml.');
  }
  const ref = `${bootstrap.repository.remote}/${bootstrap.repository.baseBranch}`;
  const base = io.run('git', ['show', `${ref}:sloop.config.yaml`], root);
  if (base.status !== 0)
    throw diagnostic(
      'base-configuration',
      `sloop.config.yaml is absent from configured base commit ${ref}.`,
      `Fetch ${bootstrap.repository.remote} and ensure ${bootstrap.repository.baseBranch} contains a valid sloop.config.yaml.`,
    );
  try {
    const config = loadConfigText(base.stdout);
    if (
      config.repository.remote !== bootstrap.repository.remote ||
      config.repository.baseBranch !== bootstrap.repository.baseBranch
    )
      throw new Error(
        `configured base selector changed between HEAD and ${ref}; repository.remote and repository.baseBranch must match`,
      );
    return { config, ref };
  } catch (error) {
    throw diagnostic(
      'base-configuration',
      String(error),
      `Repair sloop.config.yaml on ${ref} and fetch the updated branch.`,
    );
  }
}

function executableCheck(name: string, io: RuntimeIo, root: string): Diagnostic | undefined {
  const result = io.run(name, ['--version'], root);
  return result.status === 0
    ? undefined
    : diagnostic(name, `${name} is unavailable.`, `Install ${name} and ensure it is on PATH.`);
}

function commonChecks(root: string, config: SloopConfig, io: RuntimeIo): Diagnostic[] {
  const failures: Diagnostic[] = [];
  if (!['win32', 'linux', 'darwin'].includes(io.platform))
    failures.push(
      diagnostic(
        'platform',
        `Platform ${io.platform} is unsupported.`,
        'Run Sloop on Windows, Linux, or macOS.',
      ),
    );
  const major = Number(io.nodeVersion.replace(/^v/, '').split('.')[0]);
  if (!Number.isInteger(major) || major < 22)
    failures.push(
      diagnostic(
        'node',
        `Node.js ${io.nodeVersion} is unsupported.`,
        'Install Node.js 22 or newer.',
      ),
    );
  const git = executableCheck('git', io, root);
  if (git) failures.push(git);
  const remote = io.run('git', ['remote', 'get-url', config.repository.remote], root);
  if (remote.status !== 0)
    failures.push(
      diagnostic(
        'remote',
        `Configured remote ${config.repository.remote} does not exist.`,
        `Add the ${config.repository.remote} remote with the GitHub repository URL.`,
      ),
    );
  const branch = io.run(
    'git',
    [
      'rev-parse',
      '--verify',
      `${config.repository.remote}/${config.repository.baseBranch}^{commit}`,
    ],
    root,
  );
  if (branch.status !== 0)
    failures.push(
      diagnostic(
        'base-branch',
        `Configured base ${config.repository.remote}/${config.repository.baseBranch} is unavailable.`,
        `Fetch ${config.repository.remote} ${config.repository.baseBranch}.`,
      ),
    );
  return failures;
}

function githubChecks(
  root: string,
  config: SloopConfig,
  io: RuntimeIo,
  allLabels = false,
): Diagnostic[] {
  const failures: Diagnostic[] = [];
  const gh = executableCheck('gh', io, root);
  if (gh) return [gh];
  if (io.run('gh', ['auth', 'status'], root).status !== 0)
    failures.push(
      diagnostic('github-auth', 'GitHub CLI is not authenticated.', 'Run `gh auth login`.'),
    );
  const remoteResult = io.run('git', ['remote', 'get-url', config.repository.remote], root);
  const remoteUrl = clean(remoteResult.stdout);
  if (remoteResult.status !== 0 || !remoteUrl) return failures;
  const identity = io.run(
    'gh',
    ['repo', 'view', remoteUrl, '--json', 'nameWithOwner,viewerPermission'],
    root,
  );
  if (identity.status !== 0)
    failures.push(
      diagnostic(
        'repository-identity',
        'The configured Git remote does not resolve to an accessible GitHub repository.',
        'Correct the configured remote or request repository access.',
      ),
    );
  else {
    try {
      const repository = JSON.parse(identity.stdout) as {
        nameWithOwner?: string;
        viewerPermission?: string;
      };
      if (!repository.nameWithOwner)
        failures.push(
          diagnostic(
            'repository-identity',
            'GitHub returned no repository identity.',
            'Correct the configured remote.',
          ),
        );
      const acceptedPermissions = allLabels
        ? ['WRITE', 'MAINTAIN', 'ADMIN']
        : ['READ', 'TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'];
      if (!acceptedPermissions.includes(repository.viewerPermission ?? ''))
        failures.push(
          diagnostic(
            'permissions',
            allLabels
              ? 'Repository write permission is unavailable.'
              : 'Repository read permission is unavailable.',
            `Request repository ${allLabels ? 'write' : 'read'} access.`,
          ),
        );
    } catch {
      failures.push(
        diagnostic(
          'repository-identity',
          'GitHub returned invalid repository identity data.',
          'Retry the command.',
        ),
      );
    }
  }
  let repo: string;
  try {
    repo = githubRepository(remoteUrl);
  } catch {
    failures.push(
      diagnostic(
        'repository-identity',
        'The configured remote is not a GitHub repository URL.',
        'Set the configured remote to the target GitHub repository URL.',
      ),
    );
    return failures;
  }
  const labels = io.run(
    'gh',
    ['label', 'list', '--repo', repo, '--limit', '1000', '--json', 'name'],
    root,
  );
  if (labels.status !== 0)
    failures.push(
      diagnostic(
        'permissions',
        'Repository labels could not be read.',
        'Request repository read access.',
      ),
    );
  else {
    const required = allLabels
      ? [
          config.github.labels.eligible,
          config.github.labels.claimed,
          config.github.labels.blocked,
          ...config.github.labels.priority,
        ]
      : [config.github.labels.eligible];
    let names: string[] = [];
    try {
      names = (JSON.parse(labels.stdout) as { name: string }[]).map(({ name }) => name);
    } catch {
      failures.push(
        diagnostic('labels', 'GitHub returned invalid label data.', 'Retry the command.'),
      );
    }
    const missing = required.filter((name) => !names.includes(name));
    if (missing.length)
      failures.push(
        diagnostic(
          'labels',
          `Required labels are missing: ${missing.join(', ')}.`,
          'Create the required labels.',
        ),
      );
  }
  return failures;
}

function githubRepository(remoteUrl: string): string {
  const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) throw new Error('configured remote is not a GitHub repository URL');
  return `${match[1]}/${match[2]}`;
}

function doctorChecks(root: string, config: SloopConfig, io: RuntimeIo): Diagnostic[] {
  const failures = [...commonChecks(root, config, io), ...githubChecks(root, config, io, true)];
  const codex = executableCheck('codex', io, root);
  if (codex) failures.push(codex);
  for (const skill of config.skills.required) {
    const base =
      config.skills.scope === 'repository'
        ? join(root, '.codex', 'skills')
        : join(homedir(), '.codex', 'skills');
    try {
      accessSync(join(base, skill, 'SKILL.md'), constants.R_OK);
    } catch {
      failures.push(
        diagnostic('skills', `Required skill ${skill} is missing.`, `Install ${skill} in ${base}.`),
      );
    }
  }
  const tree = io.run('git', ['status', '--porcelain'], root);
  if (tree.status !== 0)
    failures.push(
      diagnostic('working-tree', 'Working tree status failed.', 'Repair the Git checkout.'),
    );
  else if (clean(tree.stdout))
    failures.push(
      diagnostic(
        'working-tree',
        'The working tree is not clean.',
        'Commit or stash local changes.',
      ),
    );
  const branch = io.run('git', ['symbolic-ref', '--short', 'HEAD'], root);
  const branchName = clean(branch.stdout);
  if (branch.status !== 0 || !branchName)
    failures.push(
      diagnostic(
        'branch-policy',
        'The checkout has a detached HEAD.',
        'Check out the configured base or a Sloop worker branch.',
      ),
    );
  else if (
    branchName !== config.repository.baseBranch &&
    !branchName.startsWith(config.repository.branchPrefix)
  )
    failures.push(
      diagnostic(
        'branch-policy',
        `Branch ${branchName} violates the configured branch policy.`,
        `Use ${config.repository.baseBranch} or ${config.repository.branchPrefix}<issue>.`,
      ),
    );
  return failures;
}

export function runDispatcherPreflight(
  args: readonly string[],
  providedIo?: RuntimeIo,
): Readonly<{ code: ExitCode; root?: string; config?: SloopConfig; repository?: string }> {
  const io = providedIo ?? productionIo();
  let command: DispatcherCommand;
  try {
    command = parseDispatcherCommand(args);
  } catch (error) {
    return {
      code: emit(
        envelope(commandName(args), 'failed', 'preflight', 'Command usage is invalid.', null, [
          diagnostic(
            'usage',
            error instanceof Error ? error.message : String(error),
            'Run `sloop --help` and use a documented command form.',
          ),
        ]),
        false,
        EXIT.preflight,
        io,
      ),
    };
  }
  let root: string;
  let config: SloopConfig;
  try {
    root = discoverRepository(io);
    ({ config } = loadBaseConfig(root, io));
  } catch (error) {
    const item = error as Diagnostic;
    return {
      code: emit(
        envelope(commandName(args), 'failed', 'discovery', 'Repository startup failed.', null, [
          item,
        ]),
        false,
        EXIT.preflight,
        io,
      ),
    };
  }

  const localOnly = ['status', 'recover-lock', 'reset', 'prepare-recovery'].includes(command.kind);
  const githubRead = command.kind === 'list';
  const githubWrite = ['link-issue', 'resolve-review-cap'].includes(command.kind);
  const failures = localOnly
    ? commonChecks(root, config, io)
    : githubRead
      ? [...commonChecks(root, config, io), ...githubChecks(root, config, io)]
      : githubWrite
        ? [...commonChecks(root, config, io), ...githubChecks(root, config, io, true)]
        : doctorChecks(root, config, io);
  if (failures.length)
    return {
      code: emit(
        envelope(
          commandName(args),
          'failed',
          'preflight',
          'Preflight validation failed.',
          null,
          failures,
        ),
        false,
        EXIT.preflight,
        io,
      ),
    };
  const remoteResult = io.run('git', ['remote', 'get-url', config.repository.remote], root);
  try {
    return {
      code: EXIT.ok,
      root,
      config,
      repository: githubRepository(clean(remoteResult.stdout)),
    };
  } catch {
    return {
      code: emit(
        envelope(commandName(args), 'failed', 'preflight', 'Preflight validation failed.', null, [
          diagnostic(
            'repository-identity',
            'The configured remote is not a GitHub repository URL.',
            'Set the configured remote to the target GitHub repository URL.',
          ),
        ]),
        false,
        EXIT.preflight,
        io,
      ),
    };
  }
}

type DispatcherCommand = Readonly<{
  kind:
    | 'workflow'
    | 'status'
    | 'list'
    | 'recover-lock'
    | 'reset'
    | 'prepare-recovery'
    | 'resolve-review-cap'
    | 'link-issue';
}>;

export function parseDispatcherCommand(args: readonly string[]): DispatcherCommand {
  if (args.length === 0) return { kind: 'workflow' };
  const positive = (value: string | undefined): boolean => /^[1-9]\d*$/.test(value ?? '');
  if (
    args[0] === '--status' &&
    (args.length === 1 || (args.length === 2 && args[1] === '--verbose'))
  )
    return { kind: 'status' };
  if (args.length === 1 && args[0] === '--list') return { kind: 'list' };
  if (args.length === 1 && args[0] === '--recover-lock') return { kind: 'recover-lock' };
  if (args.length === 1 && args[0] === '--reset') return { kind: 'reset' };
  if (args[0] === '--link-issue' && args.length === 2 && positive(args[1]))
    return { kind: 'link-issue' };
  if (
    args[0] === '--prepare-recovery' &&
    positive(args[1]) &&
    (args.length === 2 || (args.length === 4 && args[2] === '--pr' && positive(args[3])))
  )
    return { kind: 'prepare-recovery' };
  if (args[0] === '--resolve-review-cap' && args.length > 1) {
    const counts = new Map<string, number>();
    const values = new Map<string, string[]>();
    const valueOptions = new Set(['--steer', '--additional-rounds', '--waive']);
    const booleanOptions = new Set(['--waive-all-outstanding', '--abandon']);
    for (let index = 1; index < args.length; index++) {
      const option = args[index];
      if (!valueOptions.has(option) && !booleanOptions.has(option))
        throw new Error('mixed, duplicate, unknown, or unsupported command arguments');
      counts.set(option, (counts.get(option) ?? 0) + 1);
      if (valueOptions.has(option)) {
        const value = args[++index];
        if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
        values.set(option, [...(values.get(option) ?? []), value]);
      }
    }
    if ((counts.get('--steer') ?? 0) !== 1)
      throw new Error('--resolve-review-cap requires exactly one --steer <text>');
    for (const option of ['--additional-rounds', '--waive-all-outstanding', '--abandon'])
      if ((counts.get(option) ?? 0) > 1) throw new Error(`${option} cannot be repeated`);
    const rounds = values.get('--additional-rounds')?.[0];
    if (rounds !== undefined && !/^\d+$/.test(rounds))
      throw new Error('--additional-rounds must be a non-negative integer');
    if ((values.get('--waive') ?? []).some((value) => !/^[QS]\d+(?:,[QS]\d+)*$/.test(value)))
      throw new Error('--waive requires comma-separated Q<n> or S<n> finding IDs');
    return { kind: 'resolve-review-cap' };
  }
  throw new Error('mixed, duplicate, unknown, or unsupported command arguments');
}

type Parsed = { command: 'status' | 'issues list' | 'doctor'; json: boolean; verbose: boolean };
export function parseReadOnlyCommand(args: readonly string[]): Parsed | undefined {
  const json = args.includes('--json');
  const stripped = args.filter((arg) => arg !== '--json');
  if (stripped[0] === 'status') {
    const rest = stripped.slice(1);
    if (rest.some((arg) => arg !== '--verbose') || rest.filter((x) => x === '--verbose').length > 1)
      throw new Error('status accepts only --verbose and --json');
    return { command: 'status', json, verbose: rest.includes('--verbose') };
  }
  if (stripped[0] === 'issues' && stripped[1] === 'list' && stripped.length === 2)
    return { command: 'issues list', json, verbose: false };
  if (stripped[0] === 'doctor' && stripped.length === 1 && !json)
    return { command: 'doctor', json: false, verbose: true };
  if (['status', 'issues', 'doctor'].includes(stripped[0] ?? ''))
    throw new Error(
      'usage: sloop status [--verbose] [--json] | sloop issues list [--json] | sloop doctor',
    );
  return undefined;
}

export function emitUsageFailure(args: readonly string[], message: string): ExitCode {
  const io = productionIo();
  return emit(
    envelope(commandName(args), 'failed', 'preflight', 'Command usage is invalid.', null, [
      diagnostic('usage', message, 'Run `sloop --help` and use a documented command form.'),
    ]),
    args.includes('--json'),
    EXIT.preflight,
    io,
  );
}

export function runReadOnlyCommand(parsed: Parsed, providedIo?: RuntimeIo): ExitCode {
  const io = providedIo ?? productionIo();
  let root: string;
  let config: SloopConfig;
  let ref: string;
  try {
    root = discoverRepository(io);
    ({ config, ref } = loadBaseConfig(root, io));
  } catch (error) {
    const item = error as Diagnostic;
    return emit(
      envelope(parsed.command, 'failed', 'discovery', 'Repository startup failed.', null, [item]),
      parsed.json,
      EXIT.preflight,
      io,
    );
  }
  const failures =
    parsed.command === 'doctor'
      ? doctorChecks(root, config, io)
      : [
          ...commonChecks(root, config, io),
          ...(parsed.command === 'issues list' ? githubChecks(root, config, io) : []),
        ];
  if (failures.length)
    return emit(
      envelope(
        parsed.command,
        'failed',
        'preflight',
        'Preflight validation failed.',
        null,
        failures,
      ),
      parsed.json,
      EXIT.preflight,
      io,
    );
  if (parsed.command === 'issues list') {
    const remoteUrl = clean(
      io.run('git', ['remote', 'get-url', config.repository.remote], root).stdout,
    );
    const response = io.run(
      'gh',
      [
        'issue',
        'list',
        '--state',
        'open',
        '--label',
        config.github.labels.eligible,
        '--repo',
        githubRepository(remoteUrl),
        '--json',
        'number,title,url,labels',
      ],
      root,
    );
    if (response.status !== 0)
      return emit(
        envelope(parsed.command, 'failed', 'result', 'GitHub issue listing failed.', null, [
          diagnostic('github', 'GitHub did not return issues.', 'Check network access and retry.'),
        ]),
        parsed.json,
        EXIT.external,
        io,
      );
    try {
      const issues = JSON.parse(response.stdout) as { number: number; title: string }[];
      const value = envelope(
        parsed.command,
        issues.length ? 'completed' : 'idle',
        'result',
        issues.length ? `${issues.length} eligible issue(s).` : 'No eligible issues.',
        { repository: root, configRef: ref, issues },
        [],
        issues.map(({ number }) => number),
      );
      const humanIssues = issues.map((i) => `#${i.number} ${i.title}`).join('\n');
      if (!parsed.json && humanIssues) io.stdout(`${value.summary}\n${humanIssues}`);
      else emit(value, parsed.json, EXIT.ok, io);
      return EXIT.ok;
    } catch {
      return emit(
        envelope(parsed.command, 'failed', 'result', 'GitHub returned invalid issue data.', null, [
          diagnostic('github', 'Issue JSON could not be parsed.', 'Retry the command.'),
        ]),
        parsed.json,
        EXIT.external,
        io,
      );
    }
  }
  const stateFile = join(root, '.sloop', 'state.json');
  let workflow: Record<string, unknown> = {};
  if (parsed.command === 'status' && existsSync(stateFile)) {
    try {
      const parsedState: unknown = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (!parsedState || typeof parsedState !== 'object' || Array.isArray(parsedState))
        throw new Error('state must be a JSON object');
      workflow = parsedState as Record<string, unknown>;
    } catch {
      return emit(
        envelope(parsed.command, 'blocked', 'result', 'Workflow state is unreadable.', null, [
          diagnostic(
            'state',
            'The local workflow state is invalid JSON.',
            'Repair the state through dispatcher recovery tooling.',
          ),
        ]),
        parsed.json,
        EXIT.blocked,
        io,
      );
    }
  }
  const workflowStatus = String(workflow.status ?? 'idle');
  const status: ResultStatus =
    workflowStatus === 'blocked'
      ? 'blocked'
      : /running|pending|review|claimed/.test(workflowStatus)
        ? 'waiting'
        : 'idle';
  const value = envelope(
    parsed.command,
    parsed.command === 'status' ? status : 'completed',
    'result',
    parsed.command === 'status'
      ? workflowStatus === 'idle'
        ? `Repository ${root} is idle.`
        : `Repository ${root} workflow status is ${workflowStatus}.`
      : 'All checks passed.',
    {
      repository: root,
      configRef: ref,
      workflow: parsed.verbose
        ? workflow
        : {
            issue: workflow.issue,
            pr: workflow.pr,
            status: workflow.status,
            lastError: workflow.lastError,
          },
      ...(parsed.verbose ? { config } : {}),
    },
    [],
    typeof workflow.issue === 'number' ? [workflow.issue] : [],
    typeof workflow.pr === 'number' ? [workflow.pr] : [],
  );
  return emit(value, parsed.json, status === 'blocked' ? EXIT.blocked : EXIT.ok, io);
}

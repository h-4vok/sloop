import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
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
): ResultEnvelope => ({
  command,
  status,
  phase,
  summary,
  result,
  diagnostics,
  references: { issues, pullRequests: [] },
});

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

export function discoverRepository(io: RuntimeIo): string {
  const found = io.run('git', ['rev-parse', '--show-toplevel'], io.cwd);
  if (found.status !== 0 || !clean(found.stdout))
    throw diagnostic(
      'repository',
      'The current directory is not inside a Git repository.',
      'Change to the target repository or one of its subdirectories.',
    );
  return resolve(clean(found.stdout));
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
    return { config: loadConfigText(base.stdout), ref };
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
  const remoteUrl = clean(
    io.run('git', ['remote', 'get-url', config.repository.remote], root).stdout,
  );
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
      if (
        !['READ', 'TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'].includes(
          repository.viewerPermission ?? '',
        )
      )
        failures.push(
          diagnostic(
            'permissions',
            'Repository read permission is unavailable.',
            'Request repository read access.',
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
  const labels = io.run('gh', ['label', 'list', '--limit', '1000', '--json', 'name'], root);
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
  return failures;
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
    const response = io.run(
      'gh',
      [
        'issue',
        'list',
        '--state',
        'open',
        '--label',
        config.github.labels.eligible,
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
  const value = envelope(
    parsed.command,
    parsed.command === 'status' ? 'idle' : 'completed',
    'result',
    parsed.command === 'status'
      ? `Repository ${root} is ready; no workflow state was inspected.`
      : 'All checks passed.',
    { repository: root, configRef: ref, ...(parsed.verbose ? { config } : {}) },
  );
  return emit(value, parsed.json, EXIT.ok, io);
}

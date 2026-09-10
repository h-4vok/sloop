import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const AGENT_OUTPUT_VERSION = 'sloop.agent-output/v1' as const;
export type Role = 'worker' | 'qa' | 'staff' | 'arbiter';
export type RunStatus =
  'ready' | 'blocked' | 'accepted' | 'changes-requested' | 'uphold' | 'overrule' | 'defer';
export type RunContext = Readonly<{
  run: string;
  issue: number;
  pr?: number;
  round: number;
  sha: string;
  cursor: string;
}>;
export type HumanGuide = Readonly<{
  summary: string;
  steps: string[];
  expected: string[];
  isolation: string;
  limitations: string[];
  checklist: string[];
}>;
export type AgentEnvelope = Readonly<{
  schema: typeof AGENT_OUTPUT_VERSION;
  context: RunContext;
  producer: Role;
  status: RunStatus;
  payload: Record<string, unknown>;
}>;
export type ProcessResult = Readonly<{
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}>;
export type ProcessExecutor = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    onStdout: (s: string) => void;
    onStderr: (s: string) => void;
  },
) => Promise<ProcessResult>;

export class AgentContractError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.name = 'AgentContractError';
    this.code = code;
  }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AgentContractError('malformed', `${name} must be an object`);
  return value as Record<string, unknown>;
}
function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new AgentContractError('malformed', `${name} must be non-empty`);
  return value;
}
function context(value: unknown): RunContext {
  const c = object(value, 'context');
  const issue = c.issue as number;
  const round = c.round as number;
  if (!Number.isInteger(issue) || !Number.isInteger(round) || round < 1)
    throw new AgentContractError('wrong-context', 'invalid issue or round');
  return {
    run: nonEmpty(c.run, 'run'),
    issue,
    pr: c.pr as number | undefined,
    round,
    sha: nonEmpty(c.sha, 'sha'),
    cursor: nonEmpty(c.cursor, 'cursor'),
  };
}
export function validateAgentEnvelope(value: unknown, expected?: RunContext): AgentEnvelope {
  const e = object(value, 'envelope');
  if (e.schema !== AGENT_OUTPUT_VERSION) throw new AgentContractError('unknown-version');
  const c = context(e.context);
  if (
    expected &&
    (c.run !== expected.run ||
      c.issue !== expected.issue ||
      c.pr !== expected.pr ||
      c.round !== expected.round ||
      c.sha !== expected.sha ||
      c.cursor !== expected.cursor)
  )
    throw new AgentContractError('wrong-context');
  if (!['worker', 'qa', 'staff', 'arbiter'].includes(e.producer as string))
    throw new AgentContractError('malformed', 'invalid producer');
  if (
    typeof e.status !== 'string' ||
    !['ready', 'blocked', 'accepted', 'changes-requested', 'uphold', 'overrule', 'defer'].includes(
      e.status,
    )
  )
    throw new AgentContractError('malformed', 'invalid status');
  const payload = object(e.payload, 'payload');
  if (e.producer === 'worker') {
    if (!['ready', 'blocked'].includes(e.status as string))
      throw new AgentContractError('contradictory');
    const guide = object(payload.guide, 'guide');
    for (const k of ['summary', 'isolation']) nonEmpty(guide[k], `guide.${k}`);
    for (const k of ['steps', 'expected', 'limitations', 'checklist'])
      if (
        !Array.isArray(guide[k]) ||
        !(guide[k] as unknown[]).length ||
        (guide[k] as unknown[]).some((x) => typeof x !== 'string' || !x.trim())
      )
        throw new AgentContractError('malformed', `guide.${k} must be non-empty`);
  }
  return {
    schema: AGENT_OUTPUT_VERSION,
    context: c,
    producer: e.producer as Role,
    status: e.status as RunStatus,
    payload,
  };
}

const defaultExec: ProcessExecutor = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, shell: false });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => child.kill(), options.timeoutMs);
    child.stdout.on('data', (b) => {
      const s = String(b);
      stdout += s;
      options.onStdout(s);
    });
    child.stderr.on('data', (b) => {
      const s = String(b);
      stderr += s;
      options.onStderr(s);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, signal });
    });
  });
export type RunnerOptions = Readonly<{
  cwd: string;
  timeoutMs?: number;
  retries?: number;
  execute?: ProcessExecutor;
  log?: (source: 'stdout' | 'stderr', chunk: string) => void;
}>;

export interface AgentRunner {
  run(input: string, context: RunContext): Promise<AgentEnvelope>;
}
export class ArbitraryCommandRunner implements AgentRunner {
  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
    private readonly options: RunnerOptions,
  ) {}
  async run(input: string, context: RunContext): Promise<AgentEnvelope> {
    const dir = await mkdtemp(join(tmpdir(), 'sloop-agent-'));
    const inputPath = join(dir, 'input.json');
    const outputPath = join(dir, 'output.json');
    const schemaPath = join(dir, 'schema.json');
    await writeFile(inputPath, input);
    await writeFile(schemaPath, JSON.stringify({ $id: AGENT_OUTPUT_VERSION }));
    const env = {
      ...process.env,
      SLOOP_AGENT_INPUT: inputPath,
      SLOOP_AGENT_OUTPUT: outputPath,
      SLOOP_AGENT_SCHEMA: schemaPath,
      SLOOP_AGENT_RUN: context.run,
      SLOOP_AGENT_ISSUE: String(context.issue),
      SLOOP_AGENT_PR: context.pr === undefined ? '' : String(context.pr),
      SLOOP_AGENT_ROUND: String(context.round),
      SLOOP_AGENT_SHA: context.sha,
      SLOOP_AGENT_CONTEXT_CURSOR: context.cursor,
    };
    let last: unknown;
    for (let attempt = 0; attempt <= (this.options.retries ?? 0); attempt++) {
      const args = this.args.map((arg) =>
        arg
          .replaceAll('$SLOOP_AGENT_INPUT', inputPath)
          .replaceAll('$SLOOP_AGENT_OUTPUT', outputPath)
          .replaceAll('$SLOOP_AGENT_SCHEMA', schemaPath),
      );
      const r = await (this.options.execute ?? defaultExec)(this.command, args, {
        cwd: this.options.cwd,
        env,
        timeoutMs: this.options.timeoutMs ?? 120000,
        onStdout: (s) => this.options.log?.('stdout', s),
        onStderr: (s) => this.options.log?.('stderr', s),
      });
      if (r.code !== 0 || r.signal)
        last = new AgentContractError('operational-failure', r.stderr || 'runner failed');
      else {
        try {
          const raw = JSON.parse(await readFile(outputPath, 'utf8'));
          return validateAgentEnvelope(raw, context);
        } catch (error) {
          last = error;
        }
      }
    }
    throw last instanceof Error ? last : new AgentContractError('missing-result');
  }
}

export class CodexAgentRunner extends ArbitraryCommandRunner {
  constructor(
    options: RunnerOptions & {
      model?: string;
      reasoningEffort?: string;
      sandbox?: 'read-only' | 'workspace-write';
    },
  ) {
    const args = [
      'exec',
      '--cd',
      options.cwd,
      '--sandbox',
      options.sandbox ?? 'workspace-write',
      '--output-schema',
      '$SLOOP_AGENT_SCHEMA',
      '--output-last-message',
      '$SLOOP_AGENT_OUTPUT',
    ];
    if (options.model) args.push('--model', options.model);
    if (options.reasoningEffort)
      args.push('--config', `model_reasoning_effort=${options.reasoningEffort}`);
    super('codex', args, options);
  }
}

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
  optional: readonly string[] = [],
) {
  for (const key of keys)
    if (!(key in value) && !optional.includes(key))
      throw new AgentContractError('malformed', `${name}.${key} is required`);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new AgentContractError('malformed', `${name}.${key} is unknown`);
}
function strings(value: unknown, name: string) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((x) => typeof x !== 'string' || !x.trim())
  )
    throw new AgentContractError('malformed', `${name} must be non-empty strings`);
}
function records(value: unknown, name: string) {
  if (!Array.isArray(value) || value.some((x) => !x || typeof x !== 'object' || Array.isArray(x)))
    throw new AgentContractError('malformed', `${name} must be objects`);
}
function requiredRecordFields(value: unknown, name: string, fields: readonly string[]) {
  records(value, name);
  for (const [i, item] of (value as Record<string, unknown>[]).entries()) {
    exactKeys(item, fields, `${name}[${i}]`);
    for (const field of fields) nonEmpty(item[field], `${name}[${i}].${field}`);
  }
}
function context(value: unknown): RunContext {
  const c = object(value, 'context');
  exactKeys(c, ['run', 'issue', 'pr', 'round', 'sha', 'cursor'], 'context', ['pr']);
  const issue = c.issue as number;
  const round = c.round as number;
  if (!Number.isInteger(issue) || !Number.isInteger(round) || round < 1)
    throw new AgentContractError('wrong-context', 'invalid issue or round');
  if (c.pr !== undefined && (!Number.isSafeInteger(c.pr) || (c.pr as number) < 1))
    throw new AgentContractError('wrong-context');
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
  exactKeys(e, ['schema', 'context', 'producer', 'status', 'payload'], 'envelope');
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
    exactKeys(payload, ['summary', 'findingResolutions', 'verification', 'guide'], 'payload');
    nonEmpty(payload.summary, 'summary');
    requiredRecordFields(payload.findingResolutions, 'findingResolutions', [
      'id',
      'status',
      'summary',
    ]);
    strings(payload.verification, 'verification');
    const guide = object(payload.guide, 'guide');
    exactKeys(
      guide,
      ['summary', 'steps', 'expected', 'isolation', 'limitations', 'checklist'],
      'guide',
    );
    for (const k of ['summary', 'isolation']) nonEmpty(guide[k], `guide.${k}`);
    for (const k of ['steps', 'expected', 'limitations', 'checklist'])
      if (
        !Array.isArray(guide[k]) ||
        !(guide[k] as unknown[]).length ||
        (guide[k] as unknown[]).some((x) => typeof x !== 'string' || !x.trim())
      )
        throw new AgentContractError('malformed', `guide.${k} must be non-empty`);
  } else if (e.producer === 'qa' || e.producer === 'staff') {
    if (!['accepted', 'changes-requested', 'blocked'].includes(e.status as string))
      throw new AgentContractError('contradictory');
    exactKeys(payload, ['summary', 'evidence', 'newFindings', 'dispositions'], 'payload');
    nonEmpty(payload.summary, 'summary');
    strings(payload.evidence, 'evidence');
    requiredRecordFields(payload.newFindings, 'newFindings', ['id', 'summary', 'severity']);
    requiredRecordFields(payload.dispositions, 'dispositions', ['id', 'status', 'summary']);
    const findingIds = new Set(
      (payload.newFindings as Record<string, unknown>[]).map((finding) => finding.id),
    );
    for (const disposition of payload.dispositions as Record<string, unknown>[]) {
      if (!findingIds.has(disposition.id))
        throw new AgentContractError('malformed', 'disposition must reference a finding');
    }
  } else {
    if (!['uphold', 'overrule', 'defer'].includes(e.status as string))
      throw new AgentContractError('contradictory');
    exactKeys(payload, ['rationale', 'references'], 'payload');
    nonEmpty(payload.rationale, 'rationale');
    strings(payload.references, 'references');
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
  /** Durable boundary owned by the dispatcher; enables recovery reconciliation. */
  reconciliationDir?: string;
  /** Test seam for the final compare-and-create durable result write. */
  writeReconciliation?: typeof writeFile;
}>;

export interface AgentRunner {
  run(input: string, context: RunContext): Promise<AgentEnvelope>;
}
export class ArbitraryCommandRunner implements AgentRunner {
  private readonly reconciled = new Map<string, AgentEnvelope>();
  constructor(
    private readonly command: string,
    protected readonly args: readonly string[],
    private readonly options: RunnerOptions,
  ) {}
  async run(input: string, context: RunContext): Promise<AgentEnvelope> {
    const invocationKey = JSON.stringify([input, context]);
    const existing = this.reconciled.get(invocationKey);
    if (existing) return existing;
    const persistedPath = this.options.reconciliationDir
      ? join(
          this.options.reconciliationDir,
          `${createHash('sha256').update(invocationKey).digest('hex')}.json`,
        )
      : undefined;
    if (persistedPath) {
      try {
        const result = validateAgentEnvelope(
          JSON.parse(await readFile(persistedPath, 'utf8')),
          context,
        );
        this.reconciled.set(invocationKey, result);
        return result;
      } catch {
        // A missing or invalid persisted result is not a reconciliation hit.
      }
    }
    const dir = await mkdtemp(join(tmpdir(), 'sloop-agent-'));
    const inputPath = join(dir, 'input.json');
    const outputPath = join(dir, 'output.json');
    const schemaPath = join(dir, 'schema.json');
    await writeFile(inputPath, input);
    const schemaRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'schemas');
    const envelope = JSON.parse(
      await readFile(join(schemaRoot, 'sloop.agent-output.v1.json'), 'utf8'),
    ) as Record<string, unknown>;
    const defs = envelope.$defs as Record<string, Record<string, unknown>>;
    const roles = [
      ['workerEnvelope', 'worker.v1.json'],
      ['reviewerEnvelope', 'reviewer.v1.json'],
      ['arbiterEnvelope', 'arbiter.v1.json'],
    ] as const;
    for (const [, file] of roles) {
      const roleSchema = JSON.parse(await readFile(join(schemaRoot, file), 'utf8')) as Record<
        string,
        unknown
      >;
      defs[file.slice(0, -8)] = roleSchema;
    }
    await writeFile(schemaPath, JSON.stringify(envelope));
    // The declared schema is a resolvable contract: keep its canonical $refs beside it.
    for (const [, file] of roles) {
      await writeFile(join(dir, file), await readFile(join(schemaRoot, file), 'utf8'));
    }
    if (persistedPath) await mkdir(this.options.reconciliationDir!, { recursive: true });
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
      await rm(outputPath, { force: true });
      const args = this.args.map(
        (arg) =>
          arg
            // Replace the content token first: it shares a prefix with
            // SLOOP_AGENT_INPUT and must remain a distinct argv value.
            .replaceAll('$SLOOP_AGENT_INPUT_CONTENT', input)
            .replaceAll('$SLOOP_AGENT_INPUT', inputPath)
            .replaceAll('$SLOOP_AGENT_OUTPUT', outputPath)
            .replaceAll('$SLOOP_AGENT_SCHEMA', schemaPath),
        // The Codex adapter uses this as its positional prompt; arbitrary
        // adapters can consume the file paths through the environment.
      );
      let r: ProcessResult;
      try {
        r = await (this.options.execute ?? defaultExec)(this.command, args, {
          cwd: this.options.cwd,
          env,
          timeoutMs: this.options.timeoutMs ?? 120000,
          onStdout: (s) => this.options.log?.('stdout', s),
          onStderr: (s) => this.options.log?.('stderr', s),
        });
      } catch (error) {
        // Process launch failures (for example, a missing executable) are
        // operational failures too and must use the same bounded retry path.
        last = new AgentContractError(
          'operational-failure',
          error instanceof Error ? error.message : 'runner launch failed',
        );
        continue;
      }
      if (r.code !== 0 || r.signal)
        last = new AgentContractError('operational-failure', r.stderr || 'runner failed');
      else {
        try {
          const text = await readFile(outputPath, 'utf8');
          if (!text.trim()) throw new AgentContractError('missing-result');
          // JSON.parse rejects truncated/multiple documents; the contract also forbids
          // duplicate object members because they make the durable result ambiguous.
          const duplicate = /([{,])\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*[^,}]+\s*,\s*"\2"\s*:/.test(
            text,
          );
          if (duplicate) throw new AgentContractError('malformed', 'duplicate JSON member');
          const raw = JSON.parse(text);
          const result = validateAgentEnvelope(raw, context);
          this.reconciled.set(invocationKey, result);
          if (persistedPath)
            await (this.options.writeReconciliation ?? writeFile)(
              persistedPath,
              JSON.stringify(result),
              { flag: 'wx' },
            ).catch(async (error: NodeJS.ErrnoException) => {
              if (error.code !== 'EEXIST') throw error;
            });
          return result;
        } catch (error) {
          last =
            error instanceof AgentContractError
              ? error
              : error instanceof SyntaxError
                ? new AgentContractError('malformed', 'invalid JSON result')
                : (error as NodeJS.ErrnoException)?.code === 'ENOENT'
                  ? new AgentContractError('missing-result')
                  : new AgentContractError('malformed', 'unable to read result');
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
      '$SLOOP_AGENT_INPUT_CONTENT',
    ];
    if (options.model) args.push('--model', options.model);
    if (options.reasoningEffort)
      args.push('--config', `model_reasoning_effort=${options.reasoningEffort}`);
    super('codex', args, options);
  }
}

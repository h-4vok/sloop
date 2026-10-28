import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { codexCliInvocation } from '../../codex-cli.js';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_OUTPUT_VERSION = 'sloop.agent-output/v1' as const;
export type Role = 'worker' | 'qa' | 'staff' | 'arbiter';
export type RunStatus =
  | 'ready'
  | 'blocked'
  | 'accepted'
  | 'changes-requested'
  | 'uphold'
  | 'overrule'
  | 'defer'
  | 'escalate';
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
const contextFields = ['run', 'issue', 'pr', 'round', 'sha', 'cursor'] as const;
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
    stdin?: string;
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
  if (!Number.isInteger(issue) || issue < 1 || !Number.isInteger(round) || round < 1)
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
const agentEnvelopeValidator = Object.freeze({
  validate(value: unknown, expected?: RunContext): AgentEnvelope {
    const envelope = object(value, 'envelope');
    exactKeys(envelope, ['schema', 'context', 'producer', 'status', 'payload'], 'envelope');

    if (envelope.schema !== AGENT_OUTPUT_VERSION) {
      throw new AgentContractError('unknown-version');
    }

    const runContext = context(envelope.context);
    this.validateExpectedContext(runContext, expected);
    this.validateProducerAndStatus(envelope.producer, envelope.status);

    const payload = object(envelope.payload, 'payload');
    this.validatePayload(envelope.producer, envelope.status, payload);

    return {
      schema: AGENT_OUTPUT_VERSION,
      context: runContext,
      producer: envelope.producer as Role,
      status: envelope.status as RunStatus,
      payload,
    };
  },

  validateExpectedContext(actual: RunContext, expected?: RunContext): void {
    if (expected && !contextFields.every((field) => actual[field] === expected[field])) {
      throw new AgentContractError('wrong-context');
    }
  },

  validateProducerAndStatus(producer: unknown, status: unknown): void {
    if (!['worker', 'qa', 'staff', 'arbiter'].includes(producer as string)) {
      throw new AgentContractError('malformed', 'invalid producer');
    }

    const validStatuses = [
      'ready',
      'blocked',
      'accepted',
      'changes-requested',
      'uphold',
      'overrule',
      'defer',
      'escalate',
    ];
    if (typeof status !== 'string' || !validStatuses.includes(status)) {
      throw new AgentContractError('malformed', 'invalid status');
    }
  },

  validatePayload(producer: unknown, status: unknown, payload: Record<string, unknown>): void {
    if (producer === 'worker') {
      this.validateWorkerPayload(status, payload);
    } else if (producer === 'qa' || producer === 'staff') {
      this.validateReviewPayload(status, payload);
    } else {
      this.validateArbiterPayload(status, payload);
    }
  },

  validateWorkerPayload(status: unknown, payload: Record<string, unknown>): void {
    if (!['ready', 'blocked'].includes(status as string)) {
      throw new AgentContractError('contradictory');
    }

    exactKeys(payload, ['summary', 'findingResolutions', 'verification', 'guide'], 'payload');
    nonEmpty(payload.summary, 'summary');
    requiredRecordFields(payload.findingResolutions, 'findingResolutions', [
      'id',
      'status',
      'summary',
    ]);
    strings(payload.verification, 'verification');

    this.validateGuide(payload.guide);
  },

  validateGuide(value: unknown): void {
    const guide = object(value, 'guide');
    exactKeys(
      guide,
      ['summary', 'steps', 'expected', 'isolation', 'limitations', 'checklist'],
      'guide',
    );
    this.validateGuideText(guide);
    this.validateGuideLists(guide);
  },

  validateGuideText(guide: Record<string, unknown>): void {
    for (const field of ['summary', 'isolation']) nonEmpty(guide[field], 'guide.' + field);
  },

  validateGuideLists(guide: Record<string, unknown>): void {
    for (const field of ['steps', 'expected', 'limitations', 'checklist']) {
      if (!this.hasNonEmptyStrings(guide[field])) {
        throw new AgentContractError('malformed', 'guide.' + field + ' must be non-empty');
      }
    }
  },

  hasNonEmptyStrings(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'string' && Boolean(item.trim()))
    );
  },

  validateReviewPayload(status: unknown, payload: Record<string, unknown>): void {
    if (!['accepted', 'changes-requested', 'blocked'].includes(status as string)) {
      throw new AgentContractError('contradictory');
    }

    exactKeys(payload, ['summary', 'evidence', 'newFindings', 'dispositions'], 'payload');
    nonEmpty(payload.summary, 'summary');
    strings(payload.evidence, 'evidence');
    requiredRecordFields(payload.newFindings, 'newFindings', ['id', 'summary', 'severity']);
    requiredRecordFields(payload.dispositions, 'dispositions', ['id', 'status', 'summary']);

    const findingIds = new Set(
      (payload.newFindings as Record<string, unknown>[]).map((finding) => finding.id),
    );
    for (const disposition of payload.dispositions as Record<string, unknown>[]) {
      if (!findingIds.has(disposition.id)) {
        throw new AgentContractError('malformed', 'disposition must reference a finding');
      }
    }
  },

  validateArbiterPayload(status: unknown, payload: Record<string, unknown>): void {
    if (!['uphold', 'overrule', 'defer', 'escalate'].includes(status as string)) {
      throw new AgentContractError('contradictory');
    }

    exactKeys(payload, ['rationale', 'references', 'decisions'], 'payload');
    nonEmpty(payload.rationale, 'rationale');
    strings(payload.references, 'references');
    records(payload.decisions, 'decisions');
    if (!(payload.decisions as unknown[]).length) {
      throw new AgentContractError('malformed', 'decisions must be non-empty');
    }
  },
});

export function validateAgentEnvelope(value: unknown, expected?: RunContext): AgentEnvelope {
  return agentEnvelopeValidator.validate(value, expected);
}

const defaultExec: ProcessExecutor = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (!child.stdout || !child.stderr || (options.stdin !== undefined && !child.stdin)) {
      child.kill();
      return reject(new Error('Codex process streams were not created'));
    }
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
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
type PreparedAgentRun = Readonly<{
  outputPath: string;
  environment: NodeJS.ProcessEnv;
  persistedPath?: string;
}>;

export class ArbitraryCommandRunner implements AgentRunner {
  private readonly reconciled = new Map<string, AgentEnvelope>();

  constructor(
    private readonly command: string,
    protected readonly args: readonly string[],
    private readonly options: RunnerOptions,
  ) {}

  async run(input: string, context: RunContext): Promise<AgentEnvelope> {
    const invocationKey = JSON.stringify([input, context]);
    const cached = this.reconciled.get(invocationKey);
    if (cached) return cached;

    const persistedPath = this.getPersistedPath(invocationKey);
    const persistedResult = await this.readPersistedResult(persistedPath, invocationKey, context);
    if (persistedResult) return persistedResult;

    const preparedRun = await this.prepareAgentRun(input, context, persistedPath);
    return this.runWithRetries(input, context, invocationKey, preparedRun);
  }

  private getPersistedPath(invocationKey: string): string | undefined {
    if (!this.options.reconciliationDir) return undefined;

    const filename = createHash('sha256').update(invocationKey).digest('hex') + '.json';
    return join(this.options.reconciliationDir, filename);
  }

  private async readPersistedResult(
    persistedPath: string | undefined,
    invocationKey: string,
    context: RunContext,
  ): Promise<AgentEnvelope | undefined> {
    if (!persistedPath) return undefined;

    try {
      const text = await readFile(persistedPath, 'utf8');
      const result = validateAgentEnvelope(JSON.parse(text), context);
      this.reconciled.set(invocationKey, result);
      return result;
    } catch {
      // A missing or invalid persisted result is not a reconciliation hit.
      return undefined;
    }
  }

  private async prepareAgentRun(
    input: string,
    context: RunContext,
    persistedPath: string | undefined,
  ): Promise<PreparedAgentRun> {
    const directory = await mkdtemp(join(tmpdir(), 'sloop-agent-'));
    const inputPath = join(directory, 'input.json');
    const outputPath = join(directory, 'output.json');
    const schemaPath = join(directory, 'schema.json');
    await writeFile(inputPath, input);
    await this.writeSchemaFiles(directory, schemaPath);

    if (persistedPath) {
      await mkdir(this.options.reconciliationDir!, { recursive: true });
    }

    return {
      outputPath,
      environment: this.createAgentEnvironment(inputPath, outputPath, schemaPath, context),
      persistedPath,
    };
  }

  private async writeSchemaFiles(directory: string, schemaPath: string): Promise<void> {
    const schemaRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'assets',
      'schemas',
    );
    const envelope = JSON.parse(
      await readFile(join(schemaRoot, 'sloop.agent-output.v1.json'), 'utf8'),
    ) as Record<string, unknown>;
    const definitions = envelope.$defs as Record<string, Record<string, unknown>>;
    const roleSchemas = [
      ['workerEnvelope', 'worker.v1.json'],
      ['reviewerEnvelope', 'reviewer.v1.json'],
      ['arbiterEnvelope', 'arbiter.v1.json'],
    ] as const;

    for (const [, filename] of roleSchemas) {
      const roleSchema = JSON.parse(await readFile(join(schemaRoot, filename), 'utf8')) as Record<
        string,
        unknown
      >;
      definitions[filename.slice(0, -8)] = roleSchema;
    }

    await writeFile(schemaPath, JSON.stringify(envelope));

    // Keep the declared schema's canonical references beside it for resolution.
    for (const [, filename] of roleSchemas) {
      await writeFile(
        join(directory, filename),
        await readFile(join(schemaRoot, filename), 'utf8'),
      );
    }
  }

  private createAgentEnvironment(
    inputPath: string,
    outputPath: string,
    schemaPath: string,
    context: RunContext,
  ): NodeJS.ProcessEnv {
    return {
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
  }

  private async runWithRetries(
    input: string,
    context: RunContext,
    invocationKey: string,
    preparedRun: PreparedAgentRun,
  ): Promise<AgentEnvelope> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= (this.options.retries ?? 0); attempt++) {
      await rm(preparedRun.outputPath, { force: true });

      try {
        return await this.runAttempt(input, context, invocationKey, preparedRun);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new AgentContractError('missing-result');
  }

  private async runAttempt(
    input: string,
    context: RunContext,
    invocationKey: string,
    preparedRun: PreparedAgentRun,
  ): Promise<AgentEnvelope> {
    const args = this.expandArguments(input, preparedRun.environment);
    const result = await this.executeAgent(args, preparedRun.environment);
    if (result.code !== 0 || result.signal) {
      throw new AgentContractError('operational-failure', result.stderr || 'runner failed');
    }

    return this.readAgentResult(preparedRun, invocationKey, context);
  }

  private expandArguments(input: string, environment: NodeJS.ProcessEnv): string[] {
    const inputPath = environment.SLOOP_AGENT_INPUT!;
    const outputPath = environment.SLOOP_AGENT_OUTPUT!;
    const schemaPath = environment.SLOOP_AGENT_SCHEMA!;

    return this.args.map((argument) =>
      // Replace the content token first because it shares a prefix with the input path token.
      argument
        .replaceAll('$SLOOP_AGENT_INPUT_CONTENT', input)
        .replaceAll('$SLOOP_AGENT_INPUT', inputPath)
        .replaceAll('$SLOOP_AGENT_OUTPUT', outputPath)
        .replaceAll('$SLOOP_AGENT_SCHEMA', schemaPath),
    );
  }

  private async executeAgent(
    args: string[],
    environment: NodeJS.ProcessEnv,
  ): Promise<ProcessResult> {
    try {
      return await (this.options.execute ?? defaultExec)(this.command, args, {
        cwd: this.options.cwd,
        env: environment,
        timeoutMs: this.options.timeoutMs ?? 120000,
        onStdout: (chunk) => this.options.log?.('stdout', chunk),
        onStderr: (chunk) => this.options.log?.('stderr', chunk),
      });
    } catch (error) {
      throw new AgentContractError(
        'operational-failure',
        error instanceof Error ? error.message : 'runner launch failed',
      );
    }
  }

  private async readAgentResult(
    preparedRun: PreparedAgentRun,
    invocationKey: string,
    context: RunContext,
  ): Promise<AgentEnvelope> {
    try {
      const text = await readFile(preparedRun.outputPath, 'utf8');
      if (!text.trim()) throw new AgentContractError('missing-result');
      this.assertNoDuplicateJsonMembers(text);

      const result = validateAgentEnvelope(JSON.parse(text), context);
      this.reconciled.set(invocationKey, result);
      await this.persistResult(preparedRun.persistedPath, result);
      return result;
    } catch (error) {
      throw this.toResultError(error);
    }
  }

  private assertNoDuplicateJsonMembers(text: string): void {
    // Duplicate JSON keys make the durable result ambiguous after parsing.
    const hasDuplicateMembers =
      /([{,])\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*[^,}]+\s*,\s*"\2"\s*:/.test(text);
    if (hasDuplicateMembers) throw new AgentContractError('malformed', 'duplicate JSON member');
  }

  private async persistResult(
    persistedPath: string | undefined,
    result: AgentEnvelope,
  ): Promise<void> {
    if (!persistedPath) return;

    await (this.options.writeReconciliation ?? writeFile)(persistedPath, JSON.stringify(result), {
      flag: 'wx',
    }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }

  private toResultError(error: unknown): AgentContractError {
    if (error instanceof AgentContractError) return error;
    if (error instanceof SyntaxError)
      return new AgentContractError('malformed', 'invalid JSON result');
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return new AgentContractError('missing-result');
    }

    return new AgentContractError('malformed', 'unable to read result');
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
    const execute = options.execute ?? defaultExec;
    super('codex', args, {
      ...options,
      execute: async (_command, receivedArgs, processOptions) => {
        const invocation = codexCliInvocation(receivedArgs);
        return execute(invocation.command, invocation.args, {
          ...processOptions,
          ...(invocation.stdin === undefined ? {} : { stdin: invocation.stdin }),
        });
      },
    });
  }
}

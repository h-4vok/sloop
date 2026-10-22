import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

export type HarnessRole = 'worker' | 'qa' | 'staff' | 'arbiter' | (string & {});
export type HarnessCapabilities = Readonly<{
  sessions: boolean;
}>;
export type SessionKey = Readonly<{ run: string; issue: number; role: HarnessRole }>;
export type HarnessContext = Readonly<{
  issue: number;
  role: HarnessRole;
  run: string;
  repository: string;
  issueContext: string;
  progress?: string;
  qaUpdates?: string;
}>;
export type HarnessTurn = Readonly<{ prompt: string; session?: string }>;
export type HarnessResult = Readonly<{ session?: string; accepted: boolean; output?: string }>;

export class ResumeRejectedError extends Error {
  readonly phase = 'before-turn' as const;
  constructor(message = 'saved harness session was rejected before the turn started') {
    super(message);
    this.name = 'ResumeRejectedError';
  }
}
export class ResumeAmbiguousError extends Error {
  readonly phase = 'mid-turn' as const;
  constructor(message = 'harness resume failed after the turn may have started') {
    super(message);
    this.name = 'ResumeAmbiguousError';
  }
}

export interface Harness {
  readonly capabilities: HarnessCapabilities;
  start(context: HarnessContext, turn: HarnessTurn): Promise<HarnessResult>;
  resume(context: HarnessContext, turn: HarnessTurn): Promise<HarnessResult>;
}

export type CodexHarnessOptions = Readonly<{
  cwd: string;
  model: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  reasoningEffort: string;
  timeoutMs: number;
  log?: (source: 'stdout' | 'stderr', chunk: string) => void;
  spawn?: typeof spawn;
}>;

/** The only component that knows Codex CLI syntax and its session protocol. */
export class CodexHarness implements Harness {
  readonly capabilities = { sessions: true } as const;
  constructor(private readonly options: CodexHarnessOptions) {}
  start(context: HarnessContext, turn: HarnessTurn): Promise<HarnessResult> {
    return this.invoke(context, ['exec'], turn.prompt);
  }
  resume(context: HarnessContext, turn: HarnessTurn): Promise<HarnessResult> {
    if (!turn.session) throw new ResumeRejectedError('Codex resume requires a session reference');
    return this.invoke(context, ['exec', 'resume', turn.session], turn.prompt);
  }
  private invoke(
    context: HarnessContext,
    command: string[],
    prompt: string,
  ): Promise<HarnessResult> {
    const isResume = command[1] === 'resume';
    const args = [
      ...command,
      '--json',
      ...(isResume ? [] : ['--sandbox', this.options.sandbox]),
      '--model',
      this.options.model,
      '--config',
      `model_reasoning_effort=${this.options.reasoningEffort}`,
      prompt,
    ];
    return new Promise((resolve, reject) => {
      const child = (this.options.spawn ?? spawn)('codex', args, {
        cwd: this.options.cwd,
        shell: false,
        // Codex appends piped stdin to a positional prompt and waits for EOF.
        // Ignore stdin so each invocation receives only the explicit turn prompt.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '',
        stderr = '',
        started = false,
        session: string | undefined;
      const timer = setTimeout(() => child.kill(), this.options.timeoutMs);
      child.stdout.on('data', (chunk) => {
        const text = String(chunk);
        started = true;
        stdout += text;
        this.options.log?.('stdout', text);
      });
      child.stderr.on('data', (chunk) => {
        const text = String(chunk);
        stderr += text;
        this.options.log?.('stderr', text);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const messages: string[] = [];
        for (const line of stdout.split(/\r?\n/)) {
          try {
            const value = JSON.parse(line) as Record<string, unknown>;
            if (value.type === 'thread.started' && typeof value.thread_id === 'string')
              session = value.thread_id;
            else if (typeof value.session_id === 'string') session = value.session_id;
            const item = value.item;
            if (
              value.type === 'item.completed' &&
              typeof item === 'object' &&
              item !== null &&
              (item as Record<string, unknown>).type === 'agent_message' &&
              typeof (item as Record<string, unknown>).text === 'string'
            )
              messages.push((item as Record<string, string>).text);
          } catch {}
        }
        if (code !== 0)
          return reject(
            started
              ? new ResumeAmbiguousError(stderr || 'Codex failed after starting the turn')
              : new ResumeRejectedError(stderr || 'Codex rejected the session'),
          );
        if (!session)
          return reject(
            new Error(`Codex completed without a valid session ID for issue #${context.issue}`),
          );
        resolve({
          accepted: true,
          session,
          ...(messages.length > 0 ? { output: messages.join('\n') } : {}),
        });
      });
    });
  }
}

function keyOf(key: SessionKey): string {
  if (!key.run.trim() || !Number.isSafeInteger(key.issue) || key.issue < 1 || !key.role.trim())
    throw new Error('session key requires a run, positive issue, and role');
  return `${encodeURIComponent(key.run)}\0${key.issue}\0${encodeURIComponent(key.role)}`;
}

export class SessionStore {
  private readonly entries = new Map<string, string>();
  private loaded = false;
  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      for (const [key, value] of Object.entries(raw))
        if (typeof value === 'string' && value) this.entries.set(key, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async get(key: SessionKey): Promise<string | undefined> {
    await this.load();
    return this.entries.get(keyOf(key));
  }

  async set(key: SessionKey, reference: string): Promise<void> {
    if (!reference.trim()) throw new Error('session reference must be non-empty');
    await this.load();
    this.entries.set(keyOf(key), reference);
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(Object.fromEntries(this.entries)) + '\n', {
      mode: 0o600,
    });
    await rename(temporary, this.file);
  }
}

export async function runHarnessTurn(
  harness: Harness,
  store: SessionStore,
  key: SessionKey,
  context: HarnessContext,
  prompt: string,
  warn: (message: string) => void = console.warn,
  initialPrompt = prompt,
): Promise<HarnessResult> {
  const saved = harness.capabilities.sessions ? await store.get(key) : undefined;
  if (!saved || !harness.capabilities.sessions) {
    const result = await harness.start(context, { prompt: initialPrompt });
    if (result.session && harness.capabilities.sessions) await store.set(key, result.session);
    return result;
  }
  try {
    const result = await harness.resume(context, { prompt, session: saved });
    if (result.session && result.session !== saved) await store.set(key, result.session);
    return result;
  } catch (error) {
    if (!(error instanceof ResumeRejectedError)) throw error;
    warn(`saved harness session rejected; starting a fresh session (${saved})`);
    const fullPrompt = [
      context.issueContext,
      context.repository,
      context.progress,
      context.qaUpdates,
      prompt,
    ]
      .filter(Boolean)
      .join('\n\n');
    const result = await harness.start(context, { prompt: fullPrompt });
    if (result.session && harness.capabilities.sessions) await store.set(key, result.session);
    return result;
  }
}

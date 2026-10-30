import { spawn } from 'node:child_process';
import { codexCliInvocation } from '../../../codex-cli.js';
import type {
  CodexHarnessOptions,
  Harness,
  HarnessContext,
  HarnessResult,
  HarnessTurn,
} from './HarnessContext.js';
import { ResumeAmbiguousError } from './ResumeAmbiguousError.js';
import { ResumeRejectedError } from './ResumeRejectedError.js';

/** Owns Codex CLI invocation and its JSON event protocol. */
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
    return new Promise((resolve, reject) => {
      const invocation = codexCliInvocation(buildCodexArgs(this.options, command, prompt));
      const child = (this.options.spawn ?? spawn)(invocation.command, invocation.args, {
        cwd: this.options.cwd,
        shell: false,
        stdio: [invocation.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
      if (!child.stdout || !child.stderr || (invocation.stdin !== undefined && !child.stdin)) {
        child.kill();
        reject(new Error('Codex process streams were not created'));
        return;
      }
      if (invocation.stdin !== undefined) child.stdin?.end(invocation.stdin);
      let stdout = '';
      let stderr = '';
      let started = false;
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
        try {
          resolve(readCodexResult(stdout, context.issue, code, started, stderr));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

function buildCodexArgs(options: CodexHarnessOptions, command: string[], prompt: string): string[] {
  const isResume = command[1] === 'resume';

  return [
    ...command,
    '--json',
    ...(isResume ? [] : ['--sandbox', options.sandbox]),
    '--model',
    options.model,
    '--config',
    `model_reasoning_effort=${options.reasoningEffort}`,
    prompt,
  ];
}

function readCodexResult(
  stdout: string,
  issue: number,
  code: number | null,
  started: boolean,
  stderr: string,
): HarnessResult {
  let session: string | undefined;
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) readCodexEvent(line, (id) => (session = id), messages);
  if (code !== 0)
    throw started
      ? new ResumeAmbiguousError(stderr || 'Codex failed after starting the turn')
      : new ResumeRejectedError(stderr || 'Codex rejected the session');
  if (!session) throw new Error(`Codex completed without a valid session ID for issue #${issue}`);

  return { accepted: true, session, ...(messages.length ? { output: messages.join('\n') } : {}) };
}

function readCodexEvent(
  line: string,
  setSession: (session: string) => void,
  messages: string[],
): void {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.type === 'thread.started' && typeof value.thread_id === 'string')
      setSession(value.thread_id);
    else if (typeof value.session_id === 'string') setSession(value.session_id);
    const item = value.item;
    if (
      value.type === 'item.completed' &&
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>).type === 'agent_message' &&
      typeof (item as Record<string, unknown>).text === 'string'
    )
      messages.push((item as Record<string, string>).text);
  } catch {
    // Codex may emit non-JSON diagnostic lines alongside protocol events.
  }
}

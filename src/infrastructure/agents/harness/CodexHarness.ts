import { spawn } from 'node:child_process';
import { codexCliInvocation } from '../../../codex-cli.js';
import type {
  CodexHarnessOptions,
  Harness,
  HarnessContext,
  HarnessResult,
  HarnessTurn,
} from './HarnessContext.js';
import { ResumeRejectedError } from './ResumeRejectedError.js';
import { terminateProcessTree } from '../terminateProcessTree.js';
import { readCodexResult } from './codexResultParser.js';

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
      const child = spawnCodexProcess(this.options, invocation);
      if (!hasCodexProcessStreams(child, invocation.stdin)) {
        terminateProcessTree(child);
        reject(new Error('Codex process streams were not created'));
        return;
      }
      startCodexProcess(child, invocation.stdin, this.options, context.issue, resolve, reject);
    });
  }
}

function spawnCodexProcess(
  options: CodexHarnessOptions,
  invocation: ReturnType<typeof codexCliInvocation>,
) {
  const run = options.spawn ?? spawn;
  const stdin = invocation.stdin === undefined ? 'ignore' : 'pipe';
  return run(invocation.command, invocation.args, {
    cwd: options.cwd,
    shell: false,
    stdio: [stdin, 'pipe', 'pipe'],
  });
}

function hasCodexProcessStreams(
  child: ReturnType<typeof spawn>,
  stdin: string | undefined,
): boolean {
  if (!child.stdout || !child.stderr) return false;
  return stdin === undefined || Boolean(child.stdin);
}

function startCodexProcess(
  child: ReturnType<typeof spawn>,
  stdin: string | undefined,
  options: CodexHarnessOptions,
  issue: number,
  resolve: (result: HarnessResult) => void,
  reject: (error: unknown) => void,
): void {
  if (stdin !== undefined) child.stdin?.end(stdin);
  const output = { stdout: '', stderr: '', started: false };
  const timer = setTimeout(() => terminateProcessTree(child), options.timeoutMs);
  observeCodexOutput(child, options, output);
  observeCodexCompletion(child, output, issue, timer, resolve, reject);
}

function observeCodexOutput(
  child: ReturnType<typeof spawn>,
  options: CodexHarnessOptions,
  output: { stdout: string; stderr: string; started: boolean },
): void {
  child.stdout?.on('data', (chunk) => {
    const text = String(chunk);
    output.started = true;
    output.stdout += text;
    options.log?.('stdout', text);
  });
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk);
    output.stderr += text;
    options.log?.('stderr', text);
  });
}

function observeCodexCompletion(
  child: ReturnType<typeof spawn>,
  output: { stdout: string; stderr: string; started: boolean },
  issue: number,
  timer: ReturnType<typeof setTimeout>,
  resolve: (result: HarnessResult) => void,
  reject: (error: unknown) => void,
): void {
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    try {
      resolve(readCodexResult(output.stdout, issue, code, output.started, output.stderr));
    } catch (error) {
      reject(error);
    }
  });
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

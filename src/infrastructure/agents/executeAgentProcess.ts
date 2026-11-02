import { spawn } from 'node:child_process';
import type { ProcessExecutor } from './AgentEnvelope.js';
import { terminateProcessTree } from './terminateProcessTree.js';

type ProcessOutput = { stdout: string; stderr: string; timedOut: boolean };
type ProcessCompletion = Readonly<{
  resolve: (result: {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
  }) => void;
  reject: (error: unknown) => void;
}>;

/** Spawns an agent process without a shell and captures streams until completion. */
export const executeAgentProcess: ProcessExecutor = (command, args, options) =>
  new Promise((resolve, reject) => startAgentProcess(command, args, options, { resolve, reject }));

function startAgentProcess(
  command: string,
  args: readonly string[],
  options: Parameters<ProcessExecutor>[2],
  completion: ProcessCompletion,
): void {
  const child = spawn(command, [...args], processSpawnOptions(options));
  if (!hasRequiredProcessStreams(child, options.stdin)) {
    terminateProcessTree(child);
    completion.reject(new Error('Codex process streams were not created'));
    return;
  }
  if (options.stdin !== undefined) child.stdin?.end(options.stdin);
  observeAgentProcess(child, options, completion);
}

function processSpawnOptions(options: Parameters<ProcessExecutor>[2]) {
  const input = options.stdin === undefined ? 'ignore' : 'pipe';
  return {
    cwd: options.cwd,
    env: options.env,
    shell: false as const,
    stdio: [input, 'pipe', 'pipe'] as ['ignore' | 'pipe', 'pipe', 'pipe'],
  };
}

function hasRequiredProcessStreams(
  child: ReturnType<typeof spawn>,
  stdin: string | undefined,
): boolean {
  if (!child.stdout || !child.stderr) return false;
  return stdin === undefined || Boolean(child.stdin);
}

function observeAgentProcess(
  child: ReturnType<typeof spawn>,
  options: Parameters<ProcessExecutor>[2],
  completion: ProcessCompletion,
): void {
  const output: ProcessOutput = { stdout: '', stderr: '', timedOut: false };
  const timer = setTimeout(() => {
    output.timedOut = true;
    terminateProcessTree(child);
  }, options.timeoutMs);
  child.stdout?.on('data', (chunk) => recordStdout(output, String(chunk), options.onStdout));
  child.stderr?.on('data', (chunk) => recordStderr(output, String(chunk), options.onStderr));
  child.on('error', completion.reject);
  child.on('close', (code, signal) =>
    resolveProcessResult(output, code, signal, timer, completion),
  );
}

function recordStdout(output: ProcessOutput, text: string, onStdout: (text: string) => void): void {
  output.stdout += text;
  onStdout(text);
}

function recordStderr(output: ProcessOutput, text: string, onStderr: (text: string) => void): void {
  output.stderr += text;
  onStderr(text);
}

function resolveProcessResult(
  output: ProcessOutput,
  code: number | null,
  signal: NodeJS.Signals | null,
  timer: ReturnType<typeof setTimeout>,
  completion: ProcessCompletion,
): void {
  clearTimeout(timer);
  if (output.timedOut) {
    completion.reject(new Error('runner timed out'));
    return;
  }
  completion.resolve({ stdout: output.stdout, stderr: output.stderr, code, signal });
}

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { childProcessInvocation, resolveExecutable } from '../../process.js';
import type { ArbiterRole } from '../session/EngineeringSession.js';

export type ProcessSpec = {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  role: ArbiterRole;
  issue: number;
  sessionId: string;
  round: number;
  logDirectory: string;
  env?: NodeJS.ProcessEnv;
  redactions?: readonly string[];
  input?: string;
  onStdoutLine?: (line: string) => void;
  onStderr?: (text: string) => void;
};
export type LoggedProcessResult = Readonly<{
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  logFile: string;
}>;

/** Run a configured Arbiter process and persist redacted stream records. */
export async function runLoggedProcess(spec: ProcessSpec): Promise<LoggedProcessResult> {
  mkdirSync(spec.logDirectory, { recursive: true });
  const logFile = join(
    spec.logDirectory,
    `${spec.sessionId}-${spec.role}-${spec.round}-${Date.now()}.jsonl`,
  );
  const write = createLogWriter(spec, logFile);
  const launch = childProcessInvocation(resolveExecutable(spec.command), spec.args);
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: spec.cwd,
      windowsHide: true,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    const state = {
      stdout: '',
      stderr: '',
      pendingLine: '',
      timedOut: false,
      launchError: undefined as Error | undefined,
    };
    const timer = setTimeout(() => {
      state.timedOut = true;
      child.kill();
    }, spec.timeoutMs);
    child.stdout.on('data', (chunk) => receiveStdout(chunk.toString(), spec, write, state));
    child.stderr.on('data', (chunk) => receiveStderr(chunk.toString(), spec, write, state));
    child.on('error', (error) => {
      clearTimeout(timer);
      state.launchError = error;
      write('stderr', `process_error=${error.message}`);
    });
    child.stdin.end(spec.input);
    child.on('close', (code) =>
      closeProcess(code, spec, write, timer, state, logFile, resolve, reject),
    );
  });
}

function createLogWriter(spec: ProcessSpec, logFile: string) {
  return (stream: 'stdout' | 'stderr', data: string) => {
    const redacted = (spec.redactions ?? []).reduce(
      (text, secret) => (secret ? text.split(secret).join('[REDACTED]') : text),
      data,
    );
    appendFileSync(
      logFile,
      `${JSON.stringify({
        sessionId: spec.sessionId,
        issue: spec.issue,
        role: spec.role,
        round: spec.round,
        stream,
        at: new Date().toISOString(),
        data: redacted,
      })}\n`,
    );
  };
}

function receiveStdout(
  text: string,
  spec: ProcessSpec,
  write: (stream: 'stdout' | 'stderr', text: string) => void,
  state: { stdout: string; pendingLine: string },
) {
  state.stdout += text;
  write('stdout', text);
  if (!spec.onStdoutLine) return;
  const lines = `${state.pendingLine}${text}`.split(/\r?\n/);
  state.pendingLine = lines.pop() ?? '';
  lines.filter((line) => line.trim()).forEach(spec.onStdoutLine);
}

function receiveStderr(
  text: string,
  spec: ProcessSpec,
  write: (stream: 'stdout' | 'stderr', text: string) => void,
  state: { stderr: string },
) {
  state.stderr += text;
  write('stderr', text);
  spec.onStderr?.(text);
}

function closeProcess(
  code: number | null,
  spec: ProcessSpec,
  write: (stream: 'stdout' | 'stderr', text: string) => void,
  timer: NodeJS.Timeout,
  state: {
    stdout: string;
    stderr: string;
    pendingLine: string;
    timedOut: boolean;
    launchError?: Error;
  },
  logFile: string,
  resolve: (value: LoggedProcessResult) => void,
  reject: (error: Error) => void,
) {
  clearTimeout(timer);
  if (state.pendingLine.trim()) spec.onStdoutLine?.(state.pendingLine);
  write('stderr', `process_exit code=${code ?? 'null'} timedOut=${state.timedOut}`);
  if (state.launchError) reject(state.launchError);
  else
    resolve({
      stdout: state.stdout,
      stderr: state.stderr,
      code,
      timedOut: state.timedOut,
      logFile,
    });
}

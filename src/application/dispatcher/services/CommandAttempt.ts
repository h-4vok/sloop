import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Spec } from '../types/index.js';
import { childProcessInvocation } from '../../../process.js';

type CommandAttemptResult = { exitCode: number | null; stdout: string; stderr: string };
type CommandLaunch = ReturnType<typeof childProcessInvocation>;

function attachOutputHandlers(
  child: ChildProcessWithoutNullStreams,
  spec: Spec,
): { stdout: string; stderr: string; heartbeat: () => void } {
  const output = { stdout: '', stderr: '', heartbeat: () => spec.onHeartbeat?.() };
  const heartbeat = () => spec.onHeartbeat?.();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    heartbeat();
    const text = chunk.toString();
    output.stdout += text;
    spec.onStdout?.(text);
    process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    heartbeat();
    const text = chunk.toString();
    output.stderr += text;
    spec.onStderr?.(text);
    process.stderr.write(text);
  });

  return output;
}

function createCommandChild(
  spec: Spec,
  cwd: string,
  launch: CommandLaunch,
): ChildProcessWithoutNullStreams {
  return spawn(launch.command, launch.args, {
    cwd,
    windowsHide: true,
    env: spec.env ? { ...process.env, ...spec.env } : process.env,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
  });
}

function runCommandAttempt(
  spec: Spec,
  cwd: string,
  launch: CommandLaunch,
  attemptNumber: number,
): Promise<CommandAttemptResult> {
  return new Promise((resolve, reject) => {
    console.error(
      ...(spec.logInvocation === false
        ? []
        : [
            `[sloop] ejecutando (${attemptNumber}/${spec.retries + 1}): ${spec.command} ${spec.args.join(' ')}`,
          ]),
    );
    const child = createCommandChild(spec, cwd, launch);
    spec.onStart?.(child.pid ?? -1);
    const output = attachOutputHandlers(child, spec);
    output.heartbeat();
    if (spec.input) child.stdin.write(spec.input);
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), spec.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`${spec.command} failed: ${error.message}`));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout: output.stdout, stderr: output.stderr });
    });
  });
}

export const CommandAttempt = { runCommandAttempt };

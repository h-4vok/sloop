import type { Spec } from '../types/index.js';
import { childProcessInvocation, resolveExecutable } from '../../../process.js';
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;
import { CommandAttempt } from './CommandAttempt.js';
const { runCommandAttempt } = CommandAttempt;

function createAttemptDiagnostic(
  attemptNumber: number,
  exitCode: number | null,
  stdout: string,
  stderr: string,
): string {
  return [
    `attempt ${attemptNumber}: exit ${exitCode}`,
    stdout ? `stdout:\n${stdout}` : '',
    stderr ? `stderr:\n${stderr}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function runCommand(spec: Spec | undefined, cwd = defaultRoot): Promise<string> {
  if (!spec) return '';
  const executable = resolveExecutable(spec.command);
  const launch = childProcessInvocation(executable, spec.args);
  const diagnostics: string[] = [];
  for (let attemptNumber = 1; attemptNumber <= spec.retries + 1; attemptNumber += 1) {
    const result = await runCommandAttempt(spec, cwd, launch, attemptNumber);
    if (result.exitCode === 0) return result.stdout.trim();
    diagnostics.push(
      createAttemptDiagnostic(attemptNumber, result.exitCode, result.stdout, result.stderr),
    );
  }

  throw new Error(
    [`${spec.command} failed after ${spec.retries + 1} attempt(s)`, ...diagnostics].join('\n'),
  );
}

export const CommandRunner = { runCommand };

/** Coordinates logged process runner operations for dispatcher workflows. */
import type { Deps, Spec } from '../../../application/dispatcher/types/index.js';
import { RunLogger } from '../../../run-log.js';
import { AgentRoles } from './AgentRoles.js';
const { command } = AgentRoles;

function recordCommandResult(
  logger: RunLogger,
  spec: Spec,
  executionRoot: string,
  context: ReturnType<NonNullable<Deps['runContext']>>,
  stdout: string,
  stderr: string,
): void {
  logger.write('command-result', {
    command: spec.command,
    args: spec.args,
    cwd: executionRoot,
    ...context,
    stdout,
    stderr,
  });
}

function recordCommandFailure(
  logger: RunLogger,
  spec: Spec,
  executionRoot: string,
  context: ReturnType<NonNullable<Deps['runContext']>>,
  stdout: string,
  stderr: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  if (!stderr) logger.stream('stderr', message);
  recordCommandResult(logger, spec, executionRoot, context, stdout, stderr || message);
}

async function runLogged(d: Deps, logger: RunLogger, spec: Spec): Promise<string> {
  const context = d.runContext?.() ?? { originalRepository: d.root, executionRoot: d.root };
  let stdout = '',
    stderr = '',
    sawOutput = false;
  logger.write('command', {
    command: spec.command,
    args: spec.args,
    cwd: context.executionRoot,
    ...context,
  });
  try {
    const output = await d.run({
      ...spec,
      onStdout: (chunk) => {
        sawOutput = true;
        stdout += chunk;
        logger.stream('stdout', chunk);
        logger.stream('codex', chunk);
        spec.onStdout?.(chunk);
      },
      onStderr: (chunk) => {
        sawOutput = true;
        stderr += chunk;
        logger.stream('stderr', chunk);
        spec.onStderr?.(chunk);
      },
    });
    if (!sawOutput && output) {
      stdout = output;
      logger.stream('stdout', output);
      logger.stream('codex', output);
    }
    recordCommandResult(logger, spec, context.executionRoot, context, stdout, stderr);
    return output;
  } catch (error) {
    recordCommandFailure(logger, spec, context.executionRoot, context, stdout, stderr, error);
    throw error;
  }
}

export const LoggedProcessRunner = {
  runLogged,
};

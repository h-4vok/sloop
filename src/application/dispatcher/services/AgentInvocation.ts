/** Coordinates agent invocation operations for dispatcher workflows. */
import type { Deps, Issue, Spec } from '../../../application/dispatcher/types/index.js';
import { RunLogger } from '../../../run-log.js';
import { SessionStore, runHarnessTurn } from '../../../harness.js';
import { join } from 'node:path';
import type { Harness, HarnessContext } from '../../../harness.js';
import { randomUUID } from 'node:crypto';
import { LoggedProcessRunner } from './LoggedProcessRunner.js';
const { runLogged } = LoggedProcessRunner;

async function runRoleLogged(
  d: Deps,
  logger: RunLogger,
  role: string,
  issue: Issue,
  run: string,
  spec: Spec,
  prompt: string,
  progress = '',
  qaUpdates = '',
  initialPrompt = prompt,
): Promise<string> {
  const store = new SessionStore(join(d.root, '.sloop', 'sessions.json'));
  const context = createHarnessContext(d, role, issue, run, progress, qaUpdates);
  const defaultHarness = createDefaultHarness(d, logger, spec, context);
  const harness = d.harness?.(role, spec, context, logger) ?? defaultHarness.harness;
  const result = await runHarnessTurn(
    harness,
    store,
    { run, issue: issue.number, role },
    context,
    prompt,
    console.warn,
    initialPrompt,
  );

  return result.output ?? defaultHarness.output();
}

function createHarnessContext(
  d: Deps,
  role: string,
  issue: Issue,
  run: string,
  progress: string,
  qaUpdates: string,
): HarnessContext {
  return {
    run,

    issue: issue.number,

    role,

    repository: d.runContext?.()?.originalRepository ?? d.root,

    issueContext: `Issue #${issue.number}: ${issue.title}\n${issue.body ?? ''}`,

    progress,

    qaUpdates,
  };
}

function createDefaultHarness(
  d: Deps,
  logger: RunLogger,
  spec: Spec,
  context: HarnessContext,
): Readonly<{ harness: Harness; output: () => string }> {
  let output = '';
  const harness: Harness = {
    capabilities: { sessions: spec.sessions === true },

    start: async (_context, turn) => {
      output = await runLogged(d, logger, { ...spec, input: turn.prompt });
      return { accepted: true, session: randomUUID() };
    },

    resume: async (_context, turn) => {
      output = await runLogged(d, logger, {
        ...spec,

        input: turn.prompt,

        env: { ...spec.env, SLOOP_SESSION: turn.session },
      });
      return { accepted: true, session: turn.session };
    },
  };

  return { harness, output: () => output };
}

export const AgentInvocation = {
  runRoleLogged,
};

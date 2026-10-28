/** Coordinates agent invocation operations for dispatcher workflows. */
import type { Deps, Issue, Spec } from '../../../application/dispatcher/types/index.js';
import { RunLogger } from '../../../run-log.js';
import { SessionStore, runHarnessTurn } from '../../../harness.js';
import { join } from 'node:path';
import type { HarnessContext } from '../../../harness.js';
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
  const context: HarnessContext = {
    run,

    issue: issue.number,

    role,

    repository: d.runContext?.()?.originalRepository ?? d.root,

    issueContext: `Issue #${issue.number}: ${issue.title}\n${issue.body ?? ''}`,

    progress,

    qaUpdates,
  };
  let output = '';
  const harness = d.harness?.(role, spec, context, logger) ?? {
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
  const result = await runHarnessTurn(
    harness,
    store,
    { run, issue: issue.number, role },
    context,
    prompt,
    console.warn,
    initialPrompt,
  );
  if (result.output !== undefined) output = result.output;
  return output;
}

export const AgentInvocation = {
  runRoleLogged,
};

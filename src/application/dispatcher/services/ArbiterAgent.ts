import type { ArbiterRunContext } from '../types/ArbiterRunContext.js';
import type { AgentEnvelope } from '../../../agent-runner.js';
import { readFileSync, rmSync } from 'node:fs';
import { validateAgentEnvelope } from '../../../agent-runner.js';
import { ArbiterOutput } from './ArbiterOutput.js';
const { createStructuredArbiterOutput } = ArbiterOutput;
import { AgentInvocation } from './AgentInvocation.js';
const { runRoleLogged } = AgentInvocation;

function createArbiterPrompt(context: ArbiterRunContext, record: string): string {
  const intervention = (context.current.arbiterInterventions ?? 0) + 1;
  const allowedActions =
    intervention >= 2
      ? 'This is the second intervention: uphold is not allowed; choose overrule, defer, or escalate.'
      : 'This is the first intervention: all four actions are allowed.';

  return `Use the Arbiter contract for issue #${context.issue.number}: ${context.issue.title}. This is intervention ${intervention}. Review the complete JSON record below and return only a JSON object that conforms exactly to the Sloop agent-output schema. The envelope must have exactly these top-level keys: schema, context, producer, status, payload. Set schema to "sloop.agent-output/v1", context to exactly ${JSON.stringify(context.expectedContext)}, producer to "arbiter", and status to one of "uphold", "overrule", "defer", or "escalate". Payload must contain a non-empty rationale, a non-empty array of reference strings, and decisions. Decide every entry in openFindings exactly once, preserving its id as findingId and its owner. Each decision must contain findingId, owner, action, rationale, direction, verification, and followUp. Choose each action from the evidence: uphold requires a concrete Worker direction and verification; overrule closes a finding that is not warranted by the contract; defer requires a followUp object with non-empty title, acceptance, and context; escalate requests human review. Use null for inapplicable direction, verification, and followUp fields. Every rationale must be non-empty; explain your reasoning against the issue and review evidence. ${allowedActions} Do not add fields or use "version" in place of "schema". Record:\n${record}`;
}

function createArbiterRecord(context: ArbiterRunContext): string {
  return JSON.stringify({
    issue: context.issue,
    pr: context.evidence,
    round: context.round,
    state: context.current,
    qaFeedback: context.feedback,
    openFindings: context.findings,
  });
}

async function invokeArbiterAgent(context: ArbiterRunContext): Promise<AgentEnvelope> {
  const structured = createStructuredArbiterOutput(context.spec);
  const prompt = createArbiterPrompt(context, createArbiterRecord(context));

  try {
    const output = await runRoleLogged(
      context.deps,
      context.logger,
      'arbiter',
      context.issue,
      context.current.workerRunId ?? `arbiter-${context.round}`,
      { ...(structured?.spec ?? context.spec) },
      prompt,
      context.feedback,
    );
    const serialized = structured ? readFileSync(structured.outputPath, 'utf8') : output.trim();

    return validateAgentEnvelope(JSON.parse(serialized), context.expectedContext);
  } finally {
    if (structured) rmSync(structured.directory, { recursive: true, force: true });
  }
}

/** Invokes Arbiter and validates its structured response against the current run. */
export const ArbiterAgent = {
  invokeArbiterAgent,
};

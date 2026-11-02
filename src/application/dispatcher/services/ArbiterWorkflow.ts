/** Coordinates Arbiter intervention for dispatcher workflows. */
import type { Config, Deps, Issue, PullRequest } from '../types/index.js';
import { ArbiterPreparation } from './review/ArbiterPreparation.js';
const { prepareArbiter } = ArbiterPreparation;
import { ArbiterAgent } from './ArbiterAgent.js';
const { invokeArbiterAgent } = ArbiterAgent;
import { ArbiterDecisionPublisher } from './ArbiterDecisionPublisher.js';
const { publishDecisions } = ArbiterDecisionPublisher;

async function invokeArbiter(
  cfg: Config,
  deps: Deps,
  issue: Issue,
  pr: number,
  round: number,
  evidence: PullRequest,
): Promise<'continue' | 'terminal' | 'not_invoked'> {
  const context = prepareArbiter(cfg, deps, issue, pr, round, evidence);
  if (!context) return 'not_invoked';
  const output = await invokeArbiterAgent(context);

  return publishDecisions(context, output.payload.decisions);
}

export const ArbiterWorkflow = {
  invokeArbiter,
};

import type { Config, Deps, Issue, PullRequest, Spec, State } from './index.js';
import type { ArbiterFinding } from '../../../arbiter-contracts.js';
import type { RunContext } from '../../../infrastructure/agents/AgentEnvelope.js';
import type { RunLogger } from '../../../run-log.js';

/** Prepared input shared by Arbiter invocation and decision publication. */
export type ArbiterRunContext = {
  cfg: Config;
  deps: Deps;
  issue: Issue;
  pr: number;
  round: number;
  evidence: PullRequest;
  current: State;
  feedback: string;
  findings: ArbiterFinding[];
  logger: RunLogger;
  spec: Spec;
  expectedContext: RunContext;
};

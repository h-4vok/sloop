import { AgentContractError } from './AgentContractError.js';
import { AGENT_OUTPUT_VERSION } from './AgentEnvelope.js';
import type { AgentEnvelope, RunContext, Role, RunStatus } from './AgentEnvelope.js';
import { context, exactKeys, object } from './validateAgentFields.js';
import { validateAgentPayload } from './validateAgentPayload.js';

const contextFields = ['run', 'issue', 'pr', 'round', 'sha', 'cursor'] as const;

/** Enforces the versioned schema and optional invocation context for an envelope. */
export function validateAgentEnvelope(value: unknown, expected?: RunContext): AgentEnvelope {
  const envelope = object(value, 'envelope');
  exactKeys(envelope, ['schema', 'context', 'producer', 'status', 'payload'], 'envelope');

  if (envelope.schema !== AGENT_OUTPUT_VERSION) throw new AgentContractError('unknown-version');

  const runContext = context(envelope.context);
  if (expected && !contextFields.every((field) => runContext[field] === expected[field])) {
    throw new AgentContractError('wrong-context');
  }

  const producer = envelope.producer;
  const status = envelope.status;
  if (!['worker', 'qa', 'staff', 'arbiter'].includes(producer as string)) {
    throw new AgentContractError('malformed', 'invalid producer');
  }

  const validStatuses = [
    'ready',
    'blocked',
    'accepted',
    'changes-requested',
    'uphold',
    'overrule',
    'defer',
    'escalate',
  ];
  if (typeof status !== 'string' || !validStatuses.includes(status)) {
    throw new AgentContractError('malformed', 'invalid status');
  }

  const payload = object(envelope.payload, 'payload');
  validateAgentPayload(producer, status, payload);

  return {
    schema: AGENT_OUTPUT_VERSION,
    context: runContext,
    producer: producer as Role,
    status: status as RunStatus,
    payload,
  };
}

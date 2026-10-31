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
  const producer = envelope.producer;
  const status = envelope.status;
  validateExpectedContext(runContext, expected);
  validateProducer(producer);
  validateStatus(status);

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

function validateExpectedContext(runContext: RunContext, expected?: RunContext): void {
  if (expected && !contextFields.every((field) => runContext[field] === expected[field]))
    throw new AgentContractError('wrong-context');
}

function validateProducer(producer: unknown): asserts producer is Role {
  if (['worker', 'qa', 'staff', 'arbiter'].includes(producer as string)) return;
  throw new AgentContractError('malformed', 'invalid producer');
}

function validateStatus(status: unknown): asserts status is RunStatus {
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
  if (typeof status === 'string' && validStatuses.includes(status)) return;
  throw new AgentContractError('malformed', 'invalid status');
}

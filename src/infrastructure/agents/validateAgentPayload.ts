import { AgentContractError } from './AgentContractError.js';
import {
  exactKeys,
  nonEmpty,
  records,
  requiredRecordFields,
  strings,
  object,
} from './validateAgentFields.js';

const agentPayloadValidator = Object.freeze({
  validatePayload(producer: unknown, status: unknown, payload: Record<string, unknown>): void {
    if (producer === 'worker') {
      this.validateWorkerPayload(status, payload);
    } else if (producer === 'qa' || producer === 'staff') {
      this.validateReviewPayload(status, payload);
    } else {
      this.validateArbiterPayload(status, payload);
    }
  },

  validateWorkerPayload(status: unknown, payload: Record<string, unknown>): void {
    if (!['ready', 'blocked'].includes(status as string)) {
      throw new AgentContractError('contradictory');
    }

    exactKeys(payload, ['summary', 'findingResolutions', 'verification', 'guide'], 'payload');
    nonEmpty(payload.summary, 'summary');
    requiredRecordFields(payload.findingResolutions, 'findingResolutions', [
      'id',
      'status',
      'summary',
    ]);
    strings(payload.verification, 'verification');

    this.validateGuide(payload.guide);
  },

  validateGuide(value: unknown): void {
    const guide = object(value, 'guide');
    exactKeys(
      guide,
      ['summary', 'steps', 'expected', 'isolation', 'limitations', 'checklist'],
      'guide',
    );
    this.validateGuideText(guide);
    this.validateGuideLists(guide);
  },

  validateGuideText(guide: Record<string, unknown>): void {
    for (const field of ['summary', 'isolation']) nonEmpty(guide[field], 'guide.' + field);
  },

  validateGuideLists(guide: Record<string, unknown>): void {
    for (const field of ['steps', 'expected', 'limitations', 'checklist']) {
      if (!this.hasNonEmptyStrings(guide[field])) {
        throw new AgentContractError('malformed', 'guide.' + field + ' must be non-empty');
      }
    }
  },

  hasNonEmptyStrings(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'string' && Boolean(item.trim()))
    );
  },

  validateReviewPayload(status: unknown, payload: Record<string, unknown>): void {
    if (!['accepted', 'changes-requested', 'blocked'].includes(status as string)) {
      throw new AgentContractError('contradictory');
    }

    exactKeys(payload, ['summary', 'evidence', 'newFindings', 'dispositions'], 'payload');
    nonEmpty(payload.summary, 'summary');
    strings(payload.evidence, 'evidence');
    requiredRecordFields(payload.newFindings, 'newFindings', ['id', 'summary', 'severity']);
    requiredRecordFields(payload.dispositions, 'dispositions', ['id', 'status', 'summary']);

    const findingIds = new Set(
      (payload.newFindings as Record<string, unknown>[]).map((finding) => finding.id),
    );
    for (const disposition of payload.dispositions as Record<string, unknown>[]) {
      if (!findingIds.has(disposition.id)) {
        throw new AgentContractError('malformed', 'disposition must reference a finding');
      }
    }
  },

  validateArbiterPayload(status: unknown, payload: Record<string, unknown>): void {
    if (!['uphold', 'overrule', 'defer', 'escalate'].includes(status as string)) {
      throw new AgentContractError('contradictory');
    }

    exactKeys(payload, ['rationale', 'references', 'decisions'], 'payload');
    nonEmpty(payload.rationale, 'rationale');
    strings(payload.references, 'references');
    records(payload.decisions, 'decisions');
    if (!(payload.decisions as unknown[]).length) {
      throw new AgentContractError('malformed', 'decisions must be non-empty');
    }
  },
});

/** Applies role-specific payload rules after the envelope's common fields validate. */
export function validateAgentPayload(
  producer: unknown,
  status: unknown,
  payload: Record<string, unknown>,
): void {
  agentPayloadValidator.validatePayload(producer, status, payload);
}

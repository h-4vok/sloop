import { result, type Result } from '../core/Result.js';
import type { ArbiterAction, ArbiterDecision, ArbiterFinding } from './ArbiterDecision.js';

const actions = new Set<ArbiterAction>(['uphold', 'overrule', 'defer', 'escalate']);
const decisionFields = [
  'findingId',
  'owner',
  'action',
  'rationale',
  'direction',
  'verification',
  'followUp',
];

/** Validates one decision against the finding, action, and follow-up contract. */
export function validateArbiterDecision(
  raw: unknown,
  known: ReadonlyMap<string, ArbiterFinding>,
  seen: Set<string>,
  intervention: number,
): Result<ArbiterDecision, Error> {
  const identityResult = validateDecisionIdentity(raw, known, seen);
  if (!identityResult.ok) return identityResult;
  const decision = raw as Record<string, unknown>;
  const shape = validateDecisionShape(decision, intervention);
  if (!shape.ok) return shape;
  seen.add(identityResult.value.id);
  return result.success(createDecision(identityResult.value, decision));
}

function validateDecisionIdentity(
  raw: unknown,
  known: ReadonlyMap<string, ArbiterFinding>,
  seen: ReadonlySet<string>,
): Result<ArbiterFinding, Error> {
  if (!isRecord(raw)) return failure('malformed arbiter decision');
  if (hasUnknownDecisionField(raw)) return failure('unknown arbiter decision field');
  const finding = known.get(String(raw.findingId));
  if (!hasMatchingFindingIdentity(raw, finding, seen))
    return failure('decision must preserve finding id and owner');
  return result.success(finding);
}

function hasUnknownDecisionField(raw: Record<string, unknown>): boolean {
  return Object.keys(raw).some((key) => !decisionFields.includes(key));
}

function hasMatchingFindingIdentity(
  raw: Record<string, unknown>,
  finding: ArbiterFinding | undefined,
  seen: ReadonlySet<string>,
): finding is ArbiterFinding {
  return Boolean(finding && !seen.has(finding.id) && raw.owner === finding.owner);
}

function validateDecisionShape(
  value: Record<string, unknown>,
  intervention: number,
): Result<true, Error> {
  const actionResult = validateAction(value.action, intervention);
  if (!actionResult.ok) return actionResult;
  const rationaleResult = validateRationale(value.rationale);
  if (!rationaleResult.ok) return rationaleResult;
  const detailResult = validateOptionalDetails(value);
  if (!detailResult.ok) return detailResult;
  const actionDetailsResult = validateActionDetails(actionResult.value, value);
  if (!actionDetailsResult.ok) return actionDetailsResult;
  return validateFollowUp(value.followUp);
}

function validateActionDetails(
  action: ArbiterAction,
  value: Record<string, unknown>,
): Result<true, Error> {
  if (action === 'uphold' && !hasUpheldDetails(value))
    return failure('uphold requires direction and verification');
  if (action === 'defer' && !value.followUp) return failure('defer requires follow-up contract');
  return result.success(true);
}

function createDecision(finding: ArbiterFinding, value: Record<string, unknown>): ArbiterDecision {
  return {
    findingId: finding.id,
    owner: finding.owner,
    action: value.action as ArbiterAction,
    rationale: value.rationale as string,
    direction: optionalString(value.direction),
    verification: optionalString(value.verification),
    followUp: value.followUp == null ? undefined : (value.followUp as ArbiterDecision['followUp']),
  };
}

function validateAction(value: unknown, intervention: number): Result<ArbiterAction, Error> {
  const action = value as ArbiterAction;
  return actions.has(action) && !(intervention >= 2 && action === 'uphold')
    ? result.success(action)
    : failure('invalid action for intervention');
}

function validateRationale(value: unknown): Result<true, Error> {
  return typeof value === 'string' && value.trim()
    ? result.success(true)
    : failure('insufficient arbiter rationale');
}

function validateOptionalDetails(value: Record<string, unknown>): Result<true, Error> {
  return validOptionalText(value.direction) && validOptionalText(value.verification)
    ? result.success(true)
    : failure('invalid arbiter direction or verification');
}

function validateFollowUp(value: unknown): Result<true, Error> {
  if (value == null) return result.success(true);
  if (!isRecord(value)) return failure('invalid follow-up contract');
  const fields = ['title', 'acceptance', 'context'];
  if (Object.keys(value).some((key) => !fields.includes(key)))
    return failure('invalid follow-up contract');
  return fields.every(
    (field) => typeof value[field] === 'string' && Boolean((value[field] as string).trim()),
  )
    ? result.success(true)
    : failure('invalid follow-up contract');
}

function hasUpheldDetails(value: Record<string, unknown>): boolean {
  return (
    typeof value.direction === 'string' &&
    Boolean(value.direction.trim()) &&
    typeof value.verification === 'string' &&
    Boolean(value.verification.trim())
  );
}

function validOptionalText(value: unknown): boolean {
  return value == null || typeof value === 'string';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function failure(message: string): Result<never, Error> {
  return result.failure(new Error(message));
}

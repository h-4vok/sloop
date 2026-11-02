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

/** Validate complete Arbiter output without throwing for malformed external data. */
export function validateArbiterDecisions(
  findings: readonly ArbiterFinding[],
  decisions: unknown,
  intervention: number,
): Result<ArbiterDecision[], Error> {
  if (!Array.isArray(decisions) || decisions.length !== findings.length)
    return result.failure(new Error('arbiter must decide every finding exactly once'));
  const known = new Map(findings.map((finding) => [finding.id, finding]));
  const seen = new Set<string>();
  const validated: ArbiterDecision[] = [];
  for (const raw of decisions) {
    const decision = validateDecision(raw, known, seen, intervention);
    if (!decision.ok) return decision;
    validated.push(decision.value);
  }
  return result.success(validated);
}

function validateDecision(
  raw: unknown,
  known: ReadonlyMap<string, ArbiterFinding>,
  seen: Set<string>,
  intervention: number,
): Result<ArbiterDecision, Error> {
  if (!isRecord(raw)) return failure('malformed arbiter decision');
  if (Object.keys(raw).some((key) => !decisionFields.includes(key)))
    return failure('unknown arbiter decision field');
  const finding = known.get(String(raw.findingId));
  if (!finding || seen.has(finding.id) || raw.owner !== finding.owner)
    return failure('decision must preserve finding id and owner');
  const shape = validateDecisionShape(raw, intervention);
  if (!shape.ok) return shape;
  seen.add(finding.id);
  return result.success({
    findingId: finding.id,
    owner: finding.owner,
    action: raw.action as ArbiterAction,
    rationale: raw.rationale as string,
    direction: optionalString(raw.direction),
    verification: optionalString(raw.verification),
    followUp: raw.followUp == null ? undefined : (raw.followUp as ArbiterDecision['followUp']),
  });
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
  if (actionResult.value === 'uphold' && !hasUpheldDetails(value))
    return failure('uphold requires direction and verification');
  if (actionResult.value === 'defer' && !value.followUp)
    return failure('defer requires follow-up contract');
  return validateFollowUp(value.followUp);
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

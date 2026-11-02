import { result, type Result } from '../core/Result.js';
import type { ArbiterDecision, ArbiterFinding } from './ArbiterDecision.js';
import { validateArbiterDecision } from './validateArbiterDecision.js';

/** Validates complete Arbiter output without throwing for malformed external data. */
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
    const decision = validateArbiterDecision(raw, known, seen, intervention);
    if (!decision.ok) return decision;
    validated.push(decision.value);
  }
  return result.success(validated);
}

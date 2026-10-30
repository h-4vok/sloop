import { AgentContractError } from './AgentContractError.js';
import type { RunContext } from './AgentEnvelope.js';

const contextFields = ['run', 'issue', 'pr', 'round', 'sha', 'cursor'] as const;

export function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AgentContractError('malformed', `${name} must be an object`);
  return value as Record<string, unknown>;
}
export function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new AgentContractError('malformed', `${name} must be non-empty`);
  return value;
}
export function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
  optional: readonly string[] = [],
) {
  for (const key of keys)
    if (!(key in value) && !optional.includes(key))
      throw new AgentContractError('malformed', `${name}.${key} is required`);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new AgentContractError('malformed', `${name}.${key} is unknown`);
}
export function strings(value: unknown, name: string) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((x) => typeof x !== 'string' || !x.trim())
  )
    throw new AgentContractError('malformed', `${name} must be non-empty strings`);
}
export function records(value: unknown, name: string) {
  if (!Array.isArray(value) || value.some((x) => !x || typeof x !== 'object' || Array.isArray(x)))
    throw new AgentContractError('malformed', `${name} must be objects`);
}
export function requiredRecordFields(value: unknown, name: string, fields: readonly string[]) {
  records(value, name);
  for (const [i, item] of (value as Record<string, unknown>[]).entries()) {
    exactKeys(item, fields, `${name}[${i}]`);
    for (const field of fields) nonEmpty(item[field], `${name}[${i}].${field}`);
  }
}
export function context(value: unknown): RunContext {
  const c = object(value, 'context');
  exactKeys(c, ['run', 'issue', 'pr', 'round', 'sha', 'cursor'], 'context', ['pr']);
  const issue = c.issue as number;
  const round = c.round as number;
  if (!Number.isInteger(issue) || issue < 1 || !Number.isInteger(round) || round < 1)
    throw new AgentContractError('wrong-context', 'invalid issue or round');
  if (c.pr !== undefined && (!Number.isSafeInteger(c.pr) || (c.pr as number) < 1))
    throw new AgentContractError('wrong-context');
  return {
    run: nonEmpty(c.run, 'run'),

    issue,

    pr: c.pr as number | undefined,

    round,

    sha: nonEmpty(c.sha, 'sha'),

    cursor: nonEmpty(c.cursor, 'cursor'),
  };
}

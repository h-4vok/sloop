import type { ConfigValueType, FieldMetadata } from '../types.js';
import { configValueParsers } from '../parsing/configValueParsers.js';
import { argvParser } from '../parsing/agentArgvParser.js';
import { createConfigField } from './createConfigField.js';

const {
  stringParser,
  booleanParser,
  integerParser,
  enumParser,
  listParser,
  durationParser,
  pathParser,
  unrestrictedStringParser,
} = configValueParsers;

/** Defines agents configuration fields and their defaults. */
export const agentsConfigFields = [
  ...(['worker', 'qa', 'arbiter'] as const).flatMap((role) => [
    createConfigField(
      `agents.${role}.harness`,
      'enum',
      enumParser(['codex'] as const),
      'codex',
      `${role} harness adapter.`,
    ),
    createConfigField(
      `agents.${role}.model`,
      'string',
      stringParser,
      'gpt-5.6-luna',
      `${role} model.`,
    ),
    createConfigField(
      `agents.${role}.sandbox`,
      'enum',
      enumParser(['read-only', 'workspace-write', 'danger-full-access'] as const),
      role === 'arbiter' ? 'read-only' : 'workspace-write',
      `${role} sandbox policy.`,
      { choices: ['read-only', 'workspace-write', 'danger-full-access'] },
    ),
    createConfigField(
      `agents.${role}.reasoningEffort`,
      'enum',
      enumParser(['minimal', 'low', 'medium', 'high', 'xhigh'] as const),
      'low',
      `${role} reasoning effort.`,
    ),
    createConfigField(
      `agents.${role}.timeout`,
      'duration',
      durationParser,
      600_000,
      `${role} runner timeout in milliseconds.`,
    ),
    createConfigField(
      `agents.${role}.retries`,
      'integer',
      integerParser,
      0,
      `${role} runner retry count.`,
    ),
  ]),
] satisfies readonly FieldMetadata[];

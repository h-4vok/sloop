import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

function writeArbiterSchema(schemaRoot: string, schemaPath: string): void {
  const envelope = JSON.parse(
    readFileSync(join(schemaRoot, 'sloop.agent-output.v1.json'), 'utf8'),
  ) as Record<string, unknown>;
  const arbiter = JSON.parse(readFileSync(join(schemaRoot, 'arbiter.v1.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const arbiterProperties = arbiter.properties as Record<string, Record<string, unknown>>;
  const decisionItems = arbiterProperties.decisions!.items as Record<string, unknown>;

  // Codex strict output requires every declared property, including nullable action-specific fields.
  decisionItems.required = Object.keys(decisionItems.properties as Record<string, unknown>);
  envelope.$defs = { arbiter };
  delete envelope.oneOf;
  const properties = envelope.properties as Record<string, unknown>;
  properties.producer = { type: 'string', const: 'arbiter' };
  properties.status = { type: 'string', enum: ['uphold', 'overrule', 'defer', 'escalate'] };
  properties.payload = { $ref: '#/$defs/arbiter' };
  writeFileSync(schemaPath, JSON.stringify(envelope));
}

/** Writes the strict structured-output schema consumed by Codex CLI. */
export const ArbiterSchema = {
  writeArbiterSchema,
};

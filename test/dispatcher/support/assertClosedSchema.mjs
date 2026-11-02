import assert from 'node:assert/strict';

export function assertClosedSchema(node) {
  visitSchemaNode(node);
}

function visitSchemaNode(node) {
  if (!node || typeof node !== 'object') return;
  validateSchemaNode(node);
  for (const child of Object.values(node)) visitSchemaChild(child);
}

function visitSchemaChild(child) {
  if (Array.isArray(child)) {
    child.forEach(visitSchemaNode);
    return;
  }
  visitSchemaNode(child);
}

function validateSchemaNode(node) {
  validateSchemaReference(node);
  validateSchemaProperties(node);
  validateSchemaConstraints(node);
}

function validateSchemaReference(node) {
  if (node.$ref) assert.ok(node.$ref.startsWith('#/$defs/'));
}

function validateSchemaProperties(node) {
  if (!node.properties) return;
  assert.equal(node.additionalProperties, false);
  assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
}

function validateSchemaConstraints(node) {
  if (node.enum || node.const) assert.ok(node.type);
}

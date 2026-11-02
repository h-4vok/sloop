import assert from 'node:assert/strict';

export function assertPersistedDiagnostic(state, phase, diagnostic, context) {
  assert.ok((state.lastError.match(/[.!?]+/g) ?? []).length <= 4, state.lastError);
  assert.match(state.lastError, new RegExp(`during ${phase}`));
  for (const value of context) assert.match(state.lastError, value);
  assert.equal(state.lastErrorVerbose, diagnostic);
}

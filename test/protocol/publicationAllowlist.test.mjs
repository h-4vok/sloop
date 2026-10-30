import assert from 'node:assert/strict';
import { test } from 'vitest';
import { allowlistedPublication, publicationBody } from '../../src/publication.js';

test('publication allowlist excludes raw channels and redacts credentials', () => {
  assert.deepEqual(allowlistedPublication({ raw: 'secret', token: 'abc', summary: 'ok' }), {
    token: '<redacted>',

    summary: 'ok',
  });
});

test('publication boundary preserves safe values and rejects non-string GitHub bodies', () => {
  assert.deepEqual(allowlistedPublication(['safe', 4, null]), ['safe', 4, null]);
  assert.deepEqual(allowlistedPublication({ nested: { value: true }, stderr: 'omit' }), {
    nested: { value: true },
  });
  assert.equal(publicationBody('safe body'), 'safe body');
  assert.throws(() => publicationBody({ summary: 'not a body' }), TypeError);
});

test('publication boundary removes bearer, cookie, and URL credentials', () => {
  const value = allowlistedPublication(
    'Authorization: Bearer abc\nCookie: sid=xyz https://u:p@example.test/x',
  );

  assert.equal(String(value).includes('abc'), false);
  assert.equal(String(value).includes('xyz'), false);
  assert.equal(String(value).includes('u:p@'), false);
});

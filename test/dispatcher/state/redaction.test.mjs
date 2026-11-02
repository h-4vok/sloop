import { assert, join, test, redactDiagnostic } from '../support/dispatcher-test-support.mjs';

test('diagnostic redaction preserves safe multiline output and hides common credentials', () => {
  const output = redactDiagnostic(
    'exit 1\nGITHUB_TOKEN=secret-value\n{"password":"p@ss"}\nhttps://example.test/log',
  );

  assert.match(output, /exit 1/);
  assert.match(output, /https:\/\/example.test\/log/);
  assert.doesNotMatch(output, /secret-value|p@ss/);
  assert.match(output, /\[REDACTED\]/);
});

test('diagnostic redaction exactly preserves hyphenated credential-key assignments', () => {
  const diagnostic = [
    'X-Secret-Value: secret-123',
    'X-Credentials-Blob=credentials-123',
    'X-Password-Hint: password-123',
  ].join('\n');
  const expected = [
    'X-Secret-Value: [REDACTED]',
    'X-Credentials-Blob=[REDACTED]',
    'X-Password-Hint: [REDACTED]',
  ].join('\n');
  const output = redactDiagnostic(diagnostic);

  assert.equal(output, expected);
  assert.equal(redactDiagnostic(output), expected);
});

test('diagnostic redaction exactly preserves bare and prefixed header diagnostics', () => {
  const diagnostic = [
    'Authorization: Basic dXNlcjpwYXNzd29yZA==',
    'Proxy-Authorization: Bearer proxy-secret',
    'Cookie: session=one; csrf=two',
    'Set-Cookie: session=three; HttpOnly',
    '> Authorization: Basic dXNlcjpwYXNzd29yZA==',
    'curl: Proxy-Authorization: Basic cHJveHk6c2VjcmV0',
    'request headers: Cookie: session=one; csrf=two',
    'trace: Set-Cookie: session=three; HttpOnly',
  ].join('\n');
  const expected = [
    'Authorization: [REDACTED]',
    'Proxy-Authorization: [REDACTED]',
    'Cookie: [REDACTED]',
    'Set-Cookie: [REDACTED]',
    '> Authorization: [REDACTED]',
    'curl: Proxy-Authorization: [REDACTED]',
    'request headers: Cookie: [REDACTED]',
    'trace: Set-Cookie: [REDACTED]',
  ].join('\n');
  const output = redactDiagnostic(diagnostic);

  assert.equal(output, expected);
  assert.equal(redactDiagnostic(output), expected);
});

test('diagnostic redaction removes short Bearer credentials', () => {
  const output = redactDiagnostic('Bearer abc\nBearer secret\nBearer a');

  assert.equal(output, 'Bearer [REDACTED]\nBearer [REDACTED]\nBearer [REDACTED]');
});

test('diagnostic redaction removes URL userinfo and complete cookie header values', () => {
  const output = redactDiagnostic(
    'https://alice:supersecret@example.test/log\nCookie: session=one; csrf=two\nSet-Cookie: session=three; HttpOnly\nhttps://example.test/safe',
  );

  assert.match(output, /https:\/\/\[REDACTED\]@example\.test\/log/);
  assert.match(output, /Cookie: \[REDACTED\]/);
  assert.match(output, /Set-Cookie: \[REDACTED\]/);
  assert.match(output, /https:\/\/example\.test\/safe/);
  assert.doesNotMatch(output, /alice|supersecret|session=one|csrf=two|session=three/);
});

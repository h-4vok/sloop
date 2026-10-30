import {
  assert,
  test,
  ConfigValidationError,
  canonical,
  loadConfigText,
} from '../../support/config-test-helpers.mjs';

test('credential-bearing headers and assignments are rejected in argv fields', () => {
  for (const [command, expectedPath] of [
    [
      ['curl', '-H', 'Authorization: Bearer secret-value', 'https://example.com'],
      '$.health.command[2]',
    ],
    [['curl', '-H', 'Authorization: token opaque-secret'], '$.health.command[2]'],
    [['curl', '-H', 'Private-Token: opaque-secret'], '$.health.command[2]'],
    [['curl', '--header', 'X-Api-Key: opaque-secret'], '$.health.command[2]'],
    [['curl', '-H', 'Cookie: session=supersecret'], '$.health.command[2]'],
    [['curl', '--header=Set-Cookie: session=supersecret'], '$.health.command[1]'],
    [
      ['curl', '--header=Authorization: Bearer secret-value', 'https://example.com'],
      '$.health.command[1]',
    ],
    [['curl', '--user', 'alice:supersecret', 'https://example.com'], '$.health.command[2]'],
    [['curl', '--user=alice:supersecret', 'https://example.com'], '$.health.command[1]'],
    [['tool', '--api-key', 'secret-value'], '$.health.command[2]'],
    [['tool', '--api-key=secret-value'], '$.health.command[1]'],
    [['curl', '--cookie', 'session=supersecret'], '$.health.command[2]'],
    [['curl', '--cookie=session=supersecret'], '$.health.command[1]'],
    [['curl', '-b', 'session=supersecret'], '$.health.command[2]'],
    [['curl', '-bsession=supersecret'], '$.health.command[1]'],
    [['curl', '-ualice:supersecret'], '$.health.command[1]'],
    [['curl', '-H', 'X-GitHub-Token: secret-value'], '$.health.command[2]'],
    [['curl', '-HX-Service-Key: secret-value'], '$.health.command[1]'],
    [['curl', '--header=X-Client-Secret: secret-value'], '$.health.command[1]'],
    [
      ['git', '-c', 'http.extraHeader=Authorization: Bearer secret-value', 'fetch'],
      '$.health.command[2]',
    ],
    [['curl', 'https://example.com/?access_token=secret-value'], '$.health.command[1]'],
    [['curl', '-H', 'Proxy-Authorization: Basic dXNlcjpwYXNz'], '$.health.command[2]'],
    [['tool', 'api_key=secret-value'], '$.health.command[1]'],
    [['env', 'GITHUB_TOKEN=secret-value', 'gh', 'api', 'user'], '$.health.command[1]'],
    [['tool', 'SERVICE_PASSWORD=secret-value'], '$.health.command[1]'],
    [['tool', 'sessionCookie=secret-value'], '$.health.command[1]'],
    [['tool', 'password:secret-value'], '$.health.command[1]'],
    [['tool', '-----BEGIN PRIVATE KEY-----'], '$.health.command[1]'],
  ]) {
    const source = canonical.replace(
      'command:\n    # Health probe argv; never evaluated by a shell.\n    - gh\n    - run\n    - list\n    - --branch\n    - main',
      `command: ${JSON.stringify(command)}`,
    );
    assert.throws(
      () => loadConfigText(source),
      (error) =>
        error instanceof ConfigValidationError &&
        error.message.includes(`${expectedPath}: credentials are not accepted`),
      `expected credential rejection for ${JSON.stringify(command)}`,
    );
  }
});

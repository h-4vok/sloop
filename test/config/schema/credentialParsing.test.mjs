import {
  assert,
  test,
  ConfigValidationError,
  canonical,
  configFingerprint,
  loadConfigText,
  createConfigWithRemote,
} from '../../support/config-test-helpers.mjs';

for (const [credentialType, remote] of [
  ['URL credentials', 'https://x-access-token:ghp_example@example.com/org/repo.git'],
  ['a GitHub fine-grained token', 'github_pat_1234567890_example'],
  ['a GitHub token', 'ghp_1234567890example'],
]) {
  test('config parser rejects repository remotes containing ' + credentialType, () => {
    const source = createConfigWithRemote(remote);
    const parseCredentialRemote = () => loadConfigText(source);

    assert.throws(
      parseCredentialRemote,
      (error) =>
        error instanceof ConfigValidationError &&
        error.message.includes('$.repository.remote: credentials are not accepted'),
    );
  });
}

test('a public remote name changes the config fingerprint', () => {
  const publicRemote = loadConfigText(createConfigWithRemote('upstream'));
  const defaultRemote = loadConfigText(canonical);
  const publicFingerprint = configFingerprint(publicRemote);
  const defaultFingerprint = configFingerprint(defaultRemote);

  assert.notEqual(publicFingerprint, defaultFingerprint);
});

test('credential carrier options are rejected even when their value is opaque', () => {
  const source = canonical.replace(
    'command:\n    # Health probe argv; never evaluated by a shell.\n    - gh\n    - run\n    - list\n    - --branch\n    - main',
    'command: [git, --credential, opaque-value]',
  );

  assert.throws(
    () => loadConfigText(source),
    (error) =>
      error instanceof ConfigValidationError &&
      error.message.includes('$.health.command[2]: credentials are not accepted'),
  );
});

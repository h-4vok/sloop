import { assert, parseCliCommand, test } from '../../support/config-test-helpers.mjs';

const getCliCommand = (args) => {
  const parseResult = parseCliCommand(args);
  assert.equal(parseResult.ok, true);
  return parseResult.value;
};

test('config init retains its command identity and wizard option', () => {
  const initArgs = ['config', 'init'];
  const parsedInitCommand = getCliCommand(initArgs);

  assert.deepEqual(parsedInitCommand, { kind: 'config', args: ['--init'] });

  const initWizardArgs = ['config', 'init', '--wizard'];
  const parsedInitWizardCommand = getCliCommand(initWizardArgs);

  assert.deepEqual(parsedInitWizardCommand, {
    kind: 'config',
    args: ['--init', '--wizard'],
  });
});

test('config install retains its command identity and force option', () => {
  const installArgs = ['config', 'install'];
  const parsedInstallCommand = getCliCommand(installArgs);

  assert.deepEqual(parsedInstallCommand, { kind: 'config', args: ['--install'] });

  const forcedInstallArgs = ['config', 'install', '--force'];
  const parsedForcedInstallCommand = getCliCommand(forcedInstallArgs);

  assert.deepEqual(parsedForcedInstallCommand, {
    kind: 'config',
    args: ['--install', '--force'],
  });
});

test('unsupported root init command returns a usage error', () => {
  const unsupportedArgs = ['init'];
  const invalidCommandResult = parseCliCommand(unsupportedArgs);

  assert.equal(invalidCommandResult.ok, false);
  assert.match(invalidCommandResult.error, /unsupported|usage/i);
});

test('config command preserves bare and workspace forms', () => {
  const configArgs = ['config'];
  const parsedConfigCommand = getCliCommand(configArgs);

  assert.deepEqual(parsedConfigCommand, { kind: 'config', args: [] });

  const workspaceArgs = ['config', 'workspace'];
  const parsedWorkspaceCommand = getCliCommand(workspaceArgs);

  assert.deepEqual(parsedWorkspaceCommand, { kind: 'config', args: ['workspace'] });
});

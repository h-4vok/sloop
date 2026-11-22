import { assert, parseCliCommand, test } from '../../support/config-test-helpers.mjs';

const successfulCommandCases = [
  {
    name: 'config init',
    args: ['config', 'init'],
    expectedCommand: { kind: 'config', args: ['--init'] },
  },
  {
    name: 'config init with wizard',
    args: ['config', 'init', '--wizard'],
    expectedCommand: { kind: 'config', args: ['--init', '--wizard'] },
  },
  {
    name: 'config install',
    args: ['config', 'install'],
    expectedCommand: { kind: 'config', args: ['--install'] },
  },
  {
    name: 'config install with force',
    args: ['config', 'install', '--force'],
    expectedCommand: { kind: 'config', args: ['--install', '--force'] },
  },
  {
    name: 'bare config',
    args: ['config'],
    expectedCommand: { kind: 'config', args: [] },
  },
  {
    name: 'config workspace',
    args: ['config', 'workspace'],
    expectedCommand: { kind: 'config', args: ['workspace'] },
  },
];

test.each(successfulCommandCases)(
  '$name preserves its command identity',
  ({ args, expectedCommand }) => {
    const commandArgs = args;

    const parseResult = parseCliCommand(commandArgs);

    assert.equal(parseResult.ok, true);
    assert.deepEqual(parseResult.value, expectedCommand);
  },
);

test('unsupported root init command returns a usage error', () => {
  const unsupportedArgs = ['init'];
  const invalidCommandResult = parseCliCommand(unsupportedArgs);

  assert.equal(invalidCommandResult.ok, false);
  assert.match(invalidCommandResult.error, /unsupported|usage/i);
});

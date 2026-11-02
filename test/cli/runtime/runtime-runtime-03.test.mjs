import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { test } from 'vitest';
import {
  discoverRepository as discoverRepositoryResult,
  EXIT,
  parseCliCommand as parseCliCommandResult,
  parseReadOnlyCommand as parseReadOnlyCommandResult,
  parseDispatcherCommand as parseDispatcherCommandResult,
  emitNodeVersionFailure,
  emitUsageFailure,
  resultOutput,
  runDispatcherPreflight,
  runReadOnlyCommand,
} from '../../../src/runtime.js';
import { canonicalConfigYaml } from '../../../src/config.js';

import {
  config,
  unwrap,
  parseCliCommand,
  parseReadOnlyCommand,
  parseDispatcherCommand,
  discoverRepository,
  createMockRuntimeHarness,
} from '../support/runtime-support.mjs';

test('read-only diagnostics provide safe guidance for every inspection failure', () => {
  const cases = [
    [
      {
        'gh label list --repo o/r --limit 1000 --json name': {
          stdout: '[]',

          stderr: '',

          status: 0,
        },
      },
      ['issues', 'list', '--json'],
      'labels',
    ],
    [
      { 'git status --porcelain': { stdout: '', stderr: 'cannot inspect', status: 1 } },
      ['doctor'],
      'working-tree',
    ],
    [{ 'codex --version': { stdout: '', stderr: 'missing', status: 1 } }, ['doctor'], 'codex'],
    [{ localConfig: 'schemaVersion: [' }, ['status', '--json'], 'configuration'],
  ];

  for (const [overrides, args, check] of cases) {
    const runtimeHarness = createMockRuntimeHarness(overrides);
    const parsedReadOnlyCommand = parseReadOnlyCommand(args);
    runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io);
    const output = args.includes('--json') ? runtimeHarness.stdout[0] : runtimeHarness.stderr[0];
    const result = args.includes('--json') ? JSON.parse(output) : undefined;
    const item = result?.diagnostics?.find((diagnostic) => diagnostic.check === check);
    if (item) {
      assert.equal(item.mutates, false);
      assert.equal(item.nextAction.mutates, false);
      assert.equal(item.nextAction.command, 'sloop doctor');
      assert.match(item.nextAction.description, /read-only|safe repair command/);
    } else assert.match(output, new RegExp(`\\[${check}\\]`));
    assert.ok(
      !runtimeHarness.calls.some(({ args: commandArgs }) =>
        ['checkout', 'reset', 'clean', 'push'].includes(commandArgs[0]),
      ),
    );
  }
});

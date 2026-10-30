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

test('external service failure uses exit 5 and never reports success', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'gh issue list --state open --label Automation Ready --repo o/r --json number,title,url,labels':
      {
        stdout: '',

        stderr: 'network',

        status: 1,
      },
  });

  const readOnlyArgs = ['issues', 'list', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.external);
  assert.equal(JSON.parse(runtimeHarness.stdout[0]).status, 'failed');
});

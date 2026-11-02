import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { productionDependencies } from '../../../src/adapters.js';
import { loadConfigText, canonicalConfigYaml } from '../../../src/config.js';
import { CliFailure } from '../../../src/dispatcher.js';
import { runManifestMarker } from '../../../src/remote-state.js';

function decodeForwardedArguments(stdin, args) {
  if (stdin === undefined) return args;
  const lines = stdin.split('\n');
  const [countLine] = lines;
  const encodedArgs = lines.slice(1, Number(countLine) + 1);
  assert.equal(Number(countLine), encodedArgs.length);
  return encodedArgs.map((encoded) => Buffer.from(encoded, 'base64').toString('utf8'));
}

function createMockFollowUpIssueHarness(hasFollowUpIssue) {
  const calls = [];
  const key = 'sloop/arbiter/follow-up/41/Q1';
  const execute = (_file, args) => {
    calls.push([...args]);
    if (args[0] === 'issue' && args[1] === 'list')
      return hasFollowUpIssue
        ? JSON.stringify([{ number: 88, body: `Idempotency key: ${key}` }])
        : '[]';
    return 'https://github.com/h-4vok/sloop/issues/99';
  };
  const dependencies = productionDependencies(
    createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-arbiter-issue-')),
    loadConfigText(canonicalConfigYaml()),
    'h-4vok/sloop',
    { execFileSync: execute },
  );

  return { calls, dependencies, key };
}

test('typed CLI failures preserve stable busy and external exit classes', () => {
  const exitCodes = [
    new CliFailure(3, 'owned').exitCode,
    new CliFailure(5, 'HTTP 503: Service Unavailable').exitCode,
  ];

  assert.deepEqual(exitCodes, [3, 5]);
});

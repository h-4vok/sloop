import assert from 'node:assert/strict';
import { test } from 'vitest';
import { EXIT, runDispatcherPreflight, runReadOnlyCommand } from '../../../src/runtime.js';
import {
  parseDispatcherCommand,
  parseReadOnlyCommand,
  createMockRuntimeHarness,
} from '../support/runtime-support.mjs';

const issueListArgs = ['issues', 'list', '--json'];
const invalidPreflightCases = [
  {
    name: 'unavailable gh',
    overrides: { 'gh --version': { stdout: '', stderr: '', status: 1 } },
    check: 'gh',
  },
  {
    name: 'malformed repository identity',
    overrides: {
      'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
        stdout: '{',
        stderr: '',
        status: 0,
      },
    },
    check: 'repository-identity',
  },
  {
    name: 'read-only repository permission',
    overrides: {
      'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
        stdout: '{"viewerPermission":"READ"}',
        stderr: '',
        status: 0,
      },
    },
    check: 'repository-identity',
  },
  {
    name: 'missing repository permission',
    overrides: {
      'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
        stdout: '{"nameWithOwner":"o/r","viewerPermission":"NONE"}',
        stderr: '',
        status: 0,
      },
    },
    check: 'permissions',
  },
  {
    name: 'malformed labels',
    overrides: {
      'gh label list --repo o/r --limit 1000 --json name': { stdout: '{', stderr: '', status: 0 },
    },
    check: 'labels',
  },
  {
    name: 'missing labels',
    overrides: {
      'gh label list --repo o/r --limit 1000 --json name': { stdout: '[]', stderr: '', status: 0 },
    },
    check: 'labels',
  },
  {
    name: 'unavailable labels',
    overrides: {
      'gh label list --repo o/r --limit 1000 --json name': { stdout: '', stderr: '', status: 1 },
    },
    check: 'permissions',
  },
];

test.each(invalidPreflightCases)('runtime preflight reports $name', ({ overrides, check }) => {
  const runtimeHarness = createMockRuntimeHarness(overrides);
  const parsedCommand = parseReadOnlyCommand(issueListArgs);

  assert.equal(runReadOnlyCommand(parsedCommand, runtimeHarness.io), EXIT.preflight);
  const diagnostics = JSON.parse(runtimeHarness.stdout[0]).diagnostics;
  assert.ok(diagnostics.some((diagnostic) => diagnostic.check === check));
});

test.each([
  ['malformed issue response', 'not json', EXIT.external],
  ['valid empty issue response', '[]', EXIT.ok],
])('read-only issue listing handles %s', (_name, stdout, expected) => {
  const runtimeHarness = createMockRuntimeHarness({
    'gh issue list --state open --label Automation Ready --repo o/r --json number,title,url,labels':
      {
        stdout,
        stderr: '',
        status: 0,
      },
  });
  const parsedCommand = parseReadOnlyCommand(issueListArgs);

  assert.equal(runReadOnlyCommand(parsedCommand, runtimeHarness.io), expected);
});

test('dispatcher preflight reports an invalid GitHub repository URL', () => {
  const runtimeHarness = createMockRuntimeHarness({
    'git remote get-url origin': { stdout: 'not-a-github-url', stderr: '', status: 0 },
  });
  const dispatcherArgs = ['--status'];
  const parsedCommand = parseDispatcherCommand(dispatcherArgs);

  assert.equal(runDispatcherPreflight(parsedCommand, runtimeHarness.io).code, EXIT.preflight);
});

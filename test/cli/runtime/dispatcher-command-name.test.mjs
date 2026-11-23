import assert from 'node:assert/strict';
import { test } from 'vitest';
import { repositoryPreflight } from '../../../src/runtime.js';

const dispatcherCommandNameCases = [
  { name: 'workflow', command: { kind: 'workflow' }, expectedName: 'sloop' },
  { name: 'status', command: { kind: 'status', verbose: false }, expectedName: '--status' },
  { name: 'list', command: { kind: 'list' }, expectedName: '--list' },
  { name: 'recover-lock', command: { kind: 'recover-lock' }, expectedName: '--recover-lock' },
  { name: 'reset', command: { kind: 'reset' }, expectedName: '--reset' },
  { name: 'reset-mutex', command: { kind: 'reset-mutex' }, expectedName: '--reset-mutex' },
  {
    name: 'prepare-recovery',

    command: { kind: 'prepare-recovery', issue: 1 },

    expectedName: '--prepare-recovery',
  },
  {
    name: 'resolve-review-cap',

    command: { kind: 'resolve-review-cap', options: {} },

    expectedName: '--resolve-review-cap',
  },
  {
    name: 'link-issue',

    command: { kind: 'link-issue', issue: 1 },

    expectedName: '--link-issue',
  },
  {
    name: 'list-all-worktrees',

    command: { kind: 'list-all-worktrees' },

    expectedName: '--list-all-worktrees',
  },
  {
    name: 'clear-all-worktrees',

    command: { kind: 'clear-all-worktrees' },

    expectedName: '--clear-all-worktrees',
  },
];

test.each(dispatcherCommandNameCases)(
  'dispatcher command $name maps to its CLI name',
  ({ command, expectedName }) => {
    const actualCommandName = repositoryPreflight.commandNameForDispatcher(command);

    assert.equal(actualCommandName, expectedName);
  },
);

test('dispatcher command name lookup returns undefined for an unknown kind', () => {
  const unknownCommand = { kind: 'unknown' };

  const actualCommandName = repositoryPreflight.commandNameForDispatcher(unknownCommand);

  assert.equal(actualCommandName, undefined);
});

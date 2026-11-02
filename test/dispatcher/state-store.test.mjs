import assert from 'node:assert/strict';
import { test } from 'vitest';
import { RunStateStore } from '../../src/application/dispatcher/services/state/RunStateStore.js';
import { RunStatePolicy } from '../../src/application/dispatcher/services/state/RunStatePolicy.js';

test('run state store returns an expected failure when rename attempts are exhausted', () => {
  const operations = [];
  const mockFileIO = {
    exists: () => false,
    read: () => '',
    makeDirectory: (directory) => operations.push(['mkdir', directory]),
    write: (file) => operations.push(['write', file]),
    rename: () => {
      operations.push(['rename']);
      throw new Error('state file is busy');
    },
  };
  const stateStore = RunStateStore.createRunStateStore(
    mockFileIO,
    'C:/repo',
    () => 7,
    () => 9,
    () => false,
  );
  const state = { issue: 12, status: 'claimed' };

  const saveResult = stateStore.writeState(state);

  assert.equal(saveResult.ok, false);
  assert.equal(saveResult.error.message, 'state file is busy');
  assert.equal(operations.filter(([operation]) => operation === 'rename').length, 5);
});

test('run state reset rejects a live worker through Result without touching files', () => {
  const mockFileIO = {
    exists: () => false,
    read: () => '',
    makeDirectory: () => assert.fail('reset must not write files'),
    write: () => assert.fail('reset must not write files'),
    rename: () => assert.fail('reset must not write files'),
  };
  const stateStore = RunStateStore.createRunStateStore(
    mockFileIO,
    'C:/repo',
    () => 7,
    () => 9,
    (pid) => pid === 42,
  );
  const activeState = { issue: 12, status: 'worker_running', workerPid: 42 };

  const resetResult = stateStore.resetRunState(activeState);

  assert.equal(resetResult.ok, false);
  assert.match(resetResult.error.message, /Worker process 42 is still running/);
});

test('state transition preserves save, event, console, and comment order', () => {
  const events = [];
  let currentState = { issue: 12, status: 'claimed' };
  const dependencies = {
    load: () => currentState,
    save: (nextState) => {
      currentState = nextState;
      events.push('save');
    },
    now: () => 99,
    runLogger: { write: () => events.push('event') },
    comment: () => events.push('comment'),
    reportStatus: () => events.push('console'),
  };
  RunStatePolicy.status(dependencies, 12, 'worker_running');

  assert.deepEqual(events, ['save', 'event', 'console', 'comment']);
  assert.equal(currentState.status, 'worker_running');
  assert.equal(currentState.updatedAt, 99);
});

test('claim transition records the new owner before emitting its event', () => {
  const events = [];
  let currentState = { status: 'done', completedIssues: [3] };
  const dependencies = {
    load: () => currentState,
    save: (nextState) => {
      currentState = nextState;
      events.push('save');
    },
    now: () => 101,
    runLogger: { write: () => events.push('event') },
    comment: () => events.push('comment'),
    reportStatus: () => events.push('console'),
  };
  RunStatePolicy.claimNewIssue(dependencies, 18);

  assert.deepEqual(events, ['save', 'event', 'console', 'comment']);
  assert.equal(currentState.issue, 18);
  assert.equal(currentState.status, 'claimed');
  assert.equal(currentState.updatedAt, 101);
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'vitest';
import { terminateProcessTree } from '../src/infrastructure/agents/terminateProcessTree.js';

test('Windows timeout requests termination of the full agent process tree', () => {
  let wasKilledDirectly = false;
  let requestedPid;
  const agentProcess = {
    pid: 1420,
    kill: () => {
      wasKilledDirectly = true;
      return true;
    },
  };

  terminateProcessTree(agentProcess, 'win32', (pid) => {
    requestedPid = pid;
  });

  assert.equal(requestedPid, 1420);
  assert.equal(wasKilledDirectly, false);
});

test('Windows timeout falls back to killing the agent when tree termination fails', () => {
  let wasKilledDirectly = false;
  const agentProcess = {
    pid: 1420,
    kill: () => {
      wasKilledDirectly = true;
      return true;
    },
  };

  terminateProcessTree(agentProcess, 'win32', (_pid, onFailure) => onFailure());

  assert.equal(wasKilledDirectly, true);
});

test('Windows process tree termination invokes taskkill for the agent and descendants', () => {
  const taskkillProcess = new EventEmitter();
  const spawnProcess = (command, args, options) => {
    assert.equal(command, 'taskkill.exe');
    assert.deepEqual(args, ['/PID', '1420', '/T', '/F']);
    assert.deepEqual(options, { windowsHide: true, stdio: 'ignore' });
    return taskkillProcess;
  };
  const agentProcess = { pid: 1420, kill: () => true };

  terminateProcessTree(agentProcess, 'win32', undefined, spawnProcess);
  taskkillProcess.emit('close', 0);
});

test('Windows process tree termination falls back when taskkill fails', () => {
  let directKillCount = 0;
  const taskkillProcess = new EventEmitter();
  const spawnProcess = () => taskkillProcess;
  const agentProcess = {
    pid: 1420,
    kill: () => {
      directKillCount += 1;
      return true;
    },
  };

  terminateProcessTree(agentProcess, 'win32', undefined, spawnProcess);
  taskkillProcess.emit('error', new Error('taskkill unavailable'));
  taskkillProcess.emit('close', 1);

  assert.equal(directKillCount, 1);
});

test('non-Windows timeout kills the agent process directly', () => {
  let wasKilledDirectly = false;
  const agentProcess = {
    pid: 1420,
    kill: () => {
      wasKilledDirectly = true;
      return true;
    },
  };

  terminateProcessTree(agentProcess, 'linux');

  assert.equal(wasKilledDirectly, true);
});

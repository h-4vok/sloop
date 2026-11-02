/** Coordinates dispatcher runtime operations for dispatcher workflows. */
import { createNodeRunStateFileIO } from '../../../infrastructure/adapters/createNodeRunStateFileIO.js';
import { createNodeDispatcherLockRecoveryIO } from '../../../infrastructure/adapters/createNodeDispatcherLockRecoveryIO.js';
import { defaultProcessAlive } from '../../../infrastructure/adapters/defaultProcessAlive.js';
import { RunStateStore } from './state/RunStateStore.js';
import { DispatcherLock } from './recovery/DispatcherLock.js';

const defaultRoot = process.cwd();
const runStateStore = RunStateStore.createRunStateStore(
  createNodeRunStateFileIO(),
  defaultRoot,
  () => process.pid,
  Date.now,
  defaultProcessAlive,
);
const lockRecoveryIO = createNodeDispatcherLockRecoveryIO();

function recoverStaleLock(root = defaultRoot, isProcessAlive = defaultProcessAlive): string {
  const recoveryResult = DispatcherLock.recoverStaleLockResult(
    lockRecoveryIO,
    root,
    isProcessAlive,
  );
  if (!recoveryResult.ok) throw recoveryResult.error;

  return recoveryResult.value;
}

export const DispatcherRuntime = {
  defaultRoot,

  runStateStore,

  defaultProcessAlive,

  recoverStaleLock,
};

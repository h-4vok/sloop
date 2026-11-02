import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

type ProcessSpawner = typeof spawn;
type ProcessTreeTerminator = (
  pid: number,
  onFailure: () => void,
  spawnProcess: ProcessSpawner,
) => void;

/** Stops an agent and its descendants so timed-out Windows shims cannot keep the run alive. */
export function terminateProcessTree(
  child: Pick<ChildProcess, 'pid' | 'kill'>,
  platform: NodeJS.Platform = process.platform,
  terminateWindowsTree: ProcessTreeTerminator = killWindowsProcessTree,
  spawnProcess: ProcessSpawner = spawn,
): void {
  if (platform !== 'win32' || !child.pid) {
    child.kill();
    return;
  }

  try {
    terminateWindowsTree(child.pid, () => child.kill(), spawnProcess);
  } catch {
    child.kill();
  }
}

function killWindowsProcessTree(
  pid: number,
  onFailure: () => void,
  spawnProcess: ProcessSpawner,
): void {
  let hasFailed = false;
  const failOnce = () => {
    if (hasFailed) return;
    hasFailed = true;
    onFailure();
  };
  const taskkill = spawnProcess('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });

  taskkill.on('error', failOnce);
  taskkill.on('close', (exitCode) => {
    if (exitCode !== 0) failOnce();
  });
}

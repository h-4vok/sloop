import type { Deps, Spec } from '../types/index.js';

/** Persists worker process ownership and heartbeat data for recovery. */
function withWorkerLifecycle(d: Deps, spec: Spec, issue: number, runId: string): Spec {
  return {
    ...spec,
    input: spec.input,
    onStart: (pid) => {
      d.save({
        ...d.load(),
        issue,
        status: 'worker_running',
        workerRunId: runId,
        workerPid: pid,
        workerStartedAt: d.now(),
        workerHeartbeatAt: d.now(),
        updatedAt: d.now(),
      });
    },
    onHeartbeat: () => {
      d.save({ ...d.load(), workerHeartbeatAt: d.now(), updatedAt: d.now() });
    },
  };
}

export const WorkerLifecycle = { withWorkerLifecycle };

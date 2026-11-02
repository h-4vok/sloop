import { randomUUID } from 'node:crypto';
import type { Config, Deps, Issue } from '../types/index.js';
import type { RunManifest } from '../../../remote-state.js';
import { RunLogger, applyRunRetention, runDirectory } from '../../../run-log.js';
import { allowlistedPublication } from '../../../publication.js';
import { withEphemeralMutexAsync } from '../../../mutex.js';
import { RemoteRunState } from './recovery/RemoteRunState.js';
const { remoteProjection } = RemoteRunState;
import { DispatchRemoteRecovery } from './recovery/DispatchRemoteRecovery.js';
const { prepareRemoteRecovery } = DispatchRemoteRecovery;
import { DispatchWorkspace } from './worker/DispatchWorkspace.js';
const { prepareWorkerWorkspace } = DispatchWorkspace;
import { IssueWorkflow } from './IssueWorkflow.js';
const { processIssue } = IssueWorkflow;
import { RemoteManifestPublisher } from './RemoteManifestPublisher.js';
const { publishRemoteManifest } = RemoteManifestPublisher;

function createIssueRunLogger(d: Deps, issue: Issue, runId: string, recovery: boolean): RunLogger {
  const logger = new RunLogger(runDirectory(d.root, issue.number, runId));
  d.setRunLogger?.(logger);
  logger.write('transition', { phase: 'dispatch', issue: issue.number, recovery });
  logger.write(
    'context',
    d.runContext?.() ?? { originalRepository: d.root, executionRoot: d.root },
  );
  const remote = remoteProjection(d, issue.number);
  if (remote)
    logger.write('remote-projection', {
      projection: remote.projection,

      snapshot: allowlistedPublication(remote.snapshot),
    });

  return logger;
}

async function runIssueWorkflow(
  cfg: Config,
  d: Deps,
  issue: Issue,
  claimed: RunManifest | undefined,
): Promise<void> {
  await processIssue(cfg, d, issue);
  if (!claimed) return;

  const phase = resolveCompletedRunPhase(d.load().status);
  if (phase !== 'working') publishRemoteManifest(cfg, d, issue.number, phase, claimed);
}

function resolveCompletedRunPhase(status: string | undefined): RunManifest['phase'] {
  if (status === 'review_cap_pending') return 'blocked';
  if (
    ['ready_for_human_merge', 'human_review_required', 'abandoned', 'done'].includes(status ?? '')
  )
    return 'complete';
  return 'working';
}

function cleanupIssueWorkspace(d: Deps, issue: Issue, runId: string): void {
  const facts = d.workspaceAdapter?.recover(issue.number, runId, d.load().branch);
  if (facts) d.workspaceAdapter?.cleanup(facts);
}

async function runIssueUnderMutex(
  cfg: Config,
  d: Deps,
  issue: Issue,
  initiallyRecovering: boolean,
): Promise<void> {
  await withEphemeralMutexAsync(d.root, `${process.pid}:${issue.number}`, async () => {
    const remoteResult = await prepareRemoteRecovery(cfg, d, issue, initiallyRecovering);
    if (!remoteResult.ok) throw remoteResult.error;
    const remote = remoteResult.value;
    const runId = d.load().workerRunId ?? randomUUID();
    createIssueRunLogger(d, issue, runId, remote.recovery);
    const claimed = await prepareWorkerWorkspace(
      cfg,
      d,
      issue,
      runId,
      remote.recovery,
      remote.manifest,
    );
    try {
      await runIssueWorkflow(cfg, d, issue, claimed);
    } finally {
      cleanupIssueWorkspace(d, issue, d.load().workerRunId ?? claimed?.runId ?? '');
    }
  });
}

export const DispatchIssueRunner = { runIssueUnderMutex };

import { runDispatcherCli as executeDispatcherCli } from './application/cli/runDispatcherCli.js';
import type { DispatcherCommand } from './application/dispatcher/DispatcherCommand.js';
import type { Deps } from './application/dispatcher/types/Deps.js';
import { childProcessInvocation, resolveExecutable, runSyncCommand } from './process.js';
export { childProcessInvocation, resolveExecutable, runSyncCommand } from './process.js';
export type {
  Check,
  Command,
  Config,
  Deps,
  DispatcherHost,
  Issue,
  PullRequest,
  Review,
  Spec,
  State,
  Status,
} from './application/dispatcher/types/index.js';
export type {
  CiState,
  HumanReviewGuide,
  HitlResumeDirective,
} from './application/dispatcher/types/index.js';
export { CliFailure } from './application/dispatcher/types/CliFailure.js';
import { DispatcherRuntime } from './application/dispatcher/services/DispatcherRuntime.js';
import { StateDiagnostics } from './application/dispatcher/services/state/StateDiagnostics.js';
import { DispatcherLock } from './application/dispatcher/services/recovery/DispatcherLock.js';
import { IssueSelection } from './application/dispatcher/services/IssueSelection.js';
import { PullRequestReader } from './application/dispatcher/services/PullRequestReader.js';
import { PullRequestPublisher } from './application/dispatcher/services/PullRequestPublisher.js';
import { CommandRunner } from './application/dispatcher/services/CommandRunner.js';
import { AgentRoles } from './application/dispatcher/services/AgentRoles.js';
import { HumanReviewGuideService } from './application/dispatcher/services/hitl/HumanReviewGuideService.js';
import { ReviewEvidence } from './application/dispatcher/services/review/ReviewEvidence.js';
import { ReviewBudget } from './application/dispatcher/services/ReviewBudget.js';
import { WorkerBranch } from './application/dispatcher/services/worker/WorkerBranch.js';
import { ResolveReviewCap } from './application/dispatcher/services/ResolveReviewCap.js';
import { IssueLink } from './application/dispatcher/services/IssueLink.js';
import { Dispatcher } from './application/dispatcher/services/Dispatcher.js';

const { defaultProcessAlive } = DispatcherRuntime;
const { runStateStore } = DispatcherRuntime;
const { recoverStaleLock } = DispatcherRuntime;
const {
  readState,
  writeState: writeStateResult,
  resetRunState: resetRunStateResult,
} = runStateStore;
const writeState = (state: Parameters<typeof writeStateResult>[0], file?: string): void => {
  const writeResult = writeStateResult(state, file);
  if (!writeResult.ok) throw writeResult.error;
};
const resetRunState = (
  state: Parameters<typeof resetRunStateResult>[0],
  processAlive = defaultProcessAlive,
) => {
  const resetResult = resetRunStateResult(state, processAlive);
  if (!resetResult.ok) throw resetResult.error;
  return resetResult.value;
};
const { redactDiagnostic } = StateDiagnostics;
const { dispatcherLockPath, acquire } = DispatcherLock;
const { eligible, selectIssues } = IssueSelection;
const { pullRequest, pullRequestBody } = PullRequestReader;
const { updatePullRequestBody, commentPullRequest, withIssueClosingReference } =
  PullRequestPublisher;
const { runCommand } = CommandRunner;
const { command } = AgentRoles;
const { hasCommit } = HumanReviewGuideService;
const { reviewFeedback } = ReviewEvidence;
const { maxRoundsForUserBudget } = ReviewBudget;
const { prepareRecovery, workerBranchName, prepareWorkerBranch, checkoutWorkerBranch } =
  WorkerBranch;
const { resolveReviewCap } = ResolveReviewCap;
const { linkIssueToActiveRun } = IssueLink;
const { dispatch } = Dispatcher;
export { readState, writeState, resetRunState };
export { defaultProcessAlive };
export { redactDiagnostic };
export { dispatcherLockPath, recoverStaleLock, acquire };
export { eligible, selectIssues };
export { pullRequest, pullRequestBody };
export { updatePullRequestBody, commentPullRequest, withIssueClosingReference };
export { runCommand };
export { command };
export { hasCommit };
export { reviewFeedback };
export { maxRoundsForUserBudget };
export { prepareRecovery, workerBranchName, prepareWorkerBranch, checkoutWorkerBranch };
export { resolveReviewCap };
export { linkIssueToActiveRun };
export { dispatch };

export async function runDispatcherCli(command: DispatcherCommand, d: Deps): Promise<0 | 4> {
  return executeDispatcherCli.run(command, d, dispatch);
}

// The legacy module path remains an executable entrypoint.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/dispatcher.js'))
  import('./cli.js').then(({ cli }) => cli.runCli(process.argv.slice(2)));

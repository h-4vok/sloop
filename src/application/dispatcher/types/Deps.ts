import type { ActiveRunReconciliation } from '../../../core/ActiveRunReconciliation.js';
import type { AgentRunner } from '../../../core/AgentRunner.js';
import type { CliControl } from '../../../core/CliControl.js';
import type { GitHubProvider } from '../../../core/GitHubProvider.js';
import type { GitProvider } from '../../../core/GitProvider.js';
import type { HealthGate } from '../../../core/HealthGate.js';
import type { LockStore } from '../../../core/LockStore.js';
import type { RemoteAuthority } from '../../../core/RemoteAuthority.js';
import type { RunContext } from '../../../core/RunContext.js';
import type { RunEventLogger } from '../../../core/RunEventLogger.js';
import type { RunEventSink } from '../../../core/RunEventSink.js';
import type { Scheduler } from '../../../core/Scheduler.js';
import type { Workspace } from '../../../core/Workspace.js';
import type { WorkspaceAdapter } from '../../../core/WorkspaceAdapter.js';
import type { RunLogger } from '../../../run-log.js';
import type { Config } from './Config.js';
import type { Issue } from './Issue.js';
import type { PullRequest } from './PullRequest.js';
import type { Spec } from './Spec.js';
import type { State } from './State.js';

/** Injected ports used by dispatcher application services. */
export type Deps = Workspace<State> &
  CliControl<Config> &
  GitHubProvider<Issue, PullRequest> &
  AgentRunner<Spec> &
  HealthGate &
  Scheduler &
  RunEventSink &
  LockStore &
  GitProvider & {
    /** Production assembly sets this; unit seams may omit remote authority. */
    readonly remoteRequired?: boolean;
    readonly remote?: RemoteAuthority;
    readonly workspaceAdapter?: WorkspaceAdapter;
    readonly runLogger?: RunEventLogger;
    readonly setRunLogger?: (logger: RunEventLogger | undefined) => void;
    readonly createRunLogger?: (issue: number, runId: string) => RunEventLogger;
    readonly reportStatus?: (message: string) => void;
    readonly runContext?: () => RunContext;
    readonly listAllWorktrees?: () => unknown;
    readonly clearAllWorktrees?: () => void;
    readonly reconcileActiveRun?: (state: State) => ActiveRunReconciliation;
    readonly harness?: (
      role: string,
      spec: Spec,
      context: import('../../../harness.js').HarnessContext,
      logger: RunLogger,
    ) => import('../../../harness.js').Harness;
  };

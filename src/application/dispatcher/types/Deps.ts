import type {
  ActiveRunReconciliation,
  AgentRunner,
  CliControl,
  GitHubProvider,
  GitProvider,
  HealthGate,
  LockStore,
  RemoteAuthority,
  RunContext,
  RunEventLogger,
  RunEventSink,
  Scheduler,
  Workspace,
  WorkspaceAdapter,
} from '../../../core/boundaries.js';
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
    remoteRequired?: boolean;
    remote?: RemoteAuthority;
    workspaceAdapter?: WorkspaceAdapter;
    runLogger?: RunEventLogger;
    setRunLogger?: (logger: RunEventLogger | undefined) => void;
    runContext?: () => RunContext;
    listAllWorktrees?: () => unknown;
    clearAllWorktrees?: () => void;
    reconcileActiveRun?: (state: State) => ActiveRunReconciliation;
    harness?: (
      role: string,
      spec: Spec,
      context: import('../../../harness.js').HarnessContext,
      logger: RunLogger,
    ) => import('../../../harness.js').Harness;
  };

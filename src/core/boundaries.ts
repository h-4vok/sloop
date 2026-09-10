/** Internal replacement seams for every external concern used by the core loop. */
export interface Workspace<State> {
  readonly root: string;
  load(): State;
  save(state: State): void;
}

/** Public command handling that belongs to the platform adapter, not the loop core. */
export type ReviewCapOptions = Readonly<{
  steer: string;
  additionalRounds: number;
  waivedFindingIds: readonly string[];
  waiveAllOutstanding: boolean;
  abandon: boolean;
}>;

export interface CliControl<Config> {
  loadConfig(): Config;
  status(verbose: boolean): unknown;
  list(): unknown;
  recoverLock(): string;
  reset(): void;
  resolveReviewCap(options: ReviewCapOptions, config: Config): void;
  linkIssue(issue: number): void;
  prepareRecovery(issue: number, pr: number | undefined, config: Config): number;
}

export type LockOwner = { pid: number; createdAt: number; token: string };

/** Atomic storage operations for the single-dispatcher lock. */
export interface LockStore {
  tryAcquire(owner: LockOwner): boolean;
  readOwner(): LockOwner;
  tryBeginReclaim(owner: LockOwner): boolean;
  readReclaimOwner(): LockOwner;
  reclaimAgeMs(now: number): number;
  finishReclaim(owner: LockOwner): void;
  abandonReclaim(): void;
  release(token: string): void;
}

export interface GitProvider {
  prepareWorkerBranch(issue: number): { branch: string; mainBaseSha: string };
  checkoutWorkerBranch(branch: string): void;
}

export interface RemoteAuthority {
  snapshot(issue: number): RemoteSnapshot;
  reconcile(issue: number, key: string): boolean;
  claim(issue: number, owner: string, expiresAt: string): void;
}
export type RemoteSnapshot = Readonly<Record<string, unknown> & { issue: number }>;

export type WorkspaceFacts = Readonly<{
  workspaceRoot: string;
  executionRoot: string;
  branch: string;
  baseSha: string;
  headSha: string;
  ownership: Readonly<{ runId: string; issue: number; protocol: string }>;
}>;

export interface WorkspaceAdapter {
  prepare(issue: number): WorkspaceFacts;
  recover(issue: number, runId: string): WorkspaceFacts | undefined;
  cleanup(facts: WorkspaceFacts): void;
  context?(): RunContext;
  readonly mode?: 'checkout' | 'worktree';
}

export type RunContext = Readonly<{
  originalRepository: string;
  executionRoot: string;
}>;

export interface RunEventLogger {
  write(type: string, data?: unknown): void;
  stream(source: 'stdout' | 'stderr' | 'codex', chunk: string): void;
}

export interface GitHubProvider<Issue, PullRequest> {
  eligible(): Issue[];
  comment(issue: number, body: string): void;
  pullRequest(pr: number): Promise<PullRequest> | PullRequest;
  updatePullRequestBody(pr: number, body: string): void | Promise<void>;
  pullRequestBody(pr: number): string | Promise<string>;
  prComment(pr: number, body: string): void | Promise<void>;
}

export interface AgentRunner<Spec> {
  run(spec: Spec): Promise<string>;
}

export interface HealthGate {
  pid(): number;
  processAlive(pid: number): boolean;
}

export interface Scheduler {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RunEventSink {
  onReclaim(): void;
}

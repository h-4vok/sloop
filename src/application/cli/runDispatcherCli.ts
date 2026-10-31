import type { Config, Deps, Status } from '../../dispatcher.js';
import type { DispatcherCommand } from '../dispatcher/DispatcherCommand.js';

type WorkflowDispatcher = (config: Config, dependencies: Deps) => Promise<0 | 4>;
type DispatcherCliCommandHandlerMap = {
  [Kind in DispatcherCommand['kind']]: (
    command: Extract<DispatcherCommand, { kind: Kind }>,
    dependencies: Deps,
    dispatchWorkflow: WorkflowDispatcher,
  ) => 0 | 4 | Promise<0 | 4>;
};

const dispatcherCliOutput = Object.freeze({
  writeStatus(dependencies: Deps, verbose: boolean): void {
    const result = dependencies.status(verbose) as {
      issue?: number;
      pr?: number;
      status?: Status;
      nextAction?: {
        command: string;
        description: string;
        mutates: boolean;
      };
      [key: string]: unknown;
    };
    const issue = result.issue;
    const pr = result.pr;

    const recoveryAction = createRecoveryAction(result.status, issue, pr, verbose);
    if (recoveryAction) result.nextAction = recoveryAction;

    console.log(JSON.stringify(result, null, 2));
  },
});

function shouldSuggestRecovery(
  status: Status | undefined,
  issue: unknown,
  pr: unknown,
  verbose: boolean,
): boolean {
  return (
    !verbose &&
    status === 'worker_recovery_pending' &&
    isPositiveIdentifier(issue) &&
    isPositiveIdentifier(pr)
  );
}

function isPositiveIdentifier(value: unknown): value is number {
  if (typeof value !== 'number') return false;
  return Number.isInteger(value) && value > 0;
}

function createRecoveryAction(
  status: Status | undefined,
  issue: unknown,
  pr: unknown,
  verbose: boolean,
) {
  if (!shouldSuggestRecovery(status, issue, pr, verbose)) return undefined;
  return {
    command: `sloop --prepare-recovery ${issue as number} --pr ${pr as number}`,
    description: 'Prepare local recovery for the failed Worker.',
    mutates: true,
  };
}

const dispatcherCliCommandHandlers: DispatcherCliCommandHandlerMap = {
  status: (command, dependencies) => {
    dispatcherCliOutput.writeStatus(dependencies, command.verbose);
    return 0;
  },

  list: (_command, dependencies) => {
    console.log(JSON.stringify(dependencies.list(), null, 2));
    return 0;
  },

  'recover-lock': (_command, dependencies) => {
    console.log(dependencies.recoverLock());
    return 0;
  },

  reset: (_command, dependencies) => {
    dependencies.reset();
    console.log('Estado local del sloop reiniciado. Ejecutá npm run sloop.');
    return 0;
  },

  'resolve-review-cap': (command, dependencies) => {
    const config = dependencies.loadConfig();
    dependencies.resolveReviewCap(command.options, config);
    console.log('Resolución HITL registrada.');
    return 0;
  },

  'link-issue': (command, dependencies) => {
    dependencies.linkIssue(command.issue);
    console.log(`Issue #${command.issue} vinculada al PR activo.`);
    return 0;
  },

  'list-all-worktrees': (_command, dependencies) => {
    console.log(JSON.stringify(dependencies.listAllWorktrees?.() ?? [], null, 2));
    return 0;
  },

  'clear-all-worktrees': (_command, dependencies) => {
    dependencies.clearAllWorktrees?.();
    console.log('Sloop worktrees cleared.');
    return 0;
  },

  'prepare-recovery': (command, dependencies) => {
    const config = dependencies.loadConfig();
    const pr = dependencies.prepareRecovery(command.issue, command.pr, config);
    console.log(
      `Recovery preparado para issue #${command.issue}, PR #${pr}. Ejecutá npm run sloop.`,
    );
    return 0;
  },

  workflow: (_command, dependencies, dispatchWorkflow) => {
    const config = dependencies.loadConfig();
    return dispatchWorkflow(config, dependencies);
  },
};

/** Executes parsed dispatcher commands and writes their CLI output. */
export const runDispatcherCli = Object.freeze({
  async run(
    command: DispatcherCommand,
    dependencies: Deps,
    dispatchWorkflow: WorkflowDispatcher,
  ): Promise<0 | 4> {
    return dispatcherCliCommandHandlers[command.kind](
      command as never,
      dependencies,
      dispatchWorkflow,
    );
  },
});

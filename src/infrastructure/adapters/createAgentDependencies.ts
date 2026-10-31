import type { RunEventLogger } from '../../core/RunEventLogger.js';
import type { Deps, Spec } from '../../dispatcher.js';
import { defaultProcessAlive } from '../../dispatcher.js';
import { checkoutWorkerBranch, prepareWorkerBranch, runCommand } from '../../dispatcher.js';
import type { RunLogger } from '../../run-log.js';
import { CodexHarness } from '../agents/harness.js';
import type { SloopConfig } from '../../config.js';
import type { ProductionAdapterOptions } from './ProductionAdapterOptions.js';
import { activeRunReconcilerFactory } from './createActiveRunReconciler.js';

/** Builds agent harness, runner, and process lifecycle dependencies. */
export function createAgentDependencies(
  config: SloopConfig,
  options: ProductionAdapterOptions,
  workspace: { getExecutionRoot: () => string },
  client: Parameters<typeof activeRunReconcilerFactory.create>[0]['client'],
  root: string,
  setRunLogger: (logger: RunEventLogger | undefined) => void,
): Pick<
  Deps,
  | 'harness'
  | 'reconcileActiveRun'
  | 'setRunLogger'
  | 'run'
  | 'prepareWorkerBranch'
  | 'checkoutWorkerBranch'
  | 'pid'
  | 'processAlive'
  | 'now'
  | 'sleep'
  | 'onReclaim'
> {
  const harness = createAgentHarness(config, options, workspace);
  return {
    harness,
    reconcileActiveRun: activeRunReconcilerFactory.create({ client, config, root }),
    setRunLogger,
    run: (spec) => runCommand(spec, workspace.getExecutionRoot()),
    prepareWorkerBranch: (issue) =>
      prepareWorkerBranch(
        issue,
        root,
        config.repository.remote,
        config.repository.baseBranch,
        config.repository.branchPrefix,
      ),
    checkoutWorkerBranch: (branch) => checkoutWorkerBranch(branch, root),
    pid: () => process.pid,
    processAlive: defaultProcessAlive,
    now: Date.now,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    onReclaim: () => {},
  };
}

function createAgentHarness(
  config: SloopConfig,
  options: ProductionAdapterOptions,
  workspace: { getExecutionRoot: () => string },
) {
  return (role: string, spec: Spec, _context: unknown, logger: RunLogger) => {
    const roleConfig = config.agents[role as keyof typeof config.agents];
    if (!roleConfig || roleConfig.harness !== 'codex')
      throw new Error(`unsupported harness for role ${role}`);

    return new CodexHarness({
      cwd: workspace.getExecutionRoot(),
      model: roleConfig.model,
      sandbox: roleConfig.sandbox,
      reasoningEffort: roleConfig.reasoningEffort,
      timeoutMs: spec.timeoutMs,
      log: (source, chunk) => logger.write(`harness-${source}`, { chunk }),
      spawn: options.codexSpawn,
    });
  };
}

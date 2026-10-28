import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { RunEventLogger } from '../../core/boundaries.js';
import type { RunLogger } from '../../run-log.js';
import type { Deps, Spec } from '../../dispatcher.js';
import { defaultProcessAlive } from '../../dispatcher.js';
import { CodexHarness } from '../agents/harness.js';
import type { SloopConfig } from '../../config.js';
import { checkoutWorkerBranch, prepareWorkerBranch, runCommand } from '../../dispatcher.js';
import { workspaceAdapter } from '../workspace/index.js';
import type { AdapterExec } from './AdapterExec.js';
import type { ProductionAdapterOptions } from './ProductionAdapterOptions.js';
import { activeRunReconcilerFactory } from './createActiveRunReconciler.js';
import { dispatcherConfigFactory } from './createDispatcherConfig.js';
import { dispatcherControlsFactory } from './createDispatcherControls.js';
import { dispatcherLockStoreFactory } from './createDispatcherLockStore.js';
import { gitHubCommandClientFactory } from './createGitHubCommandClient.js';
import { gitHubProviderFactory } from './createGitHubProvider.js';
import { remoteAuthorityFactory } from './createRemoteAuthority.js';
import { workspaceAdapterFactory } from './createWorkspaceAdapter.js';

type ProductionAgentHarnessOptions = Readonly<{
  config: SloopConfig;
  getExecutionRoot: () => string;
  codexSpawn: ProductionAdapterOptions['codexSpawn'];
}>;

const nativeAdapterExec: AdapterExec = execFileSync;

const productionHarnessFactory = Object.freeze({
  create(options: ProductionAgentHarnessOptions) {
    return (role: string, spec: Spec, _context: unknown, logger: RunLogger) => {
      const roleConfig = options.config.agents[role as keyof typeof options.config.agents];
      if (!roleConfig || roleConfig.harness !== 'codex')
        throw new Error(`unsupported harness for role ${role}`);

      return new CodexHarness({
        cwd: options.getExecutionRoot(),

        model: roleConfig.model,

        sandbox: roleConfig.sandbox,

        reasoningEffort: roleConfig.reasoningEffort,

        timeoutMs: spec.timeoutMs,

        log: (source, chunk) => logger.write(`harness-${source}`, { chunk }),

        spawn: options.codexSpawn,
      });
    };
  },
});

const productionDependencyServicesFactory = Object.freeze({
  create(
    root: string,
    validatedConfig: SloopConfig,
    repository: string,
    options: ProductionAdapterOptions,
  ) {
    const stateFile = join(root, '.sloop', 'state.json');
    const execute = options.execFileSync ?? nativeAdapterExec;
    const client = gitHubCommandClientFactory.create(root, repository, execute);
    let runLogger: RunEventLogger | undefined;
    const logGithub = (phase: string, operation: string, data: unknown) =>
      runLogger?.write(`github-${phase}`, { operation, data });
    const workspace = workspaceAdapterFactory.create({ root, stateFile, config: validatedConfig });
    const remoteAuthority = remoteAuthorityFactory.create(client, repository, logGithub);
    const githubProvider = gitHubProviderFactory.create({
      root,

      repository,

      eligibleLabel: validatedConfig.github.labels.eligible,

      priorityLabels: validatedConfig.github.labels.priority,

      execute,

      logGithub,
    });
    const config = dispatcherConfigFactory.create(validatedConfig);
    const controls = dispatcherControlsFactory.create({
      root,

      stateFile,

      repository,

      remoteAuthority,

      config,

      listEligibleIssues: githubProvider.list,

      loadPullRequest: githubProvider.pullRequest,
    });
    const lockStore = dispatcherLockStoreFactory.create(root);

    return {
      config: validatedConfig,

      controls,

      githubProvider,

      lockStore,

      remoteAuthority,

      setRunLogger: (logger: RunEventLogger | undefined) => {
        runLogger = logger;
      },

      workspace,

      client,

      stateFile,
    };
  },
});

const productionDependenciesService = Object.freeze({
  create(
    root: string,
    validatedConfig: SloopConfig,
    repository: string,
    options: ProductionAdapterOptions,
  ): Deps {
    const services = productionDependencyServicesFactory.create(
      root,
      validatedConfig,
      repository,
      options,
    );

    return {
      remoteRequired: true,

      ...services.controls,

      ...services.githubProvider,

      ...services.lockStore,

      remote: services.remoteAuthority,

      harness: productionHarnessFactory.create({
        config: services.config,

        getExecutionRoot: services.workspace.getExecutionRoot,

        codexSpawn: options.codexSpawn,
      }),

      reconcileActiveRun: activeRunReconcilerFactory.create({
        client: services.client,

        config: services.config,

        root,
      }),

      setRunLogger: services.setRunLogger,

      runContext: () => services.workspace.adapter.context!(),

      workspaceAdapter: services.workspace.adapter,

      run: (spec) => runCommand(spec, services.workspace.getExecutionRoot()),

      prepareWorkerBranch: (issue) =>
        prepareWorkerBranch(
          issue,
          root,
          services.config.repository.remote,
          services.config.repository.baseBranch,
          services.config.repository.branchPrefix,
        ),

      checkoutWorkerBranch: (branch) => checkoutWorkerBranch(branch, root),

      listAllWorktrees: () => workspaceAdapter.listWorkspaces(root, services.stateFile),

      clearAllWorktrees: () => workspaceAdapter.clearWorkspaces(root, services.stateFile),

      pid: () => process.pid,

      processAlive: defaultProcessAlive,

      now: Date.now,

      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),

      onReclaim: () => {},
    };
  },
});

/** Assembles the concrete dependencies used by the production dispatcher. */
export function productionDependencies(
  root: string,
  validatedConfig: SloopConfig,
  repository: string,
  options: ProductionAdapterOptions = {},
): Deps {
  return productionDependenciesService.create(root, validatedConfig, repository, options);
}

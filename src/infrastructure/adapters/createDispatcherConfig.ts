import type { Config } from '../../dispatcher.js';
import type { SloopConfig } from '../../config.js';

/** Maps validated repository configuration to dispatcher settings. */
export const dispatcherConfigFactory = Object.freeze({
  create(config: SloopConfig): Config {
    const createAgentCommand = (agentConfig: SloopConfig['agents']['worker']) => ({
      command: 'codex',

      args: [],

      timeoutMs: agentConfig.timeout,

      retries: agentConfig.retries,

      sessions: true,
    });

    return {
      baseBranch: config.repository.baseBranch,

      workerCommand: createAgentCommand(config.agents.worker),

      qaCommand: createAgentCommand(config.agents.qa),

      arbiterCommand: createAgentCommand(config.agents.arbiter),

      arbiterReviewRounds: config.arbiter.reviewRounds,

      arbiterStagnatingAppearances: config.arbiter.stagnatingAppearances,

      arbiterDecisionLimit: config.arbiter.decisions,

      workerLeaseMs: config.agents.worker.timeout,

      maxReviewRounds: config.arbiter.reviewRounds,

      logRoleInvocation: config.logging.roleInvocation,

      loggingRetentionMs: config.logging.retention,

      lockTtlMs: config.agents.worker.timeout,

      priorityLabels: config.github.labels.priority,
    };
  },
});

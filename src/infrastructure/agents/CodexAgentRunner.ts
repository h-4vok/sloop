import { codexCliInvocation } from '../../codex-cli.js';
import type { RunnerOptions } from './AgentRunner.js';
import { ArbitraryCommandRunner } from './ArbitraryCommandRunner.js';
import { executeAgentProcess } from './executeAgentProcess.js';

/** Adapts Codex CLI arguments and sandbox options to the shared agent runner contract. */
export class CodexAgentRunner extends ArbitraryCommandRunner {
  constructor(
    options: RunnerOptions & {
      model?: string;
      reasoningEffort?: string;
      sandbox?: 'read-only' | 'workspace-write';
    },
  ) {
    const args = [
      'exec',
      '--cd',
      options.cwd,
      '--sandbox',
      options.sandbox ?? 'workspace-write',
      '--output-schema',
      '$SLOOP_AGENT_SCHEMA',
      '--output-last-message',
      '$SLOOP_AGENT_OUTPUT',
      '$SLOOP_AGENT_INPUT_CONTENT',
    ];
    if (options.model) args.push('--model', options.model);
    if (options.reasoningEffort) {
      args.push('--config', `model_reasoning_effort=${options.reasoningEffort}`);
    }
    const execute = options.execute ?? executeAgentProcess;
    super('codex', args, {
      ...options,
      execute: async (_command, receivedArgs, processOptions) => {
        const invocation = codexCliInvocation(receivedArgs);
        return execute(invocation.command, invocation.args, {
          ...processOptions,
          ...(invocation.stdin === undefined ? {} : { stdin: invocation.stdin }),
        });
      },
    });
  }
}

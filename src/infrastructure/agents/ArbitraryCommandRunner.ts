import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentEnvelope, ProcessResult, RunContext } from './AgentEnvelope.js';
import type { AgentRunner, RunnerOptions } from './AgentRunner.js';
import { AgentContractError } from './AgentContractError.js';
import { executeAgentProcess } from './executeAgentProcess.js';
import { AgentRunWorkspace } from './AgentRunWorkspace.js';
import type { PreparedAgentRun } from './AgentRunWorkspace.js';
import { AgentResultStore } from './AgentResultStore.js';

/** Runs an arbitrary command with Sloop's envelope, retry, and persistence contract. */
export class ArbitraryCommandRunner implements AgentRunner {
  private readonly reconciled = new Map<string, AgentEnvelope>();
  private readonly workspace: AgentRunWorkspace;
  private readonly resultStore: AgentResultStore;

  constructor(
    readonly command: string,
    protected readonly args: readonly string[],
    private readonly options: RunnerOptions,
  ) {
    this.workspace = new AgentRunWorkspace(options);
    this.resultStore = new AgentResultStore(options);
  }

  async run(input: string, context: RunContext): Promise<AgentEnvelope> {
    const invocationKey = JSON.stringify([input, context]);
    const cached = this.reconciled.get(invocationKey);
    if (cached) return cached;

    const persistedPath = this.getPersistedPath(invocationKey);
    const persistedResult = await this.resultStore.readPersistedResult(persistedPath, context);
    if (persistedResult) {
      this.reconciled.set(invocationKey, persistedResult);
      return persistedResult;
    }

    const preparedRun = await this.workspace.prepare(input, context, persistedPath);
    return this.runWithRetries(input, context, invocationKey, preparedRun);
  }

  private getPersistedPath(invocationKey: string): string | undefined {
    if (!this.options.reconciliationDir) return undefined;

    const filename = createHash('sha256').update(invocationKey).digest('hex') + '.json';
    return join(this.options.reconciliationDir, filename);
  }

  private async runWithRetries(
    input: string,
    context: RunContext,
    invocationKey: string,
    preparedRun: PreparedAgentRun,
  ): Promise<AgentEnvelope> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= (this.options.retries ?? 0); attempt++) {
      await rm(preparedRun.outputPath, { force: true });

      try {
        return await this.runAttempt(input, context, invocationKey, preparedRun);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new AgentContractError('missing-result');
  }

  private async runAttempt(
    input: string,
    context: RunContext,
    invocationKey: string,
    preparedRun: PreparedAgentRun,
  ): Promise<AgentEnvelope> {
    const args = this.expandArguments(input, preparedRun.environment);
    const result = await this.executeAgent(args, preparedRun.environment);
    if (result.code !== 0 || result.signal) {
      throw new AgentContractError('operational-failure', result.stderr || 'runner failed');
    }

    const envelope = await this.resultStore.readAgentResult(preparedRun, context);
    this.reconciled.set(invocationKey, envelope);
    return envelope;
  }

  private expandArguments(input: string, environment: NodeJS.ProcessEnv): string[] {
    const inputPath = environment.SLOOP_AGENT_INPUT!;
    const outputPath = environment.SLOOP_AGENT_OUTPUT!;
    const schemaPath = environment.SLOOP_AGENT_SCHEMA!;

    return this.args.map((argument) =>
      // Replace the content token first because it shares a prefix with the input path token.
      argument
        .replaceAll('$SLOOP_AGENT_INPUT_CONTENT', input)
        .replaceAll('$SLOOP_AGENT_INPUT', inputPath)
        .replaceAll('$SLOOP_AGENT_OUTPUT', outputPath)
        .replaceAll('$SLOOP_AGENT_SCHEMA', schemaPath),
    );
  }

  private async executeAgent(
    args: string[],
    environment: NodeJS.ProcessEnv,
  ): Promise<ProcessResult> {
    try {
      return await (this.options.execute ?? executeAgentProcess)(this.command, args, {
        cwd: this.options.cwd,

        env: environment,

        timeoutMs: this.options.timeoutMs ?? 120000,

        onStdout: (chunk) => this.options.log?.('stdout', chunk),

        onStderr: (chunk) => this.options.log?.('stderr', chunk),
      });
    } catch (error) {
      throw new AgentContractError(
        'operational-failure',
        error instanceof Error ? error.message : 'runner launch failed',
      );
    }
  }
}

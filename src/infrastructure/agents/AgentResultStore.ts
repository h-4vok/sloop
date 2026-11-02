import { readFile, writeFile } from 'node:fs/promises';
import type { AgentEnvelope, RunContext } from './AgentEnvelope.js';
import type { RunnerOptions } from './AgentRunner.js';
import type { PreparedAgentRun } from './AgentRunWorkspace.js';
import { AgentContractError } from './AgentContractError.js';
import { validateAgentEnvelope } from './validateAgentEnvelope.js';

/** Validates process output and durably reconciles accepted envelopes. */
export class AgentResultStore {
  constructor(private readonly options: RunnerOptions) {}

  async readPersistedResult(
    persistedPath: string | undefined,
    context: RunContext,
  ): Promise<AgentEnvelope | undefined> {
    if (!persistedPath) return undefined;

    try {
      const text = await readFile(persistedPath, 'utf8');
      const result = validateAgentEnvelope(JSON.parse(text), context);

      return result;
    } catch {
      // A missing or invalid persisted result is not a reconciliation hit.
      return undefined;
    }
  }

  async readAgentResult(
    preparedRun: PreparedAgentRun,
    context: RunContext,
  ): Promise<AgentEnvelope> {
    try {
      const text = await readFile(preparedRun.outputPath, 'utf8');
      if (!text.trim()) throw new AgentContractError('missing-result');
      this.assertNoDuplicateJsonMembers(text);

      const result = validateAgentEnvelope(JSON.parse(text), context);

      await this.persistResult(preparedRun.persistedPath, result);
      return result;
    } catch (error) {
      throw this.toResultError(error);
    }
  }

  private assertNoDuplicateJsonMembers(text: string): void {
    // Duplicate JSON keys make the durable result ambiguous after parsing.
    const hasDuplicateMembers =
      /([{,])\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*[^,}]+\s*,\s*"\2"\s*:/.test(text);
    if (hasDuplicateMembers) throw new AgentContractError('malformed', 'duplicate JSON member');
  }

  private async persistResult(
    persistedPath: string | undefined,
    result: AgentEnvelope,
  ): Promise<void> {
    if (!persistedPath) return;

    await (this.options.writeReconciliation ?? writeFile)(persistedPath, JSON.stringify(result), {
      flag: 'wx',
    }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }

  private toResultError(error: unknown): AgentContractError {
    if (error instanceof AgentContractError) return error;
    if (error instanceof SyntaxError)
      return new AgentContractError('malformed', 'invalid JSON result');
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return new AgentContractError('missing-result');
    }

    return new AgentContractError('malformed', 'unable to read result');
  }
}

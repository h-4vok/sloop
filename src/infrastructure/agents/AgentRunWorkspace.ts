import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunContext } from './AgentEnvelope.js';
import type { RunnerOptions } from './AgentRunner.js';

/** Paths and environment prepared for one isolated agent process invocation. */
export type PreparedAgentRun = Readonly<{
  outputPath: string;
  environment: NodeJS.ProcessEnv;
  persistedPath?: string;
}>;

/** Creates isolated input, schema, and environment state for an agent run. */
export class AgentRunWorkspace {
  constructor(private readonly options: RunnerOptions) {}

  async prepare(
    input: string,
    context: RunContext,
    persistedPath: string | undefined,
  ): Promise<PreparedAgentRun> {
    const directory = await mkdtemp(join(tmpdir(), 'sloop-agent-'));
    const inputPath = join(directory, 'input.json');
    const outputPath = join(directory, 'output.json');
    const schemaPath = join(directory, 'schema.json');
    await writeFile(inputPath, input);
    await this.writeSchemaFiles(directory, schemaPath);

    if (persistedPath) {
      await mkdir(this.options.reconciliationDir!, { recursive: true });
    }

    return {
      outputPath,

      environment: this.createAgentEnvironment(inputPath, outputPath, schemaPath, context),

      persistedPath,
    };
  }

  private async writeSchemaFiles(directory: string, schemaPath: string): Promise<void> {
    const schemaRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'assets',
      'schemas',
    );
    const envelope = JSON.parse(
      await readFile(join(schemaRoot, 'sloop.agent-output.v1.json'), 'utf8'),
    ) as Record<string, unknown>;
    const definitions = envelope.$defs as Record<string, Record<string, unknown>>;
    const roleSchemas = [
      ['workerEnvelope', 'worker.v1.json'],
      ['reviewerEnvelope', 'reviewer.v1.json'],
      ['arbiterEnvelope', 'arbiter.v1.json'],
    ] as const;

    for (const [, filename] of roleSchemas) {
      const roleSchema = JSON.parse(await readFile(join(schemaRoot, filename), 'utf8')) as Record<
        string,
        unknown
      >;
      definitions[filename.slice(0, -8)] = roleSchema;
    }

    await writeFile(schemaPath, JSON.stringify(envelope));

    // Keep the declared schema's canonical references beside it for resolution.
    for (const [, filename] of roleSchemas) {
      await writeFile(
        join(directory, filename),
        await readFile(join(schemaRoot, filename), 'utf8'),
      );
    }
  }

  private createAgentEnvironment(
    inputPath: string,
    outputPath: string,
    schemaPath: string,
    context: RunContext,
  ): NodeJS.ProcessEnv {
    return {
      ...process.env,

      SLOOP_AGENT_INPUT: inputPath,

      SLOOP_AGENT_OUTPUT: outputPath,

      SLOOP_AGENT_SCHEMA: schemaPath,

      SLOOP_AGENT_RUN: context.run,

      SLOOP_AGENT_ISSUE: String(context.issue),

      SLOOP_AGENT_PR: context.pr === undefined ? '' : String(context.pr),

      SLOOP_AGENT_ROUND: String(context.round),

      SLOOP_AGENT_SHA: context.sha,

      SLOOP_AGENT_CONTEXT_CURSOR: context.cursor,
    };
  }
}

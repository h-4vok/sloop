#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
) as { version: string };

export const HELP = `Sloop ${packageJson.version}

Usage: sloop <command> [option]

Read-only commands:
  status [--verbose] [--json]  Validate and show repository context
  issues list [--json]         List eligible issues
  doctor                       Run all runtime prerequisite checks

Options:
  --help                 Show this help
  --version              Show the installed version
  --list                 List eligible issues
  --status [--verbose]   Show local run state
  --recover-lock         Recover a stale dispatcher lock
  --reset                Reset completed local run state
  --prepare-recovery N   Prepare issue N for worker recovery
  --resolve-review-cap   Record a human review-cap decision
  --link-issue N         Link issue N to the active run`;

export function requireSupportedNode(version: string): void {
  const major = Number(version.replace(/^v/, '').split('.')[0]);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(`Sloop requires Node.js 22 or newer; current runtime is ${version}.`);
  }
}

export function emitDispatcherFailure(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sloop] ${message}`);
  return error && typeof error === 'object' && 'exitCode' in error ? (error.exitCode as number) : 2;
}

type RuntimeModule = typeof import('./runtime.js');
type DispatcherModule = typeof import('./dispatcher.js');
type AdaptersModule = typeof import('./adapters.js');

export interface RunCliModules {
  runtime: Pick<
    RuntimeModule,
    | 'emitNodeVersionFailure'
    | 'emitUsageFailure'
    | 'parseReadOnlyCommand'
    | 'runDispatcherPreflight'
    | 'runReadOnlyCommand'
  >;
  dispatcher: Pick<DispatcherModule, 'runDispatcherCli'>;
  adapters: Pick<AdaptersModule, 'productionDependencies'>;
}

export async function runCli(
  args: string[],
  nodeVersion = process.version,
  modules?: RunCliModules,
): Promise<void> {
  const runtime = modules?.runtime ?? (await import('./runtime.js'));
  const {
    emitNodeVersionFailure,
    emitUsageFailure,
    parseReadOnlyCommand,
    runDispatcherPreflight,
    runReadOnlyCommand,
  } = runtime;
  try {
    requireSupportedNode(nodeVersion);
  } catch {
    process.exitCode = emitNodeVersionFailure(args, nodeVersion);
    return;
  }
  if (args.length === 1 && args[0] === '--help') {
    console.log(HELP);
    return;
  }
  if (args.length === 1 && args[0] === '--version') {
    console.log(packageJson.version);
    return;
  }
  try {
    const command = parseReadOnlyCommand(args);
    if (command) {
      process.exitCode = runReadOnlyCommand(command);
      return;
    }
  } catch (error) {
    process.exitCode = emitUsageFailure(
      args,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  const [{ runDispatcherCli }, { productionDependencies }] = modules
    ? [modules.dispatcher, modules.adapters]
    : await Promise.all([import('./dispatcher.js'), import('./adapters.js')]);
  const preflight = runDispatcherPreflight(args);
  if (!preflight.root || !preflight.config || !preflight.repository) {
    process.exitCode = preflight.code;
    return;
  }
  try {
    const result = await runDispatcherCli(
      args,
      productionDependencies(preflight.root, preflight.config, preflight.repository),
    );
    process.exitCode = result;
  } catch (error) {
    process.exitCode = emitDispatcherFailure(error);
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/cli.js')) {
  const version =
    process.env.NODE_ENV === 'test' && process.env.SLOOP_TEST_NODE_VERSION
      ? process.env.SLOOP_TEST_NODE_VERSION
      : process.version;
  void runCli(process.argv.slice(2), version).catch((error) => {
    console.error(`[sloop] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}

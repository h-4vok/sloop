#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
) as { version: string };

export const HELP = `Sloop ${packageJson.version}

Usage: sloop <command> [option]

Configuration:
  config init            Create sloop.config.yaml with defaults
  config init --wizard   Configure sloop.config.yaml interactively
  config install [--force]
                         Install configured GitHub labels and Sloop skills

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
  --prepare-recovery N [--pr PR]
                         Prepare issue N for worker recovery; use PR or existing state.pr
  --resolve-review-cap --steer TEXT [--additional-rounds N]
                         Record a human review-cap decision
                         [--waive Q1,Q2] [--waive-all-outstanding] [--abandon]
  --link-issue N         Link issue N to the active run
  --list-all-worktrees   List registered Sloop worktrees for this repository
  --clear-all-worktrees  Remove validated registered Sloop worktrees`;

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
type ConfigWizardModule = typeof import('./config-wizard.js');

export interface RunCliModules {
  runtime: Pick<
    RuntimeModule,
    | 'emitNodeVersionFailure'
    | 'emitUsageFailure'
    | 'parseCliCommand'
    | 'runDispatcherPreflight'
    | 'runReadOnlyCommand'
    | 'discoverRepository'
  >;
  dispatcher: Pick<DispatcherModule, 'runDispatcherCli'>;
  adapters: Pick<AdaptersModule, 'productionDependencies'>;
  config?: Pick<ConfigWizardModule, 'runConfigCommand'> &
    Pick<AdaptersModule, 'productionConfigReconciler'>;
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
    parseCliCommand,
    runDispatcherPreflight,
    runReadOnlyCommand,
  } = runtime;
  try {
    requireSupportedNode(nodeVersion);
  } catch {
    process.exitCode = emitNodeVersionFailure(args, nodeVersion);
    return;
  }
  let command: Awaited<ReturnType<typeof parseCliCommand>>;
  try {
    command = parseCliCommand(args);
  } catch (error) {
    process.exitCode = emitUsageFailure(
      args,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  try {
    if (command.kind === 'help') {
      console.log(helpFor(command.target));
      return;
    }
    if (command.kind === 'version') {
      console.log(packageJson.version);
      return;
    }
    if (command.kind === 'read-only') {
      process.exitCode = runReadOnlyCommand(command.command);
      return;
    }
    if (command.kind === 'config') {
      const { discoverRepository } = runtime;
      const root = discoverRepository({
        cwd: process.cwd(),
        platform: process.platform,
        nodeVersion: process.version,
        run(file, args, cwd) {
          const result = spawnSync(file, [...args], {
            cwd: cwd ?? process.cwd(),
            encoding: 'utf8',
          });
          return {
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            status: result.status ?? 1,
          };
        },
        readFile(file) {
          return readFileSync(file, 'utf8');
        },
        stdout: console.log,
        stderr: console.error,
      });
      const config = modules?.config
        ? modules.config
        : {
            ...(await import('./config-wizard.js')),
            ...(await import('./adapters.js')),
          };
      /* c8 ignore next 5 -- production import wiring is exercised by CLI smoke subprocesses. */
      process.exitCode = await config.runConfigCommand(
        root,
        command.args,
        config.productionConfigReconciler(root),
      );
      return;
    }
    const [{ runDispatcherCli }, { productionDependencies }] = modules
      ? [modules.dispatcher, modules.adapters]
      : await Promise.all([import('./dispatcher.js'), import('./adapters.js')]);
    const preflight = runDispatcherPreflight(command.command);
    if (!preflight.root || !preflight.config || !preflight.repository) {
      process.exitCode = preflight.code;
      return;
    }
    const result = await runDispatcherCli(
      command.command,
      productionDependencies(preflight.root, preflight.config, preflight.repository),
    );
    process.exitCode = result;
  } catch (error) {
    process.exitCode = emitDispatcherFailure(error);
  }
}

function helpFor(target: string): string {
  if (target === 'sloop') return HELP;
  const usage: Record<string, string> = {
    status: 'Usage: sloop status [--verbose] [--json]',
    'issues list': 'Usage: sloop issues list [--json]',
    doctor: 'Usage: sloop doctor',
    '--status': 'Usage: sloop --status [--verbose]',
    '--list': 'Usage: sloop --list',
    '--recover-lock': 'Usage: sloop --recover-lock',
    '--reset': 'Usage: sloop --reset',
    '--prepare-recovery': 'Usage: sloop --prepare-recovery N [--pr N]',
    '--resolve-review-cap':
      'Usage: sloop --resolve-review-cap --steer <text> [--additional-rounds N] [--waive Q<n>,S<n>] [--waive-all-outstanding] [--abandon]',
    '--link-issue': 'Usage: sloop --link-issue N',
  };
  return usage[target] ?? HELP;
}

/* c8 ignore start -- process entrypoint failures are verified by CLI subprocess tests. */
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
/* c8 ignore stop */

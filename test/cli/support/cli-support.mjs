import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, vi } from 'vitest';
import { ExternalServiceError } from '../../../src/core/ExternalServiceError.js';
import { CliFailure } from '../../../src/dispatcher.js';
import {
  createCli,
  createHelp,
  emitDispatcherFailure,
  requireSupportedNode,
  startCli,
} from '../../../src/application/cli/index.js';
import { createNodeHost } from '../../../src/infrastructure/host/index.js';
import { EXIT, resultOutput } from '../../../src/runtime.js';

const cli = resolve('dist/cli.js');

const versionPattern = /^\d+\.\d+\.\d+$/;

const packageVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;

const HELP = createHelp(packageVersion).text;

let activeOutput;

async function runCli(args, nodeVersion = process.version, modules) {
  const output = activeOutput ?? { stdout: [], stderr: [] };
  const logger = {
    log: (message) => output.stdout.push(message),

    error: (message) => output.stderr.push(message),
  };
  const compatibleModules = modules?.runtime?.parseCliCommand
    ? {
        ...modules,

        runtime: {
          ...modules.runtime,

          parseCliCommand: (...parseArgs) =>
            invokeCompatibleParser(modules.runtime.parseCliCommand, parseArgs),

          discoverRepository: (...runtimeArgs) => {
            const discovered = modules.runtime.discoverRepository?.(...runtimeArgs);
            return normalizeCliResult(discovered);
          },
        },
      }
    : modules;
  const cliRunner = createCli({
    host: { ...createNodeHost(), nodeVersion },

    logger,

    version: packageVersion,

    modules: compatibleModules,
  });
  process.exitCode = await cliRunner.runCliCommand(args);
}

function invokeCompatibleParser(parser, args) {
  try {
    return normalizeCliResult(parser(...args));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeCliResult(value) {
  if (value && typeof value === 'object' && 'ok' in value) return value;
  return { ok: true, value };
}

function captureCliOutput() {
  const output = { stdout: [], stderr: [] };
  activeOutput = output;
  return {
    ...output,

    restore() {
      activeOutput = undefined;
    },
  };
}

export { cli, versionPattern, packageVersion, HELP, activeOutput, runCli, captureCliOutput };

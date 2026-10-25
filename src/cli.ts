#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startCli } from './application/cli/index.js';
import { consoleLogger } from './infrastructure/index.js';

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
) as { version: string };

export const cli = Object.freeze({
  runCli(args: readonly string[], nodeVersion = process.version): Promise<void> {
    return startCli.start(args, packageJson.version, nodeVersion);
  },
});

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/cli.js')) {
  const nodeVersion =
    process.env.NODE_ENV === 'test' && process.env.SLOOP_TEST_NODE_VERSION
      ? process.env.SLOOP_TEST_NODE_VERSION
      : process.version;
  void cli.runCli(process.argv.slice(2), nodeVersion).catch((error) => {
    consoleLogger.error(`[sloop] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}

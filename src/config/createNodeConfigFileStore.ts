import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { ConfigValidationError, type SloopConfig } from './types.js';
import type { ConfigFileStore } from './ConfigFileStore.js';
import { configYaml } from './configYaml.js';

/** Provides atomic Node-backed storage for the configuration boundary. */
export const configFileStore = Object.freeze({
  exists(file: string): boolean {
    return existsSync(file);
  },

  read(file: string): string {
    return readFileSync(file, 'utf8');
  },

  remove(file: string): void {
    rmSync(file, { force: true });
  },

  writeAtomically(file: string, content: string): void {
    const temporaryFile = join(dirname(file), '.' + randomUUID() + '.sloop.tmp');
    const backupFile = join(dirname(file), '.' + randomUUID() + '.sloop.bak');

    try {
      writeFileSync(temporaryFile, content, { encoding: 'utf8', flag: 'wx' });
      if (process.platform !== 'win32' || !existsSync(file)) {
        renameSync(temporaryFile, file);
        return;
      }

      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[System.IO.File]::Replace($env:SLOOP_CONFIG_TEMP, $env:SLOOP_CONFIG_DEST, $env:SLOOP_CONFIG_BACKUP)',
        ],
        {
          stdio: 'ignore',
          env: {
            ...process.env,
            SLOOP_CONFIG_TEMP: temporaryFile,
            SLOOP_CONFIG_DEST: file,
            SLOOP_CONFIG_BACKUP: backupFile,
          },
        },
      );
    } finally {
      rmSync(temporaryFile, { force: true });
      rmSync(backupFile, { force: true });
    }
  },

  loadConfigFile(file: string): SloopConfig {
    if (extname(file).toLowerCase() === '.json')
      throw new ConfigValidationError([
        {
          path: '$',
          message:
            'pre-alpha JSON configuration is unsupported; run ' +
            String.fromCharCode(96) +
            'sloop config init' +
            String.fromCharCode(96),
        },
      ]);

    const loadResult = configYaml.loadConfigTextResult(
      readFileSync(file, 'utf8'),
      warnUnknownConfigKey,
    );
    if (!loadResult.ok) throw loadResult.error;
    return loadResult.value;
  },

  updateConfigFile(file: string, path: string, value: unknown): void {
    const updateResult = configYaml.updateConfigTextResult(
      readFileSync(file, 'utf8'),
      path,
      value,
      warnUnknownConfigKey,
    );
    if (!updateResult.ok) throw updateResult.error;
    const next = updateResult.value;
    const temporaryFile = join(dirname(file), '.' + randomUUID() + '.sloop.tmp');

    try {
      writeFileSync(temporaryFile, next, { encoding: 'utf8', flag: 'wx' });
      renameSync(temporaryFile, file);
    } finally {
      rmSync(temporaryFile, { force: true });
    }
  },
} satisfies ConfigFileStore & {
  loadConfigFile(file: string): SloopConfig;
  updateConfigFile(file: string, path: string, value: unknown): void;
});

function warnUnknownConfigKey(path: string): void {
  console.warn(`${path}: unknown configuration key; ignoring it`);
}

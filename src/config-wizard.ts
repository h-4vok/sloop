import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  canonicalConfigYaml,
  configPaths,
  configValue,
  getConfigField,
  loadConfigText,
  parseConfigValue,
  updateConfigText,
} from './config.js';

export async function runConfigCommand(root: string, args: readonly string[]): Promise<number> {
  const file = join(root, 'sloop.config.yaml');
  const show = args[0] === 'show';
  const path = show ? args[1] : args[0];
  if (show) {
    if (!existsSync(file)) {
      console.error('No valid sloop.config.yaml; run sloop init');
      return 2;
    }
    try {
      const cfg = loadConfigText(readFileSync(file, 'utf8'));
      if (!path) console.log(readFileSync(file, 'utf8'));
      else {
        const field = getConfigField(path);
        if (!field)
          throw new Error(`unknown path ${path}; valid paths: ${configPaths().join(', ')}`);
        console.log(JSON.stringify(configValue(cfg, path)));
      }
      return 0;
    } catch (error) {
      console.error(String(error instanceof Error ? error.message : error));
      return 2;
    }
  }
  if (path && args[1] && args[1] !== '--sync' && args[1] !== '--no-sync') {
    const field = getConfigField(path);
    if (!field) {
      console.error(`unknown path ${path}; valid paths: ${configPaths().join(', ')}`);
      return 2;
    }
    if (
      [
        'github.labels.eligible',
        'github.labels.claimed',
        'github.labels.blocked',
        'github.labels.priority',
        'workflow.reviewOrder',
      ].includes(path)
    ) {
      console.error(`${path} is canonical and read-only in v1; see #55`);
      return 2;
    }
    if (!existsSync(file)) {
      console.error('No valid sloop.config.yaml; run sloop init');
      return 2;
    }
    try {
      const source = readFileSync(file, 'utf8');
      const cfg = loadConfigText(source);
      const value = parseConfigValue(field, args[1]!);
      const next = updateConfigText(source, path, value);
      atomicWrite(file, next);
      console.log(`${path}: ${String(configValue(cfg, path))} -> ${String(value)}`);
      return 0;
    } catch (error) {
      console.error(String(error instanceof Error ? error.message : error));
      return 2;
    }
  }
  if (!input.isTTY || !output.isTTY) {
    console.error('sloop init/config wizard requires a TTY');
    return 2;
  }
  return runWizard(file, path);
}

async function runWizard(file: string, scope?: string): Promise<number> {
  const rl = createInterface({ input, output });
  try {
    const source = existsSync(file) ? readFileSync(file, 'utf8') : canonicalConfigYaml();
    const current = loadConfigText(source);
    let next = source;
    const fields = configPaths(scope)
      .map((path) => getConfigField(path)!)
      .filter(
        (field) =>
          ![
            'github.labels.eligible',
            'github.labels.claimed',
            'github.labels.blocked',
            'github.labels.priority',
            'workflow.reviewOrder',
          ].includes(field.path),
      );
    for (const field of fields) {
      if (field.type === 'list' || field.type === 'argv') {
        console.log(
          `${field.path}: ${field.explanation} (complex value; keep current in this wizard)`,
        );
        continue;
      }
      const old = configValue(current, field.path);
      const answer = await rl.question(
        `${field.path}\n  ${field.explanation}\n  recommendation: ${field.recommendation}\n  value [${String(old)}]: `,
      );
      if (answer.trim())
        next = updateConfigText(next, field.path, parseConfigValue(field, answer.trim()));
    }
    loadConfigText(next);
    console.log('Preview ready. Confirm changes? [y/N]');
    if ((await rl.question('> ')).trim().toLowerCase() !== 'y') return 0;
    atomicWrite(file, next);
    console.log('Configuration written atomically.');
    return 0;
  } finally {
    rl.close();
  }
}
function atomicWrite(file: string, content: string): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, { flag: 'wx' });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

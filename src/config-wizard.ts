import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { stdin as input, stdout as output } from 'node:process';
import {
  canonicalConfigYaml,
  configPaths,
  configValue,
  getConfigField,
  loadConfigText,
  parseConfigValue,
  updateConfigText,
  type FieldMetadata,
} from './config.js';
const CANONICAL = new Set([
  'github.labels.eligible',
  'github.labels.claimed',
  'github.labels.blocked',
  'github.labels.priority',
  'workflow.reviewOrder',
]);
export type ConfigReconciler = (
  root: string,
  reconciler: FieldMetadata['requiredReconciler'],
) => void | Promise<void>;
export type ConfigReconcilerWithPreflight = ConfigReconciler & {
  preflight?: (root: string, reconciler: FieldMetadata['requiredReconciler']) => void;
};
export type WizardIO = {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
};

/** The runtime may provide the existing reconciler adapters; tests can observe ordering here. */
/**
 * The CLI must provide a concrete adapter when one exists.  Keeping the
 * default deliberately failing is safer than claiming that --sync worked
 * while silently doing nothing (the repository currently has no production
 * skill/scheduler/workspace reconciler implementation).
 */
export const reconcileConfig: ConfigReconciler = async (_root, kind) => {
  throw new Error(
    `No production reconciler is available for ${kind}; use --no-sync or configure an adapter.`,
  );
};
(reconcileConfig as ConfigReconcilerWithPreflight).preflight = (_root, kind) => {
  if (kind !== 'none')
    throw new Error(
      `No production reconciler is available for ${kind}; use --no-sync or configure an adapter.`,
    );
};

export async function runConfigCommand(
  root: string,
  args: readonly string[],
  reconciler: ConfigReconcilerWithPreflight = reconcileConfig,
  io: WizardIO = { input, output },
): Promise<number> {
  const file = join(root, 'sloop.config.yaml');
  const init = args.includes('--init');
  const flags = args.filter((a) => a === '--sync' || a === '--no-sync');
  const sync = flags[0];
  const positional = args.filter((a) => !a.startsWith('--'));
  if (flags.length > 1) return fail('choose only one of --sync or --no-sync');
  if (positional[0] === 'show') return show(file, positional[1]);
  if (
    positional.length === 1 &&
    !getConfigField(positional[0]!) &&
    configPaths(positional[0]!).length === 0
  )
    return fail(`unknown path ${positional[0]}; valid paths: ${configPaths().join(', ')}`);
  if (!init && positional.length >= 2)
    return setter(root, file, positional[0]!, positional.slice(1).join(' '), sync, reconciler);
  if (!io.input.isTTY || !io.output.isTTY)
    return fail(
      init
        ? 'sloop init requires a TTY'
        : 'sloop config wizard requires a TTY; scalar setters and config show do not',
    );
  return wizard(root, file, positional[0], init, sync, reconciler, io);
}
function fail(message: string): number {
  console.error(message);
  return 2;
}
function show(file: string, path?: string): number {
  if (!existsSync(file)) return fail('No valid sloop.config.yaml; run sloop init');
  try {
    const cfg = loadConfigText(readFileSync(file, 'utf8'));
    if (!path) console.log(readFileSync(file, 'utf8'));
    else {
      const field = getConfigField(path);
      if (!field && configPaths(path).length === 0)
        throw new Error(`unknown path ${path}; valid paths: ${configPaths().join(', ')}`);
      console.log(JSON.stringify(configValue(cfg, path)));
    }
    return 0;
  } catch (e) {
    return fail(String(e instanceof Error ? e.message : e));
  }
}
async function setter(
  root: string,
  file: string,
  path: string,
  raw: string,
  sync: string | undefined,
  reconciler: ConfigReconcilerWithPreflight,
): Promise<number> {
  const field = getConfigField(path);
  if (!field) return fail(`unknown path ${path}; valid paths: ${configPaths().join(', ')}`);
  if (CANONICAL.has(path)) return fail(`${path} is canonical and read-only in v1; see #55`);
  if (!existsSync(file)) return fail('No valid sloop.config.yaml; run sloop init');
  if (field.type === 'list' || field.type === 'argv')
    return fail(`${path}: complex values require the interactive wizard`);
  if (field.requiredReconciler !== 'none' && sync === undefined)
    return fail(`${path} affects ${field.requiredReconciler}; specify --sync or --no-sync`);
  const rl = createInterface({ input, output });
  try {
    const source = readFileSync(file, 'utf8');
    const cfg = loadConfigText(source);
    const value = parseConfigValue(field, raw);
    const next = updateConfigText(source, path, value);
    loadConfigText(next);
    if (sync === '--sync' && field.requiredReconciler !== 'none')
      reconciler.preflight?.(root, field.requiredReconciler);
    console.log(
      `Preview\n${path}: ${display(configValue(cfg, path))} -> ${display(value)}\nConfirm changes? [y/N]`,
    );
    if (input.isTTY && output.isTTY && (await rl.question('> ')).trim().toLowerCase() !== 'y')
      return 0;
    atomicWrite(file, next);
    console.log('Configuration written atomically.');
    if (sync === '--sync') {
      await reconciler(root, field.requiredReconciler);
      console.log(`Synchronization completed for ${field.requiredReconciler}.`);
    }
    return 0;
  } catch (e) {
    return fail(String(e instanceof Error ? e.message : e));
  } finally {
    rl.close();
  }
}
async function wizard(
  root: string,
  file: string,
  scope: string | undefined,
  init: boolean,
  sync?: string,
  reconciler: ConfigReconcilerWithPreflight = reconcileConfig,
  io: WizardIO = { input, output },
): Promise<number> {
  const legacy = join(root, 'sloop.config.json');
  if (init && existsSync(legacy))
    console.log(`Legacy JSON detected at ${legacy}; it will remain untouched and inert.`);
  const source = existsSync(file) ? readFileSync(file, 'utf8') : canonicalConfigYaml();
  let current = loadConfigText(source);
  let next = source;
  const changed: string[] = [];
  // A first-time init must still create the canonical document when every
  // prompt accepts its default. Keep this as a pending mutation so creation
  // follows the same preview/confirmation/atomic-write transaction.
  if (init && !existsSync(file))
    changed.push('sloop.config.yaml: missing -> canonical v1 configuration');
  const rl = createInterface({ input: io.input, output: io.output });
  try {
    for (const path of configPaths(scope)) {
      const field = getConfigField(path)!;
      if (CANONICAL.has(path)) {
        console.log(`${path}: canonical read-only (see #55)`);
        continue;
      }
      if (field.dependencies.length && !dependenciesSatisfied(current, field)) {
        for (const dependency of field.dependencies) {
          const [dependencyPath, expected] = dependency.split('=');
          if (String(configValue(current as never, dependencyPath!)) !== expected) {
            const dependencyField = getConfigField(dependencyPath!);
            if (!dependencyField)
              throw new Error(`${path} requires companion path ${dependencyPath}=${expected}`);
            let answer = await askField(rl, dependencyField, current, `required by ${path}`);
            let value: unknown;
            while (true) {
              try {
                if (!answer.trim())
                  throw new Error(`${path} requires companion path ${dependencyPath}=${expected}`);
                value = parseWizardValue(dependencyField, answer.trim());
                break;
              } catch (error) {
                console.error(String(error instanceof Error ? error.message : error));
                answer = await askField(rl, dependencyField, current, `required by ${path}`);
              }
            }
            const old = configValue(current, dependencyPath!);
            next = updateConfigText(next, dependencyPath!, value);
            current = loadConfigText(next);
            changed.push(`${dependencyPath}: ${display(old)} -> ${display(value)}`);
          }
        }
        if (!dependenciesSatisfied(current, field))
          throw new Error(`${path} requires companion path ${field.dependencies.join(', ')}`);
      }
      const old = configValue(current, path);
      let answer = await askField(rl, field, current);
      if (!answer.trim()) continue;
      let value: unknown;
      while (true) {
        try {
          value = parseWizardValue(field, answer.trim());
          break;
        } catch (error) {
          console.error(String(error instanceof Error ? error.message : error));
          answer = await askField(rl, field, current);
        }
      }
      next = updateConfigText(next, path, value);
      changed.push(`${path}: ${display(old)} -> ${display(value)}`);
    }
    loadConfigText(next);
    if (sync === '--sync') {
      const kinds = new Set(
        changed.map((line) => getConfigField(line.split(':', 1)[0]!)?.requiredReconciler),
      );
      for (const kind of kinds) if (kind && kind !== 'none') reconciler.preflight?.(root, kind);
    }
    console.log(
      changed.length
        ? `Preview\n${changed.join('\n')}\nConfirm changes? [y/N]`
        : 'No changes proposed.',
    );
    if (!changed.length || (await rl.question('> ')).trim().toLowerCase() !== 'y') return 0;
    const gitignore =
      init && (await rl.question('Add .sloop/ to .gitignore? [Y/n] ')).trim().toLowerCase() !== 'n'
        ? prepareGitignore(root)
        : undefined;
    const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    atomicWrite(file, next);
    try {
      if (gitignore) atomicWrite(gitignore.file, gitignore.content);
    } catch (error) {
      if (before === undefined) rmSync(file, { force: true });
      else atomicWrite(file, before);
      throw error;
    }
    if (sync === '--sync') {
      const kinds = new Set(
        changed.map((line) => getConfigField(line.split(':', 1)[0]!)?.requiredReconciler),
      );
      for (const kind of kinds) if (kind && kind !== 'none') await reconciler(root, kind);
      console.log('Synchronization completed after atomic configuration write.');
    }
    console.log('Configuration written atomically.');
    return 0;
  } catch (e) {
    return fail(String(e instanceof Error ? e.message : e));
  } finally {
    rl.close();
  }
}
function dependenciesSatisfied(cfg: unknown, field: FieldMetadata): boolean {
  return field.dependencies.every((d) => {
    const [p, v] = d.split('=');
    return String(configValue(cfg as never, p!)) === v;
  });
}
async function askField(
  rl: ReturnType<typeof createInterface>,
  field: FieldMetadata,
  cfg: unknown,
  context?: string,
): Promise<string> {
  return rl.question(
    `${field.path}${context ? ` (${context})` : ''}\n  ${field.explanation}\n  options: ${field.choices.length ? field.choices.join(', ') : 'free value'}\n  recommendation: ${field.recommendation}\n  value [${display(configValue(cfg as never, field.path))}]: `,
  );
}
function parseWizardValue(field: FieldMetadata, raw: string): unknown {
  if (field.type === 'list')
    return field.parser(
      raw.split(',').map((x) => x.trim()),
      `$.${field.path}`,
    );
  if (field.type === 'argv') return field.parser(JSON.parse(raw), `$.${field.path}`);
  return parseConfigValue(field, raw);
}
function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
function prepareGitignore(root: string): { file: string; content: string } {
  const file = join(root, '.gitignore');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  return {
    file,
    content: text.split(/\r?\n/).includes('.sloop/')
      ? text
      : `${text && !text.endsWith('\n') ? '\n' : ''}.sloop/\n`,
  };
}
function atomicWrite(file: string, content: string): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  const backup = `${file}.${randomUUID()}.bak`;
  try {
    writeFileSync(temp, content, { flag: 'wx' });
    if (process.platform !== 'win32' || !existsSync(file)) {
      renameSync(temp, file);
      return;
    }

    // Windows does not allow renameSync to replace an existing file. Use the
    // native ReplaceFile operation through PowerShell; unlike a backup/rename
    // sequence, it keeps the destination continuously bound to a complete
    // old or new file if the process is interrupted.
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
          SLOOP_CONFIG_TEMP: temp,
          SLOOP_CONFIG_DEST: file,
          SLOOP_CONFIG_BACKUP: backup,
        },
      },
    );
  } finally {
    rmSync(temp, { force: true });
    rmSync(backup, { force: true });
  }
}

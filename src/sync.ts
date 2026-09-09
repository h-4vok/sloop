import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SloopConfig } from './config.js';

export type SyncRunner = (file: string, args: readonly string[], cwd: string) => string;
export type SyncOptions = { runner?: SyncRunner; output?: (message: string) => void };
const canonical = [
  ['Automation Ready', '0E8A16', 'Issue fully specified and eligible for the local loop'],
  ['Automation Claimed', '1D76DB', 'Issue currently claimed by Sloop'],
  ['Automation Blocked', 'B60205', 'Issue blocked by Sloop'],
  ['Priority: P0', 'B60205', 'Highest configured Sloop selection priority'],
  ['Priority: P1', 'D93F0B', 'Medium configured Sloop selection priority'],
  ['Priority: P2', 'FBCA04', 'Lowest configured Sloop selection priority'],
] as const;
const names = ['sloop-dispatcher', 'sloop-worker', 'sloop-qa'] as const;
const defaultRunner: SyncRunner = (file, args, cwd) =>
  execFileSync(file, [...args], { cwd, encoding: 'utf8' });

function repoName(remote: string): string {
  const value = remote.replace(/\.git$/, '').replace(/\\/g, '/');
  const match = value.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
  if (!match) throw new Error(`Configured remote is not a GitHub repository: ${remote}`);
  return match[1]!;
}

function safeSkillRoot(root: string, config: SloopConfig): string {
  const target =
    config.skills.scope === 'repository'
      ? join(root, '.codex', 'skills')
      : join(homedir(), '.codex', 'skills');
  const resolved = resolve(target);
  const scope = resolve(config.skills.scope === 'repository' ? root : homedir());
  const rel = relative(scope, resolved);
  if (rel === '..' || rel.startsWith(`..${requireSep()}`) || isAbsolute(rel))
    throw new Error('Configured skills destination escapes its allowed scope.');
  return resolved;
}
function requireSep(): string {
  return process.platform === 'win32' ? '\\' : '/';
}
function asset(root: string, name: string): string {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'skills', name, 'SKILL.md'),
  ];
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`Missing bundled skill asset: ${name}`);
  return found;
}

export function syncPrerequisites(
  root: string,
  config: SloopConfig,
  options: SyncOptions = {},
): void {
  const legacy = config.skills.required.filter((name) =>
    ['dispatcher', 'worker', 'qa-sdet'].includes(name),
  );
  if (legacy.length)
    throw new Error(
      `Legacy skill names detected (${legacy.join(', ')}); run sloop init before synchronizing.`,
    );
  const runner = options.runner ?? defaultRunner;
  const out = options.output ?? console.log;
  const remote = runner('git', ['remote', 'get-url', config.repository.remote], root).trim();
  const repository = repoName(remote);
  const labels = [
    config.github.labels.eligible,
    config.github.labels.claimed,
    config.github.labels.blocked,
    ...config.github.labels.priority,
  ];
  for (const label of labels) {
    const metadata = canonical.find(([name]) => name === label);
    if (!metadata) continue;
    const existing = JSON.parse(
      runner(
        'gh',
        [
          'label',
          'list',
          '--repo',
          repository,
          '--search',
          label,
          '--json',
          'name,color,description',
        ],
        root,
      ) || '[]',
    ) as { name: string; color: string; description: string }[];
    if (existing.some((item) => item.name === label)) {
      out(`Label '${label}' already exists; preserved its metadata.`);
      continue;
    }
    runner(
      'gh',
      [
        'label',
        'create',
        label,
        '--repo',
        repository,
        '--color',
        metadata[1],
        '--description',
        metadata[2],
      ],
      root,
    );
    out(`Label '${label}' installed.`);
  }
  const destination = safeSkillRoot(root, config);
  mkdirSync(destination, { recursive: true });
  for (const name of names) {
    const source = asset(root, name);
    const target = join(destination, name, 'SKILL.md');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source));
    out(`Skill '${name}' installed at ${target}.`);
  }
  out(`Synchronized ${labels.length} labels and ${names.length} Sloop skills.`);
}

export function migrateSkillNames(configText: string): string {
  return configText.replace(
    /(^\s*- )(dispatcher|worker|qa-sdet)(\s*$)/gm,
    (_all, prefix, name, suffix) =>
      `${prefix}${name === 'dispatcher' ? 'sloop-dispatcher' : name === 'worker' ? 'sloop-worker' : 'sloop-qa'}${suffix}`,
  );
}

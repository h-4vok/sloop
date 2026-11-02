import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SloopConfig } from '../../config.js';
import type { SyncOptions, SyncRunner } from './checkSyncPrerequisites.js';
import { getSkillAsset, getSkillDestination } from './skillPaths.js';

const canonicalLabels = [
  ['Automation Ready', '0E8A16', 'Issue fully specified and eligible for the local loop'],
  ['Automation Claimed', '1D76DB', 'Issue currently claimed by Sloop'],
  ['Automation Blocked', 'B60205', 'Issue blocked by Sloop'],
  ['Priority: P0', 'B60205', 'Highest configured Sloop selection priority'],
  ['Priority: P1', 'D93F0B', 'Medium configured Sloop selection priority'],
  ['Priority: P2', 'FBCA04', 'Lowest configured Sloop selection priority'],
] as const;

const bundledSkills = [
  'product-lead',
  'sloop-worker',
  'sloop-qa',
  'sloop-test-cleanup',
  'sloop-e2e-prepare',
  'sloop-test-empty-e2e',
] as const;

const defaultRunner: SyncRunner = (file, args, cwd) =>
  execFileSync(file, [...args], { cwd, encoding: 'utf8' });

function syncLabels(
  root: string,
  config: SloopConfig,
  repository: string,
  runner: SyncRunner,
  output: (message: string) => void,
): number {
  const labels = [
    config.github.labels.eligible,
    config.github.labels.claimed,
    config.github.labels.blocked,
    ...config.github.labels.priority,
  ];

  for (const label of labels) {
    syncLabel(root, repository, runner, output, label);
  }

  return labels.length;
}

function syncLabel(
  root: string,
  repository: string,
  runner: SyncRunner,
  output: (message: string) => void,
  label: string,
): void {
  const metadata = canonicalLabels.find(([name]) => name === label);
  if (!metadata) return;
  if (labelAlreadyExists(root, repository, runner, output, label)) return;

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
  output(`Label '${label}' installed.`);
}

function labelAlreadyExists(
  root: string,
  repository: string,
  runner: SyncRunner,
  output: (message: string) => void,
  label: string,
): boolean {
  const response = runner(
    'gh',
    ['label', 'list', '--repo', repository, '--search', label, '--json', 'name,color,description'],
    root,
  );
  const existingLabels = JSON.parse(response || '[]') as { name: string }[];
  if (!existingLabels.some((item) => item.name === label)) return false;
  output(`Label '${label}' already exists; preserved its metadata.`);
  return true;
}

function syncSkills(root: string, config: SloopConfig, output: (message: string) => void): void {
  const destination = getSkillDestination(root, config);
  mkdirSync(destination, { recursive: true });
  for (const name of bundledSkills) {
    const source = getSkillAsset(name);
    const target = join(destination, name, 'SKILL.md');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source));
    output(`Skill '${name}' installed at ${target}.`);
  }
}

/** Installs canonical GitHub labels and the distributed Sloop skills. */
export function executeSync(
  root: string,
  config: SloopConfig,
  repository: string,
  options: SyncOptions,
): void {
  const runner = options.runner ?? defaultRunner;
  const output = options.output ?? console.log;
  const labelCount = syncLabels(root, config, repository, runner, output);

  syncSkills(root, config, output);
  output(`Synchronized ${labelCount} labels and ${bundledSkills.length} Sloop skills.`);
}

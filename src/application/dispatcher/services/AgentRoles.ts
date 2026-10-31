/** Coordinates agent roles operations for dispatcher workflows. */
import { agentRoleCommands } from './agentRoleCommands.js';
import { join } from 'node:path';
import { mkdirSync, appendFileSync } from 'node:fs';
import { createRolePrompt } from './createRolePrompt.js';

function roleUpdate(role: 'worker' | 'qa', context: string, feedback: string): string {
  const label = role === 'worker' ? 'New worker task or recovery update' : 'New QA review update';
  return `${label}:\n${[context, feedback].filter(Boolean).join('\n\n') || '(no new update; inspect the current checkout and PR)'}`;
}

function appendWorkerRoundContext(
  root: string,
  issue: number,
  round: number,
  pr: number | undefined,
  context: string,
  feedback: string,
  steer: string | undefined,
): void {
  const directory = join(root, '.sloop', 'worker-rounds');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `issue-${issue}--worker-rounds.md`);
  const entry = [
    `# Dispatcher context for issue-${issue}-round-${round}`,
    '',
    `- Issue: #${issue}; round: ${round}; PR: ${pr ? `#${pr}` : 'none'}`,
    `- Prior work/context: ${context || '(none)'}`,
    `- HITL steer: ${steer || 'none supplied'}`,
    `- QA/Staff/CI feedback: ${feedback || '(none)'}`,
    '- Result: Worker execution started; completion evidence is in the run log.',
    '- Deviations: none recorded at dispatch time.',
    '',
  ].join('\n');
  appendFileSync(file, `${entry}\n`, 'utf8');
}

function workerMetadata(output: string, knownPr?: number): { pr?: number; base?: string } {
  const match = output.match(/^\s*WORKER_RESULT\s+pr=(\d+)\s+base=([^\s]+)\s*$/im);
  if (match) return { pr: Number(match[1]), base: match[2] };
  if (knownPr) return { pr: knownPr, base: 'main' };
  // Codex can complete the PR and evidence steps, then omit the final marker.
  const summaryPr = output.match(/\bPR\s+(?:\[#?|#)(\d+)\]?/i);
  if (summaryPr) return { pr: Number(summaryPr[1]), base: 'main' };
  throw new Error('Worker must exit 0 and print WORKER_RESULT pr=<number> base=main');
}

export const AgentRoles = {
  command: agentRoleCommands.command,

  rolePrompt: createRolePrompt,

  roleUpdate,

  appendWorkerRoundContext,

  roleCommand: agentRoleCommands.roleCommand,

  workerMetadata,
};

/** Coordinates ci evidence operations for dispatcher workflows. */
import type {
  Check,
  Deps,
  Config,
  PullRequest,
} from '../../../application/dispatcher/types/index.js';
import { join } from 'node:path';
import { RunStatePolicy } from './RunStatePolicy.js';
const { status } = RunStatePolicy;
import { PullRequestReader } from './PullRequestReader.js';
const { pullRequest } = PullRequestReader;
import type { CiState } from '../types/CiState.js';

function normalizeCheckStatus(check: Check): { complete: boolean; passed: boolean } {
  const status = String(check.status ?? '').toLowerCase();
  const conclusion = String(check.conclusion ?? '').toLowerCase();
  const complete =
    conclusion !== '' &&
    !['queued', 'in_progress', 'pending', 'waiting', 'requested'].includes(status);
  const passed = complete && ['success', 'passed', 'neutral', 'skipped'].includes(conclusion);
  return { complete, passed };
}

function checkFeedback(checks: Check[]): string {
  return checks
    .map(
      (check) =>
        `[CI] ${check.name || 'unnamed'}: ${check.conclusion ?? check.status ?? 'unknown'}${check.detailsUrl ? ` ${check.detailsUrl}` : ''}`,
    )
    .join('\n');
}

function ciState(checks: Check[]): CiState {
  if (checks.some((check) => !normalizeCheckStatus(check).complete)) return 'running';
  return checks.every((check) => normalizeCheckStatus(check).passed) ? 'green' : 'red';
}

async function waitForCi(
  d: Deps,
  cfg: Config,
  issue: number,
  prNumber: number,
): Promise<{ passed: boolean; evidence: PullRequest; feedback?: string }> {
  const deadline = d.now() + (cfg.checkTimeoutMs ?? 900000);
  let latest = await d.pullRequest(prNumber);
  status(d, issue, 'ci_pending', { pr: prNumber, headSha: latest.headRefOid });
  while (true) {
    const checks = latest.statusCheckRollup ?? [];
    const state = ciState(checks);
    if (state === 'red') {
      const feedback = checkFeedback(checks);
      status(d, issue, 'ci_failed', { lastCiFeedback: feedback, mainGreen: false });
      return { passed: false, evidence: latest, feedback };
    }
    if (state === 'green') {
      const feedback = checkFeedback(checks);
      d.save({
        ...d.load(),

        mainGreen: true,

        lastCiFeedback: feedback,

        headSha: latest.headRefOid,
      });
      return { passed: true, evidence: latest };
    }
    if (d.now() >= deadline)
      throw new Error(`PR checks did not finish before timeout: ${checkFeedback(checks)}`);
    console.error(
      `[sloop] issue #${issue}: esperando checks del PR #${prNumber}: ${checkFeedback(checks)}`,
    );
    await d.sleep(cfg.checkPollIntervalMs ?? 5000);
    latest = await d.pullRequest(prNumber);
  }
}

export const CiEvidence = {
  normalizeCheckStatus,

  checkFeedback,

  ciState,

  waitForCi,
};

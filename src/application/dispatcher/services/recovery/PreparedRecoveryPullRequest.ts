import type { Config, Deps, PullRequest } from '../../../../application/dispatcher/types/index.js';
import type { RunManifest } from '../../../../remote-state.js';
import { result, type Result } from '../../../../core/Result.js';

/** Validates the PR saved by local recovery preparation before remote adoption. */
async function fetchPreparedRecoveryPullRequest(
  d: Deps,
  cfg: Config,
  issue: number,
  manifest: RunManifest,
): Promise<Result<PullRequest | undefined, Error>> {
  const state = d.load();
  if (!state.preparedRecovery || state.issue !== issue || !state.pr)
    return result.success(undefined);
  const preparedPr = state.pr;
  try {
    const evidence = await d.pullRequest(preparedPr);
    const reason = validatePreparedRecoveryPullRequest(evidence, cfg, issue, state, manifest);
    if (reason)
      return result.failure(
        new Error(`prepared recovery PR #${preparedPr} failed validation: ${reason}`),
      );

    return result.success(evidence);
  } catch (error) {
    return result.failure(error instanceof Error ? error : new Error(String(error)));
  }
}

function validatePreparedRecoveryPullRequest(
  evidence: PullRequest,
  cfg: Config,
  issue: number,
  state: ReturnType<Deps['load']>,
  manifest: RunManifest,
): string | undefined {
  const identityError = validatePreparedRecoveryIdentity(evidence, cfg, state);
  if (identityError) return identityError;
  const branchError = validatePreparedRecoveryBranch(evidence, state, manifest);
  if (branchError) return branchError;
  if (!closesIssue(evidence.body, issue))
    return `PR body does not associate it with issue #${issue}`;

  return undefined;
}

function validatePreparedRecoveryIdentity(
  evidence: PullRequest,
  cfg: Config,
  state: ReturnType<Deps['load']>,
): string | undefined {
  if (evidence.number !== state.pr) return 'PR identity does not match local recovery state';
  if (evidence.state?.toUpperCase() !== 'OPEN') return 'PR is not open';
  if (evidence.baseRefName !== (cfg.baseBranch ?? 'main'))
    return `PR base must be ${cfg.baseBranch ?? 'main'}`;

  return undefined;
}

function validatePreparedRecoveryBranch(
  evidence: PullRequest,
  state: ReturnType<Deps['load']>,
  manifest: RunManifest,
): string | undefined {
  if (!state.branch || evidence.headRefName !== state.branch)
    return 'PR head branch does not match the persisted recovery branch';
  if (manifest.branch !== 'pending' && manifest.branch !== state.branch)
    return 'remote manifest branch does not match the persisted recovery branch';
  if (manifest.pr !== undefined && manifest.pr !== state.pr)
    return 'remote manifest PR identity conflicts with local recovery state';
  if (!evidence.headRefOid) return 'PR has no recoverable head commit';

  return undefined;
}

function closesIssue(body: string | undefined, issue: number): boolean {
  return new RegExp(
    `^\\s*(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\\s+#${issue}\\b\\s*$`,
    'im',
  ).test(body ?? '');
}

export const PreparedRecoveryPullRequest = { fetchPreparedRecoveryPullRequest };

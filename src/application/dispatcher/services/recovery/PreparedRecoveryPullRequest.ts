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
  if (!hasPreparedRecoveryForIssue(state, issue)) return result.success(undefined);

  const preparedPr = state.pr;
  return readPreparedRecoveryPullRequest(d, cfg, issue, manifest, state, preparedPr);
}

function hasPreparedRecoveryForIssue(
  state: ReturnType<Deps['load']>,
  issue: number,
): state is ReturnType<Deps['load']> & { pr: number } {
  return Boolean(state.preparedRecovery && state.issue === issue && state.pr);
}

async function readPreparedRecoveryPullRequest(
  d: Deps,
  cfg: Config,
  issue: number,
  manifest: RunManifest,
  state: ReturnType<Deps['load']> & { pr: number },
  preparedPr: number,
): Promise<Result<PullRequest | undefined, Error>> {
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
  const issueAssociationError = validatePreparedRecoveryIssueAssociation(evidence, issue);
  if (issueAssociationError) return issueAssociationError;

  return undefined;
}

function validatePreparedRecoveryIdentity(
  evidence: PullRequest,
  cfg: Config,
  state: ReturnType<Deps['load']>,
): string | undefined {
  const baseBranch = cfg.baseBranch ?? 'main';
  if (evidence.number !== state.pr) return 'PR identity does not match local recovery state';
  if (evidence.state?.toUpperCase() !== 'OPEN') return 'PR is not open';
  if (evidence.baseRefName !== baseBranch) return `PR base must be ${baseBranch}`;

  return undefined;
}

function validatePreparedRecoveryBranch(
  evidence: PullRequest,
  state: ReturnType<Deps['load']>,
  manifest: RunManifest,
): string | undefined {
  if (!matchesPreparedRecoveryBranch(evidence, state))
    return 'PR head branch does not match the persisted recovery branch';
  if (hasConflictingManifestBranch(manifest, state))
    return 'remote manifest branch does not match the persisted recovery branch';
  if (hasConflictingManifestPullRequest(manifest, state))
    return 'remote manifest PR identity conflicts with local recovery state';
  if (!evidence.headRefOid) return 'PR has no recoverable head commit';

  return undefined;
}

function matchesPreparedRecoveryBranch(evidence: PullRequest, state: ReturnType<Deps['load']>) {
  return Boolean(state.branch && evidence.headRefName === state.branch);
}

function hasConflictingManifestBranch(
  manifest: RunManifest,
  state: ReturnType<Deps['load']>,
): boolean {
  return manifest.branch !== 'pending' && manifest.branch !== state.branch;
}

function hasConflictingManifestPullRequest(
  manifest: RunManifest,
  state: ReturnType<Deps['load']>,
): boolean {
  return manifest.pr !== undefined && manifest.pr !== state.pr;
}

function validatePreparedRecoveryIssueAssociation(
  evidence: PullRequest,
  issue: number,
): string | undefined {
  if (closesIssue(evidence.body, issue)) return undefined;

  return `PR body does not associate it with issue #${issue}`;
}

function closesIssue(body: string | undefined, issue: number): boolean {
  return new RegExp(
    `^\\s*(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\\s+#${issue}\\b\\s*$`,
    'im',
  ).test(body ?? '');
}

export const PreparedRecoveryPullRequest = { fetchPreparedRecoveryPullRequest };

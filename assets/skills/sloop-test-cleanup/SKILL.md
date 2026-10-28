---
name: sloop-test-cleanup
description: Clean the dedicated sloop-test-empty manual E2E fixture locally and on GitHub without merging or deleting main.
---

# Sloop Test Cleanup

Use only for `h-4vok/sloop-test-empty`. This is a manual PowerShell runbook. It may be invoked from the Sloop repository or another directory; all fixture operations must run from `C:\src\sloop-test-empty`.

## Safety boundary

- Before running any Git, GitHub, or Sloop fixture command, set `$targetRoot = 'C:\src\sloop-test-empty'` and `Push-Location -LiteralPath $targetRoot`. Keep that location until cleanup is verified, then `Pop-Location` to restore the caller's directory. A dirty caller checkout is unrelated and must not block cleanup or be modified.
- Require `gh repo view --json nameWithOwner --jq .nameWithOwner` to equal `h-4vok/sloop-test-empty` and `git remote get-url origin` to resolve to that repository.
- Require the repository root to be `C:\src\sloop-test-empty`.
- Never merge, delete `main`, delete issues, delete commits, or run `git clean`.
- Close only issues and pull requests labeled `Sloop E2E`. After closing those PRs, remove stale local/remote `codex/issue-*` branches only when no open PR uses them. Preserve all other branch prefixes.
- If a Sloop dispatcher or Codex child is still running, wait for it to exit. Never kill processes or discard a dirty worktree. Stop and report unexpected files.
- Preserve GitHub issue/PR comments as audit evidence.

## Cleanup steps

1. Set `$repoRoot = (Resolve-Path .).Path`; verify the target root is exactly `C:\src\sloop-test-empty`. Verify `gh repo view --json nameWithOwner --jq .nameWithOwner` returns `h-4vok/sloop-test-empty`, `git remote get-url origin` points to that repository, and the target's `git status --porcelain` is empty. Stop on any mismatch or dirty target checkout; do not inspect the caller's Git status.
2. Capture only scoped artifacts:

   ```powershell
   $testIssues = gh issue list --repo h-4vok/sloop-test-empty --state open --label 'Sloop E2E' --json number | ConvertFrom-Json
   $testPullRequests = gh pr list --repo h-4vok/sloop-test-empty --state open --label 'Sloop E2E' --json number,headRefName,headRefOid | ConvertFrom-Json
   ```

   Verify every PR branch matches `^codex/issue-\d+-[a-z0-9]+$`. Preserve the captured PR branch names for local cleanup.

3. Close each captured PR with `gh pr close <number> --delete-branch --repo h-4vok/sloop-test-empty`. Do not merge it. Close each captured issue with `gh issue close <number> --repo h-4vok/sloop-test-empty`, then remove `Automation Ready`, `Automation Claimed`, `Automation Blocked`, and `Sloop E2E` labels.
4. Run `git fetch origin --prune`, `git switch main`, and `git pull --ff-only origin main`.
5. On `main`, collect local/remote branches matching `^codex/issue-\d+(-[a-z0-9]+)?$` and list all open PR head branches. Stop if an open PR uses a matching branch. Delete matching remote branches with `git push origin --delete <branch>` and local branches with `git branch -D -- <branch>`. Never delete `main` or another branch prefix.
6. Run `sloop --clear-all-worktrees`, then `sloop --reset`. Let the supported command reset active/completed status; do not delete `.sloop` files directly. Use `sloop --recover-lock` only when Sloop reports a stale lock and no dispatcher is running. Keep logs and plans as audit evidence.

7. Verify no open issue or PR labeled `Sloop E2E`, no captured remote/local test branches, clean `git status --short`, current branch `main`, and `sloop status --verbose --json` reports no active issue.

If an iteration failed, capture its issue, PR, status, and error before cleanup. Cleanup still closes its labeled artifacts after the evidence is recorded.

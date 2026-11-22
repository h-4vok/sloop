---
name: sloop-e2e-prepare
description: Run one manual Sloop E2E cycle in h-4vok/sloop-test-empty, verify Worker and QA evidence, and clean the fixture after success.
---

# Sloop E2E One-Cycle

Run exactly one manual smoke cycle in PowerShell. Do not create scripts or automate the loop. Orchestration decides whether to invoke this skill again.

## Target repository context

This skill may be invoked from `C:\src\sloop` or any other directory. The fixture is always `C:\src\sloop-test-empty`; never use the caller's repository, branch, or dirty status as a fixture precondition. Before any fixture Git, GitHub, or Sloop command, set `$targetRoot = 'C:\src\sloop-test-empty'` and `Push-Location -LiteralPath $targetRoot`. Keep that location for the full cycle and restore the caller's location with `Pop-Location`, including on failure. Do not mutate the caller's checkout.

## Procedure

1. Read and follow `C:\src\sloop\.codex\skills\sloop-test-cleanup\SKILL.md` to clean the fixture before the cycle. Require repo identity `h-4vok/sloop-test-empty`, root `C:\src\sloop-test-empty`, branch `main`, clean status, no `.sloop/mutex`, no open `Sloop E2E` issue/PR, and no active Sloop run. Require Worker and QA sandboxes set to `danger-full-access`. Ensure the `Sloop E2E` label exists without changing its metadata.

2. Refuse to start if `MANUAL-E2E.md` exists on `main`. Create one issue titled `[Sloop E2E] Manual smoke <timestamp>` with `Sloop E2E` and `Automation Ready` labels. Its acceptance criteria require a root `MANUAL-E2E.md` containing exactly one line `sloop-e2e-ok` and no other tracked changes. Do not merge the test PR. Use PowerShell:

   ```powershell
   $cycle = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
   $body = @'
   Add a root-level MANUAL-E2E.md containing exactly one line: sloop-e2e-ok.

   Acceptance criteria:
   1. MANUAL-E2E.md exists at the repository root.
   2. It contains exactly one line: sloop-e2e-ok.
   3. No other tracked files change.

   Do not merge this test PR.
   '@
   $issueUrl = gh issue create --repo h-4vok/sloop-test-empty --title "[Sloop E2E] Manual smoke $cycle" --body $body --label 'Sloop E2E' --label 'Automation Ready'
   $issueNumber = [int]($issueUrl.TrimEnd('/') -split '/' | Select-Object -Last 1)
   ```

3. Confirm `gh issue view $issueNumber --repo h-4vok/sloop-test-empty --json state,labels` reports an open issue with both labels. Run `sloop` from the fixture and record its exact output and exit code. Require exit 0 and `sloop status --verbose --json` to report this issue as `ready_for_human_merge` with a PR number. If Sloop exits 0 and status says `done` without claiming the still-open eligible issue, wait briefly and invoke it once more; that no-op is not a cycle. If it still does not claim the issue, preserve the artifacts and report failure.

4. Verify the PR is open, targets `main`, is mergeable, and changes only `MANUAL-E2E.md`. Verify that file contains exactly `sloop-e2e-ok` with no other tracked changes. Require one current-head `[Worker]` comment with `status=ready_for_review` and one `[QA/SDET Review] round=1 verdict=passed`, both containing the correct PR/base and matching PR head SHA. Record CI as passing or “no checks reported.” Add the `Sloop E2E` label to the PR.

5. Before cleanup, record the issue, PR, branch, head SHA, Worker and QA results, Sloop status, and CI result. Then read and follow `C:\src\sloop\.codex\skills\sloop-test-cleanup\SKILL.md` to clean the fixture after this successful cycle. Do not merge the PR. Verify `main`, clean status, idle Sloop, no mutex, no open `Sloop E2E` items, and no test branches.

If any precondition or cycle check fails, stop without post-cycle cleanup. Preserve the issue, PR, branch, Sloop state, comments, and logs for diagnosis, and report the exact failure and exit code. Run cleanup before the next cycle only after orchestration decides to retry.

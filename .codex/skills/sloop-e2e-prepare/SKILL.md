---
name: sloop-e2e-prepare
description: Create and manually run one minimal Sloop end-to-end issue in h-4vok/sloop-test-empty, then verify Worker, QA, and ready-for-merge evidence.
---

# Sloop E2E Prepare and Run

Run one manual smoke cycle in PowerShell. Do not create scripts or automate the loop.

## Preconditions

- Require repo identity `h-4vok/sloop-test-empty`, root `C:\src\sloop-test-empty`, branch `main`, and clean `git status --short`.
- Require `sloop.config.yaml` to set both Worker and QA sandboxes to `danger-full-access`.
- Require no open PR or issue labeled `Sloop E2E`; run `sloop-test-cleanup` first if any remain.
- Refuse to start if `MANUAL-E2E.md` already exists on `main` or another Sloop run is active.
- Ensure label `Sloop E2E` exists; preserve its metadata if present.

## One-cycle procedure

After creating the issue, confirm `gh issue view <number> --repo h-4vok/sloop-test-empty --json state,labels` shows it open with both `Sloop E2E` and `Automation Ready` labels before invoking `sloop`. If `sloop` exits 0 but `sloop status --verbose --json` reports `done` without claiming this still-open eligible issue, wait a few seconds and invoke `sloop` once more. That no-op is not a test cycle. If the second invocation does not claim the issue, preserve it and report failure.

1. Create a unique issue titled `[Sloop E2E] Manual smoke <timestamp>`, labeled `Sloop E2E` and `Automation Ready`. Use PowerShell:

   ```powershell
   $cycle = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
   $body = @'
   Add a root-level MANUAL-E2E.md containing exactly one line: sloop-e2e-ok.

   Acceptance criteria:
   1. MANUAL-E2E.md exists at the repository root.
   2. It contains exactly one line: sloop-e2e-ok.
   3. No other tracked files change.

   The user has authorized the required Worker and QA comments on this test PR; do not merge.
   '@
   $issueUrl = gh issue create --repo h-4vok/sloop-test-empty --title "[Sloop E2E] Manual smoke $cycle" --body $body --label 'Sloop E2E' --label 'Automation Ready'
   $issueNumber = [int]($issueUrl.TrimEnd('/') -split '/' | Select-Object -Last 1)
   ```

2. Run `sloop` from `C:\src\sloop-test-empty`; record exact exit code and output. Require exit code 0 and `sloop status --verbose --json` to report this issue as `ready_for_human_merge` with a PR number.
3. Fetch the PR and require it open, targeting `main`, mergeable, and containing only `MANUAL-E2E.md`. Verify file has one content line `sloop-e2e-ok` and no other tracked files changed.
4. Require exactly one current-head `[Worker]` comment with `status=ready_for_review`, correct PR/base/commit, and exactly one `[QA/SDET Review] round=1 verdict=passed` comment with the same commit. Record CI as either passing or “no checks reported”; do not invent checks.
5. Add label `Sloop E2E` to the PR so cleanup can target it. Do not merge. Return issue, PR, branch, SHA, Worker result, QA result, Sloop status, and CI status.

If any condition fails, stop without cleanup. Preserve issue, PR, branch, Sloop state, and logs for diagnosis; report exact failure and exit code.

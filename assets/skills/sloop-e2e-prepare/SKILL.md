---
name: sloop-e2e-prepare
description: Prepare the dedicated sloop-test-empty fixture and manually run one minimal Sloop end-to-end cycle.
---

# Sloop E2E Prepare and Run

Run one manual smoke cycle in PowerShell. Do not script or automate the loop.

## Target and safety

- Always use `C:\src\sloop-test-empty`, regardless of the caller's current directory or checkout.
- Before fixture work, save the caller's location and enter the fixture with `Push-Location -LiteralPath 'C:\src\sloop-test-empty'`. Keep all fixture GitHub, Git, and Sloop commands in that location, then restore the caller's location with `Pop-Location` in `finally`.
- Verify the resolved root, `gh repo view --json nameWithOwner --jq .nameWithOwner`, and `git remote get-url origin` identify `h-4vok/sloop-test-empty`.
- Never discard unrelated working-tree changes. If the fixture has changes outside known Sloop E2E artifacts, stop and report them.
- If a Sloop dispatcher or Codex child process is still running, wait for it to finish. Never kill it.
- Never merge the test PR or delete `main`.
- Do not clean up after the cycle. Preserve the issue, PR, branch, Sloop state, and logs as evidence; cleanup is a separate skill.

## Prepare the fixture

1. Inspect issues and PRs labeled `Sloop E2E`, then inspect `sloop status --verbose --json`.
2. If a labeled E2E issue or PR exists, or Sloop has leftover run state, follow `assets/skills/sloop-test-cleanup/SKILL.md`. That skill owns closing/removing only the disposable E2E artifacts and resetting Sloop. Recheck repository identity and fixture state afterward.
3. A test branch is expected and is not a reason to stop. Once the fixture is clean and Sloop is idle, switch the fixture to `main` and fast-forward it:

   ```powershell
   git fetch origin --prune
   git switch main
   git pull --ff-only origin main
   ```

   If the local `main` branch does not exist, use `git switch --track -c main origin/main` after fetching, then run `git pull --ff-only origin main`. Never abort just because the current branch is `codex/issue-*`.

4. Verify `git branch --show-current` is `main`, `git status --short` is empty, no labeled E2E issue or PR remains open, and Sloop reports no active issue. Confirm `MANUAL-E2E.md` does not already exist on `main`.
5. Confirm `sloop.config.yaml` sets both Worker and QA sandboxes to `danger-full-access`. Ensure the `Sloop E2E` and `Automation Ready` labels exist; preserve existing label metadata.

## Run one cycle

1. Create one issue titled `[Sloop E2E] Manual smoke <timestamp>`, labeled `Sloop E2E` and `Automation Ready`. Use a unique timestamp and this body:

   ```text
   Add a root-level MANUAL-E2E.md containing exactly one line: sloop-e2e-ok.

   Acceptance criteria:
   1. MANUAL-E2E.md exists at the repository root.
   2. It contains exactly one line: sloop-e2e-ok.
   3. No other tracked files change.
   ```

   Confirm the issue is open with both labels before running Sloop.

2. Run `sloop` in the fixture. Capture its exact output and exit code. If it exits 0 without completing this issue, inspect status and run it once more only if the dispatcher reports a normal no-op/queued state.
3. Require exit code 0 and `sloop status --verbose --json` to show this issue at `ready_for_human_merge` with its PR number. If any run or verification step fails, stop and preserve the issue, PR, branch, Sloop state, and logs; report the exact command, output, and exit code. Do not clean up a failed cycle.
4. Verify the PR is open, targets `main`, is mergeable, and changes only root `MANUAL-E2E.md` with exactly the line `sloop-e2e-ok`. Check the current PR head SHA against the Worker and QA evidence. Require one current-head `[Worker] status=ready_for_review` comment and one `[QA/SDET Review] round=1 verdict=passed` comment. Report CI as passing, failing, or no checks reported; do not infer a result when none are configured.
5. Add the `Sloop E2E` label to the PR so the cleanup skill can identify it. Do not merge. Report the issue, PR, branch, SHA, Worker result, QA result, Sloop status, and CI status.

Always restore the caller's location with `Pop-Location`, including when a command fails.

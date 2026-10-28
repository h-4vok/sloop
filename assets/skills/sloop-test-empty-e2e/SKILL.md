---
name: sloop-test-empty-e2e
description: Run five manual Sloop end-to-end smoke cycles in h-4vok/sloop-test-empty, clean between cycles, and leave the fixture clean.
---

# Sloop Test Empty E2E

Use this skill from `C:\src\sloop` when asked to run the repeatable manual Sloop E2E test. This orchestrates PowerShell workflows; it does not automate them with a script.

## Required result

Five consecutive cycles must each create a labeled issue, run the real `sloop` CLI, produce one PR, receive valid Worker and QA evidence for the current head, and reach `ready_for_human_merge`. Cleanup runs before every cycle, after every successful cycle, and once at the end. No PR is merged.

## Procedure

1. Verify source branch and current build: `npm run build`; verify global `sloop` links to `C:\src\sloop`. Confirm target identity is `h-4vok/sloop-test-empty`, target root is `C:\src\sloop-test-empty`, and Worker/QA use `danger-full-access`.
2. Read and follow `.codex/skills/sloop-test-cleanup/SKILL.md` to establish a clean baseline.
3. For cycles 1 through 5, sequentially:
   - Run the one-cycle procedure in `.codex/skills/sloop-e2e-prepare/SKILL.md`.
   - Record issue, PR, head SHA, Worker comment, QA comment, `ready_for_human_merge`, and CI result.
   - On any failure, stop immediately and preserve the failed run for diagnosis. Do not count a partial run.
   - After passing cycles 1–4, run `sloop-test-cleanup` and verify clean baseline before starting the next cycle.
4. After cycle 5, run `sloop-test-cleanup` once. Verify `main`, clean worktree, no open `Sloop E2E` issues/PRs, no test branches, no active Sloop run, and no registered test worktrees.
5. Return a five-row result table plus final cleanup proof. A cycle counts only if Worker and QA comments match its PR head and Sloop reported `ready_for_human_merge` with exit code 0.

Never merge PRs, delete issues, touch non-test issues/PRs, discard uncommitted work, or broaden the cleanup scope beyond `h-4vok/sloop-test-empty`.

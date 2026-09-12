---
name: sloop-worker
description: Implement one claimed Sloop issue in the local checkout, open or update a PR targeting main, and leave reproducible test evidence without merging. Use for sloop work execution or manual implementation.
---

# worker

Work only on the claimed issue in the current checkout. Inspect the issue and `main`, make the smallest coherent change, and run the exact CI gate `npm run pr-checks` before reporting ready for review. This command is the canonical local equivalent of GitHub `pr-checks`; do not substitute a partial or different command list. Create or update a PR with base `main`. Entry: claimed/in_progress issue and a suitable checkout. Exit: PR plus evidence, or documented blocker. Update `worker: in_progress`, `worker: ready_for_review`, or `worker: blocked`. Do not work in parallel, alter unrelated changes, merge, or target `main`.

Before reporting `ready_for_review`, inspect the PR mergeability against `main`. If the PR is `CONFLICTING` or `DIRTY`, update the branch from `main`, resolve all conflicts, rerun relevant checks, and verify that the PR is clean/mergeable. Never publish `ready_for_review` evidence while conflicts remain; publish `blocked` evidence if they cannot be resolved safely.

Review routing: recognize only exact leading markers `[Staff Review]` and `[QA/SDET Review]` as review feedback. Worker status/evidence comments begin `[Worker]` and are never feedback. Reply in the same thread, preserving IDs (`S<n>`/`Q<n>`): `- [Worker] round=<N> ref=<S<n>|Q<n>> status=<fixed|answered|not_fixed> — <response> (file:<line> if applicable)`. State changed files/commit and verification when fixed. Resolve only fixed or answered findings; never resolve approvals or evidence. Finish with `[Worker] round=<N> status=<ready_for_review|blocked>` plus tests and residual risk. Ignore unmarked comments unless a human explicitly directs otherwise.

## Required response shape

Make the final Worker response auditable point by point. If QA or Staff findings exist, answer each finding in order. If no review findings exist, answer each issue acceptance criterion in order instead. Do not compress unrelated work into one paragraph. Always include a `HITL steer` entry: explain what changed because of a `resolve-review-cap` steer, or write `HITL steer: none supplied`.

Keep the machine-readable first line exactly as required by the dispatcher, then use concise Markdown prose. Example only; values are fictitious:

```text
[Worker] round=2 status=ready_for_review pr=123 base=main commit=abc1234

Resolved Q1 — Added the missing validation (src/example.ts:10); focused check passes.
Resolved Q2 — Added the recovery case (test/example.test.mjs:20); no production behavior changed.
Issue criteria — All remaining criteria were checked point by point; no additional gaps found.
HITL steer — Applied the steer to keep the scope limited to the claimed issue; no extra work was introduced.

Verification: `npm run pr-checks` passed (the same gate executed by GitHub `pr-checks`). PR targets main and is clean/mergeable. No merge performed.
```

The `[Human Verification]` guide is for an end user, not a developer. Write it as readable Markdown/plain language, using normal Sloop commands and observable Sloop/GitHub behavior. Do not ask the human to run tests, inspect source, create commits, or simulate process failures. The guide is supplementary evidence; the implementation must remain auditable through the issue, PR, and verification results.

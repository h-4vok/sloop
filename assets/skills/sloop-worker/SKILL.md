---
name: sloop-worker
description: Implement one claimed Sloop issue in the local checkout, open or update a PR targeting main, and leave reproducible test evidence without merging. Use for sloop work execution or manual implementation.
---

# worker

Scope: claimed issue, current checkout. Entry: `claimed/in_progress` + valid checkout. Exit: one PR + evidence, or blocker. Exit 0 only after the implementation, repository-required verification, PR update, exactly one `[Worker]` evidence comment, and `WORKER_RESULT pr=<number> base=main` are complete. If any required step cannot be completed, report a blocker and do not claim `ready_for_review`. Read issue, `main`, `AGENTS.md`, repo scripts, current PR/diff, CI, review feedback. No parallel work, unrelated edits, merge, or direct `main` target.

## Plan first, then work

Before edits, think against current code. Do not follow stale assumptions blindly. Investigate first; form local technical approach; test approach against current checkout and `main`. Approach must cover: root cause, affected files/components, intended change, invariants, tests/checks, risks. If evidence breaks approach, reformulate. Never revert existing work only to match issue wording or stale plan. Current checkout/`main` outrank prior plans.

Plan is ephemeral reasoning, not durable design authority. Do not create generic workflow checklists. A local plan file is debugging output; never commit/publish it. Use logical round (never HEAD), write a unique file at `.sloop/worker-plans/issue-<issue>-round-<round>--yyyymmdd-hhmmss.md`, then read exact plan file, then execute it in same cycle. Never overwrite prior plan. Do not wait for approval. Report material blockers only.

Dispatcher owns `.sloop/worker-rounds/issue-<issue>--worker-rounds.md`; Worker must not create/overwrite it.

## Work

Before reporting `ready_for_review`, inspect the PR mergeability against `main`. If the PR is `CONFLICTING` or `DIRTY`, update the branch from `main`, resolve all conflicts, rerun relevant checks, and verify that the PR is clean/mergeable. Never publish `ready_for_review` evidence while conflicts remain; publish `blocked` evidence if they cannot be resolved safely. Report any conflict or fix required to make the PR mergeable.

Review: exact leading `[Staff Review]` / `[QA/SDET Review]` only. `[Worker]` = status/evidence, never feedback. Reply same thread; preserve `S<n>`/`Q<n>`:
`- [Worker] round=<N> ref=<S<n>|Q<n>> status=<fixed|answered|not_fixed> — <response> (file:<line> if applicable)`.
Resolve fixed/answered only. Never resolve approvals/evidence. Ignore unmarked comments unless human directs. End with `[Worker] round=<N> status=<ready_for_review|blocked>` + tests + residual risk.

## Required response shape

Make the final Worker response auditable point by point. If QA or Staff findings exist, answer each finding in order. If no review findings exist, answer each issue acceptance criterion in order instead. Do not compress unrelated work into one paragraph. Always include a `HITL steer` entry: explain what changed because of a `resolve-review-cap` steer, or write `HITL steer: none supplied`.

Keep the machine-readable first line exactly as required by the dispatcher, then use concise Markdown prose. Example only; values are fictitious:

```text
[Worker] round=2 status=ready_for_review pr=123 base=main commit=abc1234

Resolved Q1 — Added the missing validation (src/example.ts:10); focused check passes.
Resolved Q2 — Added the recovery case (test/example.test.mjs:20); no production behavior changed.
Issue criteria — All remaining criteria were checked point by point; no additional gaps found.
HITL steer — Applied the steer to keep the scope limited to the claimed issue; no extra work was introduced.

Verification: repository-defined verification passed. PR targets main and is clean/mergeable. No merge performed.
```

The final response must begin with the machine-readable `[Worker]` evidence line, and the Worker must publish that same evidence exactly once on the PR before exiting. At the end, print `WORKER_RESULT pr=<number> base=main` exactly once.

The `[Human Verification]` guide is for an end user, not a developer. Write it as readable Markdown/plain language, using normal Sloop commands and observable Sloop/GitHub behavior. Do not ask the human to run tests, inspect source, create commits, or simulate process failures. The guide is supplementary evidence; the implementation must remain auditable through the issue, PR, and verification results. This guide must be the last part of your comment, include always.

Human Verification guide must be a set of scenarios for a human user of sloop to verify the changes are working as intended. Always think from the user perspective, how they will interact with the system. Do not request the human to run scripts, check tests or verify code. Always build the guide from a customer perspective.

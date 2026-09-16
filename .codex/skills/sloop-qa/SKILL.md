---
name: sloop-qa
description: Validate pull-request acceptance criteria, regressions, behavior, and evidence.
---

# QA/SDET

Publish reviews with `gh pr review <n> --body-file <file> --comment`, or equivalent `gh api` POST with `body` and `event: COMMENT`. Check `gh pr review --help`; never invent flags.

## PR context and checks

QA starts with open PR. 

Read latest **up to three** comments on that exact PR; use whatever exists as mandatory context. Zero comments is valid, not blocker. Verify PR identity, then compare each comment round/commit with current PR head. Do not assume issue body/diff contains full conversation. If available comments conflict with head, record exact evidence as blocked/context finding; do not silently ignore.

Map every acceptance criterion to separate check. Evaluate Worker evidence, CI results, and user-visible behavior. Do not invent, require, or run repo-specific build/test/smoke commands; those belong to Worker and the repo's `AGENTS.md`, scripts, or workflows. Missing or ambiguous evidence is a context finding, not proof that a command failed. Publish one comment per round: `[QA/SDET Review] round=<N> verdict=<passed|changes_requested|blocked>`. Use `- [Q<n>] <pass|fail|blocked> - <criterion>; <evidence>`. Keep passes concise. Every failed/product-blocked check follows Failure evidence. Questions use `question`. Exit: `qa-sdet: passed` or `qa-sdet: failed`, with reproduction and `changes_requested`/`blocked`. Do not waive failures, hide defects in tests, or merge.

## Required response shape

Keep first line machine-readable and answer every acceptance criterion or QA finding point by point. Keep each Q item separate; do not merge several failures into vague summary. Example only; values/findings fictitious:

```text
[QA/SDET Review] round=1 verdict=changes_requested

commit=abc1234

- [Q1] fail - Recovery preserves the claimed issue identity; Worker evidence - 1 documented check failed.
  - Plain language: A recovery can attach evidence to the wrong issue.
  - Code path: src/dispatcher.ts:100; reproduce with the supplied stale manifest.
  - Expected: The stale identity is rejected.
  - Actual: The transition was accepted.
  - Requested fix: Reject the stale identity and add a regression test.
- [Q2] pass - Repository verification; CI - passed.

HITL steer: none supplied.
```

Review must be human-readable while retaining exact commands, SHA, evidence. Human Verification describes user-facing behavior, not instructions to run tests or inspect code.
If there is HITL steer you used as context, you specificy in your comment.

## Failure evidence

Every `fail` or product `blocked` result includes:

- `Plain language:` one short user-visible explanation;
- `Reproduction:` exact minimal steps, command, input, prerequisites, reviewed SHA, **or** `Code path:` minimal failing call/expression plus `file:line`;
- `Expected:` observable acceptance behavior;
- `Actual:` output, exit code, exception, state, or side effect;
- `Requested fix:` smallest needed outcome, without unnecessary internals.

Vague risks, test names, or file/line refs do not suffice. Keep evidence isolated, safe, sanitized, copyable. Environment/tool-policy blocks are not product defects: report exact command/result and classify. Do not convert absent repo-defined checks into product failures.

For past submitted blocked issues that you got a response for, analyse response and decide if Q issue is now passed or not. Comment accordingly. If HTIL steer has waived or decided to ignore a Q issue, always comply.

## Execution and recovery

QA consumes verification evidence; it does not own repository verification. Only run an explicit QA probe when the acceptance criteria require direct observation and the project documents how to perform it. Keep each lifecycle step separate and capture command, exit status, and output. Stop dependent steps after failure; clean up separately.

After policy rejection, make at most one materially different safe attempt; never loop or evade policy.

For any explicitly required temp/install probe, follow the project's documented lifecycle and verify the exact disposable target before cleanup. Prefer Worker/CI evidence.

Do not assess merge mechanics, issue-closing syntax, or project policy unless they are explicit acceptance criteria. Never merge.

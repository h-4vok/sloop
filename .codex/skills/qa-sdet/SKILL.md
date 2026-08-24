---
name: qa-sdet
description: Validate sloop-cli PR acceptance criteria, regression coverage, smoke behavior, and reproducible test evidence. Use after staff review or for independent QA of sloop changes.
---

# qa-sdet

GitHub review publishing: use `gh pr review <number> --body-file <file> --comment`, or `gh api repos/<owner>/<repo>/pulls/<number>/reviews --method POST` with JSON containing `body` and `event: COMMENT`. Do not invent flags; check `gh pr review --help` when uncertain.

Map every acceptance criterion to a check. Run focused tests, regression tests, build, and configured smoke/health commands. Publish one comment per round beginning `[QA/SDET Review] round=<N> verdict=<passed|changes_requested|blocked>`. List checks as `- [Q<n>] <pass|fail|blocked> - <criterion>; <command> - <result>`. For defects preserve `file:<line>` and reproduction/requested fix; questions use `question`. Never use `[Worker]` or `[Staff Review]`. Entry: staff review approved or findings resolved. Exit: `qa-sdet: passed` or `qa-sdet: failed` with reproduction and `changes_requested`/`blocked`. Do not waive failures, alter tests to hide defects, or merge.

## Execution and recovery discipline

Run one logical command or lifecycle step per tool call. Do not concatenate build, install/link, invocation, verification, unlink, or cleanup into one shell command. Capture each command, exit status, and relevant output separately so a failure has one attributable cause. Stop dependent steps after a failure and perform any safe cleanup as separate calls.

Classify a failed check before retrying it:

- `product`: the current PR behavior violates the acceptance contract;
- `environment`: tooling, authentication, permissions, platform, or an external service prevents the check;
- `tool-policy`: the execution host rejects the operation before it runs;
- `test`: the test or smoke procedure itself is invalid, stale, or ambiguous.

A `rejected` or `blocked by policy` tool result is not product evidence. Do not retry the same command shape with cosmetic quoting, variable, shell, or path changes, and do not switch shells to evade the policy. After the first policy rejection, identify the rejected operation and make at most one materially different safe attempt. If no safe equivalent exists, mark that check `blocked` with the exact evidence and continue independent non-destructive checks; never loop.

For temporary-directory or installation smokes, use distinct calls to create, build, link/install, resolve the executable, invoke each behavior, unlink, verify the cleanup target, and clean up. Before recursive cleanup, resolve the exact absolute target in a read-only call and verify that it is the unique disposable directory created for this check and lies beneath the intended temporary root. Never compute a dynamic target and recursively remove it in the same call.

When validating behavior introduced by the PR, prove that the invoked executable and files come from the current PR SHA rather than an older global install or base branch. Record the resolved executable, reported version, and reviewed SHA. A global link may be used only when the acceptance contract requires it; preview and undo it in separate observable steps.

## Main merge workflow

When the PR targets `main`, GitHub may not populate `closingIssuesReferences` for a `Closes #<n>` reference before the PR is merged because `main` is not the repository default branch. Do not request code changes solely because that API field is empty. Verify instead that the PR body contains exactly one closing reference for the claimed issue, that the reference uses the correct issue number, and that no direct issue-close or automatic-merge behavior was introduced. Treat the eventual GitHub auto-close as a post-merge human verification step. If this is the only remaining concern, mark it as post-merge verification and allow `ready_for_human_merge`.

If the same finding is returned unchanged and no additional pre-merge action can satisfy it, do not create another equivalent failure: record it as a workflow limitation and escalate it as a policy question.

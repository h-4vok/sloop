[QA/SDET Review] round=1 verdict=changes_requested

commit=e5bb1ae059012844dd0fcbafec170e50fa221689

- [Q1] fail - In-scope coverage reaches 100% for lines, statements, functions, and branches; `npm run coverage` - exit 0, but coverage is Statements/Lines 83.75% (3747/4474), Functions 79.12% (235/297), Branches 77.48% (1284/1657). The configured gate is only 80/80/75/75, so CI success does not satisfy issue #81.
  - Plain language: The requested production-code coverage contract is not met; substantial executable code remains uncovered.
  - Reproduction: In checkout at reviewed SHA e5bb1ae059012844dd0fcbafec170e50fa221689, run `npm run coverage`.
  - Expected: 100% lines, statements, functions, and branches for all in-scope `src/` code, with narrowly documented exclusions only.
  - Actual: Command exits 0 because package.json checks 80% lines/statements and 75% functions/branches; reported totals are 83.75%, 83.75%, 79.12%, and 77.48% respectively.
  - Requested fix: Add deterministic tests and/or narrowly documented exclusions until the issue's four 100% thresholds are actually enforced and met; do not lower or rely on the existing weaker thresholds.
- [Q2] pass - Focused adapter/publication/sync/run-log regression coverage; `npm test -- --test-name-pattern="adapter|publication|sync|logging|retention"` - exit 0; targeted tests passed, and the full suite completed with 198 passed, 0 failed.
- [Q3] pass - Verification command `npm run build` - exit 0 (`tsc`).
- [Q4] pass - Verification command `npm run format:check` - exit 0; all files matched Prettier.
- [Q5] pass - Required CI check `pr-checks` - GitHub CheckRun conclusion SUCCESS; `gh pr checks 90` reports `pr-checks pass`.
- [Q6] pass - Smoke evidence - Worker comment documents a disposable-repository, non-production human procedure covering publication markers/redaction, ordered JSONL run logging, increasing sequence numbers, retention, and isolation. Per QA policy this is recorded as documented evidence only; no interactive or TTY-waiting smoke command was executed.
- [Q7] fail - Main-merge workflow requires exactly one closing reference; `gh pr view 90 --json body` - PR body contains `Closes #81` twice (once as the first line and once after the summary). This is not a product-coverage failure, but it must be corrected before merge to preserve the single authorized issue-closing reference.
  - Plain language: The PR metadata can attempt to close the same issue twice, making the claimed issue linkage ambiguous.
  - Reproduction: `gh pr view 90 --json body` at reviewed head e5bb1ae059012844dd0fcbafec170e50fa221689.
  - Expected: Exactly one `Closes #81` reference in the PR body and no direct issue-close or automatic-merge behavior.
  - Actual: The body contains two exact `Closes #81` references.
  - Requested fix: Remove the duplicate so the PR body has one exact closing reference for issue #81.

qa-sdet: failed

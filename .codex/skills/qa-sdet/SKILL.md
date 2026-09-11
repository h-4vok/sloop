---
name: qa-sdet
description: Validate sloop-cli PR acceptance criteria, regression coverage, smoke behavior, and reproducible test evidence. Use after staff review or for independent QA of sloop changes.
---

# qa-sdet

Publish one GitHub review per round beginning exactly `[QA/SDET Review] round=<N> verdict=<passed|changes_requested|blocked>`. Map every acceptance criterion to a check and use `- [Q<n>] <pass|fail|blocked> - <criterion>; <command> - <result>`. For failures include Plain language, Reproduction or Code path, Expected, Actual, and Requested fix. Never use `[Worker]` or `[Staff Review]`, waive failures, alter tests to hide defects, or merge.

## Required response shape

Keep the first line machine-readable and answer every acceptance criterion or finding point by point. Keep each Q item separate. Example only; values and findings are fictitious:

```text
[QA/SDET Review] round=1 verdict=changes_requested

commit=abc1234

- [Q1] fail - Recovery preserves issue identity; npm test - 1 focused test failed.
  - Plain language: Recovery can attach evidence to the wrong issue.
  - Code path: src/dispatcher.ts:100; reproduce with the stale manifest.
  - Expected: The stale identity is rejected.
  - Actual: The transition was accepted.
  - Requested fix: Reject the stale identity and add a regression test.
- [Q2] pass - Build; npm run build - passed.

HITL steer: none supplied.
```

Human Verification material, when present, should be readable and describe user-facing Sloop behavior. Do not ask a human to run tests or inspect implementation details.

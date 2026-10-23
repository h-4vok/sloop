# Agent instructions

## Sloop skills

The canonical source for the distributed Sloop skills is `assets/skills/`:

- `assets/skills/sloop-dispatcher/SKILL.md`
- `assets/skills/sloop-worker/SKILL.md`
- `assets/skills/sloop-qa/SKILL.md`
- `assets/skills/product-lead/SKILL.md`

Treat `.codex/skills/` as a deployed working copy; do not edit those files directly. When changing a Sloop skill, edit the matching file under `assets/skills/`, then run `sloop config install` from the Sloop repository to deploy the change to `.codex/skills/`. Verify the deployed result before committing.

## Unit-test standards

## Repository verification

Workers own repository verification. Before reporting ready for review, inspect this file, package scripts, CI workflows, and project documentation to discover applicable commands; run only commands defined or required there. Record each command, exit status, relevant output, and reviewed commit in Worker evidence. Do not assume another repository has Sloop's `npm run pr-checks`, build, smoke, or health commands. QA consumes this evidence and CI results; it does not invent repository gates.

Before finishing any code task, run the complete repository gate:

```text
npm run pr-checks
```

Do not report a code task as complete while this gate is failing. If it fails,
fix the issue or report the exact blocker and command output.

All unit tests must be:

1. Fast: run without unnecessary I/O, sleeps, or network calls.
2. Isolated: control dependencies and do not rely on another test's state.
3. Repeatable: produce the same result in any supported environment.
4. Self-Checking: assert observable outcomes, not just that code ran.
5. Timely: fail quickly and keep setup proportional to the behavior tested.
6. AAA Pattern: separate Arrange, Act, and Assert phases.
7. Clear Naming: describe the behavior and relevant condition.
8. Test One Thing: keep each test focused on one behavior.
9. Avoid Implementation Details: assert public contracts and externally visible effects.
10. Readable Setup: name input arrays, expected objects, mock functions, and mock response fixtures so their purpose is clear at the call site. Use descriptive domain names such as `dispatcherArgs`, `mockIssueResponse`, and `expectedCommand`; do not use opaque abbreviations such as `h` or `deps`.
11. Staged Calls: split nested, multi-step transformations into named values so each statement has one clear job. Simple, familiar expressions can remain inline when their meaning is obvious.
12. Mock Clarity: make command routing and returned responses understandable from names and structure. Add a short comment when a mock's scenario or protocol relationship needs explanation; if the setup remains hard to follow, split the test.
13. AAA Spacing: leave a blank line between Arrange, Act, and Assert, and between different concepts within a phase.
14. One Behavior: split independent behavior variants into separate tests. Parameterize cases when they share one behavior and the same verification.
15. Comment Spacing: put a blank line before and after a comment block that introduces a separate concept, even when it is followed by only a short piece of code. Keep the comment close enough to identify what it explains.
16. Integration-Style Setup: explain non-obvious temporary repository, process, or filesystem setup, and visually separate fixture creation, condition setup, the action under test, and assertions.

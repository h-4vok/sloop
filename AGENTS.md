# Agent instructions

## Sloop skills

The canonical source for the distributed Sloop skills is `assets/skills/`:

- `assets/skills/sloop-dispatcher/SKILL.md`
- `assets/skills/sloop-worker/SKILL.md`
- `assets/skills/sloop-qa/SKILL.md`

Treat `.codex/skills/` as a deployed working copy; do not edit those files directly. When changing a Sloop skill, edit the matching file under `assets/skills/`, then run `sloop config install` from the Sloop repository to deploy the change to `.codex/skills/`. Verify the deployed result before committing.

## Unit-test standards

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

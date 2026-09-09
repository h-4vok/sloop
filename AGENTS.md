# Agent instructions

## Sloop skills

The canonical source for the distributed Sloop skills is `assets/skills/`:

- `assets/skills/sloop-dispatcher/SKILL.md`
- `assets/skills/sloop-worker/SKILL.md`
- `assets/skills/sloop-qa/SKILL.md`

Treat `.codex/skills/` as a deployed working copy; do not edit those files directly. When changing a Sloop skill, edit the matching file under `assets/skills/`, then run `sloop config install` from the Sloop repository to deploy the change to `.codex/skills/`. Verify the deployed result before committing.

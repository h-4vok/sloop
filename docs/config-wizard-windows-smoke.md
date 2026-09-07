# Config wizard Windows smoke procedure

Run these commands from a fresh temporary Git repository containing the built
CLI. Record each exit code and the SHA-256 hash of `sloop.config.yaml` before
and after every command. Use a real Windows console for the two interactive
commands; use redirected input only for the scalar setter.

```powershell
node dist/cli.js init
# Expected: explanatory prompts, Preview old -> new, then a confirmation;
# cancelling leaves the YAML absent (or byte-for-byte unchanged).

node dist/cli.js config workspace.mode
# Expected: only the workspace wizard scope is presented; cancellation leaves
# the YAML hash unchanged.

node dist/cli.js config repository.baseBranch develop --no-sync
# Expected: exit 0 without a TTY, output includes old -> develop, and the
# resulting YAML is valid. Diagnose failures with stderr, exit code, and hashes.

node dist/cli.js config skills.required foo --no-sync
# Expected: nonzero exit and wizard guidance; the YAML hash is unchanged.
```

This file is a copyable smoke procedure, not a claim that an interactive
Windows console was available during automated verification.

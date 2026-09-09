# Windows TTY smoke procedure

Run this from a newly created temporary Git repository after `npm run build`.
The commands below are intentionally isolated and use `--no-sync`; they do not
touch `.sloop/state.json` or any external integration.

```powershell
$root = Join-Path $env:TEMP ("sloop-wizard-smoke-" + [guid]::NewGuid())
New-Item -ItemType Directory $root | Out-Null
git -C $root init
node dist/cli.js init
node dist/cli.js config show repository.baseBranch
node dist/cli.js config repository.baseBranch develop --no-sync
node dist/cli.js config workspace.mode worktree --no-sync
```

Expected diagnostics: `init` requires an interactive TTY and prints one
explanatory prompt at a time, then a preview before writing. `config show` and
the scalar setter work without a TTY; the setter prints old/new values. The
`workspace.mode` command is a scalar setter and requires its dependent
`workspace.worktreeRoot` when the complete document is validated; if that
dependency is absent it exits non-zero and leaves the YAML unchanged. To test
the wizard dependency prompt, run `node dist/cli.js config workspace` in the
same TTY and cancel at confirmation; compare the YAML bytes before and after.

If a command fails, capture its complete stderr and exit code, then inspect
`sloop.config.yaml` with `Get-FileHash` before/after. Do not retry with
`--sync` during this smoke test because this checkout intentionally fails
closed when a production reconciler integration is unavailable.

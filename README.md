# Sloop

Sloop is a sequential engineering harness that claims GitHub issues, guides a Worker through implementation, and gates the resulting pull request through CI and QA/SDET. A human always controls merges.

## Getting started

```text
npm ci
npm run build
npm run link:local
sloop --help
sloop issues list
```

The package remains private and is installed only as a link to this checkout. Node.js 22 or newer is required. After linking, `sloop` resolves its compiled code from this checkout and can be invoked from any subdirectory of a repository. Runtime configuration comes from the tracked `sloop.config.yaml` in the configured base commit.

Remove the global link with `npm run unlink:local`. This is also the rollback if a build or runtime-asset check fails. The repository-local `npm run sloop -- <args>` workflow remains available.

## Read-only runtime commands

```text
sloop config init [--wizard]
sloop config install [--force]
sloop config show
sloop status [--verbose] [--json]
sloop issues list [--json]
sloop doctor
```

Sloop discovers the one containing Git repository from the current directory; v1 has no repository override. JSON mode writes exactly one envelope to stdout with `command`, `status`, `phase`, `summary`, `result`, `diagnostics`, and `references` fields. Human successes go to stdout and failures go to stderr.

Process exits are stable: `0` completed/idle/waiting, `2` usage/configuration/preflight, `3` busy/already owned, `4` workflow blocked, and `5` external dependency/service failure.

## Operating model

Sloop operates only against `main`. For each eligible issue it prepares `codex/issue-<number>` from `origin/main`, opens or resumes one PR targeting `main`, then requires CI and QA/SDET before marking it ready for a human merge. See [the operating specification](docs/sloop-engineering-v1.md) and [role guides](docs/roles/).

Local runtime state is `.sloop/state.json` and is intentionally untracked. There is no automatic migration from prior runtime state: archive or remove it, then begin with a clean `.sloop` state.

## Development

```text
npm run format:check
npm run build
npm test
npm run pr-checks
npm run test:integration
```

The integration suite mocks GitHub, Worker and QA. Its real Arbiter contract test
is skipped unless `SLOOP_TEST_REAL_ARBITER=1` is set. To include it in PowerShell:

```powershell
$env:SLOOP_TEST_REAL_ARBITER = '1'
npm run test:integration
Remove-Item Env:SLOOP_TEST_REAL_ARBITER
```

This test consumes authenticated Codex usage with `gpt-5.6-luna`, low reasoning
effort and a read-only sandbox in a temporary directory. It runs two fictional
Worker/QA rounds and validates the Arbiter's unmodified output through the
production dispatcher. Any of the four ruling actions is accepted; the test
checks the contract, not the decision. The harness deliberately stops after the
first ruling is persisted and projected to its fake issue/PR, before another
Worker can run. Missing Codex authentication or an invalid result fails the test
when enabled. CI runs the deterministic `pr-checks` gate without requiring Codex.

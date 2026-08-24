# Sloop

Sloop is a sequential engineering harness that claims GitHub issues, guides a Worker through implementation, and gates the resulting pull request through CI, QA/SDET, and adversarial staff review. A human always controls merges.

## Getting started

```text
npm ci
copy sloop.config.json.example sloop.config.json
npm run build
npm run link:local
sloop --help
sloop --list
```

The package remains private and is installed only as a link to this checkout. Node.js 22 or newer is required. After linking, `sloop` resolves its compiled code from this checkout and can be invoked from any working directory; the working directory remains the target repository whose `sloop.config.json` and `.sloop` state are used. Configure each role command explicitly in `sloop.config.json`.

Remove the global link with `npm run unlink:local`. This is also the rollback if a build or runtime-asset check fails. The repository-local `npm run sloop -- <args>` workflow remains available.

## Operating model

Sloop operates only against `main`. For each eligible issue it prepares `codex/issue-<number>` from `origin/main`, opens or resumes one PR targeting `main`, then requires CI, QA/SDET, and Staff review before marking it ready for a human merge. See [the operating specification](docs/sloop-engineering-v1.md) and [role guides](docs/roles/).

Local runtime state is `.sloop/state.json` and is intentionally untracked. There is no automatic migration from prior runtime state: archive or remove it, then begin with a clean `.sloop` state.

## Development

```text
npm run format:check
npm run build
npm test
```

## Skills

The duplicated Codex skills are `product-lead`, `dispatcher`, `worker`, `staff-reviewer`, `qa-sdet`, and `triage-staging`.

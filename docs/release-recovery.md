# Release recovery

Merged pull requests must begin with exactly `[patch]`, `[minor]`, `[major]`, or `[none]`. Use `[none]` for work that must not publish a release. The workflow runs build, tests, and formatting checks before changing metadata.

Retries reuse the calculated `vX.Y.Z` tag and GitHub Release. If an existing tag or release points at different content, stop and investigate rather than force-publishing. To recover a failed run, inspect the workflow log, correct the repository or release consistency issue, and rerun the workflow from GitHub; do not manually increment `package.json`.

A non-publishing dry run covers every required decision and retry path:

```sh
npm test
node scripts/release-dry-run.mjs
```

Expected output includes patch, minor, major, and none results, rejected missing and ambiguous prefixes, `retry matching tag/release => reused`, and `retry inconsistent release => rejected`. This exercises the same compiled helpers used by the workflow. The workflow verifies the existing GitHub Release tag name and target (the normal `main` target or the exact tag commit) before reuse.

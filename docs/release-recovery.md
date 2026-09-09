# Release recovery

Merged pull requests must begin with exactly `[patch]`, `[minor]`, `[major]`, or `[none]`. Use `[none]` for work that must not publish a release. The workflow runs build, tests, and formatting checks before changing metadata.

Retries reuse the calculated `vX.Y.Z` tag and GitHub Release. If an existing tag or release points at different content, stop and investigate rather than force-publishing. To recover a failed run, inspect the workflow log, correct the repository or release consistency issue, and rerun the workflow from GitHub; do not manually increment `package.json`. A dry run is available by running the exported release functions against copied metadata, covering each prefix and the existing-tag retry case without pushing or publishing.

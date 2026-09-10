# Coverage baseline

Coverage is collected with `c8` on the compiled production modules in `dist/`.
Tests import compiled modules, and TypeScript currently does not emit source
maps, so collecting against `src/` would incorrectly report zero execution.
The CLI bootstrap (`dist/cli.js`) is excluded because it is an executable
entrypoint; its command behavior is exercised through the public CLI tests.

Baseline from Node 22 on 2026-09-10:

| Metric     |           Baseline |
| ---------- | -----------------: |
| Lines      | 83.21% (3600/4326) |
| Statements | 83.21% (3600/4326) |
| Functions  |   77.39% (226/292) |
| Branches   | 76.96% (1226/1593) |

Run `npm run coverage` to reproduce the report. The command writes an LCOV
report and CI uploads the complete `coverage/` directory as an artifact.

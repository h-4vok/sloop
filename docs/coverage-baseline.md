# Coverage baseline

Coverage is collected with `c8` on the compiled production modules in `dist/`.
Tests import compiled modules, and TypeScript currently does not emit source
maps, so collecting against `src/` would incorrectly report zero execution.
The CLI bootstrap (`dist/cli.js`) and the type-only emitted shell
`dist/core/boundaries.js` are both included so the report inventories the full
compiled project.

The historical baseline from Node 22 on 2026-09-10 is retained below for
comparison. Coverage is evidence rather than a blocking gate; maintainers can
decide what action to take from each complete report.

| Metric     |           Baseline |
| ---------- | -----------------: |
| Lines      | 82.78% (3704/4474) |
| Statements | 82.78% (3704/4474) |
| Functions  |   77.44% (230/297) |
| Branches   | 77.28% (1262/1633) |

Run `npm run coverage` to reproduce the report. The command writes an LCOV
report and CI uploads the complete `coverage/` directory as an artifact.

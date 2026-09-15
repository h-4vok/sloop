# Coverage baseline

Coverage is collected with `c8` while unit tests import TypeScript modules from
`src/` through `tsx`. The compiled `dist/` artifact is validated separately by
the build and CLI smoke tests.

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

# Coverage baseline

Coverage is collected with `c8` on the compiled production modules in `dist/`.
Tests import compiled modules, and TypeScript currently does not emit source
maps, so collecting against `src/` would incorrectly report zero execution.
The CLI bootstrap (`dist/cli.js`) is included. `dist/core/boundaries.js` is
excluded narrowly because it is the TypeScript-emitted runtime shell for
interfaces and type aliases only; it contains no executable production logic.

The historical baseline from Node 22 on 2026-09-10 was below the final gate.
The final gate is now enforced at 100% for every metric.

| Metric     |           Baseline |
| ---------- | -----------------: |
| Lines      | 82.78% (3704/4474) |
| Statements | 82.78% (3704/4474) |
| Functions  |   77.44% (230/297) |
| Branches   | 77.28% (1262/1633) |

Run `npm run coverage` to reproduce the report. The command writes an LCOV
report and CI uploads the complete `coverage/` directory as an artifact.

# Production coverage scope

`npm run coverage` is the complete production-code witness. Tests execute the
compiled modules under `dist/`, while TypeScript source maps remap the c8 report
to the corresponding production files under `src/`. It reports lines,
statements, functions, and branches with the repository thresholds enforced.

`core/boundaries.ts` contains only TypeScript type declarations. Its emitted
`dist/core/boundaries.js` shell is intentionally still present in the report so
the witness includes every compiled module, even modules with no executable
runtime contract.

Issues #80-#84 add focused tests for the production areas. No production module
or source range is excluded from the report.

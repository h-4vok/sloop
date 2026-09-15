# Production coverage scope

`npm run coverage` is the complete unit-test witness. Tests execute the
TypeScript modules under `src/` through `tsx`, and c8 instruments those source
files directly. It reports lines, statements, functions, and branches with the
repository thresholds enforced. Build and CLI smoke tests separately validate
the compiled production artifact under `dist/`.

`core/boundaries.ts` contains only TypeScript type declarations. Its emitted
`dist/core/boundaries.js` shell is intentionally still present in the report so
the witness includes every compiled module, even modules with no executable
runtime contract.

Issues #80-#84 add focused tests for the production areas. No production module
or source range is excluded from the report.

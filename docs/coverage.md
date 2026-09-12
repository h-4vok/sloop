# Production coverage scope

`npm run coverage` is the complete production-code witness. It instruments every
compiled module under `dist/` (`--all`) and reports lines, statements, functions,
and branches without enforcing a percentage threshold.

`core/boundaries.ts` contains only TypeScript type declarations. Its emitted
`dist/core/boundaries.js` shell is intentionally still present in the report so
the witness includes every compiled module, even modules with no executable
runtime contract.

Issues #80-#84 add focused tests for the production areas. No production module
or source range is excluded from the report.

# Production coverage scope

`npm run coverage` is the enforced production-code gate. It instruments every
compiled module under `dist/` (`--all`) and requires 100% lines, statements,
functions, and branches. The same gate runs in pull-request and release CI.

`core/boundaries.ts` contains only TypeScript type declarations. TypeScript
emits its module as `dist/core/boundaries.js` containing only `export {}`; it
has no executable statements, functions, branches, or runtime contract to
exercise. It is therefore documented here as a narrow type-only exclusion.

Issues #80-#84 add focused tests for the production areas; no production module
is excluded except the documented type-only runtime shell above.

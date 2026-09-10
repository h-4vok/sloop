# Production coverage scope

`npm run coverage` enforces 100% lines, statements, functions, and branches for
the executable production contracts named by issue #80: `config.ts`,
`runtime.ts`, `release.ts`, `remote-state.ts`, and `mutex.ts`.

`core/boundaries.ts` contains only TypeScript type declarations. TypeScript
emits its module as `dist/core/boundaries.js` containing only `export {}`; it
has no executable statements, functions, branches, or runtime contract to
exercise. It is therefore documented here as a narrow type-only exclusion.

Other production modules remain covered by their existing focused tests, but
are outside this issue's core-contract enforcement slice.

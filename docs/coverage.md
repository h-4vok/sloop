# Production coverage scope

The intermediate coverage issues use `npm run coverage` as a provisional,
non-regression gate. The final issue in the epic, #84, raises it to 100% for
lines, statements, functions, and branches after all assigned slices land.

`core/boundaries.ts` contains only TypeScript type declarations. TypeScript
emits its module as `dist/core/boundaries.js` containing only `export {}`; it
has no executable statements, functions, branches, or runtime contract to
exercise. It is therefore documented here as a narrow type-only exclusion.

Issues #80-#83 add focused tests for their assigned production areas; they do not
move the final 100% gate early.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs', 'integration/**/*.test.mjs'],

    fileParallelism: false,

    coverage: {
      provider: 'v8',

      include: ['src/**/*.ts'],

      exclude: ['src/core/boundaries.ts'],

      thresholds: {
        statements: 97,

        functions: 100,

        lines: 97,

        branches: 80,
      },

      reporter: ['text', 'text-summary', 'lcov'],
    },
  },
});

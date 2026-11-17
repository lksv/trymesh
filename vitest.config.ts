import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // the unit tests of the tools need no downloaded data (the converter itself does)
    include: ['packages/*/test/**/*.test.ts', 'tools/**/*.unit.test.ts'],
    testTimeout: 60_000,
  },
});

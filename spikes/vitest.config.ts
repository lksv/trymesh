// Spikes written in TypeScript over the packages' sources (the real adapters of the kernel and the solver).
// Run from the repository root: npx vitest run --config spikes/vitest.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['spikes/*.spike.ts'],
    testTimeout: 600_000,
  },
});

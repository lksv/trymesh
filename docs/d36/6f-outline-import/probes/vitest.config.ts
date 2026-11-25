// The probes of the design of 6f (D72): prototypes run against the real engine and adapters.
// From the root of the repository: npx vitest run --config docs/d36/6f-outline-import/probes/vitest.config.ts
// One file: … --config docs/d36/6f-outline-import/probes/vitest.config.ts docs/d36/6f-outline-import/probes/a.probe.ts
// The numbers go to the console (`console.log`) and are recorded in design.md, "Measured".
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('../../../..', import.meta.url)),
    include: ['docs/d36/6f-outline-import/probes/*.probe.ts'],
    testTimeout: 600_000,
  },
});

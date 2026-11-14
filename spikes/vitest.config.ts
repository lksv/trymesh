// Spiky psané v TypeScriptu nad zdroji balíčků (skutečné adaptéry jádra a solveru).
// Spuštění z kořene repozitáře: npx vitest run --config spikes/vitest.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['spikes/*.spike.ts'],
    testTimeout: 600_000,
  },
});

// The converter runs under Vitest because the engine is TypeScript imported through Vite.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tools/onshape/convert.test.ts'], testTimeout: 1_800_000 } });

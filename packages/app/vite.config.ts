import { defineConfig } from 'vite';

// Libraries in WASM load their .wasm file themselves; the app only tells them the address (see main.ts).
export default defineConfig({
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['manifold-3d', '@salusoft89/planegcs'] },
});

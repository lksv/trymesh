import { defineConfig } from 'vite';

// Knihovny ve WASM si svůj .wasm soubor načítají samy; aplikace jim jen řekne adresu (viz main.ts).
export default defineConfig({
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['manifold-3d', '@salusoft89/planegcs'] },
});

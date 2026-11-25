import { defineConfig } from 'vite';

// A server for Node in one file. The workspace packages are bundled (they are TypeScript sources),
// third-party libraries stay external and are loaded from node_modules.
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node20',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'server.js' } },
  },
  ssr: { noExternal: [/^@trymesh\//] },
});

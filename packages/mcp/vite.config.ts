import { defineConfig } from 'vite';

// Server pro Node v jednom souboru. Balíčky workspace se přibalí (jsou to zdroje v TypeScriptu),
// knihovny třetích stran zůstávají vnější a načtou se z node_modules.
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

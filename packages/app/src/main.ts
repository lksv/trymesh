// Ukázková aplikace: engine se skutečnými adaptéry, vykreslení přes three.js.
import planegcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import manifoldWasm from 'manifold-3d/manifold.wasm?url';
import { createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { App } from './app';

const status = document.getElementById('status') as HTMLElement;
status.textContent = 'Načítám geometrické jádro a solver…';
try {
  const [solver, kernel] = await Promise.all([createPlanegcsSolver({ locateFile: () => planegcsWasm }), createManifoldKernel({ locateFile: () => manifoldWasm })]);
  const app = new App(createEngine({ solver, kernel }));
  (window as unknown as { trymesh: App }).trymesh = app; // pro ladění z konzole
} catch (error) {
  status.textContent = `Start selhal: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
}

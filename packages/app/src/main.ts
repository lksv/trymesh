// Demo app: the engine with the real adapters, rendering through three.js.
import planegcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import manifoldWasm from 'manifold-3d/manifold.wasm?url';
import { createPakoDeflater } from '@trymesh/deflate-pako';
import { createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { App } from './app';

const status = document.getElementById('status') as HTMLElement;
status.textContent = 'Loading the geometry kernel and the solver…';
try {
  const [solver, kernel] = await Promise.all([createPlanegcsSolver({ locateFile: () => planegcsWasm }), createManifoldKernel({ locateFile: () => manifoldWasm })]);
  const app = new App(createEngine({ solver, kernel, deflater: createPakoDeflater() }));
  (window as unknown as { trymesh: App }).trymesh = app; // for debugging from the console
} catch (error) {
  status.textContent = `Start failed: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
}

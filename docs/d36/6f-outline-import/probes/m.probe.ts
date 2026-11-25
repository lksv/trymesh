// Probe M: the memory of the solver adapter with a whole outline in its input, in a process of its
// own (one vitest file is one worker). Row C4 of design.md.
import { describe, it, vi } from 'vitest';
import type { Command } from '../../../../packages/engine/src/index';
import { XY, addSketch, batch, newEngine, run } from '../../../../packages/scenarios/test/kit';
import { addOutline, bigDxf } from './kit';
import { importOutline, installOutlineKind, outlineEntry } from './proto';

installOutlineKind();
vi.mock('../../../../packages/engine/src/references/spec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/engine/src/references/spec')>();
  return { ...original, projected: (v: unknown, what: string) => ((v as { kind?: string } | null)?.kind === 'outline' ? v : original.projected(v, what)) };
});

describe('M: the memory of the adapter', () => {
  it('C4: drags in a sketch that holds a whole outline in its solver input, until the adapter fails', () => {
    for (const n of [1000, 2000, 3000]) {
      const { curves } = importOutline(bigDxf(n));
      const engine = newEngine();
      run(engine, addSketch('s', XY), addOutline('s', 'o', outlineEntry(curves)), batch({ type: 'addPoint', sketch: 's', id: 'p', x: -50, y: -50 }, { type: 'addPoint', sketch: 's', id: 'r', x: 30, y: -20 }, { type: 'addConstraint', sketch: 's', id: 'k1', constraint: { type: 'coincident', a: 'p', b: 'o/c1/center' } }) as Command);
      let count = 0;
      let failure = '';
      const t0 = performance.now();
      for (; count < 600; count++) {
        const state = run(engine, { type: 'dragPoint', sketch: 's', point: 'r', x: 30 + (count % 7), y: -20 } as Command);
        const warning = state.evaluation.features.s.warnings.find((w) => w.code === 'sketchConflict');
        if (warning) {
          failure = warning.message.slice(0, 90);
          break;
        }
      }
      console.log(`C4 n ${n}: ${count} drags in ${((performance.now() - t0) / Math.max(1, count)).toFixed(0)} ms each${failure ? `, then sketchConflict: ${failure}` : ', no failure'}`);
      if (failure) {
        // what a small sketch of another engine of the same process gets afterwards
        const other = newEngine();
        const state = run(other, addSketch('t', XY), batch({ type: 'addPoint', sketch: 't', id: 'a', x: 1, y: 1 }, { type: 'addConstraint', sketch: 't', id: 'f', constraint: { type: 'fixed', point: 'a', x: 2, y: 2 } }) as Command);
        console.log('C4 a small sketch afterwards:', state.evaluation.features.t.status, JSON.stringify(state.evaluation.features.t.warnings.map((w) => w.message.slice(0, 60))));
        break;
      }
    }
  });
});

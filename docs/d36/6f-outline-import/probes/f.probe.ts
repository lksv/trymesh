// Probe F: the solver given only what the constraints name, end to end. The narrowing is emulated
// at the port: a solver that takes out of its input every fixed point and curve that no constraint
// names and no own curve runs over, solves the rest with the real adapter, and puts the positions
// back. Rows F1 and F2 of design.md.
import { describe, it, vi } from 'vitest';
import { type Command, type EngineState, type SketchSolver, type SolveInput, createEngine } from '../../../../packages/engine/src/index';
import { constraintOperands } from '../../../../packages/engine/src/sketch-content';
import { createManifoldKernel } from '../../../../packages/kernel-manifold/src/index';
import { createPlanegcsSolver } from '../../../../packages/solver-planegcs/src/index';
import { XY, addSketch, batch, run } from '../../../../packages/scenarios/test/kit';
import { addOutline, bigDxf, resultOf } from './kit';
import { importOutline, installOutlineKind, outlineEntry } from './proto';

installOutlineKind();
vi.mock('../../../../packages/engine/src/references/spec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/engine/src/references/spec')>();
  return { ...original, projected: (v: unknown, what: string) => ((v as { kind?: string } | null)?.kind === 'outline' ? v : original.projected(v, what)) };
});

const real = await createPlanegcsSolver();
const kernel = await createManifoldKernel();
let last = 0;
const narrow: SketchSolver = {
  ...real,
  solve(input: SolveInput & { drag?: unknown }) {
    const named = new Set(Object.values(input.constraints).flatMap(constraintOperands));
    const fixed = new Set(input.fixed);
    const pointsOf = (id: string): string[] => {
      const c = input.curves[id];
      return c.type === 'line' ? [c.a, c.b] : c.type === 'circle' ? [c.center] : c.type === 'arc' ? [c.center, c.start, c.end] : c.points;
    };
    // a curve stays when it is named or runs over a point the solver moves
    const curves = Object.fromEntries(Object.entries(input.curves).filter(([id]) => named.has(id) || pointsOf(id).some((p) => !fixed.has(p))));
    const used = new Set([...named, ...Object.keys(curves).flatMap(pointsOf), 'origin']);
    const points = Object.fromEntries(Object.entries(input.points).filter(([id]) => !fixed.has(id) || used.has(id)));
    const radii = Object.fromEntries(Object.entries(input.radii).filter(([id]) => id in curves));
    last = Object.keys(points).length;
    const result = real.solve({ ...input, points, radii, curves, fixed: input.fixed.filter((id) => id in points || id in curves) } as never);
    return { ...result, points: { ...input.points, ...result.points }, radii: { ...input.radii, ...result.radii } };
  },
} as SketchSolver;
const ms = (run: () => unknown, times = 1): number => {
  const t0 = performance.now();
  for (let i = 0; i < times; i++) run();
  return (performance.now() - t0) / times;
};

describe('F: the solver given only what the constraints name', () => {
  it('F1: the timings of C1 again, and 600 drags with 2000 curves', () => {
    for (const n of [300, 1000, 2000]) {
      const { curves } = importOutline(bigDxf(n));
      const engine = createEngine({ solver: narrow, kernel });
      run(engine, addSketch('s', XY));
      let state: EngineState = engine.getState();
      const add = ms(() => (state = run(engine, addOutline('s', 'o', outlineEntry(curves)))));
      const own = ms(
        () =>
          (state = run(
            engine,
            batch(
              { type: 'addPoint', sketch: 's', id: 'p', x: -50, y: -50 },
              { type: 'addPoint', sketch: 's', id: 'q', x: 20, y: 60 },
              { type: 'addPoint', sketch: 's', id: 'r', x: 30, y: -20 },
              { type: 'addCurve', sketch: 's', id: 'pq', curve: { type: 'line', a: 'p', b: 'q', construction: true } },
              { type: 'addCurve', sketch: 's', id: 'qr', curve: { type: 'line', a: 'q', b: 'r', construction: true } },
              { type: 'addConstraint', sketch: 's', id: 'k1', constraint: { type: 'coincident', a: 'p', b: 'o/c1/center' } },
              { type: 'addConstraint', sketch: 's', id: 'k2', constraint: { type: 'pointOnCurve', point: 'q', curve: 'o/l1' } },
              { type: 'addConstraint', sketch: 's', id: 'k3', constraint: { type: 'distancePointLine', point: 'r', line: 'o/l2', value: 1, driving: false } },
            ) as Command,
          )),
      );
      let failures = 0;
      const drag = ms(() => {
        state = run(engine, { type: 'dragPoint', sketch: 's', point: 'r', x: 31 + Math.random(), y: -21 } as Command);
        if (state.evaluation.features.s.status !== 'ok') failures++;
      }, n === 2000 ? 600 : 20);
      const flagOff = ms(() => (state = run(engine, { type: 'updateExternal', sketch: 's', id: 'o', ref: { ...(state.document.features[0] as { external: Record<string, object> }).external.o, regions: false } } as unknown as Command)));
      const dragOff = ms(() => (state = run(engine, { type: 'dragPoint', sketch: 's', point: 'r', x: 31 + Math.random(), y: -21 } as Command)), 20);
      const result = resultOf(state, 's');
      console.log(`F1 n ${n}: addExternal ${add.toFixed(0)} ms, own batch ${own.toFixed(0)} ms, drag ${drag.toFixed(1)} ms (failures ${failures}), the solver had ${last} points; regions off: update ${flagOff.toFixed(0)} ms, drag ${dragOff.toFixed(1)} ms; p at ${JSON.stringify(result.points.p)} = c1 ${JSON.stringify(result.points['o/c1/center'])}; measured ${result.measurements.k3?.toFixed(4)}; dof ${result.degreesOfFreedom}`);
    }
  });
});

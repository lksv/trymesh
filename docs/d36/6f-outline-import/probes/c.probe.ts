// Probe C: what hundreds of entities of one outline cost. Rows C1 to C3 of design.md.
import { describe, it, vi } from 'vitest';
import { SketchAnalysis } from '../../../../packages/engine/src/analysis';
import type { Command, EngineState, Id, SketchFeature } from '../../../../packages/engine/src/index';
import { entityIndex, resolveReferences } from '../../../../packages/engine/src/references/index';
import { sketchWorld, stepBase } from '../../../../packages/engine/src/references/world';
import { profileOf, solverSetup } from '../../../../packages/engine/src/sketch';
import { createPlanegcsSolver } from '../../../../packages/solver-planegcs/src/index';
import { XY, addSketch, batch, newEngine, run } from '../../../../packages/scenarios/test/kit';
import { addOutline, bigDxf, regionArea, resultOf } from './kit';
import { type OutlineCurve, importOutline, installOutlineKind, outlineEntry } from './proto';

installOutlineKind();
vi.mock('../../../../packages/engine/src/references/spec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/engine/src/references/spec')>();
  return { ...original, projected: (v: unknown, what: string) => ((v as { kind?: string } | null)?.kind === 'outline' ? v : original.projected(v, what)) };
});

const solver = await createPlanegcsSolver();
const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
const ms = (run: () => unknown, times = 1): number => {
  const t0 = performance.now();
  for (let i = 0; i < times; i++) run();
  return (performance.now() - t0) / times;
};

// what get_sketch would list for every entity of an entry: the curve with its places, rounded
const listed = (curves: Record<string, OutlineCurve>, limit: number): string =>
  JSON.stringify(
    Object.entries(curves)
      .slice(0, limit)
      .map(([id, c]) => ({ id: `o/${id}`, ...c })),
  );

describe('C: the cost of many entities', () => {
  it('C1: the import, the first evaluation, an edit and a drag in the sketch, by the number of curves', () => {
    for (const n of [100, 300, 1000, 2000]) {
      const text = bigDxf(n);
      let imported = importOutline(text);
      const read = ms(() => (imported = importOutline(text)), 3);
      const { curves, report } = imported;
      const engine = newEngine();
      run(engine, addSketch('s', XY));
      let state: EngineState = engine.getState();
      const add = ms(() => (state = run(engine, addOutline('s', 'o', outlineEntry(curves)))));
      const result = resultOf(state, 's');
      const regions = result.regions.length;
      // an own triangle held on the outline: one corner on the first hole centre, one on a tooth tip
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
            ) as Command,
          )),
      );
      const drag = ms(() => (state = run(engine, { type: 'dragPoint', sketch: 's', point: 'r', x: 31, y: -21 } as Command)), 5);
      const other = ms(() => (state = run(engine, { type: 'setParameter', name: 'k', expr: '1' })));
      const diagnose = ms(() => engine.diagnoseSketch('s'));
      const feature = sketchOf(state, 's');
      const save = ms(() => JSON.stringify(state.document));
      const json = JSON.stringify(state.document);
      const load = ms(() => {
        const loaded = newEngine().load(json);
        if (!loaded.ok) throw new Error(loaded.error.message);
      });
      const entry = JSON.stringify(feature.external.o);
      console.log(
        `C1 n ${n}: file ${text.length} chars, read+weld ${read.toFixed(1)} ms, welded ${report.welded}; addExternal ${add.toFixed(0)} ms, regions ${regions} valid ${result.valid}; own batch ${own.toFixed(0)} ms, drag ${drag.toFixed(0)} ms, another parameter ${other.toFixed(1)} ms, diagnose ${diagnose.toFixed(0)} ms; ` +
          `entry ${entry.length} chars, document ${json.length}, save ${save.toFixed(1)} ms, load ${load.toFixed(0)} ms; dof ${resultOf(state, 's').degreesOfFreedom}; a listing of every curve ${listed(curves, 1e9).length} chars, of 50 ${listed(curves, 50).length}; entities ${entityIndex(feature).entities.size}; area ${regionArea(state, 's').toFixed(1)}`,
      );
    }
  });

  it('C2: the stages of the sketch step for 300 and 1000 curves, with and without the regions', async () => {
    for (const n of [300, 1000]) {
      for (const regions of [true, false]) {
        const { curves } = importOutline(bigDxf(n));
        const engine = newEngine();
        run(engine, addSketch('s', XY), addOutline('s', 'o', outlineEntry(curves, { regions })));
        const state = run(
          engine,
          batch(
            { type: 'addPoint', sketch: 's', id: 'p', x: -50, y: -50 },
            { type: 'addPoint', sketch: 's', id: 'q', x: 20, y: 60 },
            { type: 'addCurve', sketch: 's', id: 'pq', curve: { type: 'line', a: 'p', b: 'q', construction: true } },
            { type: 'addConstraint', sketch: 's', id: 'k1', constraint: { type: 'coincident', a: 'p', b: 'o/c1/center' } },
            { type: 'addConstraint', sketch: 's', id: 'k2', constraint: { type: 'pointOnCurve', point: 'q', curve: 'o/l1' } },
          ) as Command,
        );
        const feature = sketchOf(state, 's');
        const context = { state: {} as never, frame: {} as never };
        let resolved = resolveReferences(feature, context).resolved;
        const tResolve = ms(() => (resolved = resolveReferences(feature, context).resolved), 5);
        let setup = solverSetup(feature, resolved);
        const tSetup = ms(() => (setup = solverSetup(feature, resolved)), 5);
        // a solver of its own: the adapter runs out of memory after a few solves of thousands of fixed points (C4)
        const fresh = await createPlanegcsSolver();
        let solved = fresh.solve(setup.input);
        const tSolve = ms(() => (solved = fresh.solve(setup.input)), 1);
        const tAnalysis = ms(() => new SketchAnalysis(setup.input), 3);
        const geometry = { points: solved.points, radii: solved.radii };
        let world = sketchWorld(stepBase(feature, resolved, geometry));
        const tWorld = ms(() => (world = sketchWorld(stepBase(feature, resolved, geometry))), 3);
        const tProfile = ms(() => profileOf([...world.curves.values()], world.joins, world.geometry, 0.01), 3);
        console.log(`C2 n ${n} regions ${regions}: resolve ${tResolve.toFixed(2)}, setup+stamp ${tSetup.toFixed(1)}, solve ${tSolve.toFixed(1)} (${solved.status}), analysis ${tAnalysis.toFixed(1)}, world ${tWorld.toFixed(1)}, profile ${tProfile.toFixed(1)} ms; solver points ${Object.keys(setup.input.points).length} curves ${Object.keys(setup.input.curves).length} fixed ${setup.input.fixed.length}`);
      }
    }
  });

  it('C3: the solver given only the entities the constraints name', () => {
    for (const n of [1000, 2000]) {
      const { curves } = importOutline(bigDxf(n));
      const engine = newEngine();
      run(engine, addSketch('s', XY), addOutline('s', 'o', outlineEntry(curves)));
      const state = run(
        engine,
        batch(
          { type: 'addPoint', sketch: 's', id: 'p', x: -50, y: -50 },
          { type: 'addPoint', sketch: 's', id: 'q', x: 20, y: 60 },
          { type: 'addCurve', sketch: 's', id: 'pq', curve: { type: 'line', a: 'p', b: 'q', construction: true } },
          { type: 'addConstraint', sketch: 's', id: 'k1', constraint: { type: 'coincident', a: 'p', b: 'o/c1/center' } },
          { type: 'addConstraint', sketch: 's', id: 'k2', constraint: { type: 'pointOnCurve', point: 'q', curve: 'o/l1' } },
        ) as Command,
      );
      const feature = sketchOf(state, 's');
      const { resolved } = resolveReferences(feature, { state: {} as never, frame: {} as never });
      // the geometry of the entry cut down to what the constraints name: o/c1 with its centre, o/l1 with its ends
      const g = resolved.o.geometry;
      const named = ['o/c1', 'o/l1'];
      const pointsOf = (curve: Id): Id[] => {
        const shape = g.curves[curve];
        return shape.type === 'line' ? [shape.a, shape.b] : shape.type === 'circle' ? [shape.center] : [];
      };
      const keep = new Set(named.flatMap(pointsOf));
      const narrow = { ...resolved, o: { ...resolved.o, geometry: { points: Object.fromEntries(Object.entries(g.points).filter(([id]) => keep.has(id))), curves: Object.fromEntries(named.map((id) => [id, g.curves[id]])), radii: { 'o/c1': g.radii['o/c1'] }, regions: [] } } };
      let setup = solverSetup(feature, narrow);
      const tSetup = ms(() => (setup = solverSetup(feature, narrow)), 5);
      const tSolve = ms(() => solver.solve(setup.input), 5);
      const tAnalysis = ms(() => new SketchAnalysis(setup.input), 5);
      console.log(`C3 n ${n}: setup+stamp ${tSetup.toFixed(2)}, solve ${tSolve.toFixed(2)}, analysis ${tAnalysis.toFixed(2)} ms; solver points ${Object.keys(setup.input.points).length}`);
    }
  });
});

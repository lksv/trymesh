// Probe J: what the reviews of the design asked to be measured again. The weld that is bounded
// (no chain, no end moved further than the tolerance, an arc kept within it), an arc of nearly a
// whole turn, curves twice in a file, the local IDs every object has, the document not holding the
// caller's object, a closed spline of an outline, a tangency at a corner of an outline, a swap of
// IDs found, and outlines of many splines. Rows J1 to J12 of design.md.
import { describe, expect, it, vi } from 'vitest';
import { type Command, type EngineState, type SketchSolver, type SolveInput, createEngine } from '../../../../packages/engine/src/index';
import { constraintOperands } from '../../../../packages/engine/src/sketch-content';
import { createManifoldKernel } from '../../../../packages/kernel-manifold/src/index';
import { createPlanegcsSolver } from '../../../../packages/solver-planegcs/src/index';
import { XY, addSketch, constrain, newEngine, run } from '../../../../packages/scenarios/test/kit';
import { boardFile } from './cover';
import { addOutline, resultOf } from './kit';
import { type ImportedCurve, type ReadOutline, type Vec2, assemble, installOutlineKind, outlineEntry, outlineRevision } from './proto';

installOutlineKind();
vi.mock('../../../../packages/engine/src/references/spec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/engine/src/references/spec')>();
  return { ...original, projected: (v: unknown, what: string) => ((v as { kind?: string } | null)?.kind === 'outline' ? v : original.projected(v, what)) };
});

const about = { unit: 'mm', unitFrom: 'file', layers: {}, skipped: {} } as unknown as ReadOutline['about'];
const read = (...curves: ImportedCurve[]): ReadOutline => ({ curves: curves.map((curve) => ({ curve, layer: '0' })), about });
const line = (a: Vec2, b: Vec2): ImportedCurve => ({ type: 'line', a, b });
const polar = (c: Vec2, r: number, deg: number): Vec2 => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
const arc = (c: Vec2, r: number, from: number, to: number): ImportedCurve => ({ type: 'arc', center: c, start: polar(c, r, from), end: polar(c, r, to) });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const brief = (r: ReturnType<typeof assemble>['report']): string => JSON.stringify({ curves: r.curves, byKind: r.byKind, welded: r.welded, moved: r.moved, shifted: r.shifted, closed: r.closed, dropped: r.dropped, duplicates: r.duplicates, blocked: r.blocked, open: r.open, gaps: r.gaps.length });
const inSketch = (curves: Record<string, ImportedCurve>): EngineState => run(newEngine(), addSketch('s', XY), addOutline('s', 'o', outlineEntry(curves)));
const square = (s: number): ImportedCurve[] => [line([0, 0], [s, 0]), line([s, 0], [s, s]), line([s, s], [0, s]), line([0, s], [0, 0])];

describe('J: the reviews', () => {
  it('J1: a corner drawn as 200 short lines is not welded together', () => {
    // a square of 20 with one corner of radius 0.5 as 200 lines of 0.0039 mm (the review, fable 1)
    const corner = Array.from({ length: 201 }, (_, i) => polar([19.5, 0.5], 0.5, -90 + (90 * i) / 200));
    const curves = [line([0, 0], corner[0]), ...corner.slice(1).map((p, i) => line(corner[i], p)), line(corner[200], [20, 20]), line([20, 20], [0, 20]), line([0, 20], [0, 0])];
    const made = assemble(read(...curves));
    console.log('J1 default weld:', brief(made.report));
    expect(made.report.curves).toBe(204);
    expect(made.report.welded).toBe(0);
    const state = inSketch(Object.fromEntries(Object.entries(made.curves).slice(0, 204)));
    console.log('J1 in a sketch: valid', resultOf(state, 's').valid, 'regions', resultOf(state, 's').regions.length);
  });

  it('J2: a chain of ends each within the weld of the next: no end moves further than the weld', () => {
    // ends at x = 0, 0.009 and 0.018 (the reviews, fable 1 and codex 2)
    const made = assemble(read(line([-5, 0], [0, 0]), line([0.009, 0], [0.009, 5]), line([0.018, 0], [5, 0.018])));
    console.log('J2', brief(made.report), 'ends', JSON.stringify([(made.curves.l1 as { b: Vec2 }).b, (made.curves.l2 as { a: Vec2 }).a, (made.curves.l3 as { a: Vec2 }).a]), 'gap', JSON.stringify(made.report.gaps[0]));
    expect(made.report.moved).toBeLessThanOrEqual(0.01);
    expect(made.report.blocked).toBe(1);
  });

  it('J3: an arc of nearly a whole turn is a circle; with a line that meets it, an arc', () => {
    const alone = assemble(read(...square(20), arc([10, 10], 1.6, 0, 359.9)));
    console.log('J3 a hole as ARC 0 to 359.9:', brief(alone.report), 'ids', Object.keys(alone.curves).join(' '));
    expect(alone.report.byKind.circle).toBe(1);
    const state = inSketch(alone.curves);
    console.log('J3 in a sketch: valid', resultOf(state, 's').valid, 'regions', resultOf(state, 's').regions.map((r) => r.loops.length));
    const less = assemble(read(...square(20), arc([10, 10], 1.6, 0, 359)));
    console.log('J3 0 to 359:', brief(less.report));
    // a key hole: the two ends of the arc are met by two lines
    const [s, e] = [polar([10, 10], 1.6, 0), polar([10, 10], 1.6, 359.9)];
    const key = assemble(read(arc([10, 10], 1.6, 0, 359.9), line(s, [15, 10]), line(e, [15, 9.9972])));
    console.log('J3 a key hole:', brief(key.report));
    expect(key.report.byKind.arc).toBe(1);
  });

  it('J4: an arc of a large radius and nearly a whole turn keeps its radius when a neighbour is welded to it', () => {
    // the review, codex 3: radius 1000, an end of a neighbour 0.009 mm from its end
    const big = arc([0, 1000], 1000, -90, 269.999);
    const end = (big as { end: Vec2 }).end;
    const withLine = assemble(read(big, line([end[0] + 0.009, end[1]], [end[0] + 50, end[1] - 50])));
    const a1 = withLine.curves.a1 as { center: Vec2; start: Vec2; end: Vec2 };
    console.log('J4 a line 0.009 from the end:', brief(withLine.report), 'radius', dist(a1.start, a1.center), dist(a1.end, a1.center), 'line a', JSON.stringify((withLine.curves.l1 as { a: Vec2 }).a));
    expect(dist(a1.start, a1.center)).toBeCloseTo(1000, 9);
    // another arc there: one of the two would have to be re-centred
    const second = arc([end[0] + 0.009, end[1] - 30], 30, 90, 180);
    const withArc = assemble(read(big, second));
    const [p, q] = [withArc.curves.a1 as { center: Vec2; start: Vec2; end: Vec2 }, withArc.curves.a2 as { center: Vec2; start: Vec2; end: Vec2 }];
    console.log('J4 an arc 0.009 from the end:', brief(withArc.report), 'radii', dist(p.start, p.center), dist(q.start, q.center), dist(q.end, q.center), 'centre of the second moved', dist(q.center, (second as { center: Vec2 }).center));
    expect(Math.abs(dist(p.start, p.center) - 1000)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(dist(q.start, q.center) - 30)).toBeLessThanOrEqual(0.01);
  });

  it('J5: two arcs that meet with a gap: the later is re-centred within the weld', () => {
    for (const gap of [0.0007, 0.005, 0.02]) {
      const first = arc([1.2345, 2.3456], 10, 0, 90);
      const second = arc([1.2345 + gap, 2.3456 - gap / 2], 10, 90, 180);
      const made = assemble(read(first, second));
      const q = made.curves.a2 as { center: Vec2; start: Vec2; end: Vec2 };
      console.log(`J5 gap ${gap}:`, brief(made.report), '|rs − re|', Math.abs(dist(q.start, q.center) - dist(q.end, q.center)).toExponential(2), 'radius', dist(q.start, q.center).toFixed(6), 'centre moved', dist(q.center, (second as { center: Vec2 }).center).toExponential(2));
      expect(made.report.moved).toBeLessThanOrEqual(0.01);
      expect(made.report.shifted).toBeLessThanOrEqual(0.01);
    }
  });

  it('J6: a curve twice in a file', () => {
    const made = assemble(read(...square(20), line([20, 0], [0, 0]), { type: 'circle', center: [5, 5], radius: 1 }, { type: 'circle', center: [5, 5], radius: 1 }));
    console.log('J6', brief(made.report), 'ids', Object.keys(made.curves).join(' '));
    const state = inSketch(made.curves);
    console.log('J6 in a sketch: valid', resultOf(state, 's').valid, 'regions', resultOf(state, 's').regions.length);
    expect(made.report.duplicates).toBe(2);
    expect(resultOf(state, 's').valid).toBe(true);
  });

  it('J7: a local ID every object has', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY));
    for (const key of ['__proto__', 'constructor', 'toString', 'l1']) {
      const curves = JSON.parse(`{"${key}":{"type":"line","a":[0,0],"b":[10,0]}}`) as object;
      const result = engine.preview(addOutline('s', 'o', { type: 'outline', curves }));
      console.log(`J7 "${key}":`, result.ok ? `accepted, entities ${Object.keys(resultOf(result.state, 's').curves).filter((id) => id.startsWith('o/')).length}` : result.error.message);
      expect(result.ok).toBe(key === 'l1');
    }
  });

  it('J8: the document does not hold the object of the caller, and keeps its own', () => {
    const engine = newEngine();
    const given: Record<string, ImportedCurve> = { l1: line([0, 0], [10, 0]), l2: line([10, 0], [10, 10]) };
    const state = run(engine, addSketch('s', XY), addOutline('s', 'o', { type: 'outline', curves: given }));
    const held = (s: EngineState): object => (s.document.features[0] as unknown as { external: { o: { curves: object } } }).external.o.curves;
    (given.l1 as { a: Vec2 }).a[0] = 999;
    const after = run(engine, { type: 'addPoint', sketch: 's', id: 'p', x: 1, y: 1 });
    const flag = run(engine, { type: 'updateExternal', sketch: 's', id: 'o', ref: { ...(after.document.features[0] as unknown as { external: { o: object } }).external.o, regions: false } } as unknown as Command);
    console.log('J8 the object given is held', held(state) === given, '; after the caller wrote into it the document has', JSON.stringify((held(after) as { l1: { a: Vec2 } }).l1.a), '; the same object after addPoint', held(after) === held(state), 'after a switch of the flag', held(flag) === held(state), '; stamp kept by the flag', (flag.document.features[0] as unknown as { solved: { inputs: string } }).solved.inputs === (after.document.features[0] as unknown as { solved: { inputs: string } }).solved.inputs);
    expect(held(state)).not.toBe(given);
    expect(held(flag)).toBe(held(state));
  });

  it('J9: a closed spline of an outline', () => {
    const closed: ImportedCurve = { type: 'spline', points: [[0, 0], [10, -5], [20, 0], [20, 10], [10, 15], [0, 10], [0, 0]] };
    const state = inSketch({ s1: closed });
    const result = resultOf(state, 's');
    console.log('J9 a closed spline alone: status', state.evaluation.features.s.status, 'valid', result.valid, 'regions', result.regions.map((r) => r.ref.outerLoop), 'openEnds', JSON.stringify(result.openEnds));
  });

  it('J10: an own line from a corner of an outline, tangent to the arc that starts there', () => {
    // the review, agy 7: the own point is coincident with the end of the line `o/l1/b`; the arc
    // `o/a1` starts at the same place under another ID, `o/a1/start`
    for (const corner of ['pcbo/l1/b', 'pcbo/a1/start']) {
      const engine = newEngine();
      const { curves } = boardFile(60);
      run(engine, addSketch('s', XY), addOutline('s', 'pcbo', outlineEntry(curves, { anchor: 'center' })), { type: 'addPoint', sketch: 's', id: 'p', x: 26.5, y: -19.5 }, { type: 'addPoint', sketch: 's', id: 'q', x: 35, y: -19 }, { type: 'addCurve', sketch: 's', id: 'n', curve: { type: 'line', a: 'p', b: 'q', construction: true } });
      run(engine, constrain('s', 'k1', { type: 'coincident', a: 'p', b: corner }));
      const result = engine.execute(constrain('s', 'k2', { type: 'tangent', a: 'n', b: 'pcbo/a1' }));
      if (!result.ok) {
        console.log(`J10 held on ${corner}: refused,`, result.error.message);
        continue;
      }
      const sketch = resultOf(result.state, 's');
      const diagnosis = engine.diagnoseSketch('s');
      console.log(`J10 held on ${corner}: status`, result.state.evaluation.features.s.status, result.state.evaluation.features.s.error?.code ?? '', 'dof', diagnosis.degreesOfFreedom, 'redundant', JSON.stringify(diagnosis.redundant), 'conflicting', JSON.stringify(diagnosis.conflicting), 'p', JSON.stringify(sketch.points.p), 'q', JSON.stringify(sketch.points.q));
      // the line is tangent when it is horizontal: the arc starts at (27, -20) going right
      const moved = engine.execute({ type: 'dragPoint', sketch: 's', point: 'q', x: 36, y: -12 });
      console.log(`J10 after a drag of q:`, moved.ok ? `${moved.state.evaluation.features.s.status} q ${JSON.stringify(resultOf(moved.state, 's').points.q)}` : moved.error.message);
    }
  });

  it('J11: a swap of IDs in a revised file is found', () => {
    const { curves } = boardFile(60);
    const swapped = { ...curves, c1: curves.c2, c2: curves.c1 };
    console.log('J11 two holes the other way round:', JSON.stringify(outlineRevision(curves, swapped)), '; the wider file:', JSON.stringify(outlineRevision(curves, boardFile(62).curves)));
    expect(outlineRevision(curves, swapped).renamed).toEqual([{ id: 'c1', was: 'c2' }, { id: 'c2', was: 'c1' }]);
  });

  it('J12: outlines of many splines', async () => {
    const real = await createPlanegcsSolver();
    const kernel = await createManifoldKernel();
    const narrow: SketchSolver = {
      ...real,
      solve(input: SolveInput & { drag?: unknown }) {
        const named = new Set(Object.values(input.constraints).flatMap(constraintOperands));
        const fixed = new Set(input.fixed);
        const pointsOf = (id: string): string[] => {
          const c = input.curves[id];
          return c.type === 'line' ? [c.a, c.b] : c.type === 'circle' ? [c.center] : c.type === 'arc' ? [c.center, c.start, c.end] : c.points;
        };
        const curves = Object.fromEntries(Object.entries(input.curves).filter(([id]) => named.has(id) || pointsOf(id).some((p) => !fixed.has(p))));
        const used = new Set([...named, ...Object.keys(curves).flatMap(pointsOf), 'origin']);
        const points = Object.fromEntries(Object.entries(input.points).filter(([id]) => !fixed.has(id) || used.has(id)));
        const radii = Object.fromEntries(Object.entries(input.radii).filter(([id]) => id in curves));
        const result = real.solve({ ...input, points, radii, curves, fixed: input.fixed.filter((id) => id in points || id in curves) } as never);
        return { ...result, points: { ...input.points, ...result.points }, radii: { ...input.radii, ...result.radii } };
      },
    } as SketchSolver;
    // a closed chain of n splines of m control points each around a circle of radius 100, wavy
    const chain = (n: number, m: number): Record<string, ImportedCurve> => {
      const at = (t: number, wave: number): Vec2 => polar([0, 0], 100 + wave, (360 * t) / n);
      return Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i + 1}`, { type: 'spline', points: Array.from({ length: m }, (_, k) => at(i + k / (m - 1), k === 0 || k === m - 1 ? 0 : 3 * (k % 2 ? 1 : -1))) } as ImportedCurve]));
    };
    for (const [n, m] of [[500, 4], [2000, 4], [31, 64], [125, 64]] as const) {
      const curves = chain(n, m);
      const engine = createEngine({ solver: narrow, kernel });
      run(engine, addSketch('s', XY), { type: 'addPoint', sketch: 's', id: 'p', x: 1, y: 1 });
      let t0 = performance.now();
      const added = engine.execute(addOutline('s', 'o', outlineEntry(curves)));
      const add = performance.now() - t0;
      if (!added.ok) {
        console.log(`J12 ${n} splines of ${m}: refused`, added.error.message);
        continue;
      }
      t0 = performance.now();
      for (let i = 0; i < 5; i++) engine.execute({ type: 'dragPoint', sketch: 's', point: 'p', x: 2 + i, y: 1 });
      const drag = (performance.now() - t0) / 5;
      const off = engine.execute({ type: 'updateExternal', sketch: 's', id: 'o', ref: { ...outlineEntry(curves), regions: false } } as unknown as Command);
      t0 = performance.now();
      for (let i = 0; i < 5; i++) engine.execute({ type: 'dragPoint', sketch: 's', point: 'p', x: 2 + i, y: 2 });
      const dragOff = (performance.now() - t0) / 5;
      const result = resultOf(added.state, 's');
      console.log(`J12 ${n} splines of ${m} points (${n * m} positions): addExternal ${add.toFixed(0)} ms, a drag ${drag.toFixed(0)} ms, with the flag off ${dragOff.toFixed(0)} ms (${off.ok}); valid ${result.valid}, regions ${result.regions.length}, the loop ${result.regions[0]?.loops[0].length / 2} points; the entry ${JSON.stringify(curves).length} characters`);
    }
  }, 600000);
});

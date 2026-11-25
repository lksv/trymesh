// Probe K: what the second round of reviews asked to be measured. The IDs against the weld, an arc
// beside a line, curves twice before the weld, a short line, an arc with a chord under the join,
// the cost of curves that do not meet and of ends in a cluster, the limits of control points, the
// output of the readers against the validator, the cache per entry, the revision, arcs that
// continue each other, and the common end of the adapter emulated at the port. Rows K1 to K12.
import { describe, expect, it, vi } from 'vitest';
import { type Command, type Constraint, type EngineState, type SketchSolver, type SolveInput, createEngine } from '../../../../packages/engine/src/index';
import { createManifoldKernel } from '../../../../packages/kernel-manifold/src/index';
import { createPlanegcsSolver } from '../../../../packages/solver-planegcs/src/index';
import { XY, addSketch, constrain, newEngine, run } from '../../../../packages/scenarios/test/kit';
import { boardFile } from './cover';
import { splineCurves } from './dxf';
import { addOutline, resultOf } from './kit';
import { type ImportedCurve, type PlacedOutline, type ReadOutline, type SketchOutline, type Vec2, assemble, curveProblem, installOutlineKind, outlineEntry, outlineGeometry, outlineRevision, placeOutline } from './proto';
import { readSvg } from './svg';

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
const circle = (c: Vec2, radius: number): ImportedCurve => ({ type: 'circle', center: c, radius });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const brief = (r: ReturnType<typeof assemble>['report']): string => `curves ${r.curves} ${JSON.stringify(r.byKind)} welded ${r.welded} moved ${r.moved.toPrecision(3)} reshaped ${r.reshaped} bent ${r.bent.toPrecision(3)} radius ${r.radius.toPrecision(3)} closed ${r.closed} dropped ${r.dropped} duplicates ${r.duplicates} blocked ${r.blocked} crowded ${r.crowded} open ${r.open} gaps ${r.gaps.length}`;
const inSketch = (curves: Record<string, ImportedCurve>): EngineState => run(newEngine(), addSketch('s', XY), addOutline('s', 'o', outlineEntry(curves)));
const square = (s: number, gap = 0): ImportedCurve[] => [line([0, 0], [s - gap, 0]), line([s, 0], [s, s - gap]), line([s, s], [gap, s]), line([0, s], [0, gap])];
const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const rounded = (p: Vec2, digits: number): Vec2 => [round(p[0], digits), round(p[1], digits)];
const svg = (body: string): ReadOutline => readSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">${body}</svg>`);
let seed = 12345;
const random = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

describe('K: the second round of reviews', () => {
  it('K1: the IDs do not depend on the weld', () => {
    // a hole written as an arc of nearly a whole turn, between circles and arcs (the reviews: fable 4, codex 2, agy 6)
    const file = read(...square(40), arc([10, 10], 1.6, 0, 359.9), circle([20, 10], 1), arc([30, 30], 3, 0, 90), circle([10, 30], 1), arc([30, 10], 3, 180, 300));
    const ids = [0.01, 0.001, 0].map((weld) => {
      const made = assemble(file, weld);
      return `${Object.keys(made.curves).join(' ')} (a1 is ${made.curves.a1.type})`;
    });
    console.log('K1 weld 0.01:', ids[0], '| 0.001:', ids[1], '| 0:', ids[2]);
    expect(ids[0].split(' (')[0]).toBe(ids[2].split(' (')[0]);
    const [asCircle, asArc] = [assemble(file, 0.01).curves, assemble(file, 0).curves];
    console.log('K1 the revision between the two:', JSON.stringify(outlineRevision(asCircle, asArc)));
  });

  it('K2: an arc gives way to another arc only', () => {
    // two lines that meet at (1.005, 0) beside an arc that starts at (1, 0) (the review, codex 4)
    const unit = arc([0, 0], 1, 0, 90);
    const made = assemble(read(unit, line([1.005, 0], [3, 0]), line([1.005, 0], [1.005, -2])));
    const a1 = made.curves.a1 as { center: Vec2; start: Vec2 };
    console.log('K2 two lines met 0.005 from the start of an arc:', brief(made.report), '; the arc starts at', JSON.stringify(a1.start), 'centre', JSON.stringify(a1.center));
    expect(a1.start).toEqual([1, 0]);
    expect(made.report.reshaped).toBe(0);
    // an open spline end beside an arc: the spline moves
    const withSpline = assemble(read(unit, { type: 'spline', points: [[1.004, 0], [2, 0.5], [3, 0], [4, 1]] }));
    console.log('K2 a spline 0.004 from the start of an arc:', brief(withSpline.report), JSON.stringify((withSpline.curves.s1 as { points: Vec2[] }).points[0]));
  });

  it('K3: a curve twice is left out before the ends are looked at', () => {
    // a square with four gaps of 0.005, each side twice (the review, codex 5)
    const once = assemble(read(...square(20, 0.005)));
    const twice = assemble(read(...square(20, 0.005), ...square(20, 0.005)));
    console.log('K3 a square with gaps, once:', brief(once.report), '| each side twice:', brief(twice.report));
    expect(twice.report.open).toBe(0);
    expect(twice.report.duplicates).toBe(4);
    // a line that ends 0.0085 from an arc of radius 1000, the line twice (the review, fable 6)
    const big = arc([0, 1000], 1000, -90, 0);
    const beside = line([0.0085, 0], [-50, -50]);
    const doubled = assemble(read(big, beside, beside));
    console.log('K3 a line twice beside an arc:', brief(doubled.report));
    expect(doubled.report.reshaped).toBe(0);
    expect(doubled.report.blocked).toBe(0);
  });

  it('K4: a short line between two ends is not collapsed', () => {
    // an end at x = 0; a line from 0.003 to 0.006; a line from 0.0135 (the review, fable 8)
    const made = assemble(read(line([-5, 0], [0, 0]), line([0.003, 0], [0.006, 0]), line([0.0135, 0], [5, 0])));
    console.log('K4', brief(made.report), JSON.stringify(Object.values(made.curves).map((c) => (c.type === 'line' ? [c.a[0], c.b[0]] : []))));
    expect(made.report.dropped).toBe(0);
    expect(made.report.open).toBe(2);
  });

  it('K5: an arc of nearly a whole turn with a chord under the join', () => {
    // 0° to 359.99999°, radius 1.6: the chord is 2.8e-7 mm (the review, fable 5)
    const hole = arc([10, 10], 1.6, 0, 359.99999);
    for (const weld of [0.01, 0]) console.log(`K5 alone, weld ${weld}:`, brief(assemble(read(...square(20), hole), weld).report));
    const [s, e] = [(hole as { start: Vec2 }).start, (hole as { end: Vec2 }).end];
    console.log('K5 with a line on each end:', brief(assemble(read(hole, line(s, [15, 10]), line(e, [15, 9.99])), 0.01).report));
    expect(assemble(read(...square(20), hole), 0).report.byKind.circle).toBe(1);
  });

  it('K6: the cost of curves that do not meet, and of ends in a cluster', () => {
    // strokes 5 mm apart, none meeting (the review, fable 3: 3.1, 6.9, 14.5, 30.1 s)
    for (const n of [500, 1000, 2000, 4000, 8000]) {
      const strokes = Array.from({ length: n }, (_, i) => line([(i % 100) * 5, Math.floor(i / 100) * 5], [(i % 100) * 5 + 3, Math.floor(i / 100) * 5 + 1]));
      const t0 = performance.now();
      let said = '';
      try {
        said = brief(assemble(read(...strokes)).report);
      } catch (error) {
        said = (error as Error).message;
      }
      console.log(`K6 ${n} strokes that do not meet: ${(performance.now() - t0).toFixed(0)} ms;`, said.slice(0, 150));
    }
    // lines whose starts are in one small cluster and whose ends are in another, all more than
    // 1e-6 apart (the review, codex 7: 63,992,000 pairs for 8000 lines)
    for (const n of [400, 8000]) {
      const cluster = Array.from({ length: n }, (_, i) => line([(i % 90) * 1e-5, Math.floor(i / 90) * 1e-5], [50 + (i % 90) * 1e-5, 20 + Math.floor(i / 90) * 1e-5]));
      const t0 = performance.now();
      let said = '';
      try {
        said = brief(assemble(read(...cluster)).report);
      } catch (error) {
        said = (error as Error).message;
      }
      console.log(`K6 ${n} lines from one cluster to another: ${(performance.now() - t0).toFixed(0)} ms;`, said.slice(0, 190));
    }
  }, 120000);

  it('K7: the limits of control points, of one spline and of a local ID', () => {
    const splines = (n: number, m: number): ImportedCurve[] => Array.from({ length: n }, (_, i) => ({ type: 'spline', points: Array.from({ length: m }, (_, k) => [i * 10 + k, k % 2] as Vec2) }));
    const refusedBy = (run: () => unknown): string => {
      try {
        run();
        return 'accepted';
      } catch (error) {
        return (error as Error).message;
      }
    };
    console.log('K7 500 splines of 4:', refusedBy(() => assemble(read(...splines(500, 4)))), '| 501:', refusedBy(() => assemble(read(...splines(501, 4)))));
    const engine = newEngine();
    run(engine, addSketch('s', XY));
    const add = (curves: object): string => {
      const result = engine.preview(addOutline('s', 'o', { type: 'outline', curves }));
      return result.ok ? 'accepted' : result.error.message;
    };
    console.log('K7 the validator, 2004 control points:', add(Object.fromEntries(splines(501, 4).map((c, i) => [`s${i + 1}`, c]))));
    console.log('K7 the validator, a spline of 65 points:', add({ s1: splines(1, 65)[0] }), '| a local ID of 33 characters:', add({ ['l'.repeat(33)]: line([0, 0], [1, 0]) }), '| points that are no list:', add({ s1: { type: 'spline', points: 7 } }));
    expect(refusedBy(() => assemble(read(...splines(501, 4))))).toContain('tooLarge');
  });

  it('K8: what the readers give is what the validator takes', () => {
    // nodes without a handle, a smooth command after a line, a control point twice (the reviews: fable 2, codex 10, agy 2)
    const files: [string, ReadOutline][] = [
      ['C with its first control point on its start', svg('<path d="M10 10 C10 10 30 0 40 10 L40 30 L10 30 Z"/>')],
      ['C with its second control point on its end', svg('<path d="M10 10 C20 0 40 10 40 10 L40 30 L10 30 Z"/>')],
      ['S after L', svg('<path d="M10 30 L10 10 S30 0 40 10 L40 30 Z"/>')],
      ['T after L', svg('<path d="M10 30 L10 10 T40 10 L40 30 Z"/>')],
      ['Q that returns to its start, C of one place', svg('<path d="M10 10 L40 10 L40 30 L10 30 Z M50 50 Q60 40 50 50 M70 70 C70 70 70 70 70 70"/>')],
    ];
    const cubic = (knots: number[]): ReadOutline => {
      const made = splineCurves([[0, 0], [0, 0], [10, 10], [20, 10], [30, 0], [30, 0]], knots, 3);
      return read(...('curves' in made ? made.curves : []), line([30, 0], [0, 0]));
    };
    files.push(['a DXF spline with a control point twice, even knots', cubic([0, 0, 0, 0, 1, 2, 3, 3, 3, 3])], ['the same with uneven knots', cubic([0, 0, 0, 0, 1, 2.5, 3, 3, 3, 3])]);
    for (const [name, file] of files) {
      const made = assemble(file);
      const problems = Object.entries(made.curves).flatMap(([id, curve]) => (curveProblem(curve) ? [`${id}: ${curveProblem(curve)}`] : []));
      const state = inSketch(made.curves);
      console.log(`K8 ${name}: ${JSON.stringify(made.report.byKind)} dropped ${made.report.dropped}; refused by the validator ${JSON.stringify(problems)}; in a sketch ${state.evaluation.features.s.status}, valid ${resultOf(state, 's').valid}, regions ${resultOf(state, 's').regions.length}, open ends ${resultOf(state, 's').openEnds?.count ?? 0}`);
      expect(problems).toEqual([]);
    }
    // the property over generated paths: points on a coarse grid, so that control points fall on each other and on ends
    let [paths, curves, dropped] = [0, 0, 0];
    for (let i = 0; i < 400; i++) {
      const at = (): string => `${Math.floor(random() * 4) * 10} ${Math.floor(random() * 4) * 10}`;
      let d = `M${at()}`;
      for (let k = 0; k < 2 + Math.floor(random() * 6); k++) d += [`L${at()}`, `C${at()} ${at()} ${at()}`, `S${at()} ${at()}`, `Q${at()} ${at()}`, `T${at()}`, `A${5 + Math.floor(random() * 3) * 10} ${5 + Math.floor(random() * 3) * 10} 0 ${random() < 0.5 ? 0 : 1} ${random() < 0.5 ? 0 : 1} ${at()}`][Math.floor(random() * 6)];
      if (random() < 0.5) d += 'Z';
      let made: ReturnType<typeof assemble>;
      try {
        made = assemble(svg(`<path d="${d}"/>`), [0.01, 0][i % 2]);
      } catch {
        continue; // a path of arcs of two radii alone is listed, and the file is then empty
      }
      paths++;
      curves += made.report.curves;
      dropped += made.report.dropped;
      for (const [id, curve] of Object.entries(made.curves)) expect(curveProblem(curve), `${d} ${id}`).toBeUndefined();
    }
    console.log(`K8 generated paths: ${paths} read, ${curves} curves kept, ${dropped} dropped, none refused by the validator`);
  });

  it('K9: the geometry is kept per entry', () => {
    const { curves } = boardFile(60);
    const [a, b] = [outlineEntry(curves), outlineEntry(curves, { x: 100 })] as [SketchOutline, SketchOutline];
    const [va, vb] = [placeOutline(a), placeOutline(b)] as [PlacedOutline, PlacedOutline];
    const first = outlineGeometry('a', a, va);
    outlineGeometry('b', b, vb);
    console.log('K9 two entries over one object of curves: A, then B, then A again is the same geometry:', outlineGeometry('a', a, va) === first);
    expect(outlineGeometry('a', a, va)).toBe(first);
  });

  it('K10: the revision of a file with a curve put in first, and of lines swapped', () => {
    const holes = (list: Vec2[]): Record<string, ImportedCurve> => assemble(read(...square(40), ...list.map((c) => circle(c, 1)))).curves;
    const four: Vec2[] = [[5, 5], [35, 5], [35, 35], [5, 35]];
    console.log('K10 a hole listed first:', JSON.stringify(outlineRevision(holes(four), holes([[20, 20], ...four]))));
    const lines = assemble(read(line([0, 0], [10, 0]), line([10, 0], [10, 10]), line([10, 10], [0, 0]))).curves;
    const swapped = assemble(read(line([10, 10], [10, 0]), line([0, 0], [10, 0]), line([10, 10], [0, 0]))).curves;
    console.log('K10 two lines swapped, one the other way round:', JSON.stringify(outlineRevision(lines, swapped)));
    expect(outlineRevision(holes(four), holes([[20, 20], ...four])).renamed).toHaveLength(4);
    expect(outlineRevision(lines, swapped).renamed).toHaveLength(2);
    // places a hair apart across the edge of a cell of 1e-6 (the review, agy 5)
    const near = outlineRevision({ c1: circle([4.99999999e-7, 0], 1), c2: circle([5, 5], 1) }, { c1: circle([5, 5], 1), c2: circle([5.00000001e-7, 0], 1) });
    console.log('K10 two places 2e-15 apart across a cell edge:', JSON.stringify(near.renamed));
    expect(near.renamed).toHaveLength(2);
  });

  it('K11: two arcs that continue each other, written with few decimals', () => {
    // an S of two arcs of one radius, each end rounded as a file rounds it (the review, fable 7)
    for (const [r, sweep] of [[10, 90], [10, 30], [50, 20], [50, 10], [200, 5], [500, 2]] as const) {
      const row: string[] = [];
      for (const digits of [2, 3, 4]) {
        let [joints, blocked, worst, radius] = [0, 0, 0, 0];
        for (let i = 0; i < 200; i++) {
          const c1: Vec2 = [random() * 50, random() * 50];
          const from = random() * 360;
          const meet = polar(c1, r, from + sweep);
          const c2 = polar(c1, 2 * r, from + sweep);
          // the first arc counter-clockwise about c1 up to the joint; the second counter-clockwise about c2, ending at the joint
          const first: ImportedCurve = { type: 'arc', center: rounded(c1, digits), start: polar(rounded(c1, digits), round(r, digits), round(from, digits)), end: polar(rounded(c1, digits), round(r, digits), round(from + sweep, digits)) };
          const second: ImportedCurve = { type: 'arc', center: rounded(c2, digits), start: polar(rounded(c2, digits), round(r, digits), round(from + sweep + 180 - sweep, digits)), end: polar(rounded(c2, digits), round(r, digits), round(from + sweep + 180, digits)) };
          if (dist((first as { end: Vec2 }).end, (second as { end: Vec2 }).end) <= 1e-6) continue;
          void meet;
          joints++;
          const made = assemble(read(first, second));
          if (made.report.welded === 0) blocked++;
          worst = Math.max(worst, made.report.bent);
          radius = Math.max(radius, made.report.radius);
        }
        row.push(`${digits} decimals: ${blocked} not closed of ${joints}, bent at most ${worst.toExponential(1)}, a radius changed by up to ${radius.toPrecision(2)}`);
      }
      console.log(`K11 R ${r}, ${sweep}°:`, row.join(' | '));
    }
  });

  it('K12: the common end of a line and an arc, with two fixed points at one place taken for one', async () => {
    const real = await createPlanegcsSolver();
    const kernel = await createManifoldKernel();
    // The rule of the design, emulated at the port: when one coincident joins an end of the line
    // and an end of the arc but for two fixed points at one place (within `reach` of the radius of
    // the arc, at most 1e-6 mm), the coincident is handed to the adapter with the fixed point of
    // the other curve, which stands at the same place, so `commonEnd` finds the common end.
    let taken = 0;
    const withRule = (reach: (radius: number) => number): SketchSolver =>
      ({
        ...real,
        solve(input: SolveInput) {
          const fixed = new Set(input.fixed);
          const constraints: Record<string, Constraint> = { ...input.constraints };
          for (const t of Object.values(input.constraints)) {
            if (t.type !== 'tangent') continue;
            const [la, ar] = [input.curves[t.a], input.curves[t.b]].sort((p, q) => (p.type === 'line' ? -1 : q.type === 'line' ? 1 : 0));
            if (la?.type !== 'line' || ar?.type !== 'arc') continue;
            const radius = Math.hypot(input.points[ar.start].x - input.points[ar.center].x, input.points[ar.start].y - input.points[ar.center].y);
            const near = (p: string, q: string): boolean => p !== q && fixed.has(p) && fixed.has(q) && Math.hypot(input.points[p].x - input.points[q].x, input.points[p].y - input.points[q].y) <= reach(radius);
            const [lineEnds, arcEnds] = [[la.a, la.b], [ar.start, ar.end]];
            for (const [id, c] of Object.entries(input.constraints)) {
              if (c.type !== 'coincident') continue;
              for (const [u, v] of [[c.a, c.b], [c.b, c.a]]) {
                // u is an end of one curve; v is a fixed point at the place of an end of the other
                const other = lineEnds.includes(u) ? arcEnds.find((e) => near(v, e)) : arcEnds.includes(u) ? lineEnds.find((e) => near(v, e)) : undefined;
                if (other === undefined) continue;
                constraints[id] = { ...c, a: u, b: other };
                taken++;
              }
            }
          }
          return real.solve({ ...input, constraints });
        },
      }) as SketchSolver;
    const rules: [string, (radius: number) => number][] = [['today', () => -1], ['within 1e-6 mm', () => 1e-6], ['within 1e-6 of the radius, at most 1e-6 mm', (radius) => 1e-6 * Math.min(1, radius)]];
    const report = (name: string, build: (s: SketchSolver) => { state: EngineState; engine: ReturnType<typeof createEngine>; off: () => number }): void => {
      for (const [rule, reach] of rules) {
        taken = 0;
        const { state, engine, off } = build(withRule(reach));
        const d = engine.diagnoseSketch('s');
        console.log(`K12 ${name} | ${rule}: taken ${taken > 0}, status ${state.evaluation.features.s.status}${state.evaluation.features.s.error ? ` ${state.evaluation.features.s.error.code}` : ''}, dof ${d.degreesOfFreedom}, redundant ${JSON.stringify(d.redundant)}, conflicting ${JSON.stringify(d.conflicting)}, off the tangent ${off().toExponential(1)}`);
      }
    };
    // J10: an own line from the corner of the board, held on the end of the line, tangent to the corner arc
    report('an own line from the corner, held on pcbo/l1/b', (solver) => {
      const engine = createEngine({ solver, kernel });
      const { curves } = boardFile(60);
      run(engine, addSketch('s', XY), addOutline('s', 'pcbo', outlineEntry(curves, { anchor: 'center' })), { type: 'addPoint', sketch: 's', id: 'p', x: 26.5, y: -19.5 }, { type: 'addPoint', sketch: 's', id: 'q', x: 35, y: -19 }, { type: 'addCurve', sketch: 's', id: 'n', curve: { type: 'line', a: 'p', b: 'q', construction: true } }, constrain('s', 'k1', { type: 'coincident', a: 'p', b: 'pcbo/l1/b' }), constrain('s', 'k2', { type: 'tangent', a: 'n', b: 'pcbo/a1' }));
      const state = run(engine, { type: 'dragPoint', sketch: 's', point: 'q', x: 36, y: -12 });
      return { state, engine, off: () => Math.abs(resultOf(engine.getState(), 's').points.q.y + 20) + Math.abs(resultOf(engine.getState(), 's').points.q.x - 36) * 0 };
    });
    // the mirror: an own arc that starts at the corner, held on the start of the corner arc, tangent to the line of the outline
    report('an own arc from the corner, held on pcbo/a1/start, tangent to pcbo/l1', (solver) => {
      const engine = createEngine({ solver, kernel });
      const { curves } = boardFile(60);
      run(engine, addSketch('s', XY), addOutline('s', 'pcbo', outlineEntry(curves, { anchor: 'center' })), { type: 'addPoint', sketch: 's', id: 'c', x: 27.3, y: -24.8 }, { type: 'addPoint', sketch: 's', id: 'p', x: 27.2, y: -20.1 }, { type: 'addPoint', sketch: 's', id: 'e', x: 32, y: -25.2 }, { type: 'addCurve', sketch: 's', id: 'n', curve: { type: 'arc', center: 'c', start: 'e', end: 'p', construction: true } } as Command, constrain('s', 'k1', { type: 'coincident', a: 'p', b: 'pcbo/a1/start' }), constrain('s', 'k2', { type: 'tangent', a: 'pcbo/l1', b: 'n' }));
      const state = run(engine, { type: 'dragPoint', sketch: 's', point: 'e', x: 33, y: -26 });
      // tangent to the horizontal line at (27, -20): the centre is straight below the corner
      return { state, engine, off: () => Math.abs(resultOf(engine.getState(), 's').points.c.x - 27) };
    });
    // near but not one place, at several sizes: a fixed point `d` inside the start of a fixed arc by a part of its radius
    for (const [radius, inside] of [[3, 5e-7], [3, 2e-6], [1e-2, 5e-9], [1e-2, 5e-7], [1e-4, 5e-7]] as const) {
      report(`a fixed arc of radius ${radius}, a fixed point ${inside} inside its start`, (solver) => {
        const engine = createEngine({ solver, kernel });
        const fixedArc: ImportedCurve = { type: 'arc', center: [0, 0], start: [radius, 0], end: [0, radius] };
        const stub: ImportedCurve = { type: 'line', a: [radius - inside, 0], b: [radius - inside, -10 * radius] };
        const state = run(engine, addSketch('s', XY), addOutline('s', 'o', outlineEntry({ a1: fixedArc, l1: stub }, { regions: false })), { type: 'addPoint', sketch: 's', id: 'p', x: radius, y: 0.1 * radius }, { type: 'addPoint', sketch: 's', id: 'q', x: radius * 1.1, y: 5 * radius }, { type: 'addCurve', sketch: 's', id: 'n', curve: { type: 'line', a: 'p', b: 'q' } }, constrain('s', 'k1', { type: 'coincident', a: 'p', b: 'o/l1/a' }), constrain('s', 'k2', { type: 'tangent', a: 'n', b: 'o/a1' }));
        // the tangent at the start of the arc is vertical: how far q is off the vertical through p, by the radius
        return { state, engine, off: () => Math.abs(resultOf(engine.getState(), 's').points.q.x - resultOf(engine.getState(), 's').points.p.x) / radius };
      });
    }
  }, 120000);
});

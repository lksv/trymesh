// The import of an outline (D72) with the real solver and kernel: the engine's own DXF of a section
// read back, a board as a PCB tool writes it placed and extruded, a file with few digits that does
// not close, rings far from the origin of their file welded and placed, and arcs that give way. The
// pure cases are in packages/engine/test/outline-import.test.ts.
import { describe, expect, it } from 'vitest';
import { type EngineState, type Id, type ImportedCurve, type OutlineFormat, type SketchResult, type Vec2, importOutline } from '@trymesh/engine';
import { IMPORTED_OUTLINE, addOutline, boardDxf, pcbByHand, standInBoard } from './board-kit';
import { XY, addExtrude, addSketch, newEngine, run, status, volume } from './kit';

const resultOf = (state: EngineState, id: Id): SketchResult => state.evaluation.features[id].sketch as SketchResult;
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const read = (format: OutlineFormat, text: string | Uint8Array, options: Record<string, unknown> = {}) => {
  const outcome = importOutline(format, typeof text === 'string' ? bytes(text) : text, options as never);
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome;
};
const loopArea = (loop: Float64Array): number => {
  let sum = 0;
  for (let i = 0; i < loop.length; i += 2) {
    const j = (i + 2) % loop.length;
    sum += loop[i] * loop[j + 1] - loop[j] * loop[i + 1];
  }
  return Math.abs(sum / 2);
};
const regionArea = (state: EngineState, sketch: Id): number => resultOf(state, sketch).regions.reduce((sum, region) => sum + region.loops.reduce((part, loop, i) => part + (i === 0 ? 1 : -1) * loopArea(loop), 0), 0);
const placed = (curves: Record<Id, ImportedCurve>, anchor: 'origin' | 'center' = 'origin'): EngineState => run(newEngine(), addSketch('s', XY), addOutline('s', 'o', { curves, anchor }));
const polar = (c: Vec2, r: number, deg: number): Vec2 => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
const round = (v: number, digits: number): number => Number(v.toFixed(digits));

describe('the engine’s own files read back (D72)', () => {
  it('the section of the board as DXF: four lines, eight arcs and four circles, nothing welded; extruded, the volume of the board', () => {
    const engine = newEngine();
    standInBoard(engine);
    const exported = engine.export('dxf', { plane: XY, offset: 0.8, bodies: ['pcb'] });
    if (!exported.ok) throw new Error(exported.error.message);
    const file = exported.result.files[0];
    const { curves, report } = read('dxf', file.bytes);
    expect(report.byKind).toEqual({ line: 4, arc: 8, circle: 4, spline: 0 });
    expect([report.welded, report.open]).toEqual([0, 0]);
    const state = run(engine, addSketch('again', XY), addOutline('again', 'o', { curves }));
    expect(resultOf(state, 'again').valid).toBe(true);
    const outer = resultOf(state, 'again').regions.find((region) => region.ref.outerLoop.length > 1);
    expect(outer?.loops).toHaveLength(5);
    const after = run(engine, addExtrude('copy', 'again', [outer?.ref.outerLoop ?? []], 1.6));
    expect(volume(after.evaluation.bodies.copy.solid)).toBeCloseTo(volume(after.evaluation.bodies.pcb.solid), 6);
  });
});

describe('a board as a PCB tool writes it (D72)', () => {
  it('placed by the centre of its box on the origin: the holes symmetric about the axes, extruded to the board', () => {
    const { curves, report } = read('dxf', boardDxf(60), { layers: ['Edge.Cuts'] });
    expect(report.curves).toBe(12);
    let state = placed(curves, 'center');
    expect(resultOf(state, 's').points['o/c1/center'].x).toBeCloseTo(-26.5, 9);
    expect(resultOf(state, 's').points['o/c3/center'].y).toBeCloseTo(16.5, 9);
    expect(resultOf(state, 's').degreesOfFreedom).toBe(0);
    const engine = newEngine();
    state = run(engine, addSketch('s', XY), addOutline('s', 'o', { curves, anchor: 'center' }), addExtrude('pcb', 's', [IMPORTED_OUTLINE('o')], 1.6));
    expect(status(state).pcb).toBe('ok');
    expect(Math.abs(volume(state.evaluation.bodies.pcb.solid) - pcbByHand(60))).toBeLessThan(0.3);
  });

  it('a file of two decimals with a weld of 0.001: the report and the sketch say the same gaps', () => {
    const { curves, report } = read('dxf', boardDxf(60, 40, 3, 2, 17), { layers: ['Edge.Cuts'], weld: 0.001 });
    const state = placed(curves);
    expect(report.open).toBe(16);
    const open = resultOf(state, 's').openEnds;
    expect(open?.count).toBe(16);
    expect(open?.ends[0].reason).toBe('apart');
    expect(open?.ends[0].distance).toBeCloseTo(report.gaps[0].distance, 9);
  });

  it('a file of four and three decimals turned by 17°: one valid region, the area of the board', () => {
    for (const digits of [4, 3]) {
      const { curves } = read('dxf', boardDxf(60, 40, 3, digits, 17), { layers: ['Edge.Cuts'] });
      const state = placed(curves);
      expect(resultOf(state, 's').valid).toBe(true);
      expect(resultOf(state, 's').openEnds).toBeUndefined();
      expect(regionArea(state, 's')).toBeCloseTo(2400 - (4 - Math.PI) * 9, 0);
    }
  });
});

describe('rings far from the origin of their file, welded and placed (D72)', () => {
  it('a ring of four arcs written with three decimals, neighbours 0.004 apart: one valid region at 1 m, 300 m, 10 km and 500 km', () => {
    for (const far of [0, 1e3, 3e5, 1e7, 5e8]) {
      for (let k = 0; k < 6; k++) {
        const o: Vec2 = [far + 13.137 * k + 0.3331, far * 0.7 + 7.771 * k + 0.1117];
        const r3 = (v: number): number => round(v, 3);
        const [R, turn] = [4 + 0.37 * k, 9.17 * k];
        const ring = [0, 1, 2, 3].map((i): ImportedCurve => {
          const radius = r3(R + (i % 2 ? 0.004 : 0));
          return { type: 'arc', center: [r3(o[0]), r3(o[1])], start: polar([r3(o[0]), r3(o[1])], radius, r3(turn + 90 * i)), end: polar([r3(o[0]), r3(o[1])], radius, r3(turn + 90 * i + 90)) };
        });
        const text = ['0', 'SECTION', '2', 'ENTITIES', ...ring.flatMap((c) => {
          const a = c as Extract<ImportedCurve, { type: 'arc' }>;
          const r = Math.hypot(a.start[0] - a.center[0], a.start[1] - a.center[1]);
          const deg = (p: Vec2): number => (Math.atan2(p[1] - a.center[1], p[0] - a.center[0]) * 180) / Math.PI;
          return ['0', 'ARC', '8', '0', '10', String(a.center[0]), '20', String(a.center[1]), '40', String(r3(r)), '50', String(r3(deg(a.start))), '51', String(r3(deg(a.end)))];
        }), '0', 'ENDSEC', '0', 'EOF'].join('\n');
        const { curves, report } = read('dxf', text);
        expect([report.open, report.dropped]).toEqual([0, 0]);
        const result = resultOf(placed(curves, 'center'), 's');
        expect([result.valid, result.regions.length, result.openEnds?.count ?? 0]).toEqual([true, 1, 0]);
      }
    }
  });

  it('beyond 1000 km the engine refuses the coordinate itself', () => {
    const curves: Record<Id, ImportedCurve> = { l1: { type: 'line', a: [2e9, 0], b: [2e9 + 1, 0] } };
    expect(newEngine().execute(addSketch('s', XY)).ok).toBe(true);
    const engine = newEngine();
    run(engine, addSketch('s', XY));
    const result = engine.execute(addOutline('s', 'o', { curves }));
    expect(result.ok).toBe(false);
  });
});

describe('an arc pulled towards its chord where it meets another (D72)', () => {
  it('free, the deeper arc gives way; the sketch is one valid region', () => {
    const top: ImportedCurve = { type: 'arc', center: [0, 0], start: polar([0, 0], 500, 89.75), end: polar([0, 0], 500, 90.25) };
    for (const d of [0.004, 0.008, 0.0094]) {
      const t = top as Extract<ImportedCurve, { type: 'arc' }>;
      const joint: Vec2 = [t.end[0], t.end[1] + d];
      const quarter: ImportedCurve = { type: 'arc', center: [joint[0] - 20, joint[1]], start: [joint[0] - 20, joint[1] - 20], end: joint };
      const rest: ImportedCurve[] = [
        { type: 'line', a: t.start, b: [t.start[0], t.start[1] - 20 - d] },
        { type: 'line', a: [t.start[0], t.start[1] - 20 - d], b: [joint[0] - 20, joint[1] - 20] },
      ];
      const lines = (c: ImportedCurve): string[] => {
        if (c.type === 'line') return ['0', 'LINE', '8', '0', '10', String(c.a[0]), '20', String(c.a[1]), '11', String(c.b[0]), '21', String(c.b[1])];
        const a = c as Extract<ImportedCurve, { type: 'arc' }>;
        const deg = (p: Vec2): number => (Math.atan2(p[1] - a.center[1], p[0] - a.center[0]) * 180) / Math.PI;
        return ['0', 'ARC', '8', '0', '10', String(a.center[0]), '20', String(a.center[1]), '40', String(Math.hypot(a.start[0] - a.center[0], a.start[1] - a.center[1])), '50', String(deg(a.start)), '51', String(deg(a.end))];
      };
      const text = ['0', 'SECTION', '2', 'ENTITIES', ...[quarter, top, ...rest].flatMap(lines), '0', 'ENDSEC', '0', 'EOF'].join('\n');
      const { curves } = read('dxf', text);
      const result = resultOf(placed(curves), 's');
      expect([result.valid, result.regions.length]).toEqual([true, 1]);
    }
  });
});

describe('the engine’s own SVG read back (D72)', () => {
  it('the section of the board as SVG: the curves of the DXF at the same places, extruded to the volume of the board', () => {
    const engine = newEngine();
    standInBoard(engine);
    const asSvg = engine.export('svg', { plane: XY, offset: 0.8, bodies: ['pcb'] });
    const asDxf = engine.export('dxf', { plane: XY, offset: 0.8, bodies: ['pcb'] });
    if (!asSvg.ok || !asDxf.ok) throw new Error('export refused');
    const svg = read('svg', asSvg.result.files[0].bytes);
    const dxf = read('dxf', asDxf.result.files[0].bytes);
    expect(svg.report.byKind).toEqual(dxf.report.byKind);
    expect([svg.report.welded, svg.report.open]).toEqual([0, 0]);
    // the drawing of the SVG stands in its own box (a margin, y down): the same outline moved
    const [ds, dd] = [svg.report.bounds, dxf.report.bounds];
    expect(ds.max[0] - ds.min[0]).toBeCloseTo(dd.max[0] - dd.min[0], 6);
    expect(ds.max[1] - ds.min[1]).toBeCloseTo(dd.max[1] - dd.min[1], 6);
    const state = run(engine, addSketch('again', XY), addOutline('again', 'o', { curves: svg.curves, anchor: 'center' }));
    expect(resultOf(state, 'again').valid).toBe(true);
    const outer = resultOf(state, 'again').regions.find((region) => region.ref.outerLoop.length > 1);
    expect(outer?.loops).toHaveLength(5);
    const after = run(engine, addExtrude('copy', 'again', [outer?.ref.outerLoop ?? []], 1.6));
    expect(volume(after.evaluation.bodies.copy.solid)).toBeCloseTo(volume(after.evaluation.bodies.pcb.solid), 6);
  });
});

describe('the queries entryCurves and sketchRegions over an outline (D72)', () => {
  it('the curves of an entry by kind and by page; a spline with its control points', () => {
    const { curves } = read('dxf', boardDxf(60), { layers: ['Edge.Cuts'] });
    const engine = newEngine();
    run(engine, addSketch('s', XY), addOutline('s', 'o', { curves: { ...curves, s1: { type: 'spline', points: [[0, -10], [5, -5], [10, -15], [15, -10]] } } }));
    const ask = (args: Record<string, unknown>) => {
      const answer = engine.query('entryCurves', { sketch: 's', ...args } as never);
      if (!answer.ok) throw new Error(answer.error.message);
      return answer.result;
    };
    expect(ask({ entry: 'o' })).toMatchObject({ status: 'ok', total: 13, from: 0 });
    const circles = ask({ entry: 'o', kind: 'circle' });
    expect(circles.curves.map((curve) => curve.id)).toEqual(['o/c1', 'o/c2', 'o/c3', 'o/c4']);
    expect(circles.curves[0]).toMatchObject({ type: 'circle', radius: 1.6, regions: true });
    expect(ask({ entry: 'o', from: 11, max: 1 }).curves.map((curve) => curve.id)).toEqual(['o/c4']);
    const [spline] = ask({ entry: 'o', kind: 'spline' }).curves;
    expect(spline).toMatchObject({ id: 'o/s1', type: 'spline', closed: false, control: [[0, -10], [5, -5], [10, -15], [15, -10]] });
    expect(ask({ entry: 'nothing' }).status).toBe('noEntry');
    const arc = ask({ entry: 'o', kind: 'arc' }).curves[0] as { sweep: number };
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 9);
  });

  it('the regions by a curve of the outer loop or of a hole, the holes listed, the pages', () => {
    const { curves } = read('dxf', boardDxf(60), { layers: ['Edge.Cuts'] });
    const engine = newEngine();
    run(engine, addSketch('s', XY), addOutline('s', 'o', { curves }));
    const ask = (args: Record<string, unknown>) => {
      const answer = engine.query('sketchRegions', { sketch: 's', ...args } as never);
      if (!answer.ok) throw new Error(answer.error.message);
      return answer.result;
    };
    const all = ask({});
    expect(all).toMatchObject({ status: 'ok', total: 5, from: 0 });
    const board = all.regions.find((region) => region.holes === 4);
    expect(board?.ref.outerLoop).toHaveLength(8);
    // the loops are polylines within the chord tolerance
    expect(Math.abs((board?.area ?? 0) - (2400 - (4 - Math.PI) * 9 - 4 * Math.PI * 1.6 * 1.6))).toBeLessThan(0.3);
    expect(board?.box.map((v) => Math.round(v))).toEqual([100, 80, 160, 120]);
    // a curve of a hole keeps the board and the disc it bounds
    const byHole = ask({ curve: 'o/c1' });
    expect(byHole.total).toBe(2);
    expect(byHole.regions.map((region) => region.holes).sort()).toEqual([0, 4]);
    expect(ask({ curve: 'o/c1', from: 1 }).regions).toHaveLength(1);
    const listed = ask({ curve: 'o/l1', holes: true });
    expect(listed.total).toBe(1);
    expect(listed.regions[0].holeLoops?.map((loop) => loop.join())).toEqual(expect.arrayContaining(['o/c1', 'o/c2', 'o/c3', 'o/c4']));
    expect(ask({ index: board?.index }).regions[0].ref).toEqual(board?.ref);
    expect(ask({ max: 2 }).regions).toHaveLength(2);
  });
});

// Splines (design of 6h, "Tests the implementation owes", 16). No spline of the owner's model is
// under the budget, so every path that writes one is from knowledge.
import { describe, expect, test } from 'vitest';
import { bsplineBeziers, splinePolyline } from '../../packages/engine/src/index';
import { type V2, engineNow, newEngine } from './common';
import { SketchKit, StudioKit, polygonArea, writeDump } from './kit';
import { SPLINE_BUDGET, distanceToPolyline, planSpline, sampleChain } from './splines';
import { convertStudio } from './studio';

const XY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const clamped = (n: number, p: number, inner: (i: number) => number) => [...Array(p + 1).fill(0), ...Array.from({ length: n - p - 1 }, (_, i) => inner(i + 1)), ...Array(p + 1).fill(n - p)];
const uniform = (n: number, p = 3) => clamped(n, p, (i) => i);
const uneven = (n: number, p = 3) => clamped(n, p, (i) => i + 0.3 * Math.sin(i)); // increasing, not equally spaced
// control points of a bump from (0, 0) to (w, 0), above the X axis
const bump = (n: number, w = 40, h = 25): V2[] => Array.from({ length: n }, (_, i) => [(w * i) / (n - 1), i === 0 || i === n - 1 ? 0 : h * Math.sin((Math.PI * i) / (n - 1))]);

async function convert(s: SketchKit, regions = 0, more?: (studio: StudioKit, faces: string[]) => void) {
  const studio = new StudioKit('S');
  const { faces } = studio.sketch(s, regions);
  more?.(studio, faces);
  const { input, report } = writeDump([studio]);
  await newEngine();
  const result = await convertStudio(input, studio.eid, report);
  const sketch = result.document.features.find((f: any) => f.id === 'Sketch_1');
  return { report, result, sketch, records: report.records, splines: report.tail.Splines ?? [] };
}

describe('which splines and how', () => {
  test('a uniform cubic of six points is one spline over its control points', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const sp = s.spline(bump(6), uniform(6), 3);
    const { sketch, report } = await convert(s);
    expect(sketch.curves[`Sketch_1.${sp.id}`]).toMatchObject({ type: 'spline' });
    expect(sketch.curves[`Sketch_1.${sp.id}`].points).toHaveLength(6);
    expect(report.tail['From knowledge']).toEqual([`a spline under the budget: S, Sketch 1, ${sp.id}`]);
  });

  test('a non-uniform cubic is a chain of Bezier pieces sharing their ends; a quadratic and a degree 1 too', () => {
    const c = bump(7);
    const plan = planSpline({ startParameter: 0, endParameter: 4 }, { geometry: { degree: 3, controlPoints: c.flatMap(([x, y]) => [x / 1000, y / 1000]), knots: uneven(7) } }, [c[0], c[6]]);
    expect(plan.ok && !plan.whole && plan.pieces.length).toBe(4);
    if (!plan.ok) return;
    expect(plan.points).toBe(13);
    for (let k = 1; k < plan.pieces.length; k++) expect(plan.pieces[k][0]).toEqual(plan.pieces[k - 1][3]);
    const q = planSpline({}, { geometry: { degree: 2, controlPoints: c.slice(0, 5).flatMap(([x, y]) => [x / 1000, y / 1000]), knots: uniform(5, 2) } }, [c[0], c[4]]);
    expect(q.ok && [q.whole, q.pieces.length, q.points]).toEqual([false, 3, 7]);
  });

  test('rational, periodic, unclamped, a repeated inner knot, end points that disagree, a part of the range: each listed', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const c = bump(6);
    s.spline(c, uniform(6), 3, { rational: true });
    s.spline(c, uniform(6), 3, { periodic: true });
    s.spline(c, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3);
    s.spline(c, [0, 0, 0, 1, 1, 2, 3, 3, 3, 3], 3);
    s.spline(bump(8), [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2], 3);
    s.spline(c, uniform(6), 3, { ends: [[0, 0], [41, 0]] });
    const { sketch, splines } = await convert(s);
    expect(Object.values(sketch.curves).some((x: any) => x.type === 'spline')).toBe(false);
    expect(splines.map((l) => l.replace(/^.*: not converted \((.*)\)$/, '$1'))).toEqual([
      'rational',
      'periodic',
      'the knots are not clamped',
      'the knots are not clamped',
      'an inner knot repeated 4 times (a break in the curve)',
      'the first and the last control points are not its end points',
    ]);
    // a feature without the IDs of its end points: those of the geometry endpoint are read
    expect(planSpline({ startParameter: 0, endParameter: 1 }, { geometry: { degree: 3, controlPoints: c.slice(0, 4).flatMap(([x, y]) => [x / 1000, y / 1000]), knots: uniform(4) } }, [c[0], c[3]]).ok).toBe(true);
    expect(planSpline({ startParameter: 0.5, endParameter: 3 }, { geometry: { degree: 3, controlPoints: c.flatMap(([x, y]) => [x / 1000, y / 1000]), knots: uniform(6) } }, [c[0], c[5]])).toEqual({ ok: false, why: 'a segment that is not the whole knot range' });
  });

  test('193 control points of a sketch are written, 194 are not: two splines that pass alone and not together', async () => {
    const run = async (first: number) => {
      const s = new SketchKit('Sketch 1', 'F1', XY);
      s.spline(bump(first, 60), uniform(first), 3);
      s.spline(bump(46, 60, -20), uneven(46), 3); // 43 pieces: 130 points
      return convert(s);
    };
    const under = await run(63);
    expect(63 + 130).toBe(SPLINE_BUDGET);
    expect(Object.values(under.sketch.curves).filter((x: any) => x.type === 'spline')).toHaveLength(44);
    const over = await run(64);
    expect(Object.values(over.sketch.curves).filter((x: any) => x.type === 'spline')).toHaveLength(0);
    expect(over.splines).toHaveLength(2);
    expect(over.splines[0]).toMatch(/64 control points to write, 194 in the sketch, over the budget of 193/);
    const alone = new SketchKit('Sketch 1', 'F1', XY);
    alone.spline(bump(64, 60), uniform(64), 3);
    expect(Object.values((await convert(alone)).sketch.curves).filter((x: any) => x.type === 'spline')).toHaveLength(1);
  });

  test('FIX of a chain: every control point fixed once; another constraint on a spline stays lost', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const sp = s.spline(bump(7), uneven(7), 3);
    const l = s.line([0, 0], [40, 0]);
    s.constrain('FIX', { localFirst: sp.id });
    s.constrain('TANGENT', { localFirst: sp.id, localSecond: l.id });
    const { records, sketch } = await convert(s);
    expect(records[0]).toMatchObject({ fate: 'written', detail: 'every control point' });
    expect(records[0].ids).toHaveLength(13);
    expect(new Set(records[0].ids.map((id) => sketch.constraints[id].point)).size).toBe(13);
    expect(records[1]).toMatchObject({ fate: 'lost', cause: 'spline' });
  });
});

describe('a region bounded by a chain', () => {
  // a bump whose middle piece bends hard: the engine's polyline (chord tolerance 0.01 mm) runs more
  // than 1e-3 mm off the curve there, the converter's samples do not
  const control: V2[] = [[0, 0], [5, 30], [15, 40], [25, 40], [35, 30], [40, 0]];
  const knots = uneven(6);
  const pieces = bsplineBeziers(control, knots, 3);
  const samples = sampleChain(pieces);
  const area = polygonArea(samples);
  const mid = (() => { const b = pieces[1]; const t = 0.5; const u = 1 - t; return [u ** 3 * b[0][0] + 3 * u * u * t * b[1][0] + 3 * u * t * t * b[2][0] + t ** 3 * b[3][0], u ** 3 * b[0][1] + 3 * u * u * t * b[1][1] + 3 * u * t * t * b[2][1] + t ** 3 * b[3][1]] as V2; })();

  for (const reversed of [false, true])
    test(`matched ${reversed ? 'with the edge the other way round' : 'along the edge'} and extruded`, async () => {
      const s = new SketchKit('Sketch 1', 'F1', XY);
      s.spline(control, knots, 3);
      s.line([40, 0], [0, 0]);
      const edge = { curve: 'other' as const, a: reversed ? [40, 0, 0] : [0, 0, 0], b: reversed ? [0, 0, 0] : [40, 0, 0], m: [mid[0], mid[1], 0] };
      const { result } = await convert(s, 1, (studio, faces) => {
        studio.extrude('X1', 'Extrude 1', [{ id: faces[0], area, edges: [edge, { curve: 'line', a: [40, 0, 0], b: [0, 0, 0], m: [20, 0, 0] }] }], '5 mm');
      });
      const extrude = result.document.features.find((f: any) => f.id === 'Extrude_1');
      expect(extrude.profile.regions).toHaveLength(1);
      const engine = engineNow();
      engine.load(JSON.stringify(result.document));
      expect(engine.getState().evaluation.features.Extrude_1.status).toBe('ok');
      expect(distanceToPolyline(samples, mid)).toBeLessThan(1e-4);
      expect(distanceToPolyline(splinePolyline(pieces[1], 0.01) as V2[], mid)).toBeGreaterThan(1e-3);
    });

  test('a middle off the chain is not matched', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    s.spline(control, knots, 3);
    s.line([40, 0], [0, 0]);
    const { result } = await convert(s, 1, (studio, faces) => {
      studio.extrude('X1', 'Extrude 1', [{ id: faces[0], area, edges: [{ curve: 'other', a: [0, 0, 0], b: [40, 0, 0], m: [mid[0], mid[1] + 0.01, 0] }, { curve: 'line', a: [40, 0, 0], b: [0, 0, 0], m: [20, 0, 0] }] }], '5 mm');
    });
    expect(result.document.features.find((f: any) => f.id === 'Extrude_1')?.profile?.regions ?? []).toHaveLength(0);
  });
});

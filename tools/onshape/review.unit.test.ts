// Regressions from the reviews of the implementation of 6h (each test names its finding). Fixtures
// only: nothing here comes from a real document.
import { describe, expect, test } from 'vitest';
import { expressionValue } from '../../packages/engine/src/index';
import { sketchChanges } from './check';
import { engineNow, expression, newEngine } from './common';
import { planEntries } from './derived';
import { SketchKit, StudioKit, circleEdge, writeDump } from './kit';
import { encode } from './operands';
import { cutPieces, sketchFrame, toBase } from './sketch';
import { convertStudio } from './studio';

const XY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const XZ = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]; // X along X, Y along Z, the normal −Y
const YZ = [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];

const one = async (s: SketchKit, regions = 0, variables: { name: string; expression: string }[] = []) => {
  const studio = new StudioKit('S');
  studio.sketch(s, regions);
  const { input, report } = writeDump([studio], variables);
  await newEngine();
  const result = await convertStudio(input, studio.eid, report);
  const sketch = result.document.features.find((f: any) => f.id === 'Sketch_1');
  return { report, result, records: report.records, sketch, summary: report.sketches['S/Sketch_1'] };
};
// Two sketches of one studio, the second naming the first; the regions of each.
const two = async (build: (s1: SketchKit, s2: SketchKit, op: string) => void, regions: [number, number] = [0, 0], m2 = XY) => {
  const studio = new StudioKit('S');
  const s1 = new SketchKit('Sketch 1', 'F1');
  const s2 = new SketchKit('Sketch 2', 'F2', m2);
  build(s1, s2, 'F');
  studio.sketch(s1, regions[0]);
  studio.sketch(s2, regions[1]);
  const { input, report } = writeDump([studio]);
  await newEngine();
  const result = await convertStudio(input, studio.eid, report);
  return { report, records: report.records.filter((r) => r.sketch === 'Sketch_2'), doc: result.document, sketch: result.document.features.find((f: any) => f.id === 'Sketch_2') };
};
const ring = (k: number, n = 6, r = 10): [number, number] => [r * Math.cos((2 * k * Math.PI) / n), r * Math.sin((2 * k * Math.PI) / n)];

describe('patterns and mirrors (review C1, C2, C3, C6, A2)', () => {
  test('C1: a pattern about a projected pivot is no entry: its images are own curves, the pattern lost, the regions Onshape\'s', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const holes = Array.from({ length: 6 }, (_, k) => s.circle(ring(k), 1.5));
    s.pattern('', '6', [holes.map((h) => h.id), holes.map((h) => h.center)], { pivotExternal: encode('Q', 'vertex', 0) });
    const { records, sketch, summary } = await one(s, 6);
    expect(records[0]).toMatchObject({ fate: 'lost', cause: 'pattern' });
    expect(summary.entries[0]).toMatchObject({ entry: false, why: expect.stringMatching(/projected point/) });
    expect(Object.keys(sketch.curves)).toHaveLength(6);
    expect(summary.regions).toBe(6);
  });

  test('A4: a sketch with nothing to cut gets the check after the cut, reported when it fails', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    s.circle([0, 0], 5);
    const { report, summary } = await one(s, 2);
    expect(summary.cut).toMatchObject({ commands: 0, failed: '1 regions, Onshape 2' });
    expect(report.tail.Cuts[0]).toMatch(/nothing to cut, and the sketch does not pass/);
  });

  test('C2: a mirror of two splines is no entry: the sketch is written, the mirror lost', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const axis = s.line([0, -50], [0, 50], { construction: true });
    const knots = [0, 0, 0, 0, 1.3, 2, 3, 3, 3, 3];
    const c: [number, number][] = [[5, 0], [10, 10], [20, 12], [25, 5], [22, -5], [15, -8]];
    const a = s.spline(c, knots, 3);
    const b = s.spline(c.map(([x, y]) => [-x, y] as [number, number]), knots, 3);
    s.constrain('MIRROR', { localFirst: a.id, localSecond: b.id, localMirror: axis.id });
    const { records, sketch, summary } = await one(s);
    expect(sketch).toBeDefined();
    expect(sketch.external ?? {}).toEqual({});
    expect(records[0]).toMatchObject({ fate: 'lost', cause: 'mirror' });
    expect(summary.entries[0].why).toMatch(/not a point, a line, a circle or an arc/);
  });

  test('C3: two patterns by spokes that share a point have spokes of their own, both written', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const o1 = s.point([0, 0]);
    const o2 = s.point([20, 0]);
    const a = s.line([5, 0], [10, 0]);
    const a2 = s.line([-5, 0], [-10, 0]);
    s.pattern(o1, '2', [[a.id, a2.id], [a.start, a2.start], [a.end, a2.end]]);
    const b = s.line([10, 0], [15, 0]);
    const b2 = s.line([30, 0], [25, 0]);
    s.pattern(o2, '2', [[b.id, b2.id], [b.start, b2.start], [b.end, b2.end]]);
    s.constrain('DISTANCE', { localFirst: a2.start, localSecond: b2.start, direction: 'MINIMUM', length: { q: '35 mm' } }); // names both images: no entry
    s.constrain('COINCIDENT', { localFirst: a.end, localSecond: b.start });
    const { records, sketch } = await one(s);
    expect(records.slice(0, 2).map((r) => [r.fate, r.detail])).toEqual([['written', 'by spokes'], ['written', 'by spokes']]);
    const spokes = Object.keys(sketch.curves).filter((c) => c.includes('.spoke'));
    // the shared point (a's end, b's start) has a spoke from each pivot
    expect(spokes.filter((c) => c.endsWith('.l3.end'))).toEqual(['Sketch_1.spoke0.l3.end', 'Sketch_1.spoke1.l3.end']);
    expect(sketch.curves['Sketch_1.spoke0.l3.end'].a).toBe('Sketch_1.p1');
    expect(sketch.curves['Sketch_1.spoke1.l3.end'].a).toBe('Sketch_1.p2');
  });

  test('C6: a mirror about the Front plane in a sketch on the Right plane reflects in the 2D of the base plane', () => {
    // the Onshape sketch: X along the model's Y, Y along Z (the base YZ); Front is seen as origin/y
    const s = new SketchKit('Sketch 1', 'F1', YZ);
    const a = s.line([2, 1], [4, 3]);
    const b = s.line([-2, 1], [-4, 3]);
    s.constrain('MIRROR', { localFirst: a.id, localSecond: b.id, externalMirror: { ext: 'JCC' } });
    const frame = sketchFrame(YZ)!;
    const [plan] = planEntries(s.feature(), s.geometry(), new Set(), { axisOf: (x) => (x === 'JCC' ? 'origin/y' : undefined), pivotKnown: () => false, toBase: (p) => toBase(frame, p) });
    expect(plan.why).toBeUndefined();
    expect(plan.info.get(b.start)).toEqual({ j: 1, seed: a.start });
    expect(plan.info.get(b.end)).toEqual({ j: 1, seed: a.end });
  });

  test('A2: a pattern by spokes about the origin with curve rows is asserted; an entry is listed as asserting nothing', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const lines = [0, 1, 2].map((k) => s.line(ring(k, 3, 5), ring(k, 3, 10)));
    s.pattern('', '3', [lines.map((l) => l.id)], { pivotExternal: 'IB' });
    s.constrain('LENGTH', { localFirst: lines[1].id, length: { q: '5 mm' } }); // names an image: no entry
    const holes = [0, 1, 2, 3].map((k) => s.circle(ring(k, 4, 20), 1));
    s.pattern('', '4', [holes.map((h) => h.id)], { pivotExternal: 'IB' });
    const { report } = await one(s);
    const [p] = report.promises.S.patterns;
    expect(p).toMatchObject({ pivot: 'origin', count: 3, constraint: 'S/Sketch_1#0' });
    expect(p.rows).toHaveLength(2); // the starts and the ends of the three lines
    expect(report.tail['Pattern assertions']).toEqual(['S, Sketch 1: CIRCULAR_PATTERN #2 asserts nothing: an entry: the engine turns its sources, and no image is a point of the sketch']);
  });
});

describe('found operands (review B1, B2, B3, B8, B9)', () => {
  test('B1: a derived sketch held on an edge of a body of its source studio: lost, not found on a body here', async () => {
    const src = new StudioKit('Source', 'e00000000000000000000002');
    const a = new SketchKit('Sketch 1', 'G1');
    a.circle([0, 0], 6);
    const { faces } = src.sketch(a, 1);
    const { op } = src.extrude('GX', 'Extrude 1', [{ id: faces[0], area: Math.PI * 36, edges: [circleEdge([0, 0], 6)] }], '5 mm');
    const b = new SketchKit('Sketch 2', 'G2', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.005, 0, 0, 0, 1]);
    const p = b.point([6, 0]);
    b.circle([6, 0], 1);
    b.constrain('COINCIDENT', { localFirst: p, externalSecond: { ext: encode(op, 'edge', 3) } });
    src.sketch(b, 1);
    const dst = new StudioKit('Dest');
    const d1 = new SketchKit('Own 1', 'H1');
    d1.circle([0, 0], 6);
    const r = dst.sketch(d1, 1);
    dst.extrude('HX', 'Own Extrude', [{ id: r.faces[0], area: Math.PI * 36, edges: [circleEdge([0, 0], 6)] }], '5 mm');
    dst.derive('D1', 'Derived', src, ['G2'], 1);
    const { input, report } = writeDump([dst, src]);
    await newEngine();
    const res = await convertStudio(input, dst.eid, report);
    const rec = report.records.find((x) => x.sketch.startsWith('Derived'))!;
    expect(rec).toMatchObject({ fate: 'lost', cause: 'edge', detail: expect.stringMatching(/a body of another studio/) });
    expect(res.document.features.find((f: any) => f.id.startsWith('Derived')).external ?? {}).toEqual({});
  });

  test('B2: a projection of the source sketch is no candidate: the own point at its place is the answer', async () => {
    const studio = new StudioKit('S');
    const s1 = new SketchKit('Sketch 1', 'F1');
    const s2 = new SketchKit('Sketch 2', 'F2');
    const s3 = new SketchKit('Sketch 3', 'F3');
    s1.circle([0, 0], 5);
    const { op: op1 } = studio.sketch(s1, 1);
    const p = s2.point([0, 0]);
    s2.point([3, 3]);
    s2.constrain('COINCIDENT', { localFirst: p, externalSecond: { ext: encode(op1, 'vertex', 0) } });
    const { op: op2 } = studio.sketch(s2, 0);
    const q = s3.point([0, 0]);
    s3.constrain('COINCIDENT', { localFirst: q, externalSecond: { ext: encode(op2, 'vertex', 0) } });
    studio.sketch(s3, 0);
    const { input, report } = writeDump([studio]);
    await newEngine();
    const result = await convertStudio(input, studio.eid, report);
    const rec = report.records.find((r) => r.sketch === 'Sketch_3')!;
    expect(rec.fate).toBe('written');
    expect(rec.operands[1].candidates).toHaveLength(1);
    expect(Object.values(result.document.features.find((f: any) => f.id === 'Sketch_3').external)).toEqual([{ type: 'sketch', sketch: 'Sketch_2', entity: 'Sketch_2.p1', kind: 'point', regions: false }]);
  });

  test('B3: EQUAL to a circle the cut made arcs of, PARALLEL to a line it made pieces of: the piece that kept the ID', async () => {
    const { records, sketch } = await two((s1, s2, op) => {
      s1.circle([0, 0], 5);
      s1.line([-10, 0], [10, 0]);
      const c = s2.circle([30, 30], 5);
      const l = s2.line([0, 20], [10, 20]);
      s2.constrain('EQUAL', { localFirst: c.id, externalSecond: { ext: encode(op, 'edge', 1) } });
      s2.constrain('PARALLEL', { localFirst: l.id, externalSecond: { ext: encode(op, 'edge', 0) } });
    }, [2, 0]);
    expect(records.map((r) => r.fate)).toEqual(['written', 'written']);
    expect(Object.values(sketch.external).map((x: any) => x.entity)).toEqual(['Sketch_1.c1', 'Sketch_1.l2']);
    expect(records[0].operands[1].note).toMatch(/pieces of one curve the cut made/);
    expect(records[1].operands[1].candidates).toHaveLength(3);
  });

  test('B8: a projection whose constraint is lost on its kind is not written', async () => {
    const { records, sketch } = await two((s1, s2, op) => {
      s1.line([0, 0], [10, 0]);
      const l = s2.line([0, 5], [10, 5]);
      s2.constrain('TANGENT', { localFirst: l.id, externalSecond: { ext: encode(op, 'edge', 0) } });
    });
    expect(records[0]).toMatchObject({ fate: 'lost' });
    expect(records[0].operands[1].resolved).toBe('Sketch_2.ref0');
    expect(sketch.external ?? {}).toEqual({});
  });

  test('B9: an entity of a sketch on another base plane: lost with the cause sketch', async () => {
    const { records } = await two((s1, s2, op) => {
      s1.circle([0, 0], 5);
      const p = s2.point([0, 0]);
      s2.constrain('COINCIDENT', { localFirst: p, externalSecond: { ext: encode(op, 'vertex', 0) } });
    }, [1, 0], XZ);
    expect(records[0]).toMatchObject({ fate: 'lost', cause: 'sketch', detail: expect.stringMatching(/on another base plane/) });
  });

  test('B12: a point beyond the end of a line and on a circle: the circle', async () => {
    const { records, sketch } = await two((s1, s2, op) => {
      s1.line([0, 0], [10, 0]);
      s1.circle([20, 0], 5);
      const p = s2.point([15, 0]);
      s2.constrain('COINCIDENT', { localFirst: p, externalSecond: { ext: encode(op, 'edge', 0) } });
    });
    expect(records[0].fate).toBe('written');
    expect(Object.values(sketch.external)).toEqual([{ type: 'sketch', sketch: 'Sketch_1', entity: 'Sketch_1.c2', kind: 'circle', regions: false }]);
  });
});

describe('kinds and expressions (review B4, B6, B10, A10, B12)', () => {
  test('B4: a digit inside a variable is no number; scientific notation; a variable times a unit', () => {
    const P = [{ name: 'a', expr: '2' }, { name: 'gap_2mm', expr: '4' }, { name: 'H2m', expr: '1' }, { name: 'R1in', expr: '1' }];
    expect(['#gap_2mm', '#H2m', '#R1in', '#a2 * deg', '#a * deg', '#a deg', '1.5e-3 m', '1E2 mm', '#a * 2 in', '2x'].map(expression)).toEqual(['gap_2mm', 'H2m', 'R1in', 'a2 * deg(1)', 'a * deg(1)', 'a * deg(1)', '1.5e-3 * 1000', '1E2', 'a * 2 * 25.4', undefined]);
    expect(expressionValue(expression('1.5e-3 m')!, P as any)).toBeCloseTo(1.5, 12);
    expect(expressionValue(expression('#a * deg')!, P as any)).toBeCloseTo((2 * Math.PI) / 180, 12);
  });

  test('B6: an angle of exactly 180° fits its expression; B10: a diameter whose expression does not convert takes the measured value', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const a = s.line([0, 0], [-10, 0]);
    const b = s.line([0, 0], [10, 0]);
    s.constrain('ANGLE', { localFirst: a.id, localSecond: b.id, angle: { q: '180 deg' } });
    const c = s.circle([30, 0], 2);
    s.constrain('DIAMETER', { localFirst: c.id, length: { q: '4 furlong' } });
    const { records, sketch } = await one(s);
    expect(records[0].extra?.form).toBe('e');
    expect(sketch.constraints[records[0].ids[0]].value).toBeCloseTo(Math.PI, 12);
    expect(records[1].numbers?.[0]).toMatch(/does not convert, the measured 4/);
  });

  test('A10: a mirror of an own point and the origin about an axis holds the point at the origin', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const p = s.point([0, 0]);
    s.constrain('MIRROR', { localFirst: p, externalSecond: { ext: 'IB' }, externalMirror: { ext: 'JEC' } });
    const { records, sketch } = await one(s);
    expect(records[0].fate).toBe('written');
    expect(sketch.constraints[records[0].ids[0]]).toMatchObject({ type: 'coincident', a: 'Sketch_1.p1', b: 'origin' });
  });

  test('B12: VERTICAL of a point and the origin; a horizontal distance on XZ', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const p = s.point([0, 4]);
    s.constrain('VERTICAL', { localFirst: p, externalSecond: { ext: 'IB' } });
    const { records, sketch } = await one(s);
    expect(sketch.constraints[records[0].ids[0]]).toMatchObject({ type: 'pointOnCurve', point: 'Sketch_1.p1', curve: 'origin/y' });
    const t = new SketchKit('Sketch 1', 'F1', XZ);
    const a = t.point([1, 2]);
    const b = t.point([4, 7]);
    t.constrain('DISTANCE', { localFirst: b, localSecond: a, direction: 'HORIZONTAL', length: { q: '3 mm' } });
    t.constrain('DISTANCE', { localFirst: a, localSecond: b, direction: 'VERTICAL', length: { q: '5 mm' } });
    const xz = await one(t);
    expect(xz.records.map((r) => xz.sketch.constraints[r.ids[0]])).toEqual([
      { type: 'horizontalDistance', a: 'Sketch_1.p1', b: 'Sketch_1.p2', value: 3, driving: true },
      { type: 'verticalDistance', a: 'Sketch_1.p1', b: 'Sketch_1.p2', value: 5, driving: true },
    ]);
  });
});

describe('the check (review A1, A5, C5)', () => {
  test('A1: a piece of a cut circle off its radius, a new point off its place: problems of the cut', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    s.circle([0, 0], 5);
    s.line([-10, 0], [10, 0]);
    const { result } = await one(s, 2);
    const engine = engineNow();
    engine.load(JSON.stringify(result.document));
    const sk: any = result.document.features.find((f: any) => f.id === 'Sketch_1');
    const pts = new Map<string, [number, number]>(Object.entries(engine.getState().evaluation.features.Sketch_1.sketch!.points).map(([k, q]) => [k, [q.x, q.y]]));
    const arcs = Object.keys(sk.curves).filter((c) => sk.curves[c].type === 'arc');
    const lines = Object.keys(sk.curves).filter((c) => sk.curves[c].type === 'line');
    const before = [{ id: 'Sketch_1.c1', src: 'c1', construction: false, circle: { c: 'Sketch_1.c1.center', r: 5 } }, { id: 'Sketch_1.l2', src: 'l2', construction: false, line: ['Sketch_1.l2.start', 'Sketch_1.l2.end'] as [string, string] }];
    const done = { ids: { changed: ['Sketch_1.c1', 'Sketch_1.l2'], added: [...arcs, ...lines].filter((c) => c.includes('.cut.')) }, commands: [] };
    const good = cutPieces(engine, 'Sketch_1', before, { points: pts, radii: new Map() }, done);
    expect(good.problems).toEqual([]);
    expect([...good.of.values()].sort()).toEqual(['Sketch_1.c1', 'Sketch_1.c1', 'Sketch_1.l2', 'Sketch_1.l2', 'Sketch_1.l2']);
    const bad = cutPieces(engine, 'Sketch_1', [{ ...before[0], circle: { c: 'Sketch_1.c1.center', r: 5.5 } }, before[1]], { points: pts, radii: new Map() }, { ...done, commands: [{ type: 'addPoint', sketch: 'Sketch_1', id: 'Sketch_1.l2.start', x: 1, y: 1 } as any] });
    expect(bad.problems.filter((x) => /off the radius of Sketch_1.c1/.test(x))).toHaveLength(2);
    expect(bad.problems.some((x) => /the point Sketch_1.l2.start of the cut moved/.test(x))).toBe(true);
  });

  test('A5: the sketch\'s probe leaves out a second step outside the range; a count read by an entry steps by one', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const a = s.line([0, 0], [10, 0]);
    const b = s.line([0, 0], [-10 * Math.cos(Math.PI / 18), 10 * Math.sin(Math.PI / 18)]); // 170°
    s.constrain('ANGLE', { localFirst: a.id, localSecond: b.id, angle: { q: '170 deg' } });
    const o = s.point([30, 0]);
    const holes = [0, 1, 2, 3].map((k) => s.circle([30 + ring(k, 4, 5)[0], ring(k, 4, 5)[1]], 1));
    s.pattern(o, '#N', [holes.map((h) => h.id), holes.map((h) => h.center)]);
    const { result } = await one(s, 0, [{ name: 'N', expression: '4' }]);
    const engine = engineNow();
    engine.load(JSON.stringify(result.document));
    const changes = sketchChanges(engine, 'Sketch_1', new Set());
    const angle = changes.filter((c) => c.label.startsWith('dimension'));
    expect(angle.map((c) => c.steps.length)).toEqual([1, 2]); // up: 175.1° and 180.2° (out of range); down: two
    const n = changes.find((c) => c.label === 'parameter N up')!;
    expect(n.steps.map((x: any) => x.expr)).toEqual(['5', '6']);
  });

  test('C5: a sketch built again after a dropped entry reports its sections once', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const o = s.point([0, 0]);
    const a = s.circle([10, 0], 1);
    const b = s.circle([0, 10], 1); // a quarter turn, where a count of 6 asks for a sixth: rule 5
    s.pattern(o, '6', [[a.id, b.id], [a.center, b.center]]);
    s.line([20, 0], [30, 0]);
    s.line([20, 0], [30, 0]); // an exact duplicate: a line of the section Duplicates
    const { report } = await one(s);
    expect(report.lines.join('\n')).toMatch(/rule 5/);
    expect(report.tail.Duplicates).toHaveLength(1);
  });
});

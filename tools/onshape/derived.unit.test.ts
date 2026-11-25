// Mirrors and patterns (design of 6h, "Tests the implementation owes", 12, 13 and 17): the rule of
// the entry, the entries, `symmetric`, spokes, a region over copies. Fixtures only.
import { describe, expect, test } from 'vitest';
import { engineNow, newEngine } from './common';
import { SketchKit, StudioKit, circleEdge, writeDump } from './kit';
import { Assertions, countChanges, runChange, snapshot } from './probe';
import { convertStudio } from './studio';

const XY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const convert = async (s: SketchKit, regions = 0, variables: { name: string; expression: string }[] = [], more?: (studio: StudioKit, faces: string[]) => void) => {
  const studio = new StudioKit('S');
  const { faces } = studio.sketch(s, regions);
  more?.(studio, faces);
  const { input, report } = writeDump([studio], variables);
  await newEngine();
  const result = await convertStudio(input, studio.eid, report);
  const sketch = result.document.features.find((f: any) => f.id === 'Sketch_1');
  return { report, result, records: report.records, sketch, summary: report.sketches['S/Sketch_1'] };
};

describe('mirrors', () => {
  test('an image that nothing names: an entry; a mirrored line with the MIRRORs of its ends: an entry, the MIRRORs shared by the copies', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const axis = s.line([0, -10], [0, 10], { construction: true });
    const a = s.circle([5, 0], 2);
    const b = s.circle([-5, 0], 2);
    const l = s.line([3, 5], [8, 8]);
    const m = s.line([-3, 5], [-8, 8]);
    s.constrain('MIRROR', { localFirst: a.id, localSecond: b.id, localMirror: axis.id });
    s.constrain('MIRROR', { localFirst: l.id, localSecond: m.id, localMirror: axis.id });
    s.constrain('MIRROR', { localFirst: l.start, localSecond: m.start, localMirror: axis.id });
    s.constrain('MIRROR', { localFirst: l.end, localSecond: m.end, localMirror: axis.id });
    const { records, sketch, summary } = await convert(s);
    expect(records.map((r) => [r.fate, r.detail])).toEqual([['entry', 'mirror'], ['entry', 'mirror'], ['shared', 'by copies'], ['shared', 'by copies']]);
    expect(Object.values(sketch.external).map((x: any) => x.sources)).toEqual([['Sketch_1.c2'], ['Sketch_1.l4']]);
    expect(summary.entries.filter((e) => e.entry)).toHaveLength(2);
    expect(sketch.curves['Sketch_1.c3']).toBeUndefined();
  });

  test('the first curve named and the second not: the second is the copy; the second named: the first is', async () => {
    const make = (named: 'first' | 'second') => {
      const s = new SketchKit('Sketch 1', 'F1', XY);
      const axis = s.line([0, -10], [0, 10], { construction: true });
      const a = s.circle([5, 0], 2);
      const b = s.circle([-5, 0], 2);
      s.constrain('MIRROR', { localFirst: a.id, localSecond: b.id, localMirror: axis.id });
      s.constrain('DIAMETER', { localFirst: named === 'first' ? a.id : b.id, length: { q: '4 mm' } });
      return s;
    };
    expect(Object.values((await convert(make('first'))).sketch.external).map((x: any) => x.sources)).toEqual([['Sketch_1.c2']]);
    expect(Object.values((await convert(make('second'))).sketch.external).map((x: any) => x.sources)).toEqual([['Sketch_1.c3']]);
  });

  test('both curves crossed by a line outside: by symmetric, the profile valid after the cut; a curve that is the image of one mirror and the seed of another: the seed of both entries', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const axis = s.line([0, -10], [0, 10], { construction: true });
    const a = s.circle([5, 0], 2);
    const b = s.circle([-5, 0], 2);
    s.line([-8, 0], [8, 0]); // crosses both: neither can be the copy
    s.constrain('MIRROR', { localFirst: a.id, localSecond: b.id, localMirror: axis.id });
    const axis2 = s.line([-10, -10], [10, -10], { construction: true });
    const c = s.circle([5, -5], 1);
    const d = s.circle([5, -15], 1);
    const e = s.circle([-5, -15], 1);
    s.constrain('MIRROR', { localFirst: c.id, localSecond: d.id, localMirror: axis2.id });
    s.constrain('MIRROR', { localFirst: d.id, localSecond: e.id, localMirror: axis.id });
    const { records, summary, sketch } = await convert(s, 7); // the regions Onshape has after its own cut
    expect(records[0]).toMatchObject({ fate: 'written', detail: 'by symmetric' });
    expect(sketch.constraints[records[0].ids[0]]).toMatchObject({ type: 'symmetric' });
    // d is the image of the one and the seed of the other: turned round, d is the seed of both
    expect(records.slice(1).map((r) => r.fate)).toEqual(['entry', 'entry']);
    expect(Object.values(sketch.external).map((x: any) => x.sources)).toEqual([[`Sketch_1.${d.id}`], [`Sketch_1.${d.id}`]]);
    void c; void e;
    expect(summary.valid).toBe(true);
  });

  test('two mirrored arcs by three symmetric; a parameter under them is followed', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const axis = s.line([0, -10], [0, 10], { construction: true });
    const a = s.arc([5, 0], 2, -Math.PI / 2, Math.PI / 2);
    const b = s.arc([-5, 0], 2, Math.PI / 2, (3 * Math.PI) / 2);
    s.constrain('MIRROR', { localFirst: a.id, localSecond: b.id, localMirror: axis.id });
    s.constrain('RADIUS', { localFirst: a.id, length: { q: '#R' } });
    s.constrain('TANGENT', { localFirst: a.id, localSecond: b.id }); // names the image: no entry
    const { records, result } = await convert(s, 0, [{ name: 'R', expression: '2 mm' }]);
    expect(records[0].ids).toHaveLength(3);
    const engine = engineNow();
    expect(engine.load(JSON.stringify(result.document)).ok).toBe(true);
    expect(engine.execute({ type: 'setParameter', name: 'R', expr: '2.1' }).ok).toBe(true);
    expect(engine.getState().evaluation.features.Sketch_1.status).toBe('ok');
  });
});

// A hexagon of one side about a point at the origin: the seed line and five instances, the ring
// closed by coincidences of two instances; the across-flats a distance of two lines.
function hexagon(count = 6, close = true) {
  const s = new SketchKit('Sketch 1', 'F1', XY);
  const o = s.point([0, 0]);
  s.constrain('COINCIDENT', { localFirst: o, externalSecond: { ext: 'IB' } });
  const v = (k: number): [number, number] => [5 * Math.cos((k * 2 * Math.PI) / count), 5 * Math.sin((k * 2 * Math.PI) / count)];
  const sides = Array.from({ length: count }, (_, k) => s.line(v(k), v(k + 1), { id: k ? `side${k}` : 'seed' }));
  const rows = [sides.map((x) => x.id), sides.map((x) => x.start), sides.map((x) => x.end)];
  s.pattern(o, String(count), rows);
  if (close) sides.forEach((x, k) => s.constrain('COINCIDENT', { localFirst: x.end, localSecond: sides[(k + 1) % count].start }));
  return { s, sides, o };
}

describe('patterns', () => {
  test('a hexagon of one side: spokes, a tree of angles; it follows its across-flats dimension and its opposite sides stay parallel', async () => {
    const { s, sides } = hexagon();
    s.constrain('DISTANCE', { localFirst: sides[0].id, localSecond: sides[3].id, direction: 'MINIMUM', length: { q: `${5 * Math.sqrt(3)} mm` } });
    const { records, sketch, result, report } = await convert(s);
    const pattern = records.find((r) => r.type === 'CIRCULAR_PATTERN')!;
    expect(pattern).toMatchObject({ fate: 'written', detail: 'by spokes' });
    const types = pattern.ids.map((id) => sketch.constraints[id].type);
    expect(types.filter((t) => t === 'angle')).toHaveLength(5); // a tree over six spokes: the sixth angle would close a ring
    expect(Object.keys(sketch.curves).filter((c) => /\.spoke\d+\./.test(c))).toHaveLength(6);
    expect(sketch.constraints[pattern.ids.find((id) => sketch.constraints[id].type === 'angle')!].value).toBeCloseTo(Math.PI / 3, 12);
    const engine = engineNow();
    engine.load(JSON.stringify(result.document));
    const base = snapshot(engine);
    const asserts = new Assertions(engine, report.promises.S, base);
    const dim = records.find((r) => r.what === 'DISTANCE of two lines')!.ids[0];
    expect(engine.execute({ type: 'setConstraintValue', sketch: 'Sketch_1', id: dim, value: 9 }).ok).toBe(true);
    expect(engine.getState().evaluation.features.Sketch_1.status).toBe('ok');
    expect(asserts.check(snapshot(engine))).toEqual([]);
  });

  test('a ring closed only by coincidences of two instances is no entry; a pattern of two instances turns by pi', async () => {
    const { s } = hexagon();
    const { summary } = await convert(s);
    expect(summary.entries[0]).toMatchObject({ entry: false, why: 'an image is named by COINCIDENT' });
    const two = new SketchKit('Sketch 1', 'F1', XY);
    const o = two.point([0, 0]);
    const a = two.line([1, 1], [4, 1]);
    const b = two.line([-1, -1], [-4, -1]);
    two.pattern(o, '2', [[a.id, b.id], [a.start, b.start], [a.end, b.end]]);
    two.constrain('DISTANCE', { localFirst: a.start, localSecond: b.start, direction: 'MINIMUM', length: { q: `${Math.hypot(2, 2)} mm` } });
    // the distance names an image: no entry, by spokes
    const r = await convert(two);
    const angle = r.records[0].ids.map((id) => r.sketch.constraints[id]).find((c: any) => c.type === 'angle');
    expect(angle.value).toBeCloseTo(Math.PI, 12);
    expect(r.sketch.expressions[`constraints/${r.records[0].ids.find((id) => r.sketch.constraints[id].type === 'angle')}/value`]).toBe('pi');
  });

  test('holes on a circle with the count a parameter: an entry with the count as its expression; a region of a copy is matched; a count lowered breaks a reference, raised leaves the new copy unnamed', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const o = s.point([0, 0]);
    s.constrain('COINCIDENT', { localFirst: o, externalSecond: { ext: 'IB' } });
    const at = (k: number): [number, number] => [10 * Math.cos((k * Math.PI) / 3), 10 * Math.sin((k * Math.PI) / 3)];
    const holes = Array.from({ length: 6 }, (_, k) => s.circle(at(k), 1.5));
    s.pattern(o, '#N', [holes.map((h) => h.id), holes.map((h) => h.center)]);
    s.constrain('DIAMETER', { localFirst: holes[0].id, length: { q: '3 mm' } });
    const { records, sketch, result, report } = await convert(s, 6, [{ name: 'N', expression: '6' }], (studio, faces) => {
      studio.extrude('X1', 'Extrude 1', faces.map((id, k) => ({ id, area: Math.PI * 2.25, edges: [circleEdge(at(k), 1.5)] })), '2 mm');
    });
    expect(records[1]).toMatchObject({ fate: 'entry' });
    expect(Object.values(sketch.external)[0]).toMatchObject({ type: 'pattern', sources: [`Sketch_1.${holes[0].id}`], transform: { type: 'circular', center: `Sketch_1.${o}`, count: 6 } });
    expect(sketch.expressions['external/Sketch_1.pattern0/transform/count']).toBe('N');
    const extrude = result.document.features.find((f: any) => f.id === 'Extrude_1');
    expect(extrude.profile.regions).toHaveLength(6); // five of them bounded by copies
    const engine = engineNow();
    engine.load(JSON.stringify(result.document));
    const base = snapshot(engine);
    const asserts = new Assertions(engine, report.promises.S, base);
    const [up, down] = countChanges(engine.getState().document.features.find((f: any) => f.id === 'Sketch_1'));
    expect(runChange(engine, base, up, asserts, new Set()).text).toMatch(/the new copy bounds a region that no feature names/);
    expect(runChange(engine, base, down, asserts, new Set()).verdicts).toContain('reference');
  });

  test('an entry whose copies do not land: dropped by rule 5, and the pattern lost', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const o = s.point([0, 0]);
    const a = s.circle([10, 0], 1);
    const b = s.circle([0, 10], 1); // a quarter turn, where a count of 6 asks for a sixth
    s.pattern(o, '6', [[a.id, b.id], [a.center, b.center]]);
    const { records, report } = await convert(s);
    expect(records[0]).toMatchObject({ fate: 'lost', cause: 'pattern' });
    expect(report.lines.join('\n')).toMatch(/rule 5/);
  });

  test('an open and a linear pattern (from knowledge): no entry, lost with the cause pattern', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const o = s.point([0, 0]);
    const a = s.circle([10, 0], 1);
    const b = s.circle([0, 10], 1);
    s.pattern(o, '2', [[a.id, b.id], [a.center, b.center]], { open: true });
    const c = s.circle([20, 0], 1);
    const d = s.circle([30, 0], 1);
    s.constrain('LINEAR_PATTERN', { patternc1: { q: '2' }, 'localInstance0,0': c.id, 'localInstance0,1': d.id, 'localInstance1,0': c.center, 'localInstance1,1': d.center });
    const { records, report } = await convert(s);
    expect(records.map((r) => [r.fate, r.cause])).toEqual([['lost', 'pattern'], ['lost', 'pattern']]);
    expect(report.tail['From knowledge']).toEqual(['an open pattern: S, Sketch 1, #0', 'a linear pattern: S, Sketch 1, #1']);
  });
});

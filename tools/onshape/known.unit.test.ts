// Known operands and kinds (design of 6h, "Tests the implementation owes", 8, 14, 15, and the
// expression): the origin, the default planes, the angle, horizontal of two points, the distance of
// two lines. Fixtures only.
import { describe, expect, test } from 'vitest';
import { expression, newEngine } from './common';
import { knownOperand } from './constraints';
import { SketchKit, StudioKit, writeDump } from './kit';
import { sketchFrame } from './sketch';
import { convertStudio } from './studio';

const XY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// the matrix of a sketch: the columns X, Y, normal and origin, row-major
const matrix = (x: number[], y: number[], n: number[]) => [x[0], y[0], n[0], 0, x[1], y[1], n[1], 0, x[2], y[2], n[2], 0, 0, 0, 0, 1];

const convert = async (s: SketchKit, variables: { name: string; expression: string }[] = []) => {
  const studio = new StudioKit('S');
  studio.sketch(s, 0);
  const { input, report } = writeDump([studio], variables);
  await newEngine();
  const result = await convertStudio(input, studio.eid, report);
  const sketch = result.document.features.find((f: any) => f.type === 'sketch');
  const written = (i: number) => report.records[i].ids.map((id) => sketch.constraints[id]);
  return { report, records: report.records, sketch, written };
};

describe('the origin and the default planes', () => {
  test('a point on the origin, horizontal with it, and a horizontal distance with a parameter', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const a = s.point([0, 0]);
    const b = s.point([5, 0]);
    const c = s.point([-3, 2]);
    s.constrain('COINCIDENT', { localFirst: a, externalSecond: { ext: 'IB' } });
    s.constrain('HORIZONTAL', { localFirst: b, externalSecond: { ext: 'IB' } });
    s.constrain('DISTANCE', { externalFirst: { ext: 'IB' }, localSecond: c, direction: 'HORIZONTAL', length: { q: '#E' } });
    const { records, written } = await convert(s, [{ name: 'E', expression: '3 mm' }]);
    expect(records.map((r) => r.fate)).toEqual(['written', 'written', 'written']);
    expect(written(0)[0]).toMatchObject({ type: 'coincident', b: 'origin' });
    expect(written(1)[0]).toMatchObject({ type: 'pointOnCurve', curve: 'origin/x' });
    // the order that makes the value positive: c is left of the origin
    expect(written(2)[0]).toMatchObject({ type: 'horizontalDistance', a: 'Sketch_1.p3', b: 'origin', value: 3 });
    expect(records[2].operands[0]).toMatchObject({ resolved: 'origin', category: 'origin' });
  });

  test('on XZ with a flipped normal: horizontal is still X, Front is no operand, Right is origin/y', async () => {
    const s = new SketchKit('Sketch 1', 'F1', matrix([-1, 0, 0], [0, 0, 1], [0, 1, 0]));
    const l = s.line([0, 0], [10, 0]);
    s.constrain('HORIZONTAL', { localFirst: l.id });
    s.constrain('ANGLE', { externalFirst: { ext: 'JEC' }, localSecond: l.id, angle: { q: '90 deg' } });
    s.constrain('PARALLEL', { externalFirst: { ext: 'JCC' }, localSecond: l.id });
    const { records, written } = await convert(s);
    expect(written(0)[0]).toMatchObject({ type: 'horizontal' });
    expect(written(1)[0]).toMatchObject({ type: 'angle', a: 'origin/y' });
    expect(records[2]).toMatchObject({ fate: 'lost', cause: 'plane' });
  });

  test('the table of the default planes on the three base planes', () => {
    const frame = (m: number[]) => sketchFrame(m)!;
    const xy = frame(XY);
    const xz = frame(matrix([1, 0, 0], [0, 0, 1], [0, -1, 0]));
    const yz = frame(matrix([0, 1, 0], [0, 0, 1], [1, 0, 0]));
    const id = (f: any, plane: string) => { const r: any = knownOperand(plane, f); return 'lost' in r ? 'none' : r.id; };
    expect(['JCC', 'JDC', 'JEC'].map((p) => id(xy, p))).toEqual(['origin/x', 'none', 'origin/y']);
    expect(['JCC', 'JDC', 'JEC'].map((p) => id(xz, p))).toEqual(['none', 'origin/x', 'origin/y']);
    expect(['JCC', 'JDC', 'JEC'].map((p) => id(yz, p))).toEqual(['origin/y', 'origin/x', 'none']);
    // an offset plane: the same axes
    const off = sketchFrame([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.005, 0, 0, 0, 1])!;
    expect(id(off, 'JCC')).toBe('origin/x');
  });

  test('a mirror of two points about a plane, and the origin on the mirror axis', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const a = s.point([4, 2]);
    const b = s.point([-4, 2]);
    const o = s.point([0, 0]);
    s.constrain('MIRROR', { localFirst: a, localSecond: b, externalMirror: { ext: 'JEC' } });
    s.constrain('COINCIDENT', { localFirst: o, externalSecond: { ext: 'IB' } });
    const { written } = await convert(s);
    expect(written(0)[0]).toMatchObject({ type: 'symmetric', line: 'origin/y' });
  });

  test('a sketch turned in its plane (from knowledge): Onshape horizontal has no counterpart', async () => {
    const [c, sn] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    const s = new SketchKit('Sketch 1', 'F1', matrix([c, sn, 0], [-sn, c, 0], [0, 0, 1]));
    const l = s.line([0, 0], [10, 0]);
    s.constrain('HORIZONTAL', { localFirst: l.id });
    const { records } = await convert(s);
    expect(records[0]).toMatchObject({ fate: 'lost', cause: 'kind', detail: 'the sketch is turned in its plane' });
  });
});

describe('the angle', () => {
  const at = (deg: number): [number, number] => [10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180)];
  const angleOf = async (geometry: number, value: string, variables: { name: string; expression: string }[] = []) => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const a = s.line([0, 0], [10, 0]);
    const b = s.line([0, 0], at(geometry));
    s.constrain('ANGLE', { localFirst: a.id, localSecond: b.id, angle: { q: value }, clockwise: false, aligned: false, flipped: false });
    const { records, written } = await convert(s, variables);
    return { record: records[0], c: written(0)[0] };
  };
  test('the four forms', async () => {
    expect((await angleOf(30, '30 deg')).c.value).toBeCloseTo(Math.PI / 6, 12);
    expect((await angleOf(30, '30 deg')).record.extra?.form).toBe('e');
    expect((await angleOf(-30, '30 deg')).record.extra?.form).toBe('-(e)');
    expect((await angleOf(150, '30 deg')).record.extra?.form).toBe('pi - (e)');
    expect((await angleOf(-150, '30 deg')).record.extra?.form).toBe('(e) - pi');
    const { sketch } = await convert((() => { const s = new SketchKit('Sketch 1', 'F1', XY); const a = s.line([0, 0], [10, 0]); const b = s.line([0, 0], at(-150)); s.constrain('ANGLE', { localFirst: a.id, localSecond: b.id, angle: { q: '#A' } }); return s; })(), [{ name: 'A', expression: '30 deg' }]);
    expect(Object.values(sketch.expressions)).toContain('(A) - pi');
  });
  test('a value that fits none is the measured number, with a note', async () => {
    const { record, c } = await angleOf(30, '40 deg');
    expect(record.extra?.form).toBe('none');
    expect(c.value).toBeCloseTo(Math.PI / 6, 9);
    expect(record.numbers?.[0]).toMatch(/fits no form/);
  });
  test('90° with a parameter is ambiguous: the number, listed; a plain 90° keeps the expression', async () => {
    const amb = await angleOf(90, '#A', [{ name: 'A', expression: '90 deg' }]);
    expect(amb.record.extra?.form).toBe('ambiguous');
    expect(amb.record.numbers?.[0]).toMatch(/ambiguous/);
    const plain = await angleOf(90, '90 deg');
    expect(plain.record.extra?.form).toBe('e');
  });
  test('0° and 180°', async () => {
    expect((await angleOf(0, '0 deg')).record.extra?.form).toBe('e');
    expect((await angleOf(180, '180 deg')).c.value).toBeCloseTo(Math.PI, 9);
  });
  test('a sketch seen from the other side: the angle measured in the converter frame', async () => {
    const s = new SketchKit('Sketch 1', 'F1', matrix([-1, 0, 0], [0, 1, 0], [0, 0, -1]));
    const a = s.line([0, 0], [10, 0]);
    const b = s.line([0, 0], at(30));
    s.constrain('ANGLE', { localFirst: a.id, localSecond: b.id, angle: { q: '30 deg' } });
    const { records } = await convert(s);
    // mirrored by the frame, the angle turns the other way
    expect(records[0].extra?.form).toBe('-(e)');
    expect(records[0].fate).toBe('written');
  });
});

describe('horizontal of two points, the distance of two lines', () => {
  test('horizontal of two points is a vertical distance of zero, which the probes leave alone', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const [a, b] = [s.point([0, 1]), s.point([5, 1])];
    s.constrain('HORIZONTAL', { localFirst: a, localSecond: b });
    const { written, report } = await convert(s);
    expect(written(0)[0]).toMatchObject({ type: 'verticalDistance', value: 0 });
    expect(report.promises.S.notChanged).toEqual([`Sketch_1 ${report.records[0].ids[0]}`]);
  });

  test('parallel through other constraints: one point–line distance; free to turn: `parallel` joins the unit; not parallel: lost', async () => {
    const s = new SketchKit('Sketch 1', 'F1', XY);
    const a = s.line([0, 0], [10, 0]);
    const b = s.line([0, 4], [10, 4]);
    s.constrain('HORIZONTAL', { localFirst: a.id });
    s.constrain('HORIZONTAL', { localFirst: b.id });
    s.constrain('DISTANCE', { localFirst: a.id, localSecond: b.id, direction: 'MINIMUM', length: { q: '4 mm' } });
    const held = await convert(s);
    expect(held.written(2).map((c: any) => c.type)).toEqual(['distancePointLine']);
    expect(held.report.promises.S.pairs).toHaveLength(1);

    const f = new SketchKit('Sketch 1', 'F1', XY);
    const c = f.line([0, 0], [10, 0]);
    const d = f.line([0, 4], [10, 4]);
    f.constrain('DISTANCE', { localFirst: c.id, localSecond: d.id, direction: 'MINIMUM', length: { q: '4 mm' } });
    f.constrain('LENGTH', { localFirst: c.id, direction: 'MINIMUM', length: { q: '10 mm' } });
    const free = await convert(f);
    expect(free.written(0).map((x: any) => x.type)).toEqual(['distancePointLine', 'parallel']);

    const n = new SketchKit('Sketch 1', 'F1', XY);
    const e = n.line([0, 0], [10, 0]);
    const g = n.line([0, 4], [10, 5]);
    n.constrain('DISTANCE', { localFirst: e.id, localSecond: g.id, direction: 'MINIMUM', length: { q: '4 mm' } });
    expect((await convert(n)).records[0]).toMatchObject({ fate: 'lost', cause: 'kind' });
  });
});

describe('expressions', () => {
  test('units as factors', () => {
    expect(expression('45.0*deg')).toBe('deg(45.0)');
    expect(expression('45 deg')).toBe('deg(45)');
    expect(expression('2*mm')).toBe('2');
    expect(expression('#Phi_R / 2 + 1 mm')).toBe('Phi_R / 2 + 1');
    expect(expression('(#a + 5) * deg')).toBe('(a + 5) * deg(1)');
    expect(expression('2 in')).toBe('2 * 25.4');
    expect(expression('3 kg')).toBeUndefined();
    expect(expression('#N')).toBe('N');
  });
});

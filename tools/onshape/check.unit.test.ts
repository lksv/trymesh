// The check, `twice`, the numbering, implied constraints and the welds (design of 6h, "Tests the
// implementation owes", 2, 3, 4 and 7). Fixtures only.
import { describe, expect, test } from 'vitest';
import { judge } from './check';
import { newEngine } from './common';
import { canonicalValue, twiceByMeaning } from './constraints';
import { type ConstraintRecord, tally } from './fates';
import { SketchKit, StudioKit, writeDump } from './kit';
import { weldPoints } from './sketch';
import { convertStudio } from './studio';

const studioOf = async (s: SketchKit, variables: { name: string; expression: string }[] = []) => {
  const studio = new StudioKit('S');
  studio.sketch(s, 1);
  const { input, report } = writeDump([studio], variables);
  await newEngine();
  const result = await convertStudio(input, studio.eid, report);
  return { report, result, records: report.records };
};

describe('what passes', () => {
  test('a solver failure with nothing named does not pass; a radius that changed does not', () => {
    const expected = { points: new Map<string, [number, number]>([['p', [0, 0]]]), radii: new Map([['c', 5]]) };
    const at = (res: any) => ({ state: { evaluation: { features: { s: res } } } });
    expect(judge('s', at({ status: 'warning', warnings: [{ code: 'sketchConflict' }], sketch: { conflicting: [], points: { p: { x: 0, y: 0 } }, radii: { c: 5 } } }), expected)).toMatchObject({ ok: false, conflicting: [] });
    expect(judge('s', at({ status: 'ok', warnings: [], sketch: { conflicting: [], points: { p: { x: 0, y: 0 } }, radii: { c: 6 } } }), expected)).toMatchObject({ ok: false });
    expect(judge('s', at({ status: 'ok', warnings: [], sketch: { conflicting: [], points: { p: { x: 0, y: 5e-7 } }, radii: { c: 5 } } }), expected)).toMatchObject({ ok: true });
  });

  test('a wrong dimension among good ones falls to its number, one that fits no number is refused, the others keep their expressions', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    const a = s.circle([0, 0], 5);
    const b = s.circle([20, 0], 3);
    const c = s.circle([40, 0], 4);
    s.constrain('DIAMETER', { localFirst: a.id, length: { q: '#D' } }); // D = 12: the geometry has 10
    s.constrain('DIAMETER', { localFirst: b.id, length: { q: '#E' } }); // E = 6: right
    s.constrain('EQUAL', { localFirst: b.id, localSecond: c.id }); // radii 3 and 4: no number fits
    const { records, report } = await studioOf(s, [{ name: 'D', expression: '12 mm' }, { name: 'E', expression: '6 mm' }]);
    expect(records.map((r) => [r.fate, r.written ?? r.cause])).toEqual([['written', 'number'], ['written', 'expressions'], ['lost', 'refused']]);
    expect(records[0].numbers?.[0]).toMatch(/`D` as 10/);
    expect(records[2].detail).toBeDefined();
    expect(report.sketches['S/Sketch_1'].ladder).toMatch(/^one by one/);
  });

  test('a coincidence of two points that stand apart is written, not shared, and the check decides', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    const l1 = s.line([0, 0], [10, 0]);
    const l2 = s.line([10, 0.5], [10, 10]);
    s.constrain('COINCIDENT', { localFirst: l1.end, localSecond: l2.start });
    const { records } = await studioOf(s);
    expect(records[0].fate).toBe('lost');
    expect(records[0].cause).toBe('refused');
  });

  test('a point held on a curve it is an end of is shared', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    const l = s.line([0, 0], [10, 0]);
    s.constrain('COINCIDENT', { localFirst: l.end, localSecond: l.id });
    const { records } = await studioOf(s);
    expect(records[0]).toMatchObject({ fate: 'shared', detail: 'an end of the curve' });
  });
});

describe('twice', () => {
  const rec = (key: string, constraint: any): ConstraintRecord => ({ key, studio: 'S', sketch: 's', sketchName: 's', helper: false, index: 0, type: 'X', what: 'X', operands: [], commands: [{ type: 'addConstraint', sketch: 's', id: key, constraint } as any], ids: [] });
  const link = (rs: ConstraintRecord[]) => { for (const r of rs) for (const c of r.commands as any[]) c.record = r; return rs; };
  const params = [{ name: 'E', expr: '1.25' }];

  test('a signed distance and an angle the other way round with the other sign are twice; with the same sign refused', () => {
    for (const type of ['horizontalDistance', 'angle']) {
      const [f1, f2] = type === 'angle' ? ['a', 'b'] : ['a', 'b'];
      const rs = link([rec('r0', { type, [f1]: 'p', [f2]: 'q', value: 0.5, driving: true }), rec('r1', { type, [f1]: 'q', [f2]: 'p', value: -0.5, driving: true }), rec('r2', { type, [f1]: 'q', [f2]: 'p', value: 0.5, driving: true })]);
      twiceByMeaning(rs, params);
      expect(rs.map((r) => r.fate)).toEqual([undefined, 'twice', 'lost']);
      expect(rs[2].cause).toBe('refused');
    }
    // at zero the two are twice
    const z = link([rec('r0', { type: 'verticalDistance', a: 'p', b: 'q', value: 0, driving: true }), rec('r1', { type: 'verticalDistance', a: 'q', b: 'p', value: 0, driving: true })]);
    twiceByMeaning(z, params);
    expect(z[1].fate).toBe('twice');
  });

  test('an angle of π both ways round is twice; an expression is kept over the equal number', () => {
    const rs = link([rec('r0', { type: 'angle', a: 'p', b: 'q', value: Math.PI, driving: true }), rec('r1', { type: 'angle', a: 'q', b: 'p', value: Math.PI, driving: true })]);
    twiceByMeaning(rs, params);
    expect(rs[1].fate).toBe('twice');
    expect(canonicalValue({ type: 'angle', a: 'q', b: 'p', value: Math.PI }, params)).toBe(Math.PI);
    const ex = link([rec('r0', { type: 'distance', a: 'p', b: 'q', value: 1.25, driving: true }), rec('r1', { type: 'distance', a: 'p', b: 'q', value: 'E', driving: true })]);
    twiceByMeaning(ex, params);
    expect(ex[0]).toMatchObject({ fate: 'twice', twiceOf: 'r1' });
    expect(ex[1].fate).toBeUndefined();
    expect(tally(ex).fates.twice).toBe(1);
  });
});

describe('the numbering and implied constraints', () => {
  test('constraints are numbered zero padded in the order written', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    for (let i = 0; i < 12; i++) s.constrain('DIAMETER', { localFirst: s.circle([i * 10, 0], 2 + i / 10).id, length: { q: `${4 + i / 5} mm` } });
    const { result, records } = await studioOf(s);
    const ids = Object.keys(result.document.features.find((f: any) => f.id === 'Sketch_1').constraints);
    expect(ids).toEqual(Array.from({ length: 12 }, (_, i) => `Sketch_1.c${String(i).padStart(3, '0')}`));
    expect(records.map((r) => r.ids[0])).toEqual(ids); // the solver takes them in the order written
    expect([...ids].sort()).toEqual(ids);
  });

  test('a redundant constraint in a sketch that follows every change: nothing removed, listed in the notes', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 6], [0, 6]];
    const ls = pts.map((a, i) => s.line(a, pts[(i + 1) % 4]));
    ls.forEach((l, i) => s.constrain('COINCIDENT', { localFirst: l.end, localSecond: ls[(i + 1) % 4].start }));
    s.constrain('HORIZONTAL', { localFirst: ls[0].id });
    s.constrain('HORIZONTAL', { localFirst: ls[2].id });
    s.constrain('VERTICAL', { localFirst: ls[1].id });
    s.constrain('PARALLEL', { localFirst: ls[0].id, localSecond: ls[2].id }); // implied by the two horizontals
    s.constrain('LENGTH', { localFirst: ls[0].id, direction: 'MINIMUM', length: { q: '10 mm' } });
    const { report, records } = await studioOf(s);
    const probe: any = report.sketches['S/Sketch_1'].probe;
    expect(probe.probed).toBe(true);
    expect(probe.listedByDiagnosis.length).toBeGreaterThan(0);
    expect(probe.breaksBefore).toEqual([]);
    expect(probe.removed).toEqual([]);
    expect(records.every((r) => r.fate !== 'implied')).toBe(true);
    expect(report.tail['Redundant constraints'].join('\n')).toMatch(/the diagnosis lists/);
  });
});

describe('welds', () => {
  test('by distance and in clusters', () => {
    const w = weldPoints([
      { src: 'a', id: 'A', at: [0, 0] },
      { src: 'b', id: 'B', at: [2e-7, 0] },
      { src: 'c', id: 'C', at: [10, 0] },
      { src: 'd', id: 'D', at: [10 + 9.8e-5, 0] },
      // a chain of steps under 1e-6 whose ends are further apart
      { src: 'e', id: 'E', at: [20, 0] },
      { src: 'f', id: 'F', at: [20 + 9e-7, 0] },
      { src: 'g', id: 'G', at: [20 + 1.8e-6, 0] },
    ]);
    expect(w.rep.get('b')).toBe('A');
    expect(w.rep.get('d')).toBe('D');
    expect(w.rep.get('g')).toBe('E');
    expect(w.wide).toHaveLength(1);
  });

  test('a weld without a constraint is recorded by its class', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    const l1 = s.line([0, 0], [10, 0]);
    const l2 = s.line([10, 0], [10, 10]);
    void l1;
    void l2;
    const { report } = await studioOf(s);
    expect(report.sketches['S/Sketch_1'].welds).toMatchObject({ places: 1, tied: 0, untied: { 'two plain entities': 1 } });
    expect(report.tail.Welds[0]).toMatch(/two plain entities/);
  });
});

// Crossing curves by the sketch tool `split`, and exact duplicates (design of 6h, "Tests the
// implementation owes", 6). Fixtures only.
import { describe, expect, test } from 'vitest';
import { newEngine } from './common';
import { SketchKit, StudioKit, writeDump } from './kit';
import { convertStudio } from './studio';

const convert = async (s: SketchKit, regions: number) => {
  const studio = new StudioKit('S');
  studio.sketch(s, regions);
  const { input, report } = writeDump([studio]);
  await newEngine();
  const result = await convertStudio(input, studio.eid, report);
  const sketch = result.document.features.find((f: any) => f.id === 'Sketch_1');
  return { report, records: report.records, sketch, summary: report.sketches['S/Sketch_1'] };
};

describe('crossing curves', () => {
  test('a line through a circle with a diameter and a point held on both: two D-shaped regions, the diameter written, the point shared by the cut', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    const c = s.circle([0, 0], 10);
    const l = s.line([-10, 0], [10, 0]);
    s.constrain('DIAMETER', { localFirst: c.id, length: { q: '20 mm' } });
    s.constrain('COINCIDENT', { localFirst: l.end, localSecond: c.id });
    s.constrain('COINCIDENT', { localFirst: l.start, localSecond: c.id });
    const { records, summary, sketch } = await convert(s, 2);
    expect(summary.regions).toBe(2);
    expect(summary.valid).toBe(true);
    expect(records[0]).toMatchObject({ fate: 'written', written: 'expressions' });
    expect(records[1]).toMatchObject({ fate: 'shared', detail: 'by the cut' });
    expect(records[2]).toMatchObject({ fate: 'shared', detail: 'by the cut' });
    expect(Object.values(sketch.curves).filter((x: any) => x.type === 'arc')).toHaveLength(2);
    expect(summary.cut).toMatchObject({ changed: 1 });
  });

  test('a line that touches a circle is not cut: the tool refuses, and the report says so', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    s.circle([0, 0], 10);
    s.line([-10, 10], [10, 10]);
    const { sketch, summary, report } = await convert(s, 1);
    expect(Object.keys(sketch.curves)).toHaveLength(2);
    expect(summary.cut?.refused).toMatch(/touched at one point/);
    expect(report.tail.Cuts[0]).toMatch(/split refused/);
  });

  test("a crossing beside two partly overlapping lines: the tool's ok is not taken for a valid profile", async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    s.circle([0, 0], 5);
    s.line([-10, 0], [10, 0]);
    s.line([20, 0], [30, 0]);
    s.line([25, 0], [35, 0]); // lies on the one before along a stretch
    const { summary, report } = await convert(s, 2);
    expect(summary.valid).toBe(false);
    expect(summary.ladder).toBe('the cut does not pass');
    expect(report.tail.Cuts.join('\n')).toMatch(/left as written/);
  });

  test('the constraints on a curve that is cut move to its pieces and stay written', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    const c = s.circle([0, 0], 10);
    const l = s.line([-15, 0], [15, 0]);
    s.constrain('DIAMETER', { localFirst: c.id, length: { q: '20 mm' } });
    s.constrain('HORIZONTAL', { localFirst: l.id });
    const { records, summary } = await convert(s, 2);
    expect(summary.valid).toBe(true);
    expect(records.map((r) => r.fate)).toEqual(['written', 'written']);
  });
});

describe('exact duplicates', () => {
  test('two identical circles are one, both IDs usable', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    const a = s.circle([0, 0], 5);
    const b = s.circle([0, 0], 5, { id: 'twin' });
    s.constrain('DIAMETER', { localFirst: b.id, length: { q: '10 mm' } });
    s.constrain('COINCIDENT', { localFirst: a.center, localSecond: b.center });
    const { sketch, records, report } = await convert(s, 1);
    expect(Object.keys(sketch.curves)).toEqual(['Sketch_1.c1']);
    expect(records[0]).toMatchObject({ fate: 'written' });
    expect(Object.values(sketch.constraints)[0]).toMatchObject({ type: 'diameter', curve: 'Sketch_1.c1' });
    expect(report.tail.Duplicates[0]).toMatch(/twin is c1/);
  });

  test('a construction line on an outline line: both kept', async () => {
    const s = new SketchKit('Sketch 1', 'F1');
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    pts.forEach((a, i) => s.line(a, pts[(i + 1) % 4]));
    s.line([0, 0], [10, 0], { construction: true });
    const { sketch, summary } = await convert(s, 1);
    expect(Object.keys(sketch.curves)).toHaveLength(5);
    expect(summary.valid).toBe(true);
  });
});

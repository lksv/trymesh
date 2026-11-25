// Found operands (design of 6h, "Tests the implementation owes", 9, 10 and 11): the decode, an
// entity of another sketch, an edge of a body, derived sketches and the helper copy. Fixtures only;
// the IDs are made up by the encoding read off a dump.
import { describe, expect, test } from 'vitest';
import { newEngine } from './common';
import { SketchKit, StudioKit, circleEdge, writeDump } from './kit';
import { StudioOperations, decode, encode, pickCandidate } from './operands';
import { convertStudio } from './studio';

describe('the decode', () => {
  test('IDs of each kind and of several lengths', () => {
    for (const kind of ['vertex', 'edge', 'face', 'body'] as const)
      for (const index of [0, 3, 17, 200, 5000]) expect(decode(encode('Q', kind, index))).toEqual({ op: 'Q', kind, index });
    expect(decode('IB')).toEqual({ op: 'B', kind: 'vertex', index: 0 });
    expect(decode('JCC')).toEqual({ op: 'C', kind: 'face', index: 0 });
    expect(decode('J')).toBeUndefined();
  });

  test('what an ID is, by the type of the feature that owns its operation', () => {
    const features = [
      { featureId: 'S1', featureType: 'newSketch' },
      { featureId: 'X1', featureType: 'extrude' },
      { featureId: 'X2', featureType: 'chamfer' },
      { featureId: 'P1', featureType: 'cPlane' },
      { featureId: 'M1', featureType: 'mateConnector' },
    ];
    const created = {
      S1: { bodies: [encode('F', 'body', 0)], faces: [encode('G', 'face', 0)] },
      X1: { bodies: [encode('H', 'body', 0)], faces: [encode('H', 'face', 1), encode('K', 'face', 0)] },
      X2: { faces: [encode('H', 'face', 2)] }, // an operation under two solid features
      P1: { faces: [encode('L', 'face', 0)] },
      M1: { faces: [encode('K', 'face', 3)] }, // under a solid and a feature the converter does not know
    };
    const ops = new StudioOperations(features, created);
    expect(ops.selfTestPassed).toBe(true);
    expect(ops.classify(encode('F', 'vertex', 4))).toMatchObject({ what: 'sketch', feature: 'S1' });
    expect(ops.classify(encode('H', 'edge', 2))).toMatchObject({ what: 'solid', features: ['X1', 'X2'] });
    expect(ops.classify(encode('K', 'edge', 0))).toMatchObject({ what: 'unknown' });
    expect(ops.classify(encode('L', 'face', 0))).toMatchObject({ what: 'planeFeature' });
    expect(ops.classify(encode('Z', 'edge', 0))).toMatchObject({ what: 'unknown' }); // no feature lists it: no search
    expect(ops.classify(encode('F', 'face', 0))).toMatchObject({ what: 'unknown' }); // a face where an edge is asked
    // a studio whose `created` contradicts the decode: nothing is resolved by it
    const bad = new StudioOperations(features, { S1: { bodies: [encode('F', 'face', 0)] } });
    expect(bad.selfTestPassed).toBe(false);
    expect(bad.classify(encode('F', 'vertex', 0))).toMatchObject({ what: 'unknown', why: /self-test/ });
    expect(bad.classify('IB')).toMatchObject({ what: 'origin' });
  });
});

// Two sketches of one studio: the second names the first by deterministic IDs.
async function twoSketches(build: (s1: SketchKit, s2: SketchKit, op: string) => void) {
  const studio = new StudioKit('S');
  const s1 = new SketchKit('Sketch 1', 'F1');
  const s2 = new SketchKit('Sketch 2', 'F2');
  // the operation of Sketch 1's bodies is the first: F
  build(s1, s2, 'F');
  studio.sketch(s1, 0);
  studio.sketch(s2, 0);
  const { input, report } = writeDump([studio]);
  await newEngine();
  const result = await convertStudio(input, studio.eid, report);
  return { report, records: report.records.filter((r) => r.sketch === 'Sketch_2'), sketch: result.document.features.find((f: any) => f.id === 'Sketch_2') };
}

describe('an entity of another sketch', () => {
  test('a vertex with a curve through its place is the point; an edge with a point at its place is the curve', async () => {
    const { records, sketch } = await twoSketches((s1, s2, op) => {
      s1.line([0, 0], [10, 0]);
      s1.circle([20, 0], 5);
      const p = s2.point([10, 0]);
      const q = s2.point([25, 0]);
      s2.constrain('COINCIDENT', { localFirst: p, externalSecond: { ext: encode(op, 'vertex', 1) } });
      s2.constrain('COINCIDENT', { localFirst: q, externalSecond: { ext: encode(op, 'edge', 1) } });
    });
    expect(records.map((r) => r.fate)).toEqual(['written', 'written']);
    expect(Object.values(sketch.external)).toEqual([
      { type: 'sketch', sketch: 'Sketch_1', entity: 'Sketch_1.l1.end', kind: 'point', regions: false },
      { type: 'sketch', sketch: 'Sketch_1', entity: 'Sketch_1.c2', kind: 'circle', regions: false },
    ]);
    expect(records[0].operands[1]).toMatchObject({ inferred: true, resolved: 'Sketch_2.ref0' });
  });

  test('a point beyond the end of a line and on a circle: the circle; two distinct entities at one place: lost with the candidates', async () => {
    const { records } = await twoSketches((s1, s2, op) => {
      s1.line([0, 0], [10, 0]);
      s1.circle([20, 0], 5);
      s1.circle([20, 0], 5, { construction: true });
      const p = s2.point([15, 0]);
      const q = s2.point([25, 0]);
      s2.constrain('COINCIDENT', { localFirst: p, externalSecond: { ext: encode(op, 'edge', 0) } });
      s2.constrain('COINCIDENT', { localFirst: q, externalSecond: { ext: encode(op, 'edge', 1) } });
    });
    // (15, 0) lies on the line's extension and on both circles: within an extent the circles win, and they are two
    expect(records[0]).toMatchObject({ fate: 'lost', cause: 'sketch' });
    expect(records[0].operands[1].candidates).toHaveLength(2);
  });

  test('two Onshape points welded into one are one answer; an arc of a circle under EQUAL', async () => {
    const { records } = await twoSketches((s1, s2, op) => {
      const a = s1.line([0, 0], [10, 0]);
      s1.line([10, 0], [10, 10]);
      void a;
      s1.arc([0, 20], 4, 0, Math.PI / 2);
      const p = s2.point([10, 0]);
      const c = s2.circle([30, 30], 4);
      s2.constrain('COINCIDENT', { localFirst: p, externalSecond: { ext: encode(op, 'vertex', 1) } });
      s2.constrain('EQUAL', { localFirst: c.id, externalSecond: { ext: encode(op, 'edge', 2) } });
    });
    expect(records.map((r) => r.fate)).toEqual(['written', 'written']);
    expect(records[1].operands[1].candidates?.[0]).toMatch(/^arc/);
  });
});

describe('an edge of a body', () => {
  test('a point on the rim of an extrusion: one of its two whole rims, the record naming the other; a circle equal to a circular edge', async () => {
    const studio = new StudioKit('S');
    const s1 = new SketchKit('Sketch 1', 'F1');
    s1.circle([0, 0], 6);
    const { faces } = studio.sketch(s1, 1);
    const { op } = studio.extrude('X1', 'Extrude 1', [{ id: faces[0], area: Math.PI * 36, edges: [circleEdge([0, 0], 6)] }], '5 mm');
    const s2 = new SketchKit('Sketch 2', 'F2', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.005, 0, 0, 0, 1]);
    const p = s2.point([6, 0]);
    const c = s2.circle([20, 0], 6);
    s2.constrain('COINCIDENT', { localFirst: p, externalSecond: { ext: encode(op, 'edge', 3) } });
    s2.constrain('EQUAL', { localFirst: c.id, externalSecond: { ext: encode(op, 'edge', 3) } });
    studio.sketch(s2, 0);
    const { input, report } = writeDump([studio]);
    await newEngine();
    const result = await convertStudio(input, studio.eid, report);
    const rs = report.records.filter((r) => r.sketch === 'Sketch_2');
    expect(rs.map((r) => r.fate)).toEqual(['written', 'written']);
    const sk = result.document.features.find((f: any) => f.id === 'Sketch_2');
    expect(Object.values(sk.external)).toHaveLength(1);
    expect(Object.values(sk.external)[0]).toMatchObject({ type: 'edge', body: 'Extrude_1', kind: 'circle', edge: { b: { role: 'startCap' } } });
    expect(rs[0].operands[1].note).toMatch(/the same by construction/);
  });

  test('two rims of a tapered extrusion, two straight edges at one place: not chosen among', () => {
    const rim = (side: string, tapered: boolean, cap: number) => ({ ref: { cap }, kind: 'circle' as const, side, tapered, order: [1, cap] as [number, number], text: '' });
    expect(pickCandidate([rim('s', true, 0), rim('s', true, 1)], 'COINCIDENT').pick).toBeUndefined();
    expect(pickCandidate([rim('s', false, 1), rim('s', false, 0)], 'COINCIDENT').pick?.ref).toEqual({ cap: 0 });
    expect(pickCandidate([rim('s', false, 1), rim('s', false, 0)], 'DISTANCE').pick).toBeUndefined();
    const line = (n: number) => ({ ref: { n }, kind: 'line' as const, text: '' });
    expect(pickCandidate([line(1), line(2)], 'COINCIDENT').pick).toBeUndefined();
  });
});

describe('derived sketches and the helper copy', () => {
  // A source studio with a skeleton sketch and two sketches held on it; a destination that derives
  // the two, not the skeleton.
  function source() {
    const src = new StudioKit('Source', 'e00000000000000000000002');
    const skeleton = new SketchKit('Sketch 1', 'G1');
    skeleton.line([0, 0], [32, 0], { construction: true });
    skeleton.constrain('HORIZONTAL', { localFirst: 'l1' });
    const { op } = src.sketch(skeleton, 0);
    const a = new SketchKit('Sketch 2', 'G2');
    const ca = a.circle([32, 0], 2);
    a.constrain('COINCIDENT', { localFirst: ca.center, externalSecond: { ext: encode(op, 'vertex', 1) } });
    src.sketch(a, 1);
    const b = new SketchKit('Sketch 3', 'G3');
    const cb = b.circle([32, 0], 3);
    b.constrain('COINCIDENT', { localFirst: cb.center, externalSecond: { ext: encode(op, 'vertex', 1) } });
    b.constrain('COINCIDENT', { localFirst: cb.center, externalSecond: { ext: encode(op, 'edge', 0) } });
    src.sketch(b, 1);
    return src;
  }
  const destination = async (helpers: boolean) => {
    const src = source();
    const dst = new StudioKit('Dest');
    dst.derive('D1', 'Derived', src, ['G2', 'G3'], 1);
    const { input, report } = writeDump([dst, src]);
    await newEngine();
    const { settings } = await import('./common');
    const before = settings.helpers;
    settings.helpers = helpers;
    try {
      const result = await convertStudio(input, dst.eid, report);
      return { report, result };
    } finally {
      settings.helpers = before;
    }
  };

  test('two derived sketches that need one helper: one copy, the operands found in it, counted apart', async () => {
    const { report, result } = await destination(true);
    const ids = result.document.features.filter((f: any) => f.type === 'sketch').map((f: any) => f.id);
    expect(ids).toEqual(['Derived_Sketch_1', 'Derived_Sketch_2', 'Derived_Sketch_3']);
    const helper = report.records.filter((r) => r.helper);
    expect(helper.map((r) => r.fate)).toEqual(['written']);
    expect(report.records.filter((r) => !r.helper).map((r) => r.fate)).toEqual(['written', 'written', 'written']);
    expect(report.promises.Dest.helpers).toEqual(['Derived_Sketch_1']);
    expect(report.promises.Dest.derived).toMatchObject({ Derived_Sketch_2: 'Source/G2', Derived_Sketch_3: 'Source/G3' });
    expect(report.sketches['Dest/Derived_Sketch_1'].helper).toBe(true);
  });

  test('without the helper copy the operands are lost with the cause sketch', async () => {
    const { report } = await destination(false);
    const main = report.records.filter((r) => !r.helper);
    expect(main.map((r) => [r.fate, r.cause])).toEqual([['lost', 'sketch'], ['lost', 'sketch'], ['lost', 'sketch']]);
    expect(main[0].detail).toMatch(/not in this document/);
  });
});

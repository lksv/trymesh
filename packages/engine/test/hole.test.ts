// D46 (package 2c of D36) at the document level, without adapters: the hole feature, its shapes and
// extent, its references and patches, its place in the registry; the stack of sections with
// a planar step, built with a kernel whose triangulation is a fan; the query `hardwareHole` where it
// needs no row of a catalog.
import { describe, expect, it } from 'vitest';
import type { Command, Document, ExtrudeFeature, FeaturePatch, HoleFeature, Input, PlaneRef, Solid, SolidKernel } from '../src/types';
import { FEATURE_TYPE_INFO, applyCommand, emptyDocument, emptySketch, featureInput, featureRefs, fieldsOf, validateDocument } from '../src/document';
import { producesTool } from '../src/features/index';
import { type Ring, type Section, buildStack } from '../src/recompute/tool-stack';
import type { Loop, Region } from '../src/sketch';
import { volumeOf } from '../src/solid';
import { createEngine } from '../src/engine';
import { QUERIES } from '../src/query/index';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const extrude = (id: string, extra: Partial<Input<ExtrudeFeature>> = {}): Input<ExtrudeFeature> => ({
  id,
  name: id,
  suppressed: false,
  type: 'extrude',
  profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] },
  extent: { type: 'distance', start: 0, distance: 10 },
  operation: 'new',
  ...extra,
});
const hole = (id: string, extra: Partial<Input<HoleFeature>> = {}): Input<HoleFeature> => ({
  id,
  name: id,
  suppressed: false,
  type: 'hole',
  sketch: 'S1',
  points: ['p'],
  shape: { type: 'plain', diameter: 3 },
  extent: { type: 'throughAll', side: 'backward' },
  targets: ['A'],
  ...extra,
});
const add = (feature: Input<ExtrudeFeature> | Input<HoleFeature>): Command => ({ type: 'addFeature', feature });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const invalid = (doc: Document, command: Command, message: RegExp) => expect(() => applyCommand(doc, command)).toThrow(message);
const feature = (doc: Document, id: string): HoleFeature => doc.features.find((f) => f.id === id) as HoleFeature;
const COUNTERBORE = { type: 'counterbore', diameter: 3.4, headDiameter: 6, headDepth: 3 } as const;

// A sketch S1 with a circle `c`, the points p and q and a projected edge `e` of the body A; the
// parameter `comp`; the body A.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'setParameter', name: 'comp', expr: '0.2' },
    { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
    { type: 'addPoint', sketch: 'S1', id: 'p', x: 10, y: 0 },
    { type: 'addPoint', sketch: 'S1', id: 'q', x: -10, y: 0 },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 20 },
    add(extrude('A')),
    { type: 'addFeature', feature: emptySketch('S2', 'S2', XY) },
    { type: 'addPoint', sketch: 'S2', id: 'r', x: 0, y: 0 },
    { type: 'addExternal', sketch: 'S2', id: 'e', ref: { type: 'edge', body: 'A', edge: { a: { feature: 'A', role: 'endCap' }, b: { feature: 'A', role: 'side', curve: 'c' } }, kind: 'circle' } },
  );
}

describe('the hole feature in the document', () => {
  it('is stored as given; its fields are those of its kind and of the extent; it refers to the sketch, the points and the targets', () => {
    const doc = run(base(), add(hole('H', { shape: { ...COUNTERBORE, headDiameter: '6 + comp' }, extent: { type: 'distance', start: 1, distance: -8 }, label: 'M3 socket head cap screw' })));
    expect(feature(doc, 'H')).toEqual({ ...hole('H'), shape: { ...COUNTERBORE, headDiameter: 6.2 }, extent: { type: 'distance', start: 1, distance: -8 }, label: 'M3 socket head cap screw', expressions: { 'shape/headDiameter': '6 + comp' } });
    expect(fieldsOf(feature(doc, 'H')).map((field) => field.path)).toEqual(['shape/diameter', 'shape/headDiameter', 'shape/headDepth', 'extent/start', 'extent/distance']);
    expect(featureInput(feature(doc, 'H')).shape).toEqual({ ...COUNTERBORE, headDiameter: '6 + comp' });
    expect(featureRefs(feature(doc, 'H'))).toEqual(['S1', 'A']);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    // every kind with its fields; the angle and the rotation are radians
    const kinds = run(
      base(),
      add(hole('K', { shape: { type: 'countersink', diameter: 3.4, headDiameter: 6, angle: 'deg(90)' } })),
      add(hole('N', { shape: { type: 'nutPocket', diameter: 3.4, acrossFlats: 5.5, headDepth: 2.4, rotation: 'deg(30)' } })),
    );
    expect(feature(kinds, 'K').shape).toEqual({ type: 'countersink', diameter: 3.4, headDiameter: 6, angle: Math.PI / 2 });
    expect(fieldsOf(feature(kinds, 'N')).map((field) => field.path)).toEqual(['shape/diameter', 'shape/acrossFlats', 'shape/headDepth', 'shape/rotation']);
    expect(feature(kinds, 'N').shape).toMatchObject({ rotation: expect.closeTo(Math.PI / 6, 15) });
  });

  it('the registry: no body, names faces, a source of a pattern, the fields by kind, what a patch may change', () => {
    expect(FEATURE_TYPE_INFO.hole).toMatchObject({ title: 'Hole', bodies: 'none', updatable: ['sketch', 'points', 'shape', 'extent', 'targets', 'label'] });
    const fields = FEATURE_TYPE_INFO.hole.fields.map((field) => `${field.path}${field.when ? ` (${field.when.equals})` : ''}`);
    expect(fields).toEqual([
      'shape/diameter (plain)',
      'shape/diameter (counterbore)',
      'shape/headDiameter (counterbore)',
      'shape/headDepth (counterbore)',
      'shape/diameter (countersink)',
      'shape/headDiameter (countersink)',
      'shape/angle (countersink)',
      'shape/diameter (nutPocket)',
      'shape/acrossFlats (nutPocket)',
      'shape/headDepth (nutPocket)',
      'shape/rotation (nutPocket)',
      'extent/start (distance)',
      'extent/distance (distance)',
    ]);
    const doc = run(base(), add(hole('H')), { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'features', features: ['H'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } } } });
    expect(producesTool(feature(doc, 'H'))).toBe(true);
    // a hole names faces: a sketch may stand on its seat
    expect(() => run(doc, { type: 'addFeature', feature: emptySketch('S3', 'S3', { kind: 'face', body: 'A', face: { feature: 'H', role: 'holeSeat' } }) })).not.toThrow();
    // a hole creates no body
    invalid(doc, add(hole('H2', { targets: ['H'] })), /feature "H" is not a body/);
  });

  it('the points: at least one, none twice, own points of the sketch or its origin', () => {
    const doc = base();
    expect(feature(run(doc, add(hole('H', { points: ['origin', 'p', 'q'] }))), 'H').points).toEqual(['origin', 'p', 'q']);
    invalid(doc, add(hole('H', { points: [] })), /points: a non-empty list of point IDs/);
    invalid(doc, add(hole('H', { points: ['p', 'p'] })), /points: a point is listed twice/);
    invalid(doc, add(hole('H', { points: ['nope'] })), /the sketch "S1" has no entity "nope"/);
    invalid(doc, add(hole('H', { points: ['c'] })), /"c" is a circle, expected point/);
    invalid(doc, add(hole('H', { sketch: 'S2', points: ['e/center'] })), /"e\/center" is projected geometry; an own point of the sketch "S2" is expected/);
    invalid(doc, add(hole('H', { sketch: 'A' })), /feature "A" is not a sketch/);
  });

  it('the shape: a kind, its fields and no other, positive sizes, an angle between 0 and π', () => {
    const doc = base();
    invalid(doc, add(hole('H', { shape: { type: 'oval', diameter: 3 } as never })), /shape\.type: one of the values plain, counterbore, countersink, nutPocket/);
    invalid(doc, add(hole('H', { shape: { type: 'counterbore', diameter: 3, headDiameter: 6 } as never })), /shape\.headDepth/);
    invalid(doc, add(hole('H', { shape: { type: 'plain', diameter: 3, headDiameter: 6 } as never })), /shape\.headDiameter: a hole of the type plain has no such field/);
    invalid(doc, add(hole('H', { shape: { type: 'plain', diameter: 0 } })), /shape\.diameter/);
    invalid(doc, add(hole('H', { shape: { type: 'countersink', diameter: 3, headDiameter: 6, angle: Math.PI } })), /shape\.angle/);
    invalid(doc, add(hole('H', { shape: { type: 'countersink', diameter: 3, headDiameter: 6, angle: 'deg(180)' } })), /shape\.angle/);
    // relations between the numbers are the recompute's: a head narrower than the bore is a valid command
    expect(feature(run(doc, add(hole('H', { shape: { ...COUNTERBORE, headDiameter: 1 } }))), 'H').shape).toMatchObject({ headDiameter: 1 });
  });

  it('the extent: a distance or through all forward or backward; no taper, no upTo, not to both sides', () => {
    const doc = base();
    expect(feature(run(doc, add(hole('H', { extent: { type: 'throughAll', side: 'forward' } }))), 'H').extent).toEqual({ type: 'throughAll', side: 'forward' });
    invalid(doc, add(hole('H', { extent: { type: 'throughAll', side: 'both' } as never })), /extent\.side: a hole has a mouth/);
    invalid(doc, add(hole('H', { extent: { type: 'distance', start: 0, distance: -5, taper: 0.1 } as never })), /extent\.taper: a hole has no taper/);
    invalid(doc, add(hole('H', { extent: { type: 'upTo', plane: XY, start: 0 } as never })), /extent\.type: this feature has no extent upTo/);
    invalid(doc, add(hole('H', { extent: { type: 'distance', start: 0, distance: 0 } })), /extent\.distance/);
    const withHole = run(doc, add(hole('H', { extent: { type: 'distance', start: 0, distance: -5 } })));
    invalid(withHole, { type: 'setField', feature: 'H', path: 'extent/taper', value: 0.1 }, /"extent\/taper" is not a numeric field of feature "H"/);
  });

  it('the targets: one or more bodies, none twice; the label: a text, not empty, at most 200 characters', () => {
    const doc = base();
    invalid(doc, add(hole('H', { targets: [] })), /targets: a hole needs at least one target body/);
    invalid(doc, add(hole('H', { targets: ['A', 'A'] })), /targets: a target body is listed twice/);
    invalid(doc, add(hole('H', { targets: ['nope'] })), /feature "nope" does not exist/);
    invalid(doc, add(hole('H', { label: '' })), /label: the label is not empty/);
    invalid(doc, add(hole('H', { label: '  ' })), /label: the label is not empty/);
    invalid(doc, add(hole('H', { label: 'x'.repeat(201) })), /label: at most 200 characters/);
    invalid(doc, add(hole('H', { label: 3 as never })), /label: a string is expected/);
    expect(feature(run(doc, add(hole('H', { label: 'x'.repeat(200) }))), 'H').label).toHaveLength(200);
  });

  it('updateFeature: every field; a shape of the same kind merges, another kind replaces it with its expressions; null removes the label', () => {
    const doc = run(base(), add(hole('H', { shape: { ...COUNTERBORE, headDiameter: '6 + comp' }, label: 'a' })));
    const merged = run(doc, update('H', { shape: { headDepth: 4 } }));
    expect(feature(merged, 'H').shape).toEqual({ ...COUNTERBORE, headDiameter: 6.2, headDepth: 4 });
    expect(feature(merged, 'H').expressions).toEqual({ 'shape/headDiameter': '6 + comp' });
    const replaced = run(doc, update('H', { shape: { type: 'plain', diameter: 3 } }));
    expect(feature(replaced, 'H').shape).toEqual({ type: 'plain', diameter: 3 });
    expect(feature(replaced, 'H').expressions).toBeUndefined();
    invalid(doc, update('H', { shape: { type: 'countersink', diameter: 3 } as never }), /shape\.headDiameter/);
    expect(feature(run(doc, update('H', { points: ['q', 'p'] })), 'H').points).toEqual(['q', 'p']);
    invalid(doc, update('H', { points: ['p', 'nope'] }), /no entity "nope"/);
    // another sketch: its points are verified there
    expect(feature(run(doc, update('H', { sketch: 'S2', points: ['r'] })), 'H')).toMatchObject({ sketch: 'S2', points: ['r'] });
    invalid(doc, update('H', { sketch: 'S2' }), /the sketch "S2" has no entity "p"/);
    expect(feature(run(doc, update('H', { extent: { type: 'distance', start: 0, distance: -5 } })), 'H').extent).toEqual({ type: 'distance', start: 0, distance: -5 });
    expect(feature(run(doc, update('H', { extent: { side: 'forward' } })), 'H').extent).toEqual({ type: 'throughAll', side: 'forward' });
    expect(feature(run(doc, update('H', { label: 'b' })), 'H').label).toBe('b');
    const unlabelled = run(doc, update('H', { label: null }));
    expect('label' in feature(unlabelled, 'H')).toBe(false);
    // null is accepted also where there is no label: a form sends it whenever its label is empty
    expect(feature(run(unlabelled, update('H', { label: null })), 'H')).toEqual(feature(unlabelled, 'H'));
    invalid(doc, update('H', { shape: { headDepth: null } as never }), /headDepth/);
    invalid(doc, update('H', { operation: 'cut' } as never), /updateFeature\.patch\.operation/);
    expect(feature(run(doc, { type: 'setField', feature: 'H', path: 'shape/headDepth', value: '2 + comp' }), 'H').shape).toMatchObject({ headDepth: 2.2 });
  });
});

// A kernel whose triangulation is a fan from the first point of the outer loop, with the hole
// joined by a bridge: enough for convex rings and an annulus between two concentric polygons.
const fanKernel = (): SolidKernel => ({
  boolean: () => {
    throw new Error('not here');
  },
  intersectionAsComputed: () => {
    throw new Error('not here');
  },
  triangulate(loops) {
    const [outer, inner] = loops.map((loop) => loop.length / 2);
    const out: number[] = [];
    if (inner === undefined) {
      for (let k = 1; k + 1 < outer; k++) out.push(0, k, k + 1);
      return Uint32Array.from(out);
    }
    // an annulus whose two loops have the same count: a quad between the k-th points of each
    // (the inner loop runs clockwise, so its k-th point from the end pairs with the k-th outer one)
    const innerAt = (k: number) => outer + ((inner - (k % inner)) % inner);
    for (let k = 0; k < outer; k++) out.push(k, (k + 1) % outer, innerAt(k + 1), k, innerAt(k + 1), innerAt(k));
    return Uint32Array.from(out);
  },
});
const square = (half: number, key: string): Region => {
  const outer: Loop = { xy: [-half, -half, half, -half, half, half, -half, half], keys: ['a', 'b', 'c', 'd'].map((k) => `${key}${k}`), curves: [key, key, key, key] };
  return { ref: { outerLoop: [key] }, outer, holes: [] };
};
const closed = (solid: Solid): boolean => {
  const edges = new Map<string, number>();
  for (let t = 0; t < solid.triangles.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const [a, b] = [solid.triangles[t + k], solid.triangles[t + ((k + 1) % 3)]];
      edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1);
    }
  return [...edges].every(([edge, count]) => count === 1 && edges.get(edge.split('>').reverse().join('>')) === 1);
};

describe('the stack of sections (D46)', () => {
  const frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] } as const;
  const sideOf = (key: string) => ({ name: { role: 'side', curve: key } as const, info: { planar: true as const, origin: [0, 0, 0] as [number, number, number], y: [0, 0, 1] as [number, number, number], normal: [1, 0, 0] as [number, number, number] } });
  const ring = (w: number, regions: Region[]): Ring => ({ w, regions });
  const [wide, narrow] = [[square(3, 'h')], [square(1, 'b')]];

  it('a step between two outlines: one closed solid, the volume of both prisms, the step as a face of its own', () => {
    for (const down of [false, true]) {
      const s = down ? -1 : 1;
      const sections: Section[] = [
        { rings: [ring(0, wide), ring(2 * s, wide)], sideOf },
        { rings: [ring(2 * s, narrow), ring(5 * s, narrow)], sideOf, step: { role: 'holeSeat' } },
      ];
      const tool = buildStack('H', sections, { ...frame, origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] }, 10, fanKernel());
      expect(closed(tool.solid)).toBe(true);
      expect(volumeOf(tool.solid)).toBeCloseTo(36 * 2 + 4 * 3, 9);
      expect(tool.faces.map((face) => face.name)).toEqual([
        { feature: 'H', role: 'startCap' },
        { feature: 'H', role: 'endCap' },
        { feature: 'H', role: 'holeSeat' },
        { feature: 'H', role: 'side', curve: 'b' },
        { feature: 'H', role: 'side', curve: 'h' },
      ]);
      expect(tool.faces[2].info).toMatchObject({ planar: true, origin: [0, 0, 2 * s] });
      // the step: the annulus between two squares, eight triangles
      expect([...tool.solid.faceIds].filter((id) => id === 12).length).toBe(8);
    }
  });

  it('two sections that meet in one outline share its ring; meeting in another outline without a step is a defect', () => {
    const shared: Section[] = [
      { rings: [ring(0, wide), ring(2, narrow)], sideOf },
      { rings: [ring(2, narrow), ring(5, narrow)], sideOf },
    ];
    const tool = buildStack('H', shared, { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] }, 0, fanKernel());
    expect(closed(tool.solid)).toBe(true);
    expect(tool.solid.positions.length / 3).toBe(12); // three rings of four points
    // a frustum from a square of 6 to a square of 2, 2 high, and a prism of 2 × 2 × 3
    expect(volumeOf(tool.solid)).toBeCloseTo((2 * (36 + 12 + 4)) / 3 + 12, 9);
    expect(() => buildStack('H', [shared[0], { rings: [ring(2, wide), ring(5, wide)], sideOf }], { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] }, 0, fanKernel())).toThrow(/need a step/);
    expect(() => buildStack('H', [shared[0], { rings: [ring(3, wide), ring(5, wide)], sideOf, step: { role: 'holeSeat' } }], { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] }, 0, fanKernel())).toThrow(/one level/);
  });
});

describe('the query hardwareHole without a row', () => {
  const engine = createEngine({ solver: { solve: () => ({ status: 'ok', points: {}, radii: {} }) } as never, kernel: fanKernel() });
  it('a size a catalog does not have names the argument and the catalog; an allowance has to be an expression of a number', () => {
    expect(engine.query('hardwareHole', { use: 'socketHead', size: 'nope' })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['size'], message: expect.stringMatching(/the catalog clearanceHoles has no size "nope"/) } });
    expect(engine.query('hardwareHole', { use: 'heatSetInsert', size: 'nope' })).toMatchObject({ ok: false, error: { code: 'notAvailable', message: expect.stringMatching(/the catalog heatSetInserts has no size "nope"/) } });
    expect(engine.query('hardwareHole', { use: 'clearance', size: 'M3', allowance: '0.2 +' })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['allowance'] } });
    expect(engine.query('hardwareHole', { use: 'clearance', size: 'M3', allowance: 'a < b' })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['allowance'] } });
    expect(Object.keys(QUERIES)).toContain('hardwareHole');
  });
});

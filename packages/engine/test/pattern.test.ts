// D35 point 4 at the document level (no recompute): the pattern feature, derived body IDs and the
// copy tags of face names. The rigid transforms of the copies are tested here as well.
import { describe, expect, it } from 'vitest';
import type { Command, Document, ExtrudeFeature, FaceName, FeaturePatch, Input, PatternFeature, PlaneRef, Solid, Vec3 } from '../src/types';
import { FEATURE_TYPE_INFO, MAX_PATTERN_COUNT, applyCommand, emptyDocument, emptySketch, featureInput, featureRefs, fieldsOf, validateDocument } from '../src/document';
import { rotation, transformFace, transformFrame, transformPoint, transformSolid, volumeOf } from '../src/solid';
import { faceKey } from '../src/util';

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
type Source = PatternFeature['source'];
type Transform = Input<PatternFeature>['transform'];
const Z: Transform['axis'] = { kind: 'base', axis: 'Z' };
const holes: Source = { type: 'features', features: ['H'] };
const pattern = (id: string, source: Source = holes, transform: Partial<Transform> = {}, expressions?: Record<string, string>): Input<PatternFeature> => ({
  id,
  name: id,
  suppressed: false,
  type: 'pattern',
  source,
  transform: { type: 'circular', axis: Z, count: 4, span: { type: 'full' }, ...transform },
  ...(expressions ? { expressions } : {}),
});
const add = (feature: Input<ExtrudeFeature> | Input<PatternFeature>): Command => ({ type: 'addFeature', feature });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const invalid = (doc: Document, command: Command, message: RegExp) => expect(() => applyCommand(doc, command)).toThrow(message);
const feature = (doc: Document, id: string): PatternFeature => doc.features.find((f) => f.id === id) as PatternFeature;

// A sketch with a circle and a point, the parameter `n`, the body A, a cut H and an addition B into it.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'setParameter', name: 'n', expr: '6' },
    { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
    { type: 'addPoint', sketch: 'S1', id: 'p', x: 10, y: 0 },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
    add(extrude('A')),
    add(extrude('H', { operation: 'cut', targets: ['A'] })),
    add(extrude('B', { operation: 'add', targets: ['A'] })),
  );
}

describe('the pattern feature', () => {
  it('repeats features or a body; the catalog describes it', () => {
    const doc = run(base(), add(pattern('P')), add(pattern('Q', { type: 'body', body: 'A' }, { count: 3 })));
    expect(feature(doc, 'P')).toEqual(pattern('P'));
    expect(feature(doc, 'Q')).toEqual(pattern('Q', { type: 'body', body: 'A' }, { count: 3 }));
    expect(featureRefs(feature(doc, 'P'))).toEqual(['H']);
    expect(featureRefs(feature(doc, 'Q'))).toEqual(['A']);
    expect(FEATURE_TYPE_INFO.pattern).toMatchObject({ title: 'Pattern', bodies: 'derived', updatable: ['source', 'transform'] });
    expect(FEATURE_TYPE_INFO.pattern.fields.map((f) => [f.path, f.spec.unit, f.when])).toEqual([
      ['transform/count', 'count', undefined],
      ['transform/span/angle', 'rad', { path: 'transform/span/type', equals: 'angle' }],
    ]);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('the source: extrusions that add or cut, before the pattern, each once; or one body', () => {
    const doc = base();
    expect(feature(run(doc, add(pattern('P', { type: 'features', features: ['B', 'H'] }))), 'P').source).toEqual({ type: 'features', features: ['B', 'H'] }); // the order of the command
    invalid(doc, add(pattern('P', { type: 'features', features: ['A'] })), /feature "A" is not an extrusion with the operation add or cut/);
    invalid(doc, add(pattern('P', { type: 'features', features: ['S1'] })), /feature "S1" is not an extrusion with the operation add or cut/);
    invalid(doc, add(pattern('P', { type: 'features', features: [] })), /source\.features: a non-empty list of feature IDs is expected/);
    invalid(doc, add(pattern('P', { type: 'features', features: 'H' as never })), /source\.features: a non-empty list/);
    invalid(doc, add(pattern('P', { type: 'features', features: ['H', 'H'] })), /a feature is listed twice/);
    invalid(doc, add(pattern('P', { type: 'features', features: ['X'] })), /feature "X" neexistuje/);
    invalid(doc, add(pattern('P', { type: 'body', body: 'H' })), /není těleso/);
    invalid(doc, add(pattern('P', { type: 'body', body: 'A/1' })), /není těleso/);
    invalid(doc, add(pattern('P', { type: 'solid' } as never)), /source\.type: čeká se jedna z hodnot features, body/);
    // the source must lie before the pattern
    invalid(doc, { type: 'addFeature', feature: pattern('P'), index: 2 }, /source\.features/);
    invalid(doc, { type: 'addFeature', feature: pattern('P', { type: 'body', body: 'A' }), index: 1 }, /source\.body/);
    // a pattern of a pattern: its own copy cannot be its source
    invalid(doc, add(pattern('P', { type: 'body', body: 'P/1' })), /neexistuje/);
  });

  it('the count is an integer from 1 with an upper bound; the angle is in radians and not zero', () => {
    const doc = base();
    for (const count of [1, 2, MAX_PATTERN_COUNT]) expect(feature(run(doc, add(pattern('P', holes, { count }))), 'P').transform.count).toBe(count);
    for (const count of [0, -1, MAX_PATTERN_COUNT + 1, 2.5]) invalid(doc, add(pattern('P', holes, { count })), /transform\.count/);
    expect(feature(run(doc, add(pattern('P', holes, { count: 0.3 / 0.1 }))), 'P').transform.count).toBe(3); // within the tolerance of an integer
    const angled = run(doc, add(pattern('P', holes, { count: 3, span: { type: 'angle', angle: Math.PI / 2 } })));
    expect(feature(angled, 'P').transform.span).toEqual({ type: 'angle', angle: Math.PI / 2 });
    expect(feature(run(doc, add(pattern('P', holes, { span: { type: 'angle', angle: -2 * Math.PI } }))), 'P').transform.span).toEqual({ type: 'angle', angle: -2 * Math.PI });
    invalid(doc, add(pattern('P', holes, { span: { type: 'angle', angle: 0 } })), /transform\.span\.angle/);
    invalid(doc, add(pattern('P', holes, { span: { type: 'angle', angle: 90 } })), /transform\.span\.angle/); // degrees by mistake
    invalid(doc, add(pattern('P', holes, { span: { type: 'angle' } as never })), /transform\.span\.angle/);
    invalid(doc, add(pattern('P', holes, { span: { type: 'arc' } as never })), /transform\.span\.type: čeká se jedna z hodnot full, angle/);
    invalid(doc, add(pattern('P', holes, { type: 'linear' as never })), /transform\.type: čeká se jedna z hodnot circular/);
  });

  it('numeric fields: the count always, the angle only with an angle span; both take expressions', () => {
    const doc = run(base(), add(pattern('P', holes, { count: 'n', span: { type: 'angle', angle: 'deg(360) / n' } })));
    expect(feature(doc, 'P')).toMatchObject({ transform: { count: 6, span: { type: 'angle', angle: Math.PI / 3 } }, expressions: { 'transform/count': 'n', 'transform/span/angle': 'deg(360) / n' } });
    expect(fieldsOf(feature(doc, 'P')).map((f) => [f.path, f.value, f.expr])).toEqual([
      ['transform/count', 6, 'n'],
      ['transform/span/angle', Math.PI / 3, 'deg(360) / n'],
    ]);
    expect(featureInput(feature(doc, 'P'))).toEqual(pattern('P', holes, { count: 'n', span: { type: 'angle', angle: 'deg(360) / n' } }));
    const full = run(base(), add(pattern('P')));
    expect(fieldsOf(feature(full, 'P')).map((f) => f.path)).toEqual(['transform/count']);
    expect(feature(run(full, { type: 'setField', feature: 'P', path: 'transform/count', value: 'n + 1' }), 'P')).toMatchObject({ transform: { count: 7 }, expressions: { 'transform/count': 'n + 1' } });
    expect(feature(run(full, { type: 'setField', feature: 'P', path: 'transform/count', value: 2 }), 'P').transform.count).toBe(2);
    invalid(full, { type: 'setField', feature: 'P', path: 'transform/span/angle', value: 1 }, /is not a numeric field/);
    invalid(full, { type: 'setField', feature: 'P', path: 'transform/count', value: 2.5 }, /transform\/count|count/i);
    invalid(base(), add(pattern('P', holes, {}, { 'transform/span/angle': 'n' })), /"transform\/span\/angle" is not a numeric field of this feature/);
  });

  it('the axis: a base axis, or a point of a sketch before the pattern', () => {
    const doc = base();
    for (const axis of ['X', 'Y', 'Z'] as const) expect(feature(run(doc, add(pattern('P', holes, { axis: { kind: 'base', axis } }))), 'P').transform.axis).toEqual({ kind: 'base', axis });
    for (const point of ['p', 'origin']) {
      const through = run(doc, add(pattern('P', holes, { axis: { kind: 'sketchPoint', sketch: 'S1', point } })));
      expect(feature(through, 'P').transform.axis).toEqual({ kind: 'sketchPoint', sketch: 'S1', point });
      expect(featureRefs(feature(through, 'P'))).toEqual(['H', 'S1']);
    }
    invalid(doc, add(pattern('P', holes, { axis: { kind: 'base', axis: 'W' } as never })), /transform\.axis\.axis: čeká se jedna z hodnot X, Y, Z/);
    invalid(doc, add(pattern('P', holes, { axis: { kind: 'edge' } as never })), /transform\.axis\.kind: čeká se jedna z hodnot base, sketchPoint/);
    invalid(doc, add(pattern('P', holes, { axis: { kind: 'sketchPoint', sketch: 'A', point: 'p' } })), /transform\.axis\.sketch/);
    invalid(doc, add(pattern('P', holes, { axis: { kind: 'sketchPoint', sketch: 'S1', point: 'c' } })), /transform\.axis\.point/); // a curve is not a point
    invalid(doc, add(pattern('P', holes, { axis: { kind: 'sketchPoint', sketch: 'S1', point: 'q' } })), /transform\.axis\.point/);
  });

  it('a field of another variant is rejected, not dropped', () => {
    const doc = base();
    invalid(doc, add(pattern('P', { type: 'body', body: 'A', features: ['H'] } as never)), /source\.features: a source of the type body has no such field/);
    invalid(doc, add(pattern('P', { type: 'features', features: ['H'], body: 'A' } as never)), /source\.body: a source of the type features has no such field/);
    invalid(doc, add(pattern('P', holes, { span: { type: 'full', angle: 3 } as never })), /transform\.span\.angle: a span of the type full has no such field/);
    invalid(doc, add(pattern('P', holes, { axis: { kind: 'base', axis: 'Z', sketch: 'S1' } as never })), /transform\.axis\.sketch: an axis of the kind base has no such field/);
    invalid(doc, add(pattern('P', holes, { axis: { kind: 'sketchPoint', sketch: 'S1', point: 'p', axis: 'Z' } as never })), /transform\.axis\.axis: an axis of the kind sketchPoint has no such field/);
    invalid(doc, add(pattern('P', holes, { radius: 3 } as never)), /transform\.radius: a transform of the type circular has no such field/);
    // a key without a value is not a field: a caller in the process may build its objects that way
    expect(feature(run(doc, add(pattern('P', holes, { span: { type: 'full', angle: undefined } as never }))), 'P').transform.span).toEqual({ type: 'full' });
    // a stored document is checked the same way
    const stored = JSON.parse(JSON.stringify(run(doc, add(pattern('P')))));
    stored.features.at(-1).source.body = 'A';
    expect(() => validateDocument(stored)).toThrow(/source\.body: a source of the type features has no such field/);
  });

  it('updateFeature merges the transform, replaces the axis and another variant of the span or the source', () => {
    const doc = run(base(), add(pattern('P', holes, { count: 'n', span: { type: 'angle', angle: 'deg(90)' } })));
    // only the count: the span and its expression stay
    const counted = run(doc, update('P', { transform: { count: 3 } }));
    expect(feature(counted, 'P')).toMatchObject({ transform: { count: 3, span: { type: 'angle', angle: Math.PI / 2 } }, expressions: { 'transform/span/angle': 'deg(90)' } });
    expect(feature(counted, 'P').expressions).not.toHaveProperty('transform/count');
    // the same variant of the span merges, another one replaces it and drops its expression
    expect(feature(run(doc, update('P', { transform: { span: { angle: 1 } } })), 'P').transform.span).toEqual({ type: 'angle', angle: 1 });
    const full = run(doc, update('P', { transform: { span: { type: 'full' } } }));
    expect(feature(full, 'P')).toMatchObject({ transform: { count: 6, span: { type: 'full' } }, expressions: { 'transform/count': 'n' } });
    expect(feature(full, 'P').expressions).not.toHaveProperty('transform/span/angle');
    invalid(full, update('P', { transform: { span: { type: 'angle' } } } as FeaturePatch), /transform\.span\.angle/);
    invalid(full, update('P', { transform: { span: { angle: 1 } } } as FeaturePatch), /angle/);
    // a reference is replaced as a whole
    expect(feature(run(doc, update('P', { transform: { axis: { kind: 'sketchPoint', sketch: 'S1', point: 'p' } } })), 'P').transform.axis).toEqual({ kind: 'sketchPoint', sketch: 'S1', point: 'p' });
    expect(feature(run(doc, update('P', { transform: { axis: { kind: 'sketchPoint', sketch: 'S1', point: 'p' } } }), update('P', { transform: { axis: { kind: 'base', axis: 'X' } } })), 'P').transform.axis).toEqual({ kind: 'base', axis: 'X' });
    invalid(doc, update('P', { transform: { axis: { kind: 'sketchPoint', sketch: 'S1' } } } as FeaturePatch), /transform\.axis\.point/);
    // the source: the list is replaced, another variant replaces the source
    expect(feature(run(doc, update('P', { source: { features: ['H', 'B'] } })), 'P').source).toEqual({ type: 'features', features: ['H', 'B'] });
    expect(feature(run(doc, update('P', { source: { type: 'body', body: 'A' } })), 'P').source).toEqual({ type: 'body', body: 'A' });
    invalid(doc, update('P', { source: { type: 'body' } } as FeaturePatch), /source\.body/);
    invalid(doc, update('P', { source: { body: 'A' } } as FeaturePatch), /body/);
    invalid(doc, update('P', { count: 3 } as FeaturePatch), /count/);
  });

  it('a removed source leaves the pattern in the document; the reference can be fixed', () => {
    const doc = run(base(), add(pattern('P', { type: 'features', features: ['H', 'B'] })), { type: 'removeFeature', id: 'H' });
    expect(feature(doc, 'P').source).toEqual({ type: 'features', features: ['H', 'B'] });
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    // an unrelated change passes, a new reference is verified
    expect(feature(run(doc, update('P', { transform: { count: 2 } })), 'P').transform.count).toBe(2);
    invalid(doc, update('P', { source: { features: ['H', 'B', 'X'] } }), /feature "X" neexistuje/);
    expect(feature(run(doc, update('P', { source: { features: ['B'] } })), 'P').source).toEqual({ type: 'features', features: ['B'] });
  });
});

describe('bodies and faces of copies', () => {
  const copies = (): Document => run(base(), add(pattern('Q', { type: 'body', body: 'A' }, { count: 3 })));
  const top = (copy?: FaceName['copy']): FaceName => ({ feature: 'A', role: 'endCap', ...(copy ? { copy } : {}) });

  it('a copy is a body `<pattern>/<number>`: a target of a cut and the source of another pattern', () => {
    const doc = copies();
    const cut = run(doc, add(extrude('C', { operation: 'cut', targets: ['Q/1', 'A', 'Q/2'] })));
    expect((cut.features.find((f) => f.id === 'C') as ExtrudeFeature).targets).toEqual(['Q/1', 'A', 'Q/2']);
    expect(featureRefs(cut.features.find((f) => f.id === 'C') as ExtrudeFeature)).toEqual(['S1', 'Q', 'A']);
    // whether the copy with that number exists shows in the recompute: the count may be an expression
    expect(() => run(doc, add(extrude('C', { operation: 'cut', targets: ['Q/7'] })))).not.toThrow();
    for (const body of ['Q/0', 'Q/x', 'Q/1/1', 'Q/', 'Q/01', 'Q']) invalid(doc, add(extrude('C', { operation: 'cut', targets: [body] })), /není těleso/);
    // a pattern of features creates no bodies
    invalid(run(base(), add(pattern('P'))), add(extrude('C', { operation: 'cut', targets: ['P/1'] })), /není těleso/);
    const second = run(doc, add(pattern('R', { type: 'body', body: 'Q/2' })));
    expect(featureRefs(feature(second, 'R'))).toEqual(['Q']);
    // the copy must exist before the feature that refers to it
    invalid(doc, { type: 'addFeature', feature: extrude('C', { operation: 'cut', targets: ['Q/1'] }), index: 4 }, /targets/);
  });

  it('a face of a copy names its pattern: the reference is verified and counted as a dependency', () => {
    const doc = copies();
    const tagged = top([{ pattern: 'Q', index: 1 }]);
    const sketch = run(doc, { type: 'addFeature', feature: emptySketch('S2', 'S2', { kind: 'face', body: 'Q/1', face: tagged }) });
    const added = sketch.features.find((f) => f.id === 'S2');
    expect(added).toMatchObject({ plane: { kind: 'face', body: 'Q/1', face: tagged } });
    expect(featureRefs(added!)).toEqual(['Q', 'A']);
    expect(validateDocument(JSON.parse(JSON.stringify(sketch)))).toEqual(sketch);
    const onFace = (face: unknown, index?: number): Command => ({ type: 'addFeature', feature: emptySketch('S2', 'S2', { kind: 'face', body: 'Q/1', face: face as FaceName }), ...(index === undefined ? {} : { index }) });
    // an empty list is the face of the original: one face, one spelling
    expect(run(doc, onFace({ ...top(), copy: [] })).features.find((f) => f.id === 'S2')).toMatchObject({ plane: { face: top() } });
    expect(run(doc, onFace({ ...top(), copy: [] })).features.find((f) => f.id === 'S2')).not.toHaveProperty('plane.face.copy');
    invalid(doc, onFace(top([{ pattern: 'X', index: 1 }])), /feature "X" neexistuje/);
    invalid(doc, onFace(top([{ pattern: 'H', index: 1 }])), /feature "H" není pole \(pattern\)/);
    for (const index of [0, 1.5, -1]) invalid(doc, onFace(top([{ pattern: 'Q', index }])), /copy\[0\]\.index: the number of a copy is an integer from 1/);
    invalid(doc, onFace({ ...top(), copy: 'Q' }), /copy: a list of \{ pattern, index \} is expected/);
    invalid(doc, onFace({ ...top(), copy: [{ index: 1 }] }), /copy\[0\]\.pattern/);
    // the face exists only after the pattern that copied it
    invalid(doc, onFace(tagged, 4), /plane/);
    // a pattern of a pattern: every pattern in the list is a dependency
    const twice = run(doc, add(pattern('R', { type: 'body', body: 'Q/1' })), {
      type: 'addFeature',
      feature: emptySketch('S3', 'S3', { kind: 'face', body: 'R/2', face: top([{ pattern: 'Q', index: 1 }, { pattern: 'R', index: 2 }]) }),
    });
    expect(featureRefs(twice.features.find((f) => f.id === 'S3')!)).toEqual(['R', 'A', 'Q']);
  });

  it('an edge of a copy is projected by the names of its two faces', () => {
    const doc = run(copies(), { type: 'addFeature', feature: emptySketch('S2', 'S2', XY) });
    const tag = [{ pattern: 'Q', index: 2 }];
    const edge = { a: top(tag), b: { feature: 'A', role: 'side' as const, curve: 'c', copy: tag } };
    const projected = run(doc, { type: 'addExternal', sketch: 'S2', id: 'x', ref: { type: 'edge', body: 'Q/2', edge, kind: 'circle' } });
    expect(featureRefs(projected.features.find((f) => f.id === 'S2')!)).toEqual(['Q', 'A']);
    invalid(doc, { type: 'addExternal', sketch: 'S2', id: 'x', ref: { type: 'edge', body: 'Q/2', edge: { ...edge, b: { ...edge.b, copy: [{ pattern: 'Z', index: 1 }] } }, kind: 'circle' } }, /feature "Z" neexistuje/);
  });

  it('the key of a face name tells a copy from the original and copies from each other', () => {
    expect(faceKey(top())).toBe('A/endCap');
    expect(faceKey(top([{ pattern: 'Q', index: 2 }]))).toBe('A/endCap/@Q:2');
    expect(faceKey({ feature: 'A', role: 'side', curve: 'c', copy: [{ pattern: 'Q', index: 1 }, { pattern: 'R', index: 3 }] })).toBe('A/side/c/@Q:1/@R:3');
  });
});

describe('rigid transforms', () => {
  const near = (a: Vec3, b: Vec3) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i], 12));

  it('a rotation turns counter-clockwise around the axis through the point', () => {
    const quarter = rotation([0, 0, 0], [0, 0, 1], Math.PI / 2);
    near(transformPoint(quarter, [1, 0, 5]), [0, 1, 5]);
    near(transformPoint(rotation([0, 0, 0], [0, 1, 0], Math.PI / 2), [0, 3, 1]), [1, 3, 0]);
    // the axis need not pass through the origin nor be a unit vector
    const off = rotation([10, 0, 0], [0, 0, 2], Math.PI);
    near(transformPoint(off, [12, 1, 4]), [8, -1, 4]);
    near(transformPoint(off, [10, 0, 7]), [10, 0, 7]);
    const frame = transformFrame(quarter, { origin: [2, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] });
    near(frame.origin, [0, 2, 0]);
    near(frame.x, [0, 1, 0]);
    near(frame.y, [-1, 0, 0]);
    near(frame.normal, [0, 0, 1]);
  });

  it('moves the description of a face with it', () => {
    const quarter = rotation([0, 0, 0], [0, 0, 1], Math.PI / 2);
    const plane = transformFace(quarter, { planar: true, origin: [3, 0, 1], y: [0, 0, 1], normal: [0, -1, 0] });
    expect(plane.planar).toBe(true);
    if (plane.planar) {
      near(plane.origin, [0, 3, 1]);
      near(plane.y, [0, 0, 1]);
      near(plane.normal, [1, 0, 0]);
    }
    const cylinder = transformFace(quarter, { planar: false, surface: 'cylinder', center: [4, 0, 0], axis: [1, 0, 0], radius: 2 });
    expect(cylinder).toMatchObject({ planar: false, surface: 'cylinder', radius: 2 });
    if (!cylinder.planar && cylinder.surface === 'cylinder') {
      near(cylinder.center, [0, 4, 0]);
      near(cylinder.axis, [0, 1, 0]);
    }
    const swept = transformFace(quarter, { planar: false, surface: 'swept', axis: [1, 0, 0] });
    if (!swept.planar) near(swept.axis, [0, 1, 0]);
  });

  it('a transformed solid keeps its volume and gets new face numbers; a mirror flips the winding', () => {
    // a tetrahedron with outward faces
    const solid: Solid = {
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      triangles: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
      faceIds: Uint32Array.from([0, 1, 2, 3]),
    };
    expect(volumeOf(solid)).toBeCloseTo(1 / 6, 12);
    const turned = transformSolid(rotation([5, 5, 0], [1, 1, 1], 1.1), solid, (face) => face + 10);
    expect(volumeOf(turned)).toBeCloseTo(1 / 6, 5); // positions are single precision
    expect([...turned.faceIds]).toEqual([10, 11, 12, 13]);
    expect([...solid.faceIds]).toEqual([0, 1, 2, 3]); // the source is not changed
    const mirror = { matrix: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]] as [Vec3, Vec3, Vec3], translation: [0, 0, 0] as Vec3 };
    expect(volumeOf(transformSolid(mirror, solid, (face) => face))).toBeCloseTo(1 / 6, 12);
    expect(volumeOf({ ...solid, positions: transformSolid(mirror, solid, (face) => face).positions })).toBeCloseTo(-1 / 6, 12); // without the flip it would be inside out
  });
});

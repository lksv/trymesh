// D35 point 4 at the document level (no recompute): the pattern feature, derived body IDs and the
// copy tags of face names. The rigid transforms of the copies are tested here as well.
import { describe, expect, it } from 'vitest';
import type { Command, Document, ExtrudeFeature, FaceName, FeaturePatch, Input, PatternFeature, PlaneRef, Solid, Vec3 } from '../src/types';
import { FEATURE_TYPE_INFO, MAX_PATTERN_COUNT, applyCommand, emptyDocument, emptySketch, featureInput, featureRefs, fieldsOf, validateDocument } from '../src/document';
import { GRID_STRIDE, MAX_PATTERN_PLACES, copiesOf } from '../src/features/pattern';
import type { State } from '../src/recompute/state';
import { compose, mirrors, reflection, rotation, shift, transformFace, transformFrame, transformPoint, transformSolid, transformVector, turnedOver, volumeOf } from '../src/solid';
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
type Transform = Extract<Input<PatternFeature>['transform'], { type: 'circular' }>;
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
// the transform of a circular pattern
const circular = (doc: Document, id: string) => feature(doc, id).transform as Extract<PatternFeature['transform'], { type: 'circular' }>;

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
    // the count once per kind that has one (D53)
    expect(FEATURE_TYPE_INFO.pattern.fields.map((f) => [f.path, f.spec.unit, f.when])).toEqual([
      ['transform/count', 'count', { path: 'transform/type', equals: 'circular' }],
      ['transform/span/angle', 'rad', { path: 'transform/span/type', equals: 'angle' }],
      ['transform/count', 'count', { path: 'transform/type', equals: 'linear' }],
      ['transform/span/spacing', 'mm', { path: 'transform/span/type', equals: 'spacing' }],
      ['transform/span/length', 'mm', { path: 'transform/span/type', equals: 'length' }],
      // the second direction of a grid: its count once per span
      ['transform/second/count', 'count', { path: 'transform/second/span/type', equals: 'spacing' }],
      ['transform/second/span/spacing', 'mm', { path: 'transform/second/span/type', equals: 'spacing' }],
      ['transform/second/count', 'count', { path: 'transform/second/span/type', equals: 'length' }],
      ['transform/second/span/length', 'mm', { path: 'transform/second/span/type', equals: 'length' }],
    ]);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('the source: extrusions that add or cut, before the pattern, each once; or one body', () => {
    const doc = base();
    expect(feature(run(doc, add(pattern('P', { type: 'features', features: ['B', 'H'] }))), 'P').source).toEqual({ type: 'features', features: ['B', 'H'] }); // the order of the command
    invalid(doc, add(pattern('P', { type: 'features', features: ['A'] })), /feature "A" is not a feature that applies a tool \(an extrusion or a revolve with the operation add or cut, a hole\)/);
    invalid(doc, add(pattern('P', { type: 'features', features: ['S1'] })), /feature "S1" is not a feature that applies a tool/);
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
    for (const count of [1, 2, MAX_PATTERN_COUNT]) expect(circular(run(doc, add(pattern('P', holes, { count }))), 'P').count).toBe(count);
    for (const count of [0, -1, MAX_PATTERN_COUNT + 1, 2.5]) invalid(doc, add(pattern('P', holes, { count })), /transform\.count/);
    expect(circular(run(doc, add(pattern('P', holes, { count: 0.3 / 0.1 }))), 'P').count).toBe(3); // within the tolerance of an integer
    const angled = run(doc, add(pattern('P', holes, { count: 3, span: { type: 'angle', angle: Math.PI / 2 } })));
    expect(circular(angled, 'P').span).toEqual({ type: 'angle', angle: Math.PI / 2 });
    expect(circular(run(doc, add(pattern('P', holes, { span: { type: 'angle', angle: -2 * Math.PI } }))), 'P').span).toEqual({ type: 'angle', angle: -2 * Math.PI });
    invalid(doc, add(pattern('P', holes, { span: { type: 'angle', angle: 0 } })), /transform\.span\.angle/);
    invalid(doc, add(pattern('P', holes, { span: { type: 'angle', angle: 90 } })), /transform\.span\.angle/); // degrees by mistake
    invalid(doc, add(pattern('P', holes, { span: { type: 'angle' } as never })), /transform\.span\.angle/);
    invalid(doc, add(pattern('P', holes, { span: { type: 'arc' } as never })), /transform\.span\.type: čeká se jedna z hodnot full, angle/);
    invalid(doc, add(pattern('P', holes, { type: 'helix' as never })), /transform\.type: čeká se jedna z hodnot circular, linear, mirror/);
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
    expect(circular(run(full, { type: 'setField', feature: 'P', path: 'transform/count', value: 2 }), 'P').count).toBe(2);
    invalid(full, { type: 'setField', feature: 'P', path: 'transform/span/angle', value: 1 }, /is not a numeric field/);
    invalid(full, { type: 'setField', feature: 'P', path: 'transform/count', value: 2.5 }, /transform\/count|count/i);
    invalid(base(), add(pattern('P', holes, {}, { 'transform/span/angle': 'n' })), /"transform\/span\/angle" is not a numeric field of this feature/);
  });

  it('the axis: a base axis, or a point of a sketch before the pattern', () => {
    const doc = base();
    for (const axis of ['X', 'Y', 'Z'] as const) expect(circular(run(doc, add(pattern('P', holes, { axis: { kind: 'base', axis } }))), 'P').axis).toEqual({ kind: 'base', axis });
    for (const point of ['p', 'origin']) {
      const through = run(doc, add(pattern('P', holes, { axis: { kind: 'sketchPoint', sketch: 'S1', point } })));
      expect(circular(through, 'P').axis).toEqual({ kind: 'sketchPoint', sketch: 'S1', point });
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
    expect(circular(run(doc, add(pattern('P', holes, { span: { type: 'full', angle: undefined } as never }))), 'P').span).toEqual({ type: 'full' });
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
    expect(circular(run(doc, update('P', { transform: { span: { angle: 1 } } })), 'P').span).toEqual({ type: 'angle', angle: 1 });
    const full = run(doc, update('P', { transform: { span: { type: 'full' } } }));
    expect(feature(full, 'P')).toMatchObject({ transform: { count: 6, span: { type: 'full' } }, expressions: { 'transform/count': 'n' } });
    expect(feature(full, 'P').expressions).not.toHaveProperty('transform/span/angle');
    invalid(full, update('P', { transform: { span: { type: 'angle' } } } as FeaturePatch), /transform\.span\.angle/);
    invalid(full, update('P', { transform: { span: { angle: 1 } } } as FeaturePatch), /angle/);
    // a reference is replaced as a whole
    expect(circular(run(doc, update('P', { transform: { axis: { kind: 'sketchPoint', sketch: 'S1', point: 'p' } } })), 'P').axis).toEqual({ kind: 'sketchPoint', sketch: 'S1', point: 'p' });
    expect(circular(run(doc, update('P', { transform: { axis: { kind: 'sketchPoint', sketch: 'S1', point: 'p' } } }), update('P', { transform: { axis: { kind: 'base', axis: 'X' } } })), 'P').axis).toEqual({ kind: 'base', axis: 'X' });
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
    expect(circular(run(doc, update('P', { transform: { count: 2 } })), 'P').count).toBe(2);
    invalid(doc, update('P', { source: { features: ['H', 'B', 'X'] } }), /feature "X" neexistuje/);
    expect(feature(run(doc, update('P', { source: { features: ['B'] } })), 'P').source).toEqual({ type: 'features', features: ['B'] });
  });
});

describe('the linear pattern and the mirror (D53)', () => {
  type Any = Input<PatternFeature>['transform'];
  const of = (id: string, source: Source, transform: Any, expressions?: Record<string, string>): Input<PatternFeature> => ({ id, name: id, suppressed: false, type: 'pattern', source, transform, ...(expressions ? { expressions } : {}) });
  const X = { kind: 'base', axis: 'X' } as const;
  const row = (extra: object = {}): Any => ({ type: 'linear', direction: X, count: 3, span: { type: 'spacing', spacing: 5 }, ...extra }) as Any;
  const mirror = (plane: PlaneRef | object = { kind: 'base', plane: 'YZ' }): Any => ({ type: 'mirror', plane }) as Any;
  const body: Source = { type: 'body', body: 'A' };
  // the base with a plane feature M (YZ moved by 5) after the body
  const planed = (): Document => run(base(), { type: 'addFeature', feature: { id: 'M', name: 'M', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'YZ' }, offset: 5 } });

  it('a linear pattern: a direction, the count and a spacing or a length, both numeric fields with expressions', () => {
    const doc = run(base(), add(of('P', holes, row({ count: 'n', span: { type: 'spacing', spacing: 'n / 2' } }))));
    expect(feature(doc, 'P')).toMatchObject({ transform: { type: 'linear', direction: X, count: 6, span: { type: 'spacing', spacing: 3 } }, expressions: { 'transform/count': 'n', 'transform/span/spacing': 'n / 2' } });
    expect(fieldsOf(feature(doc, 'P')).map((f) => [f.path, f.value, f.expr])).toEqual([
      ['transform/count', 6, 'n'],
      ['transform/span/spacing', 3, 'n / 2'],
    ]);
    expect(featureInput(feature(doc, 'P'))).toEqual(of('P', holes, row({ count: 'n', span: { type: 'spacing', spacing: 'n / 2' } })));
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const long = run(base(), add(of('P', body, row({ span: { type: 'length', length: -40 } }))));
    expect(fieldsOf(feature(long, 'P')).map((f) => [f.path, f.value, f.spec.unit])).toEqual([
      ['transform/count', 3, 'count'],
      ['transform/span/length', -40, 'mm'],
    ]);
    // zero is refused as a number and as an expression; a count has the bounds of the circular pattern
    invalid(base(), add(of('P', holes, row({ span: { type: 'spacing', spacing: 0 } }))), /transform\.span\.spacing/);
    invalid(base(), add(of('P', holes, row({ span: { type: 'spacing', spacing: 'n - 6' } }))), /transform\.span\.spacing: expression "n - 6"/);
    invalid(base(), add(of('P', holes, row({ span: { type: 'length', length: 0 } }))), /transform\.span\.length/);
    invalid(base(), add(of('P', holes, row({ count: MAX_PATTERN_COUNT + 1 }))), /transform\.count/);
    expect(() => run(base(), add(of('P', holes, row({ count: 1, span: { type: 'length', length: 10 } }))))).not.toThrow();
    // the field of another span: not a numeric field of this feature
    invalid(doc, { type: 'setField', feature: 'P', path: 'transform/span/length', value: 1 }, /is not a numeric field/);
    expect(feature(run(doc, { type: 'setField', feature: 'P', path: 'transform/span/spacing', value: -2 }), 'P').transform).toMatchObject({ span: { spacing: -2 } });
    invalid(doc, { type: 'setField', feature: 'P', path: 'transform/span/spacing', value: 0 }, /spacing/);
  });

  it('every kind lists its fields: a field of another kind is refused, not dropped', () => {
    const doc = planed();
    invalid(doc, add(of('P', holes, row({ axis: X }))), /transform\.axis: a transform of the type linear has no such field/);
    invalid(doc, add(of('P', holes, row({ plane: { kind: 'base', plane: 'XY' } }))), /transform\.plane: a transform of the type linear has no such field/);
    invalid(doc, add(of('P', holes, row({ span: { type: 'spacing', spacing: 5, length: 3 } }))), /transform\.span\.length: a span of the type spacing has no such field/);
    invalid(doc, add(of('P', holes, row({ span: { type: 'angle', angle: 1 } }))), /transform\.span\.type: čeká se jedna z hodnot spacing, length/);
    invalid(doc, add(of('P', holes, row({ direction: undefined }))), /transform\.direction/);
    invalid(doc, add(of('P', holes, { ...mirror(), count: 2 } as Any)), /transform\.count: a transform of the type mirror has no such field/);
    invalid(doc, add(of('P', holes, { ...mirror(), axis: X } as Any)), /transform\.axis: a transform of the type mirror has no such field/);
    invalid(doc, add(of('P', holes, pattern('P', holes, { direction: X } as never).transform)), /transform\.direction: a transform of the type circular has no such field/);
    invalid(doc, add(of('P', holes, { type: 'mirror' } as Any)), /transform\.plane/);
    // a mirror has no numeric field
    const mirrored = run(doc, add(of('P', holes, mirror())));
    expect(fieldsOf(feature(mirrored, 'P'))).toEqual([]);
    invalid(mirrored, { type: 'setField', feature: 'P', path: 'transform/count', value: 2 }, /is not a numeric field/);
    invalid(doc, add(of('P', holes, mirror(), { 'transform/count': '2' })), /"transform\/count" is not a numeric field of this feature/);
  });

  it('the direction and the plane are references: before the pattern, and they order the timeline', () => {
    const doc = planed();
    const along = run(doc, add(of('P', holes, row({ direction: { kind: 'sketchPoint', sketch: 'S1', point: 'origin' } }))));
    expect(featureRefs(feature(along, 'P'))).toEqual(['H', 'S1']);
    invalid(doc, add(of('P', holes, row({ direction: { kind: 'sketchPoint', sketch: 'S1', point: 'q' } }))), /transform\.direction\.point/);
    invalid(doc, add(of('P', holes, row({ direction: { kind: 'base', axis: 'W' } }))), /transform\.direction\.axis/);
    // a base plane, a plane feature, a planar face of a body
    for (const plane of [{ kind: 'base', plane: 'XZ' }, { kind: 'plane', feature: 'M' }, { kind: 'face', body: 'A', face: { feature: 'A', role: 'endCap' } }] as PlaneRef[]) {
      expect(feature(run(doc, add(of('P', holes, mirror(plane)))), 'P').transform).toEqual({ type: 'mirror', plane });
    }
    expect(featureRefs(feature(run(doc, add(of('P', holes, mirror({ kind: 'plane', feature: 'M' })))), 'P'))).toEqual(['H', 'M']);
    expect(featureRefs(feature(run(doc, add(of('P', body, mirror({ kind: 'face', body: 'A', face: { feature: 'H', role: 'side', curve: 'c' } })))), 'P'))).toEqual(['A', 'H']);
    invalid(doc, add(of('P', holes, mirror({ kind: 'plane', feature: 'X' }))), /feature "X" neexistuje/);
    invalid(doc, add(of('P', holes, mirror({ kind: 'plane', feature: 'H' }))), /transform\.plane/);
    invalid(doc, add(of('P', holes, mirror({ kind: 'base', plane: 'XX' }))), /transform\.plane\.plane/);
    // the plane must lie before the pattern, and cannot be moved behind it
    invalid(doc, { type: 'addFeature', feature: of('P', holes, mirror({ kind: 'plane', feature: 'M' })), index: 4 }, /transform\.plane/);
    const after = run(doc, add(of('P', holes, mirror({ kind: 'plane', feature: 'M' }))));
    invalid(after, { type: 'moveFeature', id: 'M', index: after.features.length - 1 }, /"M" by se dostala za feature "P", která na ni odkazuje/);
    // a face of a copy: the copy's pattern is a reference as well
    const copied = run(doc, add(of('Q', body, row())));
    const onCopy = run(copied, add(of('P', holes, mirror({ kind: 'face', body: 'Q/1', face: { feature: 'A', role: 'endCap', copy: [{ pattern: 'Q', index: 1 }] } }))));
    expect(featureRefs(feature(onCopy, 'P'))).toEqual(['H', 'Q', 'A']);
  });

  it('updateFeature: a transform of the same kind merges, another kind replaces it whole with its expressions', () => {
    const doc = run(planed(), add(of('P', holes, row({ count: 'n', span: { type: 'spacing', spacing: 'n / 2' } }))));
    // the count alone: the span and its expression stay
    expect(feature(run(doc, update('P', { transform: { count: 4 } })), 'P')).toMatchObject({ transform: { type: 'linear', count: 4, span: { spacing: 3 } }, expressions: { 'transform/span/spacing': 'n / 2' } });
    // the other span replaces the span and its expression
    const long = run(doc, update('P', { transform: { span: { type: 'length', length: 30 } } }));
    expect(feature(long, 'P')).toMatchObject({ transform: { count: 6, span: { type: 'length', length: 30 } }, expressions: { 'transform/count': 'n' } });
    expect(feature(long, 'P').expressions).not.toHaveProperty('transform/span/spacing');
    // the direction is replaced whole
    expect(feature(run(doc, update('P', { transform: { direction: { kind: 'base', axis: 'Z' } } })), 'P').transform).toMatchObject({ direction: { kind: 'base', axis: 'Z' } });
    // another kind: complete, and the expressions under transform/ go with the old transform
    const mirrored = run(doc, update('P', { transform: { type: 'mirror', plane: { kind: 'plane', feature: 'M' } } }));
    expect(feature(mirrored, 'P').transform).toEqual({ type: 'mirror', plane: { kind: 'plane', feature: 'M' } });
    expect(feature(mirrored, 'P').expressions).toBeUndefined();
    invalid(doc, update('P', { transform: { type: 'mirror' } } as FeaturePatch), /transform\.plane/);
    invalid(doc, update('P', { transform: { type: 'circular', count: 3 } } as FeaturePatch), /transform\.axis/);
    invalid(doc, update('P', { transform: { plane: { kind: 'base', plane: 'XY' } } } as FeaturePatch), /transform\.plane/);
    // and back to a row: a count given as a number has no expression
    const back = run(mirrored, update('P', { transform: row({ count: 2 }) as never }));
    expect(feature(back, 'P')).toMatchObject({ transform: { type: 'linear', count: 2 } });
    expect(feature(back, 'P').expressions).toBeUndefined();
    // a circular pattern changed into a row drops the expression of its count
    const turned = run(planed(), add(pattern('P', holes, { count: 'n' })), update('P', { transform: row({ count: 3 }) as never }));
    expect(feature(turned, 'P').expressions).toBeUndefined();
  });

  it('a mirror creates the one body `<pattern>/1`; a command cannot name another', () => {
    const doc = run(base(), add(of('Q', body, mirror())));
    expect(() => run(doc, add(extrude('C', { operation: 'cut', targets: ['Q/1'] })))).not.toThrow();
    invalid(doc, add(extrude('C', { operation: 'cut', targets: ['Q/2'] })), /feature "Q\/2" není těleso/);
    invalid(doc, { type: 'setBodyProperties', body: 'Q/2', patch: { color: '#000000' } }, /Q\/2/);
    expect(() => run(doc, { type: 'setBodyProperties', body: 'Q/1', patch: { color: '#000000' } })).not.toThrow();
    invalid(doc, { type: 'setLink', id: 'base', bodies: ['A', 'Q/2'] }, /Q\/2/);
    invalid(doc, add(of('R', { type: 'body', body: 'Q/2' }, mirror())), /source\.body/);
    // a row of the same body accepts any number: the count may be an expression
    expect(() => run(base(), add(of('Q', body, row())), add(extrude('C', { operation: 'cut', targets: ['Q/7'] })))).not.toThrow();
    // An ID a change of the kind left in the document stays and loads; the recompute judges it.
    const left = run(base(), add(of('Q', body, row())), add(extrude('C', { operation: 'cut', targets: ['Q/2'] })), { type: 'setBodyProperties', body: 'Q/2', patch: { color: '#000000' } }, { type: 'setLink', id: 'base', bodies: ['Q/2'] }, update('Q', { transform: mirror() as never }));
    expect((left.features.find((f) => f.id === 'C') as ExtrudeFeature).targets).toEqual(['Q/2']);
    expect(validateDocument(JSON.parse(JSON.stringify(left)))).toEqual(left);
    // a command that repeats the reference its feature had is accepted; a new one is not
    expect(() => run(left, update('C', { targets: ['Q/2'] }))).not.toThrow();
    invalid(left, add(extrude('D', { operation: 'cut', targets: ['Q/2'] })), /Q\/2/);
    // body properties of such an ID can be removed, not changed
    invalid(left, { type: 'setBodyProperties', body: 'Q/2', patch: { color: '#ffffff' } }, /Q\/2/);
    expect(() => run(left, { type: 'removeBodyProperties', body: 'Q/2' } as Command)).not.toThrow();
    // the number in the copy tag of a face is not checked against the kind: a valid command
    const tagged = { kind: 'face', body: 'Q/1', face: { feature: 'A', role: 'endCap', copy: [{ pattern: 'Q', index: 2 }] } } as PlaneRef;
    expect(() => run(doc, { type: 'addFeature', feature: emptySketch('S2', 'S2', tagged) })).not.toThrow();
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
    if (!swept.planar && swept.surface === 'swept') near(swept.axis, [0, 1, 0]);
  });

  it('a reflection in a plane: points of the plane stay, twice is the identity, the determinant is −1', () => {
    for (const [point, normal] of [[[5, 0, 0], [1, 0, 0]], [[5, 0, 0], [-3, 0, 0]], [[1, 2, 3], [1, 1, 0]], [[0, 0, 0], [0.2, -0.5, 2]]] as [Vec3, Vec3][]) {
      const m = reflection(point, normal);
      expect(mirrors(m)).toBe(true);
      near(transformPoint(m, point), point);
      const inPlane: Vec3 = [point[0] + normal[1], point[1] - normal[0], point[2]]; // a point of the plane beside `point`
      near(transformPoint(m, inPlane), inPlane);
      near(transformVector(m, normal), [-normal[0], -normal[1], -normal[2]]);
      const twice = compose(m, m);
      near(transformPoint(twice, [7, -3, 11]), [7, -3, 11]);
      expect(mirrors(twice)).toBe(false);
    }
    // the plane x = 5: a point at x = 8 goes to x = 2, whatever the length and the sense of the normal
    near(transformPoint(reflection([5, 9, 9], [-2, 0, 0]), [8, 1, 2]), [2, 1, 2]);
    expect(mirrors(rotation([0, 0, 0], [0, 0, 1], 1))).toBe(false);
    expect(mirrors(shift([1, 2, 3], -4))).toBe(false);
    near(transformPoint(shift([0, 0, 2], -4), [1, 1, 1]), [1, 1, -3]);
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
    // turned over: the volume changes its sign, the faces of the triangles stay
    const over = turnedOver(solid);
    expect(volumeOf(over)).toBeCloseTo(-1 / 6, 12);
    expect([...over.faceIds]).toEqual([0, 1, 2, 3]);
    expect([...solid.triangles]).toEqual([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]); // the source is not changed
  });
});

describe('the grid: a second direction of the linear pattern (D53)', () => {
  type Any = Input<PatternFeature>['transform'];
  type Linear = Extract<PatternFeature['transform'], { type: 'linear' }>;
  const of = (id: string, source: Source, transform: Any, expressions?: Record<string, string>): Input<PatternFeature> => ({ id, name: id, suppressed: false, type: 'pattern', source, transform, ...(expressions ? { expressions } : {}) });
  const X = { kind: 'base', axis: 'X' } as const;
  const Y = { kind: 'base', axis: 'Y' } as const;
  const along = (extra: object = {}) => ({ direction: Y, count: 2, span: { type: 'spacing', spacing: 7 }, ...extra });
  const row = (extra: object = {}): Any => ({ type: 'linear', direction: X, count: 3, span: { type: 'spacing', spacing: 5 }, ...extra }) as Any;
  const grid = (extra: object = {}, second: object = {}): Any => row({ second: along(second), ...extra });
  const linear = (doc: Document, id: string): Linear => feature(doc, id).transform as Linear;

  it('the stride is above every step of a count, and the bound of the places is that of a count', () => {
    expect(GRID_STRIDE).toBe(1000);
    expect(GRID_STRIDE).toBeGreaterThan(MAX_PATTERN_COUNT - 1);
    expect(MAX_PATTERN_PLACES).toBe(200);
  });

  it('`second` has a direction, a count and a span, each as in the first direction; numeric fields with expressions', () => {
    const doc = run(base(), add(of('P', holes, grid({}, { count: 'n / 2', span: { type: 'spacing', spacing: 'n + 1' } }))));
    expect(linear(doc, 'P').second).toEqual({ direction: Y, count: 3, span: { type: 'spacing', spacing: 7 } });
    expect(feature(doc, 'P').expressions).toEqual({ 'transform/second/count': 'n / 2', 'transform/second/span/spacing': 'n + 1' });
    // fieldsOf reports what the validator read, in its order; the registry lists every path
    expect(fieldsOf(feature(doc, 'P')).map((f) => [f.path, f.value, f.expr])).toEqual([
      ['transform/count', 3, undefined],
      ['transform/span/spacing', 5, undefined],
      ['transform/second/count', 3, 'n / 2'],
      ['transform/second/span/spacing', 7, 'n + 1'],
    ]);
    const registry = FEATURE_TYPE_INFO.pattern.fields.map((f) => f.path);
    for (const field of fieldsOf(feature(doc, 'P'))) expect(registry).toContain(field.path);
    expect(featureInput(feature(doc, 'P'))).toEqual(of('P', holes, grid({}, { count: 'n / 2', span: { type: 'spacing', spacing: 'n + 1' } })));
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const long = run(base(), add(of('P', holes, grid({}, { span: { type: 'length', length: -40 } }))));
    expect(fieldsOf(feature(long, 'P')).map((f) => [f.path, f.spec.unit])).toEqual([
      ['transform/count', 'count'],
      ['transform/span/spacing', 'mm'],
      ['transform/second/count', 'count'],
      ['transform/second/span/length', 'mm'],
    ]);
    // a row has no field of a second direction
    expect(fieldsOf(feature(run(base(), add(of('P', holes, row()))), 'P')).map((f) => f.path)).toEqual(['transform/count', 'transform/span/spacing']);
  });

  it('the second direction lists its fields; only a linear pattern has one', () => {
    const doc = base();
    for (const count of [0, MAX_PATTERN_COUNT + 1, 1.5]) invalid(doc, add(of('P', holes, grid({}, { count }))), /transform\.second\.count/);
    invalid(doc, add(of('P', holes, grid({}, { span: { type: 'spacing', spacing: 0 } }))), /transform\.second\.span\.spacing/);
    invalid(doc, add(of('P', holes, grid({}, { span: { type: 'length', length: 0 } }))), /transform\.second\.span\.length/);
    invalid(doc, add(of('P', holes, grid({}, { span: { type: 'spacing', spacing: 5, length: 3 } }))), /transform\.second\.span\.length: a span of the type spacing has no such field/);
    invalid(doc, add(of('P', holes, grid({}, { type: 'linear' }))), /transform\.second\.type: a second direction has no such field/);
    invalid(doc, add(of('P', holes, grid({}, { second: along() }))), /transform\.second\.second: a second direction has no such field/);
    invalid(doc, add(of('P', holes, grid({}, { axis: X }))), /transform\.second\.axis: a second direction has no such field/);
    invalid(doc, add(of('P', holes, row({ second: { count: 2 } }))), /transform\.second\.direction/);
    invalid(doc, add(of('P', holes, row({ second: { direction: Y, count: 2 } }))), /transform\.second\.span/);
    invalid(doc, add(of('P', holes, row({ second: 3 }))), /transform\.second/);
    invalid(doc, add(of('P', holes, row({ rows: 2 }))), /transform\.rows: a transform of the type linear has no such field/);
    invalid(doc, add(pattern('P', holes, { second: along() } as never)), /transform\.second: a transform of the type circular has no such field/);
    invalid(doc, add(of('P', holes, { type: 'mirror', plane: { kind: 'base', plane: 'YZ' }, second: along() } as Any)), /transform\.second: a transform of the type mirror has no such field/);
    // an expression at a field of a second direction the pattern does not have
    invalid(doc, add(of('P', holes, row(), { 'transform/second/count': '2' })), /"transform\/second\/count" is not a numeric field of this feature/);
    // a count of 1 in either direction is a grid all the same
    expect(linear(run(doc, add(of('P', holes, grid({ count: 1 }, { count: 1 })))), 'P').second?.count).toBe(1);
  });

  it('the second direction is a reference: before the pattern, and it orders the timeline', () => {
    const sketched = run(base(), add(of('P', holes, grid({}, { direction: { kind: 'sketchPoint', sketch: 'S1', point: 'origin' } }))));
    expect(featureRefs(feature(sketched, 'P'))).toEqual(['H', 'S1']);
    invalid(base(), add(of('P', holes, grid({}, { direction: { kind: 'sketchPoint', sketch: 'S1', point: 'q' } }))), /transform\.second\.direction\.point/);
    invalid(base(), add(of('P', holes, grid({}, { direction: { kind: 'sketchPoint', sketch: 'S9', point: 'origin' } }))), /S9/);
    // a sketch after the source: the pattern keeps it in front of itself
    const late = run(base(), { type: 'addFeature', feature: emptySketch('S2', 'S2', XY) }, add(of('P', holes, grid({}, { direction: { kind: 'sketchPoint', sketch: 'S2', point: 'origin' } }))));
    invalid(late, { type: 'moveFeature', id: 'S2', index: late.features.length - 1 }, /"S2" by se dostala za feature "P", která na ni odkazuje/);
    // a sketch removed: the reference stays in the document, which loads; the recompute judges it
    const gone = run(late, { type: 'removeFeature', id: 'S2' });
    expect(linear(gone, 'P').second?.direction).toEqual({ kind: 'sketchPoint', sketch: 'S2', point: 'origin' });
    expect(validateDocument(JSON.parse(JSON.stringify(gone)))).toEqual(gone);
  });

  it('updateFeature: `second` added whole, merged by field, removed by null with its expressions', () => {
    const doc = run(base(), add(of('P', holes, row({ count: 'n' }))));
    // added to a row: complete, or refused
    const added = run(doc, update('P', { transform: { second: along({ count: 'n / 3' }) } } as FeaturePatch));
    expect(linear(added, 'P')).toEqual({ type: 'linear', direction: X, count: 6, span: { type: 'spacing', spacing: 5 }, second: { direction: Y, count: 2, span: { type: 'spacing', spacing: 7 } } });
    expect(feature(added, 'P').expressions).toEqual({ 'transform/count': 'n', 'transform/second/count': 'n / 3' });
    invalid(doc, update('P', { transform: { second: { count: 2 } } } as FeaturePatch), /transform\.second\.direction/);
    invalid(doc, update('P', { transform: { second: { direction: Y, count: 2 } } } as FeaturePatch), /transform\.second\.span/);
    // on a grid: merged by field; the span alone; another type of span replaces the span
    expect(linear(run(added, update('P', { transform: { second: { span: { spacing: 9 } } } } as FeaturePatch)), 'P').second).toEqual({ direction: Y, count: 2, span: { type: 'spacing', spacing: 9 } });
    const counted = run(added, update('P', { transform: { second: { count: 4 } } } as FeaturePatch));
    expect(linear(counted, 'P').second?.count).toBe(4);
    expect(feature(counted, 'P').expressions).toEqual({ 'transform/count': 'n' });
    expect(linear(run(added, update('P', { transform: { second: { span: { type: 'length', length: 30 } } } } as FeaturePatch)), 'P').second?.span).toEqual({ type: 'length', length: 30 });
    // the direction is a reference and replaced whole
    expect(linear(run(added, update('P', { transform: { second: { direction: { kind: 'base', axis: 'Z' } } } } as FeaturePatch)), 'P').second?.direction).toEqual({ kind: 'base', axis: 'Z' });
    // a field of the second direction that does not exist
    invalid(added, update('P', { transform: { second: { type: 'linear' } } } as FeaturePatch), /transform\.second\.type: a second direction has no such field/);
    // null: a row again with the numbers of the row, and the expressions of the second direction go
    const back = run(added, update('P', { transform: { second: null } } as FeaturePatch));
    expect(linear(back, 'P')).toEqual({ type: 'linear', direction: X, count: 6, span: { type: 'spacing', spacing: 5 } });
    expect(feature(back, 'P').expressions).toEqual({ 'transform/count': 'n' });
    // null on a row is accepted (a form sends it either way)
    expect(linear(run(doc, update('P', { transform: { second: null } } as FeaturePatch)), 'P')).toEqual(linear(doc, 'P'));
    // another kind replaces the transform, the second direction and its expressions included
    const mirrored = run(added, update('P', { transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } }));
    expect(feature(mirrored, 'P').transform).toEqual({ type: 'mirror', plane: { kind: 'base', plane: 'YZ' } });
    expect(feature(mirrored, 'P').expressions).toBeUndefined();
    // `second` on another kind, also as null
    const turned = run(base(), add(pattern('Q')));
    invalid(turned, update('Q', { transform: { second: along() } } as FeaturePatch), /transform\.second: a transform of the type circular has no such field/);
    invalid(turned, update('Q', { transform: { second: null } } as FeaturePatch), /transform\.second/);
    invalid(mirrored, update('P', { transform: { second: null } } as FeaturePatch), /transform\.second/);
  });

  it('setField reaches the fields of a second direction the pattern has; it cannot add one', () => {
    const doc = run(base(), add(of('P', holes, row())));
    invalid(doc, { type: 'setField', feature: 'P', path: 'transform/second/count', value: 2 }, /is not a numeric field/);
    const gridded = run(base(), add(of('P', holes, grid())));
    expect(linear(run(gridded, { type: 'setField', feature: 'P', path: 'transform/second/count', value: 'n' }), 'P').second?.count).toBe(6);
    expect(feature(run(gridded, { type: 'setField', feature: 'P', path: 'transform/second/count', value: 'n' }), 'P').expressions).toEqual({ 'transform/second/count': 'n' });
    expect(linear(run(gridded, { type: 'setField', feature: 'P', path: 'transform/second/span/spacing', value: -2 }), 'P').second?.span).toEqual({ type: 'spacing', spacing: -2 });
    for (const value of [0, 201]) invalid(gridded, { type: 'setField', feature: 'P', path: 'transform/second/count', value }, /transform\.second\.count/);
    invalid(gridded, { type: 'setField', feature: 'P', path: 'transform/second/span/spacing', value: 0 }, /spacing/);
    invalid(gridded, { type: 'setField', feature: 'P', path: 'transform/second/span/length', value: 1 }, /is not a numeric field/);
  });

  it('two counts too many together are a valid document: the recompute judges the product', () => {
    const doc = run(base(), add(of('P', holes, grid({ count: 30 }, { count: 20 }))));
    expect(linear(doc, 'P')).toMatchObject({ count: 30, second: { count: 20 } });
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(() => run(doc, update('P', { transform: { span: { spacing: 6 } } }))).not.toThrow();
  });

  describe('the copies and their numbers (`copiesOf`)', () => {
    // a state with sketches whose normals are given: the directions of `sketchPoint`
    const withNormals = (...normals: Vec3[]): State =>
      ({ sketches: Object.fromEntries(normals.map((normal, i) => [`s${i}`, { frame: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal }, geometry: { points: { origin: { x: 0, y: 0 } } } }])) }) as unknown as State;
    const normalOf = (i: number) => ({ kind: 'sketchPoint', sketch: `s${i}`, point: 'origin' }) as const;
    const linearOf = (first: object, second?: object): Linear => ({ type: 'linear', direction: X, count: 3, span: { type: 'spacing', spacing: 5 }, ...first, ...(second ? { second: { direction: Y, count: 2, span: { type: 'spacing', spacing: 7 }, ...second } } : {}) }) as Linear;
    const copies = (t: Linear, state: State = withNormals()) => {
      const out = copiesOf(t, state);
      if ('code' in out) throw new Error(`${out.code}: ${out.detail}`);
      return out.map(({ transform, index }) => [index, transform.translation.map((v) => Math.round(v * 1e9) / 1e9 + 0)]);
    };
    const refusal = (t: Linear, state: State = withNormals()) => {
      const out = copiesOf(t, state);
      return 'code' in out ? out : undefined;
    };

    it('row by row, numbered i + 1000 · j; the first row is the row to the last bit', () => {
      expect(copies(linearOf({}, {}))).toEqual([
        [1, [5, 0, 0]],
        [2, [10, 0, 0]],
        [1000, [0, 7, 0]],
        [1001, [5, 7, 0]],
        [1002, [10, 7, 0]],
      ]);
      const asRow = copiesOf(linearOf({}), withNormals()) as { transform: unknown; index: number }[];
      const asGrid = copiesOf(linearOf({}, { count: 3 }), withNormals()) as { transform: unknown; index: number }[];
      expect(asGrid.slice(0, 2)).toEqual(asRow);
      // a larger count moves none and keeps every number
      const bigger = copies(linearOf({ count: 4 }, { count: 3 }));
      for (const copy of copies(linearOf({}, {}))) expect(bigger).toContainEqual(copy);
      // a length divides its direction; a count of 1 leaves a direction unused
      expect(copies(linearOf({ count: 2 }, { count: 3, span: { type: 'length', length: 40 } }))).toEqual([
        [1, [5, 0, 0]],
        [1000, [0, 20, 0]],
        [1001, [5, 20, 0]],
        [2000, [0, 40, 0]],
        [2001, [5, 40, 0]],
      ]);
      expect(copies(linearOf({ count: 1 }, { count: 3 })).map(([index]) => index)).toEqual([1000, 2000]);
      expect(copies(linearOf({ count: 3 }, { count: 1 })).map(([index]) => index)).toEqual([1, 2]);
      // negative steps run against the directions
      expect(copies(linearOf({ count: 2, span: { type: 'spacing', spacing: -5 } }, { count: 3, span: { type: 'length', length: -20 } })).at(-1)).toEqual([2001, [-5, -20, 0]]);
      // a circular pattern and a mirror are numbered from 1 as before
      expect(copiesOf({ type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } }, withNormals())).toMatchObject([{ index: 1 }, { index: 2 }]);
    });

    it('at most 200 places; refs are the two counts', () => {
      expect(copies(linearOf({ count: 20 }, { count: 10 }))).toHaveLength(199);
      expect(copies(linearOf({ count: 200 }, { count: 1 }))).toHaveLength(199);
      expect(copies(linearOf({ count: 1 }, { count: 200 }))).toHaveLength(199);
      expect(refusal(linearOf({ count: 67 }, { count: 3 }))).toEqual({ code: 'invalidPattern', refs: ['transform/count', 'transform/second/count'], detail: '67 × 3 is 201 places; a pattern has at most 200, the original included' });
      // a row is bounded by its count alone
      expect(copies(linearOf({ count: 200 }))).toHaveLength(199);
    });

    it('no two places in one place: the first pair in the order of the numbers is named', () => {
      const along = (second: object, first: object = {}) => refusal(linearOf(first, { direction: X, ...second }));
      const paths = ['transform/direction', 'transform/count', 'transform/span/spacing', 'transform/second/direction', 'transform/second/count', 'transform/second/span/spacing'];
      expect(along({ span: { type: 'spacing', spacing: 5 } }, { count: 2 })).toEqual({ code: 'invalidPattern', refs: paths, detail: 'the copies 1 and 1000 would stand in one place' });
      expect(along({ count: 3, span: { type: 'spacing', spacing: 10 } }, { count: 4 })?.detail).toBe('the copies 2 and 1000 would stand in one place');
      expect(along({ span: { type: 'spacing', spacing: -5 } })?.detail).toBe('the copy 1001 would stand in the place of the original');
      // parallel directions whose places do not meet
      expect(along({ count: 3, span: { type: 'spacing', spacing: 6 } }, { count: 4 })).toBeUndefined();
      expect(along({ count: 2, span: { type: 'spacing', spacing: 15 } })).toBeUndefined();
      expect(along({ count: 2, span: { type: 'spacing', spacing: 2.5 } }, { count: 4 })).toBeUndefined();
      // a count of 1 leaves one direction unused
      expect(along({ count: 3, span: { type: 'spacing', spacing: 5 } }, { count: 1 })).toBeUndefined();
      expect(along({ count: 1, span: { type: 'spacing', spacing: 5 } }, { count: 3 })).toBeUndefined();
      // a base axis against a sketch normal along it and against it
      const state = withNormals([0, -1, 0], [1, 0, 0], [0, 0, 1]);
      expect(refusal(linearOf({ direction: Y, count: 2 }, { direction: normalOf(0), span: { type: 'spacing', spacing: 5 } }), state)?.detail).toBe('the copy 1001 would stand in the place of the original');
      expect(refusal(linearOf({ count: 2 }, { direction: normalOf(1), span: { type: 'spacing', spacing: 5 } }), state)?.detail).toBe('the copies 1 and 1000 would stand in one place');
      expect(refusal(linearOf({ count: 2 }, { direction: normalOf(2), span: { type: 'spacing', spacing: 5 } }), state)).toBeUndefined();
      // a span of the length is named by its path
      expect(along({ span: { type: 'length', length: 5 } }, { count: 2 })?.refs).toEqual([...paths.slice(0, 5), 'transform/second/span/length']);
    });

    it('a step below the tolerance, also across; a row is not compared', () => {
      const tiny = { type: 'length', length: 2e-6 };
      expect(refusal(linearOf({ count: 5, span: tiny }, { count: 2, span: { type: 'spacing', spacing: 5 } }))?.detail).toBe('the copy 1 would stand in the place of the original');
      expect(refusal(linearOf({ count: 1 }, { count: 5, span: tiny }))?.detail).toBe('the copy 1000 would stand in the place of the original');
      expect(copies(linearOf({ count: 5, span: tiny }))).toHaveLength(4);
    });

    it('directions a hair apart: 1e-8 rad with a step of 10 mm is one place, 1e-3 rad is not', () => {
      const tilted = (angle: number): Vec3 => [Math.cos(angle), Math.sin(angle), 0];
      const hair = withNormals([1, 0, 0], tilted(1e-8));
      const ten = { type: 'spacing', spacing: 10 };
      expect(refusal(linearOf({ direction: normalOf(0), count: 2, span: ten }, { direction: normalOf(1), span: ten }), hair)?.detail).toBe('the copies 1 and 1000 would stand in one place');
      const apart = withNormals([1, 0, 0], tilted(1e-3));
      expect(copies(linearOf({ direction: normalOf(0), count: 2, span: ten }, { direction: normalOf(1), span: ten }), apart)).toHaveLength(3);
    });

    it('a direction that cannot be resolved is the error of the pattern', () => {
      expect(refusal(linearOf({}, { direction: { kind: 'sketchPoint', sketch: 'gone', point: 'origin' } }))).toEqual({ code: 'brokenReference', refs: ['gone'] });
      // the directions first, then the bound
      expect(refusal(linearOf({ count: 100 }, { count: 100, direction: { kind: 'sketchPoint', sketch: 'gone', point: 'origin' } }))?.code).toBe('brokenReference');
    });
  });
});

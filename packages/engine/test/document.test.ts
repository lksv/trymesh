// Validation and execution of commands on the document (without a recompute).
import { describe, expect, it } from 'vitest';
import type { Command, Constraint, Document, EdgeProjection, ExtrudeFeature, Feature, FeaturePatch, PlaneRef, SketchFeature } from '../src/types';
import { CommandError, FEATURE_TYPE_INFO, applyCommand, bodyOwner, emptyDocument, emptySketch, featureRefs, validateDocument } from '../src/document';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const sketchOf = (doc: Document, id = 'S1') => doc.features.find((f) => f.id === id) as SketchFeature;
const extrude = (id: string, sketch: string, extra: Partial<ExtrudeFeature> = {}): ExtrudeFeature => ({
  id,
  name: id,
  suppressed: false,
  type: 'extrude',
  profile: { type: 'regions', sketch, regions: [{ outerLoop: ['l1', 'l2', 'l3', 'l4'] }] },
  extent: { type: 'distance', start: 0, distance: 10 },
  operation: 'new',
  ...extra,
});
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });

// A sketch with the rectangle p1..p4, l1..l4 and the body E1 made from it.
function base(): Document {
  const points: [string, number, number][] = [
    ['p1', 0, 0],
    ['p2', 40, 0],
    ['p3', 40, 30],
    ['p4', 0, 30],
  ];
  return run(
    emptyDocument(),
    { type: 'addFeature', feature: emptySketch('S1', 'Sketch', XY) },
    ...points.map(([id, x, y]): Command => ({ type: 'addPoint', sketch: 'S1', id, x, y })),
    ...points.map(([id], i): Command => ({ type: 'addCurve', sketch: 'S1', id: `l${i + 1}`, curve: { type: 'line', a: id, b: points[(i + 1) % 4][0] } })),
    { type: 'addFeature', feature: extrude('E1', 'S1') },
  );
}
const invalid = (doc: Document, command: Command, pattern: RegExp) => expect(() => applyCommand(doc, command)).toThrow(pattern);

describe('commands of the timeline', () => {
  it('adding at the end and at a position, the document is not changed in place', () => {
    const doc = base();
    const next = applyCommand(doc, { type: 'addFeature', feature: emptySketch('S2', 'Second', XY), index: 0 });
    expect(next.features.map((f) => f.id)).toEqual(['S2', 'S1', 'E1']);
    expect(doc.features.map((f) => f.id)).toEqual(['S1', 'E1']);
    expect(next.features[1]).toBe(doc.features[0]); // the unchanged parts are shared
  });

  // D73: what a command may leave out of a new feature, and that a document keeps every field
  it('addFeature fills in the name, the suppression and the empty parts of a sketch; a load does not', () => {
    const doc = base();
    const next = run(doc, { type: 'addFeature', feature: { id: 'S2', type: 'sketch', plane: XY } }, { type: 'addFeature', feature: { id: 'E2', type: 'extrude', profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['l1', 'l2', 'l3', 'l4'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } });
    expect(next.features.find((f) => f.id === 'S2')).toEqual(emptySketch('S2', 'S2', XY));
    expect(next.features.find((f) => f.id === 'E2')).toEqual(extrude('E2', 'S1', { extent: { type: 'distance', start: 0, distance: 5 } }));
    // what is given is kept; a part of a sketch given is checked as before
    const named = applyCommand(doc, { type: 'addFeature', feature: { id: 'S3', name: 'Top', suppressed: true, type: 'sketch', plane: XY, points: { q1: { x: 1, y: 2 } } } });
    expect(named.features.find((f) => f.id === 'S3')).toMatchObject({ name: 'Top', suppressed: true, points: { q1: { x: 1, y: 2 } }, curves: {}, solved: { inputs: '', external: {} } });
    invalid(doc, { type: 'addFeature', feature: { id: 'S4', type: 'sketch', plane: XY, curves: { c: { type: 'line', a: 'x', b: 'y' } } } }, /S4|c/);
    invalid(doc, { type: 'addFeature', feature: { id: 'S4', name: 7, type: 'sketch', plane: XY } as never }, /name/);
    // a document keeps the full shape: a feature without its name does not load
    const stored = JSON.parse(JSON.stringify(next)) as { features: Record<string, unknown>[] };
    delete stored.features[2].name;
    expect(() => validateDocument(stored as never)).toThrow(/name/);
  });

  it('an ID must be unique in the whole document and follow the conventions', () => {
    const doc = base();
    invalid(doc, { type: 'addFeature', feature: emptySketch('E1', 'x', XY) }, /is already in the document/);
    invalid(doc, { type: 'addFeature', feature: emptySketch('p1', 'x', XY) }, /is already in the document/);
    invalid(doc, { type: 'addPoint', sketch: 'S1', id: 'l1', x: 0, y: 0 }, /is already in the document/);
    for (const id of ['a/b', 'origin', '', '__proto__']) invalid(doc, { type: 'addPoint', sketch: 'S1', id, x: 0, y: 0 }, /is not allowed/);
  });

  it('a reference to a feature must lead to an existing feature of the right type that lies before it', () => {
    const doc = base();
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S9') }, /does not exist/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'E1') }, /is not a sketch/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1'), index: 0 }, /must lie before/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut', targets: ['S1'] }) }, /is not a body/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut' }) }, /targets/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1', { targets: ['E1'] }) }, /a new body has no target/);
    invalid(doc, { type: 'addFeature', feature: emptySketch('S2', 'x', { kind: 'plane', feature: 'S1' }) }, /is not a plane/);
    const face: PlaneRef = { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'endCap' } };
    expect(run(doc, { type: 'addFeature', feature: emptySketch('S2', 'x', face) }).features).toHaveLength(3);
  });

  it('extrude: a zero distance and empty regions are invalid, the regions are stored sorted', () => {
    const doc = base();
    invalid(doc, update('E1', { extent: { distance: 0 } }), /must not be zero/);
    invalid(doc, update('E1', { profile: { regions: [] } }), /non-empty list/);
    invalid(doc, update('E1', { extent: { distance: Number.NaN } }), /finite number/);
    invalid(doc, update('E1', { extent: { start: Number.POSITIVE_INFINITY } }), /finite number/);
    const next = run(doc, update('E1', { profile: { regions: [{ outerLoop: ['l3', 'l1', 'l2', 'l1'] }] }, extent: { distance: -5 } }));
    expect(next.features[1]).toEqual({ ...extrude('E1', 'S1'), profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['l1', 'l2', 'l3'] }] }, extent: { type: 'distance', start: 0, distance: -5 } });
  });

  it('updateFeature can change both the source sketch and the operation of an extrusion', () => {
    const doc = run(base(), { type: 'addFeature', feature: emptySketch('S2', 'x', XY), index: 1 }, { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut', targets: ['E1'] }) });
    expect(run(doc, update('E2', { profile: { sketch: 'S2' } })).features[3]).toMatchObject({ profile: { sketch: 'S2', regions: [{ outerLoop: ['l1', 'l2', 'l3', 'l4'] }] }, targets: ['E1'] });
    expect(run(doc, update('E2', { operation: 'new' })).features[3]).not.toHaveProperty('targets');
    expect(run(doc, update('E2', { operation: 'new', targets: null })).features[3]).not.toHaveProperty('targets');
    invalid(doc, update('E1', { operation: 'add' }), /targets/);
    invalid(doc, update('E1', { operation: 'add', targets: ['E2'] }), /is not a body/);
    invalid(doc, update('E2', { targets: ['E2'] }), /is not a body/);
    invalid(doc, update('E2', { targets: null }), /targets/);
  });

  it('updateFeature merges: fields not given stay, a list and a reference are replaced, null removes a field', () => {
    const plane: Feature = { id: 'P1', name: 'Plane', suppressed: false, type: 'plane', base: { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'side', curve: 'l1' } }, offset: 5 };
    const doc = run(base(), { type: 'addFeature', feature: plane }, { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut', targets: ['E1'] }) });
    // a nested object with the same type of variant is merged
    expect(run(doc, update('E1', { extent: { start: 3 } })).features[1]).toEqual({ ...extrude('E1', 'S1'), extent: { type: 'distance', start: 3, distance: 10 } });
    expect(run(doc, update('E1', { extent: { type: 'distance', distance: 4 } })).features[1]).toMatchObject({ extent: { type: 'distance', start: 0, distance: 4 } });
    // a reference (an object with `kind`) is replaced whole: neither `body` nor `face` of the face is left
    expect(run(doc, update('P1', { base: XY })).features[2]).toEqual({ ...plane, base: XY });
    // half of a reference would select another face of the same body, so it is refused
    for (const half of [{ face: { feature: 'E1', role: 'endCap' } }, { body: 'E1' }, { feature: 'P0' }, {}]) invalid(doc, update('P1', { base: half } as unknown as FeaturePatch), /a reference is replaced whole/);
    // a field with the value undefined means "do not change"
    expect(run(doc, update('P1', { base: XY, offset: undefined })).features[2]).toEqual({ ...plane, base: XY });
    expect(run(doc, update('E2', { operation: 'add', targets: undefined, extent: { start: undefined, distance: 3 } })).features[3]).toMatchObject({ operation: 'add', targets: ['E1'], extent: { start: 0, distance: 3 } });
    expect(run(doc, update('E2', { operation: 'new', targets: undefined })).features[3]).not.toHaveProperty('targets');
    // an unknown nested field (a typo, a field of another variant) does not end in a success without effect
    for (const patch of [{ extent: { dist: 12 } }, { extent: { end: 5, distance: 3 } }, { profile: { outerLoop: ['x'] } }, { profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['l1'] }], generator: 'g' } }, { extent: { type: 'distance', start: 0, distance: 5, side: 'both' } }])
      invalid(doc, update('E2', patch as unknown as FeaturePatch), /updateFeature\.patch\.(extent|profile)\.\w+: (this extrude has no such field|a profile of the type regions has no such field)/);
    // a list is replaced whole
    expect(run(doc, update('E2', { profile: { regions: [{ outerLoop: ['l1'] }] } })).features[3]).toMatchObject({ profile: { regions: [{ outerLoop: ['l1'] }] } });
    // an empty change does not change the feature
    expect(run(doc, update('E2', {})).features[3]).toEqual(doc.features[3]);
    // a change changes neither the identity nor the state of the feature, and nothing outside the fields of the type passes
    for (const patch of [{ id: 'X' }, { name: 'X' }, { suppressed: true }, { type: 'plane' }, { offset: 1 }, { distance: 5 }, { toString: 1 }]) invalid(doc, update('E2', patch as FeaturePatch), /has no such field/);
    invalid(doc, update('P1', { extent: { distance: 1 } } as FeaturePatch), /has no such field/);
    invalid(doc, update('E2', { extent: { toString: 1 } } as unknown as FeaturePatch), /has no such field/);
    // a required field cannot be removed, an unknown field of a variant is dropped or refused by the validation
    invalid(doc, update('E2', { extent: null } as unknown as FeaturePatch), /extent/);
    invalid(doc, update('E2', { operation: 'drill' } as unknown as FeaturePatch), /one of the values/);
    invalid(doc, { type: 'updateFeature', id: 'E2', patch: 5 } as unknown as Command, /an object is expected/);
  });

  it('updateFeature checks only the references the feature did not have yet', () => {
    const cut = extrude('E2', 'S1', { operation: 'cut', targets: ['E1'] });
    // after the deletion both the sketch and the target of E2 are broken
    const doc = run(base(), { type: 'addFeature', feature: cut }, { type: 'removeFeature', id: 'S1' }, { type: 'removeFeature', id: 'E1' }, { type: 'addFeature', feature: emptySketch('S2', 'x', XY), index: 0 });
    expect(doc.features.map((f) => f.id)).toEqual(['S2', 'E2']);
    expect(run(doc, update('E2', { extent: { distance: 3 } })).features[1]).toMatchObject({ extent: { distance: 3 }, targets: ['E1'] });
    // repairing one reference does not trip over the other
    expect(run(doc, update('E2', { profile: { sketch: 'S2' } })).features[1]).toMatchObject({ profile: { sketch: 'S2' }, targets: ['E1'] });
    // a change that only repeats the broken reference passes; a new reference is checked
    expect(run(doc, update('E2', { targets: ['E1'], profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['l1'] }] } })).features[1]).toMatchObject({ targets: ['E1'], profile: { sketch: 'S1', regions: [{ outerLoop: ['l1'] }] } });
    invalid(doc, update('E2', { targets: ['E9'] }), /updateFeature\.patch\.targets: the feature "E9" does not exist/);
    invalid(doc, update('E2', { profile: { type: 'regions', sketch: 'S9', regions: [{ outerLoop: ['l1'] }] } }), /updateFeature\.patch\.profile\.sketch: the feature "S9" does not exist/);
    invalid(doc, update('E2', { profile: { sketch: 'E2' } }), /is not a sketch/);
    invalid(run(doc, { type: 'addFeature', feature: emptySketch('S3', 'later', XY) }), update('E2', { profile: { sketch: 'S3' } }), /must lie before/);
    // a change of the operation without a change of the targets does not check the targets, a switch to a new body drops them
    expect(run(doc, update('E2', { operation: 'add' })).features[1]).toMatchObject({ operation: 'add', targets: ['E1'] });
    expect(run(doc, update('E2', { operation: 'new' })).features[1]).not.toHaveProperty('targets');
  });

  it('body ID: the owning feature and the local part after the slash', () => {
    expect(bodyOwner('E1')).toEqual({ feature: 'E1' });
    expect(bodyOwner('pattern/3')).toEqual({ feature: 'pattern', local: '3' });
    expect(bodyOwner('a/b/c')).toEqual({ feature: 'a', local: 'b/c' });
    const doc = base();
    // an extrusion creates only the body with its own ID; a reference with a local part leads nowhere so far
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut', targets: ['E1/1'] }) }, /is not a body/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut', targets: ['E1', 'E1'] }) }, /targets/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut', targets: [] }) }, /targets/);
    // a loaded document with such a reference depends on the owner of the body
    expect(featureRefs(extrude('E2', 'S1', { operation: 'cut', targets: ['P/2'] }))).toEqual(['S1', 'P']);
    expect(Object.keys(FEATURE_TYPE_INFO).sort()).toEqual(['chamfer', 'combine', 'extrude', 'fillet', 'hole', 'insert', 'mesh', 'pattern', 'plane', 'revolve', 'sketch', 'split']);
    expect(FEATURE_TYPE_INFO.extrude).toMatchObject({ bodies: 'self', updatable: ['profile', 'extent', 'operation', 'targets'] });
    expect(FEATURE_TYPE_INFO.sketch).toMatchObject({ bodies: 'none', updatable: [] });
  });

  it('removeFeature does not cascade and the dependent extrude can be repaired without a change of ID', () => {
    const doc = run(base(), { type: 'removeFeature', id: 'S1' });
    expect(doc.features.map((f) => f.id)).toEqual(['E1']);
    // a change that does not set the reference to the sketch passes even with a reference into the void
    expect(run(doc, update('E1', { extent: { distance: 20 } })).features[0]).toMatchObject({ extent: { distance: 20 }, profile: { sketch: 'S1' } });
    // the selection of regions is another path than the reference to the sketch, so the reference into the void is not checked again
    expect(run(doc, update('E1', { profile: { regions: [{ outerLoop: ['l1'] }] } })).features[0]).toMatchObject({ profile: { sketch: 'S1', regions: [{ outerLoop: ['l1'] }] } });
    // nor does repeating the current reference (the form sends the whole extrusion) check it again
    expect(run(doc, update('E1', { profile: { sketch: 'S1' }, extent: { distance: 7 } })).features[0]).toMatchObject({ extent: { distance: 7 }, profile: { sketch: 'S1' } });
    invalid(doc, update('E1', { profile: { sketch: 'S9' } }), /does not exist/);
    const repaired = run(doc, { type: 'addFeature', feature: emptySketch('S2', 'new one', XY), index: 0 }, update('E1', { profile: { sketch: 'S2', regions: [{ outerLoop: ['c1'] }] } }));
    expect(repaired.features[1]).toMatchObject({ id: 'E1', profile: { sketch: 'S2' } });
  });

  it('moveFeature guards the order of dependencies', () => {
    const doc = run(base(), { type: 'addFeature', feature: emptySketch('S2', 'x', XY) });
    invalid(doc, { type: 'moveFeature', id: 'E1', index: 0 }, /before the feature "S1"/);
    invalid(doc, { type: 'moveFeature', id: 'S1', index: 1 }, /after the feature "E1"/);
    invalid(doc, { type: 'moveFeature', id: 'S1', index: 3 }, /outside the range/);
    expect(run(doc, { type: 'moveFeature', id: 'S2', index: 0 }).features.map((f) => f.id)).toEqual(['S2', 'S1', 'E1']);
    expect(run(doc, { type: 'moveFeature', id: 'S2', index: 1 }).features.map((f) => f.id)).toEqual(['S1', 'S2', 'E1']);
    expect(run(doc, { type: 'moveFeature', id: 'S2', index: 2 })).toBe(doc);
  });

  it('renaming, suppressing and editing a plane', () => {
    const plane: Feature = { id: 'P1', name: 'Plane', suppressed: false, type: 'plane', base: XY, offset: 5 };
    const doc = run(base(), { type: 'addFeature', feature: plane, index: 0 }, { type: 'renameFeature', id: 'P1', name: 'Top' }, { type: 'setSuppressed', id: 'E1', suppressed: true }, update('P1', { offset: 12 }));
    expect(doc.features[0]).toMatchObject({ name: 'Top', offset: 12, base: XY });
    expect(doc.features[2].suppressed).toBe(true);
    invalid(doc, update('P1', { base: { kind: 'plane', feature: 'P1' } }), /must lie before/);
    invalid(doc, update('S1', { offset: 1 }), /is a sketch/);
    invalid(doc, update('P9', { offset: 1 }), /does not exist/);
    invalid(doc, { type: 'setSketchPlane', sketch: 'S1', plane: { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'endCap' } } }, /must lie before/);
    expect(sketchOf(run(doc, { type: 'setSketchPlane', sketch: 'S1', plane: { kind: 'plane', feature: 'P1' } })).plane).toEqual({ kind: 'plane', feature: 'P1' });
  });
});

describe('commands of a sketch', () => {
  it('a curve may refer only to its own points and the origin', () => {
    const doc = base();
    expect(sketchOf(run(doc, { type: 'addCurve', sketch: 'S1', id: 'd', curve: { type: 'line', a: 'origin', b: 'p3', construction: true } })).curves.d).toEqual({ type: 'line', a: 'origin', b: 'p3', construction: true });
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'd', curve: { type: 'line', a: 'p1', b: 'nope' } }, /is neither an own point/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'd', curve: { type: 'line', a: 'p1', b: 'p1' } }, /two different points/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p1' } }, /finite number/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p1' }, radius: 0 }, /must be positive/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'd', curve: { type: 'line', a: 'p1', b: 'p3' }, radius: 3 }, /only for a circle/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'a', curve: { type: 'arc', center: 'p1', start: 'p2', end: 'p2' } }, /three different points/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'e', curve: { type: 'ellipse', center: 'p1' } as never }, /one of the values/);
    const withCircle = run(doc, { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p1' }, radius: 4 });
    expect(sketchOf(withCircle).radii).toEqual({ c: 4 });
  });

  it('constraints: the kind of operands, values and the rule of a movable operand', () => {
    const doc = run(base(), { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p1' }, radius: 4 });
    const add = (constraint: Constraint, id = 'k'): Command => ({ type: 'addConstraint', sketch: 'S1', id, constraint });
    expect(sketchOf(run(doc, add({ type: 'coincident', a: 'p1', b: 'origin' }))).constraints.k).toEqual({ type: 'coincident', a: 'p1', b: 'origin' });
    invalid(doc, add({ type: 'parallel', a: 'l1', b: 'c' }), /expected line/);
    invalid(doc, add({ type: 'parallel', a: 'l1', b: 'l1' }), /two different entities/);
    invalid(doc, add({ type: 'horizontal', line: 'p1' }), /expected line/);
    invalid(doc, add({ type: 'tangent', a: 'l1', b: 'l2' }), /tangency of two lines/);
    invalid(doc, add({ type: 'coincident', a: 'p1', b: 'ghost' }), /is not in the sketch/);
    invalid(doc, add({ type: 'distance', a: 'p1', b: 'p2', value: -1, driving: true }), /must not be negative/);
    invalid(doc, add({ type: 'radius', curve: 'c', value: 0, driving: true }), /must be positive/);
    invalid(doc, add({ type: 'angle', a: 'l1', b: 'l2', value: 4, driving: true }), /\(−π, π\]/);
    invalid(doc, add({ type: 'radius', curve: 'l1', value: 3, driving: true }), /expected circle or arc/);
    invalid(doc, add({ type: 'frobnicate' } as never), /unknown constraint/);
    expect(sketchOf(run(doc, add({ type: 'horizontalDistance', a: 'p2', b: 'p1', value: -40, driving: true }))).constraints.k).toMatchObject({ value: -40 });
    expect(sketchOf(run(doc, add({ type: 'tangent', a: 'c', b: 'l3' }))).constraints.k).toEqual({ type: 'tangent', a: 'c', b: 'l3' });
    // a dimension without `driving` is a driving one, also with an expression; false stays a reference
    const loose = (constraint: object): Command => ({ type: 'addConstraint', sketch: 'S1', id: 'k', constraint }) as Command;
    expect(sketchOf(run(doc, loose({ type: 'verticalDistance', a: 'p1', b: 'p4', value: 30 }))).constraints.k).toEqual({ type: 'verticalDistance', a: 'p1', b: 'p4', value: 30, driving: true });
    expect(sketchOf(run(doc, loose({ type: 'radius', curve: 'c', value: '2 + 2' }))).expressions).toEqual({ 'constraints/k/value': '2 + 2' });
    expect(sketchOf(run(doc, loose({ type: 'radius', curve: 'c', value: 4, driving: false }))).constraints.k).toMatchObject({ driving: false });
    invalid(doc, loose({ type: 'radius', curve: 'c', value: 4, driving: 'yes' }), /driving/);
  });

  it('symmetry and the midpoint of a line: operands, forbidden ends and duplicates', () => {
    const doc = run(base(), { type: 'addPoint', sketch: 'S1', id: 'q', x: 20, y: 15 }, { type: 'addPoint', sketch: 'S1', id: 'r', x: 5, y: 15 });
    const add = (constraint: Constraint, id = 'k'): Command => ({ type: 'addConstraint', sketch: 'S1', id, constraint });
    // l1 goes from p1 to p2; p3 and p4 are symmetric, q is the midpoint
    expect(sketchOf(run(doc, add({ type: 'symmetric', a: 'p3', b: 'p4', line: 'l1' }))).constraints.k).toEqual({ type: 'symmetric', a: 'p3', b: 'p4', line: 'l1' });
    expect(sketchOf(run(doc, add({ type: 'midpoint', point: 'q', line: 'l1' }))).constraints.k).toEqual({ type: 'midpoint', point: 'q', line: 'l1' });
    invalid(doc, add({ type: 'symmetric', a: 'p3', b: 'p3', line: 'l1' }), /needs 3 different entities/);
    invalid(doc, add({ type: 'symmetric', a: 'p3', b: 'l2', line: 'l1' }), /expected point/);
    invalid(doc, add({ type: 'symmetric', a: 'p3', b: 'p4', line: 'q' }), /expected line/);
    invalid(doc, add({ type: 'symmetric', a: 'p1', b: 'p4', line: 'l1' }), /a symmetric point must not be an end of the axis/);
    invalid(doc, add({ type: 'symmetric', a: 'p3', b: 'p2', line: 'l1' }), /a symmetric point must not be an end of the axis/);
    invalid(doc, add({ type: 'midpoint', point: 'p2', line: 'l1' }), /the midpoint of a line cannot be its end/);
    invalid(doc, add({ type: 'midpoint', point: 'l2', line: 'l1' }), /expected point/);
    invalid(doc, add({ type: 'midpoint', point: 'q' } as never), /a string is expected/);
    // for symmetry the order of the points does not matter, the axis does; the midpoint of two different lines is not a duplicate
    const twice = run(doc, add({ type: 'symmetric', a: 'p3', b: 'p4', line: 'l1' }, 's'), add({ type: 'midpoint', point: 'q', line: 'l1' }, 'm'));
    invalid(twice, add({ type: 'symmetric', a: 'p4', b: 'p3', line: 'l1' }), /the same constraint is already in the sketch \("s"\)/);
    invalid(twice, add({ type: 'midpoint', point: 'q', line: 'l1' }), /"m"/);
    run(twice, add({ type: 'symmetric', a: 'q', b: 'r', line: 'l3' }, 's2'), add({ type: 'midpoint', point: 'q', line: 'l3' }, 'm2'), add({ type: 'midpoint', point: 'r', line: 'l1' }, 'm3'));
    // deleting the axis takes the constraints with it
    expect(Object.keys(sketchOf(run(twice, { type: 'removeEntity', sketch: 'S1', id: 'l1' })).constraints)).toEqual([]);
    expect(Object.keys(sketchOf(run(twice, { type: 'removeEntity', sketch: 'S1', id: 'p4' })).constraints)).toEqual(['m']);
  });

  it('two points level or plumb, the midpoint of two points, the distance of two lines and of a line and a circle (D75): operands, values and duplicates', () => {
    const doc = run(base(), { type: 'addPoint', sketch: 'S1', id: 'q', x: 20, y: 15 }, { type: 'addPoint', sketch: 'S1', id: 'r', x: 5, y: 15 }, { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'q' }, radius: 4 });
    const add = (constraint: Constraint, id = 'k'): Command => ({ type: 'addConstraint', sketch: 'S1', id, constraint });
    const stored = (constraint: Constraint) => sketchOf(run(doc, add(constraint))).constraints.k;
    // two points, also with the origin; never a curve, never one point twice
    expect(stored({ type: 'horizontalPoints', a: 'q', b: 'r' })).toEqual({ type: 'horizontalPoints', a: 'q', b: 'r' });
    expect(stored({ type: 'verticalPoints', a: 'origin', b: 'r' })).toEqual({ type: 'verticalPoints', a: 'origin', b: 'r' });
    invalid(doc, add({ type: 'horizontalPoints', a: 'q', b: 'l1' }), /expected point/);
    invalid(doc, add({ type: 'verticalPoints', a: 'q', b: 'q' }), /two different entities/);
    // the middle and the two points it lies between: three different points
    expect(stored({ type: 'midpointPoints', point: 'q', a: 'p1', b: 'p3' })).toEqual({ type: 'midpointPoints', point: 'q', a: 'p1', b: 'p3' });
    expect(stored({ type: 'midpointPoints', point: 'q', a: 'origin', b: 'r' })).toMatchObject({ a: 'origin' });
    invalid(doc, add({ type: 'midpointPoints', point: 'q', a: 'p1', b: 'p1' }), /needs 3 different entities/);
    invalid(doc, add({ type: 'midpointPoints', point: 'p1', a: 'p1', b: 'p3' }), /needs 3 different entities/);
    invalid(doc, add({ type: 'midpointPoints', point: 'q', a: 'l1', b: 'p3' }), /expected point/);
    invalid(doc, add({ type: 'midpointPoints', point: 'q', a: 'p1' } as never), /a string is expected/);
    // the distance of two lines: non-negative, 0 allowed, an axis of the origin as one of them
    expect(stored({ type: 'distanceLineLine', a: 'l1', b: 'l3', value: 30, driving: true })).toEqual({ type: 'distanceLineLine', a: 'l1', b: 'l3', value: 30, driving: true });
    expect(stored({ type: 'distanceLineLine', a: 'l1', b: 'l3', value: 0, driving: true })).toMatchObject({ value: 0 });
    expect(stored({ type: 'distanceLineLine', a: 'origin/x', b: 'l3', value: 30, driving: true })).toMatchObject({ a: 'origin/x', b: 'l3' });
    invalid(doc, add({ type: 'distanceLineLine', a: 'l1', b: 'l3', value: -1, driving: true }), /must not be negative/);
    invalid(doc, add({ type: 'distanceLineLine', a: 'l1', b: 'c', value: 5, driving: true }), /expected line/);
    invalid(doc, add({ type: 'distanceLineLine', a: 'l1', b: 'l1', value: 5, driving: true }), /two different entities/);
    invalid(doc, add({ type: 'distanceLineLine', a: 'origin/x', b: 'origin/y', value: 5, driving: true }), /only between fixed entities/);
    // the gap of a line and a circle: the line first, a circle or an arc second; a default of driving and an expression as for any dimension
    expect(stored({ type: 'distanceLineCircle', line: 'l1', curve: 'c', value: 11, driving: true })).toEqual({ type: 'distanceLineCircle', line: 'l1', curve: 'c', value: 11, driving: true });
    expect(stored({ type: 'distanceLineCircle', line: 'origin/y', curve: 'c', value: 0, driving: false })).toMatchObject({ line: 'origin/y', value: 0, driving: false });
    const loose = run(doc, { type: 'addConstraint', sketch: 'S1', id: 'k', constraint: { type: 'distanceLineCircle', line: 'l1', curve: 'c', value: '2 + 9' } } as Command);
    expect(sketchOf(loose).constraints.k).toMatchObject({ value: 11, driving: true });
    expect(sketchOf(loose).expressions).toEqual({ 'constraints/k/value': '2 + 9' });
    invalid(doc, add({ type: 'distanceLineCircle', line: 'l1', curve: 'l2', value: 5, driving: true }), /expected circle or arc/);
    invalid(doc, add({ type: 'distanceLineCircle', line: 'c', curve: 'c', value: 5, driving: true }), /expected line/);
    invalid(doc, add({ type: 'distanceLineCircle', line: 'l1', curve: 'c', value: -2, driving: true }), /must not be negative/);
    // duplicates: the order of the two points and of the two lines does not matter, the middle does; a parallel of the same lines is another constraint
    const twice = run(
      doc,
      add({ type: 'horizontalPoints', a: 'q', b: 'r' }, 'level'),
      add({ type: 'midpointPoints', point: 'q', a: 'p1', b: 'p3' }, 'mid'),
      add({ type: 'distanceLineLine', a: 'l1', b: 'l3', value: 30, driving: true }, 'apart'),
      add({ type: 'distanceLineCircle', line: 'l1', curve: 'c', value: 11, driving: true }, 'gap'),
    );
    invalid(twice, add({ type: 'horizontalPoints', a: 'r', b: 'q' }), /the same constraint is already in the sketch \("level"\)/);
    invalid(twice, add({ type: 'midpointPoints', point: 'q', a: 'p3', b: 'p1' }), /"mid"/);
    invalid(twice, add({ type: 'distanceLineLine', a: 'l3', b: 'l1', value: 12, driving: true }), /"apart"/);
    invalid(twice, add({ type: 'distanceLineCircle', line: 'l1', curve: 'c', value: 3, driving: true }), /"gap"/);
    run(twice, add({ type: 'verticalPoints', a: 'q', b: 'r' }, 'k1'), add({ type: 'midpointPoints', point: 'p1', a: 'q', b: 'p3' }, 'k2'), add({ type: 'parallel', a: 'l1', b: 'l3' }, 'k3'), add({ type: 'distanceLineLine', a: 'l1', b: 'l3', value: 30, driving: false }, 'k4'));
    // removing an operand takes the constraint with it
    expect(Object.keys(sketchOf(run(twice, { type: 'removeEntity', sketch: 'S1', id: 'c' })).constraints)).toEqual(['level', 'mid', 'apart']);
    expect(Object.keys(sketchOf(run(twice, { type: 'removeEntity', sketch: 'S1', id: 'r' })).constraints)).toEqual(['mid', 'apart', 'gap']);
  });

  it('the same driving constraint cannot be added twice; a reference dimension may sit beside a driving one', () => {
    const add = (id: string, constraint: Constraint): Command => ({ type: 'addConstraint', sketch: 'S1', id, constraint });
    const doc = run(base(), add('h', { type: 'horizontal', line: 'l1' }), add('par', { type: 'parallel', a: 'l1', b: 'l3' }), add('w', { type: 'horizontalDistance', a: 'p1', b: 'p2', value: 40, driving: true }));
    invalid(doc, add('h2', { type: 'horizontal', line: 'l1' }), /the same constraint is already in the sketch \("h"\)/);
    invalid(doc, add('par2', { type: 'parallel', a: 'l3', b: 'l1' }), /"par"/); // the order of the operands does not matter
    invalid(doc, add('w2', { type: 'horizontalDistance', a: 'p2', b: 'p1', value: -40, driving: true }), /"w"/);
    invalid(doc, add('w2', { type: 'horizontalDistance', a: 'p1', b: 'p2', value: 55, driving: true }), /"w"/); // another value: the existing one is the one to edit
    // another type or other operands are not duplicates
    run(doc, add('v', { type: 'vertical', line: 'l1' }), add('d', { type: 'distance', a: 'p1', b: 'p2', value: 40, driving: true }), add('par2', { type: 'parallel', a: 'l2', b: 'l4' }));
    // a reference dimension may measure the same thing; it must not become driving beside an existing driving one
    const measured = run(doc, add('ref', { type: 'horizontalDistance', a: 'p1', b: 'p2', value: 40, driving: false }), add('ref2', { type: 'horizontalDistance', a: 'p1', b: 'p2', value: 40, driving: false }));
    invalid(measured, { type: 'setConstraintValue', sketch: 'S1', id: 'ref', driving: true }, /the sketch already has the same driving dimension \("w"\)/);
    run(measured, { type: 'setConstraintValue', sketch: 'S1', id: 'w', value: 45 }); // editing itself is not a duplicate
    // a document with a duplicate (from an older version) loads
    const legacy = structuredClone(doc);
    sketchOf(legacy).constraints.h2 = { type: 'horizontal', line: 'l1' };
    expect(sketchOf(validateDocument(JSON.parse(JSON.stringify(legacy)))).constraints.h2).toEqual({ type: 'horizontal', line: 'l1' });
    // the value of a duplicate dimension from a loaded document can be changed; only switching to driving is guarded
    sketchOf(legacy).constraints.w2 = { type: 'horizontalDistance', a: 'p2', b: 'p1', value: -40, driving: true };
    const loaded = validateDocument(JSON.parse(JSON.stringify(legacy)));
    expect((sketchOf(run(loaded, { type: 'setConstraintValue', sketch: 'S1', id: 'w', value: 42 })).constraints.w as { value: number }).value).toBe(42);
    expect((sketchOf(run(loaded, { type: 'setConstraintValue', sketch: 'S1', id: 'w2', value: -42 })).constraints.w2 as { value: number }).value).toBe(-42);
    run(loaded, { type: 'setConstraintValue', sketch: 'S1', id: 'w2', driving: false });
  });

  it('dimension: a change of the value and switching to reference', () => {
    const doc = run(base(), { type: 'addConstraint', sketch: 'S1', id: 'w', constraint: { type: 'distance', a: 'p1', b: 'p2', value: 40, driving: true } }, { type: 'addConstraint', sketch: 'S1', id: 'h', constraint: { type: 'horizontal', line: 'l1' } });
    const next = run(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'w', value: 50 }, { type: 'setConstraintValue', sketch: 'S1', id: 'w', driving: false });
    expect(sketchOf(next).constraints.w).toEqual({ type: 'distance', a: 'p1', b: 'p2', value: 50, driving: false });
    invalid(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'w', value: -1 }, /must not be negative/);
    invalid(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'h', value: 1 }, /is not a dimension/);
    invalid(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'zzz', value: 1 }, /is not in the sketch/);
  });

  it('deleting cascades: a point takes its curves and constraints, a curve its constraints', () => {
    const doc = run(
      base(),
      { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p3' }, radius: 4 },
      { type: 'addConstraint', sketch: 'S1', id: 'k1', constraint: { type: 'horizontal', line: 'l1' } },
      { type: 'addConstraint', sketch: 'S1', id: 'k2', constraint: { type: 'coincident', a: 'p1', b: 'origin' } },
      { type: 'addConstraint', sketch: 'S1', id: 'k3', constraint: { type: 'tangent', a: 'c', b: 'l1' } },
      { type: 'addConstraint', sketch: 'S1', id: 'k4', constraint: { type: 'vertical', line: 'l2' } },
    );
    const noCurve = sketchOf(run(doc, { type: 'removeEntity', sketch: 'S1', id: 'l1' }));
    expect(Object.keys(noCurve.curves)).toEqual(['l2', 'l3', 'l4', 'c']);
    expect(Object.keys(noCurve.constraints)).toEqual(['k2', 'k4']);
    const noPoint = sketchOf(run(doc, { type: 'removeEntity', sketch: 'S1', id: 'p3' }));
    expect(Object.keys(noPoint.points)).toEqual(['p1', 'p2', 'p4']);
    expect(Object.keys(noPoint.curves)).toEqual(['l1', 'l4']);
    expect(noPoint.radii).toEqual({});
    expect(Object.keys(noPoint.constraints)).toEqual(['k1', 'k2']);
    // the curves in regions of a later extrude stay (the extrude ends in an error only at the recompute)
    expect(run(doc, { type: 'removeEntity', sketch: 'S1', id: 'l1' }).features[1]).toMatchObject({ profile: { regions: [{ outerLoop: expect.arrayContaining(['l1']) }] } });
    invalid(doc, { type: 'removeEntity', sketch: 'S1', id: 'origin' }, /cannot be deleted/);
    invalid(doc, { type: 'removeEntity', sketch: 'S1', id: 'k1' }, /cannot be deleted/);
    expect(Object.keys(sketchOf(run(doc, { type: 'removeConstraint', sketch: 'S1', id: 'k1' })).constraints)).toEqual(['k2', 'k3', 'k4']);
  });

  it('the construction flag and dragging', () => {
    const doc = base();
    const flagged = run(doc, { type: 'setConstruction', sketch: 'S1', id: 'l1', construction: true });
    expect(sketchOf(flagged).curves.l1).toEqual({ type: 'line', a: 'p1', b: 'p2', construction: true });
    expect(sketchOf(run(flagged, { type: 'setConstruction', sketch: 'S1', id: 'l1', construction: false })).curves.l1).toEqual({ type: 'line', a: 'p1', b: 'p2' });
    expect(run(doc, { type: 'dragPoint', sketch: 'S1', point: 'p3', x: 1, y: 2 })).toBe(doc);
    invalid(doc, { type: 'dragPoint', sketch: 'S1', point: 'origin', x: 1, y: 2 }, /cannot be dragged/);
    invalid(doc, { type: 'dragPoint', sketch: 'S1', point: 'p3', x: Infinity, y: 2 }, /finite number/);
    invalid(doc, { type: 'addPoint', sketch: 'E1', id: 'q', x: 0, y: 0 }, /is not a sketch/);
  });
});

describe('projected geometry', () => {
  const edge = { a: { feature: 'E1', role: 'side', curve: 'l2' }, b: { feature: 'E1', role: 'endCap' } } as const;
  const withSketch = () => run(base(), { type: 'addFeature', feature: emptySketch('S2', 'On the lid', { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'endCap' } }) }, { type: 'addPoint', sketch: 'S2', id: 'q', x: 5, y: 5 });

  it('the derived entities follow from the kind of projection and the edge name is stored in canonical form', () => {
    const doc = run(withSketch(), { type: 'addExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge, kind: 'line' } });
    expect((sketchOf(doc, 'S2').external.x1 as EdgeProjection).edge).toEqual({ a: edge.b, b: edge.a }); // E1/endCap < E1/side/l2
    const bound = run(doc, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'coincident', a: 'q', b: 'x1/a' } }, { type: 'addConstraint', sketch: 'S2', id: 'd', constraint: { type: 'distancePointLine', point: 'q', line: 'x1', value: 5, driving: true } });
    expect(Object.keys(sketchOf(bound, 'S2').constraints)).toEqual(['k', 'd']);
    invalid(doc, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'coincident', a: 'q', b: 'x1/center' } }, /is not in the sketch/);
    invalid(doc, { type: 'addCurve', sketch: 'S2', id: 'l', curve: { type: 'line', a: 'q', b: 'x1/a' } }, /is neither an own point/);
    invalid(doc, { type: 'removeEntity', sketch: 'S2', id: 'x1/a' }, /cannot be deleted/);
    invalid(doc, { type: 'dragPoint', sketch: 'S2', point: 'x1/a', x: 0, y: 0 }, /cannot be dragged/);
  });

  it('a driving constraint only between fixed entities is invalid, a reference dimension is valid', () => {
    const doc = run(withSketch(), { type: 'addExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge, kind: 'line' } });
    invalid(doc, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'horizontal', line: 'x1' } }, /would never take effect/);
    invalid(doc, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'distance', a: 'origin', b: 'x1/a', value: 3, driving: true } }, /would never take effect/);
    const ref = run(doc, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'distance', a: 'origin', b: 'x1/a', value: 3, driving: false } });
    invalid(ref, { type: 'setConstraintValue', sketch: 'S2', id: 'k', driving: true }, /would never take effect/);
  });

  it('updateExternal keeps the ID and must not change the kind; removeExternal takes the constraints', () => {
    const doc = run(withSketch(), { type: 'addExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge, kind: 'line' } }, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'coincident', a: 'q', b: 'x1/a' } }, { type: 'addConstraint', sketch: 'S2', id: 'k2', constraint: { type: 'coincident', a: 'q', b: 'origin' } });
    const other = { a: { feature: 'E1', role: 'side', curve: 'l3' }, b: { feature: 'E1', role: 'endCap' } } as const;
    const updated = run(doc, { type: 'updateExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge: other, kind: 'line' } });
    expect((sketchOf(updated, 'S2').external.x1 as EdgeProjection).edge.b).toEqual(other.a);
    expect(Object.keys(sketchOf(updated, 'S2').constraints)).toEqual(['k', 'k2']);
    invalid(doc, { type: 'updateExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge: other, kind: 'circle' } }, /the kind of a projection cannot be changed/);
    invalid(doc, { type: 'addExternal', sketch: 'S1', id: 'x2', ref: { type: 'edge', body: 'E1', edge, kind: 'line' } }, /must lie before/);
    invalid(doc, { type: 'addExternal', sketch: 'S2', id: 'x2', ref: { type: 'edge', body: 'E1', edge: { a: edge.a, b: edge.a }, kind: 'line' } }, /two different faces/);
    const removed = sketchOf(run(doc, { type: 'removeExternal', sketch: 'S2', id: 'x1' }), 'S2');
    expect(removed.external).toEqual({});
    expect(Object.keys(removed.constraints)).toEqual(['k2']);
  });
});

describe('batch', () => {
  it('is atomic and reports the index of the invalid command', () => {
    const doc = base();
    const batch: Command = {
      type: 'batch',
      commands: [
        { type: 'addPoint', sketch: 'S1', id: 'q1', x: 1, y: 1 },
        { type: 'addCurve', sketch: 'S1', id: 'n1', curve: { type: 'line', a: 'q1', b: 'p1' } }, // a reference to a point from the same batch
        { type: 'addCurve', sketch: 'S1', id: 'n2', curve: { type: 'line', a: 'q1', b: 'q9' } },
      ],
    };
    let error: unknown;
    try {
      applyCommand(doc, batch);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).commandIndex).toBe(2);
    const ok = run(doc, { type: 'batch', commands: (batch as Extract<Command, { type: 'batch' }>).commands.slice(0, 2) });
    expect(Object.keys(sketchOf(ok).curves)).toContain('n1');
    invalid(doc, { type: 'batch', commands: [{ type: 'dragPoint', sketch: 'S1', point: 'p1', x: 0, y: 0 }] }, /cannot be put in a batch/);
    invalid(doc, { type: 'explode' } as never, /unknown command/);
  });
});

describe('loading a document', () => {
  it('a document made by commands passes unchanged, even with a reference to a deleted feature', () => {
    const doc = run(
      base(),
      { type: 'addConstraint', sketch: 'S1', id: 'w', constraint: { type: 'distance', a: 'p1', b: 'p2', value: 40, driving: true } },
      { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p3' }, radius: 4 },
      { type: 'addFeature', feature: emptySketch('S2', 'x', { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'endCap' } }) },
      { type: 'addExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge: { a: { feature: 'E1', role: 'startCap' }, b: { feature: 'E1', role: 'endCap' } }, kind: 'circle' } },
    );
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const broken = run(doc, { type: 'removeFeature', id: 'S1' }, { type: 'removeFeature', id: 'E1' });
    expect(validateDocument(JSON.parse(JSON.stringify(broken)))).toEqual(broken);
  });

  it('an invalid document is refused', () => {
    const doc = JSON.parse(JSON.stringify(base()));
    const bad = (change: (d: any) => void, pattern: RegExp) => {
      const copy = JSON.parse(JSON.stringify(doc));
      change(copy);
      expect(() => validateDocument(copy)).toThrow(pattern);
    };
    bad((d) => (d.schemaVersion = 11), /the schema version 11 is newer than this build reads \(it saves 10\)/);
    bad((d) => (d.schemaVersion = 0), /the schema version 0 is not a version of the document/);
    bad((d) => delete d.schemaVersion, /the schema version undefined is not a version of the document/);
    bad((d) => (d.schemaVersion = '3'), /the schema version "3" is not a version of the document/);
    bad((d) => (d.schemaSteps = ['5b-export']), /this build has no upgrade step "5b-export" after version 10/);
    bad((d) => (d.settings.chordTolerance = 0), /must be positive/);
    bad((d) => (d.features[0].curves.l1.b = 'p9'), /is neither an own point/);
    bad((d) => (d.features[0].points.p1.x = null), /finite number/);
    bad((d) => (d.features[0].radii.l1 = 3), /is not a circle/);
    bad((d) => (d.features[0].constraints.k = { type: 'horizontal', line: 'p1' }), /expected line/);
    bad((d) => (d.features[0].solved.external.x9 = { kind: 'line', a: [0, 0], b: [1, 1] }), /does not match the projected geometry/);
    bad((d) => d.features.push({ ...d.features[1] }), /twice/);
    bad((d) => (d.features[1].extent.distance = 0), /must not be zero/);
    bad((d) => (d.features[1].extent.type = 'throughAll'), /throughAll is only for the operation cut/);
    bad((d) => (d.features[1].extent.type = 'upToFace'), /one of the values distance, throughAll/);
    bad((d) => (d.features[1].profile.type = 'generator'), /profile\.type: one of the values regions, generated/);
    bad((d) => d.parameters.push({ id: 'a', value: 1 }), /parameters\[0\].name/);
    bad((d) => d.parameters.push({ name: 'a', expr: '1 +' }), /the expression is incomplete/);
    bad((d) => d.parameters.push({ name: 'a', expr: '1' }, { name: 'a', expr: '2' }), /is in the list twice/);
    bad((d) => d.parameters.push({ name: 'pi', expr: '3' }), /name of a constant/);
    bad((d) => d.checks.push({ id: 'c', a: 1, relation: '<', b: 2 }), /checks\[0\].name/);
    bad((d) => d.checks.push({ name: 'c', expr: '1 + 2' }), /a comparison is expected/);
    bad((d) => (d.features[1].expressions = { 'extent/depth': '5' }), /is not a numeric field/);
    bad((d) => (d.features[1].expressions = { 'extent/distance': '5 *' }), /the expression is incomplete/);
    bad((d) => (d.features[1].extent.distance = '5'), /an expression belongs in expressions/);
    bad((d) => (d.features[1].type = 'loft'), /one of the values/);
    expect(() => validateDocument(null)).toThrow(/an object is expected/);
  });

  it('a document of version 1 is upgraded: an extrusion gets a profile, an extent and a list of targets', () => {
    const doc = run(base(), { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut', targets: ['E1'], extent: { type: 'distance', start: 0, distance: -4 } }) });
    const old = JSON.parse(JSON.stringify(doc));
    old.schemaVersion = 1;
    delete old.parameters;
    delete old.checks;
    old.features = old.features.map((f: any) => {
      if (f.type !== 'extrude') return f;
      const { profile, extent, targets, ...rest } = f;
      return { ...rest, sketch: profile.sketch, regions: profile.regions, distance: extent.distance, ...(targets ? { target: targets[0] } : {}) };
    });
    expect(validateDocument(old)).toEqual(doc);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    // version 1 had no parameters and checks; what is there anyway is not dropped silently by the upgrade
    expect(() => validateDocument({ ...old, parameters: [{ id: 'a', name: 'a', value: 1 }] })).toThrow(/parameters\[0\].expr/);
    expect(() => validateDocument({ ...old, checks: [{ id: 'c' }] })).toThrow(/checks\[0\].name/);
    expect(() => validateDocument({ ...old, parameters: 5 })).toThrow(/a list is expected/);
    // the shape of version 2 in version 1 and the other way round does not pass
    expect(() => validateDocument({ ...old, schemaVersion: 2, parameters: [], checks: [] })).toThrow(/profile/);
    expect(() => validateDocument({ ...JSON.parse(JSON.stringify(doc)), schemaVersion: 1 })).toThrow(/profile|sketch/);
    // a faulty feature in version 1 ends in a validation error, not an exception of the upgrade
    expect(() => validateDocument({ ...old, features: [null] })).toThrow(CommandError);
    expect(() => validateDocument({ ...old, features: 5 })).toThrow(/a list is expected/);
    expect(() => validateDocument({ ...old, features: [{ ...old.features[1], distance: 0 }] })).toThrow(/must not be zero/);
  });
});

describe('setCurvePoint (D52)', () => {
  // the rectangle of `base` with a circle, an arc and two free points
  const withCurves = (): Document =>
    run(
      base(),
      ...([['q1', 10, 10], ['q2', 20, 10], ['c', 50, 0], ['s', 55, 0], ['e', 50, 5]] as [string, number, number][]).map(([id, x, y]): Command => ({ type: 'addPoint', sketch: 'S1', id, x, y })),
      { type: 'addCurve', sketch: 'S1', id: 'k1', curve: { type: 'circle', center: 'c' }, radius: 3 },
      { type: 'addCurve', sketch: 'S1', id: 'k2', curve: { type: 'arc', center: 'c', start: 's', end: 'e', construction: true } },
    );
  const repoint = (id: string, point: string, to: string): Command => ({ type: 'setCurvePoint', sketch: 'S1', id, point, to }) as Command;

  it('every point of every kind of curve; the curve keeps its ID, kind, direction, flag and constraints', () => {
    let doc = run(withCurves(), { type: 'addConstraint', sketch: 'S1', id: 'h', constraint: { type: 'horizontal', line: 'l1' } });
    doc = run(doc, repoint('l1', 'a', 'q1'), repoint('l1', 'b', 'q2'));
    expect(sketchOf(doc).curves.l1).toEqual({ type: 'line', a: 'q1', b: 'q2' });
    expect(sketchOf(doc).constraints.h).toEqual({ type: 'horizontal', line: 'l1' });
    doc = run(doc, repoint('k1', 'center', 'q1'));
    expect(sketchOf(doc).curves.k1).toEqual({ type: 'circle', center: 'q1' });
    expect(sketchOf(doc).radii.k1).toBe(3);
    doc = run(doc, repoint('k2', 'center', 'origin'), repoint('k2', 'start', 'q2'), repoint('k2', 'end', 'p3'));
    expect(sketchOf(doc).curves.k2).toEqual({ construction: true, type: 'arc', center: 'origin', start: 'q2', end: 'p3' });
    // the old points stay, with nothing on them
    expect(Object.keys(sketchOf(doc).points)).toEqual(['p1', 'p2', 'p3', 'p4', 'q1', 'q2', 'c', 's', 'e']);
    // nothing is solved by the command: the positions are those of the document
    expect(sketchOf(doc).points).toEqual(sketchOf(withCurves()).points);
    // the document loads as it is
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('a name the kind of the curve does not have is invalid', () => {
    const doc = withCurves();
    invalid(doc, repoint('l1', 'center', 'q1'), /a line has the points a, b, not "center"/);
    invalid(doc, repoint('l1', 'start', 'q1'), /a line has the points a, b/);
    invalid(doc, repoint('k1', 'a', 'q1'), /a circle has the points center, not "a"/);
    invalid(doc, repoint('k2', 'b', 'q1'), /an? arc has the points center, start, end/);
    invalid(doc, repoint('l1', 'middle', 'q1'), /not "middle"/);
    invalid(doc, repoint('l1', 'constructor', 'q1'), /not "constructor"/);
  });

  it('refusals: no such curve, no such point, a point of another sketch or of projected geometry, a curve that would not be one', () => {
    const doc = run(withCurves(), { type: 'addFeature', feature: emptySketch('S2', 'Other', XY) }, { type: 'addPoint', sketch: 'S2', id: 'z', x: 0, y: 0 });
    invalid(doc, repoint('nope', 'a', 'q1'), /"nope" is not an own curve of the sketch/);
    invalid(doc, repoint('p1', 'a', 'q1'), /"p1" is not an own curve/);
    invalid(doc, repoint('l1', 'a', 'nope'), /"nope" is neither an own point of the sketch/);
    invalid(doc, repoint('l1', 'a', 'z'), /"z" is neither an own point of the sketch/);
    invalid(doc, repoint('l1', 'a', 'p2'), /two different points/); // both ends at one point
    invalid(doc, repoint('k2', 'start', 'e'), /three different points/);
    invalid(doc, repoint('k2', 'center', 's'), /three different points/);
    invalid(doc, { type: 'setCurvePoint', sketch: 'E1', id: 'l1', point: 'a', to: 'q1' }, /is not a sketch/);
  });

  it('a constraint the catalog would refuse afterwards makes the command invalid and is named', () => {
    // the midpoint of a line cannot be its end; the symmetric points cannot be ends of the axis
    const middle = run(withCurves(), { type: 'addConstraint', sketch: 'S1', id: 'mid', constraint: { type: 'midpoint', point: 'q1', line: 'l1' } });
    invalid(middle, repoint('l1', 'b', 'q1'), /the constraint "mid" on "l1" would not hold: the midpoint of a line cannot be its end/);
    const symmetric = run(withCurves(), { type: 'addConstraint', sketch: 'S1', id: 'sym', constraint: { type: 'symmetric', a: 'q1', b: 'q2', line: 'l3' } });
    invalid(symmetric, repoint('l3', 'a', 'q2'), /"sym" on "l3" would not hold: a symmetric point must not be an end of the axis/);
    // in a batch: the index of the command that failed
    expect(() => applyCommand(middle, { type: 'batch', commands: [{ type: 'addPoint', sketch: 'S1', id: 'x1', x: 0, y: 0 }, repoint('l1', 'b', 'q1')] })).toThrow(expect.objectContaining({ commandIndex: 1 }));
    // other constraints on the curve do not matter
    expect(sketchOf(run(symmetric, repoint('l1', 'a', 'q1'))).curves.l1).toEqual({ type: 'line', a: 'q1', b: 'p2' });
  });

  it('the point the curve has already is accepted and changes nothing', () => {
    const doc = withCurves();
    expect(applyCommand(doc, repoint('l1', 'a', 'p1'))).toBe(doc);
  });

  it('the stamp of the solved state no longer matches, as after any change of a curve', async () => {
    const { solverSetup } = await import('../src/sketch');
    const doc = withCurves();
    const next = run(doc, repoint('l1', 'a', 'q1'));
    expect(solverSetup(sketchOf(next), {}).stamp).not.toBe(solverSetup(sketchOf(doc), {}).stamp);
  });
});

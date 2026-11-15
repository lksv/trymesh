// D44 (package 2a of D36) at the document level (no recompute): the offset of a profile of regions,
// the first numeric field of a feature that may be absent, and the profile source `wall`.
import { describe, expect, it } from 'vitest';
import type { Command, Document, ExtrudeFeature, FeaturePatch, Input, PlaneRef, ProfileSource } from '../src/types';
import { FEATURE_TYPE_INFO, applyCommand, emptyDocument, emptySketch, featureInput, fieldsOf, validateDocument } from '../src/document';
import { faceKey } from '../src/face-roles';
import { FEATURE_TYPES } from '../src/features/index';
import { faceName } from '../src/validation';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const REGIONS: Extract<ProfileSource, { type: 'regions' }> = { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] };
const extrude = (id: string, profile: Input<ExtrudeFeature>['profile'] = REGIONS, extra: Partial<Input<ExtrudeFeature>> = {}): Input<ExtrudeFeature> => ({
  id,
  name: id,
  suppressed: false,
  type: 'extrude',
  profile,
  extent: { type: 'distance', start: 0, distance: 10 },
  operation: 'new',
  ...extra,
});
const add = (feature: Input<ExtrudeFeature>): Command => ({ type: 'addFeature', feature });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const invalid = (doc: Document, command: Command, pattern: RegExp) => expect(() => applyCommand(doc, command)).toThrow(pattern);
const feature = (doc: Document, id: string): ExtrudeFeature => doc.features.find((f) => f.id === id) as ExtrudeFeature;
const wall = (curves: string[], thickness: number | string = 2): Input<ExtrudeFeature>['profile'] => ({ type: 'wall', sketch: 'S1', curves, thickness });

// A sketch with a circle `c`, two joined lines `m` and `n` (the second a construction line), an arc
// `r`, the parameter `t`, the body A, and a second sketch with a line projected from A.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'setParameter', name: 't', expr: '3' },
    { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
    { type: 'addPoint', sketch: 'S1', id: 'p1', x: 20, y: 0 },
    { type: 'addPoint', sketch: 'S1', id: 'p2', x: 30, y: 0 },
    { type: 'addPoint', sketch: 'S1', id: 'p3', x: 30, y: 10 },
    { type: 'addCurve', sketch: 'S1', id: 'm', curve: { type: 'line', a: 'p1', b: 'p2' } },
    { type: 'addCurve', sketch: 'S1', id: 'n', curve: { type: 'line', a: 'p2', b: 'p3', construction: true } },
    { type: 'addCurve', sketch: 'S1', id: 'r', curve: { type: 'arc', center: 'p2', start: 'p1', end: 'p3' } },
    add(extrude('A')),
    { type: 'addFeature', feature: emptySketch('S2', 'S2', XY) },
    { type: 'addExternal', sketch: 'S2', id: 'x', ref: { type: 'edge', body: 'A', edge: { a: { feature: 'A', role: 'endCap' }, b: { feature: 'A', role: 'side', curve: 'c' } }, kind: 'circle' } },
  );
}

describe('the offset of a profile of regions', () => {
  it('is optional: absent it is not stored, given it is kept, also a zero', () => {
    const doc = run(base(), add(extrude('B')), add(extrude('C', { ...REGIONS, offset: -2 })), add(extrude('D', { ...REGIONS, offset: 0 })));
    expect(feature(doc, 'B').profile).toEqual(REGIONS);
    expect('offset' in feature(doc, 'B').profile).toBe(false);
    expect(feature(doc, 'C').profile).toEqual({ ...REGIONS, offset: -2 });
    expect(feature(doc, 'D').profile).toEqual({ ...REGIONS, offset: 0 });
    // the field is listed only while the feature has it
    expect(fieldsOf(feature(doc, 'B')).map((field) => field.path)).toEqual(['extent/start', 'extent/distance']);
    expect(fieldsOf(feature(doc, 'C'))[0]).toEqual({ path: 'profile/offset', spec: { title: 'Offset', unit: 'mm', default: 0 }, value: -2 });
    // a saved document loads to the same document
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('takes an expression like any numeric field', () => {
    const doc = run(base(), add(extrude('B', { ...REGIONS, offset: '-t / 2' })));
    expect(feature(doc, 'B').profile).toEqual({ ...REGIONS, offset: -1.5 });
    expect(feature(doc, 'B').expressions).toEqual({ 'profile/offset': '-t / 2' });
    expect(featureInput(feature(doc, 'B')).profile).toEqual({ ...REGIONS, offset: '-t / 2' });
    invalid(base(), add(extrude('B', { ...REGIONS, offset: 'nope * 2' })), /profile\.offset: expression "nope \* 2"/);
    invalid(base(), add(extrude('B', { ...REGIONS, offset: Infinity })), /profile\.offset/);
    // an expression for the field of a feature that does not have it is refused, as for any address
    invalid(base(), add(extrude('B', REGIONS, { expressions: { 'profile/offset': 't' } })), /"profile\/offset" is not a numeric field of this feature/);
  });

  it('setField gives it to a feature that did not have it, and changes it', () => {
    const doc = run(base(), add(extrude('B')));
    const set = run(doc, { type: 'setField', feature: 'B', path: 'profile/offset', value: '-t' });
    expect(feature(set, 'B').profile).toEqual({ ...REGIONS, offset: -3 });
    expect(feature(set, 'B').expressions).toEqual({ 'profile/offset': '-t' });
    const number = run(set, { type: 'setField', feature: 'B', path: 'profile/offset', value: 1.5 });
    expect(feature(number, 'B').profile).toEqual({ ...REGIONS, offset: 1.5 });
    expect(feature(number, 'B').expressions).toBeUndefined();
    // the other fields and their expressions stay
    const kept = run(doc, { type: 'setField', feature: 'B', path: 'extent/distance', value: 't * 2' }, { type: 'setField', feature: 'B', path: 'profile/offset', value: 1 });
    expect(feature(kept, 'B').expressions).toEqual({ 'extent/distance': 't * 2' });
    expect(feature(kept, 'B').extent).toEqual({ type: 'distance', start: 0, distance: 6 });
  });

  it('setField reaches only an optional field of the variant the feature has', () => {
    const doc = run(base(), add(extrude('W', wall(['m']))), add(extrude('B')));
    // a wall has no offset, a profile of regions no thickness; a required field is never added
    invalid(doc, { type: 'setField', feature: 'W', path: 'profile/offset', value: 1 }, /"profile\/offset" is not a numeric field of feature "W"/);
    invalid(doc, { type: 'setField', feature: 'B', path: 'profile/thickness', value: 1 }, /"profile\/thickness" is not a numeric field of feature "B"/);
    invalid(doc, { type: 'setField', feature: 'B', path: 'profile/params/module', value: 1 }, /is not a numeric field/);
    invalid(doc, { type: 'setField', feature: 'B', path: 'profile/ofset', value: 1 }, /is not a numeric field/);
    invalid(doc, { type: 'setField', feature: 'S1', path: 'profile/offset', value: 1 }, /is not a numeric field/);
    // the registry says which fields may be absent: those whose description has a default
    const optional = FEATURE_TYPE_INFO.extrude.fields.filter((field) => field.spec.default !== undefined && !field.path.startsWith('profile/params/'));
    expect(optional.map((field) => [field.path, field.when])).toEqual([['profile/offset', { path: 'profile/type', equals: 'regions' }]]);
  });

  it('updateFeature sets it, changes it and removes it, also from a feature that did not have it', () => {
    const doc = run(base(), add(extrude('B')));
    const set = run(doc, update('B', { profile: { offset: 't' } }));
    expect(feature(set, 'B').profile).toEqual({ ...REGIONS, offset: 3 });
    expect(feature(set, 'B').expressions).toEqual({ 'profile/offset': 't' });
    const changed = run(set, update('B', { profile: { offset: -2.5 } }));
    expect(feature(changed, 'B').profile).toEqual({ ...REGIONS, offset: -2.5 });
    expect(feature(changed, 'B').expressions).toBeUndefined();
    for (const from of [set, changed, doc]) {
      const removed = run(from, update('B', { profile: { offset: null } }));
      expect(feature(removed, 'B').profile).toEqual(REGIONS);
      expect(feature(removed, 'B').expressions).toBeUndefined();
    }
    // a typo is still a typo
    invalid(doc, update('B', { profile: { ofset: null } } as never), /profile\.ofset/);
    invalid(doc, update('B', { profile: { ofset: 1 } } as never), /a profile of the type regions has no such field/);
  });

  it('only a profile of regions has it', () => {
    const doc = base();
    invalid(doc, add(extrude('W', { ...wall(['m']), offset: 1 } as never)), /profile\.offset: a profile of the type wall has no such field/);
    invalid(doc, add(extrude('G', { type: 'generated', generator: 'involuteGear', sketch: 'S1', operands: { circle: 'c' }, params: { teeth: 12 }, offset: 1 } as never)), /profile\.offset: a profile of the type generated has no such field/);
    const walled = run(doc, add(extrude('W', wall(['m']))));
    invalid(walled, update('W', { profile: { offset: 1 } } as never), /a profile of the type wall has no such field/);
    invalid(walled, update('W', { profile: { offset: null } } as never), /profile\.offset/);
  });
});

describe('the profile source wall', () => {
  it('takes own curves of the sketch, construction or not, and stores them sorted without duplicates', () => {
    const doc = run(base(), add(extrude('W', wall(['n', 'm', 'n'], 't / 2'))));
    expect(feature(doc, 'W').profile).toEqual({ type: 'wall', sketch: 'S1', curves: ['m', 'n'], thickness: 1.5 });
    expect(feature(doc, 'W').expressions).toEqual({ 'profile/thickness': 't / 2' });
    expect(fieldsOf(feature(doc, 'W'))[0]).toMatchObject({ path: 'profile/thickness', value: 1.5, expr: 't / 2', spec: { unit: 'mm', min: { value: 0, open: true } } });
    expect(feature(run(base(), add(extrude('W', wall(['r', 'c'])))), 'W').profile).toMatchObject({ curves: ['c', 'r'] });
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('refuses what is not a curve of its sketch, an empty list and a thickness that is not positive', () => {
    const doc = base();
    invalid(doc, add(extrude('W', wall([]))), /profile\.curves: a non-empty list of curve IDs is expected/);
    invalid(doc, add(extrude('W', wall(['nope']))), /profile\.curves: the sketch "S1" has no entity "nope"/);
    invalid(doc, add(extrude('W', wall(['p1']))), /profile\.curves: "p1" is a point, expected line or arc or circle/);
    invalid(doc, add(extrude('W', wall(['m'], 0))), /profile\.thickness/);
    invalid(doc, add(extrude('W', wall(['m'], -1))), /profile\.thickness/);
    invalid(doc, add(extrude('W', { type: 'wall', sketch: 'S1', curves: ['m'] } as never)), /profile\.thickness/);
    invalid(doc, add(extrude('W', { ...wall(['m']), regions: [] } as never)), /profile\.regions: a profile of the type wall has no such field/);
    // projected geometry is not an own curve: the ends of a wall are named by sketch points
    invalid(doc, add(extrude('W', { type: 'wall', sketch: 'S2', curves: ['x'], thickness: 2 })), /profile\.curves: "x" is projected geometry; an own line or arc or circle of the sketch "S2" is expected/);
  });

  it('a patch verifies the curves the feature did not have; a curve removed from the sketch later loads', () => {
    const doc = run(base(), add(extrude('W', wall(['m']))));
    expect(feature(run(doc, update('W', { profile: { curves: ['n', 'm'] } })), 'W').profile).toMatchObject({ curves: ['m', 'n'] });
    invalid(doc, update('W', { profile: { curves: ['m', 'nope'] } }), /profile\.curves: the sketch "S1" has no entity "nope"/);
    expect(feature(run(doc, update('W', { profile: { thickness: 't' } })), 'W').profile).toMatchObject({ thickness: 3 });
    // another type replaces the profile and has to be complete
    expect(feature(run(doc, update('W', { profile: { ...REGIONS, offset: 1 } })), 'W').profile).toEqual({ ...REGIONS, offset: 1 });
    invalid(doc, update('W', { profile: { type: 'regions' } } as never), /profile\.sketch/);
    const gone = run(doc, { type: 'removeEntity', sketch: 'S1', id: 'm' });
    expect(feature(gone, 'W').profile).toMatchObject({ curves: ['m'] });
    expect(validateDocument(JSON.parse(JSON.stringify(gone)))).toEqual(gone);
    // the broken reference is not checked again by a patch that leaves it alone
    expect(feature(run(gone, update('W', { profile: { thickness: 4 } })), 'W').profile).toMatchObject({ curves: ['m'], thickness: 4 });
  });

  it('its references: the sketch and every curve, as entities that are not projected', () => {
    const doc = run(base(), add(extrude('W', wall(['m', 'n']))));
    expect(FEATURE_TYPES.extrude.refs(feature(doc, 'W'))).toEqual([
      { path: 'profile/sketch', id: 'S1', kind: 'sketch' },
      { path: 'profile/curves', id: 'm', kind: 'entity', sketch: 'S1', accepts: ['line', 'arc', 'circle'], notProjected: true },
      { path: 'profile/curves', id: 'n', kind: 'entity', sketch: 'S1', accepts: ['line', 'arc', 'circle'], notProjected: true },
    ]);
  });

  it('the names of its faces: a side by its curve and the side of the curve, an end by its point', () => {
    expect(faceName({ feature: 'W', role: 'wallSide', curve: 'm', side: 'left' }, 'face')).toEqual({ feature: 'W', role: 'wallSide', curve: 'm', side: 'left' });
    expect(faceKey({ feature: 'W', role: 'wallSide', curve: 'm', side: 'left' })).toBe('W/wallSide/m/left');
    expect(faceKey({ feature: 'W', role: 'wallEnd', point: 'p1' })).toBe('W/wallEnd/p1');
    expect(() => faceName({ feature: 'W', role: 'wallSide', curve: 'm' }, 'face')).toThrow(/face\.side/);
    expect(() => faceName({ feature: 'W', role: 'wallEnd' }, 'face')).toThrow(/face\.point/);
    // a side that is neither left nor right is a well-formed name of a face that does not exist
    expect(faceName({ feature: 'W', role: 'wallSide', curve: 'm', side: 'top' }, 'face')).toMatchObject({ side: 'top' });
  });
});

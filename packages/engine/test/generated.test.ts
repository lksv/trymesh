// D35 point 3 at the document level (no recompute): an extrusion whose profile comes from a profile
// generator. Validation follows the generator catalog; updateFeature merges the dictionaries.
import { describe, expect, it } from 'vitest';
import type { Command, Document, ExtrudeFeature, FeaturePatch, Input, PlaneRef, ProfileSource } from '../src/types';
import { CommandError, FEATURE_TYPE_INFO, applyCommand, emptyDocument, emptySketch, featureInput, featureRefs, fieldsOf, validateDocument } from '../src/document';
import { GENERATORS, MAX_TEETH } from '../src/generators';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const DEG = Math.PI / 180;
type Generated = Extract<ProfileSource, { type: 'generated' }>;
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const gearProfile = (circle: string, params: Record<string, unknown> = { teeth: 18 }, extra: object = {}): Input<ProfileSource> => ({ type: 'generated', generator: 'involuteGear', sketch: 'S1', operands: { circle }, params, ...extra }) as Input<ProfileSource>;
const extrude = (id: string, profile: Input<ProfileSource>, extra: Partial<Input<ExtrudeFeature>> = {}): Input<ExtrudeFeature> => ({ id, name: id, suppressed: false, type: 'extrude', profile, extent: { type: 'distance', start: 0, distance: 8 }, operation: 'new', ...extra });
const add = (feature: Input<ExtrudeFeature>, index?: number): Command => ({ type: 'addFeature', feature, ...(index === undefined ? {} : { index }) });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const invalid = (doc: Document, command: Command, pattern: RegExp) => expect(() => applyCommand(doc, command)).toThrow(pattern);
const feature = (doc: Document, id: string): ExtrudeFeature => doc.features.find((f) => f.id === id) as ExtrudeFeature;
const profileOf = (doc: Document, id: string): Generated => feature(doc, id).profile as Generated;
const rejected = (doc: Document, command: Command): CommandError => {
  try {
    applyCommand(doc, command);
  } catch (error) {
    if (error instanceof CommandError) return error;
    throw error;
  }
  throw new Error('the command should have been rejected');
};

// A sketch with two construction pitch circles `s` and `p`, an ordinary circle `c`, a line `l`, and the
// parameters Zs, Zp and backlash.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'setParameter', name: 'Zs', expr: '18' },
    { type: 'setParameter', name: 'Zp', expr: '27' },
    { type: 'setParameter', name: 'backlash', expr: '0.05' },
    { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
    { type: 'addPoint', sketch: 'S1', id: 'cp', x: 20.25, y: 0 },
    { type: 'addCurve', sketch: 'S1', id: 's', curve: { type: 'circle', center: 'origin', construction: true }, radius: 8.1 },
    { type: 'addCurve', sketch: 'S1', id: 'p', curve: { type: 'circle', center: 'cp', construction: true }, radius: 12.15 },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'cp' }, radius: 2 },
    { type: 'addCurve', sketch: 'S1', id: 'l', curve: { type: 'line', a: 'origin', b: 'cp' } },
  );
}

describe('an extrusion with a generated profile', () => {
  it('follows the catalog: defaults are filled in and stored, the order is canonical', () => {
    const doc = run(base(), add(extrude('sun', gearProfile('s'))));
    expect(feature(doc, 'sun')).toEqual({
      ...extrude('sun', gearProfile('s')),
      profile: { type: 'generated', generator: 'involuteGear', sketch: 'S1', operands: { circle: 's' }, params: { teeth: 18, pressureAngle: 20 * DEG, backlash: 0, rotation: 0, internal: false } },
    });
    // every parameter given, in another order; a reference to an earlier gear
    const full = run(doc, add(extrude('planet', gearProfile('p', { internal: false, rotation: 0.2, backlash: 0.05, pressureAngle: 25 * DEG, teeth: 27 }, { refs: { meshWith: 'sun' } }))));
    expect(profileOf(full, 'planet')).toEqual({ type: 'generated', generator: 'involuteGear', sketch: 'S1', operands: { circle: 'p' }, params: { teeth: 27, pressureAngle: 25 * DEG, backlash: 0.05, rotation: 0.2, internal: false }, refs: { meshWith: 'sun' } });
    expect(Object.keys(profileOf(full, 'planet').params)).toEqual(Object.keys(GENERATORS.involuteGear.params));
    expect(featureRefs(feature(full, 'planet'))).toEqual(['S1', 'sun']);
    // an empty dictionary of references is the same as none
    expect(profileOf(run(doc, add(extrude('planet', gearProfile('p', { teeth: 27 }, { refs: {} })))), 'planet')).not.toHaveProperty('refs');
    // the document loads unchanged
    expect(validateDocument(JSON.parse(JSON.stringify(full)))).toEqual(full);
  });

  it('parameters: ranges, required ones, flags and unknown names', () => {
    const doc = base();
    const bad = (params: Record<string, unknown>, pattern: RegExp) => invalid(doc, add(extrude('g', gearProfile('s', params))), pattern);
    bad({}, /params\.teeth: the parameter is required/);
    bad({ teeth: 3 }, /params\.teeth: the value 3 is not/);
    bad({ teeth: MAX_TEETH + 1 }, /params\.teeth: the value 501 is not/);
    bad({ teeth: 18.5 }, /params\.teeth: the value 18\.5 is not an integer/);
    bad({ teeth: 18, pressureAngle: 20 }, /params\.pressureAngle: the value 20 is not in the interval \(0, π\/2\)/); // degrees by mistake
    bad({ teeth: 18, pressureAngle: 0 }, /params\.pressureAngle/);
    bad({ teeth: 18, backlash: -0.1 }, /params\.backlash: the value must not be negative/);
    bad({ teeth: 18, internal: 'yes' }, /params\.internal: čeká se true nebo false/);
    bad({ teeth: 18, internal: 1 }, /params\.internal/);
    bad({ teeth: 18, helix: 0.2 }, /params\.helix: the generator involuteGear has no such entry/);
    bad({ teeth: 18, toString: 1 }, /params\.toString: the generator involuteGear has no such entry/);
    bad({ teeth: true }, /params\.teeth: čeká se konečné číslo/);
    expect(profileOf(run(doc, add(extrude('g', gearProfile('s', { teeth: 4, internal: true, rotation: -7 })))), 'g').params).toMatchObject({ teeth: 4, internal: true, rotation: -7 });
    expect(profileOf(run(doc, add(extrude('g', gearProfile('s', { teeth: 18.0000000001 })))), 'g').params.teeth).toBe(18);
  });

  it('the shape of the profile: generator, operands and references by the names of the catalog', () => {
    const doc = run(base(), add(extrude('sun', gearProfile('s'))), add(extrude('disc', { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] })));
    const bad = (profile: object, pattern: RegExp) => invalid(doc, add(extrude('g', profile as Input<ProfileSource>)), pattern);
    const good = { type: 'generated', generator: 'involuteGear', sketch: 'S1', operands: { circle: 'p' }, params: { teeth: 27 } };
    bad({ ...good, generator: 'cycloid' }, /profile\.generator: čeká se jedna z hodnot involuteGear/);
    bad({ ...good, generator: undefined }, /profile\.generator/);
    bad({ ...good, sketch: 'S9' }, /profile\.sketch: feature "S9" neexistuje/);
    bad({ ...good, sketch: 'sun' }, /není skica/);
    bad({ ...good, operands: {} }, /profile\.operands\.circle: čeká se řetězec/);
    bad({ ...good, operands: undefined }, /profile\.operands: čeká se objekt/);
    bad({ ...good, operands: { circle: 'p', other: 's' } }, /profile\.operands\.other: the generator involuteGear has no such entry/);
    bad({ ...good, operands: { circle: 'nope' } }, /profile\.operands\.circle: the sketch "S1" has no entity "nope"/);
    bad({ ...good, operands: { circle: 'l' } }, /profile\.operands\.circle: "l" is a line, expected circle/);
    bad({ ...good, operands: { circle: 'cp' } }, /"cp" is a point, expected circle/);
    bad({ ...good, params: undefined }, /profile\.params: čeká se objekt/);
    bad({ ...good, refs: { meshWith: 'nope' } }, /profile\.refs\.meshWith: feature "nope" neexistuje/);
    bad({ ...good, refs: { meshWith: 'disc' } }, /feature "disc" is not an extrusion with a profile from the generator involuteGear/);
    bad({ ...good, refs: { meshWith: 'S1' } }, /is not an extrusion with a profile from the generator involuteGear/);
    bad({ ...good, refs: { gear: 'sun' } }, /profile\.refs\.gear: the generator involuteGear has no such entry/);
    bad({ ...good, refs: { meshWith: 5 } }, /profile\.refs\.meshWith: čeká se řetězec/);
    // the reference must lie before the feature
    invalid(doc, add(extrude('g', { ...good, refs: { meshWith: 'sun' } } as Input<ProfileSource>), 1), /musí ležet před odkazující feature/);
    // an ordinary (not construction) circle is an operand as well
    expect(profileOf(run(doc, add(extrude('g', gearProfile('c', { teeth: 8 })))), 'g').operands).toEqual({ circle: 'c' });
    // a field of the other variant is dropped by validation on creation, like any unknown field
    expect(profileOf(run(doc, add(extrude('g', { ...good, regions: [{ outerLoop: ['c'] }] } as never))), 'g')).not.toHaveProperty('regions');
  });

  it('a gear refers to its mate: moving and removing features respects the reference', () => {
    const doc = run(base(), add(extrude('sun', gearProfile('s'))), add(extrude('planet', gearProfile('p', { teeth: 27 }, { refs: { meshWith: 'sun' } }))));
    invalid(doc, { type: 'moveFeature', id: 'planet', index: 1 }, /by se dostala před feature "sun"/);
    invalid(doc, { type: 'moveFeature', id: 'sun', index: 2 }, /by se dostala za feature "planet"/);
    // removing does not cascade; the document with the broken reference loads
    const broken = run(doc, { type: 'removeFeature', id: 'sun' }, { type: 'removeEntity', sketch: 'S1', id: 'p' });
    expect(profileOf(broken, 'planet')).toMatchObject({ operands: { circle: 'p' }, refs: { meshWith: 'sun' } });
    expect(validateDocument(JSON.parse(JSON.stringify(broken)))).toEqual(broken);
  });

  it('numeric parameters are numeric fields: expressions, fieldsOf, setField and the input form', () => {
    const doc = run(base(), add(extrude('planet', gearProfile('p', { teeth: 'Zp', backlash: 'backlash', pressureAngle: 'deg(20)' }))));
    expect(feature(doc, 'planet')).toMatchObject({
      profile: { params: { teeth: 27, pressureAngle: expect.closeTo(20 * DEG, 12), backlash: 0.05, rotation: 0, internal: false } },
      expressions: { 'profile/params/backlash': 'backlash', 'profile/params/pressureAngle': 'deg(20)', 'profile/params/teeth': 'Zp' },
    });
    expect(fieldsOf(feature(doc, 'planet')).map(({ path, value, expr }) => [path, value, expr])).toEqual([
      ['profile/params/teeth', 27, 'Zp'],
      ['profile/params/pressureAngle', expect.closeTo(20 * DEG, 12), 'deg(20)'],
      ['profile/params/backlash', 0.05, 'backlash'],
      ['profile/params/rotation', 0, undefined],
      ['extent/start', 0, undefined],
      ['extent/distance', 8, undefined],
    ]);
    // the static catalog lists the same fields for the generator
    const listed = FEATURE_TYPE_INFO.extrude.fields.filter((field) => field.when?.path === 'profile/generator' && field.when.equals === 'involuteGear');
    expect(listed.map((field) => [field.path, field.spec])).toEqual(Object.entries(GENERATORS.involuteGear.params).filter(([, spec]) => !('flag' in spec)).map(([name, spec]) => [`profile/params/${name}`, spec]));
    // the input form puts the expressions back and creates the same feature
    const input = featureInput(feature(doc, 'planet'));
    expect(input.profile).toMatchObject({ params: { teeth: 'Zp', backlash: 'backlash', pressureAngle: 'deg(20)', rotation: 0, internal: false } });
    expect(feature(run(run(doc, { type: 'removeFeature', id: 'planet' }), add(input)), 'planet')).toEqual(feature(doc, 'planet'));
    // setField: a number removes the expression, a string sets one; a flag is not a numeric field
    const fixed = run(doc, { type: 'setField', feature: 'planet', path: 'profile/params/teeth', value: 30 });
    expect(feature(fixed, 'planet')).toMatchObject({ profile: { params: { teeth: 30 } }, expressions: { 'profile/params/backlash': 'backlash' } });
    expect(feature(fixed, 'planet').expressions).not.toHaveProperty('profile/params/teeth');
    expect(feature(run(doc, { type: 'setField', feature: 'planet', path: 'profile/params/rotation', value: 'deg(5)' }), 'planet')).toMatchObject({ profile: { params: { rotation: expect.closeTo(5 * DEG, 12) } }, expressions: { 'profile/params/rotation': 'deg(5)' } });
    invalid(doc, { type: 'setField', feature: 'planet', path: 'profile/params/internal', value: 1 }, /is not a numeric field/);
    invalid(doc, { type: 'setField', feature: 'planet', path: 'profile/params/teeth', value: 2 }, /the value 2 is not/);
    // an expression out of range or with an unknown name is an invalid command with a structured error
    expect(rejected(doc, add(extrude('g', gearProfile('s', { teeth: 'Zs / 7' })))).expression).toMatchObject({ path: 'profile/params/teeth', error: { code: 'notInteger' } });
    expect(rejected(doc, add(extrude('g', gearProfile('s', { teeth: 'Zx' })))).expression).toMatchObject({ path: 'profile/params/teeth', error: { code: 'unknownName' } });
    // an expression for a flag or for an unknown address is rejected
    invalid(doc, add(extrude('g', gearProfile('s', { teeth: 18 }), { expressions: { 'profile/params/internal': '1' } })), /"profile\/params\/internal" is not a numeric field/);
    // renaming a parameter rewrites the expressions
    expect(feature(run(doc, { type: 'renameParameter', name: 'Zp', to: 'planetTeeth' }), 'planet').expressions).toMatchObject({ 'profile/params/teeth': 'planetTeeth' });
  });
});

describe('updateFeature on a generated profile', () => {
  const gears = (): Document => run(base(), add(extrude('sun', gearProfile('s', { teeth: 'Zs', backlash: 'backlash' }))), add(extrude('planet', gearProfile('p', { teeth: 'Zp', backlash: 'backlash', rotation: 'deg(3)' }, { refs: { meshWith: 'sun' } }))));

  it('dictionaries merge by entry: the other parameters keep their values and expressions', () => {
    const doc = gears();
    const turned = run(doc, update('planet', { profile: { params: { rotation: 'deg(5)' } } }));
    expect(feature(turned, 'planet')).toMatchObject({
      profile: { params: { teeth: 27, backlash: 0.05, rotation: expect.closeTo(5 * DEG, 12) }, operands: { circle: 'p' }, refs: { meshWith: 'sun' } },
      expressions: { 'profile/params/backlash': 'backlash', 'profile/params/rotation': 'deg(5)', 'profile/params/teeth': 'Zp' },
    });
    // a number removes the expression of that parameter only; a flag changes alone
    const plain = run(doc, update('planet', { profile: { params: { teeth: 30, internal: true } } }));
    expect(feature(plain, 'planet')).toMatchObject({ profile: { params: { teeth: 30, internal: true, backlash: 0.05 } }, expressions: { 'profile/params/backlash': 'backlash', 'profile/params/rotation': 'deg(3)' } });
    expect(feature(plain, 'planet').expressions).not.toHaveProperty('profile/params/teeth');
    // an operand changes alone
    expect(profileOf(run(doc, update('planet', { profile: { operands: { circle: 'c' } } })), 'planet')).toMatchObject({ operands: { circle: 'c' }, params: { teeth: 27 }, refs: { meshWith: 'sun' } });
    // the extent and the profile in one patch
    expect(feature(run(doc, update('planet', { extent: { distance: 12 }, profile: { params: { backlash: 0 } } })), 'planet')).toMatchObject({ extent: { start: 0, distance: 12 }, profile: { params: { backlash: 0, teeth: 27 } } });
  });

  it('null removes an entry: a parameter returns to its default, a reference ceases to exist', () => {
    const doc = gears();
    const reset = run(doc, update('planet', { profile: { params: { rotation: null, backlash: null } } }));
    expect(profileOf(reset, 'planet').params).toMatchObject({ rotation: 0, backlash: 0, teeth: 27 });
    expect(feature(reset, 'planet').expressions).toEqual({ 'profile/params/teeth': 'Zp' });
    invalid(doc, update('planet', { profile: { params: { teeth: null } } }), /params\.teeth: the parameter is required/);
    expect(profileOf(run(doc, update('planet', { profile: { params: { internal: null } } })), 'planet').params.internal).toBe(false);
    const free = run(doc, update('planet', { profile: { refs: { meshWith: null } } }));
    expect(profileOf(free, 'planet')).not.toHaveProperty('refs');
    expect(featureRefs(feature(free, 'planet'))).toEqual(['S1']);
    expect(profileOf(run(doc, update('planet', { profile: { refs: null } })), 'planet')).not.toHaveProperty('refs');
    // removing an entry that is not there is not an error: a form sends null for every reference it does not have
    expect(profileOf(run(free, update('planet', { profile: { refs: { meshWith: null } } })), 'planet')).not.toHaveProperty('refs');
    expect(profileOf(run(doc, update('sun', { profile: { ...gearProfile('s', { teeth: 20 }), refs: { meshWith: null } } as never })), 'sun')).toMatchObject({ params: { teeth: 20 } });
    const disc = run(doc, update('planet', { profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] } }));
    expect(profileOf(run(disc, update('planet', { profile: { ...gearProfile('p', { teeth: 27 }), refs: { meshWith: null } } as never })), 'planet')).not.toHaveProperty('refs');
    // and back
    expect(profileOf(run(free, update('planet', { profile: { refs: { meshWith: 'sun' } } })), 'planet').refs).toEqual({ meshWith: 'sun' });
    invalid(doc, update('planet', { profile: { operands: { circle: null } } }), /operands\.circle: čeká se řetězec/);
  });

  it('another source or another generator replaces the profile and drops its expressions', () => {
    const doc = gears();
    const disc = run(doc, update('planet', { profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] } }));
    expect(feature(disc, 'planet').profile).toEqual({ type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] });
    expect(feature(disc, 'planet')).not.toHaveProperty('expressions');
    expect(featureRefs(feature(disc, 'planet'))).toEqual(['S1']);
    // back to a gear: the new variant must be complete
    invalid(disc, update('planet', { profile: { type: 'generated', generator: 'involuteGear' } } as FeaturePatch), /profile\.sketch/);
    invalid(disc, update('planet', { profile: { generator: 'involuteGear', sketch: 'S1', operands: { circle: 'p' }, params: { teeth: 27 } } } as FeaturePatch), /profile\.type/);
    const again = run(disc, update('planet', { profile: gearProfile('p', { teeth: 'Zp' }) as never }));
    expect(feature(again, 'planet')).toMatchObject({ profile: { type: 'generated', params: { teeth: 27, rotation: 0 } }, expressions: { 'profile/params/teeth': 'Zp' } });
    // the same variant repeated with every field merges and keeps what the patch does not mention
    const same = run(doc, update('planet', { profile: { type: 'generated', generator: 'involuteGear', params: { teeth: 30 } } }));
    expect(feature(same, 'planet')).toMatchObject({ profile: { params: { teeth: 30, backlash: 0.05 }, refs: { meshWith: 'sun' } }, expressions: { 'profile/params/backlash': 'backlash' } });
    // a field of the other variant is a mistake, not a silent success
    invalid(doc, update('planet', { profile: { regions: [{ outerLoop: ['c'] }] } } as FeaturePatch), /profile\.regions: vysunutí takové pole nemá/);
    invalid(disc, update('planet', { profile: { params: { teeth: 5 } } } as FeaturePatch), /profile\.params\.teeth: vysunutí takové pole nemá/);
    invalid(doc, update('planet', { profile: { params: { helix: 1 } } } as FeaturePatch), /params\.helix: the generator involuteGear has no such entry/);
  });

  it('verifies only the references the feature did not have before', () => {
    // the planet has a broken operand and a broken mate
    const doc = run(gears(), { type: 'removeFeature', id: 'sun' }, { type: 'removeEntity', sketch: 'S1', id: 'p' });
    expect(feature(run(doc, update('planet', { profile: { params: { teeth: 30 } } })), 'planet')).toMatchObject({ profile: { params: { teeth: 30 }, operands: { circle: 'p' }, refs: { meshWith: 'sun' } } });
    // a whole feature in the input form repeats the broken references and passes
    const input = featureInput(feature(doc, 'planet'));
    expect(feature(run(doc, update('planet', { profile: input.profile, extent: input.extent, operation: 'new' })), 'planet')).toEqual(feature(doc, 'planet'));
    // fixing one does not trip over the other; a new one is verified
    expect(profileOf(run(doc, update('planet', { profile: { operands: { circle: 'c' } } })), 'planet')).toMatchObject({ operands: { circle: 'c' }, refs: { meshWith: 'sun' } });
    invalid(doc, update('planet', { profile: { operands: { circle: 'l' } } }), /updateFeature\.patch\.profile\.operands\.circle: "l" is a line, expected circle/);
    invalid(doc, update('planet', { profile: { operands: { circle: 'gone' } } }), /the sketch "S1" has no entity "gone"/);
    invalid(doc, update('planet', { profile: { refs: { meshWith: 'planet' } } }), /musí ležet před odkazující feature/);
    // the same entity ID in another sketch is another reference
    const other = run(doc, { type: 'addFeature', feature: emptySketch('S0', 'S0', XY), index: 0 });
    invalid(other, update('planet', { profile: { sketch: 'S0' } }), /the sketch "S0" has no entity "p"/);
  });
});

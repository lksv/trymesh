// D35 point 2 at the document level (no recompute): the extent of an extrusion as a variant and
// several target bodies of a cut.
import { describe, expect, it } from 'vitest';
import type { Command, Document, ExtrudeFeature, FeaturePatch, Input, PlaneRef } from '../src/types';
import { FEATURE_TYPE_INFO, applyCommand, emptyDocument, emptySketch, featureInput, featureRefs, fieldsOf, validateDocument } from '../src/document';

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
const add = (feature: Input<ExtrudeFeature>): Command => ({ type: 'addFeature', feature });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const invalid = (doc: Document, command: Command, pattern: RegExp) => expect(() => applyCommand(doc, command)).toThrow(pattern);
const feature = (doc: Document, id: string): ExtrudeFeature => doc.features.find((f) => f.id === id) as ExtrudeFeature;
const through = (side: 'forward' | 'backward' | 'both'): ExtrudeFeature['extent'] => ({ type: 'throughAll', side });

// A sketch with a circle, the parameter `h` and two bodies A and B.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'setParameter', name: 'h', expr: '12' },
    { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
    add(extrude('A')),
    add(extrude('B', { extent: { type: 'distance', start: 20, distance: 10 } })),
  );
}

describe('extent of an extrusion', () => {
  it('through all: only for a cut, the side is explicit', () => {
    const doc = base();
    const hole = run(doc, add(extrude('H', { extent: through('both'), operation: 'cut', targets: ['A'] })));
    expect(feature(hole, 'H')).toEqual({ ...extrude('H'), extent: { type: 'throughAll', side: 'both' }, operation: 'cut', targets: ['A'] });
    for (const side of ['forward', 'backward', 'both'] as const) expect(feature(run(doc, add(extrude('H', { extent: through(side), operation: 'cut', targets: ['A'] }))), 'H').extent).toEqual({ type: 'throughAll', side });
    invalid(doc, add(extrude('H', { extent: { type: 'throughAll' } as never, operation: 'cut', targets: ['A'] })), /extent\.side: čeká se jedna z hodnot forward, backward, both/);
    invalid(doc, add(extrude('H', { extent: { type: 'throughAll', side: 'up' } as never, operation: 'cut', targets: ['A'] })), /extent\.side/);
    invalid(doc, add(extrude('H', { extent: through('both') })), /throughAll is only for the operation cut/);
    invalid(doc, add(extrude('H', { extent: through('both'), operation: 'add', targets: ['A'] })), /throughAll is only for the operation cut/);
    invalid(doc, add(extrude('H', { extent: { type: 'upToFace' } as never, operation: 'cut', targets: ['A'] })), /extent\.type: čeká se jedna z hodnot distance, throughAll/);
  });

  it('through all has no numeric fields: no expression, no setField', () => {
    const doc = run(base(), add(extrude('H', { extent: through('backward'), operation: 'cut', targets: ['A'] })));
    expect(fieldsOf(feature(doc, 'H'))).toEqual([]);
    expect(featureInput(feature(doc, 'H'))).toEqual(feature(doc, 'H'));
    invalid(doc, { type: 'setField', feature: 'H', path: 'extent/distance', value: 5 }, /is not a numeric field/);
    invalid(doc, add(extrude('H2', { extent: through('both'), operation: 'cut', targets: ['A'], expressions: { 'extent/distance': 'h' } })), /"extent\/distance" is not a numeric field of this feature/);
    // the static catalog says which variant has the fields
    expect(FEATURE_TYPE_INFO.extrude.fields.map((f) => [f.path, f.when])).toEqual([
      ['extent/start', { path: 'extent/type', equals: 'distance' }],
      ['extent/distance', { path: 'extent/type', equals: 'distance' }],
    ]);
  });

  it('updateFeature: another variant replaces the extent and drops its expressions', () => {
    const doc = run(base(), add(extrude('H', { extent: { type: 'distance', start: 'h / 4', distance: 'h' }, operation: 'cut', targets: ['A'] })));
    expect(feature(doc, 'H')).toMatchObject({ extent: { type: 'distance', start: 3, distance: 12 }, expressions: { 'extent/start': 'h / 4', 'extent/distance': 'h' } });
    const all = run(doc, update('H', { extent: through('forward') }));
    expect(feature(all, 'H').extent).toEqual({ type: 'throughAll', side: 'forward' });
    expect(feature(all, 'H')).not.toHaveProperty('expressions');
    // the same variant merges: only the side changes
    expect(feature(run(all, update('H', { extent: { side: 'both' } })), 'H').extent).toEqual({ type: 'throughAll', side: 'both' });
    expect(feature(run(all, update('H', { extent: { type: 'throughAll', side: 'backward' } })), 'H').extent).toEqual({ type: 'throughAll', side: 'backward' });
    // and back: the new variant must be complete, a number or an expression
    const back = run(all, update('H', { extent: { type: 'distance', start: 0, distance: 'h * 2' } }));
    expect(feature(back, 'H')).toMatchObject({ extent: { type: 'distance', start: 0, distance: 24 }, expressions: { 'extent/distance': 'h * 2' } });
    invalid(all, update('H', { extent: { type: 'distance', distance: 5 } }), /extent\.start/);
    invalid(doc, update('H', { extent: { type: 'throughAll' } } as FeaturePatch), /extent\.side/);
    // a field of the other variant is a mistake, not a silent success
    invalid(all, update('H', { extent: { distance: 5 } } as FeaturePatch), /extent\.distance: vysunutí takové pole nemá/);
    invalid(doc, update('H', { extent: { side: 'both' } } as FeaturePatch), /extent\.side: vysunutí takové pole nemá/);
    invalid(doc, update('H', { extent: { type: 'throughAll', side: 'both', distance: 5 } } as unknown as FeaturePatch), /extent\.distance: vysunutí takové pole nemá/);
  });

  it('updateFeature: through all follows the operation', () => {
    const doc = run(base(), add(extrude('H', { extent: through('both'), operation: 'cut', targets: ['A'] })));
    invalid(doc, update('H', { operation: 'add' }), /throughAll is only for the operation cut/);
    invalid(doc, update('H', { operation: 'new' }), /throughAll is only for the operation cut/);
    // the operation and the extent change together
    expect(feature(run(doc, update('H', { operation: 'add', extent: { type: 'distance', start: 0, distance: 3 } })), 'H')).toMatchObject({ operation: 'add', targets: ['A'], extent: { type: 'distance', start: 0, distance: 3 } });
    const boss = run(base(), add(extrude('H', { operation: 'add', targets: ['A'] })));
    invalid(boss, update('H', { extent: through('both') }), /throughAll is only for the operation cut/);
    expect(feature(run(boss, update('H', { operation: 'cut', extent: through('both') })), 'H')).toMatchObject({ operation: 'cut', extent: { type: 'throughAll', side: 'both' } });
  });

  it('a document with through all loads unchanged; an expression of a field it does not have is rejected', () => {
    const doc = run(base(), add(extrude('H', { extent: through('both'), operation: 'cut', targets: ['A', 'B'] })));
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const bad = JSON.parse(JSON.stringify(doc));
    bad.features[3].expressions = { 'extent/distance': 'h' };
    expect(() => validateDocument(bad)).toThrow(/"extent\/distance" is not a numeric field/);
    const wrong = JSON.parse(JSON.stringify(doc));
    wrong.features[3].operation = 'add';
    expect(() => validateDocument(wrong)).toThrow(/throughAll is only for the operation cut/);
  });
});

describe('target bodies', () => {
  it('none for a new body, exactly one for an addition, one or more for a cut', () => {
    const doc = base();
    const cut = run(doc, add(extrude('H', { operation: 'cut', targets: ['B', 'A'] })));
    expect(feature(cut, 'H').targets).toEqual(['B', 'A']); // the order of the command is kept
    expect(featureRefs(feature(cut, 'H'))).toEqual(['S1', 'B', 'A']);
    invalid(doc, add(extrude('H', { operation: 'add', targets: ['A', 'B'] })), /operation add needs exactly one target body/);
    invalid(doc, add(extrude('H', { operation: 'add', targets: [] })), /operation add needs exactly one target body/);
    invalid(doc, add(extrude('H', { operation: 'cut', targets: [] })), /operation cut needs at least one target body/);
    invalid(doc, add(extrude('H', { operation: 'cut' })), /operation cut needs at least one target body/);
    invalid(doc, add(extrude('H', { operation: 'cut', targets: 'A' as never })), /operation cut needs at least one target body/);
    invalid(doc, add(extrude('H', { operation: 'cut', targets: ['A', 'A'] })), /a target body is listed twice/);
    invalid(doc, add(extrude('H', { operation: 'cut', targets: ['A', 5 as never] })), /targets\[1\]: čeká se řetězec/);
    invalid(doc, add(extrude('H', { operation: 'cut', targets: ['A', 'S1'] })), /není těleso/);
    invalid(doc, add(extrude('H', { operation: 'cut', targets: ['A', 'X'] })), /feature "X" neexistuje/);
    invalid(doc, add(extrude('H', { targets: ['A'] })), /nové těleso nemá cíl/);
  });

  it('updateFeature: the list is replaced as a whole and follows the operation', () => {
    const doc = run(base(), add(extrude('H', { operation: 'cut', targets: ['A', 'B'] })));
    expect(feature(run(doc, update('H', { targets: ['B'] })), 'H').targets).toEqual(['B']);
    invalid(doc, update('H', { operation: 'add' }), /operation add needs exactly one target body/);
    expect(feature(run(doc, update('H', { operation: 'add', targets: ['A'] })), 'H')).toMatchObject({ operation: 'add', targets: ['A'] });
    expect(feature(run(doc, update('H', { operation: 'new' })), 'H')).not.toHaveProperty('targets');
    invalid(doc, update('H', { targets: ['A', 'A'] }), /a target body is listed twice/);
    invalid(doc, update('H', { targets: [] }), /at least one target body/);
  });

  it('updateFeature: fixing one target does not trip over another broken one', () => {
    // H cuts A and B; B is removed, so one target is broken
    const doc = run(base(), add(extrude('C', { extent: { type: 'distance', start: 40, distance: 5 } })), add(extrude('H', { operation: 'cut', targets: ['A', 'B'] })), { type: 'removeFeature', id: 'B' });
    // an unrelated change and a change that repeats the broken target pass
    expect(feature(run(doc, update('H', { extent: { distance: 3 } })), 'H').targets).toEqual(['A', 'B']);
    expect(feature(run(doc, update('H', { targets: ['B', 'A', 'C'] })), 'H').targets).toEqual(['B', 'A', 'C']);
    // a new target is verified
    invalid(doc, update('H', { targets: ['A', 'B', 'X'] }), /updateFeature\.patch\.targets: feature "X" neexistuje/);
    // the fix: the broken target is replaced
    expect(feature(run(doc, update('H', { targets: ['A', 'C'] })), 'H').targets).toEqual(['A', 'C']);
  });
});

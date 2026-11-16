// Body properties (D48) without geometry: the section of the document, its upgrade step, the three
// commands, the result of the recompute over bodies written by hand, what a copy inherits, the
// write-back of expressions, undo, and the IDs a section names. The same against the real adapters
// is in packages/scenarios/test/scenario13.test.ts.
import { describe, expect, it } from 'vitest';
import { DATA_CATALOGS } from '../src/data-catalogs';
import { CommandError, applyCommand, emptyDocument, validateDocument } from '../src/document';
import { createEngine } from '../src/engine';
import { evaluateParameters } from '../src/expression';
import { SECTION_INFO, freshIds, namedBySections, takenOver } from '../src/index';
import { SCHEMA_PENDING, UPGRADES, upgradeDocument } from '../src/schema';
import { bodyPropertiesWithoutBody, printedBodies } from '../src/sections/body-properties';
import type { State } from '../src/recompute/state';
import { DOCUMENT_SECTIONS } from '../src/sections/index';
import type { BodyResult, Command, Document, Engine, Id, SketchSolver, SolidKernel } from '../src/types';

// A document with what creates bodies, loaded as a file is (references are not resolved on a load):
// the extrusions `upper`, `motor` and `screw`, and the pattern `screws` that copies `screw`.
const extrusion = (id: Id, operation: 'new' | 'add' = 'new') => ({
  id,
  name: id === 'upper' ? 'Upper arm' : id,
  suppressed: false,
  type: 'extrude',
  profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c'] }] },
  extent: { type: 'distance', start: 0, distance: 8 },
  operation,
  ...(operation === 'add' ? { targets: ['upper'] } : {}),
});
const pattern = (id: Id, body: Id) => ({ id, name: 'Screws', suppressed: false, type: 'pattern', source: { type: 'body', body }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 4, span: { type: 'full' } } });
const base = (bodyProperties: unknown = {}): Document =>
  validateDocument({ ...JSON.parse(JSON.stringify(emptyDocument())), features: [extrusion('upper'), extrusion('motor'), extrusion('boss', 'add'), extrusion('screw'), pattern('screws', 'screw')], bodyProperties });
const apply = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const refused = (doc: Document, command: Command, message: RegExp): CommandError => {
  let caught: unknown;
  try {
    applyCommand(doc, command);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CommandError);
  expect((caught as Error).message).toMatch(message);
  return caught as CommandError;
};
const set = (body: Id, patch: object): Command => ({ type: 'setBodyProperties', body, patch }) as Command;

// The result of the section over bodies of these volumes (mm3). Body properties read nothing of the
// state of the recompute.
const BODIES = { upper: 10000, motor: 30000, screw: 50, 'screws/1': 50, 'screws/2': 50, 'screws/3': 50 };
const evaluated = (doc: Document, bodies: Record<Id, number> = BODIES) =>
  DOCUMENT_SECTIONS.bodyProperties.evaluate(doc.bodyProperties, doc, Object.fromEntries(Object.entries(bodies).map(([id, volume]) => [id, { volume } as BodyResult])), evaluateParameters(doc.parameters), {} as State);

describe('the section and its upgrade step', () => {
  it('is always in the document, after the timeline; an empty one is `{}`', () => {
    expect(emptyDocument().bodyProperties).toEqual({});
    expect(Object.keys(emptyDocument()).slice(-3)).toEqual(['features', 'bodyProperties', 'mechanism']);
  });

  it('the step gives an older document the empty section and leaves a field that is there to the validation', () => {
    const step = UPGRADES.find((entry) => entry.name === '3a-body-properties');
    expect(step).toBeDefined();
    expect(UPGRADES.indexOf(step as never)).toBe(3); // the fourth of the list (5a-mechanism follows)
    const older = { schemaVersion: 4, settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [] };
    expect(step?.run(older)).toEqual({ ...older, bodyProperties: {} });
    expect(step?.run({ ...older, bodyProperties: null })).toEqual({ ...older, bodyProperties: null });
    // a document of master before the merge of 3a (version 4, no names) loads with the empty section
    expect(validateDocument(older).bodyProperties).toEqual({});
    expect(() => validateDocument({ ...older, bodyProperties: null })).toThrow(/document\.bodyProperties: čeká se objekt/);
    // a document of version 1 goes through every step
    expect(validateDocument({ schemaVersion: 1, settings: { chordTolerance: 0.01 }, features: [] }).bodyProperties).toEqual({});
  });

  it('a document saved with the section has version 5 and is not given the step twice; a build without the step refuses it', () => {
    const doc = apply(base(), set('motor', { mass: 280 }));
    const saved = JSON.parse(JSON.stringify(doc));
    expect(saved.schemaVersion).toBe(5);
    expect(saved.schemaSteps).toEqual(SCHEMA_PENDING ? ['5a-mechanism'] : undefined);
    expect(validateDocument(saved)).toEqual(doc);
    // a document of the branch d36/3a before the merge (version 4 naming the step) loads the same
    const { mechanism: _mechanism, ...without } = saved;
    expect(validateDocument({ ...without, schemaVersion: 4, schemaSteps: ['3a-body-properties'] })).toEqual(doc);
    // a build without the step (master before the merge of 3a): refused by its version
    expect(() => upgradeDocument({ ...without, schemaVersion: 5, schemaSteps: undefined }, UPGRADES.slice(0, 3), 0)).toThrow(/the schema version 5 is newer than this build reads/);
  });

  it('an entry is strict: a field this build does not know is refused, not dropped', () => {
    expect(() => base({ motor: { mass: 280, printOrientation: 'up' } })).toThrow(/document\.bodyProperties\.motor\.printOrientation: the properties of a body has no such field/);
    expect(() => base({ motor: { use: 'bought' } })).toThrow(/motor\.use: čeká se jedna z hodnot part, reference, auxiliary/);
    expect(() => base({ motor: { mass: '280' } })).toThrow(/an expression belongs in expressions/);
    expect(() => base({ motor: { mass: 280, expressions: { density: 'a' } } })).toThrow(/motor\.expressions\.density: the entry has no numeric field "density"/);
    expect(() => base({ motor: { mass: 280, expressions: { mass: '2 *' } } })).toThrow(/motor\.mass: expression "2 \*"/);
    expect(() => base({ motor: { density: 1240 } })).toThrow(/motor\.density: the value 1240 is not in the interval \(0, 25\]/);
    expect(() => base({ 'a/b/': {} })).not.toThrow(); // the key: a body ID whose feature part could be an ID
    expect(() => base({ '/2': { use: 'reference' } })).toThrow(/ID "" není přípustné/);
    expect(() => base({ 'screws/': { use: 'reference' } })).toThrow(/"screws\/" is not a body ID/);
  });

  it('on a load: an entry in its canonical form, the colour in lower case, an empty entry is dropped; whether a feature creates the body is not asked', () => {
    const doc = base({ gone: { mass: 3, use: 'reference', expressions: { mass: ' w ' } }, upper: { color: '#AABBCC' }, motor: {}, 'screws/2': { expressions: {}, name: 'Odd screw' } });
    expect(doc.bodyProperties).toEqual({ gone: { use: 'reference', mass: 3, expressions: { mass: 'w' } }, upper: { color: '#aabbcc' }, 'screws/2': { name: 'Odd screw' } });
    expect(JSON.stringify(doc.bodyProperties.gone)).toBe('{"use":"reference","mass":3,"expressions":{"mass":"w"}}');
  });
});

describe('the commands', () => {
  it('setBodyProperties merges a patch into the entry; null removes a field, and an entry with no field is removed', () => {
    let doc = apply(base(), set('upper', { name: 'Upper arm, left', color: '#30343A', use: 'reference', density: 1.27 }));
    expect(doc.bodyProperties).toEqual({ upper: { name: 'Upper arm, left', color: '#30343a', use: 'reference', density: 1.27 } });
    doc = apply(doc, set('upper', { use: null, mass: 41.5 }));
    expect(doc.bodyProperties.upper).toEqual({ name: 'Upper arm, left', color: '#30343a', density: 1.27, mass: 41.5 });
    doc = apply(doc, set('upper', { name: null, color: null, density: null, mass: null, material: null }));
    expect(doc.bodyProperties).toEqual({});
    // a field left undefined (an in-process caller) is not a change
    expect(apply(doc, set('upper', { name: undefined, use: 'auxiliary' })).bodyProperties).toEqual({ upper: { use: 'auxiliary' } });
  });

  it('a derived body and a body that can exist but does not at the moment are accepted; a mistyped one is not', () => {
    expect(apply(base(), set('screws/7', { use: 'reference' })).bodyProperties).toEqual({ 'screws/7': { use: 'reference' } });
    refused(base(), set('nope', { use: 'reference' }), /setBodyProperties\.body: no feature of the document creates the body "nope"/);
    refused(base(), set('screws/0', { use: 'reference' }), /the feature "screws" does not create a body "screws\/0"/);
    refused(base(), set('boss', { use: 'reference' }), /the feature "boss" does not create a body "boss"/);
    refused(base(), set('upper/1', { use: 'reference' }), /does not create a body "upper\/1"/);
  });

  it('refuses a field the properties do not have, a bad text, colour or use, a number out of range', () => {
    refused(base(), set('motor', { weight: 280 }), /setBodyProperties\.patch\.weight: the properties of a body has no such field/);
    refused(base(), set('motor', { expressions: { mass: '2' } }), /patch\.expressions: the properties of a body has no such field/);
    refused(base(), set('motor', { color: 'red' }), /patch\.color: a colour is written "#rrggbb"/);
    refused(base(), set('motor', { name: ' NEMA 17' }), /patch\.name: a text that is not empty, has no leading or trailing space and at most 200 characters/);
    refused(base(), set('motor', { material: 'x'.repeat(201) }), /patch\.material: a text that is not empty/);
    refused(base(), set('motor', { name: '' }), /patch\.name/);
    refused(base(), set('motor', { use: 'bought' }), /patch\.use: čeká se jedna z hodnot part, reference, auxiliary/);
    refused(base(), set('motor', { density: 1240 }), /patch\.density: the value 1240 is not in the interval \(0, 25\]/);
    refused(base(), set('motor', { mass: 0 }), /patch\.mass: the value must be positive/);
    refused(base(), set('motor', { mass: true }), /patch\.mass: čeká se konečné číslo/);
    refused(base(), { type: 'setBodyProperties', body: 'motor' } as never, /setBodyProperties\.patch: čeká se objekt/);
  });

  it('a numeric field: a string is an expression evaluated at once, a number removes the expression; an error names the field in the section', () => {
    const withParameter = apply(base(), { type: 'setParameter', name: 'infill', expr: '0.45' });
    let doc = apply(withParameter, set('upper', { density: '1.27 * infill' }));
    expect(doc.bodyProperties.upper).toEqual({ density: 0.5715, expressions: { density: '1.27 * infill' } });
    // a change of another field keeps the expression without evaluating it
    doc = apply(doc, { type: 'removeParameter', name: 'infill' }, set('upper', { mass: 12 }));
    expect(doc.bodyProperties.upper).toEqual({ density: 0.5715, mass: 12, expressions: { density: '1.27 * infill' } });
    doc = apply(doc, set('upper', { density: 1.1 }));
    expect(doc.bodyProperties.upper).toEqual({ density: 1.1, mass: 12 });
    const error = refused(withParameter, set('screws/2', { density: 'nope * 2' }), /setBodyProperties\.patch\.density: expression "nope \* 2": unknown name "nope"/);
    expect(error.expression).toMatchObject({ path: 'screws/2/density', error: { code: 'unknownName' } });
    expect(refused(withParameter, set('upper', { mass: '-infill' }), /gives -0\.45: the value must be positive/).expression).toMatchObject({ path: 'upper/mass', error: { code: 'outOfRange' } });
  });

  it('setBodyMaterial copies the key and the density of the catalog row; the mass stays; an unknown key lists the rows', () => {
    const row = DATA_CATALOGS.materials.rows.PETG;
    let doc = apply(base(), { type: 'setParameter', name: 'w', expr: '280' }, set('motor', { density: '1 + 0.1', mass: 'w', material: 'steel' }));
    doc = apply(doc, { type: 'setBodyMaterial', body: 'motor', material: 'PETG' });
    expect(doc.bodyProperties.motor).toEqual({ material: 'PETG', density: row.density, mass: 280, expressions: { mass: 'w' } });
    refused(doc, { type: 'setBodyMaterial', body: 'motor', material: 'unobtainium' }, /the catalog "materials" has no row "unobtainium"; its rows are PLA, PETG, ABS, ASA, TPU, PC/);
    refused(doc, { type: 'setBodyMaterial', body: 'motor', material: 'toString' }, /has no row "toString"/);
    refused(doc, { type: 'setBodyMaterial', body: 'nope', material: 'PLA' }, /setBodyMaterial\.body: no feature of the document creates the body "nope"/);
  });

  it('removeBodyProperties removes an entry, also of a body that is gone; one that is not there is refused', () => {
    const doc = base({ gone: { use: 'reference' }, motor: { mass: 3 } });
    expect(apply(doc, { type: 'removeBodyProperties', body: 'gone' }).bodyProperties).toEqual({ motor: { mass: 3 } });
    refused(doc, { type: 'removeBodyProperties', body: 'nope' }, /removeBodyProperties\.body: the document has no properties of the body "nope"/);
    refused(doc, { type: 'removeBodyProperties', body: 'toString' }, /no properties of the body "toString"/);
  });

  it('a batch is atomic; a command that changes nothing returns the same document', () => {
    const doc = base({ motor: { mass: 3 } });
    expect(() => applyCommand(doc, { type: 'batch', commands: [set('motor', { mass: 4 }), set('nope', { mass: 1 })] })).toThrow(CommandError);
    expect(apply(doc, set('motor', { mass: 3 }))).toBe(doc);
  });

  it('renameParameter rewrites the expressions of the entries', () => {
    const doc = apply(base(), { type: 'setParameter', name: 'w', expr: '280' }, set('motor', { mass: 'w * 1' }), { type: 'renameParameter', name: 'w', to: 'weight' });
    expect(doc.bodyProperties.motor.expressions).toEqual({ mass: 'weight * 1' });
  });
});

describe('the result of the recompute', () => {
  it('every body of the state has a result with the defaults: the name of its feature, a copy with its number, the use part', () => {
    const { result } = evaluated(base());
    expect(Object.keys(result)).toEqual(Object.keys(BODIES));
    expect(result.upper).toEqual({ name: 'Upper arm', use: 'part' });
    expect(result['screws/2']).toEqual({ name: 'Screws / 2', use: 'part', from: 'screw' });
  });

  it('the mass: a stated mass wins, else density times volume; an auxiliary body has none', () => {
    const doc = base({ upper: { material: 'PETG', density: 1.27 }, motor: { use: 'reference', mass: 280, density: 7.8 }, screw: { use: 'auxiliary', density: 2 } });
    const { result } = evaluated(doc);
    expect(result.upper).toEqual({ name: 'Upper arm', material: 'PETG', use: 'part', density: 1.27, mass: 12.7, massFrom: 'density' });
    expect(result.motor).toEqual({ name: 'motor', use: 'reference', density: 7.8, mass: 280, massFrom: 'mass' });
    expect(result.screw).toEqual({ name: 'screw', use: 'auxiliary', density: 2 });
    expect(printedBodies(result)).toEqual(['upper']);
  });

  it('a copy inherits field by field, the density and the mass as a pair; its own name is not inherited', () => {
    const doc = base({ screw: { name: 'M3 screw', color: '#000000', use: 'reference', material: 'steel', mass: 0.9 }, 'screws/2': { color: '#ffffff' }, 'screws/3': { material: 'PC', density: 1.22 } });
    const { result } = evaluated(doc);
    expect(result['screws/1']).toEqual({ name: 'Screws / 1', color: '#000000', material: 'steel', use: 'reference', mass: 0.9, massFrom: 'mass', from: 'screw' });
    expect(result['screws/2']).toMatchObject({ color: '#ffffff', use: 'reference', mass: 0.9, massFrom: 'mass' });
    // a copy in another material is weighed by its own density, not by the mass of its source
    expect(result['screws/3']).toEqual({ name: 'Screws / 3', color: '#000000', material: 'PC', use: 'reference', density: 1.22, mass: 0.061, massFrom: 'density', from: 'screw' });
    expect(printedBodies(result)).toEqual(['upper', 'motor']);
  });

  it('a field in error has no value and nothing takes its place; a copy carries the error of the pair it inherits', () => {
    const doc = base({ upper: { density: 1.27, mass: 41.5, expressions: { mass: 'scale' } }, screw: { mass: 0.9, expressions: { mass: 'perScrew' } }, motor: { density: 2, expressions: { density: '1/0' } } });
    const { result } = evaluated(doc);
    expect(result.upper).toEqual({ name: 'Upper arm', use: 'part', density: 1.27, fieldErrors: { mass: { code: 'unknownName', message: 'unknown name "scale"', position: 0 } } });
    expect(result['screws/1']).toMatchObject({ fieldErrors: { mass: { message: 'unknown name "perScrew"' } } });
    expect(result['screws/1'].mass).toBeUndefined();
    expect(result.motor.mass).toBeUndefined();
    expect(result.motor.fieldErrors?.density?.code).toBe('notFinite');
  });

  it('a chain of copies is followed, and a cycle in a document edited by hand stops', () => {
    const chained = validateDocument({ ...JSON.parse(JSON.stringify(base({ screw: { use: 'reference' } }))), features: [...base().features, pattern('more', 'screws/2')] });
    expect(evaluated(chained, { ...BODIES, 'more/1': 50 }).result['more/1']).toMatchObject({ use: 'reference', from: 'screws/2' });
    const loop = validateDocument({ ...JSON.parse(JSON.stringify(emptyDocument())), features: [pattern('p', 'q/1'), pattern('q', 'p/1')], bodyProperties: { 'q/1': { use: 'reference' } } });
    expect(evaluated(loop, { 'p/1': 5, 'q/1': 5 }).result).toEqual({ 'p/1': { name: 'Screws / 1', use: 'reference', from: 'q/1' }, 'q/1': { name: 'Screws / 1', use: 'reference', from: 'p/1' } });
  });

  it('the numbers of expressions are written back when they changed; an entry whose body is gone is evaluated as well', () => {
    const doc = apply(base(), { type: 'setParameter', name: 'w', expr: '280' }, set('motor', { mass: 'w' }), { type: 'setParameter', name: 'w', expr: '300' });
    const { written } = evaluated(doc, {});
    expect(written?.motor).toEqual({ mass: 300, expressions: { mass: 'w' } });
    expect(evaluated(apply(doc, { type: 'setParameter', name: 'w', expr: '280' }), {}).written).toBeUndefined();
  });

  it('entries without a body: the keys of the section the state has no body for', () => {
    const doc = base({ gone: { use: 'reference' }, motor: { mass: 3 } });
    expect(bodyPropertiesWithoutBody(doc.bodyProperties, evaluated(doc).result)).toEqual(['gone']);
  });
});

describe('IDs a section names', () => {
  it('namedBySections: the feature of every key, a derived key with the feature it is derived from', () => {
    expect(namedBySections(base({ gone: { use: 'reference' }, 'screws/2': { mass: 1 } }))).toEqual(['gone', 'screws/2', 'screws']);
  });

  it('freshIds does not hand out an ID a section still names', () => {
    const next = freshIds(base({ e1: { use: 'reference' }, 'p1/1': { mass: 1 } }));
    expect([next('e'), next('p')]).toEqual(['e2', 'p2']);
  });

  it('takenOver: what a command adds under an ID a section names, at any depth of a batch, inside a sketch added whole', () => {
    const doc = base({ gone: { use: 'reference' }, 'x1/2': { mass: 1 }, k9: { mass: 2 } });
    const sketch = { id: 's2', name: 's2', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: { gone: { x: 0, y: 0 } }, radii: {}, curves: {}, constraints: {}, external: { x1: { type: 'edge', body: 'upper', edge: {}, kind: 'line' } }, solved: { inputs: '', external: {} } };
    const add = { type: 'addFeature', feature: extrusion('gone') } as Command;
    expect(takenOver(doc, add)).toEqual(['gone']);
    expect(takenOver(doc, { type: 'batch', commands: [{ type: 'batch', commands: [{ type: 'removeFeature', id: 'motor' }, add] }] })).toEqual(['gone']);
    expect(takenOver(doc, { type: 'addFeature', feature: sketch } as never)).toEqual(['gone', 'x1']);
    expect(takenOver(doc, { type: 'addPoint', sketch: 's', id: 'x1', x: 0, y: 0 })).toEqual(['x1']);
    // a constraint is no entity of the model; a body made and given properties in one batch is not reported
    expect(takenOver(doc, { type: 'addConstraint', sketch: 's', id: 'k9', constraint: { type: 'horizontal', line: 'c' } })).toEqual([]);
    expect(takenOver(doc, { type: 'batch', commands: [{ type: 'addFeature', feature: extrusion('washer') } as Command, set('washer', { use: 'reference' })] })).toEqual([]);
    expect(takenOver(doc, { type: 'updateFeature', id: 'upper', patch: {} })).toEqual([]);
  });
});

describe('the engine: undo, a preview, the write-back, the description', () => {
  const engine = (): Engine => {
    // no body is computed here: the extrusions refer to a sketch the document does not have
    const solver = { solve: () => ({ status: 'failed', points: {}, radii: {}, degreesOfFreedom: 0, conflicting: [], redundant: [] }) } as SketchSolver;
    const made = createEngine({ solver, kernel: {} as SolidKernel });
    made.load(JSON.stringify(base()));
    return made;
  };

  it('a change of a property alone is one undo step; a command that changes nothing makes none', () => {
    const e = engine();
    const result = e.execute(set('motor', { use: 'reference' }));
    expect(result.ok && result.state.canUndo).toBe(true);
    e.execute(set('motor', { use: 'reference' }));
    e.undo();
    expect(e.getState().document.bodyProperties).toEqual({});
    expect(e.getState().canUndo).toBe(false);
  });

  it('the recompute writes the numbers back in the same undo step; a preview writes nothing and has the numbers in its evaluation', () => {
    const e = engine();
    e.execute({ type: 'batch', commands: [{ type: 'setParameter', name: 'w', expr: '280' }, set('motor', { mass: 'w' })] });
    e.execute({ type: 'setParameter', name: 'w', expr: '300' });
    expect(e.getState().document.bodyProperties.motor).toEqual({ mass: 300, expressions: { mass: 'w' } });
    e.undo();
    expect(e.getState().document.bodyProperties.motor.mass).toBe(280);
    const preview = e.preview({ type: 'setParameter', name: 'w', expr: '310' });
    expect(preview.ok && preview.state.document.bodyProperties.motor.mass).toBe(280);
    expect(e.getState().document.bodyProperties.motor.mass).toBe(280);
  });

  it('a load writes the numbers back as well', () => {
    const e = engine();
    const doc = JSON.parse(e.save());
    e.load(JSON.stringify({ ...doc, parameters: [{ name: 'w', expr: '5' }], bodyProperties: { motor: { mass: 1, expressions: { mass: 'w' } } } }));
    expect(e.getState().document.bodyProperties.motor.mass).toBe(5);
  });

  it('the registry describes the section: its commands and its numeric fields', () => {
    expect(SECTION_INFO.bodyProperties.commands).toEqual(['setBodyProperties', 'setBodyMaterial', 'removeBodyProperties']);
    expect(SECTION_INFO.bodyProperties.fields.map((field) => `${field.owner}: ${field.path} (${field.spec.unit})`)).toEqual(['body: density (g/cm3)', 'body: mass (g)']);
  });
});

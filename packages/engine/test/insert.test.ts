// Inserting another document as a part (D62) without the adapters: the section `documents` and its
// commands, the feature type `insert` as a document holds it (validation, references, the patch),
// the names of inserted faces (the rule of form, the key, the owner), what reads a document for an
// inserted feature or body, and the environment of the parameters. The recompute is tested against
// the real adapters in packages/scenarios/test/insert.test.ts and in the part of 3c of scenario 13.
import { describe, expect, it } from 'vitest';
import { CommandError, applyCommand, emptyDocument, emptySketch, featureRefs, fieldsOf, validateDocument } from '../src/document';
import { createEngine } from '../src/engine';
import { faceKey, faceText, sameFaceName } from '../src/face-roles';
import { bodyProblem, featuresWithInserted, insertedFeature } from '../src/features/index';
import { environmentText, insertedFaceName, losslessNumber } from '../src/recompute/insertion';
import { evaluateParameters } from '../src/expression';
import { SCHEMA_VERSION, UPGRADES } from '../src/schema';
import { MAX_INSERT_DEPTH } from '../src/sections/documents';
import { SECTION_INFO, namedBySections, sectionsDiffer } from '../src/sections/index';
import type { Command, Document, Engine, FaceName, InsertFeature, PlaneRef, SketchSolver, SolidKernel } from '../src/types';
import { faceNumber, sameEdgeName } from '../src/util';
import { faceName, faceRefs } from '../src/validation';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
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

// A part as a file holds it: two parameters and names that the merge of a patch could take for
// a reference or a variant, a sketch and the extrusion `ring`, a pattern of its body. Loaded, not
// recomputed: the references of a document are checked for their form only.
function part(extra: Partial<Document> = {}): Document {
  return JSON.parse(
    JSON.stringify({
      ...emptyDocument(),
      parameters: [
        { name: 'D', expr: '22' },
        { name: 'd', expr: '8' },
        { name: 'kind', expr: '1' },
        { name: 'type', expr: '2' },
        { name: 'generator', expr: '3' },
      ],
      features: [
        emptySketch('S', 'S', XY),
        { id: 'ring', name: 'Ring', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['outer'] }] }, extent: { type: 'distance', start: 0, distance: 7 }, operation: 'new' },
        { id: 'p', name: 'Copies', suppressed: false, type: 'pattern', source: { type: 'body', body: 'ring' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: 30 } } },
      ],
      ...extra,
    }),
  );
}
const insertion = (id: string, more: Partial<InsertFeature> | Record<string, unknown> = {}): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'insert', document: 'bearing', placement: { frame: XY }, ...more } as never });
const stored = (): Document => run(emptyDocument(), { type: 'addDocument', id: 'bearing', document: part(), name: '608.json' });
const host = (): Document => run(stored(), insertion('b1'));

describe('the section documents and its commands', () => {
  it('is always in the document, last; the step gives an older document the empty section', () => {
    expect(emptyDocument().documents).toEqual({});
    expect(Object.keys(emptyDocument()).at(-1)).toBe('documents');
    const step = UPGRADES.find((entry) => entry.name === '3c-document-insert');
    expect(step?.run({ schemaVersion: 6 })).toEqual({ schemaVersion: 6, documents: {} });
    expect(step?.run({ documents: null }).documents).toBeNull();
    expect(SECTION_INFO.documents.commands).toEqual(['addDocument', 'replaceDocument', 'removeDocument']);
    expect(MAX_INSERT_DEPTH).toBe(8);
  });

  it('addDocument stores the document upgraded and validated as a load does; an ID it has is refused', () => {
    const { schemaSteps: _steps, documents: _documents, meshes: _meshes, ...older } = part();
    const doc = run(emptyDocument(), { type: 'addDocument', id: 'bearing', document: { ...older, schemaVersion: 6 } as never, name: '608.json' });
    expect(doc.documents.bearing.name).toBe('608.json');
    expect(doc.documents.bearing.document).toEqual(validateDocument(part()));
    expect(doc.documents.bearing.document.schemaVersion).toBe(SCHEMA_VERSION);
    refused(doc, { type: 'addDocument', id: 'bearing', document: part() }, /addDocument\.id: the document has a stored document "bearing" already/);
    refused(doc, { type: 'addDocument', id: 'a/b', document: part() }, /addDocument\.id: ID "a\/b"/);
    refused(doc, { type: 'addDocument', id: 'x', document: part(), name: ' padded' }, /addDocument\.name/);
  });

  it('a document that does not load is the message of the load, with its path and without an expression of the host', () => {
    refused(emptyDocument(), { type: 'addDocument', id: 'broken', document: { schemaVersion: 1, features: 'none' } as never }, /^addDocument\.document/);
    refused(emptyDocument(), { type: 'addDocument', id: 'x', document: { ...part(), schemaVersion: 99 } }, /^addDocument\.document: the schema version 99 is newer than this build reads/);
    refused(emptyDocument(), { type: 'addDocument', id: 'x', document: { ...part(), settings: { chordTolerance: 0 } } }, /^addDocument\.document\.settings\.chordTolerance: musí být kladná/);
    refused(emptyDocument(), { type: 'addDocument', id: 'x', document: { ...part(), features: [{ id: 'q' } as never] } }, /^addDocument\.document\.features\[0\]\.type/);
    // a parameter of a stored document is no parameter of the host: the error has no `expression`
    const error = refused(emptyDocument(), { type: 'addDocument', id: 'x', document: { ...part(), parameters: [{ name: 'D', expr: '2 +' }] } }, /^addDocument\.document\.parameters\[0\]\.expr/);
    expect(error.expression).toBeUndefined();
  });

  it('a load names the path of a fault inside a stored document, also two levels down', () => {
    refused(emptyDocument(), { type: 'addDocument', id: 'bearing', document: { ...part(), bodyProperties: { ring: { colour: 'red' } } as never } }, /^addDocument\.document\.bodyProperties\.ring\.colour: the properties of a body has no such field/);
    const faulty = JSON.parse(JSON.stringify(stored()));
    faulty.documents.bearing.document.bodyProperties = { ring: { colour: 'red' } };
    expect(() => validateDocument(faulty)).toThrow(/^document\.documents\.bearing\.document\.bodyProperties\.ring\.colour: the properties of a body has no such field/);
    const outer = JSON.parse(JSON.stringify(run(emptyDocument(), { type: 'addDocument', id: 'kit', document: JSON.parse(JSON.stringify(stored())) })));
    outer.documents.kit.document.documents.bearing.document.settings = {};
    expect(() => validateDocument(outer)).toThrow(/^document\.documents\.kit\.document\.documents\.bearing\.document\.settings\.chordTolerance/);
    const strict = JSON.parse(JSON.stringify(stored()));
    strict.documents.bearing.source = '/tmp/608.json';
    expect(() => validateDocument(strict)).toThrow(/^document\.documents\.bearing\.source: a stored document has no such field/);
    // the host keeps its old texts
    expect(() => validateDocument({ ...emptyDocument(), settings: { chordTolerance: -1 } })).toThrow(/^dokument\.settings\.chordTolerance: musí být kladná/);
  });

  it('documents inside documents down to 8 levels below the host, on a load and by a command', () => {
    const nest = (levels: number): Document => {
      let doc = part();
      for (let i = 0; i < levels; i++) doc = JSON.parse(JSON.stringify(run(emptyDocument(), { type: 'addDocument', id: 'inner', document: doc })));
      return doc;
    };
    expect(() => validateDocument(nest(MAX_INSERT_DEPTH))).not.toThrow();
    expect(() => validateDocument(nest(MAX_INSERT_DEPTH + 1))).toThrow(/documents inside documents are allowed down to 8 levels below the host/);
    expect(() => run(emptyDocument(), { type: 'addDocument', id: 'deep', document: nest(MAX_INSERT_DEPTH) })).toThrow(/down to 8 levels/);
    expect(() => run(emptyDocument(), { type: 'addDocument', id: 'deep', document: nest(MAX_INSERT_DEPTH - 1) })).not.toThrow();
  });

  it('replaceDocument: the same validation; `name` absent keeps the name, null removes it', () => {
    const doc = stored();
    const revision = { ...part(), parameters: [{ name: 'D', expr: '24' }] };
    expect(run(doc, { type: 'replaceDocument', id: 'bearing', document: revision }).documents.bearing).toMatchObject({ name: '608.json', document: { parameters: [{ name: 'D', expr: '24' }] } });
    expect(run(doc, { type: 'replaceDocument', id: 'bearing', document: revision, name: null }).documents.bearing.name).toBeUndefined();
    expect(run(doc, { type: 'replaceDocument', id: 'bearing', document: revision, name: '609.json' }).documents.bearing.name).toBe('609.json');
    refused(doc, { type: 'replaceDocument', id: 'nope', document: revision }, /replaceDocument\.id: the document has no stored document "nope"/);
    refused(doc, { type: 'replaceDocument', id: 'bearing', document: { ...revision, schemaVersion: 99 } }, /^replaceDocument\.document: the schema version 99/);
    // an insertion keeps a value of a parameter the revision lost: an error of the recompute, not of the command
    const set = run(host(), { type: 'updateFeature', id: 'b1', patch: { parameters: { d: 9 } } });
    expect(run(set, { type: 'replaceDocument', id: 'bearing', document: revision }).features.at(-1)).toMatchObject({ parameters: { d: 9 } });
  });

  it('removeDocument is refused while a feature inserts it, suppressed or not; in one batch with the feature it passes', () => {
    const doc = run(host(), { type: 'setSuppressed', id: 'b1', suppressed: true });
    refused(doc, { type: 'removeDocument', id: 'bearing' }, /the stored document "bearing" is inserted by the features b1; remove them/);
    expect(run(doc, { type: 'batch', commands: [{ type: 'removeFeature', id: 'b1' }, { type: 'removeDocument', id: 'bearing' }] }).documents).toEqual({});
    refused(doc, { type: 'removeDocument', id: 'nope' }, /no stored document "nope"/);
  });

  it('names nothing of the document, and a rename of a parameter leaves it as it is', () => {
    const doc = run(host(), { type: 'setParameter', name: 'D', expr: '30' }, { type: 'updateFeature', id: 'b1', patch: { parameters: { D: 'D' } } });
    expect(namedBySections(doc)).toEqual([]);
    const renamed = run(doc, { type: 'renameParameter', name: 'D', to: 'outer' });
    expect(renamed.documents).toBe(doc.documents);
    expect(renamed.features.at(-1)?.expressions).toEqual({ 'parameters/D': 'outer' });
  });

  it('two documents differ in the section only by content: another object of the same content does not', () => {
    const doc = stored();
    expect(sectionsDiffer(doc, { ...doc, documents: JSON.parse(JSON.stringify(doc.documents)) })).toBe(false);
    expect(sectionsDiffer(doc, run(doc, { type: 'replaceDocument', id: 'bearing', document: part({ checks: [{ name: 'wall', expr: 'D > d' }] }) }))).toBe(true);
  });
});

describe('the feature type insert as a document holds it', () => {
  it('a command checks the stored document and every parameter it sets; a load checks the form only', () => {
    refused(stored(), insertion('b1', { document: 'nope' }), /document: the document has no stored document "nope"/);
    refused(stored(), insertion('b1', { parameters: { width: 3 } }), /parameters\.width: the stored document "bearing" has no parameter "width"; its parameters are D, d, kind, type, generator/);
    refused(stored(), insertion('b1', { parameters: { '2x': 3 } }), /parameters\.2x: a parameter name/);
    refused(stored(), insertion('b1', { bodies: [] }), /bodies: a list of the body IDs/);
    refused(stored(), insertion('b1', { bodies: ['ring', 'ring'] }), /the body "ring" is listed twice/);
    refused(stored(), insertion('b1', { bodies: ['ring/'] }), /is not a body ID/);
    refused(stored(), insertion('b1', { placement: { frame: XY, scale: 2 } }), /placement\.scale: a placement has no such field/);
    const doc = run(stored(), { type: 'setParameter', name: 'big', expr: '24' }, insertion('b1', { parameters: { D: 'big', kind: 5 }, bodies: ['ring'], placement: { frame: XY, z: '0.5' } }));
    const f = doc.features.at(-1) as InsertFeature;
    expect(f).toMatchObject({ document: 'bearing', parameters: { D: 24, kind: 5 }, bodies: ['ring'], placement: { frame: XY, z: 0.5 }, expressions: { 'parameters/D': 'big', 'placement/z': '0.5' } });
    expect(fieldsOf(f).map((field) => field.path)).toEqual(['placement/z', 'parameters/D', 'parameters/kind']);
    // a load: a stored document that is not there loads (the recompute says brokenReference)
    const saved = JSON.parse(JSON.stringify(doc));
    saved.documents = {};
    expect(validateDocument(saved).features.at(-1)).toMatchObject({ type: 'insert', document: 'bearing' });
    expect(() => validateDocument({ ...saved, features: [{ ...f, parameters: { D: 'big' } }] })).toThrow(/a number is expected; an expression belongs in expressions/);
  });

  it('the references: the frame, the document and the parameters; no feature but the frame on the timeline', () => {
    const f = host().features.at(-1) as InsertFeature;
    expect(featureRefs(f)).toEqual([]);
    const withPoint = { ...f, placement: { frame: { kind: 'sketchPoint', sketch: 'layout', point: 'p' } }, parameters: { D: 1 } } as InsertFeature;
    expect(featureRefs(withPoint)).toEqual(['layout']);
  });

  it('the patch merges the values key by key; kind, type and generator are names, not a reference or a variant; null removes one', () => {
    const doc = run(stored(), { type: 'setParameter', name: 'a', expr: '1' }, insertion('b1', { parameters: { D: 'a + 20', kind: 'a', type: 'a * 2' } }));
    const patched = run(doc, { type: 'updateFeature', id: 'b1', patch: { parameters: { generator: 4, D: null } } });
    const f = patched.features.at(-1) as InsertFeature;
    expect(f.parameters).toEqual({ generator: 4, kind: 1, type: 2 });
    expect(f.expressions).toEqual({ 'parameters/kind': 'a', 'parameters/type': 'a * 2' });
    // a value by an expression; the other expressions stay
    const again = run(patched, { type: 'updateFeature', id: 'b1', patch: { parameters: { kind: 'a + 1' } } }).features.at(-1) as InsertFeature;
    expect(again.parameters).toEqual({ generator: 4, kind: 2, type: 2 });
    expect(again.expressions).toEqual({ 'parameters/kind': 'a + 1', 'parameters/type': 'a * 2' });
    // `null` for the whole dictionary, also on an insertion without values; and for a value it does not have
    expect((run(patched, { type: 'updateFeature', id: 'b1', patch: { parameters: null } }).features.at(-1) as InsertFeature).parameters).toBeUndefined();
    expect(run(host(), { type: 'updateFeature', id: 'b1', patch: { parameters: null, bodies: null, placement: { x: null } } }).features.at(-1)).toEqual(host().features.at(-1));
    expect((run(host(), { type: 'updateFeature', id: 'b1', patch: { parameters: { d: null } } }).features.at(-1) as InsertFeature).parameters).toBeUndefined();
    // a new name is checked, one the feature had is not
    refused(doc, { type: 'updateFeature', id: 'b1', patch: { parameters: { width: 1 } } }, /has no parameter "width"/);
    // setField changes a value that is set, not one that is not
    expect((run(doc, { type: 'setField', feature: 'b1', path: 'parameters/kind', value: 7 }).features.at(-1) as InsertFeature).parameters?.kind).toBe(7);
    refused(doc, { type: 'setField', feature: 'b1', path: 'parameters/d', value: 7 }, /"parameters\/d" is not a numeric field/);
  });

  it('pointed at another stored document, every value it sets is checked again', () => {
    const doc = run(host(), { type: 'updateFeature', id: 'b1', patch: { parameters: { d: 9 } } }, { type: 'addDocument', id: 'other', document: part({ parameters: [{ name: 'D', expr: '1' }] }) });
    refused(doc, { type: 'updateFeature', id: 'b1', patch: { document: 'other' } }, /parameters\.d: the stored document "other" has no parameter "d"/);
    expect(run(doc, { type: 'updateFeature', id: 'b1', patch: { document: 'other', parameters: { d: null } } }).features.at(-1)).toMatchObject({ document: 'other' });
  });

  it('a body of an insertion is `<insertion>/<body there>`, one the stored document can make', () => {
    const doc = host();
    expect(bodyProblem(doc, 'b1/ring')).toBeUndefined();
    expect(bodyProblem(doc, 'b1/p/1')).toBeUndefined();
    expect(bodyProblem(doc, 'b1')).toMatch(/does not create a body "b1"/);
    expect(bodyProblem(doc, 'b1/typo')).toMatch(/the stored document "bearing" of the insertion "b1" cannot make the body "typo"/);
    expect(bodyProblem(doc, 'b1/p/x')).toMatch(/cannot make the body "p\/x"/);
    expect(run(doc, { type: 'setBodyProperties', body: 'b1/ring', patch: { color: '#ff0000' } }).bodyProperties).toEqual({ 'b1/ring': { color: '#ff0000' } });
    refused(doc, { type: 'setBodyProperties', body: 'b1/typo', patch: { color: '#ff0000' } }, /cannot make the body "typo"/);
    // with a list, only the listed ones
    const listed = run(stored(), insertion('b1', { bodies: ['p/1'] }));
    expect(bodyProblem(listed, 'b1/ring')).toMatch(/does not create a body "b1\/ring"/);
    expect(bodyProblem(listed, 'b1/p/1')).toBeUndefined();
    // a body as a target of a feature after the insertion
    refused(run(doc, { type: 'addFeature', feature: emptySketch('T', 'T', XY) }), { type: 'addFeature', feature: { id: 'cut', name: 'cut', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'T', regions: [{ outerLoop: ['x'] }] }, extent: { type: 'distance', start: 0, distance: 1 }, operation: 'cut', targets: ['b1/typo'] } }, /cannot make the body "typo"/);
  });

  it('the feature behind a prefixed ID, and every feature with those of the inserted documents at the place of their insertion', () => {
    const kit = run(emptyDocument(), { type: 'addDocument', id: 'kit', document: JSON.parse(JSON.stringify(host())) }, { type: 'addFeature', feature: emptySketch('L', 'L', XY) }, { type: 'addFeature', feature: { id: 'k', name: 'Kit', suppressed: false, type: 'insert', document: 'kit', placement: { frame: XY } } }, { type: 'addFeature', feature: emptySketch('M', 'M', XY) });
    expect(insertedFeature(kit, 'k/b1/ring')?.feature).toMatchObject({ id: 'ring', type: 'extrude' });
    expect(insertedFeature(kit, 'k/b1')?.feature.type).toBe('insert');
    expect(insertedFeature(kit, 'L')?.document).toBe(kit);
    expect(insertedFeature(kit, 'k/nope')).toBeUndefined();
    expect(insertedFeature(kit, 'L/ring')).toBeUndefined();
    expect(featuresWithInserted(kit).map((f) => f.id)).toEqual(['L', 'k', 'k/b1', 'k/b1/S', 'k/b1/ring', 'k/b1/p', 'M']);
  });
});

describe('the names of the faces of an insertion', () => {
  const ring: FaceName = { feature: 'ring', role: 'side', curve: 'outer' };

  it('every feature ID prefixed, the fields of the role as they are; the key quotes the inner key', () => {
    expect(insertedFaceName(ring, 'b1')).toEqual({ feature: 'b1/ring', role: 'side', curve: 'outer' });
    const copied = insertedFaceName({ feature: 'b/ring', role: 'endCap', copy: [{ pattern: 'b/p', index: 1 }] }, 'kit');
    expect(copied).toEqual({ feature: 'kit/b/ring', role: 'endCap', copy: [{ pattern: 'kit/b/p', index: 1 }] });
    expect(faceKey(insertedFaceName(ring, 'b1'))).toBe('b1/"ring/side/outer"');
    expect(faceKey({ ...insertedFaceName(ring, 'b1'), copy: [{ pattern: 'q', index: 2 }] })).toBe('b1/"ring/side/outer"/@q:2');
    expect(faceKey(copied)).toBe('kit/"b/\\"ring/endCap/@p:1\\""');
    // the key of a face of this document does not change
    expect(faceKey(ring)).toBe('ring/side/outer');
    expect(faceText(copied)).toBe('kit/b/ring/endCap/@kit/b/p:1');
  });

  it('the key is unambiguous where the plain concatenation is not: IDs with @ and :, and names that are not there', () => {
    // two copy histories of legal IDs that concatenate alike
    const a: FaceName = { feature: 'b1/ring', role: 'endCap', copy: [{ pattern: 'b1/p:1/@q', index: 2 }] };
    const b: FaceName = { feature: 'b1/ring', role: 'endCap', copy: [{ pattern: 'b1/p', index: 1 }, { pattern: 'q', index: 2 }] };
    expect(faceText(a)).not.toBe(faceKey(a));
    expect(faceKey(a)).not.toBe(faceKey(b));
    // a name no insertion makes against a real one
    expect(faceKey({ feature: 'b1/x/side', role: 'endCap' })).not.toBe(faceKey({ feature: 'b1/x', role: 'side', curve: 'endCap' }));
    // every role and two levels: all keys differ
    const names: FaceName[] = [];
    for (const feature of ['e', 'e@1', 'e:2', 'e"', 'e\\']) {
      const base: FaceName[] = [
        { feature, role: 'side', curve: 'c' },
        { feature, role: 'startCap' },
        { feature, role: 'endCap' },
        { feature, role: 'wallSide', curve: 'c', side: 'left' },
        { feature, role: 'wallEnd', point: 'p' },
        { feature, role: 'holeBore', point: 'p' },
        { feature, role: 'holeHead', point: 'p' },
        { feature, role: 'holeFlat', point: 'p', flat: 1 },
        { feature, role: 'holeSeat' },
        { feature, role: 'mesh' },
        { feature, role: 'splitFace' },
      ];
      for (const name of base) {
        const tagged: FaceName = { ...name, copy: [{ pattern: 'p@1:2', index: 3 }] };
        names.push(name, tagged, insertedFaceName(name, 'i'), insertedFaceName(tagged, 'i'), insertedFaceName(insertedFaceName(tagged, 'i'), 'k'), { ...insertedFaceName(tagged, 'i'), copy: [...(insertedFaceName(tagged, 'i').copy ?? []), { pattern: 'q', index: 1 }] });
      }
    }
    expect(new Set(names.map((name) => faceKey(name))).size).toBe(names.length);
    // and every one obeys the rule of form
    for (const name of names) expect(faceName(name, 'face')).toEqual(name);
  });

  it('the rule of form, at every level', () => {
    const form = (name: object) => () => faceName(name, 'face');
    expect(form({ feature: 'upper', role: 'endCap', copy: [{ pattern: 'b1/p', index: 1 }] })).toThrow(/the copy tag "b1\/p" is of an inserted document, the feature "upper" is not/);
    expect(form({ feature: 'b1/ring', role: 'endCap', copy: [{ pattern: 'q', index: 1 }, { pattern: 'b1/p', index: 1 }] })).toThrow(/comes after a tag of this one/);
    expect(form({ feature: 'b1/ring', role: 'endCap', copy: [{ pattern: 'b2/p', index: 1 }] })).toThrow(/is of another insertion than the feature "b1\/ring"/);
    // one level down: `kit/b/ring` with the tags `kit/kp` and `kit/b/p` is `b/ring` with `kp`, `b/p`
    expect(form({ feature: 'kit/b/ring', role: 'endCap', copy: [{ pattern: 'kit/kp', index: 1 }, { pattern: 'kit/b/p', index: 1 }] })).toThrow(/comes after a tag of this one/);
    expect(form({ feature: 'kit/b/ring', role: 'endCap', copy: [{ pattern: 'kit/b/p', index: 1 }, { pattern: 'kit/kp', index: 1 }, { pattern: 'q', index: 2 }] })).not.toThrow();
    // a field of a role is no ID of a feature: a slash there is the derived ID of a projected point
    expect(form({ feature: 'H', role: 'holeBore', point: 'rim/center' })).not.toThrow();
    // the faces of a chamfer and a fillet (D63) inside an inserted document, and copied there
    expect(form({ feature: 'b1/c', role: 'chamfer', edge: 0 })()).toEqual({ feature: 'b1/c', role: 'chamfer', edge: 0 });
    expect(form({ feature: 'kit/b/f', role: 'fillet', edge: 2, copy: [{ pattern: 'kit/b/p', index: 1 }] })).not.toThrow();
    expect(faceKey({ feature: 'kit/b/f', role: 'fillet', edge: 2, copy: [{ pattern: 'kit/b/p', index: 1 }] } as FaceName)).toBe('kit/' + JSON.stringify('b/' + JSON.stringify('f/fillet/2/@p:1')));
  });

  it('the references of a prefixed name are to its owner, an insertion before the referring feature', () => {
    const copied: FaceName = { feature: 'b1/ring', role: 'endCap', copy: [{ pattern: 'b1/p', index: 1 }, { pattern: 'q', index: 2 }] };
    expect(faceRefs(copied, 'plane')).toEqual([
      { path: 'plane', id: 'b1', kind: 'insertion' },
      { path: 'plane', id: 'b1', kind: 'insertion' },
      { path: 'plane', id: 'q', kind: 'pattern' },
    ]);
    const doc = run(host(), { type: 'addFeature', feature: emptySketch('onRing', 'onRing', { kind: 'face', body: 'b1/ring', face: { feature: 'b1/ring', role: 'endCap' } }) });
    expect(featureRefs(doc.features.at(-1) as never)).toEqual(['b1']);
    // the owner a feature that names faces but no insertion; an insertion after the referring feature
    const plain = run(doc, { type: 'addFeature', feature: emptySketch('S2', 'S2', XY) }, { type: 'addFeature', feature: { id: 'upper', name: 'upper', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S2', regions: [{ outerLoop: ['x'] }] }, extent: { type: 'distance', start: 0, distance: 1 }, operation: 'new' } });
    refused(plain, { type: 'addFeature', feature: emptySketch('x', 'x', { kind: 'face', body: 'upper', face: { feature: 'upper/side', role: 'endCap' } }) }, /feature "upper" není an inserted document/);
    refused(doc, { type: 'addFeature', feature: emptySketch('x', 'x', { kind: 'face', body: 'b1/ring', face: { feature: 'b9/ring', role: 'endCap' } }) }, /feature "b9" neexistuje/);
    refused(doc, { type: 'addFeature', feature: emptySketch('x', 'x', { kind: 'face', body: 'b1/ring', face: { feature: 'b1/ring', role: 'endCap' } }), index: 0 }, /musí ležet před odkazující feature/);
    refused(doc, { type: 'moveFeature', id: 'onRing', index: 0 }, /onRing" by se dostala před feature "b1"/);
  });

  it('a face is found by its key and then compared: a name that reads like a copy of a real one is no reference to it', () => {
    const real: FaceName = { feature: 'ring', role: 'side', curve: 'outer', copy: [{ pattern: 'p', index: 1 }] };
    const alias: FaceName = { feature: 'ring', role: 'side', curve: 'outer/@p:1' };
    // since D68 a text with a slash is quoted in the key, so the two keys differ
    expect(faceKey(alias)).toBe('ring/side/"outer/@p:1"');
    expect(faceKey(alias)).not.toBe(faceKey(real));
    expect(sameFaceName(alias, real)).toBe(false);
    const table = { faceIds: new Map([[faceKey(real), 0]]), faceNames: [real] };
    expect(faceNumber(table, real)).toBe(0);
    expect(faceNumber(table, alias)).toBeUndefined();
    // the comparison after the look-up stays: a table whose key points at another name does not
    // answer that name for the key
    const crossed = { faceIds: new Map([[faceKey(alias), 0]]), faceNames: [real] };
    expect(faceNumber(crossed, alias)).toBeUndefined();
    const other: FaceName = { feature: 'ring', role: 'startCap' };
    expect(sameEdgeName({ a: real, b: other }, { a: other, b: real })).toBe(true);
    expect(sameEdgeName({ a: alias, b: other }, { a: real, b: other })).toBe(false);
  });
});

describe('the environment of the parameters of a stored document', () => {
  it('every parameter by name in sorted order with its value or its error, written without loss; −0 is not 0', () => {
    expect(losslessNumber(-0)).toBe('-0');
    expect(losslessNumber(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(losslessNumber(1e21)).toBe('1e+21');
    const text = (...parameters: [string, string][]) => environmentText(evaluateParameters(parameters.map(([name, expr]) => ({ name, expr }))));
    expect(text(['D', '22'], ['B', '7'])).toBe(text(['B', '7'], ['D', '20 + 2']));
    expect(text(['D', '-0'])).not.toBe(text(['D', '0']));
    expect(text(['D', 'x'])).toBe(JSON.stringify([['D', ['unknownName', 'unknown name "x"']]]));
    // what the step writes reads back as the same number
    for (const value of [-0, 0.1 + 0.2, 1e21, -1.5e-7, 22]) expect(Object.is(evaluateParameters([{ name: 'v', expr: losslessNumber(value) }]).v.ok ? (evaluateParameters([{ name: 'v', expr: losslessNumber(value) }]).v as { value: number }).value : NaN, value)).toBe(true);
  });
});

describe('an engine without adapters', () => {
  const solver = { solve: () => ({ status: 'failed', points: {}, radii: {}, degreesOfFreedom: 0, conflicting: [], redundant: [] }) } as SketchSolver;
  const newEngine = (): Engine => createEngine({ solver, kernel: {} as SolidKernel });

  it('a stored document no feature inserts is listed with an empty usedBy; an insertion of a missing document is a broken reference', () => {
    const engine = newEngine();
    const result = engine.execute({ type: 'addDocument', id: 'bearing', document: part(), name: '608.json' });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.evaluation.documents).toEqual({
      bearing: {
        name: '608.json',
        parameters: [
          { name: 'D', expr: '22', value: 22 },
          { name: 'd', expr: '8', value: 8 },
          { name: 'kind', expr: '1', value: 1 },
          { name: 'type', expr: '2', value: 2 },
          { name: 'generator', expr: '3', value: 3 },
        ],
        features: 3,
        usedBy: [],
      },
    });
    const saved = JSON.parse(JSON.stringify(host()));
    saved.documents = {};
    const loaded = engine.load(JSON.stringify(saved));
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.state.evaluation.features.b1).toMatchObject({ status: 'error', error: { code: 'brokenReference', refs: [{ document: 'bearing' }] } });
  });
});

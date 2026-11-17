// Package 3c written out as calls: its part of validation scenario 13 (the arm), two ball bearings
// and a cable clip as documents inserted as parts. Only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is a hole in the
// contract. After the implementation it becomes a part of
// `packages/scenarios/test/scenario13.test.ts`.
//
// The model is the arm of `packages/scenarios/test/arm.ts` after the parts of 3a, 5a, 3b and 3e:
// the bodies `base` (radius 30, z from −10 to 0, with the shoulder pin of radius 4 up to z = 8),
// `upper` (radius 70 about (60, 0), z from 0 to 8, with holes of radius 4 at the shoulder (0, 0)
// and the elbow (120, 0)), `forearm` (radius 70 about (180, 0), z from 8 to 16, with the elbow pin
// of radius 4 from z = 0), the motor placed from a stored mesh, the screws, the inserts of 3e in
// `upper` (label `M3x3x4.5 heat-set insert` with the catalog of today) and the feet; the sketch
// `layout` with the points `shoulder` and `elbow`; the links `base`, `upper`, `forearm` and the
// joints `shoulder` and `elbow`.
//
// The sizes of the bearing (8 × 22 × 7, the nominal sizes of a 608) and its mass (12 g) are test
// values, not taken from a catalog or a data sheet. The numbers in the comments follow from the
// model and become the expectations of the test; those measured by the spike of the design
// (design.md, "Measured") are marked so.

import type { Command, Engine, FaceName, HoleShape, Id, Input, PartsList, PlaneRef } from '../../../packages/engine/src/index';
import { emptySketch, shapeOrigin } from '../../../packages/engine/src/index';
import type { FaceNameAfter3b } from '../3b-mesh-import/contract';
import type { CommandAfter3c, DocumentAfter3c, EngineAfter3c, EngineStateAfter3c, InsertDocumentAnswer, InsertFeature, StoredDocumentShown, StoredDocumentSummary } from './contract';
import { DOCUMENT_INSERT_STEP, INSERT_FIELDS, MAX_INSERT_DEPTH, faceKeyAfter3c, insertedFaceName, insertedFeature } from './contract';

declare const engine: EngineAfter3c; // the arm
declare const bearingShop: Engine; // an engine of its own for each part, as a library of parts would hold them
declare const clipShop: Engine;
declare const workshop: EngineAfter3c; // a second engine with this package, for a document that inserts another
declare const spare: EngineAfter3c; // a third, for loads that should not change `engine`
// The saved text of a document as `master` before 3b and 3c writes it: the sections `meshes` and
// `documents` left out and the schema version of that `master` (6). A build of the same sources
// cannot save an older version, so the older file is made from the newer one.
declare function asSavedByMaster(json: string): unknown;
declare function fail(message: string): never;
// The hole of a heat-set insert of the given thread from the catalog, as the part of 3e takes it
// (`hardwareHole` with the first row of that thread): its shape, its label and its depth.
declare function insertHole(engine: Engine, thread: number): { shape: Input<HoleShape>; label: string; depth: number };
// A rectangle of its own sketch from (x0, y0) to (x1, y1): four fixed points and the lines
// `<prefix>1` to `<prefix>4`.
declare function rectangle(sketch: Id, prefix: string, x0: number, y0: number, x1: number, y1: number): Command[];

const unwrap = <T>(outcome: { ok: true; result: T } | { ok: false; error: { code: string; message: string } }): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
function run(...commands: CommandAfter3c[]): EngineStateAfter3c {
  const result = engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  return result.ok ? result.state : fail(result.error.message);
}
function preview(...commands: CommandAfter3c[]): EngineStateAfter3c {
  const result = engine.preview(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  return result.ok ? result.state : fail(result.error.message);
}
const refusal = (command: CommandAfter3c): string => {
  const result = engine.execute(command);
  return result.ok ? fail('expected an invalid command') : result.error.message;
};
const shopRun = (shop: Engine, ...commands: Command[]): void => {
  const result = shop.execute({ type: 'batch', commands });
  if (!result.ok) fail(result.error.message);
};
const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const at = (point: Id) => ({ kind: 'sketchPoint', sketch: 'layout', point }) as const;
const insertion = (id: Id, name: string, document: Id, placement: InsertFeature['placement'], more: Partial<Input<InsertFeature>> = {}): CommandAfter3c => ({
  type: 'addFeature',
  feature: { id, name, suppressed: false, type: 'insert', document, placement, ...more },
});
// The key of a face after the package (a face of an insertion quotes its inner key).
const keyOf = (name: FaceNameAfter3b): string => faceKeyAfter3c(name);
const list = (state?: EngineStateAfter3c): PartsList => unwrap(engine.query('partsList', {}, state ? { state } : {}));

// ---------------------------------------------------------------- a. the parts, as documents of their own

// The bearing as a document of its own, modelled where a library of parts would be: a ring of the
// outer diameter `D` and the bore `d`, `B` wide, about the origin of XY, standing on z = 0; a check
// that the wall is there; the body a bought part of 12 g named "608 bearing". Saved as a build
// without this package saves it, so storing it upgrades it.
let bearing: string | undefined;
export function bearingFile(): string {
  if (bearing) return bearing;
  shopRun(
    bearingShop,
    { type: 'setParameter', name: 'd', expr: '8' },
    { type: 'setParameter', name: 'D', expr: '22' },
    { type: 'setParameter', name: 'B', expr: '7' },
    { type: 'setCheck', name: 'wall', expr: 'D > d + 4' },
    { type: 'addFeature', feature: emptySketch('ringSketch', 'Ring', XY) },
    { type: 'addCurve', sketch: 'ringSketch', id: 'outer', curve: { type: 'circle', center: 'origin' }, radius: 11 },
    { type: 'addCurve', sketch: 'ringSketch', id: 'inner', curve: { type: 'circle', center: 'origin' }, radius: 4 },
    { type: 'addConstraint', sketch: 'ringSketch', id: 'outerD', constraint: { type: 'diameter', curve: 'outer', value: 'D', driving: true } },
    { type: 'addConstraint', sketch: 'ringSketch', id: 'innerD', constraint: { type: 'diameter', curve: 'inner', value: 'd', driving: true } },
    {
      type: 'addFeature',
      feature: { id: 'ring', name: 'Ring', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'ringSketch', regions: [{ outerLoop: ['outer'] }] }, extent: { type: 'distance', start: 0, distance: 'B' }, operation: 'new' },
    },
    { type: 'setBodyProperties', body: 'ring', patch: { name: '608 bearing', use: 'reference', mass: 12 } },
  );
  bearing = bearingShop.save();
  return bearing;
}

// A cable clip, printed in PETG: a block 20 × 10 × 4 about the origin of XY with a heat-set insert
// from its top, and the channel the cable takes as an auxiliary body above it (kept free, no part),
// drawn in a sketch of its own (in the sketch of the block its lines would cross the block's).
let clip: string | undefined;
export function clipFile(): string {
  if (clip) return clip;
  const m3 = insertHole(clipShop, 3);
  shopRun(
    clipShop,
    { type: 'addFeature', feature: emptySketch('blockSketch', 'Block', XY) },
    ...rectangle('blockSketch', 'e', -10, -5, 10, 5),
    { type: 'addFeature', feature: emptySketch('channelSketch', 'Channel', XY) },
    ...rectangle('channelSketch', 'c', -10, -2, 10, 2),
    { type: 'addFeature', feature: { id: 'clip', name: 'Cable clip', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'blockSketch', regions: [{ outerLoop: ['e1', 'e2', 'e3', 'e4'] }] }, extent: { type: 'distance', start: 0, distance: 4 }, operation: 'new' } },
    { type: 'addFeature', feature: { id: 'clipHole', name: 'Insert', suppressed: false, type: 'hole', sketch: 'blockSketch', points: ['origin'], shape: m3.shape, extent: { type: 'distance', start: 4, distance: -m3.depth }, targets: ['clip'], label: m3.label } },
    { type: 'addFeature', feature: { id: 'cable', name: 'Cable', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'channelSketch', regions: [{ outerLoop: ['c1', 'c2', 'c3', 'c4'] }] }, extent: { type: 'distance', start: 4, distance: 6 }, operation: 'new' } },
    { type: 'setBodyMaterial', body: 'clip', material: 'PETG' },
    { type: 'setBodyProperties', body: 'cable', patch: { use: 'auxiliary' } },
  );
  clip = clipShop.save();
  return clip;
}

// ---------------------------------------------------------------- b. stored and inserted

// The bearing stored once and inserted twice, at the elbow and at the shoulder, each on the point of
// `layout` and lifted by 0.5 along its normal, so that the ring lies in `upper` (z from 0.5 to 7.5)
// about the pin. (Both points are 10 mm from the rim of `upper`, so a ring of radius 11 stands 1 mm
// out of it, and its seat opens the rim.) The outer diameter at the elbow follows a parameter of the arm. One batch, one
// undo step.
export function inserted(): EngineStateAfter3c {
  return run(
    { type: 'addDocument', id: 'bearing', document: asSavedByMaster(bearingFile()), name: '608.json' },
    { type: 'setParameter', name: 'elbowBearingD', expr: '22' },
    insertion('b1', 'Elbow bearing', 'bearing', { frame: at('elbow'), z: 0.5 }, { parameters: { D: 'elbowBearingD' } }),
    insertion('b2', 'Shoulder bearing', 'bearing', { frame: at('shoulder'), z: 0.5 }),
  );
}

// What came in: one body each, named after the insertion (it brings one body), a bought part of
// 12 g by what the bearing's own document says, with the faces of the document under prefixed names.
// The stored copy is the upgraded document: it has the sections of this build, its own stored
// documents among them.
export function whatCameIn(): boolean {
  const state = inserted();
  const { features, bodies, bodyProperties, documents, faceNames } = state.evaluation;
  const ring = bodyProperties['b1/ring'];
  const stored = state.document.documents['bearing'];
  return (
    features['b1'].status === 'ok' &&
    features['b1'].bodies.join() === 'b1/ring' &&
    features['b2'].bodies.join() === 'b2/ring' &&
    JSON.stringify(features['b1'].facts?.origin) === '[120,0,0.5]' &&
    JSON.stringify(features['b2'].facts?.axisZ) === '[0,0,1]' &&
    ring.name === 'Elbow bearing' &&
    ring.use === 'reference' &&
    ring.mass === 12 &&
    ring.massFrom === 'mass' &&
    ring.fromDocument === 'bearing' &&
    // float32 positions at another place: the volumes differ in the last digits (1.5e-4 mm³, measured by a reviewer)
    Math.abs(bodies['b1/ring'].volume - bodies['b2/ring'].volume) < 1e-6 * bodies['b2/ring'].volume &&
    faceNames.some((name) => keyOf(name) === 'b1/"ring/side/outer"') &&
    faceNames.some((name) => keyOf(name) === 'b2/"ring/startCap"') &&
    stored.name === '608.json' &&
    JSON.stringify(stored.document.documents) === '{}' &&
    JSON.stringify(stored.document.meshes) === '{}' &&
    documents['bearing'].usedBy.join() === 'b1,b2' &&
    documents['bearing'].parameters.map((p) => `${p.name}=${p.value}`).join() === 'd=8,D=22,B=7'
  );
}

// The two insertions are one part: made from one solid of the inserted document (the evaluator
// remembers its recompute, and the elbow's parameter has the value the document has), so they have
// one origin and the parts list counts them in one row.
export function onePart(): boolean {
  const state = engine.getState();
  const a = shapeOrigin(state.evaluation.bodies['b1/ring'].solid);
  const b = shapeOrigin(state.evaluation.bodies['b2/ring'].solid);
  const row = list().bought.find((r) => r.name === '608 bearing') ?? fail('no row of the bearings');
  return a.solid === b.solid && row.count === 2 && row.bodies.join() === 'b1/ring,b2/ring' && row.mass === 12 && row.totalMass === 24;
}

// ---------------------------------------------------------------- c. the seats, from the faces of the bearings

// The seat of each bearing is cut into `upper` from the outer edge of the bearing itself: the edge of
// its outer side with its bottom, projected into a sketch on XY, and a circle of the sketch held on
// it; the seat is open at the top of `upper` and leaves a shoulder of 0.5 under the ring. The rings then sit in `upper` with no collision, and the bores on the pins (measured with a
// copy turned the way an insertion turns a body: nothing in the frame of the sketch, a fit when it is
// turned by 17° or 45°, as round faces meet: "Measured", 3).
const rimOf = (insert: Id): { a: FaceName; b: FaceName } => ({ a: { feature: `${insert}/ring`, role: 'side', curve: 'outer' }, b: { feature: `${insert}/ring`, role: 'startCap' } });
export function seats(): { pairs: number; projected: boolean } {
  const seat = (insert: Id, centre: string, circle: string): CommandAfter3c[] => [
    { type: 'addExternal', sketch: 'seats', id: `${insert}Rim`, ref: { type: 'edge', body: `${insert}/ring`, edge: rimOf(insert), kind: 'circle' } },
    { type: 'addPoint', sketch: 'seats', id: centre, x: 0, y: 0 },
    { type: 'addConstraint', sketch: 'seats', id: `${centre}On`, constraint: { type: 'coincident', a: centre, b: `${insert}Rim/center` } },
    { type: 'addCurve', sketch: 'seats', id: circle, curve: { type: 'circle', center: centre }, radius: 10 },
    { type: 'addConstraint', sketch: 'seats', id: `${circle}Eq`, constraint: { type: 'equalRadius', a: circle, b: `${insert}Rim` } },
  ];
  const state = run(
    { type: 'addFeature', feature: emptySketch('seats', 'Seats', XY) },
    ...seat('b1', 'elbowSeatCentre', 'elbowSeat'),
    ...seat('b2', 'shoulderSeatCentre', 'shoulderSeat'),
    {
      type: 'addFeature',
      feature: { id: 'seatCut', name: 'Bearing seats', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'seats', regions: [{ outerLoop: ['elbowSeat'] }, { outerLoop: ['shoulderSeat'] }] }, extent: { type: 'distance', start: 0.5, distance: 8 }, operation: 'cut', targets: ['upper'] },
    },
  );
  const report = unwrap(engine.query('interference', { bodies: ['upper', 'base', 'forearm', 'b1/ring', 'b2/ring'] }));
  return { pairs: report.pairs.length, projected: state.evaluation.features['seats'].status === 'ok' }; // 0, true
}

// A sketch stands on a planar face of an inserted body, with the frame a sketch on that face of the
// bearing's own document would have, carried by the placement: on the top of the ring at the elbow
// the origin is the centre of the ring at z = 7.5 and the normal points up.
export function onTheBearing(): boolean {
  const state = preview({ type: 'addFeature', feature: emptySketch('onRing', 'On the ring', { kind: 'face', body: 'b1/ring', face: { feature: 'b1/ring', role: 'endCap' } }) });
  const plane = state.evaluation.features['onRing'].plane ?? fail('no plane');
  return JSON.stringify(plane.origin) === '[120,0,7.5]' && JSON.stringify(plane.normal) === '[0,0,1]';
}

// The bearings move with the upper arm: they are bodies of its link like any other.
export function inTheLink(): boolean {
  const upper = engine.getState().document.mechanism.links['upper'];
  const state = run({ type: 'setLink', id: 'upper', bodies: [...upper.bodies, 'b1/ring', 'b2/ring'] });
  return state.evaluation.mechanism.links['upper'].bodies.includes('b1/ring');
}

// An edit before the insertions that keeps the number of faces leaves the inserted bodies the same
// objects (the placed solids are kept, as for a mesh of 3b), so what the queries remember of them
// stays.
export function sameSolid(): boolean {
  const before = engine.getState().evaluation.bodies['b1/ring'].solid;
  const state = preview({ type: 'setField', feature: 'forearm', path: 'extent/distance', value: 9 });
  return state.evaluation.bodies['b1/ring'].solid === before;
}

// ---------------------------------------------------------------- d. parameters of the inserted document

// A larger bearing at the elbow is one parameter of the arm: the ring and its seat grow together, the
// bore and the bearing at the shoulder stay, and the two bearings are now two rows of the list (two
// shapes; both named "608 bearing" by their document, which a reader sees side by side).
export function largerAtTheElbow(): boolean {
  const state = preview({ type: 'setParameter', name: 'elbowBearingD', expr: '24' });
  const report = unwrap(engine.query('interference', { bodies: ['upper', 'forearm', 'b1/ring', 'b2/ring'] }, { state }));
  const bought = list(state).bought.filter((r) => r.name === '608 bearing');
  return (
    state.evaluation.features['b1'].values?.['parameters/D'] === 24 &&
    state.evaluation.bodies['b1/ring'].volume > state.evaluation.bodies['b2/ring'].volume &&
    report.pairs.length === 0 &&
    bought.length === 2 &&
    bought.every((r) => r.count === 1)
  );
}

// A value the bearing's document does not hold up: its check fails and the insertion says so; the
// ring is still there (a wall of 0.5 mm is a ring).
export function thinWall(): boolean {
  const state = preview({ type: 'setParameter', name: 'elbowBearingD', expr: '9' });
  const result = state.evaluation.features['b1'];
  return result.status === 'warning' && result.warnings.some((w) => w.code === 'insertedIssues' && JSON.stringify(w.refs) === '[{"check":"wall"}]') && result.bodies.join() === 'b1/ring';
}

// ---------------------------------------------------------------- e. a printed part with a hole of its own

// The clip on top of the upper arm: its frame is the top face of `upper` (the frame of a sketch on
// it: the origin over the origin of XY, X along +X), 55 mm off the axis of the arm. Only the clip
// comes in, not the cable channel. It is printed in PETG by its document; its insert is counted
// with the inserts of the arm under the one label.
export function theClip(): boolean {
  const before = list();
  const label = before.hardware[0].label; // "M3x3x4.5 heat-set insert"
  const state = run(
    { type: 'addDocument', id: 'clip', document: JSON.parse(clipFile()) },
    insertion('clip', 'Cable clip', 'clip', { frame: { kind: 'face', body: 'upper', face: { feature: 'upper', role: 'endCap' } }, x: 60, y: -55 }, { bodies: ['clip'] }),
  );
  const after = list();
  const inserts = after.hardware.find((row) => row.label === label) ?? fail('no row of the inserts');
  return (
    state.evaluation.features['clip'].bodies.join() === 'clip/clip' &&
    state.evaluation.bodyProperties['clip/clip'].material === 'PETG' &&
    after.printed.some((r) => r.name === 'Cable clip' && r.bodies.join() === 'clip/clip') &&
    inserts.count === before.hardware[0].count + 1 &&
    inserts.holes.some((h) => h.feature === 'clip/clipHole' && h.count === 1)
  );
}

// Without the list both bodies come in; the channel is auxiliary by its document, no part, and the
// collisions still see it.
export function withTheChannel(): boolean {
  const state = preview({ type: 'updateFeature', id: 'clip', patch: { bodies: null } });
  return state.evaluation.features['clip'].bodies.join() === 'clip/clip,clip/cable' && (list(state).auxiliary ?? []).includes('clip/cable');
}

// ---------------------------------------------------------------- f. what is refused, and what breaks

export function refused(): string[] {
  return [
    refusal({ type: 'addDocument', id: 'bearing', document: JSON.parse(bearingFile()) }), // the section has it
    refusal({ type: 'addDocument', id: 'broken', document: { schemaVersion: 1, features: 'none' } }), // the message of a load
    refusal(insertion('b3', 'Nothing', 'nope', { frame: XY })), // no such stored document
    refusal(insertion('b3', 'Wrong', 'bearing', { frame: XY }, { parameters: { width: 3 } })), // the bearing has no parameter `width`
    refusal({ type: 'removeDocument', id: 'bearing' }), // b1 and b2 insert it
    // a face whose prefixed feature has no insertion as its owner: refused by the owner rule (the
    // body is real)
    refusal({ type: 'addFeature', feature: emptySketch('onNothing', 'x', { kind: 'face', body: 'b1/ring', face: { feature: 'b9/ring', role: 'endCap' } }) }),
    // the owner is a feature that names faces but no insertion
    refusal({ type: 'addFeature', feature: emptySketch('onNothing', 'x', { kind: 'face', body: 'upper', face: { feature: 'upper/side', role: 'endCap' } }) }),
    // a body the stored document cannot make
    refusal({ type: 'setBodyProperties', body: 'b1/typo', patch: { color: '#ff0000' } }),
  ];
}

// A new revision of the bearing, 8 wide: both insertions take it, and the ring at the elbow now
// reaches z = 8.5, 0.5 mm into the forearm, which the collisions say. Previewed, nothing written.
export function revision(): string[] {
  shopRun(bearingShop, { type: 'setParameter', name: 'B', expr: '8' });
  const state = preview({ type: 'replaceDocument', id: 'bearing', document: JSON.parse(bearingShop.save()) });
  shopRun(bearingShop, { type: 'setParameter', name: 'B', expr: '7' });
  const report = unwrap(engine.query('interference', { bodies: ['upper', 'forearm', 'base', 'b1/ring', 'b2/ring'] }, { state }));
  return report.pairs.map((p) => `${p.a}–${p.b}`); // ['b1/ring–forearm'] (the ring at the shoulder rises into nothing)
}

// A stored document that is gone: the insertion loads as a broken reference, the seats after it lose
// their projection, and nothing else is refused.
export function gone(): boolean {
  const saved = JSON.parse(engine.save()) as DocumentAfter3c;
  const { bearing: _gone, ...rest } = saved.documents;
  const loaded = spare.load(JSON.stringify({ ...saved, documents: rest }));
  return loaded.ok && loaded.state.evaluation.features['b1'].status === 'error' && JSON.stringify(loaded.state.evaluation.features['b1'].error?.refs) === '[{"document":"bearing"}]';
}

// ---------------------------------------------------------------- g. the document

// Save and load keep the section, and the model; the version is that of this build, and a stored
// document carries the version it was upgraded to.
export function saved(): boolean {
  const json = engine.save();
  const doc = JSON.parse(json) as DocumentAfter3c;
  const loaded = engine.load(json);
  return loaded.ok && doc.documents['bearing'].document.schemaVersion === doc.schemaVersion && Object.keys(loaded.state.evaluation.bodies).includes('b2/ring');
}

// A load is strict about an entry and judges a stored document as a document.
export function loading(): string[] {
  const doc = JSON.parse(engine.save()) as DocumentAfter3c;
  const withField = { ...doc, documents: { ...doc.documents, bearing: { ...doc.documents['bearing'], source: '/tmp/608.json' } } };
  const newer = { ...doc, documents: { ...doc.documents, bearing: { document: { ...doc.documents['bearing'].document, schemaVersion: 99 } } } };
  const messageOf = (o: object): string => {
    const result = spare.load(JSON.stringify(o));
    return result.ok ? fail('expected a refusal') : result.error.message;
  };
  return [
    messageOf(withField), // documents.bearing.source: not a field of a stored document
    messageOf(newer), // documents.bearing.document: the schema version 99 is newer than this build reads (the path from validateDocument(value, what, depth))
  ];
}

// The step of the schema gives an older document the empty section and leaves one that has the
// field to the validation.
export const upgraded = (): boolean => JSON.stringify(DOCUMENT_INSERT_STEP.run({ schemaVersion: 6 }).documents) === '{}' && DOCUMENT_INSERT_STEP.run({ documents: null }).documents === null;

// ---------------------------------------------------------------- h. a document inside a document

// A bearing kit (the bearing inserted into a document of its own) inserted into the arm: the body
// and the faces are prefixed twice, and the feature behind a prefixed ID is found.
export function nested(): boolean {
  const kit = workshop.execute({
    type: 'batch',
    commands: [
      { type: 'addDocument', id: 'bearing', document: JSON.parse(bearingFile()) },
      { type: 'addFeature', feature: { id: 'b', name: 'Bearing', suppressed: false, type: 'insert', document: 'bearing', placement: { frame: XY } } },
    ],
  });
  if (!kit.ok) return fail(kit.error.message);
  const state = preview({ type: 'addDocument', id: 'kit', document: JSON.parse(workshop.save()) }, insertion('kit', 'Kit', 'kit', { frame: XY, x: 300 }));
  const behind = insertedFeature(state.document, 'kit/b/ring');
  const face = insertedFaceName({ feature: 'b/ring', role: 'endCap', copy: [{ pattern: 'b/p', index: 1 }] }, 'kit');
  return (
    state.evaluation.features['kit'].bodies.join() === 'kit/b/ring' &&
    behind?.feature.type === 'extrude' &&
    keyOf(face) === 'kit/"b/\\"ring/endCap/@p:1\\""' &&
    MAX_INSERT_DEPTH === 8
  );
}

// ---------------------------------------------------------------- i. MCP

// What the tool `insert_document` answers about the bearing, and what get_document and get_model
// show of the section.
export function answered(answer: InsertDocumentAnswer): boolean {
  return (
    answer.document === 'bearing' &&
    answer.parameters.length === 3 &&
    answer.bodies.length === 1 &&
    answer.bodies[0].use === 'reference' &&
    answer.bodies[0].mass === 12 &&
    answer.next.command.type === 'addFeature' &&
    INSERT_FIELDS.some((f) => f.path === 'parameters/*')
  );
}
export function shown(document: StoredDocumentShown, model: StoredDocumentSummary): boolean {
  return document.features === 2 && document.documents === 0 && model.parameters['D'] === 22 && model.usedBy.join() === 'b1,b2';
}

// Package 3b written out as calls: its part of validation scenario 13 (the arm), the motor as the
// mesh of a bought part. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that
// cannot be written here is a hole in the contract. Lines marked `@ts-expect-error` are calls that
// must not compile. After the implementation it becomes a part of
// `packages/scenarios/test/scenario13.test.ts`.
//
// The model is the arm of `packages/scenarios/test/arm.ts` after the parts of 3a and 5a: the
// bodies `base`, `upper`, `forearm`, `motor` (a cylinder of radius 14 from z = 8 to 38 at (60, 0),
// a named reference part of 280 g, in the link `upper`), `screw` and its copies; the sketch
// `motorSketch` on the base plane XY with the point `motorCentre` at (60, 0); the sketch `layout`
// with the points `shoulder` and `elbow`; two revolute joints. The forearm lies from z = 8 to 16
// and runs into the motor when the elbow is turned beyond about a quarter turn.
//
// The numbers in the comments that come from the spike of the design (design.md, "Measured") are
// marked so; the others follow from the model and become the expectations of the test.

import type { Command, Engine, Id, InterferenceReport, Vec3 } from '../../../packages/engine/src/index';
import type {
  CommandAfter3b,
  DocumentAfter3b,
  EngineAfter3b,
  EngineStateAfter3b,
  FaceNameAfter3b,
  ImportMeshAnswer,
  ImportMeshArgs,
  ImportOutcome,
  IndexedMesh,
  MeshFeature,
  MeshReport,
  MeshResult,
  MeshSummary,
  PlaneRefAfter3b,
  StoredMesh,
  StoredMeshShown,
} from './contract';
import { IMPORT_FORMATS, MESHES_INFO, MESH_IMPORT_STEP, MESH_LIMITS, PLACEMENT_FIELDS, importMesh, indexedMesh, meshDefects, meshProblem, storedMesh } from './contract';

declare const engine: EngineAfter3b; // the arm
declare const shop: Engine; // a second engine, in which the part that is "bought" is modelled
declare function fail(message: string): never;
const unwrap = <T>(outcome: { ok: true; result: T } | { ok: false; error: { code: string; message: string } }): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
function run(...commands: CommandAfter3b[]): EngineStateAfter3b {
  const result = engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  return result.ok ? result.state : fail(result.error.message);
}
const refusal = (command: CommandAfter3b): string => {
  const result = engine.execute(command);
  return result.ok ? fail('expected an invalid command') : result.error.message;
};
const read = (outcome: ImportOutcome): { mesh: StoredMesh; report: MeshReport } => (outcome.ok ? outcome : fail(`${outcome.error.code}: ${outcome.error.message}`));
// `takenOver` of the engine (D48), over the document and the command of this package.
declare function takenOver(before: DocumentAfter3b, command: CommandAfter3b): Id[];
// A cylinder along Z from a circle of its own sketch on XY, as `cylinder` of arm.ts builds one.
declare function cylinder(id: Id, x: number, y: number, radius: number, from: number, to: number, operation?: 'new' | 'add' | 'cut', target?: Id): Command[];
// The same triangles as text: `solid`, a `facet` with three `vertex` lines per triangle, `endsolid`.
declare function asciiStl(binary: Uint8Array): Uint8Array;
// A binary STL without its last triangle (the count at byte 80 lowered by one).
declare function withoutLastTriangle(binary: Uint8Array): Uint8Array;
// A box from a rectangle of its own sketch on XY, between two heights.
declare function box(id: Id, x0: number, y0: number, x1: number, y1: number, from: number, to: number): Command[];

const MOTOR_POINT = { kind: 'sketchPoint', sketch: 'motorSketch', point: 'motorCentre' } as const;
const MOTOR_FACE: FaceNameAfter3b = { feature: 'motor', role: 'mesh' };

// ---------------------------------------------------------------- a. the file of the bought part

// The motor as its maker would publish it: a can of radius 14 and height 30 with a shaft of radius
// 2.5 and length 10 on top, its axis along Z through the origin, standing on z = 0. Modelled in
// the second engine and written as binary STL. (A test has no file of a real motor; this file has
// what matters of one: round faces cut into triangles, a frame of its own, no unit.)
export function motorFile(): Uint8Array {
  const made = shop.execute({ type: 'batch', commands: [...cylinder('can', 0, 0, 14, 0, 30), ...cylinder('shaft', 0, 0, 2.5, 30, 40, 'add', 'can')] });
  return made.ok ? shop.exportMesh('stl', ['can']) : fail(made.error.message);
}

// Reading it: one shell, nothing left out, not turned over; the volume is that of the body the
// file was written from, to the last digit (measured for 22 bodies), and the bounds are its box.
export function readMotor(): boolean {
  const { mesh, report } = read(importMesh('stl', motorFile(), {}, 'motor.stl'));
  const can = shop.getState().evaluation.bodies['can'];
  return (
    report.format === 'stl' &&
    report.about.encoding === 'binary' &&
    report.dropped === 0 &&
    report.shells === 1 &&
    report.cavities === 0 &&
    !report.turnedOver &&
    report.triangles === can.solid.triangles.length / 3 &&
    report.volume === can.volume &&
    report.bounds.min[2] === 0 &&
    report.bounds.max[2] === 40 &&
    report.notes.length === 0 && // one shell, fewer than 20 000 triangles
    mesh.name === 'motor.stl' &&
    meshProblem(indexedMesh(mesh)) === undefined
  );
}

// The same triangles as ASCII give the same stored mesh, text for text; the format tells the two
// apart by the file.
export function asciiIsTheSame(): boolean {
  const binary = read(importMesh('stl', motorFile()));
  const ascii = read(importMesh('stl', asciiStl(motorFile())));
  return ascii.report.about.encoding === 'ascii' && ascii.mesh.positions === binary.mesh.positions && ascii.mesh.triangles === binary.mesh.triangles;
}

// A file in metres: the unit is the caller's word, and the report gives the bounds in millimetres,
// so a wrong unit shows (a motor 0.028 mm wide, or 28 m).
export function inMetres(): Vec3 {
  return read(importMesh('stl', motorFile(), { unit: 'm' })).report.bounds.max; // [14 000, 14 000, 40 000]
}

// What the import refuses, each with a code and a reason the caller can act on.
export function refused(): string[] {
  const codeOf = (outcome: ImportOutcome): string => (outcome.ok ? fail('expected a refusal') : outcome.error.code);
  // a triangle missing: its three edges have one triangle each
  const open = importMesh('stl', withoutLastTriangle(motorFile()));
  const openEdges = open.ok ? fail('expected a refusal') : open.error.defects?.open; // 3
  // two boxes that share an edge, written into one file: that edge has four triangles (measured)
  const made = shop.execute({ type: 'batch', commands: [...box('left', 0, 0, 10, 10, 0, 10), ...box('right', 10, 10, 20, 20, 0, 10)] });
  const shared = made.ok ? importMesh('stl', shop.exportMesh('stl', ['left', 'right'])) : fail(made.error.message);
  const sharedEdges = shared.ok ? fail('expected a refusal') : shared.error.defects?.overused; // 1
  return [
    codeOf(open), // 'notASolid'
    String(openEdges),
    codeOf(shared), // 'notASolid'
    String(sharedEdges),
    codeOf(importMesh('stl', new TextEncoder().encode('not a mesh'))), // 'unreadable'
    codeOf(importMesh('stl', new Uint8Array(0))), // 'unreadable'
    // @ts-expect-error: `unit` is one of the four
    codeOf(importMesh('stl', motorFile(), { unit: 'ft' })), // 'invalidArguments', arg ['unit']
    // @ts-expect-error: no such format
    codeOf(importMesh('step', motorFile())), // 'invalidArguments', arg ['format']
  ];
}

// The checks of a stored mesh are the engine's own, the ones `addMesh` and a load make: a mesh
// built by hand goes through the same function.
export function tetrahedron(): { stored: StoredMesh; insideOut: string | undefined; open: number } {
  const mesh: IndexedMesh = { positions: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]), triangles: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]) };
  const turned: IndexedMesh = { positions: mesh.positions, triangles: Uint32Array.from([0, 1, 2, 0, 3, 1, 1, 3, 2, 0, 2, 3]) };
  const holed: IndexedMesh = { positions: mesh.positions, triangles: mesh.triangles.slice(0, 9) };
  return {
    stored: storedMesh(mesh, 'tetrahedron'), // 48 bytes each: 64 characters of base64
    insideOut: meshProblem(turned), // the volume is not positive
    open: meshDefects(holed).open, // 3
  };
}

// ---------------------------------------------------------------- b. the mesh enters the document

// The stored mesh and the feature that places it, in one batch and one undo step. The feature
// takes the place and the ID of the cylinder that stood for the motor, so the body keeps what the
// document says about `motor`: its properties (a reference part of 280 g, named and dark) and its
// place in the link `upper`. The command says that the ID was taken over (D48).
export function replaceTheMotor(): { state: EngineStateAfter3b; said: Id[] } {
  const { mesh } = read(importMesh('stl', motorFile(), {}, 'motor.stl'));
  const motor: MeshFeature = { id: 'motor', name: 'Motor', suppressed: false, type: 'mesh', mesh: 'nema', placement: { frame: MOTOR_POINT, z: 8 } };
  const index = engine.getState().document.features.findIndex((feature) => feature.id === 'motor');
  const command: CommandAfter3b = { type: 'batch', commands: [{ type: 'removeFeature', id: 'motor' }, { type: 'addMesh', id: 'nema', mesh }, { type: 'addFeature', feature: motor, index }] };
  const said = takenOver(engine.getState().document, command); // ['motor']
  return { state: run(command), said };
}

// What the document and the model then hold.
export function theImportedMotor(): boolean {
  const { document, evaluation } = engine.getState();
  const stored: MeshResult = evaluation.meshes['nema'];
  const body = evaluation.bodies['motor'];
  const face = evaluation.faceNames[body.faces[0].id];
  const facts = evaluation.features['motor'].facts ?? fail('the feature has facts');
  return (
    Object.keys(document.meshes).join() === 'nema' &&
    stored.usedBy.join() === 'motor' &&
    stored.shells === 1 &&
    stored.triangles === body.solid.triangles.length / 3 &&
    evaluation.features['motor'].status === 'ok' &&
    evaluation.features['motor'].bodies.join() === 'motor' &&
    // one face for the whole surface, not planar, and no edge
    body.faces.length === 1 &&
    !body.faces[0].planar &&
    face.role === 'mesh' &&
    evaluation.faceSurfaces[body.faces[0].id].kind === 'general' &&
    body.edges.length === 0 &&
    // where the file has z = 0 … 40 the model has z = 8 … 48, about the point (60, 0)
    body.bounds.min[2] === 8 &&
    body.bounds.max[2] === 48 &&
    (facts.origin as Vec3).join() === '60,0,8' &&
    (facts.axisZ as Vec3).join() === '0,0,1' &&
    Math.abs(body.volume - stored.volume) < 1e-6 * stored.volume && // the same mesh, moved: the positions are rounded to float32 again
    // the properties of the body `motor` are those the cylinder had
    evaluation.bodyProperties['motor'].use === 'reference' &&
    evaluation.bodyProperties['motor'].mass === 280 &&
    evaluation.bodyProperties['motor'].massFrom === 'mass' &&
    evaluation.mechanism.links['upper'].bodies.includes('motor') &&
    engine.getState().canUndo
  );
}

// One undo takes the feature and the stored mesh away again and brings the cylinder back.
export function undone(): boolean {
  engine.undo();
  const { document, evaluation } = engine.getState();
  const back = Object.keys(document.meshes).length === 0 && evaluation.bodies['motor'].faces.length === 3;
  engine.redo();
  return back;
}

// ---------------------------------------------------------------- c. what an imported body is not

// No sketch and no plane stands on it: its face is not planar. The command is valid (the face is
// one the feature names); the feature is in error, as on a cylinder.
export function noPlaneOnIt(): string | undefined {
  const base: PlaneRefAfter3b = { kind: 'face', body: 'motor', face: MOTOR_FACE };
  const preview = engine.preview({ type: 'addFeature', feature: { id: 'onMotor', name: 'On the motor', suppressed: false, type: 'plane', base, offset: 0 } });
  return preview.ok ? preview.state.evaluation.features['onMotor'].error?.code : fail(preview.error.message); // 'nonPlanarFace'
}

// No feature changes it: a hole through the motor, a boss on it, and a cut with two targets of
// which it is one, end in `importedTarget` and change no target. (Measured: flush with a flat of
// a turned imported body, such a tool leaves sheets that no check finds.)
export function noToolOnIt(): boolean {
  const preview = engine.preview({ type: 'batch', commands: [...cylinder('bore', 60, 0, 1, 0, 60, 'cut', 'motor'), ...cylinder('both', 60, 0, 1, 0, 60, 'cut', 'upper')] });
  if (!preview.ok) return fail(preview.error.message);
  const bore = preview.state.evaluation.features['bore'];
  const before = engine.getState().evaluation.bodies['motor'].solid;
  return bore.status === 'error' && (bore.error?.code as string) === 'importedTarget' && JSON.stringify(bore.error?.refs) === '["motor"]' && preview.state.evaluation.bodies['motor'].solid === before && preview.state.evaluation.features['both'].status === 'ok';
}
// Neither does a copy of it made by a pattern: the copy carries the face of the mesh.
export function noToolOnACopy(): string | undefined {
  const preview = engine.preview({
    type: 'batch',
    commands: [
      { type: 'addFeature', feature: { id: 'twin', name: 'Twin', suppressed: false, type: 'pattern', source: { type: 'body', body: 'motor' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'spacing', spacing: 40 } } } },
      ...cylinder('boreTwin', 60, 40, 1, 0, 60, 'cut', 'twin/1'),
    ],
  });
  return preview.ok ? preview.state.evaluation.features['boreTwin'].error?.code : fail(preview.error.message); // 'importedTarget'
}

// ---------------------------------------------------------------- d. what it is for

// The collisions over the sweep of the elbow, as the part of 5a asks them (−135° to 135° by 27°,
// each step previewed, nothing written): the forearm runs into the motor from the same step as
// with the cylinder, 108°, because the can of the file is that cylinder. The shaft stands above
// the forearm and changes nothing.
export function sweepElbow(): { value: number; motor: boolean }[] {
  const out: { value: number; motor: boolean }[] = [];
  for (let degrees = -135; degrees <= 135; degrees += 27) {
    const value = (degrees * Math.PI) / 180;
    const preview = engine.preview({ type: 'setPose', values: { elbow: value } });
    if (!preview.ok) return fail(preview.error.message);
    const report: InterferenceReport = unwrap(engine.query('interference', {}, { state: preview.state }));
    out.push({ value, motor: report.pairs.some((pair) => pair.a === 'forearm' && pair.b === 'motor') });
  }
  return out; // false up to 81°, true from 108° on, on both sides
}

// The smallest gap between the forearm and the motor with the elbow at 1.2, measured to the
// triangles of the mesh in the pose (15.04 with the cylinder, the part of 5a).
export function gapToTheMotor(): number {
  const preview = engine.preview({ type: 'setPose', values: { elbow: 1.2 } });
  if (!preview.ok) return fail(preview.error.message);
  const report = unwrap(engine.query('gap', { bodies: ['forearm', 'motor'] }, { state: preview.state }));
  return report.pairs[0].distance;
}

// The mass of what hangs beyond the shoulder is what it was: the motor weighs what its data sheet
// says, whatever the volume of its mesh.
export function massBeyondTheShoulder(): number {
  const carried = engine.getState().evaluation.mechanism.links['upper'].bodies;
  return unwrap(engine.query('mass', { bodies: [...carried, 'forearm'] })).mass;
}

// An overlap with an imported body shallower than the chord tolerance is a fit, not a collision:
// its surface counts as round (measured: 0.005 mm into a plate is a fit, 0.02 mm a collision).
// Here: the motor lowered by 0.005 into the link it stands on.
export function sunkABit(): { fits: number; pairs: number } {
  const preview = engine.preview({ type: 'setField', feature: 'motor', path: 'placement/z', value: 7.995 });
  if (!preview.ok) return fail(preview.error.message);
  const report = unwrap(engine.query('interference', { bodies: ['upper', 'motor'] }, { state: preview.state }));
  return { fits: report.fits.length, pairs: report.pairs.length }; // 1, 0
}

// The exports: the motor is a reference part, so a print export without a list leaves it out; a
// list that names it writes it, as an object with its name.
export function exported(): boolean {
  const printed = unwrap(engine.export('stl', {}));
  const listed = unwrap(engine.export('3mf', { bodies: ['upper', 'motor'] }));
  const bodiesOf = (about: unknown): Id[] => (about as { bodies: Id[] }).bodies;
  return !bodiesOf(printed.files[0].about).includes('motor') && bodiesOf(listed.files[0].about).join() === 'upper,motor';
}

// ---------------------------------------------------------------- e. the placement

// The six numbers are numeric fields: a turn about the normal as an expression in degrees, an
// offset by `setField` where the feature had none. Only the mesh feature and what comes after it
// is computed again; the stored mesh is not decoded again.
export function turned(): boolean {
  const state = run({ type: 'updateFeature', id: 'motor', patch: { placement: { rz: 'deg(90)' } } }, { type: 'setField', feature: 'motor', path: 'placement/x', value: 2 });
  const motor = state.document.features.find((feature) => feature.id === 'motor') as MeshFeature;
  const facts = state.evaluation.features['motor'].facts ?? fail('the feature has facts');
  const [axisX, origin] = [facts.axisX as Vec3, facts.origin as Vec3];
  return (
    Math.abs((motor.placement.rz ?? 0) - Math.PI / 2) < 1e-12 &&
    motor.expressions?.['placement/rz'] === 'deg(90)' &&
    motor.placement.x === 2 &&
    motor.placement.y === undefined && // absent means 0 and is not stored
    // the X axis of the mesh now points along +Y of the model; the offset is in the frame, not in the turned part
    Math.abs(axisX[1] - 1) < 1e-12 &&
    origin.join() === '62,0,8' &&
    PLACEMENT_FIELDS.length === 6
  );
}

// The order of the turns: first about X, then about Y, then about the normal, the axes of the
// frame staying where they are. With rx = 90° and rz = 90° the Z axis of the mesh ends along +X:
// X takes it to −Y, and the normal then turns −Y to +X.
export function order(): Vec3 {
  const preview = engine.preview({ type: 'updateFeature', id: 'motor', patch: { placement: { rx: 'deg(90)', ry: null, rz: 'deg(90)' } } });
  return preview.ok ? ((preview.state.evaluation.features['motor'].facts ?? fail('the feature has facts')).axisZ as Vec3) : fail(preview.error.message); // [1, 0, 0]
}

// A frame that is not there: the error of the feature, with the frame in `refs`.
export function lostFrame(): string | undefined {
  const preview = engine.preview({ type: 'removeFeature', id: 'motorSketch' });
  return preview.ok ? preview.state.evaluation.features['motor'].error?.code : fail(preview.error.message); // 'brokenReference'
}

// ---------------------------------------------------------------- f. one stored mesh, several bodies

// A second motor from the same stored mesh: a feature and no data. Upside down under the link,
// on a planar face of it.
export function secondMotor(): boolean {
  const before = JSON.stringify(engine.getState().document.meshes).length;
  const under: PlaneRefAfter3b = { kind: 'face', body: 'upper', face: { feature: 'upper', role: 'startCap' } };
  const state = run(
    { type: 'addFeature', feature: { id: 'motor2', name: 'Motor 2', suppressed: false, type: 'mesh', mesh: 'nema', placement: { frame: under, x: 20 } } },
    { type: 'setBodyProperties', body: 'motor2', patch: { use: 'reference', mass: 280 } },
  );
  return JSON.stringify(state.document.meshes).length === before && state.evaluation.meshes['nema'].usedBy.join() === 'motor,motor2' && state.evaluation.bodies['motor2'].bounds.max[2] === 0; // the normal of that face points down
}

// A stored mesh in use is not removed; unused, it is listed as such and removed.
export function removing(): { refused: string; unused: Id[]; left: number } {
  const refused = refusal({ type: 'removeMesh', id: 'nema' }); // names the features `motor` and `motor2`
  const spare = read(importMesh('stl', motorFile(), {}, 'spare.stl')).mesh;
  const state = run({ type: 'addMesh', id: 'spare', mesh: spare });
  const unused = Object.entries(state.evaluation.meshes).filter(([, mesh]) => mesh.usedBy.length === 0).map(([id]) => id); // ['spare']
  const left = Object.keys(run({ type: 'removeMesh', id: 'spare' }).document.meshes).length; // 1
  return { refused, unused, left };
}

// What the commands refuse (each compiles: the engine validates them).
export const refusedCommands = (): string[] => [
  refusal({ type: 'addMesh', id: 'nema', mesh: tetrahedron().stored }), // the section has that ID
  refusal({ type: 'addMesh', id: 'a/b', mesh: tetrahedron().stored }), // not an ID
  refusal({ type: 'addMesh', id: 'bad', mesh: { positions: 'AAAA', triangles: 'AAAA' } }), // not a mesh: 3 bytes are no triple of numbers
  refusal({ type: 'addMesh', id: 'bad', mesh: { ...tetrahedron().stored, colour: '#ff0000' } as StoredMesh }), // a field a stored mesh does not have
  refusal({ type: 'removeMesh', id: 'none' }),
  refusal({ type: 'addFeature', feature: { id: 'ghost', name: 'Ghost', suppressed: false, type: 'mesh', mesh: 'none', placement: { frame: { kind: 'base', plane: 'XY' } } } }), // no such stored mesh
  refusal({ type: 'updateFeature', id: 'motor', patch: { mesh: 'none' } }),
  refusal({ type: 'updateFeature', id: 'motor', patch: { placement: { rz: 7 } } }), // a turn is within ±2π
  refusal({ type: 'setField', feature: 'motor', path: 'placement/scale', value: 2 }), // no such field
];

// ---------------------------------------------------------------- g. save and load

// The section is in the saved document, the data as two texts; a build of `master` after the
// merge saves version 7.
export function saved(): boolean {
  const json = engine.save();
  const document = JSON.parse(json) as DocumentAfter3b;
  const loaded = engine.load(json);
  return (
    MESH_IMPORT_STEP.name === '3b-mesh-import' &&
    typeof document.meshes['nema'].positions === 'string' &&
    document.meshes['nema'].name === 'motor.stl' &&
    loaded.ok &&
    loaded.state.evaluation.bodies['motor'].solid.triangles.length === engine.getState().evaluation.bodies['motor'].solid.triangles.length
  );
}

// What a load refuses and what it lets through.
export function loading(): string[] {
  const document = JSON.parse(engine.save()) as DocumentAfter3b;
  const answer = (changed: unknown): string => {
    const result = engine.load(JSON.stringify(changed));
    return result.ok ? (result.state.evaluation.features['motor']?.error?.code ?? 'ok') : result.error.message;
  };
  const holed = storedMesh({ positions: indexedMesh(document.meshes['nema']).positions, triangles: indexedMesh(document.meshes['nema']).triangles.slice(3) });
  return [
    answer({ ...document, meshes: { nema: holed } }), // refused: the mesh is not closed, 3 edges with one triangle
    answer({ ...document, meshes: { nema: { ...document.meshes['nema'], faces: 'AAAA' } } }), // refused: a field this build does not know
    answer({ ...document, meshes: {} }), // loads: 'brokenReference', the feature `motor` names a mesh that is not there
    answer({ ...document, meshes: undefined, schemaVersion: 6, schemaSteps: undefined, features: [], bodyProperties: {}, mechanism: { links: {}, joints: {} } }), // loads ('ok'): the step gives a document of version 6 the empty section
  ];
}

// ---------------------------------------------------------------- h. MCP and the description

// The tool of the server: the path of the file, and nothing of the mesh in the call.
export const overMcp: ImportMeshArgs = { path: '~/parts/nema17.stl', options: { unit: 'mm' } };
// Its answer: what was stored, what the import found, and the command that places it, for the
// caller to change (the frame, the offsets, the mass) and send with `execute`.
export function answered(answer: ImportMeshAnswer): boolean {
  const { command } = answer.next;
  return answer.mesh === 'nema17' && answer.report.shells >= 1 && command.type === 'batch' && command.commands.length === 2 && command.commands[0].type === 'addFeature' && command.commands[1].type === 'setBodyProperties';
}
// `get_document` prints the stored mesh without its data, `get_model` a line per stored mesh.
export function shown(): { document: StoredMeshShown; model: MeshSummary } {
  const { document, evaluation } = engine.getState();
  const [stored, result] = [document.meshes['nema'], evaluation.meshes['nema']];
  const size = result.bounds.max.map((high, axis) => high - result.bounds.min[axis]) as Vec3; // about [28, 28, 40]
  return {
    document: { name: stored.name, omitted: `positions and triangles: ${stored.positions.length + stored.triangles.length} characters of base64; save_document writes them` },
    model: { id: 'nema', name: result.name, triangles: result.triangles, size, usedBy: result.usedBy },
  };
}
// The description for the AI: the section with its commands, the formats with their extensions
// and options, the limit.
export const described = (): boolean =>
  MESHES_INFO.commands.join() === 'addMesh,removeMesh' && IMPORT_FORMATS.stl.extensions.join() === 'stl' && Object.keys(IMPORT_FORMATS.stl.options).join() === 'unit' && MESH_LIMITS.triangles === 100_000;

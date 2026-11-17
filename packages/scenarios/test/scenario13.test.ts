// Validation scenario 13 (D36, docs/d36/3a-body-properties/calls.ts and the calls of 5a): a link of
// an arm between two joints, against the real adapters. Package 3a (D48) writes its part: "bodies
// with materials and a motor as a reference part with the mass of its data sheet", and what the
// mass query, the print exports, the print query and the IDs a section names do with them. The
// part of 5a (D49): "two revolute joints; the pose stepped through the range of one joint with the
// collisions asked at each step; the mass of what hangs beyond the first joint", with what is posed,
// what stays as modelled and a joint in error (docs/d36/5a-mechanism/calls.ts). The part of 3e
// (D57): "what to print and what to buy", the query `partsList` and the file `partsCsv` over the
// arm with inserts under the screws and three feet (docs/d36/3e-parts-list/calls.ts). The part of 5b
// (D59): "the arm as URDF and as MJCF" with the drive of each joint (docs/d36/5b-robot-export/calls.ts);
// its picture of a pose that is not written is in packages/mcp/test/view-image.test.ts.
// The part of 3b (D55): the motor as the mesh of a bought part, read from an STL file and placed at
// the centre of its bolt pattern (docs/d36/3b-mesh-import/calls.ts).
//
// The model, every shape a cylinder along Z from a circle of its own sketch on XY (mm):
// - `base`: a plate below z = 0 with a pin of radius 4 at the shoulder (0, 0), up to z = 8.
// - `upper`, the link: a plate from z = 0 to 8 around (60, 0) with a hole of radius 4 at the
//   shoulder and at the elbow (120, 0).
// - `forearm`: a plate from z = 8 to 16 beyond the elbow, with a pin down into the elbow hole.
// - `layout`: the sketch of the two axes the joints of 5a turn about.
// - `motor`: a block on top of `upper`, from z = 8 to 38, around (60, 0).
// - `screw` and the pattern `screws` that copies it three times about the centre of the motor.
import { type Command, type ExportFile, type Exported, NO_MECHANISM, ROBOT_FILES, ROBOT_REFUSALS, type RobotAbout, type RobotMeshAbout, DATA_CATALOGS, type Engine, GENERATORS, type EngineState, type HoleShape, type Id, type Input, type MassProperties, PARTS_CSV, type PartRow, type PartsCsvAbout, type PartsList, QUERIES, emptySketch, type SolidKernel, SCHEMA_PENDING, UPGRADES, carriedBy, createEngine, takenOver, namedBySections, poseNote, printedBodies, bodyPropertiesWithoutBody, SECTION_INFO, IMPORT_FORMATS, type ImportOutcome, type IndexedMesh, MESH_LIMITS, type MeshFeature, type MeshReport, PLACEMENT_FIELDS, type StoredMesh, importMesh, indexedMesh, meshDefects, meshProblem, shellsOf, storedMesh, withoutWalls, type CommandResult, type CombineFeature, FACE_ROLES, FEATURE_TYPE_INFO, type FaceName, type PlaneRef, type SplitFeature, type Surface, faceKey, INSERT_FIELDS, MAX_INSERT_DEPTH, insertedFaceName, insertedFeature, shapeOrigin } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import { arm, cylinder } from './arm';
import type { AxisRef, CommandResult as Outcome, FaceName as Face, Frame, PlaneFeature, PlaneRef as Plane, Vec3 } from '@trymesh/engine';
import { newEngine, run } from './kit';

const refusal = (engine: Engine, command: Command): string => {
  const result = engine.execute(command);
  if (result.ok) throw new Error(`expected ${command.type} to be refused`);
  return result.error.message;
};
const massOf = (engine: Engine, args: object, options = {}): MassProperties => {
  const outcome = engine.query('mass', args as never, options);
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome.result;
};
const volumeOf = (state: EngineState, body: Id): number => state.evaluation.bodies[body].volume;
const near = (actual: number | undefined, expected: number, digits = 6) => expect(actual).toBeCloseTo(expected, digits);
const LINK = ['upper', 'motor', 'screw', 'screws/1', 'screws/2', 'screws/3'];

describe('scenario 13, the part of 3a: bodies with materials, and a motor as a reference part with the mass of its data sheet', () => {
  let engine: Engine;
  beforeAll(() => {
    engine = newEngine();
    const state = run(engine, arm());
    expect(Object.keys(state.evaluation.bodies)).toEqual(['base', 'upper', 'forearm', 'motor', 'screw', 'screws/1', 'screws/2', 'screws/3']);
  });

  it('a. the catalog fills the fields: the label and the density of the data sheet, in one batch and one undo step', () => {
    expect(DATA_CATALOGS.materials.rows.PETG).toMatchObject({ density: 1.27, source: expect.stringContaining('Prusament PETG') });
    const forAi = engine.query('catalog', { name: 'materials' });
    expect(forAi.ok && Object.keys(forAi.result.rows)).toEqual(['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PC']);
    const state = run(engine, { type: 'batch', commands: [{ type: 'setBodyMaterial', body: 'base', material: 'PETG' }, { type: 'setBodyMaterial', body: 'upper', material: 'PETG' }, { type: 'setBodyMaterial', body: 'forearm', material: 'PLA' }] });
    expect(state.document.bodyProperties.upper).toEqual({ material: 'PETG', density: 1.27 });
    near(state.evaluation.bodyProperties.upper.mass, (1.27 * volumeOf(state, 'upper')) / 1000);
    expect(refusal(engine, { type: 'setBodyMaterial', body: 'upper', material: 'unobtainium' })).toMatch(/its rows are PLA, PETG, ABS, ASA, TPU, PC/);
    // PA12 has no row: neither Prusament nor Bambu Lab makes an unfilled PA12
    expect(refusal(engine, { type: 'setBodyMaterial', body: 'upper', material: 'PA12' })).toMatch(/has no row "PA12"/);
  });

  it('b. the motor is a named, dark reference part with the mass of its data sheet; its volume and a density would give another', () => {
    const state = run(engine, { type: 'setBodyProperties', body: 'motor', patch: { name: 'NEMA 17 motor', color: '#30343a', use: 'reference', mass: 280 } });
    expect(state.evaluation.bodyProperties.motor).toEqual({ name: 'NEMA 17 motor', color: '#30343a', use: 'reference', mass: 280, massFrom: 'mass' });
  });

  it('b. the screws: only the source is given properties, the copies take them over, so no copy is printed by mistake', () => {
    let state = run(engine, { type: 'setBodyProperties', body: 'screw', patch: { use: 'reference', material: 'steel', mass: 0.9 } });
    expect(state.evaluation.bodyProperties['screws/2']).toEqual({ name: 'Screws / 2', material: 'steel', use: 'reference', mass: 0.9, massFrom: 'mass', from: 'screw' });
    state = run(engine, { type: 'setBodyProperties', body: 'screws/2', patch: { color: '#000000' } });
    expect(state.evaluation.bodyProperties['screws/2']).toMatchObject({ color: '#000000', use: 'reference', mass: 0.9 });
    // a copy in another material (PC; the design had PA12, which the catalog has not): the pair goes with it
    state = run(engine, { type: 'setBodyMaterial', body: 'screws/3', material: 'PC' });
    expect(state.evaluation.bodyProperties['screws/3']).toMatchObject({ material: 'PC', use: 'reference', massFrom: 'density', density: 1.22 });
    near(state.evaluation.bodyProperties['screws/3'].mass, (1.22 * volumeOf(state, 'screws/3')) / 1000);
  });

  it('b. an effective density by an expression over a parameter follows the parameter, in the same undo step', () => {
    let state = run(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'infill', expr: '0.45' }, { type: 'setBodyProperties', body: 'upper', patch: { density: '1.27 * infill' } }] });
    expect(state.document.bodyProperties.upper).toEqual({ material: 'PETG', density: 0.5715, expressions: { density: '1.27 * infill' } });
    state = run(engine, { type: 'setParameter', name: 'infill', expr: '0.6' });
    near(state.document.bodyProperties.upper.density, 0.762, 12);
    near(state.evaluation.bodyProperties.upper.mass, (0.762 * volumeOf(state, 'upper')) / 1000);
  });

  it('b. a weighed mass wins over the density and leaves it in place; a mass that stops evaluating leaves the body without one', () => {
    expect(run(engine, { type: 'setBodyProperties', body: 'upper', patch: { mass: 41.5 } }).evaluation.bodyProperties.upper.massFrom).toBe('mass');
    expect(run(engine, { type: 'setBodyProperties', body: 'upper', patch: { mass: null } }).evaluation.bodyProperties.upper.massFrom).toBe('density');
    run(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'scale', expr: '41.5' }, { type: 'setBodyProperties', body: 'upper', patch: { mass: 'scale' } }] });
    let state = run(engine, { type: 'removeParameter', name: 'scale' });
    expect(state.evaluation.bodyProperties.upper).toMatchObject({ density: 0.762, fieldErrors: { mass: { message: 'unknown name "scale"' } } });
    expect(state.evaluation.bodyProperties.upper.mass).toBeUndefined();
    expect(state.document.bodyProperties.upper.mass).toBe(41.5);
    // the mass query fails for it and names it, instead of weighing it by a density
    expect(engine.query('mass', { bodies: ['upper'], density: 1 })).toMatchObject({ ok: false, error: { code: 'failed', message: expect.stringContaining('the mass of the body "upper" in its properties cannot be evaluated: unknown name "scale"') } });
    // a density the call names for the body wins over its properties, also over one in error
    const named = massOf(engine, { bodies: ['upper'], densities: { upper: 1.2 } });
    expect(named.bodies[0]).toMatchObject({ from: 'densities', density: 1.2 });
    near(named.mass, (1.2 * volumeOf(state, 'upper')) / 1000);
    // the same for a copy that inherits the pair of its source
    run(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'perScrew', expr: '0.9' }, { type: 'setBodyProperties', body: 'screw', patch: { mass: 'perScrew' } }] });
    state = run(engine, { type: 'removeParameter', name: 'perScrew' });
    expect(state.evaluation.bodyProperties['screws/1']).toMatchObject({ fieldErrors: { mass: { message: 'unknown name "perScrew"' } } });
    expect(state.evaluation.bodyProperties['screws/1'].mass).toBeUndefined();
    // put right for what follows
    run(engine, { type: 'batch', commands: [{ type: 'setBodyProperties', body: 'upper', patch: { mass: null } }, { type: 'setBodyProperties', body: 'screw', patch: { mass: 0.9 } }] });
  });

  it('b. what the commands refuse', () => {
    const messages = (
      [
        { type: 'setBodyProperties', body: 'nope', patch: { use: 'reference' } },
        { type: 'setBodyProperties', body: 'screws/0', patch: { use: 'reference' } },
        { type: 'setBodyProperties', body: 'upper', patch: { density: 1240 } },
        { type: 'setBodyProperties', body: 'upper', patch: { density: 'nope * 2' } },
        { type: 'setBodyProperties', body: 'upper', patch: { color: 'red' } },
        { type: 'removeBodyProperties', body: 'nope' },
      ] as Command[]
    ).map((command) => refusal(engine, command));
    expect(messages).toEqual([
      expect.stringContaining('no feature of the document creates the body "nope"'),
      expect.stringContaining('does not create a body "screws/0"'),
      expect.stringContaining('the value 1240 is not in the interval (0, 25]'),
      expect.stringContaining('unknown name "nope"'),
      expect.stringContaining('#rrggbb'),
      expect.stringContaining('no properties of the body "nope"'),
    ]);
  });

  it('c. the mass query reads the properties: the link with its motor as one piece, the motor with 280 g', () => {
    const state = engine.getState();
    const link = massOf(engine, { bodies: LINK });
    expect(link.bodies.map((body) => [body.body, body.from])).toEqual([
      ['upper', 'density'],
      ['motor', 'mass'],
      ['screw', 'mass'],
      ['screws/1', 'mass'],
      ['screws/2', 'mass'],
      ['screws/3', 'density'],
    ]);
    const expected = (0.762 * volumeOf(state, 'upper')) / 1000 + 280 + 3 * 0.9 + (1.22 * volumeOf(state, 'screws/3')) / 1000;
    near(link.mass, expected, 4);
    // a body that states neither fails the query and is named; a density given for such bodies serves
    expect(engine.query('mass', { bodies: ['base', 'forearm', 'motor'] })).toMatchObject({ ok: true });
    run(engine, { type: 'removeBodyProperties', body: 'forearm' });
    expect(engine.query('mass', { bodies: ['forearm'] })).toMatchObject({ ok: false, error: { code: 'invalidArguments', message: expect.stringContaining('the body "forearm" has no density of its own') } });
    const pla = DATA_CATALOGS.materials.rows.PLA.density;
    near(massOf(engine, { bodies: ['forearm'], density: pla }).mass, (pla * volumeOf(state, 'forearm')) / 1000);
    run(engine, { type: 'setBodyMaterial', body: 'forearm', material: 'PLA' });
    // a what-if without a change of the document: the link if it were printed in PLA
    const preview = engine.preview({ type: 'setBodyMaterial', body: 'upper', material: 'PLA' });
    expect(preview.ok).toBe(true);
    const ifPla = preview.ok ? massOf(engine, { bodies: ['upper', 'motor'] }, { state: preview.state }) : undefined;
    near(ifPla?.mass, (pla * volumeOf(state, 'upper')) / 1000 + 280, 4);
    expect(engine.getState().document.bodyProperties.upper.density).toBe(0.762);
  });

  it('c. an auxiliary body adds nothing to the mass and is listed apart; it is still checked for collisions', () => {
    const state = run(engine, { type: 'setBodyProperties', body: 'base', patch: { use: 'auxiliary' } });
    expect(state.evaluation.bodyProperties.base.mass).toBeUndefined();
    const answer = massOf(engine, { bodies: ['base', 'motor'], densities: { base: 5 } });
    expect(answer.skipped).toEqual(['base']);
    near(answer.mass, 280);
    expect(engine.query('mass', { bodies: ['base'] })).toMatchObject({ ok: false, error: { code: 'failed', message: expect.stringContaining('every listed body is auxiliary') } });
    expect(engine.interference({ bodies: ['base', 'upper'] }).checked).toBe(1);
    run(engine, { type: 'setBodyProperties', body: 'base', patch: { use: null } });
  });

  it('c. the print export and the print query without a list take the printed bodies; a body the caller lists is taken as listed', () => {
    const state = engine.getState();
    expect(printedBodies(state.evaluation.bodyProperties)).toEqual(['base', 'upper', 'forearm']);
    const exported = engine.export('stl', { perBody: true });
    expect(exported.ok && exported.result.files.map((file) => file.path)).toEqual(['base.stl', 'upper.stl', 'forearm.stl']);
    const motorAnyway = engine.export('stl', { bodies: ['motor'] });
    expect(motorAnyway.ok && motorAnyway.result.files[0].about).toMatchObject({ bodies: ['motor'] });
    // exportMesh without a list: the same three bodies in one file
    const triangles = ['base', 'upper', 'forearm'].reduce((sum, id) => sum + state.evaluation.bodies[id].solid.triangles.length / 3, 0);
    expect(new DataView(engine.exportMesh('stl').buffer).getUint32(80, true)).toBe(triangles);
    const print = engine.query('print', { orientations: [{ by: { up: [0, 0, 1] } }] });
    expect(print.ok && print.result.bodies.map((body) => body.body)).toEqual(['base', 'upper', 'forearm']);
    expect(print.ok && print.result).not.toHaveProperty('empty');
    // with no printed body the print query says why it judged none, as the export does
    const unprinted = engine.preview({ type: 'batch', commands: ['base', 'upper', 'forearm'].map((body): Command => ({ type: 'setBodyProperties', body, patch: { use: 'reference' } })) });
    if (!unprinted.ok) throw new Error(unprinted.error.message);
    const none = engine.query('print', { orientations: [{ by: { up: [0, 0, 1] } }] }, { state: unprinted.state });
    expect(none.ok && none.result).toMatchObject({ bodies: [], empty: expect.stringContaining('the model has no printed body') });
    expect(engine.export('stl', {}, { state: unprinted.state })).toMatchObject({ ok: true, result: { empty: expect.stringContaining('the model has no printed body') } });
  });

  it('c. a change of a property recomputes no geometry, and a result stays the same object while what it is made of does', () => {
    const before = engine.getState().evaluation;
    const after = run(engine, { type: 'setBodyProperties', body: 'forearm', patch: { color: '#4e79a7' } }).evaluation;
    for (const id of Object.keys(before.bodies)) expect(after.bodies[id].solid).toBe(before.bodies[id].solid);
    for (const id of Object.keys(before.features)) expect(after.features[id]).toBe(before.features[id]);
    expect(after.faceNames).toBe(before.faceNames);
    // the results of the bodies the change does not touch are the same objects; the one it touches is new
    for (const id of ['base', 'upper', 'motor', 'screw', 'screws/1']) expect(after.bodyProperties[id]).toBe(before.bodyProperties[id]);
    expect(after.bodyProperties.forearm).not.toBe(before.bodyProperties.forearm);
    // a recompute of an unchanged document (a state after the last feature) gives the same objects
    expect(engine.getState('screws').evaluation.bodyProperties.upper).toBe(after.bodyProperties.upper);
    run(engine, { type: 'setBodyProperties', body: 'forearm', patch: { color: null } });
  });

  it('d. an entry whose body is gone stays, is listed and can be removed; the generators do not hand its ID out', () => {
    const removed = run(engine, { type: 'removeFeature', id: 'motor' });
    expect(bodyPropertiesWithoutBody(removed.document.bodyProperties, removed.evaluation.bodyProperties)).toEqual(['motor']);
    expect(namedBySections(removed.document)).toContain('motor');
    expect(refusal(engine, { type: 'setBodyProperties', body: 'motor', patch: { mass: 300 } })).toMatch(/the feature "motor" is not in the document/);
    const cleaned = run(engine, { type: 'removeBodyProperties', body: 'motor' });
    expect(bodyPropertiesWithoutBody(cleaned.document.bodyProperties, cleaned.evaluation.bodyProperties)).toEqual([]);
    engine.undo();
    engine.undo();
    expect(engine.getState().evaluation.bodyProperties.motor.mass).toBe(280);
  });

  it('d. a feature made again under the ID takes the entry over, and the command says so: also inside one batch', () => {
    const motorAgain = cylinder('motor', 60, 0, 20, 8, 13).at(-1) as Command;
    const before = run(engine, { type: 'removeFeature', id: 'motor' }).document;
    const state = run(engine, motorAgain);
    expect(state.evaluation.bodyProperties.motor).toMatchObject({ use: 'reference', mass: 280 });
    expect(takenOver(before, motorAgain)).toEqual(['motor']);
    const replace: Command = { type: 'batch', commands: [{ type: 'removeFeature', id: 'motor' }, motorAgain] };
    const now = engine.getState().document;
    run(engine, replace);
    expect(takenOver(now, replace)).toEqual(['motor']);
    // a body made and given its properties in one batch takes nothing over
    expect(takenOver(engine.getState().document, { type: 'batch', commands: [...cylinder('washer', 0, 0, 6, 8, 9), { type: 'setBodyProperties', body: 'washer', patch: { use: 'reference' } }] })).toEqual([]);
  });

  it('e. save and load: version 8, the step of the section before those of 5a, 3b and 5c, and a field this build does not know is refused', () => {
    // the steps of 5a, 3b and 5c come after the one of 3a; the branch d36/3c saves the version of
    // master (8) with its pending step, which the merge makes version 9 without names
    expect(SCHEMA_PENDING).toBe(1);
    expect(UPGRADES.map((step) => step.name).slice(3, 7)).toEqual(['3a-body-properties', '5a-mechanism', '3b-mesh-import', '5c-more-planes']);
    const saved = JSON.parse(engine.save());
    expect(saved.schemaVersion).toBe(8);
    expect(saved.schemaSteps).toEqual(['3c-document-insert']);
    const document = engine.getState().document;
    const loaded = engine.load(JSON.stringify(saved));
    expect(loaded.ok && loaded.state.document.bodyProperties).toEqual(document.bodyProperties);
    expect(loaded.ok && loaded.state.evaluation.bodyProperties.motor.mass).toBe(280);
    const tampered = engine.load(JSON.stringify({ ...saved, bodyProperties: { motor: { mass: 280, printOrientation: 'up' } } }));
    expect(tampered).toMatchObject({ ok: false, error: { code: 'invalidDocument', message: expect.stringContaining('printOrientation') } });
  });

  it('f. the description for the AI: the section, its commands and its numeric fields', () => {
    expect(SECTION_INFO.bodyProperties.fields.map((field) => `${field.owner}: ${field.path} (${field.spec.unit})`)).toEqual(['body: density (g/cm3)', 'body: mass (g)']);
  });
});

// ---------------------------------------------------------------- the part of 5a (D49)

const DEG = Math.PI / 180;
const SHOULDER = { kind: 'sketchPoint', sketch: 'layout', point: 'shoulder' } as const;
const ELBOW = { kind: 'sketchPoint', sketch: 'layout', point: 'elbow' } as const;
const elbowJoint = (lower: number | string, upper: number | string, value: number | string = 0): Command => ({ type: 'setJoint', id: 'elbow', joint: { type: 'revolute', parent: 'upper', child: 'forearm', axis: ELBOW, lower, upper, value } });
const mechanismOfTheArm = (): Command => ({
  type: 'batch',
  commands: [
    { type: 'setLink', id: 'base', bodies: ['base'] },
    { type: 'setLink', id: 'upper', name: 'Upper arm', bodies: LINK },
    { type: 'setLink', id: 'forearm', bodies: ['forearm'] },
    { type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'base', child: 'upper', axis: SHOULDER, lower: 'deg(-90)', upper: 'deg(90)', value: 0 } },
    elbowJoint('deg(-135)', 'deg(135)'),
  ],
});
const pose = (values: Record<Id, number | string>): Command => ({ type: 'setPose', values });
const names = (list: { a: Id; b: Id }[]): string[] => list.map((pair) => `${pair.a}|${pair.b}`);
const unwrap = <T>(outcome: { ok: true; result: T } | { ok: false; error: { code: string; message: string } }): T => {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome.result;
};
const previewed = (engine: Engine, command: Command, at?: Id): EngineState => {
  const result = engine.preview(command, at);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};
const crossOf = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotOf = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('scenario 13, the part of 5a: two revolute joints, the pose stepped through the range of one joint with the collisions at each step, the mass beyond the first joint', () => {
  let engine: Engine;
  let booleans = 0; // calls of the kernel for a boolean, counted over the real kernel
  beforeAll(async () => {
    const kernel = await createManifoldKernel();
    const counted = new Proxy(kernel, { get: (target, property, receiver) => (property === 'boolean' ? (...args: Parameters<typeof kernel.boolean>) => (booleans++, target.boolean(...args)) : Reflect.get(target, property, receiver)) });
    engine = createEngine({ solver: await createPlanegcsSolver(), kernel: counted });
    run(engine, arm());
    run(engine, {
      type: 'batch',
      commands: [
        { type: 'setBodyMaterial', body: 'base', material: 'PETG' },
        { type: 'setBodyMaterial', body: 'upper', material: 'PETG' },
        { type: 'setBodyMaterial', body: 'forearm', material: 'PLA' },
        { type: 'setBodyProperties', body: 'motor', patch: { use: 'reference', mass: 280 } },
        { type: 'setBodyProperties', body: 'screw', patch: { use: 'reference', mass: 0.9 } },
      ],
    });
  });

  it('a. three links and two joints in one batch and one undo step; the limits by an expression in degrees, the fields hold radians', () => {
    const before = engine.getState().evaluation;
    const state = run(engine, mechanismOfTheArm());
    const { mechanism } = state.evaluation;
    expect(mechanism.roots).toEqual(['base']);
    expect(mechanism.unassigned).toEqual([]);
    expect(Object.values(mechanism.joints).map((joint) => joint.status)).toEqual(['ok', 'ok']);
    expect(mechanism.joints.elbow.axis).toEqual({ origin: [120, 0, 0], direction: [0, 0, 1] });
    const elbow = state.document.mechanism.joints.elbow;
    expect(elbow.type === 'revolute' && elbow.expressions).toEqual({ lower: 'deg(-135)', upper: 'deg(135)' });
    near(elbow.type === 'revolute' ? elbow.lower : undefined, -135 * DEG, 12);
    // the mechanism moves no body of the evaluation and recomputes no geometry
    for (const id of Object.keys(before.bodies)) expect(state.evaluation.bodies[id]).toBe(before.bodies[id]);
    engine.undo();
    expect(engine.getState().document.mechanism).toEqual({ links: {}, joints: {} });
    engine.redo();
    expect(Object.keys(engine.getState().document.mechanism.joints)).toEqual(['shoulder', 'elbow']);
  });

  it('a. a link built one command at a time is a root; a body goes from one link to another in one batch; a forgotten copy is named', () => {
    const halfBuilt = previewed(engine, { type: 'setLink', id: 'gripper', bodies: [] }).evaluation.mechanism;
    expect([halfBuilt.roots, halfBuilt.unassigned]).toEqual([['base', 'gripper'], []]);
    const moved = previewed(engine, { type: 'batch', commands: [{ type: 'setLink', id: 'upper', bodies: LINK.filter((body) => body !== 'motor') }, { type: 'setLink', id: 'base', bodies: ['base', 'motor'] }] });
    expect(moved.document.mechanism.links.base.bodies).toEqual(['base', 'motor']);
    expect(previewed(engine, { type: 'setLink', id: 'upper', bodies: LINK.slice(0, -1) }).evaluation.mechanism.unassigned).toEqual(['screws/3']);
  });

  it('a. what the commands refuse', () => {
    const messages = (
      [
        { type: 'setLink', id: 'forearm', bodies: ['forearm', 'motor'] },
        { type: 'setLink', id: 'tool', bodies: ['nope'] },
        { type: 'removeLink', id: 'upper' },
        { type: 'setJoint', id: 'loop', joint: { type: 'fixed', parent: 'forearm', child: 'base' } },
        { type: 'setJoint', id: 'second', joint: { type: 'fixed', parent: 'base', child: 'forearm' } },
        { type: 'setJoint', id: 'wrist', joint: { type: 'revolute', parent: 'forearm', child: 'nope', axis: { kind: 'base', axis: 'Z' }, lower: -1, upper: 1, value: 0 } },
        { type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'base', child: 'upper', axis: { kind: 'base', axis: 'Z' }, lower: -90, upper: 90, value: 0 } },
        { type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'base', child: 'upper', axis: { kind: 'base', axis: 'Z' }, lower: 1, upper: -1, value: 0 } },
        pose({ elbow: 3 }),
        pose({ nope: 0 }),
        { type: 'setJoint', id: 'wrist', joint: { type: 'revolute', parent: 'forearm', child: 'base', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'wrist' }, lower: -1, upper: 1, value: 0 } },
      ] as Command[]
    ).map((command) => refusal(engine, command));
    expect(messages).toEqual([
      expect.stringContaining('the body "motor" is in the link "upper"'),
      expect.stringContaining('no feature of the document creates the body "nope"'),
      expect.stringContaining('the link "upper" is named by the joints "shoulder", "elbow"'),
      expect.stringContaining('would hang on itself'),
      expect.stringContaining('the link "forearm" is the child of the joints "elbow" and "second"'),
      expect.stringContaining('"nope", which is not a link of the mechanism'),
      expect.stringMatching(/setJoint\.joint\.lower: the value -90 is not in the interval/),
      expect.stringContaining('the lower limit 1 rad is above the upper limit -1 rad'),
      expect.stringContaining('the value 3 rad is outside the limits of the joint'),
      expect.stringContaining('the mechanism has no joint "nope"; its joints are shoulder, elbow'),
      expect.stringContaining('the sketch "layout" has no entity "wrist"'),
    ]);
    expect(engine.getState().document.mechanism.joints.shoulder).toMatchObject({ lower: -90 * DEG });
  });

  it('b. the elbow stepped through its range: the collisions are asked over each previewed step and nothing is written', () => {
    const elbow = engine.getState().evaluation.mechanism.joints.elbow;
    const [lower, upper] = [elbow.lower as number, elbow.upper as number];
    const steps = 11; // -135° to 135° by 27°
    const undoable = engine.getState().canUndo;
    const sweep = Array.from({ length: steps }, (_, i) => {
      const value = lower + ((upper - lower) * i) / (steps - 1); // the last one may round past the limit: within the tolerance it is the limit
      const report = unwrap(engine.query('interference', {}, { state: previewed(engine, pose({ elbow: value })) }));
      return { degrees: Math.round(value / DEG), pairs: names(report.pairs), fits: names(report.fits), failed: names(report.failed) };
    });
    for (const step of sweep) {
      // the forearm runs into the screws and the motor beyond about a quarter turn (90.7° and 91.2°), and into nothing below it
      if (Math.abs(step.degrees) <= 81) expect(step.pairs, `${step.degrees}°`).toEqual([]);
      else expect(step.pairs.filter((pair) => !/^forearm\|(motor|screw)/.test(pair)), `${step.degrees}°`).toEqual([]);
      if (Math.abs(step.degrees) >= 108) expect(step.pairs, `${step.degrees}°`).toContain('forearm|motor');
      // the pin of the elbow is a fit where it is turned against its hole, and never a collision; a step the
      // kernel refused for it has nothing else in `failed`; the pin of the shoulder is in no list
      expect(step.fits.filter((pair) => pair !== 'forearm|upper'), `${step.degrees}°`).toEqual([]);
      expect(step.failed.filter((pair) => pair !== 'forearm|upper'), `${step.degrees}°`).toEqual([]);
      expect([...step.pairs, ...step.fits, ...step.failed]).not.toContain('base|upper');
    }
    // As measured through the real kernel: no step of this sweep is refused for the pin (before D51
    // about one pose in thirty was, design.md, "Verified before the implementation"; the second
    // cleaning of D51 answers nearly all of them), so every step is pinned.
    const screws = (...copies: number[]) => ['forearm|motor', 'forearm|screw', ...copies.map((copy) => `forearm|screws/${copy}`)];
    const expected: Record<number, string[]> = { [-135]: screws(1, 2, 3), [-108]: screws(3), 108: screws(1), 135: screws(1, 2, 3) };
    expect(sweep).toEqual(sweep.map((step) => ({ degrees: step.degrees, pairs: expected[step.degrees] ?? [], fits: step.degrees === 0 ? [] : ['forearm|upper'], failed: [] })));
    expect(sweep.map((step) => step.degrees)).toEqual([-135, -108, -81, -54, -27, 0, 27, 54, 81, 108, 135]);
    // as modelled no step has a pair; nothing was written
    expect(unwrap(engine.query('interference', {})).pairs).toEqual([]);
    expect(engine.getState().canUndo).toBe(undoable);
    expect(engine.getState().document.mechanism.joints.elbow).toMatchObject({ value: 0 });
  });

  it('b. a step computes only the pairs across the joint that moved; the same step asked again computes nothing', () => {
    const state = previewed(engine, pose({ elbow: 0.37 }));
    booleans = 0;
    unwrap(engine.query('interference', {}, { state }));
    // the forearm against the other seven bodies at most (boxes that do not meet cost nothing)
    expect(booleans).toBeGreaterThan(0);
    expect(booleans).toBeLessThanOrEqual(7);
    booleans = 0;
    unwrap(engine.query('interference', {}, { state: previewed(engine, pose({ elbow: 0.37 })) }));
    expect(booleans).toBe(0);
    // the shoulder turned: the pairs within the arm keep their relation, only those against the base are new
    unwrap(engine.query('interference', {}, { state: previewed(engine, pose({ shoulder: 0.2, elbow: 0.37 })) }));
    booleans = 0;
    unwrap(engine.query('interference', {}, { state: previewed(engine, pose({ shoulder: 0.25, elbow: 0.37 })) }));
    const report = unwrap(engine.query('interference', { bodies: ['upper', 'forearm', 'motor'] }, { state: previewed(engine, pose({ shoulder: 0.3, elbow: 0.37 })) }));
    expect(report.checked).toBe(3);
    expect(booleans).toBeLessThanOrEqual(7); // the base against the seven bodies of the arm
  });

  it('b. the smallest gap in a pose: the forearm comes near the motor with the elbow at 1.2, and the points are in the pose', () => {
    const args = { bodies: ['forearm', 'motor'], within: 30 };
    const modelled = unwrap(engine.query('gap', args));
    expect([modelled.pairs, modelled.apart]).toEqual([[], 1]);
    const bent = unwrap(engine.query('gap', args, { state: previewed(engine, pose({ elbow: 1.2 })) }));
    const pair = bent.pairs[0];
    // centre to centre less both radii: the forearm turned about (120, 0), the motor at (60, 0)
    const centre = [120 + 60 * Math.cos(1.2), 60 * Math.sin(1.2)];
    expect(pair.distance).toBeCloseTo(Math.hypot(centre[0] - 60, centre[1]) - 70 - 14, 1);
    if (pair.contact !== undefined) throw new Error('expected a distance');
    // the point on the forearm lies on its rim in the pose, not where it is modelled
    expect(Math.hypot(pair.between.a[0] - centre[0], pair.between.a[1] - centre[1])).toBeCloseTo(70, 1);
    expect(Math.hypot(pair.between.b[0] - 60, pair.between.b[1])).toBeCloseTo(14, 1);
  });

  it('b. a written pose is one command and one undo step; undo brings the arm back', () => {
    const state = run(engine, pose({ shoulder: 0.3, elbow: 0.8 }));
    expect(state.evaluation.mechanism.joints.elbow.value).toBe(0.8);
    expect(state.evaluation.mechanism.links.forearm.transform).not.toEqual(state.evaluation.mechanism.links.base.transform);
    engine.undo();
    expect(engine.getState().evaluation.mechanism.joints.elbow.value).toBe(0);
  });

  it('b. a coupled motion: both values follow one parameter and the sweep steps the parameter', () => {
    run(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'q', expr: '0' }, pose({ shoulder: 'q', elbow: '-2 * q' })] });
    for (const q of [0.2, 0.4]) {
      const state = previewed(engine, { type: 'setParameter', name: 'q', expr: String(q) });
      expect(state.evaluation.mechanism.joints.elbow.value).toBeCloseTo(-2 * q, 12);
      expect(unwrap(engine.query('interference', {}, { state })).pairs).toEqual([]);
    }
    // the values in the document are written back by the recompute, as every numeric field is
    expect(run(engine, { type: 'setParameter', name: 'q', expr: '0.1' }).document.mechanism.joints.elbow).toMatchObject({ value: -0.2, expressions: { value: '-2 * q' } });
    // a number takes a joint out of the coupling
    const state = run(engine, pose({ shoulder: 0, elbow: 0 }));
    expect(state.document.mechanism.joints.elbow.expressions).toEqual({ lower: 'deg(-135)', upper: 'deg(135)' });
  });

  it('b. a limit that follows a parameter, widened and used in one batch', () => {
    run(engine, { type: 'setParameter', name: 'reach', expr: '2.2' });
    run(engine, elbowJoint('-reach', 'reach'));
    expect(engine.execute({ type: 'batch', commands: [{ type: 'setParameter', name: 'reach', expr: '2.6' }, pose({ elbow: 2.5 })] }).ok).toBe(true);
    // a value a hair beyond the limit is the limit
    const state = run(engine, pose({ elbow: 2.6 + 5e-5 }));
    expect(state.document.mechanism.joints.elbow).toMatchObject({ value: 2.6 });
    run(engine, pose({ elbow: 0 }), elbowJoint('deg(-135)', 'deg(135)'));
  });

  it('c. the mass of what hangs beyond the shoulder, in a pose, and the torque the shoulder holds against gravity', () => {
    const beyond = (elbow: number, gravity = [0, -9.81, 0]) => {
      const options = { state: previewed(engine, pose({ elbow })) };
      const mechanism = unwrap(engine.query('mechanism', { beyond: 'shoulder' }, options));
      const carried = mechanism.beyond;
      if (!carried || carried.missing.length) throw new Error('expected what the shoulder carries, all of it');
      const axis = mechanism.joints.shoulder.axisInPose as { origin: number[]; direction: number[] };
      const load = massOf(engine, { bodies: carried.bodies }, options);
      const r = load.centerOfMass.map((x, i) => x - axis.origin[i]);
      return { carried, load, torque: dotOf(axis.direction, crossOf(r, gravity)) * load.mass * 1e-6 };
    };
    const stretched = beyond(0);
    expect(stretched.carried).toEqual({ joint: 'shoulder', links: ['upper', 'forearm'], bodies: [...LINK, 'forearm'], missing: [] });
    const folded = beyond(2.3);
    // the mass does not depend on the pose, its centre does: folded, the lever is shorter
    near(folded.load.mass, stretched.load.mass, 5); // the moved mesh is rounded to single precision
    expect(folded.load.centerOfMass[0]).toBeLessThan(stretched.load.centerOfMass[0]);
    expect(Math.abs(folded.torque)).toBeLessThan(Math.abs(stretched.torque));
    expect(stretched.torque).toBeLessThan(0);
    // gravity along the axis: no torque, whatever the lever
    expect(beyond(1.2, [0, 0, -9.81]).torque).toBeCloseTo(0, 12);
  });

  it('d. what is posed and what stays as modelled: the bodies of the evaluation, an export and the print query stay', () => {
    const atZero = engine.getState();
    const file = unwrap(engine.export('stl', { bodies: ['forearm'] })).files[0].bytes;
    const printed = unwrap(engine.query('print', { bodies: ['forearm'], orientations: [{ by: { up: [0, 0, 1] } }] }));
    const bent = run(engine, pose({ elbow: 1 }));
    expect(bent.evaluation.bodies.forearm).toBe(atZero.evaluation.bodies.forearm);
    expect(unwrap(engine.export('stl', { bodies: ['forearm'] })).files[0].bytes).toEqual(file);
    expect(engine.exportMesh('stl', ['forearm'])).toEqual(file);
    expect(unwrap(engine.query('print', { bodies: ['forearm'], orientations: [{ by: { up: [0, 0, 1] } }] }))).toEqual(printed);
    // a query reads the posed body: its description has the bounds in the pose
    const posed = unwrap(engine.query('body', { body: 'forearm' }));
    expect(posed.bounds.max[1]).toBeGreaterThan(atZero.evaluation.bodies.forearm.bounds.max[1] + 50);
    expect(unwrap(engine.query('body', { body: 'forearm' }, { geometry: 'modelled' })).bounds).toEqual(atZero.evaluation.bodies.forearm.bounds);
    // what a tool says beside its answer
    expect(poseNote(bent.evaluation.mechanism, bent.document.mechanism)).toEqual({ pose: { elbow: 1 } });
    expect(poseNote(atZero.evaluation.mechanism, atZero.document.mechanism)).toBeUndefined();
    expect(QUERIES.print.geometry).toBe('modelled');
    engine.undo();
  });

  it('d. a state after a feature is posed like any other: as modelled where the pose is zero, failing loudly before the axis of a bent joint', () => {
    // the pose zero: at the point before the sketch of the axes the joints are in error and block nothing
    const early = engine.getState('elbowPin').evaluation.mechanism;
    expect([early.joints.elbow.error?.code, early.links.forearm.blockedBy]).toEqual(['brokenReference', undefined]);
    expect(unwrap(engine.query('interference', {}, { at: 'elbowPin' }))).toEqual(unwrap(engine.query('interference', {}, { at: 'elbowPin', geometry: 'modelled' })));
    // bent: after the sketch of the axes it is posed like the finished model, with `at` and `after` together
    const atLayout = previewed(engine, pose({ elbow: 1.2 }), 'layout');
    expect(atLayout.evaluation.mechanism.links.forearm.blockedBy).toBeUndefined();
    expect(unwrap(engine.query('interference', {}, { state: atLayout })).fits).toEqual(expect.arrayContaining([expect.objectContaining({ a: 'forearm', b: 'upper' })]));
    run(engine, pose({ elbow: 1.2 }));
    const all = engine.query('interference', {}, { at: 'elbowPin' });
    expect(all).toMatchObject({ ok: false, error: { code: 'failed', message: expect.stringContaining('the joint "elbow" has no motion') } });
    expect(!all.ok && all.error.message).toContain('"setPose", "values": { "elbow": 0 }');
    // a query about bodies that do not move still answers
    expect(unwrap(engine.query('body', { body: 'upper' }, { at: 'elbowPin' })).bounds.min).toEqual(engine.getState().evaluation.bodies.upper.bounds.min);
    // the ways to the blocked body that write nothing: the joint previewed at zero, or the model as modelled
    const modelled = engine.getState().evaluation.bodies.forearm.bounds;
    expect(unwrap(engine.query('body', { body: 'forearm' }, { state: previewed(engine, pose({ elbow: 0 }), 'elbowPin') })).bounds).toEqual(modelled);
    expect(unwrap(engine.query('body', { body: 'forearm' }, { at: 'elbowPin', geometry: 'modelled' })).bounds).toEqual(modelled);
    engine.undo();
  });

  it('e. a joint in error: an axis broken at zero blocks nothing, bent it blocks what hangs on it', () => {
    let state = run(engine, { type: 'setSuppressed', id: 'layout', suppressed: true });
    expect(state.evaluation.mechanism.joints.elbow).toMatchObject({ status: 'error', error: { code: 'brokenReference' } });
    expect(state.evaluation.mechanism.links.forearm.blockedBy).toBeUndefined();
    expect(engine.query('interference', {}).ok).toBe(true);
    engine.undo();
    run(engine, pose({ elbow: 1 }));
    state = run(engine, { type: 'setSuppressed', id: 'layout', suppressed: true });
    expect(state.evaluation.mechanism.links.forearm.blockedBy).toBe('elbow');
    expect(engine.query('interference', { bodies: ['base', 'forearm'] })).toMatchObject({ ok: false, error: { code: 'failed' } });
    expect(engine.query('body', { body: 'base' }).ok).toBe(true);
    expect(() => engine.interference({ bodies: ['base', 'forearm'] })).toThrow(/the joint "elbow" has no motion/);
    expect(engine.query('interference', { bodies: ['base', 'forearm'] }, { geometry: 'modelled' }).ok).toBe(true);
    engine.undo();
    engine.undo();
  });

  it('e. a parameter that takes a value out of its limits: the joint is in error and the field keeps its last valid number', () => {
    run(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'q', expr: '0.5' }, pose({ elbow: 'q' })] });
    const state = run(engine, { type: 'setParameter', name: 'q', expr: '4' });
    expect(state.evaluation.mechanism.joints.elbow.error).toMatchObject({ code: 'jointOutOfLimits' });
    expect(state.document.mechanism.joints.elbow).toMatchObject({ value: 0.5, expressions: { value: 'q' } });
    expect(state.evaluation.mechanism.links.forearm.blockedBy).toBe('elbow');
    engine.undo();
    engine.undo();
  });

  it('e. a body the link lists and the model no longer has: the link poses the others and says which is missing', () => {
    const state = run(engine, { type: 'setSuppressed', id: 'motor', suppressed: true });
    expect(state.evaluation.mechanism.links.upper.missing).toEqual(['motor']);
    expect(carriedBy(state.document.mechanism, state.evaluation.mechanism, 'shoulder').missing).toEqual(['motor']);
    engine.undo();
  });

  it('f. save and load: version 8, a field this build does not know is refused, a removed axis loads', () => {
    // the branch d36/3c: its step pending; the merge makes it version 9 without names
    expect(SCHEMA_PENDING).toBe(1);
    expect(UPGRADES[4]?.name).toBe('5a-mechanism');
    const saved = JSON.parse(engine.save());
    expect([saved.schemaVersion, saved.schemaSteps]).toEqual([8, ['3c-document-insert']]);
    const elbow = saved.mechanism.joints.elbow;
    expect(engine.load(JSON.stringify({ ...saved, mechanism: { ...saved.mechanism, joints: { ...saved.mechanism.joints, elbow: { ...elbow, damping: 2.5 } } } }))).toMatchObject({ ok: false, error: { code: 'invalidDocument', message: expect.stringContaining('damping') } });
    // a document of master with 3a (version 5, no names) gets the empty mechanism
    const { mechanism: _mechanism, ...older } = saved;
    const loaded = engine.load(JSON.stringify({ ...older, schemaVersion: 5 }));
    expect(loaded.ok && loaded.state.document.mechanism).toEqual({ links: {}, joints: {} });
    // the sketch of the axes removed: the reference is checked by a command that sets it, not by a load
    engine.load(JSON.stringify(saved));
    run(engine, { type: 'removeFeature', id: 'layout' });
    const again = engine.load(engine.save());
    expect(again.ok && again.state.evaluation.mechanism.joints.elbow.error?.code).toBe('brokenReference');
    expect(engine.load(JSON.stringify(saved)).ok).toBe(true);
    // the IDs the section names: the bodies of the links, the sketch and the points of the axes
    expect(namedBySections(engine.getState().document)).toEqual(expect.arrayContaining(['forearm', 'screws/3', 'screws', 'layout', 'shoulder', 'elbow']));
  });

  it('f. the description for the AI: the numeric fields of a joint by its kind', () => {
    expect(SECTION_INFO.mechanism.fields.map((field) => `${field.owner}: ${field.path} (${field.spec.unit}, when ${field.when?.path} is ${field.when?.equals})`)).toEqual([
      'joint: lower (rad, when type is revolute)',
      'joint: upper (rad, when type is revolute)',
      'joint: value (rad, when type is revolute)',
      'joint: effort (N·mm, when type is revolute)',
      'joint: velocity (rad/s, when type is revolute)',
      'joint: rotorInertia (g·mm2, when type is revolute)',
      'joint: gearRatio (none, when type is revolute)',
      'joint: value (rad, when type is continuous)',
      'joint: effort (N·mm, when type is continuous)',
      'joint: velocity (rad/s, when type is continuous)',
      'joint: rotorInertia (g·mm2, when type is continuous)',
      'joint: gearRatio (none, when type is continuous)',
      'joint: lower (mm, when type is prismatic)',
      'joint: upper (mm, when type is prismatic)',
      'joint: value (mm, when type is prismatic)',
      'joint: effort (N, when type is prismatic)',
      'joint: velocity (mm/s, when type is prismatic)',
    ]);
  });
});

// The part of D50 (docs/d36/5e-kernel-second/design.md, "Tests", 4): the elbow stepped through the
// first 40 angles of the recipe of the design over ±88° (`lower + (upper − lower) · frac(k ·
// 0.6180339887)`, k = 1 to 40), through the engine, with a kernel that passes everything on and
// notes the intersections the adapter refused. The engine orders a pair by its IDs and computes it
// in the frame of its first body, so the kernel is asked `(forearm, upper turned back)`; the steps
// it refuses are found here, not taken from the backlog (whose three poses are refused with the
// parent first: second-opinion.test.ts).
// The sweep runs twice (D51, docs/d36/5f-adapter-repair/design.md, "Tests the implementation
// owes", 11): over the adapter with the first cleaning alone, which refuses the step k = 5 and so
// keeps the second opinion tested through the engine, and over the adapter, whose second cleaning
// answers that step: no step is refused and the pin is a verified fit at every step.
describe.each([
  ['the first cleaning alone', true],
  ['the adapter', false],
] as const)('scenario 13, the part of D50 and D51, over %s: the steps the kernel refuses for the pin of the elbow', (_name, firstOnly) => {
  let engine: Engine;
  const refusals: number[] = []; // per step, how many intersections the adapter refused
  let refusedNow = 0;
  beforeAll(async () => {
    const kernel = await createManifoldKernel();
    const watching: SolidKernel = {
      triangulate: (loops) => kernel.triangulate(loops),
      boolean: (op, a, b) => {
        try {
          return kernel.boolean(op, a, b, { second: !firstOnly });
        } catch (error) {
          if (op === 'intersection') refusedNow++;
          throw error;
        }
      },
      intersectionAsComputed: (a, b) => kernel.intersectionAsComputed(a, b),
    };
    engine = createEngine({ solver: await createPlanegcsSolver(), kernel: watching });
    run(engine, arm());
    run(engine, mechanismOfTheArm());
  });
  const angleOf = (k: number): number => (-88 + 176 * ((k * 0.6180339887) % 1)) * DEG;
  const stepAt = (k: number) => {
    const state = previewed(engine, pose({ elbow: angleOf(k) }));
    refusedNow = 0;
    const report = unwrap(engine.query('interference', {}, { state }));
    refusals[k] = refusedNow;
    return { k, state, report, cleared: (report.cleared ?? []).map((pair) => `${pair.a}|${pair.b}|${pair.kind}`) };
  };

  it('a. at a refused step the pin is in `cleared` and in no other list; no step has anything in `failed` or `pairs`', () => {
    const steps = Array.from({ length: 40 }, (_, i) => stepAt(i + 1));
    const refused = steps.filter((step) => refusals[step.k] > 0);
    if (firstOnly) {
      // As measured: one step of the 40 is refused, k = 5 (−72.130°), where the mesh as computed is a
      // fit of 0.031 mm³. Without the second opinion (5a alone) the pin was in `failed` there.
      expect(refused.length, 'a refused step: otherwise the test tests nothing').toBeGreaterThan(0);
      expect(refused.map((step) => step.k)).toContain(5);
    } else {
      // the second cleaning answers the step k = 5: no step is refused
      expect(refused.map((step) => step.k)).toEqual([]);
    }
    for (const step of steps) {
      const label = `k = ${step.k}, ${(angleOf(step.k) / DEG).toFixed(3)}°`;
      // the range ends below the quarter turn at which the forearm reaches the screws and the motor
      expect([step.report.pairs, step.report.failed], label).toEqual([[], []]);
      if (refusals[step.k] > 0) {
        expect(step.cleared.map((pair) => pair.split('|').slice(0, 2).join('|')), label).toEqual(['forearm|upper']);
        expect(names(step.report.fits), label).toEqual([]);
      } else {
        // a step without a refused pair answers as before 5e, field for field
        expect(step.report.cleared, label).toBeUndefined();
        expect(names(step.report.fits), label).toEqual(['forearm|upper']);
      }
    }
    const five = steps.find((step) => step.k === 5)?.report;
    if (firstOnly) expect(five?.cleared).toEqual([{ a: 'forearm', b: 'upper', kind: 'fit', volume: expect.closeTo(0.0313, 3), depth: expect.any(Number) }]);
    else expect(five?.fits).toEqual([{ a: 'forearm', b: 'upper', volume: expect.closeTo(0.0313, 3), depth: expect.any(Number) }]);
  });

  it('b. the gap at the step k = 5: a fit; over the first cleaning alone the pair is named in `cleared`', () => {
    const step = stepAt(5);
    expect(step.cleared).toEqual(firstOnly ? ['forearm|upper|fit'] : []);
    const gap = unwrap(engine.query('gap', { bodies: ['forearm', 'upper'] }, { state: step.state }));
    expect(gap.pairs).toEqual([{ a: 'forearm', b: 'upper', distance: 0, contact: 'fit' }]);
    if (firstOnly) expect(gap.cleared).toEqual([{ a: 'forearm', b: 'upper' }]);
    else expect(gap.cleared).toBeUndefined();
    // a step the adapter answers with either cleaning: a fit, no `cleared`
    const answered = previewed(engine, pose({ elbow: angleOf(1) }));
    const plain = unwrap(engine.query('gap', { bodies: ['forearm', 'upper'] }, { state: answered }));
    expect(plain.pairs).toEqual([{ a: 'forearm', b: 'upper', distance: 0, contact: 'fit' }]);
    expect(plain.cleared).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the part of 3e

describe('scenario 13, the part of 3e: what to print and what to buy, one question and one file', () => {
  let engine: Engine;
  let labels: { m3: string; m4: string };
  const XY = { kind: 'base', plane: 'XY' } as const;
  const list = (state?: EngineState): PartsList => unwrap(engine.query('partsList', {}, state ? { state } : {}));
  const told = (r: PartRow): string => `${r.name} × ${r.count}: ${r.bodies.join(' ')}`;
  const changed = (...commands: Command[]): EngineState => previewed(engine, commands.length === 1 ? commands[0] : { type: 'batch', commands });
  const close = (actual: number | undefined, expected: number, tolerance = 1e-3): void => expect(Math.abs((actual ?? Infinity) - expected)).toBeLessThanOrEqual(tolerance);
  // No size of an insert is written here: the shape, the label and the depth are answers of the
  // query `hardwareHole` (D46). The sizes are the first M3 and the first M4 row of the catalog.
  const insertOf = (thread: number) => {
    const rows = DATA_CATALOGS.heatSetInserts.rows;
    const size = Object.keys(rows).find((key) => rows[key].thread === thread) as string;
    const answer = unwrap(engine.query('hardwareHole', { use: 'heatSetInsert', size, allowance: 'holeComp' }));
    return { shape: answer.shape, label: answer.label, depth: answer.depth as number };
  };
  const hole = (id: Id, sketch: Id, point: Id, target: Id, shape: Input<HoleShape>, start: number, distance: number, label: string): Command => ({
    type: 'addFeature',
    feature: { id, name: id, suppressed: false, type: 'hole', sketch, points: [point], shape, extent: { type: 'distance', start, distance }, targets: [target], label },
  });

  beforeAll(() => {
    engine = newEngine();
    run(engine, arm());
    // the properties of the part of 3a: materials from the catalog, the motor and the screws as
    // bought parts with the masses of their data sheets
    run(engine, {
      type: 'batch',
      commands: [
        { type: 'setBodyMaterial', body: 'base', material: 'PETG' },
        { type: 'setBodyMaterial', body: 'upper', material: 'PETG' },
        { type: 'setBodyMaterial', body: 'forearm', material: 'PLA' },
        { type: 'setBodyProperties', body: 'motor', patch: { name: 'NEMA 17 motor', color: '#30343a', use: 'reference', mass: 280 } },
        { type: 'setBodyProperties', body: 'screw', patch: { name: 'M3x6 screw', use: 'reference', material: 'steel', mass: 0.9 } },
      ],
    });
    // what holds it together: a heat-set insert in `upper` under each of the four screws (one hole
    // feature under the first screw and a pattern of it about the centre of the motor), and three
    // feet under the base, each with an insert for a levelling screw (a body with a hole, then
    // a pattern of the body, so every copy has the hole)
    const [m3, m4] = [insertOf(3), insertOf(4)];
    labels = { m3: m3.label, m4: m4.label };
    run(engine, {
      type: 'batch',
      commands: [
        { type: 'setParameter', name: 'holeComp', expr: '0.2' },
        { type: 'addFeature', feature: emptySketch('insertSketch', 'insertSketch', XY) },
        { type: 'addPoint', sketch: 'insertSketch', id: 'i1', x: 80, y: 0 },
        { type: 'addConstraint', sketch: 'insertSketch', id: 'i1Fix', constraint: { type: 'fixed', point: 'i1', x: 80, y: 0 } },
        hole('inserts', 'insertSketch', 'i1', 'upper', m3.shape, 8, -m3.depth, m3.label),
        { type: 'addFeature', feature: { id: 'insertPattern', name: 'insertPattern', suppressed: false, type: 'pattern', source: { type: 'features', features: ['inserts'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'motorSketch', point: 'motorCentre' }, count: 4, span: { type: 'full' } } } },
        // the foot: a cylinder of radius 6 under the base, from z = −20 to −10, with its hole from below
        ...cylinder('foot', 20, 0, 6, -20, -10),
        hole('footHole', 'footSketch', 'footCentre', 'foot', m4.shape, -20, m4.depth, m4.label),
        { type: 'addFeature', feature: { id: 'feet', name: 'Feet', suppressed: false, type: 'pattern', source: { type: 'body', body: 'foot' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } } } },
        { type: 'setBodyMaterial', body: 'foot', material: 'TPU' },
      ],
    });
    expect(labels).toEqual({ m3: 'M3x3x4.5 heat-set insert', m4: 'M4x3x5 heat-set insert' });
  });

  it('a. the whole list: four kinds of printed parts, the motor and four screws, seven inserts counted from the holes, the sums', () => {
    const { printed, bought, hardware, totals, unlabelled, auxiliary } = list();
    // the three feet are one row, named by the body they are copies of
    expect(printed.map(told)).toEqual(['base × 1: base', 'upper × 1: upper', 'forearm × 1: forearm', 'foot × 3: foot feet/1 feet/2']);
    expect(printed.map((r) => r.material)).toEqual(['PETG', 'PETG', 'PLA', 'TPU']);
    // density times volume: 36.4016 g, 155.046 g (the four insert holes are out of it), 153.175 g, 1.31686 g a foot
    for (const r of printed) {
      expect(r.massFrom).toBe('density');
      close(r.mass, ((r.density ?? 0) * r.volume) / 1000, 1e-9);
    }
    close(printed[1].volume, 122083.556);
    close(printed[3].totalMass, 3.95059, 1e-5);
    // the motor and the four screws, with the masses of their data sheets
    expect(bought.map(told)).toEqual(['NEMA 17 motor × 1: motor', 'M3x6 screw × 4: screw screws/1 screws/2 screws/3']);
    expect(bought[0]).toMatchObject({ mass: 280, color: '#30343a' });
    expect(bought[1].massFrom).toBe('mass');
    close(bought[1].totalMass, 3.6, 1e-9);
    // four inserts under the screws (the hole and the three copies of its pattern), three in the
    // feet (one hole, in the body and in its two copies)
    expect(hardware).toEqual([
      { label: labels.m3, count: 4, holes: [{ feature: 'inserts', count: 4 }] },
      { label: labels.m4, count: 3, holes: [{ feature: 'footHole', count: 3 }] },
    ]);
    // 6 printed bodies of 348.573 g, 5 bought ones of 283.6 g, 7 pieces of hardware
    expect(totals.printed).toMatchObject({ count: 6, withoutMass: 0 });
    close(totals.printed.mass, 348.573);
    expect(totals.bought).toMatchObject({ count: 5, withoutMass: 0 });
    close(totals.bought.mass, 283.6, 1e-9);
    expect(totals.hardware.count).toBe(7);
    expect([unlabelled, auxiliary]).toEqual([undefined, undefined]);
  });

  it('b. a copy in another colour or with a name of its own is a row of its own; six screws are one field and stand against four inserts', () => {
    const black = list(changed({ type: 'setBodyProperties', body: 'screws/2', patch: { color: '#000000' } })).bought;
    expect(black.map(told)).toEqual(['NEMA 17 motor × 1: motor', 'M3x6 screw × 3: screw screws/1 screws/3', 'M3x6 screw × 1: screws/2']);
    expect(black[2]).toMatchObject({ color: '#000000', copyOf: 'screw' });
    close(black[1].totalMass, 2.7, 1e-9);
    const spare = list(changed({ type: 'setBodyProperties', body: 'screws/3', patch: { name: 'spare screw' } })).bought;
    expect(spare.map(told)).toEqual(['NEMA 17 motor × 1: motor', 'M3x6 screw × 3: screw screws/1 screws/2', 'spare screw × 1: screws/3']);
    const six = list(changed({ type: 'setField', feature: 'screws', path: 'transform/count', value: 6 }));
    expect(six.bought[1].count).toBe(6);
    close(six.bought[1].totalMass, 5.4, 1e-9);
    expect(six.hardware[0].count).toBe(4);
  });

  it('c. a mirrored foot is another part, and so is a foot with a notch cut after the pattern', () => {
    const mirrored = list(changed({ type: 'updateFeature', id: 'feet', patch: { transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } } }));
    const [, , , foot, image] = mirrored.printed;
    expect([told(foot), told(image)]).toEqual(['foot × 1: foot', 'foot × 1: feet/1']);
    expect(image).toMatchObject({ mirrored: true, copyOf: 'foot' });
    expect([image.differs, foot.mirrored]).toEqual([undefined, undefined]);
    expect(mirrored.hardware[1].count).toBe(2);
    // a notch of radius 2 cut into `feet/1` alone, at (−10, 17.32), where the pattern put it: its
    // solid is a new one, a copy of no mesh any more, so its row says that it differs from `foot`
    const notched = list(changed(...cylinder('notch', -10, 17.32, 2, -21, -15, 'cut', 'feet/1'))).printed;
    const [, , , feet, one] = notched;
    expect([told(feet), told(one)]).toEqual(['foot × 2: foot feet/2', 'foot × 1: feet/1']);
    expect(one).toMatchObject({ copyOf: 'foot', differs: true });
    expect(one.mirrored).toBeUndefined();
    close(one.volume, 1041.004);
    close(feet.volume, 1053.49);
  });

  it('d. a part without a mass is listed and the sum says so; an auxiliary body is no part', () => {
    const bare = list(changed({ type: 'removeBodyProperties', body: 'forearm' }));
    expect(bare.printed[2]).toMatchObject({ noMass: 'notStated' });
    expect([bare.printed[2].mass, bare.printed[2].totalMass]).toEqual([undefined, undefined]);
    expect(bare.totals.printed).toMatchObject({ count: 6, withoutMass: 1 });
    close(bare.totals.printed.mass, 195.398); // 348.573 less the forearm
    // a density that cannot be evaluated is not "nothing stated"
    const broken = list(changed({ type: 'setParameter', name: 'rho', expr: '1.2' }, { type: 'setBodyProperties', body: 'forearm', patch: { density: 'rho' } }, { type: 'setParameter', name: 'rho', expr: 'nope' }));
    expect(broken.printed[2].noMass).toBe('inError');
    expect(broken.totals.printed.withoutMass).toBe(1);
    const kept = list(changed({ type: 'setBodyProperties', body: 'base', patch: { use: 'auxiliary' } }));
    expect(kept.auxiliary).toEqual(['base']);
    expect(kept.printed.some((r) => r.bodies.includes('base'))).toBe(false);
    expect(kept.totals.printed.count).toBe(5);
    close(kept.totals.printed.mass, 312.171);
  });

  it('e. the hardware follows the model and the labels: a suppressed pattern, a removed label, a label of its own, a screw through two links', () => {
    const one = list(changed({ type: 'setSuppressed', id: 'insertPattern', suppressed: true })).hardware;
    expect(one.map((r) => r.count)).toEqual([1, 3]);
    const bare = list(changed({ type: 'updateFeature', id: 'footHole', patch: { label: null } }));
    expect(bare.hardware.map((r) => r.label)).toEqual([labels.m3]);
    expect(bare.unlabelled).toEqual([{ feature: 'footHole', count: 3 }]);
    expect(bare.totals.hardware.count).toBe(4);
    const brass = list(changed({ type: 'updateFeature', id: 'inserts', patch: { label: 'M3 insert, brass' } })).hardware;
    expect(brass[0]).toMatchObject({ label: 'M3 insert, brass', count: 4 });
    // one screw through the link and the forearm is one hole feature with both as targets and one
    // piece; the clearance hole is the catalog's, its label the screw
    const clearance = unwrap(engine.query('hardwareHole', { use: 'clearance', size: 'M3' }));
    const through = list(
      changed(
        { type: 'addFeature', feature: emptySketch('throughSketch', 'throughSketch', XY) },
        { type: 'addPoint', sketch: 'throughSketch', id: 't1', x: 125, y: 20 },
        { type: 'addConstraint', sketch: 'throughSketch', id: 't1Fix', constraint: { type: 'fixed', point: 't1', x: 125, y: 20 } },
        { type: 'addFeature', feature: { id: 'through', name: 'through', suppressed: false, type: 'hole', sketch: 'throughSketch', points: ['t1'], shape: clearance.shape, extent: { type: 'distance', start: 16, distance: -16 }, targets: ['upper', 'forearm'], label: 'M3x16 screw' } },
      ),
    ).hardware;
    expect(through[2]).toEqual({ label: 'M3x16 screw', count: 1, holes: [{ feature: 'through', count: 1 }] });
  });

  it('f. the state after the motor: no screws, no feet, no hole yet', () => {
    const early = unwrap(engine.query('partsList', {}, { at: 'motor' }));
    expect(early.printed.map(told)).toEqual(['base × 1: base', 'upper × 1: upper', 'forearm × 1: forearm']);
    close(early.printed[1].mass, 155.353);
    expect(early.bought.map(told)).toEqual(['NEMA 17 motor × 1: motor']);
    expect([early.hardware, early.totals.hardware.count]).toEqual([[], 0]);
  });

  it('f. a parts list does not depend on the pose: it answers where a posed query cannot read a body', () => {
    const state = changed(
      { type: 'setLink', id: 'ground', bodies: ['base'] },
      { type: 'setLink', id: 'arm', bodies: ['upper', 'motor'] },
      { type: 'setLink', id: 'fore', bodies: ['forearm'] },
      { type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'ground', child: 'arm', axis: SHOULDER, lower: -3, upper: 3, value: 0.5 } },
      { type: 'setJoint', id: 'elbow', joint: { type: 'revolute', parent: 'arm', child: 'fore', axis: ELBOW, lower: -3, upper: 3, value: 0.7 } },
      { type: 'removeFeature', id: 'layout' },
    );
    const posed = engine.query('mass', { bodies: ['forearm'] }, { state });
    expect(posed.ok ? 'ok' : posed.error.code).toBe('failed');
    const parts = list(state);
    expect([parts.totals.printed.count, parts.totals.hardware.count]).toEqual([6, 7]);
    close(parts.totals.printed.mass, 348.573);
  });

  it('g. the same table as a file; a label with a comma, a tab in a name, a mirror image noted; a model with nothing to list', () => {
    const exported = unwrap(engine.export('partsCsv', {}));
    expect([exported.layout, exported.files.length, exported.empty]).toEqual(['file', 1, undefined]);
    const [file] = exported.files;
    expect([file.path, file.mediaType]).toEqual([PARTS_CSV.path, 'text/csv']);
    expect(new TextDecoder().decode(file.bytes)).toBe(
      [
        'Kind,Name,Count,Material,Colour,Mass each (g),Mass total (g),Note,IDs',
        'printed,base,1,PETG,,36.4016,36.4016,,base',
        'printed,upper,1,PETG,,155.046,155.046,,upper',
        'printed,forearm,1,PLA,,153.175,153.175,,forearm',
        'printed,foot,3,TPU,,1.31686,3.95059,,foot feet/1 feet/2',
        'bought,NEMA 17 motor,1,,#30343a,280,280,,motor',
        'bought,M3x6 screw,4,steel,,0.9,3.6,,screw screws/1 screws/2 screws/3',
        `hardware,${labels.m3},4,,,,,,inserts`,
        `hardware,${labels.m4},3,,,,,,footHole`,
      ]
        .map((record) => `${record}\r\n`)
        .join(''),
    );
    expect(file.about as PartsCsvAbout).toEqual({ rows: 8, printed: 4, bought: 2, hardware: 2 });
    const state = changed(
      { type: 'updateFeature', id: 'inserts', patch: { label: 'M3 insert, brass' } },
      { type: 'setBodyProperties', body: 'motor', patch: { name: 'NEMA 17\tmotor' } },
      { type: 'updateFeature', id: 'feet', patch: { transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } } },
    );
    const quoted = new TextDecoder().decode(unwrap(engine.export('partsCsv', {}, { state })).files[0].bytes);
    expect(quoted).toContain('hardware,"M3 insert, brass",4,,,,,,inserts\r\n');
    expect(quoted).toContain('bought,NEMA 17 motor,1,,#30343a,280,280,,motor\r\n');
    expect(quoted).toContain('printed,foot,1,TPU,,1.31686,1.31686,,foot\r\n');
    expect(quoted).toContain('printed,foot,1,TPU,,1.31686,1.31686,mirror image of foot,feet/1\r\n');
    // the state before the first body: the file says so in `empty`, and a tool that writes files refuses
    expect(unwrap(engine.export('partsCsv', {}, { at: 'baseSketch' })).empty).toBe(PARTS_CSV.empty);
  });

  it('h. an argument the query does not have is refused', () => {
    const outcome = engine.query('partsList', { bodies: ['base'] } as {});
    expect(outcome.ok ? 'ok' : outcome.error.code).toBe('invalidArguments');
  });
});

// The part of 5b (D59, docs/d36/5b-robot-export/calls.ts): the arm with a drive on each joint, as
// URDF and as MJCF. The numbers were measured with the prototype of the design and read back by
// MuJoCo, urdf_parser_py and yourdfpy (design.md, "Measured").
describe('scenario 13, the part of 5b: the arm as URDF and as MJCF, with the drive of each joint', () => {
  let engine: Engine;
  const text = (file: ExportFile): string => new TextDecoder().decode(file.bytes);
  const shoulder = (drive: object = {}): Command => ({ type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'base', child: 'upper', axis: SHOULDER, lower: 'deg(-90)', upper: 'deg(90)', value: 0, ...drive } } as Command);
  const elbow = (drive: object = {}): Command => ({ type: 'setJoint', id: 'elbow', joint: { type: 'revolute', parent: 'upper', child: 'forearm', axis: ELBOW, lower: 'deg(-135)', upper: 'deg(135)', value: 0, ...drive } } as Command);
  const exported = (format: 'urdf' | 'mjcf', options: object = {}, state?: EngineState | { at: Id }): Exported => unwrap(engine.export(format, options as never, state === undefined ? {} : 'at' in state ? state : { state }));
  const refusal = (format: 'urdf' | 'mjcf', options: object = {}, state?: EngineState | { at: Id }) => {
    const outcome = engine.export(format, options as never, state === undefined ? {} : 'at' in state ? state : { state });
    if (outcome.ok) throw new Error('the export was not refused');
    return outcome.error;
  };
  beforeAll(async () => {
    engine = createEngine({ solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() });
    run(engine, arm());
    run(engine, {
      type: 'batch',
      commands: [
        { type: 'setBodyMaterial', body: 'base', material: 'PETG' },
        { type: 'setBodyMaterial', body: 'upper', material: 'PETG' },
        { type: 'setBodyMaterial', body: 'forearm', material: 'PLA' },
        { type: 'setBodyProperties', body: 'motor', patch: { use: 'reference', mass: 280, color: '#30343a' } },
        { type: 'setBodyProperties', body: 'screw', patch: { use: 'reference', mass: 0.9 } },
      ],
    });
    run(engine, { type: 'batch', commands: [{ type: 'setLink', id: 'base', bodies: ['base'] }, { type: 'setLink', id: 'upper', name: 'Upper arm', bodies: LINK }, { type: 'setLink', id: 'forearm', bodies: ['forearm'] }, shoulder(), elbow()] });
  });

  it('a. MJCF needs no drive; URDF refuses until every revolute joint has an effort and a velocity, naming both joints at once', () => {
    const mjcf = exported('mjcf');
    expect(mjcf.layout).toBe('directory');
    expect(mjcf.files.map((file) => file.path)).toEqual(['robot.xml', 'base.stl', 'upper.stl', 'motor.stl', 'screw.stl', 'screws_2F1.stl', 'screws_2F2.stl', 'screws_2F3.stl', 'forearm.stl']);
    expect(text(mjcf.files[0])).not.toContain('<actuator>');
    expect(refusal('urdf')).toEqual({ code: 'failed', message: `urdf: ${ROBOT_REFUSALS.urdfLimits.text}shoulder (effort, velocity); elbow (effort, velocity)` });
  });

  it('b. the drives in one batch and one undo step: a stepper with a gearbox at the shoulder, a servo at the elbow with its effort by an expression', () => {
    const state = run(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'servoTorque', expr: '1100' }, shoulder({ effort: 2000, velocity: 3, rotorInertia: 5400, gearRatio: 5.18 }), elbow({ effort: 'servoTorque', velocity: 6.2 })] });
    expect(state.document.mechanism.joints.elbow).toMatchObject({ effort: 1100, velocity: 6.2, expressions: { effort: 'servoTorque' } });
    expect(state.evaluation.mechanism.joints.shoulder.drive).toEqual({ effort: 2000, velocity: 3, rotorInertia: 5400, gearRatio: 5.18 });
    engine.undo();
    expect(engine.getState().document.mechanism.joints.elbow).not.toHaveProperty('effort');
    engine.redo();
  });

  it("b. a joint sent again without its drive (to widen its limits) keeps it; null removes it; a parameter's change is written back", () => {
    const widened = previewed(engine, elbow({ lower: 'deg(-150)', upper: 'deg(150)' }));
    expect(widened.evaluation.mechanism.joints.elbow.drive).toEqual({ effort: 1100, velocity: 6.2 });
    expect(widened.document.mechanism.joints.elbow.expressions).toEqual({ effort: 'servoTorque', lower: 'deg(-150)', upper: 'deg(150)' });
    const removed = previewed(engine, { type: 'batch', commands: [elbow({ effort: null, velocity: null })] });
    expect(removed.evaluation.mechanism.joints.elbow.drive).toBeUndefined();
    expect(removed.document.mechanism.joints.elbow.expressions).toEqual({ lower: 'deg(-135)', upper: 'deg(135)' });
    // (a preview writes nothing back: its document keeps the numbers, its evaluation has the new one)
    expect(previewed(engine, { type: 'setParameter', name: 'servoTorque', expr: '1500' }).evaluation.mechanism.joints.elbow.drive?.effort).toBe(1500);
    const stronger = run(engine, { type: 'setParameter', name: 'servoTorque', expr: '1500' });
    expect((stronger.document.mechanism.joints.elbow as { effort?: number }).effort).toBe(1500);
    engine.undo();
    expect((engine.getState().document.mechanism.joints.elbow as { effort?: number }).effort).toBe(1100);
  });

  it('c. URDF: the elbow 0.12 m from the frame of the upper arm, the limits in radians, the masses in kilograms from the frame of the link', () => {
    const urdf = exported('urdf', { name: 'arm' });
    const description = text(urdf.files[0]);
    expect(urdf.files[0].path).toBe(ROBOT_FILES.urdf.path);
    expect(description).toContain('<robot name="arm">');
    expect(description).toContain('<joint name="elbow" type="revolute">\n    <origin xyz="0.12 0 0" rpy="0 0 0"/>');
    expect(description).toContain('<joint name="shoulder" type="revolute">\n    <origin xyz="0 0 0" rpy="0 0 0"/>');
    expect(description).toContain('<axis xyz="0 0 1"/>');
    expect(description).toContain('<limit lower="-2.35619449" upper="2.35619449" effort="1.1" velocity="6.2"/>');
    expect(description).toContain('<limit lower="-1.570796327" upper="1.570796327" effort="2" velocity="3"/>');
    // the upper arm with the motor at 280 g and four screws at 0.9 g each
    const upper = massOf(engine, { bodies: LINK }, { geometry: 'modelled' });
    near(upper.mass, 280 + 4 * 0.9 + upper.bodies[0].mass);
    near(upper.mass, 438.953225, 5);
    expect(description).toContain('<origin xyz="0.06 0 0.016177152" rpy="0 0 0"/>\n      <mass value="0.438953225"/>');
    // the forearm's product of inertia from its pin: the element of the tensor, minus the product
    expect(description).toContain('ixz="-0.000000237793"');
    // a material per colour, named by it; the visual of the motor refers to it
    expect(description).toContain('<material name="#30343a"><color rgba="0.188235 0.203922 0.227451 1"/></material>');
    expect(description).toContain('<visual name="motor"><geometry><mesh filename="motor.stl"/></geometry><material name="#30343a"/></visual>');
    expect(description).toContain('<collision name="screws/1"><geometry><mesh filename="screws_2F1.stl"/></geometry></collision>');
    const about = urdf.files[0].about as RobotAbout;
    expect(about).toMatchObject({ root: 'base', links: ['base', 'upper', 'forearm'], joints: ['shoulder', 'elbow'] });
    near(about.mass, exported('mjcf').files.slice(1).length > 0 ? massOf(engine, { bodies: ['base'] }, { geometry: 'modelled' }).mass + upper.mass + massOf(engine, { bodies: ['forearm'] }, { geometry: 'modelled' }).mass : 0, 6);
    expect(about.notWritten).toEqual([
      'joint "shoulder": rotorInertia and gearRatio: URDF has no place for the rotor or the gear of a drive (outside a transmission of ros_control); the MJCF writes the rotor as the armature of the joint and the gear in its motor',
      'the two links of a joint are not excluded from contact: URDF cannot say it, so a reader that collides convex hulls (MuJoCo) may find the parts of a joint in contact at rest; for MuJoCo use the MJCF',
    ]);
    // a mesh per body, in metres in the frame of its link: the forearm moved by −120 mm in X
    const mesh = urdf.files.find((file) => file.path === 'forearm.stl') as ExportFile;
    expect(mesh.about as RobotMeshAbout).toEqual({ bodies: ['forearm'], triangles: engine.getState().evaluation.bodies.forearm.solid.triangles.length / 3, link: 'forearm' });
    const view = new DataView(mesh.bytes.buffer, mesh.bytes.byteOffset);
    const xs = Array.from({ length: (mesh.bytes.length - 84) / 50 }, (_, t) => [0, 1, 2].map((v) => view.getFloat32(84 + 50 * t + 12 + 12 * v, true))).flat();
    expect(Math.min(...xs)).toBeCloseTo(-0.01, 6); // the plate reaches 70 mm round its centre, 60 mm beyond the elbow
    expect(Math.max(...xs)).toBeCloseTo(0.13, 6);
    // with a prefix for ROS
    expect(text(exported('urdf', { meshPrefix: 'package://arm_description/' }).files[0])).toContain('<mesh filename="package://arm_description/motor.stl"/>');
  });

  it('d. MJCF: the motors, the armature, the excluded pairs, and the pose of the document as a keyframe', () => {
    const xml = text(exported('mjcf', { name: 'arm' }).files[0]);
    expect(xml).toContain('<compiler angle="radian" autolimits="true"/>');
    // the armature of the shoulder: 5400 g·mm² · 5.18² = 144,894.96 g·mm² = 0.00014489496 kg·m²
    expect(xml).toContain('<joint name="shoulder" type="hinge" pos="0 0 0" axis="0 0 1" range="-1.570796327 1.570796327" armature="0.00014489496"/>');
    expect(xml).toContain('<motor name="shoulder" joint="shoulder" gear="5.18" ctrlrange="-0.386100386 0.386100386"/>');
    expect(xml).toContain('<motor name="elbow" joint="elbow" gear="1" ctrlrange="-1.1 1.1"/>');
    expect(xml).toContain('<exclude body1="base" body2="upper"/>');
    expect(xml).toContain('<exclude body1="upper" body2="forearm"/>');
    expect(xml).toContain('<body name="forearm" pos="0.12 0 0">');
    expect(xml).not.toContain('<keyframe>');
    expect((exported('mjcf').files[0].about as RobotAbout).notWritten).toEqual([
      'joint "shoulder": velocity: a motor clamps its control, not the speed of the joint, so the velocity is not written',
      'joint "elbow": velocity: a motor clamps its control, not the speed of the joint, so the velocity is not written',
    ]);
    // exported with a pose that is not written: the keyframe holds it, the bodies stay as modelled
    const posed = text(exported('mjcf', {}, previewed(engine, pose({ shoulder: 0.3, elbow: -0.7 }))).files[0]);
    expect(posed).toContain('<key name="pose" qpos="0.3 -0.7"/>');
    expect(posed).toContain('<body name="forearm" pos="0.12 0 0">');
    // collisions off: no exclusion, the geoms in no contact
    const none = text(exported('mjcf', { collision: 'none' }).files[0]);
    expect(none).not.toContain('<contact>');
    expect(none).toContain('<geom name="motor" type="mesh" mesh="motor" rgba="0.188235 0.203922 0.227451 1" contype="0" conaffinity="0"/>');
    expect(text(exported('urdf', { collision: 'none' }).files[0])).not.toContain('<collision');
  });

  it('e. what the export refuses or leaves out, each with what to do', () => {
    // a second root is refused until `root` names one; the other tree is left out and named
    const twoRoots = previewed(engine, { type: 'setLink', id: 'gripper', bodies: [] });
    expect(refusal('urdf', {}, twoRoots)).toEqual({ code: 'invalidArguments', message: `urdf: ${ROBOT_REFUSALS.roots.text}base, gripper`, arg: ['root'] });
    expect(exported('urdf', { root: 'base' }, twoRoots).files[0].about).toMatchObject({ root: 'base', leftOut: { links: ['gripper'] } });
    expect(refusal('urdf', { root: 'upper' })).toMatchObject({ code: 'invalidArguments', arg: ['root'], message: expect.stringContaining(`${ROBOT_REFUSALS.notRoot.text}"shoulder"`) });
    expect(refusal('mjcf', { root: 'nope' })).toMatchObject({ code: 'notAvailable', arg: ['root'], message: expect.stringContaining(`${ROBOT_REFUSALS.noSuchRoot.text}"nope"`) });
    // the state after the forearm: the sketch of the axes comes later, so both joints are in error
    const early = refusal('urdf', {}, { at: 'elbowPin' });
    expect(early.message).toMatch(new RegExp(`^urdf: ${ROBOT_REFUSALS.jointInError.text}shoulder \\(brokenReference: .*\\); elbow \\(brokenReference: `));
    // a forearm made auxiliary: the link a joint moves has no mass
    expect(refusal('mjcf', {}, previewed(engine, { type: 'setBodyProperties', body: 'forearm', patch: { use: 'auxiliary' } })).message).toBe(`mjcf: ${ROBOT_REFUSALS.massless.text}forearm`);
    // the motor on a link of its own, fixed to an upper arm whose plate is auxiliary: the moving link is only a frame
    const frameOnly = previewed(engine, {
      type: 'batch',
      commands: [
        { type: 'setLink', id: 'upper', bodies: LINK.filter((body) => body !== 'motor') },
        { type: 'setLink', id: 'motor', bodies: ['motor'] },
        { type: 'setJoint', id: 'mount', joint: { type: 'fixed', parent: 'upper', child: 'motor' } },
        { type: 'setBodyProperties', body: 'upper', patch: { use: 'auxiliary' } },
        { type: 'setBodyProperties', body: 'screw', patch: { use: 'auxiliary' } },
      ],
    });
    const frame = exported('mjcf', {}, frameOnly);
    expect(frame.files[0].about).toMatchObject({ links: ['base', 'upper', 'forearm', 'motor'], joints: ['shoulder', 'elbow', 'mount'], leftOut: { auxiliary: ['upper', 'screw', 'screws/1', 'screws/2', 'screws/3'] } });
    expect(text(frame.files[0])).toContain('<body name="upper" pos="0 0 0">\n        <joint name="shoulder"');
    expect(text(frame.files[0])).toContain('<body name="motor" pos="0 0 0">');
    // equal limits: MuJoCo would turn the limit off, so the MJCF refuses; the URDF writes them
    const locked = previewed(engine, elbow({ lower: 0, upper: 0 }));
    expect(refusal('mjcf', {}, locked).message).toBe(`mjcf: ${ROBOT_REFUSALS.mjcfLocked.text}elbow`);
    expect(text(exported('urdf', {}, locked).files[0])).toContain('<limit lower="0" upper="0" effort="1.1" velocity="6.2"/>');
    // a body without a density or a mass: the text of the query mass, with the link
    const noDensity = refusal('mjcf', {}, previewed(engine, { type: 'setBodyProperties', body: 'base', patch: { material: null, density: null } }));
    expect(noDensity.message).toMatch(/^mjcf: the mass of a link cannot be computed: link "base": density: the body "base" has no density of its own/);
    // a body of the model in no link is left out and named
    const forgotten = exported('mjcf', {}, previewed(engine, { type: 'setLink', id: 'upper', bodies: LINK.slice(0, -1) }));
    expect((forgotten.files[0].about as RobotAbout).leftOut).toEqual({ bodies: ['screws/3'] });
    // a broken expression of an effort: the joint stays ok for the pose, both formats refuse
    const broken = previewed(engine, { type: 'removeParameter', name: 'servoTorque' });
    expect(broken.evaluation.mechanism.joints.elbow).toMatchObject({ status: 'ok', drive: { velocity: 6.2 }, driveErrors: { effort: { code: 'unknownName' } } });
    expect(refusal('urdf', {}, broken).message).toMatch(new RegExp(`^urdf: ${ROBOT_REFUSALS.driveInError.text}elbow \\(effort: `));
    expect(refusal('mjcf', {}, broken).message).toMatch(new RegExp(`^mjcf: ${ROBOT_REFUSALS.driveInError.text}elbow \\(effort: `));
    // a pose beyond the joint is still read
    const posedBroken = engine.preview({ type: 'batch', commands: [{ type: 'removeParameter', name: 'servoTorque' }, pose({ elbow: 0.5 })] });
    expect(posedBroken.ok && posedBroken.state.evaluation.mechanism.links.forearm.blockedBy).toBeUndefined();
    // the joint sent back whole with its broken expression unchanged (as the form of the app does) is
    // taken, in the same batch as the removal of the parameter, and the effort stays in error
    const resent = engine.preview({ type: 'batch', commands: [{ type: 'removeParameter', name: 'servoTorque' }, elbow({ effort: 'servoTorque', velocity: 6.2, lower: 'deg(-120)' })] });
    expect(resent.ok && resent.state.evaluation.mechanism.joints.elbow.driveErrors?.effort).toBeTruthy();
    expect(resent.ok && resent.state.evaluation.mechanism.joints.elbow.lower).toBeCloseTo((-120 * Math.PI) / 180, 12);
    // a document without a link
    const bare = previewed(engine, { type: 'batch', commands: ['shoulder', 'elbow'].map((id): Command => ({ type: 'removeJoint', id })).concat(['base', 'upper', 'forearm'].map((id): Command => ({ type: 'removeLink', id }))) });
    expect(exported('urdf', {}, bare)).toEqual({ layout: 'directory', files: [], empty: NO_MECHANISM });
  });

  it('f. save and load: the drive is kept with its expression; no upgrade step (the joint validator refuses fields it does not know)', () => {
    expect(SCHEMA_PENDING).toBe(1); // the branch d36/3c; 0 after its merge
    expect(UPGRADES.map((step) => step.name)).not.toContain('5b-drive');
    const saved = engine.save();
    expect(JSON.parse(saved).mechanism.joints.elbow).toMatchObject({ effort: 1100, velocity: 6.2, expressions: { effort: 'servoTorque' } });
    const loaded = engine.load(saved);
    expect(loaded.ok && loaded.state.document.mechanism.joints.shoulder).toMatchObject({ effort: 2000, velocity: 3, rotorInertia: 5400, gearRatio: 5.18 });
  });
});

// The part of 5d (D61, docs/d36/5d-generators/calls.ts): below the base a cycloidal stage for the
// shoulder (twelve ring pins and a disc over their circle), and a GT2 belt stage from the motor to
// the elbow (a pulley of 20 grooves on the motor and one of 40 above the elbow).
describe('scenario 13, the part of 5d: a cycloidal stage at the shoulder and a GT2 belt stage from the motor to the elbow', () => {
  let engine: Engine;
  const param = (name: string, expr: string): Command => ({ type: 'setParameter', name, expr });
  const facts = (state: EngineState, id: Id) => state.evaluation.features[id]?.facts ?? {};
  const previewed = (...commands: Command[]): EngineState => {
    const result = engine.preview(commands.length === 1 ? commands[0] : { type: 'batch', commands });
    if (!result.ok) throw new Error(result.error.message);
    return result.state;
  };
  const DISC_PARAMS = { pins: 'nPins', pinRadius: 'pinR', eccentricity: 'ecc', clearance: 0, rotation: 0, pinAngle: 0 };
  const discFeature = (id: Id, params: Record<string, number | string>, start = -20): Command => ({
    type: 'addFeature',
    feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'generated', generator: 'cycloidalDisc', sketch: 'cyclo', operands: { circle: 'pinCircle' }, params }, extent: { type: 'distance', start, distance: 3 }, operation: 'new' },
  });
  const PINS: Id[] = ['pin', ...Array.from({ length: 11 }, (_, k) => `ringPins/${k + 1}`)];
  const ofDisc = (disc: Id) => (pair: { a: Id; b: Id }): boolean => pair.a === disc || pair.b === disc;
  // The smallest gap between the disc and a pin, when the pair is measured and does not touch.
  const nearestGap = (disc: Id, state?: EngineState): number | undefined => {
    const gap = engine.query('gap', { bodies: [disc, ...PINS], within: 1 }, state ? { state } : {});
    if (!gap.ok || gap.result.failed.some(ofDisc(disc)) || (gap.result.cleared ?? []).some(ofDisc(disc))) return undefined;
    const nearest = gap.result.pairs.find(ofDisc(disc));
    return nearest !== undefined && nearest.contact === undefined ? nearest.distance : undefined;
  };
  // The disc and the pins share no volume and do not touch: the disc in no list of the collision
  // check, and its smallest gap to the pins above zero and a few hundredths at most.
  const clearOfThePins = (disc: Id = 'disc', state?: EngineState): number => {
    const report = unwrap(engine.query('interference', { bodies: [disc, ...PINS] }, state ? { state } : {}));
    expect([...report.pairs, ...report.fits, ...report.failed, ...(report.cleared ?? [])].filter(ofDisc(disc))).toEqual([]);
    const distance = nearestGap(disc, state);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(0.03);
    return distance as number;
  };
  const pulley = (id: Id, x: number, z: number, teeth: number): Command[] => {
    const sketch = `${id}Sketch`;
    return [
      { type: 'addFeature', feature: emptySketch(sketch, sketch, { kind: 'base', plane: 'XY' }) },
      { type: 'addPoint', sketch, id: `${id}Axis`, x, y: 0 },
      { type: 'addConstraint', sketch, id: `${id}AxisFix`, constraint: { type: 'fixed', point: `${id}Axis`, x, y: 0 } },
      {
        type: 'addFeature',
        feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'generated', generator: 'gt2Pulley', sketch, operands: { center: `${id}Axis` }, params: { teeth, allowance: 0, rotation: 0 } }, extent: { type: 'distance', start: z, distance: 6 }, operation: 'new' },
      },
    ];
  };

  beforeAll(() => {
    engine = newEngine();
    run(engine, arm());
    // the pins from z −20 to −10 and the disc from −20 to −17: the circle of the pins about the
    // shoulder, a pin of radius 2.5 on it at (25, 0) and its circular pattern, the disc over the circle
    run(
      engine,
      {
        type: 'batch',
        commands: [
          param('nPins', '12'),
          param('pinR', '2.5'),
          param('ecc', '1'),
          { type: 'addFeature', feature: emptySketch('cyclo', 'cyclo', { kind: 'base', plane: 'XY' }) },
          { type: 'addCurve', sketch: 'cyclo', id: 'pinCircle', curve: { type: 'circle', center: 'origin', construction: true }, radius: 25 },
          { type: 'addConstraint', sketch: 'cyclo', id: 'pinCircleR', constraint: { type: 'radius', curve: 'pinCircle', value: 25, driving: true } },
          { type: 'addPoint', sketch: 'cyclo', id: 'pc', x: 25, y: 0 },
          { type: 'addConstraint', sketch: 'cyclo', id: 'pcFix', constraint: { type: 'fixed', point: 'pc', x: 25, y: 0 } },
          { type: 'addCurve', sketch: 'cyclo', id: 'pinOutline', curve: { type: 'circle', center: 'pc' }, radius: 2.5 },
          { type: 'addConstraint', sketch: 'cyclo', id: 'pinOutlineR', constraint: { type: 'radius', curve: 'pinOutline', value: 'pinR', driving: true } },
          { type: 'addFeature', feature: { id: 'pin', name: 'pin', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'cyclo', regions: [{ outerLoop: ['pinOutline'] }] }, extent: { type: 'distance', start: -20, distance: 10 }, operation: 'new' } },
          { type: 'addFeature', feature: { id: 'ringPins', name: 'ringPins', suppressed: false, type: 'pattern', source: { type: 'body', body: 'pin' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 'nPins', span: { type: 'full' } } } },
          discFeature('disc', DISC_PARAMS),
        ],
      },
    );
  });

  it('a. the disc publishes 11 lobes, the ratio 11, the tips at 47 and the bottoms at 43, its centre 1 mm off the axis', () => {
    const state = engine.getState();
    expect(state.evaluation.features.disc.status).toBe('ok');
    const f = facts(state, 'disc');
    expect(Object.keys(f).sort()).toEqual(Object.keys(GENERATORS.cycloidalDisc.facts).sort());
    expect(f).toMatchObject({ lobes: 11, ratio: 11, pins: 12, outerDiameter: expect.closeTo(47, 9), innerDiameter: expect.closeTo(43, 9), center: [1, 0, 0], ringCenter: [0, 0, 0], discRotation: 0 });
    expect(state.document.features.find((feature) => feature.id === 'disc')?.expressions).toEqual({ 'profile/params/eccentricity': 'ecc', 'profile/params/pinRadius': 'pinR', 'profile/params/pins': 'nPins' });
    // one side face, `lobes`
    expect(state.evaluation.faceNames.filter((name) => name.feature === 'disc').map((name) => ('curve' in name ? `${name.role}/${name.curve}` : name.role)).sort()).toEqual(['endCap', 'side/lobes', 'startCap']);
  });

  it('b. the disc and the pins share no volume and do not touch; a quarter turn of the input and the second disc at π stay clear', () => {
    clearOfThePins();
    // a quarter turn of the input: the disc moves round the eccentric and turns back by 1/11 of that
    const turned = previewed({ type: 'updateFeature', id: 'disc', patch: { profile: { params: { rotation: 'deg(90)' } } } });
    expect(facts(turned, 'disc')).toMatchObject({ center: [expect.closeTo(0, 9), expect.closeTo(1, 9), 0], discRotation: expect.closeTo(-Math.PI / 2 / 11, 12) });
    clearOfThePins('disc', turned);
    // the second disc of a two-disc drive: the input at π, from −16 to −13
    const second = previewed(discFeature('disc2', { ...DISC_PARAMS, rotation: 'pi' }, -16));
    expect(facts(second, 'disc2').center).toEqual([expect.closeTo(-1, 9), expect.closeTo(0, 9), 0]);
    clearOfThePins('disc2', second);
  });

  it('c. pins drawn half a pitch round are met with `pinAngle` 15° and cut into without it', () => {
    const pinsMoved: Command[] = [
      { type: 'setField', feature: 'cyclo', path: 'constraints/pcFix/x', value: '25 * cos(deg(15))' },
      { type: 'setField', feature: 'cyclo', path: 'constraints/pcFix/y', value: '25 * sin(deg(15))' },
    ];
    const withAngle = previewed(...pinsMoved, { type: 'updateFeature', id: 'disc', patch: { profile: { params: { pinAngle: 'deg(15)' } } } });
    expect(facts(withAngle, 'disc').discRotation).toBeCloseTo(Math.PI / 11, 12);
    clearOfThePins('disc', withAngle);
    const without = previewed(...pinsMoved);
    expect(unwrap(engine.query('interference', { bodies: ['disc', ...PINS] }, { state: without })).pairs.some(ofDisc('disc'))).toBe(true);
  });

  it('d. a clearance of 0.1 keeps the disc at least 0.1 from the pins', () => {
    const state = previewed({ type: 'updateFeature', id: 'disc', patch: { profile: { params: { clearance: 0.1 } } } });
    const distance = nearestGap('disc', state);
    expect(distance).toBeGreaterThanOrEqual(0.1);
    expect(distance).toBeLessThan(0.13);
  });

  it('e. what cannot be built is an error of the disc with the reason', () => {
    // E · N = 36 ≥ R = 25
    expect(previewed(param('ecc', '3')).evaluation.features.disc.error).toMatchObject({ code: 'invalidProfile', message: expect.stringMatching(/the eccentricity times the number of pins \(36\) is not below the radius of the pin circle 25/) });
    // pins of radius 7 overlap: they touch at R sin(π/12) = 6.4705
    expect(previewed(param('pinR', '7')).evaluation.features.disc.error).toMatchObject({ code: 'invalidProfile', message: expect.stringMatching(/the pins overlap one another/) });
  });

  it('f. a pulley of 20 grooves on the motor and one of 40 above the elbow: the diameters of Gates\' table, one face `grooves` each', () => {
    const state = run(engine, { type: 'batch', commands: [...pulley('motorPulley', 60, 38, 20), ...pulley('elbowPulley', 120, 16.5, 40)] });
    const [small, large] = [facts(state, 'motorPulley'), facts(state, 'elbowPulley')];
    expect(small).toMatchObject({ teeth: 20, pitch: 2, pitchDiameter: expect.closeTo(40 / Math.PI, 12), outsideDiameter: expect.closeTo(40 / Math.PI - 0.508, 12), center: [60, 0, 0], axis: [0, 0, 1] });
    expect(large).toMatchObject({ teeth: 40, outsideDiameter: expect.closeTo(80 / Math.PI - 0.508, 12), center: [120, 0, 0] });
    expect(Math.abs((small.outsideDiameter as number) - 12.22)).toBeLessThan(0.005);
    expect(Math.abs((large.outsideDiameter as number) - 24.96)).toBeLessThan(0.005);
    // the volume is the area of the outline times 6 (the exact outlines 103.020 and 460.278 mm²; the
    // polygon is smaller by its chords)
    expect(volumeOf(state, 'motorPulley')).toBeLessThan(6 * 103.02);
    expect(volumeOf(state, 'motorPulley')).toBeGreaterThan(6 * (103.02 - 0.2));
    expect(volumeOf(state, 'elbowPulley')).toBeLessThan(6 * 460.278);
    expect(volumeOf(state, 'elbowPulley')).toBeGreaterThan(6 * (460.278 - 0.4));
    expect(state.evaluation.faceNames.filter((name) => name.feature === 'motorPulley' && name.role === 'side').map((name) => ('curve' in name ? name.curve : ''))).toEqual(['grooves']);
    // the pulleys stand clear of the motor, the forearm and the pin of the elbow
    expect(unwrap(engine.query('interference', {})).pairs.filter((pair) => /Pulley/.test(pair.a) || /Pulley/.test(pair.b))).toEqual([]);
    // fewer than 12 grooves is an invalid command
    expect(engine.preview({ type: 'updateFeature', id: 'motorPulley', patch: { profile: { params: { teeth: 10 } } } })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/params\.teeth: the value 10 is not in the interval \[12, 500\]/) } });
  });

  it('g. the document saves and loads unchanged', () => {
    const saved = engine.save();
    const other = newEngine();
    expect(other.load(saved).ok).toBe(true);
    expect(other.save()).toBe(saved);
  });
});

// ---------------------------------------------------------------- the part of 3b

// The part of 3b (D55, docs/d36/3b-mesh-import/calls.ts): the motor as the mesh of a bought part.
// Its file is modelled in a second engine and written as binary STL (a test has no file of a real
// motor; this one has what matters of one: round faces cut into triangles, a frame of its own, no
// unit), read by the import, stored in the document and placed by a mesh feature in the place and
// under the ID of the cylinder that stood for the motor.
describe('scenario 13, the part of 3b: the motor as the mesh of a bought part', () => {
  let engine: Engine;
  let shop: Engine; // the second engine, in which the part that is "bought" is modelled
  let file: Uint8Array;
  const read = (outcome: ImportOutcome): { mesh: StoredMesh; report: MeshReport } => {
    if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
    return outcome;
  };
  const codeOf = (outcome: ImportOutcome): string => (outcome.ok ? 'ok' : outcome.error.code);
  const MOTOR_POINT = { kind: 'sketchPoint', sketch: 'motorSketch', point: 'motorCentre' } as const;
  // a cylinder with a list of targets (the helper of arm.ts takes one)
  const cylinderInto = (id: Id, x: number, y: number, radius: number, from: number, to: number, operation: 'add' | 'cut', targets: Id[]): Command[] => {
    const commands = cylinder(id, x, y, radius, from, to);
    const last = commands[commands.length - 1] as Extract<Command, { type: 'addFeature' }>;
    return [...commands.slice(0, -1), { type: 'addFeature', feature: { ...(last.feature as object), operation, targets } as never }];
  };
  // a box from a rectangle of its own sketch on XY, between two heights
  const box = (id: Id, x0: number, y0: number, x1: number, y1: number, from: number, to: number): Command[] => {
    const sketchId = `${id}Sketch`;
    const corners: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    return [
      { type: 'addFeature', feature: emptySketch(sketchId, sketchId, { kind: 'base', plane: 'XY' }) },
      ...corners.flatMap(([x, y], i): Command[] => [
        { type: 'addPoint', sketch: sketchId, id: `${id}P${i}`, x, y },
        { type: 'addConstraint', sketch: sketchId, id: `${id}F${i}`, constraint: { type: 'fixed', point: `${id}P${i}`, x, y } },
      ]),
      ...corners.map((_, i): Command => ({ type: 'addCurve', sketch: sketchId, id: `${id}L${i}`, curve: { type: 'line', a: `${id}P${i}`, b: `${id}P${(i + 1) % 4}` } })),
      {
        type: 'addFeature',
        feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: sketchId, regions: [{ outerLoop: [0, 1, 2, 3].map((i) => `${id}L${i}`).sort() }] }, extent: { type: 'distance', start: from, distance: to - from }, operation: 'new' },
      },
    ];
  };
  // the same triangles as text: `solid`, a `facet` with three `vertex` lines per triangle, `endsolid`
  const asciiStl = (binary: Uint8Array): Uint8Array => {
    const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
    const lines = ['solid motor'];
    for (let t = 0; t < view.getUint32(80, true); t++) {
      lines.push('  facet normal 0 0 0', '    outer loop');
      for (let k = 0; k < 3; k++) lines.push(`      vertex ${[0, 1, 2].map((axis) => view.getFloat32(84 + 50 * t + 12 + 12 * k + 4 * axis, true)).join(' ')}`);
      lines.push('    endloop', '  endfacet');
    }
    lines.push('endsolid motor');
    return new TextEncoder().encode(lines.join('\n'));
  };
  // a binary STL without its last triangle (the count at byte 80 lowered by one)
  const withoutLastTriangle = (binary: Uint8Array): Uint8Array => {
    const out = binary.slice(0, binary.length - 50);
    new DataView(out.buffer).setUint32(80, (binary.length - 84) / 50 - 1, true);
    return out;
  };

  beforeAll(() => {
    // the arm after the parts of 3a and 5a: the motor a named reference part of 280 g, in the link `upper`
    engine = newEngine();
    run(engine, arm());
    run(engine, {
      type: 'batch',
      commands: [
        { type: 'setBodyMaterial', body: 'upper', material: 'PETG' },
        { type: 'setBodyMaterial', body: 'forearm', material: 'PLA' },
        { type: 'setBodyProperties', body: 'motor', patch: { name: 'NEMA 17 motor', color: '#30343a', use: 'reference', mass: 280 } },
        { type: 'setBodyProperties', body: 'screw', patch: { use: 'reference', mass: 0.9 } },
      ],
    });
    run(engine, mechanismOfTheArm());
    // the motor as its maker would publish it: a can of radius 14 and height 30 with a shaft of
    // radius 2.5 and length 10 on top, its axis along Z through the origin, standing on z = 0
    shop = newEngine();
    run(shop, { type: 'batch', commands: [...cylinder('can', 0, 0, 14, 0, 30), ...cylinder('shaft', 0, 0, 2.5, 30, 40, 'add', 'can')] });
    file = shop.exportMesh('stl', ['can']);
  });

  it('a. the file is read: one shell, nothing left out, the volume of the body it was written from to the last digit, its box', () => {
    const { mesh, report } = read(importMesh('stl', file, {}, 'motor.stl'));
    const can = shop.getState().evaluation.bodies.can;
    expect(report).toMatchObject({ format: 'stl', about: { encoding: 'binary', unit: 'mm' }, dropped: 0, walls: 0, shells: 1, cavities: 0, insideOut: false, turned: 0, nested: 0, notes: [] });
    expect(report.triangles).toBe(can.solid.triangles.length / 3);
    expect(report.facets).toBe(report.triangles);
    expect(report.volume).toBe(can.volume);
    expect([report.bounds.min[2], report.bounds.max[2]]).toEqual([0, 40]);
    expect(mesh.name).toBe('motor.stl');
    expect(meshProblem(indexedMesh(mesh))).toBeUndefined();
    // the same triangles as ASCII give the same stored mesh, text for text
    const ascii = read(importMesh('stl', asciiStl(file)));
    expect(ascii.report.about.encoding).toBe('ascii');
    expect([ascii.mesh.positions, ascii.mesh.triangles]).toEqual([mesh.positions, mesh.triangles]);
    // a file in metres: the bounds say so
    expect(read(importMesh('stl', file, { unit: 'm' })).report.bounds.max).toEqual([14_000, 14_000, 40_000]);
    expect(read(importMesh('stl', file, { unit: 'm' })).report.notes).toEqual([expect.stringContaining('is the unit of the file right')]);
  });

  it('a. solids stacked on one outline are one solid: the two layers of each common face are left out', () => {
    run(shop, { type: 'batch', commands: [...box('low', 0, 0, 42, 42, 0, 10), ...box('stack', 0, 0, 42, 42, 10, 30), ...box('high', 0, 0, 42, 42, 30, 40)] });
    const { report } = read(importMesh('stl', shop.exportMesh('stl', ['low', 'stack', 'high'])));
    expect([report.walls, report.shells]).toEqual([4, 1]);
    expect(Math.abs(report.volume - 42 * 42 * 40)).toBeLessThan(1e-6);
    // the bodies of the engine: three cylinders (the motor of the arm) on one outline
    run(shop, { type: 'batch', commands: [...cylinder('c1', 200, 0, 14, 0, 10), ...cylinder('c2', 200, 0, 14, 10, 20), ...cylinder('c3', 200, 0, 14, 20, 30)] });
    const cans = read(importMesh('stl', shop.exportMesh('stl', ['c1', 'c2', 'c3'])));
    expect(cans.report.shells).toBe(1);
    expect(cans.report.volume).toBeCloseTo(3 * shop.getState().evaluation.bodies.c1.volume, 6);
  });

  it('a. a pair of opposite triangles is left out only between two solids that both face outwards', () => {
    const positions = Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 20, 20, 5]);
    const outward = [0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2];
    const second = (apex: number): number[] => [0, 1, 2, 0, apex, 1, 1, apex, 2, 0, 2, apex]; // its base faces +Z
    const inwards = withoutWalls({ positions, triangles: Uint32Array.from([...outward, ...second(4)]) });
    expect([inwards.walls, meshDefects(inwards.mesh).overused, meshProblem(inwards.mesh)?.code]).toEqual([0, 3, 'notASolid']);
    const below = Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 2, 2, -5]);
    const stacked = withoutWalls({ positions: below, triangles: Uint32Array.from([...outward, ...second(4)]) });
    expect(stacked.walls).toBe(1);
    expect(meshProblem(stacked.mesh)).toBeUndefined();
    expect(shellsOf(stacked.mesh).map((shell) => shell.volume)[0]).toBeCloseTo(250, 9);
  });

  it('a. what the import refuses, each with a code and a reason the caller can act on', () => {
    const open = importMesh('stl', withoutLastTriangle(file));
    expect(open).toMatchObject({ ok: false, error: { code: 'notASolid', defects: { open: 3 } } });
    run(shop, { type: 'batch', commands: [...box('left', 0, 0, 10, 10, 100, 110), ...box('right', 10, 10, 20, 20, 100, 110)] });
    expect(importMesh('stl', shop.exportMesh('stl', ['left', 'right']))).toMatchObject({ ok: false, error: { code: 'notASolid', defects: { overused: 1 } } });
    expect(codeOf(importMesh('stl', new TextEncoder().encode('not a mesh')))).toBe('unreadable');
    expect(codeOf(importMesh('stl', new Uint8Array(0)))).toBe('unreadable');
    expect(importMesh('stl', file, { unit: 'ft' } as never)).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['unit'] } });
    expect(importMesh('step' as never, file)).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['format'] } });
  });

  it('a. the checks of a stored mesh are the engine own: a mesh built by hand goes through the same function', () => {
    const mesh: IndexedMesh = { positions: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]), triangles: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]) };
    const turned: IndexedMesh = { positions: mesh.positions, triangles: Uint32Array.from([0, 1, 2, 0, 3, 1, 1, 3, 2, 0, 2, 3]) };
    const two: IndexedMesh = {
      positions: Float32Array.from([...mesh.positions, 50, 0, 0, 55, 0, 0, 50, 5, 0, 50, 0, 5]),
      triangles: Uint32Array.from([...mesh.triangles, ...Array.from(turned.triangles, (vertex) => vertex + 4)]),
    };
    const stored = storedMesh(mesh, 'tetrahedron');
    expect([stored.positions.length, stored.triangles.length]).toEqual([64, 64]);
    expect(meshProblem(turned)?.code).toBe('notASolid');
    expect(meshDefects({ positions: mesh.positions, triangles: mesh.triangles.slice(0, 9) }).open).toBe(3);
    expect(meshProblem(two)).toMatchObject({ code: 'notASolid', message: expect.stringContaining('inside out') });
    expect(shellsOf(two).map((shell) => shell.kind)).toEqual(['solid', 'insideOut']);
  });

  it('b. the mesh enters the document and replaces the cylinder of the motor under its ID, in one batch and one undo step', () => {
    const { mesh } = read(importMesh('stl', file, {}, 'motor.stl'));
    const before = engine.getState();
    const massBefore = massOf(engine, { bodies: [...before.evaluation.mechanism.links.upper.bodies, 'forearm'] }).mass;
    const index = before.document.features.findIndex((feature) => feature.id === 'motor');
    const feature: MeshFeature = { id: 'motor', name: 'Motor', suppressed: false, type: 'mesh', mesh: 'nema', placement: { frame: MOTOR_POINT, z: 8 } };
    const command: Command = { type: 'batch', commands: [{ type: 'removeFeature', id: 'motor' }, { type: 'addMesh', id: 'nema', mesh }, { type: 'addFeature', feature, index }] };
    expect(takenOver(before.document, command)).toEqual(['motor']);
    const { document, evaluation, canUndo } = run(engine, command);
    const stored = evaluation.meshes.nema;
    const body = evaluation.bodies.motor;
    const facts = evaluation.features.motor.facts ?? {};
    expect(Object.keys(document.meshes)).toEqual(['nema']);
    expect(stored).toMatchObject({ name: 'motor.stl', shells: 1, usedBy: ['motor'], triangles: body.solid.triangles.length / 3 });
    expect(evaluation.features.motor).toMatchObject({ status: 'ok', bodies: ['motor'] });
    // one face for the whole surface, not planar, and no edge
    expect(body.faces).toEqual([{ id: body.faces[0].id, planar: false }]);
    expect(evaluation.faceNames[body.faces[0].id]).toEqual({ feature: 'motor', role: 'mesh' });
    expect(evaluation.faceSurfaces[body.faces[0].id]).toEqual({ kind: 'general' });
    expect(body.edges).toEqual([]);
    // where the file has z = 0 … 40 the model has z = 8 … 48, about the point (60, 0)
    expect([body.bounds.min[2], body.bounds.max[2]]).toEqual([8, 48]);
    expect([facts.origin, facts.axisZ]).toEqual([
      [60, 0, 8],
      [0, 0, 1],
    ]);
    expect(Math.abs(body.volume - stored.volume)).toBeLessThan(1e-6 * stored.volume);
    // the body keeps what the document says about `motor`: a reference part of 280 g in the link `upper`
    expect(evaluation.bodyProperties.motor).toMatchObject({ name: 'NEMA 17 motor', use: 'reference', mass: 280, massFrom: 'mass' });
    expect(evaluation.mechanism.links.upper.bodies).toContain('motor');
    expect(canUndo).toBe(true);
    // the mass beyond the shoulder is what it was: the motor weighs what its data sheet says
    expect(massOf(engine, { bodies: [...evaluation.mechanism.links.upper.bodies, 'forearm'] }).mass).toBeCloseTo(massBefore, 9);
    // one undo takes the feature and the stored mesh away and brings the cylinder back
    engine.undo();
    expect(Object.keys(engine.getState().document.meshes)).toEqual([]);
    expect(engine.getState().evaluation.bodies.motor.faces).toHaveLength(3);
    engine.redo();
    expect(engine.getState().evaluation.bodies.motor.faces).toHaveLength(1);
  });

  it('c. no sketch or plane stands on it: a plane on its face is a valid command and the error nonPlanarFace', () => {
    const preview = previewed(engine, { type: 'addFeature', feature: { id: 'onMotor', name: 'On the motor', suppressed: false, type: 'plane', base: { kind: 'face', body: 'motor', face: { feature: 'motor', role: 'mesh' } }, offset: 0 } });
    expect(preview.evaluation.features.onMotor.error?.code).toBe('nonPlanarFace');
  });

  it('c. no feature changes it: a hole through it, a boss on it, a cut with it among two targets end in importedTarget', () => {
    const before = engine.getState().evaluation.bodies;
    const { features, bodies } = previewed(engine, {
      type: 'batch',
      commands: [
        ...cylinderInto('bore', 60, 0, 1, 0, 60, 'cut', ['motor']),
        ...cylinderInto('boss', 60, 0, 5, 48, 52, 'add', ['motor']),
        ...cylinderInto('both', 60, 0, 1, 0, 60, 'cut', ['upper', 'motor']),
        ...cylinderInto('link', 60, 0, 1, 0, 60, 'cut', ['upper']),
      ],
    }).evaluation;
    for (const id of ['bore', 'boss', 'both']) expect(features[id], id).toMatchObject({ status: 'error', error: { code: 'importedTarget', refs: ['motor'] } });
    expect(features.link.status).toBe('ok');
    expect(bodies.motor.solid).toBe(before.motor.solid);
    expect(bodies.upper.volume).toBeLessThan(before.upper.volume); // by `link` alone
    // neither does a copy of it made by a pattern: the copy carries the face of the mesh
    const twin = previewed(engine, {
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: { id: 'twin', name: 'Twin', suppressed: false, type: 'pattern', source: { type: 'body', body: 'motor' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'spacing', spacing: 40 } } } },
        ...cylinderInto('boreTwin', 60, 40, 1, 0, 60, 'cut', ['twin/1']),
      ],
    });
    expect(twin.evaluation.features.boreTwin.error).toMatchObject({ code: 'importedTarget', refs: ['twin/1'] });
    expect(twin.evaluation.faceNames[twin.evaluation.bodies['twin/1'].faces[0].id]).toEqual({ feature: 'motor', role: 'mesh', copy: [{ pattern: 'twin', index: 1 }] });
  });

  it('d. the sweep of the elbow finds the forearm in the motor from the same step as with the cylinder', () => {
    for (let degrees = -135; degrees <= 135; degrees += 27) {
      const report = unwrap(engine.query('interference', {}, { state: previewed(engine, pose({ elbow: degrees * DEG })) }));
      expect(names(report.pairs).includes('forearm|motor'), `${degrees}°`).toBe(Math.abs(degrees) >= 108);
    }
  });

  it('d. the gap to the motor is measured to the triangles of the mesh in the pose', () => {
    const bent = unwrap(engine.query('gap', { bodies: ['forearm', 'motor'], within: 30 }, { state: previewed(engine, pose({ elbow: 1.2 })) }));
    const centre = [120 + 60 * Math.cos(1.2), 60 * Math.sin(1.2)];
    expect(bent.pairs[0].distance).toBeCloseTo(Math.hypot(centre[0] - 60, centre[1]) - 70 - 14, 1);
  });

  it('d. an edit before the motor that keeps the number of faces leaves its body the same object', () => {
    const preview = previewed(engine, { type: 'setField', feature: 'base', path: 'extent/distance', value: 9 });
    expect(preview.evaluation.bodies.base.volume).not.toBe(engine.getState().evaluation.bodies.base.volume);
    expect(preview.evaluation.bodies.motor.solid).toBe(engine.getState().evaluation.bodies.motor.solid);
  });

  it('d. an overlap with the motor shallower than the chord tolerance is a fit: its surface counts as round', () => {
    const report = unwrap(engine.query('interference', { bodies: ['upper', 'motor'] }, { state: previewed(engine, { type: 'setField', feature: 'motor', path: 'placement/z', value: 7.995 }) }));
    expect([report.fits.length, report.pairs.length]).toEqual([1, 0]);
  });

  it('d. the exports: a print export without a list leaves the reference part out, a list that names it writes it', () => {
    const printed = unwrap(engine.export('stl', {}));
    const listed = unwrap(engine.export('3mf', { bodies: ['upper', 'motor'] }));
    expect((printed.files[0].about as { bodies: Id[] }).bodies).not.toContain('motor');
    expect((listed.files[0].about as { bodies: Id[] }).bodies).toEqual(['upper', 'motor']);
  });

  it('e. the six numbers are numeric fields: a turn as an expression in degrees, an offset where the feature had none', () => {
    const decoded = indexedMesh(engine.getState().document.meshes.nema);
    const state = run(engine, { type: 'batch', commands: [{ type: 'updateFeature', id: 'motor', patch: { placement: { rz: 'deg(90)' } } }, { type: 'setField', feature: 'motor', path: 'placement/x', value: 2 }] });
    const motor = state.document.features.find((feature) => feature.id === 'motor') as MeshFeature;
    const facts = state.evaluation.features.motor.facts ?? {};
    expect(motor.placement.rz).toBeCloseTo(Math.PI / 2, 12);
    expect(motor.expressions).toEqual({ 'placement/rz': 'deg(90)' });
    expect(motor.placement.x).toBe(2);
    expect(motor.placement).not.toHaveProperty('y'); // absent means 0 and is not stored
    // the X axis of the mesh now points along +Y of the model; the offset is in the frame, not in the turned part
    expect((facts.axisX as number[])[1]).toBeCloseTo(1, 12);
    expect(facts.origin).toEqual([62, 0, 8]);
    expect(PLACEMENT_FIELDS).toHaveLength(6);
    // the stored mesh is not decoded again
    expect(indexedMesh(state.document.meshes.nema)).toBe(decoded);
    // the order of the turns: first about X, then about Y, then about the normal, the axes staying where they are
    const ordered = previewed(engine, { type: 'updateFeature', id: 'motor', patch: { placement: { rx: 'deg(90)', ry: null, rz: 'deg(90)' } } });
    const axisZ = ordered.evaluation.features.motor.facts?.axisZ as number[];
    [1, 0, 0].forEach((value, axis) => expect(axisZ[axis]).toBeCloseTo(value, 12));
    // a frame that is not there: the error of the feature, with the frame in `refs`
    const lost = previewed(engine, { type: 'removeFeature', id: 'motorSketch' }).evaluation.features.motor.error;
    expect(lost).toMatchObject({ code: 'brokenReference', refs: [MOTOR_POINT] });
  });

  it('f. a second motor from the same stored mesh: a feature and no data, upside down on the bottom face of the link', () => {
    const before = JSON.stringify(engine.getState().document.meshes).length;
    const under = { kind: 'face', body: 'upper', face: { feature: 'upper', role: 'startCap' } } as const;
    const state = run(engine, {
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: { id: 'motor2', name: 'Motor 2', suppressed: false, type: 'mesh', mesh: 'nema', placement: { frame: under, x: -60 } } },
        { type: 'setBodyProperties', body: 'motor2', patch: { use: 'reference', mass: 280 } },
      ],
    });
    const origin = state.evaluation.features.motor2.facts?.origin as number[];
    expect(JSON.stringify(state.document.meshes).length).toBe(before);
    expect(state.evaluation.meshes.nema.usedBy).toEqual(['motor', 'motor2']);
    expect(Math.abs(origin[0] - 60) + Math.abs(origin[1])).toBeLessThan(1e-9);
    expect(state.evaluation.bodies.motor2.bounds.max[2]).toBe(0); // the normal of that face points down
  });

  it('f. a stored mesh in use is not removed; unused, it is listed as such and removed', () => {
    expect(refusal(engine, { type: 'removeMesh', id: 'nema' })).toMatch(/motor, motor2/);
    const spare = read(importMesh('stl', file, {}, 'spare.stl')).mesh;
    const state = run(engine, { type: 'addMesh', id: 'spare', mesh: spare });
    expect(Object.entries(state.evaluation.meshes).filter(([, mesh]) => mesh.usedBy.length === 0).map(([id]) => id)).toEqual(['spare']);
    expect(Object.keys(run(engine, { type: 'removeMesh', id: 'spare' }).document.meshes)).toEqual(['nema']);
  });

  it('f. what the commands refuse', () => {
    const tetrahedron = storedMesh({ positions: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]), triangles: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]) });
    const refused = (command: unknown) => refusal(engine, command as Command);
    expect(refused({ type: 'addMesh', id: 'nema', mesh: tetrahedron })).toMatch(/has a stored mesh "nema" already/);
    expect(refused({ type: 'addMesh', id: 'a/b', mesh: tetrahedron })).toMatch(/addMesh\.id/);
    expect(refused({ type: 'addMesh', id: 'bad', mesh: { positions: 'AAAA', triangles: 'AAAA' } })).toMatch(/not whole triples/);
    expect(refused({ type: 'addMesh', id: 'bad', mesh: { ...tetrahedron, colour: '#ff0000' } })).toMatch(/colour: a stored mesh has no such field/);
    expect(refused({ type: 'removeMesh', id: 'none' })).toMatch(/no stored mesh "none"/);
    expect(refused({ type: 'addFeature', feature: { id: 'ghost', name: 'Ghost', suppressed: false, type: 'mesh', mesh: 'none', placement: { frame: { kind: 'base', plane: 'XY' } } } })).toMatch(/no stored mesh "none"/);
    expect(refused({ type: 'updateFeature', id: 'motor', patch: { mesh: 'none' } })).toMatch(/no stored mesh "none"/);
    expect(refused({ type: 'updateFeature', id: 'motor', patch: { placement: { rz: 7 } } })).toMatch(/placement\.rz/);
    expect(refused({ type: 'setField', feature: 'motor', path: 'placement/scale', value: 2 })).toMatch(/not a numeric field/);
  });

  it('g. save and load: the section in the saved document, a mesh edited to be open refused, a lost mesh a broken reference', () => {
    const json = engine.save();
    const document = JSON.parse(json);
    // the branch d36/3c: version 8 with its pending step; the merge makes it version 9 without names
    expect([document.schemaVersion, document.schemaSteps]).toEqual([8, ['3c-document-insert']]);
    expect(UPGRADES[5]?.name).toBe('3b-mesh-import');
    expect(typeof document.meshes.nema.positions).toBe('string');
    expect(document.meshes.nema.name).toBe('motor.stl');
    const other = newEngine();
    const loaded = other.load(json);
    expect(loaded.ok && loaded.state.evaluation.bodies.motor.solid.triangles.length).toBe(engine.getState().evaluation.bodies.motor.solid.triangles.length);
    const answer = (changed: unknown): string => {
      const result = other.load(JSON.stringify(changed));
      return result.ok ? (result.state.evaluation.features.motor?.error?.code ?? 'ok') : result.error.message;
    };
    const decoded = indexedMesh(document.meshes.nema);
    const holed = storedMesh({ positions: decoded.positions, triangles: decoded.triangles.slice(3) });
    expect(answer({ ...document, meshes: { nema: holed } })).toMatch(/document\.meshes\.nema: the mesh is not a closed solid: 3 edges with one triangle/);
    expect(answer({ ...document, meshes: { nema: { ...document.meshes.nema, faces: 'AAAA' } } })).toMatch(/faces: a stored mesh has no such field/);
    expect(answer({ ...document, meshes: {} })).toBe('brokenReference');
    // a document of master before the merge of 3b (version 6, no names) gets the empty section
    expect(answer({ ...document, meshes: undefined, schemaVersion: 6, schemaSteps: undefined, features: [], bodyProperties: {}, mechanism: { links: {}, joints: {} } })).toBe('ok');
  });

  it('h. the description: the section with its commands, the formats with their extensions and options, the limit', () => {
    expect(SECTION_INFO.meshes.commands).toEqual(['addMesh', 'removeMesh']);
    expect(IMPORT_FORMATS.stl.extensions).toEqual(['stl']);
    expect(Object.keys(IMPORT_FORMATS.stl.options)).toEqual(['unit']);
    expect(MESH_LIMITS.triangles).toBe(100_000);
  });
});

// The part of 3d (D56, docs/d36/3d-body-boolean/calls.ts): a mount around the motor with a pocket
// shaped by the motor and the screws themselves, with a print clearance; the mount joined to the
// link; the link split into two shells for printing. The arm stands as it is modelled.
describe('scenario 13, the part of 3d: a pocket with a clearance, a union and a split', () => {
  let engine: Engine;
  const TOOLS: Id[] = ['motor', 'screw', 'screws/1', 'screws/2', 'screws/3'];
  const AROUND: Id[] = ['mount', ...TOOLS];
  const MOTOR_SIDE: FaceName = { feature: 'motor', role: 'side', curve: 'motorCircle' };
  const POCKET_WALL: FaceName = { ...MOTOR_SIDE, copy: [{ pattern: 'pocket', index: 1 }] };
  const SCREW_TOP: FaceName = { feature: 'screw', role: 'endCap' };
  const POCKET_CEILING: FaceName = { ...SCREW_TOP, copy: [{ pattern: 'pocket', index: 2 }] };
  // a copy of the screw made by the pattern carries the tag of the pattern first, then that of the pocket
  const COPY_CEILING: FaceName = { ...SCREW_TOP, copy: [{ pattern: 'screws', index: 2 }, { pattern: 'pocket', index: 4 }] };
  const CUT: FaceName = { feature: 'lower', role: 'splitFace' };
  // the mount less the motor's hole right through and four blind pockets open below
  const POCKETED = Math.PI * (24 * 24 - 14.3 * 14.3) * 10 - 4 * Math.PI * 1.8 * 1.8 * 6.3;
  const onFace = (body: Id, face: FaceName): PlaneRef => ({ kind: 'face', body, face });
  const faceNumber = (state: EngineState, name: FaceName): number => state.evaluation.faceNames.findIndex((other) => faceKey(other) === faceKey(name));
  const surfaceOf = (state: EngineState, name: FaceName): Surface | undefined => state.evaluation.faceSurfaces[faceNumber(state, name)];
  const hasFace = (state: EngineState, body: Id, name: FaceName): boolean => state.evaluation.bodies[body]?.faces.some((face) => face.id === faceNumber(state, name)) ?? false;
  const done = (result: CommandResult): EngineState => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.state;
  };
  const combine = (id: Id, fields: Omit<Input<CombineFeature>, 'id' | 'name' | 'suppressed' | 'type'>, index?: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'combine', ...fields }, ...(index === undefined ? {} : { index }) });
  const split = (id: Id, name: string, fields: Omit<Input<SplitFeature>, 'id' | 'name' | 'suppressed' | 'type'>): Command => ({ type: 'addFeature', feature: { id, name, suppressed: false, type: 'split', ...fields } });
  const sketchOn = (id: Id, plane: PlaneRef): Command[] => [{ type: 'addFeature', feature: emptySketch(id, id, { kind: 'base', plane: 'XY' }) }, { type: 'setSketchPlane', sketch: id, plane }];
  const codeOf = (state: EngineState, feature: Id): string | undefined => state.evaluation.features[feature].error?.code;
  const gapOf = (options = {}): number | undefined => unwrap(engine.query('gap', { bodies: ['mount', 'motor'] }, options)).pairs[0]?.distance;

  beforeAll(() => {
    engine = newEngine();
    run(engine, arm());
    run(engine, {
      type: 'batch',
      commands: [
        { type: 'setBodyMaterial', body: 'upper', material: 'PETG' },
        { type: 'setBodyProperties', body: 'motor', patch: { use: 'reference', mass: 280 } },
        { type: 'setBodyProperties', body: 'screw', patch: { use: 'reference', mass: 0.9 } },
      ],
    });
  });

  it('a. a ring around the motor, modelled without a thought for it: five collisions', () => {
    run(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'fit', expr: '0.3' }, ...cylinder('mount', 60, 0, 24, 8, 18), { type: 'setLink', id: 'upper', bodies: ['upper', 'mount', ...TOOLS] }] });
    const report = unwrap(engine.query('interference', { bodies: AROUND }));
    expect(report.failed).toEqual([]);
    expect(report.pairs.map((pair) => `${pair.a}|${pair.b}`).sort()).toEqual(['motor|mount', 'mount|screw', 'mount|screws/1', 'mount|screws/2', 'mount|screws/3']);
  });

  it('a. the pocket: the motor and the screws subtracted moved outwards by the clearance; its faces are theirs with a tag, exact', () => {
    const state = run(engine, combine('pocket', { operation: 'difference', target: 'mount', tools: TOOLS, keepTools: true, clearance: 'fit' }));
    expect(state.evaluation.features.pocket).toMatchObject({ status: 'ok', bodies: [] });
    const [wall, ceiling] = [surfaceOf(state, POCKET_WALL), surfaceOf(state, POCKET_CEILING)];
    expect(wall).toMatchObject({ kind: 'cylinder', origin: [60, 0, expect.any(Number)] });
    expect(wall?.kind === 'cylinder' && wall.radius).toBeCloseTo(14.3, 12);
    expect(ceiling?.kind === 'plane' && ceiling.origin[2]).toBeCloseTo(14.3, 12);
    expect(hasFace(state, 'mount', POCKET_WALL) && hasFace(state, 'mount', COPY_CEILING)).toBe(true);
    expect(Math.abs(state.evaluation.bodies.mount.volume - POCKETED)).toBeLessThan(0.01 * POCKETED);
    // the tools stay as they were: bought parts with their mass
    expect(TOOLS.every((tool) => tool in state.evaluation.bodies)).toBe(true);
    expect(state.evaluation.bodyProperties.motor.mass).toBe(280);
  });

  it('a. what the pocket is for: no collision, no fit, the gap is the clearance', () => {
    const report = unwrap(engine.query('interference', { bodies: AROUND }));
    expect([report.pairs.length, report.fits.length, report.failed.length]).toEqual([0, 0, 0]);
    // two polygons of one circle: short of 0.3 by less than the chord tolerance
    expect(Math.abs((gapOf() as number) - 0.3)).toBeLessThan(0.01);
    // between two planes it is exact: the top of a screw and the ceiling of its pocket
    const measured = unwrap(engine.query('measure', { from: { kind: 'face', body: 'screw', face: SCREW_TOP }, to: { kind: 'face', body: 'mount', face: POCKET_CEILING } }));
    expect(measured.distance).toBeCloseTo(0.3, 9);
  });

  it('b. the clearance is a numeric field with an expression, optional, and 0 computes as none', () => {
    const looser = done(engine.preview({ type: 'setParameter', name: 'fit', expr: '0.5' }));
    const wall = surfaceOf(looser, POCKET_WALL);
    expect(wall?.kind === 'cylinder' && wall.radius).toBeCloseTo(14.5, 12);
    expect(looser.evaluation.features.pocket.values?.clearance).toBe(0.5);
    // without it the pocket is the tools as they are: one face name on the motor and the mount, no tag
    const without = done(engine.preview({ type: 'updateFeature', id: 'pocket', patch: { clearance: null } }));
    expect(hasFace(without, 'mount', MOTOR_SIDE) && hasFace(without, 'motor', MOTOR_SIDE)).toBe(true);
    expect(faceNumber(without, POCKET_WALL)).toBe(-1);
    expect(gapOf({ state: without })).toBe(0);
    // setField gives it back to a feature that does not have it
    const back = done(engine.preview({ type: 'batch', commands: [{ type: 'updateFeature', id: 'pocket', patch: { clearance: null } }, { type: 'setField', feature: 'pocket', path: 'clearance', value: 'fit' }] }));
    expect(hasFace(back, 'mount', POCKET_WALL)).toBe(true);
    const zero = done(engine.preview({ type: 'setField', feature: 'pocket', path: 'clearance', value: 0 }));
    expect(zero.evaluation.features.pocket.status).toBe('ok');
    expect(hasFace(zero, 'mount', MOTOR_SIDE) && faceNumber(zero, POCKET_WALL) < 0).toBe(true);
    // a sketch stands on a face of the pocket like on any planar face
    expect(engine.preview({ type: 'batch', commands: sketchOn('cable', onFace('mount', POCKET_CEILING)) }).ok).toBe(true);
  });

  it('b. a tool that cannot be moved is an error with the faces; a tool that misses is a warning; invalid commands', () => {
    // the link has holes of radius 4, which a clearance of 5 would close
    const narrow = done(engine.preview(combine('tooWide', { operation: 'difference', target: 'mount', tools: ['upper'], keepTools: true, clearance: 5 }))).evaluation.features.tooWide.error;
    expect(narrow?.code).toBe('invalidClearance');
    expect(narrow?.refs?.[0]).toBe('upper');
    expect(narrow?.refs).toContainEqual({ feature: 'shoulderHole', role: 'side', curve: 'shoulderHoleCircle' });
    const beside = done(engine.preview(combine('beside', { operation: 'difference', target: 'forearm', tools: ['motor'], keepTools: true }))).evaluation.features.beside;
    expect(beside.status).toBe('warning');
    expect(beside.warnings[0]).toMatchObject({ code: 'noEffect', refs: ['motor'] });
    const refused = [
      combine('a', { operation: 'union', target: 'mount', tools: ['motor'], keepTools: true, clearance: 0.3 }),
      combine('b', { operation: 'difference', target: 'mount', tools: ['motor'], keepTools: true, clearance: -0.1 }),
      combine('c', { operation: 'difference', target: 'mount', tools: ['mount'], keepTools: true }),
      combine('d', { operation: 'difference', target: 'mount', tools: ['motor', 'motor'], keepTools: true }),
      combine('e', { operation: 'difference', target: 'mount', tools: [], keepTools: true }),
      combine('f', { operation: 'union', target: 'mount', tools: ['pocket'], keepTools: false }),
      { type: 'addFeature', feature: { id: 'g', name: 'g', suppressed: false, type: 'pattern', source: { type: 'features', features: ['pocket'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } } as Command,
    ];
    expect(refused.map((command) => engine.preview(command).ok)).toEqual(refused.map(() => false));
  });

  it('b. an intersection before the pocket: what the mount and the motor share is a disc of the motor ten high', () => {
    const before = engine.getState().document.features.findIndex((feature) => feature.id === 'pocket');
    const probe = done(engine.preview(combine('probe', { operation: 'intersection', target: 'mount', tools: ['motor'], keepTools: true }, before), 'probe'));
    expect(Math.abs(probe.evaluation.bodies.mount.volume - Math.PI * 14 * 14 * 10)).toBeLessThan(0.01 * Math.PI * 14 * 14 * 10);
  });

  it('b. the motor bought as a mesh (3b): the pocket refuses the imported tool and changes nothing', () => {
    // the cylinder of the motor taken over by a mesh of its own triangles, as the part of 3b does
    const before = engine.getState();
    const index = before.document.features.findIndex((feature) => feature.id === 'motor');
    const { positions, triangles } = before.evaluation.bodies.motor.solid;
    const feature: MeshFeature = { id: 'motor', name: 'Motor', suppressed: false, type: 'mesh', mesh: 'nema', placement: { frame: { kind: 'base', plane: 'XY' } } };
    const bought = done(engine.preview({ type: 'batch', commands: [{ type: 'removeFeature', id: 'motor' }, { type: 'addMesh', id: 'nema', mesh: storedMesh({ positions, triangles }) }, { type: 'addFeature', feature, index }] }));
    expect(bought.evaluation.features.motor.status).toBe('ok');
    expect(bought.evaluation.features.pocket.error).toMatchObject({ code: 'importedTarget', refs: ['motor'] });
    // the pocket in error is an empty operation: the mount collides with the motor again
    expect(bought.evaluation.bodies.mount.volume).toBeGreaterThan(before.evaluation.bodies.mount.volume);
  });

  it('c. the mount joined to the link: the body leaves the model, nothing is counted twice, the motor still sits on the link', () => {
    const before = engine.getState();
    const state = run(engine, combine('join', { operation: 'union', target: 'upper', tools: ['mount'], keepTools: false }));
    expect('mount' in state.evaluation.bodies).toBe(false);
    expect('mount' in engine.getState('pocket').evaluation.bodies).toBe(true);
    expect(state.evaluation.mechanism.links.upper.missing).toEqual(['mount']);
    expect(state.evaluation.bodies.upper.volume).toBeCloseTo(before.evaluation.bodies.upper.volume + before.evaluation.bodies.mount.volume, 3);
    expect(hasFace(state, 'upper', { feature: 'mount', role: 'endCap' }) && hasFace(state, 'upper', POCKET_WALL)).toBe(true);
    expect(unwrap(engine.query('gap', { bodies: ['upper', 'motor'] })).pairs[0]?.distance).toBe(0);
    expect(unwrap(engine.query('interference', { bodies: ['upper', 'motor'] })).pairs).toEqual([]);
    // a body used up is a broken reference for what comes after
    expect(codeOf(done(engine.preview({ type: 'batch', commands: cylinder('late', 60, 20, 1, 0, 30, 'cut', 'mount') })), 'late')).toBe('brokenReference');
    // the link and the motor share nothing: their intersection is no body
    expect(codeOf(done(engine.preview(combine('none', { operation: 'intersection', target: 'motor', tools: ['upper'], keepTools: true }))), 'none')).toBe('emptyResult');
  });

  it('d. the link split at half its thickness: one cut face on both shells, a sketch on either, the new shell takes after the link', () => {
    const before = engine.getState();
    const state = run(engine, { type: 'batch', commands: [{ type: 'addFeature', feature: { id: 'mid', name: 'mid', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 4 } }, split('lower', 'Lower shell', { body: 'upper', plane: { kind: 'plane', feature: 'mid' }, side: 'backward' })] });
    expect(state.evaluation.features.lower.bodies).toEqual(['lower']);
    const [lower, upper] = [state.evaluation.bodies.lower.volume, state.evaluation.bodies.upper.volume];
    expect(lower + upper).toBeCloseTo(before.evaluation.bodies.upper.volume, 3);
    expect(lower).toBeLessThan(upper);
    const cut = surfaceOf(state, CUT);
    expect(cut?.kind === 'plane' && cut.origin[2]).toBeCloseTo(4, 12);
    expect(hasFace(state, 'upper', CUT) && hasFace(state, 'lower', CUT)).toBe(true);
    const sketches = done(engine.preview({ type: 'batch', commands: [...sketchOn('onLower', onFace('lower', CUT)), ...sketchOn('onUpper', onFace('upper', CUT))] }));
    expect(sketches.evaluation.features.onLower.plane?.normal[2]).toBeCloseTo(1, 12);
    expect(sketches.evaluation.features.onUpper.plane?.normal[2]).toBeCloseTo(-1, 12);
    const [made, link] = [state.evaluation.bodyProperties.lower, state.evaluation.bodyProperties.upper];
    expect(made).toMatchObject({ from: 'upper', material: 'PETG', name: 'Lower shell', density: link.density });
    expect(state.evaluation.mechanism.unassigned).toContain('lower');
  });

  it('d. screws through both shells; the other part by a patch; what a split cannot do', () => {
    run(engine, { type: 'setLink', id: 'upper', bodies: ['upper', 'lower', ...TOOLS] });
    const before = engine.getState();
    const through = run(engine, { type: 'batch', commands: cylinder('bolt', 60, 40, 1.6, -1, 9, 'cut', 'upper').map((command) => (command.type === 'addFeature' && command.feature.type === 'extrude' ? { ...command, feature: { ...command.feature, targets: ['upper', 'lower'] } } : command)) });
    expect(through.evaluation.features.bolt.status).toBe('ok');
    for (const body of ['upper', 'lower']) expect(through.evaluation.bodies[body].volume).toBeLessThan(before.evaluation.bodies[body].volume);
    const other = done(engine.preview({ type: 'updateFeature', id: 'lower', patch: { side: 'forward' } }));
    expect(other.evaluation.bodies.lower.volume).toBeCloseTo(through.evaluation.bodies.upper.volume, 3);
    expect(other.evaluation.bodies.upper.volume).toBeCloseTo(through.evaluation.bodies.lower.volume, 3);
    expect(codeOf(done(engine.preview({ type: 'setField', feature: 'mid', path: 'offset', value: 100 })), 'lower')).toBe('emptyResult');
    expect(codeOf(done(engine.preview({ type: 'updateFeature', id: 'lower', patch: { plane: onFace('motor', MOTOR_SIDE) } })), 'lower')).toBe('nonPlanarFace');
    expect(codeOf(done(engine.preview({ type: 'removeFeature', id: 'mid' })), 'lower')).toBe('brokenReference');
    // a plane in a face of the body itself, where the mount stands on the plate: the mount comes off again
    const ring = done(engine.preview(split('ring', 'Ring', { body: 'upper', plane: onFace('upper', { feature: 'upper', role: 'endCap' }), side: 'forward' })));
    expect(Math.abs(ring.evaluation.bodies.ring.volume - POCKETED)).toBeLessThan(0.01 * Math.PI * 24 * 24 * 10);
  });

  it('e. save and load give the same model; no upgrade step; the description for the AI', () => {
    const before = engine.getState();
    const after = done(engine.load(engine.save()));
    for (const body of ['upper', 'lower', 'motor']) expect(after.evaluation.bodies[body].volume).toBeCloseTo(before.evaluation.bodies[body].volume, 9);
    expect('mount' in after.evaluation.bodies).toBe(false);
    expect(SCHEMA_PENDING).toBe(1); // the branch d36/3c; 0 after its merge
    expect(UPGRADES.some((step) => step.name.startsWith('3d'))).toBe(false);
    expect(FEATURE_TYPE_INFO.combine.fields.map((field) => field.path)).toEqual(['clearance']);
    expect(FACE_ROLES.splitFace.title).toBe('cut face of a split');
  });
});

// The part of 3c (D62): two ball bearings and a cable clip as documents inserted as parts
// (docs/d36/3c-document-insert/calls.ts). The sizes of the bearing (8 × 22 × 7, the nominal sizes
// of a 608) and its mass (12 g) are test values, not taken from a catalog or a data sheet.
describe('scenario 13, the part of 3c: two ball bearings and a cable clip as inserted documents', () => {
  let engine: Engine; // the arm
  let bearingShop: Engine; // an engine of its own for each part, as a library of parts would hold them
  let clipShop: Engine;
  let bearing: string;
  let clip: string;
  const XY = { kind: 'base', plane: 'XY' } as const;
  const at = (point: Id) => ({ kind: 'sketchPoint', sketch: 'layout', point }) as const;
  const exec = (target: Engine, ...commands: Command[]): EngineState => {
    const result = target.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands });
    if (!result.ok) throw new Error(result.error.message);
    return result.state;
  };
  const preview = (...commands: Command[]): EngineState => previewed(engine, commands.length === 1 ? commands[0] : { type: 'batch', commands });
  const refusal = (command: Command): string => {
    const result = engine.execute(command);
    if (result.ok) throw new Error('expected an invalid command');
    return result.error.message;
  };
  const insertion = (id: Id, name: string, document: Id, placement: object, more: object = {}): Command => ({ type: 'addFeature', feature: { id, name, suppressed: false, type: 'insert', document, placement, ...more } as never });
  const list = (state?: EngineState): PartsList => unwrap(engine.query('partsList', {}, state ? { state } : {}));
  // The saved text of a document as `master` before 3b and 3c writes it: the sections `meshes` and
  // `documents` and the field `schemaSteps` left out (a step it names would be taken as done) and
  // the schema version of that `master` (6). A build of the same sources cannot save an older
  // version, so the older file is made from the newer one.
  const asSavedByMaster = (json: string): unknown => {
    const { meshes: _meshes, documents: _documents, schemaSteps: _steps, ...rest } = JSON.parse(json);
    return { ...rest, schemaVersion: 6 };
  };
  // the hole of a heat-set insert of the given thread from the catalog, as the part of 3e takes it
  const insertHole = (shop: Engine, thread: number) => {
    const rows = DATA_CATALOGS.heatSetInserts.rows;
    const size = Object.keys(rows).find((key) => rows[key].thread === thread) as string;
    const answer = unwrap(shop.query('hardwareHole', { use: 'heatSetInsert', size, allowance: 'holeComp' }));
    return { shape: answer.shape, label: answer.label, depth: answer.depth as number };
  };
  // a rectangle of its own sketch from (x0, y0) to (x1, y1): four fixed points and the lines `<prefix>1` to `<prefix>4`
  const rectangle = (sketch: Id, prefix: string, x0: number, y0: number, x1: number, y1: number): Command[] => {
    const corners: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    return [
      ...corners.flatMap(([x, y], i): Command[] => [
        { type: 'addPoint', sketch, id: `${prefix}p${i + 1}`, x, y },
        { type: 'addConstraint', sketch, id: `${prefix}f${i + 1}`, constraint: { type: 'fixed', point: `${prefix}p${i + 1}`, x, y } },
      ]),
      ...corners.map((_, i): Command => ({ type: 'addCurve', sketch, id: `${prefix}${i + 1}`, curve: { type: 'line', a: `${prefix}p${i + 1}`, b: `${prefix}p${((i + 1) % 4) + 1}` } })),
    ];
  };
  const rimOf = (insert: Id) => ({ a: { feature: `${insert}/ring`, role: 'side', curve: 'outer' }, b: { feature: `${insert}/ring`, role: 'startCap' } }) as { a: FaceName; b: FaceName };

  beforeAll(() => {
    // the arm after the parts of 3a, 5a and 3e: materials, the motor and the screws bought parts,
    // the links, and an M3 insert under each of the four screws
    engine = newEngine();
    run(engine, arm());
    run(engine, {
      type: 'batch',
      commands: [
        { type: 'setBodyMaterial', body: 'base', material: 'PETG' },
        { type: 'setBodyMaterial', body: 'upper', material: 'PETG' },
        { type: 'setBodyMaterial', body: 'forearm', material: 'PLA' },
        { type: 'setBodyProperties', body: 'motor', patch: { name: 'NEMA 17 motor', use: 'reference', mass: 280 } },
        { type: 'setBodyProperties', body: 'screw', patch: { name: 'M3x6 screw', use: 'reference', mass: 0.9 } },
      ],
    });
    run(engine, mechanismOfTheArm());
    run(engine, { type: 'setParameter', name: 'holeComp', expr: '0.2' });
    const m3 = insertHole(engine, 3);
    run(engine, {
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: emptySketch('insertSketch', 'insertSketch', XY) },
        { type: 'addPoint', sketch: 'insertSketch', id: 'i1', x: 80, y: 0 },
        { type: 'addConstraint', sketch: 'insertSketch', id: 'i1Fix', constraint: { type: 'fixed', point: 'i1', x: 80, y: 0 } },
        { type: 'addFeature', feature: { id: 'inserts', name: 'inserts', suppressed: false, type: 'hole', sketch: 'insertSketch', points: ['i1'], shape: m3.shape, extent: { type: 'distance', start: 8, distance: -m3.depth }, targets: ['upper'], label: m3.label } },
        { type: 'addFeature', feature: { id: 'insertPattern', name: 'insertPattern', suppressed: false, type: 'pattern', source: { type: 'features', features: ['inserts'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'motorSketch', point: 'motorCentre' }, count: 4, span: { type: 'full' } } } },
      ],
    });

    // the bearing as a document of its own: a ring of the outer diameter `D` and the bore `d`, `B`
    // wide, about the origin of XY on z = 0; a check of its wall; a bought part of 12 g
    bearingShop = newEngine();
    exec(
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
      { type: 'addFeature', feature: { id: 'ring', name: 'Ring', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'ringSketch', regions: [{ outerLoop: ['outer'] }] }, extent: { type: 'distance', start: 0, distance: 'B' }, operation: 'new' } },
      { type: 'setBodyProperties', body: 'ring', patch: { name: '608 bearing', use: 'reference', mass: 12 } },
    );
    bearing = bearingShop.save();

    // a cable clip printed in PETG: a block 20 × 10 × 4 with a heat-set insert from its top, and the
    // channel of the cable as an auxiliary body above it, in a sketch of its own
    clipShop = newEngine();
    exec(clipShop, { type: 'setParameter', name: 'holeComp', expr: '0.2' });
    const insert = insertHole(clipShop, 3);
    exec(
      clipShop,
      { type: 'addFeature', feature: emptySketch('blockSketch', 'Block', XY) },
      ...rectangle('blockSketch', 'e', -10, -5, 10, 5),
      { type: 'addFeature', feature: emptySketch('channelSketch', 'Channel', XY) },
      ...rectangle('channelSketch', 'c', -10, -2, 10, 2),
      { type: 'addFeature', feature: { id: 'clip', name: 'Cable clip', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'blockSketch', regions: [{ outerLoop: ['e1', 'e2', 'e3', 'e4'] }] }, extent: { type: 'distance', start: 0, distance: 4 }, operation: 'new' } },
      { type: 'addFeature', feature: { id: 'clipHole', name: 'Insert', suppressed: false, type: 'hole', sketch: 'blockSketch', points: ['origin'], shape: insert.shape, extent: { type: 'distance', start: 4, distance: -insert.depth }, targets: ['clip'], label: insert.label } },
      { type: 'addFeature', feature: { id: 'cable', name: 'Cable', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'channelSketch', regions: [{ outerLoop: ['c1', 'c2', 'c3', 'c4'] }] }, extent: { type: 'distance', start: 4, distance: 6 }, operation: 'new' } },
      { type: 'setBodyMaterial', body: 'clip', material: 'PETG' },
      { type: 'setBodyProperties', body: 'cable', patch: { use: 'auxiliary' } },
    );
    clip = clipShop.save();
  });

  it('b. the bearing stored once, upgraded on the way, and inserted twice in one batch: one body each, a bought part of 12 g by its own document', () => {
    const state = exec(
      engine,
      { type: 'addDocument', id: 'bearing', document: asSavedByMaster(bearing) as never, name: '608.json' },
      { type: 'setParameter', name: 'elbowBearingD', expr: '22' },
      insertion('b1', 'Elbow bearing', 'bearing', { frame: at('elbow'), z: 0.5 }, { parameters: { D: 'elbowBearingD' } }),
      insertion('b2', 'Shoulder bearing', 'bearing', { frame: at('shoulder'), z: 0.5 }),
    );
    const { features, bodies, bodyProperties, documents, faceNames } = state.evaluation;
    expect([features.b1.status, features.b2.status]).toEqual(['ok', 'ok']);
    expect([features.b1.bodies, features.b2.bodies]).toEqual([['b1/ring'], ['b2/ring']]);
    expect(features.b1.facts?.origin).toEqual([120, 0, 0.5]);
    expect(features.b2.facts?.axisZ).toEqual([0, 0, 1]);
    expect(bodyProperties['b1/ring']).toMatchObject({ name: 'Elbow bearing / 608 bearing', use: 'reference', mass: 12, massFrom: 'mass', fromDocument: 'bearing' });
    // float32 positions at another place: the volumes differ in the last digits
    expect(Math.abs(bodies['b1/ring'].volume - bodies['b2/ring'].volume)).toBeLessThan(1e-6 * bodies['b2/ring'].volume);
    const keys = faceNames.map((name) => faceKey(name));
    expect(keys).toContain('b1/"ring/side/outer"');
    expect(keys).toContain('b2/"ring/startCap"');
    // the stored copy is the upgraded document, with the sections of this build
    const stored = state.document.documents.bearing;
    expect(stored.name).toBe('608.json');
    expect([stored.document.documents, stored.document.meshes]).toEqual([{}, {}]);
    expect(documents.bearing.usedBy).toEqual(['b1', 'b2']);
    expect(documents.bearing.parameters.map((p) => `${p.name}=${p.value}`)).toEqual(['d=8', 'D=22', 'B=7']);
    // one undo step
    engine.undo();
    expect(engine.getState().document.documents).toEqual({});
    engine.redo();
    expect(Object.keys(engine.getState().document.documents)).toEqual(['bearing']);
  });

  it('b. the two insertions are one part: one environment of the parameters, one recompute, one row of the parts list', () => {
    const state = engine.getState();
    expect(shapeOrigin(state.evaluation.bodies['b1/ring'].solid).solid).toBe(shapeOrigin(state.evaluation.bodies['b2/ring'].solid).solid);
    const row = list().bought.find((r) => r.name === '608 bearing');
    expect(row).toMatchObject({ count: 2, bodies: ['b1/ring', 'b2/ring'], mass: 12, totalMass: 24 });
    // also after more previews of other values than the memo of the evaluator keeps
    for (let i = 0; i < 10; i++) preview({ type: 'setParameter', name: 'elbowBearingD', expr: String(20 + i / 10) });
    const again = preview({ type: 'setField', feature: 'b1', path: 'parameters/D', value: 22 });
    expect(shapeOrigin(again.evaluation.bodies['b1/ring'].solid).solid).toBe(shapeOrigin(again.evaluation.bodies['b2/ring'].solid).solid);
  });

  it('c. the seats are cut from the projected outer edges of the bearings, and nothing collides', () => {
    const seat = (insert: Id, centre: string, circle: string): Command[] => [
      { type: 'addExternal', sketch: 'seats', id: `${insert}Rim`, ref: { type: 'edge', body: `${insert}/ring`, edge: rimOf(insert), kind: 'circle' } },
      { type: 'addPoint', sketch: 'seats', id: centre, x: 0, y: 0 },
      { type: 'addConstraint', sketch: 'seats', id: `${centre}On`, constraint: { type: 'coincident', a: centre, b: `${insert}Rim/center` } },
      { type: 'addCurve', sketch: 'seats', id: circle, curve: { type: 'circle', center: centre }, radius: 10 },
      { type: 'addConstraint', sketch: 'seats', id: `${circle}Eq`, constraint: { type: 'equalRadius', a: circle, b: `${insert}Rim` } },
    ];
    const state = exec(
      engine,
      { type: 'addFeature', feature: emptySketch('seats', 'Seats', XY) },
      ...seat('b1', 'elbowSeatCentre', 'elbowSeat'),
      ...seat('b2', 'shoulderSeatCentre', 'shoulderSeat'),
      { type: 'addFeature', feature: { id: 'seatCut', name: 'Bearing seats', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'seats', regions: [{ outerLoop: ['elbowSeat'] }, { outerLoop: ['shoulderSeat'] }] }, extent: { type: 'distance', start: 0.5, distance: 8 }, operation: 'cut', targets: ['upper'] } },
    );
    expect([state.evaluation.features.seats.status, state.evaluation.features.seatCut.status]).toEqual(['ok', 'ok']);
    expect(state.evaluation.features.seats.sketch?.radii.elbowSeat).toBeCloseTo(11, 6);
    const report = unwrap(engine.query('interference', { bodies: ['upper', 'base', 'forearm', 'b1/ring', 'b2/ring'] }, { geometry: 'modelled' }));
    expect(report.pairs).toEqual([]);
    expect(report.failed).toEqual([]);
  });

  it('c. a sketch stands on the top of a ring with the frame its document would give it, carried by the placement', () => {
    const state = preview({ type: 'addFeature', feature: emptySketch('onRing', 'On the ring', { kind: 'face', body: 'b1/ring', face: { feature: 'b1/ring', role: 'endCap' } }) });
    const plane = state.evaluation.features.onRing.plane;
    expect(plane?.origin).toEqual([120, 0, 7.5]);
    expect(plane?.normal).toEqual([0, 0, 1]);
  });

  it('c. the bearings are bodies of the link of the upper arm; an edit before them leaves their solids the same objects', () => {
    const upper = engine.getState().document.mechanism.links.upper;
    const state = exec(engine, { type: 'setLink', id: 'upper', bodies: [...upper.bodies, 'b1/ring', 'b2/ring'] });
    expect(state.evaluation.mechanism.links.upper.bodies).toContain('b1/ring');
    const before = state.evaluation.bodies['b1/ring'].solid;
    const edited = preview({ type: 'setField', feature: 'forearm', path: 'extent/distance', value: 9 });
    expect(edited.evaluation.bodies['b1/ring'].solid).toBe(before);
  });

  it('d. a larger bearing at the elbow is one parameter of the arm: the ring and its seat grow together, two rows of one name', () => {
    const state = preview({ type: 'setParameter', name: 'elbowBearingD', expr: '24' });
    expect(state.evaluation.features.b1.values?.['parameters/D']).toBe(24);
    expect(state.evaluation.bodies['b1/ring'].volume).toBeGreaterThan(state.evaluation.bodies['b2/ring'].volume);
    const report = unwrap(engine.query('interference', { bodies: ['upper', 'forearm', 'b1/ring', 'b2/ring'] }, { state, geometry: 'modelled' }));
    expect(report.pairs).toEqual([]);
    const bought = list(state).bought.filter((r) => r.name === '608 bearing');
    expect(bought.map((r) => r.count)).toEqual([1, 1]);
  });

  it('d. a value the bearing does not hold up: its check fails and the insertion says so; the ring is still there', () => {
    const state = preview({ type: 'setParameter', name: 'elbowBearingD', expr: '9' });
    const result = state.evaluation.features.b1;
    expect(result.status).toBe('warning');
    expect(result.warnings.map((w) => [w.code, w.refs])).toEqual([['insertedIssues', [{ check: 'wall' }]]]);
    expect(result.bodies).toEqual(['b1/ring']);
  });

  it('e. a printed clip on top of the upper arm, without its channel: PETG by its document, and the fifth M3 insert of the list', () => {
    const before = list();
    const label = before.hardware[0].label;
    expect(label).toBe('M3x3x4.5 heat-set insert');
    const state = exec(
      engine,
      { type: 'addDocument', id: 'clip', document: JSON.parse(clip) },
      insertion('clip', 'Cable clip', 'clip', { frame: { kind: 'face', body: 'upper', face: { feature: 'upper', role: 'endCap' } }, x: 60, y: -55 }, { bodies: ['clip'] }),
    );
    expect(state.evaluation.features.clip.bodies).toEqual(['clip/clip']);
    expect(state.evaluation.bodyProperties['clip/clip']).toMatchObject({ name: 'Cable clip', material: 'PETG', use: 'part', fromDocument: 'clip' });
    const after = list();
    expect(after.printed.find((r) => r.name === 'Cable clip')?.bodies).toEqual(['clip/clip']);
    const inserts = after.hardware.find((row) => row.label === label);
    expect(inserts?.count).toBe(before.hardware[0].count + 1);
    expect(inserts?.holes).toContainEqual({ feature: 'clip/clipHole', count: 1 });
  });

  it('e. without the list both bodies come in; the channel is auxiliary by its document and no part', () => {
    const state = preview({ type: 'updateFeature', id: 'clip', patch: { bodies: null } });
    expect(state.evaluation.features.clip.bodies).toEqual(['clip/clip', 'clip/cable']);
    expect(list(state).auxiliary).toContain('clip/cable');
    expect(state.evaluation.bodyProperties['clip/cable'].name).toBe('Cable clip / Cable');
  });

  it('f. what is refused', () => {
    const messages = [
      refusal({ type: 'addDocument', id: 'bearing', document: JSON.parse(bearing) }),
      refusal({ type: 'addDocument', id: 'broken', document: { schemaVersion: 1, features: 'none' } as never }),
      refusal(insertion('b3', 'Nothing', 'nope', { frame: XY })),
      refusal(insertion('b3', 'Wrong', 'bearing', { frame: XY }, { parameters: { width: 3 } })),
      refusal({ type: 'removeDocument', id: 'bearing' }),
      refusal({ type: 'addFeature', feature: emptySketch('onNothing', 'x', { kind: 'face', body: 'b1/ring', face: { feature: 'b9/ring', role: 'endCap' } }) }),
      refusal({ type: 'addFeature', feature: emptySketch('onNothing', 'x', { kind: 'face', body: 'upper', face: { feature: 'upper/side', role: 'endCap' } }) }),
      refusal({ type: 'setBodyProperties', body: 'b1/typo', patch: { color: '#ff0000' } }),
    ];
    expect(messages[0]).toMatch(/stored document "bearing" already/);
    expect(messages[1]).toMatch(/^addDocument\.document/);
    expect(messages[2]).toMatch(/no stored document "nope"/);
    expect(messages[3]).toMatch(/has no parameter "width"/);
    expect(messages[4]).toMatch(/inserted by the features b1, b2/);
    expect(messages[5]).toMatch(/feature "b9" neexistuje/);
    expect(messages[6]).toMatch(/feature "upper" není an inserted document/);
    expect(messages[7]).toMatch(/cannot make the body "typo"/);
  });

  it('f. a revision of the bearing 8 wide replaces the stored one: the ring at the elbow runs into the forearm', () => {
    exec(bearingShop, { type: 'setParameter', name: 'B', expr: '8' });
    const state = preview({ type: 'replaceDocument', id: 'bearing', document: JSON.parse(bearingShop.save()) });
    exec(bearingShop, { type: 'setParameter', name: 'B', expr: '7' });
    expect(state.document.documents.bearing.name).toBe('608.json');
    const report = unwrap(engine.query('interference', { bodies: ['upper', 'forearm', 'base', 'b1/ring', 'b2/ring'] }, { state, geometry: 'modelled' }));
    expect(report.pairs.map((p) => `${p.a}–${p.b}`)).toEqual(['b1/ring–forearm']);
  });

  it('f. a stored document that is gone: the insertion loads as a broken reference, and nothing else is refused', () => {
    const saved = JSON.parse(engine.save());
    const { bearing: _gone, ...rest } = saved.documents;
    const spare = newEngine();
    const loaded = spare.load(JSON.stringify({ ...saved, documents: rest }));
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.state.evaluation.features.b1.status).toBe('error');
    expect(loaded.state.evaluation.features.b1.error?.refs).toEqual([{ document: 'bearing' }]);
    expect(loaded.state.evaluation.features.seats.warnings.map((w) => w.code)).toContain('brokenProjection');
  });

  it('g. save and load keep the section and the model; a load is strict about an entry and judges a stored document as a document', () => {
    const json = engine.save();
    const doc = JSON.parse(json);
    expect(doc.documents.bearing.document.schemaVersion).toBe(doc.schemaVersion);
    const spare = newEngine();
    const loaded = spare.load(json);
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(Object.keys(loaded.state.evaluation.bodies)).toContain('b2/ring');
    expect(loaded.state.evaluation.bodies['b1/ring'].volume).toBeCloseTo(engine.getState().evaluation.bodies['b1/ring'].volume, 6);
    const messageOf = (o: object): string => {
      const result = spare.load(JSON.stringify(o));
      if (result.ok) throw new Error('expected a refusal');
      return result.error.message;
    };
    expect(messageOf({ ...doc, documents: { ...doc.documents, bearing: { ...doc.documents.bearing, source: '/tmp/608.json' } } })).toMatch(/^document\.documents\.bearing\.source: a stored document has no such field/);
    expect(messageOf({ ...doc, documents: { ...doc.documents, bearing: { document: { ...doc.documents.bearing.document, schemaVersion: 99 } } } })).toMatch(/^document\.documents\.bearing\.document: the schema version 99 is newer than this build reads/);
    // the step gives an older document the empty section and leaves one that has the field to the validation
    const step = UPGRADES.find((entry) => entry.name === '3c-document-insert');
    expect(step?.run({ schemaVersion: 6 }).documents).toEqual({});
    expect(step?.run({ documents: null }).documents).toBeNull();
  });

  it('h. a kit that inserts the bearing, inserted into the arm: the body and the faces are prefixed twice', () => {
    const workshop = newEngine();
    exec(workshop, { type: 'addDocument', id: 'bearing', document: JSON.parse(bearing) }, { type: 'addFeature', feature: { id: 'b', name: 'Bearing', suppressed: false, type: 'insert', document: 'bearing', placement: { frame: XY } } as never });
    const state = preview({ type: 'addDocument', id: 'kit', document: JSON.parse(workshop.save()) }, insertion('kit', 'Kit', 'kit', { frame: XY, x: 300 }));
    expect(state.evaluation.features.kit.bodies).toEqual(['kit/b/ring']);
    expect(insertedFeature(state.document, 'kit/b/ring')?.feature.type).toBe('extrude');
    expect(state.evaluation.bodyProperties['kit/b/ring']).toMatchObject({ name: 'Kit / Bearing / 608 bearing', use: 'reference', mass: 12 });
    expect(faceKey(insertedFaceName({ feature: 'b/ring', role: 'endCap', copy: [{ pattern: 'b/p', index: 1 }] }, 'kit'))).toBe('kit/"b/\\"ring/endCap/@p:1\\""');
    expect(state.evaluation.faceNames.map((name) => faceKey(name))).toContain('kit/"b/\\"ring/side/outer\\""');
    expect(MAX_INSERT_DEPTH).toBe(8);
  });

  it('i. the description for the AI: the section, its commands, the fields of the feature type', () => {
    expect(SECTION_INFO.documents.commands).toEqual(['addDocument', 'replaceDocument', 'removeDocument']);
    expect(INSERT_FIELDS.map((field) => field.path)).toContain('parameters/*');
    expect(FEATURE_TYPE_INFO.insert.updatable).toEqual(['document', 'placement', 'parameters', 'bodies']);
  });
});

// The part of 5c (D60, docs/d36/5c-more-planes/calls.ts): a wrist at the end of the forearm whose
// axis is tilted by 30° to the elbow's, the midplane of the forearm, the axes of a line and of a round
// face. On an engine of its own: a joint about an axis askew to the axes of the model makes every
// posed sweep with collisions across it slow (the known limit of 5a).
describe('scenario 13, the part of 5c: a plane tilted about a hinge, a wrist on it, the midplane of the forearm', () => {
  let engine: Engine;
  const ok = (result: Outcome): EngineState => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.state;
  };
  const preview = (...commands: Command[]): EngineState => ok(engine.preview(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
  const unwrapped = <T>(outcome: { ok: true; result: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
    return outcome.result;
  };
  const nearV = (a: Vec3 | undefined, b: Vec3, within = 1e-6) => {
    expect(a).toBeDefined();
    a?.forEach((value, i) => expect(Math.abs(value - b[i])).toBeLessThanOrEqual(within));
  };
  const planeOf = (state: EngineState, id: Id): Frame | undefined => state.evaluation.features[id]?.plane;
  const codeOf = (state: EngineState, id: Id): string | undefined => state.evaluation.features[id]?.error?.code;
  const FOREARM_TOP: Face = { feature: 'forearm', role: 'endCap' };
  const FOREARM_UNDERSIDE: Face = { feature: 'forearm', role: 'startCap' };
  const WRIST_SIDE: Face = { feature: 'wrist', role: 'side', curve: 'wr' };
  const onFace = (body: Id, face: Face): Plane => ({ kind: 'face', body, face });
  const sketchOn = (id: Id, plane: Plane): Command[] => [{ type: 'addFeature', feature: emptySketch(id, id, { kind: 'base', plane: 'XY' }) }, ...(plane.kind === 'base' && plane.plane === 'XY' ? [] : [{ type: 'setSketchPlane', sketch: id, plane } as Command])];
  const fixedPoint = (s: Id, point: Id, x: number, y: number): Command[] => [
    { type: 'addPoint', sketch: s, id: point, x, y },
    { type: 'addConstraint', sketch: s, id: `${point}Fix`, constraint: { type: 'fixed', point, x, y } },
  ];
  const plane = (feature: Omit<Input<PlaneFeature>, 'name' | 'suppressed' | 'type'>): Command => ({ type: 'addFeature', feature: { name: feature.id, suppressed: false, type: 'plane', ...feature } });
  const HINGE: AxisRef = { kind: 'sketchLine', sketch: 'wristLayout', line: 'hinge' };

  beforeAll(() => {
    engine = newEngine();
    run(engine, arm());
  });

  it('a. a hinge on the top of the forearm and the plane through it tilted by a parameter in degrees', () => {
    const state = run(engine, {
      type: 'batch',
      commands: [
        { type: 'setParameter', name: 'wristTilt', expr: '30' },
        ...sketchOn('wristLayout', onFace('forearm', FOREARM_TOP)),
        ...fixedPoint('wristLayout', 'ha', 230, -20),
        ...fixedPoint('wristLayout', 'hb', 230, 20),
        { type: 'addCurve', sketch: 'wristLayout', id: 'hinge', curve: { type: 'line', a: 'ha', b: 'hb' } },
        plane({ id: 'wristPlane', base: onFace('forearm', FOREARM_TOP), offset: 0, tilt: { axis: HINGE, angle: 'deg(wristTilt)' } }),
      ],
    });
    // through the hinge, the normal turned by 30° about +Y; the origin of the top turned with it lies 131 mm up
    const frame = planeOf(state, 'wristPlane');
    nearV(frame?.normal, [0.5, 0, Math.sqrt(3) / 2]);
    nearV(frame?.x, [Math.sqrt(3) / 2, 0, -0.5]);
    nearV(frame?.origin, [30.814157, 0, 131], 1e-5);
    // the result tells the axis it used
    nearV(state.evaluation.features.wristPlane.facts?.axisPoint as Vec3, [230, -20, 16]);
    nearV(state.evaluation.features.wristPlane.facts?.axisDirection as Vec3, [0, 1, 0]);
    // the field holds radians and keeps the expression
    const feature = state.document.features.find((f) => f.id === 'wristPlane') as PlaneFeature;
    expect(feature.tilt?.angle).toBeCloseTo(Math.PI / 6, 12);
    expect(feature.expressions?.['tilt/angle']).toBe('deg(wristTilt)');
  });

  it('b. a wrist on the tilted plane and a joint about the normal of its sketch: its axis is 30° from the elbow, it clears the forearm, it follows the parameter', () => {
    const state = run(engine, {
      type: 'batch',
      commands: [
        ...sketchOn('wristSketch', { kind: 'plane', feature: 'wristPlane' }),
        ...fixedPoint('wristSketch', 'wc', 230, 0),
        { type: 'addCurve', sketch: 'wristSketch', id: 'wr', curve: { type: 'circle', center: 'wc' }, radius: 10 },
        { type: 'addConstraint', sketch: 'wristSketch', id: 'wrR', constraint: { type: 'radius', curve: 'wr', value: 10, driving: true } },
        { type: 'addFeature', feature: { id: 'wrist', name: 'wrist', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'wristSketch', regions: [{ outerLoop: ['wr'] }] }, extent: { type: 'distance', start: 6, distance: 20 }, operation: 'new' } },
        { type: 'setLink', id: 'forearm', bodies: ['forearm'] },
        { type: 'setLink', id: 'wrist', bodies: ['wrist'] },
        { type: 'setJoint', id: 'wrist', joint: { type: 'revolute', parent: 'forearm', child: 'wrist', axis: { kind: 'sketchPoint', sketch: 'wristSketch', point: 'wc' }, lower: 'deg(-90)', upper: 'deg(90)', value: 0 } },
      ],
    });
    const joint = state.evaluation.mechanism.joints.wrist;
    expect(joint?.status).toBe('ok');
    nearV(joint?.axis?.origin, [230, 0, 16]);
    nearV(joint?.axis?.direction, [0.5, 0, Math.sqrt(3) / 2]);
    // the lowest point of the wrist is 6 cos 30° − 10 sin 30° = 0.196152 above the top
    const pair = unwrapped(engine.query('gap', { bodies: ['forearm', 'wrist'] })).pairs[0];
    if (!pair || pair.contact !== undefined) throw new Error('the wrist touches the forearm');
    expect(Math.abs(pair.distance - 0.196152)).toBeLessThanOrEqual(pair.accuracy + 1e-6);
    // at 20° the axis is (sin 20°, 0, cos 20°)
    const angle = (20 * Math.PI) / 180;
    nearV(preview({ type: 'setParameter', name: 'wristTilt', expr: '20' }).evaluation.mechanism.joints.wrist?.axis?.direction, [Math.sin(angle), 0, Math.cos(angle)]);
  });

  it('c. the midplane of the two caps of the forearm follows its thickness; a section there; the bisector of the top and the tilted plane', () => {
    const state = run(engine, plane({ id: 'forearmMid', base: onFace('forearm', FOREARM_TOP), midplaneWith: onFace('forearm', FOREARM_UNDERSIDE), offset: 0 }));
    const frame = planeOf(state, 'forearmMid');
    nearV(frame?.origin, [0, 0, 12]);
    nearV(frame?.x, [1, 0, 0]);
    nearV(frame?.normal, [0, 0, 1]);
    // 12 thick in place of 8: the midplane moves to z = 14
    nearV(planeOf(preview({ type: 'setField', feature: 'forearm', path: 'extent/distance', value: 12 }), 'forearmMid')?.origin, [0, 0, 14]);
    // a plane feature is a plane like any other: the section of the forearm there is its disc
    const section = unwrapped(engine.query('section', { plane: { kind: 'plane', feature: 'forearmMid' }, bodies: ['forearm'] }));
    expect(section.bodies.length).toBe(1);
    expect(section.bodies[0].loops).toBe(1);
    expect(section.bodies[0].area).toBeCloseTo(15390.877, 3);
    // with the underside as the base the normal follows the underside
    nearV(planeOf(preview(plane({ id: 'midBelow', base: onFace('forearm', FOREARM_UNDERSIDE), midplaneWith: onFace('forearm', FOREARM_TOP), offset: 0 })), 'midBelow')?.normal, [0, 0, -1]);
    // the top and the tilted plane look the same way: the bisector, 15° from Z, through the hinge both share
    const half = planeOf(preview(plane({ id: 'halfTilt', base: onFace('forearm', FOREARM_TOP), midplaneWith: { kind: 'plane', feature: 'wristPlane' }, offset: 0 })), 'halfTilt');
    const s15 = (15 * Math.PI) / 180;
    nearV(half?.normal, [Math.sin(s15), 0, Math.cos(s15)]);
    for (const p of [[230, -20, 16], [230, 20, 16]] as Vec3[]) expect(Math.abs((p[0] - (half?.origin[0] ?? 0)) * (half?.normal[0] ?? 0) + (p[2] - (half?.origin[2] ?? 0)) * (half?.normal[2] ?? 0))).toBeLessThan(1e-6);
  });

  it('d. other axes: XY about the base axis X; a linear pattern of the wrist along the hinge; the mass of the wrist about the axis of its own side', () => {
    nearV(planeOf(preview(plane({ id: 'tiltX', base: { kind: 'base', plane: 'XY' }, offset: 0, tilt: { axis: { kind: 'base', axis: 'X' }, angle: 'deg(30)' } })), 'tiltX')?.normal, [0, -0.5, Math.sqrt(3) / 2]);
    // the copy 25 mm further along +Y, the volume of the wrist
    const state = preview({ type: 'addFeature', feature: { id: 'wrists', name: 'wrists', suppressed: false, type: 'pattern', source: { type: 'body', body: 'wrist' }, transform: { type: 'linear', direction: HINGE, count: 2, span: { type: 'spacing', spacing: 25 } } } });
    const [a, b] = [state.evaluation.bodies.wrist, state.evaluation.bodies['wrists/1']];
    expect(Math.abs(b.volume - a.volume)).toBeLessThanOrEqual(1e-6 * a.volume);
    expect(b.bounds.min[1] - a.bounds.min[1]).toBeCloseTo(25, 4);
    // the axis of the side passes through the centre of mass; the moment of the prism of the polygon
    // of 71 sides: m r² (2 + cos(2π/71)) / 6
    const mass = unwrapped(engine.query('mass', { bodies: ['wrist'], density: 1.24, about: { kind: 'face', body: 'wrist', face: WRIST_SIDE } }));
    const polygon = (mass.mass * 100 * (2 + Math.cos((2 * Math.PI) / 71))) / 6;
    expect(mass.about?.distance).toBeLessThan(1e-4);
    expect(Math.abs((mass.about?.moment ?? NaN) - polygon)).toBeLessThanOrEqual(1e-5 * polygon);
    // a planar face has no axis: the error of the query names the argument
    const flat = engine.query('mass', { bodies: ['wrist'], density: 1.24, about: { kind: 'face', body: 'forearm', face: FOREARM_TOP } });
    expect(flat).toMatchObject({ ok: false, error: { code: 'notAvailable', message: expect.stringContaining('the face is a plane and has no axis'), arg: ['about'] } });
  });

  it('e. refused: an axis not parallel to the plane, a round second plane, a circle as the axis, a tilt without its axis, a later second plane, setField without a tilt, a field a tilt does not have', () => {
    expect(codeOf(preview(plane({ id: 'bad', base: { kind: 'base', plane: 'XY' }, offset: 0, tilt: { axis: { kind: 'base', axis: 'Z' }, angle: 0.3 } })), 'bad')).toBe('invalidAxis');
    expect(codeOf(preview(plane({ id: 'bad', base: onFace('forearm', FOREARM_TOP), midplaneWith: onFace('wrist', WRIST_SIDE), offset: 0 })), 'bad')).toBe('nonPlanarFace');
    expect(engine.preview(plane({ id: 'bad', base: { kind: 'base', plane: 'XY' }, offset: 0, tilt: { axis: { kind: 'sketchLine', sketch: 'wristSketch', line: 'wr' }, angle: 0 } })).ok).toBe(false);
    expect(engine.preview({ type: 'updateFeature', id: 'forearmMid', patch: { tilt: { angle: 0.2 } } }).ok).toBe(false);
    expect(engine.preview({ type: 'updateFeature', id: 'wristPlane', patch: { midplaneWith: { kind: 'plane', feature: 'forearmMid' } } }).ok).toBe(false);
    expect(engine.preview({ type: 'setField', feature: 'forearmMid', path: 'tilt/angle', value: 0.2 }).ok).toBe(false);
    expect(engine.preview({ type: 'updateFeature', id: 'wristPlane', patch: { tilt: { axis: HINGE, angle: 0.5, ...({ offset: 2 } as object) } } }).ok).toBe(false);
    // a patch of the angle alone keeps the axis; null removes the tilt, which leaves the top
    nearV(planeOf(preview({ type: 'updateFeature', id: 'wristPlane', patch: { tilt: { angle: 'deg(45)' } } }), 'wristPlane')?.normal, [Math.SQRT1_2, 0, Math.SQRT1_2]);
    const removed = preview({ type: 'updateFeature', id: 'wristPlane', patch: { tilt: null } });
    nearV(planeOf(removed, 'wristPlane')?.normal, [0, 0, 1]);
    nearV(planeOf(removed, 'wristPlane')?.origin, [0, 0, 16]);
  });

  it('f. save and load: the same document; the step is the last of the list of master', () => {
    const before = engine.getState();
    const loaded = engine.load(engine.save());
    expect(loaded.ok).toBe(true);
    expect(JSON.stringify(engine.getState().document)).toBe(JSON.stringify(before.document));
    // the branch d36/3c appends its pending step after it
    expect(UPGRADES.at(-1 - SCHEMA_PENDING)?.name).toBe('5c-more-planes');
    expect(JSON.parse(engine.save()).schemaVersion).toBe(8);
  });
});

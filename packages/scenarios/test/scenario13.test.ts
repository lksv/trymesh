// Validation scenario 13 (D36, docs/d36/3a-body-properties/calls.ts and the calls of 5a): a link of
// an arm between two joints, against the real adapters. Package 3a (D48) writes its part: "bodies
// with materials and a motor as a reference part with the mass of its data sheet", and what the
// mass query, the print exports, the print query and the IDs a section names do with them. The
// part of 5a (D49): "two revolute joints; the pose stepped through the range of one joint with the
// collisions asked at each step; the mass of what hangs beyond the first joint", with what is posed,
// what stays as modelled and a joint in error (docs/d36/5a-mechanism/calls.ts). The part of 3e
// (D57): "what to print and what to buy", the query `partsList` and the file `partsCsv` over the
// arm with inserts under the screws and three feet (docs/d36/3e-parts-list/calls.ts).
//
// The model, every shape a cylinder along Z from a circle of its own sketch on XY (mm):
// - `base`: a plate below z = 0 with a pin of radius 4 at the shoulder (0, 0), up to z = 8.
// - `upper`, the link: a plate from z = 0 to 8 around (60, 0) with a hole of radius 4 at the
//   shoulder and at the elbow (120, 0).
// - `forearm`: a plate from z = 8 to 16 beyond the elbow, with a pin down into the elbow hole.
// - `layout`: the sketch of the two axes the joints of 5a turn about.
// - `motor`: a block on top of `upper`, from z = 8 to 38, around (60, 0).
// - `screw` and the pattern `screws` that copies it three times about the centre of the motor.
import { type Command, DATA_CATALOGS, type Engine, GENERATORS, type EngineState, type HoleShape, type Id, type Input, type MassProperties, PARTS_CSV, type PartRow, type PartsCsvAbout, type PartsList, QUERIES, emptySketch, type SolidKernel, SCHEMA_PENDING, UPGRADES, carriedBy, createEngine, takenOver, namedBySections, poseNote, printedBodies, bodyPropertiesWithoutBody, SECTION_INFO } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import { arm, cylinder } from './arm';
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

  it('e. save and load: version 6, the step of the section before the one of 5a, and a field this build does not know is refused', () => {
    // master after the merge of 5a: no step is pending, the step of 3a is the one before the last
    expect(SCHEMA_PENDING).toBe(0);
    expect(UPGRADES.map((step) => step.name).slice(-2)).toEqual(['3a-body-properties', '5a-mechanism']);
    const saved = JSON.parse(engine.save());
    expect(saved.schemaVersion).toBe(6);
    expect(saved.schemaSteps).toBeUndefined();
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

  it('f. save and load: version 6, a field this build does not know is refused, a removed axis loads', () => {
    expect(SCHEMA_PENDING).toBe(0);
    expect(UPGRADES.at(-1)?.name).toBe('5a-mechanism');
    const saved = JSON.parse(engine.save());
    expect([saved.schemaVersion, saved.schemaSteps]).toEqual([6, undefined]);
    const elbow = saved.mechanism.joints.elbow;
    expect(engine.load(JSON.stringify({ ...saved, mechanism: { ...saved.mechanism, joints: { ...saved.mechanism.joints, elbow: { ...elbow, effort: 2.5 } } } }))).toMatchObject({ ok: false, error: { code: 'invalidDocument', message: expect.stringContaining('effort') } });
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
      'joint: value (rad, when type is continuous)',
      'joint: lower (mm, when type is prismatic)',
      'joint: upper (mm, when type is prismatic)',
      'joint: value (mm, when type is prismatic)',
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

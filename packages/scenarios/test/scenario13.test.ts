// Validation scenario 13 (D36, docs/d36/3a-body-properties/calls.ts and the calls of 5a): a link of
// an arm between two joints, against the real adapters. Package 3a (D48) writes its part: "bodies
// with materials and a motor as a reference part with the mass of its data sheet", and what the
// mass query, the print exports, the print query and the IDs a section names do with them. The
// part of 5a (D49): "two revolute joints; the pose stepped through the range of one joint with the
// collisions asked at each step; the mass of what hangs beyond the first joint", with what is posed,
// what stays as modelled and a joint in error (docs/d36/5a-mechanism/calls.ts).
//
// The model, every shape a cylinder along Z from a circle of its own sketch on XY (mm):
// - `base`: a plate below z = 0 with a pin of radius 4 at the shoulder (0, 0), up to z = 8.
// - `upper`, the link: a plate from z = 0 to 8 around (60, 0) with a hole of radius 4 at the
//   shoulder and at the elbow (120, 0).
// - `forearm`: a plate from z = 8 to 16 beyond the elbow, with a pin down into the elbow hole.
// - `layout`: the sketch of the two axes the joints of 5a turn about.
// - `motor`: a block on top of `upper`, from z = 8 to 38, around (60, 0).
// - `screw` and the pattern `screws` that copies it three times about the centre of the motor.
import { type Command, DATA_CATALOGS, type Engine, type EngineState, type Id, type MassProperties, QUERIES, SCHEMA_PENDING, UPGRADES, carriedBy, createEngine, emptySketch, takenOver, namedBySections, poseNote, printedBodies, bodyPropertiesWithoutBody, SECTION_INFO } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import { newEngine, run } from './kit';

const sketch = (id: Id): Command => ({ type: 'addFeature', feature: emptySketch(id, id, { kind: 'base', plane: 'XY' }) });
const fixedPoint = (sketchId: Id, point: Id, x: number, y: number): Command[] => [
  { type: 'addPoint', sketch: sketchId, id: point, x, y },
  { type: 'addConstraint', sketch: sketchId, id: `${point}Fix`, constraint: { type: 'fixed', point, x, y } },
];
// A cylinder: the feature `id` from the circle of its own sketch `<id>Sketch`, whose centre is the
// point `<id>Centre`. With a target it is added to that body or cut from it.
function cylinder(id: Id, x: number, y: number, radius: number, from: number, to: number, operation: 'new' | 'add' | 'cut' = 'new', target?: Id): Command[] {
  const [sketchId, circle] = [`${id}Sketch`, `${id}Circle`];
  return [
    sketch(sketchId),
    ...fixedPoint(sketchId, `${id}Centre`, x, y),
    { type: 'addCurve', sketch: sketchId, id: circle, curve: { type: 'circle', center: `${id}Centre` }, radius },
    { type: 'addConstraint', sketch: sketchId, id: `${id}Radius`, constraint: { type: 'radius', curve: circle, value: radius, driving: true } },
    {
      type: 'addFeature',
      feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: sketchId, regions: [{ outerLoop: [circle] }] }, extent: { type: 'distance', start: from, distance: to - from }, operation, ...(target === undefined ? {} : { targets: [target] }) },
    },
  ];
}
const arm = (): Command => ({
  type: 'batch',
  commands: [
    ...cylinder('base', 0, 0, 30, -10, 0),
    ...cylinder('shoulderPin', 0, 0, 4, -10, 8, 'add', 'base'),
    ...cylinder('upper', 60, 0, 70, 0, 8),
    ...cylinder('shoulderHole', 0, 0, 4, -1, 9, 'cut', 'upper'),
    ...cylinder('elbowHole', 120, 0, 4, -1, 9, 'cut', 'upper'),
    ...cylinder('forearm', 180, 0, 70, 8, 16),
    ...cylinder('elbowPin', 120, 0, 4, 0, 16, 'add', 'forearm'),
    sketch('layout'),
    ...fixedPoint('layout', 'shoulder', 0, 0),
    ...fixedPoint('layout', 'elbow', 120, 0),
    ...cylinder('motor', 60, 0, 14, 8, 38),
    ...cylinder('screw', 80, 0, 1.5, 8, 14),
    { type: 'addFeature', feature: { id: 'screws', name: 'Screws', suppressed: false, type: 'pattern', source: { type: 'body', body: 'screw' }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'motorSketch', point: 'motorCentre' }, count: 4, span: { type: 'full' } } } },
  ],
});
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
    // As measured through the real kernel: no step of this sweep is refused for the pin (one pose in
    // thirty is, design.md, "Verified before the implementation"), so every step is pinned.
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

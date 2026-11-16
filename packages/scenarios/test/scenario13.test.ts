// Validation scenario 13 (D36, docs/d36/3a-body-properties/calls.ts and the calls of 5a): a link of
// an arm between two joints, against the real adapters. Package 3a (D48) writes its part: "bodies
// with materials and a motor as a reference part with the mass of its data sheet", and what the
// mass query, the print exports, the print query and the IDs a section names do with them. The
// part of 5a (the mechanism and the posed queries) comes with that package.
//
// The model, every shape a cylinder along Z from a circle of its own sketch on XY (mm):
// - `base`: a plate below z = 0 with a pin of radius 4 at the shoulder (0, 0), up to z = 8.
// - `upper`, the link: a plate from z = 0 to 8 around (60, 0) with a hole of radius 4 at the
//   shoulder and at the elbow (120, 0).
// - `forearm`: a plate from z = 8 to 16 beyond the elbow, with a pin down into the elbow hole.
// - `layout`: the sketch of the two axes the joints of 5a turn about.
// - `motor`: a block on top of `upper`, from z = 8 to 38, around (60, 0).
// - `screw` and the pattern `screws` that copies it three times about the centre of the motor.
import { type Command, DATA_CATALOGS, type Engine, type EngineState, type Id, type MassProperties, SCHEMA_PENDING, UPGRADES, emptySketch, takenOver, namedBySections, printedBodies, bodyPropertiesWithoutBody, SECTION_INFO } from '@trymesh/engine';
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

  it('e. save and load: the branch names its pending step, and a field this build does not know is refused', () => {
    expect(SCHEMA_PENDING).toBe(1);
    expect(UPGRADES.at(-1)?.name).toBe('3a-body-properties');
    const saved = JSON.parse(engine.save());
    expect(saved.schemaSteps).toEqual(['3a-body-properties']);
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

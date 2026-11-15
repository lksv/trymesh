// Validation scenario 9: a robot joint with a planetary gearbox (docs/requirements.md).
// It follows docs/d35-contract/scenario9.ts: a) parameters, checks and the sketch of pitch circles,
// b) c) the gears with the planets copied by a pattern, the bodies of d), e), f) and g) with their
// holes repeated by patterns (the holes of the controller by a fixed point, symmetry and equal
// radii, the nut pockets by the polygon tool), h) the motor, i) the change of the ratio, j) the
// collision query and k) the export per body with saving and loading.
// Parameter names are English: `module` for `modul` of the requirements, `backlash` for `vule`,
// `centers` (centre distance) for `osa`.
import { describe, expect, it } from 'vitest';
import { type Command, type Constraint, type Engine, type EngineState, type Extent, type Facts, type Id, type Input, type PatternFeature, type ProfileSource, type SketchFeature, type Solid, bodyFileName, freshIds, sketchTool } from '@trymesh/engine';
import { XY, addSketch, batch, expectAllOk, faceNames, newEngine, run, status, volume } from './kit';

const point = (sk: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: sk, id, x, y });
const circle = (sk: Id, id: Id, center: Id, radius: number, construction = false): Command => ({ type: 'addCurve', sketch: sk, id, curve: { type: 'circle', center, ...(construction ? { construction: true } : {}) }, radius });
const constrain = (sk: Id, id: Id, constraint: Input<Constraint>): Command => ({ type: 'addConstraint', sketch: sk, id, constraint });
const dim = (sk: Id, id: Id, shape: object, value: number | string): Command => constrain(sk, id, { ...shape, value, driving: true } as Input<Constraint>);
const param = (name: string, expr: string): Command => ({ type: 'setParameter', name, expr });
const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
// a point at coordinates relative to the sketch origin
const at = (sk: Id, p: Id, x: number | string, y: number | string): Command[] => [
  dim(sk, `${p}x`, { type: 'horizontalDistance', a: 'origin', b: p }, x),
  dim(sk, `${p}y`, { type: 'verticalDistance', a: 'origin', b: p }, y),
];
const regions = (sk: Id, ...loops: Id[][]): ProfileSource => ({ type: 'regions', sketch: sk, regions: loops.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) });
const span = (start: number | string, distance: number | string): Input<Extent> => ({ type: 'distance', start, distance });
const through = (side: 'forward' | 'backward' | 'both'): Extent => ({ type: 'throughAll', side });
// gear teeth over a pitch circle of the gear sketch
function gear(circleId: Id, teeth: string, internal: boolean, meshWith?: Id): Input<ProfileSource> {
  return { type: 'generated', generator: 'involuteGear', sketch: 'skGears', operands: { circle: circleId }, params: { teeth, pressureAngle: 'deg(20)', backlash: 'backlash', rotation: 0, internal }, ...(meshWith ? { refs: { meshWith } } : {}) };
}
function extrude(id: Id, operation: 'new' | 'add' | 'cut', profile: Input<ProfileSource>, extent: Input<Extent>, targets?: Id[]): Command {
  return { type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile, extent, operation, ...(targets ? { targets } : {}) } };
}

// a circular pattern around the Z axis of the model, over the full circle
const around = (id: Id, source: PatternFeature['source'], count: number | string): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'pattern', source, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count, span: { type: 'full' } } },
});

const CHECKS = {
  screws: 'rotor screws can be inserted',
  sun: 'planet copies mesh with the sun',
  ring: 'planet copies mesh with the ring',
  planets: 'neighbouring planets do not touch',
};

// a) Parameters, checks and the sketch of pitch circles. The pitch circles are construction geometry
// (they touch); the ordinary curves are the planet bore `ph`, the pin `pin` and the bore for the
// centring pin `sb`.
function parametersAndGearSketch(engine: Engine): EngineState {
  run(
    engine,
    param('module', '0.9'),
    param('Zs', '18'),
    param('Zp', '27'),
    param('Zr', 'Zs + 2 * Zp'),
    param('backlash', '0.05'),
    param('centers', 'module * (Zs + Zp) / 2'),
    { type: 'setCheck', name: CHECKS.screws, expr: 'module * (Zs / 2 + 1) < 12.75' },
    { type: 'setCheck', name: CHECKS.sun, expr: 'Zs % 3 == 0' },
    { type: 'setCheck', name: CHECKS.ring, expr: 'Zr % 3 == 0' },
    // centres of neighbouring planets are centers · √3 apart, the tip diameter of a planet is module · (Zp + 2)
    { type: 'setCheck', name: CHECKS.planets, expr: 'centers * sqrt(3) > module * (Zp + 2)' },
  );
  return run(
    engine,
    addSketch('skGears', XY),
    batch(
      point('skGears', 'cp', 20, 1),
      circle('skGears', 's', 'origin', 8, true),
      circle('skGears', 'p', 'cp', 12, true),
      circle('skGears', 'r', 'origin', 32, true),
      circle('skGears', 'ph', 'cp', 2.6),
      circle('skGears', 'pin', 'cp', 2.4),
      circle('skGears', 'sb', 'origin', 1.5),
      constrain('skGears', 'tsp', { type: 'tangent', a: 's', b: 'p' }),
      dim('skGears', 'cpy', { type: 'verticalDistance', a: 'origin', b: 'cp' }, 0),
      dim('skGears', 'ds', { type: 'diameter', curve: 's' }, 'module * Zs'),
      dim('skGears', 'dp', { type: 'diameter', curve: 'p' }, 'module * Zp'),
      dim('skGears', 'dr', { type: 'diameter', curve: 'r' }, 'module * Zr'),
      dim('skGears', 'dph', { type: 'diameter', curve: 'ph' }, 5.3),
      dim('skGears', 'dpin', { type: 'diameter', curve: 'pin' }, 5),
      dim('skGears', 'dsb', { type: 'diameter', curve: 'sb' }, 3.2),
    ),
  );
}

// f) The back plate below the sketch plane with four M4 holes (one hole and a pattern) and the centre
// opening, d) the sun gear: a flange, the teeth added to it, the bore for the centring pin and four
// screw holes in the flange, b) c) a planet in mesh with the sun, its bore and two copies of the
// finished planet, e) the housing with the motor recess and the ring gear cut through all into the
// solid part above it, in mesh with the planet, and six M3 screw holes through the plate and the
// housing, g) the carrier with three pins. Axial layout: zero is the seating face of the stator,
// positive towards the rotor.
// The holes of the controller on the left side of the plate, by the drawing; the right ones mirror them.
const CONTROLLER: [Id, number, number][] = [
  ['k1', -28.3, 25.75],
  ['k2', -28.3, 1.75],
  ['k3', -28.3, -25.75],
];

function bodiesAndHoles(engine: Engine): EngineState {
  // h) the motor as a simplified body: a cylinder between the back plate and the flange of the sun
  run(engine, addSketch('skMotor', XY), batch(circle('skMotor', 'mo', 'origin', 40), dim('skMotor', 'dmo', { type: 'diameter', curve: 'mo' }, 90)), extrude('motor', 'new', regions('skMotor', ['mo']), span(0, 26.5)));
  run(
    engine,
    addSketch('skPlate', XY),
    batch(circle('skPlate', 'pl', 'origin', 50), dim('skPlate', 'dpl', { type: 'diameter', curve: 'pl' }, 110)),
    extrude('plate', 'new', regions('skPlate', ['pl']), span(-5, 5)),
    addSketch('skPlateHoles', XY),
    batch(
      point('skPlateHoles', 'c4', 19, 1),
      circle('skPlateHoles', 'm4', 'c4', 2),
      ...at('skPlateHoles', 'c4', 20, 0),
      dim('skPlateHoles', 'dm4', { type: 'diameter', curve: 'm4' }, 4.5),
      circle('skPlateHoles', 'c20', 'origin', 9),
      dim('skPlateHoles', 'dc20', { type: 'diameter', curve: 'c20' }, 20),
      // the vertical axis of symmetry: a fixed point holds its end
      point('skPlateHoles', 'ax', 0.5, 39),
      { type: 'addCurve', sketch: 'skPlateHoles', id: 'axis', curve: { type: 'line', a: 'origin', b: 'ax', construction: true } },
      constrain('skPlateHoles', 'fax', { type: 'fixed', point: 'ax', x: 0, y: 40 }),
      // the left three holes of the controller: fixed points at the coordinates of the drawing
      ...CONTROLLER.flatMap(([id, x, y], i): Command[] => [
        point('skPlateHoles', id, x + 0.4, y - 0.3),
        circle('skPlateHoles', `q${i + 1}`, id, 1.5),
        constrain('skPlateHoles', `f${id}`, { type: 'fixed', point: id, x, y }),
      ]),
      // the right three: symmetric about the axis
      ...CONTROLLER.flatMap(([id, x, y], i): Command[] => [
        point('skPlateHoles', `k${i + 4}`, -x + 0.3, y + 0.2),
        circle('skPlateHoles', `q${i + 4}`, `k${i + 4}`, 1.5),
        constrain('skPlateHoles', `s${i + 4}`, { type: 'symmetric', a: id, b: `k${i + 4}`, line: 'axis' }),
      ]),
      // one diameter for all six
      ...[2, 3, 4, 5, 6].map((i) => constrain('skPlateHoles', `e${i}`, { type: 'equalRadius', a: 'q1', b: `q${i}` })),
      dim('skPlateHoles', 'dq', { type: 'diameter', curve: 'q1' }, 3.3),
    ),
    // the plate lies below the sketch plane, hence backward
    extrude('m4hole', 'cut', regions('skPlateHoles', ['m4']), through('backward'), ['plate']),
    around('m4holes', { type: 'features', features: ['m4hole'] }, 4),
    extrude('plateHoles', 'cut', regions('skPlateHoles', ['c20'], ['q1'], ['q2'], ['q3'], ['q4'], ['q5'], ['q6']), through('backward'), ['plate']),
  );
  run(
    engine,
    addSketch('skFlange', XY),
    batch(circle('skFlange', 'fl', 'origin', 19), dim('skFlange', 'dfl', { type: 'diameter', curve: 'fl' }, 40)),
    extrude('sun', 'new', regions('skFlange', ['fl']), span(26.5, 4)),
    // the teeth are added to the flange; the first gear of the chain, its rotation is a number
    extrude('sunTeeth', 'add', gear('s', 'Zs', false), span(30.5, 15.5), ['sun']),
    // the flange lies above the sketch plane of the gears, hence forward
    extrude('sunBore', 'cut', regions('skGears', ['sb']), through('forward'), ['sun']),
    addSketch('skFlangeHoles', XY),
    batch(point('skFlangeHoles', 'c3', 15, 1), circle('skFlangeHoles', 'h3', 'c3', 1.5), ...at('skFlangeHoles', 'c3', 15.5, 0), dim('skFlangeHoles', 'dh3', { type: 'diameter', curve: 'h3' }, 3.4)),
    extrude('flangeHole', 'cut', regions('skFlangeHoles', ['h3']), through('forward'), ['sun']),
    around('flangeHoles', { type: 'features', features: ['flangeHole'] }, 4),
    // the planet: rotation from the mesh with the sun; its bore is the annulus [ph] and the disc [pin] together
    extrude('planet', 'new', gear('p', 'Zp', false, 'sunTeeth'), span(34, 12)),
    extrude('planetHole', 'cut', regions('skGears', ['ph'], ['pin']), through('forward'), ['planet']),
    // the finished planet three times around the axis: the copies are the bodies planets/1 and planets/2
    around('planets', { type: 'body', body: 'planet' }, 3),
  );
  run(
    engine,
    addSketch('skHousing', XY),
    batch(
      circle('skHousing', 'ho', 'origin', 54),
      circle('skHousing', 'hb', 'origin', 45),
      dim('skHousing', 'dho', { type: 'diameter', curve: 'ho' }, 110),
      dim('skHousing', 'dhb', { type: 'diameter', curve: 'hb' }, 92),
    ),
    // a solid cylinder = the annulus [ho] and the disc [hb]; then the recess for the motor
    extrude('housing', 'new', regions('skHousing', ['ho'], ['hb']), span(0, 46)),
    extrude('motorBore', 'cut', regions('skHousing', ['hb']), span(0, 28), ['housing']),
    // the ring gear: the internal profile through all into the solid material above the motor
    extrude('ring', 'cut', gear('r', 'Zr', true, 'planet'), through('forward'), ['housing']),
    addSketch('skBolts', XY),
    batch(point('skBolts', 'cb', 50, 1), circle('skBolts', 'bh', 'cb', 1.5), ...at('skBolts', 'cb', 50.5, 0), dim('skBolts', 'dbh', { type: 'diameter', curve: 'bh' }, 3.4)),
  );
  // the pocket of an M3 nut: a hexagon 5.5 across flats around the screw, drawn by the polygon tool
  const hex = sketchTool(
    'polygon',
    { sketch: sketchOf(engine.getState(), 'skBolts'), result: engine.getState().evaluation.features.skBolts.sketch },
    { center: { at: [50.5, 0], snap: { kind: 'point', id: 'cb' } }, vertex: { at: [53.7, 0.2] }, sides: 6, sizeKind: 'acrossFlats', size: NUT },
    freshIds(engine.getState().document, 'hex_'),
  );
  if (!hex.ok) throw new Error(hex.message);
  run(
    engine,
    // points[0] is the vertex right of the centre, lines[1] goes from points[1] to points[2]: the upper side
    batch(...hex.commands, constrain('skBolts', 'hexDirection', { type: 'horizontal', line: hex.ids.lines[1] })),
    // the sketch plane lies between the plate and the housing, hence both sides and two targets
    extrude('boltHole', 'cut', regions('skBolts', ['bh']), through('both'), ['plate', 'housing']),
    // the hexagon is the region around the hole and the hole itself; the pocket is in the top 3 mm of the housing
    extrude('nutPocket', 'cut', regions('skBolts', hex.ids.lines, ['bh']), span(43, 3), ['housing']),
    around('bolts', { type: 'features', features: ['boltHole', 'nutPocket'] }, 6),
  );
  return run(
    engine,
    addSketch('skCarrier', XY),
    batch(circle('skCarrier', 'cd', 'origin', 29), dim('skCarrier', 'dcd', { type: 'diameter', curve: 'cd' }, 60)),
    extrude('carrier', 'new', regions('skCarrier', ['cd']), span(46.5, 5)),
    // the pin from the gear sketch: it lies in the centre of the planet, so on the centre distance
    extrude('carrierPin', 'add', regions('skGears', ['pin']), span(34, 12.5), ['carrier']),
    around('carrierPins', { type: 'features', features: ['carrierPin'] }, 3),
  );
}

// Size of an M3 nut across flats and the area of its hexagon.
const NUT = 5.5;
const HEXAGON = (Math.sqrt(3) / 2) * NUT ** 2;
// Area of a circle as the engine builds it: a polygon inscribed with the chord tolerance 0.01.
const disc = (diameter: number): number => {
  const sides = Math.ceil(Math.PI / Math.acos(1 - 0.02 / diameter));
  return (sides / 8) * diameter * diameter * Math.sin((2 * Math.PI) / sides);
};
const bodyVolume = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const holeFaces = (state: EngineState, body: Id, feature: Id): string[] => faceNames(state, body).filter((name) => name.startsWith(`${feature}/`));
const factsOf = (state: EngineState, feature: Id): Facts => state.evaluation.features[feature].facts as Facts;
const solidOf = (state: EngineState, body: Id): Solid => state.evaluation.bodies[body].solid;
const PLANETS = ['planet', 'planets/1', 'planets/2'];
const PARTS = ['motor', 'plate', 'sun', ...PLANETS, 'housing', 'carrier'];
// No two parts of the joint share a volume: every planet against the sun, the ring and the carrier
// with its pins, the motor against the housing around it, and everything else.
function expectClear(engine: Engine): void {
  const report = engine.interference();
  expect(report.failed).toEqual([]);
  expect(report.pairs).toEqual([]);
  expect(report.fits).toEqual([]); // a shallow overlap of round faces would hide here
  expect(report.checked).toBe((PARTS.length * (PARTS.length - 1)) / 2);
}
const copies = (name: string, pattern: Id, count: number): string[] => [name, ...Array.from({ length: count - 1 }, (_, i) => `${name}@${pattern}:${i + 1}`)];
const middleOf = (state: EngineState, body: Id): number[] => {
  const p = solidOf(state, body).positions;
  const box = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
  for (let i = 0; i < p.length; i++) box[i % 3] = [Math.min(box[i % 3][0], p[i]), Math.max(box[i % 3][1], p[i])];
  return box.map(([low, high]) => (low + high) / 2);
};

const allChecks = (state: EngineState): Record<string, string> => Object.fromEntries(Object.entries(state.evaluation.checks).map(([name, result]) => [name, result.status]));
const gears = (state: EngineState) => {
  const sketch = state.evaluation.features.skGears.sketch;
  if (!sketch) throw new Error('the gear sketch was not evaluated');
  return { sun: sketch.radii.s, planet: sketch.radii.p, ring: sketch.radii.r, center: sketch.points.cp, dof: sketch.degreesOfFreedom, valid: sketch.valid, regions: sketch.regions.map((r) => r.ref.outerLoop.join()) };
};

describe('scenario 9: robot joint', () => {
  it('a) parameters, checks and the sketch of pitch circles', () => {
    const engine = newEngine();
    const state = parametersAndGearSketch(engine);
    expect(status(state)).toEqual({ skGears: 'ok' });
    expect(state.evaluation.parameters).toMatchObject({ module: { ok: true, value: 0.9 }, Zr: { ok: true, value: 72 }, centers: { ok: true, value: 20.25 } });
    expect(allChecks(state)).toEqual({ [CHECKS.screws]: 'ok', [CHECKS.sun]: 'ok', [CHECKS.ring]: 'ok', [CHECKS.planets]: 'ok' });

    // the sketch: fully constrained, valid profile (the pitch circles are construction), planet centre on the X axis
    const g = gears(state);
    expect(g.dof).toBe(0);
    expect(g.valid).toBe(true);
    expect(g.regions.sort()).toEqual(['ph', 'pin', 'sb']);
    expect(g.sun).toBeCloseTo(8.1, 9);
    expect(g.planet).toBeCloseTo(12.15, 9);
    expect(g.ring).toBeCloseTo(32.4, 9);
    expect(g.center.x).toBeCloseTo(20.25, 6);
    expect(g.center.y).toBeCloseTo(0, 6);
    // the ring touches the planet from inside: it follows from the parameters, the sketch has no constraint for it
    expect(g.ring - (g.center.x + g.planet)).toBeCloseTo(0, 6);

    // the dimension's expression is in the document under the field address and the number is the evaluated value
    const sketch = sketchOf(state, 'skGears');
    expect(sketch.expressions).toEqual({ 'constraints/dp/value': 'module * Zp', 'constraints/dr/value': 'module * Zr', 'constraints/ds/value': 'module * Zs' });
    expect(sketch.constraints.ds).toMatchObject({ value: 16.2, driving: true });
    expect(sketch.constraints.dr).toMatchObject({ value: 64.8 });
  });

  it('d) e) f) g) h) bodies with holes through all repeated by patterns: the plate, the sun flange, the housing with screw holes through two bodies, the carrier with its pins, the motor', () => {
    const engine = newEngine();
    parametersAndGearSketch(engine);
    const state = bodiesAndHoles(engine);
    expectAllOk(state);
    expect(Object.keys(state.evaluation.bodies)).toEqual(['motor', 'plate', 'sun', 'planet', 'planets/1', 'planets/2', 'housing', 'carrier']);
    // the motor fills the space between the plate and the flange of the sun
    expect(state.evaluation.bodies.motor.volume).toBeCloseTo(disc(90) * 26.5, 1);
    expect([state.evaluation.bodies.motor.bounds.min[2], state.evaluation.bodies.motor.bounds.max[2]]).toEqual([0, 26.5]);
    expect(state.evaluation.features.planets.bodies).toEqual(['planets/1', 'planets/2']);
    // through holes have no caps in the body: only their sides, the copies with the pattern and the number
    expect(holeFaces(state, 'plate', 'plateHoles')).toEqual(['plateHoles/side/c20', 'plateHoles/side/q1', 'plateHoles/side/q2', 'plateHoles/side/q3', 'plateHoles/side/q4', 'plateHoles/side/q5', 'plateHoles/side/q6']);
    // the sketch of the plate holes is fully determined with nothing redundant: three fixed centres,
    // three mirrored ones and one diameter shared by equal radii
    expect(engine.diagnoseSketch('skPlateHoles')).toEqual({ status: 'solved', degreesOfFreedom: 0, conflicting: [], duplicates: [], redundant: [], removable: [], free: [] });
    const holes = state.evaluation.features.skPlateHoles.sketch!;
    expect(CONTROLLER.map(([id]) => [holes.points[id].x, holes.points[id].y])).toEqual(CONTROLLER.map(([, x, y]) => [expect.closeTo(x, 6), expect.closeTo(y, 6)]));
    expect(CONTROLLER.map((_, i) => [holes.points[`k${i + 4}`].x, holes.points[`k${i + 4}`].y])).toEqual(CONTROLLER.map(([, x, y]) => [expect.closeTo(-x, 6), expect.closeTo(y, 6)]));
    for (let i = 1; i <= 6; i++) expect(holes.radii[`q${i}`]).toBeCloseTo(1.65, 8);
    expect(holeFaces(state, 'plate', 'm4hole')).toEqual(copies('m4hole/side/m4', 'm4holes', 4));
    expect(holeFaces(state, 'sun', 'sunBore')).toEqual(['sunBore/side/sb']);
    expect(holeFaces(state, 'sun', 'flangeHole')).toEqual(copies('flangeHole/side/h3', 'flangeHoles', 4));
    expect(holeFaces(state, 'plate', 'boltHole')).toEqual(copies('boltHole/side/bh', 'bolts', 6));
    expect(holeFaces(state, 'housing', 'boltHole')).toEqual(copies('boltHole/side/bh', 'bolts', 6));
    expect(bodyVolume(state, 'plate')).toBeCloseTo((disc(110) - 4 * disc(4.5) - disc(20) - 6 * disc(3.4) - 6 * disc(3.3)) * 5, 1);
    // the carrier: a disc with three pins that reach down into the planets
    expect(bodyVolume(state, 'carrier')).toBeCloseTo(disc(60) * 5 + 3 * disc(5) * 12.5, 1);
    expect(holeFaces(state, 'carrier', 'carrierPin')).toEqual([...copies('carrierPin/side/pin', 'carrierPins', 3), ...copies('carrierPin/startCap', 'carrierPins', 3)].sort());
    // the nut pockets: the hexagon is fully determined (centre on the screw, 5.5 across flats, a side
    // horizontal) and every pocket has six sides and its floor in the housing, the copies by the pattern
    expect(engine.diagnoseSketch('skBolts')).toEqual({ status: 'solved', degreesOfFreedom: 0, conflicting: [], duplicates: [], redundant: [], removable: [], free: [] });
    const bolts = sketchOf(state, 'skBolts');
    const hexLines = Object.keys(bolts.curves).filter((id) => bolts.curves[id].type === 'line');
    expect(hexLines).toEqual(['hex_c2', 'hex_c3', 'hex_c4', 'hex_c5', 'hex_c6', 'hex_c7']);
    const corners = state.evaluation.features.skBolts.sketch!.points;
    for (let i = 1; i <= 6; i++) expect(Math.hypot(corners[`hex_p${i}`].x - 50.5, corners[`hex_p${i}`].y), `hex_p${i}`).toBeCloseTo(NUT / Math.sqrt(3), 6);
    expect(corners.hex_p2.y).toBeCloseTo(NUT / 2, 6);
    expect(corners.hex_p3.y).toBeCloseTo(NUT / 2, 6);
    expect(holeFaces(state, 'housing', 'nutPocket')).toEqual([...hexLines.flatMap((line) => copies(`nutPocket/side/${line}`, 'bolts', 6)), ...copies('nutPocket/startCap', 'bolts', 6)].sort());
    expect(holeFaces(state, 'plate', 'nutPocket')).toEqual([]);
    // against the housing as it is after the first screw hole: five more holes through its 46 mm
    // and six pockets of 3 mm, each the hexagon without the hole
    expect(bodyVolume(engine.getState('boltHole'), 'housing') - bodyVolume(state, 'housing')).toBeCloseTo(5 * disc(3.4) * 46 + 6 * (HEXAGON - disc(3.4)) * 3, 1);
    // a deeper pocket takes exactly the hexagon without the screw hole, six times
    const deeper = run(engine, { type: 'updateFeature', id: 'nutPocket', patch: { extent: { start: 41, distance: 5 } } });
    expectAllOk(deeper);
    expect(bodyVolume(state, 'housing') - bodyVolume(deeper, 'housing')).toBeCloseTo(6 * (HEXAGON - disc(3.4)) * 2, 2);
    engine.undo();
    // the ring gear takes between its tip and its root cylinder out of the 18 mm above the motor recess
    const solidHousing = disc(110) * 46 - disc(92) * 28 - 6 * disc(3.4) * 46 - 6 * (HEXAGON - disc(3.4)) * 3;
    expect(bodyVolume(state, 'housing')).toBeLessThan(solidHousing - Math.PI * 31.5 ** 2 * 18);
    expect(bodyVolume(state, 'housing')).toBeGreaterThan(solidHousing - Math.PI * 33.525 ** 2 * 18);

    // a thicker plate and a taller housing: the holes still go through
    const thicker = run(engine, { type: 'updateFeature', id: 'plate', patch: { extent: { start: -8, distance: 8 } } }, { type: 'updateFeature', id: 'housing', patch: { extent: { distance: 52 } } });
    expectAllOk(thicker);
    expect(bodyVolume(thicker, 'plate')).toBeCloseTo((disc(110) - 4 * disc(4.5) - disc(20) - 6 * disc(3.4) - 6 * disc(3.3)) * 8, 1);
    // the ring follows the taller housing: it still goes through, so the housing has no cap of it
    expect(holeFaces(thicker, 'housing', 'ring')).toEqual(['ring/side/teeth']);
    expect(bodyVolume(thicker, 'housing')).toBeLessThan(disc(110) * 52 - disc(92) * 28 - 6 * disc(3.4) * 52 - Math.PI * 31.5 ** 2 * 24);
    expect(holeFaces(thicker, 'housing', 'boltHole')).toEqual(copies('boltHole/side/bh', 'bolts', 6));
    engine.undo();
    engine.undo();

    // the plate alone on the wrong side: the hole misses it and the warning names it, and so does every copy
    const missed = run(engine, { type: 'updateFeature', id: 'boltHole', patch: { extent: { side: 'forward' } } });
    expect(status(missed)).toMatchObject({ boltHole: 'warning:noEffect', bolts: 'warning:noEffect' });
    expect(missed.evaluation.features.boltHole.warnings[0].refs).toEqual(['plate']);
    expect(missed.evaluation.features.bolts.warnings[0].refs).toEqual([1, 2, 3, 4, 5].map((copy) => ({ copy, feature: 'boltHole', targets: ['plate'] })));
    expect(holeFaces(missed, 'housing', 'boltHole')).toEqual(copies('boltHole/side/bh', 'bolts', 6));
    expect(holeFaces(missed, 'plate', 'boltHole')).toEqual([]);
    engine.undo();

    // the counts are fields like any other: three screws in the flange by an expression
    const fewer = run(engine, { type: 'setParameter', name: 'screws', expr: '3' }, { type: 'setField', feature: 'flangeHoles', path: 'transform/count', value: 'screws' });
    expectAllOk(fewer);
    expect(holeFaces(fewer, 'sun', 'flangeHole')).toEqual(copies('flangeHole/side/h3', 'flangeHoles', 3));
    engine.undo();
    engine.undo();

    // the document saves and loads unchanged
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.save()).toBe(engine.save());
    expect(other.getState().evaluation).toEqual(engine.getState().evaluation);
  });

  it('b) c) gears: the sun, a planet and the ring gear are in mesh and do not overlap', () => {
    const engine = newEngine();
    parametersAndGearSketch(engine);
    const state = bodiesAndHoles(engine);
    expectAllOk(state); // no gearMesh, no gearInterference
    // what the generator built, for a caller that cannot see the model
    expect(factsOf(state, 'sunTeeth')).toMatchObject({ module: expect.closeTo(0.9, 9), teeth: 18, tipDiameter: expect.closeTo(18, 9), meshed: false });
    expect(factsOf(state, 'planet')).toMatchObject({ module: expect.closeTo(0.9, 9), teeth: 27, pitchDiameter: expect.closeTo(24.3, 9), meshed: true });
    expect(factsOf(state, 'ring')).toMatchObject({ module: expect.closeTo(0.9, 9), teeth: 72, internal: true, pitchDiameter: expect.closeTo(64.8, 9), tipDiameter: expect.closeTo(63, 9), meshed: true });
    // faces: one side for all the teeth, named by the generator catalog
    expect(holeFaces(state, 'sun', 'sunTeeth')).toEqual(['sunTeeth/endCap', 'sunTeeth/side/teeth']);
    expect(faceNames(state, 'planet')).toEqual(['planet/endCap', 'planet/side/teeth', 'planet/startCap', 'planetHole/side/ph']);
    // the copies of the planet: the same faces with the pattern and the number, a third of a turn apart
    expect(faceNames(state, 'planets/2')).toEqual(['planet/endCap@planets:2', 'planet/side/teeth@planets:2', 'planet/startCap@planets:2', 'planetHole/side/ph@planets:2']);
    const [c, s] = [Math.cos((2 * Math.PI) / 3), Math.sin((2 * Math.PI) / 3)];
    for (const [body, x, y] of [['planet', 20.25, 0], ['planets/1', 20.25 * c, 20.25 * s], ['planets/2', 20.25 * c, -20.25 * s]] as const) {
      const middle = middleOf(state, body);
      expect(middle[0]).toBeCloseTo(x, 1);
      expect(middle[1]).toBeCloseTo(y, 1);
      expect(bodyVolume(state, body)).toBeCloseTo(bodyVolume(state, 'planet'), 2);
    }
    expect(holeFaces(state, 'housing', 'ring')).toEqual(['ring/side/teeth']);
    // the tooth count comes from the parameters and the backlash as well
    expect(state.document.features.find((f) => f.id === 'planet')?.expressions).toEqual({ 'profile/params/backlash': 'backlash', 'profile/params/pressureAngle': 'deg(20)', 'profile/params/teeth': 'Zp' });
    expectClear(engine);
    // the planet's bore passes the carrier pin with clearance; the planet sits above the screw heads
    expect(bodyVolume(state, 'planet')).toBeGreaterThan((Math.PI * 11.025 ** 2 - disc(5.3)) * 12);
    expect(bodyVolume(state, 'planet')).toBeLessThan((Math.PI * 13.05 ** 2 - disc(5.3)) * 12);
  });

  it('i) changing the ratio with the gears built: everything recomputes, stays in mesh and clear', () => {
    const engine = newEngine();
    parametersAndGearSketch(engine);
    bodiesAndHoles(engine);
    const timed = (...commands: Command[]): [EngineState, number] => {
      const started = performance.now();
      const state = run(engine, ...commands);
      return [state, performance.now() - started];
    };
    // ratio 5 → 4 with the same ring
    let [state, elapsed] = timed(batch(param('Zs', '24'), param('Zp', '24')));
    const times = [elapsed];
    expectAllOk(state);
    expect(Object.values(allChecks(state))).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(factsOf(state, 'ring')).toMatchObject({ teeth: 72, meshed: true });
    expectClear(engine);
    // ratio 5 → 6 with a larger ring: it still fits the housing
    [state, elapsed] = timed(batch(param('Zs', '18'), param('Zp', '36')));
    times.push(elapsed);
    expectAllOk(state);
    expect(factsOf(state, 'ring')).toMatchObject({ teeth: 90, pitchDiameter: expect.closeTo(81, 9), meshed: true });
    expectClear(engine);
    expect(holeFaces(state, 'housing', 'boltHole')).toEqual(copies('boltHole/side/bh', 'bolts', 6));
    // the planets and the pins of the carrier moved out with the centre distance
    expect(middleOf(state, 'planets/1')[1]).toBeCloseTo(24.3 * Math.sin((2 * Math.PI) / 3), 1);
    // a planet deliberately too large: its pitch circle is 1 mm larger than its tooth count gives
    [state, elapsed] = timed({ type: 'setField', feature: 'skGears', path: 'constraints/dp/value', value: 'module * Zp + 1' });
    times.push(elapsed);
    expect(status(state)).toMatchObject({ planet: 'warning:gearMesh', ring: 'warning:gearMesh' });
    // the planets run into the ring: the query names every planet with the housing
    const clash = engine.interference();
    expect(clash.failed).toEqual([]);
    expect(clash.pairs.map((pair) => `${pair.a} ${pair.b}`)).toEqual(expect.arrayContaining(PLANETS.map((planet) => `housing ${planet}`)));
    expect(clash.pairs.find((pair) => pair.b === 'planet')?.volume).toBeGreaterThan(0.1);
    expect(engine.interference({ bodies: ['sun', 'carrier', 'plate', 'motor'] }).pairs).toEqual([]);
    engine.undo();
    // a removed parameter: the gears that use it are in error and can be fixed; the sketch stays
    state = run(engine, { type: 'removeParameter', name: 'backlash' });
    expect(status(state)).toMatchObject({ skGears: 'ok', sunTeeth: 'error:invalidExpression', planet: 'error:invalidExpression', ring: 'error:invalidExpression' });
    // the planet is gone and its copies with it: the pattern has nothing to copy
    expect(status(state).planets).toBe('error:brokenReference');
    expect(state.evaluation.features.planets.bodies).toEqual([]);
    expect(state.evaluation.features.sunTeeth.fieldErrors).toMatchObject({ 'profile/params/backlash': { code: 'unknownName' } });
    engine.undo();
    expectAllOk(engine.getState());
    // The whole joint so far recomputes from the first feature on every parameter change. The spike
    // measured about 1 s for the housing alone; the bound is generous, the measured times are logged.
    console.log(`scenario 9: recompute of the joint after a parameter change ${times.map((ms) => `${Math.round(ms)} ms`).join(', ')}`);
    for (const ms of times) expect(ms).toBeLessThan(10_000);
  });

  it('i) changing the ratio: the circles are recomputed, stay tangent and the checks hold', () => {
    const engine = newEngine();
    parametersAndGearSketch(engine);

    // ratio 5 → 4 with the same ring
    let state = run(engine, batch(param('Zs', '24'), param('Zp', '24')));
    expect(state.evaluation.parameters.Zr).toEqual({ ok: true, value: 72 });
    let g = gears(state);
    expect([g.sun, g.planet, g.ring].map((r) => Math.round(r * 1e6) / 1e6)).toEqual([10.8, 10.8, 32.4]);
    expect(g.center.x).toBeCloseTo(21.6, 6);
    expect(g.dof).toBe(0);
    expect(Object.values(allChecks(state))).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(sketchOf(state, 'skGears').constraints.ds).toMatchObject({ value: 21.6 });

    // module 1 with Zs = 24: tip radius 13 mm, the screws cannot be inserted; the model keeps computing
    state = run(engine, param('module', '1'));
    expect(allChecks(state)[CHECKS.screws]).toBe('failed');
    expect(status(state)).toEqual({ skGears: 'ok' });
    engine.undo();

    // back to the initial state and ratio 5 → 6 with a larger ring
    engine.undo();
    state = run(engine, param('Zp', '36'));
    expect(state.evaluation.parameters.Zr).toEqual({ ok: true, value: 90 });
    g = gears(state);
    expect(g.ring).toBeCloseTo(40.5, 9);
    expect(g.center.x).toBeCloseTo(24.3, 6);
    expect(g.ring - (g.center.x + g.planet)).toBeCloseTo(0, 6);
    expect(Object.values(allChecks(state))).toEqual(['ok', 'ok', 'ok', 'ok']);

    // a tooth count not divisible by three: the check reports it
    state = run(engine, param('Zs', '19'));
    expect(allChecks(state)).toMatchObject({ [CHECKS.sun]: 'failed', [CHECKS.ring]: 'failed' });
  });

  it('j) k) no collisions, and every part exported on its own: copies by their derived IDs', () => {
    const engine = newEngine();
    parametersAndGearSketch(engine);
    const state = bodiesAndHoles(engine);
    // the bodies of the joint; the copies of the planet are read from the result of their pattern
    const bodies = ['motor', 'sun', 'planet', ...state.evaluation.features.planets.bodies, 'housing', 'plate', 'carrier'];
    expect([...bodies].sort()).toEqual([...PARTS].sort());
    // j) the collision query over the whole joint, timed
    const started = performance.now();
    expectClear(engine);
    const first = performance.now() - started;
    const again = performance.now();
    expectClear(engine);
    console.log(`scenario 9: interference of ${bodies.length} bodies ${Math.round(first)} ms, repeated ${Math.round(performance.now() - again)} ms`);
    // what a caller that cannot see the model reads about a body
    expect(state.evaluation.bodies.plate.bounds.min[2]).toBeCloseTo(-5, 6);
    expect(state.evaluation.bodies.plate.bounds.max[2]).toBeCloseTo(0, 6);
    expect(state.evaluation.bodies.housing.bounds.max.map((value) => Math.round(value))).toEqual([55, 55, 46]);
    expect(state.evaluation.bodies.carrier.bounds.min[2]).toBeCloseTo(34, 6);
    expect(state.evaluation.bodies.carrier.bounds.max[2]).toBeCloseTo(51.5, 5);
    expect(state.evaluation.bodies['planets/1'].volume).toBeCloseTo(state.evaluation.bodies.planet.volume, 2);
    expect(state.evaluation.bodies.plate.volume).toBeCloseTo(bodyVolume(state, 'plate'), 6);
    // k) one STL per body; together they are the whole model
    const triangles = (stl: Uint8Array): number => new DataView(stl.buffer, stl.byteOffset).getUint32(80, true);
    let total = 0;
    for (const body of bodies) {
      const stl = engine.exportMesh('stl', [body]);
      expect(triangles(stl), body).toBe(solidOf(state, body).triangles.length / 3);
      expect(stl.length).toBe(84 + 50 * triangles(stl));
      total += triangles(stl);
    }
    expect(triangles(engine.exportMesh('stl'))).toBe(total);
    expect(bodies.map(bodyFileName)).toEqual(['motor', 'sun', 'planet', 'planets%2F1', 'planets%2F2', 'housing', 'plate', 'carrier']);
    // the document with patterns saves and loads unchanged, with the same model and the same answer
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.save()).toBe(engine.save());
    expect(other.getState().evaluation).toEqual(state.evaluation);
    expectClear(other);
  });

  it('k) a document with parameters, checks and expressions saves and loads unchanged', () => {
    const engine = newEngine();
    const state = parametersAndGearSketch(engine);
    const saved = engine.save();
    const other = newEngine();
    const loaded = other.load(saved);
    expect(loaded.ok).toBe(true);
    expect(other.save()).toBe(saved);
    expect(other.getState().evaluation.parameters).toEqual(state.evaluation.parameters);
    expect(other.getState().evaluation.checks).toEqual(state.evaluation.checks);
    expect(gears(other.getState())).toEqual(gears(state));
  });
});

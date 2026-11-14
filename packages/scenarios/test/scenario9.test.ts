// Validation scenario 9: a robot joint with a planetary gearbox (docs/requirements.md).
// It grows with the points of D35; so far part a) parameters, checks and the sketch of pitch circles,
// b) c) the gears with the planets copied by a pattern, the bodies of d), e), f) and g) with their
// through holes repeated by patterns (no nut pockets and no holes of the controller yet: they need
// the polygon tool and the constraints of points 6 and 7), and the parts of i) and k) that need
// nothing else.
// Parameter names are English: `module` for `modul` of the requirements, `backlash` for `vule`,
// `centers` (centre distance) for `osa`.
import { describe, expect, it } from 'vitest';
import type { Command, Constraint, Engine, EngineState, Extent, Facts, Id, Input, PatternFeature, ProfileSource, SketchFeature, Solid } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { XY, addSketch, batch, expectAllOk, faceNames, newEngine, run, status, volume } from './kit';

const kernel = await createManifoldKernel();

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
function bodiesAndHoles(engine: Engine): EngineState {
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
    ),
    // the plate lies below the sketch plane, hence backward
    extrude('m4hole', 'cut', regions('skPlateHoles', ['m4']), through('backward'), ['plate']),
    around('m4holes', { type: 'features', features: ['m4hole'] }, 4),
    extrude('plateHoles', 'cut', regions('skPlateHoles', ['c20']), through('backward'), ['plate']),
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
    // the sketch plane lies between the plate and the housing, hence both sides and two targets
    extrude('boltHole', 'cut', regions('skBolts', ['bh']), through('both'), ['plate', 'housing']),
    around('bolts', { type: 'features', features: ['boltHole'] }, 6),
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

// Area of a circle as the engine builds it: a polygon inscribed with the chord tolerance 0.01.
const disc = (diameter: number): number => {
  const sides = Math.ceil(Math.PI / Math.acos(1 - 0.02 / diameter));
  return (sides / 8) * diameter * diameter * Math.sin((2 * Math.PI) / sides);
};
const bodyVolume = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const holeFaces = (state: EngineState, body: Id, feature: Id): string[] => faceNames(state, body).filter((name) => name.startsWith(`${feature}/`));
const factsOf = (state: EngineState, feature: Id): Facts => state.evaluation.features[feature].facts as Facts;
const solidOf = (state: EngineState, body: Id): Solid => state.evaluation.bodies[body].solid;
// volume the two bodies share; the interference query of point 5 will replace this
const overlap = (state: EngineState, a: Id, b: Id): number => volume(kernel.boolean('intersection', solidOf(state, a), solidOf(state, b)));
const PLANETS = ['planet', 'planets/1', 'planets/2'];
// every planet against the sun, the ring and the carrier with its pins, and the sun against the ring
const gearsClear = (state: EngineState): number[] => [...PLANETS.flatMap((planet) => [overlap(state, 'sun', planet), overlap(state, planet, 'housing'), overlap(state, planet, 'carrier')]), overlap(state, 'sun', 'housing'), overlap(state, 'sun', 'carrier')];
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

  it('d) e) f) g) bodies with holes through all repeated by patterns: the plate, the sun flange, the housing with screw holes through two bodies, the carrier with its pins', () => {
    const engine = newEngine();
    parametersAndGearSketch(engine);
    const state = bodiesAndHoles(engine);
    expectAllOk(state);
    expect(Object.keys(state.evaluation.bodies)).toEqual(['plate', 'sun', 'planet', 'planets/1', 'planets/2', 'housing', 'carrier']);
    expect(state.evaluation.features.planets.bodies).toEqual(['planets/1', 'planets/2']);
    // through holes have no caps in the body: only their sides, the copies with the pattern and the number
    expect(holeFaces(state, 'plate', 'plateHoles')).toEqual(['plateHoles/side/c20']);
    expect(holeFaces(state, 'plate', 'm4hole')).toEqual(copies('m4hole/side/m4', 'm4holes', 4));
    expect(holeFaces(state, 'sun', 'sunBore')).toEqual(['sunBore/side/sb']);
    expect(holeFaces(state, 'sun', 'flangeHole')).toEqual(copies('flangeHole/side/h3', 'flangeHoles', 4));
    expect(holeFaces(state, 'plate', 'boltHole')).toEqual(copies('boltHole/side/bh', 'bolts', 6));
    expect(holeFaces(state, 'housing', 'boltHole')).toEqual(copies('boltHole/side/bh', 'bolts', 6));
    expect(bodyVolume(state, 'plate')).toBeCloseTo((disc(110) - 4 * disc(4.5) - disc(20) - 6 * disc(3.4)) * 5, 1);
    // the carrier: a disc with three pins that reach down into the planets
    expect(bodyVolume(state, 'carrier')).toBeCloseTo(disc(60) * 5 + 3 * disc(5) * 12.5, 1);
    expect(holeFaces(state, 'carrier', 'carrierPin')).toEqual([...copies('carrierPin/side/pin', 'carrierPins', 3), ...copies('carrierPin/startCap', 'carrierPins', 3)].sort());
    // the ring gear takes between its tip and its root cylinder out of the 18 mm above the motor recess
    const solidHousing = disc(110) * 46 - disc(92) * 28 - 6 * disc(3.4) * 46;
    expect(bodyVolume(state, 'housing')).toBeLessThan(solidHousing - Math.PI * 31.5 ** 2 * 18);
    expect(bodyVolume(state, 'housing')).toBeGreaterThan(solidHousing - Math.PI * 33.525 ** 2 * 18);

    // a thicker plate and a taller housing: the holes still go through
    const thicker = run(engine, { type: 'updateFeature', id: 'plate', patch: { extent: { start: -8, distance: 8 } } }, { type: 'updateFeature', id: 'housing', patch: { extent: { distance: 52 } } });
    expectAllOk(thicker);
    expect(bodyVolume(thicker, 'plate')).toBeCloseTo((disc(110) - 4 * disc(4.5) - disc(20) - 6 * disc(3.4)) * 8, 1);
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
    for (const shared of gearsClear(state)) expect(shared).toBeLessThan(1e-3);
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
    for (const shared of gearsClear(state)) expect(shared).toBeLessThan(1e-3);
    // ratio 5 → 6 with a larger ring: it still fits the housing
    [state, elapsed] = timed(batch(param('Zs', '18'), param('Zp', '36')));
    times.push(elapsed);
    expectAllOk(state);
    expect(factsOf(state, 'ring')).toMatchObject({ teeth: 90, pitchDiameter: expect.closeTo(81, 9), meshed: true });
    for (const shared of gearsClear(state)) expect(shared).toBeLessThan(1e-3);
    expect(holeFaces(state, 'housing', 'boltHole')).toEqual(copies('boltHole/side/bh', 'bolts', 6));
    // the planets and the pins of the carrier moved out with the centre distance
    expect(middleOf(state, 'planets/1')[1]).toBeCloseTo(24.3 * Math.sin((2 * Math.PI) / 3), 1);
    // a planet deliberately too large: its pitch circle is 1 mm larger than its tooth count gives
    [state, elapsed] = timed({ type: 'setField', feature: 'skGears', path: 'constraints/dp/value', value: 'module * Zp + 1' });
    times.push(elapsed);
    expect(status(state)).toMatchObject({ planet: 'warning:gearMesh', ring: 'warning:gearMesh' });
    expect(overlap(state, 'planet', 'housing')).toBeGreaterThan(0.1);
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

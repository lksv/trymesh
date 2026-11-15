// The robot joint of validation scenario 9 (docs/requirements.md), built step by step. Scenario 9
// tests the building itself; scenario 11 asks the queries of step 1 of D36 about the result.
import { type Command, type Constraint, type Engine, type EngineState, type Extent, type Id, type Input, type PatternFeature, type ProfileSource, type SketchFeature, freshIds, sketchTool } from '@trymesh/engine';
import { XY, addSketch, batch, run } from './kit';

export const NUT = 5.5; // across the flats of the nut pockets
export const point = (sk: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: sk, id, x, y });
export const circle = (sk: Id, id: Id, center: Id, radius: number, construction = false): Command => ({ type: 'addCurve', sketch: sk, id, curve: { type: 'circle', center, ...(construction ? { construction: true } : {}) }, radius });
export const constrain = (sk: Id, id: Id, constraint: Input<Constraint>): Command => ({ type: 'addConstraint', sketch: sk, id, constraint });
export const dim = (sk: Id, id: Id, shape: object, value: number | string): Command => constrain(sk, id, { ...shape, value, driving: true } as Input<Constraint>);
export const param = (name: string, expr: string): Command => ({ type: 'setParameter', name, expr });
export const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
// a point at coordinates relative to the sketch origin
export const at = (sk: Id, p: Id, x: number | string, y: number | string): Command[] => [
  dim(sk, `${p}x`, { type: 'horizontalDistance', a: 'origin', b: p }, x),
  dim(sk, `${p}y`, { type: 'verticalDistance', a: 'origin', b: p }, y),
];
export const regions = (sk: Id, ...loops: Id[][]): ProfileSource => ({ type: 'regions', sketch: sk, regions: loops.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) });
export const span = (start: number | string, distance: number | string): Input<Extent> => ({ type: 'distance', start, distance });
export const through = (side: 'forward' | 'backward' | 'both'): Extent => ({ type: 'throughAll', side });
// gear teeth over a pitch circle of the gear sketch
export function gear(circleId: Id, teeth: string, internal: boolean, meshWith?: Id): Input<ProfileSource> {
  return { type: 'generated', generator: 'involuteGear', sketch: 'skGears', operands: { circle: circleId }, params: { teeth, pressureAngle: 'deg(20)', backlash: 'backlash', rotation: 0, internal }, ...(meshWith ? { refs: { meshWith } } : {}) };
}
export function extrude(id: Id, operation: 'new' | 'add' | 'cut', profile: Input<ProfileSource>, extent: Input<Extent>, targets?: Id[]): Command {
  return { type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile, extent, operation, ...(targets ? { targets } : {}) } };
}

// a circular pattern around the Z axis of the model, over the full circle
export const around = (id: Id, source: PatternFeature['source'], count: number | string): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'pattern', source, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count, span: { type: 'full' } } },
});

export const CHECKS = {
  screws: 'rotor screws can be inserted',
  sun: 'planet copies mesh with the sun',
  ring: 'planet copies mesh with the ring',
  planets: 'neighbouring planets do not touch',
};

// a) Parameters, checks and the sketch of pitch circles. The pitch circles are construction geometry
// (they touch); the ordinary curves are the planet bore `ph`, the pin `pin` and the bore for the
// centring pin `sb`.
export function parametersAndGearSketch(engine: Engine): EngineState {
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
export const CONTROLLER: [Id, number, number][] = [
  ['k1', -28.3, 25.75],
  ['k2', -28.3, 1.75],
  ['k3', -28.3, -25.75],
];

export function bodiesAndHoles(engine: Engine): EngineState {
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

// Package 5d written out as calls: its part of validation scenario 9 (the planetary joint: the
// profile shift) and of scenario 13 (the arm: a cycloidal stage at the shoulder and a GT2 belt
// stage from the motor to the elbow). Only type-checked (`npx tsc -p docs/d36/tsconfig.json`);
// after the implementation the first part becomes an item of
// packages/scenarios/test/scenario9.test.ts and the second of scenario13.test.ts. Lines marked
// `@ts-expect-error` are calls that must not compile.
//
// The numbers in the comments come from the spikes of design.md, "Measured": the joint with
// Zs = 12 through the real engine of master, the shift, the disc and the groove by the formulas of
// the design written out and checked independently.

import type { Command, CommandResult, Engine, EngineState, Id, Vec3 } from '../../../packages/engine/src/index';
import { emptySketch } from '../../../packages/engine/src/index';
import { arm, cylinder } from '../../../packages/scenarios/test/arm';
import type { GeneratorNameAfter } from './contract';
import { CYCLOIDAL_DISC_EXAMPLE, CYCLOIDAL_DISC_FACTS, GT2_PULLEY_EXAMPLE } from './contract';

declare const engine: Engine;
// The joint of scenario 9 as packages/scenarios/test/joint.ts builds it. Not imported: that module
// imports the real adapters (through kit.ts), which the type check of the drafts does not compile.
declare function parametersAndGearSketch(engine: Engine): EngineState;
declare function bodiesAndHoles(engine: Engine): EngineState;
const param = (name: string, expr: string): Command => ({ type: 'setParameter', name, expr });
declare function fail(message: string): never;
const done = (result: CommandResult): EngineState => (result.ok ? result.state : fail(`${result.error.code}: ${result.error.message}`));
const run = (...commands: Command[]): EngineState => done(engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const preview = (...commands: Command[]): EngineState => done(engine.preview(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const near = (a: unknown, b: number, within = 1e-6): boolean => typeof a === 'number' && Math.abs(a - b) <= within;
const nearV = (a: unknown, b: Vec3, within = 1e-6): boolean => Array.isArray(a) && a.length === 3 && a.every((v, i) => near(v, b[i], within));
const warningsOf = (state: EngineState, id: Id): string[] => state.evaluation.features[id]?.warnings.map((w) => w.code) ?? [];
const facts = (state: EngineState, id: Id) => state.evaluation.features[id]?.facts ?? {};
// `GeneratorName` of types.ts gets the two entries in the code. A draft cannot widen it inside the
// types of a profile, so a command with a new generator goes through this one cast (design.md,
// "Needs from the preparatory step").
const withGenerator = (command: { type: 'addFeature'; feature: unknown } | { type: 'updateFeature'; id: Id; patch: unknown }): Command => command as Command;

// ================================================================ scenario 9: the profile shift

// The joint as scenario 9 builds it (packages/scenarios/test/joint.ts), then the ratio 7: a sun of
// 12 teeth, planets of 30, the ring stays 72. Every planet reports that its tip runs into the root
// of the sun (tip radius 14.4 above the limit 14.237852); the sun and the ring are clean.
export function ratioSeven(): boolean {
  parametersAndGearSketch(engine);
  bodiesAndHoles(engine);
  const state = run(param('Zs', '12'), param('Zp', '30'));
  return warningsOf(state, 'planet').includes('gearInterference') && warningsOf(state, 'sunTeeth').length === 0 && warningsOf(state, 'ring').length === 0;
}

// A shift of +0.3 on the sun, −0.3 on the planets and on the ring (a ring and the gear in it have
// equal shifts): one parameter, three patches of one parameter of the generator, in one batch.
const shiftAll = (sun: string, planet: string, ring: string): Command[] => [
  { type: 'updateFeature', id: 'sunTeeth', patch: { profile: { params: { shift: sun } } } },
  { type: 'updateFeature', id: 'planet', patch: { profile: { params: { shift: planet } } } },
  { type: 'updateFeature', id: 'ring', patch: { profile: { params: { shift: ring } } } },
];
export function shifted(): boolean {
  const state = run(param('shift', '0.3'), ...shiftAll('shift', '-shift', '-shift'));
  const [sun, planet, ring] = [facts(state, 'sunTeeth'), facts(state, 'planet'), facts(state, 'ring')];
  const clean = ['sunTeeth', 'planet', 'ring'].every((id) => state.evaluation.features[id].status === 'ok');
  // m = 0.9: the sun's tip d + 2m(1 + x) = 10.8 + 2.34, its root d − 2m(1.25 − x) = 10.8 − 1.71;
  // the planet's 27 + 1.26 and 27 − 2.79; the ring's tip (inner) 64.8 − 2.34, its root 64.8 + 1.71
  const circles =
    near(sun.tipDiameter, 13.14) && near(sun.rootDiameter, 9.09) && near(sun.shift, 0.3) &&
    near(planet.tipDiameter, 28.26) && near(planet.rootDiameter, 24.21) && near(planet.shift, -0.3) &&
    near(ring.tipDiameter, 62.46) && near(ring.rootDiameter, 66.51) && near(ring.shift, -0.3);
  // the rotations are still computed from the mesh, and the pitch circles still touch
  const meshed = planet.meshed === true && ring.meshed === true;
  const checks = Object.values(state.evaluation.checks).every((check) => check.status === 'ok');
  return clean && circles && meshed && checks;
}
// The collision check of part j finds nothing between the gears.
export const noCollision = (): boolean => engine.interference().pairs.length === 0;
// The ring left without its shift: the planet and the ring no longer keep the reference centre
// distance; the ring warns and says by how much.
export function unbalanced(): boolean {
  const state = preview({ type: 'updateFeature', id: 'ring', patch: { profile: { params: { shift: null } } } });
  const warning = state.evaluation.features['ring'].warnings.find((w) => w.code === 'gearMesh');
  return warning !== undefined && warning.message.includes('shift') && facts(state, 'ring').meshed === false;
}
// The document saves and loads unchanged; a gear left without the parameter (an older document)
// loads with `shift: 0`.
export function saveAndLoad9(): boolean {
  const before = engine.save();
  const loaded = engine.load(before);
  return loaded.ok && engine.save() === before;
}

export function scenario9l(): boolean {
  return ratioSeven() && shifted() && noCollision() && unbalanced() && saveAndLoad9();
}

// ================================================================ scenario 13: the cycloidal stage

// Below the base of the arm (z −20 to −14): the circle of the pins about the shoulder, a pin of
// radius 2.5 on it at (25, 0) and its circular pattern (12 pins), and the disc over the circle.
const DISC_PARAMS = { pins: 'nPins', pinRadius: 'pinR', eccentricity: 'ecc', clearance: 0, rotation: 0, pinAngle: 0 };
function discFeature(id: Id, params: Record<string, number | string>): Command {
  return withGenerator({
    type: 'addFeature',
    feature: {
      id, name: id, suppressed: false, type: 'extrude',
      profile: { type: 'generated', generator: 'cycloidalDisc' satisfies GeneratorNameAfter, sketch: 'cyclo', operands: { circle: 'pinCircle' }, params },
      extent: { type: 'distance', start: -20, distance: 6 }, operation: 'new',
    },
  });
}
export function cycloidalStage(): EngineState {
  return run(
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
  );
}
// What the disc publishes: 11 lobes, the ratio 11, the tips at 47 and the bottoms at 43, its centre
// 1 mm along x from the axis of the ring (the eccentric bore goes there), turned by nothing.
export function discFacts(state: EngineState): boolean {
  const f = facts(state, 'disc');
  const named = Object.keys(CYCLOIDAL_DISC_FACTS).every((name) => name in f);
  return named && f.lobes === 11 && f.ratio === 11 && near(f.outerDiameter, 47) && near(f.innerDiameter, 43) && nearV(f.center, [1, 0, 0]) && nearV(f.ringCenter, [0, 0, 0]) && near(f.discRotation, 0);
}
// The disc and the pins share no volume and do not touch: no pair of the disc in any list of the
// collision check (not a collision, not a fit, not failed, not cleared), and its smallest gap to
// the pins is above zero and a few thousandths (the polygons of both lie inside their exact shapes;
// the spike measured 0.0022 to 0.0032 in 2D).
const PINS: Id[] = ['pin', ...Array.from({ length: 11 }, (_, k) => `ringPins/${k + 1}`)];
const ofDisc = (disc: Id) => (pair: { a: Id; b: Id }): boolean => pair.a === disc || pair.b === disc;
function nearestGap(disc: Id, state?: EngineState): number | undefined {
  const gap = engine.query('gap', { bodies: [disc, ...PINS], within: 1 }, state ? { state } : {});
  if (!gap.ok || gap.result.failed.some(ofDisc(disc))) return undefined;
  const nearest = gap.result.pairs.find(ofDisc(disc));
  return nearest !== undefined && nearest.contact === undefined ? nearest.distance : undefined;
}
export function clearOfThePins(disc: Id = 'disc', state?: EngineState): boolean {
  const report = engine.query('interference', { bodies: [disc, ...PINS] }, state ? { state } : {});
  if (!report.ok) return false;
  const { pairs, fits, failed, cleared } = report.result;
  if ([...pairs, ...fits, ...failed, ...(cleared ?? [])].some(ofDisc(disc))) return false;
  const distance = nearestGap(disc, state);
  return distance !== undefined && distance > 0 && distance < 0.03;
}
// A quarter turn of the input: the disc moves round the eccentric and turns back by 1/11 of that,
// and still meets no pin. The second disc of a two-disc drive is the same with the input at π.
export function turned(): boolean {
  const state = preview({ type: 'updateFeature', id: 'disc', patch: { profile: { params: { rotation: 'deg(90)' } } } });
  const f = facts(state, 'disc');
  return nearV(f.center, [0, 1, 0]) && near(f.discRotation, -Math.PI / 2 / 11) && clearOfThePins('disc', state);
}
export function secondDisc(): boolean {
  const state = preview(discFeature('disc2', { ...DISC_PARAMS, rotation: 'pi' }));
  return nearV(facts(state, 'disc2').center, [-1, 0, 0]) && clearOfThePins('disc2', state);
}
// Pins drawn half a pitch round: the pin at 15° (and its pattern with it). The disc with
// `pinAngle` 15° meets them; without it, it would cut into them.
export function pinsElsewhere(): boolean {
  const pinsMoved: Command[] = [
    { type: 'setField', feature: 'cyclo', path: 'constraints/pcFix/x', value: '25 * cos(deg(15))' },
    { type: 'setField', feature: 'cyclo', path: 'constraints/pcFix/y', value: '25 * sin(deg(15))' },
  ];
  const withAngle = preview(...pinsMoved, { type: 'updateFeature', id: 'disc', patch: { profile: { params: { pinAngle: 'deg(15)' } } } });
  const without = preview(...pinsMoved);
  const collides = unwrapPairs(without).some(ofDisc('disc'));
  // the disc turned by 15° · 12/11 = π/11 at the input angle 0
  return near(facts(withAngle, 'disc').discRotation, Math.PI / 11) && clearOfThePins('disc', withAngle) && collides;
}
const unwrapPairs = (state: EngineState) => {
  const report = engine.query('interference', { bodies: ['disc', ...PINS] }, { state });
  return report.ok ? report.result.pairs : [];
};
// A print clearance of 0.1: the gap to the pins is at least that.
export function withClearance(): boolean {
  const state = preview({ type: 'updateFeature', id: 'disc', patch: { profile: { params: { clearance: 0.1 } } } });
  const distance = nearestGap('disc', state);
  return distance !== undefined && distance >= 0.1 && distance < 0.13;
}
// What cannot be built is an error of the feature with the reason: E · N = 36 ≥ R = 25; pins of
// radius 7 overlap (they touch at R sin(π/12) = 6.4705).
export function refusedDiscs(): boolean {
  const ecc = preview(param('ecc', '3')).evaluation.features['disc'];
  const pins = preview(param('pinR', '7')).evaluation.features['disc'];
  return ecc.error?.code === 'invalidProfile' && pins.error?.code === 'invalidProfile';
}

// ================================================================ scenario 13: the GT2 belt stage

// A pulley of 20 grooves on top of the motor (at (60, 0), z 38 to 44) and one of 40 above the elbow
// (at (120, 0), z 16.5 to 22.5, clear of the forearm and the pin of the elbow, which end at 16),
// each at a point of its own sketch.
function pulley(id: Id, x: number, z: number, teeth: number): Command[] {
  const sketch = `${id}Sketch`;
  return [
    { type: 'addFeature', feature: emptySketch(sketch, sketch, { kind: 'base', plane: 'XY' }) },
    { type: 'addPoint', sketch, id: `${id}Axis`, x, y: 0 },
    { type: 'addConstraint', sketch, id: `${id}AxisFix`, constraint: { type: 'fixed', point: `${id}Axis`, x, y: 0 } },
    withGenerator({
      type: 'addFeature',
      feature: {
        id, name: id, suppressed: false, type: 'extrude',
        profile: { type: 'generated', generator: 'gt2Pulley' satisfies GeneratorNameAfter, sketch, operands: { center: `${id}Axis` }, params: { teeth, allowance: 0, rotation: 0 } },
        extent: { type: 'distance', start: z, distance: 6 }, operation: 'new',
      },
    }),
  ];
}
export function beltStage(): EngineState {
  return run(...pulley('motorPulley', 60, 38, 20), ...pulley('elbowPulley', 120, 16.5, 40));
}
// Gates' table: 12.73 / 12.22 and 25.46 / 24.96; the formula gives 12.224 and 24.957. One side face
// each, `grooves`. The volume is the area of the outline times 6 (exact outline 103.020 and 460.278
// mm²; the polygon is smaller by its chords).
export function pulleys(state: EngineState): boolean {
  const [small, large] = [facts(state, 'motorPulley'), facts(state, 'elbowPulley')];
  const diameters = near(small.pitchDiameter, 40 / Math.PI) && near(small.outsideDiameter, 40 / Math.PI - 0.508) && near(large.outsideDiameter, 80 / Math.PI - 0.508) && near(small.outsideDiameter, 12.22, 0.005) && near(large.outsideDiameter, 24.96, 0.005);
  const volumes = near(state.evaluation.bodies['motorPulley']?.volume, 6 * 103.02, 6 * 0.2) && near(state.evaluation.bodies['elbowPulley']?.volume, 6 * 460.278, 6 * 0.4);
  const faces = state.evaluation.faceNames.some((name) => name.feature === 'motorPulley' && name.role === 'side' && 'curve' in name && name.curve === 'grooves');
  return diameters && volumes && faces;
}
// Fewer than 12 grooves is an invalid command: the parameter is outside its range.
export const tooFewGrooves = (): boolean => !engine.preview(withGenerator({ type: 'updateFeature', id: 'motorPulley', patch: { profile: { params: { teeth: 10 } } } })).ok;

export const wrong = (): void => {
  // @ts-expect-error the generator is a name of the catalog
  const name: GeneratorNameAfter = 'gt3Pulley';
  void name;
};

// The examples of the entries are what a new draft starts with and what the description shows.
export const examples = (): boolean => CYCLOIDAL_DISC_EXAMPLE.pins === 12 && GT2_PULLEY_EXAMPLE.teeth === 20;

export function scenario13d(): boolean {
  run(arm());
  const stage = cycloidalStage();
  const ok = discFacts(stage) && clearOfThePins() && turned() && secondDisc() && pinsElsewhere() && withClearance() && refusedDiscs();
  const belts = beltStage();
  return ok && pulleys(belts) && tooFewGrooves() && examples() && cylinder !== undefined;
}

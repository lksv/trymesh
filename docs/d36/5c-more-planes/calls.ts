// Package 5c written out as calls: its part of validation scenario 13 (an arm with joints), a wrist
// whose axis is tilted to the elbow's and the midplane of the forearm. Only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`); after the implementation it becomes a part of
// packages/scenarios/test/scenario13.test.ts. Lines marked `@ts-expect-error` are calls that must
// not compile.
//
// The part comes after the sweeps of 5a in the scenario (the joint about the tilted axis makes every
// posed collision check pay seconds per pair across it), or removes the joint before them.
//
// The arm is `arm()` of packages/scenarios/test/arm.ts: the forearm is a disc of radius 70 about
// (180, 0) from z = 8 to 16, every sketch of the arm on the base plane XY. The numbers in the
// comments were measured on 2026-11-17 (design.md, "Measured"): the frames of the two caps of the
// forearm and the section through the real engine, the frames of the tilt and of the midplane by
// the functions of the contract written out in the spike.

import type { AxisRef, Frame, Id, Vec3 } from '../../../packages/engine/src/index';
import { emptySketch } from '../../../packages/engine/src/index';
import { arm } from '../../../packages/scenarios/test/arm';
import type { CommandAfter, EngineAfter, FaceNameAfter, PlaneRefAfter, QueryOutcome, StateAfter } from '../00-prep/contract';
import { SCHEMA_PENDING, UPGRADES } from '../00-prep/contract';
import type { AxisRefAfter, PlaneFeatureC, SketchLineAxis } from './contract';
import { MORE_PLANES_STEP, TILT_ANGLE } from './contract';

declare const engine: EngineAfter;
declare function fail(message: string): never;
const done = (result: ReturnType<EngineAfter['execute']>): StateAfter => (result.ok ? result.state : fail(`${result.error.code}: ${result.error.message}`));
const run = (...commands: CommandAfter[]): StateAfter => done(engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const preview = (...commands: CommandAfter[]): StateAfter => done(engine.preview(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
const near = (a: number | undefined, b: number, within = 1e-6): boolean => a !== undefined && Math.abs(a - b) <= within;
const nearV = (a: Vec3 | undefined, b: Vec3, within = 1e-6): boolean => a !== undefined && a.every((v, i) => near(v, b[i], within));
const planeOf = (state: StateAfter, id: Id): Frame | undefined => state.evaluation.features[id]?.plane;
const codeOf = (state: StateAfter, id: Id): string | undefined => state.evaluation.features[id]?.error?.code;

const FOREARM_TOP: FaceNameAfter = { feature: 'forearm', role: 'endCap' };
const FOREARM_UNDERSIDE: FaceNameAfter = { feature: 'forearm', role: 'startCap' };
const onFace = (body: Id, face: FaceNameAfter): PlaneRefAfter => ({ kind: 'face', body, face });
const sketch = (id: Id, plane: PlaneRefAfter): CommandAfter[] => [
  { type: 'addFeature', feature: emptySketch(id, id, { kind: 'base', plane: 'XY' }) },
  ...(plane.kind === 'base' && plane.plane === 'XY' ? [] : [{ type: 'setSketchPlane', sketch: id, plane } as CommandAfter]),
];
const fixedPoint = (s: Id, point: Id, x: number, y: number): CommandAfter[] => [
  { type: 'addPoint', sketch: s, id: point, x, y },
  { type: 'addConstraint', sketch: s, id: `${point}Fix`, constraint: { type: 'fixed', point, x, y } },
];
const plane = (feature: Omit<PlaneFeatureC, 'name' | 'suppressed' | 'type' | 'tilt'> & { tilt?: { axis: AxisRefAfter; angle: number | string } }): CommandAfter => ({
  type: 'addFeature',
  feature: { name: feature.id, suppressed: false, type: 'plane', ...feature },
});
// `AxisRef` of types.ts gets the two kinds in the code. A draft cannot widen it inside the types
// other contracts state with it (a pattern of 2e, a joint of 5a, the argument kind `axis` of the
// preparatory step), so an axis of a new kind goes there through this one cast (design.md, "Needs
// from the preparatory step").
const asAxis = (axis: AxisRefAfter): AxisRef => axis as AxisRef;

// ---------------------------------------------------------------- a. the hinge and the tilted plane

export const HINGE: SketchLineAxis = { kind: 'sketchLine', sketch: 'wristLayout', line: 'hinge' };

// A hinge on the top of the forearm, 20 mm inside its far edge: a line along +Y at x = 230 in
// a sketch on the top (whose frame is the frame of XY moved to z = 16). The plane of the wrist goes
// through the hinge and is tilted from the top by a parameter in degrees.
export function wristPlane(): StateAfter {
  return run(
    { type: 'setParameter', name: 'wristTilt', expr: '30' },
    ...sketch('wristLayout', onFace('forearm', FOREARM_TOP)),
    ...fixedPoint('wristLayout', 'ha', 230, -20),
    ...fixedPoint('wristLayout', 'hb', 230, 20),
    { type: 'addCurve', sketch: 'wristLayout', id: 'hinge', curve: { type: 'line', a: 'ha', b: 'hb' } },
    plane({ id: 'wristPlane', base: onFace('forearm', FOREARM_TOP), offset: 0, tilt: { axis: HINGE, angle: 'deg(wristTilt)' } }),
  );
}
// The frame: through the hinge, the normal turned by 30° about +Y. The origin of the top turned
// with it lies 131 mm up; the ends of the hinge keep their coordinates (230, ∓20) in it.
export function tiltedFrame(state: StateAfter): boolean {
  const frame = planeOf(state, 'wristPlane');
  return nearV(frame?.normal, [0.5, 0, Math.sqrt(3) / 2]) && nearV(frame?.x, [Math.sqrt(3) / 2, 0, -0.5]) && nearV(frame?.origin, [30.814157, 0, 131], 1e-5);
}
// The field holds radians and keeps the expression.
export const storedAngle = (state: StateAfter): boolean => {
  const feature = state.document.features.find((f) => f.id === 'wristPlane') as PlaneFeatureC | undefined;
  return near(feature?.tilt?.angle, Math.PI / 6, 1e-12) && feature?.expressions?.['tilt/angle'] === 'deg(wristTilt)' && TILT_ANGLE.unit === 'rad';
};

// ---------------------------------------------------------------- b. the wrist and its joint

// A sketch on the tilted plane with the centre of the wrist on the hinge, and a cylinder of radius
// 10 started 6 mm along the tilted normal, so that it clears the top of the forearm. The wrist is
// a link of its own, turned about the normal of its sketch through its centre.
export function wrist(): StateAfter {
  return run(
    ...sketch('wristSketch', { kind: 'plane', feature: 'wristPlane' }),
    ...fixedPoint('wristSketch', 'wc', 230, 0),
    { type: 'addCurve', sketch: 'wristSketch', id: 'wr', curve: { type: 'circle', center: 'wc' }, radius: 10 },
    { type: 'addConstraint', sketch: 'wristSketch', id: 'wrR', constraint: { type: 'radius', curve: 'wr', value: 10, driving: true } },
    { type: 'addFeature', feature: { id: 'wrist', name: 'wrist', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'wristSketch', regions: [{ outerLoop: ['wr'] }] }, extent: { type: 'distance', start: 6, distance: 20 }, operation: 'new' } },
    { type: 'setLink', id: 'forearm', bodies: ['forearm'] },
    { type: 'setLink', id: 'wrist', bodies: ['wrist'] },
    { type: 'setJoint', id: 'wrist', joint: { type: 'revolute', parent: 'forearm', child: 'wrist', axis: { kind: 'sketchPoint', sketch: 'wristSketch', point: 'wc' }, lower: 'deg(-90)', upper: 'deg(90)', value: 0 } },
  );
}
// The mechanism reports the axis of the wrist through the hinge, 30° from the axis of the elbow
// (which is Z): the two axes are not at right angles and not parallel.
export function wristAxis(state: StateAfter): boolean {
  const joint = state.evaluation.mechanism.joints['wrist'];
  return joint?.status === 'ok' && nearV(joint.axis?.origin, [230, 0, 16]) && nearV(joint.axis?.direction, [0.5, 0, Math.sqrt(3) / 2]);
}
// The wrist clears the forearm: its lowest point is 6 cos 30° − 10 sin 30° = 0.196152 above the top.
export function wristClears(): boolean {
  const report = unwrap(engine.query('gap', { bodies: ['forearm', 'wrist'] }));
  const pair = report.pairs[0];
  return pair !== undefined && pair.contact === undefined && near(pair.distance, 0.196152, pair.accuracy + 1e-6);
}
// The tilt follows its parameter: at 20° the axis is (sin 20°, 0, cos 20°).
export function lessTilt(): boolean {
  const state = preview({ type: 'setParameter', name: 'wristTilt', expr: '20' });
  const angle = (20 * Math.PI) / 180;
  return nearV(state.evaluation.mechanism.joints['wrist']?.axis?.direction, [Math.sin(angle), 0, Math.cos(angle)]);
}

// ---------------------------------------------------------------- c. the midplane

// The midplane of the two caps of the forearm, the top as the base: z = 12 with the axes of the
// top. It follows the thickness of the forearm with no expression of its own.
export function forearmMid(): StateAfter {
  return run(plane({ id: 'forearmMid', base: onFace('forearm', FOREARM_TOP), midplaneWith: onFace('forearm', FOREARM_UNDERSIDE), offset: 0 }));
}
export const midFrame = (state: StateAfter): boolean => {
  const frame = planeOf(state, 'forearmMid');
  return nearV(frame?.origin, [0, 0, 12]) && nearV(frame?.x, [1, 0, 0]) && nearV(frame?.normal, [0, 0, 1]);
};
// 12 thick in place of 8: the midplane moves to z = 14.
export const thicker = (): boolean => nearV(planeOf(preview({ type: 'setField', feature: 'forearm', path: 'extent/distance', value: 12 }), 'forearmMid')?.origin, [0, 0, 14]);
// A plane feature is a plane like any other: the section of the forearm there is its disc (the
// polygon of the circle of radius 70: 15390.877 mm², π · 70² = 15393.804).
export function midSection(): boolean {
  const section = unwrap(engine.query('section', { plane: { kind: 'plane', feature: 'forearmMid' }, bodies: ['forearm'] }));
  return section.bodies.length === 1 && section.bodies[0].loops === 1 && near(section.bodies[0].area, 15390.877, 1e-3);
}
// With the underside as the base the normal follows the underside.
export const fromBelow = (): boolean =>
  nearV(planeOf(preview(plane({ id: 'midBelow', base: onFace('forearm', FOREARM_UNDERSIDE), midplaneWith: onFace('forearm', FOREARM_TOP), offset: 0 })), 'midBelow')?.normal, [0, 0, -1]);
// Planes at an angle: the top and the tilted plane look the same way (n1 · n2 = cos 30° > 0), so
// the midplane is the bisector between their normals, 15° from Z, through the hinge both share.
export function bisector(): boolean {
  const frame = planeOf(run(plane({ id: 'halfTilt', base: onFace('forearm', FOREARM_TOP), midplaneWith: { kind: 'plane', feature: 'wristPlane' }, offset: 0 })), 'halfTilt');
  const angle = (15 * Math.PI) / 180;
  const onPlane = (p: Vec3): boolean => frame !== undefined && near((p[0] - frame.origin[0]) * frame.normal[0] + (p[1] - frame.origin[1]) * frame.normal[1] + (p[2] - frame.origin[2]) * frame.normal[2], 0);
  return nearV(frame?.normal, [Math.sin(angle), 0, Math.cos(angle)]) && onPlane([230, -20, 16]) && onPlane([230, 20, 16]);
}

// ---------------------------------------------------------------- d. other axes

// A base axis: XY tilted about X by 30°: the normal (0, −0.5, 0.866), through the origin.
export const aboutX = (): boolean =>
  nearV(planeOf(preview(plane({ id: 'tiltX', base: { kind: 'base', plane: 'XY' }, offset: 0, tilt: { axis: { kind: 'base', axis: 'X' }, angle: 'deg(30)' } })), 'tiltX')?.normal, [0, -0.5, Math.sqrt(3) / 2]);
// The line as the axis of any consumer: a linear pattern of the wrist along the hinge (+Y), the
// copy 25 mm further. Its volume is that of the wrist.
export function alongTheHinge(): boolean {
  const state = run({ type: 'addFeature', feature: { id: 'wrists', name: 'wrists', suppressed: false, type: 'pattern', source: { type: 'body', body: 'wrist' }, transform: { type: 'linear', direction: asAxis(HINGE), count: 2, span: { type: 'spacing', spacing: 25 } } } });
  const [a, b] = [state.evaluation.bodies['wrist'], state.evaluation.bodies['wrists/1']];
  return a !== undefined && b !== undefined && near(b.volume, a.volume, 1e-6 * a.volume) && near(b.bounds.min[1] - a.bounds.min[1], 25, 1e-4);
}

// The axis of a round face: the mass of the wrist about the axis of its own side, which passes
// through its centre of mass (no distance) with the moment of a cylinder, m r² / 2 (the polygon of
// the circle a little less).
export function aboutItsBore(): boolean {
  const side = asAxis({ kind: 'face', body: 'wrist', face: { feature: 'wrist', role: 'side', curve: 'wr' } });
  const mass = unwrap(engine.query('mass', { bodies: ['wrist'], density: 1.24, about: side }));
  return mass.about !== undefined && near(mass.about.distance, 0, 1e-6) && near(mass.about.moment, (mass.mass * 10 * 10) / 2, 1e-3 * mass.about.moment);
}
// A planar face has no axis: the error of the query names the argument.
export function flatFaceAxis(): boolean {
  const top = asAxis({ kind: 'face', body: 'forearm', face: FOREARM_TOP });
  const outcome = engine.query('mass', { bodies: ['wrist'], density: 1.24, about: top });
  return !outcome.ok && outcome.error.message.includes('no axis');
}

// ---------------------------------------------------------------- e. refusals

export function refused(): { notParallel?: string; roundFace?: string; circle: boolean; noAxis: boolean; later: boolean; setFieldWithout: boolean; unknownField: boolean } {
  // XY about Z: the axis is across the plane
  const notParallel = codeOf(preview(plane({ id: 'bad', base: { kind: 'base', plane: 'XY' }, offset: 0, tilt: { axis: { kind: 'base', axis: 'Z' }, angle: 0.3 } })), 'bad'); // invalidAxis
  // the side of the wrist is round
  const roundFace = codeOf(preview(plane({ id: 'bad', base: onFace('forearm', FOREARM_TOP), midplaneWith: onFace('wrist', { feature: 'wrist', role: 'side', curve: 'wr' }), offset: 0 })), 'bad'); // nonPlanarFace
  // a circle is not a line
  const circle = !engine.preview(plane({ id: 'bad', base: { kind: 'base', plane: 'XY' }, offset: 0, tilt: { axis: { kind: 'sketchLine', sketch: 'wristSketch', line: 'wr' }, angle: 0 } })).ok;
  // a tilt is given whole: a patch of the angle alone on a plane without one
  const noAxis = !engine.preview({ type: 'updateFeature', id: 'forearmMid', patch: { tilt: { angle: 0.2 } } }).ok;
  // the second plane of a feature after the plane
  const later = !engine.preview({ type: 'updateFeature', id: 'wristPlane', patch: { midplaneWith: { kind: 'plane', feature: 'forearmMid' } } }).ok;
  // the angle has no default, so `setField` cannot add a tilt
  const setFieldWithout = !engine.preview({ type: 'setField', feature: 'forearmMid', path: 'tilt/angle', value: 0.2 }).ok;
  // a tilt has exactly an axis and an angle
  const unknownField = !engine.preview({ type: 'updateFeature', id: 'wristPlane', patch: { tilt: { axis: HINGE, angle: 0.5, ...({ offset: 2 } as object) } } }).ok;
  return { notParallel, roundFace, circle, noAxis, later, setFieldWithout, unknownField };
}
// A patch of the angle alone keeps the axis; null removes the tilt, which leaves the top.
export function patches(): boolean {
  const angle = preview({ type: 'updateFeature', id: 'wristPlane', patch: { tilt: { angle: 'deg(45)' } } });
  const removed = preview({ type: 'updateFeature', id: 'wristPlane', patch: { tilt: null } });
  return nearV(planeOf(angle, 'wristPlane')?.normal, [Math.SQRT1_2, 0, Math.SQRT1_2]) && nearV(planeOf(removed, 'wristPlane')?.normal, [0, 0, 1]) && nearV(planeOf(removed, 'wristPlane')?.origin, [0, 0, 16]);
}

export const wrong = (): void => {
  // @ts-expect-error the angle belongs to the tilt
  engine.execute({ type: 'updateFeature', id: 'wristPlane', patch: { angle: 0.3 } });
  // @ts-expect-error the second plane is a plane reference, not an ID
  engine.execute({ type: 'updateFeature', id: 'forearmMid', patch: { midplaneWith: 'wristPlane' } });
};

// ---------------------------------------------------------------- f. save and load

// The document loads to the same model; a build of the branch lists the step.
export function saveAndLoad(): boolean {
  const before = engine.getState();
  const loaded = engine.load(engine.save());
  const after = engine.getState();
  const pending = UPGRADES.slice(UPGRADES.length - SCHEMA_PENDING).map((step) => step.name);
  return loaded.ok && JSON.stringify(after.document) === JSON.stringify(before.document) && pending.includes(MORE_PLANES_STEP.name);
}

// ---------------------------------------------------------------- the part of the scenario

export function scenario13c(): boolean {
  run(arm());
  const tilted = wristPlane();
  const built = wrist();
  const mid = forearmMid();
  const no = refused();
  return (
    tiltedFrame(tilted) &&
    storedAngle(tilted) &&
    wristAxis(built) &&
    wristClears() &&
    lessTilt() &&
    midFrame(mid) &&
    thicker() &&
    midSection() &&
    fromBelow() &&
    bisector() &&
    aboutX() &&
    patches() &&
    no.notParallel === 'invalidAxis' &&
    no.roundFace === 'nonPlanarFace' &&
    no.circle &&
    no.noAxis &&
    no.later &&
    no.setFieldWithout &&
    no.unknownField &&
    alongTheHinge() &&
    aboutItsBore() &&
    flatFaceAxis() &&
    saveAndLoad()
  );
}

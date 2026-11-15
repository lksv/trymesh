// Validation scenario 12 (a box with a lid and screw posts), the part of package 2a, written as
// calls against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step
// that cannot be written here is a hole in the contract. Lines marked `@ts-expect-error` are
// calls that must not compile.
//
// The four packages of track B share the scenario. This file builds the box, its cavity, the lid
// with its lip and a rib, and exports the model and the helpers; 2f adds the posts, 2b the taper
// and 2c the holes (their calls.ts import from here).

import { emptySketch } from '../../../packages/engine/src/index';
import type { Expr, Id, Input } from '../../../packages/engine/src/index';
import type { CommandAfter, CommandResultAfter, EngineAfter, FaceNameAfter, PlaneRefAfter, QueryOutcome, StateAfter } from '../00-prep/contract';
import type { ExtrudeFeatureB, RegionsProfile } from './contract';
import { WALL_ROLES } from './contract';

export declare const engine: EngineAfter;
export declare function fail(message: string): never;
export const done = (result: CommandResultAfter): StateAfter => (result.ok ? result.state : fail(`${result.error.code}: ${result.error.message}`));
export const run = (...commands: CommandAfter[]): StateAfter => done(engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
export const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));

// ---------------------------------------------------------------- helpers over existing commands

export const XY: PlaneRefAfter = { kind: 'base', plane: 'XY' };
export const onFace = (body: Id, face: FaceNameAfter): PlaneRefAfter => ({ kind: 'face', body, face });
// Two face names are the same when their fields are, in whatever order an object lists them.
const nameKey = (name: FaceNameAfter): string => JSON.stringify(Object.entries(name).sort(([a], [b]) => (a < b ? -1 : 1)));
export const sameName = (a: FaceNameAfter, b: FaceNameAfter): boolean => nameKey(a) === nameKey(b);
// An empty sketch on a plane or on a face. A face in a role of a package goes through
// `setSketchPlane` (00-prep/contract.ts: the sketch feature of today is not restated).
export function sketchOn(id: Id, plane: PlaneRefAfter): CommandAfter[] {
  return [{ type: 'addFeature', feature: emptySketch(id, id, { kind: 'base', plane: 'XY' }) }, { type: 'setSketchPlane', sketch: id, plane }];
}
const dimension = (sketch: Id, id: Id, type: 'horizontalDistance' | 'verticalDistance', a: Id, b: Id, value: number | Expr): CommandAfter => ({ type: 'addConstraint', sketch, id, constraint: { type, a, b, value, driving: true } });
// A point at (x, y) from the origin of the sketch, both given as expressions.
export function pointAt(sketch: Id, id: Id, x: Expr, y: Expr): CommandAfter[] {
  return [{ type: 'addPoint', sketch, id, x: 1, y: 1 }, dimension(sketch, `${id}x`, 'horizontalDistance', 'origin', id, x), dimension(sketch, `${id}y`, 'verticalDistance', 'origin', id, y)];
}
// A rectangle with a corner at the origin: lines `${p}a` (bottom), `${p}b` (right), `${p}c` (top),
// `${p}d` (left), as `rectangle` of packages/scenarios/test/kit.ts, with sizes as expressions.
export function rectangle(sketch: Id, p: string, width: Expr, height: Expr): CommandAfter[] {
  const corners: [number, number][] = [[0, 0], [10, 1], [11, 9], [1, 10]];
  const names = ['a', 'b', 'c', 'd'];
  return [
    ...corners.map(([x, y], i): CommandAfter => ({ type: 'addPoint', sketch, id: `${p}${i + 1}`, x, y })),
    ...names.map((name, i): CommandAfter => ({ type: 'addCurve', sketch, id: `${p}${name}`, curve: { type: 'line', a: `${p}${i + 1}`, b: `${p}${((i + 1) % 4) + 1}` } })),
    { type: 'addConstraint', sketch, id: `${p}h1`, constraint: { type: 'horizontal', line: `${p}a` } },
    { type: 'addConstraint', sketch, id: `${p}v1`, constraint: { type: 'vertical', line: `${p}b` } },
    { type: 'addConstraint', sketch, id: `${p}h2`, constraint: { type: 'horizontal', line: `${p}c` } },
    { type: 'addConstraint', sketch, id: `${p}v2`, constraint: { type: 'vertical', line: `${p}d` } },
    { type: 'addConstraint', sketch, id: `${p}fix`, constraint: { type: 'coincident', a: `${p}1`, b: 'origin' } },
    dimension(sketch, `${p}w`, 'horizontalDistance', `${p}1`, `${p}2`, width),
    dimension(sketch, `${p}h`, 'verticalDistance', `${p}2`, `${p}3`, height),
  ];
}
export const OUTLINE: Id[] = ['oa', 'ob', 'oc', 'od'];
const base = (id: Id): Pick<ExtrudeFeatureB, 'id' | 'name' | 'suppressed' | 'type'> => ({ id, name: id, suppressed: false, type: 'extrude' });

// ---------------------------------------------------------------- the box and its cavity

// Parameters: the outer size, the wall and the floor, the print clearance of the lid.
export function parameters(): StateAfter {
  const values: Record<string, Expr> = { L: '80', W: '50', H: '30', wall: '2', floor: '2', clearance: '0.2', lidT: '3', lipH: '4', lipT: '1.5', ribT: '1.6', ribH: '12', postR: '4' };
  return run(...Object.entries(values).map(([name, expr]): CommandAfter => ({ type: 'setParameter', name, expr })));
}

// The outer body: the outline extruded to the height. No offset: the feature is the one of today.
export function box(): StateAfter {
  return run(
    ...sketchOn('outline', XY),
    ...rectangle('outline', 'o', 'L', 'W'),
    { type: 'addFeature', feature: { ...base('box'), profile: { type: 'regions', sketch: 'outline', regions: [{ outerLoop: [...OUTLINE].sort() }] }, extent: { type: 'distance', start: 0, distance: 'H' }, operation: 'new' } },
  );
}

// The cavity: the same outline moved inwards by the wall, cut from the floor up through the top.
// The offset is an expression like any numeric field.
export function cavity(): StateAfter {
  return run({
    type: 'addFeature',
    feature: { ...base('cavity'), profile: { type: 'regions', sketch: 'outline', regions: [{ outerLoop: [...OUTLINE].sort() }], offset: '-wall' }, extent: { type: 'distance', start: 'floor', distance: 'H' }, operation: 'cut', targets: ['box'] },
  });
}

// What the scenario asserts about the cavity.
export function cavityChecks(state: StateAfter): boolean {
  // the field is in the document with its expression, and the value used is in the result
  const feature = state.document.features.find((f) => f.id === 'cavity');
  if (feature?.type !== 'extrude' || feature.profile.type !== 'regions') return false;
  const stored: number | undefined = feature.profile.offset; // -2
  const expression = feature.expressions?.['profile/offset']; // "-wall"
  const used = state.evaluation.features['cavity'].values?.['profile/offset']; // -2
  // the volume is the block less the cavity: L·W·H − (L − 2·wall)(W − 2·wall)(H − floor)
  const volume = state.evaluation.bodies['box'].volume;
  // every side face of the cavity keeps the name of its curve and is a plane: a sketch can stand on it
  const sides = OUTLINE.map((curve) => state.evaluation.faceNames.findIndex((name) => name.feature === 'cavity' && name.role === 'side' && name.curve === curve));
  const planar = sides.every((face) => face >= 0 && state.evaluation.faceSurfaces[face].kind === 'plane');
  return stored === -2 && expression === '-wall' && used === -2 && Math.abs(volume - (80 * 50 * 30 - 76 * 46 * 28)) < 1e-3 && planar;
}

// The wall follows the parameter: a thicker wall is a smaller cavity, with nothing else touched.
export const thickerWall = (): number => done(engine.preview({ type: 'setParameter', name: 'wall', expr: '3' })).evaluation.bodies['box'].volume;

// An offset that makes the outline vanish is an error of the feature, not an invalid command.
export function tooFarIn(): string | undefined {
  const preview = done(engine.preview({ type: 'setField', feature: 'cavity', path: 'profile/offset', value: -30 }));
  return preview.evaluation.features['cavity'].error?.code; // invalidProfile; the message names the curves
}

// ---------------------------------------------------------------- the lid and its lip

// The lid is modelled in place: a plate on top of the box from the same outline, a lip that goes
// down into the cavity with the print clearance, and the inside of the lip cut out again. All
// three read one sketch; the clearance of the fit is one expression.
export function lid(): StateAfter {
  const regions = [{ outerLoop: [...OUTLINE].sort() }];
  const profile = (offset?: Expr): Input<RegionsProfile> => ({ type: 'regions', sketch: 'outline', regions, ...(offset === undefined ? {} : { offset }) });
  return run(
    { type: 'addFeature', feature: { ...base('lid'), profile: profile(), extent: { type: 'distance', start: 'H', distance: 'lidT' }, operation: 'new' } },
    { type: 'addFeature', feature: { ...base('lip'), profile: profile('-(wall + clearance)'), extent: { type: 'distance', start: 'H', distance: '-lipH' }, operation: 'add', targets: ['lid'] } },
    { type: 'addFeature', feature: { ...base('lipInside'), profile: profile('-(wall + clearance + lipT)'), extent: { type: 'distance', start: 'H', distance: '-(lipH + 1)' }, operation: 'cut', targets: ['lid'] } },
  );
}

// The lid does not collide with the box and the gap between lip and wall is the clearance: asked
// with the queries of step 1 (the collisions exist today; the smallest gap is package 1c).
export const lidFits = (): boolean => {
  const report = unwrap(engine.query('interference', { bodies: ['box', 'lid'] }));
  return report.pairs.length === 0 && report.failed.length === 0;
};

// The offset is an optional field: `setField` gives it to a feature that did not have it,
// `updateFeature` changes it and removes it again.
export function offsetOnAndOff(): boolean {
  const added = done(engine.preview({ type: 'setField', feature: 'lid', path: 'profile/offset', value: '-clearance' }));
  const changed = done(engine.preview({ type: 'updateFeature', id: 'lip', patch: { profile: { offset: -2.5 } } }));
  const removed = done(engine.preview({ type: 'updateFeature', id: 'lip', patch: { profile: { offset: null } } }));
  const lipOf = (state: StateAfter) => state.document.features.find((f) => f.id === 'lip');
  const after = lipOf(removed);
  return added.evaluation.features['lid'].status === 'ok' && changed.evaluation.features['lip'].status === 'ok' && after?.type === 'extrude' && after.profile.type === 'regions' && after.profile.offset === undefined;
}

// ---------------------------------------------------------------- a rib from a line

// A rib on the floor of the cavity, from one construction line that starts inside the long wall
// and runs towards the middle. The line closes no region; the wall profile does not need one.
export const FLOOR: FaceNameAfter = { feature: 'cavity', role: 'startCap' };
export function rib(): StateAfter {
  return run(
    ...sketchOn('ribs', onFace('box', FLOOR)),
    ...pointAt('ribs', 'r1a', 'L / 2', 'wall / 2'),
    ...pointAt('ribs', 'r1b', 'L / 2', 'wall + 20'),
    { type: 'addCurve', sketch: 'ribs', id: 'r1', curve: { type: 'line', a: 'r1a', b: 'r1b', construction: true } },
    { type: 'addFeature', feature: { ...base('rib'), profile: { type: 'wall', sketch: 'ribs', curves: ['r1'], thickness: 'ribT' }, extent: { type: 'distance', start: 0, distance: 'ribH' }, operation: 'add', targets: ['box'] } },
  );
}

// The faces of the rib: two sides of the one curve and the free end; the end inside the wall is
// swallowed by the union. A sketch can stand on a side.
export const RIB_LEFT: FaceNameAfter = { feature: 'rib', role: 'wallSide', curve: 'r1', side: 'left' };
export function ribChecks(state: StateAfter): boolean {
  const names = state.evaluation.faceNames.filter((name) => name.feature === 'rib');
  const sides = names.filter((name) => name.role === 'wallSide').map((name) => (name.role === 'wallSide' ? name.side : '')); // ['left', 'right']
  const end = names.some((name) => name.role === 'wallEnd' && name.point === 'r1b');
  const onSide = done(engine.preview({ type: 'batch', commands: sketchOn('onRib', onFace('box', RIB_LEFT)) }));
  return sides.sort().join() === 'left,right' && end && onSide.evaluation.features['onRib'].status === 'ok';
}
// The catalog of roles has the two new ones; the key of a face is built from it.
export const wallParts: { readonly curve: { kind: 'text' }; readonly side: { kind: 'text' } } = WALL_ROLES.wallSide.parts;

// A chain of two lines makes an L-shaped wall with a mitred corner; the thickness is a field.
export function bracket(): StateAfter {
  return run(
    ...pointAt('ribs', 'b1', 'L - wall - 12', 'wall / 2'),
    ...pointAt('ribs', 'b2', 'L - wall - 12', 'wall + 10'),
    ...pointAt('ribs', 'b3', 'L - wall / 2', 'wall + 10'),
    { type: 'addCurve', sketch: 'ribs', id: 'b12', curve: { type: 'line', a: 'b1', b: 'b2', construction: true } },
    { type: 'addCurve', sketch: 'ribs', id: 'b23', curve: { type: 'line', a: 'b2', b: 'b3', construction: true } },
    { type: 'addFeature', feature: { ...base('bracket'), profile: { type: 'wall', sketch: 'ribs', curves: ['b12', 'b23'], thickness: 'ribT' }, extent: { type: 'distance', start: 0, distance: 'ribH' }, operation: 'add', targets: ['box'] } },
    { type: 'setField', feature: 'bracket', path: 'profile/thickness', value: 2 },
  );
}

// Curves that do not form one chain are an error of the feature; a curve that is not in the
// sketch is an invalid command.
export function brokenChains(): [string | undefined, boolean] {
  const apart = done(engine.preview({ type: 'updateFeature', id: 'bracket', patch: { profile: { curves: ['b12', 'r1'] } } }));
  const unknown = engine.preview({ type: 'updateFeature', id: 'bracket', patch: { profile: { curves: ['b12', 'nope'] } } });
  return [apart.evaluation.features['bracket'].error?.code, unknown.ok]; // ['invalidProfile', false]
}

// ---------------------------------------------------------------- what must not compile

export const wrong = (): void => {
  // @ts-expect-error a generated profile has no offset
  engine.execute({ type: 'addFeature', feature: { ...base('g'), profile: { type: 'generated', generator: 'involuteGear', sketch: 'outline', operands: { circle: 'c' }, params: { teeth: 12 }, offset: 1 }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } });
  // @ts-expect-error a wall has a thickness, not an offset
  engine.execute({ type: 'updateFeature', id: 'rib', patch: { profile: { type: 'wall', sketch: 'ribs', curves: ['r1'], offset: 1 } } });
  // @ts-expect-error the side of a wall face is left or right
  onFace('box', { feature: 'rib', role: 'wallSide', curve: 'r1', side: 'top' });
};

// ---------------------------------------------------------------- the part of the scenario

export function scenario12a(): boolean {
  parameters();
  box();
  const hollow = cavityChecks(cavity());
  const thicker = thickerWall() > 80 * 50 * 30 - 76 * 46 * 28;
  const vanished = tooFarIn() === 'invalidProfile';
  lid();
  const fits = lidFits() && offsetOnAndOff();
  const ribbed = ribChecks(rib());
  bracket();
  const [apart, unknown] = brokenChains();
  return hollow && thicker && vanished && fits && ribbed && apart === 'invalidProfile' && !unknown;
}

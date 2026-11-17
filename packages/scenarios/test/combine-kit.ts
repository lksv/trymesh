// Bodies for the tests of the boolean of bodies, the clearance and the split (D56): every shape
// a prism or a cylinder along Z from fixed points of a sketch of its own, so a test states the
// numbers it builds and nothing else.
import { type Command, type CombineFeature, type EngineState, type FaceName, type Id, type Input, type PlaneRef, type Solid, type SplitFeature, type Surface, type Vec3, emptySketch, faceKey } from '@trymesh/engine';
import type { FaceInfo } from '../../engine/src/solid';

type Op = 'new' | 'add' | 'cut';
const sketch = (id: Id): Command => ({ type: 'addFeature', feature: emptySketch(id, id, { kind: 'base', plane: 'XY' }) });
const fixedPoint = (sketchId: Id, point: Id, x: number, y: number): Command[] => [
  { type: 'addPoint', sketch: sketchId, id: point, x, y },
  { type: 'addConstraint', sketch: sketchId, id: `${point}Fix`, constraint: { type: 'fixed', point, x, y } },
];
const extrude = (id: Id, sketchId: Id, loop: Id[], from: number, to: number, operation: Op, targets?: Id[], taper?: string): Command => ({
  type: 'addFeature',
  feature: {
    id,
    name: id,
    suppressed: false,
    type: 'extrude',
    profile: { type: 'regions', sketch: sketchId, regions: [{ outerLoop: [...loop].sort() }] },
    extent: { type: 'distance', start: from, distance: to - from, ...(taper === undefined ? {} : { taper }) },
    operation,
    ...(targets === undefined ? {} : { targets }),
  },
});

// A cylinder along Z: the feature `id`, its side `{ feature: id, role: 'side', curve: '<id>Circle' }`.
export function cylinder(id: Id, x: number, y: number, radius: number, from: number, to: number, operation: Op = 'new', targets?: Id[], taper?: string): Command[] {
  const [sketchId, circle] = [`${id}Sketch`, `${id}Circle`];
  return [
    sketch(sketchId),
    ...fixedPoint(sketchId, `${id}Centre`, x, y),
    { type: 'addCurve', sketch: sketchId, id: circle, curve: { type: 'circle', center: `${id}Centre` }, radius },
    { type: 'addConstraint', sketch: sketchId, id: `${id}Radius`, constraint: { type: 'radius', curve: circle, value: radius, driving: true } },
    extrude(id, sketchId, [circle], from, to, operation, targets, taper),
  ];
}
// A prism along Z over corners counter-clockwise; its sides are `<id>L0`, `<id>L1`, ...
export function prism(id: Id, corners: [number, number][], from: number, to: number, operation: Op = 'new', targets?: Id[]): Command[] {
  const sketchId = `${id}Sketch`;
  const lines = corners.map((_, i) => `${id}L${i}`);
  return [
    sketch(sketchId),
    ...corners.flatMap(([x, y], i) => fixedPoint(sketchId, `${id}P${i}`, x, y)),
    ...corners.map((_, i): Command => ({ type: 'addCurve', sketch: sketchId, id: lines[i], curve: { type: 'line', a: `${id}P${i}`, b: `${id}P${(i + 1) % corners.length}` } })),
    extrude(id, sketchId, lines, from, to, operation, targets),
  ];
}
// A box along the axes; its sides: L0 at y0, L1 at x1, L2 at y1, L3 at x0.
export const box = (id: Id, x0: number, y0: number, x1: number, y1: number, from: number, to: number, operation: Op = 'new', targets?: Id[]): Command[] =>
  prism(id, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], from, to, operation, targets);
export const batch = (...commands: Command[]): Command => ({ type: 'batch', commands });

type Fields<F> = Omit<Input<F>, 'id' | 'name' | 'suppressed' | 'type'>;
export const combine = (id: Id, fields: Fields<CombineFeature>, index?: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'combine', ...fields }, ...(index === undefined ? {} : { index }) });
export const split = (id: Id, fields: Fields<SplitFeature>, index?: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'split', ...fields }, ...(index === undefined ? {} : { index }) });
export const plane = (id: Id, base: 'XY' | 'XZ' | 'YZ', offset: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: { kind: 'base', plane: base }, offset } });
export const onFace = (body: Id, face: FaceName): PlaneRef => ({ kind: 'face', body, face });
export const sketchOn = (id: Id, at: PlaneRef): Command[] => [sketch(id), { type: 'setSketchPlane', sketch: id, plane: at }];

export const faceNumber = (state: EngineState, name: FaceName): number => state.evaluation.faceNames.findIndex((other) => faceKey(other) === faceKey(name));
export const surfaceOf = (state: EngineState, name: FaceName): Surface | undefined => state.evaluation.faceSurfaces[faceNumber(state, name)];
export const hasFace = (state: EngineState, body: Id, name: FaceName): boolean => state.evaluation.bodies[body]?.faces.some((face) => face.id === faceNumber(state, name)) ?? false;
export const volumeOf = (state: EngineState, body: Id): number => state.evaluation.bodies[body].volume;
export const solidOf = (state: EngineState, body: Id): Solid => state.evaluation.bodies[body].solid;
export const codeOf = (state: EngineState, feature: Id): string | undefined => state.evaluation.features[feature].error?.code;

// The description of a face the engine keeps (FaceInfo) from the surface the state publishes, for
// the calls of `movedOutwards` itself.
export function infoOf(surface: Surface): FaceInfo {
  if (surface.kind === 'plane') {
    const n = surface.normal;
    const e: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return { planar: true, origin: surface.origin, y: [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]], normal: n };
  }
  if (surface.kind === 'cylinder') return { planar: false, surface: 'cylinder', center: surface.origin, axis: surface.axis, radius: surface.radius, along: surface.axis };
  if (surface.kind === 'cone') return { planar: false, surface: 'cone', apex: surface.apex, axis: surface.axis, halfAngle: surface.halfAngle, along: surface.axis };
  if (surface.kind === 'swept') return { planar: false, surface: 'swept', axis: surface.axis };
  throw new Error(`no description for a surface of the kind ${surface.kind}`);
}
export const infosOf = (state: EngineState): FaceInfo[] => state.evaluation.faceSurfaces.map(infoOf);

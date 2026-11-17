// Bodies and commands for the tests of the chamfer and the fillet of edges (D63), made by the engine
// with the real adapters: the shapes the design of 4b measured ("Measured", A to H).
import type { Command, EdgeName, Engine, EngineState, FaceName, Id, PlaneRef } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, cap, circle, newEngine, onFace, rectLoop, rectangle, run, side } from './kit';

export { cap, side };
export const edge = (a: FaceName, b: FaceName): EdgeName => ({ a, b });
const base = (id: Id) => ({ id, name: id, suppressed: false });
export const chamfer = (id: Id, body: Id, edges: EdgeName[], distance: number | string): Command => ({ type: 'addFeature', feature: { ...base(id), type: 'chamfer', body, edges, distance } });
export const fillet = (id: Id, body: Id, edges: EdgeName[], radius: number | string): Command => ({ type: 'addFeature', feature: { ...base(id), type: 'fillet', body, edges, radius } });

// A closed polygon of free points p0… and lines l0 (p0 to p1)…
export function polygonSketch(sketch: Id, points: [number, number][]): Command {
  return batch(
    ...points.map(([x, y], i): Command => ({ type: 'addPoint', sketch, id: `p${i}`, x, y })),
    ...points.map((_, i): Command => ({ type: 'addCurve', sketch, id: `l${i}`, curve: { type: 'line', a: `p${i}`, b: `p${(i + 1) % points.length}` } })),
  );
}
export const polygonLoop = (n: number): Id[] => Array.from({ length: n }, (_, i) => `l${i}`);

// A box 60 × 40 × 20 at the origin: E/side/ra (y = 0), rb (x = 60), rc (y = 40), rd (x = 0), the
// start cap at z = 0, the end cap at z = 20.
export function box(engine: Engine = newEngine(), w = 60, d = 40, h = 20): EngineState {
  return run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, w, d), addExtrude('E', 's', [rectLoop('r')], h));
}
export const BOX_TOP_FRONT = edge(cap('E'), side('E', 'ra'));
export const BOX_TOP = rectLoop('r').map((curve) => edge(cap('E'), side('E', curve)));
export const BOX_VERTICAL = rectLoop('r').map((curve, i, all) => edge(side('E', curve), side('E', all[(i + 1) % 4])));
export const BOX_BOTTOM = rectLoop('r').map((curve) => edge(cap('E', 'startCap'), side('E', curve)));

// The box with a hole of `radius` through it at (30, 20).
export function boxWithHole(radius = 5, engine = newEngine()): EngineState {
  box(engine);
  return run(engine, addSketch('t', onFace('E', cap('E'))), circle('t', 'h', 30, 20, radius), addExtrude('H', 't', [['h']], -20, 'cut', 'E'));
}
// The box with a boss of `radius`, 10 high, on its top at (30, 20).
export function boxWithBoss(radius = 8, engine = newEngine()): EngineState {
  box(engine);
  return run(engine, addSketch('t', onFace('E', cap('E'))), circle('t', 'b', 30, 20, radius), addExtrude('B', 't', [['b']], 10, 'add', 'E'));
}
// A profile in XZ extruded 40 along +Y (the normal of XZ is −Y).
export function profileXZ(points: [number, number][], depth = 40, engine = newEngine()): EngineState {
  const XZ: PlaneRef = { kind: 'base', plane: 'XZ' };
  return run(engine, addSketch('s', XZ), polygonSketch('s', points), addExtrude('E', 's', [polygonLoop(points.length)], -depth));
}
// 60 long, 10 high for x < 30 and 20 high for x > 30.
export const STEPPED: [number, number][] = [
  [0, 0],
  [60, 0],
  [60, 20],
  [30, 20],
  [30, 10],
  [0, 10],
];
// An L: a plate 60 × 5 and a wall 5 thick at x 0…5 up to z 30.
export const BRACKET: [number, number][] = [
  [0, 0],
  [60, 0],
  [60, 5],
  [5, 5],
  [5, 30],
  [0, 30],
];
// A block whose end x = 60 is tilted: the top 60 long, the bottom 70.
export const TILTED: [number, number][] = [
  [0, 0],
  [70, 0],
  [60, 20],
  [0, 20],
];

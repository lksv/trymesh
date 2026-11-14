// Pomůcky pro validační scénáře: engine se skutečnými adaptéry a stavba běžných skic.
import { expect } from 'vitest';
import { type Command, type CommandResult, type Constraint, type Engine, type EngineState, type ExtrudeFeature, type FaceName, type Id, type PlaneRef, type Solid, createEngine, emptySketch } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() };
export const newEngine = (): Engine => createEngine(deps);

export const XY: PlaneRef = { kind: 'base', plane: 'XY' };
export const cap = (extrude: Id, role: 'startCap' | 'endCap' = 'endCap'): FaceName => ({ feature: extrude, role });
export const side = (extrude: Id, curve: Id): FaceName => ({ feature: extrude, role: 'side', curve });
export const onFace = (body: Id, face: FaceName): PlaneRef => ({ kind: 'face', body, face });

// Provede příkaz a ověří, že je platný.
export function run(engine: Engine, ...commands: Command[]): EngineState {
  let result: CommandResult | undefined;
  for (const command of commands) {
    result = engine.execute(command);
    if (!result.ok) throw new Error(`neplatný příkaz ${command.type}: ${result.error.message}`);
  }
  return (result as Extract<CommandResult, { ok: true }>).state;
}
export const batch = (...commands: Command[]): Command => ({ type: 'batch', commands });
export const addSketch = (id: Id, plane: PlaneRef, index?: number): Command => ({ type: 'addFeature', feature: emptySketch(id, id, plane), ...(index === undefined ? {} : { index }) });
export const extrude = (id: Id, sketch: Id, curves: Id[][], distance: number, operation: 'new' | 'add' | 'cut' = 'new', target?: Id): ExtrudeFeature => ({
  id,
  name: id,
  suppressed: false,
  type: 'extrude',
  profile: { type: 'regions', sketch, regions: curves.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) },
  extent: { type: 'distance', start: 0, distance },
  operation,
  ...(target === undefined ? {} : { targets: [target] }),
});
export const addExtrude = (...args: Parameters<typeof extrude>): Command => ({ type: 'addFeature', feature: extrude(...args) });
export const constrain = (sketch: Id, id: Id, constraint: Constraint): Command => ({ type: 'addConstraint', sketch, id, constraint });
export const dimension = (sketch: Id, id: Id, shape: object, value: number): Command => constrain(sketch, id, { ...shape, value, driving: true } as Constraint);

// Obdélník od ruky s rohem u (x, y), plně určený: vodorovné a svislé strany, kóty šířky a výšky,
// levý dolní roh přichycený k `anchor` (počátek nebo jiný bod), nebo okótovaný od počátku.
// ID: body `${p}1..4`, úsečky `${p}a` (spodní), `${p}b` (pravá), `${p}c` (horní), `${p}d` (levá).
export function rectangle(sketch: Id, p: string, x: number, y: number, width: number, height: number, anchor: Id | null = 'origin'): Command {
  const corners: [number, number][] = [
    [x + 0.4, y - 0.3],
    [x + width - 0.7, y + 0.5],
    [x + width + 0.6, y + height - 0.4],
    [x - 0.5, y + height + 0.8],
  ];
  const names = ['a', 'b', 'c', 'd'];
  return batch(
    ...corners.map(([px, py], i): Command => ({ type: 'addPoint', sketch, id: `${p}${i + 1}`, x: px, y: py })),
    ...names.map((name, i): Command => ({ type: 'addCurve', sketch, id: `${p}${name}`, curve: { type: 'line', a: `${p}${i + 1}`, b: `${p}${((i + 1) % 4) + 1}` } })),
    constrain(sketch, `${p}h1`, { type: 'horizontal', line: `${p}a` }),
    constrain(sketch, `${p}v1`, { type: 'vertical', line: `${p}b` }),
    constrain(sketch, `${p}h2`, { type: 'horizontal', line: `${p}c` }),
    constrain(sketch, `${p}v2`, { type: 'vertical', line: `${p}d` }),
    dimension(sketch, `${p}w`, { type: 'horizontalDistance', a: `${p}1`, b: `${p}2` }, width),
    dimension(sketch, `${p}h`, { type: 'verticalDistance', a: `${p}2`, b: `${p}3` }, height),
    ...(anchor === null
      ? [dimension(sketch, `${p}x`, { type: 'horizontalDistance', a: 'origin', b: `${p}1` }, x), dimension(sketch, `${p}y`, { type: 'verticalDistance', a: 'origin', b: `${p}1` }, y)]
      : [constrain(sketch, `${p}fix`, { type: 'coincident', a: `${p}1`, b: anchor })]),
  );
}
export const rectLoop = (p: string): Id[] => [`${p}a`, `${p}b`, `${p}c`, `${p}d`];

// Kružnice se středem okótovaným od počátku a s kótou poloměru. ID: střed `${id}c`, kóty `${id}x`, `${id}y`, `${id}r`.
export function circle(sketch: Id, id: Id, x: number, y: number, radius: number): Command {
  return batch(
    { type: 'addPoint', sketch, id: `${id}c`, x: x + 0.3, y: y - 0.2 },
    { type: 'addCurve', sketch, id, curve: { type: 'circle', center: `${id}c` }, radius: radius * 1.1 },
    dimension(sketch, `${id}x`, { type: 'horizontalDistance', a: 'origin', b: `${id}c` }, x),
    dimension(sketch, `${id}y`, { type: 'verticalDistance', a: 'origin', b: `${id}c` }, y),
    dimension(sketch, `${id}r`, { type: 'radius', curve: id }, radius),
  );
}

// ---------------------------------------------------------------- měření výsledku

export function volume(s: Solid): number {
  let sum = 0;
  const p = s.positions;
  for (let t = 0; t < s.triangles.length; t += 3) {
    const [a, b, c] = [3 * s.triangles[t], 3 * s.triangles[t + 1], 3 * s.triangles[t + 2]];
    sum += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return sum / 6;
}

// Obálka trojúhelníků stěny daného jména; undefined = stěna v tělese není.
export function faceBox(state: EngineState, body: Id, name: FaceName): { min: number[]; max: number[]; area: number } | undefined {
  const id = state.evaluation.faceNames.findIndex((n) => JSON.stringify(n) === JSON.stringify(name));
  const solid = state.evaluation.bodies[body]?.solid;
  if (id < 0 || !solid) return undefined;
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], area: 0 };
  let found = false;
  for (let t = 0; t < solid.faceIds.length; t++) {
    if (solid.faceIds[t] !== id) continue;
    found = true;
    const v = [0, 1, 2].map((k) => [0, 1, 2].map((axis) => solid.positions[3 * solid.triangles[3 * t + k] + axis]));
    for (const p of v) for (let axis = 0; axis < 3; axis++) {
      box.min[axis] = Math.min(box.min[axis], p[axis]);
      box.max[axis] = Math.max(box.max[axis], p[axis]);
    }
    const [e1, e2] = [v[1].map((x, i) => x - v[0][i]), v[2].map((x, i) => x - v[0][i])];
    box.area += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
  }
  return found ? box : undefined;
}

export const status = (state: EngineState): Record<Id, string> =>
  Object.fromEntries(Object.entries(state.evaluation.features).map(([id, f]) => [id, f.status === 'error' ? `error:${f.error?.code}` : f.status === 'warning' ? `warning:${f.warnings.map((w) => w.code).join('+')}` : f.status]));

export function expectAllOk(state: EngineState): void {
  expect(status(state)).toEqual(Object.fromEntries(state.document.features.map((f) => [f.id, 'ok'])));
}
export const faceNames = (state: EngineState, body: Id): string[] =>
  state.evaluation.bodies[body].faces.map((f) => state.evaluation.faceNames[f.id]).map((n) => (n.role === 'side' ? `${n.feature}/side/${n.curve}` : `${n.feature}/${n.role}`)).sort();

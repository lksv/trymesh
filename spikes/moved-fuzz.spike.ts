// The fuzz of `movedOutwards` (D56, docs/d36/3d-body-boolean/design.md, "To verify", 1, and
// "Revision after the verification", 2): random bodies of prisms, cylinders, tapers, cuts and holes
// (holes nearly tangent to round faces among them), clearances from 0.02 to 2, three chord
// tolerances. Every accepted moved body is subtracted from a block through the adapter, and the
// pocket must be no nearer to the body than the bound of a round face, c (1 − 0.15) less the chord
// tolerance. More bodies: MOVE_FUZZ_COUNT=300 (the measurement of the design), another seed:
// MOVE_FUZZ_SEED.
// Run from the root of the repository: npx vitest run --config spikes/vitest.config.ts
import { expect, test } from 'vitest';
import { createEngine, emptyDocument, emptySketch } from '../packages/engine/src/index';
import type { Command, Engine, Id, Solid, Surface, Vec3 } from '../packages/engine/src/index';
import { closest } from '../packages/engine/src/mesh-distance';
import { ROUND_ALLOWANCE, isMoveProblem, movedOutwards } from '../packages/engine/src/recompute/moved-body';
import { type FaceInfo, volumeOf } from '../packages/engine/src/solid';
import { createManifoldKernel } from '../packages/kernel-manifold/src/index';
import { createPlanegcsSolver } from '../packages/solver-planegcs/src/index';

const kernel = await createManifoldKernel();
const solver = await createPlanegcsSolver();

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- bodies from fixed points

type Op = 'new' | 'add' | 'cut';
const fixedPoint = (sketch: Id, point: Id, x: number, y: number): Command[] => [
  { type: 'addPoint', sketch, id: point, x, y },
  { type: 'addConstraint', sketch, id: `${point}Fix`, constraint: { type: 'fixed', point, x, y } },
];
const extrude = (id: Id, sketch: Id, loop: Id[], from: number, to: number, operation: Op, target?: Id, taper?: number): Command => ({
  type: 'addFeature',
  feature: {
    id,
    name: id,
    suppressed: false,
    type: 'extrude',
    profile: { type: 'regions', sketch, regions: [{ outerLoop: [...loop].sort() }] },
    extent: { type: 'distance', start: from, distance: to - from, ...(taper === undefined ? {} : { taper: `deg(${taper})` }) },
    operation,
    ...(target === undefined ? {} : { targets: [target] }),
  },
});
function cylinder(id: Id, x: number, y: number, r: number, from: number, to: number, operation: Op = 'new', target?: Id, taper?: number, plane: 'XY' | 'YZ' = 'XY'): Command[] {
  const [sketch, circle] = [`${id}Sketch`, `${id}Circle`];
  return [
    { type: 'addFeature', feature: emptySketch(sketch, sketch, { kind: 'base', plane }) },
    ...fixedPoint(sketch, `${id}Centre`, x, y),
    { type: 'addCurve', sketch, id: circle, curve: { type: 'circle', center: `${id}Centre` }, radius: r },
    { type: 'addConstraint', sketch, id: `${id}Radius`, constraint: { type: 'radius', curve: circle, value: r, driving: true } },
    extrude(id, sketch, [circle], from, to, operation, target, taper),
  ];
}
function prism(id: Id, corners: [number, number][], from: number, to: number, operation: Op = 'new', target?: Id): Command[] {
  const sketch = `${id}Sketch`;
  const lines = corners.map((_, i) => `${id}L${i}`);
  return [
    { type: 'addFeature', feature: emptySketch(sketch, sketch, { kind: 'base', plane: 'XY' }) },
    ...corners.flatMap(([x, y], i) => fixedPoint(sketch, `${id}P${i}`, x, y)),
    ...corners.map((_, i): Command => ({ type: 'addCurve', sketch, id: lines[i], curve: { type: 'line', a: `${id}P${i}`, b: `${id}P${(i + 1) % corners.length}` } })),
    extrude(id, sketch, lines, from, to, operation, target),
  ];
}
const box = (id: Id, x0: number, y0: number, x1: number, y1: number, from: number, to: number, operation: Op = 'new', target?: Id): Command[] =>
  prism(id, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], from, to, operation, target);

// A block with some of: a boss (a cylinder or a cone), a step, a through hole, a blind hole, a hole
// across the foot of the boss nearly tangent to it, a slot; now and then a lone cylinder or cone.
function randomBody(next: () => number): Command[] {
  const [w, d, h] = [10 + next() * 30, 10 + next() * 30, 4 + next() * 16];
  const kind = next();
  if (kind < 0.1) return cylinder('b', 0, 0, 2 + next() * 10, 0, 3 + next() * 20);
  if (kind < 0.15) return cylinder('b', 0, 0, 3 + next() * 10, 0, 3 + next() * 10, 'new', undefined, next() < 0.5 ? 5 + next() * 20 : -(5 + next() * 10));
  const commands: Command[] = [...box('b', 0, 0, w, d, 0, h)];
  const r = 1 + next() * Math.min(w, d) * 0.2;
  const [bx, by] = [r + next() * (w - 2 * r), r + next() * (d - 2 * r)];
  if (next() < 0.6) commands.push(...(next() < 0.5 ? cylinder('boss', bx, by, r, h, h + 1 + next() * 8, 'add', 'b') : cylinder('boss', bx, by, r, h, h + 1 + next() * 6, 'add', 'b', 5 + next() * 20)));
  if (next() < 0.3) commands.push(...box('step', 0, 0, w * (0.2 + next() * 0.3), d, h - 1 - next() * (h / 3), h + 1, 'cut', 'b'));
  if (next() < 0.5) {
    const rh = 0.5 + next() * 3;
    commands.push(...cylinder('through', rh + next() * (w - 2 * rh), rh + next() * (d - 2 * rh), rh, -1, h + 10, 'cut', 'b'));
  }
  if (next() < 0.4) {
    const rh = 0.5 + next() * 2;
    commands.push(...cylinder('blind', rh + next() * (w - 2 * rh), rh + next() * (d - 2 * rh), rh, h - 1 - next() * (h / 2), h + 10, 'cut', 'b'));
  }
  if (next() < 0.25) {
    const rh = 0.5 + next() * 2;
    commands.push(...cylinder('tangent', by + r + rh * (0.9 + next() * 0.2), h - rh * (0.5 + next()), rh, -1, w + 1, 'cut', 'b', undefined, 'YZ'));
  }
  if (next() < 0.25) {
    const sw = 0.3 + next() * 3;
    const sx = sw + next() * (w - 3 * sw);
    commands.push(...prism('slot', [[sx, -1], [sx + sw, -1], [sx + sw, d * 0.6], [sx, d * 0.6]], h - 1 - next() * 3, h + 10, 'cut', 'b'));
  }
  return commands;
}

function infoOf(surface: Surface): FaceInfo {
  if (surface.kind === 'plane') {
    const n = surface.normal;
    const e: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return { planar: true, origin: surface.origin, y: [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]], normal: n };
  }
  if (surface.kind === 'cylinder') return { planar: false, surface: 'cylinder', center: surface.origin, axis: surface.axis, radius: surface.radius };
  if (surface.kind === 'cone') return { planar: false, surface: 'cone', apex: surface.apex, axis: surface.axis, halfAngle: surface.halfAngle };
  if (surface.kind === 'swept') return { planar: false, surface: 'swept', axis: surface.axis };
  throw new Error(`no description for a surface of the kind ${surface.kind}`);
}
function engineWith(chordTolerance: number): Engine {
  const engine = createEngine({ solver, kernel });
  const loaded = engine.load(JSON.stringify({ ...emptyDocument(), settings: { ...emptyDocument().settings, chordTolerance } }));
  if (!loaded.ok) throw new Error(loaded.error.message);
  return engine;
}
function blockAround(s: Solid, margin: number, first: number): Solid {
  const [lo, hi] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  for (let i = 0; i < s.positions.length; i++) [lo[i % 3], hi[i % 3]] = [Math.min(lo[i % 3], s.positions[i]), Math.max(hi[i % 3], s.positions[i])];
  const [x0, y0, z0, x1, y1, z1] = [lo[0] - margin, lo[1] - margin, lo[2] - margin, hi[0] + margin, hi[1] + margin, hi[2] + margin];
  const corners = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return { positions: Float32Array.from(corners.flat()), triangles: Uint32Array.from(quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])), faceIds: Uint32Array.from({ length: 12 }, (_, i) => first + Math.floor(i / 2)) };
}

test('the fuzz of movedOutwards: no accepted pocket is nearer to the body than the bound', () => {
  const count = Number(process.env.MOVE_FUZZ_COUNT ?? 120);
  const next = random(Number(process.env.MOVE_FUZZ_SEED ?? 4401));
  const tally: Record<string, number> = {};
  const tooNear: string[] = [];
  let [tried, nearest] = [0, Infinity];
  for (let i = 0; i < count; i++) {
    const chord = [0.01, 0.003, 0.03][i % 3];
    const c = Math.exp(Math.log(0.02) + next() * (Math.log(2) - Math.log(0.02)));
    const result = engineWith(chord).execute({ type: 'batch', commands: randomBody(next) });
    if (!result.ok || !result.state.evaluation.bodies.b || Object.values(result.state.evaluation.features).some((f) => f.status === 'error')) continue;
    const state = result.state;
    const body = state.evaluation.bodies.b.solid;
    tried++;
    const moved = movedOutwards(body, state.evaluation.faceSurfaces.map(infoOf), state.evaluation.faceNames, c, chord, kernel);
    if (isMoveProblem(moved)) {
      tally[moved.reason] = (tally[moved.reason] ?? 0) + 1;
      continue;
    }
    const first = state.evaluation.faceNames.length;
    const pocket = kernel.boolean('difference', blockAround(body, c + 5, first), { ...moved.solid, faceIds: moved.solid.faceIds.map((f) => f + first + 10) });
    const distance = closest({ solid: body }, { solid: pocket })?.distance ?? Infinity;
    // the pocket lies outside the body, not only c from its surface (a move inwards would be c away too)
    const inside = Math.abs(volumeOf(kernel.boolean('intersection', body, { ...pocket, faceIds: pocket.faceIds.map((f) => f + 1000) })));
    if (inside > 1e-3 || !(volumeOf(moved.solid) > volumeOf(body))) tooNear.push(`#${i} c ${c.toFixed(3)} chord ${chord}: the pocket overlaps the body by ${inside.toExponential(2)} mm³`);
    tally.accepted = (tally.accepted ?? 0) + 1;
    nearest = Math.min(nearest, distance / c);
    if (distance < c * (1 - ROUND_ALLOWANCE) - chord - 1e-6) tooNear.push(`#${i} c ${c.toFixed(3)} chord ${chord}: the pocket ${distance.toFixed(4)} from the body`);
  }
  console.log(`${tried} bodies: ${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(', ')}; the nearest pocket ${nearest.toFixed(3)} c`);
  expect(tooNear).toEqual([]);
  expect(tally.accepted ?? 0).toBeGreaterThan((2 / 3) * tried);
});

// Bodies of other seeds of the same generator where a round face came nearer to itself than the
// bound, which the samples did not see (the second review of the revision): refused now.
// The body of a seed and an index of the generator with its clearance and chord tolerance.
function bodyOf(seed: number, index: number): ReturnType<typeof movedOutwards> {
  const next = random(seed);
  let [chord, c, commands] = [0, 0, [] as Command[]];
  for (let i = 0; i <= index; i++) [chord, c, commands] = [[0.01, 0.003, 0.03][i % 3], Math.exp(Math.log(0.02) + next() * (Math.log(2) - Math.log(0.02))), randomBody(next)];
  const result = engineWith(chord).execute({ type: 'batch', commands });
  if (!result.ok) throw new Error(result.error.message);
  const state = result.state;
  return movedOutwards(state.evaluation.bodies.b.solid, state.evaluation.faceSurfaces.map(infoOf), state.evaluation.faceNames, c, chord, kernel);
}

// The reasons the fuzz meets that a test cannot easily build: a moved outline that crosses itself,
// a triangle turned over, an edge through a triangle (seed 4401).
test('the reasons of a refusal the fuzz meets: outline, turned, crosses', () => {
  for (const [index, reason] of [[21, 'outline'], [26, 'turned'], [288, 'crosses'], [129, 'tooNear']] as const) {
    const moved = bodyOf(4401, index);
    expect(isMoveProblem(moved) && [moved.reason, moved.faces.length > 0]).toEqual([reason, true]);
  }
});

test('a round face nearer to itself than the bound is tooNear (seeds 1, 2, 3, 5 of the fuzz)', () => {
  for (const [seed, index] of [[1, 104], [2, 234], [3, 356], [5, 371]]) {
    const next = random(seed);
    let [chord, c, commands] = [0, 0, [] as Command[]];
    for (let i = 0; i <= index; i++) [chord, c, commands] = [[0.01, 0.003, 0.03][i % 3], Math.exp(Math.log(0.02) + next() * (Math.log(2) - Math.log(0.02))), randomBody(next)];
    const result = engineWith(chord).execute({ type: 'batch', commands });
    if (!result.ok) throw new Error(result.error.message);
    const state = result.state;
    const moved = movedOutwards(state.evaluation.bodies.b.solid, state.evaluation.faceSurfaces.map(infoOf), state.evaluation.faceNames, c, chord, kernel);
    expect(isMoveProblem(moved) && moved.reason).toBe('tooNear');
  }
});

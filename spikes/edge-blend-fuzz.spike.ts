// The fuzz of the chamfer and the fillet of edges (D63, docs/d36/4b-edge-chamfer-fillet/design.md,
// "Measured", C, and "To verify"): random single edges of random bodies through the engine with the
// real adapters, each with a random chamfer and a random fillet up to about 0.4 of what fits.
// - convex prisms of 3 to 6 sides, turned and moved up to BLEND_FUZZ_FAR mm from the origin (a top
//   edge and a side edge);
// - boxes with a tapered or straight boss and a tapered or straight blind hole (the rim and the
//   foot of the boss, the rim and the bottom of the hole: planes with cylinders and cones, convex
//   and concave);
// - revolved parts (4a): a ring with a cone on its outside, its four rims;
// - tilted copies: a box turned by a circular pattern of the body about a random axis.
// Each body is made at one of the chord tolerances 0.001, 0.01 and 0.05 in turn. What counts: no
// `kernelFailure` (the adapter refused a tool, or the engine's checks found what should not be),
// and in every accepted result, checked here apart from the engine: the faces of the edge are
// there, the volume changed the way the edge says (less for a convex edge, more for a concave
// one), and no flat face of the body has gained triangles facing against it (a face turned round,
// the finding of the review of D63); the refusals are listed by their detail.
// More cases: BLEND_FUZZ_COUNT=600 (bodies), another seed: BLEND_FUZZ_SEED, farther: BLEND_FUZZ_FAR.
// The second test, the run-outs of D67 (docs/d36/4c-blend-round-ends/design.md, "Measured", R8),
// through the real step: random holes through the top-front edge of a box and random pockets
// around a bore, each blend against the same blend made before the hole or the pockets; what
// counts: every accepted run-out within 2.5 % of that reference, every refusal a bridge (the
// corner passes behind the face, or two run-outs reach across one gap), or a kernelFailure where the
// reference fails in the kernel too (far from the origin, D63's limit). More: RUN_OUT_FUZZ_COUNT
// (default 12 of each), RUN_OUT_FUZZ_SEED, RUN_OUT_FUZZ_FAR (mm, default 0: how far from the origin).
// Beyond the outside of a cylinder (the review of the implementation, B1: the void check saw nothing
// outside a cylinder of a radius larger than the chip): a slot across a shaft of radius 20 to 100
// (the top edge of its wall runs out through the shaft's side) and a hole broken out through the
// side of such a disc (its rim runs out), each against the same blend made on a larger body at the
// origin and trimmed to the cylinder afterwards (a post, if any, added after the trim). In every
// other one of these a post stands outside the cylinder where the tool runs on: the run-out is
// refused by the void check or leaves the post whole. Far from the origin (1 000 mm or more) a
// kernelFailure where the reference builds is the known limit of D67 (docs/architecture/
// edge-blend.md, "Known limits"): counted, not failed; and the cases beyond the outside of a
// cylinder are not compared with their reference there, only checked for the post.
// Run from the root of the repository: npx vitest run --config spikes/vitest.config.ts
import { expect, test } from 'vitest';
import { createEngine, emptySketch } from '../packages/engine/src/index';
import type { Command, EdgeName, Engine, EngineState, FaceName, Id, PlaneRef, Solid } from '../packages/engine/src/index';
import { createManifoldKernel } from '../packages/kernel-manifold/src/index';
import { createPlanegcsSolver } from '../packages/solver-planegcs/src/index';
import { volumeOf as solidVolume } from '../packages/engine/src/solid';

const kernel = await createManifoldKernel();
const solver = await createPlanegcsSolver();

const COUNT = Number(process.env.BLEND_FUZZ_COUNT ?? 16);
const FAR = Number(process.env.BLEND_FUZZ_FAR ?? 400);
const TOLERANCES = [0.01, 0.001, 0.05];

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rnd = random(Number(process.env.BLEND_FUZZ_SEED ?? 1));

// Per face of a body: the sum of the normals of its triangles (by area) and its area.
function faceNormals(state: EngineState, body: Id): Map<string, { normal: number[]; area: number; triangles: number[][] }> {
  const s = state.evaluation.bodies[body].solid;
  const p = s.positions;
  const out = new Map<string, { normal: number[]; area: number; triangles: number[][] }>();
  for (let t = 0; t < s.faceIds.length; t++) {
    const [i, j, k] = [s.triangles[3 * t], s.triangles[3 * t + 1], s.triangles[3 * t + 2]];
    const u = [0, 1, 2].map((d) => p[3 * j + d] - p[3 * i + d]);
    const v = [0, 1, 2].map((d) => p[3 * k + d] - p[3 * i + d]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const key = JSON.stringify(state.evaluation.faceNames[s.faceIds[t]]);
    const entry = out.get(key) ?? { normal: [0, 0, 0], area: 0, triangles: [] };
    entry.normal = entry.normal.map((x, d) => x + n[d] / 2);
    entry.area += Math.hypot(n[0], n[1], n[2]) / 2;
    entry.triangles.push(n);
    out.set(key, entry);
  }
  return out;
}

// What is wrong with an accepted result, checked apart from the engine; undefined when nothing.
function wrongResult(before: EngineState, after: EngineState, body: Id, edge: EdgeName, convex: boolean): string | undefined {
  const old = faceNormals(before, body);
  const now = faceNormals(after, body);
  for (const face of [edge.a, edge.b]) if (!now.has(JSON.stringify(face))) return `the face ${JSON.stringify(face)} of the edge is gone`;
  const change = after.evaluation.bodies[body].volume - before.evaluation.bodies[body].volume;
  if (convex ? change >= 0 : change <= 0) return `the volume changed by ${change} at a ${convex ? 'convex' : 'concave'} edge`;
  for (const [key, was] of old) {
    if (Math.hypot(...was.normal) < 0.999 * was.area) continue; // flat faces only
    const is = now.get(key);
    if (!is) continue;
    // what faces against the face, against what did before (a body far out may have some already)
    const against = (triangles: number[][]): number => triangles.reduce((sum, n) => (n[0] * was.normal[0] + n[1] * was.normal[1] + n[2] * was.normal[2] < 0 ? sum + Math.hypot(n[0], n[1], n[2]) / 2 : sum), 0);
    const gained = against(is.triangles) - against(was.triangles);
    if (gained > 1e-3) return `${gained.toFixed(4)} mm² more of ${key} face against it`;
  }
  return undefined;
}

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const XZ: PlaneRef = { kind: 'base', plane: 'XZ' };
const side = (feature: Id, curve: Id): FaceName => ({ feature, role: 'side', curve });
const cap = (feature: Id, role: 'startCap' | 'endCap' = 'endCap'): FaceName => ({ feature, role });
const sketch = (id: Id, plane: PlaneRef): Command => ({ type: 'addFeature', feature: emptySketch(id, id, plane) });
const polygon = (s: Id, points: [number, number][], prefix = ''): Command => ({
  type: 'batch',
  commands: [
    ...points.map(([x, y], i): Command => ({ type: 'addPoint', sketch: s, id: `${prefix}p${i}`, x, y })),
    ...points.map((_, i): Command => ({ type: 'addCurve', sketch: s, id: `${prefix}l${i}`, curve: { type: 'line', a: `${prefix}p${i}`, b: `${prefix}p${(i + 1) % points.length}` } })),
  ],
});
const loop = (n: number, prefix = ''): Id[] => Array.from({ length: n }, (_, i) => `${prefix}l${i}`);
const circle = (s: Id, id: Id, x: number, y: number, radius: number): Command => ({ type: 'batch', commands: [{ type: 'addPoint', sketch: s, id: `${id}c`, x, y }, { type: 'addCurve', sketch: s, id, curve: { type: 'circle', center: `${id}c` }, radius }] });
const extrude = (id: Id, s: Id, outer: Id[], distance: number, operation: 'new' | 'add' | 'cut' = 'new', taper?: number): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: s, regions: [{ outerLoop: [...outer].sort() }] }, extent: { type: 'distance', start: 0, distance, ...(taper ? { taper } : {}) }, operation, ...(operation === 'new' ? {} : { targets: ['E'] }) },
});

interface Case {
  label: string;
  engine: Engine;
  body: Id;
  edge: EdgeName;
  limit: number; // a size that fits about
}

function newEngine(chordTolerance: number): Engine {
  const engine = createEngine({ solver, kernel });
  const state = engine.getState();
  const loaded = engine.load(JSON.stringify({ ...state.document, settings: { ...state.document.settings, chordTolerance } }));
  if (!loaded.ok) throw new Error(loaded.error.message);
  return engine;
}
function run(engine: Engine, ...commands: Command[]): EngineState | undefined {
  for (const command of commands) {
    const result = engine.execute(command);
    if (!result.ok) throw new Error(result.error.message);
  }
  const state = engine.getState();
  return state.document.features.every((f) => state.evaluation.features[f.id].status === 'ok') ? state : undefined;
}

function prism(i: number, tolerance: number): Case[] {
  const engine = newEngine(tolerance);
  const far = rnd() < 0.5 ? 0 : FAR * rnd();
  const n = 3 + Math.floor(rnd() * 4);
  const radius = 10 + 30 * rnd();
  const turn = rnd() * 2 * Math.PI;
  const points: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = turn + (2 * Math.PI * (k + 0.3 * (rnd() - 0.5))) / n;
    points.push([far + radius * Math.cos(a), far * 0.7 + radius * Math.sin(a)]);
  }
  const height = 5 + 30 * rnd();
  if (!run(engine, sketch('s', XY), polygon('s', points), extrude('E', 's', loop(n), height))) return [];
  const k = Math.floor(rnd() * n);
  const sideLength = Math.hypot(points[(k + 1) % n][0] - points[k][0], points[(k + 1) % n][1] - points[k][1]);
  const limit = 0.4 * Math.min(height, radius * 0.5, sideLength);
  return [
    { label: `prism${i} top far ${far.toFixed(0)}`, engine, body: 'E', edge: { a: cap('E'), b: side('E', `l${k}`) }, limit },
    { label: `prism${i} vertical far ${far.toFixed(0)}`, engine, body: 'E', edge: { a: side('E', `l${k}`), b: side('E', `l${(k + 1) % n}`) }, limit: limit * 0.5 },
  ];
}

function bossAndHole(i: number, tolerance: number): Case[] {
  const engine = newEngine(tolerance);
  const far = rnd() < 0.5 ? 0 : FAR * rnd();
  const [w, d, h] = [40 + 40 * rnd(), 40 + 40 * rnd(), 10 + 20 * rnd()];
  const [x0, y0] = [far + 1, far * 0.7 + 1];
  const r = 4 + 6 * rnd();
  const taper = rnd() < 0.3 ? 0 : 0.4 * (rnd() - 0.5);
  const height = 5 + 10 * rnd();
  const hr = 2 + 3 * rnd();
  const htaper = rnd() < 0.3 ? 0 : 0.3 * (rnd() - 0.5);
  const made = run(
    engine,
    sketch('s', XY),
    polygon('s', [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]]),
    extrude('E', 's', loop(4), h),
    sketch('t', { kind: 'face', body: 'E', face: cap('E') }),
    circle('t', 'b', x0 + w / 4, y0 + d / 2, r),
    circle('t', 'h', x0 + (3 * w) / 4, y0 + d / 2, hr),
    extrude('B', 't', ['b'], height, 'add', taper),
    extrude('H', 't', ['h'], -h * 0.6, 'cut', htaper),
  );
  if (!made) return [];
  const limit = 0.35 * Math.min(r - height * Math.abs(Math.tan(taper)), height, hr);
  if (limit <= 0.05) return [];
  const label = `box${i} far ${far.toFixed(0)} taper ${taper.toFixed(2)}/${htaper.toFixed(2)}`;
  return [
    { label: `${label} boss top`, engine, body: 'E', edge: { a: cap('B'), b: side('B', 'b') }, limit },
    { label: `${label} boss foot`, engine, body: 'E', edge: { a: cap('E'), b: side('B', 'b') }, limit },
    { label: `${label} hole rim`, engine, body: 'E', edge: { a: cap('E'), b: side('H', 'h') }, limit },
    { label: `${label} hole bottom`, engine, body: 'E', edge: { a: cap('H'), b: side('H', 'h') }, limit },
  ];
}

// A ring turned about Z: its inside a cylinder, its outside a cylinder and a cone.
function turned(i: number, tolerance: number): Case[] {
  const engine = newEngine(tolerance);
  const [inner, outer, h1, h2, step] = [3 + 5 * rnd(), 15 + 10 * rnd(), 4 + 6 * rnd(), 12 + 8 * rnd(), 2 + 4 * rnd()];
  const points: [number, number][] = [[inner, 0], [outer, 0], [outer, h1], [outer - step, h2], [inner, h2]];
  const made = run(engine, sketch('s', XZ), polygon('s', points), {
    type: 'addFeature',
    feature: { id: 'E', name: 'E', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: loop(5) }] }, axis: { kind: 'base', axis: 'Z' }, extent: { type: 'full' }, operation: 'new' },
  });
  if (!made) return [];
  const limit = 0.35 * Math.min(h1, h2 - h1, step, outer - inner);
  return [0, 1, 2, 3, 4].map((k) => ({ label: `ring${i} l${k}/l${(k + 1) % 5}`, engine, body: 'E', edge: { a: side('E', `l${k}`), b: side('E', `l${(k + 1) % 5}`) }, limit }));
}

// A box turned by a circular pattern of the body about a random axis through the origin.
function tilted(i: number, tolerance: number): Case[] {
  const engine = newEngine(tolerance);
  const angle = 0.2 + 1.2 * rnd();
  const axis = (['X', 'Y'] as const)[Math.floor(rnd() * 2)];
  const made = run(engine, sketch('s', XY), polygon('s', [[5, 5], [45, 5], [45, 35], [5, 35]]), extrude('E', 's', loop(4), 20), {
    type: 'addFeature',
    feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'E' }, transform: { type: 'circular', axis: { kind: 'base', axis }, count: 2, span: { type: 'angle', angle } } },
  });
  if (!made) return [];
  const copy = (name: FaceName): FaceName => ({ ...name, copy: [{ pattern: 'P', index: 1 }] });
  return [
    { label: `tilted${i} top`, engine, body: 'P/1', edge: { a: copy(cap('E')), b: copy(side('E', 'l0')) }, limit: 6 },
    { label: `tilted${i} vertical`, engine, body: 'P/1', edge: { a: copy(side('E', 'l1')), b: copy(side('E', 'l2')) }, limit: 6 },
  ];
}

test('the fuzz of single edges', () => {
  const cases: Case[] = [];
  for (let i = 0; i < COUNT; i++) {
    const tolerance = TOLERANCES[i % TOLERANCES.length];
    const make = [prism, bossAndHole, turned, tilted][i % 4];
    cases.push(...make(i, tolerance));
  }
  const outcomes = new Map<string, number>();
  const failures: string[] = [];
  const examples = new Map<string, string[]>();
  const started = performance.now();
  for (const c of cases) {
    for (const kind of ['chamfer', 'fillet'] as const) {
      const size = Number(((0.05 + 0.95 * rnd()) * c.limit).toFixed(4));
      const feature = { id: 'blend', name: 'blend', suppressed: false, type: kind, body: c.body, edges: [c.edge], ...(kind === 'chamfer' ? { distance: size } : { radius: size }) };
      const result = c.engine.preview({ type: 'addFeature', feature } as Command);
      if (!result.ok) throw new Error(`${c.label}: ${result.error.message}`);
      const outcome = result.state.evaluation.features.blend;
      if (outcome.status === 'ok') {
        const wrong = wrongResult(c.engine.getState(), result.state, c.body, c.edge, result.state.evaluation.features.blend.facts?.['cut/0'] === true);
        if (wrong) failures.push(`${c.label} ${kind} ${size}: accepted, but ${wrong}`);
      }
      const key = outcome.error ? `${outcome.error.code}: ${outcome.error.message.replace(/^[^(]*\(/, '(').replace(/[0-9.]+ mm/g, 'N mm')}` : outcome.status;
      outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
      if (outcome.error) examples.set(key, [...(examples.get(key) ?? []), `${c.label} ${kind} ${size}`].slice(0, 5));
      if (outcome.error?.code === 'kernelFailure') failures.push(`${c.label} ${kind} ${size}: ${outcome.error.message}`);
    }
  }
  console.log(`${cases.length} edges, ${2 * cases.length} features, ${((performance.now() - started) / 1000).toFixed(1)} s`);
  for (const [key, count] of [...outcomes].sort((x, y) => y[1] - x[1])) console.log(`${count} × ${key}${examples.has(key) ? `: ${examples.get(key)?.join('; ')}` : ''}`);
  if (failures.length) console.log(failures.slice(0, 20).join('\n'));
  expect(failures).toEqual([]);
});

// ---------------------------------------------------------------- run-outs (D67, R8 of the design)

test('the fuzz of run-outs: holes through the edge of a box, pockets around a bore', () => {
  const next = random(Number(process.env.RUN_OUT_FUZZ_SEED ?? 1));
  // the cases beyond the outside of a cylinder draw from a stream of their own, so the holes and the
  // pockets stay those of the seed as measured before them
  const other = random(Number(process.env.RUN_OUT_FUZZ_SEED ?? 1) + 7919);
  const count = Number(process.env.RUN_OUT_FUZZ_COUNT ?? 12);
  const far = Number(process.env.RUN_OUT_FUZZ_FAR ?? 0);
  const blendOf = (kind: 'chamfer' | 'fillet', id: Id, edge: EdgeName, size: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: kind, body: 'E', edges: [edge], ...(kind === 'chamfer' ? { distance: size } : { radius: size }) } as never });
  const volumeOf = (engine: Engine | undefined): number | undefined => (engine ? engine.getState().evaluation.bodies.E?.volume : undefined);
  const made = (engine: Engine, ...commands: Command[]): Engine | undefined => (run(engine, ...commands) ? engine : undefined);
  // a box 60 × 40 × h with a hole of radius r at (30, yc) through it
  const holed = (tolerance: number, r: number, yc: number, h: number, before: Command[] = []): Engine | undefined => {
    const engine = newEngine(tolerance);
    if (!run(engine, sketch('s', XY), polygon('s', [[far, far], [far + 60, far], [far + 60, far + 40], [far, far + 40]]), extrude('E', 's', loop(4), h))) return undefined;
    if (before.length && !run(engine, ...before)) return undefined;
    return made(engine, sketch('h', { kind: 'face', body: 'E', face: cap('E') }), circle('h', 'c', far + 30, far + yc, r), extrude('H', 'h', ['c'], -h - 5, 'cut'));
  };
  // a plate with a bore R 29.5 and n pockets of radius r on the circle `at`, 4 deep
  const pocketed = (tolerance: number, n: number, r: number, at: number, before: Command[] = []): Engine | undefined => {
    const engine = newEngine(tolerance);
    if (!run(engine, sketch('s', XY), polygon('s', [[far - 40, far - 40], [far + 40, far - 40], [far + 40, far + 40], [far - 40, far + 40]]), extrude('E', 's', loop(4), 8), sketch('b', { kind: 'face', body: 'E', face: cap('E') }), circle('b', 'h', far, far, 29.5), extrude('H', 'b', ['h'], -10, 'cut'))) return undefined;
    if (before.length && !run(engine, ...before)) return undefined;
    const pockets = Array.from({ length: n }, (_, k) => circle('p', `k${k}`, far + at * Math.cos((2 * Math.PI * k) / n), far + at * Math.sin((2 * Math.PI * k) / n), r));
    return made(engine, sketch('p', { kind: 'face', body: 'E', face: cap('E') }), ...pockets, {
      type: 'addFeature',
      feature: { id: 'P', name: 'P', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'p', regions: Array.from({ length: n }, (_, k) => ({ outerLoop: [`k${k}`] })) }, extent: { type: 'distance', start: 0, distance: -4 }, operation: 'cut', targets: ['E'] },
    });
  };
  // the cut of the ring between the radii `inner` and `outer` about (at, at), through all: what
  // trims a reference made on a larger body to the cylinder of radius `inner`
  const trimmed = (inner: number, outer: number, at: number): Command[] => [
    sketch('o', XY),
    circle('o', 'oi', at, at, inner),
    circle('o', 'oj', at, at, outer),
    { type: 'addFeature', feature: { id: 'O', name: 'O', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'o', regions: [{ outerLoop: ['oj'] }] }, extent: { type: 'throughAll', side: 'both' }, operation: 'cut', targets: ['E'] } },
  ];
  // a post, a square of half side h about (x, y) relative to (at, at), standing on XY `height`
  // high, added to E; and a probe a little larger than it about (far, far), a solid apart, to
  // measure what of it is left
  interface Post {
    commands: (at: number) => Command[];
    probe: Solid;
  }
  const postAt = (x: number, y: number, h: number, height: number): Post => {
    const square = (g: number, at = far): [number, number][] => [[at + x - g, at + y - g], [at + x + g, at + y - g], [at + x + g, at + y + g], [at + x - g, at + y + g]];
    const engine = newEngine(0.01);
    const probe = run(engine, sketch('q', XY), polygon('q', square(h + 0.04), 'q'), { type: 'addFeature', feature: { id: 'E', name: 'E', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'q', regions: [{ outerLoop: loop(4, 'q').sort() }] }, extent: { type: 'distance', start: -1, distance: height + 2 }, operation: 'new' } });
    if (!probe) throw new Error('the probe of a post');
    return { commands: (at) => [sketch('q', XY), polygon('q', square(h, at), 'q'), extrude('Q', 'q', loop(4, 'q'), height, 'add')], probe: probe.evaluation.bodies.E.solid };
  };
  const postLeft = (state: EngineState, post: Post): number => solidVolume(kernel.boolean('intersection', state.evaluation.bodies.E.solid, post.probe));
  const tally = new Map<string, number>();
  const failures: string[] = [];
  const known: string[] = [];
  let worst = 0;
  let worstLabel = '';
  // `unblended`: the reference's own model without the blend, where it is made otherwise than the
  // model (trimmed, and at the origin)
  const check = (label: string, engine: Engine | undefined, reference: () => Engine | undefined, kind: 'chamfer' | 'fillet', edge: EdgeName, size: number, post?: Post, unblended?: () => Engine | undefined): void => {
    if (!engine) return void tally.set('model refused', (tally.get('model refused') ?? 0) + 1);
    const result = engine.preview(blendOf(kind, 'blend', edge, size));
    if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
    const outcome = result.state.evaluation.features.blend;
    let key = outcome.status === 'ok' ? 'ok' : /passes behind|reach across the gap/.test(outcome.error?.message ?? '') ? 'bridge' : `${outcome.error?.code}: ${outcome.error?.message.replace(/^[^(]*\(/, '(')}`;
    // far from the origin the kernel refuses some blends of round faces made before the void too
    // (a known limit of D63): that is no failure of the run-out
    if (outcome.error?.code === 'kernelFailure' && volumeOf(reference()) === undefined) key = 'kernelFailure, the reference too';
    // 1 000 mm out and farther the kernel refuses some run-outs whose reference builds (D67's
    // known limit, 2 of 11 pocket cases at 2 000 mm): counted, not failed
    else if (outcome.error?.code === 'kernelFailure' && far >= 1000) {
      key = 'kernelFailure far out, the reference builds (known)';
      known.push(`${label}: ${outcome.error.message}`);
    }
    // with a post where the tool runs on: the void check's refusal is right
    if (post && outcome.error?.code === 'blendDoesNotFit' && /beyond the end face in refs within its run-out/.test(outcome.error.message)) key = 'post refused';
    if (post && key === 'ok') {
      const lost = postLeft(engine.getState(), post) - postLeft(result.state, post);
      if (lost > 1e-4) failures.push(`${label}: accepted, the post cut by ${lost.toFixed(5)} mm³`);
      key = 'ok, the post whole';
    }
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (!['ok', 'ok, the post whole', 'bridge', 'post refused', 'kernelFailure, the reference too', 'kernelFailure far out, the reference builds (known)'].includes(key)) failures.push(`${label}: ${key}`);
    if (key !== 'ok' && key !== 'ok, the post whole') return;
    // 1 000 mm out D63's blends themselves differ from those at the origin by up to a fifth (a
    // fillet of a box's straight edge 1.0 at 0.05: 0.184 mm³ per mm against 0.237), and the trimmed
    // references are made at the origin: those run-outs are checked for the post only
    if (unblended && far >= 1000) return void tally.set('of the ok, far out, not compared', (tally.get('of the ok, far out, not compared') ?? 0) + 1);
    const [plain, blended, before] = [volumeOf(engine), volumeOf(reference()), unblended ? volumeOf(unblended()) : volumeOf(engine)];
    if (plain === undefined || blended === undefined || before === undefined) return void tally.set('reference refused', (tally.get('reference refused') ?? 0) + 1);
    const taken = (plain as number) - result.state.evaluation.bodies.E.volume;
    const relative = Math.abs(taken - (before - blended)) / Math.max(Math.abs(before - blended), 1e-9);
    if (relative > worst) [worst, worstLabel] = [relative, label];
    if (relative > 0.025) failures.push(`${label}: ${taken.toFixed(4)} against the reference ${(before - blended).toFixed(4)}`);
  };
  const started = performance.now();
  for (let i = 0; i < count; i++) {
    const tolerance = TOLERANCES[i % TOLERANCES.length];
    {
      const r = 1 + 5 * next();
      const phi = ((12 + 78 * next()) * Math.PI) / 180;
      const yc = (next() < 0.5 ? 1 : -1) * r * Math.cos(phi);
      const h = 8 + 20 * next();
      const kind = next() < 0.5 ? 'chamfer' : 'fillet';
      const size = Number((0.2 + 2.3 * next()).toFixed(3));
      const edge: EdgeName = { a: cap('E'), b: side('E', 'l0') };
      check(`hole r ${r.toFixed(2)} at ${((phi * 180) / Math.PI).toFixed(1)}° ${kind} ${size} tol ${tolerance}`, holed(tolerance, r, yc, h), () => holed(tolerance, r, yc, h, [blendOf(kind, 'C', edge, size)]), kind, edge, size);
    }
    {
      const n = 3 + Math.floor(17 * next());
      const at = 29.5 + (next() * 2 - 1);
      const r = Math.min(1 + 3 * next(), 0.45 * ((2 * Math.PI * at) / n));
      const kind = next() < 0.5 ? 'chamfer' : 'fillet';
      const size = Number((0.2 + 1.3 * next()).toFixed(3));
      if (Math.abs(at - 29.5) >= r - 0.2) continue;
      const edge: EdgeName = { a: cap('E'), b: side('H', 'h') };
      check(`${n} pockets r ${r.toFixed(2)} at ${at.toFixed(2)} ${kind} ${size} tol ${tolerance}`, pocketed(tolerance, n, r, at), () => pocketed(tolerance, n, r, at, [blendOf(kind, 'C', edge, size)]), kind, edge, size);
    }
    {
      // a shaft of radius R, H high, a slot from y = R − 3 − w to R − 3 across its top, `depth` deep;
      // the reference: a box with the slot, the blend, trimmed to the shaft, at the origin (far out
      // the kernel's blend of the box is off by up to a fifth)
      const R = 20 + 80 * other();
      const [w, H] = [2 + 3 * other(), 10 + 20 * other()];
      const kind = other() < 0.5 ? 'chamfer' : 'fillet';
      const size = Number((0.3 + 2.2 * other()).toFixed(3));
      const depth = size + 1 + 3 * other();
      const withPost = i % 2 === 1;
      const slot = (half: number, at: number): Command[] => [sketch('t', { kind: 'face', body: 'E', face: cap('E') }), polygon('t', [[at - half, at + R - 3 - w], [at + half, at + R - 3 - w], [at + half, at + R - 3], [at - half, at + R - 3]], 't'), extrude('S', 't', loop(4, 't'), -depth, 'cut')];
      const shaft = (extra: Command[]): Engine | undefined => made(newEngine(tolerance), sketch('s', XY), circle('s', 'c', far, far, R), extrude('E', 's', ['c'], H), ...slot(R + 5, far), ...extra);
      const box = (before: Command[], after: Command[]): Engine | undefined => made(newEngine(tolerance), sketch('s', XY), polygon('s', [[-R - 10, -R - 10], [R + 10, -R - 10], [R + 10, R + 10], [-R - 10, R + 10]]), extrude('E', 's', loop(4), H), ...slot(R + 15, 0), ...before, ...trimmed(R, 2 * R + 30, 0), ...after);
      const edge: EdgeName = { a: cap('E'), b: side('S', 'tl2') };
      // the post: across the profile's middle (y = R − 3 + 0.45 size), its nearest corner R + 0.2
      // from the axis, before the wall's edge leaves the cylinder (where the tool still runs on)
      const h = Math.min(0.15, 0.2 * size);
      const y = R - 3 + 0.45 * size;
      const x = Math.sqrt((R + 0.2) ** 2 - (y - h) ** 2) + h;
      const post = withPost && x + h < Math.sqrt(R * R - (R - 3) ** 2) ? postAt(x, y, h, H) : undefined;
      check(`shaft R ${R.toFixed(1)} slot ${w.toFixed(2)} × ${depth.toFixed(2)} ${kind} ${size} tol ${tolerance}${post ? ' post' : ''}`, shaft(post?.commands(far) ?? []), () => box([blendOf(kind, 'C', edge, size)], post?.commands(0) ?? []), kind, edge, size, post, () => box([], post?.commands(0) ?? []));
    }
    {
      // a disc of radius R, H high, a hole of radius r at R − d (d < r) broken out through its side;
      // the reference: a larger disc with the hole, the blend, trimmed to R, at the origin
      const R = 20 + 80 * other();
      const r = 1.5 + 4.5 * other();
      const d = r * (0.2 + 0.6 * other());
      const H = 6 + 14 * other();
      const kind = other() < 0.5 ? 'chamfer' : 'fillet';
      const size = Number((0.3 + Math.min(2, H / 3, r / 2) * other()).toFixed(3));
      const withPost = i % 2 === 0;
      const D = R - d;
      // the angle the hole's circle crosses the disc's: under 15° the run-out is no case here
      const radii = Math.acos((R * R + r * r - D * D) / (2 * R * r));
      if (Math.min(radii, Math.PI - radii) < (15 * Math.PI) / 180) continue;
      const hole = (big: number, at: number, extra: Command[]): Engine | undefined => made(newEngine(tolerance), sketch('s', XY), circle('s', 'c', at, at, big), extrude('E', 's', ['c'], H), sketch('h', { kind: 'face', body: 'E', face: cap('E') }), circle('h', 'b', at + D, at, r), extrude('H', 'h', ['b'], -H - 5, 'cut'), ...extra);
      const edge: EdgeName = { a: cap('E'), b: side('H', 'b') };
      // the post: on the circle about the hole's centre across the profile's middle (r + 0.45 size),
      // where it is R + 0.2 + its half diagonal from the disc's axis, if it is clear of the hole
      const h = Math.min(0.15, 0.2 * size);
      const rho = r + 0.45 * size;
      const far0 = R + 0.2 + h * Math.SQRT2;
      const cos = (far0 * far0 - D * D - rho * rho) / (2 * D * rho);
      const post = withPost && Math.abs(cos) <= 1 && rho - h * Math.SQRT2 > r + 0.05 ? postAt(D + rho * cos, rho * Math.sqrt(1 - cos * cos), h, H) : undefined;
      check(`disc R ${R.toFixed(1)} hole r ${r.toFixed(2)} in ${d.toFixed(2)} ${kind} ${size} tol ${tolerance}${post ? ' post' : ''}`, hole(R, far, post?.commands(far) ?? []), () => hole(R + r + 10, 0, [blendOf(kind, 'C', edge, size), ...trimmed(R, 2 * R + 40, 0), ...(post?.commands(0) ?? [])]), kind, edge, size, post, () => hole(R + r + 10, 0, [...trimmed(R, 2 * R + 40, 0), ...(post?.commands(0) ?? [])]));
    }
  }
  console.log(`run-outs: ${JSON.stringify(Object.fromEntries(tally))}, the largest difference from the reference ${(100 * worst).toFixed(2)} % (${worstLabel}), ${((performance.now() - started) / 1000).toFixed(1)} s`);
  if (known.length) console.log(`known:\n${known.join('\n')}`);
  if (failures.length) console.log(failures.slice(0, 20).join('\n'));
  expect(failures).toEqual([]);
  expect((tally.get('ok') ?? 0) + (tally.get('ok, the post whole') ?? 0)).toBeGreaterThanOrEqual(count / 2);
});

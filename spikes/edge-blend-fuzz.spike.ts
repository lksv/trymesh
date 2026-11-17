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
// Run from the root of the repository: npx vitest run --config spikes/vitest.config.ts
import { expect, test } from 'vitest';
import { createEngine, emptySketch } from '../packages/engine/src/index';
import type { Command, EdgeName, Engine, EngineState, FaceName, Id, PlaneRef } from '../packages/engine/src/index';
import { createManifoldKernel } from '../packages/kernel-manifold/src/index';
import { createPlanegcsSolver } from '../packages/solver-planegcs/src/index';

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

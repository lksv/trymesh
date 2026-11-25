// Random tests of the adapter with tapered tools (D45): frustums of rectangles and of regular
// polygons (the cone of a circle), added to and cut from a box in a general position. Their tilted
// sides often lie in one plane with a tilted side of an earlier tool (a boss continued by another
// one with the same taper, a pocket with the draft of the boss it is cut into) and their caps lie
// flush with faces of the box. The generator of fuzz.ts is left as it is, so that its seeds keep
// their cases. The oracle is the volume from cross sections: the outline of every tool at a level
// is its near ring moved towards its far ring, and the area between the levels where a tool starts
// or ends is integrated by Simpson's rule.
import type { Solid } from '@trymesh/engine';
import { type Random, randomFrame, rng } from './fuzz';
import { IDENTITY, type Loop, type TestFrame, describe, inspect, kernel, prism } from './testkit';

export interface TaperOp {
  op: 'union' | 'difference';
  kind: 'box' | 'frustum' | 'cone';
  low: Loop; // the outline at w0, counter-clockwise
  high: Loop; // the outline at w1, the same number of points
  w0: number;
  w1: number;
  id: number;
}
export interface TaperCase {
  frame: TestFrame;
  ops: TaperOp[];
}

const pick = <T>(r: Random, items: T[]): T => items[Math.floor(r() * items.length)];
const DEG = Math.PI / 180;
const grown = (loop: Loop, by: number): Loop => {
  // a rectangle moved outwards on every side
  const [x0, y0] = loop[0];
  const [x1, y1] = loop[2];
  return [[x0 - by, y0 - by], [x1 + by, y0 - by], [x1 + by, y1 + by], [x0 - by, y1 + by]];
};
const rectangle = (x0: number, y0: number, x1: number, y1: number): Loop => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const polygon = (cx: number, cy: number, radius: number, n: number): Loop => Array.from({ length: n }, (_, i): [number, number] => [cx + radius * Math.cos((2 * Math.PI * i) / n), cy + radius * Math.sin((2 * Math.PI * i) / n)]);

// A closed mesh between two rings of the same count: the caps triangulated each on its own, two
// triangles per edge between them (the build of recompute/tool-stack.ts with two rings).
export function frustum(frame: TestFrame, low: Loop, high: Loop, w0: number, w1: number, id: number): Solid {
  const n = low.length;
  const positions: number[] = [];
  const triangles: number[] = [];
  const faceIds: number[] = [];
  for (const [loop, w] of [[low, w0], [high, w1]] as const) for (const [u, v] of loop) for (let k = 0; k < 3; k++) positions.push(frame.o[k] + u * frame.x[k] + v * frame.y[k] + w * frame.n[k]);
  const lowCap = kernel.triangulate([Float64Array.from(low.flat())]);
  for (let t = 0; t < lowCap.length; t += 3) triangles.push(lowCap[t], lowCap[t + 2], lowCap[t + 1]), faceIds.push(id + 1);
  const highCap = kernel.triangulate([Float64Array.from(high.flat())]);
  for (let t = 0; t < highCap.length; t += 3) triangles.push(n + highCap[t], n + highCap[t + 1], n + highCap[t + 2]), faceIds.push(id + 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    triangles.push(i, j, n + j, i, n + j, n + i);
    faceIds.push(id + 3 + (n === 4 ? i : 0), id + 3 + (n === 4 ? i : 0));
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faceIds) };
}

export function generateTapered(seed: number): TaperCase {
  const r = rng(seed);
  const frame = randomFrame(r);
  const base = rectangle(0, 0, 40, 30);
  const ops: TaperOp[] = [{ op: 'union', kind: 'box', low: base, high: base, w0: 0, w1: 10, id: 100 }];
  const count = 1 + Math.floor(r() * 3);
  const cones: { cx: number; cy: number }[] = [];
  for (let n = 1; n <= count; n++) {
    const id = 100 * (n + 1);
    const taper = pick(r, [3, 10, 30, 45]) * DEG * (r() < 0.5 ? 1 : -1);
    const roll = r();
    const previous = ops[ops.length - 1];
    if (roll < 0.25 && previous.kind === 'frustum') {
      // The same planes again. The outline of the previous tool at a level, along its own slope:
      // a boss continued above its far end, the upper part of a boss cut away, or the lower part of
      // a pocket filled again. The new tilted sides lie in the planes of the old ones.
      const slope = (previous.high[1][0] - previous.low[1][0]) / (previous.w1 - previous.w0);
      const at = (w: number): Loop => grown(previous.low, slope * (w - previous.w0));
      const middle = (previous.w0 + previous.w1) / 2;
      const sound = (loop: Loop) => loop[1][0] - loop[0][0] > 1 && loop[2][1] - loop[1][1] > 1;
      let next: TaperOp;
      if (previous.op === 'difference') next = { op: 'union', kind: 'frustum', low: previous.low, high: at(middle), w0: previous.w0, w1: middle, id };
      else if (r() < 0.5) next = { op: 'union', kind: 'frustum', low: previous.high, high: at(previous.w1 + 3), w0: previous.w1, w1: previous.w1 + 3, id };
      else next = { op: 'difference', kind: 'frustum', low: at(middle), high: at(previous.w1 + 1), w0: middle, w1: previous.w1 + 1, id };
      if (sound(next.low) && sound(next.high)) ops.push(next);
      continue;
    }
    if (roll < 0.55) {
      // a cone: a regular polygon on the top face or the bottom face, added or cut
      const cx = pick(r, [10, 20, 30]);
      const cy = pick(r, [10, 15, 20]);
      if (cones.some((cone) => cone.cx === cx && cone.cy === cy)) continue;
      cones.push({ cx, cy });
      const radius = pick(r, [3, 5]);
      const sides = pick(r, [24, 32]);
      const h = pick(r, [2, 3]);
      const shift = h * Math.tan(taper);
      if (radius + shift <= 0.5) continue;
      const fromTop = r() < 0.5;
      const op = r() < 0.5 ? 'union' : 'difference';
      // from the top: the near ring on the face, the tool going up (a boss) or down (a cut)
      const [w0, w1] = fromTop ? (op === 'union' ? [10, 10 + h] : [10 - h, 10]) : op === 'union' ? [-h, 0] : [0, h];
      const nearAtLow = (fromTop && op === 'union') || (!fromTop && op === 'difference');
      const [near, far] = [polygon(cx, cy, radius, sides), polygon(cx, cy, radius + shift, sides)];
      ops.push({ op, kind: 'cone', low: nearAtLow ? near : far, high: nearAtLow ? far : near, w0, w1, id });
      continue;
    }
    // a tapered rectangle on the top face: a boss up or a pocket down, its near outline on the face
    const x0 = pick(r, [5, 10, 15]);
    const y0 = pick(r, [5, 10]);
    const near = rectangle(x0, y0, x0 + pick(r, [10, 15, 20]), y0 + pick(r, [10, 15]));
    const h = pick(r, [2, 4, 5]);
    const shift = h * Math.tan(taper);
    const far = grown(near, shift);
    if (far[1][0] - far[0][0] <= 1 || far[2][1] - far[1][1] <= 1) continue;
    if (r() < 0.5) ops.push({ op: 'union', kind: 'frustum', low: near, high: far, w0: 10, w1: 10 + h, id });
    else ops.push({ op: 'difference', kind: 'frustum', low: far, high: near, w0: 10 - h, w1: 10, id });
  }
  return { frame, ops };
}

// The volume from cross sections.
export function taperOracle(ops: TaperOp[]): number {
  const { CrossSection } = kernel.wasm;
  type Section = InstanceType<typeof CrossSection>;
  const owned: Section[] = [];
  const keep = (s: Section) => {
    owned.push(s);
    return s;
  };
  const areaAt = (w: number): number => {
    let section: Section | null = null;
    for (const op of ops) {
      if (!(op.w0 <= w && w <= op.w1)) continue;
      const t = (w - op.w0) / (op.w1 - op.w0);
      const loop = op.low.map(([u, v], i): [number, number] => [u + t * (op.high[i][0] - u), v + t * (op.high[i][1] - v)]);
      const p = keep(new CrossSection([loop]));
      section = section === null ? (op.op === 'difference' ? null : p) : keep(op.op === 'union' ? section.add(p) : section.subtract(p));
    }
    return section ? section.area() : 0;
  };
  try {
    const levels = [...new Set(ops.flatMap((op) => [op.w0, op.w1]))].sort((a, b) => a - b);
    let volume = 0;
    const steps = 32;
    const inset = 1e-9; // a level where a tool starts or ends is taken from inside the interval
    for (let i = 0; i + 1 < levels.length; i++) {
      const [a, b] = [levels[i] + inset, levels[i + 1] - inset];
      const h = (b - a) / steps;
      let sum = areaAt(a) + areaAt(b);
      for (let k = 1; k < steps; k++) sum += (k % 2 ? 4 : 2) * areaAt(a + k * h);
      volume += (sum * h) / 3;
    }
    return volume;
  } finally {
    for (const s of owned) s.delete();
  }
}

export function runTapered(c: TaperCase, frame: TestFrame = c.frame): Solid {
  let body: Solid | null = null;
  for (const op of c.ops) {
    const tool = op.kind === 'box' ? prism(frame, op.low, op.w0, op.w1, { start: op.id + 1, end: op.id + 2, sides: [op.id + 3, op.id + 4, op.id + 5, op.id + 6] }) : frustum(frame, op.low, op.high, op.w0, op.w1, op.id);
    body = body === null ? tool : kernel.boolean(op.op, body, tool);
  }
  return body as Solid;
}

// The problems of a case; an error of the adapter of its own (a mesh that is not closed or folded)
// is counted in `rejected` instead.
export function checkTapered(seed: number, rejected?: { count: number }): string[] {
  const c = generateTapered(seed);
  let out: Solid;
  try {
    out = runTapered(c);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (rejected && /not a closed surface|folded triangle/.test(message)) {
      rejected.count++;
      return [];
    }
    return [`exception: ${message}`];
  }
  const problems: string[] = [];
  const d = describe(out, c.frame);
  if (!d.closed) problems.push('the mesh is not closed');
  if (!d.sound) problems.push('a folded triangle');
  try {
    const loaded = inspect(out);
    if (loaded.status !== 'NoError') problems.push(`the kernel does not take the result: ${loaded.status}`);
    else if (Math.abs(loaded.volume - d.volume) > 0.05) problems.push(`the kernel reads the result otherwise: volume ${loaded.volume.toFixed(3)} instead of ${d.volume.toFixed(3)}`);
  } catch (error) {
    problems.push(`the kernel does not take the result: ${String(error)}`);
  }
  const oracle = taperOracle(c.ops);
  if (Math.abs(d.volume - oracle) > 0.1) problems.push(`volume ${d.volume.toFixed(3)}, the cross sections give ${oracle.toFixed(3)}`);
  if (c.frame !== IDENTITY) {
    // the same faces as in the axis-aligned position
    const reference = [...new Set(runTapered(c, IDENTITY).faceIds)].sort((x, y) => x - y);
    const got = [...new Set(out.faceIds)].sort((x, y) => x - y);
    if (JSON.stringify(reference) !== JSON.stringify(got)) problems.push(`faces ${JSON.stringify(got)}, axis-aligned ${JSON.stringify(reference)}`);
  }
  return problems;
}

export const describeTapered = (c: TaperCase): string => c.ops.map((o) => `${o.op === 'union' ? '+' : '−'} ${o.kind} ${o.low.length} w ${o.w0}..${o.w1} [${o.id}]`).join('; ');

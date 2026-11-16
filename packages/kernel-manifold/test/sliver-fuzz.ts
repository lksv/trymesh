// The sliver fuzz of the adapter (D51, docs/d36/5f-adapter-repair/design.md, "The sliver fuzz"): the
// intersection of a pin with a hole of nearly the same regular polygon, the two turned against each
// other, often with a plate on the pin that lies flush on the holed plate, in random frames and far
// from the origin. A mesh of slivers, where the first cleaning of the adapter goes round in a cycle.
// The oracle does not ask the kernel: the common part is (pin polygon minus hole polygon) × 8.
import type { Solid } from '@trymesh/engine';
import { tolerances } from '../src/geometry';
import { type TestFrame, type Loop, describe, inspect, kernel, prism, rect } from './testkit';
import { randomFrame, rng } from './fuzz';

export interface SliverCase {
  frame: TestFrame;
  n: number; // sides of both polygons
  radius: number; // of the hole
  over: number; // how much larger the pin is than its hole (0: the same circle)
  phase: number; // the turn of the pin's polygon, radians
  top: boolean; // with the plate on the pin that lies flush on the holed plate
  far: number; // how far from the origin along x
}

export const ngon = (r: number, n: number, phase: number): Loop =>
  Array.from({ length: n }, (_, i): [number, number] => [r * Math.cos(phase + (2 * Math.PI * i) / n), r * Math.sin(phase + (2 * Math.PI * i) / n)]);
const area = (p: Loop): number => p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0) / 2;

// The convex polygon `subject` clipped by every edge of the convex polygon `clip` (both counter-clockwise).
function clipped(subject: Loop, clip: Loop): Loop {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, ay] = clip[i];
    const [bx, by] = clip[(i + 1) % clip.length];
    const side = ([x, y]: [number, number]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const next: Loop = [];
    out.forEach((p, j) => {
      const q = out[(j + 1) % out.length];
      const [sp, sq] = [side(p), side(q)];
      if (sp >= 0) next.push(p);
      if (sp >= 0 !== sq >= 0) next.push([p[0] + ((q[0] - p[0]) * sp) / (sp - sq), p[1] + ((q[1] - p[1]) * sp) / (sp - sq)]);
    });
    out = next;
  }
  return out;
}

// The generator of the design, draw for draw: the counts of the design belong to it seed by seed.
export function generateSliver(seed: number): SliverCase {
  const r = rng(seed * 7919 + 13);
  let frame = randomFrame(r);
  const far = r() < 0.15 ? (r() < 0.5 ? 450 : 2000) : 0;
  frame = { ...frame, o: [frame.o[0] + far, frame.o[1], frame.o[2]] };
  const n = [24, 32, 45, 64][Math.floor(r() * 4)];
  const radius = [1.5, 2.5, 4, 12][Math.floor(r() * 4)];
  const over = r() < 0.7 ? 0 : [0.011, 0.03, 0.1][Math.floor(r() * 3)];
  const phase = r() * 2 * Math.PI;
  const top = r() < 0.7;
  return { frame, n, radius, over, phase, top, far };
}

export const describeSliver = (c: SliverCase): string =>
  `n ${c.n}, r ${c.radius}, over ${c.over}, phase ${c.phase.toFixed(4)}, ${c.top ? 'with' : 'without'} the flush plate, ${c.far} mm away, ${c.frame.x[0] === 1 ? 'along the axes' : 'askew'}`;

// The two solids: a plate with the hole (the face numbers 1 to 9) and the pin (21 to 23), on it the
// flush plate (31 to 36) joined by a union with the plate as the body. All sides of a polygon carry
// one face number, as the sides of a circle of the engine do. The exact volume of their intersection.
export function buildSliver(c: SliverCase): { a: Solid; b: Solid; volume: number } {
  const plate = prism(c.frame, rect(-30, -30, 30, 30), 0, 8, { start: 1, end: 2, sides: [3, 4, 5, 6] });
  const hole = ngon(c.radius, c.n, 0);
  const a = kernel.boolean('difference', plate, prism(c.frame, hole, -1, 9, { start: 7, end: 8, sides: Array(c.n).fill(9) }));
  const pin = ngon(c.radius + c.over, c.n, c.phase);
  let b = prism(c.frame, pin, 0, 16, { start: 21, end: 22, sides: Array(c.n).fill(23) });
  if (c.top) b = kernel.boolean('union', prism(c.frame, rect(-20, -25, 40, 25), 8, 16, { start: 31, end: 32, sides: [33, 34, 35, 36] }), b);
  return { a, b, volume: (area(pin) - area(clipped(pin, hole))) * 8 };
}

// The room of the volume: an absolute and a relative part, and what the weld may close or open, a
// layer one weld tolerance thick over the side of the pin inside the plate.
export const sliverRoom = (c: SliverCase, a: Solid, b: Solid, volume: number): number => 0.003 + 0.003 * volume + tolerances(a, b).weld * 2 * Math.PI * c.radius * 8;

export type SliverOutcome = 'unbuilt' | 'refused' | 'first' | 'second';

// What the adapter made of one case, and what is wrong with its answer (empty: passed). A refusal by
// the adapter's own checks passes and is counted by the caller.
export function checkSliver(seed: number): { outcome: SliverOutcome; problems: string[] } {
  const c = generateSliver(seed);
  let made: ReturnType<typeof buildSliver>;
  try {
    made = buildSliver(c);
  } catch {
    return { outcome: 'unbuilt', problems: [] };
  }
  const { a, b, volume } = made;
  const before = kernel.secondCleanings;
  let out: Solid;
  try {
    out = kernel.boolean('intersection', a, b);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: 'refused', problems: /není uzavřená plocha|přeložený trojúhelník/.test(message) ? [] : [`threw: ${message}`] };
  }
  const outcome = kernel.secondCleanings > before ? 'second' : 'first';
  const d = describe(out, c.frame);
  const problems: string[] = [];
  const room = sliverRoom(c, a, b, volume);
  if (Math.abs(d.volume - volume) > room) problems.push(`volume ${d.volume.toFixed(5)} against ${volume.toFixed(5)}, room ${room.toExponential(2)}`);
  // an intersection welded to nothing is the right answer and a mesh the library does not load
  if (out.triangles.length > 0) {
    if (!d.closed) problems.push('not closed');
    if (!d.sound) problems.push('a folded triangle');
    const faces = new Set([...a.faceIds, ...b.faceIds]);
    const foreign = [...new Set(out.faceIds)].filter((id) => !faces.has(id));
    if (foreign.length) problems.push(`face numbers of neither input: ${foreign.join(', ')}`);
    const loaded = inspect(out);
    if (loaded.status !== 'NoError') problems.push(`the library does not load it: ${loaded.status}`);
  }
  return { outcome, problems: problems.map((p) => `${p} (${outcome} cleaning)`) };
}

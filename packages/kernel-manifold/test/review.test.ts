// Cases from the review of the adapter (2026-11-14). Each runs in many random positions: the defects
// showed only in some rotations.
import { describe as suite, expect, it } from 'vitest';
import type { BooleanOp, Solid } from '@trymesh/engine';
import { cleanBySubdivision, isClosed } from '../src/clean';
import { tolerances, triangleCount } from '../src/geometry';
import { randomFrame, rng } from './fuzz';
import { type SliverCase, buildSliver, generateSliver, ngon } from './sliver-fuzz';
import { IDENTITY, type Loop, type TestFrame, describe, idsOf, inspect, kernel, prism, rect, rotated } from './testkit';

const ids = (n: number) => ({ start: 100 * n + 1, end: 100 * n + 2, sides: [100 * n + 3, 100 * n + 4, 100 * n + 5, 100 * n + 6] });
type Step = [BooleanOp, Loop, number, number];

function build(frame: TestFrame, steps: Step[]): Solid {
  let body = prism(frame, rect(0, 0, 40, 30), 0, 10, { start: 1, end: 2, sides: [3, 4, 5, 6] });
  steps.forEach(([op, loop, z0, z1], i) => {
    body = kernel.boolean(op, body, prism(frame, loop, z0, z1, ids(i + 1)));
  });
  return body;
}

// Counts in how many positions the case fails (an exception, a mesh not closed or folded, a wrong
// volume or surface area, the kernel loads the mesh differently).
function failures(steps: Step[], volume: number, area: number | null, frames: TestFrame[], rejected?: { count: number }): string[] {
  const found: string[] = [];
  frames.forEach((frame, i) => {
    try {
      const out = build(frame, steps);
      const d = describe(out, frame);
      const loaded = inspect(out);
      const problems = [
        !d.closed && 'a mesh not closed',
        !d.sound && 'a folded triangle',
        Math.abs(d.volume - volume) > 0.05 && `volume ${d.volume.toFixed(3)} instead of ${volume}`,
        area !== null && Math.abs(d.area - area) > 0.1 && `surface area ${d.area.toFixed(3)} instead of ${area}`,
        Math.abs(loaded.volume - d.volume) > 0.05 && `the kernel loads the volume ${loaded.volume.toFixed(3)}`,
      ].filter(Boolean);
      if (problems.length) found.push(`position ${i}:  ${problems.join(', ')}`);
    } catch (error) {
      if (rejected) rejected.count++;
      else found.push(`position ${i}:  ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return found;
}

const frames = (count: number, seed: number, far = 0): TestFrame[] => {
  const r = rng(seed);
  return [IDENTITY, ...Array.from({ length: count }, () => randomFrame(r))].map((f) => ({ ...f, o: [f.o[0] + far, f.o[1] - far, f.o[2] + far] }));
};

suite('findings of the review of the adapter', () => {
  // The tool shrinks because of its edge contact with the boss B; the face of the boss A lies g
  // behind its face. The shrinking must not skip over the face A, otherwise a membrane stays after
  // A (silently before: area 4400 instead of 4200).
  const gapSteps = (g: number): Step[] => [
    ['union', rect(20, 0, 30 - g, 10), 10, 20],
    ['union', rect(30, 10, 40, 20), 10, 20],
    ['difference', rect(0, 0, 30, 10), 10, 20],
  ];
  it.each([0.05, 0.1, 0.5])('the shrinking of the tool does not skip over a near face of the body (gap %f)', (g) => {
    expect(failures(gapSteps(g), 13000, 4200, frames(60, 11))).toEqual([]);
  });
  // A gap below the resolution of the adapter (about 1e-4 of the size of the model): right, or an
  // error, not silently wrong.
  // A union and a difference never reach the second cleaning of D51 (test 3 of its design): the
  // count of refusals could not tell, the second cleaning answers none of these.
  it.each([0.001, 0.002, 0.004, 0.02])('a gap %f below the resolution of the adapter ends right or in an error', (g) => {
    const before = kernel.secondCleanings;
    expect(failures(gapSteps(g), 13000, 4200, frames(60, 11), { count: 0 })).toEqual([]);
    expect(kernel.secondCleanings).toBe(before);
  });

  // A block enters the side of the body by a small e (the faces are not in one plane). Sound thin
  // triangles arise, which the cleaning must not take as zero.
  it.each([0.02, 0.05])('an intersection of a small depth %f', (e) => {
    const steps: Step[] = [
      ['union', rect(-10, 0, 20, 30), 10, 15],
      ['union', rect(-10, 0, e, 20), 5, 15],
    ];
    expect(failures(steps, 17500, null, frames(100, 6))).toEqual([]);
  });

  // A depth comparable to the overlap (about 1e-4 of the size of the model) is below the resolution
  // of the adapter. The result may be refused by an error, but must not be silently defective.
  it('an intersection of a depth below the resolution of the adapter ends right or in an error', () => {
    const steps: Step[] = [
      ['union', rect(-10, 0, 20, 30), 10, 15],
      ['union', rect(-10, 0, 0.005, 20), 5, 15],
    ];
    const rejected = { count: 0 };
    const before = kernel.secondCleanings;
    expect(failures(steps, 17500, null, frames(100, 6), rejected)).toEqual([]);
    expect(rejected.count).toBeLessThan(30);
    expect(kernel.secondCleanings).toBe(before);
  });

  // A body that touches itself at an edge must not duplicate triangles in further operations.
  it('an edge contact does not grow the mesh in further operations', () => {
    for (const frame of frames(5, 1)) {
      let body = build(frame, [['union', rect(40, 30, 60, 50), 0, 10]]);
      const before = triangleCount(body);
      for (let i = 0; i < 12; i++) {
        body = kernel.boolean('union', body, prism(frame, rect(2 + 3 * i, 2, 4 + 3 * i, 4), 10, 11, ids(i + 2)));
      }
      const d = describe(body, frame);
      expect(d.closed && d.sound).toBe(true);
      expect(d.volume).toBeCloseTo(12000 + 4000 + 12 * 4, 1);
      expect(triangleCount(body)).toBeLessThan(before + 12 * 40);
    }
  });

  // A model far from the origin: the precision of float32 falls with the distance, the tolerance must grow with it.
  it.each([450, 1300])('a model %i mm from the origin', (far) => {
    const cases: [Step[], number][] = [
      [[['union', rect(10, 10, 20, 20), 10, 15]], 12500],
      [[['difference', rect(30, 10, 40, 20), 5, 10]], 11500],
      [[['union', rect(0, 0, 20, 30), 10, 20], ['difference', rect(10, 10, 30, 20), 5, 10]], 17000],
      [[['union', rect(35, 10, 45, 20), 10, 15], ['union', rect(35, 5, 45, 25), 5, 10]], 13000],
    ];
    for (const [steps, volume] of cases) {
      const found: string[] = [];
      for (const frame of frames(40, far, far)) {
        try {
          const out = build(frame, steps);
          const d = describe(out, frame);
          // the volume of a distant model is computed from large numbers; a tolerance proportional to the error of float32
          if (!d.closed || !d.sound || Math.abs(d.volume - volume) > far * 0.02) found.push(`volume ${d.volume.toFixed(2)} instead of ${volume}, closed ${d.closed}, not folded ${d.sound}`);
        } catch (error) {
          found.push(String(error));
        }
      }
      expect(found).toEqual([]);
    }
  });
});

// D51 (docs/d36/5f-adapter-repair/design.md, "Tests the implementation owes", 1 to 4): intersections
// of a pin with its hole turned against it and a plate lying flush, built by the sliver fuzz in the
// frame `rotated()`. The first cleaning goes round in a cycle and stops open or folded; the second
// cleaning answers five of the six. A refusal depends on the last bit of a coordinate, so a case
// that a later build answers by the first cleaning is replaced by another of the scan of the design.
const sliverCase = (n: number, radius: number, over: number, phase: number, frame: TestFrame = rotated(), top = true): SliverCase => ({ frame, n, radius, over, phase, top, far: 0 });
const thrown = (call: () => unknown): string | undefined => {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
};
const arrays = (s: Solid) => [[...s.positions], [...s.triangles], [...s.faceIds]];
const NOT_CLOSED = /not a closed surface/;
const FOLDED = /folded triangle/;
const SLIVERS: [number, number, number, number, RegExp, number | null][] = [
  // n, r, δ, phase, how the first cleaning alone refuses, the exact volume (null: still refused)
  [24, 1.5, 0, 0.0618, NOT_CLOSED, 0.1734],
  [32, 1.5, 0, 0.0818, FOLDED, 0.1318],
  [32, 4, 0, 0.0818, NOT_CLOSED, 0.9375],
  [24, 12, 0, 0.009, NOT_CLOSED, 2.046],
  [24, 4, 0.03, 0.009, NOT_CLOSED, 5.9856], // a real collision
  [45, 1.5, 0, 0.0707, NOT_CLOSED, null], // a limit: the second cleaning's mesh is folded
];

suite('D51: the second cleaning of an intersection of slivers', () => {
  it.each(SLIVERS)('1. n %i, r %f, δ %f, phase %f: refused by the first cleaning, answered by the adapter', (n, radius, over, phase, first, exact) => {
    const c = sliverCase(n, radius, over, phase);
    const { a, b, volume } = buildSliver(c);
    if (exact !== null) expect(volume).toBeCloseTo(exact, 3);
    expect(thrown(() => kernel.boolean('intersection', a, b, { second: false }))).toMatch(first);
    const before = kernel.secondCleanings;
    if (exact === null) {
      // both cleanings fail the checks: the message is the first cleaning's
      expect(thrown(() => kernel.boolean('intersection', a, b))).toMatch(first);
      expect(kernel.secondCleanings).toBe(before + 1);
      return;
    }
    const out = kernel.boolean('intersection', a, b);
    expect(kernel.secondCleanings).toBe(before + 1);
    const d = describe(out, c.frame);
    expect([d.closed, d.sound]).toEqual([true, true]);
    expect(Math.abs(d.volume - volume)).toBeLessThan(0.002);
    const faces = new Set([...a.faceIds, ...b.faceIds]);
    expect(idsOf(out).filter((id) => !faces.has(id))).toEqual([]);
    expect(arrays(kernel.boolean('intersection', a, b))).toEqual(arrays(out));
    // along the axes, and without the flush plate, the first cleaning answers the same case
    for (const other of [sliverCase(n, radius, over, phase, IDENTITY), sliverCase(n, radius, over, phase, rotated(), false)]) {
      const built = buildSliver(other);
      const plain = kernel.boolean('intersection', built.a, built.b, { second: false });
      expect(Math.abs(describe(plain, other.frame).volume - built.volume)).toBeLessThan(0.002);
    }
  });

  it('2. an intersection the first cleaning verifies is returned as it was, without the second cleaning', () => {
    const block = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, first: number): Solid =>
      prism(IDENTITY, rect(x0, y0, x1, y1), z0, z1, { start: first, end: first + 1, sides: [first + 2, first + 3, first + 4, first + 5] });
    // the blocks of as-computed.test.ts, and the pin askew of the first case turned a little further, which the first cleaning answers
    const pin = buildSliver(sliverCase(24, 1.5, 0, 0.5));
    for (const [a, b] of [
      [block(0, 0, 40, 30, 0, 10, 1), block(30, 20, 50, 40, 5, 15, 11)],
      [pin.a, pin.b],
    ]) {
      const before = kernel.secondCleanings;
      const out = kernel.boolean('intersection', a, b);
      expect(kernel.secondCleanings).toBe(before);
      expect(arrays(out)).toEqual(arrays(kernel.boolean('intersection', a, b, { second: false })));
    }
  });

  // 3. A union never reaches the second cleaning. The refused unions and differences above all
  // have faces moved, so they would not reach it anyway; this union has none moved: the pin of
  // the sliver fuzz joined to its flush plate two metres away (the seeds 2535 and 11106, refused
  // "not a closed surface"; the second cleaning would answer it). Review of D51, finding 1. On the
  // day the adapter answers it, keep that the counter does not move and drop that it is refused.
  it.each([2535, 11106])('3. the union of the sliver fuzz seed %i, with no face moved, is refused without the second cleaning', (seed) => {
    const c = generateSliver(seed);
    const pin = prism(c.frame, ngon(c.radius + c.over, c.n, c.phase), 0, 16, { start: 21, end: 22, sides: Array(c.n).fill(23) });
    const plate = prism(c.frame, rect(-20, -25, 40, 25), 8, 16, { start: 31, end: 32, sides: [33, 34, 35, 36] });
    const before = kernel.secondCleanings;
    expect(thrown(() => kernel.boolean('union', plate, pin))).toMatch(NOT_CLOSED);
    expect(kernel.secondCleanings).toBe(before);
  });

  it('4. the second cleaning alone ends closed, the same twice, with the face numbers of its input', () => {
    for (const [n, radius, over, phase] of SLIVERS) {
      const { a, b } = buildSliver(sliverCase(n, radius, over, phase));
      const raw = kernel.boolean('intersection', a, b, { prepare: false });
      const weld = tolerances(a, b).weld;
      const out = cleanBySubdivision(raw, weld);
      expect(isClosed(out), `n ${n}, r ${radius}`).toBe(true);
      expect(arrays(cleanBySubdivision(raw, weld))).toEqual(arrays(out));
      const faces = new Set(raw.faceIds);
      expect(idsOf(out).filter((id) => !faces.has(id))).toEqual([]);
    }
  });
});

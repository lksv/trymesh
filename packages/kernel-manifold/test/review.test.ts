// Případy z revize adaptéru (2026-11-14). Každý běží v mnoha náhodných polohách: vady se
// projevovaly jen v některých natočeních.
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

// Spočítá, v kolika polohách případ selže (výjimka, neuzavřená nebo přeložená síť, špatný objem
// nebo povrch, jádro síť načte jinak).
function failures(steps: Step[], volume: number, area: number | null, frames: TestFrame[], rejected?: { count: number }): string[] {
  const found: string[] = [];
  frames.forEach((frame, i) => {
    try {
      const out = build(frame, steps);
      const d = describe(out, frame);
      const loaded = inspect(out);
      const problems = [
        !d.closed && 'neuzavřená síť',
        !d.sound && 'přeložený trojúhelník',
        Math.abs(d.volume - volume) > 0.05 && `objem ${d.volume.toFixed(3)} místo ${volume}`,
        area !== null && Math.abs(d.area - area) > 0.1 && `povrch ${d.area.toFixed(3)} místo ${area}`,
        Math.abs(loaded.volume - d.volume) > 0.05 && `jádro načte objem ${loaded.volume.toFixed(3)}`,
      ].filter(Boolean);
      if (problems.length) found.push(`poloha ${i}: ${problems.join(', ')}`);
    } catch (error) {
      if (rejected) rejected.count++;
      else found.push(`poloha ${i}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return found;
}

const frames = (count: number, seed: number, far = 0): TestFrame[] => {
  const r = rng(seed);
  return [IDENTITY, ...Array.from({ length: count }, () => randomFrame(r))].map((f) => ({ ...f, o: [f.o[0] + far, f.o[1] - far, f.o[2] + far] }));
};

suite('nálezy z revize adaptéru', () => {
  // Nástroj se kvůli dotyku hranou s nálitkem B zmenší; stěna nálitku A leží o g za jeho stěnou.
  // Zmenšení nesmí stěnu A přeskočit, jinak po A zůstane blána (dřív potichu: povrch 4400 místo 4200).
  const gapSteps = (g: number): Step[] => [
    ['union', rect(20, 0, 30 - g, 10), 10, 20],
    ['union', rect(30, 10, 40, 20), 10, 20],
    ['difference', rect(0, 0, 30, 10), 10, 20],
  ];
  it.each([0.05, 0.1, 0.5])('zmenšení nástroje nepřeskočí blízkou stěnu tělesa (mezera %f)', (g) => {
    expect(failures(gapSteps(g), 13000, 4200, frames(60, 11))).toEqual([]);
  });
  // Mezera pod rozlišením adaptéru (asi 1e-4 rozměru modelu): správně, nebo chybou, ne potichu špatně.
  // A union and a difference never reach the second cleaning of D51 (test 3 of its design): the
  // count of refusals could not tell, the second cleaning answers none of these.
  it.each([0.001, 0.002, 0.004, 0.02])('mezera %f pod rozlišením adaptéru skončí správně nebo chybou', (g) => {
    const before = kernel.secondCleanings;
    expect(failures(gapSteps(g), 13000, 4200, frames(60, 11), { count: 0 })).toEqual([]);
    expect(kernel.secondCleanings).toBe(before);
  });

  // Blok proniká bokem tělesa o malé e (stěny nejsou v jedné rovině). Vznikají zdravé tenké
  // trojúhelníky, které čištění nesmí brát jako nulové.
  it.each([0.02, 0.05])('průnik o malou hloubku %f', (e) => {
    const steps: Step[] = [
      ['union', rect(-10, 0, 20, 30), 10, 15],
      ['union', rect(-10, 0, e, 20), 5, 15],
    ];
    expect(failures(steps, 17500, null, frames(100, 6))).toEqual([]);
  });

  // Hloubka srovnatelná s přesahem (asi 1e-4 rozměru modelu) je pod rozlišením adaptéru. Výsledek
  // smí být odmítnut chybou, ale nesmí být potichu vadný.
  it('průnik o hloubku pod rozlišením adaptéru skončí správně nebo chybou', () => {
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

  // Těleso, které se samo sebe dotýká hranou, nesmí při dalších operacích zdvojovat trojúhelníky.
  it('dotyk hranou nezvětšuje síť při dalších operacích', () => {
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

  // Model daleko od počátku: přesnost float32 klesá se vzdáleností, tolerance s ní musí růst.
  it.each([450, 1300])('model %i mm od počátku', (far) => {
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
          // objem se u vzdáleného modelu počítá z velkých čísel; tolerance úměrná chybě float32
          if (!d.closed || !d.sound || Math.abs(d.volume - volume) > far * 0.02) found.push(`objem ${d.volume.toFixed(2)} místo ${volume}, uzavřená ${d.closed}, nepřeložená ${d.sound}`);
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

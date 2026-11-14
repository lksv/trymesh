// Případy z revize adaptéru (2026-11-14). Každý běží v mnoha náhodných polohách: vady se
// projevovaly jen v některých natočeních.
import { describe as suite, expect, it } from 'vitest';
import type { BooleanOp, Solid } from '@trymesh/engine';
import { triangleCount } from '../src/geometry';
import { randomFrame, rng } from './fuzz';
import { IDENTITY, type Loop, type TestFrame, describe, inspect, kernel, prism, rect } from './testkit';

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
  it.each([0.001, 0.002, 0.004, 0.02])('mezera %f pod rozlišením adaptéru skončí správně nebo chybou', (g) => {
    expect(failures(gapSteps(g), 13000, 4200, frames(60, 11), { count: 0 })).toEqual([]);
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
    expect(failures(steps, 17500, null, frames(100, 6), rejected)).toEqual([]);
    expect(rejected.count).toBeLessThan(30);
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

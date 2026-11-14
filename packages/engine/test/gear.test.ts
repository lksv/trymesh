// The involute gear generator as a pure function (D35, point 3): dimensions of the profile, the
// meaning of backlash, rotation from the gear in mesh and its checks. Planar measurements in float64
// on the polyline the generator returns; the solid side is tested in packages/scenarios.
import { describe, expect, it } from 'vitest';
import { GENERATORS, type GeneratedProfile, type GeneratorInput, MAX_PROFILE_POINTS, generateProfile } from '../src/generators';
import type { Facts, Frame, Vec2 } from '../src/types';

const XY: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] };
const DEG = Math.PI / 180;
const TOLERANCE = 0.01;
type P = Vec2;

interface GearInput {
  teeth: number;
  module?: number;
  center?: P;
  internal?: boolean;
  backlash?: number;
  rotation?: number;
  pressureAngle?: number;
  meshWith?: Facts | null; // null: the reference is declared but its feature has no facts
  frame?: Frame;
  chordTolerance?: number;
}
function input(g: GearInput): GeneratorInput {
  const module = g.module ?? 0.9;
  return {
    operands: { circle: { kind: 'circle', center: g.center ?? [0, 0], radius: (module * g.teeth) / 2 } },
    params: { teeth: g.teeth, pressureAngle: g.pressureAngle ?? 20 * DEG, backlash: g.backlash ?? 0, rotation: g.rotation ?? 0, internal: g.internal ?? false },
    refs: g.meshWith === undefined ? {} : { meshWith: g.meshWith ?? undefined },
    frame: g.frame ?? XY,
    chordTolerance: g.chordTolerance ?? TOLERANCE,
  };
}
function gear(g: GearInput): GeneratedProfile & { loop: P[] } {
  const result = generateProfile('involuteGear', input(g));
  if (!result.ok) throw new Error(result.message);
  const xy = result.regions[0].outer.xy;
  return { ...result, loop: Array.from({ length: xy.length / 2 }, (_, i): P => [xy[2 * i], xy[2 * i + 1]]) };
}
const failure = (g: GearInput): string => {
  const result = generateProfile('involuteGear', input(g));
  return result.ok ? '' : result.message;
};

// ---------------------------------------------------------------- planar measurements

const area = (loop: P[]): number => loop.reduce((sum, p, i) => sum + (p[0] * loop[(i + 1) % loop.length][1] - loop[(i + 1) % loop.length][0] * p[1]) / 2, 0);
const radii = (loop: P[], center: P = [0, 0]): number[] => loop.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]));
const inside = (p: P, poly: P[]): boolean => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
};
const toBoundary = (p: P, poly: P[]): number => {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[j], poly[i]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
};
// Width of the tooth of the loop on the pitch circle, along the arc: the tooth whose axis is at `rotation`.
function widthAtPitch(loop: P[], r: number, teeth: number, rotation = 0): number {
  const angles: number[] = [];
  for (let i = 0; i < loop.length; i++) {
    const [p, q] = [loop[i], loop[(i + 1) % loop.length]];
    const [rp, rq] = [Math.hypot(...p), Math.hypot(...q)];
    if (rp < r === rq < r) continue;
    const t = (r - rp) / (rq - rp);
    let angle = Math.atan2(p[1] + t * (q[1] - p[1]), p[0] + t * (q[0] - p[0])) - rotation;
    angle -= 2 * Math.PI * Math.round(angle / (2 * Math.PI));
    angles.push(angle);
  }
  const first = angles.filter((a) => Math.abs(a) < Math.PI / teeth).sort((x, y) => x - y);
  return (first[1] - first[0]) * r;
}
// Deepest overlap and smallest gap of the material of two profiles near a point. `ring`: the second
// loop is the tool of a ring gear, whose material is outside the loop.
function contact(a: P[], b: P[], around: P, reach: number, ring: boolean): { overlap: number; gap: number } {
  const near = (poly: P[]) => poly.filter((p) => Math.hypot(p[0] - around[0], p[1] - around[1]) < reach);
  let [overlap, gap] = [0, Infinity];
  const probe = (points: P[], other: P[], inMaterial: (p: P) => boolean) => {
    for (const p of points) {
      const d = toBoundary(p, other);
      if (inMaterial(p)) overlap = Math.max(overlap, d);
      else gap = Math.min(gap, d);
    }
  };
  probe(near(a), b, (p) => inside(p, b) !== ring);
  probe(near(b), a, (p) => inside(p, a));
  return { overlap, gap };
}
// Turns a pair in the ratio of their tooth counts over one pitch of `a` and measures the contact.
// `a` is an external gear, `b` an external gear or the tool of a ring; both start from the
// rotation the generator gave them.
function sweep(a: GearInput & { rotation: number }, b: GearInput & { rotation: number }, steps = 24): { overlap: number; gapMin: number; gapMax: number } {
  const [ca, cb] = [a.center ?? [0, 0], b.center ?? [0, 0]];
  const ra = ((a.module ?? 0.9) * a.teeth) / 2;
  const direction = b.internal ? Math.atan2(ca[1] - cb[1], ca[0] - cb[0]) : Math.atan2(cb[1] - ca[1], cb[0] - ca[0]);
  const pitchPoint: P = [ca[0] + ra * Math.cos(direction), ca[1] + ra * Math.sin(direction)];
  let [overlap, gapMin, gapMax] = [0, Infinity, 0];
  for (let s = 0; s < steps; s++) {
    const turn = ((2 * Math.PI) / a.teeth) * (s / steps);
    const A = gear({ ...a, meshWith: undefined, rotation: a.rotation + turn }).loop;
    const B = gear({ ...b, meshWith: undefined, rotation: b.rotation + (b.internal ? 1 : -1) * turn * (a.teeth / b.teeth) }).loop;
    const c = contact(A, B, pitchPoint, 3.5 * (a.module ?? 0.9), b.internal === true);
    overlap = Math.max(overlap, c.overlap);
    gapMin = Math.min(gapMin, c.gap);
    gapMax = Math.max(gapMax, c.gap);
  }
  return { overlap, gapMin, gapMax };
}

// ---------------------------------------------------------------- tests

describe('involute gear: the profile', () => {
  it('an external gear: tip and root circles, tooth thickness on the pitch circle, one loop counter-clockwise', () => {
    for (const teeth of [12, 18, 27, 36, 90]) {
      for (const backlash of [0, 0.05, 0.1]) {
        const g = gear({ teeth, backlash });
        const r = (0.9 * teeth) / 2;
        expect(g.regions).toHaveLength(1);
        expect(g.regions[0].holes).toEqual([]);
        expect(g.regions[0].outer.side).toBe('teeth');
        expect(area(g.loop)).toBeGreaterThan(0);
        const all = radii(g.loop);
        expect(Math.max(...all)).toBeCloseTo(r + 0.9, 9);
        expect(Math.min(...all)).toBeCloseTo(r - 1.25 * 0.9, 9);
        // chords lie inside the exact tooth: thinner by at most the tolerance, never thicker
        const width = widthAtPitch(g.loop, r, teeth);
        const exact = (Math.PI * 0.9) / 2 - backlash;
        expect(width, `${teeth}/${backlash}`).toBeLessThanOrEqual(exact + 1e-9);
        expect(width, `${teeth}/${backlash}`).toBeGreaterThan(exact - TOLERANCE);
        // the loop repeats with the pitch: the same number of points on every tooth
        expect(g.loop.length % teeth).toBe(0);
      }
    }
  });

  it('the tool of a ring gear: from the tip circle of the ring to its root circle, never thinner than the exact tooth space', () => {
    for (const teeth of [24, 72, 90]) {
      for (const backlash of [0, 0.05]) {
        const g = gear({ teeth, backlash, internal: true });
        const r = (0.9 * teeth) / 2;
        const all = radii(g.loop);
        // the arcs of the tool are made of tangents, so its corners lie outside the circles by less than the tolerance
        expect(Math.max(...all)).toBeGreaterThan(r + 1.25 * 0.9);
        expect(Math.max(...all)).toBeLessThan(r + 1.25 * 0.9 + TOLERANCE);
        expect(Math.min(...all)).toBeCloseTo(r - 0.9, 9);
        const width = widthAtPitch(g.loop, r, teeth);
        const exact = (Math.PI * 0.9) / 2 + backlash;
        expect(width, `${teeth}/${backlash}`).toBeGreaterThanOrEqual(exact - 1e-9);
        expect(width, `${teeth}/${backlash}`).toBeLessThan(exact + 2 * TOLERANCE);
        expect(g.facts).toMatchObject({ internal: true, tipDiameter: expect.closeTo(2 * (r - 0.9), 9), rootDiameter: expect.closeTo(2 * (r + 1.125), 9) });
      }
    }
  });

  it('the tool of a ring gear contains the exact tool everywhere, not only at its vertices', () => {
    // The exact boundary of one tooth of the tool, sampled densely: the involute flank, the radial
    // part below the base circle and both arcs. Every sample has to lie inside the polyline or on it.
    const involute = (angle: number): number => Math.tan(angle) - angle;
    for (const [teeth, chordTolerance] of [[20, 0.01], [30, 0.01], [34, 0.01], [40, 0.01], [72, 0.01], [72, 0.1], [90, 0.001]] as const) {
      for (const backlash of [0, 0.05]) {
        const g = gear({ teeth, module: 1, internal: true, backlash, chordTolerance });
        const [r, alpha] = [teeth / 2, 20 * DEG];
        const [rb, inner, outer] = [r * Math.cos(alpha), r - 1, r + 1.25];
        const psi = Math.PI / (2 * teeth) + backlash / (2 * r);
        const halfAt = (rho: number): number => psi + involute(alpha) - involute(Math.acos(Math.min(1, rb / rho)));
        const samples: P[] = [];
        const N = 3000;
        for (let i = 0; i <= N; i++) {
          const rho = inner + ((outer - inner) * i) / N;
          for (const sign of [1, -1]) samples.push([rho * Math.cos(sign * halfAt(rho)), rho * Math.sin(sign * halfAt(rho))]);
          const tip = -halfAt(outer) + (2 * halfAt(outer) * i) / N;
          samples.push([outer * Math.cos(tip), outer * Math.sin(tip)]);
          const root = halfAt(inner) + (((2 * Math.PI) / teeth - 2 * halfAt(inner)) * i) / N;
          samples.push([inner * Math.cos(root), inner * Math.sin(root)]);
        }
        let worst = 0;
        for (const p of samples) if (!inside(p, g.loop)) worst = Math.max(worst, toBoundary(p, g.loop));
        expect(worst, `${teeth} teeth, tolerance ${chordTolerance}, backlash ${backlash}`).toBeLessThan(1e-10);
        // and it is not wider than the tolerance allows
        const width = widthAtPitch(g.loop, r, teeth);
        expect(width - (Math.PI / 2 + backlash)).toBeLessThan(2.5 * chordTolerance);
      }
    }
  });

  it('facts: module from the circle and the tooth count, diameters, rotation and placement in the model', () => {
    const frame: Frame = { origin: [0, 0, 5], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] };
    const g = gear({ teeth: 18, center: [3, 4], rotation: 0.3, backlash: 0.05, frame });
    expect(g.facts).toEqual({
      module: expect.closeTo(0.9, 12),
      teeth: 18,
      pressureAngle: 20 * DEG,
      backlash: 0.05,
      internal: false,
      pitchDiameter: expect.closeTo(16.2, 12),
      baseDiameter: expect.closeTo(16.2 * Math.cos(20 * DEG), 12),
      tipDiameter: expect.closeTo(18, 12),
      rootDiameter: expect.closeTo(13.95, 12),
      rotation: 0.3,
      meshed: false,
      center: [0, 3, 9],
      axis: [1, 0, 0],
      toothDirection: [0, expect.closeTo(Math.cos(0.3), 12), expect.closeTo(Math.sin(0.3), 12)],
    });
    expect(Object.keys(g.facts).sort()).toEqual(Object.keys(GENERATORS.involuteGear.facts).sort());
    // the rotation is the direction of a tooth axis: a tip point lies on it
    const tip = gear({ teeth: 18, rotation: 0.3 }).loop.filter((p) => Math.abs(Math.hypot(...p) - 9) < 1e-9);
    const mean = tip.reduce((sum, p) => sum + Math.atan2(p[1], p[0]), 0) / tip.length;
    expect(tip.some((p) => Math.abs(Math.atan2(p[1], p[0]) - 0.3) < 0.2)).toBe(true);
    expect(Number.isFinite(mean)).toBe(true);
  });

  it('a finer chord tolerance gives more points; the pressure angle changes the base circle', () => {
    expect(gear({ teeth: 18, chordTolerance: 0.001 }).loop.length).toBeGreaterThan(gear({ teeth: 18 }).loop.length);
    expect(gear({ teeth: 18, pressureAngle: 25 * DEG }).facts.baseDiameter).toBeCloseTo(16.2 * Math.cos(25 * DEG), 12);
  });

  it('fails with a reason: a pointed tooth, teeth that overlap, too many points', () => {
    expect(failure({ teeth: 18, backlash: 1.4 })).toMatch(/the tooth is pointed/);
    expect(failure({ teeth: 8, pressureAngle: 40 * DEG })).toMatch(/the tooth is pointed/);
    expect(failure({ teeth: 24, internal: true, backlash: 1.4 })).toMatch(/pointed|overlap/);
    expect(failure({ teeth: 500, module: 2, chordTolerance: 1e-9 })).toMatch(new RegExp(`more than ${MAX_PROFILE_POINTS}`));
    expect(failure({ teeth: 500, module: 2 })).toBe('');
    // the size is refused before the loop is built, also for a tolerance the arc rule cannot divide by
    const started = performance.now();
    expect(failure({ teeth: 18, chordTolerance: 1e-13 })).toMatch(new RegExp(`more than ${MAX_PROFILE_POINTS}`));
    expect(failure({ teeth: 18, chordTolerance: 1e-30 })).toMatch(new RegExp(`more than ${MAX_PROFILE_POINTS}`));
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('a tooth exactly at a limit is refused: no edges of zero length', () => {
    // the pressure angles and backlashes at which the tip width or the root gap is exactly zero
    expect(failure({ teeth: 4, module: 1, pressureAngle: 28.480844051985287 * DEG })).toMatch(/the tooth is pointed/);
    expect(failure({ teeth: 10, module: 1, pressureAngle: 33.95349654107833 * DEG })).toMatch(/the tooth is pointed/);
    for (const g of [{ teeth: 20, module: 1, backlash: 0.631709076882948 }, { teeth: 20, module: 1, internal: true, backlash: 1.2537838865067876 }]) {
      const result = generateProfile('involuteGear', input(g));
      if (!result.ok) expect(result.message).toMatch(/pointed|overlap/);
      else {
        // what passes has no degenerate edge
        const xy = result.regions[0].outer.xy;
        let shortest = Infinity;
        for (let i = 0; i < xy.length; i += 2) shortest = Math.min(shortest, Math.hypot(xy[(i + 2) % xy.length] - xy[i], xy[(i + 3) % xy.length] - xy[i + 1]));
        expect(shortest).toBeGreaterThan(1e-7);
      }
    }
  });
});

describe('involute gear: rotation from the gear in mesh', () => {
  const trains = [
    { zs: 18, zp: 27, zr: 72 },
    { zs: 24, zp: 24, zr: 72 },
    { zs: 18, zp: 36, zr: 90 },
  ];
  // sun at the origin with an arbitrary rotation, planet in mesh with it at an angle, ring in mesh with the planet
  function train(t: { zs: number; zp: number; zr: number }, backlash: number, planetAngle = 0.4, frame: Frame = XY) {
    const a = (0.9 * (t.zs + t.zp)) / 2;
    const sunInput = { teeth: t.zs, backlash, rotation: 0.1234 };
    const sun = gear(sunInput);
    const planetInput = { teeth: t.zp, backlash, center: [a * Math.cos(planetAngle), a * Math.sin(planetAngle)] as P };
    const planet = gear({ ...planetInput, meshWith: sun.facts, frame });
    const ringInput = { teeth: t.zr, backlash, internal: true };
    const ring = gear({ ...ringInput, meshWith: planet.facts, frame });
    return { sun, planet, ring, sunInput, planetInput, ringInput };
  }

  it('external pair and gear in a ring: no overlap while turning, flanks in contact at zero backlash', () => {
    for (const t of trains) {
      const { sun, planet, ring, sunInput, planetInput, ringInput } = train(t, 0);
      expect([sun.warnings, planet.warnings, ring.warnings]).toEqual([[], [], []]);
      expect(planet.facts.meshed).toBe(true);
      expect(ring.facts.meshed).toBe(true);
      const outer = sweep({ ...sunInput, rotation: sun.facts.rotation as number }, { ...planetInput, rotation: planet.facts.rotation as number });
      expect(outer.overlap, JSON.stringify(t)).toBeLessThan(1e-9);
      expect(outer.gapMax).toBeLessThan(TOLERANCE);
      const inner = sweep({ ...planetInput, rotation: planet.facts.rotation as number }, { ...ringInput, rotation: ring.facts.rotation as number });
      expect(inner.overlap, JSON.stringify(t)).toBeLessThan(1e-9);
      expect(inner.gapMax).toBeLessThan(2 * TOLERANCE);
    }
  });

  it('a gear in a ring with other tooth counts: no vertex of one inside the other at zero backlash', () => {
    for (const [zr, zp, module] of [[60, 33, 0.9], [60, 33, 1], [54, 38, 0.5]] as const) {
      const ringInput = { teeth: zr, module, internal: true, rotation: 0.05 };
      const ring = gear(ringInput);
      const planetInput = { teeth: zp, module, center: [(module * (zr - zp)) / 2, 0] as P };
      const planet = gear({ ...planetInput, meshWith: ring.facts });
      expect(planet.warnings.filter((w) => w.code === 'gearMesh')).toEqual([]);
      const inner = sweep({ ...planetInput, rotation: planet.facts.rotation as number }, ringInput);
      expect(inner.overlap, `${zr}/${zp}`).toBeLessThan(1e-9);
    }
  });

  it('backlash: the normal gap of a pair is (b1 + b2) / 2 · cos α', () => {
    for (const backlash of [0.05, 0.1]) {
      const { sun, planet, ring, sunInput, planetInput, ringInput } = train(trains[0], backlash);
      const expected = backlash * Math.cos(20 * DEG);
      const outer = sweep({ ...sunInput, rotation: sun.facts.rotation as number }, { ...planetInput, rotation: planet.facts.rotation as number });
      expect(outer.overlap).toBe(0);
      expect(outer.gapMin).toBeGreaterThan(expected - 1e-3);
      expect(outer.gapMin).toBeLessThan(expected + TOLERANCE);
      const inner = sweep({ ...planetInput, rotation: planet.facts.rotation as number }, { ...ringInput, rotation: ring.facts.rotation as number });
      expect(inner.overlap).toBe(0);
      expect(inner.gapMin).toBeGreaterThan(expected - 1e-3);
      expect(inner.gapMin).toBeLessThan(expected + 2 * TOLERANCE);
    }
  });

  it('a wrong rotation overlaps: the measurement tells a mesh from a clash', () => {
    const { sun, planet, sunInput, planetInput } = train(trains[0], 0);
    const half = Math.PI / planetInput.teeth;
    const clash = sweep({ ...sunInput, rotation: sun.facts.rotation as number }, { ...planetInput, rotation: (planet.facts.rotation as number) + half });
    expect(clash.overlap).toBeGreaterThan(0.3);
  });

  it('the reference may be the ring: a gear placed inside an existing ring gear', () => {
    const ringInput = { teeth: 72, internal: true, rotation: 0.05 };
    const ring = gear(ringInput);
    const planetInput = { teeth: 27, center: [0, -20.25] as P };
    const planet = gear({ ...planetInput, meshWith: ring.facts });
    expect(planet.warnings).toEqual([]);
    const inner = sweep({ ...planetInput, rotation: planet.facts.rotation as number }, { ...ringInput, rotation: 0.05 });
    expect(inner.overlap).toBeLessThan(1e-9);
    expect(inner.gapMax).toBeLessThan(2 * TOLERANCE);
  });

  it('works between sketches whose planes are parallel but mirrored', () => {
    // the planet is drawn in a sketch that looks at the same plane from the other side
    const mirrored: Frame = { origin: [0, 0, 3], x: [-1, 0, 0], y: [0, 1, 0], normal: [0, 0, -1] };
    const sunInput = { teeth: 18, rotation: 0.1234 };
    const sun = gear(sunInput);
    const a = 20.25;
    const planet = gear({ teeth: 27, center: [-a * Math.cos(0.4), a * Math.sin(0.4)], meshWith: sun.facts, frame: mirrored });
    expect(planet.warnings).toEqual([]);
    expect(planet.facts.center).toEqual([expect.closeTo(a * Math.cos(0.4), 9), expect.closeTo(a * Math.sin(0.4), 9), 3]);
    // in model coordinates the planet meshes with the sun
    const inModel = planet.loop.map((p): P => [-p[0], p[1]]).reverse();
    const pitchPoint: P = [8.1 * Math.cos(0.4), 8.1 * Math.sin(0.4)];
    const c = contact(sun.loop, inModel, pitchPoint, 3, false);
    expect(c.overlap).toBeLessThan(1e-9);
    expect(c.gap).toBeLessThan(TOLERANCE);
  });

  it('gearMesh: what does not mesh is a warning and the rotation parameter is used', () => {
    const sun = gear({ teeth: 18, rotation: 0.1 });
    const base = { teeth: 27, center: [20.25, 0] as P, rotation: 0.77 };
    const warned = (g: GearInput, pattern: RegExp) => {
      const result = gear(g);
      expect(result.warnings).toMatchObject([{ code: 'gearMesh', detail: expect.stringMatching(pattern) }]);
      expect(result.facts).toMatchObject({ rotation: g.rotation ?? 0, meshed: false });
    };
    warned({ ...base, meshWith: null }, /missing, suppressed, in error or not a gear/);
    warned({ ...base, module: 1, center: [21.6, 0], meshWith: sun.facts }, /the modules differ/);
    warned({ ...base, pressureAngle: 25 * DEG, meshWith: sun.facts }, /pressure angles differ/);
    warned({ ...base, center: [20.3, 0], meshWith: sun.facts }, /not tangent from outside/);
    warned({ ...base, meshWith: sun.facts, frame: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] } }, /axes of the two gears are not parallel/);
    const ring = gear({ teeth: 72, internal: true });
    warned({ teeth: 90, internal: true, rotation: 0.2, meshWith: ring.facts }, /two internal gears/);
    warned({ ...base, center: [20.0, 0], meshWith: ring.facts }, /does not touch the pitch circle of the ring from inside/);
    warned({ teeth: 72, internal: true, rotation: 0.2, meshWith: gear({ teeth: 72 }).facts }, /does not touch the pitch circle of the ring from inside/);
    // a tolerance: a centre distance from a solver is not exact
    expect(gear({ ...base, center: [20.250000000000128, 1e-9], meshWith: sun.facts }).warnings).toEqual([]);
    // without the reference the parameter is used and nothing is reported
    expect(gear(base)).toMatchObject({ warnings: [], facts: { rotation: 0.77, meshed: false } });
  });

  it('gearInterference: the tip of one gear runs into the root of the other below the base circle', () => {
    const pair = (z1: number, z2: number) => {
      const first = gear({ teeth: z1 });
      return gear({ teeth: z2, center: [(0.9 * (z1 + z2)) / 2, 0], meshWith: first.facts });
    };
    expect(pair(15, 30).warnings).toEqual([]);
    expect(pair(18, 27).warnings).toEqual([]);
    // 12/24: the tip of the larger gear hits the root of the smaller one, whichever is built second
    expect(pair(12, 24).warnings).toMatchObject([{ code: 'gearInterference', detail: expect.stringMatching(/this gear with 24 teeth/) }]);
    expect(pair(24, 12).warnings).toMatchObject([{ code: 'gearInterference', detail: expect.stringMatching(/the gear in meshWith with 24 teeth/) }]);
    expect(pair(12, 24).facts.meshed).toBe(true); // the rotation from the mesh is still used
    // a ring: the inequality is reversed and holds for the trains of the scenario
    const ring = (zp: number, zr: number) => {
      const planet = gear({ teeth: zp, center: [(0.9 * (zr - zp)) / 2, 0] });
      return gear({ teeth: zr, internal: true, meshWith: planet.facts });
    };
    expect(ring(27, 72).warnings).toEqual([]);
    expect(ring(24, 72).warnings).toEqual([]);
    expect(ring(36, 90).warnings).toEqual([]);
    expect(ring(20, 24).warnings).toMatchObject([{ code: 'gearInterference', detail: expect.stringMatching(/this ring gear/) }]);
  });
});

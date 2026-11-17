// The cycloidal disc of the generator catalog (D61) as a pure function: the published curve point for
// point, the placement at other input angles and with the angle of the pins checked against pins
// that do not move (the motion of a drive whose ring is fixed), the polygon inside the exact curve,
// the clearance, the failures, and the review's disc at the edge of undercut.
import { describe, expect, it } from 'vitest';
import { type GeneratorInput, MAX_PROFILE_POINTS, generateProfile } from '../src/generators';
import { smallestCurvatureRadius } from '../src/generators/cycloid';
import type { Frame, Vec2 } from '../src/types';

const XY: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] };
const TOLERANCE = 0.01;
type P = Vec2;
interface Disc {
  R?: number;
  pins?: number;
  pinRadius?: number;
  eccentricity?: number;
  clearance?: number;
  rotation?: number;
  pinAngle?: number;
  center?: P;
  frame?: Frame;
  chordTolerance?: number;
}
function input(d: Disc): GeneratorInput {
  return {
    operands: { circle: { kind: 'circle', center: d.center ?? [0, 0], radius: d.R ?? 25 } },
    params: { pins: d.pins ?? 12, pinRadius: d.pinRadius ?? 2.5, eccentricity: d.eccentricity ?? 1, clearance: d.clearance ?? 0, rotation: d.rotation ?? 0, pinAngle: d.pinAngle ?? 0 },
    refs: {},
    frame: d.frame ?? XY,
    chordTolerance: d.chordTolerance ?? TOLERANCE,
  };
}
const build = (d: Disc) => generateProfile('cycloidalDisc', input(d));
function disc(d: Disc) {
  const result = build(d);
  if (!result.ok) throw new Error(result.message);
  const xy = result.regions[0].outer.xy;
  return { ...result, loop: Array.from({ length: xy.length / 2 }, (_, i): P => [xy[2 * i], xy[2 * i + 1]]) };
}
const failure = (d: Disc): string => {
  const result = build(d);
  return result.ok ? '' : result.message;
};

const area = (loop: P[]): number => loop.reduce((sum, p, i) => sum + (p[0] * loop[(i + 1) % loop.length][1] - loop[(i + 1) % loop.length][0] * p[1]) / 2, 0);
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
const selfCrossing = (loop: P[]): boolean => {
  const o = (p: P, q: P, r: P) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const n = loop.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [loop[i], loop[(i + 1) % n], loop[j], loop[(j + 1) % n]];
      if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true;
    }
  return false;
};

// The published curve, written out again here (design.md, [S1]): the frame of the disc at the input
// angle 0, the ring centre at (−E, 0). It is the formula of the generator; what checks the frame,
// the orientation and the placement independently are the pins that stand still, below.
function published(R: number, rr: number, E: number, N: number, t: number): P {
  const psi = Math.atan2(Math.sin((1 - N) * t), R / (E * N) - Math.cos((1 - N) * t));
  return [R * Math.cos(t) - rr * Math.cos(t + psi) - E * Math.cos(N * t), -R * Math.sin(t) + rr * Math.sin(t + psi) + E * Math.sin(N * t)];
}
// The smallest gap between the polygon of a disc and pins that stand still, and whether a pin
// enters it. The pins are exact circles: the distance of a centre from the polygon less the radius.
function againstPins(loop: P[], d: Required<Pick<Disc, 'R' | 'pins' | 'pinRadius'>> & { pinAngle: number; center: P }): { gap: number; enters: boolean } {
  let [gap, enters] = [Infinity, false];
  for (let k = 0; k < d.pins; k++) {
    const angle = d.pinAngle + (2 * Math.PI * k) / d.pins;
    const pin: P = [d.center[0] + d.R * Math.cos(angle), d.center[1] + d.R * Math.sin(angle)];
    const distance = toBoundary(pin, loop) - d.pinRadius;
    if (inside(pin, loop) || distance < -1e-9) enters = true;
    gap = Math.min(gap, distance);
  }
  return { gap, enters };
}

describe('cycloidal disc: the profile', () => {
  it('the published curve point for point at the input angle 0, for pins larger by the compensation of the chords', () => {
    for (const d of [{}, { R: 40, pinRadius: 4, eccentricity: 1.5, pins: 16 }, { R: 30, pinRadius: 3, eccentricity: 2, pins: 10 }]) {
      const { R = 25, pinRadius = 2.5, eccentricity: E = 1, pins: N = 12 } = d as Disc;
      const { loop, regions } = disc(d);
      expect(regions[0].outer.side).toBe('lobes');
      expect(area(loop)).toBeGreaterThan(0); // counter-clockwise
      // the first point is the bottom on the x axis: (R − Rc − E, 0) from the centre of the disc at (E, 0)
      expect(loop[0][1]).toBeCloseTo(0, 12);
      const built = R - loop[0][0];
      expect(built - pinRadius).toBeGreaterThan(0);
      expect(built - pinRadius).toBeLessThanOrEqual(2 * TOLERANCE);
      // every point on the published curve for that radius, t running backwards (the curve is
      // clockwise): the parameter of each point is searched for after the one before
      const n = loop.length;
      expect(n % (N - 1)).toBe(0); // the same points on every lobe
      let t = 2 * Math.PI;
      for (let i = 1; i < n; i++) {
        const off = (s: number): number => {
          const p = published(R, built, E, N, s);
          return Math.hypot(loop[i][0] - (p[0] + E), loop[i][1] - p[1]);
        };
        let [best, bestOff] = [t, Infinity];
        for (let k = 1; k <= 400; k++) {
          const s = t - (k * 0.5) / 400;
          if (off(s) < bestOff) [best, bestOff] = [s, off(s)];
        }
        let [low, high] = [best - 0.5 / 400, best + 0.5 / 400];
        for (let k = 0; k < 80; k++) {
          const [m1, m2] = [low + (high - low) / 3, high - (high - low) / 3];
          if (off(m1) < off(m2)) high = m2;
          else low = m1;
        }
        t = (low + high) / 2;
        expect(off(t), `point ${i}`).toBeLessThan(1e-9);
      }
      expect(t).toBeGreaterThan(0); // the points run once round, in order
    }
  });

  it('the polygon lies inside the exact disc, at most twice the chord tolerance from it', () => {
    for (const [d, tolerance] of [[{}, 0.01], [{ clearance: 0.1 }, 0.01], [{ R: 30, pinRadius: 3, eccentricity: 2, pins: 10 }, 0.05], [{}, 0.001]] as [Disc, number][]) {
      const { R = 25, pinRadius = 2.5, eccentricity: E = 1, pins: N = 12, clearance = 0 } = d;
      const { loop } = disc({ ...d, chordTolerance: tolerance });
      let [entered, farthest] = [0, 0];
      const samples = 8_000;
      for (let i = 0; i < samples; i++) {
        const q = published(R, pinRadius + clearance, E, N, (2 * Math.PI * i) / samples);
        const p: P = [q[0] + E, q[1]];
        const distance = toBoundary(p, loop);
        if (inside(p, loop)) entered = Math.max(entered, distance);
        farthest = Math.max(farthest, distance);
      }
      expect(entered, JSON.stringify(d)).toBeLessThan(1e-9);
      expect(farthest).toBeLessThanOrEqual(2 * tolerance);
    }
  });

  it('the smallest radius of curvature in closed form against the curve sampled', () => {
    for (const [R, E, N] of [[25, 1, 12], [25, 2, 12], [40, 1.5, 16], [30, 2, 10], [20, 1.5, 8], [10, 0.5, 3]] as const) {
      let sampled = Infinity;
      const n = 400_000;
      for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / n;
        const [dx, dy] = [-R * Math.sin(t) + E * N * Math.sin(N * t), -R * Math.cos(t) + E * N * Math.cos(N * t)];
        const [ddx, ddy] = [-R * Math.cos(t) + E * N * N * Math.cos(N * t), R * Math.sin(t) - E * N * N * Math.sin(N * t)];
        const k = (dx * ddy - dy * ddx) / (dx * dx + dy * dy) ** 1.5;
        if (k < 0) sampled = Math.min(sampled, 1 / -k);
      }
      expect(smallestCurvatureRadius(R, E, N)).toBeCloseTo(sampled, 6);
    }
    // the review's limit (design.md, "The cycloidal disc")
    expect(smallestCurvatureRadius(25, 2, 12)).toBeCloseTo(2.57372, 5);
  });

  it('facts: lobes, ratio, diameters, the placement in the model', () => {
    const frame: Frame = { origin: [0, 0, 5], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] };
    const { facts, warnings } = disc({ center: [3, 4], rotation: Math.PI / 2, pinAngle: 0.1, clearance: 0.1, frame });
    expect(warnings).toEqual([]);
    expect(facts).toEqual({
      pins: 12,
      lobes: 11,
      ratio: 11,
      pinCircleDiameter: 50,
      pinDiameter: 5,
      eccentricity: 1,
      clearance: 0.1,
      outerDiameter: expect.closeTo(2 * (25 - 2.6 + 1), 12),
      innerDiameter: expect.closeTo(2 * (25 - 2.6 - 1), 12),
      rotation: Math.PI / 2,
      pinAngle: 0.1,
      discRotation: expect.closeTo(0.1 - (Math.PI / 2 - 0.1) / 11, 12),
      center: [0, expect.closeTo(3, 12), expect.closeTo(10, 12)],
      ringCenter: [0, 3, 9],
      axis: [1, 0, 0],
    });
  });
});

describe('cycloidal disc: in mesh with pins that stand still', () => {
  // A drive whose ring is fixed: the input turns, the disc moves round the eccentric and turns back.
  // The generator places the disc for each input angle; the pins never move. A step of a degree
  // over a full lobe of the input, and a few angles further round.
  const angles = [...Array.from({ length: 34 }, (_, i) => (i * 2 * Math.PI) / 11 / 33), 1, 2.5, Math.PI, 4, 5.9];
  it('every input angle: no pin enters the disc and the nearest is within twice the chord tolerance', () => {
    for (const rotation of angles) {
      const { loop, facts } = disc({ rotation });
      const { gap, enters } = againstPins(loop, { R: 25, pins: 12, pinRadius: 2.5, pinAngle: 0, center: [0, 0] });
      expect(enters, `input ${rotation}`).toBe(false);
      expect(gap, `input ${rotation}`).toBeLessThanOrEqual(2 * TOLERANCE);
      expect(facts.center).toEqual([expect.closeTo(Math.cos(rotation), 12), expect.closeTo(Math.sin(rotation), 12), 0]);
      expect(facts.discRotation).toBeCloseTo(-rotation / 11, 12);
    }
  });

  it('the turn of the disc is the one that meshes: the opposite one enters the pins', () => {
    // a disc at the input angle 1 but turned the other way (+1/11 instead of −1/11): built at the
    // input angle 1 with pins turned so that the disc turns by +1/11
    const wrong = disc({ rotation: 1, pinAngle: 2 / 12 }).loop;
    expect(againstPins(wrong, { R: 25, pins: 12, pinRadius: 2.5, pinAngle: 0, center: [0, 0] }).enters).toBe(true);
  });

  it('pins at another angle: the disc follows `pinAngle`; without it, it enters them', () => {
    const pinAngle = (15 * Math.PI) / 180; // half a pitch of 12 pins
    for (const rotation of [0, 0.4, Math.PI / 2, 3]) {
      const { loop, facts } = disc({ rotation, pinAngle, center: [5, -2] });
      expect(againstPins(loop, { R: 25, pins: 12, pinRadius: 2.5, pinAngle, center: [5, -2] })).toMatchObject({ enters: false });
      expect(facts.discRotation).toBeCloseTo(pinAngle - (rotation - pinAngle) / 11, 12);
      expect(againstPins(disc({ rotation, center: [5, -2] }).loop, { R: 25, pins: 12, pinRadius: 2.5, pinAngle, center: [5, -2] }).enters).toBe(true);
    }
    // at the input angle 0 the disc is turned by 15° · 12/11 = π/11
    expect(disc({ pinAngle }).facts.discRotation).toBeCloseTo(Math.PI / 11, 12);
  });

  it('the second disc of a two-disc drive is the profile at the input angle + π', () => {
    for (const rotation of [0, 0.3]) {
      const { loop } = disc({ rotation: rotation + Math.PI });
      expect(againstPins(loop, { R: 25, pins: 12, pinRadius: 2.5, pinAngle: 0, center: [0, 0] }).enters).toBe(false);
    }
  });

  it('a clearance keeps the disc that far from the pins', () => {
    for (const rotation of [0, 1, 2]) {
      const { gap, enters } = againstPins(disc({ rotation, clearance: 0.1 }).loop, { R: 25, pins: 12, pinRadius: 2.5, pinAngle: 0, center: [0, 0] });
      expect(enters).toBe(false);
      expect(gap).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(gap).toBeLessThan(0.1 + 2 * TOLERANCE);
    }
  });
});

describe('cycloidal disc: what cannot be built', () => {
  it('fails with a reason', () => {
    // E · N = 36 ≥ R = 25: the curve of the pin centres loops
    expect(failure({ eccentricity: 3 })).toMatch(/the eccentricity times the number of pins \(36\) is not below the radius of the pin circle 25/);
    expect(failure({ eccentricity: 25 / 12 })).toMatch(/loops/); // exactly at the limit
    // pins of radius 7 overlap: they touch at R sin(π/12) = 6.4705
    expect(failure({ pinRadius: 7 })).toMatch(/the pins overlap one another: .* below 6\.470/);
    expect(failure({ pinRadius: 25 * Math.sin(Math.PI / 12) })).toMatch(/overlap/);
    // undercut: the pins larger than the smallest radius of curvature (2.57372 for R 25, N 12, E 2)
    expect(failure({ eccentricity: 2, pinRadius: 2.6 })).toMatch(/turns back on itself \(undercut\).*below 2\.57372/);
    // the clearance counts: pins that pass, larger by the clearance, do not
    expect(failure({ eccentricity: 2, pinRadius: 2.5 })).toBe('');
    expect(failure({ eccentricity: 2, pinRadius: 2.5, clearance: 0.1 })).toMatch(/undercut.*with the clearance 0\.1/);
    // The bottoms at the centre (R − Rr − E ≤ 0) is a guard: in every drive tried the pins overlap
    // or undercut comes first, as here.
    expect(failure({ R: 4, pins: 3, eccentricity: 1.2, pinRadius: 3 })).toMatch(/undercut/);
    // too many points
    expect(failure({ pins: 500, R: 600, pinRadius: 2, eccentricity: 1, chordTolerance: 1e-7 })).toMatch(new RegExp(`would need more than ${MAX_PROFILE_POINTS} points`));
  });

  it('the review\'s disc just inside the limit of undercut: built with more points or refused, never past the limit', () => {
    const d: Disc = { eccentricity: 2, pinRadius: 2.5737 };
    const limit = smallestCurvatureRadius(25, 2, 12);
    expect(d.pinRadius).toBeLessThan(limit);
    const result = build(d);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const xy = result.regions[0].outer.xy;
      const loop = Array.from({ length: xy.length / 2 }, (_, i): P => [xy[2 * i], xy[2 * i + 1]]);
      expect(25 - loop[0][0]).toBeLessThan(limit); // the radius built
      expect(loop.length).toBeGreaterThan(2000);
      expect(loop.length).toBeLessThanOrEqual(MAX_PROFILE_POINTS);
      // one lobe is enough to see a crossing: the polygon repeats with the lobes
      expect(selfCrossing(loop.slice(0, loop.length / 11 + 2))).toBe(false);
    }
    // with a coarse tolerance the compensation alone would pass the limit: the polygon is refined
    const coarse = build({ ...d, chordTolerance: 0.05 });
    expect(coarse.ok).toBe(true);
    if (coarse.ok) expect(25 - coarse.regions[0].outer.xy[0]).toBeLessThan(limit);
    // a hair closer to the limit it cannot be refined within the limit of points: refused, never past it
    expect(failure({ eccentricity: 2, pinRadius: limit - 1e-9 })).toMatch(/the disc is within the chord tolerance of the limit of undercut/);
  });
});

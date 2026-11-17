// The GT2 pulley of the generator catalog (D61) as a pure function: the diameters against Gates'
// table, the groove of arcs (tangent joints, depth, widths), the polygon inside the exact outline,
// the allowance and the placement.
import { describe, expect, it } from 'vitest';
import { type GeneratorInput, generateProfile } from '../src/generators';
import { GT2_GROOVE, grooveArcs } from '../src/generators/gt2';
import type { Frame, Vec2 } from '../src/types';

const XY: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] };
const TOLERANCE = 0.01;
type P = Vec2;
interface Pulley {
  teeth: number;
  allowance?: number;
  rotation?: number;
  at?: P;
  frame?: Frame;
  chordTolerance?: number;
}
const input = (g: Pulley): GeneratorInput => ({
  operands: { center: { kind: 'point', at: g.at ?? [0, 0] } },
  params: { teeth: g.teeth, allowance: g.allowance ?? 0, rotation: g.rotation ?? 0 },
  refs: {},
  frame: g.frame ?? XY,
  chordTolerance: g.chordTolerance ?? TOLERANCE,
});
function pulley(g: Pulley) {
  const result = generateProfile('gt2Pulley', input(g));
  if (!result.ok) throw new Error(result.message);
  const xy = result.regions[0].outer.xy;
  return { ...result, loop: Array.from({ length: xy.length / 2 }, (_, i): P => [xy[2 * i], xy[2 * i + 1]]) };
}
const failure = (g: Pulley): string => {
  const result = generateProfile('gt2Pulley', input(g));
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

// The exact outline of one groove and the land after it, written out from the words of the design
// (design.md, "The GT2 pulley"), independently of the generator: the circles, their tangent points
// by the rules of tangency, a dense polyline. Axis of the groove along +y.
function exactPitch(teeth: number, a = 0, n = 400): { points: P[]; tip: number; tangents: P[] } {
  const tip = teeth / Math.PI - 0.254;
  const c0: P = [0, tip - 0.75 + 0.555];
  const c1: P = [-0.4, c0[1] + Math.sqrt(0.445 ** 2 - 0.16)];
  // the fillet centre: radius tip − 0.15 from the centre and 1.15 from c1, x > 0; by bisection
  const rf = tip - 0.15;
  const off = (phi: number) => Math.hypot(rf * Math.sin(phi) - c1[0], rf * Math.cos(phi) - c1[1]) - 1.15;
  let [lo, hi] = [0, Math.PI / 4];
  for (let i = 0; i < 200; i++) [lo, hi] = off((lo + hi) / 2) < 0 ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
  const cf: P = [rf * Math.sin(lo), rf * Math.cos(lo)];
  const unit = (p: P, q: P): P => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [(q[0] - p[0]) / d, (q[1] - p[1]) / d];
  };
  const along = (c: P, u: P, r: number): P => [c[0] + r * u[0], c[1] + r * u[1]];
  const [r0, r1, rs, rt] = [0.555 - a, 1 - a, 0.15 + a, tip + a];
  const t01 = along(c1, unit(c1, c0), r1);
  const t1f = along(c1, unit(c1, cf), r1);
  const tft = along([0, 0], unit([0, 0], cf), rt);
  const arc = (c: P, r: number, from: P, to: P, ccw: boolean): P[] => {
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    let d = Math.atan2(to[1] - c[1], to[0] - c[0]) - a0;
    if (ccw) while (d <= 0) d += 2 * Math.PI;
    else while (d >= 0) d -= 2 * Math.PI;
    return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos(a0 + (d * i) / n), c[1] + r * Math.sin(a0 + (d * i) / n)] as P);
  };
  const m = (p: P): P => [-p[0], p[1]];
  const step = (2 * Math.PI) / teeth;
  const nextTft: P = [rt * Math.cos(Math.PI / 2 + step - Math.atan2(tft[0], tft[1])), rt * Math.sin(Math.PI / 2 + step - Math.atan2(tft[0], tft[1]))];
  const points = [
    ...arc(cf, rs, tft, t1f, true),
    ...arc(c1, r1, t1f, t01, false),
    ...arc(c0, r0, t01, m(t01), false),
    ...arc(m(c1), r1, m(t01), m(t1f), false),
    ...arc(m(cf), rs, m(t1f), m(tft), true),
    ...arc([0, 0], rt, m(tft), nextTft, true),
  ];
  return { points, tip, tangents: [tft, t1f, t01] };
}
const turned = (p: P, angle: number): P => [p[0] * Math.cos(angle) - p[1] * Math.sin(angle), p[0] * Math.sin(angle) + p[1] * Math.cos(angle)];
function exactOutline(teeth: number, a = 0, rotation = 0, n = 400): P[] {
  const { points } = exactPitch(teeth, a, n);
  return Array.from({ length: teeth }, (_, k) => points.map((p) => turned(p, rotation + (k * 2 * Math.PI) / teeth - Math.PI / 2))).flat();
}

describe('GT2 pulley', () => {
  it('the diameters: the outside diameters of Gates\' table, the pitch diameter, the root circle', () => {
    const gates: [number, number, number][] = [[12, 7.64, 7.13], [20, 12.73, 12.22], [30, 19.1, 18.59], [40, 25.46, 24.96]];
    for (const [teeth, pd, od] of gates) {
      const { facts, loop } = pulley({ teeth });
      expect(facts.pitchDiameter).toBeCloseTo((2 * teeth) / Math.PI, 12);
      expect(Math.abs((facts.pitchDiameter as number) - pd)).toBeLessThan(0.005);
      expect(Math.abs((facts.outsideDiameter as number) - od)).toBeLessThan(0.005);
      expect(facts.outsideDiameter).toBeCloseTo((2 * teeth) / Math.PI - 0.508, 12);
      expect(facts.rootDiameter).toBeCloseTo((facts.outsideDiameter as number) - 1.5, 12);
      // the polygon: the tip circle on the outside; the bottom is made of tangents, so its corners
      // lie within the tolerance of the root circle, on either side of it
      const radii = loop.map((p) => Math.hypot(...p));
      expect(Math.max(...radii)).toBeCloseTo((facts.outsideDiameter as number) / 2, 9);
      expect(Math.abs(Math.min(...radii) - (facts.rootDiameter as number) / 2)).toBeLessThan(TOLERANCE);
    }
  });

  it('the groove: four kinds of arcs joined tangentially, 0.75 deep, the widths of the design', () => {
    for (const teeth of [12, 20, 60]) {
      const tip = teeth / Math.PI - 0.254;
      for (const a of [0, 0.05, -0.05]) {
        const arcs = grooveArcs(tip, a);
        if (typeof arcs === 'string') throw new Error(arcs);
        const end = (arc: (typeof arcs)[number], which: 'from' | 'to'): P => [arc.center[0] + arc.radius * Math.cos(arc[which]), arc.center[1] + arc.radius * Math.sin(arc[which])];
        // each arc starts where the one before ends, and the two circles touch there
        for (let k = 1; k < arcs.length; k++) {
          const [p, q] = [end(arcs[k - 1], 'to'), end(arcs[k], 'from')];
          expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-12);
          const apart = Math.hypot(arcs[k].center[0] - arcs[k - 1].center[0], arcs[k].center[1] - arcs[k - 1].center[1]);
          const touch = arcs[k].convex === arcs[k - 1].convex ? Math.abs(arcs[k].radius - arcs[k - 1].radius) : arcs[k].radius + arcs[k - 1].radius;
          expect(apart).toBeCloseTo(touch, 12);
        }
        // the first fillet touches the tip circle from inside
        expect(Math.hypot(...end(arcs[0], 'from'))).toBeCloseTo(tip + a, 12);
        // the bottom is 0.75 below the tip circle; the centre of a flank 0.4 to the other side of the axis
        const bottom = arcs[2];
        expect(tip + a - (bottom.center[1] - bottom.radius)).toBeCloseTo(GT2_GROOVE.depth, 12);
        expect(arcs[1].center[0]).toBeCloseTo(-0.4, 12);
        expect(arcs[3].center[0]).toBeCloseTo(0.4, 12);
      }
    }
    // against the exact construction of the test, and the widths the design measured
    for (const [teeth, width] of [[12, 1.518], [60, 1.488]] as const) {
      const { tangents } = exactPitch(teeth);
      expect(2 * tangents[0][0]).toBeCloseTo(width, 3);
      const arcs = grooveArcs(teeth / Math.PI - 0.254, 0) as Exclude<ReturnType<typeof grooveArcs>, string>;
      const tft: P = [arcs[0].center[0] + 0.15 * Math.cos(arcs[0].from), arcs[0].center[1] + 0.15 * Math.sin(arcs[0].from)];
      expect(Math.hypot(tft[0] - tangents[0][0], tft[1] - tangents[0][1])).toBeLessThan(1e-12);
    }
    // the land between two grooves at 12 grooves
    const { tip, tangents } = exactPitch(12);
    expect(tip * ((2 * Math.PI) / 12 - 2 * Math.atan2(tangents[0][0], tangents[0][1]))).toBeCloseTo(0.337, 3);
  });

  it('the polygon lies inside the exact outline, at most the chord tolerance from it', () => {
    for (const [teeth, a, rotation, tolerance] of [[20, 0, 0, 0.01], [12, 0, 0.3, 0.01], [40, 0.1, 0, 0.01], [20, -0.1, 1, 0.001], [20, 0, 0, 0.05]] as const) {
      const { loop } = pulley({ teeth, allowance: a, rotation, chordTolerance: tolerance });
      expect(area(loop)).toBeGreaterThan(0); // counter-clockwise
      expect(loop.length % teeth).toBe(0); // the same points in every groove
      const exact = exactOutline(teeth, a, rotation, 60);
      let [entered, farthest] = [0, 0];
      for (const p of exact) {
        const distance = toBoundary(p, loop);
        if (inside(p, loop)) entered = Math.max(entered, distance);
        farthest = Math.max(farthest, distance);
      }
      expect(entered, `${teeth} ${a} ${rotation}`).toBeLessThan(1e-9);
      expect(farthest).toBeLessThanOrEqual(tolerance + 1e-9);
      // the area of the polygon is below that of the exact outline, by less than the tolerance along it
      const length = exact.reduce((sum, p, i) => sum + Math.hypot(exact[(i + 1) % exact.length][0] - p[0], exact[(i + 1) % exact.length][1] - p[1]), 0);
      expect(area(loop)).toBeLessThan(area(exact));
      expect(area(exact) - area(loop)).toBeLessThan(length * tolerance);
    }
    // the exact areas the design measured (400 points an arc)
    expect(area(exactOutline(20))).toBeCloseTo(103.02, 2);
    expect(area(exactOutline(40))).toBeCloseTo(460.278, 2);
  });

  it('the allowance moves the outline: the diameters by twice it, the area grows; what vanishes is refused', () => {
    const plain = pulley({ teeth: 20 });
    const grown = pulley({ teeth: 20, allowance: 0.1 });
    expect(grown.facts.outsideDiameter).toBeCloseTo((plain.facts.outsideDiameter as number) + 0.2, 12);
    expect(grown.facts.rootDiameter).toBeCloseTo((plain.facts.rootDiameter as number) + 0.2, 12);
    expect(area(grown.loop)).toBeGreaterThan(area(plain.loop));
    expect(area(pulley({ teeth: 20, allowance: -0.1 }).loop)).toBeLessThan(area(plain.loop));
    expect(failure({ teeth: 20, allowance: 0.555 })).toMatch(/makes the bottom of the grooves vanish; it must stay below 0\.555/);
    expect(failure({ teeth: 20, allowance: -0.15 })).toMatch(/makes the fillets at the tips vanish; it must stay above -0\.15/);
    expect(failure({ teeth: 20, allowance: 0.5 })).toBe('');
    expect(failure({ teeth: 20, allowance: -0.14 })).toBe('');
  });

  it('placement: at the point, the axis of one groove at the rotation; facts in model coordinates', () => {
    const frame: Frame = { origin: [0, 0, 5], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] };
    const { facts, loop, warnings, regions } = pulley({ teeth: 20, at: [3, 4], rotation: 0.3, frame });
    expect(warnings).toEqual([]);
    expect(regions[0].outer.side).toBe('grooves');
    expect(facts).toEqual({
      teeth: 20,
      pitch: 2,
      pitchDiameter: expect.closeTo(40 / Math.PI, 12),
      outsideDiameter: expect.closeTo(40 / Math.PI - 0.508, 12),
      rootDiameter: expect.closeTo(40 / Math.PI - 0.508 - 1.5, 12),
      allowance: 0,
      rotation: 0.3,
      center: [0, 3, 9],
      axis: [1, 0, 0],
    });
    // the deepest points of the polygon lie on the axis of a groove: one of them at the angle 0.3
    const radii = loop.map((p) => Math.hypot(p[0] - 3, p[1] - 4));
    const deepest = loop[radii.indexOf(Math.min(...radii))];
    const angle = Math.atan2(deepest[1] - 4, deepest[0] - 3);
    const offset = (((angle - 0.3) % (Math.PI / 10)) + Math.PI / 10) % (Math.PI / 10);
    expect(Math.min(offset, Math.PI / 10 - offset)).toBeLessThan(0.05);
  });
});

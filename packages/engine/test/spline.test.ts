// The geometry of a spline (D70, spline.ts): the Bezier pieces, the polyline within the chord
// tolerance, the points the curve passes and its box (docs/d36/6d-sketch-spline/design.md,
// "Measured", A, G and H).
import { describe, expect, it } from 'vitest';
import { MAX_SPLINE_PIECES, bezierAt, bsplineBeziers, splineBeziers, splineBox, splinePieces, splinePolyline, splineThrough } from '../src/spline';
import type { Vec2 } from '../src/types';
import { LENGTH_TOLERANCE } from '../src/util';

// A deterministic generator (mulberry32).
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The point of a B-spline at the parameter u by de Boor's algorithm, the reference the pieces are
// compared with.
function deBoor(control: readonly Vec2[], knots: readonly number[], p: number, u: number): Vec2 {
  let k = p;
  while (k + 1 < knots.length - p - 1 && knots[k + 1] <= u) k++;
  const d = Array.from({ length: p + 1 }, (_, j): Vec2 => [...control[j + k - p]] as Vec2);
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const alpha = (u - knots[i]) / (knots[i + p - r + 1] - knots[i]);
      d[j] = [(1 - alpha) * d[j - 1][0] + alpha * d[j][0], (1 - alpha) * d[j - 1][1] + alpha * d[j][1]];
    }
  }
  return d[p];
}
const uniformKnots = (n: number): number[] => {
  const p = Math.min(3, n - 1);
  const m = n - p;
  return [...Array<number>(p + 1).fill(0), ...Array.from({ length: m - 1 }, (_, i) => i + 1), ...Array<number>(p + 1).fill(m)];
};
const near = (a: Vec2, b: readonly number[], tolerance = 1e-9): boolean => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
const segmentDistance = (p: Vec2, a: Vec2, b: Vec2): number => {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const length = d[0] * d[0] + d[1] * d[1];
  const t = length > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / length)) : 0;
  return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t);
};
// The largest distance of the curve (40 samples per straight piece of each Bezier piece) from the
// polyline: each sample against the pieces of the polyline near the one it is drawn by.
function deviation(control: readonly Vec2[], tolerance: number): number {
  const line = splinePolyline(control, tolerance);
  let worst = 0;
  let at = 0;
  for (const piece of splineBeziers(control)) {
    const steps = splinePieces(piece, tolerance) * 40;
    for (let s = 0; s <= steps; s++) {
      const q = bezierAt(piece, s / steps);
      let best = Infinity;
      let bestAt = at;
      for (let k = Math.max(0, at - 3); k < Math.min(line.length - 1, at + 4); k++) {
        const d = segmentDistance(q, line[k], line[k + 1]);
        if (d < best) [best, bestAt] = [d, k];
      }
      at = bestAt;
      worst = Math.max(worst, best);
    }
  }
  return worst;
}

// The grip of scenario 15 pulled in by 4: its control points.
const GRIP: Vec2[] = [
  [42, 5],
  [42, 15],
  [38, 27],
  [42, 39],
  [42, 49],
];
const SQUARE: Vec2[] = [
  [10, 0],
  [30, 0],
  [30, 20],
  [10, 20],
  [10, 0],
];

describe('the Bezier pieces of a spline', () => {
  it('evaluate to the B-spline (de Boor) at random parameters, for uniform and non-uniform knots', () => {
    const next = random(7);
    for (let run = 0; run < 200; run++) {
      const n = 3 + Math.floor(next() * 8);
      const p = run % 2 === 0 ? Math.min(3, n - 1) : 1 + Math.floor(next() * Math.min(3, n - 1));
      const control = Array.from({ length: n }, (): Vec2 => [next() * 100, next() * 100]);
      // uniform for even runs, random non-decreasing inner knots (some repeated) for odd ones
      let knots: number[];
      if (run % 2 === 0 && p === Math.min(3, n - 1)) knots = uniformKnots(n);
      else {
        // inner knots in (0, 3), some repeated, none more than p times (a continuous curve)
        const inner: number[] = [];
        while (inner.length < n - p - 1) {
          const u = (1 + Math.floor(next() * 29)) / 10;
          if (inner.filter((v) => v === u).length < p) inner.push(u);
        }
        inner.sort((x, y) => x - y);
        knots = [...Array<number>(p + 1).fill(0), ...inner, ...Array<number>(p + 1).fill(3)];
      }
      const pieces = bsplineBeziers(control, knots, p);
      const spans = [...new Set(knots)].sort((x, y) => x - y);
      expect(pieces.length).toBe(spans.length - 1);
      pieces.forEach((piece, j) => {
        expect(piece.length).toBe(p + 1);
        for (const t of [0, 0.3, 0.71, 1]) {
          const u = spans[j] + t * (spans[j + 1] - spans[j]);
          expect(near(bezierAt(piece, t), deBoor(control, knots, p, t === 1 ? u - 1e-12 : u), 1e-6)).toBe(true);
        }
      });
    }
  });

  it('a spline of four points is one cubic Bezier piece over them, three points one quadratic', () => {
    const four: Vec2[] = [
      [0, 0],
      [10, 0],
      [0, 10],
      [10, 10],
    ];
    expect(splineBeziers(four)).toEqual([four]);
    expect(splineBeziers(four.slice(0, 3))).toEqual([four.slice(0, 3)]);
  });

  it('the grip has two pieces joined at (40, 27)', () => {
    const pieces = splineBeziers(GRIP);
    expect(pieces).toHaveLength(2);
    expect(near(pieces[0][1], [42, 15])).toBe(true);
    expect(near(pieces[0][2], [40, 21])).toBe(true);
    expect(near(pieces[0][3], [40, 27])).toBe(true);
    expect(near(pieces[1][3], [42, 49])).toBe(true);
  });
});

describe('the polyline of a spline', () => {
  it('keeps the chord tolerance on random splines, with exact ends (measured A)', () => {
    const next = random(11);
    let worst = 0;
    for (let run = 0; run < 300; run++) {
      const n = 3 + Math.floor(next() * 8);
      const control = Array.from({ length: n }, (): Vec2 => [next() * 100, next() * 100]);
      const tolerance = [0.1, 0.01, 0.001][run % 3];
      const line = splinePolyline(control, tolerance);
      expect(line[0]).toEqual(control[0]);
      expect(line[line.length - 1]).toEqual(control[n - 1]);
      worst = Math.max(worst, deviation(control, tolerance) / tolerance);
    }
    expect(worst).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('the grip: 6 + 6 straight pieces at 0.1, 19 + 19 at 0.01, 58 + 58 at 0.001', () => {
    expect(splinePolyline(GRIP, 0.1)).toHaveLength(13);
    expect(splinePolyline(GRIP, 0.01)).toHaveLength(39);
    expect(splinePolyline(GRIP, 0.001)).toHaveLength(117);
  });

  it('the polyline of the reversed control points is the polyline reversed', () => {
    const line = splinePolyline(GRIP, 0.01);
    const back = splinePolyline([...GRIP].reverse(), 0.01).reverse();
    line.forEach((q, i) => expect(near(q, back[i], 1e-12)).toBe(true));
  });

  it('has no piece at or below the length tolerance where control points are at one place (measured G)', () => {
    const control: Vec2[] = [
      [0, 0],
      [10, 5],
      [10, 5],
      [10, 5],
      [20, 0],
    ];
    for (const tolerance of [0.01, 1e-4, 1e-5]) {
      const line = splinePolyline(control, tolerance);
      for (let k = 0; k + 1 < line.length; k++) expect(Math.hypot(line[k + 1][0] - line[k][0], line[k + 1][1] - line[k][1])).toBeGreaterThan(LENGTH_TOLERANCE);
      expect(deviation(control, tolerance)).toBeLessThanOrEqual(tolerance + LENGTH_TOLERANCE);
    }
  });

  it('caps the steps of one piece', () => {
    expect(splinePieces(GRIP.slice(0, 4), 1e-30)).toBe(MAX_SPLINE_PIECES);
    expect(splinePieces([[0, 0], [1, 1], [2, 2]], 0.01)).toBe(1);
  });
});

describe('where a spline runs (measured H)', () => {
  it('the grip passes its ends, the joint (40, 27) and the middle of each piece; its box is half as deep as its control points', () => {
    const through = splineThrough(GRIP);
    expect(through).toHaveLength(5);
    [[42, 5], [41, 17.5], [40, 27], [41, 36.5], [42, 49]].forEach((q, i) => expect(near(through[i], q, 1e-9)).toBe(true));
    const box = splineBox(GRIP);
    [40, 5, 42, 49].forEach((v, i) => expect(box[i]).toBeCloseTo(v, 9));
  });

  it('the closed square passes (25, 15) and its box is 10 to 27.78 by 0 to 17.78', () => {
    const through = splineThrough(SQUARE);
    expect(through).toHaveLength(5);
    [[10, 0], [26.875, 5.625], [25, 15], [15.625, 16.875], [10, 0]].forEach((q, i) => expect(near(through[i], q, 1e-9)).toBe(true));
    const box = splineBox(SQUARE);
    expect(box[0]).toBeCloseTo(10, 9);
    expect(box[1]).toBeCloseTo(0, 9);
    expect(box[2]).toBeCloseTo(27.78, 2);
    expect(box[3]).toBeCloseTo(17.78, 2);
  });

  it('one cubic piece has its two ends and its middle', () => {
    const s: Vec2[] = [
      [0, 0],
      [10, 0],
      [0, 10],
      [10, 10],
    ];
    const through = splineThrough(s);
    expect(through).toHaveLength(3);
    expect(near(through[1], [5, 5])).toBe(true);
  });

  it('the box holds every point of the curve and lies in the box of the control points (random splines)', () => {
    const next = random(3);
    for (let run = 0; run < 300; run++) {
      const n = 3 + Math.floor(next() * 8);
      const control = Array.from({ length: n }, (): Vec2 => [next() * 100, next() * 100]);
      const box = splineBox(control);
      const xs = control.map((q) => q[0]);
      const ys = control.map((q) => q[1]);
      expect(box[0]).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-12);
      expect(box[2]).toBeLessThanOrEqual(Math.max(...xs) + 1e-12);
      expect(box[1]).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-12);
      expect(box[3]).toBeLessThanOrEqual(Math.max(...ys) + 1e-12);
      const line = splinePolyline(control, 1e-5);
      let gap = 0;
      for (const q of line) gap = Math.max(gap, box[0] - q[0], q[0] - box[2], box[1] - q[1], q[1] - box[3]);
      expect(gap).toBeLessThanOrEqual(1e-5 + 1e-9);
    }
  });
});

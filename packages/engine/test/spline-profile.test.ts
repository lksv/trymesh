// The profile of a sketch with splines (D70): a spline as one shape over its polyline, its self-test,
// closed splines, the half-edges at a vertex, `Loop.sampled`, the comparison with the chain of
// lines through the polyline (docs/d36/6d-sketch-spline/design.md, "The profile" and "Measured").
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyDocument, emptySketch } from '../src/document';
import { type Loop, type Region, type SketchGeometry, detectProfile } from '../src/sketch';
import { splinePolyline } from '../src/spline';
import type { Command, Curve, Document, SketchFeature, Vec2 } from '../src/types';

type Entry = [id: string, curve: Curve, radius?: number];
function sketch(points: Record<string, [number, number]>, curves: Entry[], constraints: Command[] = []): SketchFeature {
  const commands: Command[] = [
    { type: 'addFeature', feature: emptySketch('S', 'S', { kind: 'base', plane: 'XY' }) },
    ...Object.entries(points).map(([id, [x, y]]): Command => ({ type: 'addPoint', sketch: 'S', id, x, y })),
    ...curves.map(([id, curve, radius]): Command => ({ type: 'addCurve', sketch: 'S', id, curve, ...(radius === undefined ? {} : { radius }) })),
    ...constraints,
  ];
  return commands.reduce<Document>(applyCommand, emptyDocument()).features[0] as SketchFeature;
}
const geometry = (s: SketchFeature): SketchGeometry => ({ points: { origin: { x: 0, y: 0 }, ...s.points }, radii: { ...s.radii } });
const profile = (s: SketchFeature, tolerance = 0.01) => detectProfile(s, geometry(s), tolerance);
const line = (a: string, b: string): Curve => ({ type: 'line', a, b });
const spline = (...points: string[]): Curve => ({ type: 'spline', points });
const arc = (center: string, start: string, end: string): Curve => ({ type: 'arc', center, start, end });
const signed = (loop: Loop): number => {
  let sum = 0;
  const n = loop.xy.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += loop.xy[2 * i] * loop.xy[2 * j + 1] - loop.xy[2 * j] * loop.xy[2 * i + 1];
  }
  return sum / 2;
};
const areaOf = (region: Region): number => Math.abs(signed(region.outer)) - region.holes.reduce((sum, hole) => sum + Math.abs(signed(hole)), 0);
const regionsOf = (s: SketchFeature, tolerance = 0.01): string[] => profile(s, tolerance).regions.map((r) => r.ref.outerLoop.join(','));

// The lid of scenario 15 with both grips as own geometry, at the solved positions (W 84, H 54, R 5,
// the legs 10, the middle control point pulled in by `grip`).
function lid(grip = 4): SketchFeature {
  const points: Record<string, [number, number]> = {
    a1: [37, 0],
    q1: [37, 5],
    a2: [42, 5],
    g1: [42, 15],
    g2: [42 - grip, 27],
    g3: [42, 39],
    a3: [42, 49],
    q2: [37, 49],
    a4: [37, 54],
  };
  for (const [id, [x, y]] of Object.entries({ ...points })) points[`${id}m`] = [-x, y];
  return sketch(points, [
    ['c1', line('a1m', 'a1')],
    ['r1', arc('q1', 'a1', 'a2')],
    ['c2', spline('a2', 'g1', 'g2', 'g3', 'a3')],
    ['r2', arc('q2', 'a3', 'a4')],
    ['c3', line('a4', 'a4m')],
    ['r2m', arc('q2m', 'a4m', 'a3m')],
    ['c2m', spline('a3m', 'g3m', 'g2m', 'g1m', 'a2m')],
    ['r1m', arc('q1m', 'a2m', 'a1m')],
  ]);
}
const LID = 84 * 54 - (4 - Math.PI) * 25;

describe('the profile of a sketch with a spline', () => {
  it('the lid with two grips is one region whose loop has no exact curves and names the splines (measured B)', () => {
    const p = profile(lid());
    expect(p.valid).toBe(true);
    expect(p.regions).toHaveLength(1);
    const region = p.regions[0];
    expect(region.ref.outerLoop).toEqual(['c1', 'c2', 'c2m', 'c3', 'r1', 'r1m', 'r2', 'r2m']);
    expect(region.outer.exact).toBeUndefined();
    expect([...(region.outer.sampled ?? [])].sort()).toEqual(['c2', 'c2m']);
    // by hand 4436.1398; the polygon at 0.01 is 0.2352 below, at 0.001 0.0249
    expect(areaOf(region)).toBeCloseTo(LID - 2 * 9.8 * 4 - 0.2352, 3);
    expect(areaOf(profile(lid(), 0.001).regions[0])).toBeCloseTo(LID - 2 * 9.8 * 4 - 0.0249, 3);
    // the points of the polyline are keyed by the spline and their index
    expect(region.outer.keys.filter((key) => key.startsWith('c:c2:'))).toHaveLength(37);
  });

  it('a region away from the splines of its sketch keeps its exact curves', () => {
    const s = sketch(
      { p1: [0, 0], p2: [10, 0], p3: [10, 10], p4: [0, 10], s1: [20, 0], s2: [30, 0], s3: [30, 10], s4: [20, 10] },
      [
        ['l1', line('p1', 'p2')],
        ['l2', line('p2', 'p3')],
        ['l3', line('p3', 'p4')],
        ['l4', line('p4', 'p1')],
        ['sp', spline('s1', 's2', 's3', 's4', 's1')],
      ],
    );
    const p = profile(s);
    expect(p.valid).toBe(true);
    const square = p.regions.find((r) => r.ref.outerLoop.includes('l1')) as Region;
    expect(square.outer.exact).toHaveLength(4);
    expect(square.outer.sampled).toBeUndefined();
    expect(p.regions.find((r) => r.ref.outerLoop.includes('sp'))?.outer.sampled).toEqual(['sp']);
  });

  it('a tangent join to a line (the second control point on its extension) is valid with one region', () => {
    const s = sketch(
      { a: [0, 0], b: [20, 0], c: [26, 0], d: [30, 15], e: [0, 15] },
      [
        ['l', line('a', 'b')],
        ['sp', spline('b', 'c', 'd', 'e')],
        ['m', line('e', 'a')],
      ],
    );
    expect(regionsOf(s)).toEqual(['l,m,sp']);
    // the cusp of a second control point behind the end: valid too (measured I), nothing reports it
    const cusp = sketch(
      { a: [0, 0], b: [20, 0], c: [12, 0], d: [30, 15], e: [0, 15] },
      [
        ['l', line('a', 'b')],
        ['sp', spline('b', 'c', 'd', 'e')],
        ['m', line('e', 'a')],
      ],
    );
    expect(profile(cusp).valid).toBe(true);
  });

  it('a spline that crosses itself, and one that crosses a line between vertices, make the profile invalid', () => {
    const knot = sketch({ n1: [0, 0], n2: [30, 0], n3: [30, 20], n4: [10, 20], n5: [10, -10] }, [['k', spline('n1', 'n2', 'n3', 'n4', 'n5')]]);
    expect(profile(knot).valid).toBe(false);
    // a spline whose middle bulges across a line between its ends (to y = -2.5)
    const crossing = sketch(
      { a: [0, 0], b: [20, 0], c: [10, -10], d: [10, 10], e: [0, 5], f: [20, 5] },
      [
        ['l', line('a', 'b')],
        ['sp', spline('e', 'c', 'f')],
      ],
    );
    expect(profile(crossing).valid).toBe(false);
  });

  it('a spline that touches a line between vertices is decided by its polyline at the chord tolerance (known limit, measured K)', () => {
    // the curve touches y = 0 at (10, 0); at 0.01 its polyline of 23 pieces stays 0.0095 above it,
    // at 1e-4 a point of the polyline lies on the touch
    const touching = sketch(
      { a: [0, 0], b: [20, 0], c: [10, -5], e: [0, 5], f: [20, 5] },
      [
        ['l', line('a', 'b')],
        ['sp', spline('e', 'c', 'f')],
      ],
    );
    expect(profile(touching, 0.01).valid).toBe(true);
    expect(profile(touching, 1e-4).valid).toBe(false);
  });

  it('a tangent join to an arc is valid with one region; a cusp with the spline outside the arc is invalid (known limit)', () => {
    // a quarter arc from (10, 0) to (0, 10) about the origin, the spline leaving (0, 10) along -x
    const join = (c1: [number, number]) =>
      sketch(
        { q: [0, 0], s: [10, 0], e: [0, 10], c1, c2: [-12, 5], c3: [-12, 0] },
        [
          ['a', arc('q', 's', 'e')],
          ['sp', spline('e', 'c1', 'c2', 'c3')],
          ['l', line('c3', 's')],
        ],
      );
    expect(regionsOf(join([-6, 10]))).toEqual(['a,l,sp']);
    expect(profile(join([6, 10])).valid).toBe(false);
  });

  it('a closed spline alone is one region, its side its own; as a hole of a plate it is a hole; a dangling line at its point changes nothing (measured E)', () => {
    const square = { b1: [10, 0], b2: [30, 0], b3: [30, 20], b4: [10, 20] } as Record<string, [number, number]>;
    const alone = profile(sketch(square, [['s', spline('b1', 'b2', 'b3', 'b4', 'b1')]]));
    expect(alone.valid).toBe(true);
    expect(alone.regions.map((r) => r.ref.outerLoop)).toEqual([['s']]);
    expect(areaOf(alone.regions[0])).toBeCloseTo(239.8216, 3);
    expect(areaOf(profile(sketch(square, [['s', spline('b1', 'b2', 'b3', 'b4', 'b1')]]), 0.001).regions[0])).toBeCloseTo(239.9822, 3);
    const plate = profile(
      sketch({ ...square, r1: [0, -10], r2: [40, -10], r3: [40, 30], r4: [0, 30] }, [
        ['pa', line('r1', 'r2')],
        ['pb', line('r2', 'r3')],
        ['pc', line('r3', 'r4')],
        ['pd', line('r4', 'r1')],
        ['s', spline('b1', 'b2', 'b3', 'b4', 'b1')],
      ]),
    );
    expect(plate.valid).toBe(true);
    const outer = plate.regions.find((r) => r.ref.outerLoop.includes('pa')) as Region;
    expect(outer.holes).toHaveLength(1);
    expect(outer.holes[0].sampled).toEqual(['s']);
    expect(areaOf(outer)).toBeCloseTo(1600 - 239.8216, 3);
    const dangling = profile(sketch({ ...square, z: [0, -5] }, [['s', spline('b1', 'b2', 'b3', 'b4', 'b1')], ['d', line('b1', 'z')]]));
    expect(dangling.valid).toBe(true);
    expect(dangling.regions.map((r) => r.ref.outerLoop)).toEqual([['s']]);
  });

  it('an open spline whose two ends are one point is closed', () => {
    const s = profile(sketch({ b1: [10, 0], b2: [30, 0], b3: [30, 20], b4: [10, 20], b5: [10, 0] }, [['s', spline('b1', 'b2', 'b3', 'b4', 'b5')]], [{ type: 'addConstraint', sketch: 'S', id: 'k', constraint: { type: 'coincident', a: 'b1', b: 'b5' } }]));
    expect(s.valid).toBe(true);
    expect(s.regions.map((r) => r.ref.outerLoop)).toEqual([['s']]);
  });

  it('a spline whose polyline has no length makes the profile invalid', () => {
    const s = sketch({ a: [0, 0], b: [0, 0], c: [0, 0] }, [['s', spline('a', 'b', 'c')]]);
    expect(profile(s).valid).toBe(false);
  });

  it('two splines of 64 points with overlapping bands at 0.001 are tested within a bound of time (measured C)', () => {
    const points: Record<string, [number, number]> = {};
    const a: string[] = [];
    const b: string[] = [];
    for (let i = 0; i < 64; i++) {
      points[`a${i}`] = [i * 2, 10 + (i % 2 === 0 ? 3 : -3)];
      points[`b${i}`] = [i * 2 + 1, 30 + (i % 2 === 0 ? 3 : -3)];
      a.push(`a${i}`);
      b.push(`b${i}`);
    }
    const s = sketch(points, [
      ['sa', spline(...a)],
      ['sb', spline(...b)],
      ['l1', line('a0', 'b0')],
      ['l2', line('a63', 'b63')],
    ]);
    const started = performance.now();
    const p = profile(s, 0.001);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(p.valid).toBe(true);
    expect(p.regions).toHaveLength(1);
  });
});

// The comparison of the measurement F, on a fixed seed: the profile of random sketches with a spline
// against the same sketch with the spline replaced by the chain of own lines through its polyline,
// which the profile without splines takes. The regions (by their areas) and the validity agree.
describe('a spline as one shape against the chain of its polyline (measured F)', () => {
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
  const summary = (s: SketchFeature, tolerance: number): { valid: boolean; areas: number[] } => {
    const p = profile(s, tolerance);
    return { valid: p.valid, areas: p.regions.map(areaOf).sort((x, y) => x - y) };
  };
  it('agrees on regions and validity', () => {
    const next = random(2026);
    const tolerance = 0.01;
    let [valid, compared] = [0, 0];
    const started = performance.now();
    for (let run = 0; run < 1500; run++) {
      const n = 3 + Math.floor(next() * 6);
      const size = 5 + next() * 20;
      const points: Record<string, [number, number]> = {};
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * (i + 0.6 * next())) / n;
        const r = size * (0.4 + 0.6 * next());
        points[`s${i}`] = [r * Math.cos(angle), r * Math.sin(angle)];
        ids.push(`s${i}`);
      }
      const closed = next() < 0.6;
      const curves: Entry[] = [['sp', spline(...(closed ? [...ids, ids[0]] : ids))]];
      if (!closed) curves.push(['close', line(ids[n - 1], ids[0])]);
      // a fan of triangles of lines at the first point
      const fans = 1 + Math.floor(next() * 3);
      for (let f = 0; f < fans; f++) {
        const scale = size * Math.exp(Math.log(1 / 40) + next() * Math.log(1600));
        const [t1, t2] = [next() * 2 * Math.PI, next() * 2 * Math.PI];
        const p0 = points.s0;
        points[`z${f}a`] = [p0[0] + scale * Math.cos(t1), p0[1] + scale * Math.sin(t1)];
        points[`z${f}b`] = [p0[0] + scale * Math.cos(t2), p0[1] + scale * Math.sin(t2)];
        curves.push([`u${f}a`, line('s0', `z${f}a`)], [`u${f}b`, line(`z${f}a`, `z${f}b`)], [`u${f}c`, line(`z${f}b`, 's0')]);
      }
      let withSpline: SketchFeature;
      try {
        withSpline = sketch(points, curves);
      } catch {
        continue;
      }
      // the chain: own lines through the polyline of the spline
      const control = (curves[0][1] as Extract<Curve, { type: 'spline' }>).points.map((id): Vec2 => points[id]);
      const pts = splinePolyline(control, tolerance);
      const chainPoints = { ...points };
      const names = pts.map((p, k) => {
        if (k === 0) return 's0';
        if (k === pts.length - 1) return closed ? 's0' : ids[n - 1];
        chainPoints[`w${k}`] = [p[0], p[1]];
        return `w${k}`;
      });
      const chain: Entry[] = [...names.slice(1).map((b, k): Entry => [`sp${String(k).padStart(4, '0')}`, line(names[k], b)]), ...curves.slice(1)];
      const a = summary(withSpline, tolerance);
      const b = summary(sketch(chainPoints, chain), tolerance);
      compared++;
      expect(a.valid).toBe(b.valid);
      if (!a.valid) continue;
      valid++;
      expect(a.areas.length).toBe(b.areas.length);
      a.areas.forEach((x, i) => expect(Math.abs(x - b.areas[i])).toBeLessThanOrEqual(1e-6 * Math.max(1, x)));
    }
    expect(compared).toBeGreaterThan(1000);
    expect(valid).toBeGreaterThan(200);
    expect(performance.now() - started).toBeLessThan(60000);
  });

  // The review of the implementation: the design ran arcs too. A lens of a spline and a second
  // spline, an arc or a line between two shared vertices A and B; a fan of lines or of lines and an
  // arc at A; 15% of the control points doubled. Every spline becomes the chain of its polyline.
  it('agrees with a second spline, arcs at the shared vertex and doubled control points', () => {
    const chainOf = (points: Record<string, [number, number]>, curves: Entry[], tolerance: number): { points: Record<string, [number, number]>; curves: Entry[] } => {
      const chainPoints = { ...points };
      const out: Entry[] = [];
      for (const [id, c] of curves) {
        if (c.type !== 'spline') {
          out.push([id, c]);
          continue;
        }
        const pts = splinePolyline(
          c.points.map((p): Vec2 => points[p]),
          tolerance,
        );
        const names = pts.map((p, k) => {
          if (k === 0) return c.points[0];
          if (k === pts.length - 1) return c.points[c.points.length - 1];
          chainPoints[`${id}w${k}`] = [p[0], p[1]];
          return `${id}w${k}`;
        });
        names.slice(1).forEach((b, k) => out.push([`${id}_${String(k).padStart(5, '0')}`, line(names[k], b)]));
      }
      return { points: chainPoints, curves: out };
    };
    let [valid, compared] = [0, 0];
    const started = performance.now();
    for (const [tolerance, runs] of [
      [0.1, 400],
      [0.01, 400],
      [0.001, 150],
    ]) {
      const next = random(77 + Math.round(1 / tolerance));
      for (let run = 0; run < runs; run++) {
        const points: Record<string, [number, number]> = { A: [0, 0], B: [20 + next() * 20, (next() - 0.5) * 10] };
        const controls = (name: string, side: number): string[] => {
          const n = 1 + Math.floor(next() * 4);
          const ids = ['A'];
          for (let i = 0; i < n; i++) {
            const t = (i + 1) / (n + 1);
            const id = `${name}${i}`;
            points[id] = [points.B[0] * t + (next() - 0.5) * 6, points.B[1] * t + side * (2 + next() * 12)];
            ids.push(id);
            if (next() < 0.15) {
              points[`${id}d`] = [...points[id]];
              ids.push(`${id}d`);
            }
          }
          ids.push('B');
          return ids;
        };
        const curves: Entry[] = [['s1', spline(...controls('a', 1))]];
        const second = next();
        if (second < 0.5) curves.push(['s2', spline(...controls('b', -1))]);
        else if (second < 0.8) {
          // an arc from B to A about a centre on their perpendicular bisector
          const k = (next() - 0.5) * 3;
          points.ac = [points.B[0] / 2 - k * points.B[1], points.B[1] / 2 + k * points.B[0]];
          curves.push(['ar', arc('ac', 'B', 'A')]);
        } else curves.push(['ln', line('B', 'A')]);
        if (next() < 0.7) {
          const scale = 30 * Math.exp(Math.log(1 / 60) + next() * Math.log(120));
          const [t1, t2] = [next() * 2 * Math.PI, next() * 2 * Math.PI];
          points.za = [scale * Math.cos(t1), scale * Math.sin(t1)];
          points.zb = [scale * Math.cos(t2), scale * Math.sin(t2)];
          curves.push(['u1', line('A', 'za')], ['u2', line('za', 'zb')]);
          if (next() < 0.5) {
            const k = (next() - 0.5) * 3;
            points.zc = [points.zb[0] / 2 - k * points.zb[1], points.zb[1] / 2 + k * points.zb[0]];
            curves.push(['u3', arc('zc', 'zb', 'A')]);
          } else curves.push(['u3', line('zb', 'A')]);
        }
        let a: { valid: boolean; areas: number[] };
        let b: { valid: boolean; areas: number[] };
        try {
          const chain = chainOf(points, curves, tolerance);
          a = summary(sketch(points, curves), tolerance);
          b = summary(sketch(chain.points, chain.curves), tolerance);
        } catch {
          continue;
        }
        compared++;
        expect(a.valid).toBe(b.valid);
        if (!a.valid) continue;
        valid++;
        expect(a.areas.length).toBe(b.areas.length);
        a.areas.forEach((x, i) => expect(Math.abs(x - b.areas[i])).toBeLessThanOrEqual(1e-6 * Math.max(1, x)));
      }
    }
    expect(compared).toBeGreaterThan(850);
    expect(valid).toBeGreaterThan(400);
    expect(performance.now() - started).toBeLessThan(60000);
  });
});

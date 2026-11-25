// The broad phase of the profile (D68, the first point of work of 6c): `profileOf` and
// `touchingCurves` test only the pairs of curves whose boxes meet, and the nesting of holes asks only
// the faces whose box holds the sample. Compared here with the double loop over every pair and every
// face, which is kept in this test and not in the engine, on random sketches of a fixed seed.
import { describe, expect, it } from 'vitest';
import { type BroadPhase, type Box, type OutlineCurve, type SketchCurve, type SketchGeometry, joinsOf, nearPairs, profileOf, touchingCurves } from '../src/sketch';
import type { Id, Vec2 } from '../src/types';
import { LENGTH_TOLERANCE } from '../src/util';

// every pair and every face, as the profile tested them before the broad phase
const ALL: BroadPhase = {
  pairs: (boxes: readonly Box[]) => {
    const out: [number, number][] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) out.push([i, j]);
    return out;
  },
  faceBoxes: false,
};

// a small deterministic generator (mulberry32)
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

interface Case {
  curves: SketchCurve[];
  pairs: [Id, Id][];
  geometry: SketchGeometry;
}

// Lines, arcs and circles on coarse places with jitters around the tolerance; shared points (a
// curve takes a point another took), joined points (a `coincident` pair at a jitter), arcs whose
// second end lies off their circle, circles inside other loops.
function randomCase(rng: () => number): Case {
  const tol = LENGTH_TOLERANCE;
  const jitters = [0, 0, 0, 0.25 * tol, 0.5 * tol, 0.999 * tol, tol, 1.001 * tol, 1.5 * tol, 2.5 * tol, 0.3];
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  const points: Record<Id, { x: number; y: number }> = { origin: { x: 0, y: 0 } };
  const radii: Record<Id, number> = {};
  const curves: SketchCurve[] = [];
  const pairs: [Id, Id][] = [];
  let n = 0;
  const jitter = (): number => pick(jitters) * (rng() < 0.5 ? -1 : 1);
  const newPoint = (): Id => {
    const id = `p${n++}`;
    points[id] = { x: Math.floor(rng() * 5) * 10 + jitter(), y: Math.floor(rng() * 5) * 10 + jitter() };
    return id;
  };
  const point = (): Id => {
    const ids = Object.keys(points);
    if (ids.length > 1 && rng() < 0.45) return pick(ids); // shared
    const id = newPoint();
    if (ids.length > 1 && rng() < 0.15) {
      // a joined twin of an existing point, at a jitter
      const other = pick(ids);
      points[id] = { x: points[other].x + jitter(), y: points[other].y + jitter() };
      pairs.push([id, other]);
    }
    return id;
  };
  const count = 2 + Math.floor(rng() * 7);
  for (let k = 0; k < count; k++) {
    const id = `c${k}`;
    const kind = rng();
    if (kind < 0.55) {
      curves.push({ id, shape: { type: 'line', a: point(), b: point() }, source: 'own', regions: rng() < 0.9 });
    } else if (kind < 0.8) {
      const center = point();
      const start = point();
      let end: Id;
      if (rng() < 0.5) {
        // the second end on the circle of the first, at a whole angle
        const r = Math.hypot(points[start].x - points[center].x, points[start].y - points[center].y);
        const angle = Math.floor(rng() * 8) * (Math.PI / 4);
        end = `p${n++}`;
        points[end] = { x: points[center].x + r * Math.cos(angle) + jitter(), y: points[center].y + r * Math.sin(angle) + jitter() };
      } else end = point(); // most likely off the circle: a sketch drawn and not solved
      curves.push({ id, shape: { type: 'arc', center, start, end }, source: 'own', regions: rng() < 0.9 });
    } else {
      radii[id] = pick([1, 2.5, 5, 10, 15, 20]) + jitter();
      curves.push({ id, shape: { type: 'circle', center: point() }, source: 'own', regions: true });
    }
  }
  return { curves, pairs, geometry: { points, radii } };
}

const profileWith = (c: Case, broad?: BroadPhase) => {
  try {
    return JSON.stringify(profileOf(c.curves, joinsOf(c.pairs, c.geometry), c.geometry, 0.01, broad));
  } catch (error) {
    return `throws ${(error as Error).message}`;
  }
};

// A row of slots (two arcs and two lines each) inside a rectangle: the sketch of a pattern of vents.
function slots(count: number): Case {
  const points: Record<Id, { x: number; y: number }> = { origin: { x: 0, y: 0 } };
  const curves: SketchCurve[] = [];
  const width = 6 * count + 10;
  const corner = [[0, 0], [width, 0], [width, 30], [0, 30]];
  corner.forEach(([x, y], i) => (points[`r${i}`] = { x, y }));
  corner.forEach((_, i) => curves.push({ id: `rl${i}`, shape: { type: 'line', a: `r${i}`, b: `r${(i + 1) % 4}` }, source: 'own', regions: true }));
  for (let k = 0; k < count; k++) {
    const x = 6 + 6 * k;
    const p = (name: string, px: number, py: number): Id => {
      points[`${name}${k}`] = { x: px, y: py };
      return `${name}${k}`;
    };
    const [o1, o2] = [p('o1_', x, 10), p('o2_', x, 19)];
    const [s1, s2, s3, s4] = [p('s1_', x - 1.5, 10), p('s2_', x + 1.5, 10), p('s3_', x + 1.5, 19), p('s4_', x - 1.5, 19)];
    curves.push({ id: `g1_${k}`, shape: { type: 'arc', center: o1, start: s1, end: s2 }, source: 'own', regions: true });
    curves.push({ id: `e1_${k}`, shape: { type: 'line', a: s2, b: s3 }, source: 'own', regions: true });
    curves.push({ id: `g2_${k}`, shape: { type: 'arc', center: o2, start: s3, end: s4 }, source: 'own', regions: true });
    curves.push({ id: `e2_${k}`, shape: { type: 'line', a: s4, b: s1 }, source: 'own', regions: true });
  }
  return { curves, pairs: [], geometry: { points, radii: {} } };
}

describe('the broad phase of the profile (D68)', () => {
  it('pairs the boxes that meet, widened by the tolerance, in the order of the double loop', () => {
    const boxes: Box[] = [
      [0, 0, 1, 1],
      [5, 5, 6, 6],
      [1 + 1.9e-6, 0, 2, 1], // 1.9e-6 from the first: within twice the tolerance
      [1 + 2.1e-6, 0, 2, 1], // 2.1e-6 from it: apart
      [-10, -10, 10, 10],
    ];
    expect(nearPairs(boxes, 1e-6)).toEqual([
      [0, 2],
      [0, 4],
      [1, 4],
      [2, 3],
      [2, 4],
      [3, 4],
    ]);
    expect(nearPairs([[0, 0, 1, 1], [NaN, 0, 1, 1], [5, 5, 6, 6]], 1e-6)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('gives the profile of the double loop on random sketches', () => {
    const rng = random(68);
    let [valid, regions, holes] = [0, 0, 0];
    for (let k = 0; k < 40000; k++) {
      const c = randomCase(rng);
      const broad = profileWith(c);
      expect(broad, `case ${k}`).toBe(profileWith(c, ALL));
      if (broad.startsWith('{"valid":true')) {
        valid++;
        const profile = JSON.parse(broad) as { regions: { holes: unknown[] }[] };
        if (profile.regions.length) regions++;
        if (profile.regions.some((r) => r.holes.length)) holes++;
      }
    }
    // the cases reach every part of the profile
    expect(valid).toBeGreaterThan(1500);
    expect(regions).toBeGreaterThan(500);
    expect(holes).toBeGreaterThan(20);
  });

  // D70: the box of a spline in the broad phase is the box of its control points, which holds the
  // curve and every polyline of it. The random sketches of the test above with one or two splines
  // added over points of the sketch and new ones (closed now and then), against the double loop.
  it('gives the profile of the double loop on random sketches with splines (D70)', () => {
    const rng = random(70);
    let [valid, regions] = [0, 0];
    for (let k = 0; k < 4000; k++) {
      const c = randomCase(rng);
      const ids = Object.keys(c.geometry.points);
      const splines = 1 + Math.floor(rng() * 2);
      for (let j = 0; j < splines; j++) {
        const count = 3 + Math.floor(rng() * 4);
        const control: Id[] = [];
        while (control.length < count) {
          let id: Id;
          if (rng() < 0.4) id = ids[Math.floor(rng() * ids.length)];
          else {
            id = `q${k}_${j}_${control.length}`;
            c.geometry.points[id] = { x: rng() * 45 - 2.5, y: rng() * 45 - 2.5 };
          }
          if (!control.includes(id)) control.push(id);
        }
        if (rng() < 0.3) control.push(control[0]);
        c.curves.push({ id: `sp${j}`, shape: { type: 'spline', points: control }, source: 'own', regions: true });
      }
      const broad = profileWith(c);
      expect(broad, `case ${k}`).toBe(profileWith(c, ALL));
      if (broad.startsWith('{"valid":true')) {
        valid++;
        if ((JSON.parse(broad) as { regions: unknown[] }).regions.length) regions++;
      }
    }
    expect(valid).toBeGreaterThan(100);
    expect(regions).toBeGreaterThan(20);
  });

  // The two boxes of an arc that are wrong, each failing on one of these (design.md of 6c, "Measured").
  it('boxes an arc whose second end lies off its circle by both of its ends and its sweep', () => {
    const line = (id: Id, a: Id, b: Id): SketchCurve => ({ id, shape: { type: 'line', a, b }, source: 'own', regions: true });
    const arc = (end: Id): SketchCurve => ({ id: 'a', shape: { type: 'arc', center: 'origin', start: 's', end }, source: 'own', regions: true });
    const points = { origin: { x: 0, y: 0 }, s: { x: 10, y: 0 }, e: { x: 0, y: 20 }, f: { x: 20, y: 20 }, l1: { x: -5, y: 20 }, l2: { x: -1e-7, y: 20 }, m1: { x: 8, y: 4 }, m2: { x: 8, y: 8 } };
    const geometry: SketchGeometry = { points, radii: {} };
    // An arc about the origin from (10, 0) to a second end at (0, 20), off its circle of radius 10:
    // the profile reads it as the quarter of that circle with its second end as given. A line that
    // ends 1e-7 mm beside that end, past the sweep, touches the arc there, and is missed by the box
    // of the whole circle.
    const throughEnd: Case = { curves: [arc('e'), line('l', 'l1', 'l2')], pairs: [], geometry };
    // An arc from (10, 0) to a second end at (20, 20): the eighth of the circle of radius 10, which
    // ends at (7.07, 7.07). A line at x = 8 crosses it, and is missed by the box of the two ends as
    // given with the quarter points of the sweep, which lie at x of 10 and more.
    const throughSweep: Case = { curves: [arc('f'), line('m', 'm1', 'm2')], pairs: [], geometry };
    for (const c of [throughEnd, throughSweep]) {
      expect(JSON.parse(profileWith(c)).valid).toBe(false);
      expect(profileWith(c)).toBe(profileWith(c, ALL));
    }
  });

  it('gives the first pair that touches of the double loop in an outline', () => {
    const rng = random(15);
    let touching = 0;
    for (let k = 0; k < 3000; k++) {
      const count = 3 + Math.floor(rng() * 6);
      const places: Vec2[] = [];
      for (let i = 0; i < count; i++) places.push([Math.floor(rng() * 6) * 5 + (rng() < 0.2 ? rng() * 1e-6 : 0), Math.floor(rng() * 6) * 5]);
      const loop: OutlineCurve[] = places.map((from, i): OutlineCurve => {
        const to = places[(i + 1) % count];
        if (rng() < 0.7 || (from[0] === to[0] && from[1] === to[1])) return { key: `k${i}`, forward: true, type: 'line', from, to, ends: [`${i}`, `${(i + 1) % count}`] };
        // an arc over the chord, bulging to either side
        const middle: Vec2 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
        const normal: Vec2 = [-(to[1] - from[1]), to[0] - from[0]];
        const bulge = (rng() - 0.5) * 2;
        const center: Vec2 = [middle[0] + normal[0] * bulge, middle[1] + normal[1] * bulge];
        const radius = Math.hypot(from[0] - center[0], from[1] - center[1]);
        const start = Math.atan2(from[1] - center[1], from[0] - center[0]);
        const end = Math.atan2(to[1] - center[1], to[0] - center[0]);
        const ccw = rng() < 0.5;
        let sweep = end - start;
        if (ccw) while (sweep <= 0) sweep += 2 * Math.PI;
        else while (sweep >= 0) sweep -= 2 * Math.PI;
        return { key: `k${i}`, forward: ccw, type: 'arc', from, to, ends: [`${i}`, `${(i + 1) % count}`], center, radius, start, sweep };
      });
      const loops = rng() < 0.3 ? [loop, [{ key: 'h', forward: false, type: 'circle', center: [12, 12], radius: 3 + rng() * 10, ccw: false } as OutlineCurve]] : [loop];
      const [broad, all] = [touchingCurves(loops), touchingCurves(loops, ALL)];
      expect(broad?.map((c) => c.key), `case ${k}`).toEqual(all?.map((c) => c.key));
      if (all) touching++;
    }
    expect(touching).toBeGreaterThan(500);
  });

  it('finds the profile of 200 slots in a rectangle in a fraction of the time of the double loop', () => {
    const c = slots(200); // 804 curves
    const joins = joinsOf([], c.geometry);
    const time = (broad?: BroadPhase): number => {
      const start = performance.now();
      profileOf(c.curves, joins, c.geometry, 0.01, broad);
      return performance.now() - start;
    };
    const profile = profileOf(c.curves, joins, c.geometry, 0.01);
    expect(profile.valid).toBe(true);
    expect(profile.regions).toHaveLength(201);
    expect(profile.regions.find((r) => r.ref.outerLoop.includes('rl0'))?.holes).toHaveLength(200);
    time();
    const fast = Math.min(time(), time(), time());
    const slow = time(ALL);
    // measured: 9 ms against 350; a loose bound for a loaded machine
    expect(fast).toBeLessThan(slow / 4);
  });
});

// The contacts of two curves as points to cut at (D65, `curveContacts` of sketch.ts): they agree
// with the profile's own test (`compatible`, through `curvesTouch`) on random pairs of lines, arcs
// and circles on a coarse grid, where shared ends, tangencies, overlaps and ends at one place are
// common. Every pair the profile rejects has a point to cut at, two ends to join, or lies on the
// other; every point lies on both curves.
import { describe, expect, it } from 'vitest';
import { type SketchCurve, type SketchGeometry, curveContacts, curvesTouch } from '../src/sketch';
import type { CurveShape } from '../src/types';
import { LENGTH_TOLERANCE } from '../src/util';

// A small generator with a seed, so that a failure can be repeated.
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const joinsOf = (_: string): string => _;
const distanceToShape = (p: [number, number], shape: CurveShape, g: SketchGeometry, id: string): number => {
  const at = (q: string): [number, number] => [g.points[q].x, g.points[q].y];
  switch (shape.type) {
    case 'line': {
      const [a, b] = [at(shape.a), at(shape.b)];
      const d = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1])));
      return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t);
    }
    case 'circle':
      return Math.abs(Math.hypot(p[0] - at(shape.center)[0], p[1] - at(shape.center)[1]) - g.radii[id]);
    case 'arc': {
      const c = at(shape.center);
      const s = at(shape.start);
      const e = at(shape.end);
      const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
      const from = Math.atan2(s[1] - c[1], s[0] - c[0]);
      const tau = 2 * Math.PI;
      const sweep = ((((Math.atan2(e[1] - c[1], e[0] - c[0]) - from) % tau) + tau) % tau) || tau;
      const along = ((((Math.atan2(p[1] - c[1], p[0] - c[0]) - from) % tau) + tau) % tau);
      return along <= sweep ? Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - r) : Math.min(Math.hypot(p[0] - s[0], p[1] - s[1]), Math.hypot(p[0] - e[0], p[1] - e[1]));
    }
    default:
      throw new Error('kind');
  }
};

// Two random curves over points of a 5 × 5 grid; points may be shared, an arc's ends lie on its
// circle (so that its radius is exact), a circle's radius is an integer.
function pair(next: () => number): { curves: [SketchCurve, SketchCurve]; geometry: SketchGeometry } | undefined {
  const points: SketchGeometry['points'] = {};
  const radii: Record<string, number> = {};
  const grid = (): { x: number; y: number } => ({ x: Math.floor(next() * 5), y: Math.floor(next() * 5) });
  const pool: string[] = [];
  const point = (): string => {
    if (pool.length > 0 && next() < 0.3) return pool[Math.floor(next() * pool.length)];
    const id = `p${pool.length}`;
    points[id] = grid();
    pool.push(id);
    return id;
  };
  const curve = (id: string): SketchCurve | undefined => {
    const kind = next();
    if (kind < 0.45) {
      const [a, b] = [point(), point()];
      if (a === b) return undefined;
      return { id, shape: { type: 'line', a, b }, source: 'own', regions: true };
    }
    const center = point();
    const c = points[center];
    if (kind < 0.7) {
      radii[id] = 1 + Math.floor(next() * 3);
      return { id, shape: { type: 'circle', center }, source: 'own', regions: true };
    }
    // an arc of radius 1 to 3 from one angle to another, its ends on the grid of quarter turns or eighths
    const r = 1 + Math.floor(next() * 3);
    const angles = [Math.floor(next() * 8), Math.floor(next() * 8)].map((k) => (k * Math.PI) / 4);
    if (angles[0] === angles[1]) return undefined;
    const [start, end] = angles.map((angle, i) => {
      const pid = `${id}e${i}`;
      points[pid] = { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
      pool.push(pid);
      return pid;
    });
    return { id, shape: { type: 'arc', center, start, end }, source: 'own', regions: true };
  };
  const [a, b] = [curve('A'), curve('B')];
  if (!a || !b) return undefined;
  return { curves: [a, b], geometry: { points, radii } };
}

describe('contacts as points to cut at', () => {
  it('agree with the profile test on random pairs; every point lies on both curves', () => {
    const next = random(65);
    let [checked, touching, withPoints, withEnds, lying] = [0, 0, 0, 0, 0];
    for (let n = 0; n < 20000; n++) {
      const made = pair(next);
      if (!made) continue;
      const { curves, geometry } = made;
      const found = curveContacts(curves[0], curves[1], joinsOf, geometry);
      if (!found) continue;
      checked++;
      const touch = curvesTouch(curves[0], curves[1], joinsOf, geometry);
      const reported = found.points.length > 0 || found.ends.length > 0 || found.lying;
      if (touch !== reported) throw new Error(`pair ${n}: the profile says ${touch}, the contacts ${JSON.stringify(found)}: ${JSON.stringify(made)}`);
      if (touch) touching++;
      if (found.points.length) withPoints++;
      if (found.ends.length) withEnds++;
      if (found.lying) lying++;
      for (const p of found.points) for (const c of curves) expect(distanceToShape(p, c.shape, geometry, c.id)).toBeLessThanOrEqual(LENGTH_TOLERANCE * 1.0001);
    }
    // the generator reaches every kind
    expect(checked).toBeGreaterThan(10000);
    expect(Math.min(touching, withPoints, withEnds, lying)).toBeGreaterThan(50);
  });
});

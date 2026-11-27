// The tool of a modelled thread alone (D76, stage 2; moved from the spike, spike.md A, L): the
// signed volume against the exact one for both hands, one to three starts, the ring of a bore and
// the groove of a pin; the vertices on the exact surface and the triangles within the chord
// tolerance of it; the crest of the basic profile at the angle of `zero`; the faces by role.
import { describe, expect, it } from 'vitest';
import { type ThreadProfile, threadProfile } from '../src/recompute/thread';
import { THREAD_TOOL_FACES, type ToolShape, buildThreadTool, meanSquare, radiusAt, threadTriangles, toolShape } from '../src/recompute/tool-thread';
import { volumeOf } from '../src/solid';
import type { Solid, Vec3 } from '../src/types';

const TAU = 2 * Math.PI;
const datum = { origin: [0, 0, 0] as Vec3, axis: [0, 0, 1] as Vec3, zero: [1, 0, 0] as Vec3 };
const profileOf = (fields: Parameters<typeof threadProfile>[0]): ThreadProfile => {
  const made = threadProfile(fields);
  if ('detail' in made) throw new Error(made.detail);
  return made;
};
// the distance in the axial plane of a point (r, z at the angle θ) from the profile of the shape
function profileDistance(s: ToolShape, theta: number, r: number, z: number): number {
  const a = z - (s.hand * s.lead * theta) / TAU;
  const base = s.points[0].a;
  const u = base + (a - base) - Math.floor((a - base) / s.pitch) * s.pitch;
  let best = Infinity;
  const pts = [...s.points, { ...s.points[0], a: s.points[0].a + s.pitch }];
  for (const shift of [-s.pitch, 0, s.pitch]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [from, to] = [pts[i], pts[i + 1]];
      const [dx, dy] = [to.a - from.a, to.r - from.r];
      const t = Math.max(0, Math.min(1, ((u - from.a - shift) * dx + (r - from.r) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(u - from.a - shift - t * dx, r - from.r - t * dy));
    }
  }
  return best;
}
// the largest distance from the profile of the vertices and of the centroids of the triangles of the thread surface
function deviation(solid: Solid, s: ToolShape, faces: Set<number>): { vertex: number; centroid: number } {
  let [vertex, centroid] = [0, 0];
  const p = solid.positions;
  const at = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const polar = (q: Vec3): [number, number, number] => [Math.atan2(q[1], q[0]), Math.hypot(q[0], q[1]), q[2]];
  for (let t = 0; t < solid.faceIds.length; t++) {
    if (!faces.has(solid.faceIds[t])) continue;
    const corners = [0, 1, 2].map((k) => at(solid.triangles[3 * t + k]));
    for (const q of corners) vertex = Math.max(vertex, profileDistance(s, ...polar(q)));
    const c: Vec3 = [0, 1, 2].map((k) => (corners[0][k] + corners[1][k] + corners[2][k]) / 3) as Vec3;
    centroid = Math.max(centroid, profileDistance(s, ...polar(c)));
  }
  return { vertex, centroid };
}

describe('the tool of a modelled thread', () => {
  const tol = 0.01;
  const lift = 0.05;
  const length = 12;
  it.each([
    ['right', 1, false],
    ['left', 1, false],
    ['right', 2, false],
    ['left', 3, false],
    ['right', 1, true],
    ['left', 2, true],
    ['right', 3, true],
  ] as const)('%s hand, %i start(s), internal %s: the volume of the exact shape, on the exact surface, faces by role', (hand, starts, internal) => {
    const profile = profileOf({ diameter: 10, pitch: 1.5, hand, starts });
    const wall = { radius: internal ? profile.minor : profile.major, internal };
    const s = toolShape(profile, wall, 0, lift);
    const tool = buildThreadTool(s, internal, datum, 0, length, tol, lift, 100, 200);
    // facing outwards: the signed volume is that of the exact shape
    const exact = internal ? Math.PI * length * (meanSquare(s) - (s.rMin - lift) ** 2) : Math.PI * length * ((s.rMax + lift) ** 2 - meanSquare(s));
    expect(volumeOf(tool)).toBeGreaterThan(0);
    expect(Math.abs(volumeOf(tool) / exact - 1)).toBeLessThan((4 * tol) / s.rMin);
    // the thread surface: its vertices on the exact surface (to float32), its triangles within the tolerance
    const surface = new Set([100, 101, 102]);
    const d = deviation(tool, s, surface);
    expect(d.vertex).toBeLessThan(1e-5);
    expect(d.centroid).toBeLessThan(1.05 * tol);
    // the faces: both flanks, the root, both ends, the hidden ones
    expect([...new Set(tool.faceIds)].sort()).toEqual([100, 101, 102, 103, 104, 200]);
    expect(THREAD_TOOL_FACES).toEqual(['flankStart', 'flankEnd', 'root', 'endStart', 'endEnd']);
    // the count made before the build is not below what the build makes
    expect(threadTriangles(s, 0, length, tol)).toBeGreaterThanOrEqual(tool.faceIds.length);
  });

  it('the middle of the crest of the basic profile at z = 0 at the angle of zero; the root and the hidden faces where the design puts them', () => {
    const profile = profileOf({ diameter: 10, pitch: 1.5, hand: 'right' });
    const pin = toolShape(profile, { radius: 5, internal: false }, 0, lift);
    const bore = toolShape(profile, { radius: profile.minor, internal: true }, 0, lift);
    // a pin: the ridge at the wall plus the lift (hidden), the root at the minor radius
    expect([radiusAt(pin, 0), pin.rMax, pin.rMin]).toEqual([5 + lift, 5 + lift, profile.minor]);
    // a bore: the ridge of the ring at the major radius (the root of the nut), its root at the wall less the lift
    expect([radiusAt(bore, 0), bore.rMax, bore.rMin]).toEqual([5, 5, profile.minor - lift]);
    // a clearance shifts the thread radially: the root of a pin by c inwards, of a bore by c outwards
    expect(toolShape(profile, { radius: 4.8, internal: false }, 0.2, lift).rMin).toBeCloseTo(profile.minor - 0.2, 12);
    expect(toolShape(profile, { radius: profile.minor + 0.2, internal: true }, 0.2, lift).rMax).toBeCloseTo(5.2, 12);
  });
});

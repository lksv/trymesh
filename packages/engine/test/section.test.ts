// The pass of the query `section` (D38) on meshes and chains written by hand: the cut of a closed
// mesh, the rule for the corners of a loop, the nesting of loops and the spans read from the
// surfaces. The query itself is tested with the real adapters in packages/scenarios.
import { describe, expect, it } from 'vitest';
import { QueryFailure } from '../src/query/spec';
import { type CutLoop, type SectionResult, completeRegions, corners, cut, nested, spansOf, takenAt } from '../src/query/section';
import type { FaceName, Frame, Solid, Surface, Vec2, Vec3 } from '../src/types';

// ---------------------------------------------------------------- meshes

const BOTTOM = 0;
const TOP = 1;
// A prism from z = `low` to z = `high` over a polygon that runs counter-clockwise, as a closed
// mesh with shared vertices. Every side is a quad of two triangles, so a cut across it has
// a point on every diagonal. `hole` is a polygon with as many corners inside the first; the caps
// are then the quads between the two. `sideFace(i)` numbers the face of the side `i` of the
// outer polygon; the sides of the hole are the face `holeFace`.
function prism(outer: Vec2[], low: number, high: number, sideFace: (side: number) => number, hole?: Vec2[], holeFace = 9): Solid {
  const n = outer.length;
  const positions: number[] = [];
  for (const ring of hole ? [outer, hole] : [outer]) for (const z of [low, high]) for (const [x, y] of ring) positions.push(x, y, z);
  const triangles: number[] = [];
  const faces: number[] = [];
  const add = (face: number, a: number, b: number, c: number): void => {
    triangles.push(a, b, c);
    faces.push(face);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // the outer wall looks away from the polygon, the wall of the hole into the hole
    add(sideFace(i), i, j, n + j);
    add(sideFace(i), i, n + j, n + i);
    if (hole) {
      add(holeFace, 2 * n + i, 3 * n + j, 2 * n + j);
      add(holeFace, 2 * n + i, 3 * n + i, 3 * n + j);
      add(TOP, n + i, n + j, 3 * n + j);
      add(TOP, n + i, 3 * n + j, 3 * n + i);
      add(BOTTOM, i, 2 * n + j, j);
      add(BOTTOM, i, 2 * n + i, 2 * n + j);
    } else if (i > 0 && j > 0) {
      add(TOP, n, n + i, n + j);
      add(BOTTOM, 0, j, i);
    }
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faces) };
}
const regular = (n: number, radius: number, phase = 0): Vec2[] => Array.from({ length: n }, (_, i) => [radius * Math.cos(phase + (2 * Math.PI * i) / n), radius * Math.sin(phase + (2 * Math.PI * i) / n)]);
const BOX = (): Solid => prism([[0, 0], [4, 0], [4, 3], [0, 3]], 0, 10, (side) => 2 + side);

// Turns about `axis` through the origin by `angle`, then moves by `by`.
function placement(axis: Vec3, angle: number, by: Vec3 = [0, 0, 0]): { point: (p: Vec3) => Vec3; direction: (d: Vec3) => Vec3 } {
  const length = Math.hypot(...axis);
  const [kx, ky, kz] = axis.map((part) => part / length);
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const direction = ([x, y, z]: Vec3): Vec3 => {
    const dot = kx * x + ky * y + kz * z;
    return [x * c + (ky * z - kz * y) * s + kx * dot * (1 - c), y * c + (kz * x - kx * z) * s + ky * dot * (1 - c), z * c + (kx * y - ky * x) * s + kz * dot * (1 - c)];
  };
  return { direction, point: (p) => direction(p).map((part, k) => part + by[k]) as Vec3 };
}
type Placement = ReturnType<typeof placement>;
function placed(solid: Solid, at: Placement): Solid {
  const positions = new Float32Array(solid.positions.length);
  for (let i = 0; i < positions.length; i += 3) positions.set(at.point([solid.positions[i], solid.positions[i + 1], solid.positions[i + 2]]), i);
  return { ...solid, positions };
}
const planeAt = (z: number, at?: Placement, flip = false): Frame => {
  const frame: Frame = { origin: [0, 0, z], x: [flip ? -1 : 1, 0, 0], y: [0, 1, 0], normal: [0, 0, flip ? -1 : 1] };
  return at ? { origin: at.point(frame.origin), x: at.direction(frame.x), y: at.direction(frame.y), normal: at.direction(frame.normal) } : frame;
};
// The precision of the coordinates of a mesh, as `coordinatePrecision` gives it for a body.
const precisionOf = (solid: Solid): number => 1e-6 * Math.max(1, ...Array.from(solid.positions, Math.abs));
const cutOf = (solid: Solid, frame: Frame): CutLoop[] => cut(solid, frame, precisionOf(solid), precisionOf(solid));
const lengthOf = (loop: CutLoop): number => loop.lengths.reduce((sum, length) => sum + length, 0);

// ---------------------------------------------------------------- the cut

describe('the cut of a closed mesh by a plane', () => {
  it('a box across: four corners from eight crossed triangles, the material on the left, from the first corner in the order of (u, v)', () => {
    const [loop, ...rest] = cutOf(BOX(), planeAt(5));
    expect(rest).toEqual([]);
    expect(loop.points).toEqual([[0, 0], [4, 0], [4, 3], [0, 3]]);
    expect(loop.faces).toEqual([2, 3, 4, 5]); // the side each segment lies on
    expect(loop.lengths).toEqual([4, 3, 4, 3]);
    expect(loop.area).toBeCloseTo(12, 12);
    // seen from the other side the loop still runs counter-clockwise
    const [turned] = cutOf(BOX(), planeAt(5, undefined, true));
    expect(turned.points).toEqual([[-4, 0], [0, 0], [0, 3], [-4, 3]]);
    expect(turned.faces).toEqual([2, 5, 4, 3]);
    expect(turned.area).toBeCloseTo(12, 12);
  });

  it('is taken just below the plane: a body that ends in the plane shows its face from one side and nothing from the other', () => {
    expect(cutOf(BOX(), planeAt(10)).map((loop) => loop.area)).toEqual([expect.closeTo(12, 9)]); // the top, from above
    expect(cutOf(BOX(), planeAt(10, undefined, true))).toEqual([]);
    expect(cutOf(BOX(), planeAt(0))).toEqual([]); // the body starts in the plane
    expect(cutOf(BOX(), planeAt(0, undefined, true)).map((loop) => loop.area)).toEqual([expect.closeTo(12, 9)]);
    expect(cutOf(BOX(), planeAt(10.5))).toEqual([]); // the plane misses the body
    expect(cutOf(BOX(), planeAt(-0.5))).toEqual([]);
  });

  // The bodies of the design: turned out of the axes of the model and moved away from its origin.
  // In float32 the points on the diagonals of the side quads are then off their lines by the
  // noise of the coordinates, and the vertices of a cap lie to either side of its plane.
  const PLACEMENTS: [string, Placement][] = [
    ['as modelled', placement([0, 0, 1], 0)],
    ['30° about X', placement([1, 0, 0], Math.PI / 6)],
    ['17° about X', placement([1, 0, 0], (17 * Math.PI) / 180)],
    ['45° about X', placement([1, 0, 0], Math.PI / 4)],
    ['37° about (1, 2, 3)', placement([1, 2, 3], (37 * Math.PI) / 180)],
    ['37° about (1, 2, 3), moved to (300, −200, 150)', placement([1, 2, 3], (37 * Math.PI) / 180, [300, -200, 150])],
    ['71° about (3, −1, 2), moved to (2000, 1000, −500)', placement([3, -1, 2], (71 * Math.PI) / 180, [2000, 1000, -500])],
  ];
  // a ring: 96 sides outside (radius 20) and inside (radius 7.5), 12 high
  const RING = prism(regular(96, 20), 0, 12, () => 2, regular(96, 7.5, 0.01));
  const RING_AREA = 48 * Math.sin((2 * Math.PI) / 96) * (20 * 20 - 7.5 * 7.5);

  it.each(PLACEMENTS)('a ring %s: the same corners and the same area, through the body and in the plane of its end cap', (_name, at) => {
    const solid = placed(RING, at);
    const precision = precisionOf(solid);
    for (const z of [5, 12]) {
      const loops = cutOf(solid, planeAt(z, at));
      expect(loops.map((loop) => loop.points.length).sort()).toEqual([96, 96]);
      expect(loops.map((loop) => Math.sign(loop.area)).sort()).toEqual([-1, 1]); // the wall of the hole runs clockwise
      expect(loops.reduce((sum, loop) => sum + loop.area, 0)).toBeCloseTo(RING_AREA, 1);
      // every corner is a corner of one of the two polygons
      for (const loop of loops) for (const point of loop.points) expect(Math.min(Math.abs(Math.hypot(...point) - 20), Math.abs(Math.hypot(...point) - 7.5))).toBeLessThan(40 * precision);
      // one region: the outer loop with the hole in it
      const [region, ...rest] = nested(loops);
      expect(rest).toEqual([]);
      expect(region.holes).toHaveLength(1);
      expect(region.outer.faces.every((face) => face === 2) && region.holes[0].faces.every((face) => face === 9)).toBe(true);
    }
    expect(cutOf(solid, planeAt(12, at, true))).toEqual([]); // from outside the cap there is nothing
    expect(cutOf(solid, planeAt(0, at))).toEqual([]);
  });

  it('a mesh that is not closed is refused, not answered with an open chain', () => {
    const box = BOX();
    const holed: Solid = { ...box, triangles: box.triangles.slice(3), faceIds: box.faceIds.slice(1) }; // without one triangle of a side
    expect(() => cutOf(holed, planeAt(5))).toThrow(QueryFailure);
    // an edge with a third triangle on it
    const doubled: Solid = { ...box, triangles: Uint32Array.from([...box.triangles, ...box.triangles.slice(0, 3)]), faceIds: Uint32Array.from([...box.faceIds, box.faceIds[0]]) };
    expect(() => cutOf(doubled, planeAt(5))).toThrow(QueryFailure);
  });

  it('the loops are in the order of their first points, whatever the order of the triangles', () => {
    // two boxes in one mesh, the second written first
    const [near, far] = [BOX(), placed(BOX(), placement([0, 0, 1], 0, [-20, 5, 0]))];
    const both: Solid = {
      positions: Float32Array.from([...far.positions, ...near.positions]),
      triangles: Uint32Array.from([...far.triangles, ...Array.from(near.triangles, (index) => index + far.positions.length / 3)]),
      faceIds: Uint32Array.from([...far.faceIds, ...near.faceIds]),
    };
    expect(cutOf(both, planeAt(5)).map((loop) => loop.points[0])).toEqual([[-20, 5], [0, 0]]);
  });
});

// ---------------------------------------------------------------- the corners

// The largest distance of a point of the chain from the polygon of the corners kept.
function deviation(chain: Vec2[], kept: Vec2[]): number {
  const fromSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  return Math.max(...chain.map((point) => Math.min(...kept.map((corner, i) => fromSegment(point, corner, kept[(i + 1) % kept.length])))));
}
const turned = <T>(list: T[], by: number): T[] => [...list.slice(by), ...list.slice(0, by)];

describe('the corners of a loop', () => {
  it('a curve that turns slowly keeps its bend: a parabola of 1001 points with a precision of their spacing', () => {
    // the parabola on one face, closed by two straight sides on two others
    const chain: Vec2[] = [...Array.from({ length: 1001 }, (_, i): Vec2 => [i / 1000, (i / 1000) ** 2]), [0, 1]];
    const faces = [...Array.from({ length: 1000 }, () => 0), 1, 2];
    const loop = corners(chain, faces, 0.001) as CutLoop;
    expect(loop.points[0]).toEqual([0, 0]); // the change of face that is first in the order of (u, v)
    expect(loop.points.filter((_, i) => loop.faces[i] === 0)).toHaveLength(14); // with the end of the run: 15 corners on the curve
    expect(loop.points.slice(-2)).toEqual([[1, 1], [0, 1]]);
    expect(deviation(chain, loop.points)).toBeLessThanOrEqual(0.001);
    // dropped one after another against the neighbours left, the bend would be lost: more than
    // a hundred precisions off. And the lengths are those of the chain, not of the corners.
    expect(lengthOf(loop)).toBeCloseTo(chain.reduce((sum, point, i) => sum + Math.hypot(point[0] - chain[(i + 1) % 1002][0], point[1] - chain[(i + 1) % 1002][1]), 0), 9);
    // the same list wherever the mesh starts the chain
    for (const by of [1, 137, 500, 1000, 1001]) {
      const again = corners(turned(chain, by), turned(faces, by), 0.001) as CutLoop;
      expect([again.points, again.faces]).toEqual([loop.points, loop.faces]);
      expect(again.area).toBeCloseTo(loop.area, 12); // summed from another point of the chain
      expect(lengthOf(again)).toBeCloseTo(lengthOf(loop), 12);
    }
  });

  it('a loop on one face: a circle with points ten precisions apart keeps 79 corners within the precision, from the same point whatever the start', () => {
    const chain = regular(628, 1);
    const faces = chain.map(() => 4);
    const loop = corners(chain, faces, 0.001) as CutLoop;
    expect(loop.points).toHaveLength(79);
    expect(deviation(chain, loop.points)).toBeLessThan(0.00081); // the sagitta of eight steps
    expect(loop.area).toBeCloseTo(314 * Math.sin((2 * Math.PI) / 628), 12); // of the chain, before points are dropped
    for (const by of [1, 77, 314, 627]) expect(corners(turned(chain, by), faces, 0.001)?.points).toEqual(loop.points);
    // a loop on one face starts at the point furthest from the mean of its points
    const egg: Vec2[] = [[0, 0], [2, 0], [5, 1], [2, 2], [0, 2]];
    expect((corners(egg, [0, 0, 0, 0, 0], 1e-6) as CutLoop).points[0]).toEqual([5, 1]);
    // of several that far, the first in the order of (u, v)
    expect((corners(turned([[1, 1], [-1, 1], [-1, -1], [1, -1]] as Vec2[], 3), [0, 0, 0, 0], 1e-6) as CutLoop).points).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
  });

  it('points in line go, also when the line is long and its points are many', () => {
    // a square of four faces with 300 points on every side, each a third of the precision off the line
    const side = (from: Vec2, to: Vec2, off: Vec2): Vec2[] => Array.from({ length: 300 }, (_, i): Vec2 => [from[0] + ((to[0] - from[0]) * i) / 300 + (i % 2) * off[0], from[1] + ((to[1] - from[1]) * i) / 300 + (i % 2) * off[1]]);
    const chain = [...side([0, 0], [9, 0], [0, 3e-7]), ...side([9, 0], [9, 9], [3e-7, 0]), ...side([9, 9], [0, 9], [0, 3e-7]), ...side([0, 9], [0, 0], [3e-7, 0])];
    const faces = chain.map((_, i) => Math.floor(i / 300));
    const loop = corners(chain, faces, 1e-6) as CutLoop;
    expect(loop.points).toEqual([[0, 0], [9, 0], [9, 9], [0, 9]]);
    expect(loop.faces).toEqual([0, 1, 2, 3]);
    expect(loop.lengths.map((length) => Number(length.toFixed(6)))).toEqual([9, 9, 9, 9]);
  });

  it('a segment shorter than the precision goes, and the segment after it starts at the point kept', () => {
    // a square whose corner at (4, 0) is two points a nanometre apart, with a face of its own between them
    const chain: Vec2[] = [[0, 0], [4, 0], [4, 1e-9], [4, 4], [0, 4], [1e-9, 1e-9]];
    const loop = corners(chain, [0, 7, 1, 2, 3, 8], 1e-6) as CutLoop;
    expect(loop.points).toEqual([[0, 0], [4, 0], [4, 4], [0, 4]]);
    expect(loop.faces).toEqual([0, 1, 2, 3]); // the faces 7 and 8 of the short segments are gone
    expect(lengthOf(loop)).toBeCloseTo(16, 6);
    for (const by of [1, 2, 5]) expect((corners(turned(chain, by), turned([0, 7, 1, 2, 3, 8], by), 1e-6) as CutLoop).points.map((point) => point.map(Math.round))).toEqual([[0, 0], [4, 0], [4, 4], [0, 4]]);
  });

  it('a sliver thinner than the precision is not a loop', () => {
    expect(corners([[0, 0], [5, 0], [5, 1e-9], [0, 1e-9]], [0, 1, 2, 3], 1e-6)).toBeUndefined(); // two corners left
    expect(corners([[0, 0], [5, 0], [5, 4e-7], [2, 4e-7], [0, 4e-7]], [0, 1, 2, 2, 3], 1e-6)).toBeUndefined();
    expect(corners([[0, 0], [5, 0], [5, 1e-3], [0, 1e-3]], [0, 1, 2, 3], 1e-6)?.points).toHaveLength(4); // a strip wider than the precision is one
  });
});

// ---------------------------------------------------------------- regions and spans

const square = (x: number, y: number, size: number, hole = false): CutLoop => {
  const points: Vec2[] = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
  return { points: hole ? [points[0], points[3], points[2], points[1]] : points, faces: [0, 1, 2, 3], lengths: [size, size, size, size], area: hole ? -size * size : size * size };
};

describe('the regions of a section', () => {
  it('a hole belongs to the smallest outer loop around it', () => {
    const [plate, window, island, pocket, other, far] = [square(0, 0, 100), square(10, 10, 50, true), square(20, 20, 20), square(25, 25, 5, true), square(70, 70, 10, true), square(200, 0, 10)];
    const regions = nested([far, pocket, island, other, window, plate]);
    expect(regions.map((region) => [region.outer, region.holes])).toEqual([
      [far, []],
      [island, [pocket]],
      [plate, [other, window]],
    ]);
    expect(() => nested([square(0, 0, 10), square(50, 50, 5, true)])).toThrow(QueryFailure); // a hole in nothing
  });

  it('a complete answer gives its regions with their bodies; a truncated one gives none', () => {
    const loop = { area: 1, length: 4 };
    const result: SectionResult = {
      frame: { origin: [1, 2, 3], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
      below: 0.25,
      bodies: [{ body: 'a', area: 2, loops: 2, regions: [{ area: 1, outer: loop, holes: [] }, { area: 1, outer: loop, holes: [] }] }, { body: 'b', area: 1, loops: 1, regions: [{ area: 1, outer: loop, holes: [] }] }],
      inPlane: [],
    };
    expect(completeRegions(result)?.map((entry) => entry.body)).toEqual(['a', 'a', 'b']);
    expect(completeRegions({ ...result, truncated: { shown: 1, total: 9 } })).toBeUndefined();
    // the plane the section was taken at lies `below` under the frame of the answer
    expect(takenAt(result)).toEqual({ ...result.frame, origin: [1, 2, 2.75] });
  });
});

describe('the spans of a loop, read from the surfaces', () => {
  const XY: Frame = { origin: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] };
  const name = (face: number): FaceName => ({ feature: `f${face}`, role: 'side', curve: 'c' });
  const spans = (loop: CutLoop, surfaces: Record<number, Surface>, frame = XY) => spansOf(loop, (face) => surfaces[face], name, frame);
  const PLANE: Surface = { kind: 'plane', origin: [0, 0, 0], normal: [0, 1, 0] };

  it('a planar face gives a line, whatever the corners on it', () => {
    const loop: CutLoop = { points: [[0, 0], [2, 0], [4, 0], [4, 3]], faces: [0, 0, 1, 2], lengths: [2, 2, 3, 5], area: 6 };
    expect(spans(loop, { 0: PLANE, 1: PLANE, 2: PLANE })).toEqual([
      { face: name(0), from: [0, 0], to: [4, 0], kind: 'line' },
      { face: name(1), from: [4, 0], to: [4, 3], kind: 'line' },
      { face: name(2), from: [4, 3], to: [0, 0], kind: 'line' },
    ]);
  });

  it('a cylinder cut across its axis gives an arc of the exact circle; a whole circle has a sweep of 2π by the way the loop runs', () => {
    const circle = regular(24, 3).map(([x, y]): Vec2 => [x + 10, y - 2]);
    const cylinder: Surface = { kind: 'cylinder', origin: [10, -2, 40], axis: [0, 0, -1], radius: 3.001 };
    const whole: CutLoop = { points: circle, faces: circle.map(() => 6), lengths: circle.map(() => 1), area: 28 };
    expect(spans(whole, { 6: cylinder })).toEqual([{ face: name(6), from: circle[0], to: circle[0], kind: 'arc', center: [expect.closeTo(10, 12), expect.closeTo(-2, 12)], radius: 3.001, sweep: 2 * Math.PI }]);
    const hole: CutLoop = { ...whole, points: [circle[0], ...circle.slice(1).reverse()], area: -28 };
    expect(spans(hole, { 6: cylinder })[0]).toMatchObject({ kind: 'arc', sweep: -2 * Math.PI });
    // a D: three quarters of the circle and a flat, the arc longer than a half turn
    const arc = circle.slice(0, 19);
    const flat: CutLoop = { points: arc, faces: [...arc.slice(1).map(() => 6), 0], lengths: arc.map(() => 1), area: 20 };
    const [round, straight] = spans(flat, { 6: cylinder, 0: PLANE });
    expect(round).toMatchObject({ kind: 'arc', from: arc[0], to: arc[18], radius: 3.001, sweep: expect.closeTo((3 * Math.PI) / 2, 12) });
    expect(straight).toEqual({ face: name(0), from: arc[18], to: arc[0], kind: 'line' });
    // the same run the other way round turns the other way
    const back: CutLoop = { points: [...arc].reverse(), faces: [...arc.slice(1).map(() => 6), 0], lengths: arc.map(() => 1), area: -20 };
    expect(spans(back, { 6: cylinder, 0: PLANE })[0]).toMatchObject({ kind: 'arc', sweep: expect.closeTo((-3 * Math.PI) / 2, 12) });
  });

  it('the other ways a plane meets a surface: lines along an axis, an arc of a cone, and a curve for the rest', () => {
    const loop: CutLoop = { points: [[0, 0], [1, 0.1], [2, 0.3], [3, 0], [3, 2], [0, 2]], faces: [5, 5, 5, 1, 2, 3], lengths: [1.1, 1.2, 1.3, 2, 3, 2], area: 6 };
    const kindOn = (surface: Surface, frame = XY): string => spans(loop, { 5: surface, 1: PLANE, 2: PLANE, 3: PLANE }, frame)[0].kind;
    expect(kindOn({ kind: 'cylinder', origin: [0, 0, 0], axis: [1, 0, 0], radius: 2 })).toBe('line'); // along the axis
    expect(kindOn({ kind: 'cylinder', origin: [0, 0, 0], axis: [1, 0, 5e-5], radius: 2 })).toBe('line'); // within the tolerance
    expect(kindOn({ kind: 'cylinder', origin: [0, 0, 0], axis: [1, 0, 1], radius: 2 })).toBe('curve'); // an ellipse
    expect(kindOn({ kind: 'cylinder', origin: [0, 0, 0], axis: [0, 5e-5, 1], radius: 2 })).toBe('arc');
    expect(kindOn({ kind: 'cylinder', origin: [0, 0, 0], axis: [0, 2e-4, 1], radius: 2 })).toBe('curve');
    expect(kindOn({ kind: 'swept', axis: [0, 1, 0] })).toBe('line'); // gear teeth cut along their direction
    expect(kindOn({ kind: 'swept', axis: [0, 0, 1] })).toBe('curve'); // and across it
    expect(kindOn({ kind: 'cone', apex: [0, 0, 0], axis: [1, 0, 0], halfAngle: 0.3 })).toBe('curve'); // only across its axis is it an arc
    expect(kindOn({ kind: 'general' })).toBe('curve');
    // a cone across its axis: the circle at the height of the plane the section was taken at
    const cone = spans(loop, { 5: { kind: 'cone', apex: [1, 1, 2], axis: [0, 0, 1], halfAngle: Math.PI / 6 }, 1: PLANE, 2: PLANE, 3: PLANE })[0];
    expect(cone).toMatchObject({ kind: 'arc', center: [expect.closeTo(1, 12), expect.closeTo(1, 12)], radius: expect.closeTo(3 * Math.tan(Math.PI / 6), 12) });
    // a curve: its points with both ends, and its length along the mesh
    expect(spans(loop, { 5: { kind: 'general' }, 1: PLANE, 2: PLANE, 3: PLANE })[0]).toEqual({ face: name(5), from: [0, 0], to: [3, 0], kind: 'curve', count: 4, length: expect.closeTo(3.6, 12), points: [[0, 0], [1, 0.1], [2, 0.3], [3, 0]] });
    // a curve that is a whole loop lists its corners once
    const teeth: CutLoop = { points: loop.points, faces: loop.points.map(() => 5), lengths: loop.lengths, area: 6 };
    expect(spans(teeth, { 5: { kind: 'swept', axis: [0, 0, 1] } })).toEqual([{ face: name(5), from: [0, 0], to: [0, 0], kind: 'curve', count: 6, length: expect.closeTo(10.6, 12), points: loop.points }]);
  });
});

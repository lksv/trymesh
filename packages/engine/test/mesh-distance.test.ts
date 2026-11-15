// The smallest distance on the mesh, the precision of its coordinates and the circle of two
// surfaces (D39), on parts written by hand.
import { describe, expect, it } from 'vitest';
import { closest, coordinatePrecision, meshAccuracy } from '../src/mesh-distance';
import { circleBetween } from '../src/surfaces';
import type { BodyResult, Solid, Surface, Vec3 } from '../src/types';

type Triangle = [Vec3, Vec3, Vec3];
// Triangles as one mesh; the triangle `i` carries the face `faces[i]` (0 without it).
function mesh(triangles: Triangle[], faces: number[] = []): Solid {
  return {
    positions: Float32Array.from(triangles.flat(2)),
    triangles: Uint32Array.from(triangles.flatMap((_, i) => [3 * i, 3 * i + 1, 3 * i + 2])),
    faceIds: Uint32Array.from(triangles.map((_, i) => faces[i] ?? 0)),
  };
}
// A box as twelve triangles with normals out of it; its six sides carry the faces `first` to `first + 5`
// in the order -z, +z, -y, +y, -x, +x.
function box(min: Vec3, max: Vec3, first = 0): Solid {
  const corner = (i: number): Vec3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return mesh(
    quads.flatMap(([a, b, c, d]): Triangle[] => [[corner(a), corner(b), corner(c)], [corner(a), corner(c), corner(d)]]),
    quads.flatMap((_, side) => [first + side, first + side]),
  );
}
const segments = (...points: Vec3[]): Float64Array => Float64Array.from(points.slice(1).flatMap((point, i) => [...points[i], ...point]));

// A generator of repeatable numbers in [0, 1).
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('the smallest distance of two parts of the mesh', () => {
  it('points, segments and triangles against each other', () => {
    expect(closest({ point: [0, 0, 0] }, { point: [3, 4, 0] })).toEqual({ distance: 5, a: [0, 0, 0], b: [3, 4, 0] });
    // a point above the middle of a segment, and beyond its end
    expect(closest({ point: [1, 2, 0] }, { segments: segments([0, 0, 0], [4, 0, 0]) })).toEqual({ distance: 2, a: [1, 2, 0], b: [1, 0, 0] });
    expect(closest({ point: [7, 4, 0] }, { segments: segments([0, 0, 0], [4, 0, 0]) })).toMatchObject({ distance: 5, b: [4, 0, 0] });
    // two segments that cross in the air: the common perpendicular
    expect(closest({ segments: segments([-1, 0, 0], [1, 0, 0]) }, { segments: segments([0, -1, 3], [0, 1, 3]) })).toEqual({ distance: 3, a: [0, 0, 0], b: [0, 0, 3] });
    // a polyline: the nearest of its pieces
    expect(closest({ point: [5, 1, 0] }, { segments: segments([0, 0, 0], [4, 0, 0], [4, 9, 0]) })).toMatchObject({ distance: 1, b: [4, 1, 0] });
    // a point over the inside of a triangle, over its side and beyond its corner
    const triangle = mesh([[[0, 0, 0], [4, 0, 0], [0, 4, 0]]], [7]);
    expect(closest({ point: [1, 1, 2] }, { solid: triangle })).toEqual({ distance: 2, a: [1, 1, 2], b: [1, 1, 0], faceB: 7 });
    expect(closest({ point: [2, -3, 0] }, { solid: triangle })).toMatchObject({ distance: 3, b: [2, 0, 0] });
    expect(closest({ point: [7, -4, 0] }, { solid: triangle })).toMatchObject({ distance: 5, b: [4, 0, 0] });
    // the sides are swapped with the parts
    expect(closest({ solid: triangle }, { point: [1, 1, 2] })).toEqual({ distance: 2, a: [1, 1, 0], b: [1, 1, 2], faceA: 7 });
  });

  it('two triangles that cross are at distance zero, also through their insides', () => {
    // a small triangle stuck through the middle of a large one: no corner and no side of either
    // is close to the other, so only the test of a side going through finds the crossing
    const large = mesh([[[-10, -10, 0], [10, -10, 0], [0, 10, 0]]]);
    const through = mesh([[[0, 0, -5], [1, 0, 5], [-1, 0, 5]]]);
    const found = closest({ solid: large }, { solid: through });
    expect(found?.distance).toBe(0);
    expect(found?.a).toEqual(found?.b);
    expect(found?.a[2]).toBeCloseTo(0, 12);
    // lifted clear of it, the distance is that of the lowest corner
    const lifted = mesh([[[0, 0, 2], [1, 0, 5], [-1, 0, 5]]]);
    expect(closest({ solid: large }, { solid: lifted })).toMatchObject({ distance: 2, a: [0, 0, 0], b: [0, 0, 2] });
    // a segment through a triangle, and one that stops short of it
    expect(closest({ segments: segments([0, 0, -1], [0, 0, 1]) }, { solid: large })?.distance).toBe(0);
    expect(closest({ segments: segments([0, 0, 1], [0, 0, 3]) }, { solid: large })).toMatchObject({ distance: 1, b: [0, 0, 0] });
    // triangles in one plane that overlap, and two that share a corner
    const flat = mesh([[[0, 0, 0], [4, 0, 0], [0, 4, 0]]]);
    expect(closest({ solid: flat }, { solid: mesh([[[1, 1, 0], [9, 1, 0], [1, 9, 0]]]) })?.distance).toBe(0);
    expect(closest({ solid: flat }, { solid: mesh([[[4, 0, 0], [8, 0, 0], [8, 4, 3]]]) })?.distance).toBe(0);
  });

  it('boxes: the whole solid or one face of it, and `within`', () => {
    const [low, high] = [box([0, 0, 0], [10, 10, 10]), box([2, 2, 13], [8, 8, 20], 10)];
    const whole = closest({ solid: low }, { solid: high });
    expect(whole?.distance).toBeCloseTo(3, 12);
    expect([whole?.faceA, whole?.faceB]).toEqual([1, 10]); // the top of the lower one, the bottom of the upper one
    // one face: the bottom of the lower box is 13 away from the upper one
    expect(closest({ solid: low, face: 0 }, { solid: high })?.distance).toBeCloseTo(13, 12);
    expect(closest({ solid: low, face: 0 }, { solid: high, face: 11 })?.distance).toBeCloseTo(20, 12);
    // nothing closer than `within`; the bound itself is still found
    expect(closest({ solid: low }, { solid: high }, 2.5)).toBeUndefined();
    expect(closest({ solid: low }, { solid: high }, 3)?.distance).toBeCloseTo(3, 12);
    expect(closest({ solid: low }, { solid: high }, 100)?.distance).toBeCloseTo(3, 12);
    // a part with nothing in it
    expect(closest({ solid: low, face: 99 }, { solid: high })).toBeUndefined();
    expect(closest({ segments: new Float64Array(0) }, { solid: high })).toBeUndefined();
    // boxes that overlap
    expect(closest({ solid: low }, { solid: box([5, 5, 5], [15, 15, 15]) })?.distance).toBe(0);
  });

  it('on an edge of a body the face named is the one that faces the other part', () => {
    // a point straight above the rim of the top of a box, level with nothing: the closest point is
    // on the edge of the top (+z, face 1) and the side +x (face 5); the point looks at it from the side
    const solid = box([0, 0, 0], [10, 10, 10]);
    const beside = closest({ solid }, { point: [14, 5, 10] });
    expect(beside).toMatchObject({ distance: 4, a: [10, 5, 10], faceA: 5 });
    const above = closest({ solid }, { point: [10, 5, 13] });
    expect(above).toMatchObject({ distance: 3, a: [10, 5, 10], faceA: 1 });
    // a corner: three faces meet, the one most directly under the point is named
    expect(closest({ solid }, { point: [10.1, 10.2, 15] })?.faceA).toBe(1);
    expect(closest({ solid }, { point: [10.1, 15, 10.2] })?.faceA).toBe(3);
  });

  it('agrees with every pair tried one by one', () => {
    const next = random(20261115);
    const cloud = (count: number, centre: Vec3, spread: number): Triangle[] =>
      Array.from({ length: count }, (): Triangle => {
        const at: Vec3 = [centre[0] + spread * (next() - 0.5), centre[1] + spread * (next() - 0.5), centre[2] + spread * (next() - 0.5)];
        const corner = (): Vec3 => [at[0] + 2 * (next() - 0.5), at[1] + 2 * (next() - 0.5), at[2] + 2 * (next() - 0.5)];
        return [corner(), corner(), corner()];
      });
    for (let round = 0; round < 8; round++) {
      // two clouds of triangles: apart, close, and through each other
      const [a, b] = [cloud(100, [0, 0, 0], 20), cloud(70, [round * 3.5, round, 0], 14)];
      let least = Infinity;
      for (const one of a) for (const other of b) least = Math.min(least, closest({ solid: mesh([one]) }, { solid: mesh([other]) })?.distance ?? Infinity);
      const found = closest({ solid: mesh(a) }, { solid: mesh(b) });
      expect(found?.distance).toBeCloseTo(least, 9);
      // the two points are that far apart
      if (found) expect(Math.hypot(found.a[0] - found.b[0], found.a[1] - found.b[1], found.a[2] - found.b[2])).toBeCloseTo(found.distance, 9);
      // a bound just under the answer finds nothing, one just over it finds the same
      if (least > 1e-3) {
        expect(closest({ solid: mesh(a) }, { solid: mesh(b) }, least * 0.99)).toBeUndefined();
        expect(closest({ solid: mesh(a) }, { solid: mesh(b) }, least * 1.01)?.distance).toBeCloseTo(least, 9);
      }
    }
  });
});

describe('precision and accuracy of the mesh', () => {
  const body = (min: Vec3, max: Vec3, planar = true): BodyResult => ({ solid: box(min, max), faces: [{ id: 0, planar }], edges: [], volume: 0, bounds: { min, max } });

  it('the precision of the coordinates is a millionth of the largest one, at least a millionth of a millimetre', () => {
    expect(coordinatePrecision(body([0, 0, 0], [0.2, 0.2, 0.2]))).toBe(1e-6);
    expect(coordinatePrecision(body([-55, 0, 0], [10, 20, 30]))).toBeCloseTo(55e-6, 15);
    expect(coordinatePrecision(body([0, 0, 0], [10, 20, 30]), body([0, 0, -400], [1, 1, 1]))).toBeCloseTo(400e-6, 15);
    expect(coordinatePrecision()).toBe(1e-6);
  });

  it('the accuracy counts a chord tolerance per listed body with a round face', () => {
    const context = { bodies: { flat: body([0, 0, 0], [10, 10, 10]), round: body([0, 0, 0], [55, 10, 10], false) }, state: { document: { settings: { chordTolerance: 0.01 } } } } as unknown as Parameters<typeof meshAccuracy>[0];
    expect(meshAccuracy(context, ['flat'])).toBeCloseTo(10e-6, 12);
    expect(meshAccuracy(context, ['round'])).toBeCloseTo(0.01 + 55e-6, 12);
    expect(meshAccuracy(context, ['round', 'round'])).toBeCloseTo(0.02 + 55e-6, 12); // both entities on one body
    expect(meshAccuracy(context, ['flat', 'round'])).toBeCloseTo(0.01 + 55e-6, 12);
    expect(meshAccuracy(context, [])).toBe(0); // two sketch points
  });
});

describe('the circle of two surfaces', () => {
  it('a plane across the axis of a cylinder, in either order', () => {
    const cylinder: Surface = { kind: 'cylinder', origin: [50.5, 0, -3], axis: [0, 0, 2], radius: 1.7 };
    const plane: Surface = { kind: 'plane', origin: [9, 9, 12], normal: [0, 0, -1] };
    expect(circleBetween(plane, cylinder)).toEqual({ center: [50.5, 0, 12], axis: [0, 0, 1], radius: 1.7 });
    expect(circleBetween(cylinder, plane)).toEqual({ center: [50.5, 0, 12], axis: [0, 0, 1], radius: 1.7 });
  });

  it('nothing else is a circle', () => {
    const cylinder: Surface = { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 2 };
    expect(circleBetween({ kind: 'plane', origin: [0, 0, 0], normal: [0, 1, 1] }, cylinder)).toBeUndefined(); // an ellipse
    expect(circleBetween({ kind: 'plane', origin: [1, 0, 0], normal: [1, 0, 0] }, cylinder)).toBeUndefined(); // two lines
    expect(circleBetween(cylinder, cylinder)).toBeUndefined();
    expect(circleBetween({ kind: 'plane', origin: [0, 0, 0], normal: [0, 0, 1] }, { kind: 'swept', axis: [0, 0, 1] })).toBeUndefined();
    expect(circleBetween({ kind: 'plane', origin: [0, 0, 0], normal: [0, 0, 1] }, { kind: 'plane', origin: [0, 0, 1], normal: [1, 0, 0] })).toBeUndefined();
    // within the angle tolerance a plane still counts as across the axis
    expect(circleBetween({ kind: 'plane', origin: [0, 0, 5], normal: [5e-5, 0, 1] }, cylinder)?.radius).toBe(2);
  });
});

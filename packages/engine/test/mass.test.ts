// The integrals of a closed mesh behind the query `mass` (D41), on meshes written by hand: the
// volume, the centroid and the second moments about it, compared with the formulas of a box and
// of a prism over a regular polygon.
import { describe, expect, it } from 'vitest';
import { mass, massIntegrals } from '../src/query/mass';
import { type QueryContext, QueryFailure } from '../src/query/spec';
import type { Solid, Vec3 } from '../src/types';
import { box, moved, placed, placement, prism, regular, together } from './section-kit';

// xx, yy, zz, xy, yz, zx as a symmetric matrix
const matrix = ([xx, yy, zz, xy, yz, zx]: number[]): number[][] => [
  [xx, xy, zx],
  [xy, yy, yz],
  [zx, yz, zz],
];
const near = (values: number[], digits: number) => values.map((value) => expect.closeTo(value, digits));
// The area of a regular polygon of `n` corners on a circle of the radius `r`, and its polar
// second moment about its centre.
const polygonArea = (n: number, r: number): number => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);
const polygonPolar = (n: number, r: number): number => ((n * r ** 4) / 12) * Math.sin((2 * Math.PI) / n) * (2 + Math.cos((2 * Math.PI) / n));
// A mesh with every triangle turned over.
const insideOut = (solid: Solid): Solid => {
  const triangles = Uint32Array.from(solid.triangles);
  for (let t = 0; t < triangles.length; t += 3) [triangles[t + 1], triangles[t + 2]] = [triangles[t + 2], triangles[t + 1]];
  return { ...solid, triangles };
};

describe('the integrals of a mesh', () => {
  it('a box: its volume, its centre and V·a²/12 along each side', () => {
    // 4 × 3 × 10 with a corner at the origin
    const found = massIntegrals(box());
    expect(found.volume).toBeCloseTo(120, 9);
    expect(found.centroid).toEqual(near([2, 1.5, 5], 9));
    expect(found.central).toEqual(near([(120 * 16) / 12, (120 * 9) / 12, (120 * 100) / 12, 0, 0, 0], 9));
  });

  it('a box far from the origin loses no digits: the sums are taken from a vertex of the mesh', () => {
    // whole numbers below 2^24 are exact in single precision, so the moved box is the same box
    const by: Vec3 = [4194304, -2097152, 8388608];
    const found = massIntegrals(moved(box(), by));
    expect(found.volume).toBe(120);
    expect(found.centroid).toEqual([by[0] + 2, by[1] + 1.5, by[2] + 5]);
    // summed from the origin not a digit of these would be right: the terms are some 1e13 times larger
    expect(found.central).toEqual(near([160, 90, 1000, 0, 0, 0], 9));
  });

  it('a turned box: the second moments turn with it', () => {
    const at = placement([1, 2, 3], 0.7, [5, -3, 2]);
    const found = massIntegrals(placed(box(), at));
    expect(found.volume).toBeCloseTo(120, 3);
    expect(found.centroid).toEqual(near(at.point([2, 1.5, 5]), 4));
    // R · diag(160, 90, 1000) · Rᵀ, with the columns of R the turned axes
    const axes = [at.direction([1, 0, 0]), at.direction([0, 1, 0]), at.direction([0, 0, 1])];
    const own = [160, 90, 1000];
    const expected = (i: number, j: number): number => own.reduce((sum, value, k) => sum + value * axes[k][i] * axes[k][j], 0);
    const turned = matrix(found.central);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(turned[i][j]).toBeCloseTo(expected(i, j), 2);
    // what does not turn: the sum of the three
    expect(found.central[0] + found.central[1] + found.central[2]).toBeCloseTo(1250, 2);
  });

  it('a tube over regular polygons: the hole is taken away, in the volume and in the moments', () => {
    const [n, outer, inner, height] = [64, 5, 3, 10];
    const tube = moved(prism(regular(n, outer), 0, height, () => 2, regular(n, inner)), [7, -2, 1]);
    const area = polygonArea(n, outer) - polygonArea(n, inner);
    const polar = polygonPolar(n, outer) - polygonPolar(n, inner);
    const found = massIntegrals(tube);
    expect(found.volume).toBeCloseTo(area * height, 3);
    expect(found.centroid).toEqual(near([7, -2, 1 + height / 2], 5));
    // across the axis half of the polar moment each, along it the area times h³/12
    expect(found.central).toEqual(near([(polar / 2) * height, (polar / 2) * height, (area * height ** 3) / 12, 0, 0, 0], 2));
    // a polygon inscribed in a circle is a little less than the circle
    expect(found.volume).toBeLessThan(Math.PI * (outer * outer - inner * inner) * height);
    expect(found.volume).toBeGreaterThan(0.99 * Math.PI * (outer * outer - inner * inner) * height);
  });

  it('two pieces in one mesh: the centroid between them, and the distance of each in the moments', () => {
    // two boxes 4 × 3 × 10, the second 20 further along X
    const found = massIntegrals(together(box(), moved(box(), [20, 0, 0])));
    expect(found.volume).toBeCloseTo(240, 9);
    expect(found.centroid).toEqual(near([12, 1.5, 5], 9));
    // each box 10 from the common centre along X: 2 · (160 + 120 · 100)
    expect(found.central).toEqual(near([2 * (160 + 120 * 100), 180, 2000, 0, 0, 0], 6));
  });

  it('a mesh without a volume, or turned inside out, has no centroid to speak of: the volume says so', () => {
    const flat = prism([[0, 0], [4, 0], [4, 3], [0, 3]], 2, 2, (side) => 2 + side);
    expect(massIntegrals(flat).volume).toBe(0);
    expect(massIntegrals(flat).central).toEqual([0, 0, 0, 0, 0, 0]);
    expect(massIntegrals(insideOut(box())).volume).toBeCloseTo(-120, 9);
    expect(massIntegrals({ positions: new Float32Array(), triangles: new Uint32Array(), faceIds: new Uint32Array() })).toEqual({ volume: 0, centroid: [0, 0, 0], central: [0, 0, 0, 0, 0, 0] });
  });
});

// ---------------------------------------------------------------- the entry, over a context written by hand

// A box along the axes by its two corners, and what the query needs of a context: the solids of
// the bodies, a store that keeps nothing, and an axis of the test's choice.
type Corners = [Vec3, Vec3];
const blockOf = ([low, high]: Corners): Solid => prism([[low[0], low[1]], [high[0], low[1]], [high[0], high[1]], [low[0], high[1]]], low[2], high[2], (side) => 2 + side);
function contextOf(solids: Record<string, Solid>, axis: { origin: Vec3; direction: Vec3 } | { problem: 'brokenReference' } = { origin: [0, 0, 0], direction: [0, 0, 1] }): QueryContext {
  const bodies = Object.fromEntries(Object.entries(solids).map(([id, solid]) => [id, { solid }]));
  return { bodies, memo: (_owners: unknown, _key: string, compute: () => unknown) => compute(), axis: () => axis } as unknown as QueryContext;
}
// The same answers from the formulas of a box, with nothing of the code under test: a box of the
// mass m and the sides s has m·s²/12 along each side about its centre.
interface Weighed {
  corners: Corners;
  perVolume: number; // g per mm3
}
const sides = ({ corners: [low, high] }: Weighed): Vec3 => [high[0] - low[0], high[1] - low[1], high[2] - low[2]];
const middle = ({ corners: [low, high] }: Weighed): Vec3 => [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
const weight = (box: Weighed): number => box.perVolume * sides(box).reduce((product, side) => product * side, 1);
function expectedOf(boxes: Weighed[]): { mass: number; center: Vec3; inertia: number[][] } {
  const total = boxes.reduce((sum, box) => sum + weight(box), 0);
  const center = [0, 1, 2].map((k) => boxes.reduce((sum, box) => sum + weight(box) * middle(box)[k], 0) / total) as Vec3;
  const inertia = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) =>
      boxes.reduce((sum, box) => {
        const [m, s, d] = [weight(box), sides(box), middle(box).map((value, k) => value - center[k])];
        // about the common centre: the box's own (only on the diagonal) and its mass at the distance d
        const own = i === j ? (m * (s[0] ** 2 + s[1] ** 2 + s[2] ** 2 - s[i] ** 2)) / 12 : 0;
        return sum + own + m * ((i === j ? d[0] ** 2 + d[1] ** 2 + d[2] ** 2 : 0) - d[i] * d[j]);
      }, 0),
    ),
  );
  return { mass: total, center, inertia };
}
// The moment of boxes about a line: ∫ |(r − o) × u|² dm is, for a box, its mass times the square
// of the distance of its centre from the line, and m·s²/12 for each side as far as it lies across the line.
function momentAbout(boxes: Weighed[], origin: Vec3, direction: Vec3): number {
  const length = Math.hypot(...direction);
  const u = direction.map((value) => value / length);
  return boxes.reduce((sum, box) => {
    const [m, s, d] = [weight(box), sides(box), middle(box).map((value, k) => value - origin[k])];
    const along = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const across = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - along ** 2;
    return sum + m * (across + [0, 1, 2].reduce((own, k) => own + (s[k] ** 2 / 12) * (1 - u[k] ** 2), 0));
  }, 0);
}

describe('the query mass over a context written by hand', () => {
  // two blocks set diagonally, the second much heavier: nothing of the tensor is zero
  const LIGHT: Corners = [[0, 0, 0], [40, 30, 10]];
  const HEAVY: Corners = [[50, 40, 20], [60, 70, 50]];
  const solids = { light: blockOf(LIGHT), heavy: blockOf(HEAVY) };
  const boxes: Weighed[] = [
    { corners: LIGHT, perVolume: 1.24e-3 * 0.4 },
    { corners: HEAVY, perVolume: 7.8e-3 },
  ];
  const args = { bodies: ['light', 'heavy'], density: 1.24, densities: { heavy: 7.8 }, fill: 0.4 };

  it('review: the elements off the diagonal are the negative products of inertia, each in its place', () => {
    const found = mass.run(contextOf(solids), args);
    const expected = expectedOf(boxes);
    expect(found.mass).toBeCloseTo(76.152, 9);
    expect(found.mass).toBeCloseTo(expected.mass, 9);
    expect(found.centerOfMass).toEqual(near(expected.center, 9));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(found.inertia[i][j]).toBeCloseTo(expected.inertia[i][j], 6);
    // the numbers themselves, with their signs: both blocks lie towards +x, +y, +z of each other
    expect(found.inertia[0][1]).toBeCloseTo(-7681.5128, 3);
    expect(found.inertia[0][2]).toBeCloseTo(-5761.1346, 3);
    expect(found.inertia[1][2]).toBeCloseTo(-6584.1538, 3);
    expect(found.inertia[1][0]).toBe(found.inertia[0][1]);
    expect(found.inertia[2][0]).toBe(found.inertia[0][2]);
    expect(found.inertia[2][1]).toBe(found.inertia[1][2]);
    // mirrored in x, the products with x change their sign and the third does not
    const mirror = ([low, high]: Corners): Corners => [[-high[0], low[1], low[2]], [-low[0], high[1], high[2]]];
    const mirrored = mass.run(contextOf({ light: blockOf(mirror(LIGHT)), heavy: blockOf(mirror(HEAVY)) }), args);
    expect(mirrored.inertia[0][1]).toBeCloseTo(7681.5128, 3);
    expect(mirrored.inertia[0][2]).toBeCloseTo(5761.1346, 3);
    expect(mirrored.inertia[1][2]).toBeCloseTo(-6584.1538, 3);
  });

  it('review: the moment about an axis that is skew to the model and given by a direction of any length', () => {
    const [origin, direction]: [Vec3, Vec3] = [[3, -8, 21], [2, -5, 3.5]];
    const found = mass.run(contextOf(solids, { origin, direction }), { ...args, about: { kind: 'base', axis: 'Z' } });
    expect(found.about?.moment).toBeCloseTo(momentAbout(boxes, origin, direction), 5);
    // the distance of the centre of mass from the line
    const center = expectedOf(boxes).center;
    const length = Math.hypot(...direction);
    const d = center.map((value, k) => value - origin[k]);
    const along = (d[0] * direction[0] + d[1] * direction[1] + d[2] * direction[2]) / length;
    expect(found.about?.distance).toBeCloseTo(Math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - along ** 2), 9);
    // the same line given by a direction ten times as long
    const longer = mass.run(contextOf(solids, { origin, direction: [20, -50, 35] }), { ...args, about: { kind: 'base', axis: 'Z' } });
    expect(longer.about?.moment).toBeCloseTo(found.about?.moment ?? NaN, 6);
  });

  it('review: one body has exactly its own centre, whatever its density; a block along the axes has zeros, not negative zeros', () => {
    for (const fill of [0.09, 0.11, 0.18, 0.22, 0.4, 1]) {
      const found = mass.run(contextOf(solids), { bodies: ['light'], density: 1.24, fill });
      expect(found.centerOfMass).toEqual(found.bodies[0].centerOfMass);
      expect(found.centerOfMass).toEqual([20, 15, 5]);
    }
    const found = mass.run(contextOf(solids), { bodies: ['light'], density: 1.24, fill: 1 });
    for (const [i, j] of [[0, 1], [0, 2], [1, 2], [1, 0], [2, 0], [2, 1]]) expect(Object.is(found.inertia[i][j], 0)).toBe(true);
  });

  it('review: a body without a volume is named by its place in the argument; an axis that is not there by `about`', () => {
    const flat = prism([[0, 0], [4, 0], [4, 3], [0, 3]], 2, 2, (side) => 2 + side);
    const failure = (run: () => unknown): unknown => {
      try {
        run();
      } catch (error) {
        return error instanceof QueryFailure ? { code: error.code, message: error.message, arg: error.arg } : error;
      }
      return 'no failure';
    };
    // named twice before it: the place is that of the argument, not of the bodies without duplicates
    expect(failure(() => mass.run(contextOf({ ...solids, flat }), { bodies: ['light', 'light', 'flat'], density: 1, fill: 1 }))).toEqual({ code: 'failed', message: 'bodies: the body "flat" has no volume', arg: ['bodies', 2] });
    expect(failure(() => mass.run(contextOf({ inside: insideOut(box()) }), { bodies: ['inside'], density: 1, fill: 1 }))).toMatchObject({ code: 'failed', arg: ['bodies', 0] });
    expect(failure(() => mass.run(contextOf(solids, { problem: 'brokenReference' }), { ...args, about: { kind: 'base', axis: 'Z' } }))).toEqual({ code: 'notAvailable', message: 'about: the axis is not in the state asked about', arg: ['about'] });
  });

  it('review: a mass of zero or beyond the largest number is refused, not answered with numbers that are not numbers', () => {
    const failure = (density: number, fill: number): unknown => {
      try {
        return mass.run(contextOf(solids), { bodies: ['light'], density, fill });
      } catch (error) {
        return error instanceof QueryFailure ? error.code : error;
      }
    };
    expect(failure(1e-322, 1)).toBe('failed');
    expect(failure(1e-200, 1e-200)).toBe('failed');
    expect(failure(1e306, 1)).toBe('failed'); // the check of the arguments stops this one earlier: the density has an upper bound
    expect(failure(1e-300, 1)).toMatchObject({ mass: expect.any(Number) });
  });
});

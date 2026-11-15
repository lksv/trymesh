// The integrals of a closed mesh behind the query `mass` (D41), on meshes written by hand: the
// volume, the centroid and the second moments about it, compared with the formulas of a box and
// of a prism over a regular polygon.
import { describe, expect, it } from 'vitest';
import { massIntegrals } from '../src/query/mass';
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
    // summed from the origin these would be right to five digits only: the terms are 1e11 times larger
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

// The measures behind the depth of an interference (solid.ts), on meshes written by hand: what
// the kernel returns for an intersection has sheets without thickness and pieces of very
// different sizes, and each measure has to keep its meaning there.
import { describe, expect, it } from 'vitest';
import { areaOf, penetration, thickestPiece, volumeOf } from '../src/solid';
import type { Solid } from '../src/types';

// A box as a closed mesh; all its triangles carry the face `face`.
function box(min: [number, number, number], max: [number, number, number], face = 0): Solid {
  const corner = (i: number): number[] => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]; // outward
  return {
    positions: Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7].flatMap(corner)),
    triangles: Uint32Array.from(quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])),
    faceIds: Uint32Array.from(quads.flatMap(() => [face, face])),
  };
}
// A box whose faces across X carry the face `caps` and the four others `sides`.
function bar(min: [number, number, number], max: [number, number, number], caps: number, sides: number): Solid {
  return { ...box(min, max), faceIds: Uint32Array.from([sides, sides, sides, sides, sides, sides, sides, sides, caps, caps, caps, caps]) };
}
// Several meshes as one, with their vertices kept apart.
function together(...solids: Solid[]): Solid {
  const positions: number[] = [];
  const triangles: number[] = [];
  const faceIds: number[] = [];
  for (const solid of solids) {
    const offset = positions.length / 3;
    positions.push(...solid.positions);
    triangles.push(...[...solid.triangles].map((vertex) => vertex + offset));
    faceIds.push(...solid.faceIds);
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faceIds) };
}
// A sheet: a rectangle in the plane z with both of its sides, as the kernel leaves where faces coincide.
function sheet(x: number, y: number, width: number, height: number, z: number, face = 0): Solid {
  return {
    positions: Float32Array.from([x, y, z, x + width, y, z, x + width, y + height, z, x, y + height, z]),
    triangles: Uint32Array.from([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]),
    faceIds: Uint32Array.from([face, face, face, face]),
  };
}

describe('the surface without sheets and the thickest piece', () => {
  it('a sheet has an area and no volume; with a tolerance it is left out of the surface', () => {
    const cube = box([0, 0, 0], [1, 1, 1]);
    expect(volumeOf(cube)).toBeCloseTo(1, 6);
    expect(areaOf(cube)).toBeCloseTo(6, 6);
    const withSheet = together(cube, sheet(5, 5, 30, 10, 0));
    expect(areaOf(withSheet)).toBeCloseTo(6 + 2 * 300, 4);
    expect(areaOf(withSheet, 1e-9)).toBeCloseTo(6, 6);
    // the two sides of a sheet may be cut into triangles differently
    const other: Solid = { ...sheet(5, 5, 30, 10, 0), triangles: Uint32Array.from([0, 1, 2, 0, 2, 3, 1, 3, 2, 1, 0, 3]) };
    expect(areaOf(together(cube, other), 1e-9)).toBeCloseTo(6, 6);
  });

  it('a real sliver keeps its surface unless it is thinner than the tolerance', () => {
    // a slab 30 × 10 and 0.0001 thick: with a tolerance below its thickness nothing is a sheet
    const slab = box([0, 0, 0], [30, 10, 0.0001]);
    expect(areaOf(slab, 1e-7)).toBeCloseTo(areaOf(slab), 6);
    expect(thickestPiece(slab, 1e-7)).toBeCloseTo(0.0001, 6);
    // a tolerance above the thickness takes its two large faces for a sheet: the mean thickness
    // would come out a thousand times too large, which is why the query uses a tiny tolerance
    expect(thickestPiece(slab, 1e-3)).toBeGreaterThan(0.05);
  });

  it('the mean thickness is taken piece by piece: slivers elsewhere do not thin a lump out', () => {
    const lump = box([0, 0, 0], [1, 1, 1]);
    const slivers = [0, 1, 2, 3].map((i) => box([10 + 40 * i, 0, 0], [40 + 40 * i, 100, 0.005]));
    const all = together(lump, ...slivers);
    expect((2 * volumeOf(all)) / areaOf(all)).toBeLessThan(0.006); // over the whole mesh the lump is lost
    expect(thickestPiece(all)).toBeCloseTo(1 / 3, 6);
    expect(thickestPiece(together(...slivers))).toBeCloseTo(0.005, 4);
    // a sheet is a piece without volume and counts for nothing
    expect(thickestPiece(together(lump, sheet(5, 5, 300, 100, 0)))).toBeCloseTo(1 / 3, 6);
    expect(thickestPiece({ positions: new Float32Array(0), triangles: new Uint32Array(0), faceIds: new Uint32Array(0) })).toBe(0);
  });

  it('pieces that touch at one vertex stay apart; a shared edge joins them', () => {
    // a lump and a sliver that meet at the corner (1, 1, 1), which is one vertex of the mesh
    const apart = together(box([0, 0, 0], [1, 1, 1]), box([1, 1, 1], [11, 11, 1.005]));
    const touching: Solid = { ...apart, triangles: apart.triangles.map((vertex) => (vertex === 8 ? 7 : vertex)) };
    expect(thickestPiece(touching)).toBeCloseTo(1 / 3, 6);
    // two boxes welded along the four edges of the face they share are one piece: a cube alone
    // has 1/3, the bar alone 6/14
    const two = together(box([0, 0, 0], [1, 1, 1]), box([1, 0, 0], [4, 1, 1]));
    expect(thickestPiece(two)).toBeCloseTo(6 / 14, 6);
    const welded: Solid = { ...two, triangles: two.triangles.map((vertex) => (vertex >= 8 && !((vertex - 8) & 1) ? vertex - 8 + 1 : vertex)) };
    expect(thickestPiece(welded)).toBeCloseTo((2 * 4) / (6 + 14), 6);
  });
});

describe('how deep two bodies reach into each other', () => {
  const planar = (): boolean => true;

  it('a box 2 mm inside another: the depth is the 2 mm, planar when both faces are planar', () => {
    const [a, b] = [box([0, 0, 0], [10, 10, 10], 1), box([8, 2, 2], [20, 8, 8], 2)];
    const common = box([8, 2, 2], [10, 8, 8], 1);
    expect(penetration(common, a, b, planar, 0)).toEqual({ depth: expect.closeTo(2, 5), planar: expect.closeTo(2, 5) });
    // a round face on either side takes the overlap out of the planar part
    expect(penetration(common, a, b, (face) => face !== 1, 0).planar).toBe(0);
    expect(penetration(common, a, b, () => false, 0)).toEqual({ depth: expect.closeTo(2, 5), planar: 0 });
  });

  it('a planar face in a planar face does not count where a round face of that body is as near', () => {
    // Two bars of the same section, the caps planar (1 and 2), the sides round (3 and 4), 2 mm
    // into each other. The middle of a cap is 2 mm behind the cap of the other bar and 3 mm from
    // its sides.
    const [a, b] = [bar([0, 2, 2], [10, 8, 8], 1, 3), bar([8, 2, 2], [20, 8, 8], 2, 4)];
    const common = bar([8, 2, 2], [10, 8, 8], 1, 3);
    const isPlanar = (face: number): boolean => face < 3;
    expect(penetration(common, a, b, isPlanar, 0)).toEqual({ depth: expect.closeTo(2, 5), planar: expect.closeTo(2, 5) });
    expect(penetration(common, a, b, isPlanar, 2.9).planar).toBeCloseTo(2, 5);
    // with the sides within the excuse no point is left that only planar faces explain
    expect(penetration(common, a, b, isPlanar, 3)).toEqual({ depth: expect.closeTo(2, 5), planar: 0 });
    // a body without round faces excuses nothing
    expect(penetration(common, a, b, () => true, 100).planar).toBeCloseTo(2, 5);
  });

  it('a sheet on both surfaces gives zero and does not hide a real overlap beside it', () => {
    // two boxes flush on the plane x = 10 and a rib of the first one 1 mm inside the second
    const [a, b] = [together(box([0, 0, 0], [10, 10, 10]), box([10, 4, 4], [11, 5, 5])), box([10, 0, 0], [20, 10, 10])];
    const flush: Solid = { positions: Float32Array.from([10, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10]), triangles: Uint32Array.from([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]), faceIds: Uint32Array.from([0, 0, 0, 0]) };
    expect(penetration(flush, a, b, planar, 0).depth).toBeCloseTo(0, 6);
    expect(penetration(together(flush, box([10, 4, 4], [11, 5, 5])), a, b, planar, 0).depth).toBeCloseTo(1, 5);
  });

  it('a body wholly inside another is measured against the far surface too', () => {
    const [outer, inner] = [box([-50, -50, -50], [50, 50, 50]), box([-1, -1, -1], [1, 1, 1])];
    expect(penetration(inner, outer, inner, planar, 0).depth).toBeCloseTo(49, 4);
  });

  it('an empty mesh and a point that is not a number', () => {
    const [a, b] = [box([0, 0, 0], [10, 10, 10]), box([8, 2, 2], [20, 8, 8])];
    expect(penetration({ positions: new Float32Array(0), triangles: new Uint32Array(0), faceIds: new Uint32Array(0) }, a, b, planar, 0)).toEqual({ depth: 0, planar: 0 });
    // one broken vertex leaves its own points out, not the whole measure
    const common = together(box([8, 2, 2], [10, 8, 8]), { positions: Float32Array.from([NaN, 0, 0, 9, 5, 5, 9, 6, 5]), triangles: Uint32Array.from([0, 1, 2]), faceIds: Uint32Array.from([0]) });
    expect(penetration(common, a, b, planar, 0).depth).toBeCloseTo(2, 5);
  });
});

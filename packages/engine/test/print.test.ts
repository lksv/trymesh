// The pass behind the query `print` (D42), on meshes written by hand: the print frame of an
// orientation, the box, what lies on the bed and what overhangs.
import { describe, expect, it } from 'vitest';
import { frameOfDirection, printPass, turned } from '../src/query/print';
import type { Solid, Vec3 } from '../src/types';
import { ANGLE_TOLERANCE, cross3, dot3 } from '../src/util';
import { BOTTOM, TOP, box, moved, placed, placement, prism, regular, together } from './section-kit';

const near = (values: number[], digits = 9) => values.map((value) => expect.closeTo(value, digits));
// The normals of the box 4 × 3 × 10 of the kit, out of it: the bottom, the top and the four sides.
const BOX_NORMALS: Vec3[] = [[0, 0, -1], [0, 0, 1], [0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]];
const boxNormal = (face: number): Vec3 | undefined => BOX_NORMALS[face];
const [FRONT, RIGHT, BACK, LEFT] = [2, 3, 4, 5]; // the sides y = 0, x = 4, y = 3, x = 0
const PRECISION = 1e-5;
const HALF = Math.PI / 4;
const entries = <V>(map: Map<number, V>): [number, V][] => [...map].sort((a, b) => a[0] - b[0]);
// The same mesh with other numbers for its faces.
const renumbered = (solid: Solid, by: number): Solid => ({ ...solid, faceIds: solid.faceIds.map((face) => face + by) });

describe('the print frame of an orientation', () => {
  it('by a direction: up is its unit vector, x the X axis of the model laid into the bed, or Y when up is near X', () => {
    expect(frameOfDirection([0, 0, 5])).toEqual({ x: [1, 0, 0], y: [0, 1, 0], up: [0, 0, 1] });
    expect(frameOfDirection([0, 0, -1])).toEqual({ x: [1, 0, 0], y: near([0, -1, 0]), up: [0, 0, -1] });
    expect(frameOfDirection([1, 0, 0])).toEqual({ x: [0, 1, 0], y: near([0, 0, 1]), up: [1, 0, 0] });
    expect(frameOfDirection([-2, 0, 0])).toEqual({ x: [0, 1, 0], y: near([0, 0, -1]), up: [-1, 0, 0] });
    // any direction: three unit vectors at right angles, x × y = up
    for (const direction of [[1, 2, 3], [-3, 0.5, 0.2], [0.5, 0, 0.866], [0.9, 0.3, -0.2]] as Vec3[]) {
      const { x, y, up } = frameOfDirection(direction);
      expect([dot3(x, x), dot3(y, y), dot3(up, up)]).toEqual(near([1, 1, 1]));
      expect([dot3(x, y), dot3(x, up), dot3(y, up)]).toEqual(near([0, 0, 0]));
      expect(cross3(x, y)).toEqual(near(up));
      expect(cross3(up, direction)).toEqual(near([0, 0, 0], 12)); // along the direction given
      expect(dot3(up, direction)).toBeGreaterThan(0);
    }
    // x is the axis of the model as far as it lies in the bed: no part along Y for a direction in the XZ plane
    expect(frameOfDirection([0.5, 0, 0.866]).x[1]).toBe(0);
    expect(frameOfDirection([0.5, 0, 0.866]).x[0]).toBeGreaterThan(0);
  });

  it('a turn about the vertical turns x and y and leaves up', () => {
    const frame = frameOfDirection([0, 0, 1]);
    expect(turned(frame, 0)).toEqual(frame);
    const quarter = turned(frame, Math.PI / 2);
    expect(quarter.x).toEqual(near([0, 1, 0]));
    expect(quarter.y).toEqual(near([-1, 0, 0]));
    expect(quarter.up).toEqual([0, 0, 1]);
    const some = turned(frameOfDirection([1, 2, 3]), 0.7);
    expect(cross3(some.x, some.y)).toEqual(near(some.up));
  });
});

describe('the pass over the triangles of a body', () => {
  it('a box on each of three sides: its box in the frame, the face on the bed, nothing overhangs', () => {
    const standing = printPass(box(), frameOfDirection([0, 0, 1]), HALF, boxNormal, PRECISION);
    expect(standing.size).toEqual(near([4, 3, 10]));
    expect(entries(standing.contact)).toEqual([[BOTTOM, expect.closeTo(12, 9)]]);
    expect(standing.overhang.size).toBe(0);
    const upsideDown = printPass(box(), frameOfDirection([0, 0, -1]), HALF, boxNormal, PRECISION);
    expect(upsideDown.size).toEqual(near([4, 3, 10]));
    expect(entries(upsideDown.contact)).toEqual([[TOP, expect.closeTo(12, 9)]]);
    // up is +X: the box lies on its side x = 0; x of the frame is the Y axis of the model
    const lying = printPass(box(), frameOfDirection([1, 0, 0]), HALF, boxNormal, PRECISION);
    expect(lying.size).toEqual(near([3, 10, 4]));
    expect(entries(lying.contact)).toEqual([[LEFT, expect.closeTo(30, 9)]]);
    expect(lying.overhang.size).toBe(0);
    // far from the origin and turned about the vertical: the same but for the box
    const far = printPass(moved(box(), [500, -300, 200]), turned(frameOfDirection([0, 0, 1]), Math.PI / 2), HALF, boxNormal, 1e-3);
    expect(far.size).toEqual(near([3, 4, 10], 3));
    expect(entries(far.contact)).toEqual([[BOTTOM, expect.closeTo(12, 3)]]);
  });

  it('a tilted box: a face that looks down and leans more than the angle overhangs, with the height it starts at', () => {
    // up leans 30° from Z towards Y: the bottom leans 60° from the vertical, the side y = 0 leans 30°
    const up: Vec3 = [0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
    const tilted = printPass(box(), frameOfDirection(up), HALF, boxNormal, PRECISION);
    expect(tilted.contact.size).toBe(0); // nothing looks straight down
    expect(entries(tilted.overhang)).toEqual([[BOTTOM, { area: expect.closeTo(12, 9), from: expect.closeTo(0, 9) }]]);
    // a stricter angle takes the side as well: 4 × 10, from the lowest corner of the body
    const strict = printPass(box(), frameOfDirection(up), Math.PI / 9, boxNormal, PRECISION);
    expect(entries(strict.overhang)).toEqual([
      [BOTTOM, { area: expect.closeTo(12, 9), from: expect.closeTo(0, 9) }],
      [FRONT, { area: expect.closeTo(40, 9), from: expect.closeTo(0, 9) }],
    ]);
    // nothing overhangs at a right angle, everything that looks down at an angle of zero
    expect(printPass(box(), frameOfDirection(up), Math.PI / 2, boxNormal, PRECISION).overhang.size).toBe(0);
    expect([...printPass(box(), frameOfDirection(up), 0, boxNormal, PRECISION).overhang.keys()].sort()).toEqual([BOTTOM, FRONT]);
    // the sides that look up never overhang
    expect(strict.overhang.has(BACK)).toBe(false);
    expect(strict.overhang.has(TOP)).toBe(false);
    expect(strict.overhang.has(RIGHT)).toBe(false); // a wall: its normal lies in the bed
  });

  it('a face at exactly the overhang angle is not an overhang; a hair beyond it is', () => {
    // up leans 45° from Z towards Y: the bottom and the side y = 0 both lean exactly 45°
    const up: Vec3 = [0, Math.SQRT1_2, Math.SQRT1_2];
    expect(printPass(box(), frameOfDirection(up), HALF, boxNormal, PRECISION).overhang.size).toBe(0);
    expect(printPass(box(), frameOfDirection(up), HALF - 0.5 * ANGLE_TOLERANCE, boxNormal, PRECISION).overhang.size).toBe(0);
    expect([...printPass(box(), frameOfDirection(up), HALF - 2 * ANGLE_TOLERANCE, boxNormal, PRECISION).overhang.keys()].sort()).toEqual([BOTTOM, FRONT]);
  });

  it('a planar face is contact as a whole: a direction a hair off still puts it on the bed, one further off makes it an overhang', () => {
    // the box turned by 30° about Y; its bottom then looks along −(sin 30°, 0, cos 30°)
    const at = placement([0, 1, 0], Math.PI / 6);
    const turnedBox = placed(box(), at);
    const normalOf = (face: number): Vec3 => at.direction(BOX_NORMALS[face]);
    const exact = printPass(turnedBox, frameOfDirection(at.direction([0, 0, 1])), HALF, normalOf, PRECISION);
    expect(entries(exact.contact)).toEqual([[BOTTOM, expect.closeTo(12, 5)]]);
    // typed with five digits: 2.5e-5 rad off, which lifts the far corners of the face by 1e-4 mm,
    // more than the precision; the face is still the contact, with all its area
    const typed = printPass(turnedBox, frameOfDirection([0.5, 0, 0.866]), HALF, normalOf, PRECISION);
    expect(entries(typed.contact)).toEqual([[BOTTOM, expect.closeTo(12, 5)]]);
    expect(typed.overhang.size).toBe(0);
    // a thousandth of a radian off: not straight down, so the bottom overhangs "from the bed"
    const off = printPass(turnedBox, frameOfDirection([Math.sin(Math.PI / 6 + 1e-3), 0, Math.cos(Math.PI / 6 + 1e-3)]), HALF, normalOf, PRECISION);
    expect(off.contact.size).toBe(0);
    expect(entries(off.overhang)).toEqual([[BOTTOM, { area: expect.closeTo(12, 5), from: expect.closeTo(0, 9) }]]);
  });

  it('a triangle of a planar face looks where its face looks, not where its own corners say', () => {
    // the bottom of the box with one corner lifted by a hundredth: its two triangles no longer
    // look straight down, the face as the engine knows it does
    const bent = box();
    const positions = Float32Array.from(bent.positions);
    positions[5] = 0.01; // z of the second corner of the bottom
    const pass = printPass({ ...bent, positions }, frameOfDirection([0, 0, 1]), HALF, boxNormal, 0.02);
    expect([...pass.contact.keys()]).toEqual([BOTTOM]);
    // judged by its triangles (no normal for the face): no contact, and the bent triangles overhang
    const byTriangles = printPass({ ...bent, positions }, frameOfDirection([0, 0, 1]), HALF, (face) => (face === BOTTOM ? undefined : BOX_NORMALS[face]), 0.02);
    expect(byTriangles.contact.size).toBe(0);
    expect(byTriangles.overhang.get(BOTTOM)?.area).toBeCloseTo(12, 2);
  });

  it('a body thinner than the precision: only the face that looks down is on the bed', () => {
    const slab = prism([[0, 0], [4, 0], [4, 3], [0, 3]], 0, 0.00005, (side) => 2 + side);
    const pass = printPass(slab, frameOfDirection([0, 0, 1]), HALF, boxNormal, 1e-4);
    expect(entries(pass.contact)).toEqual([[BOTTOM, expect.closeTo(12, 9)]]);
    expect(pass.overhang.size).toBe(0);
  });

  it('a face that looks straight down above the bed is an overhang from its height', () => {
    // two boxes of one body, the second 20 above the first, with faces of its own (10 to 15)
    const two = together(box(), renumbered(moved(box(), [0, 0, 20]), 10));
    const normalOf = (face: number): Vec3 => BOX_NORMALS[face % 10];
    const pass = printPass(two, frameOfDirection([0, 0, 1]), HALF, normalOf, PRECISION);
    expect(pass.size).toEqual(near([4, 3, 30]));
    expect(entries(pass.contact)).toEqual([[BOTTOM, expect.closeTo(12, 9)]]);
    expect(entries(pass.overhang)).toEqual([[10 + BOTTOM, { area: expect.closeTo(12, 9), from: expect.closeTo(20, 9) }]]);
    // upside down the top of the upper box is on the bed and the top of the lower one overhangs
    const other = printPass(two, frameOfDirection([0, 0, -1]), HALF, normalOf, PRECISION);
    expect(entries(other.contact)).toEqual([[10 + TOP, expect.closeTo(12, 9)]]);
    expect(entries(other.overhang)).toEqual([[TOP, { area: expect.closeTo(12, 9), from: expect.closeTo(20, 9) }]]);
  });

  it('a round face never lies on the bed: a cylinder on its side has no contact, and its lower quarter overhangs', () => {
    // a prism over 32 corners, radius 5, 10 long, its axis along Z; up is +X
    const [n, radius, length] = [32, 5, 10];
    const cylinder = prism(regular(n, radius), 0, length, () => 2);
    const normalOf = (face: number): Vec3 | undefined => (face === BOTTOM ? [0, 0, -1] : face === TOP ? [0, 0, 1] : undefined);
    const pass = printPass(cylinder, frameOfDirection([1, 0, 0]), HALF, normalOf, PRECISION);
    expect(pass.contact.size).toBe(0);
    // the facets within 45° of straight down: four to each side of the lowest edge
    const facet = 2 * radius * Math.sin(Math.PI / n) * length;
    expect(entries(pass.overhang)).toEqual([[2, { area: expect.closeTo(8 * facet, 4), from: expect.closeTo(0, 4) }]]);
    expect(pass.size).toEqual(near([2 * radius, length, 2 * radius], 4));
    // standing on its end it lies on that end and nothing overhangs
    const standing = printPass(cylinder, frameOfDirection([0, 0, 1]), HALF, normalOf, PRECISION);
    expect([...standing.contact.keys()]).toEqual([BOTTOM]);
    expect(standing.overhang.size).toBe(0);
    // a stricter printer sees more of the wall
    expect(printPass(cylinder, frameOfDirection([1, 0, 0]), Math.PI / 6, normalOf, PRECISION).overhang.get(2)?.area).toBeCloseTo(10 * facet, 4);
  });

  it('a triangle without an area adds nothing; a mesh without points has no size', () => {
    const flat = prism([[0, 0], [4, 0], [4, 3], [0, 3]], 2, 2, (side) => 2 + side); // the sides have no area
    const pass = printPass(flat, frameOfDirection([0, 0, 1]), HALF, boxNormal, PRECISION);
    expect([...pass.contact.keys()]).toEqual([BOTTOM]);
    expect(pass.overhang.size).toBe(0);
    expect(pass.size).toEqual(near([4, 3, 0]));
    const empty = printPass({ positions: new Float32Array(), triangles: new Uint32Array(), faceIds: new Uint32Array() }, frameOfDirection([0, 0, 1]), HALF, boxNormal, PRECISION);
    expect(empty).toEqual({ size: [0, 0, 0], contact: new Map(), overhang: new Map() });
  });
});

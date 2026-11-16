// The pass behind the query `print` (D42), on meshes written by hand: the print frame of an
// orientation, the box, what lies on the bed and what overhangs; and the query itself over
// a context written by hand.
import { describe, expect, it } from 'vitest';
import { type PrintOrientation, type PrintReport, frameOfDirection, print, printPass, turned } from '../src/query/print';
import { type QueryContext, QueryFailure } from '../src/query/spec';
import type { FaceName, PlaneRef, Solid, Vec3 } from '../src/types';
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

  it('review: the axis laid into the bed changes at 45° from X; a direction of any length a double holds has a unit vector', () => {
    expect(frameOfDirection([1, 0, 0.9]).x).toEqual([0, 1, 0]); // 42° from X
    expect(frameOfDirection([-1, 0.2, 0.9]).x[1]).toBeGreaterThan(0.9); // the same on the other side
    const beyond = frameOfDirection([0.9, 0, 1]); // 48° from X
    expect(beyond.x[1]).toBe(0);
    expect(beyond.x[0]).toBeGreaterThan(0);
    // the length of these comes out as zero or as infinity when it is computed straight
    expect(frameOfDirection([1e-320, 0, 0]).up).toEqual([1, 0, 0]);
    expect(frameOfDirection([0, 0, 5e-324]).up).toEqual([0, 0, 1]);
    expect(frameOfDirection([1.7e308, 1.7e308, 1.7e308]).up).toEqual(near([Math.sqrt(1 / 3), Math.sqrt(1 / 3), Math.sqrt(1 / 3)]));
    const mixed = frameOfDirection([3e-310, 0, 4e-310]);
    expect(mixed.up).toEqual(near([0.6, 0, 0.8], 6));
    expect(cross3(mixed.x, mixed.y)).toEqual(near(mixed.up));
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

describe('the pass: regressions of the review', () => {
  const normalOf = (face: number): Vec3 => BOX_NORMALS[face % 10];

  it('review: a body that stands on several faces in one plane keeps them all when the direction is a hair off', () => {
    // two boxes of one body, 60 apart, on one plane; along a direction 1e-5 rad off the far one
    // is 6e-4 mm higher, more than the precision
    const two = together(box(), renumbered(moved(box(), [60, 0, 0]), 10));
    const off = printPass(two, frameOfDirection([1e-5, 0, 1]), HALF, normalOf, PRECISION);
    expect(entries(off.contact)).toEqual([[BOTTOM, expect.closeTo(12, 9)], [10 + BOTTOM, expect.closeTo(12, 9)]]);
    expect(off.overhang.size).toBe(0);
    // the same body turned by 30° about Y, with the direction typed in five digits
    const at = placement([0, 1, 0], Math.PI / 6);
    const typed = printPass(placed(two, at), frameOfDirection([0.5, 0, 0.866]), HALF, (face) => at.direction(normalOf(face)), 1e-4);
    expect(entries(typed.contact)).toEqual([[BOTTOM, expect.closeTo(12, 4)], [10 + BOTTOM, expect.closeTo(12, 4)]]);
    expect(typed.overhang.size).toBe(0);
  });

  it('review: a face is on the bed only when nothing of the body reaches below it by more than the precision', () => {
    // the second box is a foot 0.005 lower
    const footed = together(box(), renumbered(moved(box(), [60, 0, -0.005]), 10));
    const fine = printPass(footed, frameOfDirection([0, 0, 1]), HALF, normalOf, 1e-3);
    expect(entries(fine.contact)).toEqual([[10 + BOTTOM, expect.closeTo(12, 6)]]);
    expect(entries(fine.overhang)).toEqual([[BOTTOM, { area: expect.closeTo(12, 9), from: expect.closeTo(0.005, 6) }]]);
    const coarse = printPass(footed, frameOfDirection([0, 0, 1]), HALF, normalOf, 1e-2);
    expect([...coarse.contact.keys()].sort((a, b) => a - b)).toEqual([BOTTOM, 10 + BOTTOM]);
    expect(coarse.overhang.size).toBe(0);
  });

  it('review: the height an overhanging face starts at is its lowest corner, whichever of its triangles has it', () => {
    // up leans towards +X and −Y: the lowest corner of the bottom is (0, 3, 0), which only its second triangle has
    const frame = frameOfDirection([0.3, -0.5, 0.8]);
    const two = together(box(), renumbered(moved(box(), [0, 0, 20]), 10));
    const pass = printPass(two, frame, HALF, normalOf, PRECISION);
    expect(pass.contact.size).toBe(0);
    expect(entries(pass.overhang)).toEqual([
      [BOTTOM, { area: expect.closeTo(12, 9), from: expect.closeTo(0, 9) }],
      [10 + BOTTOM, { area: expect.closeTo(12, 9), from: expect.closeTo(20 * frame.up[2], 9) }],
    ]);
  });
});

// ---------------------------------------------------------------- the query over a context written by hand

// A body of the context: its mesh and what the context knows of its faces.
interface Part {
  solid: Solid;
  normalOf: (face: number) => Vec3 | undefined; // out of the body; undefined: the context has no frame for the face
  xOf?: (face: number) => Vec3; // the x of the frame of a face
  round?: number[]; // the faces that are not planar
}
// What `print.run` reads of a context: the names of the faces, the bodies with their boxes and
// their faces, the frame of a face and its number. The faces of all bodies have numbers of their own.
function contextOf(parts: Record<string, Part>): { context: QueryContext; name: (face: number) => FaceName } {
  const faceNames: FaceName[] = [];
  const owner = new Map<FaceName, { part: Part; face: number }>();
  const bodies = Object.fromEntries(
    Object.entries(parts).map(([id, part]) => {
      const faces = [...new Set(part.solid.faceIds)].map((face) => {
        faceNames[face] = { feature: id, role: 'side', curve: `f${face}` };
        owner.set(faceNames[face], { part, face });
        return { id: face, planar: !part.round?.includes(face) };
      });
      const along = (k: number): number[] => Array.from(part.solid.positions).filter((_, i) => i % 3 === k);
      const bounds = { min: [0, 1, 2].map((k) => Math.min(...along(k))), max: [0, 1, 2].map((k) => Math.max(...along(k))) };
      return [id, { solid: part.solid, faces, bounds }];
    }),
  );
  const frame = (ref: PlaneRef): unknown => {
    const found = ref.kind === 'face' ? owner.get(ref.face) : undefined;
    if (found?.part.round?.includes(found.face)) return { problem: 'nonPlanarFace' };
    const normal = found?.part.normalOf(found.face);
    if (!found || !normal) return { problem: 'brokenReference' };
    const x = found.part.xOf?.(found.face) ?? frameOfDirection(normal).x;
    return { origin: [0, 0, 0], x, y: cross3(normal, x), normal };
  };
  const bodyProperties = Object.fromEntries(Object.keys(bodies).map((id) => [id, { name: id, use: 'part' }]));
  const context = { state: { evaluation: { faceNames, bodyProperties } }, bodies, frame, face: (name: FaceName) => owner.get(name)?.face } as unknown as QueryContext;
  return { context, name: (face) => faceNames[face] };
}
type Args = Parameters<typeof print.run>[1];
const up = (direction: Vec3, turn = 0) => ({ by: { up: direction }, turn });
const lying = (face: FaceName, turn = 0) => ({ by: { onBed: { kind: 'face' as const, body: 'part', face } }, turn });
// the query with its defaults, as the check of the arguments fills them in
const ask = (context: QueryContext, args: object): PrintReport => print.run(context, { overhang: HALF, minArea: 1, maxFaces: 20, ...args } as Args);
const first = (context: QueryContext, args: object): PrintOrientation => ask(context, args).bodies[0].orientations[0];
const failure = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error instanceof QueryFailure ? { code: error.code, message: error.message, arg: error.arg } : error;
  }
  return 'no failure';
};
const wide = (): Solid => prism([[0, 0], [6, 0], [6, 3], [0, 3]], 0, 10, (side) => 2 + side); // 6 × 3 × 10

describe('the query print over a context written by hand', () => {
  const normalOf = (face: number): Vec3 => BOX_NORMALS[face % 10];
  // the box and a wider one 60 further along X, on one plane: the bottoms are the faces 0 (12 mm2) and 10 (18 mm2)
  const pair = together(box(), renumbered(moved(wide(), [60, 0, 0]), 10));

  it('review: a body on two faces in one plane: both are in the totals when the list is cut, and `onBed` does not read the list', () => {
    const { context, name } = contextOf({ part: { solid: pair, normalOf } });
    const whole = first(context, { orientations: [up([1e-5, 0, 1])] });
    expect(whole.contact).toEqual({ area: expect.closeTo(30, 9), count: 2, faces: [{ face: name(10), area: expect.closeTo(18, 9) }, { face: name(BOTTOM), area: expect.closeTo(12, 9) }] });
    expect(whole.overhang).toEqual({ area: 0, count: 0, small: 0, faces: [] });
    expect(whole.onBed).toBeUndefined();
    // the smaller face named to lie on the bed, and only one face listed
    const cut = ask(context, { orientations: [lying(name(BOTTOM))], maxFaces: 1 });
    const way = cut.bodies[0].orientations[0];
    expect(way.onBed).toBe(true);
    expect(way.contact).toEqual({ area: expect.closeTo(30, 9), count: 2, faces: [{ face: name(10), area: expect.closeTo(18, 9) }] });
    expect(cut.truncated).toEqual({ shown: 1, total: 2 });
    // a side of it does not lie on the bed when the other box reaches below it
    expect(first(context, { orientations: [lying(name(LEFT))] })).toMatchObject({ up: [1, 0, 0], onBed: true });
    expect(first(context, { orientations: [lying(name(10 + LEFT))] })).toMatchObject({ up: [1, 0, 0], onBed: false });
  });

  it('review: by a face, x is the x of the frame of the face, and a turn turns it as it turns a direction', () => {
    const { context, name } = contextOf({ part: { solid: pair, normalOf, xOf: () => [0, 1, 0] } });
    const [face, quarter, direction] = ask(context, { orientations: [lying(name(BOTTOM)), lying(name(BOTTOM), Math.PI / 2), up([0, 0, 1])] }).bodies[0].orientations;
    expect(face.up).toEqual([0, 0, 1]);
    expect(face.size).toEqual(near([3, 66, 10]));
    expect(quarter.size).toEqual(near([66, 3, 10]));
    expect(direction.size).toEqual(near([66, 3, 10]));
    expect(quarter.contact).toEqual(face.contact);
  });

  it('review: the bed: a body exactly as large as the bed fits, to the precision of its coordinates and no further', () => {
    const { context } = contextOf({ part: { solid: pair, normalOf } });
    const fits = (bed: { x: number; y: number; height: number }, turn = 0): boolean | undefined => first(context, { orientations: [up([0, 0, 1], turn)], bed }).fits;
    expect(fits({ x: 66, y: 3, height: 10 })).toBe(true);
    // turned by a right angle the box is 3 and a few 1e-15 wide: the cosine of a right angle is not zero
    expect(fits({ x: 3, y: 66, height: 10 }, Math.PI / 2)).toBe(true);
    // the precision of coordinates up to 66 is 6.6e-5
    expect(fits({ x: 66 - 5e-5, y: 3 - 5e-5, height: 10 - 5e-5 })).toBe(true);
    expect(fits({ x: 66 - 1e-3, y: 3, height: 10 })).toBe(false);
    expect(fits({ x: 66, y: 3 - 1e-3, height: 10 })).toBe(false);
    expect(fits({ x: 66, y: 3, height: 10 - 1e-3 })).toBe(false);
  });

  it('review: the precision of the contact is that of the coordinates of the body', () => {
    // the second box is a foot lower by `drop`; the whole body is `far` along X
    const footed = (drop: number, far = 0): Solid => moved(together(box(), renumbered(moved(box(), [60, 0, -drop]), 10)), [far, 0, 0]);
    const on = (solid: Solid): PrintOrientation => first(contextOf({ part: { solid, normalOf } }).context, { orientations: [up([0, 0, 1])] });
    // coordinates up to 64: 6.4e-5
    expect(on(footed(2e-5)).contact.count).toBe(2);
    const stepped = on(footed(2e-4));
    expect(stepped.contact).toMatchObject({ count: 1, area: expect.closeTo(12, 6) });
    expect(stepped.overhang).toMatchObject({ count: 1, small: 0, faces: [{ area: expect.closeTo(12, 6), from: expect.closeTo(2e-4, 6) }] });
    // the same step 500 further from the origin is within the precision: 5.6e-4
    expect(on(footed(2e-4, 500)).contact.count).toBe(2);
  });

  it('review: the lists: faces of one area in the order of their numbers, the smallest area listed, and what a cut is counted of', () => {
    // above the box, 20 up: a box (face 10), one a hair wider (20: float32 makes it 4.00000048 wide) and the wide one (30)
    const hair = prism([[0, 0], [4.0000005, 0], [4.0000005, 3], [0, 3]], 0, 10, (side) => 2 + side);
    const solid = together(box(), renumbered(moved(box(), [10, 0, 20]), 10), renumbered(moved(hair, [0, 0, 20]), 20), renumbered(moved(wide(), [30, 0, 20]), 30));
    const { context, name } = contextOf({ part: { solid, normalOf } });
    const listed = (way: PrintOrientation): FaceName[] => way.overhang.faces.map((entry) => entry.face);
    const all = first(context, { orientations: [up([0, 0, 1])] });
    expect(all.contact).toEqual({ area: expect.closeTo(12, 9), count: 1, faces: [{ face: name(BOTTOM), area: expect.closeTo(12, 9) }] });
    expect(all.overhang).toMatchObject({ area: expect.closeTo(42, 5), count: 3, small: 0 });
    // the face 20 is larger by a part in ten million, which is not a difference: the smaller number goes first
    expect(all.overhang.faces[2].area).toBeGreaterThan(all.overhang.faces[1].area);
    expect(listed(all)).toEqual([name(30), name(10), name(20)]);
    expect(all.overhang.faces.map((entry) => entry.from)).toEqual(near([20, 20, 20]));
    // a face of exactly the smallest area is listed
    expect(all.overhang.faces[1].area).toBe(12);
    expect(first(context, { orientations: [up([0, 0, 1])], minArea: 12 }).overhang).toMatchObject({ count: 3, small: 0 });
    const large = ask(context, { orientations: [up([0, 0, 1])], minArea: 12.5, maxFaces: 1 });
    expect(large.bodies[0].orientations[0].overhang).toMatchObject({ area: expect.closeTo(42, 5), count: 3, small: 2 });
    expect(listed(large.bodies[0].orientations[0])).toEqual([name(30)]);
    // nothing was cut: the two small ones were not there to list
    expect(large.truncated).toBeUndefined();
    // a cut: the totals are of all faces, the count of the cut of what there was to list
    const one = ask(context, { orientations: [up([0, 0, 1])], minArea: 0, maxFaces: 1 });
    expect(one.bodies[0].orientations[0].overhang).toMatchObject({ area: expect.closeTo(42, 5), count: 3, small: 0 });
    expect(listed(one.bodies[0].orientations[0])).toEqual([name(30)]);
    expect(one.truncated).toEqual({ shown: 2, total: 4 });
    const two = ask(context, { orientations: [up([0, 0, 1])], maxFaces: 2 });
    expect(listed(two.bodies[0].orientations[0])).toEqual([name(30), name(10)]);
    expect(two.truncated).toEqual({ shown: 3, total: 4 });
  });

  it('review: a face without a frame cannot be put on the bed and is judged by its triangles; a direction needs a direction', () => {
    // the context has no frame for the top, and the side x = 4 is round
    const { context, name } = contextOf({ part: { solid: box(), normalOf: (face) => (face === TOP ? undefined : BOX_NORMALS[face]), round: [RIGHT] } });
    expect(failure(() => ask(context, { orientations: [up([0, 0, 1]), lying(name(TOP))] }))).toEqual({
      code: 'notAvailable',
      message: 'orientations[1].by.onBed: the face is not in the state asked about, or it has no side that looks out of the body',
      arg: ['orientations', 1, 'by', 'onBed'],
    });
    expect(failure(() => ask(context, { orientations: [lying(name(RIGHT))] }))).toEqual({ code: 'notAvailable', message: 'orientations[0].by.onBed: the face is not planar: only a planar face can lie on the bed', arg: ['orientations', 0, 'by', 'onBed'] });
    // upside down the top looks straight down at the bed, and is no contact: like a round face
    const flipped = first(context, { orientations: [up([0, 0, -1])] });
    expect(flipped.contact).toEqual({ area: 0, count: 0, faces: [] });
    expect(flipped.overhang.faces).toEqual([{ face: name(TOP), area: expect.closeTo(12, 9), from: expect.closeTo(0, 9) }]);
    // directions without a direction, and ones whose length a double cannot hold
    for (const none of [[0, 0, 0], [Infinity, 0, 0], [0, Number.NaN, 1]] as Vec3[]) {
      expect(failure(() => ask(context, { orientations: [up([0, 0, 1]), up(none)] }))).toEqual({ code: 'invalidArguments', message: 'orientations[1].by.up: a direction needs a length', arg: ['orientations', 1, 'by', 'up'] });
    }
    for (const tiny of [[0, 0, 5e-324], [0, 0, 1.7e308]] as Vec3[]) {
      const way = first(context, { orientations: [up(tiny)] });
      expect(way.up).toEqual([0, 0, 1]);
      expect(way.contact.faces).toEqual([{ face: name(BOTTOM), area: expect.closeTo(12, 9) }]);
    }
  });
});

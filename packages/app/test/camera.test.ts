// The arithmetic of a picture (D43): the camera of every named view (what is right and what is up
// in the picture), the fit with its margin, the scale of a picture from the user's camera, the
// rows read back from a render target, and the side of a cut that is kept.
import type { Solid, Vec3 } from '@trymesh/engine';
import { VIEWS } from '@trymesh/mcp/view-image';
import { describe, expect, it } from 'vitest';
import { currentScale, fittedCamera, keptSide, topDown } from '../src/camera';

const near = (values: readonly number[], digits = 9) => values.map((value) => expect.closeTo(value, digits));
// a body that is only its corners: 40 along X, 20 along Y, 10 along Z, from (10, 0, 0)
const BLOCK: Solid = { positions: Float32Array.from([10, 0, 0, 50, 0, 0, 50, 20, 0, 10, 20, 0, 10, 0, 10, 50, 0, 10, 50, 20, 10, 10, 20, 10]), triangles: new Uint32Array(), faceIds: new Uint32Array() };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe('the camera of a picture', () => {
  it('the named views: what is to the right and what is up in the picture', () => {
    const basis = (name: keyof typeof VIEWS) => fittedCamera(VIEWS[name].from, VIEWS[name].up, [BLOCK], 800, 600);
    // front is seen from −Y with X to the right; back from +Y, so X runs to the left
    expect(basis('front')).toMatchObject({ right: near([1, 0, 0]), up: near([0, 0, 1]), back: near([0, -1, 0]) });
    expect(basis('back')).toMatchObject({ right: near([-1, 0, 0]), up: near([0, 0, 1]), back: near([0, 1, 0]) });
    expect(basis('left')).toMatchObject({ right: near([0, -1, 0]), up: near([0, 0, 1]), back: near([-1, 0, 0]) });
    expect(basis('right')).toMatchObject({ right: near([0, 1, 0]), up: near([0, 0, 1]), back: near([1, 0, 0]) });
    // top from above with Y up in the picture and X to the right; bottom is the same sheet seen from below
    expect(basis('top')).toMatchObject({ right: near([1, 0, 0]), up: near([0, 1, 0]), back: near([0, 0, 1]) });
    expect(basis('bottom')).toMatchObject({ right: near([-1, 0, 0]), up: near([0, 1, 0]), back: near([0, 0, -1]) });
    // every view: three unit vectors at right angles, right × up = back, and Z or Y as far up as it goes
    for (const name of Object.keys(VIEWS) as (keyof typeof VIEWS)[]) {
      const { right, up, back } = basis(name);
      expect(cross(right, up), name).toEqual(near(back));
      expect(Math.hypot(...right), name).toBeCloseTo(1, 9);
      expect(Math.hypot(...up), name).toBeCloseTo(1, 9);
      expect(up[0] * VIEWS[name].up[0] + up[1] * VIEWS[name].up[1] + up[2] * VIEWS[name].up[2], name).toBeGreaterThan(0.5);
    }
    const iso = basis('iso');
    expect(iso.back).toEqual(near([0.55, -0.7, 0.45].map((part) => part / Math.hypot(0.55, 0.7, 0.45))));
    expect(iso.right[2]).toBeCloseTo(0, 9); // the horizon is level
    expect(iso.up[2]).toBeGreaterThan(0);
  });

  it('fitted to the bodies: their middle in the middle of the picture, a twentieth of margin on the tighter side', () => {
    // from the front the block is 40 wide and 10 high: the width decides in a picture of 800 by 600
    const front = fittedCamera(VIEWS.front.from, VIEWS.front.up, [BLOCK], 800, 600);
    expect(front.center).toEqual(near([30, 10, 5]));
    expect(front.scale).toBeCloseTo(40 / (800 * 0.9), 12);
    // in a picture that is narrow the same; in one that is flat the height decides
    expect(fittedCamera(VIEWS.front.from, VIEWS.front.up, [BLOCK], 100, 600).scale).toBeCloseTo(40 / 90, 12);
    expect(fittedCamera(VIEWS.front.from, VIEWS.front.up, [BLOCK], 1600, 64).scale).toBeCloseTo(10 / (64 * 0.9), 12);
    // from above: 40 by 20
    const top = fittedCamera(VIEWS.top.from, VIEWS.top.up, [BLOCK], 800, 600);
    expect(top.scale).toBeCloseTo(Math.max(40 / 720, 20 / 540), 12);
    // several bodies: the box of all of them
    const far: Solid = { ...BLOCK, positions: Float32Array.from([-30, 0, 0, -30, 0, 40]) };
    const both = fittedCamera(VIEWS.front.from, VIEWS.front.up, [BLOCK, far], 800, 600);
    expect(both.center).toEqual(near([10, 10, 20]));
    expect(both.scale).toBeCloseTo(Math.max(80 / 720, 40 / 540), 12);
    // the direction may have any length
    expect(fittedCamera([0, -7, 0], [0, 0, 3], [BLOCK], 800, 600)).toEqual(front);
  });

  it('nothing to draw is a box of 40 mm about the origin; a point still has a scale', () => {
    const empty = fittedCamera(VIEWS.iso.from, VIEWS.iso.up, [], 800, 600);
    expect(empty.center).toEqual(near([0, 0, 0]));
    expect(empty.scale).toBeCloseTo(40 / 540, 12);
    const none: Solid = { positions: new Float32Array(), triangles: new Uint32Array(), faceIds: new Uint32Array() };
    expect(fittedCamera(VIEWS.iso.from, VIEWS.iso.up, [none], 800, 600)).toEqual(empty);
    const point: Solid = { ...none, positions: Float32Array.from([5, 6, 7]) };
    const dot = fittedCamera(VIEWS.top.from, VIEWS.top.up, [point], 800, 600);
    expect(dot.center).toEqual(near([5, 6, 7]));
    expect(dot.scale).toBe(1e-6);
  });

  it('from the camera of the user: at least all the window shows', () => {
    // a window of 1000 by 500 at 4 pixels a millimetre shows 250 by 125 mm
    expect(currentScale(4, 1000, 500, 800, 600)).toBeCloseTo(250 / 800, 12); // the width decides
    expect(currentScale(4, 1000, 500, 1600, 100)).toBeCloseTo(125 / 100, 12); // the height decides
    expect(currentScale(4, 800, 600, 800, 600)).toBe(0.25); // the same shape: the scale of the window
    expect(currentScale(4, 0, 0, 800, 600)).toBeCloseTo(1 / 600 / 4, 12); // a window without a size
  });
});

describe('the pixels of a picture', () => {
  it('the rows read back from the bottom up are turned top down; a row keeps its order', () => {
    // 2 wide, 3 high: the pixel (column, row from the bottom) holds [10·row + column, 0, 0, 255]
    const pixels = new Uint8Array(4 * 2 * 3);
    for (let row = 0; row < 3; row++) for (let column = 0; column < 2; column++) pixels.set([10 * row + column, 0, 0, 255], 4 * (2 * row + column));
    const image = topDown(pixels, 2, 3);
    expect(Array.from(image).filter((_, index) => index % 4 === 0)).toEqual([20, 21, 10, 11, 0, 1]);
    expect(image).toHaveLength(pixels.length);
    expect(Array.from(image).filter((_, index) => index % 4 === 3)).toEqual([255, 255, 255, 255, 255, 255]);
    expect(Array.from(pixels.subarray(0, 4))).toEqual([0, 0, 0, 255]); // what was read is left as it was
  });

  it('a cut keeps the side its normal points away from', () => {
    // cut away what lies above z = 6
    const { normal, constant } = keptSide({ origin: [3, 4, 6], normal: [0, 0, 1] });
    const kept = (point: Vec3): boolean => normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] + constant >= 0;
    expect(kept([0, 0, 5])).toBe(true);
    expect(kept([100, -50, 6])).toBe(true); // in the plane
    expect(kept([0, 0, 7])).toBe(false);
    // a plane that leans
    const slanted = keptSide({ origin: [1, 1, 1], normal: [Math.SQRT1_2, 0, Math.SQRT1_2] });
    expect(slanted.normal[0] * 0 + slanted.normal[2] * 0 + slanted.constant).toBeGreaterThan(0); // the origin of the model is kept
    expect(slanted.normal[0] * 5 + slanted.normal[2] * 5 + slanted.constant).toBeLessThan(0);
  });
});

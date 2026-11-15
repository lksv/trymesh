// The arithmetic of a picture (D43) that needs no renderer: the camera of a named view fitted to
// what is drawn, the scale of a picture from the user's camera, and the rows of pixels read back
// from a render target. `viewport.ts` draws with them; they are plain numbers so that a test can
// check them.
import type { Solid, Vec3 } from '@trymesh/engine';

const MARGIN = 0.05; // of a picture fitted to its bodies, on every side
const EMPTY = 20; // nothing to draw: a box of 40 mm about the origin

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / length, a[1] / length, a[2] / length];
};

// A parallel camera: the three unit vectors of its picture in the model (`right` and `up` in the
// picture, `back` from what it looks at towards the camera; right-handed: right × up = back), the
// point of the model in the middle of the picture, and the scale in millimetres per pixel.
export interface FittedCamera {
  right: Vec3;
  up: Vec3;
  back: Vec3;
  center: Vec3;
  scale: number;
}

// The camera of a view fitted to bodies: it stands in the direction `from` of what it looks at,
// with `up` as far up in the picture as the direction allows, and shows all points of the bodies
// with a margin of a twentieth of the picture on every side. (`up` must not be along `from`.)
export function fittedCamera(from: Vec3, up: Vec3, solids: readonly Solid[], width: number, height: number): FittedCamera {
  const back = unit(from);
  const right = unit(cross(up, back));
  const above = cross(back, right);
  const low: Vec3 = [Infinity, Infinity, Infinity];
  const high: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of solids) {
    for (let i = 0; i < positions.length; i += 3) {
      const point: Vec3 = [positions[i], positions[i + 1], positions[i + 2]];
      [dot(point, right), dot(point, above), dot(point, back)].forEach((along, axis) => {
        low[axis] = Math.min(low[axis], along);
        high[axis] = Math.max(high[axis], along);
      });
    }
  }
  if (!(low[0] <= high[0])) {
    low.fill(-EMPTY);
    high.fill(EMPTY);
  }
  const middle = [0, 1, 2].map((axis) => (low[axis] + high[axis]) / 2);
  const center = [0, 1, 2].map((k) => right[k] * middle[0] + above[k] * middle[1] + back[k] * middle[2]) as Vec3;
  // a body without a size across the view still gets a picture
  const scale = Math.max((high[0] - low[0]) / (width * (1 - 2 * MARGIN)), (high[1] - low[1]) / (height * (1 - 2 * MARGIN)), 1e-6);
  return { right, up: above, back, center, scale };
}

// The scale of a picture taken from the user's camera: at least all the window shows is in the
// picture, whatever the shapes of the two. `zoom`: pixels of the window per millimetre.
export const currentScale = (zoom: number, windowWidth: number, windowHeight: number, width: number, height: number): number => Math.max(Math.max(1, windowWidth) / width, Math.max(1, windowHeight) / height) / zoom;

// The rows of a render target run from the bottom up, those of an image from the top down.
export function topDown(pixels: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length);
  for (let row = 0; row < height; row++) out.set(pixels.subarray(4 * width * (height - 1 - row), 4 * width * (height - row)), 4 * width * row);
  return out;
}

// The plane that keeps what a cut leaves, as `normal · p + constant >= 0`: what lies on the side
// the normal of the half-space points to is cut away, so the plane is the half-space turned round.
export function keptSide(clip: { origin: Vec3; normal: Vec3 }): { normal: Vec3; constant: number } {
  return { normal: [0 - clip.normal[0], 0 - clip.normal[1], 0 - clip.normal[2]], constant: dot(clip.normal, clip.origin) };
}

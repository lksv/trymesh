// The placement of a part that has a frame of its own (D55): the frame of a `FrameRef` in a state, and
// the transform that takes the part from its own frame into the model. Not tied to a mesh: an
// inserted part (3c) takes them as they are.
import { toWorld } from '../solid';
import type { BodyPlacement, Frame, FrameRef, RigidTransform, Vec3 } from '../types';
import { frame as planeFrame, lookup } from './services';
import type { State } from './state';

// The frame of a reference in a state, or the code the recompute gives for it: a plane reference as
// a sketch on it has it; a sketch point as the frame of its sketch moved to the point.
export function frameOf(ref: FrameRef, state: State): Frame | 'brokenReference' | 'nonPlanarFace' {
  if (ref.kind !== 'sketchPoint') {
    const found = planeFrame(ref, state);
    return typeof found === 'string' ? (found === 'nonPlanarFace' ? found : 'brokenReference') : found;
  }
  const sketch = lookup(state.sketches, ref.sketch);
  const at = sketch && lookup(sketch.geometry.points, ref.point);
  if (!sketch || !at) return 'brokenReference';
  return { ...sketch.frame, origin: toWorld(sketch.frame, at.x, at.y) };
}

// The transform of a placement on a frame: p ↦ O + B · (Rz(rz) · Ry(ry) · Rx(rx) · p + (x, y, z)),
// with O the origin of the frame and B its axes (X, Y, normal) as columns. A turn by zero is exactly
// no turn.
export function placementTransform(placement: BodyPlacement, frame: Frame): RigidTransform {
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = placement;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  // R = Rz · Ry · Rx, by rows
  const turn: [Vec3, Vec3, Vec3] = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
  const axes: [Vec3, Vec3, Vec3] = [frame.x, frame.y, frame.normal]; // the columns of B
  const matrix = [0, 1, 2].map((i) => [0, 1, 2].map((j) => axes[0][i] * turn[0][j] + axes[1][i] * turn[1][j] + axes[2][i] * turn[2][j]) as Vec3) as [Vec3, Vec3, Vec3];
  return { matrix, translation: toWorld(frame, x, y, z) };
}

// The pose of the mechanism in the view (D49). The bodies of the evaluation stay as modelled; the
// view puts each body where the transform of its link takes it, without new geometry: the mesh
// gets the transform, and what the app computes from a mesh (its outline, its box, the edges it
// picks) is moved by it. Pure functions, no DOM.
import type { Id, MechanismResult, RigidTransform, Solid, Vec3 } from '@trymesh/engine';

// Where the view puts a body: the transform of its link (none: as modelled), and the joint that
// keeps the link from its pose. A blocked link is drawn by its transform, which counts that joint
// as standing at zero, and is marked.
export interface BodyPose {
  transform?: RigidTransform;
  blockedBy?: Id;
}
export type Pose = (body: Id) => BodyPose;
export const AS_MODELLED: Pose = () => ({});

// Exactly the identity, number by number (the engine gives a link that does not move exactly that).
export const isIdentity = (t: RigidTransform): boolean => t.translation.every((x) => x === 0) && t.matrix.every((row, i) => row.every((x, j) => x === (i === j ? 1 : 0)));

const POSES = new WeakMap<MechanismResult, Pose>();
// The pose of the bodies by a mechanism of a state; without one, every body as modelled.
export function poseOf(mechanism: MechanismResult | undefined): Pose {
  if (!mechanism) return AS_MODELLED;
  let pose = POSES.get(mechanism);
  if (!pose) {
    const byBody = new Map<Id, BodyPose>();
    for (const link of Object.values(mechanism.links)) {
      const entry: BodyPose = { ...(isIdentity(link.transform) ? {} : { transform: link.transform }), ...(link.blockedBy === undefined ? {} : { blockedBy: link.blockedBy }) };
      if (entry.transform || entry.blockedBy !== undefined) for (const body of link.bodies) byBody.set(body, entry);
    }
    pose = (body) => byBody.get(body) ?? {};
    POSES.set(mechanism, pose);
  }
  return pose;
}

// Does the mechanism hold a pose the model as modelled is not: a link that is moved or blocked?
export const holdsPose = (mechanism: MechanismResult | undefined): boolean => mechanism !== undefined && Object.values(mechanism.links).some((link) => link.blockedBy !== undefined || !isIdentity(link.transform));

export const placePoint = (t: RigidTransform, x: number, y: number, z: number): Vec3 => {
  const [a, b, c] = t.matrix;
  return [a[0] * x + a[1] * y + a[2] * z + t.translation[0], b[0] * x + b[1] * y + b[2] * z + t.translation[1], c[0] * x + c[1] * y + c[2] * z + t.translation[2]];
};

// Segments (six numbers each) moved by a transform; without one, as given. Remembered by the
// segments and the transform, so a redraw of the same pose computes nothing.
const SEGMENTS = new WeakMap<object, { t: RigidTransform; out: number[] }>();
export function placedSegments(segments: ArrayLike<number>, t: RigidTransform | undefined): ArrayLike<number> {
  if (!t) return segments;
  const known = SEGMENTS.get(segments as object);
  if (known && known.t === t) return known.out;
  const out: number[] = new Array(segments.length);
  for (let i = 0; i < segments.length; i += 3) {
    const p = placePoint(t, segments[i], segments[i + 1], segments[i + 2]);
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = p[2];
  }
  SEGMENTS.set(segments as object, { t, out });
  return out;
}

// The box of a mesh, moved by a transform: the box of its moved points, remembered by the mesh and
// the transform.
const BOXES = new WeakMap<Solid, { t: RigidTransform | undefined; box: { min: Vec3; max: Vec3 } }>();
export function placedBox(solid: Solid, t: RigidTransform | undefined): { min: Vec3; max: Vec3 } {
  const known = BOXES.get(solid);
  if (known && known.t === t) return known.box;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const { positions } = solid;
  for (let i = 0; i < positions.length; i += 3) {
    const p: Vec3 = t ? placePoint(t, positions[i], positions[i + 1], positions[i + 2]) : [positions[i], positions[i + 1], positions[i + 2]];
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], p[axis]);
      max[axis] = Math.max(max[axis], p[axis]);
    }
  }
  const box = { min, max };
  BOXES.set(solid, { t, box });
  return box;
}

// The eight corners of a box, moved by a transform.
export function placedCorners(box: { min: Vec3; max: Vec3 }, t: RigidTransform | undefined): Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push(t ? placePoint(t, x, y, z) : [x, y, z]);
  return corners;
}

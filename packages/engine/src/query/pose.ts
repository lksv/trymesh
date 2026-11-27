// The posed geometry a query reads (D49): the bodies of a state moved by the transforms of their
// links, with their surfaces and the frames of their faces, and a pair of bodies in the frame of
// its first body. A body is posed when a query reads it, and a posed body is remembered by the
// modelled solid and the numbers of the transform, so a body that did not move between two steps of
// a sweep is the same object in both, and what `memo` keeps for it is found again.
import { blockedText, linkOf, motionsTo, poseOfBody } from '../sections/mechanism';
import { IDENTITY, compose, inverse, isIdentity, transformPoint } from '../solid';
import type { BodyResult, Id, Mechanism, MechanismResult, RigidTransform, Solid, Vec3 } from '../types';
import { QueryFailure } from './spec';

// ---------------------------------------------------------------- a body moved

// How many moved copies of one solid are kept, most recently used last. In one query a body is
// handed out in its pose once, and as the second body of a pair once for every other link it is
// paired with (the motion between the two links), so one state needs at most as many copies as the
// mechanism has links. Twice that keeps the state before as well (a sweep, a state asked again
// after a preview), and never fewer than eight. Sized by the mechanism that asks (`keepFor`), not
// by a fixed number: with more links than the memory holds, a state asked again would miss every
// pair it had pushed out.
const POSES_KEPT = 8;
export const keepFor = (mechanism: MechanismResult): number => Math.max(POSES_KEPT, 2 * Object.keys(mechanism.links).length);
const moved = new WeakMap<Solid, Map<string, BodyResult>>();
const key = (t: RigidTransform): string => JSON.stringify([t.matrix, t.translation]);
// How many moved meshes were built; read by the tests.
export const POSE_STATS = { meshesMoved: 0 };

// The body moved by a rigid transform: positions (single precision, as every mesh), the segments of
// the edges and the bounds; the volume, the faces and the names stay. The triangles and the face
// numbers are shared with the modelled solid (a rigid motion keeps the order of the vertices).
export function movedBody(body: BodyResult, t: RigidTransform, keep: number = POSES_KEPT): BodyResult {
  if (isIdentity(t)) return body;
  let known = moved.get(body.solid);
  if (!known) moved.set(body.solid, (known = new Map()));
  const text = key(t);
  const found = known.get(text);
  if (found) {
    known.delete(text); // most recently used goes last
    known.set(text, found);
    return found;
  }
  POSE_STATS.meshesMoved++;
  const source = body.solid.positions;
  const positions = new Float32Array(source.length);
  const bounds: BodyResult['bounds'] = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < source.length; i += 3) {
    positions.set(transformPoint(t, [source[i], source[i + 1], source[i + 2]]), i);
    for (let axis = 0; axis < 3; axis++) {
      bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
    }
  }
  const edges = body.edges.map((edge) => {
    const segments = new Float64Array(edge.segments.length);
    for (let i = 0; i < segments.length; i += 3) segments.set(transformPoint(t, [edge.segments[i], edge.segments[i + 1], edge.segments[i + 2]]), i);
    return { ...edge, segments };
  });
  const result: BodyResult = { solid: { positions, triangles: body.solid.triangles, faceIds: body.solid.faceIds }, volume: body.volume, bounds, faces: body.faces, edges };
  known.set(text, result);
  while (known.size > keep) known.delete(known.keys().next().value as string);
  return result;
}

// The box of a body moved by a transform, from the eight corners of its box as modelled: it holds
// the moved body (it may be larger than the box of the moved mesh), and it costs no mesh.
export function movedBox(bounds: BodyResult['bounds'], t: RigidTransform | undefined): BodyResult['bounds'] {
  if (!t) return bounds;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const p = transformPoint(t, [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? bounds.max[axis] : bounds.min[axis])) as Vec3);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], p[axis]);
      max[axis] = Math.max(max[axis], p[axis]);
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------- the bodies of a context

// What the engine keeps about a posed body it handed out: the body as modelled, the transform of
// its link and the motions of the joints from the root to the link (nearest the root first).
interface Posed {
  modelled: BodyResult;
  transform: RigidTransform;
  motions: RigidTransform[];
  keep: number; // the memory of moved copies the mechanism needs (`keepFor`)
}
const records = new WeakMap<BodyResult, Posed>();

// The pose of one state: how a body, a surface and a frame of a face are moved, or why the pose of
// a body is not known. Undefined when nothing moves and nothing is blocked: the context is then the
// one of the model as modelled.
export interface Pose {
  bodies: Readonly<Record<Id, BodyResult>>;
  // the transform of the body; undefined when it stands as modelled; throws for a blocked body
  transformOf(body: Id): RigidTransform | undefined;
  // a box that holds the body in the pose, without moving its mesh (`movedBox`)
  boxOf(body: Id): BodyResult['bounds'];
}
// The pose a map of bodies handed out by a context belongs to.
const poses = new WeakMap<object, Pose>();
export function poseOf(section: Mechanism | undefined, mechanism: MechanismResult | undefined, modelled: Readonly<Record<Id, BodyResult>>): Pose | undefined {
  if (!section || !mechanism) return undefined;
  if (Object.values(mechanism.links).every((own) => own.blockedBy === undefined && isIdentity(own.transform))) return undefined;
  const transformOf = (body: Id): RigidTransform | undefined => {
    const pose = poseOfBody(mechanism, body);
    if (pose !== undefined && 'blockedBy' in pose) throw new QueryFailure('failed', blockedText(section, mechanism, body));
    return pose;
  };
  const keep = keepFor(mechanism);
  const boxes = new Map<Id, BodyResult['bounds']>();
  const boxOf = (id: Id): BodyResult['bounds'] => {
    let box = boxes.get(id);
    if (!box) boxes.set(id, (box = movedBox(modelled[id].bounds, transformOf(id))));
    return box;
  };
  const handed = new Map<Id, BodyResult>();
  const bodyOf = (id: Id): BodyResult => {
    const found = handed.get(id);
    if (found) return found;
    const t = transformOf(id);
    let out = modelled[id];
    if (t) {
      out = movedBody(modelled[id], t, keep);
      records.set(out, { modelled: modelled[id], transform: t, motions: motionsTo(section, mechanism, linkOf(mechanism, id) as Id), keep });
    }
    handed.set(id, out);
    return out;
  };
  // Every key is there, so a caller can list the bodies without reading one; a body is posed when it
  // is read.
  const bodies: Record<Id, BodyResult> = {};
  for (const id of Object.keys(modelled)) Object.defineProperty(bodies, id, { enumerable: true, get: () => bodyOf(id) });
  const pose = { bodies, transformOf, boxOf };
  poses.set(bodies, pose);
  return pose;
}

// A box that holds the body `id` of a map a context handed out, in its pose: the box of the body
// where nothing moves it, else `movedBox` (so a pair far apart is rejected without moving a mesh).
export function boxOf(bodies: Readonly<Record<Id, BodyResult>>, id: Id): BodyResult['bounds'] {
  const pose = poses.get(bodies);
  return pose ? pose.boxOf(id) : bodies[id].bounds;
}

// ---------------------------------------------------------------- a pair in the frame of its first body

const sameNumbers = (a: RigidTransform, b: RigidTransform): boolean => a === b || key(a) === key(b);

// For a query about a pair of bodies (the collisions, the gap): the first body as modelled, the
// second moved by the motions of the joints on the way from the link of the first to its own, and
// `back`, which takes that frame to the pose. What the pair shares depends only on how the two
// stand to each other, so two bodies of one link are computed as modelled, and two bodies across
// one joint from the one as modelled and the other turned about that joint only: faces flush across
// a joint along a coordinate axis stay in one plane bit for bit, however the joints nearer the root
// stand. Both arguments are bodies a context handed out. Undefined when neither was moved: they are
// the modelled bodies already. The pair is ordered: the frame is that of the first body.
// `relative` is the transform that puts the second body as modelled (`bModelled`) into that frame,
// for the meshes that stand in for a body of the pair (the part of a body in the zone of a thread
// and the rest, D76).
export function pairInFrame(a: BodyResult, b: BodyResult): { a: BodyResult; b: BodyResult; back: RigidTransform; relative: RigidTransform; bModelled: BodyResult } | undefined {
  const [first, second] = [records.get(a), records.get(b)];
  if (!first && !second) return undefined;
  const [A, motionsA] = first ? [first.modelled, first.motions] : [a, []];
  const [B, motionsB] = second ? [second.modelled, second.motions] : [b, []];
  // the joints both links hang on cancel: their motions are the same numbers
  let common = 0;
  while (common < motionsA.length && common < motionsB.length && sameNumbers(motionsA[common], motionsB[common])) common++;
  let relative = IDENTITY;
  for (let i = motionsA.length - 1; i >= common; i--) relative = compose(relative, inverse(motionsA[i]));
  for (let i = common; i < motionsB.length; i++) relative = compose(relative, motionsB[i]);
  const keep = Math.max(first?.keep ?? 0, second?.keep ?? 0);
  return { a: A, b: movedBody(B, relative, keep), back: first ? first.transform : IDENTITY, relative, bModelled: B };
}
// How many moved copies of a mesh a pair keeps, for a mesh that stands in for one of its bodies.
export function keepOf(a: BodyResult, b: BodyResult): number {
  return Math.max(records.get(a)?.keep ?? POSES_KEPT, records.get(b)?.keep ?? POSES_KEPT);
}

// A pair as a query about pairs reads it: in the frame of the first body when either moved.
// `relative` and `bModelled` as for `pairInFrame`; absent when neither moved.
export function framed(bodies: Readonly<Record<Id, BodyResult>>, a: Id, b: Id): { a: BodyResult; b: BodyResult; back?: RigidTransform; relative?: RigidTransform; bModelled?: BodyResult } {
  const [A, B] = [bodies[a], bodies[b]];
  return pairInFrame(A, B) ?? { a: A, b: B };
}

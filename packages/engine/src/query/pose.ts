// The posed geometry a query reads (D49): the bodies of a state moved by the transforms of their
// links, with their surfaces and the frames of their faces, and a pair of bodies in the frame of
// its first body. A body is posed when a query reads it, and a posed body is remembered by the
// modelled solid and the numbers of the transform, so a body that did not move between two steps of
// a sweep is the same object in both, and what `memo` keeps for it is found again.
import { blockedText, linkOf, motionsTo, poseOfBody } from '../sections/mechanism';
import { IDENTITY, compose, inverse, isIdentity, transformPoint } from '../solid';
import type { BodyResult, Id, Mechanism, MechanismResult, RigidTransform, Solid } from '../types';
import { QueryFailure } from './spec';

// ---------------------------------------------------------------- a body moved

const POSES_KEPT = 8; // per solid; a sweep alternates between a few
const moved = new WeakMap<Solid, Map<string, BodyResult>>();
const key = (t: RigidTransform): string => JSON.stringify([t.matrix, t.translation]);

// The body moved by a rigid transform: positions (single precision, as every mesh), the segments of
// the edges and the bounds; the volume, the faces and the names stay. The triangles and the face
// numbers are shared with the modelled solid (a rigid motion keeps the order of the vertices).
export function movedBody(body: BodyResult, t: RigidTransform): BodyResult {
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
  if (known.size > POSES_KEPT) known.delete(known.keys().next().value as string);
  return result;
}

// ---------------------------------------------------------------- the bodies of a context

// What the engine keeps about a posed body it handed out: the body as modelled, the transform of
// its link and the motions of the joints from the root to the link (nearest the root first).
interface Posed {
  modelled: BodyResult;
  transform: RigidTransform;
  motions: RigidTransform[];
}
const records = new WeakMap<BodyResult, Posed>();

// The pose of one state: how a body, a surface and a frame of a face are moved, or why the pose of
// a body is not known. Undefined when nothing moves and nothing is blocked: the context is then the
// one of the model as modelled.
export interface Pose {
  bodies: Readonly<Record<Id, BodyResult>>;
  // the transform of the body; undefined when it stands as modelled; throws for a blocked body
  transformOf(body: Id): RigidTransform | undefined;
}
export function poseOf(section: Mechanism | undefined, mechanism: MechanismResult | undefined, modelled: Readonly<Record<Id, BodyResult>>): Pose | undefined {
  if (!section || !mechanism) return undefined;
  if (Object.values(mechanism.links).every((own) => own.blockedBy === undefined && isIdentity(own.transform))) return undefined;
  const transformOf = (body: Id): RigidTransform | undefined => {
    const pose = poseOfBody(mechanism, body);
    if (pose !== undefined && 'blockedBy' in pose) throw new QueryFailure('failed', blockedText(mechanism, body, pose.blockedBy));
    return pose;
  };
  const handed = new Map<Id, BodyResult>();
  const bodyOf = (id: Id): BodyResult => {
    const found = handed.get(id);
    if (found) return found;
    const t = transformOf(id);
    let out = modelled[id];
    if (t) {
      out = movedBody(modelled[id], t);
      records.set(out, { modelled: modelled[id], transform: t, motions: motionsTo(section, mechanism, linkOf(mechanism, id) as Id) });
    }
    handed.set(id, out);
    return out;
  };
  // Every key is there, so a caller can list the bodies without reading one; a body is posed when it
  // is read.
  const bodies: Record<Id, BodyResult> = {};
  for (const id of Object.keys(modelled)) Object.defineProperty(bodies, id, { enumerable: true, get: () => bodyOf(id) });
  return { bodies, transformOf };
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
export function pairInFrame(a: BodyResult, b: BodyResult): { a: BodyResult; b: BodyResult; back: RigidTransform } | undefined {
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
  return { a: A, b: movedBody(B, relative), back: first ? first.transform : IDENTITY };
}

// A pair as a query about pairs reads it: in the frame of the first body when either moved.
export function framed(bodies: Readonly<Record<Id, BodyResult>>, a: Id, b: Id): { a: BodyResult; b: BodyResult; back?: RigidTransform } {
  const [A, B] = [bodies[a], bodies[b]];
  return pairInFrame(A, B) ?? { a: A, b: B };
}

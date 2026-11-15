// What an entity of the model is, exactly (D39): a face, an edge or a sketch point reduced to what
// can be measured. It is read from the surfaces, the frames of faces and the solved sketches of
// the context, never fitted to the mesh; only the two ends of a straight edge are taken from the
// mesh, along the exact line. It reads the geometry of bodies only from the context, so it
// answers for a pose without a change.
import { toWorld } from '../solid';
import { circleBetween } from '../surfaces';
import type { ArgPath, EntityRef, Vec3 } from '../types';
import { add3, cross3, dot3, edgeKey, faceKey, has, mul3, sub3, unit3 } from '../util';
import { body as describeBody } from './body';
import { type QueryContext, QueryFailure } from './spec';

// - `plane`: a planar face. `normal` points out of the body.
// - `cylinder`, `cone`: a face. `convex`: the material is on the side of the axis (a pin); false
//   for a hole.
// - `swept`: a face swept along `axis` (the teeth of a gear): it has a direction and no position.
// - `line`: an edge of the kind `line`, which is the edge of two planar faces: the line of its two
//   planes. `from` and `to` are its ends, `direction` is a unit vector from `from` to `to`.
// - `circle`: an edge of the kind `circle`: the circle of its two surfaces, whole even when the
//   edge is an arc of it.
// - `point`: a sketch point, where the model has it (a sketch is never posed).
// - `other`: a general surface, an edge of the kind `coplanar` or `other`. Nothing exact is known
//   about it; it can still be measured on the mesh.
// Directions are unit vectors.
export type EntityShape =
  | { is: 'point'; at: Vec3 }
  | { is: 'line'; from: Vec3; to: Vec3; direction: Vec3 }
  | { is: 'circle'; center: Vec3; axis: Vec3; radius: number }
  | { is: 'plane'; origin: Vec3; normal: Vec3 }
  | { is: 'cylinder'; origin: Vec3; axis: Vec3; radius: number; convex: boolean } // origin: a point of the axis
  | { is: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number; convex: boolean }
  | { is: 'swept'; axis: Vec3 }
  | { is: 'other' };

// A whole body is not an entity that has a shape.
export type ShapedRef = Exclude<EntityRef, { kind: 'body' }>;

const OTHER: EntityShape = { is: 'other' };

// The shape of the entity `ref`. `arg` is the path of the argument the entity came in, for the
// failure. That the body, the face, the edge and the point exist was checked before `run`; what
// can still be found here is a sketch that did not evaluate (it is in the document, so the check
// let it through), answered as `notAvailable`. An entity that is not in the state after all (a
// caller that did not check) is `notAvailable` as well.
export function entityShape(context: QueryContext, ref: ShapedRef, arg: ArgPath): EntityShape {
  const missing = (what: string, at: ArgPath = arg): never => {
    throw new QueryFailure('notAvailable', what, at);
  };
  if (ref.kind === 'sketchPoint') {
    const sketch = context.sketch(ref.sketch);
    if (!sketch) return missing(`the sketch "${ref.sketch}" did not evaluate, so its points have no place`, [...arg, 'sketch']);
    if (!has(sketch.geometry.points, ref.point)) return missing(`the point "${ref.point}" of the sketch "${ref.sketch}" has no place (its projected geometry is missing)`, [...arg, 'point']);
    const { x, y } = sketch.geometry.points[ref.point];
    return { is: 'point', at: toWorld(sketch.frame, x, y) };
  }
  if (!has(context.bodies, ref.body)) return missing(`the body "${ref.body}" is not in the state asked about`, [...arg, 'body']);
  const body = context.bodies[ref.body];
  if (ref.kind === 'face') {
    const surface = context.surface(ref.body, ref.face);
    if (!surface) return missing(`the body "${ref.body}" has no face ${faceKey(ref.face)}`, [...arg, 'face']);
    if (surface.kind === 'plane') {
      const frame = context.frame({ kind: 'face', body: ref.body, face: ref.face });
      if ('problem' in frame) return missing(`the body "${ref.body}" has no face ${faceKey(ref.face)}`, [...arg, 'face']);
      return { is: 'plane', origin: surface.origin, normal: unit3(frame.normal) };
    }
    if (surface.kind === 'swept') return { is: 'swept', axis: unit3(surface.axis) };
    if (surface.kind === 'general') return OTHER;
    // which side the material is on comes from the description of the body, kept by its mesh
    const key = faceKey(ref.face);
    const convex = describeBody.run(context, { body: ref.body }).faces.find((face) => faceKey(face.name) === key)?.convex === true;
    return surface.kind === 'cylinder'
      ? { is: 'cylinder', origin: surface.origin, axis: unit3(surface.axis), radius: surface.radius, convex }
      : { is: 'cone', apex: surface.apex, axis: unit3(surface.axis), halfAngle: surface.halfAngle, convex };
  }
  const key = edgeKey(ref.edge);
  const edge = body.edges.find((candidate) => edgeKey(candidate.name) === key);
  if (!edge) return missing(`the body "${ref.body}" has no edge ${key}`, [...arg, 'edge']);
  const [a, b] = [context.surface(ref.body, edge.name.a), context.surface(ref.body, edge.name.b)];
  if (!a || !b) return OTHER;
  if (edge.kind === 'circle') {
    const circle = circleBetween(a, b);
    return circle ? { is: 'circle', ...circle } : OTHER;
  }
  if (edge.kind !== 'line' || a.kind !== 'plane' || b.kind !== 'plane' || edge.segments.length < 6) return OTHER;
  // the line of the two planes; its extent along that line from the segments of the edge
  const [na, nb] = [unit3(a.normal), unit3(b.normal)];
  const across = cross3(na, nb);
  const [da, db] = [dot3(na, a.origin), dot3(nb, b.origin)];
  const point = mul3(add3(mul3(cross3(nb, across), da), mul3(cross3(across, na), db)), 1 / dot3(across, across));
  const direction = unit3(across);
  let [low, high] = [Infinity, -Infinity];
  for (let i = 0; i < edge.segments.length; i += 3) {
    const t = dot3(sub3([edge.segments[i], edge.segments[i + 1], edge.segments[i + 2]], point), direction);
    low = Math.min(low, t);
    high = Math.max(high, t);
  }
  return { is: 'line', from: add3(point, mul3(direction, low)), to: add3(point, mul3(direction, high)), direction };
}

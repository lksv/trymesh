// The query `measure` (D39): what is between two named entities. An exact part, computed from the
// surfaces in double precision, where the two entities have one; and the smallest distance on the
// mesh, which every pair has.
import { type MeshPart, closest, coordinatePrecision, meshAccuracy } from '../mesh-distance';
import type { ArgPath, Vec3 } from '../types';
import { ANGLE_TOLERANCE, cross3, dot3, edgeKey, len3, sub3 } from '../util';
import type { ArgSpecs } from './args';
import { type EntityShape, type ShapedRef, entityShape } from './entity';
import { type QueryContext, QueryFailure, type QuerySpec } from './spec';

const ENTITY = { kind: 'entity', accepts: ['face', 'edge', 'sketchPoint'] } as const;
export const MEASURE_ARGS = {
  from: { ...ENTITY, title: 'From', summary: 'A face or an edge of a body, or a sketch point.' },
  to: { ...ENTITY, title: 'To' },
} as const satisfies ArgSpecs;

// What is measured between two entities.
//
// The exact part does not depend on how finely round faces are divided. Each entity has
// a reference (what a distance is taken to) and may have a direction:
//
// shape     | reference      | direction
// point     | the point      | none
// line      | the line       | along it
// circle    | its centre     | its axis
// plane     | the plane      | its normal, out of the body
// cylinder  | its axis       | the axis
// cone      | its axis       | the axis
// swept     | none           | the direction it was swept along
// other     | none           | none
//
// - `distance`: between the two references, taken without their ends, never negative: point to
//   point, point to line, point to plane, line to line (the common perpendicular; zero when they
//   cross), and for a line and a plane or two planes only when they are parallel (within
//   `ANGLE_TOLERANCE`), because otherwise they cross and the number would say nothing. For two
//   cylinders it is the distance of their axes; for a cylinder and a planar face along its axis,
//   how far the axis is from the wall. Absent when either entity has no reference.
// - `angle`: between the two directions; absent when either entity has none.
//   - Two planes: between the normals out of the bodies, 0 to π. 0: the faces look the same way
//     (two steps); π: opposite ways (the two sides of a wall, the two walls of a slot).
//   - A plane and anything else: between the line and the plane, 0 to π/2. 0: the axis runs along
//     the plane; π/2: it stands on it.
//   - Otherwise: between the two lines, 0 to π/2.
// - `facing`: for two planar faces that look opposite ways and do not lie in one plane. `away`:
//   each lies behind the other (the two sides of a wall; `distance` is its thickness). `towards`:
//   they look at each other (the two walls of a slot, two bodies with a gap between; `distance` is
//   its width). Absent when the two planes coincide within the precision of the coordinates.
//
// The measured part:
// - `smallest`: the smallest distance between the two entities as they are on the bodies, with
//   their outlines and ends, and the two points it lies between. It is measured on the mesh, so
//   round shapes are polygons. `accuracy` estimates the difference from the exact shapes
//   (`meshAccuracy` over the bodies the two entities lie on; a sketch point adds nothing).
//
// A pair without an exact answer (a face of gear teeth, a general edge) therefore still gets
// `smallest`, and `angle` when both have a direction.
export interface Measurement {
  from: EntityShape;
  to: EntityShape;
  distance?: number; // mm, exact
  angle?: number; // rad, exact
  facing?: 'away' | 'towards';
  smallest: { distance: number; from: Vec3; to: Vec3; accuracy: number }; // mm
}

declare module './spec' {
  interface Queries {
    measure: { spec: typeof MEASURE_ARGS; result: Measurement };
  }
}

// ---------------------------------------------------------------- the exact part

// What a distance is taken to, and the direction of an entity. Directions are unit vectors.
type Reference = { is: 'point'; at: Vec3 } | { is: 'line'; at: Vec3; along: Vec3 } | { is: 'plane'; at: Vec3; normal: Vec3 };
function referenceOf(shape: EntityShape): Reference | undefined {
  switch (shape.is) {
    case 'point':
      return { is: 'point', at: shape.at };
    case 'circle':
      return { is: 'point', at: shape.center };
    case 'line':
      return { is: 'line', at: shape.from, along: shape.direction };
    case 'cylinder':
      return { is: 'line', at: shape.origin, along: shape.axis };
    case 'cone':
      return { is: 'line', at: shape.apex, along: shape.axis };
    case 'plane':
      return { is: 'plane', at: shape.origin, normal: shape.normal };
    default:
      return undefined;
  }
}
const directionOf = (shape: EntityShape): Vec3 | undefined => (shape.is === 'line' ? shape.direction : shape.is === 'plane' ? shape.normal : shape.is === 'circle' || shape.is === 'cylinder' || shape.is === 'cone' || shape.is === 'swept' ? shape.axis : undefined);

const PARALLEL = Math.sin(ANGLE_TOLERANCE);
const parallel = (a: Vec3, b: Vec3): boolean => len3(cross3(a, b)) <= PARALLEL;
const across = (a: Vec3, b: Vec3): boolean => Math.abs(dot3(a, b)) <= PARALLEL; // a line along a plane with the normal `b`

// The distance of two references, or undefined when the pair has none.
function distanceOf(a: Reference, b: Reference): number | undefined {
  if (a.is === 'point' && b.is === 'point') return len3(sub3(a.at, b.at));
  if (a.is === 'plane' && b.is !== 'plane') return distanceOf(b, a);
  if (a.is === 'line' && b.is === 'point') return distanceOf(b, a);
  const between = sub3(b.at, a.at);
  if (a.is === 'point') return b.is === 'line' ? len3(cross3(between, b.along)) : Math.abs(dot3(between, (b as Extract<Reference, { is: 'plane' }>).normal));
  if (a.is === 'line' && b.is === 'line') {
    // parallel lines: the distance of a point of one from the other; otherwise the common perpendicular
    const normal = cross3(a.along, b.along);
    const sine = len3(normal);
    return sine <= PARALLEL ? len3(cross3(between, a.along)) : Math.abs(dot3(between, normal)) / sine;
  }
  if (a.is === 'line' && b.is === 'plane') return across(a.along, b.normal) ? Math.abs(dot3(between, b.normal)) : undefined;
  if (a.is === 'plane' && b.is === 'plane') return parallel(a.normal, b.normal) ? Math.abs(dot3(between, a.normal)) : undefined;
  return undefined;
}

// The exact part of a measurement. `precision`: the precision of the coordinates of the bodies
// concerned, within which two planes are one.
export function exactBetween(from: EntityShape, to: EntityShape, precision: number): Pick<Measurement, 'distance' | 'angle' | 'facing'> {
  const [a, b] = [referenceOf(from), referenceOf(to)];
  const distance = a && b ? distanceOf(a, b) : undefined;
  const [da, db] = [directionOf(from), directionOf(to)];
  let angle: number | undefined;
  let facing: 'away' | 'towards' | undefined;
  if (da && db) {
    const [sine, cosine] = [len3(cross3(da, db)), dot3(da, db)];
    if (from.is === 'plane' && to.is === 'plane') {
      angle = Math.atan2(sine, cosine);
      // opposite ways: the offset of one plane along the normal out of the other says which
      const offset = dot3(sub3(to.origin, from.origin), from.normal);
      if (cosine < 0 && sine <= PARALLEL && Math.abs(offset) > precision) facing = offset < 0 ? 'away' : 'towards';
    } else if (from.is === 'plane' || to.is === 'plane') angle = Math.atan2(Math.abs(cosine), sine); // between the line and the plane
    else angle = Math.atan2(sine, Math.abs(cosine));
  }
  return { ...(distance === undefined ? {} : { distance }), ...(angle === undefined ? {} : { angle }), ...(facing ? { facing } : {}) };
}

// ---------------------------------------------------------------- the measured part

// The part of the mesh an entity is: read from the bodies of the context, so the same code answers
// for a pose.
function partOf(context: QueryContext, ref: ShapedRef, shape: EntityShape, arg: ArgPath): MeshPart {
  const missing = (what: string): never => {
    throw new QueryFailure('notAvailable', what, arg);
  };
  if (ref.kind === 'sketchPoint') return shape.is === 'point' ? { point: shape.at } : missing('the sketch point has no place');
  const body = context.bodies[ref.body]; // exists: `entityShape` looked it up
  if (ref.kind === 'face') {
    const number = context.face(ref.face);
    return number === undefined ? missing('the face is not in the state asked about') : { solid: body.solid, face: number };
  }
  const key = edgeKey(ref.edge);
  const edge = body.edges.find((candidate) => edgeKey(candidate.name) === key);
  return edge ? { segments: edge.segments } : missing('the edge is not in the state asked about');
}

export const measure: QuerySpec<typeof MEASURE_ARGS, Measurement> = {
  title: 'Measure',
  summary: 'Distance and angle between two faces, edges or sketch points. Exact for planes, cylinders, cones, straight and circular edges and sketch points; the smallest distance on the mesh for every pair. The time grows with the number of triangles of the two faces.',
  returns:
    '`from`, `to`: what each entity is, by `is`: `plane` (`origin`, `normal` out of the body), `cylinder` (`origin`: a point of its axis, `axis`, `radius`, `convex`: true for a pin, false for a hole), `cone` (`apex`, `axis`, `halfAngle`, `convex`), `swept` (`axis`: the direction a face of gear teeth was swept along), `circle` (`center`, `axis`, `radius`), `line` (`from`, `to`, `direction`), `point` (`at`), `other` (nothing exact is known). ' +
    '`distance` (mm, exact, never negative): between the plane, the axis, the line, the centre or the point of the two, taken without their ends; for two planes or a line and a plane only when they are parallel; absent for `swept` and `other`. Two cylinders: the distance of their axes. ' +
    '`angle` (rad, exact): two planes 0 to π between the normals out of the bodies (π: the two sides of a wall), a plane and an axis or a line 0 to π/2 between the line and the plane, otherwise 0 to π/2; absent for a point and for `other`. ' +
    '`facing`: `away` (the two sides of a wall; `distance` is its thickness) or `towards` (the two walls of a slot), for planes that look opposite ways. ' +
    '`smallest`: the smallest distance between the two as they are on the bodies, with their outlines and ends, measured on the mesh, with the two points (`from`, `to`) and `accuracy` (mm, an estimate of how far the mesh may be from the exact shapes). For a hole next to a wall, `distance` is the axis to the wall and `smallest` the material left between them.',
  args: MEASURE_ARGS,
  units: { distance: 'mm', angle: 'rad', accuracy: 'mm', radius: 'mm', halfAngle: 'rad' },
  run(context, args) {
    const [from, to] = [entityShape(context, args.from, ['from']), entityShape(context, args.to, ['to'])];
    const found = closest(partOf(context, args.from, from, ['from']), partOf(context, args.to, to, ['to']));
    if (!found) throw new QueryFailure('failed', 'an entity has no geometry in the state asked about');
    const bodies = [args.from, args.to].flatMap((ref) => (ref.kind === 'sketchPoint' ? [] : [ref.body]));
    const precision = coordinatePrecision(...bodies.map((id) => context.bodies[id]));
    return { from, to, ...exactBetween(from, to, precision), smallest: { distance: found.distance, from: found.a, to: found.b, accuracy: meshAccuracy(context, bodies) } };
  },
};

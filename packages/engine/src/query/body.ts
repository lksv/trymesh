// The query `body`: a body described for a reader that does not hold its mesh. Every face with its
// name, its surface and its area, every edge with its name and its shape.
import { type Circle3, circleBetween } from '../surfaces';
import type { BodyDescription, BodyEdge, BodyFace, BodyResult, EdgeKind, FaceName, Surface, Vec3 } from '../types';
import { add3, cross3, dot3, len3, mul3, sub3 } from '../util';
import type { ArgSpecs } from './args';
import type { QuerySpec } from './spec';

export const BODY_ARGS = { body: { kind: 'body', title: 'Body' } } as const satisfies ArgSpecs;

declare module './spec' {
  interface Queries {
    body: { spec: typeof BODY_ARGS; result: BodyDescription };
  }
}

// What the triangles of a face add up to.
interface FaceSums {
  normal: Vec3; // the sum of the normals of the triangles, weighted by area: it points out of the body
  area: number;
  outward: number; // how much the normals point away from the axis of the face's surface, weighted by area
}

// One pass over the triangles of the body. `axisOf` gives the axis of the surface of a face that
// has one (a cylinder, a cone): whether the normals of the face point away from that axis or
// towards it says whether the material is inside (a pin) or outside (a hole). The plain sum of the
// normals does not: for a full cylinder it is zero.
function faceSums(body: BodyResult, axisOf: (face: number) => { origin: Vec3; axis: Vec3 } | undefined): Map<number, FaceSums> {
  const { positions: p, triangles, faceIds } = body.solid;
  const at = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const sums = new Map<number, FaceSums>();
  for (let t = 0; t < faceIds.length; t++) {
    const [a, b, c] = [at(triangles[3 * t]), at(triangles[3 * t + 1]), at(triangles[3 * t + 2])];
    const n = cross3(sub3(b, a), sub3(c, a)); // twice the area long
    let sum = sums.get(faceIds[t]);
    if (!sum) sums.set(faceIds[t], (sum = { normal: [0, 0, 0], area: 0, outward: 0 }));
    sum.normal = add3(sum.normal, n);
    sum.area += len3(n) / 2;
    const line = axisOf(faceIds[t]);
    if (line) {
      const centroid = mul3(add3(add3(a, b), c), 1 / 3);
      const from = sub3(centroid, line.origin);
      const radial = sub3(from, mul3(line.axis, dot3(from, line.axis) / dot3(line.axis, line.axis)));
      sum.outward += dot3(n, radial);
    }
  }
  return sums;
}

// The shape of an edge from its segments (6 numbers per segment, in no particular order). The
// length always; for a straight edge the two ends along its direction (an edge can have gaps);
// for a circular one its circle, which is that of the surfaces of its two faces (`circle`), not
// a fit to its vertices: it is exact, and an arc of two segments has it as well.
type EdgeShape = BodyEdge extends infer E ? (E extends BodyEdge ? Omit<E, 'name'> : never) : never;
function edgeShape(kind: EdgeKind, s: Float64Array, circle: Circle3 | undefined): EdgeShape {
  const count = s.length / 6;
  const at = (i: number): Vec3 => [s[3 * i], s[3 * i + 1], s[3 * i + 2]];
  let length = 0;
  for (let i = 0; i < count; i++) length += len3(sub3(at(2 * i + 1), at(2 * i)));
  const base = { length, segments: count };
  if (kind === 'line' && count > 0) {
    const direction = sub3(at(1), at(0));
    let [low, high] = [0, 0];
    for (let i = 0; i < 2 * count; i++) {
      if (dot3(sub3(at(i), at(0)), direction) < dot3(sub3(at(low), at(0)), direction)) low = i;
      if (dot3(sub3(at(i), at(0)), direction) > dot3(sub3(at(high), at(0)), direction)) high = i;
    }
    const span = len3(sub3(at(high), at(low)));
    return { ...base, kind, from: at(low), to: at(high), gaps: length < span - 1e-6 * Math.max(1, span) };
  }
  // the kind `circle` promises a plane across the axis of a cylinder; without their circle the
  // edge is described as a general one
  if (kind === 'circle' && circle) return { ...base, kind, circle };
  return { ...base, kind: kind === 'coplanar' ? 'coplanar' : 'other' };
}

const axisOf = (surface: Surface): { origin: Vec3; axis: Vec3 } | undefined => (surface.kind === 'cylinder' ? { origin: surface.origin, axis: surface.axis } : surface.kind === 'cone' ? { origin: surface.apex, axis: surface.axis } : undefined);

export const body: QuerySpec<typeof BODY_ARGS, BodyDescription> = {
  title: 'Description of a body',
  summary: 'A body in detail: its faces with their names, surfaces and areas, and its edges with their names and shapes. The names are what references use: the plane of a sketch on a face, the projection of an edge, an entity in the arguments of another query.',
  returns:
    '`volume` (mm³), `bounds` (`min`, `max`), `faces`: each `{ name, surface, area, meshNormal?, convex? }` (`surface` is a plane, a cylinder, a cone, a swept or a general surface; `meshNormal` of a planar face is its unit normal out of the body; `convex` of a cylinder or a cone is true for a pin and false for a hole), ' +
    '`edges`: each `{ name, kind, length, segments }` and for a `line` its ends `from`, `to` and `gaps` (a cut interrupts it), for a `circle` its `circle: { center, axis, radius }`, exact: the circle of the two surfaces, whole even when the edge is an arc of it.',
  args: BODY_ARGS,
  units: { volume: 'mm3', area: 'mm2', length: 'mm', radius: 'mm' },
  // The description is kept by the mesh: a body that did not change is not walked again.
  run: (context, { body: id }) => {
    const result = context.bodies[id];
    const names = context.state.evaluation.faceNames;
    const described = context.memo([result.solid], 'description', () => {
      const surfaces = new Map(result.faces.map((face) => [face.id, context.surface(id, names[face.id]) as Surface]));
      const sums = faceSums(result, (face) => {
        const surface = surfaces.get(face);
        return surface && axisOf(surface);
      });
      const faces = result.faces.map((face): BodyFace => {
        const surface = surfaces.get(face.id) as Surface;
        const sum = sums.get(face.id) ?? { normal: [0, 0, 0] as Vec3, area: 0, outward: 0 };
        return {
          name: names[face.id],
          surface,
          area: sum.area,
          ...(surface.kind === 'plane' ? { meshNormal: mul3(sum.normal, 1 / (len3(sum.normal) || 1)) } : {}),
          ...(axisOf(surface) ? { convex: sum.outward > 0 } : {}),
        };
      });
      const surfaceOf = (name: FaceName): Surface | undefined => context.surface(id, name);
      const edges = result.edges.map((edge): BodyEdge => {
        const [a, b] = [surfaceOf(edge.name.a), surfaceOf(edge.name.b)];
        return { name: edge.name, ...edgeShape(edge.kind, edge.segments, edge.kind === 'circle' && a && b ? circleBetween(a, b) : undefined) };
      });
      return { volume: result.volume, bounds: result.bounds, faces, edges };
    });
    return { body: id, ...described };
  },
};

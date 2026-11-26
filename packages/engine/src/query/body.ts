// The query `body`: a body described for a reader that does not hold its mesh. Every face with its
// name, its surface and its area, every edge with its name and its shape.
import { type Circle3, circleBetween } from '../surfaces';
import type { BodyDescription, BodyEdge, BodyFace, BodyResult, EdgeKind, FaceName, Id, Surface, Vec3 } from '../types';
import { add3, cross3, dot3, len3, mul3, sub3 } from '../util';
import type { ArgSpecs } from './args';
import type { QuerySpec } from './spec';

export const BODY_ARGS = {
  body: { kind: 'body', title: 'Body' },
  feature: {
    kind: 'feature',
    title: 'Only of the feature',
    summary: 'only the faces this feature made, or a pattern of that ID copied (a face with a copy tag of it), and the edges with such a face on one side; for finding the edges of one hole or one pocket in a large body',
    optional: true,
  },
  only: { kind: 'choice', options: ['faces', 'edges'], title: 'Only', summary: 'the faces or the edges alone, the other list left out', optional: true },
} as const satisfies ArgSpecs;

declare module './spec' {
  interface Queries {
    body: { spec: typeof BODY_ARGS; result: BodyDescription };
  }
}

// What the triangles of a face add up to.
interface FaceSums {
  normal: Vec3; // the sum of the normals of the triangles, weighted by area: it points out of the body
  area: number;
  outward: number; // how much the normals point away from the centre of the face's surface, weighted by area
}

// One pass over the triangles of the body. `centreOf` gives, for a face whose surface has one,
// the centre a point of it is curved about: the foot on the axis of a cylinder or a cone, the centre
// of a sphere, the centre of the tube of a torus in the half plane of the point. Whether the normals
// of the face point away from it or towards it says whether the material is inside (a pin, a ball,
// a ring) or outside (a hole, a socket, a groove). The plain sum of the normals does not: for
// a full cylinder it is zero.
function faceSums(body: BodyResult, centreOf: (face: number) => ((point: Vec3) => Vec3) | undefined): Map<number, FaceSums> {
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
    const centre = centreOf(faceIds[t]);
    if (centre) {
      const centroid = mul3(add3(add3(a, b), c), 1 / 3);
      sum.outward += dot3(n, sub3(centroid, centre(centroid)));
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

// The foot of a point on the axis through `origin` along `axis`.
const foot = (origin: Vec3, axis: Vec3) => (point: Vec3): Vec3 => add3(origin, mul3(axis, dot3(sub3(point, origin), axis) / dot3(axis, axis)));
// The centre a point of a round surface is curved about (see `faceSums`); undefined for a plane,
// a swept and a general surface.
function centreOf(surface: Surface): ((point: Vec3) => Vec3) | undefined {
  switch (surface.kind) {
    case 'cylinder':
      return foot(surface.origin, surface.axis);
    case 'cone':
      return foot(surface.apex, surface.axis);
    case 'sphere':
      return () => surface.center;
    case 'torus': {
      const onAxis = foot(surface.center, surface.axis);
      return (point) => {
        const at = onAxis(point);
        const away = sub3(point, at);
        const length = len3(away);
        return length > 0 ? add3(at, mul3(away, surface.majorRadius / length)) : at;
      };
    }
    default:
      return undefined;
  }
}

// A face the feature made, or a pattern with that ID copied.
const ofFeature = (name: FaceName, feature: Id): boolean => name.feature === feature || (name.copy ?? []).some((tag) => tag.pattern === feature);

export const body: QuerySpec<typeof BODY_ARGS, BodyDescription> = {
  title: 'Description of a body',
  summary: 'A body in detail: its faces with their names, surfaces and areas, and its edges with their names and shapes. The names are what references use: the plane of a sketch on a face, the projection of an edge, an entity in the arguments of another query.',
  returns:
    '`volume` (mm³), `bounds` (`min`, `max`), `faces`: each `{ name, surface, area, meshNormal?, convex? }` (`surface` is a plane, a cylinder, a cone, a sphere, a torus, a swept or a general surface; `meshNormal` of a planar face is its unit normal out of the body; `convex` of a cylinder, a cone, a sphere or a torus is true for a pin, a ball or a ring and false for a hole, a socket or a groove), ' +
    '`edges`: each `{ name, kind, length, segments }` and for a `line` its ends `from`, `to` and `gaps` (a cut interrupts it), for a `circle` its `circle: { center, axis, radius }`, exact: the circle of the two surfaces, whole even when the edge is an arc of it. ' +
    'With `feature` or `only` the lists hold what passes, and `total` the counts of the whole body (`faces`, `edges`); `volume` and `bounds` are always of the whole body. A large body lists hundreds of edges, so ask for the edges of the feature you want to chamfer or fillet.',
  args: BODY_ARGS,
  units: { volume: 'mm3', area: 'mm2', length: 'mm', radius: 'mm' },
  // The description is kept by the mesh: a body that did not change is not walked again.
  run: (context, { body: id, feature, only }) => {
    const result = context.bodies[id];
    const names = context.state.evaluation.faceNames;
    const described = context.memo([result.solid], 'description', () => {
      const surfaces = new Map(result.faces.map((face) => [face.id, context.surface(id, names[face.id]) as Surface]));
      const sums = faceSums(result, (face) => {
        const surface = surfaces.get(face);
        return surface && centreOf(surface);
      });
      const faces = result.faces.map((face): BodyFace => {
        const surface = surfaces.get(face.id) as Surface;
        const sum = sums.get(face.id) ?? { normal: [0, 0, 0] as Vec3, area: 0, outward: 0 };
        return {
          name: names[face.id],
          surface,
          area: sum.area,
          ...(surface.kind === 'plane' ? { meshNormal: mul3(sum.normal, 1 / (len3(sum.normal) || 1)) } : {}),
          ...(centreOf(surface) ? { convex: sum.outward > 0 } : {}),
        };
      });
      const surfaceOf = (name: FaceName): Surface | undefined => context.surface(id, name);
      const tolerance = context.state.document.settings.chordTolerance;
      const edges = result.edges.map((edge): BodyEdge => {
        const [a, b] = [surfaceOf(edge.name.a), surfaceOf(edge.name.b)];
        return { name: edge.name, ...edgeShape(edge.kind, edge.segments, edge.kind === 'circle' && a && b ? circleBetween(a, b, edge.segments, tolerance) : undefined) };
      });
      return { volume: result.volume, bounds: result.bounds, faces, edges };
    });
    if (feature === undefined && only === undefined) return { body: id, ...described };
    const total = { faces: described.faces.length, edges: described.edges.length };
    const passes = (name: FaceName): boolean => feature === undefined || ofFeature(name, feature);
    const faces = only === 'edges' ? [] : described.faces.filter((face) => passes(face.name));
    const edges = only === 'faces' ? [] : described.edges.filter((edge) => passes(edge.name.a) || passes(edge.name.b));
    return { body: id, volume: described.volume, bounds: described.bounds, faces, edges, total };
  },
};

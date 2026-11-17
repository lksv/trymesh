// The step of a chamfer and a fillet of edges (D63), one function for both types: the edges, their
// pieces, the corner of each piece, its ends, the profile, the tools, the booleans, the checks on
// the temporary face numbers, the renumbering and the result. The rules are in
// docs/architecture/edge-blend.md; the design is docs/d36/4b-edge-chamfer-fillet/design.md.
import { type EdgeData, type FaceInfo, analyzeBody, normalAt, surfaceOf, toWorld, volumeOf } from '../solid';
import { type Circle3, circleBetween } from '../surfaces';
import type { EdgeName, FaceName, Facts, Frame, Id, IssueCode, Solid, SolidKernel, Vec2, Vec3 } from '../types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, add3, cross3, dot2, dot3, edgeKey, faceKey, len3, mul3, sub3, unit3 } from '../util';
import { isImported, lookup, reach } from './services';
import type { ResolvedProfile, Step, StepContext } from './state';
import { bandOf } from './body-boolean';
import {
  BLEND_LIFT,
  BLEND_MIN_ANGLE,
  BLEND_SIDES,
  BLEND_SLIVER,
  BLEND_VOLUME,
  type BlendCorner,
  type BlendKind,
  type BlendProfile,
  type BlendSide,
  type CornerPlace,
  type EndPlane,
  blendProfile,
  blendRevolveSetup,
  edgePrism,
  liftOf,
  overshootPoints,
  placed,
  prismLength,
  prismTriangles,
  revolveRegion,
} from './tool-edge';
import { MAX_REVOLVE_TRIANGLES, buildRevolve } from './tool-revolve';

// A refusal found on the way: the error of the feature.
class BlendProblem extends Error {
  constructor(
    readonly code: IssueCode,
    readonly refs: unknown[],
    readonly detail: string,
  ) {
    super(detail);
  }
}
const refuse = (code: IssueCode, refs: unknown[], detail: string): never => {
  throw new BlendProblem(code, refs, detail);
};

const CANNOT_JOIN = 'the two edges in refs meet at a vertex in a way this feature cannot join; chamfer or fillet them in two features';

// An edge of the feature with what the recompute found of it.
interface Edge {
  index: number;
  name: EdgeName;
  data: EdgeData;
  infoA: FaceInfo;
  infoB: FaceInfo;
  line?: { point: Vec3; d: Vec3 }; // a straight edge: a point of its line, its unit direction n_a × n_b
  circle?: Circle3; // a circular edge
  pieces: Piece[];
  corner: BlendCorner;
  profile: BlendProfile;
}
// A piece of an edge: a chain of its segments.
interface Piece {
  edge: Edge;
  vertices: number[]; // canonical vertices in the order of the chain
  points: Vec3[];
  segments: number[]; // indices of the segments of the edge
  closed: boolean;
  sweep: number; // an arc: the signed angle of the chain about the axis, made positive
  length: number;
  sides?: { alongA: Vec3; alongB: Vec3; outA: Vec3; outB: Vec3 }; // a straight piece, in 3D
  half?: { alongA: Vec2; alongB: Vec2 }; // an arc, in (ρ, z) of the half plane
  convex: boolean;
  beta: number;
  ends: End[]; // the two ends of an open piece, at vertices[0] and at the last vertex
  numbers: number; // the first of its seven temporary face numbers
}
// An end of a piece: at a planar face (`face`, the face number), or where it meets another edge of
// the feature (`joint`, the edge's index). `plane`: where the tool of a straight piece ends.
interface End {
  vertex: number;
  point: Vec3;
  face?: number;
  joint?: number;
  plane?: EndPlane;
}

const NUMBERS = 7; // per piece: the five sides of the profile and the two ends
const sideNumber = (piece: Piece, side: BlendSide): number => piece.numbers + BLEND_SIDES.indexOf(side);
const endNumber = (piece: Piece, end: 0 | 1): number => piece.numbers + 5 + end;

const describeSurface = (info: FaceInfo): string => (info.planar ? 'a plane' : info.surface === 'mesh' ? 'an imported surface' : info.surface === 'swept' ? 'a swept surface' : `a ${info.surface}`);
const parallel = (a: Vec3, b: Vec3, angle: number): boolean => len3(cross3(unit3(a), unit3(b))) <= Math.sin(angle);
const clampedAngle = (cosine: number): number => Math.acos(Math.max(-1, Math.min(1, cosine)));
const shown = (value: number): string => String(Number(value.toPrecision(3)));

// The radius of curvature of a surface at a point, for the slack of an angle measured there.
function curvature(info: FaceInfo, point: Vec3): number {
  if (info.planar) return Infinity;
  switch (info.surface) {
    case 'cylinder':
      return info.radius;
    case 'cone': {
      const d = sub3(point, info.apex);
      const axis = unit3(info.axis);
      return Math.max(LENGTH_TOLERANCE, len3(sub3(d, mul3(axis, dot3(d, axis)))));
    }
    case 'sphere':
      return info.radius;
    case 'torus':
      return info.minorRadius;
    default:
      return Infinity;
  }
}

export function blendStep(kind: BlendKind, feature: Id, bodyId: Id, given: EdgeName[], size: number, context: StepContext): Step {
  const { state, done, failed } = context;
  const solid = lookup(state.bodies, bodyId);
  if (!solid) return failed('brokenReference', [bodyId]);
  if (isImported(solid, state.faceInfos)) return failed('importedTarget', [bodyId]);
  try {
    const result = blend(kind, feature, solid, given, size, context);
    const first = state.faceNames.length;
    const names: FaceName[] = given.map((_, i) => ({ feature, role: kind, edge: i }) as FaceName);
    return {
      state: done(
        { status: 'ok', warnings: [], facts: result.facts },
        {
          bodies: { ...state.bodies, [bodyId]: result.solid },
          faceNames: [...state.faceNames, ...names],
          faceInfos: [...state.faceInfos, ...result.infos],
          faceIds: new Map([...state.faceIds, ...names.map((name, i): [string, number] => [faceKey(name), first + i])]),
        },
      ),
    };
  } catch (error) {
    if (error instanceof BlendProblem) return failed(error.code, error.refs, error.detail);
    return failed('kernelFailure', [bodyId], error instanceof Error ? error.message : String(error));
  }
}

function blend(kind: BlendKind, feature: Id, solid: Solid, given: EdgeName[], size: number, context: StepContext): { solid: Solid; infos: FaceInfo[]; facts: Facts } {
  const { state, deps } = context;
  const tolerance = state.chordTolerance;
  const kernel = deps.kernel;
  const data = analyzeBody(solid, state.faceNames, state.faceInfos, tolerance);
  const p = solid.positions;
  const position = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const precision = 1e-6 * Math.max(1, reach(solid));
  const slack = (radius: number): number => ANGLE_TOLERANCE + (10 * precision) / radius;
  const lift = liftOf(tolerance, bandOf(solid));

  // The canonical vertex of every vertex of the mesh: vertices at one place are one.
  const canonical = new Int32Array(p.length / 3);
  {
    const seen = new Map<string, number>();
    for (let i = 0; i < canonical.length; i++) {
      const key = `${p[3 * i]},${p[3 * i + 1]},${p[3 * i + 2]}`;
      const known = seen.get(key);
      canonical[i] = known ?? i;
      if (known === undefined) seen.set(key, i);
    }
  }
  // The edges of the body at every canonical vertex.
  const edgesAt = new Map<number, Set<EdgeData>>();
  for (const edge of data.edges.values()) {
    for (const vertex of edge.vertices) {
      const at = canonical[vertex];
      let set = edgesAt.get(at);
      if (!set) edgesAt.set(at, (set = new Set()));
      set.add(edge);
    }
  }

  // ------------------------------------------------ 2, 3. the edges and their kind
  const edges: Edge[] = given.map((name, index) => {
    const edgeData = data.edges.get(edgeKey(name));
    if (!edgeData) return refuse('brokenReference', [name], 'the body has no such edge');
    const [infoA, infoB] = [state.faceInfos[edgeData.a], state.faceInfos[edgeData.b]];
    const unsupported = (): never => refuse('unsupportedEdge', [name], `the edge is of the kind ${edgeData.kind} between ${describeSurface(infoA)} and ${describeSurface(infoB)}; only a straight edge between two planes and a circular edge between planes, cylinders and cones about one axis can be chamfered or filleted`);
    const edge = { index, name, data: edgeData, infoA, infoB, pieces: [] } as unknown as Edge;
    if (edgeData.kind === 'line' && infoA.planar && infoB.planar) {
      const [na, nb] = [unit3(infoA.normal), unit3(infoB.normal)];
      const raw = cross3(na, nb);
      const [da, db] = [dot3(na, infoA.origin), dot3(nb, infoB.origin)];
      edge.line = { point: mul3(add3(mul3(cross3(nb, raw), da), mul3(cross3(raw, na), db)), 1 / dot3(raw, raw)), d: unit3(raw) };
    } else if (edgeData.kind === 'circle') {
      const circle = circleBetween(surfaceOf(infoA), surfaceOf(infoB), edgeData.segments, tolerance);
      if (!circle) return unsupported();
      const about = (info: FaceInfo): boolean => {
        if (info.planar) return parallel(info.normal, circle.axis, ANGLE_TOLERANCE);
        if (info.surface === 'cylinder' || info.surface === 'cone') return parallel(info.axis, circle.axis, ANGLE_TOLERANCE);
        return false;
      };
      if (!about(infoA) || !about(infoB)) return unsupported();
      edge.circle = { ...circle, axis: unit3(circle.axis) };
    } else unsupported();
    return edge;
  });
  const featureKeys = new Map(edges.map((edge) => [edgeKey(edge.name), edge.index]));

  // ------------------------------------------------ 4. the pieces
  for (const edge of edges) edge.pieces = piecesOf(edge);
  function piecesOf(edge: Edge): Piece[] {
    const { data: e } = edge;
    const segmentsAt = new Map<number, number[]>();
    const ends = (s: number): [number, number] => [canonical[e.vertices[2 * s]], canonical[e.vertices[2 * s + 1]]];
    const count = e.vertices.length / 2;
    for (let s = 0; s < count; s++) {
      const [i, j] = ends(s);
      if (i === j) continue;
      for (const v of [i, j]) segmentsAt.set(v, [...(segmentsAt.get(v) ?? []), s]);
    }
    for (const list of segmentsAt.values()) if (list.length > 2) refuse('unsupportedEdge', [edge.name], 'the edge passes one vertex more than once, so its pieces cannot be told apart');
    const used = new Set<number>();
    const chains: { vertices: number[]; segments: number[]; closed: boolean }[] = [];
    const walk = (start: number, first: number): void => {
      const chain = { vertices: [start], segments: [] as number[], closed: false };
      let [vertex, segment] = [start, first];
      for (;;) {
        used.add(segment);
        chain.segments.push(segment);
        const [i, j] = ends(segment);
        vertex = i === vertex ? j : i;
        if (vertex === start) {
          chain.closed = true;
          break;
        }
        chain.vertices.push(vertex);
        const next = (segmentsAt.get(vertex) ?? []).find((s) => !used.has(s));
        if (next === undefined) break;
        segment = next;
      }
      chains.push(chain);
    };
    for (const [vertex, list] of segmentsAt) if (list.length === 1 && !used.has(list[0])) walk(vertex, list[0]);
    for (const [vertex, list] of segmentsAt) for (const s of list) if (!used.has(s)) walk(vertex, s);
    return chains.map((chain) => {
      let vertices = chain.vertices;
      let points = vertices.map(position);
      let sweep = 0;
      let length: number;
      if (edge.circle) {
        const { center, axis } = edge.circle;
        const radial = (q: Vec3): Vec3 => {
          const r = sub3(q, center);
          return sub3(r, mul3(axis, dot3(r, axis)));
        };
        const ring = chain.closed ? [...points, points[0]] : points;
        for (let k = 0; k + 1 < ring.length; k++) {
          const [r1, r2] = [radial(ring[k]), radial(ring[k + 1])];
          sweep += Math.atan2(dot3(axis, cross3(r1, r2)), dot3(r1, r2));
        }
        if (sweep < 0) {
          vertices = [...vertices].reverse();
          points = [...points].reverse();
          sweep = -sweep;
        }
        if (chain.closed) sweep = 2 * Math.PI;
        length = edge.circle.radius * sweep;
      } else length = len3(sub3(points[points.length - 1], points[0]));
      return { edge, vertices, points, segments: chain.segments, closed: chain.closed, sweep, length, convex: false, beta: 0, ends: [], numbers: 0 };
    });
  }

  // ------------------------------------------------ 5. the corner of every piece
  const triangleCorner = (t: number): Vec3[] => [0, 1, 2].map((k) => position(solid.triangles[3 * t + k]));
  // The triangles of a face along the segments of a piece: per triangle its area, its outward unit
  // normal, and the unit direction into it across the segment (its inside lies on the left of its
  // side i → j, n × (pⱼ − pᵢ)), with the midpoint of the segment.
  function along(piece: Piece, face: 0 | 1): { area: number; normal: Vec3; inward: Vec3; middle: Vec3 }[] {
    const { data: e } = piece.edge;
    return piece.segments.flatMap((s) => {
      const t = e.triangles[2 * s + face];
      const [i, j] = [e.vertices[2 * s], e.vertices[2 * s + 1]];
      const tri = [solid.triangles[3 * t], solid.triangles[3 * t + 1], solid.triangles[3 * t + 2]];
      const forward = tri[(tri.indexOf(i) + 1) % 3] === j;
      const [from, to] = forward ? [i, j] : [j, i];
      const corners = triangleCorner(t);
      const n = cross3(sub3(corners[1], corners[0]), sub3(corners[2], corners[0]));
      const area = len3(n) / 2;
      if (!(area > 0)) return [];
      const inward = cross3(n, sub3(position(to), position(from)));
      if (!(len3(inward) > 0)) return [];
      return [{ area, normal: unit3(n), inward: unit3(inward), middle: mul3(add3(position(i), position(j)), 0.5) }];
    });
  }
  // The sign of an exact direction from the triangles: the area-weighted sum of their directions in
  // the coordinates `carry` takes them to.
  function signed<V extends number[]>(exact: V, items: { area: number; v: V }[], what: () => never): V {
    const sum = exact.map(() => 0) as unknown as V;
    let [agree, disagree] = [0, 0];
    const projection = (v: V): number => v.reduce((total, value, k) => total + value * exact[k], 0);
    for (const item of items) item.v.forEach((value, k) => (sum[k] += item.area * value));
    const along = projection(sum);
    for (const item of items) {
      const sign = projection(item.v);
      if (Math.sign(sign) === Math.sign(along)) agree += item.area;
      else disagree += item.area;
    }
    const length = Math.hypot(...sum);
    if (!(length > 0) || Math.abs(along) < 0.5 * length || disagree > 0.5 * agree) return what();
    return (along > 0 ? exact : exact.map((value) => -value)) as V;
  }
  for (const edge of edges) {
    const unclear = (): never => refuse('unsupportedEdge', [edge.name], 'the side a face of the edge lies on along it is not clear: its triangles along the edge disagree');
    for (const piece of edge.pieces) {
      const [byA, byB] = [along(piece, 0), along(piece, 1)];
      if (edge.line) {
        const { d } = edge.line;
        const exactA = unit3(cross3(d, (edge.infoA as { normal: Vec3 }).normal));
        const exactB = unit3(cross3(d, (edge.infoB as { normal: Vec3 }).normal));
        const alongA = signed(exactA, byA.map((x) => ({ area: x.area, v: x.inward })), unclear);
        const alongB = signed(exactB, byB.map((x) => ({ area: x.area, v: x.inward })), unclear);
        const outA = signed(unit3((edge.infoA as { normal: Vec3 }).normal), byA.map((x) => ({ area: x.area, v: x.normal })), unclear);
        const outB = signed(unit3((edge.infoB as { normal: Vec3 }).normal), byB.map((x) => ({ area: x.area, v: x.normal })), unclear);
        piece.sides = { alongA, alongB, outA, outB };
        piece.beta = clampedAngle(dot3(alongA, alongB));
        piece.convex = dot3(alongB, outA) < 0;
      } else {
        const { center, axis, radius } = edge.circle as Circle3;
        const half = (v: Vec3, at: Vec3): Vec2 => {
          const r = sub3(at, center);
          const out = unit3(sub3(r, mul3(axis, dot3(r, axis))));
          return [dot3(v, out), dot3(v, axis)];
        };
        const exactOf = (info: FaceInfo): Vec2 => {
          if (info.planar) return [1, 0];
          if (info.surface === 'cylinder') return [0, 1];
          const apex = dot3(sub3((info as { apex: Vec3 }).apex, center), axis);
          const l = Math.hypot(radius, apex);
          return [radius / l, -apex / l];
        };
        const alongA = signed(exactOf(edge.infoA), byA.map((x) => ({ area: x.area, v: half(x.inward, x.middle) })), unclear);
        const alongB = signed(exactOf(edge.infoB), byB.map((x) => ({ area: x.area, v: half(x.inward, x.middle) })), unclear);
        const outA: Vec2 = [0, 0];
        for (const x of byA) {
          const v = half(x.normal, x.middle);
          outA[0] += x.area * v[0];
          outA[1] += x.area * v[1];
        }
        piece.half = { alongA, alongB };
        piece.beta = clampedAngle(dot2(alongA, alongB));
        piece.convex = dot2(alongB, outA) < 0;
      }
      if (piece.beta <= BLEND_MIN_ANGLE || piece.beta >= Math.PI - BLEND_MIN_ANGLE) refuse('unsupportedEdge', [edge.name], `the faces of the edge meet at too sharp or too flat an angle (${shown((piece.beta * 180) / Math.PI)}° between them)`);
    }
    // one blend per edge: the pieces agree in the sides of their faces
    const [first, ...rest] = edge.pieces;
    for (const piece of rest) {
      const same = piece.sides && first.sides ? dot3(piece.sides.alongA, first.sides.alongA) > 0 && dot3(piece.sides.alongB, first.sides.alongB) > 0 : dot2(piece.half!.alongA, first.half!.alongA) > 0 && dot2(piece.half!.alongB, first.half!.alongB) > 0;
      if (!same || piece.convex !== first.convex) refuse('unsupportedEdge', [edge.name], 'the pieces of the edge need different chamfers: a face of the edge lies on another side of it along one of them');
    }
    edge.corner = { beta: first.beta, convex: first.convex, round: [!edge.infoA.planar, !edge.infoB.planar] };
  }

  // ------------------------------------------------ 6, 7. the ends
  const pieceEnds = new Map<number, { piece: Piece; end: 0 | 1 }[]>();
  for (const edge of edges) {
    for (const piece of edge.pieces) {
      if (piece.closed) continue;
      for (const end of [0, 1] as const) {
        const vertex = end === 0 ? piece.vertices[0] : piece.vertices[piece.vertices.length - 1];
        pieceEnds.set(vertex, [...(pieceEnds.get(vertex) ?? []), { piece, end }]);
      }
    }
  }
  // The unit direction away from the end along a piece (the tangent of an arc).
  const awayFrom = (piece: Piece, end: 0 | 1): Vec3 => {
    const point = end === 0 ? piece.points[0] : piece.points[piece.points.length - 1];
    if (piece.edge.line) {
      const other = end === 0 ? piece.points[piece.points.length - 1] : piece.points[0];
      const { d } = piece.edge.line;
      return dot3(sub3(other, point), d) >= 0 ? d : mul3(d, -1);
    }
    const { center, axis } = piece.edge.circle as Circle3;
    const r = sub3(point, center);
    const tangent = unit3(cross3(axis, sub3(r, mul3(axis, dot3(r, axis)))));
    return end === 0 ? tangent : mul3(tangent, -1);
  };
  const faceInfo = (face: number): FaceInfo => state.faceInfos[face];
  // Does the face continue the other face at the point (the same normal there)?
  const continues = (face: number, other: number, at: Vec3): boolean => {
    const [n1, n2] = [normalAt(faceInfo(face), at), normalAt(faceInfo(other), at)];
    if (!n1 || !n2) return false;
    return parallel(n1, n2, slack(Math.min(curvature(faceInfo(face), at), curvature(faceInfo(other), at))));
  };
  const nameOfEdge = (a: number, b: number): EdgeName => (faceKey(state.faceNames[a]) <= faceKey(state.faceNames[b]) ? { a: state.faceNames[a], b: state.faceNames[b] } : { a: state.faceNames[b], b: state.faceNames[a] });

  for (const edge of edges) {
    for (const piece of edge.pieces) {
      if (piece.closed) continue;
      piece.ends = ([0, 1] as const).map((end) => endOf(piece, end));
    }
  }
  function endOf(piece: Piece, end: 0 | 1): End {
    const { edge } = piece;
    const vertex = end === 0 ? piece.vertices[0] : piece.vertices[piece.vertices.length - 1];
    const point = position(vertex);
    const u = awayFrom(piece, end);
    const [a, b] = [edge.data.a, edge.data.b];
    // a straight piece ends in a plane that has to cross it at more than BLEND_MIN_ANGLE
    const crossing = (plane: EndPlane, refs: unknown[], detail: string): EndPlane => {
      if (edge.line && Math.abs(dot3(unit3(plane.normal), edge.line.d)) < Math.sin(BLEND_MIN_ANGLE)) refuse('unsupportedEdge', refs, detail);
      return plane;
    };
    const across: EndPlane = { point, normal: u };
    // 7. a convex and a concave edge of the feature at one vertex
    const others = (pieceEnds.get(vertex) ?? []).filter((other) => other.piece.edge !== edge);
    for (const other of others) {
      if (other.piece.convex !== piece.convex) refuse('unsupportedEdge', [edge.name, other.piece.edge.name], 'a convex and a concave edge of the feature (both in refs) meet at a vertex; chamfer or fillet them in two features');
    }
    // 6. another edge of the feature ends here and shares a face with this one, and no third does
    const otherEdges = [...new Set(others.map((other) => other.piece.edge))];
    if (otherEdges.length === 1) {
      const other = others.find((candidate) => candidate.piece.edge === otherEdges[0]) as { piece: Piece; end: 0 | 1 };
      const second = other.piece.edge;
      const shared = [a, b].filter((face) => face === second.data.a || face === second.data.b);
      if (shared.length === 1) {
        const [f] = shared;
        const g1 = f === a ? b : a;
        const g2 = f === second.data.a ? second.data.b : second.data.a;
        const v = awayFrom(other.piece, other.end);
        const pair = [edge.name, second.name];
        const radius = Math.min(edge.circle?.radius ?? Infinity, second.circle?.radius ?? Infinity);
        const opposite = len3(add3(u, v)) <= 2 * Math.sin(slack(radius) / 2) + 1e-12;
        if (opposite && continues(g1, g2, point)) return { vertex, point, joint: second.index, plane: across };
        if (!edge.line || !second.line) return refuse('unsupportedEdge', pair, `${CANNOT_JOIN} (an arc meets another edge at an angle, not smoothly)`);
        const sameAngle = Math.abs(edge.corner.beta - second.corner.beta) <= ANGLE_TOLERANCE;
        if (sameAngle) return { vertex, point, joint: second.index, plane: crossing({ point, normal: sub3(u, v) }, pair, `${CANNOT_JOIN} (their mitre lies within 0.01 rad of the edge)`) };
        const inward = f === a ? (piece.sides as NonNullable<Piece['sides']>).alongA : (piece.sides as NonNullable<Piece['sides']>).alongB;
        const convexCorner = dot3(v, inward) > 0;
        if (piece.convex && other.piece.convex && convexCorner) {
          const info = faceInfo(g2) as Extract<FaceInfo, { planar: true }>;
          return { vertex, point, joint: second.index, plane: crossing({ point: info.origin, normal: info.normal }, pair, `${CANNOT_JOIN} (the plane of the other face lies within 0.01 rad of the edge)`) };
        }
        return refuse('unsupportedEdge', pair, `${CANNOT_JOIN} (they meet the face they share at different angles${convexCorner ? ', and they are concave' : ' at a reflex corner of it'})`);
      }
    }
    // otherwise the faces at the end: those besides a and b with an edge with a or b through it
    const faces = new Set<number>();
    for (const e of edgesAt.get(vertex) ?? []) {
      if (e === edge.data) continue;
      if (e.a === a || e.a === b) faces.add(e.b);
      if (e.b === a || e.b === b) faces.add(e.a);
    }
    faces.delete(a);
    faces.delete(b);
    const list = [...faces];
    const named = list.map((face) => faceKey(state.faceNames[face])).join(', ');
    // a smooth end: the edge the piece runs on into has to be in the feature
    const smooth = (continuation: EdgeName): End => {
      const index = featureKeys.get(edgeKey(continuation));
      if (index === undefined) return refuse('unsupportedEdge', [edge.name, continuation], 'the edge continues smoothly into the second edge in refs; add it to this feature');
      return { vertex, point, joint: index, plane: across };
    };
    if (list.length === 1) {
      const [c] = list;
      if (continues(c, a, point)) return smooth(nameOfEdge(c, b));
      if (continues(c, b, point)) return smooth(nameOfEdge(c, a));
      const info = faceInfo(c);
      if (!info.planar) return refuse('unsupportedEdge', [edge.name], `the edge ends at a round face (${named}) that does not continue a face of the edge`);
      if (edge.line) return { vertex, point, face: c, plane: crossing({ point: info.origin, normal: info.normal }, [edge.name], `the edge ends at a plane (${named}) within 0.01 rad of the edge`) };
      const { center, axis } = edge.circle as Circle3;
      const holds = Math.abs(dot3(unit3(info.normal), axis)) <= Math.sin(ANGLE_TOLERANCE) && Math.abs(dot3(sub3(center, info.origin), unit3(info.normal))) <= LENGTH_TOLERANCE + 10 * precision;
      if (!holds) return refuse('unsupportedEdge', [edge.name], `the arc ends at a plane (${named}) that does not hold its axis`);
      return { vertex, point, face: c };
    }
    if (list.length === 2) {
      const [c1, c2] = list;
      const [ca, cb] = continues(c1, a, point) && continues(c2, b, point) ? [c1, c2] : continues(c2, a, point) && continues(c1, b, point) ? [c2, c1] : [undefined, undefined];
      if (ca !== undefined && cb !== undefined) return smooth(nameOfEdge(ca, cb));
    }
    return refuse('unsupportedEdge', [edge.name], list.length === 0 ? 'an end of the edge has no face besides its own' : `an end of the edge has the faces ${named} besides its own, which are not one face it ends at nor a seam of flush faces`);
  }

  // ------------------------------------------------ 8. the profiles
  const firstNumber = state.faceNames.length + edges.length;
  let next = firstNumber;
  let triangles = 0;
  interface Build {
    piece: Piece;
    tool: () => Solid;
    wedge: () => Solid;
    info?: () => FaceInfo; // the face of the blend of a circular piece
  }
  const builds: Build[] = [];
  let wedgeNumber = 0; // the parts inside the wedges get numbers after every tool
  const infos: (FaceInfo | undefined)[] = edges.map(() => undefined);
  for (const edge of edges) {
    const profile = blendProfile(kind, size, edge.corner, tolerance, { lift });
    edge.profile = profile;
    for (const piece of edge.pieces) {
      piece.numbers = next;
      next += NUMBERS;
      const sides = profile.keys.map((key) => sideNumber(piece, key));
      if (edge.line) {
        const sidesOf = piece.sides as NonNullable<Piece['sides']>;
        const { point: linePoint, d } = edge.line;
        const x = sidesOf.alongA;
        const y = unit3(sub3(sidesOf.alongB, mul3(x, dot3(sidesOf.alongB, x))));
        const z = cross3(x, y);
        const origin = add3(linePoint, mul3(d, dot3(sub3(piece.points[0], linePoint), d)));
        const frame: Frame = { origin, x, y, normal: z };
        const [e0, e1] = piece.ends;
        const low = dot3(sub3(e0.point, origin), z) <= dot3(sub3(e1.point, origin), z);
        const ends: [EndPlane, EndPlane] = low ? [e0.plane as EndPlane, e1.plane as EndPlane] : [e1.plane as EndPlane, e0.plane as EndPlane];
        const caps: [number, number] = low ? [endNumber(piece, 0), endNumber(piece, 1)] : [endNumber(piece, 1), endNumber(piece, 0)];
        if (prismLength(profile.points, frame, ends) <= LENGTH_TOLERANCE || prismLength(profile.wedge, frame, ends) <= LENGTH_TOLERANCE) refuse('blendDoesNotFit', [edge.name], `the ends of a piece of the edge meet within the ${kind}: the piece is shorter than the slant of its ends`);
        triangles += prismTriangles(profile.points.length) + prismTriangles(profile.wedge.length);
        const wedgeNumbers = wedgeNumber;
        wedgeNumber += 3;
        builds.push({
          piece,
          tool: () => edgePrism(profile.points, sides, frame, ends, caps, kernel),
          wedge: () => edgePrism(profile.wedge, profile.wedge.map(() => wedgeNumbers), frame, ends, [wedgeNumbers + 1, wedgeNumbers + 2], kernel),
        });
        if (!infos[edge.index]) infos[edge.index] = straightInfo(edge, frame, profile);
      } else {
        const circle = edge.circle as Circle3;
        const { alongA, alongB } = piece.half as NonNullable<Piece['half']>;
        let acrossB: Vec2 = [-alongA[1], alongA[0]];
        if (dot2(acrossB, alongB) < 0) acrossB = [-acrossB[0], -acrossB[1]];
        const place: CornerPlace = { point: [circle.radius, 0], alongA, acrossTowardsB: acrossB };
        const fitted = towardsAxis(edge, place);
        const full = piece.closed;
        const start = full ? wholeStart(circle.axis) : radialOf(circle, piece.points[0]);
        const frame: Frame = { origin: circle.center, x: start, y: circle.axis, normal: cross3(start, circle.axis) };
        const extent = full ? ({ type: 'full' } as const) : ({ type: 'angle', start: 0, angle: piece.sweep } as const);
        const toolRegion = revolveRegion(place, fitted.points, fitted.keys);
        const wedgeRegion = revolveRegion(place, fitted.wedge, fitted.wedge.map((_, i) => `w${i}`));
        const [toolSetup, wedgeSetup] = [blendRevolveSetup(toolRegion, piece.sweep, full, tolerance), blendRevolveSetup(wedgeRegion, piece.sweep, full, tolerance)];
        triangles += toolSetup.triangles + wedgeSetup.triangles;
        const blendShape: ReturnType<ResolvedProfile['sideOf']>['shape'] = fitted.blend.type === 'line' ? { type: 'line', a: placed(place, fitted.blend.a), b: placed(place, fitted.blend.b) } : { type: 'round', center: placed(place, fitted.blend.center), radius: fitted.blend.radius };
        const sideOf = (region: typeof toolRegion) => {
          const xy = region.outer.xy;
          const n = xy.length / 2;
          return (key: string): ReturnType<ResolvedProfile['sideOf']> => {
            if (key === 'blend') return { name: { role: 'side', curve: key }, shape: blendShape };
            const k = region.outer.curves.indexOf(key);
            return { name: { role: 'side', curve: key }, shape: { type: 'line', a: [xy[2 * k], xy[2 * k + 1]], b: [xy[(2 * (k + 1)) % (2 * n)], xy[(2 * (k + 1) + 1) % (2 * n)]] } };
          };
        };
        const numbered = (built: ReturnType<typeof buildRevolve>, number: (name: FaceName) => number): Solid => ({ ...built.solid, faceIds: built.solid.faceIds.map((local) => number(built.faces[local].name)) });
        const toolNumber = (name: FaceName): number => (name.role === 'startCap' ? endNumber(piece, 0) : name.role === 'endCap' ? endNumber(piece, 1) : sideNumber(piece, (name as { curve: BlendSide }).curve));
        const wedgeNumbers = wedgeNumber;
        wedgeNumber += 3;
        let built: ReturnType<typeof buildRevolve> | undefined;
        const tool = (): ReturnType<typeof buildRevolve> => (built ??= buildRevolve(feature, toolSetup, extent, frame, sideOf(toolRegion), 0, kernel as SolidKernel));
        builds.push({
          piece,
          tool: () => numbered(tool(), toolNumber),
          wedge: () => numbered(buildRevolve(feature, wedgeSetup, extent, frame, sideOf(wedgeRegion), 0, kernel as SolidKernel), (name) => wedgeNumbers + (name.role === 'side' ? 0 : name.role === 'startCap' ? 1 : 2)),
          info: () => (tool().faces.find((face) => face.name.role === 'side' && face.name.curve === 'blend') as { info: FaceInfo }).info,
        });
        if (piece === edge.pieces[0]) edge.profile = fitted;
      }
    }
  }
  if (triangles > MAX_REVOLVE_TRIANGLES) refuse('blendDoesNotFit', edges.map((edge) => edge.name), `the tools would have ${triangles} triangles, more than ${MAX_REVOLVE_TRIANGLES}; raise the chord tolerance of the document or split the feature`);

  // The profile of a circular edge, its overshoot shortened towards the axis so that no point of it
  // comes nearer to the axis than half the nearest point of the blend; a blend that reaches the axis
  // is refused.
  function towardsAxis(edge: Edge, place: CornerPlace): BlendProfile {
    const profile = edge.profile;
    const rho = (q: Vec2): number => placed(place, q)[0];
    const blendPoints = [...profile.points.slice(0, profile.keys.indexOf('pastB') + 1), ...profile.wedge.slice(1)];
    const nearest = Math.min(...blendPoints.map(rho));
    if (nearest <= LENGTH_TOLERANCE) refuse('blendDoesNotFit', [edge.name], `the ${kind} reaches the axis of the circular edge`);
    let overshoot = profile.overshoot;
    for (const { at, along: direction } of overshootPoints(kind, size, edge.corner.beta)) {
      const slope = direction[0] * place.alongA[0] + direction[1] * place.acrossTowardsB[0];
      if (slope < 0) overshoot = Math.min(overshoot, (rho(at) - nearest / 2) / -slope);
    }
    if (overshoot >= profile.overshoot) return profile;
    if (overshoot <= 2 * lift) refuse('blendDoesNotFit', [edge.name], `the ${kind} reaches too near the axis of the circular edge`);
    return blendProfile(kind, size, edge.corner, tolerance, { overshoot, lift });
  }

  // ------------------------------------------------ 9, 10. the tools and the booleans
  const unite = (solids: Solid[]): Solid | undefined => (solids.length === 0 ? undefined : solids.reduce((sum, part) => kernel.boolean('union', sum, part)));
  const cutBuilds = builds.filter((build) => build.piece.convex);
  const addBuilds = builds.filter((build) => !build.piece.convex);
  const cutTool = unite(cutBuilds.map((build) => build.tool()));
  const addTool = unite(addBuilds.map((build) => build.tool()));
  const afterCut = cutTool ? kernel.boolean('difference', solid, cutTool) : solid;
  if (afterCut.triangles.length === 0) refuse('emptyResult', [], 'the chamfer or fillet would remove the whole body');
  const result = addTool ? kernel.boolean('union', afterCut, addTool) : afterCut;
  for (const edge of edges) if (!infos[edge.index]) infos[edge.index] = (builds.find((build) => build.piece.edge === edge) as Build).info?.();

  // ------------------------------------------------ 12. the checks, on the temporary numbers
  const { areas, pairs } = faceStats(result);
  const has = (x: number, y: number): boolean => pairs.has(x < y ? `${x},${y}` : `${y},${x}`);
  for (const edge of edges) {
    for (const piece of edge.pieces) {
      const blendFace = sideNumber(piece, 'blend');
      if (!areas.has(blendFace)) {
        // how far the blend lies from the edge: within the lift of the polygons it cuts nothing
        const { beta } = edge.corner;
        const depth = kind === 'chamfer' ? edge.profile.setback * Math.cos(beta / 2) : size / Math.sin(beta / 2) - size;
        if (depth <= lift + tolerance) refuse('blendDoesNotFit', [edge.name], `the ${kind} is too small for the chord tolerance of the document: it lies ${shown(depth)} mm from the edge, within the polygons of the faces; use a larger size or a finer chord tolerance`);
        refuse('blendDoesNotFit', [edge.name], `the ${kind} of the edge would vanish`);
      }
      for (const [face, name] of [[edge.data.a, edge.name.a], [edge.data.b, edge.name.b]] as const) {
        if (!has(blendFace, face)) refuse('blendDoesNotFit', [edge.name, name], `the face in refs would vanish: the ${kind} is larger than the face is wide`);
      }
      const bound = lift * (size + edge.profile.overshoot);
      piece.ends.forEach((end, k) => {
        if (end.joint === undefined) return;
        const left = areas.get(endNumber(piece, k as 0 | 1)) ?? 0;
        if (left > bound) refuse('unsupportedEdge', [edge.name, edges[end.joint].name], `${CANNOT_JOIN} (their tools leave a step of ${shown(left)} mm² there)`);
      });
      const over = (['pastB', 'cornerB', 'cornerA', 'pastA'] as const).reduce((sum, side) => sum + (areas.get(sideNumber(piece, side)) ?? 0), 0);
      if (over > BLEND_SLIVER * piece.length) refuse('blendDoesNotFit', [edge.name], `the tool reached material it must not touch: ${shown(over)} mm² of its part past the faces of the edge is left in the result (a slot narrower than the size, a piece of the body, a hollow next to the edge)`);
    }
  }
  // every vertex of a blend lies on its surface: within the chord tolerance, the lift and the
  // precision of the coordinates (the kernel moved a vertex of a result once, at a chord tolerance
  // near its own tolerance for flush faces, design of D63, "As implemented")
  const allowance = lift + tolerance + 10 * precision;
  const blendOf = new Map<number, Edge>();
  for (const edge of edges) for (const piece of edge.pieces) blendOf.set(sideNumber(piece, 'blend'), edge);
  for (let t = 0; t < result.faceIds.length; t++) {
    const edge = blendOf.get(result.faceIds[t]);
    if (!edge) continue;
    for (let k = 0; k < 3; k++) {
      const i = result.triangles[3 * t + k];
      const off = offSurface(infos[edge.index] as FaceInfo, [result.positions[3 * i], result.positions[3 * i + 1], result.positions[3 * i + 2]]);
      if (off > allowance) refuse('kernelFailure', [edge.name], `the kernel left a vertex of the ${kind} ${shown(off)} mm off its surface; a coarser chord tolerance may help`);
    }
  }
  // the volume: what was cut (added) against the union of the parts of the tools inside their wedges
  // The bound: BLEND_VOLUME × the chord tolerance (or the share of a lift held up by the band) ×
  // the strips the blends eat, the shift the kernel may leave where a cap lies flush on an end
  // face (4 bands × the area of the profile at each end, ports.md, guarantee 3), and 10⁻³ mm³.
  const band = bandOf(solid);
  const strips = (list: Build[]): number => list.reduce((sum, build) => sum + 2 * build.piece.edge.profile.setback * build.piece.length, 0);
  const caps = (list: Build[]): number => list.reduce((sum, build) => sum + 2 * Math.abs(polygonArea(build.piece.edge.profile.points)), 0);
  const checkVolume = (list: Build[], changed: number, what: string): void => {
    if (list.length === 0) return;
    const parts = unite(list.map((build) => build.wedge())) as Solid;
    const inside = Math.abs(volumeOf(parts));
    const bound = BLEND_VOLUME * (lift / BLEND_LIFT) * strips(list) + 4 * band * caps(list) + 1e-3;
    if (changed > inside + bound) refuse('blendDoesNotFit', [...new Set(list.map((build) => build.piece.edge.name))], `the tools ${what} ${shown(changed - inside)} mm³ more than the chamfers and fillets hold: they reached material they must not touch (a piece of the body or a thin fin within the size outside the faces of the edges)`);
  };
  checkVolume(cutBuilds, volumeOf(solid) - volumeOf(afterCut), 'took');
  checkVolume(addBuilds, volumeOf(result) - volumeOf(afterCut), 'added');

  // ------------------------------------------------ 11. the renumbering
  const final = new Map<number, number>();
  for (const edge of edges) {
    const blendFace = state.faceNames.length + edge.index;
    for (const piece of edge.pieces) {
      for (const side of BLEND_SIDES) final.set(sideNumber(piece, side), blendFace);
      ([0, 1] as const).forEach((k) => {
        const end = piece.ends[k];
        final.set(endNumber(piece, k), end?.face ?? blendFace);
      });
    }
  }
  const faceIds = result.faceIds.map((face) => (face < firstNumber ? face : (final.get(face) ?? face)));
  if (faceIds.some((face) => face >= firstNumber)) throw new Error('a face of a tool of the chamfer or fillet has no number');
  const facts: Facts = {};
  for (const edge of edges) {
    facts[`setback/${edge.index}`] = edge.profile.setback;
    facts[`cut/${edge.index}`] = edge.corner.convex;
  }
  return { solid: { ...result, faceIds }, infos: infos as FaceInfo[], facts };

  // The face of the blend of a straight edge: a plane through the two lines where the chamfer meets
  // the faces, its origin where it meets face `a` at the end of the edge its projection calls `a`
  // (the smaller parameter along n_a × n_b, the outward normals), Y along the edge in that
  // direction; a cylinder about the line of the centres of the fillet's arc.
  function straightInfo(edge: Edge, frame: Frame, profile: BlendProfile): FaceInfo {
    const sidesOf = edge.pieces[0].sides as NonNullable<Piece['sides']>;
    const { point: linePoint, d } = edge.line as NonNullable<Edge['line']>;
    if (profile.blend.type === 'round') return { planar: false, surface: 'cylinder', center: toWorld(frame, profile.blend.center[0], profile.blend.center[1]), axis: d, radius: profile.blend.radius };
    const direction = unit3(cross3(sidesOf.outA, sidesOf.outB));
    let low = Infinity;
    for (const piece of edge.pieces) for (const q of piece.points) low = Math.min(low, dot3(sub3(q, linePoint), direction));
    const start = add3(linePoint, mul3(direction, low));
    const ta = add3(start, mul3(sidesOf.alongA, profile.setback));
    const tb = add3(start, mul3(sidesOf.alongB, profile.setback));
    return { planar: true, origin: ta, y: direction, normal: unit3(cross3(d, sub3(tb, ta))) };
  }
}

// How far a point lies from the exact surface of a blend (a plane, a cylinder, a cone, a sphere,
// a torus); 0 for a surface without a shape the engine knows.
function offSurface(info: FaceInfo, p: Vec3): number {
  if (info.planar) return Math.abs(dot3(sub3(p, info.origin), unit3(info.normal)));
  const half = (origin: Vec3, axis: Vec3): [number, number] => {
    const d = sub3(p, origin);
    const u = unit3(axis);
    const z = dot3(d, u);
    return [len3(sub3(d, mul3(u, z))), z];
  };
  switch (info.surface) {
    case 'cylinder':
      return Math.abs(half(info.center, info.axis)[0] - info.radius);
    case 'cone': {
      const [rho, z] = half(info.apex, info.axis);
      return Math.abs(rho * Math.cos(info.halfAngle) - z * Math.sin(info.halfAngle));
    }
    case 'sphere':
      return Math.abs(len3(sub3(p, info.center)) - info.radius);
    case 'torus': {
      const [rho, z] = half(info.center, info.axis);
      return Math.abs(Math.hypot(rho - info.majorRadius, z) - info.minorRadius);
    }
    default:
      return 0;
  }
}

// The radial unit direction of a point about the axis of a circle.
function radialOf(circle: Circle3, point: Vec3): Vec3 {
  const r = sub3(point, circle.center);
  return unit3(sub3(r, mul3(circle.axis, dot3(r, circle.axis))));
}
// Where the turn of a whole circle starts: the model's X projected across the axis, its Y where the
// axis is within 0.1 rad of X, so that the mesh does not depend on the order of the segments.
function wholeStart(axis: Vec3): Vec3 {
  const x: Vec3 = Math.abs(axis[0]) > Math.cos(0.1) ? [0, 1, 0] : [1, 0, 0];
  return unit3(sub3(x, mul3(axis, dot3(x, axis))));
}

// The signed area of a polygon (positive counter-clockwise).
const polygonArea = (points: readonly Vec2[]): number => points.reduce((sum, p, i) => sum + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1], 0) / 2;

// The area of every face number of a mesh and the pairs of face numbers that meet along an edge.
function faceStats(solid: Solid): { areas: Map<number, number>; pairs: Set<string> } {
  const p = solid.positions;
  const at = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const areas = new Map<number, number>();
  const byEdge = new Map<number, number>();
  const count = p.length / 3;
  for (let t = 0; t < solid.faceIds.length; t++) {
    const [i, j, k] = [solid.triangles[3 * t], solid.triangles[3 * t + 1], solid.triangles[3 * t + 2]];
    const face = solid.faceIds[t];
    areas.set(face, (areas.get(face) ?? 0) + len3(cross3(sub3(at(j), at(i)), sub3(at(k), at(i)))) / 2);
    byEdge.set(i * count + j, face).set(j * count + k, face).set(k * count + i, face);
  }
  const pairs = new Set<string>();
  for (const [key, face] of byEdge) {
    const [i, j] = [Math.floor(key / count), key % count];
    const other = byEdge.get(j * count + i);
    if (other === undefined || other === face) continue;
    pairs.add(face < other ? `${face},${other}` : `${other},${face}`);
  }
  return { areas, pairs };
}

// The step of a chamfer and a fillet of edges (D63), one function for both types: the edges, their
// pieces, the corner of each piece, its ends, the profile, the tools, the booleans, the checks on
// the temporary face numbers, the renumbering and the result. The rules are in
// docs/architecture/edge-blend.md; the design is docs/d36/4b-edge-chamfer-fillet/design.md, and
// for the ends that run out past a round face (D67) docs/d36/4c-blend-round-ends/design.md.
import { type EdgeData, type FaceInfo, analyzeBody, normalAt, surfaceOf, toWorld, volumeOf } from '../solid';
import { type Circle3, circleBetween } from '../surfaces';
import type { EdgeName, FaceName, Facts, Frame, Id, IssueCode, Solid, SolidKernel, Vec2, Vec3 } from '../types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, add3, cross3, dot2, dot3, edgeKey, faceKey, len3, mul3, sameEdgeName, sub3, unit3 } from '../util';
import { isImported, lookup, reach } from './services';
import type { ResolvedProfile, Step, StepContext } from './state';
import { bandOf } from './body-boolean';
import {
  BLEND_LIFT,
  BLEND_MIN_ANGLE,
  BLEND_MIN_CROSSING,
  BLEND_RUN_OUT_VOID,
  BLEND_SIDES,
  BLEND_SLIVER,
  BLEND_VOLUME,
  type BlendCorner,
  type BlendKind,
  type BlendProfile,
  type BlendSide,
  type CornerPlace,
  type EndPlane,
  type Motion,
  type RunOutFace,
  blendProfile,
  blendRevolveSetup,
  boxAlong,
  checkFrom,
  edgePrism,
  gradient,
  implicit,
  liftOf,
  moved,
  overshootPoints,
  placed,
  polygonPrism,
  prismLength,
  prismTriangles,
  reachPast,
  revolveRegion,
  rootsAlong,
  runOutRegion,
  runOutRegionSides,
  runOutUncertain,
  wayAt,
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
  runLength: number; // the length of its tool along the edge: its length and the reaches of its run-outs
}
// An end of a piece: where it meets another edge of the feature (`joint`, the edge's index), at a
// planar face it ends in flat (`face`, the face number), or a run-out past a round face (D67).
// `plane`: where the tool of a straight piece ends.
type End =
  | { kind: 'joint'; vertex: number; point: Vec3; joint: number; plane?: EndPlane }
  | { kind: 'face'; vertex: number; point: Vec3; face: number; plane?: EndPlane }
  | { kind: 'runOut'; vertex: number; point: Vec3; runOut: RunOut };
// A run-out (D67): the edge goes on past its end into what the tool does not change beyond C (a
// convex edge into C's air, a concave one into C's material), and the tool runs on until its corner
// lies beyond C by the lift. `endFace` is C, never renamed into: the cap of a run-out becomes the
// blend. Set with the profile: `reach` (the parameter of `motion` the tool runs to), `checkFrom`
// (where the void check starts, going back from the end), `sides` (of the region's polygon).
interface RunOut {
  endFace: number;
  surface: RunOutFace; // a plane's normal points beyond C
  beyondInside: boolean; // a cylinder: beyond C is its inside
  motion: Motion; // from the end, past it
  crossing: number; // the sine of the angle the edge crosses C at
  reach: number;
  checkFrom: number;
  sides: number;
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
  // at most five angle tolerances: a small radius far from the origin must not make any end smooth
  const slack = (radius: number): number => Math.min(ANGLE_TOLERANCE + (10 * precision) / radius, 5 * ANGLE_TOLERANCE);
  const band = bandOf(solid);
  const lift = liftOf(tolerance, band);

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
    // found by its key, taken only when its name is the name asked for (D62; since D68 no two names
    // share a key, and the comparison is what holds if a later role breaks the rule of the key)
    const found = data.edges.get(edgeKey(name));
    const edgeData = found && sameEdgeName(found.name, name) ? found : undefined;
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
      return { edge, vertices, points, segments: chain.segments, closed: chain.closed, sweep, length, convex: false, beta: 0, ends: [], numbers: 0, runLength: length };
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

  // The triangles at every canonical vertex, for the outward normal of an end face there.
  let trianglesAt: Map<number, number[]> | undefined;
  const outwardAt = (vertex: number, of: ReadonlySet<number>): Vec3 => {
    if (!trianglesAt) {
      trianglesAt = new Map();
      for (let t = 0; t < solid.faceIds.length; t++)
        for (let k = 0; k < 3; k++) {
          const at = canonical[solid.triangles[3 * t + k]];
          const list = trianglesAt.get(at);
          if (list) list.push(t);
          else trianglesAt.set(at, [t]);
        }
    }
    let sum: Vec3 = [0, 0, 0];
    for (const t of trianglesAt.get(vertex) ?? []) {
      if (!of.has(solid.faceIds[t])) continue;
      const [p0, p1, p2] = triangleCorner(t);
      sum = add3(sum, cross3(sub3(p1, p0), sub3(p2, p0)));
    }
    return sum;
  };

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
        if (opposite && continues(g1, g2, point)) return { kind: 'joint', vertex, point, joint: second.index, plane: across };
        if (!edge.line || !second.line) return refuse('unsupportedEdge', pair, `${CANNOT_JOIN} (an arc meets another edge at an angle, not smoothly)`);
        const sameAngle = Math.abs(edge.corner.beta - second.corner.beta) <= ANGLE_TOLERANCE;
        if (sameAngle) return { kind: 'joint', vertex, point, joint: second.index, plane: crossing({ point, normal: sub3(u, v) }, pair, `${CANNOT_JOIN} (their mitre lies within 0.01 rad of the edge)`) };
        const inward = f === a ? (piece.sides as NonNullable<Piece['sides']>).alongA : (piece.sides as NonNullable<Piece['sides']>).alongB;
        const convexCorner = dot3(v, inward) > 0;
        if (piece.convex && other.piece.convex && convexCorner) {
          const info = faceInfo(g2) as Extract<FaceInfo, { planar: true }>;
          return { kind: 'joint', vertex, point, joint: second.index, plane: crossing({ point: info.origin, normal: info.normal }, pair, `${CANNOT_JOIN} (the plane of the other face lies within 0.01 rad of the edge)`) };
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
    // a smooth end: the edge the piece runs on into has to be in the feature; one of the kind other
    // (an earlier fillet against a leaning face) cannot be, so the end is refused naming the face it
    // runs on into (D67)
    const smooth = (continuation: EdgeName, into: number[]): End => {
      const index = featureKeys.get(edgeKey(continuation));
      if (index !== undefined) return { kind: 'joint', vertex, point, joint: index, plane: across };
      const found = data.edges.get(edgeKey(continuation));
      if (found && sameEdgeName(found.name, continuation) && found.kind === 'other')
        return refuse('unsupportedEdge', [edge.name, ...into.map((face) => state.faceNames[face])], into.length === 1 ? 'the edge runs on smoothly into the face in refs along an edge of the kind other, which this feature cannot take; ending there is not supported yet' : 'the edge runs on smoothly along the edge between the two faces in refs, an edge of the kind other, which this feature cannot take; ending there is not supported yet');
      return refuse('unsupportedEdge', [edge.name, continuation], 'the edge continues smoothly into the second edge in refs; add it to this feature');
    };
    // of several faces at the end, the one next to face a, else the first
    const besideA = (): number => list.find((face) => [...(edgesAt.get(vertex) ?? [])].some((e) => e !== edge.data && ((e.a === a && e.b === face) || (e.b === a && e.a === face)))) ?? list[0];
    // planes at the end that lie in one plane (a plate and a wall added flush with its end) are one
    // end face; what a tool leaves in it is named by the one next to face a, else the first
    const flush = (): number | undefined => {
      if (list.length < 2) return undefined;
      const infos = list.map(faceInfo);
      const first = infos[0];
      if (!first.planar) return undefined;
      const normal = unit3(first.normal);
      const one = infos.every((info) => info.planar && Math.abs(Math.abs(dot3(unit3(info.normal), normal)) - 1) <= 1 - Math.cos(ANGLE_TOLERANCE) && Math.abs(dot3(sub3(info.origin, first.origin), normal)) <= LENGTH_TOLERANCE + 10 * precision);
      return one ? besideA() : undefined;
    };
    // faces on one cylinder (two extrusions flush with each other) are one end face too (D67)
    const oneCylinder = (): number | undefined => {
      if (list.length < 2) return undefined;
      const surfaces = list.map((face) => runOutFace(faceInfo(face)));
      const first = surfaces[0];
      if (first?.kind !== 'cylinder') return undefined;
      return surfaces.every((surface) => surface !== undefined && sameCylinder(first, surface, precision)) ? besideA() : undefined;
    };
    const flat = flush();
    const round = flat === undefined ? oneCylinder() : undefined;
    const single = list.length === 1 ? list[0] : (flat ?? round);
    if (single !== undefined) {
      const c = single;
      if ((list.length === 1 || round !== undefined) && continues(c, a, point)) return smooth(nameOfEdge(c, b), [c]);
      if ((list.length === 1 || round !== undefined) && continues(c, b, point)) return smooth(nameOfEdge(c, a), [c]);
      const info = faceInfo(c);
      const refs = [edge.name, state.faceNames[c]];
      if (info.planar) {
        if (edge.line) return { kind: 'face', vertex, point, face: c, plane: crossing({ point: info.origin, normal: info.normal }, [edge.name], `the edge ends at a plane (${named}) within 0.01 rad of the edge`) };
        const { center, axis } = edge.circle as Circle3;
        const across = Math.abs(dot3(unit3(info.normal), axis)) <= Math.sin(ANGLE_TOLERANCE);
        if (across && Math.abs(dot3(sub3(center, info.origin), unit3(info.normal))) <= LENGTH_TOLERANCE + 10 * precision) return { kind: 'face', vertex, point, face: c };
        // a plane parallel to the axis of the arc and off it (the side of a keyway): a run-out
        if (across) return runOutEnd(piece, end, vertex, point, c, list.length === 1 ? [c] : list);
        return refuse('unsupportedEdge', refs, `the arc ends at a plane (${named}) that does not hold its axis and is not parallel to it, which this feature cannot run out into yet`);
      }
      if (info.surface === 'cylinder') {
        if (edge.circle && !parallel(info.axis, edge.circle.axis, ANGLE_TOLERANCE)) return refuse('unsupportedEdge', refs, `the arc ends at a cylinder (${named}) whose axis is not parallel to its own, which this feature cannot run out into yet`);
        return runOutEnd(piece, end, vertex, point, c, list.length === 1 ? [c] : list);
      }
      return refuse('unsupportedEdge', refs, `the edge ends at a round face (${named}, ${describeSurface(info)}) that does not continue a face of the edge, which this feature cannot run out into yet`);
    }
    if (list.length === 2) {
      const [c1, c2] = list;
      const [ca, cb] = continues(c1, a, point) && continues(c2, b, point) ? [c1, c2] : continues(c2, a, point) && continues(c1, b, point) ? [c2, c1] : [undefined, undefined];
      if (ca !== undefined && cb !== undefined) return smooth(nameOfEdge(ca, cb), [ca, cb]);
    }
    return refuse('unsupportedEdge', [edge.name, ...list.map((face) => state.faceNames[face])], list.length === 0 ? 'an end of the edge has no face besides its own' : `an end of the edge has the faces ${named} besides its own, which are not one face it ends at nor a seam of flush faces`);
  }

  // A candidate run-out at the round face C (D67, design "Recompute", 2): where the edge's line or
  // circle meets C exactly, the angle there, and whether past it lies C's air (a convex edge) or
  // its material (a concave one); a stop is refused.
  function runOutEnd(piece: Piece, end: 0 | 1, vertex: number, point: Vec3, c: number, group: number[]): End {
    const { edge } = piece;
    const surface = runOutFace(faceInfo(c)) as RunOutFace;
    const refs = [edge.name, state.faceNames[c]];
    let motion: Motion;
    let curve: Motion;
    let at: number;
    let band = (tolerance + lift) / Math.sin(BLEND_MIN_CROSSING);
    if (edge.line) {
      const { point: linePoint, d } = edge.line;
      const onLine = (q: Vec3): Vec3 => add3(linePoint, mul3(d, dot3(sub3(q, linePoint), d)));
      const past = mul3(awayFrom(piece, end), -1);
      const here = onLine(point);
      const middle = onLine(mul3(add3(piece.points[0], piece.points[piece.points.length - 1]), 0.5));
      motion = { kind: 'translation', point: here, direction: past };
      curve = { kind: 'translation', point: middle, direction: past };
      at = dot3(sub3(here, middle), past);
    } else {
      const circle = edge.circle as Circle3;
      const sense = end === 0 ? -1 : 1;
      const e1 = radialOf(circle, piece.points[0]);
      const e2 = cross3(circle.axis, e1);
      const on = (angle: number): Vec3 => add3(circle.center, mul3(add3(mul3(e1, Math.cos(angle)), mul3(e2, Math.sin(angle))), circle.radius));
      motion = { kind: 'rotation', center: circle.center, axis: circle.axis, radius: circle.radius, point: on(end === 0 ? 0 : piece.sweep), sense };
      curve = { ...motion, point: on(piece.sweep / 2) };
      at = piece.sweep / 2;
      band /= circle.radius;
    }
    const found = crossingAt(surface, outwardAt(vertex, new Set(group)), curve, at, band);
    if ('refused' in found) return refuse('unsupportedEdge', refs, found.refused === 'grazes' ? 'the edge only grazes the end face in refs: its line or circle meets that face twice near the end' : 'the edge does not meet the end face in refs where it ends');
    if (found.crossing < Math.sin(BLEND_MIN_CROSSING)) return refuse('unsupportedEdge', refs, `the edge meets the end face in refs at ${shown((Math.asin(found.crossing) * 180) / Math.PI)}°, less than ${shown((BLEND_MIN_CROSSING * 180) / Math.PI)}°`);
    if (found.intoAir !== piece.convex)
      return refuse(
        'unsupportedEdge',
        refs,
        piece.convex
          ? `the edge runs into the material of the end face in refs, so the ${kind} would have to stop at that face, which this feature does not do yet; where that face comes from a later feature, ${kind} the edge before it`
          : `the edge runs past the end face in refs into the air beyond it, so the ${kind} would have to stop at that face, which this feature does not do yet; where that face comes from a later feature, ${kind} the edge before it`,
      );
    if (surface.kind === 'cylinder' && found.beyondInside && surface.radius - lift <= 0) return refuse('blendDoesNotFit', refs, 'the end face in refs is too small for the chord tolerance of the document; use a finer one');
    const oriented: RunOutFace = surface.kind === 'plane' && found.beyondInside ? { ...surface, normal: mul3(surface.normal, -1) } : surface;
    return { kind: 'runOut', vertex, point, runOut: { endFace: c, surface: oriented, beyondInside: found.beyondInside, motion, crossing: found.crossing, reach: 0, checkFrom: 0, sides: 0 } };
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
    // a circular piece: the angles of the rings of its tool about the axis, from the radial
    // direction of the first vertex of the piece (D67, where the void check cuts the tool)
    rings?: { from: number; step: number; sweep: number };
  }
  const builds: Build[] = [];
  let wedgeNumber = 0; // the parts inside the wedges get numbers after every tool
  const infos: (FaceInfo | undefined)[] = edges.map(() => undefined);
  for (const edge of edges) {
    const profile = blendProfile(kind, size, edge.corner, tolerance, { lift });
    edge.profile = profile;
    const places = edge.pieces.map((piece) => (edge.circle ? placeOf(edge, piece) : undefined));
    const fittedOf = places.map((place) => (place ? towardsAxis(edge, place) : profile));
    resolveRunOuts(edge, places, fittedOf);
    for (const [i, piece] of edge.pieces.entries()) {
      piece.numbers = next;
      next += NUMBERS;
      const sides = profile.keys.map((key) => sideNumber(piece, key));
      const reachOf = (k: 0 | 1): number => {
        const end = piece.ends[k];
        return end?.kind === 'runOut' ? end.runOut.reach : 0;
      };
      if (edge.line) {
        const frame = lineFrame(piece);
        const z = frame.normal;
        const [e0, e1] = piece.ends.map(endPlane);
        const low = dot3(sub3(piece.ends[0].point, frame.origin), z) <= dot3(sub3(piece.ends[1].point, frame.origin), z);
        const ends: [EndPlane, EndPlane] = low ? [e0, e1] : [e1, e0];
        const caps: [number, number] = low ? [endNumber(piece, 0), endNumber(piece, 1)] : [endNumber(piece, 1), endNumber(piece, 0)];
        if (prismLength(profile.points, frame, ends) <= LENGTH_TOLERANCE || prismLength(profile.wedge, frame, ends) <= LENGTH_TOLERANCE) refuse('blendDoesNotFit', [edge.name], `the ends of a piece of the edge meet within the ${kind}: the piece is shorter than the slant of its ends`);
        triangles += prismTriangles(profile.points.length) + prismTriangles(profile.wedge.length);
        piece.runLength = piece.length + reachOf(0) + reachOf(1);
        const wedgeNumbers = wedgeNumber;
        wedgeNumber += 3;
        let built: Solid | undefined;
        builds.push({
          piece,
          tool: () => (built ??= edgePrism(profile.points, sides, frame, ends, caps, kernel)),
          wedge: () => edgePrism(profile.wedge, profile.wedge.map(() => wedgeNumbers), frame, ends, [wedgeNumbers + 1, wedgeNumbers + 2], kernel),
        });
        if (!infos[edge.index]) infos[edge.index] = straightInfo(edge, frame, profile);
      } else {
        const circle = edge.circle as Circle3;
        const place = places[i] as CornerPlace;
        const fitted = fittedOf[i];
        const full = piece.closed;
        // a run-out turns the start of the tool back by the reach of end 0 and lengthens its turn
        // by both reaches (D67)
        const [reach0, reach1] = full ? [0, 0] : [reachOf(0), reachOf(1)];
        const sweep = piece.sweep + reach0 + reach1;
        const first = full ? wholeStart(circle.axis) : radialOf(circle, piece.points[0]);
        const start = add3(mul3(first, Math.cos(reach0)), mul3(cross3(circle.axis, first), -Math.sin(reach0)));
        const frame: Frame = { origin: circle.center, x: start, y: circle.axis, normal: cross3(start, circle.axis) };
        const extent = full ? ({ type: 'full' } as const) : ({ type: 'angle', start: 0, angle: sweep } as const);
        const toolRegion = revolveRegion(place, fitted.points, fitted.keys);
        const wedgeRegion = revolveRegion(place, fitted.wedge, fitted.wedge.map((_, i) => `w${i}`));
        const [toolSetup, wedgeSetup] = [blendRevolveSetup(toolRegion, sweep, full, tolerance), blendRevolveSetup(wedgeRegion, sweep, full, tolerance)];
        triangles += toolSetup.triangles + wedgeSetup.triangles;
        piece.runLength = circle.radius * sweep;
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
        let solidOf: Solid | undefined;
        const tool = (): ReturnType<typeof buildRevolve> => (built ??= buildRevolve(feature, toolSetup, extent, frame, sideOf(toolRegion), 0, kernel as SolidKernel));
        builds.push({
          piece,
          tool: () => (solidOf ??= numbered(tool(), toolNumber)),
          wedge: () => numbered(buildRevolve(feature, wedgeSetup, extent, frame, sideOf(wedgeRegion), 0, kernel as SolidKernel), (name) => wedgeNumbers + (name.role === 'side' ? 0 : name.role === 'startCap' ? 1 : 2)),
          info: () => (tool().faces.find((face) => face.name.role === 'side' && face.name.curve === 'blend') as { info: FaceInfo }).info,
          rings: { from: -reach0, step: sweep / toolSetup.steps, sweep },
        });
        if (piece === edge.pieces[0]) edge.profile = fitted;
      }
    }
  }
  if (triangles > MAX_REVOLVE_TRIANGLES) refuse('blendDoesNotFit', edges.map((edge) => edge.name), `the tools would have ${triangles} triangles, more than ${MAX_REVOLVE_TRIANGLES}; raise the chord tolerance of the document or split the feature`);

  // The profile of a circular edge, its overshoot shortened towards the axis so that no point of it
  // comes nearer to the axis than half the nearest point of the blend. A blend that reaches the axis
  // is refused, and so is one that comes nearer to it than two lifts: its rings there are smaller
  // than the band of the kernel, which failed on them (a fillet of 5.99 on a corner of radius 6).
  function towardsAxis(edge: Edge, place: CornerPlace): BlendProfile {
    const profile = edge.profile;
    const rho = (q: Vec2): number => placed(place, q)[0];
    const blendPoints = [...profile.points.slice(0, profile.keys.indexOf('pastB') + 1), ...profile.wedge.slice(1)];
    const nearest = Math.min(...blendPoints.map(rho));
    const clearance = 2 * lift;
    const radius = `the edge has a radius of ${shown(place.point[0])} mm`;
    if (nearest <= LENGTH_TOLERANCE) refuse('blendDoesNotFit', [edge.name], `the ${kind} reaches the axis of the circular edge (${radius}): a corner ${kind === 'fillet' ? 'rounded into a sphere' : 'chamfered into a point'} is not supported; use a smaller size, one that keeps the ${kind} more than ${shown(clearance)} mm from the axis`);
    if (nearest <= clearance) refuse('blendDoesNotFit', [edge.name], `the ${kind} comes within ${shown(nearest)} mm of the axis of the circular edge (${radius}), nearer than the ${shown(clearance)} mm its tool needs at the chord tolerance of the document; use a smaller size`);
    let overshoot = profile.overshoot;
    for (const { at, along: direction } of overshootPoints(kind, size, edge.corner.beta)) {
      const slope = direction[0] * place.alongA[0] + direction[1] * place.acrossTowardsB[0];
      if (slope < 0) overshoot = Math.min(overshoot, (rho(at) - nearest / 2) / -slope);
    }
    if (overshoot >= profile.overshoot) return profile;
    if (overshoot <= 2 * lift) refuse('blendDoesNotFit', [edge.name], `the ${kind} reaches too near the axis of the circular edge`);
    return blendProfile(kind, size, edge.corner, tolerance, { overshoot, lift });
  }

  // The frame of the tool of a straight piece: its origin the edge's line at the start of the piece,
  // X along face a, Y across towards face b, Z = X × Y.
  function lineFrame(piece: Piece): Frame {
    const sidesOf = piece.sides as NonNullable<Piece['sides']>;
    const { point: linePoint, d } = piece.edge.line as NonNullable<Edge['line']>;
    const x = sidesOf.alongA;
    const y = unit3(sub3(sidesOf.alongB, mul3(x, dot3(sidesOf.alongB, x))));
    const origin = add3(linePoint, mul3(d, dot3(sub3(piece.points[0], linePoint), d)));
    return { origin, x, y, normal: cross3(x, y) };
  }
  // Where the corner of a circular piece lies in the half plane (ρ, z) through its axis.
  function placeOf(edge: Edge, piece: Piece): CornerPlace {
    const circle = edge.circle as Circle3;
    const { alongA, alongB } = piece.half as NonNullable<Piece['half']>;
    let acrossB: Vec2 = [-alongA[1], alongA[0]];
    if (dot2(acrossB, alongB) < 0) acrossB = [-acrossB[0], -acrossB[1]];
    return { point: [circle.radius, 0], alongA, acrossTowardsB: acrossB };
  }
  // The plane the tool of a straight piece ends in: a run-out's across the edge at its reach.
  function endPlane(end: End): EndPlane {
    if (end.kind !== 'runOut') return end.plane as EndPlane;
    const motion = end.runOut.motion as Extract<Motion, { kind: 'translation' }>;
    return { point: add3(motion.point, mul3(motion.direction, end.runOut.reach)), normal: motion.direction };
  }

  // The run-outs of an edge, once its profile is known (D67, design "Recompute", 2 and 4): the limit
  // of each (the next piece of the edge on its way; else the extent of the body, or the rest of the
  // turn), its reach, two run-outs into one gap that together reach across it (a bridge), the
  // polygon of the region beyond C and where the void check starts.
  function resolveRunOuts(edge: Edge, places: (CornerPlace | undefined)[], fittedOf: BlendProfile[]): void {
    const ends = edge.pieces.flatMap((piece, i) => (piece.closed ? [] : ([0, 1] as const).map((k) => ({ piece, i, end: piece.ends[k] }))));
    if (!ends.some((x) => x.end.kind === 'runOut')) return;
    const turn = (x: number): number => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    // where an end lies on the edge: mm along its line, or its angle about the axis of its circle
    let along: (point: Vec3) => number;
    if (edge.line) {
      const { point: o, d } = edge.line;
      along = (q) => dot3(sub3(q, o), d);
    } else {
      const circle = edge.circle as Circle3;
      const e1 = radialOf(circle, edge.pieces[0].points[0]);
      const e2 = cross3(circle.axis, e1);
      along = (q) => Math.atan2(dot3(sub3(q, circle.center), e2), dot3(sub3(q, circle.center), e1));
    }
    let diagonal = 0;
    if (edge.line) {
      const low: Vec3 = [Infinity, Infinity, Infinity];
      const high: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i++) {
        low[i % 3] = Math.min(low[i % 3], p[i]);
        high[i % 3] = Math.max(high[i % 3], p[i]);
      }
      diagonal = len3(sub3(high, low));
    }
    // the points of a profile in 3D at an end of the piece
    const at = (piece: Piece, i: number, end: End): ((q: Vec2) => Vec3) => {
      if (edge.line) {
        const frame = lineFrame(piece);
        const origin = (end as Extract<End, { kind: 'runOut' }>).runOut.motion.point;
        return (q) => add3(origin, add3(mul3(frame.x, q[0]), mul3(frame.y, q[1])));
      }
      const circle = edge.circle as Circle3;
      const radial = radialOf(circle, end.point);
      return (q) => {
        const [rho, z] = placed(places[i] as CornerPlace, q);
        return add3(circle.center, add3(mul3(circle.axis, z), mul3(radial, rho)));
      };
    };
    const gaps: { mine: RunOut; theirs: RunOut; gap: number; face: number }[] = [];
    for (const { piece, i, end } of ends) {
      if (end.kind !== 'runOut') continue;
      const runOut = end.runOut;
      const refs = [edge.name, state.faceNames[runOut.endFace]];
      const { motion } = runOut;
      const here = along(end.point);
      let limit = edge.line ? diagonal : Infinity;
      let neighbour: End | undefined;
      for (const other of ends) {
        if (other.end === end) continue;
        const g = motion.kind === 'translation' ? (along(other.end.point) - here) * Math.sign(dot3(motion.direction, (edge.line as NonNullable<Edge['line']>).d)) : turn(motion.sense * (along(other.end.point) - here));
        if (g > 1e-9 && g < limit) [limit, neighbour] = [g, other.end];
      }
      if (!Number.isFinite(limit)) limit = 2 * Math.PI - piece.sweep;
      const fitted = fittedOf[i];
      const toWorld3 = at(piece, i, end);
      const reach = reachPast(fitted.wedge.map(toWorld3), motion, runOut.surface, runOut.beyondInside, lift, limit);
      if (reach === undefined) return refuse('unsupportedEdge', refs, `the ${kind} passes behind the end face in refs before it crosses it (the face notches the edge less deep than the ${kind}); ${kind} the edge before the feature that makes that face, or use a smaller size`);
      runOut.reach = reach;
      if (neighbour?.kind === 'runOut') gaps.push({ mine: runOut, theirs: neighbour.runOut, gap: limit, face: runOut.endFace });
      // the region beyond C by lift and chord tolerance, and where the void check starts
      const offset = lift + tolerance;
      if (runOut.surface.kind === 'cylinder') {
        const radius = runOut.beyondInside ? runOut.surface.radius - offset : runOut.surface.radius + offset;
        if (radius <= 0) return refuse('blendDoesNotFit', refs, 'the end face in refs is too small for the chord tolerance of the document; use a finer one');
        const sides = runOutRegionSides(radius, tolerance);
        if (sides === undefined) return refuse('blendDoesNotFit', refs, 'the end face in refs is too large for the chord tolerance of the document');
        runOut.sides = sides;
      }
      const back: Motion = motion.kind === 'translation' ? { ...motion, direction: mul3(motion.direction, -1) } : { ...motion, sense: -motion.sense as 1 | -1 };
      const margin = (size + fitted.overshoot) / (edge.line ? 1 : (edge.circle as Circle3).radius);
      const from = checkFrom(fitted.points.map(toWorld3), back, runOut.surface, runOut.beyondInside, offset, edge.line ? piece.length : piece.sweep, margin);
      if (from === undefined) return refuse('blendDoesNotFit', refs, 'the piece is shorter than its blend reaches into the end face in refs');
      runOut.checkFrom = from;
    }
    for (const { mine, theirs, gap, face } of gaps) {
      if (mine.reach + theirs.reach >= gap) refuse('unsupportedEdge', [edge.name, state.faceNames[face]], `the run-outs of two pieces of the edge into the end face in refs reach across the gap between them; ${kind} the edge before the feature that makes that face, or use a smaller size`);
    }
  }

  // ------------------------------------------------ 9a. the void check of the run-outs (D67)
  // Before the booleans, on the actual tool of each piece with a run-out: what it would take
  // (convex) or add (concave) beyond C, within the part of the piece from where its profile is
  // clear of C to past its reach. A boolean the kernel refuses here is a kernelFailure.
  for (const build of builds) {
    const { piece } = build;
    const runOuts = piece.ends.flatMap((end, k) => (end.kind === 'runOut' ? [{ k: k as 0 | 1, runOut: end.runOut }] : []));
    if (!runOuts.length) continue;
    const tool = build.tool();
    // the body first and the region second (the other order gave a folded triangle at 0.001); where
    // the kernel refuses that first boolean (far from the origin), the same set is measured the other
    // way round, the tool cut to the region first, and a refusal of that is a kernelFailure
    let chip: Solid | undefined;
    try {
      chip = piece.convex ? kernel.boolean('intersection', tool, solid) : kernel.boolean('difference', tool, solid);
    } catch {
      chip = undefined;
    }
    if (chip && chip.triangles.length === 0) continue;
    const bounds = chip ?? tool;
    const low: Vec3 = [Infinity, Infinity, Infinity];
    const high: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < bounds.positions.length; i++) {
      low[i % 3] = Math.min(low[i % 3], bounds.positions[i]);
      high[i % 3] = Math.max(high[i % 3], bounds.positions[i]);
    }
    const middle = mul3(add3(low, high), 0.5);
    const extent = len3(sub3(high, low)) + 2;
    const { edge } = piece;
    const profile = edge.profile;
    const largest = Math.max(...profile.points.map((q) => Math.hypot(q[0], q[1])));
    for (const { k, runOut } of runOuts) {
      const region = runOutRegion(runOut.surface, runOut.beyondInside, lift + tolerance, runOut.sides, middle, extent, next, kernel);
      let cutter: Solid;
      if (runOut.motion.kind === 'translation') {
        // the half space past the plane across the piece at the start of the check
        const { point, direction } = runOut.motion;
        const from = sub3(point, mul3(direction, runOut.checkFrom));
        cutter = boxAlong(direction, from, 0, Math.max(2 * extent, runOut.checkFrom + runOut.reach + extent), extent + largest, next + 2, kernel);
      } else {
        // a sector about the axis from the start of the check, moved to the middle between two rings
        // of the tool, to past the reach by at most half the gap the tool leaves of the turn
        const circle = edge.circle as Circle3;
        const { sense } = runOut.motion;
        const rings = build.rings as NonNullable<Build['rings']>;
        const theta = k === 0 ? 0 : piece.sweep;
        const raw = theta - sense * runOut.checkFrom;
        const snapped = rings.from + (Math.round((raw - rings.from) / rings.step - 0.5) + 0.5) * rings.step;
        const span = sense * (theta - snapped) + runOut.reach + Math.min(0.3, (2 * Math.PI - rings.sweep) / 2);
        const place = placeOf(edge, piece);
        const outer = Math.max(...profile.points.map((q) => placed(place, q)[0])) + 1;
        const n = Math.max(8, Math.ceil(span / 0.05));
        const sector: Vec2[] = [[0, 0], ...Array.from({ length: n + 1 }, (_, j): Vec2 => [outer * Math.cos(snapped + (sense * span * j) / n), outer * Math.sin(snapped + (sense * span * j) / n)])];
        let [h0, h1] = [Infinity, -Infinity];
        for (let i = 0; i < bounds.positions.length; i += 3) {
          const h = dot3(sub3([bounds.positions[i], bounds.positions[i + 1], bounds.positions[i + 2]], circle.center), circle.axis);
          [h0, h1] = [Math.min(h0, h), Math.max(h1, h)];
        }
        cutter = polygonPrism(sector, circle.center, circle.axis, h0 - 1, h1 + 1, next + 2, kernel, radialOf(circle, piece.points[0]));
      }
      const within = kernel.boolean('intersection', region, cutter);
      const { volume, area } = chip ? beyondVolume(chip, within, kernel) : beyondVolume(kernel.boolean('intersection', tool, within), solid, kernel, piece.convex ? 'intersection' : 'difference');
      if (volume > BLEND_RUN_OUT_VOID || (area > 0 && runOutUncertain(band, area))) {
        // over the bound the volume; under it, refused for the kernel's uncertainty alone, what it
        // may be, with what was measured and the uncertainty (the review of the implementation, N2)
        const amount = volume > BLEND_RUN_OUT_VOID ? `would ${piece.convex ? 'take' : 'add'} ${shown(volume)} mm³` : `may ${piece.convex ? 'take' : 'add'} up to ${shown(volume + band * area)} mm³ (measured ${shown(volume)} mm³, the kernel's uncertainty ${shown(band * area)} mm³ against a bound of ${shown(BLEND_RUN_OUT_VOID)} mm³)`;
        refuse(
          'blendDoesNotFit',
          [edge.name, state.faceNames[runOut.endFace]],
          piece.convex ? `the ${kind} ${amount} beyond the end face in refs within its run-out (a pin or a post in the void, or a void shallower than the ${kind})` : `the ${kind} ${amount} beyond the end face in refs, where it has no material`,
        );
      }
    }
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
        if (end.kind !== 'joint') return;
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
  // what is left of the cap of a run-out lies on the blend's surface, or it is refused: it is
  // renamed into the blend (D67; an area bound let through caps 0.141 mm off a chamfer's plane)
  const runOutCaps = new Map<number, { edge: Edge; face: number }>();
  for (const edge of edges)
    for (const piece of edge.pieces)
      piece.ends.forEach((end, k) => {
        if (end.kind === 'runOut') runOutCaps.set(endNumber(piece, k as 0 | 1), { edge, face: end.runOut.endFace });
      });
  for (let t = 0; t < result.faceIds.length; t++) {
    const cap = runOutCaps.get(result.faceIds[t]);
    if (!cap) continue;
    for (let k = 0; k < 3; k++) {
      const i = result.triangles[3 * t + k];
      const off = offSurface(infos[cap.edge.index] as FaceInfo, [result.positions[3 * i], result.positions[3 * i + 1], result.positions[3 * i + 2]]);
      if (off > allowance) refuse('blendDoesNotFit', [cap.edge.name, state.faceNames[cap.face]], `a vertex of the end of the ${kind}'s run-out lies ${shown(off)} mm off its surface`);
    }
  }
  // the volume: what was cut (added) against the union of the parts of the tools inside their wedges
  // The bound: BLEND_VOLUME × the chord tolerance (or the share of a lift held up by the band) ×
  // the strips the blends eat, the shift the kernel may leave where a cap lies flush on an end
  // face (4 bands × the area of the profile at each end, ports.md, guarantee 3), and 10⁻³ mm³.
  const strips = (list: Build[]): number => list.reduce((sum, build) => sum + 2 * build.piece.edge.profile.setback * build.piece.runLength, 0);
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

  // What the cap of a tool leaves in the plane of its end face C is C extended only where it faces
  // the way C does. A cap facing against C is new material beyond the plane of C (a chamfer that
  // reaches past a riser lower than it into the material beyond, an added fillet standing above a
  // lower end wall): above a sliver it is refused, a sliver goes to the blend.
  const outwardOf = new Map<number, Vec3>();
  const normalOf = (mesh: Solid, t: number): Vec3 => {
    const q = mesh.positions;
    const at = (i: number): Vec3 => [q[3 * i], q[3 * i + 1], q[3 * i + 2]];
    const [i, j, k] = [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
    return cross3(sub3(at(j), at(i)), sub3(at(k), at(i)));
  };
  const outward = (face: number): Vec3 => {
    let sum = outwardOf.get(face);
    if (sum) return sum;
    sum = [0, 0, 0];
    for (let t = 0; t < solid.faceIds.length; t++) if (solid.faceIds[t] === face) sum = add3(sum, normalOf(solid, t));
    outwardOf.set(face, sum);
    return sum;
  };
  const capOf = new Map<number, { edge: Edge; face: number }>();
  for (const edge of edges)
    for (const piece of edge.pieces)
      piece.ends.forEach((end, k) => {
        if (end.kind === 'face') capOf.set(endNumber(piece, k as 0 | 1), { edge, face: end.face });
      });
  const against = new Map<number, number>(); // the area of a cap facing against its end face
  const wrongWay = new Set<number>(); // the triangles of such caps
  for (let t = 0; t < result.faceIds.length; t++) {
    const cap = capOf.get(result.faceIds[t]);
    if (!cap) continue;
    const n = normalOf(result, t);
    if (dot3(n, outward(cap.face)) >= 0) continue;
    wrongWay.add(t);
    against.set(result.faceIds[t], (against.get(result.faceIds[t]) ?? 0) + len3(n) / 2);
  }
  // the bound: the step of the lift as at a joint, and the band of the kernel along the outline of
  // the profile (a cap lying in the plane of C, which the kernel may leave shifted by the band)
  const perimeter = (points: readonly Vec2[]): number => points.reduce((sum, q, i) => sum + Math.hypot(points[(i + 1) % points.length][0] - q[0], points[(i + 1) % points.length][1] - q[1]), 0);
  for (const [number, area] of against) {
    const { edge, face } = capOf.get(number) as { edge: Edge; face: number };
    if (area > lift * (size + edge.profile.overshoot) + 4 * band * perimeter(edge.profile.points)) refuse('blendDoesNotFit', [edge.name, state.faceNames[face]], `the ${kind} reaches past the end face in refs: ${shown(area)} mm² of its end faces the other way, ${edge.corner.convex ? 'into material beyond that face' : 'standing out over that face'}`);
  }

  // ------------------------------------------------ 11. the renumbering
  const final = new Map<number, number>();
  for (const edge of edges) {
    const blendFace = state.faceNames.length + edge.index;
    for (const piece of edge.pieces) {
      for (const side of BLEND_SIDES) final.set(sideNumber(piece, side), blendFace);
      ([0, 1] as const).forEach((k) => {
        const end = piece.ends[k];
        // a cap at a planar end face becomes that face; at a joint or of a run-out, the blend
        final.set(endNumber(piece, k), end?.kind === 'face' ? end.face : blendFace);
      });
    }
  }
  const blendOfCap = (number: number): number => state.faceNames.length + (capOf.get(number) as { edge: Edge }).edge.index;
  const faceIds = result.faceIds.map((face, t) => (face < firstNumber ? face : wrongWay.has(t) ? blendOfCap(face) : (final.get(face) ?? face)));
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
  // direction; a cylinder about the line of the centres of the fillet's arc, `along` that direction.
  function straightInfo(edge: Edge, frame: Frame, profile: BlendProfile): FaceInfo {
    const sidesOf = edge.pieces[0].sides as NonNullable<Piece['sides']>;
    const { point: linePoint, d } = edge.line as NonNullable<Edge['line']>;
    const direction = unit3(cross3(sidesOf.outA, sidesOf.outB));
    // `along` of a fillet (D60): the direction the projection of the edge runs in, as Y of a chamfer
    if (profile.blend.type === 'round') return { planar: false, surface: 'cylinder', center: toWorld(frame, profile.blend.center[0], profile.blend.center[1]), axis: d, radius: profile.blend.radius, along: direction };
    let low = Infinity;
    for (const piece of edge.pieces) for (const q of piece.points) low = Math.min(low, dot3(sub3(q, linePoint), direction));
    const start = add3(linePoint, mul3(direction, low));
    const ta = add3(start, mul3(sidesOf.alongA, profile.setback));
    const tb = add3(start, mul3(sidesOf.alongB, profile.setback));
    return { planar: true, origin: ta, y: direction, normal: unit3(cross3(d, sub3(tb, ta))) };
  }
}

// ---------------------------------------------------------------- run-outs (D67)

// C of a face to a run-out: a cylinder by its axis line and radius, a plane by a point and its unit
// normal; undefined for any other surface.
export function runOutFace(info: FaceInfo): RunOutFace | undefined {
  if (info.planar) return { kind: 'plane', origin: info.origin, normal: unit3(info.normal) };
  if (info.surface === 'cylinder') return { kind: 'cylinder', point: info.center, axis: unit3(info.axis), radius: info.radius };
  return undefined;
}
// Two faces on one cylinder: axes parallel within the angle tolerance, the distance of one axis line
// from the other and the difference of the radii within ten precisions of the coordinates. The
// `point` of a cylinder is any point of its axis, so it is not compared.
export function sameCylinder(a: RunOutFace, b: RunOutFace, precision: number): boolean {
  if (a.kind !== 'cylinder' || b.kind !== 'cylinder') return false;
  const offset = sub3(b.point, a.point);
  const off = len3(sub3(offset, mul3(a.axis, dot3(offset, a.axis))));
  return parallel(a.axis, b.axis, ANGLE_TOLERANCE) && off <= LENGTH_TOLERANCE + 10 * precision && Math.abs(a.radius - b.radius) <= LENGTH_TOLERANCE + 10 * precision;
}

// Where an edge meets its end face C, exactly. `crossing`: the sine of the angle between the edge's
// way and C's tangent plane at the root; `intoAir`: whether past the root lies C's air; and
// `beyondInside`: whether past the root C's implicit function is negative (a cylinder: its inside; a
// plane: the side against its normal).
export interface Crossing {
  point: Vec3;
  at: number;
  crossing: number;
  intoAir: boolean;
  beyondInside: boolean;
}
// `curve` is the motion of the piece started at its middle and run on through this end; `end` the
// parameter of the end vertex on it; `outward` C's outward normal at the end vertex, from its
// triangles there (any length). The root of the end is the one within `band` of `end`: none there
// is `missed`, two are `grazes`. The side the curve leaves at that root is the sign of C's implicit
// function between that root and the root before it (or the middle): exact, whatever else the
// curve crosses on the way (the circle of a bore's rim crosses the plane of a keyway's side twice).
export function crossingAt(face: RunOutFace, outward: Vec3, curve: Motion, end: number, band: number): Crossing | { refused: 'missed' | 'grazes' } {
  const found = rootsAlong(curve, face);
  const near = found.filter((t) => Math.abs(t - end) <= band);
  if (near.length !== 1) return { refused: near.length ? 'grazes' : 'missed' };
  const at = near[0];
  const previous = Math.max(0, ...found.filter((t) => t < at));
  const own = Math.sign(implicit(face, moved(curve, curve.point, (previous + at) / 2)));
  if (own === 0) return { refused: 'grazes' };
  const point = moved(curve, curve.point, at);
  const normal = gradient(face, point);
  const crossing = Math.abs(dot3(wayAt(curve, at), normal));
  // past the root the function has the sign −own; C's air is on the side its outward normal points to
  const airPositive = dot3(normal, outward) > 0;
  return { point, at, crossing, intoAir: -own > 0 === airPositive, beyondInside: own > 0 };
}

// The void check of a run-out: what of `chip` (the actual tool of the piece with the body: what it
// takes, convex; what it adds, concave) lies in `region` (beyond C by lift and chord tolerance,
// within the part of the piece from where the check starts to past the reach): its volume and its
// area. The body first, the region second (the other order gave a folded triangle at 0.001).
// `op`: the boolean of the two, `difference` for the other order of a concave piece (the tool cut to
// the region, less the body), used where the kernel refuses the tool with the body.
export function beyondVolume(chip: Solid, region: Solid, kernel: Pick<SolidKernel, 'boolean'>, op: 'intersection' | 'difference' = 'intersection'): { volume: number; area: number } {
  const part = kernel.boolean(op, chip, region);
  if (part.triangles.length === 0) return { volume: 0, area: 0 };
  let area = 0;
  for (const value of faceStats(part).areas.values()) area += value;
  return { volume: Math.abs(volumeOf(part)), area };
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

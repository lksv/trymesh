// Contract of package 4c (D67): chamfers and fillets of edges that end at a cylinder (and arcs that
// end at a plane off their axis), as run-outs. A draft for review, only type-checked (`npx tsc -p
// docs/d36/tsconfig.json`). It imports the real types of the engine, which include what D63 (4b)
// implemented, and states what changes. Revised after the first round of reviews (design.md,
// "Reviews"): the scope is the run-out alone.
//
// The document does not change: no feature type, no field, no face role, no issue code, no edge
// name or edge kind, no command, no query, no schema step. What changes is which ends of an edge
// `chamfer` and `fillet` accept, the texts the AI and the user read, and the parts of the
// recompute that find a run-out and lengthen the tool. A build with D63 alone that opens a document
// of this package shows the newly accepted edges as `unsupportedEdge`, in the open; nothing is
// dropped, so no upgrade step is needed.

import type { EdgeName, Vec2, Vec3 } from '../../../packages/engine/src/index';
import type { FaceInfo } from '../../../packages/engine/src/solid';
import type { BlendKind, EndPlane } from '../../../packages/engine/src/recompute/tool-edge';
import type { ChamferFeature, FilletFeature } from '../4b-edge-chamfer-fillet/contract';

// ================================================================ what the document keeps

// The two feature types of D63, unchanged: one body, a list of edges named by their two faces, one
// size. Restated so that a change to them here would not compile.
export type Unchanged = [ChamferFeature['edges'], FilletFeature['radius'], ChamferFeature['distance'], EdgeName];

// ================================================================ what the features accept

// The edges are D63's: straight between two planes; circular between faces about one axis whose
// profile in a half plane through the axis is a straight line (a plane across the axis, a cylinder,
// a cone). Where an edge ends, besides what D63 takes (another edge of the feature, a planar end
// face the tool ends in flat, a smooth continuation, a seam of flush faces), this package takes one
// end face C:
// - a straight piece: C a cylinder of any axis;
// - an arc: C a cylinder whose axis is parallel to the arc's, or a plane parallel to the arc's axis
//   that does not hold it (the side of a keyway or a slot through a bore's rim);
// - faces at the end that lie on one cylinder (the same axis line and radius: two extrusions flush
//   with each other) are one end face, named by the one next to face `a`, else the first;
// when the end is a run-out: the edge goes on, past its end, into what the tool does not change
// beyond C (a convex edge into C's air: the rim of a bore into a pin pocket, an edge into a hole
// that breaks it, a slot's edge out through a shaft's cylinder; a concave edge into C's material:
// the foot of a rib into a boss), it crosses C at BLEND_MIN_CROSSING or more, and the corner of the
// blend crosses C before the tool reaches the next piece of the same edge. The tool then runs on
// until every point of the corner lies beyond C by the lift; the air or the material beyond C does
// the rest, so the chamfer or fillet ends on C's surface, as CAD makes it.
// Refused (`unsupportedEdge`, the detail naming the faces and saying what to do):
// - a stop: the edge runs into what the tool must not change (a convex edge into C's material: the
//   top edge of a rib into a taller boss, the rim of a lobe under another lobe; a concave edge into
//   C's air: the foot of a rib flush with the rim of a round plate) — deferred;
// - a bridge: the corner passes behind C before crossing it (a hole that notches the edge less deep
//   than the chamfer) — deferred; the detail says to chamfer or fillet the edge before the feature
//   that makes C, or to use a smaller size;
// - an edge that crosses C at less than BLEND_MIN_CROSSING;
// - C a cone, a sphere, a torus (an end at an earlier chamfer or fillet of a circular edge),
//   a swept or an imported face; an arc's C a cylinder or a plane not parallel to its axis;
//   faces at the end on two surfaces — deferred.
// Refused (`blendDoesNotFit`, refs the edge and C): the cap of a run-out left in the result (C
// bounds a void too shallow or too narrow for the blend: a pocket shallower than the chamfer).
export type AcceptedEdge = EdgeName;

// The least angle between an edge (its tangent, for an arc) and the tangent plane of C where the
// edge's line or circle meets C exactly, in radians. Measured (design.md, "Measured", R2): from 5°
// up every run-out was right; at 3° the side of C the edge runs into was misread; 10° keeps twice
// that margin. Below it: `unsupportedEdge` ("the edge meets the end face in refs at too flat an
// angle").
export const BLEND_MIN_CROSSING = (10 * Math.PI) / 180;

// `MESSAGE.unsupportedEdge` (recompute/services.ts), which the AI and the user read before the
// detail. `blendDoesNotFit` keeps its text of D63.
export const MESSAGE_UNSUPPORTED_EDGE =
  'The edge cannot be chamfered or filleted: only a straight edge between two planes and a circular edge between a plane, a cylinder or a cone about one axis can, ending at a plane, running out into a hole, a pocket or a boss it crosses, meeting another edge of the same feature at a vertex, or running on smoothly into an edge of the same feature.';

// The part of the summary both feature types share (`SHARED_SUMMARY` of D63), as `describe_api`
// prints it.
export const SHARED_SUMMARY_4C =
  'The edges are named by their two faces, as the query `body` lists them: a straight edge between two planes, or a circular edge between a plane, a cylinder and a cone about one axis. A convex edge is cut, a concave one gets material added. ' +
  'An edge may end at a plane, at another edge of the feature, or run out into a cylinder it crosses at 10° or more (the rim of a bore into a pin pocket, an edge into a hole, the foot of a rib into a boss): the chamfer or fillet then ends on that cylinder. An edge that would have to stop at a round face (a convex edge into a wall, a concave edge past a rim) is refused. An edge that runs on smoothly into another needs that edge in the same feature; a convex and a concave edge that meet at a vertex go into two features. ' +
  'Each edge gets one new face `{ feature, role, edge: <its place in edges, from 0> }`; the faces of the edge keep their names. The facts `setback/<i>` and `cut/<i>`.';

// ================================================================ the recompute

// An end of a piece (`End` of recompute/edge-blend.ts, which has `face`, `joint` and `plane`
// today) gets one more kind: a run-out, with C's face number and the reach (mm along a straight
// piece, radians about the axis of an arc). The tool's end is then the plane across the edge at the
// reach (the half plane through the axis for an arc).
export type BlendEnd =
  | { kind: 'joint'; vertex: number; point: Vec3; joint: number; plane?: EndPlane }
  | { kind: 'face'; vertex: number; point: Vec3; face: number; plane?: EndPlane }
  | { kind: 'runOut'; vertex: number; point: Vec3; face: number; reach: number };

// What C is to a run-out: a cylinder by its axis line and radius, or a plane.
export type RunOutFace = { kind: 'cylinder'; point: Vec3; axis: Vec3; radius: number } | { kind: 'plane'; origin: Vec3; normal: Vec3 };
// C of a face, or undefined when the face is not a cylinder or a plane.
export declare function runOutFace(info: FaceInfo): RunOutFace | undefined;
// Faces at an end on one cylinder: axes parallel within the angle tolerance, the distance of one
// axis line from the other and the difference of the radii within ten precisions of the
// coordinates; `center` of a cylinder is any point of its axis (tool-prism.ts puts it in the plane
// of the sketch), so it is not compared. Planes as D63's `flush`.
export declare function sameCylinder(a: RunOutFace, b: RunOutFace, precision: number): boolean;

// Where the edge meets C exactly, nearest the end vertex of the mesh: the straight piece's line
// with the cylinder (a quadratic) or the plane; the arc's circle with the cylinder parallel to its
// axis (two circles in the plane across the axis) or the plane parallel to it. At the mesh vertex
// the direction of a cylinder's normal is off by up to half a step of its polygon (measured: 12°
// read as 9° at the chord tolerance 0.05), so the angle and the side are read at this point.
// - `crossing`: the sine of the angle between the edge's way past its end and C's tangent plane;
// - `intoAir`: whether that way goes into C's air, by the sign of dot(way past the end, C's outward
//   normal), the normal's sign from C's triangles at the end vertex (area-weighted, as D63 signs
//   the faces of an edge);
// undefined when the line or the circle does not meet C (an edge that only touches it).
// A run-out is `intoAir === convex`, else it is a stop (refused).
export interface Crossing {
  point: Vec3;
  crossing: number;
  intoAir: boolean;
}
export declare function crossingAt(face: RunOutFace, outward: Vec3, piece: { line: { point: Vec3; direction: Vec3 } } | { circle: { center: Vec3; axis: Vec3; radius: number } }, vertex: Vec3): Crossing | undefined;

// The reach of a run-out, exactly: for every point of the profile's `wedge` (the corner and the
// exact blend, which D63's corner of two straight face lines closes exactly), the set of parameters
// t ≥ 0 at which the point, carried past the end, lies beyond C by at least the lift — an interval
// or two of the roots of a quadratic for a straight piece and a cylinder (radius r − lift where the
// beyond is inside it, r + lift outside), a half line for a plane, the arcs of one circle inside or
// outside another for an arc and a cylinder parallel to its axis, an arc of a circle on one side of
// a line for an arc and a plane; the reach is the least t in all the sets at once, up to `limit`
// (the next piece of the same edge on that way; for an arc also the rest of the turn). Where the
// beyond is the outside of a cylinder (a region that is not convex), every side of the wedge
// polygon at the reach is also checked against the axis (its distance at least r): points alone do
// not clear a side that dips into the cylinder. Undefined: no such t (a bridge, refused).
export declare function reachPast(wedge: readonly Vec2[], carry: (point: Vec2, t: number) => Vec3, face: RunOutFace, beyondInside: boolean, lift: number, limit: number): number | undefined;

// The new parts of the step (design.md, "Recompute"), in D63's order: the faces at an end (one end
// face C, faces on one cylinder merged); for a cylinder or (an arc) a plane it cannot end in flat:
// `crossingAt`, the least angle, run-out or stop, `reachPast`; the tool lengthened by the reach;
// after the booleans the cap of a run-out checked as a cap at a joint of D63 (left above lift ×
// (size + overshoot) mm²: `blendDoesNotFit`, a sliver goes to the blend); the part inside the wedge
// for the volume check lengthened alike.
export type StepUnchanged = (kind: BlendKind, feature: string, body: string, edges: EdgeName[], size: number) => void;

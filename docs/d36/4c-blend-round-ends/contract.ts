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
import type { Solid, SolidKernel } from '../../../packages/engine/src/index';
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
// that breaks it, a slot's edge out through a shaft's cylinder into the air outside it, the rim of
// a hole that breaks out through a disc's side; a concave edge into C's material: the foot of a rib
// into a boss), it crosses C at BLEND_MIN_CROSSING or more, and the corner of the blend crosses C
// before the tool reaches the next piece of the same edge. The tool then runs on until every point
// of the corner lies beyond C by the lift; the air or the material beyond C does the rest, so the
// chamfer or fillet ends on C's surface, as CAD makes it.
// Refused (`unsupportedEdge`, the detail naming the faces and saying what to do):
// - a stop: the edge runs into what the tool must not change (a convex edge into C's material: the
//   top edge of a rib into a taller boss; a concave edge into C's air: the foot of a rib flush with
//   the rim of a round plate) — deferred; the detail says to blend before the feature that makes C
//   where that is a later feature;
// - a bridge: the corner passes behind C before crossing it (a hole that notches the edge less deep
//   than the chamfer), or the run-outs of two pieces into one gap reach across it — deferred; the
//   detail says to chamfer or fillet the edge before the feature that makes C, or to use a smaller
//   size;
// - an edge that crosses C at less than BLEND_MIN_CROSSING, or only grazes it;
// - C a cone, a sphere, a torus, a swept or an imported face; an arc's C a cylinder or a plane not
//   parallel to its axis; faces at the end on two surfaces (the rim of a lobe under another lobe,
//   which meets the upper lobe's side and its underside) — deferred, D63's detail;
// - an end where the edge runs on smoothly into a face (an earlier fillet tangent to a face of the
//   edge) along an edge this feature cannot take (of the kind `other`): D63 advised adding that edge
//   to the feature, which cannot be done; the detail names the face and says the end is not taken
//   yet.
// Refused (`blendDoesNotFit`, refs the edge and C):
// - the void check: the part of the tool past the end would take material beyond C (a pin or a post
//   standing in the pocket, a pocket shallower than the chamfer) or, concave, add material beyond C
//   where it has none;
// - C a cylinder whose inside is beyond and whose radius is within the lift of the chord tolerance;
// - a cap of a run-out left in the result off the blend's surface (a backstop: measured never).
export type AcceptedEdge = EdgeName;

// The least angle between an edge (its tangent, for an arc) and the tangent plane of C where the
// edge's line or circle meets C exactly, in radians. Measured (design.md, "Measured", R2 and R5):
// with the side read as below, every case from 3° up was either right (equal to the reference) or a
// bridge; read at the mesh vertex instead, a crossing of 12° looked like 8° at the chord tolerance
// 0.05. 10° keeps the band of the root at the end (below) narrow and the parts of a tool past its
// end short. Below it: `unsupportedEdge`, detail "the edge meets the end face in refs at 8°, less
// than 10°".
export const BLEND_MIN_CROSSING = (10 * Math.PI) / 180;

// The bound of the void check (mm³, see `beyondVolume`), one constant shared with the spike: what
// the actual tool may take beyond C (convex) or add there (concave). Calibrated (design.md,
// "Measured"): every accepted case of the spike gave an empty result, exactly 0; the smallest volume
// a regression had to be refused at was 1.9 × 10⁻⁴ mm³ (a pin at the far end of a fillet's run-out),
// 19 times the bound. No area term: round 3 found 4 · band · the profile's area (the round-2 draft)
// accepting a 0.3-deep pocket (8.8 × 10⁻⁴ mm³ under a bound of 3.6 × 10⁻³). A non-empty result
// under the bound is accepted only where the kernel's uncertainty for it, its band times the
// result's area (`runOutUncertain`), is under the bound too; otherwise the run-out is refused.
export const BLEND_RUN_OUT_VOID = 1e-5;
export const runOutUncertain = (band: number, resultArea: number): boolean => band * resultArea > BLEND_RUN_OUT_VOID;

// The polygon of the region beyond a cylinder (see `beyondVolume`): its sides chosen so that its
// sagitta is at most a quarter of the chord tolerance (`segments(2π, radius, tol / 4)` of
// sketch.ts); where the engine's cap of 4 096 sides leaves it larger (a radius absurd for the
// chord tolerance: 100 m at 0.001), the run-out is refused (`blendDoesNotFit`, "the end face in refs
// is too large for the chord tolerance of the document"). Round 3 found a fixed 256-gon blind to
// a strip radius · π² / (2 · 256²) wide (0.04 mm at a radius of 500, 0.75 mm at 10 m).
export const RUN_OUT_REGION_SAGITTA = 0.25; // of the chord tolerance
export declare function runOutRegionSides(radius: number, chordTolerance: number): number | undefined;

// `MESSAGE.unsupportedEdge` (recompute/services.ts), which the AI and the user read before the
// detail. `blendDoesNotFit` keeps its text of D63.
export const MESSAGE_UNSUPPORTED_EDGE =
  'The edge cannot be chamfered or filleted: only a straight edge between two planes and a circular edge between a plane, a cylinder or a cone about one axis can, ending at a plane, running out into a hole, a pocket or a boss it crosses (a cylinder; for a circular edge also a plane parallel to its axis, such as the side of a keyway), running out through a round wall into the air outside it, meeting another edge of the same feature at a vertex, or running on smoothly into an edge of the same feature. An edge that would have to stop at a round face or bridge a gap is not taken yet.';

// The part of the summary both feature types share (`SHARED_SUMMARY` of D63), as `describe_api`
// prints it.
export const SHARED_SUMMARY_4C =
  'The edges are named by their two faces, as the query `body` lists them: a straight edge between two planes, or a circular edge between a plane, a cylinder and a cone about one axis. A convex edge is cut, a concave one gets material added. ' +
  'An edge may end at a plane, at another edge of the feature, or run out past a round face it crosses at 10° or more: into a hole, a pocket or a boss (the rim of a bore into a pin pocket, an edge into a hole, the foot of a rib into a boss), out through a round wall into the air outside it (a slot through a shaft), and a circular edge also past a plane parallel to its axis (the rim of a bore into a keyway); the chamfer or fillet then ends on that face. ' +
  'Refused, with a detail that says what to do: an edge that would have to stop at a round face (a convex edge into a wall, a concave edge past a rim), a chamfer or fillet whose corner passes behind the round face before crossing it (a hole that notches the edge less deep than the size: blend before the feature that makes the hole, or use a smaller size), and a run-out that would cut or add material beyond that face (a pin in the pocket, a pocket shallower than the size). An edge that runs on smoothly into another needs that edge in the same feature; a convex and a concave edge that meet at a vertex go into two features. ' +
  'Each edge gets one new face `{ feature, role, edge: <its place in edges, from 0> }`; the faces of the edge keep their names. The facts `setback/<i>` and `cut/<i>`.';

// ================================================================ the recompute

// How a piece goes on past an end, exactly: the motion of a point of its profile there, with the
// curve of the edge itself.
// - a straight piece: a translation; `point` the end vertex (the curve's point at t = 0), unit
//   `direction` the way past the end; t in mm;
// - an arc: a rotation about the line (`center`, unit `axis`) by `sense` · t radians (sense +1 past
//   the end at the larger angle of the piece about `axis`, −1 at the smaller); `point` the curve's
//   point at t = 0 and `radius` its distance from the axis (the circle of the edge, so concentric
//   circles of different radii differ). A point of the profile at (ρ, h) of the half plane turns
//   on the circle of radius ρ at the height h.
// Started at the middle of the piece, the same motion is the curve `crossingAt` solves on; the
// tool is built along it. A length in mm along an arc's curve is `radius` · t: the band of the root
// of the end is (tolerance + lift) / sin BLEND_MIN_CROSSING / radius radians.
export type Motion =
  | { kind: 'translation'; point: Vec3; direction: Vec3 }
  | { kind: 'rotation'; center: Vec3; axis: Vec3; radius: number; point: Vec3; sense: 1 | -1 };

// An end of a piece (`End` of recompute/edge-blend.ts, a joint, a face or a seam today, told apart
// by which fields are set) becomes a union keyed by `kind`. A run-out keeps C apart from `face`:
// `face` is what D63's cap check against the end face and the renumbering read (the cap of a
// planar end facing against C is checked, then renamed into C or into the blend); a run-out's cap
// is never renamed into C, and the planar check does not apply to it.
export type BlendEnd =
  | { kind: 'joint'; vertex: number; point: Vec3; joint: number; plane?: EndPlane }
  | { kind: 'face'; vertex: number; point: Vec3; face: number; plane?: EndPlane }
  | { kind: 'runOut'; vertex: number; point: Vec3; runOut: { endFace: number; surface: RunOutFace; motion: Motion; reach: number; crossing: number; checkFrom: number } };

// What C is to a run-out: a cylinder by its axis line and radius, or a plane.
export type RunOutFace = { kind: 'cylinder'; point: Vec3; axis: Vec3; radius: number } | { kind: 'plane'; origin: Vec3; normal: Vec3 };
// C of a face, or undefined when the face is not a cylinder or a plane.
export declare function runOutFace(info: FaceInfo): RunOutFace | undefined;
// Faces at an end on one cylinder: axes parallel within the angle tolerance, the distance of one
// axis line from the other and the difference of the radii within ten precisions of the
// coordinates; `center` of a cylinder is any point of its axis (tool-prism.ts puts it in the plane
// of the sketch), so it is not compared. Planes as D63's `flush`. (Measured: two flush extrusions
// of the same circles leave one face at every end vertex, so this rule is rarely reached; it costs
// nothing and keeps a seam through an end vertex from refusing a run-out.)
export declare function sameCylinder(a: RunOutFace, b: RunOutFace, precision: number): boolean;

// Where the edge meets C, exactly, and which way it goes there. `curve` is the motion of the piece
// started at its middle (a point away from both ends) and run on through this end; `end` is the
// parameter of the end vertex of the mesh on it. The roots of the curve with C's surface (a line
// and a cylinder: a quadratic; a line and a plane; a circle and a parallel cylinder: two circles; a
// circle and a parallel plane: a circle and a line) are taken for t > 0:
// - the root of the end is the one within `band` of `end` (the mesh vertex lies within the chord
//   tolerance of C, which along a curve crossing at BLEND_MIN_CROSSING is (tolerance + lift) /
//   sin BLEND_MIN_CROSSING mm, divided by the curve's radius for an arc); none there: `{ refused: 'missed' }`, two there (the curve only grazes
//   C): `{ refused: 'grazes' }`, both `unsupportedEdge` like a flat crossing;
// - the side the curve leaves at that root is the sign of C's implicit function (outside a cylinder
//   positive, on the side of a plane's normal positive) at the middle between that root and the
//   root before it, or the start of the curve: exact, whatever else the curve crosses on the way
//   (the circle of a bore's rim crosses the plane of a keyway's side twice; the first round read
//   the side at the mesh vertex, the first draft of the second at the middle of the piece, and both
//   were wrong somewhere);
// - `crossing`: the sine of the angle between the curve's way there and C's tangent plane;
// - `intoAir`: whether the side past the root is C's air, by C's outward normal there signed by C's
//   triangles at the end vertex (area-weighted, as D63 signs the faces of an edge).
// A run-out is `intoAir === convex`, else it is a stop (refused).
export interface Crossing {
  point: Vec3;
  at: number;
  crossing: number;
  intoAir: boolean;
  beyondInside: boolean; // for a cylinder: the side past the root is its inside
}
export declare function crossingAt(face: RunOutFace, outward: Vec3, curve: Motion, end: number, band: number): Crossing | { refused: 'missed' | 'grazes' };

// The reach of a run-out, exactly: the least t in [0, limit] at which every point of the profile's
// `wedge` (the corner and the exact blend, closed by D63's two straight face lines), carried by
// `motion` from the end, lies beyond C by the lift — for each point a set of intervals (a line and
// a cylinder: the roots of a quadratic at the radius r − lift where beyond is inside it, r + lift
// outside; a circle and a parallel cylinder: arcs of one circle inside or outside another; a circle
// and a parallel plane: an arc on one side of a line moved by the lift), intersected. Where beyond
// is the outside of a cylinder (not a convex region) the whole wedge polygon has to clear the
// cylinder of radius r + lift, not only its points: in the plane across C's axis the moving polygon
// against the disc, exact — the parameters where a vertex is at distance r + lift from the axis, or
// a side's line at r + lift or 0 (a quadratic or a line for a translation; two circles or a circle
// and a line for a rotation about a parallel axis), the pieces between them tested at their middle
// (a side within r + lift, or the axis inside the polygon: blocked). `limit`: the next piece of the
// same edge on that way; else the body's extent (a straight piece) or the rest of the turn (an
// arc). Undefined: no such t (a bridge, refused). The caller refuses r − lift ≤ 0 where beyond is
// inside (`blendDoesNotFit`, the face too small for the chord tolerance) and two run-outs into one
// gap whose reaches together reach across it (a bridge).
export declare function reachPast(wedge: readonly Vec3[], motion: Motion, face: RunOutFace, beyondInside: boolean, lift: number, limit: number): number | undefined;

// Where the void check starts on the piece (`checkFrom`, the same parameter as the reach, going
// back from the end vertex): the first parameter at which the whole profile (every point; the
// polygon too where the own side of the region is not convex, outside a cylinder) lies on the own
// side of the region beyond C, solved exactly as the reach with the motion reversed, then moved
// back by size + overshoot within the stretch where the profile stays clear (its first cap away
// from C's polygon). None within the piece: `blendDoesNotFit` ("the piece is shorter than its
// blend reaches into the end face in refs"). Round 3 found the round-2 start, (size + overshoot) ·
// (1 / tan(crossing) + 1) + lift, short of an acute fillet's setback (r / tan(β / 2): 11.4 for r 1
// at 10°): material where the profile reached C earlier was not checked.
export declare function checkFrom(profile: readonly Vec3[], back: Motion, face: RunOutFace, beyondInside: boolean, offset: number, pieceSpan: number): number | undefined;

// The void check of a run-out, before the booleans, on the actual tool of the piece (the mesh the
// boolean uses, lengthened by its reaches; round 3 found a separately built extension, divided
// otherwise, 3.3 × 10⁻⁴ mm³ outside the real tool):
// - convex: the tool intersected with the body (what it takes); concave: the tool less the body
//   (what it adds); once per piece;
// - that intersected with the region beyond C by `offset` = lift + chord tolerance within the part
//   of the piece from `checkFrom` to past the reach: inside a cylinder a prism of the inscribed
//   polygon of `runOutRegionSides` sides and radius r − offset; outside it a box less the prism of
//   the circumscribed polygon of radius r + offset; past a plane a box beyond it by the offset; the
//   part of the piece a box beyond the plane across a straight piece at `checkFrom`, or for an arc a
//   sector about its axis from `checkFrom` (moved to the middle between two rings of the tool) to
//   the reach plus at most half the gap the tool leaves of the turn;
// - its volume above BLEND_RUN_OUT_VOID, or a non-empty result `runOutUncertain`:
//   `blendDoesNotFit`, refs [the edge, C], detail "the chamfer would take 0.054 mm³ beyond the end
//   face in refs within its run-out (a pin or a post in the void, or a void shallower than the
//   chamfer)"; concave "the fillet would add … beyond the end face in refs, where it has no
//   material".
// What lies within offset + the polygon's sagitta of C (lift + 1.25 · tol) is not checked. The
// whole tool against the unbounded region (round 3's first proposal) refuses right cases: beyond the
// plane of a keyway's side lies the rest of the rim, whose own chip it counted (4.0 mm³, R5), so the
// part checked starts at `checkFrom`. Measured choices kept from round 2: the region past C's mesh
// by the chord tolerance as well as the lift (C's mesh lies within the chord tolerance of C), the
// body first and the region second (the other order gave a folded triangle at 0.001). A boolean of
// the check the kernel refuses refuses the feature (`kernelFailure`), never accepts it unchecked.
// Kernel calls: one per piece, two or three per run-out.
export declare function beyondVolume(tool: Solid, body: Solid, convex: boolean, region: Solid, kernel: Pick<SolidKernel, 'boolean'>): { volume: number; area: number };

// The new parts of the step (design.md, "Recompute"), in D63's order: the faces at an end (one end
// face C, faces on one cylinder merged); for a cylinder or (an arc) a plane it cannot end in flat:
// `crossingAt`, the least angle, run-out or stop, `reachPast`, `checkFrom`; the tool lengthened by
// the reach; the void check on it; after the booleans the cap of a run-out: every vertex of it left in the result within
// D63's allowance of the blend's surface (lift + chord tolerance + 10 precisions; it is then renamed
// into the blend), else `blendDoesNotFit`; the part inside the wedge for the volume check lengthened
// alike.
export type StepUnchanged = (kind: BlendKind, feature: string, body: string, edges: EdgeName[], size: number) => void;

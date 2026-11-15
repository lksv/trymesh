// Contract of package 1a of D36 (decision D38): the section of bodies by a plane, as a query for
// the AI and as the section view of the app. A draft, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). The design is design.md.
//
// Fourth version, after the third and last round of reviews (design.md, "Reviews").

import type { Frame, Id, Solid, Vec2, Vec3 } from '../../../packages/engine/src/index';
import type { ArgSpecs, FaceNameAfter, Truncated } from '../00-prep/contract';
import type { ResultUnits } from '../1b-measure/contract';

// ---------------------------------------------------------------- the arguments

// - `plane`: a base plane, a plane feature or a planar face (`PlaneRef`, as features use it).
//   A face that is not planar is answered as `failed` with the path `['plane']`.
// - `offset`: the plane is moved by this along its normal. For a face the normal points out of
//   the body, so a negative offset cuts into it.
// - `flip`: the section is seen from the other side: the normal and the x axis of the frame are
//   reversed (after the offset). It decides which side the app cuts away. The section is taken
//   just below the plane (see `cut`), and "below" turns with the normal: a body that ends in the
//   plane shows its face as its section one way and is absent the other way. For a body the
//   plane goes through, the loops are those of a plane twice `below` away from the first, seen
//   from the other side. How much they differ depends on the body: `below` times the slope of
//   a wall, and near a wall that runs almost along the plane, or a feature that ends within
//   that distance, even the number of loops can change.
// - `bodies`: only these; without it all bodies of the state.
// - `outline`: how a loop is written. `spans` (the default) is for reading: lines and arcs
//   rebuilt from the surfaces, and what has no such form as a curve. `polylines` is for drawing:
//   every loop as the polygon the mesh gives.
// - `maxPoints`: the budget of the answer, counted in items: a span is one, a point of a curve
//   or of a polyline is one, a loop written as a polyline is one. What does not fit is left out
//   whole and counted (see `SectionResult`).
export const SECTION_ARGS = {
  plane: { kind: 'plane', title: 'Cutting plane', summary: 'A base plane, a plane feature or a planar face.' },
  offset: { kind: 'number', title: 'Offset', summary: 'Moves the plane along its normal.', optional: true, spec: { title: 'Offset along the normal', unit: 'mm', default: 0 } },
  flip: { kind: 'flag', title: 'From the other side', optional: true },
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'Without it all bodies.', optional: true },
  outline: { kind: 'choice', options: ['spans', 'polylines'], title: 'Form of a loop', summary: 'spans: lines, arcs and curves with the face each lies on (the default). polylines: the points of every loop, for drawing.', optional: true },
  maxPoints: { kind: 'number', title: 'Budget', summary: 'The budget of the answer: spans, loops of polylines and points together.', optional: true, spec: { title: 'Most spans, loops and points to return', unit: 'count', integer: true, min: { value: 0 }, default: 500 } },
} as const satisfies ArgSpecs;

// ---------------------------------------------------------------- the result

// A piece of a loop that lies on one face of the body, from `from` to `to` in the coordinates of
// the cutting plane. What it is follows from the surface of the face and from how the plane
// meets it, not from a fit:
//
// surface   | the plane meets it                | span
// plane     | any way                           | line
// cylinder  | across the axis                   | arc
// cylinder  | along the axis                    | line
// cone      | across the axis                   | arc
// swept     | along the direction of the sweep  | line
// anything  | otherwise                         | curve
//
// "Across" and "along" are within `ANGLE_TOLERANCE`.
// - `from` and `to` are corners of the polygon the mesh gives, so the spans of a loop join
//   exactly: each starts where the one before it ends.
// - `arc`: `center` and `radius` are those of the exact surface. The two ends are points of the
//   mesh: on the circle, within the precision of the coordinates, where the arc ends in a vertex
//   of its polygon; inside it by up to the sagitta of a side of the polygon where another face
//   cuts the round face between two vertices. That sagitta is within the chord tolerance of the
//   document except above the caps on the number of segments (design.md of 1b). `sweep` is the
//   angle from `from` to `to` about `center` along the loop, positive counter-clockwise; a whole
//   circle has `from` equal to `to` and a sweep of 2π or −2π.
// - `curve`: `count` points from `from` to `to`, both included. A curve that is a whole loop
//   has `from` equal to `to`; its points are the corners of the loop once, the first not
//   repeated (as in a polyline), and `count` is their number. `length` is the length of that
//   piece of the polygon the mesh gives, as the length of a loop is (see `cut`); for a whole
//   loop it is the length of the loop. `points` are there only while they fit the budget.
export type SectionSpan = { face: FaceNameAfter; from: Vec2; to: Vec2 } & ({ kind: 'line' } | { kind: 'arc'; center: Vec2; radius: number; sweep: number } | { kind: 'curve'; count: number; length: number; points?: Vec2[] });

// A closed loop. `area` and `length` are of the polygon the mesh gives (taken before the points
// that are not corners are dropped; those of the listed points may differ from them in the last
// digits), so a circle of radius r has a little less than πr² (the polygon is inscribed).
// - With `spans`: the spans in order.
// - With `polylines`: the corners of the polygon in order, the first not repeated; left out when
//   they do not fit the budget.
// Where a loop starts is fixed by the shape, not by the mesh (see `cut`).
export interface SectionLoop {
  area: number; // mm2, positive
  length: number; // mm
  spans?: SectionSpan[];
  points?: Vec2[];
}

// A piece of material in the section: an outer loop and the holes in it. The outer loop runs
// counter-clockwise in the x and y of the frame and a hole clockwise, so the material is on the
// left of every loop.
export interface SectionRegion {
  area: number; // mm2: the outer loop less the holes
  outer: SectionLoop;
  holes: SectionLoop[];
}
// - `loops`: how many closed loops the plane cuts out of the body. A loop left with fewer than
//   three corners (see `cut`) is not a loop: it counts neither here nor in `area`, and a body
//   left without loops is not listed.
// - `regions`: left out when the outline of the body does not fit the budget (its spans, or with
//   `polylines` its loops); the body then has its area and the number of its loops only.
export interface SectionOfBody {
  body: Id;
  area: number; // mm2, all regions
  loops: number;
  regions?: SectionRegion[];
}

// - `frame`: the cutting plane as it was asked for: after the offset and the flip. The points of
//   the loops are in its x and y; `origin + x·u + y·v` is the point in the model.
// - `below`: how far under that plane, against its normal, the section was really taken: the
//   precision of the coordinates over all bodies asked about (see `cut`). The loops are those
//   of the plane through `origin − below·normal`, laid into the frame. A body far from the
//   origin in the same call therefore moves the cut of every body by that much. Who draws the
//   cut clips at that plane, not at the one asked for (`takenAt` in calls.ts), so that the
//   clipped mesh and the loops are of one plane.
// - `bodies`: the bodies the plane cuts, in the order of the model. A body the plane misses is
//   not listed.
// - `inPlane`: bodies with a planar face that lies in the cutting plane (parallel within
//   `ANGLE_TOLERANCE`, at its height within the precision of the coordinates), with the first
//   such face of each: at most one entry per body. Such a body shows that face as its section
//   when it lies below the plane and nothing when it lies above; with an entry here the offset
//   is better moved a little.
// - `truncated`: `total` items there were to list and `shown` of them listed, in the units of
//   `maxPoints`. The budget is spent in two rounds, each over the bodies in their order: first
//   the outlines (the spans of a body, or with `polylines` its loops), then the lists of points
//   (a curve, or a loop of a polyline). A list that does not fit is left out whole and a later,
//   smaller one may still fit. So the points of an early body never cost a later one its
//   outline.
// The size of the answer is therefore bounded by `maxPoints` and by the number of bodies asked
// about (a body has three numbers and at most one face in `inPlane`).
export interface SectionResult extends Truncated {
  frame: Frame;
  below: number; // mm
  bodies: SectionOfBody[];
  inPlane: { body: Id; face: FaceNameAfter }[];
}

declare module '../00-prep/contract' {
  interface Queries {
    section: { spec: typeof SECTION_ARGS; result: SectionResult };
  }
}
export const SECTION_UNITS = { area: 'mm2', length: 'mm', radius: 'mm', sweep: 'rad', below: 'mm' } as const satisfies ResultUnits;

// ---------------------------------------------------------------- the pass over triangles

// The loops a plane cuts out of one closed mesh, as the mesh gives them: points in the x and y
// of the frame, and for every segment the number of the face its triangle belongs to.
// - The cut is taken `below` under the plane: the heights of the vertices are measured from the
//   plane moved by `below` against its normal, and a vertex at height zero or more counts as
//   above. `below` is the precision of the coordinates (`coordinatePrecision` of 1b over the
//   bodies asked about). Comparing a height in float32 with the plane itself would split the
//   vertices of a face that lies in the plane at random, as soon as the body is not aligned
//   with the axes of the model.
// - Every vertex is above or below, never neither. Every crossed triangle then gives exactly one
//   segment, between the two of its edges that cross, and the point on an edge is computed from
//   its two vertices in a fixed order, so both triangles of the edge get the same numbers. The
//   segments are chained by the edges they end on, not by comparing coordinates.
// - The mesh of a body is a closed surface (every edge in exactly two triangles, once each way:
//   guarantee 1 of the kernel port and the check of its adapter), so every chain closes.
// - After the chains are closed, the points that are not corners are dropped, so that the
//   points of a loop do not depend on how a face is divided into triangles. `precision` is the
//   precision of the coordinates of this body (`coordinatePrecision` of 1b over the body
//   alone, so that the corners of a body do not depend on which other bodies were asked about);
//   it is not a fixed length, because on a body that is not aligned with the axes the point on
//   the diagonal of a side quad is off the line by the noise of float32. The rule, in this
//   order:
//   1. A segment shorter than `precision` goes: walking the chain, a point nearer than that to
//      the last point kept is dropped, and the segment after it starts at the point kept.
//   2. The points where the face changes are kept. A loop on one face keeps the point furthest
//      from the mean of its points (a corner of its hull, wherever the mesh starts the chain);
//      of several that far within `precision`, the smallest in the order of (u, v).
//   3. From each kept point the walk goes on along the run on one face: the next point kept is
//      the furthest one such that every point of the mesh between lies within `precision` of
//      the straight segment to it. A dropped point is thus judged against the segment that
//      replaces it, never against a line that later drops have moved: the polygon of the
//      corners stays within `precision` of the polygon of the mesh, whatever the curve.
//   4. A loop left with fewer than three corners is dropped (a sliver thinner than the
//      precision: what a plane cuts just under an edge or a tip that lies in it).
//   The loop is listed from the corner of step 2 (of several face changes, the smallest in the
//   order of (u, v)), so the list does not depend on where the mesh starts the chain either.
// - `area` is of the loop before points are dropped. `lengths[i]` is the length along the mesh
//   polygon from `points[i]` to the next corner; their sum is the length of the loop.
// - The material is on the left of a loop seen against the normal of the plane.
export interface CutLoop {
  points: Vec2[];
  faces: number[]; // faces[i]: the face of the segment from points[i] to the next point
  lengths: number[];
  area: number; // signed: positive for a loop that runs counter-clockwise
}
export declare function cut(solid: Solid, frame: Frame, below: number, precision: number): CutLoop[];

// ---------------------------------------------------------------- the section view of the app

// What the section adds to the scene of the app (`SceneModel` in packages/app/src/viewport.ts,
// here the stand-in of 1b): the half-space that is cut away. What lies on the side the normal
// points to is not drawn and not picked; the cut is filled from the loops of the query
// (`fills`), which lie in the plane itself and are not clipped. The plane is the one the
// section was taken at (`takenAt`), for the clip and for the fills alike.
declare module '../1b-measure/contract' {
  interface SceneAdditions {
    clip: { origin: Vec3; normal: Vec3 };
  }
}

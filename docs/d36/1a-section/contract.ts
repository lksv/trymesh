// Contract of package 1a of D36 (decision D38): the section of bodies by a plane, as a query for
// the AI and as the section view of the app. A draft, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). The design is design.md.

import type { Frame, Id, Solid, Vec2, Vec3 } from '../../../packages/engine/src/index';
import type { ArgSpecs, FaceNameAfter, Truncated } from '../00-prep/contract';
import type { ResultUnits } from '../1b-measure/contract';

// ---------------------------------------------------------------- the arguments

// - `plane`: a base plane, a plane feature or a planar face (`PlaneRef`, as features use it).
//   A face that is not planar is answered as `failed` with the path `['plane']`.
// - `offset`: the plane is moved by this along its normal. For a face the normal points out of
//   the body, so a negative offset cuts into it.
// - `flip`: the section is seen from the other side: the normal and the x axis of the frame are
//   reversed (after the offset). It decides which side the app cuts away and nothing else.
// - `bodies`: only these; without it all bodies of the state.
// - `outline`: how a loop is written. `spans` (the default) is for reading: lines and arcs
//   rebuilt from the surfaces, and what has no such form as a curve. `polylines` is for drawing:
//   every loop as the polygon the mesh gives.
// - `maxPoints`: the most points the answer lists (the points of curves with `spans`, of all
//   loops with `polylines`). What does not fit is left out and counted.
export const SECTION_ARGS = {
  plane: { kind: 'plane', title: 'Cutting plane', summary: 'A base plane, a plane feature or a planar face.' },
  offset: { kind: 'number', title: 'Offset', summary: 'Moves the plane along its normal.', optional: true, spec: { title: 'Offset along the normal', unit: 'mm', default: 0 } },
  flip: { kind: 'flag', title: 'From the other side', optional: true },
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'Without it all bodies.', optional: true },
  outline: { kind: 'choice', options: ['spans', 'polylines'], title: 'Form of a loop', summary: 'spans: lines, arcs and curves with the face each lies on (the default). polylines: the points of every loop, for drawing.', optional: true },
  maxPoints: { kind: 'number', title: 'Most points', optional: true, spec: { title: 'Most points to return', unit: 'count', integer: true, min: { value: 0 }, default: 500 } },
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
// - `arc`: `sweep` is the angle from `from` to `to` about `center`, positive counter-clockwise;
//   a whole circle has `from` equal to `to` and a sweep of 2π or −2π.
// - `curve`: `count` points from `from` to `to`, both included, `length` along them. `points`
//   are there only while they fit `maxPoints`.
export type SectionSpan = { face: FaceNameAfter; from: Vec2; to: Vec2 } & ({ kind: 'line' } | { kind: 'arc'; center: Vec2; radius: number; sweep: number } | { kind: 'curve'; count: number; length: number; points?: Vec2[] });

// A closed loop. `area` and `length` are of the polygon the mesh gives, so a circle of radius r
// has a little less than πr² (the polygon is inscribed).
// - With `spans`: the spans in order; each starts where the one before it ends.
// - With `polylines`: the points in order, the first not repeated; left out when they do not
//   fit `maxPoints`.
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
export interface SectionOfBody {
  body: Id;
  area: number; // mm2, all regions
  regions: SectionRegion[];
}

// - `frame`: the cutting plane as it was used: after the offset and the flip. The points of the
//   loops are in its x and y; `origin + x·u + y·v` is the point in the model.
// - `bodies`: the bodies the plane cuts, in the order of the model. A body the plane misses is
//   not listed.
// - `inPlane`: planar faces of the bodies asked about that lie in the cutting plane. The section
//   is taken a step below the plane (against its normal): a body that ends in the plane from
//   below shows that face as its section, one that starts in it from above shows nothing. With
//   an entry here the offset is better moved a little.
// - `truncated`: `total` points there were to list and `shown` of them listed.
export interface SectionResult extends Truncated {
  frame: Frame;
  bodies: SectionOfBody[];
  inPlane: { body: Id; face: FaceNameAfter }[];
}

declare module '../00-prep/contract' {
  interface Queries {
    section: { spec: typeof SECTION_ARGS; result: SectionResult };
  }
}
export const SECTION_UNITS = { area: 'mm2', length: 'mm', radius: 'mm', sweep: 'rad' } as const satisfies ResultUnits;

// ---------------------------------------------------------------- the pass over triangles

// The loops a plane cuts out of one closed mesh, as the mesh gives them: points in the x and y
// of the frame, and for every segment the number of the face its triangle belongs to.
// - A vertex that lies in the plane counts as above it. Every crossed triangle then gives
//   exactly one segment, between the two of its edges that cross, and the point on an edge is
//   computed from its two vertices in a fixed order, so both triangles of the edge get the same
//   numbers. The segments are chained by the edges they end on, not by comparing coordinates.
// - The mesh of a body is a closed surface (every edge in exactly two triangles, once each way:
//   guarantee 1 of the kernel port and the check of its adapter), so every chain closes.
// - A segment without length (a vertex in the plane) is dropped, and a loop without area with it.
// - The material is on the left of a loop seen against the normal of the plane.
export interface CutLoop {
  points: Vec2[];
  faces: number[]; // faces[i]: the face of the segment from points[i] to the next point
  area: number; // signed: positive for a loop that runs counter-clockwise
}
export declare function cut(solid: Solid, frame: Frame): CutLoop[];

// ---------------------------------------------------------------- the section view of the app

// What the section adds to the scene of the app (`SceneModel` in packages/app/src/viewport.ts,
// here the stand-in of 1b): the half-space that is cut away. What lies on the side the normal
// points to is not drawn; the cut is filled from the loops of the query (`fills`), which lie in
// the plane itself and are not clipped.
declare module '../1b-measure/contract' {
  interface SceneAdditions {
    clip: { origin: Vec3; normal: Vec3 };
  }
}

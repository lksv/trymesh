// Contract of package 1b of D36 (decision D39): measuring between two named entities, and the
// generic form of a query in the app. A draft, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and the shared
// contract of the preparatory step, and states what the package adds. The design is design.md.

import type { Frame, Id, Solid, Vec3 } from '../../../packages/engine/src/index';
import type { ArgKind, ArgPath, ArgSpecs, BodyEdge, EdgeNameAfter, EngineAfter, EntityRef, FaceNameAfter, QuantityUnit, QueryArgs, QueryContext, QueryName, QueryOutcome, QueryResult, StateAfter } from '../00-prep/contract';

// ================================================================ the engine

// ---------------------------------------------------------------- what an entity is

// An entity of the model reduced to what can be measured exactly. It is read from the surfaces
// (`context.surface`), from the frame of a face (`context.frame`) and from the solved sketch
// (`context.sketch`), never fitted to the mesh; only the two ends of a straight edge are taken
// from the mesh, along the exact line.
// - `plane`: a planar face. `normal` points out of the body.
// - `cylinder`, `cone`: a face. `convex`: the material is on the side of the axis (a pin); false
//   for a hole.
// - `swept`: a face swept along `axis` (the teeth of a gear): it has a direction and no position.
// - `line`: a straight edge, the line of its two planes. `from` and `to` are its ends.
// - `circle`: a circular edge: the circle of its two surfaces (the four pairs of the shared
//   vocabulary), whole even when the edge is an arc of it.
// - `point`: a sketch point, where the model has it (a sketch is never posed).
// - `other`: a general surface, an edge of the kind `coplanar` or `other`. Nothing exact is
//   known about it; it can still be measured on the mesh.
export type EntityShape =
  | { is: 'point'; at: Vec3 }
  | { is: 'line'; from: Vec3; to: Vec3; direction: Vec3 }
  | { is: 'circle'; center: Vec3; axis: Vec3; radius: number }
  | { is: 'plane'; origin: Vec3; normal: Vec3 }
  | { is: 'cylinder'; origin: Vec3; axis: Vec3; radius: number; convex: boolean } // origin: a point of the axis
  | { is: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number; convex: boolean }
  | { is: 'swept'; axis: Vec3 }
  | { is: 'other' };

// The resolver of an entity, for every query that takes one (1e takes a face as an orientation,
// 5a will take faces and edges of posed bodies). `arg` is the path of the argument the entity
// came in, for the failure. It throws `QueryFailure`:
// - `notAvailable` when the sketch of a sketch point did not evaluate (it is in the document, so
//   the check before `run` let it through);
// - nothing else: that the body, the face, the edge and the point exist was checked before `run`.
// A whole body is not an entity that has a shape; the resolver takes the other three kinds.
export type ShapedRef = Exclude<EntityRef, { kind: 'body' }>;
export declare function entityShape(context: QueryContext, ref: ShapedRef, arg: ArgPath): EntityShape;

// The circle of a circular edge, exactly: computed from the two surfaces of the edge, as
// `projectEdge` in solid.ts does for a plane and a cylinder today. It replaces the circle fitted
// to three vertices in the description of a body (`BodyEdge` of the preparatory step, which says
// that this change belongs here): the member `circle` is always there and gains the axis. The
// numbers `get_body` prints for a circular edge change in their last digits, and an arc with too
// few vertices to fit now has its circle. In the code this is a change of `BodyEdge` in place.
export type BodyEdgeExact = Exclude<BodyEdge, { kind: 'circle' }> | { name: EdgeNameAfter; length: number; segments: number; kind: 'circle'; circle: { center: Vec3; axis: Vec3; radius: number } };

// ---------------------------------------------------------------- the smallest distance on the mesh

// The smallest distance between two parts of the mesh, with the two points it lies between. One
// module for this query and for the smallest gap of 1c (which finds, with it, where the gap the
// kernel measured is).
// - A part is a point, the segments of an edge (`BodyResult.edges[i].segments`, six numbers
//   a segment), or the triangles of a solid: all of them or those of one face.
// - `within`: pairs of triangles or segments whose boxes are further apart are skipped, and
//   undefined is returned when nothing is closer. The best distance found so far tightens it.
// - Two triangles that cross (an edge of one goes through the other) are at distance zero, so
//   two faces of bodies that collide measure zero. A part wholly inside a closed solid without
//   touching its surface is not found this way: the distance is then to the surface around it.
//   Whether two bodies share a volume is the question of `interference` and of the kernel (1c).
// - `faceA`, `faceB`: the faces of the two closest triangles. Where the closest point lies on an
//   edge or a corner of a body it belongs to triangles of several faces, all at the same
//   distance; the face named is the one that faces the other part most directly (the largest
//   cosine between its normal and the direction to the other point), so the wall of a bore is
//   named and not the cap it ends in.
export type MeshPart = { point: Vec3 } | { segments: Float64Array } | { solid: Solid; face?: number };
export interface Closest {
  distance: number;
  a: Vec3;
  b: Vec3;
  faceA?: number; // only for a part with triangles
  faceB?: number;
}
export declare function closest(a: MeshPart, b: MeshPart, within?: number): Closest | undefined;

// ---------------------------------------------------------------- the query

const ENTITY = { kind: 'entity', accepts: ['face', 'edge', 'sketchPoint'] } as const;
export const MEASURE_ARGS = {
  from: { ...ENTITY, title: 'From', summary: 'A face or an edge of a body, or a sketch point.' },
  to: { ...ENTITY, title: 'To' },
} as const satisfies ArgSpecs;

// What is measured between two entities.
//
// The exact part is computed from the surfaces, in double precision, and does not depend on how
// finely round faces are divided. Each entity has a reference and may have a direction:
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
// - `distance`: between the two references, taken without their ends: point to point, point to
//   line, point to plane, line to line (the common perpendicular; zero when they cross), and for
//   a line and a plane or two planes only when they are parallel (within `ANGLE_TOLERANCE`),
//   because otherwise they cross and the number would say nothing. For two cylinders it is the
//   distance of their axes; for a cylinder and a planar face along its axis, how far the axis is
//   from the wall. Absent when either entity has no reference.
// - `angle`: between the two directions; absent when either entity has none.
//   - Two planes: between the normals out of the bodies, 0 to π. 0: the faces look the same way
//     (two steps); π: opposite ways (the two sides of a wall, the two walls of a slot).
//   - A plane and anything else: between the line and the plane, 0 to π/2. 0: the axis runs along
//     the plane; π/2: it stands on it.
//   - Otherwise: between the two lines, 0 to π/2.
// - `facing`: for two planar faces that look opposite ways. `away`: each lies behind the other
//   (the two sides of a wall; `distance` is its thickness). `towards`: they look at each other
//   (the two walls of a slot, two bodies with a gap between; `distance` is its width).
//
// The measured part is always there:
// - `smallest`: the smallest distance between the two entities as they are on the bodies, with
//   their outlines and ends, and the two points it lies between. It is measured on the mesh, so
//   round shapes are polygons. `accuracy` bounds the difference from the exact shape: the chord
//   tolerance of the document for each of the two entities that lies on a body (a sketch point
//   adds nothing). Between two planar faces with straight outlines the value is exact to the
//   precision of the coordinates.
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

declare module '../00-prep/contract' {
  interface Queries {
    measure: { spec: typeof MEASURE_ARGS; result: Measurement };
  }
}

// ---------------------------------------------------------------- units of a result (a stand-in)

// Needs from the preparatory step (design.md): `QuerySpec` says in which keys of a result
// a number is small on purpose (`significant`) but not what unit a number has. The generic form
// of the app shows a result without a view of its own, and the app shows angles in degrees
// everywhere else. Until the shared contract has it, a query of track A exports this map next to
// its entry, in the form `significant` has: keys of the result, at any depth. `QUERY_UNITS` is
// what the generic form reads.
export type ResultUnit = QuantityUnit | 'g·mm2';
export type ResultUnits = { readonly [key: string]: ResultUnit };
export const MEASURE_UNITS = { distance: 'mm', angle: 'rad', accuracy: 'mm', radius: 'mm', halfAngle: 'rad' } as const satisfies ResultUnits;
export declare const QUERY_UNITS: { readonly [N in QueryName]?: ResultUnits };

// ================================================================ the app: the generic form of a query

// The app's types cannot be imported into a draft: packages/app imports three.js, which the type
// check of the drafts does not resolve in a worktree with only the root `node_modules` linked.
// The types below are therefore stand-ins, and unlike part 3 of the preparatory step they are
// type-checked: the view of every query of track A is written against them in its calls.ts.
// In the code they live in packages/app/src/panels/query.ts and packages/app/src/queries/.

// ---------------------------------------------------------------- a control per kind of argument

// The form is built from the description of the arguments. Every kind has a control; the table
// is typed over the kinds, so a new kind of argument does not compile until it has one.
// - `selection`: the control takes what the user selects in the view while it is armed: a face
//   or an edge of a body for an entity, a planar face or a plane for a plane.
// - `lists`: a choice from what the shown state has (bodies, features, sketches, the points of
//   a sketch, the constraints of the sketch chosen in the argument next to it).
export type ControlName = 'number' | 'checkbox' | 'text' | 'choice' | 'lists' | 'selection' | 'selectionOrLists' | 'vector' | 'rows' | 'alternative' | 'group';
export const CONTROLS: { readonly [K in ArgKind['kind']]: ControlName } = {
  number: 'number', // with the unit as a suffix; an angle is typed and shown in degrees; a number only, no expression
  flag: 'checkbox',
  text: 'text',
  choice: 'choice',
  body: 'lists',
  feature: 'lists',
  sketch: 'lists',
  constraint: 'lists',
  entity: 'selectionOrLists', // a face or an edge by a selection, a body by a selection or a list, a sketch point from two lists
  plane: 'selectionOrLists', // a base plane or a plane feature from a list, a planar face by a selection
  axis: 'lists', // a base axis, or a sketch and its point
  vector: 'vector', // three numbers
  list: 'rows', // a row per element, added and removed within `min` and `max`
  oneOf: 'alternative', // a choice of the alternative and the control of the chosen one
  record: 'rows', // a row per key; the key from a list of bodies or features, or a text
  fields: 'group',
};

// ---------------------------------------------------------------- the panel and its state

// The state of the query panel: one object the app holds and only the panel reads and writes,
// like the state of the collisions in part 3. One query is open at a time.
// - `draft`: the arguments being filled in, in the shape of the description; a value not given
//   yet is undefined. It survives a change of the document; an ID in it that is gone is found by
//   the engine when the query is asked (`notAvailable` with the path of the argument).
// - `armed`: the path of the control that takes the next selection in the view.
// - `answer`: belongs to the document and to the place on the timeline it was asked at, as the
//   collisions do today: shown while the marker is `at`, hidden while it is elsewhere, dropped
//   when the engine reports a change of the document. It keeps the arguments it was asked with,
//   so that a view draws what was asked and not what the form shows meanwhile.
export interface QueryPanelState {
  name: QueryName;
  draft: unknown;
  armed?: ArgPath;
  answer?: { at: Id | null; args: unknown; outcome: QueryOutcome<unknown>; picked?: number };
}

// Asking a query whose name is known only at run time (the generic form; the MCP tool `query` is
// in the same position). The engine checks the arguments against the description, so the one
// cast is here and nowhere else in the app.
export declare function askQuery(engine: EngineAfter, name: QueryName, args: unknown, at: Id | null): QueryOutcome<unknown>;

// What the panel does with a selection in the view: true when an armed control took it (the
// app then does not keep it as its own selection). The app calls it from the one place where
// a click in the model selects something.
export type Selection = { kind: 'face'; body: Id; face: FaceNameAfter } | { kind: 'edge'; body: Id; edge: EdgeNameAfter } | { kind: 'plane'; ref: { kind: 'base'; plane: 'XY' | 'XZ' | 'YZ' } | { kind: 'plane'; feature: Id } };
export declare function takeSelection(panel: QueryPanelState, selection: Selection): boolean;

// ---------------------------------------------------------------- a view of one query

// What a view adds to the scene while its answer is shown. The first five are the fields of
// `SceneModel` in packages/app/src/viewport.ts as they are today, with a face given by its name
// (the scene resolves the mesh). `bodies`: bodies drawn highlighted, as the two bodies of
// a picked collision are today. A package that needs more of the scene (the section of 1a clips
// it) adds a field by declaration merging.
export interface SceneAdditions {
  lines: { segments: ArrayLike<number>; color: number; width: number; dashed?: boolean; onTop?: boolean }[];
  points: { positions: number[]; color: number; size: number }[];
  fills: { frame: Frame; loops: ArrayLike<number>[]; color: number; opacity: number; onTop?: boolean }[];
  faces: { body: Id; face: FaceNameAfter; color: number; opacity: number }[];
  labels: { at: Vec3; text: string; tone?: 'driving' | 'reference' | 'problem' }[];
  bodies: Id[];
}

// What a view gets of the panel and of the app.
export interface ViewPanel {
  state: StateAfter; // the state the answer was asked about
  bodyName(body: Id): string;
  faceLabel(name: FaceNameAfter): string;
  number(value: number, unit: ResultUnit): string; // a number with its unit as the app writes it: "16.2 mm", "30°"
  picked: number | undefined; // a row of the answer the user picked; what a row is belongs to the view
  pick(row: number | undefined): void; // redraws the panel and the scene
  // Ask again with other arguments (a section stepped along its normal). The form follows.
  ask(args: unknown): void;
}

// A view of one query, optional. Without one the answer is a tree of names and values. Every
// member is optional too: a view may only draw, or only list.
// - `immediate`: the query is asked as soon as its form opens, when no required argument is
//   missing (the collisions: one click, as today).
// - `prepare`: the arguments the query is asked with, from the arguments of the form. A view
//   that draws may need more of the answer than a reader would ask for (the section view asks
//   for the points of every loop). The answer keeps the arguments it was really asked with.
// - `answer`: the rows of the panel for an answer, in place of the tree.
// - `scene`: what the answer adds to the scene.
// - `note`: the line for the status bar; it goes when the answer goes, as today's note of the
//   collisions does.
export interface QueryView<N extends QueryName> {
  immediate?: boolean;
  prepare?(args: QueryArgs<N>): QueryArgs<N>;
  answer?(result: QueryResult<N>, args: QueryArgs<N>, panel: ViewPanel): HTMLElement[];
  scene?(result: QueryResult<N>, args: QueryArgs<N>, panel: ViewPanel): Partial<SceneAdditions>;
  note?(result: QueryResult<N>, panel: ViewPanel): { text: string; error: boolean };
}
export declare const QUERY_VIEWS: { [N in QueryName]?: QueryView<N> };

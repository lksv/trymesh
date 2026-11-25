// Veřejné typy enginu: dokument, porty, výsledek přepočtu a API.
// Zdrojem pravdy je docs/architecture.md; typy se s ním mají shodovat.
import type { ExportFormat, ExportOptions } from './export/spec';
import type { QueryArgs, QueryName, QueryResult } from './query/spec';

export type Id = string; // trvalé, nikdy se nerecykluje
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export interface Point2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- dokument

export interface Document {
  schemaVersion: number; // 3; `load` upgrades an older document
  schemaSteps?: string[]; // written only by a build of a branch that is not merged yet; never send it
  settings: {
    chordTolerance: number; // dělení oblouků na segmenty
  };
  parameters: Parameter[]; // named parameters; the order is for display only
  checks: Check[]; // checks: expressions that are supposed to hold
  features: Feature[]; // časová osa
  // Properties of bodies by body ID (D48), also of a derived one (`<pattern>/<number>`): always
  // present, `{}` when nothing is set. Not part of the timeline: a change of a property recomputes
  // no geometry. An entry whose body no state has stays (the feature was removed or suppressed,
  // the count of a pattern dropped) and is taken over by a body that appears under its ID again;
  // `get_model` lists such entries, the command removeBodyProperties removes one.
  bodyProperties: Record<Id, BodyProperties>;
  // The mechanism (D49): links, and joints between them. Always present, `{ links: {}, joints: {} }`
  // when empty; without a link every query answers for the model as modelled. Not part of the
  // timeline: a change of a value recomputes no geometry and moves no body of the evaluation.
  mechanism: Mechanism;
  // Stored meshes by ID (D55): triangle meshes read from files (the MCP tool import_mesh, or the
  // import of the app), kept inside the document. Always present, `{}` when there is none. Not part
  // of the timeline: a feature of the type `mesh` places an entry as a body, and that feature is
  // the one thing that reads an entry (it is computed again when the entry it names appears). The
  // IDs are a namespace of their own (the mesh `nema17` may be placed by the feature `nema17`).
  // An entry never changes: there is no command that edits one; `addMesh` adds an entry,
  // `removeMesh` removes one that no feature names.
  meshes: Record<Id, StoredMesh>;
  // Stored documents by ID (D62): other documents kept inside this one, to be inserted as parts by
  // features of the type `insert`. Always present, `{}` when there is none. Not part of the
  // timeline; the IDs are a namespace of their own (the document `bearing` may be inserted by the
  // feature `bearing`). An entry is a copy: it changes only by the command `replaceDocument`.
  documents: Record<Id, StoredDocument>;
}

// A document kept inside another one, to be inserted as a part (a bearing, a motor, a bracket made
// elsewhere) (D62).
// - `name`: for people, usually the name of the file it came from; the rules of a body name.
// - `document`: a whole document (its timeline, parameters, checks and every section, stored
//   documents of its own included). It is validated as a document is on a load: an older one is
//   brought to the schema of this build by the same upgrade steps, and the stored copy is the
//   upgraded one. Documents inside documents are allowed up to 8 levels below the host.
// - Strict: `name` and `document`, nothing else, on a command and on a load.
export interface StoredDocument {
  name?: string;
  document: Document;
}

// A closed, indexed triangle mesh in millimetres, in its own frame (the frame of the file it came
// from), as the document stores it.
// - `name`: for people, usually the name of the file; the rules of a body name (not empty, no
//   leading or trailing space, at most 200 characters).
// - `positions`: base64 of 32-bit floats, little-endian: x, y, z of every vertex.
// - `triangles`: base64 of 32-bit unsigned integers, little-endian: three vertex numbers per
//   triangle, counter-clockwise seen from outside the solid.
// - Base64 in its canonical form: the alphabet of RFC 4648 section 4, padded with `=`, no white
//   space, the unused bits of the last character zero; one mesh has one spelling.
// - Strict: an entry lists these fields and no other, on a command and on a load.
// What a stored mesh has to be, checked by `addMesh` and by a load: at least 4 and at most 100 000
// triangles; finite coordinates within ±1e9; every index names a vertex, every vertex is named,
// no triangle names a vertex twice; closed (every edge in exactly two triangles, once each way);
// a positive volume; every connected shell thicker than a millionth of its own size (twice its
// volume over its surface, against the largest side of its bounds); every shell that faces
// inwards is a hollow of a shell around it. Shells that overlap are not detected (they count
// twice in the volume).
export interface StoredMesh {
  name?: string;
  positions: string;
  triangles: string;
}

// The mechanism: links, and joints between them (D49).
// - The model is modelled in one configuration, and that configuration is the zero of every
//   joint: a body stands where the timeline puts it when all values are 0.
// - Links and joints are records by ID. An ID follows the rules of every ID (not empty, no `/`,
//   not `origin`) and is unique among the links, or among the joints; a link may carry the ID of
//   a feature (the link `forearm` holds the body `forearm`).
// - A name of a link or of a joint is for people, by the rules of a body name: not empty, no
//   leading or trailing space, at most 200 characters. Without it the ID is shown.
// What always holds, on a command and on a load (the section is small and is checked whole):
// - a body is listed in at most one link, and once in it;
// - the parent and the child of a joint are links of the section and differ;
// - a link is the child of at most one joint, and no link hangs on itself through a chain of
//   joints. Together: the joints form a forest. More than one root is allowed (a mechanism that
//   is being built, two arms on one table); the result lists the roots.
// What a command checks only when it sets it, and what may break later (the result reports it):
// - a body named by a link is one a feature of the document can create (as for body properties);
// - the sketch and the point of an axis exist;
// - `lower` is not above `upper`, and `value` lies within them, to a tolerance (1e-4 rad, 1e-6 mm:
//   a value outside by no more than that is the limit, and is stored as the limit).
export interface Mechanism {
  links: Record<Id, Link>;
  joints: Record<Id, Joint>;
}

// Bodies that move as one piece. A body is in at most one link; a body in no link stays where
// it is modelled, like the bodies of a link that is no joint's child (a root). A link may be
// empty. A copy made by a pattern is a body of its own (`<pattern>/<number>`) and is listed like
// any other. The list keeps the order it was given.
export interface Link {
  name?: string;
  bodies: Id[];
}

// A joint moves its child link, and everything that hangs on it, against its parent link.
// - `revolute`: a turn about the axis by `value`, within `lower` and `upper` (each within a full
//   turn, ±2π). `continuous`: the same without limits. Radians; a positive value turns
//   counter-clockwise seen against the direction of the axis (the right-hand rule), as a pattern
//   does; for a sketch point the direction is the normal of the sketch plane.
// - `prismatic`: a shift along the direction of the axis by `value`, in millimetres.
// - `fixed`: the child keeps its place against the parent.
// - `axis` is given as modelled (the zero configuration) and is never posed by itself: the
//   joints nearer to the root carry it along with the parent link.
// - `value`, `lower` and `upper` are numeric fields (`<joint>/value`): each holds the last valid
//   number and takes an expression over the parameters, kept in `expressions` of the joint under
//   the name of the field. A coupled motion is two values that follow one parameter (`q` and
//   `-2 * q`).
// - The drive (5b, D59): optional numeric fields, by the same rule, read by nothing but the export
//   of a robot description (URDF, MJCF). A fault of one blocks no pose (`JointResult.driveErrors`).
//   - `effort`: the largest torque or force the drive gives at the joint: N·mm for a revolute and
//     a continuous joint (a servo of 11 kg·cm is 1078), N for a prismatic one. Above 0.
//   - `velocity`: the largest speed of the joint: rad/s, or mm/s for a prismatic one. Above 0.
//   - `rotorInertia` (revolute, continuous): the moment of inertia of what turns inside the drive
//     (a rotor, the first stage of a gearbox) about its own axis, at the motor, in g·mm² (the unit
//     of the query `mass`; a data sheet in g·cm² ×100, in kg·m² ×1e9). At least 0.
//   - `gearRatio` (revolute, continuous): turns of the motor per turn of the joint. Above 0; 1
//     when it is not stated.
export type Joint = JointBase &
  (
    | ({ type: 'revolute'; axis: AxisRef; lower: number; upper: number; value: number } & TurningDrive)
    | ({ type: 'continuous'; axis: AxisRef; value: number } & TurningDrive)
    | ({ type: 'prismatic'; axis: AxisRef; lower: number; upper: number; value: number } & ShiftingDrive)
    | { type: 'fixed' }
  );
export interface JointBase {
  name?: string;
  parent: Id; // a link
  child: Id; // a link
  expressions?: { value?: Expr; lower?: Expr; upper?: Expr; effort?: Expr; velocity?: Expr; rotorInertia?: Expr; gearRatio?: Expr };
}
export interface TurningDrive {
  effort?: number;
  velocity?: number;
  rotorInertia?: number;
  gearRatio?: number;
}
export interface ShiftingDrive {
  effort?: number;
  velocity?: number;
}

// What a body is used as. It decides who reads the body:
// - `part`: a printed part of the design. The default.
// - `reference`: a bought or given part (a motor, a bearing, a board), modelled so that the design
//   fits around it. It is not printed: the print exports and the print query leave it out when
//   they are given no list of bodies. It has a mass and belongs to the mechanism.
// - `auxiliary`: not a physical thing (kept-free space, the envelope of a motion, a jig that only
//   helps the modelling). It takes part in the interference and gap queries, which is what it is
//   for. It is in no list a reader makes by itself and it never has a mass, also when a caller
//   names it.
// A body the caller lists is taken as listed: a print export of a list with a reference body
// writes that body.
export type BodyUse = 'part' | 'reference' | 'auxiliary';

// The properties of one body. Every field is optional; a field that is not there is inherited from
// the body this one was copied from (a copy made by a pattern of a body), or has its default. An
// entry with no field is not stored.
// - `name`: for people; not inherited. Non-empty, no leading or trailing space, at most 200
//   characters. Without it the body is named after the feature that created it.
// - `color`: `#rrggbb`; upper case is accepted and stored in lower case.
// - `material`: a label for people and for a parts list, such as "PETG"; the same rules as `name`.
//   The catalog `materials` fills `material` and `density` together (command setBodyMaterial) and
//   the document keeps the number, so a corrected catalog does not change an old model.
// - `density`: g/cm3, the effective density of the body as it is made (a printed part has shells
//   and infill, so it is less than that of the material). A numeric field (`<body>/density`):
//   above 0, at most 25.
// - `mass`: g, the mass of the whole body from a data sheet or a scale; when it is there the density
//   is not used for the mass. A numeric field (`<body>/mass`), above 0.
// - `expressions`: the expressions of the two numeric fields by field name (`density`, `mass`), by
//   the rule of `FeatureBase.expressions`: the field holds the last valid number.
// Inheritance is field by field with one exception: `density` and `mass` say together what the body
// weighs and are inherited together. An entry that states either of the two inherits neither, so
// a copy given another material is weighed by its own density and not by the mass of its source.
export interface BodyProperties {
  name?: string;
  color?: string;
  material?: string;
  use?: BodyUse;
  density?: number;
  mass?: number;
  expressions?: { density?: Expr; mass?: Expr };
}

// An expression over parameters. Units are the same as for numbers: lengths in millimetres, angles in
// radians. Degrees are written with the function `deg(x)` (degrees → radians), `pi` is a constant.
// A function is recognised by the parenthesis after its name, so a parameter may share a name with
// a function; only the names of constants are reserved.
export type Expr = string;

// The address of a numeric field inside a feature, parts separated by slashes (not allowed in IDs):
// 'offset', 'extent/start', 'extent/distance', 'constraints/<id>/value'. A numeric field of an
// entry of a section of the document (body properties) is addressed by the key of the entry,
// a slash and the field: 'motor/density', 'screws/2/mass' (the field is the last part).
export type FieldPath = string;

// The name is an identifier (letters, digits, underscore) because it is used in expressions.
// A parameter may refer to any other one regardless of order; a cycle is an error.
export interface Parameter {
  name: string;
  expr: Expr;
}

// An expression with a comparison that is supposed to hold; a failed check is a warning and the
// model keeps computing. The name is free text for a human: non-empty, without leading or trailing
// spaces, unique among checks. Equality is compared with the tolerance 1e-9 · max(1, |a|, |b|);
// `<` means less than and not equal.
export interface Check {
  name: string;
  expr: Expr;
}

// ---------------------------------------------------------------- features

export type Feature = PlaneFeature | SketchFeature | ExtrudeFeature | PatternFeature | HoleFeature | MeshFeature | CombineFeature | SplitFeature | RevolveFeature | ChamferFeature | FilletFeature | InsertFeature;

export interface FeatureBase {
  id: Id;
  name: string;
  suppressed: boolean;
  // Expressions of numeric fields; the only place a feature keeps expressions. The number in the
  // field is the last valid value of the expression; the engine rewrites it after a recompute. A key
  // must be the address of an existing numeric field (see fieldsOf): removing a constraint or
  // changing a variant removes the expression, and a reference dimension has none. In a command the
  // expression is written straight into the field as a string (see Input).
  expressions?: Record<FieldPath, Expr>;
}

// A plane of its own, built in this order (D60):
// 1. `base`: a base plane, a plane feature or a planar face of a body (the whole plane it lies in).
// 2. `midplaneWith` (optional): the plane halfway between the base and this plane. For parallel
//    planes the plane in the middle; for planes at an angle the plane that bisects the angle,
//    through the line where they meet: of the two such planes, the one nearer to the base (the
//    base turned by at most 45°). With n1 and n2 the normals of the base and of the second plane:
//    when n1 · n2 ≤ 0 (at a right angle within 1e-4 rad included) the one with the normal n1 − n2,
//    otherwise the one with the normal n1 + n2.
//    So the two faces of a slab or the two sides of a drafted rib give the plane of symmetry, and
//    a floor and the top of a part the plane in the middle; but two faces that meet at a convex
//    edge at an inner angle above 90° (neighbouring sides of a hexagonal prism) give the plane
//    outside the body that touches it along the edge: their plane of symmetry is that midplane
//    tilted by π/2 about the edge projected as a line. The axes of the midplane are those of the
//    base turned by the smallest rotation onto it, its origin moved along its normal into it. Where
//    the two normals pass through a right angle the choice switches. The natural plane of a mirror.
// 3. `tilt` (optional): the plane through `axis`, turned by `angle` from the plane of steps 1 and
//    2 about the axis (radians, the right-hand rule about the direction of the axis: a base axis
//    points along its positive half, a sketch line from `a` to `b`, a sketch point along the
//    normal of its sketch, a round face as its build gives it). The axis must be parallel to that
//    plane (within 1e-4 rad); it need not lie in it. With the angle 0 the plane is parallel to the
//    base and contains the axis. A point of the base plane on the axis keeps its coordinates in
//    a sketch on the tilted plane (the origin of the frame turns with it and may lie far away).
//    The numeric field is `tilt/angle`, from −π to π, without a default; `deg(30)` in an expression.
// 4. `offset`: moved along the normal of the plane of steps 1 to 3.
// A plane with neither optional field is the plane offset from its base.
// - `updateFeature`: `{ midplaneWith: null }` and `{ tilt: null }` remove them; `{ tilt: { angle } }`
//   changes the angle of a tilt (the axis is a reference and is replaced whole), and on a plane
//   without a tilt it is an invalid command (a tilt is given whole, axis and angle). `setField`
//   reaches `tilt/angle` only on a plane that has a tilt.
// - Errors: `brokenReference` and `nonPlanarFace` with the base or the second plane in `refs`;
//   `brokenReference` with the sketch or the line of the axis, or its body or face; `invalidAxis`
//   when the line of the axis has no length, its face has no axis, or it is not parallel to the
//   plane it tilts (`refs`: the axis; the message gives the angle).
// - The result of a tilted plane tells in facts `axisPoint` and `axisDirection`: the axis used, its
//   direction made exactly parallel to the plane.
// - A tilted plane makes a joint about an axis askew to the axes of the model easy to model; such
//   a joint is the known limit of the mechanism (each pair of bodies across it costs seconds in the
//   kernel when collisions are checked).
export interface PlaneFeature extends FeatureBase {
  type: 'plane';
  base: PlaneRef;
  offset: number; // posun ve směru normály základu
  midplaneWith?: PlaneRef;
  tilt?: { axis: AxisRef; angle: number };
}

// ---------------------------------------------------------------- sketch

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: PlaneRef;
  points: Record<Id, Point2>; // řešené proměnné: polohy bodů
  radii: Record<Id, number>; // řešené proměnné: poloměry kružnic
  curves: Record<Id, Curve>;
  constraints: Record<Id, Constraint>;
  external: Record<Id, ExternalRef>; // promítnutá geometrie
  solved: SolveStamp; // pro jaké vstupy uložené proměnné platí
}

export interface SolveStamp {
  inputs: string; // otisk křivek, vazeb a hodnot promítnuté geometrie; počítá engine
  external: Record<Id, StoredValue>; // poslední platné hodnoty promítnuté geometrie
}

// What `solved.external` holds per entry of reference geometry: positions (`Projected`), or the
// placement of an imported outline (`PlacedOutline`, D72), whose positions are computed from its
// entry and stored nowhere a second time.
export type StoredValue = Projected | PlacedOutline;

// The stored value of an imported outline (D72): where the origin of its file lands (`at`, after
// the anchor), the turn, and the fingerprint of its curves. It is what the stamp of the sketch holds
// of the outline: the sketch is solved again when the outline moves or its curves change.
export interface PlacedOutline {
  kind: 'outline';
  at: Vec2;
  turn: number;
  data: string;
}

// The value of an entry of reference geometry in the coordinates of its sketch: the last valid one
// is stored in `solved.external` and is part of the stamp. Positions and nothing else. A projected
// edge is a line or a circle; a projection from a sketch (SketchProjection) any of the four. The
// `end` of an arc lies on the circle of its `start` exactly, and the arc runs counter-clockwise.
export type Projected =
  | { kind: 'point'; at: Vec2 }
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'arc'; center: Vec2; start: Vec2; end: Vec2 };

export type CurveShape =
  | { type: 'line'; a: Id; b: Id } // ID bodů
  | { type: 'circle'; center: Id } // poloměr je v `radii`
  | { type: 'arc'; center: Id; start: Id; end: Id } // proti směru hodin
  // A spline: a smooth curve over control points (D70).
  // - `points`: the control points in order, own points of the sketch or `origin`, 3 to 64. The
  //   curve starts at the first and ends at the last; the points between pull it and lie off it in
  //   general: a control point pulled aside moves the curve less than itself (in a spline of five
  //   points, the middle one pulled by 4 mm moves the curve by 2). `get_sketch` says where the curve
  //   runs: `through`, points it passes from its start to its end, and `box`.
  // - The same point may not be listed twice, except the first again as the last: the spline is then
  //   closed (at least 4 entries), with a corner at that point unless the first and the last leg of
  //   the control polygon are made to lie on one line.
  // - The curve is a B-spline of degree 3 (2 for three points), clamped (it starts at the first
  //   point along the first leg, from `points[0]` towards `points[1]`, and ends at the last along the
  //   last leg), with uniform knots, not rational. Four points are one cubic Bezier curve; three one
  //   quadratic. It has no other field: no degree, no knots, no weights.
  // - The solver sees only the points: no constraint names a spline, and nothing holds a point on
  //   it. Shape it by constraining its control points like any points.
  // - A spline that runs on smoothly from a line that ends at its first point: hold the second
  //   control point on that line (`pointOnCurve`, which holds it on the whole line, not only between
  //   its ends), and give that point a start position beyond the end of the line. The solver keeps
  //   the side it starts on; behind the end, over the line, the spline turns back on the line in a
  //   cusp, so read the position after the solve, and again after a large change of a dimension,
  //   which can carry the point to the other side. From an arc that ends at its first point: a
  //   construction line from `points[0]` to `points[1]`, tangent to the arc (`tangent`). The same at
  //   the last point with the last leg. A spline may end on a point of a line or an arc only at their
  //   common end; a circle of the outline has no end, so a spline that ends on one makes the profile
  //   invalid (a construction circle may be touched so).
  // - A spline forms regions with the other curves (unless it is a construction curve). The profile
  //   uses its polyline within the chord tolerance of the document: a spline that crosses itself
  //   or another curve, or touches one away from a shared end, makes the profile invalid as two
  //   crossing curves do; the query `sketchContacts` says where. A spline is not trimmed, split or
  //   extended, and a curve is not cut where it crosses one: move the curve or the control points,
  //   or trim the curve back to another curve. It is not projected into another sketch (project its
  //   control points, as points).
  // - The side face of an extrusion is `{ role: 'side', curve: <the spline> }`, one face for the
  //   whole spline, a swept surface; its edges have the kind `other`, so they cannot be projected,
  //   chamfered or filleted, and neither can an edge that runs on smoothly into one: the rim of a
  //   part whose outline is smooth all round and holds a spline takes no chamfer and no fillet. A
  //   sketch cannot stand on the face. A profile with a spline cannot be offset, tapered or revolved,
  //   and a wall does not run along a spline (`invalidProfile` naming the spline).
  // - To change the control points, remove the spline and add it again under its ID in one batch:
  //   no constraint names it, so nothing is lost, and the faces and regions named by it keep the
  //   name. Removing a control point removes the spline, as removing the end of a line removes the
  //   line. `setCurvePoint` does not take a spline.
  | { type: 'spline'; points: Id[] };

export type Curve = { construction?: boolean } & CurveShape;

// The name a curve has for one of its points (the fields of CurveShape other than `type`): `a`,
// `b` of a line; `center` of a circle; `center`, `start`, `end` of an arc.
export type CurvePointName = 'a' | 'b' | 'center' | 'start' | 'end';

export type ProjectionKind = 'line' | 'circle';

// An entry of `external` of a sketch, one of two sources of geometry that is not own (D64, D68):
// - reference geometry, computed before the solver and fixed for it; constraints of the sketch may
//   name its entities: the projection of an edge of a body (EdgeProjection), the projection of an
//   entity of an earlier sketch (SketchProjection, D69), an outline imported from a file
//   (SketchOutline, D72);
// - derived geometry, computed after the solver from the solved own geometry; no constraint of its
//   own sketch may name its entities: a mirror or a pattern of own curves and points
//   (SketchPattern).
// All kinds share the commands addExternal, updateExternal and removeExternal; an update may not
// turn one source into the other.
// Besides its entries every sketch has the lines `origin/x` and `origin/y` through its origin along
// its X and Y (from `origin` towards +X and +Y), fixed like projected geometry and in no entry: a
// constraint of the sketch and an axis `{ kind: 'sketchLine', sketch, line }` may name them; they
// are whole lines, so `midpoint` and `equalLength` do not take them (D71).
export type ExternalRef = EdgeProjection | SketchPattern | SketchProjection | SketchOutline;
// The input form of an entry (`addExternal`, `updateExternal`): its numeric fields may be
// expressions, and the flag `regions` of a projection from a sketch may be left out (false).
export type ExternalInput = Input<EdgeProjection> | Input<SketchPattern> | (Omit<SketchProjection, 'regions'> & { regions?: boolean }) | OutlineInput;

// The projection of an edge of a body into the sketch. kind: jako co se hrana promítá
export interface EdgeProjection {
  type: 'edge';
  body: Id;
  edge: EdgeName;
  kind: ProjectionKind;
}

// The projection of one point, line, circle or arc of an earlier sketch into this sketch (D69):
// reference geometry, fixed for the solver and computed at every recompute from the solved sketch
// `sketch`.
// - `sketch`: a sketch before this one on the timeline, on a plane parallel to this sketch's (either
//   normal, any offset, any shift or turn in the plane). A plane that is not parallel (more than
//   1e-4 rad) gives the warning `unsupportedProjection`, whose message says the angle. The query
//   `sketchSources` says which earlier sketches are parallel and lists what each can project.
// - `entity`: a point or a curve of it: an own point or curve (a construction curve too), `origin`,
//   or an entity of one of its entries (`fl1`, `fl1/a`, `h/center`, a copy of a mirror `m/1/c2`).
//   Nothing under `origin/`: this sketch has its own axes `origin/x` and `origin/y` (project the
//   `origin` of the other sketch when its origin lies elsewhere).
// - `kind`: the kind of `entity`, `point`, `line`, `circle` or `arc`; a command checks it against
//   the source (get_sketch of the source and the query sketchSources list the kinds; the sketch
//   tool projectSketch fills it in).
// - `regions`: whether the projected curve bounds regions of this sketch, as an own curve that is
//   not construction does. A command may leave it out: then it is `false`, and the curve is
//   reference only, as a projected edge. `true` is refused on a point. The document always holds it.
// - The entry is the projected entity: `<id>` (a point, or the curve), and the points of a curve
//   are `<id>/a`, `<id>/b` (a line), `<id>/center` (a circle), `<id>/center`, `<id>/start`,
//   `<id>/end` (an arc, counter-clockwise from `start`; on a sketch whose normal is opposite to the
//   source's the ends swap, so it stays counter-clockwise here). Constrain own geometry to them;
//   a constraint needs one own operand.
// - The ends of projected curves that form regions join the curve ends at their place (within
//   1e-6 mm): those of other such projections, of any source, and the end of an own curve that
//   forms regions, unless two own ends there are not one point already. So eight entries projecting
//   a rounded rectangle close into one loop. An end that stays open is in `SketchResult.openEnds`.
// - The values follow the source at every recompute. When the source sketch is not evaluated before
//   this one, its entity is gone or is of another kind now (a circle trimmed into an arc), the
//   projection keeps its last values with the warning `brokenProjection`, and constraints on it
//   keep acting. A source curve with no extent (a line of no length, an arc whose end lies on its
//   centre) is `degenerateProjection`, likewise. The message of the warning says which.
// - A side face of an extrusion of a region bounded by a projected curve is named by the entry's ID
//   (`{ feature, role: 'side', curve: <id> }`).
// - One entry per entity of the source: a second one is refused, naming the first.
// - A projection that forms regions is never cut by the sketch tools. To get an outline they can
//   cut, draw own curves over the projections and hold them there: the sketch tool projectSketch
//   with `as: 'own'` does it in one batch.
export interface SketchProjection {
  type: 'sketch';
  sketch: Id;
  entity: Id;
  kind: 'point' | 'line' | 'circle' | 'arc';
  regions: boolean;
}

// A curve of an imported outline (D72), in the coordinates of its file, in millimetres. Positions
// are pairs `[x, y]` of numbers (never an expression).
// - `line`: from `a` to `b`, at least the length tolerance (1e-6 mm) long.
// - `circle`: `radius` at least the length tolerance.
// - `arc`: counter-clockwise from `start` to `end` about `center`; the two ends on one radius within
//   1e-9 mm per mm of the largest coordinate of the arc (at least 1e-9) and never more than 1e-7 mm;
//   `start` and `end` within 1.1e-6 mm of each other (the length tolerance and the 1e-7 an end may
//   move) are no arc (a whole turn is a `circle`). Every number is finite and within ±1e9.
// - `spline`: the control points of a spline of the sketch (CurveShape `spline`): 3 to 64, the first
//   again as the last closes it (then at least 4). Control points may stand at one place (a node
//   without a handle); the spline as a whole has an extent.
export type ImportedCurve =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; center: Vec2; start: Vec2; end: Vec2 }
  | { type: 'spline'; points: Vec2[] };

// An imported outline (D72): the curves of a drawing (a board outline, a laser-cut plate) stored in
// the entry and placed in the sketch. Reference geometry: fixed for the solver, so constraints and
// dimensions of the sketch may name its entities, a later sketch may project them, and nothing
// moves it but its own fields.
// - Usually not written by hand: the MCP tool import_outline reads a DXF or SVG file and sends the
//   command (without `sketch` it only reports what the file holds); the app has "Import an
//   outline…" in the panel of a sketch.
// - `curves`: the curves by their local ID (letters, digits, underscores, at most 32, and no name
//   every object has, such as `constructor`), 1 to 2000, their splines with at most 2000 control
//   points together. The readers number them by the kind the file gave and its order: `l1`, `l2`, …
//   lines, `a1` … arcs, `c1` … circles, `s1` … splines. Nothing after the reader renames a curve: one
//   the import left out (it lay on another, or had no extent) leaves its number unused, and an arc
//   of nearly a whole turn that was read as a circle keeps the ID of an arc (`a3` is then a circle:
//   the `type` of the curve says what it is, the letter what the file had).
// - IDs: the curve `<entry>/<local>` (`board/l3`); its points as an own curve of that kind names
//   them: `<entry>/<local>/a` and `/b` of a line, `/center` of a circle, `/center`, `/start`, `/end`
//   of an arc, and `/0`, `/1`, … the control points of a spline (a closed spline lists its first
//   point once). The entry itself is no entity. Two curves that meet have two points at one place.
// - `x`, `y`, `turn`: where the outline stands, numeric fields (`external/<entry>/x`, …: they take
//   expressions, and setField with the sketch as the feature changes one). The anchor of the
//   outline lands at (`x`, `y`) and the outline is turned about it by `turn` (rad, counter-clockwise).
// - `anchor`: which place of the file is put at (`x`, `y`): `origin`, the origin of the file (the
//   coordinates of the file are kept, a revised file moves nothing that did not move in it), or
//   `center`, the centre of the box of the curves (the outline stays centred when a revised file is
//   larger).
// - `regions`: whether the curves bound regions of the sketch as own curves that are not
//   construction do (default true: a board is extruded from its outline directly). Then the ends
//   of the curves join the curve ends at their place within 1e-6 mm, each other's and that of an own
//   curve that forms regions, and the side face of a curve is `{ feature, role: 'side', curve:
//   '<entry>/<local>' }`. With `false` the curves are reference only, as a projected edge.
// - A curve of an outline is never cut by the sketch tools, and a spline of it is no operand of a
//   constraint and is not projected. An own curve that crosses an outline that forms regions makes
//   the profile invalid for good: switch `regions` off and draw the outline as own curves in a
//   later sketch (the sketch tool projectSketch with `as: 'own'`), then cut that.
// - `name`: for people, the name of the file, at most 200 characters. An empty one is no name.
// - `readWith`: what the file was read with (the format, the layers, the unit, the weld), written by
//   the import and repeated by a replacement, so that a revised file is read as the first was; texts
//   of at most 200 characters, at most 100 layers.
// - A revised file: `updateExternal` with the new `curves` (the tool import_outline with
//   `replace`); fields left out of the update keep what the entry has. An entity keeps its ID when
//   the file lists it at the same place among the curves of its kind; nothing is matched by
//   geometry (the tool says which IDs a file gave to other curves). Refused while a constraint of
//   the sketch names an entity the new curves do not have, or one that changes its kind (the tool
//   takes `remove`, the constraints to remove in the same batch before it); a mirror or pattern of
//   the sketch, or a later feature, that names one becomes a broken reference (copies are lost with
//   a warning, a projection keeps its last place, an extrusion has no profile).
// - The values never fail: an outline has no source that can go away.
export interface SketchOutline {
  type: 'outline';
  name?: string;
  readWith?: OutlineReadWith;
  curves: Record<Id, ImportedCurve>;
  x: number;
  y: number;
  turn: number;
  anchor: 'origin' | 'center';
  regions: boolean;
}
// What an outline was imported with: the key of the format and its options as they were given
// (`layers`, `unit`, `weld`; one left out was the format's default).
export interface OutlineReadWith {
  format: string;
  layers?: string[];
  unit?: string;
  weld?: number;
}
// The input form of an outline in `addExternal`: the curves, and what a command may leave out with
// its default (`x`, `y`, `turn` 0; `anchor` `origin`; `regions` true). A numeric field may be an
// expression; `null` is no number. In `updateExternal` every field but `type` may be left out and then keeps what the
// entry has, an expression too; `curves` given replaces the stored outline whole. So the flag is
// switched, or the outline moved, without sending the curves again: `{ type: 'outline', regions:
// false }`. `name: ''` and `readWith: null` clear the two optional fields.
export interface OutlineInput {
  type: 'outline';
  name?: string;
  readWith?: OutlineReadWith | null;
  curves?: Record<Id, ImportedCurve>;
  x?: number | Expr;
  y?: number | Expr;
  turn?: number | Expr;
  anchor?: 'origin' | 'center';
  regions?: boolean;
}

// A mirror or a pattern of own geometry of the sketch (D68), an entry of `external` computed after
// the sketch is solved. The copies are derived geometry: drawn, forming regions and naming side
// faces as their sources, read by later features and sketches, but no constraint of this sketch can
// name them (they do not exist while it is solved). Constrain the sources; the copies follow.
// - `sources`: what is copied: own curves (a construction curve too: its copies are construction
//   curves and form no regions) and own points of the sketch, or `origin`; at least one, none
//   twice. A curve takes its points along: the copies of two curves that share a point share its
//   copy. Projected geometry, an axis of the origin and copies are no source. A command refuses an
//   ID that is not an own curve or point; a document may name one that was removed since: it is not
//   copied, and the sketch has the warning `brokenCopies`.
// - `transform`: how the copies stand (SketchTransform).
// - IDs: copy `n` of a source `s` is `<entry>/<n>/<s>` (a point `p` of a copied curve is
//   `<entry>/<n>/<p>`; `origin` is copied as `<entry>/<n>/origin`). A mirror has the copy 1; a row
//   and a circle number from 1; a grid numbers the copy i steps along the first direction and j
//   along the second `i + 1000 · j`, as a pattern of features does (D53). A copy number is an
//   entity whatever the count of the document (a count may be an expression): a reference to a copy
//   above the count is broken until the count reaches it.
// - A higher count adds copies and moves none of the others with a `spacing`, so the regions and
//   faces named by a copy stay; a lower count removes the highest, and what names them is a broken
//   reference. A feature that should follow the count names a region the copies lie in: a region is
//   named by its outer loop, so copies inside it are its holes and follow the count. A feature that
//   names the region of a copy names that copy.
// - A side face of a copy is `{ role: 'side', curve: '<entry>/<n>/<curve>' }` (its key quotes the
//   slashed ID: `lid/side/"m/1/c2"`).
// - A copy that occupies what a curve before it that forms regions occupies (its source, an own
//   curve, an earlier copy that kept its regions; a line on the axis of a mirror, a circle at the
//   centre of a circular pattern) forms no regions; it is still there under its ID. A half circle
//   whose ends lie on the axis is not such a copy: its image is the other half.
// - The ends of the copied curves join the ends of curves at their place (within 1e-6 mm): the ends
//   of other copies, of this entry or another, and the end of an own curve that forms regions,
//   unless two such own ends there are not one point already (then none). So a half drawn up to the
//   axis of a mirror closes with its image into one region, a chain whose end the pattern carries
//   onto its own start closes into a ring, and two mirrors about one axis close with each other.
//   Put the ends of a mirrored half on the axis by a constraint (`pointOnCurve` with the axis); an
//   end that stays open is named in the result of the sketch (`SketchResult.openEnds`).
// - The sketch tools never cut, extend, fillet or snap to a copy; a tool that changes a source
//   patches the entries that list it (the pieces in its place, the arc of a fillet or a notch that
//   closes the gap it opened), so the copies keep the shape of the source.
export interface SketchPattern {
  type: 'pattern';
  sources: Id[];
  transform: SketchTransform;
}

// How the copies of a sketch pattern stand: the transforms of D53 in the plane of the sketch.
// - `mirror`: one copy, the mirror image about the whole line `axis` (both ways): a line of the
//   sketch, own (a construction line too), projected, or an axis of the origin (`origin/x`,
//   `origin/y`). (A pattern of features has `plane` here; a sketch names a line.)
// - `linear`: `count − 1` copies shifted along the line `direction` (from its `a` to its `b`, a
//   line as for a mirror; `origin/x` points along +X) by `spacing` between neighbours or over
//   `length` between the source and the last copy; a negative span runs the other way. `second`
//   (a direction, a count and a span of its own) makes a grid: at most 200 places, the source
//   included, no two in one place.
// - `circular`: `count − 1` copies turned about the point `center` (own, `origin`, or a point of
//   projected geometry), counter-clockwise in the sketch: over the full circle (`span: { type:
//   'full' }`), or within `angle` between the source and the last copy (a negative angle turns
//   clockwise). (A pattern of features has `axis` here; a sketch names a point.)
// - The numeric fields, with the ranges of a pattern of features: `transform/count` (an integer
//   from 1 to 200, the source included; 1 makes no copies), `transform/span/spacing` and
//   `transform/span/length` (mm, not zero), `transform/span/angle` (radians, −2π to 2π, not zero),
//   and the same under `transform/second/`. Their addresses in the sketch are
//   `external/<entry>/transform/count` and so on: `setField` with the sketch as the feature changes
//   one, and a field takes an expression (`vents`, `deg(30)`).
// - `axis`, `direction` and `center` cannot be a copy. A command refuses one that is not a line
//   (a point) of the sketch; a document may name one that is gone: the entry then has no copies and
//   the sketch has the warning `brokenCopies`.
export type SketchTransform =
  | { type: 'mirror'; axis: Id }
  | { type: 'linear'; direction: Id; count: number; span: LinearSpan; second?: { direction: Id; count: number; span: LinearSpan } }
  | { type: 'circular'; center: Id; count: number; span: { type: 'full' } | { type: 'angle'; angle: number } };

// Každá varianta má pojmenované operandy s pevným významem.
// A line operand may be an axis of the origin, `origin/x` or `origin/y` (a driving constraint needs
// at least one own operand, as for any fixed entity), except in `midpoint` and `equalLength`.
export type Constraint = GeometricConstraint | Dimension;

export type GeometricConstraint =
  | { type: 'coincident'; a: Id; b: Id } // bod, bod
  | { type: 'pointOnCurve'; point: Id; curve: Id }
  | { type: 'horizontal' | 'vertical'; line: Id }
  | { type: 'parallel' | 'perpendicular' | 'equalLength'; a: Id; b: Id } // úsečky
  | { type: 'tangent'; a: Id; b: Id } // úsečka–kružnice/oblouk, nebo dvě kružnice/oblouky
  | { type: 'symmetric'; a: Id; b: Id; line: Id } // body a, b souměrně podle přímky úsečky (osy)
  | { type: 'midpoint'; point: Id; line: Id } // bod ve středu úsečky
  | { type: 'equalRadius'; a: Id; b: Id } // circles or arcs
  // The point lies at the coordinates of the sketch. `x` and `y` are numeric fields
  // (`constraints/<id>/x`, `constraints/<id>/y`), so they may be expressions and the point moves
  // with the parameters.
  | { type: 'fixed'; point: Id; x: number; y: number };

// A fixed point in a command may leave its coordinates out: the point is then fixed where it is.
export type FixedInput = { type: 'fixed'; point: Id; x?: number | Expr; y?: number | Expr };

export type DimensionShape =
  | { type: 'distance'; a: Id; b: Id } // bod–bod
  | { type: 'distancePointLine'; point: Id; line: Id }
  | { type: 'horizontalDistance' | 'verticalDistance'; a: Id; b: Id } // orientovaná: b − a
  | { type: 'angle'; a: Id; b: Id } // úsečky; od směru `a` ke směru `b`, proti směru hodin, radiány
  | { type: 'radius' | 'diameter'; curve: Id };

export type Dimension = { value: number; driving: boolean } & DimensionShape;

// ---------------------------------------------------------------- extrusion

export type PlaneRef =
  | { kind: 'base'; plane: 'XY' | 'XZ' | 'YZ' }
  | { kind: 'plane'; feature: Id } // PlaneFeature
  | { kind: 'face'; body: Id; face: FaceName };

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  profile: ProfileSource;
  extent: Extent;
  operation: 'new' | 'add' | 'cut';
  targets?: Id[]; // target bodies: none for new, exactly one for add, one or more for cut
}

// Where an extrusion takes its profile from: regions of a sketch, a profile generator, or a wall
// along curves of a sketch.
// `regions`: closed regions of the sketch, each named by the curves of its outer loop.
// - `offset` (numeric field `profile/offset`, millimetres, either sign, optional): the outline of
//   the selected regions moved by that much. Positive grows the profile: outer loops move outwards
//   and holes shrink. Absent means no offset. The field may be left out of a command and of the
//   document; `setField` reaches it also while the feature does not have it, and
//   `updateFeature` with `{ profile: { offset: null } }` removes it.
// - The outline is the boundary of the selected regions taken together: a curve shared by two
//   selected regions is not part of it, so a rectangle with circles inside it, all selected, is
//   offset as the plain rectangle.
// - Every curve of the outline maps to one curve: a line to a parallel line, an arc or a circle to
//   one with the same centre and another radius, joined to its neighbours where the two moved
//   curves meet (a mitre). Side faces keep their names (`side` with the curve) and their exact
//   surfaces; the origin of a sketch on a moved side face is the moved start of its line.
// - The topology of the outline never changes. The feature ends in the error `invalidProfile`,
//   with a message that names the curves and says what to do, when a curve vanishes or turns round
//   (an inward offset not smaller than a corner radius), when two moved neighbours do not meet,
//   when loops touch or cross after the offset or their nesting changes.
// `wall`: own curves of the sketch (lines, arcs, or one circle; construction curves included) that
// form one chain, moved by half the `thickness` to each side.
// - `curves` is stored sorted; the order of the chain follows from the joins: each curve joined to
//   the next at an end point (the same point, or points held together by a satisfied coincident
//   constraint), without a branch. An open chain gives one loop with a straight end at each free
//   end; a closed chain (a circle, a closed loop of lines and arcs) gives a band with a hole.
// - `thickness` is the numeric field `profile/thickness`, positive.
// - The source reads the solved curves only. It needs neither closed regions nor a valid profile
//   of the sketch, so the centre line of a rib is a construction line.
// - Corners are mitres and the errors are those of the offset (`invalidProfile`); curves that do
//   not form one chain are `invalidProfile` too, and a curve that is no longer in the sketch is
//   a `brokenReference`. A command verifies that each curve it adds is an own curve of the sketch.
// - Its faces are `wallSide` and `wallEnd` (see FaceName) and the two caps.
// `generated`: an entry of the generator catalog (GENERATORS) builds the loops. It has no offset.
// - `operands` are entities of the sketch by the names of the catalog (a gear: `circle`, the pitch
//   circle; it may be a construction circle or a projected one; a pulley: `center`, a point, also
//   `origin` or a point of projected geometry). A command verifies the operands the feature did not
//   have before; an operand removed later is a broken reference in the recompute.
// - `params` follow the catalog: numbers are numeric fields at `profile/params/<name>` and accept an
//   expression, flags are booleans. What a command leaves out gets the default of the catalog and is
//   stored, except an optional parameter (the `shift` of a gear), which is stored only when given and
//   whose absence is its default. A number without a default (the tooth count) is required.
// - `refs` are references to earlier features by the names of the catalog (a gear: `meshWith`).
export type ProfileSource =
  | { type: 'regions'; sketch: Id; regions: RegionRef[]; offset?: number }
  | { type: 'wall'; sketch: Id; curves: Id[]; thickness: number }
  | { type: 'generated'; generator: GeneratorName; sketch: Id; operands: Record<string, Id>; params: Record<string, number | boolean | string>; refs?: Record<string, Id> };

export type GeneratorName = 'involuteGear' | 'cycloidalDisc' | 'gt2Pulley'; // entries of the generator catalog

// A pattern repeats its source by a list of isometries (turns, shifts, a mirror). The kind of the
// transform is a variant: `circular` around an axis, `linear` along a direction, `mirror` in
// a plane (PatternTransform).
// - `features`: features that apply a tool: extrusions and revolves with the operation add or cut,
//   holes. For every copy the tool of each of them is built in the transformed position and
//   applied to the targets of that feature, in the order of the list. The features need not share targets; the
//   list lets a hole repeat with its pocket.
// - `body`: the body in the state before the pattern is copied as new bodies `<pattern>/<number>`,
//   numbered from 1 (a grid numbers its copies i + 1000 · j, with gaps: see PatternTransform; read
//   the IDs from `bodies` of the result, do not compose them by counting). A copy is a body like
//   any other: a sketch can stand on it, it can be cut and its edges projected.
// - `count` includes the original; 1 means the original alone. A mirror has no count and makes one
//   copy, number 1 (`<pattern>/1`; another number of a mirror is not a body a command may name).
//   The pattern is atomic: when any copy fails, the whole pattern is in error and the model stays
//   as it was before it.
// - A copy of a feature goes to the targets of its source; a copy of a body is the body as it is at
//   the pattern. What a mirrored body should have is therefore modelled before the mirror.
// - A change of the kind keeps the IDs of the copies and the tags of their faces: what referred to
//   copy 1 then refers to the copy of the new kind.
export interface PatternFeature extends FeatureBase {
  type: 'pattern';
  source: { type: 'features'; features: Id[] } | { type: 'body'; body: Id };
  transform: PatternTransform;
}

// A hole (D46): the same hole at every listed point of one sketch, along the normal of the sketch
// plane, cut out of the targets. One tool for all points, so a pattern repeats it like a cut.
// - `points`: points of the sketch that are not projected geometry (its own points or `origin`), at
//   least one, none twice. Their order does not matter; the faces are named by the point.
// - `shape`: what the hole looks like (HoleShape); every dimension is a numeric field
//   `shape/<name>` and takes an expression, so a print compensation is a parameter added in it.
// - `extent`: where the mouth is and how deep the hole goes (HoleExtent).
// - `targets`: one or more bodies, none twice, like a cut.
// - `label`: free text for people and for a parts list ("M3 countersunk screw"), not empty, at most
//   200 characters; the engine never reads a dimension from it. `updateFeature` with
//   `{ label: null }` removes it.
// - The query `hardwareHole` composes `shape` and `label` from the hardware catalogs (and the
//   depth of a hole for a heat-set insert); the document stores the numbers, not the size.
// - Errors: `invalidHole` (see ErrorCode), `brokenReference` (the sketch, a point or a target is
//   missing, or the plane `extent.from`), `nonPlanarFace` and `invalidExtent` from the start plane of
//   its extent (`refs: [from]`), `emptyResult` and `kernelFailure` as for a cut; the warning
//   `noEffect` names the targets the holes missed.
export interface HoleFeature extends FeatureBase {
  type: 'hole';
  sketch: Id;
  points: Id[];
  shape: HoleShape;
  extent: HoleExtent;
  targets: Id[];
  label?: string;
}

// A boolean of finished bodies (D56). The target is changed and keeps its ID, its place in the
// model, its properties and its link; the tools are used up or kept.
// - `operation`: `union` (the target with the tools joined to it), `difference` (the target less
//   the tools), `intersection` (what the target shares with every tool). With several tools the
//   operation is made with one after another, in the order of the list.
// - `target`: a body. `tools`: one or more bodies, none twice, none the target.
// - `keepTools`: false: the tool bodies leave the model with this feature; a later feature that
//   names one ends in `brokenReference`, and an entry of body properties or of a link that names
//   one is left without its body. True: they stay as they are (a motor subtracted from its mount
//   stays a body). There is no default.
// - `clearance` (numeric field `clearance`, mm, 0 or more, optional, only with `difference`): every
//   tool is subtracted moved outwards by that much, each face along its own surface, so the pocket
//   is wider than the tool by the clearance; the tool body itself does not change. Absent or 0
//   (also an expression that gives 0) is a plain difference. `setField` reaches it also while the
//   feature does not have it; `updateFeature` with `{ clearance: null }` removes it, and a patch
//   to another operation removes it by itself.
//   - The moved faces are exact surfaces; the pocket is exact between planar faces. A round face is
//     a polygon: there the pocket may be nearer to the tool than the clearance by the chord
//     tolerance, and next to an edge where a round face meets another at a slant by up to 0.15 of
//     the clearance more. An outer corner of the tool stays sharp. A face narrower than the chord
//     tolerance that only marks where two other faces cross (the crescent between a countersink
//     and its bore) has no face in the pocket.
//   - A tool that cannot be moved without a change of its shape is the error `invalidClearance`.
// - Faces. Without a clearance a face of the result keeps the name it had on the target or on the
//   tool; where a face of a tool lies flush on a face of the target and the two overlap, the
//   overlapped part carries the name of the tool's face (for an intersection: of the target's).
//   A face may then lie on two bodies, the target and a kept tool. With a clearance above 0 the
//   faces the tools leave on the target are new faces: the name of the face of the tool with
//   a copy tag appended, `{ pattern: <this feature>, index: <the number of the tool in `tools`,
//   from 1> }`. The number follows the place in `tools`.
// - Errors: `brokenReference`, `emptyResult` (nothing of the target would be left; for an
//   intersection: the target and a tool share nothing), `invalidClearance`, `kernelFailure` (the
//   kernel refused, or its result did not pass the checks of the engine: its volume against the
//   volumes of the two bodies and what they share, and no faces left back to back). The warning
//   `noEffect` names the tools that did not change the target; tools that are not kept leave the
//   model all the same. In error the feature changes nothing and no tool leaves.
export interface CombineFeature extends FeatureBase {
  type: 'combine';
  operation: BooleanOp;
  target: Id;
  tools: Id[];
  keepTools: boolean;
  clearance?: number;
}

// A split of a body by a plane (D56): a cut that keeps what it cuts off.
// - `body`: the body that is split. It keeps its ID, its properties and its link, and the part on
//   the other side of the plane than `side`.
// - `plane`: a base plane, a plane feature or a planar face of a body, as the plane of a sketch;
//   for a face the whole plane it lies in. Resolved in the state before the feature.
// - `side`: the part that becomes the new body with the ID of the feature: `forward` is the part
//   the normal of the plane points to (for a face: out of its body; XY: +Z, XZ: −Y, YZ: +X; a plane
//   feature: as its base), `backward` the other.
// - Where the plane passes through material, both bodies get the cut face `{ feature: <this
//   feature>, role: 'splitFace' }`, one name on two bodies; a sketch stands on it, with the normal
//   out of the body it stands on. A body of pieces on both sides of the plane is taken apart
//   without a cut face. A face of the body in the plane keeps its name, but where it is the
//   underside of an overhang and the plane also cuts material beside it, the part the cut face
//   lies on takes the name of the cut face.
// - Later features that name the body work on the part that keeps its ID, without a word: a
//   feature meant for both parts lists both bodies.
// - The new body takes after the body it was cut from (body properties, D48); it is in no link.
// - Errors: `brokenReference`, `nonPlanarFace`, `emptyResult` (the plane does not cut the body),
//   `kernelFailure`. In error the body stays whole and there is no new body.
export interface SplitFeature extends FeatureBase {
  type: 'split';
  body: Id;
  plane: PlaneRef;
  side: 'forward' | 'backward';
}

// ---------------------------------------------------------------- revolve

// A revolve (D58): a profile of a sketch turned about an axis that lies in the plane of the sketch.
// - `profile`: regions of the sketch (with an optional offset) or a wall along curves, as an
//   extrusion takes them; not a generated profile.
// - `axis`: an `AxisRef` that lies in the plane of the profile's sketch: its direction within
//   1e-4 rad of the plane and a point of it within 1e-6 mm; the line used is its projection into
//   the plane. A base axis serves a sketch on a base plane that holds it (Z for XZ and YZ); a line
//   of a sketch (`sketchLine`) serves any plane, best a construction line of the profile's own
//   sketch, or the line of the profile that lies on the axis (the diameter that closes a half
//   circle). A line drawn along an edge of the profile that is not construction overlaps it and
//   makes the sketch profile invalid.
// - The profile lies on one side of the axis; it may touch it in a point or along a curve that lies
//   on the axis (that curve makes no face). A ball is a half circle closed by a line on the axis.
// - `extent`: `full`, a whole turn (no caps); or `angle` from `start` (field `extent/start`,
//   radians, any value) by `angle` (field `extent/angle`, radians, not zero, strictly between −2π
//   and 2π; negative turns the other way). Both turn by the right-hand rule about the direction of
//   the axis; the profile of the sketch is at the angle 0, so with `start: 0` the start cap lies in
//   the sketch plane. A turn symmetric about the sketch plane is `start: "-a / 2"`, `angle: "a"`.
//   A whole turn is `full`, never an angle of 2π.
// - `operation`, `targets`: as for an extrusion (`new` has no target and makes the body with the ID
//   of the feature, `add` exactly one, `cut` one or more, none twice). A pattern repeats a revolve
//   with the operation add or cut.
// - Faces are named as for an extrusion of the same profile: `side` per curve (`wallSide`,
//   `wallEnd` for a wall); a line across the axis gives a plane, a line parallel to it a cylinder,
//   another line a cone, an arc or a circle a sphere when its centre lies on the axis and a torus
//   otherwise; a curve on the axis makes no face. A partial turn has the caps `startCap` and
//   `endCap`, planes through the axis.
// - The mesh is within the chord tolerance of the exact body: the profile and the turn are each
//   divided for half of it.
// - Errors: `brokenReference`, `noProfile`, `invalidProfile` (as for an extrusion; also a tool of
//   more than 1 000 000 triangles), `invalidAxis` (see ErrorCode), `emptyResult`, `kernelFailure`;
//   the warning `noEffect` names the targets the tool missed.
// The result tells in `facts`: `axisPoint` and `axisDirection` (the axis used, in model
// coordinates, the direction a unit vector) and `steps` (the turn is a polygon of that many sides).
export interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  profile: Exclude<ProfileSource, { type: 'generated' }>;
  axis: AxisRef;
  extent: { type: 'full' } | { type: 'angle'; start: number; angle: number };
  operation: 'new' | 'add' | 'cut';
  targets?: Id[];
}

// A chamfer or a fillet of edges of one body (D63). What both types share:
// - `body`: the body whose edges are chamfered or filleted. It keeps its ID; a feature that names it
//   later reads it with the new faces.
// - `edges`: at least one edge of that body, each named by its two faces as the query `body` lists
//   them (the order of the two does not matter), none twice. Each has to be:
//   - straight between two planar faces (kind `line`), the faces at more than 0.01 rad from flat
//     and from folded; or
//   - circular between two faces about one axis whose profile in a half plane through the axis is
//     a straight line: a plane across the axis, a cylinder, a cone (kind `circle`). Not a circle
//     with a sphere or a torus (the rim of a dome), not an edge of the kind `other`.
// - A convex edge (the material inside the angle of the faces) is cut, a concave one gets material
//   added; one feature may hold both, as long as a convex and a concave edge of it do not meet at
//   a vertex (put them into two features).
// - Where an edge ends: at another edge of the same feature that shares a face with it (smoothly;
//   at the same angle to the shared face, in their mitre; both straight and convex at a convex
//   corner of that face, each in the plane of the other's other face); at one planar face, whose
//   plane the chamfer or fillet ends in (an arc: a plane through its axis; planes flush in one
//   plane, a plate and a wall flush with its end, count as one); or it runs on smoothly
//   into the next edge of a face (a line of an outline with round corners into the arc of the
//   corner; also across a seam where both faces of the edge continue into flush faces), and that
//   next edge has to be in the same feature: the error names it. An arc that meets another edge of
//   the feature at an angle (the top loop of a D-shaped boss) is refused.
// - Run-outs (D67): an edge may also end at a round face C it crosses at 10° or more and run out
//   past it: a straight edge at a cylinder of any axis, an arc at a cylinder parallel to its axis
//   or at a plane parallel to its axis and off it (the side of a keyway); faces on one cylinder
//   count as one. The edge has to run, past its end, into what the tool does not change beyond C:
//   a convex edge into C's air (the rim of a bore into a pin pocket, an edge into a hole that breaks
//   it, a slot's edge out through a shaft's cylinder), a concave edge into C's material (the foot of
//   a rib into a boss). The tool runs on until its corner lies beyond C, so the chamfer or fillet
//   ends on C's surface; C keeps its name and loses what the run-out takes of it. Refused
//   (`unsupportedEdge`, C in `refs`): a stop (a convex edge into C's material: the top edge of a rib
//   into a taller boss; a concave edge into C's air: the foot of a rib flush with the rim of a
//   round plate); a bridge (the corner passes behind C before crossing it: a hole that notches the
//   edge less deep than the size; or the run-outs of two pieces reach across one gap); a crossing
//   under 10° or one that only grazes C; C a cone, a sphere, a torus, a swept or an imported face,
//   or (an arc) a cylinder or a plane not parallel to its axis; faces at the end on two surfaces
//   (the rim of a lobe under another lobe); an edge that runs on smoothly into an earlier fillet
//   along an edge of the kind `other`. Where C comes from a later feature, blending the edge
//   before that feature gives the same result. `blendDoesNotFit`: the run-out would take material
//   beyond C (a pin or a post in the void, a pocket shallower than the size) or, concave, add some
//   where C has none.
// - Faces: one new face per edge, `{ feature, role: 'chamfer' | 'fillet', edge: <the place of the
//   edge in `edges`, from 0> }`, exact: a plane (a chamfer of a straight edge; a sketch stands on
//   it, its origin where it meets the first face of the edge at the end the projection of the edge
//   calls `a`, Y along the edge), a cylinder (a fillet of one), a cone, a plane across the axis or
//   a cylinder (a chamfer of a circular edge), a torus (a fillet of one; a sphere where the centre
//   of its arc lies on the axis). Taking an edge out of the middle of the list renames the faces of
//   the edges after it. The two faces of the edge keep their names and get narrower; an end face
//   keeps its name and grows by what an added fillet leaves in its plane facing its way (more than
//   a sliver facing the other way is refused, see blendDoesNotFit).
// - Where three fillets meet at a vertex the corner is a crease (0.225 r proud of a rolling ball at
//   the corner of a box); three chamfers meet exactly.
// - The result tells in `facts`: `setback/<i>` (mm: how far from edge i the chamfer or fillet meets
//   each of its two faces) and `cut/<i>` (true where material was cut, false where it was added).
// - The feature creates no body and leaves no tool a pattern could repeat (a pattern of the body
//   copies the chamfers and fillets with it).
// - Errors: `brokenReference` (the body, or an edge it does not have, in `refs`), `unsupportedEdge`
//   and `blendDoesNotFit` (see ErrorCode), `invalidExpression` (the size), `importedTarget`,
//   `kernelFailure`. A feature in error changes nothing.
// A chamfer by one distance along both faces: the numeric field `distance`, mm, above 0.
export interface ChamferFeature extends FeatureBase {
  type: 'chamfer';
  body: Id;
  edges: EdgeName[];
  distance: number;
}
// A fillet of one radius: the numeric field `radius`, mm, above 0. It meets each face at the
// setback `radius / tan(β / 2)` from the edge, β the angle between the faces on the side of the
// fillet (`radius` for a right angle).
export interface FilletFeature extends FeatureBase {
  type: 'fillet';
  body: Id;
  edges: EdgeName[];
  radius: number;
}

// The shape of one hole, a variant by `type`. The wider part (the head) is at the mouth of the hole,
// where the extent starts. No field has a default.
// - `plain`: a cylinder of `diameter`.
// - `counterbore`: a cylinder of `headDiameter`, `headDepth` deep, then the bore of `diameter`.
// - `countersink`: a cone from `headDiameter` at the mouth down to the bore of `diameter`; `angle`
//   is the included angle of the cone (radians, between 0 and π; `deg(90)` for a cone of 90°). The
//   depth of the cone follows: (headDiameter − diameter) / 2 / tan(angle / 2).
// - `nutPocket`: a hexagon `acrossFlats` wide and `headDepth` deep, then the bore. `rotation` is the
//   angle of one corner of the hexagon from the X axis of the sketch, counter-clockwise.
// The head has to be wider than the bore (for a nut pocket the bore has to fit between the flats).
export type HoleShape =
  | { type: 'plain'; diameter: number }
  | { type: 'counterbore'; diameter: number; headDiameter: number; headDepth: number }
  | { type: 'countersink'; diameter: number; headDiameter: number; angle: number }
  | { type: 'nutPocket'; diameter: number; acrossFlats: number; headDepth: number; rotation: number };

// The extent of a hole: two of the variants of a cut, without a taper and without `upTo`.
// - `distance`: `start` is the offset of the mouth from the sketch plane (or from `from`) along the
//   normal of the sketch plane; `distance` is the depth of the whole hole, head included, and its
//   sign is the direction. For a sketch on a face the normal points out of the body, so a hole into
//   it has a negative distance.
// - `throughAll`: from the mouth through all targets, `forward` or `backward` (not `both`: a hole
//   has a mouth). The mouth is the sketch plane, or the plane `from`. The depth of the hole is then
//   how far the targets reach from the mouth on that side; the tool is longer by the overshoot of
//   every "through all".
// - `from` (optional, D66): the mouth starts from this plane instead of the sketch plane, as for the
//   extent of an extrusion (see Extent): the top of a part whose sketch is at the bottom is `from`
//   that face, through all `backward`, and the head of a counterbore is at the top.
// The result tells in `facts`: `depth`, the depth of the whole hole in mm for the feature itself
// (for "through all" measured from the mouth on the meshes of the targets, so with their float32
// rounding), `headDepth`, the depth of the head (absent for a plain hole), and with `from`
// `startLevel`, the level of the mouth along the normal of the sketch plane, from the sketch plane.
export type HoleExtent = { type: 'distance'; from?: PlaneRef; start: number; distance: number } | { type: 'throughAll'; side: 'forward' | 'backward'; from?: PlaneRef };

// A stored mesh placed as a body (D55): a bought or given part to design around.
// - `mesh`: a key of the section `meshes`. A command that sets it checks that the section has it;
//   a load checks its form only, and a mesh that is not there is the error `brokenReference` of
//   the feature with `refs: [{ mesh: <id> }]`.
// - The body has the ID of the feature and one face, `{ feature, role: 'mesh' }`, for the whole
//   surface, with a surface published as `general`: no sketch or plane stands on it
//   (`nonPlanarFace`), it has no edges, and no extrusion, hole or pattern of them may have it, or
//   a copy of it, as a target, nor a combine as its target or a tool, nor a split as its body (the
//   error `importedTarget` of that feature). It takes part in the
//   collisions, the gap, the mass, a pattern of a body and the exports like any body; its surface
//   counts as round in the collisions.
// - It is not a reference part by itself: a bought part is made one by the same batch with
//   setBodyProperties (`use: 'reference'` and the `mass` of its data sheet).
// - `facts` of the result: `origin`, `axisX`, `axisY`, `axisZ`, where the origin of the mesh is in
//   the model and where its three axes point (unit vectors).
// - Errors: `brokenReference` (the mesh; the frame), `nonPlanarFace` (the frame is a face that is
//   not planar), `invalidExpression` (a field of the placement).
export interface MeshFeature extends FeatureBase {
  type: 'mesh';
  mesh: Id;
  placement: BodyPlacement;
}

// Another document inserted as a part (D62): the bodies at the end of its timeline, recomputed from
// its features with the parameters this feature sets, placed as one rigid piece.
// - `document`: a key of the section `documents`. A command that sets it checks that the section
//   has it; a load checks its form only, and a document that is not there is the error
//   `brokenReference` with `refs: [{ document: <id> }]`.
// - `placement`: where the origin and the axes of the inserted document stand (as for a mesh
//   feature: a frame, three offsets, three turns; numeric fields `placement/x` … `placement/rz`).
// - `parameters`: values for parameters of the inserted document by their names, each a numeric
//   field `parameters/<name>` (no unit: the inserted document gives the value its meaning) that
//   takes an expression over the parameters of this document. The value replaces the expression of
//   that parameter in the inserted document for this insertion only; what depends on it there
//   follows. A command that adds a name the stored document does not have is invalid; a stored
//   document replaced since without it is the error `brokenReference` with
//   `refs: [{ parameter: <name> }]`. `updateFeature` merges the values key by key and `null`
//   removes one (the parameter is the document's own again); `setField` changes a value that is
//   set. The parameters of the inserted document cannot be read by expressions of this one.
// - `bodies`: which bodies of the inserted document come in, by their IDs there (not empty, no ID
//   twice); without it every body at the end of its timeline, in its order. A listed body the
//   inserted document does not have with these parameters is the error `brokenReference` with
//   `refs: [{ body: <id there> }]`. `null` in a patch removes the list.
// - The bodies are `<feature>/<ID there>`: `bearing/ring`, `kit/screws/2`, `kit/b/ring` for a body
//   of a document inserted into the inserted one. No body has the ID of the feature alone.
// - Every face keeps its name with the feature IDs prefixed (see `FaceName`), with its exact
//   surface: a sketch, a plane, a placement or an extent may stand on a planar face of an inserted
//   body, an edge of one may be projected, and features of this document may change it like any
//   body (a body with a face of an imported mesh stays `importedTarget`).
// - The stored document is recomputed with the settings of this document (its chord tolerance),
//   so an inserted part is divided as finely as what it meets. Two insertions of one stored
//   document whose parameters evaluate alike share one recompute, so their bodies are one shape
//   (one row of the parts list).
// - Body properties of an inserted body come from what the inserted document states for it
//   (colour, material, use, and the density and mass as a pair, resolved with the values of this
//   insertion) unless an entry of this document states them. Without a name of its own it is named
//   after the insertion: its name alone when `bodies` lists one body, else
//   `<name of the insertion> / <its name there>`. The parts list names it by its part name there.
// - `facts` of the result: `origin`, `axisX`, `axisY`, `axisZ`, as for a mesh feature.
// - Errors: `brokenReference` (the document, a parameter, a listed body, the frame), `nonPlanarFace`
//   (the frame), `invalidExpression` (a field), `emptyResult` (the inserted document has no body to
//   bring). Warning: `insertedIssues`.
export interface InsertFeature extends FeatureBase {
  type: 'insert';
  document: Id;
  placement: BodyPlacement;
  parameters?: Record<string, number>;
  bodies?: Id[];
}

// ---------------------------------------------------------------- placement

// A directed frame of the model: a plane as a sketch refers to one (a base plane: XY is (+X, +Y,
// +Z), XZ is (+X, +Z, −Y), YZ is (+Y, +Z, +X); a plane feature; a planar face of a body, with the
// frame a sketch on that face has, its normal out of the body), or a point of a sketch: the frame
// of the sketch moved to the point (an own point, `origin`, or a point of projected geometry).
export type FrameRef = PlaneRef | { kind: 'sketchPoint'; sketch: Id; point: Id };

// Where a part with a frame of its own stands: its origin and axes laid on `frame`, then turned and
// shifted in that frame.
// - `x`, `y`, `z` (mm): the offset of the origin of the part along the X axis, the Y axis and the
//   normal of the frame. The frame of a face is the one a sketch on that face has, and its X may
//   run against an axis of the model; the facts of the feature say where the part ended up.
// - `rx`, `ry`, `rz` (rad, each within ±2π): turns about the X axis, the Y axis and the normal of
//   the frame, in this order, the axes staying where they are, by the right-hand rule (roll, pitch
//   and yaw, `rpy` of URDF).
// - A point p of the part ends at O + B · (Rz(rz) · Ry(ry) · Rx(rx) · p + (x, y, z)), with O the
//   origin of the frame and B its axes (X, Y, normal) as columns. No scale, no mirror.
// - The six numbers are optional numeric fields (`placement/x` … `placement/rz`): absent means 0
//   and is not stored; setField reaches one the feature does not have, `updateFeature` with
//   `{ placement: { x: null } }` removes one. The frame is a reference and is replaced whole.
export interface BodyPlacement {
  frame: FrameRef;
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

// The transform of a pattern, a variant by `type`; each variant lists its fields, and a field of
// another variant is an invalid command. A patch with another `type` replaces the transform and
// has to be complete.
// - `circular`: copies turned around `axis`. `full`: the step is 2π / count. `angle` (field
//   `transform/span/angle`): the angle between the first and the last copy, so the step is
//   angle / (count − 1); it may be negative.
// - `linear`: copies shifted along `direction`, an axis of which only the direction is used (a base
//   axis points along its positive half; the normal of a sketch plane, which for a sketch on a face
//   points out of the body; the point does not matter, `origin` will do). `count` as for
//   `circular`. The span, both in mm and not zero, negative against the direction:
//   - `spacing` (field `transform/span/spacing`): copy k is shifted by k · spacing, so a larger
//     count adds copies at the far end and moves none (prefer it when something refers to a copy);
//   - `length` (field `transform/span/length`): the distance between the original and the last
//     copy, so the step is length / (count − 1); a change of the count moves every copy.
//   `second` (optional) makes a grid (D53): the row of the first direction is repeated along
//   a second direction with its own `direction`, `count` and `span`, each as in the first
//   (numeric fields `transform/second/count`, `transform/second/span/spacing`,
//   `transform/second/span/length`); without it the pattern is a row. The places are the pairs
//   (i, j), i steps along the first direction and j along the second; (0, 0) is the original. The
//   copy at (i, j) has the number i + 1000 · j: the row of the original keeps the numbers 1 …
//   count − 1 of a row, the second row is 1000, 1001, …, the third 2000, …. A number does not
//   depend on the counts, so with spacings a larger count adds copies and moves none; the numbers
//   have gaps, and `bodies` of the result lists the copies that exist, in the order of their
//   numbers (row by row, the order they are applied in). The recompute refuses, as the error
//   `invalidPattern`, a grid of more than 200 places (count × second count, the original included)
//   and a grid of which two places would be one place (whole numbers of steps along parallel
//   directions that reach the same place, such as the steps 5 and 5, 5 and 10, 5 and −5; a step
//   below 1e-6 mm; directions a hair apart). `{ second: null }` in `updateFeature` makes a row
//   again; a new linear pattern without a grid leaves `second` out.
// - `mirror`: one copy, the mirror image in `plane` (a base plane, a plane feature or a planar face
//   of a body, as the plane of a sketch; for a face the whole plane it lies in), resolved in the
//   state before the pattern. A plane of symmetry is a base plane or a plane feature offset by an
//   expression (`offset: "L / 2"`). Errors: `brokenReference` and `nonPlanarFace` with the plane in
//   `refs`. The copy is the mirror image as a set of points; its face names are those of the source
//   faces with the tag of the copy (see FaceName), and a sketch on one of its faces has a
//   right-handed frame of its own, not the image of a sketch on the source face.
export type PatternTransform =
  | { type: 'circular'; axis: AxisRef; count: number; span: { type: 'full' } | { type: 'angle'; angle: number } }
  | { type: 'linear'; direction: AxisRef; count: number; span: LinearSpan; second?: { direction: AxisRef; count: number; span: LinearSpan } }
  | { type: 'mirror'; plane: PlaneRef };
// The span of a direction of a linear pattern.
export type LinearSpan = { type: 'spacing'; spacing: number } | { type: 'length'; length: number };

// An axis: a base axis of the model, the normal of a sketch plane led through a point of the
// sketch (an own point, the origin or a point of projected geometry), or a line of a sketch
// (`sketchLine`: an own line, construction or not, a projected line, or an axis of the origin of
// the sketch, `origin/x` or `origin/y`, along +X or +Y of the sketch through its origin). The axis
// of a line runs through its point `a` in the direction from `a` to `b` (`<line>/a` to `<line>/b` for a projected
// one), so a positive angle turns by the right-hand rule about that direction. A line whose ends
// are not more than 1e-6 mm apart is the error `invalidAxis` of whoever uses it; a projected line
// whose edge is gone keeps its last valid place. A projected line takes its sense from the outward
// normals of the two faces of its edge in the order of their names (n_a × n_b).
// `face` (D60): the axis of a round face of a body: a cylinder (a bore, a pin, a boss), a cone
// (a countersink, a tapered boss) or a torus (a revolved round): the line of its exact surface
// through its origin, apex or centre. Its sense is the one its build gives the face: for an
// extrusion (tapered or not) and a hole the normal of its sketch (out of the body for a sketch on
// a face, so a joint about a bore drilled from the top turns counter-clockwise seen from above),
// for a revolve the direction of its axis; a mirrored copy has the mirror image. The body and the
// face are named as for a sketch on a face. A face not on the body in the state is
// `brokenReference`; a face that is not round (a plane, a sphere, a swept or general surface) is
// `invalidAxis`. In a query of a posed model the axis moves with its body, as the frame of a face
// does; every other kind (a `sketchLine` projected from an edge of that body too) stays as modelled.
export type AxisRef =
  | { kind: 'base'; axis: 'X' | 'Y' | 'Z' }
  | { kind: 'sketchPoint'; sketch: Id; point: Id }
  | { kind: 'sketchLine'; sketch: Id; line: Id }
  | { kind: 'face'; body: Id; face: FaceName };

// Rozsah vysunutí. `start` je posun začátku od roviny skici ve směru její normály; `distance` se
// měří od začátku, kladná míří ve směru normály a nesmí být nula.
// `throughAll` is for a cut only: the tool passes through all targets. `forward` is along the normal
// of the sketch plane, `backward` against it, `both` on both sides; for a sketch on a face the
// normal points out of the body, so an ordinary hole is `backward`. The length is taken from the
// extent of all targets together along the normal, in the state the tool is applied to, plus an
// overshoot. A target that lies entirely on the other side is not changed and the `noEffect`
// warning names it.
// `taper` (field `extent/taper`, radians, strictly between −π/2 and π/2, optional: absent means
// none) is the angle between a side face and the direction of the extrusion. The profile of the
// sketch (with its `profile/offset`) holds at the start of the extent; the profile at its end is
// that one moved by |distance| · tan(taper) with the rule of the offset. Positive widens away from
// the start whichever way `distance` points (outer loops grow, holes shrink), as a positive offset
// does; negative narrows. Uses: a draft on a rib `deg(-2)`; a roof that prints without support
// `deg(-45)`; a countersink cut from the face the head sits in, with a negative `distance` (into
// the body) and a negative taper of half the included angle of the cone; a chamfer of the bottom
// edge against elephant foot, a slab with `profile/offset: -c`, `distance: c` and `deg(45)`. The
// side of a line is a tilted plane, the side of an arc or a circle a cone; the faces keep the names
// of the straight extrusion. Not with a generated profile.
// `upTo` (D47): the tool starts at `start` (as for a distance) and ends in a plane: `plane` is a base
// plane, a plane feature or a planar face of a body, referred to as a sketch refers to its plane.
// - For a face it is the whole plane the face lies in: the tool ends there also where its profile
//   passes beside the face. The plane may be tilted against the sketch plane; the end cap then lies
//   in it and the length differs from point to point. The sides keep the names of a straight
//   extrusion.
// - There is no side: the tool runs from its start to the plane on whichever side of the start the
//   plane lies, and the result says which and how far (`facts`: `lengthMin`, `lengthMax`, `forward`,
//   lengths along the normal of the sketch plane in mm, positive; `forward` true when the tool runs
//   along the normal).
// - `gap` (field `extent/gap`, mm, optional: absent means none): the plane is taken moved that far
//   towards the start, measured across the plane, so the tool stops short of it; a negative gap
//   passes it by as much. A gap never turns the tool round.
// - The plane is resolved at every recompute, in the state before the feature, so the length
//   follows the model; a copy made by a pattern of features runs from its own start to that same plane (a pattern of a
//   body copies the body as it is).
// - Errors: `brokenReference`, `nonPlanarFace` (the face is not planar), `invalidExtent` (the plane
//   is parallel to the direction of the extrusion or within 0.01 rad of it; it passes through or
//   touches the start of the tool; the gap reaches the start). For every operation; no taper.
// `from` (optional, D66, on every variant): the plane the extent starts from instead of the sketch
// plane. A base plane, a plane feature or a planar face of a body, referred to as a sketch refers to
// its plane; for a face it is the whole plane the face lies in (the profile need not lie over it).
// - `start` keeps its meaning, now measured from `from`: the offset along the normal of the sketch
//   plane (not of the face; its sign means what it means without `from`). The tool starts at the
//   effective start, the level of the plane plus `start`, and lies in the plane only when `start` is
//   0; `distance` is measured from there. `{ from: <the top of the plate>, start: 0, distance: 12 }`
//   is a boss on the plate; `{ from: <the top>, start: -0.6, distance: -3 }` a cavity under a skin of
//   0.6.
// - The plane has to be parallel to the sketch plane: its level may differ over the outline of the
//   profile at the start by no more than 1e-6 mm. A tilted plane is refused (`invalidExtent`); put
//   the sketch on that face instead, or start from a plane parallel to the sketch.
// - `upTo` runs from the effective start to its plane, and its refusals apply to the effective
//   start (`from` equal to `plane` with `start: 0` passes through the start; with `start: -2` it is
//   a tool 2 mm long); `lengthMin` and `lengthMax` are measured from it.
// - `throughAll` with `from` goes `forward` or `backward` only, from the plane through all targets
//   on that side; `both` with `from` is an invalid command (both sides of any start are all of the
//   targets).
// - The plane is resolved at every recompute, in the state before the feature, so the start follows
//   the face when the model changes. A copy made by a pattern of features carries its start with it,
//   as it carries its sketch plane: it starts at the image of the face (a boss mirrored in the middle
//   plane of its plate starts at the underside), not at the face itself. The end of `upTo` does not
//   move with a copy, so a post from the top of a plate up to a lid, mirrored in the middle plane of
//   the plate, starts at the underside and runs up through the plate to the lid.
// - The result tells the effective start in `facts.startLevel` (mm along the normal of the sketch
//   plane, from it), only with `from`.
// - Errors with `from` in `refs`: `brokenReference` (the plane, the body or the face is not in the
//   state before the feature), `nonPlanarFace`, `invalidExtent` (the plane is within 0.01 rad of the
//   direction, or tilted against the sketch plane; the message says which and by how much).
// - `updateFeature`: `{ extent: { from: <ref> } }` sets or replaces it, `{ extent: { from: null } }`
//   removes it (also where the extent has none).
export type Extent =
  | { type: 'distance'; from?: PlaneRef; start: number; distance: number; taper?: number }
  | { type: 'throughAll'; side: 'forward' | 'backward' | 'both'; from?: PlaneRef }
  | { type: 'upTo'; from?: PlaneRef; plane: PlaneRef; start: number; gap?: number };

// ---------------------------------------------------------------- jména

// `curve` of a side face is the ID of the sketch curve it came from; for a generated profile it is
// the name of the side from the generator catalog (a gear: `teeth`).
// A face of a copy made by a pattern carries `copy`: the pattern and the number of the copy (from
// 1); for a pattern of a pattern the list grows, the latest pattern last. Faces of the original
// have no `copy`. A reference to a face of a copy is also a reference to every pattern in the list.
// A face of a mirrored copy (the pattern `mirror`) is named after the source face it is the image
// of: what a name tells by a sense of rotation is reversed in it (the `wallSide` `left` lies on the
// right of the image of its curve, the `holeFlat`s run clockwise), and the ends of a projected line
// of any copy are read from the sketch, not derived from the source.
// The faces of a wall (a profile of the type `wall`): every curve of the chain makes two side
// faces, so `side` with the curve would name both.
// - `wallSide`: `side` is the side of the curve in the curve's own direction: a line from its point
//   `a` to `b`; an arc and a circle counter-clockwise, so `left` is the side of the centre. It does
//   not depend on the order of `curves` or on the end the chain is walked from.
// - `wallEnd`: the straight end of an open chain; `point` is the sketch point the chain ends at, as
//   the end curve names it (`a`, `b`, `start` or `end` of the curve).
// The faces of a hole (a feature of the type `hole`) are named by what they are and by the point,
// so the bore keeps its name when a plain hole becomes a counterbore:
// - `holeBore`: the bore at the point (a cylinder).
// - `holeHead`: the side of the head at the point: the cylinder of a counterbore, the cone of
//   a countersink.
// - `holeFlat`: one side of the hexagon of a nut pocket (a plane). `flat` counts from 1,
//   counter-clockwise, starting at the corner `rotation` points to.
// - `holeSeat`: the planar step between the head and the bore of a counterbore or a nut pocket.
//   The seats of all points of one feature lie in one plane and are one face, as the caps are.
// - The mouths are `startCap` and the bottoms `endCap`, one face each for all points.
// The face of an imported mesh (a feature of the type `mesh`): `mesh`, one face for the whole
// surface, not planar, without edges.
// A face of a body an insertion brought (a feature of the type `insert`, D62) keeps the name it has
// in the inserted document with every feature ID in it prefixed by `<insertion>/`: `feature`, and
// `pattern` of every copy tag. The fields of the role (a curve, a point) stay as they are. Tags of
// patterns of this document that copy the body afterwards come after them, unprefixed:
//   { feature: 'ring', role: 'side', curve: 'outer' }      in the document `bearing`
//   { feature: 'b1/ring', role: 'side', curve: 'outer' }   inserted by the feature `b1`
//   { feature: 'kit/b/ring', role: 'endCap', copy: [{ pattern: 'kit/b/p', index: 1 }] }
//                                                          two levels down, copied by `p` there
// The owner of a prefixed ID (the part before the first slash) must be an insertion before the
// referring feature; whether the face is there is the recompute's question, as for every face.
export type FaceName = (
  | { feature: Id; role: 'side'; curve: Id } // z křivky skici
  | { feature: Id; role: 'startCap' } // víko na začátku rozsahu (při nulovém posunu v rovině skici); of a revolve: the profile at the start of a partial turn
  | { feature: Id; role: 'endCap' } // protější víko
  | { feature: Id; role: 'wallSide'; curve: Id; side: 'left' | 'right' }
  | { feature: Id; role: 'wallEnd'; point: Id }
  | { feature: Id; role: 'holeBore'; point: Id }
  | { feature: Id; role: 'holeHead'; point: Id }
  | { feature: Id; role: 'holeFlat'; point: Id; flat: number }
  | { feature: Id; role: 'holeSeat' }
  | { feature: Id; role: 'mesh' }
  | { feature: Id; role: 'splitFace' } // the face a split cuts, on both bodies (D56)
  | { feature: Id; role: 'chamfer'; edge: number } // the face of a chamfer of the edge at that place of `edges`, from 0 (D63)
  | { feature: Id; role: 'fillet'; edge: number } // the face of a fillet of the edge at that place of `edges`, from 0 (D63)
) & { copy?: CopyTag[] };

// `pattern` names the feature that made the copy: a pattern, or a combine with a clearance, whose
// tag numbers the tool whose moved face it is (D56); the field keeps its name.
export interface CopyTag {
  pattern: Id;
  index: number;
}

// a < b v lexikografickém pořadí zápisu feature/role/curve (with `@pattern:index` appended for every copy tag)
export interface EdgeName {
  a: FaceName;
  b: FaceName;
}

// ID křivek na vnější hranici oblasti, seřazená
export interface RegionRef {
  outerLoop: Id[];
}

// ---------------------------------------------------------------- porty

export interface SketchSolver {
  solve(input: SolveInput): SolveResult;
}

export interface SolveInput {
  points: Record<Id, Point2>; // počáteční odhad
  radii: Record<Id, number>; // počáteční odhad poloměrů kružnic
  curves: Record<Id, Curve>; // včetně promítnutých křivek
  constraints: Record<Id, Constraint>;
  fixed: Id[]; // body, které se nehýbou, a kružnice s pevným poloměrem
  drag?: { point: Id; target: Point2 };
}

export interface SolveResult {
  status: 'solved' | 'conflict' | 'failed';
  points: Record<Id, Point2>;
  radii: Record<Id, number>;
  degreesOfFreedom: number; // 0 = plně určená; při konfliktu bez významu
  conflicting: Id[]; // vazby v konfliktu
  redundant: Id[];
}

export interface Solid {
  positions: Float32Array; // xyz
  triangles: Uint32Array; // indexy vrcholů
  faceIds: Uint32Array; // číslo stěny pro každý trojúhelník
}

export type BooleanOp = 'union' | 'difference' | 'intersection';

// A mesh the kernel computed and did not verify (D50). The field is named so that reading it says
// what the reader takes on: the mesh is measured (a volume, a depth) and is never a body of the
// model, the input of another operation of the kernel, or something an export writes.
export interface ComputedMesh {
  unverified: Solid;
}

export interface SolidKernel {
  // Vyhodí výjimku, když výsledek není uzavřené těleso; engine ji ohlásí jako `kernelFailure`.
  // A union and a difference take operands that share no face number (D56); an implementation
  // throws for such operands. An intersection may share them.
  boolean(op: BooleanOp, a: Solid, b: Solid): Solid;
  // 2D polygon s dírami; vrací trojice indexů do vrcholů všech smyček za sebou
  triangulate(loops: Float64Array[]): Uint32Array;
  // What two solids share as the kernel computes it, for measuring only (D50): the collisions ask
  // it when `boolean('intersection', a, b)` threw, and it may only clear a pair. What an
  // implementation guarantees:
  // 1. The common part of the two solids as computed, with nothing done to it: no faces moved
  //    before, nothing welded, dropped, split or repaired after.
  // 2. What the two solids share is in the mesh: every part of their common volume thicker than
  //    the precision of their coordinates (a millionth of the largest coordinate of the two, and
  //    of a millimetre at least). The mesh may hold more than they share, never less.
  // 3. It is closed by its indices: every edge is in two triangles, once each way, so every
  //    connected piece has a volume. Two solids that are apart give a mesh without triangles.
  // 4. Every triangle carries the number of the face of `a` or `b` it comes from.
  // 5. The same input gives the same output.
  // 6. It throws for an input `boolean` throws for, when the library reports an error, and when
  //    the mesh would not keep guarantee 3; never because the mesh is not clean.
  // Not guaranteed, as `boolean` guarantees it: that the mesh is a solid (it may hold unjoined
  // vertices at one place, triangles without an area, sheets where faces coincide, slivers
  // thinner than the precision, pieces that touch along an edge or at a vertex, and pieces of
  // noise that are inside out); a tolerance for faces in one plane; that another operation of the
  // kernel takes it; the same answer with `a` and `b` swapped. A kernel whose intersection is
  // exact may return that result here.
  intersectionAsComputed(a: Solid, b: Solid): ComputedMesh;
}

// A compressor of bytes into a raw DEFLATE stream (D54): the format of RFC 1951 with no zlib or
// gzip wrapper, which is what the compression method 8 of a ZIP holds (.ZIP File Format
// Specification 6.3.10, 4.4.5 and 5.5) and the one method besides storing that a 3MF package may
// use (3MF core 1.4.0, 1.1; Open Packaging Conventions 7.3.6). The writer of the engine
// (`export/zip.ts`) gives it the bytes of a file; nothing else of the engine calls it. What an
// implementation guarantees:
// 1. The result is one complete stream that an inflater turns back into exactly `bytes`, and that
//    ends with its last block: nothing follows it. For every input, also one with no bytes.
// 2. The same input gives the same output, wherever the implementation runs (Node, a browser):
//    the engine is deterministic and a file of the app is the file of the server.
// 3. `bytes` is not changed and not kept. The result is a new array that the caller owns.
// 4. It is synchronous, as an export is.
// 5. It throws when it cannot compress; the writer of the engine turns that into `failed`.
// Not guaranteed: that the stream is shorter than the input (the writer stores an entry whose
// stream is not), any particular level, and that two implementations give the same stream.
export interface Deflater {
  deflate(bytes: Uint8Array): Uint8Array;
}

// ---------------------------------------------------------------- přepočet

export interface Frame {
  origin: Vec3;
  x: Vec3;
  y: Vec3;
  normal: Vec3;
}

// What a face is, exactly: the surface it lies on. It follows from the definition of the feature
// that made the face, not from the mesh.
// - A sketch can stand only on a plane.
// - A cylinder comes from an arc or a circle of a profile; a cone from a taper, a countersink or
//   a revolved line; a sphere and a torus from a revolved arc or circle; a swept surface (a planar
//   curve moved along `axis`) from gear teeth; a general surface says nothing more.
// - A surface has no side: `normal` of a plane and `axis` of a cylinder carry no sign. Which side the
//   material is on belongs to the face of a body. The exception is `axis` of a cone, which points
//   from the apex towards the face, because a cone has two halves.
// - `torus`: `center` is a point of its axis, `minorRadius` the radius of the tube and
//   `majorRadius` the distance of the centre of the tube from the axis, signed: in every half plane
//   through the axis that the face lies in, the centre of the tube is the point `majorRadius` from
//   the axis towards that half plane (positive), or across the axis from it (negative: a face
//   swept by an arc whose centre lies across the axis, an ogive or a lemon).
export type Surface =
  | { kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { kind: 'cylinder'; origin: Vec3; axis: Vec3; radius: number } // origin: a point of the axis
  | { kind: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number } // radians, between the axis and the surface
  | { kind: 'sphere'; center: Vec3; radius: number }
  | { kind: 'torus'; center: Vec3; axis: Vec3; majorRadius: number; minorRadius: number }
  | { kind: 'swept'; axis: Vec3 }
  | { kind: 'general' };

export interface Evaluation {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, BodyResult>; // stav po poslední vyhodnocené feature
  faceNames: FaceName[]; // společná tabulka, index = číslo stěny
  faceSurfaces: Surface[]; // the surface of every face, index = number of the face, like `faceNames`
  parameters: Record<string, ParameterResult>; // values and errors of parameters
  checks: Record<string, CheckResult>; // check results by name
  bodyProperties: Record<Id, BodyPropertiesResult>; // by body of the state, in the order of `bodies`
  mechanism: MechanismResult; // the mechanism resolved against this state
  meshes: Record<Id, MeshResult>; // what the stored meshes are, without their data (D55)
  documents: Record<Id, StoredDocumentResult>; // what the stored documents are, without a recompute (D62)
}

// A stored document as the evaluation describes it (D62), without recomputing it: the bodies an
// insertion brought are in the result of its feature (`FeatureResult.bodies`).
// - `parameters`: its parameters with their expressions and values (its own, without the values an
//   insertion sets); no `value` when the expression does not evaluate there.
// - `features`: the number of features of its timeline.
// - `usedBy`: the features of the type `insert` that insert it, in the order of the timeline,
//   suppressed ones included.
export interface StoredDocumentResult {
  name?: string;
  parameters: { name: string; expr: Expr; value?: number }[];
  features: number;
  usedBy: Id[];
}

// A stored mesh as the evaluation describes it, without its data (D55). Every number but `usedBy`
// is computed once per entry of the section.
export interface MeshResult {
  name?: string;
  vertices: number;
  triangles: number;
  bounds: { min: Vec3; max: Vec3 }; // mm, in the frame of the mesh
  volume: number; // mm³; shells that overlap count twice
  shells: number; // connected pieces of the surface
  usedBy: Id[]; // the features of the type `mesh` that place it, in the order of the timeline, suppressed ones included
}

// An isometry p' = M · p + t; `matrix` holds the rows of an orthogonal matrix.
export interface RigidTransform {
  matrix: [Vec3, Vec3, Vec3];
  translation: Vec3;
}

// The mechanism of a state (D49): what the section says, resolved against the model of that state
// and the parameters. Computed after the timeline, like the checks; no step of a feature reads it,
// and the bodies of the evaluation stay where they are modelled. Queries answer in this pose.
export interface MechanismResult {
  links: Record<Id, LinkResult>;
  joints: Record<Id, JointResult>;
  roots: Id[]; // the links that are no joint's child
  unassigned: Id[]; // bodies of the state that are in no link; empty while there is no link
}
export interface LinkResult {
  bodies: Id[]; // the bodies of the link that the state has
  missing: Id[]; // the bodies it lists that the state does not have
  // Takes the link from where it is modelled to the pose; the identity for a root. A joint without
  // a motion on the way to the root counts as standing at zero here, and `blockedBy` names the
  // nearest such joint: the pose of the link is then not known, and a query that reads a body of
  // the link fails.
  transform: RigidTransform;
  blockedBy?: Id;
}
// `status: 'error'`: something about the joint is wrong.
// - brokenReference: the sketch or the point of the axis is not in the state;
// - invalidExpression: a numeric field of the pose has an expression in error (`fieldErrors`);
// - jointLimits: `lower` is above `upper` (after a change of a parameter);
// - jointOutOfLimits: `value` is outside the limits (after a change of a parameter).
// A joint in error has no motion and blocks what hangs on it, with one exception: a joint whose
// only fault is its axis and whose value is 0 moves nothing whatever the axis is, so it is in
// error and blocks nothing. A model whose pose is zero stays readable while the sketch of an axis
// is being repaired (or, at a point of the timeline asked with `at`, is not made yet).
export interface JointResult {
  status: 'ok' | 'error';
  error?: Issue;
  fieldErrors?: { value?: ExpressionError; lower?: ExpressionError; upper?: ExpressionError };
  // the numbers used; a field in error is left out
  value?: number;
  lower?: number;
  upper?: number;
  // The axis as modelled, and where the parent link carries it in the pose. `origin` is the point
  // the axis was given by (the sketch point; the origin of the model for a base axis), `direction`
  // a unit vector. A fixed joint has neither; `axisInPose` is absent while the parent link is
  // blocked.
  axis?: { origin: Vec3; direction: Vec3 };
  axisInPose?: { origin: Vec3; direction: Vec3 };
  // The drive (5b): the fields the joint states, resolved (absent when it states none), and the
  // fields whose expression does not evaluate, left out of `drive`. A fault of the drive is not
  // a fault of the joint: `status`, `error` and `fieldErrors` are of the pose alone, so a broken
  // effort blocks no pose. The export of a robot refuses a joint with `driveErrors`.
  drive?: TurningDrive;
  driveErrors?: { effort?: ExpressionError; velocity?: ExpressionError; rotorInertia?: ExpressionError; gearRatio?: ExpressionError };
}

// The properties of a body of the state, with what it inherits and the defaults filled in. Computed
// after the timeline, with the parameters and the checks, from the document and the volume of the
// body; no step of a feature reads it, so a change of a property recomputes no geometry. A result
// equal to one of the last few of the same body is the same object.
// The mass, in this order:
// 1. An auxiliary body has none.
// 2. The pair `density` and `mass` is the own one when the entry states either, else the inherited
//    one.
// 3. With a `mass` in that pair: the mass, `massFrom: 'mass'`. If its expression is in error there
//    is no mass; the density does not step in for a weighed value that cannot be read.
// 4. Else with a `density`: density · volume / 1000 (g from g/cm3 and mm3), `massFrom: 'density'`;
//    none if it is in error.
// 5. Else none.
// A field in error is reported in `fieldErrors` and left out of the result; nothing takes its
// place. `fieldErrors` holds the errors of the pair that is used, the own one or the inherited one,
// so "in error" and "not stated" can be told apart for a copy too.
export interface BodyPropertiesResult {
  name: string; // the own name, else that of the creating feature; a copy adds ` / <number>`
  color?: string;
  material?: string;
  use: BodyUse;
  density?: number; // g/cm3
  mass?: number; // g, by the rule above
  massFrom?: 'mass' | 'density';
  // The body this one was copied from (the source of the pattern that made it): the nearest one. A
  // field may come from further up a chain of patterns; the chain is followed through `from` of the
  // source.
  from?: Id;
  fieldErrors?: { density?: ExpressionError; mass?: ExpressionError };
  // For a body an insertion brought (D62), or a copy of one: the key of the stored document when
  // a field of this result (the colour, the material, the use, the density or the mass) comes from
  // what that document states for the body.
  fromDocument?: Id;
}

export type ParameterResult = { ok: true; value: number } | { ok: false; error: ExpressionError };

export interface CheckResult {
  status: 'ok' | 'failed' | 'error'; // failed: the check does not hold; error: the expression cannot be evaluated
  error?: ExpressionError;
}

export interface ExpressionError {
  code:
    | 'syntax'
    | 'unknownName'
    | 'cycle'
    | 'dependsOnError' // uses a parameter that is itself in error
    | 'notFinite'
    | 'outOfRange' // the value is outside the range of the field
    | 'notInteger'
    | 'type'; // a number where a comparison is expected, or the other way round
  message: string;
  position?: number; // index of the character in the expression where the error is
}

export type EdgeKind = 'line' | 'circle' | 'coplanar' | 'other';

export interface BodyResult {
  solid: Solid;
  faces: { id: number; planar: boolean }[]; // stěny, které těleso má
  edges: { name: EdgeName; kind: EdgeKind; segments: Float64Array }[]; // segments: úsečky, 6 čísel na úsečku
  volume: number; // mm³
  bounds: { min: Vec3; max: Vec3 }; // the box of the body along the axes of the model
}

// A pair of bodies that share a volume above the threshold; `a` is the smaller ID in string order.
// `depth` is how deep one body reaches into the other: the largest distance from a point of the
// surface of what they share to the surface of the body it lies inside of. For the slivers of
// a fit it is the sagitta of the polygons, for a chunk how far it goes in.
export interface Interference {
  a: Id;
  b: Id;
  volume: number; // mm³
  depth: number; // mm
}
// - `pairs`: the collisions.
// - `fits`: pairs in which neither body reaches deeper into the other than the chord tolerance of
//   the document (plus the precision of the coordinates) and what they share has a round face.
//   Round faces are polygons; a pin in a hole of the same diameter overlaps the wall by the
//   slivers at its corners wherever the two polygons are turned differently (up to about
//   a quarter of the chord tolerance times the area of the fit). The model cannot tell such
//   a fit from a real overlap of round faces that shallow, so these pairs are listed apart and
//   are not collisions of the design. Two round faces that bulge towards each other may overlap
//   by up to about twice the tolerance before the pair is a collision. Planar faces have no such
//   excuse: where a planar face of one body reaches into a planar face of the other, away from
//   the slivers of a round face, the pair is a collision however shallow.
// - Not reported at all: bodies that only touch, and a shared volume no deeper than the
//   precision of the coordinates (a millionth of the largest coordinate of the pair; planar
//   faces have to overlap by about twice that), whatever its size.
// - `pairs` and `fits` rest only on an intersection the kernel verified.
// - The kernel computes an intersection without a guarantee for flush faces and may refuse it.
//   It is then asked for its intersection as computed, which it does not verify; that may only
//   clear the pair, by the same rule and threshold as a verified one.
// - `cleared`: pairs the kernel refused and its intersection as computed shows to be no
//   collision. Present only when it has an entry.
// - `failed`: pairs that are neither colliding nor clear: the kernel refused them and what it
//   computed measures as a collision or could not be measured. The message gives the reason of
//   the refusal and then, when it was measured, the volume and depth as computed, not verified.
export interface InterferenceReport {
  pairs: Interference[];
  fits: Interference[];
  failed: { a: Id; b: Id; message: string }[];
  cleared?: Cleared[];
  checked: number; // number of pairs examined
}
// A pair the kernel refused and its intersection as computed clears. `kind`: what that mesh
// measures as, by the threshold of the call: `nothing` (it shares nothing, or only touches) or
// `fit` (round faces within the chord tolerance). `volume` and `depth` are of that mesh, as for
// an entry of `fits`. The pair is clear; the kind is less sure than a verified one.
export interface Cleared {
  a: Id; // the smaller ID, as in the other lists
  b: Id;
  kind: 'nothing' | 'fit';
  volume: number; // mm³
  depth: number; // mm
}
// `bodies`: only pairs of these bodies (all without a list). `threshold`: the volume in mm³ above
// which a pair is reported (0.001 by default). `at`: the state after the given feature.
export interface InterferenceOptions {
  bodies?: Id[];
  threshold?: number;
  at?: Id;
}

export interface Issue {
  code: IssueCode;
  message: string;
  refs?: unknown[];
}

// invalidExpression: the expression of some field cannot be evaluated or gave a value outside the
// range of the field (details in `fieldErrors`). For a sketch it is a warning: the sketch is computed
// with the last valid value of the field, so that it stays visible and can be fixed. For other
// feature types it is an error.
// invalidExtent: the extent cannot use one of its planes (`refs` name which): the extent `upTo`
// cannot reach its plane (parallel to the direction, through the start of the tool, or a gap as
// large as the way to it), or the extent of an extrusion or a hole cannot start in its plane `from`
// (within 0.01 rad of the direction, or tilted against the sketch plane).
// invalidClearance: a tool of a combine cannot be moved outwards by the clearance without a change
// of its shape (D56). `refs` start with the tool body and name the faces concerned: a hole no
// wider than twice the clearance closes, two parts of the tool are nearer than twice the clearance
// (a slot, two pins, the tips of a C), a vertex cannot follow its faces, a face has material on
// both sides, a face has no description; or the clearance is too small to be told from none (under
// ten precisions of the coordinates, or not more than twice the chord tolerance on a tool with
// round faces), with no faces in `refs`.
// invalidHole: the dimensions do not make a hole.
// - The head is not wider than the bore (for a nut pocket: the bore does not fit between the flats).
// - The head is as deep as the hole or deeper. For "through all" the hole is as deep as the targets
//   reach from the mouth, and the overshoot of the tool does not count; the bore has to be left
//   more than the resolution of the kernel (1e-4 of the largest coordinate) of that reach. Whether
//   such a head is this error is decided by what its tool did: if it cut a target, it is; if it
//   changed none (the targets do not pass the mouth), the feature has the warning `noEffect`, as
//   a cut that misses. The reach is that of the whole targets, not of the material under each
//   point: a head that passes through a thin plate of a body that reaches deeper elsewhere is not
//   detected.
// - Two points are so close that their holes would overlap; `refs` name the two points.
// invalidPattern: the counts, the directions and the spans do not make a pattern (a grid, D53).
// - More places than 200 (count × second count, the original included); `refs` are the fields
//   `transform/count` and `transform/second/count`, the message says the product.
// - Two places of a grid would be one place (at most 1e-6 mm apart; the original is a place);
//   `refs` are the paths of what the places are computed from (`transform/direction`,
//   `transform/count`, the numeric field of the span, and the same three under
//   `transform/second/`), the message names the two copies ("the copies 1 and 1000 would stand in
//   one place", "the copy 1001 would stand in the place of the original").
// The pattern is in error as a whole and the model stays as it was before it.
// importedTarget: a feature that applies a tool (an extrusion or a revolve with the operation add or
// cut, a hole, a pattern of them) has a target that is an imported body: the body of a feature of the type
// `mesh`, or a copy of it made by a pattern. `refs` name those targets, and no target is changed.
// The kernel keeps its guarantee for flush faces only for faces it knows as planar, and a flat
// region of an imported mesh is not one (D55).
// A combine refuses an imported body in every role, the target and each tool (a tool would make
// the target imported), also with a clearance, and a split refuses one as its body; `refs` name
// those bodies (D56).
// invalidAxis: the axis cannot be used.
// - The line of an axis of the kind `sketchLine` has no length (any user: a revolve, a pattern,
//   a joint, a plane, a query); `refs`: the line.
// - The face of an axis of the kind `face` is not round (not a cylinder, a cone or a torus); `refs`:
//   the axis.
// - The axis of the tilt of a plane is not parallel to the plane it tilts (more than 1e-4 rad off);
//   `refs`: the axis, the message gives the angle.
// - A revolve whose axis does not lie in the plane of the profile's sketch; `refs`: the axis, the
//   message gives the angle or the distance.
// - A revolve whose profile lies on both sides of its axis; `refs`: the axis and a curve on each
//   side, the message says how far each reaches.
// unsupportedEdge: an edge of a chamfer or a fillet cannot be chamfered or filleted (D63). `refs`:
// the edge, and a second edge where the reason is a pair. The message says which:
// - its kind, or the surfaces of its faces (a sphere, a torus, a cylinder along a plane);
// - its faces meet at less than 0.01 rad from flat or from folded;
// - the side of a face along the edge is not clear (its triangles along it disagree);
// - the pieces of the edge need different chamfers (another side of a face);
// - an end has no face besides its own, two or more that are not a seam (the faces in `refs`),
//   (a straight edge) a plane within 0.01 rad of the edge;
// - an end at a round face C (in `refs`, D67) it cannot run out into: of a kind not taken (a cone,
//   a sphere, a torus, a swept or an imported face; for an arc a cylinder or a plane not parallel to
//   its axis), a crossing under 10° or one that only grazes C, a stop (the edge runs into C's
//   material, convex, or past C into its air, concave; the message says to blend before the feature
//   that makes C), a bridge (the corner passes behind C before crossing it, or two run-outs reach
//   across one gap: blend before the feature that makes C, or use a smaller size);
// - the edge runs on smoothly into the second edge in `refs`, which is not in the feature: add it;
//   where that edge is of the kind other (an earlier fillet against a leaning face) it cannot be,
//   and the face it runs on into (both faces, at a seam of two) is in `refs` instead;
// - a convex and a concave edge of the feature (both in `refs`) meet at a vertex: two features;
// - it meets the second edge in `refs` at a vertex in a way the feature cannot join (an arc at an
//   angle, different angles at a reflex corner), or their two tools leave a step there.
// blendDoesNotFit: the chamfer or fillet does not fit (D63). `refs`: the edge and the face
// concerned. The message says which:
// - a face of the edge would vanish (a radius larger than the face is wide), or the new face would;
// - the tool reached material it must not touch: next to a convex edge within the size outside
//   its faces (a slot narrower than the size, a piece of the body), or next to a concave edge
//   a hollow just inside them (the foot of a boss that reaches the edge of the plate);
// - it reaches the axis of a circular edge;
// - the ends of a straight piece meet within it (a piece shorter than the slant of its ends);
// - it reaches past the end face in `refs`: deeper than a riser the edge ends at, into the
//   material beyond it, or (added) standing out over a lower end wall;
// - it is too small for the chord tolerance (it lies within the polygons of the faces);
// - (a run-out, D67, the end face in `refs`) the part of the tool past the end would take material
//   beyond the end face (a pin or a post in the void, a void shallower than the size) or, added,
//   add some where it has none; the end face is too small or too large for the chord tolerance;
//   the piece is shorter than its blend reaches into the end face; a vertex of the end of the
//   run-out lies off the blend's surface;
// - the tools would have more than 1 000 000 triangles (raise the chord tolerance).
export type ErrorCode =
  | 'brokenReference'
  | 'noProfile'
  | 'invalidProfile'
  | 'nonPlanarFace'
  | 'emptyResult'
  | 'kernelFailure'
  | 'invalidExpression'
  | 'invalidExtent'
  | 'invalidHole'
  | 'invalidPattern'
  | 'importedTarget'
  | 'invalidClearance'
  | 'invalidAxis'
  | 'unsupportedEdge'
  | 'blendDoesNotFit'
  | 'jointLimits' // a joint of the mechanism: its lower limit is above its upper one
  | 'jointOutOfLimits'; // a joint of the mechanism: its value is outside its limits

export type WarningCode =
  | 'sketchConflict'
  | 'brokenProjection'
  | 'degenerateProjection'
  | 'unsupportedProjection'
  | 'invalidExpression'
  | 'noEffect' // `refs` list the targets the operation did not change; for a pattern `{ copy, feature, targets }` per application
  // The reference `meshWith` of a gear cannot be used (the other gear is missing or in error, the
  // modules or pressure angles differ, the axes are not parallel, the pitch circles are not
  // tangent); the parameter `rotation` was used instead.
  | 'gearMesh'
  // The tip of one gear of a pair runs into the root of the other below its base circle.
  | 'gearInterference'
  // An insertion (D62) whose document did not recompute cleanly with the values of this insertion:
  // `refs` are `{ feature: <prefixed ID>, code }` for a feature of it in error, `{ check }` for
  // a check of it that fails or cannot be evaluated, and the refs of the same warning of an
  // insertion inside it, with their IDs prefixed and a check as `{ check, in: <prefixed ID of that
  // insertion> }`. The bodies that are there come in; other warnings of its features are not
  // repeated.
  | 'insertedIssues'
  // A mirror or pattern of the sketch (SketchPattern) cannot make all its copies. `refs`: the entry,
  // then what is wrong: the axis, direction or centre that is not a line (a point) of the sketch
  // with a position, or a line of no length (no copies at all); the sources that are not own curves
  // or points (the others are copied); the addresses of the fields in the sketch
  // (`external/<entry>/transform/count`, `…/second/count`, …) of a grid of more than 200 places or
  // whose copies would stand in one place (no copies at all). The rest of the sketch is solved and
  // its profile found with the copies that could be made.
  | 'brokenCopies';

export type IssueCode = ErrorCode | WarningCode;

// A curve of a sketch that is not its own (D64): the curve of an entry of `external` (a projected
// edge, a projection from a sketch, a copy of a mirror or a pattern). `shape` runs over IDs whose
// positions are in `SketchResult.points`; the radius of a circle is in `SketchResult.radii`.
// `regions`: whether the curve forms regions of the profile (never for the projection of an edge;
// for a projection from a sketch its flag `regions`; for a copy as its source, unless it lies on a
// curve before it).
export interface ResultCurve {
  shape: CurveShape;
  source: 'reference' | 'derived';
  regions: boolean;
}

export interface SketchResult {
  // The used positions: own points, `origin` and the points of projected geometry; not the far
  // points of the axes `origin/x` and `origin/y`, which are no points of the sketch.
  points: Record<Id, Point2>;
  radii: Record<Id, number>;
  // The curves that are not own, by their IDs: the entries of `external` in the order of the
  // document, the curves of one entry in the order of its kind. An entry that never had values has
  // none, as it has no points. The axes `origin/x` and `origin/y` are not here: they are the same in
  // every sketch.
  curves: Record<Id, ResultCurve>;
  degreesOfFreedom: number;
  conflicting: Id[];
  redundant: Id[];
  measurements: Record<Id, number>; // hodnoty referenčních kót
  valid: boolean; // false: the profile is invalid (curves cross or touch away from common points, or another reason); the query `sketchContacts` says where and why, and the sketch tool `split` without a curve repairs what can be cut
  regions: { ref: RegionRef; loops: Float64Array[] }[]; // pro vykreslení a výběr
  // Present when ends of copies of a mirror or pattern, or of projections that form regions, stayed
  // open: why such an outline did not close (OpenEnds). An open chain is a legitimate sketch, so
  // this is no warning.
  openEnds?: OpenEnds;
}

// The ends of copies and of projections that form regions (curves that are not own and form
// regions) that, after every join, are the end of no other curve that forms regions. Such ends join
// the curve ends at their place within the length tolerance (1e-6 mm), so an outline of copies or
// projections closes only where the ends meet: a mirrored half has to end on the axis by
// a constraint (`pointOnCurve` with the axis line).
// - `count`: how many ends are open; `ends`: at most 20 of them, those of `twoVertices` first, then
//   by `distance`, the nearest first.
// - `reason: 'twoVertices'`: the own ends at its place are two points that are not joined, so it
//   joined neither (`near` names them; a `coincident` between them cures it). `reason: 'apart'`:
//   nothing is at its place; `near` is the nearest end of another curve that forms regions and
//   `distance` how far it is, in mm.
export interface OpenEnds {
  count: number;
  ends: OpenEnd[];
}
export interface OpenEnd {
  end: Id;
  reason: 'twoVertices' | 'apart';
  near: Id[];
  distance: number;
}

// Diagnostika skici na vyžádání (Engine.diagnoseSketch). Počítá se z vyřešeného stavu.
export interface SketchDiagnosis {
  // unavailable: skica se nevyhodnotila (potlačená, chybná rovina); zbylá pole jsou pak prázdná
  status: 'solved' | 'conflict' | 'failed' | 'unavailable';
  degreesOfFreedom: number; // při jiném stavu než solved bez významu
  conflicting: Id[];
  duplicates: Id[][]; // skupiny řídicích vazeb se stejným typem a stejnými operandy
  redundant: Id[]; // vazby, které plynou z ostatních: po odebrání kterékoli z nich se volnost nezmění
  removable: Id[]; // jedna sada, kterou jde odebrat celou naráz beze změny volnosti; starší vazby v ní nejsou
  free: FreeEntity[]; // jen entity, které se ještě mohou hýbat
}

// Bod má volnost 1 (pohyb po křivce) nebo 2, poloměr kružnice 1. `id` je bod nebo kružnice.
export interface FreeEntity {
  id: Id;
  kind: 'point' | 'radius';
  freedom: number; // o kolik klesne volnost skici, když se entita zafixuje
}

export interface ConstraintExplanation {
  redundant: boolean;
  impliedBy: Id[]; // sada ostatních vazeb, ze kterých vazba plyne a ze které nejde nic ubrat; u nenadbytečné prázdná
}

export interface FeatureResult {
  status: 'ok' | 'warning' | 'suppressed' | 'error';
  error?: Issue; // jen při status 'error'
  warnings: Issue[];
  // Bodies the feature created: an extrusion with the operation `new` and a split their own, a
  // pattern of a body its copies in the order of their numbers. A caller does not have to compose derived IDs.
  bodies: Id[];
  plane?: Frame; // sketch, plane
  sketch?: SketchResult;
  fieldErrors?: Record<FieldPath, ExpressionError>; // expression errors by field
  // Values of fields with an expression used in this recompute. The document has them only after
  // the write-back; a preview does not write to the document, so they are returned here as well.
  values?: Record<FieldPath, number>;
  // What the profile generator published about the profile (a gear: module, diameters, the rotation
  // used, placement in the model). A generator that refers to this feature reads them, and a caller
  // can verify with them what it built. Absent when the feature is in error or suppressed.
  facts?: Facts;
}

export type Facts = Record<string, number | boolean | Vec3>;

// ---------------------------------------------------------------- API

export interface EngineState {
  document: Document;
  evaluation: Evaluation;
  canUndo: boolean;
  canRedo: boolean;
}

export type CommandResult =
  | { ok: true; state: EngineState }
  | {
      ok: false;
      error: {
        code: 'invalidCommand' | 'invalidDocument';
        message: string;
        commandIndex?: number;
        // when the command rejected an expression: where and why
        expression?: { path?: FieldPath; parameter?: string; check?: string; error: ExpressionError };
      };
    };

// Command input. Where the document expects a number from the catalog of numeric fields (see
// fieldsOf), a command may send a number or an expression as a string. The engine evaluates the
// expression, fills in the number and stores the expression in `expressions`.
// - A number and an expression use the same units: `"0.5"` and `0.5` mean the same, degrees are
//   written `"deg(30)"`.
// - An expression that cannot be evaluated at that moment, or gives a value outside the range of the
//   field, is an invalid command.
// - A string in the field together with an `expressions` entry for the same address is an invalid
//   command.
// - A string in a numeric field outside the catalog (sketch point coordinates, a radius, the value
//   of a reference dimension) is an invalid command even though the type allows it.
// - An object with `kind` (a reference such as a plane, an axis or a face of a body, or a solved
//   value such as a projected curve) holds no field that takes an expression and is taken as it is
//   (the index of a copy in a face name is a number, never an expression).
// - The curves of an imported outline and the options it was read with hold numbers only (D72).
export type Input<T> = T extends number ? number | Expr : T extends readonly (infer U)[] ? Input<U>[] : T extends { kind: string } | ImportedCurve | OutlineReadWith ? T : T extends object ? { [K in keyof T]: Input<T[K]> } : T;

// A new feature in addFeature (D73): its input form, in which `name` (the ID when left out) and
// `suppressed` (false) may be left out, and a sketch may leave out what starts empty (`points`,
// `radii`, `curves`, `constraints`, `external`, `solved`): `{ id: 's1', type: 'sketch', plane: {
// kind: 'base', plane: 'XY' } }` is a new sketch. The stored feature has every field.
export type NewFeature = Input<Feature> extends infer F
  ? F extends { type: 'sketch' }
    ? Loose<F, 'name' | 'suppressed' | 'points' | 'radii' | 'curves' | 'constraints' | 'external' | 'solved'>
    : Loose<F, 'name' | 'suppressed'>
  : never;
// `T` with the fields `K` optional.
export type Loose<T, K extends PropertyKey> = Omit<T, K> & { [P in K & keyof T]?: T[P] };

export type Command =
  // časová osa
  | { type: 'addFeature'; feature: NewFeature; index?: number } // without an index at the end
  | { type: 'removeFeature'; id: Id }
  | { type: 'moveFeature'; id: Id; index: number }
  | { type: 'renameFeature'; id: Id; name: string }
  | { type: 'setSuppressed'; id: Id; suppressed: boolean }
  // Změna roviny, vysunutí nebo pole (a pattern); obsah skici mění příkazy skici. Změna se s feature slučuje:
  // - varianta (objekt s `type`: zdroj profilu, rozsah) se stejným `type` se slučuje po polích,
  //   s jiným `type` dosavadní nahradí a musí být úplná;
  // - odkaz (objekt s `kind`: rovina, osa pole) a seznam se nahrazují celé; `null` odebere nepovinné pole;
  // - a generated profile with another `generator` is another variant as well; its dictionaries
  //   (`operands`, `params`, `refs`) merge by entry, and `null` removes one entry: a parameter then
  //   returns to its default and loses its expression (a parameter without a default cannot be
  //   removed), a reference ceases to exist;
  // - změna na `operation: 'new'` odebere `targets` sama;
  // - only references the feature did not have before are verified (a repeated broken reference passes);
  // - a number in a field with an expression removes the expression, a string sets one; fields the
  //   patch does not mention keep theirs. Whoever sends the whole feature starts from its input form
  //   (featureInput): a string equal to the expression the field already has counts as unchanged
  //   and is kept even if it can no longer be evaluated.
  | { type: 'updateFeature'; id: Id; patch: FeaturePatch }
  // One numeric field by its address (see fieldsOf); a number removes the expression, a string sets it.
  | { type: 'setField'; feature: Id; path: FieldPath; value: number | Expr }
  // Parameters and checks. Only a syntax error (including a number where a comparison is expected)
  // and a disallowed name make the command invalid; an unknown name and a cycle are accepted and
  // show up in the recompute result (otherwise `Zr = Zs + 2 * Zp` could not be created before `Zs`).
  | { type: 'setParameter'; name: string; expr: Expr; index?: number } // creates or changes; index = position in the table
  | { type: 'renameParameter'; name: string; to: string } // rewrites the name in every expression as well
  | { type: 'removeParameter'; name: string } // expressions that use it end up as an error or a warning of their feature
  | { type: 'setCheck'; name: string; expr: Expr; index?: number }
  | { type: 'renameCheck'; name: string; to: string }
  | { type: 'removeCheck'; name: string }
  // skica
  | { type: 'setSketchPlane'; sketch: Id; plane: PlaneRef }
  | { type: 'addPoint'; sketch: Id; id: Id; x: number; y: number }
  | { type: 'addCurve'; sketch: Id; id: Id; curve: Curve; radius?: number } // radius u kružnice
  | { type: 'removeEntity'; sketch: Id; id: Id } // bod nebo křivka
  | { type: 'setConstruction'; sketch: Id; id: Id; construction: boolean }
  // One point of an own curve is replaced by another point; the curve keeps its ID, kind,
  // direction, construction flag, radius and every constraint on it (D52).
  // - `point` is the name the curve has for it: `a` or `b` of a line, `center` of a circle,
  //   `center`, `start` or `end` of an arc. A name the kind of the curve does not have is an
  //   invalid command.
  // - `to` is an own point of the sketch or `origin` (a point of projected geometry is refused:
  //   join to it with a coincident constraint). The curve has to stay one: the two points of
  //   a line, the three of an arc differ.
  // - A constraint on the curve that the catalog would refuse afterwards (a symmetric point that
  //   becomes an end of the axis, the midpoint of a line that becomes its end) makes the command
  //   invalid; the message names the constraint.
  // - The old point stays, with its constraints, also when no curve uses it (removeEntity removes
  //   it). `to` equal to the point the curve has is accepted and changes nothing.
  // - Nothing moves by the command; the next recompute solves the sketch from the stored positions.
  // - What follows in the recompute: a region is named by the curves of its outer loop and a side
  //   face by its curve, so both keep their names, but a region may no longer be there; the origin
  //   of the planar side face of a line is its start `a`, so re-pointing `a` moves a sketch or a
  //   plane on that face; the straight end of a wall is named by the point its chain ends at
  //   (`wallEnd`), so re-pointing a free end renames that face.
  | { type: 'setCurvePoint'; sketch: Id; id: Id; point: CurvePointName; to: Id }
  | { type: 'addConstraint'; sketch: Id; id: Id; constraint: Input<Constraint> | FixedInput } // `fixed` without x, y takes the position of the point
  | { type: 'removeConstraint'; sketch: Id; id: Id }
  // Without `value` neither the value nor the expression changes; a number removes the expression,
  // a string sets it. Switching to a reference dimension removes the expression; an expression given
  // to a reference dimension is an invalid command.
  | { type: 'setConstraintValue'; sketch: Id; id: Id; value?: number | Expr; driving?: boolean }
  | { type: 'dragPoint'; sketch: Id; point: Id; x: number; y: number }
  // `ref` in its input form: a numeric field of an entry may be an expression (kept in the sketch's
  // `expressions` at `external/<id>/…`; setField with the sketch as the feature reaches one). An
  // update replaces the whole entry: send the entry with its expressions as strings, or a number
  // removes the expression; a string equal to the expression the field has counts as unchanged
  // (an imported outline is the exception: fields left out keep what it has, SketchOutline). An
  // update may not turn reference geometry into derived geometry or back. An update that keeps the
  // source (a projection from a sketch with the same `sketch`, `entity` and `kind`, its flag
  // switched; an edge projection to the same edge) checks no reference and keeps the last values,
  // also when the source is gone; any other update checks every reference of the new entry.
  | { type: 'addExternal'; sketch: Id; id: Id; ref: ExternalInput }
  | { type: 'updateExternal'; sketch: Id; id: Id; ref: ExternalInput }
  | { type: 'removeExternal'; sketch: Id; id: Id }
  // Body properties (D48). The body of setBodyProperties and setBodyMaterial has to be one a feature
  // of the document can create: the feature exists and its type creates a body of that ID (an
  // extrusion with the operation new, a split; `<pattern>/<number>` of a pattern of a body, a mirror only
  // `<pattern>/1`). Whether the body exists in the model is not asked: the count of a pattern may be
  // an expression and a feature may be suppressed.
  // - setBodyProperties merges `patch` into the entry of the body, creating it; an entry left with
  //   no field is removed.
  // - setBodyMaterial takes the row `material` of the catalog `materials` and writes its key into
  //   `material` and its density into `density` (a number; the expression goes). `mass` stays. A key
  //   the catalog does not have is an invalid command. A material of one's own is setBodyProperties
  //   with `material` and `density`.
  // - removeBodyProperties removes the entry; it asks only that the entry is there, so it also
  //   removes an entry whose body is gone.
  // An error of an expression names the field by `<body>/<field>` in `error.expression.path`.
  | { type: 'setBodyProperties'; body: Id; patch: BodyPropertiesPatch }
  | { type: 'setBodyMaterial'; body: Id; material: string }
  | { type: 'removeBodyProperties'; body: Id }
  // The mechanism (D49). They keep what always holds of the section (see `Mechanism`); a command
  // that would break it is invalid.
  // - setLink creates the link `id`, or changes the fields named. `bodies` replaces the list; `name:
  //   null` removes the name. A body that is in another link is an invalid command: take it out
  //   there first, in the same batch. Only bodies the link did not have before are checked.
  // - removeLink is refused while a joint names the link.
  // - setJoint creates the joint `id` or replaces it in the input form: a numeric field takes
  //   a number or an expression, which has to evaluate now. A string equal to the expression the
  //   field already has is kept without evaluation. Only an axis the joint did not have before is
  //   checked. What a joint of 5a has (the type, the links, the axis, the value and the limits) is
  //   replaced whole and is required. The drive (`effort`, `velocity`, `rotorInertia`,
  //   `gearRatio`) is a patch: a drive field the command does not name is kept from the joint of
  //   the same type it replaces, `null` removes it, and a joint of another type starts without
  //   a drive.
  // - setPose sets the values of the joints named; the others keep theirs. A number removes the
  //   expression of the value (and with it a coupling), a string sets one. A fixed joint has no
  //   value. It is the command a sweep previews at every step, and the one for `after` of the tool
  //   `query`.
  // The limits are compared with the numbers as they are for the document the command is applied
  // to: a field with an expression is evaluated against its parameters, also a field the command
  // does not name. A field whose expression does not evaluate takes no part. An error of an
  // expression names the field by `<joint>/<field>` in `error.expression.path`.
  | { type: 'setLink'; id: Id; name?: string | null; bodies?: Id[] }
  | { type: 'removeLink'; id: Id }
  | { type: 'setJoint'; id: Id; joint: JointInput }
  | { type: 'removeJoint'; id: Id }
  | { type: 'setPose'; values: Record<Id, number | Expr> }
  // Stored meshes (D55). Usually not written by hand: the MCP tool import_mesh reads a file and sends
  // addMesh, then answers with the batch that places the mesh.
  // - addMesh adds a stored mesh under `id`, checked in full (see StoredMesh); an ID the section
  //   already has is an invalid command.
  // - removeMesh removes the entry; refused while a feature of the document names the mesh,
  //   suppressed or not (remove or re-point those features first, in the same batch).
  | { type: 'addMesh'; id: Id; mesh: StoredMesh }
  | { type: 'removeMesh'; id: Id }
  // Stored documents (D62). Usually not written by hand: the MCP tool insert_document reads a file
  // and sends addDocument (or replaceDocument), then answers with the command that inserts it.
  // - addDocument stores `document` under `id`. `document` is a document as a file holds it, of any
  //   version this build reads: it is upgraded and validated in full, as a load does, and an
  //   invalid one is an invalid command with the message of the load. An ID the section has is an
  //   invalid command.
  // - replaceDocument puts another document (a new revision of a part) in the place of a stored
  //   one, validated the same way; `name` absent keeps the name, `null` removes it. Every feature
  //   that inserts it is recomputed: a reference to a face the revision no longer has breaks as any
  //   reference does, a parameter or a listed body it no longer has is an error of the insertion.
  // - removeDocument is refused while a feature inserts it, suppressed or not (remove or re-point
  //   those features first, in the same batch).
  | { type: 'addDocument'; id: Id; document: Document; name?: string }
  | { type: 'replaceDocument'; id: Id; document: Document; name?: string | null }
  | { type: 'removeDocument'; id: Id }
  // složený
  | { type: 'batch'; commands: Command[] };

// The joint of setJoint: the input form of a joint, with `null` for a drive field (removes it).
export type JointDriveField = 'effort' | 'velocity' | 'rotorInertia' | 'gearRatio';
export type JointInput = Joint extends infer J ? (J extends Joint ? { [K in keyof J]: K extends JointDriveField ? number | Expr | null : Input<J[K]> } : never) : never;

// What setBodyProperties changes: the fields it names. `null` removes a field (the body then
// inherits it or has its default); a number in a numeric field removes its expression, a string
// sets one, as in updateFeature. A field the properties do not have is an invalid command.
export interface BodyPropertiesPatch {
  name?: string | null;
  color?: string | null;
  material?: string | null;
  use?: BodyUse | null;
  density?: number | Expr | null;
  mass?: number | Expr | null;
}

// Slučovací změna (viz příkaz updateFeature).
export type Patch<T> = T extends number
  ? number | Expr
  : T extends readonly unknown[] | { kind: string }
    ? Input<T>
    : T extends object
      ? string extends keyof T
        ? { [K in keyof T]?: Patch<T[K]> | null } // a dictionary: null removes an entry
        : { [K in keyof T]?: Patch<T[K]> | (undefined extends T[K] ? null : never) }
      : T;
export type FeaturePatch =
  // `tilt` merges field by field; its `axis` is a reference and is replaced whole
  | Patch<Pick<PlaneFeature, 'base' | 'offset' | 'midplaneWith' | 'tilt'>>
  | Patch<Pick<ExtrudeFeature, 'profile' | 'extent' | 'operation' | 'targets'>>
  | Patch<Pick<PatternFeature, 'source' | 'transform'>>
  | Patch<Pick<HoleFeature, 'sketch' | 'points' | 'shape' | 'extent' | 'targets' | 'label'>>
  | Patch<Pick<CombineFeature, 'operation' | 'target' | 'tools' | 'keepTools' | 'clearance'>>
  | Patch<Pick<SplitFeature, 'body' | 'plane' | 'side'>>
  // `placement` merges field by field; its `frame` is a reference and is replaced whole
  | Patch<Pick<MeshFeature, 'mesh' | 'placement'>>
  | Patch<Pick<RevolveFeature, 'profile' | 'axis' | 'extent' | 'operation' | 'targets'>>
  | Patch<Pick<ChamferFeature, 'body' | 'edges' | 'distance'>>
  | Patch<Pick<FilletFeature, 'body' | 'edges' | 'radius'>>
  // `parameters` merges key by key (`null` removes a value); `placement` as for a mesh feature
  | Patch<Pick<InsertFeature, 'document' | 'placement' | 'parameters' | 'bodies'>>;

// ---------------------------------------------------------------- queries

// One way to say "this thing of the model" in the arguments of a query. A query that takes a plane
// or an axis takes `PlaneRef` or `AxisRef` as they are, not wrapped.
export type EntityRef =
  | { kind: 'body'; body: Id }
  | { kind: 'face'; body: Id; face: FaceName }
  | { kind: 'edge'; body: Id; edge: EdgeName }
  | { kind: 'sketchPoint'; sketch: Id; point: Id }; // `origin` is the origin of the sketch

// The place of an argument inside the arguments of a query: names and indexes, such as
// `['orientations', 1, 'by', 'onBed']`. A key of a record is one segment.
export type ArgPath = readonly (string | number)[];

// A query does not throw for anything its caller can cause; it answers with a result or with
// a reason, like a command.
// - `invalidArguments`: an argument has the wrong shape or is out of its range, the query has no
//   such argument, or `state` is not a state this engine handed out.
// - `notAvailable`: something named is not in the state asked about. One rule for every ID,
//   wherever it sits (an argument, an entity, a plane, an axis): a body, a face, an edge is looked
//   up in the bodies of the state; a feature, a sketch, a constraint, a sketch point among the
//   features the state evaluated. A mistyped ID and one that comes later on the timeline are the
//   same answer. Also: `at` names no feature.
// - `failed`: the computation gave up (the geometric kernel, a limit).
// A result may be kept by the engine and returned again for the same state: do not change it,
// like a state the engine returns.
// What was a successful answer stays one: a sketch that did not evaluate has the diagnosis
// `status: 'unavailable'`, a list of fewer than two bodies has no collisions.
export type QueryOutcome<Result> =
  | { ok: true; result: Result }
  | { ok: false; error: { code: 'invalidArguments' | 'notAvailable' | 'failed'; message: string; arg?: ArgPath } }; // arg: the argument concerned; ['at'] and ['state'] for the options

// The state a query answers for: the current one, the one after a feature (`at`), or one that
// `preview` or `getState` of this engine returned (`state`). With a previewed state nothing is
// written, so a parameter can be stepped and each step asked about.
// `geometry: 'modelled'`: the answer is for the model as modelled, whatever pose the mechanism
// holds; nothing is posed and nothing is blocked. Without it a query answers in the pose of the
// state asked about (D49).
export type QueryOptions = ({ at?: Id; state?: never } | { state: EngineState; at?: never }) & { geometry?: 'modelled' };

// An answer that can be large says so: a query with such an answer has an argument that limits it
// and returns how much there was.
export interface Truncated {
  truncated?: { shown: number; total: number };
}

// What the query `body` answers with: a body described for a reader that does not hold its mesh.
export interface BodyDescription {
  body: Id;
  volume: number; // mm³
  bounds: { min: Vec3; max: Vec3 };
  faces: BodyFace[];
  edges: BodyEdge[];
}
export interface BodyFace {
  name: FaceName;
  surface: Surface;
  area: number; // mm²
  meshNormal?: Vec3; // a planar face: unit, pointing out of the body (the sum of the normals of its triangles)
  convex?: boolean; // a cylinder or a cone: true when the material is on the side of the axis (a pin), false for a hole
}
// `segments`: the number of straight pieces the edge has in the mesh.
// - A line has its two ends along its direction; `gaps` says that a cut interrupts it.
// - The circle of a circular edge is that of the surfaces of its two faces, exact, and whole even
//   when the edge is an arc of it. `axis` is a unit vector without a sign.
export type BodyEdge = { name: EdgeName; length: number; segments: number } & (
  | { kind: 'line'; from: Vec3; to: Vec3; gaps: boolean }
  | { kind: 'circle'; circle: { center: Vec3; axis: Vec3; radius: number } }
  | { kind: 'coplanar' | 'other' }
);

// What an export format returns: files. `file`: one file, and the caller's path names it (`path`
// of the file is then only a suggested name). `directory`: the caller's path names a folder and
// `path` of each file is relative to it.
export interface Exported {
  layout: 'file' | 'directory';
  files: ExportFile[];
  // Set when the export holds nothing worth writing (the model has no body): the reason. A format
  // still returns its files (STL of no bodies is a file without triangles); a tool that writes
  // them refuses instead.
  empty?: string;
}
export interface ExportFile {
  // Relative, with forward slashes: `meshes/arm.stl`. Every segment is non-empty and is not `.` or
  // `..`, there is no backslash, and no path is a folder of another. What depends on the disk is
  // the writer's to refuse: a segment longer than the file system allows, two names in one folder
  // that differ only in the case of letters.
  path: string;
  mediaType: string;
  bytes: Uint8Array;
  about?: Record<string, unknown>; // what the file holds, for the answer of a tool (STL: `bodies`, `triangles`)
}

// ---------------------------------------------------------------- engine

export interface Engine {
  execute(cmd: Command): CommandResult; // změní dokument, jeden krok undo
  preview(cmd: Command, at?: Id): CommandResult; // spočítá, ale nezapíše; at = jen po danou feature
  undo(): void;
  redo(): void;
  getState(at?: Id): EngineState; // at = stav modelu po dané feature, dál se nepočítá
  diagnoseSketch(sketch: Id): SketchDiagnosis; // nadbytečné vazby a volnost entit
  explainConstraint(sketch: Id, constraint: Id): ConstraintExplanation; // ze kterých vazeb daná vazba plyne
  load(json: string): CommandResult;
  save(): string;
  exportMesh(format: 'stl', bodies?: Id[]): Uint8Array; // without a list the printed bodies (use `part`); '3mf' později
  interference(options?: InterferenceOptions): InterferenceReport; // which bodies share a volume
  // Asks a query of the catalog by its name. Everything new is asked this way; the methods above
  // that are queries stay for their callers. The catalog (names, arguments, what each returns) is
  // in the section Queries of the API description.
  query<N extends QueryName>(name: N, args: QueryArgs<N>, options?: QueryOptions): QueryOutcome<QueryResult<N>>;
  // Exports the model in a format of the catalog (section Export formats of the API description).
  // `exportMesh` above stays for its callers. The bodies are exported as modelled.
  export<F extends ExportFormat>(format: F, options: ExportOptions<F>, queryOptions?: QueryOptions): QueryOutcome<Exported>;
  subscribe(listener: (state: EngineState) => void): () => void;
}

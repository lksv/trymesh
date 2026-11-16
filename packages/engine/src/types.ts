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
}

// An expression over parameters. Units are the same as for numbers: lengths in millimetres, angles in
// radians. Degrees are written with the function `deg(x)` (degrees → radians), `pi` is a constant.
// A function is recognised by the parenthesis after its name, so a parameter may share a name with
// a function; only the names of constants are reserved.
export type Expr = string;

// The address of a numeric field inside a feature, parts separated by slashes (not allowed in IDs):
// 'offset', 'extent/start', 'extent/distance', 'constraints/<id>/value'.
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

export type Feature = PlaneFeature | SketchFeature | ExtrudeFeature | PatternFeature;

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

export interface PlaneFeature extends FeatureBase {
  type: 'plane';
  base: PlaneRef;
  offset: number; // posun ve směru normály základu
}

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
  external: Record<Id, Projected>; // poslední platné hodnoty promítnuté geometrie
}

export type Projected =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number };

export type CurveShape =
  | { type: 'line'; a: Id; b: Id } // ID bodů
  | { type: 'circle'; center: Id } // poloměr je v `radii`
  | { type: 'arc'; center: Id; start: Id; end: Id }; // proti směru hodin

export type Curve = { construction?: boolean } & CurveShape;

export type ProjectionKind = 'line' | 'circle';

// kind: jako co se hrana promítá
export interface ExternalRef {
  type: 'edge';
  body: Id;
  edge: EdgeName;
  kind: ProjectionKind;
}

// Každá varianta má pojmenované operandy s pevným významem.
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
//   circle; it may be a construction circle or a projected one). A command verifies the operands the
//   feature did not have before; an operand removed later is a broken reference in the recompute.
// - `params` follow the catalog: numbers are numeric fields at `profile/params/<name>` and accept an
//   expression, flags are booleans. What a command leaves out gets the default of the catalog and is
//   stored. A number without a default (the tooth count) is required.
// - `refs` are references to earlier features by the names of the catalog (a gear: `meshWith`).
export type ProfileSource =
  | { type: 'regions'; sketch: Id; regions: RegionRef[]; offset?: number }
  | { type: 'wall'; sketch: Id; curves: Id[]; thickness: number }
  | { type: 'generated'; generator: GeneratorName; sketch: Id; operands: Record<string, Id>; params: Record<string, number | boolean | string>; refs?: Record<string, Id> };

export type GeneratorName = 'involuteGear'; // entries of the generator catalog

// A pattern repeats its source by a list of rigid transforms. The kind of the transform is
// a variant; the first one is a circular pattern around an axis.
// - `features`: extrusions with the operation add or cut. For every copy the tool of each of them
//   is built in the transformed position and applied to the targets of that feature, in the order of
//   the list. The features need not share targets; the list lets a hole repeat with its pocket.
// - `body`: the body in the state before the pattern is copied as new bodies `<pattern>/<number>`,
//   numbered from 1. A copy is a body like any other: a sketch can stand on it, it can be cut and its
//   edges projected.
// - `count` includes the original; 1 means the original alone. The pattern is atomic: when any copy
//   fails, the whole pattern is in error and the model stays as it was before it.
export interface PatternFeature extends FeatureBase {
  type: 'pattern';
  source: { type: 'features'; features: Id[] } | { type: 'body'; body: Id };
  transform: PatternTransform;
}

// Circular pattern: copies turned around the axis. `full`: the step is 2π / count. `angle`: the
// angle between the first and the last copy, so the step is angle / (count − 1); it may be negative.
export type PatternTransform = { type: 'circular'; axis: AxisRef; count: number; span: { type: 'full' } | { type: 'angle'; angle: number } };

// An axis: a base axis of the model, or the normal of a sketch plane led through a point of the
// sketch (an own point, the origin or a point of projected geometry).
export type AxisRef = { kind: 'base'; axis: 'X' | 'Y' | 'Z' } | { kind: 'sketchPoint'; sketch: Id; point: Id };

// Rozsah vysunutí. `start` je posun začátku od roviny skici ve směru její normály; `distance` se
// měří od začátku, kladná míří ve směru normály a nesmí být nula.
// `throughAll` is for a cut only: the tool passes through all targets. `forward` is along the normal
// of the sketch plane, `backward` against it, `both` on both sides; for a sketch on a face the
// normal points out of the body, so an ordinary hole is `backward`. The length is taken from the
// extent of all targets together along the normal, in the state the tool is applied to, plus an
// overshoot. A target that lies entirely on the other side is not changed and the `noEffect`
// warning names it. Further extents ("up to face") will come as variants.
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
export type Extent = { type: 'distance'; start: number; distance: number; taper?: number } | { type: 'throughAll'; side: 'forward' | 'backward' | 'both' };

// ---------------------------------------------------------------- jména

// `curve` of a side face is the ID of the sketch curve it came from; for a generated profile it is
// the name of the side from the generator catalog (a gear: `teeth`).
// A face of a copy made by a pattern carries `copy`: the pattern and the number of the copy (from
// 1); for a pattern of a pattern the list grows, the latest pattern last. Faces of the original
// have no `copy`. A reference to a face of a copy is also a reference to every pattern in the list.
// The faces of a wall (a profile of the type `wall`): every curve of the chain makes two side
// faces, so `side` with the curve would name both.
// - `wallSide`: `side` is the side of the curve in the curve's own direction: a line from its point
//   `a` to `b`; an arc and a circle counter-clockwise, so `left` is the side of the centre. It does
//   not depend on the order of `curves` or on the end the chain is walked from.
// - `wallEnd`: the straight end of an open chain; `point` is the sketch point the chain ends at, as
//   the end curve names it (`a`, `b`, `start` or `end` of the curve).
export type FaceName = (
  | { feature: Id; role: 'side'; curve: Id } // z křivky skici
  | { feature: Id; role: 'startCap' } // víko na začátku rozsahu (při nulovém posunu v rovině skici)
  | { feature: Id; role: 'endCap' } // protější víko
  | { feature: Id; role: 'wallSide'; curve: Id; side: 'left' | 'right' }
  | { feature: Id; role: 'wallEnd'; point: Id }
) & { copy?: CopyTag[] };

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

export interface SolidKernel {
  // Vyhodí výjimku, když výsledek není uzavřené těleso; engine ji ohlásí jako `kernelFailure`.
  boolean(op: BooleanOp, a: Solid, b: Solid): Solid;
  // 2D polygon s dírami; vrací trojice indexů do vrcholů všech smyček za sebou
  triangulate(loops: Float64Array[]): Uint32Array;
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
//   a revolved line; a swept surface (a planar curve moved along `axis`) from gear teeth; a general
//   surface says nothing more.
// - A surface has no side: `normal` of a plane and `axis` of a cylinder carry no sign. Which side the
//   material is on belongs to the face of a body. The exception is `axis` of a cone, which points
//   from the apex towards the face, because a cone has two halves.
export type Surface =
  | { kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { kind: 'cylinder'; origin: Vec3; axis: Vec3; radius: number } // origin: a point of the axis
  | { kind: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number } // radians, between the axis and the surface
  | { kind: 'swept'; axis: Vec3 }
  | { kind: 'general' };

export interface Evaluation {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, BodyResult>; // stav po poslední vyhodnocené feature
  faceNames: FaceName[]; // společná tabulka, index = číslo stěny
  faceSurfaces: Surface[]; // the surface of every face, index = number of the face, like `faceNames`
  parameters: Record<string, ParameterResult>; // values and errors of parameters
  checks: Record<string, CheckResult>; // check results by name
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
// - `failed`: the kernel computes an intersection without a guarantee for flush faces and may
//   fail; such a pair is neither among the colliding ones nor among the clear ones.
export interface InterferenceReport {
  pairs: Interference[];
  fits: Interference[];
  failed: { a: Id; b: Id; message: string }[];
  checked: number; // number of pairs examined
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
export type ErrorCode =
  | 'brokenReference'
  | 'noProfile'
  | 'invalidProfile'
  | 'nonPlanarFace'
  | 'emptyResult'
  | 'kernelFailure'
  | 'invalidExpression';

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
  | 'gearInterference';

export type IssueCode = ErrorCode | WarningCode;

export interface SketchResult {
  points: Record<Id, Point2>; // použité polohy, včetně promítnutých
  radii: Record<Id, number>;
  degreesOfFreedom: number;
  conflicting: Id[];
  redundant: Id[];
  measurements: Record<Id, number>; // hodnoty referenčních kót
  valid: boolean; // false = křivky se kříží, profil je neplatný
  regions: { ref: RegionRef; loops: Float64Array[] }[]; // pro vykreslení a výběr
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
  // Bodies the feature created: an extrusion with the operation `new` its own, a pattern of a body
  // its copies in the order of their numbers. A caller does not have to compose derived IDs.
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
export type Input<T> = T extends number ? number | Expr : T extends readonly (infer U)[] ? Input<U>[] : T extends object ? { [K in keyof T]: Input<T[K]> } : T;

export type Command =
  // časová osa
  | { type: 'addFeature'; feature: Input<Feature>; index?: number } // bez indexu na konec
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
  | { type: 'addConstraint'; sketch: Id; id: Id; constraint: Input<Constraint> | FixedInput } // `fixed` without x, y takes the position of the point
  | { type: 'removeConstraint'; sketch: Id; id: Id }
  // Without `value` neither the value nor the expression changes; a number removes the expression,
  // a string sets it. Switching to a reference dimension removes the expression; an expression given
  // to a reference dimension is an invalid command.
  | { type: 'setConstraintValue'; sketch: Id; id: Id; value?: number | Expr; driving?: boolean }
  | { type: 'dragPoint'; sketch: Id; point: Id; x: number; y: number }
  | { type: 'addExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'updateExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'removeExternal'; sketch: Id; id: Id }
  // složený
  | { type: 'batch'; commands: Command[] };

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
export type FeaturePatch = Patch<Pick<PlaneFeature, 'base' | 'offset'>> | Patch<Pick<ExtrudeFeature, 'profile' | 'extent' | 'operation' | 'targets'>> | Patch<Pick<PatternFeature, 'source' | 'transform'>>;

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
export type QueryOptions = { at?: Id; state?: never } | { state: EngineState; at?: never };

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
  exportMesh(format: 'stl', bodies?: Id[]): Uint8Array; // all bodies without a list; '3mf' později
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

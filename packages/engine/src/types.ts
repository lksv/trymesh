// Veřejné typy enginu: dokument, porty, výsledek přepočtu a API.
// Zdrojem pravdy je docs/architecture.md; typy se s ním mají shodovat.

export type Id = string; // trvalé, nikdy se nerecykluje
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export interface Point2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- dokument

export interface Document {
  schemaVersion: number; // 2; dokument verze 1 se při načtení převede
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

export type Feature = PlaneFeature | SketchFeature | ExtrudeFeature;

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
  | { type: 'midpoint'; point: Id; line: Id }; // bod ve středu úsečky

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

// Where an extrusion takes its profile from: regions of a sketch, or a profile generator.
// `generated`: an entry of the generator catalog (GENERATORS) builds the loops.
// - `operands` are entities of the sketch by the names of the catalog (a gear: `circle`, the pitch
//   circle; it may be a construction circle or a projected one). A command verifies the operands the
//   feature did not have before; an operand removed later is a broken reference in the recompute.
// - `params` follow the catalog: numbers are numeric fields at `profile/params/<name>` and accept an
//   expression, flags are booleans. What a command leaves out gets the default of the catalog and is
//   stored. A number without a default (the tooth count) is required.
// - `refs` are references to earlier features by the names of the catalog (a gear: `meshWith`).
export type ProfileSource =
  | { type: 'regions'; sketch: Id; regions: RegionRef[] }
  | { type: 'generated'; generator: GeneratorName; sketch: Id; operands: Record<string, Id>; params: Record<string, number | boolean | string>; refs?: Record<string, Id> };

export type GeneratorName = 'involuteGear'; // entries of the generator catalog

// Rozsah vysunutí. `start` je posun začátku od roviny skici ve směru její normály; `distance` se
// měří od začátku, kladná míří ve směru normály a nesmí být nula.
// `throughAll` is for a cut only: the tool passes through all targets. `forward` is along the normal
// of the sketch plane, `backward` against it, `both` on both sides; for a sketch on a face the
// normal points out of the body, so an ordinary hole is `backward`. The length is taken from the
// extent of all targets together along the normal, in the state the tool is applied to, plus an
// overshoot. A target that lies entirely on the other side is not changed and the `noEffect`
// warning names it. Further extents ("up to face") will come as variants.
export type Extent = { type: 'distance'; start: number; distance: number } | { type: 'throughAll'; side: 'forward' | 'backward' | 'both' };

// ---------------------------------------------------------------- jména

// `curve` of a side face is the ID of the sketch curve it came from; for a generated profile it is
// the name of the side from the generator catalog (a gear: `teeth`).
export type FaceName =
  | { feature: Id; role: 'side'; curve: Id } // z křivky skici
  | { feature: Id; role: 'startCap' } // víko na začátku rozsahu (při nulovém posunu v rovině skici)
  | { feature: Id; role: 'endCap' }; // protější víko

// a < b v lexikografickém pořadí zápisu feature/role/curve
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

export interface Evaluation {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, BodyResult>; // stav po poslední vyhodnocené feature
  faceNames: FaceName[]; // společná tabulka, index = číslo stěny
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
  | 'noEffect' // `refs` list the targets the operation did not change
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
  // Změna roviny nebo vysunutí; obsah skici mění příkazy skici. Změna se s feature slučuje:
  // - varianta (objekt s `type`: zdroj profilu, rozsah) se stejným `type` se slučuje po polích,
  //   s jiným `type` dosavadní nahradí a musí být úplná;
  // - odkaz (objekt s `kind`: rovina) a seznam se nahrazují celé; `null` odebere nepovinné pole;
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
  | { type: 'addConstraint'; sketch: Id; id: Id; constraint: Input<Constraint> }
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
export type FeaturePatch = Patch<Pick<PlaneFeature, 'base' | 'offset'>> | Patch<Pick<ExtrudeFeature, 'profile' | 'extent' | 'operation' | 'targets'>>;

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
  exportMesh(format: 'stl'): Uint8Array; // '3mf' později
  subscribe(listener: (state: EngineState) => void): () => void;
}

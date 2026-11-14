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
  schemaVersion: number;
  settings: {
    chordTolerance: number; // dělení oblouků na segmenty
  };
  features: Feature[]; // časová osa
}

export type Feature = PlaneFeature | SketchFeature | ExtrudeFeature;

export interface FeatureBase {
  id: Id;
  name: string;
  suppressed: boolean;
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
  | { type: 'tangent'; a: Id; b: Id }; // úsečka–kružnice/oblouk, nebo dvě kružnice/oblouky

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
  sketch: Id;
  regions: RegionRef[];
  distance: number; // kladná = ve směru normály roviny skici
  operation: 'new' | 'add' | 'cut';
  target?: Id; // těleso pro add/cut
}

// ---------------------------------------------------------------- jména

export type FaceName =
  | { feature: Id; role: 'side'; curve: Id } // z křivky skici
  | { feature: Id; role: 'startCap' } // víko v rovině skici
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

export type ErrorCode =
  | 'brokenReference'
  | 'noProfile'
  | 'invalidProfile'
  | 'nonPlanarFace'
  | 'emptyResult'
  | 'kernelFailure';

export type WarningCode =
  | 'sketchConflict'
  | 'brokenProjection'
  | 'degenerateProjection'
  | 'unsupportedProjection'
  | 'noEffect';

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

export interface FeatureResult {
  status: 'ok' | 'warning' | 'suppressed' | 'error';
  error?: Issue; // jen při status 'error'
  warnings: Issue[];
  plane?: Frame; // sketch, plane
  sketch?: SketchResult;
}

// ---------------------------------------------------------------- API

export interface EngineState {
  document: Document;
  evaluation: Evaluation;
  canUndo: boolean;
  canRedo: boolean;
}

export type CommandResult =
  | { ok: true; state: EngineState }
  | { ok: false; error: { code: 'invalidCommand' | 'invalidDocument'; message: string; commandIndex?: number } };

export type Command =
  // časová osa
  | { type: 'addFeature'; feature: Feature; index?: number } // bez indexu na konec
  | { type: 'removeFeature'; id: Id }
  | { type: 'moveFeature'; id: Id; index: number }
  | { type: 'renameFeature'; id: Id; name: string }
  | { type: 'setSuppressed'; id: Id; suppressed: boolean }
  // rovina, extrude
  | { type: 'updatePlane'; id: Id; base?: PlaneRef; offset?: number }
  | {
      type: 'updateExtrude';
      id: Id;
      sketch?: Id;
      regions?: RegionRef[];
      distance?: number;
      operation?: 'new' | 'add' | 'cut';
      target?: Id;
    }
  // skica
  | { type: 'setSketchPlane'; sketch: Id; plane: PlaneRef }
  | { type: 'addPoint'; sketch: Id; id: Id; x: number; y: number }
  | { type: 'addCurve'; sketch: Id; id: Id; curve: Curve; radius?: number } // radius u kružnice
  | { type: 'removeEntity'; sketch: Id; id: Id } // bod nebo křivka
  | { type: 'setConstruction'; sketch: Id; id: Id; construction: boolean }
  | { type: 'addConstraint'; sketch: Id; id: Id; constraint: Constraint }
  | { type: 'removeConstraint'; sketch: Id; id: Id }
  | { type: 'setConstraintValue'; sketch: Id; id: Id; value?: number; driving?: boolean }
  | { type: 'dragPoint'; sketch: Id; point: Id; x: number; y: number }
  | { type: 'addExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'updateExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'removeExternal'; sketch: Id; id: Id }
  // složený
  | { type: 'batch'; commands: Command[] };

export interface Engine {
  execute(cmd: Command): CommandResult; // změní dokument, jeden krok undo
  preview(cmd: Command, at?: Id): CommandResult; // spočítá, ale nezapíše; at = jen po danou feature
  undo(): void;
  redo(): void;
  getState(at?: Id): EngineState; // at = stav modelu po dané feature, dál se nepočítá
  load(json: string): CommandResult;
  save(): string;
  exportMesh(format: 'stl'): Uint8Array; // '3mf' později
  subscribe(listener: (state: EngineState) => void): () => void;
}

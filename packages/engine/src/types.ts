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
  parameters: Parameter[]; // pojmenované parametry (D35 bod 1); engine je zatím neumí, seznam je prázdný
  checks: Check[]; // kontroly parametrů (D35 bod 1); zatím prázdný
  features: Feature[]; // časová osa
}

export interface Parameter {
  name: string;
  expr: string;
}

export interface Check {
  name: string;
  expr: string;
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
  targets?: Id[]; // tělesa pro add/cut; zatím právě jedno
}

// Odkud vysunutí bere profil. Další zdroje (generátor profilu) přibudou jako varianty.
export type ProfileSource = { type: 'regions'; sketch: Id; regions: RegionRef[] };

// Rozsah vysunutí. `start` je posun začátku od roviny skici ve směru její normály; `distance` se
// měří od začátku, kladná míří ve směru normály a nesmí být nula. Další rozsahy přibudou jako varianty.
export type Extent = { type: 'distance'; start: number; distance: number };

// ---------------------------------------------------------------- jména

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
  // Změna roviny nebo vysunutí; obsah skici mění příkazy skici. Změna se s feature slučuje:
  // - varianta (objekt s `type`: zdroj profilu, rozsah) se stejným `type` se slučuje po polích,
  //   s jiným `type` dosavadní nahradí a musí být úplná;
  // - odkaz (objekt s `kind`: rovina) a seznam se nahrazují celé; `null` odebere nepovinné pole;
  // - změna na `operation: 'new'` odebere `targets` sama;
  // - ověřují se jen odkazy, které feature dosud neměla (zopakovaný rozbitý odkaz projde).
  | { type: 'updateFeature'; id: Id; patch: FeaturePatch }
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

// Slučovací změna (viz příkaz updateFeature).
export type Patch<T> = T extends readonly unknown[] | { kind: string } ? T : T extends object ? { [K in keyof T]?: Patch<T[K]> | (undefined extends T[K] ? null : never) } : T;
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

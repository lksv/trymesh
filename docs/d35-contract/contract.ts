// NÁVRH kontraktu pro D35 (docs/decisions.md). Výchozí bod pro implementaci, ne zmrazené rozhraní:
// když se při implementaci ukáže lepší tvar, mění se tento soubor i D35. Zdrojem pravdy o tom,
// co je v kódu, zůstává docs/architecture.md a packages/engine/src/types.ts.
//
// Soubor se nespouští, jen typově kontroluje: npx tsc -p docs/d35-contract/tsconfig.json
// Co se oproti dnešním typům mění, je označené „D35"; ostatní je převzaté beze změny.
import type { OperandSpec } from '../../packages/engine/src/catalog';
import type {
  ConstraintExplanation,
  Curve,
  DimensionShape,
  EdgeKind,
  Frame,
  GeometricConstraint as GeometricConstraintV1,
  Id,
  Point2,
  Projected,
  ProjectionKind,
  RegionRef,
  SketchDiagnosis,
  SketchResult,
  Solid,
  Vec2,
  Vec3,
} from '../../packages/engine/src/types';

export type { Id, Point2, RegionRef, Vec2, Vec3 };

// ================================================================ dokument

// D35: ID tělesa je ID feature (vysunutí s operací new), nebo `<feature>/<místní jméno>`
// (kopie v poli: `<pole>/<číslo>`, číslo od 1). Lomítko v ID zadaném uživatelem být nesmí.
export type BodyId = Id;

// D35: výraz nad parametry. Úhel se ve výrazu píše ve stupních, i goniometrické funkce berou stupně.
export type Expr = string;

// D35: adresa číselného pole uvnitř feature, části oddělené lomítkem (v ID být nesmí):
//   'offset', 'extent/start', 'extent/distance', 'profile/params/teeth', 'transform/count',
//   'transform/angle', 'constraints/<id>/value', 'constraints/<id>/x'.
export type FieldPath = string;

export interface Document {
  schemaVersion: 2; // D35: verze 1 se při načtení převede
  settings: { chordTolerance: number };
  parameters: Parameter[]; // D35: pořadí je jen pro zobrazení
  checks: Check[]; // D35
  features: Feature[];
}

export interface Parameter {
  name: string; // identifikátor; nesmí se jmenovat jako funkce výrazů
  expr: Expr;
}

// Výraz s porovnáním, který má platit. Nesplněná kontrola je varování, model se počítá dál.
export interface Check {
  name: string;
  expr: Expr;
}

export type Feature = PlaneFeature | SketchFeature | ExtrudeFeature | PatternFeature;

export interface FeatureBase {
  id: Id;
  name: string;
  suppressed: boolean;
  // D35: výrazy číselných polí. Číslo v poli je poslední platná vyhodnocená hodnota; zapisuje ho
  // engine po přepočtu stejnou cestou jako vyřešené proměnné skici.
  expressions?: Record<FieldPath, Expr>;
}

export interface PlaneFeature extends FeatureBase {
  type: 'plane';
  base: PlaneRef;
  offset: number;
}

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: PlaneRef;
  points: Record<Id, Point2>;
  radii: Record<Id, number>;
  curves: Record<Id, Curve>;
  constraints: Record<Id, Constraint>;
  external: Record<Id, ExternalRef>;
  solved: { inputs: string; external: Record<Id, Projected> };
}

export type Constraint = GeometricConstraint | Dimension;

export type GeometricConstraint =
  | GeometricConstraintV1
  | { type: 'equalRadius'; a: Id; b: Id } // D35: kružnice nebo oblouky
  | { type: 'fixed'; point: Id; x: number; y: number }; // D35: bod na souřadnicích skici; x, y jsou číselná pole

export type Dimension = { value: number; driving: boolean } & DimensionShape;

export type PlaneRef =
  | { kind: 'base'; plane: 'XY' | 'XZ' | 'YZ' }
  | { kind: 'plane'; feature: Id }
  | { kind: 'face'; body: BodyId; face: FaceName };

export interface ExternalRef {
  type: 'edge';
  body: BodyId;
  edge: EdgeName;
  kind: ProjectionKind;
}

// ---------------------------------------------------------------- vysunutí (D35: krok 0, body 2 a 3)

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  profile: ProfileSource;
  extent: Extent;
  operation: 'new' | 'add' | 'cut';
  targets?: BodyId[]; // new: žádný; add: právě jeden; cut: jeden nebo víc
}

export type ProfileSource =
  | { type: 'regions'; sketch: Id; regions: RegionRef[] }
  | {
      type: 'generated';
      generator: GeneratorName; // položka katalogu generátorů
      sketch: Id;
      operands: Record<string, Id>; // entity skici podle katalogu (ozubení: `circle`, i konstrukční)
      params: Record<string, number | boolean>; // podle katalogu; čísla jsou číselná pole
      refs?: Record<string, Id>; // odkazy na dřívější features podle katalogu (ozubení: `meshWith`)
    };

export type Extent =
  // start: posun začátku od roviny skici ve směru její normály; distance se měří od začátku a nesmí být nula
  | { type: 'distance'; start: number; distance: number }
  // jen u výřezu; forward = ve směru normály roviny skici; rozsah se bere ze všech cílů dohromady
  | { type: 'throughAll'; side: 'forward' | 'backward' | 'both' };

// ---------------------------------------------------------------- pole (D35: bod 4)

export interface PatternFeature extends FeatureBase {
  type: 'pattern';
  // features: vysunutí s operací add nebo cut, opakují se v pořadí seznamu, každá na svých cílech
  source: { type: 'features'; features: Id[] } | { type: 'body'; body: BodyId };
  transform: PatternTransform;
}

// Další druhy (posuvné pole, zrcadlení) přibudou jako varianty.
export type PatternTransform = {
  type: 'circular';
  axis: AxisRef;
  count: number; // celé číslo od 1, včetně originálu
  angle: number; // celkový úhel v radiánech; při plném kruhu je krok angle / count, jinak angle / (count − 1)
};

export type AxisRef =
  | { kind: 'base'; axis: 'X' | 'Y' | 'Z' }
  | { kind: 'sketchPoint'; sketch: Id; point: Id }; // normála roviny skici vedená bodem (i `origin`)

// ================================================================ jména

// D35: `curve` je ID křivky skici, nebo jméno boční stěny z katalogu generátoru (ozubení: 'teeth').
// `copy` nese stěna kopie v poli; u pole z pole víc položek, vnější pole poslední. Stěny originálu
// a všechna dosavadní jména `copy` nemají. V zápisu pro řazení stojí `copy` na konci.
export type FaceName = ({ feature: Id; role: 'side'; curve: Id } | { feature: Id; role: 'startCap' } | { feature: Id; role: 'endCap' }) & { copy?: CopyTag[] };

export interface CopyTag {
  pattern: Id;
  index: number; // číslo kopie od 1
}

export interface EdgeName {
  a: FaceName;
  b: FaceName;
}

// ================================================================ katalogy (veřejné, řídí validaci, GUI i popis pro MCP)

export type Unit = 'mm' | 'rad' | 'count' | 'none';

export interface NumberSpec {
  title: string;
  unit: Unit; // rad: ve výrazu stupně
  rule: 'any' | 'positive' | 'nonNegative' | 'nonZero' | 'angle';
  integer?: { min: number }; // počet zubů, počet kopií; necelé číslo je chyba
  default?: number;
}

export interface FlagSpec {
  title: string;
  flag: true;
  default: boolean;
}

// Číselné pole konkrétní feature: jen řídicí vstupy, ne souřadnice a poloměry, které počítá solver,
// ani hodnoty referenčních kót.
export interface FieldInfo {
  path: FieldPath;
  spec: NumberSpec;
  value: number;
  expr?: Expr;
}
export declare function fieldsOf(feature: Feature): FieldInfo[];

// Typ feature jako položka registru. Veřejná část; validace a krok přepočtu jsou vnitřní (viz konec).
export interface FeatureTypeInfo {
  title: string;
  summary: string;
  bodies: 'none' | 'self' | 'derived'; // self: těleso s ID feature; derived: `<feature>/<místní jméno>`
}
export declare const FEATURE_TYPES: Record<Feature['type'], FeatureTypeInfo>;

export type GeneratorName = 'involuteGear'; // další položky později
export interface GeneratorSpec {
  title: string;
  summary: string;
  operands: OperandSpec[]; // stejný tvar jako u vazeb: jméno a přípustné druhy entit skici
  params: Record<string, NumberSpec | FlagSpec>;
  refs: Record<string, { title: string; generators: GeneratorName[]; required: boolean }>;
  sides: string[]; // jména bočních stěn, která generátor vytváří
}
export declare const GENERATORS: Record<GeneratorName, GeneratorSpec>;

// Parametry ozubení (položka `involuteGear` katalogu), pro čtenáře; v dokumentu jsou to `params`.
export interface InvoluteGearParams {
  teeth: number; // celé číslo od 4; modul plyne z průměru roztečné kružnice
  pressureAngle: number; // rad, výchozí 20°
  backlash: number; // mm po oblouku roztečné kružnice: úbytek tloušťky zubu tohoto kola
  rotation: number; // rad; nepoužije se, když platí odkaz `meshWith`
  internal: boolean; // true: tvar, který se vyřízne z tělesa, aby vzniklo korunové kolo
}

// Syntaxe výrazů pro GUI (kontrola při psaní) a popis pro MCP.
export declare const EXPRESSION_FUNCTIONS: Record<string, { summary: string; args: number }>;
export declare function analyzeExpression(expr: Expr): { ok: true; names: string[] } | { ok: false; error: ExpressionError };

// ---------------------------------------------------------------- nástroje skici (D35: bod 7)

// Místo ve skice a to, k čemu se má přichytit. Aplikace sem dává kliknutí po přichycení, AI souřadnice
// nebo existující bod.
export interface Anchor {
  at: Vec2;
  snap?: { kind: 'point'; id: Id } | { kind: 'curve'; id: Id };
}

export interface SketchToolInputs {
  rectangle: { first: Anchor; opposite: Anchor };
  // vertex určuje velikost a natočení; size přidá kótu (průměr opsané kružnice, nebo rozměr přes plochy)
  polygon: { center: Anchor; vertex: Anchor; sides: number; size?: { kind: 'circumscribed' | 'acrossFlats'; value: number | Expr } };
}
export type SketchToolName = keyof SketchToolInputs;

export interface SketchToolSpec {
  title: string;
  summary: string;
  inputs: Record<string, 'anchor' | NumberSpec | { options: string[] }>;
}
export declare const SKETCH_TOOLS: Record<SketchToolName, SketchToolSpec>;

export interface SketchToolResult {
  commands: Command[]; // posílají se jako jedna dávka
  ids: Record<string, Id[]>; // co vzniklo: polygon má `points`, `lines`, `circle`, `constraints`, `size`
}
// `sketch` a jeho vyřešený stav jsou potřeba kvůli přichycení (vlastní bod se použije znovu, na
// promítnutý vznikne nový bod s vazbou). `newId` dodává volající; MCP server ho generuje sám.
export declare function sketchTool<K extends SketchToolName>(
  tool: K,
  context: { sketch: SketchFeature; result?: SketchResult },
  input: SketchToolInputs[K],
  newId: (prefix: string) => Id,
): SketchToolResult;

// ================================================================ přepočet

export interface Evaluation {
  features: Record<Id, FeatureResult>;
  bodies: Record<BodyId, BodyResult>;
  faceNames: FaceName[];
  parameters: Record<string, ParameterResult>; // D35
  checks: Record<string, CheckResult>; // D35
}

export type ParameterResult = { ok: true; value: number } | { ok: false; error: ExpressionError };

export interface CheckResult {
  status: 'ok' | 'failed' | 'error'; // error: výraz nejde vyhodnotit
  error?: ExpressionError;
}

export interface ExpressionError {
  code: 'syntax' | 'unknownName' | 'cycle' | 'notFinite' | 'rule' | 'notInteger';
  message: string;
  position?: number; // u chyby syntaxe: index znaku ve výrazu
}

export interface BodyResult {
  solid: Solid;
  faces: { id: number; planar: boolean }[];
  edges: { name: EdgeName; kind: EdgeKind; segments: Float64Array }[];
  volume: number; // D35: mm³
  bounds: { min: Vec3; max: Vec3 }; // D35: obálka v osách modelu
}

export interface Issue {
  code: IssueCode;
  message: string;
  refs?: unknown[];
}
export type ErrorCode = 'brokenReference' | 'noProfile' | 'invalidProfile' | 'nonPlanarFace' | 'emptyResult' | 'kernelFailure' | 'invalidExpression'; // D35: invalidExpression
export type WarningCode =
  | 'sketchConflict'
  | 'brokenProjection'
  | 'degenerateProjection'
  | 'unsupportedProjection'
  | 'noEffect' // D35: refs vyjmenují cíle nebo kopie, které se nezměnily
  | 'gearMesh' // D35: odkaz „v záběru s" neplatí (jiný modul nebo úhel záběru, kružnice nejsou tečné); použilo se číslo natočení
  | 'gearInterference'; // D35: hlava protikola naráží do paty pod základní kružnicí
export type IssueCode = ErrorCode | WarningCode;

export interface FeatureResult {
  status: 'ok' | 'warning' | 'suppressed' | 'error';
  error?: Issue;
  warnings: Issue[];
  plane?: Frame;
  sketch?: SketchResult;
  bodies: BodyId[]; // D35: tělesa, která feature vytvořila
  // D35: chyby výrazů po polích (při status 'error' s kódem invalidExpression), aby je GUI ukázalo u pole
  fieldErrors?: Record<FieldPath, ExpressionError>;
  // D35: hodnoty polí s výrazem použité při tomto přepočtu. V dokumentu jsou až po zápisu; náhled
  // (preview) do dokumentu nezapisuje, proto je vrací i zde.
  values?: Record<FieldPath, number>;
}

// ================================================================ příkazy

// D35: vstup příkazu. Kde dokument čeká číslo, smí příkaz poslat číslo, nebo výraz jako řetězec.
// Engine výraz vyhodnotí, číslo doplní a výraz uloží do `expressions` feature. Výraz, který v té
// chvíli nejde vyhodnotit, je neplatný příkaz. Výrazy přijímají jen pole z katalogu číselných polí;
// jinde (souřadnice bodů skici, poloměry) je řetězec neplatný příkaz, i když ho typ dovolí.
// Pozor na úhly: číslo je v radiánech, výraz ve stupních ("30" je třicet stupňů).
export type Input<T> = T extends number ? number | Expr : T extends readonly (infer U)[] ? Input<U>[] : T extends object ? { [K in keyof T]: Input<T[K]> } : T;

// Změna feature: uvedená pole nahradí dosavadní celá (varianty jako `profile` a `extent` se neslučují
// po částech). Typ a ID měnit nejde. U skici jde měnit jen rovina; obsah skici mění příkazy skici.
export type FeaturePatch = Input<
  | Partial<Pick<PlaneFeature, 'base' | 'offset'>>
  | Partial<Pick<ExtrudeFeature, 'profile' | 'extent' | 'operation' | 'targets'>>
  | Partial<Pick<PatternFeature, 'source' | 'transform'>>
  | Pick<SketchFeature, 'plane'>
>;

export type Command =
  // časová osa
  | { type: 'addFeature'; feature: Input<Feature>; index?: number }
  | { type: 'removeFeature'; id: Id }
  | { type: 'moveFeature'; id: Id; index: number }
  | { type: 'renameFeature'; id: Id; name: string }
  | { type: 'setSuppressed'; id: Id; suppressed: boolean }
  | { type: 'updateFeature'; id: Id; patch: FeaturePatch } // D35: nahrazuje updatePlane, updateExtrude a setSketchPlane
  // D35: jedno číselné pole podle adresy; číslo výraz zruší, řetězec ho nastaví
  | { type: 'setField'; feature: Id; path: FieldPath; value: number | Expr }
  // D35: parametry a kontroly
  | { type: 'setParameter'; name: string; expr: Expr; index?: number } // založí, nebo změní
  | { type: 'renameParameter'; name: string; to: string } // přepíše jméno i ve všech výrazech
  | { type: 'removeParameter'; name: string } // výrazy, které ho používají, skončí chybou feature
  | { type: 'setCheck'; name: string; expr: Expr; index?: number }
  | { type: 'removeCheck'; name: string }
  // skica
  | { type: 'addPoint'; sketch: Id; id: Id; x: number; y: number }
  | { type: 'addCurve'; sketch: Id; id: Id; curve: Curve; radius?: number }
  | { type: 'removeEntity'; sketch: Id; id: Id }
  | { type: 'setConstruction'; sketch: Id; id: Id; construction: boolean }
  | { type: 'addConstraint'; sketch: Id; id: Id; constraint: Input<Constraint> | FixedInput } // D35: u `fixed` bez x, y se doplní poloha bodu
  | { type: 'removeConstraint'; sketch: Id; id: Id }
  | { type: 'setConstraintValue'; sketch: Id; id: Id; value?: number | Expr; driving?: boolean }
  | { type: 'dragPoint'; sketch: Id; point: Id; x: number; y: number }
  | { type: 'addExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'updateExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'removeExternal'; sketch: Id; id: Id }
  // složený
  | { type: 'batch'; commands: Command[] };

// Vazba `fixed` v příkazu smí souřadnice vynechat.
export type FixedInput = { type: 'fixed'; point: Id; x?: number | Expr; y?: number | Expr };

// ================================================================ API enginu

export interface EngineState {
  document: Document;
  evaluation: Evaluation;
  canUndo: boolean;
  canRedo: boolean;
}

export type CommandResult = { ok: true; state: EngineState } | { ok: false; error: { code: 'invalidCommand' | 'invalidDocument'; message: string; commandIndex?: number } };

// D35: dvojice těles, která se prolínají objemem nad prahem.
export interface Interference {
  a: BodyId;
  b: BodyId;
  volume: number; // mm³
}

export interface Engine {
  execute(cmd: Command): CommandResult;
  preview(cmd: Command, at?: Id): CommandResult;
  undo(): void;
  redo(): void;
  getState(at?: Id): EngineState;
  diagnoseSketch(sketch: Id): SketchDiagnosis;
  explainConstraint(sketch: Id, constraint: Id): ConstraintExplanation;
  load(json: string): CommandResult; // D35: přijme verzi 1 i 2
  save(): string; // D35: vždy verze 2
  exportMesh(format: 'stl', bodies?: BodyId[]): Uint8Array; // D35: bez seznamu všechna tělesa
  // D35: bez seznamu všechny dvojice; práh výchozí 0,001 mm³; at = stav po dané feature
  interference(options?: { bodies?: BodyId[]; threshold?: number; at?: Id }): Interference[];
  subscribe(listener: (state: EngineState) => void): () => void;
}

// ================================================================ MCP (co přibude)

// Tvar vstupů a výstupů nových a změněných nástrojů. Stávající nástroje, které tu nejsou, se nemění
// (execute a preview přijímají nové příkazy samy, protože berou typ Command).
export interface McpAdditions {
  // nový: parametry s hodnotami a chybami, kontroly s výsledkem
  get_parameters: {
    input: { at?: Id };
    output: { parameters: { name: string; expr: Expr; value?: number; error?: string }[]; checks: { name: string; expr: Expr; status: CheckResult['status']; error?: string }[] };
  };
  // nový: kolize těles
  check_interference: { input: { bodies?: BodyId[]; threshold?: number; at?: Id }; output: { pairs: Interference[]; checked: number } };
  // nový: nástroj skici; provede dávku a vrátí, co vzniklo. `preview: true` jen spočítá.
  sketch_tool: {
    input: { sketch: Id; tool: SketchToolName; input: SketchToolInputs[SketchToolName]; prefix?: string; preview?: boolean };
    output: { ids: Record<string, Id[]>; problems: unknown[] };
  };
  // změna: seznam těles a soubor na těleso
  export_stl: { input: { path: string; bodies?: BodyId[]; perBody?: boolean }; output: { files: { path: string; bodies: BodyId[]; triangles: number }[] } };
  // změna: přehled modelu navíc vrací parametry, nesplněné kontroly a u těles objem a obálku
  get_model: { input: { at?: Id }; output: { addedFields: ['parameters', 'failedChecks', 'bodies[].volume', 'bodies[].bounds', 'features[].bodies'] } };
  // změna: popis API navíc obsahuje katalog číselných polí, generátorů, typů features, nástrojů skici a syntaxi výrazů
  describe_api: { input: Record<string, never>; output: { addedSections: ['expressions', 'numericFields', 'generators', 'featureTypes', 'sketchTools'] } };
}

// ================================================================ vnitřní rozhraní (pro úplnost návrhu, nejsou veřejná)

// Recept nástroje uložený ve stavu přepočtu (krok 0). Pole z něj staví nástroj pro každou kopii;
// délku „skrz vše" počítá proti cílům ve stavu a směru dané kopie.
export interface ToolRecipe {
  operation: 'add' | 'cut';
  targets: BodyId[];
  build(transform: RigidTransform | undefined, targets: Solid[], firstFaceId: number, copy: CopyTag[] | undefined): Tool;
}
export interface Tool {
  solid: Solid;
  faces: { name: FaceName; info: unknown }[]; // info: analytický popis stěny (rovina, válec, obecná plocha)
}
export interface RigidTransform {
  origin: Vec3; // bod na ose
  rotation: [Vec3, Vec3, Vec3]; // řádky matice otočení
  translation: Vec3;
}

// Generátor profilu: čistá funkce. `facts` jsou údaje, které potřebuje jiný generátor při odkazu
// (u ozubení střed, roztečný poloměr, počet zubů, úhel záběru, natočení, vnitřní/vnější), v osách modelu.
export interface GeneratedProfile {
  loops: { xy: number[]; side: string }[]; // vnější smyčka proti směru hodin, díry po směru
  facts: Record<string, number | boolean | Vec3>;
  warnings: Issue[];
}
export type GeneratorBuild = (input: {
  operands: Record<string, { kind: 'circle'; center: Vec2; radius: number } | { kind: 'point'; at: Vec2 } | { kind: 'line'; a: Vec2; b: Vec2 }>;
  params: Record<string, number | boolean>;
  refs: Record<string, GeneratedProfile['facts'] | undefined>; // undefined: odkazovaná feature chybí nebo je v chybě
  frame: Frame;
  chordTolerance: number;
}) => GeneratedProfile;

// NÁVRH kontraktu pro D35 (docs/decisions.md). Výchozí bod pro implementaci, ne zmrazené rozhraní:
// když se při implementaci ukáže lepší tvar, mění se tento soubor i D35. Zdrojem pravdy o tom,
// co je v kódu, zůstává docs/architecture.md a packages/engine/src/types.ts.
//
// Soubor se nespouští, jen typově kontroluje: npx tsc -p docs/d35-contract/tsconfig.json
// Co se oproti dnešním typům mění, je označené „D35"; ostatní je převzaté beze změny.
// Verze po nezávislé revizi 2026-11-14 (viz README, Revize návrhu).
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

// D35: výraz nad parametry. Jednotky jsou stejné jako u čísel: délky v milimetrech, úhly v radiánech.
// Stupně se píšou výslovně funkcí `deg(x)` (stupně → radiány); `pi` je konstanta. Goniometrické
// funkce berou radiány. Funkce se pozná podle závorky za jménem, takže parametr se smí jmenovat
// jako funkce; vyhrazená jsou jen jména konstant (`pi`).
export type Expr = string;

// D35: adresa číselného pole uvnitř feature, části oddělené lomítkem (v ID být nesmí):
//   'offset', 'extent/start', 'extent/distance', 'profile/params/teeth', 'transform/count',
//   'transform/span/angle', 'constraints/<id>/value', 'constraints/<id>/x'.
export type FieldPath = string;

export interface Document {
  schemaVersion: 2; // D35: verze 1 se při načtení převede
  settings: { chordTolerance: number };
  parameters: Parameter[]; // D35: pořadí je jen pro zobrazení
  checks: Check[]; // D35
  features: Feature[];
}

// Jméno je identifikátor (používá se ve výrazech); nesmí být jméno konstanty ani vlastnost každého
// objektu (`constructor`, `__proto__`), stejné pravidlo jako pro ID.
export interface Parameter {
  name: string;
  expr: Expr;
}

// Výraz s porovnáním, který má platit. Nesplněná kontrola je varování, model se počítá dál.
// Jméno je volný text pro člověka (ve výrazech se nepoužívá): neprázdné, jedinečné mezi kontrolami,
// bez okrajových mezer a ne vlastnost každého objektu. Slouží jako klíč v příkazech a ve výsledku.
// Porovnání s tolerancí: a == b, když |a − b| ≤ 1e-9 · max(1, |a|, |b|) (absolutní u nuly, relativní
// u velkých čísel). `!=` je jeho negace, `<` znamená menší a zároveň ne rovno, `<=` menší nebo rovno;
// `>` a `>=` obdobně.
export interface Check {
  name: string;
  expr: Expr;
}

export type Feature = PlaneFeature | SketchFeature | ExtrudeFeature | PatternFeature;

export interface FeatureBase {
  id: Id;
  name: string;
  suppressed: boolean;
  // D35: výrazy číselných polí; jediné místo, kde výrazy v dokumentu jsou. Číslo v poli je poslední
  // platná vyhodnocená hodnota; zapisuje ho engine po přepočtu stejnou cestou jako vyřešené proměnné
  // skici. Pravidla:
  // - Klíčem smí být jen cesta existujícího pole z katalogu číselných polí. Načtení dokumentu
  //   s jinou cestou nebo se syntakticky vadným výrazem je neplatný dokument.
  // - Smazání vazby (i kaskádou z removeEntity a removeExternal) a změna varianty (`distance` na
  //   `throughAll`) odeberou výrazy polí, která tím zanikla.
  // - Referenční kóta (`driving: false`) výraz nemá; přepnutí na referenční ho odebere.
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
      // Podle katalogu: čísla jsou číselná pole, příznaky, volby z výčtu a texty. Co příkaz vynechá,
      // doplní se výchozí hodnotou z katalogu a uloží.
      params: Record<string, number | boolean | string>;
      refs?: Record<string, Id>; // odkazy na dřívější features podle katalogu (ozubení: `meshWith`)
      // Odkaz smí vést jen na dřívější vysunutí s generátorem, který katalog u odkazu uvádí.
    };

export type Extent =
  // start: posun začátku od roviny skici ve směru její normály; distance se měří od začátku a nesmí být nula
  | { type: 'distance'; start: number; distance: number }
  // Jen u výřezu; forward = ve směru normály roviny skici. Délka se bere z rozsahu všech cílů
  // dohromady a přidá se přesah odvozený z rozměru cílů (zřetelně nad rozlišením adaptéru jádra).
  // Cíl, který leží celý na druhé straně, se nezmění a varování „bez účinku" ho vyjmenuje.
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
  count: number; // celé číslo od 1 do horní meze z katalogu, včetně originálu
  // full: kopie rovnoměrně po celém kruhu, krok 2π / count.
  // angle: úhel mezi první a poslední kopií (rad, nenulový, nejvýš ±2π), krok angle / (count − 1);
  // při count = 1 žádná kopie nevzniká.
  span: { type: 'full' } | { type: 'angle'; angle: number };
};

export type AxisRef =
  | { kind: 'base'; axis: 'X' | 'Y' | 'Z' }
  | { kind: 'sketchPoint'; sketch: Id; point: Id }; // normála roviny skici vedená bodem (i `origin`)

// ================================================================ jména

// D35: `curve` je ID křivky skici, nebo jméno boční stěny z katalogu generátoru (ozubení: 'teeth').
// Kolize nehrozí: jedno vysunutí má profil buď z oblastí, nebo z generátoru.
// `copy` nese stěna kopie v poli; u pole z pole víc položek, vnější pole poslední. Stěny originálu
// a všechna dosavadní jména `copy` nemají; prázdný seznam se nepřipouští, aby jedna stěna neměla
// dva zápisy. V zápisu pro řazení stojí `copy` na konci. Stěna kopie vzniká až polem: odkaz na ni
// (rovina skici, promítnutá hrana) je i odkazem na každé pole v `copy`, které musí být feature typu
// pole a ležet před odkazující feature.
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

export interface Bound {
  value: number;
  open?: boolean; // true: hodnota sama přípustná není
}

// Rozsah místo pojmenovaných pravidel. Úhly mají rozsahy v radiánech (úhel záběru (0, π/2), úhel
// pole ±2π, úhlová kóta (−π, π]); hodnota zadaná omylem ve stupních jimi neprojde.
export interface NumberSpec {
  title: string;
  unit: Unit;
  min?: Bound;
  max?: Bound;
  nonZero?: boolean;
  integer?: boolean; // hodnota se od celého čísla smí lišit nejvýš o 1e-9 a zaokrouhlí se; jinak chyba
  default?: number;
}
export interface FlagSpec {
  title: string;
  flag: true;
  default: boolean;
}
export interface OptionSpec {
  title: string;
  options: string[];
  default: string;
}
export interface TextSpec {
  title: string;
  text: true;
  default: string;
}
export type ParamSpec = NumberSpec | FlagSpec | OptionSpec | TextSpec;

// Číselné pole typu feature: statický popis. `path` smí obsahovat `*` na místě ID. `when` říká,
// u které varianty pole existuje. Pole vazeb a parametrů generátoru se neopakují zde; berou se
// z katalogu vazeb a z katalogu generátorů.
export interface FieldSpec {
  path: string; // 'offset', 'extent/distance', 'transform/span/angle'
  spec: NumberSpec;
  when?: { path: string; equals: string }; // například { path: 'extent/type', equals: 'distance' }
}

// Typ feature jako položka registru. Veřejná část; validace a krok přepočtu jsou vnitřní (viz konec).
export interface FeatureTypeInfo {
  title: string;
  summary: string;
  fields: FieldSpec[];
  bodies: 'none' | 'self' | 'derived'; // self: těleso s ID feature (vysunutí jen při operaci new); derived: `<feature>/<místní jméno>`
}
export declare const FEATURE_TYPES: Record<Feature['type'], FeatureTypeInfo>;

// Katalog vazeb: dnešní `value` (jedna hodnota) se mění na pojmenované hodnoty. Kóty mají `value`,
// pevný bod `x` a `y`. Dnes kód pozná kótu podle toho, že má v katalogu hodnotu; to přestává platit
// (pevný bod má hodnoty, ale není kóta a nemá `driving`), proto výslovný příznak.
export interface ConstraintValues {
  values?: Record<string, NumberSpec>;
  dimension?: boolean; // true: vazba je kóta, má `driving` a může být referenční
}

// Číselná pole konkrétní feature, odvozená z katalogů: jen řídicí vstupy, ne souřadnice a poloměry,
// které počítá solver, ani hodnoty referenčních kót.
export interface FieldInfo {
  path: FieldPath;
  spec: NumberSpec;
  value: number;
  expr?: Expr;
}
export declare function fieldsOf(feature: Feature): FieldInfo[];

export type GeneratorName = 'involuteGear'; // další položky později
export interface GeneratorSpec {
  title: string;
  summary: string;
  operands: OperandSpec[]; // stejný tvar jako u vazeb: jméno a přípustné druhy entit skici
  params: Record<string, ParamSpec>;
  refs: Record<string, { title: string; generators: GeneratorName[]; required: boolean }>;
  sides: string[]; // jména bočních stěn, která generátor vytváří
  facts: Record<string, string>; // jména a popisy údajů, které generátor zveřejňuje (FeatureResult.facts)
}
export declare const GENERATORS: Record<GeneratorName, GeneratorSpec>;

// Parametry ozubení (položka `involuteGear` katalogu), pro čtenáře; v dokumentu jsou to `params`.
export interface InvoluteGearParams {
  teeth: number; // celé číslo od 4; modul plyne z průměru roztečné kružnice
  pressureAngle: number; // rad, v intervalu (0, π/2), výchozí deg(20)
  backlash: number; // mm po oblouku roztečné kružnice: úbytek tloušťky zubu tohoto kola
  rotation: number; // rad; nepoužije se, když platí odkaz `meshWith`
  internal: boolean; // true: tvar, který se vyřízne z tělesa, aby vzniklo korunové kolo
}

// Syntaxe výrazů pro GUI (kontrola při psaní) a popis pro MCP. `kind` říká, jestli se čeká číslo,
// nebo porovnání (kontrola); se seznamem jmen se ohlásí i neznámé jméno.
export declare const EXPRESSION_FUNCTIONS: Record<string, { summary: string; args: number }>;
export declare const EXPRESSION_CONSTANTS: Record<string, { summary: string; value: number }>;
export declare function analyzeExpression(expr: Expr, context?: { kind?: 'number' | 'check'; names?: string[] }): { ok: true; names: string[] } | { ok: false; error: ExpressionError };

// ---------------------------------------------------------------- nástroje skici (D35: bod 7)

// Místo ve skice a to, k čemu se má přichytit. Aplikace sem dává kliknutí po přichycení, AI souřadnice
// nebo existující bod.
export interface Anchor {
  at: Vec2;
  snap?: { kind: 'point'; id: Id } | { kind: 'curve'; id: Id };
}

// Vstupy jsou ploché, aby je šlo popsat katalogem.
export interface SketchToolInputs {
  rectangle: { first: Anchor; opposite: Anchor };
  // vertex určuje velikost a natočení. sizeKind a size přidají kótu: průměr opsané kružnice, nebo
  // rozměr přes plochy (jen u sudého počtu stran).
  polygon: { center: Anchor; vertex: Anchor; sides: number; sizeKind?: 'circumscribed' | 'acrossFlats'; size?: number | Expr };
}
export type SketchToolName = keyof SketchToolInputs;

export interface SketchToolSpec {
  title: string;
  summary: string;
  inputs: Record<string, { kind: 'anchor' } | { kind: 'number'; spec: NumberSpec; optional?: boolean } | { kind: 'option'; options: string[]; optional?: boolean }>;
  ids: Record<string, string>; // co vrací v `ids` a v jakém pořadí
}
export declare const SKETCH_TOOLS: Record<SketchToolName, SketchToolSpec>;

// Mnohoúhelník vrací: `points[0]` je bod `vertex`, další proti směru hodin; `lines[i]` vede
// z `points[i]` do `points[i + 1]`; `circle` opsaná kružnice; `constraints`; `size` kóta velikosti.
export type SketchToolResult =
  | { ok: true; commands: Command[]; ids: Record<string, Id[]> } // příkazy se posílají jako jedna dávka
  | { ok: false; message: string }; // degenerovaný vstup (oba rohy obdélníku na stejném místě)
// `sketch` a jeho vyřešený stav jsou potřeba kvůli přichycení (vlastní bod se použije znovu, na
// promítnutý vznikne nový bod s vazbou). `newId` dodává volající a musí vracet ID, která v celém
// dokumentu nejsou; MCP server je generuje a hlídá sám.
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
  code:
    | 'syntax'
    | 'unknownName'
    | 'cycle'
    | 'dependsOnError' // používá parametr, který je sám v chybě
    | 'notFinite'
    | 'outOfRange' // hodnota mimo rozsah pole
    | 'notInteger'
    | 'type'; // číslo, kde se čeká porovnání, nebo naopak
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
// D35: invalidExpression. U skici je to varování, ne chyba: skica se spočítá s poslední platnou
// hodnotou pole (je v dokumentu), aby zůstala vidět a šla opravit, a to, co z ní vychází, nespadlo.
// U ostatních typů features je to chyba.
export type ErrorCode = 'brokenReference' | 'noProfile' | 'invalidProfile' | 'nonPlanarFace' | 'emptyResult' | 'kernelFailure' | 'invalidExpression';
export type WarningCode =
  | 'sketchConflict'
  | 'brokenProjection'
  | 'degenerateProjection'
  | 'unsupportedProjection'
  | 'invalidExpression' // D35: jen u skici, viz výše
  | 'noEffect' // D35: refs vyjmenují cíle nebo kopie, které se nezměnily
  | 'gearMesh' // D35: odkaz „v záběru s" neplatí (jiný modul nebo úhel záběru, kružnice nejsou tečné; porovnává se s tolerancí); použilo se číslo natočení
  | 'gearInterference'; // D35: hlava jednoho kola dvojice naráží do paty druhého pod základní kružnicí; ověřují se obě kola
export type IssueCode = ErrorCode | WarningCode;

export interface FeatureResult {
  status: 'ok' | 'warning' | 'suppressed' | 'error';
  error?: Issue;
  warnings: Issue[];
  plane?: Frame;
  sketch?: SketchResult;
  bodies: BodyId[]; // D35: tělesa, která feature vytvořila
  // D35: chyby výrazů po polích, aby je GUI ukázalo u pole
  fieldErrors?: Record<FieldPath, ExpressionError>;
  // D35: hodnoty polí s výrazem použité při tomto přepočtu. V dokumentu jsou až po zápisu; náhled
  // (preview) do dokumentu nezapisuje, proto je vrací i zde.
  values?: Record<FieldPath, number>;
  // D35: údaje zveřejněné generátorem profilu (ozubení: modul, roztečný, hlavový a patní průměr,
  // počet zubů, použité natočení). Jimi AI ověřuje, co postavila.
  facts?: Record<string, number | boolean | Vec3>;
}

// ================================================================ příkazy

// D35: vstup příkazu. Kde dokument čeká číslo z katalogu číselných polí, smí příkaz poslat číslo,
// nebo výraz jako řetězec. Engine výraz vyhodnotí, číslo doplní a výraz uloží do `expressions`.
// - Číslo a výraz mají stejné jednotky: `"0.5"` a `0.5` znamenají totéž, stupně se píšou `"deg(30)"`.
// - Výraz, který v té chvíli nejde vyhodnotit nebo dá hodnotu mimo rozsah, je neplatný příkaz.
// - Řetězec v poli a položka `expressions` pro tutéž cestu zároveň je neplatný příkaz.
// - Řetězec v poli mimo katalog (souřadnice bodu skici, poloměr) je neplatný příkaz, i když ho typ
//   dovolí. U parametru generátoru rozhoduje katalog, jestli je řetězec výraz, volba, nebo text.
export type Input<T> = T extends number ? number | Expr : T extends readonly (infer U)[] ? Input<U>[] : T extends object ? { [K in keyof T]: Input<T[K]> } : T;

// D35: slučovací změna feature.
// - Varianta (objekt s `type`: zdroj profilu, rozsah, zdroj a transformace pole) se slučuje po
//   polích, když změna `type` neuvádí nebo uvádí stejný; pole, která změna neuvádí, zůstávají
//   včetně svých výrazů. U generovaného profilu platí totéž pro `generator`.
// - Varianta s jiným `type` (nebo jiným `generator`) dosavadní hodnotu nahradí a musí být úplná.
// - Odkaz (objekt s `kind`: rovina, osa) se nahrazuje vždy celý a musí být úplný.
// - Seznamy se nahrazují celé. `null` odebere nepovinné pole; v `params` vrátí výchozí hodnotu
//   z katalogu a v `refs` odebere jeden odkaz.
// - Změna na `operation: 'new'` odebere `targets` sama.
// - Znovu se ověřují jen odkazy na cestách, které změna mění (oprava jedné rozbité reference
//   nesmí narazit na jinou).
// - Pole, které typu feature nepatří, je neplatný příkaz. Typ a ID měnit nejde; obsah skici mění
//   příkazy skici.
export type Merge<T> = T extends number
  ? number | Expr
  : T extends readonly unknown[] | { kind: string }
    ? Input<T>
    : T extends object
      ? string extends keyof T
        ? { [K in keyof T]?: Merge<T[K]> | null } // slovník (`params`, `refs`): null u jedné položky
        : { [K in keyof T]?: Merge<T[K]> | (undefined extends T[K] ? null : never) }
      : T;
export type FeaturePatch = Merge<Pick<PlaneFeature, 'base' | 'offset'>> | Merge<Pick<ExtrudeFeature, 'profile' | 'extent' | 'operation' | 'targets'>> | Merge<Pick<PatternFeature, 'source' | 'transform'>>;

export type Command =
  // časová osa
  | { type: 'addFeature'; feature: Input<Feature>; index?: number }
  | { type: 'removeFeature'; id: Id }
  | { type: 'moveFeature'; id: Id; index: number }
  | { type: 'renameFeature'; id: Id; name: string }
  | { type: 'setSuppressed'; id: Id; suppressed: boolean }
  | { type: 'updateFeature'; id: Id; patch: FeaturePatch } // D35: nahrazuje updatePlane a updateExtrude
  // D35: jedno číselné pole podle adresy; číslo výraz zruší, řetězec ho nastaví
  | { type: 'setField'; feature: Id; path: FieldPath; value: number | Expr }
  // D35: parametry a kontroly. Neplatný příkaz je jen syntaktická chyba a nepřípustné jméno;
  // neznámé jméno, cyklus a ostatní se přijmou a stav je ve výsledku přepočtu (jinak by nešlo
  // založit `Zr = Zs + 2 * Zp` dřív než `Zs`).
  | { type: 'setParameter'; name: string; expr: Expr; index?: number } // založí, nebo změní
  | { type: 'renameParameter'; name: string; to: string } // přepíše jméno i ve všech výrazech
  | { type: 'removeParameter'; name: string } // výrazy, které ho používají, skončí chybou nebo varováním feature
  | { type: 'setCheck'; name: string; expr: Expr; index?: number }
  | { type: 'renameCheck'; name: string; to: string }
  | { type: 'removeCheck'; name: string }
  // skica
  | { type: 'setSketchPlane'; sketch: Id; plane: PlaneRef }
  | { type: 'addPoint'; sketch: Id; id: Id; x: number; y: number }
  | { type: 'addCurve'; sketch: Id; id: Id; curve: Curve; radius?: number }
  | { type: 'removeEntity'; sketch: Id; id: Id }
  | { type: 'setConstruction'; sketch: Id; id: Id; construction: boolean }
  | { type: 'addConstraint'; sketch: Id; id: Id; constraint: Input<Constraint> | FixedInput } // D35: u `fixed` bez x, y se doplní poloha bodu
  | { type: 'removeConstraint'; sketch: Id; id: Id }
  // hodnotu kóty umí stejně i setField; tento příkaz navíc přepíná `driving`
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

export type CommandResult =
  | { ok: true; state: EngineState }
  | {
      ok: false;
      error: {
        code: 'invalidCommand' | 'invalidDocument';
        message: string;
        commandIndex?: number;
        // D35: když příkaz odmítl výraz: kde a proč, aby GUI označilo místo
        expression?: { path?: FieldPath; parameter?: string; check?: string; error: ExpressionError };
      };
    };

// D35: dvojice těles, která se prolínají objemem nad prahem; `a` je menší ID (řazení řetězců).
export interface Interference {
  a: BodyId;
  b: BodyId;
  volume: number; // mm³
}
// Průnik jádro počítá bez záruky pro lícující stěny a může selhat; taková dvojice je ve `failed`,
// ne mezi prolínajícími se ani mezi čistými.
export interface InterferenceReport {
  pairs: Interference[];
  failed: { a: BodyId; b: BodyId; message: string }[];
  checked: number; // počet zkoušených dvojic
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
  interference(options?: { bodies?: BodyId[]; threshold?: number; at?: Id }): InterferenceReport;
  subscribe(listener: (state: EngineState) => void): () => void;
}

// ================================================================ MCP (co přibude)

// Tvar vstupů a výstupů nových a změněných nástrojů. Stávající nástroje, které tu nejsou, se nemění
// (execute a preview přijímají nové příkazy samy, protože berou typ Command).
export interface McpAdditions {
  // nový: parametry s hodnotami a chybami, kontroly s výsledkem
  get_parameters: {
    input: Record<string, never>;
    output: { parameters: { name: string; expr: Expr; value?: number; error?: string }[]; checks: { name: string; expr: Expr; status: CheckResult['status']; error?: string }[] };
  };
  // nový: kolize těles
  check_interference: { input: { bodies?: BodyId[]; threshold?: number; at?: Id }; output: InterferenceReport };
  // nový: nástroj skici; provede dávku a vrátí, co vzniklo. `preview: true` jen spočítá.
  sketch_tool: {
    input: { sketch: Id; tool: SketchToolName; input: SketchToolInputs[SketchToolName]; prefix?: string; preview?: boolean };
    output: { ids: Record<string, Id[]>; problems: unknown[] };
  };
  // změna: seznam těles a soubor na těleso. Jméno souboru je ID tělesa, kde se každý znak mimo
  // písmena, číslice, tečku, pomlčku a podtržítko zapíše jako %XX (`planets/1` → `planets%2F1.stl`);
  // zápis je jednoznačný. Před zápisem se ověří, že se žádná dvě jména neliší jen velikostí písmen
  // a že soubor neexistuje; jinak nástroj nic nezapíše a vrátí chybu.
  export_stl: { input: { path: string; bodies?: BodyId[]; perBody?: boolean }; output: { files: { path: string; bodies: BodyId[]; triangles: number }[] } };
  // změna: výsledek execute, preview, undo a redo navíc hlásí to, co není stavem feature
  commandOutcome: {
    input: never;
    output: { addedFields: ['failedChecks', 'parameterErrors', 'fieldErrors'] };
  };
  // změna: přehled modelu navíc vrací parametry, nesplněné kontroly, u těles objem a obálku, u features vytvořená tělesa a údaje generátoru
  get_model: { input: { at?: Id }; output: { addedFields: ['parameters', 'failedChecks', 'bodies[].volume', 'bodies[].bounds', 'features[].bodies', 'features[].facts'] } };
  // změna: u vazeb navíc výraz (v dokumentu je v mapě u feature, ne u vazby)
  get_sketch: { input: { sketch: Id; at?: Id }; output: { addedFields: ['constraints[].expr'] } };
  // změna: popis API navíc obsahuje syntaxi výrazů, katalog číselných polí, generátorů, typů features a nástrojů skici
  describe_api: { input: Record<string, never>; output: { addedSections: ['expressions', 'numericFields', 'generators', 'featureTypes', 'sketchTools'] } };
}

// ================================================================ vnitřní rozhraní (pro úplnost návrhu, nejsou veřejná)

// Recept nástroje uložený ve stavu přepočtu (krok 0). Pole z něj staví nástroj pro každou kopii;
// délku „skrz vše" počítá proti cílům ve stavu a směru dané kopie. Recept se ukládá i tehdy, když
// zdrojová feature skončila varováním „bez účinku": není v chybě a otočená kopie cíl zasáhnout může.
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

// Generátor profilu: čistá funkce. `facts` jsou údaje pro jiný generátor při odkazu a pro
// FeatureResult.facts; polohy a směry jsou v osách modelu, aby odkaz fungoval i mezi skicami
// v různých rovinách (kola v nerovnoběžných rovinách dají varování gearMesh).
export interface GeneratedProfile {
  loops: { xy: number[]; side: string }[]; // vnější smyčka proti směru hodin, díry po směru
  facts: Record<string, number | boolean | Vec3>;
  warnings: Issue[];
}
export type GeneratorBuild = (input: {
  operands: Record<string, { kind: 'circle'; center: Vec2; radius: number } | { kind: 'point'; at: Vec2 } | { kind: 'line'; a: Vec2; b: Vec2 }>;
  params: Record<string, number | boolean | string>;
  refs: Record<string, GeneratedProfile['facts'] | undefined>; // undefined: odkazovaná feature chybí nebo je v chybě
  frame: Frame;
  chordTolerance: number;
}) => GeneratedProfile;

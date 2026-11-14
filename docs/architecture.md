# Architektura

Stav: odsouhlaseno 2026-11-13 (D10–D28), předpoklady ověřeny spiky. Změny z implementace (D29–D31) čekají na potvrzení; D32 až D34 jsou odsouhlaseny 2026-11-14.

Vychází z [requirements.md](requirements.md) a [decisions.md](decisions.md). Návrh UI je v [ui.md](ui.md).

Poslední úprava: 2026-11-14

## Přehled

```
┌──────────────────────────┐
│ UI + renderer (three.js) │   kreslí, hlásí výběr myší
└───────────┬──────────────┘
            │ příkazy (JSON) ↓        ↑ stav, sítě (typed arrays)
┌───────────┴──────────────────────────────────────────┐
│ Engine (TypeScript, bez runtime závislostí)          │
│                                                      │
│  engine     fasáda: příkazy, undo/redo, náhled       │
│  document   datový model, příkazy, serializace       │
│  sketch     model skici, detekce profilů             │
│  solid      síť tělesa, stavba extrude, jména, STL   │
│  evaluate   přehrání logu, cache, chybové stavy      │
│                                                      │
│  porty:  SketchSolver          SolidKernel           │
└────────────┬──────────────────────┬──────────────────┘
             │                      │
   ┌─────────┴────────┐   ┌─────────┴────────┐
   │ solver-planegcs  │   │ kernel-manifold  │   adaptéry (WASM)
   └──────────────────┘   └──────────────────┘
```

Pravidlo závislostí: engine nezná adaptéry ani renderer. Adaptéry a renderer znají jen veřejné typy enginu. Adaptéry se enginu předají při vytvoření.

## Struktura repozitáře

pnpm workspace. Hranice jsou tím vynucené fyzicky: `engine` nemá v `package.json` žádnou závislost.

```
packages/
  engine/            jádro, čistý TS
  solver-planegcs/   adaptér SketchSolver
  kernel-manifold/   adaptér SolidKernel
  scenarios/         validační scénáře proti skutečným adaptérům (jen testy)
  app/               ukázkové UI + renderer (three.js)
  mcp/               rozhraní pro AI: MCP server a most do běžící aplikace
```

Moduly aplikace (`packages/app/src`): `viewport.ts` (three.js: vykreslení popisu scény, paprsek pod kurzorem, zásah tělesa), `sketch-view.ts` (geometrie skici pro vykreslení, test zásahu a měření), `sketch-commands.ts` (příkazy kreslicích nástrojů, vazby a kóty z výběru), `app.ts` (stav UI, režimy, časová osa, panely). Spouští se `pnpm dev`.

Moduly enginu (`packages/engine/src`): `catalog.ts` (katalog vazeb), `document.ts` (registr typů features, validace a provedení příkazů, načtení a převod starších verzí dokumentu), `analysis.ts` a `diagnose.ts` (rozbor určenosti skici a diagnostika), `sketch.ts` (vstup solveru a razítko, referenční kóty, profily a oblasti), `solid.ts` (síť extrude, stěny a hrany tělesa, rovina na stěně, promítnutí hrany, STL), `evaluate.ts` (přepočet s cache), `engine.ts` (fasáda).

Moduly rozhraní pro AI (`packages/mcp/src`): `tools.ts` (nástroje nad enginem, bez závislosti na Node i prohlížeči), `api.ts` (popis API generovaný ze zdrojů enginu), `server.ts` a `main.ts` (MCP server a jeho spuštění), `bridge.ts` a `bridge-client.ts` (most mezi serverem a aplikací). Sestavuje se `pnpm mcp:build`; je to jediný balíček, který se skládá do jednoho souboru, protože ho spouští Node bez Vite.

Testy: Vitest (`pnpm test`), typová kontrola `pnpm typecheck`. Validační scénáře běží v Node proti skutečným adaptérům. Balíčky se neskládají: každý vystavuje přímo zdrojový TypeScript.

Stav 2026-11-14: oba adaptéry a engine jsou hotové včetně testů; všech šest validačních scénářů prochází v Node proti skutečným adaptérům. Ukázková aplikace pokrývá funkce z [ui.md](ui.md) potřebné k jejich projití v prohlížeči (D31).

## Dvě různé historie

- **Časová osa (feature log)** je recept na model: uspořádaný seznam features (`Plane`, `Sketch`, `Extrude`, `Pattern`). Je součástí dokumentu. Úprava feature uprostřed vyvolá přepočet.
- **Historie příkazů** je záznam uživatelských úprav dokumentu kvůli undo/redo. Není receptem na model.

Skica je **jedna feature** na časové ose. Její obsah (body, křivky, vazby) je stav, ne log. Přidání úsečky do skici je příkaz (jde vrátit přes undo), ale není to nová položka časové osy.

## Dokument

Dokument je neměnná (immutable) datová struktura serializovatelná do JSON. Každý příkaz vrací nový dokument, nezměněné části se sdílejí.

- **Undo/redo** je zásobník předchozích dokumentů.
- **Cache přepočtu** je memoizace podle identity objektů (viz Přepočet).
- **Round-trip**: dokument je jediný zdroj pravdy.

```ts
type Id = string;                    // trvalé, nikdy se nerecykluje
type Vec3 = [number, number, number];

interface Document {
  schemaVersion: number;
  settings: {
    chordTolerance: number;               // dělení oblouků na segmenty
  };
  parameters: Parameter[];                // named parameters, see Parameters and expressions
  checks: Check[];                        // expressions that are supposed to hold
  features: Feature[];                    // časová osa
}

type Feature = PlaneFeature | SketchFeature | ExtrudeFeature | PatternFeature;

interface FeatureBase { id: Id; name: string; suppressed: boolean; expressions?: Record<FieldPath, Expr> }   // expressions: see Parameters and expressions

interface PlaneFeature extends FeatureBase {
  type: 'plane';
  base: PlaneRef;
  offset: number;                   // posun ve směru normály základu
}

interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: PlaneRef;
  points: Record<Id, { x: number; y: number }>;   // řešené proměnné: polohy bodů
  radii: Record<Id, number>;                      // řešené proměnné: poloměry kružnic
  curves: Record<Id, Curve>;
  constraints: Record<Id, Constraint>;
  external: Record<Id, ExternalRef>;              // promítnutá geometrie
  solved: SolveStamp;                             // pro jaké vstupy uložené proměnné platí
}

interface SolveStamp {
  inputs: string;                         // otisk křivek, vazeb a hodnot promítnuté geometrie; počítá engine
  external: Record<Id, Projected>;        // poslední platné hodnoty promítnuté geometrie
}

type Projected =
  | { kind: 'line';   a: [number, number]; b: [number, number] }
  | { kind: 'circle'; center: [number, number]; radius: number };

type Curve = { construction?: boolean } & (
  | { type: 'line';   a: Id; b: Id }                       // ID bodů
  | { type: 'circle'; center: Id }                         // poloměr je v `radii`
  | { type: 'arc';    center: Id; start: Id; end: Id }     // proti směru hodin
);

type ExternalRef = { type: 'edge'; body: Id; edge: EdgeName; kind: 'line' | 'circle' };   // kind: jako co se hrana promítá

// Každá varianta má pojmenované operandy s pevným významem.
type Constraint = GeometricConstraint | Dimension;

type GeometricConstraint =
  | { type: 'coincident';   a: Id; b: Id }            // bod, bod
  | { type: 'pointOnCurve'; point: Id; curve: Id }
  | { type: 'horizontal' | 'vertical'; line: Id }
  | { type: 'parallel' | 'perpendicular' | 'equalLength'; a: Id; b: Id }  // úsečky
  | { type: 'tangent';      a: Id; b: Id }            // úsečka–kružnice/oblouk, nebo dvě kružnice/oblouky
  | { type: 'symmetric';    a: Id; b: Id; line: Id }  // body a, b souměrně podle přímky úsečky (osy)
  | { type: 'midpoint';     point: Id; line: Id };    // bod ve středu úsečky

type Dimension = { value: number; driving: boolean } & (
  | { type: 'distance';           a: Id; b: Id }      // bod–bod (délka úsečky = její koncové body)
  | { type: 'distancePointLine';  point: Id; line: Id }
  | { type: 'horizontalDistance' | 'verticalDistance'; a: Id; b: Id }   // bod, bod; orientovaná: b.x − a.x, resp. b.y − a.y
  | { type: 'angle';              a: Id; b: Id }      // úsečky; úhel od směru `a` ke směru `b`, proti směru hodin, radiány
  | { type: 'radius' | 'diameter'; curve: Id }
);

type PlaneRef =
  | { kind: 'base';  plane: 'XY' | 'XZ' | 'YZ' }
  | { kind: 'plane'; feature: Id }                    // PlaneFeature
  | { kind: 'face';  body: Id; face: FaceName };

interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  profile: ProfileSource;           // odkud se bere průřez
  extent: Extent;                   // odkud kam se vysouvá
  operation: 'new' | 'add' | 'cut';
  targets?: Id[];                   // target bodies: none for new, exactly one for add, one or more for cut
}

type ProfileSource =
  | { type: 'regions'; sketch: Id; regions: RegionRef[] }
  // a profile generator from the catalog (see Extrude, Profile generators)
  | { type: 'generated'; generator: GeneratorName; sketch: Id;
      operands: Record<string, Id>;                        // entities of the sketch by catalog name
      params: Record<string, number | boolean | string>;   // numbers are numeric fields
      refs?: Record<string, Id> };                         // earlier features by catalog name

// `start` je posun začátku od roviny skici, `distance` se měří od začátku; obojí podél normály
// roviny skici, kladné ve směru normály. Těleso vyplní interval [start, start + distance].
// `throughAll` (a cut only): the tool passes through all targets; see Extrude, Extent and targets.
type Extent =
  | { type: 'distance'; start: number; distance: number }
  | { type: 'throughAll'; side: 'forward' | 'backward' | 'both' };
```

The profile source and the extent are variants distinguished by the field `type`. Each has two (D35, points 2 and 3); the extent "up to a face" comes later. A generated profile with another `generator` counts as another variant as well.

ID tělesa je ID feature, která ho založila (`operation: 'new'`). Obecně má ID tělesa tvar `<feature>` nebo `<feature>/<místní jméno>`: část před prvním lomítkem je feature, která těleso vytvořila, a tu validace i pořadí na časové ose berou jako cíl odkazu (`bodyOwner`). An extrusion creates only a body without a local name; a pattern of a body creates the bodies `<pattern>/<number>` (D35, point 4). Délky jsou v milimetrech, úhly v radiánech.

**Registr typů features** (`FEATURE_TYPES` v `document.ts`) drží pro každý typ vše, co o něm potřebuje vědět dokument: validaci a kanonický tvar, odkazy na jiné features s cestou, kde ve feature leží, zda feature vytváří těleso a pojmenovává stěny, a která pole smí měnit `updateFeature`. Validace odkazů, pořadí na časové ose, `moveFeature` i popis API pro AI se řídí registrem, takže nový typ feature je jedna položka registru a jedna větev kroku přepočtu v `evaluate.ts`; úplnost obou míst hlídá překladač. Veřejná část registru je `FEATURE_TYPE_INFO`. It also lists the numeric fields of each type (`fields`); validators read them through the field reader described in Parameters and expressions.

Konvence:
- **ID** generuje volající a posílá je v příkazech (viz API). Musí být v dokumentu jedinečná, nesmí obsahovat znak `/` (ten je vyhrazený pro odvozená ID promítnuté geometrie) a nesmí být `origin`.
- **Směr úsečky** je od bodu `a` k bodu `b`. Úhel kóty `angle` je orientovaný a leží v intervalu (−π, π].
- **Pořadí** tam, kde se mluví o seřazených nebo kanonicky uspořádaných ID a jménech, je lexikografické pořadí řetězců. Jméno stěny se pro porovnání zapíše jako `feature/role/curve`.
- **Základní roviny** mají pevné pravotočivé souřadné systémy (osa X skici, osa Y skici, normála): XY = (+X, +Y, +Z), XZ = (+X, +Z, −Y), YZ = (+Y, +Z, +X).
- **Znaménko kót.** `horizontalDistance` a `verticalDistance` jsou orientované (b − a) a smějí být záporné; UI volí pořadí bodů tak, aby hodnota při vytvoření vyšla kladná. Orientace brání tomu, aby se bod při řešení překlopil na druhou stranu. `distance` a `distancePointLine` jsou neorientované a nezáporné, `radius` a `diameter` kladné.
- **Tolerance enginu** jsou pevné konstanty: délková 1e-6 mm (splněná `coincident`, dotyk křivek při detekci profilu) a úhlová 1e-4 rad (stěny v téže rovině při určování druhu hrany). Tolerance booleanů jsou věcí jádra, engine je nezná.
- **Razítko** `solved.inputs` počítá engine jako otisk kanonického zápisu vstupů (klíče seřazené podle konvence výše). Volající ho nevyplňuje: v `addFeature` posílá skicu s prázdným razítkem (`inputs: ''`, `external: {}`) a engine ho po prvním řešení přepíše.
- **Extent of an extrusion** is a distance with a start offset, or "through all" for a cut (see Extrude, Extent and targets). A hole dimensioned by a fixed distance stops going through when the body gets thicker; a hole through all keeps going through.

### Parameters and expressions (D35, point 1)

The document carries a table of named parameters and a list of checks. Any numeric field the catalog lists accepts an expression over the parameters instead of a number.

```ts
type Expr = string;        // 'module * Zs', 'deg(30)', '-h / 2'
type FieldPath = string;   // address of a numeric field in a feature: 'offset', 'extent/distance', 'constraints/<id>/value'

interface Parameter { name: string; expr: Expr }   // name is an identifier
interface Check { name: string; expr: Expr }       // name is free text; expr is a comparison

interface FeatureBase {
  // ...
  expressions?: Record<FieldPath, Expr>;   // expressions of numeric fields, sorted by address
}
```

**Where an expression lives.** A numeric field always holds a number. The expression is in the `expressions` map of the feature, keyed by the field address; the number next to it is the last valid value. Commands use a different shape: the expression is written straight into the field as a string (type `Input<T>`). `featureInput(feature)` converts the stored form to that input form, and `addFeature(featureInput(f))` gives `f` back. A form that sends a whole feature when editing must start from the input form, because a number sent to a field removes its expression.

**Expression language** (`expression.ts`, own parser, no library).

| Element | Rule |
|---|---|
| Numbers | `1.5`, `.5`, `2e-3`; the decimal separator is a dot |
| Operators | `+ - * / %` (remainder, sign of the dividend; 0 when the quotient is within the equality tolerance of an integer, so `(0.3 / 0.1) % 3 == 0` holds), `^` (power, right-associative, binds tighter than the sign: `-2 ^ 2` is −4), parentheses |
| Names | Parameter names: letters of any alphabet, digits, underscore. A dot is reserved (a syntax error today) for values produced by the recompute |
| Functions | `deg sin cos tan asin acos atan atan2 sqrt abs min max floor ceil round`. A name followed by `(` is a function, so a parameter may be called `min`; a function added later does not break older documents |
| Constants | `pi`; constant names are the only reserved names |
| Checks | Comparisons `== != < <= > >=` and connectives `&& \|\| !`. `a == b` when they differ by at most 1e-9 · max(1, \|a\|, \|b\|); `<` means less than and not equal. Both sides of `&&` and `\|\|` are always evaluated, so an unknown name is an error of the check whichever side decides. Comparing a non-finite number (division by zero) is an error, not a result |
| Limits | At most 1000 characters and 100 levels of nesting; beyond that a syntax error. The parser and the evaluator are recursive and must stay off the stack limit |
| Types | An expression is a number or a truth value, decided statically. A field and a parameter expect a number, a check expects a truth value; the wrong kind is rejected like a syntax error |

Angles are in radians both as numbers and in expressions; `deg(x)` converts degrees. Angle fields have ranges in radians, so a value entered in degrees by mistake is rejected.

**Catalog of numeric fields** (`catalog.ts`, `document.ts`). A field is described by `NumberSpec`: title, unit (`mm`, `rad`, `count`, `none`), optional `min` and `max` with an `open` flag, `nonZero`, `integer` (within 1e-9 of an integer, then rounded) and `default`. `checkNumber` verifies a value against it; plain numbers in commands and values of expressions go through the same function.

- Static description: `FEATURE_TYPE_INFO[type].fields` (`FieldSpec`: address, spec, the variant that has the field) and `CONSTRAINTS[type].values` (named values of a constraint; a dimension has `value` and the flag `dimension`). The API description for AI and the forms of the app read these.
- Fields of a concrete feature: `fieldsOf(feature)` returns address, spec, value and expression. It is not a second list: feature validators read every numeric field through one reader (`Fields.number(value, path, spec)`), and `fieldsOf` is a validation pass that collects what the reader saw. What commands accept and what `fieldsOf` reports therefore cannot drift apart.
- Only driving inputs are fields. Coordinates and radii computed by the solver and values of reference dimensions are not; a string there is an invalid command.

**Validation of expressions** has three modes:

| Mode | When | Expression in a field (string) | Entry in `expressions` |
|---|---|---|---|
| load | `load`, `fieldsOf` | invalid | syntax is checked, the number is kept as the last valid value; an entry for an address that is not a field is an invalid document |
| add | `addFeature`, `addConstraint` | evaluated, the number filled in | evaluated as well; both for one address is an invalid command |
| update | `updateFeature`, `setField`, `setConstraintValue` | evaluated | entries of fields the change does not touch are kept without evaluation; entries of fields that ceased to exist are dropped |

An expression set by a command must evaluate against the parameter table at that moment and its value must be in the range of the field; otherwise the command is invalid and `error.expression` says which field or parameter and why (code, message, position in the text). It can become an error later (a removed parameter, a value out of range); that is a state of the feature, not of the command.

`updateFeature` removes the expressions at and below every address the patch overwrites as a whole (a leaf, a list, a reference, another variant, a removed field). One exception keeps forms usable: a string equal to the expression the field already has is not a change. The field keeps its number and its expression and nothing is evaluated, even if the expression no longer evaluates. A form sends the whole feature in the input form, and without this a broken expression in one field would block a change of any other field (the same rule as a repeated broken reference). `setField` and `setConstraintValue` set one field on purpose and stay strict. `setConstraintValue` without `value` leaves the expression alone; switching a dimension to reference removes it; removing a constraint (also by the cascade of `removeEntity` and `removeExternal`) removes it.

**Parameters and checks** are changed by `setParameter`, `renameParameter`, `removeParameter`, `setCheck`, `renameCheck` and `removeCheck`. Only a syntax error (including the wrong kind of expression) and a disallowed name make these commands invalid. An unknown name and a cycle are accepted and show up in `Evaluation.parameters`; otherwise `Zr = Zs + 2 * Zp` could not be created before `Zs`. `renameParameter` rewrites the name in the expressions of parameters, checks and fields (identifier tokens that are not followed by a parenthesis). A parameter may refer to any other one regardless of order; every parameter on a cycle (one that can be reached from itself) gets the error `cycle` and what depends on a parameter in error gets `dependsOnError`. The table is evaluated dependencies first with an explicit stack, so a long chain of parameters is not a recursion.

**Evaluation and cache** (`evaluate.ts`). Before the step of a feature the recompute resolves it: each expression is evaluated against the environment (today the parameter table) and checked against the range of its field. The result is a `Resolution`: the feature with the values substituted, the values, and the errors by field. A field in error keeps its last valid number.

- The resolution is memoised by the original feature object and by the values and errors its expressions gave, not by the identity of the parameter table. The step cache is keyed by the resolution and the previous state. Changing a parameter therefore recomputes the model from the first feature whose values changed; a parameter no feature uses recomputes nothing.
- The environment is an argument of the resolution. Names whose values come from the recompute (reference dimensions) can extend it later without touching the cache.
- An error is an error of the feature (`invalidExpression`, details in `FeatureResult.fieldErrors`). A sketch is the exception: it is computed with the last valid values and reports `invalidExpression` as a warning, because a sketch in error has no plane and no solved geometry, could not be opened and fixed, and everything built on it would fail.
- `FeatureResult.values` holds the values used in this recompute. A preview does not write to the document, so this is where a form reads the value of an expression being typed.

**Write-back.** After `execute` and `load` the engine writes the substituted numbers into the document, for every feature type and regardless of whether a sketch solved, in the same undo step and through the same path as solved sketch variables. The cache entry is re-hung onto the new feature object. The number in the document is therefore always the last valid value, and a document saved with a broken expression loads again.

**Checks** are evaluated in every recompute into `Evaluation.checks` (`ok`, `failed`, `error`). A failed check does not stop anything.

### Skica

**Body** jsou samostatné entity a křivky na ně odkazují. Dvě úsečky sdílející bod jsou spojené bez vazby. Vazba `coincident` zůstává pro spojení dodatečně.

Křivka smí odkazovat jen na vlastní body skici a na `origin`, ne na odvozené body promítnuté geometrie. K promítnutému bodu se vlastní bod připojí vazbou `coincident`. Smazání promítnutí tak odstraní jen vazby a nikdy nenechá křivku bez koncového bodu.

**Počátek.** Každá skica má rezervovaný bod s ID `origin` v poloze (0, 0). Je pevný, solver s ním nehýbe a nejde smazat. Natočení kotví vazby `horizontal` a `vertical`, které se vztahují k osám skici.

**Oblouk.** `start` i `end` musí ležet ve stejné vzdálenosti od `center`. Tuto implicitní podmínku zajišťuje solver, v dokumentu se jako vazba neukládá.

**Konstrukční geometrie.** Křivka s `construction: true` slouží jen jako pomůcka pro vazby (osy, pomocné čáry). Detekce profilů ji ignoruje.

**Referenční kóty.** Kóta s `driving: false` geometrii neřídí, jen měří. Solveru se neposílá; její hodnotu počítá engine z vyřešených proměnných a vrací ji ve výsledku skici (`measurements`).

**Nadbytečné vazby** nejsou chyba ani varování. Automaticky odvozené vazby je budou vyrábět běžně. Výsledek skici nese v `redundant` jen to, co ohlásí solver, a ten ohlásí z každé závislé skupiny jen některé; úplný přehled dává diagnostika skici (viz níže). Přesnou duplicitu (stejný typ a stejné operandy u dvou řídicích vazeb) engine nepřijme vůbec.

**Promítnutá geometrie (D23).** Položka `external` promítne hranu tělesa do roviny skici jako pevnou referenční křivku. Uživatel k ní váže a kótuje stejně jako k vlastní geometrii, takže například díra drží vzdálenost od okraje nebo soustřednost s válcem i po změně tělesa.

`kind` říká, jako jaká křivka se má hrana promítnout. Volí ho ten, kdo promítnutí zakládá, podle druhu hrany (`edges[i].kind`). Ukládá se proto, že z něj plynou odvozená ID a přípustné vazby: příkaz i `load` tak jdou ověřit jen ze struktury dokumentu, bez přepočtu, a dávka může na promítnutou křivku navázat hned v dalším příkazu.

Co se skutečně promítne, plyne z druhu hrany a z polohy roviny:

| Hrana | Rovina skici | Výsledek | Odvozená ID |
|---|---|---|---|
| přímá | libovolná | úsečka | křivka `<id>`, body `<id>/a`, `<id>/b` |
| přímá, kolmá na rovinu | | nejde promítnout (`degenerateProjection`) | |
| kruhová | rovnoběžná s rovinou kružnice | kružnice | křivka `<id>`, bod `<id>/center` |
| kruhová | šikmá nebo kolmá | elipsa nebo úsečka: **budoucí funkce**, v PoC nejde promítnout (`unsupportedProjection`) | |
| jiná | | nejde promítnout (`unsupportedProjection`) | |

- Hodnoty se počítají při každém přepočtu ze stavu těles **před** touto skicou.
- Solver s promítnutými body nehýbe a poloměr promítnuté kružnice nemění. Detekce profilů je ignoruje.
- Kruhová hrana se promítá vždy jako celá kružnice, i když je hrana jen její částí.
- **Promítnutí, které nejde vyhodnotit, skicu neshodí.** Když hrana zanikla, nejde ji promítnout nebo by se promítla jako jiný druh křivky, než říká `kind` (`unsupportedProjection`), skica dostane varování a promítnutá křivka zůstane zmrazená na posledních platných hodnotách ze `solved.external`. Vazby na ni platí dál. Pokud žádné platné hodnoty nejsou (promítnutí se nepovedlo nikdy), vazby na tuto křivku se při řešení vynechají a varování je vyjmenuje.

**Připravenost na elipsu.** Promítání do šikmé roviny přidá variantu `ellipse` do `Curve`, do `kind` a `Projected` a do portu solveru odpovídající vazby. Zbytek návrhu se nemění: `fixed` v `SolveInput` pracuje s obecnými ID a kód, který zpracovává křivky, musí neznámou variantu odmítnout chybou, ne ji tiše přeskočit. Kružnice promítnutá s `kind: 'circle'`, jejíž rovina se později naklonila, skončí varováním a zůstane zmrazená; uživatel promítnutí založí znovu jako elipsu.

### Řešení skici (D12)

Skica má **řešené proměnné** (polohy bodů v `points`, poloměry kružnic v `radii`) a **vstupy solveru** (křivky, vazby s hodnotami a hodnoty promítnuté geometrie). Razítko `solved.inputs` je otisk vstupů, pro které uložené proměnné platí.

Řešení probíhá na jediném místě, při přepočtu. Příkazy solver samy nevolají (s výjimkou tažení, viz níže), jen mění dokument:

1. Spočítá se promítnutá geometrie ze stavu těles před skicou.
2. **Otisk vstupů se shoduje s razítkem:** uložené proměnné se použijí beze změny. Solver se volá jen kvůli konfliktům a nadbytečným vazbám, které sám hlásí; stupně volnosti počítá engine vlastním rozborem (viz Diagnostika skici).
3. **Neshoduje se:** skica se vyřeší, počátečním odhadem jsou uložené proměnné. Dál v logu se použije výsledek solveru.
4. **Solver řešení nenajde:** použijí se uložené proměnné a skica dostane varování `sketchConflict`. Přehrávání pokračuje, model nezmizí.

Stejné pravidlo tak pokrývá změnu tělesa i úpravu skici samotné. Změna kóty z 40 na 50, přidání vazby nebo nakreslení křivky změní otisk vstupů, takže následný přepočet skicu vyřeší. Platí to shodně pro `execute`, `preview` i `batch` (u dávky se řeší jednou, po posledním příkazu).

**Zápis výsledku.** Po `execute` engine u skic vyřešených v kroku 3 zapíše do dokumentu atomicky všechny řešené proměnné (body i poloměry) a nové razítko, v rámci téhož kroku undo. Při konfliktu se nezapisuje nic, takže se skica při dalším přepočtu zkusí vyřešit znovu.

**Tažení bodu** je jediný příkaz, který solveru dodává vstup mimo dokument (cíl tažení). Engine skicu vyřeší s dočasným cílem, výchozím odhadem jsou vždy uložené proměnné. `preview(dragPoint)` výsledek jen vrátí, `execute(dragPoint)` ho zapíše jako nové proměnné spolu s aktuálním razítkem, stejně jako každé jiné úspěšné řešení. Cíl tažení se do `evaluate` předává parametrem `drag`: promítnutá geometrie skici se musí spočítat ze stavu těles před ní dřív, než se zavolá solver, a features za skicou se počítají z výsledku tažení. Náhledy jsou bezstavové, každý začíná z uložených poloh; spike potvrdil, že to drží bez skoků i při vzdáleném cíli.

**Cache.** Zápis vytvoří nový objekt feature, takže by memoizace podle identity minula. Engine proto záznam v cache převěsí ze starého objektu na nový. Je to korektní z konstrukce: nový objekt projde při přepočtu větví 2 a dá přesně ty proměnné, které předtím dal solver.

Since D35 point 1 the same write-back and re-hanging also carries the values of expressions, for every feature type (see Parameters and expressions).

**Determinismus.** `evaluate` je čistá deterministická funkce dokumentu. Po uložení a načtení se razítko shoduje, solver se pro proměnné nevolá a výsledek je bitově stejný (scénář 4). Opírá se to jen o determinismus solveru a jádra, které spiky potvrdily.

**Vědomý důsledek.** Kvůli zápisu výsledku počítá `execute` vždy celý model, i když uživatel kreslí ve skice uprostřed logu; šetří jen `preview(cmd, at)` a `getState(at)`. Pro PoC je to přijatelné. Pozdější optimalizace: zápis odložit a dopočítat zbytek modelu až při opuštění skici.

### Diagnostika skici (D32)

Dva dotazy, které dokument ani vyhodnocení nemění:

```ts
interface SketchDiagnosis {
  status: 'solved' | 'conflict' | 'failed' | 'unavailable';
  degreesOfFreedom: number;
  conflicting: Id[];
  duplicates: Id[][];   // skupiny řídicích vazeb se stejným typem a operandy
  redundant: Id[];      // vazby, které plynou z ostatních
  removable: Id[];      // sada, kterou jde odebrat naráz beze změny volnosti
  free: { id: Id; kind: 'point' | 'radius'; freedom: number }[];
}
interface ConstraintExplanation {
  redundant: boolean;
  impliedBy: Id[];      // sada ostatních vazeb, ze kterých vazba plyne a ze které nejde nic ubrat
}
```

Diagnostika se počítá **rozborem v prvním řádu**, bez solveru. Každá vazba je jedna nebo dvě rovnice nad polohami bodů a poloměry kružnic (`engine/src/analysis.ts`); k nim se přidá podmínka každého oblouku. Z derivací rovnic ve vyřešeném stavu (Jacobiho matice, numericky) plyne všechno ostatní lineární algebrou:

- **Stupně volnosti** jsou počet proměnných minus hodnost matice. Tuto hodnotu nese i výsledek skici (`degreesOfFreedom`); počet, který hlásí solver, engine nepoužívá.
- **Nadbytečná** je řídicí vazba, jejíž řádky leží v prostoru řádků ostatních vazeb: po jejím odebrání zůstane volnost stejná. V závislé skupině jsou tak označené všechny členy, ne jen ten poslední přidaný: kterýkoli z nich jde odebrat.
- **Sada k odebrání** vzniká postupným odebíráním od nejnovější vazby, dokud to hodnost nesnižuje. Složení sady závisí na pořadí vazeb: starší vazby zůstávají. Počet vazeb v ní na pořadí nezávisí, pokud mají všechny závislé vazby jednu rovnici; vazba se dvěma rovnicemi (totožnost, souměrnost, střed úsečky) může nahradit dvě jiné, takže vedle totožnosti a nulové vodorovné i svislé vzdálenosti týchž bodů je sadou buď totožnost, nebo obě kóty. Odebírá se jen celá vazba: vazba, ze které je navíc jen jedna rovnice ze dvou, v sadě není. Po odebrání celé sady nezbude nadbytečná žádná vazba a geometrie se nezmění. Pořadí vazeb je pořadí klíčů v dokumentu; ID ve tvaru celého čísla řadí JavaScript číselně před ostatní, takže u nich pořadí vzniku neplatí.
- **Vysvětlení vazby** je sada ostatních vazeb, ze kterých plyne a ze které už nejde žádnou vynechat. Sad může být víc a nemusí jít o tu s nejmenším počtem vazeb; přednost má duplicita a pak vazby na stejných entitách. Prázdná sada u nadbytečné vazby znamená, že vazba plyne z definice křivky samotné (konec oblouku leží na oblouku).
- **Volnost entity** je počet nezávislých směrů, kterými se bod může pohnout, aniž poruší vazby (u poloměru kružnice 0 nebo 1). Bod na křivce má volnost 1, volný bod 2. Součet volností může být větší než volnost skici, protože body se hýbou spolu. Rovná-li se volnost bodu volnosti celé skici, stačí ho ukotvit a skica je určená: tak se pozná tvar, kterému chybí jen poloha.
- **Stav.** Při konfliktu nebo neúspěchu solveru se vrací jen stav, konfliktní vazby a duplicity. `unavailable` znamená, že se skica nevyhodnotila (je potlačená nebo má rozbitou rovinu). Neznámá skica nebo vazba je chyba volání (výjimka), stejně jako u `getState(at)`.
- **Referenční kóty a vazby vynechané kvůli ztracené promítnuté geometrii** se diagnostiky netýkají, solver je nedostává.

**Rovnice vazeb** mají rozměr délky, takže jejich derivace jsou bezrozměrné a prahy rozboru nezávisí na měřítku skici. Závisí jen na rozdílech poloh: vyhodnocují se v souřadnicích vzhledem k bodu vazby, aby malý útvar daleko od počátku neztrácel přesnost, a krok derivace se řídí velikostí geometrie vazby. Kde se rovnice s nulovou pravou stranou dělí délkou (rovnoběžnost, kolmost), je dělitelem délka ve vyřešeném stavu, tedy konstanta; dělení větší z obou délek by u stejně dlouhých úseček mělo zlom. Jejich význam musí odpovídat adaptéru solveru; testy ověřují pro každý typ vazby, že vyřešená skica rovnice splňuje a že vazba ubere tolik volnosti, kolik má rovnic. Tabulka rovnic je úplná z typů: nová vazba bez rovnice se nepřeloží.

**Dvojnásobné kořeny.** Rozbor v prvním řádu nevidí podmínku, která ve vyřešeném stavu říká v prvním řádu totéž co jiné vazby, i když skicu ve skutečnosti omezuje. Dva takové případy jsou běžné a rovnice se pro ně volí jinak:

- **Tečnost ve společném bodě.** Úsečka končící na kružnici, které se má dotýkat, nebo dva oblouky navazující ve společném konci (zaoblení, drážka). Obecná rovnice tečnosti (vzdálenost středu od přímky se rovná poloměru) tu má stejný řádek jako podmínka, že konec úsečky leží na kružnici. Tečnost se pak počítá jako kolmost poloměru na úsečku v tom bodě, respektive jako tři body na přímce (oba středy a společný bod). Tato podoba se použije jen tehdy, když konec úsečky nebo oblouku na kružnici drží ostatní vazby (společný bod, totožnost, bod na křivce, obecně cokoli kromě tečností): rozbor to pozná tak, že podmínka „bod leží na kružnici" leží v prostoru řádků ostatních vazeb. Leží-li tam bod jen shodou rozměrů nebo až díky tečnosti samé, platí obecná rovnice; jinak by z rozboru vypadl poloměr kružnice.
- **Nulová vzdálenost dvou bodů** se počítá jako totožnost (dvě rovnice).

Ostatní takové případy rozbor nepozná:

- Vazbu, která z ostatních plyne jen díky konkrétním hodnotám, jako nadbytečnou neoznačí (vzdálenost dvou bodů rovná jejich vodorovné vzdálenosti dělá úsečku vodorovnou). Výsledek tu může záviset na šumu ve vyřešených polohách.
- Společný bod tečnosti, který není koncem úsečky ani oblouku (samostatný bod přichycený na obě křivky), nebo který na kružnici drží až jiná tečnost: volnost vyjde o jedna větší.
- Plyne-li v trojici tečnost, bod na kružnici a kolmost poloměru kterákoli vazba ze zbylých dvou, označí rozbor jako zaměnitelné jen tečnost a kolmost.
- Skica blízko singulárního stavu (řádky závislé s odchylkou řádu 1e-7 až 1e-6) leží na hraně prahu a výsledek může záviset na pořadí vazeb.

**Proč ne solver.** První verze se ptala solveru: řešila skicu znovu bez každé vazby a porovnávala stupně volnosti. Revize ukázala, že počet ze solveru není spolehlivý (cyklus shodných délek v trojúhelníku ohlásí jako plně určený, u úsečky stažené do bodu volnost s přidanou vazbou vzroste, šum ve vyřešených polohách mění výsledek) a že desítky řešení jsou u větších skic pomalé (sekundy až desítky sekund při stovkách vazeb).

**Cena.** Rozbor (derivace a jedna ortogonalizace řádků) se počítá při každém vyhodnocení vyřešené skici, tedy i při každém kroku tažení. Roste se třetí mocninou počtu vazeb: do stovky vazeb jednotky milisekund, 240 vazeb kolem 15 ms, 480 kolem 0,1 s, 960 kolem 0,8 s. Skici v PoC mají desítky vazeb; pro stovky by se rozbor musel počítat až na vyžádání nebo po souvislých částech skici. Diagnostika a vysvětlení k němu přidají další lineární algebru stejného řádu. Výsledek diagnostiky se pamatuje podle vyhodnocené skici: dokud se skica ani stav před ní nezmění, nepočítá se znovu.

**Omezení solveru, které diagnostika odhalí, ale neodstraní.** Nadbytečnou vazbu, kterou solver sám nepozná (třetí rovnost délek v trojúhelníku), bere solver jako plnohodnotnou; skica se pak chová jako plně určená a bodem nejde táhnout, dokud se vazba neodebere.

## Pojmenování

### Stěny

Stěna má strukturované jméno odvozené z původu:

```ts
type FaceName = (
  | { feature: Id; role: 'side'; curve: Id }     // z křivky skici; for a generated profile the side name of the catalog (`teeth`)
  | { feature: Id; role: 'startCap' }            // víko na začátku rozsahu (při nulovém `start` v rovině skici)
  | { feature: Id; role: 'endCap' }              // protější víko
) & { copy?: { pattern: Id; index: number }[] }; // a face of a copy made by a pattern, see Pattern
```

Víko nenese označení oblasti. Všechna víka jedné extrude leží v jedné rovině, takže tvoří jednu logickou stěnu, i když je extrude složená z více oblastí. Nový výběr profilu tak víko nepřejmenuje a skici na něm se nerozbijí.

Každý trojúhelník tělesa nese číslo stěny, tabulka čísel → jmen patří k výsledku přepočtu. Čísla se neukládají, ukládají se jen jména.

| Situace | Chování |
|---|---|
| Booleovská operace | Trojúhelník dědí jméno stěny, ze které pochází. Horní stěna kvádru je i po vyříznutí díry „endCap extrude E1". |
| Stěna se rozdělí na víc částí | Zůstává jednou logickou stěnou (nesouvislou). |
| Stěna zanikne | Jméno nemá žádný trojúhelník → reference je rozbitá → feature je v chybě. |
| Dvě stěny splynou do jedné roviny | Zůstávají dvě stěny s různými jmény. |
| Kružnice nebo oblouk | Všechny segmenty mají stejné jméno, válcová plocha je jedna stěna. |
| A copy made by a pattern | The face has the name of the face it copies with `copy` added: the pattern and the number of the copy. The original keeps its name. |
| A side of a generated profile | All its segments have one name from the generator catalog: the teeth of a gear are one face `{ feature, role: 'side', curve: 'teeth' }`. The name does not depend on the operand, so another pitch circle does not rename the face. |

The analytic description of a face (`FaceInfo` in `solid.ts`, internal) has three kinds: a plane, a cylinder and a general surface swept along the extrusion axis (the side of a generated profile). Only a plane can carry a sketch, and only an edge between a plane and a cylinder is a circle.

### Hrany (D22)

Hrana je rozhraní dvou různě pojmenovaných stěn. Jejím jménem je neuspořádaná dvojice jmen stěn:

```ts
interface EdgeName { a: FaceName; b: FaceName }   // a < b v lexikografickém pořadí zápisu feature/role/curve
```

- Hrana existuje, pokud v síti sousedí aspoň jedna dvojice trojúhelníků s těmito jmény. Jinak je reference rozbitá.
- Hrana rozdělená na víc úseků zůstává jednou logickou hranou.
- Přímá hrana (obě stěny rovinné a různoběžné) leží na průsečnici jejich analytických rovin. Poloha a směr přímky se počítají analyticky, ze sítě se bere jen rozsah (krajní body).
- Přímka je orientovaná směrem n_a × n_b, kde `a`, `b` jsou stěny v kanonickém pořadí jmen a n jejich normály ven z tělesa. Krajní bod `<id>/a` promítnuté úsečky je ten s menším parametrem v tomto směru. Pořadí konců se tak při přepočtu neprohodí.
- Krajní body mají přesnost sítě (viz Přesnost u SolidKernel). Přímka samotná je přesná. Geometrie přichycená na krajní bod proto dá stěny nástroje jen téměř koplanární se stěnami tělesa; s tím počítá záruka jádra č. 3.
- Hrana mezi dvěma stěnami v téže rovině (výstupek zarovnaný s horní stěnou) má druh `coplanar`. Průsečnice neexistuje a hranice nemusí být přímá. Nekreslí se a nejde promítnout. „V téže rovině" znamená, že normály obou stěn svírají úhel pod úhlovou tolerancí enginu. Přesná rovnoběžnost nestačí: stěna z úsečky přichycené na krajní body promítnutých hran je od stěny tělesa odkloněná o zlomek úhlové vteřiny a průsečnice takových rovin by vyšla kilometry daleko.
- Hrana se vrací jako seznam úseček (`segments`), ne jako jedna lomená čára: hrana rozdělená výřezem má víc nesouvislých úseků a jedna čára by je spojila přes prázdný prostor.
- Kruhová hrana je rozhraní boční stěny vzniklé z kružnice nebo oblouku a rovinné stěny kolmé na osu extrude. Střed a poloměr se počítají analyticky z vyřešené zdrojové křivky skici, ze sítě se nebere nic kromě ověření existence.
- Ostatní hrany (válec říznutý šikmou rovinou, průnik dvou válců, the edge of a cap with the side of a generated profile) mají druh `other` a promítnout nejdou.

Pojmenování hran je zároveň předpokladem pro budoucí rovinu nakloněnou kolem hrany, zaoblení a zkosení.

### Rovina skici na stěně

Počítá se analyticky z definice feature, ne prokládáním trojúhelníků. Souřadný systém je pravotočivý a jeho normála míří vždy **ven z tělesa**:

| Stěna | Počátek | Osa Y | Normála N |
|---|---|---|---|
| víko | počátek rodičovské skici promítnutý do roviny víka | osa Y rodičovské skici | ven z tělesa |
| boční stěna z úsečky | počáteční bod úsečky (`a`) v rovině rodičovské skici | normála rodičovské skici | ven z tělesa |
| boční stěna z kružnice nebo oblouku | není rovinná → chyba `nonPlanarFace` | | |
| the side of a generated profile | not planar → error `nonPlanarFace` | | |

Osa X se dopočítá jako Y × N. Nezávisí tedy na pořadí bodů úsečky ani na orientaci smyčky.

Směr „ven" se bere ze sítě: je to součet normál všech trojúhelníků s daným jménem vážený plochou. Jediný trojúhelník by mohl být úzký a dát špatné znaménko. Síť zároveň ověří, že stěna stále existuje. Ze sítě se bere jen znaménko, poloha a osy jsou analytické.

Důsledek: kladná `distance` (i kladný `start`) u extrude ze skici na stěně vždy znamená ven z tělesa, záporná dovnitř.

**Vlastní rovina** (`PlaneFeature`) přebírá souřadný systém základu posunutý o `offset` ve směru jeho normály.

### Profily a oblasti

**Spojování bodů.** Dva body skici se pro účely profilu považují za jeden, když je to tentýž bod, nebo když je spojuje vazba `coincident`, která je v použitých polohách skutečně splněná (vzdálenost do délkové tolerance enginu). Samotná existence vazby nestačí: konfliktní `coincident` mezi dvěma rohy obdélníku, která se nesplnila, profil nezmění. Spojování je tranzitivní a jde i přes počátek a promítnuté body: dva konce přichycené vazbou ke stejnému promítnutému bodu jsou jeden vrchol grafu.

**Graf.** Křivky skici (bez konstrukčních a promítnutých) tvoří rovinný graf. Křivky se smějí dotýkat jen ve spojených bodech. Když se dvě křivky kříží nebo se k sobě jinde přiblíží pod délkovou toleranci, třeba proto, že se profil po vyřešení sám protnul, je profil neplatný a extrude nad touto skicou skončí v chybě `invalidProfile`. Totéž se ověřuje ještě jednou po rozdělení oblouků na úsečky, protože těleso vzniká z lomených čar a ty se od oblouku liší až o `chordTolerance`: když se hranice oblastí po rozdělení kříží (křivka míjí oblouk těsněji, než dělení rozliší) nebo oblast splaskne do dvou bodů (je tenčí než tolerance), je profil také neplatný. Engine tak jádru nikdy nepředá síť, která není uzavřeným tělesem. Platí to i pro tečný dotyk: kružnice tečná k hraně obdélníku, pokud nejsou jedna z nich konstrukční, zneplatní profil celé skici. Je to záměrně přísné a jednoduché; těleso s nulovou tloušťkou stěny by stejně vzniknout nemohlo.

**Oblast** je omezená stěna tohoto grafu, tedy nejmenší uzavřená plocha, kterou křivky ohraničují. Obdélník rozdělený příčkou má dvě oblasti, ne tři. Křivky, které žádnou plochu neuzavírají, se ignorují. Oblast může mít díry: jsou to hranice dalších, do ní vnořených souvislých částí grafu.

```ts
interface RegionRef { outerLoop: Id[] }   // ID křivek na vnější hranici oblasti, seřazená
```

Díry se v referenci neukládají, odvozují se při přepočtu. Když se do skici přidá další kružnice uvnitř obdélníku, oblast „obdélník" ji automaticky dostane jako díru.

Když některá oblast z `regions` neexistuje, extrude skončí celý v chybě `noProfile`. Částečný výsledek se nevytváří. Pravidlo je záměrně striktní: i náhrada jedné křivky hranice jinou mezi stejnými body oblast zruší a uživatel musí profil vybrat znovu. Identifikace hranice body by to obešla, ale je nejednoznačná, když dva body spojuje víc křivek.

**Sousední oblasti.** Boční stěna vznikne jen z křivky, která leží na hranici (vnější nebo na hranici díry) právě jedné z vybraných oblastí. Křivka sdílená dvěma vybranými oblastmi se vyruší. Platí to pro příčku mezi dvěma polovinami obdélníku i pro kružnici mezi obdélníkem s dírou a kruhem v té díře. Jinak by uvnitř tělesa zůstala stěna.

Omezení PoC: oblasti vzniklé křížením křivek se nedetekují, křížení je chyba (viz výše).

## Extrude

Krok přepočtu má tři oddělené části (D35 krok 0), aby šla každá později vyměnit nebo zopakovat samostatně:

1. **Profil.** Ze zdroje profilu vzejdou oblasti v rovině a souřadný systém roviny. A generated profile comes from its generator (below). U zdroje `regions` se vyhodnotí rovina skici a vybrané oblasti; neplatný profil → `invalidProfile`, chybějící oblast → `noProfile`. Oblouky a kružnice jsou rozdělené na segmenty podle `chordTolerance`, nejvýš na 4096 úseček na křivku (u obřích poloměrů pak dělení toleranci nedodrží).
2. **Tool.** The engine builds the closed mesh of a prism over an interval along the normal of the sketch plane: two caps (triangulated by the kernel) and the side faces. For the extent `distance` the interval is `start` to `start + distance`; for `throughAll` it is measured against the targets (below). Every triangle gets a face number by name; `startCap` is the cap at the start of the interval and `endCap` at its end, whichever way the interval points.
3. **Application.** `new` stores the tool as a body. `add` and `cut` hand a tool recipe to `applyTool`, which runs one boolean per target body.

**Tool recipe.** `ToolRecipe` is the operation, the targets and the function `build(targets, firstFaceId, placement?)`, which builds the tool again for the given target solids with face numbers from the given number; `placement` is the rigid transform and the copy tag of a copy made by a pattern. `applyTool` works from the recipe alone and knows nothing about extrusions, so any later feature that produces a tool (a revolve) is applied the same way. It is a function of a model (bodies and the face table) that returns the changed model and the targets it left unchanged, or the reason it failed; the caller decides what that means for its feature. The recompute state keeps the recipe of every `add` and `cut`, also when the operation had no effect (`noEffect`); a feature in error (`brokenReference`, `kernelFailure`, `emptyResult`, a profile error) has none. The pattern reads the stored recipe to repeat the tool in another position. A recipe is stored instead of a mesh because the length of "through all" has to be measured again for every copy.

### Extent and targets (D35, point 2)

**Targets.** `new` has no target, `add` exactly one (adding to several bodies would merge them) and `cut` one or more: a screw hole through two bolted parts is one cut with both bodies as targets. A target may not be listed twice. The tool is built once and subtracted from every target in the order of the list; every changed body carries the tool's faces under the same names, which is unambiguous because a face is always referred to together with its body.

**Through all.** `{ type: 'throughAll', side }` is accepted only with the operation `cut`, because its length comes from the targets. The side is always explicit: `forward` is along the normal of the sketch plane, `backward` against it, `both` on both sides. For a sketch on a face the normal points out of the body, so an ordinary hole is `backward`.

- The interval is computed by `toolSpan` from the vertices of all targets together, projected onto the normal of the sketch plane: `forward` is `[0, high + overshoot]`, `backward` is `[0, low − overshoot]` and `both` is `[low − overshoot, high + overshoot]`, where `low ≤ 0 ≤ high` is the extent of the targets measured from the sketch plane.
- The extent of the whole body counts, not only the part under the profile.
- The overshoot is `max(1 mm, 1 % of the largest absolute coordinate of the targets and of the origin of the sketch plane)`. It keeps the cap of the tool out of the plane of a body face. The kernel adapter resolves about 1e-4 of the largest coordinate of body and tool together, so the overshoot is normally two orders of magnitude above it. Where it is not (a profile far larger than the targets), the adapter takes the cap as flush with the face, which it handles like any flush face; holes then still go through.
- The length is measured every time the tool is built, against the targets in the state the tool is applied to. A hole through all therefore follows a later change of the thickness, and a pattern measures it for every copy.
- A side on which no target reaches gets just the overshoot: the tool misses and the result is `noEffect`.
- The extent has no numeric field, so it has no expression; `FEATURE_TYPE_INFO.extrude.fields` lists `extent/start` and `extent/distance` with `when: extent/type = distance`.

### Profile generators (D35, point 3)

A generator turns a few entities of a sketch and a few parameters into the loops an extrusion sweeps. Operation, extent and targets belong to the extrusion, so a generated profile gets "through all", several targets and later the pattern without further work.

**Catalog.** `GENERATORS` in `generators.ts` is the single source of truth, like the constraint catalog. An entry lists:

| Part | Meaning |
|---|---|
| `operands` | Entities of the sketch by name and the entity kinds accepted (a gear: `circle`). Own curves, construction or not, and projected ones qualify |
| `params` | Numbers (`NumberSpec`: unit, range, default) and flags. A number is a numeric field at `profile/params/<name>` and accepts an expression. A number without a default is required. The document type already allows a string, for options and text of later generators |
| `refs` | References to earlier extrusions whose profile comes from one of the listed generators |
| `sides` | Names of the side faces the generator creates |
| `facts` | What the generator publishes about the profile, with descriptions |

Validation, expressions, `FEATURE_TYPE_INFO.extrude.fields` (the parameters with `when: profile/generator = <name>`), the app's form and the API description for AI are built from the catalog. A new generator is an entry and a build function; the document shape does not change.

**Validation.** Dictionaries may hold only the names the catalog knows, and a profile only the fields of its variant (regions with generator parameters are an invalid command, not plain regions). In a patch `null` may name an entry the catalog knows whether the feature has it or not; any other name that is not there is rejected like every unknown field. Parameters a command leaves out get their defaults and are stored; the profile is stored in the order of the catalog. A command verifies the references the feature did not have before, as everywhere: the sketch, the operands (the entity exists in that sketch and has an accepted kind; `FeatureRef` of the kind `entity`) and the references to other features (an earlier extrusion with one of the accepted generators; kind `generated`). Loading a document verifies only the shape.

**Recompute.** The generator is a pure function `(operands, params, refs, frame, chordTolerance) → regions, facts, warnings` or a failure with a message.

- It reads only the solved operands (centre and radius of the circle), so it does not depend on the profile of the sketch being valid. Pitch circles of gears in mesh touch, which invalidates the profile of the sketch unless they are construction circles.
- An operand that is no longer in the sketch is `brokenReference` with the entity in `refs`.
- A failure (a pointed tooth) and a profile above 50 000 points are `invalidProfile` with the generator's message. The gear knows the size of its loop beforehand and refuses before building it; an arc has at most 4096 chords. A tooth whose tip, or a gap whose root, is narrower than the length tolerance counts as pointed or overlapping.
- `refs` are handed over as the facts of the features referred to; a feature that is missing, suppressed or in error has none, and the generator decides what that means (a gear warns and goes on).
- The regions have the shape of sketch regions (outer loop counter-clockwise, holes clockwise), so the prism builder takes them as they are. Every edge carries the name of its side instead of a curve ID.
- `facts` and the generator's warnings become part of the feature result (`FeatureResult.facts`); warnings make the status `warning`. A feature in error publishes no facts.

**Involute gear** (`involuteGear`). The pitch circle is the operand, the module follows from its diameter and the tooth count.

- Parameters: `teeth` (integer, 4 to 500, required), `pressureAngle` (radians, in (0, π/2), default 20°), `backlash` (mm along the pitch arc, default 0), `rotation` (radians, default 0) and the flag `internal`.
- An external profile is the gear: tip circle `r + m`, root circle `r − 1.25 m`. An internal profile is the tool that cuts a ring gear: it reaches from the tip circle of the ring `r − m` to its root circle `r + 1.25 m` and removes the centre as well.
- The flank is an involute from the base circle; below it the flank is radial. No profile shift, no fillet at the root.
- Backlash thins the tooth of an external gear on the pitch circle and widens the tooth space of a ring.
- The flank is divided evenly in arc length until the chords stay within `chordTolerance`. Chords lie inside the exact tooth, which is the safe side for a gear. The flank of the ring tool is moved outwards by the largest distance of the flank from its chords (a curve parallel to an involute is the same involute turned by distance / base radius), and its arcs are made of tangents instead of chords, so the polyline lies outside the exact tool everywhere and gears with zero backlash do not overlap. The distance is searched for along every chord, because the curvature of an involute changes along it and the farthest point is not the middle one. Without the offset the ring's teeth were up to 0.006 mm too thick.
- `rotation` is the direction of the axis of one tooth in sketch coordinates (for a ring of one tooth space).
- **Mesh.** With `refs.meshWith` the rotation is computed from the other gear's facts, which are in model coordinates, so the two gears may come from different sketches with parallel planes, also mirrored ones. The phase of a gear in a direction from its centre is the fractional part of `(direction − rotation) · teeth / 2π`. For two external gears the phases at the pitch point add up to 1/2; for a gear inside a ring they are equal. Either gear of an internal pair may be the one that refers.
- The mesh needs equal modules (relative 1e-6) and pressure angles, parallel axes and tangent pitch circles (1e-6 of the size). If something does not hold, or the other gear has no facts, the feature has the warning `gearMesh` with the reason and uses the parameter `rotation`.
- With the mesh in place the generator checks whether the tip of one gear runs into the root of the other below its base circle (`gearInterference`): the limit is `√(rb² + (a · sin α)²)`, both gears of an external pair are judged, and for a ring the inequality is reversed.
- Facts: `module`, `teeth`, `pressureAngle`, `backlash`, `internal`, `pitchDiameter`, `baseDiameter`, `tipDiameter`, `rootDiameter` (of the gear; for a ring the tip circle is the inner one), `rotation`, `meshed`, and in model coordinates `center`, `axis` and `toothDirection`.

Výsledky, které nejsou běžné:

| Situace | Chování |
|---|---|
| `cut` misses a target, `add` adds nothing | The target stays unchanged and the feature has the warning `noEffect`, whose `refs` list the unchanged targets. The other targets of a cut are cut, and the message then says that only the targets in `refs` were missed. When nothing changed at all, no face of the tool enters the face table. The change of volume is measured against the smaller of the two solids (body, tool), so a small boss on a large plate does have an effect. |
| `add` kusu, který se tělesa nedotýká | Těleso má dvě nesouvislé části; stav je `ok`. |
| `cut` would remove a whole target | Error `emptyResult` with the target in `refs`; the feature behaves as an empty operation and none of its targets changes, not even those cut before the failing one. |
| A target is missing (removed, suppressed, in error) | Error `brokenReference` with the missing targets in `refs`; nothing is cut. |
| Jádro selže | Chyba `kernelFailure`. |

**Koplanární stěny (D19).** Engine staví nástroj přesně podle skici a nic neposouvá. Skica na stěně znamená, že víko nástroje leží v rovině této stěny; že s tím jádro neumí pracovat spolehlivě, je vlastnost konkrétního jádra a řeší ji jeho adaptér (viz záruka č. 3 u SolidKernel).

## Pattern (D35, point 4)

A pattern repeats its source by a list of rigid transforms. The step asks one function for the transforms of the copies (`transforms` in `evaluate.ts`, by the kind of `transform`; today `circular`) and the rest does not know the kind, so a linear pattern or a mirror is another kind and nothing else.

```ts
interface PatternFeature extends FeatureBase {
  type: 'pattern';
  source: { type: 'features'; features: Id[] } | { type: 'body'; body: Id };
  transform: { type: 'circular'; axis: AxisRef; count: number; span: { type: 'full' } | { type: 'angle'; angle: number } };
}
type AxisRef = { kind: 'base'; axis: 'X' | 'Y' | 'Z' } | { kind: 'sketchPoint'; sketch: Id; point: Id };
```

**Transforms.** `count` includes the original, so there are `count − 1` copies, numbered from 1. `full` turns copy `k` by `k · 2π / count`; `angle` is the angle between the first and the last copy, so the step is `angle / (count − 1)` and may be negative. A base axis goes through the origin of the model. `sketchPoint` is the normal of the sketch plane through a point of the sketch (an own point, `origin` or a point of projected geometry), read from the solved sketch. A positive angle turns counter-clockwise when seen against the axis (the right-hand rule): around the base axis Z it takes X towards Y. Around a sketch point it is counter-clockwise in the coordinates of that sketch, so a sketch on the base plane XZ, whose normal is −Y, turns the other way than the base axis Y. A transform is `RigidTransform` (`solid.ts`): the rows of an orthogonal matrix and a translation.

**Numeric fields.** `transform/count` is an integer from 1 to 200 (the bound keeps a typo in an expression from starting thousands of booleans) and `transform/span/angle` lies in [−2π, 2π] and is not zero; the angle exists only with the span `angle`. A count that an expression makes fractional is an error of the field (`notInteger`), not a rounding.

**A pattern of features.** The sources are extrusions with the operation `add` or `cut` (reference kind `tool`). For every copy, in the order of the copies, the tool of every source is built in the transformed position and applied to the targets of that source, in the order of the list.

- The recipe transforms the frame of the sketch plane and builds the prism there, it does not move a finished mesh. "Through all" is therefore measured along the direction the copy points in, against the targets as they are at the pattern: a hole turned by 90° passes the width of the body, and material added between the source and the pattern is cut as well.
- The triangulation of the profile is computed once per recipe and reused by every build.
- A source that is missing, suppressed or in error has no recipe: the pattern is `brokenReference` with the sources in `refs`. A source that ended with `noEffect` has one, because a turned copy can hit what the original missed.
- The pattern is atomic. When one application fails (`emptyResult`, `kernelFailure`, a missing target), the pattern is in error and the model stays as it was before it; `refs` start with `{ copy, feature }`. The message does not repeat the copy: a client names it from `refs` in its own words.
- Applications that changed none or only some of their targets are listed in one warning `noEffect` with `refs` of the shape `{ copy, feature, targets }`.
- A copy has no effect on a target whenever the volume of the target stays the same, for a cut as well as for an addition. (An extrusion that repeats a cut still counts when faces of its tool end up in the body.) A copy that falls onto the original, as the last of five copies over an angle of 360° does, is therefore listed in `noEffect` and the hole keeps the faces of the original.
- Time: every copy is one boolean per target on the body as it has grown so far, so the time of a pattern of features grows with the square of the count (about 10 s for 100 holes in a disc and 30 s for 200; a pattern of a body copies meshes and takes 0.3 s for 200 gear bodies). Joining the copies of one cut into a single boolean per target would make it linear and is not done.

**A pattern of a body.** The body in the state before the pattern is copied as new bodies `<pattern>/<number>`.

- The copy gets a new face number for every face the body has at that moment, whichever feature or earlier pattern it came from. The name is the old one with the copy tag appended and the analytic description is moved with the copy (`transformFace`), so the top of a copy is still a plane a sketch can stand on and the rim of its hole is still a circle.
- `transformSolid` moves the vertices and renumbers the faces; with a negative determinant (a mirror, later) it reverses the order of the triangle vertices.
- `FeatureResult.bodies` lists the copies in the order of their numbers. A feature that refers to a copy the count no longer reaches is `brokenReference`.
- What is added to the source after the pattern is not copied; what is moved before it is.
- The facts of a generated profile stay with the source feature; a copy publishes none.

**Derived body IDs.** The ID of a body is the ID of the feature that created it or `<feature>/<local name>` (`bodyOwner`). The registry decides whether a feature creates the body: a pattern does for a body source and a local name that is a number from 1 without leading zeros. Whether the copy with that number exists shows only in the recompute, because the count may be an expression. A dependency on a copy is a dependency on its pattern (`featureRefs`), so `moveFeature` keeps the pattern in front of what uses its copies.

**Copy tags.** A face of a copy carries `copy: [{ pattern, index }]`; a pattern of a pattern appends another tag, the latest last. Faces of the original have none, and an empty list is normalized to none, so one face has one spelling. A reference to such a face (the plane of a sketch, either face of a projected edge) is also a reference to every pattern in the list: validation requires each to be a pattern before the referring feature and the number an integer from 1. The key of a name used for comparing and ordering appends `/@<pattern>:<index>` per tag.

## Porty

### SketchSolver

```ts
interface SketchSolver {
  solve(input: SolveInput): SolveResult;
}

interface SolveInput {
  points: Record<Id, { x: number; y: number }>;   // počáteční odhad
  radii: Record<Id, number>;                      // počáteční odhad poloměrů kružnic
  curves: Record<Id, Curve>;                      // včetně promítnutých křivek
  constraints: Record<Id, Constraint>;
  fixed: Id[];                                    // body, které se nehýbou, a kružnice s pevným poloměrem
  drag?: { point: Id; target: { x: number; y: number } };
}

interface SolveResult {
  status: 'solved' | 'conflict' | 'failed';
  points: Record<Id, { x: number; y: number }>;
  radii: Record<Id, number>;
  degreesOfFreedom: number;          // 0 = plně určená
  conflicting: Id[];                 // vazby v konfliktu
  redundant: Id[];
}
```

Bezstavová funkce. Načtení WASM je asynchronní a proběhne při vytvoření adaptéru, `solve` je synchronní.

Záruky implementace:
1. Body ve `fixed` se nepohnou, kružnice ve `fixed` nezmění poloměr.
2. U každého oblouku leží `start` i `end` na stejném poloměru kolem `center`.
3. Stejný vstup dá vždy stejný výstup.

planegcs navíc vrací splněný vstup bitově beze změny (ověřeno spikem), ale návrh se o to neopírá.

Když solver najde stav, který není použitelná geometrie (nekonečná hodnota, nekladný poloměr, oblouk s konci na různých poloměrech), vrací adaptér `failed`.

Jak adaptér planegcs řeší:
1. Při tažení nejdřív vyřeší skicu bez tažení a zjistí nadbytečné vazby. S dočasným cílem tažení by je knihovna ohlásila jako konflikt, proto se při tažení vynechají.
2. Vyřeší skicu. Když výchozí algoritmus (DogLeg) nedoběhne a konflikt nehlásí, zkusí Levenberg–Marquardt; stejně postupuje FreeCAD.
3. Řeší znovu z nalezeného stavu, dokud není ustálený. Knihovna totiž stupně volnosti a nadbytečné vazby hlásí podle výchozího odhadu, ne podle výsledku, a ve stavu `Converged` může nechat nadbytečnou vazbu nesplněnou. Vrácená diagnostika tak popisuje vrácenou geometrii a opakované řešení z výsledku dá totéž; o to se opírá krok 2 řešení skici (jen diagnostika z uložených proměnných).

Adaptér překládá každou variantu `Constraint` na odpovídající vazbu knihovny jedna ku jedné podle `type`. Neznámý druh křivky nebo ID ve `fixed`, které není bod ani kružnice, je výjimka. Pomocné vazby, které si přidává sám (podmínky oblouku, pevný poloměr promítnuté kružnice), z `conflicting` a `redundant` odfiltruje: výsledek smí obsahovat jen ID ze vstupu. Při stavu `conflict` nebo `failed` nemá `degreesOfFreedom` význam: knihovna vrací −1, adaptér předá 0 a UI se řídí varováním `sketchConflict` a seznamem `conflicting`.

Referenční kóty (`driving: false`) se solveru neposílají. Engine je před voláním odfiltruje a jejich hodnotu spočítá z vyřešených poloh. planegcs s nimi podle spiku nepracuje spolehlivě.

### SolidKernel

```ts
interface Solid {
  positions: Float32Array;   // xyz
  triangles: Uint32Array;    // indexy vrcholů
  faceIds: Uint32Array;      // číslo stěny pro každý trojúhelník
}

interface SolidKernel {
  boolean(op: 'union' | 'difference' | 'intersection', a: Solid, b: Solid): Solid;
  triangulate(loops: Float64Array[]): Uint32Array;   // 2D polygon s dírami: vnější smyčka proti směru hodin, díry po směru
}
```

Předpoklad na vstupu: čísla stěn v `a` i `b` pocházejí z jedné společné tabulky. Stejné číslo znamená stejnou stěnu, různé stěny mají různá čísla. Zajišťuje to engine (viz tabulka čísel stěn v sekci Přepočet).

Záruky implementace:
1. Výstup `boolean` je uzavřené těleso.
2. Každý výstupní trojúhelník má `faceId` stěny, ze které pochází.
3. Rovinné stěny obou operandů, které leží v jedné rovině v rámci tolerance jádra a překrývají se, se berou jako shodné. Výsledek neobsahuje blány, vnitřní stěny ani zbytky stěn, které měly zaniknout. Platí pro sjednocení a rozdíl; průnik engine v PoC nepoužívá a adaptér Manifoldu u něj záruku neplní.
4. Stejný vstup dá vždy stejný výstup.

Když adaptér výsledek zaručit nedokáže, skončí výjimkou a engine ji ohlásí jako `kernelFailure`. Potichu vadné těleso vrátit nesmí. Výjimkou končí i vadný vstup: neuzavřená nebo dovnitř orientovaná síť, nesedící počet čísel stěn.

**Jak záruku č. 3 plní adaptér Manifoldu.** Manifold sám toleranci ke skoro-koplanárním plochám nemá a na šikmých stěnách kvůli float32 selhává. Adaptér se proto řídí jedním pravidlem: stěny nástroje a tělesa se v jedné rovině nesmějí jen dotýkat. Každý takový styk změní před booleanem na skutečný průnik a po booleanu posunuté stěny vrátí.

Před booleanem:
1. Proloží roviny stěnami obou těles (podle čísel stěn). Stěna je rovinná, když její vrcholy leží do tolerance od proložené roviny. Podle normál jednotlivých trojúhelníků se nerozhoduje: úzký trojúhelník z dřívějšího booleanu má normálu nespolehlivou a celou stěnu by označil za nerovinnou.
2. Najde dvojice stěn nástroje a tělesa v jedné rovině, které se překrývají, dotýkají, nebo je dělí mezera do dvou přesahů. Dotyk se počítá, protože bok nálitku se boku tělesa dotýká jen hranou. Mezera se počítá, protože se stěny posunem sousedních stěn o přesah protáhnou.
3. Stěnu nástroje posune o přesah tak, aby se nástroj zvětšil. Jediná výjimka: u rozdílu, když nástroj na těleso dosedá zvenku, se nástroj zmenší. Když stěna nástroje potká ve své rovině stěny obou orientací (horní stěnu a spodek převisu), má zvětšení přednost; zmenšení by na lícující části nechalo blánu.
4. Vrcholy posouvá podél průsečnic sousedních stěn, aby se sousední stěny nenaklonily.

Po booleanu:
5. Vrátí zpět vše, co po posunu ve výsledku zůstalo. Polohy se neodhadují z okolí, dopočítají se přesně z původní, neposunuté geometrie. Každý vrchol výsledku je totiž buď vrchol jednoho z těles, nebo průsečík hrany jednoho tělesa se stěnou druhého:
   - posunutý vrchol nástroje se vrátí na původní vrchol,
   - průsečík hrany nástroje, jejíž konec se posunul (včetně úhlopříček triangulace), se stěnou tělesa se přesune do průsečíku původní hrany s rovinou té stěny,
   - průsečík hrany tělesa s posunutou stěnou nástroje, a každý jiný vrchol v pásu mezi původní a posunutou rovinou, se přesune po té hraně tělesa do původní roviny,
   - průsečík, který by na původní hraně ležel mimo její konce, v přesné geometrii neexistuje; stáhne se do bližšího konce.
6. Vyčistí síť, a to vždy, i když se nic neposouvalo:
   - sloučí vrcholy na stejném místě,
   - zahodí trojúhelníky s vrcholy v přímce a blány nulové tloušťky,
   - hrany, které tím zůstaly bez protějšku, dorovná: trojúhelník s takovou hranou rozdělí ve vrcholu, který na ní leží a ve kterém protější strana navazuje (T-spoj),
   - the two steps before can undo each other (a split leaves a piece the dropping takes for a null triangle, which opens the same edge again), so the cleanup remembers the states it has split and stops after splitting one of them for the second time; that state is the closed one,
   - kde se těleso samo sebe dotýká jen hranou, rozdělí povrch po klínech materiálu.
7. Ověří výsledek a jinak skončí chybou (`kernelFailure`):
   - síť je uzavřená plocha (každá hrana právě ve dvou trojúhelnících, jednou v každém směru),
   - žádná rovinná stěna nemá trojúhelník otočený proti své normále.

Proč jsou kroky 5 až 7 nutné:
- Bez návratu leží zbylá stěna o přesah vedle roviny, kterou pro ni engine počítá analyticky, a další operace na ní selže: nálitek zavěšený na takové stěně skončil ve spiku jako samostatná komponenta s mezerou 0,002 mm. Výstup adaptéru tedy musí být konzistentní s analytickou geometrií v rámci přesnosti float32, ne v rámci přesahu.
- Bez čištění zůstanou po pásu nulové šířky trojúhelníky, které dál nesou číslo zaniklé stěny, a reference na ni by se nerozbila. Totéž nechává jádro samo tam, kde se nástroj tělesa jen dotkne hranou; proto se čistí vždy.
- Bez kontroly by chyba prošla potichu. Manifold síť, která není uzavřenou plochou, při dalším booleanu načte bez chyby, část trojúhelníků zahodí a změní objem (ve spiku o stovky mm³).

Co se ukázalo až v obecně natočené poloze a v náhodných testech:
- Roviny stěn se prokládají přes celou stěnu. Normály jednotlivých trojúhelníků výsledku použít nejde: úzké trojúhelníky je mají vychýlené o desítky stupňů.
- Návrat jen „do roviny" nestačí. Průsečík hrany, která se posunem natočila, zůstane ve správných rovinách, ale o zlomek přesahu vedle. Sám nevadí, dokud pozdější nástroj nemá stěnu přesně v tom místě; pak se síť přeloží. Proto se polohy dopočítávají z původních hran.
- Svislá hrana válce může ležet celá v rovině boku tělesa. Průsečík s takovou rovinou není určený; bere se nejpříčnější ze stěn tělesa, kterých se vrchol dotýká.
- Posun vrcholů nástroje před booleanem se počítá v ortonormální bázi normál. Výpočet přes regularizovanou soustavu 3×3 byl pro vrchol držený jedinou šikmou rovinou nestabilní.
- Tenký trojúhelník není totéž co trojúhelník s vrcholy v přímce. Jádro běžně vrací jehly: dva vrcholy pár desetitisícin od sebe a třetí daleko. Jehla má plochu a do sítě patří. Za nulový se proto bere trojúhelník užší než čtvrtina tolerance slučování (přesnost float32), širší jen tehdy, když jeho prostřední vrchol leží zřetelně uvnitř nejdelší strany.
- Dělit se smějí jen hrany bez protějšku. První verze dělila každou hranu, u které ležel cizí vrchol dost blízko její přímky. U zdravé hrany vycházející pod malým úhlem to vedlo ke střídání dvou stavů, z nichž ani jeden nebyl uzavřený.
- Po dotyku hranou se zdvojené vrcholy při dalším booleanu zase sloučí a dělí znovu. Dělení přes nový vrchol uprostřed hrany tak při každé další operaci zdvojnásobilo počet trojúhelníků v místě dotyku. Kde to jde, zdvojí se proto existující vrchol.
- Přesnost float32 klesá se vzdáleností od počátku. Tolerance odvozené jen z rozměru modelu selhávaly u modelu 60 mm velkého a 450 mm vzdáleného od počátku.
- Zmenšený nástroj mohl přeskočit stěnu tělesa ležící těsně za jeho stěnou; materiál mezi nimi zůstal jako blána. Posouvá se proto nejvýš do poloviny mezery.

Důsledek pro jména: kde stěna nástroje lícuje se stěnou tělesa a překrývají se plochou, nese překrytou část ve výsledku jméno stěny nástroje. Obě stěny dál existují a dělí je hrana druhu `coplanar`.

Všechny tolerance odvozuje adaptér z rozměru D: úhlopříčka obálky obou těles, nejméně však dvojnásobek největší souřadnice (model daleko od počátku má horší přesnost float32). Stejná rovina 1e-5 D, přesah 4e-5 D, slučování vrcholů 1e-6 D. V dokumentu ani v core se nenastavují.

Omezení:
- **Rozlišení.** Detail menší než asi 1e-4 D (u modelu 70 mm kolem 0,01 mm) těsně u lícujících stěn adaptér nezvládá spolehlivě: schod nebo mezera této velikosti, o kterou se nástroj posouvá. Výsledek je pak buď správný, nebo chyba `kernelFailure`; testy z revize potvrzují, že potichu vadný není. Od 0,05 mm výš prošly všechny zkoušené polohy.
- Řeší se jen rovinné stěny. Válcová stěna nástroje shodná s válcovou stěnou tělesa (rozšíření díry na stejný poloměr, výřez přesně podle válcového nálitku) ne; povrch pak vyjde špatně a chyba se neohlásí.
- Stěna nástroje užší než 8e-5 D (kapsa hluboká pár tisícin) se pro určení roviny nepoužije a lícování na ní se nepozná.
- Průnik se neupravuje (viz záruka č. 3).
- Návrat posunutých stěn porovnává každý vrchol výsledku se všemi posunutými hranami nástroje a hranami tělesa. U těles do několika tisíc trojúhelníků to nevadí; u desky se 192 kruhovými otvory (19 tisíc trojúhelníků) trval jeden boolean 7,6 s, samotné jádro 0,07 s. Prostorové vyhledávání je možná pozdější optimalizace.
- Vyčištění průchodem přes Manifold nejde použít: nulové trojúhelníky sbalil špatným směrem a poškodil těleso. Síť si adaptér čistí sám.
- Těleso, které se samo sebe dotýká jen hranou, adaptér zpracuje (v síti jsou v místě dotyku zdvojené vrcholy). Geometricky je to ale mezní stav a další operace přesně v místě dotyku zkoušené nejsou.
- Zkoušené nástroje jsou hranoly (kvádry, trojboké hranoly se šikmou stěnou) a válce. Jiné v PoC nevznikají, nástroj je vždy extrude.
- Výřez, jehož víko zároveň lícuje se spodkem převisu a leží na opačně orientované stěně v téže rovině, přejmenuje dotčenou část té stěny na víko nástroje. Geometrie je správná.
- Obalová funkce `triangulate` v knihovně neuvolňuje paměť WASM (u smyčky s 256 body 8 kB na volání). Adaptér proto volá funkci pod ní a paměť uvolňuje sám; je to vnitřní rozhraní knihovny a při její aktualizaci se musí ověřit.

**Přesnost (D20).** Manifold přijímá i vrací souřadnice jen ve `Float32Array`, proto je má `Solid` také v tomto typu. Engine geometrii nikdy neodvozuje ze sítě, pokud ji umí spočítat analyticky; analytické výpočty běží ve float64. Naměřená odchylka vrcholů od roviny po 12 booleanech za sebou na šikmé stěně byla 2e-6.

`Solid` jsou čistá data. Přechod na B-rep by znamenal jiný typ tělesa a jiný adaptér; jména, reference a přepočet zůstanou.

## Přepočet

V kódu je přepočet metodou třídy `Evaluator` (`evaluate.ts`), která drží cache; adaptéry dostane při vytvoření. Signatura popisuje vstupy a výstup:

```ts
function evaluate(doc: Document, deps: { solver; kernel }, opts?: {
  upTo?: Id;                                                        // skončit u této feature
  drag?: { sketch: Id; point: Id; target: { x: number; y: number } };   // tažení bodu, viz Řešení skici
}): Evaluation;

interface Evaluation {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, BodyResult>;           // stav po poslední vyhodnocené feature
  faceNames: FaceName[];                    // společná tabulka, index = číslo stěny
  parameters: Record<string, ParameterResult>;   // values and errors of parameters
  checks: Record<string, CheckResult>;           // 'ok' | 'failed' | 'error' by check name
}

interface BodyResult {
  solid: Solid;
  faces: { id: number; planar: boolean }[];             // stěny, které těleso má
  edges: { name: EdgeName; kind: 'line' | 'circle' | 'coplanar' | 'other'; segments: Float64Array }[];   // segments: úsečky, 6 čísel na úsečku
}

interface Issue { code: IssueCode; message: string; refs?: unknown[] }

type IssueCode =
  // chyby: feature nemá výsledek
  | 'brokenReference' | 'noProfile' | 'invalidProfile' | 'nonPlanarFace'
  | 'emptyResult' | 'kernelFailure'
  | 'invalidExpression'            // an error everywhere except a sketch, where it is a warning
  // varování: feature výsledek má
  | 'sketchConflict' | 'brokenProjection' | 'degenerateProjection' | 'unsupportedProjection'
  | 'noEffect'
  | 'gearMesh' | 'gearInterference';   // from the gear generator, see Profile generators

interface FeatureResult {
  status: 'ok' | 'warning' | 'suppressed' | 'error';
  error?: Issue;                 // jen při status 'error'
  warnings: Issue[];
  bodies: Id[];                  // bodies the feature created: an extrusion with `new` its own, a pattern of a body its copies
  plane?: { origin: Vec3; x: Vec3; y: Vec3; normal: Vec3 };   // sketch, plane
  sketch?: {
    points: Record<Id, { x: number; y: number }>;   // použité polohy, včetně promítnutých
    radii: Record<Id, number>;
    degreesOfFreedom: number;
    conflicting: Id[];
    redundant: Id[];
    measurements: Record<Id, number>;               // hodnoty referenčních kót
    valid: boolean;                                 // false = křivky se kříží, profil je neplatný
    regions: { ref: RegionRef; loops: Float64Array[] }[];   // pro vykreslení a výběr
  };
  fieldErrors?: Record<FieldPath, ExpressionError>;   // expression errors by field
  facts?: Record<string, number | boolean | Vec3>;    // what the profile generator published
  values?: Record<FieldPath, number>;                 // values of fields with an expression used in this recompute
}
```

- `evaluate` je čistá funkce dokumentu.
- Přehrává se lineárně od první feature. Stav po každé feature se memoizuje podle identity objektu feature a identity předchozího stavu, takže nezměněný začátek logu se nepřepočítává. With expressions the key is the resolved feature (see Parameters and expressions), so the identity changes only when a value of an expression changes.
- Feature ve stavu `error` se chová jako prázdná operace a přehrávání pokračuje. Co na ní závisí, skončí také v chybě.
- Feature ve stavu `warning` výsledek má a závislé features s ním pracují normálně.
- Potlačená feature (`suppressed`) se chová jako prázdná operace, stejně jako feature v chybě. Co na ní závisí, skončí v `brokenReference`, promítnutí v `brokenProjection`.
- `upTo` ukončí přehrávání u zadané feature. Náhled při úpravě feature uprostřed logu tak nepočítá nic za ní.

**Tabulka čísel stěn.** Čísla stěn jsou součástí memoizovaného stavu, ne vlastností jednoho běhu. Stav po každé feature nese tabulku jmen; feature, která vytváří nové stěny, přidá jejich jména na konec tabulky předchozího stavu. Číslo stěny je tak funkcí začátku logu a sedí i tehdy, když se začátek bere z cache. Tabulka je jedna společná pro všechna tělesa, čísla se neukládají do dokumentu.

Graf závislostí (přeskočení nezávislých features) je možná pozdější optimalizace.

## API enginu

```ts
interface Engine {
  execute(cmd: Command): CommandResult;          // změní dokument, jeden krok undo
  preview(cmd: Command, at?: Id): CommandResult; // spočítá, ale nezapíše; at = jen po danou feature
  undo(): void;
  redo(): void;
  getState(at?: Id): EngineState;                // at = stav modelu po dané feature, dál se nepočítá
  diagnoseSketch(sketch: Id): SketchDiagnosis;   // viz Diagnostika skici
  explainConstraint(sketch: Id, constraint: Id): ConstraintExplanation;
  load(json: string): CommandResult;
  save(): string;
  exportMesh(format: 'stl'): Uint8Array;         // '3mf' později
  subscribe(listener: (state: EngineState) => void): () => void;
}

interface EngineState {
  document: Document;
  evaluation: Evaluation;
  canUndo: boolean;
  canRedo: boolean;
}

type CommandResult =
  | { ok: true; state: EngineState }
  | { ok: false; error: { code: 'invalidCommand' | 'invalidDocument'; message: string; commandIndex?: number;
      expression?: { path?: FieldPath; parameter?: string; check?: string; error: ExpressionError } } };   // a rejected expression: where and why
```

### Příkazy

Příkazy jsou čistá JSON data. ID nových entit generuje volající a posílá je v příkazu, takže dávka může na právě vytvořený bod odkázat hned v dalším příkazu.

```ts
type Command =
  // časová osa
  | { type: 'addFeature'; feature: Input<Feature>; index?: number }   // bez indexu na konec; Input: a numeric field may be an expression
  | { type: 'removeFeature'; id: Id }
  | { type: 'moveFeature'; id: Id; index: number }
  | { type: 'renameFeature'; id: Id; name: string }
  | { type: 'setSuppressed'; id: Id; suppressed: boolean }
  // rovina, extrude (skica má vlastní příkazy níže)
  | { type: 'updateFeature'; id: Id; patch: FeaturePatch }
  | { type: 'setField'; feature: Id; path: FieldPath; value: number | Expr }   // one numeric field by its address
  // parameters and checks
  | { type: 'setParameter'; name: string; expr: Expr; index?: number }         // creates or changes
  | { type: 'renameParameter'; name: string; to: string }                      // rewrites expressions too
  | { type: 'removeParameter'; name: string }
  | { type: 'setCheck'; name: string; expr: Expr; index?: number }
  | { type: 'renameCheck'; name: string; to: string }
  | { type: 'removeCheck'; name: string }
  // skica
  | { type: 'setSketchPlane'; sketch: Id; plane: PlaneRef }
  | { type: 'addPoint'; sketch: Id; id: Id; x: number; y: number }
  | { type: 'addCurve'; sketch: Id; id: Id; curve: Curve; radius?: number }   // radius u kružnice
  | { type: 'removeEntity'; sketch: Id; id: Id }                              // bod nebo křivka
  | { type: 'setConstruction'; sketch: Id; id: Id; construction: boolean }
  | { type: 'addConstraint'; sketch: Id; id: Id; constraint: Input<Constraint> }
  | { type: 'removeConstraint'; sketch: Id; id: Id }
  | { type: 'setConstraintValue'; sketch: Id; id: Id; value?: number | Expr; driving?: boolean }
  | { type: 'dragPoint'; sketch: Id; point: Id; x: number; y: number }
  | { type: 'addExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'updateExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'removeExternal'; sketch: Id; id: Id }
  // složený
  | { type: 'batch'; commands: Command[] };
```

**`updateFeature` je slučovací změna.** `patch` obsahuje jen pole, která se mění, ve stejném tvaru jako feature; `{ extent: { distance: 12 } }` změní vzdálenost a začátek nechá být. Pravidla:

- Vnořený objekt se s dosavadním slučuje po polích, pokud je to táž varianta (`type` změna neuvádí, nebo je stejný). Jiná varianta dosavadní hodnotu nahradí celou a musí být úplná. A generated profile with another `generator` is another variant too.
- The dictionaries of a generated profile (`operands`, `params`, `refs`) merge by entry: `{ profile: { params: { rotation: 'deg(5)' } } }` leaves the other parameters with their expressions. `null` removes an entry: a parameter returns to its default and loses its expression (a required one cannot be removed), a reference ceases to exist. Removing an entry that is not there is not an error.
- Odkaz (objekt s polem `kind`: `PlaneRef`, or the `AxisRef` of a pattern) a seznam se nahrazují celé. Půlka odkazu (objekt bez `kind` tam, kde odkaz je) je neplatný příkaz: sloučení by vybralo jinou stěnu téhož tělesa.
- `null` volitelné pole odebere (`targets: null`). Pole s hodnotou `undefined` (jen z kódu, v JSON není) znamená „neměnit".
- Pole, které výsledná feature nemá (překlep, pole jiné varianty rozsahu), je neplatný příkaz, ne úspěch bez účinku.
- Měnit jde jen pole, která typ feature v registru vyjmenovává (rovina `base`, `offset`; vysunutí `profile`, `extent`, `operation`, `targets`; a pattern `source`, `transform`). ID, jméno, potlačení a typ feature mají vlastní příkazy nebo se nemění; skica se mění jen svými příkazy.
- Přechod na `operation: 'new'` cíle zahodí, pokud je změna sama neuvádí.
- Výsledná feature se ověří celá. Odkazy na jiné features se ale ověřují jen ty, které feature dosud neměla (jiné místo, druh nebo ID): oprava rozbitého odkazu na skicu nesmí narazit na rozbitý cíl, který změna nechává být, a změna vzdálenosti projde i u feature, jejíž skica byla smazána. Platí to i tehdy, když změna dosavadní odkaz zopakuje (formulář aplikace posílá vysunutí celé) nebo mění jen operaci.

**Validace.** Každý příkaz se před provedením ověří. Neplatný příkaz dokument nezmění a vrátí `invalidCommand` s popisem. Dávka je atomická: neplatný kterýkoli příkaz zruší celou dávku a `commandIndex` říká, který to byl. Validace pracuje jen se strukturou dokumentu, přepočet k ní není potřeba. Ověřuje se:

- **ID** nových entit jsou jedinečná a splňují konvence: bez `/`, ne `origin`, ne prázdné a ne jméno vlastnosti, kterou má každý objekt (`constructor`, `toString`…), protože ID jsou klíče záznamů.
- **Odkazy uvnitř skici** musí vést na existující entity správného typu (vazba `parallel` dostala dvě úsečky). Křivka odkazuje na vlastní body nebo `origin`. Vazba smí odkazovat i na promítnutou geometrii; její odvozené entity plynou z `kind` (`<id>`, `<id>/a`, `<id>/b` u úsečky, `<id>`, `<id>/center` u kružnice). Protože mazání ve skici kaskáduje, platí toto pravidlo v každém dokumentu.
- **Odkazy mezi features** se ověřují tam, kde je příkaz nastavuje (`addFeature`, `updateFeature`, `setSketchPlane`, `addExternal`, `updateExternal`): cílová feature existuje, má správný typ a leží před odkazující feature. U stěny a hrany se takto ověřuje těleso i extrude, které stěnu pojmenovalo (stěna existuje až po něm). Odkaz na těleso vede na feature, která ho vytvořila (část ID před lomítkem), a ta musí těleso toho místního jména vytvářet. `moveFeature` nesmí feature přesunout před feature, na kterou odkazuje, ani za feature, která odkazuje na ni.
- **Odkaz na feature, která v dokumentu není, validaci neporušuje.** Vzniká povoleným `removeFeature` a projeví se až při přepočtu jako `brokenReference`, `noProfile` nebo `brokenProjection`. Totéž platí pro jména stěn a hran a pro ID křivek v `regions`: ta se strukturálně ověřit nedají a rozbíjejí se běžnými úpravami.
- **Vazba musí mít aspoň jeden operand, kterým solver může hýbat.** Řídicí vazbu jen mezi pevnými entitami (počátek, promítnutá geometrie) solver tiše ignoruje, takže by se nikdy neprojevila ani jako konflikt; je proto neplatná. Referenční kóta mezi pevnými entitami platná je.
- **Stejná řídicí vazba nesmí být ve skice dvakrát.** `addConstraint` odmítne vazbu se stejným typem a stejnými operandy, jaké už má jiná geometrická vazba nebo řídicí kóta; u vazeb s operandy `a`, `b` na jejich pořadí nezáleží. Platí to i pro kótu s jinou hodnotou (upravit se má ta stávající) a pro přepnutí referenční kóty na řídicí. Referenční kóta smí měřit totéž co řídicí. `load` duplicity přijímá, aby šly otevřít starší dokumenty; ukáže je diagnostika a hodnotu takové kóty jde dál měnit. Druhy operandů, jejich zaměnitelnost a pravidla hodnot jsou v katalogu vazeb (`engine/src/catalog.ts`), kterým se validace řídí.
- **Hodnoty.** Čísla jsou konečná a v rozsahu ±1e9; záporná nula se ukládá jako nula. `extent.distance` u extrude není nula a `profile.regions` není prázdné (tatáž oblast dvakrát je jedna oblast). `add` has exactly one body in `targets`, `cut` one or more without repeats, `new` none. The extent `throughAll` is accepted only with `cut` and needs `side`. Poloměr nové kružnice je kladný. Hodnoty kót splňují konvenci znamének.
- `origin` a odvozené entity promítnuté geometrie nejde smazat ani jimi táhnout.

Příkaz, který je strukturálně v pořádku, ale vede k chybě přepočtu (konfliktní vazba, zaniklá stěna), se provede a problém se objeví ve stavu feature.

**Chování fasády:**

- **Krok undo vzniká jen změnou obsahu dokumentu.** Přejmenování na stejné jméno nebo tažení plně určeného bodu historii nezaplní.
- **Tažení, které solver nevyřeší,** dokument ani stav enginu nezmění; konflikt z neúspěšného pokusu ukáže jen `preview`.
- **`getState(at)` s neznámou feature vyhodí výjimku; `preview(cmd, at)`** vrátí `invalidCommand`, když `at` v dokumentu po příkazu není. Tichý přepočet celé osy by zakryl chybu volajícího.
- **Posluchači (`subscribe`)** dostanou stavy v pořadí, v jakém vznikly, i když některý z nich sám zavolá engine: vnořená změna se rozešle až po dokončení právě běžícího kola. Výjimka posluchače ostatní o zprávu nepřipraví a vyhodí se až nakonec; stav je v té chvíli už zapsaný.
- **Nový bod a nová křivka ruší razítko řešení skici,** protože zapisují řešené proměnné přímo. Skica se pak při přepočtu vyřeší znovu, i kdyby se otisk vstupů solveru shodoval.

**Pravidla mazání:**

- `removeEntity` kaskáduje: smazání bodu odstraní křivky, které na něm stojí, a smazání bodu nebo křivky odstraní vazby, které na ně odkazují. Křivky v `regions` pozdějších extrude zůstanou a extrude skončí v `noProfile`.
- `removeExternal` odstraní vazby na promítnutou křivku a její odvozené body. Vlastní křivky na promítnuté body neodkazují, takže se jich mazání netýká.
- `updateExternal` zachová ID, takže vazby zůstanou. Smí změnit hranu, ne `kind`: změna druhu by změnila odvozená ID. Kdo chce místo úsečky kružnici, promítnutí smaže a vytvoří nové.
- `removeFeature` nekaskáduje: závislé features zůstanou a skončí v chybě. Opravit je jde bez ztráty ID: `updateFeature` umí u vysunutí změnit i zdrojovou skicu (spolu s novým výběrem oblastí) a cíl, u roviny základ; `setSketchPlane` rovinu skici.

**`load`** ověří verzi schématu a tatáž pravidla nad celým dokumentem. Současná verze schématu je 2. Dokument verze 1 se před validací převede (`upgrade` v `document.ts`): vysunutí dostane `profile`, `extent` s nulovým začátkem a seznam `targets`, dokument prázdné `parameters` a `checks`. Převod mění jen tvar, takže převedený dokument dává bitově stejný model a vyřešené skici se neřeší znovu; `save` ukládá vždy současnou verzi. Dokument s neprázdnými `parameters` nebo `checks` engine zatím odmítne, aby je tiše nezahodil; platí to i pro dokument verze 1, který je kdovíproč má. Odkazy na neexistující features jsou přípustné (viz výše), takže dokument, který vznikl povolenými příkazy, jde vždy uložit a znovu načíst, i když obsahuje features v chybě. Neplatný dokument se nenačte, stav enginu se nezmění a vrátí se `invalidDocument`. Po načtení se vyřešené skici zapíší do dokumentu stejně jako po `execute` a historie undo se smaže.

### Co z API vzešlo z návrhu UI (D24)

- **`batch`**: nakreslení úsečky s automaticky odvozenými vazbami musí být jeden krok undo.
- **`addFeature` s pozicí**: vložení feature doprostřed logu.
- **`getState(at)` a `preview(cmd, at)`**: úprava feature uprostřed logu zobrazuje model v tom okamžiku a nepřepočítává features za ní.
- **Data pro výběr**: stěny s příznakem rovinnosti, hrany s úsečkami a druhem, oblasti skici se smyčkami.

Výběr myší: renderer zjistí index trojúhelníku, přes `faceIds` číslo stěny a přes `faceNames` jméno, které pošle zpět v příkazu. Hrany a oblasti analogicky.

**Web Worker.** Vše, co přes API prochází, jsou serializovatelná data. API je ale synchronní, takže přesun enginu do Workeru znamená asynchronní obal nad stejnými příkazy a stavem, ne nulovou změnu. V PoC běží engine v hlavním vlákně.

## Rozhraní pro AI (D33)

```
klient AI ──stdio──▶ MCP server (Node) ──┬─▶ vlastní engine (dokument ze souboru)
                                         └─▶ most HTTP 127.0.0.1 ──▶ engine běžící aplikace
```

**Nástroje** jsou čisté funkce nad `Engine` (`tools.ts`), takže tentýž kód obsluhuje engine v serveru i engine aplikace. Server k nim přidává nástroje pro soubory, které potřebují disk.

| Nástroj | Co dělá |
|---|---|
| `describe_api` | Konvence, katalog vazeb s operandy a příklady, typy dokumentu a příkazů. Generuje se ze zdrojů enginu. |
| `get_model` | Časová osa se stavy a chybami, tělesa s objemem a rozměry; `at` = stav po dané feature. An extrusion with a generated profile carries its `facts`. |
| `get_document` | Dokument tak, jak se ukládá, nebo jedna feature. |
| `get_sketch` | Body s polohami, křivky, vazby, promítnutá geometrie, oblasti, diagnostika a slovní rada (`advice`). A constraint with expressions lists them by value name (`expressions: { value: "module * Zs" }`), so a constraint with more than one value stays unambiguous. |
| `get_parameters` | Parameters with expressions, values and errors; checks with their result. |
| `explain_constraint` | Jestli vazba plyne z ostatních a ze kterých. |
| `get_body` | Stěny (rovinnost, plocha, normála) a hrany (druh, délka; u přímé krajní body, u kruhové střed a poloměr) se jmény použitelnými v odkazech. |
| `execute`, `preview` | Příkaz enginu (i `batch`); `preview` nezapisuje. Výsledek shrne, co není v pořádku, a u každé skici řekne, jestli je vyřešená a kolik má volnosti. It also reports what is not a feature state: `failedChecks`, `parameterErrors`, and `fieldErrors` of features. |
| `undo`, `redo` | Historie příkazů. |
| `session_status` | Jestli nástroje pracují nad aplikací, nebo nad vlastním dokumentem serveru. |
| `open_document`, `save_document`, `export_stl` | Soubory na disku; dokument může být v aplikaci. |

Chyba volání (neznámá skica, špatný argument, neplatný příkaz) se vrací jako text s příznakem chyby, ne jako výjimka protokolu. Malý výsledek se vypisuje s odsazením, velký úsporně.

`describe_api` lists the profile generators from `GENERATORS` (operands, parameters with ranges and defaults, references, side names, facts and an example profile). It also lists the expression syntax (operators, functions, constants) and the numeric fields that accept an expression; both come from the engine (`EXPRESSION_FUNCTIONS`, `FEATURE_TYPE_INFO[type].fields`, `CONSTRAINTS[type].values`), so a new field or function shows up without touching the server.

**Proč se nové vazby a příkazy objeví samy.** `execute` bere jakoukoli hodnotu typu `Command` a validuje ji engine. `describe_api` skládá text ze tří zdrojů: z ručně psaných konvencí, z katalogu vazeb (`CONSTRAINTS`: jméno, shrnutí, operandy a jejich druhy, pravidlo hodnoty) a ze zdrojového textu `engine/src/types.ts` bez sekce portů. Vazba přidaná do enginu je tedy v popisu i v nástrojích bez změny v `packages/mcp`.

**Most.** Server otevře HTTP na `127.0.0.1` (výchozí port 4517). Aplikace se po zapnutí propojení připojí na `GET /events` (proud událostí) a na každý požadavek odpoví `POST /reply`. Dokud je připojená, nástroje se provádějí nad jejím enginem; po odpojení nad vlastním enginem serveru. Platí poslední připojená aplikace; požadavek bez odpovědi do 30 s skončí chybou. Aplikace, kterou jiná vytlačila, dostane událost `displaced` a sama se znovu nepřipojuje (propojení se v ní vypne a jde zapnout zase jen tlačítkem); po výpadku serveru se naopak připojuje sama. Připojit se smí jen stránka z tohoto počítače: server ověřuje původ (`Origin`), cílovou adresu (`Host`) a vlastní hlavičku `x-trymesh-bridge`, kterou musí mít každý požadavek kromě `GET /status`.

**Soubory.** Server si pamatuje soubor vlastního dokumentu a zvlášť soubor dokumentu v aplikaci. Ten platí jen po dobu jednoho připojení a jen pro dokument, který v aplikaci byl, když se do souboru ukládalo nebo z něj načítalo: aplikace s každou odpovědí posílá pořadové číslo dokumentu, které zvýší při každé jeho výměně (Nový, Otevřít, načtení od AI). `save_document` bez cesty ukládá do souboru toho dokumentu, se kterým se právě pracuje; nemá-li žádný, je to chyba. Nástroj složený z více kroků pracuje celý nad enginem zjištěným na svém začátku.

**Spuštění.** `pnpm mcp:build`, pak v klientu AI příkaz `node packages/mcp/dist/server.js` (volby `--file model.json`, `--port`, `--no-bridge`). Pro Claude Code je v kořeni repa `.mcp.json`. V aplikaci se propojení zapíná tlačítkem AI na liště.

## Ověření proti scénářům

| Scénář | Jak ho návrh pokrývá |
|---|---|
| 1 Základní průchod | Změna kóty → nový dokument → přepočet od první skici. Výřez odkazuje na `endCap` extrude E1, jméno přežije. Díra okótovaná k promítnuté hraně se posune s okrajem. |
| 2a Přidání díry | Oblast ji získá automaticky, žádné ID se neposune, pozdější reference platí. |
| 2b Smazání úsečky obdélníku | Profil se rozpadne, první extrude skončí v chybě `noProfile`. Těleso nevznikne, takže vše, co na něm závisí, skončí v chybě `brokenReference`. |
| 2c Nahrazení úsečky jinou | Úsečka L3 se smaže a mezi stejné body se nakreslí L9. Oblast z původních křivek zanikla, extrude skončí v chybě `noProfile`. Uživatel vybere profil znovu a extrude projde. Víka si jméno nechají, skici na nich platí dál; pokud mají promítnutou hranu k zaniklé stěně z L3, dostanou varování `brokenProjection` a hrana zůstane zmrazená. Skica přímo na stěně „side E1/L3" skončí v chybě `brokenReference` a uživatel vybere novou stěnu. |
| 3 Solver | `SolveResult` nese stupně volnosti a konfliktní vazby. Konfliktní skica má stav `warning` a model nezmizí. Tažení přes `preview` s `drag`. |
| 4 Round-trip | Dokument je jediný zdroj pravdy, `evaluate` je čistá deterministická funkce. Po načtení se skici neřeší znovu, protože razítko odpovídá. Dokument s feature v chybě se načte také: odkaz na smazanou feature validaci neporušuje. |
| 5 Časová osa a undo | Vlastní rovina je feature jako každá jiná. Vložení, potlačení a přesun jsou příkazy nad seznamem features, validace hlídá pořadí závislostí. Undo vrací předchozí dokument. |
| 9 Robot joint (in progress) | As far as point 3 of D35 reaches (`packages/scenarios/test/scenario9.test.ts`): parameters, checks, pitch circles dimensioned by expressions, save and load (parts a, k); the sun gear, one planet and the ring gear in mesh without overlap (part b); the plate, the sun flange and the housing with holes through all, one of them through two bodies (parts d, e, f without patterns and pockets); the change of the ratio to 4 and to 6 with everything recomputed and in mesh (part i). A parameter change recomputes the joint so far in about 0.6 s. The rest follows with points 4 to 7. |
| 6 Navazování geometrie | Promítnutá kružnice dává pevný střed, soustředná díra ho sleduje. Lícující nálitek nechá obě stěny a hranu druhu `coplanar`, i když je jeho bok vedle roviny o chybu float32. Další operace na zbytku posunuté stěny funguje díky návratu do roviny v adaptéru. Po odříznutém nálitku nezůstanou zbytky jeho stěn, takže reference na ně se rozbijí. |

## Výsledky spiků

Provedeno 2026-11-13 v Node 25. Skripty ověřující samotné knihovny jsou ve složce `spikes/` a jdou spustit znovu (`npm install`, pak `node <skript>`). Adaptéry, které ze spiků vzešly, jsou od 2026-11-14 v balíčcích `kernel-manifold` a `solver-planegcs` a jejich případy běží jako testy.

### Manifold (`manifold-3d` 3.5.5)

Skripty: `manifold-spike.mjs`, `manifold-ghost.mjs`, `manifold-determinism.mjs`. Každý případ běžel v osově zarovnané i v obecně natočené poloze.

| Předpoklad | Výsledek |
|---|---|
| `faceID` ze vstupu přežije booleany | Platí. Čísla stěn obou operandů jsou ve výstupu zachovaná. |
| Válcová plocha zůstane jednou stěnou, normály míří ven z materiálu | Platí. |
| Rozdělená stěna si nechá číslo v obou částech | Platí. |
| Stěny v jedné rovině s různými čísly nesplynou | Platí. |
| Výstup je uzavřené těleso, objem odpovídá | Platí ve všech případech. |
| Koplanární plochy, osově | Bez potíží i bez přesahu. |
| Koplanární plochy, šikmo | **Neplatí bez úprav.** Nálitek bez přesahu zůstal oddělený vnitřní stěnou; kapsa s bokem v rovině boku tělesa nechala v ústí blánu. Přesah 0,01 obojí odstranil. Nastavení tolerance ani `simplify` nepomáhá. Vedlo k záruce č. 3 a úpravě v adaptéru (D19). |
| Přesnost | Vstup i výstup jen `Float32Array`, API pro float64 neexistuje. Vedlo k rozhodnutí D20. |
| `triangulate` v JS API | Platí, včetně polygonu s dírou. |
| Determinismus | Opakovaný boolean dá bitově stejný výstup. |
| Běh v Node | Platí. |

Úzké trojúhelníky se objevily jen v jednom případě (dva v šikmém sjednocení lícujících těles).

### Koplanární stěny v adaptéru

Adaptér: `packages/kernel-manifold/src` (`coplanar.ts` posun a návrat stěn, `clean.ts` čištění sítě, `geometry.ts` roviny a tolerance). Testy: `test/coplanar.test.ts` (jednotlivé případy), `test/fuzz.test.ts` (náhodné) a `test/review.test.ts` (případy z revize). Ověřují, že záruku č. 3 jde splnit uvnitř adaptéru jen ze sítě a čísel stěn, bez znalosti jmen a bez zásahu do core. Nástroje jsou postavené přesně, bez ručního přesahu.

Jednotlivé případy, každý osově i šikmo: nálitek a kapsa přesně na stěně, kapsa s bokem v rovině boku tělesa, výřez přesně na tloušťku, válcová díra a válcový čep, bok kapsy vychýlený o ±3e-6 (napodobuje přichycení na bod s přesností float32), bok 0,05 od roviny (posunout se nesmí), nástroj dosedající zvenku, lícující sjednocení, stupňovité těleso, částečný překryv, stejná rovina bez překryvu.

Řetězené případy, každý osově i šikmo: nálitek zavěšený na stropě tunelu a kapsa do téhož stropu (strop je zbytek posunuté stěny), blok pod převisem nálitku, který přesahuje okraj stěny.

Případy ze čtvrté revize, každý osově i šikmo:
- schod přidaný sjednocením a zase celý odříznutý (jeho boky lícují s boky kvádru),
- nálitek s bokem lícujícím s bokem kvádru a s odchylkou ±3e-6, potom kapsa do horní stěny,
- válcový výřez pod schodem, kde dva vrcholy válce leží v rovině boku schodu (čtyři roviny v jednom vrcholu),
- blok pod převisem, jehož horní stěna zároveň lícuje s horní stěnou kvádru,
- drážka do nálitku od jeho spodku nástrojem, který zároveň leží na horní stěně kvádru.

Každý případ kontroluje čísla stěn, objem, uzavřenost sítě a to, že žádná rovinná stěna nemá přeložený trojúhelník.

| Varianta adaptéru | Prošlo |
|---|---|
| Posun před booleanem, přesný návrat a vyčištění sítě po něm | 46 z 46 |
| Verze po třetí revizi (vracel se jen zbytek posunuté stěny, lícující stěny u sjednocení se neposouvaly) | případy ze čtvrté revize selhaly: po odříznutém schodu zůstaly proužky jeho boků, lícující nálitek šikmo zneplatnil rovinnost horní stěny a další kapsa nechala blánu, strop válcového výřezu ležel 9,999988 až 10,000244 |
| Jen posun, bez návratu (první verze) | řetězené případy selhaly: nálitek na stropě tunelu byl samostatná komponenta |
| Bez úprav | selhává většina šikmých případů |

S návratem leží strop tunelu přesně na zadané výšce (bez něj o 0,002 až 0,003 výš).

**Náhodné testy.** Generátor skládá na kvádr 40 × 30 × 10 jednu až čtyři operace (sjednocení nebo rozdíl) s kvádry, trojbokými hranoly a válci. Rozměry bere z hrubé mřížky, takže stěny často lícují, dosedají nebo se překrývají zčásti; 80 % případů běží v náhodně natočené a posunuté soustavě a 30 % kvádrů má bok vychýlený: o ±3e-6 (napodobuje přichycení na bod s přesností float32), nebo o ±3e-5 (pásmo mezi přesností float32 a tolerancí, mimo návrhový rozsah). Výsledek se porovnává se dvěma orákuly nezávislými na adaptéru:
- mřížkový model (případy jen z kvádrů): přesný objem a pro každé číslo stěny rozsah plochy, kterou smí mít,
- řezy po vrstvách přes 2D booleany: objem a povrch (všechny případy),
- u případů s válci a šikmými stěnami navíc shoda čísel stěn s během téhož případu v osové poloze.

Každý výsledek musí být uzavřený, bez přeloženého trojúhelníku a jádro ho musí načíst se stejným objemem. Adaptér smí případ odmítnout vlastní chybou (neuzavřená nebo přeložená síť); odmítnutí se počítají zvlášť a test hlídá, že jsou vzácná.

Poslední běh (2026-11-14, po opravách z revize): 30 000 případů, žádný vadný výsledek. Tři případy adaptér odmítl chybou: jeden v návrhovém rozsahu (válec, kvádry s odchylkou 3e-6) a dva s odchylkou boku 3e-5. Tisíc případů běží při každém `pnpm test`; rozsah jde změnit proměnnými `FUZZ_COUNT` a `FUZZ_FIRST`.

Vedle toho běží případy z revize (`test/review.test.ts`), každý v desítkách náhodných poloh: mezera a průnik pod rozlišením adaptéru, dotyk hranou následovaný dalšími operacemi, model 450 a 1300 mm od počátku.

Co náhodné testy našly a pevné případy ne:
- Jádro síť, která není uzavřenou plochou, načte bez chyby, část trojúhelníků zahodí a změní objem. Stav knihovny zůstane `NoError`. Proto adaptér uzavřenost kontroluje sám.
- Vrácení posunutých vrcholů „do roviny" nechávalo průsečíky natočených hran o zlomek přesahu vedle; pozdější nástroj se stěnou přesně v tom místě síť přeložil. Návrat se proto počítá z původní geometrie.
- Kde se nástroj tělesa dotkne jen hranou a nic se neposouvá, nechává jádro nulové trojúhelníky s číslem stěny nástroje. Čistí se proto vždy.
- Sloučení vrcholů podle polohy vytvoří v místě, kde se těleso samo sebe dotýká hranou, hranu se čtyřmi trojúhelníky; dělit jen koncové vrcholy nestačilo.
- Průsečík hrany, která rovinu protíná pod malým úhlem, vyšel 1e-4 vedle skutečného vrcholu a vznikl přeložený trojúhelník. Bod blízko konce hrany se bere jako ten konec.
- Jehlové trojúhelníky se při čištění zahazovaly jako nulové (14 případů z 30 000, všechny v natočené poloze s válci). Opraveno přísnějším určením nulového trojúhelníku; po revizi se navíc dělí jen hrany bez protějšku.

Adaptér má asi 900 řádků TypeScriptu; zhruba třetinu tvoří čištění sítě.

### planegcs (`@salusoft89/planegcs` 1.3.0)

Skript: `planegcs-spike.mjs`. Prošlo 36 z 37 kontrol; neprošlá je kontrola referenčních kót, viz tabulka.

| Předpoklad | Výsledek |
|---|---|
| Stupně volnosti | Platí (`dof()`). |
| Konfliktní vazby | Platí. Vrací celou skupinu vazeb v konfliktu, ne jen tu naposled přidanou. Stav řešení je pak většinou `Failed`, ale ne vždy: konflikt se objevil i se stavem `Success`. Adaptér proto rozhoduje podle seznamu konfliktních vazeb. |
| Nadbytečné vazby | Platí. |
| Pevné body | Platí (`fixed: true`), nepohnou se ani o bit. |
| Pevný poloměr promítnuté kružnice | Platí přes vazbu `circle_radius`; soustředná díra i tečna k pevné kružnici fungují. |
| Podmínky oblouku | Platí přes `arc_rules`. Adaptér musí dopočítat poloměr a úhly z bodů, planegcs je chce na vstupu. |
| Mapování variant vazeb | Všechny varianty mají protějšek (24 kombinací vazby a druhu křivky v testech adaptéru). `horizontalDistance` a `verticalDistance` se mapují na vazbu `difference` nad souřadnicemi bodů. |
| Znaménka | Ověřeno testy adaptéru: `difference` dává b − a včetně záporných hodnot, `l2l_angle_ll` měří od první úsečky ke druhé proti směru hodin. |
| Splněný vstup se vrátí beze změny | Platí bitově, pro plně určenou i podurčenou skicu. |
| Determinismus | Platí bitově. |
| Tažení přes dočasné vazby | Platí. 30 kroků, vazby drží, bod sleduje cíl ve volném směru, žádné skoky. Ověřeno navazujícími kroky i bezstavově, kdy každý krok začíná z uložených poloh a cíl se vzdaluje (tak to volá `preview`). |
| Referenční kóty | **Neplatí.** Neřídicí kóta přidala stupeň volnosti a vrátila nesmyslnou hodnotu. Engine je proto solveru neposílá. |
| Vazba jen mezi pevnými entitami | **Solver ji tiše ignoruje.** Šikmá pevná úsečka s vazbou `horizontal` skončí úspěchem bez konfliktu. Takovou vazbu proto odmítá validace příkazů. |
| Diagnostika konfliktu | Mezi konfliktními vazbami se vracejí i pomocné vazby adaptéru; `dof()` při konfliktu nemá význam (pozorováno −1 i 0 až 2). Adaptér pomocné vazby odfiltruje a vrací 0. |
| Běh v Node | Platí. |

Poznámky pro adaptér:
- Solver při hledání nadbytečných vazeb vypisuje ladicí text na standardní výstup. Vypíná se nastavením `debug_mode` na `DebugMode.NoDebug` (ověřeno).
- Úspěšné řešení hlásí knihovna stavem `Success` nebo `Converged`. `Converged` ale znamená jen to, že vazba, kterou knihovna vyhodnotila jako nadbytečnou, nebyla ve výchozím odhadu splněná; nikdo neověří, že je splněná ve výsledku. Adaptér proto řeší znovu z výsledku, dokud nedostane `Success`.
- Paměť WASM se uvolňuje ručně (`destroy_gcs_module`).
- Tečnost s obloukem (`tangent_la`, `tangent_ca`, `tangent_aa`), bod na oblouku (`point_on_arc`) a kóty oblouku jsou ověřené až testy adaptéru (`packages/solver-planegcs/test`), ve spiku nebyly.

Známá omezení solveru, která adaptér neřeší (z revize 2026-11-14, náhodné skici proti nezávislé kontrole zbytků vazeb):
- Nadbytečná vazba, která ve výchozím odhadu není splněná, může skončit konfliktem, i když řešení existuje (nepřesně nakreslený obdélník a k němu rovnoběžnost protějších stran). Z přesnějšího odhadu projde. Není to obecné: kolmost nebo druhá kóta ze stejného odhadu projdou.
- Kóta vzdálenosti mezi dvěma body, které ve výchozím odhadu leží na sobě, skončí konfliktem.
- Oblouk se může překlopit na svůj doplněk (konce si vymění strany) a výsledek je přesto řešením vazeb. Port o rozsahu oblouku nic neříká; engine to zatím nekontroluje.
- U tečnosti dvou kružnic drží knihovna vnější nebo vnitřní dotyk podle výchozího odhadu. Kde druhá varianta vede k zápornému poloměru, vrací adaptér `failed`.
- Výchozí algoritmus selhal (`failed`, bez seznamu vazeb) asi u 4 % náhodných skic. Záložní Levenberg–Marquardt z nich vyřeší asi desetinu; zbytek zůstává `failed`.

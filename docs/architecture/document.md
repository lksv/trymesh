# Architecture: the document

Part of [architecture.md](../architecture.md), the design as implemented. The two histories, the types of the document, parameters and expressions.

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
  schemaSteps?: string[];       // only from a build of a branch, see `load`
  settings: {
    chordTolerance: number;               // dělení oblouků na segmenty
  };
  parameters: Parameter[];                // named parameters, see Parameters and expressions
  checks: Check[];                        // expressions that are supposed to hold
  features: Feature[];                    // časová osa
  bodyProperties: Record<Id, BodyProperties>;   // a section of the document, see Body properties (D48)
  mechanism: Mechanism;                          // a section of the document, see The mechanism (D49)
  meshes: Record<Id, StoredMesh>;                // a section of the document, see Stored meshes (D55)
}

type Feature = PlaneFeature | SketchFeature | ExtrudeFeature | PatternFeature | HoleFeature | MeshFeature;   // a hole: hole.md (D46); a mesh: Stored meshes (D55)

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
  | { type: 'midpoint';     point: Id; line: Id }     // bod ve středu úsečky
  | { type: 'equalRadius';  a: Id; b: Id }            // two circles or arcs, in any combination (D35, point 6)
  | { type: 'fixed';        point: Id; x: number; y: number };  // an own point at coordinates of the sketch; x, y are numeric fields

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
  | { type: 'regions'; sketch: Id; regions: RegionRef[];
      offset?: number }                                    // the outline moved by this much; an optional numeric field (D44)
  // a wall along own curves of the sketch that form one chain (see Extrude, Profile offset and a wall)
  | { type: 'wall'; sketch: Id; curves: Id[]; thickness: number }
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

**The registry of feature types** (`FEATURE_TYPES` in `features/index.ts`) holds a module per type (`FeatureModule` in `features/module.ts`): the validation and the canonical form, the references to other features with the place inside the feature where each lies, whether the feature creates a body and names faces, whether it leaves a tool that a pattern can repeat (`producesTool`), the generator of its profile (`generator`), whether a failed expression is only a warning (`keepsLastValidValues`, the sketch), which fields `updateFeature` may change, and the step of the recompute. Validation of references, the order on the timeline, `moveFeature`, the recompute and the description of the API for the AI all read the registry. A new feature type is its interface and one member of `Feature` and of `FeaturePatch` in `types.ts`, a module in `features/` and one line of the registry. The registry is a mapped type over `Feature['type']` and an entry needs a step, so it is the one guard of completeness (until D37 a `switch` in `evaluate.ts` was the second). The public part of the registry is `FEATURE_TYPE_INFO`; the engine also exports `producesTool(feature)` and `generatorOf(feature)`, which the app uses to offer the sources of a pattern and the mates of a generated profile. It also lists the numeric fields of each type (`fields`); validators read them through the field reader described in Parameters and expressions.

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

- Static description: `FEATURE_TYPE_INFO[type].fields` (`FieldSpec`: address, spec, the variant that has the field) and `CONSTRAINTS[type].values` (named values of a constraint; a dimension has `value` and the flag `dimension`, a fixed point has `x` and `y`, at the addresses `constraints/<id>/x` and `constraints/<id>/y`). The API description for AI and the forms of the app read these.
- **An optional field of a feature (D44).** A field of a feature whose description has a `default` may be absent: `profile/offset` of a profile of regions is the first, `extent/taper` of a distance extent the second (D45), `extent/gap` of an extent up to a plane the third (D47).
  - Absent means the default, and the default is not stored: storing `offset: 0` in every profile of regions would rewrite every extrusion of every document on load. What a command gives is kept, also a zero; the two spellings of "no offset" compute the same.
  - `fieldsOf` lists the field only while the feature has it, and `expressions` may hold its address only then.
  - `setField` reaches it also while the feature does not have it: besides the fields `fieldsOf` lists, it accepts the address of a field of the registry whose description has a default and whose `when` holds for the feature, and then adds the field. `updateFeature` sets it by a patch and removes it with `null`, also from a feature that did not have it.
  - `default` has two readings, by where the field is: for a parameter of a generator (a dictionary the catalog describes) the default is stored when the parameter is left out; for a field of a feature it is what an absent field means.
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

### Body properties and the sections of the document (D48)

A **section of the document** is a field of `Document` beside the timeline, keyed by IDs of the model; `bodyProperties` is the first, the mechanism (D49) the second, the stored meshes (D55) the third. A change of a section recomputes no geometry: no step of a feature reads one, with one exception, the step of a mesh feature, which reads one entry of `meshes` through `input` of its module (see Stored meshes); a command of a section recomputes a feature only when it changes the entry that feature reads. The design and its reasons are [docs/d36/3a-body-properties/design.md](../d36/3a-body-properties/design.md).

```ts
type BodyUse = 'part' | 'reference' | 'auxiliary';
interface BodyProperties {        // every field optional; an entry with no field is not stored
  name?: string;                  // not inherited; non-empty, no leading or trailing space, at most 200 characters
  color?: string;                 // '#rrggbb', stored in lower case
  material?: string;              // a label, the rules of `name`
  use?: BodyUse;                  // default 'part'
  density?: number;               // g/cm3, (0, 25]; a numeric field
  mass?: number;                  // g, above 0; a numeric field; wins over the density
  expressions?: { density?: Expr; mass?: Expr };
}
```

- **Keyed by body ID**, also a derived one (`screws/2`). The section is always present (`{}` when nothing is set); an entry with no field is removed, so "nothing set" has one spelling.
- **The use** decides who reads a body: `part` is printed (the default); `reference` is a bought part (a motor): not printed, has a mass; `auxiliary` is no physical thing (kept-free space): neither printed nor weighed, still in the interference and gap queries. A reader that makes its own list of bodies (the print export `stl`, `exportMesh` and the tool `export_stl` without a list, the query `print` without `bodies`) takes the bodies with the use `part` (`printedBodies`); a body the caller lists is taken as listed.
- **A copy takes after its source.** A body made as a copy (a pattern of a body) inherits what its own entry does not state: colour, material, use, and the density and the mass **as a pair** (an entry that states either inherits neither, so a copy in another material is weighed by its own density). The name is not inherited. The source is a fact of the document: the registry of feature types has `bodySource(feature, local)` (a pattern of a body answers with its source; a later mirror or split sets its own), followed recursively and stopped at a body seen already.
- **An entry whose body is gone stays** (a removed or suppressed feature, a lower count of a pattern) and is taken over by a body that appears under its ID. `bodyPropertiesWithoutBody(section, result)` lists such entries (get_model, the app); `removeBodyProperties` removes one. To keep a reused ID visible, the generators of IDs (`freshIds`, `newId` of the app) count every ID a section names as used (`namedBySections`: the feature of every key, a derived key with its feature), and `takenOver(before, command)` lists the features and sketch entities a command adds under such an ID (execute of MCP and the status line of the app say it).
- **Strict entries.** The validator lists the fields it allows and refuses any other, on a command and on a load; a later package can add a field without an upgrade step, because a build without it refuses the document. A key is checked on a load for its form only (a text whose part before the first slash could be an ID).
- **Numeric fields of an entry** follow the rule of a numeric field of a feature (`sections/fields.ts`, through `Fields`): the field holds the last valid number, the expression is in `expressions` of the entry under the field name; a command takes a number or an expression; the recompute evaluates; after `execute` and `load` the engine writes the numbers back in the same undo step; `renameParameter` rewrites them. An error of a command names the field by `<body>/<field>` in `error.expression.path`.

**Commands.** `setBodyProperties { body, patch }` merges a patch (`null` removes a field, a number in a numeric field removes its expression, a string sets one); `setBodyMaterial { body, material }` copies a row of the catalog `materials`: its key as the label and its density as a number (the expression goes, the mass stays); `removeBodyProperties { body }` removes an entry, also of a body that is gone. The body of the first two must be one a feature of the document can create (`bodyProblem` in `features/index.ts`: the feature exists and `createsBody` says yes); the order on the timeline is not asked.

**The result** is `Evaluation.bodyProperties`, by body of the state (`BodyPropertiesResult`): the name (own, else that of the feature, a copy with ` / <number>`), colour, material, use, density, mass with `massFrom`, the nearest source `from`, and `fieldErrors` of the pair used. The mass: none for an auxiliary body; the stated mass; else density × volume / 1000; none when neither is stated or the one used is in error (nothing steps in for a field in error). A result equal to one of the last few of the same body (a preview in between does not push it out) is the same object.

**The registry of sections** (`sections/index.ts`, `DOCUMENT_SECTIONS`) is typed by the fields of `Document` that are sections, so a section added to the type without an entry does not compile. An entry (`SectionSpec`, `sections/spec.ts`) has its description (`SECTION_INFO`: title, summary, commands, numeric fields, read by `describe_api`), the empty section, the validation on a load, its commands, the rename of a parameter, the IDs it names and its evaluation after the timeline. `emptyDocument`, `validateDocument`, the default case of `applyCommand`, `renameParameter`, `differs` and `settle` of the engine and `Evaluator.evaluate` ask it. `evaluate` gets the state of the recompute as well (D49: an axis through a sketch point reads the frames and points of the sketches), and an entry may name top-level keys of its result whose records are kept stable entry by entry (`entries`).

**The catalog of materials** (`catalogs/materials.ts`, `DATA_CATALOGS.materials`): PLA, PETG, ABS, ASA, TPU and PC with the density of the solid material in g/cm3 from the technical data sheet of Prusament, and of Bambu Lab where Prusament does not make the material (ABS); each row names its sheet in `source`. A printed part is lighter, so a mass from these is an upper bound until the density of the body is corrected or its mass weighed. PA12 has no row (no unfilled PA12 from either maker).

### The mechanism (D49)

The second section of the document: links (bodies that move as one piece) and joints between them, for a pose of the model and, later, for the export of a robot description (5b). The design and its reasons are [docs/d36/5a-mechanism/design.md](../d36/5a-mechanism/design.md).

```ts
interface Mechanism { links: Record<Id, Link>; joints: Record<Id, Joint> }   // always present, empty: { links: {}, joints: {} }
interface Link { name?: string; bodies: Id[] }                               // a body in at most one link; a copy of a pattern is listed like any other
type Joint = { name?: string; parent: Id; child: Id; expressions?: { value?: Expr; lower?: Expr; upper?: Expr } } & (
  | { type: 'revolute'; axis: AxisRef; lower: number; upper: number; value: number }    // rad; the limits within ±2π
  | { type: 'continuous'; axis: AxisRef; value: number }                                // rad, no limits
  | { type: 'prismatic'; axis: AxisRef; lower: number; upper: number; value: number }   // mm along the direction of the axis
  | { type: 'fixed' }
);
```

- **The model as modelled is the zero of every joint.** A value is a displacement from where the timeline puts the bodies: a turn by the right-hand rule about the direction of the axis (for a sketch point the normal of its sketch, as for a pattern), or a shift along it. No link has a stored placement. The axis is an `AxisRef` given as modelled; the joints nearer the root carry it along.
- **Records by ID**, unique among the links and among the joints, by the rules of every ID; they do not share the namespace of the features (the link `forearm` holds the body `forearm`). A name follows the rules of a body name.
- **What always holds**, on a command and on a load: a body is in at most one link, once; the parent and the child of a joint are links of the section and differ; a link is the child of at most one joint and no link hangs on itself. The joints form a forest: several roots are allowed (a mechanism being built, two arms on one table) and listed. `removeLink` is refused while a joint names the link.
- **What may break later**, and is checked only by a command that sets it: a body of a link has to be one a feature of the document can create (`bodyProblem`, as for body properties; only bodies the link did not have); the sketch and the point of an axis (`axisRef` with `refContext(doc, doc.features.length)`: the target exists and is of the right kind; only an axis the joint did not have). Later the feature may be removed or suppressed (the link lists the body in `missing`), the sketch may go (the joint is in error). The IDs the section names (the feature of every body, the sketch and the point of every axis, and the projected entity of a derived point such as `x1` of `x1/center`) are counted as used by the generators of IDs and reported by `takenOver`.
- **`value`, `lower` and `upper` are numeric fields** of an entry (`<joint>/value`), by the rule of body properties (`sections/fields.ts`). `JOINT_FIELDS` has their ranges by type.
- **The limits** (lower not above upper, the value within them) are compared by a command with the numbers as they are for the document it is applied to: a field with an expression is evaluated against its parameters, also a field the command does not name, so a batch that widens a limit through a parameter and then poses within it passes. A field whose expression does not evaluate takes no part. "Within" has a tolerance, `LIMIT_TOLERANCE` (1e-4 rad, 1e-6 mm, the tolerances of the engine): a value outside by no more is the limit and is stored as the limit. A parameter may move any of the three later; a load does not ask, the recompute does.
- **Strict entries.** The section, a link and a joint list the fields they allow, on a command and on a load; a field of a later package (the effort limit of 5b) is refused, not dropped.

**Commands.** `setLink { id, name?, bodies? }` creates the link or changes the fields named (`bodies` replaces the list, `name: null` removes the name; a body in another link is refused: take it out there first, in the same batch); `removeLink { id }`; `setJoint { id, joint }` creates or replaces the whole joint in the input form (a string equal to the expression the field has is kept without evaluation, as in `updateFeature`; `expressions` of the input stand for their fields); `removeJoint { id }`; `setPose { values }` sets the values named (a number removes the expression of the value, a string sets one; a fixed joint has none). An error of an expression is addressed `<joint>/<field>`. A command that changes nothing returns the document as it was.

**The result** is `Evaluation.mechanism` (`MechanismResult`), resolved after the timeline against the state the evaluation is of (the final one, or the one after `at`) and the parameters:

- per link `bodies` (those the state has), `missing`, `transform` (a `RigidTransform` from as modelled to the pose; the identity for a root) and `blockedBy`; per joint `status`, `error`, `fieldErrors`, the numbers used, `axis` as modelled and `axisInPose` (carried by the parent link; absent while it is blocked); `roots`; `unassigned`, the bodies in no link (empty while there is no link).
- `T(child) = T(parent) ∘ M`, with M the turn about the modelled axis by the value, the shift along it, or nothing for a fixed joint or a value of zero; in double precision from the modelled configuration every time.
- **A joint in error** (reported in this order: `invalidExpression`, `jointLimits`, `jointOutOfLimits`, then `brokenReference` of its axis) has no motion and blocks what hangs on it: `blockedBy` names the nearest such joint, and the transform counts it as standing at zero (the app draws by it). The exception: a joint whose only fault is its axis and whose value is 0 moves nothing and blocks nothing, so a model whose pose is zero answers at every point of its timeline as before the mechanism.
- **What is written back** (in the same undo step, like every numeric field): a limit whenever it is in the range of its field, also when the two then cross; a value its expression takes out of the limits is not written (it keeps its last valid number); a value within the tolerance outside a limit is written as the limit.
- The results of links and joints are kept stable entry by entry (`entries` of the registry entry): a joint or a link whose result did not change is the same object.
- `carriedBy(section, result, joint)`: the links beyond a joint, their bodies and their missing bodies. `poseOfBody(result, body)`: the transform of the link of a body, nothing for a body that stands as modelled, or the joint that blocks it. `poseNote(result, section)`: the joints that move the model (no fault, a value that is not zero, a child link not blocked) with their values. `setPose` with the expression the value already has keeps it without evaluation, as `setJoint` does.

The bodies of the evaluation do not move: a feature that refers to a face, a sketch on a face, every export and `get_model` see the model as modelled. The pose reaches the queries through their context ([api.md](api.md), "The pose of a query (D49)").

### Stored meshes and the mesh feature (D55)

A bought part read from an STL file: the third section of the document holds the mesh, and the feature type `mesh` places it as a body. The design and its reasons are [docs/d36/3b-mesh-import/design.md](../d36/3b-mesh-import/design.md).

```ts
interface StoredMesh {
  name?: string;        // for people: the file it came from; the rules of a body name
  positions: string;    // base64 of float32, little-endian: x y z per vertex, millimetres
  triangles: string;    // base64 of uint32, little-endian: three vertex numbers per triangle, counter-clockwise from outside
}
interface MeshFeature extends FeatureBase { type: 'mesh'; mesh: Id; placement: BodyPlacement }
type FrameRef = PlaneRef | { kind: 'sketchPoint'; sketch: Id; point: Id };
interface BodyPlacement { frame: FrameRef; x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number }
```

**The section** `meshes` (`sections/meshes.ts`), keyed by an ID the caller chooses (its own namespace: the mesh `nema17` may be placed by the feature `nema17`):

- **Inside the document**, so the document stays one file and undo, a preview and a load work unchanged. A stored mesh is about half the size of the binary STL it came from. The same mesh placed twice is stored once.
- **An entry does not change.** `addMesh { id, mesh }` validates the entry in full with the import limit and refuses an ID the section has; `removeMesh { id }` is refused while a feature of the document names the mesh, suppressed or not (the message lists them; the meant batch is the feature, then the mesh). There is no command that edits an entry: a new revision of a file is another entry.
- **Strict entries**: `name`, `positions`, `triangles`, nothing else, on a command and on a load. The base64 is canonical (the standard alphabet, padding, no white space), so one mesh has one spelling. The codec is the engine's own (`toBase64`, `fromBase64` in `mesh.ts`); the decoded arrays are kept by the entry object (`indexedMesh`, a weak map).
- **What a stored mesh has to be** (`meshProblem` in `mesh.ts`, one function for the importer, `addMesh` and a load; a code, a text and the counts): (1) whole triples, at least 4 triangles and at most the limit (`MESH_LIMITS.triangles`, 100 000, provisional, for an import and `addMesh`; `MESH_LIMITS.stored` for a load, never lowered); (2) finite coordinates within ±10⁹; (3) every index names a position, every position is used, no triangle names a vertex twice; (4) closed: every edge in exactly two triangles, once each way, with the counts of edges with one triangle, with more than two, and running the same way; (5) a positive volume; (6) every shell thicker on average than a millionth of its own size (`MESH_LIMITS.thinnest`); (7) every shell judged by the others (`shellsOf`): at a test point of the shell (a centroid of one of its triangles further than 10⁻⁶ of its size from the other shells around it) the winding of the other shells, summed from the solid angles of their triangles; an outward shell is a `solid` (0) or `nested` (in material: read and reported), an inward one a `hollow` (1 or more) or `insideOut` (0, refused: beside a solid it hides a collision), a negative sum or no test point `undecided` (refused). Only the shells whose bounds hold the point count, found through a grid; the work is counted and bounded by `MESH_LIMITS.work` (10⁷), above which the mesh is `tooLarge`.
- **The result** `evaluation.meshes[id]` (`MeshResult`): the name, vertices, triangles, the bounds and the volume in its own frame, the shells, and `usedBy`, the features that place it. Computed once per entry object.

**The feature** `mesh` (`features/mesh.ts`):

- The body has the ID of the feature and one face, `{ feature, role: 'mesh' }`, with the internal description `{ planar: false, surface: 'mesh' }`, published as the surface `general`. It has no edges. A sketch or a plane on it is `nonPlanarFace`; nothing of it can be projected.
- `mesh` is a reference of the kind `mesh` (`RefKind`): checked by a command that sets it, left out of `featureRefs` (it takes no part in the order of the timeline); a mesh that is not there is `brokenReference` with `refs: [{ mesh }]`.
- **The placement** (`recompute/placement.ts`): the frame is directed as a sketch plane is (a base plane, a plane feature, a planar face, or a sketch point: the frame of the sketch moved to the point, an own point, `origin` or a point of projected geometry). A point `p` of the mesh ends at `O + B · (Rz(rz) · Ry(ry) · Rx(rx) · p + (x, y, z))`, with `O` the origin of the frame and `B` its axes: turns about the fixed axes of the frame, X first (roll, pitch, yaw of a robot description). The six numbers are optional numeric fields (`placement/x` … `placement/rz`, default 0, a turn within ±2π); a patch merges the placement field by field and removes a number with `null`. Errors of the frame are those of a sketch on that plane or an axis through that point, with the frame in `refs`.
- **The step** reads the entry through `input` of the module (recompute.md), moves the mesh by the transform (`transformSolid`, double precision rounded to float32) with one new face number, and publishes `facts`: `origin`, `axisX`, `axisY`, `axisZ` of the mesh as placed. No call of the kernel. The placed solid is kept by the entry object, the transform, the face number and the feature ID (the last four of an entry), so an edit before the feature leaves the body the same object.
- **No feature changes an imported body.** An extrusion that adds or cuts, a hole, and a pattern of them end in the error `importedTarget` when a target has a face of an imported mesh (the body or a copy of it); `refs` name those targets and none is changed. The one place is `applyTool` (`isImported` in `recompute/services.ts`). The kernel adapter cannot see the flats of one non-planar face, and a flush tool leaves sheets on a turned imported body.
- A pattern of the body copies it like any body; a pattern of features cannot repeat it (`producesTool` is false). A new body of a bought part is made a reference part by the batch that places it (`setBodyProperties` with `use: 'reference'` and its `mass`).

**The import** (`import/`): `importMesh(format, bytes, options?, name?)` is a function of the engine, not a method of `Engine`: it reads no document and answers with a stored mesh and a report (`MeshReport`), or a refusal with a code (`unreadable`, `notASolid`, `tooLarge`, `invalidArguments`). The formats are a catalog, `IMPORT_FORMATS` (today `stl`: binary when the length is 84 + 50 · the count, else ASCII beginning with `solid`; the option `unit`: `mm`, `cm`, `m`, `in`), built like `EXPORT_FORMATS`. After `read` everything is shared: the weld (corners at the same float32 position, −0 as 0; triangles that lose a corner are left out and counted), the whole mesh turned over when its volume is negative, the walls between solids stacked on one outline left out (`withoutWalls`: a wall is left out only when along every edge of its border there are exactly two other triangles running it opposite ways, one on each side of the wall), the shells written inside out turned over by groups from the outermost, then the checks. The report has the counts and notes in words (several shells, nested shells, shells turned over, more than 20 000 triangles, a size below 1 mm or above 10 m). The tool `import_mesh` of the server and the form of the app call it and send `addMesh`.

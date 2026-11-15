# 3a Body properties and the catalog of materials (D48)

**State: design, first version, written against the sixth version of the contract of the preparatory step (`0dc424b`).** Not implemented. The types are in [contract.ts](contract.ts), the scenario as calls in [calls.ts](calls.ts); both are checked by `npx tsc -p docs/d36/tsconfig.json`. Validation scenario 13 is shared with [5a](../5a-mechanism/design.md); this package writes the part "bodies with materials and a motor as a reference part with the mass of its data sheet".

The package adds a section to the document. What is expensive to change later is the shape of that section, its upgrade step and what a build without the package does with it, so those parts are decided in full here; the app and the wording of the MCP answers are described and left to the implementation.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Proposed order", step 3: body properties (name, colour, density, reference flag: not printed, not exported) with a catalog of materials. "Export for simulation" adds: a density or an explicit mass; a reference part such as a motor is not printed but belongs in the robot description with the mass of its data sheet, so "not printed" and "not part of the mechanism" are two different flags; the density of a printed part is an effective one, or the mass is overridden by a weighed value. D36 adds the rule for every catalog: a catalog fills fields, the document stores the numbers.

What the code says about it:

- **A body has no place to keep anything.** A body is not an object of the document: it is the result of a feature, named `<feature>` or `<feature>/<local name>` (`bodyOwner` in `document.ts`). The document is `schemaVersion`, `settings`, `parameters`, `checks`, `features` (`types.ts`), and `validateDocument` builds the loaded document from exactly those fields (`document.ts`, the line that makes `doc`), so anything else in the file is gone after a load, without a message. Checked by a probe: today's `validateDocument` given `{ schemaVersion: 2, …, bodyProperties: {…} }` returns a document with five keys.
- **Whether a body exists is known only after a recompute.** The registry answers structurally (`createsBody`: an extrusion with the operation `new`; `<pattern>/<positive number>` for a pattern of a body), and says itself that the count of a pattern may be an expression. A suppressed feature and a feature in error create nothing. Commands are validated without a recompute, so a command cannot ask "does this body exist".
- **A property kept on the feature would recompute the model.** The recompute remembers the state after a feature by the identity of the feature object and of the state before it (`Evaluator.run`, `resolve` and `memo` in `evaluate.ts`). A new feature object, for a new colour, computes its step again and every step after it, booleans included.
- **A section the engine does not compare makes no undo step.** `differs` in `engine.ts` compares the chord tolerance, the parameters, the checks and the features. A command that changed only a new section would be committed and leave nothing to undo.
- **Bodies are named in the app only** (`bodyName` in `packages/app/src/issue-text.ts`: the name of the feature; a copy adds ` / <number>`), MCP lists IDs, and the view draws every body with one material (`viewport.ts`). `exportMesh` without a list takes every body (`engine.ts`).
- **Numeric fields have one reader.** `Fields.number` in `document.ts` reads a number or an expression in the three modes of validation (`load`, `add`, `update`) and collects the expressions; nothing in it is tied to a feature. What is tied to features is where the expressions are kept (`feature.expressions`), who evaluates them (`Evaluator.resolve`), who writes the numbers back (`settle` in `engine.ts`) and who renames a parameter inside them (`renameParameter` in `applyCommand`).

## The cheap variant

A section `bodyProperties` of the document: an optional entry per body ID with a name, a colour, a material label, a use (`part`, `reference`, `auxiliary`), a density and a mass. Three commands. The recompute resolves the entries into `evaluation.bodyProperties`, by body of the state, with what a copy inherits and the mass worked out; the mass query, the exports and the app read that. A catalog `materials` with the density of a handful of printing materials, and a command that copies a row into an entry.

**Deferred**, and why each can come later without a change of what is saved now:

- A fill factor (infill, shells) as a property, from which the engine would work out the effective density. Until then the density is typed in or is an expression over a parameter.
- A print orientation per body (the backlog, "Print queries": "if the orientation should travel with the model: a body property").
- Transparency, and a colour per face.
- Metals and other materials of bought parts in the catalog. A bought part usually has a mass on its data sheet, which is the field for it.
- Properties that follow a body through features that do not exist yet (a split, a boolean of bodies, a mirror): the hook is there (`bodySource` below) and each of those packages sets it.
- A warning when the density of an entry differs from the catalog row its label names.

Each of these is a new field of an entry or of the catalog. An entry is validated strictly (below), so a build without the later package refuses a document that has the new field; no further upgrade step is needed for it.

## The section

```ts
bodyProperties: Record<Id, BodyProperties>   // in Document, always present, {} when nothing is set
```

`BodyProperties` and its fields are in `contract.ts`. The decisions:

- **A section of the document, keyed by body ID**, next to `parameters` and `checks`. Not on the feature, not a feature of its own: see "Rejected".
- **Always present.** The upgrade step gives an older document the empty section, as the step from version 1 gave it `parameters` and `checks`. A reader never has to ask whether the section is there. An entry with no field left is removed, so "nothing set" has one spelling.
- **Derived bodies have entries of their own**: `screws/2` is a key like `screw`. Nothing else is needed for them in the document.
- **A copy takes after its source.** A body made as a copy of another (a copy of a pattern of a body) inherits, field by field, what its own entry does not state: colour, material, use, density, mass. The name is not inherited; it stays the name of today ("Screws / 2"). Reason: without this, the copies of a reference part would be printed parts by default, and an export for printing would contain three of four screws, silently.
  - The source is a fact of the document, not of the model: the registry of feature types gets `bodySource(feature, local)`, which a pattern of a body answers with `source.body`. The resolution follows it recursively (a pattern of a copy) and stops at a body it has seen (a document edited by hand may hold a cycle).
  - It is decided now because it is a change of meaning, not of shape: adding it later would change what a saved document says.
- **An entry whose body is gone stays.** It is a reference that does not resolve, like any other in the document (CLAUDE.md: "a reference to a removed feature is valid in a document on purpose"), and it is not dropped:
  - a feature that is suppressed, a pattern whose count went from 6 to 4, an extrusion in error have no body for a while, and get their properties back with it;
  - an AI often removes a feature and adds it again under the same ID; the properties survive that;
  - dropping would need the recompute inside a command, or a cascade in `removeFeature`, which no other reference has.
  
  Such entries are listed by `bodyPropertiesWithoutBody(state)` (the keys of the section that are not bodies of the state), shown by `get_model` and by the app, and removed by `removeBodyProperties`. They are not an error and do nothing.
- **Strict entries.** The validator of an entry lists the fields it allows (`onlyFields`, as the pattern does for its source) and refuses any other, on a command and on a load. This is what lets later packages add fields without an upgrade step: a build that does not know a field refuses the document instead of dropping the field.
- **The use is one field with three values**; see "Two flags or one field".

### Numeric fields in a section

`density` and `mass` are numeric fields in the sense of the engine: a number or an expression in a command, the last valid number in the document, the expression in `expressions` of the entry under the name of the field. One rule for a number of the document, wherever it is, and one reader (`Fields.number`).

- **Validation** uses `Fields` as it is: `load` checks the syntax of an expression, a command evaluates it at once against the parameters and refuses what does not evaluate or is out of range; fields a command does not name keep their expression without evaluation. `setBodyProperties` follows the recipe of `setField`.
- **The recompute** evaluates the expressions with the environment of the parameters, checks the range, and puts the numbers used into the result. A field whose expression is in error is reported in `fieldErrors` and counts as not stated: nothing is computed from its last number. (A feature other than a sketch is in error in that case; a body without a known density is the counterpart.)
- **Write-back.** After `execute` and `load` the engine writes the numbers into the entries, in the same undo step, as it does for features. `Evaluator.evaluate` returns, next to the write-backs of features, the sections whose numbers changed, and `settle` puts them into the document. A preview writes nothing; its evaluation has the numbers.
- **`renameParameter`** rewrites the name in the expressions of the entries as well.
- **An error of a command** names the field in `error.expression.path` by its address inside the section: the key of the entry, a slash, the field (`motor/density`). The field is the last part; a body ID may itself hold a slash.

This machinery is written once, in this package, for every section with numeric fields; 5a uses it for the joints.

**Considered: the field holds a number or the expression itself**, as a parameter holds only its expression; no `expressions`, no write-back. Less code. Rejected: it would be a second convention for a number of the document, the saved file could not be read without evaluating expressions, and the two are not equally easy to leave: from "number and expression" an upgrade step reaches the other form by moving a string, the other way it would have to evaluate.

## Commands

`setBodyProperties`, `setBodyMaterial`, `removeBodyProperties` (`contract.ts`). All three are ordinary commands: they go through `execute`, `preview`, a batch and `after` of the tools `query` and `export`.

- **The body of `setBodyProperties` and `setBodyMaterial` has to be one a feature of the document can create**: the check `requireRef` makes for a body today (the feature exists, `createsBody` answers yes), without the rule about the order on the timeline, which a section has no place in. A mistyped ID is an invalid command. A body that can exist and does not at the moment is accepted.
- **A patch names what it changes.** `null` removes a field. A number in a numeric field removes its expression, a string sets one. A field the properties do not have is an invalid command.
- **Texts**: `name` and `material` are not empty, have no leading or trailing space and at most 200 characters. `color` is `#rrggbb`; upper case is accepted and stored in lower case.
- **`setBodyMaterial` is the way the catalog fills the fields.** It stores the key of the row as the label and the density of the row as a number. The catalog is read once, by the command; the document does not refer to it afterwards. A custom material is `setBodyProperties` with a label and a density.
  - Considered: `setBodyProperties` alone, with the rule "a label that is a key of the catalog fills the density unless the patch gives one". Rejected: a later command that only renames the label of a body with a hand-set density would reset the density without saying so.
  - Considered: no command, the caller reads the catalog and sends both. That is what the app's form could do, but for an AI the shortest path would then be a density from memory, which is what the catalog is there to prevent.
- **Loading** checks the shape of every entry and the syntax of its expressions. The keys are checked for their form only (a text whose part before the first slash could be an ID); whether a feature creates the body is not asked, as for every reference.

No issue code is added. An entry has no feature whose state could carry an issue; what can be wrong with one is an expression (`fieldErrors`, the `ExpressionError` of today) or a body that is not there (the list above).

## The result of the recompute

`evaluation.bodyProperties[body]` for every body of the state (`BodyPropertiesResult` in `contract.ts`): the name, the colour, the material and the use with what is inherited and the defaults; the density; the mass; where the properties below the own ones come from.

- **Computed after the timeline**, where the parameters and the checks are computed (`Evaluator.evaluate`), from the document, the environment of the parameters and the volume of the body. It is not part of the state a feature step sees, so nothing in the timeline is recomputed for it.
- **The mass of a body**: the stated mass; else density · volume / 1000 (g from g/cm3 and mm3); none for an auxiliary body and none when neither is stated or the one that would be used is in error. `massFrom` says which.
- **Stable objects.** The result of a body is the same object as long as what it is computed from is the same (a new result equal to the last one of that body is replaced by the last one). A query can therefore name it among the owners of `memo`.
- **A state after a feature** (`getState(at)`, `at` of a tool) has the properties of the bodies that state has.

### What 1d and the exports read

| Reader | What it reads | Rule |
|---|---|---|
| Mass properties (1d) | `mass`, `use` of the result | The mass of a body is its `mass`. A body without one takes the density given as an argument of the query; without that the query fails and names the body. An auxiliary body adds nothing and is listed. With a stated mass the inertia is that of the shape at uniform density, scaled to the mass. This is how "the density comes as an argument until 3a" and the properties meet: the argument stays, as the density of the bodies that state none |
| Print exports (STL of the preparatory step, 3MF of 2g), without a list of bodies | `use` | Only the bodies with the use `part` (`printedBodies`). A list given by the caller is taken as given, a reference body included. `exportMesh` and `export_stl` follow, through the shared `run` of the format; a document without properties exports what it exports today |
| 3MF (2g) | `name`, `color` | The name and the colour of an object |
| Print queries (1e), without a list of bodies | `use` | As the print exports |
| Interference and smallest gap | nothing | Every body takes part; a reference or auxiliary body is there to be checked against |
| Parts list (3e) | `name`, `material`, `use`, `mass` | Printed parts and bought parts; auxiliary bodies are not parts |
| Robot description (5b) | `use`, the mass query | Reference bodies belong to their link with their mass; auxiliary bodies are left out |

The mass query is designed by track A at the same time. This package assumes the row above and declares a stand-in, `standInMass` (`contract.ts`), to write its calls; the name starts with `standIn` so that it cannot collide. It stands for the mass query of 1d and assumes: the bodies are taken as one piece and read from the context (so the centre of mass is in the pose asked about); the mass comes from the result of this package as the row says; the result lists per body where its mass came from.

## Two flags or one field

The backlog asks that "not printed" and "not part of the mechanism" stay apart: a motor is the first and not the second. The design keeps them apart as two values of one field, `use`:

| `use` | Printed | Mass, robot description, parts list | Interference, gap |
|---|---|---|---|
| `part` (default) | yes | yes | yes |
| `reference` | no | yes | yes |
| `auxiliary` | no | no | yes |

Two independent flags give a fourth state, printed and without mass, which nothing asks for: a printed part that is not part of the mechanism is a part that is in no link (5a). And they make the common auxiliary case need both flags set, where forgetting the first one prints a kept-free space. One field has no state without a meaning. If a fourth kind is ever needed it is a new value, which an older build refuses by itself.

This is the one place where the design departs from the wording of the brief; it is listed under "Open" for the owner.

## The catalog of materials

`materials` in `Catalogs` and `DATA_CATALOGS` of the preparatory step: by name of the material (`PLA`, `PETG`, `ABS`, `ASA`, `TPU`, `PA12`, `PC`), the density in g/cm3 and, per row, where the number comes from. It reaches the AI as every catalog does: listed by name in `describe_api`, read with the query `catalog`.

- **The numbers are taken from data sheets, not from memory**: the technical data sheet of one named maker per material, recorded in the row (`source`). This design states no number for that reason; the implementation copies them from the sheets and the review of the implementation checks each against its source.
- **What the number means** is said in the summary of the catalog: the density of the solid material. A printed part has less, so a mass computed from it is an upper bound until the density is corrected or the mass is weighed.

## A registry of sections

Where the code will live, and how the second section (5a) costs one entry instead of an edit of every place.

```
packages/engine/src/
  types.ts                  the section, the commands, the result (what an AI reads)
  sections/index.ts         DOCUMENT_SECTIONS: the registry, by field of the document; SECTION_INFO
  sections/fields.ts        numeric fields of an entry: read through Fields, resolve, write back, rename
  sections/body-properties.ts   this section: validation, commands, the result, the two helpers
  catalogs/materials.ts     the table (next to the hardware catalog of 2c)
```

An entry of the registry (a sketch, not type-checked; `SECTION_INFO` in `contract.ts` is its public part):

```ts
interface SectionSpec<S, R> {
  info: SectionInfo;                               // title, summary, commands, numeric fields → describe_api, forms
  empty(): S;
  validate(value: unknown, what: string): S;       // load: shape and the rules of the section alone, strict
  commands: Record<string, (doc: Document, command: Dict, context: ValidationContext) => S>;
  renameParameter(section: S, from: string, to: string): S;
  // after the timeline: the result, and the section with the numbers written back when they changed
  evaluate(section: S, doc: Document, model: State, environment: Environment): { result: R; written?: S };
}
```

The places that name the sections today, each changed once to ask the registry:

| Place | Today | With the registry |
|---|---|---|
| `validateDocument`, `emptyDocument` (`document.ts`) | builds the document from five fields | adds every section through `validate`, `empty` |
| `applyCommand` (`document.ts`) | a `switch` over the command types | a command type the `switch` does not have is looked up in `commands` of the sections |
| `renameParameter` (`document.ts`) | parameters, checks, features | and every section |
| `Evaluator.evaluate` (`evaluate.ts`) | adds `parameters` and `checks` to the evaluation | and the result of every section; returns the sections to write back |
| `settle`, `differs` (`engine.ts`) | features only; four things compared | writes sections back; compares every section |
| `UPGRADES` | | the step of the section |
| `describe_api` (`packages/mcp/src/api.ts`) | numeric fields of features and constraints | a generated part "Sections of the document" from `SECTION_INFO` |

The registry is typed by the fields of `Document` that are sections, so a section added to the type without an entry does not compile, as with `FEATURE_TYPES`. `parameters` and `checks` stay as they are: they are evaluated before everything else and nothing would be gained by moving them.

Places this package touches beyond the registry: `bodySource` in the registry of feature types (one line in the module of the pattern); the default list of bodies of the `stl` format; `stateBefore(0)` in the app, which builds an evaluation by hand and has to empty `bodyProperties` with the bodies; `modelSummary` and `documentProblems` in `packages/mcp/src/tools.ts`.

## The schema: the upgrade step and the life of a document

The step is `3a-body-properties` (`BODY_PROPERTIES_STEP` in `contract.ts`). It reads and changes only `bodyProperties`: an older document gets `{}`; a section that is there for whatever reason is left for the validation, as the step from version 1 leaves `parameters`. It commutes with every other step, so the test of the preparatory step (pending steps run before and after the ones merged meanwhile) holds trivially.

`save` always writes the section, also when it is empty.

What happens to a document that has the section, by the build that loads it. V is the version of `master` when the branch started (2 today).

| Saved by | Loaded by | Result |
|---|---|---|
| the branch of 3a (`schemaVersion: V`, `schemaSteps: ['3a-body-properties']`) | the same build | loads; the step is not run again |
| the branch | the branch after a rebase over a step merged meanwhile | loads; the other step runs, this one does not |
| the branch | `master` with the preparatory step, before the merge; a branch of another package | refused: the build does not have a step of that name |
| the branch | `master` after the merge | loads; saved again as version V+1 (or higher) without `schemaSteps` |
| the branch | **a build from before the preparatory step** (the code of today; an MCP bundle that was not rebuilt) | **loads, and the section and `schemaSteps` are dropped without a word** (probe: today's `validateDocument` returns five keys). The next save writes a plain document of version 2. See "Needs from the preparatory step" |
| `master` after the merge (version V+1) | any build without the package, before or after the preparatory step | refused by the version |
| anything, with a field of an entry the build does not know | a build with the package | refused: the entry is strict |
| a build without the package (version V, no section) | a build with the package | loads; the step adds `{}` |
| an earlier commit of the branch, when the shape of an entry changed since | the branch | undefined by the scheme: both have the step under one name. Rule for the implementation: a change of the saved shape on the branch renames the step (`3a-body-properties-2`), so the older documents are refused |

## MCP and the app

**By construction.** The three commands go through `execute`, `preview` and `after` with no change in `packages/mcp`. The types of the section, the commands and the result are in the part of `types.ts` that `describe_api` prints. The numeric fields of the section and its commands are listed from `SECTION_INFO`; the catalog is listed and read like every catalog of the preparatory step. `get_document` returns the document, so the section is in it.

**By hand**, one edit each, with tests:

- `get_model`: every body in `bodies` gets what its result states beyond the defaults (`name` when it has one of its own, `color`, `material`, `use` when it is not `part`, `density`, `mass` in grams, `from`). The answer gets `bodyPropertyErrors` (body, field, message) and, without `at`, `bodyPropertiesWithoutBody`, next to `failedChecks` and `parameterErrors`; `execute` and `preview` return the same lists, as they do for the checks.
- One line of the conventions in `describe_api`: what the three uses mean, that a copy inherits, and that the mass of a bought part belongs in `mass`.
- `export_stl`: its description says that without a list it saves the printed bodies.

**The app** (`panels/model.ts` of the preparatory step, and a form of its own):

- The line of a body shows its name, its material and its mass, and marks a reference or auxiliary body. `bodyName` of the app takes the name from the result, so targets, issues and collisions use it as well.
- A selected body has a form: name, colour, use, the material from the catalog (a select; `setBodyMaterial`), density and mass as numeric fields with expressions (the field code of `fields.ts`). Every change is one command.
- The view draws a body in its colour and an auxiliary body translucent. "Export STL" of the model takes the printed bodies; the link of a single body exports that body whatever its use.
- Entries without a body are listed below the bodies with a button that removes them.

## Shared vocabulary

**Taken** from the preparatory step: `DocumentSections`, `Commands`, `EvaluationAfter` (the additions), `QuantityUnit` with `g` and `g/cm3`, `DataCatalog` and `Catalogs`, `UpgradeStep`, `Queries` (for the stand-in), `Exported`.

**Added**, for other packages to use:

| Name | Where | Who uses it |
|---|---|---|
| `bodyProperties` in `DocumentSections` and in `EvaluationAfter` | the shared maps | 1d, 1e, 2g, 3e, 5a, 5b read the result |
| `setBodyProperties`, `setBodyMaterial`, `removeBodyProperties` in `Commands` | | 3b (an imported mesh is made a reference body by the same batch that adds it) |
| `materials` in `Catalogs` | | |
| step `3a-body-properties` | `UPGRADES` | |
| `standInMass` in `Queries` | a stand-in, removed when 1d is merged | 5a's calls |
| `SectionInfo`, `SECTION_INFO`, the registry of sections, numeric fields of an entry | engine | 5a |
| `bodySource` in the registry of feature types | engine | 2e (a mirror and a linear pattern of a body), 3d (a split, a boolean of bodies) set it for the bodies they derive |
| `printedBodies`, `bodyPropertiesWithoutBody` | engine | 2g, 1e, MCP, the app |

## Needs from the preparatory step

1. **A build from before the preparatory step reads a document of a branch and drops what it does not know.** The scheme of named steps protects against builds that know `schemaSteps`. The branch of this package saves `schemaVersion: 2`, which the code of today accepts; it then rebuilds the document from the five fields it knows.
   - The case: the branch `d36/3a` saves a document with a motor of 280 g; the document is opened by the MCP server of the main tree, whose bundle was built before the preparatory step (CLAUDE.md warns that the bundle runs old code until it is rebuilt); the AI changes a dimension and saves. The properties are gone and nothing said so. The probe is `scratchpad/track-e/probe/older-build.test.ts`.
   - What would close it: the preparatory step raises the version itself, with a first named step that converts nothing. Every document saved after it has version 3, which every build without `schemaSteps` refuses.
   - Until then this package cannot close it; the row of the table above stands.
2. **`Exported` has no place for a note about the export as a whole.** `about` belongs to a file.
   - The case: `export` of the format `stl` with `perBody` over the arm of scenario 13. The answer has a file per printed body; nothing in it says that the motor and the screws were left out as reference bodies. With one file, `about` of that file can carry the list; with a file per body there is no file to put it on.
   - Stand-in: none in the contract. The description of the tool states the rule and `get_model` shows the use of every body. Asked for: `Exported.about`, or `skipped` next to `files`.

Notes for the plan, which this session does not edit:

- **The table of shared places** has `applyCommand` and `validateDocument` for a package with a section. A section also writes to `differs` and `settle` (`engine.ts`), `renameParameter`, `Evaluator.evaluate`, `stateBefore(0)` of the app and `modelSummary` of MCP. This package turns the first four into the registry above, so that 5a adds an entry.
- **Other packages meet this one in three places**: the default list of bodies of a print export (2g) and of the print queries (1e) should be `printedBodies`; a feature type that derives a body from another (2e, 3d) should answer `bodySource`; the mass query (1d) should read the mass as the table "What 1d and the exports read" says.
- A contract of another package that builds a `DocumentAfter` or an `EvaluationAfter` by hand stops compiling once this one is merged, because both get a required field. None is known.

## Rejected

- **Properties on the feature that creates the body** (a field of the extrusion). A change of a colour would recompute the feature and everything after it (see the code, above). A feature that creates several bodies would need a map by local name; every future type that creates bodies (import, insert, split) would carry the field and its validation. A field directly on a feature is dropped by a build without the package as well, so it saves no upgrade step.
- **A feature type "properties" on the timeline.** It would make the properties depend on a place in the timeline that has no meaning for them, and a change would still invalidate every state after it.
- **A reference to a catalog row in the document** (`material: 'PETG'`, the density looked up at the recompute). D36 decided against it for every catalog: a corrected catalog would change old models.
- **Dropping an entry when its body disappears.** See "An entry whose body is gone stays".
- **No inheritance by copies.** Simpler, and wrong where it matters: the copies of a reference part would be printed.
- **Two independent flags.** See "Two flags or one field".
- **A colour as three numbers.** Three numeric fields with expressions for something no expression will ever drive; `#rrggbb` is what 3MF, the colour control of a browser and the renderer take.
- **Mass and density as two variants of one field** (`{ type: 'density' } | { type: 'mass' }`). A weighed part keeps its material and its density for the parts list, and going back from the weighed value should not need the density typed again.
- **An optional section** (`bodyProperties?`). Every reader would handle its absence, and a document would have two spellings of "no properties".
- **A key by feature instead of by body.** A pattern of a body is one feature with many bodies.

## Open

For the owner:

- **One field `use` in place of two flags.** The design keeps "not printed" and "not part of the mechanism" apart as `reference` and `auxiliary`. If two independent flags are wanted, the change is confined to one field of the entry and one column of the table of readers; it should be made before the implementation, not after documents exist.
- **The rows of the catalog.** Seven printing materials are proposed, each from the data sheet of one maker. Which makers, and whether metals for bought parts should be there from the start, is a choice of content, not of design.

For the implementation:

- The summary line of `get_model` per body grows; whether `density` is worth printing next to `mass` is decided when the answers are read in scenario 13.
- Whether the app shows inherited values in the form of a copy as placeholders.

No third-party library is needed.

## Reviews

Recorded here after the reviews of the designs of track E.

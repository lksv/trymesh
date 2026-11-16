# 3a Body properties and the catalog of materials (D48)

**State: design, third version, after three rounds of reviews (see "Reviews"). Written against the sixth version of the contract of the preparatory step (`0dc424b`).** Implemented and merged 2026-11-16, schema version 5 on `master` (see "As implemented" at the end). The types are in [contract.ts](contract.ts), the scenario as calls in [calls.ts](calls.ts); both are checked by `npx tsc -p docs/d36/tsconfig.json`. Validation scenario 13 is shared with [5a](../5a-mechanism/design.md); this package writes the part "bodies with materials and a motor as a reference part with the mass of its data sheet".

The package adds a section to the document. What is expensive to change later is the shape of that section, its upgrade step and what a build without the package does with it, so those parts are decided in full here; the app and the wording of the MCP answers are described and left to the implementation.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Proposed order", step 3: body properties (name, colour, density, reference flag: not printed, not exported) with a catalog of materials. "Export for simulation" adds: a density or an explicit mass; a reference part such as a motor is not printed but belongs in the robot description with the mass of its data sheet, so "not printed" and "not part of the mechanism" are two different flags; the density of a printed part is an effective one, or the mass is overridden by a weighed value. D36 adds the rule for every catalog: a catalog fills fields, the document stores the numbers.

What the code says about it:

- **A body has no place to keep anything.** A body is not an object of the document: it is the result of a feature, named `<feature>` or `<feature>/<local name>` (`bodyOwner` in `document.ts`). The document is `schemaVersion`, `settings`, `parameters`, `checks`, `features` (`types.ts`), and `validateDocument` builds the loaded document from exactly those fields (`document.ts`, the line that makes `doc`), so anything else in the file is gone after a load, without a message. Checked by a probe: today's `validateDocument` given `{ schemaVersion: 2, …, bodyProperties: {…} }` returns a document with five keys.
- **Whether a body exists is known only after a recompute.** The registry answers structurally (`createsBody`: an extrusion with the operation `new`; `<pattern>/<positive number>` for a pattern of a body), and says itself that the count of a pattern may be an expression. A suppressed feature and a feature in error create nothing. Commands are validated without a recompute, so a command cannot ask "does this body exist".
- **A property kept on the feature would recompute the model.** The recompute remembers the state after a feature by the identity of the feature object and of the state before it (`Evaluator.run`, `resolve` and `memo` in `evaluate.ts`). A new feature object, for a new colour, computes its step again and every step after it, booleans included.
- **A section the engine does not compare makes no undo step.** `differs` in `engine.ts` compares the chord tolerance, the parameters, the checks and the features. A command that changed only a new section would be committed and leave nothing to undo.
- **An ID can come back.** `types.ts` says an ID is never recycled, but nothing enforces it: `unique` in `document.ts` looks only at the IDs the document has now, and the generator of the app (`newId` in `app.ts`) starts its counters at 1 in every session and takes the lowest number that is free.
- **Bodies are named in the app only** (`bodyName` and `refName` in `packages/app/src/issue-text.ts`: the name of the feature; a copy adds ` / <number>`), MCP lists IDs, and the view draws every body with one material (`viewport.ts`). `exportMesh` without a list takes every body (`engine.ts`); the tool `export_stl` makes the list of all bodies itself and passes it on (`_export_stl` in `packages/mcp/src/tools.ts`).
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
- A way for a copy to state "no colour" or "no material" where its source has one. A copy can state another value; it cannot state none.

Each of these is a new field of an entry or of the catalog. An entry is validated strictly (below), so a build without the later package refuses a document that has the new field; no further upgrade step is needed for it.

## The section

```ts
bodyProperties: Record<Id, BodyProperties>   // in Document, always present, {} when nothing is set
```

`BodyProperties` and its fields are in `contract.ts`. The decisions:

- **A section of the document, keyed by body ID**, next to `parameters` and `checks`. Not on the feature, not a feature of its own: see "Rejected".
- **Always present.** The upgrade step gives an older document the empty section, as the step from version 1 gave it `parameters` and `checks`. A reader never has to ask whether the section is there. An entry with no field left is removed, so "nothing set" has one spelling.
- **Derived bodies have entries of their own**: `screws/2` is a key like `screw`. Nothing else is needed for them in the document.
- **A copy takes after its source.** A body made as a copy of another (a copy of a pattern of a body) inherits what its own entry does not state: colour, material, use, and what it weighs. The name is not inherited; it stays the name of today ("Screws / 2"). Reason: without this, the copies of a reference part would be printed parts by default, and an export for printing would contain three of four screws, silently.
  - **The density and the mass are inherited as a pair.** An entry that states either inherits neither. Field by field, a copy given another material would still be weighed by the mass of its source, because a stated mass wins over a density, and it could not say otherwise: `null` means "inherit".
  - The source is a fact of the document, not of the model: the registry of feature types gets `bodySource(feature, local)`, which a pattern of a body answers with `source.body`. The resolution follows it recursively (a pattern of a copy) and stops at a body it has seen (a document edited by hand may hold a cycle). The source need not exist as a body: its entry is read from the section.
  - It is decided now because it is a change of meaning, not of shape: adding it later would change what a saved document says.
- **An entry whose body is gone stays.** It is a reference that does not resolve, like any other in the document (CLAUDE.md: "a reference to a removed feature is valid in a document on purpose"), and it is not dropped:
  - a feature that is suppressed, a pattern whose count went from 6 to 4, an extrusion in error have no body for a while, and get their properties back with it;
  - dropping would need the recompute inside a command, or a cascade in `removeFeature`, which no other reference has.

  Such entries are listed by `bodyPropertiesWithoutBody` (the keys of the section that are not bodies of the state), shown by `get_model` and by the app, and removed by `removeBodyProperties`. They are not an error.
- **An entry is taken over by a body that appears under its ID.** That is what is wanted when a feature is removed and made again under the same ID, and a trap when the ID is reused for something else: the new printed part would be a reference part with the mass of a motor, and left out of the print export. Three things keep the trap visible:
  - the generators of IDs (`newId` of the app, `freshIds` of the engine) count every ID a section names as used (`namedBySections`: here the feature part of every key), as `freshIds` counts every text of the features today for the same reason; an ID is then reused only by a caller that names it;
  - the answer of `execute` over MCP, and the status line of the app, name what a command took over (`takenOver`): the features and sketch entities the command adds whose ID a section named before the command. It is read from the document and the command, not from the model: a feature removed and added again inside one batch has its body before and after, and is found all the same; a body made and given properties in one batch is not reported;
  - the list of entries without a body is in every `get_model`, so a caller sees them before it reuses an ID.

  The rule is one of the registry of sections, not of this section: 5a names bodies in its links and sketches and points in its axes, and gets both functions with its entry. A derived ID counts with the ID it is derived from, which is the one a caller chooses: the feature of the body `screws/2` here, and in 5a the projected entity `x1` of an axis through its point `x1/center`.

  Considered: `addFeature` refuses an ID that an entry still names. Rejected: making a feature again under its ID is the more common case with an AI as the author, and it would then need the properties removed and set again around it.
- **Strict entries.** The validator of an entry lists the fields it allows (`onlyFields`, as the pattern does for its source) and refuses any other, on a command and on a load. This is what lets later packages add fields without an upgrade step: a build that does not know a field refuses the document instead of dropping the field.
- **The use is one field with three values**; see "Two flags or one field".

### Numeric fields in a section

`density` and `mass` are numeric fields in the sense of the engine: a number or an expression in a command, the last valid number in the document, the expression in `expressions` of the entry under the name of the field. One rule for a number of the document, wherever it is, and one reader (`Fields.number`).

- **Validation** uses `Fields` as it is: `load` checks the syntax of an expression, a command evaluates it at once against the parameters and refuses what does not evaluate or is out of range; fields a command does not name keep their expression without evaluation. `setBodyProperties` follows the recipe of `setField`.
- **The recompute** evaluates the expressions with the environment of the parameters, checks the range, and puts the numbers used into the result. A field whose expression is in error is reported in `fieldErrors` and left out of the result, and nothing takes its place: not its last number, not an inherited value, and for a mass not the density. A copy that inherits the density and the mass carries the errors of its source, so "in error" and "not stated" can be told apart for it as well. (A feature other than a sketch is in error in that case; a body without a known mass is the counterpart.)
- **Write-back.** After `execute` and `load` the engine writes the numbers into the entries, in the same undo step, as it does for features. `Evaluator.evaluate` returns, next to the write-backs of features, the sections whose numbers changed, and `settle` puts them into the document. A preview writes nothing; its evaluation has the numbers.
- **`renameParameter`** rewrites the name in the expressions of the entries as well.
- **An error of a command** names the field in `error.expression.path` by its address inside the section: the key of the entry, a slash, the field (`motor/density`). The field is the last part; a body ID may itself hold a slash.

This machinery is written once, in this package, for every section with numeric fields; 5a uses it for the joints.

**Considered: the field holds a number or the expression itself**, as a parameter holds only its expression; no `expressions`, no write-back. Less code. Rejected: it would be a second convention for a numeric field of the document, and the two are not equally easy to leave: from "number and expression" an upgrade step reaches the other form by moving a string, the other way it would have to evaluate.

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

`evaluation.bodyProperties[body]` for every body of the state (`BodyPropertiesResult` in `contract.ts`): the name, the colour, the material and the use with what is inherited and the defaults; the density; the mass; the body it was copied from.

- **Computed after the timeline**, where the checks are computed (`Evaluator.evaluate`), from the document, the environment of the parameters and the volume of the body. It is not part of the state a feature step sees, so nothing in the timeline is recomputed for it.
- **The mass of a body** is worked out by one rule, written out in `contract.ts` at `BodyPropertiesResult`: none for an auxiliary body; the stated mass; else density · volume / 1000 (g from g/cm3 and mm3); none when neither is stated or the one that would be used is in error. `massFrom` says which.
- **Stable objects.** The result of a body is the same object as long as what it is computed from is the same (a new result equal to the last one of that body is replaced by the last one). A query can therefore name it among the owners of `memo`.
- **A state after a feature** (`getState(at)`, `at` of a tool) has the properties of the bodies that state has.

### What 1d and the exports read

One rule for every reader: a body the caller lists is taken as listed; the use decides only the list a reader makes by itself, and an auxiliary body never has a mass.

| Reader | What it reads | Rule |
|---|---|---|
| Mass properties (1d) | `mass`, `use` of the result | The mass of a body is its `mass`. A body without one takes the density given as an argument of the query; without that the query fails and names the body, and it fails as well for a body whose mass or density is in error. An auxiliary body adds nothing and is listed. With a stated mass the inertia is that of the shape at uniform density, scaled to the mass. This is how "the density comes as an argument until 3a" and the properties meet: the argument stays, as the density of the bodies that state none |
| Print exports (STL of the preparatory step, 3MF of 2g), without a list of bodies | `use` | Only the bodies with the use `part` (`printedBodies`). `exportMesh` follows through the shared `run` of the format, and with it the export of the whole model in the app, which passes no list. The tool `export_stl` makes its own list of all bodies today and has to be changed by hand to make the list of the printed ones. A document without properties exports what it exports today |
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

This is a place where the design departs from the wording of the brief; it is listed under "Open" for the owner.

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
  names(section: S): Id[];                         // the IDs of features and sketch entities the section names, a derived ID with the one it is derived from
  // after the timeline: the result, and the section with the numbers written back when they changed
  evaluate(section: S, doc: Document, model: State, environment: Environment): { result: R; written?: S };
}
```

The places that name the sections today, each changed once to ask the registry:

| Place | Today | With the registry |
|---|---|---|
| `validateDocument`, `emptyDocument`, the constant `EMPTY` (`document.ts`) | each builds a document from five fields | adds every section through `validate`, `empty` |
| `applyCommand` (`document.ts`) | a `switch` over the command types | a command type the `switch` does not have is looked up in `commands` of the sections |
| `renameParameter` (`document.ts`) | parameters, checks, features | and every section |
| `Evaluator.evaluate` (`evaluate.ts`) | adds `parameters` and `checks` to the evaluation | and the result of every section; returns the sections to write back |
| `settle`, `differs` (`engine.ts`) | features only; four things compared | writes sections back; compares every section |
| `UPGRADES` | | the step of the section |
| `describe_api` (`packages/mcp/src/api.ts`) | numeric fields of features and constraints | a generated part "Sections of the document" from `SECTION_INFO` |

The registry is typed by the fields of `Document` that are sections, so a section added to the type without an entry does not compile, as with `FEATURE_TYPES`. `parameters` and `checks` stay as they are: the parameters are the environment everything else is evaluated in, the checks read nothing but them, and neither has entries with numeric fields; nothing would be gained by moving them. `changesDocument` of MCP compares everything of a document but its features as JSON already, so it needs no edit.

Places this package touches beyond the registry: `bodySource` in the registry of feature types (one line in the module of the pattern); the default list of bodies of the `stl` format; `_export_stl` in `packages/mcp/src/tools.ts`, which makes its own list; the button of the export of the model in the app, which is enabled by the number of all bodies; the two generators of IDs; `stateBefore(0)` in the app, which builds an evaluation by hand and has to empty `bodyProperties` with the bodies; `modelSummary`, `documentProblems` and `outcome` in `packages/mcp/src/tools.ts`; `bodyName` and `refName` in the app; the colour of a body in `viewport.ts` and the scene.

## The schema: the upgrade step and the life of a document

The step is `3a-body-properties` (`BODY_PROPERTIES_STEP` in `contract.ts`). It reads and changes only `bodyProperties`: a document without the field gets `{}`; a field that is there, whatever it holds, is left for the validation (the step from version 1 is looser: it takes a `parameters` that is `null` for one that is missing). It commutes with every other step, so the test of the preparatory step (pending steps run before and after the ones merged meanwhile) holds trivially.

`save` always writes the section, also when it is empty.

What happens to a document, by what the build that loads it knows. V is the version of `master` when the branch of this package started (4: the preparatory step raised it to 3 with `d37-schema-steps`, and 2b added `2b-taper`). "Knows the step" means the name `3a-body-properties` is in its list of upgrade steps, pending or merged.

| The document | The build that loads it | Result |
|---|---|---|
| saved by the branch of 3a (`schemaVersion: V`, `schemaSteps: ['3a-body-properties']`) | the same build | loads; the step is not run again |
| the same | a build that knows the step and has more steps after version V (the branch rebased over a step merged meanwhile; `master` after the merge; a branch of another package cut from such a `master`, 5a among them) | loads; the other steps run, this one does not; `master` saves it as its own version without `schemaSteps` |
| the same | a build with the preparatory step that does not know the step (`master` before the merge; a branch of another package cut before the merge) | refused: no step of that name |
| the same | a build from before the preparatory step (an MCP bundle that was not rebuilt) | refused by the version: such a build reads version 2 at most (cross-review, need 16). When this design was written the hole was open: the branch would have saved version 2, which such a build loads, dropping the section without a word; see "Needs from the preparatory step" |
| saved by `master` after the merge (version V+1 or higher) | any build that does not know the step, before or after the preparatory step | refused by the version |
| saved by a build with 3a, without the section of 5a | a build with 5a | loads; the step of 5a adds the empty mechanism |
| saved by a build with 5a | a build with 3a and without 5a | refused: by the version after the merge of 5a, by the name of the step before it |
| any, with a field of an entry the build does not know | a build with the package | refused: the entry is strict |
| saved by a build without the package (version V or lower, no section) | a build with the package | loads; the steps run, this one adds `{}`; the two steps of 3a and 5a give the same document in either order |
| saved by an earlier commit of the branch, when the shape of an entry changed since | the branch | undefined by the scheme: both have the step under one name. Rule for the implementation: a change of the saved shape on the branch renames the step (`3a-body-properties-2`), so the older documents are refused |

## MCP and the app

**By construction.** The three commands go through `execute`, `preview` and `after` with no change in `packages/mcp`. The types of the section, the commands and the result are in the parts of `types.ts` that `describe_api` prints. The numeric fields of the section and its commands are listed from `SECTION_INFO`; the catalog is listed and read like every catalog of the preparatory step. `get_document` returns the document, so the section is in it.

**By hand**, one edit each, with tests:

- `get_model`: every body in `bodies` gets what its result states beyond the defaults (`name` when it has one of its own, `color`, `material`, `use` when it is not `part`, `density`, `mass` in grams, `from`). The answer gets `bodyPropertyErrors` (body, field, message) and, without `at`, `bodyPropertiesWithoutBody`, next to `failedChecks` and `parameterErrors`; `execute` and `preview` return the same lists (`documentProblems` serves all three today).
- `execute` also lists what the command took over (`takenOver`).
- `export_stl`: without a list it takes the printed bodies. The tool builds the list itself today, so this is a change of `_export_stl`, not only of its description; a test covers no list, a list with a reference body, and `perBody`.
- One line of the conventions in `describe_api`: what the three uses mean, that a copy inherits, and that the mass of a bought part belongs in `mass`.

**The app** (`panels/model.ts` of the preparatory step, and a form of its own):

- The line of a body shows its name, its material and its mass, and marks a reference or auxiliary body. `bodyName` and `refName` of the app take the name from the result, so the targets of a feature, the collisions and the bodies an issue names use it as well.
- A selected body has a form: name, colour, use, the material (a select of the catalog, which sends `setBodyMaterial`, and a text field for a label of one's own), density and mass as numeric fields with expressions (the field code of `fields.ts`). Every change is one command.
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
| `namedBySections`, `takenOver` | engine, over the registry of sections | the generators of IDs, MCP, the app; 5a |

## Needs from the preparatory step

1. **Answered** (cross-review, need 16): the preparatory step raised the version to 3 with the step `d37-schema-steps`, which converts nothing, so a build from before it refuses every document saved since; the branch saves version 4 with `schemaSteps: ['3a-body-properties']`. What follows is the need as it was written. **A build from before the preparatory step reads a document of a branch and drops what it does not know.** The scheme of named steps protects against builds that know `schemaSteps`. The branch of this package would have saved `schemaVersion: 2`, which the code of that time accepted; it then rebuilt the document from the five fields it knew.
   - The case: the branch `d36/3a` saves a document with a motor of 280 g; the document is opened by the MCP server of the main tree, whose bundle was built before the preparatory step (CLAUDE.md warns that the bundle runs old code until it is rebuilt); the AI changes a dimension and saves. The properties are gone and nothing said so. The probe is `scratchpad/track-e/probe/older-build.test.ts`, outside the repository.
   - What would close it: the preparatory step raises the version itself, with a first named step that converts nothing. Every document saved after it has version 3, which every build without `schemaSteps` refuses. It does not reach back to documents a branch saved before the version was raised; there should be none.
   - Until then this package could not close it. Package 5a does not have the hole either way.
2. **A place for a note about an export as a whole.** `Exported` has `layout` and `files`, and `about` belongs to a file.
   - The case: `export` of the format `stl` with `perBody` over the arm of scenario 13. The answer has a file per printed body, and the fact that the motor and the screws were left out as reference bodies belongs to none of them. It can be written, by repeating the list in `about` of every file; with a single file it sits in `about` of that file.
   - Asked for, as the cleaner place and not as something that cannot be said otherwise: `skipped`, or an `about`, next to `files`.

Notes for the plan, which this session does not edit:

- **The table of shared places** has `applyCommand` and `validateDocument` for a package with a section. A section also writes to `differs` and `settle` (`engine.ts`), `renameParameter`, `Evaluator.evaluate`, `stateBefore(0)` of the app and `modelSummary` of MCP. This package turns the first four into the registry above, so that 5a adds an entry.
- **The row "Export"** lists 2g and 5b. This package changes the default list of bodies of the `stl` format, of `exportMesh` and of `export_stl`.
- **`viewport.ts` and the scene** are written by this package (the colour of a body, a translucent auxiliary body) as well as by 1a and 1f, and by 5a (the pose). **`packages/mcp/src/api.ts`** gets the generated part for sections.
- **Other packages meet this one in three places**: the default list of bodies of a print export (2g) and of the print queries (1e) should be `printedBodies`; a feature type that derives a body from another (2e, 3d) should answer `bodySource`; the mass query (1d) should read the mass as the table "What 1d and the exports read" says.
- A contract of another package that builds a `DocumentAfter` or an `EvaluationAfter` by hand stops compiling once this one is merged, because both get a required field. None is known.

## Rejected

- **Properties on the feature that creates the body** (a field of the extrusion). A change of a colour would recompute the feature and everything after it (see the code, above). A feature that creates several bodies would need a map by local name; every future type that creates bodies (import, insert, split) would carry the field and its validation. A field directly on a feature is dropped by a build without the package as well, so it saves no upgrade step.
- **A feature type "properties" on the timeline.** It would make the properties depend on a place in the timeline that has no meaning for them, and a change would still invalidate every state after it.
- **A reference to a catalog row in the document** (`material: 'PETG'`, the density looked up at the recompute). D36 decided against it for every catalog: a corrected catalog would change old models.
- **Dropping an entry when its body disappears.** See "An entry whose body is gone stays".
- **No inheritance by copies.** Simpler, and wrong where it matters: the copies of a reference part would be printed.
- **Inheritance of every field by itself.** See "The density and the mass are inherited as a pair".
- **Two independent flags.** See "Two flags or one field".
- **A colour as three numbers.** Three numeric fields with expressions for something no expression will ever drive; `#rrggbb` is what 3MF, the colour control of a browser and the renderer take.
- **Mass and density as two variants of one field** (`{ type: 'density' } | { type: 'mass' }`). A weighed part keeps its material and its density for the parts list, and going back from the weighed value should not need the density typed again.
- **An optional section** (`bodyProperties?`). Every reader would handle its absence, and a document would have two spellings of "no properties".
- **A key by feature instead of by body.** A pattern of a body is one feature with many bodies.

## Open

For the owner:

- **One field `use` in place of two flags: decided by the owner on 2026-11-15.** One field with the values `part`, `reference` and `auxiliary`, as designed.
- **The rows of the catalog: decided by the owner on 2026-11-15.** The seven printing materials, each density from the technical data sheet of Prusament, and from that of Bambu Lab where Prusament does not make the material. A material neither makes is reported at the implementation and not filled in from another source. No metals at the start; a row can be added at any time.

For the implementation:

- The summary line of `get_model` per body grows; whether `density` is worth printing next to `mass` is decided when the answers are read in scenario 13.
- Whether the app shows inherited values in the form of a copy as placeholders.

No third-party library is needed.

## Reviews

### Round 1 (2026-11-15): first version, with 5a

Two reviewers got the same brief, read-only, at commit `340f8f6`: `codex` (gpt-6-astra, effort high; twenty findings over the two packages) and an internal subagent (seventeen, with type probes and a test run against the code, kept outside the repository). `agy` did not take part: its account is out of quota. Every finding was checked against the code before it was acted on. The findings about 5a are recorded in its design; the ones about this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| A copy weighed by the mass of its source cannot be given a density of its own that counts: a stated mass wins, and `null` means "inherit" | both, major | Yes | The density and the mass are inherited as a pair; `calls.ts` has the copy in another material |
| An entry left behind is taken over by an unrelated body that reuses the ID; the app's generator starts at 1 in every session | internal, major | Yes (`newId` in `app.ts`, `unique` in `document.ts`) | "An entry is taken over…": the generators count the keys of the section as used, `execute` names the bodies that took entries over, the reason "an AI makes a feature again" moved to where it belongs; refusing the ID was considered and rejected |
| "Between the two markers, so that `describe_api` shows it": the description cuts that part out | both, factual | Yes (`engineTypes` in `api.ts`) | The contracts name the parts before `porty` and after `přepočet` |
| `export_stl` builds the list of all bodies itself and passes it on, so the default of the format does not reach it | both, major | Yes (`_export_stl` in `tools.ts`) | The tool and the export of the app are in the list of edits by hand, with a test |
| `printedBodies(state)` cannot be called from a format or a query: a context has no such state | both, minor | Yes (probe of the internal reviewer) | Both helpers take the result of the recompute; `calls.ts` calls it from a context |
| A mass in error: "counts as not stated" reads as a fall back to the density, the rule of the mass says otherwise | codex, minor | Yes | One rule, written out in the contract: nothing takes the place of a field in error; `calls.ts` has the case |
| The upgrade step turns a section that is `null` into an empty one instead of leaving it to the validation | codex, minor | Yes (run by codex) | The step asks whether the field is there |
| The table of the life of a document speaks of branches where it means what a build knows; a branch cut after the merge loads the document; 5a has no hole of its own | codex, factual | Yes | The table is by what the loading build knows, with the two rows between 3a and 5a; the note on 5a |
| `bodyName` does not name the bodies of an issue; `refName` does | codex, factual | Yes (`issue-text.ts`) | Both are named |
| "`parameters` and `checks` are evaluated before everything else": the checks are evaluated after the timeline | codex, factual | Yes (`Evaluator.evaluate`) | The sentence says what is true |
| `EMPTY` in `document.ts` is a second document built by hand | both, minor | Yes | In the table of places |
| The app cannot give a material that is not in the catalog | internal, minor | Yes | A text field next to the select |
| `from` is one ID though fields may come from two bodies of a chain; `auxiliary` is "no export" in one place and "as listed" in another | internal, minor | Yes | `from` is the nearest source; one rule for a listed body, stated in the contract and above the table of readers |
| "The saved file could not be read without evaluating expressions" is true of every parameter already | internal, factual | Yes | The sentence is gone; the other reason carries the rejection |
| The need about `Exported` claims that the list cannot be written; it can, on every file | codex, minor | Yes | Reworded as the cleaner place |
| The plan is not told of `viewport.ts`, the default of the exports and `api.ts` | internal, minor | Yes | Notes for the plan |
| The bodies of the scenario are described in comments, not built by calls | codex, minor | Yes | `build` in `calls.ts`, with the commands of today |

Checked by the reviewers and found sound: the statements about the code not named above; every row of the table of the life of a document as it was meant; the hole and its remedy; strict entries; the numeric fields of a section on top of `Fields`, `Evaluator.evaluate` and `settle` for undo, a preview, a batch and a load; `changesDocument`; the recursion of `bodySource`; one field `use`; `setBodyMaterial` against the rule of D36.

Not acted on:

- A way for a copy to state "none" for an inherited colour or material (internal, part of the first finding). Named as deferred: it needs a value for "none" in the entry, which a later optional field can bring.

### Round 2 (2026-11-15), narrow: the fixes of round 1 and what they introduced

The same two reviewers, read-only, at commit `5cf6f5b`; the internal one was a fresh subagent that had not seen the first round. `agy` is still out of quota. They were asked for blockers, majors and factual errors only. Neither found a blocker; both found the fixes of round 1 holding, with the remainders below. `codex` returned four findings over the two packages, the internal reviewer five, with a probe of `freshIds` against the engine.

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The report of a taken-over entry compares the model before and after a command, so a feature removed and added again inside one batch is not reported; and as worded it would report every body made and given properties in one batch | codex (major), internal (as a caveat) | Yes (`applyCommand` runs a batch through; `execute` recomputes once) | `takenOver` reads the document before the command and the command itself; `calls.ts` has both cases |
| A copy that inherits a mass in error has no `fieldErrors` of its own by the rewritten rule, so the mass query takes it for a body that states nothing and weighs it by the density given as an argument | internal, major | Yes | `fieldErrors` holds the errors of the pair that is used, own or inherited; `calls.ts` has the copy |
| The guard against a reused ID covers the keys of this section only; the mechanism names bodies, sketches and points the same way | internal, major | Yes (probe: `freshIds` hands out the ID of a removed point that only a section names) | The rule belongs to the registry of sections (`names`, `namedBySections`, `takenOver`); see also 5a |
| The app does not make its own list for the export of the whole model: it calls `exportMesh('stl')` without one | codex, factual | Yes (`app.ts`, the button "Export STL") | Said as it is; only `_export_stl` makes a list, and the button of the app counts all bodies to enable itself |
| "As the step from version 1 does with `parameters`": that step takes `null` for missing | codex, factual | Yes (`upgrade` uses `??`) | The comparison says so |
| The model `build` makes is not the one the calls of 5a describe: the screws reach into the motor, there is no pin and no hole, nothing depends on the pose | internal, factual | Yes (computed by the reviewer) | `build` makes plates with pins in holes of the same diameter at both joints, screws clear of the motor, and a forearm that runs into the screws and the motor beyond about a quarter turn; the numbers are computed by hand, not run through the kernel |

### Round 3 (2026-11-15), narrow: the fixes of round 2

The same two reviewers, read-only, at commit `90033c8`; the internal one was again a fresh subagent. `agy` is still out of quota. Neither found a blocker. `codex` returned three findings (two major, one factual), the internal reviewer three factual errors and no major; most are about 5a and are recorded in its design. The ones that touch this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The guard against a reused ID counts the point of an axis and not the projected entity it is derived from: with `x1/center` named, `x1` is free for an unrelated projection, which then becomes the axis | codex, major | Yes (`derivedPoints` and `entityOf` in `document.ts`; `freshIds` and `newId` compare whole strings) | `namedBySections` gives a derived ID together with the ID it is derived from, for a body (`screws/2`) and for a point (`x1/center`); `takenOver` reads the same list and counts projected entities, also inside a sketch added whole |
| "The pins are fits" reads as the list `fits` of the report, where a pin in the hole it was drawn with is not | both, factual | Yes (`interference.ts`; `bodies.test.ts`: a pin of the same polygon shares nothing) | The comment of `build` says what the pairs share as modelled; what a sweep expects is in the calls of 5a |

Checked and found holding by both: `takenOver` from the document and the command (a batch, a nested batch, a derived body ID, a sketch point, a sketch added with its entities, a feature removed and added again, a body made and given properties in one batch; `updateFeature` and undo add nothing); `fieldErrors` of the pair that is used; that both generators can count the IDs; the two corrected statements about the code; the commands of `build` against the types and the validators; its geometry, computed by both by hand (the plates touch, the screws are 4.5 clear of the motor, the forearm is 36 from the motor as modelled and 15.04 at 1.2 rad, first contact with a screw near 90.7° and with the motor near 91.2°). Nothing was run through the kernel.

No finding of this round was left without a change. With six findings over the two packages, two of them major and none a blocker, and fixes of a few sentences each, no fourth round was run.

## As implemented

Implemented on the branch `d36/3a`, from `master` at `dd1dd4c` (2a, 2b, 2f and track A merged). Where the code is, by the plan of "A registry of sections":

| File | What |
|---|---|
| `packages/engine/src/types.ts` | `Document.bodyProperties`, `BodyUse`, `BodyProperties` (before the marker `porty`); `Evaluation.bodyProperties`, `BodyPropertiesResult`, the three commands and `BodyPropertiesPatch` (after `přepočet`) |
| `packages/engine/src/sections/spec.ts`, `fields.ts`, `body-properties.ts`, `index.ts` | `SectionSpec`, `SectionInfo`, `SectionFieldSpec`; the numeric fields of an entry; the section; the registry `DOCUMENT_SECTIONS`, `SECTION_INFO`, `namedBySections`, `takenOver` |
| `packages/engine/src/catalogs/materials.ts` | the catalog `materials`, one line in `DATA_CATALOGS` |
| `packages/engine/src/schema.ts` | the step `3a-body-properties`, `SCHEMA_PENDING = 1` |
| `features/module.ts`, `features/pattern.ts`, `features/index.ts` | `bodySource` of the registry (the pattern of a body answers with its source); `bodyProblem` and `bodySource(doc, body)` |
| `document.ts`, `evaluate.ts`, `engine.ts` | `emptyDocument`, `validateDocument`, the default case of `applyCommand` and `renameParameter` ask the registry; `Evaluator.evaluate` adds the results and returns the sections to write back (`sections`); `settle` writes them, `differs` compares them |
| `export/stl.ts`, `query/print.ts`, `query/mass.ts`, `sketch-tools.ts` | the default list of the format `stl` and of the query `print` is `printedBodies`; `massSourceOf` reads the result; `freshIds` counts `namedBySections` |
| `packages/mcp/src/tools.ts`, `api.ts`, `server.ts` | get_model, execute (`takenOver`), `_export_stl`; the generated part *Sections of the document*, the numeric fields of the sections, a paragraph of the conventions; the description of `export_stl` |
| `packages/app/src/panels/body.ts`, `panels/model.ts`, `app.ts`, `scene.ts`, `viewport.ts`, `issue-text.ts` | the line and the form of a body, the entries without a body; names from the result; `newId`, the status line, the export button, `stateBefore(0)`; the colour and the translucency of a body |

Deviations from the design, and choices it left to the implementation:

- **The catalog has six rows, not seven: PA12 has none.** The densities were taken from the technical data sheets on 2026-11-16 (each row names its sheet, its version and its address; the research is recorded in the session, not in the repository): PLA 1.24, PETG 1.27, ASA 1.07, TPU 1.25 and PC 1.22 from Prusament, ABS 1.05 from Bambu Lab (Prusament makes no ABS). Prusament makes PA11 and no PA12, and every nylon of Bambu Lab is filled with fibres, so by the owner's rule PA12 is reported and not filled in. **A question for the owner**: leave PA12 out, add Prusament PA11 (1.02, ISO 1183) under its own name, or allow another source; the nearest PA12-based product is Bambu PAHT-CF (1.06, filled with carbon fibre). Two notes are in the rows: the PrusaSlicer profile of TPU 95A says 1.23 where the sheet says 1.25 (the sheet is the source), and the sheet of PC Blend measures by an in-house method of Prusa Polymers, not by ISO 1183. The calls of `calls.ts` that use PA12 for a copy in another material use PC in the test.
- **The real mass query of 1d, not the stand-in.** 1d was merged first, so `standInMass` is not implemented; `massSourceOf` (the seam 1d named) reads the result. What the stand-in assumed is added to the query `mass`: per body `from` (`densities`, `mass`, `density` of the properties, or `argument`), and `skipped`, the auxiliary bodies listed, which add nothing also when `densities` names them. A body whose mass or density (own or inherited) cannot be evaluated fails the query with `failed` and its name; a list of auxiliary bodies only fails, as it has no mass. The fill factor of the call applies to neither kind of a body's own source, as 1d decided; a fill factor of the properties stays deferred.
- **The print query (1e) without `bodies`** takes `printedBodies` as well, by the table "What 1d and the exports read" (the design's list of places named only the exports).
- **No `about` of an export as a whole** (need 17 of the cross-review): the files of `stl` say which bodies each holds (`about.bodies`), and a model with no printed body says so in `empty` ("list the bodies to export them anyway"). Not needed for anything to work; left for 2g.
- **Load.** An entry with no field (`{}`, or only `expressions: {}`) is dropped on a load, so "nothing set" has one spelling there too; an expression of a field the entry does not have is refused. A key is checked for its form: the part before the first slash passes the rules of an ID, and a part after a slash is not empty.
- **`takenOver`** counts the IDs of features, and of points, curves and projections of sketches (`addPoint`, `addCurve`, `addExternal`, and those of a sketch added whole), not of constraints.
- **The result of a body copied from itself** (a cycle of patterns, only in a document edited by hand) stops at the body seen: its `from` is the next body of the cycle.
- **MCP.** `get_model` prints `density` next to `mass` (the open point "whether density is worth printing" was decided for it: it says what a mass of `massFrom: 'density'` comes from), the mass with six significant digits and `massFrom`. `bodyPropertyErrors` and `bodyPropertiesWithoutBody` are in `documentProblems`, so `execute` and `preview` have them too; `get_model` with `at` leaves out the second. `execute` adds `takenOver` only when it is not empty.
- **The app.** The form is shown for the body of a face or an edge selected in the view, and for a selected feature that created one body (a pattern of several bodies lists its copies; a copy is reached by a face of it). Inherited values and the default name are placeholders (the second open point). The material has a select of the catalog and a field of its own. A picture of the model (D43) keeps its palette: its colours tell the bodies apart for a reader of the picture, and a body's own colour does not.
- **Snapshots of the app test** change in four ways: the form of the properties appears under a selected extrusion and a selected face; the line of a body says that its link exports the body "whatever its use"; the summary of the query `mass` in the menu of queries changed; and a document saved on the branch names its pending step and has the empty section. The new snapshot `properties.txt` drives the form.

### The review of the implementation (2026-11-16)

One full review of `be7b65a` by a subagent that did not write the code; nothing serious, ten findings, all fixed in one commit:

- The empty choice of *Use* in the form of a copy named the copy's own use as that of its source; it now reads the result of the source (`As its source: …`), and the app test drives the form of a copy.
- The mass query read the properties before `densities`, so a body named in `densities` failed when its properties had an error; `densities` now wins over everything but the use `auxiliary`, as its description says. The range of a density of the query is that of the properties, (0, 25] g/cm³, above the densest element (it was 1000).
- The query `print` without `bodies` and with no printed body answers with `empty`, the reason, as the format `stl` does.
- The texts that report `takenOver` no longer say that a sketch point is the body: an ID that body properties name is used again, and a body made under it takes them.
- A result of a section is kept among the last few of its key, so a preview in between does not push it out; the scenario tests that a change of a property recomputes no geometry and that the results of the other bodies stay the same objects.
- The docs: the mass and the print query and the texts of `empty` in `api.md`; the life of a document and need 1 above (the hole is closed by version 3); the comment of the TPU row; the title of a row in the select keeps its sheet.

Open:

- PA12 (above), for the owner.
- A fill factor per body, a print orientation, transparency and the other deferred fields of "The cheap variant".
- The app was not run in a browser for this package; the view's own material of a coloured or translucent body is covered by the type check and the scene of the app test only.

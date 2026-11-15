# 00 Preparatory step, part 2: a module per feature type

**State: implemented (commits `9f3eeb5` to `354501e`); the design below is its fifth version, after four rounds of reviews. What differs is under "As implemented".** Written from reading `packages/engine/src/evaluate.ts` and `document.ts`; both are unchanged between `cedc825` and `371bcd7`. The part changes no public type, so it has no `contract.ts`; the interfaces below are internal and are shown as a sketch that is not type-checked. The scope is in [design.md](design.md), part 2; the reviews that led to this version are recorded there under "Reviews", rounds 2 to 5.

## What is there today

A feature type lives in these places.

| Place | What it holds |
|---|---|
| `types.ts` | the interface of the feature, its member of the union `Feature`, its member of `FeaturePatch` |
| `document.ts` (1370 lines) | the validator (`planeFeature`, `sketchFeature`, `extrudeFeature`, `patternFeature`) and the entry of `FEATURE_TYPES`: info, references, bodies, the fields a patch may change |
| `evaluate.ts` (636 lines) | a private method of `Evaluator` per type (`plane`, `sketch`, `extrude`, `pattern`) and the `switch` in `step` that picks it |
| `packages/mcp/src/tools.ts` | `featureSummary`: a branch for the plane, the pattern and the extrusion, and whatever is left is taken for a sketch |
| `packages/mcp/src/api.ts` | `CONVENTIONS`: paragraphs for the AI, several written for one type (the extrusion, the pattern, the gear) |
| `packages/app/src/app.ts` | the form and the places listed under "What a new feature type costs" (part 3) |

**The step.** `Evaluator.step` does what every type shares before the `switch`: a suppressed feature is an empty operation; a failed expression is an error of the feature, except for a sketch, which is computed with the last valid value and reports a warning (one branch by type in the prelude); the two callbacks `done` and `failed` put the result of the feature into the next state. The methods of the types then use private helpers of the class: `frame` (a `PlaneRef` to a frame), `applyTool` (a tool recipe against its targets), `profile` and `generated` (the profile of an extrusion), `transforms` (the copies of a pattern), and the free functions `withFaces` and `toolSpan`.

- `frame`, `generated` and `transforms` use nothing of `Evaluator`; `applyTool` uses only `deps.kernel`; `profile` calls only `generated`. (Read line by line in the review.)
- `profile` takes the whole `ExtrudeFeature`, but uses only its ID (for the references of an error) and its profile source.
- `transforms` resolves the `AxisRef` of the pattern inline.

**The state** between features has a slot per kind of thing, not per type: `bodies` with the face tables (`faceNames`, `faceInfos`, `faceIds`), `planes`, `sketches`, `tools` (recipes).

**The cache.** A step is remembered by its `Resolution` (the feature object with the values of its expressions) and by the previous state, both by identity. The initial state is kept per settings object. A drag bypasses the cache.

**Completeness** is guarded twice: the registry is a mapped type over `Feature['type']`, and the `switch` ends in a `never`.

**Who imports what.** `document.ts` is a leaf today: it imports only `catalog`, `generators`, `expression` and `util`, which is why `sketch.ts`, `diagnose.ts`, `evaluate.ts` and `engine.ts` import it freely. Two things inside it tie everything to the registry:

- `requireRef` reads `FEATURE_TYPES` (does this feature create a body with this ID, does it name faces). `planeRef`, `axisRef`, `externalRef`, `requireFace`, `profileSource` and all four validators call it.
- `FEATURE_TYPE_INFO` is built from the registry at the top level of the module.

**Special cases by type outside the registry.** `requireRef` names the extrusion twice: a reference of the kind `tool` (a source of a pattern) must be an extrusion with the operation add or cut, and one of the kind `generated` an extrusion with a generated profile. The app repeats both: the first in `patternChoices`, the second in `generatorFields`, which offers earlier extrusions with a profile from an accepted generator. Three texts name the extrusion as well: the label of a reference to a feature that names faces (`REF_LABEL.faceSource`), the summary of the pattern in the registry and the comment of `PatternFeature` in `types.ts`, the last two read by the AI. (The condition on the extrusion in `upgrade` belongs to documents of version 1 and stays.)

**Tests.** Seven of the ten engine test files import `../src/document` (`FEATURE_TYPE_INFO`, `MAX_PATTERN_COUNT`, `featureRefs`, `fieldsOf`, `featureInput`, `emptySketch`, `bodyOwner`, `atPath`, `CommandError` and the commands); some import `solid`, `sketch`, `util`. None imports `evaluate.ts`.

## Proposal

```
packages/engine/src/
  sketch-content.ts   what sketch content is, without validation: emptySketch, Entity and entityOf,
                      derivedPoints, curvePoints, constraintOperands, constraintKey, constraintPath,
                      duplicateOf, isDimension, isDriving, documentIds, bodyOwner
  validation.ts       what validators share: CommandError, ExpressionProblem and fail; Dict, isObject,
                      object, string, finite, boolean, oneOf, onlyFields, newId, base; the reader
                      Fields with FieldMode, FieldInfo and plain, and the field descriptions shared
                      by types; FeatureRef, RefKind and REF_LABEL; faceName, edgeName, faceRefs,
                      planeRefs, axisRefs; planeRef, axisRef, requireFace; the types RefContext
                      and ValidationContext
  recompute/
    state.ts          State, Step, StepContext, Model, ToolRecipe, Placement, ResolvedProfile, Applied,
                      SketchState, SolvedSketch, Deps, DragTarget, WriteBack, Done, Failed
    services.ts       frame with BASE, axis, applyTool, withFaces, lookup, reach, issue and MESSAGE
    profile.ts        a profile source to a ResolvedProfile (regions of a sketch, a generator)
    extent.ts         toolSpan
  features/
    module.ts         the types FeatureModule and FeatureTypeInfo
    profile.ts        the document half of a profile source: profileSource, profileRefs, regions,
                      removableFromProfile, PROFILE_FIELDS, the fields from the generator catalog
    plane.ts          each: the entry of the registry (with its validator and its own field
    extrude.ts        descriptions) and the step of the recompute
    pattern.ts
    sketch.ts         also the validators of sketch content (curve, constraint, externalRef, projected),
                      which the sketch commands in document.ts call
    index.ts          the registry FEATURE_TYPES, FEATURE_TYPE_INFO, specOf, requireRef, producesTool,
                      generatorOf
  evaluate.ts         Evaluator: the cache, run, resolve, rehang, the prelude of a step
  document.ts         commands, validateDocument, upgrade, fieldsOf, featureInput, featureRefs
```

Imports go one way: `types`, `util`, `catalog`, `expression`, `generators` → `sketch-content` → `validation` and `sketch.ts` → `recompute/*` → `features/module` and `features/profile` → `features/<type>` → `features/index` → `document.ts` and `evaluate.ts` → `sketch-tools.ts` and `engine.ts`. A feature module imports neither `features/index.ts`, nor `document.ts`, nor `evaluate.ts`. The list above names a home for every helper the moved code uses; a reviewer checked the graph over the real references and found it free of cycles once each has one.

A module is the entry of the registry plus the step:

```ts
// not type-checked: State, Step, Done, Failed, Fields and FeatureRef are internal today
interface FeatureModule<F extends Feature> {
  info: Omit<FeatureTypeInfo, 'updatable'>;
  validate(o: Dict, what: string, context: ValidationContext): F;
  refs(f: F): FeatureRef[];
  createsBody(f: F, local: string | undefined): boolean;
  namesFaces: boolean;
  producesTool(f: F): boolean;              // can a pattern repeat it? (an extrusion that adds or cuts)
  generator?(f: F): string | undefined;     // the generator of its profile, if it has one
  keepsLastValidValues?: true;              // a failed expression is a warning, not an error (the sketch)
  patch?: { fields: readonly string[]; normalize?(merged: Dict, patch: Dict): void; removable?(f: F, path: string[]): boolean };
  step(feature: F, context: StepContext): Step;
}
interface RefContext {                      // what a helper that checks a reference needs
  doc: Document;
  before: number | undefined;               // as today, see requireRef
  requireRef(ref: Omit<FeatureRef, 'path'>, what: string): void;
}
interface ValidationContext extends RefContext {
  fields: Fields;                           // the reader of numeric fields
}
interface StepContext {
  state: State;                 // before the feature
  settings: Document['settings'];
  deps: Deps;                   // solver, kernel
  done: Done;                   // as today: the result of the feature and the change of the state
  failed: Failed;
  drag?: DragTarget;            // read by the sketch only
  badFields: FieldPath[];       // fields whose expression failed; read by the sketch only
}
const FEATURE_TYPES: { [K in Feature['type']]: FeatureModule<Extract<Feature, { type: K }>> } = { plane, sketch, extrude, pattern };
```

Decisions inside the proposal:

- **The registry is the one guard.** The `switch` goes away; a type without a step does not compile, because the mapped type requires `step`. `Evaluator.step` keeps its prelude and calls the step through `specOf(feature)`, the helper that exists for the same reason today: indexing the registry by `feature.type` loses the tie between the entry and the feature, so the call needs one cast, written once. The entries keep their exact types, so a step paired with the wrong feature type is still refused where the registry is built.
- **A validator gets what needs the registry through its context.** The signature changes from `validate(doc, before, o, what, fields)` to `validate(o, what, context)`. `requireRef` lives in `features/index.ts`, next to the registry it reads, and reaches a validator as `context.requireRef`; `planeRef`, `axisRef`, `externalRef` and `requireFace` take a `RefContext` instead of `doc` and `before`, and `profileSource` the whole context. The three commands that check a reference without a feature validator (`setSketchPlane`, `addExternal`, `updateExternal`) build a `RefContext`; they have no reader of fields and need none. This is the one way a feature module asks the registry anything, and it is why no module imports it. (The first version kept the signature and said the helpers "stay behind functions a validator already calls"; those functions were the ones that had to move.)
- **`requireRef` asks the registry instead of naming the extrusion.** A reference of the kind `tool` is accepted when `producesTool(target)`; one of the kind `generated` when `generator(target)` is among the accepted. The engine exports `producesTool(feature)` and `generatorOf(feature)` next to `fieldsOf`; `patternChoices` of the app calls the first and `generatorFields` the second. A hole or a revolve then becomes a source of a pattern, and a revolved gear a gear to mesh with, by its own registry entry. The texts that name the extrusion (two errors, a label, the summary of the pattern and the comment in `types.ts`) are reworded when the first other type arrives; until then they stay, so no message changes in this step.
- **The helpers become functions over the state, not methods.** `frame(ref, state)`, `axis(ref, state)` (cut out of `transforms`; the query context of part 1 and the revolve need it as well), `applyTool(recipe, model, kernel, placement)`. A module imports them from `recompute/services.ts`; they are not handed over in the context, because a context that grows with every helper would become the next shared place.
- **A profile is a service on both sides.** D35 decided that a revolve is another tool built over the same profile; package 4a must not import the extrusion to get it.
  - Recompute: `recompute/profile.ts` exports `profile(id, source, state, chordTolerance)`, taking the feature ID and the `ProfileSource` instead of the whole extrusion. The facts, warnings and messages of a generated profile stay as they are.
  - Document: `features/profile.ts` holds the validation of a profile source, its references, what a patch may remove from it and the fields generated from `GENERATORS`. Package 2a (profile offset) adds its field there and its computation to `recompute/profile.ts`, and every feature that takes a profile has both.
- **Extents get a home, and are not split further.** `toolSpan` moves to `recompute/extent.ts` unchanged: the extrusion module cannot import `evaluate.ts`, and 2c (a hole through all) and 2f (up to a face) need it too. Tool builds (`buildPrism` in `solid.ts`) stay where they are. Whether they become modules of their own is for the design of 2a, the first package that changes them.
- **The interfaces of the features stay in `types.ts`.** A new type adds its interface and one member to `Feature` and to `FeaturePatch`. `Feature` is a union and cannot be extended by declaration merging, and `describe_api` cuts the description for the AI out of the raw text of `types.ts`. One line in a union is the size of shared change the plan accepts.
- **The sketch moves last and only as far as the others.** Its validator, the validators of its content and its step move to `features/sketch.ts`; the sketch commands stay in `document.ts` and import those validators. The helpers that only read sketch content move to the leaf `sketch-content.ts`, because `sketch.ts`, `diagnose.ts` and the sketch step all need them below the registry.
- **`document.ts` and `evaluate.ts` re-export what moved.** Everything the tests and the other modules import from `document.ts` today keeps that path (`FEATURE_TYPE_INFO`, `MAX_PATTERN_COUNT`, `bodyOwner`, `emptySketch`, `CommandError`, `constraintOperands` and the rest). `evaluate.ts` re-exports `SketchState`, `Deps`, `DragTarget` and `WriteBack`, which `engine.ts`, `index.ts` of the package and the contract of part 1 import from it. `index.ts` of the package keeps what it exports and gains `producesTool` and `generatorOf`. The tests stay untouched.
- **`featureSummary` of MCP gets a default.** It names the sketch explicitly, and a type without a branch of its own is summarised by the fields `FEATURE_TYPE_INFO[type].updatable` lists plus its facts. The answers for the four existing types do not change, and a new type compiles and is described without an edit there.

## What a new feature type costs afterwards

In its own files:

1. `features/<type>.ts`: the entry of the registry, the validator and the step.
2. The form in the app (part 3): one file.
3. Its tests, and a scenario when it is an engine feature.

One line or one entry in a shared place:

4. `types.ts`: the interface, one member of `Feature`, one of `FeaturePatch`.
5. `features/index.ts`: one line.
6. `IssueCode` in `types.ts` and its text in `MESSAGE` (`recompute/services.ts`), for every new code. The app shows that text and needs nothing, unless the references of the issue are bodies or features that it should name.
7. The roles of the faces it names, when it needs a new one: a member of `FaceName`, an entry of `FACE_ROLES` (part 4, "Roles of faces") and a text in the app.
8. The registry of the app (part 3): one line. Until part 3 is done that is fifteen places of the app, listed in [part3-app-panels.md](part3-app-panels.md).
9. `CONVENTIONS` in `packages/mcp/src/api.ts`, when the AI has to be told how the type is used. The fields, their ranges and the shape of the feature reach `describe_api` without it.

Only when the type brings something new in kind:

10. A new kind of surface: `FaceInfo`, `transformFace`, `edgeKind` and `projectEdge` in `solid.ts`, and `Surface` (part 4).
11. A tool that is not a prism: the type of what `ToolRecipe` builds (`Prism` today).
12. A new kind of reference between features: `RefKind`, its label and its branch in `requireRef`. (A reference to a feature of one given type, as to a plane, a sketch or a pattern today, needs only the kind: `requireRef` compares it with the type.)

Not needed:

- `packages/mcp/src/tools.ts`: the default summary covers it; a branch is added only for a better summary.
- A step of `UPGRADES`, for a new type: a build that does not know the type refuses a document with it. (A new field of an existing type is another matter: where a build without it would drop the field without a word, the package adds a step. Part 4 of design.md, "Schema version".)

## How it is done without changing behaviour

Order, one commit each, the tests green after every one:

1. `sketch-content.ts`, and the part of `validation.ts` that asks nothing of the registry (`fail`, `object`, `oneOf`, `Fields`, `faceName` and the like): the leaf helpers move; `document.ts` re-exports them; `sketch.ts` and `diagnose.ts` import the leaf. A test imports every module of the engine as the first one, each in a fresh module registry, so a cycle that only shows with another import order fails there. (Today a cycle through `document.ts` would load, because `engine.ts` and `evaluate.ts` import `document.ts` first, and break only for a test that starts elsewhere.)
2. The validation context: every validator and reference helper takes a context. `planeRef`, `axisRef` and `requireFace` move to `validation.ts` in this commit, not before: moved earlier they would import `requireRef` back from `document.ts`. `externalRef` and `profileSource` change their signature here and stay in `document.ts` until their modules exist (commit 4). `requireRef` still sits in `document.ts`.
3. `recompute/state.ts`, `recompute/services.ts`, `recompute/profile.ts`, `recompute/extent.ts`: types and helpers move out of `evaluate.ts`; the methods of the types still live in `Evaluator` and call the functions.
4. The steps and the validators move into `features/`, one type per commit: plane, pattern, extrude (with `features/profile.ts`), sketch.
5. `features/index.ts` takes the registry, `FEATURE_TYPE_INFO`, `specOf` and `requireRef`, with the two registry properties in place of the two special cases; the `switch` goes.
6. The default of `featureSummary`; `producesTool` in `patternChoices` and `generatorOf` in `generatorFields` of the app.

Checks:

- The engine and scenario tests pass untouched.
- `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change` shows the steps and validators as moved. Lines that lose `this.` or change `doc, before` to `context` show as edited; those are read one by one.
- The fuzz of the kernel adapter and the spikes pass; the time of the recompute of scenario 9 does not change.
- The cache is not touched: the `Resolution` and the previous state stay its keys, the initial state stays per settings object, a drag still bypasses it, and `Step.writeBack` and `rehang` are as they were.

This is the most delicate file of the engine, so the part gets its own independent review before part 1 (the registry of queries) starts on `engine.ts`.

## As implemented

The six steps were done in the order above, one commit each and four for step 4. Every commit passed all the tests untouched, both type checks, the spikes and the MCP build. What differs from the text above:

- **The test of commit 1 checks more.** Besides loading every module as the first one, `packages/engine/test/modules.test.ts` reads the imports that exist at run time and fails on any cycle among them. Loading alone would not show a cycle whose modules read each other only inside functions.
- **No field description is shared by types**, so `validation.ts` holds none: `OFFSET`, the two of the extent and the two of the pattern live with their types.
- **`refContext(doc, before)`** (the `RefContext` over `requireRef`) is exported by `features/index.ts` next to `requireRef`; `document.ts` uses it for `validated`, `fieldsOf` and the three commands.
- **`frame` of the services** is imported by the modules under another name (`frameOf`), because the steps call their result `frame`.
- **The fields a profile brings from the catalog of generators** are exported by `features/profile.ts` as `PROFILE_FIELD_SPECS`, and the extrusion lists them in its entry.
- **`featureSummary` lost its three branches**, not only gained a default: the fields `updatable` lists, in their order, plus the facts are exactly what the branches of the plane, the pattern and the extrusion returned.
- **`StepContext` came with the first module** (commit 4a), not with commit 3.
- **An unknown feature type in the recompute** used to throw from the `default` of the `switch`; now `specOf` gives no module and the call fails. Neither can be reached: a document is validated before it is replayed.

## Open

- A type that needs state of its own kind (not a body, a plane, a sketch or a tool) would add a slot to `State`. None of the types planned in D36 does: an imported or inserted part and a boolean of bodies produce bodies, a hole and a revolve produce a tool. The mechanism of step 5 is a section of the document, not a feature.
- `MESSAGE` and `IssueCode` stay shared tables that every package with a new code edits by one line each. A module could carry the texts of its own codes; the codes are a union in `types.ts` that the AI reads, so the two would have to move together. Not proposed.
- The texts of `CONVENTIONS` are prose per topic, not per type, and stay hand-written. Whether a module should carry a paragraph of its own is left to the first package that writes one.

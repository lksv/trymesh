# 00 Preparatory step, part 2: a module per feature type

**State: design, not reviewed.** Written from reading `packages/engine/src/evaluate.ts` and `document.ts` at commit `cedc825`. It changes no public type, so it has no `contract.ts`; the interfaces below are internal and are shown as a sketch that is not type-checked. The scope is in [design.md](design.md), part 2.

## What is there today

A feature type lives in four places.

| Place | What it holds | Lines |
|---|---|---|
| `types.ts` | the interface of the feature, its member of the union `Feature`, its member of `FeaturePatch` | |
| `document.ts` | the validator (`planeFeature`, `sketchFeature`, `extrudeFeature`, `patternFeature`) and the entry of `FEATURE_TYPES`: info, references, bodies, the fields a patch may change | file of 1370 |
| `evaluate.ts` | a private method of `Evaluator` per type (`plane`, `sketch`, `extrude`, `pattern`) and the `switch` in `step` that picks it | file of 636 |
| `app.ts` | the form | part 3 |

`Evaluator.step` does what every type shares before the `switch`: a suppressed feature is an empty operation, an expression error is an error of the feature (a warning for a sketch), and the two callbacks `done` and `failed` put the result of the feature into the next state. The methods of the types then use private helpers of the class: `frame` (a `PlaneRef` to a frame), `applyTool` (a tool recipe against its targets), `profile` and `generated` (the profile of an extrusion), `transforms` (the copies of a pattern), and the free functions `withFaces` and `toolSpan`.

The state between features has a slot per kind of thing, not per type: `bodies` with the face tables, `planes`, `sketches`, `tools` (recipes).

The completeness is guarded twice: the registry is a mapped type over `Feature['type']`, and the `switch` ends in a `never`.

## Proposal

```
packages/engine/src/
  features/
    index.ts        the registry: one line per type
    plane.ts        each: the entry of the registry and the step of the recompute
    sketch.ts
    extrude.ts
    pattern.ts
  recompute/
    state.ts        State, Step, Model, ToolRecipe, Placement, ResolvedProfile (today at the top of evaluate.ts)
    services.ts     frame, applyTool, withFaces, issue
    profile.ts      a profile source to a ResolvedProfile (regions of a sketch, a generator)
  validation.ts     what validators share (object, oneOf, the reader Fields, planeRef, axisRef, faceName)
  evaluate.ts       Evaluator: the cache, run, resolve, rehang, and the prelude of a step
  document.ts       commands, validateDocument, upgrade, fieldsOf, featureInput
```

A module is the entry of the registry plus the step:

```ts
// not type-checked: State, Step, Done, Failed, Fields and FeatureRef are internal today
interface FeatureModule<F extends Feature> extends FeatureTypeSpec<F> {
  step(feature: F, context: StepContext): Step;
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

`Evaluator.step` keeps its prelude and calls `FEATURE_TYPES[feature.type].step(feature, context)`. The `switch` goes away; the mapped type of the registry is the one guard, and a type without a step does not compile.

Decisions inside the proposal:

- **The helpers become functions over the state, not methods.** `frame(ref, state)`, `applyTool(recipe, model, kernel, placement)`. `frame` and `applyTool` use nothing of `Evaluator` but `deps` today, so this is a move, not a rewrite; `profile`, `generated` and `transforms` were not read line by line for this design. A module imports them from `recompute/services.ts`; they are not handed over in the context, because a context that grows with every helper would become the next shared place.
- **Resolving a profile is a service, not a part of the extrusion.** D35 decided that a revolve is another tool built over the same profile; package 4a must not import the extrusion to get it. Package 2a (profile offset) then changes `recompute/profile.ts` once, and every feature that takes a profile has it.
- **The extrusion is not split further here.** Extents (`toolSpan`) and tool builds (`buildPrism` in `solid.ts`) stay where they are. Whether they become modules of their own is for the design of 2a, which is the first package that changes them; splitting them now would be guessing its needs.
- **The interfaces of the features stay in `types.ts`.** A new type adds its interface and one member to `Feature` and to `FeaturePatch`. They could move into the modules by declaration merging, as the queries do, but `describe_api` cuts the description for the AI out of the raw text of `types.ts`, and the shape of a feature is what an AI has to read. One line in a union is the size of shared change the plan accepts.
- **Validators get what needs the registry from their arguments.** `validate(doc, before, o, what, fields)` keeps its signature. Helpers that ask the registry (does this feature create a body with this ID) stay in `document.ts` behind the functions a validator already calls; `validation.ts` holds only helpers that know nothing of the registry. Otherwise `validation.ts` and `features/index.ts` would import each other.
- **The sketch moves last and only as far as the others.** Its validator and its step move; the sketch commands and the helpers of sketch content stay in `document.ts` and `sketch.ts`. It is the largest of the four and the one a drag goes through.

## What a new feature type costs afterwards

1. `types.ts`: the interface, one member of `Feature`, one of `FeaturePatch`.
2. `features/<type>.ts`: the entry of the registry and the step.
3. `features/index.ts`: one line.
4. The form in the app (part 3): one file and one line.

Nothing in `packages/mcp`: the description of feature types is generated from the registry already.

## How it is done without changing behaviour

Order, one commit each, the tests green after every one:

1. `recompute/state.ts` and `recompute/services.ts`: types and helpers move out of `evaluate.ts`; the methods of the types still live in `Evaluator` and call the functions.
2. The steps move into `features/`, one type per commit: plane, pattern, extrude, sketch.
3. `validation.ts`; the validators move next to their steps.
4. `features/index.ts` replaces the registry in `document.ts` and the `switch`.

Checks: the engine and scenario tests are untouched and pass (they go through the public API only); `git diff --color-moved` shows the steps and validators as moved, not edited; the fuzz of the kernel adapter and the spikes pass; the time of the recompute of scenario 9 does not change. The step cache is keyed by the feature object and the previous state and is not touched.

This is the most delicate file of the engine, so the part gets its own independent review before part 1 (the registry of queries) starts on `engine.ts`.

## Open

- A type that needs state of its own kind (not a body, a plane, a sketch or a tool) would add a slot to `State`. None of the types planned in D36 does: an imported or inserted part and a boolean of bodies produce bodies, a hole and a revolve produce a tool. The mechanism of step 5 is a section of the document, not a feature.
- `MESSAGE`, the table of texts by issue code in `evaluate.ts`, is one more place every package with a new code edits. A module could carry the texts of its own codes. Not proposed yet: the codes are also a union in `types.ts`, and the two would have to move together.
- Import cycles. `features/*` import services and types; `evaluate.ts` and `document.ts` import the registry. As drawn there is no cycle; the implementation has to keep it so, and nothing checks it today.

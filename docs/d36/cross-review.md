# D36: the review over the whole set of designs

The third point of "How the work goes" in [README.md](README.md): after each design was reviewed on its own (three rounds per track, recorded in each `design.md`), the twelve full designs of tracks A, B and E are read together, against the maps of the plan and against the preparatory step as it was implemented.

Date: 2026-11-15. Read by the session that implemented the preparatory step, with no further reviewer (the owner's rule of the same day: the depth of a review follows its risk; this one changes documents only). The branches `d36/design-a`, `d36/design-b` and `d36/design-e` are merged into `master`; they added only their own directories.

## What was checked

- **The contracts compile together** against `master` with the preparatory step in it (`npx tsc -p docs/d36/tsconfig.json`): no two packages declare one name with different types.
- **The names each package adds to a shared map**, listed below, for a name used twice with the same type, which the compiler does not see.
- **The numbers** of decisions and validation scenarios.
- **Every "Needs from the preparatory step"**, against what `master` has.
- **Names of files and functions** the designs use for things of the preparatory step, which was implemented after the branches were cut.

## Names added to the shared maps

| Map | Added | By |
|---|---|---|
| Queries | `section`, `measure`, `gap`, `mass`, `print` | 1a, 1b, 1c, 1d, 1e |
| | `hardwareHole` | 2c |
| | `mechanism` | 5a |
| Operations of the app | `view_image`; the member `view` of `AppHost` | 1f |
| Feature types | `hole`; `extrude` is replaced by its widened form | 2c; 2a (2b and 2f widen it further) |
| Face roles | `wallSide`, `wallEnd` | 2a |
| | `holeBore`, `holeHead`, `holeFlat`, `holeSeat` | 2c |
| Issue codes | `invalidHole`; `invalidExtent`; `jointLimits`, `jointOutOfLimits` | 2c; 2f; 5a |
| Data catalogs | `clearanceHoles`, `socketHeadScrews`, `countersunkScrews`, `hexNuts`, `heatSetInserts` | 2c |
| | `materials` | 3a |
| Sections of the document | `bodyProperties`; `mechanism` | 3a; 5a |
| Commands | `setBodyProperties`, `setBodyMaterial`, `removeBodyProperties` | 3a |
| | `setLink`, `removeLink`, `setJoint`, `removeJoint`, `setPose` | 5a |
| Kernel port | `minGap` | 1c |

No name is taken twice, and none is a name `master` has (queries `interference`, `sketchDiagnosis`, `constraintExplanation`, `body`, `catalog`; roles `side`, `startCap`, `endCap`).

Two entries exist only so that a draft compiles before the package it waits for: `standInMass` (3a, for `mass` of 1d) and `standInGap` (5a, for `gap` of 1c). They go when the scenario becomes a test.

**Numbers.** Decisions D38 to D43 are track A (1a to 1f), D44 to D47 track B (2a, 2b, 2c as D46, 2f as D47), D48 is 3a and D49 is 5a. Scenario 11 is shared by track A, 12 by track B, 13 by 3a and 5a. Nothing collides; the next free numbers are D50 and scenario 14.

## Needs from the preparatory step

"Answered" means `master` has it. "With the package" means it is a small addition to a shared type that only that package needs first, so it is made in the first commit of that package and reviewed with it; the packages that use it later find it there.

| # | Need | From | In `master` | What happens |
|---|---|---|---|---|
| 1 | The units of the numbers of a result, readable by a program (`units` on `QuerySpec`), and the unit `g·mm2` | 1b; used by 1a, 1c, 1d, 1e | No: `returns` is a sentence, `significant` a map of keys | With 1b, in its first commit of shared pieces: an optional `units` in the form `significant` has. The stand-ins `ResultUnits` and `QUERY_UNITS` go. `g·mm2` comes with 1d |
| 2 | `invalidArguments` as a code a query may fail with in `run` | 1b; used by 1c, 1d, 1e | Half: the outcome of `Engine.query` has the code, `QueryFailure` takes only `notAvailable` and `failed` | With 1b: the third code of `QueryFailure` (`query/spec.ts`). Until then `failed` with the path of the argument |
| 3 | A title and a summary for an entry of `fields` and an option of `oneOf` | 1b, 1e, 1f | No: a nested entry is an `ArgKind` with `optional` only | With 1b (the generic form is its reader): optional `title` and `summary` on both; `describe_api` prints them |
| 4 | A change of `BodyDescription` (the exact circle of an edge) cannot be said through a map | 1b | It is an ordinary type of `types.ts` | No need remains: the package edits the type. The stand-in `BodyEdgeExact` goes |
| 5 | How a package adds a method to a port | 1c; 3d later | The port is an exported interface | Recorded as a rule in README.md: an addition to a port is declared as a property, and the implementations of the port (the adapter and the fakes of the tests) are work of the package |
| 6 | The path of an operation of the app: its entry, how the app hands over its host, the schema of the tool, the picture as image content | 1f | Answered: `callHostOperation(host, name, args)` and `HOST_OPERATIONS` in `packages/mcp/src/host.ts`; `connectBridge(engine, { host })`; the server builds the tools of the operations and turns an answer of the kind `image` into image content | The stand-in `callOperation` is `callHostOperation`; the operation goes into `host.ts` or a module next to it, not into a new `operations.ts` |
| 7 | Who checks the arguments of an operation | 1f | Differs from the design: `callHostOperation` checks shape and range, fills in defaults and also looks up every ID, in the state of the document now | Settled together with 8: once the path takes the state asked about, the IDs are looked up in that state, as for a query. The design's own lookup (`requestOf`) is then not needed |
| 8 | The state an operation works on (`at`, `after`, as the tool `query` has) | 1f; 5a wants a picture of a pose | No | With 1f: the path of an operation takes `at` and `after`, checks the arguments against that state and hands it to `run`. `at` leaves the arguments of `view_image` |
| 9 | Data next to a picture (`about` on the image answer) | 1f | No: an image answer is a media type and the bytes | With 1f: an optional `about`, printed as text next to the picture |
| 10 | What a form wants picked in the view depends on its state (`picks` as a function of the mode) | 2f | No: `FeatureForm.picks` is a fixed value (`packages/app/src/features/draft.ts`), read at two places of `app.ts` | With 2f: `picks` may be a function of the mode. Part 3 was written so that this is a change of one type and two lines |
| 11 | One home for the circle of two surfaces | 2b; 1b | No such function | Whichever of 1b and 2b is implemented first writes it in the engine over `Surface`; by the order of the steps that is 1b, and 2b adds the cone. The stand-in `circleBetween` of 2b goes |
| 12 | Who writes the cone | 2b | `Surface` has the kind `cone` and `BodyFace.convex` names it; `FaceInfo` (`solid.ts`) has no cone and nothing derives one | 2b, as its design takes it: `FaceInfo`, the derivation of `Surface`, `convex` |
| 13 | A part of a face role that holds the ID of a derived point (it has a slash) | 2c | The validator of a text part accepts any string, so the name is valid; nothing says so and no test holds it | With 2c: the sentence in `face-roles.ts`, a test, and the rule that keeps keys apart: at most one part of a role may hold a free ID, the others are from a closed set or whole numbers (`wallSide` of 2a obeys it) |
| 14 | `producesTool` and `generatorOf` have no declaration | 2c | Answered: both are exported from the index of the engine | The stand-in of `calls.ts` goes |
| 15 | `FeatureRef.notProjected`, two members of `ResolvedProfile`, `ToolProblem` | 2a, 2f | The files exist (`validation.ts`, `features/index.ts`, `recompute/state.ts`, `recompute/services.ts`) | No need; the packages edit them. They are added to the shared places of the plan |
| 16 | A build from before the preparatory step drops what a branch saved | 3a | Answered: the step raised the schema to version 3 with the named step `d37-schema-steps`, which converts nothing; an older build refuses such a document | The row of 3a's table about the hole can go |
| 17 | A note about an export as a whole | 3a | No: `Exported` has `layout`, `files` and `empty` | With 3a: an optional `about` next to `files`, printed by the tool. Not needed for anything to work |
| 18 | The model as modelled for a query: `geometry: 'modelled'` on an entry and an option of the caller | 5a; it concerns `print` of 1e | No; a pose does not exist yet | With 5a, which is where a pose appears: both members, and `print` is marked. 1e is implemented before and needs nothing until then |
| 19 | The tool `query` says which state it answered for | 5a | No | With 5a: a note beside the result |
| 20 | `get_body` would mix a posed and a modelled answer | 5a | `get_body` takes the faces and edges from the query `body` and the volume and bounds from the state; `BodyDescription` has both | With 5a: the tool prints the volume and bounds of the description. They are equal until then |
| 21 | The checks before `run` should not read `context.bodies` | 5a | Answered: the checker reads the evaluation (`CheckScope`), not the context | None |

Nothing in the list asks for a change of the preparatory step before a package can start. Rows 1 to 3 and 6 to 9 all land in the first package of track A that needs them (1b and 1f), so within the track 1b's commit of shared pieces goes first, as its design already orders.

## Where the designs name things otherwise than `master`

The branches were cut before parts 1 and 3 of the preparatory step were implemented. A package reads these as follows.

| The design says | `master` has |
|---|---|
| `queries/` in the engine (1b, 2c: `queries/hardware-hole.ts`) | `packages/engine/src/query/`, one module per query, the catalog in `query/index.ts` |
| `operations.ts` in `packages/mcp`, `callOperation` (1f) | `packages/mcp/src/host.ts`: `HOST_OPERATIONS`, `callHostOperation`, `AppHost` |
| `upgrade` in `document.ts`, "version 2" (3a, 5a) | `packages/engine/src/schema.ts`: `UPGRADES`, `SCHEMA_PENDING`; the version is 3 |
| `catalogs/hardware.ts`, `catalogs/materials.ts` (2c, 3a) | No such directory yet; `data-catalogs.ts` holds the map and its helpers. The two packages agree on `catalogs/`, which is kept |
| The scene asks the panel of the queries for its additions (1b); the pose and the colour of a body in the scene (5a, 3a) | `packages/app/src/scene.ts`, `modelScene(host, collisions, sketch)`: the place where the additions of a view, a colour and a pose enter |
| The form of the extrusion, `FeatureUi.form.picks` (2f) | `packages/app/src/features/extrude.ts`; `FeatureForm` in `features/draft.ts`; a mode carries its form |
| `panels/query.ts`, `QUERY_VIEWS`, `packages/app/src/queries/` (1b, 1c, 1e) | Not there yet, as the design of part 3 says: 1b builds them |

## Where packages meet each other

Not collisions; the places where the second package to be merged has to read what the first one did.

- **1d and 3a.** The density is an argument of `mass` until 3a; then it comes from the document through one function (`massSourceOf`, named by 1d, written by 3a after the table "What 1d and the exports read"). A fill factor per body belongs to 3a.
- **1e and 3a.** The default list of bodies of the print queries becomes `printedBodies` of 3a. The same holds for the print export of 2g and for the format `stl`, whose default 3a changes.
- **1e and 5a.** A print query with an orientation given as a direction is wrong in a pose until row 18.
- **1b and 2b**: the circle of two surfaces (row 11). **1b and 1a, 1c, 1d, 1e**: the generic form of a query and `QueryView`; 1b's first commit comes before the app side of the others.
- **1a, 1f, 3a, 5a** all write to `viewport.ts` and `scene.ts` (a clipped section, a picture, a colour and a translucent body, a pose). They are in different tracks, so their merges are sequential there by the rule of the plan.
- **2a, 2b, 2f, 2c** share the tool build (`recompute/`); track B is sequential. 2f's failure of a build with a code reaches the pattern of 2e without a change of 2e.
- **3a and 5a**: 3a turns the places a section of the document touches into a registry of sections; 5a adds an entry. 5a therefore starts from a `master` with 3a.
- **5a** needs 1c for the gap in a pose and 1d for the mass beyond a joint (scenario 13), and for its app side the generic form of 1b.

## For the plan

Taken over into [README.md](README.md) with this review:

- the shared places `recompute/state.ts`, `recompute/services.ts`, `recompute/extent.ts` and the registry line of `features/index.ts` (track B, 2e, 4a); `viewport.ts` and `scene.ts` (1a, 1f, 3a, 5a); the registry of sections of 3a; the row of the export gets 3a;
- 5a needs 1d as well as 1c and 3a;
- the rule for an addition to a port;
- the numbers taken.

## Decisions waiting for the owner

Each is described in the design named. None blocks the start of a track; the ones marked "before" should be answered before the implementation of that package, because a later change costs documents or a rewrite.

| Package | Question | When |
|---|---|---|
| 1c | Does the kernel port get `minGap`, or does the gap use only the pass over triangles with `interference` or a point-in-solid test? One measurement on a model with many near pairs settles it | before 1c |
| 1f | Is the app normally connected while the AI works? If not, a picture is missing exactly there, and a rasteriser in the server joins the package | before 1f |
| 2a | Should an inward offset that makes a corner arc vanish give a sharp corner instead of an error? | before 2a is closed; the design leaves it out |
| 2c | The source of the numbers of the hardware tables (the standards, or a named published table); the maker of the heat-set inserts; bearings now or later | before 2c |
| 3a | One field `use` or two flags (`reference`, `auxiliary`); the rows of the catalog of materials (which makers, metals or not) | before 3a: it is the shape of the document |
| 5a | A coupled motion through a parameter; a forest of links instead of one root; a missing link is not a broken reference; the model as modelled is the zero of every joint; the axis of a joint from a cylindrical face deferred | before 5a: the first three differ from the wording of the brief |
| 00 | The schema version was raised to 3 by the preparatory step (row 16), so documents saved from now on are refused by builds made before it | for information |

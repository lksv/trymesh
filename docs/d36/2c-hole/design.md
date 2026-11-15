# 2c Hole feature and the hardware catalogs (D46)

**State: design, third version, after two rounds of reviews ("Reviews").** Written against the sixth version of the contract of the preparatory step and the code at `0dc424b`. It needs [2a](../2a-offset/design.md) (the extent as a service, the flag `notProjected` on a reference, the tool builds as modules), [2b](../2b-taper/design.md) (the stack of sections, the cone, circles between surfaces) and one class of [2f](../2f-upto/design.md) (`ToolProblem`). The tools of this package (a countersink, a counterbore with its step, a hexagon pocket with its step, four holes in one tool) were run through the real kernel adapter in the spike of 2b ("What was tried"); nothing else was run. **No dimension of a screw, a nut or an insert is written in these files: none was looked up, and none may come from memory.** The columns of the catalogs are a proposal for the same reason ("The catalogs").

Files: [contract.ts](contract.ts) (the feature, its patch, the face roles, the issue code, the catalogs' columns, the query), [calls.ts](calls.ts) (its part of validation scenario 12, and the whole scenario in its order).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Hole feature with a hardware catalog": a feature type `hole` with a sketch, a list of its points, a description by kind, an extent and targets like a cut; a tool recipe, so a pattern repeats it; the catalog fills the fields and the document stores numbers and a free-text label; values from the standards; open: the names of the faces with several points.

| Statement | What the code says |
|---|---|
| "A feature type in the registry" | After the preparatory step: a module `features/hole.ts` with its entry and its step, a line in the registry, the interface and two union members in `types.ts`. A build without it refuses the document, so no upgrade step |
| "It stores a tool recipe, so a pattern repeats it like any cut" | `ToolRecipe` (`evaluate.ts`) is the operation, the targets and `build`; `applyTool` and the pattern know nothing else. But `requireRef` (`document.ts`) accepts as a source of a pattern only "an extrusion with the operation add or cut", by name; the preparatory step turns that into `producesTool` of the registry. Five texts name the extrusion and are reworded by the first other type, which is this one (below) |
| "An extent and targets like a cut" | The extent of a cut is `distance` with a sign or `throughAll` with a side. Both give a hole its direction without a field of its own. `throughAll` with `both` has no start, so a hole with a head cannot use it. `toolSpan` makes the tool of "through all" longer than the targets by an overshoot (`max(1, 1 %)` of the largest coordinate), and returns only the overshoot when no target lies on that side: a hole must not take that length for its depth ("Recompute") |
| "The tool is a stack of sections along the axis" | `buildPrism` builds one section. The stack of 2b builds several; a step between two sections of different outlines is a planar ring that the kernel triangulates (`triangulate` takes an outer loop and holes) |
| "The side name has to carry the point and the section; `FaceName.curve` holds one ID today" | The preparatory step answers with `FACE_ROLES`: a role with named parts, each a text or a whole number. A count of sections is the wrong part, though: see "Faces" |
| "The catalog is data exported by the engine and listed in `describe_api` (and a query for one size), a tool composes the feature from it" | `DataCatalog` and the query `catalog` of the preparatory step are the first two. The third has no place yet: sketch tools draw into a sketch (`SKETCH_TOOLS`), and D33 wants few general MCP tools. A query does it |
| "One boolean on a plate with 192 holes took 7.6 s" (the table of candidates) | A hole feature with n points is one tool and one boolean per target, like an extrusion of n circles. A pattern of it is one boolean per copy |

## The cheap variant

- **A feature type `hole`**: a sketch, a list of its points, a shape, an extent, targets, a label. One hole at every point, along the normal of the sketch plane, cut out of every target.
- **Four shapes**: plain, counterbore, countersink, nut pocket. A hole for a heat-set insert is a plain blind hole with catalog values. The head is at the mouth, where the extent starts.
- **The extent** is `distance` (the mouth at `start`, the depth and direction in `distance`) or `throughAll` with `forward` or `backward`.
- **One tool for all points**, each hole a stack of sections of 2b, so the lower rim of a countersink is one ring shared by the cone and the bore.
- **Faces named by what they are** and by the point: the bore, the head, a flat of a nut pocket, the seat.
- **A source of a pattern**, by its registry entry.
- **Five catalogs**, one per standard, and **one query `hardwareHole`** that turns a use and a size into the shape and the label of a hole. The document stores numbers, expressions and the label; nothing looks a size up at recompute.

**Deferred**, none blocked:

- Points of projected geometry as positions (see "Needs from the preparatory step"); until then an own point with a `coincident` to the projected one follows it.
- `upTo` for a hole (2f): a floor at a set distance above a face.
- Holes on a face that is not planar, directions other than the normal of the sketch plane, modelled threads (the backlog defers them).
- A catalog of bearings and the use "bearing seat" (a counterbore with the outer diameter and the width of a bearing): one more catalog and one more branch of the query; nothing in scenario 12 needs it.
- A slot for a nut pushed in from the side, a teardrop or a flat-topped hole for a horizontal axis on a printer, a chamfer at the mouth of a counterbore.
- Per-point shapes: every point of one feature gets the same hole.

## Document

```ts
interface HoleFeature extends FeatureBase {
  type: 'hole';
  sketch: Id;
  points: Id[];
  shape: HoleShape;        // plain | counterbore | countersink | nutPocket, by `type`
  extent: HoleExtent;      // distance | throughAll (forward, backward)
  targets: Id[];
  label?: string;
}
```

- **`points`**: at least one; points of the sketch that are not projected geometry (its own points or `origin`); a point listed twice is an invalid command (as a target listed twice is). The order is kept as given and means nothing.
- **`shape`** is a variant by `type`, so `updateFeature` merges the same kind by field and replaces another kind whole (`mergePatch` decides by `type`). Every dimension is a numeric field `shape/<name>` and is required; none has a default. The fields, in the registry with `when: shape/type`: `diameter` (all kinds), `headDiameter` (counterbore, countersink), `headDepth` (counterbore, nut pocket), `angle` (countersink; the included angle, between 0 and π), `acrossFlats` and `rotation` (nut pocket).
- **`extent`**: the validator of `features/extent.ts` with the arguments "no taper", "no `upTo`", "no `both`". `distance` keeps its meaning: `start` moves the mouth off the sketch plane, `distance` is the depth of the whole hole and its sign the direction; for a sketch on a face the normal points out of the body, so a hole into it is negative, as an extruded cut is.
- **`targets`**: one or more bodies, none twice.
- **`label`**: an optional text, not empty, at most 200 characters. The engine stores it and never reads a number out of it. The parts list of 3e counts it: once per point and per copy of a pattern.
- **Updatable** by `updateFeature`: `sketch`, `points`, `shape`, `extent`, `targets`, `label` (`null` removes the label). References are verified as for every feature: only the ones the feature did not have.
- **References**: the sketch; every point as an entity of the sketch (`accepts: ['point']`, with the flag `notProjected` of 2a, which `requireRef` checks); every target as a body.
- **Registry**: `createsBody: false`, `namesFaces: true`, `producesTool: true`, `info.bodies: 'none'`.

Relations between the numbers (a head wider than its bore) are not checked by a command: a command is validated structurally, the numbers may be expressions, and the recompute has to check them anyway when a parameter changes.

## Recompute

The step, in `features/hole.ts`:

1. The sketch from the state; missing or not evaluated: `brokenReference`. The positions of the points from its solved geometry; a point that is gone: `brokenReference` with the point. The sketch needs no regions and no valid profile.
2. The shape is checked (`invalidHole` otherwise):
   - a head wider than the bore by more than `LENGTH_TOLERANCE`; for a nut pocket the bore has to fit between the flats;
   - for a countersink the depth of the cone, `(headDiameter − diameter) / 2 / tan(angle / 2)`;
   - no two points closer than the largest diameter of the hole (for a hexagon the circle through its corners) plus the tolerance: the holes of one tool must not overlap. `refs` name the two points.
3. A recipe `{ operation: 'cut', targets, build }`. `build` asks `toolSpan` for the span (so "through all" is measured per build and per copy, as for an extrusion), takes the depth of the hole from it ("The depth", below) and builds one stack per point:

   | Shape | Sections from the mouth | Faces |
   |---|---|---|
   | plain | a cylinder to the bottom | `holeBore` |
   | counterbore | a cylinder `headDiameter` for `headDepth`; a step; the bore | `holeHead`, `holeSeat`, `holeBore` |
   | countersink | a cone from `headDiameter` to `diameter`; the bore, sharing the ring | `holeHead`, `holeBore` |
   | nut pocket | a hexagon for `headDepth`; a step; the bore | six `holeFlat`, `holeSeat`, `holeBore` |

4. The stacks are put into one solid (their vertices and triangles one after another); the caps and the seat of all points get one face number each, the other faces one per point.
5. `applyTool`, and the same handling of its answer as an extruded cut has: the recipe is stored also when nothing changed; `noEffect` names the targets the tool missed; `emptyResult` and `kernelFailure` as there. The few lines that turn an `Applied` into the result of a feature are shared with the extrusion instead of copied.
6. `facts`: `headDepth` and `depth`, for the tool of the feature itself.

**The depth**, and the head against it. The depth of a hole is what the head is compared with, and it is not always the length of the tool:

- **`distance`**: the depth is `|distance|`, known in the step. A head as deep or deeper (within `LENGTH_TOLERANCE`) is `invalidHole`, the error of the step.
- **`throughAll`**: `toolSpan` of `recompute/extent.ts` answers, next to the span it answers today, the **reach**: how far the targets go from the sketch plane on the side asked for, without the overshoot (`high` or `−low` of its loop; zero when no vertex of a target lies on that side). The depth of the hole is the reach, and `build` decides:

  | Reach | What `build` does |
  |---|---|
  | not above `ε` | the targets do not pass the mouth. The tool is built, as long as its head and the overshoot; it lies wholly beyond the targets, so `applyTool` reports every target unchanged: the warning `noEffect`, and the recipe stays for a pattern |
  | above `ε`, and not above the depth of the head plus `ε` | `invalidHole`, thrown as a `ToolProblem` (2f): the error of the feature, or of the copy of a pattern |
  | above the depth of the head plus `ε` | the tool is the reach and the overshoot long; the overshoot only lengthens the bore |

  `ε` is the resolution of the solids, not `LENGTH_TOLERANCE`: `1e-5 · max(1, c)`, with `c` the largest coordinate of the targets and of the sketch plane, the number `toolSpan` computes its overshoot from. It is the scale `applyTool` uses already when it asks whether a face lies on the surface of a target. The reach is measured on float32 positions against a frame in doubles, so for a target that ends exactly in the sketch plane it is rounding noise and not zero: a review measured 1.5e-6 for a plate with its top at 33.4 and 3e-6 at 100.3, above the length tolerance of 1e-6, and with that tolerance a headed hole pointing away from such a plate would have been `invalidHole`. The noise is about 1e-7 of the coordinate, a hundred times below `ε`.

  The first version took the length of the span, overshoot included, for the depth. A review showed both ends of that: a head half a millimetre deeper than a plate passed (the overshoot is at least a millimetre), and a hole pointing away from its target got `invalidHole` from a head deeper than the overshoot, where the contract promises `noEffect`.
- **What is not detected.** The reach is that of the whole targets, not of the material under each point. The lid of scenario 12 is a plate with a lip around it: "through all" from its top reaches to the lower edge of the lip, so a head deeper than the plate and shallower than plate and lip passes, and leaves an opening as wide as the head with no seat in the body. The feature has no error; the face `holeSeat` is then in no body, and a sketch on it is a `brokenReference`. Finding it would need the material along the axis of every hole (a ray through the targets per point and per build); deferred, and the scenario keeps the plate thicker than the head (`calls.ts`, `socketHeadsInstead`).
- **What is not detected**, of the same kind: the reach is that of all targets of the feature together, so a head deeper than one thin target passes when another target reaches further.
- `facts.depth` is `|distance|` or the reach. The reach is a measure on float32 positions: it agrees with the model to about 1e-7 of its coordinates, not to the last digit of a double.

**The circles of a hole** all have one number of sides, by its largest radius (`segments` of `sketch.ts` with the chord tolerance), starting at the X axis of the sketch. The hexagon has six; its step to the bore is the hexagon with the circle as a hole, triangulated by the kernel. A step between two circles is triangulated the same way.

**Surfaces.** The bore and the head of a counterbore are cylinders about the normal through the point; the head of a countersink is a cone with the half angle `angle / 2`, its apex below the mouth and its axis pointing from the apex to the mouth; a flat is a plane (its `origin` the corner it starts at, in the sketch plane and not at the mouth: the rule of the side of an extrusion, whose origin does not move with `start`, so a sketch on a flat stays where it is when the mouth is moved; its `y` the normal of the sketch plane); the seat and the caps are planes like the caps of an extrusion (the origin and the Y axis of the sketch, at their level).

**Edges**, by the rule of 2b: the mouth of a countersink with the face it is cut into (a plane and a cone), its lower rim (the cone and the bore, one ring of one tool), both rims of a counterbore and its seat with the bore are circles and can be projected; the edges of a flat are lines.

**A pattern** builds the tool again in the frame of the copy; a nut pocket turns with it.

## Faces

| Role | Parts | What |
|---|---|---|
| `holeBore` | `point` | the bore at the point |
| `holeHead` | `point` | the cylinder of a counterbore or the cone of a countersink |
| `holeFlat` | `point`, `flat` | one side of the hexagon of a nut pocket; `flat` from 1, counter-clockwise from the corner `rotation` points to |
| `holeSeat` | none | the step between head and bore, for all points |
| `startCap`, `endCap` | none | the mouths and the bottoms, for all points (the roles of today) |

- **Named by meaning, not by a count.** The brief and the vocabulary suggest "a point and a step". A step number renames the bore when a plain hole (step 1) becomes a counterbore (bore: step 2), and every sketch on it and every projected rim breaks. With `holeBore` the bore keeps its name through every change of the shape (`calls.ts`, `socketHeadsInstead`). The role with two parts the vocabulary provides for is `holeFlat`.
- **The seat and the caps are one face per feature**, like the caps of an extrusion with several regions (architecture.md, "Stěny"): they lie in one plane, a sketch on one stands on all, and a point added later renames nothing.
- A flat is a plane and gets a name of its own, so a sketch can stand on it and its edges are lines; one face for the whole hexagon would have to be `swept`.

## The catalogs

`DataCatalog` of the preparatory step, five of them:

| Catalog | Columns | The numbers come from |
|---|---|---|
| `clearanceHoles` | `thread`, `fine`, `medium`, `coarse` | ISO 273, the three series of clearance holes |
| `socketHeadScrews` | `thread`, `headDiameter`, `headHeight` | ISO 4762, hexagon socket head cap screws |
| `countersunkScrews` | `thread`, `headDiameter`, `headAngle` | ISO 10642, hexagon socket countersunk head screws |
| `hexNuts` | `thread`, `acrossFlats`, `thickness` | ISO 4032, hexagon nuts |
| `heatSetInserts` | `thread`, `holeDiameter`, `holeDepth`, `length` | no standard: the data sheet of one named maker |

- **The columns are a proposal.** They are what a hole needs from each source, written without the sources at hand. Whether ISO 273 has exactly three series under these names, whether a countersunk head has one angle for every size (the column is per row so that it need not), and whether "the largest allowed" is how each standard states a head are confirmed when the texts are read; a column that does not match is changed then, with the branch of `hardwareHole` that reads it. The implementation of the catalogs starts with that reading.
- **One catalog per standard.** `DataCatalog.source` is one text per catalog, and a row has a value in every column. One catalog of screws with columns from three standards would need three sources and empty cells wherever a standard does not cover a size. (Rejected alternative 6.)
- **Rows** are keyed by the thread (`M3`). Every catalog holds the sizes its own source has, between M2 and M8 as a first range (a guess at what printed parts use), so the catalogs need not cover the same sizes. A size missing in one catalog is missing for the uses that read that catalog only, and the query says which catalog lacks it.
- **Largest allowed sizes for what has to fit in**: the head diameter, the head height and the size across flats are the upper limits of the standard, because a pocket has to take the largest part. The clearance holes are the values of the series.
- **Where the numbers are taken from.** The four standards are the ones the backlog names. Their texts are not in the repository and are sold by ISO; this session read none of them. The implementation types the numbers from the text of the standard (if the owner has it), or from a published table that reproduces it, and writes the document it used into `source` with its edition. The review of that commit compares every number with a second, independent table; a difference blocks the commit. A test then pins the rows and checks what can be checked without a source: every column grows with the thread, `fine < medium < coarse`, a head is wider than its thread, a nut wider than its thread.
- **Heat-set inserts** have no standard, and the hole a maker recommends differs between makers. The catalog holds one maker's data sheet, named in `source` together with the words "typical values; check the data sheet of your inserts". Which maker is a question for the owner.

## The query `hardwareHole`

The backlog asks for "a tool that composes the feature" from the catalog. It is a query of the registry of the preparatory step:

- **Arguments**: `use` (clearance, socketHead, countersunk, nutPocket, heatSetInsert), `size`, `fit` (the clearance series, medium when left out), `allowance` (an expression added to every diameter and to the size across flats).
- **Answer**: `shape` (in the input form of a hole shape: numbers, or expressions when an allowance was given), `label`, `depth` for an insert, `from` (the catalogs used).
- **The angle of a countersink is always an expression in degrees** (`deg(…)`, from the radians of the catalog). The tool `query` prints numbers rounded to six decimal places, and an AI passes on what it read: an angle of π/2, to take one whose decimals do not end, would arrive in the feature as 1.570796 and differ from the catalog. The expression survives, and the form shows the angle the standard prints. The lengths of the catalogs have few decimals and pass the rounding unchanged.
- **It looks at `use` first** and asks only the catalogs that use reads: an insert needs no row of `clearanceHoles`. (The first version asked for the clearance hole before anything else.)
- **What maps to what** is the judgement an AI must not be left to make from memory:

  | Use | Shape | From |
  |---|---|---|
  | clearance | plain: the clearance hole of the series | `clearanceHoles` |
  | socketHead | counterbore: the clearance hole; the head diameter; the head height as the depth | `clearanceHoles`, `socketHeadScrews` |
  | countersunk | countersink: the clearance hole; the head diameter; the head angle, as `deg(…)` | `clearanceHoles`, `countersunkScrews` |
  | nutPocket | nut pocket: the clearance hole; across flats; the thickness as the depth; rotation 0 | `clearanceHoles`, `hexNuts` |
  | heatSetInsert | plain: the hole diameter; `depth`: the hole depth | `heatSetInserts` |

- The head sizes are the largest the standards allow and nothing is added to them. Room for a tool or for the printer is the caller's `allowance`, an ordinary parameter (`holeComp`), so it is visible in the document and changes in one place.
- A size a catalog does not have is `notAvailable` with the argument `size`, thrown by `run` (the engine cannot check a text against a table before it).
- **Why a query.** It is reachable from MCP through the one tool `query` and from the app through the generic form of 1b with no code in either, and the hole form of the app calls the same entry. It reads no state, like `catalog`. A dedicated MCP tool would be the tool per operation that D33 decided against; a function exported next to the engine would have no MCP side at all (the gap the guard of D36 cannot see).

## Texts that name the extrusion

The preparatory step keeps five texts until "the first other type arrives" ([part2-feature-modules.md](../00-prep/part2-feature-modules.md)). This package rewords them:

| Text | Today | Becomes |
|---|---|---|
| error of a pattern source that is no tool | "is not an extrusion with the operation add or cut" | "is not a feature that applies a tool (an extrusion with the operation add or cut, a hole)" |
| `REF_LABEL.faceSource` | "extrude" | "a feature that names faces" |
| summary of the pattern in the registry | "a list of extrusions with the operation add or cut" | "a list of features that apply a tool: extrusions with the operation add or cut, holes" |
| comment of `PatternFeature` in `types.ts` | the same | the same |
| error of a generated reference | unchanged: a hole has no generator | |

The first is in `requireRef`, which the preparatory step moves to `features/index.ts`; the label is in `validation.ts`. The test that matches the first one (`pattern.test.ts` of the engine) is updated with it; no test matches the others.

## Where the code lives

| File | What 2c does there |
|---|---|
| `types.ts` | `HoleFeature`, `HoleShape`, members of `Feature`, `FeaturePatch`, `FaceName`, `ErrorCode`; the comments above are what the AI reads |
| `features/hole.ts` | new: the entry of the registry, the validator, the step |
| `features/index.ts` | one line of the registry; the reworded error of `requireRef` |
| `features/extent.ts` | the arguments that restrict an extent for a hole |
| `recompute/extent.ts` | `toolSpan` answers the reach of "through all" next to the span |
| `recompute/tool-stack.ts` | the step between sections of different outlines (specified by 2b) |
| `recompute/state.ts` | `ToolProblem`, if 2f has not added it (2f, "A build that fails with its own code") |
| `recompute/services.ts` | the handling of an `Applied` shared with the extrusion; the text of `invalidHole` |
| `validation.ts` | four entries of `FACE_ROLES`; the reworded label |
| `catalogs/hardware.ts` | new: the five tables and their entries of `DATA_CATALOGS` |
| `queries/hardware-hole.ts` | new: the entry of `QUERIES` |
| `packages/mcp/src/api.ts` | `CONVENTIONS`: how a hole is made (ask `hardwareHole`, put `shape` and `label` into the feature, the direction by the sign of `distance` or by `side`) |
| `packages/app` | below |

## The app and MCP

- **MCP** needs no code: the feature through `execute`, the catalogs through `catalog`, the preset through `query`, the default summary of a feature for `get_model`.
- **The app** gets an entry of its registry, `features/hole.ts`:
  - a button "Hole"; a new one opens with the latest sketch, a plain hole and "through all, backward";
  - the sketch from a list; its points as a list of checkboxes (the view picks sketch points only inside the sketch mode, part 3);
  - the kind from a list, and under it the numeric fields of that kind from `FEATURE_TYPE_INFO.hole.fields`, each taking a number or an expression; the angle and the rotation in degrees for a bare number;
  - the extent and the targets as the extrusion form has them for a cut;
  - the label;
  - a group "From the catalog": use, size (the keys of the catalogs), series, allowance, and a button that asks `hardwareHole` and writes the answer into the draft. The app composes nothing itself;
  - a selected hole highlights its faces (`ownsFace`), and its lines in the model panel show the label and the number of points.
- `ROLES` of the app gets four texts.

## Issue codes

| Code | Kind | When |
|---|---|---|
| `invalidHole` | error, new | the dimensions do not make a hole (step 2 and 3 of the recompute) |
| `brokenReference` | error | the sketch, a point or a target is missing |
| `emptyResult`, `kernelFailure` | error | as for a cut |
| `noEffect` | warning | as for a cut: the targets the holes missed |

## Shared vocabulary

- **Takes:** `FeatureTypes`, `FeaturePatches`, `FaceRoles` and `FACE_ROLES`, `IssueCodes`, `Catalogs` and `DataCatalog`, `Queries` and the query `catalog`, `Surface` (the cone), `producesTool` of the registry.
- **Adds:** the feature type `hole` and its patch; the roles `holeBore`, `holeHead`, `holeFlat`, `holeSeat`; the code `invalidHole`; the catalogs `clearanceHoles`, `socketHeadScrews`, `countersunkScrews`, `hexNuts`, `heatSetInserts`; the query `hardwareHole`.

## Rejected alternatives

1. **The feature stores the size (`M3`) and looks the numbers up at recompute.** A corrected catalog would change old models without a word (the backlog's reason).
2. **A sketch tool that draws circles and adds cuts.** One circle per position and two or three features per kind of hole; changing the screw touches all of them (the backlog's reason). The spike adds one: a countersink from two cuts leaves slivers where the two polygons of the lower rim meet.
3. **Face names with a point and a step number.** Above.
4. **A feature type per kind of hole.** Four registry entries, forms and summaries for one tool with four section lists; changing the kind would be removing and adding a feature.
5. **Positions as coordinates in the feature.** They could not be constrained, dimensioned or projected; sketch points can.
6. **One catalog `hardware`.** Above.
7. **A boolean per point.** n booleans instead of one on a body that keeps growing.
8. **`throughAll` to both sides.** No start, so no place for the head; a plain hole to both sides is an extruded cut.
9. **Circles of the sketch as positions.** They invite reading the diameter from the sketch, and then the hole has two sources for one number.
10. **A dedicated MCP tool, or a plain exported function, for the preset.** Above.
11. **Checking the relations of the numbers in the command.** Above ("Document").

## Open questions

- **For the owner: the source of the numbers.** Does the owner have the four standards, or is a named published table acceptable as the source (with the second table for the review)? The design does not pick one.
- **For the owner: which heat-set inserts.** One maker's data sheet has to be chosen; the hole diameters differ.
- **For the owner: bearings.** The backlog lists "common bearing sizes" among the catalog content. They are deferred here; say if a link needs them before step 3.
- Whether the series of clearance holes are the right choices for printed parts, where the allowance does most of the work. Kept as the proposal, to be confirmed against the standard with the other columns.
- The sizes: M2 to M8 is a guess at what printed parts use.
- A head through a thin part of a body that reaches deeper elsewhere is not detected with "through all" ("The depth"). Whether the ray per point is worth its cost is left to the first model that trips over it.

## Needs from the preparatory step

- **Part 4, roles of faces: a part that holds the ID of a derived point.** A hole at the centre of a projected circle would be named `{ role: 'holeBore', point: 'rim/center' }`: the ID of a point of projected geometry contains a slash, and the key of a face separates its parts by slashes. The contract says a part is "a text (an ID)" and does not say whether such an ID is one. Case: the inserts of scenario 12 sit at the centres of the posts; projecting the rim of a post gives that centre as a point, and the hole could use it. Until it is decided the hole takes own points and `origin` only, and the scenario repeats the expressions of the posts. Proposed: the validator of a text part accepts any ID the sketch can have, derived ones included; the key stays unambiguous because a derived ID has exactly one slash and the parts of a role are known.
- **Part 2: the two functions added to the index of the engine have no declaration.** `producesTool` and `generatorOf` are named in the design of part 2 and not in `contract.ts`, so a scenario that asserts "a hole is a source of a pattern" by `producesTool` uses a stand-in (`calls.ts`, `insertChecks`). The behaviour is asserted without it as well (the pattern is added and evaluates).

## For the plan

- **Dependencies.** The table of packages says "plain and counterbored holes need only 00". In this design every kind is built by the stack of 2b, the extent is the service 2a makes of it, the points use the flag `notProjected` of 2a, and one refusal uses `ToolProblem` of 2f (a dozen lines, which 2c adds itself if it is implemented first). So 2c needs 2a and 2b as a whole.
- **Shared places.** `features/index.ts` (the registry line and the text of `requireRef`), `recompute/extent.ts` (`toolSpan`, which 2f changes as well: both add a member to its answer), `recompute/state.ts` and `recompute/services.ts` have no row in the plan's map of shared places (2a, "For the plan").
- **Scenario 12** is written across the four `calls.ts`; its order (2a, 2f, 2b, 2c) is in `scenario12` of this package.

## Tests the implementation owes

- Engine: each kind at one point and at several; the volumes against the formulas; the surfaces; the kinds of the edges and the projection of both rims of a countersink and of a counterbore; a sketch on a seat and on a flat, and a flat's origin with a `start` that is not zero; the names after a change of the kind and after a point is added; every refusal; "through all" with a head half a millimetre deeper than a plate (refused although the overshoot is longer), away from the target (`noEffect`, and a pattern of it that hits; with the mouth at a height float32 does not hold exactly, such as 33.4, and on a body turned by a pattern, where the reach is noise and not zero), and through the plate of a body with a deeper rim (the case that is not detected, pinned as it behaves); a pattern of a hole and of a hole with a pocket in one list; the patch of every field; `label`.
- The catalogs: the pinned rows and the checks above. The query: every use, a size missing in one catalog and present in another, the allowance as an expression that the feature then accepts, the angle through the tool `query` and back into a feature.
- MCP: the fixture of the query in the table of the guard.
- Scenario 12, from `calls.ts` of the four packages. No assertion of it depends on a number of a standard: where a head has to fit into the plate of the lid, the scenario sets the thickness of the plate from the row of the catalog (`screwHoles`, `socketHeadsInstead`).

## Reviews

### Round 1 (2026-11-15): the four designs of track B together, at `0839139`

The reviewers and the brief are in the record of [2a](../2a-offset/design.md) ("Reviews"). The findings on this package, each checked before it was acted on:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The depth of a hole "through all" was the length of the span, overshoot included: a head deeper than a plate by less than the overshoot passes, and a hole that points away from its target is `invalidHole` instead of `noEffect` | codex, major; internal, major | Yes (`toolSpan` adds `max(1, 1 %)` and returns the overshoot alone when no target lies on that side) | "The depth": `toolSpan` answers the reach; three cases in `build`; `facts.depth` is the reach. What stays undetected (a head through a thin part of a deeper body) is stated |
| In `socketHeadsInstead` the seat is asserted in a lid whose plate may be no thicker than the head is deep; nothing refuses it, because the lid reaches deeper at its lip | internal, major | Yes (the reach of the lid is the plate and the lip) | The preview sets the plate from the head depth of the preset; the limit is in "The depth" and in the open questions |
| Numbers that read as dimensions of screws: `"3.4 + holeComp"` in a comment, the size `M7` assumed missing, bare diameters in the calls that must not compile; the columns of the catalogs (three series, one angle, largest sizes) are stated as facts of standards nobody read | codex, major; internal, minor | Yes for all four. None is asserted as a value of a part, but the brief asks that nothing looks like one | The comment is generic; the unknown key is `nope`; the bare diameters are made up and say so; the narrow head of `refusals` no longer depends on a catalog value; the columns are a proposal to confirm at the first reading of the standards. "Rows" contradicted itself about which sizes and is rewritten |
| The example entry of `hardwareHole` asked for the clearance hole before looking at the use, so an insert needed a row it does not read | codex, minor | Yes | The use first; the entry now has all five uses |
| The tool `query` rounds numbers to six decimal places, so the angle an AI passes on is not the angle of the catalog, and `screwChecks` compared them exactly | internal, major | Yes (`round` of `tools.ts`; the contract of the preparatory step keeps it for `query`) | The angle comes back as `deg(…)`; the check compares within a tolerance and looks for the expression |
| The origin of a flat was put at the mouth; the side of an extrusion keeps it in the sketch plane | internal, major (with 2b) | Yes (2b, "Reviews") | In the sketch plane |
| The calls that must not compile failed against a local type of the scenario, not against the contract | internal, minor | Yes | The helper takes `Input<HoleShape>` and `Input<HoleExtent>`; all four still fail |
| The design did not say that it needs 2a and one class of 2f; the plan's note was filed under needs of the preparatory step; the reworded error is in `requireRef`, which moves to `features/index.ts` | internal, minor | Yes | The first paragraph, "For the plan", the table of files |
| Names: the flag `own` (2a renamed it `notProjected`); `holeWall` next to the roles `wallSide` and `wallEnd` of 2a reads as a wall; face names compared by `JSON.stringify` | internal, minor | Yes | `notProjected`; the role is `holeBore`; `sameName` of 2a |

Checked by the reviewers and found sound: the roles are unique per face, and the seat and the caps are planar groups; a hole needs no upgrade step (a build without the package refuses the type); the formulas of the cone of a countersink; the frame of the sketch on the top of the lid (probe of the engine of today). The internal reviewer's probe of a counterbore as deep as the plate of the lid is the source of the second row.

Not acted on:

- Detecting a head that passes through a thin part of a deeper body (raised by the fix, not by a reviewer): stated as a limit, with the test that pins it.

### Round 2 (2026-11-15), narrow: the fixes of round 1, at `83c8405`

The reviewers are in the record of [2a](../2a-offset/design.md). The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The three cases of "through all" compare the reach with `LENGTH_TOLERANCE`, but the reach is measured on float32 positions: for a plate whose top is the sketch plane it is 1.5e-6 at a height of 33.4 and 3e-6 at 100.3, and 1.3e-6 on a body turned by a pattern. A headed hole pointing away from its target is then `invalidHole` again; the scenario passed only because 33 is held exactly | internal, major (probe of the engine) | Yes (`toolSpan` subtracts a frame in doubles from float32 positions) | The cases are decided at the resolution of the solids, `1e-5 · max(1, c)`, the scale of `applyTool`; `facts.depth` is said to be a float32 measure and `screwChecks` compares it within 1e-4; the owed test names a height that is not held exactly and a turned body |
| `screwChecks` asserts that the cone of the countersunk screw is shallower than the plate of the lid, a fixed 3 mm: an assertion on a number of a standard nobody has read. The comment admitted it; the scenario would still fail on valid catalog data | codex, major; internal, as the one flagged assertion | Yes | `screwHoles` sets `lidT` from the row of the catalog: the cone of the head down to its point, which is deeper than any countersink for it, and a millimetre, never less than the 3 mm the earlier parts were built with |
| The right angle of a countersunk head is written as an example in three places | internal, flag | Yes: never asserted, but it reads as a value of a standard beside the sentence that none is written | The three places speak of a cone or of π/2 as arithmetic, not of a head |

Found holding by both: a tool that only touches its targets comes back unchanged (run by both through the real kernel; the internal reviewer with a countersink, a plain tool and a hexagon, the mouth flush on a plate and also over its edge, at three heights: no face of the tool in the result and no change of volume); the use is looked at first; `deg(…)` survives the expression language, `Input<HoleShape>` and a patch, and another kind replaces the shape and drops its expressions; `holeWall` and `own` remain only in this record; the scenario from its first call to its last (no ID twice, every face exists, the numbers follow from the parameters, no preview reads a state it does not have).

Not checked by either: whether each of the four calls that must not compile fails for the reason it names (the internal reviewer's type probe was refused by the guard of the worktree; the contracts as a whole type-check, and an unused `@ts-expect-error` is an error of the compiler). The columns of the catalogs against any standard.

Not acted on: nothing.

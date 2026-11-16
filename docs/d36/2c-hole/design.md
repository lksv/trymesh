# 2c Hole feature and the hardware catalogs (D46)

**State: implemented on the branch `d36/2c` (2026-11-16); see "As implemented" for where the code differs from this design.** The design below is its fourth version, after three rounds of reviews, the last allowed ("Reviews"; what is still open is listed there as known limits). Written against the sixth version of the contract of the preparatory step and the code at `0dc424b`. It needs [2a](../2a-offset/design.md) (the extent as a service, the flag `notProjected` on a reference, the tool builds as modules) and [2b](../2b-taper/design.md) (the stack of sections, the cone, circles between surfaces). The tools of this package (a countersink, a counterbore with its step, a hexagon pocket with its step, four holes in one tool) were run through the real kernel adapter in the spike of 2b ("What was tried"); nothing else was run. **No dimension of a screw, a nut or an insert is written in these files: none was looked up, and none may come from memory.** The columns of the catalogs are a proposal for the same reason ("The catalogs").

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
- **`throughAll`**: `toolSpan` of `recompute/extent.ts` answers, next to the span it answers today, the **reach**: how far the targets go from the sketch plane on the side asked for, without the overshoot (`high` or `−low` of its loop; zero when no vertex of a target lies on that side). The depth of the hole is the reach. A plain hole has no head to compare with it: its tool is the reach and the overshoot long, the tool of an extruded cut. For a shape with a head `build` decides between two cases:

  | Reach | What `build` does |
  |---|---|
  | above the depth of the head by more than `δ` | the tool is the reach and the overshoot long; the overshoot only lengthens the bore |
  | anything less | the head is as deep as the targets reach, or the targets do not pass the mouth at all. The tool is built as long as its head and the overshoot, and marked: **it must not change a target** (`refuseChange: 'invalidHole'` on the built tool). `applyTool` applies it like any tool and then looks at the mark. Every target unchanged: the feature has the warning `noEffect`, as a cut that misses, and the recipe stays for a pattern. A target changed: `invalidHole`, the error of the feature or of the copy of a pattern, and no body is changed |

  `δ` is `1e-4 · max(1, c)`, with `c` the largest coordinate of the targets and of the sketch plane, the number `toolSpan` computes its overshoot from: the resolution of the kernel adapter as the comment above `toolSpan` gives it. Nearer than that, the adapter takes the seat of the hole and the far face of the target for one plane (a review cut a counterbore into a plate thicker than the head by 1e-5 of the coordinates: the result had the head and neither seat nor bore, with no error).

  Why the second case is decided by what the cut did and not by the size of the reach. The reach is measured on the meshes of the targets: float32 positions, with the rounding of every transform they went through, against a frame in doubles. For a target that ends exactly in the sketch plane it is noise and not zero (1.5e-6 for a plate with its top at 33.4, 3e-6 at 100.3; 0.003 for a body turned by a pattern from coordinates of 1e5 to near the origin). And a real target can be thinner than any threshold that is safe against that noise (a plate 0.005 thick under a sketch whose origin is 1000 away). The two overlap, so no number tells "does not pass the mouth" from "passes it by a little". The kernel can: a tool that only touches comes back with every target unchanged, a tool that cuts does not. (The second version compared the reach with `LENGTH_TOLERANCE`, the third with `1e-5 · max(1, c)`; the reviews of each built the cases above.)

  What follows the mesh. Where the mesh of a target passes the sketch plane by its own rounding, or by a tilted face, the tool cuts that sliver: a headed hole is then `invalidHole` and a plain hole removes the sliver, as an extruded cut "through all" from that plane does today. The design does not hide a disagreement between a mesh and the plane its face is described by.

  The first version took the length of the span, overshoot included, for the depth. A review showed both ends of that: a head half a millimetre deeper than a plate passed (the overshoot is at least a millimetre), and a hole pointing away from its target got `invalidHole` from a head deeper than the overshoot, where the contract promises `noEffect`.
- **What is not detected.** The reach is that of the whole targets, not of the material under each point. The lid of scenario 12 is a plate with a lip around it: "through all" from its top reaches to the lower edge of the lip, so a head deeper than the plate and shallower than plate and lip passes, and leaves an opening as wide as the head with no seat in the body. The feature has no error; the face `holeSeat` is then in no body, and a sketch on it is a `brokenReference`. Finding it would need the material along the axis of every hole (a ray through the targets per point and per build); deferred, and the scenario keeps the plate thicker than the head (`calls.ts`, `socketHeadsInstead`).
- **What is not detected**, of the same kind: the reach is that of all targets of the feature together, so a head deeper than one thin target passes when another target reaches further.
- `facts.depth` is `|distance|` or the reach. The reach is a measure on the meshes: it carries the rounding of float32 and of every transform the targets went through (about 3e-8 of the coordinates for bodies built where they are; more for a body that a pattern brought from far away).

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
- **Rows** are keyed by the thread (`M3`). Every catalog holds the sizes its own source has, between M2 and M4 (the owner's range, 2026-11-15; the first version guessed M2 to M8), so the catalogs need not cover the same sizes. A size missing in one catalog is missing for the uses that read that catalog only, and the query says which catalog lacks it.
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
| `recompute/state.ts` | the optional mark `refuseChange` on the built tool |
| `recompute/services.ts` | `applyTool` reads the mark after its booleans; the handling of an `Applied` shared with the extrusion; the text of `invalidHole` |
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

- **The source of the numbers: decided by the owner on 2026-11-15.** A named published table is the source of each catalog, with a second, independent table for the check in the review; `source` of the catalog names it.
- **Which heat-set inserts: decided by the owner on 2026-11-15.** He has no fixed maker (unbranded inserts), so the catalog cannot be the data sheet of one maker, which this design assumed. The catalog has a row per size as sold (thread, outer diameter, length) instead of per thread, with the values of the hole from the owner (his measurements and the holes that worked in his prints); `source` says that they are typical values for unbranded inserts and that a hole should be tried in a test print. The hole of a feature is stored as numbers and the allowance is a parameter of the document, so the value of the catalog is a start the user corrects in one place.
  - The alternatives put to the owner: this one (chosen); the data sheet of one branded maker as "typical values" (rejected: his inserts have other diameters and lengths, and the catalog would look more reliable than it is); no catalog of inserts at all (rejected: an AI then has nowhere to take the size from, which is what the catalog is for).
  - What follows for the design: the key of a row of `heatSetInserts` is not the thread alone, unlike the other catalogs, so a caller lists the keys first (the query `catalog`); the column `length` stays, and the outer diameter becomes a column.
  - The sizes he buys run, in his words, "from M3x3x4.5 to M4x3x6". **Answered by the owner on 2026-11-16**, before any number was typed:
    1. Which number is the length and which the outer diameter: he does not know ("look it up, this is probably a standard notation"). Looked up: unbranded listings name an insert thread × length × outer diameter (several say so outright, one with a dimensioned drawing; the other order would give "M3x3x4.5" an outer diameter of 3, no larger than its thread). "M3x3x4.5" is M3, 3 long, 4.5 across. The branded "Voron" insert M3x5x4 is the exception.
    2. The full list of sizes: he has none ("put about 20 random ones from the interval into the list"). The catalog has the 20 sizes found on sale between his two ends: 11 of M3 (outer diameter 4.5 and 5) and 9 of M4 (5, 5.5 and 6).
    3. The hole: he does not know ("try to look up how it is recommended"). Published recommendations: a straight hole, its diameter the outer diameter less 0.3 mm (ME Design Lab, University of Wisconsin–Madison; inside the range of Sovol, 0 to 0.1 mm above the table of 3D Printer Gear) and its depth the length and 1 mm (CNC Kitchen; the same at 3D Printer Gear, Sovol, 3dprintcalcs), applied to every size. `source` says that these are typical values for unbranded inserts to try in a test print.
  - **Open for the owner**: "M4x3x6" (M4, 3 long, 6 across) was not found on sale anywhere; M4 with an outer diameter of 6 starts at a length of 4, and the one M4 of length 3 is M4x3x5. His M4 insert is to be measured: probably M4x4x6 or M4x3x5, both in the catalog.
  - No second source was found for the hole of M4 inserts with an outer diameter of 5 and 5.5 (only the general rule applies).
  - A test plate with a row of holes stepped by a tenth of a millimetre can be built with the hole feature once it exists, to settle the values.
- **Bearings: decided by the owner on 2026-11-15.** Deferred to step 3, until a link needs them.
- Whether the series of clearance holes are the right choices for printed parts, where the allowance does most of the work. Kept as the proposal, to be confirmed against the standard with the other columns.
- **The sizes: decided by the owner on 2026-11-15.** The catalogs cover the threads M2 to M4 (the design guessed M2 to M8).
- A head through a thin part of a body that reaches deeper elsewhere is not detected with "through all" ("The depth"). Whether the ray per point is worth its cost is left to the first model that trips over it.

## Needs from the preparatory step

- **Part 4, roles of faces: a part that holds the ID of a derived point.** A hole at the centre of a projected circle would be named `{ role: 'holeBore', point: 'rim/center' }`: the ID of a point of projected geometry contains a slash, and the key of a face separates its parts by slashes. The contract says a part is "a text (an ID)" and does not say whether such an ID is one. Case: the inserts of scenario 12 sit at the centres of the posts; projecting the rim of a post gives that centre as a point, and the hole could use it. Until it is decided the hole takes own points and `origin` only, and the scenario repeats the expressions of the posts. Proposed: the validator of a text part accepts any ID the sketch can have, derived ones included; the key stays unambiguous because a derived ID has exactly one slash and the parts of a role are known.
- **Part 2: the two functions added to the index of the engine have no declaration.** `producesTool` and `generatorOf` are named in the design of part 2 and not in `contract.ts`, so a scenario that asserts "a hole is a source of a pattern" by `producesTool` uses a stand-in (`calls.ts`, `insertChecks`). The behaviour is asserted without it as well (the pattern is added and evaluates).

## For the plan

- **Dependencies.** The table of packages says "plain and counterbored holes need only 00". In this design every kind is built by the stack of 2b, the extent is the service 2a makes of it, the points use the flag `notProjected` of 2a. So 2c needs 2a and 2b as a whole. It needs nothing of 2f.
- **Shared places.** `features/index.ts` (the registry line and the text of `requireRef`), `recompute/extent.ts` (`toolSpan`, which 2f changes as well: both add a member to its answer), `recompute/state.ts` and `recompute/services.ts` have no row in the plan's map of shared places (2a, "For the plan"). In the last two this package adds a mark on the built tool that `applyTool` reads after its booleans; the pattern of 2e calls `applyTool` and gets the refusal of a copy without a change of its own.
- **Scenario 12** is written across the four `calls.ts`; its order (2a, 2f, 2b, 2c) is in `scenario12` of this package.

## Tests the implementation owes

- Engine: each kind at one point and at several; the volumes against the formulas; the surfaces; the kinds of the edges and the projection of both rims of a countersink and of a counterbore; a sketch on a seat and on a flat, and a flat's origin with a `start` that is not zero; the names after a change of the kind and after a point is added; every refusal; "through all" with a head half a millimetre deeper than a plate (refused although the overshoot is longer), with a plate thicker than the head by less than `δ` (refused; the review's counterbore without a seat) and by twice `δ` (built, with its seat and its bore), with a plate 0.005 thick under a sketch whose origin is 1000 away (refused, not cut), away from the target (`noEffect`, and a pattern of it that hits; with the mouth at a height float32 does not hold exactly, such as 33.4, and on a body turned by a pattern, where the reach is noise and not zero), from a plane that a tilted face of the target passes by a hair (a headed hole refused, a plain hole cuts the sliver; pinned as it behaves), and through the plate of a body with a deeper rim (the case that is not detected, pinned as it behaves); a pattern of a hole and of a hole with a pocket in one list; the patch of every field; `label`.
- The catalogs: the pinned rows and the checks above. The query: every use, a size missing in one catalog and present in another, the allowance as an expression that the feature then accepts, the angle through the tool `query` and back into a feature.
- MCP: the fixture of the query in the table of the guard.
- Scenario 12, from `calls.ts` of the four packages. Where the depth of a head has to fit into the plate of the lid, the scenario sets the thickness of the plate from the row of the catalog (`screwHoles`, `socketHeadsInstead`, `nutPockets`), so no assertion depends on the depth of a head. Two assumptions about the widths of the parts remain, and are checked against the rows when the catalogs are typed in; if one fails, a parameter of the box changes, not an assertion:
  - the hole of the insert, with its allowance, is narrower than a post (`postR` is 4, so 8 mm) by enough wall to leave the bore in it (`insertChecks` counts the bores);
  - the heads of the screws and the pocket of the nut, with the allowance, fit into the top of the lid around their points, which are `INSET` (8.7 mm) from its edges (`screwChecks` counts the rims of the cones).

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

### Round 3 (2026-11-15), the last: the diff of the fixes of round 2, at `e4056d1`

The reviewers and the rule of three rounds are in the record of [2a](../2a-offset/design.md). The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| A reach below `ε` can be real material: a plate 0.005 thick under a sketch whose origin is 1000 away has `ε` = 0.01, so the first case built a counterbore with a head 1 deep, and it cut the plate (volume 0.0200 to 0.0190, a face of the head in the result) with no error | codex, major (run through the real kernel and `applyTool`) | Yes | The rule of three cases is gone. See below |
| The noise of the reach is not bounded by the coordinates the targets have now: a plate built at 1e5 and turned by a pattern to near the origin has a reach of 0.0028 where it should be zero, 141 times `ε`. "A hundred times below `ε`" and "exact to about 1e-7 of its coordinates" were false | codex, factual (run) | Yes (`transformSolid` starts from rounded positions) | The same; both sentences are replaced |
| Just above the head plus `ε` a hole with a seat is built and loses it: the kernel adapter takes two parallel faces for one within about 2 to 3.5 `ε`. A counterbore in a plate thicker than its head by 1.01 `ε` comes out as the head alone, without seat or bore, with no error; a nut pocket the same up to 1.5 `ε`; a countersink is right | internal, factual (run, real adapter) | Yes (`tolerances` of the adapter) | The bore has to be left more than `δ = 1e-4 · max(1, c)` of the reach, the resolution the comment above `toolSpan` gives |
| "The tool lies wholly beyond the targets, so `applyTool` reports them unchanged" holds for a flat face at the mouth, not for a tilted face that passes the plane by less than `ε` at one edge: a sliver is cut in 8 of 8 runs | internal, factual (run) | Yes | The same as the first row: nothing is promised from the size of the reach |
| "No assertion of the scenario depends on a number of a standard" is too wide: the depth of the heads no longer matters, but the bores of the inserts need a hole narrower than a post, and the rims of the screws need heads that fit the lid around their points | codex, factual (read) | Yes | The sentence says what was removed and lists the two assumptions that stay, in the design and beside the two checks |

**What replaced the three cases.** The first two findings pull in opposite directions (codex: "merely increasing the multiplier worsens finding 1"), so no threshold on the reach separates "the targets do not pass the mouth" from "they pass it by a little". The design now has two cases and asks the kernel in the second: a tool whose head is as deep as the reach (within `δ`) is built with a mark that it must not change a target, and `applyTool` turns a change into `invalidHole` and no change into `noEffect` ("The depth"). The class `ToolProblem` of 2f is no longer used here. This is the direction codex named ("establish that the tool misses before accepting a headed cut"); the mechanism itself was written after the last round.

Found holding: the noise of the reach for bodies built where they are (at most 3e-8 of the coordinate over 30 placements, run by the internal reviewer); a tool with its mouth flush on a flat face, or a real 0.5 to 0.99 `ε` short of it, comes back unchanged (16 runs); the scenario from its first call to its last after `lidT` is set from the catalog (nothing built before it breaks; read by both); no dimension that looks remembered.

Still open, as known limits:

- **The mark `refuseChange` and the two cases were read by no reviewer and run by nobody.** The pieces were run separately in the rounds (a tool that only touches is unchanged; a tool that cuts is not); the rule as a whole is first tested with the implementation, by the tests listed above.
- **A mesh that disagrees with the plane of its face.** Where a target passes the sketch plane by its own rounding (a body a pattern brought from far away) or by a tilted face, a headed hole "through all" away from it is `invalidHole` and a plain one cuts a sliver. An extruded cut does the same today; the design does not correct it.
- **A blind hole (`distance`) whose bore is shorter than `δ`** was not probed. It is compared with `LENGTH_TOLERANCE` in the step; the adapter may merge its seat and its bottom as it did for the far face of a plate. If it does, the same `δ` belongs there.
- A head through a thin part of a deeper body, and through one thin target of several: stated in "The depth" since round 1.
- The two assumptions of the scenario about widths, above; the columns of the catalogs against any standard.

## As implemented

### The engine, the app and the tests (2026-11-16)

The feature type in `features/hole.ts` with its line in the registry, the four roles and `invalidHole`, the sections and the planar step in `buildStack`, `throughAll` in `recompute/extent.ts`, the mark `refuseChange` and `toolResult` in `recompute/services.ts`, the five catalogs in `catalogs/hardware.ts`, the query in `query/hardware-hole.ts`, the paragraph of `CONVENTIONS`, the form of the app (`packages/app/src/features/hole.ts`). The rules as implemented are in [architecture/hole.md](../../architecture/hole.md), the form in [ui/hole.md](../../ui/hole.md), the tests in [architecture/verification.md](../../architecture/verification.md), "The hole".

Where the code differs from the design above:

- **`toolSpan` keeps its answer.** The reach comes from a new function beside it, `throughAll(side, frame, targets)`, which answers the span, the reach, the scale `c` and the overshoot; `toolSpan` returns its span. The extrusion is unchanged.
- **The mark carries its detail**: `refuseChange: { code: 'invalidHole', detail }`, so the error says how deep the head is and how far the targets reach; `refs` are the targets that the tool changed.
- **`buildStack` takes a list of sections**, each with an optional `step` (the name of the planar face before it); two sections that meet in the same outline share the ring (compared by level and coordinates), a step pairs region by region without holes, the wider outline outside. The caps stay `startCap` and `endCap`; the steps are faces after the caps, before the sides. A second cache, for the triangulations of the steps, is an optional last argument. One region per point in every ring, so all points are one stack and one solid.
- **Points**: the recompute takes an own point of the sketch or `origin` and reports anything else, also a projected point a loaded document may have, as `brokenReference`. The command refuses a projected point by `notProjected`.
- **The key of a flat** lists its parts alphabetically, as every key does: `H/holeFlat/2/p1`. The sentence and the test that need 13 of the cross-review asks for are in `face-roles.ts` and `face-roles.test.ts`.
- **Texts that name the extrusion**: the design said no test matches the reworded label and summary; `review.test.ts` matched the label of a face source (`není extrude`) and the error of a pattern source, and is updated with them, as are the orders of the registry it pins. The comment of `RefKind` in `validation.ts`, the summary of the pattern and the pattern paragraph of `CONVENTIONS` are reworded as well.
- **`catalogTable`** takes the map of catalogs as an object: a catalog whose row type is an interface was not assignable to `DataCatalog<never>` as the preparatory step typed it.
- **The query** checks the syntax of the allowance (`invalidArguments`), trims it, and names in `notAvailable` the catalog and the sizes it has. `from` is typed by the names of the catalogs.
- **The columns.** The four standards have the columns the design proposed: ISO 273 has exactly three series named fine, medium and coarse; ISO 10642 gives one angle (90°, with a tolerance to 92°), kept per row. The head diameter of ISO 4762 has two maxima, for a plain and for a knurled head; the larger (knurled) is the one, by the rule "the largest allowed". The countersunk head is the theoretical maximum (the sharp cone at the bearing face). The inserts have the columns of the owner's decision of 2026-11-15: `thread`, `outerDiameter`, `length`, `holeDiameter`, `holeDepth`, keyed by the size as sold.
- **The sizes**: M2, M2.5, M3 and M4 everywhere, M3.5 in ISO 273 and ISO 4032, which list it, and not in ISO 4762 and ISO 10642, which do not. The primary and the check source of every catalog are in [architecture/hole.md](../../architecture/hole.md), "The hardware catalogs", and in `source`.
- **The app**: a new hole starts as a plain hole of 3 mm through all backward with no point ticked (OK is disabled until one is); another kind keeps the diameter and leaves the fields it never had empty for the preview to ask for; the size of the catalog group is a select of the keys; *Fill from the catalog* writes for an insert a distance of its depth into the body (`distance: −depth`).
- **Scenario 12** follows `calls.ts` in `packages/scenarios/test/scenario12.test.ts` and `box.ts`, on the model of 2a, 2b and 2f together; the size of the insert is the first M3 row of the catalog (the key of an insert is no longer the thread). The two assumptions about widths hold and are asserted: the countersunk head of M3 with the allowance (radius 3.46) inside the 8.7 of `INSET`, the hole of the insert with the allowance (4.4) narrower than a post (8).
- **Tests the design asked for that are elsewhere**: the volumes, surfaces, edges, sketches on a seat and a flat, the names, every refusal of the recompute and every case of "through all" are in `packages/scenarios/test/hole.test.ts` against the real adapters (they need booleans); the document, the patches and the stack with a step in `packages/engine/test/hole.test.ts`; the catalogs and the query in `packages/engine/test/hardware.test.ts`; the angle through the tool `query` back into a feature in `packages/mcp/test/queries.test.ts`.

Found by the tests and recorded as behaviour: every case of the third round of reviews holds as designed, run through the real adapter (a head half a millimetre deeper than the plate refused, a plate thicker than the head by half the resolution refused and by twice it built with seat and bore, the thin plate 1000 away refused and not cut, holes pointing away at a height of 33.4 and on a turned copy `noEffect`, a pattern that turns such a hole into the plate cutting it, the sliver of a tilted face cut by a plain hole and refused for a headed one, the plate on a deeper rim not detected).

Known limits, besides those of the design: see [architecture/hole.md](../../architecture/hole.md), "Limits".

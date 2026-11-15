# 2c Hole feature and the hardware catalogs (D46)

**State: design, first version, before the reviews.** Written against the sixth version of the contract of the preparatory step and the code at `0dc424b`, on top of [2a](../2a-offset/design.md) (the extent as a service) and [2b](../2b-taper/design.md) (the stack of sections, the cone, circles between surfaces). The tools of this package (a countersink, a counterbore with its step, a hexagon pocket with its step, four holes in one tool) were run through the real kernel adapter in the spike of 2b ("What was tried"); nothing else was run. **No dimension of a screw, a nut or an insert is written in these files: none was looked up, and none may come from memory.**

Files: [contract.ts](contract.ts) (the feature, its patch, the face roles, the issue code, the catalogs' columns, the query), [calls.ts](calls.ts) (its part of validation scenario 12, and the whole scenario in its order).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Hole feature with a hardware catalog": a feature type `hole` with a sketch, a list of its points, a description by kind, an extent and targets like a cut; a tool recipe, so a pattern repeats it; the catalog fills the fields and the document stores numbers and a free-text label; values from the standards; open: the names of the faces with several points.

| Statement | What the code says |
|---|---|
| "A feature type in the registry" | After the preparatory step: a module `features/hole.ts` with its entry and its step, a line in the registry, the interface and two union members in `types.ts`. A build without it refuses the document, so no upgrade step |
| "It stores a tool recipe, so a pattern repeats it like any cut" | `ToolRecipe` (`evaluate.ts`) is the operation, the targets and `build`; `applyTool` and the pattern know nothing else. But `requireRef` (`document.ts`) accepts as a source of a pattern only "an extrusion with the operation add or cut", by name; the preparatory step turns that into `producesTool` of the registry. Five texts name the extrusion and are reworded by the first other type, which is this one (below) |
| "An extent and targets like a cut" | The extent of a cut is `distance` with a sign or `throughAll` with a side. Both give a hole its direction without a field of its own. `throughAll` with `both` has no start, so a hole with a head cannot use it |
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

- **`points`**: at least one; own points of the sketch or `origin`; a point listed twice is an invalid command (as a target listed twice is). The order is kept as given and means nothing.
- **`shape`** is a variant by `type`, so `updateFeature` merges the same kind by field and replaces another kind whole (`mergePatch` decides by `type`). Every dimension is a numeric field `shape/<name>` and is required; none has a default. The fields, in the registry with `when: shape/type`: `diameter` (all kinds), `headDiameter` (counterbore, countersink), `headDepth` (counterbore, nut pocket), `angle` (countersink; the included angle, between 0 and π), `acrossFlats` and `rotation` (nut pocket).
- **`extent`**: the validator of `features/extent.ts` with the arguments "no taper", "no `upTo`", "no `both`". `distance` keeps its meaning: `start` moves the mouth off the sketch plane, `distance` is the depth of the whole hole and its sign the direction; for a sketch on a face the normal points out of the body, so a hole into it is negative, as an extruded cut is.
- **`targets`**: one or more bodies, none twice.
- **`label`**: an optional text, not empty, at most 200 characters. The engine stores it and never reads a number out of it. The parts list of 3e counts it: once per point and per copy of a pattern.
- **Updatable** by `updateFeature`: `sketch`, `points`, `shape`, `extent`, `targets`, `label` (`null` removes the label). References are verified as for every feature: only the ones the feature did not have.
- **References**: the sketch; every point as an entity of the sketch (`accepts: ['point']`, with the flag `own` of 2a: not projected geometry); every target as a body.
- **Registry**: `createsBody: false`, `namesFaces: true`, `producesTool: true`, `info.bodies: 'none'`.

Relations between the numbers (a head wider than its bore) are not checked by a command: a command is validated structurally, the numbers may be expressions, and the recompute has to check them anyway when a parameter changes.

## Recompute

The step, in `features/hole.ts`:

1. The sketch from the state; missing or not evaluated: `brokenReference`. The positions of the points from its solved geometry; a point that is gone: `brokenReference` with the point. The sketch needs no regions and no valid profile.
2. The shape is checked (`invalidHole` otherwise):
   - a head wider than the bore by more than `LENGTH_TOLERANCE`; for a nut pocket the bore has to fit between the flats;
   - for a countersink the depth of the cone, `(headDiameter − diameter) / 2 / tan(angle / 2)`;
   - no two points closer than the largest diameter of the hole (for a hexagon the circle through its corners) plus the tolerance: the holes of one tool must not overlap. `refs` name the two points.
3. A recipe `{ operation: 'cut', targets, build }`. `build` asks `toolSpan` for the span (so "through all" is measured per build and per copy, as for an extrusion), takes its length as the depth of the hole and builds one stack per point:

   | Shape | Sections from the mouth | Faces |
   |---|---|---|
   | plain | a cylinder to the bottom | `holeWall` |
   | counterbore | a cylinder `headDiameter` for `headDepth`; a step; the bore | `holeHead`, `holeSeat`, `holeWall` |
   | countersink | a cone from `headDiameter` to `diameter`; the bore, sharing the ring | `holeHead`, `holeWall` |
   | nut pocket | a hexagon for `headDepth`; a step; the bore | six `holeFlat`, `holeSeat`, `holeWall` |

   A head as deep as the hole or deeper is `invalidHole`; with "through all" that is only known in `build`, which throws it as a `ToolProblem` (2f).
4. The stacks are put into one solid (their vertices and triangles one after another); the caps and the seat of all points get one face number each, the other faces one per point.
5. `applyTool`, and the same handling of its answer as an extruded cut has: the recipe is stored also when nothing changed; `noEffect` names the targets the tool missed; `emptyResult` and `kernelFailure` as there. The few lines that turn an `Applied` into the result of a feature are shared with the extrusion instead of copied.
6. `facts`: `headDepth` and `depth`.

**The circles of a hole** all have one number of sides, by its largest radius (`segments` of `sketch.ts` with the chord tolerance), starting at the X axis of the sketch. The hexagon has six; its step to the bore is the hexagon with the circle as a hole, triangulated by the kernel. A step between two circles is triangulated the same way.

**Surfaces.** The bore and the head of a counterbore are cylinders about the normal through the point; the head of a countersink is a cone with the half angle `angle / 2`, its apex below the mouth and its axis pointing from the apex to the mouth; a flat is a plane (its `origin` the corner it starts at, at the mouth; its `y` the normal of the sketch plane); the seat and the caps are planes like the caps of an extrusion (the origin and the Y axis of the sketch, at their level).

**Edges**, by the rule of 2b: the mouth of a countersink with the face it is cut into (a plane and a cone), its lower rim (the cone and the bore, one ring of one tool), both rims of a counterbore and its seat with the bore are circles and can be projected; the edges of a flat are lines.

**A pattern** builds the tool again in the frame of the copy; a nut pocket turns with it.

## Faces

| Role | Parts | What |
|---|---|---|
| `holeWall` | `point` | the bore at the point |
| `holeHead` | `point` | the cylinder of a counterbore or the cone of a countersink |
| `holeFlat` | `point`, `flat` | one side of the hexagon of a nut pocket; `flat` from 1, counter-clockwise from the corner `rotation` points to |
| `holeSeat` | none | the step between head and bore, for all points |
| `startCap`, `endCap` | none | the mouths and the bottoms, for all points (the roles of today) |

- **Named by meaning, not by a count.** The brief and the vocabulary suggest "a point and a step". A step number renames the bore when a plain hole (step 1) becomes a counterbore (bore: step 2), and every sketch on it and every projected rim breaks. With `holeWall` the bore keeps its name through every change of the shape (`calls.ts`, `socketHeadsInstead`). The role with two parts the vocabulary provides for is `holeFlat`.
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

- **One catalog per standard.** `DataCatalog.source` is one text per catalog, and a row has a value in every column. One catalog of screws with columns from three standards would need three sources and empty cells wherever a standard does not cover a size. (Rejected alternative 6.)
- **Rows** are keyed by the thread (`M3`). Which sizes: what all four standards cover between M2 and M8; a size missing in one catalog is missing there only, and the query says which catalog lacks it.
- **Largest allowed sizes for what has to fit in**: the head diameter, the head height and the size across flats are the upper limits of the standard, because a pocket has to take the largest part. The clearance holes are the values of the series.
- **Where the numbers are taken from.** The four standards are the ones the backlog names. Their texts are not in the repository and are sold by ISO; this session read none of them. The implementation types the numbers from the text of the standard (if the owner has it), or from a published table that reproduces it, and writes the document it used into `source` with its edition. The review of that commit compares every number with a second, independent table; a difference blocks the commit. A test then pins the rows and checks what can be checked without a source: every column grows with the thread, `fine < medium < coarse`, a head is wider than its thread, a nut wider than its thread.
- **Heat-set inserts** have no standard, and the hole a maker recommends differs between makers. The catalog holds one maker's data sheet, named in `source` together with the words "typical values; check the data sheet of your inserts". Which maker is a question for the owner.

## The query `hardwareHole`

The backlog asks for "a tool that composes the feature" from the catalog. It is a query of the registry of the preparatory step:

- **Arguments**: `use` (clearance, socketHead, countersunk, nutPocket, heatSetInsert), `size`, `fit` (the clearance series, medium when left out), `allowance` (an expression added to every diameter and to the size across flats).
- **Answer**: `shape` (in the input form of a hole shape: numbers, or expressions when an allowance was given), `label`, `depth` for an insert, `from` (the catalogs used).
- **What maps to what** is the judgement an AI must not be left to make from memory:

  | Use | Shape | From |
  |---|---|---|
  | clearance | plain: the clearance hole of the series | `clearanceHoles` |
  | socketHead | counterbore: the clearance hole; the head diameter; the head height as the depth | `clearanceHoles`, `socketHeadScrews` |
  | countersunk | countersink: the clearance hole; the head diameter; the head angle | `clearanceHoles`, `countersunkScrews` |
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

The test that matches the first one (`pattern.test.ts` of the engine) is updated with it; no test matches the others.

## Where the code lives

| File | What 2c does there |
|---|---|
| `types.ts` | `HoleFeature`, `HoleShape`, members of `Feature`, `FeaturePatch`, `FaceName`, `ErrorCode`; the comments above are what the AI reads |
| `features/hole.ts` | new: the entry of the registry, the validator, the step |
| `features/index.ts` | one line |
| `features/extent.ts` | the arguments that restrict an extent for a hole |
| `recompute/tool-stack.ts` | the step between sections of different outlines (specified by 2b) |
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
- **Adds:** the feature type `hole` and its patch; the roles `holeWall`, `holeHead`, `holeFlat`, `holeSeat`; the code `invalidHole`; the catalogs `clearanceHoles`, `socketHeadScrews`, `countersunkScrews`, `hexNuts`, `heatSetInserts`; the query `hardwareHole`.

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
- Whether the series of ISO 273 are the right three choices for printed parts, where the allowance does most of the work. Kept, because they are what the standard has.
- The sizes: M2 to M8 is a guess at what printed parts use.

## Needs from the preparatory step

- **Part 4, roles of faces: a part that holds the ID of a derived point.** A hole at the centre of a projected circle would be named `{ role: 'holeWall', point: 'rim/center' }`: the ID of a point of projected geometry contains a slash, and the key of a face separates its parts by slashes. The contract says a part is "a text (an ID)" and does not say whether such an ID is one. Case: the inserts of scenario 12 sit at the centres of the posts; projecting the rim of a post gives that centre as a point, and the hole could use it. Until it is decided the hole takes own points and `origin` only, and the scenario repeats the expressions of the posts. Proposed: the validator of a text part accepts any ID the sketch can have, derived ones included; the key stays unambiguous because a derived ID has exactly one slash and the parts of a role are known.
- **Part 2: the two functions added to the index of the engine have no declaration.** `producesTool` and `generatorOf` are named in the design of part 2 and not in `contract.ts`, so a scenario that asserts "a hole is a source of a pattern" by `producesTool` uses a stand-in (`calls.ts`, `insertChecks`). The behaviour is asserted without it as well (the pattern is added and evaluates).
- A note for the plan, not a need: the table of packages says "plain and counterbored holes need only 00". In this design every kind is built by the stack of 2b, so 2c needs 2b as a whole.

## Tests the implementation owes

- Engine: each kind at one point and at several; the volumes against the formulas; the surfaces; the kinds of the edges and the projection of both rims of a countersink and of a counterbore; a sketch on a seat and on a flat; the names after a change of the kind and after a point is added; every refusal; "through all" with a head deeper than the target; a pattern of a hole and of a hole with a pocket in one list; the patch of every field; `label`.
- The catalogs: the pinned rows and the checks above. The query: every use, a size missing in one catalog, the allowance as an expression that the feature then accepts.
- MCP: the fixture of the query in the table of the guard.
- Scenario 12, from `calls.ts` of the four packages.

## Reviews

Not yet run.

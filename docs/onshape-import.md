# Converting a model from Onshape

Notes from converting one real Onshape document (the cycloidal actuator 5010: an assembly of 14 part studios, bearings, screws and a motor from other documents) into trymesh, and the tools that came out of it (`tools/onshape/`). It is not a complete importer: it covers what that model needed and says what it leaves out. What took the most work is described below, so that the next conversion does not have to find it again.

Last change: 2026-11-25.

## Quick start

```
export ONSHAPE_ACCESS_KEY=... ONSHAPE_SECRET_KEY=...        # API keys of the account (dev portal)
node tools/onshape/fetch.ts "<URL of an assembly or a part studio>" /tmp/model
ONSHAPE_IN=/tmp/model npx vitest run --config tools/onshape/vitest.config.ts
```

- `fetch.ts` (Node built-ins only, Node 23.6+ runs it as it is) downloads into the folder: the element list, the assembly, every part studio of the same document that the assembly uses or derives from (features, sketches with geometry, parts, mass properties, a dump of the geometry behind the queries of the features), the variable studios, and an STL of every part from another document. A file that is there is not downloaded again, so a run stopped by the rate limit is simply repeated.
- `convert.test.ts` (runs under Vitest, because the engine is TypeScript imported through Vite) writes `<folder>/trymesh/<name>.json`, `report.md` and `section-xz.svg`. `ONSHAPE_OUT` changes the folder; `ONSHAPE_OVERRIDES=<module>` loads hooks that convert chosen features by hand (`tools/onshape/overrides/actuator-5010.ts` is the example).
- `convert.test.ts` also writes `summary.json` (what the acceptance compares: the fate of every sketch constraint, the sketches with their regions and areas, the parts with their volumes in full precision, which edges of every chamfer and fillet were converted, the starts, the loaded document, the document's probe; every key qualified by the studio) and runs the document's probe (below; `ONSHAPE_PROBE=0` leaves it out, it takes minutes). `ONSHAPE_BASELINE=<summary.json of another run>` compares the two and writes `comparison.json` and a section of the report: strict (the parts, the chamfers and fillets by which Onshape edges they convert, the starts, the regions of every sketch, the loaded document), allowed to grow (helper copies, entries, parameters in use) and expected to change (fates and causes). The summaries of a model stay with its dump: they hold its names and measures.
- Open the result in the app (*Otevřít*) or with the MCP tool `open_document`.
- Read `report.md` first: every feature that was simplified or left out is a line there, and every part has its volume next to the Onshape one.

## How the document is built

| Onshape | trymesh |
|---|---|
| Part studio | A document of its own, in the frame of the studio |
| Assembly, subassembly | A document with an `insert` (D62) per instance of a part or subassembly, placed by the transform of the assembly (`placement`: shift and roll, pitch, yaw) |
| Part of another document (standard content, a bought part) | A stored mesh from STL and a `mesh` feature (D55), `use: 'reference'` |
| Variable studio | Parameters, set in every document |
| Sketch | Sketch on a base plane or on a plane feature offset from one |
| Extrude | Extrusion (`regions` profile; `distance` or `throughAll`) |
| Chamfer (equal distance), fillet | `chamfer`, `fillet` (D63) of the edges found by geometry |
| Derived (`importDerived`) sketches | The sketches copied into the studio |
| Mates | Not converted (the positions are what the assembly solved) |

The root document stores the documents of the studios and subassemblies (`documents`), each once per layout, and inserts them; a body is `<insert>/<body there>`. Two insertions of one studio with the same parameters share one recompute.

## What needed work, and how the tools handle it

### The API

- **Authentication.** Basic authentication with the API keys (`Authorization: Basic base64(access:secret)`) works for every endpoint used; the HMAC signature is not needed.
- **Numbers.** A quantity parameter of a feature (`BTMParameterQuantity`) has `value: 0`; the number is in `expression` (`"4 mm"`, `"#Phi_R"`, `"60 deg"`). Everything else is in metres (sketch geometry, `sketchMatrix`, transforms of the assembly, mass properties in m³).
- **STL export redirects** to another host. `fetch()` of Node drops the `Authorization` header on a cross-origin redirect and the second request is `401`; the tool follows redirects itself. The parameters `resolution`, `chordTolerance` and `angleTolerance` of the STL endpoint made no difference for these parts.
- **Rate limits.** Ordinary endpoints did not run out. The FeatureScript endpoint has a budget of its own: after about 150 calls it answered `429` and stayed so for over an hour (while `x-rate-limit-remaining` of other endpoints said 3000). Hence one dump call at the end of the timeline and rollback calls only where needed, the cache of files, and the retry with `Retry-After`.
- **`massproperties` ignores `rollbackBarIndex`**: the volume after a given feature has to come from FeatureScript (`evVolume` at a rollback), which costs that budget. Per-part volumes at the end are enough for the check.

### FeatureScript evaluation (`POST /partstudios/.../featurescript`)

- The body is `{ "script": "function(context is Context, queries) { ... }", "queries": {} }`; `queries` must be a map, an array is a `400`.
- `?rollbackBarIndex=<i>` evaluates the studio as it was before feature `i` (its index in `features`).
- The result is a tree of typed values (`BTFSValueMap`, `BTFSValueArray`, `BTFSValueWithUnits` in SI units); `plain()` in `fetch.ts` turns it into JSON. Errors come in `notices`, not as an HTTP error; a script with an error returns `result: null`.
- `qTransient(id)` takes the string as it is (`id as TransientId` fails to compile). `transientQueriesToStrings` of one query is a string, of an array an array.
- Divide a value by `millimeter` to get a plain number; `millimeter ^ 3` for volumes.

### Which regions and faces a feature means

- The query parameters of a feature carry `deterministicIds` (`JGG`, `KGCC`). They are transient IDs valid in that studio at that microversion. A region of a sketch is a face of the sketch body; a face that a later feature consumed (the cap an extrusion starts from, an edge a chamfer removed) is missing at the end of the timeline and has to be asked with the rollback to just before the feature.
- `qCreatedBy(makeId(<featureId>), EntityType.FACE)` lists the regions of each sketch, which says what sketch a region belongs to.
- A region of trymesh is named by the curves of its outer loop (`RegionRef`), not by an ID, so the converter matches the regions by geometry: the area agrees (2 % or 0.05 mm²: the polygons of circles are smaller, and tiny slivers between a tangent line and two circles are 0.09 mm²), the middle of every curve of the outer loop lies on an edge of the Onshape region, and the middle of every Onshape edge lies on the boundary of the region. Matching by lines and circles alone confused mirrored regions of the same area.
- The report compares the area of every profile with Onshape; a mismatch is the first sign of a wrong match.

### Sketches

- **Curves that cross.** Onshape makes regions of curves that cross (a circle cut by a line gives a D shape). trymesh refuses such a profile (no trim yet, step 6 of D36), so every visible curve is split where another one crosses or touches it: lines into segments, circles into arcs. A circle touched at one point (a tangent) stays whole. Collinear overlapping segments are kept once. Constraints on a split curve are dropped.
- **Points.** Onshape gives every curve its own end points held together by coincident constraints. trymesh needs one point where curves meet to close a region, so points at one position become one point.
- **IDs are unique in the whole document**, not per sketch: entity and constraint IDs are prefixed by the sketch (`Sketch_1.aH1mYNUjJF3o.start`).
- **The plane.** `sketchMatrix` (row-major, columns X, Y, normal and origin of the sketch) is matched against the base planes (XY is (+X, +Y, +Z), XZ is (+X, +Z, −Y), YZ is (+Y, +Z, +X)); a sketch on a face becomes a sketch on an offset plane, which loses the link to the face. A sketch whose normal is against the base normal flips the signs of the extents. Tilted planes (D60) are not built by the converter.
- **Constraints** that have a counterpart: coincident of a point and a curve, horizontal and vertical of a line, parallel, perpendicular, equal (lengths or radii), tangent, diameter and radius, midpoint, mirror of two points (symmetric), point–point and point–line distance (direction `MINIMUM` only), length (as a distance of the ends). No counterpart: anything on external geometry (the origin, an edge, another sketch), sketch patterns (`CIRCULAR_PATTERN`), mirror of curves, horizontal and vertical of two points, distances to a circle or between lines, `FIX` (could map to `fixed`), angles (could be mapped, not done). On this model 93 of 380 constraints have a counterpart (the global sketches counted in both studios that derive them): the geometry is exact, the sketches are loosely defined.
- **Checking the constraints.** A set of constraints is kept only when a preview shows the solver leaving every point where Onshape had it; otherwise the dimensions go in as numbers instead of expressions; otherwise without constraints. A value given as a plain number that does not match the geometry (a sign, a direction measured differently) is replaced by the measured one.
- **Expressions.** `#Phi_R / 2 + 1 mm` becomes `Phi_R / 2 + 1`, `30 deg` becomes `deg(30)`; other units are not converted.
- **Splines** (and ellipses) have no counterpart in this converter and are left out with a note (the sketch has a spline since D70; mapping Onshape's B-splines onto it is 6h's); a region bounded by one is not converted. The actuator's cycloidal disc is four imported splines; the override replaces it by the generator `cycloidalDisc` (D61) from the parameters of the variable studio. Its volume agrees with Onshape to 0.0 % before the chamfers.

### Sketch constraints by cause

Every Onshape constraint of every converted sketch gets one record (`tools/onshape/fates.ts`) and exactly one fate: `written` (constraints of trymesh stand for it), `entry` (a pattern or mirror written as an entry), `shared` (realised by the geometry: two points that are one point of trymesh, a point on a curve it is an end of), `twice` (it says what another written constraint says), `implied` (written, then removed because the sketch could not follow a change with it) or `lost`. A lost constraint has one cause, the first of: `refused`, `pattern`, `origin`, `plane`, `sketch`, `edge`, `unknown`, `mirror`, `spline`, `arc`, `split`, `kind`; what its operand is stays a column of its own (`refused (on the origin)`). An external operand is named by its deterministic ID alone; the converter decodes it (`tools/onshape/operands.ts`: after the first character the operation, then a base-64 number whose low two bits are the kind) against `created` of the dump to tell an entity of another sketch from an edge of a body. The report has a line per sketch (`Sketch 2: 6 points, 4 curves; of 12 constraints 9 written, 2 shared, 1 lost; 5 degrees of freedom`, and a line per cause under it) and the tables at its end.

On the actuator, with the converter before 6h (2026-11-25; the document it writes is byte for byte the one of before the count):

| Fate | Count |
|---|---|
| Written | 93 |
| Shared | 155 (151 by a point, 4 an end of the mirror line) |
| Twice | 1 |
| Lost | 131 |

| Cause of the loss | Count | By Onshape type |
|---|---|---|
| A curve the converter split | 37 | COINCIDENT 23, DIAMETER 11, TANGENT 3 |
| The origin | 31 | COINCIDENT 22, HORIZONTAL 8, DISTANCE (horizontal) 1 |
| A default plane | 13 | MIRROR 8, ANGLE 5 |
| An entity of another sketch | 12 | COINCIDENT 10, EQUAL 2 |
| An edge of a body | 1 | COINCIDENT 1 |
| A pattern | 19 | CIRCULAR_PATTERN 19 |
| A mirror of curves about a line of the sketch | 5 | MIRROR 5 |
| A spline | 4 | FIX 4 |
| A kind without a counterpart | 9 | HORIZONTAL of two points 3, DISTANCE of two lines 3, MIDPOINT of two points 2, ANGLE 1 |

The 380 count the constraints of the 24 sketches the converter makes (the two derived sketches in both studios that derive them). The report of before said "93 of 380 constraints"; 287 were never lost: 155 are realised by a shared point and one was written twice.

### The document's probe

`tools/onshape/probe.ts` loads every stored studio document that has a sketch, alone, and changes it away from today's values, each change from the loaded state and undone: every parameter an expression names whose own expression is a number (+3 %, +6 %, back; −3 %, −6 %, back; a count ±1, ±2; a zero ±0.1, ±0.2), every literal driving dimension of a sketch (+3 % and back, −3 % and back; a zero by 0.1 mm or 1°; a direction outside the range of the field is "not available"), and the count of every circular entry (+1, −1). Every state gets every verdict that applies: refused, cannot follow (a sketch's status leaves `ok` or its conflict list fills), invalid profile, reference (a later feature loses what it names, or the number of bodies changes), other, fails in part (a feature goes from `ok` to a warning), an assertion fails, not back (after the return the document is not the loaded one), kernel; a change with none of them either moves something (followed) or drives nothing. The assertions check on the solved geometry what the conversion promised and did not write as one constraint: every instance point of an Onshape pattern is its seed turned by k steps about the pivot (1e-6, the rows taken from Onshape's pattern constraint whatever became of the pattern, the sense read off the loaded positions), the lines of a distance of two lines stay parallel, a constraint removed as implied still holds, the copies of one derived sketch in two studios agree point for point after the same change of a parameter, and after a count is raised the new copy's regions are named by a feature.

The converter before 6h passes every status and leaves its patterns behind: of 40 walks of a parameter none has a verdict but the assertion, which fails in 6 (`Phi_R` both ways: the pin pockets of Housing 1 stand up to 1.7 mm off their seed turned; `M3_NUT_SIZE` both ways in Housing and in Motor Shell: the hexagon of Global Sketch 3, 0.08 mm); of 62 changes of a literal dimension, 14 fail it (the hexagons of Input Shaft 4 and Motor Shaft 2, two patterns of Motor Shell 2, and the hole patterns of the disc, of Motor Shaft 3 and of Output Shaft 2 when the diameter of the circle they sit on changes: the seed moves with the circle, the instances stay). The derived copies in Housing and Motor Shell agree (32 pairs, 16 moved, 0 mm). The probe takes about three minutes.

### Extrusions

- **Start at a face** (`startOffset` with `ENTITY`): the extent starts `from` the trymesh face (D66), so it follows the face. The face is found by its provenance (`tools/onshape/extent-start.ts`, `faceOf`): the dump says which Onshape feature created the Onshape face (`created[feature].faces`), the converter knows which trymesh extrusions it made for that feature, and among their caps in the state before the new feature it takes the ones in the plane of the Onshape face (the normals parallel within 1e-6, the point within 1e-3 mm) whose normal out of the body (`meshNormal` of the query `body`) agrees with the Onshape face's: the two caps of a very short extrusion lie in one plane but face opposite ways (the normals parallel when their cross product is at most 1e-6). Several caps of the extrusions made for one Onshape extrusion: the first by ID, with a note. A face a later feature consumed (on the actuator every one of the 31: the boss covers part of the face it stands on, which splits it) is not in the final `created`, only in the rollback evaluation at its feature (`at`), which names the part that owned it but not the feature that created it: then the candidates are the caps of every converted extrusion on the trymesh body of that part, and when several lie in its plane facing its way, the one on whose edges (`edges` of the query `body`) the most midpoints of the Onshape face's boundary edges (`m` of the dump) lie; no unique best is ambiguous and gives the number. Before writing `from` the converter previews the feature; a plane the extent cannot use (`invalidExtent`, `brokenReference`, `nonPlanarFace`) gives way to the number. A blind extrusion then starts at 0 from the face, a symmetric blind one at half its depth back (with the expression of the depth). Not found (an entity that is no planar face, a face consumed before the end of the timeline, a face of a feature that was not converted to an extrusion): the offset of the face from the sketch plane as a number, as before, with a note. The report counts the starts written as `from` and as numbers.
- **Up to a face**: by the same lookup, `upTo` (D47) to the trymesh face when it is found and the face has no offset (whose sense the converter does not map), with the same preview; otherwise a length, with a note.
- **Through all from a start**: one-sided "through all" from a face starts `from` it; from a numeric offset, `from` a plane feature at that offset (made by the converter as for a sketch plane), instead of the 1000 mm extrusion of before. A symmetric "through all" goes to both sides of any start, so it is written as plain `{ type: 'throughAll', side: 'both' }` without a start, whatever its start was.
- **Several pieces**: one Onshape extrusion with the operation new makes a part of every separate piece (six spacers at once); trymesh makes one body, so the regions are grouped by touching bounds into one extrusion each and matched to the Onshape parts by their bounds.
- **Add to several bodies** at once: trymesh adds to one; the first is taken (a combine of D56 would do the rest).
- Targets of add and cut come from `booleanScope` (Onshape part IDs, mapped to the trymesh bodies as the features create them).

### Chamfers and fillets

- The Onshape edges come from the dump (a line by its ends, a circle by centre, radius and axis) and are looked up among the edges of the trymesh body (the query `body`). One Onshape edge can be several trymesh edges (the circle of a bore split by pockets, an edge split where the converter split a curve): every match is taken.
- When a feature is refused, each edge is tried alone and what passes stays. On this model 4 of 10 chamfers were converted and the one fillet was not. The disc's chamfer is on the edges of the splines, which the generator replaced; the other refusals were all limits of D63: an edge that ends at a round face (the bore broken by the pin pockets), a straight edge between two cylinders (the 32 edges of the fillet), an arc that meets another edge at an angle, and an edge ending where two flush faces of two extrusions meet (partly a result of splitting the curves).
- With the run-outs of D67 (2026-11-17) the same 4 of 10 convert, and the volumes are the same; what the refusals say now:
  - Housing Middle, Chamfer 2 (0.5, 32 edges): every edge runs out into its pin pockets, but the rim is not a plain top. The converter split the bore at the pockets, so the 32 edges are the 16 arcs of the rim under the lip of the ring above (its inner radius 29, the bore 29.5) and the 16 of the rim at the bottom, and the face of each edge across the bore is that lip, 0.5 wide. A concave chamfer of 0.5 reaches its inner edge exactly, and D63's check of the overshoot refuses it (0.039 mm² of the tool left on the lip's wall). At 0.49 all 32 edges convert, 24.9 mm³ added, in about 1 s.
  - Motor Shaft, Chamfer 1 (2 edges): the edges are the concave feet of a tab on the end of the shaft, not the top edges of a slot as the design reconstructed them. Their inner end has two planes (the socket and the tab), refused as before; their outer end runs past the shaft's rim into the air, a stop, refused as deferred.
  - Motor Shell, Chamfer 2: a stop (the concave foot of a rib past the rim of the round plate), refused with the advice to chamfer before the feature that makes the rim.
  - Input Shaft, Chamfers 1 and 2: half a smooth chain (the converter's split arcs) and an end at two faces (the lobes), as before.
  - Housing, Fillet 1: the straight edges between the pockets and the bore are not found as edges D63 takes (of the kind other).

### Assemblies

- Every occurrence (`rootAssembly.occurrences`) has its transform in the frame of the root, by its path of instance IDs, row-major, metres. A child of a subassembly is placed in the subassembly's document by `inverse(parent) · child`.
- **Subassemblies that are not rigid**: the parent's mates move their parts, so two instances of one bearing can hold their parts differently (one MR106 bearing sat 80 mm away from its own balls). A subassembly is converted once per layout of its parts.
- **Bought parts as meshes**: a bearing merged into one STL is refused, because its balls, rings and shields touch along edges (`edges with more than two triangles`). One mesh per part, inside the bearing's document, is accepted. A mesh is limited to 100 000 triangles; the motor merged had 125 000.
- Mates are not converted. This model has only fastened mates (and one revolute in the motor), so the positions are enough; a revolute or slider mate could become a joint of the mechanism (D49).

### Checking the result

- `report.md` lists the volume of every part against `massproperties` of Onshape. On this model all parts agree within 1.7 % (most within 0.2 %); what is left is the chamfers and fillets that were not converted (a concave chamfer adds material, a convex one removes it: the motor shell checked to 10 mm³ of 22 889 once they are counted).
- `section-xz.svg` is the export `svg` of the engine through all bodies; on macOS `qlmanage -t -s 1400 -o . section-xz.svg` makes a PNG of it.
- The MCP tool `view_image` needs the app connected to the bridge on port 4517; when another session's server holds that port, the app connects there, and a document must not be opened in it.

## Gaps this conversion found

| Gap | Effect on this model | Where it stands |
|---|---|---|
| Trim, regions of crossing curves | 6 sketches split by the converter, their constraints lost | Step 6 of D36: the tools `trim`, `extend` and `split` (6e, D65, designed). The converter calls `split` in the closing point of the step, 6h ([d36/6-plan.md](d36/6-plan.md)) |
| Splines | The cycloidal disc needed an override | The curve exists (6d, D70: a clamped uniform B-spline of degree up to 3 over own control points), and `bsplineBeziers` turns a non-rational B-spline of any knots into a chain of such curves; the converter's mapping of Onshape's B-splines is 6h's. Here the generator of D61 did better. The chamfer on the edges of splines stays a gap: an edge of a spline face is of the kind `other` (D70, a backlog row) |
| Sketch pattern and mirror, projection from another sketch, constraints on the origin | 287 of 380 constraints reported lost, of which 131 are lost (6h's recount: the report counted only the constraints it wrote; 155 are realised by a shared point and 1 was written twice); derived sketches copied | Step 6: mirror and pattern in a sketch (6c, D68, designed), the axes of the origin (6a2), projection from another sketch (6b, D69, implemented on its branch: what 6h can use is the entry `{ type: "sketch", sketch, entity, kind }` for a constraint on an entity of an earlier sketch of the studio, `externalFirst`, `externalSecond`, `externalMirror`, which the converter skips today, with the constraint on that entry and an own point tied to a projected point by `coincident` where the converter merges points at one position; a derived sketch from another studio stays a copy, and the constraints on its entities become projections from the copy; [d36/6b-sketch-projection/design.md](d36/6b-sketch-projection/design.md), "The Onshape converter"). The converter uses none of them yet. The lost were never counted by cause; 6h counts them by cause before and after (designed: [d36/6h-onshape-converter/design.md](d36/6h-onshape-converter/design.md), 131 lost before and 6 after as measured on its trial) and is the point where the converter takes the new tools over |
| Start of an extrusion at a face | 31 extrusions started at a number | `from` (D66): all 31 written as `from` (2026-11-17), the volumes of the parts unchanged |
| Chamfer and fillet of an edge ending at a round face, of a straight edge between round faces | 6 of 11 features left out (a seventh is on the disc's splines) | Run-outs past a cylinder or (an arc) a plane parallel to its axis taken (D67, 2026-11-17); still left out: the housing's rim (a chamfer as wide as the lip it lies under, D63's overshoot check), stops (the motor shaft's tab, the motor shell's ribs), two faces at an end (the input shaft's lobes, the shaft's socket), the fillet of straight edges between the pockets and the bore |
| Placing a body of this document (move, rotate) | Solved by inserting documents | `insert` (D62) |
| Mates, assembly solving | Positions taken as solved | Not planned (D36); the mechanism (D49) for joints |
| Direct editing (`moveFace`, the Bambu and Ender variants of the parts) | Variants not converted | Not planned; parameters and the values of an insertion are the way in trymesh |
| STEP import | Bought parts as STL, a controller board left out | A library needs the owner's approval (D2) |

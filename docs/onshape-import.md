# Converting a model from Onshape

Notes from converting one real Onshape document (the cycloidal actuator 5010: an assembly of 14 part studios, bearings, screws and a motor from other documents) into trymesh, and the tools that came out of it (`tools/onshape/`). It is not a complete importer: it covers what that model needed and says what it leaves out. What took the most work is described below, so that the next conversion does not have to find it again.

Last change: 2026-11-17.

## Quick start

```
export ONSHAPE_ACCESS_KEY=... ONSHAPE_SECRET_KEY=...        # API keys of the account (dev portal)
node tools/onshape/fetch.ts "<URL of an assembly or a part studio>" /tmp/model
ONSHAPE_IN=/tmp/model npx vitest run --config tools/onshape/vitest.config.ts
```

- `fetch.ts` (Node built-ins only, Node 23.6+ runs it as it is) downloads into the folder: the element list, the assembly, every part studio of the same document that the assembly uses or derives from (features, sketches with geometry, parts, mass properties, a dump of the geometry behind the queries of the features), the variable studios, and an STL of every part from another document. A file that is there is not downloaded again, so a run stopped by the rate limit is simply repeated.
- `convert.test.ts` (runs under Vitest, because the engine is TypeScript imported through Vite) writes `<folder>/trymesh/<name>.json`, `report.md` and `section-xz.svg`. `ONSHAPE_OUT` changes the folder; `ONSHAPE_OVERRIDES=<module>` loads hooks that convert chosen features by hand (`tools/onshape/overrides/actuator-5010.ts` is the example).
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
- **Splines** (and ellipses) have no counterpart and are left out with a note; a region bounded by one is not converted. The actuator's cycloidal disc is four imported splines; the override replaces it by the generator `cycloidalDisc` (D61) from the parameters of the variable studio. Its volume agrees with Onshape to 0.0 % before the chamfers.

### Extrusions

- **Start at a face** (`startOffset` with `ENTITY`): trymesh has no such start, so the offset of the face from the sketch plane is taken as a number. The model keeps its shape but no longer follows the face.
- **Up to a face**: converted to a length. `upTo` (D47) exists, but it needs the trymesh name of the face, which the converter does not derive from an Onshape face (a possible improvement: find the face by its plane in the query `body`).
- **Through all from an offset start**: trymesh's `throughAll` starts at the sketch plane; a 1000 mm extrusion instead.
- **Several pieces**: one Onshape extrusion with the operation new makes a part of every separate piece (six spacers at once); trymesh makes one body, so the regions are grouped by touching bounds into one extrusion each and matched to the Onshape parts by their bounds.
- **Add to several bodies** at once: trymesh adds to one; the first is taken (a combine of D56 would do the rest).
- Targets of add and cut come from `booleanScope` (Onshape part IDs, mapped to the trymesh bodies as the features create them).

### Chamfers and fillets

- The Onshape edges come from the dump (a line by its ends, a circle by centre, radius and axis) and are looked up among the edges of the trymesh body (the query `body`). One Onshape edge can be several trymesh edges (the circle of a bore split by pockets, an edge split where the converter split a curve): every match is taken.
- When a feature is refused, each edge is tried alone and what passes stays. On this model 4 of 10 chamfers were converted and the one fillet was not. The disc's chamfer is on the edges of the splines, which the generator replaced; the other refusals were all limits of D63: an edge that ends at a round face (the bore broken by the pin pockets), a straight edge between two cylinders (the 32 edges of the fillet), an arc that meets another edge at an angle, and an edge ending where two flush faces of two extrusions meet (partly a result of splitting the curves).

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
| Trim, regions of crossing curves | 6 sketches split by the converter, their constraints lost | Step 6 of D36, not designed |
| Splines | The cycloidal disc needed an override | Step 6; here the generator of D61 did better |
| Sketch pattern and mirror, projection from another sketch, constraints on the origin | 287 of 380 constraints lost; derived sketches copied | Step 6 |
| Start of an extrusion at a face | 31 extrusions start at a number | Not planned |
| Chamfer and fillet of an edge ending at a round face, of a straight edge between round faces | 6 of 11 features left out (a seventh is on the disc's splines) | Limits of D63 |
| Placing a body of this document (move, rotate) | Solved by inserting documents | `insert` (D62) |
| Mates, assembly solving | Positions taken as solved | Not planned (D36); the mechanism (D49) for joints |
| Direct editing (`moveFace`, the Bambu and Ender variants of the parts) | Variants not converted | Not planned; parameters and the values of an insertion are the way in trymesh |
| STEP import | Bought parts as STL, a controller board left out | A library needs the owner's approval (D2) |

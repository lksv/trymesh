# 6f Import of an outline (D72)

**State: designed 2026-11-25 on Fable, with prototypes run against the real engine and adapters; not reviewed, not implemented.** The text is written against `master` at `c01e765` (schema version 10), where every package before 6f in the sequence of step 6 is implemented and merged: 6a (D64), 6a2 (D71), 6e (D65), 6c (D68), 6b (D69) and 6d (D70) ([6-plan.md](../6-plan.md)). It reads their code, not their first designs; "What 6f needs of the packages before it" checks each thing their designs say of 6f against the code.

Files: [contract.ts](contract.ts) (the entry, the stored value, what the registry gains, the import and its two formats, what 6f adds to the packages before it, the query, MCP, the app), [calls.ts](calls.ts) (validation scenario 15 as one model, and the cases of 6f), [probes/](probes/) (the prototypes behind "Measured", kept so that every number can be run again).

The package in short:

1. **A reference kind of entry of `external`, `outline`**: the curves of a drawing (lines, arcs, circles, splines) stored **in the entry**, in the coordinates of their file, and placed in the sketch by three numeric fields (`x`, `y`, `turn`) and an anchor (the origin of the file, or the centre of its box). Fixed for the solver, so constraints may name its entities and a later sketch may project them.
2. **Entities `<entry>/<local>`** (a curve, `board/l3`) with points named as an own curve names them (`board/l3/a`, `board/a1/center`, `board/s1/0`). The readers number the curves by kind in the order of the file: `l1`, `a1`, `c1`, `s1`.
3. **The flag `regions`, default true** (owner, answer 2): the curves bound regions, their ends join by position in 6c's stage (no code of 6f's), and they name side faces. With the flag off the outline is reference only.
4. **A revised file is `updateExternal` with the new curves**; an entity keeps its ID when the file lists it at the same place among the curves of its kind. An update that takes away an entity a constraint names is refused (the third part of 6a's rule of an update, which is 6f's to write: without it the document that results does not load, measured).
5. **The stored value is the placement and a fingerprint**, not positions: the document holds every coordinate once.
6. **The solver gets of an outline only what the constraints name**, as it gets the axes of the origin: with a whole outline of 2000 curves in its input the adapter runs out of memory (measured).
7. **The import**: a second catalog of formats, `OUTLINE_FORMATS` (`dxf`, then `svg`), beside `IMPORT_FORMATS`; the function `importOutline` with what every format shares (a weld of ends that a file with few digits leaves apart, arcs made exact, the limit of 2000 curves, the IDs, a report). Hand-written readers, no library.
8. **The MCP tool `import_outline`** reads a path, as `import_mesh` does, and sends the command itself (the curves never pass through the caller); without a sketch it only reports. `get_sketch` lists an outline short, and a query `entryCurves` pages through the rest. The app has *Import an outline…* in the panel of a sketch.
9. **Scenario 15 as one model**: the board imported from a DXF the test writes as a PCB tool would, the cover built on it by the packages before, and the checks of step 7; the whole ran on the prototype.
10. **No command, no feature type, no face role, no issue code, no section, no schema step.**

## What the plan says, checked against the code

| Statement of the plan | What the code says |
|---|---|
| "A file read into an outline stored in the document (like a stored mesh of D55: inside the document, so it stays self-contained)"; "the schema (6f adds a section…)" | Self-contained, yes. **Not a section**: `entityOf` answers from the sketch alone (`references/index.ts`; commands and `load` validate without a recompute), so a section would force a copy of the list of entities into every entry that places it (6a said so: "a constraint of 6f"), two places to keep equal, two more commands and a schema step. Stored in the entry there is one place, the update of the entry is the revision, and a build without the kind refuses the entry by itself ("The stored outline: in its entry"). Open, 1 |
| "placed in a sketch as a kind of reference"; the amendment: "coordinates and a turn as numeric fields of the entry (`external/<id>/…`, the slot 6c writes first), or `origin`, or a point of reference geometry" | Numeric fields. The slot works as 6c left it: `fields.number` at `external/<id>/x`, expressions kept by `withEntryExpressions`, `setField` and `renameParameter` reach them (measured, B3). A point of reference geometry as the place would make the outline depend on another entry and able to fail; deferred |
| "The outline forms regions by a flag, default true" | `EntryGeometry.regions` (6a) carries it; the convention of 6b's flag holds (always stored, the kind has the default). 6c's position stage takes "every curve that is not own and forms regions" (`positionJoins`, `references/derive.ts`), so an outline closes with no code of 6f's (measured) |
| "its curves can be constrained to and projected" | Both work with no change (measured: `pointOnCurve`, `tangent`, `coincident`, a reference dimension on its entities; 6b's projection of `o/c4`, `o/a1`, `o/l1/a`). Two readers need a line each: the own rule of a constraint reads the points of an entry's curve only for an entry whose ID is the curve (`ruleProblem`, `features/sketch.ts`), and `entityOf` lists every entity of a reference entry at each call |
| "A tool `import_outline` reads a path, like `import_mesh`, and answers with the batch" | `import_mesh` (`packages/mcp/src/server.ts`) stores the mesh itself (`addMesh`) and answers with the batch that places it. An outline is stored by the command that places it, and a batch in the answer would carry every curve through the caller and back. So the tool sends the command, and without a sketch only reports. Open, 2 |
| "the app has a button in the sketch panel" | The panel of a sketch lists the entries by `REFERENCE_UI`; a file is read in the app as a mesh file is (`features/mesh.ts`, `importFile`) |
| "A revised file replaces the stored outline; entities keep their IDs only when the file lists them in the same order" | By kind and order ("Entities and their IDs"). Measured: the board 2 mm wider keeps all twelve IDs and everything after it follows; a file with two holes listed the other way round gives their IDs to each other |
| "whether the reader is an entry of `IMPORT_FORMATS` or a tool of its own" | `IMPORT_FORMATS` (`packages/engine/src/import/`) is typed to `read(...): ReadTriangles`, and its consumers take every entry for a mesh format: the `format` enum of `import_mesh`, `importFormatOf`, the file input of the app, `importMesh`. A second catalog of the same shape, `OUTLINE_FORMATS`; the helpers that pick a format by its extension take a catalog as a parameter already |
| DXF: "`LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE` and `POLYLINE`/`VERTEX` with bulges, `SPLINE` as a spline of 6d when it is cubic and not rational" | As listed, with degree 1 to 3. 6d's `bsplineBeziers` (`spline.ts`) asks for a clamped knot vector, so a periodic spline is left out and listed. Each Bezier piece is one spline of the sketch (measured) |
| "The engine writes DXF already (D54), so the reader is tested on the writer's files" | The writer (`export/dxf.ts`) writes release 12: `POLYLINE`, `VERTEX`, `SEQEND` with bulges, `CIRCLE`, layers `OUTER` and `HOLES`, `$INSUNITS` 4. Read back, the section of the board gives a body of the board's volume to the last digit (measured) |
| "From knowledge, not checked: PCB tools export the board outline as DXF with lines, arcs and circles" | Still not checked against a file of a PCB tool; the test file is written by the test in that form ("To verify") |
| SVG: the subset listed | Prototyped (`probes/svg.ts`) but for the smooth forms `S` and `T` and a round `ellipse`; the engine's own SVG (D54) read back gives the curves of its DXF within 3e-10 mm |
| "hundreds of own points tied by `fixed` constraints would cost the analysis of freedom" | The analysis is not the cost of reference geometry (0.9 ms for 1000 curves); the profile is (26 ms), and the solver's memory is the limit (below) |
| Scenario 15, step 1: "placed by the entry's fields so that its hole pairs are symmetric about the axes" | The anchor `center` with the place (0, 0): the board is symmetric because the file is, whatever page coordinates the PCB tool wrote, and a wider revision stays on the axes (measured: 26.5 and 26.5, then 27.5 and 27.5) |

Not in the plan, found in the code:

- **`solverSetup` puts every point and curve of every resolved entry into the input of the solver** (`sketch.ts`), fixed. Fine for an edge (three points); an outline of 2000 curves is 3000 fixed points, and the planegcs adapter aborts with "OOM" on such an input, depending on what it solved before (measured, C4).
- **`updateExternal` accepts an update that takes away an entity a constraint names**, and the document it leaves is refused by `load` ("entita "pcbo/c4/center" ve skice není"): the slot of 6a's rule in `updateProblem` is empty, with the comment "refused by the package that can reach it, 6f" (measured, B5).
- **`updateExternal` takes the whole entry.** For an outline that is every curve again to switch a flag.
- **The stored value of an entry is typed `Projected`** (`SolveStamp.external`), "positions and nothing else", and it is what the stamp holds of an entry. An outline's positions are its entry's; stored again as a value they would double the document.
- **`contactFix` of 6e finds a flagged projection by `sketch.external[curve.id]`**, which a curve of an outline (`o/l1`) is not: such a curve gets the general reason "is reference geometry, which no tool cuts", and the ends of an own curve at its end, while they are not one vertex with it, are listed as a contact no cut repairs, the defect 6b fixed for its projections (the crossing measured, D1; the ends read from the code).
- **`isSplineOf` of 6b knows an own spline and a copy of one**, so a projection of a spline of an outline is refused with "is a spline, expected line", not with 6d's text (measured, D5).
- **`get_sketch` spreads a reference entry into its answer** and lists every entity with its place (`sketchDetail`, `packages/mcp/src/tools.ts`): for an outline, all its stored curves and then all of them again.
- **A file written with few digits does not close**: the ends of an arc, computed from its centre, radius and angles, and the ends of the lines beside it differ by the rounding of the file, and ends join only within 1e-6 mm (measured, A3: a board written with four decimals is sixteen open ends).

## The cheap variant

What the plan asks, with these choices:

- The curves live in the entry; one entry is one file (or the chosen layers of one); the same file in two sketches is two entries, or one entry and projections of it.
- The placement is three numbers and an anchor. No mirror, no scale: the unit is the reader's.
- A revision keeps IDs by kind and order; nothing is matched by geometry.
- An outline is never cut and never copied by a pattern; where it has to be cut, it is drawn as own curves in a later sketch (6b's tool).
- The readers take the listed subset and say what they left out; nothing is repaired but ends that nearly meet.

**Deferred**: STEP and other exact formats, text, matching a revision by geometry (the plan's list); a placement on a point of reference geometry; a mirrored placement; an own outline drawn over an import in the same sketch by a tool (a later sketch does it; a backlog row with 6b's "an existing projection taken over as own curves"); periodic and rational splines, splines of a degree above 3, ellipses and elliptical arcs; blocks of a DXF (`INSERT`), nested `svg` and `use`; CSS of an SVG (a hidden element is read); a file kept linked to its path (the document stores the curves, not where they came from); an outline from a face of an imported mesh.

## Measured

**Recipe.** `npx vitest run --config docs/d36/6f-outline-import/probes/vitest.config.ts` from the root of the repository (one file: add its path), against the real engine, the real planegcs adapter and the real manifold kernel; 27 cases in 9 files, about 75 s. The numbers go to the console. The prototype (`probes/proto.ts`) holds the kind, put into `REFERENCE_KINDS` at run time, the reader of DXF, the weld and the IDs; `probes/svg.ts` the reader of the SVG subset; `probes/cover.ts` the cover of scenario 15 over the imported board. The reader of stored values (`projected`, `references/spec.ts`) is mocked to take the form of an outline's value. What the prototype does not have: the solver's input narrowed inside the engine (probe F emulates it at the port: a solver that takes the unnamed fixed geometry out, solves, and puts the positions back), the third part of the rule of an update, the partial update, the texts of 6e's reasons, the query, MCP, the app. Timings are of one machine and one run, to compare with each other.

| | What | Result |
|---|---|---|
| A1 | The section of the stand-in board (60 × 40, corners of 3, four holes) exported by the engine as DXF, read back | 1230 characters, read and welded in 1.5 ms: 4 lines, 8 arcs (the writer divides a quarter turn in two), 4 circles; nothing welded. In a sketch: valid, one region of twelve curves with four holes and the four discs; the region with its holes 2360.239393 mm² against the section's 2360.239396; extruded 1.6: **3776.383089761619 mm³, the board's volume to the last digit**; side faces `{ role: 'side', curve: 'o/a1' }` |
| A2 | A plate with a spline side, its section as DXF (the spline is a polyline of the mesh), read back | 67 lines, one region whose outer loop names 67 curves, its area 6e-10 mm² from the section's; `addExternal` 5.6 ms; the entry 5472 characters; `solved.external` is `{ kind: 'outline', at: [0, 0], turn: 0, data: '69d59c1c2302629a' }` |
| A3 | A board as a PCB tool writes it (separate `LINE` and `ARC` entities), turned by 17° so that no coordinate is round, written with 9, 6, 4, 3, 2 decimals: how far apart the ends of neighbours are | 9.1e-10, 9.3e-7, 8.7e-5, 8.9e-4, 7.2e-3 mm |
| A3 | The same files with a weld of 1e-6, 1e-3, 1e-2 mm | 9 and 6 decimals close with any; 4 and 3 decimals: **16 open ends and no outline region** with 1e-6, closed with 1e-3; 2 decimals: open with 1e-3 (the report lists 16 gaps, the nearest 0.0031 mm), closed with 1e-2. The area after the weld: 2392.158 to 2392.160 against 2392.158 |
| A4 | After a weld that moved ends by up to 8.9e-4 mm, the arcs with their centre moved onto the bisector of the chord: how far the two ends are off one radius; an own point held on such an arc and an own line tangent to it | at most 1.2e-14 mm stored and 3.6e-15 placed (a turn of 0 and of 0.3 rad); solved, no redundancy, every time |
| B1 | Scenario 15, step 1: the board of the file (page coordinates 100 to 160, 80 to 120; the layer `Edge.Cuts` of three), placed by its centre on the origin, extruded 1.6 | 12 curves; the sketch valid with 0 degrees of freedom, a region of the eight outline curves with four holes; the holes at (∓26.5, ∓16.5); 3776.38 mm³ against 3776.17 by hand; the entry 823 characters; the stored value `at: [-130, -100]` |
| B2 | Steps 2 and 3 of 6b's calls over the import (the skeleton projects `pcbo/a1` …, the floor by `projectSketch` with `as: 'own'`, the rim, the standoffs) | every feature ok; both holes 26.5 from `origin/y`; the floor's sketch 0 degrees of freedom, no redundant constraint, one region; the base 7835.04 against 7836.90 by hand (the numbers of 6b on the stand-in) |
| B3 | Step 7: the file of the board 62 wide, by `updateExternal` with the new curves | the twelve IDs the same; every feature ok; the board +128.000002, the base +212.000004 mm³ (by hand 128 and 212); the holes 27.5 and 27.5; 159 ms |
| B3 | The same file with the anchor `origin` and the place (−130, −100) | the holes 26.5 and 28.5 from `origin/y`: the board grew to the right |
| B3 | `turn` as the expression `boardTurn` (a quarter turn), then 0; `setField` of `external/pcbo/x` | `expressions` holds `external/pcbo/turn`; the board 40 × 62 and every feature ok, the floor's own outline with it; back; the field moves the outline |
| B4 | The whole import projected into a later sketch by `projectSketch`: in its role, and as an own outline | 12 entries and the regions of the source; 12 own curves, 0 degrees of freedom, no redundancy, the same regions; after the wider file the own outline follows (2472.158 mm² against 2472.274 by hand) |
| B5 | An own point `coincident` with `pcbo/c4/center`; an update whose curves lack `c4`, **as the engine is today** | accepted; the sketch ok; **the document does not load**: "constraints.k.b: entita "pcbo/c4/center" ve skice není". An update that makes `c4` a line is refused already (6a's rule of a kind that stays) |
| B6 | A file with the first two holes listed the other way round | the same twelve IDs; `c1` is the other hole |
| C1 | One outline of n curves (a toothed closed outline of n/2 lines and n/2 holes in it), n = 100, 300, 1000, 2000: read and weld; `addExternal`; a drag of an own point in the sketch; the entry in the document | 0.6, 1.5, 3.0, 5.9 ms; 20, 30, 65, 120 ms; 9 to 23, 18 to 24, 61 to 71, 95 ms; 6700, 21,500, 72,400, 139,900 characters. A change elsewhere in the model: 0.1 ms (the sketch is not computed again) |
| C1 | What `get_sketch` would list: every curve; fifty | 7300, 23,500, 79,300, 153,800 characters; 4000 |
| C2 | The stages of the sketch step for 1000 curves that form regions (300 in brackets): the entry placed; the input and the stamp; the solver; the analysis; `sketchWorld`; the profile | 0.00; 2.1; **14** (4.6); 0.9; 5.8 (1.3); **26** (4.1) ms. With the flag off the last two are 0.9 and 0. The solver had 1503 points, 1001 curves, 2001 fixed |
| C3 | The solver given only the entities the two constraints name (6 points) | input and stamp 0.02, solve 0.13, analysis 0.03 ms, for 1000 and for 2000 curves |
| C4 | Drags in a sketch whose solver input holds the whole outline | 1000 curves: 600 drags, 51 ms each, no failure. 2000 curves (3002 points), after them in the same process: **the first drag ends in `sketchConflict`, "Aborted(OOM)"**; in another run the same input solved eight times after smaller ones, and a second instance of the adapter aborted on its first solve. A small sketch afterwards solves |
| F1 | The narrowing emulated at the port, end to end, 300, 1000, 2000 curves: a drag with the regions; with the flag off | 8, 40, 103 ms; 1.9, 7.4, 16.7 ms; the solver had 7 points; **600 drags with 2000 curves, no failure**; the constraints hold (the own point on the hole centre, a reference dimension to an outline line measured) |
| D1 | An own line across a side of an outline that forms regions: the query `sketchContacts`, `split` | invalid; one crossing, `fix: 'none'`, "\"o/l1\" is reference geometry, which no tool cuts" (6e's general reason); split refuses with it. A trim by a place removes the whole own line (nothing bounds it) |
| D1 | The flag switched off; a trim of the own line with `o/l1` as `with`; an extend to `o/l3` | valid, no region, no contact; the trim cuts the line at the side and holds the new end on it (`pointOnCurve`); the extend reaches y = 20 |
| D2 | An outline without its bottom side: the result; then own lines with a notch between its two open ends, the own ends `coincident` with them | valid, two open ends in `openEnds` (`apart`, 4.24 mm to the nearest end); then one region of five own and seven imported curves, 2332.158 mm² against 2332.274 by hand, no open end, no contact |
| D3 | A mirror of 6c about a line of an outline (`o/l2`); a pattern of a curve of one | the copies mirrored, one region; refused: "the source "o/c1" is a projected circle; a mirror or pattern copies own curves and points" |
| D4 | A later sketch projects `o/c4` with the flag, `o/l1/a` as a point, `o/a1`; then the outline without `c4` | projected, a region of the circle; `repairsByDefault` of the source is true; then the warning `brokenProjection`, "board has no circle o/c4", the circle kept at its place |
| D5 | A DXF in inches with a `LINE`, a cubic `SPLINE` of three spans, a rational `SPLINE` and an `ELLIPSE` | scaled by 25.4; three splines of four control points (`s1` to `s3`) and the line close into one region, extruded (10,167 mm³), each spline one side face; the other two in `skipped`. A point on `o/s1` is refused by the catalog; a projection of it by "is a spline, expected line"; the whole sketch projected takes the line and leaves the splines out |
| D6 | A hole feature at `o/c1/center`; the disc of `o/c1` cut again | refused ("is projected geometry; an own point … is expected"); ok |
| D7 | The board of two decimals read with a weld of 0.001 | the report: 16 gaps, the nearest 0.00308 mm; `openEnds` of the sketch: 16, `apart`, 0.00308 |
| D8 | The same curves in two entries of one sketch: side by side; on each other | 10 regions; invalid, twelve pairs in `lying` of `sketchContacts` |
| E1 | The engine's SVG (D54) of the board's section read back, against its DXF read back | the same sixteen curves under the same IDs, the numbers within 3.1e-10 mm; "1 mm per unit"; valid, five regions |
| E2 | A drawing as a drawing program writes one: 100 mm × 50 mm over a viewBox of 200 × 100, groups with `translate`, `rotate` about a point and `scale`, a rect with round corners, a circle, paths with relative commands, `C`, `Q` and arcs, an ellipse, an elliptical arc, a text on another layer | 0.5 mm per unit; the layers `cut` (7) and `engrave` (2); of `cut`: 8 lines, 6 arcs, a circle and 2 splines (four and three control points); the ellipse and the path with the elliptical arc in `skipped`; five regions, the rounded rect (40 × 20, corners of 3: the first arc `center [47, −8]`, from `[50, −8]` to `[47, −5]`) with the disc and the lens as its holes |
| G1 | The lid of 6d's calls over the import: its half held 12 beyond the projected right side of the board and 7 beyond its bottom and top, mirrored about `origin/y` | 0 degrees of freedom, no redundancy, one region with 6c's names; 8871.81 mm³ against 8872.28 by hand (6d's number on the stand-in) |
| H1 | Scenario 15 as one model, 17 features: the two rows of vents (the second sketch placed from the projection of a copy, `m/1/c3`) | every feature ok; the lid 8531.72 and 8395.68 against 8531.59 and 8395.32 by hand |
| H2 | The rectangular notch of the floor: three lines across the bottom side of its own outline, three trims | `invalidProfile`, then one region, the base patched in the first batch; the sketch 0 degrees of freedom, no redundancy; the base 7755.04 (80.00 less) |
| H3 | The round notch in the top line of the lid's source half | the lid keeps one region through both splines and both notch arcs; the second trim lists it in `dropped`, as in 6d's test; 8295.46 against 8294.79 by hand |
| H4 | `vents` 7, 3, 5 | −136.04 (by hand −136.27); `noProfile` naming the region of copy 3; back to the digit |
| H5 | **The revised file of the board, 2 mm wider, in that model** | **every feature ok** in 175 ms: the board +128.000, the base +212.000, the lid +216.000 mm³; the holes 27.5 and 27.5; the floor's sketch still determined |
| H5 | The section of the lid as DXF, read back | 8 loops; 96 lines and 40 arcs, nothing welded; 8 regions; the region of the outer loop with its seven holes 4255.743 mm² against the section's 4255.729 (the section's area is of the mesh, the region's of the arcs divided again within the chord tolerance) |

What the numbers decide:

- **The reader welds** (A3): a file of four decimals, which is what a drawing has when its units are written to a tenth of a micron, does not close without it. The default is 0.01 mm: it closes every file down to two decimals of a millimetre and four of an inch, it moved nothing in a file of six decimals by more than 1e-6, and no outline to cut or mill has a curve that short. The report says how many ends were moved and how far, and which stayed open with another end near.
- **An arc is made exact by its centre, not by its end** (A4): the weld fixes the two ends, so the centre goes onto the bisector of their chord; the placement then applies 6b's `exactArc`, which moves the end by the last digit at most.
- **The solver gets what the constraints name** (C2 to C4, F1): not for the time (14 ms of 60) but for the memory, which is not ours to bound: the same input solved or aborted by what the adapter had solved before.
- **The limit is 2000 curves** (C1, F1): 120 ms to place, 100 ms for every change in that sketch while it forms regions, 17 ms with the flag off, 140,000 characters of the document. Above 500 curves the report of an import says what a change in the sketch will cost and that a later sketch, which projects what it needs, costs nothing of it.
- **The value is the placement and a fingerprint** (A2, B1): 80 characters, whatever the outline.
- **`get_sketch` lists fifty curves** (C1): 4000 characters; the whole of 1000 curves would be 79,000.
- **The update needs its rule** (B5): today a legal command leaves a document that does not load.
- **The anchor `center` is what "symmetric about the axes" asks for** (B1, B3): the page coordinates of the file do not reach the model, and the revised board stays on the axes.
- **Nothing of 6c's stage, 6b's kind or tool, or 6e's cuts needs a change to take an outline** (B2, B4, D1 to D4, G1, H1 to H5); what 6f adds there is texts and two conditions.

## Decisions

### The stored outline: in its entry

The curves of an outline are a field of its entry, `external.<id>.curves`, and nowhere else.

- **Why not a section** (`outlines`, as `meshes` of D55, which the plan sketched). 6a requires that `entityOf` answers from the sketch alone. With the curves in a section, every entry that places an outline would hold a copy of the list of its entities, kept equal to the section by every command that touches either: `addOutline`, `removeOutline`, a replacement that reaches into every sketch that places it, a check on `load`, and the rule of a constrained entity asked across the sketches of the document. A section also needs a schema step. The gain would be one outline placed in several sketches, which a projection from the sketch that holds it gives already, with one place to revise.
- **What it costs**: the entry is as large as the file (823 characters for the board, 140,000 for 2000 curves). Every command that changes the sketch makes a new sketch object and shares the entry's; undo shares it too. `get_document` leaves the curves of a large outline out, as it leaves out the data of a stored mesh.
- **Size limits**: 1 to 2000 curves; a spline 3 to 64 control points (6d's limit); a local ID of letters, digits and underscores; positions finite. An import beyond the limit is `tooLarge`, an entry beyond it an invalid command.
- **The form**: `curves: Record<local ID, OutlineCurve>`, in the order the reader made them; an `OutlineCurve` is a line (`a`, `b`), a circle (`center`, `radius`), an arc (`center`, `start`, `end`, counter-clockwise) or a spline (`points`, the control points of a spline of 6d), with positions `[x, y]` in millimetres in the coordinates of the file. A position is a number, never a field: an expression there is an invalid command.

### The entry `outline`

```ts
interface SketchOutline {
  type: 'outline';
  name?: string;                        // of the file, for people
  curves: Record<Id, OutlineCurve>;     // in the coordinates of the file, mm
  x: number; y: number;                 // where the anchor lands, numeric fields
  turn: number;                         // rad about the anchor, a numeric field
  anchor: 'origin' | 'center';          // the origin of the file, or the centre of its box
  regions: boolean;                     // the curves bound regions; default true
}
```

- **`regions` is always in the document** (6b's convention); `addExternal` may leave it out and gets `true`. So may it leave out `x`, `y`, `turn` (0) and `anchor` (`origin`).
- **It has no reference**: `refs` and `faces` are empty, nothing of the model is read, and `compute` cannot fail. An outline has no warning of its own.
- **One file, one entry.** Two entries may hold the same curves; on each other they make the profile invalid as any two curves do, and `sketchContacts` lists the pairs (measured).

### Entities and their IDs

| Curve of the entry `o` | Entities |
|---|---|
| a line `l3` | `o/l3` (line), `o/l3/a`, `o/l3/b` |
| a circle `c1` | `o/c1` (circle), `o/c1/center` |
| an arc `a2` | `o/a2` (arc), `o/a2/center`, `o/a2/start`, `o/a2/end` |
| a spline `s1` of n control points | `o/s1` (spline), `o/s1/0` … `o/s1/<n − 1>`; a closed one lists its first point once |

- **The entry itself is no entity** (as the entry of a mirror is none): `o` names nothing a constraint could take.
- **Points belong to their curve**, named as 6b's projection names them (`<curve>/<name>`), and two curves that meet have two points at one place. This leaves 6a's vocabulary, which gave an outline points of its own that its curves share ("What 6f changes in 6a's vocabulary"). Since answer 19 the ends of curves that are not own join by position anyway, so shared IDs would close nothing more; and a point named by its curve keeps its ID exactly when the curve does, where a numbering of the vertices of a file would shift with every vertex added.
- **The local IDs are the reader's**: `l<n>`, `a<n>`, `c<n>`, `s<n>`, each kind counted from 1 in the order of the file, after the choice of layers and the weld. A polyline is its segments, counted with the rest. By kind, so that a hole added to a board moves no line and no arc, and the kind of an ID never changes under a revision. An entry written by hand may use any local IDs.
- **`entityOf` asks the kind for one ID** (`entity`, a member the derived half has since 6c and the reference half gets): `o/l3/a` is two look-ups, not a listing of 5000 entities. `entities` stays for the listings (`entityIndex`, built once per sketch object).
- **What a region and a face are named by**: the curve's ID, `{ outerLoop: ['o/a1', …, 'o/l4'] }` and `{ feature, role: 'side', curve: 'o/l3' }`; the key of such a face quotes the slashed ID (6c wrote the quoting).

### The placement

- **`x`, `y`, `turn`** are numeric fields at `external/<id>/x`, `…/y`, `…/turn` (mm, mm, rad within a turn either way): they take expressions, `setField` with the sketch as the feature changes one, and the recompute follows a parameter (measured).
- **`anchor`** says which place of the file lands at (`x`, `y`), and the outline turns about it:
    - `origin` (the default): the origin of the file. The file's coordinates are the model's but for the motion; a revised file moves nothing that did not move in it.
    - `center`: the centre of the box of the curves (lines by their ends, circles whole, arcs by what they pass, splines by the box of their curve). The outline is centred whatever the page coordinates of its file, and stays centred when a revision is larger. This is how the board of scenario 15 is symmetric about the axes.
- **A point p of the file stands at `at + R(turn) · p`**, with `at = (x, y) − R(turn) · a` for the anchor `a`. A turn of exactly 0 multiplies nothing, so an outline that is not turned keeps the digits of its file up to the addition of `at`.
- **Not a point of the sketch** (the review's finding 9), and **not a point of reference geometry**: an entry would then depend on another, the order of `resolveReferences` (by ID) would matter, and an outline could fail and would need a frozen value, which is its positions. A place that follows a body is an expression over parameters today; "Deferred".

### The value, the stamp, the arcs

- **The value** of an outline in `solved.external` is `{ kind: 'outline', at, turn, data }`: where the origin of the file lands, the turn, and `fingerprint(stableStringify(curves))`, computed once per object of `curves`. `Projected` gets this fifth form (the type and its reader `projected`); it is the only one that is not positions.
- **The stamp** of the sketch holds the value, as for every reference: the sketch is solved again when the outline moves or its curves change, and not when its flag or its name does.
- **Nothing is frozen**: the value never fails, so `value` (the reader of a stored one) only checks the form, and `keepsValue` is always true: an update has no stale geometry to drop, and the recompute writes the fresh value whenever the stamp differs.
- **The geometry** is computed from the entry and the value (`outlineGeometry`) and kept by the object of `curves` and the placement, so a drag of an own point does not place 2000 curves again (measured: 0.00 ms).
- **Arcs.** A stored arc has its two ends on one radius within 1e-9 mm (the validator refuses more, with the distance); the readers leave under 1e-12, by the centre moved onto the bisector of the chord. The placement then puts the end on the circle of the start (6b's `exactArc`, shared), so a fixed arc is as exact as the solver asks (1e-10; measured 4e-15).
- **A spline** of an outline is a spline of the result over its control points (`{ type: 'spline', points: ['o/s1/0', …] }`), which 6d's shape function takes from any source: it forms regions, names a side face, and no constraint names it; its control points are points like any other of the entry.

### Regions, joins and face names

- With `regions: true` every curve of the entry is in `EntryGeometry.regions`; with `false` none. Never some: the layers of a file that should not bound anything are left out at the import, or go into a second entry with the flag off.
- **The ends join by position** in 6c's stage (`positionJoins`), which takes every curve that is not own and forms regions: with each other within 1e-6 mm, and with the end of an own curve that forms regions there, when the own ends at that place are one vertex. Nothing is stored and 6f writes no code there. The reader's weld is what makes "within 1e-6" true for a file.
- **An own chain may close an open outline** (measured, D2): own ends `coincident` with the open ends, one region of own and imported curves.
- **Ends that stay open** are in `SketchResult.openEnds` (6c), `apart` with the nearest end and how far; the advice of `get_sketch` gets the cure for an outline: import again with a larger `weld`, or end an own curve there.
- **Invalid, as for any curves**: an own curve that forms regions and crosses the outline, two outlines on each other. The first has no repair by a tool ("At the plug-in points of 6e").

### The solver gets what the constraints name

- A kind may say **`narrow`**: the input of the solver gets of its entries only the entities that a constraint of the sketch names: a named curve with its points and its radius, a named point alone. An outline says it; the kinds of today do not, so the stamp of every stored sketch stays.
- **Where**: `resolveReferences`, which has the sketch, gives such an entry `solver`, the part of its geometry the operands of the constraints name (reference dimensions too: they are measured from the curves of the input); `solverSetup` reads `solver ?? geometry`. The curves of the sketch, the profile and the result read `geometry`, whole.
- **After the solver** the step puts the positions of the entries into its geometry (`{ ...reference points, ...solved points }`), as it puts the far points of the axes there: the solver returns only what it got.
- **Sound** because every point of reference geometry is fixed and no equation of the solver reads a fixed entity that no constraint names; the analysis of freedom reads the same input. The stamp then holds, of an outline, the named curves and the value, which is everything the solve depends on.

### A revised file: the update and its rule

- **A revision is `updateExternal`** with the new `curves`. `partial` (below) lets it send nothing else, so the placement, the flag and their expressions stay.
- **What keeps its ID**: an entity whose curve is at the same place among the curves of its kind in the new file. A board made wider keeps every ID; a hole added at the end of the holes adds `c5`; a hole added first renames the others; two holes listed the other way round swap (measured). Nothing warns of a swap: a known limit.
- **The rule of an update, its third part** (`updateProblem`; 6a left it to the package that reaches it): an update under which an entity that a constraint of the sketch names goes away is refused, naming the entities and the constraints; the caller removes them first, in the same batch. For every kind; the first two parts stand (reference does not become derived, an entity that stays keeps its kind).
- **What is not refused**: a later feature that names an entity that went. As everywhere, a reference to what was removed is valid in a document: a projection of it keeps its last place with `brokenProjection` (measured), a region that names it is `noProfile`. The tool and the app say what went (`outlineRevision`: kept, added, removed) and show the features that are not ok after the command.
- **`partial`**: a kind may say that `updateExternal` may leave fields out, which then keep what the entry has: the command's `ref` is laid over `entryInput(sketch, id)`, so an expression stays an expression. An outline says it; `{ type: 'outline', regions: false }` switches the flag, `{ type: 'outline', curves }` is a revision. `addExternal` requires `curves`.

### At the plug-in points of 6e

The names are 6e's ("Plug-in points" of its design); checked against `sketch-cut.ts`.

- **`sketchWorld`, `stepBase`, `toolBase`: nothing.** An outline's curves are reference curves of the base; `toolBase` takes them from `SketchResult.curves` with their flag, so a tool sees an outline closed as the recompute does.
- **`curvePredicates`: nothing.** `formsRegions` reads the flag; `mayCut` is false for what is not own; `holdsPoint` is true for a reference line, arc and circle and false for a spline.
- **`contactFix`**: a curve of an outline that forms regions is flagged as a projection of 6b is. The test becomes "a reference curve with `regions` whose entry is a projection from a sketch or an outline" (the entry of `o/l1` is `o`). With the ends of another curve the contact is not listed (6b's rule: the join of the own ends there cures it, and the position stage takes the outline's end in); any other contact is `fix: 'none'` with 6f's reason: "o/l1 is a curve of the imported outline o, which forms regions and is not cut: switch `regions` of o off … and draw the outline as own curves in a later sketch (the sketch tool projectSketch with as: "own"), then cut that; or remove the curve that meets it".
- **An extend** that would end on or cross such a curve is refused with 6e's text of a curve that forms regions and is not own, as for a projection; with the flag off an outline curve is a stop like a projected edge, and a `with` curve of a trim (measured).
- **`readersOf`: nothing.** It answers for a cut of a tool; a revision is a command, and what it breaks is said by the recompute.
- **`repairsByDefault`: nothing.** A later sketch that projects a curve of an outline with the flag already counts (measured); a feature over a region of the outline's sketch already counts.

### With 6c, 6b and 6d

- **6c.** A line of an outline is an axis of a mirror and a direction, a point a centre (measured: a mirror about `o/l2`). A curve of an outline is no source of a pattern; 6c's text calls it "a projected circle", which stays. `openEndAdvice` gets the cure for an outline.
- **6b.** An entity of an outline is a source of a projection like any entity of an entry: `{ type: 'sketch', sketch: 'board', entity: 'pcbo/a1', kind: 'arc' }`, a point `pcbo/l1/a`, a control point `o/s1/1`. The whole-sketch form of `projectSketch` takes the curves of an outline (each in its role: with the flag when the outline has it) and none of its points; `as: 'own'` draws an own outline over an import, held on the projections (measured: 12 own curves, determined, following the revised file). `sketchSources` lists the entities with their places. One line: `isSplineOf` answers for a spline of an outline, so its projection is refused with 6d's text.
- **6d.** A spline of an outline is not projected, not cut, and no operand of a constraint, by the rules that hold for an own one; `projectSketch` leaves it out and lists it in `splines`. `get_sketch` and the query give it `through` and `box`.

### What consumers accept

6a's table, the row of an outline (the same as a projection from a sketch but for the source of a projection, which it is too):

| Consumer | An entity of an outline |
|---|---|
| A point of a curve of the sketch | no (a `coincident` joins to it) |
| An operand of a constraint of its sketch | a line, an arc, a circle and every point, with at least one own operand; a spline never |
| An operand of a generator (`sketchPoint`, a circle), an `AxisRef`, a frame of a placement | yes |
| A mirror axis, a direction or a centre of 6c | yes; not a source of a pattern |
| A point of a hole, a curve of a wall (`notProjected`) | no; the holes of a board are the regions of its circles, or a later sketch |
| `setCurvePoint`, the fillet's corner, a cut of 6e | no; a `with` curve of a cut of an own curve |
| A source of a projection of a later sketch | yes; a spline no |
| A region | with `regions: true` |

### Validation and the commands

- **The validator of the kind** (on `load`, `addFeature` of a sketch, `addExternal`, `updateExternal`): the fields (`onlyFields`); `curves` an object of 1 to 2000 entries; each key a local ID; each curve of its form (a line at least the length tolerance long; a radius at least the tolerance; an arc with its ends on one radius within 1e-9 mm, not a whole turn; a spline of 3 to 64 points, closed only by its first point again, then at least 4); the three numbers through `fields.number`; `anchor`; `regions`; `name` a text of the length of a name. It returns the object of `curves` it was given when that is in its canonical form, so what is kept per object (the fingerprint, the box, the geometry) survives a command that does not change the curves.
- **`addExternal`, `updateExternal`, `removeExternal`** as they are, with `partial` and the rule above. `removeExternal` of an outline whose entities are constrained behaves as for any entry.
- **The text for an unknown type** lists the kinds; 6f adds `outline`.

### The import

`importOutline(format, bytes, options)` (`packages/engine/src/import/outline.ts`), a function without a state, as `importMesh`:

1. The options are checked against the description of the format (`checkArgs`), and the format reads the bytes into curves in millimetres, in the order of the file, each with its layer.
2. **The weld** (`weldOutline`). Ends of lines, arcs and splines within `weld` of each other, transitively, are put at the position of the first of them in the order of the file. Then every arc gets its centre moved to the nearest point of the bisector of its chord. A line or an arc whose ends became one place is dropped and counted. The option `weld` is 0.01 mm unless given, 0 to 1; with 0 only the arcs are made exact.
3. **`empty`** when no curve is left (the message lists the layers of the file and what was skipped); **`tooLarge`** above 2000.
4. **The local IDs**, by kind and order.
5. **The report**: the unit and where it came from, the layers of the file with what each holds by type, what was skipped by reason, the curves by kind, `welded` and `moved`, `dropped`, the ends that are open and the gaps (an open end with another end within a hundred welds, with the distance), the bounds, and notes in words: a unit the file did not state, the gaps with the weld that would close them, bounds under 1 mm or over 10 m ("is the unit right?"), more than 500 curves.

A format is a module of `import/` and a line of `OUTLINE_FORMATS`, described like an import format of D55 (`title`, `summary`, `extensions`, `options`, `read`), so the description for the AI, the tool and the app's file input read the catalog. Both formats take `layers`, `unit` and `weld`. The same bytes and options give the same curves under the same IDs.

### The readers: DXF

ASCII DXF, any release. Read by hand (`import/dxf.ts`); the text is decoded as UTF-8.

- **Groups**: a code line and a value line, both trimmed; CR LF, LF or CR. A code that is not a whole number is `unreadable` with the line. The sentinel of a binary DXF and the head of a DWG are `unreadable` with what to do ("save it as ASCII DXF").
- **Sections**: `HEADER` for `$INSUNITS`; `ENTITIES`. `BLOCKS`, `TABLES`, `OBJECTS` are passed over. A file without `SECTION` that is a bare list of entities up to `EOF` is read as its entities.
- **Units**: the option `unit`; else `$INSUNITS` 1 in, 2 ft, 4 mm, 5 cm, 6 m, 9 mil; 0 or no header is millimetres, and the report notes it; any other value is `unreadable` with "give the option unit".
- **Layers**: group 8 of each entity (`0` without one); the option `layers` by exact name. The report lists every layer.
- **`LINE`** (10, 20; 11, 21); **`CIRCLE`** (10, 20, 40); **`ARC`** (10, 20, 40, 50, 51: degrees, counter-clockwise from 50 to 51; equal angles are a circle).
- **`LWPOLYLINE`** (70 bit 1 closed; per vertex 10, 20 and the bulge 42) and **`POLYLINE`** with its `VERTEX` entities up to `SEQEND` (the form the engine writes): a segment per pair of vertices, a line, or with a bulge `b` the arc that turns by `4 · atan(b)`, counter-clockwise for a positive bulge; its centre is `(p + q) / 2 + ((1 − b²) / (4b)) · perp(q − p)`. Vertices at one place make no segment. A `POLYLINE` that is 3D or a mesh (70 bits 8, 16, 32, 64) is left out and listed. Widths are not read.
- **`SPLINE`**: read when it is not rational (70 bit 4 clear, the weights 41 all equal or absent), of degree 1 to 3, with control points (10, 20) and `n + degree + 1` knots (40) that are clamped at both ends. It becomes its Bezier pieces, exactly (`bsplineBeziers` of 6d): a line per piece for degree 1, a spline of three control points for degree 2, of four for degree 3; the pieces share their ends to the digit. Left out and listed, each with its reason: rational, a higher degree, periodic (not clamped), fit points without control points.
- **An entity drawn from below** (extrusion direction 210, 220, 230 of (0, 0, −1)) has the x of its circle, arc and polyline mirrored, an arc's angles with it; any other direction is left out and listed. A z is not read; the report notes a file whose entities do not lie at z = 0.
- **Left out and listed** (`skipped`, by type with a count): `INSERT` (blocks), `ELLIPSE`, `TEXT`, `MTEXT`, `DIMENSION`, `HATCH`, `POINT`, an entity of paper space (67 = 1), and every other type.

### The readers: SVG

SVG 1.1, the subset of the plan (`import/svg.ts`), as text in UTF-8.

- **XML**: elements and attributes (either quote), comments, processing instructions, CDATA and a `DOCTYPE` without declarations of its own are passed over; a `DOCTYPE` with an internal subset is `unreadable` (entities of its own). The five predefined entities and numeric ones in attribute values. Prefixes are read as written (`inkscape:label`); an `svg:` prefix on an element is dropped. Text that is no tag is ignored, so a file cut short reads as far as it goes; a file without an `svg` element is `unreadable`.
- **Millimetres**: the option `unit` (what one user unit is); else `width`, `height` (mm, cm, in, pt, pc, px or none) over the `viewBox`, the same scale both ways or `unreadable` ("give the option unit"); a root without them at 96 units per inch. The origin of the `viewBox` moves nothing: the coordinates are the user space of the root.
- **y points down in SVG**: every place is read as (x, −y), so the drawing looks as it does on the screen, below the x axis. (The engine's writer wrote (u, −v), so its own files come back where they were.)
- **Layers**: the groups an element is in, each by its `inkscape:label` or else its `id`; the option `layers` takes an element when one of its groups is named.
- **`transform`** on a group or a shape: `translate`, `rotate` (with a centre too), `scale`, `matrix`, composed down the tree. A shape whose total transform is not a similarity (an uneven scale, a shear, `skewX`, `skewY`) is left out and listed. A reflection is one: an arc under it runs the other way, and its ends swap.
- **`path`**: `M`, `L`, `H`, `V`, `Z`, `C`, `Q`, their smooth forms `S` and `T`, `A` with equal radii, and the relative forms of all. `C` is a spline of four control points, `Q` of three. An arc: the centre from the two ends, the radius and the two flags (SVG 1.1, F.6.5; a radius under half the chord is raised to it); the flags may be written without separators. A path with any other command or an arc of two radii is left out whole and listed.
- **`rect`** (with `rx` equal to `ry`, the corners as arcs), **`circle`**, **`ellipse`** with equal radii, **`line`**, **`polyline`**, **`polygon`**.
- **Passed over with their content**: `defs`, `clipPath`, `mask`, `symbol`, `pattern`, `marker`, `metadata`, `style`. **Left out and listed**: `ellipse` of two radii, `text`, `image`, `use`, a nested `svg`.
- **Not read**: CSS (`style`, classes, a transform in a style), fills and strokes (a filled shape is its outline), `display` (a hidden element is read).

### The query `entryCurves`

An entry of `QUERIES` (`query/entry-curves.ts`): the curves of one entry of a sketch with their places, a page at a time, for any kind of entry (the copies of a pattern too, which 6c lists short).

- **Arguments**: `sketch`, `entry`, `kind` (optional: `line`, `arc`, `circle`, `spline`), `from` (how many to pass over, default 0), `max` (default 100, at most 500).
- **Answer**: `status` (`ok`; `unavailable` when the sketch did not evaluate; `noEntry`), `total`, `from`, and `curves`, each with its ID, its flag `regions` and its place in the sketch rounded as positions are: a line by `a` and `b`, a circle by `center` and `radius`, an arc by `center`, `start`, `end` and `sweep`, a spline by `through` and `box` (6d's).
- It reads the state of the solved sketch (`context.sketch`), no body (`geometry: 'none'`). It costs its line in `QUERIES` and its rows in the two typed tables of `packages/mcp/test/queries.test.ts`; the app reaches it through the generic form.

### The step, in order

1. `resolveReferences`: an outline's value from its entry (never lost); its geometry; for a kind with `narrow`, `solver`, the part the constraints name.
2. `solverSetup` (reading `solver` where there is one) and the solver, as today.
3. The geometry after the solver, with the positions of the entries the solver did not get.
4. `sketchWorld(stepBase(…))`: the curves of the outline among the reference curves, 6c's position stage over them when the flag is on. No line of 6f's.
5. The profile, the result (the curves of the entry with the flag, `openEnds`).

## The document and the schema

- **What the document gains**: an entry `{ type: 'outline', … }` in `external` of a sketch, with its curves, and its value `{ kind: 'outline', … }` in `solved.external`. Region references and face names hold the IDs of its curves, strings to every build.
- **No upgrade step, no new version; `SCHEMA_PENDING` stays 0 and the version 10.** A build without the kind refuses the entry (`externalRef`, with the text that lists the kinds it knows), so a document with an outline is an invalid document there, not a model with the outline dropped; its stored value belongs to the entry and goes with it. This is the rule of `schema.ts` ("no step is needed where a build without the addition refuses by itself") and what 6a said of 6b, 6c and 6f. The plan expected a step for a section; there is no section.

## Where the code lives

| File | What changes |
|---|---|
| `packages/engine/src/types.ts` | `OutlineCurve` and `SketchOutline` (with the comment the AI reads), a member of `ExternalRef`; `Projected` with the form `outline`; the input forms of the two commands (`Input<SketchOutline>` with what may be left out) |
| `packages/engine/src/references/outline.ts` (new) | the kind: `validate`, `refs` and `faces` (none), `entities`, `entity`, `compute` (`placeOutline`), `value`, `geometry` (`outlineGeometry`), `keepsValue`, `narrow`, `partial`, `summary`, `example`; `outlineBox`, `outlineEntities` |
| `packages/engine/src/references/spec.ts` | `ReferenceValues.outline`; the optional members `entity`, `narrow`, `partial`; `ResolvedReference.solver`; `projected` reads the fifth form |
| `packages/engine/src/references/index.ts` | the line of the registry; `entityOf` asks `entity` when the kind has it; `resolveReferences` fills `solver` for a kind with `narrow` (`narrowed`); `updateProblem`, its third part; the text of an unknown type lists `outline` |
| `packages/engine/src/sketch.ts` | `solverSetup` reads `solver ?? geometry` of a resolved entry |
| `packages/engine/src/features/sketch.ts` | the step: the positions of the entries the solver did not get, put into the geometry after it; `ruleProblem`: the points of a curve of an entry are the point entities under `<curve>/` |
| `packages/engine/src/document.ts` | `updateExternal`: for a kind with `partial` the command's entry laid over `entryInput(sketch, id)` before the validator; the third part of the rule through `updateProblem` |
| `packages/engine/src/references/projection.ts` (6b's) | `isSplineOf`: a spline of an outline |
| `packages/engine/src/references/world.ts` (6e's), `references/derive.ts` (6c's) | nothing |
| `packages/engine/src/sketch-cut.ts` (6e's) | `contactFix`: the test of a flagged curve takes an outline's, with 6f's reason |
| `packages/engine/src/import/spec.ts` | `ImportFormatSpec<S, R = ReadTriangles>`; `ReadOutline` |
| `packages/engine/src/import/outline.ts` (new) | `OUTLINE_FORMATS`, `importOutline`, `weldOutline`, `outlineIds`, `outlineRevision`, the report and its notes |
| `packages/engine/src/import/dxf.ts`, `import/svg.ts` (new) | the two readers |
| `packages/engine/src/query/entry-curves.ts` (new), `query/index.ts` | the query and its line |
| `packages/engine/src/index.ts` | exports `importOutline`, `OUTLINE_FORMATS`, `outlineRevision`, the types |
| `packages/mcp/src/server.ts` | the tool `import_outline` (reads the path, runs the command through the bridge or its own engine as `import_mesh` does) |
| `packages/mcp/src/tools.ts` | `sketchDetail`: the row of an outline (`OutlineDetail`); `documentShown`: the curves of a large outline left out; `openEndAdvice` for an outline |
| `packages/mcp/src/api.ts` | the generated section "Outline formats" from `OUTLINE_FORMATS`; the kind in "Entries of a sketch" by its `summary` and `example`; the paragraph on reference geometry gets the outline's sentence |
| `packages/mcp/test/outline-formats.test.ts` (new), `queries.test.ts`, `coverage.test.ts` | the two typed tables of the formats (as `import-formats.test.ts`); the rows of `entryCurves`; nothing in `coverage.test.ts` unless `importOutline` is reached through `Engine` (it is a function, as `importMesh`) |
| `packages/app/src/references/outline.ts` (new), `index.ts`, `spec.ts` | the row of the kind; `ReferenceUi` gains `file` |
| `packages/app/src/panels/sketch.ts`, `sketch-mode.ts` | the button *Import an outline…*, the draft with the report, the button of a row with `file` |
| `packages/scenarios/test/scenario15.test.ts`, `board-kit.ts` | the `describe` of 6f and the assembled model; `boardDxf` |
| docs | `architecture/sketch.md` (the kind, the placement, the narrowed input), `architecture/api.md` (`ExternalRef`, `Projected`, the rule of `updateExternal` with its third part and `partial`, `importOutline`, the query), `architecture/ai.md` (the tool, `get_sketch` of an outline, the formats), `architecture/naming.md` (a side face named by a curve of an outline), `architecture/repository.md` (the new files in the table of layers), `architecture/verification.md`; `ui/` the sketch panel; `decisions.md` D72; `requirements.md` scenario 15; `backlog.md` (the rows of "Deferred") |

`references/outline.ts` imports `validation.ts`, `spline.ts`, `util.ts` and `references/spec.ts`, as `projection.ts` does without `solid.ts`; the readers import `import/spec.ts`, `spline.ts` (`bsplineBeziers`) and `util.ts`. `import/outline.ts` does not import `references/`: the curves are the type of `types.ts`. No new layer.

### Points of work

In this order; each is closed by the procedure of `CLAUDE.md`. The depth of the review is the table's there.

| # | Point | Review |
|---|---|---|
| 1 | **The kind.** `SketchOutline`, the value, the validator, the entities and `entity`, the placement and the geometry, `partial`, the rule of an update, `ruleProblem`, `isSplineOf`, `contactFix`. Tests on outlines written by hand, up to a few hundred curves | Full (the sketch step, validation of commands) |
| 2 | **The narrowed input of the solver** (`narrow`, `solver`, the geometry after the solver). Then the limit of 2000 curves is tested | Full (the solver) |
| 3 | **The import**: `OUTLINE_FORMATS`, `importOutline`, the weld, the IDs, the report, the reader of DXF. Tests on the engine's own files and on files written by the tests | Full (new geometry and a heuristic, the weld) |
| 4 | **The reader of SVG** | Full (new geometry: the arcs, the transforms) |
| 5 | **MCP**: the tool `import_outline`, `get_sketch` and `get_document` of an outline, the query `entryCurves`, `describe_api` | Full (the tool is neither a catalog entry nor a form; the query alone would be light) |
| 6 | **The app**: the button, the draft, the row | Light |
| 7 | **Scenario 15 assembled**, the documents and the indexes | Light when it changes no code; a change it forces in an earlier package gets the depth of its kind |

Point 1 without point 2 is correct and slow for a large outline, and can abort the adapter beyond about a thousand curves; the two are merged together.

## The app

- **The button *Import an outline…*** in the panel of a sketch, beside the tools (not an entry of `SKETCH_TOOL_UI`: it picks nothing in the view). It opens a hidden file input whose `accept` is `importAccept(OUTLINE_FORMATS)`; the file is read as a mesh file is.
- **The draft** (`OutlineDraft`, state of the sketch mode): the file as read once by `importOutline`, shown in the panel as its report: the curves by kind, the size, the unit with a selector, the layers as checkboxes with what each holds, what was skipped, the weld, the open ends and gaps, the notes. A change of a layer, the unit or the weld reads the bytes again (3 ms for 1000 curves). Below: the anchor (*origin of the file*, *centre*), the checkbox *regions*, and *Place*, which sends one `addExternal` (the ID by `outlineId`, the name of the file) with the place (0, 0); *Cancel* drops the draft. A refusal of the import shows as the status line shows a refusal of a mesh.
- **The row of the entry** (`REFERENCE_UI.outline`): title "Outline", detail the name and the counts ("board.dxf: 4 lines, 4 arcs, 4 circles"), tag "imported", the form of 6c's rows for `x`, `y`, `turn` (each takes an expression) and the anchor, the checkbox *regions* (`flag`: `updateExternal` with the one field), `inModel` (the outline is drawn in the model view, solid when it forms regions), and *Replace file…* (`file`): it reads a file with the options the row remembers nothing of (every layer, the default weld; the layers of the first import are not stored), sends `updateExternal` with the curves, and says what stayed, came and went; a refusal by the rule of an update is shown with its text. A file whose layers have to be chosen again is replaced through the draft: *Import an outline…* with the entry selected offers *Replace* beside *Place*.
- **Constraining and projecting** need nothing: the entities of an outline are picked as those of any entry (the snap and the hit test read `SketchResult.curves` and `points`).
- **What the snapshots of the app see**: the button in every record that shows the panel of a sketch. The commit that changes them says so.

## MCP

- **The tool `import_outline`** (`ImportOutlineArgs`, `ImportOutlineAnswer` of the contract), in `server.ts` beside `import_mesh`, since it reads a disk.
    - Without `sketch`: the report only. An AI looks at a file first (its layers, its size, its unit) and then places it.
    - With `sketch`: `addExternal` under `id` (by default the name of the file reduced to an ID, numbered while taken), with `x`, `y`, `turn`, `anchor`, `regions` as given. One undo step.
    - With `replace`: `updateExternal` of the entry `id` with the new curves, and the fields given; the answer has `revision`. A refusal by the rule of an update comes back as the refusal of the command, with its text.
    - The answer: the report; the entry and how its entities are named (`board/l1` … by the counts); the brief of the sketch after the command (status, valid, regions, open ends) and the features that are not ok; `next` in words. Never the curves.
- **`get_sketch`** gives an outline its own row (`OutlineDetail`): the fields with their expressions, the counts by kind, the box as placed, the first 50 curves at their places, `listed` and `total`, and with more curves the query that gives the rest. The points of an outline are not listed apart: each curve says where its points are, and their IDs follow from the curve's.
- **`get_document`** prints the text of `OUTLINE_OMITTED` in the place of the curves of an outline above 50; `save_document` writes them.
- **The query `entryCurves`** through the tool `query`, as every query.
- **`describe_api`**: `SketchOutline` and `OutlineCurve` from `types.ts`; the kind in the generated section "Entries of a sketch" by its `summary` and its `example` (a small outline written out, accepted by the test of the examples); a generated section "Outline formats" from `OUTLINE_FORMATS` (per format its summary and its options), as "Import formats" is generated; in the paragraph on reference geometry one sentence: an outline is placed by its fields, its entities are `<entry>/<local>`, and a revision keeps IDs by kind and order.
- **The advice of `get_sketch`** for open ends of an outline: `OUTLINE_OPEN_END`.

## Issue codes

None new. An outline has no warning of the recompute (it cannot fail). What a revision breaks is said by the codes that exist: `brokenProjection` with 6b's detail ("board has no circle o/c4"), `noProfile`, `brokenReference`. The refusals of an import are codes of its own outcome (`invalidArguments`, `unreadable`, `empty`, `tooLarge`), as those of `importMesh` are.

## What 6f needs of the packages before it

Each statement the merged designs make of 6f, against the code and this design.

| Where | What it says of 6f | Here |
|---|---|---|
| 6a, "The IDs" | An entry of several entities names them `<owner>/<local>` with the local IDs it stores | Kept |
| 6a, the same | "its curves name its points, so two curves of an outline share a vertex"; "shares its vertices by ID and needs no key" | **Changed**: points belong to their curve, ends join by position ("What 6f changes in 6a's vocabulary") |
| 6a, "The registry" | A kind whose entities live outside the sketch has to copy their list into its entry | Moot: the entities live in the entry |
| 6a, "The commands" | The third part of the rule of an update is written by the package that reaches it | Written here, for every kind |
| 6a, "The schema" | No upgrade step for 6b, 6c and 6f | Kept (the plan's later sentence on a section does not apply) |
| 6a, rows 9 and 18 of its table | The flag `regions`, default true, always stored | Kept |
| 6a, "What consumers accept" | The row of reference geometry | The row above; nothing differs from a projection of 6b |
| 6e, "Plug-in points" | `curvePredicates`: a reference with the flag forms regions; `sketchWorld`: 6f writes no code; an outline is as a flagged projection, never cut | Kept; `contactFix` needs the condition and the text above, which 6e's table does not list for 6f |
| 6c, "Other packages" | A line of an outline is an axis or a direction, a point a centre; no source; the ends join by position | Measured as said |
| 6c, `openEnds` and the advice | A flagged reference curve's open ends are listed; "ends of `e1`" for an entry that is not derived | Works for `o/l1` (the entry is found by the prefix); the cure's text is 6f's |
| 6b, "Where 6b meets 6d and 6f" | 6f reuses the forms `point` and `arc` of `Projected`, `exactArc`, the detail of a failure, `keepsValue`, the position stage, `inModel` | `exactArc`, `keepsValue`, the stage and `inModel`: yes. The forms `point` and `arc`: **no**, an outline's value is its own form (one value for the entry, not one per entity). The detail of a failure: not needed, nothing fails |
| 6b, the same | An outline's entities are projected like any entry's; `projectSketch` with `as: 'own'` draws an own outline over an import | Measured as said |
| 6d, "Other packages" | `C` is a spline of 4 points, `Q` of 3; a DXF `SPLINE` of degree 2 or 3 becomes `bsplineBeziers` pieces, degree 1 lines; rational and above 3 left out and listed; 6f decides what a spline of an outline is | As said. A spline of an outline is reference geometry: it forms regions and names a face; not projected, not constrained to, not cut |
| 6d, "Deferred" | "conics are refused by 6f" | Left out and listed, not refused: the rest of the file is read |
| 6d, "DXF and SVG" | Scenario 15 compares the areas of the section read back | Step 7; the allowance is 0.1 mm² (measured 0.014) |
| D55 | `ImportFormatSpec`, `ImportFailure`, `importFormatOf`, `importAccept`, `idFromFile` | Reused; the spec gets its second type parameter |
| D54 | The writers of DXF and SVG | Read back to the digit (A1, E1); nothing changes in them |

## What 6f changes in 6a's vocabulary

Rows for the table "Where later packages change the vocabulary" of [6a-sketch-prep/design.md](../6a-sketch-prep/design.md), added when 6f is merged (this package does not edit that file before):

> | 23 | "The IDs": the curves of an entry of several entities name its points, so two curves of an outline share a vertex as two own curves share a point; "An outline (6f) shares its vertices by ID and needs no key" | **The points of an outline belong to their curve** (`<entry>/<local>/a`, `/center`, `/start`, `/0`), as those of a projection do, and two curves that meet have two points at one place. The ends join by position in 6c's stage (answer 19), and the reader welds the ends of a file. A point named by its curve keeps its ID exactly when the curve does | 6f (D72) | In 6f's design, "Entities and their IDs" |
> | 24 | Part 1: the value of a reference kind is positions (`Projected`), one per entity or entry | **A value may be the parameters its geometry is computed from**: an outline stores its placement and the fingerprint of its curves, and `geometry` computes the positions from the entry and the value | 6f (D72) | In 6f's design, "The value, the stamp, the arcs" |
> | 25 | Part 1: every point and curve of a resolved reference entry enters the input of the solver, fixed | **A kind may say `narrow`**: the solver gets only the entities the constraints name, and the step merges the rest into the geometry after it | 6f (D72) | In 6f's design, "The solver gets what the constraints name" |
> | 26 | "The commands": `updateExternal` takes the entry whole | **A kind may say `partial`**: fields left out keep what the entry has | 6f (D72) | In 6f's design, "A revised file" |

(The numbers continue 6a's table as it stands at `c01e765`; whoever merges takes the next free ones.)

## Scenario 15

6f builds the scenario as one model (owner, answer 3; plan, "Who builds what"): `calls.ts`, run whole on the prototype (probes G and H).

| Step | What | By |
|---|---|---|
| 1 | The board from `board.dxf`, written by the test as a PCB tool writes an outline (separate `LINE`, `ARC` and `CIRCLE` entities on `Edge.Cuts`, page coordinates, six decimals, a courtyard and a text on other layers): imported with `layers: ['Edge.Cuts']`, placed with `anchor: 'center'` at (0, 0), extruded 1.6 from its region | 6f |
| 2, 3 | The skeleton projects `pcbo/a1` … `pcbo/c4`; the floor by `projectSketch` with `as: 'own'`; the rim; the standoffs | 6b's calls over the import |
| 4 | The lid: 6d's half with its spline flank, **held on projections of the board's sides** (12 beyond the right, 7 beyond the bottom and the top), mirrored by 6c | 6c, 6d; the hold is 6f's change, so that the lid follows the file |
| 5 | The two rows of vents; the second sketch placed from the projection of a copy, `m/1/c3` (6b's calls named the copied flank, a spline since 6d) | 6c, 6b |
| 6 | The rectangular notch of the floor (the rim bridges it: owner, answer 20); the round notch in the lid's source half | 6e, 6c, 6d |
| 7 | `vents` 7, 3, 5; **the revised file, 2 mm wider**: every feature ok, the board +128, the base +212, the lid +216 mm³, the holes 27.5 from the axis; the volumes of the board and the base by the query `mass` against the values by hand; the section of the lid as DXF read back with the area of the section within 0.1 mm² | 6f |

The stand-in board of 6a2 stays in the `describe` blocks of the earlier packages; the assembled model does not use it.

## Rejected alternatives

- **A section `outlines` of the document** with `addOutline` and `removeOutline`, as `meshes`. "The stored outline: in its entry"; Open, 1.
- **The curves as own geometry tied by `fixed`** (the plan rejected it for the cost of the analysis). The stronger reasons: 3000 own points in the solver (the memory, C4), nothing to revise as a whole, and the IDs of a file among the IDs of the sketch.
- **One entry per curve of the file.** 2000 entries, each validated, resolved and stamped apart, and a revision of 2000 commands.
- **Points shared between curves, with IDs of their own** (6a's first vocabulary). The numbering of vertices shifts with every vertex a revision adds, a vertex has no name a person can find, and the joins by position make sharing unnecessary.
- **IDs from the geometry** (a hash of a rounded position, so that an entity that did not move keeps its ID whatever the order). A board made wider would rename every entity that moved, which is the case the scenario asks to survive; and two revisions rounded apart by a digit would differ. The plan defers matching by geometry.
- **IDs from the handles of a DXF** (group 5). Stable in some tools and renumbered at every export in others; SVG has `id` only where an author wrote one. Not a rule a caller can rely on; a later option of the reader, not excluded.
- **The value as positions** (the forms of 6b, one per entity, or one large form). The document would hold every coordinate twice and the stamp would hash them at every solve.
- **The whole outline in the solver's input** (as every reference today). Measured: aborts.
- **The narrowing for every kind.** It would change the stamp of every stored sketch with a projection for nothing: their entries are a handful of points.
- **The flag per curve** (some curves of an outline bound regions, some do not). The choice of layers at the import and a second entry do it without a field per curve.
- **A placement on a point of the sketch or of reference geometry** (the plan's amendment allows the second). "The placement".
- **A mirrored placement or a scale.** The readers settle the unit; a mirror is a second field for a case no scenario has (a board seen from below is mirrored by its file's extrusion direction, which the reader reads).
- **The readers as entries of `IMPORT_FORMATS`.** Its type and every consumer of it mean a mesh.
- **`import_outline` answering with the batch** (the plan). Open, 2.
- **`get_sketch` with every curve, or with none.** 79,000 characters for 1000 curves; with none an AI could not constrain to anything without a second call even for a board of twelve curves.
- **A weld inside the sketch** (the position stage with a larger tolerance for outlines). Two tolerances of "the same place" in one profile; and the arcs would stay off their radius.
- **Welding by moving both ends to their middle.** The first end in the order of the file keeps its digits, so a file that needs no weld is not changed at all and the result does not depend on a traversal.
- **No weld, a refusal with advice.** The files that need it are ordinary (four decimals), and the cure is not in the caller's hands.
- **A library for DXF or SVG.** The plan says by hand; the subset is small (the two prototype readers are a few hundred lines each), and a library needs the owner's approval and a port.

## Known limits

- **IDs follow the order of the file.** A file whose tool lists entities in another order after an edit renames them without a warning: what named `c1` names another hole (B6). `outlineRevision` says only what came and went. The cure is in the model: constrain and project few entities of an outline, in one skeleton sketch.
- **A revision that drops a constrained entity is refused whole**; the caller removes the constraints first. Later features are not protected: they break aloud at the recompute.
- **The weld moves ends** by up to the tolerance (0.01 mm by default), the first in the file staying; a feature finer than the weld is closed up, and a line shorter than it is dropped. The report counts both.
- **Curves that cross or lie on each other in the file are not cut**: such an outline is an invalid profile, and `sketchContacts` lists the pairs. Cure: other layers, or the flag off and an own outline in a later sketch.
- **An outline is not cut in its own sketch.** A notch in an imported outline is own curves in a later sketch (6b's tool), or a second body cut from the first.
- **Cost**: a change in a sketch that holds an outline of 2000 curves with regions is 100 ms (the profile); 1000 curves 40 ms. The document grows by 70 characters a curve, and so does every saved file; undo shares the entry.
- **A region reference lists every curve of its outer loop**: an outline of 500 lines is 500 IDs in the extrusion that takes it, and its body has 500 side faces. As for any profile of that many curves.
- **Not read**: ellipses and elliptical arcs, rational and periodic splines, splines above degree 3 and those given by fit points alone, blocks, text, hatches, 3D polylines; in SVG also CSS, `use`, nested `svg`, uneven transforms. Each is listed in the report with a count, never silently.
- **A hidden SVG element is read**, and a filled shape is its outline.
- **A DXF without `$INSUNITS` is millimetres**, an SVG without a size 96 units per inch; the report says so, and warns of bounds under 1 mm or over 10 m.
- **The same outline in two sketches is stored twice** unless the second projects the first.
- **No placement that follows a body** except through parameters.
- **`get_sketch` and the query round positions** as everywhere; the exact numbers are in the document.

## To verify before the implementation

1. **A DXF of a real PCB tool and of a real CAD tool** (the owner has `robot-joint-parts-schemas/` only in the main tree; any exported board outline does): that the entities, the layer names, the units and the digits are what the reader expects. The test file is written from knowledge.
2. **An SVG of a real drawing program**, with its layers as groups.
3. **The narrowing inside the engine** against the emulation at the port (F1): the same results, and the stamps of the stored sketches of the repository's tests unchanged.
4. **The memory of the solver with the narrowed input** over a long session (F1 ran 600 drags).
5. **`partial` with expressions**: an update that leaves `turn` out keeps its expression; one that gives a number drops it (the reader of 6c's fields does; not run for an entry laid over another).
6. **The validator returning the given object of `curves`**, so the caches by object hold across `load` and commands.
7. **The third part of the rule in a batch**: `removeConstraint` and `updateExternal` in one batch pass; the other order does not.
8. **The app's snapshots**: that only the button changes them.
9. **A DXF with CR-only line ends and with a byte-order mark.**

## Tests the implementation owes

- **The kind** (`packages/engine/test/outline.test.ts`): the validator's refusals, each text of `OUTLINE_REFUSALS`; the defaults; the entities and `entityOf` of every form of ID; the placement (both anchors, a turn, a turn of 0 moving no digit); the geometry and `exactArc`; the value and the stamp (the flag and the name do not change it; a curve or the place does); a closed spline; `load` of a saved document with an outline; an older form of `Projected` still read.
- **The update**: `partial` (each field alone; expressions kept); the three parts of the rule, the third for an edge and a projection as not reachable; a revision with kept, added and removed entities; a later projection frozen.
- **The narrowed input**: the solver's input for no, one and several named entities; a reference dimension; the result equal to the whole input for outlines small enough to compare; 2000 curves and repeated solves; the stamps of the existing tests untouched.
- **6e, 6c, 6b, 6d over an outline** (`review.test.ts` of the scenarios where a defect was measured): the contact of an own curve with a flagged outline (reason, split refused, ends not listed); the flag off, then a trim with `with`; a mixed loop; a mirror about a line of an outline; projections of each kind of entity and of a control point; a spline's projection refused with 6d's text; the whole-sketch tool; `as: 'own'`; a hole on a centre refused.
- **The import**: the engine's DXF and SVG read back (the round trip to the digit); every entity type and both polyline forms; bulges of both signs and a closed polyline; the units; the layers; the weld by digits (A3) and the exact arcs (A4); `empty`, `tooLarge`, `unreadable` (binary, cut short, not a DXF); the report's fields; the same bytes giving the same IDs; `SPLINE` of degree 1, 2, 3 and each reason of leaving one out; the extrusion direction.
- **SVG**: each element and path command, relative forms, the flags without separators, the transforms and a reflection, the units, the layers, each thing left out.
- **The typed tables** of the formats and of the query in `packages/mcp/test`.
- **MCP**: the tool without a sketch, with one, with `replace`; `get_sketch` of a small and of a large outline; `get_document`; the examples of `describe_api` accepted.
- **The app**: the draft and *Place* in `app.test.ts` (a record of its own), the row, *Replace file…*.
- **Scenario 15**: the `describe` of 6f and the assembled model, as `calls.ts`.

## Open

1. **Where the outline is stored.** The plan says "stored in the document (like a stored mesh of D55)" and expects a section with a schema step. This design stores the curves in the entry that places them: one place, no step, `entityOf` from the sketch by construction, the update of the entry as the revision. *Recommendation: in the entry.* What a section would give, one outline placed in several sketches, a projection gives already.
2. **What `import_outline` does.** The plan says it "answers with the batch". This design has it send the command (and only report without a sketch), because the batch would carry every curve to the caller and back, up to 140,000 characters each way. *Recommendation: it sends the command.* The cost: the tool changes the document, where `import_mesh` leaves the placing to the caller; it is one undo step and the answer says what it did.

## Reviews

None yet. The design was written with prototypes of the kind and of both readers run against the real engine and adapters ("Measured"); the parts no prototype ran are listed in the recipe there, and are where a review should look first: the narrowing inside the engine, the third part of the rule, `partial`, the query, the tool, the app.

## Rows for the indexes

Not written by this package's branch before the merge; the texts for whoever merges.

**docs/d36/README.md**, the row of 6f, column "Design now":

> full ([6f-outline-import/design.md](6f-outline-import/design.md), D72), designed 2026-11-25 with prototypes against the real engine: a reference kind of entry of `external`, `outline`, holding the curves of a file in the entry (no section, no schema step) and placed by the numeric fields `x`, `y`, `turn` and an anchor (origin of the file or centre of its box); entities `<entry>/<local>` numbered by kind in the order of the file; the flag `regions`, default true; a revision is `updateExternal` with the new curves, refused while a constraint names an entity that goes; the solver gets only the entities the constraints name; a second catalog `OUTLINE_FORMATS` (`dxf`, `svg`) with a weld of ends; the tool `import_outline`, the query `entryCurves`; scenario 15 assembled

**docs/decisions.md**, the row of D72:

> | D72 | [6f Import of an outline](d36/6f-outline-import/design.md) | designed 2026-11-25; not reviewed, not implemented | An imported outline is a reference kind of entry of `external`, `outline`: the curves of a DXF or SVG file (lines, arcs, circles, splines) stored in the entry in the file's coordinates and placed by three numeric fields and an anchor; fixed for the solver, which gets only the entities constraints name; entities `<entry>/<local>` with points named by their curve, IDs by kind and order of the file; regions by a flag, default true, ends joined by position; a revised file is an update of the entry, refused while a constraint names an entity it drops; hand-written readers in a second catalog of formats with a weld (0.01 mm) and a report; the MCP tool `import_outline` sends the command; no schema step. Alternatives: a section of the document, own geometry tied by `fixed`, IDs from geometry, the whole outline in the solver |

**docs/requirements.md**, validation scenario 15, the sub-item after the one of 6d:

> - *The board from a file, and the whole (6f, D72).* The board is imported from a DXF written as a PCB tool writes an outline (the layer `Edge.Cuts` of three, page coordinates), placed by the centre of its box on the origin and extruded from its region; the skeleton, the base, the lid (held on projections of the board's sides), the vents and both notches are built on it in one document. `vents` 7, 3 and 5; a revised file 2 mm wider replaces the outline and no feature is in error (the board +128, the base +212, the lid +216 mm³; the hole pair 27.5 mm from the axis); the volumes of the board and the base against the values by hand; the section of the lid exported as DXF and read back has the section's area within 0.1 mm².

**docs/architecture.md**, the list of sections: in the row of `architecture/sketch.md` add "an imported outline (D72)"; in the row of `architecture/api.md` add "`importOutline` and the outline formats"; in the row of `architecture/ai.md` add "`import_outline`".

**docs/ui.md**, the row of the sketch panel: add "*Import an outline…*, the row of an outline with *Replace file…* (D72)".

**docs/backlog.md**, new rows: an own outline over an import in the same sketch by a tool (with 6b's row on a projection taken over); a placement of an outline on a point of reference geometry; a mirrored placement; matching a revised outline by geometry or by the handles of its file; ellipses, rational and periodic splines; blocks of a DXF and `use` of an SVG.

# 6f Import of an outline (D72)

**State: designed 2026-11-25 on Fable, with prototypes run against the real engine and adapters; reviewed the same day by three independent reviewers (Fable with probes, `codex`, `agy`) and revised ("Reviews"); not implemented.** The text is written against `master` at `c01e765` (schema version 10), where every package before 6f in the sequence of step 6 is implemented and merged: 6a (D64), 6a2 (D71), 6e (D65), 6c (D68), 6b (D69) and 6d (D70) ([6-plan.md](../6-plan.md)). It reads their code, not their first designs; "What 6f needs of the packages before it" checks each thing their designs say of 6f against the code.

Files: [contract.ts](contract.ts) (the entry, the stored value, what the registry gains, the import and its two formats, what 6f adds to the packages before it, the query, MCP, the app), [calls.ts](calls.ts) (validation scenario 15 as one model, and the cases of 6f), [probes/](probes/) (the prototypes behind "Measured", kept so that every number can be run again).

The package in short:

1. **A reference kind of entry of `external`, `outline`**: the curves of a drawing (lines, arcs, circles, splines) stored **in the entry**, in the coordinates of their file, and placed in the sketch by three numeric fields (`x`, `y`, `turn`) and an anchor (the origin of the file, or the centre of its box). Fixed for the solver, so constraints may name its entities and a later sketch may project them.
2. **Entities `<entry>/<local>`** (a curve, `board/l3`) with points named as an own curve names them (`board/l3/a`, `board/a1/center`, `board/s1/0`). The readers number the curves by kind in the order of the file: `l1`, `a1`, `c1`, `s1`.
3. **The flag `regions`, default true** (owner, answer 2): the curves bound regions, their ends join by position in 6c's stage (no code of 6f's), and they name side faces. With the flag off the outline is reference only.
4. **A revised file is `updateExternal` with the new curves**; an entity keeps its ID when the file lists it at the same place among the curves of its kind, and the entry stores what the file was read with (`source`: the layers, the unit, the weld), which a replacement repeats. An update that takes away an entity a constraint names is refused (the third part of 6a's rule of an update, which is 6f's to write: without it the document that results does not load, measured).
5. **The stored value is the placement and a fingerprint**, not positions: the document holds every coordinate once. `Projected` stays positions; what `solved.external` holds is `StoredValue`, either.
6. **The solver gets of an outline only what the constraints name**, as it gets the axes of the origin: with a whole outline of 2000 curves in its input the adapter runs out of memory (measured). The points and the radii it did not get are put back after it, on every path of the step. The adapter takes two fixed points at one place for one end, so a tangency at a corner of an outline is solved as one.
7. **The import**: a second catalog of formats, `OUTLINE_FORMATS` (`dxf`, then `svg`), beside `IMPORT_FORMATS`; the function `importOutline` with what every format shares: the IDs, a weld of the open ends that a file with few digits leaves apart, **bounded** (no end and no arc moves further than the tolerance, nothing is merged in a chain), the limits (characters, curves and control points read; 2000 curves and 2000 control points of splines in an outline), a report. A file that is not whole is refused; what a reader does not read is listed. Hand-written readers, no library.
8. **The MCP tool `import_outline`** reads a path, as `import_mesh` does, and sends the command itself (the curves never pass through the caller); without a sketch it only reports; with `replace` it reads the file as the entry was read, and with `remove` it takes the constraints that hold a revision back out in the same batch. `get_sketch` lists an outline and its regions short, and a query `entryCurves` pages through the rest. The app has *Import an outline…* in the panel of a sketch.
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
| DXF: "`LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE` and `POLYLINE`/`VERTEX` with bulges, `SPLINE` as a spline of 6d when it is cubic and not rational" | As listed, with degree 1 to 3. 6d's `bsplineBeziers` (`spline.ts`) asks for clamped knots in order and checks neither, so the reader does, before it; a periodic spline is left out and listed. A cubic with even knots is one spline of the sketch; any other is its Bezier pieces, each a spline (measured) |
| "The engine writes DXF already (D54), so the reader is tested on the writer's files" | The writer (`export/dxf.ts`) writes release 12: `POLYLINE`, `VERTEX`, `SEQEND` with bulges, `CIRCLE`, layers `OUTER` and `HOLES`, `$INSUNITS` 4. Read back, the section of the board gives a body of the board's volume to the last digit (measured) |
| "From knowledge, not checked: PCB tools export the board outline as DXF with lines, arcs and circles" | Still not checked against a file of a PCB tool; the test file is written by the test in that form ("To verify") |
| SVG: the subset listed | Prototyped (`probes/svg.ts`, with a tokenizer of its own since the review); the engine's own SVG (D54) read back gives the curves of its DXF within 3e-10 mm |
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
- **The adapter knows a common end of a line and an arc by their IDs or by a coincident** (`commonEnd`, `packages/solver-planegcs/src/index.ts`). The end of a line of an outline and the start of the arc beside it are two IDs at one place, as those of two projections of 6b are. An own line held on the one and tangent to the other curve is solved in the general form at its double root: the far end 4e-5 mm off the tangent, and it does not follow a drag (measured, J10; the review, agy 7).
- **6c's stage counts an end as open when no other curve ends there** (`positionJoins`), so a closed spline of an outline, whose two ends are one point, bounds its region and is listed in `openEnds` with the distance 0 (measured, J9; the review, codex 12).
- **`get_sketch` lists every region with its whole outer loop** (`regionRows`), and `get_document { feature }` returns the feature as it is, past `documentShown` (the reviews, fable 4 and codex 14: 33,841 characters of regions for 1000 curves).
- **The pickers of the app limit a derived entry only** (`PICKER_LIMIT`, `packages/app/src/references/index.ts`): an outline of 2000 curves would be 5000 options.
- **`extend` looks for a spline in its way among own curves only** (`reachOf`, `extendSpec`: `world.sketch.curves[C]`), and `contactFix` asks for a spline before it asks for a flagged curve; the names a cut collects walk every entry of `external` (`namedOutside`). All three read in the code (the review, agy 11 and 13).
- **The names `OutlineCurve`, `Outline`, `export/outline.ts` and `packages/engine/test/outline.test.ts` are taken** (a curve of a closed loop of the profile, and the exported section). The curve of an import is `ImportedCurve`.

## The cheap variant

What the plan asks, with these choices:

- The curves live in the entry; one entry is one file (or the chosen layers of one); the same file in two sketches is two entries, or one entry and projections of it.
- The placement is three numbers and an anchor. No mirror, no scale: the unit is the reader's.
- A revision keeps IDs by kind and order; nothing is matched by geometry.
- An outline is never cut and never copied by a pattern; where it has to be cut, it is drawn as own curves in a later sketch (6b's tool).
- The readers take the listed subset and say what they left out; nothing is repaired but ends that nearly meet.

**Deferred**: STEP and other exact formats, text, matching a revision by geometry (the plan's list); a placement on a point of reference geometry; a mirrored placement; an own outline drawn over an import in the same sketch by a tool (a later sketch does it; a backlog row with 6b's "an existing projection taken over as own curves"); periodic and rational splines (a periodic one could be read by clamping it first, which gives the curve exactly: the review's probe; a backlog row), splines of a degree above 3, ellipses and elliptical arcs; blocks of a DXF (`INSERT`), nested `svg` and `use`; CSS of an SVG (a hidden element is read); a file kept linked to its path (the document stores the curves, not where they came from); an outline from a face of an imported mesh.

## Measured

**Recipe.** `npx vitest run --config docs/d36/6f-outline-import/probes/vitest.config.ts` from the root of the repository (one file: add its path), against the real engine, the real planegcs adapter and the real manifold kernel; 58 cases in 12 files, about 80 s. The numbers go to the console. The prototype holds the kind, put into `REFERENCE_KINDS` at run time, the weld and the IDs (`probes/proto.ts`), the reader of DXF (`probes/dxf.ts`) and the reader of the SVG subset (`probes/svg.ts`); `probes/cover.ts` the cover of scenario 15 over the imported board. The reader of stored values (`projected`, `references/spec.ts`) is mocked to take the form of an outline's value. What the prototype does not have: the solver's input narrowed inside the engine (probe F emulates it at the port: a solver that takes the unnamed fixed geometry out, solves, and puts the positions and the radii back; the review built it inside the engine, rows R below), the third part of the rule of an update, the partial update, the fixed join of the adapter, the condition of 6c's stage, the texts of 6e's reasons, the stored `source`, the query, MCP, the app. Timings are of one machine and one file run alone, to compare with each other; under the whole set they are about twice as long. **They are measurements of these files, not bounds**: the cost of an outline follows what it holds (rows C and J12).

The weld, the validator and the readers of the prototype were rewritten after the review; rows A3, A4, D5 and H4 are of the revised prototype, rows I, S and J are new, and rows R are the review's own probes (Fable; its files are not in the repository, its numbers are quoted from its report).

| | What | Result |
|---|---|---|
| A1 | The section of the stand-in board (60 × 40, corners of 3, four holes) exported by the engine as DXF, read back | 1230 characters, read and welded in 1.5 ms: 4 lines, 8 arcs (the writer divides a quarter turn in two), 4 circles; nothing welded. In a sketch: valid, one region of twelve curves with four holes and the four discs; the region with its holes 2360.239393 mm² against the section's 2360.239396; extruded 1.6: **3776.383089761619 mm³, the board's volume to the last digit**; side faces `{ role: 'side', curve: 'o/a1' }` |
| A2 | A plate with a spline side, its section as DXF (the spline is a polyline of the mesh), read back | 67 lines, one region whose outer loop names 67 curves, its area 6e-10 mm² from the section's; `addExternal` 5.6 ms; the entry 5472 characters; `solved.external` is `{ kind: 'outline', at: [0, 0], turn: 0, data: '69d59c1c2302629a' }` |
| A3 | A board as a PCB tool writes it (separate `LINE` and `ARC` entities), turned by 17° so that no coordinate is round, written with 9, 6, 4, 3, 2 decimals: how far apart the ends of neighbours are | 9.1e-10, 9.3e-7, 8.7e-5, 8.9e-4, 7.2e-3 mm |
| A3 | The same files with a weld of 1e-6, 1e-3, 1e-2 mm | 9 and 6 decimals close with any; 4 and 3 decimals: **16 open ends and no outline region** with 1e-6, closed with 1e-3; 2 decimals: open with 1e-3 (the report lists 16 gaps, the nearest 0.0031 mm), closed with 1e-2. Each time 8 ends are moved, the ends of the lines onto the ends of the arcs, by at most 8.7e-5, 8.9e-4 and 7.2e-3 mm. The area after the weld: 2392.156, 2392.125 and 2391.902 against 2392.158 |
| A4 | After a weld that moved ends by up to 8.9e-4 mm: how far the two ends of an arc are off one radius; an own point held on such an arc and an own line tangent to it | the arcs are those of the file (no end of an arc moved): 1.3e-14 mm stored and 1.3e-15 placed for nine decimals, 0 for four and three (a turn of 0 and of 0.3 rad); solved, no redundancy, every time |
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
| D5 | A DXF in inches with a `LINE`, a cubic `SPLINE` of three spans, a rational `SPLINE` and an `ELLIPSE` | scaled by 25.4; the spline has even knots and is one spline of six control points (`s1`), which closes with the line into one region, extruded (10,167.30 mm³, as its three Bezier pieces gave before the review), one spline side face; the other two in `skipped`. A point on `o/s1` is refused by the catalog; a projection of it by "is a spline, expected line"; the whole sketch projected takes the line and leaves the spline out |
| D6 | A hole feature at `o/c1/center`; the disc of `o/c1` cut again | refused ("is projected geometry; an own point … is expected"); ok |
| D7 | The board of two decimals read with a weld of 0.001 | the report: 16 gaps, the nearest 0.00308 mm; `openEnds` of the sketch: 16, `apart`, 0.00308 |
| D8 | The same curves in two entries of one sketch: side by side; on each other | 10 regions; invalid, twelve pairs in `lying` of `sketchContacts` |
| E1 | The engine's SVG (D54) of the board's section read back, against its DXF read back | the same sixteen curves under the same IDs, the numbers within 3.1e-10 mm; "1 mm per unit"; valid, five regions |
| E2 | A drawing as a drawing program writes one: 100 mm × 50 mm over a viewBox of 200 × 100, groups with `translate`, `rotate` about a point and `scale`, a rect with round corners, a circle, paths with relative commands, `C`, `Q` and arcs, an ellipse, an elliptical arc, a text on another layer | 0.5 mm per unit; the layers `cut` (7) and `engrave` (2); of `cut`: 8 lines, 6 arcs, a circle and 2 splines (four and three control points); the ellipse and the path with the elliptical arc in `skipped`; five regions, the rounded rect (40 × 20, corners of 3: the first arc `center [47, −8]`, from `[50, −8]` to `[47, −5]`) with the disc and the lens as its holes |
| G1 | The lid of 6d's calls over the import: its half held 12 beyond the projected right side of the board and 7 beyond its bottom and top, mirrored about `origin/y` | 0 degrees of freedom, no redundancy, one region with 6c's names; 8871.81 mm³ against 8872.28 by hand (6d's number on the stand-in) |
| H1 | Scenario 15 as one model, 17 features: the two rows of vents (the second sketch placed from the projection of a copy, `m/1/c3`) | every feature ok; the lid 8531.72 and 8395.68 against 8531.59 and 8395.32 by hand |
| H2 | The rectangular notch of the floor: three lines across the bottom side of its own outline, three trims | `invalidProfile`, then one region, the base patched in the first batch; the sketch 0 degrees of freedom, no redundancy; the base 7755.04 (80.00 less) |
| H3 | The round notch in the top line of the lid's source half | the lid keeps one region through both splines and both notch arcs; the second trim lists it in `dropped`, as in 6d's test; 8295.46 against 8294.79 by hand |
| H4 | `vents` 7, 3, 5, each executed | −136.04 (by hand −136.27); `noProfile` naming the region of copy 3, the feature of the cut as it was; 5 after it: every feature ok, the lid back to the digit, the cut as it was |
| H5 | **The revised file of the board, 2 mm wider, in that model** | **every feature ok** in 175 ms: the board +128.000, the base +212.000, the lid +216.000 mm³; the holes 27.5 and 27.5; the floor's sketch still determined |
| H5 | The section of the lid as DXF, read back | 8 loops; 96 lines and 40 arcs, nothing welded; 8 regions; the region of the outer loop with its seven holes 4255.743 mm² against the section's 4255.729 (the section's area is of the mesh, the region's of the arcs divided again within the chord tolerance) |
| H6 | A quarter turn of the board in that model | `baseSk` and `lidSketch` are not solved (a warning each): the notch of the floor and the lid are dimensioned from the axes of their sketches, which do not turn with the board. On the model of B3 (the board, the skeleton, the base) the turn is followed |
| I1 | DXF, the groups: blank lines and text after `EOF`; a file cut short; a code without its value; an empty number | read; refused, "the file is cut short: no EOF"; refused with the line; refused with the line |
| I3 | A closed outline of a 2D `POLYLINE` and an `ARC` drawn from below (230 = −1) and a `LINE` | the first two mirrored, the bulges negated, the line as it is: every end has one partner within 1e-9 mm |
| I4, I5 | A spline-fit `POLYLINE` (4 frame vertices, 5 curve vertices); `ARC` from 0 to 360, 10 to 370, 45 to 45, 0 to 359.9999999999; 0 to 359.9 | 4 lines; circles; an arc (the weld then reads it as a circle, J3) |
| I6 | `SPLINE` knots out of order (`… 0.8, 0.2 …`): given to `bsplineBeziers` as they are; through the reader. Knots 1 and 1 + 1e-12 | four finite pieces and no word; refused, "knots are out of order (0.8, then 0.2)". Two pieces after the knots are merged; three without it, the middle one 2e-12 mm long |
| I6b | A cubic of 7 control points with even knots, kept as one spline, against its Bezier pieces; with uneven knots, a spline of the sketch over the same control points against the curve of the file | 0 mm; 0.884 mm, so it is split into 4 pieces. Whole for 4 to 64 control points (65: 62 pieces); a quadratic of 3 points whole, of 5 in 3 pieces |
| I7 | `$INSUNITS` 13, 14, 9; 3; none with `$MEASUREMENT` 0 | 1000 units 1 mm, 100,000 mm, 25.4 mm; refused naming the option `unit`; read in mm with the note |
| I8 | 8000 lines; 9000; 150,000 (5.9 million characters); more than 8 million characters; a `SPLINE` of 2001 control points | read in 27 ms; `tooLarge` in 19 ms; in 242 ms (the groups of the whole text are parsed first); in 0.06 ms; `tooLarge` |
| S1, S2 | SVG path data: `M0 0 L1e1 0 L10 10 Z`; `M.5.5l1-2 2.5E-1,1e0z`; arcs with their flags unseparated (`a25,25 0 0150,-25`, `A 10 10 0 01 20 10`, `… 0 1120 10`) | three lines each; the arc of the spaced form (centre (75, −37.5)); centre (10, −10) and a quarter turn; three quarters |
| S3 | An arc with equal ends; a radius of 0; a radius of 1 over a chord of 8 | no segment; a line; the radius raised to 4 |
| S4 | Lengths with units, no `viewBox`: `r="10mm"`, `cx="1in"`, `72pt`, `6pc`; `r="50%"`, `width="2em"`; `r="ten"` | 10 mm, 25.4, 25.4, 25.4; listed as "circle (length in %)" and "rect (length in em)"; refused. With a `viewBox` of 1 mm per unit `r="10mm"` is 37.795 mm: a length with a unit is user units at 96 per inch, the rule of SVG |
| S5 | 19 files that are not whole: the review's `<svg><circle r="10"/><path d="M0 0 L`, tags that do not match, no `</svg>`, an attribute without quotes, a stray `<`, a `DOCTYPE` with a subset, an unknown entity, five errors of path data | each refused as `unreadable` with the place |
| S6, S7 | `S` and `T` against the explicit `C` and `Q`; an `ellipse` of equal radii; of two | the same control points; a circle; listed |
| S8 | `scale(2,1)` and `skewX(30)` over a circle, a path with an arc, a rounded rect; over a polygon, a spline, a plain rect, a line; `scale(-1,1)` over an arc | listed as "(uneven transform)"; read; a counter-clockwise quarter arc with its ends swapped, both on one radius |
| S9 | A path of 8000 lines; of 8001; 8 million characters | read in 11 ms; `tooLarge` in 10 ms; refused at once |
| J1 | The weld on a square with one corner of radius 0.5 drawn as 200 lines of 0.0039 mm (the review's case: the weld of the first design made it 4 curves and moved an end 0.71 mm) | nothing welded: 204 curves, one region |
| J2 | Ends of three lines at x = 0, 0.009 and 0.018, weld 0.01 | the second on the first (moved 0.009); the third would have to go 0.018: not welded, `blocked` 1, in `gaps` |
| J3 | A hole written as `ARC` 0° to 359.9° (ends 0.0028 mm apart) inside a square; to 359°; the first with a line ending on each of its ends | a circle (`closed` 1), the square with one hole; an arc with two open ends; an arc (a key hole) |
| J4 | An arc of radius 1000 and nearly a whole turn; a line, then an arc of radius 30, ending 0.009 mm from its end (the review's case: the first design made the radius 911.9) | the line's end moved 0.0085, the arc untouched; the smaller arc moved, its radius 30.0000005, its centre 7e-7; the large arc untouched. One weld blocked each time |
| J5 | Two quarter arcs of radius 10 that miss each other by 0.0007, 0.005, 0.02 | the later re-centred: its centre moved 2.5e-4 and 1.8e-3, its radius 10.000175 and 10.001251, its ends on one radius within 2e-15; 0.02: not welded |
| J6 | The bottom side of a square a second time, the other way round; a hole twice | `duplicates` 2, their IDs unused (the outline holds `l1` to `l4` and `c1`); valid, two regions (before: invalid, no region, nothing in the report) |
| J7 | Curves under the keys `__proto__` (from parsed JSON), `constructor`, `toString` | refused, each (before: `__proto__` accepted and the entry stored with no curve) |
| J8 | The object of `curves` given, then written into by the caller; after `addPoint`; after a switch of the flag | the document holds a copy and keeps `[0, 0]`; the same object of the document both times, the stamp kept |
| J9 | A closed spline of an outline alone | valid, one region `[o/s1]`; `openEnds` 1: `o/s1/0`, `apart`, distance 0, no near end |
| J10 | An own line from the corner of the board, tangent to the corner arc `pcbo/a1`: its start coincident with `pcbo/a1/start`; with `pcbo/l1/b`, the same place | exact (the far end at y = −20), one degree of freedom, a drag slides it; **the far end 3.7e-5 mm off, and a drag does not move it** (no conflict, no redundancy reported) |
| J11 | `outlineRevision` of the board against itself with two holes swapped; against the wider file | `renamed` `c1` was `c2`, `c2` was `c1`; nothing renamed, 12 kept |
| J12 | Outlines of splines in one closed chain, with the narrowing emulated: 500 of 4 control points; 2000 of 4; 31 of 64; 125 of 64 | `addExternal` 115, 411, 118, 651 ms; a change in the sketch 68, 442, 110, 716 ms (5 to 33 ms with the flag off); the loop of the region 13,000, 52,000, 25,203, 101,625 points; the entry 96, 387, 79, 319 thousand characters. 2000 of 64 without the narrowing: the step throws (the spread of 128,000 keys in `solverSetup`) |
| R1 | **The review's probe**: the narrowing built inside the engine (over `resolveReferences`, `solverSetup`, `stepBase`) against the whole input, on twelve curves with `coincident`, `pointOnCurve`, `tangent`, `equalRadius`, `parallel`, a driving distance and three reference dimensions; a drag; a conflict; a mixed loop | equal: every point and radius, the degrees of freedom, `conflicting`, `redundant`, the measurements, the regions, `openEnds`, the whole `diagnoseSketch`; only the order of the keys of `points` differs. The stamps of sketches without an outline identical. 2000 curves: 300 drags, 94 ms each, the solver had 6 points; saved and loaded |
| R3, R4 | The review's probes: the build before 6f given a document with an outline; a mirror about `o/l2`, then an update without `l2` | refused twice, by the entry and by the stored value; accepted, the warning `brokenCopies`, the document loads |
| R6, R8 | The review's probes: `partial` as the entry's input with the command laid over it; the object of `curves` through `addPoint`, `dragPoint`, `setParameter`, `setField`, an extrusion, `renameParameter` | expressions stay (one whose parameter is gone too), a number given drops its expression; the same object every time, so the undo stack shares it. Two `stableStringify` of 2000 curves: 6.4 ms |
| R7, R9 | The review's probes: `get_sketch` of an outline of 1000 curves, its `regions`; `get_document { feature }`; the scenario's file replaced with every layer | 33,841 characters; 72,666; `l1 … c4 l5 l6`, two open ends in the board's sketch |

What the numbers decide:

- **The reader welds** (A3): a file of four decimals, which is what a drawing has when its units are written to a tenth of a micron, does not close without it. The default is 0.01 mm: it closes every file down to two decimals of a millimetre and four of an inch.
- **The weld is bounded, and touches only what is open** (J1 to J5): an end that another curve meets within 1e-6 mm is never moved, so a file that closes is not changed, however short its curves; an open end goes onto one other end, never further than the tolerance from where the file had it; a chain is not followed. That is what makes 0.01 mm a safe default: it is not a claim about how short the curves of an outline are. What it could not close is counted and listed.
- **An end of a line goes to the end of an arc, not the other way** (A3, A4, J4): arcs keep the digits of their file, and only where two arcs meet is one re-centred, within the tolerance or not at all (J5).
- **An arc of nearly a whole turn is a circle** (J3), and a curve twice in a file is read once (J6): both are ordinary in drawings, and both gave an invalid or a wrong profile without a word.
- **The solver gets what the constraints name** (C2 to C4, F1, R1): not for the time (14 ms of 60) but for the memory, which is not ours to bound: the same input solved or aborted by what the adapter had solved before. Built inside the engine by the review, it gives the results of the whole input.
- **The limits are 2000 curves and 2000 control points of splines** (C1, F1, J12): a spline costs by its samples. 2000 lines and circles are 120 ms to place and 100 ms for every change in that sketch while they form regions; 500 splines of four points 115 and 68 ms; 31 splines of 64 points 118 and 110 ms; with the flag off 5 to 17 ms. Without the second limit 2000 splines would be 440 ms a change. Above 500 curves the report of an import says what a change in the sketch will cost and that a later sketch, which projects what it needs, costs nothing of it.
- **A reader refuses early** (I8, S9): by the characters, the curves and the control points it has read, before any weld.
- **The value is the placement and a fingerprint** (A2, B1): 80 characters, whatever the outline.
- **`get_sketch` lists fifty curves and fifty regions** (C1, R7): 4000 characters of curves; the whole of 1000 curves would be 79,000, and their regions 34,000 more.
- **The update needs its rule** (B5): today a legal command leaves a document that does not load.
- **The anchor `center` is what "symmetric about the axes" asks for** (B1, B3): the page coordinates of the file do not reach the model, and the revised board stays on the axes.
- **The adapter has to know that two fixed points at one place are one end** (J10), or the corner an own line is most likely to start from gives a tangency that is 4e-5 mm off and stiff.
- **The packages before need four conditions and three texts** (B2, B4, D1 to D4, G1, H1 to H5, J9, J10): nothing of 6b's kind or tool; in 6c's stage a closed curve; in 6e's module the order of two questions and where a spline is looked for.

## Decisions

### The stored outline: in its entry

The curves of an outline are a field of its entry, `external.<id>.curves`, and nowhere else.

- **Why not a section** (`outlines`, as `meshes` of D55, which the plan sketched). 6a requires that `entityOf` answers from the sketch alone. With the curves in a section, every entry that places an outline would hold a copy of the list of its entities, kept equal to the section by every command that touches either: `addOutline`, `removeOutline`, a replacement that reaches into every sketch that places it, a check on `load`, and the rule of a constrained entity asked across the sketches of the document. A section also needs a schema step. The gain would be one outline placed in several sketches, which a projection from the sketch that holds it gives already, with one place to revise.
- **What it costs**: the entry is as large as the file (823 characters for the board, 140,000 for 2000 curves). Every command that changes the sketch makes a new sketch object and shares the entry's; undo shares it too. `get_document` leaves the curves of a large outline out, as it leaves out the data of a stored mesh.
- **Size limits**: 1 to 2000 curves; a spline 3 to 64 control points (6d's limit), the splines of an outline 2000 together; positions finite. An import beyond a limit is `tooLarge`, an entry beyond one an invalid command. The limits bound what the measurements cover; they are not a promise of a time.
- **A local ID** is letters, digits and underscores, at most 32, and no name every object has (`__proto__`, `constructor`, `toString`: the rule of `newId`, `validation.ts`). Measured before the rule: a record parsed from JSON with the key `__proto__` was accepted and stored with no curve. The look-up of a curve by its local ID asks for an own property.
- **The form**: `curves: Record<local ID, OutlineCurve>`, in the order the reader made them; an `ImportedCurve` is a line (`a`, `b`), a circle (`center`, `radius`), an arc (`center`, `start`, `end`, counter-clockwise) or a spline (`points`, the control points of a spline of 6d), with positions `[x, y]` in millimetres in the coordinates of the file. A position is a number, never a field: an expression there is an invalid command.

### The entry `outline`

```ts
interface SketchOutline {
  type: 'outline';
  name?: string;                        // of the file, for people
  source?: { format; layers?; unit?; weld? };  // what the file was read with
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
- **`source`** is what the import was made with: the key of the format and the options as given. The IDs of an outline depend on the layers chosen, and its size on the unit, so a replacement has to read the revised file as the first was read; stored nowhere, they were forgotten, and the scenario's own file replaced with every layer gained two lines and two open ends (the review, fable 3 and codex 8; R9). Optional: an entry written by hand has none. Checked by its form only; a field of a new kind, so no question of the schema.

### Entities and their IDs

| Curve of the entry `o` | Entities |
|---|---|
| a line `l3` | `o/l3` (line), `o/l3/a`, `o/l3/b` |
| a circle `c1` | `o/c1` (circle), `o/c1/center` |
| an arc `a2` | `o/a2` (arc), `o/a2/center`, `o/a2/start`, `o/a2/end` |
| a spline `s1` of n control points | `o/s1` (spline), `o/s1/0` … `o/s1/<n − 1>`; a closed one lists its first point once |

- **The entry itself is no entity** (as the entry of a mirror is none): `o` names nothing a constraint could take.
- **Points belong to their curve**, named as 6b's projection names them (`<curve>/<name>`), and two curves that meet have two points at one place. This leaves 6a's vocabulary, which gave an outline points of its own that its curves share ("What 6f changes in 6a's vocabulary"). Since answer 19 the ends of curves that are not own join by position anyway, so shared IDs would close nothing more; and a point named by its curve keeps its ID exactly when the curve does, where a numbering of the vertices of a file would shift with every vertex added.  What it costs is one case of the solver, a tangency at a corner, cured in the adapter ("A tangency at a corner").
- **The local IDs are the reader's**: `l<n>`, `a<n>`, `c<n>`, `s<n>`, each kind counted from 1 in the order of the file, after the choice of layers and **before the weld**: a curve the weld leaves out (one with no extent, one that lies on another) leaves its number unused and renames nothing, and the IDs do not depend on the weld (the review, fable 3). A polyline is its segments, counted with the rest. By kind, so that a hole added to a board moves no line and no arc, and the kind of an ID never changes under a revision. An entry written by hand may use any local IDs.
- **`entityOf` asks the kind for one ID** (`entity`, a member the derived half has since 6c and the reference half gets): `o/l3/a` is two look-ups, not a listing of 5000 entities. `entities` stays for the listings (`entityIndex`, built once per sketch object). The own rule of a constraint asks the same way for the points of a curve (five names), and the rule of an update for each operand.
- **What a region and a face are named by**: the curve's ID, `{ outerLoop: ['o/a1', …, 'o/l4'] }` and `{ feature, role: 'side', curve: 'o/l3' }`; the key of such a face quotes the slashed ID (6c wrote the quoting).

### The placement

- **`x`, `y`, `turn`** are numeric fields at `external/<id>/x`, `…/y`, `…/turn` (mm, mm, rad within a turn either way): they take expressions, `setField` with the sketch as the feature changes one, and the recompute follows a parameter (measured).
- **`anchor`** says which place of the file lands at (`x`, `y`), and the outline turns about it:
    - `origin` (the default): the origin of the file. The file's coordinates are the model's but for the motion; a revised file moves nothing that did not move in it.
    - `center`: the centre of the box of the curves (lines by their ends, circles whole, arcs by what they pass, splines by the box of their curve). The outline is centred whatever the page coordinates of its file, and stays centred when a revision is larger. This is how the board of scenario 15 is symmetric about the axes.
- **A point p of the file stands at `at + R(turn) · p`**, with `at = (x, y) − R(turn) · a` for the anchor `a`. A turn of exactly 0 multiplies nothing, so an outline that is not turned keeps the digits of its file up to the addition of `at`.
- **Not a point of the sketch** (the review's finding 9), and **not a point of reference geometry**: an entry would then depend on another, the order of `resolveReferences` (by ID) would matter, and an outline could fail and would need a frozen value, which is its positions. A place that follows a body is an expression over parameters today; "Deferred".

### The value, the stamp, the arcs

- **The value** of an outline in `solved.external` is `{ kind: 'outline', at, turn, data }`: where the origin of the file lands, the turn, and `fingerprint(stableStringify(curves))`, computed once per object of `curves`. It is not positions, and `Projected` stays the four forms of positions: what the stamp holds per entry becomes `StoredValue = Projected | PlacedOutline`, read by `storedValue` in the place of `projected`. So the code of 6b that holds a `Projected` never meets a form it cannot have (the review, fable 11; the first design made it a fifth form of `Projected`).
- **The stamp** of the sketch holds the value, as for every reference: it changes when the outline moves or its curves change, and not when its flag, its name or its source does (measured by the review, R1). With the stamp kept the stored positions of the own points are used; the solver still runs for the diagnosis, as at every step.
- **Nothing is frozen**: the value never fails, so `value` (the reader of a stored one) only checks the form.
- **`keepsValue`**: an update keeps the stored value when it changes neither the place (`x`, `y`, `turn`, `anchor`) nor the object of `curves`, and drops it otherwise, as 6b's kind does. The reviews differ here. Fable: always keeping it is safe, because the stale value is never used as a frozen one and the stamp differs, so the recompute writes the fresh one. agy: a document saved while its sketch is in conflict (nothing is written back then) keeps the value of a placement the entry no longer has. Both are right; the second costs nothing to avoid, so the value is dropped.
- **The geometry** is computed from the entry and the value (`outlineGeometry`) and kept per entry object (a `WeakMap` by the entry, with the ID and the value it was made for), so a drag of an own point does not place 2000 curves again (measured: 0.00 ms), and two entries that share an object of curves do not push each other out of a cache of one slot (the review, agy 10). A switch of the flag makes a new entry object and places the outline once.
- **Arcs.** A stored arc has its two ends on one radius within 1e-9 mm per mm of its largest coordinate, at least 1e-9 (the tolerance of 6b's stored arc; an absolute one is under the last digit for coordinates of 1e5 mm: the review, fable 16); the validator refuses more, with the distance. The readers leave under 1e-12. The placement then puts the end on the circle of the start (6b's `exactArc`, shared), so a fixed arc is as exact as the solver asks (1e-10; measured 4e-15).
- **A spline** of an outline is a spline of the result over its control points (`{ type: 'spline', points: ['o/s1/0', …] }`), which 6d's shape function takes from any source: it forms regions, names a side face, and no constraint names it; its control points are points like any other of the entry.

### Regions, joins and face names

- With `regions: true` every curve of the entry is in `EntryGeometry.regions`; with `false` none. Never some: the layers of a file that should not bound anything are left out at the import, or go into a second entry with the flag off.
- **The ends join by position** in 6c's stage (`positionJoins`), which takes every curve that is not own and forms regions: with each other within 1e-6 mm, and with the end of an own curve that forms regions there, when the own ends at that place are one vertex. Nothing is stored. The reader's weld is what makes "within 1e-6" true for a file.
- **One condition in that stage**: a curve whose two ends are one place is closed and has no open end. A closed spline of an outline bounds its region today and is listed in `openEnds` all the same, with the distance 0 and the advice of an open end (measured, J9; the review, codex 12). The first design said 6f writes no code there.
- **An own chain may close an open outline** (measured, D2): own ends `coincident` with the open ends, one region of own and imported curves.
- **Ends that stay open** are in `SketchResult.openEnds` (6c), `apart` with the nearest end and how far; the advice of `get_sketch` gets the cure for an outline: import again with a larger `weld`, or end an own curve there.
- **Invalid, as for any curves**: an own curve that forms regions and crosses the outline, two outlines on each other, curves of one file that cross. The first has no repair by a tool ("At the plug-in points of 6e").

### The solver gets what the constraints name

- A kind may say **`narrow`**: the input of the solver gets of its entries only the entities that a constraint of the sketch names: a named curve with its points and its radius, a named point alone. An outline says it; the kinds of today do not, so the stamp of every stored sketch stays (measured by the review, R1: identical).
- **Where**: `resolveReferences`, which has the sketch, gives such an entry `solver`, the part of its geometry the operands of the constraints name (reference dimensions too: they are measured from the curves of the input); `solverSetup` reads `solver ?? geometry`. The curves of the sketch, the profile and the result read `geometry`, whole.
- **After the solver** the step puts the points **and the radii** of the entries into its geometry, as it puts the far points of the axes there: the solver returns only what it got, and a circle of an outline that no constraint names, or whose centre alone is named, has no radius without it and is no curve of the profile (`placedCurve`, `sketch.ts`; all three reviews, agy as a blocker: the first design said "positions", and the emulation of probe F merged both, so its result did not show it).
- **On each of the three paths** of the step: solved with a new stamp; the stamp kept, where the geometry is the stored input; a failed solve. One place after the three, not in each.
- **In one order**: the merged records of points and radii are built own geometry first, then the entries by ID, whatever is named, so the order of the keys of `SketchResult.points` does not follow which entities are constrained (the review found the values equal and the order not).
- **Sound** because every point of reference geometry is fixed and no equation of the solver reads a fixed entity that no constraint names; the analysis of freedom counts only variables that are not fixed. The adapter's spread and the analysis take their extent from the points of the input, so they see the named points only; the review compared the whole `diagnoseSketch` and found it equal. The stamp then holds, of an outline, the named curves and the value, which is everything the solve depends on.
- **No bound when constraints name most of an outline**: the solver then gets what they name. A constraint is made by hand or by a tool, one at a time; a sketch with a thousand constraints on an outline is as large as one with a thousand own points.

### A tangency at a corner

- The points of an outline belong to their curves, so at a corner the end of a line (`o/l1/b`) and the start of the arc beside it (`o/a1/start`) are two fixed points at one place, with no coincident between them (a constraint between fixed entities is refused, and would never take effect). The same holds for two projections of 6b that meet.
- The adapter chooses the form of a tangency of a line and an arc by whether they share an end (`commonEnd`: one ID, or joined by coincidents). An own line whose start is coincident with `o/l1/b` and that is tangent to `o/a1` shares the end in fact and not by any ID: the general form is taken, which has a double root there. Measured (J10): no conflict and no redundancy is reported, the far end of the line is 3.7e-5 mm off the tangent, and it does not follow a drag. Held on `o/a1/start` it is exact. The app's hit test gives the point of the line at a corner (the lines of an entry are listed before its arcs), so this is the case a user meets.
- **The fix is in the adapter** (the review, agy 7): two fixed points within 1e-6 mm of each other are one end, as two points joined by a coincident are; then a point coincident with either is joined to both. The analysis of the engine decides the same case by the geometry already (`held`), so the two agree after it.
- Not by giving up the points per curve: shared vertex IDs would need a numbering of vertices that a revision shifts ("Entities and their IDs"), and the case exists for 6b's projections without any outline.

### A revised file: the update and its rule

- **A revision is `updateExternal`** with the new `curves`. `partial` (below) lets it send nothing else, so the placement, the flag and their expressions stay.
- **What keeps its ID**: an entity whose curve is at the same place among the curves of its kind in the new file, read with the same layers (`source`). A board made wider keeps every ID; a hole added at the end of the holes adds `c5`; a hole added first renames the others; two holes listed the other way round swap (measured).
- **A swap is told** (`outlineRevision`, `renamed`; the review, fable 13): an ID whose curve is, in the new file, where the old file had the curve of another ID of its kind. Measured (J11): the two holes swapped are listed, the wider file lists nothing. It compares places rounded to 1e-6 mm, so it finds curves that changed their order and not their place; a curve that moved and changed its place in the file at once is not found. No matching by geometry is done with it: the caller is told, the IDs stay the file's.
- **The rule of an update, its third part** (`updateProblem`; 6a left it to the package that reaches it): an update under which an entity that a constraint of the sketch names goes away is refused, naming the entities and the constraints (driving or reference; a control point of a spline too). For every kind; the first two parts stand (reference does not become derived, an entity that stays keeps its kind). It asks `entity` of the new entry for each operand under the entry's ID, and lists nothing.
- **The way past it is one batch**: the constraints removed, then the update. A batch is atomic and its commands see the sketch as the ones before left it, so this order passes and the other does not. Through MCP the tool `import_outline` takes `remove`, the constraints to remove in its batch (the reviews, codex 9 and fable 6: the first design told the caller to use a batch and gave the tool none, so the constraints were removed in one undo step and the replacement refused or made in another). The app's draft offers the same as a checkbox.
- **What is not refused**:
    - An operand of a mirror or pattern of the same sketch (its axis, direction or centre) that goes away: the entry loses its copies with the warning `brokenCopies`, and the document loads (measured by the review, R4). An entry is recomputed and says what it lost; a constraint on an entity that is gone makes the sketch itself invalid, which is why only that is refused.
    - A later feature that names an entity that went. As everywhere, a reference to what was removed is valid in a document: a projection of it keeps its last place with `brokenProjection` (measured), a region that names it is `noProfile`.
    - The tool and the app say what went and list the features that are not ok after the command.
- **`removeExternal` of an outline** takes the constraints on its entities with it, as the removal of any entry or own point does: the caller asked for the thing to go. An update is a change of the thing, and may not delete constraints nobody named.
- **`partial`**: a kind may say that `updateExternal` may leave fields out, which then keep what the entry has. An outline says it; `{ type: 'outline', regions: false }` switches the flag, `{ type: 'outline', curves }` is a revision. `addExternal` requires `curves`.
    - Only when the command's `type` is the type of the entry it updates; an update that changes the kind is the whole entry, as today (laid over an `edge` it would be a mix of two kinds).
    - The command's entry is checked for its fields, its `undefined` fields are dropped, and it is laid over `entryInput(sketch, id)` **before** the loop of `updateExternal` that keeps unchanged expressions (`document.ts`). A field left out then arrives as the expression the entry has, is found unchanged, and keeps its last value without being evaluated: an expression that is in error today stays, and does not fail the update (the review, agy 2; measured by the review, R6: expressions stay, also one whose parameter is gone, a number given drops its expression, the curves stay one object).
    - A field cannot be cleared by leaving it out. The two optional fields are cleared by a value: `name: ''` is no name, `source: null` no source.

### At the plug-in points of 6e

The names are 6e's ("Plug-in points" of its design); checked against `sketch-cut.ts`.

- **`sketchWorld`, `stepBase`, `toolBase`: nothing.** An outline's curves are reference curves of the base; `toolBase` takes them from `SketchResult.curves` with their flag, so a tool sees an outline closed as the recompute does.
- **`curvePredicates`: nothing.** `formsRegions` reads the flag; `mayCut` is false for what is not own; `holdsPoint` is true for a reference line, arc and circle and false for a spline.
- **`contactFix`**: a curve of an outline that forms regions is flagged as a projection of 6b is. The test becomes "a reference curve with `regions` whose entry is a projection from a sketch or an outline" (the entry of `o/l1` is `o`). With the ends of another curve the contact is not listed (6b's rule: the join of the own ends there cures it, and the position stage takes the outline's end in); any other contact is `fix: 'none'` with 6f's reason: "o/l1 is a curve of the imported outline o, which forms regions and is not cut: switch `regions` of o off … and draw the outline as own curves in a later sketch (the sketch tool projectSketch with as: "own"), then cut that; or remove the curve that meets it".
- **The flagged curve is asked for before the spline** (the review, agy 11, read in the code): today the function answers for a spline first, so a spline of an outline that an own curve crosses would get "move the other curve or the control points", which nobody can do to an import. A spline of an outline gets the outline's reason.
- **An extend** that would end on or cross such a curve is refused with 6e's text of a curve that forms regions and is not own, as for a projection; with the flag off an outline curve is a stop like a projected edge, and a `with` curve of a trim (measured). **A spline in its way is found by the shape of the curve**, not by `sketch.curves[C]` (`reachOf`, `extendSpec`), which knows own curves only: an extension toward a spline of an outline then says that a spline stops nothing, where today it would say that it meets nothing.
- **`namedOutside`** (the names a cut must not take) reads the texts of `external` through the references of each kind (`refs`), not by walking every entry: the curves of an outline hold no ID, and 2000 of them are not walked at every cut (the review, agy 13).
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

- **The validator of the kind** (on `load`, `addFeature` of a sketch, `addExternal`, `updateExternal`): the fields (`onlyFields`); `curves` an object of 1 to 2000 entries; each key a local ID; each curve of its form (a line at least the length tolerance long; a radius at least the tolerance; an arc with its ends on one radius within the relative tolerance, not a whole turn; a spline of 3 to 64 points, each at least the length tolerance from the next, closed only by its first point again, then at least 4); at most 2000 control points of splines together; the three numbers through `fields.number`; `anchor`; `regions`; `name` a text of the length of a name, an empty one stored as none; `source` by its form.
- **The document never holds the caller's object.** The validator copies the curves once and remembers the object it made (a `WeakSet`); an object it made is taken as it is, with no check, so every later validation of the entry (`fieldsOf` runs at every command of the sketch) costs nothing, and what is kept per object (the fingerprint, the box, the geometry) survives every command that does not change the curves. The first design kept the object given when it was already canonical: the caller could then write into the document (measured by the review, R6), and the check was two serialisations of the whole outline at every command of the sketch (6.4 ms for 2000 curves; the reviews, fable 8 and agy 9). Measured after it (J8): the document holds a copy, and the same object after `addPoint` and after a switch of the flag.
- **`addExternal`, `updateExternal`, `removeExternal`** as they are, with `partial` and the rule above.
- **The text for an unknown type** lists the kinds; 6f adds `outline`.

### The import

`importOutline(format, bytes, options)` (`packages/engine/src/import/outline-formats.ts`), a function without a state, as `importMesh`:

1. The options are checked against the description of the format (`checkArgs`), and the format reads the bytes into curves in millimetres, in the order of the file, each with its layer. **Its limits apply while it reads**: more than 8 million characters, more than 8000 curves from the layers asked for (four outlines' worth: the weld and the duplicates may bring a file under the limit of an outline), more than 8000 control points of splines are `tooLarge` at once, before anything is welded (measured, I8 and S9: 9000 lines refused in 19 ms). The first design counted curves after the weld only (the review, codex 10).
2. **The local IDs**, by kind and order, before the weld.
3. **The weld** (below).
4. **`empty`** when no curve is left (the message lists the layers of the file and what was skipped); **`tooLarge`** above 2000 curves or 2000 control points of splines.
5. **The report**: the unit and where it came from, the layers of the file with what each holds by type, what was skipped by reason, the curves by kind, what the weld did (`welded`, `moved`, `shifted`, `closed`, `dropped`, `duplicates`, `blocked`), the ends that are open and the gaps, the bounds, `source` (what the entry will store), and notes in words: the reader's own (a unit the file did not state, `$MEASUREMENT` 0 without `$INSUNITS`, entities off z = 0), the gaps with the weld that would close them, what was blocked, bounds under 1 mm or over 10 m ("is the unit right?"), more than 500 curves or 500 control points.

A format is a module of `import/` and a line of `OUTLINE_FORMATS`, described like an import format of D55 (`title`, `summary`, `extensions`, `options`, `read`), so the description for the AI, the tool and the app's file input read the catalog. Both formats take `layers`, `unit` and `weld`. The same bytes and options give the same curves under the same IDs.

**Not whole is refused; not read is listed** (the review, codex 5). A reader throws `unreadable`, with the place, for a file that is not a whole file of its format: a group code without its value, no `EOF`, a section or a polyline that does not end, an entity it reads without a group it needs, a number that is none; a tag that does not close or does not match, no `</svg>`, path data that does not parse. It never reads such a file as far as it goes: what is missing could be a hole, and the rest a plausible, wrong region. A complete entity of a type the reader does not take, or takes only in part, is left out and counted in `skipped` by its reason. The first design read a truncated SVG without a word.

### The weld

`weldOutline(curves, tolerance)`; the option `weld`, 0.01 mm unless given, 0 to 1. The first design merged every end within the tolerance of another, transitively, onto the first of them, and then moved the centre of every arc onto the bisector of its chord. All three reviews found it unbounded: a chain of close ends collapsed to one place (a corner drawn as 200 lines of 0.004 mm became a straight cut of 0.7 mm, a valid profile of the wrong shape), an arc of nearly a whole turn was dropped, and an arc of radius 1000 with a short chord came out with radius 912 when one end moved 0.009 mm. The weld now:

1. **Curves that close onto themselves.** An arc of more than a half turn whose own two ends are within the tolerance, with no end of another curve near them, becomes a circle (a hole written as an arc from 0° to 359.9°); an open spline of four points or more likewise is closed onto its start. Otherwise the two ends of one curve are never welded to each other.
2. **Met ends never move.** An end is met when an end of another curve is within 1e-6 mm of it, the tolerance of a join of the sketch. A file whose ends meet is not changed, however short its curves.
3. **Open ends, in pairs, the nearest first** (then by the order of the file): an open end and an end of another curve within the tolerance. Of two open ends one moves onto the other: an end of a line or a spline before an end of an arc, otherwise the later in the file. An open end moves onto an end that is settled already only when that keeps it within the tolerance of where the file had it; otherwise the weld is not made, counted in `blocked`, and the end stays open and is listed in `gaps`. So **no end moves further than the tolerance**, and nothing is merged along a chain.
4. **An arc is re-centred only where two arcs meet**, and within the tolerance. The centre goes onto the bisector of the new chord, at the nearest point; the move is made only when, against the arc of the file, the centre and the radius change by no more than the tolerance and the sweep by less than a half turn (its branch, the short or the long way round, stays). Otherwise the other end of the pair is tried, and then the weld is blocked. An arc whose ends stayed keeps the digits of its file.
5. **What is left out**: a line or an arc whose two ends are then one place (`dropped`); a circle without a radius; a curve that lies on an earlier one, the same places within 1e-6 mm, a line or a spline either way round (`duplicates`: measured before, J6, the bottom side of a square twice gave an invalid profile and a report that said nothing). An end of a spline is not moved onto its own neighbour point, and a spline of three points is not closed (both would be refused by the validator; the review, agy 6).
6. **The report says what happened**: `moved` is the furthest any end went from its place in the file and `shifted` the furthest a centre went, each at most the tolerance; `closed`, `dropped` and `duplicates` are the changes of what the outline consists of; `blocked` and `gaps` what could not be closed.

With a tolerance of 0 only the duplicates are left out. The default stays 0.01 mm, which the reviews accept only with these bounds: it closes files down to two decimals of a millimetre (A3), and it can no longer change a file that closes.

### The readers: DXF

ASCII DXF, any release. Read by hand (`import/dxf.ts`); the text is decoded as UTF-8, a byte-order mark passed over.

- **Groups**: a code line and a value line, both trimmed; CR LF, LF or CR; read up to the group `0`, `EOF`, and nothing after it. `unreadable`, with the line: a code that is not a whole number, a code without its value, a number that is empty or none (never read as 0), a file with no `EOF` ("the file is cut short"). The sentinel of a binary DXF and the head of a DWG are `unreadable` with what to do ("save it as ASCII DXF").
- **Sections**: `HEADER` for `$INSUNITS` and `$MEASUREMENT`; `ENTITIES`. `BLOCKS`, `TABLES`, `OBJECTS` are passed over. A `SECTION` without `ENDSEC` is `unreadable`. A file without any `SECTION` that is a bare list of entities up to `EOF` is read as its entities.
- **Units**: the option `unit` (`mm`, `cm`, `m`, `in`, `ft`, `mil`, `um`, `dm`); else `$INSUNITS` 1 in, 2 ft, 4 mm, 5 cm, 6 m, 8 microinches, 9 mils, 10 yards, 13 microns, 14 decimetres; 0 or no header is millimetres, and the report notes it, with the advice to give `unit: 'in'` when the header says `$MEASUREMENT` 0 (imperial) and no unit; any other value is `unreadable` with "give the option unit" (the first design had no option for microns and decimetres, a dead end: the review, fable 17).
- **Layers**: group 8 of each entity (`0` without one); the option `layers` by exact name. The report lists every layer.
- **`LINE`** (10, 20; 11, 21); **`CIRCLE`** (10, 20, 40); **`ARC`** (10, 20, 40, 50, 51: degrees, counter-clockwise from 50 to 51; equal angles, or a whole turn apart within 1e-9°, are a circle; an arc that only nearly closes is the weld's). An entity without a group it needs is `unreadable`, with its type and its line.
- **`LWPOLYLINE`** (70 bit 1 closed; per vertex 10, 20 and the bulge 42) and **`POLYLINE`** with its `VERTEX` entities up to `SEQEND` (the form the engine writes; without `SEQEND`, or a `VERTEX` outside a polyline: `unreadable`): a segment per pair of vertices, a line, or with a bulge `b` the arc that turns by `4 · atan(b)`, counter-clockwise for a positive bulge; its centre is `(p + q) / 2 + ((1 − b²) / (4b)) · perp(q − p)`. Vertices at one place make no segment. A `POLYLINE` fitted to a curve or a spline (70 bits 2, 4) is read by its curve vertices: the vertices of its frame (vertex flag 16) are passed over, or the frame would be read as lines. A `POLYLINE` that is 3D or a mesh (70 bits 8, 16, 32, 64) is left out and listed. Widths are not read.
- **`SPLINE`**, checked before it is converted (`bsplineBeziers` checks neither the order of the knots nor that they are clamped: given knots out of order it answers with four pieces and no word, I6; the reviews, codex 6 and agy 4):
    - `unreadable`: knots or control points that are no numbers, a count of knots that is not the control points plus the degree plus one, knots out of order.
    - Left out and listed, each by its reason: rational (70 bit 4, or weights that differ), a degree outside 1 to 3, fit points without control points, periodic or not clamped at both ends, no extent, a break in the curve (an inner knot repeated more than the degree).
    - Knots within 1e-9 of their span are one knot, so knots that differ in the last digits give no piece without extent; a piece whose control polygon is under the length tolerance is dropped and counted.
    - **A cubic with even, clamped knots and 4 to 64 control points is one spline of the sketch** over those control points, and a quadratic of 3 points likewise: 6d's spline is that curve (measured, I6b: 0 mm from the Bezier pieces of the file), so a free-form side of five spans is one entity and one face, not five (the review, fable 9).
    - **Any other is its Bezier pieces**, exactly (`bsplineBeziers` of 6d): a line per piece for degree 1, a spline of three control points for degree 2, of four for degree 3; the pieces share their ends to the digit. Over the same control points a spline of the sketch would be another curve (I6b: 0.88 mm off). Each piece is a curve of the limits.
- **The extrusion direction** (210, 220, 230; by default (0, 0, 1)). `CIRCLE`, `ARC`, `LWPOLYLINE` and a 2D `POLYLINE` (by the groups of its header) are in the coordinates of their own plane: with 230 negative their x is mirrored, an arc's angles and a bulge's sign with it; with a direction that is not along z they are left out and listed ("(tilted extrusion)"). `LINE` and `SPLINE` are in world coordinates: they are never mirrored and a 210 group on them changes nothing (the reviews, fable 17 and agy 3: the prototype did not mirror a 2D `POLYLINE`, which tears an outline drawn from below apart; measured after, I3). A z is not read; the report notes a file whose entities do not lie at z = 0.
- **Left out and listed** (`skipped`, by type with a count): `INSERT` (blocks), `ELLIPSE`, `TEXT`, `MTEXT`, `DIMENSION`, `HATCH`, `POINT`, an entity of paper space (67 = 1), and every other type.

### The readers: SVG

SVG 1.1, the subset of the plan (`import/svg.ts`), as text in UTF-8. The prototype's first reader split tags by a pattern and path data on letters; the review (codex 7, agy 5) found it read `1e1` as a command `E`, misread arc flags written without separators, and divided by zero for an arc with equal ends. It is a tokenizer now, of the document and of path data (450 lines in the prototype).

- **XML**: a scanner with a stack of open elements. Elements and attributes (either quote), comments, processing instructions, CDATA and a `DOCTYPE` without declarations of its own are passed over; the five predefined entities and numeric ones in attribute values. Prefixes are read as written (`inkscape:label`); an `svg:` prefix on an element is dropped. `unreadable`, with the character: a `<` that starts no complete tag, a closing tag that does not match the open element, elements still open at the end (no `</svg>`), an attribute without a quoted value, an unknown entity, a `DOCTYPE` with an internal subset, no `svg` element.
- **Millimetres**: the option `unit` (what one user unit is); else `width`, `height` (mm, cm, in, pt, pc, px or none) over the `viewBox`, the same scale both ways or `unreadable` ("give the option unit"); a root without them at 96 units per inch. The origin of the `viewBox` moves nothing: the coordinates are the user space of the root.
- **A length of a shape with a unit** (`r="10mm"`, `x="1in"`; mm, cm, in, pt, pc, px) is user units at 96 per inch, as SVG says: 10 mm in a drawing whose user unit is a px, and 37.8 units in one whose `viewBox` makes a unit a millimetre (measured, S4). With `%`, `em` or `ex` the shape is left out and listed ("circle (length in %)"); a value that is no number is `unreadable`.
- **y points down in SVG**: every place is read as (x, −y), so the drawing looks as it does on the screen, below the x axis. (The engine's writer wrote (u, −v), so its own files come back where they were.)
- **Layers**: the groups an element is in, each by its `inkscape:label` or else its `id`; the option `layers` takes an element when one of its groups is named.
- **`transform`** on a group or a shape: `translate`, `rotate` (with a centre too), `scale`, `skewX`, `skewY`, `matrix`, composed down the tree; any other name is `unreadable`. Lines and splines take any transform. A circle or an arc under a total transform that is not a similarity (its two columns of one length and perpendicular, within 1e-9) would be an ellipse: its shape or its whole path is left out and listed ("(uneven transform)"). A reflection is a similarity: an arc under it runs the other way, and its ends swap (measured, S8).
- **`path`**: a scanner of command letters and numbers (a sign, a fraction without a leading digit, an exponent; no separator where the grammar needs none; the two flags of an arc one character each). `M`, `L`, `H`, `V`, `Z`, `C`, `S`, `Q`, `T`, `A` and their relative forms, the arguments counted, a repeated group an implied command. `C` and `S` are a spline of four control points, `Q` and `T` of three; the smooth forms reflect the control point before. An arc by SVG 1.1, F.6: equal ends are no segment, a radius of 0 a line, a radius under half the chord raised to it, then the centre from the two flags. Path data that does not parse (a number that is none, a count of arguments that is wrong, a flag that is not 0 or 1, a letter that is no command, no `M` first) makes the file `unreadable`, naming the path and the character. A well-formed path with an arc of two radii is left out whole and listed.
- **`rect`** (with `rx` equal to `ry`, or one of them given, the corners as arcs; two different: listed), **`circle`**, **`ellipse`** with equal radii (a circle; with two: listed), **`line`**, **`polyline`**, **`polygon`**.
- **Passed over with their content**: `defs`, `clipPath`, `mask`, `symbol`, `pattern`, `marker`, `metadata`, `style`. **Left out and listed**: `text`, `image`, `use`, a nested `svg`.
- **Not read**: CSS (`style`, classes, a transform in a style), fills and strokes (a filled shape is its outline), `display` (a hidden element is read).

### The query `entryCurves`

An entry of `QUERIES` (`query/entry-curves.ts`): the curves of one entry of a sketch with their places, a page at a time, for any kind of entry (the copies of a pattern too, which 6c lists short).

- **Arguments**: `sketch`, `entry`, `kind` (optional: `line`, `arc`, `circle`, `spline`), `from` (how many to pass over, default 0), `max` (default 100, at most 500).
- **Answer**: `status` (`ok`; `unavailable` when the sketch did not evaluate; `noEntry`), `total`, `from`, and `curves`, each with its ID, its flag `regions` and its place in the sketch rounded as positions are: a line by `a` and `b`, a circle by `center` and `radius`, an arc by `center`, `start`, `end` and `sweep`, a spline by `through` and `box` (6d's), by `closed`, and by **`control`, its control points in order** (`<id>/<i>` stands at `control[i]`). The control points of a spline of an outline may be constrained to and projected, and the points it runs through are not them; the first design gave no bounded way to read where they stand (the review, codex 13).
- It reads the state of the solved sketch (`context.sketch`), no body (`geometry: 'none'`). It costs its line in `QUERIES` and its rows in the two typed tables of `packages/mcp/test/queries.test.ts`; the app reaches it through the generic form.

### The step, in order

1. `resolveReferences`: an outline's value from its entry (never lost); its geometry; for a kind with `narrow`, `solver`, the part the constraints name.
2. `solverSetup` (reading `solver` where there is one) and the solver, as today; in the adapter, two fixed points at one place are one end.
3. The geometry after the solver, on each of its three paths, with the points and the radii of the entries the solver did not get, in one order.
4. `sketchWorld(stepBase(…))`: the curves of the outline among the reference curves, 6c's position stage over them when the flag is on, a closed curve without an open end.
5. The profile, the result (the curves of the entry with the flag, `openEnds`).

## The document and the schema

- **What the document gains**: an entry `{ type: 'outline', … }` in `external` of a sketch, with its curves, and its value `{ kind: 'outline', … }` in `solved.external`. Region references and face names hold the IDs of its curves, strings to every build.
- **No upgrade step, no new version; `SCHEMA_PENDING` stays 0 and the version 10.** A build without the kind refuses the entry (`externalRef`, with the text that lists the kinds it knows), so a document with an outline is an invalid document there, not a model with the outline dropped; its stored value belongs to the entry and goes with it. This is the rule of `schema.ts` ("no step is needed where a build without the addition refuses by itself") and what 6a said of 6b, 6c and 6f. The plan expected a step for a section; there is no section.

## Where the code lives

| File | What changes |
|---|---|
| `packages/engine/src/types.ts` | `ImportedCurve`, `OutlineSource` and `SketchOutline` (with the comment the AI reads), a member of `ExternalRef`; `PlacedOutline` and `StoredValue` (`Projected` unchanged), the type of `SolveStamp.external`; the input forms of the two commands |
| `packages/engine/src/references/outline.ts` (new) | the kind: `validate` (the copy remembered), `refs` and `faces` (none), `entities`, `entity`, `compute` (`placeOutline`), `value`, `geometry` (`outlineGeometry`), `keepsValue`, `narrow`, `partial`, `summary`, `example`; `outlineBox`, `outlineEntities` |
| `packages/engine/src/references/spec.ts` | `ReferenceValues.outline`; the optional members `entity`, `narrow`, `partial`; `ResolvedReference.solver`; `storedValue` in the place of `projected` for what `solved.external` holds |
| `packages/engine/src/references/index.ts` | the line of the registry; `entityOf` asks `entity` when the kind has it; `resolveReferences` fills `solver` for a kind with `narrow` (`narrowed`); `updateProblem`, its third part; the text of an unknown type lists `outline` |
| `packages/engine/src/sketch.ts` | `solverSetup` reads `solver ?? geometry` of a resolved entry |
| `packages/engine/src/features/sketch.ts` | the step: the points and the radii of the entries the solver did not get, put into the geometry after it on each path, in one order; `ruleProblem`: the points of a curve of an entry asked of `entityOf` by name |
| `packages/solver-planegcs/src/index.ts` | `commonEnd`: two fixed points within 1e-6 mm are one end |
| `packages/engine/src/document.ts` | `updateExternal`: for a kind with `partial` and a command of the entry's type, the command's entry laid over `entryInput(sketch, id)` before the loop that keeps unchanged expressions; the third part of the rule through `updateProblem` |
| `packages/engine/src/references/projection.ts` (6b's) | `isSplineOf`: a spline of an outline |
| `packages/engine/src/references/derive.ts` (6c's) | `positionJoins`: a curve whose two ends are one place has no open end |
| `packages/engine/src/references/world.ts` (6e's) | nothing |
| `packages/engine/src/sketch-cut.ts` (6e's) | `contactFix`: the test of a flagged curve takes an outline's, with 6f's reason, and is asked before the spline; `reachOf` and `extendSpec`: a spline found by the shape of the curve; `namedOutside`: the texts of entries through `refs` |
| `packages/engine/src/import/spec.ts` | `ImportFormatSpec<S, R = ReadTriangles>`; `ReadOutline` |
| `packages/engine/src/import/outline-formats.ts` (new) | `OUTLINE_FORMATS`, `importOutline`, `weldOutline`, `outlineIds`, `outlineRevision`, the report and its notes (the name `import/outline.ts` would sit beside `export/outline.ts`, which is the section) |
| `packages/engine/src/import/dxf.ts`, `import/svg.ts` (new) | the two readers |
| `packages/engine/src/query/entry-curves.ts` (new), `query/index.ts` | the query and its line |
| `packages/engine/src/index.ts` | exports `importOutline`, `OUTLINE_FORMATS`, `outlineRevision`, the types |
| `packages/mcp/src/server.ts` | the tool `import_outline` (reads the path and the file; the rest is `outlineInto`, run where the engine is, as `import_mesh` reaches the app over the bridge) |
| `packages/mcp/src/tools.ts` | `outlineInto`; `sketchDetail`: the row of an outline (`OutlineDetail`), `regionRows` capped; one helper that leaves the curves of a large outline out, on the three paths of `get_document`; `openEndAdvice` for an outline |
| `packages/mcp/src/api.ts` | the generated section "Outline formats" from `OUTLINE_FORMATS`; the kind in "Entries of a sketch" by its `summary` and `example` (with the kind, in point 1); the paragraph on reference geometry gets the outline's sentence |
| `packages/mcp/test/outline-formats.test.ts` (new), `queries.test.ts`, `coverage.test.ts` | the two typed tables of the formats (as `import-formats.test.ts`); the rows of `entryCurves`; nothing in `coverage.test.ts` unless `importOutline` is reached through `Engine` (it is a function, as `importMesh`) |
| `packages/app/src/references/outline.ts` (new), `index.ts`, `spec.ts` | the row of the kind (`REFERENCE_UI` is typed by `ExternalRef['type']`, so the row comes with the kind, in point 1; its form, its flag and `file` in point 6); `ReferenceUi` gains `file`; `PICKER_LIMIT` for every entry |
| `packages/app/src/panels/sketch.ts`, `sketch-mode.ts` | the button *Import an outline…*, the draft with the report, the button of a row with `file` |
| `packages/engine/test/imported-outline.test.ts`, `outline-import.test.ts` (new) | the tests of the kind and of the import (`outline.test.ts` is taken: the tests of profiles) |
| `packages/scenarios/test/scenario15.test.ts`, `board-kit.ts` | the `describe` of 6f and the assembled model; `boardDxf` |
| docs | with the point that changes the code: `architecture/sketch.md` (the kind, the placement, the narrowed input, the fixed join), `architecture/api.md` (`ExternalRef`, `StoredValue`, the rule of `updateExternal` with its third part and `partial`, `importOutline`, the query), `architecture/ai.md` (the tool, `get_sketch` of an outline, the formats), `architecture/naming.md` (a side face named by a curve of an outline), `architecture/ports.md` (the adapter's common end), `architecture/repository.md` (the new files in the table of layers), `architecture/verification.md`; `ui/` the sketch panel; `decisions.md` D72; `requirements.md` scenario 15; `backlog.md` (the rows of "Deferred") |

`references/outline.ts` imports `validation.ts`, `spline.ts`, `util.ts` and `references/spec.ts`, as `projection.ts` does without `solid.ts`; it does not import `import/` (the stored `source` is checked by its form). The readers import `import/spec.ts`, `spline.ts` (`bsplineBeziers`) and `util.ts`. `import/outline-formats.ts` does not import `references/`: the curves are the type of `types.ts`. No new layer.

### Points of work

In this order; each is closed by the procedure of `CLAUDE.md`: its tests, **its documents** (the files of its area in `docs/architecture/` and `docs/ui/`; the first design left every document to the last point), its review, its fixes. The depth of the review is the table's there.

| # | Point | Review |
|---|---|---|
| 1 | **The kind.** `SketchOutline`, the value and `StoredValue`, the validator, the entities and `entity`, the placement and the geometry, `partial`, the rule of an update, `ruleProblem`, `isSplineOf`, the conditions in `contactFix`, `reachOf`, `namedOutside` and `positionJoins`. With it, because the tree does not compile or its tests fail otherwise (the review, fable 14): the row of the kind in the app's `REFERENCE_UI` (title, detail and tag only) and the kind's `summary` and `example` for `describe_api`, with the test of the examples. Tests on outlines written by hand, up to a few hundred curves | Full (the sketch step, validation of commands) |
| 2 | **The narrowed input of the solver** (`narrow`, `solver`, the geometry after the solver) **and the fixed join of the adapter** (`commonEnd`). Then the limits of 2000 curves and 2000 control points are tested | Full (the solver) |
| 3 | **The import**: `OUTLINE_FORMATS`, `importOutline`, the weld, the IDs, the report, the reader of DXF. Tests on the engine's own files, on files written by the tests, and on the cases of the reviews | Full (new geometry and a heuristic, the weld) |
| 4 | **The reader of SVG** | Full (new geometry: the arcs, the transforms) |
| 5 | **MCP**: the tool `import_outline` with `outlineInto`, `get_sketch` and `get_document` of an outline, the query `entryCurves`, the section of the formats in `describe_api` | Full (the tool is neither a catalog entry nor a form; the query alone would be light) |
| 6 | **The app**: the button, the draft (for placing and for replacing), the row's form, flag and file button, the limit of the pickers | Light |
| 7 | **Scenario 15 assembled**, and the indexes | Full by the table (it is none of the kinds the table makes light); it adds tests and changes no code, so the review reads the test against the plan's steps and the numbers by hand. A change it forces in an earlier package gets the depth of its kind |

Points 1 and 2 are merged together: point 1 without point 2 is correct and slow for a large outline, and can abort the adapter beyond about a thousand curves.

## The app

- **The button *Import an outline…*** in the panel of a sketch, beside the tools (not an entry of `SKETCH_TOOL_UI`: it picks nothing in the view). It opens a hidden file input whose `accept` is `importAccept(OUTLINE_FORMATS)`; the file is read as a mesh file is.
- **The draft** (`OutlineDraft`, state of the sketch mode): the file as read once by `importOutline`, shown in the panel as its report: the curves by kind, the size, the unit with a selector, the layers as checkboxes with what each holds, what was skipped, the weld and what it did, the open ends and gaps, the notes. A change of a layer, the unit or the weld reads the bytes again (3 ms for 1000 curves). Below: the anchor (*origin of the file*, *centre*), the checkbox *regions*, and *Place*, which sends one `addExternal` (the ID by `outlineId`, the name of the file, `source`) with the place (0, 0); *Cancel* drops the draft. A refusal of the import shows as the status line shows a refusal of a mesh.
- **A replacement always goes through the draft** (the reviews, fable 3 and codex 8: the first design had the row read the file with every layer and the default weld and send it at once). *Replace file…* of the row opens the file input and then the draft on that entry, with the layers, the unit and the weld the entry stores (`source`), each shown and changeable; an entry without `source` starts from the defaults, and the draft says that the first import's options are not known. The draft shows the revision before anything is sent: what stays, comes and goes, what was renamed by a swap, and the constraints that hold an entity that would go, with a checkbox to remove them with the replacement. *Replace* sends one batch.
- **The row of the entry** (`REFERENCE_UI.outline`): title "Outline", detail the name and the counts ("board.dxf: 4 lines, 4 arcs, 4 circles"), tag "imported", the form of 6c's rows for `x`, `y`, `turn` (each takes an expression) and the anchor, the checkbox *regions* (`flag`: `updateExternal` with the one field), `inModel` (the outline is drawn in the model view, solid when it forms regions), and *Replace file…* (`file`).
- **Constraining and projecting**: the entities of an outline are picked in the view as those of any entry (the snap and the hit test read `SketchResult.curves` and `points`). **The pickers** (the lists of an axis, a centre, an operand) apply `PICKER_LIMIT` to every entry with more entities than the limit, not to derived entries only, with the note of what was left out; an outline of 2000 curves would otherwise be 5000 options at every render (the reviews, fable 15 and agy 14).
- **Not measured**: the hit test and the drawing of 2000 curves in the view ("To verify", before point 6).
- **What the snapshots of the app see**: the button in every record that shows the panel of a sketch. The commit that changes them says so.

## MCP

- **The tool `import_outline`** (`ImportOutlineArgs`, `ImportOutlineAnswer` of the contract), in `server.ts` beside `import_mesh`, since it reads a disk. The server reads the file and runs `importOutline`; the rest is one function of `tools.ts`, `outlineInto`, run where the engine is (the server's own engine, or the app's over the bridge), so both give one answer, and the revision is computed from the document, not from an answer of `get_sketch` or `get_document`, which leave curves out (the review, codex 14).
    - Without `sketch`: the report only. An AI looks at a file first (its layers, its size, its unit) and then places it.
    - With `sketch`: `addExternal` under `id` (by default the name of the file reduced to an ID, numbered while taken), with `x`, `y`, `turn`, `anchor`, `regions` as given and `source` as the file was read. One undo step.
    - With `replace`: `id` is required. The format and the options that are left out are those the entry stores, so the revised file is read as the first was (the scenario's board: the layer `Edge.Cuts`, with no option given). Then `updateExternal` of the entry with the new curves and the new `source`, and the fields given; the answer has `revision` (kept, added, removed, renamed).
    - With `remove`, a list of constraints of the sketch: they are removed in the same batch, before the update. This is the way past the rule of an update through MCP, in one undo step: a replacement that is refused changes nothing and leaves the constraints, its message names them, and the caller repeats the call with `remove` (the reviews, codex 9 and fable 6).
    - The answer: the report, also when the command was refused (`refused`, its message); the entry and how its entities are named (`board/l1` … by the counts); the brief of the sketch after the command (status, valid, regions, open ends) and the features that are not ok (a mirror that lost its axis, a projection that lost its entity); `next` in words. Never the curves.
- **`get_sketch`** gives an outline its own row (`OutlineDetail`): the fields with their expressions, the counts by kind, the box as placed, the first 50 curves at their places (a spline with its control points), `listed` and `total`, and with more curves the query that gives the rest. The points of an outline are not listed apart: each curve says where its points are, and their IDs follow from the curve's.
- **The rows `regions` of `get_sketch` are capped** (`regionRows`; the review, fable 4: 33,841 characters for 1000 curves, which the first design's "4000 characters" did not count): at most 50 rows and the count of the rest; an outer loop of more than 20 IDs is printed as its count, its first 20 IDs and the entries they are under. The whole loop of a region, which a command needs, is in `SketchResult` and in the document of the feature that takes it; `get_sketch` says so in the row.
- **`get_document`** prints the text of `OUTLINE_OMITTED` in the place of the curves of an outline above 50 on each of its paths: the whole document (`documentShown`), one feature (`get_document { feature }`, which returns the feature as it is today: 72,666 characters measured by the review), and a feature of a stored document. One helper for the three. `save_document` writes the curves. (agy read the whole curves in `get_document` as acceptable for a tool that shows the raw document; the other two reviews and the tool's own treatment of a stored mesh say otherwise, and an answer of 140,000 characters is of no use to its reader.)
- **The query `entryCurves`** through the tool `query`, as every query.
- **`describe_api`**: `SketchOutline`, `ImportedCurve` and `OutlineSource` from `types.ts`; the kind in the generated section "Entries of a sketch" by its `summary` and its `example` (a small outline written out, accepted by the test of the examples); a generated section "Outline formats" from `OUTLINE_FORMATS` (per format its summary and its options), as "Import formats" is generated; in the paragraph on reference geometry one sentence: an outline is placed by its fields, its entities are `<entry>/<local>`, and a revision keeps IDs by kind and order.
- **The advice of `get_sketch`** for open ends of an outline: `OUTLINE_OPEN_END`.

## Issue codes

None new. An outline has no warning of the recompute (it cannot fail). What a revision breaks is said by the codes that exist: `brokenProjection` with 6b's detail ("board has no circle o/c4"), `brokenCopies` for a mirror or pattern that named an entity that went, `noProfile`, `brokenReference`. The refusals of an import are codes of its own outcome (`invalidArguments`, `unreadable`, `empty`, `tooLarge`), as those of `importMesh` are.

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
| 6e, "Plug-in points" | `curvePredicates`: a reference with the flag forms regions; `sketchWorld`: 6f writes no code; an outline is as a flagged projection, never cut | Kept; `contactFix` needs the condition and the text above, which 6e's table does not list for 6f, and two places of 6e and 6d look for a spline among own curves only |
| 6c, "Other packages" | A line of an outline is an axis or a direction, a point a centre; no source; the ends join by position | Measured as said; one condition in the stage, for a closed spline (J9) |
| 6c, `openEnds` and the advice | A flagged reference curve's open ends are listed; "ends of `e1`" for an entry that is not derived | Works for `o/l1` (the entry is found by the prefix); the cure's text is 6f's |
| 6b, "Where 6b meets 6d and 6f" | 6f reuses the forms `point` and `arc` of `Projected`, `exactArc`, the detail of a failure, `keepsValue`, the position stage, `inModel` | `exactArc`, `keepsValue` (used as 6b's kind uses it), the stage and `inModel`: yes. The forms `point` and `arc`: **no**, an outline's value is not positions and not a form of `Projected` (`StoredValue`). The detail of a failure: not needed, nothing fails |
| 6b, the same | An outline's entities are projected like any entry's; `projectSketch` with `as: 'own'` draws an own outline over an import | Measured as said |
| 6d, "Other packages" | `C` is a spline of 4 points, `Q` of 3; a DXF `SPLINE` of degree 2 or 3 becomes `bsplineBeziers` pieces, degree 1 lines; rational and above 3 left out and listed; 6f decides what a spline of an outline is | As said, and a cubic with even knots stays one spline (I6b). A spline of an outline is reference geometry: it forms regions and names a face; not projected, not constrained to, not cut |
| 6d, "Deferred" | "conics are refused by 6f" | Left out and listed, not refused: the rest of the file is read |
| 6d, "DXF and SVG" | Scenario 15 compares the areas of the section read back | Step 7; the allowance is 0.1 mm² (measured 0.014) |
| D55 | `ImportFormatSpec`, `ImportFailure`, `importFormatOf`, `importAccept`, `idFromFile` | Reused; the spec gets its second type parameter |
| D54 | The writers of DXF and SVG | Read back to the digit (A1, E1); nothing changes in them |
| The solver adapter (D2's port) | `commonEnd`: a common end of a line and an arc is one ID or a chain of coincidents | Two fixed points at one place are one end too (J10); the same case exists for two projections of 6b |

## What 6f changes in 6a's vocabulary

Rows for the table "Where later packages change the vocabulary" of [6a-sketch-prep/design.md](../6a-sketch-prep/design.md), added when 6f is merged (this package does not edit that file before):

> | 23 | "The IDs": the curves of an entry of several entities name its points, so two curves of an outline share a vertex as two own curves share a point; "An outline (6f) shares its vertices by ID and needs no key" | **The points of an outline belong to their curve** (`<entry>/<local>/a`, `/center`, `/start`, `/0`), as those of a projection do, and two curves that meet have two points at one place. The ends join by position in 6c's stage (answer 19), and the reader welds the ends of a file. A point named by its curve keeps its ID exactly when the curve does | 6f (D72) | In 6f's design, "Entities and their IDs" |
> | 24 | Part 1: the value of a reference kind is positions (`Projected`), one per entity or entry | **A value may be the parameters its geometry is computed from**: an outline stores its placement and the fingerprint of its curves, and `geometry` computes the positions from the entry and the value. `Projected` stays positions; `solved.external` holds `StoredValue`, either | 6f (D72) | In 6f's design, "The value, the stamp, the arcs" |
> | 25 | Part 1: every point and curve of a resolved reference entry enters the input of the solver, fixed | **A kind may say `narrow`**: the solver gets only the entities the constraints name, and the step merges the points and the radii of the rest into the geometry after it | 6f (D72) | In 6f's design, "The solver gets what the constraints name" |
> | 26 | "The commands": `updateExternal` takes the entry whole | **A kind may say `partial`**: fields left out keep what the entry has, when the command's type is the entry's | 6f (D72) | In 6f's design, "A revised file" |
> | 27 | "Joins": an end of a curve that is not own and forms regions is open when no other curve ends there | **A curve whose two ends are one place is closed** and has no open end (a closed spline of an outline) | 6f (D72) | In 6f's design, "Regions, joins and face names" |

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
| 7 | `vents` 7, then 3 executed (the cut is `noProfile` naming the region of copy 3, its feature as it was), then 5 from that state; **the revised file, 2 mm wider**, read with the layers the entry stores: every feature ok, the board +128, the base +212, the lid +216 mm³, the holes 27.5 from the axis; the volumes of the board and the base by the query `mass` against the values by hand; the section of the lid as DXF read back with the area of the section within 0.1 mm² | 6f |

The stand-in board of 6a2 stays in the `describe` blocks of the earlier packages; the assembled model does not use it.

**The placement is tested on a model of its own**, not in the scenario (the review, codex 11). The first calls turned the board a quarter in the assembled model and asked for every feature to be ok. Measured (H6): `baseSk` and `lidSketch` are then not solved, because the notch of the floor and the lid are dimensioned from the axes of their sketches, which do not turn with the board; the measurement the calls leaned on (B3) was of the board, the skeleton and the base alone, which are held on projections of the board and do follow. A cover that turns with its board is not what scenario 15 asks for, so the cover is not redesigned: the case `placement` of `calls.ts` (the anchor, the expression of the turn, the rename of its parameter, `setField`) runs on the model of B3.

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
- **A weld that merges every end within the tolerance, transitively** (the first design). Unbounded: an end at the far side of a chain moves by the length of the chain, and a finely drawn corner collapses into a valid profile of another shape (the reviews; J1, J2).
- **A transitive weld with a refusal when an end moved further than the tolerance.** It would refuse the file of J1, which needs no weld at all. Leaving met ends alone removes the case.
- **Every arc re-centred onto the bisector of its chord** (the first design). Ill-conditioned for a short chord under a large radius (radius 1000 became 912). Arcs keep their file's centre; one is moved only where two arcs meet, within the tolerance.
- **Welding by moving both ends to their middle.** One end keeps its digits, so a file that needs no weld is not changed at all; and an arc would have to be re-centred at every corner.
- **No weld, a refusal with advice.** The files that need it are ordinary (four decimals), and the cure is not in the caller's hands.
- **A reader that reads a broken file as far as it goes** (the first design, for SVG). What is missing could be a hole.
- **The IDs given after the weld** (the first design). A curve dropped in one revision would rename every later curve of its kind, and the IDs would depend on the weld.
- **The options of an import not stored** (the first design). A replacement read another outline than the one it replaced.
- **The outline's value as a fifth form of `Projected`** (the first design). The code of 6b would hold a form it can never have.
- **The validator keeping the caller's object when it is canonical** (the first design). The caller could write into the document, and the check cost two serialisations at every command of the sketch.
- **A constrained entity released silently by a replacement.** An update may not delete what nobody named; the caller names the constraints (`remove`), or keeps the curve.
- **A numeric scale as the unit option** (the review offered it beside more unit names). The names cover what `$INSUNITS` can say; a factor invites a second, silent way to get a size wrong.
- **A periodic spline clamped by the reader.** Exact, by the review's probe; not written for the first version, listed and in the backlog.
- **A library for DXF or SVG.** The plan says by hand; the subset is small (the two prototype readers are a few hundred lines each), and a library needs the owner's approval and a port.

## Known limits

- **IDs follow the order of the file.** A file whose tool lists entities in another order after an edit renames them: what named `c1` names another hole (B6). A swap of curves that did not move is told (`renamed`, J11); a curve that moved and changed its place in the file at once is not, and "kept" means that the ID still exists, not that it is the same feature of the drawing. The cure is in the model: constrain and project few entities of an outline, in one skeleton sketch.
- **A revision that drops a constrained entity is refused whole**; the caller names the constraints to remove with it. Entries of the same sketch and later features are not protected: they break aloud at the recompute.
- **The weld moves an open end by up to the tolerance** (0.01 mm by default), onto one other end. It closes no chain: where three or more ends lie within the tolerance of each other without meeting, some stay open and are listed. It does not change a file whose ends meet. A feature of an outline finer than the weld whose ends are open can be closed up by it; the report counts what moved and how far.
- **An arc is re-centred only where two arcs meet with a gap**, and its radius then changes by up to the tolerance.
- **Curves that cross in the file are not cut**: such an outline is an invalid profile, and `sketchContacts` lists the pairs. A curve that lies wholly on an earlier one is left out; one that lies on a part of another is not found. Cure: other layers, or the flag off and an own outline in a later sketch.
- **An outline is not cut in its own sketch.** A notch in an imported outline is own curves in a later sketch (6b's tool), or a second body cut from the first.
- **Cost, as measured on the files of the probes, not as a bound**: a change in a sketch that holds 2000 lines and circles that form regions is 100 ms; 500 splines of four control points 68 ms; 31 splines of 64 points 110 ms; with the flag off 5 to 17 ms. It follows the points of the profile, and several outlines in one sketch add up: the limits are per entry. The document grows by 70 characters a line and 190 a spline of four points, and so does every saved file; undo shares the entry, and a revision keeps the old curves in the undo stack.
- **The narrowing bounds nothing when constraints name most of an outline**: the solver gets what they name.
- **A region reference lists every curve of its outer loop**: an outline of 500 lines is 500 IDs in the extrusion that takes it, and its body has 500 side faces. As for any profile of that many curves. `get_sketch` prints such a loop short.
- **Not read**: ellipses and elliptical arcs, rational and periodic splines, splines above degree 3 and those given by fit points alone, blocks, text, hatches, 3D polylines, entities on a tilted plane; in SVG also CSS, `use`, nested `svg`, circles and arcs under an uneven transform, lengths in `%` or `em`. Each is listed in the report with a count, never silently.
- **A length with a unit in an SVG** is user units at 96 per inch, the rule of SVG: in a drawing whose `viewBox` makes a user unit a millimetre, `r="10mm"` is 37.8 mm. Drawing programs write such a file with bare numbers.
- **A hidden SVG element is read**, and a filled shape is its outline.
- **A DXF without `$INSUNITS` is millimetres**, an SVG without a size 96 units per inch; the report says so, and warns of bounds under 1 mm or over 10 m.
- **The reader of DXF parses the groups of the whole text before it counts curves**: a file just under the limit of characters is refused by its curves after 240 ms, not at once (I8).
- **The same outline in two sketches is stored twice** unless the second projects the first; and a projection does not carry a spline (6d), so an outline with splines that two sketches need whole is stored twice (the review, codex, on Open 1).
- **No placement that follows a body** except through parameters, and the cover of scenario 15 does not turn with its board (H6).
- **`get_sketch` and the query round positions** as everywhere; the exact numbers are in the document.

## To verify before the implementation

1. **A DXF of a real PCB tool and of a real CAD tool**: that the entities, the layer names, the units and the digits are what the reader expects. The test file is written from knowledge. From the review, also from knowledge and not checked: KiCad's DXF plot may write graphic items "using their contours" by default, each edge as the outline of its stroke and not its centre line, and in inches by default. With the first the board would read as doubled loops that lie beside each other: check a real file with both settings **before point 3**, and if it is so, have the report say it (pairs of curves a stroke width apart) and the documentation name the setting.
2. **An SVG of a real drawing program**, with its layers as groups, and one written by an optimiser (arc flags without separators).
3. **The narrowing inside the engine**: the review built it over the three functions and found it equal to the whole input (R1). The implementation repeats that comparison, `diagnoseSketch` included, and the stamps of the stored sketches of the repository's tests unchanged.
4. **The memory of the solver with the narrowed input** over a long session (F1 ran 600 drags, R1 300).
5. **The fixed join of the adapter** against every existing test of a tangency and of a projection (6b's corner of two projections gets the same form): no result may change but the case of J10.
6. **`partial` in `updateExternal`** at the stage the design names (R6 emulated the merge outside the command).
7. **The third part of the rule in a batch**: `removeConstraint` and `updateExternal` in one batch pass; the other order does not (read from the code by the reviews, not run: the rule is in no prototype).
8. **The app with an outline of 2000 curves**: the hit test, the snap and the drawing of the view, and the pickers with the limit; **before point 6** (the review, fable 15).
9. **`import_outline` through the bridge and on the server's own engine**: the same answer (the review, codex).
10. **The app's snapshots**: that only the button changes them.
11. **Whether `modules.test.ts` lets `packages/mcp` and the app import the new files as the design places them**, and that `references/outline.ts` needs nothing of `import/`.

## Tests the implementation owes

- **The kind** (`packages/engine/test/imported-outline.test.ts`): the validator's refusals, each text of `OUTLINE_REFUSALS`, the local IDs `__proto__`, `constructor` and `toString` among them, and the count of the stored curves equal to the count given; the defaults; the entities and `entityOf` of every form of ID; the placement (both anchors, a turn, a turn of 0 moving no digit); the geometry and `exactArc`, the arc tolerance at coordinates of 1e5; the value and the stamp (the flag, the name and the source do not change it; a curve or the place does); the document not holding the caller's object, and holding its own across commands; a closed spline (a region, no open end); `load` of a saved document with an outline; the older forms of a stored value still read.
- **The update**: `partial` (each field alone; left out, given, given as `undefined`; expressions kept, one in error too; `name: ''` and `source: null`; a command of another type not merged); `keepsValue` (a document saved in conflict after a move holds no stale value); the three parts of the rule, the third for a driving and a reference constraint and a control point; the batch in both orders; a mirror that loses its axis (`brokenCopies`, the document loads); a revision with kept, added, removed and renamed entities; a later projection frozen.
- **The narrowed input**: the solver's input for no, one and several named entities; an outline of circles that no constraint names, and one whose centre alone is named (the radii, on each of the three paths: a new stamp, the stamp kept, a failed solve); the order of the keys of the result; a reference dimension; the result and `diagnoseSketch` equal to the whole input for outlines small enough to compare; 2000 curves and repeated solves; the stamps of the existing tests untouched.
- **The adapter**: the tangency of J10 from either point of the corner (exact, sliding under a drag); the same for two projections of 6b; every existing test of a tangency unchanged.
- **6e, 6c, 6b, 6d over an outline** (`review.test.ts` of the scenarios where a defect was measured): the contact of an own curve with a flagged outline, a line and a spline of it (the outline's reason, split refused, ends not listed); an extension toward a spline of an outline; the flag off, then a trim with `with`; a mixed loop; a mirror about a line of an outline; projections of each kind of entity and of a control point; a spline's projection refused with 6d's text; the whole-sketch tool; `as: 'own'`; a hole on a centre refused.
- **The import**: the engine's DXF and SVG read back (the round trip to the digit); every entity type and both polyline forms; bulges of both signs and a closed polyline; a fitted polyline with its frame; the units, each `$INSUNITS` and the note of `$MEASUREMENT`; the layers; entities drawn from below, each kind, and a tilted one; `empty`, `tooLarge` by each early limit and by each limit of an outline, `unreadable` (binary, no `EOF`, a code without a value, an empty number, a section and a polyline that do not end, an entity without a group it needs, not a DXF); the report's fields; the same bytes giving the same IDs, and the IDs independent of the weld; `SPLINE` of degree 1, 2, 3, kept whole and split, knots out of order, knots a digit apart, and each reason of leaving one out.
- **The weld**: by digits (A3) with arcs untouched; the cases of the reviews as regressions: the corner of 200 lines, the chain of three ends, the arc of 359.9° and of 359°, the key hole, the arc of radius 1000 beside a line and beside an arc, two arcs with a gap inside and outside the tolerance, a curve twice either way round, a spline of three points with close ends, a spline whose end would land on its neighbour point; and as properties over generated files: no end further than the tolerance from its place in the file, no centre or radius changed by more, a file whose ends meet unchanged.
- **SVG**: each element and path command, relative and smooth forms, numbers with an exponent and without separators, the flags without separators, the degenerate arcs, lengths with each unit and with `%`, the transforms, an uneven one over each kind of shape, a reflection, the units of the root, the layers, each thing left out, and each of the files that are not whole (S5).
- **The typed tables** of the formats and of the query in `packages/mcp/test`.
- **MCP**: the tool without a sketch, with one, with `replace` (the stored options, and options given over them), refused by the rule with the report and nothing changed, with `remove` in one undo step; the same through the bridge; `get_sketch` of a small and of a large outline, its regions capped, a spline with its control points; `get_document` on its three paths; the examples of `describe_api` accepted.
- **The app**: the draft and *Place* in `app.test.ts` (a record of its own), the row, *Replace file…* through the draft with the stored options and with the constraints removed, a picker over an outline above the limit.
- **Scenario 15**: the `describe` of 6f and the assembled model, as `calls.ts`; the placement on its own model.

## Open

Both questions stand for the owner. The three reviews agree with both recommendations, each with conditions, which this revision takes in.

1. **Where the outline is stored.** The plan says "stored in the document (like a stored mesh of D55)" and expects a section with a schema step. This design stores the curves in the entry that places them: one place, no step, `entityOf` from the sketch by construction, the update of the entry as the revision. *Recommendation: in the entry.* What a section would give, one outline placed in several sketches, a projection gives already, but for an outline with splines, which a projection does not carry (codex).
    - Checked by the review: the build before 6f refuses a document with an outline twice over, by the entry and by its stored value, so no step is needed and `SCHEMA_PENDING` stays 0; the object of the curves is shared by every document of the undo stack.
    - The reviewers' conditions, met: the options of the import are stored in the entry (`source`), and the validator copies what it is given.
    - A section can still come later: an entry could name one in the place of `curves`.
2. **What `import_outline` does.** The plan says it "answers with the batch". This design has it send the command (and only report without a sketch), because the batch would carry every curve to the caller and back, up to 140,000 characters each way. *Recommendation: it sends the command.* `import_mesh` changes the document already (it stores the mesh), so this is the pattern that exists.
    - The reviewers' conditions, met: without a sketch it only reports; a refusal still answers with the report; a replacement names its entry, reads the file with the stored options, and has a way past the rule of an update in one batch (`remove`); the answer lists what a swap renamed; the same answer through the bridge and on the server's own engine (a test the implementation owes).

## Reviews

### The review of the design, 2026-11-25 (Fable, `codex`, `agy`)

Three independent reviews of the design at `76d3c09`, read-only. Fable ran probes of its own against the real engine (the narrowing built inside the engine, `bsplineBeziers` against de Boor, the build before 6f on a document with an outline, the partial update, the weld, a replacement, `get_sketch`); its numbers are the rows R of "Measured". `codex` ran the prototype in memory. `agy` read the code. None found a blocker in the two structural choices (the outline in its entry, the narrowed input), and all three agree with both recommendations of "Open". 47 findings, most in the import and in what surrounds the kind. Each was checked: confirmed by a probe of this revision (rows I, S, J, H4, H6), confirmed in the code, or refuted.

**The import.** The prototype's weld and both readers were rewritten, and the design follows them.

| Finding | By | Outcome |
|---|---|---|
| The weld is transitive: an end can move by any distance, a fine corner collapses | fable 1, codex 2 | Confirmed. The weld is bounded: met ends never move, an open end goes onto one end within the tolerance, no chain (J1, J2). "The weld" |
| An arc re-centred on its chord's bisector can change wholly (radius 1000 to 912) | codex 3 | Confirmed. Arcs keep their file's centre; one is moved only where two arcs meet, and only within the tolerance for centre, radius and sweep (J4, J5) |
| An arc of nearly a whole turn is dropped | fable 2 | Confirmed. It is a circle (J3); an `ARC` of a whole turn already in the reader (I5); an open spline closed onto its start |
| A spline of three points welded shut, or an end moved onto its neighbour point, is refused by the validator; a weld of 0 | agy 6 | The first two confirmed and excluded by the weld. The third is no defect (the prototype guarded it); a tolerance under 1e-6 is 0 now, stated |
| A curve twice in a file gives an invalid profile and a report that says nothing | fable 12 | Confirmed. Left out and counted (J6) |
| A broken or truncated file is read in part | codex 5 | Confirmed for SVG and for the last group of a DXF. Not whole is `unreadable`, with the place; not read is listed (I1, S5) |
| `SPLINE`: knots not checked before `bsplineBeziers`; fit points; a break; unclamped | codex 6, agy 4, fable 9 | Confirmed (I6). The reader checks the whole structure; knots a digit apart are one; pieces without extent dropped |
| A cubic with even knots is one spline of 6d; pieces count to the limit | fable 9 | Taken: kept whole for 4 to 64 control points (I6b). A periodic spline could be read by clamping: left out and listed, a backlog row |
| The SVG reader splits on letters (`1e1`), misreads compact arc flags, divides by zero for equal ends; lengths with units | codex 7, agy 5 | Confirmed. A tokenizer of the document and of path data (S1 to S4) |
| `S`, `T` and a round `ellipse` are in the design and not in the prototype; an uneven scale over a circle gives a broken arc | agy 5 | Confirmed. In the prototype now (S6 to S8); circles and arcs under an uneven transform listed, lines and splines read |
| DXF: 230 < 0 mirrors `ARC`, `CIRCLE`, `LWPOLYLINE` and not a 2D `POLYLINE`; tilted planes; `LINE` and `SPLINE` | agy 3, fable 17 | Confirmed (I3). The entities in their own plane are mirrored, the two in world coordinates never; a tilted entity is listed |
| DXF: frame vertices of a fitted polyline; text after `EOF`; an empty number read as 0; `$INSUNITS` 13 and 14 a dead end; `$MEASUREMENT` | fable 17 | Taken, each (I1, I4, I7) |
| The 2000 curves are not the bound the measurements imply: 2000 splines of 64 points are legal; the count comes after the weld | codex 10 | Confirmed (J12: 440 to 720 ms a change). A limit of control points per outline; the readers refuse early by characters, curves and control points (I8, S9); the timings are called measurements of the files, not bounds. No budget per sketch: several outlines add up, a known limit |
| A swap of IDs can be found cheaply | fable 13 | Taken: `renamed` (J11) |
| KiCad may plot contours, and in inches | fable 18 | Not checked by anyone. "To verify", 1, before point 3 |

**The kind and the engine.**

| Finding | By | Outcome |
|---|---|---|
| The narrowed input must put back the radii, not the points alone, on every path of the step; in one order | agy 1 (blocker), codex 1, fable 5 | Confirmed in the code (`placedCurve`); the emulation merged both, so the measurement stands and the text was wrong. Stated; built inside the engine by the review and found equal (R1) |
| `partial`: the stage of the merge, `undefined` fields, a field cannot be cleared, only for an entry of that type | agy 2 (blocker), fable 7 | Taken, each. Checked by the review's probe (R6) |
| `keepsValue` always true leaves a stale value in a document saved in conflict | agy 8 | The reviews differ: fable finds it safe (the stale value is never used). Both hold; the value is dropped when the place or the curves change, as 6b's kind does |
| The validator keeps the caller's object, and serialises the outline twice at every command | fable 8, agy 9 | Confirmed (R6, R8). A copy once, remembered in a `WeakSet` (J8) |
| The cache of the geometry has one slot per object of curves | agy 10 | Confirmed in the prototype. Kept per entry |
| A local ID `__proto__` is accepted and the curve vanishes | codex 4 | Confirmed (J7). The rule of `newId`, and own-property look-ups |
| The points per curve: a tangency at a corner gets the form of a double root | agy 7 | Confirmed in a milder form than stated (J10): no conflict and no redundancy is reported, but the line is 4e-5 mm off and does not follow a drag. The adapter takes two fixed points at one place for one end. Fable and codex found the per-curve IDs consistent, which they are for everything else |
| A closed spline of an outline is reported as open | codex 12 | Confirmed (J9). One condition in 6c's stage |
| `contactFix` answers for a spline before a flagged curve; `extend` looks for a spline among own curves; `namedOutside` walks the curves | agy 11, 13 | Confirmed in the code. Three conditions |
| `ruleProblem` must not list the entry | agy 12 | Taken: by name through `entityOf` |
| `Projected` should stay positions | fable 11 | Taken: `StoredValue` |
| The arc tolerance is absolute | fable 16 | Taken: relative, as 6b's |
| The rule of an update: a mirror's axis is not covered; `removeExternal` differs; no listing | fable 6 | The first measured by the review (R4) and stated as intended; the others stated |
| "The sketch is not solved again" for the flag | codex | Worded: the stamp is kept; the solver runs for the diagnosis |
| Names that are taken (`OutlineCurve`, `outline.test.ts`, `export/outline.ts`) | fable 10 | Confirmed. `ImportedCurve`, `imported-outline.test.ts`, `import/outline-formats.ts` |

**MCP, the app, the scenario, the plan of work.**

| Finding | By | Outcome |
|---|---|---|
| A replacement forgets the layers, the unit and the weld | fable 3, codex 8 | Confirmed (R9). `source` in the entry; the tool and the app repeat it; the app's replacement always through the draft; the IDs before the weld |
| The rule of an update says "in the same batch", and the tool has no batch | codex 9, fable 6 | Confirmed. `remove`; the checkbox of the draft |
| `get_sketch` is capped in `external` only (its regions: 33,841 characters); `get_document { feature }` passes the feature whole | fable 4, codex 14 | Confirmed (R7). The regions capped; one helper on the three paths of `get_document`; the revision computed where the engine is. agy found the whole curves in `get_document` acceptable: not followed |
| The control points of a spline are not in the bounded answers | codex 13 | Taken: `control` in the rows of the query and of `get_sketch` |
| The pickers of the app limit derived entries only; the view with 2000 curves is not measured | fable 15, agy 14 | The first confirmed and taken; the second is "To verify", 8 |
| The quarter turn of the board in the assembled scenario fails | codex 11 | Confirmed (H6). The case runs on the model where it was measured; the cover is not made to turn |
| Count 3 is previewed, so 5 is not a recovery | codex 15 | Confirmed. Executed (H4) |
| Point 1 does not compile without the app's row and the kind's description; the documents are all in the last point | fable 14 | Confirmed (`REFERENCE_UI` is typed by `ExternalRef['type']`). The row and the description with point 1; documents with each point; point 7 full by the table |

**Not taken, and why.**

- agy's recommendation on "Open 1" answers another question (whether the weld re-centres an arc); the design's Open 1 is where the outline is stored. Its answer on the weld is superseded by the bounded weld.
- agy's "area 8" describes a scenario 15 (a window cut, a lip, hardware holes, an SVG logo placed with a scale) and a plan of four points with their own depths, and an `entryCurves` with a `box` filter and a `get_sketch` limit of 40; none of them is in the plan or in this design. Its "schema version 15" is 10. Nothing was changed for these.
- agy's concern that a new stamp function changes the stamps of stored sketches: the design changes the stamp of no existing kind, and the review's probe found them identical (R1).
- codex's "profile sampling budget": the limit of control points bounds the samples of one outline; a budget across the entries of a sketch is not added (a known limit).
- A numeric scale as a unit option, and reading periodic splines by clamping: "Rejected alternatives".

**What changed in the files**: `design.md` (the weld, the readers, the value, the narrowing, the tangency at a corner, the update and `partial`, validation, MCP, the app, the scenario, the points of work, the limits, and the rows I, S, J, R, H6 of "Measured"); `contract.ts` (`ImportedCurve`, `OutlineSource`, `StoredValue`, `FIXED_JOIN`, the limits, the report, `weldOutline`, `outlineRevision` with `renamed`, `outlineInto`, `remove`, the capped rows, the draft of a replacement); `calls.ts` (count 3 executed, the placement on its own model, `weldBounds`, `closedSpline`, `cornerTangent`, the spline kept whole, the tool with stored options and `remove`, the refusals of broken files and of `__proto__`); `probes/` (the weld and the validator of `proto.ts`, `dxf.ts` moved out and hardened, `svg.ts` rewritten, the new probes `i`, `s`, `j`, probe H executing count 3 and turning the board).

Not reviewed again: this revision. The parts no prototype runs are those of "Measured", the recipe.

## Rows for the indexes

Not written by this package's branch before the merge; the texts for whoever merges.

**docs/d36/README.md**, the row of 6f, column "Design now":

> full ([6f-outline-import/design.md](6f-outline-import/design.md), D72), designed 2026-11-25 with prototypes against the real engine, reviewed the same day (Fable, `codex`, `agy`) and revised: a reference kind of entry of `external`, `outline`, holding the curves of a file in the entry (no section, no schema step) and placed by the numeric fields `x`, `y`, `turn` and an anchor (origin of the file or centre of its box); entities `<entry>/<local>` numbered by kind in the order of the file; the flag `regions`, default true; a revision is `updateExternal` with the new curves, refused while a constraint names an entity that goes; the solver gets only the entities the constraints name; the adapter takes two fixed points at one place for one end; a second catalog `OUTLINE_FORMATS` (`dxf`, `svg`) with a bounded weld of open ends, early limits and a report; the options of the import stored in the entry; the tool `import_outline` (with `replace` and `remove`), the query `entryCurves`; scenario 15 assembled

**docs/decisions.md**, the row of D72:

> | D72 | [6f Import of an outline](d36/6f-outline-import/design.md) | designed 2026-11-25; reviewed by three reviewers and revised the same day; not implemented | An imported outline is a reference kind of entry of `external`, `outline`: the curves of a DXF or SVG file (lines, arcs, circles, splines) stored in the entry in the file's coordinates and placed by three numeric fields and an anchor; fixed for the solver, which gets only the entities constraints name; entities `<entry>/<local>` with points named by their curve, IDs by kind and order of the file; regions by a flag, default true, ends joined by position; a revised file is an update of the entry, refused while a constraint names an entity it drops; hand-written readers in a second catalog of formats with a bounded weld (0.01 mm: an open end onto one other end, never further), limits and a report, a file that is not whole refused; the options of the import stored in the entry; the MCP tool `import_outline` sends the command; no schema step. Alternatives: a section of the document, own geometry tied by `fixed`, IDs from geometry, the whole outline in the solver, a transitive weld |

**docs/requirements.md**, validation scenario 15, the sub-item after the one of 6d:

> - *The board from a file, and the whole (6f, D72).* The board is imported from a DXF written as a PCB tool writes an outline (the layer `Edge.Cuts` of three, page coordinates), placed by the centre of its box on the origin and extruded from its region; the skeleton, the base, the lid (held on projections of the board's sides), the vents and both notches are built on it in one document. `vents` 7, then 3 (the cut reports the region it lost), then 5 (it is back); a revised file 2 mm wider replaces the outline, read with the stored layers, and no feature is in error (the board +128, the base +212, the lid +216 mm³; the hole pair 27.5 mm from the axis); the volumes of the board and the base against the values by hand; the section of the lid exported as DXF and read back has the section's area within 0.1 mm².

**docs/architecture.md**, the list of sections: in the row of `architecture/sketch.md` add "an imported outline (D72)"; in the row of `architecture/api.md` add "`importOutline` and the outline formats"; in the row of `architecture/ai.md` add "`import_outline`".

**docs/ui.md**, the row of the sketch panel: add "*Import an outline…*, the row of an outline with *Replace file…* (D72)".

**docs/backlog.md**, new rows: an own outline over an import in the same sketch by a tool (with 6b's row on a projection taken over); a placement of an outline on a point of reference geometry; a mirrored placement; matching a revised outline by geometry or by the handles of its file; ellipses and rational splines; periodic splines read by clamping (exact, by the review's probe); blocks of a DXF and `use` of an SVG; a budget of profile points across the entries of one sketch.

# 3e Parts list (D57)

**State: designed on 2026-11-17, not implemented. Fourth version, after three rounds of reviews ("Reviews").** Written against the code of `master` at `633a6ca` and checked again at `c2a506c` (between them only the writer of 3MF and of ZIP and an optional compressor of the engine and of the context of a query changed, none of which this package reads): the catalog of queries and of export formats of the preparatory step (D37), the body properties of 3a (D48), the hole feature and the hardware catalogs of 2c (D46), the linear pattern and the mirror of 2e (D53) and the mechanism of 5a (D49) are all in the code. The entry of the query was prototyped in the session scratchpad and run with the real adapters over the arm of scenario 13, the box of scenario 12 and the cases of the reviewers; the numbers are under "Measured". Nothing under `packages/` was changed.

Files: [contract.ts](contract.ts) (the query, its result, the export format, the origin of a copied mesh, the view of the app as stand-ins), [calls.ts](calls.ts) (the entry of the query and the writer of the file written out against the real context of a query, and the part of validation scenario 13). Both are checked by `npx tsc -p docs/d36/tsconfig.json`.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Compared with Onshape, FreeCAD and Fusion": *Parts list. A query: bodies with their properties, reference parts, and hardware from the labels of hole features with counts. What to print and what to buy. Step 3.* The designs of 3a and 2c each left it a sentence: 3a's table of readers ("Parts list (3e): `name`, `material`, `use`, `mass`; printed parts and bought parts; auxiliary bodies are not parts") and 2c's `label` ("The parts list of 3e counts it: once per point and per copy of a pattern"). 2e added that a mirrored copy is another part than its source while a row of copies is one part several times.

| Statement | What the code says |
|---|---|
| "Bodies with their properties" | `evaluation.bodyProperties` has, for every body of a state, the name, the colour, the material, the use, the density and the mass with what a copy inherits, and `massFrom` (`sections/body-properties.ts`). The context of a query keeps it (`context.state.evaluation`). Nothing has to be resolved again |
| "Reference parts" | The use of a body is `part`, `reference` or `auxiliary` (D48). A motor is `reference` with the mass of its data sheet in `mass`. An auxiliary body has no mass and is no part |
| "Hardware from the labels of hole features" | `HoleFeature.label` is an optional text of at most 200 characters; the engine never reads a number out of it (D46). The query `hardwareHole` writes five labels: four name a piece (`<size> socket head cap screw`, `<size> countersunk screw`, `<size> hex nut`, `<size> heat-set insert`), the fifth names the hole (`<size> clearance hole`). None has a length: a hole does not know how long its screw is |
| "With counts", 2c: "once per point and per copy of a pattern" | That count cannot be read off the document. A point may miss the targets: `applyTool` knows what a tool did per target, not per point, and a hole feature with one point outside its bodies is `ok` with no warning (measured). A copy of a pattern of features may change nothing (`noEffect`, with the copy in `refs`). A later cut may remove a hole whole. And a pattern of a body copies the body with its holes, which no hole feature and no pattern of features says |
| "Copies of patterns counted" | `bodySource` of the registry (D48) says which body a copy takes its properties from; only the pattern sets it today. It does not say that the copy still has the shape of its source: a feature after the pattern may change the source or one copy. What does say it is in the recompute: a pattern of a body makes each copy by `transformSolid` (`solid.ts`, its one caller), and a body keeps its `Solid` object until a feature changes it (`applyTool` leaves the object of a target it did not change) |
| "A query" | A module in `query/` and a line of `QUERIES`; no method of `Engine`, no tool. A query reads the geometry of bodies from its context, in the pose of the state, and a body whose pose is not known cannot be read (D49); an entry may say `geometry: 'modelled'` |
| "Perhaps an export format (CSV)" | A module in `export/` and a line of `EXPORT_FORMATS`; a format returns files and runs over the context of a query with the bodies as modelled. The tool `export` and the menu *Export…* of the app list the catalog, so a format needs no code in either |
| "The app's view of the query" | Without a view the generic form shows the answer as a tree; `QUERY_VIEWS` gives a query rows of its own, additions to the scene and a note. `immediate` asks a query without required arguments as soon as its form opens |

The comments of `types.ts` at `label` and at `material`, and the label field of the hole form of the app, already say "for a parts list".

## The cheap variant

- **One query, `partsList`, without arguments**, over the state asked about: three lists and their sums.
  - `printed`: the bodies with the use `part`, as rows of parts with material, colour, volume and mass.
  - `bought`: the bodies with the use `reference`, the same rows.
  - `hardware`: the labels of the hole features, with the holes the model has for each.
- **A body and its copies are one row with a count** while they are one mesh, moved: a body a feature changed after the pattern leaves the row, a mirror image is a row of its own, and the properties and names of a row agree.
- **Hardware is counted from the model**: one piece per hole that is there, by the line of its axis and how far along it the hole reaches, read from the faces of the bodies.
- **One export format, `partsCsv`**: the same answer as one table in a file.
- **The view of the query in the app**: the three lists as rows; a picked row shows its bodies or its holes.
- **The origin of a copied mesh, `shapeOrigin`**: `transformSolid` remembers what a solid is a copy of.
- **The name of a kind of part, `partName`**: the nearest name of its own on the chain of sources.

**Deferred**, none blocked by what is designed here:

- A description of the piece on the hole feature (kind, size, length) in place of a free text, and with it masses and a catalog of the pieces themselves. See "Rejected", 2.
- A list of bodies as an argument (the parts of one link). The rules below work on any set of bodies; nothing in scenario 13 needs it.
- Items that are not modelled (a cable, glue, a power supply). They would be a section of the document.
- Copies that were changed alike after the pattern as one row ("Known limits"), and bodies that are the same part without being copies of one another (two extrusions of one sketch). See "For the later packages".
- A mirror image recognised as the same part when the part is symmetric.
- A mark on a copy that is a print layout and not a part of the assembly.
- A fallback density or a fill factor for parts that state no mass (the mass query has both).
- Prices and suppliers; a CSV for a locale that writes a decimal comma; other formats of the table.

## The query

`partsList` (`contract.ts`: `PARTS_LIST_ARGS`, `PartsList`, `PartRow`, `HardwareRow`). It has no argument. It answers for one state like every query: now, `at` a feature, or a state a preview returned, so "what would the list be with six screws" is one preview and one question, nothing written.

**As modelled.** The entry says `geometry: 'modelled'` (D49). A parts list does not depend on a pose, and an entry that reads the bodies in the pose would fail for a mechanism with a joint that has no motion, where the bodies beyond it cannot be read (measured: the mass of the forearm fails there, the parts list answers).

**Every body of the state is in exactly one place**: a row of `printed`, a row of `bought`, or the list `auxiliary`. A reader can check the list against `get_model`.

### Rows of bodies

Two bodies are in one row when all three hold:

1. **One mesh, and the same hand.** Their solids have the same origin (`shapeOrigin`, below), and both are that mesh moved or both its mirror image. `padXY/1` of scenario 12, the mirror of a mirror, has the hand of `pad`; `padX/1` and `padY/1` have the other. A body whose volume is not above zero is taken for no copy (below).
2. **The same properties**: the use, the material, the colour, the density, and what the body weighs by: the mass the body properties resolved, by its source and its number (a stated mass, or a density); without a mass, whether a field is in error or nothing is stated. They are the resolved properties, so a copy that inherits everything agrees with its source. A mass that is stated beside a density in error is a mass.
3. **The same name** (`partName`): the name of its own of the nearest body of its chain of sources (the body first, then its source, over `bodySource`), else the default name of the body the chain starts at (after its feature). It reads the document alone, so it holds when that body is not in the state.

**The origin of a mesh.** `transformSolid`, which a pattern of a body makes its copies with, remembers of the solid it returns which solid it was made from and whether the transform mirrors, by the identity of the copy and weakly, as `analyzeBody` keeps its result by the identity of a mesh. `shapeOrigin(solid)` follows the records to the solid the chain starts at and says whether `solid` is its mirror image (an odd number of mirrors). A solid that is no copy is its own origin.

It answers "is this copy still the part its source is" by what the recompute did, with nothing measured:

- A body keeps its `Solid` object for as long as no feature changes it: `applyTool` leaves the object of a target its tool did not change, a pattern of a body leaves its source, and every step carries the other bodies over. A feature that changes a body gives it a new object, which is a copy of nothing.
- So a copy and its source are one row while neither was changed after the pattern. A notch cut into one foot makes that foot a row of its own; a cut into the source makes the source one and leaves the copies together; a cut that misses changes nothing (all measured).
- It holds for a state after a feature, for a preview, after undo, redo and a load: the copies of every state were made by `transformSolid` in the replay that computed that state, and the record lives with the copy (measured). The memo of the steps is keyed by the previous state, so a step is reused only with the same source object; the answer is a function of the document.
- **It errs one way only.** Two bodies changed after the pattern are never one row, also when they were changed alike (the same hole cut into each of three copies afterwards: three rows). A list that says "one of each" where it could say "× 3" costs a look; one that says "× 2" of two different parts costs a print. The conventions of the pattern already say what avoids it: what every copy should have is modelled before the pattern.
- **It says what the recompute did, not what float32 holds.** `transformSolid` writes the moved positions as float32. A copy moved so far that float32 cannot hold its shape is still a copy of its origin by the record: a pin of radius 2 copied 10⁸ mm away and back has the volume 0 in both copies (measured). **The list takes a body whose volume is not above zero for no copy**: it is its own origin, so such a copy is a row of its own, "differs from `pin`", with its volume 0 in sight, and the mass of a row is never the source's times copies that have none. The check can only split a row, never join one, so it brings back nothing of the fingerprint of "Rejected", 6. A copy distorted short of losing its volume is not seen: no bound on the volume is principled there (at 10⁸ mm a step of float32 is 8 mm), and at 10⁵ mm the copies keep their shape to 3 × 10⁻⁵ of the volume and are one row, rightly. Such bodies are broken for every query and export of the engine, which says nothing about them today; a warning belongs to the pattern ("Known limits").
- The record is weak and keyed by the identity of the copy, so two engines in one process or a state handed out earlier cannot meet in it, and it keeps no solid alive that the chain of states of a document does not keep already (the internal reviewer of round 2).

The first version of this design compared the number of triangles and the volume of a copy and its source. Both reviewers built parts it took for one: a hole at another place of the copy, a left and a right pocket, a source trimmed while its copy stood far from the origin ("Reviews", round 1; "Rejected", 6).

**The name of a row.** Body properties do not inherit a name (D48: a copy is "Screws / 2"), which is right for a body and wrong for a kind of part: three copies of "M3x6 screw" are the row "M3x6 screw". A copy with a name of its own is a row of that name, and the copies of that copy have its name, as they have its colour and its material: a copy named "special" and a row of three of it are "special × 3", not two rows under two names (round 2).

**What a row comes from.** A row whose first body has a chain of sources that starts at a body of the state outside the row names that body in `copyOf`, with one of three readings, in the note of the file and in the view:

| The row and the body it comes from | `copyOf` with | Note |
|---|---|---|
| one mesh, the same hand (the row has other properties or another name) | nothing more | copy of `<body>` |
| one mesh, the other hand | `mirrored` | mirror image of `<body>` |
| not one mesh any more: the row's bodies or that body were changed after the copy | `differs` | differs from `<body>` |

A changed row says no hand: its shape is its own. A row whose source is not in the state (3d: a body used up by a boolean) has no `copyOf`; its name still comes from the document.

**The mass of a row**: `mass` and `massFrom` of the first body as the body properties resolved them, and `totalMass`, the sum over the bodies. A row whose bodies have no mass says why in `noMass`: `notStated` (neither a mass nor a density) or `inError` (the field that would be used cannot be evaluated; `get_model` has the message in `bodyPropertyErrors`). The bodies of a row weigh by the same, so all of them have a mass or none has. The query does not fail for a body without a mass, unlike the mass query: a list with one row without a mass is still the list. The sums count such bodies in `withoutMass` and leave them out of `mass`, so a sum never looks complete when it is not.

The rows are in the order of their first bodies in the model. `volume` is that of the first body.

### Hardware: holes counted from the model

A hole is there when its bore or its head (`holeBore`, `holeHead`: a cylinder or a cone) is a face of a body of the state that is not auxiliary. The faces carry what is needed: the feature, the point, a copy tag per pattern that made or copied them (`FaceName.copy`), their exact surface with its axis, which a pattern of a body moves with the copy (`transformFace`), and their triangles.

- **A cut** is what one build of a hole feature left in the bodies of one placement: the faces of that feature with the same point and the same copy tags, in whichever bodies they are. One build gives one face number in every target, so a bore through two bodies, or through the two flanges of one body, is one cut, and **a cut is always one hole**. A copy of a pattern of features starts its tags with that pattern (`build` of the hole gives it `copy: [placement.copy]`), and a copy of a body made afterwards adds its own tag: each is a cut of its own. A later cut that splits a bore keeps its face number, so the two pieces stay one cut (measured).
- **A cut has a line and an interval of it per body**: the axis of its surfaces, and in each body the interval from the lowest to the highest point of the triangles of its faces there, measured along the line. The gap between two bodies of one cut is in no interval.
- **Two cuts of one feature are one hole when they lie on one line and an interval of one touches or overlaps an interval of the other**, joined one after the other (a stack of three copies is one hole). The count of the feature is the number of its holes.
  - A copy of a body at another place is another hole, also one further along the same line: two walls 100 apart, each with its hole, are two holes. So is a copy laid into the gap of a cut through two bodies (round 3: one interval over the whole cut had swallowed it).
  - A copy that continues the hole is the same hole: a plate copied onto itself, a half mirrored in the parting plane.
  - A copy of a pattern of the feature that cuts its own hole again (a pattern about the hole's own axis: the turned polygon cuts slivers, so the copy is `ok` and not `noEffect`) is the same hole.
  - Two blind holes on one axis with material between them are two, however they were made.
- **Two lines are one** when they are parallel within `ANGLE_TOLERANCE` and the point of one lies on the other within the larger of `LENGTH_TOLERANCE` and 10⁻⁹ of the larger distance of the two lines from the origin. The surfaces are moved in double precision, so lines meant to be one differ by far less; the bound does not depend on where on a line its point lies (round 2: with 10⁻⁶ of the coordinates, two holes 5 apart at z = 10⁷ were one line; round 3: with 10⁻⁹ of the coordinates, two holes 0.5 apart at z = 10⁹ still were).
- **Two intervals touch** within 10⁻⁶ of the coordinates of their triangles as the line sees them (for each axis, the component of the direction times the largest coordinate along that axis, summed), 10⁻⁶ mm at least: the triangles are float32, and only the coordinates along the line move a point along it. A gap of a thousandth of a millimetre between two plates is a gap while the coordinates along the hole stay under a metre, wherever the plates stand across it (round 3: the bound had taken every coordinate, and the gap closed at x = 1000).
- **The cost** is a pass over the triangles of the bodies that have a bore or a head, and a comparison of the cuts of each feature in pairs: the box of scenario 12 takes 2 to 5 ms in all. A feature with many points in many copies is quadratic in its cuts (100 points in 50 copies is about 12 million pairs), which "To verify" names.

What follows, each measured ("Measured", the holes): a counterbore through two plates at two points is 2; with the upper plate copied to a row of three it is 6, and still 6 when the lower one is copied to the same places; copied to other places, every place counts; a pattern of the hole doubles it, and a copy of that pattern that runs off the plates adds nothing; a third point outside the plates adds nothing; a pocket cut over one of the holes later takes it out of the count; a plate with a hole copied twice onto itself has one hole, whether the hole is cut before the copies or after; a hole patterned about its own axis is one; two blind holes on one axis are two.

The first version counted by the copy tags of the faces alone; the second counted every application of a feature (a point, cut by the feature or by a copy of a pattern of features) once per axis; the third took one interval over all the bodies of a cut. All three counted wrong in cases the reviewers built and ran ("Reviews"; "Rejected", 7).

**The rows** join hole features by the exact text of their label, in the order of the timeline, each with its holes (`holes: [{ feature, count }]`), so a reader sees which feature to change. A hole feature without a label that made holes is in `unlabelled`, with its count: such holes are either pieces the list is missing or holes that hold nothing, and the reader decides. A feature that made no hole (in error, suppressed, missed) is in neither.

**What a label is.** The label is the name of the piece that goes into the hole, as its user wrote it. The engine counts labels and reads nothing out of them (D46 stands). The label `hardwareHole` gives is a start: what the catalog does not know is typed into it ("M3x10 countersunk screw"), and a hole that takes no piece of its own gets none. One paragraph of the conventions of `describe_api` tells an AI so (`CONVENTION` in `contract.ts`), in words that agree with the summary of `hardwareHole`.

Hardware has no mass: the hardware catalogs hold the sizes of holes, not of pieces, and a screw weighs by its length.

## The export format `partsCsv`

One file, `parts.csv`, media type `text/csv`, layout `file`; no option. The entry runs the entry `partsList` with the context of the export (as `outlineOf` runs `section`), so the file and the query cannot disagree.

- CSV as RFC 4180 describes it: UTF-8 without a byte order mark, records end with CR LF, a header record, the same nine fields in every record.
- A control character of a text (U+0000 to U+001F and U+007F: a tab, a line break; names and labels may hold them) is written as a space. (`xmlText` of 3MF writes a tab and a line break as a space too, and drops the others.) A field with a comma or a double quote is quoted and its quotes doubled.
- The columns: `Kind` (`printed`, `bought`, `hardware`), `Name` (the name of the row; for hardware the label), `Count`, `Material`, `Colour`, `Mass each (g)`, `Mass total (g)`, `Note` ("copy of `<body>`", "mirror image of `<body>`" or "differs from `<body>`" for a row with `copyOf`, as "What a row comes from" says), `IDs` (the bodies, or the hole features, separated by a space). A cell without a value is empty.
- `IDs` is for a reader who looks for the bodies in the model. An ID may itself hold a space, so a program takes the bodies from the query.
- Numbers have a decimal point and no exponent: a mass is rounded to six significant digits, as the tools print it, and written by `plain` of `export/text.ts` (also from 10²¹ on, where `toFixed` would write one).
- No record of sums: a spreadsheet sums the column, and a sum over rows without a mass would need its footnote.
- `about`: `rows` and the rows of each kind. `empty` when the list has no row at all (`the model has no part and no labelled hole to list`); a tool that writes files refuses with the text.
- `csvField` joins the texts of a file in `export/text.ts`.

## What the package adds

| To | What |
|---|---|
| The document | Nothing: no field, no section |
| Commands | None |
| Queries | `partsList` |
| Export formats | `partsCsv` |
| Feature types, the registry | Nothing |
| Face roles, issue codes | None |
| The engine | No method of `Engine`. `transformSolid` remembers its source; `shapeOrigin` in `solid.ts`; `sourceRoot` beside `bodySource` in `features/index.ts`; `partName` beside `defaultName` in `sections/body-properties.ts`; the types of the answer and `csvField` in the index |
| MCP | No code but one paragraph of `CONVENTIONS` in `api.ts`. A row in each of the two typed tables of `queries.test.ts` and of `export-formats.test.ts` |
| The app | The view `queries/parts-list.ts` and a line of `QUERY_VIEWS` |

## Where the code lives

| File | What 3e does there |
|---|---|
| `solid.ts` | `transformSolid` records the solid a copy was made from and whether the transform mirrors; `shapeOrigin` |
| `features/index.ts` | `sourceRoot(doc, body)` |
| `sections/body-properties.ts` | `partName(doc, body)`, beside `defaultName`, which it uses |
| `query/parts-list.ts` | new: the arguments, the types of the answer, `holeCounts`, the entry |
| `query/index.ts` | one line of `QUERIES` |
| `export/parts-csv.ts` | new: the entry of the format |
| `export/text.ts` | `csvField` |
| `export/index.ts` | one line of `EXPORT_FORMATS` |
| `index.ts` | the exports |
| `packages/mcp/src/api.ts` | the paragraph of `CONVENTIONS` |
| `packages/mcp/test/queries.test.ts`, `export-formats.test.ts` | a row in each typed table |
| `packages/app/src/queries/parts-list.ts`, `queries/index.ts` | the view and its line |
| `docs/architecture/api.md` (the queries, the export formats), `pattern.md` (a copy and its origin), `hole.md` (the label), `docs/ui/queries.md` (the view) | the documents of the areas |

The imports go the way `modules.test.ts` guards: `query/*` and `export/*` read `solid.ts`, `features/index` and `sections/body-properties.ts` (as `query/print.ts` and `export/bodies.ts` do), not the other way.

## The app and MCP

- **MCP.** The query is reached by the tool `query` (`{ query: 'partsList' }`, with `at` and `after`), the format by the tool `export` (`{ format: 'partsCsv', path }`); `describe_api` lists both from their entries. A tool puts no note about a pose beside the answer of an entry that says `geometry: 'modelled'`. The answer is short: a row per kind of part, and the IDs of the bodies once.
- **The app.** The menu *Queries…* lists the query by its title. Its view (`PartsListView` in `contract.ts`, written out in `calls.ts`):
  - asked as soon as its form opens (`immediate`);
  - three groups under their headings, *To print*, *To buy*, *Hardware*, each a row per row of the answer: "M3x6 screw × 4" with the material, a patch of the colour, the mass of one and of all, and what the row comes from (copy of, mirror image of, differs from); then the sums, the hole features without a label and the auxiliary bodies, each only when there is something to say;
  - a picked row of bodies draws its bodies in the colour of a selection; a picked row of hardware paints the bores and heads of its hole features in the bodies that are parts, the faces the count was taken from (looked up in the state the answer is of, not computed);
  - the note of the status bar counts the three.
- The menu *Export…* lists `partsCsv` by its title; a format without options has a form with its button alone, and the file is saved under `parts.csv`.

## The schema

The package changes nothing a document holds, so there is nothing an older build could drop and no upgrade step. A build without the package refuses the query and the format by name (`invalidArguments`, "there is no query").

## Measured

**The recipe.** A prototype of the entry (it is `runAsWritten` of `calls.ts`) and spike files, run by Vitest with the real solver and kernel adapters from the session scratchpad:

- the first version against the sources of the worktree at `633a6ca` (`npx vitest run --config <scratchpad>/3e/vitest.config.mjs`, a config whose `root` is the worktree and whose `dir` is the scratchpad);
- the second, third and this fourth version against a clone of the branch in the scratchpad with the engine side of `shapeOrigin` applied: twenty lines of `solid.ts` (the record in `transformSolid`, a `WeakMap`, the function) and two exports. The prototype of the fourth version is `runAsWritten` and `holeCountsAsWritten` of `calls.ts` but for reading `evaluation.faceSurfaces` where they call `context.surface`, which is the same value in a modelled context.

The models: the arm of scenario 13 (`packages/scenarios/test/arm.ts`) with the properties of the part of 3a and the inserts and feet of `calls.ts`; the finished box of scenario 12 (`box.ts`, every step of the part of 2e with the pads and the lids in a row); and small models made for one rule each, among them every case the reviewers of the first two rounds built. Nothing of it is in the repository. The sizes of the holes of the small models are made up (a plain hole of 4, a counterbore of 4 with a head of 7 by 3); they are no size of any piece.

**The arm** (11 bodies, 64 faces; the answer takes 2 to 3 ms):

| Row | Count | Each | Total |
|---|---|---|---|
| printed: base (PETG) | 1 | 36.4016 g | 36.4016 g |
| printed: upper (PETG) | 1 | 155.046 g | 155.046 g |
| printed: forearm (PLA) | 1 | 153.175 g | 153.175 g |
| printed: foot (TPU) | 3 (`foot`, `feet/1`, `feet/2`) | 1.31686 g | 3.95059 g |
| bought: NEMA 17 motor | 1 | 280 g | 280 g |
| bought: M3x6 screw (steel) | 4 (`screw`, `screws/1` to `screws/3`) | 0.9 g | 3.6 g |
| hardware: M3x3x4.5 heat-set insert | 4 (`inserts`: the hole and three copies of its pattern) | | |
| hardware: M4x3x5 heat-set insert | 3 (`footHole`: one hole, in the body and its two copies) | | |

Sums: 6 printed bodies, 348.573 g; 5 bought, 283.6 g; 7 pieces of hardware. The variations of `calls.ts` (a black copy, a named copy, six screws, a mirrored foot, a notched foot, the forearm without a material and with a density in error, the base auxiliary, the pattern of the inserts suppressed, a label removed, a hole through two links, the state after the motor, a blocked pose) gave the numbers written beside them, the same in all four versions; the notched foot is a row "differs from `foot`".

**The box** (8 bodies, 204 faces; 2 to 5 ms, of which the pass over the triangles of the holes is most): `box` × 1 and `lid` × 3 (`lid`, `lids/1`, `lids/2`), neither with a mass; `pad` × 2 (`pad`, `padXY/1`: 0.15 g each, TPU) and `pad`, mirrored, × 2 (`padX/1`, `padY/1`); hardware `M3 countersunk screw` × 12 (the four holes of the lid in three lids) and `M3x3x4.5 heat-set insert` × 4 (two points and one copy of the pattern). Twelve screws for four inserts is what the model says: the lids in a row are a print layout, and each has its holes ("Known limits").

**The rows**, on a plate 60 × 40 × 5 (or the body named) and a pattern of it:

| Case | Rows |
|---|---|
| a row of three, nothing after | `plate` × 3 |
| a hole cut into the plate, then a row of three | `plate` × 3 |
| a row of three, then a hole into the source alone | `plate` × 1; `plate` × 2 (`row/1`, `row/2`, differ from `plate`) |
| a row of three, then a hole into `row/1` alone | `plate` × 2 (`plate`, `row/2`); `plate` × 1 (`row/1`, differs from `plate`) |
| a mirror of the plate; then a hole into the mirror image | `plate` × 1, `plate` × 1 (mirror image of `plate`); then `plate` × 1, `plate` × 1 (differs from `plate`) |
| a copy named "special", then a row of three of that copy | `plate` × 1; `special` × 3 (`row/1`, `more/1`, `more/2`, copies of `plate`) |
| the same with the name of `row/1` removed again | `plate` × 4 |
| a row of three, then a cut that misses `row/1` (`noEffect`) | `plate` × 3 |
| a copy; one hole feature with a point in each, at other places of the two (the reviewers' case: 144 triangles each, volumes equal to 3e-5 mm³) | two rows |
| a copy; a corner pocket at the corner (0, 0) of the source and at the mirrored corner of the copy (a left and a right: 24 triangles, 11 800 mm³ each) | two rows |
| a block and a copy 5000 away, then 0.01 mm trimmed off the source (12 triangles each; 23 988 and 24 000 mm³) | two rows |
| a pin copied 100 000 away and that copy copied back (volumes 1128.515, 1128.486, 1128.486 mm³) | `pin` × 3 |
| a pin of radius 2 copied 10⁸ away and back (volumes 124.858, 0, 0 mm³: float32 cannot hold it) | `pin` × 1; `pin` × 1 (`away/1`, differs from `pin`); `pin` × 1 (`back/1`, differs from `pin`) |
| a row of three, then the same hole cut into each afterwards, at the same place of each | three rows (the limit) |
| two copies with masses of 10 g and 20 g beside a density that cannot be evaluated | two rows, 10 g and 20 g; the sum 40 g |
| three copies, one with a mass in error | `× 2`, 20 g; `× 1`, `inError`; the sum 20 g, one without a mass |
| two copies with a mass of 10 g and densities of 1 and 2 | two rows |
| the state after the pattern, asked while a later feature has changed a copy; the same after a load and after undo | the state after the pattern: `plate` × 3; now, loaded, undone: 2 and 1 |

**The holes**, on two plates 60 × 40 × 5, one on the other, with a counterbore through both at two points, unless the case says otherwise:

| Case | Count |
|---|---|
| the feature alone (the head and the bore in the upper plate, the bore in the lower: one face, one axis) | 2 |
| the upper plate then copied to a row of three | 6 |
| both plates copied to rows of three by two patterns, to the same places | 6 |
| the upper in a row of three, the lower mirrored to another place | 8 |
| the upper copied 100 one way, the lower 100 the other: three places | 6 |
| the upper copied twice along X, the lower twice along Y: five places | 10 |
| a pattern of the hole, count 2 | 4 |
| a pattern of the hole whose copy leaves the plates (`noEffect`) | 2 |
| a pattern of the hole, then both plates in rows of three | 12 |
| the upper plate copied once, then a pattern of the hole (its copies go to the targets of the hole) | 6 |
| a third point of the feature outside the plates (the feature is `ok`) | 2 |
| a pocket cut over one hole afterwards, through both plates | 1 |
| another hole feature: two target bodies, each of its two points in one of them | 2 |
| a nut pocket from below into the lower plate at one point | 1 |
| a labelled hole in an auxiliary body alone | in no list |
| one plate, one point: the plate and its copy laid on it, the hole cut after the copy through both | 1 |
| one plate, one point: the hole first, then the plate copied twice onto itself | 1 |
| one plate, one point: a stack of three first, the hole after it through the three | 1 |
| one plate, one point: a through hole, then the plate mirrored in its own top face | 1 |
| a countersink deeper than a thin upper plate (head in both, bore in the lower alone) | 1 |
| one plate, one point: a blind hole from the top, then the plate mirrored in its bottom face (two blind holes on one axis) | 2 |
| the same two blind holes in one plate by a mirror of the hole feature | 2 |
| one plate, one point: a blind hole 3 deep from the top, then the plate mirrored in its top face (one hole 6 long) | 1 |
| a plain hole, a pattern of the feature about the hole's own axis, count 3 (every feature `ok`, no warning) | 1 |
| a point on the axis of a pattern of the feature and one on a ring, the pattern of count 2 to 6, a plain hole and a counterbore | 3, 4, 5, 6, 7 (one in the middle and one per copy on the ring) |
| a nut pocket turned 30° about its own axis by a pattern of the feature | 1 |
| a blind hole 2 deep continued by a copy of the feature 2 further down its axis; the copy 3 further down (1 of material between) | 1; 2 |
| a slab from −5 to 5, a blind hole from the top, the feature mirrored in its sketch plane | 2 |
| a plate with a through hole mirrored in a plane 50 behind it (two walls 100 apart) | 2 |
| the same plate in a row of three along the hole's axis: 200 apart; 5.001 apart; 5 apart (a stack) | 3; 3; 1 |
| two plates with a gap of 1 between them, one hole through both; then both copied 100 along X | 1; 3 (the limit: two pairs, two screws) |
| two plates with a clearance of 0.5, one counterbore through both; both copied to rows of three | 1; 5 (the limit: three pairs) |
| plates at z 0 to 5 and 100 to 105, one hole through both; the lower copied 50 up (into the gap); 200 up | 1; 2; 2 |
| cylinders at z 0 to 5 and 100 to 110, one hole from 105 down through both; the upper copied 50 down (a blind hole with material above it) | 2 |
| a plate with a through hole stacked by a copy with a gap of 0.001; of 0.01; of none, the plate at x = 0, 1000, 2000, 5000 | 2; 2; 1 at every x |
| a bore of 20 split by a slot cut through the plate later | 1 |
| two flanges 20 apart in one body, one hole through both | 1 |
| one flange with its hole, mirrored to make the second flange 20 above it | 2 (the limit: one bolt may pass through both) |
| a pin with a hole copied 10⁷ along Z, that copy copied 5 along X, the source auxiliary and the copies parts | 2 |
| two pins of radius 0.2 with bores of 0.1, axes 0.5 apart, copied to z = 10⁹ (the sources auxiliary) | 2 |

A count from the document (points times copies) would have said 3 for the third point, 4 for the copy that runs off, and 2 with the pocket. The second version said 1 for the walls 100 apart, 3 for the hole patterned about its own axis and 1 for the two blind holes of a mirrored plate; in the reviewers' runs the third said 1 for the copy in the gap, 1 for the blind hole under the cylinder, 1 for the gap of 0.001 at x = 1000 and 1 for the pins at 10⁹.

**The file.** A name with a tab, a comma and quotes (`top,<tab>plate "A"`) is the field `"top, plate ""A"""`; a mass of 1.2e-7 g is written `0.00000012`, one of 1e21 g `1000000000000000000000`.

**A blocked pose.** The arm with three links and two joints at 0.5 and 0.7 rad, then the sketch of the axes removed (one previewed batch): both joints are in error, the query `mass` over the forearm fails ("the pose of the body "forearm" is not known"), the query `print`, which says `geometry: 'modelled'`, answers, and the prototype gives the sums of the arm.

## For the later packages

Not designed here; what each finds.

- **3b (an imported mesh as a reference body)**: a body with the use `reference` is a row of `bought` by the rules above, with its name and the mass of its data sheet, and copies of it by a pattern are one row. **Two imports of one file are two rows as 3b is designed** (`d36/3b-design`): its step moves the stored positions itself and makes a new `Solid` per placement, which is a copy of nothing. For one row 3b would keep one `Solid` per stored mesh (it keeps the decoded arrays by the entry object already) and make every placement of it, the one at the identity too, by `transformSolid`; and the two bodies would need the same properties on each, since no `bodySource` links them. That is 3b's to decide, or the cross-review's; the query does not change either way.
- **3c (an inserted document as a part)**: the same for two insertions of one document. Whether an inserted part brings its own list (the hardware of its holes is not on this timeline: `holeCounts` reads the hole features of this document) is 3c's to decide; the rows of the answer can take it.
- **3d (a boolean of bodies, a split)**: the solid of a piece or of a result is a new mesh and a copy of nothing, so two halves are never one row "× 2". The new body of a split answers `bodySource` with the body it was cut from (`d36/3d-design`), so a half without a name of its own is a row named like that body (`partName`) and "differs from" it while that body is in the state. A body consumed by a boolean is not a body of the state and is in no row; a row whose chain starts at it has no `copyOf`, and its name still comes from the document. 3d decides whether these are the names it wants.
- **5b (a robot description)**: "one mesh for a body and its copies" is `shapeOrigin`: exact as a statement of what the recompute did, silent about bodies changed after the copy, which then get meshes of their own, and blind to a copy that float32 could not hold (see "Rows of bodies"). The transform of a copy against its origin is not recorded here; 5b adds it to the record if it needs it.

## Rejected

1. **Counting holes from the document**: the points of a hole feature, times the copies of the patterns of features that list it, times the copies of its target bodies made afterwards. It is what 2c's sentence describes. Rejected: it counts holes that are not there (a point that missed, a copy that ran off the part, a hole cut away), it has to read the `refs` of `noEffect` warnings to do better, and it still needs the order of the timeline to know which copies of a body have the hole. The faces say all of it.
2. **A structured piece on the hole feature** (`hardware: { kind, size, length }`, or a reference to a catalog row). It would make rows that are certainly pieces, with a length. Rejected for now:
   - it is a field of a feature, and the validator of a feature builds its canonical copy from the fields it knows, so an older build would drop it without a word: an upgrade step and a new version of the schema for a list;
   - the catalogs hold the dimensions of holes, not products: a length, a head type beyond the two, a nut that is square have no row to point at;
   - the label is there, already described to the AI as the place, and a person reads it.
   It can come later as an optional field beside the label without a change of this query's answer.
3. **Reading a size or a kind out of the label** ("ends with hole", "starts with M3"). D46 decided that the engine never does.
4. **Screws as bodies made from the catalog.** The catalogs have no shape of a screw, and a body per screw is what imports and inserted parts (3b, 3c) are for.
5. **One row for bodies of the same name or the same shape that are not copies.** A name is free text, and two bodies of one name need not be one part (a left and a right bracket named "bracket"). Comparing shapes up to a motion is a heuristic of its own.
6. **"The same shape" by a fingerprint of the mesh** (the first version: the number of triangles and the volume, within the precision of the coordinates times the surface). Copies stayed under a hundredth of the bound in 550 measured copies, and it still called different parts the same: neither number changes when the same feature lands at another place, and the bound grows with the distance of a copy from the origin. A stricter fingerprint (moments, the names of the faces) only makes the false merge rarer.
   - **Comparing the two meshes under the transform of the pattern** (the internal reviewer's first choice) is exact for copies changed alike as well, which the origin is not. Rejected for now: the transform of a copy is not kept anywhere (`transformsOf` is private to the pattern and resolved against the state at the pattern), and two bodies cut alike by separate booleans need not have the same triangles, so it is a comparison of surfaces with a tolerance again. It can be added behind the same rule later: it would only join rows the origin keeps apart.
7. **Holes counted by the copy tags of their faces alone**, with the largest count among a body and its copies (the first version). The tags tell the history of a face, not where it is: a plate copied onto itself counted once per plate, copies moved apart counted as the largest family, and the count depended on whether the hole or the pattern came first.
   - **Every application of a feature once per axis** (the second version: a point, cut by the feature or by a copy of a pattern of features; its faces counted once per line). A copy of a pattern about the hole's own axis cuts slivers, so it is `ok`, and was a second hole on one axis (3 for one hole); two walls 100 apart on one line were one hole, as were two blind holes of a plate mirrored in its back.
   - **Holes told apart by their axes alone**, without the stretch: two blind holes from both sides of one plate, and walls apart on one line, would be one.
   - **The same published axis point and sense** (the internal reviewer's first choice for the re-cut): the axis of a cylinder carries no sign and its `origin` is any point of it (`Surface` in `types.ts`), so the contract of the surfaces would have to change for it, and it does not tell walls apart.
   - **The stretches of the faces along the line** were rejected in the first round, for one bolt through the two flanges of a bracket, whose stretches do not touch. With the cut as the unit (one build in every body it went into, one hole) the bore through both flanges is one hole, and the rule is the one of this version.
   - **One interval over all the bodies of a cut** (the third version). It made the gap between two bodies part of the hole: a copy in that gap, and a blind hole of a copy with material between it and the hole, were taken into it.
   - **Copies that keep the arrangement of their build joined** (the internal reviewer's offer in round 3, for a pair with a gap that is copied): two copied cuts of one build on one line would be one hole when the offset between their intervals is the offset between the intervals of the bodies they are copies of in the build. Deferred: it needs the body of the build each copy descends from (through `bodySource`) and a comparison of offsets with a tolerance, for a case the conventions avoid; it can only join holes the rule keeps apart, so it can come later. Joining by the largest gap of the build instead is arbitrary, and would join the blind hole under the cylinder again.
8. **A member `copyOf` of the registry of feature types** beside `bodySource` (the first version, for the hand and the family of a copy). With the origin of the mesh the registry has nothing left to say: today both members answered the same body, and a feature type cannot answer for two imports of one file.
9. **A mirror image in the row of its source.** 2e's reason: a left and a right bracket. For a symmetric part it costs a second row with the same numbers, marked `mirrored`; the engine cannot tell cheaply that a part is its own mirror image.
10. **A fallback density and a fill factor as arguments**, as the mass query has. The list reports what the document says; a what-if in another material is the mass query's, and a part without a mass is named.
11. **Failing the query for a mass in error**, as the mass query does. One body would hide the list.
12. **One list of rows with a kind.** Hardware has other columns than bodies (a label and features, no mass); three lists need no field that is empty in a third of the rows. The file has one table, because a spreadsheet wants one.
13. **A method of `Engine` or a tool of its own.** The catalogs are the way (D37).
14. **The answer in the pose.** See "As modelled".

## Known limits

- **A label is a text.** Rows join by the exact text ("M3 hex nut" and "m3 hex nut" are two rows); nothing checks that a label names a piece. The label `hardwareHole` gives a plain clearance hole, "`<size>` clearance hole", is a row like any other: it says that a screw passes there and not which ("Open", 2).
- **Hardware has no length and no mass.**
- **Only hole features are hardware.** A hole made by an extrusion (the two pin holes of the arm) has no label and is in no list.
- **A piece listed twice.** A screw modelled as a body with the use `reference` and also named in the label of its hole is a bought part and a row of hardware. Two hole features for one screw (a counterbore in one part by one feature, the clearance hole in the next by another) are two rows unless one has no label. The conventions say both.
- **Every copy counts.** Copies laid out for printing are parts and have their holes: three lids in a row are three lids and twelve screws for the four inserts of one box. The list cannot tell a layout from an assembly.
- **Copies changed after the pattern are rows of their own**, also when they were changed alike. What every copy should have is modelled before the pattern.
- **Holes of copies of a body on one line count apart unless they touch.** One flange with its hole, mirrored to make the second flange of a bracket, has two holes where one bolt may pass through both; the hole cut after the copy, through both flanges, is one. The same holds for two parts that one hole feature went through with a gap between them (a lid with a clearance over a box) when both are copied: the original pair is one hole, each copied pair two, because the copies of the two bodies are cuts of their own and their intervals do not touch. Parts that touch along the hole, or a hole cut after the copies, count right; the conventions say so. The error is towards a piece too many. A gap of 10⁻⁶ of the coordinates along the hole or more is a gap.
- **Holes on one line that touch are one.** A blind hole continued by a copy further along its axis is one deeper hole, also when the user meant two pieces end to end.
- **A hole is there by its bore or its head.** A nut pocket of which only the flats are left in a body, or a hole of which only the seat or a cap is left, is not counted; a hole whose bore passes through a wall elsewhere than its user meant is.
- **A hole in an auxiliary body alone** is in no list, labelled or not.
- **A mirror image of a symmetric part** is a second row.
- **Bodies that are not copies** are never one row, whatever their names and shapes.
- **A copy that float32 distorts** without losing its volume is still a copy of its origin and counted in its row; one that loses it is a row of its own. The engine says nothing about such a body anywhere; a warning belongs to the pattern.
- **A changed copy says no hand.** A mirror image changed after the copy is a row "differs from `<body>`", not a changed mirror image.
- **The mass of a printed part** is that of the body properties: the density of the solid material times the volume, an upper bound until the density is corrected or the part weighed (D48).
- **The CSV** is written for a program that reads RFC 4180. A text that starts with `=`, `+`, `-` or `@` is written as it is; a spreadsheet may take it for a formula. The names are the user's own. The column `IDs` cannot be split by a program when an ID holds a space.

## To verify before the implementation

- That no step of the recompute hands a body on as a new `Solid` object without changing it, and that none changes a body in place: the rule of the rows rests on it. The cases of "Measured" hold for the extrusion, the hole and both kinds of pattern; a test pins it, and a later feature type has to keep to it (it goes into the comment of `transformSolid` and into `docs/architecture/recompute.md`).
- That the generic form of the app shows and asks a query whose description has no argument at all (`openQuery` asks at once; `checkArgs` passes an empty description; the form was not run in a browser).
- That the tool `query` prints `mass` under `totals` with six significant digits and leaves a `count` of 12 alone (read by both reviewers in `roundedResult`).
- The time on a large model: the pass over the triangles of the bodies that have a bore or a head (2 to 5 ms on the box), and the pairs of cuts of one feature (quadratic; a feature with 100 points in 50 copies of a body is about 12 million pairs, an estimate of tens of ms). A grid of cuts by their lines would make it linear, if needed.
- The CSV in the spreadsheet the owner uses ("Open", 1).

## Tests the implementation owes

- Engine (`packages/engine/test`): `shapeOrigin` (a copy, a copy of a copy, two mirrors, a solid that is no copy); `sourceRoot` (a chain, a cycle in a document edited by hand, a body whose feature is gone); `partName` (a name on the body, on its source, on neither, a root that is not in the state); `csvField` (a comma, a quote, a tab, a line break, none) and the mass of a record (a small one and one of 10²¹, without an exponent); `copyOf` with `mirrored` and with `differs`.
- Scenarios (`packages/scenarios/test`), against the real adapters: scenario 13 from `calls.ts`; `parts.test.ts` with every case of the two tables of "Measured" (the rows and the holes, the cases of the three rounds of reviews among them, the limits marked as such) and the box of scenario 12 as it stands after the part of 2e (the four rows, 12 and 4).
- MCP: the rows of the two typed tables; the answer of the tool `query` for the arm; the tool `export` writes `parts.csv` and refuses a model with nothing to list.
- The app: the view driven in `app.test.ts` with a snapshot of its own (the groups, a picked row of bodies and of hardware in the scene, the note); the export form of `partsCsv`.
- The review of the implementation is a full one by the rule of CLAUDE.md: the count of holes reads geometry.

## Open

For the owner:

1. **The CSV: commas and a decimal point, or semicolons and a decimal comma?** The design writes RFC 4180 (commas, a decimal point), which LibreOffice, Google Sheets and every program read; Excel with Czech settings opens such a file into one column unless it is imported. The other choice is a second format or an option of this one.
2. **A plain clearance hole from the catalog: a row of hardware or not?** `hardwareHole` labels it "`<size>` clearance hole", so today it is listed (the design's default: it shows that a screw passes there, and the conventions say to replace or remove the label). The other choice is that `hardwareHole` gives a plain clearance hole no label, and a screw whose head sits on the surface is labelled by hand; that is a change of 2c's query, one line.

For the implementation:

- The wording of the rows of the view and whether a picked row of hardware should also select its features on the timeline.

No third-party library is needed.

## Reviews

Who ran which round, on which model:

| Round | Design and fixes written by | Internal reviewer | `codex` | `agy` |
|---|---|---|---|---|
| 1, the first version | a session on Fable 5.2 (effort high) | a fresh subagent on Fable 5.2, effort high | `gpt-6-astra`, effort high | out of quota (HTTP 429) |
| 2, the fixes of round 1 | the same session; it stopped at its usage limit while it added the cases of round 2 to the spike | a fresh subagent on Fable 5.2, effort high | `gpt-6-astra`, effort high | out of quota (HTTP 429) |
| 3, the fixes of round 2 | a session on Opus 5.5 (the owner's decision of 2026-11-17: designs go on on Opus while Fable is not available); it also wrote the fixes of round 3 | a fresh subagent on Opus 5.5 | `gpt-6-astra`, effort high | out of quota (HTTP 429) |

### Round 1 (2026-11-17): the first version, at `181d067`

Three reviewers were asked, read-only, with one brief (what is under review, what to read, ten things to look for, what to return): a fresh internal subagent (model `fable`, effort high), which ran probes with the real adapters from the scratchpad; `codex` (`gpt-6-astra`, reasoning effort high, read-only sandbox), which ran the entry of `calls.ts` in memory with the real adapters; and `agy` (`gemini-4-argon-high`), which did not take part: its account is out of quota (HTTP 429). `codex` returned eight findings (one blocker, two major, five minor), the internal reviewer nine (two major, six minor, one factual). Every finding was checked against the code, and the cases that could be run were run again with the prototype, before it was acted on.

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| "The same shape" by the number of triangles and the volume calls different parts one: a hole at another place of a copy (144 triangles each, the same volume), a left and a right pocket, a window 10 × 2 against 10 × 3 in a thin panel, a source trimmed by 0.01 mm while its copy stands 5000 away (the bound grows with the coordinates). And it splits a copy brought back from 100 000 away | codex, blocker; internal, major (run by both) | Yes | The rule is gone. A row is one mesh, moved: `shapeOrigin`, the record `transformSolid` keeps. The cases are in "Measured". It errs one way, and the limit (copies changed alike) is stated |
| The count of holes by the copy tags and the largest family is not the number of pieces: a plate with a hole copied twice onto itself gives 3 for one screw, and 1 when the hole is cut after the copies; a half mirrored in its parting plane gives 2; plates copied apart give 2 for three places and 3 for five | codex, major; internal, major and minor (run by both) | Yes | An application counts once per axis its bores and heads lie on. The registry member and the families are not needed for it |
| What a body weighs by was `error` as soon as a field had one: two copies with stated masses of 10 g and 20 g beside a density in error were one row "10 g each, 30 g"; one valid mass beside one in error lost the valid one from the sum; the same mass with two densities showed one density | codex, major; internal, minor (run by both) | Yes | The key is the resolved mass by its source and number, an error only without a mass; the density is part of the key |
| `diameter: 3.4` for the screw through two links is a size written by hand | both, minor | Yes (it is the catalog's number, typed) | The shape is the answer of `hardwareHole` for a clearance hole; the label is replaced by the screw |
| The view written out had one flat list: the headings *To print* and *To buy* were lost, and a row split by its colour showed no colour | codex, minor | Yes | The stand-in has groups with headings, a patch of the colour and what a row is a copy of |
| A picked row of hardware painted every face of its features: caps, seats, faces in auxiliary bodies | codex, minor; internal, factual | Yes | The bores and heads in the bodies that are parts: the faces the count is taken from |
| The mass of a record was written with an exponent below 1e-6 g, against "no exponent" | both, minor | Yes | Rounded to six significant digits, then written as `plain` writes a number |
| A tab or another control character in a name or a label is outside the fields RFC 4180 describes | codex, minor | Yes (names and labels may hold them) | Written as a space |
| The column `IDs` cannot be split when an ID holds a space; two rows may be identical but for their IDs (a recoloured or changed copy of a part with a stated mass) | internal, minor | Yes | A column `Note` says what a row is a copy of; `IDs` is said to be for a reader. No separator is safe: an ID may hold any character but a slash, and a body ID holds that |
| Limits a reader runs into were missing: copies as a print layout (3 lids, 12 screws for 4 inserts), holes made by an extrusion, a labelled hole in an auxiliary body alone | internal, minor | Yes | "Known limits", the summary of the entry and the conventions |
| `copyOf` beside `bodySource` answers the same body today, and a member that gets no document cannot say that two imports are one part | internal, minor | Yes | The member is dropped; what 3b needs is `transformSolid` ("For the later packages") |
| The paragraph for the AI said a clearance hole "should have no label" while the summary of `hardwareHole` says to put its label into the feature | internal, minor | Yes | The paragraph says what to do with the label of the catalog |
| The colour of a selection was written as a number that is not the app's; the stand-in of the view lacked the parameter `args` | internal, factual | Yes | A declared constant; the parameter |

Checked by the reviewers and found sound: the type check of the contracts; every number of the arm and its variations and of the box (run by both); the commands of `calls.ts` against the validators; that a face of a copy of a pattern of features starts its tags with that pattern, that a pattern of a body appends its tag, and that one build gives one face number in every target; that copies keep their triangles and that a target without an effect keeps its object; the reach from MCP and the app (an empty description of arguments, `immediate`, the typed tables, `significant` at any depth, no note of a pose); that `runExport` takes one file with `empty` and that the server writes any media type; that nothing is added to the document.

Not acted on:

- The spans of the faces along an axis, to tell two blind holes on one axis from one hole (codex): "Rejected", 7; the case is a limit.
- A comparison of the meshes of a copy and its source under the transform of the pattern (internal): "Rejected", 6; it could join rows later and is not needed to keep them apart.

Not checked by either: the app in a browser, the CSV in a spreadsheet.

### Round 2 (2026-11-17): the fixes of round 1, at `47986e8`

The brief asked mainly about what the fix changed: the ground of `shapeOrigin`, cases for the rows and for the holes, the key of the mass, `calls.ts`, contradictions left by the fix, what the design tells the later packages. `codex` ran its cases with the real adapters and the patch of `shapeOrigin` in memory and returned five findings (three major, one minor, one factual); the internal reviewer ran its probes against the clone of the scratchpad and returned six (one major, three minor, two factual). Ten distinct findings, four of them major, so a third round runs by the rule, and the fix is large as well. Each case was run again with the prototype of the third version, its result is in "Measured".

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| A hole cut again by a copy of a pattern of its own feature counts once per copy: a pattern about the hole's own axis gave 3 for one hole (the turned polygon cuts slivers, so the copy is `ok`, not `noEffect`); a point on the axis and one on a ring gave 3, 6, 5, 10, 12 for counts 2 to 6; a nut pocket turned 30° gave 2 | codex, major; internal, major (run by both) | Yes | The hole rule: cuts of one feature on one line whose stretches touch are one hole. The cases give 1; 3, 4, 5, 6, 7; 1 |
| The bound of "one line" grew with every coordinate, also along the line: two holes 5 apart at z = 10⁷ were one (10 mm of tolerance) | codex, major (run) | Yes | 10⁻⁹ of the largest coordinate of the two points, `LENGTH_TOLERANCE` at least: the surfaces are moved in doubles. The case gives 2 |
| One origin does not mean one shape after float32: a pin copied 10⁸ away and back has the volume 0 in both copies and is one row "× 3" with the volume of the source; "errs one way only" and the "exact" told to 5b overlook it | codex, major (run) | Yes, as a fact; not the list's to guard | Stated in "Rows of bodies", in "Known limits" and for 5b. The body is broken for every query of the engine already; a guard belongs to the pattern. No check of volumes was added to the rows: it would be the fingerprint of "Rejected", 6, again |
| The writer of a mass copied a part of `plain` and wrote `1e+21` | codex, minor (run) | Yes | `plain` itself, after six significant digits |
| A piece whose source a boolean used up (3d) would get the name "trans / 1": the name of the root was read from the evaluated properties, which only bodies of the state have | codex, factual (a synthetic context: no feature removes a body today) | Yes | `partName` reads the document |
| The limit "two blind holes on one axis" was wider than written: holes on one line in copies of a body were one however far apart (two walls 100 apart: 1; three walls 200 apart: 1), too few pieces | internal, minor (run) | Yes | Gone with the stretch: 2 and 3. The limit left is the other way: a flange and its mirror image are two holes |
| `copyOf` and the note said "copy of X" for bodies that no longer are copies (a source changed after two patterns; a mirror image with a hole cut into it lost its hand) | internal, minor (run) | Yes | `copyOf` only when the root is a body of the state; `mirrored` only when the row is still its mesh; `differs` and the note "differs from X" otherwise. A changed row says no hand (a limit) |
| Copies of a renamed copy took the name of the root and joined its row, while they inherit colour and material from the nearest source | internal, minor (taste) | Yes | `partName`: the nearest name of its own on the chain |
| What the design told 3b was true only as a condition 3b's design does not meet: 3b makes a new `Solid` per placement | internal, factual | Yes | "For the later packages": two rows as 3b is designed, and what one row would need |
| Slips: the comparison with `xmlText`, which drops control characters other than a tab and a line break; the refusal quoted as "the query has no such argument" (the engine says "there is no such argument"); the cheap variant said "no feature changed any of them after the pattern" where a changed source leaves the copies together | internal, factual | Yes | Corrected |

Checked by the reviewers and found sound: the ground of `shapeOrigin` (bodies are written in three places, by the extrusion, the pattern and the kernel's result, which is always a new object; a target the tool did not change keeps its object; nothing changes a solid in place; a modelled context hands out the very objects of the state; the memo of the steps is keyed by the previous state; the weak map cannot join two engines and keeps nothing alive the states do not); the rows over a copy of a copy, mirrors of mirrors, `at` the pattern, previews, undo, redo and load, a name equal to another root's name, a copy turned a full circle onto its source; the surfaces of bores and heads on the hole's axis for every kind of pattern of a body and of features, a cone's apex on the bore's line, opposite directions, a tilted face, a point at `origin`; the key of the mass against the rule of `BodyPropertiesResult` (a body with a mass is never `inError`); every step of `calls.ts` replayed, with the CSV text, nine fields in every record, the note of the mirrored foot and the tab in the motor's name; no remembered dimension of a piece; the type check.

Not acted on: the parity of mirror patterns along the chain of sources, to keep the hand of a changed copy (internal, offered as an option); the row says `differs` instead.

Not checked: the app in a browser, the CSV in a spreadsheet, the MCP tools; garbage collection was read, not measured.

### Round 3 (2026-11-17): the fixes of round 2, at `3cd208e`

The last round by the rule: the reviewers read the diff of the fix of round 2 (`git diff HEAD~1 HEAD`) and the engine around it. `codex` ran its cases with the real adapters and `calls.ts` in memory and returned three findings (two major, one factual); the internal reviewer, on Opus 5.5, checked that the prototype matches `calls.ts`, ran its probes and returned six (one major, three minor, two factual). Each case was run again with the prototype of the fourth version; the numbers are in "Measured".

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| One interval over all the bodies of a cut swallowed a separate hole: cylinders at z 0 to 5 and 100 to 110 with one hole through both, the upper copied 50 down, gave 1 where the copy's blind hole has material above it; a plate copied into the gap of such a cut was merged too, against "copies on the same line have holes of their own" | codex, major; internal, minor (run by both) | Yes | An interval per body of a cut; two cuts join when an interval of one touches one of the other. Both cases give 2 |
| Both bounds still grew with coordinates that do not matter: a gap of 0.001 closed at x = 2000 (and at x = 1000), and two holes 0.5 apart at z = 10⁹ were one line | codex, major; internal, factual (run by both) | Yes | "One line" by the distance of the lines from the origin; "touch" by the coordinates as the line sees them. 2 at every x, and 2 at 10⁹ |
| A pair of bodies one hole feature went through with a gap between them, both copied, counts two holes per copied pair (a lid with a clearance: 1, then 5 for three pairs), on the very path the conventions recommend | internal, major (run) | Yes | Not fixed: a known limit, named with the case, and the conventions say that parts held by one screw should touch along the hole or have the hole cut after the copies. The rule that would fix it (copies keeping the arrangement of their build) is deferred in "Rejected", 7 |
| "The list cannot see" the collapse of a copy is wrong: its volume 0 is in the evaluation; a check that only vetoes a row is no fingerprint (codex). The reason given was wrong, no principled bound exists short of the collapse, and the sum of the row was three times the source (internal) | codex, factual; internal, minor (run by codex) | Yes | A body whose volume is not above zero is taken for no copy: the pin's copies are rows of their own, "differs from `pin`". A copy distorted short of that stays a limit, with the reason |
| `returns` of the entry still said `copyOf` is "the source when it is in another row" (an auxiliary root is in no row) | internal, minor (run) | Yes | The body the chain starts at, when it is a body of the model and not in this row |
| The row of D57 for `decisions.md` kept the slip round 2 corrected in the body | internal, minor | Yes | The corrected wording |

Checked by the reviewers and found sound: the type check; every step of `calls.ts` replayed (codex), with `changedCopy`, `mirroredFoot`, the CSV and a blocked pose; the key of a cut (one build per placement gives one face number per point and role in every target, the tags of the two kinds of pattern, a bore split by a later slot stays one cut, no two holes share a key); `sameLine` and `touch` against `transformFace` and `transformSurface` (doubles), a cone's apex as the point, opposite directions, a nut pocket (its flats are `holeFlat`); all bodies of a row share one root, so `mirrored` and `differs` agree with the key; `partName` against `defaultName` and the chain of `body-properties.ts`; `plain` from 10²¹ on; the statements about 3d against its branch; no sentence of the earlier versions left outside the history.

Not checked: the app in a browser, the CSV in a spreadsheet, the MCP tools; the time of the pairs of cuts on a large model (estimated, "To verify").

This was the third round, the last the rule allows. What is open after it is in "Known limits": two copied parts with a gap between them, and a copy distorted by float32 short of losing its volume.

## Rows for the indexes

**`docs/d36/README.md`**, the row of 3e:

> | 3e | Parts list | 3 | E | 3a, 2c | full design 2026-11-17, D57 ([3e-parts-list/design.md](3e-parts-list/design.md)): the query `partsList` (printed and bought parts as rows of bodies, a body and its unchanged copies one row; hardware as the labels of the hole features counted by the holes the model has, by the line of each and how far along it the hole reaches), the export format `partsCsv`, `shapeOrigin` (what a solid is a copy of), `partName`, the view of the app; nothing added to the document, no schema step |

and in "Numbers", decisions: D57 3e.

**`docs/decisions.md`**, the row of the overview:

> | D57 | [3e Parts list](d36/3e-parts-list/design.md) | designed 2026-11-17 | What to print and what to buy as a query, `partsList`: bodies with the use `part` and `reference` as rows, a body and its copies one row while they are one mesh moved (a body a feature changed after the pattern leaves the row, a mirror image is a row of its own) with the same properties and name, and hardware as the labels of the hole features counted by the holes the model has, by their axes and how far along them they reach (one build is one hole; cuts of one feature on one line whose intervals touch are one hole). The same table as a file by the export format `partsCsv`. `transformSolid` remembers what a solid is a copy of (`shapeOrigin`). Nothing is added to the document |

**`docs/requirements.md`**, scenario 13, a new part:

> - *Parts list (3e, D57).* The arm gets what holds it together: a heat-set insert in the link under each of the four screws (one hole feature from the catalog and a pattern of it about the centre of the motor), and three feet under the base, each with an insert (a body with a hole, then a pattern of the body). One question, `partsList`, says what to print and what to buy: four kinds of printed parts with their materials and masses (the three feet one row), the motor with the 280 g of its data sheet and the four screws as one row of 3.6 g, four M3 and three M4 inserts counted from the holes the model has, and the sums (6 bodies of 348.6 g to print, 5 of 283.6 g to buy, 7 pieces of hardware). Asked of previews, nothing written: a copy in another colour or with a name of its own is a row of its own; six screws are one field of the pattern and stand against four inserts; a mirrored foot is another part, and so is a foot with a notch cut after the pattern; a part without a material is listed without a mass and the sum says so; an auxiliary body is no part; a suppressed pattern, a removed label and a screw through two links change the hardware as the model changes. The list after the motor has neither screws nor holes. It does not depend on the pose and answers where a posed query cannot read a body. The same table is a file, `parts.csv`, by the export format `partsCsv` ([d36/3e-parts-list/calls.ts](d36/3e-parts-list/calls.ts)).

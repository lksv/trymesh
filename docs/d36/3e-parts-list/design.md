# 3e Parts list (D57)

**State: designed on 2026-11-17, not implemented.** Written against the code of `master` at `633a6ca`: the catalog of queries and of export formats of the preparatory step (D37), the body properties of 3a (D48), the hole feature and the hardware catalogs of 2c (D46), the linear pattern and the mirror of 2e (D53) and the mechanism of 5a (D49) are all in the code. The entry of the query was prototyped in the session scratchpad and run with the real adapters over the arm of scenario 13 and the box of scenario 12; the numbers are under "Measured". Nothing under `packages/` was changed.

Files: [contract.ts](contract.ts) (the query, its result, the export format, the member of the registry, the view of the app as stand-ins), [calls.ts](calls.ts) (the entry of the query and the writer of the file written out against the real context of a query, and the part of validation scenario 13). Both are checked by `npx tsc -p docs/d36/tsconfig.json`.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Compared with Onshape, FreeCAD and Fusion": *Parts list. A query: bodies with their properties, reference parts, and hardware from the labels of hole features with counts. What to print and what to buy. Step 3.* The designs of 3a and 2c each left it a sentence: 3a's table of readers ("Parts list (3e): `name`, `material`, `use`, `mass`; printed parts and bought parts; auxiliary bodies are not parts") and 2c's `label` ("The parts list of 3e counts it: once per point and per copy of a pattern"). 2e added that a mirrored copy is another part than its source while a row of copies is one part several times.

| Statement | What the code says |
|---|---|
| "Bodies with their properties" | `evaluation.bodyProperties` has, for every body of a state, the name, the colour, the material, the use, the density and the mass with what a copy inherits, and `massFrom` (`sections/body-properties.ts`). The context of a query keeps it (`context.state.evaluation`). Nothing has to be resolved again |
| "Reference parts" | The use of a body is `part`, `reference` or `auxiliary` (D48). A motor is `reference` with the mass of its data sheet in `mass`. An auxiliary body has no mass and is no part |
| "Hardware from the labels of hole features" | `HoleFeature.label` is an optional text of at most 200 characters; the engine never reads a number out of it (D46). The query `hardwareHole` writes five labels: four name a piece (`<size> socket head cap screw`, `<size> countersunk screw`, `<size> hex nut`, `<size> heat-set insert`), the fifth names the hole (`<size> clearance hole`). None has a length: a hole does not know how long its screw is |
| "With counts", 2c: "once per point and per copy of a pattern" | That count cannot be read off the document. A point may miss the targets: `applyTool` knows what a tool did per target, not per point, and a hole feature with one point outside its bodies is `ok` with no warning (measured). A copy of a pattern of features may change nothing (`noEffect`, with the copy in `refs`). A later cut may remove a hole whole. And a pattern of a body copies the body with its holes, which no hole feature and no pattern of features says |
| "Copies of patterns counted" | `bodySource` of the registry (D48) says which body a copy takes its properties from; only the pattern sets it. It does not say that the copy has the shape of its source: 3a meant it for every derived body (a split, a boolean of 3d), and a feature after the pattern may change the source or one copy. Whether a copy is a mirror image is in the transform of the pattern |
| "A query" | A module in `query/` and a line of `QUERIES`; no method of `Engine`, no tool. A query reads the geometry of bodies from its context, in the pose of the state, and a body whose pose is not known cannot be read (D49); an entry may say `geometry: 'modelled'` |
| "Perhaps an export format (CSV)" | A module in `export/` and a line of `EXPORT_FORMATS`; a format returns files and runs over the context of a query with the bodies as modelled. The tool `export` and the menu *Export…* of the app list the catalog, so a format needs no code in either |
| "The app's view of the query" | Without a view the generic form shows the answer as a tree; `QUERY_VIEWS` gives a query rows of its own, additions to the scene and a note. `immediate` asks a query without required arguments as soon as its form opens |

The comments of `types.ts` at `label` and at `material`, and the label field of the hole form of the app, already say "for a parts list".

## The cheap variant

- **One query, `partsList`, without arguments**, over the state asked about: three lists and their sums.
  - `printed`: the bodies with the use `part`, as rows of parts with material, colour, volume and mass.
  - `bought`: the bodies with the use `reference`, the same rows.
  - `hardware`: the labels of the hole features, with the holes the model has for each.
- **A body and its copies are one row with a count**, as long as a copy is still the same part: not a mirror image, the same properties, the same shape.
- **Hardware is counted from the model**: one piece per hole that is there, read from the faces of the bodies.
- **One export format, `partsCsv`**: the same answer as one table in a file.
- **The view of the query in the app**: the three lists as rows; a picked row shows its bodies or its holes.
- **One optional member of the registry of feature types, `copyOf`**: the body a body is a copy of as a shape, and whether mirrored.

**Deferred**, none blocked by what is designed here:

- A description of the piece on the hole feature (kind, size, length) in place of a free text, and with it masses and a catalog of the pieces themselves. See "Rejected", 2.
- A list of bodies as an argument (the parts of one link). The rules below work on any set of bodies; nothing in scenario 13 needs it.
- Items that are not modelled (a cable, glue, a power supply). They would be a section of the document.
- Bodies that are the same part without being copies of one another (two imports of one mesh, two insertions of one document, two extrusions of one sketch). See "For the later packages".
- A mirror image recognised as the same part when the part is symmetric.
- A fallback density or a fill factor for parts that state no mass (the mass query has both).
- Prices and suppliers; a CSV for a locale that writes a decimal comma; other formats of the table.

## The query

`partsList` (`contract.ts`: `PARTS_LIST_ARGS`, `PartsList`, `PartRow`, `HardwareRow`). It has no argument. It answers for one state like every query: now, `at` a feature, or a state a preview returned, so "what would the list be with six screws" is one preview and one question, nothing written.

**As modelled.** The entry says `geometry: 'modelled'` (D49). A parts list does not depend on a pose, and an entry that reads the bodies in the pose would fail for a mechanism with a joint that has no motion, where the bodies beyond it cannot be read (measured: the mass of the forearm fails there, the parts list answers).

**Every body of the state is in exactly one place**: a row of `printed`, a row of `bought`, or the list `auxiliary`. A reader can check the list against `get_model`.

### Rows of bodies

Two bodies are in one row when all four hold:

1. **The same family and the same hand.** The family of a body is the body its chain of copies starts at (`partFamily`, over `copyOf` of the registry, below); its hand is whether it is a mirror image of that body (an odd number of mirrors on the way). `padXY/1` of scenario 12, the mirror of a mirror, has the hand of `pad`; `padX/1` and `padY/1` have the other.
2. **The same properties**: the use, the material, the colour, and what the body weighs by (the same stated mass, or the same density, or nothing stated, or a field in error). They are the resolved ones, so a copy that inherits everything agrees with its source.
3. **No name of its own on a copy**, unless both copies have the same one. The name of the body the family starts at names the row and splits nothing.
4. **The same shape**, compared with the first body of the row: the same number of triangles, and volumes that differ by no more than the precision of the coordinates of the two bodies (`coordinatePrecision`) times the larger of their two surfaces.

Why the fourth rule asks the model. A copy is the body as it is at the pattern (the conventions of `describe_api` say so). A feature after the pattern may cut into one copy, or into the source, and then the three "copies" are two parts. The document could say which features name which body, but not whether they changed it (a cut that misses is `noEffect`), so the rule asks what is true: is the mesh still the same. A rigid copy keeps the number of its triangles exactly and its volume to the rounding of single precision; a cut or an addition changes the volume, and nearly always the number of triangles as well (the exception measured: a block trimmed across its whole section keeps 12 triangles and loses volume). The bound is the precision of the coordinates times the surface because that is what a move of every vertex by the precision can do to a volume; copies stay under a hundredth of it ("Measured").

**The name of a row** is the name of its own that the first body of the row has, else the name of the body the family starts at, else the name of the first body. Body properties do not inherit a name (D48: a copy is "Screws / 2"), which is right for a body and wrong for a kind of part: three copies of "M3x6 screw" are the row "M3x6 screw". A row whose bodies are copies of a body in another row says so: `copyOf` (the source) and `mirrored`.

**The mass of a row**: `mass` and `massFrom` of the first body as the body properties resolved them, and `totalMass`, the sum over the bodies. A row whose bodies have no mass says why in `noMass`: `notStated` (neither a mass nor a density) or `inError` (the field cannot be evaluated; `get_model` has the message in `bodyPropertyErrors`). The query does not fail for it, unlike the mass query: a list with one row without a mass is still the list. The sums count such bodies in `withoutMass` and leave them out of `mass`, so a sum never looks complete when it is not.

The rows are in the order of their first bodies in the model. `volume` is that of the first body; `density` is passed on when the properties state one.

### Hardware: holes counted from the model

A hole is there when one of its side faces (`holeBore`, `holeHead`, `holeFlat`) is a face of a body of the state that is not auxiliary. The faces carry everything needed: the feature, the point, and a copy tag per pattern that made or copied them (`FaceName.copy`).

- **An application** of a hole feature is one of its points, cut by the feature itself or by one copy of a pattern of features. A face of a copy of a pattern of features starts its tags with that pattern (`build` of the hole gives it `copy: [placement.copy]`), which the document tells from a pattern of a body by the source of the pattern.
- **In a family of bodies** an application counts once per name its faces have there beyond that tag: once in the bodies it was cut into, and once more in every copy of such a body made afterwards, because a pattern of a body appends its tag to every face the body has.
- **Across families the largest count is taken.** A hole through two bodies is one hole (its bore is one face that lies in both), and so is one through a plate and its copy laid on it.
- **The count of a feature** is the sum over its applications.

What follows, each measured ("Measured", the cases): a counterbore through two plates at two points is 2; with the upper plate copied to a row of three it is 6, and still 6 when the lower one is copied as well; a pattern of the hole doubles it, and a copy of that pattern that runs off the plates adds nothing; a third point outside the plates adds nothing; a pocket cut over one of the holes later takes it out of the count; one hole feature with two target bodies and each point in one of them is 2; a countersink deeper than the upper plate, whose bore is in the lower plate alone, is 1.

**The rows** join hole features by the exact text of their label, in the order of the timeline, each with its holes (`holes: [{ feature, count }]`), so a reader sees which feature to change. A hole feature without a label that made holes is in `unlabelled`, with its count: such holes are either pieces the list is missing or holes that hold nothing, and the reader decides. A feature that made no hole (in error, suppressed, missed) is in neither.

**What a label is.** The label is the name of the piece that goes into the hole, as its user wrote it. The engine counts labels and reads nothing out of them (D46 stands). What the catalog does not know is typed into it ("M3x10 countersunk screw"); a hole that takes no piece of its own gets none. One paragraph of the conventions of `describe_api` tells an AI so (`CONVENTION` in `contract.ts`).

Hardware has no mass: the hardware catalogs hold the sizes of holes, not of pieces, and a screw weighs by its length.

## The export format `partsCsv`

One file, `parts.csv`, media type `text/csv`, layout `file`; no option. The entry runs the entry `partsList` with the context of the export (as `outlineOf` runs `section`), so the file and the query cannot disagree.

- CSV as RFC 4180 describes it: UTF-8 without a byte order mark, records end with CR LF, a field with a comma, a double quote, CR or LF is quoted and its quotes doubled, a header record.
- The columns: `Kind` (`printed`, `bought`, `hardware`), `Name` (the name of the row; a mirrored row adds " (mirror image)"; for hardware the label), `Count`, `Material`, `Colour`, `Mass each (g)`, `Mass total (g)`, `IDs` (the bodies, or the hole features, separated by a space). A cell without a value is empty.
- Numbers have a decimal point and no exponent; a mass has six significant digits, as the tools print it.
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
| Feature types | None. The registry gets the optional member `copyOf`, set by the pattern |
| Face roles, issue codes | None |
| The engine's API | No method. `bodyCopy` and `partFamily` beside `bodySource` in `features/index.ts`; the types of the answer and `csvField` in the index |
| MCP | No code but one paragraph of `CONVENTIONS` in `api.ts`. A row in each of the two typed tables of `queries.test.ts` and of `export-formats.test.ts` |
| The app | The view `queries/parts-list.ts` and a line of `QUERY_VIEWS` |

**The registry.** `FeatureModule.copyOf?(f, local)` answers, for a body the feature creates, the body it is a copy of as a shape and whether it is its mirror image (`BodyCopy`). The pattern answers with its source body and `mirrored` for the transform `mirror`. It is a second member beside `bodySource` and not a reading of it: `bodySource` is "takes its properties from", which a split or a boolean of 3d will set for bodies that are no copies. Without it the query would have to name the pattern type and its `mirror`, the special case of a consumer that the registry exists to avoid, and every later type that copies or derives bodies would be another.

## Where the code lives

| File | What 3e does there |
|---|---|
| `features/module.ts` | `BodyCopy`, the member `copyOf` |
| `features/pattern.ts` | one line: `copyOf` |
| `features/index.ts` | `bodyCopy(doc, body)`, `partFamily(doc, body)` |
| `query/parts-list.ts` | new: the arguments, the types of the answer, `sameShape`, `holeCounts`, the entry |
| `query/index.ts` | one line of `QUERIES` |
| `export/parts-csv.ts` | new: the entry of the format |
| `export/text.ts` | `csvField` |
| `export/index.ts` | one line of `EXPORT_FORMATS` |
| `index.ts` | the exports |
| `packages/mcp/src/api.ts` | the paragraph of `CONVENTIONS` |
| `packages/mcp/test/queries.test.ts`, `export-formats.test.ts` | a row in each typed table |
| `packages/app/src/queries/parts-list.ts`, `queries/index.ts` | the view and its line |
| `docs/architecture/api.md` (the queries, the export formats), `pattern.md` (`copyOf`), `hole.md` (the label), `docs/ui/queries.md` (the view) | the documents of the areas |

The imports go the way `modules.test.ts` guards: `query/*` and `export/*` read `features/index`, not the other way.

## The app and MCP

- **MCP.** The query is reached by the tool `query` (`{ query: 'partsList' }`, with `at` and `after`), the format by the tool `export` (`{ format: 'partsCsv', path }`); `describe_api` lists both from their entries. A tool puts no note about a pose beside the answer of an entry that says `geometry: 'modelled'`. The numbers of the answer are few: a row per kind of part, and the IDs of the bodies once.
- **The app.** The menu *Queries…* lists the query by its title. Its view (`PartsListView` in `contract.ts`, written out in `calls.ts`):
  - asked as soon as its form opens (`immediate`);
  - three groups of rows, *To print*, *To buy*, *Hardware*: "M3x6 screw × 4" with the material and the mass of one and of all; then the sums, the bodies without a mass, the hole features without a label, the auxiliary bodies, each only when there is something to say;
  - a picked row of bodies draws its bodies in the colour of a selection; a picked row of hardware paints the side faces of its hole features, the faces a selected hole feature shows (looked up in the state the answer is of, not computed);
  - the note of the status bar counts the three.
- The menu *Export…* lists `partsCsv` by its title; a format without options has a form with its button alone, and the file is saved under `parts.csv`.

## The schema

The package changes nothing a document holds, so there is nothing an older build could drop and no upgrade step. A build without the package refuses the query and the format by name (`invalidArguments`, "there is no query").

## Measured

**The recipe.** A prototype of the entry (190 lines of TypeScript with no import but the types of the engine, `bodyOwner` and `coordinatePrecision`; it is `runAsWritten` of `calls.ts`) and two spike files, run by Vitest from the session scratchpad against the sources of the worktree at `633a6ca` with the real solver and kernel adapters (`npx vitest run --config <scratchpad>/3e/vitest.config.mjs`, a config whose `root` is the worktree and whose `dir` is the scratchpad). The models: the arm of scenario 13 (`packages/scenarios/test/arm.ts`) with the properties of the part of 3a and the inserts and feet of `calls.ts`; the finished box of scenario 12 (`box.ts`, every step of the part of 2e with the pads and the lids in a row); and small models made for one rule each. Nothing of it is in the repository.

**The arm** (11 bodies, 64 faces; the answer takes 1 to 3 ms):

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

Sums: 6 printed bodies, 348.573 g; 5 bought, 283.6 g; 7 pieces of hardware. The variations of `calls.ts` (a black copy, a named copy, six screws, a mirrored foot, a notched foot, the forearm without a material and with a density in error, the base auxiliary, the pattern of the inserts suppressed, a label removed, a hole through two links, the state after the motor, a blocked pose) gave the numbers written beside them.

**The box** (8 bodies, 204 faces; under 1 ms): `box` × 1 and `lid` × 3 (`lid`, `lids/1`, `lids/2`), neither with a mass; `pad` × 2 (`pad`, `padXY/1`: 0.15 g each, TPU) and `pad`, mirrored, × 2 (`padX/1`, `padY/1`); hardware `M3 countersunk screw` × 12 (the four holes of the lid in three lids) and `M3x3x4.5 heat-set insert` × 4 (two points and one copy of the pattern). Twelve screws for four inserts is what the model says: the lids in a row are a print layout, and each has its holes.

**The same shape.** Two bodies, each with six patterns of a body (a circle of 7 about Z, 5 over 1.234 rad about X, a row of 4 along Y, a mirror, a circle of 3 of a copy about Y, a circle of 40 of a copy about Z; 55 copies), built at five places and two chord tolerances. For every copy the number of triangles was that of its source. The difference of the volumes of a copy and its source:

| Body, where | Worst, relative to the volume | Worst, of the bound (precision × surface) |
|---|---|---|
| disc with a bore, x = 30, chord 0.01 | 3.5e-8 | 0.0014 |
| disc, x = 30, chord 0.001 | 4.2e-8 | 0.0017 |
| plate 200 × 150 × 1 with a hole, x = 30 | 4.2e-6 | 0.0087 |
| plate, x = 30, chord 0.001 | 4.4e-6 | 0.0090 |
| disc, x = 1000 | 2.7e-6 | 0.0044 |
| plate, x = 1000 | 1.3e-5 | 0.0053 |
| disc, x = 5000 | 1.1e-5 | 0.0036 |
| plate, x = 5000 | 9.8e-5 | 0.0093 |
| disc, x = 100 000 | 3.6e-4 | 0.0060 |
| plate, x = 100 000 | 1.0e-3 | 0.0049 |

A bound relative to the volume would have to be 1e-3 to hold at 100 m and would then pass a change of 24 mm³ in a part of 24 cm³; the bound of the rule follows the coordinates and has a margin of a hundred everywhere. A change it has to find: a slab of 0.01 mm cut off the top of a block 40 × 30 × 20 (the same 12 triangles) changes the volume by 12 mm³ against a bound of 0.88 mm³, and the block is a row of its own; a notch in a foot changes 356 triangles to 484.

**The holes**, on two plates 60 × 40 × 5, one on the other, with a counterbore through both at two points (label "M3x10 screw"):

| Case | Count |
|---|---|
| the feature alone (the head and the bore in the upper plate, the bore in the lower: the same face) | 2 |
| the upper plate then copied to a row of three | 6 |
| both plates copied to rows of three by two patterns | 6 |
| the upper in a row of three, the lower mirrored | 6 |
| a pattern of the hole, count 2 | 4 |
| a pattern of the hole whose copy leaves the plates (`noEffect`) | 2 |
| a pattern of the hole, then both plates in rows of three | 12 |
| a third point of the feature outside the plates (the feature is `ok`) | 2 |
| a pocket cut over one hole afterwards, through both plates | 1 |
| another hole feature: two target bodies, each of its two points in one of them | 2 |
| a plate and its copy laid on it, one hole through both targets | 1 |
| a countersink deeper than a thin upper plate (head in both, bore in the lower alone) | 1 |

A count from the document (points times copies) would have said 3 for the third point, 4 for the copy that runs off, and 2 with the pocket.

**A blocked pose.** The arm with three links and two joints at 0.5 and 0.7 rad, then the sketch of the axes removed: both joints are in error, the query `mass` over the forearm fails ("the pose of the body "forearm" is not known"), the query `print`, which says `geometry: 'modelled'`, answers, and the prototype gives the sums of the arm.

## For the later packages

Not designed here; what each finds.

- **3b (an imported mesh as a reference body)**: a body with the use `reference` is a row of `bought` by the rules above, with its name and the mass of its data sheet, and copies of it by a pattern are one row. Two imports of one file are two families, so two rows of one name. Where 3b knows them to be the same part, it says so in `partFamily`, the one function that answers "the same part"; the query does not change.
- **3c (an inserted document as a part)**: the same for two insertions of one document. Whether an inserted part brings its own list (the hardware of its holes is not on this timeline: `holeCounts` reads the hole features of this document) is 3c's to decide; the rows of the answer can take it.
- **3d (a boolean of bodies, a split)**: a piece of a split answers `bodySource` and not `copyOf`, so two halves are never one row "× 2" of the body they were cut from; a hole in a body that is split is counted once, the pieces being two families. A body consumed by a boolean is not a body of the state and is in no row.
- **5b (a robot description)**: one mesh for a body and its copies is the same question as one row; `partFamily` and `sameShape` answer it.

## Rejected

1. **Counting holes from the document**: the points of a hole feature, times the copies of the patterns of features that list it, times the copies of its target bodies made afterwards. It is what 2c's sentence describes. Rejected: it counts holes that are not there (a point that missed, a copy that ran off the part, a hole cut away), it has to read the `refs` of `noEffect` warnings to do better, and it still needs the order of the timeline to know which copies of a body have the hole. The faces say all of it.
2. **A structured piece on the hole feature** (`hardware: { kind, size, length }`, or a reference to a catalog row). It would make rows that are certainly pieces, with a length. Rejected for now:
   - it is a field of a feature, and the validator of a feature builds its canonical copy from the fields it knows, so an older build would drop it without a word: an upgrade step and a new version of the schema for a list;
   - the catalogs hold the dimensions of holes, not products: a length, a head type beyond the two, a nut that is square have no row to point at;
   - the label is there, already described to the AI as the place, and a person reads it.
   It can come later as an optional field beside the label without a change of this query's answer.
3. **Reading a size or a kind out of the label** ("ends with hole", "starts with M3"). D46 decided that the engine never does.
4. **Screws as bodies made from the catalog.** The catalogs have no shape of a screw, and a body per screw is what imports and inserted parts (3b, 3c) are for.
5. **One row for bodies of the same name or the same shape that are not copies.** A name is free text, and two bodies of one name need not be one part (a left and a right bracket named "bracket" have the same volume and the same number of triangles). Comparing shapes up to a motion is a heuristic of its own. Deferred to the package that knows (3b).
6. **`bodySource` as the family.** See "The registry".
7. **A mirror image in the row of its source.** 2e's reason: a left and a right bracket. For a symmetric part it costs a second row with the same numbers, marked `mirrored`; the engine cannot tell cheaply that a part is its own mirror image.
8. **A fallback density and a fill factor as arguments**, as the mass query has. The list reports what the document says; a what-if in another material is the mass query's, and a part without a mass is named.
9. **Failing the query for a mass in error**, as the mass query does. One body would hide the list.
10. **One list of rows with a kind.** Hardware has other columns than bodies (a label and features, no mass); three lists need no field that is empty in a third of the rows. The file has one table, because a spreadsheet wants one.
11. **A method of `Engine` or a tool of its own.** The catalogs are the way (D37).
12. **The answer in the pose.** See "As modelled".
13. **Holes told apart by where their axes are.** It would count the case of two bodies copied by different patterns by positions, but it needs a tolerance for "the same axis", and the names of the faces answer without one.

## Known limits

- **A label is a text.** Rows join by the exact text ("M3 hex nut" and "m3 hex nut" are two rows); nothing checks that a label names a piece. The label `hardwareHole` gives a plain clearance hole, "`<size>` clearance hole", is a row like any other: it says that a screw passes there and not which ("Open", 2).
- **Hardware has no length and no mass.**
- **A piece listed twice.** A screw modelled as a body with the use `reference` and also named in the label of its hole is a bought part and a row of hardware. Two hole features for one screw (a counterbore in one part by one feature, the clearance hole in the next by another) are two rows unless one has no label. The conventions say both.
- **A hole through bodies that are copied by different patterns** counts as often as the family with the most copies has it (the rule of the largest count). The plates in rows of three and a mirror gave 6, by the upper plate.
- **A hole is there by a side face.** A hole of which only the seat or a cap is left in a body is not counted; a hole whose bore passes through a wall elsewhere than its user meant is.
- **The same shape is a fingerprint**, not a comparison of meshes: a change that keeps the number of triangles and the volume within the bound passes (a cut and an addition of the same volume). None was seen.
- **A mirror image of a symmetric part** is a second row.
- **Bodies that are not copies** are never one row, whatever their names and shapes.
- **The mass of a printed part** is that of the body properties: the density of the solid material times the volume, an upper bound until the density is corrected or the part weighed (D48).
- **The CSV** is written for a program that reads RFC 4180. A text that starts with `=`, `+`, `-` or `@` is written as it is; a spreadsheet may take it for a formula. The names are the user's own.

## To verify before the implementation

- That the generic form of the app opens and asks a query whose description has no argument at all (`openQuery` asks at once when every argument is optional, which holds for none; the tree and the controls were not run with an empty description).
- That the tool `query` prints `mass` under `totals` with six significant digits (the keys of `significant` hold at any depth) and that a `count` of 12 is not rounded.
- That `context.memo([solid], 'surface', …)` is found again for a copy between two questions (the solid of a copy is the same object until a feature before it changes).
- The CSV in the spreadsheet the owner uses ("Open", 1).

## Tests the implementation owes

- Engine (`packages/engine/test`): `partFamily` (a copy, a copy of a copy, two mirrors, a cycle in a document edited by hand, a body whose feature is gone); `copyOf` of the pattern for the three transforms; `sameShape` at the bound; `csvField` (a comma, a quote, a line break, none); the registry has the member for the pattern only.
- Scenarios (`packages/scenarios/test`), against the real adapters: scenario 13 from `calls.ts`; `parts.test.ts` with the twelve cases of the holes above, the shapes of "Measured" at 30 and at 5000 (copies stay one row; the trimmed block and the notch do not), and the box of scenario 12 as it stands after the part of 2e (the four rows, 12 and 4).
- MCP: the rows of the two typed tables; the answer of the tool `query` for the arm; the tool `export` writes `parts.csv` and refuses a model with nothing to list.
- The app: the view driven in `app.test.ts` with a snapshot of its own (the rows, a picked row of bodies and of hardware in the scene, the note); the export form of `partsCsv`.
- The implementation is a full review by the rule of CLAUDE.md: the same shape and the count of holes are heuristics over geometry.

## Open

For the owner:

1. **The CSV: commas and a decimal point, or semicolons and a decimal comma?** The design writes RFC 4180 (commas, a decimal point), which LibreOffice, Google Sheets and every program read; Excel with Czech settings opens such a file into one column unless it is imported. The other choice is a second format or an option of this one.
2. **A plain clearance hole from the catalog: a row of hardware or not?** `hardwareHole` labels it "`<size>` clearance hole", so today it is listed (the design's default: it shows that a screw passes there). The other choice is that `hardwareHole` gives a plain clearance hole no label, and a screw whose head sits on the surface is labelled by hand; that is a change of 2c's query, one line.

For the implementation:

- The wording of the rows of the view and whether a picked row of hardware should also select its features on the timeline.

No third-party library is needed.

## Reviews

(To be filled in after the rounds.)

## Rows for the indexes

**`docs/d36/README.md`**, the row of 3e:

> | 3e | Parts list | 3 | E | 3a, 2c | full design 2026-11-17, D57 ([3e-parts-list/design.md](3e-parts-list/design.md)): the query `partsList` (printed and bought parts as rows of bodies with their copies counted, hardware counted from the hole faces of the model by label), the export format `partsCsv`, the member `copyOf` of the registry of feature types, the view of the app; nothing added to the document, no schema step |

and in "Numbers", decisions: D57 3e.

**`docs/decisions.md`**, the row of the overview:

> | D57 | [3e Parts list](d36/3e-parts-list/design.md) | designed 2026-11-17 | What to print and what to buy as a query, `partsList`: bodies with the use `part` and `reference` as rows, a body and its copies one row while a copy is the same part (not a mirror image, the same properties, the same shape by the number of triangles and the volume), and hardware as the labels of the hole features counted by the holes the model has in its faces. The same table as a file by the export format `partsCsv`. The registry of feature types says of which body a body is a copy (`copyOf`). Nothing is added to the document |

**`docs/requirements.md`**, scenario 13, a new part:

> - *Parts list (3e, D57).* The arm gets what holds it together: a heat-set insert in the link under each of the four screws (one hole feature from the catalog and a pattern of it about the centre of the motor), and three feet under the base, each with an insert (a body with a hole, then a pattern of the body). One question, `partsList`, says what to print and what to buy: four kinds of printed parts with their materials and masses (the three feet one row), the motor with the 280 g of its data sheet and the four screws as one row of 3.6 g, four M3 and three M4 inserts counted from the holes the model has, and the sums (6 bodies of 348.6 g to print, 5 of 283.6 g to buy, 7 pieces of hardware). Asked of previews, nothing written: a copy in another colour or with a name of its own is a row of its own; six screws are one field of the pattern and stand against four inserts; a mirrored foot is another part, and so is a foot with a notch cut after the pattern; a part without a material is listed without a mass and the sum says so; an auxiliary body is no part; a suppressed pattern, a removed label and a screw through two links change the hardware as the model changes. The list after the motor has neither screws nor holes. It does not depend on the pose and answers where a posed query cannot read a body. The same table is a file, `parts.csv`, by the export format `partsCsv` ([d36/3e-parts-list/calls.ts](d36/3e-parts-list/calls.ts)).

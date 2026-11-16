# 2g Export: 3MF, and the outline of a plane as DXF and SVG (D54)

**State: designed on 2026-11-16, not implemented.** This is its second version, after the first round of reviews ("Reviews"). Written against the code of `master` at `cdf5995`: the catalog of export formats of the preparatory step (D37), the query `section` of 1a (D38) and the body properties of 3a (D48) are all in the code. The writers were prototyped in the session scratchpad and their files were read back by independent readers; the numbers are under "Measured". Nothing under `packages/` was changed.

Files: [contract.ts](contract.ts) (the options, the catalog after the package, the parts the formats are built from, with every value of a file format beside its source), [calls.ts](calls.ts) (its part of validation scenario 12).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md): "Export do 3MF: several bodies with names in one file; another format beside STL". "Outline as DXF or SVG: export of the outline of a planar face or of a section: plates for laser cutting, drilling templates. A thin writer over the loops of the section query. Dimensioned drawings are not proposed." The plan: "as entries of the registry of formats of the preparatory step; the outline needs 1a". The design of 3a: "3MF (2g): `name`, `color`: the name and the colour of an object", and the default list of a print export is `printedBodies`. The design of 1a: "an outline as DXF or SVG: package 2g, a writer over the spans, with the exact corners".

| Statement | What the code and the specifications say |
|---|---|
| "Another format beside STL" | A format is a module in `export/`, a line of `EXPORT_FORMATS` and a line of the map `ExportFormats`; `Engine.export`, the tool `export` and the description for the AI reach it with no change (`export/index.ts`, `packages/mcp/src/server.ts`, `api.ts`). It returns files as bytes, so a text format and a container are the same to the catalog |
| "Several bodies with names in one file" | `evaluation.bodyProperties[body]` has a `name` for every body (its own, else that of its feature; a copy adds its number), and optionally `color` (`#rrggbb`) and `material`. A 3MF object has `name`, `partnumber`, and a base material with a name and a display colour (3MF core, chapters 4 and 5) |
| 3MF is a ZIP | "The 3MF Document format MUST use a ZIP archive"; a file in it "MUST use the compression method Deflate or be stored uncompressed" (3MF core, 1.1; the same in the Open Packaging Conventions, annex B, table B.4). The engine has no dependencies (`packages/engine/package.json`), and a stored ZIP needs none: three records and a CRC |
| "A thin writer over the loops of the section query" | `section.run(context, args)` gives, per body, regions of an outer loop and its holes, each loop as spans: a line, an arc with the centre and radius of its surface, or a curve with its points. The ends of a span are corners of the mesh. A format gets the same `QueryContext` a query gets, always as modelled. So the writer is thin, with one exception: the arcs (below) |
| "With the exact corners" (1a) | Not done. What makes a drawing right or wrong is how an arc is written: measured below, one arc per span with the radius of its surface puts the centre of a half turn 0.32 mm off for an end that is 0.01 mm inside its circle. Arcs written in two pieces at least, a quarter turn each at most, stay within the chord tolerance with the corners of the mesh kept. The price is where a corner stands along a shallow crossing (below, "The pieces of a loop") |
| "The outline of a planar face or of a section" | The section is taken just under its plane (`below`, the precision of the coordinates), so a face as the plane gives the material of its body just under the face. For an end cap of a plate that is the outline of the face; for the floor of a pocket it is the whole slab under the floor (measured: the floor of the box of scenario 12 gives 80 × 50, not 76 × 46). The cheap variant takes the section and says so; the boundary of one face alone is deferred |
| The app | The app has two fixed exports, both STL through `exportMesh`: the button *Export STL* of the toolbar and the link of a body (`app.ts`, `panels/body.ts`). A format of the catalog cannot be reached from the app at all today. The generic form of a query (D39, `panels/query.ts`, `queries/controls.ts`) builds its rows from `ArgSpecs`, which is also how the options of a format are described |

## The cheap variant

Three formats in the catalog, each one file:

| Format | What it writes | Options |
|---|---|---|
| `3mf` | The bodies as objects of one 3MF document: mesh, name, part number, and a base material with the colour for a body that has one. A ZIP that is not compressed, written by the engine | `bodies` (as `stl`: without it the printed bodies) |
| `dxf` | What a plane cuts out of bodies, as a DXF drawing in millimetres in the form of release 12: a CIRCLE per whole circle, a closed POLYLINE with bulges per other loop, on the layers `OUTER` and `HOLES` | `plane`, `offset`, `bodies` |
| `svg` | The same outline as SVG 1.1, a user unit per millimetre: `circle` and `path` elements, a group per body | `plane`, `offset`, `bodies` |

- **No library.** The ZIP is stored, not deflated; XML and DXF are written as text.
- **The outline is the section** of the query `section`: the same plane, the same offset, the same loops. A face as the plane gives the cut just under it.
- **Lines, arcs and circles stay what they are.** A whole circle on one face is written with the centre and radius of its exact surface, so a drill centre is exact. An arc is written in two pieces at least, each a quarter turn at most, and both formats draw the same arcs. What has no exact form (a tooth flank, an ellipse) is a polyline.
- **The app gets a generic export form**, built from the options of a format like the form of a query, behind a menu *Export…*. A set of files is saved as one ZIP by the same writer.
- **Nothing of the document changes**: no command, no query, no feature type, no schema step.

**Deferred:**

- A compressed 3MF (the file is a fifth to a quarter larger than the STL; deflate would make it about a fifth of the STL). See "Open".
- In the 3MF: a thumbnail, a print ticket, slicer project data (plates, filaments); bodies laid on the bed in a print orientation (a transform of a build item from the answer of the query `print`); colours as print colours (the materials extension); a body of several materials.
- The boundary of one face alone (the floor of a pocket, the seat of a counterbore) as an outline; the outline of a sketch; a silhouette of a body; several cuts on one sheet.
- A circle that is made of several faces written as one circle (it is a loop of arcs today), and the exact crossing of two spans as their corner.
- A mirrored drawing, fills and hatching, dimensions and text, a layer per body, a kerf offset.
- DXF of a later release (LWPOLYLINE, splines), Bézier curves in SVG, arcs fitted to the points of a curve.
- A button of the section view of the app that opens the export form with the plane that is shown.
- A note about an export as a whole (need 17 of [cross-review.md](../cross-review.md)): all three formats write one file, whose `about` says everything. It stays open for 5b, the first format that writes a set.

## Sources

No detail of a format is taken from memory. Every one was read in these documents on 2026-11-16, and the places are named in `contract.ts` beside the values:

| Document | Read for |
|---|---|
| 3MF Core Specification 1.4.0, 3MF Consortium, 6 February 2025 (`github.com/3MFConsortium/spec_core`, "3MF Core Specification.md") | the package (1.1, chapter 2), the model, resources and build (chapter 3), objects and meshes (chapter 4), base materials (chapter 5), the schema with its simple types (appendix B.1.1), content types, relationship types and namespaces (appendix C) |
| ECMA-376 part 2, Open Packaging Conventions, fifth edition, December 2021 (`ecma-international.org`), with its schemas `opc-contentTypes.xsd` and `opc-relationships.xsd` | the Media Types stream and its item name (7.2.3, 7.3.7), the Relationships part and its name (6.5.2), ASCII item names without a leading slash (7.3.3, 7.3.4), which ZIP features a package may use (annex B) |
| .ZIP File Format Specification 6.3.10, PKWARE, 1 November 2022 (`APPNOTE.TXT`) | the local file header, the central directory and its end record (4.3.7, 4.3.12, 4.3.16), the fields (4.4), UTF-8 names (appendix D) |
| RFC 1952, section 8 | the CRC-32 with its polynomial, as sample code |
| Microsoft Learn, `DosDateTimeToFileTime` | the bits of an MS-DOS date and time, which the ZIP specification names without describing |
| DXF Reference, AutoCAD 2012, Autodesk (`images.autodesk.com/adsk/files/autocad_2012_pdf_dxf-reference_enu.pdf`) | the structure of a file and what may be left out ("Writing a DXF File"), the group codes of HEADER variables, CIRCLE, POLYLINE, VERTEX and SEQEND, the bulge. It is the reference of its own release: what a file of release 12 leaves out (handles, subclass markers) it shows only by its example program and states as no rule. That part rests on a reader ("Measured"), and is said under "Known limits" |
| Scalable Vector Graphics (SVG) 1.1, second edition, W3C Recommendation, 16 August 2011 | the coordinate system and `viewBox` (7.3, 7.7), path data and the arc command (8.3), `circle` (9.3), `title` (5.4), out-of-range arcs (appendix F.6) |
| Extensible Markup Language (XML) 1.0, fifth edition, W3C Recommendation | which characters a document may hold (production 2), attribute values (production 10, section 3.3.3) |
| IANA, Media Types | `model/3mf`, `image/vnd.dxf`, `image/svg+xml` |

## 3MF

**The container** is a ZIP whose files are stored. Both the 3MF core specification and the Open Packaging Conventions allow that, and a stored ZIP is three kinds of records and a checksum: `storedZip` in `export/zip.ts`, about sixty lines. The records and every value of them are in `contract.ts`. There is no clock in the engine and none is wanted: the date of every item is 1 January 1980, so the same model gives the same bytes, and a test can pin a whole file.

**The package** has three items, in this order: `[Content_Types].xml`, `_rels/.rels` with the one relationship from the package to the model, and the model `3D/3dmodel.model`. The first two are constant texts.

**The model** (`contract.ts`, "the 3MF package", has the whole shape):

- `unit="millimeter"`; one piece of metadata, `Application`. No title (the document has none), no dates (no clock).
- **A body is an object** of the type `model` with its mesh, and a build item without a transform: the bodies are where they are modelled, as in the STL. The parts of a box and its lid keep their places; a slicer arranges them as it likes (3MF core, 3.4.3.1: the arrangement of items "is considered a default").
- **`name`** is the name of the body properties: the body's own name, else that of its feature. **`partnumber`** is the body ID, which does not change when the name does.
- **The colour.** A body with a colour gets a base material: `displaycolor` is the colour, `name` the material label of the body, or the colour itself without one. Two bodies with the same pair share one entry; when one label comes with several colours, their names are the label, a space and the colour, because names of base materials should differ. A body without a colour gets no property, and its material label is not written: a base material cannot be without a colour, and the format does not invent one.
- **The colour is a display colour**, in the body properties and in 3MF alike: the specification says a producer "MUST NOT assume that displaycolor has any effect on the printed part". Nothing here claims more.
- **The mesh** is the mesh of the body: its triangles in their order, and the positions a triangle names, in their order, renumbered. A mesh of the kernel can hold positions no triangle uses (the lid of the box: 148 of 883, each a copy of a used one), and the specification asks a producer not to write duplicate vertices (4.1.3). A coordinate is written as the shortest text that reads back as the same float32 (`float32Text`), so a slicer gets the numbers the STL has. The specification asks of a mesh of the type `model` what the kernel port guarantees of a body (closed, consistently oriented, normals outwards); `lib3mf` confirmed it on every body of the box and the joint. One thing is checked because the specification says MUST and nothing else guarantees it: the three vertices of a triangle are distinct. A body that breaks it is refused as `failed`.
- **Which bodies**: `chosenBodies`, the rule of `stl` moved into a function of its own. Without a list the printed bodies; a listed body is written whatever its use; no body or no printed body is said in `empty`. The file of such an export is a package without an object (`contract.ts`, under `EMPTY`).
- **Where the bodies are.** Two recommendations of the specification are not kept, on purpose: a model "SHOULD be located in the positive octant" (3.3) and items "SHOULD NOT overlap" (3.4.3.1). A body modelled about the origin has negative coordinates, and parts modelled in place may share a volume (a press fit, the fits of the query `interference`). Both follow from writing the bodies where they are, which is what keeps a box and its lid together; a slicer puts objects on its bed itself.

**The name of the file.** `model.3mf`. The specification recommends a double extension for a model, `.model.3mf` (2.2.1), and notes that the single one "remains common in the field". The suggested name stays the common one: the caller names the file anyway (`path` of the tool, the save dialog of the browser).

**The size.** Measured: 1.21 times the STL of the same bodies for the box, 1.24 times for the joint. A vertex is a line of about fifty characters and is written once, where the STL repeats it for every triangle that uses it; so plain text loses less than one would think. Deflated, the model part would be 6.1 to 6.4 times smaller.

## The outline

**The source is the section.** `outlineOf` (`export/outline.ts`) calls `run` of the query `section` with the context of the export, with `outline: 'spans'` and a budget no model reaches. Everything the query says about its cut holds: it is taken `below` the plane, a body with a face in the plane is in `inPlane`, the loops are closed, an outer loop runs counter-clockwise and a hole clockwise, a region has its holes.

**A face as the plane.** With no offset the cut is taken just under the face, inside the body the face belongs to, and shows all the material of that body at that depth.

- For a face that ends its body there (the cap of a plate, the top of a lid) that is the outline of the face. Where a wall leans, the loops differ from the rim of the face by `below` times the slope: the mouth of a countersink of 45° in the top of the lid came out with the radius 3.45992 where the rim has 3.46.
- For a face with material beside it at the same height it is more than the face: the floor of a pocket gives the slab under it.
- A negative offset cuts deeper: the plate of the lid half a millimetre above its underside shows every hole at the diameter it goes through with, which is what a laser wants.
- The option says this in its summary, and `about.inPlane` names the body.

**Which bodies.** A list is taken as it is. Without one: for a face, the body of the face (a screw that passes through the plate is not wanted in the drawing of the plate); for a base plane or a plane feature, the printed bodies, as every export does since D48.

**Nothing cut.** A body that only stands on the plane is not cut (the section is under the plane). The export then holds nothing and `empty` says why; when a body taken has a face in the plane, the text names it and says to move the offset. The tool `export` refuses with the text and writes nothing. The export still returns its one file, as the catalog asks of the layout `file`: a drawing with nothing in it (`contract.ts`, under `EMPTY`). The plane is resolved also when no body is taken, so `about` has its frame.

**The pieces of a loop.** A loop of one arc span is a whole circle and is written as one, with the centre and radius of the surface. Otherwise the loop is a chain of pieces, each from a corner to the next:

- a line span is one straight piece between its two ends;
- a curve span is straight pieces through its points;
- an arc span is cut into two pieces at least, each a quarter turn at most, at equal steps of its sweep. The first piece starts at the `from` of the span and the last ends at its `to`, which are corners of the mesh; the corners between are computed on the circle of the surface. Every piece is the arc of the radius of the surface between its two corners. (A half turn is two pieces whatever the last digit of its sweep: the count has a slack, `TURN_SLACK` of the contract.)

**One arc, two ways to write it.** A piece is one arc: its two corners and the radius of the surface fix it, and the angle it turns by follows from them. DXF writes that angle (as the bulge), SVG the radius. So the two files hold the same curve, and the box of the drawing is the box of those arcs.

**Why the arcs are cut, and why in two at least.** The ends of an arc span are points of the mesh, and where another face cuts the round face between two vertices of its polygon, the end lies inside the circle by up to the sagitta of the polygon; call it `s`. A file gives an arc by its two ends and one more number, and the reader works out the centre. That is ill-conditioned over a long chord, and wrong by more than `s` whenever both ends are off the circle:

- One arc of a half turn: the centre moves by the root of twice the radius times `s`. Measured on a slot made of a rectangle and two discs: the ends are 0.0099 mm inside their circles, and one SVG arc per span with the radius 5 drew each end of the slot with its centre 0.32 mm off.
- One arc of a quarter turn with both ends `s` inside: 1.41·`s` off in its middle. (The first version of this design allowed that piece; a reviewer built the case: a radius of 5.3 with both ends 0.0097 inside gives 0.0137.)
- Two pieces at least, a quarter turn each at most: no piece has both its ends at corners of the mesh, and a piece with one end on the circle and the other `s` inside stays within `s` of the circle everywhere, the furthest at that corner itself. Measured over 15 000 random spans and on the three shapes: every written outline lies within 0.0099 mm of the exact shape, no further than the corners of the mesh.

What this keeps and what it gives up:

- The loop is closed exactly: every piece starts where the one before it ends.
- A whole circle on one face is exact. An arc lies on the circle of its surface except in its two end pieces when the mesh has that end inside the circle; there it comes in to meet the corner.
- **The drawing stays within the chord tolerance of the exact shape, as a curve. Its corners do not.** A corner is where the mesh has it. Where a line meets a circle at a shallow angle, the corner of the mesh stands along the line by `s` over the sine of that angle from the exact crossing: the flat 0.1 deep on a shaft of radius 10 ends at y = 1.3396 in the mesh and at 1.4107 in the exact shape, 0.071 mm apart, while no point of the drawn outline is further than 0.0098 mm from the exact one. A length measured between two such corners of the drawing is off by that much. The exact crossing is not computed: it needs the exact shape of both spans (the line of a span on a cylinder is not where the mesh has it), and at a tangent join, the most common corner of a plate, it is not defined. 1a's design left it to this package; it is deferred, and listed under "Known limits".

**The frame.** The coordinates of the drawing are the x and y of the plane as it was used, the numbers the query `section` reports: for a base plane the axes of the model, for a face the frame of the face, the same one a sketch on it gets. `about.frame` gives the frame and `about.below` how far under it the cut was taken, so a hole of the drawing can be found in the model. The drawing is seen against the normal: for a face, from outside the body.

### DXF

The form of release 12, written as the smallest file the reference describes ("Writing a DXF File": tables and blocks left out, entities with their layer and coordinates as in its example program). The reference is that of a later release and does not spell out the rules of a release 12 file; what the design takes on beyond it is listed in `contract.ts` and under "Known limits".

- a HEADER with `$ACADVER` `AC1009`, `$INSUNITS` 4 (millimetres) and `$MEASUREMENT` 1 (metric); no TABLES, no BLOCKS;
- a whole circle as CIRCLE;
- every other loop as one closed POLYLINE: a VERTEX per piece, with the bulge of an arc piece (the tangent of a quarter of the angle the piece turns by, negative clockwise), and SEQEND. One entity per loop is what a laser or CAM program wants: a contour it does not have to stitch from loose lines and arcs;
- outer loops on the layer `OUTER`, holes on `HOLES`, so a program can tell them apart (to cut the holes first, say).

No text of the model goes into the file (no names), so the file is ASCII and there is nothing to escape.

### SVG

- `width` and `height` in millimetres with a `viewBox` of the same numbers: one user unit is a millimetre for every reader. The box is that of the drawing with a margin of 1 mm.
- The y of SVG points down: a point (u, v) is written (u, −v). No transform is used: the file asks nothing of a reader but paths and circles.
- A group per body with its name in a `title`; in it a `circle` per whole circle and a `path` per other loop, with `class="outer"` or `class="hole"`. Stroked 0.1 mm in black, not filled.
- In a path an arc piece is `A r r 0 0 f x y`: the radius of the piece, never the large arc (a piece is a quarter turn at most), and the sweep flag 1 for a piece that turns clockwise in the plane.

## Measured

The spike (2026-11-16) is a prototype of the writers, about 350 lines of TypeScript with no import but the types of the engine, run by Vitest from the session scratchpad against the sources of the worktree with the real adapters. The models: the box of scenario 12 as the part of 2c leaves it (`box.ts`, every step), the joint of scenario 9 (`joint.ts`), and three shapes made to stress the arcs. The files were then read by programs that share no code with the writers. They were installed into a Python environment in the scratchpad for this measurement only; none of them is a dependency of the project, and none is proposed as one. The numbers below are of the prototype as this version of the design describes it (run again after the first round of reviews), unless a column says otherwise.

**3MF**

| | Box (2 bodies), with a name, a colour and a material set | Joint (8 bodies) |
|---|---|---|
| Triangles | 2 926 | 17 146 |
| Positions of the meshes, and of them written | 1 603, 1 455 | 8 525, 8 525 |
| 3MF, stored | 177 999 bytes (177 803 without the properties) | 1 066 092 bytes |
| STL of the same bodies | 146 384 bytes | 857 384 bytes |
| Ratio | 1.22 (1.21) | 1.24 |
| Time to write | 5 ms | 31 ms |
| The model part deflated (zlib, level 6) | 29 112 of 177 078 bytes (6.1 times smaller) | 165 557 of 1 065 171 bytes (6.4 times smaller) |

| Reader | What it said |
|---|---|
| `unzip -t`, `zipinfo -v` (Info-ZIP) | no errors; three items, stored, version 1.0 to extract, 1 January 1980 |
| Python `zipfile` | `testzip()` finds no bad item |
| `xmllint` | the model part is well-formed |
| `lib3mf` 2.5.0 (the library of the 3MF Consortium), strict mode | no warning. Every object: its name (also `Lid <A&B> "top"`, read back as written), its part number, the type `model`, "manifold and oriented". The volume of each mesh as read equals `BodyResult.volume` to ten digits (box 28 409.368025381, lid 18 154.713184659), also for the lid with its 735 vertices renumbered. Two base materials with their names and colours, `#30343a` and `PETG` `#ff8800`; a build item per object; millimetres. A package without an object (the file of an empty export) reads without a warning too |
| BambuStudio 2.9.1, `--info` | both files load: every object "manifold = yes", the box 80 × 50 × 30 with 1 440 facets and the volume 28 409.37. Its report centres each object, so it does not show where the slicer puts them, and it does not print their names or colours |

**The outline**

| Cut | Loops | Written as | Ends of arcs off their circles |
|---|---|---|---|
| The plate of the lid, 0.5 above its underside | 6 | a polyline of 4 lines, 5 circles | none (whole circles) |
| The top face of the lid, no offset | 6 | a polyline, 5 circles (the mouths of the countersinks) | none |
| The box at z = 10 | 6 | 3 polylines (19 lines, an arc of 250° in 3 pieces), 3 circles | 0.0093 mm (the post grown into the bracket) |
| The floor of the cavity as the plane | 1 | a polyline: the slab 80 × 50 | none |
| The base plane the box stands on | 0 | a drawing with nothing in it; the box is in `inPlane` | |
| The joint at z = 40 | 19 | 14 circles, 5 polylines of teeth (the housing with 720 points) | none |

The three shapes, each cut across: a shaft of radius 10 with a flat 0.1 deep (an arc of almost a whole turn whose ends another face cut); a slot, a rectangle 30 × 10 with a disc of radius 5 added on each end (two half turns; the corners of the rectangle are on the exact circles and 0.0099 outside their polygons, so the loop has four stubs that long); two discs of radius 8 whose centres are 10 apart (two arcs that meet at corners inside both circles).

| Shape | Area, exact | Area, mesh | One arc per span, SVG | As designed, DXF | As designed, SVG | As designed: furthest from the exact shape |
|---|---|---|---|---|---|---|
| Shaft | 313.971 | 313.579 | 313.998 | 313.789 | 313.789 | 0.0098 mm |
| Slot | 378.540 | 378.333 | **384.815** | 378.343 | 378.343 | 0.0099 mm |
| Two discs | 349.929 | 349.452 | 350.152 | 349.763 | 349.763 | 0.0099 mm |

- "One arc per span" is the first prototype: the radius of the surface between the two ends of the mesh. The slot is 6.3 mm² too large: each half turn got its centre 0.316 mm outside.
- "As designed": two pieces at least, a quarter turn at most, each the arc of the radius of the surface between its corners. The area of a DXF file is computed from the vertices and bulges `ezdxf` read (the polygon of the corners and the segment of every arc); that of an SVG file from 20 000 points `svgelements` puts on each path. The two agree to four digits and more: the same curve. (The paths `ezdxf` itself makes of a polyline are no measure of this: it approximates an arc, and gave 313.854 for the shaft.)
- "Furthest from the exact shape" is over points on every piece as each reader holds it; it is reached at the corners of the mesh, which are that far inside their circles.
- The corners themselves: the flat of the shaft ends at (9.9, ±1.3396) in the drawing and at (9.9, ±1.4107) in the exact shape.

The rule of the pieces, apart from any file (`pieces.py` of the scratchpad: a span about the origin with its two ends up to 0.01 mm inside the circle, the pieces sampled at 120 points each; 15 000 random spans, radius 0.1 to 1000 mm, sweep 0.05 to 6.23 rad):

| Pieces | Arc of a piece | The worst distance from the circle, over the larger of the two end errors |
|---|---|---|
| a quarter turn at most, one piece allowed | the radius of the surface between the corners | 1.413 (a quarter turn, both ends inside) |
| two at least, a quarter turn at most | the radius of the surface between the corners | 1.000 |

The case of the review (radius 5.3, a quarter turn, both ends 0.00967 inside): 0.01366 as one piece, 0.00967 as two.

| Reader | What it said |
|---|---|
| `ezdxf` 1.4.5 | every file loads as `AC1009` with the units 4 (millimetres); its audit finds no error and fixes nothing; every POLYLINE is closed; the layers are `OUTER` and `HOLES`. The drawing with nothing in it loads the same, with no entity |
| `svgelements` 1.9.6 | every file parses; widths and heights in millimetres, the `viewBox` as written |
| `librsvg` (`rsvg-convert`) | renders the files; the pictures of the lid, the box and the slot were looked at (of the first prototype with quarter turns; the curves of this version differ from those by less than 0.01 mm) |

Not measured: no file was opened in AutoCAD, in a laser or CAM program, or in the window of a slicer. See "To verify before the implementation".

## Where the code lives

| File | What 2g does there |
|---|---|
| `packages/engine/src/export/bodies.ts` | new: `chosenBodies`, the list of bodies of a print export and its two texts, moved out of `stl.ts` |
| `packages/engine/src/export/stl.ts` | calls `chosenBodies`; its behaviour and its texts do not change |
| `packages/engine/src/export/text.ts` | new: `plain`, `float32Text`, `xmlText` |
| `packages/engine/src/export/zip.ts` | new: `crc32`, `storedZip` |
| `packages/engine/src/export/threemf.ts` | new: the format `3mf` (the options, the line of `ExportFormats`, `baseMaterials`, the model part) |
| `packages/engine/src/export/outline.ts` | new: `OUTLINE_OPTIONS`, `outlineOf`. (The engine already uses "outline" for the exact outline of a profile, `ResolvedProfile.outline`; this module is the outline of a cut and lives in `export/`) |
| `packages/engine/src/export/dxf.ts`, `svg.ts` | new: the formats `dxf` and `svg`, each a line of `ExportFormats` and a writer over `Outline` |
| `packages/engine/src/export/index.ts` | three lines of `EXPORT_FORMATS` |
| `packages/engine/src/index.ts` | exports `storedZip` (the app saves a set of files with it) |
| `packages/app/src/panels/args.ts` | new, by moving: what `panels/query.ts` does with a draft of arguments and its rows (`specAt`, `withValue`, `selected`, `given`, `nextToArm`, the rows from `ArgSpecs`). No behaviour changes |
| `packages/app/src/panels/export.ts` | new: the menu, the form and the save of an export |
| `packages/app/src/app.ts`, `panels/model.ts`, `panels/query.ts` | the menu in the toolbar, the form in the model panel, a selection of the view offered to the form, one of the two forms open at a time |
| `packages/mcp/test/export-formats.test.ts` | the rows of the three formats in its two typed tables (`calls.ts`, part e) |

`export/outline.ts` imports `query/section.ts`; `query/*` and `export/*` are on one level of the import order ([architecture/repository.md](../../architecture/repository.md)) and `export/index.ts` already imports from `query/`. Nothing in `query/` imports `export/`.

The order of the work: the three small modules and `3mf`; then the outline with its two writers; then the form of the app; then the scenario and the documents. The first two steps do not depend on each other.

## What the package adds

| To | What |
|---|---|
| The document | nothing |
| Commands | none |
| Queries | none; the outline calls `run` of `section` |
| Feature types, `FEATURE_UI`, face roles | none |
| Issue codes | none. A format refuses like a query (`contract.ts`, the table of refusals): `notAvailable` at `['plane']` and `failed` for a mesh that is not closed pass through from `section`; `failed` for a triangle that names a vertex twice, a coordinate that is not finite, and a file that does not fit a ZIP without ZIP64 (65 535 entries or more, 4 GiB, a name over 65 535 bytes) |
| Export formats | `3mf`, `dxf`, `svg` |
| The index of the engine | `storedZip` |
| MCP | no code. The tool `export` lists the formats and takes their options from the catalog; `describe_api` gets three entries in its section *Export formats* from `title`, `summary` and the options. Five tests pin the list of formats and get the new one: four in a message ("the formats are stl": `packages/mcp/test/export-formats.test.ts`, `server.test.ts`, `packages/scenarios/test/export.test.ts`, `review.test.ts`) and one as the keys of the catalog (`packages/engine/test/export.test.ts`) |
| The app | the export form (below) |

### The app

The rule of the project is that every function is reached from the app and through MCP. Today a format added to the catalog is reached through MCP only.

- **A menu *Export…*** in the toolbar, beside *Export STL*: every format of `EXPORT_FORMATS` by its title, like the menu of the queries. A format needs no entry anywhere to be there.
- **The form** is the generic form of a query over the options of the format: the same controls by kind of argument, a plane or a face picked in the view, the option a refusal names is marked. *Export* asks `engine.export` about the state the marker shows: with `{ at: marker }`, and with no `at` when the marker is at the end of the timeline (it is `null` there, as the form of a query handles it).
- **What is saved.** One file is saved under its suggested name. A set (`stl` with `perBody`; later a robot description with its folder) is saved as one ZIP built by `storedZip` from the files under their paths: a browser cannot write a folder. (`storedZip` refuses a name over 65 535 bytes; a body ID is not limited in length, so the form shows that refusal like any other.) A refusal and the text of `empty` stay in the form.
- **One form at a time.** The form of an export and the form of a query share their place in the model panel and the selection of the view; opening one closes the other.
- **The two STL shortcuts stay** as they are: the button of the toolbar and the link of a body.
- The snapshots of `packages/app/test/app.test.ts` change where they record the toolbar (the menu is new in it); a new snapshot drives the form.

## The schema

No step. Nothing is stored: an export reads a state and returns bytes, and its options live in the call. An older build has nothing to drop. `SCHEMA_PENDING` is not touched.

## What 3a gave and what 5b gets

- **From 3a:** `printedBodies` for the default list; `name`, `color` and `material` of `BodyPropertiesResult` for an object and its base material. The rule of 3a for a listed body ("as listed, whatever its use") is the rule here.
- **For 5b** (URDF and MJCF, which the plan makes depend on this package):
  - `xmlText`, `plain` and `float32Text`: both robot descriptions are XML with names of the user and many numbers.
  - `chosenBodies`, if a description takes a list of bodies.
  - `storedZip`: the app saves a set with folders as one ZIP. The server writes folders itself; that part of the writer is still 5b's (`server.ts` refuses a path with a folder today).
  - Meshes: 5b writes its link meshes with the entry `stl`, as its outline says. Nothing of `3mf` is needed for it.
  - Not given: a note about an export as a whole. 5b is the first format with a set of files and decides it.

## Rejected alternatives

1. **A library for ZIP and deflate.** A new third-party library (D2) for something sixty lines do without it. The price is the size of the file. Left to the owner under "Open".
2. **Deflate written in the engine.** A compressor is a few hundred lines with their own failure modes, and a file that only this code ever compressed is tested by this code alone. Not for a quarter of a megabyte.
3. **Deflate as a port given to `createEngine`.** Node has it built in, so the server could pass it with no library; the browser has it only asynchronously, and `export` is synchronous. The same model would give different bytes by where the engine runs, and a port would exist for one format.
4. **Compressing in the writer of the server.** The writer would have to open the package the engine made; the app would not profit.
5. **Bodies laid on the bed by item transforms.** Which face lies on the bed is a decision the query `print` helps with and the slicer takes; an export that turns parts would hide where they were modelled. Deferred, not rejected, as an option.
6. **One object with components** for the whole model. Components are for parts that are printed interlocked (3MF core, 3.4.3.1); the bodies of a model are separate parts.
7. **A colour of a material that has none**, so that a material label alone could be written. A made-up grey in a file is a claim about the part.
8. **The material label as metadata in a namespace of our own.** A namespace to publish and keep for a label no reader looks at.
9. **The exact corners of 1a**: crossing the exact line and the exact circle. It needs the exact shape of both spans (the line of a span on a cylinder is not where the mesh has it) and is undefined at a tangent join, the most common corner of a plate. It would be the better drawing where a line meets a circle at a shallow angle (the corner of the mesh is 0.071 mm along the flat of the shaft from the exact one), and it would not have saved the arcs: the measurement shows that a drawing goes wrong by tenths of a millimetre through the way an arc is written, not through its corners. Deferred, with the limit stated.
10. **One arc per span.** Measured above: 0.32 mm for a half turn. **A quarter turn as one piece** (the first version of this design): 1.41 times the error of its ends when both are inside the circle.
11. **The ends of an arc moved onto its circle.** The arc is then exact, and no longer starts where its neighbour ends: either the loop has gaps or the neighbour is moved too, and a neighbour that is an arc of another circle is then off its own.
12. **Polylines only** (`outline: 'polylines'` of the section). A hole would be a polygon of sixty corners with no centre and no radius; a drilling template needs the centre, and the surfaces know both exactly.
13. **LINE and ARC entities.** Loose entities are not a contour a program can take as one. And an ARC is a centre, a radius and two angles: with those of the surface it does not end at the corners of the mesh, where its neighbours start (alternative 11 again).
14. **A DXF of release 2000 or later** for LWPOLYLINE. The reference gives the minimal file only as entities with their coordinates; a file that names a later release has tables, handles and objects to keep consistent. POLYLINE with VERTEX carries the same bulge.
15. **SVG with a transform that turns y over**, so the numbers of the file are those of the plane. A reader that skipped the transform would mirror the part without a word; a file without one cannot be read that way.
16. **One format `outline` with an option for the file type.** A format is named by what it writes (`stl`, `3mf`); the media type and the suggested name would depend on an option.
17. **A file of 3MF per body.** That is `stl` with `perBody`, or a list of one body.
18. **A button per format in the app.** The next format (5b) would need another; the generic form needs nothing.
19. **The outline as a query that returns the drawing as text.** A query answers with JSON a tool prints; a file is an export.

## Known limits

- **The 3MF is not compressed**: a fifth to a quarter larger than the STL. A file of 4 GiB or more is refused (no ZIP64), far beyond a model the kernel handles.
- **The bodies are where they are modelled**, so two recommendations of 3MF are not kept: coordinates may be negative, and parts modelled in place may overlap (3.3, 3.4.3.1).
- **What a slicer shows of the 3MF was read by a library, not seen.** `lib3mf` reads the names, part numbers and base materials. Whether a given slicer shows the names and the colours, and where it puts the objects, was not looked at. Slicers keep their own project data in extensions; none is written.
- **A material label without a colour is not written.** Two base materials can still get one name when a label itself ends in a colour (`PETG #ff8800` beside a `PETG` in two colours); the specification says names "should" differ.
- **The outline has the accuracy of the mesh.** Where a round face is cut by another face, a corner is inside the exact circle by up to the chord tolerance of the document (0.01 mm by default), and above the caps on the number of segments by more ([1b](../1b-measure/design.md)). The drawn curve is within that of the exact outline. A shape that is tangent in the exact model may have a stub there as long as the sagitta (the slot: four stubs of 0.0099 mm). A profile drawn with its arcs in one sketch has none: its arcs end in vertices of their polygons.
- **A corner is where the mesh has it, not at the exact crossing.** Along a shallow crossing of a line and a circle it is off by the sagitta over the sine of the angle (0.071 mm for a flat 0.1 deep on a shaft of radius 10). A dimension taken between such corners of the drawing carries that error; the drawn outline itself does not leave the tolerance. 1a's design expected this package to compute the crossing; it does not.
- **A circle made of several faces is not written as a circle.** A hole sketched as two arcs has two round faces: its loop is arcs with the right radius and no CIRCLE or `circle`, so its centre is not in the file. A circle of one sketch curve, and every hole of the hole feature, is one face.
- **A curve is a polyline**: the teeth of a gear, an ellipse where a plane cuts a cylinder askew.
- **A face as the plane is the cut just under it**, not the face alone; the loops differ from the rim of the face by the precision of the coordinates times the slope of the wall.
- **DXF in the form of release 12, of which the cited reference states only a part.** No LAYER table (the layers are made by the reader, colour 7 by the reference); the units are said by two header variables a reader of such a file may skip, and are millimetres either way. That a file of this release may leave out handles and subclass markers, and may have a HEADER of three variables, is not written in the reference of 2012: it follows its example program, and `ezdxf` reads the files as release 12 without a complaint. No other reader was tried.
- **The SVG is stroked only**, with a fixed width.
- **The tests cannot use an independent reader** (no library is approved for it): they read a ZIP back with a few lines of their own and pin texts. The check with independent readers is done by hand once, as under "Measured".

## To verify before the implementation

- The files of the scenario in the programs the owner uses (see "Open"): the 3MF in the window of the slicer (are the names and the colours shown, do the box and the lid keep their places), the DXF and the SVG in the laser or CAM program (millimetres, closed contours, circles as circles).
- That `chosenBodies` moves out of `stl.ts` with every existing test of `stl`, `exportMesh` and `export_stl` unchanged.
- How the tests of the app record a saved file of bytes (`app-kit.ts` records the name of a download): the snapshot of the export form should show the name and the size.
- `crc32` of `node:zlib` in the Node of the project, for the test of `storedZip`.

## Tests the implementation owes

- **`zip`**: an archive read back by a reader of the test (end record, central directory, local headers): names, sizes, offsets, the stored bytes; every checksum against `node:zlib`; the flag of a name that is not ASCII; the refusals at their edges: 65 534 entries pass and 65 535 do not, a name of 65 535 bytes passes and one of 65 536 does not (the sizes of 4 GiB are checked by the arithmetic, not by a file).
- **`text`**: `float32Text` reads back for a sweep of float32 values (small, large, negative, powers of ten) and never writes more than nine digits, "-0", or a form ST_Number does not take; `plain` without an exponent; `xmlText` for the five characters, the three white spaces, a control character, a lone surrogate.
- **`3mf`**: the whole file of a small model pinned; names and colours; `baseMaterials` (shared entries, a label with two colours, no colour); the object IDs with and without a group of base materials; the mesh read back equal to the solid, with a mesh that holds positions no triangle names (they are left out and the rest renumbered); a triangle that names a vertex twice refused; the lists of bodies and both `empty` texts, with the file of an empty export; `at` and `after`.
- **`outlineOf`**: a whole circle; a line; an arc of a few degrees, of a quarter turn, of a half and of almost a whole turn (never one piece, the corners between on the circle, the turn of a piece from its corners and radius); the case of the review, a quarter turn of radius 5.3 with both ends 0.0097 inside its circle, within that of the circle everywhere; a sweep of random spans as in `pieces.py`; a circle of two faces (arcs, no circle); a curve; a hole; the bounds with an arc that bulges past its corners; the bodies taken for a face and for a base plane; the two `empty` texts, with a plane resolved when no body is taken; `about` with `below`.
- **`dxf`, `svg`**: the whole text of two small drawings pinned (a square with a round hole; a slot); the bulge and the sweep flag for both directions; the two files of one outline describe the same arcs (the radius a bulge implies is the radius the SVG states); a drawing with nothing in it; a name that needs escaping in a `title`.
- **The three shapes of the spike** as a test of the engine against the real adapters: the written arcs within the chord tolerance of the exact shapes, computed by the test from the pieces.
- **Scenario 12**, the part of `calls.ts`.
- **MCP**: the rows of the two typed tables; the tool `export` writing a 3MF and a DXF to disk; the list of formats in the five tests that pin it.
- **The app**: a snapshot of the menu and the form (a face picked into `plane`, a refusal at its option, the text of `empty`, the saved file, a set saved as a ZIP, an export with the marker at the end of the timeline and with it after a feature); `panels/args.ts` moved with the snapshots of the query form unchanged.

The engine part writes file formats, where a mistake is silent until another program reads the file: it should get a full review. The form of the app is a light one by the table of CLAUDE.md.

## Open

Questions for the owner:

1. **Is a 3MF that is not compressed good enough?** It is a fifth to a quarter larger than the STL (178 kB against 146 kB for the box). *Yes* keeps the design. *No* means a deflate library has to be chosen and approved (D2), or a compressor written in the engine; the design does neither.
2. **Is "a face as the plane gives the cut just under it" enough for the outline of a face?** It is the outline of the face for a plate; for the floor of a pocket it is the whole slab. *Yes* keeps the design; *no* adds the boundary of one face as a second source of loops (a pass over the edges of the face in the mesh) to this package.
3. **Are the corners of the mesh good enough for a drawing?** The drawn outline is within the chord tolerance (0.01 mm) of the exact one, but a corner where a line meets a circle at a shallow angle stands where the mesh has it (0.07 mm along the flat of the shaft above). *Yes* keeps the design; *no* adds the exact crossing of two spans, which 1a's design expected of this package, where it is defined.
4. **Which programs should the files be checked in before the package is closed?** A slicer window for the 3MF (names, colours, whether the parts keep their places), a laser or CAM program for the DXF and SVG. Without an answer the check stays the one of the spike (`lib3mf`, BambuStudio `--info`, `ezdxf`, `librsvg`).

## Reviews

The owner's rule for designs: three independent reviewers, read-only, with one brief (what is under review, what to read, what to look for, what to return): a fresh internal subagent, `codex` (gpt-6-astra, high) and `agy` (gemini-4-argon-high). The reviewers were also given the texts of the specifications, the prototype and its files. Every finding was checked against the code, a specification or a measurement before it was acted on.

### Round 1 (2026-11-16), at `2e4b793`

`agy` did not run: its account was out of quota (HTTP 429, "resets in 110 h"). The round went on with the other two.

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| A quarter turn as one piece is not within the tolerance: radius 5.3, both ends 0.0097 inside their circle, the SVG arc is 0.0137 off in its middle. The three measured shapes did not show it | codex, major | Yes (computed again: 1.41 times the end error; `pieces.py`) | An arc is two pieces at least, so no piece has both ends at corners of the mesh; the bound is then the end error itself, measured over 15 000 random spans. The case is among the owed tests |
| DXF and SVG encode different curves from one outline: DXF fixed the turn, SVG the radius, and with an end inside the circle the two do not agree (the slot: radius 4.9951 against 5). The box "of what is drawn" was not that of either | codex, major; internal, minor | Yes | A piece is one arc, of the radius of the surface between its corners; its turn follows from them, and the bulge from the turn. Both files now hold the same curve (areas equal to four digits and more), and the bounds are of those arcs |
| The form of the app passes `{ at: marker }`, and the marker is `null` at the end of the timeline: `at: null` is refused | codex, major | Yes (`host.ts`, `engine.ts`; `panels/query.ts` leaves `at` out) | No `at` when the marker is null; in the contract, the design and the tests of the app |
| `storedZip` checks the size and the number of entries, not the length of a name: 65 536 bytes are written with a length of 0. Body IDs and paths of an export have no limit | codex, major | Yes (the field is two bytes) | A name over 65 535 bytes is refused. And the limits were off by one: 0xFFFF entries and 0xFFFFFFFF bytes mean ZIP64, so 65 535 entries or more and 4 GiB less a byte or more are refused (internal, minor) |
| The one file of an export that holds nothing is not specified, and the SVG would throw on a box that does not exist; `about.frame` is required but the outline returned before the plane was resolved; a 3MF without a body has a build without an item | internal, major | Yes (`runExport` holds the layout `file` to one file and rethrows what is not a `QueryFailure`; the spike had skipped empty outlines) | The three empty files are stated and were written and read back (a drawing with no entity, a box of the margin, a package without an object, which `lib3mf` takes); `section.run` is called also with no body, so the plane is resolved and `frame` is there; `calls.ts` has the cases |
| "Moving a corner to the exact crossing changes it by less than the chord tolerance" is false: the flat of the shaft, 0.071 mm | codex, minor | Yes (1.3396 against 1.4107) | Said as it is: the curve is within the tolerance, a corner on a shallow crossing is not. Under "The pieces of a loop", "Known limits", rejected alternative 9, and as a question for the owner |
| `about` loses how far under the plane the cut was taken; the frame alone does not give the place in the model | codex, minor | Yes | `below` in `OutlineAbout` |
| `MeshAbout` and `OutlineAbout`, as interfaces, are not assignable to `ExportFile.about`; `FIXTURES` as `const` does not fit the type of the options (a readonly tuple for a list) | codex, internal, minor | Yes (compiled) | Type aliases, with an assignment in `calls.ts` that holds them to it; the two tables typed as in the test |
| "The mesh as it is" writes positions no triangle names: the lid has 883 positions, 735 used, the others copies; 3MF asks for no duplicate vertices | internal, minor | Yes (counted) | Only the positions a triangle names are written, renumbered; read back by `lib3mf` with the same volume. The file of the box is 177 803 bytes, not 184 748 |
| A circle made of two faces gives two arc spans: a loop of arcs, no circle, no centre in the file | internal, minor | Yes (`whole` in `section.ts` is a loop on one face) | A known limit, and deferred |
| Two SHOULDs of 3MF are broken by "where they are modelled": the positive octant, items that overlap. Base material names can still collide | internal, minor | Yes | Said under "3MF" and "Known limits"; the fourth question asks the owner to look at where the parts land |
| "The form of release 12" is not in the cited reference: its POLYLINE has a subclass marker, its HEADER may be left out, not shortened | internal, minor | Yes | Said in "Sources", in the contract and under "Known limits": this part rests on the example program of the reference and on `ezdxf` |
| The reason against ARC entities is wrong: the surface gives the centre, nothing has to be computed | internal, minor | Yes | The reasons that hold: such an arc does not end at the corners of the mesh, and loose entities are no contour |
| Five tests pin the list of formats, not four | internal, factual | Yes (`packages/engine/test/export.test.ts`) | Corrected |
| The offset of the centre is the root of twice the radius times the error, not of the radius times the error | internal, factual | Yes | Corrected (the number 0.32 was right) |
| Numbers of "Measured" that do not match the outputs: 8 ms against 5; the size of one file beside the deflate figure of another | codex, internal, factual | Yes | The table is of one file and one run, written again from the last report. The BambuStudio numbers are now kept with the outputs |
| "SVG takes no exponent" | codex, factual | Yes (the grammar of path data has one) | A choice of the writer, said so |

Checked by the reviewers and found sound: the dispatch through the catalog, the check of the options and every refusal code and path of `calls.ts` (run against the real engine by the internal reviewer); that nothing of `packages/mcp/src` changes; the 3MF package against the specification and the schema (items, content types, the relationship, the order of elements, IDs, the types of values) and the escaping against XML 1.0; every offset of the three ZIP records, the CRC and the date; the bulge and its sign, the closed flag; the sweep flag with y turned over, the millimetres; the numbers of `calls.ts` against the outputs; the import direction, no dependency, no schema step; that the open questions are real.

Not acted on: nothing was dismissed. Two findings became known limits instead of changes (a circle of several faces; the exact corners), with the second put to the owner.

## Rows for the indexes

**`docs/d36/README.md`, the row of 2g, column "Design now":**

> full, designed 2026-11-16 ([2g-export/design.md](2g-export/design.md)), D54: the formats `3mf` (a stored ZIP written by the engine, no library), `dxf` and `svg` (the section of a plane; arcs in two pieces at least, a quarter turn each at most, whole circles exact), a generic export form in the app; no schema step. 5b gets `xmlText`, `plain`, `float32Text`, `chosenBodies` and `storedZip`

and in "Numbers": D54 taken by 2g; scenario 12 gets a part of 2g.

**`docs/decisions.md`, the row:**

> | D54 | [2g Export: 3MF, DXF, SVG](d36/2g-export/design.md) | designed 2026-11-16 | Three export formats in the catalog of D37, without a library: `3mf` (the bodies as named objects with their display colours, in a ZIP the engine writes uncompressed) and the outline a plane cuts out of bodies as `dxf` (release 12: circles and closed polylines with bulges) and `svg` (millimetres); the app gets a generic export form |

**`docs/requirements.md`, scenario 12, the part of 2g:**

> - *Export (2g, D54).* The box and the lid as one 3MF: a ZIP of three stored items the engine writes itself, an object per printed body with its name and its ID as the part number, and the very coordinates of the mesh; with a colour and a material on the lid, a base material named `PETG`; a body marked as a reference part is left out unless it is listed, and a model with no printed body says so. The plate of the lid as a drawing for a laser, cut half a millimetre above its underside (`plane`: the face, `offset`: −0.5): as DXF one closed polyline 80 × 50 on the layer `OUTER` and five circles on `HOLES`, the four screw bores of radius 1.8 over the posts and the bore of 2.5 in the middle; as SVG the same loops in millimetres with y turned over. The top face of the lid with no offset gives the mouths of the countersinks. The box cut at z = 10 has the ring of its walls with the rib and the bracket, three posts as circles and the fourth, grown into the bracket, with its round side as an arc in three pieces. The floor of the cavity as the plane gives the whole slab under it; a plane the box only stands on gives nothing and says to move the offset; a round face is refused at `plane`.

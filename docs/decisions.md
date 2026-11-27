# Decisions

A living document. It records what was decided, why, and what was considered. Decisions are not immutable; when one changes, its record is rewritten and the original state is given in a note.

Last change: 2026-11-27

## Overview

| # | Topic | State | Decision |
|---|---|---|---|
| D1 | Engine language | decided | TypeScript |
| D2 | Third-party libraries | decided | Allowed, each approved separately and behind an interface of its own |
| D3 | Document model | decided | A log of operations that holds the intent, geometry derived by replaying it |
| D4 | References to geometry | decided | IDs derived from the origin of the entity, not from the order |
| D5 | Sketches | decided | A constraint solver from the start |
| D6 | Constraint solver | decided | planegcs (WASM) behind an interface of its own |
| D7 | Representation of bodies | decided | Mesh/CSG, no B-rep |
| D8 | Mesh/CSG kernel | decided | Manifold (`manifold-3d`) behind an interface of its own |
| D9 | Extrude | decided | The engine builds the mesh itself, the kernel does only booleans |
| D10 | Timeline vs. command history | decided | A sketch is one feature; undo is a separate command history |
| D11 | Document | decided | An immutable structure, undo = a stack of documents, cache = memoisation |
| D12 | Solving a sketch | decided (reworked), additions in D25 and D27 | A sketch is solved during the recompute when the inputs of the solver have changed; the engine then updates the solved variables in the document |
| D13 | Split face | decided | Stays one logical face |
| D14 | Sketch plane on a face | decided | Computed analytically from the definition of the feature |
| D15 | Repository structure | decided | pnpm workspace: engine, two adapters, app; Vitest |
| D16 | Sketch anchor | decided | A reserved fixed point `origin` in every sketch |
| D17 | Form of constraints | decided | Every variant has named operands; the conditions of an arc are kept by the solver; reference dimensions are computed by the engine |
| D18 | Orientation of a plane on a face | decided | The normal always points out of the body, the sign from the mesh, X = Y × N |
| D19 | Coplanar booleans | decided (reworked), additions in D27, D28 and D29 | Tolerance of coplanar faces is a guarantee of the kernel port; the Manifold adapter meets it by turning every contact in one plane into a penetration before the boolean, and after it returning the faces and cleaning the mesh |
| D20 | Kernel precision | decided | `Solid.positions` is a `Float32Array`, analytic computations in float64 |
| D21 | Custom plane | decided | `PlaneFeature` with an offset from a plane or a face; a tilt about an edge is a future function |
| D22 | Naming of edges | decided | An edge = a pair of face names; the line analytically, the extent from the mesh |
| D23 | Projected geometry | decided, addition in D28 | Straight and circular edges of a body as fixed reference curves in a sketch; the kind of the curve is stored |
| D24 | API extensions from the UI design | decided | `batch`, a position in `addFeature`, `getState(at)`, construction geometry, data for selection |
| D25 | Changes from the second review | decided | A cap without a mark of the region, the state `warning`, the stamp of a sketch solution, the edge `coplanar`, the order of the ends of a projected line and more |
| D26 | Export format | decided | STL in the PoC, 3MF later |
| D27 | Changes from the third review | decided | Return of shifted faces in the adapter, one rule for solving a sketch, the contract of commands, an exact definition of regions and more |
| D28 | Changes from the fourth review | decided | The kind of a projection in the document, validation separates references within a sketch and between features, a reworked kernel adapter, a fix of the source sketch of an extrude and more |
| D29 | Random tests of the kernel adapter, adapters in packages | done during the implementation, not yet confirmed by the owner | The kernel adapter is checked by random sequences of booleans against two independent oracles; the return of faces is exact, the mesh is always cleaned and closedness is checked; both adapters are in packages with tests |
| D30 | Decisions from the implementation of the engine | done during the implementation, not yet confirmed by the owner | Points the design left open: dragging outside a batch, the criterion "no effect", a profile touching at a point, loading a document with a reference to a feature in another order and more |

| D31 | Demo application | done during the implementation, not yet confirmed by the owner | `packages/app`: three.js and Vite without a UI framework; covers the functions of ui.md needed to go through the validation scenarios; what the UI derives on its own and what is left out |
| D34 | Symmetry and the midpoint of a line | decided | Two new geometric constraints; adding a constraint is a catalog entry, a type, the equation of the analysis and the translation for the solver, the app and MCP take it over on their own |
| D33 | Interface for AI (MCP server) | decided | `packages/mcp`: general tools over the engine with a description generated from the sources of the engine; works over a file and over the running app through a local bridge |
| D32 | Sketch diagnostics | decided | From its own analysis of the equations of constraints, the engine tells how many degrees of freedom a sketch has, which constraints are redundant, what they follow from, which set can be removed and what can still move; the same driving constraint cannot be added twice |
| D35 | [Extensions for the robot joint](decisions/D35-robot-joint.md) | decided, including the fixes after two reviews of the design and after the review of the contract; the gear spike done; all implemented: step 0 and points 1 to 7 | Seven functions in cheap variants that do not close the way to the full ones: parameters and expressions over a catalog of numeric fields, the extent of an extrusion as a variant ("through all"), gearing as a profile generator for an extrusion, a pattern as a list of transforms (of features and of bodies), export by bodies and queries over bodies, equal radius and a fixed point, shared sketch tools (polygon). A full assembly, patterns in a sketch, import and fillets are not done |
| D36 | [Order of work after D35](decisions/D36-order-after-d35.md) | decided 2026-11-14; the preparatory step (D37) is done; the plan is in [d36/README.md](d36/README.md) | Seven steps for the intended use (printed parts, mostly for a robotic arm, built with an AI through MCP): queries that let the AI see and measure, bracket and box, bought parts, shapes beyond prisms, mechanism, sketch, the rest. No assembly with mates, no 3D sketches with constraints, no fillets of general edges. Designs of the features are proposals in backlog.md |
| D37 | [Preparatory step of D36](d36/00-prep/design.md) | scope decided 2026-11-14, design 2026-11-15 after five rounds of reviews; implemented 2026-11-15, all six parts | Six parts that turn the places every package of D36 would write to into places where things are only added: a registry of queries with one general MCP tool `query`, a module per feature type, panels and forms of the app as modules, a shared vocabulary, documents by area, working in several trees. No change of behaviour. The design with its reviews is the record of the decision |
| D38 | [1a Section](d36/1a-section/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-15 (the query `section` and the section view of the app) | A plane gives, per body, closed loops with areas and the face each segment lies on; the app shows the model cut |
| D39 | [1b Measuring](d36/1b-measure/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-15 (the query `measure`, the pieces the other queries share, and the generic form of a query in the app) | Distance and angle between two named entities, exact for planes and cylinders; the generic form of a query in the app |
| D40 | [1c Smallest gap](d36/1c-gap/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-15 (the query `gap` and the gap view of the app) | The smallest gap between bodies within a search distance, from the pass over the meshes of D39 with `interference` for the kind of a zero and for a body inside another. The kernel port does not get `minGap`: the owner decided so on 2026-11-15 and the measurement showed the variant without it to be as fast |
| D41 | [1d Mass properties](d36/1d-mass/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-15 (the query `mass`, reached in the app through the generic form of a query) | Mass, centre of mass and inertia from the mesh; the density is an argument until 3a |
| D42 | [1e Print queries](d36/1e-print/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-15 (the query `print` and its view in the app) | Per body and orientation: bounds against the bed, height, contact area, overhangs by named face |
| D43 | [1f View image](d36/1f-image/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-15 (the tool `view_image`, the picture drawn by the app, the button that saves one) | A picture of the view for the AI, made by the connected app as an operation of the app |
| D44 | [2a Profile offset and a wall](d36/2a-offset/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-15 (the optional field `profile/offset`, the profile source `wall` with the face roles `wallSide` and `wallEnd`, the form of the app). Owner, 2026-11-15: an offset that makes a curve vanish stays an error with a message that says what to do; dropping corner arcs is in the backlog | An optional offset of a profile with mitre joins, and a wall of a given thickness from open curves |
| D45 | [2b Taper](d36/2b-taper/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-16 (the optional field `extent/taper`, the stack of rings, cones and the circles between surfaces, the upgrade step `2b-taper` and the schema version 4) | An optional taper of an extrusion by a distance: a stack of sections, cones for circles |
| D46 | [2c Hole and hardware catalogs](d36/2c-hole/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-16 (the feature type `hole` with four shapes and the roles `holeBore`, `holeHead`, `holeFlat`, `holeSeat`, `invalidHole`, the stack of sections with a planar step, the mark `refuseChange` of a built tool, five hardware catalogs from ISO 273, 4762, 10642, 4032 and typical values for inserts, the query `hardwareHole`, the form of the app). Owner, 2026-11-15: the inserts are unbranded, so their catalog has a row per size as sold; the catalogs cover M2 to M4. Owner, 2026-11-16: the notation of an insert is to be looked up (it is thread × length × outer diameter), about 20 sizes sold between M3x3x4.5 and M4x3x6 go into the catalog, and the hole follows published recommendations (outer diameter − 0.3 mm, length + 1 mm), as typical values to try in a test print. Open for the owner: M4x3x6 is not sold; the owner could not measure his M4 insert and closed the question on 2026-11-16, so the catalog keeps M4x4x6 and M4x3x5. Owner, 2026-11-26: the catalogs go up to M8 (M5, M6 and M8 from the same standards, M7 left out as three of them lack it; inserts M5x6x7, M5x9.5x7, M6x8x8, M6x12x8 and M8x12x10 with a hole 0.7 mm under the outer diameter, as the sources of those sizes recommend) | A feature type `hole` at points of a sketch (plain, counterbore, countersink, nut pocket) and tables of screws, nuts and inserts |
| D47 | [2f Extent up to a face](d36/2f-upto/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-16 (the variant `upTo` with an optional gap, the lengths per vertex and the tilted end cap, `invalidExtent`, `ToolProblem` for a copy, the button *Pick* of the form) | A variant of the extent: up to a plane or a planar face, also a tilted one, with an optional gap |
| D48 | [3a Body properties](d36/3a-body-properties/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-16, schema version 5 (the section with its upgrade step, three commands, the result with inheritance by copies, the registry of sections, the catalog of six materials from data sheets: PA12 has no source by the owner's rule and stays out, decided by the owner 2026-11-16; the mass query, the print export and the print query read the properties; the form of a body in the app) | A section of the document with the material, mass and use of a body, a catalog of materials, and a registry of sections |
| D49 | [5a Mechanism](d36/5a-mechanism/design.md) | designed 2026-11-15 after three rounds of reviews; implemented and merged 2026-11-16, schema version 6 (the section with five commands and its result, the pose of the queries with a pair in the frame of its first body, the query `mechanism`, `geometry: 'modelled'`, the note about the pose of the tools, the panel of the app; see "As implemented" of the design). Owner, 2026-11-16: a coupled motion goes through a parameter; a forest of links, not one root; a missing link is not a broken reference; the model as modelled is the zero of every joint; the axis from a cylindrical face is deferred. Checked against the code of `master` with 3a and against the real kernel on 2026-11-16: the design is ready for the implementation; a pin in its hole across a joint stays a fit, and the kernel refuses such a pair in about one pose of thirty. Owner, 2026-11-16: the way round it that adds to the kernel port is a package of its own after 5a (D50), the repair of the adapter follows it; a picture of a pose that is not written comes with 5b | A section of the document with links, joints and a pose; queries answer for the posed model |
| D50 | [5e A second opinion of the kernel](d36/5e-kernel-second/design.md) | designed 2026-11-16; implemented and merged 2026-11-16 (no schema step; "As implemented" in the design). Owner, 2026-11-16: yes to the addition to the kernel port that the check of 5a proposed, "the intersection as computed, for measuring only", so that the collisions can take a second opinion that may only clear a pair the kernel refuses and never turns it into a collision; it comes as a small package of its own after 5a. The same day: a picture of a pose that is not written (`at` and `after` for the operation of the app `view_image`) comes with 5b, not with 5a. And on the three questions of the design: the repair of the kernel adapter (`clean`, `restoreShifted`) is the next package right after this one; the answer of the collisions gets the field `cleared`; a pair the kernel fails on carries the volume and the depth measured on the mesh as computed, worded as not verified | The kernel port gets `intersectionAsComputed`, a mesh that is measured and is never a body; the query `interference` asks it only about a pair the adapter refused and judges it by the thresholds it has: nothing or a fit clears the pair (listed in `cleared`, apart from the verified `fits`), a collision leaves it in `failed`. Designed after one round of review, with a second, narrow one over its fixes |
| D51 | [5f Repair of the kernel adapter](d36/5f-adapter-repair/design.md) | designed 2026-11-16, implemented and merged 2026-11-16 as designed (the deviations under "As implemented" of the design). Owner, 2026-11-16 (with D50): the repair of the kernel adapter (`clean`, `restoreShifted`) is the next package right after 5e. The cause was established by experiment against the library: for an intersection `restoreShifted` takes no part; the loop of `clean` drops a null triangle and splits its neighbour as two steps, and in a thin quadrilateral with two close vertices (the sheet between flush faces is full of them) the two undo each other, so the loop goes round and stops open ("not a closed surface") or closed with a piece turned over ("a folded triangle"). Measured with a candidate in a copy of the repository: of 183 refused poses of the arm and of flush faces 179 are answered and none wrongly (the pins as fits, flush faces as nothing, 51 of 52 real collisions as collisions); of 1,416 refused cases of a fuzz with an exact volume 1,367; the fuzz of unions and differences (30,000 and 5,000 cases) unchanged, and of the suite only the ten tests of 5e that expect a refusal flip. One choice is the owner's and holds nothing up: the first cleaning stays the first try, so that no answer of today changes and the adapter answers what either cleaning verifies, although the second alone answers nearly the same (it refuses two of 8,583 fuzz cases the first answers) and would make the adapter simpler and faster | The adapter gets a second cleaning beside the one it has: the same weld and the same rule of a null triangle, but the drop and the split are one operation (the long side is subdivided at the middle vertex in every triangle on it), which keeps the mesh closed at every step, and each such operation is made once at most, so it ends. `boolean` tries it only for an intersection whose first cleaning failed the checks, and holds its mesh to the same checks. A union and a difference never reach it (it may leave thin triangles that guarantee 3 forbids there); an intersection answered today keeps its arrays. The port, the engine and the second opinion of D50 do not change; the second opinion is asked for what both cleanings fail (a few pairs in a hundred of those refused today, and a fold made by the weld itself). Reviewed in the rounds its design records |
| D52 | [2d Re-pointing a point of a curve and the fillet of a sketch corner](d36/2d-sketch-fillet/design.md) | designed 2026-11-16; implemented and merged 2026-11-17 with the recommendations of its open questions (the adapter changed, in a commit of its own; the corner point kept as the virtual corner; see "As implemented" of the design). Checked in a browser on 2026-11-17: two fillets of a rectangle, an extrusion, the radius changed from 10 to 15 and the corner dragged, every feature ok | A command that gives a curve another point and keeps its ID; a sketch tool that fillets the corner of two lines, keeps the corner point as the virtual corner, adds the arc to the regions and walls that passed it and names what else reads the corner; the solver adapter gives a tangency of a line and an arc at a common end as a square radius |
| D53 | [2e Linear pattern and mirror](d36/2e-pattern-mirror/design.md) | designed 2026-11-16; implemented and merged 2026-11-16, no grid (see "As implemented" of the design). Measured with a prototype against the real adapters: every tool built in a mirrored frame faces inwards and the kernel refuses it, so `applyTool` turns it over, once for every build; a mirrored copy is the mirror image to the precision of the meshes; `master` refuses a document with either new kind, so no schema step. Owner, 2026-11-17: the grid is wanted, as an addition to 2e; the grid designed 2026-11-17 as an addition ([grid.md](d36/2e-pattern-mirror/grid.md)): a second direction of the linear pattern (`transform.second`) for features and a body, the copy (i, j) numbered `i + 1000 · j`, at most 200 places and none twice (`invalidPattern`), no schema step; implemented and merged 2026-11-17 with the defaults of its questions (stride 1000, at most 200 places) | Two more kinds of the transform of the pattern feature: `linear` (copies shifted along the direction of an axis, by a spacing or over a length) and `mirror` (one copy, the image in a plane), for a list of features and for a body. Copy IDs, face names, body properties and links are those of every pattern, but that a mirror has the one copy `<pattern>/1` and a command cannot bring in another as a body. A face name of a mirrored copy says which face it is the image of; a sketch on it has a right-handed frame of its own. A grid is deferred, with two routes named (a pattern of features as a source of a pattern; a second direction with copy numbers that do not depend on the counts) |
| D54 | [2g Export: 3MF, DXF, SVG](d36/2g-export/design.md) | designed 2026-11-16; implemented and merged 2026-11-16 with the defaults of its open questions (an uncompressed 3MF, a face as the plane cuts just under it, the corners of the mesh; see "As implemented" of the design). Owner, 2026-11-17: the 3MF is to be compressed, with an existing library that the session chooses (approved under D2 once it is named). Designed on 2026-11-17 as an addition ([deflate.md](d36/2g-export/deflate.md)): the port `Deflater` and the adapter `packages/deflate-pako` over `pako` 2.1.0 (approved, D2; the design proposed 3.0.3); the ZIP of a set the app saves stays stored; implemented and merged 2026-11-17 | Three export formats in the catalog of D37, without a library: `3mf` (the bodies as named objects with their display colours, in a ZIP the engine writes, its parts deflated by the compressor the engine was given (the port `Deflater`; the adapter `packages/deflate-pako` over `pako` 2.1.0), about a fifth of the size of the STL, and stored when it was given none) and the outline a plane cuts out of bodies as `dxf` (release 12: circles and closed polylines with bulges) and `svg` (millimetres); the app gets a generic export form |
| D55 | [3b Import of a mesh as a reference body](d36/3b-mesh-import/design.md) | designed 2026-11-17. Owner, 2026-11-17: the recommendations of the design are agreed: the mesh inside the document; no feature changes an imported body in this package; 3MF import waits; the batch that places a mesh makes it a reference part; 100 000 triangles with a note above 20 000; repair beyond the walls and turning shells over deferred; implemented and merged 2026-11-17, schema version 7 | A binary or ASCII STL file is read into a closed mesh and stored inside the document (the section `meshes`); a feature type `mesh` places it as a body with one face by a frame, three offsets and three turns; the body serves the view, the collisions, the gap, the mass and the exports, and no feature changes it. A stored mesh is checked as the kernel adapter checks a solid, and further: every shell is thicker than a millionth of its size, and a shell that faces inwards is a hollow of a solid (the winding of the other shells, pruned by their bounds, bounded in work). The importer leaves out the wall between solids stacked on one outline, guarded so that it joins only two solids that face outwards, and turns over shells written inside out, by groups from the outermost; nothing else is repaired. Measured against the real kernel: flush tools leave sheets on a turned imported body, a shell inside out beside a solid hides a collision, overlapping shells are counted twice, and a real collision with a large mesh takes from seconds to a minute by its depth (3 to 19 s at 38 000 triangles), which the limit of 100 000 triangles (provisional, for imports; a load has a ceiling that is never lowered) does not prevent; 18 of 23 real files of two robot arms read, 5 are not closed and are refused |
| D56 | [3d Boolean of bodies, subtraction with a clearance, split by a plane](d36/3d-body-boolean/design.md) | designed 2026-11-17. Measured against the real adapter and library: a split as two differences with a box (906 planes, none refused); a union of two bodies that share face numbers comes out wrong unless the tool gets numbers of its own, and with them still in a few per cent of hard cases, which checks of the volume and of sheets turn into a refusal; the clearance by faces against the sum of Minkowski (milliseconds and exact faces against 4 to 17 s and one face without a description); revised after its verification and implemented, merged 2026-11-17 (a carried face with no extent exempt, turned edges collapsed, a stricter sheet test; refusals of right pin unions at a chord tolerance of 0.001 and far from the origin remain a known limit; an imported body neither target nor tool, after 3b) | Two feature types. `combine`: a union, a difference or an intersection of a target body with tool bodies; the target keeps its ID, the tools are used up or kept; a difference may have a clearance, the tool then subtracted with every face moved outwards along its own surface, and the faces of the pocket named after the faces of the tool. `split`: a body by a plane; the body keeps one part and its ID, the other part is a new body, and both get the cut face. The engine checks the result of a boolean of bodies (the volume against the identity with the port's intersection, sheets) and refuses what does not pass. The kernel port gets no member, only the precondition that the operands of a union or a difference share no face number |
| D57 | [3e Parts list](d36/3e-parts-list/design.md) | designed 2026-11-17; implemented and merged 2026-11-17 with the defaults of its questions (CSV per RFC 4180, the clearance hole labelled, the clearance pair a known limit); the count of holes compares only pairs that can lie on one line (see "As implemented") | What to print and what to buy as a query, `partsList`: bodies with the use `part` and `reference` as rows, a body and its copies one row while they are one mesh moved (a body a feature changed after the pattern leaves the row, a mirror image is a row of its own) with the same properties and name, and hardware as the labels of the hole features counted by the holes the model has, by their axes and how far along them they reach (one build is one hole; cuts of one feature on one line whose intervals touch are one hole). The same table as a file by the export format `partsCsv`. `transformSolid` remembers what a solid is a copy of (`shapeOrigin`). Nothing is added to the document |
| D58 | [4a Revolve](d36/4a-revolve/design.md) | designed 2026-11-17. Measured with a prototype of the build against the real adapter: every tool taken as it is (whole and partial turns of both signs, balls, tori, a hollow ring, a body pinched to a point on the axis), a mirrored tool the exact mirror image turned over by `applyTool`; dividing the turn and the profile each for half the chord tolerance keeps a ball within the tolerance (0.0099 of 0.01, against 0.0193 for the whole tolerance each); a tool of 1.7 million triangles takes the kernel 27 s to cut. The circles of surfaces of revolution prototyped: the pairs of today unchanged on 20 000 random pairs; implemented and merged 2026-11-17 with the defaults of its questions (`sketchLine` for every user of an axis; the chord tolerance kept at about twice the triangles); the clearance of 3d moves spheres, tori and the apex of a cone on the axis (reviewed) | A feature type `revolve`: a profile of regions or a wall turned about an axis that lies in the plane of its sketch, a whole turn or an angle from a start, as a new body, an addition or a cut, repeated by a pattern; its faces are named as those of an extrusion of the profile (no new role). The axis is an `AxisRef`, which gets the kind `sketchLine` (a line of a sketch) for every user of an axis. Faces of revolved arcs are spheres and tori, and two surfaces of revolution meet in circles that the edge's points choose among, so the edges of a turned part project and measure. The error `invalidAxis` for an axis outside the plane, a profile on both sides of it, and a line without length |
| D59 | [5b Export of URDF and MJCF](d36/5b-robot-export/design.md) | designed 2026-11-17; implemented and merged 2026-11-17 with the defaults of its questions (drive fields in N·mm, rad/s and g·mm²; URDF refuses a moving joint without effort and velocity; collision meshes on, the joint pairs excluded); checked in MuJoCo 4.0.1, urdf_parser_py, yourdfpy and PyBullet 3.2.7 | Two export formats over one common part: the mechanism as modelled, one tree from one root, link frames at the joint axes with the axes of the model, masses and full tensors from the query `mass`, an STL per body in metres in one folder; MJCF also motors, armature, excluded pairs and the pose as a keyframe. The drive of a joint as four optional fields that block no pose; no upgrade step. `at` and `after` for the operations of the app. [d36/5b-robot-export/design.md](d36/5b-robot-export/design.md) |
| D60 | [5c A tilted plane and the midplane of two planes](d36/5c-more-planes/design.md) | designed 2026-11-17; implemented and merged 2026-11-17 with the defaults of its questions, schema version 8 (the `sketchLine` axis and `invalidAxis` taken over from 4a; the `face` axis also on tori) | Two optional fields of the plane feature composed in a fixed order (base, midplane, tilt, offset); the tilted plane contains its axis and the axis must be parallel to the plane it tilts; the midplane is the bisector nearer to the base; `sketchLine` and `face` are kinds of `AxisRef` for every consumer; an upgrade step that converts nothing. Rejected: a variant of the plane feature, new kinds of `PlaneRef`, new feature types, a line reference only for the tilt. A plane through three points deferred. [d36/5c-more-planes/design.md](d36/5c-more-planes/design.md) |
| D61 | [5d Generators: the cycloidal disc, the GT2 pulley, the profile shift](d36/5d-generators/design.md) | designed 2026-11-17; implemented and merged 2026-11-17 with the defaults of its questions (the FreeCAD arc construction of the GT2 groove, stated as unsourced; a shifted centre distance deferred); `shift` is optional and stored only when given, so an older build keeps reading every document without it | Two entries of the generator catalog (the disc with an input angle and an angle of its pins) and one parameter of the gear, every formula from a named source and checked by an independent computation; polygons that lie inside the exact outline (a disc never enters its pins, a pulley never its belt); gears in mesh keep the reference centre distance, so their shifts must balance. Rejected: the shift in mm, the disc always at the input angle 0, the pulley over a circle, the belt tooth subtracted from a disc. Deferred: a shifted centre distance, the holes of the disc, other belts. [d36/5d-generators/design.md](d36/5d-generators/design.md) |
| D62 | [3c Inserting another document as a part](d36/3c-document-insert/design.md) | designed 2026-11-17. Owner, 2026-11-17: all five recommendations agreed: a copy inside the host changed only by `replaceDocument`; recomputed from its features; the parts list one row per body (insertions with equal parameter values joined); host features may change an inserted body (bodies with an imported mesh refused); documents inside documents up to 8 levels; implemented and merged 2026-11-17, schema version 9 (an edge of a chamfer or a fillet found by its key is compared with the name asked for) | Another document is stored inside the host as a copy (the section `documents`; validated by `validateDocument`, so every upgrade step reaches it) and inserted by a feature `insert` that recomputes it by the same evaluator with the host's chord tolerance, with values for some of its parameters (references of their own, merged key by key), and places its bodies by 3b's placement. The bodies are `<insertion>/<ID there>`, every face keeps its name with the feature IDs prefixed (its key quotes the inner key, since IDs may hold `@` and `:`), and a reference to such a face checks that the owner of the prefix is an insertion, as a body ID is decomposed; so sketches, projections, seats and features use an inserted part like a modelled one. Body properties come from what the inserted document states (before its use is applied) unless the host sets them; the parts list counts inserted holes, and two insertions with the same environment of parameters share one recompute through the state of the recompute and are one row. Rejected: a path to the file, freezing as meshes or with face tables, a tag beside the name, flattening the timeline. Measured: a document of a part is 1 to 8 KB, its recompute milliseconds to 160 ms and nothing while the evaluator remembers it; a seat cut from the projected edge of a turned part meets it as a fit |
| D63 | [4b Chamfer and fillet of edges](d36/4b-edge-chamfer-fillet/design.md) | designed 2026-11-17. Spike against the real adapter: a tool lying on the faces works on planes and fails on round faces (its polygon left on the body's); reaching past the faces, with the ends of the blend exactly on round faces, 7.5 % of 3 600 random edges were refused; lifted off round faces by 1.5 × the chord tolerance (not off planes), none of 7 192; tools united or applied one by one give the same volumes; three chamfers at a corner are exact, three fillets leave a crease 0.225 r proud of a ball; implemented and merged 2026-11-17 with the defaults of its questions (a crease at three fillets; half a smooth chain refused; faces by the index of the edge); the lift at least 2 bands of the kernel and every vertex of a blend checked against its surface; three concave edges at a corner and about 1.5 % of features far from the origin end in kernelFailure (known limits) | Two feature types, `chamfer` and `fillet`, on the edges of one body: straight edges between planes and circular edges between a plane, a cylinder and a cone about one axis, convex (cut) and concave (added). A tool per piece of an edge, a prism or 4a's revolve, that reaches past both faces and ends in the planes of the faces at its ends; what it leaves there becomes those faces. One new face per edge, named by its place in the list. A smooth chain goes into one feature; the error names what is missing. The errors `unsupportedEdge` and `blendDoesNotFit` |
| D64 | [6a Preparatory part and shared vocabulary of step 6](d36/6a-sketch-prep/design.md) | designed 2026-11-17; implemented and merged 2026-11-17 with the recommendation of its question (derived geometry a kind of entry of `external`), which the owner confirmed on 2026-11-24. Reviewed with the whole step on 2026-11-23 ([d36/6-cross-review.md](d36/6-cross-review.md)): the vocabulary is amended by later packages, listed with the package that makes each change in "Amendments after the review of step 6" of the design. Known limits from that review: the mechanisms of a derived kind are slots in the contract, written by 6c; a reader of a loop without exact curves is not reached by the exhaustive switches; a fix of the findings on the implementation is a point of its own | A registry of the kinds of entries of `external` (the projection of an edge its one entry); the profile from a list of curves with a region flag and joins declared by entries; exhaustive switches on the kind of a curve; the app's sketch tools as a table; the result carries the curves that are not own. Derived IDs `<owner>/<local>`; copies `<owner>/<copy>/<source>`; axes `origin/x`, `origin/y` in the solver only when constrained; joins by declared pairs and join keys (amended 2026-11-24: the ends of copies join by position, D68; the keys stay for projections from another sketch, D69); regions by the owner's answer to question 4 (amended 2026-11-24: an imported outline by a flag, default true); the axes are written by a point of their own, 6a2, before 6c; derived geometry is a kind of entry of `external`, not a second map |
| D65 | [6e Trim, extend and split](d36/6e-trim-extend-split/design.md) | designed 2026-11-17, revised 2026-11-24; implemented, reviewed in three rounds (engine and app reviews: points cut in memory, an extend crossing a circle once, touches of round curves, wall-end blend edges fixed) and merged 2026-11-25 | Crossing curves are repaired by three sketch tools, not by regions made automatically: trim, extend and split cut curves at the points where they meet, cut the other curve there too, keep the constraints with the piece they describe, and follow the regions of the features to the regions that hold a face of the cut sketch lying inside the region as it was; a touch is cut only where a tangency holds it, the repair of the other crossings runs where a feature reads regions of the sketch, the edges of chamfers and fillets follow the pieces, and the places where curves meet are a query |
| D66 | [2h The start of an extent at a face or a plane](d36/2h-extent-start/design.md) | designed 2026-11-17 at the owner's request after the conversion of an actuator from Onshape (31 of about 60 extrusions start at a face, all parallel to their sketch); two rounds of review; implemented and merged 2026-11-17, schema version 10; the converter writes all 31 starts as `from` with the volumes unchanged | The optional field `from` (a `PlaneRef`: a base plane, a plane feature or a planar face) on every extent of the extrusion and the hole; `start` is still measured along the sketch normal, now from that plane; the plane must be parallel to the sketch over the exact outline (within 1e-6 mm), a tilted one is `invalidExtent`; "through all" from a plane goes one way; a copy of a pattern carries its start (the end of `upTo` stays the plane the feature saw); `facts.startLevel`. No new type, role, code or command; schema step `2h-extent-start` converting nothing |
| D67 | [4c Chamfers and fillets of edges that run out into round faces](d36/4c-blend-round-ends/design.md) | designed 2026-11-17 from the conversion of an actuator from Onshape (4 of 10 chamfers, no fillet), cut to the run-out after the first round of reviews; the void check and the exact side added after the second. Spike: every accepted run-out at a cylinder (inside or outside, any axis for a straight edge) or a keyway's plane equal to the blend made before the void (the housing's rim, holes through edges at 10.5° to 90°, a rib's foot into a boss, a boss's foot into another, a shaft's slot through its cylinder, a hole broken out through a disc, random cases); pins, posts and shallow pockets within a run-out refused by the void check, which found 0 in every accepted case; read at the mesh vertex a crossing of 12° looked like 8°; implemented 2026-11-17, reviewed (one blocker: the void check saw nothing beyond the outside of a large cylinder, fixed with regressions and fuzz cases outside cylinders) and merged 2026-11-24 | An edge of D63 may run out into a cylinder or (an arc) a plane off its axis it crosses at 10° or more, into what the tool does not change beyond it; the tool runs on until its corner has crossed it, the reach solved exactly, and the part past the end may take or add nothing beyond the face. Stops, bridges and two faces at an end refused with advice; straight edges with round faces and two lines of one name deferred. No new type, role, code, field or schema step |
| D68 | [6c Mirror and pattern in a sketch](d36/6c-sketch-mirror-pattern/design.md) | designed 2026-11-17; revised 2026-11-24 after an independent review and the owner's answers 12 to 17, and after the second round and the answers 19, 27 and 28 ([d36/6-cross-review.md](d36/6-cross-review.md)); implemented, reviewed in two rounds (engine and app reviews: a cut-off source point whose copy a feature names is kept and joins the entry, the edges of chamfers and fillets on copies above the count rewritten by names, an extend onto a copy refused with the copy's reason, a full turn over a parameter kept as an angle) and merged 2026-11-25 | Mirror and pattern in a sketch are derived geometry: one kind of entry of `external`, `pattern`, with D53's transforms (mirror, linear with a grid, circular) and numeric fields that take expressions; copies `<entry>/<copy>/<source>` of own curves and points computed after the solver in a record of their own (never in the solver's input, the stamp or the stored values), forming regions as their source, never constrained in their own sketch, their ends joined by position to the curve ends at their place without welding own vertices and without carrying the source's coincidences, in one stage inside 6e's `sketchWorld` that also joins flagged reference curves (no join keys); open ends named in the result; a sketch tool that changes a source patches the entries that list it (the pieces; a curve between two open ends of the listed curves); a broad phase of bounding boxes in the profile; a lower count leaves broken references, a higher one keeps every name; no schema step |
| D69 | [6b Projection from another sketch](d36/6b-sketch-projection/design.md) | designed 2026-11-17; reviewed independently and revised 2026-11-24 with the owner's answers 19 to 22, reviewed in a second round and fixed the same day (answers 29 and 30); the axes of the origin, once part of it, are D71; implemented, reviewed in three rounds (engine and app reviews: an own outline drawn in two runs closes on the own points already there, an own curve over a flagged projection taken over by `projectSketch` with `entities` and the features that read it renamed in the same batch, a repair that keeps the flag, a frozen arc stable to the bit; an `updateExternal` that keeps its source checks nothing, which amends D53) and merged 2026-11-25 | A projection from another sketch is a reference kind of entry of `external`, `sketch`, one entity per entry with its `kind` stored, from an earlier sketch on a parallel plane; the map between the two planes is a rigid motion (projected point by point, a tilt inside the tolerance opened an outline); it follows the source and freezes when the source is gone; projected arcs are made exact; a flag `regions`, always stored, lets a projected curve form regions, and the ends of such curves join by position in one stage with the copies of 6c (join keys rejected: three ordinary cases stayed invalid and profiles in memory did not see them); a sketch tool projects a whole sketch with each curve in the role it has in its source, or draws an own outline, one curve per place, held on the projections by a radius line (`equalRadius` rejected: a second solution that an ordinary change of a parameter reaches, and none at a half turn); a query says what a sketch can project; no schema step |
| D70 | [6d Splines, the cheap variant](d36/6d-sketch-spline/design.md) | designed 2026-11-17; revised 2026-11-24 after an independent review and the owner's answers 22 to 26, 32 and 34 ([d36/6-cross-review.md](d36/6-cross-review.md)), and fixed after a second round of reviews and a light read; implemented, reviewed (a full review of the engine and the adapter, a light one of MCP, the app and the scenario: a long polyline that overflowed the stack, the text of an extend across a spline, the ends of a spline at a flagged projection listed as an arc's, the pieces of two splines compared by a sweep) and merged 2026-11-25 | A spline is a curve over 3 to 64 own control points, a clamped uniform non-rational B-spline of degree min(3, n − 1), closed by repeating its first point; the solver sees only the points and no constraint takes a spline (tangency at an end by its end leg); the profile uses its polyline within the chord tolerance; one swept side face with edges of the kind `other`, so no chamfer or fillet of the rim of a part with a spline; offset, taper, revolve and wall refused; not trimmed, split, extended or projected; `get_sketch` says where the curve runs; no schema step |
| D71 | [6a2 The axes of the origin](d36/6a2-origin-axes/design.md) | designed 2026-11-17 inside 6b's design (D69), a point and a text of its own since 2026-11-24 (owner, answer 31), reviewed in a second round the same day; implemented, reviewed (no blocker; the app's offers for fixed operands, two texts and a label fixed) and merged 2026-11-24 | `origin/x` and `origin/y` are lines of every sketch, in the solver only when a constraint names one, so no stored sketch is solved again; they are not in the result of a sketch (a curve there would name a hidden point), and every reader without a recompute takes them from one function, `solvedCurves`; an axis has no length and no middle, and a reader that clamps a line to its ends takes the ends of an axis from one helper, `lineExtent`; no schema step |
| D72 | [6f Import of an outline](d36/6f-outline-import/design.md) | designed 2026-11-25; reviewed in three rounds and revised after each the same day, with the owner's answers 37 and 38 ([d36/6-cross-review.md](d36/6-cross-review.md)); implemented, reviewed in two rounds (the kind and the solver, the import and its readers, MCP and the app: numbers out of range refused by the readers and the validator, deep SVG groups and slow patterns made linear, the tangency at a joined end read by one function in the analysis and the solver adapter, the box of an outline from its placed curves) and merged 2026-11-25 | An imported outline is a reference kind of entry of `external`, `outline`: the curves of a DXF or SVG file (lines, arcs, circles, splines) stored in the entry in the file's coordinates and placed by three numeric fields and an anchor; fixed for the solver, which gets only the entities constraints name; entities `<entry>/<local>` with points named by their curve, IDs by kind and order of the file; regions by a flag, default true, ends joined by position; a revised file is an update of the entry, refused while a constraint names an entity it drops; hand-written readers in a second catalog of formats with a bounded weld (0.01 mm: an open end onto one other end, never further), limits and a report, a file that is not whole refused; the options of the import stored in the entry; the MCP tool `import_outline` sends the command; no schema step. Alternatives: a section of the document, own geometry tied by `fixed`, IDs from geometry, the whole outline in the solver, a transitive weld |
| D73 | [MCP and API ergonomics](#d73-mcp-and-api-ergonomics) | decided 2026-11-25 from the friction of a session that built a flange and a planetary gearbox through MCP; implemented and merged 2026-11-25, after two rounds of review | describe_api in sections with lookups; defaults of a new feature in addFeature, a key the type does not know refused; the rectangle by its centre and with its sizes, IDs in the order of the result, the fillet of several corners; `after` for check_interference, mass of all bodies, the arguments there are; English texts of the server; the reason a bridge cannot listen and another try only when asked; `new_document`; model colours in view_image; some features of get_model and the facts of the features whose result a command changed |
| D74 | [The selection of the app for the AI](#d74-the-selection-of-the-app-for-the-ai) | decided 2026-11-26 with the owner; implemented and merged 2026-11-26, after two rounds of review | An operation of the app, `get_selection`, answers with what the user selected and clicked in the app, in the shapes commands take: the mode, the feature selected on the timeline, the pick in the view, the selected entities of a sketch with their kind and source, the last click and the pointer while it is over the view (the point in mm, what was hit by its stable name, the normal of a face, in a sketch its coordinates and the nearest entity, the pose); the last click is marked in the view; the operation declares that it takes no state path, so `at` and `after` are not in its schema and are refused; nothing stored, no schema step |
| D75 | [Constraints of two points, distances of two lines and of a line and a circle](#d75-constraints-of-two-points-distances-of-two-lines-and-of-a-line-and-a-circle) | decided and implemented 2026-11-27 (two rows of the backlog, from the conversion of 6h), after two rounds of review | Five kinds in the catalog of constraints: `horizontalPoints` and `verticalPoints` (two points level or plumb, with no line between them), `midpointPoints` (a point halfway between two points), the dimension `distanceLineLine` (two lines held parallel at a distance: two equations, so a `parallel` beside it is redundant; 0 puts them on one line) and the dimension `distanceLineCircle` (the positive gap between a line and the rim of a circle or of the circle of an arc, on the side of the centre; touching is `tangent`). Entries of the catalog with their equations and translations; the app offers the distance for two parallel lines in place of the angle, and the gap for a line with a circle; no schema step |
| D76 | [7a Threads](d36/7a-thread/design.md) | designed 2026-11-26; revised after three rounds of reviews (Fable, codex, agy; the third by Fable and Opus), 2026-11-27; the questions 43 to 58 decided by the owner on 2026-11-27 (every recommendation accepted, with four changes); stage 1 (the cosmetic thread) implemented on the branch `d36/7a` on 2026-11-27, not yet reviewed or merged ("As implemented" of the design); the point between the stages and stage 2 not implemented. The number was D75 until master took it on 2026-11-27. The owner's decisions of 2026-11-26 (a feature on a cylindrical face, one feature with a flag `modelled`, a catalog of ISO metric threads, printed threads of M10 and up to work modelled) and a spike of the same day on the real kernel adapter ([d36/7a-thread/spike.md](d36/7a-thread/spike.md)): the sweep of the axial profile, not the layered twisted extrusion; no end of the tool in a face of the body; a clearance of at least the chord tolerance. The first revision (2026-11-27, measured in L to P of the spike's record): the clearance as a radial shift, a ring as the tool of a bore, the datum of a copy carried by its pattern, the ends read in both modes. The second (the same day, Q to S): the zone of the collisions as a cut of the body with the thread, the end of a wall read from the surface of the face across its rim, the phase of a mate that runs the other way. The third round, on the diff alone, found the design ready for stage 1 once three points of the text were corrected, which they are (the ring of a zone grown by the lift at every end, a piece judged above a fixed volume, two threads about one axis only when their zones overlap in their radii), and a second opinion two more (two threads that meet off one line do not agree, the run-out of a rim that is partly open); what is still open is in the known limits of the design. Decided by the owner (2026-11-27), beyond the recommendations: a pattern that mirrors a body warns of the threads whose hand it turned (`mirroredThread`); two modelled threads that agree and collide get the phase that seats them in the entry of the pair (stage 2); the note of an export and of the print check about cosmetic threads, and the threads in the rows of the parts list, are a point of their own between the two stages; a hole whose bore carries a thread is not among the `unlabelled` holes of the parts list. Candidates for the backlog: a flag that threads every bore of a hole, a catalog of pipe threads G | A feature type `thread` on cylindrical faces of one body (`body`, `faces`, optionally the copies of those faces a pattern made): the bore or the pin is read from the body, the profile is numbers (`diameter`, `pitch`, a flank angle of 60° and the ISO depth unless given, `clearance`, `starts`, `hand`), placed by `direction`, `offset`, `length` and `phase`. The clearance is radial: the thread of a diameter smaller or larger by twice it, cut into the wall as made, refused when no crest is left. Cosmetic: the mesh stays, the evaluation records the thread with the hand it has where it lies (`Evaluation.threads`, `get_model`, `get_body`, a helix line in the view), and the check of collisions lists a screw in such a bore under `threaded`: the body with the thread is cut by the ring of the zone of the thread, what the other body shares with the part in the zone is excused when it goes around the axis, and the rest is judged as every pair; the smallest gap gains the contact `threaded`. Modelled: one swept tool for all faces (a ring in a bore) and one boolean, the selected face kept as the crest, an open end run past through its chamfer and a shoulder stopped short of (read from the mesh in both modes), the faces `threadFlank`, `threadRoot`, `threadEnd`. A mirrored copy of a face keeps the stated hand, a mirrored body has the other. The catalog `metricThreads` (ISO 262's selection M2 to M64 with the diameters of ISO 724 and the tap drills of ISO 2306, two sources per number); a tapped hole is a hole and a thread, composed by `hardwareHole` with the use `tapped`. The error `invalidThread` and the warnings `noCopies` and `mirroredThread`; two stages with a point between them; no schema step |

D1–D28 are approved (D10–D28 on 2026-11-13). D29, D30 and D31 came out of autonomous work on the implementation and wait for confirmation. D32 to D35 were approved on 2026-11-14. D36 was approved on 2026-11-14 as well, and the scope of D37 with it. D38 to D51 are the designs of the packages of D36, written by the sessions of tracks A, B, E and H; what in them waits for the owner is listed in [d36/cross-review.md](d36/cross-review.md), and for D50 and D51, which were written after that review, under "Open" of their designs. The decisions of step 6 (D64, D65, D68, D69 and D70) were read together in [d36/6-cross-review.md](d36/6-cross-review.md) on 2026-11-23; the owner answered its questions and those of the single reviews on 2026-11-24, and the answers are in that file, "Decisions of the owner" and "Later answers" (D71 and D72 were designed later and are answered there too). Of step 6, D64, D71, D65, D68, D69, D70 and D72 are implemented and merged (2026-11-25), and with 6h (the Onshape converter on the tools of the step, which takes no decision; its record is [onshape-import.md](onshape-import.md)) step 6 is complete. D73 came from a session that built parts through MCP and is in full below; it is implemented and merged (2026-11-25). D76 is the design of the first package of step 7 (7a, threads): the owner answered its questions 43 to 58 on 2026-11-27, the answers are in "Open" of the design; its stage 1 (the cosmetic thread) is implemented on the branch `d36/7a`, not yet merged, and the rest is not implemented yet. The details are in [architecture.md](architecture.md) and in the files of `architecture/`, the UI design in [ui.md](ui.md) and `ui/`.

## D1 Engine language: TypeScript

Decided 2026-11-12. The engine runs in the browser and in Node. Computationally heavy parts may be WASM libraries (see D2).

## D2 Third-party libraries

Decided 2026-11-12. Using libraries is fine, but the owner approves each one explicitly. Every library is hidden behind a narrow interface defined in the engine, so that it can be replaced and a test implementation can be written.

Approved: planegcs (D6), Manifold (D8), `@modelcontextprotocol/sdk` for the MCP server (D33, approved 2026-11-14).

Approved on 2026-11-15: a DOM for the tests of the app in Vitest, `happy-dom` or `jsdom`, one of the two, as a development dependency of `packages/app`. It lets the class `App` and its panels be tested without a browser (part 3 of the preparatory step of D36, [d36/00-prep/part3-app-panels.md](d36/00-prep/part3-app-panels.md)). Which of the two is taken is decided by the first test written with it and recorded here. Only tests import it and nothing of it is shipped, so it has no interface of its own.

Taken on 2026-11-15: `happy-dom` 21.0.4. The first test (`packages/app/test/app.test.ts`) needs pointer events with capture, keyboard events, handlers set as properties (`onclick`, `oninput`, `onchange`) and the form controls of the app; all of them work in it, so `jsdom` was not tried. The test makes the window itself (`new Window()`) and does not use the test environment of Vitest, because the WASM adapters have to load as in Node before a `window` exists.

Approved on 2026-11-17: a library that compresses the parts of a 3MF package, chosen by the session (owner: "use a compressed one, choose and use an existing library"; D54, [d36/2g-export/deflate.md](d36/2g-export/deflate.md)). Taken: `pako` 2.1.0 (`github.com/nodeca/pako`, November 2022; licences MIT and Zlib; no dependencies), a port of zlib's deflate, through its entry for deflate alone, with its default options at level 6. The design measured 3.0.3 and proposed it; 2.1.0 was taken instead because it gives the same streams (those of zlib, byte for byte, measured by the design) and has been in wide use for four years (about 18 million downloads a week, against half a million for 3.0.3, released three weeks before). It has no types of its own: the adapter declares the one function it calls, so no second package is added. It sits behind the port `Deflater` of the engine (`deflate(bytes)`: a raw DEFLATE stream) and is imported by the adapter package `packages/deflate-pako` alone; the engine has no dependency and works without a compressor (its files are then stored).

## D3 Document model: a log of operations

Decided 2026-11-10. The document is an ordered list of operations. An operation stores the intent: the type, the parameters and references to entities created by earlier operations. The resulting geometry is not stored; it comes from replaying the log.

Consequences:
- Editing an operation in the middle of the log = changing a parameter and replaying from it onwards.
- Undo/redo and serialisation work with the log, not with the geometry.

## D4 References to geometry: IDs derived from origin

Decided 2026-11-12. Operations refer to entities by ID. An ID is not derived from the order of creation (that shifts when an earlier operation changes and the reference would silently point elsewhere) but from the origin of the entity. Examples:

- "the side face of extrude E3 made from line L12 of sketch S1",
- "the top cap of extrude E3".

Rules:
- Sketch entities have permanent IDs of their own, assigned when they are created.
- Faces of bodies inherit their name from the operation and from the source entity of the sketch.
- In a boolean operation the names are carried over by which input face the resulting triangle comes from (see D8, tracking of origin).
- When a reference cannot be evaluated (the entity is gone), the operation is marked as failed and the user repairs the reference by hand. Silent redirection is not allowed.
- A split face is not an error; it stays one logical face (D13).

The scheme of names is in architecture.md, section Naming.

## D5 Sketches: a constraint solver from the start

Decided 2026-11-12. The geometry of a sketch is not the result of one-way constructions but the solution of a system of constraints and dimensions. The alternative considered (one-way construction operations, a solver later) was rejected.

## D6 Constraint solver: planegcs

Decided 2026-11-13. `@salusoft89/planegcs` is used, a WASM port of the 2D solver of FreeCAD, hidden behind an interface of the engine (entities, constraints, result, diagnostics).

Why:
- The solver has been proven in FreeCAD for years.
- It has what is the most laborious part of a solver of one's own: diagnostics of under- and overconstrained sketches and temporary constraints for dragging with the mouse. By the spike it does not handle reference dimensions reliably; the engine computes them (D17).
- It has TypeScript types.
- The main risk of the PoC is the history and naming, not the solver.

Risks:
- The licence is LGPL-2.1. A separate WASM module is usually compatible with it; for a closed product it needs a legal check.
- The wrapper is a small project with low adoption.
- WASM memory is freed by hand.
- B-splines are not finished (does not concern the PoC).

Checked by a spike on 2026-11-13; the results are in architecture.md.

Alternatives considered:

| Library | Why not |
|---|---|
| ezpz (KittyCAD, Rust, MIT) | Young, no ready npm package, unverified diagnostics. The fallback choice if LGPL were a problem. |
| SolveSpace `slvs` (C++ → WASM) | GPL-3.0 would extend to the whole project. |
| neoscad/sketch-solver (Rust, MIT/Apache) | A new small project, no ready browser build. |
| A solver of our own in TS | Feasible, but diagnostics and stable dragging are laborious. Possible later behind the same interface; planegcs then serves as a test oracle. |
| jsketcher, protractr, assemble2d, 2d-solver | The solver is not a separate library, or it is an experiment with an incomplete set of constraints. |
| Kiwi.js (Cassowary) | Linear constraints only. |
| D-Cubed DCM, LGS, C3D Solver | Commercial. |

## D7 Representation of bodies: mesh/CSG

Decided 2026-11-13. A body is a closed triangle mesh. B-rep (exact surfaces) is not used.

B-rep was considered at first for an exact STEP export (OpenCascade in WASM). Rejected because of the complexity.

Consequences:
- STEP export is not possible. The output is STL, later also 3MF (D26).
- Circles and arcs are turned into segments in an extrude. The sketch stays exact.
- Fillets and chamfers of edges are difficult; they are outside the PoC.
- A move to B-rep would not be a mere replacement of the adapter. The type of a body would change, and so would the building of an extrude, which the engine does itself (D9). The document model, the names of faces and edges, the references, the recompute and the sketches would stay.

## D8 Mesh/CSG kernel: Manifold

Decided 2026-11-13: Manifold (`manifold-3d`) behind an interface of its own.

The kernel does boolean operations over bodies (union, difference, intersection). The engine needs two guarantees from it:

1. **The output is always a closed body** (manifold). Otherwise further operations in the log fail unpredictably.
2. **Tracking of origin.** For every output triangle one can find out which input face it comes from. Without this, stable naming cannot be done (D4).

Chosen: **Manifold** (`manifold-3d`, C++ → WASM, Apache-2.0).

| Library | Runtime | Licence | Closed output | Tracking of origin | Assessment |
|---|---|---|---|---|---|
| **Manifold** | WASM | Apache-2.0 | Guaranteed | Yes (`originalID`, `faceID` survive booleans) | Chosen |
| three-bvh-csg | JS over three.js | MIT | Not guaranteed (its README itself refers to Manifold) | Only through material groups | Reject: unreliable and depends on the renderer |
| @jscad/modeling | pure JS | MIT | Not guaranteed (BSP algorithm) | No | Reject for booleans |
| trueform | WASM | unverified | Yes by its own benchmark | Unverified | New, little information |
| MeshLib | WASM/JS bindings | commercial terms, unverified | Yes | Unverified | Unsuitable licence for the PoC |
| csgrs | Rust (own WASM build) | MIT | Only in a slower mode | Unverified | Needless extra work |
| OpenCascade | WASM | LGPL | B-rep | Yes | Ruled out by decision D7 |

Why not three.js directly: it is a rendering library. It can extrude a profile into a mesh for display, but it cannot do boolean operations and does not guarantee a closed body. The engine would also depend on the renderer, which breaks basic principle 1.

Risks of Manifold:
- It fails on nearly coincident surfaces (sheets, disconnected bodies). The spike confirmed it; the adapter handles it (D19).
- The input must be a closed body (the engine guarantees this, because it builds the meshes itself).
- Whether `faceID` also survives the built-in extrude was not checked; the engine builds extrudes itself (D9).

## D9 Extrude is built by the engine itself

Decided 2026-11-13. The engine assembles the mesh of an extruded profile in TypeScript and hands it to the kernel finished, with the face IDs. The kernel is used only for booleans.

Why:
- While building the mesh, the engine knows which sketch entity each face comes from and can name it right away (D4).
- All segments of one circle get the same face ID, so a cylindrical surface stays one logical face.
- The kernel interface is narrower (booleans only) and so easier to replace.

It needs triangulation of a 2D profile with holes (the caps). The triangulation of Manifold is used through the kernel interface, with no other library; the spike checked it.

## D10 Timeline and command history

The timeline is the recipe of the model; the command history serves only undo. A sketch is one entry on the timeline and its content is state, not a log.

Why: if every line were a step of the timeline, the timeline would have hundreds of entries and the references between them would become hard to follow. Fusion has the same split. The rejected alternative: a single log of all user actions that would be the recipe and the history at once.

## D11 Immutable document

Every command returns a new document; the unchanged parts are shared.

Why: undo is a stack of documents without inverse operations, the cache of the recompute is memoisation by object identity, and `evaluate` can be a pure function. The rejected alternative: a mutable document with inverse commands and manual invalidation of the cache, which is more prone to errors.

## D12 Solving a sketch (reworked)

How the decision evolved:
1. At first: positions stored in the document, the solver runs only in commands, the recompute does not solve the sketch. Rejected 2026-11-13: a sketch on a face did not see the geometry of the face, so a hole stayed at absolute coordinates when a dimension of the body changed.
2. The sketch is solved at every recompute; the stored positions are an initial guess. This relied on the solver returning a satisfied input unchanged to the bit.
3. D25: the sketch remembers for which projected geometry its positions hold, and on a match it is not solved.
4. D27: the stamp covers all the inputs of the solver (curves, constraints and projected geometry), not only the projected geometry. Solving thus happens in a single place, during the recompute, and the same rule holds for a change of the body and for an edit of the sketch. All solved variables, radii included, are written atomically.

A deliberate consequence: `execute` always computes the whole model in order to write the result.

## D13 Split face

A face that a cut splits into several parts stays one logical face.

Why: the parts lie in one plane, so the split does not matter for a sketch on the face, and the name stays stable. The rejected alternative: treat the split as an ambiguity and break the reference; that would break references in ordinary edits. The caps of one extrude made of several regions behave the same way (D25).

## D14 Sketch plane on a face computed analytically

The plane is computed from the definition of the feature; only the existence of the face and the outward direction are taken from the mesh.

Why: the mesh has float32 precision and its vertices change after booleans; the analytic plane is exact and stable. The condition is that the output of the kernel agrees with the analytic geometry (D19, D27).

## D15 Repository structure

A pnpm workspace with four packages: `engine`, `solver-planegcs`, `kernel-manifold`, `app`. Tests in Vitest.

Why: the separation of the engine from the libraries and the renderer is enforced physically; `engine` has no runtime dependency. The rejected alternative: one package with folders, where only discipline guards the boundaries.

## D16 Sketch anchor

Every sketch has a reserved fixed point `origin`.

Why: without it at least two degrees of freedom always remain and the sketch cannot be fully constrained. The rejected alternative: a general constraint "fix" on any point; it is a possible extension, but the origin is also needed as a common reference point for sketches on faces.

## D17 Form of constraints

Every variant of a constraint has named operands with a fixed meaning. The implicit conditions of an arc are kept by the solver. Reference dimensions are computed by the engine.

Why: a general list `refs` left the meaning to the order and kind of the operands, and the adapter would have to guess which constraint of the library to use. Reference dimensions: the spike showed that planegcs does not handle them reliably.

## D18 Orientation of a plane on a face

The normal always points out of the body; the X axis is computed as Y × N.

Why: a positive distance of an extrude then always means out of the body, regardless of the order of the points of a line or the orientation of a loop. The outward direction is taken from the mesh as the area-weighted sum of normals, because it also depends on the operation (a cut turns the faces of the tool over).

## D19 Coplanar booleans (reworked)

How the decision evolved:
1. At first: the engine shifts the start cap of the tool by `overlap` from the settings of the document.
2. After the spike of Manifold: a proposal to extend the rule to all planar faces of the tool, still in the core.
3. Decided 2026-11-13: the overlap works around a weakness of one particular kernel, so it belongs in its adapter. The port `SolidKernel` got a guarantee of tolerance of coplanar faces. The core builds the tool exactly; `overlap` was removed from the settings of the document.

Reasons for the adapter:
- A B-rep kernel would meet the guarantee by itself; the core would contain code only for Manifold.
- Checking that coplanar faces really overlap needs the mesh anyway.
- The size of the overlap depends on the precision of the kernel, which only the adapter knows.
- The overlap is used only where faces are really flush. An unconditional overlap would lengthen a boss from a sketch on a plane outside the body.

The cost: detection is by a tolerance on the rounded mesh, not exactly from the face names. The spike showed that it is enough. The limits are in architecture.md.

4. Addition 2026-11-13 (D27): the shift alone was not enough. When a face of the tool was flush only in part, its remainder stayed in the result offset by the overlap from the plane the engine computes for it analytically, and a further operation on it failed (a boss on such a face ended up as a separate component). After the boolean the adapter therefore returns the remainders of shifted faces to the original plane and merges coincident vertices. Spike with chained cases: 34 of 34.

5. Addition 2026-11-13 (D28): the fourth review found three cases that the version of point 4 did not handle. All of them were reproduced.
   - The side of a boss flush with the side of the body reached by the overlap below the seating plane after a union. Only the remainder of the shifted face was returned, and in this case it vanished entirely. After the boss was cut off, strips of its sides remained.
   - Flush faces were not shifted in a union, relying on the kernel to join them by itself. With a float32 deviation between them, a strip of the top face with a narrow triangle remained; the planarity test by the triangle normals then marked the top face as non-planar and a further operation on it left a sheet.
   - After a cylindrical cut the ceiling lay off its plane by 2e-4 mm, because the shift of vertices came from the normals of narrow triangles.

   The adapter is therefore built on one rule instead of a list of cases: faces of the tool and of the body in one plane must not merely touch. Before the boolean every such contact (overlap, touching at an edge, a gap of up to two overlaps) is turned into a penetration; after it everything that moved with the shifted face is returned, and the mesh is cleaned. Planarity is determined by the distance of the vertices from the fitted plane. The details are in architecture.md. Spike: 46 of 46.

   Considered and rejected: aligning the flush face of the tool into the plane of the body's face and leaving the joining to the kernel. It worked only sometimes; whether the sides in a tilted position really were adjacent depended on rounding.

   The cost: the adapter has about 300 lines and contains its own mesh cleaning. Where a face of the tool is flush with a face of the body and they overlap in area, the overlapped part carries the name of the tool's face.

6. Addition 2026-11-14 (D29): random tests found further defects that the fixed cases did not catch. Since then the return of faces is computed exactly from the original geometry, the mesh is cleaned after every boolean and the adapter checks that the result is closed. The details and numbers are in D29.

## D20 Kernel precision

`Solid.positions` is a `Float32Array`; the analytic computations of the engine run in float64.

Why: Manifold offers no other type in its JS API. The engine therefore does not derive geometry from the mesh when it can compute it analytically.

## D21 Custom plane

`PlaneFeature` with an offset from a base plane, a planar face or another custom plane.

Why only an offset: a tilt about an edge of a body and a plane through three points are future functions. References to edges, which a tilt needs, are already in the PoC (D22).

## D22 Naming of edges

Forced by projected geometry (D23); it is also a prerequisite for a future plane tilted about an edge, fillets and chamfers. An edge is not named separately; its name is the pair of names of the adjacent faces. The line of a straight edge is computed analytically as the intersection of the planes of both faces; only the extent is taken from the mesh.

Limit: the end points of a projected edge have the precision of the mesh (D20).

## D23 Projected geometry

The PoC projects straight edges as lines and circular edges into a parallel plane as circles (extended 2026-11-13 for concentricity across sketches). Projecting a circular edge into a tilted plane (an ellipse) and vertices are future functions; the architecture is ready for the ellipse. Projecting all edges of a face when a sketch is created is a matter of the UI (a batch of commands); the engine handles only a single edge.

Addition D28: a projection stores as which kind of curve the edge is to be projected (`kind`). At first the kind was derived only during the recompute. That did not fit with the validation of commands and of a loaded document, which is to work with the structure only: the kind determines the derived IDs (`<id>/a`, `<id>/center`) and the allowed constraints, and a batch needs to attach to a projected curve before the recompute runs. When the edge projects differently from what `kind` says, it is a warning and the curve stays frozen.

Own curves do not refer to projected points; they attach to them by a `coincident` constraint. Otherwise removing the projection would leave a curve without an end point.

## D24 API extensions from the UI design

Writing down the functions of the UI and the API they need (ui.md) showed what was missing from the API: the compound command `batch`, a position in `addFeature`, `getState(at)`, construction geometry, data for selection with the mouse, `renameFeature`, `updatePlane`, `setSketchPlane`, `updateExternal`.

Why: the UI is not the focus of the PoC, but without this pass the gaps would have come to light only during the implementation.

## D25 Changes from the second review

The review of 2026-11-13 found one contradiction and several gaps. All the comments were justified:

| Finding | Change |
|---|---|
| Scenario 2c claimed that the extrude passes after a line is replaced, but by the rule for regions it ends in `noProfile` | The rule stays strict; the scenario is rewritten. Identifying a loop by points was rejected as ambiguous. |
| The name of a cap contained the region, so a new choice of profile renamed the cap | A cap is only `{feature, role}`. |
| The overlap of the tool was unconditional | Solved by moving it into the adapter (D19), which tests both coplanarity and overlap. |
| An edge between faces in the same plane has no line of intersection | A new kind of edge `coplanar`; it is not drawn and cannot be projected. |
| The ends of a projected line had no defined order | The line is oriented n_a × n_b in the canonical order of the names. |
| `sketchConflict` had a double meaning | It is a warning: the sketch uses the stored positions and the model does not vanish. A new state `warning`. |
| Determinism rested on the solver returning a satisfied input unchanged, and a mechanism for the cache was missing | The sketch remembers a stamp of its inputs (at first `solvedFor`, since D27 `solved`); on a match it is not solved. After the write, the cache entry is re-attached to the new object. |
| Adjacent regions in one extrude would leave an inner face | Shared loops cancel out. |
| The contract of `boolean` did not say who ensures that face numbers are unique | It is a precondition on the input, ensured by the engine. |
| The "outward" direction from one triangle | The area-weighted sum of normals. |
| D4 contradicted D13 | Fixed. |
| The preview while editing a sketch recomputed the whole model | `preview(cmd, at)` and `evaluate` ending at a given feature. |

## D26 Export format: STL, 3MF later

Decided 2026-11-13. The PoC exports only binary STL, which the engine writes itself. 3MF is a future function.

The reason for the delay: 3MF is a ZIP archive with XML, so the engine would need to write ZIP (its own code, or a library to be approved under D2).

A note for later: STL does not carry topology, 3MF does, and the documentation of Manifold therefore recommends 3MF. The API allows for more formats (`exportMesh(format)`).

## D27 Changes from the third review

Two independent reviews on 2026-11-13. I checked all the findings and consider them justified; two of them I checked with a spike.

Errors:

| Finding | Change |
|---|---|
| The shift of faces in the adapter broke attaching to analytic faces | Reproduced. After the boolean the adapter returns the remainders of shifted faces to their plane (D19, point 4). |
| The rule for running the solver did not cover edits of the sketch itself | The stamp covers all the inputs of the solver; solving is done uniformly during the recompute for `execute`, `preview` and `batch`. |
| Writing the result of the solver did not include radii | Radii are solved variables beside the points (`radii`) and are written atomically with them. |
| A conflicting `coincident` could change the profile | Points are joined only by a constraint that is actually satisfied. |

Gaps:

| Finding | Change |
|---|---|
| A broken projected edge brought down the whole sketch | It is a warning; the edge stays frozen at its last valid values. |
| The contract of commands was not described | Added the types `Command` and `CommandResult`, the rules of validation, IDs generated by the caller, cascades of removal, `load`. |
| Dragging was checked differently from how it is designed | Added a spike of stateless dragging; it holds. |
| Detection of profiles was underspecified | A region is a bounded face of the planar graph; shared curves cancel out; crossing curves are the error `invalidProfile`. |
| Face numbers did not fit with the cache | The table of numbers is part of the memoised state and is one shared table. |
| Writing the result forces a full recompute | Recorded as a deliberate consequence of D12. |
| Redundant constraints had no defined meaning | They are neither an error nor a warning. |
| Behaviour for an empty result was missing | The warning `noEffect`, the error `emptyResult`. |
| Undefined conventions | Added the order of names, the sorting of IDs, no `/` in IDs, the orientation of angles. |
| The validation scenarios did not cover a number of functions | Added scenarios 5 and 6. |
| A through cut | Recorded as a future function. |

Contradictions and outdated text: reference dimensions (computed by the engine, the field `measurements`), the repair of a projected edge in ui.md, the claim about a Web Worker, the promise of an easy move to B-rep in D7, outdated parts of D6 and D8, the order and range of the decision numbers, the missing reasons for D10–D21 and D24.

## D28 Changes from the fourth review

Two independent reviews on 2026-11-13. Every finding is checked: errors of the adapter and behaviour of the solver by running them (the cases are added to the spikes), the others against the text of the documents. All the findings were justified.

Contradictions:

| Finding | Change |
|---|---|
| A projection did not store the kind of the curve, but validation and `load` need to know it without a recompute | `ExternalRef.kind`, typed values in the stamp (D23). |
| `load` required all referenced entities to exist, so a document could not be loaded after `removeFeature` | Validation separates references within a sketch (must always exist) and between features (checked only when set; a missing target is an error of the recompute, not of the document). |

Errors of the kernel adapter (reproduced, fixed, see D19 point 5):

| Finding | Change |
|---|---|
| After a union the side of a boss stayed extended below the seating plane; after the boss was cut off, strips of faces remained | The return also includes the boundaries of adjacent faces when the shifted face vanished. |
| A flush boss with a float32 deviation did not create a `coplanar` edge and invalidated the planarity of the top face | Flush faces are also shifted and returned in a union; planarity is determined by the distance of vertices from the plane. |
| The search for a pair of faces stopped at the first match, even when it did not lead to a shift | The rule is uniform; a shift always happens; enlarging the tool takes precedence over shrinking it. |
| After a cylindrical cut the ceiling lay off its plane by 2e-4 mm | The planes for shifting a vertex are fitted over the face; narrow triangles are left out. |

The fix brought two more things to light that the reviews had not found: the computation of a vertex shift was numerically unstable for a single tilted plane, and merging vertices alone left null triangles with the numbers of vanished faces in the mesh. Both are fixed.

Gaps:

| Finding | Change |
|---|---|
| `updateExtrude` could not change the source sketch; a repair after the sketch was removed meant a new ID | The field `sketch` in `updateExtrude`. |
| Snapping to a projected point could lead to a curve referring to a derived point; `removeExternal` would leave it without an end | A curve may refer only to own points and the origin; it attaches to a projected point by `coincident`. |
| `evaluate` had no way to get the target of a drag; `execute(dragPoint)` did not write the stamp | The parameter `drag`; dragging writes the variables and the stamp. |
| A split edge had a single polyline | `segments`, a list of segments. |
| Joining the points of a profile did not say what happens with the origin and projected points | It is transitive and also goes through them. |
| The edge kind `coplanar` had no tolerance | The angular tolerance of the engine 1e-4 rad; the length tolerance 1e-6 mm for the sketch. |
| The coordinate systems of the base planes and the sign of horizontal and vertical dimensions were missing | Added to the conventions; the dimensions are oriented. |
| planegcs: auxiliary constraints in the diagnostics, console output, constraints between fixed entities | The adapter filters them and turns the output off; validation refuses a constraint only between fixed entities. Checked by a spike. |
| Edge-case inputs and a suppressed feature | A zero distance, empty regions and a non-positive radius are an invalid command; a suppressed feature is an empty operation. |
| The format of the stamp in `addFeature` and the tolerance of curves touching (from the check of the fixes of the third review) | The engine computes the stamp, the caller sends an empty one; curves touching use the length tolerance. |

Choices from this review that the owner explicitly confirmed on 2026-11-13:

1. The kind of a projection is stored in the document (instead of being derived during the recompute).
2. An own curve must not refer to a projected point; the UI creates an own point and a constraint.
3. Horizontal and vertical dimensions are oriented and may be negative.
4. In the overlap of flush faces in a union, the area carries the name of the tool's face.
5. A tangent touch of two non-construction curves away from a joined point invalidates the profile of the whole sketch.

## D29 Random tests of the kernel adapter, adapters in packages

Done on 2026-11-13 and 14 during the implementation. The owner asked for the work to go on autonomously; this record summarises what was decided along the way and waits for his confirmation.

**Random tests of the kernel adapter.** 46 fixed cases passed, but the adapter is built on tolerances and fixed cases cover only situations someone thought of. A generator therefore composes random sequences of unions and differences of boxes, triangular prisms and cylinders, which are often flush, in a randomly rotated position, and compares the result with two oracles independent of the adapter (a grid model with face names, slices by layers). The description and the numbers are in architecture.md, Results of the spikes.

What the random tests changed in the adapter (D19, point 6):
- The return of shifted faces is not computed by a shift "into the plane" but exactly from the original geometry of the tool and the body. Otherwise a residual deviation of a fraction of the overlap folded the mesh in a later operation.
- The mesh is cleaned after every boolean, even when nothing was shifted.
- After every boolean the adapter checks that the result is a closed surface, and otherwise ends with an error (`kernelFailure`). Manifold loads such a mesh in the next boolean without an error and silently drops part of it.
- A body that touches itself only along an edge has doubled vertices at the place of the touch.
- Cleaning tells a null triangle (vertices on a line) from a needle (two close vertices, the third far away). A needle belongs in the mesh.
- The adapter also checks that no planar face has a folded triangle.

Considered and rejected:
- Cleaning the mesh by a pass through Manifold. It collapsed null triangles in the wrong direction.
- Merging vertices only along edges (edge collapse), so that no edges with four triangles arise. That way sheets of two layers that came to lie on each other after the return were not found, and the kernel then loaded them wrongly (a volume smaller by hundreds of mm³).
- Splitting, during cleaning, every edge that has a foreign vertex close to its line. For healthy edges at a small angle two unclosed states alternated; only edges without a counterpart are split.
- Always keeping separate the vertices that the kernel returns at the same place to the bit (because of touching along an edge). But vertices that must be joined also come out at the same place.

The cost: the kernel adapter has about 900 lines and is the most complex part outside the engine. Its behaviour rests on tolerances derived from the size of the model; its correctness is not proven, only checked by tests. A failure is safe, though: the adapter returns an error, not a damaged body.

State after the fixes from the review: 46 fixed cases passed; of 30,000 random ones none gave a defective result, three were refused by the adapter with an error (one within the design range).

**Independent reviews of the adapters (2026-11-14).** Both adapters went through a review that checked its findings by running them. All the findings listed below were confirmed.

Kernel adapter, fixed:

| Finding | Change |
|---|---|
| A shrunk tool skipped a face of the body just behind its own face and left a sheet of it, without an error | The shift goes at most to half the gap; the result is checked for folded triangles. |
| Cleaning took healthy thin triangles as null (a block penetrating a side by 0.005 to 0.02 mm: an error in a third to a half of the positions) | Only edges without a counterpart are split; a null triangle is determined more strictly. |
| The tolerances did not account for the distance from the origin (a model 450 mm from the origin: errors and silently defective results) | The size for the tolerances is at least twice the largest coordinate. |
| After touching along an edge, the number of triangles doubled with every further boolean (28 → 32,980 after twelve operations) | An existing vertex is doubled instead of a new one in the middle of the edge. |
| The random tests did not try a deviation of a side between float32 precision and the tolerance | A deviation of ±3e-5 was added; cases with it may end with an error, not a defective result. |

Kernel adapter, kept as a described limit (architecture.md, Limits): a resolution of about 1e-4 of the model size for flush faces, coincident cylindrical surfaces, narrow faces of the tool, intersection, quadratic complexity of the return of faces.

Kernel wrapper, fixed: the wrapper function `triangulate` in the library did not free WASM memory (the adapter calls the function below it and frees the memory itself); a defective input (an unclosed or inverted mesh, a wrong count or range of face numbers) is refused before it is passed to the library; `triangulate` checks its input and has the orientation of loops described.

Solver adapter, fixed:

| Finding | Change |
|---|---|
| Dragging in a sketch with a redundant constraint ended in a conflict (redundant constraints will be common) | Redundant constraints are found without the drag and left out while dragging. |
| The state `Converged` was taken as success even when a redundant constraint stayed unsatisfied | Solved again from the result until the state `Success`. |
| Degrees of freedom and redundant constraints described the initial guess, not the result; solving again from the result gave different diagnostics | The diagnostics are taken from the pass that starts from the result. |
| A solution with a negative radius; an arc with fixed points on different radii | Such a result is `failed`. |
| The radius of a fixed circle with a free centre changed in its last bits | The input value is returned. |
| An unknown kind of curve was taken as an arc; an invalid ID in `fixed` was silently ignored | An exception. |
| The default algorithm often did not finish | A fallback to Levenberg–Marquardt. |

Solver adapter, kept as a described limit (architecture.md, planegcs): a false conflict of a redundant constraint from an imprecise initial guess, a dimension between coincident points, an arc flipping over.

Tests: cases were added for every fixed finding, and checks that constraints give the geometry they promise (the existing tests of the mapping guarded only the loss of degrees of freedom).

**Adapters in packages (D15).** The workspace is set up: `packages/engine` (so far only the types copied from architecture.md), `packages/kernel-manifold`, `packages/solver-planegcs`. The cases from the spikes run as tests in Vitest, a thousand random cases on every run. The copy of the kernel adapter in `spikes/` was removed so that there are not two versions; only scripts that check the libraries themselves stayed in `spikes/`.

Small decisions made along the way:
- The packages are not built; they export the TypeScript source directly (`exports` points to `src/index.ts`). A build will be needed only for `app`.
- pnpm is run through `npx pnpm@9`; it is not installed globally. The version is written in `packageManager`.
- Development dependencies beyond D15: `typescript`, `vitest`, `@types/node`. They are tools, not runtime libraries; still, the owner did not approve them explicitly.
- The solver adapter throws an exception on an input that refers to a nonexistent point or curve or gives a tangency of two lines. Such an input is to be refused by the validation of commands; the exception is a safeguard.
- The kernel adapter also throws an exception on an input body that the kernel does not accept.

## D30 Decisions from the implementation of the engine

Done 2026-11-14. The engine is written by architecture.md; here are the places where the design left the choice to the implementation. Waits for the owner's confirmation.

Commands and the document:
- **`dragPoint` cannot be put into a batch.** A drag does not change the document; the recompute gets the target; in a batch it would not be clear which state it belongs to. Considered: taking the last drag in the batch.
- **IDs are unique in the whole document**, across features and the entities of all sketches (as the convention says), and must not be empty or `__proto__`.
- **`load` does not check the type and order of the target of a reference between features**, only its form. The reason: after a feature is removed, another with the same ID can be added at another place, and a document made by allowed commands must load. A wrong target shows in the recompute as `brokenReference`.
- **`updateExtrude` checks only the references the command changes.** Otherwise the distance of an extrude whose sketch was removed could not be changed.
- **`updateExternal` drops the frozen values of a projection**, because they belonged to the original edge.
- **Regions and the name of an edge are stored in canonical form** (sorted curve IDs, the faces of an edge in the order of names), even when the caller sends them otherwise.
- **`load` writes the result of solving just as `execute` does** and clears the undo history. `preview` does not write the result of solving into the returned document.
- **An `execute` that does not change the document** (a drag the solver does not solve) adds no undo step.

Sketch:
- **The stamp** is a 64-bit hash of the canonical form of the solver input: the curves without the construction flag, the driving constraints, the values of projected geometry. Reference dimensions and the construction flag do not change it.
- **A tangent join at a common point is valid** (a corner fillet). A touch is taken as a touch at the vertex up to a distance of √(8·R·tolerance) from it, because tangent curves lie within the tolerance some way from the point of contact as well. The cost: a real crossing closer than this distance (hundredths of a mm at R = 10) is not recognised.
- **A curve of zero length** (a line or an arc with joined ends) invalidates the profile.
- **Curves that enclose no area** are recognised by having the same face of the graph on both sides; this also holds for a connector between two closed shapes.

Bodies and the recompute:
- **Regions that touch only at a point** (or a region whose boundary passes one point twice) give a body that touches itself along a vertical edge. The mesh of the tool has doubled vertices at that place, so that it is a closed surface.
- **No effect (`noEffect`)**: the volume of the body did not change (relatively within 1e-6); for a cut, moreover, no face of the tool may be in the result. For an addition there may be one: a tool inside the body whose face is flush with a face of the body renames it by D28. The cost: an addition or a cut smaller than a millionth of the volume of the body is reported as having no effect.
- **A feature in error or with no effect adds no face names to the table.**
- **The faces and edges of a body are computed only for the result of the recompute** and are remembered by the identity of the mesh.
- **The scenarios are in a package of their own**, `packages/scenarios`, so that `engine` does not depend on the adapters, not even in tests.

Addition after the independent review of the engine (2026-11-14). The review found fourteen errors, all reproduced by running the code; the fixes have tests in `packages/engine/test/review.test.ts` and `packages/scenarios/test/review.test.ts`.

| Finding | Fix |
|---|---|
| A line and an arc leaving a vertex tangentially in the same direction: the order around the vertex was decided by the noise of the solver, so regions were missing or wrong (in a third of the cases, by the rotation of the sketch) | The order is taken by the direction to a point of the curve a small distance from the vertex, not by the tangent |
| An ID or a reference named like an object property (`constructor`, `toString`) brought down the recompute with an exception or gave a wrong error code | Such IDs are not allowed and references are looked up only among the own keys of the records |
| Adding a small boss to a large body was reported as having no effect | The change of volume is measured against the smaller of the two bodies |
| A drag the solver did not solve left a transient conflict in the state of the engine | Such a drag does not change the state |
| A circle with a huge radius asked for infinitely many segments and exhausted memory | A ceiling of 4096 segments per curve, document numbers in the range ±1e9 |
| A curve passing just by an arc (below the tolerance of the division) gave a self-intersecting body on which every further boolean failed | The profile is checked again after the arcs are divided; a crossing or a collapsed region invalidates it |
| A point removed and added in the same batch under the same ID stayed unsolved, because the hash of the solver inputs did not change | A new point and a new curve clear the stamp |
| The construction flag changed the order of keys, so save, load and save did not give the same text | The order of keys is the same as on load |
| `load` cleared the history before the recompute finished | The history is cleared only after a successful recompute |
| Commands with no effect (renaming to the same name, dragging a fully constrained point) added an undo step | An undo step arises only from a change of content |
| An exception in a listener deprived the others of the message; a nested call of the engine delivered states in the wrong order | See "Behaviour of the facade" in architecture.md |
| The same region twice ended in a misleading kernel error | Regions are merged during validation |
| An auxiliary table of the recompute grew with every feature that ever existed | The table lives only for the duration of one recompute |
| Small things: negative zero, a distance of 1e300, a negative radius of a frozen projection | Validation |

Decisions that follow from this:
- **The validity of a profile also depends on `chordTolerance`.** A shape that is geometrically fine but finer than the division of arcs is invalid. Considered: requiring a clearance larger than the sagitta for exact curves (without the second check; it would require computing the distance of a line from an arc and of an arc from an arc) and refining the division only where curves pass close (more complex; adjacent regions would stop sharing vertices).
- **A reference to a face or an edge includes the extrude that named it:** a sketch on the bottom of a pocket cannot be moved before the cut that made the pocket.
- **`getState(at)` with an unknown feature is an exception, not an error result:** it is a mistake of the caller, not a state of the document.
- **A listener that throws an exception brings down the call of `execute` only after the state is written.** Considered: silently dropping the exceptions of listeners (an error in the UI would stay invisible).

What the review found and remains: a real crossing closer than √(8·R·tolerance) to a common vertex is not recognised (see above); an `add` of a piece that does not touch the body gives one body with two parts and the state `ok`; the validation scenarios do not cover the modules `solid.ts` and `evaluate.ts` on their own (they are checked only through the scenarios and the random sequences of the review).

## D31 Demo application

Done 2026-11-14. `packages/app` is a demo UI by [ui.md](ui.md). Waits for the owner's confirmation.

Libraries and tools:
- **three.js** (`three` 0.187) for rendering. It has been in the design from the start (D15, architecture.md).
- **Vite** (8.x) as the development server and build, **`@types/three`** for the types. They are development tools, not present when the app runs; the owner did not approve them explicitly. Considered: esbuild with a script of our own (fewer dependencies, but WASM files and page reloading handled by hand).
- **No UI framework.** Panels are rebuilt from `EngineState` by a small helper function when the state changes. Considered: React or Svelte; for the scope of the PoC they would add a dependency and a build step with no benefit.

The split: `viewport.ts` draws a general description of the scene and knows nothing of the engine; `sketch-view.ts` and `sketch-commands.ts` are pure functions (the geometry of a sketch, the commands of tools, constraints from a selection) and have tests against the real engine in Node; `app.ts` holds the state of the UI. The engine learned nothing new about the UI: the app uses only the public API and no change of the engine was needed for it.

What the UI decides on its own (ui.md left it to the UI):
- **The view** is parallel (no perspective). The left button selects and draws, the right one rotates, the wheel zooms, the middle one or Shift + right pans. Without a mouse (touchpad): Alt/Option + drag rotates, Alt + Shift + drag pans, a two-finger scroll or a pinch zooms.
- **Selection in the view**: an edge takes precedence over a face, a face over a plane. A plane can be selected in the view only where no body is under the cursor; base planes can also be chosen by a button. The reason: the base planes pass through the model and would cover faces.
- **IDs of new entities**: a prefix and a sequence number (`p12`, `c7`, `k3`, `s2`) that is not in the document; the counter does not go back during a session. The cost: the ID of an entity removed in an earlier session may be used again. Considered: random IDs (never repeated, but unreadable in the list of constraints).
- **A sketch on a face projects its outline** right when it is created, in one undo step with the creation of the sketch.
- **A new dimension gets the current measure** rounded to a hundredth of a millimetre (an angle to whole degrees) and is edited in the list of constraints. The engine refuses a dimension only between fixed entities as a driving one; the UI adds it as a reference dimension and says so.
- **A chain of lines** continues from the end of the last line and ends by connecting to an existing point or with the Esc key. Only horizontal and vertical are inferred for the free end.
- **Removing a curve** also removes its points that nothing else uses.
- **The position marker**: the model is shown after the chosen feature and new features are inserted after it.
- **An extrusion and a plane** are entered in a panel with a live preview through `preview`; the document changes only on confirmation. A sketch with a single region selects it by itself; a sketch on a face of a body proposes an addition to that body.
- **Visibility** of bodies, sketches and planes is UI state and is not saved.

Left out compared with ui.md: snapping and inferred constraints other than horizontal and vertical, placing a dimension with the mouse (horizontal and vertical dimensions have a button of their own), constraint icons in the view (constraints are in the list, dimensions also as labels), repairing the reference to a target body other than in the extrusion panel, touch control.

Addition after the independent review of the app (2026-11-14). The review found one serious error and nine medium ones; all are fixed, and the pure parts have tests in `packages/app/test/sketch-tools.test.ts`.

| Finding | Fix |
|---|---|
| A double click with the Line tool (the usual way to end a chain) created a line of zero length and invalidated the sketch | No curve is created between points at the same place; the place under the cursor is computed again after every change of the sketch |
| A selection in the view survived a move of the position marker, so a sketch could be created on a face that does not exist at that point of the timeline | A selection holds only for what is visible and ends with a change of mode |
| Editing an extrusion with a missing target silently overwrote it with another body when the distance changed | A missing target is not overwritten by itself |
| A failed opening of a file left the UI inconsistent with itself; a successful one left hidden bodies from the previous document | The UI state is restored on an error and cleared on success |
| An emptied dimension field set the value 0 | An empty input does not change the value |
| An angular dimension just by −180° was rounded to a value the engine refuses | The angle is converted into (−π, π] |
| A plane being edited could be chosen as its own base | It cannot be selected in the view |
| Dragging a point could not be cancelled, and after the pointer was lost the point kept following the cursor | Esc, loss of the pointer and a change of the document cancel the drag |
| A projection that cannot be evaluated was not visible in the UI and could not be removed or repaired | The sketch panel has a list of projections with their state, repair and removal |
| The view of a sketch on a face turned downwards was rotated by 180° | The tilt of the camera follows the direction of the normal |

Small things fixed at the same time: an old error in the status line after a successful command, the position marker after its feature vanished, hiding with an addition and a cut (a body is hidden at the feature that created it), the badge "Fully constrained" on an empty and unsolved sketch, the message for a new extrusion without regions, the rounding of a new dimension, the resolution of the canvas after moving to another monitor. Undo and redo are disabled while an extrusion or a plane is being edited.

What remains: the STL export always exports the whole model, even when the state at the position marker is shown; the logic of the class `App` (modes, events) has no automated tests, only manual passes in the browser.

Verification: tests of the pure modules in Vitest and a manual pass in the browser (sketch, dimensions, extrusion, cut on a face, plane, edit, position marker, suppression, removal with an error of a dependent feature, undo and redo, save and load, STL export).

## D32 Sketch diagnostics

Decided 2026-11-14 at the owner's suggestion. A sketch drawn in the app had two degrees of freedom and six redundant constraints (three of them exact duplicates), and neither could be seen in the app: the solver marked two of the six constraints as redundant and said nothing about what is free.

- **Two queries of the engine,** `diagnoseSketch` and `explainConstraint`. They run on request and change nothing; the description is in architecture.md, section Sketch diagnostics. The app and the interface for AI use the same data.
- **A first-order analysis from the engine's own equations of constraints,** not queries to the solver. The engine has the equation of every type of constraint; from the derivatives in the solved state it assembles the Jacobian matrix and computes the degrees of freedom, the dependencies and the freedom of entities from it by linear algebra. The same analysis also gives the number of degrees of freedom in the result of the sketch.
  - **The first version used the solver as an oracle** (the sketch was solved again without each constraint and with each point fixed). An independent review refuted it: the solver reports a cycle of equal lengths as fully constrained, for a line collapsed to a point its freedom grows with an added constraint, noise in the solved position marked a fixed point as free, and thirty rectangles in a sketch took over twenty seconds.
  - **The cost of the decision:** the engine now knows the equation of every constraint, which the solver used to encapsulate. It is one short function per type of constraint; tests guard the agreement with the solver and types guard the completeness of the table. The solver stays replaceable, because the equations describe the meaning of a constraint, not the way of solving it.
  - **Considered:** extending the solver port with a query for dependencies (planegcs has no such query, and its own rank is exactly what failed).
- **All members of a dependent group are redundant,** not only the constraint added last. The user is to choose which one to remove; the engine offers one particular set for it, in which the older constraints stay.
- **Freedom is given per entity,** not per direction. A point snapped to a tilted line can move in both axes but has one degree of freedom; the count of degrees captures that, a pair of flags for the axes does not. The item "state of constraint per entity" thereby moved from the future functions into the PoC.
- **The engine refuses an exact duplicate** already in the command (`addConstraint`, switching a dimension to driving). A second dimension of the same thing with another value is also a duplicate: the right way is to edit the existing one. Loading accepts a duplicate, otherwise documents from an older version could not be opened; the value of such a dimension can still be changed.
- **The catalog of constraints** (`engine/src/catalog.ts`) is the single source of truth about which constraints the engine knows and what operands and values they have. The validation of commands, the search for duplicates and the analysis follow it.
- **Validation scenario 7** (a sketch step by step with diagnostics) and tests over the sketch the suggestion came from.
- **Display in the app.** In the list of constraints only the set proposed for removal is marked, not all members of the dependent groups: the summary "6 redundant constraints" thus matches six marked rows. Clicking a constraint shows what it follows from (a highlight in the list, a highlight in the view, a sentence in the panel). Only duplicates can be removed in bulk; for the others it is up to the user which constraint of the group to keep. Free entities are blue and constrained ones dark, as is usual in CAD. The details are in ui.md, Implementation status.

Findings of the review and their resolution:

| Finding | Resolution |
|---|---|
| A line collapsed to a point by the solver: freedom 9 instead of 5, all constraints "redundant" | Analysis from the engine's own equations; this state is nothing special for it |
| A cycle of equal lengths: the sketch reported as fully constrained, a needed dimension marked redundant, the explanation was not the smallest | The same; the state of the sketch and the diagnostics now come from one analysis |
| A fixed point of contact in a slot marked as free | The same; tangency at a common point has an equation of its own (the radius perpendicular) |
| In a loaded document with duplicate dimensions the value of none of them could be changed | A duplicate is guarded only when a reference dimension is switched to driving |
| A zero distance beside a coincidence had no explanation | A zero distance counts as a coincidence |
| The diagnostics took seconds to tens of seconds | The analysis does not call the solver; 240 constraints in about 0.1 s |

A second review (already over the analysis from the engine's own equations) found errors in its numerics:

| Finding | Resolution |
|---|---|
| Tangency was counted as the radius being perpendicular whenever the end of a line or an arc lay on the circle, even only by coincidence of dimensions or thanks to the tangency itself: the radius dropped out of the analysis (freedom higher by 1, the tangency "redundant") | The form for a common point is used only when the other constraints hold the point on the circle; this is recognised from the space of their rows |
| Points coincident only to the precision of the solver: the derivative step underflowed and the constraint between them was not counted (freedom up to 2 higher) | The equations are evaluated in coordinates relative to a point of the constraint, and the offset is added only to those |
| Freedom of entities: the auxiliary vectors covered only two dimensions; with a sketch freedom of 3 or more, points came out with a lower freedom | Auxiliary vectors from a pseudorandom number generator with a fixed seed |
| Perpendicularity and parallelism of lines of equal length: dividing by the larger of the two lengths has a kink, the row had an error at the edge of the threshold (a square with freedom 3 instead of 4, an extra dimension in the explanation) | The divisor is the length in the solved state |
| A small shape far from the origin lost its redundancy | Coordinates relative to a point of the constraint (see above) |
| An explanation contained a constraint it can do without (a coincidence represented in the basis by only one equation) | Constraints are removed from the set by trial as long as the constraint follows from the rest |
| The number of constraints in the set for removal depends on the order when a constraint with two equations is among them | The behaviour stays, the documentation is fixed: what does not depend on the order is the number of removed equations, not of constraints |
| The analysis runs at every evaluation and grows with the cube | A second pass of orthogonalisation only where needed; the cost measured and recorded, it stays a limit for hundreds of constraints |

Review of the display in the app:

| Finding | Resolution |
|---|---|
| The explanation claimed that any of the constraints the marked one follows from can be removed instead; for a constraint with two equations (midpoint, coincidence) this does not hold | "Any of them" is offered only when those constraints are themselves wholly redundant |
| The advice on anchoring recommended a coincidence with the origin even where it collapses the geometry to a point | Two dimensions from the origin are advised |
| An explanation above the list of constraints shifted the rows, so a second click hit another constraint | The explanation is right below the marked row |
| The same reference dimension could be added repeatedly (a dimension between fixed entities) | The app does not add it a second time |
| For a sketch in conflict the duplicates were marked, but their count and the button to remove them were missing | The summary of duplicates and the button are also shown for an unsolved sketch |
| An unsolved sketch was all in the "free" colour | A neutral colour while nothing can be said about freedom |
| A constraint left out while solving (lost projected geometry) was explained as needed | A sentence of its own |
| Grammatical forms of words in the Czech messages ("body p1", "a dalších 3") | Fixed and covered by tests |

Limits:

- Dependence is judged to first order. A constraint that follows from the others only thanks to particular values is not marked as redundant, and the result for it may depend on noise in the solved positions; tangency at a common point is handled only when that point is the end of a line or an arc and constraints other than tangencies hold it on the circle. A sketch at the edge of a singular state may give a result that depends on the order of the constraints.
- The explanation of a constraint is a set from which nothing can be removed, not necessarily the one with the fewest constraints. Only a whole constraint gets into the set for removal; a constraint of which one equation of two is redundant is not marked.
- In a conflict the diagnostics compute neither redundancy nor freedom and take the conflicting constraints from the solver, which marks more of them than necessary.
- "The older constraints stay" follows the order of keys in the document; JavaScript orders IDs in the form of an integer numerically, so the order of creation does not hold for them.
- A redundant constraint that the solver does not recognise itself (the third equality of lengths in a triangle) is still taken by the solver as a full one: the sketch behaves as fully constrained and a point cannot be dragged until the constraint is removed. The diagnostics show it.
- The cost grows with the cube of the number of constraints, and the analysis runs at every evaluation of the sketch, steps of a drag included: 240 constraints about 15 ms, 480 about 0.1 s, 960 about 0.8 s. The diagnostics and the explanation add time of the same order.

## D33 Interface for AI (MCP server)

Decided 2026-11-14 at the owner's suggestion: instead of handing over a file, it should be enough to say "I have drawn a sketch with two degrees of freedom, why" and the AI looks at the model itself.

- **The package `packages/mcp`** with an MCP server over standard input and output. It uses the official library `@modelcontextprotocol/sdk` (approved by the owner; it pulls in about ninety transitive packages and is not present when the app runs).
- **A few general tools instead of a tool for every operation:** `describe_api`, `get_model`, `get_document`, `get_sketch`, `explain_constraint`, `get_body`, `execute`, `preview`, `undo`, `redo`, and for files `session_status`, `open_document`, `save_document`, `export_stl`. A command is a value of the engine's type `Command`; the engine validates it and returns an understandable error.
- **The description is generated from the sources of the engine,** so that the interface does not drift from the engine and new constraints and commands appear in it by themselves: the types of the document and of commands are taken directly from the source text of `types.ts`, constraints from the catalog (`catalog.ts`), which validation follows as well. Only the conventions (units, IDs, how a sketch is built) are written by hand. A test checks that the engine accepts every constraint of the catalog by the example in the description. Considered: a tool for every command with a JSON schema (more precise help for the client, but the schemas would be written by hand beside the types and a tool would be added with every constraint).
- **Two modes, the same tools.** The server has an engine of its own for a document from a file. When the running app connects to it, the tools run over the app's engine: the user sees the changes right away and can revert them with Undo. Files are always read and written by the server.
- **The bridge to the app** is local HTTP on `127.0.0.1` (default port 4517): the app reads requests as an event stream and sends the answers back. No other library (WebSocket would need the package `ws` in Node). The connection is turned on in the app by the AI button and is never made by itself; the last connected app wins.
- **Who may connect to the bridge.** Only a page from this computer. Three things guard it together: the origin of the page (`Origin`), the target address in the `Host` header (a defence against DNS rebinding) and a custom request header, which a foreign page cannot send without the server's permission and which elements such as an image do not send at all. The check of the origin alone was not enough: a request without an `Origin` header managed to disconnect the real app and take over the commands meant for it.
- **Every document has its own file.** The server remembers separately the file of its own document and the file of the document in the app (only for the duration of one connection). A save without a path thus does not write the document of one engine over the file of the other.
- **An operation in progress in the app** (an extrusion, a plane) is cancelled when the AI actually changes the document; an invalid command or an undo with no history leaves it. Loading a document from the AI replaces the UI state just as Open does, and restores it on failure.
- **An invalid command is an error of the call** (an error flag in the answer), not a result: the client and the app recognise it without reading the body of the answer.
- **Running it:** `pnpm mcp:build` builds `packages/mcp/dist/server.js`; the AI client runs it with `node packages/mcp/dist/server.js [--file model.json] [--port 4517] [--no-bridge]`. The root of the repository has `.mcp.json`, so Claude Code offers the server by itself.

Findings of the independent review and their resolution:

| Finding | Resolution |
|---|---|
| A save without a path wrote the app's document over the server's file and vice versa | The file is remembered for each document separately |
| The server did not end after its input was closed and kept holding the port of the bridge | It also ends when standard input is closed |
| The bridge accepted a request without an `Origin` header and did not check `Host` | A check of `Host` and a required custom header |
| The ends of edges in `get_body` were wrong for arcs, circles and interrupted edges | A straight edge has end points and a gap flag, a circular one a centre and radius, each a length |
| The advice for a sketch with one degree of freedom proposed a coincidence that ends in a conflict | The advice follows the number of degrees of freedom (in the app's panel too) |
| An invalid command came back without an error flag; the app cancelled the operation in progress because of it | An error of the call; the operation is cancelled only on an actual change |
| A failed opening of a document from the AI left the UI in its default state | The UI state is restored on failure |
| An exception in the app's handler left the caller without an answer | An answer is always sent; the report says that the change may already have happened |
| An unsolved sketch looked like "0 degrees of freedom" in the overviews | The overviews have a flag `solved` and give the freedom only for a solved sketch |
| Command-line options: an invalid port, a missing value and an unknown option were silently ignored | They are start-up errors with help |

A further review (2026-11-14, supplied by the owner):

| Finding | Resolution |
|---|---|
| After New or Open in the app, the remembered file of the previous document stayed and `save_document` without a path overwrote it with the new document | With every answer the app reports the sequence number of its document; a remembered file holds only for the document it belongs to. `session_status` checks the number before it answers |
| Two apps with the connection on took the connection from each other over and over (the displaced one reconnected after three seconds), and a command could change the wrong document | The displaced app gets an event `displaced`, its connection goes off and it does not reconnect by itself |
| `explain_constraint` advised removing any constraint of `impliedBy`, even when that would free the sketch (a point on a line follows from the midpoint of the line) | The advice follows which of those constraints are themselves redundant; each has a flag `removableInstead` (the same rule as in the app's panel) |

Limits: the bridge has no login; it relies on the local address and the checks described above; any page running on this computer can connect. The size of an answer is not limited (a model with hundreds of bodies gives megabytes), and `save_document` and `export_stl` overwrite an existing file without asking. When two MCP servers run, only the first opens the bridge; the second works only with files. The types in `describe_api` are TypeScript source text, not a JSON schema, so the client does not validate the input of a command itself. The texts of the tools were in Czech like the rest of the project; they are English since 2026-11-25.

## D34 Symmetry and the midpoint of a line

Decided 2026-11-14. Construction curves were of little use without these two constraints: an axis of symmetry could not be used as an axis.

- **`symmetric`** (`a`, `b`, `line`): the points `a`, `b` are symmetric about the infinite line the line lies on. The order of the points does not matter. A point that is an end of the axis must not be symmetric (it would be a coincidence).
- **`midpoint`** (`point`, `line`): the point lies halfway along the line. It must not be an end of the same line.
- **Both constraints have two equations,** so they remove two degrees of freedom. In the solver, symmetry is the constraint `p2p_symmetric_ppl`; the midpoint of a line is the symmetry of its ends about the point (`p2p_symmetric_ppp`).
- **What adding a constraint costs.** Four places in the engine and the adapter: the type in `types.ts`, the catalog entry (operands, interchangeability, check), the equation in `analysis.ts` and the translation in the solver adapter. The completeness of the equations and of the translation is guarded by the types (without them the project does not compile) and by a test that checks for every type of constraint that its equations agree with the solver.
- **The app and MCP changed not because of these two constraints but because of all the ones to come.** The app takes the list of geometric constraints, their names and their help from the catalog and divides a selection among the operands by the kinds the catalog gives (special rules stayed only where one action creates several constraints). The MCP server took over the new constraints without a single change; its test, which sends every constraint of the catalog to the engine, covered them by itself.
- **Validation scenario 8** (a symmetric part with a construction axis).

- **A coincident pair in the solver adapter.** The library computes symmetry from the line joining the two points (and the midpoint of a line from the line joining its ends). When the points lie at the same place, it reports the constraint as a conflict although it is satisfied: a symmetric pair on the axis is a valid state. On such a conflict the adapter therefore tries two fallback routes: first it moves the points slightly apart and solves the original system (which finds a solution in which they do not coincide), and when that does not help, it replaces the constraint by its coincident form (coincidence of the points and a point on the axis; for the midpoint of a line, coincidence of the point with both ends). Every solution of the fallback form satisfies the original constraint, so a real conflict stays a conflict.

Findings of the review and their resolution:

| Finding | Resolution |
|---|---|
| A symmetric pair that another constraint pulls onto the axis (a point on the axis, a coincidence of the points, a coincidence with the origin, a zero distance) was reported as a conflict; likewise a pair coincident already in the input | Fallback routes in the solver adapter (see above) |
| The midpoint of a line whose ends lie exactly at the same place was reported as a conflict | The same |
| The app offered symmetry and midpoint even for a selection the engine always refuses (the symmetric point is an end of the axis) | The offer by the catalog also follows the constraint's own rule |
| The assignment of a selection to operands was greedy and would not find a valid assignment for a future constraint with overlapping kinds of operands | The assignment tries all possibilities |
| The advice "by a coincidence with the origin" (app and MCP) led, for a symmetric pair and for a line from the origin, to collapsing the geometry to a point | Two dimensions from the origin are advised |

Limits:

- The solver does not solve symmetry when both points lie on the same side of the axis and nothing holds the axis (it collapses the axis to a point and reports a failure, or thereby "satisfies" even constraints that contradict each other). With the axis held by constraints, or with points drawn roughly symmetrically, there is no problem; in the app the axis is usually drawn as a construction line from the origin.
- Adding a midpoint or a symmetry gives a valid solution, but may not keep the shape of the surrounding geometry (a line may stretch or turn). It is a property of the solver: it looks for the nearest solution in its variables, not the smallest change of shape.
- A symmetric pair coincident on the axis is moved apart by a dimension or by dragging one of the points; removing the constraint that pulled it together alone leaves it in place.

## D73 MCP and API ergonomics

The owner had an AI build a flange and a planetary gearbox through the MCP server and collected what got in its way. Each item is a change of the interface, not of the model; the document schema stays (no step in `UPGRADES`). The design as implemented is in [architecture/ai.md](architecture/ai.md), [api.md](architecture/api.md), [document.md](architecture/document.md) and [sketch.md](architecture/sketch.md).

- **describe_api in sections.** The description had grown to 324k characters, more than an answer of a tool can carry, so the AI got it cut off. Without arguments it answers with an index (the essentials, every section with its key, size and one line, how to ask); `section` gives one section (by key or title), `command` one command of the union `Command` with the comment that leads it (its own, the one-line header of its group, or a group comment that names it) and the types its code names, `type` one declaration of `types.ts`, `query` and `tool` one query or sketch tool. The conventions are split into `conventions` and `modelling`, the sketch tools into `sketch-tools` and `sketch-cuts`, and the types into a section per marker of `types.ts` (five markers added). Every section stays under 50,000 characters (a test). Alternatives: a shorter description (loses what the AI needs), paging by offset (the AI cannot know where a topic is), one tool per section (more tools to list).
- **Defaults of a new feature.** `addFeature` takes `NewFeature`: `name` (the ID) and `suppressed` (false) may be left out, and a sketch may leave out its empty parts, so a sketch is `{ id, type, plane }`. The command fills them in before validation, so the app, MCP and the engine agree; the stored document keeps every field, so no schema step. With fields left to defaults a misspelt one (`supressed`, `nmae`, `point`) would succeed without effect, so addFeature refuses a top-level key the validator of the type never reads, naming the key and the fields it reads (review; updateFeature was strict already). Alternatives: defaults in the validator (a load would accept a document an older build refuses), defaults only in MCP (the app and a test would differ).
- **The rectangle and the fillet.** The rectangle takes `center` instead of `first` (a construction diagonal with the centre as its midpoint; the catalog gains `oneOf`), and `width` and `height` (numbers or expressions, evaluated and checked by the tool as the fillet radius is) that add the dimensions and draw it at that size, as the polygon's `size` does; with both and a corner or centre snapped to a fixed point it is fully determined. What would hold a corner twice is refused (the snap made a conflict): an `opposite` that snaps, to a point or to a curve, together with both sizes (they place that corner already), and an `opposite` snapped to a point together with even one size when `first` or `center` snaps to a point too (the two points hold the size already). Its new points are numbered in the order of `ids.points` (they came out p1, p3, p2, p4). The fillet takes `corners`, one radius, one batch: each corner in the state the ones before it left, the lists of `ids` per corner, a refused corner refusing the call by name. Alternatives: a flag `centered` (two meanings of `first`), one call per corner (one undo step each, and the AI had to rebuild the context in between).
- **Consistency.** check_interference takes `after` as the tool query does; the query mass weighs every body without `bodies`, as interference takes them (auxiliary ones skipped, a reference part counted with its own mass or density: an assembly weighs its motor; one that states neither is skipped with the reason `noMassOfItsOwn` rather than weighed as infilled plastic by `density` and `fill`, and `skipped` became a list of `{ body, reason }`), which differs from the exports and the print query on purpose, since those print; an unknown argument of a query, an export option or an operation is said with the arguments there are. Alternatives: an alias of check_interference to the query (the tool keeps its own checks and wording), mass of the printed bodies only (an assembly would lose its bought parts).
- **English texts of the server.** The descriptions of the tools, the notes and advice of their answers, the errors of the bridge and the log are English; the server recognises an internal tool an older app does not know by either text.
- **The bridge and the document.** When the bridge cannot listen, the server records why (port, code, message) and session_status says it with what to do. It tries the port again only when session_status is asked to (`openBridge: true`): the app connects to whichever server listens, so a server of another session that took the port by itself while the owner restarted theirs would take the owner's app, and the AI of that session would then change the owner's document (review; the first version tried at every tool call after 10 s). The first answer of a tool after the tools switched engines (the server's own to the app, back, or another connection of the app) carries a note that says so. The holder of the bridge in `main.ts` closes a bridge opened late at the end of the process. `new_document` replaces the document with an empty one by one batch of removals, so one undo step brings it back; a document with content is replaced only with `discard: true`, the answer says what was discarded, and the server forgets the file of the emptied document; on its own engine an undo that brings the document back brings the file back, and a redo forgets it again (in the app the file stays forgotten: the server cannot tell the app's document by identity). Alternatives: `load` of an empty document (clears the undo history), an engine command that empties the document (a new command for what removals already do).
- **Small things.** view_image takes `colors: "model"` (the colours of the body properties, the palette for a body without one, said in the legend; the palette then leaves out the colours the bodies have of their own by name, and the legend names the other drawn bodies of the same colour by name in `sharedWith`; a colour is named by its hue, saturation and lightness since 2026-11-26, after the nearest colour of the palette by RGB named a slate base, a blue arm and a teal forearm all "blue" on a model built over MCP). An edge was already taken in either order and stored canonically; this is now said and tested. get_model takes `features` (those alone, with their bodies). execute, preview and sketch_tool answer with the `facts` of the features whose result the command changed, at most 20: the evaluation before and after is compared (a result that is the same object is unchanged, otherwise the status and the facts), so a parameter that moves a revolve reports it and a rename reports nothing (review; the first version took the features whose object the command replaced).

Known limits: the app's drawing tools do not offer the rectangle by its centre, the sizes or several corners (MCP only); new_document keeps the settings of the document (no command changes them); the app may connect to 4517 only, so a server on another port works on its own document; in the app an undo after new_document does not bring the file back (save_document then needs a path); the rectangle refuses only by the kinds of the snaps, not by what holds the points: a size along a direction a curve of `first` holds already (`first` on a vertical line, `opposite` on a fixed point, `width`) still over-constrains the sketch (the solver reports it), and a refused combination whose points are free would have solved.

Reviews: two rounds of independent review. The first found the facts of the touched features, the comments a command lookup took from its group, the types it took from comments, the rectangle snapped with both sizes and the expressions of its sizes unchecked, the bridge that took the port by itself, and smaller things; the second found what the first fix of the rectangle still let through (a snap to a point with one size and both held, a snap to a curve with both sizes), a regression test of the facts that the old code passed too, the mechanism rules lost by removeJoint, types named in backticks in comments dropped from a lookup, `sharedWith` by exact colour rather than by name, the wording of the note after a switch, and the app's new_document erasing the server's record of its own emptied document. All are fixed.

## D74 The selection of the app for the AI

The owner works with the AI interactively: they select something in the browser and say "extend the selected line" or "delete the marked face", or click a spot and say "make the axis roughly here". The AI could not see what was selected. The design as implemented is in [architecture/ai.md](architecture/ai.md) (the operation) and [ui/model.md](ui/model.md) (the mark of the click).

- **An operation of the app.** `get_selection` is an entry of `HOST_OPERATIONS` (`packages/mcp/src/get-selection.ts`), so a tool of the server under its key, and the app gives its selection through one member of `AppHost`, `selection` (`SelectionCapability.selection()`); without a connected app it answers `notAvailable`, as `view_image` does, and an app without the member (an older one) too. Not a query: the selection is a state of the user interface, which neither the engine nor the document has.
- **The answer** is JSON in the shapes commands take, leaving out what is not there: `mode` (`model` with the feature the timeline is rolled back to and the type of a feature that waits for its plane, `sketch` with its ID and tool, or `form` with the type, the feature and whether it is edited); `feature` (selected on the timeline: ID, type, name); `pick` (selected in the view: a face as `{ body, face, planar }`, an edge as `{ body, edge, kind }`, a plane as its `PlaneRef`); `sketch` (the selected entities of the open sketch, each with its ID, kind and source: own, reference (projections, the origin and its axes) or derived (copies)); `click` and `pointer`. Numbers are rounded to six decimal places.
- **The click and the pointer.** `click` is the last click in the view, taken before the click acts (what it was on, not what it made) and kept as it was then: the point in model coordinates (where the ray met the face, the nearest point of the edge, the plane; in a sketch where it met the sketch plane), what the view picks there as a click selects (an edge before a face before a plane, by stable names; a face with its normal there, out of its body and turned by the pose), in a sketch also the coordinates in the sketch and the nearest entity (a point a drawing tool would snap to, else the nearer of a point and a curve within 20 pixels) with its distance, and, when the view drew the body hit moved by the pose, the joints of the pose (`pose`) with the point and the normal as modelled (`modelled`, by the inverse of the transform of the body), so the AI can build an axis or a sketch from them. The hit is asked as the click picked (no edges while a feature waits for its plane, faces only while the joint form picks one, what a form picks), so it is what the click selected; the pointer asks for an edge, a face or a plane. A hit on the body of the preview of a new feature's form is marked `preview`; once the form is closed, a hit the document then has loses the mark, one it does not have is stale (a feature being edited is in the document, so its hits are not marked). A click whose body, face, edge, plane, sketch or nearest entity is gone when the AI asks is reported `{ point, stale: true }` and its mark is removed. `pointer` is the same for where the pointer is now, computed when asked with the view as it stands, and only while the pointer is over the view: once the user types in a terminal, the last place it hovered is wherever the mouse left the canvas, so it is dropped on `pointerleave`.
- **The mark.** The click is marked in the view (`View.mark`: a small magenta square with a white rim, drawn over everything and kept across scenes), so the user sees what the AI gets. The next click moves it; a click that hits nothing outside a sketch removes it with the click; every Escape outside a field of the panel removes it, besides the step back it takes; a new or opened document (also one loaded by the AI, and the AI's `new_document`) removes it, and a load that fails puts it back. Recording a click changes nothing else a click does (selection, drawing tools, pickers): it reads the view before the click is handed on, and it calls no engine method that the click did not call already (the snapshots of the app tests gained only the lines of the mark; after the review a few marks moved from an edge to the face a form picks).
- **`at` and `after`.** Every operation took them on its path (5b). The selection exists only in the present state of the app, so an operation may now declare `presentOnly: true`: `hostOperations` leaves `at` and `after` out of its arguments, so they are neither in the input schema of its tool nor in describe_api, and `callHostOperation` refuses a call that gives either (`null` counts as not given) with `invalidArguments: <operation>: at: the operation answers about the app as it is now, so it takes no at and no after`, and runs it on the present state. The smallest change: one optional field of an operation, read in two places.
- **Where it computes.** Picking is the app's own (`App.pick`, `View.pickBody`, `View.ray`); what is computed of it (the point on an edge, the normal of a triangle, the nearest entity, the source of an entity) is plain geometry in `packages/app/src/selection.ts`, with no dependency on the renderer and tested on its own. The answer's types and the operation are in `packages/mcp`, shared by the server and the app. Nothing is stored in the document; no schema step.

Alternatives considered: the live pointer only (useless once the user types in a terminal: the pointer has left the view); an explicit key that marks a spot (one more thing to learn; a click is what the user does anyway, and a click that selects marks too); a click recorded after it acted (a click that drew a point would report the new point, and a click that entered a sketch would be read in the wrong mode); the hover of the model (`App.hover`, which follows only what the model mode picks and is empty in a sketch); the selection as a part of the document (it is no part of the model and would enter undo); a query of the engine (it has no selection and no renderer); `at` and `after` taken and ignored (the AI would think it asked about another state).

Known limits: the click in a form that picks regions of a sketch (it asks the app for no pick) is what the model picks (an edge, a face, a plane), not the region, so a click on a region far from the planes and bodies records nothing; a click that became stale keeps its mark until the AI reads the selection (the check runs then, not at every refresh); Escape in a field of the panel belongs to the field and leaves the mark; the point on an edge is taken from the edge as drawn without the cut of a section view, so a click near an edge whose nearer part is cut away may give a point on that part; the normal of a curved face is that of the triangle under the click.

Review: one independent full review found the click kept naming what an undo had taken away (now `stale`), its hit asked with every kind of pick while the click selected by the mode's (a face taken for a sketch reported as an edge), a posed point without the model's coordinates (now `modelled`; a plane no longer gets a pose note), the AI's `new_document` leaving the mark, Escape in a field said to remove it, a body hit dropped in a sketch seen edge-on, a preview body named as if the document had it (now `preview`), and a comment of the reach. All are fixed, with regressions in `packages/app/test/review.test.ts`. A light second round over the fix found that the form of a feature being edited marked its hits `preview` and that a preview hit turned stale after OK with the model rolled back; both are fixed with a regression. The mark of a stale click stays in the view until the AI asks (a known limit).

## D75 Constraints of two points, distances of two lines and of a line and a circle

Decided and implemented 2026-11-27, from two rows of the backlog that the conversion of the Onshape actuator (6h) had left: Onshape's horizontal of two points was written as a vertical distance of 0, its three distances of two lines as one `distancePointLine` that holds only while the lines stay parallel, and two midpoints of two points were lost. The design as implemented is in [architecture/document.md](architecture/document.md) (the types), [architecture/sketch.md](architecture/sketch.md) (the equations) and [architecture/ports.md](architecture/ports.md) (the translation).

- **`horizontalPoints`, `verticalPoints`** (`a`, `b`, points, unordered): the two points have one y, or one x. One equation each; the library's `horizontal_pp` and `vertical_pp`. They say what `verticalDistance` and `horizontalDistance` of 0 said, as a geometric constraint with no value to change by mistake (a probe of the converter had to know not to change that 0).
- **`midpointPoints`** (`point`, `a`, `b`; `a` and `b` unordered): the point lies halfway between `a` and `b`, with no line between them. Two equations; the library's symmetry of two points about a point (`p2p_symmetric_ppp`), as the midpoint of a line (D34). The three points differ (the catalog's rule of different operands), so a middle that is one of the two, which would be a coincidence, is refused. The fallbacks of D34 for a pair at one place hold for it too: `pairOf` of the adapter answers the pair of both kinds.
- **`distanceLineLine`** (`a`, `b`, lines, unordered; a dimension, non-negative): the two lines are parallel and their infinite lines lie `value` apart. It holds the lines parallel by itself, which is what the dimension means in Onshape and Fusion and what the converter could not write. Two equations (parallel; an end of one line at the distance from the other), so two primitives in the adapter, each left out on its own as the two coordinates of `fixed` are: a `parallel` of the same lines beside it is redundant once, not a conflict. At 0 the second primitive is "the point on the line" (`point_on_line_pl`), since the library's unsigned distance has a kink there; the two lines then lie on one line. The side is the one the lines were drawn on: the distance is unsigned in the library, and the analysis takes the sign from the solved state, as `distancePointLine` does.
- **Which end is measured** (`measuredEnd` of the adapter, after the review). Of parallel lines every end of one is as far from the other, so the choice changes no meaning, only whether the library gets there from a freehand estimate: a fixed end measured to a free line makes that line turn and move at once, and with an axis of the origin named first a line drawn 45° off failed. The adapter takes an end that is not fixed before a fixed one, in the order `a.a`, `a.b`, `b.a`, `b.b`; a solve that still fails without a conflict is tried once more with the distance measured from the other line, by both algorithms. A second try that got there by shrinking one of the two lines to a point (below 1e-6 of its length in the input) is not taken: without a direction a line is parallel to anything, and a conflict found from that state named constraints that had nothing to do with it (second review). The order of the operands therefore does not decide the result, as the catalog's `unordered` promises. Two lines with a common end (one point, by its ID) that are parallel lie on one line already, so at 0 the second primitive is left out (the library called the constraint redundant); at another value there is no solution, and the distance is measured from the common end itself, so that the library names the constraint as the conflict in its first pass.
- **`distanceLineCircle`** (`line`, `curve`: a circle or an arc; a dimension, positive): the gap between the infinite line and the rim, the distance of the centre from the line less the radius. One equation; the library's `c2ldistance`, which takes an arc as its whole circle (measured by a spike before the design). The circle stays on one side of the line, the side of its centre; one drawn across the line is moved off it. A gap of 0 is refused (`the value must be positive`): it is a tangency, and where the line ends on the circle a tangency needs its own forms (D52), without which the solver and the diagnosis called the constraint redundant (review). The constraint for touching is `tangent`. The distance to the centre needed no new kind: it is `distancePointLine` with the centre.
- **An axis of the origin** may be the line of both dimensions (a wall from the X axis); `midpoint` and `equalLength` stay the only kinds that refuse one (D71).
- **A reference dimension** of the two is measured by the engine (D17): of two lines from the point `a` of the line `a` to the line `b` (of an axis the origin), also when they are not parallel; of a line and a circle the distance of the centre less the radius, which is negative while the circle crosses the line.
- **A cut** (D65) keeps both on the keeper, as any constraint of the infinite line; nothing was added for them.
- **The app.** The three geometric kinds are buttons of the sketch bar by the catalog, with no code of their own; of three selected points the first one selected is the middle. The dimension of two lines is their distance when they are parallel within the angle tolerance of the engine (1e-4 rad) and the angle otherwise (before, parallel lines got an angle of 0 or π); a line with a circle or an arc gets the gap, unless the circle touches or crosses the line (there is no gap to dimension). Two lines on one line get exactly 0. MCP took the five kinds with no change (`describe_api` and the test that sends every example of the catalog to the engine).
- **The converter of Onshape** (`tools/onshape/`, 2026-11-27, [onshape-import.md](onshape-import.md)). Horizontal and vertical of two points are written as `horizontalPoints` and `verticalPoints` (the mark that kept the probes from the distance of 0 is gone with it). The midpoint of two points is written as `midpointPoints`, with an external middle or end fitted by its place (the mean of the ends, the image of the other end, the one pair of candidates about the middle). The distance of two lines stays one `distancePointLine` where other constraints hold the pair parallel, because `distanceLineLine` beside them would make a redundant set, the thing the sketches of 6h could not always follow (its three hexagons are held by the spokes of their patterns); a pair that parts in the sketch's probe gets `distanceLineLine` in place of the distance of a point, where it got `parallel` beside it, and the probe is asked again before the next pair. One full review of the converter's change found that every pair that parted in the one probe was swapped, also a pair the swap before it held already (a redundant set in a driving dimension, which nothing removes as implied), and that the origin as one end of a midpoint was not known when the other end was fitted, so that another pair of candidates could be taken; both fixed with regressions, with a label of the report and a tolerance. Fixtures only: the dump of the model was not at hand, so the measured tables of the conversion are those of the run before.
- **No schema step.** A document with one of the kinds is refused by an older build by name (`unknown constraint "distanceLineLine"`), not read without it.
- **Names.** `distanceLineLine` and `distanceLineCircle` follow `distancePointLine`; the kinds of points carry `Points` because `horizontal`, `vertical` and `midpoint` name a line and one type of the catalog has one set of operands.

Alternatives considered: `horizontal` and `vertical` taking either a line or two points (one type would have two sets of operands; the catalog, the validation, the duplicates and the app's offer all read one); the distance of two lines as one equation that leaves the parallelism to another constraint (it is `distancePointLine`, which the converter wrote, and it means nothing once the lines turn); the distance of two lines as two distances of the ends of one line from the other (unsigned, so the two ends may land on opposite sides and the lines cross); the gap of a line and a circle signed or with the line allowed inside the circle (the library has only the outer form; inside, the nearest point of the rim is another one); a gap of 0 translated and analysed as a `tangent` (two kinds for one constraint, with every form of D52 to keep in step; the refusal says which kind to use).

Known limits: from a freehand estimate a contradiction with `distanceLineLine` (another distance of the same lines, a perpendicular) is a failed solve with no constraint named, as with a `parallel` and a `distancePointLine` written apart: the library finds dependent rows only where they are dependent in the estimate. Added to a solved sketch, which is how a user meets it, the conflict names the constraints. Two lines joined by a `coincident` constraint (two points, not one) are not seen as having a common end: at 0 the solver's list `redundant` then names the distance, while the diagnosis, which the app and MCP read, does not. The converter of Onshape writes the new kinds (below) but was not run on the actuator again; the run is a row of the backlog.

Review: one independent full review found three defects and three smaller ones, all fixed with regressions (the blocks "findings of the review of D75" in the tests of the adapter and of the app, and in `constraints.test.ts`). A gap of 0 of `distanceLineCircle` was a tangency without the forms of D52 (now refused). The order of the operands of `distanceLineLine` decided whether a freehand sketch was solved (now `measuredEnd` and the second try). The app measured the distance from the drawn end of an axis of the origin, a million millimetres away, and offered 40 for a line 10 from the axis and 5e-5 rad off it (now from the origin). Smaller: two lines with a common end at 0 were called redundant by the solver; the app offered 1e-15 in place of 0 for two lines on one line, and no dimension for a circle a rounding error across the line; a test named a step it did not have. A light second round over the fix found two things in the new choice of the end, both fixed with regressions: of two lines with a common end at a distance other than 0 the conflict named another constraint (the far end was measured and a line shrank to a point; now the common end is measured and the conflict is the distance), and the second try was taken also when it had shrunk a line to a point, so a contradiction from a freehand estimate became a conflict with names from that state (now it stays a failed solve, as before the fix). No third round: the second fix is twenty lines in one function of the adapter.

Verification: `packages/scenarios/test/analysis.test.ts` (the equations of every kind against the solver, the count of degrees of freedom), `packages/solver-planegcs/test/solver.test.ts` (sides, 0, a parallel beside the distance, drags, a pair at one place, an arc, fixed lines, errors of the input), `packages/engine/test/document.test.ts` (operands, values, duplicates, the axes of the origin), `packages/engine/test/sketch-cut.test.ts` (a split), `packages/app/test/sketch-tools.test.ts` (the offers and the measures) and `packages/scenarios/test/constraints.test.ts` (a plate whose holes keep a wall from its edges and whose slot is drawn by distances of lines: parameters, reference dimensions, conflicts by ID, drags, save and load).

## Spikes 2026-11-13

Both libraries met the assumptions of the design; the detailed results are in architecture.md. Three findings changed the design:

- **D19 reworked.** On tilted faces it is not enough to shift the start cap. The side faces and the end cap of the tool have the same problem when they lie in the plane of a face of the body. The solution moved into the kernel adapter, see D19.
- **D20 closed.** Manifold works only with float32, so `Solid` does too.
- **D17 extended.** planegcs does not handle reference dimensions reliably; the engine computes them.

## Open questions

None.

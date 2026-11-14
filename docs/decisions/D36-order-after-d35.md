# D36 Order of work after D35

Approved by the owner on 2026-11-14 and extended the same day, with the owner's consent, by what a comparison with Onshape, FreeCAD and Fusion found missing (backlog.md, "Compared with Onshape, FreeCAD and Fusion") and by helix and modelled threads. It decides the order only. What each feature looks like is a proposal in [backlog.md](../backlog.md), part "Direction after D35"; a step gets its own decision, with the design, when its work starts.

**Intended use (owner).** Design for a 3D printer and tinkering. Brackets and boxes are the base; most parts will be for a robotic arm and similar mechanisms. Models are mostly built together with an AI through MCP, not drawn by hand.

**What decides the order.** With an AI as the author, comfort of manual drawing matters less. The limits are that the AI does not see the model, cannot tell whether a part prints and fits, and that an arm is built around bought parts and has to move without colliding.

| Step | Content | Why here |
|---|---|---|
| 1. The AI sees and measures | View image and section (the query for the AI and the section view in the app), measuring between two named entities (distance, angle, distance of axes), smallest gap between bodies, mass properties, print queries | Only queries over finished bodies; the document does not change. Everything later is checked with them |
| 2. Bracket and box | Profile offset, a wall from a line (thin extrusion, rib), taper on extrusion, hole feature with a hardware catalog, fillet of a sketch corner with the command that re-points an end of a curve, linear pattern and mirror of features and bodies, extent up to a planar face, 3MF export, export of an outline (planar face or section) as DXF and SVG | The base of every printed part. Offset comes before taper and taper before the hole feature |
| 3. Around bought parts | Body properties (density, reference flag) with a catalog of materials, import of a mesh as a reference body, inserting another document as a part, boolean of bodies (union, difference, intersection), subtracting a body with a clearance, splitting a body by a plane, parts list | An arm is designed around motors, bearings and boards |
| 4. Beyond prisms | Revolve, then chamfer and fillet of straight and circular edges | The edges need the tool of the revolve and a spike first |
| 5. Mechanism | Mechanism description (links and joints), pose and sweep, export of URDF and MJCF, a plane tilted about a line and a midplane of two faces, further generators, profile shift of the gear | Needs mass properties (step 1) and body properties (step 3) |
| 6. Sketch | Derived geometry in a sketch and what stands on it (projection from another sketch, mirror and pattern in a sketch, gear as a block, import of an outline), splines, trim and extend | Serves mostly drawing by hand |
| 7. Last | A tube along a path through points, twist on extrusion with helix and modelled threads, names of reference dimensions in expressions | Least use with an AI as the author. Threads need a spike of the kernel with a tool of tens of thousands of triangles |

**Not done at all:** an assembly with mates and a spatial solver (the mechanism description of step 5 takes its place), 3D sketches with constraints (the path of step 7 takes their place), fillets of general edges, USD export, collaboration, exact geometry.

**Organisation of the work.** Agreed with the owner on 2026-11-14; the working plan is [d36/README.md](../d36/README.md).

- **A preparatory step comes first** (like step 0 of D35, no change of behaviour): it turns the places every package would write to into places where things are only added. The owner approved its six parts: a registry of queries, a module per feature type, panels and forms of the app as modules, a shared vocabulary settled before the contracts, documents by area, and a description of working in several trees ([d36/00-prep/design.md](../d36/00-prep/design.md)).
- **The steps are cut into work packages.** The order of the steps above stays the priority; the packages form tracks that mostly do not depend on each other, so several can run at once. The map of dependencies and of shared places is in the plan.
- **Design before code, as with the D35 contract.** A package gets `design.md` (architecture, decisions, rejected alternatives), `contract.ts` (public types and signatures, type-checked) and `calls.ts` (a scenario written as calls, later a real test), then an independent review, then the implementation by the procedure of CLAUDE.md.
- **Files.** `docs/decisions.md` keeps the overview table and the short decisions. A decision longer than about a hundred lines has its own file in `docs/decisions/`. The design of a package is its record of decision and lives with the package in `docs/d36/`. D35 moves to `docs/decisions/` when its point 7 is closed; until then another session edits it in place.

**Reachable through MCP.** The rule of D35 (requirements.md: every function is to be available from the app and through MCP) holds for every step here; with an AI as the main author it is the more important half. How far it is guaranteed today, checked against the code on 2026-11-14:

- **Changes of the document are covered by construction.** `execute` and `preview` take any `Command`, and `describe_api` is generated from the engine: the command and document types from `types.ts`, feature types and their numeric fields from the registry, constraints and generators from their catalogs. A new feature type, field, constraint or generator needs no change in the server. Tests check that the catalogs are complete and that their examples are accepted.
- **Queries are not.** Every method of `Engine` has a tool today (`get_model`, `get_sketch`, `explain_constraint`, `check_interference`, `export_stl`), but each was written by hand and nothing fails when a new query gets no tool. Step 1 is all queries. Guard, agreed by the owner and added on 2026-11-14 (`packages/mcp/test/coverage.test.ts`): a table typed over the methods of `Engine` names the tools that reach each one. A method added to `Engine` without an entry does not compile, and the test calls every named tool through the server and fails when the engine method was not reached. `subscribe` is the only method marked as internal. The guard covers methods of `Engine` only; a query added as a function exported next to it is not caught.
- **Logic that lives in the app is not.** The rule is that the app only composes commands and shows state; anything that computes belongs to the engine or to a shared module. The drawing tools are the known exception, which D35 point 7 removes (shared sketch tools, MCP `sketch_tool`).

Places in the steps above where reaching the function through MCP needs a deliberate design and does not follow from the above:

- View image (step 1): it comes from the viewport of a connected app. Over a document from a file there is no renderer, so it needs a rasteriser of its own or is unavailable in that mode.
- Catalogs of hardware, materials and threads (steps 2, 3, 7): they have to be part of `describe_api` or a query, otherwise the AI falls back to dimensions from memory.
- Exports (steps 2 and 5): the tool is called `export_stl`. 3MF, DXF, SVG, URDF and MJCF need one export tool with a format, and the robot description writes several files.
- Import of a mesh and inserting a document (step 3): the data cannot travel inside a command through MCP, a mesh is far too large for a tool call. The tool has to take a path that the server or the app reads.
- Section, measurement and print queries (step 1): the answer has to stay small enough to read: loops as numbers with a limit, names of faces instead of triangles.

**Considered.**

- The sketch before the mechanism. It would be the right order for drawing by hand; the owner works mostly through an AI.
- Projection from another sketch first, as the table of candidates in backlog.md had it for general use. Moved to step 6: an AI repeats the same expressions in several sketches cheaply.

**Open: the optional second milestone of D35.** D35 leaves the physical prototype of the joint (scenario 10, not written) to be decided after scenario 9; where it stands relative to the steps here is not decided either (question of the owner, 2026-11-14). It is a design task and nothing in it is blocked by step 1: clearances can be built in by expressions and guarded by checks, a distance between two bodies can be read from a reference dimension between projected edges or from the bounds of the bodies, kept-free space can be a reference body in the interference query, the owner looks at the model in the app (hiding bodies instead of a section) and overhangs show in the slicer. What is missing without step 1 is a direct answer to "how large is this gap", which is most of what the prototype is about, and any view of the model for the AI. Claude's recommendation: if the prototype is done, do the measuring part of step 1 first (smallest gap, measuring between two entities, section) and use the prototype as the validation scenario of step 1.

**Open.** Each step should get a validation scenario like scenario 9 (a box with a lid and screw posts for step 2; a link between two joints for steps 3 and 5); they are not written yet. A converter library for reading STEP into a mesh (step 3) would be a new third-party library and needs the owner's approval (D2); none has been chosen.

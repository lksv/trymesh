# Groundwork for further features

A working document. It collects features that are not being done yet, and for each one says what it builds on and why the current design does not prevent it. It is neither a plan nor a decision: what gets decided moves to [requirements.md](requirements.md) and [decisions.md](decisions.md). A short list of future functions is in requirements.md; here is the analysis.

Last change: 2026-11-28

Rewritten on 2026-11-28: what was implemented since 2026-11-14 is taken out and listed at the end with its decision, and what is open is sorted by area. The open rows are carried over word for word, but for a reference to a row that is no longer its neighbour. The designs of D36 quote rows and parts of the version before ("Candidates", "Direction after D35", "Print queries and the features of step 2 in detail"); that version is in git, last at the commit `a2e4205`.

## How to read it

- **Intended use (owner, 2026-11-14).** Design for a 3D printer and tinkering. Brackets and boxes are the base; most parts are for a robotic arm and similar mechanisms. Models are mostly not drawn by hand: they are built together with an AI through MCP. So feedback on the shape for the AI, and a model that cannot go wrong without a word, weigh more than the comfort of drawing by hand.
- **The rule that sorts a feature** (from D35): would it later change the shape of the document or of the commands? What would was done at once (the seven points of D35). What would not can be added later as a new entry, a new type or a new variant, and is here.
- **The order.** "First" holds the five features the owner considers for the front (2026-11-28), with what a check against the code said. "Next" holds what sessions with real models met, marked `medium, next` by the owner. The areas after them are not ordered.
- **What a row promises.** A row was assessed by reading the code and the types of the libraries unless it says "measured" or names a spike. Each gets its own decision and design when its work starts.

## First: five features assessed on 2026-11-28

The owner considers these for the front of the list. Each was checked against the code on 2026-11-28 by reading it; nothing was run, so each starts with a spike or a design. "Clean" means two things here: the feature fits the architecture without a special case, and it has no result that is wrong without a word. What it cannot do, it refuses with the faces or the curves named.

| Feature | Verdict | Size | What it stands on | Starts with |
|---|---|---|---|---|
| Shell | Realistic for a body whose faces have exact surfaces. It refuses a class of bodies a user will meet (below) | Medium to large, about the clearance half of 3d | The moved body of D56 (`recompute/moved-body.ts`) | A spike: the move inwards on real bodies |
| Sweep of a profile along a path | Realistic along the lines and arcs of a sketch. A loft is not | Medium, about 4a | The tools of the prism and of the revolve | A design |
| Text | Realistic. Not parametric in the cheap variant. The solution and a shipped font agreed by the owner, 2026-11-28 | Medium, in two parts | The outline entry of D72 and the spline of D70 | The profile of a whole entry, then the reader and the choice of the font |
| Move and scale of a body (a copy is there) | A move is realistic and small, a uniform scale too. A scale per axis belongs to an export only | Small | `transformSolid` and `transformFace` of `solid.ts`, the placement of D55 | A design of a page |
| Assembly | By frames and joints in a tree: realistic, and most of it is there (D62, D49). Mates solved together: not realistic | Four steps, three small and one medium (owner, 2026-11-28: all four) | The insertion of D62, the mechanism of D49 | The own frame of a placement |

### Shell

Hollowing a body to a wall thickness with chosen faces left open. All four tools compared have it; the comparison of 2026-11-14 called it "not proposed" because on a mesh it is a spatial offset. D56 changed that: a body can be moved along its own surfaces.

**How.** A feature type `shell` with a body, a thickness and the faces left open. The cavity is the body with every face moved inwards by the thickness, cut out of the body by one difference; a face left open is moved outwards instead, so that the cut passes through it. The move is the rule of D56 turned round: a plane moves along its normal, a cylinder, a cone, a sphere and a torus change a radius, a swept side moves triangle by triangle, and a vertex goes to where the moved surfaces of its faces meet. Every face maps to one face of the same kind, so the faces of the cavity have exact surfaces and take the name of the face they came from with the tag of the shell, as the pocket of a combine with a clearance does. The boolean is the easy case for the kernel adapter: the cavity lies inside the body and crosses only the open faces, nothing is flush.

**What is new in the code.** An amount per face where D56 has one clearance, and the direction inwards with its checks: those of D56 are written for a tool that grows (a hole that closes), inwards it is a part that vanishes. `moved-body.ts` has 800 lines and took three rounds of review, so this is a package with a full review and a fuzz, not an option of a field.

**What it refuses**, each with the faces named, by the rule of D44 and D56 that the topology does not change:

- an outer round whose radius is not larger than the wall (a box with fillets of 1 and a wall of 2): the exact cavity has a sharp corner there, so a face would vanish. The narrow variant of D44 ("corner arcs that drop out", under "Profiles and regions") is the same case in a plane;
- a part of the body thinner than twice the wall (a rib, a post, a pin);
- a body with a face of the kind `general`: an imported mesh, the flanks of a modelled thread;
- a vertex where more than three faces meet in a way their moved surfaces do not (the apex of a pyramid).

So a shell comes early on the timeline, and ribs, posts, small fillets and threads after it. Other CAD tools give the same advice; there the order is a nuisance, here it is a refusal.

**How exact.** At a concave edge of the body the cavity has a sharp corner where the exact offset is round, so the wall is thicker there (up to 1.41 times): the safe side. On a round face the wall may be thinner by the chord tolerance, and next to an edge where a round face meets another at a slant by up to 15 % (`ROUND_ALLOWANCE` of D56).

**Rejected.** The sum of Minkowski of the library: 1 to 17 s for the motor, the gear, the carrier and the housing of D56 ("Measured", A; a body of a few dozen triangles takes milliseconds), and one face without a description, so nothing could stand on the cavity.

**To verify by the spike.** The move inwards on a box with rounded corners, a tapered box, a revolved cup and a body with holes and counterbores: how often it is refused, and what the checks have to become.

### Sweep of a profile along a path

The lip and the gasket groove of a box, a handle, a rail, the `sweep_rounded` of the Gridfinity baseplate (replaced there by tapered extrusions stacked on each other, which is exact only while the profile is made of straight pieces). The thread of D76 does not serve as its base: its tool is a mesh made for a helix (a graph over the angle and the height). The base is the revolve.

**How.** A feature type with a profile (regions of a sketch) and a path: a chain of own lines and arcs of another sketch, as the profile source `wall` names a chain. The plane of the profile is perpendicular to the path at its start. Along a line the tool is the prism of the profile; along an arc it is a part of the revolve of the profile about the axis of the arc (through its centre, along the normal of the sketch of the path), which lies in the plane the profile has there. The tool is built as one mesh, ring by ring, so no two pieces are joined flush. A closed path gives a ring without caps.

**Why it is clean.** Every face of the tool has a surface the engine knows: by the rules of the extrusion along a line (a plane, a cylinder) and of the revolve along an arc (a plane, a cylinder, a cone, a sphere, a torus). So a sketch on a face, a chamfer and a fillet, the measure, the clearance and the shell work on a swept body as on any other. A face is named by the curve of the profile and the curve of the path, which is a new role in `FACE_ROLES`.

**What it refuses:**

- a bend whose radius is not larger than the reach of the profile towards its centre (the profile would cross the axis; the revolve refuses the same);
- a corner of the path that is not tangent. The cheap variant refuses it with the advice to round it by the sketch tool `fillet`; a mitre of two lines can come later;
- a path that comes back to itself so that the tool would cross itself. This needs a check of its own (triangles of pieces that are not neighbours), and it is the one place where a wrong body could come out without it;
- a profile whose plane is not perpendicular to the start of the path.

**Later stages.** A path through points in space with a corner radius (the tube of step 7 of D36, the cheap replacement of a 3D sketch: a cable channel through a link): the same two pieces with the bends each in its own plane. A path with a spline: its faces are of a general kind. Not proposed: a twist along the path, a guide rail.

**A loft is not clean.** A transition between two profiles needs a correspondence of their vertices; for two arbitrary profiles that is a heuristic, which is the kind of surprise this list is to keep out. Only a ruled surface between two profiles with the same curves in the same order (what the taper builds between a profile and its offset) would be clean, and no part has asked for it.

### Text

A label, a part number, a version mark, raised or engraved: common on printed parts, and all four tools compared have it.

**What works today.** Text turned into paths in a drawing program, saved as SVG and read by `import_outline` (D72). No code is needed for that, only a line in the description for the AI.

**How.** Text is an outline made from a string. A reader of TrueType fonts beside the readers of DXF and SVG (`packages/engine/src/import/`, hand-written like them): the tables of the glyph outlines and of the character map, composite glyphs (the accented letters are composites), no kerning. The quadratic curves of a glyph are cubic splines of D70 exactly. A tool like `import_outline` takes the string, the font and a height and writes a `SketchOutline` entry; the engine and the document do not change. The alternative of a font of single strokes drawn by us was rejected: strokes that cross have to be united in the plane, and the engine has no boolean in a plane.

**What it needs first.** A profile that names all the regions of an entry (the rows "A profile of every copy of an entry" and "A region with its islands" below). Without it an extrusion lists the region of every letter, and a changed text leaves broken references.

**Limits of the cheap variant:**

- the text is not parametric: the document stores curves, a changed string is the tool run again, and a text cannot follow the value of a parameter. The full variant stores the font in the document, as a mesh is stored, and computes the entry in the recompute;
- an outline holds at most 2000 curves and 2000 control points (D72), which is some tens of characters; a longer text is several entries;
- fonts with outlines of the other kind (CFF, most `.otf`) are refused;
- a profile with a spline takes no taper and no offset (D70), so letters have no draft;
- no text on a round face.

**Decided by the owner (2026-11-28).** The solution above is agreed, with a default font shipped with the tool: a file of a third party with a licence, approved as a library is and recorded in D2. Which font is chosen when the work starts (its licence has to allow shipping it; the choice, the version and the licence go to D2). A font of the user's own stays possible: the server reads a font file by its path and the app takes one from the user.

### Move, copy and scale of a body

**A copy is there**: a pattern of a body (linear, circular, a mirror) makes the bodies `<pattern>/<number>`, with the faces tagged and their surfaces moved.

**A move** is small. `transformSolid` and `transformFace` do for a pattern what a move needs. A feature type that moves bodies in place: the body keeps its ID and its faces keep their names, so nothing after it is renamed. The transform is written as a placement is (D55): a frame on the body laid on a frame of the model, three offsets and three turns, each a numeric field. What a user has to know: a sketch or a plane made before the move stays where it was, as in Fusion; and a move is not a pose, a joint is (D49). To settle in the design: a face name that lies on two bodies (a pocket without a clearance and its kept tool) when one of the two moves.

**A uniform scale** is small too: every kind of surface survives it, with its radii multiplied, once `transformFace` takes a similarity. A thread on the body stops being the thread of its catalog, which is a warning. A mesh in other units needs no scale: the import of STL takes a unit.

**A scale per axis is not clean as a feature.** A cylinder stops being a cylinder, the round faces fall to the kind `general`, and a hole can then be neither projected, nor chamfered, nor threaded. Its real use, the compensation of shrinkage, is an option of the exports `stl` and `3mf` that scales the mesh on its way out and leaves the model alone.

### Assembly

**Mates are not named groups.** A mate is a relation between the geometry of two parts (this face on that face, this axis on that axis) from which the tool computes where the parts stand. In SolidWorks, Fusion and FreeCAD a part is held by several mates that a spatial solver solves together. In Onshape a mate lays one frame of a part on one frame of another and names the motion left (fastened, revolute, slider).

**Named groups are there**: a link of the mechanism (D49) is a named list of bodies that move as one piece; joints (revolute, continuous, prismatic, fixed) hang the links in a tree; a pose is computed by composing transforms, with no solving; the collisions, the gap and the exports URDF and MJCF read it.

**Parts drawn each in its own document and put together in another are there too** (D62): the feature `insert` places the bodies of another document by a frame of the host (a base plane, a plane, a planar face of a body, a sketch point) with offsets and turns, sets its parameters per insertion, and keeps the names and the exact surfaces of its faces, so the host can sketch on an inserted part, project its edges, cut it and hang it in a link. The same document inserted twice is one row of the parts list. The app has the form and reads the file; the server has the tool `insert_document`.

**What is missing: four steps (owner, 2026-11-28: all four belong to this item).** Steps 1 and 2 follow each other; 3 and 4 stand alone and can come in any order. None of them needs a solver.

#### 1. The own frame of a placement

*Today.* An inserted part is placed by its origin and its base axes (`BodyPlacement`: a frame of the host, three offsets, three turns). A part that is to sit with its bore on a shaft has to be modelled with its origin in the bore, and a part with two places to hold it by has one origin.

*How.* An optional field of the placement of an insertion that names a frame inside the inserted document, by the IDs it has there: a `FrameRef` as the host's frame is one (a base plane, a plane feature, a planar face of a body, a sketch point). The placement then reads "this frame of the part on that frame of the host, then the offsets and the turns". Absent, it is the origin, as today, so no stored insertion changes. The recompute of the inserted document has every such frame at hand (`InsertedRecompute.state`: its planes, sketches and faces), and the transform is one more factor in `placementTransform`. This is the fastened mate of Onshape, computed and not solved.

*What a user has to know.*

- The frame of a face has its normal out of the body, so two faces laid on each other need one frame turned over. That is an explicit flag (or `rx: pi`), never a guess: a mate that flips by itself is the failure of the solved mates this stands in place of.
- The X of the frame of a face is the one a sketch on that face has and may run against an axis of the model (D18). The turn about the normal (`rz`) sets the part right, and the facts of the feature say where it ended, as today.
- A bore on a shaft is a sketch point on both sides (the centre of the circle the bore was made from); a frame "on the axis of a round face, at a planar face" would be a kind of `FrameRef` of its own, later.
- A mesh feature does not get the field: an imported mesh has one face without a description and nothing to name.

*What can break.* A revision of the part that no longer has the face or the point of the own frame gives `brokenReference` of the insertion, as a lost frame of the host does.

*Size.* Small to medium, with a full review (it places bodies). To check in the design: whether an older build refuses the new field or drops it without a word, which decides about a step of `UPGRADES`. The move of a body under "First" takes the same pair of frames.

#### 2. A mate as a tool

*How.* One call that makes what a mate of Onshape makes, as a batch of commands the engine has: `addFeature` of the insertion with its two frames, `setLink` with its bodies, and `setJoint` about the axis the part was placed on. It lives in a shared module, so the app and the server run the same code, as they run the sketch tools. A batch is atomic and one step of undo.

*What maps.* Fastened: the bodies go into the link of the part they sit on, or a `fixed` joint. Revolute: a `revolute` or a `continuous` joint about the normal of the frame. Slider: a `prismatic` joint along it. The other mates of Onshape (cylindrical, planar, ball) have no joint kind in D49 and are left out.

*Limits.*

- There is no mate in the document afterwards: an insertion, a link and a joint, each edited by itself. Changing a mate is the tool run again over the three, or three edits.
- The axis of a joint is an `AxisRef`: the normal of a sketch plane through a sketch point, a sketch line, or the axis of a round face. A frame that is a planar face gives no such axis today, so either the tool takes only frames that are sketch points and round faces, or `AxisRef` gets a kind for the normal of a frame. For the design.

*Size.* Small, after step 1; a light review.

#### 3. The mechanism of an inserted document

*Today.* Only bodies come in ("its mechanism is not read", D62). A gripper kept in its own document with its fingers on joints is rigid in the arm, and its links and joints are declared again in the host, body by body.

*How.* The links and the joints of the stored document come into the result of the mechanism of the host under prefixed IDs (`gripper/finger_l`), with their bodies prefixed and their axes carried by the placement. A joint of the host may name a prefixed link as its parent or its child (the wrist: parent `forearm`, child `gripper/palm`); a root link of the insertion that no joint of the host names stays where the insertion is placed. Two insertions of one document are two sets of links. The values of the inner joints need no new field: they are fields of the stored document with expressions over its parameters, and an insertion sets those per insertion already (`parameters: { grip: "q_grip" }`).

*What a user has to know.*

- A part meant as a sub-assembly gives its joint values as parameters; an inner joint whose value is a bare number stands at that value in every host.
- A body stays in at most one link: a link of the host cannot list a body that a link of the insertion holds. Whether the host may take an inserted link apart is for the design; the proposal is that it may not.
- Closed loops stay out, as in the host.

*To verify before the design.*

- A value of an insertion's parameter is part of the environment its recompute is kept by, so a pose stepped through a parameter would recompute the inserted document each time (158 ms for the arm of D62's "Measured", seconds for a document of gears). The environment has to leave out what only the mechanism reads, or the pose of an insertion needs a way of its own.
- The names of links and joints with a slash in the exports URDF and MJCF, and in the files of the meshes.
- Whether a joint of the host that names a prefixed link is refused or dropped by an older build (a step of `UPGRADES`).

*Size.* Medium: the validation of the mechanism, its result, the posed queries and the two exports; a design of its own and a full review.

#### 4. Refresh from the file

*Today.* A stored document is a copy inside the host on purpose (a host is one file that opens anywhere) and changes only by `replaceDocument`: `insert_document` with `replace` for one document on the server, "replace from a file" in the model panel of the app. A part corrected in its own file is brought in by hand, one by one, and nothing says which copies are stale.

*How.* One operation that goes through the stored documents, finds the file of each and replaces those whose file changed.

- Finding the file without a change of the document: by the name of the stored document, which is the name of the file it came from, in a folder the caller gives (the folder of the host by default). A path kept in the entry would be a new field of `StoredDocument`, which is strict, and a path that holds on one machine only; not proposed.
- Comparing after the upgrade: the stored copy is the upgraded document, so a file of an older schema is upgraded before it is compared, or every old file would count as changed.
- Showing before doing: a revision can break references (a face, a parameter or a listed body it no longer has). The operation first answers per stored document with unchanged, changed or no file, and for the changed ones with the issues the host would have after the replacement (a preview). The replacements then go in one batch: atomic, one step of undo.

*Limits.* A stored document that itself holds stored documents is refreshed from its own file only; what is inside that file is refreshed there. The app runs in a browser and cannot read a path: the user picks the files or the folder, and they are matched by name the same way.

*Size.* Small: a tool of the server and a button of the app over commands that are there; a light review.

**Not realistic.** Several partial mates solved together, and closed loops (a four-bar linkage, a parallel gripper): both need a spatial constraint solver, there is none in the project, and its failures are of the kind a user does not understand (a mate that flips, an over-constrained set with no hint which mate is to blame). For a planar loop there is a way today, the row "Closed loops of a mechanism" below.

## Next: what sessions with real models met

Marked `medium, next` by the owner. Most of them are places where a model goes wrong without a word.

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| All the bodies of a pattern as the tools of a combine (from rebuilding the Gridfinity bin of OpenSCAD through MCP, 2026-11-26; medium, next) | **Why we want it:** a count of copies is a parameter of most parametric parts: the compartments of a bin (`divx`), the cutouts of a grid, the posts of a frame. When the copies are tools of a boolean, `combine` lists them one by one (`cutter`, `cutters/1`, `cutters/2`). A count that goes up leaves the new copy in the model as a separate solid, **with no warning**, so it is exported, printed and counted in the parts list and the mass as a part of its own. A count that goes down makes the whole combine fail with `brokenReference`, so every tool stays as a body. **How it helps:** a part with a variable number of pockets or joined pieces stays right for any count. This is the most common construction of OpenSCAD projects, a `for` inside a `difference()`, so it also makes them straightforward to convert | A body reference that names a pattern of bodies and stands for its source body and all its copies, expanded at the recompute in their order (the same idea as the row "A profile of every copy of an entry"). It touches the validator, the references of the registry, the app's form and the description for the AI. A warning for a copy that no later feature uses is a cheaper half of it. Needs a design and a design review |
| A chamfer at the mouth of a hole (same session; medium, next) | **Why we want it:** the rim of nearly every printed or drilled hole is broken: a magnet hole is chamfered so the magnet goes in, a screw hole against the elephant's foot, a bore deburred. Today the chamfer is a feature of its own that names the rim edge of each copy, so a pattern of features cannot take it along, and a change of the grid leaves the new holes without it, **with no warning** (16 of the 24 Gridfinity holes). **How it helps:** the chamfer is a size of the hole, so it goes into every copy at every count, in one call, and a hole from the hardware catalog can carry it | An optional numeric field of the shapes `plain` and `counterbore` (and of the bore of `countersink`): a cone at the mouth of the tool, like the head of a countersink. The faces get a role of their own; no change of the other shapes. A geometry change of the tool, so a full review |
| A region of a sketch survives a faulty loop elsewhere in the sketch (same session; medium, next) | **Why we want it:** one sketch often holds several unrelated profiles (the scoop and the label tab of a bin, both cut across the compartment). When one of them degenerates at some value of a parameter (a scoop of radius 0), the whole profile of the sketch is invalid and **every** feature that uses the sketch fails, including the unrelated one. **How it helps:** a failure stays where it is: the user, or the AI stepping a parameter, sees the one feature whose shape is truly broken, and a model with an option switched off by a size of 0 keeps the rest | The regions are found per connected set of curves; a set that does not make valid loops makes only the regions that hold its curves invalid. Needs a look at what the validity check of a sketch covers today and what `sketchRegions` reports |
| A warning when an added extrusion is not joined to its target (same session; medium, next) | **Why we want it:** an `add` that misses its target (a foot drawn a millimetre off, a boss on the wrong side) makes one body of two separate pieces, and nothing says so; it shows only later as a strange mass or a part that falls apart in the slicer. **How it helps:** the mistake is reported at the feature that made it, which matters most for an AI that does not see the model | The number of connected pieces of the body before and after the feature (a count of components from the kernel); a warning on the feature when the extrusion added a piece that touches nothing. Geometry, so a full review |
| A picture of the model without the app (same session; medium, next) | **Why we want it:** `view_image` works only with the app connected through the bridge, and the bridge belongs to one session at a time. A session without it does not see the model; in this session the AI wrote its own renderer of STL to check the bin. **How it helps:** every session, a test or a CI job can see the shape: a shaded view from a direction, optionally cut by a plane | A rasteriser of the bodies' meshes in the engine or the MCP server (a z-buffer and flat shading, about 100 lines, no library); the PNG is written through the port `Deflater`. A tool of the server beside `view_image`, which stays the view of the app |
| Suppressing a feature by an expression, configurations (medium, next, after the Gridfinity session of 2026-11-26) | Variants of one part (with a flange and without). **Why we want it:** OpenSCAD projects are driven by switches (Gridfinity: `include_lip`, `scoop`, `style_tab`, magnet holes or not, tabs left out below a height of 3 units); without them a model converted to trymesh is one variant of the original. **How it helps:** one model gives every variant a user or an AI asks for by changing a parameter, and the variant that does not fit (a tab taller than the compartment) can switch itself off | `suppressed` as another field with an expression; expressions already have comparisons and `&&`, `\|\|`, `!`, and `if(c, a, b)` for the sizes. Touches the schema (a step of `UPGRADES`), the recompute, the timeline of the app and what depends on a feature suppressed by a value |
| The offset of an outline inside a sketch (medium, next, after the Gridfinity session of 2026-11-26) | The stacking lip of a bin and its support were built as a second body by the offset of a profile and joined by a combine, because a sketch cannot hold an outline and its offset; a wall, a gasket groove or a lid lip drawn as two loops of one sketch is the natural way, and the offset can then be dimensioned against | A function of the shared module of sketch tools (`SKETCH_TOOLS`), or derived geometry of the sketch (D64); it may want a new constraint; the arithmetic of the offset of a profile (D44) is there to reuse |
| A repair of the near-flush union of the kernel adapter | Parts cut apart and joined again (a split and a union) are refused in a few per cent of the cases, or keep a remnant of the cut face. The Gridfinity session of 2026-11-26 met it as a `kernelFailure` ("folded triangle") of a union of the lip support ring whose faces lay flush on the faces of the bin; moving the ring 0.5 mm and the union before the cuts of the lip avoided it (medium, next: a minimal repro first); a union within the band of guarantee 3 may leave the shift of the adapter as material | Inside the adapter (D56, "Open", 2, and the pinned band in `packages/kernel-manifold/test/precondition.test.ts`); the checks of `booleanOfBodies` already turn the wrong volume into a refusal |

## Candidates by area

### Sketch: tools and constraints

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| Sketch tools placed by expressions (from building a robot arm through MCP, 2026-11-26) | **Why we want it:** a parametric part needs its outlines where the parameters put them: a servo pocket at `H_sh - 20`, a palm at `L2 ± 40`. The tool `rectangle` takes a size as an expression, but its corner or centre only as numbers plus an optional snap, so a rectangle at a parametric place is a fixed point first (or four points, four lines and four `fixed` constraints by hand, about twelve commands per rectangle; the robot arm had seven such rectangles). **How it helps:** one call draws a rectangle (or a polygon) that follows the parameters, so the AI writes a fraction of the commands and makes fewer mistakes in hand-written corner coordinates; the app's drawing tools gain a typed position too | An anchor of a sketch tool (`{ at, snap? }`) would take `at` as numbers or expressions; the tool then adds a `fixed` constraint with those expressions on its new point (`first` or `center`; the vertex of a polygon too), which is a numeric field already (`constraints/<id>/x`). The expressions are checked as the sizes are (D73). An anchor with both an expression and a snap is refused, as the snap would hold the point twice. The input of the tools and their descriptions change, the stored document does not; a light review |
| More sketch tools: a slot, a hole pitch | Shapes a person and an AI draw in one call. The rectangle from its centre is there (`rectangle` with `center`) | Functions of the shared module of tools; the engine does not change |
| The fillet of a sketch corner: what D52 leaves | A fillet between a line and an arc or two arcs; a chamfer of a corner; removing a fillet as a tool; a fillet on lines with `equalLength` or `midpoint` (moved to a span line, as trim does; refused today). Three defects: a tangency of two arcs at a common end cannot be changed after it is drawn exactly (the same holds for an arc's end held on a line by `pointOnCurve` or through a chain of joins); a fillet that later changes turns into something else (an arc past the end of its line, no message, and on a concave outline or with a radius several times too large a wrong body); the features whose region has a filleted corner on the rim of a hole are not named by the tool | The same re-point (`setCurvePoint`) with another curve in place of the arc. Two arcs tangent at a common end need the adapter's rule extended first; measured: "the second centre on the line of the first centre and the common point" solves every case tried and needs a check that the kind of contact is the one of the estimate. The second defect needs the sketch to know which arcs are fillets, or a warning for a line whose direction turned round in a solve; the third the curves of the holes of a region in the solved sketch |
| Trim, extend and split: what D65 leaves | Cutting geometry that is not own (a projected edge, a curve of another sketch, a copy of 6c, an imported outline): such geometry is a cut of an own curve, never cut itself. A cut where two arcs or two circles touch, and a trim that takes the common end of a tangency off its curve (both listed by the query `sketchContacts` with `fix: 'none'`). Extend to the extension of the other curve (past its ends); a break at a place with no crossing, which would also give a circle touched once its second point. Regions are not made from crossing curves by themselves, as Onshape and Fusion make them; `split` without a curve repairs the crossings | An own outline taken over from a projection is a tool of its own (6b's `projectSketch` with `as: 'own'`, and the row of D72 below). The two refusals wait for the adapter to read a tangency of two arcs at a common end and an end held by `pointOnCurve` (D52's alternative 17) |
| Named constraints concentric and collinear; a copy of a sketch or of a feature | The tools compared have them. Concentric is a coincidence of the centre points here; whether collinear can be composed from the existing constraints was not checked. An AI replays the commands of a sketch; a person would miss the copy | Entries of the catalog of constraints (`CONSTRAINTS`), as D34 and D75 added theirs; a copy is a batch of commands with new IDs |
| A constraint on a copy of a sketch pattern or mirror; an own curve cut where a copy crosses it (6h) | The copies of an entry `pattern` (D68) cannot be constrained or cut, which kept 9 of the 19 patterns of the Onshape actuator from being entries: a hexagon drawn as a pattern of one side is closed by coincidences on its copies, pin pockets patterned on a bore cross it. The converter writes them by spokes (72 construction lines for the 9; the count is no parameter), the "batch of copies tied by constraints" done by hand | Two narrower forms: a constraint that may name a copy (the copy then a solver variable tied to its source), and `split` cutting an own curve where a copy crosses it. The copies already have stable IDs (`<entry>/<n>/<source>`) |
| Advice for a cusp of two outline curves | A spline whose second control point is held on a line behind its end (or an arc that leaves the end of a line back along it) makes a join of zero angle: a valid profile and a closed body, and nothing reports it. The side is kept by the start position of that point alone, so a large change of a driving dimension can carry it over the end without a word. Beside an arc the cusp is not always valid: with the spline outside the arc (less curved) the profile is invalid, and the advice has to say that case too | Not in D70 (owner, 2026-11-24, answer 32). Advice on a valid profile, which neither `get_sketch` nor the query `sketchContacts` gives today: a line for two outline curves that leave a vertex in one direction, a small package of its own; D70, "Tangency" and "Known limits" |
| An ellipse as a sketch curve | An ellipsoid of revolution; the projection of a circular edge onto an oblique plane (a future function of requirements.md); the ellipses of imported outlines, which D72 refuses | planegcs 1.3.0 has `ellipse` and `arc_of_ellipse` (found in its types, not run). In the engine it is a new curve kind through the sketch, the profile detection and the analysis of freedom, so it is not cheap |
| The gear as a generated block in a sketch (6g, not proposed) | A gear outline that shares a profile with other curves | The output of the generator placed into the sketch as derived geometry (D64). The gain is small while a gear extrusion followed by cuts works ([d36/6-plan.md](d36/6-plan.md), question 7) |

### Sketch: splines

The cheap variant is D70 (a curve over control points that are ordinary sketch points).

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| Splines: the full variant | A point held on a spline, a tangency in its middle, a dimension of the curve. With it a crossing of a spline can be cut by trim and split, and a spline is a target of extend | The curve of D70 and its fields stay ([d36/6d-sketch-spline/design.md](d36/6d-sketch-spline/design.md), "The cheap variant"). planegcs 1.3.0 has `bspline` and `point_on_bspline` (run by the review of D70: a `bspline` with the knots 0, 1, 2 and the multiplicities 4, 1, 4 is D70's curve). A point on the curve adds an unknown that is neither a position nor a radius, so the solver port and the analysis of freedom change |
| A spline through given points | The natural way to draw a free-form curve by hand or for an AI: the curve passes the points given | A sketch tool that computes control points and sends the curve of D70; the document does not change. The end tangents need conditions of their own |
| Revolve, offset, taper and wall of a profile with a spline | A turned part with a free-form profile (a knob, a bottle); a rim around a free-form cover | Refused by D70 with a text naming the spline (owner, 2026-11-24, for the revolve). They read the exact outline: a variant of `OutlineCurve` for a spline, the switches over it (about 25), and for the revolve a face kind for a general surface of revolution. The offset of a spline is not a spline, so its side is a face of another kind |
| Trim, split and extend of a spline | Cutting a free-form outline where another curve crosses it | Cutting a B-spline is knot insertion, which changes its control points, and the point at the cut stays there only with the full variant. D65 and D70 refuse a spline by name, and the query `sketchContacts` lists the contact with the reason |
| A projected spline | A later sketch that follows a free-form outline of an earlier one | Refused by D69 and D70 (owner, 2026-11-24); the control points are projected as points. As a curve it is a spline of the result over projected control points, which the shape function of D70 takes from any source |

### Sketch: projection and imported outlines

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| Projection from another sketch: what D69 leaves | `doubled` along a curve: `projectSketch` with `as: 'own'` draws one own curve per place, and a place is the same segment, circle or arc, so the tool's own output after a trim, projected whole as own, gets an own curve over the whole projected side and over its two pieces (no region; pinned in scenario 15; the cure today is `entities`). Taking over as own curves an entry without the flag `regions`. Planes that are not parallel (an ellipse or a foreshortened outline) | Widening "the same place" to "lying along" (6e's `curveContacts(…).lying`) cures the first, and leaves out a skeleton line that runs along an outline for part of its length without being asked. The second needs another way to tell a run again from a request. The third needs the ellipse |
| A warning passed down a chain of projections (D69) | When a sketch in the middle of a chain of projections has a frozen projection (its source lost), the last sketch stays `ok` with an open outline; only the middle sketch's warning and `openEnds` say where. A warning carried down the chain would name the cause where the outline is used | 6b's `compute` has no value that carries a warning; a field of the projected value or a pass over the chain after the recompute. Nothing in the document changes |
| A sketch projected from another document or studio (6h) | A derived sketch of Onshape stays a copy that can drift from its source, and so does a helper copy of the sketch it is held on | Projection (D69) works within a document; across documents it needs the inserted document's sketches as sources |
| Projection of the vertices of a body, and of a circular edge onto an oblique plane | Future functions of requirements.md: a point of a later sketch held on a corner of a body; an edge seen at a slant | A kind of reference geometry in the registry of D64; the oblique circle needs the ellipse |
| An own outline over an import, by a tool (D72) | Notching or trimming an imported board outline in its own sketch: the cut needs own curves, and an outline is never cut | A sketch tool like 6b's `projectSketch` with `as: 'own'` over an outline's entities, with the row of 6b on a projection taken over; today the outline's flag is switched off and an own outline drawn over it by hand or through a projection |
| Placement of an outline on reference geometry, or mirrored (D72) | An outline placed on a projected point or an axis that follows an earlier sketch; a board seen from below | The placement is three numeric fields and an anchor (`origin` or the centre of the box); a point of reference geometry and a mirror flag are further fields of the entry, no schema step |
| Matching a revised outline by geometry or by its file's handles (D72) | A revision that reorders a file keeps the IDs its constraints name | IDs are by kind and file order; `outlineRevision` reports `renamed` already, and a match could rename instead of report |
| Ellipses, rational and periodic splines, DXF blocks and SVG `use` (D72) | Outlines from drawing programs and CAD tools that write these | Refused and listed by the readers; periodic splines can be read exactly by clamping (measured by the review's probe), ellipses and rational splines need a curve kind |
| A budget of profile points across the entries of one sketch (D72) | A sketch holding several large outlines with many splines stays fast | Limits are per outline (2000 curves, 2000 control points); a per-sketch budget is a check in the profile |

### Sketch: the solver and large sketches

Found by the conversion of an actuator from Onshape (6h, [onshape-import.md](onshape-import.md)).

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| A solver that does not depend on the order of dependent constraints, or says which are implied (6h) | Whether a consistent redundant set follows a change depends on the order the solver gets the constraints in (Motor Shell 1 of the actuator follows its diameter under three numberings of ten and not under the converter's); the solver's list of redundant constraints is partial, the diagnosis's holds the cure without saying which, and its removable set is judged at today's position. The converter removes by trial (55 trials for 4 removals) | Behind the port `SketchSolver`: a solver that drops what is dependent while it solves, or a tool that says which constraints are implied by the others for every value |
| A sketch that does not always come back (6h) | Set to a value and back, a sketch can stay in conflict or come back elsewhere, and its count of freedom can differ along the way: the solver starts from where the last solve left the points. On the actuator a walk of `E` in Input Shaft 2 (a line's end at the tangent point of a circle) conflicts at −6 % after −3 % and passes in another order | A solve from the loaded positions as a second try, or a solver less sensitive to a double root |
| A cut sketch holds its topology (6h) | After `split` a sketch is its pieces; when a parameter moves apart two curves that were cut where they met, the sketch gives `sketchConflict` with nothing named, where Onshape forms other regions (Housing 1 of the actuator follows `Phi_R` only from 0.931 to 1.103 of its value) | A cut kept as a relation that can let go, or regions found again from uncut curves |
| The solver out of memory reported as a conflict (6h) | 769 fixed points abort the solver; the sketch gets `sketchConflict` with nothing named, and a large solve leaves less for the next. `fixed` on a few hundred points is slow (1.7 s for 385) | The adapter can tell an abort from a conflict |
| A sketch of thousands of spline pieces (6h) | An imported free-form outline (the cycloidal disc: 6,285 Bezier pieces, 18,855 free points) takes 108 s a recompute, where 256 pieces take 77 ms; the converter keeps to 193 control points a sketch | A spline refitted within a tolerance, or the cost of the sketch step with many free points looked into (which part is slow was not measured) |

### Profiles and regions

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| A region with its islands, and a region named by one curve (from building a flange and a planetary gearbox through MCP, 2026-11-25) | **Why we want it:** the most common solid is an outline with everything drawn inside it filled: a plate with a boss circle, a carrier with pin and shaft circles. Today a region whose outer loop holds other closed curves is extruded with them as holes, so the user or the AI has to list every inner region too (three regions for the carrier), and after a sketch fillet the outer loop is a sorted list of eight curve IDs that has to be read back with the query `sketchRegions`. **How it helps:** one profile entry says "this outline, filled"; fewer tool calls and fewer silent mistakes (a forgotten island is a hole nobody asked for, not an error); a region named by one curve of its outline is what a person means when they click it, and it survives a fillet or a split of the outline | A new option of a profile of regions (islands included), with its validation, face names (the island curves make no side face), the app's form and the description for the AI: a decision of its own. Naming a region by one curve touches stable names and how regions survive edits of the sketch, so it needs a design and a full review |
| A profile of every copy of an entry (6h) | A profile names the regions of a pattern's copies one by one, so a count that goes down leaves a broken reference (`noProfile`) and one that goes up leaves the new copy out with no error | A region reference that names an entry and a source region, expanded over the copies at recompute |
| The offset of a profile and the wall: what D44 leaves | Corner arcs that drop out: the cavity of a box with rounded outer corners and a wall thicker than the corner radius is refused today with a message that says what to do; the narrow variant drops an arc tangent to both its neighbours and joins them in a sharp corner (owner, 2026-11-15: when a real model runs into it; the shell under "First" is such a model). An offset of a generated profile. The full variant with round joins and changes of topology. A wall to one side only, with rounded ends, with projected curves in its chain; a rib that grows until it meets the body | The narrow variant is local to the function of the offset; its costs are a rule that differs from the taper's (which cannot drop curves) and a face that disappears when a parameter crosses the limit, so a reference to it breaks. The full variant is `CrossSection.offset` of Manifold on polylines: curve identity is lost (face names, cylinders) and convex corners get arcs with no source curve, so it needs a name for a corner face |

### Extrusion, revolve, hole, planes, generators

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| Twist on an extrusion, helical gears, a spring or a coil (step 7 of D36, not started) | Helical teeth, the knurling of a knob, a screw cap with a profile of its own, a spring | A body with a helical shape has the same cross-section at every height, only turned, so the tool is built in layers along the normal, each turned about an axis through a point of the sketch: a numeric field of the extent (an angle per length, or a total angle) plus the point. For a generated profile the generator states the rate itself, so a helical gear is a parameter of the gear generator (the helix angle). The number of layers follows from `chordTolerance`; the side faces are of a general kind (no sketch on them, no projected edges). The spike of 7a measured the layered build on the real adapter (`spikes/thread.spike.ts`, [d36/7a-thread/spike.md](d36/7a-thread/spike.md)): about ten times the triangles of a sweep of the axial profile, which is why the thread took the sweep and the twist keeps the layers. A spring is a helical profile with a wire section that does not reach the axis, or the tool of the thread with a profile of its own |
| Taper: what D45 leaves | Chamfered ends as fields of one extrusion (the tool a stack of three sections; it covers most of what an edge chamfer is used for on prisms); a taper with "through all" or up to a face (the size at the far end would depend on the target); a taper of a generated profile; angles per curve | Further sections of `buildStack`; the fields are numeric fields of the extent |
| The extent up to a curved face, and up to the next face the tool meets | The planar face is done (D47), and the start at a face (D66) | A further variant of the extent; the lengths per vertex of D47 are a start |
| Holes: bearing seats, a face that is not planar, a direction other than the normal | A seat from a catalog of bearings (deferred from 2c; `DATA_CATALOGS` has no bearings; the sizes have to be read from the standard, not from memory). A hole on a round face, or along a direction that is not the normal of its sketch | A table of `DATA_CATALOGS` and an entry of the query `hardwareHole`; the direction an `AxisRef` |
| More planes: through three points, tilted about an edge of a body | Future functions of requirements.md. The plane tilted about a sketch line and the midplane are done (D60) | Further optional fields of the plane feature, as D60 added its two |
| More profile generators | A sprocket, a gear rack, spline shafts; other belts and pulleys (GT2 of 3 and 5 mm, GT3, HTD, T). The cycloidal disc and the GT2 pulley of 2 mm are done (D61); text is under "First" | Entries of the catalog of generators; the shape of the document does not change |
| Shifted centre distance of gears | The profile shift is done (D61) with balanced shifts at the reference centre distance; a pair whose shifts do not balance needs the working centre distance `a cos α / cos αw` (no closed form) and the tip shortening | Two expression functions (`inv` and its inverse) or a fact `centerDistance` of a gear in mesh; [d36/5d-generators/design.md](d36/5d-generators/design.md), "Deferred" |

### Threads: what D76 defers

From [d36/7a-thread/design.md](d36/7a-thread/design.md).

- An option `mirroredHand: 'same' | 'opposite'` for the copies of a face in a mirror (today a second thread feature with the other hand; a mirror of a body turns the hand and warns).
- A record for the thread a difference leaves in its target (a tool with a thread cut out of a body); the design drops it.
- A thread on a part of a cylinder (a bore slit along its whole length, a rounded corner); refused, and the slit is cut after the thread.
- A second build of the tool after a refusal of the kernel (another run past the open ends, or other radii of the hidden cylinder), in place of the hint in the message; not measured yet.
- A flag that threads every bore of a listed hole feature, so that a point added to the hole later is threaded too (owner, 2026-11-27). A new optional field: `copies` keeps its meaning, the copies a pattern made.
- A catalog of pipe threads G (ISO 228, flanks at 55°), for fittings (owner, 2026-11-27). The fields of the feature take such a thread by hand already; the values have to be read from the standard, not from memory.
- A mate seated on the shoulder of a modelled socket (a lid whose ceiling lies on the rim of a jar): the groove of the socket stops the lift short of the shoulder, so the ridges of a mate that run to its end meet a ring one lift high, a collision 0.05 deep whose `seat` is 0 (found by the trial of 2026-11-28, pinned in `packages/scenarios/test/thread-bowl.test.ts`). Today a lead-in chamfer on the mate frees it, and the check of collisions names the cause: the entry `shortOfShoulder` of the pair (the owner, 2026-11-28: the geometry stays, the report names it). A relief the tool cuts under a shoulder stays the candidate for freeing such a pair without a chamfer.
- The check of collisions of two modelled threads of a large diameter that collide: 10 to 21 s a pair for a thread 80 across (the same trial), most of it the measure of the depth.

### Patterns

The pattern as the tools of a combine is under "Next"; the profile of every copy of an entry under "Profiles and regions".

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| Patterns: what D53 and the grid leave | A pattern of features as a source of a pattern (a mirror of a mirror of features, a circle of rows); a second transform of another kind in one pattern; staggered rows; a third direction; copies left out of a grid; a pattern of several bodies (and so a grid of several); a linear pattern to both sides; a key order of the faces of an edge that does not depend on copy tags; a direction along a sketch line or an edge (with the other kinds of `AxisRef`). Two holes: a circular pattern of a body whose span is a full turn puts its last copy on the original without an issue, and a row with a step below 10⁻⁶ mm makes copies that coincide to float32 | Further kinds and fields of the transform; a pattern is a list of rigid transforms. The grid refuses two places in one; comparing places could close the row, and comparing a turned point (not the translation, which is zero for every turn about an axis through the origin) the circular pattern ([d36/2e-pattern-mirror/design.md](d36/2e-pattern-mirror/design.md), [grid.md](d36/2e-pattern-mirror/grid.md)) |
| Rotating the copies of a pattern about their own axis | Planets in mesh even when the tooth counts are not divisible by the number of planets | Another entry of the transform of a copy |

### Chamfers and fillets of edges

The chamfer at the mouth of a hole is under "Next".

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| A fillet that rounds a corner into a sphere (from the Gridfinity session of 2026-11-26) | **Why we want it:** a box rounded evenly on all edges (`rounded_cube` and `hull()` of spheres in OpenSCAD, the compartments of a bin, a soap dish, a cover) is a fillet of the top edges with the same radius as the vertical corners. Today it is refused ("the fillet reaches the axis of the circular edge"), so a radius slightly smaller has to be used, which leaves a thin ring on each corner | The tool of a circular edge whose fillet reaches its axis has to become a sphere cap. A degenerate case of the edge-blend tools (D63, D67) with its own construction, and of the naming of the face it creates |
| Blends that follow the copies of a pattern, edges chosen by a rule (from the Gridfinity session of 2026-11-26) | **Why we want it:** a fillet or a chamfer names edges, so on a patterned shape it names the edges of every copy and does not follow a change of the count. The chamfer of a hole is covered by its row under "Next"; other cases are the rounded rim of each compartment, the fillets at the foot of each rib. **How it helps:** the blends stay right when a count changes, and the AI does not have to list dozens of edge names read from a large `body` query | Two ways, each with open questions: a blend inside a pattern of features (the edge names of the source mapped into each copy, and what happens when a copy merges with its neighbour), or a selection rule stored in the feature (the edges of these faces, the edges of the faces created by this feature) evaluated at the recompute |
| Chamfers and fillets past round faces beyond the run-out (D67, "Deferred") | A blend that has to **stop** at the end face (a rib's foot flush with a round plate's rim: the actuator's motor shaft and shell), a **bridge** (a face that notches the edge less deep than the blend), a straight edge between two cylinders and two lines of one pair of faces (the housing's Fillet 1), an end at a cone, a sphere or a torus | D67 refuses each with advice and records what its reviews found in its "Deferred"; a stop needs a tool cut at the end face, which the run-out's void check and the exact reach of `tool-edge.ts` are a start for. No type, role or field changes |
| Chamfer and fillet along a swept edge | The rim of a part whose outline holds a spline: an edge of a spline face is of the kind `other`, and an edge that ends at such a face or runs on smoothly into one is refused by D63 too, so on an outline that is smooth all round no edge of the rim passes (measured for D70). The same gap lost the chamfer on the spline edges of the cycloidal disc of the converted actuator | An edge kind for the edge of a swept face with a cap, and a tool built along its polyline; the chain rule of D63 stays. A known limit of D70 by the owner's decision of 2026-11-24 |

### Bodies and booleans

The shell and the move of a body are under "First".

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| A clearance by the sum of Minkowski | A pocket for a tool the clearance by faces refuses (a hole or a gap narrower than twice the clearance, a change of topology) or cannot describe (a bought part imported as a mesh, 3b) | A second way beside `movedOutwards` (D56, "Open", 1): the library has the sum; it takes seconds for a motor and leaves one face without a description, so it fits as an option of the combine, memoised by the solid of the tool |

### Mechanism and the export of a robot

What an assembly needs is under "First".

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| Coupled joints in the robot export: `mimic` in URDF and a joint equality in MJCF (from building a robot arm through MCP, 2026-11-26) | **Why we want it:** a coupled motion is how a model says that parts move together: two gripper fingers that close from one parameter (`grip` and `-grip`), a pinion that turns with the base it drives (`-q · Zt / Zp`). The model, its poses and its collisions honour it, but the export writes each coupled joint as a joint of its own with its own motor (`coupled` in its report), so in the simulator the two fingers are driven independently (each by its own motor, as each has an effort) and the pinion spins free of the base it meshes with. **How it helps:** a robot exported from trymesh moves in MuJoCo or ROS as it moves in the app, without the user writing the constraints into the XML by hand after every export; fewer motors to drive (one per real actuator) | The exports know which joints are coupled (`coupled`, a joint whose value has an expression); finding the parameter a group shares, the joint that leads it, and whether the expression is linear in it (evaluated at two values) is new work. A linear coupling (`a · q + b`) maps onto URDF `<mimic joint multiplier offset>` and onto an MJCF `<equality><joint joint1 joint2 polycoef>`; one joint of each group becomes the driven one with the motor, the others follow. A coupling that is not linear in one parameter stays as today, said in `about`. Changes only the two export modules and their tests; no change of the document |
| Joints for the copies of a pattern, and couplings suggested from gears in mesh (from building a flange and a planetary gearbox through MCP, 2026-11-25) | **Why we want it:** a mechanism of patterned parts (the planets of a gearbox, the fingers of a gripper, the wheels of a vehicle) is the normal case of a moving model. Today every copy needs its own link and joint, and each joint its own axis: the gearbox needed a helper sketch with points placed by `cos`/`sin`, so it is fixed at three planets although their count `NP` is a parameter; the coupled values (`q · ZS / (ZS + ZR)` for the carrier, a signed ratio for each planet) were worked out by hand and their signs checked by collisions. **How it helps:** the count of copies stays a real parameter of the moving model, a joint is written once for all copies, and the ratios come from the tooth counts the gears already know (`meshWith`), so a change of a tooth count keeps the mechanism right; fewer calls and no hand arithmetic for the AI | A joint as a template over the copies of a pattern changes the stored mechanism (its links and joints follow a count that is an expression), so it is a schema change with a step of `UPGRADES` and touches validation, the export of a robot (URDF, MJCF) and the queries: the hardest of the items from that session. Before designing it, check whether the axis of a round face of a copy (`face` with a `copy` tag) already serves as the axis of a copy. Coupling from `meshWith` is simple for a pair of gears; in a planetary train it depends on which link is the frame and which the carrier, so it fits first as a query that suggests the couplings rather than as automation |
| Closed loops of a mechanism | A four-bar linkage, a parallel gripper. The joints are a tree (D49), and URDF cannot describe a loop at all | Not within cheap reach as mates ("Assembly" under "First"). A planar loop can be modelled today on a skeleton sketch that the sketch solver closes, driven by a parameter: the parts follow through the timeline, at the cost of a recompute per pose, and neither the pose of the mechanism nor the export of a robot knows it. MJCF can close a loop by an equality, which is the row of coupled joints one step on |

### Queries and feedback for the AI

The picture of the model without the app and the warning for an extrusion that is not joined are under "Next".

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| Print queries: what D42 leaves | **The wall thickness**: an AI that does not see the model finds a thin wall only by a section. Bridges (a small horizontal hole is reported as an overhang; the Gridfinity session of 2026-11-26 had the seats of the magnet holes and the underside of a label tab reported so; a lower limit on the area keeps the noise down). The smallest printable detail; an estimate of the support volume; the print orientation as a body property | Queries over bodies, the document does not change. The wall thickness is the dearest: a ray or a ball per sample of the surface; the others are passes over triangles. The results of queries in `checks` run into the problem of the names of reference dimensions and are not proposed |

### Import and export

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| STEP read into a mesh | Motors, bearings and boards are published as STEP; today the conversion is done outside | Reading STEP into a mesh needs a converter, not another kernel: a new third-party library (D2, the owner's approval); which one, its size and its licence were not looked up |
| A mesh from a 3MF file | Bought parts and prints shared as 3MF | An entry of the catalog of import formats (D55). A 3MF from a slicer or a CAD tool is deflated, so reading it needs an inflater, which the approval of `pako` for deflate does not cover (D55, "Open", 3) |
| A scale per axis in the exports `stl` and `3mf` | The compensation of shrinkage, which differs in the plane of the bed and across it | An option of the two formats that scales the mesh on its way out; the model does not change ("Move, copy and scale of a body" under "First") |
| A run of the Onshape conversion on the constraints of D75 (6h) | The converter writes the kinds of D75 since 2026-11-27 (`horizontalPoints`, `verticalPoints`, `midpointPoints`, and `distanceLineLine` for a pair of lines that parts in the probe; [onshape-import.md](onshape-import.md)), tested on fixtures only: the dump of the actuator was not at hand. The measured tables of onshape-import.md are those of the run before | A run with `ONSHAPE_BASELINE` on the summary of the last one, and its numbers in the tables: the 3 HORIZONTAL of two points, the 2 MIDPOINTs of Motor Shell 2 (the one with two external ends is expected to stay lost if they are corners of a rectangle about its centre: two pairs, no rule chooses; the sketch's last degree of freedom), the probe. `distanceLineCircle` has no use in that model. A distance of two lines with an external line (an axis, a projected line) is still lost: the stand-in measured from an own end, and the new kind would take it |

### Parameters and the document

The suppression by an expression is under "Next".

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| Names of reference dimensions in expressions | A parameter derived from a measured value | Expressions are evaluated inside the recompute; the names can be extended by values produced by the recompute, and the dot is reserved for them in an expression. The validation of an expression at a command has to move for such names into the facade of the engine, which has the state of the recompute. This is more than a wider name environment (review of 2026-11-14): a parameter derived from a measured dimension can, through another parameter, drive the very sketch it is measured in, and the cycle check between parameters does not see a cycle that goes through geometry. The rules have to be set first: a measured value is available only to features after its sketch, so the value of a parameter that uses it depends on the position on the timeline (undefined before the sketch), and `Evaluation.parameters` and checks need a defined meaning for that |
| Comments and groups of parameters | Readability of a larger table of parameters | Optional entries of a parameter |

### Speed and the kernel adapter

The repair of the near-flush union is under "Next".

| Feature | What it is for | What it builds on, why it locks nothing in |
|---|---|---|
| A dependency graph in the recompute | Speed on larger models: today everything from the first changed feature is recomputed | An internal matter of the recompute, the document does not change |
| Merging the tools of a pattern before the boolean, spatial search in the kernel adapter | Speed with hundreds of copies | An internal matter of the pattern and the kernel adapter |
| A boolean with hundreds of openings | A perforated panel: one boolean on a plate with 192 openings took 7.6 s in the kernel adapter (measured for D35) | The row above |
| Two failures of the kernel beside today's values (6h) | Chamfer 1 of the actuator's Housing at `HOUSING_DIAMETER` − 1 % and Extrude 8 of Motor Shell at − 4 % give `kernelFailure`; both pass at 3 % and 6 % (measured by the design of 6h, not looked into) | The kernel adapter |

**The refusals of a union and a difference by the kernel adapter** (what is left after D51, [d36/5f-adapter-repair/design.md](d36/5f-adapter-repair/design.md), "Known limits"; the intersections of a pin with its hole that the adapter refused are answered since 2026-11-16 by a second cleaning). A union and a difference are still refused by the checks of the adapter in rare cases (three in 30,000 fuzz cases, all "a folded triangle" after faces of the tool were moved and brought back; one union of a pin with a plate lying flush two metres from the origin in about 7,000 of the sliver fuzz, two in 12,500 (the seeds 2535 and 11106), which the second cleaning would answer rightly). The second cleaning is kept from a union and a difference because it may leave a null triangle carrying the number of a face that should be gone (guarantee 3 of the port); letting it try there needs a fuzz of its own that shows it leaves no such remnant. A few intersections stay refused as well (the second cleaning's mesh is folded, or the weld itself folds a key nearly flush in its socket); the collisions take the second opinion of D50 for them.

## Not within cheap reach

What follows from the mesh kernel (D7) and from having one solver, in a plane (D6). None of it is a row waiting for its turn; each would be a decision about the base of the project.

- **Exact geometry and the export of STEP.** A body is a closed triangle mesh, so a model cannot be handed to another CAD tool or to a machining service as exact geometry. It would need a replacement of the geometric kernel. For printing it does not matter.
- **Fillets and chamfers of any edge.** D63 and D67 give straight and circular edges, with the run-outs into round faces. Not possible: edges of the kind `other` (where a cylinder meets a cylinder, gear teeth; the rows of the swept edge and of the round ends under "Chamfers and fillets" are the reachable part), a selection that follows tangent edges, a variable radius. Rounding everything with a sum of Minkowski was considered and rejected: it is not selective and it destroys face names, so nothing could follow it on the timeline.
- **Mates solved together and closed loops.** A spatial constraint solver for six degrees of freedom per part; see "Assembly" under "First" for what stands in its place.
- **3D sketches with constraints.** The same class of cost as the assembly solver. The replacement is a path through points for the sweep.
- **A loft, a sweep with a twist or a guide rail, a shell of any body.** See "First" for the parts that are within reach.
- **A scale per axis as a feature, an ellipsoid with three different axes.** Easy on a mesh, but cylinders stop being cylinders and the round faces fall to the general kind.
- **Text or a pattern wrapped on a round face.**
- **Fine detail in a large model.** The kernel adapter does not reliably resolve detail smaller than about a ten-thousandth of the size of the model right at flush faces (around 0.01 mm for a model of 110 mm).

## Outside the tool on purpose

Dimensioned drawings, CAM and slicing, strength analysis, sheet metal, surfacing and sculpting, rendering, versions and collaboration (a document is a JSON file, so versions come from the file system or git), units other than millimetres, simulation itself (controllers, sensors, convex decomposition), and USD: as plain geometry it gives what 3MF gives, with the physics schema it is a large surface to write, and the simulators that use it read URDF and MJCF.

## Where this project is ahead for the intended use

Not a gap, but worth keeping while extending: a broken reference never silently points elsewhere and can be repaired, the sketch diagnosis explains which constraints follow from which, checks guard design conditions on every recompute, and the whole model can be read and changed through MCP with descriptions generated from the engine.

## Done since 2026-11-14, and where it is recorded

What earlier versions of this document proposed and the steps of D36 built. What each left open is in the rows above; its limits are in its design.

| Feature | Decision |
|---|---|
| The section as a query and a view; a picture of the view for the AI | D38, D43 |
| Measuring between two entities, the smallest gap, mass properties, print queries | D39, D40, D41, D42 |
| The offset of a profile and the wall from a line | D44 |
| Taper on an extrusion | D45 |
| The hole feature and the hardware catalogs | D46 |
| The extent up to a planar face; the start of an extent at a face or a plane | D47, D66 |
| Body properties and the catalog of materials | D48 |
| The mechanism (links, joints, the pose) and the export of URDF and MJCF | D49, D59 |
| The fillet of a sketch corner and the command that re-points an end of a curve | D52 |
| The linear pattern, the mirror and the grid, of features and of bodies | D53 |
| The exports 3MF, DXF and SVG | D54 |
| Import of a mesh as a reference body | D55 |
| The boolean of bodies, the subtraction with a clearance, the split by a plane | D56 |
| The parts list | D57 |
| Revolve (with it the sphere, the dome and the torus) | D58 |
| The tilted plane and the midplane | D60 |
| The cycloidal disc, the GT2 pulley, the profile shift of a gear | D61 |
| Inserting another document as a part | D62 |
| Chamfer and fillet of straight and circular edges, and their run-outs into round faces | D63, D67 |
| Derived geometry in a sketch, the axes of the origin | D64, D71 |
| Trim, extend and split | D65 |
| Mirror and pattern in a sketch | D68 |
| Projection from another sketch | D69 |
| Splines, the cheap variant | D70 |
| Import of an outline from DXF and SVG | D72 |
| The ergonomics of MCP; the selection of the app for the AI | D73, D74 |
| Constraints of two points, distances of two lines and of a line and a circle | D75 |
| Threads, cosmetic and modelled | D76 |

The order in which the steps were taken is D36 ([decisions/D36-order-after-d35.md](decisions/D36-order-after-d35.md), [d36/README.md](d36/README.md)). Of its step 7 the tube along a path is now a stage of the sweep, and the twist on an extrusion and the names of reference dimensions in expressions are rows above.

# D36 step 6: the cut into work packages

The reasoning behind the rows 6a to 6h of [README.md](README.md). It is a plan, not a design: each package gets its own design (and its decision number, from D64) when its work starts. Written 2026-11-17 by reading the code at `41317d7`, the backlog and the notes of the Onshape conversion; nothing was run. Where a statement rests on reading only, it says so; the few counts were made with `grep`.

**Amended 2026-11-24**, after the review over the whole step ([6-cross-review.md](6-cross-review.md), 2026-11-23) and the owner's answers to it. The step is now one sequence with two points added, **6a, 6a2, 6e, 6c, 6b, 6d, 6f, 6h**; scenario 15 has one text; the outline of 6f is corrected. What changed, answer by answer, is in "Amendments after the review of step 6" at the end. A paragraph that was amended says so and keeps what it said before where that is a decision; the text as it stood is in the repository at `e70cd65`.

## What step 6 is

[D36](../decisions/D36-order-after-d35.md) names it: "Derived geometry in a sketch and what stands on it (projection from another sketch, mirror and pattern in a sketch, gear as a block, import of an outline), splines, trim and extend", and puts it late because it "serves mostly drawing by hand". Two things have changed since:

- **The conversion of a real Onshape model** (an actuator of 14 part studios, written up in `docs/onshape-import.md`, untracked in the main tree) found the gaps in practice. 287 of 380 sketch constraints had no counterpart; the causes it names are constraints on external geometry (the origin, an edge, another sketch), sketch patterns and mirrors of curves, distances other than point–point and point–line, angles, and `FIX`. Six sketches had crossing curves that the converter had to split itself, losing every constraint on a split curve. Derived sketches (`importDerived`) were copied instead of projected. The cycloidal disc was four splines (replaced by the generator of D61).
- **An AI is the main author**, so each package is judged by what it gives a model built through MCP, not only a hand in the app. The answer differs per package and is said with each.

## Derived geometry: two sides of one idea

The backlog calls derived geometry "the mechanism four of its items share": geometry in a sketch that is not a solver variable. Reading the code, it has two sides, and the four items do not all sit on the same one.

- **Reference geometry, before the solver.** Fixed curves and points the sketch's own entities are constrained to. One kind exists: the projection of an edge of a body (`ExternalRef` `{ type: 'edge' }`, D23). Its values are computed from the state before the sketch, enter `solverSetup` as fixed (`SolveInput.fixed`), have derived IDs (`<id>/a`, `<id>/b`, `<id>/center`, `derivedPoints`), are frozen at their last values when they fail, and are ignored by the profile (`detectProfile` reads `sketch.curves` only). The **projection from another sketch**, the **import of an outline** and the **axes of the origin** belong here: they are fixed when the solver runs.
- **Derived geometry proper, after the solver.** Curves computed from solved own entities: the **mirror and the pattern in a sketch**, and the **gear as a block**. They cannot be constrained to in their own sketch (they do not exist when it is solved), but they take part in its profile and name faces, and later sketches can project them.

Both sides need the same things from the sketch, and today each of them is hard-coded to the one kind of projected edge:

- **IDs and entities.** `entityOf` and `derivedPoints` (`sketch-content.ts`) know an own point or curve, the origin, and the derived points of a projected edge. Every other kind needs to answer "what is `<id>/<local>`, of which kind, may it be moved".
- **Shapes.** `Projected` is a line or a circle; a projected arc of another sketch, an imported arc and a mirrored arc need an arc, and splines (6d) a spline.
- **The profile.** `detectProfile` takes `sketch.curves` and skips projected curves; `curveOf` in `recompute/profile.ts` reads `sketch.feature.curves` for the shape of a side. Copies of a mirror and an imported board outline have to form regions, so the profile has to read a list of shapes from more than one source, and the rule of which ones count has to be one rule.
- **Joins.** The profile joins points by ID or by a satisfied `coincident` (`pointJoins`). The ends of a mirrored half lie on the axis; their copies are the same points only by position. Without a rule that a copy mapped onto its source (within the length tolerance) is that point, a mirrored half never closes into a region.
- **The result and the view.** `SketchResult` has points and radii, not curves; the app draws projected curves from the document's `external` and the result's points (`sketch-view.ts`), and MCP's `get_sketch` does the same. Derived curves have to be in the result.

**So is it one foundation package or a vocabulary settled first? Both, in one small package.** The code that is hard-coded to the projected edge (the solver setup, the derived IDs, the sketch step and validator, the profile input, the view and the list of projections in the app) is the place every package of step 6 except trim would edit. That is the situation the preparatory step of D36 ([00-prep/design.md](00-prep/design.md)) was made for: turn it into a place where things are only added, with no change of behaviour, and write the shared vocabulary down before any package designs against it. Package **6a** is that, for step 6 only, and smaller: four mechanical changes and a vocabulary. The other packages need it; none of them needs another of them, apart from what is said in "Needs". *(Amended 2026-11-24: that did not hold once the designs were written. Each later design is written against the code of the earlier ones, so the step is one sequence; see "Order and tracks".)*

## The packages

### 6a Preparatory part and shared vocabulary

**The preparatory part** (no change of behaviour; the existing tests pass unchanged):

1. **The kinds of reference geometry as a registry**, like the registry of feature types: a kind (`edge` today) says how it is validated, what it refers to, which entities and derived IDs it has and of what kind, and how its values are computed from the state before the sketch and frozen when they fail. `solverSetup`, `externalGeometry`, `entityOf`, `derivedPoints`, the sketch step, its validator and its `refs` read the registry instead of the one kind.
2. **The profile reads a list of shapes** (own curves today) instead of `sketch.curves` and the geometry, and the sides of a profile (`curveOf`, `sideOf`) take their shape from the same list. A later kind adds its shapes to the list with a flag whether they form regions.
3. **Every switch on the kind of a curve is exhaustive.** Several places treat "not a line" as "an arc or a circle" (`curveOf` in `recompute/profile.ts`, the `Shape` of `detectProfile`); 15 files of the engine, the solver adapter and the app name the kind `arc` (counted with `grep`; which of them branch exhaustively was not checked one by one). `architecture/sketch.md` already requires that an unknown kind of curve is refused with an error, not skipped (written for the ellipse). With a `never` check at each switch, the spline of 6d does not compile until each place has decided.
4. **The app's sketch tools as a table.** `sketch-mode.ts` has a union `Tool` and a chain of `if` over it, and the options of a tool live in `SketchHost.sketching`. A table by tool (like `FEATURE_UI`) lets 6b, 6d, 6e and 6f each add a file and a line.

**The vocabulary**, written in its design and type-checked as a contract, decided before 6b to 6f design against it:

- the ID scheme of reference and derived entities (`<ref>/<local>`, and for a copy `<ref>/<copy>/<entity>`), which the face names already allow (`naming.md`: a text field of a role may hold an ID with a slash);
- the shapes: a point, a line, a circle, an arc, a spline over control points;
- which non-own geometry forms regions (question 4), and the join of a copy mapped onto its source;
- whether derived output (6c) is a second map of the sketch with commands of its own, or one family with `external` and `addExternal` (an entry says whether it is computed before or after the solver);
- what consumers accept: today a projected point is an operand of a generator and an axis (`sketchPoint`, `sketchLine`) but not a point of a hole (`notProjected`); derived points should follow the same rules as projected ones unless a package says why not;
- what `SketchResult` carries for the view and for `get_sketch`.

Review: light for the preparatory part if no public type changes (CLAUDE.md, "Depth of the review"); the vocabulary gets the review of a design.

*Amended 2026-11-24.* 6a is implemented and merged (D64). Three things follow from the review of the step:

- **The vocabulary is amended by later packages** (6c, 6a2, 6f): the joins of copies, a copy that lies on its source, the entities of a copy, where the axes are carried, the flag of an imported outline. The list, with the package that makes each change, is in [6a-sketch-prep/design.md](6a-sketch-prep/design.md), "Amendments after the review of step 6". From now on a design that leaves the vocabulary adds its line there in the same commit.
- **Derived geometry stays a kind of entry of `external`**, as implemented (owner, answer 17): no second map and no rename.
- **Part 4 went without a review** under the rule above, though it added generic code no tool of that day used (`picks: 'curve'`, a tool's own picker, `finish` with Enter), and the one defect the later review found is in that code. Such a part gets at least a light review (owner, answer 18; a change of the table in CLAUDE.md). The findings of that review are fixed in a point of their own on the branch `d36/6a-fix`, before 6a2.

### 6a2 The axes of the origin

*Added 2026-11-24 (owner, answer 1; finding 10 of the review).* The axes were part of 6b. 6c needs them for its main case, a half mirrored about the Y axis, and 6b comes after 6c in the sequence, so 6c would have tested its mirror on a construction line and 6b would have rewritten 6c's calls afterwards. The axes are a small piece of work with a slot that 6a fixed, so they become a point of their own, right after 6a.

**What it is.** Every sketch has two fixed lines through its origin along its X and Y, `origin/x` and `origin/y` (question 8), the only entities under `origin/`:

- `entityOf` answers for them (a line that is not own), so a constraint may name one (a point on the Y axis, two points symmetric about it, a distance to it), and so may an axis `{ kind: 'sketchLine', line: 'origin/x' }` of a revolve, a pattern, a tilted plane or a joint (run by the review: refused today, "the sketch has no entity `origin/x`").
- They are in the list of curves and the geometry of every sketch (`sketchCurves`, the state), never forming regions.
- They are in the solver's input only when a constraint of the sketch names one, so the stamp of every stored sketch stays and none is solved again on load (the slot of 6a: a resolved reference without a value under the key `origin`).
- The engine's sketch tools see an axis as a long line, so a snap or a `with` curve of 6e may be one; the app draws and picks them; the description for the AI names them.
- Refused, with a reason: an axis in `midpoint` or `equalLength` (a whole line has no middle and no length), a constraint with no own operand (as for any fixed entity), an axis as a curve of a wall or as a side of a region, and whatever else "What consumers accept" of 6a refuses for reference geometry.

**Its design** is [6a2-origin-axes/design.md](6a2-origin-axes/design.md) (D71), with a contract and calls: the part of 6b's design about the axes (D69), carved out by the revision of that design on 2026-11-24 so that it can be reviewed and implemented before the rest of 6b. What was open is settled there with the review of 6b's design: the axes are not in `SketchResult` (a curve of the result would name a hidden point), and one function, `solvedCurves`, gives every reader without a recompute the curves the recompute holds.

**Test, on a stand-in** (scenario 15, step 1): a board drawn by hand whose corners and holes are placed by `symmetric` constraints about `origin/x` and `origin/y`, fully determined; a body revolved about `origin/x`; the stored documents of the tests loaded with their stamps unchanged. 6c and 6b then build on that board until 6f imports one.

**Needs:** 6a. No schema step, no command, no issue code. The mapping of Onshape's origin and default planes to `origin` and the axes is 6h's.

### 6b Projection from another sketch, and the axes of the origin

**Cheap variant.** A new kind of reference, `{ type: 'sketch', sketch, entity }`: a point, a line, a circle or an arc of an earlier sketch (its own, projected or derived entities), projected into this sketch when the two planes are parallel (either normal, any offset). The values come from the solved state of that sketch before this one; a failure freezes them as for an edge (`brokenProjection`). A tilted plane is `unsupportedProjection`, as for a circular edge today (it would be an ellipse). One reference per entity; projecting a whole sketch is a batch (a button in the app, a batch of `addExternal` through MCP), which is how the converter would turn `importDerived` into projections and keep the constraints on them. Projected curves do not form regions unless question 4 decides otherwise.

*Amended 2026-11-24.* The axes of the origin moved to 6a2 (owner, answer 1); the next paragraph is kept as the plan wrote it. 6b is implemented after 6c and 6e, so its design is written against both: a projection of a copy of 6c (a slashed `entity`, keyed by the joins after the derived stage), `reads` of an entry in the lists `shortened` of the fillet and of 6e's tools. Projections keep their join keys; joining by position is for copies only (answer 12). A full design exists on the branch `d36/6b-design` (D69), not reviewed yet; its three-feature base is the base of scenario 15 (answer 6).

*Amended again 2026-11-24*, after the review of that design and the owner's answers 19 to 22 ([6b-sketch-projection/design.md](6b-sketch-projection/design.md), revised). Projections that form regions **join by position**, in one stage with the copies of 6c, and the join keys are dropped (19, which replaces the sentence above): keys left an outline that reaches a corner by two routes, one made of projected edges and a projected construction copy with an invalid profile, and a profile computed in memory did not see them. Projecting a whole sketch is a sketch tool, `projectSketch`, not a batch the caller writes (21): each curve keeps the role it has in its source, and a variant draws an own outline over the projections, held on them, which is what 6e's tools can cut. A projected spline is refused, and 6d writes the refusal (22). What a sketch can project is a query, `sketchSources`. The lists of the fillet and of 6e's tools find a projection through its references, in 6e's one function `readersOf`, not through a member `reads` of the kind.

**The axes of the origin.** Every sketch gets two fixed lines through the origin along its X and Y, under reserved derived IDs (for example `origin/x` and `origin/y`; a slash cannot be in an ID a caller gives, so no document can have them already). They let a constraint say "on the X axis" or "symmetric about the Y axis" and serve as the axis of a mirror (6c). It belongs here because it is fixed reference geometry like a projection.

**Constraints on the origin, the Onshape gap.** Read in the code: the engine already accepts any constraint between `origin` and an own point (`constraint` in `features/sketch.ts` asks only that one operand can move), and the converter skips every Onshape constraint with an external operand (`tools/onshape/sketch.ts`, `p.externalFirst || p.externalSecond`), the origin point among them. So the part of the gap that is about the origin point is the converter's to close; what the engine lacks is the axes. How many of the 287 lost constraints are on the origin, the axes, an edge or another sketch was not counted.

**Deferred:** projection into a tilted plane (the ellipse), a projected spline before 6d is in (then it projects its control points), a reference to a whole sketch as one entry.

### 6c Mirror and pattern in a sketch

**Cheap variant: derived geometry.** An entry of the sketch names own curves and a transform: a mirror about a line (own, projected or an axis of 6b), a circular pattern about a point with a count and an angle, a linear pattern along a line with a count and a spacing. The count, the angle and the spacing are numeric fields, so they take expressions. After the solver, the copies are computed from the solved curves under derived IDs; they form regions like their source (a construction curve copies as one), name side faces, and later sketches can project them. A copy of a point that falls on its source (on the mirror axis, at the centre) is that point, which is what closes a mirrored half.

*Amended 2026-11-24.* Designed in full (D68, [6c-sketch-mirror-pattern/design.md](6c-sketch-mirror-pattern/design.md)) and revised after its review. The owner's answers: the ends of copies join by position, where the paragraph above says a copy of a point that falls on its source is that point (12); holes and walls at copies are deferred (13); the coincidences of the source are not carried to the copies (14); a broad phase of bounding boxes in the profile is part of 6c, since the 804 curves of a pattern of 200 slots took 344 ms per recompute and 27 ms with it (15); a split that pulls an unlisted crossing curve into an entry is a known limit (16). The axis of a mirror is an axis of 6a2 from the start. 6c is implemented after 6e and writes into its module (`sketch-cut.ts`): the entries that list a cut source are patched there.

**Why not the tool variant.** As a sketch tool the copies would be own curves tied by `symmetric` constraints (a mirror) or by construction like the polygon (a pattern): they could be constrained, but the count is not a parameter, and running the tool again makes new IDs. D52 showed that the regions can be patched; the count still cannot follow a parameter, and that is what an AI changes ("vents = 7"). With derived copies the IDs of copy 1 to n stay when the count changes, so the extrusion of a region of copy 2 keeps its reference. A mirror by `symmetric` constraints remains possible by hand, as today; Onshape's mirror constraint of two points maps to it already (the converter does).

**Deferred:** constraining to a copy in its own sketch (by design impossible; a later sketch projects it), a pattern along a curve, a pattern of a pattern, the offset of an outline as derived geometry (2a left it to step 6; it is one more kind of this entry), copies as points of a hole feature (a pattern of the hole feature does it now, D53).

### 6d Splines

**Cheap variant.** A curve kind `spline` over control points that are ordinary points of the sketch (own points or the origin): non-rational, clamped, cubic (lower with fewer points), uniform knots. The solver sees only the points: the adapter passes them and nothing for the curve, and the analysis of freedom gets no equation from it. Tangency at an end is a constraint on the end leg of the control polygon (a construction line through the first two control points, tangent to an arc), which existing constraints express. The profile samples the curve within the chord tolerance; its crossing test runs on the samples. The side face is a general surface (the kind of the side of a generated profile), its edges have the kind `other`, so they cannot be projected or chamfered (the limits of D23 and D63). The offset and the wall of a spline are refused with `invalidProfile` naming the curve; whether the revolve takes it as it is is to be checked in the design. A closed outline of one spline is a spline whose first and last points are one point.

**Why control points.** Every source of a spline that step 6 meets carries control points (from knowledge of the formats; the Onshape dump of the conversion was not looked at for it): Onshape's B-spline curves, a DXF `SPLINE`, a Bézier of an SVG path (one cubic Bézier is exactly a clamped cubic spline of four points). A curve "through points" is more natural to write by hand or for an AI; it can come later as a sketch tool that computes control points, or as a second variant of the curve.

**The full variant, deferred.** Read in the types of planegcs 1.3.0, not run: `bspline` takes poles, weights, knots, multiplicities, a degree and a periodic flag; `point_on_bspline` carries a parameter of the curve for every point on it; `tangent_at_bspline_knot` ties a line to a knot. A point on a spline therefore adds a solver variable that is neither a position nor a radius, so the port (`SolveInput` has `points` and `radii`) and the analysis would change. Not worth it until a part needs a point on a spline or a tangency in its middle.

### 6e Trim, extend and split

**Cheap variant: sketch tools** (`SKETCH_TOOLS`, reached by `sketch_tool` and by the app) over `setCurvePoint` (D52), with the patches of regions and walls of the fillet (`PROFILE_SOURCES`, `ids.patched`, `moved`, `shortened`). The intersections come from the solved positions; `carrierContacts` of `sketch.ts` computes them for lines, circles and arcs and is private today.

- **Split** a curve at its crossings with other curves (or at one chosen crossing): one piece keeps the ID, the others are new curves; new points at the crossings get `pointOnCurve` on the crossing curve; constraints that describe the whole curve (horizontal, a radius) are repeated on the new pieces, those on its points stay with the points. Splitting every crossing of a sketch is what the converter does by hand today without keeping constraints.
- **Trim** removes the piece under the cursor (a split, then the removal). A trimmed circle becomes an arc, which is another kind: it is removed and added again under its ID with its constraints (D52 measured that an ID removed in a batch can be reused and faces keep their names).
- **Extend** moves an end of a line or an arc to the nearest crossing of its extension with another curve (a new point with `pointOnCurve`, then `setCurvePoint`).

*Amended 2026-11-24.* Designed in full (D65, [6e-trim-extend-split/design.md](6e-trim-extend-split/design.md)) and revised after its review. The owner's answers: the places where curves cross, and why a profile is invalid, become a query in `QUERIES` with the app's marks as its view, so the AI sees them too (5); `equalLength` and `midpoint` of a cut line move to a construction line (7); a region that a trim joins with its neighbour is taken over into the feature's reference, also for a `cut`, whose pocket then swallows the neighbour (8); the edge lists of chamfers and fillets (D63) are rewritten as the faces are (9); an extend onto a circle that would make a valid profile invalid is refused with the reason (10); a trim repairs the other crossings of the sketch only when a feature reads regions of it, or the tool gets an option `repair: false`, because the T shapes of a sketch of walls are meant (11). Geometry that is not own is never cut, which is why the notch of scenario 15 goes into an own outline (6).

Through MCP an AI rarely needs them (it computes end points); the converter and a hand in the app do. **Deferred:** trim and split of a spline (splitting a B-spline changes its control points), extend to a projected curve beyond its ends, a chamfer of a sketch corner and removing a fillet (both named by D52 as tools over the same command).

### 6f Import of an outline

**Cheap variant.** A file read into an outline stored in the document (like a stored mesh of D55: inside the document, so it stays self-contained) and placed in a sketch as a kind of reference (a point of the sketch and a turn, both fields). The outline forms regions (a board is extruded from it directly) and its curves can be constrained to and projected. A tool `import_outline` reads a path, like `import_mesh`, and answers with the batch; the app has a button in the sketch panel. A revised file replaces the stored outline; entities keep their IDs only when the file lists them in the same order (matching a revision by geometry is deferred).

*Amended 2026-11-24*, before its design starts (findings 2, 8, 9 and 14 of the review):

- **Regions by a flag.** The entry has the flag `regions` that a projection of 6b has, default true, where the paragraph above says the outline forms regions (owner, answer 2, which amends the answer to question 4). Geometry that is not own is never cut by 6e's tools, so with regions always on, an own profile curve that crosses the outline makes the profile invalid for good, and a notch or a cut-out over a board outline cannot be drawn in its sketch. With the flag off, an own outline is drawn over the import, as the floor of scenario 15 is drawn over a projection.
- **The placement is not a point of the sketch.** A reference is computed before the solver, so its place cannot be an own point. It is coordinates and a turn as numeric fields of the entry (`external/<id>/…`, the slot 6c writes first), or `origin`, or a point of reference geometry; the design settles which. It also settles whether the reader is an entry of `IMPORT_FORMATS` or a tool of its own.
- **It assembles scenario 15** (owner, answer 3): the one model of the cover with the imported board in place of the stand-in, the checks of step 7, and the cases that cross two packages.
- **To design with it:** what `get_sketch` says of an entry of many entities within a limit (6c meets the same question with 200 copies); the third part of the rule of an update (an update that removes a constrained entity is refused); the list of its entities copied into the entry, since `entityOf` answers from the sketch alone.

**Needs:** every package before it in the sequence (6b for the same code of reference geometry, 6d for splines and Béziers, 6e and 6c for the tools and copies the assembled scenario runs).

**Formats, and whether a hand-written reader suffices.** No library: D2 would need the owner's approval, and none is needed for the subset.

- **DXF (first).** ASCII group codes (a code line and a value line). `LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE` and `POLYLINE`/`VERTEX` with bulges (arcs), `SPLINE` as a spline of 6d when it is cubic and not rational, otherwise refused and listed; units by `$INSUNITS`; layers chosen by name (a board outline is on its own layer). Binary DXF, `INSERT` of blocks, `ELLIPSE` and text are refused and listed. The engine writes DXF already (D54), so the reader is tested on the writer's files. From knowledge, not checked: PCB tools export the board outline as DXF with lines, arcs and circles.
- **SVG (second).** A hand-written reader of the subset: elements and attributes without a DTD; `path` with `M`, `L`, `H`, `V`, `Z`, `A` with equal radii (an arc), `C` and `Q` (a spline of 6d); `rect` (with `rx` as arcs), `circle`, `line`, `polyline`, `polygon`; `transform` with `translate`, `rotate`, uniform `scale` and `matrix` without shear; millimetres from `width`, `height` and `viewBox`. Ellipses, uneven scale, CSS and text are refused and listed. Drawing programs write curves as Béziers, so SVG without 6d is of little use.

**Why stored reference geometry and not own geometry.** The alternative is a tool that answers with a batch of `addPoint` and `addCurve`: no change of the document, the outline can be edited. But an outline is data from outside that should not drift when a point is dragged, it has to be replaceable by a revision, and hundreds of own points tied by `fixed` constraints would cost the analysis of freedom (it grows with the cube of the constraints: 480 constraints about 0.1 s, 960 about 0.8 s, as measured for `architecture/sketch.md`). The batch remains the fallback (question 6).

**Deferred:** STEP and other exact formats, text, matching a revision by geometry, an outline from a face of an imported mesh.

### 6g Gear as a block in a sketch: not proposed

The backlog already judged the gain small: a generated profile extrudes a gear, and an extrusion with `add` or `cut` combines it with anything else. As a block, the involute flanks would need a curve kind in the sketch (a sampled curve, or splines fitted to it) and an entry of derived geometry (6c's mechanism), and other curves crossing teeth would make fragile regions. If it is wanted later it is one more kind of 6c's entry on top of 6a and 6d. Recommendation: leave it in the backlog (question 7).

### 6h The Onshape converter on the tools of step 6

*Added 2026-11-24 (owner, answer 4; finding 7 of the review).* The measured need behind the step is the conversion: 287 of 380 sketch constraints lost, six sketches split by the converter with their constraints lost, derived sketches copied. No package owned it. 6e proposed the converter's part "if the owner wants it", 6c and 6b describe theirs as possible, 6d says "not in 6d", and the converter (`tools/onshape/sketch.ts`) still skips every constraint with an external operand, every pattern and mirror, and splits by itself. So the step could close with the losses unchanged. This point closes the step, and its acceptance is a number measured again.

**What it does**, in `tools/onshape` and [../onshape-import.md](../onshape-import.md) only:

1. **Counts first.** The 287 were never broken down by cause. The converter's report gets the skipped constraints by cause (an external operand by what it is: the origin, a default plane or axis, an edge, an entity of another sketch; a pattern or a mirror; a distance other than point–point and point–line; an angle; `FIX`), and the count is taken with the converter as it is today.
2. **Crossing curves** (6e): `splitAtCrossings` is replaced by one `split` without a curve, called after the curves and the constraints are added, so the constraints of the split curves are kept. The converter takes a point as on a curve within 1e-5 mm and the tools within 1e-6, so the regions of the six sketches are compared before and after, not only the time.
3. **Patterns and mirrors of curves** (6c): written as entries `pattern` of the sketch (`CIRCULAR_PATTERN`, the linear one, the mirror of curves). The mirror of two points stays a `symmetric` constraint.
4. **External operands** (6a2, 6b, D23): Onshape's origin point becomes `origin`; a default plane seen edge-on in a sketch becomes `origin/x` or `origin/y` by the sketch's matrix; an entity of another sketch of the studio becomes an entry `{ type: 'sketch' }`; an edge of a body an entry `{ type: 'edge' }`. Derived sketches (`importDerived`) are handled as 6b's design settles: they come from another part studio, which is another document, so they stay copies, with the constraints on them kept.
5. **Splines** (6d): Onshape's B-spline curves as `spline` where they are cubic and not rational; the others are listed. The disc of the converted model keeps its generator (D61).
6. **Counts again**, on the same model (the actuator of 14 part studios), by the same causes. What is still lost is listed by cause with where it stands: a distance other than point–point and point–line, an angle and `FIX` are not step 6's and become backlog rows if they have none.

**Acceptance:** the lost constraints of that model counted before and after, by cause, in `docs/onshape-import.md`; no sketch split with its constraints lost; the volumes of the parts unchanged against the report of today. No target count is set: without the breakdown nobody knows how many of the 287 are step 6's.

**Needs:** 6a2, 6e, 6c, 6b and 6d; nothing of 6f, which it follows only because it closes the step. It needs the dump of the Onshape model, which is not in the repository (`node tools/onshape/fetch.ts`, or the owner's copy). No decision number: it changes no behaviour of the engine, and its record is `docs/onshape-import.md`. A gap of the engine it finds is a backlog row or a package of its own. A `design.md` alone when its work starts, as 5f had.

## Where decisions fall

| Question | Decision of this plan | Why |
|---|---|---|
| Regions from crossing curves (Onshape and Fusion split by themselves) or trim as a tool | Tools: split, trim, extend (6e). Automatic regions are deferred | A region is named by the IDs of the curves of its outer loop (`RegionRef`) and a side face by its curve. Split automatically, a line through a circle gives two D-shaped regions with the same outer curves `{line, circle}`, the same name; the converter met exactly this ("matching by lines and circles alone confused mirrored regions"). A side split into two disjoint pieces of one plane would carry one name, and edges between named faces would be ambiguous. Naming the pieces needs new names (a point inside, an index), a change of `naming.md` that every reference depends on. A split tool gives each piece its own ID and keeps the constraints, which also closes the converter's loss |
| Constraints on the origin | The axes of the origin as fixed lines in 6b (amended 2026-11-24: in 6a2, before 6c); the origin point itself is the converter's (6h) | The engine accepts constraints on `origin` today (read); the converter drops them with every external operand (read) |
| Import of an outline | 6f: stored in the document as reference geometry; DXF first, a subset of SVG second; hand-written readers, no library | See 6f |
| Gear as a block | Not in step 6 | See 6g |
| Spline: full or cheap | Cheap (control points, the solver sees points) in 6d; the full variant deferred | The full variant changes the solver port (a parameter per point on the curve); the cheap one changes no port and covers outlines of covers, grips and cams and every imported spline |
| Mirror and pattern: derived or tool | Derived (6c) | The count follows a parameter and the IDs of copies stay |
| Where curves cross and why a profile is invalid (added 2026-11-24) | A query in `QUERIES`, in 6e; the app's marks are its view | A function exported beside the engine for the app alone is the hole D36 names: the AI had only `valid: false` |
| Who closes the measured need (added 2026-11-24) | 6h, the converter on the new tools, with the count of lost constraints as its acceptance | No package owned the converter; the step could close with the losses unchanged |

## Where the packages write to the same code

The rows for step 6 in "Shared places" of [README.md](README.md). In short: before 6a, every package but 6e would edit `sketch.ts` (the solver setup, the profile), `sketch-content.ts` (`entityOf`, `derivedPoints`), `features/sketch.ts` (the step, the validator, the references), `ExternalRef`, `Projected` and `SketchResult` in `types.ts`, and the sketch mode of the app (`sketch-mode.ts`, `sketch-view.ts`, `panels/sketch.ts`); 6d and 6e would add to every switch on the kind of a curve and to `SKETCH_TOOLS`. The solver adapter is touched by 6d alone (6b's axes are fixed lines as projected edges are; derived copies are computed after the solver). After 6a, a package adds a kind to the registry, a shape to the list of the profile, a tool to the app's table; what stays shared is the profile code (6c's joins, 6d's samples), the sketch commands in `document.ts` (6c, unless 6a makes its entries one family with `addExternal`), and the schema (6f adds a section, 6c a map if it is not in `external`).

*Amended 2026-11-24.* 6c's entries are in `external`, so only 6f touches the schema. The designs added shared places the paragraph above does not have, each written by an earlier package and added to by the later ones; they are rows of "Shared places" of the README and are walked through in "Where packages meet" of [6-cross-review.md](6-cross-review.md): the module `sketch-cut.ts` with the patches the fillet shares (6e creates it; 6c, 6b and 6d add to it), the sketch step (`features/sketch.ts`: 6a2 and 6b before the solver, 6c after it), `joinPairs` and `entityOf`, the face key, the test file of scenario 15, and the description of the kinds of entries for the AI.

## Order and tracks

*Amended 2026-11-24 (finding 3 of the review; the owner's answers 1 and 4).* The implementation of step 6 is **one sequence**:

```
6a ─▶ 6a2 ─▶ 6e ─▶ 6c ─▶ 6b ─▶ 6d ─▶ 6f ─▶ 6h
```

| Point | After | Because |
|---|---|---|
| 6a | D52 | Done (D64). Its fix after the review (`d36/6a-fix`) goes first |
| 6a2, the axes of the origin | 6a | The slot of 6a; 6c's main case needs the axes, and so does the stand-in board of the scenario |
| 6e, trim, extend and split | 6a (the table of the app's tools), D52 | The owner's first priority. It creates `sketch-cut.ts` and moves the fillet's helpers there |
| 6c, mirror and pattern | 6a2, 6e | It writes into 6e's module (the entries that list a cut source are patched there) and mirrors about `origin/y` |
| 6b, projection from another sketch | 6c, 6e | Its design is written against both: the position stage of 6c joins its curves, a projection of a copy; the profiles in memory and the lists of 6e's tools (`toolWorld`, `readersOf`) |
| 6d, splines | 6b, 6c, 6e | It adds the spline to 6c's derive, to 6e's switches and to 6b's validator. The compiler finds those; it does not find a reader of a loop without exact curves (finding 5), which 6d lists by hand |
| 6f, import of an outline | all of the above | The same code of reference geometry as 6b, the splines of 6d; it assembles scenario 15 |
| 6h, the converter | 6a2, 6e, 6c, 6b, 6d | It closes the step with the count of lost constraints |

Designs do not touch the code and can be written and reviewed side by side; the implementation and the merges go in this order, one tree at a time in the code of the sketch. Each earlier package states its plug-in points in "As implemented", and the later one adapts to them. A package that merges after 6d handles the spline (a projected or a mirrored spline) or refuses it with a reason, as before.

**The plan of 2026-11-17** drew four tracks after 6a, on the reading that no package needs another:

```
6a ──┬─▶ 6b ─▶ 6f       (track J, reference geometry; 6f also after 6d)
     ├─▶ 6c              (track K, derived geometry)
     ├─▶ 6d              (track L, the spline)
     └─▶ 6e              (track M, trim, extend, split; the engine side needs only D52)
```

The designs did not keep to it: 6c writes into 6e's code, 6b is written against the designs of 6c and 6e, 6d adds to 6c's derive and 6e's switches. A session that followed the tracks would have started 6b or 6d beside 6c and met it in the sketch step, `joinPairs`, `entityOf` and `sketch-cut.ts`.

**Priority (owner, 2026-11-17):** crossing curves first, then mirror and pattern in a sketch. So **6a and 6e** are designed at the same time (the engine side of 6e needs only D52; it waits for 6a only for the table of the app's sketch tools, so it is implemented right after 6a), then **6c** (designed once the vocabulary of 6a is settled), then **6b**, **6d** and **6f**. The plan proposed 6b and 6e first, then 6d, 6c, 6f (question 9). The sequence above keeps this priority; 6a2 goes before 6e because it is small and both 6e (an axis as a `with` curve) and 6c build on it.

## Validation scenario 15

*One text since 2026-11-24.* The review found three versions (this section, item 15 of `docs/requirements.md`, and the designs of 6e and 6b), and a step 2 that cannot be built: a constraint whose operands are all fixed is refused, so a skeleton of projections cannot put anything on an axis. The owner chose the base (answer 6) and who assembles the model (answer 3). Item 15 of `requirements.md` is the short form of this text; a design that changes the scenario changes both.

**A cover for a controller board**, built by an AI through commands and tools as an arm would need it. It covers every package and checks the things that break silently: names that survive a change, and geometry that follows a parameter.

1. **The board** (6f; a stand-in from 6a2). A DXF written by the test as a PCB tool would (an outline of lines with round corners as arcs, four mounting holes as circles, on a layer `Edge.Cuts`), imported into the sketch `board` and placed by the entry's fields so that its hole pairs are symmetric about the axes of the origin; extruded 1.6 mm as a reference body. The symmetry is the board's: nothing after it can move it. Until 6f the board is drawn by hand, its corners and holes placed by `symmetric` constraints about `origin/x` and `origin/y`, fully determined.
2. **A skeleton** (6b). The sketch `frame` on a parallel offset plane projects the outline and the hole circles of `board` and measures: two reference dimensions from the centres of a hole pair to `origin/y` read the same value. It constrains nothing of the board.
3. **The base** (6b with the offset of 2a), in three features, as a tray is modelled:
    - **the floor**: its sketch, on a plane below the board, projects the outline from `frame` without the region flag and holds an own outline on it (own points coincident with the projected ends, each own arc by a construction line from its centre to its start with the projected centre on it; fully determined, no redundant constraint), drawn by one call of 6b's tool `projectSketch`; the own outline is extruded with an offset of the clearance and the wall. (Amended 2026-11-24 with the revision of 6b's design: the arcs were held by `equalRadius`, which has a second solution that ordinary changes reach and none at a half turn, measured.) The notch of step 6 is cut into this outline, since projected curves are not cut;
    - **the rim**: its sketch projects the outline from `frame` with the region flag (one region of eight entries, their ends joined by position: owner, answer 19), added with the outer offset and pocketed with the offset of the clearance;
    - **the standoffs**: the four hole circles projected with the flag, an own circle around each centred on the projected centre; the rings are added, their bores named by the projections.
4. **The lid outline** (6c, 6d). The right half, its top ending on the Y axis, with a spline flank (a grip), mirrored about `origin/y` as an entry of the sketch; one region holds both halves and its side faces are named by the copies' IDs. Until 6d the flank is a line.
5. **Vents** (6c; the projection 6b). A slot and a linear pattern of it with the count `vents` in the lid's sketch are holes of the lid's region. A second row in a sketch of its own is cut through the lid by the regions of copies 1 and 3; that sketch projects one copy of the lid's outline and is dimensioned from it (a projection of a copy: 6b with 6c).
6. **Cable notches** (6e; the second 6c). A circle drawn across the bottom edge of the floor's own outline makes the profile invalid; two trims leave one closed loop with the arc of the notch, and the floor is patched in the same batch. A second notch is cut into the top line of the lid's source half: the entry of the mirror is patched and its copy follows (a cut of a source curve: 6e with 6c). With the spline flank in, the lid's region passes a spline when it is followed through that cut (6d: a loop without exact curves, finding 5 of the review). The numbers keep the radius of the floor's notch above the floor's offset, because 2a refuses an offset that swallows a concave arc (measured by the review of 6e: with the centre of the notch `notchY` inside the edge and its radius `r`, an outward offset `o` fits only while `notchY + o ≤ r − o`, which is `o ≤ 1.25` for the numbers of 6e's calls); or that notch is cut by a feature of its own without an offset. 6f settles the numbers when it assembles.
7. **Checks**, on the assembled model (6f). `vents` from 5 to 7: the cut keeps its regions and its references; 3: the cut is `noProfile` naming the region of copy 3, and 5 brings it back. A revised DXF of the board (2 mm wider): the projections follow, the own outline of the floor follows them, the rim, the standoffs and the mirrored lid follow, and no feature is in error. Volumes of the base and the lid by the query `mass` against values computed by hand for the parts without a spline. The section of the lid exported as DXF (D54) and read back by 6f gives the same areas.

**Who builds what** (owner, answer 3). Each package before 6f tests its own part on a stand-in, as a `describe` of its own in `packages/scenarios/test/scenario15.test.ts`, written from its `calls.ts`. Where two packages meet, the later one of the two writes the case when it is implemented. 6f, the last package, builds the cover as one model, puts the imported board in the place of the stand-in, and owns step 7 and the cases that cross packages.

| Package | Its part | Stands in for what comes later |
|---|---|---|
| 6a2 | The stand-in board of step 1: symmetric about the axes, fully determined | The board is drawn, not imported (6f) |
| 6e | The floor's notch of step 6, with `cableD` and the place of the notch following | A plain own outline in place of one held on a projection (6b); no offset, or numbers that fit it |
| 6c | Steps 4 and 5 and the second notch of step 6 | The flank is a line (6d); the second row is dimensioned without a projection (6b) |
| 6b | Steps 2 and 3, and the projection of a copy of step 5 | The stand-in board (6f) |
| 6d | The spline flank of step 4, mirrored, and the second notch of step 6 with the flank in | None |
| 6f | Step 1, step 7, and the whole as one model | None |

The steps of 6a are not in the scenario: it changes no behaviour, so its test is that every existing test passes unchanged. 6h is not in it either; its check is the count of lost constraints of the converted model.

**Against the text of 2026-11-17:** step 2 measured the symmetry instead of making it ("puts the centre lines on the axes of the origin" could not be built); the base was one extrusion of the projected outline with the region flag, which left the notch nothing it could cut; the second row of vents and the second notch are new, and are the two seams of packages that no step tested; the checks of step 7 had no owner.

## Questions for the owner

**Answered by the owner on 2026-11-17: all ten recommendations agreed**, with the priority changed: crossing curves (6e) first, then mirror and pattern in a sketch (6c), "if it makes sense"; it does (see "Order and tracks"). Three of the answers were amended by the owner on 2026-11-24, after the review of the step; each amendment stands under its question, and the question and its first answer are left as they were.

1. **6a as a preparatory package** (the registry of reference kinds, the profile from a list of shapes, exhaustive switches on the kind of a curve, the table of the app's sketch tools; no change of behaviour) together with the vocabulary of step 6, before any other package of step 6 is designed. *Recommendation: yes; full designs of 6b to 6f when each starts, as for steps 3 to 5.*
2. **Crossing curves**: tools (split, trim, extend) instead of regions made automatically. *Recommendation: tools; automatic regions deferred, because they need a new way of naming regions and side faces.*
3. **Mirror and pattern in a sketch as derived geometry** (the count a parameter, the copies not constrainable in their own sketch) rather than as a tool. *Recommendation: derived.*
4. **Which geometry that is not an own curve forms regions.** *Recommendation: copies of 6c as their source does; an imported outline always; a projected edge never (as today); a curve projected from another sketch not by default, with a flag on the reference to make it count (Onshape lets projected curves form regions, from knowledge, not checked; trymesh has so far not).*
    - *Amended 2026-11-24 (the owner's answer 2 to the review, finding 8):* an imported outline forms regions **by a flag, default true**, not always. 6e never cuts geometry that is not own, so an own profile curve that crosses an outline that always forms regions would make the profile invalid for good. The rest of the answer stands: copies as their source (a copy that lies on a curve before it forms none, 6c), a projected edge never, a projection from another sketch by its flag, default false.
5. **Splines: the cheap variant over control points**, cubic and clamped, with a curve through points as a later tool and the full variant (a point on the spline, a tangency in its middle, a change of the solver port) deferred. *Recommendation: yes.*
6. **The import of an outline as reference geometry stored in the document**, DXF first and a subset of SVG second, both read by hand-written code with no library. The alternative is a batch of own geometry, which changes nothing in the document. *Recommendation: stored reference geometry; the batch only if a stored section is not wanted.*
7. **The gear as a block** stays in the backlog and out of step 6. *Recommendation: yes.*
8. **The axes of the origin** as two fixed lines of every sketch under reserved derived IDs, in 6b. *Recommendation: yes; the converter maps Onshape's origin to `origin` and its axes to them.*
    - *Amended 2026-11-24 (the owner's answer 1, finding 10):* the axes are as answered, but in a point of their own, 6a2, before 6c, not in 6b. The converter's mapping is 6h's (answer 4).
9. **Priority**: 6a, then 6b and 6e, then 6d, 6c, 6f. *Recommendation: as written, since the converter's losses are the measured need; if drawing by hand matters more, 6e and 6d first.*
    - *Amended 2026-11-24 (finding 3):* the priority of 2026-11-17 stands (6e, then 6c), and the order is one sequence, 6a, 6a2, 6e, 6c, 6b, 6d, 6f, 6h, not tracks side by side.
10. **Small sketch tools** of the backlog ("Další nástroje skici": a slot, a rectangle from the centre) are not part of D36 step 6. They are entries of `SKETCH_TOOLS` and could ride with 6e. *Recommendation: only if a part of scenario 15 asks for them; the slot of step 5 of the scenario is drawn from lines and arcs.*

## Amendments after the review of step 6 (2026-11-24)

Four independent reviews ran on 2026-11-23: of 6a's implementation, of the designs of 6e and 6c, and one over the whole step, [6-cross-review.md](6-cross-review.md). The owner answered their eighteen questions on 2026-11-24, every one "yes" to its recommendation. The table "Decisions of the owner" of that file has all of them. Here is what each changes in this plan.

| Answer | What it changes here |
|---|---|
| 1. The axes of the origin before 6c | The point **6a2**, right after 6a; question 8 amended; 6b loses the axes |
| 2. An outline of 6f forms regions by a flag, default true | Question 4 amended; the outline of 6f |
| 3. 6f builds the assembled scenario 15, the others test on stand-ins | "Validation scenario 15", "Who builds what" |
| 4. The step closes with the converter on the new tools and the lost constraints measured again | The point **6h**, the last of the step |
| 5. The places where curves cross are a query in `QUERIES` | 6e; a row of "Where decisions fall" |
| 6. The base of scenario 15: a floor of own lines, a rim from the projected outline, standoffs | Step 3 of the scenario |
| 7 to 11. 6e: the construction line for `equalLength` and `midpoint`; a joined region taken over, for a `cut` too; the edge lists of D63 rewritten; an extend that would spoil a valid profile refused; a trim that repairs only where regions are read, or `repair: false` | The amended paragraph of 6e; its design's revision |
| 12 to 16. 6c: copies join by position; holes and walls at copies deferred; rule 0 dropped; a broad phase in the profile; the split that pulls in a crossing curve a known limit | The amended paragraph of 6c; its design's revision |
| 17. Derived geometry stays a kind of entry of `external` | The amended paragraph of 6a; its design |
| 18. A preparatory part that adds generic code not used yet gets at least a light review | The amended paragraph of 6a; CLAUDE.md, "Depth of the review" |
| 19, 21, 22 (the later answers, to the review of 6b's design): flagged projections join by position; `projectSketch` is a tool that keeps the role of each curve and can draw an own outline; a projected spline is refused | The second amendment of the paragraph of 6b; step 3 of the scenario; the design of 6a2 in a folder of its own (D71), since the axes left 6b's text |

Also from the review, without a question to the owner:

- **One sequence** (finding 3): "Order and tracks".
- **The vocabulary of 6a is amended in its own design** (finding 4), and a design that changes it later adds its line there in the same commit.
- **6f's placement** is not a point of the sketch (finding 9): its outline above.
- **To the backlog when the package that defers each closes:** the gear as a block (question 7); the offset of an outline as derived geometry (6c); holes and walls at copies (6c); a chamfer of a sketch corner and removing a fillet (6e); an own outline taken over from a projection as a tool, or as an option of 6b's tool for a whole sketch (6e, 6b; the scenario does it by hand with eight curves); the fillet of D52 moving `equalLength` and `midpoint` to a construction line as trim does (6e); what 6h still finds lost.
- **`docs/onshape-import.md`** is updated as each package closes, and by 6h at the end.

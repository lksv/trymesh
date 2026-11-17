# D36 step 6: the cut into work packages

The reasoning behind the rows 6a to 6g of [README.md](README.md). It is a plan, not a design: each package gets its own design (and its decision number, from D64) when its work starts. Written 2026-11-17 by reading the code at `41317d7`, the backlog and the notes of the Onshape conversion; nothing was run. Where a statement rests on reading only, it says so; the few counts were made with `grep`.

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

**So is it one foundation package or a vocabulary settled first? Both, in one small package.** The code that is hard-coded to the projected edge (the solver setup, the derived IDs, the sketch step and validator, the profile input, the view and the list of projections in the app) is the place every package of step 6 except trim would edit. That is the situation the preparatory step of D36 ([00-prep/design.md](00-prep/design.md)) was made for: turn it into a place where things are only added, with no change of behaviour, and write the shared vocabulary down before any package designs against it. Package **6a** is that, for step 6 only, and smaller: four mechanical changes and a vocabulary. The other packages need it; none of them needs another of them, apart from what is said in "Needs".

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

### 6b Projection from another sketch, and the axes of the origin

**Cheap variant.** A new kind of reference, `{ type: 'sketch', sketch, entity }`: a point, a line, a circle or an arc of an earlier sketch (its own, projected or derived entities), projected into this sketch when the two planes are parallel (either normal, any offset). The values come from the solved state of that sketch before this one; a failure freezes them as for an edge (`brokenProjection`). A tilted plane is `unsupportedProjection`, as for a circular edge today (it would be an ellipse). One reference per entity; projecting a whole sketch is a batch (a button in the app, a batch of `addExternal` through MCP), which is how the converter would turn `importDerived` into projections and keep the constraints on them. Projected curves do not form regions unless question 4 decides otherwise.

**The axes of the origin.** Every sketch gets two fixed lines through the origin along its X and Y, under reserved derived IDs (for example `origin/x` and `origin/y`; a slash cannot be in an ID a caller gives, so no document can have them already). They let a constraint say "on the X axis" or "symmetric about the Y axis" and serve as the axis of a mirror (6c). It belongs here because it is fixed reference geometry like a projection.

**Constraints on the origin, the Onshape gap.** Read in the code: the engine already accepts any constraint between `origin` and an own point (`constraint` in `features/sketch.ts` asks only that one operand can move), and the converter skips every Onshape constraint with an external operand (`tools/onshape/sketch.ts`, `p.externalFirst || p.externalSecond`), the origin point among them. So the part of the gap that is about the origin point is the converter's to close; what the engine lacks is the axes. How many of the 287 lost constraints are on the origin, the axes, an edge or another sketch was not counted.

**Deferred:** projection into a tilted plane (the ellipse), a projected spline before 6d is in (then it projects its control points), a reference to a whole sketch as one entry.

### 6c Mirror and pattern in a sketch

**Cheap variant: derived geometry.** An entry of the sketch names own curves and a transform: a mirror about a line (own, projected or an axis of 6b), a circular pattern about a point with a count and an angle, a linear pattern along a line with a count and a spacing. The count, the angle and the spacing are numeric fields, so they take expressions. After the solver, the copies are computed from the solved curves under derived IDs; they form regions like their source (a construction curve copies as one), name side faces, and later sketches can project them. A copy of a point that falls on its source (on the mirror axis, at the centre) is that point, which is what closes a mirrored half.

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

Through MCP an AI rarely needs them (it computes end points); the converter and a hand in the app do. **Deferred:** trim and split of a spline (splitting a B-spline changes its control points), extend to a projected curve beyond its ends, a chamfer of a sketch corner and removing a fillet (both named by D52 as tools over the same command).

### 6f Import of an outline

**Cheap variant.** A file read into an outline stored in the document (like a stored mesh of D55: inside the document, so it stays self-contained) and placed in a sketch as a kind of reference (a point of the sketch and a turn, both fields). The outline forms regions (a board is extruded from it directly) and its curves can be constrained to and projected. A tool `import_outline` reads a path, like `import_mesh`, and answers with the batch; the app has a button in the sketch panel. A revised file replaces the stored outline; entities keep their IDs only when the file lists them in the same order (matching a revision by geometry is deferred).

**Formats, and whether a hand-written reader suffices.** No library: D2 would need the owner's approval, and none is needed for the subset.

- **DXF (first).** ASCII group codes (a code line and a value line). `LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE` and `POLYLINE`/`VERTEX` with bulges (arcs), `SPLINE` as a spline of 6d when it is cubic and not rational, otherwise refused and listed; units by `$INSUNITS`; layers chosen by name (a board outline is on its own layer). Binary DXF, `INSERT` of blocks, `ELLIPSE` and text are refused and listed. The engine writes DXF already (D54), so the reader is tested on the writer's files. From knowledge, not checked: PCB tools export the board outline as DXF with lines, arcs and circles.
- **SVG (second).** A hand-written reader of the subset: elements and attributes without a DTD; `path` with `M`, `L`, `H`, `V`, `Z`, `A` with equal radii (an arc), `C` and `Q` (a spline of 6d); `rect` (with `rx` as arcs), `circle`, `line`, `polyline`, `polygon`; `transform` with `translate`, `rotate`, uniform `scale` and `matrix` without shear; millimetres from `width`, `height` and `viewBox`. Ellipses, uneven scale, CSS and text are refused and listed. Drawing programs write curves as Béziers, so SVG without 6d is of little use.

**Why stored reference geometry and not own geometry.** The alternative is a tool that answers with a batch of `addPoint` and `addCurve`: no change of the document, the outline can be edited. But an outline is data from outside that should not drift when a point is dragged, it has to be replaceable by a revision, and hundreds of own points tied by `fixed` constraints would cost the analysis of freedom (it grows with the cube of the constraints: 480 constraints about 0.1 s, 960 about 0.8 s, as measured for `architecture/sketch.md`). The batch remains the fallback (question 6).

**Deferred:** STEP and other exact formats, text, matching a revision by geometry, an outline from a face of an imported mesh.

### 6g Gear as a block in a sketch: not proposed

The backlog already judged the gain small: a generated profile extrudes a gear, and an extrusion with `add` or `cut` combines it with anything else. As a block, the involute flanks would need a curve kind in the sketch (a sampled curve, or splines fitted to it) and an entry of derived geometry (6c's mechanism), and other curves crossing teeth would make fragile regions. If it is wanted later it is one more kind of 6c's entry on top of 6a and 6d. Recommendation: leave it in the backlog (question 7).

## Where decisions fall

| Question | Decision of this plan | Why |
|---|---|---|
| Regions from crossing curves (Onshape and Fusion split by themselves) or trim as a tool | Tools: split, trim, extend (6e). Automatic regions are deferred | A region is named by the IDs of the curves of its outer loop (`RegionRef`) and a side face by its curve. Split automatically, a line through a circle gives two D-shaped regions with the same outer curves `{line, circle}`, the same name; the converter met exactly this ("matching by lines and circles alone confused mirrored regions"). A side split into two disjoint pieces of one plane would carry one name, and edges between named faces would be ambiguous. Naming the pieces needs new names (a point inside, an index), a change of `naming.md` that every reference depends on. A split tool gives each piece its own ID and keeps the constraints, which also closes the converter's loss |
| Constraints on the origin | The axes of the origin as fixed lines in 6b; the origin point itself is the converter's | The engine accepts constraints on `origin` today (read); the converter drops them with every external operand (read) |
| Import of an outline | 6f: stored in the document as reference geometry; DXF first, a subset of SVG second; hand-written readers, no library | See 6f |
| Gear as a block | Not in step 6 | See 6g |
| Spline: full or cheap | Cheap (control points, the solver sees points) in 6d; the full variant deferred | The full variant changes the solver port (a parameter per point on the curve); the cheap one changes no port and covers outlines of covers, grips and cams and every imported spline |
| Mirror and pattern: derived or tool | Derived (6c) | The count follows a parameter and the IDs of copies stay |

## Where the packages write to the same code

The rows for step 6 in "Shared places" of [README.md](README.md). In short: before 6a, every package but 6e would edit `sketch.ts` (the solver setup, the profile), `sketch-content.ts` (`entityOf`, `derivedPoints`), `features/sketch.ts` (the step, the validator, the references), `ExternalRef`, `Projected` and `SketchResult` in `types.ts`, and the sketch mode of the app (`sketch-mode.ts`, `sketch-view.ts`, `panels/sketch.ts`); 6d and 6e would add to every switch on the kind of a curve and to `SKETCH_TOOLS`. The solver adapter is touched by 6d alone (6b's axes are fixed lines as projected edges are; derived copies are computed after the solver). After 6a, a package adds a kind to the registry, a shape to the list of the profile, a tool to the app's table; what stays shared is the profile code (6c's joins, 6d's samples), the sketch commands in `document.ts` (6c, unless 6a makes its entries one family with `addExternal`), and the schema (6f adds a section, 6c a map if it is not in `external`).

## Order and tracks

```
6a ──┬─▶ 6b ─▶ 6f       (track J, reference geometry; 6f also after 6d)
     ├─▶ 6c              (track K, derived geometry)
     ├─▶ 6d              (track L, the spline)
     └─▶ 6e              (track M, trim, extend, split; the engine side needs only D52)
```

Proposed priority after 6a: **6b and 6e** first, because they close most of what the conversion lost (constraints on derived sketches and the axes, crossing curves split with their constraints); then **6d** (splines, which 6f needs); then **6c**; then **6f**. The order of D36 does not say more than "step 6", so this is a proposal (question 9). A package that merges after 6d adds the spline case to what it does (a projected spline, a mirrored spline) or refuses it with a reason.

## Validation scenario 15

**A cover for a controller board**, built by an AI through commands and tools as an arm would need it. It covers every package and checks the things that break silently: names that survive a change, and geometry that follows a parameter.

1. **The board** (6f): a DXF written by the test as a PCB tool would (an outline of lines with round corners as arcs, four mounting holes as circles, on a layer `Edge.Cuts`) imported into the sketch `board`, extruded 1.6 mm as a reference body.
2. **A skeleton** (6b): the sketch `frame` on a parallel offset plane projects the hole centres and the outline from `board`, and puts the centre lines on the axes of the origin (a hole pair symmetric about the Y axis).
3. **The base** (6b with the offset of 2a): its sketch projects the board outline from `frame`, marked to form regions (question 4), and extrudes the region with an offset of the clearance; four standoffs at the projected hole centres.
4. **The lid outline** (6d, 6c): one half drawn with a spline flank (a grip) and mirrored about the Y axis as derived geometry; the mirrored half closes into one region with the original.
5. **Vents** (6c): one slot and a linear pattern in the sketch with the count `vents`; the cut through the lid uses the regions of copies 1 and 3.
6. **A cable notch** (6e): a circle drawn across the edge of the base outline makes the profile invalid; split and trim leave one closed loop, and the extrusion of the base is patched.
7. **Checks.** `vents` from 5 to 7: the cut keeps its regions and its references. A revised DXF of the board (2 mm wider): the projections follow, the base and the lid follow, no feature is in error. Volumes of base and lid by the query `mass` against hand-computed values for the parts without a spline; the section of the lid exported as DXF (D54) and read back by 6f gives the same areas.

The steps of 6a are not in the scenario: it changes no behaviour, so its test is that every existing test passes unchanged.

## Questions for the owner

1. **6a as a preparatory package** (the registry of reference kinds, the profile from a list of shapes, exhaustive switches on the kind of a curve, the table of the app's sketch tools; no change of behaviour) together with the vocabulary of step 6, before any other package of step 6 is designed. *Recommendation: yes; full designs of 6b to 6f when each starts, as for steps 3 to 5.*
2. **Crossing curves**: tools (split, trim, extend) instead of regions made automatically. *Recommendation: tools; automatic regions deferred, because they need a new way of naming regions and side faces.*
3. **Mirror and pattern in a sketch as derived geometry** (the count a parameter, the copies not constrainable in their own sketch) rather than as a tool. *Recommendation: derived.*
4. **Which geometry that is not an own curve forms regions.** *Recommendation: copies of 6c as their source does; an imported outline always; a projected edge never (as today); a curve projected from another sketch not by default, with a flag on the reference to make it count (Onshape lets projected curves form regions, from knowledge, not checked; trymesh has so far not).*
5. **Splines: the cheap variant over control points**, cubic and clamped, with a curve through points as a later tool and the full variant (a point on the spline, a tangency in its middle, a change of the solver port) deferred. *Recommendation: yes.*
6. **The import of an outline as reference geometry stored in the document**, DXF first and a subset of SVG second, both read by hand-written code with no library. The alternative is a batch of own geometry, which changes nothing in the document. *Recommendation: stored reference geometry; the batch only if a stored section is not wanted.*
7. **The gear as a block** stays in the backlog and out of step 6. *Recommendation: yes.*
8. **The axes of the origin** as two fixed lines of every sketch under reserved derived IDs, in 6b. *Recommendation: yes; the converter maps Onshape's origin to `origin` and its axes to them.*
9. **Priority**: 6a, then 6b and 6e, then 6d, 6c, 6f. *Recommendation: as written, since the converter's losses are the measured need; if drawing by hand matters more, 6e and 6d first.*
10. **Small sketch tools** of the backlog ("Další nástroje skici": a slot, a rectangle from the centre) are not part of D36 step 6. They are entries of `SKETCH_TOOLS` and could ride with 6e. *Recommendation: only if a part of scenario 15 asks for them; the slot of step 5 of the scenario is drawn from lines and arcs.*

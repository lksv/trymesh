# 2d Re-pointing a point of a curve, fillet of a sketch corner (D52)

**State: designed (2026-11-16), not implemented.** With the fixes of its reviews ("Reviews"). Written against the code of `master` at `cdf5995`, where tracks A, B, E and H are merged. What depends on the solver and on the kernel was measured against the real adapters ("Measured"); the command itself does not exist yet, so the measurements edit a saved document where the command would run.

Files: [contract.ts](contract.ts) (the command, the tool, the rule of the solver adapter), [calls.ts](calls.ts) (its part of validation scenario 12).

The package is three things, and the third was not expected:

1. a command, `setCurvePoint`, that gives a curve of a sketch another point and keeps its ID;
2. a sketch tool, `fillet`, that rounds the corner of two lines with it and repairs the features that named the corner;
3. a change of the planegcs adapter, without which the solver cannot keep a fillet once it is drawn exactly.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Fillet of a sketch corner": a tool of the shared module (sketch, the corner point, radius) that makes an arc with its centre, two tangencies, a radius dimension and the two lines shortened; a command that re-points an end of a curve keeps the ID of the line and so the names of the faces; the tool returns `updateFeature` patches for the extrusions whose region gets the arc; open is what happens to dimensions on the corner point.

| Statement | What the code says |
|---|---|
| "There is no command that changes the end point of a curve" | True: a curve is made by `addCurve`, removed by `removeEntity`, and `setConstruction` is the only command that changes one. The validator `curve` (`features/sketch.ts`) judges a curve as a whole, so a changed curve can be given to it as it is |
| "Remove-and-add changes its ID and with it the names of the faces" | Not as stated. A side face is `{ feature, role: 'side', curve }`, a wall side `wallSide` with the curve, so a line that keeps its ID keeps them (measured: no face of the box of scenario 12 is lost). But an ID that was removed is free again: `removeEntity` and `addCurve` under the same ID in one batch are accepted, and the faces keep their names (measured). What that way loses is what stood on the curve: `removeEntity` removes its constraints with it (measured: the `vertical` of the side is gone), with their values and expressions. The command is still the cheaper way, for another reason than the backlog gives ("Rejected alternatives", 1) |
| "A region is identified by the set of curve IDs on its outer loop; the arc joins the loop, so every extrusion that uses the region becomes a broken reference" | True (`sameRegion`, `recompute/profile.ts`). The error is `noProfile`, and everything that stands on a face of that extrusion is a `brokenReference` (measured) |
| "The tool can see the document, so it can return `updateFeature` patches" | It cannot today: `SketchToolContext` holds the sketch, its solved state and the parameters. The document is added to it. `updateFeature` with `{ profile: { regions } }` replaces the list and verifies only references the feature did not have, so the patch is accepted in the batch that adds the arc |
| "An arc, two tangencies, a radius dimension" | The document holds that today. **The solver adapter does not keep it.** A fillet drawn exactly is accepted, and every later change (its radius, a size of the outline, an angle) is a `sketchConflict` that names the two tangencies. The same holds on `master` for a slot drawn by hand at exact coordinates. "Measured" has the cases, "The solver adapter" the cause and the cure |
| Not in the backlog: the projected edges of the two lines | The edge of a cap with the side face of either line ends at the arc after the fillet. It is still there and still a line, so a sketch that projects it gets no warning, and what is tied to its end at the corner moves (`projectEdge` of `solid.ts` gives a projected line the extent of the edge) |
| "Filleting a corner of a fresh sketch works without any of that" | Without the patches, yes. Not without the adapter: a fresh sketch is dimensioned afterwards |
| Not in the backlog: a wall names curves too | The profile source `wall` (D44, after the backlog entry) lists the curves of its chain. A wall along both lines of the corner needs the arc in its list as a region does |
| Not in the backlog: a side face starts where its line starts | The origin of the planar side face of a line is the start (`a`) of the line ([naming.md](../../architecture/naming.md), "Rovina skici na stěně"). Shortening a line at its start moves the origin, and a sketch on that face moves with it, without an error (measured: the brace of scenario 12 moves by 4 mm) |
| Not in the backlog: constraints that measure the length of a line | `equalLength` and `midpoint` read the two end points of a line. After a fillet they measure the shortened line (measured: a square held by `equalLength` becomes 40 × 45 with the status `ok`) |

## The cheap variant

- **The command `setCurvePoint`** `{ sketch, id, point, to }`: one point of one own curve is replaced by another own point of the sketch (or `origin`). The curve keeps its ID, kind, direction, construction flag and constraints. It covers every point of a curve (`a`, `b`; `center`, `start`, `end`), because the validation is the same for all of them.
- **The tool `fillet`** `{ corner, radius }`: the corner is the ID of the point where exactly two lines end. It draws the arc with its three points at their exact places, re-points the two lines, adds two tangencies and a driving radius dimension (a number or an expression), and keeps the corner point as the crossing of the two lines (two `pointOnCurve` constraints).
- **In the same batch** it adds the arc to every region and every wall of the document that names both lines (`ids.patched`). It names what follows the corner without an error and is not patched: the sketches and plane features on a side face that starts at the corner (`ids.moved`), and the walls along one of the two lines and the sketches that project an edge of their side faces (`ids.shortened`).
- **The planegcs adapter** gives a tangency of a line and an arc that share an end point to the library in a form its analysis of redundancy can handle.
- **The app** gets the tool *Fillet* on the sketch bar and a row that re-points a point of a selected curve to a selected point. **MCP** gets both without code of its own beyond one sentence of the description and one example.
- **The document does not change its shape**: no schema step.

**Deferred:**

- A fillet between a line and an arc, or two arcs; a chamfer of a corner (the same re-point, a line in place of the arc).
- The same repair of the adapter for two arcs that are tangent at a common end point (an S). The defect is there on `master` and stays; the fillet of two lines does not meet it. What was measured for it is in "The solver adapter".
- A rule that keeps a fillet a fillet after later changes (the ends of the arc between the corner and the far ends of the lines). The solver has no inequality; see "Known limits".
- A corner whose two ends are two points joined by a `coincident` constraint. The caller joins them first: `setCurvePoint` of one line onto the point of the other (scenario 12 does it for a gusset).
- Lines that carry `equalLength` or `midpoint`: refused. Moving such a constraint onto a construction line between the corner and the far end would keep its meaning; it is left out because a second fillet on the same line would have to know about that line.
- Removing a fillet as a tool. Undo takes back the one just made; later it is a batch by hand (two `setCurvePoint` back to the corner, `removeEntity` of the centre and of the two ends, the two `pointOnCurve` constraints, and the regions patched back).
- Trim and extend (step 6): tools over the same command.
- A fillet as a number of the extrusion ("round these corners by r"), see "Rejected alternatives".

## Measured

**Recipe.** Spike files outside the repository, in the scratchpad of the session (`scratchpad/2d/`), run from the worktree with `npx vitest run --config <scratchpad>/2d/vitest.config.ts` against the real planegcs and Manifold adapters:

- `fillet.ts`: the tool as a prototype. It reads a state, computes the fillet and edits a copy of the saved document (the lines keep their IDs, as `setCurvePoint` will keep them); the test loads it. `checkFillet` reads a solved sketch and says whether the arc is still the fillet of its corner (ends between the corner and the far ends of the lines, radii square to the lines, a turn below 180°).
- `solver-patched.ts`: the adapter of `master`, copied, with a switch for how a tangency at a common end is given to the library.
- `a-sketch.spike.ts` (the solver), `b-existing.spike.ts` (shapes drawn by hand on `master`), `c-solid.spike.ts` (bodies), `d-limits.spike.ts` (fillets that stop fitting), `e-scenario.spike.ts` (the numbers of `calls.ts`).
- After the first round of reviews: `f-review1.spike.ts` (two arcs with their centres at one place; a fillet of lines that carry no closed outline), `g-review1.spike.ts` (a line removed and added under its ID), `h-review1.spike.ts` (a slot whose ends are joined by `coincident` constraints), `i-review1.spike.ts` (documents saved by the adapter of `master`, loaded with the rule), `j-review1.spike.ts` (a projected edge and a wall along one line under a fillet).
- A copy of `packages/` with the adapter changed as proposed, and `npx vitest run` over all of it.

### A fillet in the solver, four ways to hold the arc

One document (the arc, the shortened lines, the corner kept on both lines, the radius dimension), held tangent in four ways:

- **as on `master`**: two `tangent` constraints, translated to `tangent_la` (the centre is the radius away from the line);
- **square radius**: the same two `tangent` constraints, the adapter gives each as `perpendicular_pppp` (the radius to the common point is square to the line). *This is the design.*
- **angle at the point**: the same constraints as `angle_via_point` with 0 or π, the form FreeCAD's own fillet uses;
- **two radii**: the adapter as on `master`; the tool draws two construction lines from the centre to the ends of the arc and makes each `perpendicular` to its line, in place of the tangencies.

A rectangle 80 × 50, fully dimensioned, a corner tied to the origin; fillets of 6. `+` solved and every fillet intact; `c` a conflict (the sketch keeps its last shape); `x` solved into a crossed outline (`valid: false`, an extrusion on it is `invalidProfile`); `X!` solved, the profile valid, and the arc no longer a fillet.

| Case | as on `master` | square radius | angle at the point | two radii |
|---|---|---|---|---|
| One corner drawn: solved, freedom 0 before and after, the engine's diagnosis without a redundant constraint | yes; the library calls both tangencies redundant | yes; the library calls nothing redundant | yes | yes |
| All four corners drawn | + | + | + | + |
| The radius of one corner set to 1, 0.05, 12, 20, 24, 24.9, 25, 26, 30 | c every time | + every time | + every time | + every time |
| The radius of all four set to 2, 12, 20, 24.9 | c | + | c every time, and it stays in conflict when set back | + |
| The size set to 200 × 50, 20 × 50, 13 × 50, 12.5 × 50, 80 × 300, 80 × 12.2, 800 × 500 | c | + | c | + |
| A corner of a triangle at 15°, 30°, 60°, 90°, 120°, 150°, 170° (radius 3), then its angle changed by +20°, −10°, +60° and back | drawn +, every change c | + throughout | + throughout | + throughout |
| A point of a fillet dragged in the determined sketch | X! (the redundant tangency is left out of the drag, and the arc comes off its line) | + | c | + |
| A free rectangle (four degrees of freedom): freedom after the fillet, then the filleted corner dragged | 4; the first drag X! | 4; + while the rectangle is larger than the fillet, x when it is dragged smaller than the radius or inside out, + again when dragged back | 4; not followed further | as the square radius |

What a fillet does when it stops fitting, with the square radius (the plate 80 × 50 with four fillets of 6, each change as a preview from that state):

| Change | Sketch | Extrusion |
|---|---|---|
| One radius 30, 43.9 (the short side has 44 left) | solved | ok |
| One radius 44 (the side is used up), 44.5, 60 | `sketchConflict`, the last shape stays | ok, unchanged |
| One radius 50 | solved, `valid: false` | `invalidProfile` |
| All radii 24.9 | solved | ok |
| All radii 25 (the short sides are used up), 26, 40 | `sketchConflict` | ok, unchanged |
| The height 12.2 | solved | ok |
| The height 12 (two fillets use it up), 11.9, 10 | `sketchConflict` | ok, unchanged |
| The height 5 | solved, `valid: false` | `invalidProfile` |

With the square radius no case of either table ends in a body that is wrong without a message: it is fine, a conflict, or an invalid profile. The list of constraints a conflict names is often most of the sketch (for the radius 44 all 27 it has); it does not point at the radius.

**That holds for these cases, not in general.** The constraints say "tangent" and "this radius"; nothing says that an end of the arc stays between the corner and the far end of its line. On a closed outline the far end belongs to the next line, so an arc that runs past it crosses the outline or pushes against the other dimensions. Where the lines carry no closed outline, the arc can run past (measured after the first review):

| Case | Sketch | What is built on it |
|---|---|---|
| The bend of the bracket of scenario 12 (construction lines 11 and 13 long, a wall along them), its radius set to 9, 10.9 | solved, a fillet | ok |
| The same, 11 and 12 | solved, `valid: true`; the end of the arc is at the far end of the line or past it | the wall is `invalidProfile` ("the curve has no length", "no longer meet") |
| The same, 20 and 35 | `sketchConflict` | ok, unchanged |
| Two construction lines 40 and 30 long from one fixed corner, nothing built on them, the radius set from 6 to 35 | solved, `ok`, no warning; the ends of the arc are at (35, 0) and (0, 35), the second 5 past the far end of its line | nothing |

So a later change can leave a solved sketch whose arc is no longer the fillet of its corner, without a message, when nothing reads the lines as a profile ("Known limits").

Also measured:

- **The corner point cannot simply go.** In the dimensioned rectangle the dimension of the height stands on it.
- **A constraint on the length of a filleted line changes the shape.** A square 40 wide held by `equalLength` of two sides; a fillet of 5 at their corner: the status is `ok` and the corner is at (40, 45). The shortened side is 40 long now.
- **What a re-point must not leave.** A document in which a line ends at the point a `midpoint` constraint puts in its middle is refused on load ("středem úsečky nemůže být její konec"), and so is a line with both ends at one point. The command has to refuse both, or it would write a document that does not load.
- **A line removed and added again under its ID** (`g-review1.spike.ts`): the batch `removeEntity`, `addCurve` with the same ID is accepted, the extrusion on the outline stays `ok` and its faces keep their names. The constraint on the line (`vertical`) is gone with it, and the line is the last of the sketch's curves.

### Shapes drawn by hand, on `master`

No fillet tool: a slot (two lines, two half circles sharing their end points, four tangencies, two radii, the length) drawn with its points off the exact shape by a given distance, then its dimensions changed.

| Drawn off by | Drawn | Then `r = 6`, `r2 = 6`, `len = 30`, `r = 5`, `r2 = 5`, `len = 20.5` |
|---|---|---|
| 0 or 1e-12 | solved; the library calls all four tangencies redundant | conflict, solved, conflict, conflict, conflict, conflict |
| 1e-9, 1e-6, 1e-3, 0.3 | solved; nothing redundant | solved every time |

With the square radius every row is solved every time.

The same slot with the ends of the lines and of the arcs as points of their own, joined by four `coincident` constraints (`h-review1.spike.ts`), the same six changes:

| Drawn off by | `master` | the square radius where the end is one point ID | the square radius also where a `coincident` constraint joins the two ends |
|---|---|---|---|
| 0 or 1e-12 | drawn solved, all four tangencies redundant for the library; five of the six changes are conflicts | as `master` (the rule does not see a common point) | solved every time, nothing redundant |
| 1e-9, 1e-6, 1e-3 | solved every time | solved every time | solved every time |

So on `master` a shape with a tangency at a common end point works only as long as the solver's own noise (about 1e-10) keeps the state from being exact. A model drawn by an AI from computed coordinates is exact.

**Two arcs** that join smoothly in a common end point (an S) have the same defect on `master`: drawn exactly, two of four changes of a radius are conflicts. Three forms were measured for it (`b-existing`, `f-review1`), on the S and on two arcs of one circle whose centres are two points 0, 1e-9, 1e-3 and 2 apart:

| Form | The S, exact | Centres at one place or nearly |
|---|---|---|
| as on `master` (`tangent_aa`) | two of four changes are conflicts | one conflict with the centres 0 apart, else solved |
| the common point on the line of the two centres | solved | drawn as a conflict at 0 apart; two of three changes are conflicts at 1e-9 and 1e-3 (the line has no length) |
| the second centre on the line of the first centre and the common point | solved | solved every time |

The third form measured well and is not taken here, for the reason in "The solver adapter".

### All tests with the adapter changed

A copy of `packages/` (the worktree's `node_modules` linked in), `npx vitest run`:

- unchanged: 1324 of 1325 pass; the one failure is the time limit of `gear.test.ts` under load, which CLAUDE.md names;
- with the rule of "The solver adapter" in `translate` (a line and an arc, the common end by ID or by a `coincident` constraint): 1325 of 1325 pass, the solver's own tests, the tests of the analysis and the snapshots of the app included. The same count with the rule by ID alone, and with the first version of the design, which also changed two arcs.

### Bodies

A plate 80 × 50 × 10 from the rectangle, a fillet of 6 at the corner `o3`:

- Without the patch of the region: the extrusion is `noProfile` and the three sketches on its faces `brokenReference`.
- With it: all `ok`. The faces are the six of before under their names and `E/side/<arc>`, a cylinder. The volume is 39922.1505, which is the plate with the corner of 6 × 6 replaced by a quarter polygon of 14 sides, to the last digit shown.
- The sketch on the side of `oc` (which starts at the corner) has its origin at (74, 50, 0) in place of (80, 50, 0). The one on the side of `ob` (which ends there) and the one on the top stay.
- The edge between the two side faces is gone; a projection of it gets the warning `brokenProjection`. The edges of the round face with its two neighbours are of the kind `other` (a plane touching a cylinder), so they cannot be projected; its edges with the caps are circles.

The finished box of scenario 12 (22 features: the box, its cavity by an offset, the lid with a tapered lip, ribs, posts up to the lid, a brace, holes from the catalogs), then the four corners of its outline filleted by `cornerR = 6`:

- All 22 features `ok` after each fillet. Five extrusions read the outline and all five are patched. No face of the box or the lid is lost; 20 are new (16 cylinders, and 4 cones on the lip, which has a lead-in). The box and the lid do not collide, and the lip is 0.19 from the cavity at a round corner (0.2 by design, measured on the mesh with an accuracy of 0.02).
- The origin of `braceSketch`, which stands on the side of the cavity made from `od`, moves from (2, 48, 0) to (2, 44, 0), and the brace with it; nothing reports it. With its dimension rewritten the brace is back where it was.
- `cornerR = 8` and `4`: all `ok`. `cornerR = 3.7`: the inside of the lip, offset by −3.7, is `invalidProfile` with the message of D44 ("leaves no radius for the arcs … give the corners a radius larger than the offset"). `cornerR = 2`: the cavity as well, and what stands in it with it.
- `L = 120`, `W = 30`, `wall = 3` under the fillets: all `ok`. Saved and loaded: the same document and the same volumes.
- The rim of a round corner on the top of the lid projects as a circle: centre (74, 44), radius 6.
- Four fillets, each a load and a full recompute of the box: under a second together.

The bracket of scenario 12 (a wall 2 thick along two construction lines): a fillet of 4 at its corner makes a construction arc, the wall gets it into its curves, and the box has two more faces (`wallSide` of the arc, left and right) and loses none. A radius of 1 or less is `invalidProfile` of the wall ("leaves no radius for the arc"); 1.1 works.

What follows a fillet without an error besides a plane (`j-review1.spike.ts`, on the same box):

- A sketch on the top of the lid projects the edge of the top with the side face of `ob` as a line, and a point is tied to each end of the projection. The projection runs from (80, 0) to (80, 50). After the fillet at `o3` it runs to (80, 44), after the one at `o2` from (80, 6); the points follow, the sketch is `ok` and has no warning.
- A wall along `b12` alone, one of the two lines of the bracket: after the fillet of the bend it is 7 long in place of 11 (its volume 134.4 in place of 211.2), still names `b12` alone, is `ok`, and its straight end is `wallEnd/<end of the arc>` in place of `wallEnd/b2`.

The bare command, as an edit of the document: the rib's line re-pointed to a new start keeps all four faces of the rib under their names, and the brace that ends in its side follows (38.15 to 39.02 long in place of 37.38 to 37.54). Two lines whose ends are two points at one place are "not connected" for a wall; after one is re-pointed onto the point of the other the wall builds.

## Decisions

### The command

```ts
{ type: 'setCurvePoint'; sketch: Id; id: Id; point: 'a' | 'b' | 'center' | 'start' | 'end'; to: Id }
```

- **One point of one curve per command.** `point` is the name the curve has for it; `to` is an own point of the sketch or `origin`. A batch re-points several.
- **Validation is three checks.**
  1. `point` is a name the kind of the curve has (`CURVE_POINTS` of the contract: `a`, `b` of a line; `center` of a circle; `center`, `start`, `end` of an arc). The validator of a curve ignores fields it does not know, so without this check `center` on a line would be accepted and change nothing.
  2. The changed curve goes through `curve` of `features/sketch.ts` (the points exist, are own or the origin, and differ).
  3. The own rule of the catalog (`check` of `CONSTRAINTS`) is asked again for every constraint that names the curve, because two of them read the points of a curve: `symmetric` (a symmetric point is not an end of the axis) and `midpoint` (the point is not an end of the line). A command that would break one is invalid and names the constraint. Nothing else about a constraint depends on which points a curve has: its operands are IDs of entities and their kinds do not change.
- **It covers the centre too.** The package is named for the ends; the same code re-points a centre, and "two circles on one centre point" is a use. The app offers every point of the curve (below).
- **The old point stays**, with its constraints, also when no curve uses it. The fillet depends on that; a caller that wants it gone sends `removeEntity`.
- **Nothing is solved or moved by the command.** The stamp of the solved state is a fingerprint of the curves and constraints, so it stops matching and the recompute solves. The stored positions are the estimate, as after `addCurve`.
- **What follows in other features is the recompute's business**, by the rule of every command: a region may be gone (`noProfile`), the straight end of a wall is renamed when its chain's free end was re-pointed (`wallEnd` carries the point), a side face starts elsewhere. The comment of the command in `types.ts` says the three, because an AI reads it.

### The corner point stays: the virtual corner

The backlog left open what happens to dimensions and constraints on the corner point: keep the point, or move them to the ends of the arc.

- **The point stays, and two `pointOnCurve` constraints hold it on the two lines** (a point on a line is on its extension as well). It is the crossing of the two lines: the sharp corner the fillet replaced.
- Everything that stood on it keeps its meaning. The width of the box is still a dimension between two corner points and still 80; a diagonal to the corner still ends there; a hole feature or an axis that names the point still has it.
- The freedom of the sketch does not change: three new points are six coordinates, and the rule of the arc, two tangencies, two points on lines and the radius are six equations (measured: 0 before and after for the dimensioned rectangle, 4 and 4 for the free one).
- Moving the dimensions to the ends of the arc would change what they measure (the box would be 80 between tangent points, so 92 wide), and the corner point could not be removed anyway while a dimension stands on it (measured).
- It is what SolidWorks does with "keep constrained corners" and FreeCAD with "preserve corner": a point at the virtual intersection, held on both lines.
- A corner point nothing else uses stays as well: one rule, and a later dimension to the sharp corner finds it.

### The solver adapter

**The cause.** A line that ends on an arc at one of the arc's ends, and is tangent to it, touches it at that point. The library's tangency of a line and an arc says "the centre is the radius away from the line". In that state its derivative is the derivative of the rule of the arc (the end is the radius away from the centre) with the opposite sign: a double root. planegcs finds redundant constraints from the derivatives at the estimate, calls the tangency redundant when the estimate is exact, solves without it and then reports it as conflicting when a changed dimension moved the rest. The engine has known the double root since D32 on the side of its own analysis ([sketch.md](../../architecture/sketch.md), "Dvojnásobné kořeny"), which reads such a tangency as "the radius is square to the line at that point". The adapter did not follow.

**The cure.** `translate` of `packages/solver-planegcs/src/index.ts` gets one case, decided from the curves and the constraints of the input, never from positions:

| `tangent` of | When | Given to the library as |
|---|---|---|
| a line and an arc | an end of the arc (`start` or `end`) is an end of the line (`a` or `b`): the same point ID, or two points that one `coincident` constraint of the input names together | `perpendicular_pppp(centre, that end of the arc, line.a, line.b)` |

- **It says the same as the form of today** wherever the line has a length: the arc passes through its end by the rule of an arc, the end is on the line (it is an end of the line, or held on one by the constraint), and a line through a point of a circle is tangent exactly when the radius to that point is square to it. The form of today is an unsigned distance, so it holds no side of the line that the new form would lose.
- **Where they differ:** a line of no length satisfies the new form and has no meaning in the old one. In a sketch that leaves the line free to collapse, a collapse is a solution; the profile then reports a curve of no length (`valid: false`), as measured in the rows marked `x`.
- The constraint keeps its ID, so `conflicting` and `redundant` name it as before.
- Everything else stays: a line and a circle, a circle and an arc, two circles, two arcs, and a line and an arc whose common point is held otherwise (a chain of `coincident` constraints through a third point, `pointOnCurve` of the arc's end with the line).
- **The join by a `coincident` constraint** was added after the first review. The defect is the same there and so is the cure (measured, the second table of "Shapes drawn by hand"), and a slot drawn with joined ends is as likely from an AI as one with shared points. Only a direct join is read: it is what was measured. A constraint the engine left out of the input (one on a lost projection) is not there to be read, so the rule cannot rest on a join the solver does not hold.

**Two arcs are left as they are.** The first version of this design changed them too ("the common point lies on the line of the two centres"). Both reviewers found that form wrong, and measurement agrees: its line has no length when the two centres are at one place. The form that measured well ("the second centre lies on the line of the first centre and the common point") is still not the same statement as the form of today: `tangent_aa` holds the kind of contact (the arcs on opposite sides of the common tangent, or on the same side) that the estimate has, and a point on a line allows both. A solution of the other kind, an S turned into a cusp, would be returned as solved. Curing it needs a check of the kind in the adapter's test of a usable result and tests of its own (an exact S and an exact inner contact under large changes). The fillet of two lines draws no tangency of two arcs, so this is not paid for here; "For the plan" has the row for the backlog.

**What it does to existing documents.**

- The solver is called at every recompute of a sketch, also on load when the stamp of the inputs matches (`step` of `features/sketch.ts`). With a matching stamp the positions are the stored ones; the status, `sketchConflict`, `conflicting` and `redundant` come from that call, so from the new form.
- A stored state that satisfies the form of today satisfies the new one: an exact state exactly, one the solver left (off tangent by its noise, because of the double root) within the solver's tolerance. Measured (`i-review1.spike.ts`): twelve slots saved by the adapter of `master` (ends as one point and ends joined by `coincident`; drawn off by 0 to 0.3, the noisy ones after two changes of their dimensions) and loaded with the rule. Each loads `ok` with no warning and no point moved, and each can be changed afterwards, the exact ones included, which `master` could not change.
- The list `redundant` of a sketch result, which repeats what the library says, no longer names such tangencies (the engine's own diagnosis never did).
- A sketch that is solved again (after an edit) is solved through the new form; all tests pass with it, the snapshots of the app included.

**Why not without the adapter.** The tool could draw two construction radii and make them `perpendicular` to the lines; it measures exactly like the square radius. It was not taken: every fillet would carry two more lines in the sketch, the document would not say "tangent", and a tangent arc drawn by hand or by an AI (a slot, a rounded outline) would stay broken on `master`. It is the fallback if the owner does not want the adapter changed with this package ("Open").

### What the tool does to the features that use the sketch

The tool reads `context.document` and adds to its batch, after the sketch commands:

- **Regions.** For every feature with a profile source of regions over this sketch: a region whose outer loop names both lines gets the arc, and the feature is patched (`updateFeature` with `{ profile: { regions } }`, the whole list). When two lines that are not construction end at a corner, every loop that passes one of them passes the other, so "names both" is "passes the corner".
- **Walls.** For every feature with a wall over this sketch whose curves name both lines: the arc is added (`{ profile: { curves } }`).
- **Which features have a profile source** is a table typed over the feature types, in `sketch-tools.ts`: today the extrusion alone. A feature type added later does not compile until it says whether it has one (the revolve of 4a will).
- Features that are suppressed or in error are patched like the others. Holes, patterns and joints name points, not curves, and need nothing.
- The patched features are returned in `ids.patched`.

**What follows the corner without an error** and is not patched is named in two lists. Both hold the features that read the changed geometry directly. What is built on a listed feature (a body extruded from a listed sketch, a sketch on that body) follows it and is not listed.

- **`ids.moved`: a plane starts elsewhere.** A planar side face has its origin at the start (`a`) of its line. Of the two lines, zero, one or both start at the corner. Listed are the sketches whose plane, and the plane features whose base, is a face in the role `side` or `wallSide` whose curve is a line of the two that starts at the corner. The tool does not say by how much: with a profile offset or a wall the face starts at the moved line's start, not at the sketch point. The state before and after says it (`features[id].plane.origin`), and a preview of the batch shows it without writing.
- **`ids.shortened`: one of the lines is read without the other.**
  - An extrusion whose wall names exactly one of the two lines. It needs no arc and gets none; its chain ended at the corner and ends at the arc now, so the wall is shorter by the length the fillet took.
  - A sketch that projects an edge of a face in the role `side` or `wallSide` whose curve is either line. The edge of that face with a cap ends at the arc now, so the end of the projected line has moved and what is tied to it follows. The tool does not work out which end of an edge is at the corner, so an edge at the far end of the line is named as well. The edge between the side faces of the two lines is the exception: it is gone, and the recompute reports it.
- Both lists read face names, so they see what stands on a face of a pattern copy as well, and need no geometry.

**What breaks with an error** is not listed, because the result of the batch lists it (`problems` of the MCP answer, the model panel of the app): a projection of the edge between the two side faces (`brokenProjection`), a feature with an inward offset or a wall thickness that leaves the arc no radius (`invalidProfile`, with the text of D44), a reference to the straight end of a wall that ended at the corner (the face is `wallEnd` with the point the chain ends at, and that point is now the end of the arc).

**What the lists do not cover.** They are what the tool can read from names in the document. A feature that names the corner point keeps it: a hole placed on the corner point stays at the sharp corner, which the body no longer has. A measurement or a check that reads a length of the outline reads the new one.

### What the tool refuses

It answers `ok: false` with a reason and draws nothing:

- **The corner.** The curves that count are the own curves of the sketch that end at the vertex of the corner: a line by `a` or `b`, an arc by `start` or `end`. The vertex is the corner point and the own points a satisfied `coincident` constraint joins to it, as the profile joins them (`pointJoins` of `sketch.ts`). Projected curves never count, and a centre is not an end. Of the curves that count, those that are not construction curves are taken; if there are none, the construction ones. They have to be exactly two lines, and both have to end at the corner point itself.
  - So the corner of a rectangle with a construction diagonal is filleted and the diagonal stays on the point; the bend of a wall along construction lines is filleted with a construction arc; a corner tied to a projected point by `coincident` (what a snap of an anchor makes) is filleted.
  - A point where a line meets an arc, or three lines meet, or one line ends, is refused with what ends there.
  - When one of the two lines ends at another point of the vertex, the corner is two points. It is refused with that point named; the caller makes it one point first (`setCurvePoint`).
- **The lines.** With the tolerances of the engine (`LENGTH_TOLERANCE` 1e-6 mm, `ANGLE_TOLERANCE` 1e-4 rad, `util.ts`):
  - a line of the two shorter than the length tolerance (it has no direction);
  - the angle between the two lines within the angle tolerance of 0 or of π ("parallel": folded onto each other, or one straight line through the corner).
- **A radius that does not fit**: what would be left of a line (its length less the tangent length `r / tan(θ/2)`) is not above the length tolerance. The message gives the largest radius that fits (the shorter of the two lines times the tangent of half the angle between them).
- **A radius too small to draw**: the tangent length or the chord of the arc is not above the length tolerance. A shorter curve is "a curve of no length" for the profile and would make every extrusion of the sketch invalid.
- **A point out of range**: a coordinate of the centre or of an end of the arc beyond ±`MAX_NUMBER`, which `addPoint` would refuse (the polygon checks its points the same way).
- **A radius as an expression without a value**: the tool has to place the arc, so it evaluates the expression with the parameters of the context (as the polygon does for its size). Without parameters, or with an expression in error, it is refused.
- **`equalLength` or `midpoint` on one of the two lines**, named in the message.

Not checked: whether the arc crosses another curve. The sketch then has no valid profile, as after any drawing.

## The tool, step by step

Inputs `{ corner: Id; radius: number | Expr }`. With `u1`, `u2` the directions from the corner along the two lines, `θ` the angle between them and `r` the radius:

1. The ends of the arc are `corner + (r / tan(θ/2)) · u`, the centre is on the bisector, `r / sin(θ/2)` from the corner. Positions come from the solved state.
2. The batch: `addPoint` × 3; `setCurvePoint` × 2 (the end of each line that was the corner); `addCurve` of the arc, counter-clockwise the short way round, a construction curve when the lines are; `addConstraint` × 5 (`tangent` × 2, `pointOnCurve` of the corner with each line, `radius`, driving, with the value given); the patches.
3. `ids`: `arc`, `center`, `lines` (the two lines in the order of their IDs), `ends` (`ends[i]` is the new end of `lines[i]`), `constraints` (the four without a value), `radius`, `patched`, `moved`, `shortened`. Every list is always there; the last three may be empty, and each is in the order of the timeline.

The context of a tool gets the document as a required field. The fillet without it would draw the arc and break every feature on the sketch, so there is no call without it; the other tools do not read it.

The batch is solved once, after its last command, and is already satisfied as drawn. One undo takes it back, the patches included.

A `pointOnCurve` of the corner with one of its lines may be in the sketch already (it is allowed, and redundant while the line ends there). The engine refuses the same constraint twice, so the tool does not add it again and returns the one that is there.

## The document and the schema

- **No field is added.** A filleted sketch holds points, a line with other end points, an arc and constraints of kinds every build knows; a patched extrusion holds a longer list of curve IDs.
- **No upgrade step and no new version.** A build without the package reads such a document and gets the same model, because it uses the stored solution. What it cannot do is change it: its solver answers the next change of a dimension with a conflict. That is a warning in the result, not something dropped without a word, and it is the defect of `master` described above, not a property of the document.
- `validateDocument` needs nothing new: a document a re-point leaves is one the validators of today accept or refuse by the same rules as the command.

## Where the code lives

| File | What 2d does there |
|---|---|
| `types.ts` | the member `setCurvePoint` of `Command` with its comment (the description for the AI is generated from it) |
| `document.ts` | the branch of `applyCommand`: the curve through `curve`, then the catalog's rule for the constraints on it |
| `features/sketch.ts` | the rule of a constraint against the points of a curve, taken out of `constraint` so that the command can ask it |
| `sketch-tools.ts` | the input kind `point` and its check; `document` in the context; the tool and its entry; the table of profile sources by feature type; `nearestCurvePoint`, which point of a curve is nearest to a place (for the app's default) |
| `packages/solver-planegcs/src/index.ts` | the case of `translate`, which now gets the constraints of the input as well |
| `packages/mcp/src/api.ts` | the text of the input kind, a sentence of the section "Sketch tools" about tools that change what is drawn, the example of the fillet |
| `packages/mcp/src/tools.ts` | `sketchToolBatch` passes the document |
| `packages/app/src/sketch-view.ts` | `sketchView` is given the document and the values of the parameters: it builds `SketchView.source`, the context of the tools |
| `packages/app/src/sketch-mode.ts`, `sketch-commands.ts`, `panels/sketch.ts` | the tool *Fillet*, its radius, the row *Re-point* |
| `docs/architecture/sketch.md`, `api.md`, `ports.md`, `docs/ui/sketch.md`, `verification.md` | the tool and the command, the adapter's third exception, the UI rows, the tests |

## The app and MCP

**MCP.**

- `setCurvePoint` is reached by `execute` and `preview` like every command, and is in `describe_api` from `types.ts`.
- `fillet` is reached by `sketch_tool`; its description (inputs, lists of IDs, the summary) is generated from the catalog. The answer of `sketch_tool` carries `ids`, with `patched`, `moved` and `shortened`, and the `problems` of the model after the batch, so a dependant that broke is in the same answer. `preview: true` shows all of it without writing.
- An example of a tool is run by a test on an empty sketch; the fillet needs a corner. Its example names the corner the example of the rectangle leaves, and the test runs it after that one.

**The app.**

- **The tool *Fillet*** on the sketch bar. One click on a point; a click elsewhere says what the tool wants. While it is active the panel has its option, *Radius*: a number or an expression (the field of the forms), 2 mm at first, remembered for the next corner. A refusal of the tool is said in the status line with its reason. After a fillet the status line says how many features got the arc and names the features of `moved` and `shortened`.
- The batch of the fillet is sent as the tool made it: the switch *Konstrukčně* of the sketch bar does not turn its arc into a construction curve (the arc follows its lines).
- **The row *Re-point*** in the panel of the sketch, offered when the selection is one own curve and one own point (or the origin). It has a choice of the points the curve has, by its kind (*Start* and *End* of a line; *Centre* of a circle; *Centre*, *Start* and *End* of an arc), and a button that sends `setCurvePoint` for the chosen one. The point of the curve nearest to the selected point is chosen at first. So the app reaches every point the command does. Which point is nearest is asked of the shared module (`nearestCurvePoint`), not computed in the app.
- The context of the sketch tools (`SketchView.source`, built by `sketchView` of `sketch-view.ts`) gets the document and the values of the parameters where the open sketch is read (`sketchContextOf`).

## Issue codes

None is added. The command has the texts of an invalid command; the tool answers with a reason as text, like the rectangle and the polygon.

## Shared places

- **Takes:** `SKETCH_TOOLS` and `sketchTool` (D35 point 7), `updateFeature`, the catalog of constraints.
- **Adds:** one member of `Command`; one entry and one input kind of the sketch tools; the document in their context. `applyCommand` gets a branch, as the plan foresaw for 2d.
- **Not in the plan's table:** the solver adapter. No other package of D36 writes there.

## Rejected alternatives

1. **Remove the lines and add them again under their IDs** (no engine change). It is possible: an ID that was removed is free, the batch is accepted and the faces keep their names (measured). The backlog's reason against it, that the IDs change, does not hold. What it costs: `removeEntity` takes every constraint on the line with it, so the tool has to read them all and add each again under its ID, with its value, its expression and its driving flag, and get it right for every kind of constraint there is and will be; the same again in trim, extend and chamfer; and by hand through MCP, where a forgotten constraint is a sketch that silently lost a dimension. The command is one small branch that reuses the validator of a curve, and it says what is meant. So the command is the better way, but it is a convenience and a safety, not a necessity.
2. **A region reference that tolerates an added curve.** A region is "the loop with these curves" on purpose ([naming.md](../../architecture/naming.md): replacing one curve by another between the same points drops the region, because a looser rule is ambiguous). Loosening it for every reference to serve one tool is the wider change the backlog named.
3. **The fillet as a field of the extrusion** ("round these corner points by r", like the offset). No change of the sketch, no patches, nothing for the solver. But the arc would not be in the sketch (nothing can be dimensioned to it, a second extrusion of the same outline needs the same field), it needs a face role of its own, and the offset and the taper, which map every curve to one curve, would have to carry a curve that has no sketch curve. It is derived geometry by another door (step 6).
4. **A command that does the whole fillet in the engine.** The sketch tools exist so that the engine has small commands and shapes are batches of them; the tool needs nothing a batch cannot say once the re-point exists.
5. **A command that replaces a curve as a whole** (`setCurve` with a new shape). It could change the kind of a curve, which invalidates constraints by kind and the radius of a circle; restricted to the same kind it is this command with more to validate.
6. **The corner point removed, or its dimensions moved to the ends of the arc.** Above.
7. **The fillet with the adapter as it is.** Measured: it cannot be changed after it is drawn.
8. **Drawing the fillet a little off**, so that the library does not see the double root. It works by noise: off by 1e-9 passes, off by 1e-12 does not, and a solved state is as exact as the solver happened to leave it.
9. **Two construction radii in place of the tangencies.** Above; the fallback.
10. **The angle at the common point** (`angle_via_point`), FreeCAD's form. Measured: four fillets of one rectangle are in conflict at every change of their radii.
11. **An anchor as the input for the corner.** An anchor is a place that may make a point, and an AI has to give coordinates with it; the fillet names a point that is there.
12. **A list of notes in the result of a tool** (text about what moved). The tool cannot say by how much in general, and the IDs with the description of the list say the rest.
13. **Refusing a fillet that moves a sketch.** Any change of a dimension moves sketches on side faces the same way; the tool can at least name them.
14. **Leaving the patches to the caller.** An AI would do it; the app has no place to, and a fillet that breaks five features until five more commands are sent is not a tool.
15. **The two-arc case in the adapter.** "The common point on the line of the two centres" is singular for centres at one place (measured); "the second centre on the line of the first centre and the common point" loses the kind of contact. "The solver adapter" has both.
16. **The adapter's rule by point ID alone** (the first version). A slot with ends joined by `coincident` keeps the defect (measured), and the engine's analysis already reads an end held on the curve by a constraint as the double root.
17. **The adapter's rule over every way an end can be held on the line**: chains of `coincident` constraints, `pointOnCurve` of the arc's end with the line. The same equation would hold. Not taken now: only the direct join was measured, and a chain needs the joins of the whole input worked out at every solve. It is the next step if such a sketch turns up ("Known limits").
18. **The document optional in the context of a tool** (the first version). A fillet called without it would answer `ok` with empty lists and break every feature on the sketch.
19. **One list for everything that follows the corner.** A plane that starts elsewhere and a wall that got shorter ask for different checks; two lists say which.
20. **Listing everything that moves, to the end of the timeline.** That is the dependency graph of the recompute, not something a sketch tool reads from names; the features that read the corner directly are the ones to check, and the rest follows them.

## Known limits

- Two lines only; one point as the corner; no `equalLength` or `midpoint` on the lines. So no corner of a shape the polygon tool drew can be filleted: every side of it carries `equalLength`.
- **Nothing keeps a fillet a fillet.** The sketch holds an arc, two tangencies and a radius, not "the ends of the arc lie on the lines between the corner and their far ends". On a closed outline a change that leaves the arc no room showed as a conflict or as an invalid profile in every case measured. Where the lines carry no closed outline (construction lines, an open chain) it can be solved into an arc that runs past the end of a line: a wall along them then fails (`invalidProfile`), and with nothing built on them there is no message at all (measured). A check would have to know which arcs are fillets, which the document does not record.
- A conflict of a fillet that stopped fitting names most of the sketch, not the radius.
- A sketch or a plane feature on a side face that starts at the corner moves; a wall along one of the two lines gets shorter; the end of a projected edge moves. These are named (`moved`, `shortened`), not prevented, and the distance is not given. Only the features that read the corner directly are named, and `shortened` also names a sketch whose projected edge is at the far end of the line.
- A feature that names the corner point keeps the sharp corner (a hole there is outside the round body).
- The edge between the two side faces is gone, and the new edges of the round face with its neighbours cannot be projected (kind `other`); the rims of the round face on the caps can (circles).
- A profile offset inwards, a taper or a wall has to leave the arc a radius. The box of scenario 12 needs a corner radius above `wall + clearance + lipT`; below that the features with the larger offsets are `invalidProfile`. The narrow variant of D44 that drops such arcs ([backlog.md](../../backlog.md), "corner arcs that drop out") would lift this, and round corners make it more likely to be wanted.
- The patches cover the features that are in the document when the tool runs. A feature added later picks its region with the arc in it by itself.
- **The adapter's rule** reads a common end by ID or by one `coincident` constraint. A line and an arc joined through a third point, an arc that ends on a line by `pointOnCurve`, a line that ends on a full circle, and two arcs tangent at a common end keep the form of today. For two arcs the defect is measured (drawn at exact coordinates, an S cannot always be changed afterwards); for the others it is to be expected by the same reasoning and was not measured.
- The new form is satisfied by a line of no length; a sketch that lets the line collapse can solve into that, and the profile then reports it.
- A build before this package opens a filleted document as the same model and cannot change its dimensions.
- There is no tool that removes a fillet.

## To verify before the implementation

- The command through `execute` and `preview`: the measurements edited documents. In particular a batch that re-points and patches is atomic, and one undo restores the regions.
- That `setCurvePoint` to the point a curve already has makes no undo step (the engine compares documents).
- The drags of the app on a filleted sketch, through the real tool.
- The adapter's rule during a drag. A drag leaves the redundant primitives out; if a join that the rule read were among them, the tangency would be solved against an end that is free for that pass. The result is solved again without the drag before it is returned, so it cannot come back wrong; whether such a drag ends as a conflict was not measured.
- The lists `moved` and `shortened` on a pattern copy: the prototype read plain face names only.
- The example of the fillet in the test of the MCP description, which runs every example.
- The snapshots of the app: the sketch bar gets a tool, so the record of what the page shows changes there and nowhere else.

## Tests the implementation owes

- **Engine, the command:** every point name of every kind, and a name the kind does not have; the refusals of `calls.ts`, each with the index of the command and its reason; the same point; the stamp; the old point kept.
- **Engine, the tool:**
  - the batch and the IDs; construction lines; a corner at the origin; a corner with a construction diagonal; a corner tied to a projected point; an expression as the radius;
  - each refusal, with its tolerance from both sides (a radius just under the largest that fits and just over; lines nearly parallel; a radius too small; a point out of range; a corner of two joined points);
  - the patches of regions and walls;
  - `moved` with two lines that start at the corner, with one and with none, and with a plane feature on the face;
  - `shortened` with a wall along one line and with a projected edge, and the edge between the two side faces not in it.
- **Solver adapter:**
  - an exact fillet and an exact slot, each changed afterwards, with the ends as one point and with the ends joined by `coincident`;
  - the IDs in `conflicting`;
  - a join through a third point and two arcs keep the form of today;
  - a document saved by `master`, loaded: an exact slot and one drawn off by 1e-6, each without a warning and with its points unchanged;
  - a fillet of two construction lines with nothing built on them, its radius set past the end of a line: the known limit, pinned as it is.
- **Scenarios:** the cases of spike A as regressions (radii, sizes, angles, drags); scenario 12.
- **MCP:** the description of the tool and of the input kind, the example, `patched`, `moved` and `shortened` in the answer.
- **App:** the tool, its option, a refusal, the row *Re-point* with each point of a line, a circle and an arc.

The review of the implementation is a full one: it changes how the solver is called.

## Open

For the owner:

1. **The adapter.** May 2d change the planegcs adapter as above (a tangency of a line and an arc at a common end given to the library as a square radius; all tests pass with it, and documents saved by `master` load unchanged), or should the fillet leave the adapter alone and draw two construction radii per corner? Recommended: the adapter; it also repairs slots and rounded outlines drawn at exact coordinates, which are broken on `master` today.
2. **The corner point.** It stays as the virtual corner, held on both lines, so dimensions keep measuring to the sharp corner (the open point of the backlog). Decided here; say so if the dimensions should move to the arc instead.

## For the plan

- **4a (revolve)** takes a profile source: the table of the fillet will ask for its line.
- **Step 6.** Trim and extend are tools over `setCurvePoint`. Pattern and mirror in a sketch as a tool has the problem of the regions this package solves for the fillet; it can patch the same way and return `patched`.
- **The backlog** keeps from its entry what is deferred here (a line with an arc, a chamfer, removing a fillet), and its remark on corner arcs that drop out gains a use. Its sentence that remove-and-add changes the ID of a line is to be corrected (the constraints are what is lost).
- **Two rows for the backlog:**
  - *A tangency of two arcs at a common end point cannot be changed after it is drawn exactly* (the defect of `master` this package cures for a line and an arc). Measured: "the second centre on the line of the first centre and the common point" solves every case tried; it needs a check that the kind of contact is the one of the estimate. The same for an arc's end held on a line by `pointOnCurve` or through a chain of joins.
  - *A fillet that later changes turn into something else* (an arc past the end of its line, no message when nothing is built on the lines). It needs the sketch to know which arcs are fillets.
- **Shared places:** the plan lists "Sketch commands and `sketch.ts`" for 2d. The package does not write to `sketch.ts`; it writes to the solver adapter, which the plan does not list.

## Reviews

Three reviewers were asked, each to check the design against the code of `master` without changing a file: a fresh subagent (Fable, high effort), `codex` (gpt-6-astra, high) and `agy` (gemini-4-argon-high). **`agy` could not run in any round**: its service answered with HTTP 429, the quota of the account used up, to be reset in about 110 hours. The rounds went on with the other two.

### Round 1 (the design of commit `04988a1`)

`codex` had 8 findings (4 major, 4 minor), the subagent 14 (2 major, 8 minor, 4 notes). Several are the same finding from both, and one finding of `codex` (about `moved`) is three rows here. Each was checked against the code or measured before it was acted on; all were accepted, two of them in part.

| # | Finding | Reviewer | Severity | Accepted? | What changed |
|---|---|---|---|---|---|
| 1 | The two-arc form of the adapter is singular when the two centres are at one place (two point IDs do not mean two places) | codex 1, subagent 2 | major | yes; measured: a conflict with the centres 0, 1e-9 and 1e-3 apart | The two-arc case is taken out of the package and left as on `master`; the measurements of three forms are in "Measured" and a row is proposed for the backlog |
| 2 | The two-arc form does not hold the kind of contact that `tangent_aa` holds, so "both say the same" is wrong | subagent 2 | major | yes | As 1. The sentence is narrowed to the line and the arc, with where the two forms differ (a line of no length) |
| 3 | A fillet that stops fitting is not always a conflict or an invalid profile: construction lines with nothing on them solve into an arc past the end of a line, without a message | codex 2 | major | yes; measured: the bare lines `ok` at radius 35, the bracket `invalidProfile` at 11 and 12, a conflict at 20 and 35 | The claim is limited to what was measured, in "Measured", the summary of the tool and "Known limits"; a test pins the limit; a row for the backlog |
| 4 | `moved` is not all that changes without an error: projections of the edges that got shorter, and a wall along one of the two lines | codex 3, subagent 1 | major | yes; measured: the projection ends at (80, 44) with no warning, the wall is 7 long in place of 11 | A second list, `shortened`, with both; "What follows the corner without an error" rewritten |
| 5 | `moved` follows planes but not what is built on a listed sketch | codex 3 | major | in part: the scope is defined, not widened | Both lists name the features that read the corner directly; what is built on them follows and is not listed (alternative 20) |
| 6 | `moved` is written for one line that starts at the corner; it can be none or both | codex 3, subagent 8 | minor | yes | "A line of the two that starts at the corner", zero, one or both; tests of each |
| 7 | The app cannot re-point a centre, nor the farther end | codex 4, subagent 13 | major (codex), note (subagent) | yes | The row *Re-point* with a choice of every point the curve has, the nearest chosen at first, asked of the shared module |
| 8 | A generated point can be out of the range of coordinates | codex 5 | minor | yes | A refusal, as in the polygon |
| 9 | No tolerances in the refusals: parallel lines, a fillet that leaves no length | codex 5, subagent 7 | minor | yes | "The lines", "A radius that does not fit", "A radius too small to draw" with the tolerances of the engine |
| 10 | `refusedRepoints` of `calls.ts` is refused for another reason: the constraint ID `mid` is a point of `postSketch` | codex 6, subagent 3 | minor | yes | Other IDs; the refusals of the commands return the index of the command that failed |
| 11 | The refusal of an unknown expression is tested on a corner that is already filleted | codex 6, subagent 4 | minor | yes | The refusals of the tool run before the bracket is filleted |
| 12 | Remove-and-add does not change the ID of a curve: an ID that was removed is free | codex 7 | minor | yes; measured: the batch is accepted, the faces keep their names, the constraint of the line is lost | The row of the backlog table and alternative 1 rewritten: the command is the cheaper and safer way, not the only one |
| 13 | The summary promises "one more side face, a cylinder"; a wall gets two faces and a tapered extrusion a cone | codex 8 | minor | yes | The summary of the tool |
| 14 | "Nothing on load" leaves out that the solver is called on load | subagent 5 | minor | yes; measured: twelve slots saved by `master` load with no warning and no point moved | "What it does to existing documents" rewritten with the measurement; a test |
| 15 | "A corner of more than one point" does not say which curves count; read literally a corner tied to a projected point is refused | subagent 6 | minor | yes | "The corner": own curves over the vertex, one construction filter, projected curves never |
| 16 | A missing alternative: the adapter's rule over `coincident` joins | subagent 9 | minor | in part: a direct join is taken, a chain is not | Measured (a slot with joined ends has the defect, the rule cures it, all tests pass); the rule reads one `coincident` constraint; alternatives 16 and 17 |
| 17 | The optional document in the context is a silent trap | subagent 10 | minor | yes | Required in the type |
| 18 | The command has three rules, not "the validator plus one" | subagent 11 | note | yes | "The command" |
| 19 | `sketch-view.ts` is missing from "Where the code lives" | subagent 12 | note | yes | The table |
| 20 | `perpendicular_pppp` is satisfied by a line of no length; no corner of a polygon of the tool can be filleted | subagent 14 | note | yes | "The solver adapter", "Known limits" |
| 21 | The preview sketch `rims` of `calls.ts` has the ID of a sketch the test of the scenario uses | found while fixing | note | yes | Another ID |

The round had more than six findings with at least three serious, so a second round followed.

## Rows for the indexes

**`docs/d36/README.md`, the row of 2d** (column "Design now"):

> full ([2d-sketch-fillet/design.md](2d-sketch-fillet/design.md), D52): the command `setCurvePoint`, the sketch tool `fillet` with the patches of regions and walls and the lists `patched`, `moved` and `shortened`, and a change of the planegcs adapter (a tangency of a line and an arc at a common end as a square radius), without which a fillet cannot be changed after it is drawn; no schema step

and in "Numbers": decisions D52 taken by 2d, next D53; scenario 12 gets the part of 2d. The row "Sketch commands and `sketch.ts`" of "Shared places" becomes "Sketch commands (`applyCommand`), `sketch-tools.ts`, the planegcs adapter".

**`docs/decisions.md`, the row of the table:**

> | D52 | [2d Re-pointing a point of a curve and the fillet of a sketch corner](d36/2d-sketch-fillet/design.md) | designed 2026-11-16 | A command that gives a curve another point and keeps its ID; a sketch tool that fillets the corner of two lines, keeps the corner point as the virtual corner, adds the arc to the regions and walls that passed it and names what follows the corner without an error; the solver adapter gives a tangency of a line and an arc at a common end as a square radius |

**`docs/requirements.md`, scenario 12, a part after "Holes with hardware":**

> - *Round corners (2d, D52).* The finished box gets round vertical edges: a parameter `cornerR = 6` and the sketch tool `fillet` at the four corners of the outline. Each fillet is one batch: an arc tangent to the two lines, which are shortened and keep their IDs, the corner point kept on both lines, a radius dimension with the expression, and the arc added to the region of the five features that read the outline. All features stay `ok`, no face of the box or the lid is lost, twenty round faces are new, the width and the height are still measured between the sharp corners, and the lid still fits. The fillet at the corner where the line `od` starts names the sketch of the brace, which stands on a side face of that line and moves 4 mm with its start; its dimension is rewritten. What reads one line of a corner without the other is named as well (tried on a preview): a sketch that projects the edge of the lid's top with the side of `ob`, whose projection ends at the arc afterwards with no warning, and a wall along one line of the bracket alone, which is 7 long in place of 11. The radius follows its parameter; at 3.7 the inside of the lip, offset by as much, is an error of that feature. The rim of a round corner projects as a circle. The bracket gets a round bend: a fillet of its two construction lines makes a construction arc and adds it to the curves of the wall. Refused: a corner that was filleted, the end of one line, a point no line ends at, a radius the lines are too short for, a radius that is an expression without a value. By the bare command `setCurvePoint` the foot of the rib is moved to a new point (its faces keep their names and the brace that ends in its side follows), and two lines of a gusset drawn with separate end points are joined so that a wall along them builds. Refused: both ends of a line at one point, a point of another sketch, a line ending at the point a `midpoint` constraint puts in its middle. At the port of the solver a fillet drawn exactly is solved again with another radius.

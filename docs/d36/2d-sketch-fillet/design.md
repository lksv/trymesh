# 2d Re-pointing a point of a curve, fillet of a sketch corner (D52)

**State: designed (2026-11-16), not implemented.** First version, before its reviews ("Reviews"). Written against the code of `master` at `cdf5995`, where tracks A, B, E and H are merged. What depends on the solver and on the kernel was measured against the real adapters ("Measured"); the command itself does not exist yet, so the measurements edit a saved document where the command would run.

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
| "Remove-and-add changes its ID and with it the names of the faces" | True: a side face is `{ feature, role: 'side', curve }`, a wall side `wallSide` with the curve. A line that keeps its ID keeps them (measured: no face of the box of scenario 12 is lost) |
| "A region is identified by the set of curve IDs on its outer loop; the arc joins the loop, so every extrusion that uses the region becomes a broken reference" | True (`sameRegion`, `recompute/profile.ts`). The error is `noProfile`, and everything that stands on a face of that extrusion is a `brokenReference` (measured) |
| "The tool can see the document, so it can return `updateFeature` patches" | It cannot today: `SketchToolContext` holds the sketch, its solved state and the parameters. The document is added to it. `updateFeature` with `{ profile: { regions } }` replaces the list and verifies only references the feature did not have, so the patch is accepted in the batch that adds the arc |
| "An arc, two tangencies, a radius dimension" | The document holds that today. **The solver adapter does not keep it.** A fillet drawn exactly is accepted, and every later change (its radius, a size of the outline, an angle) is a `sketchConflict` that names the two tangencies. The same holds on `master` for a slot drawn by hand at exact coordinates. "Measured" has the cases, "The solver adapter" the cause and the cure |
| "Filleting a corner of a fresh sketch works without any of that" | Without the patches, yes. Not without the adapter: a fresh sketch is dimensioned afterwards |
| Not in the backlog: a wall names curves too | The profile source `wall` (D44, after the backlog entry) lists the curves of its chain. A wall along both lines of the corner needs the arc in its list as a region does |
| Not in the backlog: a side face starts where its line starts | The origin of the planar side face of a line is the start (`a`) of the line ([naming.md](../../architecture/naming.md), "Rovina skici na stěně"). Shortening a line at its start moves the origin, and a sketch on that face moves with it, without an error (measured: the brace of scenario 12 moves by 4 mm) |
| Not in the backlog: constraints that measure the length of a line | `equalLength` and `midpoint` read the two end points of a line. After a fillet they measure the shortened line (measured: a square held by `equalLength` becomes 40 × 45 with the status `ok`) |

## The cheap variant

- **The command `setCurvePoint`** `{ sketch, id, point, to }`: one point of one own curve is replaced by another own point of the sketch (or `origin`). The curve keeps its ID, kind, direction, construction flag and constraints. It covers every point of a curve (`a`, `b`; `center`, `start`, `end`), because the validation is the same for all of them.
- **The tool `fillet`** `{ corner, radius }`: the corner is the ID of the point where exactly two lines end. It draws the arc with its three points at their exact places, re-points the two lines, adds two tangencies and a driving radius dimension (a number or an expression), and keeps the corner point as the crossing of the two lines (two `pointOnCurve` constraints).
- **In the same batch** it adds the arc to every region and every wall of the document that names both lines (`ids.patched`), and it names the sketches and plane features whose plane moves with the start of a line (`ids.moved`).
- **The planegcs adapter** gives a tangency of a line and an arc that share an end point, and of two arcs that share one, to the library in the form its own analysis of redundancy can handle.
- **The app** gets the tool *Fillet* on the sketch bar and a button that re-points an end of a selected curve to a selected point. **MCP** gets both without code of its own beyond one sentence of the description and one example.
- **The document does not change its shape**: no schema step.

**Deferred:**

- A fillet between a line and an arc, or two arcs; a chamfer of a corner (the same re-point, a line in place of the arc).
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

Also measured:

- **The corner point cannot simply go.** In the dimensioned rectangle the dimension of the height stands on it.
- **A constraint on the length of a filleted line changes the shape.** A square 40 wide held by `equalLength` of two sides; a fillet of 5 at their corner: the status is `ok` and the corner is at (40, 45). The shortened side is 40 long now.
- **What a re-point must not leave.** A document in which a line ends at the point a `midpoint` constraint puts in its middle is refused on load ("středem úsečky nemůže být její konec"), and so is a line with both ends at one point. The command has to refuse both, or it would write a document that does not load.

### Shapes drawn by hand, on `master`

No fillet tool: a slot (two lines, two half circles sharing their end points, four tangencies, two radii, the length) drawn with its points off the exact shape by a given distance, then its dimensions changed.

| Drawn off by | Drawn | Then `r = 6`, `r2 = 6`, `len = 30`, `r = 5`, `r2 = 5`, `len = 20.5` |
|---|---|---|
| 0 or 1e-12 | solved; the library calls all four tangencies redundant | conflict, solved, conflict, conflict, conflict, conflict |
| 1e-9, 1e-6, 1e-3, 0.3 | solved; nothing redundant | solved every time |

With the square radius every row is solved every time. Two arcs that join smoothly in a common end point (an S) behave the same: drawn exactly, two of four changes of a radius are conflicts on `master`; with "the common point lies on the line of the two centres" (`point_on_line_ppp`) and with the angle at the point all are solved.

So on `master` a shape with a tangency at a common end point works only as long as the solver's own noise (about 1e-10) keeps the state from being exact. A model drawn by an AI from computed coordinates is exact.

### All tests with the adapter changed

A copy of `packages/` (the worktree's `node_modules` linked in), `npx vitest run`:

- unchanged: 1324 of 1325 pass; the one failure is the time limit of `gear.test.ts` under load, which CLAUDE.md names;
- with the two cases of "The solver adapter" in `translate`: 1325 of 1325 pass, the solver's own tests, the tests of the analysis and the snapshots of the app included.

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

The bare command, as an edit of the document: the rib's line re-pointed to a new start keeps all four faces of the rib under their names, and the brace that ends in its side follows (38.15 to 39.02 long in place of 37.38 to 37.54). Two lines whose ends are two points at one place are "not connected" for a wall; after one is re-pointed onto the point of the other the wall builds.

## Decisions

### The command

```ts
{ type: 'setCurvePoint'; sketch: Id; id: Id; point: 'a' | 'b' | 'center' | 'start' | 'end'; to: Id }
```

- **One point of one curve per command.** `point` is the name the curve has for it; `to` is an own point of the sketch or `origin`. A batch re-points several.
- **Validation is the validator of a curve plus one rule.** The changed curve goes through `curve` of `features/sketch.ts` (the points exist, are own or the origin, and differ). Then the own rule of the catalog (`check` of `CONSTRAINTS`) is asked again for every constraint that names the curve, because two of them read the points of a curve: `symmetric` (a symmetric point is not an end of the axis) and `midpoint` (the point is not an end of the line). A command that would break one is invalid and names the constraint. Nothing else about a constraint depends on which points a curve has: its operands are IDs of entities and their kinds do not change.
- **It covers the centre too.** The package is named for the ends; the same code re-points a centre, and "two circles on one centre point" is a use. The app offers the ends only (below).
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

**The cure.** `translate` of `packages/solver-planegcs/src/index.ts` gets two cases, both decided from the curves alone:

| `tangent` of | When | Given to the library as |
|---|---|---|
| a line and an arc | an end of the arc (`start` or `end`) is `a` or `b` of the line, by ID | `perpendicular_pppp(centre, common point, line.a, line.b)` |
| two arcs | they share an end point by ID, and their centres are two different points | `point_on_line_ppp(common point, centre 1, centre 2)` |

- Both say the same about the sketch as the form of today: the curves pass through the common point by their definition, so they touch there exactly when the condition holds.
- The constraint keeps its ID, so `conflicting` and `redundant` name it as before.
- Everything else stays: a line and a circle, a circle and an arc, two circles, and curves whose common point is held by a constraint (`coincident`, `pointOnCurve`) and not by one ID.
- The two-arc case is not needed by the fillet of two lines. It is the same defect and the same rule the analysis has, and it was measured with it; leaving it would keep an S drawn at exact coordinates broken.

**What it does to existing documents.** Nothing to their geometry on load: the stored positions are used while the stamp of the inputs matches, and the stamp is taken from the engine's constraints, not from what the adapter sends. The list `redundant` of a sketch result, which repeats what the library says, no longer names such tangencies (the engine's own diagnosis never did). A sketch that is solved again (after an edit) is solved through the new form; all tests pass with it, the snapshots of the app included.

**Why not without the adapter.** The tool could draw two construction radii and make them `perpendicular` to the lines; it measures exactly like the square radius. It was not taken: every fillet would carry two more lines in the sketch, the document would not say "tangent", and a tangent arc drawn by hand or by an AI (a slot, a rounded outline) would stay broken on `master`. It is the fallback if the owner does not want the adapter changed with this package ("Open").

### What the tool does to the features that use the sketch

The tool reads `context.document` and adds to its batch, after the sketch commands:

- **Regions.** For every feature with a profile source of regions over this sketch: a region whose outer loop names both lines gets the arc, and the feature is patched (`updateFeature` with `{ profile: { regions } }`, the whole list). When two lines that are not construction end at a corner, every loop that passes one of them passes the other, so "names both" is "passes the corner".
- **Walls.** For every feature with a wall over this sketch whose curves name both lines: the arc is added (`{ profile: { curves } }`).
- **Which features have a profile source** is a table typed over the feature types, in `sketch-tools.ts`: today the extrusion alone. A feature type added later does not compile until it says whether it has one (the revolve of 4a will).
- Features that are suppressed or in error are patched like the others. Holes, patterns and joints name points, not curves, and need nothing.
- The patched features are returned in `ids.patched`.

**What moves without an error** is returned in `ids.moved`: the sketches and plane features that stand on a side face (`side`, `wallSide`) made from the line whose start is the corner, and what stands on those planes. The tool does not say by how much: with a profile offset or a wall the face starts at the moved line's start, not at the sketch point. The state before and after says it, and a preview of the batch shows it without writing.

**What breaks with an error** is not listed, because the result of the batch lists it (`problems` of the MCP answer, the model panel of the app): a projection of the edge between the two side faces (`brokenProjection`), a feature with an inward offset or a wall thickness that leaves the arc no radius (`invalidProfile`, with the text of D44), a reference to the straight end of a wall that ended at the corner.

### What the tool refuses

It answers `ok: false` with a reason and draws nothing:

- **The corner.** Of the curves that end at the point (a line by `a` or `b`, an arc by `start` or `end`), those that are not construction curves are taken; if there are none, the construction ones. They have to be exactly two lines. So the corner of a rectangle with a construction diagonal is filleted and the diagonal stays on the point; the bend of a wall along construction lines is filleted with a construction arc; a point where a line meets an arc, or three lines meet, or one line ends, is refused with what ends there.
- **A corner of more than one point.** The profile takes points held together by a satisfied `coincident` constraint for one vertex (`pointJoins` of `sketch.ts`). When a curve ends at another point of the corner's vertex, the corner is not the two lines the tool sees, and it is refused with the point named. The caller makes it one point first (`setCurvePoint`).
- **Parallel lines** at the corner.
- **A radius that does not fit**: an end of the arc would be at the far end of its line or beyond. The message gives the largest radius that fits (the shorter of the two lines times the tangent of half the angle between them).
- **A radius as an expression without a value**: the tool has to place the arc, so it evaluates the expression with the parameters of the context (as the polygon does for its size). Without parameters, or with an expression in error, it is refused.
- **`equalLength` or `midpoint` on one of the two lines**, named in the message.

Not checked: whether the arc crosses another curve. The sketch then has no valid profile, as after any drawing.

## The tool, step by step

Inputs `{ corner: Id; radius: number | Expr }`. With `u1`, `u2` the directions from the corner along the two lines, `θ` the angle between them and `r` the radius:

1. The ends of the arc are `corner + (r / tan(θ/2)) · u`, the centre is on the bisector, `r / sin(θ/2)` from the corner. Positions come from the solved state.
2. The batch: `addPoint` × 3; `setCurvePoint` × 2 (the end of each line that was the corner); `addCurve` of the arc, counter-clockwise the short way round, a construction curve when the lines are; `addConstraint` × 5 (`tangent` × 2, `pointOnCurve` of the corner with each line, `radius`, driving, with the value given); the patches.
3. `ids`: `arc`, `center`, `lines` (the two lines in the order of their IDs), `ends` (`ends[i]` is the new end of `lines[i]`), `constraints` (the four without a value), `radius`, `patched`, `moved`. Every list is always there; the last two may be empty.

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
| `sketch-tools.ts` | the input kind `point` and its check; `document` in the context; the tool and its entry; the table of profile sources by feature type |
| `packages/solver-planegcs/src/index.ts` | the two cases of `translate` |
| `packages/mcp/src/api.ts` | the text of the input kind, a sentence of the section "Sketch tools" about tools that change what is drawn, the example of the fillet |
| `packages/mcp/src/tools.ts` | `sketchToolBatch` passes the document |
| `packages/app/src/sketch-mode.ts`, `sketch-commands.ts`, `panels/sketch.ts` | the tool *Fillet*, its radius, the button *End to point* |
| `docs/architecture/sketch.md`, `api.md`, `ports.md`, `docs/ui/sketch.md`, `verification.md` | the tool and the command, the adapter's third exception, the UI rows, the tests |

## The app and MCP

**MCP.**

- `setCurvePoint` is reached by `execute` and `preview` like every command, and is in `describe_api` from `types.ts`.
- `fillet` is reached by `sketch_tool`; its description (inputs, lists of IDs, the summary) is generated from the catalog. The answer of `sketch_tool` carries `ids`, with `patched` and `moved`, and the `problems` of the model after the batch, so a dependant that broke is in the same answer. `preview: true` shows all of it without writing.
- An example of a tool is run by a test on an empty sketch; the fillet needs a corner. Its example names the corner the example of the rectangle leaves, and the test runs it after that one.

**The app.**

- **The tool *Fillet*** on the sketch bar. One click on a point; a click elsewhere says what the tool wants. While it is active the panel has its option, *Radius*: a number or an expression (the field of the forms), 2 mm at first, remembered for the next corner. A refusal of the tool is said in the status line with its reason. After a fillet the status line says how many features got the arc and names what moved.
- The batch of the fillet is sent as the tool made it: the switch *Konstrukčně* of the sketch bar does not turn its arc into a construction curve (the arc follows its lines).
- **The button *End to point*** in the panel of the sketch, offered when the selection is one own line or arc and one own point (or the origin): it sends `setCurvePoint` for the end of the curve that is nearer to the point. A centre is not offered; it is reached through MCP.
- The context of the sketch tools (`SketchView.source`) is completed with the document and the values of the parameters where the open sketch is read (`sketchContextOf`).

## Issue codes

None is added. The command has the texts of an invalid command; the tool answers with a reason as text, like the rectangle and the polygon.

## Shared places

- **Takes:** `SKETCH_TOOLS` and `sketchTool` (D35 point 7), `updateFeature`, the catalog of constraints.
- **Adds:** one member of `Command`; one entry and one input kind of the sketch tools; the document in their context. `applyCommand` gets a branch, as the plan foresaw for 2d.
- **Not in the plan's table:** the solver adapter. No other package of D36 writes there.

## Rejected alternatives

1. **Remove the lines and add new ones** (no engine change). The IDs change, and with them the names of the side faces: every sketch on them, every projected edge and every measurement that names them breaks. It is why the backlog asked for the command.
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

## Known limits

- Two lines only; one point as the corner; no `equalLength` or `midpoint` on the lines.
- A sketch or a plane feature on the side face of the line that starts at the corner moves; it is named, not prevented, and the distance is not given.
- The edge between the two side faces is gone, and the new edges of the round face with its neighbours cannot be projected (kind `other`); the rims of the round face on the caps can (circles).
- A profile offset inwards, a taper or a wall has to leave the arc a radius. The box of scenario 12 needs a corner radius above `wall + clearance + lipT`; below that the features with the larger offsets are `invalidProfile`. The narrow variant of D44 that drops such arcs ([backlog.md](../../backlog.md), "corner arcs that drop out") would lift this, and round corners make it more likely to be wanted.
- A fillet that stops fitting is a conflict of the sketch or an invalid profile, and the conflict names most of the sketch, not the radius.
- The patches cover the features that are in the document when the tool runs. A feature added later picks its region with the arc in it by itself.
- The adapter's rule reads a common point by ID. Ends joined by a `coincident` constraint, and a line that ends on a circle by `pointOnCurve`, keep the form of today and its defect.
- A build before this package opens a filleted document as the same model and cannot change its dimensions.
- There is no tool that removes a fillet.

## To verify before the implementation

- The command through `execute` and `preview`: the measurements edited documents. In particular a batch that re-points and patches is atomic, and one undo restores the regions.
- That `setCurvePoint` to the point a curve already has makes no undo step (the engine compares documents).
- The drags of the app on a filleted sketch, through the real tool.
- The two-arc case of the adapter with centres that share a point ID is left to `tangent_aa`; no test has such a sketch.
- The example of the fillet in the test of the MCP description, which runs every example.
- The snapshots of the app: the sketch bar gets a tool, so the record of what the page shows changes there and nowhere else.

## Tests the implementation owes

- **Engine:** the command (every point name of every kind, the refusals of `calls.ts`, the same point, the stamp, the old point kept); the tool (the batch, the IDs, each refusal, construction lines, a corner at the origin, a corner with a construction diagonal, an expression as the radius; the patches of regions and walls; `moved` with a plane feature in between; no document in the context).
- **Solver adapter:** an exact fillet, an exact slot and an exact S, each changed afterwards; the IDs in `conflicting`; a line and an arc joined by `coincident` keep the form of today.
- **Scenarios:** the cases of spike A as regressions (radii, sizes, angles, drags); scenario 12.
- **MCP:** the description of the tool and of the input kind, the example, `patched` and `moved` in the answer.
- **App:** the tool, its option, a refusal, the button.

The review of the implementation is a full one: it changes how the solver is called.

## Open

For the owner:

1. **The adapter.** May 2d change the planegcs adapter as above (a tangency at a common end point given to the library as a square radius; all tests pass with it), or should the fillet leave the adapter alone and draw two construction radii per corner? Recommended: the adapter; it also repairs slots and rounded outlines drawn at exact coordinates, which are broken on `master` today.
2. **The corner point.** It stays as the virtual corner, held on both lines, so dimensions keep measuring to the sharp corner (the open point of the backlog). Decided here; say so if the dimensions should move to the arc instead.

## For the plan

- **4a (revolve)** takes a profile source: the table of the fillet will ask for its line.
- **Step 6.** Trim and extend are tools over `setCurvePoint`. Pattern and mirror in a sketch as a tool has the problem of the regions this package solves for the fillet; it can patch the same way and return `patched`.
- **The backlog** keeps from its entry what is deferred here (a line with an arc, a chamfer, removing a fillet), and its remark on corner arcs that drop out gains a use.
- **Shared places:** the plan lists "Sketch commands and `sketch.ts`" for 2d. The package does not write to `sketch.ts`; it writes to the solver adapter, which the plan does not list.

## Reviews

None yet.

## Rows for the indexes

**`docs/d36/README.md`, the row of 2d** (column "Design now"):

> full ([2d-sketch-fillet/design.md](2d-sketch-fillet/design.md), D52): the command `setCurvePoint`, the sketch tool `fillet` with the patches of regions and walls and the lists `patched` and `moved`, and a change of the planegcs adapter (a tangency at a common end point as a square radius), without which a fillet cannot be changed after it is drawn; no schema step

and in "Numbers": decisions D52 taken by 2d, next D53; scenario 12 gets the part of 2d. The row "Sketch commands and `sketch.ts`" of "Shared places" becomes "Sketch commands (`applyCommand`), `sketch-tools.ts`, the planegcs adapter".

**`docs/decisions.md`, the row of the table:**

> | D52 | [2d Re-pointing a point of a curve and the fillet of a sketch corner](d36/2d-sketch-fillet/design.md) | designed 2026-11-16 | A command that gives a curve another point and keeps its ID; a sketch tool that fillets the corner of two lines, keeps the corner point as the virtual corner and adds the arc to the regions and walls that passed it; the solver adapter gives a tangency at a common end point as a square radius |

**`docs/requirements.md`, scenario 12, a part after "Holes with hardware":**

> - *Round corners (2d, D52).* The finished box gets round vertical edges: a parameter `cornerR = 6` and the sketch tool `fillet` at the four corners of the outline. Each fillet is one batch: an arc tangent to the two lines, which are shortened and keep their IDs, the corner point kept on both lines, a radius dimension with the expression, and the arc added to the region of the five features that read the outline. All features stay `ok`, no face of the box or the lid is lost, twenty round faces are new, the width and the height are still measured between the sharp corners, and the lid still fits. The fillet at the corner where the line `od` starts names the sketch of the brace, which stands on a side face of that line and moves 4 mm with its start; its dimension is rewritten. The radius follows its parameter; at 3.7 the inside of the lip, offset by as much, is an error of that feature. The rim of a round corner projects as a circle. The bracket gets a round bend: a fillet of its two construction lines makes a construction arc and adds it to the curves of the wall. Refused: a corner that was filleted, the end of one line, a radius the lines are too short for. By the bare command `setCurvePoint` the foot of the rib is moved to a new point (its faces keep their names and the brace that ends in its side follows), and two lines of a gusset drawn with separate end points are joined so that a wall along them builds. Refused: both ends of a line at one point, a point of another sketch, a line ending at the point a `midpoint` constraint puts in its middle. At the port of the solver a fillet drawn exactly is solved again with another radius.

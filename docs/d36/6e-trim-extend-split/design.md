# 6e Trim, extend and split (D65)

**State: designed 2026-11-17, not implemented.** Written against the code of `master` at `9162198` (steps 1 to 5 merged, schema version 9; D52 implemented). Package 6a (the preparatory part of step 6) is designed at the same time; 6e needs it only for the table of the app's sketch tools (part 4 of 6a) and writes the app side against the app of `master` ("To verify"). The rules were measured with a prototype against the real solver and kernel ("Measured").

Files: [contract.ts](contract.ts) (the three entries of `SKETCH_TOOLS`, two input kinds, what the profile and the app read), [calls.ts](calls.ts) (its part of validation scenario 15, step 6, and the cases the Onshape converter met).

The package is three sketch tools over existing commands, and one rule that is new:

1. `trim` removes the piece of a curve between two cuts; `extend` moves an end of a line or an arc to the next curve; `split` cuts curves into pieces where other curves cross them. Each is a batch of commands every build knows (`addPoint`, `addCurve`, `setCurvePoint`, `removeEntity`, `addConstraint`, `removeConstraint`, `updateFeature`), so there is no new command and no schema step.
2. What stood on a cut curve stays: its constraints go with the piece they describe, a dimension of the whole curve keeps measuring the whole, and the pieces stay on the line or circle of the curve.
3. **The regions of the features follow by a side rule**: a region that is gone is replaced by the regions after the batch that lie on the same side of a piece of its curves. It is the part D52 could do by names and 6e cannot: a cut changes which loops exist.

## What the plan and the backlog say, checked against the code

[6-plan.md](../6-plan.md), "6e Trim, extend and split", and [backlog.md](../../backlog.md), the row "Trim and extend in a sketch; regions from crossing curves".

| Statement | What the code says |
|---|---|
| "Sketch tools (`SKETCH_TOOLS`, reached by `sketch_tool` and by the app) over `setCurvePoint` (D52)" | True. `sketchTool` takes the document since D52 (`SketchToolCall`), `PROFILE_SOURCES` says which feature types read a profile (the extrusion and the revolve), and the fillet patches regions and walls in its own batch. The three tools are entries of the same catalog |
| "`carrierContacts` of `sketch.ts` computes [the intersections] for lines, circles and arcs and is private" | True, and it is not enough by itself. The profile's test (`compatible`) takes the carrier contacts **and** the ends and middles of both curves as candidates, and ignores a touch within the reach of a vertex the two share (a tangent join). The tools have to cut at exactly the points that test rejects, or a split leaves the profile invalid; so 6e exports the test, not the carrier contacts (`curveContacts`, "Where the tools cut") |
| "One piece keeps the ID, the others are new curves" | Measured as the way to go: the regions get new names that tell the pieces apart (a line through a circle gives two regions, `{k, middle}` and `{k', middle}`), which is what the owner wanted from tools rather than automatic regions |
| "New points at the crossings get `pointOnCurve` on the crossing curve" | Not enough: the profile joins curves only at common points (`pointJoins`), so a point held on the other curve by `pointOnCurve` still touches it in its interior and the profile stays invalid. The other curve has to be cut at the same point ("The other curve is cut too"). `pointOnCurve` is what holds the point on a curve that is not cut (a construction or a projected curve) |
| "Constraints that describe the whole curve (horizontal, a radius) are repeated on the new pieces" | Repeating them is either redundant or too weak. Two pieces of a line that share a point and are each horizontal are collinear, but two pieces of a slanted line need a collinearity anyway, and with it a repeated `horizontal` is redundant. The pieces are held on the line of the curve by one `pointOnCurve` per new point, and a constraint of the whole line stays on the piece that keeps the ID ("What happens to the constraints"). Measured: no case left the freedom changed or a constraint redundant |
| "Trim removes the piece under the cursor (a split, then the removal)" | The batch does not split and then remove; it re-points the curve and adds only the pieces that stay. A piece with no cut inside it (a piece left by an earlier split) is a whole curve, and removing it needs more than `removeEntity`: the other pieces stand on it ("Removing a whole piece") |
| "A trimmed circle becomes an arc: removed and added again under its ID with its constraints (D52 measured that an ID removed in a batch can be reused and faces keep their names)" | True and measured again: the arc of the notch keeps the ID of the circle, its diameter dimension under its ID and expression, and the side face `side/<circle>` |
| "Extend moves an end … to the nearest crossing of its extension with another curve (a new point with `pointOnCurve`, then `setCurvePoint`)" | True, with the other curve cut there when both are profile curves |
| Not in the plan: what happens to the old end of a trimmed curve | `setCurvePoint` keeps the old point (D52). An end nothing else names is a free point with two degrees of freedom; an end a dimension names should keep its meaning ("Ends that are cut off") |
| Not in the plan: the regions of the features | The fillet's patch is by names: the arc joins every loop that passed the corner. A cut is not: one region becomes several, or several one, or a region is opened. The tool computes the profile after its batch and follows each region by geometry it already has ("Regions") |
| Not in the plan: a sketch that is already invalid | The notch of scenario 15 starts with a circle across the outline, so the profile before the tool has no regions. The rule of the regions cannot read the regions before; it traces each region from its curves |
| The converter "had to split [six sketches] itself, losing every constraint on a split curve" (`tools/onshape/sketch.ts`, `splitAtCrossings`) | What it met: lines crossing lines, lines crossing circles, circles crossing circles, an end of one curve on another (a T), collinear lines that overlap (the ends of each split the other, duplicates removed), a circle touched at one point (left whole), arcs left alone. `split` without a curve does the same and keeps the constraints; overlaps leave duplicate pieces to trim ("Known limits") |

## The cheap variant

- **`trim { curve, at, with? }`**: the piece of `curve` nearest to `at` goes. A piece is the part between two neighbouring cuts or between a cut and an end. `with` limits the cuts to the contacts with one curve.
- **`extend { curve, end, with? }`**: an end of a line (`a`, `b`) or an arc (`start`, `end`) moves along its line or circle to the first curve the extension meets (`with`: to that curve).
- **`split { curve?, with?, at? }`**: `curve` is cut at all its cuts (`with`: those with one curve; `at`: the one nearest to a place). Without `curve`, every contact of two profile curves in the sketch is cut: the repair of a profile with crossing curves in one batch.
- **In each batch**: the other curve cut at the same points when both take part in the profile; the constraints moved to where they belong; ends cut off kept on the line when something names them, else removed; the regions and walls of the features over the sketch patched (`updateFeature`), as the fillet does.
- **Two input kinds** for the catalog: a curve by its ID, and a place `[x, y]`.
- **The app**: the tools *Trim*, *Extend* and *Split* on the sketch bar, the piece under the pointer shown before a click, the button *Split crossings*, and the contacts marked while the profile is invalid. **MCP**: nothing beyond the description of the two input kinds, three examples and one sentence.
- **The document does not change its shape**: no field, no command, no schema step.

**Deferred:**

- Cutting non-own geometry: a projected edge, a curve of another sketch (6b), a copy of 6c, an imported outline (6f). Taking a projected curve over as own curves is the way, if it is wanted ("Open", 1).
- Splines (6d): neither cut nor a cut until a point can be held on a spline.
- Extend to the extension of the other curve (past its ends).
- A break at an arbitrary place (no crossing there); a chamfer of a sketch corner and removing a fillet (D52's deferred tools over the same commands).
- A query of the crossings of a sketch (an AI uses `split` without a curve instead).
- Changing the converter (`tools/onshape`) to call `split`: the need is the converter's, and it is a small change, but it is a change of a tool outside the engine with its own test ("For the plan").

## Measured

**Recipe.** A prototype of the rules in the scratchpad of the session (`scratchpad/6e/`), run from the worktree with `npx vitest run --config <scratchpad>/6e/vitest.config.ts` against the real planegcs and Manifold adapters:

- `proto.ts`: the cut of one curve at given points (pieces, the keeper, constraints moved, carrier and end constraints, a circle turned into arcs), the removal of a whole piece with its sibling, the side rule of the regions (the trace of a region from its curves, the profile after the batch by `applyCommand` and `detectProfile`).
- `a-notch.spike.ts` (the notch of scenario 15), `b-split.spike.ts` (a circle split by a line; the dangling pieces trimmed; a slot whose arc is split; a hexagon of the polygon tool notched), `c-more.spike.ts` (two overlapping rectangles; an extend; a trim at a corner).
- **The crossing points were given to the prototype by hand** (computed analytically); the contact search of the tools was not run. Everything after it (the batches, the solver, the profile, the patches, the bodies) is the real code.

In every case the sketch was fully determined before the tool (0 degrees of freedom) and the engine's analysis and the library reported no redundant constraint unless a row says so.

### The cable notch (scenario 15, step 6)

A rectangle 80 × 50, fully dimensioned, extruded 10 (40000); a circle of radius 6 with its centre dimensioned at (40, 2), across the bottom edge `ba`.

| Step | Sketch | The base |
|---|---|---|
| The circle drawn | solved, `valid: false`, freedom 0 | `invalidProfile` |
| Trim 1: the piece of the circle below the edge. The circle becomes an arc under its ID (S2 to S1 counter-clockwise) with its radius dimension; `ba` is cut at S1 and S2: it keeps the piece from b1, two new lines follow, `pointOnCurve` of S2 and of b2 on `ba` | solved, valid, freedom 0, two regions: `{ba, bb, bc, bd, k, piece 2}` and `{k, piece 1}` | patched to both (the rectangle less the half disc, and the half disc): `ok`, 40000 |
| Trim 2: the piece of the edge inside the circle, now a curve with no cut inside it: removed | valid, freedom 0, one region | the half disc is dropped, `ok`, 39200.48 (by hand 39199.04; the arc is a polygon within the chord tolerance). Side faces `ba`, `bb`, `bc`, `bd`, `k` (the arc), piece 2 |

Then, each as a preview of a change of a dimension (the volume by hand in brackets):

| Change | Sketch | The base |
|---|---|---|
| radius 8 | `ok`, valid, freedom 0 | 38679.94 (38678.06) |
| radius 4 | `ok` | 39596.70 (39595.61) |
| centre x 30 | `ok` | 39200.48 (39199.03) |
| centre y −1 (below the edge) | `ok` | 39555.02 (39553.96) |
| centre y 5 | `ok` | 38916.02 (38914.04) |
| width 60 | `ok` | 29200.48 (29199.03) |
| radius 1.5 (the circle no longer reaches the edge) | `sketchConflict`, the last shape kept | `ok`, unchanged |

### A circle split into two arcs

A circle of radius 10 at (2, 1), extruded 5 (`boss`, region `[k]`); a horizontal line at y = 3 from x = −20, 40 long, fully dimensioned, across it. `split` of both: the circle becomes two arcs on its centre that share both ends (the arc rule of the second repeats that of the first), the line three pieces.

- `boss` patched from `[k]` to `{k, middle}` and `{k', middle}`: `ok`, 1568.75 (the disc 1570.80 as a polygon). Freedom 0, nothing redundant: the repeated arc rule is a rule of the library's arcs, which the adapter leaves out of its lists, and the engine's analysis counts by rank.
- Radius 12 and 9, the centre moved, the line moved to y = 7, −5 and 10.9 (a chord close to the top), a drag of a crossing point: all solved, freedom 0, the volume of the disc. y = 12 (the line misses the circle): `sketchConflict`.
- The keeper of the line (the piece from its start, the carrier of the other two) trimmed: its `horizontal` and the `pointOnCurve` of the far end moved to the middle piece, its start (named by two dimensions) held on the middle piece. Then the far piece trimmed. Freedom 0 after both, changes solved. Three undos give the crossed sketch back.

### A tangency at a common end, and a polygon

- **A slot** (two lines, two arcs, four tangencies, radius, length; a fixed vertical line through the right arc). The right arc is split at the two crossings: the keeper keeps its start and the tangency with the bottom line; the tangency with the top line goes to the last piece, which has that common end. Split, radius 8 and 4, length 32 and 28, the line moved: solved, nothing redundant; length 40 (the line misses the arc): `sketchConflict`. **The same with the tangency left on the keeper**: the split already reports it redundant, and lengths 32 and 28 are conflicts that name it. It is the double root that D52 cured for a tangency at a common end; the cure works only if the tangency names the piece that has the end.
- **A hexagon** of the polygon tool (five `equalLength` on its first side, the circumscribed diameter 20), with a circle of radius 2 held at the middle of that side by `midpoint`. Trim of the outer piece of the circle and of the middle of the side: the five `equalLength` and the `midpoint` move to a construction line over the old ends of the side (the span line). Freedom 0; 760.69 (by hand 760.57). Size 30: the six sides between the vertices are 15.000000 each, the circle stays at the middle of the span (11.25, 6.4952), 1734.97 (1734.85).

### Overlaps, an extend, a corner

- **Two overlapping rectangles** A (40 × 30 at the origin, extruded 5) and B (40 × 30 at (20, 10), extruded 3), each dimensioned from the origin: both extrusions `invalidProfile`. Split at the two crossings (four lines cut): three regions, A patched to {A∖B, A∩B}, B to {A∩B, B∖A}: 6000 and 3600, freedom 0. B moved and A widened: solved, 6000 and 3600, then 7500. The four inner pieces trimmed one by one: freedom 0 throughout, and both extrusions end on the union (10000 and 6000). After the first trim A already covers the union: its region A∩B was merged with B∖A, and a region follows into what it is merged with ("Regions").
- **A first version of the removal of a whole piece** moved the carrier constraints to the sibling but did not hold the ends that stay (a corner of the other rectangle) on the sibling's line: the freedom went 0, 1, 2. With the rule of "Removing a whole piece" it stays 0.
- **Extend**: a vertical line inside a rectangle, its start dimensioned, its length 10, extended from (10, 20) to the top side (10, 30). The top side is cut there; the old end stays on the line (its length dimension names it). Freedom 0; the region patched with the new piece of the top side; height 50 moves the new end to (10, 50) and keeps the old end at (10, 20); a length of 15 moves the old end to (10, 25).
- **A trim at a corner**: the bottom side of a rectangle trimmed from a crossing at x = 25 to its end at the corner r2. The corner is the end of the right side and named by the width: it stays, held on the line of the bottom side (the virtual end). Freedom 0; width 60 puts r2 at (60, 0). The outline is open: the extrusion is `noProfile` and is listed (`dropped`).

## Decisions

### Where the tools cut

A **contact** of two curves is a point where they touch apart from an end they share: a crossing, a tangency, an end of one lying on the other (a T), the ends of an overlap. It is exactly what makes `compatible` of the profile reject a pair. `sketch.ts` exports it as `curveContacts(sketch, geometry, a, b)`, and `compatible` becomes "no contact" for curves that are not on one circle (the rule for two circles on one circle stays as it is): the same candidates (carrier contacts, ends, middles), the same tolerance, the same reach around a shared vertex in which a tangent join is not a touch. No behaviour changes; the existing tests are the check.

A **cut** of a curve X is a contact of X with another curve that is not within `LENGTH_TOLERANCE` of an end of X; cuts within the tolerance of each other are one.

- **Which curves cut**: every other curve of the sketch: own curves, construction curves included (a person trims to a construction line), and projected curves. `with` narrows it to one. `split` without a curve takes the pairs of profile curves (own, not construction) only, because its job is the profile.
- **The positions are the solved ones** (`context.result`, which holds the projected points and the origin as well), as for every tool.
- **The point at a cut**: an own point or `origin` within the tolerance that one of the two curves ends at, or holds by `pointOnCurve`, is used (a T: the end of the other curve; a cut made by an earlier tool); a point of projected geometry there gets a new own point joined to it by `coincident` (as `placeAnchor` does); otherwise a new point at the exact place.

### The other curve is cut too

The profile joins curves only at common points. A new point on X held on C by `pointOnCurve` still lies in the interior of C, and the profile stays invalid. So **at every cut the tool uses, the other curve is cut as well when both take part in the profile** (own, not construction): the point becomes a common vertex. When C is a construction or a projected curve, the point is held on it by `pointOnCurve` (unless it ends there or holds it already).

This makes the order of the trims free. In the notch, the first trim (the circle) cuts the edge at the two crossings, so the sketch is valid right after it, and the second trim removes a piece that is now a curve of its own. Without it, the first trim would leave an invalid sketch and the regions could not be followed until the second (alternative 7).

### The pieces and the keeper

A cut curve is divided at its cuts, in its own direction (a line from `a` to `b`, an arc counter-clockwise from `start`; a circle counter-clockwise from the cut at the smallest angle from the x axis of the sketch).

- **The keeper** is the piece with the start of the curve (`a`, `start`), unless that piece is the one removed; then the next. It keeps the ID: `setCurvePoint` moves its far end (and its start, when the first piece went). A planar side face starts at the start of its line ([naming.md](../../architecture/naming.md)), so a keeper that keeps the start moves no plane; a start that was re-pointed puts the features on that face in `moved`, as D52 does.
- **The other pieces** are new curves of the same kind, construction flag and direction. A new arc has the centre point of the curve.
- **A line's pieces stay on its line**: each point of a piece that is not an end of the keeper gets `pointOnCurve` with the keeper (a line holds a point on its extension as well). One equation per new point, which is what keeps the freedom: the point has two coordinates, one is taken by the curve it is cut at and one by the line. An existing `pointOnCurve` of that point on X serves and is not added twice.
- **An arc's pieces stay on its circle by their common centre**: the arc rule of each piece (its ends at one distance from the centre) chains them. A circle cut into arcs repeats the rule once (the last piece closes the chain); measured harmless.
- **Trim uses only the two cuts around the removed piece** (or the one cut and the end), so a trimmed line gives at most one new piece and a trimmed circle exactly one arc.

### What happens to the constraints

For every constraint that names a cut curve X, by its kind (the catalog `CONSTRAINTS`):

| Constraint on X | Goes to | Why |
|---|---|---|
| `horizontal`, `vertical`, `parallel`, `perpendicular`, `angle` (X a line) | stays on the keeper | the pieces are on one line and keep its direction |
| `distancePointLine`, `symmetric` (X the axis) | stays on the keeper | they read the line of X, not its extent |
| `pointOnCurve(p, X)` | stays on the keeper; removed when `p` becomes an end of the keeper (a line) or of any piece (an arc or a circle), where it is an identity | an identity is a redundant equation, and the library may report it |
| `radius`, `diameter`, `equalRadius` (X an arc or a circle) | stays on the keeper | the pieces share centre and radius |
| `tangent(X, Y)` | the piece that shares an end with Y (by ID or by a satisfied `coincident`); otherwise the keeper | the solver adapter gives a tangency at a common end its own form (D52); on another piece it is the double root again (measured: redundant at once, conflicts after changes) |
| `equalLength(X, Y)`, `midpoint(m, X)` | a construction line from the old start to the old end of X (the **span line**), added once per line | they measure the whole line; on the keeper they would measure a piece and change the shape without a word. The span keeps the shape (measured: the notched hexagon stays regular) |
| `distance` between the ends of X, and every constraint on a point | stays on its points | the points stay ("Ends that are cut off") |

A constraint that moves is removed and added again under its ID with the other curve, its value, its expression (the input form) and its driving flag, in the same batch (an ID removed in a batch can be reused, D52). It is listed in `ids.reattached`. Nothing is dropped except identities and what goes with a removed curve or point (`ids.removed`).

A command of the batch that the engine refuses (a `symmetric` whose point would become an end of its axis, which `setCurvePoint` asks again) makes the tool refuse with the engine's message: the tool applies its batch to the document anyway, to compute the profile after it ("Regions").

### Ends that are cut off

A trim of an end piece, and an extend, take an end point off the curve. **The old end stays when anything else names it**: another curve (the corner of a rectangle), a constraint other than one that only attaches it (`pointOnCurve`, `coincident`), a feature of the document (a hole, an operand, an axis). It is then held on the line or circle of the curve (`pointOnCurve` with the keeper): the virtual end, as the virtual corner of D52. A length dimension still measures the whole (measured: the extend), a corner still lies on the line of the trimmed side (measured: the trim at a corner), and the freedom does not change.

**An end nothing else names is removed** (`removeEntity`, after the re-point), with its attaching constraints. Kept, it would be a free point of two degrees of freedom, and a sketch that was determined would no longer be (alternative 5).

### Removing a whole piece

A piece with no cut inside it is a whole curve: a curve that crosses nothing, or a piece an earlier split made. `trim` removes it. When other pieces stand on it, `removeEntity` alone loses their line: they are held on it by `pointOnCurve`, and its `horizontal` held them all.

- **A sibling** is another own curve on the same carrier: a line both of whose ends are ends of X or held on X by `pointOnCurve` (or the reverse), an arc with the same centre point. The sibling that shares an end with X is taken, else the first by ID.
- **What holds the carrier moves to the sibling**: the constraints of the first, second, fourth and fifth rows of the table and `tangent`, by the same remove and add under the ID.
- **Every end of X that stays** (an end of another curve, or named as above) and is not an end of the sibling is held on the sibling (`pointOnCurve`); an end nothing names is removed. Measured: without this, each corner end lost its line and the freedom grew by one.
- **Without a sibling** the curve goes with its constraints (`removeEntity` semantics), and its ends that nothing else names go with it. That is the trim of a curve that crosses nothing, which other CAD programs also delete.
- What described X's own extent (`equalLength`, `midpoint` on X itself, not on its span) goes with it and is listed in `removed`.

### A circle

- **Split** at two or more cuts: the circle becomes arcs on its centre, the first under its ID (removed and added again in the batch, with every constraint on it added again), the others new.
- **Trim**: the arc that stays is the circle from the cut after the removed piece around to the cut before it, under the ID of the circle.
- **Touched at one point** (a tangency, or one end of another curve on it): there is no arc from a point to itself (the engine refuses one), and a second point would be arbitrary. `split` leaves it whole and lists it in `touching`; `trim` removes the whole circle, which is the piece from the point round to itself.
- **A circle that a generated profile names as an operand** (the pitch circle of a gear) is refused: the generator takes a circle, not an arc.

### Extend

The end of a line moves along the ray beyond it; the end of an arc along its circle beyond it (the end counter-clockwise, the start clockwise), less than a full turn. It stops at the first contact of the extended curve with another curve (`with`: that curve), within that curve's extent. The point there is used or made as at a cut, and the curve met is cut there when both take part in the profile. The old end is cut off by the rules above. Constraints that read the extent of a line (`equalLength`, `midpoint`) go to its span line, as for a trim.

Refused: an end that another curve ends at too (extending it would leave that curve's end in the middle of this one; extend the other one, or split); an extension that meets nothing; an arc that would reach its own other end first.

### Regions

The tool knows the sketch after its batch exactly: the curves are those of the document after the batch (it applies the batch with `applyCommand`, which also catches a batch the engine would refuse) and the positions are the solved ones plus the new points, all at their exact places. The batch is solved as drawn. So it **computes the profile after the batch with `detectProfile`** (after 6a: the function the sketch step uses for its list of shapes) and follows each region of each feature over the sketch (`PROFILE_SOURCES`: the extrusion and the revolve).

**The side rule.** A region R of a feature that is not a region after the batch is replaced by every region after the batch whose outer loop runs along a piece of one of R's curves **on the same side** as R lay of that curve.

- R's side of each of its curves is read by tracing R from its curves in the sketch before the batch: they form one closed chain (joined by `pointJoins`), whose signed area gives its sense; a curve passed in its own direction has R on its left. This works when the profile before is invalid (the notch), because a region's own curves still form its loop.
- The side of an after-region is in its loop (`OutlineCurve.forward` of `Loop.exact`). A piece keeps the direction of its curve, so "the same side" is one comparison of two flags.
- A curve the batch does not change is its own piece.
- **Why it is right.** R lies along the whole of each of its curves, on one side. A region after the batch on the same side of a piece of one of them shares area with R next to that piece; a region on the other side does not. Every region after the batch that shares area with R reaches one of R's curves: it cannot lie inside R without touching R's outline, because what is inside R and apart from its outline is a hole of R, not R.
- **What follows from it.** A region cut into several by a split is replaced by all of them, so the body does not change (measured: 40000, 6000 and 3600, the disc). A region whose outline is opened into a neighbour follows into the merged region (measured: A covers the union after its first inner piece is trimmed). A region with no region after it on any side of any piece is **dropped**: from the feature's list when it has other regions (the half disc of the notch), otherwise left, and the feature ends in `noProfile` (the opened rectangle). Either way the feature is in `ids.dropped`.
- The patch is `updateFeature` with `{ profile: { regions } }`, the whole list, regions that are the same after kept in their order, new ones after them without repeats. Only references the feature did not have are verified, so it is accepted in the batch that makes them.

**When the sketch is still invalid after the batch** (another crossing remains), there is no profile to follow into. A region that names a curve the batch changes is rewritten by names: each changed curve replaced by its pieces that stay, a removed curve left out. The feature is in `ids.pending`; the tool that leaves the sketch valid follows it by the side rule, because its curves still form one chain. A region that lost a piece of its outline while the sketch was invalid has a gap and cannot be traced later; it is dropped then ("Known limits").

### Walls and what reads a curve

- **A wall** (`profile.wall`) that names a changed curve gets every piece that stays in its place (`updateFeature` with `{ profile: { curves } }`), in `patched`. A split wall curve stays one chain. When the curve lost a piece the wall is shorter (or no longer one chain, which the recompute says): it is in `shortened` as well. A wall that would be left with no curve keeps its list and is in `broken`.
- **`moved`**: as D52, sketches and plane features on a face `side` or `wallSide` of a line whose start `a` was re-pointed.
- **`shortened`**: features that read a face of a changed curve directly and were not patched: walls as above, sketches that project an edge one of whose faces is `side` or `wallSide` of a changed curve, chamfers and fillets (D63) of such an edge. A circle that became an arc counts: its rims are arcs now.
- **`broken`**: features that name a curve the batch removes: its faces, an axis on it (`sketchLine` of `AxisRef`), a wall that would lose every curve. Found as the fillet finds names, from the document alone (every text of a feature, as `freshIds` reads them).
- None of the lists is a statement about the state after the batch; the problems of the result say what is in error, as for the fillet.

### What the tools refuse

`ok: false` with a reason, nothing drawn:

- the curve is not an own curve of the sketch, or `with` is not a curve of it (or is the curve itself);
- **split** of a curve with no cut (with `with`: no contact with it; with `at`: no cut at all); **trim** never refuses for that: a piece with no cut is the whole curve;
- **extend**: the end is not an end of the curve's kind (`a`, `b` of a line; `start`, `end` of an arc; a circle has none), another curve ends there too, the extension meets nothing (or not `with`), an arc would reach its own other end, or the new end is out of the range ±`MAX_NUMBER`;
- a circle that a generated profile names as an operand;
- a spline (after 6d), named as such;
- the batch is one the engine refuses (its message).

## The tools, step by step

Positions are the solved ones. "Cut X at points" is the sequence of "The pieces and the keeper", "What happens to the constraints" and "Ends that are cut off".

**trim `{ curve: X, at, with? }`**

1. The cuts of X (by `with`), sorted along X; the point of X nearest to `at`; the piece around it: between the cut before and the cut after (an end where there is none; for a circle the angular neighbours).
2. No cut bounds it: "Removing a whole piece". Otherwise X is cut at the one or two bounding points and the piece goes: a middle piece leaves one new curve beyond it; an end piece re-points that end; a circle becomes the arc that stays.
3. Each other profile curve at a bounding point is cut there (split at one point).
4. The patches of regions and walls; the lists.

**extend `{ curve: X, end, with? }`**

1. The first contact of the extension (by `with`); the point there, used or new.
2. `setCurvePoint` of `end`; the old end by the rules of a cut-off end; a span line if X carries `equalLength` or `midpoint`.
3. The curve met is cut there when both are profile curves, else the point is held on it.
4. The patches; the lists.

**split `{ curve?, with?, at? }`**

1. With `curve`: its cuts (by `with`; with `at`, the one nearest). Without: every contact of two profile curves of the sketch, each pair once; a point is made once and shared by every curve through it.
2. Each curve with cuts is cut at its points (nothing removed); a circle with one point only is left and listed in `touching`.
3. The patches; the lists. A sketch with nothing to cut gives an empty batch (no undo step); a named curve with nothing to cut is refused.

**`ids`** (contract.ts, `CUT_IDS`; the same fourteen lists for the three tools, each always present): `changed`, `added`, `span`, `points`, `constraints`, `reattached`, `removed`, `touching`, `patched`, `dropped`, `pending`, `moved`, `shortened`, `broken`.

The batch is solved once, after its last command, and is satisfied as drawn. One undo takes it back, the patches included (measured).

## Input kinds

Two kinds are added to `SketchToolInput` (`sketch-tools.ts`), checked by `inputProblem` as the others are:

- `{ kind: 'curve'; projected?: boolean; optional?: boolean }`: the ID of a curve of the sketch, own (with `projected`, also projected), with a solved position. The app passes the curve under the pointer; MCP describes it as "the ID of a curve of the sketch".
- `{ kind: 'place'; optional?: boolean }`: `[x, y]`, two finite numbers within ±`MAX_NUMBER`. Not an anchor: nothing is made there and nothing snaps.

`extend`'s `end` is an `option` (`a`, `b`, `start`, `end`), checked against the kind of the curve by the tool.

## The document and the schema

- **No field, no command.** A trimmed, extended or split sketch holds points, curves of the three kinds and constraints of kinds every build knows; a patched feature holds other region references.
- **No upgrade step, no new version.** A build without the package reads such a document and gets the same model. `SCHEMA_PENDING` does not change.

## Where the code lives

| File | What 6e does there |
|---|---|
| `packages/engine/src/sketch.ts` | `curveContacts` exported; `compatible` reads it (no change of behaviour) |
| `packages/engine/src/sketch-cut.ts` (new, beside `sketch-tools.ts` in the order of imports of [repository.md](../../architecture/repository.md)) | the cut: cuts, pieces, keeper, constraints, ends, siblings, the side rule and the patches. `PROFILE_SOURCES` and the face helpers of the fillet move here, so that the fillet and the cuts read one table |
| `packages/engine/src/sketch-tools.ts` | the input kinds `curve` and `place`; the entries `trim`, `extend`, `split`; `trimPiece`, `extendReach`, `profileContacts` for the app |
| `packages/engine/src/index.ts` | the new exports |
| `packages/engine/test/modules.test.ts`, `docs/architecture/repository.md` | the new module in the order |
| `packages/mcp/src/api.ts` | the text of the two input kinds; the examples; a sentence of the section "Sketch tools" |
| `packages/mcp/test/tools.test.ts` | the examples run after a setup (a rectangle and a line across it), as the fillet's runs after the rectangle |
| `packages/app/src/sketch-mode.ts`, `sketch-commands.ts`, `panels/sketch.ts`, `sketch-view.ts` (after 6a: three files in the table of the app's tools) | the tools, the hover, the button, the marks |
| `packages/scenarios/test/` | the part of scenario 15 (calls.ts) and the measured cases as regressions |
| `docs/architecture/sketch.md` ("Sketch tools", "Profily a oblasti"), `naming.md` (regions after a cut), `docs/ui/sketch.md`, `verification.md`, `backlog.md` | the tools, the side rule, the UI rows, the tests; the backlog row of trim and extend closed with what is deferred |

## The app and MCP

**MCP.** `trim`, `extend` and `split` are reached by `sketch_tool`; their descriptions are generated from the catalog. The answer carries `ids` and the problems of the model after the batch; `preview: true` shows it without writing. `describe_api` gets the two input kinds and one sentence: *a profile with crossing curves is repaired by `split` without a curve (every crossing becomes a common point, constraints kept, the features' regions followed) and then `trim` of the pieces that should go, `at` a point of each*. An AI that computes its own end points does not need the tools; one that drew a circle across an outline, or reads an imported sketch, does.

**The app** (written against the app of `master`; after 6a each tool is a file and a line in its table):

- **Trim**: the piece under the pointer is drawn highlighted (`trimPiece` of the engine; nothing is computed in the app); a click trims it. A click on no curve says what the tool wants.
- **Extend**: near an end of a line or an arc, the extension to where it would stop is drawn (`extendReach`); a click extends that end (the nearer one, `nearestCurvePoint`).
- **Split**: a click on a curve splits it at all its cuts. The panel of the sketch has the button *Split crossings* (split without a curve), offered while the profile is invalid.
- **The contacts** of the profile curves are marked in the view while the profile is invalid (`profileContacts`), so a person sees where the curves cross.
- After each tool the status line says what was patched and names the features of `dropped`, `pending`, `moved`, `shortened` and `broken`; a refusal is said with its reason. The batch is sent as the tool made it (the switch *Konstrukčně* does not apply).

## Issue codes

None is added. The tools answer with a reason as text, like the others.

## Shared places and what 6e needs from 6a

- **Takes:** `SKETCH_TOOLS`, `sketchTool`, `SketchToolCall`, `PROFILE_SOURCES` and the patches of D52, `setCurvePoint`, `detectProfile`, `pointJoins`, `applyCommand`.
- **Adds:** three entries and two input kinds of the sketch tools; `curveContacts` of `sketch.ts`; the module `sketch-cut.ts`.
- **From 6a:** (1) the table of the app's sketch tools (part 4), for the three tools; (2) the profile read from a list of shapes (part 2): the tool computes the profile after its batch with the same function the sketch step uses, and the contacts are read over the same shapes; (3) exhaustive switches on the kind of a curve (part 3), so that a spline does not compile in 6e's code until each place refuses it; (4) from the vocabulary: which non-own geometry forms regions, and which can carry a point held on it (`pointOnCurve`). 6e's rule: **non-own geometry is never cut; it is a cut of an own curve exactly when a point can be held on it.** If 6a settles otherwise, 6e follows.

## Later kinds

- **Splines (6d).** Not cut, and not a cut: in the cheap variant of 6d no constraint holds a point on a spline, so a point at a crossing could not stay there. Each switch on the kind of a curve in `sketch-cut.ts` refuses a spline by name ("a spline is not trimmed, split or extended; …"), and a contact with a spline is not a cut, so a profile crossing a spline stays invalid. With the full variant of 6d (a point on a spline) a crossing becomes a cut held by `pointOnCurve`; cutting a spline itself needs knot insertion, which changes its control points, and is deferred beyond that.
- **Projections from another sketch (6b).** A cut, held by `pointOnCurve` like a projected edge; never cut. One that forms regions cannot get a common vertex with an own curve ("Open", 1).
- **Copies of 6c.** Not a cut (a point cannot be held on a copy in its own sketch) and never cut. A copy is computed from its source, so a cut of the source is the way: the copies follow.
- **An imported outline (6f).** Reference geometry that forms regions: as a projection with the flag.

## Rejected alternatives

1. **Regions from crossing curves made automatically** (Onshape, Fusion). Rejected by the plan with the owner's agreement: a region is named by the IDs of its outer curves, so a line through a circle would give two D shapes with one name. With `split` the two have different names (measured).
2. **A command that splits or trims a curve in the engine.** The sketch tools exist so that the engine has small commands and shapes are batches of them; everything here is a batch of existing commands. The one awkward step, moving a constraint to another curve, is a remove and an add under its ID in one batch; a command `setConstraintOperand` would say it more directly and is not needed.
3. **Repeating the constraints of the whole line on each piece** (the plan's sentence). Pieces of a slanted line need a collinearity anyway, and a repeated `horizontal` beside it is redundant. One `pointOnCurve` per new point keeps the freedom exact (measured: 0 throughout).
4. **Refusing a line with `equalLength` or `midpoint`**, as the fillet does. Every polygon of the polygon tool has `equalLength` on every side, so no polygon could be notched. The span line keeps their meaning (measured: the hexagon stays regular).
5. **Keeping every cut-off end** (as the corner of D52). An end nothing names is two free degrees of freedom: a determined sketch would stop being so after every trim.
6. **Removing every cut-off end.** A corner of another curve and a dimension of the whole length would go with it.
7. **Trim without cutting the other curve** (what Fusion shows). The profile would stay invalid until the other curve is trimmed too, the order of the two trims would decide whether the regions can be followed, and an AI would have to know that.
8. **Following regions by names alone** (as D52). A region cut into several by a split cannot be told apart by names: which pieces of the outline go with which new region is geometry.
9. **Following regions by overlap of areas** (polygon clipping of the old region with each new one). Needs a polygon boolean in the engine and tolerances on areas; the side rule reads only the loops, is exact, and gives the same answer for regions bounded by the curves of the sketch.
10. **Following regions only when the profile before is valid.** The notch, the case of the scenario, starts invalid.
11. **The keeper as the longest piece.** A plane on the side face of a line moves when its start moves; the piece with the start keeps it.
12. **A circle cut at one point as two arcs at that point and the opposite one.** The second point would be arbitrary and named by nothing.
13. **Removing a whole piece by `removeEntity`** (what an AI could send). The other pieces lose their line, and every corner its place on it (measured).
14. **`trim` by the other curve alone** ("the part beyond C"): which side is "beyond" needs a place; `with` narrows the cuts and `at` says the side.
15. **A query of the crossings** for an AI. `split` without a curve repairs them in one call; a list of crossings can come later if an AI needs to choose.

## Known limits

- **Non-own geometry is not cut**: a projected edge, a curve of another sketch, a copy of 6c, an imported outline. An own curve crossing one that forms regions leaves the profile invalid ("Open", 1).
- **Splines** are neither cut nor a cut until 6d's full variant.
- **A circle touched at one point** stays whole; two curves on one circle are not cut. Both leave the profile invalid, as today.
- **Collinear overlaps** are cut at the ends of each, which leaves two curves between the same two points; the profile stays invalid until one is trimmed. The converter removed duplicates itself; `split` does not remove what was drawn.
- **A region whose outline lost a piece while the sketch had other crossings** (rewritten by names, `pending`) has a gap and is dropped by the tool that later leaves the sketch valid; pick it again (`updateFeature`). Trimming the other curves first avoids it.
- **Regions are followed by their outer loops.** A region whose pieces end up only on holes of the regions after the batch is dropped.
- **A region follows into what it is merged with**: trimming a piece between two regions gives both features the merged region (measured with the two rectangles). It is the rule, and it changes bodies; `patched` says which.
- **A split line whose pieces stay in one region** gives two side faces in one plane, with an edge between them; a chamfer or a fillet of that side needs both edges. Not measured ("To verify").
- **A constraint that moves** is added again at the end of the sketch's constraints, so the order the diagnosis reads (`removable` keeps the older constraints) changes for it.
- **A cut point stays a crossing only while the curves cross**: a later change that pulls them apart is a `sketchConflict` (measured: a circle that no longer reaches the edge, a line that misses an arc), and the body keeps its last shape.
- **The lists are made from names** (`moved`, `shortened`, `broken`), as for the fillet; the result of the batch says what is in error.

## To verify before the implementation

- **The contact search against the profile**: `compatible` rewritten over `curveContacts` passes every test unchanged; on the notch, the hexagon, the slot and the two rectangles it finds exactly the points the prototype was given.
- **A circle crossing two sides at four points** (near a corner), trimmed piece by piece: the `pending` rewrite and its later follow, not measured.
- **The seam** of a split line whose pieces stay in one region: the edge between two coplanar side faces, its kind, and whether a chamfer of the side takes both edges.
- **A circle turned into an arc** with a rim that a sketch projects (`kind: 'circle'`) or a chamfer of D63 rounds: whether both still work on the arc's rim.
- **The arc of a trimmed circle under large changes** (the centre pulled far across the edge): whether the arc that stays is still the one inside.
- **Performance** of `split` without a curve on the largest sketch of the Onshape conversion (pairs of curves are tested all against all, as the profile does).
- **6a**: the app side adapts to the table of the app's sketch tools; the profile after the batch is computed by the function the sketch step uses over 6a's list of shapes.
- **The MCP examples** run after a setup in `tools.test.ts`; the snapshots of the app change by the three buttons and nothing else.

## Tests the implementation owes

- **Engine, the cut**: every row of the constraint table, for a line, an arc and a circle; the keeper and the direction of the pieces; the point at a cut used or made (an end of the other curve, a point held on it, a projected point by `coincident`); cuts within the tolerance of an end or of each other; the other curve cut or held; ends cut off kept or removed (a corner, a dimension, a hole point, nothing); a whole piece with and without a sibling; the span line; a circle with one, two and three cuts; the refusals, each with its reason.
- **Engine, the regions**: the notch (both trims, both orders); a circle split by a line; two overlapping rectangles split and their inner pieces trimmed; a region opened (`dropped` with and without other regions); a sketch left invalid (`pending`, then followed); a region of a revolve; a wall split, trimmed and emptied.
- **Engine, the lists**: `moved` for a trim of the first piece of a line; `shortened` for a wall, a projected edge and a chamfer; `broken` for an axis on a removed line.
- **Scenarios**: scenario 15, step 6 (calls.ts), and the measured cases as regressions (freedom, redundancy, volumes after changes).
- **MCP**: the descriptions and examples of the three tools and of the two input kinds; `ids` in the answer.
- **App**: each tool by clicks, the hover, the button, the marks, a refusal.

The review of the implementation is a full one: new geometry (the contacts) and a heuristic (the side rule) (CLAUDE.md, "Depth of the review").

## Open

For the owner:

1. **Scenario 15, step 6, and a projected outline.** The plan's step 3 extrudes the base from the board outline projected from `frame` and marked to form regions (6b, question 4). 6e does not cut projected curves, so a notch across that outline cannot be trimmed. Proposed: in step 3 the base sketch draws its outline as own lines held on the projection (which then does not form regions), and the notch is trimmed into those; taking a projected curve over as own curves (a tool of its own) is deferred. *Recommendation: the own outline; it changes one sentence of step 3.*
2. **The span line.** `equalLength` and `midpoint` of a cut line move to a construction line the tool adds over the old ends. The fillet (D52) refuses such lines instead. *Recommendation: the span line, since every polygon carries `equalLength`; say so if refusing is preferred.*
3. **A region follows into what it is merged with.** When a trim opens the outline between two regions, a feature that had either gets the merged region (its body grows). The other choice is to drop the region (the body loses it). *Recommendation: follow; a person trimming the wall between two regions means to join them.*

## Reviews

(Filled in after the reviews.)

## Rows for the indexes

**`docs/d36/README.md`, the row of 6e** (column "Design now"):

> full ([6e-trim-extend-split/design.md](6e-trim-extend-split/design.md), D65): the sketch tools `trim`, `extend` and `split` over existing commands (`setCurvePoint`, `addCurve`, `removeEntity`, constraints moved under their IDs), the other curve cut at every point the tool uses, the constraints kept (a tangency at a common end moved to the piece that has it, `equalLength` and `midpoint` to a construction span line, cut-off ends that something names held on the line), the regions of the features followed by a side rule over the profile after the batch, two input kinds (`curve`, `place`), `curveContacts` of `sketch.ts`; no command, no issue code, no schema step. Open for the owner: the notch of scenario 15 needs an own outline (projected curves are not cut), the span line, a region following into a merge

and in "Numbers": D65 taken by 6e (already there).

**`docs/decisions.md`, the row of the table:**

> | D65 | [6e Trim, extend and split](d36/6e-trim-extend-split/design.md) | designed 2026-11-17 | Crossing curves are repaired by three sketch tools, not by regions made automatically: trim, extend and split cut curves at the points where the profile's own test finds them touching, cut the other curve there too, keep the constraints with the piece they describe, and follow the regions of the features to the regions after the batch that lie on the same side of a piece of their curves |

**`docs/requirements.md`, scenario 15, the part of step 6:**

> - *A cable notch (6e, D65).* The base outline is drawn as own lines (held on the projected board outline) and extruded. A circle of the diameter `cableD` drawn across its bottom edge makes the profile invalid and the base an error. `trim` of the piece of the circle outside the outline turns the circle into an arc under its ID and cuts the edge at the two crossings; the sketch is valid and as determined as before, and the base is patched in the same batch to the two regions that cover its outline (its body unchanged). `trim` of the piece of the edge inside the circle removes it; the half disc is dropped from the base, which keeps the notched outline with the side face of the arc. `cableD` and the place of the notch follow by their parameters (volumes by hand within the chord tolerance); a notch moved off the edge is a conflict of the sketch. Two overlapping pads are split at their crossings by one `split`, each extrusion keeps its body, and their inner pieces trimmed leave one outline that both follow; a line is extended to the edge with its length dimension kept. Refused: a curve the sketch does not have, a split of a curve nothing touches, an extension that meets nothing, an end that two curves share, an end a line does not have.

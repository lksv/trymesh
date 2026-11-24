# 6e Trim, extend and split (D65)

**State: designed 2026-11-17, not implemented**, with the fixes of its three rounds of review ("Reviews"). Written against the code of `master` at `9162198` (steps 1 to 5 merged, schema version 9; D52 implemented). Package 6a (the preparatory part of step 6, D64) was designed at the same time and merged into `master` at `5673570`; 6e needs it only for the table of the app's sketch tools (part 4 of 6a, `SKETCH_TOOL_UI`), which its app side is written against ("The app and MCP"). The engine side needs only D52. The rules were measured with a prototype against the real solver and kernel ("Measured").

Files: [contract.ts](contract.ts) (the three entries of `SKETCH_TOOLS`, two input kinds, what the app reads), [calls.ts](calls.ts) (its part of validation scenario 15, step 6, and the cases the Onshape converter met).

The package is three sketch tools over existing commands, and one rule that is new:

1. `trim` removes the piece of a curve between two cuts; `extend` moves an end of a line or an arc to the next curve; `split` cuts curves into pieces where other curves cross them. Each is a batch of commands every build knows (`addPoint`, `addCurve`, `setCurvePoint`, `removeEntity`, `addConstraint`, `removeConstraint`, `updateFeature`), so there is no new command and no schema step.
2. What stood on a cut curve stays: its constraints go with the piece they describe, a dimension of the whole curve keeps measuring the whole, and the pieces stay on the line or circle of the curve.
3. **The regions of the features follow by the faces they cover**: a region that is gone is replaced by every region after the batch that holds a face of the cut sketch lying inside the region as it was. It is the part D52 could do by names and 6e cannot: a cut changes which loops exist.

## What the plan and the backlog say, checked against the code

[6-plan.md](../6-plan.md), "6e Trim, extend and split", and [backlog.md](../../backlog.md), the row "Trim and extend in a sketch; regions from crossing curves".

| Statement | What the code says |
|---|---|
| "Sketch tools (`SKETCH_TOOLS`, reached by `sketch_tool` and by the app) over `setCurvePoint` (D52)" | True. `sketchTool` takes the document since D52 (`SketchToolCall`), `PROFILE_SOURCES` says which feature types read a profile (the extrusion and the revolve), and the fillet patches regions and walls in its own batch. The three tools are entries of the same catalog |
| "`carrierContacts` of `sketch.ts` computes [the intersections] for lines, circles and arcs and is private" | True, and the profile's test (`compatible`) is more than it: it also tries the ends and the middles of both curves, and ignores a touch within the reach of a vertex the two share (a tangent join). The middles are only a probe for an overlap, not places to cut (review 1). 6e exports the contacts as points to cut at, built from the same carrier contacts, ends, tolerance and reach, and states which rejections of the profile have no point ("Where the tools cut") |
| "One piece keeps the ID, the others are new curves" | Measured as the way to go: the regions get new names that tell the pieces apart (a line through a circle gives two regions, `{k, middle}` and `{k', middle}`), which is what the owner wanted from tools rather than automatic regions |
| "New points at the crossings get `pointOnCurve` on the crossing curve" | Not enough: the profile joins curves only at common points (`pointJoins`), so a point held on the other curve by `pointOnCurve` still touches it in its interior and the profile stays invalid. The other curve has to be cut at the same point. `pointOnCurve` is what holds the point on a curve that is not cut (a construction or a projected curve) |
| "Constraints that describe the whole curve (horizontal, a radius) are repeated on the new pieces" | Repeating them is either redundant or too weak. Pieces of a slanted line need a collinearity anyway, and beside it a repeated `horizontal` is redundant. The pieces are held on the line of the curve by one `pointOnCurve` per new point, and a constraint of the whole line stays on the piece that keeps the ID ("What happens to the constraints"). Two arcs of one circle that no longer share an end need an `equalRadius` (measured) |
| "Trim removes the piece under the cursor (a split, then the removal)" | In effect yes: the batch re-points the curve and adds only the pieces that stay. A piece with no cut inside it (a piece left by an earlier split) is a whole curve, and removing it needs more than `removeEntity`: the other pieces stand on it ("Removing a whole piece") |
| "A trimmed circle becomes an arc: removed and added again under its ID with its constraints (D52 measured that an ID removed in a batch can be reused and faces keep their names)" | True and measured again: the arc of the notch keeps the ID of the circle, its diameter dimension under its ID and expression, and the side face `side/<circle>` |
| "Extend moves an end … to the nearest crossing of its extension with another curve (a new point with `pointOnCurve`, then `setCurvePoint`)" | True, with the other curve cut there when both are profile curves |
| Not in the plan: what happens to the old end of a trimmed curve | `setCurvePoint` keeps the old point (D52). An end nothing names is a free point with two degrees of freedom; an end something names should keep its meaning ("Ends that are cut off") |
| Not in the plan: the regions of the features | The fillet's patch is by names: the arc joins every loop that passed the corner. A cut is not: one region becomes several, several become one, or a region is opened. The tool computes the cut sketch and follows each region by geometry it already has ("Regions") |
| Not in the plan: a sketch that is already invalid | The notch of scenario 15 starts with a circle across the outline, so the profile before the tool has no regions. The rule of the regions rebuilds each region as it was from its curves and the curves that do not cross it |
| The converter "had to split [six sketches] itself, losing every constraint on a split curve" (`tools/onshape/sketch.ts`, `splitAtCrossings`) | What it met: lines crossing lines, lines crossing circles, circles crossing circles, an end of one curve on another (a T), collinear lines that overlap (the ends of each split the other, duplicates removed), a circle touched at one point (left whole), arcs left alone, points of two curves at one place (merged into one). `split` without a curve does the same and keeps the constraints; duplicate pieces of an overlap are left to trim ("Known limits") |

## The cheap variant

- **`trim { curve, at, with? }`**: the piece of `curve` nearest to `at` goes. A piece is the part between two neighbouring cuts or between a cut and an end. `with` selects which contacts bound the piece: those with one curve, of any kind; the other crossings are still cut ("The other curve is cut too").
- **`extend { curve, end, with? }`**: an end of a line (`a`, `b`) or an arc (`start`, `end`) moves along its line or circle to the first curve the extension meets (`with`: to that curve).
- **`split { curve?, with?, at? }`**: `curve` is cut at all its cuts (`with`: those with one curve; `at`: the one nearest to a place; these two cut only what they are asked to). Without `curve`, every contact of two profile curves in the sketch is cut: the repair of a profile with crossing curves in one batch.
- **A trim or an extend of a profile curve first cuts every contact of profile curves in the sketch, as `split` without a curve does**, so that the sketch is valid after it whenever nothing else makes it invalid, and the regions can be followed at once.
- **In each batch**: the constraints moved to where they belong; ends cut off kept on the line or circle when something names them, else removed; the regions and walls of the features over the sketch patched (`updateFeature`), as the fillet does.
- **Two input kinds** for the catalog: a curve by its ID, and a place `[x, y]`.
- **The app**: the tools *Trim*, *Extend* and *Split*, three entries of 6a's table `SKETCH_TOOL_UI`, the piece under the pointer shown before a click, the button *Split crossings*, and the contacts marked while the profile is invalid. **MCP**: nothing beyond the description of the two input kinds, three examples and one sentence.
- **The document does not change its shape**: no field, no command, no schema step.

**Deferred:**

- Cutting non-own geometry: a projected edge, a curve of another sketch (6b), a copy of 6c, an imported outline (6f). Taking a projected curve over as own curves is the way, if it is wanted ("Open", 1).
- Splines (6d): neither cut nor a cut until a point can be held on a spline.
- Extend to the extension of the other curve (past its ends).
- A break at an arbitrary place (no crossing there); a chamfer of a sketch corner and removing a fillet (D52's deferred tools over the same commands).
- A trim that takes the common end of a tangency off its line or arc (refused; it needs the solver adapter to read an end held by `pointOnCurve`, D52's alternative 17).
- A query of the crossings of a sketch (an AI uses `split` without a curve instead).
- Changing the converter (`tools/onshape`) to call `split` ("For the plan").

## Measured

**Recipe.** A prototype of the rules in the scratchpad of the session (`scratchpad/6e/`), run from the worktree with `npx vitest run --config <scratchpad>/6e/vitest.config.ts` against the real planegcs and Manifold adapters:

- `proto.ts`: the cut of one curve at given points (pieces, the keeper, constraints moved, carrier and end constraints, a circle turned into arcs), the removal of a whole piece with its sibling, and two rules of the regions: the side rule of the first version and the face rule that replaced it after review 1 (the region as it was rebuilt with `detectProfile`, the faces of the cut sketch, a sample point per face).
- `a-notch.spike.ts` (the notch), `b-split.spike.ts` (a circle split by a line; the dangling pieces trimmed; a slot whose arc is split; a hexagon notched), `c-more.spike.ts` (two overlapping rectangles; an extend; a trim at a corner); after review 1: `d-faces.spike.ts` (a grid across a rectangle; a plate with a hole crossed by a line; the notch by the face rule; the middle of an arc trimmed) and `e-review1.spike.ts` (a line across a corner; the notch in the other order); after review 2: `f-review2.spike.ts` (a hole crossed only by an inner line); after review 3: `g-review3.spike.ts` (a diagonal from corner to corner through the hole). The prototype tests points in regions on the polylines; the design asks for the exact curves (review 2), which the prototype's cases, with steps of 0.05 mm against a chord tolerance of 0.01 mm, did not need.
- **The crossing points were given to the prototype by hand** (computed analytically); the contact search of the tools was not run. Everything after it (the batches, the solver, the profile, the patches, the bodies) is the real code. Review 1 found two rules that this hid (midpoints as cuts, construction curves as cuts of a profile curve); both are fixed in the rules, and the contact search is the first item of "To verify".

In every case the sketch was fully determined before the tool (0 degrees of freedom) and the engine's analysis and the library reported no redundant constraint unless a row says so.

### The cable notch (scenario 15, step 6)

A rectangle 80 × 50, fully dimensioned, extruded 10 (40000); a circle of radius 6 with its centre dimensioned at (40, 2), across the bottom edge `ba`.

| Step | Sketch | The base |
|---|---|---|
| The circle drawn | solved, `valid: false`, freedom 0 | `invalidProfile` |
| Trim 1: the piece of the circle below the edge. The circle becomes an arc under its ID (S2 to S1 counter-clockwise) with its radius dimension; `ba` is cut at S1 and S2: it keeps the piece from b1, two new lines follow, `pointOnCurve` of S2 and of b2 on `ba` | solved, valid, freedom 0, two regions: `{ba, bb, bc, bd, k, piece 2}` and `{k, piece 1}` | patched to both (the rectangle less the half disc, and the half disc): `ok`, 40000 |
| Trim 2: the piece of the edge inside the circle, now a curve with no cut inside it: removed | valid, freedom 0, one region | the half disc is dropped, `ok`, 39200.48 (by hand 39199.04; the arc is a polygon within the chord tolerance). Side faces `ba`, `bb`, `bc`, `bd`, `k` (the arc), piece 2 |
| The other order: trim 1 the middle of the edge (the circle cut into two arcs at S1 and S2) | valid, freedom 0, two regions: the notched rectangle and the whole disc | patched to both: 40329.08, the half disc below the edge included (it was merged with the half above, which was the base's) |
| then trim 2 the lower arc | valid, freedom 0, one region | 39200.48, the same as the first order |

The first order gave the same patches with the side rule of the first version (`a-notch`) and with the face rule (`d-faces`); the other order was run with the face rule (`e-review1`).

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
- Radius 12 and 9, the centre moved, the line moved to y = 7, −5 and 10.9, a drag of a crossing point: all solved, freedom 0, the volume of the disc. y = 12 (the line misses the circle): `sketchConflict`.
- The keeper of the line (the piece from its start, the carrier of the other two) trimmed: its `horizontal` and the `pointOnCurve` of the far end moved to the middle piece, its start (named by two dimensions) held on the middle piece. Then the far piece trimmed. Freedom 0 after both, changes solved. Three undos give the crossed sketch back.

### Regions inside a region, and a hole (after review 1)

- **A grid**: a rectangle 60 × 60 extruded 2 (7200), four fixed lines across it (x = 20, 40; y = 20, 40). All crossings cut: nine cells. The face rule gives the plate all nine, the centre cell included, 7200. (The side rule of the first version would give eight, by the reviewers' reading, not run: the centre cell touches no curve of the rectangle, and the body would have a square hole.)
- **A plate with a hole** (60 × 40 less a circle of radius 8, 4398.54) and a line through both: the rectangle cut at two points, the circle into two arcs, the line into three. The plate is patched to the two regions around the hole, not the halves of the disc: 4398.52. The circle was rebuilt as a hole of the region as it was, because it does not cross the region's curves.

- **A hole crossed only by an inner line** (after review 2): the plate with the hole, a line across the hole alone (y = 22, x from 20 to 40), and a notch circle across the bottom edge, all cut in one batch. Rebuilding the region as it was in one stage left the line and the circle out together (they cross), the hole was lost and the plate became 4800 with the hole filled. In the three stages of "Regions" (the line has free ends and goes first) the circle is a hole again: 4398.52, the plate's body (`f-review2.spike.ts`).
- **A diagonal through the hole** (after review 3): the same plate, the line from corner `r1` to corner `r3` through the centre of the hole, and the notch. Counting the free ends among all the curves left (R's included), the diagonal has none (its ends are corners of R), stays to stage 3 and goes there with the circle: the hole was filled again, 4800. Counting them among the curves that are not R's, as "Regions" now says, it goes in stage 2 and the hole stays: 4398.52. The inner line gives 4398.52 both ways (`g-review3.spike.ts`).

### Arcs and tangencies

- **The middle of an arc trimmed** (an arc of radius 10 about the origin, a fixed line at y = 6 across it, the top piece removed): the two arcs that stay share the centre and no end. Without a constraint between them the sketch has freedom 1, and after the radius is set to 12 the second arc is still at 10. With `equalRadius` of the two: freedom 0, both at 12.
- **A slot** (two lines, two arcs, four tangencies, radius, length; a fixed vertical line through the right arc). The right arc is split at the two crossings: the keeper keeps its start and the tangency with the bottom line; the tangency with the top line goes to the last piece, which has that common end. Split, radius 8 and 4, length 32 and 28, the line moved: solved, nothing redundant; length 40 (the line misses the arc): `sketchConflict`. **The same with the tangency left on the keeper**: the split already reports it redundant, and lengths 32 and 28 are conflicts that name it. It is the double root that D52 cured for a tangency at a common end; the cure works only if the tangency names the piece that has the end.
- **A hexagon** of the polygon tool (five `equalLength` on its first side, the circumscribed diameter 20), with a circle of radius 2 held at the middle of that side by `midpoint`. Trim of the outer piece of the circle and of the middle of the side: the five `equalLength` and the `midpoint` move to a construction line over the old ends of the side (the span line). Freedom 0; 760.69 (by hand 760.57). Size 30: the six sides between the vertices are 15.000000 each, the circle stays at the middle of the span (11.25, 6.4952), 1734.97 (1734.85). (The notch circle also crosses the construction circle of the polygon, which the prototype was not given; by the rule after review 1 a construction curve does not cut a profile curve unless named by `with`.)

### Overlaps, corners, an extend

- **Two overlapping rectangles** A (40 × 30 at the origin, extruded 5) and B (40 × 30 at (20, 10), extruded 3), each dimensioned from the origin: both extrusions `invalidProfile`. Split at the two crossings (four lines cut): three regions, A patched to {A∖B, A∩B}, B to {A∩B, B∖A}: 6000 and 3600, freedom 0. B moved and A widened: solved, 6000 and 3600, then 7500. The four inner pieces trimmed one by one: freedom 0 throughout, and both extrusions end on the union (10000 and 6000). After the first trim A already covers the union: its region A∩B was merged with B∖A, and a region follows into what it is merged with ("Regions").
- **A first version of the removal of a whole piece** moved the carrier constraints to the sibling but did not hold the ends that stay (a corner of the other rectangle) on the sibling's line: the freedom went 0, 1, 2. With the rule of "Removing a whole piece" it stays 0.
- **A line across a corner** (a rectangle 60 × 40, extruded 2; a fixed line from (40, −10) to (70, 20) across the bottom and the right side): the corner piece of the bottom side trimmed, with the line and the right side cut at their contacts. Freedom 0; the plate patched to the region without the corner triangle: 4700 (by hand 4700). Width 65: 4975 (by hand 4975).
- **Extend**: a vertical line inside a rectangle, its start dimensioned, its length 10, extended from (10, 20) to the top side (10, 30). The top side is cut there; the old end stays on the line (its length dimension names it). Freedom 0; the region patched with the new piece of the top side; height 50 moves the new end to (10, 50) and keeps the old end at (10, 20); a length of 15 moves the old end to (10, 25).
- **A trim at a corner**: the bottom side of a rectangle trimmed from a crossing at x = 25 to its end at the corner r2. The corner is the end of the right side and named by the width: it stays, held on the line of the bottom side (the virtual end). Freedom 0; width 60 puts r2 at (60, 0). The outline is open: the extrusion is `noProfile` and is listed (`dropped`).

## Decisions

### Where the tools cut

`sketch.ts` exports the contacts of two curves as points to cut at. The function works on shapes (as `compatible` does, so that `touchingCurves` of the offset keeps working over `OutlineCurve`s), with a wrapper by the IDs of a sketch. With `LENGTH_TOLERANCE`:

- **A crossing or a touch**: a point `carrierContacts` returns that lies on both curves (within the tolerance), and is not within the reach of an end the two share (the reach of `compatible`, in which a tangent join is not a touch).
- **An end on the other curve**: an end of one curve that lies on the other curve away from its ends (a T).
- **An overlap**: two lines on one line, or two arcs on one circle, that share a stretch. The cuts are the ends of each that lie strictly inside the other. A curve that covers X exactly, or lies along X with no end inside it (a span line over a piece, a projected line under an outline), gives X no cut.
- **Not points**: two curves at one place by every point (a duplicate), two circles or a circle and an arc on one circle, two ends of two curves at one place that are not joined, a tessellation problem (`soundTessellation`), a curve of no length. The profile rejects them and a cut cannot repair them; `split` repairs the third by joining the two ends ("Ends at one place") and reports the others.

`compatible` keeps its code; the guarantee is checked by tests ("To verify"): every pair it rejects either has a contact point or is one of the cases without a point.

A **cut** of a curve X is a contact of X with another curve that is not within the tolerance of an end of X; cuts within the tolerance of each other are one.

- **Which curves cut X.** When X takes part in the profile (own, not construction): the other profile curves. A construction or projected curve cuts a profile curve only when `with` names it (trimming an outline back to a construction line is then said aloud; review 1 found that the construction circle of every polygon would otherwise cut its sides). When X is a construction curve: every other curve, own or projected. `with` selects among the contacts of X those with one curve, of any kind, and only for what bounds a trimmed piece, stops an extension, or is split by `split { curve, with }`; the repair below does not read it.
- **The positions are the solved ones** (`context.result`, which holds the projected points and the origin as well), as for every tool.
- **The point at a cut**: an own point or `origin` within the tolerance that one of the two curves ends at (by `pointJoins`, the class of points joined with it), or holds by `pointOnCurve`, is used; otherwise a new point at the exact place. A contact at a point of projected geometry gets a new own point held on the projected curve by `pointOnCurve` (not joined to the projected point by `coincident`, which with the curve's own constraints would be one equation too many).

### The other curve is cut too, and a trim cuts every crossing first

The profile joins curves only at common points. A new point on X held on C by `pointOnCurve` still lies in the interior of C, and the profile stays invalid. So **at every cut, the other curve is cut as well when both take part in the profile**. When C is a construction or a projected curve, the point is held on it by `pointOnCurve` (unless it ends there or holds it already).

**A trim or an extend of a profile curve first cuts every contact of profile curves in the sketch**, as `split` without a curve does, and then removes its piece or moves its end. Two kinds of contact are told apart (review 2): the contacts that **select** (the two cuts that bound the removed piece, the curve an extension stops at; `with` narrows only these) and the contacts that **repair** (every other contact of profile curves, which is cut whatever `with` says). Contacts inside the removed piece are not cut on either curve: the piece goes. The extended stretch of a curve is cut at every profile curve it crosses before it stops (each of those curves too), so an extension with `with` past another curve leaves no crossing. Review 1 showed why cutting only at the two points around the piece is not enough: a line W across two sides X and Y near a corner, the corner piece of X trimmed; cut only at its crossing with X, W still crosses Y, the sketch stays invalid and the region of the outline cannot be followed (and by the time Y is trimmed, X no longer reaches the corner). With every crossing cut first the sketch is valid after the first trim (measured: the corner, 4700), and the order of the trims does not matter (measured: the notch both ways). The crossings the tool cuts are those that make the profile invalid; they have to be cut for a profile anyway.

A trim or an extend of a construction curve cuts nothing else: the curve is cut at the two points around its piece (or at its new end), holding them on the curves there. `split { curve, with }` and `split { curve, at }` cut only what they are asked to; a sketch they leave invalid puts the features over it in `pending`.

**Cut, defined once.** A **selecting** contact bounds the piece a trim removes, stops an extension, or is one `split { curve, with | at }` is asked for; `with` filters these alone. A **repairing** contact is every other contact of two profile curves, cut by a trim or an extend of a profile curve and by `split` without a curve. A contact inside the removed piece is neither. Where the steps below say "X is cut at its cuts", that is its repairing contacts, its selecting ones, or both, as each step states.

### The pieces and the keeper

A cut curve is divided at its cuts, in its own direction (a line from `a` to `b`, an arc counter-clockwise from `start`; a circle counter-clockwise from the cut whose angle about the centre, in [0, 2π) from the x axis of the sketch, is the smallest).

- **The keeper** is the piece with the start of the curve (`a`, `start`; of a circle, the first piece), unless that piece is the one removed; then the next. It keeps the ID: `setCurvePoint` moves its far end (and its start, when the first piece went). A planar side face starts at the start of its line ([naming.md](../../architecture/naming.md)), so a keeper that keeps the start moves no plane; a start that was re-pointed puts the features on that face in `moved`, as D52 does.
- **The other pieces** are new curves of the same kind, construction flag and direction. A new arc has the centre point of the curve.
- **A line's pieces stay on its line**: each point of a piece that is not an end of the keeper gets `pointOnCurve` with the keeper (a line holds a point on its extension as well), unless the batch keeps a constraint that holds it there already: a `pointOnCurve` of the point on X (it stays on the keeper and is the hold), or, for the old far end of X, a `midpoint` of X moved to the span line **whose point is itself a point of X's pieces or held on X** (a rib from the middle of a side: the start, the middle and the far end are then collinear on the keeper's line). A `midpoint` whose point is elsewhere (the centre of the notch circle of the hexagon) holds nothing on the keeper's line: the far end is held (review 3; review 2 had dropped the hold for every `midpoint`, which frees one degree in the hexagon). One equation per new point, which is what keeps the freedom: the point has two coordinates, one is taken by the curve it is cut at and one by the line.
- **A cut at an existing point that lies on X only by its dimensions** (the end of a T placed by dimensions, not by `pointOnCurve`) adds one equation: the point becomes an end of X's pieces. In a determined sketch the equation is redundant; it is the price of making the T a vertex of the profile ("Known limits").
- **An arc's pieces stay on its circle**: they share the centre point, and pieces that share an end are on one circle by their arc rules. **Groups of pieces that share no end** (the middle of an arc trimmed) are tied by `equalRadius` of the first piece of each group with the keeper (measured: without it the sketch has one more degree of freedom and the far arc does not follow a change of the radius). A circle cut into arcs repeats an arc rule once (the last piece closes the chain); measured harmless.

### What happens to the constraints

For every constraint that names a cut curve X, by its kind (the catalog `CONSTRAINTS`; every kind with a curve operand is here):

| Constraint on X | Goes to | Why |
|---|---|---|
| 1. `horizontal`, `vertical`, `parallel`, `perpendicular`, `angle` (X a line) | stays on the keeper | the pieces are on one line and keep its direction |
| 2. `distancePointLine`, `symmetric` (X the axis) | stays on the keeper | they read the line of X, not its extent |
| 3. `pointOnCurve(p, X)` | stays on the keeper; removed when it becomes an identity: `p` an end of the keeper (a line), or an end of a piece on the keeper's circle (an arc or a circle); `p` in the class of such an end by `pointJoins` counts | an identity is a redundant equation, and the library may report it |
| 4. `radius`, `diameter`, `equalRadius` (X an arc or a circle) | stays on the keeper | the pieces are on its circle |
| 5. `tangent(X, Y)` | the piece that has the common end with Y by the rule of the solver adapter (`commonEnd`: the same point ID, or two points one `coincident` of the sketch names together; no positions read); when Y is cut too, the pieces of both that share it; otherwise the keeper | the adapter gives a tangency of a line and an arc at a common end its own form (D52); on another piece it is the double root again (measured: redundant at once, conflicts after changes). For two arcs, and a circle, nothing changes: the adapter has no such form for them (D52) |
| 6. `equalLength(X, Y)`, `midpoint(m, X)` | a construction line from the old start to the old end of X (the **span line**), added once per line | they measure the whole line; on the keeper they would measure a piece and change the shape without a word. The span keeps the shape (measured: the notched hexagon stays regular) |
| 7. `distance` between the ends of X, and every constraint on a point | stays on its points | the points stay ("Ends that are cut off") |

A constraint that moves is removed and added again under its ID with the other curve, its value, its expression (the input form) and its driving flag, in the same batch (an ID removed in a batch can be reused, D52). It is listed in `ids.reattached`. **A moved or added constraint that would repeat one the sketch has** (a repeat is what `duplicateOf` of `sketch-content.ts` finds: the same kind and operands among the driving constraints; reference dimensions are never repeats), **or would name one curve twice** (an `equalRadius` of an arc with itself), **or would be an identity, is not added**; the one there serves, and a moved one goes to `removed`. When the moved one carries an expression and the one there does not, the moved one wins instead: the one there is removed (to `removed`) and the moved one added, so a parameter keeps driving it. A dimension whose expression does not evaluate now (its parameter removed) cannot be added again: the tool refuses before it, naming the constraint. Nothing else is dropped: only identities, repeats, a constraint of one curve with itself, and what goes with a removed curve or point (`ids.removed`).

A **trim that takes the common end of a tangency off its curve** is refused: a line trimmed away from the end of an arc it is tangent to, or an arc piece that held the common end with a line trimmed away. The end would stay, held on the other curve by `pointOnCurve`, which the adapter's rule does not read, and the tangency would be the double root again (D52, "Known limits"). The message names the tangency; removing it first, or extending the adapter to an end held by `pointOnCurve` (D52's alternative 17), are the ways on.

The tool applies its batch to the document anyway, to compute the cut sketch ("Regions"); a batch the engine refuses makes the tool refuse with the engine's message.

**The order of the commands in the batch**: (1) new points; (2) the removals of constraints that move or become identities; (3) the re-points (`setCurvePoint`), the removals and re-additions of circles turned into arcs, the new pieces and span lines; (4) the removal of whole curves and of cut-off ends; (5) the added and re-added constraints; (6) the `updateFeature` patches. A `midpoint` whose point becomes the keeper's end (a rib from the middle of a side) would make `setCurvePoint` refuse if it were still on the line; it has moved to the span by then.

### Ends that are cut off

A trim of an end piece, and an extend, take an end point off the curve. **The old end stays when anything else names it**: another curve that has it in any role (an end, also through its class by `pointJoins` (a corner joined by `coincident`), or a centre), any constraint other than a `pointOnCurve` of the point on X's own line or circle (on X, its keeper or a sibling: those are the tool's holds and go with the point, review 2), a feature of the document, or a section of it (`namedBySections`: a joint of the mechanism names sketch points and lines through its axis). It is then held on the line or circle of the curve (`pointOnCurve` with the keeper): the virtual end, as the virtual corner of D52. A length dimension still measures the whole (measured: the extend), a corner still lies on the line of the trimmed side (measured: the trim at a corner), and the freedom does not change. `origin` is never removed.

**An end nothing names is removed** (`removeEntity`, after the re-point). Kept, it would be a free point of two degrees of freedom, and a sketch that was determined would no longer be (alternative 5). The first version also removed ends named only by a `coincident` or a `pointOnCurve`; review 1 showed that such a constraint can be what holds the line (an end joined to a fixed point), so it is not done.

### Ends at one place

Two ends of two profile curves at one place (within the tolerance) that are not joined make the profile invalid (`pointJoins` joins by ID or a satisfied `coincident` only) and give no point to cut at. `split` without a curve, and the cuts a trim or an extend make first, join them. When one of the two points is named by nothing but its curve, that curve is re-pointed onto the other point (`setCurvePoint`) and the orphan removed (one point in the document, not two and a constraint); otherwise a `coincident` joins them (listed in `constraints`). Either way, two points that were each determined are over-determined after the join: the re-point removes the orphan's two unknowns, which has the rank effect of the two equations of a `coincident`, and the redundancy shows on the curve's own constraints instead (review 3; not measured, "To verify"). The converter met this case and merged such points itself.

### Removing a whole piece

A piece with no cut inside it is a whole curve: a curve that crosses nothing, or a piece an earlier split made. `trim` removes it. When other pieces stand on it, `removeEntity` alone loses their line: they are held on it by `pointOnCurve`, and its `horizontal` held them all.

- **A sibling** is another own curve on the same carrier, held there by constraints and not by position: a line both of whose ends are ends of X or held on X by `pointOnCurve` (or the reverse), running the same way (a piece of the tool always does; a line running the other way is no sibling, since an `angle` would turn by π); an arc with the same centre point that shares an end with X, or is tied to it by `equalRadius`. Of the siblings, one with the construction flag of X is preferred (a span line is a construction sibling of a profile line), then one that shares an end with X, then the first by ID. A concentric arc of another radius is not a sibling.
- **Everything that holds the carrier moves to the sibling**: rows 1 to 5 of the table, by the same remove and add under the ID; a constraint between X and the sibling (an `equalRadius` the tool added) goes, and one that would repeat a constraint of the sibling or become an identity on it is dropped.
- **Every end of X that stays** (by the rule of a cut-off end) and is not an end of the sibling is held on the sibling (`pointOnCurve`), unless it is held there already (in the notch, S2 on `ba` from the first trim); an end nothing names is removed. Measured: without this, each corner end lost its line and the freedom grew by one.
- **Without a sibling** the curve goes with its constraints (`removeEntity` semantics), and its ends that nothing else names go with it. That is the trim of a curve that crosses nothing, which other CAD programs also delete.
- What described X's own extent (`equalLength`, `midpoint` on X itself) goes with it and is listed in `removed`.

### A circle

- **Split** at two or more cuts: the circle becomes arcs on its centre, the first under its ID (removed and added again in the batch, with every constraint on it added again), the others new.
- **Trim**: the arc that stays is the circle from the cut after the removed piece around to the cut before it, under the ID of the circle.
- **The points a circle gets are pooled over the whole batch** (the cuts made first, the bounds of a trim, the new end of an extend), and the circle is cut when they are two or more.
- **Touched at one point** (a tangency, one end of another curve on it, an extension that stops on it): there is no arc from a point to itself (the engine refuses one), and a second point would be arbitrary. Such a contact is not cut on either curve (the other curve is not cut there either, which would only add a free point), except that a bound of a trim there (a line that ends inside a circle, crossing it once, its inner part trimmed) and a new end of an extend that stops there cut only the other curve: the point is held on the circle by `pointOnCurve` (review 3). The circle is listed in `uncut` and the profile stays invalid there (the features over it in `pending`). `trim` of such a circle removes it whole (the piece from the point round to itself). `split { curve: circle, at }` is refused: one point does not split a circle.
- **A circle that a generated profile names as an operand** (the pitch circle of a gear) is not cut: `split` without a curve leaves it and lists it in `uncut`; a tool that names it is refused. The generator takes a circle, not an arc.

### Extend

The end is taken before the cuts made first: after them it belongs to the piece of X that holds it (the last piece of a line cut in the middle), and that piece is the one extended, checked, given a span line and listed (review 2). When that piece is not the keeper (a line), its new end is held on the keeper's line (`pointOnCurve`), as every point of a piece that is not the keeper's end; the pieces of an arc share the centre (review 3). The end of a line moves along the ray beyond it; the end of an arc along its circle beyond it (the end counter-clockwise, the start clockwise), less than a full turn. Contacts at the current end and along the curve as it is do not count. It stops at the first contact of the extended curve with another curve (by the rule of which curves cut; `with`: that curve), within that curve's extent. The point there is used or made as at a cut, and the curve met is cut there when both take part in the profile. The old end is cut off by the rules above. Constraints that read the extent of a line (`equalLength`, `midpoint`) go to its span line, as for a trim.

Refused: an end whose class by `pointJoins` holds an end of another curve (extending it would leave that curve's end in the middle of this one); an end that lies on another profile curve away from its ends (a T: the extension would pass through it, review 2); an extension that meets nothing; an arc that would reach X as it was before the cuts first (its own other end, or any piece of X on that circle, review 3); a new end out of the range ±`MAX_NUMBER`.

### Regions

The tool knows the sketch after its batch exactly: the curves are those of the document after the batch (it applies the batch with `applyCommand`) and the positions are the solved ones plus the new points, all at their exact places. The batch is solved as drawn. Over it the tool computes, in memory, with `detectProfile` (after 6a: the function the sketch step uses over its list of shapes):

- **the regions after**: the profile of the sketch after the batch;
- **the faces**: the profile of the same sketch with the pieces the batch removes put back (each removed piece cut at all its contacts, and the curves it touches cut there too, in this sketch in memory only: the batch does not cut the contacts inside a removed piece, review 3; a removed piece that lies on a curve that stays, a duplicate, is not put back, since it bounds nothing the other does not, review 2). Every curve that bounded a region before is in it, whole or in pieces, so every face lies wholly inside or wholly outside each region as it was, and every region after is a union of faces. If the faces are still not a valid profile while the sketch after the batch is valid (a case for "To verify"; none is known), each region that is not a region after is left as it is and the feature is in `dropped`, as for a region that cannot be rebuilt (review 3);
- for each region R of a feature over the sketch (`PROFILE_SOURCES`: the extrusion and the revolve) that is not a region after: **R as it was**, the profile of the sketch before the batch, with the joins the batch adds (its `coincident` constraints and re-points of ends at one place, so that a corner the batch joins closes R, review 2), restricted to R's curves and the profile curves that do not cross them nor any curve kept, left out in three stages: (1) every curve that touches one of R's curves apart from a common point; (2) every curve with a free end, counting the ends among the curves left that are not R's, again until none has one (an open chain is no hole, also one whose ends are vertices of R, such as a diagonal from corner to corner across a hole: measured, review 3); (3) every curve that still touches another. R is a region of it, with its holes (measured: a hole that a line crosses, from R's outline, only inside, or from corner to corner, is a hole of R again; in one stage, a hole crossed only by an inner line was lost and the body filled).

**The face rule.** R is replaced by every region after the batch that holds a face lying inside R as it was. A face is tested by one point inside it, away from its boundary (stepped in from the middle of a curve of its outer loop; inside the outer loop and outside its holes), against R's loops and against the loops of the regions after. **Every test of a point in a region runs on the exact curves** (`Loop.exact`: lines and arcs; `inside` of `recompute/outline.ts`, exported for it, since today it is private to that module and the ray test of `detectProfile` is a closure), not on the polylines: the arcs of a region and of its faces are divided independently, so a point near an arc can fall on the wrong side of a chord (review 2).

- **Why it is right.** R covers some faces exactly. A region after that holds one of them shares area with R; one that holds none does not. The region as it was, rebuilt without the crossing curves, has the holes R had before they were drawn.
- **What follows from it.** A region cut into several by a split is replaced by all of them, so the body does not change (measured: 40000, 6000 and 3600, the disc, the grid of nine cells with its centre, the plate around its hole). A region whose outline is opened into a neighbour follows into the merged region (measured: A covers the union after its first inner piece is trimmed; the notch in the other order holds the half disc below the edge until its arc is trimmed). A region with no face held by a region after is **dropped**: from the feature's list when it has other regions (the half disc of the notch), otherwise left, and the feature ends in `noProfile` (the opened rectangle). Either way the feature is in `ids.dropped`.
- **A region that cannot be rebuilt** (its curves do not make a region of the restricted sketch: removed by hand earlier, or an outline that touches itself in a way the restriction breaks) is left as it is in the feature's list and the feature is in `dropped`; the recompute says whether it is still there.
- The patch is `updateFeature` with `{ profile: { regions } }`, the whole list: regions that are the same after kept in their order, new ones after them without repeats. Only references the feature did not have are verified, so it is accepted in the batch that makes them.

The first version followed a region along the pieces of its own curves, on the side it lay (the side rule). Review 1 gave the counter-example of the grid: the centre cell touches no curve of the rectangle. It is alternative 9.

**When the sketch is still invalid after the batch** (a crossing the tools do not cut remains: a circle touched once, a duplicate, non-own geometry that forms regions, a crossing left by `split` with `with` or `at`, one elsewhere in the sketch after a trim of a construction curve) there are no regions after to follow into. A region that names a curve the batch changes is rewritten by names: each changed curve replaced by its pieces that stay, a removed curve left out; a region left with no curve is dropped (or left, when it is the feature's only one), since an empty outer loop is an invalid command, and the feature is then in `dropped` as well. The feature is in `ids.pending`; the next tool that leaves the sketch valid follows it by the face rule, from the document alone (nothing is kept between the calls, so a save and a load in between change nothing).

### Walls and what reads a curve

- **A wall** (`profile.wall`) that names a changed curve gets every piece that stays in its place (`updateFeature` with `{ profile: { curves } }`), in `patched`. A split wall curve stays one chain. When the curve lost a piece the wall is shorter (or no longer one chain, which the recompute says): it is in `shortened` as well. A wall that would be left with no curve keeps its list and is in `broken`.
- **The faces a feature names** are found by walking the feature for face names (every object with `feature` and `role`): planes of sketches and plane features (`base`, `midplaneWith`, the axes of a tilt), projected edges, extents up to a face, edges of chamfers and fillets, and the like. The lists below read them.
- **`moved`**: as D52, sketches and plane features with a plane on a face `side` or `wallSide` of a line whose start `a` was re-pointed.
- **`shortened`**: features that read a face of a changed curve directly and are not in `moved`: walls as above, sketches that project an edge one of whose faces is `side` or `wallSide` of a changed curve, chamfers and fillets (D63) of such an edge. A circle that became an arc counts: its rims are arcs now.
- **`broken`**: features and sections that name what the batch removes or renames: a removed curve or a face of it, an axis on it (`sketchLine` of `AxisRef`, in a feature or in a joint of the mechanism), a wall that would lose every curve, and the straight end of a wall (`wallEnd` with a point) whose chain no longer ends at that point (a re-pointed free end of a wall's chain renames that face, D52).
- None of the lists is a statement about the state after the batch; the problems of the result say what is in error, as for the fillet.

### What the tools refuse

`ok: false` with a reason, nothing drawn:

- the curve is not an own curve of the sketch, or `with` is not a curve of it (or is the curve itself);
- **split** of a named curve with no cut (with `with`: no contact with it; with `at`: no cut at all); `with` or `at` without `curve`; `at` on a circle. **Split without a curve** with nothing to cut gives an empty batch when the profile is valid, and is refused with the reason when it is invalid for something a cut cannot repair (a duplicate, a curve of no length, two curves on one circle, a tessellation problem). **Trim** never refuses for a missing cut: a piece with no cut is the whole curve;
- **extend**: the end is not an end of the curve's kind (`a`, `b` of a line; `start`, `end` of an arc; a circle has none), another curve ends there too, the end lies on another profile curve away from its ends (a T), the extension meets nothing (or not `with`), an arc would reach X as it was first, the new end is out of range;
- a circle that a generated profile names as an operand, named by the tool;
- a trim that takes the common end of a tangency off its curve;
- a dimension that has to move and whose expression does not evaluate;
- a spline (after 6d), named as such;
- the batch is one the engine refuses (its message).

## The tools, step by step

Positions are the solved ones. "Cut X at points" is the sequence of "The pieces and the keeper", "What happens to the constraints" and "Ends that are cut off".

**trim `{ curve: X, at, with? }`**

1. The cuts of X that select (by `with`), sorted along X; the point of X nearest to `at`; the piece around it: between the selecting cut before and the one after (an end where there is none; for a circle the angular neighbours).
2. When X is a profile curve: every contact of profile curves in the sketch is cut, as by `split` without a curve (in the same batch, before the rest), except the contacts inside the piece; X is cut once in step 3.
3. No cut bounds it: "Removing a whole piece". Otherwise X is cut at its two bounds and at its repairing contacts outside the piece (not at a contact with a construction or projected `with` curve outside the piece, which is not a repairing one), with the piece left out, and the keeper is chosen among the pieces that stay: a middle piece leaves the pieces beyond it; an end piece re-points that end; a circle keeps its ID on the first piece that stays (in the notch, the arc inside the outline).
4. A construction X: cut at the two bounds only, held on the curves there (`pointOnCurve`).
5. The patches of regions and walls; the lists.

**extend `{ curve: X, end, with? }`**

1. The end, mapped after step 2 to the piece of X that holds it; the first contact of the extension that selects (by `with`); the point there, used or new.
2. When X is a profile curve: every contact of profile curves cut first, as for trim, and every profile curve the extended stretch crosses before it stops cut there with the stretch.
3. `setCurvePoint` of the end; the old end by the rules of a cut-off end; a span line if the piece carries `equalLength` or `midpoint`.
4. The curve met is cut there when both are profile curves and it is not a circle with one point; else the new end is held on it (`pointOnCurve`).
5. The patches; the lists.

**split `{ curve?, with?, at? }`**

1. With `curve`: its cuts (by `with`; with `at`, the one nearest). Without: every contact of two profile curves of the sketch, each pair once, and the ends at one place joined; a point is made once and shared by every curve through it.
2. Each curve with cuts is cut at its points (nothing removed); a circle with one point only, and a circle a generator names, are left and listed in `uncut`.
3. The patches; the lists.

**`ids`** (contract.ts, `CUT_IDS`; the same fourteen lists for the three tools, each always present, each without repeats, in the order the contract states): `changed`, `added`, `span`, `points`, `constraints`, `reattached`, `removed`, `uncut`, `patched`, `dropped`, `pending`, `moved`, `shortened`, `broken`. A feature may be in `patched` and in one of `dropped`, `pending` or `shortened`; the descriptions say which overlaps there are.

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
| `packages/engine/src/sketch.ts` | the contacts of two shapes as points to cut at, with a wrapper by the IDs of a sketch; `compatible` unchanged |
| `packages/engine/src/recompute/outline.ts` | `inside` (a point in a loop of exact curves) exported for the face rule |
| `packages/engine/src/sketch-cut.ts` (new, beside `sketch-tools.ts` in the order of imports of [repository.md](../../architecture/repository.md)) | the cut: cuts, pieces, keeper, constraints, ends, siblings, the face rule and the patches, the lists. `PROFILE_SOURCES` and the face helpers of the fillet move here, so that the fillet and the cuts read one table |
| `packages/engine/src/sketch-tools.ts` | the input kinds `curve` and `place`; the entries `trim`, `extend`, `split`; `trimPiece`, `extendReach`, `extendEnd`, `profileContacts` for the app |
| `packages/engine/src/index.ts` | the new exports |
| `packages/engine/test/modules.test.ts`, `docs/architecture/repository.md` | the new module in the order |
| `packages/mcp/src/api.ts` | the text of the two input kinds; the examples; a sentence of the section "Sketch tools" |
| `packages/mcp/test/tools.test.ts` | the examples run after a setup (a rectangle and a line across it), as the fillet's runs after the rectangle |
| `packages/app/src/sketch-tools/trim.ts`, `extend.ts`, `split.ts`, and three lines of `SKETCH_TOOL_UI` in `sketch-tools/index.ts` (6a, part 4) | the three tools of the sketch bar |
| `packages/app/src/sketch-view.ts` (or the scene's drawing of the sketch) | the marks of the contacts while the profile is invalid |
| `packages/scenarios/test/` | the part of scenario 15 (calls.ts) and the measured cases as regressions |
| `docs/architecture/sketch.md` ("Sketch tools", "Profily a oblasti"), `naming.md` (regions after a cut), `docs/ui/sketch.md`, `verification.md`, `backlog.md` | the tools, the face rule, the UI rows, the tests; the backlog row of trim and extend closed with what is deferred |

## The app and MCP

**MCP.** `trim`, `extend` and `split` are reached by `sketch_tool`; their descriptions are generated from the catalog. The answer carries `ids` and the problems of the model after the batch; `preview: true` shows it without writing. `describe_api` gets the two input kinds and one sentence: *a profile with crossing curves is repaired by `split` without a curve (every crossing becomes a common point, constraints kept, the features' regions followed) and then `trim` of the pieces that should go, `at` a point of each*. An AI that computes its own end points does not need the tools; one that drew a circle across an outline, or reads an imported sketch, does.

**The app.** 6e adds three entries to 6a's table of the app's sketch tools, `SKETCH_TOOL_UI` (`packages/app/src/sketch-tools/`; `SketchToolName` gains `trim`, `extend`, `split`, after `fillet` in the order of the bar): a file each and a line each. Each is a `SketchPlaceTool<undefined>` (6a's contract, section 4) with `picks: 'curve'`, so a click near a crossing still gives the curve and not the point there, and without `clicks`, so `click` runs at every click and keeps no place. Each calls the engine with `context.tool` (the app's `SketchToolCall`, which holds the document) and runs the batch with `host.run` as the tool made it, not through `drawn`: the switch *Konstrukčně* does not apply (as the fillet). 6a's `calls.ts`, section g, writes the first row; the rows of 6e:

| Entry | `eligible` | `click` | `draw` (dashed, while the pointer moves) |
|---|---|---|---|
| `trim` | an own curve (`context.feature.curves`) | `trim { curve: snap.id, at: place.at }`; a click with no curve under it says "Click the piece of a curve to remove." | the piece `trimPiece` returns, as a polyline; nothing where the tool would refuse |
| `extend` | an own line or arc | `extendEnd(context.tool, snap.id, place.at)` picks the end nearest the pointer, then `extend { curve, end }` | the extension from that end to `extendReach` |
| `split` | an own curve | `split { curve: snap.id }` | nothing |

- **`trimPiece` and `extendReach` read X's selecting contacts only**, not the repair of the whole sketch, so they are cheap enough for every move of the pointer.
- **The button *Split crossings*** (`split` without a curve) is the panel of the entry `split` (`options.panel`, 6a's place for what a tool shows while it is active, with `initial: undefined`); the hint of *Trim* and *Split* says so while the profile is invalid.
- **The contacts** of the profile curves are marked in the view while the profile is invalid (`profileContacts`), whatever the tool, so a person sees where the curves cross; an invalid profile with nothing marked has its reason in the status line (what `split` would refuse with). This is the view's, not the table's.
- After each tool the status line says what was patched and names the features of `dropped`, `pending`, `moved`, `shortened` and `broken`; a refusal is said with its reason (`host.say(text, true)`).

## Issue codes

None is added. The tools answer with a reason as text, like the others.

## Shared places and what 6e needs from 6a

- **Takes:** `SKETCH_TOOLS`, `sketchTool`, `SketchToolCall`, `PROFILE_SOURCES` and the patches of D52, `setCurvePoint`, `detectProfile`, `pointJoins`, `applyCommand`, `namedBySections`.
- **Adds:** three entries and two input kinds of the sketch tools; the contacts of `sketch.ts`; the module `sketch-cut.ts`.
- **From 6a:** (1) the table of the app's sketch tools (part 4, `SKETCH_TOOL_UI`), for the three tools: three entries ("The app and MCP"); (2) the profile read from a list of shapes (part 2): the tool computes the regions after, the faces and the region as it was with the same function the sketch step uses, and the contacts are read over the same shapes; (3) exhaustive switches on the kind of a curve (part 3), so that a spline does not compile in 6e's code until each place refuses it; (4) from the vocabulary: which non-own geometry forms regions, and which can carry a point held on it (`pointOnCurve`). 6e's rule: **non-own geometry is never cut; it is a cut of an own curve exactly when a point can be held on it.** If 6a settles otherwise, 6e follows.

## Later kinds

- **Splines (6d).** Not cut, and not a cut: in the cheap variant of 6d no constraint holds a point on a spline, so a point at a crossing could not stay there. Each switch on the kind of a curve in `sketch-cut.ts` refuses a spline by name ("a spline is not trimmed, split or extended; …"), and a contact with a spline is not a cut, so a profile crossing a spline stays invalid (`pending` for the features over it). With the full variant of 6d (a point on a spline) a crossing becomes a cut held by `pointOnCurve`; cutting a spline itself needs knot insertion, which changes its control points, and is deferred beyond that.
- **Projections from another sketch (6b).** A cut of an own curve (held by `pointOnCurve`, like a projected edge) when `with` names it or the own curve is construction; never cut. One that forms regions cannot get a common vertex with an own curve ("Open", 1).
- **Copies of 6c.** Not a cut (a point cannot be held on a copy in its own sketch) and never cut. A copy is computed from its source, so a cut of the source is the way: the copies follow.
- **An imported outline (6f).** Reference geometry that forms regions: as a projection with the flag.

## Rejected alternatives

1. **Regions from crossing curves made automatically** (Onshape, Fusion). Rejected by the plan with the owner's agreement: a region is named by the IDs of its outer curves, so a line through a circle would give two D shapes with one name. With `split` the two have different names (measured).
2. **A command that splits or trims a curve in the engine.** The sketch tools exist so that the engine has small commands and shapes are batches of them; everything here is a batch of existing commands. The one awkward step, moving a constraint to another curve, is a remove and an add under its ID in one batch; a command `setConstraintOperand` would say it more directly and is not needed.
3. **Repeating the constraints of the whole line on each piece** (the plan's sentence). Pieces of a slanted line need a collinearity anyway, and a repeated `horizontal` beside it is redundant. One `pointOnCurve` per new point keeps the freedom exact (measured: 0 throughout).
4. **Refusing a line with `equalLength` or `midpoint`**, as the fillet does. Every polygon of the polygon tool has `equalLength` on every side, so no polygon could be notched. The span line keeps their meaning (measured: the hexagon stays regular).
5. **Keeping every cut-off end** (as the corner of D52). An end nothing names is two free degrees of freedom: a determined sketch would stop being so after every trim.
6. **Removing every cut-off end, or every end named only by `coincident` or `pointOnCurve`** (the first version did the latter). A corner of another curve, a dimension of the whole length, and an end joined to a fixed point would go with it (review 1).
7. **Trim cutting only at the points around its piece**, and not cutting the other curve (what Fusion shows). The profile would stay invalid until every crossing is cut, the order of the trims would decide whether the regions can be followed (review 1: a line across a corner), and an AI would have to know that.
8. **Following regions by names alone** (as D52). A region cut into several by a split cannot be told apart by names: which pieces of the outline go with which new region is geometry.
9. **Following regions along the pieces of their own curves, by the side they lay on** (the side rule, the first version). It misses a face inside the region that touches none of its curves (the centre cell of a grid; review 1), so a body would get a hole without a word.
10. **Following regions by overlap of areas** (polygon clipping of the old region with each new one). Needs a polygon boolean in the engine and tolerances on areas; the faces of the cut sketch make every test a point in a polygon.
11. **Following regions only when the profile before is valid.** The notch, the case of the scenario, starts invalid.
12. **Construction and projected curves cutting a profile curve by default** (the first version). The construction circle of every polygon would cut its sides at a notch (review 1); a projected outline under an own one would cut it everywhere. `with` names them when they are meant.
13. **The keeper as the longest piece.** A plane on the side face of a line moves when its start moves; the piece with the start keeps it.
14. **A circle cut at one point as two arcs at that point and the opposite one.** The second point would be arbitrary and named by nothing.
15. **Removing a whole piece by `removeEntity`** (what an AI could send). The other pieces lose their line, and every corner its place on it (measured).
16. **`trim` by the other curve alone** ("the part beyond C"): which side is "beyond" needs a place; `with` selects the bounding cuts and `at` says the side.
17. **A query of the crossings** for an AI. `split` without a curve repairs them in one call; a list of crossings can come later if an AI needs to choose.

## Known limits

- **Non-own geometry is not cut**: a projected edge, a curve of another sketch, a copy of 6c, an imported outline. An own curve crossing one that forms regions leaves the profile invalid ("Open", 1).
- **Splines** are neither cut nor a cut until 6d's full variant.
- **A circle touched at one point** stays whole; two curves on one circle are not cut. Both leave the profile invalid, as today.
- **Collinear overlaps** are cut at the ends of each, which can leave two curves between the same two points; the profile stays invalid until one is trimmed. The converter removed duplicates itself; `split` does not remove what was drawn.
- **A trim or an extend of a profile curve cuts every crossing of the sketch** first. In a sketch with many crossings that is many new curves in one batch; they had to be cut for a valid profile anyway.
- **A region follows into what it is merged with**: trimming a piece between two regions gives both features the merged region (measured with the two rectangles, and the notch in the other order). It is the rule ("Open", 3), and it changes bodies; `patched` says which.
- **Holes of a region as it was** are rebuilt from the curves that do not cross its outline, have no free end, and do not cross anything kept. Curves without a free end among the curves that are not R's (closed curves, or closed chains) that cross each other inside a region, apart from its outline (two circles), are both left out and their faces count as the region's: the holes are filled. An open chain that crosses a hole (a line inside, or one between two vertices of R) no longer does that (measured).
- **A T placed by dimensions** becomes a vertex of the profile when the curve it lies on is cut there: one redundant equation in a determined sketch.
- **A trim bounded at, or an extend that stops on, a circle touched once** gives it one point; the circle is not cut and the profile stays invalid there until a second point is added (another extend, or a trim).
- **A region whose outline lost a piece while the sketch stayed invalid** (rewritten by names, `pending`) has a gap and cannot be rebuilt later; it is dropped then, and is picked again by `updateFeature`. With every crossing cut first this needs a crossing the tools cannot cut.
- **The test of a face is one point** stepped in from a curve of its outline, tested on the exact curves; a face thinner than the step is tried with smaller steps, and a face too thin for the smallest is not counted (a body of such a face is refused by the profile's own checks).
- **A split line whose pieces stay in one region** gives two side faces in one plane, with an edge between them; a chamfer or a fillet of that side needs both edges. Not measured ("To verify").
- **A constraint that moves** is added again at the end of the sketch's constraints, so the order the diagnosis reads (`removable` keeps the older constraints) changes for it.
- **A cut point stays a crossing only while the curves cross**: a later change that pulls them apart is a `sketchConflict` (measured: a circle that no longer reaches the edge, a line that misses an arc), and the body keeps its last shape.
- **A tangency at a trimmed-away common end** is refused, not cured.
- **The lists are made from names** (`moved`, `shortened`, `broken`), as for the fillet; the result of the batch says what is in error.

## To verify before the implementation

- **The contact search**: on every measured case it finds exactly the points the prototype was given; every pair `compatible` rejects either has a contact point or is a case without one (tests over random pairs of lines and arcs, overlaps and tangencies included).
- **The face rule over the contact search**, on the measured cases and on a circle crossing two sides at four points (near a corner), trimmed piece by piece; a face bounded by an arc with a coarse chord tolerance (the exact test); a duplicate side trimmed while a feature names it; a corner joined by the batch.
- **`with` against the repair**: a trim with `with` past another crossing, an extend with `with` past another curve; the sketch valid after each.
- **The seam** of a split line whose pieces stay in one region: the edge between two coplanar side faces, its kind, and whether a chamfer of the side takes both edges.
- **A circle turned into an arc** with a rim that a sketch projects (`kind: 'circle'`) or a chamfer of D63 rounds: whether both still work on the arc's rim. Under D67 (4c) the ends change too: a chamfer of the rim of a circle trimmed into an arc by a line runs out past the line's side for a D-shaped boss, and is refused as a stop for a D-shaped hole; the top edge of the line trimmed by a circle runs out into the notch's cylinder; with both the arc and the line in the feature, D63's refusal of an arc meeting another edge at an angle still applies.
- **The arc of a trimmed circle under large changes** (the centre pulled far across the edge): whether the arc that stays is still the one inside.
- **Performance** of `split` without a curve on the largest sketch of the Onshape conversion: pairs are tested all against all (as the profile does) and `pointJoins` is built once per call, not per pair; the regions need the profile after, the faces and one restricted profile per region that is gone (so 2 + n profiles per call).
- **6a**: the three entries type-check against the implemented `SketchToolUi` (this branch starts before 6a's merge, so contract.ts does not import 6a's contract; the entries are written in "The app and MCP" as rows); the profiles are computed by the function the sketch step uses over 6a's list of shapes (`profileOf`).
- **Faces not valid while the sketch after is**: whether it can happen once a put-back piece and what it touches are both cut in memory.
- **Joins of determined points** (ends at one place): redundant whether re-pointed or joined by `coincident`; which constraint the diagnosis names, and whether later changes conflict.
- **The MCP examples** run after a setup in `tools.test.ts`; the snapshots of the app change by the three buttons and nothing else.

## Tests the implementation owes

- **Engine, the cut**: every row of the constraint table, for a line, an arc and a circle; the keeper and the direction of the pieces; the `equalRadius` of arcs that share no end; the point at a cut used or made (an end of the other curve, one joined by `coincident`, a point held on it, a projected point); cuts within the tolerance of an end or of each other; overlaps (partial, exact, a span line over a piece); the other curve cut or held; construction and projected curves cut only by `with`; ends cut off kept or removed (a corner, a corner joined by `coincident`, a dimension, a hole point, a joint's axis, nothing, `origin`); ends at one place joined; a whole piece with and without a sibling, a concentric arc of another radius and a reversed line that are no siblings; the span line; a circle with one, two and three cuts, and points pooled from the cuts made first and an extend; an extend whose end is mapped to a piece; an extend past a curve with `with`; a trim with `with` past another crossing; an extend from a T refused; the old far end not held twice under a `midpoint` whose point is on X, and held under one whose point is elsewhere (the hexagon, freedom 0); a line ending inside a circle, its inner part trimmed; a moved dimension with an expression that meets a plain repeat; an extend of a piece that is not the keeper; an arc extended that would reach a piece of itself; a sibling's duplicate hold and an `equalRadius` with the sibling dropped (the middle of an arc trimmed, then one arc trimmed); the tool's own hold not counting as a name; the order of the batch with a `midpoint` at the keeper's new end; the refusals, each with its reason.
- **Engine, the regions**: the notch (both orders); a circle split by a line; the grid; the plate with a hole crossed from the outline, from inside only, and from corner to corner; a trim with `with` past another crossing (the faces with the piece and what it touches cut in memory); a face bounded by an arc at a coarse chord tolerance; a referenced duplicate side trimmed; a corner joined by the batch; two overlapping rectangles split and their inner pieces trimmed; a line across a corner; a region opened (`dropped` with and without other regions); a sketch left invalid (`pending`, then followed); a region of a revolve; a wall split, trimmed and emptied.
- **Engine, the lists**: `moved` for a trim of the first piece of a line; `shortened` for a wall, a projected edge and a chamfer; `broken` for an axis on a removed line, a joint's axis, and a `wallEnd` renamed by an extend.
- **Scenarios**: scenario 15, step 6 (calls.ts), and the measured cases as regressions (freedom, redundancy, volumes after changes).
- **MCP**: the descriptions and examples of the three tools and of the two input kinds; `ids` in the answer.
- **App**: each of the three entries by clicks (a click near a crossing gives the curve), what `draw` returns under the pointer, the button in the panel of `split`, the marks, a refusal; the snapshots change by the three buttons of the bar and nothing else.

The review of the implementation is a full one: new geometry (the contacts) and a heuristic (the face rule) (CLAUDE.md, "Depth of the review").

## For the plan

- **The converter** (`tools/onshape/sketch.ts`) can replace `splitAtCrossings` by one `split` without a curve after it has added the curves and the constraints, which keeps the constraints of the split curves (the loss the plan names). It is a small change outside the engine with its own test, proposed for the implementation of 6e if the owner wants it there.
- **Scenario 15, step 3** changes with "Open", 1.
- **The backlog**: the row of trim and extend closed; the deferred items above as rows (cutting non-own geometry, the tangency at a trimmed common end, extend past the end of the other curve, a break at a place, a query of crossings).

## Open

For the owner:

1. **Scenario 15, step 6, and a projected outline.** The plan's step 3 extrudes the base from the board outline projected from `frame` and marked to form regions (6b, question 4). 6e does not cut projected curves, so a notch across that outline cannot be trimmed. Proposed: in step 3 the base sketch draws its outline as own lines held on the projection (which then does not form regions), and the notch is trimmed into those; taking a projected curve over as own curves (a tool of its own) is deferred. *Recommendation: the own outline; it changes one sentence of step 3.*
2. **The span line.** `equalLength` and `midpoint` of a cut line move to a construction line the tool adds over the old ends. The fillet (D52) refuses such lines instead. *Recommendation: the span line, since every polygon carries `equalLength`; say so if refusing is preferred.*
3. **A region follows into what it is merged with.** When a trim opens the outline between two regions, a feature that had either gets the merged region (its body grows). The other choice is to drop the region (the body loses it). *Recommendation: follow; a person trimming the wall between two regions means to join them.*

## Reviews

The design was written on Opus 5.5 (Fable limited until 2026-11-23). Three reviewers were asked, each to check the design against the code of `master` without changing a file: a fresh subagent (Opus), `codex` (gpt-6-astra, high) and `agy` (gemini-4-argon-high). **`agy` could not run**: its service answered with HTTP 429, the quota of the account used up, to be reset in about 88 hours. The round went on with the other two.

### Round 1 (the design of commit `e321083`)

`codex` had 13 findings (1 blocker, 9 major, 2 minor, 1 note), the subagent 19 (8 major, 9 minor, 2 notes). Many are the same finding from both. Each was checked against the code, and the region rule, the arcs and the corner were measured before they were acted on (`d-faces.spike.ts`, `e-review1.spike.ts`).

| # | Finding | Reviewer | Severity | Accepted? | What changed |
|---|---|---|---|---|---|
| 1 | The side rule misses a region inside the old one that touches none of its curves: the centre cell of a grid; its proof is wrong | codex 1, subagent 2 | blocker, major | yes; the face rule measured: all 9 cells (7200); the side rule's 8 follows from its definition and was not run | "Regions" rewritten: the face rule over the faces of the cut sketch and the region as it was rebuilt without the crossing curves (its holes kept: measured with a plate whose hole a line crosses); alternative 9 |
| 2 | The middles of `compatible`'s candidates are not places to cut: an overlap is cut at a middle, a duplicate is cut on every split, a span line and a projection under an outline cut the curve | codex 2, subagent 1 | major | yes | "Where the tools cut": contacts as points (crossings, an end on a curve, the ends of an overlap strictly inside the other); the cases without a point named; `compatible` unchanged |
| 3 | The middle of an arc trimmed leaves two arcs that share no end: their radii are independent | codex 3 | major | yes; measured: freedom 1 and the far arc does not follow a radius change; with `equalRadius` freedom 0 | "The pieces and the keeper": `equalRadius` between groups of pieces that share no end |
| 4 | The removal of a whole piece leaves out `pointOnCurve` (row 3), against the measurement | codex 4, subagent 5 | major | yes | Rows 1 to 5 move; identities dropped |
| 5 | A sibling by centre alone takes a concentric arc of another radius; a reversed line turns an `angle` by π | codex 5, subagent 6 | major | yes | A sibling is held on the same carrier by constraints and runs the same way |
| 6 | Removing an end named only by `coincident` or `pointOnCurve` can remove what holds the line (an end joined to a fixed point); corners joined by `coincident` are not found by ID; `origin` cannot be removed | codex 6, subagent 7 | major | yes | An end stays when anything names it; classes by `pointJoins`; `origin` never removed; alternative 6 |
| 7 | Two ends at one place that are not joined make the profile invalid and have no point to cut at | codex 7 | major | yes | "Ends at one place": joined by `coincident` |
| 8 | A trim that takes away the common end of a tangency brings back the double root | codex 8, subagent 9 | major, minor | yes | Refused with the tangency named; deferred to the adapter (D52's alternative 17) |
| 9 | The `pending` rewrite can give an empty outer loop, an invalid command; behaviour after save and load | codex 9 | major | yes | A region left with no curve is dropped or left; nothing is kept between calls |
| 10 | A re-pointed free end of a wall renames its `wallEnd` face, which no list catches; faces must be found in every field (`midplaneWith`, tilt axes) | codex 10 | major | yes | `broken` takes `wallEnd` faces; the faces are found by walking the feature |
| 11 | Trim cuts at construction curves: the construction circle of every polygon cuts its sides at a notch (the hexagon measurement hid it) | subagent 3 | major | yes | A profile curve is cut only by profile curves unless `with` names another; alternative 12 |
| 12 | A circle cut at one point in trim and extend is not defined; the partner of a touching circle gets a free point; `split` with `at` on a circle | subagent 4 | major | yes | A contact where a circle has one point is cut on neither curve (`uncut`); `at` on a circle refused |
| 13 | The most common trim (a line across a corner, one side trimmed) leaves the sketch invalid and the region is later dropped | subagent 8 | major | yes; measured with the new rule: 4700, freedom 0, width 65 gives 4975 | A trim or an extend of a profile curve first cuts every contact of profile curves; alternative 7 |
| 14 | The hover functions take no document, but a refusal needs it; `nearestCurvePoint` takes a point ID and includes a centre | codex 11, subagent 17 | minor | yes | `trimPiece` and `extendReach` take the context with the document; `extendEnd` by coordinates |
| 15 | `points` has duplicates as written; uniqueness, order and overlaps of the lists | codex 12, subagent 10 | minor | yes | Each list without repeats; overlaps stated in the contract |
| 16 | A projected point at a cut joined by `coincident` over-determines | subagent 11 | minor | yes | Held on the projected curve by `pointOnCurve` |
| 17 | "Named by" and `broken` read only features; joints of the mechanism name points and lines | subagent 12 | minor | yes | `namedBySections` read |
| 18 | A dimension whose expression does not evaluate fails the batch obscurely | subagent 13 | minor | yes | Refused early, naming the constraint |
| 19 | The order of the commands in a batch is not stated (`midpoint` at the keeper's new end, `equalRadius` of two re-added circles) | subagent 14 | minor | yes | The order stated |
| 20 | A region that touches itself is traced wrongly by one chain and one signed area | subagent 15 | minor | yes | The region as it was is rebuilt with `detectProfile`, not traced |
| 21 | An invalid profile with nothing to cut gives an empty batch and no reason | subagent 16 | minor | yes | `split` without a curve refuses with the reason; the app says it |
| 22 | Inputs: `with` or `at` without `curve`; contacts along the existing extent in an extend; a generator's circle in a split of the whole sketch | subagent 17 | minor | yes | Refusals and `uncut` |
| 23 | The tangent rule reads "a satisfied coincident" where the adapter reads any one `coincident`; both operands cut | subagent 9 | minor | yes | The adapter's rule exactly; both cut |
| 24 | The scenario as accepted extrudes a projected outline | codex 13 | note | yes, already "Open", 1 | None |
| 25 | `compatible` is also used over `OutlineCurve`s; `pointJoins` per pair is costly | subagent 18 | note | yes | Contacts over shapes with a wrapper; `pointJoins` once per call ("To verify") |
| 26 | The range of the angle that picks a circle's first piece is not stated | subagent 19 | note | yes | [0, 2π) from the x axis |

The round had more than six findings with at least three serious, so a second round followed.

### Round 2 (the fixes of round 1, commit `abade1f`)

The reviewers read mainly the diff of the fix. `agy` was still out of quota (HTTP 429). `codex` had 6 findings (5 major, 1 minor), the subagent 14 (5 major, 6 minor, 3 notes). Two are the same finding from both. Each was checked against the code; the hole crossed by an inner line was measured (`f-review2.spike.ts`).

| # | Finding | Reviewer | Severity | Accepted? | What changed |
|---|---|---|---|---|---|
| 1 | `with` limits X's cuts, so X and an extension past another curve keep crossings: the sketch stays invalid and the faces cannot be built | codex 3, subagent 1 | major | yes | Selecting contacts and repairing contacts told apart: `with` selects only; the repair cuts every other profile contact, the extended stretch included; contacts inside the removed piece are not cut |
| 2 | The point-in-region test on polylines misclassifies a face next to an arc (independent chord division) | codex 5, subagent 2 | major | yes | Every test on the exact curves (`Loop.exact`) |
| 3 | Putting a removed duplicate back makes the faces invalid | codex 1 | major | yes | A removed piece that lies on a curve that stays is not put back; faces still invalid fall back to `pending` |
| 4 | The joins the batch adds are not in the region as it was, so a corner joined by the batch leaves it unbuildable | codex 2 | major | yes | The region as it was takes the batch's joins |
| 5 | An extend after the cuts made first re-points the keeper, not the piece that holds the end | codex 4 | major | yes | The end is mapped to its piece |
| 6 | The hold `pointOnCurve` over-determines when the point is on the line already (a `midpoint` moved to the span; a T placed by dimensions) | subagent 3 | major | yes, in part | Not added under a `midpoint`; a T by dimensions stated as one redundant equation (known limit, to verify) |
| 7 | An extend that stops on a circle gives it one point: neither cut nor held | subagent 4 | major | yes | Points pooled per circle over the batch; the new end held on a circle not cut; known limit |
| 8 | The region as it was loses a hole that only an inner line crosses: the hole is filled | subagent 8 | major | yes; measured: 4800 (filled) in one stage, 4398.52 in three | Three stages: curves with a free end leave before pairs that cross; the known limit reworded |
| 9 | A hold the sibling has already is added again; the engine refuses the batch (the notch's second trim) | subagent 5 | minor | yes | Repeats, self-pairs and identities are never added |
| 10 | `equalRadius(X, sibling)` becomes a constraint of the sibling with itself | subagent 6 | minor | yes | A constraint between X and the sibling goes |
| 11 | The tool's own hold counts as naming an end, so stray points stay | subagent 7 | minor | yes | A `pointOnCurve` of the point on X's own line or circle does not count |
| 12 | A centre of another curve does not count as naming an end in the detailed rule | codex 6 | minor | yes | Any role of another curve |
| 13 | An extend from a T leaves a new T | subagent 9 | minor | yes | Refused |
| 14 | The trim of a construction curve is described two ways | subagent 10 | minor | yes | Two points around the piece |
| 15 | The contract and the design differ on `dropped` and `pending` | subagent 11 | minor | yes | Aligned |
| 16 | Ends at one place joined by `coincident` are redundant when both are determined | subagent 12 | note | yes | Re-point when one point is named by nothing else; `coincident` otherwise, to verify |
| 17 | A span line can be chosen as a sibling of a profile line | subagent 13 | note | yes | The same construction flag preferred |
| 18 | The count of profiles per call is low | subagent 14 | note | yes | 2 + n |

The round again had more than six findings with at least three serious, so a third and last round followed, on the diff of this fix alone.

### Round 3 (the fixes of round 2, commit `e23cb9c`), the last

The reviewers read only the diff of the second fix. `agy` was not tried again: its quota was reported out for about three more days at round 2. `codex` had 4 findings (2 major, 2 minor), the subagent 12 (3 major, 7 minor, 2 notes); two are the same finding from both. Each was checked against the code; the diagonal was measured (`g-review3.spike.ts`). What is not measured stays in "To verify"; no finding is left open.

| # | Finding | Reviewer | Severity | Accepted? | What changed |
|---|---|---|---|---|---|
| 1 | The far end's hold is skipped for every `midpoint` moved to the span, but the span is only collinear with its own middle: with the middle off X (the hexagon's circle centre) the far end leaves the keeper's line, freedom +1 | codex 1, subagent 1 | major | yes (the midpoint's two equations, `analysis.ts`) | Skipped only when the midpoint's point is a point of X's pieces or held on X |
| 2 | A chain from corner to corner of R through a hole has no free end counted among all curves, survives to stage 3 and takes the hole with it | codex 2, subagent 12 | major | yes; measured: 4800 counted among all, 4398.52 among the curves that are not R's | Free ends counted among the curves that are not R's; the known limit says closed curves |
| 3 | The faces put a removed piece back cut at its contacts, but the batch no longer cuts the other curve inside the piece: a T, the faces invalid, exactly for the `with` trims of round 2 | subagent 2 | major | yes | In memory, the curves a put-back piece touches are cut there too |
| 4 | A trim bound at a circle touched once is undefined (a line that ends inside a circle, its inner part trimmed) | subagent 3 | major | yes | X is cut there, the point held on the circle, the circle in `uncut` |
| 5 | The fallback of faces that are not valid gives `pending` while the sketch after is valid; the contract does not say so, and "followed by the next tool" means nothing then | codex 3, subagent 4 | minor | yes | Left as is and listed in `dropped`, as a region that cannot be rebuilt; the contract's `dropped` says it; to verify that it can happen at all |
| 6 | The summary of `split` still promises only `coincident` for ends at one place | codex 4 | minor | yes | The contract states both: re-point or `coincident` |
| 7 | A re-point does not avoid the redundancy of joining two determined points | subagent 5 | minor | yes | Stated: redundant either way; the re-point kept for one point in the document; to verify |
| 8 | An arc extended after the repair cut it reaches its own keeper, not "its own other end" | subagent 6 | minor | yes | Refused when it would reach X as it was |
| 9 | The new end of an extended piece that is not the keeper is held only on the curve met | subagent 7 | minor | yes | Held on the keeper's line too |
| 10 | Stale text: `with` described as limiting cuts (the cheap variant, "Which curves cut X", the contract); the T refusal not in the list; trim step 3 ambiguous | subagent 8 | minor | yes | "Cut, defined once" (selecting and repairing contacts); the places aligned; step 3 names its cuts |
| 11 | "A moved one goes to `removed`" against "nothing is dropped"; `removed` in the contract silent on repeats; a repeat by `duplicateOf` can drop a dimension's expression | subagent 9 | minor | yes (`duplicateOf` compares kind and operands only) | Aligned; a moved constraint with an expression wins over a plain repeat; "repeat" is `duplicateOf` |
| 12 | `split { curve, at }` leaves crossings too, not only `with` | subagent 10 | minor | yes | Both named |
| 13 | `inside` of `recompute/outline.ts` is private and `detectProfile`'s ray test a closure | subagent 11 | note | yes | `inside` exported, in "Where the code lives" |

The coordinator's note during this round: 6a's design, merged at `5673570`, settles the table of the app's sketch tools; the app side was rewritten against it in the same commit (three entries of `SKETCH_TOOL_UI`, "The app and MCP"). No further round: three is the limit.

## Rows for the indexes

**`docs/d36/README.md`, the row of 6e** (column "Design now"):

> full ([6e-trim-extend-split/design.md](6e-trim-extend-split/design.md), D65): the sketch tools `trim`, `extend` and `split` over existing commands (`setCurvePoint`, `addCurve`, `removeEntity`, constraints moved under their IDs); a trim or an extend of a profile curve first cuts every crossing of profile curves, the other curve cut at every cut; the constraints kept (a tangency at a common end moved to the piece that has it, `equalLength` and `midpoint` to a construction span line, `equalRadius` between arcs that share no end, cut-off ends that something names held on the line); the regions of the features followed by the faces of the cut sketch that lie inside the region as it was; two input kinds (`curve`, `place`); no command, no issue code, no schema step. Open for the owner: the notch of scenario 15 needs an own outline (projected curves are not cut), the span line, a region following into a merge

and in "Numbers": D65 taken by 6e (already there).

**`docs/decisions.md`, the row of the table:**

> | D65 | [6e Trim, extend and split](d36/6e-trim-extend-split/design.md) | designed 2026-11-17 | Crossing curves are repaired by three sketch tools, not by regions made automatically: trim, extend and split cut curves at the points where they cross, cut the other curve there too, keep the constraints with the piece they describe, and follow the regions of the features to the regions that hold a face of the cut sketch lying inside the region as it was |

**`docs/requirements.md`, scenario 15, the part of step 6:**

> - *A cable notch (6e, D65).* The base outline is drawn as own lines (held on the projected board outline) and extruded. A circle of the diameter `cableD` drawn across its bottom edge makes the profile invalid and the base an error. `trim` of the piece of the circle outside the outline turns the circle into an arc under its ID and cuts the edge at the two crossings; the sketch is valid and as determined as before, and the base is patched in the same batch to the two regions that cover its outline (its body unchanged). `trim` of the piece of the edge inside the circle removes it; the half disc is dropped from the base, which keeps the notched outline with the side face of the arc. `cableD` and the place of the notch follow by their parameters (volumes by hand within the chord tolerance); a notch moved off the edge is a conflict of the sketch. Two overlapping pads are split at their crossings by one `split`, each extrusion keeps its body, and their inner pieces trimmed leave one outline that both follow; a line is extended to the edge with its length dimension kept. Refused: a curve the sketch does not have, a split of a curve nothing touches, an extension that meets nothing, an end that two curves share, an end a line does not have.

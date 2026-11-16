# 5f Repair of the kernel adapter: an intersection of many slivers comes out closed (D51)

**State: design, fourth version, after three rounds of review (see "Reviews"), written on 2026-11-16 against `master` at `4d7c279` (5a and 5e merged), with the cause established by experiment against the real library (`manifold-3d` 3.5.5) and the repair measured as a candidate in a copy of the repository. Not implemented.** There is no `contract.ts` and no `calls.ts`: no public type or signature of the engine changes (the port `SolidKernel` and its guarantees stay word for word, `interference.ts` is not touched), and the package adds no query, command or document field. What changes is inside `packages/kernel-manifold`: one more cleaning in `clean.ts`, one branch in `boolean` of `index.ts`, and, for its tests, one field of the adapter's own `BooleanOptions` and a counter on `ManifoldKernel`. `npx tsc -p docs/d36/tsconfig.json` passes with the directory as it is. Its tests join the tests of the adapter and the part of 5e of validation scenario 13; no scenario of its own.

It is a change of the mesh cleaning of the kernel adapter, so the implementation gets a full review (CLAUDE.md, "Depth of the review").

## The brief, and what the experiments changed in it

The owner's decision of 2026-11-16 ([5e](../5e-kernel-second/design.md), "The owner's decisions"): the repair of the kernel adapter (`clean`, `restoreShifted`) is the next package right after 5e, so that an intersection of many slivers (a pin in its hole turned against it, faces flush only to the precision of single-precision coordinates) comes out closed and is not refused.

Three things the experiments settled that the backlog could only guess:

- **`restoreShifted` takes no part.** For an intersection `prepareTool` moves no face (`coplanar.ts`: "Průnik se neupravuje"), so `boolean` goes from the library's result straight to `clean` and to the two checks. Every refusal of an intersection is made by `clean` and found by the checks. `restoreShifted` and `prepareTool` are not changed by this package.
- **Nearly all of the refusals have one cause.** On the poses of 5a and 5e every "not a closed surface" and seven of the eight "a folded triangle" come from the two steps of the loop of `clean` undoing each other ("The cause"); the second cleaning answers all but three of the first (161 of 164) and six of the eight folded. A fold can also come from the weld, which both cleanings share; that one is not repaired ("Known limits").
- **The repair can be an addition, not a change.** A second cleaning, tried only where the cleaning of today ends in a refusal of an intersection, answers nearly all of them; everything the adapter answers today it answers with the same arrays.

## The cheap variant

**`clean.ts` gets a second cleaning**, `cleanBySubdivision(s, eps)`, beside `clean`. It welds as `clean` does and removes the same null triangles, but as one operation that keeps the mesh closed at every step, and it makes every such operation once at most, so it cannot end open and cannot go round in a cycle ("The repair").

**`boolean` tries it for an intersection whose first cleaning failed the checks.** The raw mesh is cleaned again by the second cleaning and checked by the same two checks (`isClosed`, `isFolded` by both tolerances). A mesh that passes is the answer; otherwise the adapter throws the message of the first refusal, as today.

**Nothing else changes.** A union and a difference never reach the second cleaning. An intersection the first cleaning verifies is returned as today, bit for bit. The port, the engine, the second opinion of 5e, the document: untouched.

**Deferred**:

- The refusals of a union and a difference (one case in 30,000 of the fuzz in the design range and two outside it, the cases "below the resolution" of `review.test.ts`, the union of the seed 2535 of the sliver fuzz). The second cleaning is not allowed to try; it would answer the last of these and none of the others ("Why an intersection only").
- The sheets of an intersection: where faces of the two solids coincide, the verified mesh still holds a closed double layer without volume (guarantee 3 of the port is not kept for an intersection, as before).
- The time of the measure of a pair askew to the axes (seconds, in `depthOf` and `penetration` of the engine). The repair does not touch it ("The cost").

## What the backlog, 5a and 5e say, checked against the code

[backlog.md](../../backlog.md), "To verify first": the adapter refuses the intersection of a pin with its hole of the same diameter when the two polygons are turned against each other: one turned pose in thirty with the axis along a coordinate axis, four in five askew, a quarter of the poses of faces that are flush only to the precision of the coordinates. The refusal is the adapter's own check after its cleaning; the library returns a result every time.

[5a](../5a-mechanism/design.md), "A pair the kernel refuses": the adapter without its two refusals calls 72 of 151 refused poses a collision that is none, so the refusals are honest: a refused mesh measures wrong. [5e](../5e-kernel-second/design.md): the collisions ask the kernel's intersection as computed about a refused pair and may clear the pair by it; of 136 refused poses 99 are cleared and 37 stay failed (30 real collisions, 7 that share nothing); its tests pin poses as refused and say which expectation flips when the adapter answers them.

What the code says:

- **`boolean`** (`packages/kernel-manifold/src/index.ts`): `tolerances(a, b)`, `prepareTool`, `rawBoolean`, then `restoreShifted` when faces were moved and `clean(raw, t.weld)` otherwise, then `isClosed` (throws "není uzavřená plocha") and `isFolded(out, t) || isFolded(out, tolerances(out))` (throws "přeložený trojúhelník"). For an intersection `prepareTool` returns no shifts, so the path is `rawBoolean`, `clean`, the two checks.
- **`clean`** (`clean.ts`): (1) vertices nearer than `eps` are welded and triangles that lost a vertex dropped; then a loop of (2) dropping null triangles and membranes and (3) splitting a triangle with an edge left without its opposite at a vertex that lies on that edge; the loop remembers the states it has split and stops after splitting a repeated one; (4) `splitNonManifold` parts the surface where the weld joined it along an edge.
- **A null triangle** (`flat` in `clean`): narrower than `eps / 4`; or narrower than `eps` with its middle vertex more than `8 · eps` from both ends of its longest side. A thin triangle whose two near vertices are less than `8 · eps` apart along the side is a needle and is kept.
- **The tolerances** (`geometry.ts`): all from the size D of the two solids (their diagonal, at least twice their largest coordinate); the weld is 10⁻⁶ D. For the arm of scenario 13 D is about 460 mm and the weld 4.6 · 10⁻⁴ mm. The second `isFolded` reads the tolerances of the result alone, and the result of an intersection is smaller than its operands: 2.6 · 10⁻⁴ for the same pair.
- **The engine asks for an intersection in one place**, `sharedBy` of `interference.ts` (the collisions, and the gap through them); nothing is ever built from one ([ports.md](../../architecture/ports.md), guarantee 3).

## The cause

Established on the poses 5a and 5e pinned, with an instrumented copy of `clean.ts` (the same code, counting what each step does and how the loop ends). The recipe is under "Measured".

### What the library returns

The pose `(upper, forearm turned)` of the arm with pins of radius 4, the elbow at −47.883° (k = 57), the first pose of the backlog: 888 triangles in 47 pieces.

- **44 slivers**: where a corner of the polygon of the pin stands out of the flat of the polygon of the hole. Each is a prism of 8 triangles on 6 vertices, 8 mm long, up to 0.01 mm thick (the chord tolerance), about 6 · 10⁻⁴ mm³. Two more small pieces have 16 and 4 triangles.
- **One sheet**: 516 triangles on 258 vertices in the plane z = 8, where the underside of the forearm lies on the top of `upper`: 258 triangles with the number of one face and 258 with the number of the other, back to back, with no volume (4 · 10⁻¹³ mm³). The two layers are triangulated differently, so they are not membranes triangle for triangle and no step of the cleaning removes them.

Every raw mesh looked at (874 poses, below) was closed by its indices and had no folded triangle by either tolerance. What is wrong with a refused mesh is made by the cleaning.

### Where the cleaning of today ends

874 poses of the sets of 5a and 5e, each cleaned by the instrumented copy, which agreed with the adapter on every pose (refused or answered).

| Set | Poses | Answered | Not closed: the loop stopped on a repeated state | Not closed: an open edge with no vertex to split at | Not closed: 1000 passes | Folded |
|---|---|---|---|---|---|---|
| Pin 4, axis along Z, the parent first | 150 | 143 | 4 | | | 3 |
| The same, the child first | 150 | 148 | | 2 | | |
| Pins 1.5, 2.5 and 12, axis along Z | 150 | 146 | 3 | | | 1 |
| Pin 4, askew, the parent first | 80 | 9 | 71 | | | |
| The same, the child first | 40 | 5 | 35 | | | |
| A pin 0.03 larger than its hole, along Z | 40 | 40 | | | | |
| The same, askew | 40 | 28 | 11 | | | 1 |
| Flush faces askew, turned | 80 | 56 | 18 | 5 | | 1 |
| Flush faces askew, slid | 80 | 80 | | | | |
| A plate sunk by 0.0006, askew, turned and slid | 64 | 47 | 13 | 1 | 1 | 2 |
| All | 874 | 702 | 155 | 8 | 1 | 8 |

172 refusals: 164 "not a closed surface", 8 "a folded triangle". All eight folded meshes are folded only by the tolerance of the result, never by the tolerance of the pair.

### The cycle

Step 2 of `clean` drops a null triangle and so opens its three edges; step 3 closes them again by splitting the triangle across the long side at the middle vertex of the dropped one. The two are separate steps, the mesh is open between them, and nothing says that what step 3 makes is not null again.

It is null again in a **thin quadrilateral with two of its corners close together**: a few weld tolerances apart, further than the eight the rule of a needle allows, and the other two corners far. Both ways of cutting such a quadrilateral into two triangles hold a triangle the rule calls null. Dropping it and splitting its neighbour gives the other cut, whose null triangle is dropped in the next pass, which gives the first cut back.

The log of the pose above (weld 4.6 · 10⁻⁴; all four vertices in the sheet at z = 8):

| Vertex | x, y |
|---|---|
| 293 | 116.01044, 0.75620 |
| 292 | 116.01044, 0.76129 (5.1 · 10⁻³ from 293: eleven weld tolerances) |
| 359 | 115.51855, 9.25609 (8.5 mm away) |
| 287 | 116.00974, 0.27903 (0.48 mm away) |

- Pass 6: drops the triangle (293, 292, 359); splits (287, 293, 359) at 292.
- Pass 7: drops the piece (293, 292, 287); splits (292, 359, 287) at 293.
- Pass 8 is pass 6 again, pass 9 is pass 7. Three such places go round at once in this pose, and the loop stops at pass 11 by its memory of states.

Such a quadrilateral is no defect of the mesh: it is a thin piece of a face, with an area, that the library cut with two of its vertices close together. Each of the two lies within the tolerance of the line from the other to a far corner; the four do not lie on one line within the tolerance (the other triangle of each cut is not null), so no cut is free of a thin triangle.

**The sheet is where it happens.** In the poses whose log was read (k = 57 and 67 of the pin along Z) every quadrilateral that went round lay in the sheet between the flush faces, along the outline of the hole, where corners of the two polygons and the crossings of their sides lie a few tolerances apart. In the sliver fuzz below, 1,398 of 7,007 cases with a plate lying flush on the other solid are refused today, and 18 of 2,992 without one.

**How the cycle ends decides the message:**

- **"Not a closed surface"** (155 of 172): the check for open edges runs right after the drop, so every state of the cycle is seen open; the loop stops on a repeated state, open.
- **The other "not closed" endings** (9) are the same two steps failing to meet: an edge opened by a drop finds no vertex among the ends of the open edges (8), or the states never repeat exactly and the loop runs all its thousand passes (1, about a second).
- **"A folded triangle"** (8): in seven of them the loop stops on a repeated state that happens to be closed, and in it one piece of a split lies turned over. In the five of those looked at, the folded triangle is no triangle of the input, it has the cosine −1 against its face, and its width is between the two weld tolerances (2.8 · 10⁻⁴ to 4.2 · 10⁻⁴, against 4.4 · 10⁻⁴ to 5.1 · 10⁻⁴ of the pair and 2.6 · 10⁻⁴ to 3.0 · 10⁻⁴ of the result): a split at a vertex up to one tolerance of the pair off the edge turned a needle over, and only the check by the tighter tolerance of the result sees it. The eighth (the plate sunk by 0.0006 two metres away, slid, k = 5) ends closed after three passes with no state repeated: the weld there (4.5 · 10⁻³) is seven times the thickness of what the two share, and its fold is not of the cycle (found by the review).

**The cycle is the usual ending in a mesh of slivers, also where the adapter answers** (measured by the second review with the instrumented copy). Of the 150 poses of the pin along Z the loop goes round in 137: in 130 the state it stops in happens to be closed and unfolded and is the answer of today, in 7 it is not. Only 13 poses end with no null triangle left. Askew, all 9 answered poses of the pin end in the cycle; of the pin 0.03 larger 25 of 28; of the flush faces 17 of 56 turned and 10 of 80 slid. A mesh that ends so holds the null triangles of its cycle: 2.4 a pose along Z, 28 askew. So in a mesh of slivers an answer of today is the cycle stopping in a lucky state, and a refusal the same cycle stopping in an unlucky one. In the unions and differences of the fuzz it is otherwise: none of 7,523 results holds a null triangle.

So the refusals are honest, as 5a found: the mesh the loop stops in is open or has a triangle inside out. And nearly all of them are not a property of the geometry: for 167 of the 172 the same raw mesh has a closed, unfolded cleaning within the same tolerance ("Measured"). Of the eight folded ones six have (the two that stay folded are poses of the plate sunk by 0.0006 two metres away).

### Why it did not show before

The fuzz of the adapter makes unions and differences of a few prisms on a coarse grid; a null triangle there is the remnant of a band of zero width, its neighbours are wide, and a split closes it for good. An intersection of two polygons of one circle, or of two large faces that coincide to the last digit, is made of the other kind of triangle throughout. The engine asked for intersections only of bodies as modelled and of copies of a pattern until 5a turned a body about a joint.

## The repair

### The second cleaning

`cleanBySubdivision(s, eps)` in `clean.ts`, beside `clean`:

1. **Weld**, as step 1 of `clean` (a copy of it, "Where the code lives"): vertices nearer than `eps` become one, triangles that lost a vertex go.
2. **Loop**:
   - Drop the membranes (`dropMembranes`, as today).
   - Find the null triangles, **by the rule of today** (`eps / 4`; `eps` with the middle vertex `8 · eps` inside the longest side). No null triangle: the loop ends.
   - For each null triangle in the order of the list, with the long side a–b and the middle vertex m: **subdivide the side a–b at m in every triangle that has it.** A triangle (a, b, x) becomes (a, m, x) and (m, b, x) with its face number; the null triangle itself is the case x = m and becomes nothing. The pieces stand where the triangle stood in the list.
     - A subdivision is named by its side and its vertex. **One that was made before is not made again**; its null triangle stays.
     - When one of the triangles on the side was already replaced in this pass, the subdivision waits for the next pass.
   - A pass that made no subdivision ends the loop: the null triangles that are left are those whose subdivision was made before. So does the thousandth pass, as in the first loop.
3. **`splitNonManifold`**, as step 4 of `clean`.

What it rests on:

- **It cannot end open.** Call a mesh balanced when every directed edge a→b is met by as many b→a. The library's result is balanced (it is closed by its indices). The weld keeps it: a triangle that lost a vertex carried one edge both ways. Dropping a membrane removes every edge together with its opposite. A subdivision replaces a→b by a→m and m→b in every triangle that has it, b→a by b→m and m→a likewise, and adds m→x and x→m as a pair. So every state of the loop is balanced, and `splitNonManifold` turns a balanced mesh into one where every edge has exactly two triangles, as it does today. The first cleaning has no such property: between its two steps the mesh is open, and it is closed again only if step 3 finds its vertex.
- **It ends.** There are finitely many subdivisions (a pair of vertices and a vertex), each is made once, and a pass without one stops the loop. No memory of states. The bound of 1,000 passes is for a mesh nobody has seen: since every state is balanced, stopping early leaves null triangles and a closed mesh, never an open one (the most passes seen is 30, in the sliver fuzz; 26 in the first review's cases, also with welds a thousand times larger). Measured: 7 passes and 105 subdivisions a call on average, the most seen 30 and 1,892 ("The sliver fuzz").
- **It moves nothing further than the first cleaning does.** A subdivision moves the edge a–b to a–m–b, and m lies within `eps` of that edge by the rule that called the triangle null. It is the drop and the split of today made as one step.
- **In the quadrilateral of the cycle it makes the two cuts and stops**: the first subdivision gives the other cut, the second gives the first one back, the third would be the first again and is not made. The quadrilateral ends as the library returned it, with its thin triangle in place: a triangle with an area, lying the way it lay. Nearly every run ends so: 1,373 of 1,416 runs of the sliver fuzz below, with 24 such triangles left on average among 2,700.
- **The same input gives the same output** (guarantee 4): the order is that of the list, the names are vertex numbers.

### Where it is called

`boolean` in `index.ts`, after the checks of today (a sketch; `verify` is the two checks of today returning the message or nothing):

```ts
const out = restore && shifts.size > 0 ? restoreShifted(raw, shifts, b, tool, a, t) : clean(raw, t.weld);
const refusal = verify(out, t);
if (!refusal) return out;
if (op === 'intersection' && second) {
  const again = cleanBySubdivision(raw, t.weld);     // the raw mesh: nothing was moved for an intersection
  if (!verify(again, t)) return again;
}
throw new Error(refusal);
```

- **The first cleaning first.** What it verifies is returned, so every intersection the adapter answers today has the answer of today, array for array, and the adapter answers whatever either cleaning verifies. The price is the time of the first cleaning where it refuses ("The time") and two ways through `boolean`. The other way, the second cleaning as the only cleaning of an intersection, was measured too and answers nearly the same (it refuses two cases in 8,583 of the sliver fuzz that the first cleaning answers); the measurements do not decide strongly between the two, and the choice is put to the owner ("Open"; the numbers are under "Rejected").
- **The same checks, by both tolerances.** A mesh from the second cleaning is held to what a mesh from the first is held to. Where it fails them the pair is refused with the first message.
- **The message is the first one.** The fuzz of the adapter and `sharedBy` read the text; nothing new to tell apart.
- **`BooleanOptions` gets `second?: boolean`** (default true), beside `prepare` and `restore`: "switching a step of the adapter off, only for the tests that show why it is needed". The tests of this package use it to show that a pinned case is refused by the first cleaning; the tests of 5e use it to keep a real refusal to give to the second opinion ("What follows for 5e"). It is on `ManifoldKernel`, not on the port.
- **`ManifoldKernel` gets a counter**, `secondCleanings` (how often the second cleaning ran), beside `wasm` and `toManifold`, its access for tests. Without it no test can tell an adapter that keeps the second cleaning away from a union from one that does not: the refused unions of the tests are refused either way (test 3).

### Why an intersection only

- **It may leave what a union must not have.** Guarantee 3 of the port promises a union and a difference without remnants of faces that should be gone, and in the unions and differences of the fuzz the first cleaning leaves no null triangle at all (none in 7,523 results). The second cleaning leaves the null triangles it may not subdivide again, and one of them can carry the number of a face that has no other triangle left. Measured, with the second cleaning put **in place of** the first for every operation: 4 of 1,000 cases of the fuzz, the pinned seed 23288 and 1 of 300 tapered cases come out with a face that the same case built along the axes does not have. For an intersection the port promises no such thing (guarantee 3 is not kept for it, and the engine reads its volume and depth, not its faces).
- **It answers few of the refused unions.** With the second cleaning allowed for every operation as a second try, the fuzz of 30,000 cases refuses the same three (one in the design range, two outside), and nothing else changes, nor in the 5,000 tapered cases; all three are "a folded triangle" thrown by a difference that moved faces of its tool and brought them back (the seeds 772, 13550 and 19940; checked), which is another cause. One refused union is of the kind it repairs: the union of a pin with its flush plate two metres away that the sliver fuzz could not build (the seed 2535: "not a closed surface", no face moved, an open edge with no vertex to split at). The second review let the second cleaning at it and got the right solid (closed, unfolded, 24,056.371 mm³ for 24,056.365, the faces of the same union built along the axes). So as a second try it failed in nothing that was run and helped once in about 7,000 unions (the one of them that is refused); what speaks against it is the remnant above, which the fuzz shows for the second cleaning used first and which no run has excluded for it used second. It stays out of this package.
- **A body is never made of it.** Every caller that builds (`applyTool`, the tool builds, the pattern) asks for a union or a difference and gets the adapter of today, bit for bit.

### The guarantees of the port

Kept as written; the text of `SolidKernel` in `types.ts` does not change.

1. *The output of `boolean` is a closed solid*: whatever is returned passed `isClosed` and both `isFolded`, from either cleaning.
2. *Every triangle has the number of the face it comes from*: a piece of a subdivision carries the number of the triangle it was cut from, as a piece of a split does today.
3. *Faces in one plane* (a union and a difference): the path of a union and a difference is not touched. For an intersection it is not kept, as before.
4. *The same input gives the same output*: above.

"When the adapter cannot guarantee the result, it throws": it still does, less often. `intersectionAsComputed` is not touched.

### What it must not break, and why it does not

| What | Why it holds | Checked |
|---|---|---|
| The 14 pinned seeds of `fuzz.test.ts`, the 1,000 default and the 30,000 cases | a union and a difference do not reach the new code | 30,000 cases with the candidate: the line of today (no failure, 1 and 2 refused); also with the second cleaning allowed for every operation |
| Faces in one plane (`coplanar.test.ts`, 57 tests), the regressions of `review.test.ts` | the same | pass unchanged |
| The tapered fuzz (300 default, 5,000) | the same | 5,000 cases: no failure, no refusal, as today |
| Stable face names and face numbers, the hashes of the meshes of `packages/scenarios/test/review.test.ts`, the snapshots of the app | bodies are built by unions and differences only | the whole suite with the candidate: 1,278 of 1,288 tests pass unchanged; the ten that fail are the eight of `second-opinion.test.ts` and the two of the part of 5e of scenario 13, each on its first expectation, that the adapter refuses |
| The volumes and depths of the collisions the adapter answers today (`bodies.test.ts`, `gap.test.ts`, scenario 9, scenario 13) | the first cleaning's answer is returned when it passes | the same run |
| `intersectionAsComputed` and the second opinion | not touched; asked when `boolean` throws, as today | the tests of 5e, with their first expectation flipped ("What follows for 5e") |

## Measured (2026-11-16)

Spikes against the real adapters and the engine of `master` at `4d7c279`. They are not kept in the repository: they run for half an hour together and become the tests below. The recipe:

- **The models and poses are those of 5e**, through its kit (`packages/scenarios/test/second-opinion-kit.ts` and `arm.ts`): the arm of scenario 13 with the radius of the pin of the elbow and of its hole varied; the forearm turned about the elbow (`turned`: the mesh moved in single precision); the angles are the two ends of ±88° (k = 0 and −1) and `lower + (upper − lower) · frac(k · 0.6180339887)`; askew is the whole model moved first by the turn of 0.7 rad about (1, 2, 3) and the shift (37.3, −12.9, 55.1); the flush model is `upper`, a plate and a washer without a pin, at the origin and two metres away, the child turned through ±88° or slid through ±40 mm, and the same with the plate sunk into `upper`.
- **Where the adapter refuses**: a copy of `clean.ts` with counters, run on `kernel.boolean('intersection', a, b, { prepare: false })` with `tolerances(a, b).weld`, then `isClosed` and the two `isFolded`; it must agree with the adapter on every pose.
- **The candidate**: a copy of the repository (`git archive` of `4d7c279`) with `cleanBySubdivision` in `clean.ts` and the branch in `boolean` as designed, and a switch between the adapter of today, the candidate, and the second cleaning in place of the first.
- **The verdicts**: every pose through `sharedBy(kernel, a, b, 0.01)` of `interference.ts` and `verdictOf` with the default threshold, once with the adapter of today (so with the second opinion of 5e for a refused pose) and once with the candidate.
- **The sliver fuzz** is under "The sliver fuzz" below.

### The verdicts of the collisions, today and with the candidate

966 poses; 183 of them are refused today.

| Set | Poses | Refused today | Today, the refused: cleared as a fit, cleared as nothing, failed | With the candidate, the refused: a fit, nothing, a collision (verified); still refused |
|---|---|---|---|---|
| Pin 4, axis along Z, the parent first | 150 | 7 | 6, 1, 0 | 6, 1, 0; 0 |
| The same, the child first (the order the engine asks in) | 150 | 2 | 2, 0, 0 | 2, 0, 0; 0 |
| Pins 1.5, 2.5 and 12, axis along Z | 150 | 4 | 4, 0, 0 | 4, 0, 0; 0 |
| Pin 4, askew, the parent first | 80 | 71 | 68, 2, 1 | 69, 2, 0; 0 |
| The same, the child first | 20 | 16 | 15, 1, 0 | 15, 1, 0; 0 |
| A pin 0.03 and 0.1 larger than its hole (a real collision), along Z | 60 | 0 | | |
| The same, askew | 60 | 23 | 0, 0, 23 | 0, 0, 22; 1 |
| Pins 0.011, 0.013 and 0.016 larger (the limit of a fit is 0.01), 10 along Z and 30 askew | 40 | 10 | 0, 0, 10 | 0, 0, 10; 0 |
| Flush faces only, askew, turned: plate and washer, at the origin and 2 m away | 80 | 24 | 0, 18, 6 | 0, 24, 0; 0 |
| The same, slid | 80 | 0 | | |
| The plate sunk into `upper` by 0.0006, askew, turned and slid | 48 | 13 | 0, 5, 8 | 0, 2, 8; 3 |
| The plate sunk by 0.005, the same | 48 | 13 | 0, 2, 11 | 0, 2, 11; 0 |
| All | 966 | 183 | 95, 29, 59 | 96, 32, 51; 4 |

- **179 of the 183 refused poses are answered**, 4 stay refused.
- **Every answer is the right one.** Of 100 refused poses of a pin in its hole, 96 are verified as a fit and 4 as nothing, none as a collision. The 24 refused flush poses are verified as nothing. Of 52 refused real collisions (the pins larger than their hole and the plate sunk by more than the precision of its coordinates) 51 are verified as collisions and one stays refused. The plate sunk by 0.0006 two metres away is thinner than the precision of the coordinates there (2.1 · 10⁻³) and is nothing by the rule of the report: of the 5 refused poses of that set that are no collision (three of that plate, two of the washer, which is not sunk) 2 are verified as nothing and 3 stay refused and are cleared as nothing by 5e, as today. The two refused poses of the washer in the other sunk set are verified as nothing as well.
- **No real collision is answered as less**, and **nothing that is none is answered as a collision.** That is the mistake 5a measured for a refused mesh taken unchecked (72 of 151), and the reason the second cleaning is held to the same checks.
- **The 7 poses that share nothing and are `failed` today are verified**: the pin askew at k = 52 as a fit (depth 1.2 · 10⁻³ where the mesh as computed has a point 0.40 deep), the six turned plates two metres away as nothing.
- **The measures agree with the mesh as computed** wherever that one was right: the volume and the depth to three or four digits (k = 23 of the pin along Z: 0.3897 mm³ and 0.00777 mm by both).
- **The poses that stay refused**: the pin 0.03 larger askew at k = 27 (32.898°; the second cleaning's mesh is closed and folded by the tolerance of the result only), which stays `failed` with its measure of 6.04 mm³ in the message; and the plate sunk by 0.0006 two metres away turned to −88° and to k = 2 and 3, where the weld (4.4 · 10⁻³) is seven times the thickness of what the two share.
- **The 783 poses answered today are answered the same**, by construction: the first cleaning's mesh is returned. (The run did not ask them twice; the whole suite, which pins such answers, passes.)

### The sliver fuzz

A fuzz of the adapter alone, on solids of its kit (`testkit.ts`), with an oracle that does not ask the kernel:

- A plate (x and y from −30 to 30, from 0 to 8) with a hole cut by a regular polygon of n sides and radius r about the origin of the frame, its first corner on the x axis, the tool from −1 to 9; a pin of n sides and radius r + δ, turned by a phase, from 0 to 16, in seven cases of ten joined to a plate from 8 to 16 (x from −20 to 40, y from −25 to 25) that lies flush on the first, as the forearm lies on `upper`. n is 24, 32, 45 or 64; r is 1.5, 2.5, 4 or 12; δ is 0 in seven cases of ten, else 0.011, 0.03 or 0.1; the phase is in radians; the frame is `randomFrame` of `fuzz.ts` (one in five along the axes), in 15 cases of a hundred moved 450 or 2,000 mm from the origin along x. All sides of a polygon carry one face number, as the sides of a circle of the engine do. The flush plate is the body and the pin the tool of the union that joins them.
- **The oracle**: the common part is (pin polygon minus hole polygon) × 8, and the area of the difference of two convex polygons is computed by clipping one by the edges of the other.
- A case passes when the adapter refuses it, or answers with a mesh that is closed, has no folded triangle (`describe` of the kit, by the tolerance of the result) and has the volume of the oracle within a room: `0.003 + 0.003 · V + weld · 2πr · 8` mm³. The last term is what the weld may close or open: a layer one weld tolerance thick over the side of the pin inside the plate (2πr · 8 mm²), with the weld of the two solids (`tolerances(a, b).weld`: about 10⁻⁴ mm at the origin, 10⁻³ at 450 mm and 4 · 10⁻³ at 2,000 mm). For the pin of radius 1.5 the room is about 0.01 mm³ at the origin and 0.3 two metres away; for the radius 12, about 0.07 and 2.4. **What the volume tests depends on the case.** For a pin larger than its hole the room is never half of the exact volume, and at the origin and 450 mm away never a tenth of it: there the volume is a test. For a pin of the same circle as its hole the slivers are as thin as the weld reaches, and the room is at least the exact volume in 406 of 555 cases two metres away, in 168 of 479 at 450 mm and in 234 of 5,962 at the origin (the third review counted): in those an answer of nothing, or of twice the volume, passes, and the answer rests on the two checks alone.

The counts below belong to this generator, seed by seed; the spike files are not kept, so it is here in full (`rng` and `randomFrame` of `fuzz.ts`, `prism` and `rect` of `testkit.ts`):

```ts
const ngon = (r: number, n: number, phase: number): Loop =>
  Array.from({ length: n }, (_, i) => [r * Math.cos(phase + (2 * Math.PI * i) / n), r * Math.sin(phase + (2 * Math.PI * i) / n)]);

function generate(seed: number) {
  const r = rng(seed * 7919 + 13);
  let frame = randomFrame(r);
  const far = r() < 0.15 ? (r() < 0.5 ? 450 : 2000) : 0;
  frame = { ...frame, o: [frame.o[0] + far, frame.o[1], frame.o[2]] };
  const n = [24, 32, 45, 64][Math.floor(r() * 4)];
  const radius = [1.5, 2.5, 4, 12][Math.floor(r() * 4)];
  const over = r() < 0.7 ? 0 : [0.011, 0.03, 0.1][Math.floor(r() * 3)];
  const phase = r() * 2 * Math.PI;
  const top = r() < 0.7;
  return { frame, n, radius, over, phase, top };
}

function build({ frame, n, radius, over, phase, top }: ReturnType<typeof generate>) {
  const plate = prism(frame, rect(-30, -30, 30, 30), 0, 8, { start: 1, end: 2, sides: [3, 4, 5, 6] });
  const hole = ngon(radius, n, 0);
  const a = kernel.boolean('difference', plate, prism(frame, hole, -1, 9, { start: 7, end: 8, sides: Array(n).fill(9) }));
  const pin = ngon(radius + over, n, phase);
  let b = prism(frame, pin, 0, 16, { start: 21, end: 22, sides: Array(n).fill(23) });
  if (top) b = kernel.boolean('union', prism(frame, rect(-20, -25, 40, 25), 8, 16, { start: 31, end: 32, sides: [33, 34, 35, 36] }), b);
  return { a, b, volume: (area(pin) - area(clipped(pin, hole))) * 8 }; // `clipped`: the pin cut by every edge of the hole
}
```

10,000 cases, the seeds 1 to 10000; in one (the seed 2535) the inputs could not be built (the union that makes the second solid was refused).

| Cases | How many | Refused today | Answered by the second cleaning | Still refused |
|---|---|---|---|---|
| Askew, the same circle | 5,562 | 1,024 | 995 | 29 |
| Askew, the pin larger | 2,419 | 389 | 371 | 18 |
| Along the axes, the same circle | 1,434 | 3 | 1 | 2 |
| Along the axes, the pin larger | 584 | 0 | | |
| All | 9,999 | 1,416 | 1,367 | 49 |

- **The refusals fall from 14 % of the cases to 0.5 %.** At the origin 16 of 8,531 cases stay refused (867 today); 450 or 2,000 mm away 33 of 1,468 (549 today).
- **Every answered case is closed and unfolded and has its volume within the room above**, by either cleaning: none of the 9,950 answers is outside it, and the largest error is 0.30 of its room. The room is the third one tried. Its form is argued (it grows with the weld and with the side of the pin) where the first two were fitted, and it was then run on seeds it was not written on: the third review ran the seeds 10001 to 12500 in both orders, with no answer outside it and the largest error 0.23 of the room. It has no term for the noise of the sheet between flush faces askew, which does not grow with the radius and which 5a measured at up to 0.24 mm³ two metres away (0.8 of the room of the smallest pin there); the worst seen here with the flush plate round that pin is 0.08 mm³, a quarter of its room. By the first criterion of the spike (2 % of the volume and 0.02 mm³) 27 answers of the first 6,000 seeds were flagged, 8 of the first cleaning and 19 of the second, every one of them 450 or 2,000 mm away, with errors of a few hundredths of a mm³ (the seed 413: 0.036 measured for 0.0011 exact). The second (`0.003 + 0.003 · V + 40 · weld`) held on those 6,000 seeds and failed on the next 4,000, which the second review ran: three answers of the first cleaning two metres away were outside it (the seeds 8493, 9586 and 9941, with errors up to 0.35 mm³ round a pin of radius 12). A room for this fuzz has to grow with the side of the pin as well as with the weld. The volume against the exact one:

  | Where | Cleaning | Answered | Mean error, mm³ | Worst |
  |---|---|---|---|---|
  | At the origin | first | 7,664 | 1.7 · 10⁻⁴ | 3.6 · 10⁻³ |
  | At the origin | second | 851 | 4.0 · 10⁻⁴ | 3.0 · 10⁻³ |
  | 450 mm away | first | 485 | 1.4 · 10⁻³ | 2.9 · 10⁻² |
  | 450 mm away | second | 199 | 3.6 · 10⁻³ | 2.0 · 10⁻² |
  | 2,000 mm away | first | 434 | 7.8 · 10⁻³ | 3.5 · 10⁻¹ |
  | 2,000 mm away | second | 317 | 1.3 · 10⁻² | 8.3 · 10⁻² |

  At the origin the second cleaning is as near the exact volume as the first (its mean is that of the cases it gets, the ones with the flush plate: the first cleaning's mean on those is 2.4 · 10⁻⁴). Far from the origin both carry the noise of single precision, which 5a measured for flush faces askew (up to 0.24 mm³ two metres away); the weld there is 10⁻³ and 4 · 10⁻³ mm, as much as the slivers are thick. The worst here, 0.35 mm³, are two answers of the first cleaning two metres away round the pin of radius 12 (the seeds 8493 and 9941); the second cleaning alone gives the same two.
- **What stays refused**: in each of the 49 the mesh of the second cleaning is closed and has a folded triangle (in 26 of the 28 among the first 6,000 seeds by the tolerance of the pair as well). 33 of the 49 are 450 or 2,000 mm away; of the 16 at the origin 12 have polygons of 64 sides, whose slivers are 0.002 to 0.003 thick, three 45 sides and one 32 sides at the radius 1.5. All 49 have the flush plate. Which step folds was looked at by the review on a generator of its own: of 37 meshes the second cleaning does not get past the checks, 14 are folded after the weld alone, the step both cleanings share, and 23 by the loop.
- **The second cleaning in numbers** (1,416 runs): 7 passes and 105 subdivisions on average (the most 30 and 1,892); 1,373 runs end with null triangles left, 24 on average (the most 515) among 2,700 triangles.
- **The second cleaning alone on the same seeds** (no first try): it answers 9,948 cases and refuses 51, the 49 above and two that the first cleaning answers (the seeds 3860 and 6736: at the origin, askew, with the flush plate, the pin 0.1 and 0.03 larger; its mesh is closed and folded, and the first cleaning's answers to the two are within 3 · 10⁻⁴ mm³ of the exact volume). Every answer of it is within the room, with the errors of the table above. Over the run `boolean` took 204 s in place of 494 s with the first cleaning first: the first cleaning spends its time where it gives up, about a second a case on the 49 that both refuse.
- **A conical pin in its conical seat** (the same fuzz with frustums of 24, 32 and 45 sides, half angles from 14° to 45°, no flush plate; 600 cases): 3 refused today, all answered by the second cleaning; the volumes within 1.4 · 10⁻³ of the exact ones by either cleaning.
- **The same 172 refused poses of the table of "The cause"**, given to the second cleaning directly: 167 pass both checks, 5 are closed and folded (the pin 0.03 larger askew at k = 27 and four poses of the plate sunk by 0.0006 two metres away).

### The time

The cleanings on the refused poses, the mean and in brackets the most:

| Set | Refused | Triangles of the raw mesh | The library | The first cleaning | The second cleaning |
|---|---|---|---|---|---|
| Pin 4 along Z | 7 | 860 | 16 ms | 13 ms (16) | 11 ms (18) |
| Pin 4 askew | 71 | 5,000 | 53 | 67 (154) | 45 (94) |
| A pin 0.03 larger, askew | 12 | 5,300 | 54 | 80 (133) | 48 (95) |
| Flush faces askew | 24 | 3,100 | 34 | 52 (186) | 29 (77) |
| A plate sunk by 0.0006, askew | 17 | 880 | 29 | 103 (1,100) | 8 (16) |

- The two checks take about a millisecond. The second cleaning is faster than the first, which goes round its cycle before it gives up (the 1,100 ms are the pose in which it runs all its thousand passes).
- **The first cleaning can take seconds before it gives up.** The review found, on a generator of its own (2,500 cases, 309 refused today), 9 refusals that spend 1.1 to 4.2 s in the first cleaning: 3.95 s for a raw mesh of 4,100 triangles and 3.09 s for one of 6,124, where the second cleaning takes 70 and 100 ms. That time is spent today as well, before the refusal.
- **A pose through `sharedBy` costs what it cost**: 0.1 to 0.2 s along Z and 1.3 to 3.4 s askew, nearly all of it the measure of the engine. The 80 askew poses of the pin took 134 s with the adapter of today (71 of them refused and measured as computed) and 131 s with the candidate (the same 71 verified and measured).

## What follows for 5e

**Nothing in the engine changes.** `sharedBy` asks `boolean('intersection')` and, when it throws, `intersectionAsComputed`; `interferenceReport`, `verdictOf`, `cleared`, the bound `SECOND_OPINION_TRIANGLES` and the gap stay as they are. The second opinion is asked less often.

**The poses 5e pins as refused**, with the candidate (`packages/scenarios/test/second-opinion.test.ts`, the numbers of its tests):

| Test of 5e | The pose | Today | With the candidate |
|---|---|---|---|
| 1 | `(upper, forearm turned)`, k = 57 | refused; cleared as a fit, 0.0282 mm³, 0.00057 deep | in `fits`: 0.0282 mm³, 0.00057 deep |
| 1 | the same, k = 23 | refused; cleared as a fit, 0.390, 0.0078 | in `fits`: 0.390, 0.0078 |
| 1 | the same, k = 24 | refused; cleared as a fit, 0.427, 0.0085 | in `fits`: 0.427, 0.0085 |
| 6 | the plate at the origin, askew, −88° | refused; cleared as nothing | in no list: 0.0030 mm³, 8.6 · 10⁻⁶ deep |
| 6 | the plate at the origin, k = 2 | refused; cleared as nothing | in no list |
| 6 | the washer 2 m away, k = 2 | refused; cleared as nothing | in no list |
| 6 | the plate 2 m away, −88° | refused; **failed** (as computed 0.035 mm³, 0.13 deep) | in no list: 0.034 mm³, 1.2 · 10⁻⁴ deep |
| 6 | the plate 2 m away, 88° | refused; **failed** (0.042, 0.041 deep) | in no list: 0.041 mm³, 1.4 · 10⁻⁴ deep |
| 6 | the pin askew, k = 52 | refused; **failed** (0.061, 0.40 deep) | in `fits`: 0.060 mm³, 0.0012 deep |
| 7 | the pin 0.03 larger askew, −88° | refused; failed (6.04 mm³, 0.030 deep) | in `pairs`: 6.04 mm³, 0.030 deep |
| 7 | the same, k = 1, both orders | refused; failed (6.04, 0.039) | in `pairs`: 6.04, 0.039 |
| 7 | the pin 0.011 larger askew, k = 2 | refused; failed (2.21, 0.017) | in `pairs`: 2.21, 0.017 |
| 7 | the plate sunk by 0.0006 askew, k = 1 | refused; failed (0.642, 0.00061) | in `pairs`: 0.642, 0.00061 |

- **Every pinned pose is answered, and answered as what it is.** The three poses of the backlog are verified fits with the volume and depth the mesh as computed measured. The flush faces are verified as nothing. The five real collisions are in `pairs`.
- **The three pinned as a limit of 5e are no longer one.** The plate two metres away at ±88° and the pin askew at k = 52 stayed failed because the mesh as computed has a point that seems deep (0.13, 0.041 and 0.40 mm) in a few hundredths of a mm³ of noise. The cleaned mesh does not have it: the weld closes the noise, and the depth is 1.2 · 10⁻⁴, 1.4 · 10⁻⁴ and 1.2 · 10⁻³ mm. They are the cases 5a counted as "1 of 189" and 5e as "7 that share nothing".
- **Scenario 13**: the step the kernel refused for the pin of the elbow through the engine's own ordering (k = 5, −72.130°) is answered: the pin is in `fits` with 0.0313 mm³, as at every other turned step, and no step of the sweep has a `cleared`.

**What the second opinion is still for:**

- **A pair both cleanings fail**: 4 of the 183 refused poses of the arm and the flush model, 49 of the 1,416 refused cases of the sliver fuzz, and the pairs the weld itself folds (a keyed shaft nearly flush in its socket, "Known limits"). Such a pair is judged by its mesh as computed as today: cleared, or failed with the measure in its message.
- **Whatever else makes `boolean` throw for an intersection** and leaves the library able to answer: the second opinion does not know why the adapter refused, and does not need to.
- **It stays the one place that says "not verified".** The repair moves pairs out of `cleared` and `failed` into the verified lists; it does not make the verified lists less strict. A pair in `cleared` is rarer, and means what it meant.

**The texts that speak of refusals** change with the implementation:

- The conventions of `describe_api` (`packages/mcp/src/api.ts`): "where the kernel refuses to verify such a pin (about one pose in thirty), the pair is in `cleared`" becomes: the kernel verifies nearly every such pose; a pair it cannot verify is in `cleared` or `failed` as before. "Askew to them a pair costs seconds and a few poses in a hundred still fail" becomes: askew to them a pair costs seconds.
- The known limits of [5a](../5a-mechanism/design.md) (a joint askew to the axes) and of [5e](../5e-kernel-second/design.md) (a refused pair that really collides is in `failed`; a few that share nothing stay failed), each with a line that D51 answers these poses.
- [backlog.md](../../backlog.md), "To verify first": the entry goes; what stays of it is under "Known limits" here.
- [api.md](../../architecture/api.md), "Interference": the rates of refusal ("about one pose in thirty … four in five askew") and "a few refused pairs that share nothing stay failed"; [ai.md](../../architecture/ai.md), which retells the sentence of the conventions.
- [ports.md](../../architecture/ports.md), "The intersection as computed": the list of what is "not guaranteed, as `boolean` guarantees it" names triangles without an area and sheets. An intersection from `boolean` holds sheets today, and both cleanings leave thin triangles in a mesh of slivers, the second in the meshes the first refuses 24 on average. The paragraph says so after this package.
- Comments: `scenario13.test.ts` ("one pose in thirty is"), the head of `clean.ts`, the head of `second-opinion.test.ts`.

**The bound of 5e does not reach a verified pair.** `SECOND_OPINION_TRIANGLES` is read only where `boolean` threw. A pair refused today whose mesh as computed has more than 12,000 triangles costs no measure and is failed at once; when the second cleaning verifies such a pair it is measured as every verified pair is, without a bound: the seconds an answered pair of that size costs today. For a fit askew, where the search for sheets runs, 5e measured 5.0 s at 11,768 triangles and 7.5 s at 10,018, growing with the square of the triangles ([5e](../5e-kernel-second/design.md), "As implemented"); its bound "holds a refused pair to about five to eight seconds", and a pair above the bound that the adapter now verifies is outside that promise, as every answered pair has been. Not measured here: no pose of the design is that large.

## Tests the implementation owes

**The adapter** (`packages/kernel-manifold/test`, solids of the kit, no engine):

1. **`review.test.ts`, the cases of this package**, each built by `build` of the sliver fuzz above with the flush plate, in the frame `rotated()` of the kit, given by n, r, δ and the phase in radians (found by a scan of 1,200 such cases; the review built all six again and got them; the implementation checks each against its own build and replaces one that its build answers). The same six are answered by the first cleaning in the frame `IDENTITY`, and without the flush plate:

   | n, r, δ, phase | First cleaning alone (`{ second: false }`) | The adapter |
   |---|---|---|
   | 24, 1.5, 0, 0.0618 | throws "není uzavřená plocha" | closed, unfolded, 0.1738 mm³ against 0.1734 exact |
   | 32, 1.5, 0, 0.0818 | throws "přeložený trojúhelník" | closed, unfolded, 0.1321 against 0.1318 |
   | 32, 4, 0, 0.0818 | throws "není uzavřená plocha" | closed, unfolded, 0.9379 against 0.9375 |
   | 24, 12, 0, 0.009 | throws "není uzavřená plocha" | closed, unfolded, 2.0463 against 2.0460 |
   | 24, 4, 0.03, 0.009 (a real collision) | throws "není uzavřená plocha" | closed, unfolded, 5.986 against 5.9856 |
   | 45, 1.5, 0, 0.0707 | throws "není uzavřená plocha" | **still throws** (pinned as a limit, with the message of the first cleaning) |

   For each answered case also: the same arrays when asked twice; every face number is one of the two inputs'; the volume within 0.002 mm³ of the exact one.
2. **The first cleaning wins**: an intersection it verifies (the blocks of `as-computed.test.ts`, and a pin askew that it answers) gives the same arrays with and without `{ second: false }`, and the counter does not move.
3. **A union and a difference never reach the second cleaning**: over the refused cases of `review.test.ts` (gaps and a depth below the resolution, refused 34, 27, 31, 10 and 11 times in the review's run) and the 1,000 cases of the fuzz the counter `secondCleanings` stays where it was; over the cases of test 1 it rises by one each. The count of refusals cannot be the test: the review found it the same with the second cleaning let at a union, which answers none of them.
4. **The second cleaning alone**, as a function, on the raw meshes of the six cases of test 1 (`{ prepare: false }`): each result is closed (`isClosed`), the sixth as well (it fails the check of folded triangles, not the closed one); the same arrays when run twice; no face number that the raw mesh does not have.
5. **`sliver-fuzz.test.ts`** with its generator in `sliver-fuzz.ts`, as written out under "The sliver fuzz": a case is refused, or closed, unfolded and within the room of the volume given there (with it the 10,000 cases of the design pass, by either cleaning; a room that does not grow with the weld and the side of the pin fails far from the origin); a case whose inputs cannot be built is passed by and counted (one in 10,000), and an answer without triangles is held to the volume alone; the refused are counted and held to a bound from the measurement (49 of 9,999 here, at most three in any hundred seeds in a row and ten in any thousand; `1 + ⌈cases / 100⌉` holds from the first seed and is too tight for a hundred cases from any seed, where the seeds 6512, 6569 and 6571 make three, so the implementation sets the bound from its own run, "Open"); `SLIVER_FUZZ_COUNT` and `SLIVER_FUZZ_FIRST` as in the other fuzz files, 100 cases by default (about six seconds). A seed that fails is pinned in the file, as failing seeds of `fuzz.test.ts` are.
6. **`fuzz.test.ts`, `taper-fuzz.test.ts`, `coplanar.test.ts`**: unchanged, and run once with `FUZZ_COUNT=30000` and `TAPER_FUZZ_COUNT=5000` before the commit; the lines they print must be those of today.

**Below the engine's ordering** (`packages/scenarios/test/second-opinion*.ts`). The kit gets `firstOnly`, the adapter with `{ second: false }` behind the port (`{ ...kernel, boolean: (op, a, b) => kernel.boolean(op, a, b, { second: false }) }`), and `refused` and `judged` take the kernel to ask:

7. **Test 1** (the three poses of the backlog): with `firstOnly` every expectation of today (refused; the mesh as computed closed, under 1 mm³, a fit; `cleared` as a fit); with the adapter: not refused, the pair in `fits` and no `cleared`, the volume that of the mesh as computed to three digits. The other order stays a verified fit.
8. **Test 6** (flush faces askew): with `firstOnly` the expectations of today; with the adapter every one of the five poses, and the pin askew at k = 52, is not refused, nothing is in `pairs`, `failed` or `cleared`, the flush ones are in no list and the pin is in `fits`.
9. **Test 7** (real collisions refused askew): with `firstOnly` failed and not cleared, as today; with the adapter each is in `pairs`, with a depth above the limit of a fit.
   - **What is left for the second opinion, over the adapter itself** (a new test of that file): the pin 0.03 larger askew at k = 27 (32.898°), the parent first, is refused by both cleanings and stays `failed` with the phrase of the measure (6.04 mm³ as computed); the plate sunk by 0.0006 two metres away at −88° is refused and `cleared` as nothing. Without these two every test of "refused, then the second opinion" would run over `firstOnly` alone. Their comment says what the comment of 5e said: on the day the adapter answers one, the test keeps what it says of the pair and loses that it is refused.
10. **`second-opinion-fuzz.test.ts`**: with the adapter, along an axis and askew: nothing in `pairs`, nothing in `failed`; a pose in `cleared` is counted and held to 1 + 2 % of the poses asked (none of 480 in the run of the design: 200 poses along an axis and 40 askew, both orders, of which the first cleaning refuses 6 and 62). The file takes its kernel from `SECOND_OPINION_KERNEL`: with `first` it is the fuzz of today, over the first cleaning alone and with the bounds of today.
11. **Scenario 13, the part of 5e** (`scenario13.test.ts`): the sweep of 40 steps runs twice. Over a kernel that cleans once (`firstOnly`) the expectations of today stand: the step k = 5 is refused, the pin is in `cleared` as a fit, the gap says `fit` and names the pair. Over the adapter no step is refused, the pin is in `fits` at k = 5 and no step has a `cleared`. [requirements.md](../../requirements.md), scenario 13, gets the sentence.
12. **`bodies.test.ts`, `gap.test.ts`** (the kernel that refuses every intersection): unchanged; their refusals are made by the test.

All the checks of CLAUDE.md before each commit. Review: full.

## The cost

- **At run time**, for an intersection the first cleaning refuses: one more cleaning and its two checks, 11 ms for the pin along an axis and 30 to 50 ms askew (the most seen 95): two to six hundredths of what such a pose costs. Nothing for any other call of the kernel.
- **A sweep costs what it cost.** A refused pose paid for the measure of its mesh as computed and now pays for the measure of its verified mesh ("The time"). The seconds of a pair askew are in the measure of the engine and stay.
- **The first cleaning is still paid for** where it refuses: it is what keeps the answers of today as they are. It is 13 to 100 ms on the poses of the arm and seconds in rare cases (1.1 s in one pose of 874 here; 1.1 to 4.2 s in 9 of 309 refused cases of the review's generator; about a second a case on the 49 cases of the sliver fuzz that both cleanings refuse).
- **A refused pair above the bound of 5e** (12,000 triangles as computed) was failed without a measure and is measured once the adapter verifies it ("What follows for 5e").
- **In the tests**: the sliver fuzz, about six seconds for its 100 cases (the 10,000 cases of the design took about ten minutes); `second-opinion.test.ts` about twice its 30 s, since every pinned pose is measured over both kernels (one test per pose and kernel, so that none comes near the limit of 60 s); the part of 5e of scenario 13 about 8 s more (the sweep twice); the fuzz of 5e as today.
- **In the code**: about ninety lines in `clean.ts` with its copy of the weld, fifteen in `index.ts`, one option and one counter for the tests. The file gets a second loop, and a reader has to know why there are two: the comment of the second says what the first cannot promise.
- **In what is promised**: nothing new. More intersections are verified; the ones that are not are told as before.

## Where the code lives

```
packages/kernel-manifold/src/
  clean.ts      cleanBySubdivision, beside clean
  index.ts      boolean: the branch for an intersection; BooleanOptions.second; ManifoldKernel.secondCleanings
packages/kernel-manifold/test/
  review.test.ts, sliver-fuzz.ts, sliver-fuzz.test.ts
packages/scenarios/test/
  second-opinion-kit.ts (firstOnly), second-opinion.test.ts, second-opinion-fuzz.test.ts, scenario13.test.ts
packages/mcp/src/api.ts          one sentence of the conventions
docs/architecture/ports.md       step 6 of the adapter (the second cleaning of an intersection), the limits
docs/architecture/verification.md   a section for D51; the numbers of the fuzz
docs/backlog.md, docs/requirements.md (scenario 13), the known limits of the designs of 5a and 5e
```

**`clean` itself is not edited.** The second cleaning has its own copy of the weld and of the rule of a null triangle (thirty lines), as the candidate that was measured had. Lifting the two out for both cleanings to call is the tidier file and is allowed only behind a test written first, which pins what `boolean` returns with the code of today, as one hash of the three arrays per case: for every boolean of the first 1,000 fuzz cases (so `clean` is given what it is really given, also the mesh with its faces brought back), and for the intersections of test 2 and of the first 100 cases of the sliver fuzz with `{ second: false }`. The hashes stay in the test. Nothing in the suite of today would notice a changed array of an intersection (the hash of `packages/scenarios/test/review.test.ts` pins the unions and differences of one model; the fuzz prints counts). About ninety lines of new code in `clean.ts` with the copy, sixty without, and fifteen in `index.ts`.

## Rejected

- **The second cleaning in place of the first, for every operation.** One loop in the file instead of two. Measured: 4 of 1,000 fuzz cases, the pinned seed 23288 and 1 of 300 tapered cases keep a face that should be gone ("Why an intersection only"). It also changes every mesh whose null triangles lie next to each other, and with it the pinned hashes.
- **The second cleaning as the second try for a union and a difference too.** It answered none of the three refused cases of 30,000, changed nothing else there, and answered the one refused union of the sliver fuzz rightly ("Why an intersection only"). Not taken into this package: where it answers it can leave the remnant above and turn an honest refusal into a broken name, and one case is no measurement of how often. It is the natural next step for the refusals of a union, with a fuzz of its own.
- **The second cleaning as the only cleaning of an intersection** (no first try). Not chosen, and the one choice here that could go the other way. Measured:
  - On the 783 poses the adapter answers today it answers all 783 with the same verdict (205 nothing, 440 fits, 138 collisions). The volume and the depth are the same to the last bit in 640 and differ by at most 0.02 mm³ and 4 · 10⁻⁶ mm in the rest; the arrays are the same in 53 of 143 answered poses of the pin along Z.
  - The whole suite fails in the same ten tests and in no other: no test of today pins a number that moves.
  - On the 10,000 seeds of the sliver fuzz it answers 8,581 of the 8,583 cases the first cleaning answers and refuses two (closed and folded; the seeds 3860 and 6736), with every answer within the room of the volume; `boolean` takes 204 s over the run in place of 494 s.
  - The review, on 1,500 cases of its own generator: it answers every one of the 1,324 intersections the first cleaning answers, with the same error of the volume at the origin (2.2 · 10⁻⁴ on average for both), and the cleanings take 9.4 s in place of 33.5 s, since the first loses its seconds where it gives up.
  - The meshes are of one kind. Where the first cleaning answers, its mesh and that of the second alone hold about as many null triangles, within a factor of one and a half in everything measured (the second review: 2.17 and 2.18 a pose of the pin along Z, 28.2 and 28.7 askew, 0.86 and 0.96 for flush faces turned, 2.7 and 3.2 for the pin 0.03 larger askew; in its cases of the sliver fuzz with the flush plate 1.08 and 1.52 at the origin, 1.75 and 2.36 farther away), since the first usually stops inside its cycle ("The cause").
  - So it would make `boolean` simpler (one cleaning for each kind of operation, no second try, no counter for the tests), it would not lose seconds where the first gives up, it would end by a rule and not by the state a cycle happens to stop in, and it would answer the same on everything measured but two cases in 8,583 of the sliver fuzz, which it would refuse.
  - What speaks for the first cleaning first: **no answer of today changes**, so nothing downstream has to be looked at again, and **the adapter answers what either cleaning verifies**. Two cases of 8,583 in the sliver fuzz are verified by the first alone (with the second alone they would go to the second opinion, as a refusal of today does); none in the poses of the arm or in the review's cases. No test pins the arrays that would change. That is caution and two cases in ten thousand against a simpler and faster adapter, and it is why the choice is the owner's ("Open").
- **The loop of today mended**: remembering its splits so that the same one is not made twice. Not tried. Its two steps would still leave the mesh open between them, with nothing to say that the state it stops in is closed (10 of the 172 refusals are not cycles), and a change of that loop changes the cases it closes today.
- **Another rule for a needle** (a margin that follows the length of the side, or none at all). Not tried: every margin has its quadrilateral, and the rule decides for unions and differences too, where the fuzz found it (`verification.md`: needles dropped as null in 14 of 30,000 cases).
- **A cycle caught by a memory of states** in the second cleaning, as the first has it. Tried first: the loop then stops somewhere inside a cycle, with a turned piece in 10 of the 172 refused poses of "The cause", against 5 with the rule of once. A subdivision made once ends the cycle where it began.
- **A triangle turned against the triangle it was cut from counted as null**, and **the pieces of a null triangle counted as null**. Tried, on top of the rule of once: the first answered 1 more case of 288 refused in a run of the sliver fuzz and none more of the 172 refused poses of "The cause", the second none anywhere. Two more rules in the most delicate file for one case in three hundred.
- **The check of folded triangles by the tolerance of the pair alone** for an intersection. It would pass the eight folded meshes of today, each with a triangle inside out that a later boolean on that mesh would judge by the tighter tolerance. The second cleaning answers them without one.
- **The adapter without its refusals; the mesh as computed in place of the adapter's.** Rejected by 5a and 5e with their numbers; nothing here changes them.
- **The cleaning left to the library** (its `simplify` or its tolerance). Not tried again: `ports.md` records that it collapsed null triangles the wrong way.
- **A new library.** Not needed and not the owner's to be asked for: `manifold-3d` is asked for nothing new.

## Known limits

- **A few intersections stay refused**: 4 of 183 refused poses of the arm and the flush model, 49 of 9,999 cases of the sliver fuzz (0.19 % at the origin, 2.2 % of the cases 450 or 2,000 mm away). In each of them the second cleaning's mesh is closed and has a folded triangle. The collisions then take the second opinion of 5e: one real collision of 52 stays `failed` with its measure in the message.
- **A verified intersection of slivers holds thin triangles the rule calls null**, from either cleaning: those of the quadrilaterals of the cycle. The first cleaning leaves them where it stops inside its cycle (2.2 an answered pose of the pin along Z, 28 askew), the second where it may not subdivide again (as many on those poses; 24 on average on the meshes the first refuses, in 1,373 of 1,416 runs). They are triangles of the library's result or pieces of one, and the checks hold that none on a planar face lies turned over. For the collisions it means what it means for a mesh as computed ([5e](../5e-kernel-second/design.md), "Why it errs one way"): the flag `round` of the measure reads face numbers from every triangle, also a thin one. A fit needs more than that flag (no planar reach beyond the precision, a depth within the tolerance), and of 51 real collisions verified by the second cleaning 51 measured as collisions.
- **A union and a difference are not repaired.** Their refusals are as rare and as honest as before: `kernelFailure` on the feature.
- **An intersection is for measuring.** The verified mesh of solids with coincident faces holds sheets (guarantee 3 is not kept for an intersection), and the library reads such a mesh back with another volume: 1,748 of the 9,950 intersections answered in the sliver fuzz, by either cleaning. An intersection welded to nothing is a mesh without triangles (slivers of 10⁻⁵ to 10⁻² mm³ thinner than the weld; three of about 2,190 answers in the first review's cases, two in 10,000 of the fuzz here, from either cleaning): the right answer, "nothing", and a mesh the library does not load ("Not manifold"), so a test that reads an answer back has to pass it by. Nothing in the engine gives an intersection back to the kernel; a caller that did would have to know.
- **Far from the origin the answers are those of the weld.** Two metres away the weld tolerance is 4 · 10⁻³ mm, the volume of slivers 0.01 thick is known to a hundredth of a mm³ on average and to 0.35 mm³ at the worst seen, round a pin of radius 12 (the table of the sliver fuzz), and what is thinner than the precision of the coordinates is nothing to the collisions, as before.
- **A fold made by the weld is not repaired.** Both cleanings weld the same way, and where the weld itself turns a triangle of a planar face over, both end folded. The review found the family where that happens more often than not: polygons of 4, 6 and 8 sides, **each side a planar face with a number of its own** (a square or hexagonal key nearly flush in its socket), turned by 10⁻⁶ to 3 · 10⁻² rad. Of 915 such cases 47 are refused today, 44 of them as folded; the second cleaning answers the 3 that are not closed and none of the 44 (of 20 such meshes looked at, 12 are folded after the weld alone and 8 by the loop of either cleaning). The sides of a circle of the engine share one face number and are not planar to the check, so the pins of this design do not meet it; a keyed shaft does. Such a pair goes to the second opinion as today.
- **The first cleaning can take seconds before it gives up** (1.1 s in one pose of 874 here; up to 4.2 s in the review's cases, "The time"). Not changed: the time is spent before the second cleaning is tried.
- **Askew to the axes of the model a pair costs seconds**, as before ([5e](../5e-kernel-second/design.md), "The cost").
- **The sliver fuzz tests the volume where a sliver is thicker than the weld reaches.** Its room grows with the weld and the side of the pin, so for a pin of the same circle as its hole far from the origin (and for a few hundred of the thinnest cases at the origin) the room is as large as the exact volume, and the case is held to the two checks alone. The room has no term for the noise of the sheet between flush faces askew; none was needed in 12,500 seeds.
- **Measured on polygons of one circle, on cones of one cone and on flush planes.** Other families of slivers (two swept profiles that agree only to the chord tolerance, gear flanks in contact) were not tried; the argument for closedness does not depend on the shape, the numbers do.
- **That no answer is wrong is 179 poses, 1,367 cases with an exact volume (851 at the origin; of the 516 farther away the volume tests the larger pins, and the same circle rests on the two checks, "The sliver fuzz"), 3 cones and the 277 cases and 31 poses the review added**, not a proof. A case that turns up is pinned in `review.test.ts`, as the regressions of the adapter are.

## Open

**One choice is the owner's. It does not hold the implementation up: the design goes ahead as written unless the owner says otherwise.**

- **Which cleaning an intersection gets.**
  - *As designed*: the cleaning of today first, and the second one where the first fails the checks. No answer of today changes. A pose the first refuses pays for it before the second is tried (13 to 100 ms on the arm, seconds in rare cases), and an intersection has two ways through `boolean`.
  - *The other way*: the second cleaning alone. On nearly everything measured it answers the same: the same verdict on all 783 poses the adapter answers today, all 1,324 cases of the review's generator and 8,581 of the 8,583 cases of the sliver fuzz that the first answers (the two it refuses, as folded, are pins 0.1 and 0.03 larger than their hole, real collisions: left to the second opinion, which may only clear, they would end `failed` with their measure and not verified), the same ten tests of the suite and no other. Its meshes are of the kind the first gives. `boolean` is simpler, and no pose waits for a cycle to give up (204 s in place of 494 s over the 10,000 cases of the sliver fuzz). The triangles of the intersections answered today change, and their measures in the last digits (at most 0.02 mm³ in the poses measured).
  - The measurements do not decide strongly: the first is caution and two cases in ten thousand, the second the simpler and faster adapter ("Rejected", "The second cleaning as the only cleaning of an intersection"). Changing over is small, now or later: the branch in `boolean`; the option for the tests then switches the first cleaning on for an intersection, and `firstOnly` of the kit of 5e becomes the kernel with the cleaning of today; tests 2 and 3 and the counter go; the texts say one cleaning for each kind of operation.

Nothing else needs the owner: the package stays inside the adapter, adds no library and changes no port.

For the owner to know, since they follow from the measurements and not from the brief:

- **`restoreShifted` is not changed**, although the brief names it: it takes no part in an intersection.
- **The refusals of a union and a difference are not repaired here.** They are rare (three in 30,000 fuzz cases, one union in about 7,000 of the sliver fuzz, and a second, of the same kind, in the 2,500 further seeds the third review ran), most of them have another cause, and the second cleaning is not let near a union before a fuzz has shown that it leaves no remnant of a face there. That is a package of its own.
- **A verified intersection of slivers holds thin triangles**, today and after (and sheets where faces coincide). Guarantee 1 of the port stands as worded; the paragraph of `ports.md` that contrasts `boolean` with the mesh as computed gets a line ("What follows for 5e").

For the implementation:

- The bounds of the two fuzz files and the default number of cases of the sliver fuzz, from its own run.
- Whether the weld and the rule of a null triangle stay copied or are lifted out of `clean` behind the test of "Where the code lives".

## To verify before the implementation

Nothing stands in the way, and no part of the design waits for a measurement. What the implementation measures first, because the candidate was a copy of the repository and not the code:

1. **That `clean` answers as it did**: the lines of the fuzz of 30,000 cases and of the 5,000 tapered ones; and, if the weld is lifted out of it, the comparison of its arrays described under "Where the code lives", written before the edit.
2. **The six cases of test 1** against its own build of the adapter (a refusal depends on the last bit of a coordinate).
3. **The verdicts once**, on the 183 refused poses of "Measured" (ten minutes): 179 answered and none of them wrong is what the tests then hold in the small.

Not measured, and not needed to decide the design: the app (nothing of it changes), the joint of scenario 9 (no two of its parts share anything as modelled, [5e](../5e-kernel-second/design.md), "As implemented"), and a chord tolerance other than 0.01 for the arm (the sliver fuzz varies the number of sides instead).

## Reviews

### Round 1 (2026-11-16): first version

One reviewer, an internal subagent that had not seen the design being written (Fable 5.2, effort high), read-only, at commit `972f868`. It was given the design, the code, the spike scripts with their raw outputs and the copy of the repository with the candidate. It ran probes of its own through the real kernel (a dozen scripts; kept outside the repository like the spikes): the table of the cause again from the code, 2,500 cases of a generator of its own (polygons of different side counts on one circle, tiny phases, a keyed pin, a pin off centre, polygons with planar sides, both orders, far from the origin), pins a little smaller and larger than their hole through the engine, the time of the two cleanings, the second cleaning alone. It found no blocker: three major, seven minor and four factual findings and two nits. Every finding was checked before it was acted on.

| Finding | Severity | Holds? | What changed |
|---|---|---|---|
| "No answer is wrong" leaves out 27 answers the spike itself flagged by its volume criterion (all far from the origin), and test 5 names no room for the volume: with the spike's criterion it fails at 4,000 cases | major | Yes (the raw outputs: 3 and 18, 5 and 9 "problems") | The room follows the weld (`0.003 + 0.003 · V + 40 · weld`; the 6,000 cases run again with it: none outside); the 27 are said; test 5 has the room. Round 2 found that this room fails on other seeds; it was replaced |
| Test 3 cannot fail for what it guards: the refused unions of `review.test.ts` are refused as often with the second cleaning let at a union | major | Yes (its probe: 34, 27, 31, 10 and 11 refusals in all three modes) | A counter of the runs of the second cleaning on `ManifoldKernel`; test 3 reads it |
| "Both messages have one cause" is wider than the evidence: the eighth folded refusal ends closed without a repeated state; and polygons with planar, separately numbered sides stay refused (44 of 47), folded by the weld alone in 14 of 37 cases looked at | major | Yes (its reruns; `isFolded` reads planar faces only, and the sides of the pins of the design share one number) | The brief and "The cycle" say seven of eight; a known limit for the weld's fold and that family; the second opinion's role names it |
| The stall of the first cleaning is understated (1.1 to 4.2 s in 9 of 309 refused cases), and the second cleaning alone for an intersection is rejected on thin grounds: it answers all 1,324 cases the first answers, as exactly, in 9.4 s for 33.5 s | minor | Yes (its probes; measured again here on the 783 answered poses: the same verdict in all, and the suite fails in the same ten tests) | "The time", "The cost" and the limit say seconds; the alternative has its numbers under "Rejected" and is put to the owner as the one choice that could go the other way. The design stays with the first cleaning first |
| "Tests 2 and 6 hold" the refactor of `clean` array for array: they do not, and the candidate copied the weld instead of lifting it | minor | Yes | `clean` is not edited; lifting is allowed only behind a comparison of arrays written first |
| No bound on the second loop; and the bound of 5e does not cover a pair the second cleaning verifies | minor | Yes (`interference.ts`: the bound is read where `boolean` threw) | A bound of 1,000 passes, harmless since every state is closed; the bound of 5e said under "What follows for 5e" and "The cost" |
| Texts not listed: `api.md` (the rates, "a few stay failed"), `ai.md`, the paragraph of `ports.md` that contrasts `boolean` with the mesh as computed, three comments | minor | Yes | Listed; the sentence of `ports.md` also under "Open" |
| The explicit cases and the fuzz are not reproducible from the description: one face number for all sides, which solid is the tool of the union, radians, the generator and its seeds | minor | Yes (it rebuilt all six from the spike; with the pin first one case is answered) | The generator and the build are in the design in full; the description says the rest |
| No test of what is left for the second opinion over the adapter itself | minor | Yes | Two poses both cleanings fail are pinned through the adapter (test 9) |
| "An intersection is for measuring" is weaker than what it saw: three answers of today are meshes the library does not load | minor | Yes (its probe; all from the first cleaning). The second round found what they are: meshes without triangles | Said in the limit, and said rightly after round 2 |
| The worst volume error of the second cleaning two metres away is 8.3 · 10⁻², not 7.4 · 10⁻² | factual | Yes (the group without the flush plate) | Corrected |
| The row D51 said "one round of review" before there was one, and "every other test unchanged" beside ten that flip | factual | Yes | The row |
| "After the return of moved faces" for the three refused unions rested on the message alone | factual | It holds: each is thrown by a difference whose tool had faces moved (checked) | Said as checked |
| No raw output was kept for the table of the time and for "53 of 143" | factual | Yes | Both run again and kept with the other outputs; the table has the kept run |
| 5.9860 for 5.9861; "the full designs of 5e and 5f" in the plan | nit | Yes | Corrected |

Checked by the reviewer and found to hold: the table of the cause, rerun from the code, row for row, with no raw mesh open or folded; every cell of the table of the verdicts and of the table of 5e against the raw outputs; the counts of the sliver fuzz; the lines of the fuzz and the suite (1,278 of 1,288, the ten being the eight and the two); the cones; that the second cleaning never ended open (1,500 runs, also with welds a thousand times larger), gives the same arrays twice and no foreign face number; that all 2,191 answers of today in its cases came back with the same arrays; that 277 of its 309 refused cases are answered, each closed, unfolded and within the room; that 31 refused poses of pins 3.985 to 4.02 in a hole of 4, both orders, are verified as what they are; that `sharedBy` is the only caller of an intersection and `prepareTool` moves nothing for one; that `npx tsc -p docs/d36/tsconfig.json` passes. Not checked by it: the table of the time, the figures taken over from 5a and 5e, why the second cleaning in place of the first leaves a face in its four fuzz cases (the counts only), swept profiles and gear flanks, a chord tolerance other than 0.01 through the engine.

With sixteen findings of which three are major, a second, narrow round follows.

### Round 2 (2026-11-16): second version, the fix of round 1

One reviewer, a fresh internal subagent (Fable 5.2, effort high), read-only, at commit `59096bd`, asked to look mainly at what the fix of round 1 changed. It ran seven probes of its own through the real kernel, the candidate and the copy of the repository: how the first cleaning ends where it answers, the null triangles in the meshes of both cleanings, the room of the volume on seeds the design had not run, the unions and differences of the fuzz, the refused union of the seed 2535, the meshes the library does not load, the suite with the second cleaning alone. It found no blocker: two major and four minor or factual findings and seven nits. Every finding was checked against its outputs before it was acted on.

| Finding | Severity | Holds? | What changed |
|---|---|---|---|
| The ground given for "the first cleaning first" is false: the meshes the first cleaning verifies hold null triangles too, since it usually stops inside its cycle in a state that happens to be closed (130 of 143 answered poses of the pin along Z; 2.17 null triangles a pose against 2.18 from the second cleaning alone, 28.2 against 28.7 askew). "24 on average" was the count on the meshes the first refuses | major | Yes (its outputs, pose by pose) | "The cause" says the cycle is also the usual ending of an answered pose; "Why an intersection only", "Rejected", "Known limits" and the line for `ports.md` no longer say that the second cleaning's meshes are of another kind; the choice between the two orders is put to the owner as a choice, with what speaks for each ("Open") |
| The room of the volume written after round 1 (`0.003 + 0.003 · V + 40 · weld`) was fitted on the 6,000 seeds it was run on: on the seeds 6001 to 10000 three answers of the first cleaning, two metres away, are outside it (8493, 9586, 9941; up to 0.35 mm³) | major | Yes (its output; run again here) | The room is the reach of the weld over the side of the pin (`weld · 2πr · 8`), an argument and not a fit (round 3: its form is argued, and it was then run on other seeds); the seeds 1 to 10000 were run with it in both orders: no answer outside, the largest error 0.30 of the room. All counts of the sliver fuzz are those of the 10,000 seeds now. "Known limits" says 0.35 mm³ |
| The refused union of the seed 2535 is answered by the second cleaning as a second try, and rightly; "it answers none of the refused unions" was three cases of one other cause | minor | Yes (closed, unfolded, 24,056.371 mm³ for 24,056.365, the faces of the same union along the axes) | "Why an intersection only", "Rejected" and "The cheap variant" say so; the reason to keep it from a union is the remnant of a face, which no run has excluded for a second try |
| "Meshes the library does not load" are meshes without triangles: an intersection welded to nothing, from either cleaning | factual | Yes | "Known limits" says what they are; the sliver fuzz holds such an answer to the volume alone (test 5) |
| The fold of the weld is told as the rule of the family with planar sides; of 20 such meshes 12 are folded by the weld and 8 by the loop. And the second cleaning repairs six of the eight folded refusals of the poses, which the brief did not say | minor | Yes | The limit and the brief |
| The bound of 5e and what lies above it: a pair above the bound that the second cleaning verifies is measured, and the measure took 5.0 s at 11,768 triangles and 7.5 s at 10,018 | minor | Yes | The two figures under "What follows for 5e" |
| Seven nits: "shared" for step 1 of the two cleanings; the counts of the line of the cost; 94 for 95; the wording of the largest counts; "no public type changes" beside the two fields the adapter gets for its tests; the record of the comparison of arrays; "one branch and test 2" understated what changing over takes | nit | Yes | Corrected, the README of the plan as well |

Found here while the fix was measured, not by the review: with the 10,000 seeds run in both orders, **the second cleaning alone refuses two cases that the first cleaning answers** (the seeds 3860 and 6736). "No case was seen that only the first verifies" was true of the poses and of the review's cases and is not true of the fuzz; "Rejected" and "Open" give the two orders with that number.

Checked by the reviewer and found to hold: nine of the rows of round 1 fixed as the rows say; the 27 flagged answers (8 and 19, all far from the origin, the seed 413); the figures quoted from the first review against its outputs; the second cleaning alone on the 783 poses, and the whole suite run again with it (the same ten tests fail and no other); the three union seeds, the table of the time cell by cell and "53 of 143" against the kept outputs; that the counter makes test 3 able to fail for what it guards; the two poses of test 9; that the printed `generate` and `build` match the spike in the order of the random draws and in the solids; the six explicit cases of test 1; that tests 2, 4 and 7 to 11 can be written (`{ prepare: false }` returns the raw mesh, `firstOnly` works behind the port); that the texts listed exist as quoted; that no union or difference of the fuzz ends with a null triangle from the first cleaning (7,523 results); that nothing needs the owner under the rules of the project (no new library, `SolidKernel` untouched). Not checked by it: the table of the verdicts and the table of 5e cell by cell (the rows the fix leans on only), the figures taken over from 5a and 5e, whether the second cleaning as a second try for a union can leave a remnant (one case looked at, sound), a better room (it suggested a form and fitted none), swept profiles, gear flanks and other chord tolerances.

With thirteen findings of which two are major the round is below the mark for another (more than six, at least three serious), but the fix was large: the room and every count of the fuzz changed, and a new measurement went into "Open". So a third round follows, which reads only the diff of this fix.

### Round 3 (2026-11-16): third version, the diff of the fix of round 2

One reviewer, a fresh internal subagent (Fable 5.2, effort high), read-only, given only the diff `59096bd..6b57b21` and the raw outputs. It recomputed every number the diff brought in from the tally lines of the run, ran the sliver fuzz on 2,500 seeds the design had not run (10001 to 12500, both orders), ran the two seeds that only the first cleaning answers in all three modes, and compared the room with the exact volume case by case over the 10,000 seeds. No blocker and no major finding: two factual errors, two minor points about the room and four nits. All were checked and hold.

| Finding | Severity | What changed |
|---|---|---|
| "The second cleaning answers all but one" of the refusals that are not closed: it is all but three (161 of 164; 161 and 6 are the 167 of 172) | factual | The brief |
| "The repair" still had 107 subdivisions and at most 24 passes, of the run of 6,000 | factual | 105 and 30; the 26 of the first review said as what it is |
| "An argument where the first two were fits" said more than was shown: the room had been run only on the seeds it was written after, and it has no term for the noise of flush faces askew, which does not grow with the radius | minor | The room's form is said to be argued; the review's run on seeds 10001 to 12500 is quoted (none outside, 0.23 of the room at most); the missing term is said, with what was measured |
| What the room can show far from the origin is less than "nothing gross is wrong": for a pin of the same circle the room is at least the exact volume in 406 of 555 cases two metres away, so an empty answer passes | minor | The fuzz section says what the volume tests (the larger pins) and where the answer rests on the two checks alone; the limit "that no answer is wrong" splits its 1,367 cases the same way |
| The bound of test 5 (`1 + ⌈cases / 100⌉`) fails for a hundred cases starting between the seeds 6472 and 6512 | nit | Test 5 says so and leaves the bound to the implementation's run |
| "About as many null triangles" quoted the three closest pairs | nit | The pairs that are further apart are given: within a factor of one and a half |
| "Open" did not say that the two cases only the first cleaning answers are real collisions, which the second opinion cannot verify | nit | Said |
| "2.2 a pose along Z" is by answered pose; by pose that ends in the cycle it is 2.4 | nit | Both places |

For information from the same round: the seed 11106 is a second refused union of the kind of the seed 2535; on its 2,500 seeds no further case is answered by the first cleaning alone, 17 are refused in both orders, and `boolean` took 130 s against 50 s.

Checked by the reviewer and found to hold: every cell of the table of the cases and what derives from it; the six rows of the table of the volume, recomputed from the twelve groups; the 49 as a subset of the 51 and their split by distance and by number of sides; the stats of the second cleaning and the times; the room as written against the one in the spike, with the welds and the rooms quoted; the figures taken from the second review; that the two orders of the cleanings are told the same way in "Where it is called", "Rejected", "Open" and the row D51, with nothing presented as decided beyond "the design goes ahead as written unless the owner says otherwise"; the records of the rounds and the two other files. Not checked by it: "12 of 20 folded by the weld" (it found no raw output for it; the figure is the second review's, from the first review's output), which seed uses 0.30 of the room, the older runs, and anything the diff did not touch.

This was the last round. What stays open after it is in "Known limits": the room of the sliver fuzz tests the volume of the larger pins and not of the thinnest slivers far from the origin, and has no term for the noise of the sheet; the choice between the two orders of the cleanings is the owner's ("Open").

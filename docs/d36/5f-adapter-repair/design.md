# 5f Repair of the kernel adapter: an intersection of many slivers comes out closed (D51)

**State: design, first version, written on 2026-11-16 against `master` at `4d7c279` (5a and 5e merged), with the cause established by experiment against the real library (`manifold-3d` 3.5.5) and the repair measured as a candidate in a copy of the repository. Not implemented.** There is no `contract.ts` and no `calls.ts`: no public type or signature of the engine changes (the port `SolidKernel` and its guarantees stay word for word, `interference.ts` is not touched), and the package adds no query, command or document field. What changes is inside `packages/kernel-manifold`: one more cleaning in `clean.ts`, one branch in `boolean` of `index.ts`, and one field of the adapter's own `BooleanOptions`, which exists for its tests. `npx tsc -p docs/d36/tsconfig.json` passes with the directory as it is. Its tests join the tests of the adapter and the part of 5e of validation scenario 13; no scenario of its own.

It is a change of the mesh cleaning of the kernel adapter, so the implementation gets a full review (CLAUDE.md, "Depth of the review").

## The brief, and what the experiments changed in it

The owner's decision of 2026-11-16 ([5e](../5e-kernel-second/design.md), "The owner's decisions"): the repair of the kernel adapter (`clean`, `restoreShifted`) is the next package right after 5e, so that an intersection of many slivers (a pin in its hole turned against it, faces flush only to the precision of single-precision coordinates) comes out closed and is not refused.

Three things the experiments settled that the backlog could only guess:

- **`restoreShifted` takes no part.** For an intersection `prepareTool` moves no face (`coplanar.ts`: "Průnik se neupravuje"), so `boolean` goes from the library's result straight to `clean` and to the two checks. Every refusal of an intersection is made by `clean` and found by the checks. `restoreShifted` and `prepareTool` are not changed by this package.
- **Both messages have one cause.** "Not a closed surface" and "a folded triangle" are two ends of the same cycle in the loop of `clean` ("The cause").
- **The repair can be an addition, not a change.** A second cleaning, tried only where the cleaning of today ends in a refusal of an intersection, answers nearly all of them; everything the adapter answers today it answers with the same arrays.

## The cheap variant

**`clean.ts` gets a second cleaning**, `cleanBySubdivision(s, eps)`, beside `clean`. It welds as `clean` does and removes the same null triangles, but as one operation that keeps the mesh closed at every step, and it makes every such operation once at most, so it cannot end open and cannot go round in a cycle ("The repair").

**`boolean` tries it for an intersection whose first cleaning failed the checks.** The raw mesh is cleaned again by the second cleaning and checked by the same two checks (`isClosed`, `isFolded` by both tolerances). A mesh that passes is the answer; otherwise the adapter throws the message of the first refusal, as today.

**Nothing else changes.** A union and a difference never reach the second cleaning. An intersection the first cleaning verifies is returned as today, bit for bit. The port, the engine, the second opinion of 5e, the document: untouched.

**Deferred**:

- The refusals of a union and a difference (one case in 30,000 of the fuzz in the design range and two outside it, the cases "below the resolution" of `review.test.ts`). The second cleaning does not answer them and is not allowed to try ("Why an intersection only").
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

**The sheet is where it happens.** In the poses whose log was read (k = 57 and 67 of the pin along Z) every quadrilateral that went round lay in the sheet between the flush faces, along the outline of the hole, where corners of the two polygons and the crossings of their sides lie a few tolerances apart. In the sliver fuzz below, 834 of 4,213 cases with a plate lying flush on the other solid are refused today, and 9 of 1,786 without one.

**How the cycle ends decides the message:**

- **"Not a closed surface"** (155 of 172): the check for open edges runs right after the drop, so every state of the cycle is seen open; the loop stops on a repeated state, open.
- **The other "not closed" endings** (9) are the same two steps failing to meet: an edge opened by a drop finds no vertex among the ends of the open edges (8), or the states never repeat exactly and the loop runs all its thousand passes (1, about a second).
- **"A folded triangle"** (8): the loop stops on a repeated state that happens to be closed, and in it one piece of a split lies turned over. In the five looked at, the folded triangle is no triangle of the input, it has the cosine −1 against its face, and its width is between the two weld tolerances (2.8 · 10⁻⁴ to 4.2 · 10⁻⁴, against 4.4 · 10⁻⁴ to 5.1 · 10⁻⁴ of the pair and 2.6 · 10⁻⁴ to 3.0 · 10⁻⁴ of the result): a split at a vertex up to one tolerance of the pair off the edge turned a needle over, and only the check by the tighter tolerance of the result sees it.

So the refusals are honest, as 5a found: the mesh the loop stops in is open or has a triangle inside out. And they are not a property of the geometry: the same raw mesh has a closed, unfolded cleaning within the same tolerance.

### Why it did not show before

The fuzz of the adapter makes unions and differences of a few prisms on a coarse grid; a null triangle there is the remnant of a band of zero width, its neighbours are wide, and a split closes it for good. An intersection of two polygons of one circle, or of two large faces that coincide to the last digit, is made of the other kind of triangle throughout. The engine asked for intersections only of bodies as modelled and of copies of a pattern until 5a turned a body about a joint.

## The repair

### The second cleaning

`cleanBySubdivision(s, eps)` in `clean.ts`, beside `clean`:

1. **Weld**, as step 1 of `clean` (the same code, shared): vertices nearer than `eps` become one, triangles that lost a vertex go.
2. **Loop**:
   - Drop the membranes (`dropMembranes`, as today).
   - Find the null triangles, **by the rule of today** (`eps / 4`; `eps` with the middle vertex `8 · eps` inside the longest side). No null triangle: the loop ends.
   - For each null triangle in the order of the list, with the long side a–b and the middle vertex m: **subdivide the side a–b at m in every triangle that has it.** A triangle (a, b, x) becomes (a, m, x) and (m, b, x) with its face number; the null triangle itself is the case x = m and becomes nothing. The pieces stand where the triangle stood in the list.
     - A subdivision is named by its side and its vertex. **One that was made before is not made again**; its null triangle stays.
     - When one of the triangles on the side was already replaced in this pass, the subdivision waits for the next pass.
   - A pass that made no subdivision ends the loop: the null triangles that are left are those whose subdivision was made before.
3. **`splitNonManifold`**, as step 4 of `clean`.

What it rests on:

- **It cannot end open.** Call a mesh balanced when every directed edge a→b is met by as many b→a. The library's result is balanced (it is closed by its indices). The weld keeps it: a triangle that lost a vertex carried one edge both ways. Dropping a membrane removes every edge together with its opposite. A subdivision replaces a→b by a→m and m→b in every triangle that has it, b→a by b→m and m→a likewise, and adds m→x and x→m as a pair. So every state of the loop is balanced, and `splitNonManifold` turns a balanced mesh into one where every edge has exactly two triangles, as it does today. The first cleaning has no such property: between its two steps the mesh is open, and it is closed again only if step 3 finds its vertex.
- **It ends.** There are finitely many subdivisions (a pair of vertices and a vertex), each is made once, and a pass without one stops the loop. No memory of states, no bound on passes. Measured: 7 passes and 107 subdivisions a call on average, the most seen 24 and 1,892 ("The sliver fuzz").
- **It moves nothing further than the first cleaning does.** A subdivision moves the edge a–b to a–m–b, and m lies within `eps` of that edge by the rule that called the triangle null. It is the drop and the split of today made as one step.
- **In the quadrilateral of the cycle it makes the two cuts and stops**: the first subdivision gives the other cut, the second gives the first one back, the third would be the first again and is not made. The quadrilateral ends as the library returned it, with its thin triangle in place: a triangle with an area, lying the way it lay. Nearly every run ends so: 823 of 843 runs of the sliver fuzz below, with 24 such triangles left on average among 2,700.
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

- **The first cleaning first.** What it verifies is returned, so every intersection the adapter answers today has the answer of today, array for array. The second cleaning is not a better first one: it cuts the same mesh a little differently (the same arrays in 53 of 143 answered poses of the pin along Z), and the measures the tests pin would move in their last digits for nothing.
- **The same checks, by both tolerances.** A mesh from the second cleaning is held to what a mesh from the first is held to. Where it fails them the pair is refused with the first message.
- **The message is the first one.** The fuzz of the adapter and `sharedBy` read the text; nothing new to tell apart.
- **`BooleanOptions` gets `second?: boolean`** (default true), beside `prepare` and `restore`: "switching a step of the adapter off, only for the tests that show why it is needed". The tests of this package use it to show that a pinned case is refused by the first cleaning; the tests of 5e use it to keep a real refusal to give to the second opinion ("What follows for 5e"). It is on `ManifoldKernel`, not on the port.

### Why an intersection only

- **It may leave what a union must not have.** Guarantee 3 of the port promises a union and a difference without remnants of faces that should be gone, and the first cleaning keeps it by dropping every null triangle. The second cleaning leaves the null triangles it may not subdivide again, and one of them can carry the number of a face that has no other triangle left. Measured, with the second cleaning put **in place of** the first for every operation: 4 of 1,000 cases of the fuzz, the pinned seed 23288 and 1 of 300 tapered cases come out with a face that the same case built along the axes does not have. For an intersection the port promises no such thing (guarantee 3 is not kept for it, and the engine reads its volume and depth, not its faces).
- **It does not answer the refused unions.** With the second cleaning allowed for every operation, the fuzz of 30,000 cases refuses the same three (one in the design range, two outside), and nothing else changes; all three are "a folded triangle" after the return of moved faces (the seeds 772, 13550 and 19940), which is another cause. So for a union there is a risk and no gain.
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

- A plate (x and y from −30 to 30, from 0 to 8) with a hole cut by a regular polygon of n sides and radius r about the origin of the frame, its first corner on the x axis, the tool from −1 to 9; a pin of n sides and radius r + δ, turned by a phase, from 0 to 16, in seven cases of ten joined to a plate from 8 to 16 (x from −20 to 40, y from −25 to 25) that lies flush on the first, as the forearm lies on `upper`. n is 24, 32, 45 or 64; r is 1.5, 2.5, 4 or 12; δ is 0 in seven cases of ten, else 0.011, 0.03 or 0.1; the frame is `randomFrame` of `fuzz.ts` (one in five along the axes), in one case of seven moved 450 or 2,000 mm from the origin.
- **The oracle**: the common part is (pin polygon minus hole polygon) × 8, and the area of the difference of two convex polygons is computed by clipping one by the edges of the other.
- A case passes when the adapter refuses it, or answers with a mesh that is closed, has no folded triangle (`describe` of the kit, by the tolerance of the result) and has the volume of the oracle.

6,000 cases, the seeds 1 to 6000; in one the inputs could not be built (the union that makes the second solid was refused).

| Cases | How many | Refused today | Answered by the second cleaning | Still refused |
|---|---|---|---|---|
| Askew, the same circle | 3,313 | 591 | 575 | 16 |
| Askew, the pin larger | 1,463 | 250 | 239 | 11 |
| Along the axes, the same circle | 877 | 2 | 1 | 1 |
| Along the axes, the pin larger | 346 | 0 | | |
| All | 5,999 | 843 | 815 | 28 |

- **The refusals fall from 14 % of the cases to 0.5 %.** At the origin 8 of 5,106 cases stay refused (496 today); 450 or 2,000 mm away 20 of 893 (347 today).
- **No answer is wrong.** Every answered case is closed and unfolded, by either cleaning. The volume against the exact one:

  | Where | Cleaning | Answered | Mean error, mm³ | Worst |
  |---|---|---|---|---|
  | At the origin | first | 4,610 | 1.6 · 10⁻⁴ | 2.8 · 10⁻³ |
  | At the origin | second | 488 | 3.9 · 10⁻⁴ | 2.2 · 10⁻³ |
  | 450 mm away | first | 295 | 1.1 · 10⁻³ | 1.6 · 10⁻² |
  | 450 mm away | second | 136 | 3.7 · 10⁻³ | 2.0 · 10⁻² |
  | 2,000 mm away | first | 251 | 6.0 · 10⁻³ | 1.1 · 10⁻¹ |
  | 2,000 mm away | second | 191 | 1.4 · 10⁻² | 7.4 · 10⁻² |

  At the origin the second cleaning is as near the exact volume as the first (its mean is that of the cases it gets, the ones with the flush plate: the first cleaning's mean on those is 2.4 · 10⁻⁴). Far from the origin both carry the noise of single precision, which 5a measured for flush faces askew (up to 0.24 mm³ two metres away); the weld there is 10⁻³ and 4 · 10⁻³ mm, as much as the slivers are thick.
- **What stays refused**: in each of the 28 the mesh of the second cleaning is closed and has a folded triangle, in 26 of them by the tolerance of the pair as well. Which step turns it was not looked at. 20 of the 28 are 450 or 2,000 mm away; of the 8 at the origin 7 have polygons of 64 sides, whose slivers are 0.002 to 0.003 thick, and one 32 sides at the radius 1.5. All 28 have the flush plate.
- **The second cleaning in numbers** (843 runs): 7 passes and 107 subdivisions on average (the most seen 24 and 1,892; the most was recorded for the 265 runs of the last 2,000 cases and for the 28 that stay refused); 823 runs end with null triangles left, 24 on average among 2,700 triangles.
- **A conical pin in its conical seat** (the same fuzz with frustums of 24, 32 and 45 sides, half angles from 14° to 45°, no flush plate; 600 cases): 3 refused today, all answered by the second cleaning; the volumes within 1.4 · 10⁻³ of the exact ones by either cleaning.
- **The same 172 refused poses of the table of "The cause"**, given to the second cleaning directly: 167 pass both checks, 5 are closed and folded (the pin 0.03 larger askew at k = 27 and four poses of the plate sunk by 0.0006 two metres away).

### The time

The cleanings on the refused poses, the mean and in brackets the most:

| Set | Refused | Triangles of the raw mesh | The library | The first cleaning | The second cleaning |
|---|---|---|---|---|---|
| Pin 4 along Z | 7 | 860 | 16 ms | 13 ms (16) | 12 ms (19) |
| Pin 4 askew | 71 | 5,000 | 54 | 68 (154) | 45 (83) |
| A pin 0.03 larger, askew | 12 | 5,300 | 56 | 80 (131) | 48 (94) |
| Flush faces askew | 24 | 3,100 | 34 | 52 (192) | 30 (74) |
| A plate sunk by 0.0006, askew | 17 | 880 | 29 | 102 (1,071) | 9 (15) |

- The two checks take about a millisecond. The second cleaning is faster than the first, which goes round its cycle before it gives up (the 1,071 ms are the pose in which it runs all its thousand passes).
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

- **A pair both cleanings fail**: 4 of the 183 refused poses of the arm and the flush model, 28 of the 843 refused cases of the sliver fuzz. Such a pair is judged by its mesh as computed as today: cleared, or failed with the measure in its message.
- **Whatever else makes `boolean` throw for an intersection** and leaves the library able to answer: the second opinion does not know why the adapter refused, and does not need to.
- **It stays the one place that says "not verified".** The repair moves pairs out of `cleared` and `failed` into the verified lists; it does not make the verified lists less strict. A pair in `cleared` is rarer, and means what it meant.

**The texts that speak of refusals** change with the implementation:

- The conventions of `describe_api` (`packages/mcp/src/api.ts`): "where the kernel refuses to verify such a pin (about one pose in thirty), the pair is in `cleared`" becomes: the kernel verifies nearly every such pose; a pair it cannot verify is in `cleared` or `failed` as before. "Askew to them a pair costs seconds and a few poses in a hundred still fail" becomes: askew to them a pair costs seconds.
- The known limits of [5a](../5a-mechanism/design.md) (a joint askew to the axes) and of [5e](../5e-kernel-second/design.md) (a refused pair that really collides is in `failed`; a few that share nothing stay failed), each with a line that D51 answers these poses.
- [backlog.md](../../backlog.md), "To verify first": the entry goes; what stays of it is under "Known limits" here.

## Tests the implementation owes

**The adapter** (`packages/kernel-manifold/test`, solids of the kit, no engine):

1. **`review.test.ts`, the cases of this package**, each a plate with a hole and a pin under a flush plate as in the sliver fuzz, in the frame `rotated()` of the kit, given by n, r, δ and the phase (found by the scan of the design; the implementation checks each against its own build and replaces one that its build answers):

   | n, r, δ, phase | First cleaning alone (`{ second: false }`) | The adapter |
   |---|---|---|
   | 24, 1.5, 0, 0.0618 | throws "není uzavřená plocha" | closed, unfolded, 0.1738 mm³ against 0.1734 exact |
   | 32, 1.5, 0, 0.0818 | throws "přeložený trojúhelník" | closed, unfolded, 0.1321 against 0.1318 |
   | 32, 4, 0, 0.0818 | throws "není uzavřená plocha" | closed, unfolded, 0.9379 against 0.9375 |
   | 24, 12, 0, 0.009 | throws "není uzavřená plocha" | closed, unfolded, 2.0463 against 2.0460 |
   | 24, 4, 0.03, 0.009 (a real collision) | throws "není uzavřená plocha" | closed, unfolded, 5.9861 against 5.9856 |
   | 45, 1.5, 0, 0.0707 | throws "není uzavřená plocha" | **still throws** (pinned as a limit, with the message of the first cleaning) |

   For each answered case also: the same arrays when asked twice; every face number is one of the two inputs'; the volume within 0.002 mm³ of the exact one.
2. **The first cleaning wins**: an intersection it verifies (the blocks of `as-computed.test.ts`, and a pin askew that it answers) gives the same arrays with and without `{ second: false }`.
3. **A union and a difference never reach the second cleaning**: the refused cases of `review.test.ts` ("a gap below the resolution") are refused with and without `{ second: false }`, with the same count; a spy is not needed, the option is the switch.
4. **The second cleaning alone**, as a function, on the raw meshes of the six cases of test 1 (`{ prepare: false }`): each result is closed (`isClosed`), the sixth as well (it fails the check of folded triangles, not the closed one); the same arrays when run twice; no face number that the raw mesh does not have.
5. **`sliver-fuzz.test.ts`** with its generator in `sliver-fuzz.ts`, as measured: a case is refused or right; the refused are counted and held to a bound from the measurement (28 of 5,999 here; `1 + ⌈cases / 100⌉`); `SLIVER_FUZZ_COUNT` and `SLIVER_FUZZ_FIRST` as in the other fuzz files, 100 cases by default (about six seconds). A seed that fails is pinned in the file, as failing seeds of `fuzz.test.ts` are.
6. **`fuzz.test.ts`, `taper-fuzz.test.ts`, `coplanar.test.ts`**: unchanged, and run once with `FUZZ_COUNT=30000` and `TAPER_FUZZ_COUNT=5000` before the commit; the lines they print must be those of today.

**Below the engine's ordering** (`packages/scenarios/test/second-opinion*.ts`). The kit gets `firstOnly`, the adapter with `{ second: false }` behind the port (`{ ...kernel, boolean: (op, a, b) => kernel.boolean(op, a, b, { second: false }) }`), and `refused` and `judged` take the kernel to ask:

7. **Test 1** (the three poses of the backlog): with `firstOnly` every expectation of today (refused; the mesh as computed closed, under 1 mm³, a fit; `cleared` as a fit); with the adapter: not refused, the pair in `fits` and no `cleared`, the volume that of the mesh as computed to three digits. The other order stays a verified fit.
8. **Test 6** (flush faces askew): with `firstOnly` the expectations of today; with the adapter every one of the five poses, and the pin askew at k = 52, is not refused, nothing is in `pairs`, `failed` or `cleared`, the flush ones are in no list and the pin is in `fits`.
9. **Test 7** (real collisions refused askew): with `firstOnly` failed and not cleared, as today; with the adapter each is in `pairs`, with a depth above the limit of a fit.
10. **`second-opinion-fuzz.test.ts`**: with the adapter, along an axis and askew: nothing in `pairs`, nothing in `failed`; a pose in `cleared` is counted and held to 1 + 2 % of the poses asked (none of 480 in the run of the design: 200 poses along an axis and 40 askew, both orders, of which the first cleaning refuses 6 and 62). The file takes its kernel from `SECOND_OPINION_KERNEL`: with `first` it is the fuzz of today, over the first cleaning alone and with the bounds of today.
11. **Scenario 13, the part of 5e** (`scenario13.test.ts`): the sweep of 40 steps runs twice. Over a kernel that cleans once (`firstOnly`) the expectations of today stand: the step k = 5 is refused, the pin is in `cleared` as a fit, the gap says `fit` and names the pair. Over the adapter no step is refused, the pin is in `fits` at k = 5 and no step has a `cleared`. [requirements.md](../../requirements.md), scenario 13, gets the sentence.
12. **`bodies.test.ts`, `gap.test.ts`** (the kernel that refuses every intersection): unchanged; their refusals are made by the test.

All the checks of CLAUDE.md before each commit. Review: full.

## The cost

- **At run time**, for an intersection the first cleaning refuses: one more cleaning and its two checks, 12 ms for the pin along an axis and 30 to 50 ms askew (the most seen 94): two to six hundredths of what such a pose costs. Nothing for any other call of the kernel.
- **A sweep costs what it cost.** A refused pose paid for the measure of its mesh as computed and now pays for the measure of its verified mesh ("The time"). The seconds of a pair askew are in the measure of the engine and stay.
- **The first cleaning is still paid for** where it refuses: it is what keeps the answers of today as they are.
- **In the tests**: the sliver fuzz, about six seconds for its 100 cases (4,000 cases in both modes took 441 s); `second-opinion.test.ts` about twice its 30 s, since every pinned pose is measured over both kernels (one test per pose and kernel, so that none comes near the limit of 60 s); the part of 5e of scenario 13 about 8 s more (the sweep twice); the fuzz of 5e as today.
- **In the code**: about sixty lines in `clean.ts`, ten in `index.ts`, one option for the tests. The file gets a second loop, and a reader has to know why there are two: the comment of the second says what the first cannot promise.
- **In what is promised**: nothing new. More intersections are verified; the ones that are not are told as before.

## Where the code lives

```
packages/kernel-manifold/src/
  clean.ts      cleanBySubdivision; the weld and the rule of a null triangle shared with clean
  index.ts      boolean: the branch for an intersection; BooleanOptions.second
packages/kernel-manifold/test/
  review.test.ts, sliver-fuzz.ts, sliver-fuzz.test.ts
packages/scenarios/test/
  second-opinion-kit.ts (firstOnly), second-opinion.test.ts, second-opinion-fuzz.test.ts, scenario13.test.ts
packages/mcp/src/api.ts          one sentence of the conventions
docs/architecture/ports.md       step 6 of the adapter (the second cleaning of an intersection), the limits
docs/architecture/verification.md   a section for D51; the numbers of the fuzz
docs/backlog.md, docs/requirements.md (scenario 13), the known limits of the designs of 5a and 5e
```

`clean` itself is not edited beyond lifting the weld and the rule of a null triangle out of it for both cleanings to call; its result must stay the same array for array, which tests 2 and 6 hold. About sixty lines of new code in `clean.ts` and ten in `index.ts`.

## Rejected

- **The second cleaning in place of the first, for every operation.** One loop in the file instead of two. Measured: 4 of 1,000 fuzz cases, the pinned seed 23288 and 1 of 300 tapered cases keep a face that should be gone ("Why an intersection only"). It also changes every mesh whose null triangles lie next to each other, and with it the pinned hashes.
- **The second cleaning as the second try for a union and a difference too.** It answered none of the three refused cases of 30,000 and changed nothing else; where it did answer, it could leave the remnant above and turn an honest refusal into a broken name.
- **The second cleaning in place of the first for an intersection.** The answered intersections would change in their triangles (53 of 143 poses of the pin along Z keep their arrays) and the measures of the tests in their last digits, and nothing would be answered that the second try does not answer.
- **The loop of today mended**: remembering its splits so that the same one is not made twice. Not tried. Its two steps would still leave the mesh open between them, with nothing to say that the state it stops in is closed (9 of the 172 refusals are not cycles), and a change of that loop changes the cases it closes today.
- **Another rule for a needle** (a margin that follows the length of the side, or none at all). Not tried: every margin has its quadrilateral, and the rule decides for unions and differences too, where the fuzz found it (`verification.md`: needles dropped as null in 14 of 30,000 cases).
- **A cycle caught by a memory of states** in the second cleaning, as the first has it. Tried first: the loop then stops somewhere inside a cycle, with a turned piece in 10 of the 172 refused poses of "The cause", against 5 with the rule of once. A subdivision made once ends the cycle where it began.
- **A triangle turned against the triangle it was cut from counted as null**, and **the pieces of a null triangle counted as null**. Tried, on top of the rule of once: the first answered 1 more case of 288 refused in a run of the sliver fuzz and none more of the 172 refused poses of "The cause", the second none anywhere. Two more rules in the most delicate file for one case in three hundred.
- **The check of folded triangles by the tolerance of the pair alone** for an intersection. It would pass the eight folded meshes of today, each with a triangle inside out that a later boolean on that mesh would judge by the tighter tolerance. The second cleaning answers them without one.
- **The adapter without its refusals; the mesh as computed in place of the adapter's.** Rejected by 5a and 5e with their numbers; nothing here changes them.
- **The cleaning left to the library** (its `simplify` or its tolerance). Not tried again: `ports.md` records that it collapsed null triangles the wrong way.
- **A new library.** Not needed and not the owner's to be asked for: `manifold-3d` is asked for nothing new.

## Known limits

- **A few intersections stay refused**: 4 of 183 refused poses of the arm and the flush model, 28 of 5,999 cases of the sliver fuzz (0.16 % at the origin, 2.2 % of the cases 450 or 2,000 mm away). In each of them the second cleaning's mesh is closed and has a folded triangle. The collisions then take the second opinion of 5e: one real collision of 52 stays `failed` with its measure in the message.
- **The second cleaning leaves thin triangles the first would drop** (in 823 of 843 runs, 24 on average): those of the quadrilaterals of the cycle. They are triangles of the library's result or pieces of one, with an area, and the checks hold that none on a planar face lies turned over. For the collisions it means what it means for a mesh as computed ([5e](../5e-kernel-second/design.md), "Why it errs one way"): the flag `round` of the measure reads face numbers from every triangle, also a thin one. A fit needs more than that flag (no planar reach beyond the precision, a depth within the tolerance), and of 51 real collisions verified by the second cleaning 51 measured as collisions.
- **A union and a difference are not repaired.** Their refusals are as rare and as honest as before: `kernelFailure` on the feature.
- **An intersection is for measuring.** The verified mesh of solids with coincident faces holds sheets (guarantee 3 is not kept for an intersection), and the library reads such a mesh back with another volume: 522 of the 3,421 intersections the adapter of today answers in the first 4,000 cases of the sliver fuzz, and 178 of the 560 the second cleaning answers there. Nothing in the engine gives an intersection back to the kernel; a caller that did would have to know.
- **Far from the origin the answers are those of the weld.** Two metres away the weld tolerance is 4 · 10⁻³ mm, the volume of slivers 0.01 thick is known to a few hundredths of a mm³ (the table of the sliver fuzz), and what is thinner than the precision of the coordinates is nothing to the collisions, as before.
- **The first cleaning can take a second before it gives up** (one pose of 874 ran its thousand passes, 1.07 s). Not changed: the time is spent before the second cleaning is tried.
- **Askew to the axes of the model a pair costs seconds**, as before ([5e](../5e-kernel-second/design.md), "The cost").
- **Measured on polygons of one circle, on cones of one cone and on flush planes.** Other families of slivers (two swept profiles that agree only to the chord tolerance, gear flanks in contact) were not tried; the argument for closedness does not depend on the shape, the numbers do.
- **The claim "no answer is wrong" is 179 poses, 815 cases with an exact volume and 3 cones**, not a proof. A case that turns up is pinned in `review.test.ts`, as the regressions of the adapter are.

## Open

**Nothing needs the owner's decision.** The package stays inside the adapter, adds no library and changes no port.

For the owner to know, since both follow from the measurements and not from the brief:

- **`restoreShifted` is not changed**, although the brief names it: it takes no part in an intersection.
- **The refusals of a union and a difference are not repaired here.** They are rare (three in 30,000 fuzz cases), they have another cause, and the second cleaning must not be let near a union. If they are wanted, they are a package of their own with its own experiments.

For the implementation:

- The bounds of the two fuzz files and the default number of cases of the sliver fuzz, from its own run.
- Whether the weld and the rule of a null triangle are shared by lifting them out of `clean` or by passing them in; either way the arrays of the first cleaning stay.

## To verify before the implementation

Nothing stands in the way, and no part of the design waits for a measurement. What the implementation measures first, because the candidate was a copy of the repository and not the code:

1. **That lifting the weld and the rule of a null triangle out of `clean` leaves its arrays as they are**: the lines of the fuzz of 30,000 cases and of the 5,000 tapered ones, and the hashes of `packages/scenarios/test/review.test.ts`, before the second cleaning is wired in.
2. **The six cases of test 1** against its own build of the adapter (a refusal depends on the last bit of a coordinate).
3. **The verdicts once**, on the 183 refused poses of "Measured" (ten minutes): 179 answered and none of them wrong is what the tests then hold in the small.

Not measured, and not needed to decide the design: the app (nothing of it changes), the joint of scenario 9 (no two of its parts share anything as modelled, [5e](../5e-kernel-second/design.md), "As implemented"), and a chord tolerance other than 0.01 for the arm (the sliver fuzz varies the number of sides instead).

## Reviews

None yet: this is the version handed to the first review.

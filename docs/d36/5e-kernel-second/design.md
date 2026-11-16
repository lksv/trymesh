# 5e A second opinion of the kernel for a pair it refuses (D50)

**State: design, third version, after two rounds of review (see "Reviews") and with the owner's answers to its open questions, written on 2026-11-16 against `master` at `d5a2c95` (3a and 2c merged, 5a designed and being implemented) and against the design of [5a](../5a-mechanism/design.md). Implemented on 2026-11-16 on the branch `d36/5e` from `master` at `7de2ca3` (5a merged) and merged the same day; see "As implemented" at the end.** The types are in [contract.ts](contract.ts), the calls in [calls.ts](calls.ts); both are checked by `npx tsc -p docs/d36/tsconfig.json`. Its tests join validation scenario 13 (the part of 5a: the elbow stepped through its range), no scenario of its own.

The package is small: one member of the kernel port, one branch of the answer about a pair of bodies, one optional list in the report of the collisions and of the gap. It is new geometry in the collisions and an addition to a port, so it has a full design and its implementation a full review (CLAUDE.md, "Depth of the review").

## The owner's decisions of 2026-11-16

Two questions were left for the owner by the check of 5a before its implementation ([5a](../5a-mechanism/design.md), "Open"); three more were put by this design ("Open"). All five are decided.

- **Yes to the addition to the kernel port**: "the intersection as computed, for measuring only", so that the collisions can take a second opinion about a pair the kernel refuses. The second opinion **may only clear** such a pair; it never turns it into a collision. It comes as a small package of its own after 5a. This design is that package.
- **A picture of a pose that is not written** (`at` and `after` for the operation of the app `view_image`) **comes with 5b**, not with 5a. Nothing here depends on it; it is recorded here and in the row of 5b of [the plan](../README.md) because the two questions were put together. Until 5b a pose is written, drawn and undone.
- **The repair of the kernel adapter** (`clean`, `restoreShifted`) **is the next package right after this one.** This package does not wait for it and is not replaced by it; what the repair changes for it is under "Rejected" and "Tests".
- **The answer of the collisions gets the field `cleared`.** An answer that rests on a mesh nobody verified says so.
- **A pair the kernel fails on carries the volume and the depth measured on the mesh as computed, worded as not verified.**

## The id

`5e`: step 5 of D36 (the mechanism) and track H, after 5a. The letters `5a` to `5d` are taken (5c and 5d are track I). The package is not a query of step 1 although `interference` is one: what it repairs is met by the posed queries of 5a (a sweep meets a turned pin at every joint), it changes the code 5a changes, and its tests are poses of a mechanism. 5b does not need it.

## What 5a and the backlog say, checked against the code

[backlog.md](../../backlog.md), "To verify first": the kernel adapter refuses the intersection of a pin with its hole of the same diameter when the two polygons are turned against each other. About one turned pose in thirty with the axis along a coordinate axis, four in five askew, a quarter of the poses of faces that are flush only to the precision of the coordinates. The repair belongs in `clean` and `restoreShifted`; 5a proposes a narrower way round it.

[5a](../5a-mechanism/design.md), "A pair the kernel refuses": on 189 refused poses the intersection as the library returns it calls one a collision that is none and clears the other 188; where the adapter answers, it is wrong on 5 of 123 flush poses, always towards a collision; and the adapter without its two refusals calls 72 of 151 refused poses (another run) a collision that is none. So the raw intersection is no replacement for the adapter, and it can be a second opinion that may only clear.

What the code says:

- **The port** (`SolidKernel` in `types.ts`, between the markers `// --- porty` and `// --- přepočet`) has `boolean` and `triangulate`. Guarantee 3 of `boolean` (faces in one plane) is not kept for an intersection: [ports.md](../../architecture/ports.md) says the adapter does not adjust the tool before one, only cleans and verifies the result, and throws when it cannot verify it.
- **The adapter** (`packages/kernel-manifold/src/index.ts`): for an intersection `prepareTool` returns the tool as it is, so `boolean` is `rawBoolean`, then `clean`, then the two checks that throw, `isClosed` ("not a closed surface") and `isFolded` ("a folded triangle"). Those two throws are the refusals. `rawBoolean` is the intersection as the library returns it: it checks both inputs (`inputProblem`), asks the library, throws when the library reports an error, copies the arrays and frees the objects. It is reachable only through the option `{ prepare: false }` of `ManifoldKernel.boolean`, which exists for the tests of the adapter and is not on the port.
- **One pair** (`sharedBy` in `interference.ts`): `boolean('intersection')`, the volume, `depthOf`, `round`, all in one `try`; anything thrown becomes `{ message }`. The answer does not depend on the threshold of a call and is remembered by the two meshes (`context.memo([a.solid, b.solid], 'shared', …)` in `query/interference.ts`).
- **The report** (`interferenceReport`): a pair with a message is in `failed`; otherwise a volume above the threshold that is deeper than the precision of the coordinates is a fit or a collision by one expression. The threshold belongs to the call, the tolerance to the document.
- **The gap of 1c asks the collisions.** `gapOf` in `query/gap.ts` runs the entry `interference` for a pair whose surfaces meet (the kind of a zero: `contact`) and for a pair whose boxes overlap (is one body inside the other); a failed pair is `contact: 'unknown'` or a refused pair of the gap. So the gap follows whatever the collisions answer, with no kernel call of its own.
- **No other query calls the kernel.** `context.kernel` is handed to `sharedBy` by the entry `interference` and read nowhere else; `section`, `measure`, `mass`, `print` and `body` read meshes and surfaces, and `sketchDiagnosis`, `constraintExplanation`, `catalog` and `hardwareHole` read no body at all. The other callers of the kernel build bodies (`applyTool` in `recompute/services.ts`, the tool builds) and ask for a union, a difference or a triangulation.
- **`context.kernel` is guarded** (`guarded` in `query/context.ts`): a proxy that turns what any function member throws into `QueryFailure('failed', …)`. A new member is guarded without an edit.
- **The fakes of the port** in the tests: three object literals with the real kernel behind them (`packages/scenarios/test/bodies.test.ts`, `gap.test.ts`, `extent.test.ts`; the first two have a switch that makes every intersection throw), two with no kernel behind them (`packages/engine/test/review.test.ts`, `fanKernel` of `hole.test.ts`). The three places that cast an empty object to `SolidKernel` do not change.
- **The mesh as computed can be measured as it is.** Of 136 refused poses looked at (below) every mesh the library returned was closed by its indices, and `volumeOf`, `thickestPiece` and `penetration` of `solid.ts` took each of them. It is not clean: pieces of noise come inside out, and the library has a floor of its own ("The port").
- **Whether the adapter refuses a pair depends on which body is given first.** `interferenceReport` orders a pair by the two IDs, and 5a computes it in the frame of the first; the three poses the backlog pins were found with the parent first and are answered with the child first ("Measured").

## The cheap variant

**The port gets one member**, `intersectionAsComputed(a, b)`, which returns the common part of two solids as the kernel computes it, wrapped so that it cannot be taken for a solid (`ComputedMesh`). Its guarantees are in `contract.ts` and under "The port" below. The adapter of Manifold answers with `rawBoolean('intersection', a, b)`, checked for one thing: that it is closed by its indices.

**The answer about one pair gets a second opinion**, only when `boolean('intersection')` threw: `sharedBy` asks the new member, measures that mesh as it measures a verified one (but for the volume, which is added piece by piece), and keeps the measure beside the reason of the refusal.

**The report judges the second opinion by the rule it has**, with the threshold of the call and the tolerance of the document. A refused pair that measures as nothing or as a fit is clear, and is listed in the new optional list `cleared` with what it measured as. A refused pair that measures as a collision stays in `failed`, with what was measured in its message. `pairs` and `fits` are written only from a mesh the kernel verified.

**The gap of 1c**, which asks the collisions, reads the new list and names the pairs whose answer went through a cleared pair in a list of its own.

Nothing else changes: no new threshold but a bound on the work of the second measure, no new query, no command, nothing in the document, no schema step.

**Deferred**:

- The repair of the adapter (`clean`, `restoreShifted`), so that an intersection of many slivers comes out closed. It is the next package after this one (owner, 2026-11-16; the backlog has what is known); this package neither needs it nor is in its way ("Rejected").
- A faster measure of a mesh full of sheets. A pair askew to the axes of the model costs seconds to measure, refused or not ("The cost").
- A second opinion for a union or a difference. A body is never built from a mesh that was not verified.

## The port

```ts
interface ComputedMesh { unverified: Solid }                       // with the ports in types.ts

interface SolidKernel {
  boolean(op: BooleanOp, a: Solid, b: Solid): Solid;
  triangulate(loops: Float64Array[]): Uint32Array;
  intersectionAsComputed(a: Solid, b: Solid): ComputedMesh;        // new
}
```

What two solids share, as the kernel computes it, **for measuring only**.

What an implementation guarantees:

1. The mesh is the common part of the two solids as the kernel computed it, with nothing done to it: no faces moved before, nothing welded, dropped, split or repaired after.
2. **What the two solids share is in the mesh.** Every part of their common volume that is thicker than the precision of their coordinates (a millionth of the largest coordinate of the two, and of a millimetre at least: what the engine calls the precision of the coordinates) is there. The mesh may hold more than they share; it does not hold less. This is what the caller trusts when it clears a pair.
3. It is closed by its indices: every edge is in two triangles, once each way. So the volume of every connected piece is defined. Two solids that are apart give a mesh without triangles.
4. Every triangle carries the number of the face it comes from, as in `boolean`.
5. The same input gives the same output.
6. It throws for an input `boolean` throws for, when the library reports an error, and when the mesh is not closed by its indices (guarantee 3 is checked, and it is the one check). It never throws because the result is not clean.

What it does not guarantee, and `boolean` does:

- **That the mesh is a solid.** It may hold vertices at one place that are not joined, triangles without an area, sheets without thickness where faces coincide, slivers thinner than the precision of the coordinates, pieces that touch along an edge or at a vertex, and **pieces that are inside out**: a piece of noise may have a volume a little below zero. Two solids that only touch may give triangles that enclose nothing.
- **A tolerance for faces in one plane.** Flush faces may leave a sheet or a sliver of noise, and what that counts as is the caller's to decide.
- **That it can go back into the kernel.** The adapter would load such a mesh without an error and drop a part of it (ports.md, step 7).
- **The same answer with the two solids given the other way round.** (Nor is a refusal of `boolean` the same both ways; "Measured".)

The decisions:

- **A member of its own, not an option of `boolean`.** The first guarantee of `boolean` is that its output is a closed solid; an option that switches the guarantee off makes every caller of `boolean` read the options to know what it holds. A fake that ignored the option would also return a verified mesh where an unverified one was asked for, and nothing would show it.
- **For an intersection only.** A union or a difference as computed has no reader: they make bodies, and a body is never made of a mesh that was not verified. A general `computed(op, a, b)` would be a door with nothing behind it but a mistake.
- **The result is wrapped** (`ComputedMesh`, with the field `unverified`). `Solid` is plain data, and a second function that returns a `Solid` which is not a solid would be told apart from `boolean` by its name alone. With the wrapper the mesh cannot be handed to `boolean`, put into a `BodyResult` or exported without writing `.unverified` (`calls.ts`, `notASolid`). It is one field; the measures of `solid.ts` take the `Solid` inside as they are.
- **A mesh, not a measure.** The port returns geometry and the engine measures it (`depthOf`, the rule of a fit). A port that returned a volume and a depth would move the measure of `interference.ts` behind every kernel.
- **Required, not optional.** An optional member would give the port two behaviours and let a fake skip the second opinion without a word. The five fakes get it: the three with a kernel behind them pass it on, the two without throw as their `boolean` does.
- **Guarantee 2 is written down** although no test can prove it of a kernel: it is the property the clearing of a pair stands on, and a kernel (or a fake) that kept the other five and dropped thin overlaps would clear real collisions. A port that is trusted for something says for what.
- **A kernel that is exact may return its intersection.** For a B-rep kernel `boolean('intersection')` has every guarantee above; the member is then the same call wrapped. The port does not say "unclean", it says "not promised clean".
- **The name** is the owner's phrase. "Raw" is the adapter's word for its own inner function and says nothing at the level of a port.

**The adapter of Manifold**: `rawBoolean('intersection', a, b)`, then `isClosed` of `clean.ts` on the result (linear in the triangles; it has held for every mesh looked at, and a mesh that failed it would otherwise be measured without a word), then the wrapper. No `clean`, no `isFolded`, no tolerances. The option `{ prepare: false }` stays for the tests that use it for a union.

How Manifold keeps the guarantees, as far as it was looked at:

- **Guarantee 2.** The library has a floor of its own: its types say that triangles colinear within its tolerance are removed and that an edge shorter than the tolerance may be collapsed (`tolerance` in `manifold-encapsulated-types.d.ts` of 3.5.5). That tolerance follows the largest coordinate as the precision of the coordinates does, and is about an eighth of it by construction (the epsilon of single precision against a millionth). Measured on the flush model two metres away: 2.6 · 10⁻⁴ and 2.7 · 10⁻⁴ mm for the two solids and the larger of the two for their intersection, against a precision of 2.2 · 10⁻³; on `upper` of the arm alone 1.55 · 10⁻⁵. So what it may lose is thinner than what the report calls nothing anyway. This is read from the documentation of the library and measured on two models, not proved; "Known limits".
- **Guarantee 3** held for every mesh looked at by the spike and by the two reviews (the 136 refused poses of the spike among them), and is checked on every call.
- **Inside-out pieces are real**: 8 of 9 meshes of the arm that were taken apart had some (2 of a few dozen pieces along an axis, 7 to 28 of 55 to 134 askew), each below 10⁻⁵ mm³, together at most 2.7 · 10⁻⁵ mm³. Two metres from the origin they are larger: 2 to 38 pieces in each of 20 refused flush meshes, together up to 1.9 · 10⁻⁴ mm³. The engine measures accordingly (below).

## One pair, and the report

`sharedBy(kernel, a, b, tolerance)` (`calls.ts`, `sharedByAfter`):

1. `kernel.boolean('intersection', a.solid, b.solid)`. When it answers, the mesh is measured and that is the answer, as today. **The second opinion is not asked**: a pair that is answered today keeps its answer and its cost.
2. When it throws, the reason is kept and `kernel.intersectionAsComputed(a.solid, b.solid)` is asked, with the two bodies in the same order. Its mesh is measured by the same function (`depthOf` with the same limit and slack, `round`, the precision of the coordinates of the pair), with one difference, the volume (below). The answer is `{ message, asComputed }`.
3. When the second call throws as well (an input the kernel does not take throws both times), or its mesh has a volume that is not a number, the answer is `{ message }`: the reason of the first refusal, no second opinion. The same when the mesh is larger than the second opinion measures (the bound below); the message then says so after the reason.
4. When `boolean` answered and its own mesh cannot be measured, the answer is `{ message }` as today and the second opinion is not asked. A kernel that hands out such a mesh is not asked again.

The engine cannot tell a refusal after the cleaning from any other throw of `boolean` (it sees a message), and does not need to: the second call fails by itself for everything that is not a refusal.

**The volume of a mesh as computed is the sum of the volumes of its connected pieces, each taken without its sign** (the pieces of `thickestPiece`; a small function beside it in `solid.ts`). A verified mesh keeps the measure it has, the absolute value of the whole: its answers do not change. For a mesh with pieces of noise that are inside out, the absolute value of the whole would let them subtract from what is shared; piece by piece they add. (A lobe of noise that is joined to a real lump through an edge is in its piece and still subtracts from it: the sum is not below what is shared up to the noise inside one piece.) The difference between the two volumes was 10⁻⁵ mm³ on the arm and up to 3.7 · 10⁻⁴ two metres from the origin, a third of the threshold of 10⁻³; it changed the verdict of none of the 20 refused poses it was measured on.

The answer is remembered by the two meshes as today, with the second opinion in it. It does not depend on the threshold.

`interferenceReport` (`calls.ts`, `place`): the rule that tells nothing, a fit and a collision apart is cut out as one function, `verdictOf(measured, threshold, tolerance)`, and is asked for the answer of the adapter and for the second opinion alike.

| The adapter | The mesh as computed | The pair |
|---|---|---|
| answers | not asked | by the adapter's mesh: in no list, in `fits` or in `pairs`, as today |
| refuses | nothing: a volume at most the threshold, or no deeper than the precision of the coordinates | in `cleared`, as `nothing` |
| refuses | a fit | in `cleared`, as `fit` |
| refuses | a collision | in `failed`: the reason of the refusal, then what was measured |
| refuses | could not be computed or measured | in `failed`: the reason of the refusal |
| refuses | has more triangles than the bound | in `failed`: the reason of the refusal, then that the mesh as computed was not measured, with the bound |

- **The thresholds are the ones a verified answer is judged by**: the threshold of the call (`INTERFERENCE_THRESHOLD` by default), the chord tolerance of the document, the precision of the coordinates of the pair, `SHEET`. Nothing is added and nothing is tuned for the second opinion. A margin (a fit only up to nine tenths of the tolerance, say) was considered and has nothing to stand on: a turned pin measures up to 0.98 of the tolerance by construction, through the adapter and as computed alike, so a margin would send true fits back to `failed` and guard against nothing that was seen.
- **`round` is read as it is for a verified mesh**: from every triangle, also one without an area. Reading it only from triangles with an area was considered for the second opinion. It would be a second measure for one flag, and it would change nothing that was seen: the meshes as computed of the pins have hundreds of round triangles with an area beside the 8 to 60 without.
- **It can never report a collision.** `pairs` is written in one place, from a mesh `boolean` returned. This is a property of the code, not of the numbers, and a test holds it with a kernel that refuses everything.
- **`fits` is verified as well.** A pair cleared as a fit is not put among the fits: `cleared` is the one place for what rests on a mesh nobody verified, and a reader of `pairs` and `fits` never has to look up whether an entry is one of those. It also keeps the one wrong kind that was seen (flush faces measured as a fit, "Known limits") out of the list that says "a pin in its hole".
- **`cleared`** is an optional list of `{ a, b, kind, volume, depth }`, in the order of the report: `kind` is `nothing` or `fit`, the volume and the depth are those of the mesh as computed. It is there only when it has an entry, so the report of a model without a refused pair is the report of today field for field (the tests that compare a whole report, and the answers an AI has seen, do not change). The rule of a clear step of a sweep does not read it.
- **What `failed` still means**: neither colliding nor clear. After this package a pair is there when the kernel refused it and the mesh as computed measures as a collision, or could not be had. The first kind carries its measure in the message, after the reason of the refusal: "<reason>; as computed the two share 6.04 mm³, 0.0394 mm deep, which the kernel could not verify" (three significant digits; the reason is the adapter's text, which is Czech today and stays as it is). That is said as what it is. Thirty real collisions that the adapter refused were all of this kind (below), and so were seven poses that share nothing; the message lets a reader weigh it, the list does not decide it.
- A step of a sweep is clear as 5a says: nothing in `pairs` and nothing in `failed`.
- **A bound on the work.** The measure of a mesh as computed is the slow part (seconds askew; "The cost"), and its search for sheets grows with the square of the triangles of a piece. A mesh as computed above a number of triangles (`SECOND_OPINION_TRIANGLES`) is not measured and the pair stays failed with the reason of the refusal and that number. The implementation takes the bound from a measurement on the joint of scenario 9. **It lies above every mesh the tests pin**: the meshes here had 854 to 7,452 triangles (the two plates pinned as failed 6,210 and 6,058), so a bound below about ten thousand would change what tests 5 and 6 hold. It may only fail to clear.

### Why it errs one way

The claim the package stands on is that a refused pair which really collides is never cleared. It rests on an argument and on a measurement, not on a proof.

- **Where the adapter answers, nothing changes.** Every collision found today is found.
- **Where it refuses, the mesh as computed holds what the two bodies share, and more** (guarantee 2). What the library adds to the true common volume is what it leaves where faces coincide: sheets, slivers, triangles without an area.
  - **The volume** is not below that of what is really shared, up to the noise inside one piece: the pieces are added without their sign, and only a lobe that is inside out and joined to a real lump through an edge can still subtract from it.
  - **How far one body reaches into the other** (`penetration`) is the largest distance from a point of the common mesh to the surfaces of the two bodies, which are the inputs: more points can only raise it.
  - **The other half of the depth can fall.** `depthOf` is the larger of that reach and the mean thickness of the thickest piece (`thickestPiece`: twice its volume over its surface), and a sheet or a sliver joined to a piece adds surface and no volume. `SHEET` leaves out sheets whose two sides coincide to a part of a thousand of the precision; the noise askew is 10⁻⁵ mm apart and is not left out. The thickness decides only where the reach is zero: two bodies, or a part of two bodies, with the same surface all around. For such a pair the mesh as computed can measure shallower than the truth. A lump is far from the limit (two identical pins of the tests are 1.6 mm thick against a limit of 0.01); a thin identical part near the limit is a known limit.
- **The library has a floor too**, about an eighth of the precision of the coordinates ("The port"). The adapter welds what is thinner than about a millionth of the size of the pair; the two floors are of one order, and both are below what the report calls nothing.
- **`round` is more lenient on a mesh as computed**: a triangle without an area that carries the number of a round face makes it true. A fit also needs that no planar face reaches into a planar face beyond the precision of the coordinates, and that the depth is within the tolerance. Away from round faces a volume between planar faces that is deeper than the precision has a planar reach of its depth, and is a collision whatever `round` says. Next to a round face `penetration` excuses a planar point within the tolerance of a round face of the body it is in, as it does for a verified mesh; there the two measures do not differ, and neither did the answers (a plate sunk into another by 0.0006 and by 0.005 mm beside a hole measured as a collision in 16 poses of 16).
- **What is trusted** is guarantee 2: that the library does not lose a volume that is there. Where the adapter verified a collision the mesh as computed measured a collision in 317 cases of 317, and in the 44 real collisions the adapter refused; among them pins 0.011, 0.013 and 0.016 larger than their hole against a limit of 0.01, and the 35 collisions the calls of `bodies.test.ts` report ("Measured").
- **The errors seen all go towards more than there is**: twelve times a collision where there is none (noise of flush faces with a point that seems deep), which stays in `failed`, and once a fit where the faces only touch, which is cleared rightly under the wrong kind.

## The other queries

- **`gap` follows, and that is wanted.** It asks the entry `interference` (`sharedBy` of `query/gap.ts`) and reads its lists; both of its uses were followed.
  - **A pair whose surfaces meet** gets the kind of its zero. A pin in its hole at a refused pose has `contact: 'fit'` where it has `'unknown'` with 5a alone; flush faces that are cleared have `'touching'`; a pair that stays failed has `'unknown'` as today.
  - **A pair whose surfaces do not meet** is asked whether one body lies inside the other. A refusal ends in a refused pair of the gap today ("could not tell whether one body lies inside the other"). A second opinion that says nothing lets the gap go on to its distance; a body inside another shares its whole volume, as computed as well, and is not cleared; a pair that stays failed is refused as today.
  - **Two edits of `query/gap.ts`**: the kind of a zero reads `cleared` as well (a pair cleared as a fit is a fit), and the report of the gap gets an optional list of its own, `cleared` with `{ a, b }`, for the pairs whose answer passed through a cleared pair of the collisions, whether the pair ends at zero, at a distance or apart. It is there only when it has an entry, in the order of the bodies in the model.
    - **It is not cut by `maxPairs`** and takes no part in `truncated`. `pairs` of the gap is sorted by distance and cut, so a list cut in another order could drop the mark of a pair that is shown, and nothing would say so. An entry is two IDs, and there is one only for a pair the kernel refused and the second opinion cleared.
    - Without the list an answer of the gap would rest on a mesh nobody verified and not say so.
    - No new logic, but more than two lines: what is remembered for a pair of meshes and what `gapOf` returns carry the mark, also for a pair that ends apart, which is a bare `'apart'` today.
- **`section`, `measure`, `mass`, `print`, `body`, `hardwareHole`, `catalog`, `sketchDiagnosis`, `constraintExplanation`: none.** They do not call the kernel.
- **The recompute: none.** A union and a difference go through `boolean` and fail with `kernelFailure` as before. A test holds that the member is called in `interference.ts` alone (`packages/engine/test/modules.test.ts` already guards the imports of the engine; one more check of the same kind).
- **The exports: none.**
- **`Engine.interference`, the tool `check_interference`, the collisions of the app and the checks at the marker** run the same entry and get the same report.

## What it changes in the code of 5a

5a hands `interferenceReport` each pair in the frame of its first body and keeps `sharedBy` and the lists as they are; a pair the kernel refuses is in `failed`. This package changes that path, for a posed pair and for a pair as modelled alike:

- `sharedBy` and `interferenceReport` in `interference.ts`, as above. The pair in the frame, its boxes and its memory are 5a's and are not touched: the second opinion is asked about the same two meshes, in the same order.
- `gapOf` in `query/gap.ts`, which 5a moves into the frame of the first body: the kind of a zero and the mark of a cleared pair ("The other queries"). Nothing of the frame or of the two points changes.
- **The part of 5a of scenario 13.** 5a names the steps of the sweep at which the pin of the elbow is refused and holds that such a step has nothing else in `failed`. Those steps now have the pin in `cleared` as a fit and nothing in `failed`. Which steps they are is found through the path 5a implements, not taken from the backlog: the three poses pinned there are refused with the parent given first, and 5a asks with the child first ("Measured").
- **The conventions of `describe_api`** that 5a writes: "a pair in `failed` … happens for such a pin in about one pose of thirty, and is asked again a little to the side" becomes: a pair in `failed` is neither clear nor colliding and its message says what the kernel computed and could not verify; a pair in `cleared` is clear by a mesh the kernel did not verify. The advice to lay the axes of joints along the axes of the model stays, for another reason: askew, a pair costs seconds and a few poses in a hundred still fail.
- **The known limit of 5a** ("a joint whose axis is not along a coordinate axis … most poses end in `failed`") becomes: most poses are cleared, a few stay failed, each costs seconds.

## Where the code lives

```
packages/engine/src/
  types.ts                 ComputedMesh and the member of SolidKernel (between the two markers);
                           `cleared` and the text about `failed` on InterferenceReport (after `// --- přepočet`)
  interference.ts          sharedBy (the refused branch), verdictOf, interferenceReport, the message of a failed pair
  solid.ts                 the volume of a mesh piece by piece
  query/interference.ts    the text of `returns`
  query/gap.ts             the kind of a zero reads `cleared`; `cleared` of the report of the gap
packages/kernel-manifold/src/index.ts   intersectionAsComputed (rawBoolean, isClosed)
packages/mcp/src/tools.ts  `check_interference`: its description, and the rounding of `cleared`
packages/mcp/src/api.ts    the sentence of the conventions (above)
packages/app/src/queries/interference.ts, gap.ts   the cleared pairs as rows of their own, and in the note
the five fakes of the port in the tests
docs/architecture/ports.md, the files of the collisions in docs/architecture/ and docs/ui/
```

No module moves and no import is added: `interference.ts` has the kernel already.

## MCP and the app

**By construction.** The comment of `InterferenceReport` is in the part of `types.ts` that `describe_api` prints, so `cleared` and the meaning of `failed` reach an AI from there; the tool `query` and `check_interference` return the report as it is (`check_interference` spreads it). The port and `ComputedMesh` are between the markers and are not printed (`packages/mcp/test/tools.test.ts` holds that the description has no `SolidKernel`).

**By hand**: the description of the tool `check_interference`, which spells the lists out, and its rounding (it rounds the volume and the depth of `pairs` and `fits` itself and passes the rest on, so `cleared` gets the same rounding there, as the tool `query` gives it from the entry); `returns` of the entries `interference` and `gap`; the sentence of the conventions.

**The app**: the view of the collisions (`interferenceView`) lists fits and failed pairs already. The cleared pairs are rows of their own after the fits ("cleared by a mesh the kernel did not verify: a fit", or "shares nothing"), and the note counts them; the view of the gap marks its cleared pairs the same way. Nothing else. The snapshots of `app.test.ts` change only if a model of theirs has a refused pair; a report without one is the report of today.
- The view asks at once (`immediate`) and the engine is synchronous: a refused pair askew holds the page for the seconds its measure takes, as an answered pair askew does today. The bound on the work is what limits it.

## Measured (2026-11-16)

A spike against the real adapters and the engine of `master`, on the recipe of 5a ("Verified before the implementation"): the model is `arm()` of `packages/scenarios/test/scenario13.test.ts` with the radius of its pins varied; a pose is `transformSolid(rotation([120, 0, 0], [0, 0, 1], angle), forearm.solid, (id) => id)` with the bounds of the moved mesh; the angles are the two ends of a range and `lower + (upper − lower) · frac(k · 0.6180339887)` for k = 1, 2, … Each pose was asked through `sharedBy` twice, of the adapter and of a kernel whose `boolean` is the adapter's with `{ prepare: false }`, and judged by the rule of the report with the default threshold. 823 poses; the spike is not kept (it runs for minutes and becomes the tests below).

**The order of the two bodies is `(upper, forearm turned)`**: the parent first and as modelled, the child turned. That is the frame of the parent of 5a's check, and it is not what the engine will ask: see "The order of the two bodies" below.

**Askew** here is: both bodies moved by one transform A, the turn of 0.7 rad about (1, 2, 3) through the origin with the shift (37.3, −12.9, 55.1), rounded to single precision; then the forearm turned about the moved axis (`rotation(A·(120, 0, 0), A·ẑ, angle)`) and rounded again. **The flush model** is `upper` (radius 70 about (60, 0), z from 0 to 8, with the hole of radius 4 at (120, 0)), a plate (radius 70 about (180, 0), z from 8 to 16) and a washer (radius 6 about (100, 20), z from 8 to 10, with a hole of radius 3), no pin; placed by A and then shifted by 0 or 2000 along X, the child turned about the moved elbow axis through ±88° or slid along the moved X through ±40.

| Case | Poses | The adapter: collision, fit, nothing, refused | The refused, as computed: fit, nothing, collision | After this package: failed |
|---|---|---|---|---|
| Pin 4, axis along Z, ±88° | 150 | 0, 140, 3, 7 | 6, 1, 0 | 0 |
| Pins 1.5, 2.5 and 12, axis along Z | 150 | 0, 145, 1, 4 | 4, 0, 0 | 0 |
| Pin 4, askew | 80 | 0, 8, 1, 71 | 68, 2, 1 | 1 |
| A pin 0.03 and 0.1 larger than its hole (a real collision), along Z | 120 | 120, 0, 0, 0 | | 0 |
| The same, askew | 80 | 50, 0, 0, 30 | 0, 0, 30 | 30 |
| The forearm in the motor (a real collision beside flush faces), along Z and askew | 80 | 80, 0, 0, 0 | | 0 |
| Flush faces only, askew: plate and washer, at the origin and 2 m away, turned and slid | 160 | 0, 0, 136, 24 | 0, 18, 6 | 6 |

- **The three poses of the backlog** (pin 4, the elbow at −47.883°, −50.198° and 58.576°; k = 57, 23 and 24 of the recipe over ±88°): the adapter refuses each ("not a closed surface" at the first, "a folded triangle" at the other two). As computed: 888, 854 and 880 triangles; 0.028, 0.390 and 0.427 mm³ at a depth of 0.0006, 0.0078 and 0.0085 mm, a round face, a planar reach below 10⁻⁷ mm. A fit each time.
- **Of 136 refused poses 99 are cleared and 37 stay failed.** Of the 37, 30 are real collisions and 7 share nothing.
- **No real collision is cleared**: 0 of the 30 refused, and where the adapter verified a collision (250 poses) the mesh as computed measured a collision every time.
- **With the axis along a coordinate axis nothing is left failed**: 11 refused of 300, all cleared.
- **Askew, 1 pin of 71 refused stays failed** (the elbow at −63.753°, k = 52: as computed 0.061 mm³ with a point 0.40 mm deep, which is noise), **and 6 of 24 flush poses**, all of them the plate two metres from the origin, turned (−88°, 88°, −46.452°, 62.322°, 10.966°, 26.836°: the two ends and k = 2, 3, 9, 14; 0.006 to 0.042 mm³ with a point 0.014 to 0.34 mm deep). They are the kind 5a counted as "1 of 189". They are in `failed` today and stay there.
- **Where the adapter answers, the mesh as computed agrees on every pin** (289 poses along Z, 9 askew) **and errs on flush faces** (13 of 136: twelve times a collision that is none, once a fit that is none). Those 136 are never asked for a second opinion; they show what the second opinion would say if the adapter refused them. The twelve would stay failed. **The one would be cleared as a fit although the pair only touches** (the washer two metres away, turned by 20.774°, k = 1: 0.0011 mm³ at a depth of 0.0093 mm): cleared rightly, under the wrong kind. See "Known limits".
- **Every mesh as computed of a refused pose was closed by its indices** (136 of 136), and the volume of the whole was not negative in any. That sum hides pieces that are inside out: the review took nine meshes apart and found some in eight ("The port").
- **The time.** Along Z a pose of the pin costs 0.23 s through the adapter and 0.22 s as computed: the measure is the cost, not the boolean. A refused pose costs one more measure, 0.2 s. Askew the second measure of a refused pose takes 1.6 to 3.7 s (2.6 s for the pin of the arm; 0.14 s for the small washer), which is what a pose costs askew when the adapter answers it (5a measured up to 2.4 s and found the search for sheets in `depthOf` to be the slow part). The 80 askew poses of the pin took 43 s through the adapter, which gives up on 71 of them, and 182 s more for the second opinions. The meshes as computed have 854 to 888 triangles along Z and 1,806 to 7,452 askew.

The numbers of 5a for the same question (another run, 189 refused poses: 9 pins along Z, 135 pins askew, 45 flush faces askew): 142 fits and 46 nothing as computed, one collision that is none.

### The order of the two bodies

Found by the review, with probes through the same kernel (their output is kept outside the repository, like the spike).

- **A refusal belongs to an ordered pair of meshes.** At the three poses of the backlog the adapter refuses `(upper, forearm turned)` and answers the same two meshes given the other way round, and it answers `(forearm, upper turned back)`: a fit each time, with the volumes the mesh as computed has (0.0282, 0.3896 and 0.4269 mm³).
- **The engine will ask the third of these.** `interferenceReport` orders a pair by its IDs (`forearm` before `upper`), and 5a computes a pair in the frame of its first body. So the three poses are answered there, and the pair has other refused poses: of the first 40 angles of the recipe one, the elbow at −72.130° (k = 5), where the mesh as computed is a fit of 0.031 mm³. That agrees with 5a, which counted 4 refused of 240 in the frame of the child.
- **Asking the other way round is no remedy askew**: of 14 askew poses of the pin the adapter refused 10 one way and the same 10 the other way; of 14 of the pin 0.03 larger, 3 and the same 3 ("Rejected").
- What follows: the three poses are pinned where the order is in the hands of the test (the kernel and `sharedBy` asked directly), and the scenario finds its refused steps through the engine ("Tests").

### What the review measured besides

- **Real collisions near the limits.** Pins 0.011, 0.013 and 0.016 larger than their hole (the limit of a fit is 0.01): 30 poses, a collision as computed in all, the 7 the adapter refuses askew among them. The plate sunk into `upper` by 0.005 and by 0.0006 mm (2.6 times the precision of the coordinates): 16 poses, a collision as computed in all, 7 refused askew among them; the planar reach measured 5.0 · 10⁻³ and 6.1 · 10⁻⁴.
- **The calls of `bodies.test.ts`**, each asked of the adapter and as computed: the 35 collisions they report are collisions, the 12 fits are fits, nothing differs. (Counted per call: that file asks some pairs several times.)
- **The flush model two metres away, taken apart** (the second review): 6 of 20 turned poses of the washer and 14 of 20 of the plate refused, every mesh closed by its indices, 118 to 6,210 triangles in 9 to 150 pieces; the verdict by the volume of the whole and piece by piece is the same in all 20.
- **The neighbours of a refused pose are refused too** (5 of 6 at ±0.02° of the three poses), which is why "ask again a little to the side" goes from the conventions for the AI. **The measure of a cleared pin agrees with that of the poses next to it that the adapter answers**, to four digits.
- **Zero-area triangles**: 8 to 60 in each askew mesh, about half of them with the number of a round face, beside 277 to 669 round triangles with an area.

So a real collision the adapter verified was a collision as computed in 317 cases of 317 (250, 23, 9 and 35), and a real collision the adapter refused in 44 of 44 (30, 7 and 7).

## Tests the implementation owes

Where the order of the two bodies matters, the test says it. Tests 1 and 5 to 7 work **below the engine's ordering**: they build their models through the engine with the real adapters (so the polygons are those of the model), pose a body by hand as the spike does (`transformSolid` with the bounds of the moved mesh), and ask the kernel or `sharedBy` and `interferenceReport` with the bodies in a stated order. They live in `packages/scenarios/test`, in a file of their own; the tests of `packages/kernel-manifold` build solids with their own kit and never run the engine, and a refusal depends on the exact polygons. A pose is pinned by its k in the recipe and its range, with the angle in a comment. Tests 3, 4 and 8 go through the engine.

1. **The member of the adapter, at the three poses of the backlog**: `arm()` with pins of radius 4, the pair `(upper, forearm turned)`, the elbow at k = 57, 23 and 24 of ±88°. `boolean('intersection')` throws; `intersectionAsComputed` returns a mesh that is closed by its indices, whose pieces add up to more than zero and less than 1 mm³ and whose pieces that are inside out add up to less than 10⁻⁴ mm³, with face numbers of both inputs. The comment says what to do when the first expectation flips: these are the poses the backlog pins for the repair of `clean`, and on the day the adapter answers them the test keeps the second half and loses the first.
   - With the adapter alone (`packages/kernel-manifold/test`, solids of its kit): an input `boolean` refuses (not closed, inside out) is refused by the member with the same message; two solids apart give no triangles; the same input twice gives the same arrays.
2. **One pair and the report, with fakes** (`packages/engine/test`, beside `solid-depth.test.ts`; the engine package has no adapter): a kernel whose `boolean` throws and whose member returns a made mesh.
   - No triangles: in `cleared` as nothing. A box of 1 × 1 × 1 between planar faces: in `failed`, with the phrase of the measure in the message, never in `pairs`. The member throws: in `failed` with the first reason alone. A coordinate that is not a number: in `failed`. A mesh above the bound of the work: in `failed`.
   - Two pieces, one of them inside out: the volume is the sum of the two, not their difference.
   - `boolean` answers: the member is not called (a counter). `fits` and `pairs` never hold a pair the member decided.
   - One pair asked with two thresholds: one call of each member (the memory does not depend on the threshold), and the pair moves between `cleared` and `failed` with the threshold as an answered pair moves between no list and `pairs`.
   - A report without a cleared pair has no field `cleared`.
3. **The collisions of `bodies.test.ts` with a kernel that refuses every intersection.** That file is ten blocks with about twenty models built in line, not a table; the test needs each model as a function that builds it on a given engine, which is code of that file moved, its expectations untouched. Each model is then asked once of the real kernel and once of a kernel whose `boolean` refuses every intersection and whose new member is the real one (`calls.ts`, `refusing` and `holds`).
   - Nothing is in `pairs` or in `fits`; every verified collision is in `failed`; no verified collision is in `cleared`.
   - On these models every cleared pair also has the kind the kernel verified (the review found it so: 12 fits, and the pairs that share nothing). That is a property of these models and is asserted for them; it is not a property of the rule ("Known limits").
   - The switch `fail` that the fakes of `bodies.test.ts` and `gap.test.ts` have today makes both members throw, so the tests of today that expect a failed pair keep their meaning and their expectations ("the kernel gave up"); refusing `boolean` alone is a second switch. The switch `broken` of `bodies.test.ts` keeps its message: the second opinion is not asked there.
   - The models of that file are the ones `interference.ts` was written on (flush faces, a pin in its hole turned by a pattern, identical cylinders, shallow overlaps of planar and of round faces), so this is the measurement on the pattern cases that 5a asks for.
4. **Scenario 13, the part of 5a** (`packages/scenarios/test/scenario13.test.ts`), through the engine with the mechanism: the elbow stepped through the first 40 angles of the recipe over ±88° by `preview` of `setPose`, with a kernel that passes everything on and notes the pairs whose intersection the adapter refused.
   - At least one step is refused (the review found k = 5, −72.130°; the test finds it itself and names it in a comment). At each refused step the pin is in `cleared` and in no other list, and nothing is in `failed` or in `pairs`. Its kind is not pinned beyond the step the test names: a refused pin measures as a fit in most poses and as nothing in some (1 of 7 along an axis here). The gap of the pair names it in its own `cleared` and says the contact that goes with the kind: `'fit'` with a fit, `'touching'` with nothing.
   - No step below a quarter turn has anything in `failed`. A document without a refused pair answers as before, field for field.
5. **A fuzz over turned pins**: radii 1.5, 2.5, 4 and 12, the angles of the recipe, the pair in both orders. Along a coordinate axis: nothing in `pairs`, nothing in `failed`. Askew: nothing in `pairs`; the failed poses are counted and the count is held below a bound taken from the measurement (1 of 80 here). The number of poses comes from an environment variable, as in the fuzz of the kernel; by default a dozen along an axis and four askew, so that the file adds seconds and not minutes to `npx vitest run`. A pose that fails along an axis is pinned by its k, as failing seeds of the kernel fuzz are.
6. **No collision from flush faces**: the flush model, askew, the pair `(upper, plate)` and `(upper, washer)`, at the origin and two metres away. At the poses pinned nothing is in `pairs` and nothing in `fits`. Two of the six poses of the plate that stay failed (the ends of the range, ±88°, two metres away) are pinned as failed, with the phrase of the measure in the message and not its numbers, which are noise and move with the library; so is the pin askew at k = 52. These are the pinned cases of "1 of 189": the test says they are a limit, and a later repair turns them into cleared pairs.
7. **Real collisions the adapter refuses**, askew: the pin 0.03 larger than its hole at −88° and at k = 1 (refused in both orders, about 6.04 mm³ as computed), the pin 0.011 larger at a refused pose, and the plate sunk by 0.0006 at a refused pose. Each is in `failed`, not in `cleared`.
8. **The gap** (`packages/scenarios/test/gap.test.ts`), with the second switch, on the model of its test of a failing kernel: the pairs `F`/`PIN` and `G`/`PIN2` (a pin in a larger hole: the inside check of a pair whose surfaces do not meet) go on to their distance of 1 mm and are in `cleared` of the gap; `C`/`D`, which really collide, stay `unknown`; a body wholly inside another stays a refused pair; with both members refusing the expectations of today stand.
9. **MCP and the app**: `check_interference` and `query` return `cleared`; the rows and the note of the two views.

The spikes and all the checks of CLAUDE.md run before each commit. Review: full, with the reviewer given the code and this design.

## The cost

- **At run time**, for a refused pair only: one more intersection of the library (milliseconds) and one more measure, which is what an answered pair pays. On the arm 0.2 s for the pin along an axis, a few poses in a hundred; askew 1.6 to 3.7 s for most poses. A sweep askew therefore costs what it would cost if the adapter answered: about five times the sweep of 5a alone on the arm, which is fast there because it gives up. Remembered by the two meshes like every answer.
- **No worst case is known.** The search for sheets is quadratic in the triangles of a piece, the askew meshes are up to nine times larger than those along an axis, and a model with many coincident faces was not tried. The bound on the work exists for that; where it lies is measured by the implementation.
- **In the app** the collisions are asked at once and the engine is synchronous: seconds of a held page for a refused pair askew, as for an answered pair askew today.
- **In the tests**: askew poses cost seconds each, on a machine where a test with a time limit already fails under load (CLAUDE.md). The defaults are a handful of askew poses; the rest is behind the environment variable.
- **In the code**: a few lines in the adapter; about forty in `interference.ts` and `solid.ts`; a few in `query/gap.ts`; five fakes; `bodies.test.ts` rearranged; the texts.
- **On the port**: one more member that every kernel has to have. An exact kernel has it for nothing; the guarantee text is six points and four disclaimers.
- **In what is promised**: the collisions now clear some pairs on the word of a mesh nobody verified. That is the decision of the owner; `cleared` keeps it visible, in the collisions and in the gap.

## Shared vocabulary

**Taken**: `SolidKernel`, `Solid`, `BodyResult`, `InterferenceReport`, `GapReport` and `INTERFERENCE_THRESHOLD` of the engine; `sharedBy`, `interferenceReport` and `depthOf` of `interference.ts` as 5a leaves them; the pair in the frame of its first body and the mechanism of 5a, for the tests.

**Added**:

| Name | Where | Who uses it |
|---|---|---|
| `intersectionAsComputed` on `SolidKernel`, `ComputedMesh` | the kernel port | `sharedBy`; nothing else |
| `cleared` on `InterferenceReport`, `Cleared` | the result of the query `interference` | the gap, the tools, the view of the app, a sweep that wants to know |
| `cleared` on `GapReport` | the result of the query `gap` | the tools, the view of the app |
| `verdictOf` | `interference.ts` | the report, for both answers |

**For the plan**: the package writes to the kernel port (a shared place: 3d adds a split and an offset there, and declares its members as properties in its draft as well), to `interference.ts` and `query/gap.ts`, which 5a changes, and to `bodies.test.ts`. It follows 5a in track H; 5b does not wait for it. No number of a scenario is taken; the decision is D50.

## Rejected

- **The adapter repaired, in place of this package** (`clean` and `restoreShifted`, so that an intersection of many slivers comes out closed). The right place in the end, and by the owner's decision the next package. It is open-ended work in the most delicate code outside the engine (D29: correct by tests, not by proof), every change there has to pass the fuzz of unions and differences, and a pose sweep needs an answer now. The two do not exclude each other: a repaired adapter refuses less and the second opinion is asked less; it stays for what is still refused.
- **The adapter without its two refusals** (the cleaned mesh, unchecked). Measured by 5a: 72 collisions that are none on 151 refused poses. A refused mesh measures wrong; the refusals are honest.
- **The intersection as computed in place of the adapter's.** It errs on flush faces where the adapter is right (13 of 136 here, 5 of 123 in the run of 5a), and it would be the one answer.
- **A second opinion that may also convict** (a refused pair that measures deep as computed is a collision). The owner's rule, and the numbers agree: of 37 refused pairs that measure as a collision 7 share nothing, and a point "0.4 mm deep" in 0.06 mm³ of noise looks like the real thing. The measure goes into the message instead.
- **The adapter asked again with the two bodies the other way round**, before the second opinion: a verified answer, with no change of the port. It answers the three poses of the backlog and none of 13 refused poses askew, where nearly all refusals are; along an axis every refused pose was cleared anyway. It would be a third path through the answer about one pair for the few real collisions along an axis that the adapter refuses one way only, and none was seen. If such cases turn up it can be added in front of the second opinion without a change of this design.
- **An option of `boolean`; a general `computed(op, a, b)`; a plain `Solid` as the result; a measure as the result; an optional member.** See "The port".
- **The volume by inclusion and exclusion**, V(a) + V(b) − V(a ∪ b), from a union the kernel guarantees: no change of the port. It gives a volume and no depth, and the rule of a fit is a rule of depth; it subtracts volumes of 10⁵ mm³ in single-precision coordinates to find 10⁻³; and the union of the same two bodies meets the same slivers.
- **The pair asked again a little to the side** (by the engine or by the caller). It answers another question, the neighbours of a refused pose are mostly refused too, and askew nine poses in ten are. It was what 5a left to the caller.
- **A margin on the thresholds of the second opinion; `round` read only from triangles with an area.** See "One pair, and the report".
- **A cleared fit put among `fits`, with `cleared` as a list of names** (the first version of this design). A reader of `fits` would have to look every entry up in `cleared` to know what it rests on, and flush faces measured as a fit would stand in the list of pins in their holes.
- **Cleared pairs without a mark.** The report would look the same for a verified and an unverified clear. A list costs nothing when it is empty.
- **`cleared` always present.** It would change every answer of today and every test that compares a whole report, for a list that is empty in a model as modelled.
- **The gap left as it is**, following the collisions without a list of its own. Its `contact` and its distance after a cleared inside check would rest on a mesh nobody verified without saying so.
- **The second opinion for every throw of the measure as well** (also when the adapter answered with a mesh that cannot be measured). A kernel that returns such a mesh from `boolean` is broken in a way a second question does not mend.
- **The closure of the mesh checked by the engine** instead of the adapter. It is a guarantee of the port; the one who gives it keeps it, and the adapter has the function.

## Known limits

- **A refused pair that really collides is in `failed`, not in `pairs`.** 30 of 80 poses of an oversized pin askew. The message carries the measure; a collision is still reported only from a verified mesh.
- **A few refused pairs that share nothing stay failed**: where the mesh as computed has a point that seems deep. 1 of 71 pins askew and 6 of 24 flush poses here, none with the axis along a coordinate axis.
- **The kind of a cleared pair is less sure than a verified kind.** One flush pose of 136 measured as a fit although the faces only touch (two metres from the origin, askew). Such a pair is rightly cleared and wrongly called a fit, with a depth of noise. It stays in `cleared`, out of `fits`; the gap would call its zero a fit.
- **The claim "never clears a real collision" is an argument and 361 cases, not a proof.** It trusts guarantee 2: that the library loses nothing thicker than the precision of the coordinates. That is read from the documentation of Manifold and measured on two models (about an eighth of the precision). If a case turns up it is pinned in a `review.test.ts` and the rule is looked at again.
- **A thin volume enclosed by coincident surfaces may measure shallower as computed than it is**, because noise joined to a piece thins its mean thickness ("Why it errs one way"). It needs two bodies with an identical thin part, no deeper than a few times the tolerance, that the adapter refuses. Not seen; the identical bodies of the tests are far from it.
- **Which poses are refused depends on which body the engine gives first**, and so on the IDs of the two bodies. Nothing of the design depends on it, but a pinned pose is a pose of an ordered pair.
- **Askew to the axes of the model, a pair costs seconds**, refused or answered, and holds the page of the app that long.
- **Nothing is repaired in the adapter.** A union or a difference it refuses is a `kernelFailure` as before.
- **The message of a failed pair is in two languages** while the reasons of the adapter are Czech.

## Open

For the owner. The three questions of the second version were **decided by the owner on 2026-11-16**:

- **When the repair of the adapter is done: right after this package, as the next one.** After this package the repair matters for the real collisions the adapter refuses askew (they are `failed` and not `pairs`), for the few pairs that share nothing and stay failed, and for the time; no longer for a pin in its hole. The poses this design pins as refused are the first cases of that package, and its tests say which of their expectations flip when the adapter answers them.
- **`cleared` is wanted: the answer of the collisions gets the field.** As designed: a list of its own, there only when it has an entry, with `pairs` and `fits` verified. The list of the same name in the answer of the gap follows from the same reason and is part of this design; it was put to the owner in one question with the other.
- **A failed pair carries what the mesh as computed measures: the volume and the depth, worded as not verified.** As designed, in the message of the pair, after the reason of the refusal. The entry of `failed` keeps its three fields.

Nothing is left for the owner.

For the implementation:

- Where the seconds of an askew measure go (`thickestPiece` with the sheets left out, or `penetration` asking again over the whole surface), whether the second measure can stop early once it is above the limit of a fit, and the bound on the triangles of a mesh as computed.
- The bound of the fuzz askew, and its default number of poses.

No third-party library is needed: `manifold-3d` is approved (D2) and is asked for nothing it is not asked for today.

## Reviews

### Round 1 (2026-11-16): first version

One reviewer, an internal subagent that had not seen the design being written (Fable 5.2, effort high), read-only, at commit `6050ae1`. It was given the three files, the code and the script and the raw output of the spike, not the conclusions. `codex` and `agy` did not take part: the brief of this package asked for one internal reviewer. It ran probes of its own through the real kernel (about 90 s; their output is kept outside the repository) and returned sixteen findings: three major, nine minor, four factual, no blocker. Every finding was checked before it was acted on.

| Finding | Severity | Holds? | What changed |
|---|---|---|---|
| The three pinned poses are refusals only for `(upper, forearm turned)`. The engine orders a pair by ID and 5a asks in the frame of the first body, `(forearm, upper turned back)`, where the adapter answers all three; the scenario test as written would find the pin in `fits` and fail | major | Yes (the probe of the reviewer; `interference.ts` orders by ID) | "The order of the two bodies"; the three poses are pinned below the engine's ordering, the scenario finds its refused steps through the engine; poses are pinned by their k; `calls.ts` |
| The contract does not state the property the clearing trusts (the mesh holds what is shared), and "the mesh as computed has no floor" is wrong: Manifold removes triangles colinear within its tolerance and may collapse shorter edges | major | Yes (the types of manifold-3d 3.5.5; `tolerance()` is 1.55 · 10⁻⁵ mm on the arm) | Guarantee 2 of the member; the floor of the library with its size; "Why it errs one way" and "Known limits" say what is trusted |
| Guarantee "pieces oriented outwards, a volume not negative" is not kept: 8 of 9 meshes have pieces inside out; the spike checked the sign of the sum only; `Math.abs` of the sum lets them subtract; nothing checks the closure | major | Yes (the probe; the script) | The guarantee says closed by indices and the disclaimers name inside-out pieces; the adapter checks the closure; the volume of a mesh as computed is added piece by piece; test 1 looks at the pieces; "Measured" says what the spike checked |
| "Why it errs one way": "more points can only raise it" covers `penetration` and not `thickestPiece`; the argument about `round` ignores the excuse of a round face nearby; "the errors seen all go the other way" is contradicted by the washer | minor | Yes | The three statements are said as they are; the thin identical part is a known limit |
| No real collision near the limits was measured (the reviewer measured pins 0.011 to 0.016 over and a plate sunk by 0.0006 and 0.005: the claim held) | minor | Yes | "What the review measured besides"; test 7 has the marginal cases |
| Test 3 speaks of a table `bodies.test.ts` does not have, and asserts that a cleared pair has the verified kind, which the design itself says is false in general; `holds` returns three of its four properties | minor | Yes | The test says what it takes (the models as functions) and asserts the kind for these models only; `holds` has the fourth |
| Test 1 does not say where the two meshes come from; the tests of the adapter never run the engine | minor | Yes (`testkit.ts`) | The tests below the engine's ordering live in `packages/scenarios/test` and build their models through the engine |
| The gap gives answers that rest on a mesh nobody verified without saying so, and its second use (the inside check) has no test | minor | Yes (`gapOf`) | `cleared` of the report of the gap; two small edits of `query/gap.ts`; test 8 |
| The question about `round` is the designer's; not considered: the adapter asked the other way round, and `fits` kept verified with `cleared` carrying its kind and measure | minor | Yes | `round` is decided (as for a verified mesh); the other order is in "Rejected" with its numbers; `fits` is verified and `cleared` carries the kind and the measure |
| The cost is understated: the time of the tests, the page of the app held for seconds, no worst case for a mesh of thousands of triangles | minor | Yes | "The cost"; a bound on the work; small defaults of the fuzz |
| The message of a failed pair: the reasons of the adapter are Czech, the format of the numbers is not given, a test pins noise | minor | Yes | Three significant digits; the tests hold the phrase and not the numbers; the two languages are a known limit |
| Indexes: the row D49 and "Open" of 5a still say both questions wait; CLAUDE.md says D1 to D49; the questions of 5e for the owner are not in `cross-review.md`; the date of `decisions.md` | minor | Yes | The date and the pointer of `decisions.md`. Not changed here: the row D49 and the design of 5a (the session that implements 5a records both decisions at its merge) and CLAUDE.md (the merge updates it) |
| `sketch` is no query (`sketchDiagnosis`, `constraintExplanation`); `bodies.test.ts` has no gears; solids that only touch give triangles (240 for the pair as modelled), only solids apart give none; the member is "called", not "named", in one file | factual | Yes | Corrected |

Checked by the reviewer and found to hold: the table and the text of "Measured" against the raw output, and the recipe against the script; every statement about the code not listed above (`prepareTool`, `rawBoolean`, who reads `context.kernel`, `guarded`, the five fakes and the three casts, what `describe_api` prints, `check_interference`); that `pairs` is written only from a mesh `boolean` returned and that the gap reads a collision only from it; that `verdictOf` is the expression of today and that the expectations of `bodies.test.ts` and `gap.test.ts` stand; the declaration merging and both lines that must not compile; that `npx tsc -p docs/d36/tsconfig.json` passes.

### Round 2 (2026-11-16), narrow: the fixes of round 1

A fresh internal subagent (Fable 5.2, effort high), read-only, at commit `1e6022e` (the fixes of round 1 in `e38be57`, and the owner's answers). It was asked for blockers, majors and factual errors, and for what the fixes introduced. It found no blocker and no major: three factual errors and four minor findings. It ran one probe through the real kernel (33 s: the flush model two metres away taken apart, 20 refused poses).

| Finding | Severity | Holds? | What changed |
|---|---|---|---|
| The totals are 317 and 44, not 316 and 45 (of the 15 askew poses of the marginal pins the adapter refuses 7 and answers 8; the text had them swapped); "145 meshes" counts eight twice; the 35 of `bodies.test.ts` are reported pairs per call, not distinct collisions | factual | Yes (the raw output of the first review) | The numbers, and what the 35 are |
| "A fifteenth of the precision" compares the tolerance of one body with the precision of the pair; by construction the floor of the library is about an eighth | factual | Yes (the probe: 2.7 · 10⁻⁴ against 2.2 · 10⁻³ two metres away) | "The port", "Why it errs one way", "Known limits" |
| The noise of inside-out pieces was quoted for the arm at the origin only; two metres away the two volumes differ by up to 3.7 · 10⁻⁴ mm³, a third of the threshold (no verdict changed in 20 poses); and a lobe joined to a real lump through an edge still subtracts, so "can only add" is too strong | factual | Yes (the probe; `pieces` joins through shared edges) | The numbers of both places; the volume is not below the truth "up to the noise inside one piece" |
| Test 4 and the calls assume a refused pin is cleared as a fit; it can be cleared as nothing (1 of 7 along an axis) | minor | Yes (`out-B.txt`) | The test holds the pair in `cleared` and in no other list, and the contact of the gap that goes with the kind |
| The bound on the work is free although the pinned tests need it above the meshes they pin (up to 7,452 triangles), and its path was described three ways | minor | Yes | The bound lies above every pinned mesh; it has its row in the table and its clause in the steps; the name is in the design |
| `cleared` of the gap was cut by `maxPairs` in another order than `pairs`, without a word; and carrying the mark is more than "two small edits" | minor | Yes (`pairs` of the gap is sorted by distance) | The list is not cut; the edit is said as it is |
| A fourth disclaimer in the contract only; the example of the message had two significant digits; `check_interference` rounds `pairs` and `fits` by hand and would pass `cleared` on unrounded; the row D50 named the second round before it was written | minor | Yes (`tools.ts`) | Corrected; the rounding is in the list of edits by hand |

Checked and found to hold: every entry of the table of round 1 against the diff, with no leftover of the first version; guarantees 3 and 6 and the closure check across the three files; that the volume piece by piece never makes a shared volume smaller than the volume of the whole and is used in the refused branch only; that `place` is the table row by row and that the second opinion cannot reach `pairs` or `fits`; the gap followed through `gapOf` for a pair cleared as nothing, cleared as a fit and left failed, with the expectations of `gap.test.ts` standing when both members refuse; both declaration mergings; the ten k of the pinned poses against their angles; "Measured" against the raw outputs; that each test can be written against the code; the owner's five decisions across the design, the row D50, the rows 5b, 5e and 5f, the map and the backlog. Not probed by either round: the models of `bodies.test.ts` with the volume piece by piece (test 3 will show it).

With seven findings, none of them major, and fixes of a sentence or a number each, no third round was run.

## As implemented

Implemented on 2026-11-16 on the branch `d36/5e`, from `master` at `7de2ca3` (5a merged, schema version 6). No schema step: nothing in the document changes.

| File | What |
|---|---|
| `packages/engine/src/types.ts` | `ComputedMesh` and `intersectionAsComputed` on `SolidKernel` with its guarantees as comments (between the markers, not printed for the AI); `cleared?` and `Cleared` on `InterferenceReport`, and the text about `pairs`, `fits`, `cleared` and `failed` (printed) |
| `packages/engine/src/interference.ts` | `Measured` (was `Shared`), `measure`, `SECOND_OPINION_TRIANGLES`, `sharedBy` with the refused branch, `verdictOf`, `failedMessage`; `interferenceReport` places a pair by the table of "One pair, and the report" |
| `packages/engine/src/solid.ts` | `volumeOfPieces`, and `pieceSolids` shared with `thickestPiece` |
| `packages/engine/src/query/interference.ts`, `query/gap.ts` | the text of `returns`; the kind of a zero reads `cleared`; `GapReport.cleared`, carried in what is remembered for a pair and in what `gapOf` returns |
| `packages/kernel-manifold/src/index.ts` | `intersectionAsComputed`: `rawBoolean`, `isClosed`, the wrapper |
| `packages/mcp/src/tools.ts`, `api.ts` | the description and the rounding of `check_interference`; the sentence of the conventions |
| `packages/app/src/queries/interference.ts`, `gap.ts` | the cleared pairs as rows after the fits (pickable) and in the note; a row of the gap marked *(cleared)* and counted in the note |
| the five fakes of the port | `bodies.test.ts` and `gap.test.ts`: `fail` makes both members throw, the new switch `refuse` only `boolean`; `extent.test.ts` passes the member on; `review.test.ts` and `hole.test.ts` throw |

Deviations from the design, and what it left to the implementation:

- **The bound on the work is 12,000 triangles.** The joint of scenario 9 as modelled has no pair that shares anything (every intersection of two of its parts has no triangles), so the measurement took the largest intersection of two of its parts that could be made: the housing with itself turned by 0.01 rad, 9,174 triangles, measured in 3.7 s, as long through the kernel's verified answer. The askew poses of the arm gave up to 7,452 triangles in the measurement of the design (7,346 among the poses looked at here; 0.7 to 2.4 s; pins of radius 12 and 25 askew 1,312 to 4,204, up to 1.6 s). A fit askew near the bound, where the search for sheets runs (a pin of radius 12 at a chord tolerance of 0.003 and 0.0015), took 5.0 s at 11,768 triangles and 7.5 s at 10,018; 16,914 and 22,122 were over the bound and failed in 0.2 s. The bound lies above every mesh the tests pin and holds a refused pair to about five to eight seconds.
- **Where the seconds go** ("Open"): not only in the search for sheets. A mesh deeper than the limit of a fit skips that search (`depthOf`), and the housing turned still took 3.7 s: the reach of `penetration` over every point of a large mesh is as slow. No early stop was added; the bound limits the work.
- **Test 3 (`bodies.test.ts`) is not rearranged into a model per function.** The file's engines come from a local `newEngine` whose `interference` asks the same question again of the same document (`save`, then `load` into an engine over a kernel that refuses every intersection) and checks what `holds` of `calls.ts` checks, call by call; the expectations of the file are untouched. Over the 57 reports the file asks: nothing in `pairs` or `fits`, the 35 verified collisions all failed, the 12 verified fits all cleared as fits, 48 pairs cleared as nothing, every cleared pair of the verified kind, and no verified clear pair left failed. The same models and the same counts as the design's review, with a smaller change of the file.
- **The arm** of scenario 13 moved into `packages/scenarios/test/arm.ts`, with the radius of the pin of the elbow and of its hole as options, so that the tests of 5e build the same model.
- **The poses pinned** (`packages/scenarios/test/second-opinion.test.ts`; the recipe with k = 0 and k = −1 for the two ends of a range, `second-opinion-kit.ts`):
  - Test 1: the three poses of the backlog as designed, and the same two meshes the other way round answered by the adapter as a fit (that does not flip with a repair).
  - Test 6: refused and cleared as nothing, the plate at the origin turned to −88° (k = 0) and to k = 2, and the washer two metres away at k = 2; pinned failed with the phrase, the plate two metres away at ±88° and the pin askew at k = 52. The other flush poses looked at (the washer turned and both slid, at k = 1 and 2) are answered by the adapter and are not pinned.
  - Test 7: the pin 0.03 larger at −88° and at k = 1 (both orders refused, 6.04 mm³ as computed), the pin 0.011 larger at k = 2 (k = 0 and 2 of 0 to 6 are refused), the plate sunk by 0.0006 at k = 1 (every pose looked at, the ends and k = 1 to 6, is refused).
- **Test 5** is a file of its own (`second-opinion-fuzz.test.ts`), so that it runs beside the other: the radii in turn, k counting up from `SECOND_OPINION_FIRST`, `SECOND_OPINION_POSES` along an axis (12 by default) and `SECOND_OPINION_ASKEW` askew (2 by default after the review; the run below was made with 4), each pose in both orders; askew the failed poses are held to 1 + 5 % of the poses asked. 240 poses along an axis and 40 askew passed; no pose along an axis failed, so none is pinned.
- **Scenario 13** found one refused step of the 40, k = 5 (−72.130°), as measured, cleared as a fit of 0.0313 mm³; the test holds that k = 5 is among the refused steps and names its kind.
- **The gap**: what is remembered for a pair of meshes carries the mark, so a pair whose answer went through a cleared pair stays in `cleared` of the gap when it is asked again, also after the kernel would answer it (the test of the gap holds it: the answer belongs to the two meshes, as every remembered answer does).
- **The message** writes three significant digits as JavaScript prints a number: a volume below 10⁻⁶ comes out as `4e-7`.
- **The drafts** `contract.ts` and `calls.ts` are left as they were: they type-check against the code (the property they merge into `SolidKernel` has the type of the new method).
- **The app** was not run in a browser; its views are tested over answers written by hand (`packages/app/test/query-interference.test.ts`). No model of `app.test.ts` has a refused pair, so no snapshot changed.
- **The cost of the tests** is more than the design's "seconds and not minutes" (measured by the review, alone / in the full run): `second-opinion.test.ts` 29.5 / 33.5 s, `second-opinion-fuzz.test.ts` 17.7 / 19.7 s with four askew poses, the part of D50 of scenario 13 8 s, `bodies.test.ts` 9.4 / 16 s (it loads a twin engine per call). After the review the pinned flush poses of test 6 are one test each and the fuzz takes two askew poses by default, so no single test comes near the time limit of 60 s.
- **The gap does not carry the measure of a failed pair.** A pair at distance zero whose collisions are failed is `contact: 'unknown'` without the message, as before D50 (the design says so); its `unknown` now reads "the kernel could not verify what they share". The measure is in the answer of `interference` over the pair.

### The review of the implementation (2026-11-16)

One full review of `50b8610` by a fresh subagent (Opus 5.5) that did not write the code, read-only, with this design as its reference. No blocker and no major: one verified minor bug of a test, three minor findings and four nits; all were acted on in one commit. It checked and found to hold that `pairs` and `fits` come only from a verified mesh, that nothing escapes `sharedBy`, that a depth that is not a number cannot clear a pair, the adapter and its closure check, `volumeOfPieces` and the refactor of `thickestPiece`, the memory of answers, the bookkeeping of `cleared` in the gap, the types printed for the AI, and that the docs agree with the code but for the findings.

| Finding | Severity | What changed |
|---|---|---|
| `bodies.test.ts` fails when one test is picked by name: its `afterAll` asserted the totals of the whole file | minor (verified) | The totals are checked only when the file ran whole; no line printed |
| The new tests cost more than the design promised, test 6 at 17 s | minor | Test 6 is one test per pose; the askew fuzz takes 2 poses by default; the cost is recorded above |
| A failed pair reads "could not be computed" in the view although D50 computed and measured it; `unknown` of the gap says the same and drops the measure | minor | The view says "not verified, neither colliding nor clear", the note "could not be verified"; `unknown` reads "could not verify" in the gap, its view and api.md; the dropped measure is recorded above |
| "About five seconds" at the bound rested on a mesh that skipped the search for sheets; 7,346 against 7,452 | nit | Measured fits near the bound (5.0 and 7.5 s); the comment and this section say five to eight seconds |
| Two owed checks weaker than their wording: no field `cleared` checked on a report without pairs, the answered half of test 2 missing | nit | A regression in `packages/engine/test/review.test.ts`: a pair the kernel answers has no field `cleared` and moves between no list and `pairs` with the threshold, the member never asked |
| A comment in scenario 13 said "with the second opinion alone (5a)" | nit | "Without the second opinion (5a alone)" |
| A sentence of ports.md switched from Czech to English halfway | nit | Rewritten in English as a whole |
| `kind === undefined` cannot hold once the second opinion exists; `pieces()` runs up to three times on one mesh | nit | The branch reads `if (!second)`; the pieces are left as they are (cheap next to the measure) |

With eight findings of which none is serious, and fixes of a few lines each, no second round was run.


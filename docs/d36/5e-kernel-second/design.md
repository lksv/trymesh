# 5e A second opinion of the kernel for a pair it refuses (D50)

**State: design, first version, written on 2026-11-16 against `master` at `d5a2c95` (3a and 2c merged, 5a designed and being implemented) and against the design of [5a](../5a-mechanism/design.md). Not implemented; the package comes after 5a.** The types are in [contract.ts](contract.ts), the calls in [calls.ts](calls.ts); both are checked by `npx tsc -p docs/d36/tsconfig.json`. Its tests join validation scenario 13 (the part of 5a: the elbow stepped through its range), no scenario of its own.

The package is small: one member of the kernel port, one branch of the answer about a pair of bodies, one optional list in the report of the collisions. It is new geometry in the collisions and an addition to a port, so it has a full design and its implementation a full review (CLAUDE.md, "Depth of the review").

## The owner's decisions of 2026-11-16

Both questions were left for the owner by the check of 5a before its implementation ([5a](../5a-mechanism/design.md), "Open").

- **Yes to the addition to the kernel port**: "the intersection as computed, for measuring only", so that the collisions can take a second opinion about a pair the kernel refuses. The second opinion **may only clear** such a pair; it never turns it into a collision. It comes as a small package of its own after 5a. This design is that package.
- **A picture of a pose that is not written** (`at` and `after` for the operation of the app `view_image`) **comes with 5b**, not with 5a. Nothing here depends on it; it is recorded here and in the row of 5b of [the plan](../README.md) because the two questions were put together. Until 5b a pose is written, drawn and undone.

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
- **No other query calls the kernel.** `context.kernel` is handed to `sharedBy` by the entry `interference` and read nowhere else; `section`, `measure`, `mass`, `print`, `body` and the queries over catalogs read meshes and surfaces. The other callers of the kernel build bodies (`applyTool` in `recompute/services.ts`, the tool builds) and ask for a union, a difference or a triangulation.
- **`context.kernel` is guarded** (`guarded` in `query/context.ts`): a proxy that turns what any function member throws into `QueryFailure('failed', …)`. A new member is guarded without an edit.
- **The fakes of the port** in the tests: three object literals with the real kernel behind them (`packages/scenarios/test/bodies.test.ts`, `gap.test.ts`, `extent.test.ts`; the first two have a switch that makes every intersection throw), two with no kernel behind them (`packages/engine/test/review.test.ts`, `fanKernel` of `hole.test.ts`). The three places that cast an empty object to `SolidKernel` do not change.
- **The mesh as computed can be measured as it is.** Of 136 refused poses looked at (below) every mesh the library returned was closed by its indices and had a volume that is not negative; `volumeOf`, `thickestPiece` and `penetration` of `solid.ts` took each of them.

## The cheap variant

**The port gets one member**, `intersectionAsComputed(a, b)`, which returns the common part of two solids as the kernel computes it, wrapped so that it cannot be taken for a solid (`ComputedMesh`). Its guarantees are in `contract.ts` and under "The port" below. The adapter of Manifold answers with `rawBoolean('intersection', a, b)`.

**The answer about one pair gets a second opinion**, only when `boolean('intersection')` threw: `sharedBy` asks the new member, measures that mesh exactly as it measures a verified one, and keeps the measure beside the reason of the refusal.

**The report judges the second opinion by the rule it has**, with the threshold of the call and the tolerance of the document. A refused pair that measures as nothing or as a fit is that, and is named in the new optional list `cleared`. A refused pair that measures as a collision stays in `failed`, with what was measured in its message. `pairs` is written only from a mesh the kernel verified.

Nothing else changes: no new threshold, no new query, no command, nothing in the document, no schema step.

**Deferred**:

- The repair of the adapter (`clean`, `restoreShifted`), so that an intersection of many slivers comes out closed. It stays in the backlog as work of its own; this package neither needs it nor is in its way ("Rejected").
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

1. The mesh is the common part of the two solids as the kernel computed it, with nothing done to it: no faces moved before, nothing welded, dropped, split or checked after.
2. It is closed by its indices (every edge in two triangles, once each way) and its pieces are oriented outwards, so its volume is defined and is not negative. Solids that share nothing give a mesh without triangles.
3. Every triangle carries the number of the face it comes from, as in `boolean`.
4. The same input gives the same output.
5. It throws for an input `boolean` throws for, and when the library reports an error. It never throws because the result could not be verified: nothing is verified.

What it does not guarantee, and `boolean` does:

- **That the mesh is a solid.** It may hold vertices at one place that are not joined, triangles without an area, sheets without thickness where faces coincide, slivers thinner than the precision of the coordinates, pieces that touch along an edge or at a vertex.
- **A tolerance for faces in one plane.** Flush faces may leave a sheet or a sliver of noise, and what that counts as is the caller's to decide.
- **That it can go back into the kernel.** The adapter would load such a mesh without an error and drop a part of it (ports.md, step 7).

The decisions:

- **A member of its own, not an option of `boolean`.** The first guarantee of `boolean` is that its output is a closed solid; an option that switches the guarantee off makes every caller of `boolean` read the options to know what it holds. A fake that ignored the option would also return a verified mesh where an unverified one was asked for, and nothing would show it.
- **For an intersection only.** A union or a difference as computed has no reader: they make bodies, and a body is never made of a mesh that was not verified. A general `computed(op, a, b)` would be a door with nothing behind it but a mistake.
- **The result is wrapped** (`ComputedMesh`, with the field `unverified`). `Solid` is plain data, and a second function that returns a `Solid` which is not a solid would be told apart from `boolean` by its name alone. With the wrapper the mesh cannot be handed to `boolean`, put into a `BodyResult` or exported without writing `.unverified` (`calls.ts`, `notASolid`). It is one field; the measures of `solid.ts` take the `Solid` inside as they are.
- **A mesh, not a measure.** The port returns geometry and the engine measures it (`depthOf`, the rule of a fit). A port that returned a volume and a depth would move the measure of `interference.ts` behind every kernel.
- **Required, not optional.** An optional member would give the port two behaviours and let a fake skip the second opinion without a word. The five fakes get it: the three with a kernel behind them pass it on, the two without throw as their `boolean` does.
- **A kernel that is exact may return its intersection.** For a B-rep kernel `boolean('intersection')` has every guarantee above; the member is then the same call wrapped. The port does not say "unclean", it says "not promised clean".
- **The name** is the owner's phrase. "Raw" is the adapter's word for its own inner function and says nothing at the level of a port.

**The adapter of Manifold**: `intersectionAsComputed: (a, b) => ({ unverified: rawBoolean('intersection', a, b) })`. No `clean`, no `isClosed`, no `isFolded`, no tolerances. The option `{ prepare: false }` stays for the tests that use it for a union.

## One pair, and the report

`sharedBy(kernel, a, b, tolerance)` (`calls.ts`, `sharedByAfter`):

1. `kernel.boolean('intersection', a.solid, b.solid)`. When it answers, the mesh is measured and that is the answer, as today. **The second opinion is not asked**: a pair that is answered today keeps its answer and its cost.
2. When it throws, the reason is kept and `kernel.intersectionAsComputed(a.solid, b.solid)` is asked. Its mesh is measured by the same function (the volume, `depthOf` with the same limit and slack, `round`, the precision of the coordinates of the pair), and the answer is `{ message, asComputed }`.
3. When the second call throws as well (an input the kernel does not take throws both times), or its mesh has a volume that is not a number, the answer is `{ message }`: the reason of the first refusal, no second opinion.
4. When `boolean` answered and its own mesh cannot be measured, the answer is `{ message }` as today and the second opinion is not asked. A kernel that hands out such a mesh is not asked again.

The engine cannot tell a refusal after the cleaning from any other throw of `boolean` (it sees a message), and does not need to: the second call fails by itself for everything that is not a refusal.

The answer is remembered by the two meshes as today, with the second opinion in it. It does not depend on the threshold.

`interferenceReport` (`calls.ts`, `place`): the rule that tells nothing, a fit and a collision apart is cut out as one function, `verdictOf(measured, threshold, tolerance)`, and is asked for the answer of the adapter and for the second opinion alike.

| The adapter | The mesh as computed | The pair |
|---|---|---|
| answers | not asked | by the adapter's mesh: in no list, in `fits` or in `pairs`, as today |
| refuses | nothing: a volume at most the threshold, or no deeper than the precision of the coordinates | in no list; named in `cleared` |
| refuses | a fit | in `fits`, with the volume and the depth of the mesh as computed; named in `cleared` |
| refuses | a collision | in `failed`: the reason of the refusal, then what was measured |
| refuses | could not be computed or measured | in `failed`: the reason of the refusal |

- **The thresholds are the ones a verified answer is judged by**: the threshold of the call (`INTERFERENCE_THRESHOLD` by default), the chord tolerance of the document, the precision of the coordinates of the pair, `SHEET`. Nothing is added and nothing is tuned for the second opinion. A margin (a fit only up to nine tenths of the tolerance, say) was considered and has nothing to stand on: a turned pin measures up to 0.98 of the tolerance by construction, through the adapter and as computed alike, so a margin would send true fits back to `failed` and guard against nothing that was seen.
- **It can never report a collision.** `pairs` is written in one place, from a mesh `boolean` returned. This is a property of the code, not of the numbers, and a test holds it with a kernel that refuses everything.
- **`cleared`** is an optional list of `{ a, b }`, there only when it has an entry, so the report of a model without a refused pair is the report of today field for field (the tests that compare a whole report, and the answers an AI has seen, do not change). It says which answers rest on a mesh that was not verified. The rule of a clear step of a sweep does not read it.
- **What `failed` still means**: neither colliding nor clear. After this package a pair is there when the kernel refused it and the mesh as computed measures as a collision, or could not be had. The first kind carries its measure in the message: "…; as computed the two share 6.04 mm³, 0.039 mm deep, which the kernel could not verify". That is said as what it is. Thirty real collisions that the adapter refused were all of this kind (below), and so were seven poses that share nothing; the message lets a reader weigh it, the list does not decide it.
- A step of a sweep is clear as 5a says: nothing in `pairs` and nothing in `failed`.

### Why it errs one way

The claim the package stands on is that a refused pair which really collides is never cleared. It rests on an argument and on a measurement, not on a proof.

- **Where the adapter answers, nothing changes.** Every collision found today is found.
- **Where it refuses, the mesh as computed holds what the two bodies share, and more.** The library intersects the two meshes as they are; what it adds to the true common volume is what it leaves where faces coincide: sheets, slivers, triangles without an area. A volume and a depth measured on that are not below those of the volume that is really shared. The depth is the largest distance from a point of the common mesh to the surfaces of the two bodies, which are the inputs: more points can only raise it.
- **It is not more lenient than the adapter would be either.** The adapter's mesh is this mesh cleaned, and the cleaning only welds, drops and splits. The adapter has a floor (an overlap thinner than a millionth of the size of the pair is welded away and counts as touching); the mesh as computed has none. So it sees more, not less.
- **The one place it is more lenient is `round`**: a triangle without an area that carries the number of a round face makes it true. That alone clears nothing. A fit also needs that no planar face reaches into a planar face beyond the precision of the coordinates and that the depth is within the tolerance; a volume bounded by planar faces only, deeper than that precision, has a planar reach of its depth and is a collision whatever `round` says.
- **What is trusted** is that the library does not lose a volume that is there. Where the adapter verified a collision the mesh as computed measured a collision in 250 poses of 250, and in the 30 real collisions the adapter refused.
- **The errors seen all go the other way**: a mesh as computed that measures a collision where there is none (noise of flush faces with a point that seems deep). Those pairs stay in `failed`, where they are today.

## The other queries

- **`gap` follows, by construction, and that is wanted.** It asks the entry `interference` and reads its three lists. A pin in its hole at a refused pose has `contact: 'fit'` where it has `'unknown'` with 5a alone; flush faces that are cleared have `'touching'`. For a pair whose surfaces do not meet, a refusal used to end in a refused pair of the gap ("could not tell whether one body lies inside the other"); a second opinion that says nothing lets the gap go on to its distance. A body inside another is not cleared: it shares its whole volume, as computed as well. `query/gap.ts` is not edited.
- **`section`, `measure`, `mass`, `print`, `body`, `hardwareHole`, `catalog`, `sketch`: none.** They do not call the kernel.
- **The recompute: none.** A union and a difference go through `boolean` and fail with `kernelFailure` as before. A test holds that the member is named in `interference.ts` alone (`packages/engine/test/modules.test.ts` already guards the imports of the engine; one more check of the same kind).
- **The exports: none.**
- **`Engine.interference`, the tool `check_interference`, the collisions of the app and the checks at the marker** run the same entry and get the same report.

## What it changes in the code of 5a

5a hands `interferenceReport` each pair in the frame of its first body and keeps `sharedBy` and the lists as they are; a pair the kernel refuses is in `failed`. This package changes that path, for a posed pair and for a pair as modelled alike:

- `sharedBy` and `interferenceReport` in `interference.ts`, as above. The pair in the frame, its boxes and its memory are 5a's and are not touched: the second opinion is asked about the same two meshes.
- **The part of 5a of scenario 13.** 5a names the steps of the sweep at which the pin of the elbow is refused and holds that such a step has nothing else in `failed`. Those steps now have the pin in `fits` and in `cleared` and nothing in `failed`; the three poses of the backlog are asked by value (`calls.ts`, `REFUSED_ELBOW`).
- **The conventions of `describe_api`** that 5a writes: "a pair in `failed` … happens for such a pin in about one pose of thirty, and is asked again a little to the side" becomes: a pair in `failed` is neither clear nor colliding and its message says what the kernel computed and could not verify; a pair in `cleared` is clear by a mesh the kernel did not verify. The advice to lay the axes of joints along the axes of the model stays, for another reason: askew, a pair costs seconds and a few poses in a hundred still fail.
- **The known limit of 5a** ("a joint whose axis is not along a coordinate axis … most poses end in `failed`") becomes: most poses are cleared, a few stay failed, each costs seconds.

## Where the code lives

```
packages/engine/src/
  types.ts                 ComputedMesh and the member of SolidKernel (between the two markers);
                           `cleared` and the text about `failed` on InterferenceReport (after `// --- přepočet`)
  interference.ts          sharedBy (the refused branch), verdictOf, interferenceReport, the message of a failed pair
  query/interference.ts    the text of `returns`
packages/kernel-manifold/src/index.ts   intersectionAsComputed
packages/mcp/src/tools.ts  the description of `check_interference`
packages/mcp/src/api.ts    the sentence of the conventions (above)
packages/app/src/queries/interference.ts   the note of the view counts the cleared pairs
the five fakes of the port in the tests
docs/architecture/ports.md, the files of the collisions in docs/architecture/ and docs/ui/
```

No module moves and no import is added: `interference.ts` has the kernel already.

## MCP and the app

**By construction.** The comment of `InterferenceReport` is in the part of `types.ts` that `describe_api` prints, so `cleared` and the meaning of `failed` reach an AI from there; the tool `query` and `check_interference` return the report as it is. The port and `ComputedMesh` are between the markers and are not printed (`packages/mcp/test/tools.test.ts` holds that the description has no `SolidKernel`).

**By hand**: the description of the tool `check_interference`, which spells the lists out; `returns` of the entry; the sentence of the conventions.

**The app**: the view of the collisions (`interferenceView`) lists fits and failed pairs already. Its note says how many pairs were cleared by a mesh the kernel did not verify, and the row of such a fit is marked. Nothing else. The snapshots of `app.test.ts` change only if a model of theirs has a refused pair; a report without one is the report of today.

## Measured (2026-11-16)

A spike against the real adapters and the engine of `master`, on the recipe of 5a ("Verified before the implementation"): the model is `arm()` of `packages/scenarios/test/scenario13.test.ts` with the radius of its pins varied; a pose is `transformSolid(rotation([120, 0, 0], [0, 0, 1], angle), forearm.solid, (id) => id)` with the bounds of the moved mesh; the angles are the two ends of a range and `lower + (upper − lower) · frac(i · 0.6180339887)`. Each pose was asked through `sharedBy` twice, of the adapter and of a kernel whose `boolean` is the adapter's with `{ prepare: false }`, and judged by the rule of the report with the default threshold. 823 poses; the spike is not kept (it runs for minutes and becomes the tests below).

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

- **The three poses of the backlog** (pin 4, the elbow at −47.883°, −50.198° and 58.576°): the adapter refuses each ("not a closed surface" at the first, "a folded triangle" at the other two). As computed: 888, 854 and 880 triangles; 0.028, 0.390 and 0.427 mm³ at a depth of 0.0006, 0.0078 and 0.0085 mm, a round face, a planar reach below 10⁻⁷ mm. A fit each time.
- **Of 136 refused poses 99 are cleared and 37 stay failed.** Of the 37, 30 are real collisions and 7 share nothing.
- **No real collision is cleared**: 0 of the 30 refused, and where the adapter verified a collision (250 poses) the mesh as computed measured a collision every time.
- **With the axis along a coordinate axis nothing is left failed**: 11 refused of 300, all cleared.
- **Askew, 1 pin of 71 refused stays failed** (the elbow at −63.753°: as computed 0.061 mm³ with a point 0.40 mm deep, which is noise), **and 6 of 24 flush poses**, all of them the plate two metres from the origin, turned (−88°, 88°, −46.452°, 62.322°, 10.966°, 26.836°; 0.006 to 0.042 mm³ with a point 0.014 to 0.34 mm deep). They are the kind 5a counted as "1 of 189". They are in `failed` today and stay there.
- **Where the adapter answers, the mesh as computed agrees on every pin** (289 poses along Z, 9 askew) **and errs on flush faces** (13 of 136: twelve times a collision that is none, once a fit that is none). Those 136 are never asked for a second opinion; they show what the second opinion would say if the adapter refused them. The 12 would stay failed. **The one would be listed as a fit although the pair only touches** (the washer two metres away, turned by 20.774°: 0.0011 mm³ at a depth of 0.0093 mm): cleared rightly, named wrongly. See "Known limits".
- **Every mesh as computed of a refused pose was closed by its indices and had no negative volume** (136 of 136), which is guarantee 2 of the member.
- **The time.** Along Z a pose of the pin costs 0.23 s through the adapter and 0.22 s as computed: the measure is the cost, not the boolean. A refused pose costs one more measure, 0.2 s. Askew the second measure of a refused pose takes 1.6 to 3.7 s (2.6 s for the pin of the arm; 0.14 s for the small washer), which is what a pose costs askew when the adapter answers it (5a measured up to 2.4 s and found the search for sheets in `depthOf` to be the slow part). The 80 askew poses of the pin took 43 s through the adapter, which gives up on 71 of them, and 182 s more for the second opinions.

The numbers of 5a for the same question (another run, 189 refused poses: 9 pins along Z, 135 pins askew, 45 flush faces askew): 142 fits and 46 nothing as computed, one collision that is none.

## Tests the implementation owes

1. **The adapter** (`packages/kernel-manifold/test/review.test.ts`): the pin of radius 4 in its hole at the three poses of the backlog. `boolean('intersection')` throws; `intersectionAsComputed` returns a mesh that is closed by its indices, has a volume above zero and below 1 mm³, and face numbers of both inputs. The comment says what to do when the first expectation flips: these are the poses the backlog pins for the repair of `clean`, and on the day the adapter answers them the test keeps the second half and loses the first.
   - An input `boolean` refuses (not closed, inside out) is refused by the member with the same message; two solids apart give no triangles; the same input twice gives the same arrays.
2. **One pair and the report, with fakes** (`packages/engine/test`, beside `solid-depth.test.ts`; the engine package has no adapter): a kernel whose `boolean` throws and whose member returns a made mesh.
   - No triangles: in no list, in `cleared`. A box of 1 × 1 × 1 between planar faces: in `failed`, with the measure in the message, never in `pairs`. The member throws: in `failed` with the first reason. A coordinate that is not a number: in `failed`.
   - `boolean` answers: the member is not called (a counter).
   - One pair asked with two thresholds: one call of each member (the memory does not depend on the threshold), and the pair moves between `cleared` and `failed` with the threshold as an answered pair moves between no list and `pairs`.
   - A report without a cleared pair has no field `cleared`.
3. **The table of the collisions with a kernel that refuses every intersection** (`packages/scenarios/test/bodies.test.ts`): every case of that file asked once of the real kernel and once of a kernel whose `boolean` refuses every intersection and whose new member is the real one (`calls.ts`, `refusing` and `holds`).
   - The switch `fail` that the fakes of `bodies.test.ts` and `gap.test.ts` have today makes both members throw, so the tests of today that expect a failed pair keep their meaning and their expectations ("the kernel gave up"); refusing `boolean` alone is a second switch. Nothing is in `pairs`; every verified collision is in `failed`; every cleared pair has the verdict the kernel verified. The cases of that file are the ones `interference.ts` was written on (flush faces, a pin in its hole turned by a pattern, identical cylinders, gears with a negative backlash, shallow overlaps of planar and of round faces), so this is the measurement on the pattern cases that 5a asks for.
4. **Scenario 13, the part of 5a** (`packages/scenarios/test/scenario13.test.ts`): the elbow at the three poses has the pin in `fits` and in `cleared`, nothing in `failed`, nothing in `pairs`; the gap of the pair says `contact: 'fit'`. The sweep of 5a has no failed step below a quarter turn. A document without a refused pair answers as before, field for field.
5. **A fuzz over turned pins** (`packages/scenarios/test`, counted by an environment variable as the fuzz of the kernel is, a few dozen poses by default): radii 1.5, 2.5, 4 and 12, the angles of the recipe. Along a coordinate axis: nothing in `pairs`, nothing in `failed`. Askew: nothing in `pairs`; the failed poses are counted and the count is held below a bound taken from the measurement (1 of 80 here). A pose that fails along an axis is pinned by its value, as failing seeds of the kernel fuzz are.
6. **No collision from flush faces** : the flush model above, askew, at the origin and two metres away, a few poses of each: nothing in `pairs` and nothing in `fits` at the poses pinned; the six poses of the plate that stay failed are pinned as failed with their measure in the message, and so is the pin askew at −63.753°. These are the pinned cases of "1 of 189": the test says they are a limit, and a later repair turns them into cleared pairs.
7. **Real collisions the adapter refuses** : the pin 0.03 larger than its hole, askew, at two of the refused poses (−88° and 20.774°): in `failed`, not in `cleared`, not in `fits`, with about 6.04 mm³ in the message.
8. **MCP and the app**: `check_interference` and `query` return `cleared`; the note of the view.

The spikes and all the checks of CLAUDE.md run before each commit. Review: full, with the reviewer given the code and this design.

## The cost

- **At run time**, for a refused pair only: one more intersection of the library (milliseconds) and one more measure, which is what an answered pair pays. On the arm 0.2 s for the pin along an axis, a few poses in a hundred; askew 1.6 to 3.7 s for most poses. A sweep askew therefore costs what it would cost if the adapter answered: about five times the sweep of 5a alone on the arm, which is fast there because it gives up. Remembered by the two meshes like every answer.
- **In the code**: one line in the adapter; about thirty in `interference.ts`; five fakes; the texts.
- **On the port**: one more member that every kernel has to have. An exact kernel has it for nothing; the guarantee text is five points and three disclaimers.
- **In what is promised**: the collisions now clear some pairs on the word of a mesh nobody verified. That is the decision of the owner; `cleared` keeps it visible.

## Shared vocabulary

**Taken**: `SolidKernel`, `Solid`, `BodyResult`, `InterferenceReport` and `INTERFERENCE_THRESHOLD` of the engine; `sharedBy`, `interferenceReport` and `depthOf` of `interference.ts` as 5a leaves them; the pair in the frame of its first body and the mechanism of 5a, for the tests.

**Added**:

| Name | Where | Who uses it |
|---|---|---|
| `intersectionAsComputed` on `SolidKernel`, `ComputedMesh` | the kernel port | `sharedBy`; nothing else |
| `cleared` on `InterferenceReport` | the result of the query `interference` | the tools, the view of the app, a sweep that wants to know |
| `verdictOf` | `interference.ts` | the report, for both answers |

**For the plan**: the package writes to the kernel port (a shared place: 3d adds a split and an offset there, and declares its members as properties in its draft as well) and to `interference.ts`, which 5a changes. It follows 5a in track H; 5b does not wait for it. No number of a scenario is taken; the decision is D50.

## Rejected

- **The adapter repaired** (`clean` and `restoreShifted`, so that an intersection of many slivers comes out closed). The right place in the end, and the backlog keeps it. It is open-ended work in the most delicate code outside the engine (D29: correct by tests, not by proof), every change there has to pass the fuzz of unions and differences, and a pose sweep needs an answer now. The two do not exclude each other: a repaired adapter refuses less and the second opinion is asked less; it stays for what is still refused.
- **The adapter without its two refusals** (the cleaned mesh, unchecked). Measured by 5a: 72 collisions that are none on 151 refused poses. A refused mesh measures wrong; the refusals are honest.
- **The intersection as computed in place of the adapter's.** It errs on flush faces where the adapter is right (13 of 136 here, 5 of 123 in the run of 5a), and it would be the one answer.
- **A second opinion that may also convict** (a refused pair that measures deep as computed is a collision). The owner's rule, and the numbers agree: of 37 refused pairs that measure as a collision 7 share nothing, and a point "0.4 mm deep" in 0.06 mm³ of noise looks like the real thing. The measure goes into the message instead.
- **An option of `boolean`; a general `computed(op, a, b)`; a plain `Solid` as the result; a measure as the result; an optional member.** See "The port".
- **The volume by inclusion and exclusion**, V(a) + V(b) − V(a ∪ b), from a union the kernel guarantees: no change of the port. It gives a volume and no depth, and the rule of a fit is a rule of depth; it subtracts volumes of 10⁵ mm³ in single-precision coordinates to find 10⁻³; and the union of the same two bodies meets the same slivers.
- **The pair asked again a little to the side** (by the engine or by the caller). It answers another question, and askew it does not converge: nine poses in ten are refused there. It was what 5a left to the caller.
- **A margin on the thresholds of the second opinion.** See "One pair, and the report".
- **Cleared pairs without a mark.** The report would look the same for a verified and an unverified clear. A list costs nothing when it is empty.
- **A mark on each fit instead of a list** (`unverified: true` on the entry). A cleared pair that shares nothing is in no list and would have nowhere to carry it.
- **`cleared` always present.** It would change every answer of today and every test that compares a whole report, for a list that is empty in a model as modelled.
- **The second opinion for every throw of the measure as well** (also when the adapter answered with a mesh that cannot be measured). A kernel that returns such a mesh from `boolean` is broken in a way a second question does not mend.

## Known limits

- **A refused pair that really collides is in `failed`, not in `pairs`.** 30 of 80 poses of an oversized pin askew. The message carries the measure; a collision is still reported only from a verified mesh.
- **A few refused pairs that share nothing stay failed**: where the mesh as computed has a point that seems deep. 1 of 71 pins askew and 6 of 24 flush poses here, none with the axis along a coordinate axis.
- **The kind of a clear answer is less sure than the adapter's.** A cleared pair is listed as a fit when the mesh as computed measures as one; one flush pose of 136 measured so although the faces only touch (two metres from the origin, askew). Such a pair is rightly not a collision and wrongly among the fits, with a depth of noise. `cleared` names it.
- **The claim "never clears a real collision" is an argument and 280 poses, not a proof.** It trusts the library not to lose a volume. If a case turns up it is pinned in `review.test.ts` and the rule is looked at again.
- **Askew to the axes of the model, a pair costs seconds**, refused or answered.
- **Nothing is repaired in the adapter.** A union or a difference it refuses is a `kernelFailure` as before.
- **A fit by the second opinion has the volume and the depth of a mesh nobody verified.** On the pins they agree with the neighbouring poses the adapter answers.

## Open

For the owner (none blocks the implementation):

- **When the repair of the adapter is done** (`clean`, `restoreShifted`; the backlog). After this package it matters for the real collisions the adapter refuses askew (they are `failed` and not `pairs`) and for the time, no longer for a pin in its hole.
- **Whether `cleared` is wanted in the answer.** The design adds it so that an answer that rests on a mesh nobody verified says so. Without it the report keeps its shape of today in every case, and nobody can tell the two kinds of clear apart.
- **Whether a failed pair should carry what the mesh as computed measures.** The design puts it into the message, in words that say it is not verified. It is the only way a refused real collision shows its size; it is also a number about a collision that comes from the second opinion, which the rule "may only clear" could be read to exclude.

For the implementation:

- Where the seconds of an askew measure go (`thickestPiece` with the sheets left out, or `penetration` asking again over the whole surface), and whether the second measure can stop early once it is above the limit of a fit.
- Whether `round` of the second opinion should be read only from triangles with an area. The argument above says it clears nothing wrongly either way; the pose of the washer suggests it would not have been called a fit.
- The bound of the fuzz askew.

No third-party library is needed: `manifold-3d` is approved (D2) and is asked for nothing it is not asked for today.

## Reviews

# 1c Smallest gap between bodies

**Decision D40. State: designed, not implemented; fourth version, after three rounds of reviews. One choice is left open on purpose: whether the kernel port gets a method at all (see "Open").** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario, the entry and the view as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

Validation scenario 11 (the queries asked about the robot joint of scenario 9), this package's part: the gap between a planet and the carrier.

It needs the engine side of [1b](../1b-measure/design.md): the pass over two meshes (`closest`), the precision of the coordinates and the estimate of the accuracy of a mesh; and, in the app, the generic form of a query designed there. The plan shows only the second; see "Order inside the track" of 1b.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md): the smallest distance of bodies, to verify a clearance (the motor in its housing is meant to have 1 mm) and not only that parts do not run into each other; for the pose of a mechanism, the smallest gap at each step. "To verify first" notes that the kernel port has only `boolean` and `triangulate` and that every further operation of Manifold extends it. The brief adds: Manifold has `minGap`.

- **The port** (`SolidKernel` in `types.ts`) has `boolean` and `triangulate`. The adapter (`packages/kernel-manifold/src/index.ts`) builds a `Manifold` from a `Solid` (`toManifold`), checks its input first (`inputProblem`: closed, not inside out, face numbers in range), and frees the objects of the library by hand.
- **`minGap(other, searchLength)` of Manifold 3.5.5** is documented in one sentence: the minimum gap between two manifolds, a number between 0 and `searchLength`. What it does was tried on the model of scenario 9 and on crafted cubes (the script is kept outside the repository):

  | Case | Answer |
  |---|---|
  | planet and carrier, search 10 | 0.140453 (0.15 by design: the pin 5 in the bore 5.3; both are polygons inscribed in their circles) |
  | the same, search 0.1 | 0.1: the search length itself |
  | motor and housing | 0.990044 (1 by design) |
  | plate and housing, motor and plate (flush faces) | 0 |
  | sun and planet, planet and ring gear (backlash 0.05) | 0.049934, 0.049665 |
  | two cubes that overlap; two that share a face | 0, 0 |
  | a cube wholly inside a solid cube | 0 |
  | a cube in the cavity of a hollow cube, 2 from its wall | 2 |
  | two cubes 10 apart, search 5 | 5 |
  | against an empty solid | the search length |
  | two cubes 10 apart, search 10 | 10: a distance equal to the search length cannot be told from "not found" |
  | search length 0 | 0 |
  | search length −1, −100 (cubes 10 apart) | 1, 10: taken by its absolute value |
  | search length NaN | Infinity |
  | `a` and `b` swapped | the same, except the last digit in two pairs of the joint (1e-17) |
  | plate and carrier (34 apart), search 10 and 100 | 5 ms and 339 ms |
  | all 28 pairs of the joint, search 5 | 428 ms; one pair 24 ms, of which 9 ms is building the two objects |

  So it answers zero for bodies that touch, that share a volume or of which one lies inside the material of the other, it does not say where the gap is, and its cost grows with the search length.
- **Where the gap is** can be found by the engine: the pass of 1b over the two meshes returned exactly the distance of the kernel for every pair tried, with the two points and their faces, in 8 to 47 ms.
- **What a gap of zero is** is already answered by `interference`: it tells a collision from a fit of round faces and from bodies that only touch, and remembers the pair by its two meshes.
- **Three fakes of the port** are written as object literals in tests, and a method added to the port has to be added to each. The two in `packages/scenarios/test/bodies.test.ts` and `extent.test.ts` wrap the real kernel and pass the method on. The one in `packages/engine/test/review.test.ts` has no kernel behind it (its `boolean` throws, its `triangulate` returns nothing; the engine package has no adapter), so its `minGap` throws as its `boolean` does.

## The cheap variant

**The port gets one method, `minGap(a, b, within)`**, with what an implementation guarantees written out in `contract.ts`:

1. The smallest distance between the surfaces of the two meshes as given, when it is below `within`; otherwise `within` itself.
2. Zero when the solids touch or share a volume, without telling the two apart. A solid inside the material of the other is zero; a solid in a cavity of the other has the distance to its wall.
3. The meshes are measured without a tolerance. What counts as touching is the caller's decision.
4. An empty solid is at `within` from everything.
5. `within` is finite and above zero, otherwise the method throws; a solid the kernel cannot take throws as for `boolean`.
6. The same input gives the same output; swapped operands may differ in the last digit.
7. The cost grows with `within`.

The adapter of Manifold checks both solids as `boolean` does, checks `within` itself (the library takes zero, a negative number and NaN without a word and answers 0, the distance within the absolute value, and Infinity), calls `minGap` and frees the two objects. It does not go through the preparation and the cleaning of `boolean`: nothing is built.

**The query `gap`** asks about pairs of bodies, as `interference` does.

- **All pairs in one call, or one pair: both, by one argument.** `bodies` is the list among which pairs are formed, all bodies without it; a call with two bodies is the question about one pair. The whole joint (28 pairs) took 428 ms in the trial, so "where is it tight" is one call, and the same shape as the collisions.
- **A search distance, `within`**, 5 mm by default. Pairs further apart are counted in `apart` and not measured. It is what keeps the question about all pairs fast and its answer short; a single pair that is further apart is asked again with a larger distance. Two bodies whose boxes are further apart than `within` do not go to the kernel at all.
- **Bodies that intersect** have no gap: the distance is zero. The query then asks `interference` about that pair (its `run`, with the same context) and says what kind of zero it is in `contact`: `collision`, `fit`, `touching`, or `unknown` when the kernel could not compute what they share. A distance no larger than the precision of the coordinates (`coordinatePrecision` of 1b: a millionth of the largest coordinate of the pair, the measure `interference` uses) counts as zero.
- **Where the gap is**, for a distance above zero: the two points and the face each lies on (`between`), from the pass of 1b told to look within the distance the kernel measured. Where a closest point lies on an edge of a body, the face named is the one that faces the other body most directly: for the planet and the carrier pin that is the wall of the bore, `planetHole/side/ph`, not the cap of the planet the bore ends in. This is what makes the number usable: it points at the feature to change.
  - A gap above zero always says where it is; the type of a pair has either `contact` or `between` with `accuracy`. Should the pass find nothing within the kernel's distance (the two compute in different precision), it runs again without a limit, and two meshes that are not empty always have a closest pair of points.
  - `distance` is the kernel's number. In every pair of the joint that was tried the pass gave the same.
- **How exact it is**: `accuracy` is the estimate of 1b (`meshAccuracy`): one chord tolerance of the document for each of the two bodies that has a face which is not planar, plus the precision of the coordinates. The joint showed it: 0.1405 measured against 0.15 designed. It is an estimate, not a bound (the caps on segments; see 1b), and it does not look at which face the gap ends on: a planar face of a body with round faces may end in the polygon of an arc.
- **One pair the kernel refuses** is listed in `failed` with the kernel's reason and the others are still answered, as in the report of collisions. Only the call of the kernel is guarded. Anything else that throws inside the query is a defect and passes through, as the shared contract asks.
- **The size of the answer** is limited by `maxPairs` (50 by default): the list of pairs (the closest first) and the list of refused pairs each hold at most that many. `close` and `refused` say how many there are, and `truncated` that a list was cut.
- **The work** is bounded by the arguments: every pair among `bodies` is examined, each within `within`. The summary of the query says that the time grows with both. `maxPairs` limits the answer, not the work.
- The answer for a pair is remembered by its two meshes (`context.memo` with both solids as owners; the key holds the search distance and the chord tolerance, which `accuracy` reads). The tolerance in the key is a guard, not a need of today: a document with other settings is replayed from its first feature (`evaluate.ts` keys the start of the replay by the settings object), so no solid outlives its tolerance, which `interference.ts` relies on as well.

Everything about a body is read from the context, so the query answers at `at`, over `after` (stepping a parameter and reading the gap at each step) and, with package 5a, in a pose.

**Deferred.**

- The gap between two groups of bodies (two links of a mechanism): package 5a asks pairs across the groups.
- A sweep of a parameter in one call. Through MCP it is `after` once per step today.
- The gap between two faces: that is `measure` of 1b.
- The thinnest wall inside one body: another question (a distance between faces of one body that look away from each other), not answered by a gap between bodies.
- Reusing the objects of the library between the pairs of one call (a third of the time of a pair is building them). It would need a port that takes many solids at once; to consider if a model with many bodies makes the query slow.

## Where it lives

```
packages/engine/src/
  types.ts             SolidKernel.minGap, with the guarantee as its comment
  queries/gap.ts       the entry: the pairs, the boxes, the kernel, the contact, the two points
packages/kernel-manifold/src/index.ts   minGap of the adapter
packages/app/src/queries/gap.ts         the view
```

Tests: the table above becomes tests of the adapter (`packages/kernel-manifold/test`), the guarantee point by point; the scenario part goes to `packages/scenarios`. The three fakes of the port in tests get the method (two pass it on, one throws). `docs/architecture.md`, section SolidKernel, gets the method and its guarantee.

## What it adds

| To | What |
|---|---|
| The document | nothing |
| Commands | none |
| `Queries` | `gap` |
| Issue codes | none |
| The kernel port | `SolidKernel.minGap(a, b, within): number` |
| MCP | nothing by hand: the tool `query` reaches it |

The kernel port is a shared place of the plan (1c and 3d write there). This package adds one method and does not touch `boolean` or `triangulate`.

## What the app shows

The generic form of 1b with a view of its own (`QUERY_VIEWS.gap`; `calls.ts` writes it):

- the pairs as rows, the closest first, each with its distance and accuracy or its kind of contact;
- the pairs the kernel refused, with its reason, and a line that says when a list was cut. The view replaces the tree of the answer, so nothing else would show them;
- a picked row draws its two bodies in the two colours of a picked collision and joins the two points of the gap by a line with its length;
- the status bar says how many pairs are within the search distance, how many further apart and how many could not be measured.

It is the collisions view with one line more in the scene.

## Needs from the preparatory step

- **How a package adds to the kernel port.** Nothing is missing in the types: `SolidKernel` is an exported interface of the engine, and this package merges its method into it (`declare module '…/packages/engine/src/types'`), so `context.kernel.minGap(…)` compiles in every draft checked together with this one. (The second version said a draft cannot do that and cast the kernel to a type of its own; a reviewer showed that it can.) What is missing is a word in the shared contract that this is the way: the six maps are named there, the ports are not. Two things that word should carry:
  - An addition is declared as a property, not in method syntax. Package 3d adds to the port as well; two methods of one name with different signatures would merge as overloads without a complaint, two properties are an error (TS2717). This package declares `minGap` that way.
  - The merge changes the port for the whole program it is loaded into. The joint check of the drafts passes because it holds only the sources of the engine and the drafts. A draft that builds a kernel, or imports the adapter or one of the fakes in tests, does not compile until that code has the method. A passing draft check therefore says nothing about the implementations of the port; they are the work of the implementation (the adapter, three fakes).
- It uses the stand-ins of 1b: the units of a result, and `failed` with the path of the argument where the mistake is the caller's (a list of `bodies` that names one body twice and nothing else).

## Rejected

- **No change of the port: the pass of 1b alone.** A real alternative, and the one to fall back to if the port should stay as narrow as it is. The pass finds the distance of two meshes as well as the kernel does, and as fast on the joint; it answers zero when the surfaces cross. What it does not see is a body that lies wholly inside the material of another: no surfaces are near and the distance comes out positive. That case can be told without the kernel, by testing whether a vertex lies inside the other body (counting the crossings of a ray), since surfaces that do not cross leave only "apart" and "one inside the other". One vertex of each connected piece of each body has to be tested: a body may be several pieces (an extrusion of two regions is one body), and one of them may lie inside the other body while the vertex tested lies outside.

  The port method is kept, on one firm reason and one open question:
  - A point-in-solid test is new numeric code with its own hard cases (a ray through an edge or a vertex; the pieces of a body), where the library has a tested answer to "do they share a volume".
  - Speed is an open question, not a reason. For a pair with a gap above zero the query runs the pass anyway, to find the two points, so such a pair costs the kernel call and the pass (24 ms and 10 to 60 ms on the joint) where the variant without the port costs the pass alone. The kernel saves the pass for the pairs that turn out apart or at zero. Which wins depends on the model: see "Open".

  What the port method costs, so that the choice can be weighed again: a guarantee of seven points that every kernel has to keep, three fakes in tests, a change in a place shared with 3d, and two sources for one number (the kernel's distance and the points of the pass, with a second run of the pass when they disagree).

  **A second variant without a port method, raised in the last review and not weighed before: the pass for the distance, and `interference` for containment.** The tested answer to "do they share a volume" is already behind the port as it is: `boolean('intersection')`, which `interference` wraps and remembers per pair of meshes, and which this design calls anyway for every pair at zero. The variant: the pass of 1b gives the distance; where it is above zero and the boxes of the two bodies overlap, `interference` is asked whether they share a volume (zero and `collision` if so). No ray test, no new method, no guarantee of seven points, nothing in the place shared with 3d.
  - It has to be every pair whose boxes overlap, not only a pair with one box inside the other, as the reviewer put it: a body may be several pieces, of which one lies inside the other body while the box of the whole does not. On the joint that is 13 of 28 pairs, against the 18 pairs within 5 mm that go to `minGap` in this design; one `interference` of such a pair took 17 to 24 ms cold, one `minGap` 24 ms (the reviewer's run on the joint, for the five pairs with one box inside the other; not rerun by the author).
  - For a pair whose distance is above zero the surfaces do not touch, so that boolean runs on separated surfaces, not on the flush faces the port gives no guarantee for.
  - What it costs: the pass for every pair whose boxes are within the search distance, also those that turn out apart (the kernel answers those without the pass); and the distance of a pair is then only the engine's number.

  This variant removes the one firm reason above and leaves speed. It was found in the third and last review round, too late to rebuild the design on it without a review of the result, so the design stays with the port method and names this as the choice to make before 1c is implemented (see "Open"). If it is taken, what changes is `gapOf` (no kernel call, a box test and `interference` instead), the seven guarantees and the port section go, and the answer, the arguments and the view stay as they are.

  Two reasons given in earlier versions did not hold and were dropped after reviews: that telling containment needs a boolean intersection for every pair whose boxes overlap (the first version), and that with `minGap` one library decides what touching means (the second: zero is decided by the engine's own threshold and the kind of contact by `interference`, in either variant).
- **The port returns the two points as well.** Manifold does not give them; an adapter would have to find them itself, which is the pass the engine has anyway, and every other kernel would have to do the same behind the port.
- **A search distance without a default (measure every pair fully).** The cost grows with the distance (5 ms against 339 ms for one pair of the joint), and an answer with a distance for every pair of a large model is mostly numbers nobody asked for.
- **One pair per call (`a`, `b`).** The sketch of the preparatory step. "Where is it tight" would be a call per pair, with the list of pairs made up by the caller; the collisions already have the other shape.
- **A gap of zero without `contact`.** An AI that reads 0 between the motor and the plate cannot tell a seating face from a collision and would have to ask `interference` itself every time.
- **An error for a pair that intersects.** The pair is in a list with others; one collision must not cost the answer about the rest.
- **The cap of the body as the face of a gap at a rim** (the first triangle found). True and useless: the feature to change is the bore.

## Open

- How the time grows with the number of bodies. A model of fifty bodies has 1225 pairs; the boxes cut most of them, but the trial has only the eight bodies of the joint. If it is too slow, the fallback is a limit on the pairs sent to the kernel, with the rest counted as not examined.
- **Whether the port method earns its place: decided by the owner on 2026-11-15.** The port stays as it is. The gap is the pass of 1b (`closest`), and a body that lies wholly inside another is told by `interference`, not by a method `minGap` and not by a point-in-solid test. The first step of the implementation is the measurement this item proposed, on a model with many pairs of bodies that are near and apart; `minGap` is taken only if the variant without it comes out noticeably slower. Where this design speaks of `context.kernel.minGap`, read the pass until that measurement says otherwise.
- Whether `fit` and `collision` should carry the depth of the overlap as well. Today the caller asks `interference` for it.

## Reviews

### Round 1 (2026-11-15): first version

Two independent reviewers, read-only, at commit `b2fdf2d`: `codex` (gpt-6-astra, effort high) and an internal subagent; `agy` did not take part (out of quota). Who they were, what they covered and the findings on the track as a whole are recorded in [1b](../1b-measure/design.md). The internal reviewer reran the whole table of `minGap`, the 28 pairs and the rule that names the face, and got the same. The findings on this package, each checked against the code:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The `try` around the whole of a pair turns a defect (in the pass, in the memo, in the nested query) into "the kernel refused", against the rule that a defect passes through | both (codex: major) | Yes (`00-prep/contract.ts`, "An exception of another kind inside `run` is a defect") | Only `kernel.minGap` is guarded; `interference` reports its own refused pairs |
| `accuracy` counts the two faces named, so a planar cap that ends in the polygon of a rim counts as exact; and it is not a bound above the caps on segments | both | Yes | `meshAccuracy` of 1b: per body with a face that is not planar; called an estimate |
| A gap above zero may come without `between` and `accuracy`, which `returns` and the scenario promise | codex | Yes: the optional fields let it compile | The type of a pair is `contact` or `between` with `accuracy`; the pass runs again without a limit; a pair written without the points does not compile |
| `failed` is not limited by `maxPairs` and can grow with the square of the bodies; `maxPairs` does not limit the work | codex (major) | Yes for the list. The work is bounded by `bodies` and `within`, which are arguments | `failed` holds at most `maxPairs`; `close` and `refused` count; the summary says what the time grows with; a limit on the pairs examined is the fallback under "Open" |
| The reason for rejecting "no change of the port" is wrong: containment can be told by a ray, with no boolean | internal | Yes | The alternative is weighed again and the reasons restated; it is named as the fallback |
| The cast of `context.kernel` is a gap of the shared contract, not recorded | internal | Yes | Recorded under "Needs" |
| The view never lists `failed`, and draws both bodies in one colour | both | Yes | The view lists the refused pairs and the cut, and uses the two colours of the collisions |
| The precision of the coordinates is computed here by its own formula | internal | Yes (the same value, a second copy) | `coordinatePrecision` of 1b |
| Factual: one of the three fakes of the port does not wrap a real kernel | both | Yes (`packages/engine/test/review.test.ts:139-144`) | Corrected |
| The engine side needs 1b, which the plan does not show | both | Yes | Stated at the top; the table is in 1b |

Not acted on: a limit on the number of pairs examined (codex, part of the finding on limits). The pairs are those of the bodies the caller names, and the eight bodies of the joint take 0.4 s; left under "Open" with its fallback.

### Round 2 (2026-11-15): the fixes of round 1

`codex` and a new internal subagent, on what the fix commit `7f03434` changed; `agy` did not take part (out of quota). The round as a whole is recorded in [1b](../1b-measure/design.md). Both confirmed that only the kernel call is guarded, that a pair cannot be written without its points, and that `close`, `apart`, `refused`, `checked` and `truncated` add up; the internal reviewer reran the pass that finds the points. The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| "A draft can neither edit nor merge into `SolidKernel`" is false: the interface can be augmented, and `context.kernel.minGap` then needs no cast | both (factual) | Yes (tried here: the drafts type-check) | The method is merged into the port; `SolidKernelAfter` and the cast are gone; the need is narrowed to a word in the shared contract, with the note on overloads |
| Two of the three restated reasons for the port method do not hold: the query runs the pass for every open pair anyway, so the kernel is not the faster path there; and zero is decided by the engine's threshold and by `interference` in either variant | internal | Yes (the code of `gapOf`; the reviewer's rerun: 10 to 60 ms for the pass against 24 ms for the kernel call) | One reason is kept (a point-in-solid test is new numeric code), speed is stated as an open question with the measurement that would settle it, the third reason is dropped, and the costs of the port method are listed |
| The containment test of the variant without the port tests one vertex of each body; a body may be several pieces | codex | Yes (`buildPrism` takes several regions into one body) | One vertex of each connected piece |
| The accuracy of the scenario is 0.02 plus the precision of the coordinates | both | Yes | 0.0200515 in the comment |

Changed with it, asked by no reviewer but raised as unchecked by one: the chord tolerance is in the key of the memory of a pair, because `accuracy` reads it. (The reason first given for it, that a body of only planar faces may be the same solid after the tolerance changes, was false; see round 3.)

Not acted on: nothing. Whether the port method is the right choice stays open on purpose; the design says what would decide it.

### Round 3 (2026-11-15): the fixes of round 2, the last round

`codex` and a fresh internal subagent read only what the second fix commit (`bc6a44c`) changed; `agy` did not take part (out of quota). By the rule of the project this is the last round; what is still open after it is recorded here as a known limit. Neither found a blocker. Both confirmed that the augmentation types the method in every draft, that the key of the memory is complete, and the two accuracies of the scenarios. The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The reasons for the port method are weighed against one variant only. The tested answer to "do they share a volume" is already behind the port: the pass for the distance and `interference` for containment need no new method | internal (major; input to the open decision) | Yes, with one correction: it has to be every pair whose boxes overlap, not only one box inside the other, because a body may be several pieces | The variant is written out and weighed under "Rejected"; the open item names it and the measurement; the head of this document says that the choice is open. **Not changed: the design itself still uses the port method** |
| "A body of only planar faces may be the same solid after the tolerance changes" is false: other settings replay the document from its start and every solid is rebuilt | both (factual) | Yes (`evaluate.ts:227-228`; `interference.ts` relies on it) | The tolerance stays in the key as a guard; the reason is corrected here and in `calls.ts` |
| The augmentation changes `SolidKernel` for the whole program; a draft that builds a kernel or imports the adapter or a fake would fail until that code has the method. And "overloads, not an error" holds only for method syntax | both | Yes (the reviewer's probes: TS2739 for a fake, TS2717 for a second property) | The method is declared as a property; both points are in the contract and in the need |

**Known limit after the last round:** the choice between the port method and the variant with `interference` is not made. It needs the measurement named under "Open", on a model larger than the joint, and it should be made before 1c is implemented; taking the variant changes `gapOf` and removes the port section, nothing else.

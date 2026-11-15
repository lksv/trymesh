# 1c Smallest gap between bodies

**Decision D40. State: designed, not implemented; second version, after one round of reviews.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario, the entry and the view as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

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
- The answer for a pair is remembered by its two meshes (`context.memo` with both solids and the search distance in the key).

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

- **A place for additions to the kernel port.** The six maps of the contract cover the unions of `types.ts`; `SolidKernel` is an interface of the engine that a draft can neither edit nor merge into. The case: `context.kernel.minGap(…)` does not compile, so the entry casts the kernel to a type of this package (`SolidKernelAfter`). Package 3d adds to the port as well and will write a "port after" of its own, and the joint type check of the drafts compares the two with nothing. Proposed: the port after the preparatory step as an interface of the shared contract (`SolidKernelAfter`, the type of `QueryContext.kernel`), which a package extends by declaration merging.
- It uses the stand-ins of 1b: the units of a result, and `failed` with the path of the argument where the mistake is the caller's (a list of `bodies` that names one body twice and nothing else).

## Rejected

- **No change of the port: the pass of 1b alone.** A real alternative, and the one to fall back to if the port should stay as narrow as it is. The pass finds the distance of two meshes as well as the kernel does, and as fast on the joint; it answers zero when the surfaces cross. What it does not see is a body that lies wholly inside the material of another: no surfaces are near and the distance comes out positive. That case can be told without the kernel, by testing whether one vertex of each body lies inside the other (counting the crossings of a ray), since surfaces that do not cross leave only "apart" and "one inside the other". It was rejected for three reasons, none of them that it cannot work:
  - The pass is quadratic in the worst case and only its coarse step keeps it fast (an open item of 1b). The kernel keeps a tree over the triangles, and the query asks about every pair of bodies, later at every step of a pose (5a).
  - A point-in-solid test is new numeric code with its own hard cases (a ray through an edge or a vertex), where the library has a tested one.
  - What "touching" means would then be decided by two passes of the engine and, for the kind of contact, by the kernel in `interference`; with `minGap` the same library answers both.

  The first version of this design gave a wrong reason here (that telling containment needs a boolean intersection for every pair whose boxes overlap); a reviewer corrected it.
- **The port returns the two points as well.** Manifold does not give them; an adapter would have to find them itself, which is the pass the engine has anyway, and every other kernel would have to do the same behind the port.
- **A search distance without a default (measure every pair fully).** The cost grows with the distance (5 ms against 339 ms for one pair of the joint), and an answer with a distance for every pair of a large model is mostly numbers nobody asked for.
- **One pair per call (`a`, `b`).** The sketch of the preparatory step. "Where is it tight" would be a call per pair, with the list of pairs made up by the caller; the collisions already have the other shape.
- **A gap of zero without `contact`.** An AI that reads 0 between the motor and the plate cannot tell a seating face from a collision and would have to ask `interference` itself every time.
- **An error for a pair that intersects.** The pair is in a list with others; one collision must not cost the answer about the rest.
- **The cap of the body as the face of a gap at a rim** (the first triangle found). True and useless: the feature to change is the bore.

## Open

- How the time grows with the number of bodies. A model of fifty bodies has 1225 pairs; the boxes cut most of them, but the trial has only the eight bodies of the joint. If it is too slow, the fallback is a limit on the pairs sent to the kernel, with the rest counted as not examined.
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

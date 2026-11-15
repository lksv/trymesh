# 1c Smallest gap between bodies

**Decision D40. State: designed, not implemented.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario, the entry and the view as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

Validation scenario 11 (the queries asked about the robot joint of scenario 9), this package's part: the gap between a planet and the carrier.

It uses the pass over two meshes of [1b](../1b-measure/design.md) (`closest`) and, in the app, the generic form of a query designed there.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md): the smallest distance of bodies, to verify a clearance (the motor in its housing is meant to have 1 mm) and not only that parts do not run into each other; for the pose of a mechanism, the smallest gap at each step. "To verify first" notes that the kernel port has only `boolean` and `triangulate` and that every further operation of Manifold extends it. The brief adds: Manifold has `minGap`.

- **The port** (`SolidKernel` in `types.ts`) has `boolean` and `triangulate`. The adapter (`packages/kernel-manifold/src/index.ts`) builds a `Manifold` from a `Solid` (`toManifold`), checks its input first (`inputProblem`: closed, not inside out, face numbers in range), and frees the objects of the library by hand.
- **`minGap(other, searchLength)` of Manifold 3.5.5** is documented in one sentence: the minimum gap between two manifolds, a number between 0 and `searchLength`. What it does was tried on the model of scenario 9 and on crafted cubes (the script is kept outside the repository):

  | Case | Answer |
  |---|---|
  | planet and carrier, search 10 | 0.140453 (0.15 by design: the pin 5 in the bore 5.3; both are inscribed polygons) |
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
- **Three fakes of the port** are written as object literals in tests (`packages/engine/test/review.test.ts`, `packages/scenarios/test/bodies.test.ts` and `extent.test.ts`). A method added to the port has to be added to them; each passes it on to the real kernel.

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
- **Bodies that intersect** have no gap: the distance is zero. The query then asks `interference` about that pair (its `run`, with the same context) and says what kind of zero it is in `contact`: `collision`, `fit`, `touching`, or `unknown` when the kernel could not compute what they share. A distance no larger than the precision of the coordinates (a millionth of the largest coordinate of the pair, the measure `interference` uses) counts as zero.
- **Where the gap is**, for a distance above zero: the two points and the face each lies on (`between`), from the pass of 1b told to look within the distance the kernel measured. Where a closest point lies on an edge of a body, the face named is the one that faces the other body most directly: for the planet and the carrier pin that is the wall of the bore, `planetHole/side/ph`, not the cap of the planet the bore ends in. This is what makes the number usable: it points at the feature to change.
- **How exact it is**: `accuracy` is one chord tolerance of the document for each of the two faces that is not planar. The joint showed it: 0.1405 measured against 0.15 designed.
- **One pair the kernel refuses** is listed in `failed` and the others are still answered, as in the report of collisions.
- **The size of the answer** is limited by `maxPairs` (50 by default, the closest first), with `truncated`.
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

Tests: the table above becomes tests of the adapter (`packages/kernel-manifold/test`), the guarantee point by point; the scenario part goes to `packages/scenarios`. The three fakes of the port in tests get the method. `docs/architecture.md`, section SolidKernel, gets the method and its guarantee.

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

The generic form of 1b with a view of its own (`QUERY_VIEWS.gap`; `calls.ts` writes it): the pairs as rows, the closest first, each with its distance and accuracy or its kind of contact; a picked row highlights its two bodies and joins the two points of the gap by a line with its length; the status bar says how many pairs are within the search distance and how many further apart. It is the collisions view with one line more in the scene.

## Needs from the preparatory step

None of its own. It uses the stand-ins of 1b: the units of a result, and `failed` with the path of the argument where the mistake is the caller's (a list of `bodies` that names one body twice and nothing else).

## Rejected

- **No change of the port: the pass of 1b alone.** The pass finds the distance of two meshes that do not cross as well as the kernel does, and as fast on the joint. What it cannot tell is a body that lies wholly inside the material of another: no surfaces are near and the distance comes out positive. Telling that needs a volume, so the engine would call `boolean('intersection')` for every pair whose boxes overlap (in a coaxial assembly that is most pairs). That intersection is the one the port gives no guarantee for with flush faces: it is cleaned, verified, and may fail, and then the pair would have no distance at all. `minGap` of the library does its own raw intersection only to see whether it is empty. So the port is extended, and the pass is used for what the kernel does not give: the two points.
- **The port returns the two points as well.** Manifold does not give them; an adapter would have to find them itself, which is the pass the engine has anyway, and every other kernel would have to do the same behind the port.
- **A search distance without a default (measure every pair fully).** The cost grows with the distance (5 ms against 339 ms for one pair of the joint), and an answer with a distance for every pair of a large model is mostly numbers nobody asked for.
- **One pair per call (`a`, `b`).** The sketch of the preparatory step. "Where is it tight" would be a call per pair, with the list of pairs made up by the caller; the collisions already have the other shape.
- **A gap of zero without `contact`.** An AI that reads 0 between the motor and the plate cannot tell a seating face from a collision and would have to ask `interference` itself every time.
- **An error for a pair that intersects.** The pair is in a list with others; one collision must not cost the answer about the rest.
- **The cap of the body as the face of a gap at a rim** (the first triangle found). True and useless: the feature to change is the bore.

## Open

- How the time grows with the number of bodies. A model of fifty bodies has 1225 pairs; the boxes cut most of them, but the trial has only the eight bodies of the joint.
- Whether `fit` and `collision` should carry the depth of the overlap as well. Today the caller asks `interference` for it.

## Reviews

Not reviewed yet.

# 1d Mass properties

**Decision D41. State: implemented on the branch `d36/1d` (the query `mass`; in the app the generic form of a query); see "As implemented" at the end, which says where the code differs from the text below. The design is in its third version, after three rounds of reviews.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario and the entry as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

Validation scenario 11 (the queries asked about the robot joint of scenario 9), this package's part: the mass of the carrier beyond the output.

In the app it is reached through the generic form of a query of [1b](../1b-measure/design.md); it has no view of its own.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Candidates the table above does not have": mass (volume, density, fill factor), centre of mass, moments of inertia; for an arm, the torque a joint has to hold is the mass beyond it times the lever; the same kind of integral over the mesh as the volume. "Export for simulation" adds what the robot description needs per link: a mass, a centre of mass and an inertia tensor, with the link frame in the orientation of the model; that the inertia assumes a uniform density, so that a printed part with shells and infill has an effective density or a weighed mass; and that a bought part has the mass of its data sheet.

- **The volume** is summed by signed tetrahedra from the origin (`volumeOf` in `solid.ts`) and published per body (`BodyResult.volume`). The first and second moments are the same sum with other integrands; nothing else is needed, and no kernel.
- **Units.** The preparatory step adds `g` and `g/cm3` to the units of a number (`QuantityUnit`), so a density is an argument with a unit and a range. It has no unit for an inertia; the answer states it in `returns`.
- **No body has a density today.** Body properties and the catalog of materials are package 3a, designed at the same time on another track.
- **An axis** is an `AxisRef` (a base axis, or the normal of a sketch plane through a sketch point); the context resolves it (`context.axis`).
- **Measured on the model of scenario 9** by a prototype of the pass (kept outside the repository): the integrals of a body take 2 ms. The carrier has 14863.496 mm³, the number the engine publishes; with exact circles it would be 14873.478, so the inscribed polygons cost 0.07 % at the chord tolerance 0.01 mm. Its centre of mass is at z = 48.569 against 48.567 computed by hand, and its second moment about the axis differs from the one computed by hand by 0.1 %.

## The cheap variant

One query, `mass`, over a list of bodies taken as one rigid piece.

**The density is an argument, and stays one.** Three sources, in this order for each body:

1. `densities`, a record by body ID in the call;
2. the body's own, from the document, once body properties exist (3a);
3. `density`, one number in the call for every body that has neither.

A body with none of the three fails the query, with the path of `density`. Today the second source is empty, so `density` (or `densities`) has to be given. When 3a arrives the arguments and the shape of the answer stay: `density` becomes the fallback for bodies without a property, and `densities` the way to ask "what would it weigh in another material" without touching the document. What a call answers can change, though: a body that gets a material in the document no longer takes `density`, and with it no longer `fill` (below).

- `densities` is read by its own keys only. A body may have an ID that every object has by inheritance (`constructor`); the engine guards its own records by ID the same way (`has` in `util.ts`, used by `lookup` in `evaluate.ts`).
- **How the two packages meet** is one function, `massSourceOf(context, body)`, which returns undefined for every body until 3a makes it read its section of the document. It reads the document through the state of the context, which is allowed: a density is not geometry of a body. It may answer with a density or with an explicit mass (a motor with a data sheet); a body with an explicit mass counts with the density that gives it that mass, spread evenly. Package 3a edits this one function, so its commit comes after this package; the plan lets 3a start on its own, and the two meet here.
- **The fill factor** (`fill`, above 0 up to 1, 1 by default) goes with `density`: it multiplies the density of the bodies that take the fallback, and of no other. A density given by body in `densities` is taken as it is (the motor of the scenario, or an effective density measured on a printed sample), and so is whatever the document will say about a body (3a). The first version multiplied every density by it, which made the motor of a link lighter when the printed parts were sparse.
  - It assumes the material is spread evenly through the part; a real print has solid shells and a sparse core, so the mass is roughly right and the inertia is too low. The description of the argument says so and points at an effective density.
  - The answer lists, for each body, the density of its material and the fill factor that was applied, so the mass can be checked: in the units of the answer, mass (g) = density (g/cm³) × fill × volume (mm³) / 1000.
  - A `fill` other than 1 that applies to no listed body is refused (`failed`, with the path of `fill`), not ignored. Otherwise the same call (the carrier, `density: 1.24`, `fill: 0.4`) would answer 7.372 g today and, without a word, 18.431 g once the carrier has a material in the document. With some bodies taking the fallback and some not, the fill factor of each body in the answer says which.

**The frame of the inertia: about the centre of mass, in the axes of the model.** It is the tensor a robot description takes as it is, when the frame of a link keeps the orientation of the model (the proposal of the backlog). It does not depend on where the origin of the model is, and it is what the parallel axis theorem starts from. It is returned as three rows, so there is no question which sign an element off the diagonal has: it is the element of the tensor, the negative product of inertia, as URDF and MJCF write it.

**The moment about a given axis** (`about`, an `AxisRef`) is added when asked: the moment of inertia about that axis and the perpendicular distance of the centre of mass from it. The moment is the number the backlog names for an arm (what turns about the joint), and with the tensor alone a caller would have to do the parallel axis theorem by hand, which the backlog itself calls easy to get wrong.

- The distance is geometry only. It is not the lever of the weight about the axis: that depends on the direction of gravity as well (a centre of mass straight above a horizontal axis is at a distance and has no lever). The torque a joint has to hold is computed by the caller from the mass and the centre of mass, which the answer has, and the direction of gravity, which the model does not have.

**A group of bodies as one link** is the list `bodies`: masses, first moments and second moments add up, each body with its own density, and the tensor is taken about the common centre of mass. The answer also lists each body by itself (mass, volume, the density of its material, the fill factor applied, its centre of mass). Bodies that overlap are counted twice; the query does not look for overlaps, `interference` does.

**Units**: millimetres and grams, so an inertia is in g·mm². `returns` gives the factor to kg·m².

Everything about a body is read from the context, so the query answers at `at`, over `after` and in a pose: the centre of mass and the tensor of a link are then where the pose puts it. The axis of `about` is not posed (a base axis, a sketch point), by the rule of the preparatory step.

**Deferred.**

- Principal moments and axes (the eigenvectors of the tensor). MJCF and URDF take the full tensor.
- The tensor about another point or in another frame than the model's. `about` covers the one case the backlog names.
- The torque of the weight about an axis: it needs a direction of gravity, which nothing in the model gives. It comes with the mechanism (5a) if at all.
- A density per body in the document, a catalog of materials, an explicit mass: package 3a.
- The mass of the material of a print (shells, infill pattern, supports): a slicer's answer.
- Mass in the model panel of the app next to the volume: it needs the density of 3a to be worth showing.

## Where it lives

```
packages/engine/src/
  queries/mass.ts      the entry: the densities, the sums, the tensor, the axis; massIntegrals; massSourceOf
```

`massIntegrals(solid)` is one pass over the triangles and is remembered by the mesh (`context.memo` with the solid as the owner), so asking about a link again after a change elsewhere in the model costs nothing.

## What it adds

| To | What |
|---|---|
| The document | nothing |
| Commands | none |
| `Queries` | `mass` |
| Issue codes | none |
| MCP | nothing by hand: the tool `query` reaches it |
| For 3a | `massSourceOf`, the one place where the density of a body from the document enters |
| For 5b | the tensor in the frame the robot description takes |

## What the app shows

The generic form of 1b: the bodies as rows, the density and the fill factor as number fields with their units, the axis from a choice; the answer as a tree. No view of its own: the numbers are the answer, and there is nothing to draw that a marker at the centre of mass would not overstate. The units of the result are in `MASS_UNITS` (see the need of 1b).

## Needs from the preparatory step

- **A unit for an inertia.** `QuantityUnit` has no `g·mm2`. No argument needs it; a result does, once results have units (the need recorded in 1b). Until then the stand-in `ResultUnit` of 1b carries it.
- Otherwise it uses the stand-ins of 1b: `failed` with the path of the argument where the mistake is the caller's (a body without a density; a fill factor that applies to no body).

## Rejected

- **The tensor about the origin of the model.** It changes when the model is moved and has to be shifted before any use; nobody asks for it.
- **Principal moments only** (three numbers and three axes). Compact, but a robot description wants the tensor in the link frame, and turning principal axes back into it is the kind of transform the backlog wants to take away from the caller.
- **Six named numbers (`ixx`, `ixy`, …).** Two conventions exist for the sign of the mixed ones; three rows of a matrix have one meaning.
- **A required density until 3a, then removed.** Every caller written before 3a would break, and the question "in another material" would lose its argument.
- **A density of the document that wins over nothing or over everything.** If the call's `density` won over a body's own, asking about a link with a bought motor in it would silently turn the motor into plastic; if the document always won, there would be no way to try a material. Hence one argument that is a fallback and one that is an override.
- **Mass as a number in `get_model` next to the volume.** It would need a density from somewhere for every body; it comes back when 3a exists.
- **A check for overlapping bodies inside the query.** It is a boolean per pair, and `interference` is that query.

## Open

- Whether `fill` should be per body. A link of printed parts with different infill can be asked with `densities` as effective densities; a per-body fill factor belongs with the body properties of 3a. Until then a body whose density comes from the document is taken solid, also when it is printed sparse: 3a has to bring the fill factor together with the material, or this rule has to change with it.
- The name of the section and of the fields 3a reads in `massSourceOf`: decided by 3a. This design only fixes that there is one function.

## Reviews

### Round 1 (2026-11-15): first version

Two independent reviewers, read-only, at commit `b2fdf2d`: `codex` (gpt-6-astra, effort high) and an internal subagent; `agy` did not take part (out of quota). Who they were, what they covered and the findings on the track as a whole are recorded in [1b](../1b-measure/design.md). The internal reviewer reran the prototype (14863.496, 48.569, 8256.9, 4242.9) and recomputed 17639 and 37.687 by hand; `codex` computed the volume, the centre and the inertia of the carrier from exact circles and found the mesh numbers consistent with them. Both found the order of the densities, the frame and the signs of the tensor and the factor to kg·m² in order. The findings on this package, each checked against the code:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| `densities[id]` reads inherited properties: for a body with the ID `constructor` and `densities: {}` the override is a function, the mass is NaN and JSON writes null | codex (major) | Yes (the engine guards its own records by ID: `has` and `lookup` in `evaluate.ts`) | The record is read by its own keys; `calls.ts` has the case |
| `fill` multiplies every density, the motor's in `densities` and later the document's; the density reported is the one after `fill` | internal | Yes | `fill` goes with the fallback `density` only; each body reports the density of its material and the fill factor applied |
| "The lever of the weight when the axis is horizontal" is wrong: a centre of mass above a horizontal axis has a distance and no lever | codex | Yes | `distance` is the perpendicular distance, and the design says what the torque of the weight would need |
| 3a is assigned an edit of `massSourceOf` while the plan lets it start on its own | codex | Yes | Stated where the two meet: the commit of 3a comes after this package |

Nothing was left without action.

### Round 2 (2026-11-15): the fixes of round 1

`codex` and a new internal subagent, on what the fix commit `7f03434` changed; `agy` did not take part (out of quota). The round as a whole is recorded in [1b](../1b-measure/design.md). Both found the read by own keys and the rule for `fill` working as written and the numbers of the scenario following from it (14863.496 × 1.24e-3 × 0.4 = 7.372). The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| "Mass = density × fill × volume" is off by a thousand in the units of the answer (g, g/cm³, mm³) | codex | Yes | The equation with its units, in the contract, in `returns` and here |
| "Nothing changes when 3a arrives" is not true for a call with `fill`: once the body has a material in the document, `fill` reaches nobody and is silently ignored | internal | Yes | The sentence is corrected, and a `fill` that applies to no listed body is refused; `calls.ts` has the case |
| The path of "the body has no volume" indexes the list without duplicates, not the argument | internal | Yes | The index of the body in the argument |
| `has` is in `util.ts`, not in `evaluate.ts` | internal (factual) | Yes (`util.ts:70`; `lookup` at `evaluate.ts:111`) | Corrected |

Nothing was left without action. What stays open is under "Open": a body whose density comes from the document is taken solid until 3a brings a fill factor with the material.

### Round 3 (2026-11-15): the fixes of round 2, the last round

`codex` and a fresh internal subagent read only what the second fix commit (`bc6a44c`) changed; `agy` did not take part (out of quota). By the rule of the project this is the last round. Neither had a finding on this package. Both checked and found holding: the equation with its units, written the same in the contract, in `returns` and here, and what the entry computes; the three masses of the scenario (18.431, 7.372, 37.687 g); the test for a `fill` that applies to no body (a body with an explicit mass or its own density has fill 1; a mixed list passes; `fill: 1` and the default pass; a missing density is reported first); the index of a body without a volume in the argument. Nothing changed in this package in this round.

## As implemented

### The engine side (2026-11-15)

`packages/engine/src/query/mass.ts`: the entry `mass` in `QUERIES`, `massIntegrals` and `massSourceOf`; the types and `massIntegrals` are exported from the index of the engine. Tests: `packages/engine/test/mass.test.ts` (the integrals on meshes written by hand, against the formulas of a box and of a tube over regular polygons: far from the origin, turned, two pieces in one mesh, a mesh without a volume), `packages/scenarios/test/mass.test.ts` (the query against the real adapters: one body, several as one piece, the sources of a density, the fill factor, the moment about an axis, a hole, `at`, the errors), three cases of scenario 11 in `scenario11.test.ts`, and the rows of the query in `packages/mcp/test/queries.test.ts`.

**The numbers of the design hold on the joint**: the carrier has 14863.496 mm³ (the volume the engine publishes) and 18.431 g, its centre of mass on the axis at z = 48.569, 8256.9 g·mm² about the axis and 4242.9 across it; the carrier with the three planets has 30393.134 mm³ and 37.687 g, its centre of mass on the axis at z = 44.1905 (the design printed 44.191), and 17639 g·mm² about the axis of the joint; a planet is 20.25 from that axis; the carrier at a fill of 0.4 has 7.372 g. The four bodies of the link take a few milliseconds.

What differs from the design and from `contract.ts`:

- **`massIntegrals` gives the centroid and the second moments about it**, not the first and second moments about the origin of the model. The sums are taken by signed tetrahedra from a vertex of the mesh and the second moments are then moved to the centroid; a group is put together from its bodies by the parallel axis theorem. Summed from the origin, the tensor about the centre of mass is a difference of numbers that grow with the square of the distance of the body from the origin: a box of 10 mm some thousands of metres away (the test) would keep no digit of it (the reviewer redid the sum: 521288 where 1000 is right), and it keeps them all. The answer of the query is the same.
- **A body without a density, and a fill factor that reaches no body, are `invalidArguments`**, with the paths `['density']` and `['fill']`: the code `QueryFailure` got with 1b for arguments that do not go together. The design wrote `failed`, the stand-in of that time. A body without a volume stays `failed`, with the place of the body in `bodies`.
- **No body can be called `constructor`.** The engine refuses an ID that every object has by inheritance for a feature, and the check of the arguments refuses such a key of a record, so the case of the first review cannot be built. The query still reads `densities` by its own keys only (`has`).
- **`units` and `significant` are on the entry**: grams, mm³, g/cm³, millimetres and g·mm²; a tool prints the mass, the inertia and the moment to six significant digits. `fill` has no unit.
- **The messages name the argument** (`bodies: …`, `density: …`, `fill: …`, `about: …`), as the check of the arguments does.
- **A density has an upper bound**, 1000 g/cm³ (osmium has 22.6), and a mass that comes out zero or beyond the largest number is `failed`: a density or a fill factor at the edge of what a number holds would otherwise answer with numbers that are not numbers, which JSON writes as null.
- **The centre of mass of a group is summed from the centroid of its first body**, so one body has exactly its own centroid whatever its density.
- **A density in `densities` for a body that is not listed is allowed** and does nothing: one table of densities can go with several questions. The density each listed body was counted with is in the answer.
- **The directory is `query/`**, as the preparatory step made it, not `queries/`.

**Known limits.**

- A body with an explicit mass (the second kind of `massSourceOf`) has no test: no body has one until 3a, which brings the test with it.
- The integrals are those of the mesh: round faces are inscribed polygons, so a body with round faces weighs a little less than its exact shape (0.07 % for the carrier at the chord tolerance 0.01 mm). The answer does not carry an accuracy.
- A list whose bodies overlap counts the shared volume twice, as designed; the query does not look.

### Review of the engine side (2026-11-15)

One full review by a subagent that did not write the code, read-only, with probes of its own. No serious finding. It derived the integrals over a tetrahedron again and checked them on a general tetrahedron and on an L-shaped prism; it checked the bodies put together, the tensor and the moment about a skew axis through the entry on two boxes turned about general axes, against a quadrature and a sum over voxels; the sign off the diagonal against URDF and MJCF; the units; the rules for the density and the fill factor through the engine; bodies from 1e-44 to 3e37 in size and 8000 m from the origin; the store of results. One round; the fix is small.

| Finding | Held | What was done |
|---|---|---|
| The elements of the tensor off the diagonal were pinned by no test: every body tested had none, and no axis was skew. Two mutations passed all tests: the signs flipped, two elements swapped (moderate) | Yes | Tests over a context written by hand: two blocks set diagonally with different densities, against the formulas of a box and with the numbers and signs written out, and mirrored; the moment about a skew axis given by a direction that is not a unit vector, against a formula that does not use the tensor |
| A density or a fill factor at the edge of what a number holds was answered with NaN (a mass of zero) or with numbers beyond the largest | Yes (five probes) | A density has an upper bound, and a mass that is zero or not finite is `failed` |
| Three branches had no test: a body without a volume (and its place in the argument), an axis that is not in the state, the copy of the remembered centroid | Yes (three mutations passed) | Tests of all three; the axis also through the engine, on a sketch whose face is gone |
| The centre of mass of one body could differ from its own centroid in the last digit, and one test passed by the choice of its fill factor | Yes (26 of 100 fill factors) | The centre is summed from the centroid of the first body; the test runs over the fill factors that failed |
| Negative zeros off the diagonal of the tensor of a block along the axes | Yes | They are zeros |
| "Would keep five digits" (here and in a test) understates what the sum from the origin loses | Yes: not a digit | Corrected |
| The message of a body without a volume did not name its argument | Yes | It does |
| A limit on the time of a few milliseconds of work in scenario 11 | A test with a time limit has failed under load before | Removed |

Not acted on, and why:

- **A density in `densities` for a body that is not listed is ignored** (the reviewer's suspicion: a mistyped but existing ID would take the fallback without a word). Kept, and written down above: a table of densities shared by several questions is the use, and the answer lists the density of every body.
- **The direction of the axis is made a unit vector although `context.axis` only gives unit vectors.** Kept: it costs nothing and the entry does not depend on that promise; it is tested over a context written by hand.

### The app side (2026-11-15)

No view, as designed: the generic form of a query asks `mass` and shows the answer as a tree. Two things changed in the form itself, both for every query:

- **The items of a list keep the key of the list** for their unit and digits (`tree` in `packages/app/src/panels/query.ts`), as the tool `query` rounds them: the rows of the tensor are written in g·mm² to six significant digits. Before, an item was known by its number in the list and had no unit.
- **A list and a record read the draft when a button of theirs is pressed** (`Form.get`, `packages/app/src/queries/controls.ts`). Found in a browser with this query, the first whose form a user fills with two bodies and a record: a body chosen in the first row was thrown away by *Add*, because choosing it does not build the panel again and *Add* wrote the list as it was built. The same held for ✕ and for a new key of a record, and for the lists of bodies of `interference`, `gap` and `section`.

Tested by three recorded steps of the model case of `packages/app/test/app.test.ts` (two bodies and a density by body, the answer with its units, a body left without a density) and a case of `packages/app/test/query-controls.test.ts`; run in a browser (`docs/ui/queries.md`, "Implementation status").

**Not done:** the mass in the model panel next to the volume (deferred by the design until bodies have a density); a marker at the centre of mass.

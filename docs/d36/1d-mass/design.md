# 1d Mass properties

**Decision D41. State: designed, not implemented; second version, after one round of reviews.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario and the entry as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

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

A body with none of the three fails the query, with the path of `density`. Today the second source is empty, so `density` (or `densities`) has to be given. When 3a arrives nothing in the arguments or the answer changes: `density` becomes the fallback for bodies without a property, and `densities` the way to ask "what would it weigh in another material" without touching the document.

- `densities` is read by its own keys only. A body may have an ID that every object has by inheritance (`constructor`); the engine guards its own records by ID the same way (`has`, `lookup` in `evaluate.ts`).
- **How the two packages meet** is one function, `massSourceOf(context, body)`, which returns undefined for every body until 3a makes it read its section of the document. It reads the document through the state of the context, which is allowed: a density is not geometry of a body. It may answer with a density or with an explicit mass (a motor with a data sheet); a body with an explicit mass counts with the density that gives it that mass, spread evenly. Package 3a edits this one function, so its commit comes after this package; the plan lets 3a start on its own, and the two meet here.
- **The fill factor** (`fill`, above 0 up to 1, 1 by default) goes with `density`: it multiplies the density of the bodies that take the fallback, and of no other. A density given by body in `densities` is taken as it is (the motor of the scenario, or an effective density measured on a printed sample), and so is whatever the document will say about a body (3a). The first version multiplied every density by it, which made the motor of a link lighter when the printed parts were sparse.
  - It assumes the material is spread evenly through the part; a real print has solid shells and a sparse core, so the mass is roughly right and the inertia is too low. The description of the argument says so and points at an effective density.
  - The answer lists, for each body, the density of its material and the fill factor that was applied, so the mass can be checked: density times fill times volume.

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
- Otherwise it uses the stand-ins of 1b: `failed` with the path of the argument where the mistake is the caller's (a body without a density).

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

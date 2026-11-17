# 3d Boolean of bodies, subtraction with a clearance, split by a plane (D56)

**State: design, first version, written on 2026-11-17 against `master` at `633a6ca` (every package of steps 1 and 2, 3a, 5a, 5e and 5f merged), with the decisions that depend on the kernel measured against the real library (`manifold-3d` 3.5.5) and the real adapter ("Measured"). Not implemented.** It needs only the preparatory step. It adds two feature types and nothing to the kernel port.

Files: [contract.ts](contract.ts) (the two feature types, the face role, the issue code, the functions of the recompute), [calls.ts](calls.ts) (its part of validation scenario 13).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md): the row "Spojení, rozdělení, zrcadlení a přesun těles" (subtract one part from another, cut a part for printing; new feature types; "the only new thing is that a body may cease to exist"), the row "Subtracting a body with a clearance" ("the clearance needs a 3D offset (`minkowskiSum` in Manifold), speed not measured"), step 3 of the proposed order ("boolean of bodies (union, difference, intersection), subtracting a body with a clearance, splitting a body by a plane (two shells of a link, a part larger than the bed, printing without supports)"), the row "Union and intersection of bodies" of the comparison ("as one feature"), and "To verify first" (every new operation of Manifold extends the port; whether face names survive was not checked; the speed of `minkowskiSum`). The plan ([README.md](../README.md), "Shared places") expects 3d to add a split and an offset to the kernel port.

| Statement | What the code says |
|---|---|
| "New feature types in the registry" | A type is a module in `features/` and a line of `FEATURE_TYPES`; validation of references, the order on the timeline, `updateFeature` and the recompute read the registry. Nothing else is needed for a type that takes bodies: the pattern of a body does so already (`source: { type: 'body' }`, a reference of the kind `body`) |
| "A body may cease to exist; a reference to it is a broken reference like any other" | A step returns the bodies of the state as a record; leaving a key out is all it takes. Every reader looks a body up in the state (`lookup`) and answers `brokenReference`. A command checks a body only structurally (a feature before this one creates a body of that ID, `requireRef`), so a later feature that names a used-up body is a valid command and an error of the recompute, which is the rule for a removed feature too |
| "The kernel port has all three operations" | `SolidKernel.boolean(op, a, b)`, with the assumption that the face numbers of `a` and `b` come from one table. That holds for two bodies of a state. What does not hold is what the adapter was built and tested for: a tool whose numbers the body does not have ("Measured", D) |
| "Splitting needs `splitByPlane`; whether the face names survive was not checked" | A split is two differences with a box that has one face in the plane. The port's difference keeps the names of the body, gives the cut face the number of that face of the box and has the tolerance for flush faces; the library's own `splitByPlane` has none of the three ("Measured", C and D) |
| "The clearance needs `minkowskiSum`" | The library has it and it works, at 2 to 4 ms per triangle of a tool that is not convex, and the faces of the result have no names and no exact surfaces. The engine knows the exact surface of every face (`FaceInfo`), so it can move each face along its own surface, as the profile offset of D44 moves each curve ("Measured", A, B and E) |
| "A split creates a face that later features will want to sketch on" | A planar face needs a name, a `FaceInfo` with an origin and a Y axis, and triangles: the frame of the plane that cut gives the first two. One role, no new kind of surface |
| "What a body made from others inherits" (3a) | `FeatureModule.bodySource` is there for it ("a type that derives a body from another (a mirror, a split) sets it"); the properties of a body are read through the chain of sources from the entries of the document, whether or not the source is still in the model |
| "A link lists bodies" (5a) | A body that is not in the state is `missing` of its link; a body no link lists is in `unassigned`. Both are reported, neither is an error |

## The cheap variant

```ts
interface CombineFeature extends FeatureBase {
  type: 'combine';
  operation: 'union' | 'difference' | 'intersection';
  target: Id;            // changed; keeps its ID
  tools: Id[];           // one or more bodies
  keepTools: boolean;    // false: the tools leave the model
  clearance?: number;    // difference only: mm, above 0
}
interface SplitFeature extends FeatureBase {
  type: 'split';
  body: Id;                        // keeps its ID and one part
  plane: PlaneRef;                 // a base plane, a plane feature, a planar face
  side: 'forward' | 'backward';    // the part that becomes the new body `<id>`
}
```

- **`combine`** is the boolean of finished bodies, all three operations in one type. The target is changed in place, as an extrusion that adds or cuts changes its target; the tools are used up or kept.
- **A clearance** is an optional numeric field of a difference. Every tool is subtracted moved outwards by it: each face along its own surface, corners sharp, the topology of the tool unchanged. A tool that cannot be moved that way (a hole that would close, two parts that would meet) is an error that names the faces.
- **`split`** is a cut that keeps what it cuts off: the body keeps its ID and the part on one side of the plane, the other part is a new body with the ID of the feature. Both get the cut face, a plane a sketch can stand on.
- **Names.** A face keeps the name it had, on whichever body it ends. The faces a tool with a clearance leaves are the faces of the tool with a copy tag of the combine. The cut face is `{ feature, role: 'splitFace' }`.
- **The kernel port stays as it is.**

**Deferred**, and why the design does not block them:

- **A clearance that changes the topology** (round corners, holes that close, slots that fill): the sum of Minkowski of the library, as a second way to move a tool. It would add one member to the port (`offset`) and one face without a description per tool; the faces that lie on a moved face of the tool can keep the names of this design ("Rejected alternatives", 1; the numbers are in "Measured", A).
- **A clearance of a body without exact faces** (an imported mesh of 3b). The move reads `FaceInfo`; a face of a general surface has none.
- **A clearance on some faces only** (a motor that sits on its seat with no gap under it). Today the tool is subtracted from a body that does not reach under it (the scenario does so) or the seat is added again.
- **A combine as a tool a pattern of features repeats.** A pattern of the body first, then one combine with all the copies as tools, does the same (the scenario's four screws).
- **A split of several bodies by one feature, a body per connected piece, a split by a face rather than its plane, by a surface, a trim that throws one part away** (a trim is a cut with a profile that covers it).
- **A body moved outwards as a feature of its own** (a shell is that body less the original).

## Measured

Spike scripts in the session scratchpad (not in the repository), run with `vitest` over the sources of this tree: the real adapter (`createManifoldKernel`), the real solver, bodies built by commands through `createEngine`. The chord tolerance is that of a new document, 0.01. Times are of one machine and are there for their order of magnitude.

The bodies: a block 40 × 30 × 20 (12 triangles); the motor of scenario 13 (a cylinder of radius 14, 332 triangles); a motor like a NEMA 17 (a block 42 × 42 × 34, a boss, a shaft, four blind screw holes of radius 1.5; 900 triangles); the lid and the box of scenario 12 (`box.ts`: the lid with its lip, for E also with the lead-in of 10° and the countersink); the sun gear, the carrier and the housing of the joint of scenario 9 (`joint.ts`; 2076, 916 and 5310 triangles); an L with a pin and a hole across the pin (two cylinders that cross); a C whose tips face each other 0.4 apart; a plate with two pins 0.5 apart; a plate with a slot 0.5 wide.

### A. The sum of Minkowski of the library

`Manifold.minkowskiSum` of each body with a cube of side 2c, an octahedron and a ball (`Manifold.sphere(c, n)`) of 8 and 16 segments, c = 0.3; then the result as the tool of a difference from a block through the adapter. Time of the sum and triangles of its result:

| Body (triangles) | cube | octahedron | ball 8 | ball 16 |
|---|---|---|---|---|
| block (12) | 3 ms, 12 | 0 ms, 44 | 1 ms, 92 | 1 ms, 236 |
| cylinder (332) | 3 ms, 408 | 8 ms, 668 | 14 ms, 1040 | 19 ms, 1910 |
| motor like a NEMA 17 (900) | 5.0 s, 9050 | 2.5 s, 2538 | 4.0 s, 3294 | 7.6 s, 5112 |
| lid, plate and lip (44) | 59 ms, 486 | 54 ms, 174 | 98 ms, 274 | 319 ms, 532 |
| box with its cavity (28) | 31 ms, 290 | 33 ms, 100 | 67 ms, 168 | 166 ms, 328 |
| sun gear (2076) | 4.5 s, 25240 | 2.6 s, 5680 | 4.7 s, 7776 | 9.2 s, 13186 |
| carrier (916) | 1.4 s, 8158 | 1.0 s, 2446 | 1.6 s, 3294 | 3.9 s, 5480 |
| housing (5310) | 7.2 s, 79390 | 4.7 s, 13740 | 8.3 s, 21016 | 17.1 s, 38956 |

- Every sum has the status `NoError`. A convex body takes milliseconds; a body that is not convex 2 to 4 ms per triangle (the library sums triangle by triangle and unites the pieces).
- The difference with the sum as its tool went through the adapter in 1 to 343 ms for the octahedron and the balls (all 24), and for the cube in six of eight (the sun and the housing were refused, "not a closed surface").
- The result has 3 to 7 times the triangles of the body for a ball of 8, and no face of it is a face of the body: one face without a description.
- A ball of n segments is a polytope inside the ball: along directions between its vertices the clearance is short by up to 1 − cos(π/n), 7.6 % for 8.

### B. A scaled copy

The NEMA-like motor scaled about the centre of its box by 1.01429, the factor that gives 0.3 on the faces nearest to that centre by the half sizes (21, 21, 29). Measured from the scaled vertices to the body, by face: 0.43 to 0.59 on the sides of the block, 0.59 on the floor, 0.04 to 0.42 on the shaft, 0.07 to 0.19 on the boss, 0.007 to 0.33 at the screw holes (which move outwards and barely shrink). A scaled copy is not a clearance.

### C. Booleans of two bodies and a split, by hand

Through `kernel.boolean`, on bodies of one engine state:

- **Union**, a ring that stands flush on the link of scenario 13: the sum of the two volumes exactly, one piece, the names of both. A half (an L with a hole) and its mirror image in the plane of its flat side: twice the volume, the faces of the half and the tagged faces of the copy. Two boxes that touch on a side, and two that overlap by half and are flush on four sides: exact.
- **Difference**, the motor out of a block that shares its floor and one side with it (a tool with a boss, a shaft and blind holes): one piece, the names of the motor in the pocket, the flush floor and side open.
- **Intersection** by the port: the ring and the motor (the polygon of the motor times 10), the block and the motor, two boxes that only touch (no triangle), two that overlap by half: all exact. A flush face of the result carries the name of the first operand.
- **A split** as two differences with a box (one face in the plane, the others outside the body by a margin of 5 % of its diagonal, 1 mm at least), ten planes through the NEMA-like motor: across the block; through the axis of the shaft (through vertices of the round faces); flush with the top of the block, where the boss stands; flush with the top of the boss; through the axes of two screw holes; through the floors of the screw holes; tilted by (1, 2, 3); tilted by a thousandth; flush with a side (nothing in front: one part without a triangle); 0.005 inside a side (a slab of 7.1 mm³). In every case the two volumes add up to the body's within 5 · 10⁻⁵ mm³, neither part holds a face of the box other than the cut face, and each is one piece; 7 to 102 ms for the pair. The same for a block with a hole 2000 mm from the origin.

### D. Planes through bodies, and the parts joined again

960 planes: for each of four bodies (the NEMA-like motor, the lid with its lead-in and countersink, the box, an L with a pin and a hole) 60 planes of four kinds: along an axis through a random point, tilted through a random point, along an axis through a vertex of the body (flush with faces, through corners), tilted through a vertex.

- **The split**: 906 planes cut the body (54 pass beside it or leave one part empty). None was refused; no part holds a face of the box other than the cut face; the two volumes add up to the body's within 5.5 · 10⁻³ mm³ (the largest on the box, 22 000 mm³); the slowest pair of differences took 120 ms.
- **The two parts joined again by a union**, as a test of a union of two bodies that share every face number of the body and lie flush on the cut:
  - with the numbers as they are: 71 refused, and **403 of the 835 answered have a wrong volume** (off by more than 0.001 mm³, up to 19 mm³), without a word;
  - with the numbers of one part made its own for the call (every number moved up by a constant): 29 refused, 12 with a volume off by more than 0.001 mm³ (up to 0.16), and the cut face left in 63 (a remnant of 10⁻⁵ to 17 mm²).
  - Of those, planes along an axis: 8 refused (all on the lid, through vertices of its cone and bore), 3 volumes off, the cut face left in 9. The rest are tilted planes.
- The adapter tells the faces of the tool from those of the body by their numbers (`toolIds` in `restoreShifted`), which is why shared numbers break it. Parts cut apart on a tilted plane and joined again are its hardest case: each part got its vertices on the cut from a difference of its own, so they agree only to the precision of the coordinates.

### E. The clearance by faces: a prototype

The move of the cheap variant ("The clearance" below) as a prototype of 400 lines: every vertex moved to where the moved surfaces of its faces meet, planar faces triangulated again, four checks. On twelve bodies with c = 0.2, 0.3, 0.5, 1 and 2: 60 runs. Whatever the checks said, the moved mesh was then subtracted from a block through the adapter and the smallest distance of the pocket to the body measured (`closest` of the engine) as the judge.

| Body | 0.2 | 0.3 | 0.5 | 1 | 2 |
|---|---|---|---|---|---|
| block | 1.000 c | 1.000 c | 1.000 c | 1.000 c | 1.000 c |
| cylinder | 0.999 c | 0.999 c | 0.999 c | 0.999 c | 0.999 c |
| motor like a NEMA 17 | 0.994 c | 0.994 c | 0.994 c | 0.994 c | refused: the screw holes close |
| lid with lead-in and countersink | 0.968 c | 0.979 c | 0.987 c | 0.993 c | 0.996 c |
| box with its cavity | 1.000 c | 1.000 c | 1.000 c | 1.000 c | 1.000 c |
| sun gear | 0.994 c | 0.994 c | 0.994 c | refused: the teeth meet | refused |
| carrier | 0.996 c | 0.996 c | 0.996 c | 0.996 c | 0.996 c |
| housing | accepted | accepted | refused: the teeth of the ring meet | refused | refused |
| L, two cylinders that cross | 0.881 c | 0.883 c | 0.885 c | 0.872 c | refused: the hole closes |
| C, tips 0.4 apart | 1.000 c | refused | refused | refused | refused |
| plate, two pins 0.5 apart | 0.997 c | refused | refused | refused | refused |
| plate, a slot 0.5 wide | 1.000 c | refused | refused | refused | refused |

- **41 accepted, 19 refused.** Every accepted mesh went through the adapter as the tool of a difference, and the pocket is nowhere nearer to the body than 0.968 c, except on the body with two cylinders that cross (0.87 c, on the edge of the two round faces: a chord of both). The housing was not measured (the measure is slow on 5000 triangles); its difference went through.
- **Every refusal is right**: measured on the mesh the checks refused, the pocket was 0.84 c from the body with 184 triangles turned over (the hole across the pin closes), at most 0.70 c in eight others, and in the remaining ten the adapter refused the difference itself.
- For the bodies of up to 1000 triangles the sum of Minkowski with a ball of 12 segments was computed as well: at most 0.24 mm³ of it lies outside the moved body (the body with the crossing cylinders, of 6855 mm³; under 0.1 mm³ elsewhere). The moved body holds the rounded offset, and is larger by the sharp corners (the NEMA-like motor at 0.3: 64 050 against 64 035 mm³).
- Time: the move 0.1 to 16 ms; the planar faces 0.2 to 110 ms (up to 1.3 s on the caps of the sun gear when its teeth nearly meet, inside `triangulate`); the checks 1 to 660 ms (the prototype's grid has string keys). The NEMA-like motor: 50 to 90 ms in all, against 4.0 s for the sum of Minkowski.
- What the first prototype lacked, each found on a real body: the triangles of a planar face do not survive the move when its loops move by different amounts (the carrier and the sun at 0.3, the top of the boss of the motor at 1: triangles turned over although nothing collides); a face thinner than the chord tolerance (the crescents left where the cone of the countersink and the bore, two round faces of one radius, are divided differently) gives a vertex a condition it cannot keep; a test that looks only for triangles crossing does not see two faces that passed through each other and stayed parallel (the tips of the C).

### F. Unions of bodies flush on a tilted plane, as a model makes them

40 bodies with tapered sides (a taper of 2° to 27°, turned and shifted at random). A body and its mirror image in one of its own tilted faces, joined: none refused, the volume right within 1.8 · 10⁻³ mm³, the face in the mirror plane gone in all 40. A block extruded as a new body from a sketch on a tilted face, joined: none refused, the volume right within 4.2 · 10⁻⁴ mm³. In 10 of the 40 a part of the block's start cap is left in the result; there the block hangs over the edge of the tapered face, so that part is a real face, and the same block added by an extrusion with the operation `add` leaves it in the same 10.

### G. An intersection three ways

352 planes through three bodies; the part of the body in front of the plane, known from the split, computed as an intersection with the box:

| Way | Refused | Volume off by more than 0.001 mm³ |
|---|---|---|
| `boolean('intersection')` of the port | 0 | 0 (largest error 1.4 · 10⁻¹¹) |
| A − (A − B), numbers as they are | 70 | 103 (up to 6.8 mm³) |
| A − (A − B), the inner result with numbers of its own | 14 | 2 (up to 0.01 mm³) |

### H. Intersections of bodies that only touch on a tilted plane

The bodies of F. A body and its mirror image (they share nothing): a sliver is left in 5 of 40 (at most 8 triangles, 6 · 10⁻⁴ mm³). A body and the block that stands on its tilted face: in 19 of 40 (at most 1.5 · 10⁻⁶ mm³). A body and its copy shifted along a tilted face (flush on that face and on both caps, a real overlap): right in all 40 within 6 · 10⁻⁴ mm³, one piece.

## Decisions

### Two feature types, not one and not four

A combine takes a target and tools; a split takes a body and a plane and makes a body. They share nothing but the kernel. The three operations of a combine share everything but the word, and a patch that changes the word is the natural edit ("try an intersection instead"). The type is called `combine` and not `boolean`: `boolean` is a validator of `validation.ts` and a word of the language.

### The target keeps its ID; the tools are used up or kept

The alternative is a new body under the ID of the feature, with every operand used up. Rejected: every extrusion that adds or cuts already changes its target in place, and a target that keeps its ID keeps its body properties, its place in a link and every later reference. Only the tools can leave, and whether they do is stated: `keepTools` has no default. A union normally uses its tools up (kept, they would overlap the result for ever); a subtraction of a bought part normally keeps it. Neither is the safe guess for the other.

A used-up tool is not in the state after the feature. That is the one new thing ("a body may cease to exist"), and nothing has to be built for it: a later reference is `brokenReference`, an entry of body properties stays in the document and is listed as an entry without a body (`bodyPropertiesWithoutBody`), a link reports the body as `missing`. A feature in error or suppressed uses nothing up.

### The split is a cut that keeps what it cuts off

The alternative is that the body ceases and two new bodies `<split>/forward` and `<split>/backward` appear. Rejected:

- With the body kept, one part needs nothing: its name, colour, material, mass, link and every later feature that names it stand. The other part is one new body that takes after it. With two new bodies everything that named the body breaks, and the entry of its properties is listed as left without a body although both parts inherit from it.
- The new body gets the ID of the feature, so the author names it (`lower`), as the author names the body of an extrusion.
- It is the composition of what exists: a cut by a half-space, and a body made of what the cut took.

The price is a field that says which part is the new one. A fixed rule ("the part in front") would not do: the normal of a base plane cannot be turned round (XZ points to −Y). The words are those of "through all": `forward` is along the normal of the plane.

A plane that does not cut the body (one part would be nothing) is the error `emptyResult`, not the warning `noEffect` of a cut that misses: the feature promises a body, and what names it would break anyway.

### The kernel port stays as it is

The plan expected a split and an offset on the port. Neither is needed:

- **A split is two differences** with a box that the engine builds (`halfSpaceBox`): one face in the plane, five outside the body. The port's difference keeps guarantee 3 (a plane flush with a face of the body is the adapter's ordinary case), names the cut face by the number of the box's face, and was measured on 906 planes without a refusal. The library's `splitByPlane` has no tolerance for flush faces and numbers the cut face by its own cutter.
- **The clearance is computed in the engine**, because it needs the exact surface of every face, which the engine has and the kernel does not.
- **An intersection is the port's** `boolean('intersection')`. It keeps no tolerance for flush faces (guarantee 3), which shows as slivers where the two bodies only touch on a tilted plane ("Measured", H); the engine drops pieces below the threshold of the collisions (0.001 mm³) and calls an intersection that leaves nothing `emptyResult`. Composing it of two differences, which do keep the guarantee, measured worse ("Measured", G).

### The operands of a boolean of bodies get numbers of their own

Two bodies of a model can share face numbers: the two parts of a split, two bodies cut by one feature, a body and the pocket a kept tool left in another. The adapter was never given such a pair, and a union of one comes out with a wrong volume, silently, in about half the cases tried ("Measured", D). So `booleanOfBodies` replaces every face number of the tool by a temporary one above the table for the call and puts the numbers back in the result. A face that both operands had is one face again afterwards.

This is a rule for the engine, not a repair of the adapter: the port's assumption ("the same number means the same face") still holds, and the adapter keeps being asked what it is tested for.

### The clearance: every face moved along its own surface

The tool moved outwards by c (`movedOutwards`):

- A plane moves along its normal, away from the material; a cylinder and a cone change their radius (a pin grows, a hole shrinks; the apex of a cone moves along its axis by c / sin of its half angle); a swept side (gear teeth) moves triangle by triangle. Every face maps to one face with a surface of the same kind, so the moved faces have exact descriptions and can be named after the faces they come from.
- A vertex goes to where the moved surfaces of its faces meet. That is the mitre of D44 in space: an outer edge stays sharp and is up to 1.41 c from the tool, an outer corner 1.73 c. For a pocket that is the safe side.
- The topology never changes: the same vertices, the same faces, no face added or lost. What would change it is refused (`invalidClearance`), with the faces named: a hole no wider than twice the clearance, two parts of the tool nearer than twice the clearance.

This is the rule of the profile offset (D44: "computed per curve, not on the polyline … the cheap variant does not change topology"), one dimension up, for the same reasons: names and exact surfaces survive, and it costs milliseconds where the general operation costs seconds. And as there, the general operation of the library stays the route for the full variant.

The owner's question behind this choice is in "Open".

### Names of the faces

- **Without a clearance** a triangle inherits the name of the face it comes from, as in every boolean. The pocket a motor leaves in a mount has the names of the motor's faces; with the motor kept, such a face lies on two bodies, which a cut through two targets does already. Flush faces follow the rule of the adapter (the overlapped part carries the name of the tool's face; for an intersection that of the target's).
- **With a clearance** the faces the tool leaves are not where the tool's faces are, so they are faces of their own: the name of the tool's face with a copy tag appended, `{ pattern: <the combine>, index: <the number of the tool in tools, from 1> }`. The moved tool is a copy of the tool body, face for face, which is what a copy tag says; the code is that of a pattern of a body with another transform. The index tells apart two tools that share a face. A tool put in front of the others renumbers the tags: tools are appended.
  - The reference of the kind `pattern` in a face name accepts a feature that tags faces (`FeatureModule.tagsFaces`): a pattern, and a combine with a clearance. The field of the tag keeps its name.
  - A new role with the name of the source face inside it does not fit the catalog of roles: a role has text and whole-number fields, at most one of them a free ID.
- **The cut face** of a split is one face `{ feature, role: 'splitFace' }` on both bodies, with the frame of the plane that cut as its description (origin and Y axis; the normal out of each body comes from its mesh, as for every face).

### What a body made from others inherits

- **Body properties** (3a). The target of a combine and the body of a split keep their entry. The new body of a split answers `bodySource` with the body it was cut from: it inherits colour, material and use, and the density and the mass as a pair; its name is that of the feature. A density follows the volume by itself. A weighed `mass` does not: after a split both parts would carry the mass of the whole, and after a union the target carries its old one. The feature does not touch the section; the mass is the author's to set again ("Known limits").
- **The mechanism** (5a). The new body of a split is in no link (`unassigned` names it); a used-up tool that a link lists is `missing`. The scenario adds the new shell to the link in the next command.
- **Pattern.** A pattern of a body copies any body, also one made by a split. Neither type leaves a tool recipe (`producesTool` false), so a pattern of features cannot name them.

### No effect, empty result, atomic

- A tool that does not change the target (a difference that misses, a union with a body inside the target, an intersection with a body around it) is named in the warning `noEffect`; the target is left as it was for that tool. Tools that are not kept leave all the same.
- `emptyResult`: a difference or an intersection would leave nothing of the target; a split would leave one part empty.
- The feature is atomic, as a pattern is: any error leaves the model as it was.

## Recompute

### Combine

1. The target and every tool are looked up in the state before the feature: `brokenReference` with the missing ones in `refs`.
2. For each tool, in the order of `tools`:
   - **With a clearance**: `movedOutwards(tool, …)`. A problem is `invalidClearance` with the tool and the faces in `refs`. The moved faces get the next free numbers of the table, their names (the tag appended) and their moved `FaceInfo`.
   - `booleanOfBodies(kernel, operation, current, tool, firstFree)`: the port's boolean with the numbers of the tool made its own; an exception is `kernelFailure`.
   - A result without a triangle is `emptyResult` (`refs`: the target and the tool).
   - No effect: the volume is what it was (the test of `applyTool`: within 10⁻⁶ of the smaller of the two volumes) and, for a difference, no face of the tool is in the result. The result is dropped and the tool noted.
3. The state: the target with its new solid; the tools removed from the bodies unless kept; the moved faces appended to the face table when a clearance was used and the tool had an effect.
4. The result: `ok`, or `warning` with `noEffect`; `bodies` is empty.

### The moved tool (`movedOutwards`)

1. **Sides.** For every face of the body, which side of its surface the material is on: the sign of the normals of its triangles against the surface, summed over the face.
2. **Thin faces.** A face all of whose triangles are narrower than the chord tolerance (twice the area over the longest side) is no condition of any vertex: it is carried along by its neighbours. (The crescents where two round faces of one radius were divided differently.)
3. **Vertices.** The conditions of a vertex: for each exact face it lies on, "the signed distance to the surface is c"; for each triangle of a swept face, "the move along its normal is c". Gauss–Newton from where the vertex is, each step the shortest move that satisfies the linearised conditions (in an orthonormal basis of their normals, as `minimalShift` of the kernel adapter), until a step is below 10⁻¹⁰ mm, eight steps at most. Up to three independent conditions are met exactly; a vertex that ends more than 10⁻⁴ mm off one of them cannot follow its faces: the problem `vertex`.
4. **Planar faces** are triangulated again. The outline of the face is the directed edges of its triangles that have no opposite in the face, chained into loops; in the plane of the face the moved loops must not cross (a test of segments; the problem `outline`); `kernel.triangulate` makes the triangles. Round and swept faces keep theirs.
5. **Checks**, each a problem of its own:
   - the mesh is closed (every edge twice, once each way): a guard of step 4;
   - no triangle of a round or swept face turned over (`turned`): a hole no wider than the clearance, a tooth space that closes;
   - **no point of the moved surface is nearer to the body than the clearance** (`tooNear`): see below.
6. **The moved descriptions**: a plane's origin moved by c along its normal out of the body, a cylinder's radius, a cone's apex, a swept surface as it is.

A face of a general surface (no feature makes one yet) is the problem `noSurface`.

### The checks of the moved tool

The last check is the one that sees two parts of the tool meet: the tips of a C, the walls of a slot, two pins. A moved mesh that passes it is a valid offset: a point of its surface that lay nearer to the body than c would be one that another moved face had to pass.

- **The points**: every vertex, the middle of every edge and the centroid of every triangle of the moved mesh, faces of step 2 aside.
- **Against**: every triangle of the body as it was that shares no vertex with the place the point came from, thin faces aside.
- **The bound**: c, less the precision of the coordinates (four millionths of the largest coordinate). For a point against its own face or a face next to it (sharing an edge), when one of the two is round, c · (1 − `ROUND_ALLOWANCE`), with the allowance 0.15: a round face is a polygon, the moved polygon is nearer to the body's by the sagitta of its sides, and an edge of two round faces is a chord of both (0.87 c measured). Two faces that are neither the same nor neighbours get no allowance: two planar walls 2c apart are told from two walls a hair nearer.
- What the allowance could hide, a round face that meets itself or its neighbour, is what the check of turned triangles and the outline of the planar faces see: a hole that closes turns its triangles over, a tooth space that closes crosses the outline of the cap.
- The sampling is a known limit; "To verify before the implementation" has the fuzz that is to confirm it and the allowance.

### Split

1. The plane is resolved with `frame(plane, state)` in the state before the feature (`brokenReference`, `nonPlanarFace`); the body is looked up (`brokenReference`).
2. Two boxes, `halfSpaceBox(body, plane, 'forward', first)` and `'backward'`: the extent of the body in the frame of the plane, a margin of the larger of 1 mm and 5 % of its diagonal, the face in the plane numbered `first` (the next free number), the five others `first + 1` to `first + 5`. A side on which the body has nothing: `emptyResult`.
3. `kernel.boolean('difference', body, box)` for each box: the body less the box on the side `side` stays the body, the body less the other box is the new body. An exception is `kernelFailure`; a part without a triangle is `emptyResult`; a part that holds a number above `first` is `kernelFailure` (a guard: the five faces lie outside the body).
4. The state: the body with its new solid, the new body under the ID of the feature, and one face appended: `{ feature, role: 'splitFace' }` with `{ planar: true, origin, y, normal }` of the frame of the plane. The result names the new body in `bodies`.

The boxes have fresh numbers, so the rule of own numbers has nothing to do here.

## Document and validation

- **Combine**: `operation` one of three; `target` a body (a reference of the kind `body`); `tools` a non-empty list of bodies, none twice, none the target; `keepTools` a boolean; `clearance` a numeric field `clearance` (`CLEARANCE`: mm, above 0), optional by the rules of 2a ("An optional numeric field"), and an invalid command with another operation than `difference`. The validator lists its fields; anything else is refused.
- **Split**: `body` a body; `plane` a `PlaneRef` validated by `planeRef`, as the plane of a sketch; `side` one of two.
- **References** (`refs`): the target and the tools, the body and the plane (`planeRefs`). So `moveFeature` keeps both types behind what they name, and a command verifies a reference the feature did not have before.
- **`updateFeature`**: combine `operation`, `target`, `tools`, `keepTools`, `clearance`; split `body`, `plane`, `side`. `clearance: null` removes the field also where there is none; a patch to another operation than `difference` removes the clearance by itself (as a patch to `new` removes the targets of an extrusion).
- **A face name** in the role `splitFace` has no further field. A copy tag whose `pattern` is a combine is valid when that combine comes before and has a clearance.
- **What a section may name.** `createsBody` of a split answers for its own ID, so body properties and a link may name the new body; the text of `bodyProblem` lists a split among what makes a body.
- **The schema: no upgrade step.** A build without the package refuses a document that holds either type (`feature` in `document.ts` takes the type from the registry), and with it a face name in the role `splitFace` (`faceName` takes the role from the catalog). A copy tag that names a combine can only be in a document that holds that combine. Nothing is dropped without a word.

## Where the code lives

| File | What 3d does there |
|---|---|
| `types.ts` | `CombineFeature`, `SplitFeature` in `Feature`; their patches in `FeaturePatch`; `splitFace` in `FaceName`; `invalidClearance` in `ErrorCode`; the comments of `CopyTag` and `FaceName` (a tag of a combine) |
| `features/combine.ts`, `features/split.ts` | the two modules: validator, references, step |
| `features/index.ts` | two lines of the registry; `requireRef` of the kind `pattern` asks `tagsFaces`; the text of `bodyProblem` |
| `features/module.ts` | `tagsFaces` |
| `features/pattern.ts` | `tagsFaces: () => true` |
| `recompute/body-boolean.ts` | `booleanOfBodies`, `halfSpaceBox` |
| `recompute/moved-body.ts` | `movedOutwards` with its checks |
| `recompute/services.ts` | the text of `invalidClearance` in `MESSAGE` |
| `solid.ts` | the pieces of a mesh (`pieces`, there already) exported for the noise of an intersection; the side of a round face, which `query/body.ts` computes as `convex`, shared |
| `face-roles.ts` | the entry `splitFace` |
| `validation.ts` | `REF_LABEL.pattern` says what it now accepts |
| `sketch-tools.ts` | two lines of `PROFILE_SOURCES` (neither type has a profile) |
| `packages/mcp/src/api.ts` | a paragraph of `CONVENTIONS` |
| `packages/app` | below |

The modules import the services and `recompute/`, never the registry (`modules.test.ts` gets their rows).

## The app and MCP

- **MCP** needs no code: `execute` and `preview` take the features, and `describe_api` prints the types of `types.ts`, the two entries of the registry with their fields and the role from the catalog. `CONVENTIONS` gets one paragraph: how a part is subtracted with a clearance and that the tool is kept, that a union uses its tools up, which part a split makes new, how the faces of a pocket are named, and that `gap` and `measure` verify the clearance.
- **`FEATURE_UI`** gets two entries (a type without one does not compile), each a file in `features/` and a button of the toolbar.

| Form | Reads | Commands |
|---|---|---|
| Combine | the bodies of the state before the feature, by their names | a select of the operation; a select of the target; the tools as a list of check boxes; a check box "Keep the tools"; with a difference the field "Clearance" (`draftField`, absent when empty). A click on a body in the view toggles it among the tools (the first click of a new draft sets the target). The draft is incomplete without a target and a tool |
| Split | the bodies of the state before; the plane's label (`planeText`) | a select of the body; the plane by the button *Pick* (a planar face, a plane feature or a base plane, as the mirror of a pattern picks its plane; `picks` answers faces and planes while armed); a select "New body: in front of the plane / behind it". A click on a body while *Pick* is not armed picks the body. The draft is incomplete without a plane |

- **The model panel** (`summary`): a combine says its operation, its target, its tools and what became of them ("used up" or "kept"), and the clearance; a split says its body, its plane and the new body. `ownsFace`: a split its cut face; a combine the faces that carry its tag. `hideable`: a split (it has a body), not a combine.
- **The view** needs nothing: bodies come and go with the state, and the preview of a draft is the state the view shows.
- `ROLES` of `issue-text.ts` gets `splitFace`; `faceLabel` reads a tag of a combine as "copy n of <feature>" today, which the entry of the combine words ("the pocket of <feature>, tool n"); `NAMED` gets `invalidClearance`, so the tool is named in the message.

## Issue codes

| Code | Kind | When |
|---|---|---|
| `invalidClearance` | error, new | a tool of a combine cannot be moved outwards by the clearance: a face would vanish or turn over, two parts of the tool are nearer than twice the clearance, a vertex cannot follow its faces, a face has no description. `refs`: the tool, then the faces |
| `brokenReference` | error | the target, a tool, the body or the plane is not in the state before the feature |
| `nonPlanarFace` | error | the plane of a split is a round face |
| `emptyResult` | error | a difference or an intersection would leave nothing; a plane does not cut the body |
| `kernelFailure` | error | the kernel refused a boolean |
| `noEffect` | warning | `refs`: the tools that did not change the target |

## Shared vocabulary

- **Takes:** `PlaneRefAfter`, `FaceRoles`, `IssueCodes`, `FeatureTypes` and `FeaturePatches` of the preparatory step; `bodySource` of 3a; the copy tag of the pattern (D35, D53); the optional numeric field of 2a.
- **Adds:** the feature types `combine` and `split`, the role `splitFace`, the code `invalidClearance`, `FeatureModule.tagsFaces`. No kind of surface, no kind of edge.

## Rejected alternatives

1. **The sum of Minkowski of the library as the clearance** (a member `offset` of the port). It never refuses and rounds the corners, and it is the smaller piece of code. Against it, measured: 2 to 4 ms per triangle of a tool that is not convex (4 s for a motor with screw holes, 8 to 17 s for a housing), in a recompute that is synchronous and replays everything after a change; 3 to 7 times the triangles in the pocket, which every later boolean of that body then carries; and one face without a description for the whole pocket, so no sketch stands on its floor and nothing in it is measured exactly. Kept as the route of the full variant; the names of this design leave room for it (the faces that lie on a moved face of the tool keep the tagged names, the rounding gets one more face).
2. **A scaled copy.** Measured: 0.007 to 0.59 where 0.3 was asked.
3. **Moving the triangles without the exact faces** (every triangle a plane of its own). A round face then meets its caps in vertices with three conditions that the exact surface states as two, the moved descriptions would have to be fitted, and nothing is gained: the engine has the surfaces.
4. **The per-face move behind the port.** The adapter does not have the surfaces; it would fit planes to faces, as it does for flush faces, and could not move a cylinder as one.
5. **`splitByPlane` of the library, or a member `split` of the port.** No tolerance for a plane flush with a face, the cut face numbered by the library's cutter, and one more member with a guarantee text to write; two differences need nothing and measured clean.
6. **A split that makes two new bodies** and ends the body. Above.
7. **A new body for the result of a combine.** Above.
8. **A default for `keepTools`.** Above.
9. **An intersection as two differences.** Measured worse than the port's ("Measured", G).
10. **Preparing the tool of an intersection in the adapter** (growing and shrinking flush faces as for a difference). It would change the mesh the collisions measure, whose behaviour D50 and D51 pinned on thousands of poses, for the sake of slivers the engine can drop.
11. **A role for the faces of a pocket** in place of the copy tag. Above. **One face for the whole pocket**: the exact surfaces would have no names to hang on.
12. **A feature of its own that makes the moved body**, subtracted by a plain difference. Two features and a body to hide for one pocket; the move is a function, so such a feature can be added over it ("Deferred").
13. **A split of several bodies.** The new bodies would need local names made of body IDs, which hold slashes.

## Known limits

- **The clearance is refused where the tool has detail finer than twice the clearance** (a hole, a slot, a gap), and where more than three faces meet at a vertex in a way their moved surfaces do not. The message names the faces; the tool has to be simpler (bought parts are modelled simplified here anyway) or the clearance smaller.
- **Corners are sharp**: the pocket is up to 1.41 c from an outer edge of the tool and 1.73 c from an outer corner, and more where two faces meet at a sharp angle.
- **On an edge of two round faces** (a hole across a pin) the pocket is as near as 0.87 c: the moved edge is a chord of both moved faces. On a round face the polygon of the pocket is nearer than c by the sagitta of its sides (0.968 c the least measured).
- **The clearance is all round.** A tool that sits on a face of the target floats over it by c. The scenario subtracts from a body that does not reach under the tool.
- **The checks sample** (vertices, middles of edges, centroids). Two large faces that meet only away from every sample would pass; the adapter's own checks of the difference then stand behind them (in the ten such meshes of the prototype's refusals it refused).
- **A weighed mass is not divided or added**: after a split both parts answer with the mass of the whole when the body had `mass`, and a union keeps the mass of the target.
- **A part of a split may be several pieces** and is one body.
- **A union of two bodies whose flush faces have vertices that do not match on a tilted plane** (parts cut apart there and joined again) is the adapter's weak case: with own numbers 21 of 453 tilted cases refused, 9 with a volume off by up to 0.16 mm³, and a remnant of the cut face in 49. Flush on a plane along an axis, and flush on a tilted face as a model makes it (a mirror image, a body from a sketch on the face), measured clean ("Measured", D and F). The limits of the adapter for an addition and a cut hold for a combine as they are ([ports.md](../../architecture/ports.md), "Omezení"); a tool is now any body, not a prism.
- **An intersection has no tolerance for flush faces.** Where the two bodies also touch from outside on a tilted plane, a sliver thinner than the precision of the coordinates may stay joined to the result; one that is a piece of its own is dropped. An intersection the second cleaning of D51 answered may hold a triangle without an area under the number of a face that is gone.
- **A face that lies on two bodies** (a pocket without a clearance and its kept tool) is one name; a reference to it says which body.
- **Tags are numbered by the place of the tool in `tools`**: a tool put in front renumbers them.

## To verify before the implementation

1. **A fuzz of `movedOutwards`**, in the manner of the kernel fuzz: bodies of prisms, cylinders, tapers, cuts and holes in random places, random clearances. Every accepted mesh has to go through the adapter as the tool of a difference with the pocket no nearer to the body than (1 − `ROUND_ALLOWANCE`) c, and has to hold the sum of Minkowski of the body with a ball (the library through the adapter's `wasm`, tests only). Every refusal is sorted by its reason, and a sample of each is looked at. The allowance (0.15, from one body) and the set of sample points are confirmed or changed by it.
2. **A fuzz of unions and differences of two finished bodies** with the numbers of the tool made its own: tools with bosses, holes and cones, flush on planes along an axis and on tilted ones. What it refuses or gets wrong goes into "Known limits" with its rate, or into a repair of the adapter ("Open", 2).
3. **`kernel.triangulate` with several outer loops and their holes in one call** (the prototype uses it so, on every planar face of the twelve bodies), and its time on the cap of a gear (1.3 s once).
4. **The time of the checks** on a body of 5000 triangles with a grid that is not keyed by strings (the prototype: 0.2 to 0.7 s).
5. **A tool that is a mirrored copy, and a tool that carries tags already**: the tag of the combine goes last.

## Open

1. **The clearance: by faces, or the sum of Minkowski?** The design moves each face along its own surface: milliseconds, sharp corners, the faces of the pocket exact and named, and a refusal when the tool has a hole or a gap narrower than twice the clearance. The library's sum never refuses and rounds the corners, takes 4 to 17 s for a motor or a housing at every recompute that reaches it, and leaves one face without a description. Recommended: by faces now, the sum later as a second way for the tools the first refuses. *One line: "by faces" or "Minkowski".*
2. **A repair of the adapter for bodies flush on a tilted plane with vertices that do not match?** Measured as the one case in which a union of bodies is refused or leaves a remnant in more than a few per cent (parts cut apart on a tilted plane and joined again). Recommended: a known limit; a repair package only if the fuzz of "To verify", 2, shows it in models that are made on purpose. *One line: "limit" or "repair after 3d".*

No third-party library is needed: `manifold-3d` is approved (D2) and is asked for nothing it is not asked for today.

## For the plan

- **The kernel port**: 3d adds nothing to it (the row "Kernel port" of "Shared places" names a split and an offset).
- **Kinds of faces**: the face of a split is a plane; `FaceInfo` and `EdgeKind` do not change.
- **3b (import of a mesh)**: a body whose faces have no exact surface cannot be a tool with a clearance in this design. Either 3b gives an imported body faces the move can read, or the full variant of the clearance (the sum of Minkowski, "Measured", A) comes with it. The time grows with the triangles of the tool: an imported motor of 20 000 triangles is a minute.
- **4a, 4b**: a surface they add (a sphere, a torus, the general one) needs its line in `movedOutwards` (a sphere and a torus move exactly) or is the problem `noSurface`.
- **Shared places written to**: `features/index.ts` (two lines, `requireRef`), `features/module.ts`, `validation.ts`, `face-roles.ts`, `sketch-tools.ts` (`PROFILE_SOURCES`), `recompute/services.ts`, the app's `issue-text.ts` and `features/index.ts`; each one line or one entry.
- **Docs the implementation owes**: a file of the area in `docs/architecture/` (combine and split) and its row in `architecture.md`; `naming.md` (the role, the tag of a combine, the rows of the table of situations); `ports.md` (the engine now asks an intersection for a body as well, and gives a tool numbers of its own); `document.md`; a file in `docs/ui/`; the rows of `backlog.md`.

## Tests the implementation owes

- Engine, combine: each operation on boxes and cylinders, flush and apart; several tools; a tool used up (later references, the entry of its properties, its link) and kept; own numbers (two bodies cut by one feature united; the parts of a split joined again along an axis, with the volume); `noEffect` for each operation; `emptyResult`; the patch of the operation that drops the clearance; every refusal of the validator; undo.
- Engine, the clearance: the twelve bodies of the prototype with their verdicts pinned; the moved surfaces exact (a plane, a pin, a hole, a cone, gear teeth); the names with the tag, on a tool that carries tags already; a sketch on a face of the pocket and a projected rim of it; every problem of `MoveProblem` with its faces; the fuzz of "To verify", 1.
- Engine, split: the planes of "Measured", C; both sides; the cut face as a sketch plane on both bodies; a face of the body as the plane; a plane beside the body; the inherited properties; a body of several pieces; a pattern of the new body.
- Scenarios: the part of scenario 13 ([calls.ts](calls.ts)); a few of the measured cases in `review.test.ts`.
- App: the two forms in `app.test.ts` (a new record each). MCP: the description of the two types and of the role.

## Reviews

Not reviewed yet.

## Rows for the indexes

**`docs/d36/README.md`, the row of 3d** (column "Design now"):

> full design, D56 ([3d-body-boolean/design.md](3d-body-boolean/design.md)): two feature types, `combine` (a union, a difference or an intersection of a target with tool bodies that are used up or kept; a difference may have a clearance) and `split` (a body by a plane: the body keeps its ID and one part, the other is a new body under the ID of the feature), the face role `splitFace`, the issue code `invalidClearance`; the kernel port stays as it is (a split is two differences with a box; the clearance moves every face of the tool along its own surface in the engine, measured against the sum of Minkowski of the library); no schema step; its part of scenario 13

In "Shared places": the row "Kernel port" names 3d with a split and an offset; it becomes "3d added nothing to it in the end (D56)". In "Numbers": D56 is 3d.

**`docs/decisions.md`, the row:**

> | D56 | [3d Boolean of bodies, subtraction with a clearance, split by a plane](d36/3d-body-boolean/design.md) | designed 2026-11-17. Measured against the real adapter and library: a split as two differences with a box (906 planes, none refused); a union of two bodies that share face numbers comes out wrong unless the tool gets numbers of its own; the clearance by faces against the sum of Minkowski (milliseconds and exact faces against 4 to 17 s and one face without a description) | Two feature types. `combine`: a union, a difference or an intersection of a target body with tool bodies; the target keeps its ID, the tools are used up or kept; a difference may have a clearance, the tool then subtracted with every face moved outwards along its own surface, and the faces of the pocket named after the faces of the tool. `split`: a body by a plane; the body keeps one part and its ID, the other part is a new body, and both get the cut face. The kernel port does not change |

**`docs/requirements.md`, scenario 13, the part of 3d:**

> - *A pocket with a clearance, a union and a split (3d, D56).* A ring around the motor is modelled without a thought for the motor and the four screws it runs through (five collisions). One feature subtracts the motor, the screw and its three copies from it with the print clearance as a parameter (`fit = 0.3`), and keeps them: nothing collides and nothing is a fit, the wall of the pocket is the cylinder of the motor with the radius 14.3 exactly and carries the name of the motor's side with the tag of the feature, the smallest gap between the ring and the motor is 0.3 to the accuracy of two polygons, the ceiling of a screw pocket is exactly 0.3 over the screw and a sketch stands on it, and the pocket follows the parameter. Without the clearance the pocket carries the very names of the motor's faces. A clearance of 5 on a tool with holes of radius 4 is an error that names the holes; a tool that misses warns; a clearance on a union and a tool listed twice are invalid commands. What the ring and the motor share, asked as an intersection previewed before the pocket, is a disc of the motor. The ring is joined to the link by a union: the body of the ring leaves the model (a later feature that names it is a broken reference), the link has grown by its volume and carries its faces, and the motor sits on the link and shares nothing with it. The link is split at half its thickness by a plane feature: it keeps its ID and the upper part, the lower shell is a new body named by the feature, the two volumes add up, both carry the cut face and a sketch stands on it with the normal out of each, the new shell takes after the link (material, density) and is named as in no link until the link lists it, and a cut goes through both. The other side is one field; a plane beside the body, a round face and a removed plane are errors of the feature. The document loads to the same model, without a schema step ([d36/3d-body-boolean/calls.ts](d36/3d-body-boolean/calls.ts)).

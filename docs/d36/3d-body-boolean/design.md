# 3d Boolean of bodies, subtraction with a clearance, split by a plane (D56)

**State: design, written on 2026-11-17 against `master` at `633a6ca` (every package of steps 1 and 2, 3a, 5a, 5e and 5f merged), rebased on `c2a506c` (the compressed 3MF of 2g, nothing in the areas of 3d), with the decisions that depend on the kernel measured against the real library (`manifold-3d` 3.5.5) and the real adapter ("Measured"), and revised after its reviews ("Reviews"); revised once more after the verification before the implementation ("Revision after the verification"). Implemented on the branch `d36/3d` by Claude Opus 5.5, not merged yet; see "As implemented".** The first version and the fixes of round 1 were written by Claude Fable 5.2; the rest by Claude Opus 5.5. Three rounds of review ("Reviews"). It needs only the preparatory step. It adds two feature types, no member to the kernel port, and one check to the kernel adapter.

Files: [contract.ts](contract.ts) (the two feature types, the face role, the issue code, the functions of the recompute), [calls.ts](calls.ts) (its part of validation scenario 13).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md): the row "Spojení, rozdělení, zrcadlení a přesun těles" (subtract one part from another, cut a part for printing; new feature types; "the only new thing is that a body may cease to exist"), the row "Subtracting a body with a clearance" ("the clearance needs a 3D offset (`minkowskiSum` in Manifold), speed not measured"), step 3 of the proposed order ("boolean of bodies (union, difference, intersection), subtracting a body with a clearance, splitting a body by a plane (two shells of a link, a part larger than the bed, printing without supports)"), the row "Union and intersection of bodies" of the comparison ("as one feature"), and "To verify first" (every new operation of Manifold extends the port; whether face names survive was not checked; the speed of `minkowskiSum`). The plan ([README.md](../README.md), "Shared places") expects 3d to add a split and an offset to the kernel port.

| Statement | What the code says |
|---|---|
| "New feature types in the registry" | A type is a module in `features/` and a line of `FEATURE_TYPES`; validation of references, the order on the timeline, `updateFeature` and the recompute read the registry. Nothing else is needed for a type that takes bodies: the pattern of a body does so already (`source: { type: 'body' }`, a reference of the kind `body`) |
| "A body may cease to exist; a reference to it is a broken reference like any other" | A step returns the bodies of the state as a record; leaving a key out is all it takes. A feature that names the body looks it up in the state (`lookup`) and ends in `brokenReference`: a target, the plane of a sketch, the source of a pattern. Not every reader stops, though: a projected edge of a body that is gone is the warning `brokenProjection` and the curve keeps its last valid place (`features/sketch.ts`), so the sketch and what is built on it go on; a query answers `notAvailable`; a link reports the body as `missing`. A command checks a body only structurally (a feature before this one creates a body of that ID, `requireRef`), so a later feature that names a used-up body is a valid command and an error of the recompute, which is the rule for a removed feature too |
| "The kernel port has all three operations" | `SolidKernel.boolean(op, a, b)`, with the assumption that the face numbers of `a` and `b` come from one table. That holds for two bodies of a state. What does not hold is what the adapter was built and tested for: a tool whose numbers the body does not have (`toolIds` in `coplanar.ts`; "Measured", D), and a tool that is a prism or a cylinder ([ports.md](../../architecture/ports.md), "Omezení": "Zkoušené nástroje jsou hranoly a válce") |
| "Splitting needs `splitByPlane`; whether the face names survive was not checked" | A split is two differences with a box that has one face in the plane. The port's difference keeps the names of the body, gives the cut face the number of that face of the box and has the tolerance for flush faces; the library's own `splitByPlane` has none of the three ("Measured", C and D) |
| "The clearance needs `minkowskiSum`" | The library has it and it works, at 1.6 to 4.4 ms per triangle of a tool that is not convex (a ball of 8 segments), and the faces of the result have no names and no exact surfaces. The engine knows the exact surface of every face (`FaceInfo`), so it can move each face along its own surface, as the profile offset of D44 moves each curve ("Measured", A, B and E) |
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
- **A clearance** is an optional numeric field of a difference (absent or 0: none). Every tool is subtracted moved outwards by it: each face along its own surface, corners sharp, the topology of the tool unchanged. A tool that cannot be moved that way (a hole that would close, two parts that would meet) is an error that names the faces.
- **`split`** is a cut that keeps what it cuts off: the body keeps its ID and the part on one side of the plane, the other part is a new body with the ID of the feature. Both get the cut face, a plane a sketch can stand on.
- **Names.** A face keeps the name it had, on whichever body it ends. The faces a tool with a clearance leaves are the faces of the tool with a copy tag of the combine. The cut face is `{ feature, role: 'splitFace' }`.
- **The kernel port stays as it is.** The engine gives the tool of a boolean of bodies numbers of its own and checks the result of a union and a difference (its volume, and that no sheet is left inside); what does not pass is `kernelFailure`.

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

- Every sum has the status `NoError`. A convex body takes milliseconds; a body that is not convex 1.6 to 4.4 ms per triangle with a ball of 8 (0.9 to 8.4 over the four shapes; the library sums triangle by triangle and unites the pieces).
- The difference with the sum as its tool went through the adapter in 1 to 343 ms for the octahedron and the balls (all 24), and for the cube in six of eight (the sun and the housing were refused, "not a closed surface").
- The result has 3 to 8 times the triangles of the body for a ball of 8, and no face of it is a face of the body: one face without a description.
- A ball of n segments is a polytope inside the ball: along directions between its vertices the clearance is short by up to 1 − cos(π/n), 7.6 % for 8.

### B. A scaled copy

The NEMA-like motor scaled about the centre of its box by 1.01429, the factor that gives 0.3 on the faces nearest to that centre by the half sizes (21, 21, 29). Measured from the scaled vertices to the body, by the face the vertex lies on: 0.43 to 0.59 at the corners of the sides of the block (0.3 in the middle of a side, by the choice of the factor), 0.59 on the floor, 0.04 to 0.42 on the shaft, 0.07 to 0.19 on the boss, 0.007 to 0.33 at the screw holes (which move outwards and barely shrink). A scaled copy is not a clearance.

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
  - with the numbers of one part made its own for the call (every number moved up by a constant):

| Planes | Joins | Refused | Volume off by more than 0.001 mm³ | The cut face left |
|---|---|---|---|---|
| along an axis | 436 | 8 (all on the lid, through vertices of its cone and bore) | 3 | 9 (at most 0.18 mm² of it) |
| tilted | 470 | 21 | 9 (up to 0.16 mm³) | 54 (at most 17 mm²) |

- The adapter tells the faces of the tool from those of the body by their numbers (`toolIds` in `restoreShifted`), which is why shared numbers break it. Numbers of its own remove most of the silent error (from 48 % of the answers to 1.4 % by volume and 7 % by a face left), not all of it: parts cut apart and joined again are the adapter's hardest case, because each part got its vertices on the cut from a difference of its own and the two agree only to the precision of the coordinates. "I" below measures what the engine can still catch.

### E. The clearance by faces: a prototype

The move of the cheap variant ("The clearance" below) as a prototype of 450 lines: every vertex moved to where the moved surfaces of its faces meet, planar faces triangulated again, the checks. On thirteen bodies (the twelve above and a plate 10 × 10 × 0.005, thinner than the chord tolerance) with c = 0.2, 0.3, 0.5, 1 and 2: 65 runs. Whatever the checks said, the moved mesh was then subtracted from a block through the adapter and the smallest distance of the pocket to the body measured (`closest` of the engine) as the judge.

| Body | 0.2 | 0.3 | 0.5 | 1 | 2 |
|---|---|---|---|---|---|
| block | 1.000 c | 1.000 c | 1.000 c | 1.000 c | 1.000 c |
| plate 0.005 thick | 1.000 c | 1.000 c | 1.000 c | 1.000 c | 1.000 c |
| cylinder | 0.999 c | 0.999 c | 0.999 c | 0.999 c | 0.999 c |
| motor like a NEMA 17 | 0.994 c | 0.994 c | 0.994 c | 0.994 c | refused: the screw holes close |
| lid with lead-in and countersink | 0.970 c | 0.979 c | 0.987 c | 0.993 c | 0.996 c |
| box with its cavity | 1.000 c | 1.000 c | 1.000 c | 1.000 c | 1.000 c |
| sun gear | 0.994 c | 0.994 c | 0.994 c | refused: the teeth meet | refused |
| carrier | 0.996 c | 0.996 c | 0.996 c | 0.996 c | 0.996 c |
| housing | accepted | accepted | refused: the teeth of the ring meet | refused | refused |
| L, two cylinders that cross | 0.881 c | 0.883 c | 0.885 c | 0.872 c | refused: the hole closes |
| C, tips 0.4 apart | 1.000 c | refused | refused | refused | refused |
| plate, two pins 0.5 apart | 0.997 c | refused | refused | refused | refused |
| plate, a slot 0.5 wide | 1.000 c | refused | refused | refused | refused |

- **46 accepted, 19 refused.** Every accepted mesh went through the adapter as the tool of a difference. The housing was not measured (the measure is slow on 5000 triangles); its difference went through.
- **Every refusal is right**: measured on the mesh the checks refused, the pocket was 0.84 c from the body with 184 triangles turned over (the hole across the pin closes), at most 0.70 c in eight others, and in the remaining ten the adapter refused the difference itself.
- **Where the pocket is nearer than c, and why.** Two effects, both of the mesh and not of the moved surfaces, which are exact:
  - *A constant, up to the chord tolerance.* A round face is a polygon. The lid is short by 0.006 to 0.009 mm at every clearance (0.970 c at 0.2, 0.996 c at 2): the polygon of the moved cone against the polygon of the cone.
  - *A share of c, where a vertex moves along a round face.* On the L the smallest distance is on the side of the pin, on the ruling where the hole across it is tangent to it. The vertex there lies on both cylinders, whose normals are 120° apart; it moves to where the two moved cylinders meet, which is 2 c away and 5° round the pin (the hole shrinks, so its rim on the pin moves). The triangles of the pin's side that end in it are dragged along, and the sides of the polygon there span 12° in place of the 7.5° the chord tolerance gave them: the moved pin is flat where it should be round, 0.024 mm short at c = 0.2 and 0.128 at c = 1. It grows with the angle between the two faces at the edge: nothing at a cap square to a cylinder, 12 % here.
- The sum of Minkowski with a ball of 12 segments was computed for the bodies of up to 1000 triangles. The moved body holds it but for the flat places above: 0.24 mm³ of the sum (of 6855) lie outside the moved body of the L at c = 0.2, under 0.1 mm³ on every other body. The moved body is larger than the sum by the sharp corners (the NEMA-like motor at 0.3: 64 050 against 64 035 mm³).
- Time: the move 0.1 to 21 ms; the planar faces 0.2 to 110 ms (up to 1.5 s on the caps of the sun gear when its teeth nearly meet, inside `triangulate`); the checks 1 to 660 ms (the prototype's grid has string keys). The NEMA-like motor: 50 to 90 ms in all, against 4.0 s for the sum of Minkowski.
- What the first prototypes lacked, each found on a real body or by a review:
  - The triangles of a planar face do not survive the move when its loops move by different amounts (the carrier and the sun at 0.3, the top of the boss of the motor at 1: triangles turned over although nothing collides). Planar faces are triangulated again.
  - A face that has no extent in the exact shape gives a vertex a condition it cannot keep: the crescents left where the cone of the countersink ends on the circle of the bore, two polygons of one circle. A rule "a face narrower than the chord tolerance is no condition" accepted them and was wrong for a face that is merely narrow: the plate 0.005 thick came out moved across its thickness only. The rule now is per vertex: the condition of a narrow face is dropped only at a vertex that cannot meet all its conditions; the plate then moves as a box, and the lid as before.
  - A test that looks only for triangles crossing does not see two faces that passed through each other and stayed parallel (the tips of the C); the distance to the body does.

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

The bodies of F. A body and its mirror image (they share nothing): a sliver is left in 5 of 40 (at most 8 triangles, 6 · 10⁻⁴ mm³). A body and the block that stands on its tilted face: in 19 of 40 (at most 1.5 · 10⁻⁶ mm³). A body and its copy shifted along a tilted face (flush on that face and on both caps, a real overlap): right in all 40 within 6 · 10⁻⁴ mm³, one piece. Every one of the 24 leftovers is all sheet: each of its triangles lies back to back on another within ten precisions of the coordinates (`areaOf` with that tolerance gives no area), and its mean thickness is at most 1.1 · 10⁻⁶ mm.

### I. What the engine can check on the result of a union and a difference

Two checks, tried on the joins of D (the tool with numbers of its own), the unions of F and the bodies of J:

- **The volume.** vol(A ∪ B) = vol A + vol B − vol(A ∩ B) and vol(A − B) = vol A − vol(A ∩ B), with the shared volume from the port's intersection (which G measured right to 10⁻¹¹ and which was never refused here). Flagged when the two sides differ by more than a millionth of the two volumes together, 0.001 mm³ at least.
- **Sheets.** The area of the result in triangles that lie back to back within ten precisions of the coordinates (`areaOf` with and without its tolerance), less what the two operands had. Flagged above 0.001 mm².

| Cases | Refused by the adapter | Flagged by a check | Passed with the cut face left or a wrong volume |
|---|---|---|---|
| D, along an axis, 436 joins | 8 | 13 (12 by sheets, 3 by the volume: every wrong volume) | 7: a remnant of the cut face of at most 0.18 mm², the volume right |
| D, tilted, 470 joins | 21 | 57 (all by sheets, 1 also by the volume; 5 of the 9 wrong volumes are among them) | 26: in 23 a remnant of the cut face of at most 1.2 mm², in 4 the volume off by at most 0.005 mm³, inside the tolerance (one has both) |
| F, 80 unions flush on a tilted face | 0 | 0 | 0 |

- The sheets found more than the count of D knew: in 10 joins along an axis and 24 tilted ones the cut face was gone and the volume right, and the result still held sheets of 0.001 to 0.5 mm² on other faces, beside the seam. They are the same defect (the seams of the two parts do not match), on a face the count did not look at.
- The identity of the volumes holds on clean results within 1.5 · 10⁻³ mm³ on the joins and 2.5 · 10⁻³ on the unions of F (bodies of 5000 to 22 000 mm³), which is why the tolerance follows the volume. With that tolerance the volume catches the gross error (the 19 mm³ of shared numbers) and little of what is left with numbers of their own; the sheets catch most of that.
- The two checks took at most 100 ms on these bodies (up to 900 triangles); the search for sheets grows with the square of the triangles.

### J. Bodies flush on a round face: a pin in its hole

A plate 40 × 30 × 6 with a hole of radius 5 right through, and a pin of the same radius: as high as the plate, and reaching out of it on both sides. The pin as modelled (the same polygon of 50 sides), turned by half a side, and turned by six random angles; each as a union and as a difference, with numbers of its own; and all of it once more with both bodies turned and shifted in space, so that their coordinates are rounded differently. 64 booleans, the volume judged against the area the two polygons share.

- None was refused, and the volume is right in all 64 (within 2.3 · 10⁻⁴ mm³).
- A difference changed nothing but the slivers the polygons share, in all 32.
- A union of the pin with the same polygon, along the axes: exact, the wall gone. **The same after both were turned in space: the whole wall of the hole stays inside the result as a sheet** (110 and 230 mm², two cases of two). This is the limit [ports.md](../../architecture/ports.md) states ("Válcová stěna nástroje shodná s válcovou stěnou tělesa … chyba se neohlásí"). The check of sheets flags both.
- A pin whose polygon is turned leaves real gaps of up to the chord tolerance between the two polygons, as the meshes say; no check flags them at ten precisions (at a hundred, the gaps themselves count as sheets: the tolerance is not to be larger).

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

The price is twofold. A later feature that names the body keeps naming the part that stays under its ID. A split put on the timeline before a hole through the body leaves the hole in one part only, and a patch of `side` moves every later feature to the other part, both without an error: the hole still cuts something. With two new bodies those features would end in `brokenReference`, loudly. The design keeps the body and says so: in the description for the AI ("after a split, a feature through both parts lists both bodies"), and in the app, where the entry of a split in the model panel lists the later features that name its body and not its new body.

The other price is a field that says which part is the new one. A fixed rule ("the part in front") would not do: the normal of a base plane cannot be turned round (XZ points to −Y). The words are those of "through all": `forward` is along the normal of the plane.

A plane that does not cut the body (one part would be nothing) is the error `emptyResult`, not the warning `noEffect` of a cut that misses: the feature promises a body, and what names it would break anyway.

### The kernel port stays as it is

The plan expected a split and an offset on the port. Neither is needed:

- **A split is two differences** with a box that the engine builds (`halfSpaceBox`): one face in the plane, five outside the body. The port's difference keeps guarantee 3 (a plane flush with a face of the body is the adapter's ordinary case), names the cut face by the number of the box's face, and was measured on 906 planes without a refusal. The library's `splitByPlane` has no tolerance for flush faces and numbers the cut face by its own cutter.
- **The clearance is computed in the engine**, because it needs the exact surface of every face, which the engine has and the kernel does not.
- **An intersection is the port's** `boolean('intersection')`. It keeps no tolerance for flush faces (guarantee 3), which shows as sheets where the two bodies only touch ("Measured", H). The engine drops a connected piece of the result whose whole surface is sheet (every triangle back to back on another within the sheet tolerance, "The engine checks the result") **and** whose volume is under 0.001 mm³ (`INTERFERENCE_THRESHOLD`, below which the collisions do not count an overlap either; the leftovers of H are at most 6 · 10⁻⁴ mm³), and calls an intersection that leaves nothing `emptyResult`. A piece with any other surface stays, however small, and so does the shell of a cavity. A piece that is all sheet and holds more (material thinner than the sheet tolerance over a large area, which the coordinates cannot tell from a sheet) is neither dropped nor kept silently: it is `kernelFailure`. What is left then gets the check of sheets as a union does. Composing an intersection of two differences, which do keep the guarantee, measured worse ("Measured", G).

### The operands of a boolean of bodies get numbers of their own

Two bodies of a model can share face numbers: the two parts of a split, two bodies cut by one feature, a body and the pocket a kept tool left in another. The adapter was never given such a pair, and a union of one comes out with a wrong volume, silently, in about half the cases tried ("Measured", D). So `booleanOfBodies` replaces every face number of the tool by a temporary one above the table for the call and puts the numbers back in the result. A face that both operands had is one face again afterwards.

- **The precondition is stated and enforced.** For a union and a difference the port now says that no number may be in both operands (the comment of `SolidKernel` in `types.ts`, and [ports.md](../../architecture/ports.md)), and the adapter throws when one is: one pass over the two lists. Every caller of today passes it (a tool built by `applyTool` has fresh numbers; the collisions ask for intersections, which the rule does not concern). A later caller that hands two bodies of a state to the kernel gets an exception, not the wrong volume.
- **It reduces the silent error, it does not remove it.** With numbers of their own, 12 of 877 joins of the hardest case still have a wrong volume and 63 a remnant of a face that should be gone. The next decision is about those.

### The engine checks the result of a union and a difference

The port says that a silently defective body must not be returned, and lists where the adapter does return one: a round face of the tool that coincides with a round face of the body, detail under its resolution. With extrusions as the only tools those were rare. A combine makes them everyday: a pin joined to the plate whose hole it fills, two shells joined again, a bearing in its seat.

So `booleanOfBodies` checks what the kernel returns for a union and a difference (and, after the sheets are dropped, for an intersection the second check), and a result that does not pass is the error `kernelFailure`, with the tool in `refs` and a detail that says which check failed. `changed` is decided first. A result without effect skips the check of sheets, so a kept tool subtracted a second time is `noEffect` and never a refusal of its coincident faces; the volume identity is still made for it (its shared volume is about nothing, so it passes), because `changed` of a union is the volume alone and a kernel that returned the target untouched although the tool overlapped it would otherwise pass as `noEffect`. A tool that misses costs an empty intersection.

Two quantities of the existing code: p, the precision of the coordinates of the two operands (`coordinatePrecision` of `mesh-distance.ts`: a millionth of the largest coordinate, a millionth of a millimetre at least), and the band of guarantee 3: faces within 10⁻⁵ D are one plane for a union and a difference (D the diagonal of the box of the two bodies, at least twice their largest coordinate; [ports.md](../../architecture/ports.md) states "Stejná rovina 1e-5 D"; 4 · 10⁻⁵ D is how far the adapter then shifts a face, not the band). Today ports.md gives the number as the adapter's own; the implementation writes it into guarantee 3 as part of the port's promise, with an adapter test that pins it, so that the engine relies on the port and not on Manifold.

- **The volume**, against the identity vol(A ∪ B) = vol A + vol B − vol(A ∩ B) (for a difference vol A − vol(A ∩ B)), with one more call of the port for the intersection.
  - The intersection keeps no band, so it is not a point but a range: a piece of it no thicker than the band on average (twice its volume over its area, as `thickestPiece` of `solid.ts` measures a piece; a slab where the two bodies nearly touch, side walls and all) is one the union and the difference may treat as flush or as overlap. The shared volume is then between the volume without such pieces and with them, and the result has to fall in the range the identity gives. Codex measured the case it is for: a target less a tool that is a box 10⁻⁴ from flush on it and a cube inside it; the adapter answers 992 mm³ (right), the intersection holds the cube and a slab of 0.01 mm³, and without the range the result would be refused. The box alone is `noEffect` as a difference (the adapter shrinks it off the target) and exact as a union.
  - Tolerance at both ends: the largest of 0.001 mm³ (`INTERFERENCE_THRESHOLD`), `VOLUME_TOLERANCE` (10⁻⁶) of the two volumes together, and `VOLUME_AREA_FACTOR` (0.1) · p · the two areas together (the rounding of new vertices grows with the surface they lie on and with the distance from the origin; near the origin the term is of the size of the others (the plate of J: 7 · 10⁻³ against 7.7 · 10⁻³ mm³; the motor of D: 0.07 against 0.064), so the counts of I, made with the first two terms, may change where a wrong volume was flagged by the volume alone (1 along an axis): I is to be run again with the three; the factor is to be confirmed by the fuzz of "To verify", 2, far from the origin).
  - When the port refuses the intersection (it does in 0.19 % of the sliver fuzz at the origin and 2.2 % 450 or 2000 mm away, [ports.md](../../architecture/ports.md), "Omezení"), the volume check is skipped and the check of sheets alone decides; the result stands. The intersection as computed (`intersectionAsComputed` of D50, never less than the shared volume) would give a bound on one side there; it is left for later because `modules.test.ts` keeps it to the collisions.
- **Sheets**: area in triangles that lie back to back within the sheet tolerance (`areaOf` with and without it; `areaOf` gets a variant that answers by face number), counted by face number. The sum over the numbers of what the result holds beyond what the operands held under that number (max(0, result − operands)) may be at most `SHEET_AREA_FLOOR` (0.001 mm²). The tool's numbers are its own for the call, so the area a vanished operand had cannot pay for a wall left elsewhere.
  - The sheet tolerance is 10 p, and never more than a tenth of the chord tolerance: the gaps between two polygons of one circle (up to the chord tolerance, "Measured", J) are real, and at a hundred precisions they counted as sheets. With the cap a pin far from the origin or with a fine chord tolerance is not refused for them; that is to be confirmed by the fuzz of "To verify", 2.
  - It is never less than 0.5 p either (revised; it was 2 p). Where a tenth of the chord tolerance is under 0.5 p (a chord tolerance of 0.001 farther than about 200 mm from the origin, 0.01 farther than about 2000 mm) the two demands conflict and the floor wins. A triangle is a sheet only when its centroid, its three vertices and the middles of its three edges each lie within the sheet tolerance of a triangle facing the other way (revised), so a crescent between two polygons, which is thickest in the middle of a side, is no sheet where it is thicker than that ("Revision after the verification", 3).

Measured ("Measured", I and J): the checks flag every wrong volume above the tolerance, the wall of a pin left inside a union, and about two thirds of the joins that leave a remnant of a flush face; they flag none of the 80 unions that a model makes flush on a tilted face. What they do not see is a remnant of a flush face that is no sheet (7 of 436 joins of cut-apart parts along an axis, 26 of 470 on tilted planes, at most 1.2 mm² each, the volume right within 0.005 mm³). That is the known limit, with its numbers; a repair of the adapter for it is a question for the owner ("Open", 2).

The price: one intersection and one search for sheets per tool, 100 ms at most on the bodies measured (the intersection can take seconds where its first cleaning gives up, [ports.md](../../architecture/ports.md)), and a refusal where the body would have been nearly right or where it was right and the checks cannot tell (material thinner than the sheet tolerance; a near-flush case the range does not cover). A refusal can be worked around (the plane moved, the order of the features); a body with a wall inside cannot be seen.

An extrusion that adds or cuts does not get the checks here: its tools are the prisms the adapter is tested for, and a change of every existing feature is not this package's to make. The function is there for it ("For the plan").

### The clearance: every face moved along its own surface

The tool moved outwards by c (`movedOutwards`):

- A plane moves along its normal, away from the material; a cylinder and a cone change their radius (a pin grows, a hole shrinks; the apex of a cone moves along its axis by c / sin of its half angle); a swept side (gear teeth) moves triangle by triangle. Every face maps to one face with a surface of the same kind, so the moved faces have exact descriptions and can be named after the faces they come from.
- A vertex goes to where the moved surfaces of its faces meet. That is the mitre of D44 in space: an outer edge stays sharp and is up to 1.41 c from the tool, an outer corner 1.73 c. For a pocket that is the safe side.
- The topology never changes: the same faces, no face added or lost, but for two things that have no extent in the exact shape, a vertex the move passes over and a carried face that is a polygon of a curve ("Revision after the verification", 1 and 2), which go; a face that would lose all its triangles is refused. What would change it is refused (`invalidClearance`), with the faces named: a hole no wider than twice the clearance, two parts of the tool nearer than twice the clearance.

This is the rule of the profile offset (D44: "computed per curve, not on the polyline … the cheap variant does not change topology"), one dimension up, for the same reasons: names and exact surfaces survive, and it costs milliseconds where the general operation costs seconds. And as there, the general operation of the library stays the route for the full variant.

**How exact the pocket is.** The moved surfaces are exact; the mesh of the moved tool is as good as the mesh of the tool, with one exception ("Measured", E):

- between planar faces the pocket is exact;
- on a round face it may be nearer to the tool than c by the chord tolerance (two polygons of one circle);
- next to an edge where a round face meets another face at a slant, the vertices of the edge move along the round face, the sides of its polygon grow, and the pocket is nearer by a share of c: 12 % where two cylinders cross with their normals 120° apart. The moved tool is not divided again, so the check accepts up to `ROUND_ALLOWANCE` (15 %) and refuses beyond it. Dividing a round face again after the move is the way to remove the share, and is deferred with the fuzz that is to say how often it matters.

**The moved tool is kept** by the identity of the solid of the tool, the clearance and the chord tolerance, as `analyzeBody` keeps what it computes for a solid: a recompute that changes neither does not move the tool again.

The owner's question behind this choice is in "Open".

### Names of the faces

- **Without a clearance** a triangle inherits the name of the face it comes from, as in every boolean. The pocket a motor leaves in a mount has the names of the motor's faces; with the motor kept, such a face lies on two bodies, which a cut through two targets does already. Flush faces follow the rule of the adapter (the overlapped part carries the name of the tool's face; for an intersection that of the target's).
- **With a clearance** the faces the tool leaves are not where the tool's faces are, so they are faces of their own: the name of the tool's face with a copy tag appended, `{ pattern: <the combine>, index: <the number of the tool in tools, from 1> }`. The moved tool is a copy of the tool body, face for face, which is what a copy tag says; the code is that of a pattern of a body with another transform. The index tells apart two tools that share a face. A tool put in front of the others renumbers the tags, so tools are appended. Where two tools share a face name (the two parts of a split as tools), exchanging them makes a tagged name mean the face of the other tool, without an error; for tools that share nothing a wrong index is a broken reference.
  - The reference of the kind `pattern` in a face name accepts a feature that tags faces (`FeatureModule.tagsFaces`): a pattern, and a combine that is a difference. Whether the clearance is there and above 0 is a matter of the recompute; a tag that names no face is `brokenReference` there. The field of the tag keeps its name. The other readers of `tag.pattern` take any feature ID already (`faceKey`, the face label of MCP, the pattern form of the app).
  - A new role with the name of the source face inside it does not fit the catalog of roles: a role has text and whole-number fields, at most one of them a free ID.
- **The cut face** of a split is one face `{ feature, role: 'splitFace' }` on both bodies, with the frame of the plane that cut as its description (origin and Y axis; the normal out of each body comes from its mesh, as for every face). It is there where the plane passes through material: a body of several pieces with a plane between them comes apart without one.
- **One face with material on both sides.** A body put together of others can hold one face number on a hole and on a pin: the cut face after two shells were worked on and joined again, the side of a kept tool on its pocket and on itself after a union. A face name with its body resolves to the triangles of that body, and what reads the triangles is right. What reads the face as one oriented plane is not: `faceFrame` and `outward` of `solid.ts` (a sketch on the face) sum the normals of its triangles, so a planar face with two patches facing opposite ways answers with the orientation of the larger patch, and `brokenReference` when the two cancel (the `meshNormal` of the query `body`, which sums the same way, is then the zero vector) (measured by codex: two unit boxes, one number on opposite faces, joined). That is a known limit of this design, loud in the second case and a sketch on the wrong side in the first; renaming one patch would need a role per patch, and the case needs a union of a body with a kept tool it made a pocket in, or with a part of itself. The clearance minds too: such a face has no single way outwards, and a tool that has one is refused (`invalidClearance`).

### What a body made from others inherits

- **Body properties** (3a). The target of a combine and the body of a split keep their entry. The new body of a split answers `bodySource` with the body it was cut from: it inherits colour, material and use, and the density and the mass as a pair; its name is that of the feature. A density follows the volume by itself. A weighed `mass` does not: after a split both parts would carry the mass of the whole, and after a union the target carries its old one. The feature does not touch the section; the mass is the author's to set again ("Known limits").
- **The mechanism** (5a). The new body of a split is in no link (`unassigned` names it); a used-up tool that a link lists is `missing`. The scenario adds the new shell to the link in the next command.
- **Pattern.** A pattern of a body copies any body, also one made by a split. Neither type leaves a tool recipe (`producesTool` false), so a pattern of features cannot name them.

### No effect, empty result, atomic

- A tool that does not change the target (a difference that misses, a union with a body inside the target, an intersection with a body around it, a kept tool subtracted a second time) is named in the warning `noEffect`; the target is left as it was for that tool, names included. Tools that are not kept leave all the same. The test is that of `applyTool` for a copy of a pattern: the volume is what it was and, for a difference and an intersection, every face of the tool in the result lies on the surface the target had (for an intersection the volume alone would let a tool around a large target that trims a sliver off pass as no effect). It is made inside `booleanOfBodies`, on the temporary numbers: after they are put back, a face the target already had from that tool cannot be told from one it got now.
- `emptyResult`: a difference or an intersection would leave nothing of the target; a split would leave one part empty.
- The feature is atomic, as a pattern is: any error leaves the model as it was.

### Imported bodies (3b, designed at the same time)

Package 3b (D55, on its own branch) gives an imported mesh one face without an exact surface and the error `importedTarget` for a feature that would change such a body, checked in `applyTool`, which a combine and a split do not go through. What 3d does with such a body, whichever of the two is merged second:

- **As the target of a combine, or the body of a split: `importedTarget`**, by the same rule (no feature changes an imported body; the mesh of a bought part is not the author's to cut).
- **As a tool without a clearance: refused too**, with the same error and the tool in `refs`. 3b calls a body imported when it has a face of an imported mesh (its contract, `importedTarget`), so a pocket or a union with a mesh would turn the target into an imported body, and every later extrusion, hole or combine on it would end in `importedTarget`: a mount could not get a screw hole after the motor was subtracted. 3b's reason (flush faces on the flats of a mesh are unsafe) holds for the target as much as for a tool. Whether to allow it, with the target then imported, is "Open", 3.
- **As a tool with a clearance: `importedTarget` too**, checked before the tool is moved; `noSurface` is left for a tool that may take part but has a face without a description. Were the owner to allow imported tools ("Open", 3), a clearance would still be `invalidClearance` (`noSurface`) until the full variant of the clearance exists. This is the backlog's own example of the import (a bought part read as a mesh and subtracted with a clearance), and the cheap variant does not serve it; "Open", 1, says so.

## Recompute

### Combine

1. The target and every tool are looked up in the state before the feature: `brokenReference` with the missing ones in `refs`. With 3b in the tree, an imported target or tool is `importedTarget` here, before anything is moved.
2. For each tool, in the order of `tools`:
   - **With a clearance above 0**: `movedOutwards(tool, …)`. A problem is `invalidClearance` with the tool and the faces in `refs`. The moved faces get the next free numbers of the table, their names (the tag appended) and their moved `FaceInfo`.
   - `booleanOfBodies(kernel, operation, current, tool, firstFree, chordTolerance)`: the port's boolean with the numbers of the tool made its own, `changed`, and, when changed, the checks of the result. An exception of the port or of a check is `kernelFailure` with the tool in `refs`.
   - A result without a triangle is `emptyResult` (`refs`: the target and the tool).
   - `changed` false: the result is dropped and the tool noted for `noEffect`.
3. The state: the target with its new solid; the tools removed from the bodies unless kept; the moved faces of the tools that had an effect appended to the face table.
4. The result: `ok`, or `warning` with `noEffect`; `bodies` is empty.

The step is a function of the feature and the state before it, as every step: the temporary numbers never leave `booleanOfBodies`, and the memo of the evaluator (by the identity of the feature and of the state before) holds as it is.

### The moved tool (`movedOutwards`)

1. **Sides.** For every triangle, which side of the surface of its face the material is on: the sign of its normal against the surface. A face whose triangles do not agree (slivers aside) is the problem `bothSides`. A cylinder with the material outside (a hole) and a radius no larger than c is the problem `closes`, before anything is solved.
2. **Vertices.** The conditions of a vertex: for each exact face it lies on, "the signed distance to the surface is c"; for each triangle of a swept face, "the move along its normal is c" (sliver triangles aside, whose normals are noise: `moveVertices` of the kernel adapter skips them for the same reason). Gauss–Newton from where the vertex is, each step the shortest move that satisfies the linearised conditions (in an orthonormal basis of their normals, as `minimalShift` of the kernel adapter), until a step is below 10⁻¹⁰ mm, eight steps at most. Up to three independent conditions are met exactly.
   - A vertex that ends more than 10⁻⁴ mm off a condition is solved once more without the conditions of **narrow faces** (faces all of whose triangles are narrower than the chord tolerance: twice the area over the longest side). When that succeeds, those faces are *carried along* at that vertex: they have no extent in the exact shape there (the crescent between two polygons of one circle). A carried face then has to lie on its own moved surface within the chord tolerance at every one of its vertices, or it is the problem `vertex`: so its published description is exact to the chord tolerance, as a polygon of a round face is, and a face that is narrow but real (a step 0.005 high made of narrow triangles) is either moved or refused, never left behind by more than that. A carried face all of whose vertices lie within the chord tolerance on its own surface and on the surfaces of the same two other faces that cross there has no extent; it is exempt, its triangles go to one of the two and it has no moved description (revised, "Revision after the verification", 1).
   - Otherwise the vertex cannot follow its faces: the problem `vertex`.
   - **Passed-over vertices** (revised, "Revision after the verification", 2): an edge the move turned round is collapsed into the vertex with more faces when the faces of the other are a proper subset of them; whether the mesh is still one closed surface is checked afterwards.
3. **Planar faces** are triangulated again, but for a face that was carried along at a vertex, which keeps its triangles. The outline of the face is the directed edges of its triangles that have no opposite in the face, chained into loops; in the plane of the face the moved loops must not cross (a test of segments; the problem `outline`); `kernel.triangulate` makes the triangles. Round and swept faces keep theirs.
4. **Checks**, each a problem of its own:
   - the mesh is closed (every edge twice, once each way): a guard of step 3;
   - no triangle of a round or swept face turned over (`turned`): a hole no wider than twice the clearance, a tooth space that closes;
   - no edge of the moved mesh goes through a triangle of it (`crosses`): exact for two faces that cross;
   - **no point of the moved surface is nearer to the body than the clearance** (`tooNear`): for two faces that passed through each other and stayed parallel, which the crossing test does not see. See below.
5. **The moved descriptions**: a plane's origin moved by c along its normal out of the body, a cylinder's radius, a cone's apex (by c over the sine of its half angle, along the axis), a swept surface as it is.

A face of a general surface (no feature makes one yet) is the problem `noSurface`.

That every face moved outwards and not inwards follows from steps 1 and 4 together: the direction of a face is that of its own triangles, which all agree, and no triangle turned over.

### The checks of the moved tool

The last check is the one that sees two parts of the tool meet: the tips of a C, the walls of a slot, two pins.

- **The points**: every vertex, the middle of every edge and the centroid of every triangle of the moved mesh. A flat triangle on a round face is deepest in the middle of a side or inside, so these are where a round face is nearest.
- **Against**: every triangle of the body as it was that shares no vertex with the place the point came from; and a point of a cylinder or a cone against the exact surface of its own face (revised: the triangles round the point, left out above, would hide a round face that comes nearer to itself than the bound).
- **The face of a point** is the face its triangle came from: a triangle of an exempt face is measured as a carried face, not as the face its number went to (revised).
- **The bound** by the pair of faces (the face of the point, the face of the triangle):
  - neither the same face nor neighbours, or both planar: c less p (`coordinatePrecision`). Two planar walls 2c apart are told from two walls a hair nearer.
  - the same face or neighbours (they share an edge), one of them round: c · (1 − `ROUND_ALLOWANCE`) less the chord tolerance. The chord tolerance is for two polygons of one circle; the share, 0.15, is for the sides of a polygon that grew because a vertex moved along the round face ("How exact the pocket is"; measured 0.12 at most). A tool that would need more is refused.
  - a face that was carried along, on either side: c less the chord tolerance (a face narrower than that cannot be nearer by more than its width); an exempt one too, though its triangles carry another number in the moved tool.
- What the allowance could hide, a round face that meets itself or its neighbour, is what the check of turned triangles, the crossing test and the outline of the planar faces see: a hole that closes turns its triangles over, a tooth space that closes crosses the outline of the cap.
- **It is a test of samples, not a proof.** Two faces that come nearer than c only between the samples pass it. The checks of the adapter do not stand behind it (they look at the closure and the folds of the result, not at a clearance). What stands behind it is the fuzz of "To verify before the implementation", and `gap`, which measures what a pocket is.
- A clearance smaller than 10 p cannot be told from none by these checks and is refused before anything is moved (`tooSmall`, without faces); so is one not more than twice the chord tolerance when the tool has a face that is not planar (revised, "Revision after the verification", 2).

### Split

1. The plane is resolved with `frame(plane, state)` in the state before the feature (`brokenReference`, `nonPlanarFace`); the body is looked up (`brokenReference`).
2. Two boxes, `halfSpaceBox(body, plane, 'forward', first)` and `'backward'`: the extent of the body in the frame of the plane, a margin of the larger of 1 mm and 5 % of its diagonal, the face in the plane numbered `first` (the next free number), the five others `first + 1` to `first + 5`. A side on which the body has nothing: `emptyResult`.
3. `kernel.boolean('difference', body, box)` for each box: the body less the box on the side `side` stays the body, the body less the other box is the new body. An exception is `kernelFailure`; a part without a triangle is `emptyResult`; a part that holds a number above `first` is `kernelFailure` (a guard: the five faces lie outside the body); the two volumes have to add up to the body's within the tolerance of the volume check (its three terms taken with the volume and the area of the body alone), or it is `kernelFailure` too.
4. The state: the body with its new solid, the new body under the ID of the feature, and one face appended: `{ feature, role: 'splitFace' }` with `{ planar: true, origin, y, normal }` of the frame of the plane. The result names the new body in `bodies`.

The boxes have fresh numbers, so the rule of own numbers has nothing to do here.

- **The plane as a face of the body itself** is resolved before the split and is not read again. Afterwards the face is on the part it lies on; a later feature that names it with the body that lost it ends in `brokenReference` (`faceFrame`), a projected edge of it in `brokenProjection`.
- **A body of several pieces with the plane between them** comes apart with no triangle in the plane: both parts are there and neither has the cut face. The face is in the table all the same; a sketch on it is `brokenReference`.
- **A face of the body in the plane** keeps its name (the box's face flush on it, the adapter's ordinary case), with the exception [ports.md](../../architecture/ports.md) states for a cut: where the plane also holds the underside of an overhang, the part of that underside the cut face lies on takes the name of the cut face. The geometry is right, and a reference to the renamed part is `brokenReference`.

## Document and validation

- **Combine**: `operation` one of three; `target` a body (a reference of the kind `body`); `tools` a non-empty list of bodies, none twice, none the target; `keepTools` a boolean; `clearance` a numeric field `clearance` (`CLEARANCE`: mm, 0 or more, default 0), optional by the rules of 2a ("An optional numeric field": the default is what an absent field means, a given 0 is kept and computes the same, and `setField` reaches the field while the feature does not have it because its description has a default), and an invalid command with another operation than `difference`. The validator lists its fields; anything else is refused.
- **Split**: `body` a body; `plane` a `PlaneRef` validated by `planeRef`, as the plane of a sketch; `side` one of two.
- **References** (`refs`): the target and the tools, the body and the plane (`planeRefs`). So `moveFeature` keeps both types behind what they name, and a command verifies a reference the feature did not have before.
- **`updateFeature`**: combine `operation`, `target`, `tools`, `keepTools`, `clearance`; split `body`, `plane`, `side`. `clearance: null` removes the field also where there is none; a patch to another operation than `difference` removes the clearance by itself (as a patch to `new` removes the targets of an extrusion).
- **A face name** in the role `splitFace` has no further field. A copy tag whose `pattern` is a combine is valid when that combine comes before and is a difference.
- **What a section may name.** `createsBody` of a split answers for its own ID, so body properties and a link may name the new body; the text of `bodyProblem` lists a split among what makes a body.
- **The schema: no upgrade step.** A build without the package refuses a document that holds either type (`feature` in `document.ts` takes the type from the registry), and with it a face name in the role `splitFace` (`faceName` takes the role from the catalog). A copy tag that names a combine is in a document that holds that combine, or held it: after the combine is removed the tag is a reference to a removed feature, which every build loads and reports as `brokenReference`. Nothing is dropped without a word.

## Where the code lives

| File | What 3d does there |
|---|---|
| `types.ts` | `CombineFeature`, `SplitFeature` in `Feature`; their patches in `FeaturePatch`; `splitFace` in `FaceName`; `invalidClearance` in `ErrorCode`; the comments of `CopyTag` and `FaceName` (a tag of a combine); the comment of `SolidKernel.boolean` (no number in both operands of a union and a difference) |
| `features/combine.ts`, `features/split.ts` | the two modules: validator, references, step |
| `features/index.ts` | two lines of the registry; `requireRef` of the kind `pattern` asks `tagsFaces`; the text of `bodyProblem` |
| `features/module.ts` | `tagsFaces` |
| `features/pattern.ts` | `tagsFaces: () => true` |
| `recompute/body-boolean.ts` | `booleanOfBodies` with its checks, `halfSpaceBox` |
| `recompute/moved-body.ts` | `movedOutwards` with its checks and its memo |
| `recompute/services.ts` | the text of `invalidClearance` in `MESSAGE` (`onSurface` of `solid.ts`, which `applyTool` uses for a copy that lands on what is cut already, is the test of `changed` in `booleanOfBodies` too) |
| `solid.ts` | the pieces of a mesh (`pieceSolids`, there already) exported for the sheets of an intersection; the side of a round face, which `query/body.ts` computes as `convex`, shared |
| `face-roles.ts` | the entry `splitFace` |
| `validation.ts` | `REF_LABEL.pattern` says what it now accepts |
| `sketch-tools.ts` | two lines of `PROFILE_SOURCES` (neither type has a profile) |
| `sections/body-properties.ts` | the text of the section's summary: a body made by a split inherits as a copy of a pattern does |
| `packages/kernel-manifold/src/index.ts` | `boolean` throws for a union or a difference whose operands share a face number |
| `packages/mcp/src/api.ts` | a paragraph of `CONVENTIONS`; the sentences that say what the ID of a body is (also a split) |
| `packages/mcp/src/tools.ts` | the two texts that say what a body ID is (the error of a missing body, the description of the argument `body`) |
| `packages/app` | below |

The modules import the services and `recompute/`, never the registry (`modules.test.ts` gets their rows).

## The app and MCP

- **MCP** needs no code for the features: `execute` and `preview` take them, and `describe_api` prints the types of `types.ts`, the two entries of the registry with their fields and the role from the catalog. Texts change: the three places that say a body is an extrusion `new` or a copy of a pattern (above), and `CONVENTIONS` gets one paragraph:
  - how a part is subtracted with a clearance, that the tool is kept, and how exact the pocket is;
  - that a union uses its tools up, and that a later feature naming a used-up body is a broken reference while a projected edge of it only warns and stays where it was;
  - which part a split makes new, and that after a split a feature through both parts lists both bodies;
  - how the faces of a pocket are named;
  - that bodies flush on a round face or cut apart and joined again may be refused (`kernelFailure`), and that `gap` and `measure` verify a clearance.
- **`FEATURE_UI`** gets two entries (a type without one does not compile), each a file in `features/` and a button of the toolbar.

| Form | Reads | Commands |
|---|---|---|
| Combine | the bodies of the state before the feature, by their names | a select of the operation; a select of the target; the tools as a list of check boxes; a check box "Keep the tools"; with a difference the field "Clearance" (`draftField`, absent when empty). A click on a body in the view toggles it among the tools (the first click of a new draft sets the target). The draft is incomplete without a target and a tool |
| Split | the bodies of the state before; the plane's label (`planeText`) | a select of the body; the plane by the button *Pick* (a planar face, a plane feature or a base plane, as the mirror of a pattern picks its plane; `picks` answers faces and planes while armed); a select "New body: in front of the plane / behind it". A click on a body while *Pick* is not armed picks the body. The draft is incomplete without a plane |

- **The model panel** (`summary`): a combine says its operation, its target, its tools and what became of them ("used up" or "kept"), and the clearance; a split says its body, its plane and the new body, and lists the later features that name its body and not the new one ("still on the upper part only: …"). `ownsFace`: a split its cut face; a combine the faces that carry its tag. `hideable`: a split (it has a body), not a combine.
- **The body panel**: the hint "A copy of …" of an inherited body reads "Cut from …" for the body of a split.
- **The view** needs nothing: bodies come and go with the state, and the preview of a draft is the state the view shows.
- **`issue-text.ts`**:
  - `ROLES` gets `splitFace`.
  - `issueText` names only the string refs of an issue and the copies of a pattern today. It learns to print a face name in `refs` (through `faceLabel`) for `invalidClearance`, after the tool body; without that the faces the design promises would not be shown. `NAMED` gets `invalidClearance` and `kernelFailure`, whose string ref is the tool.
  - `faceLabel` reads every tag as "copy n of <feature>". To word a tag of a combine ("pocket of <feature>, tool n") it has to know the type of the feature of the tag, which `nameOf` does not give: it gets a second function for it, as `issueText` has `bodyNameOf`.

## Issue codes

| Code | Kind | When |
|---|---|---|
| `invalidClearance` | error, new | a tool of a combine cannot be moved outwards by the clearance: a face would vanish or turn over, two parts of the tool are nearer than twice the clearance, a vertex cannot follow its faces, a face has material on both sides, a face has no description; or the clearance is under ten precisions of the coordinates, or not more than twice the chord tolerance on a tool with a face that is not planar (`tooSmall`). `refs`: the tool, then the faces (none for `tooSmall`) |
| `brokenReference` | error | the target, a tool, the body or the plane is not in the state before the feature |
| `nonPlanarFace` | error | the plane of a split is a round face |
| `emptyResult` | error | a difference or an intersection would leave nothing; a plane does not cut the body |
| `kernelFailure` | error | the kernel refused a boolean, or its result did not pass the checks of the engine (the volume, sheets, a piece of an intersection that is all sheet and holds material); the detail says which. `refs` of a combine: the tool |
| `noEffect` | warning | `refs`: the tools that did not change the target |
| `importedTarget` (3b) | error | the target or a tool of a combine, or the body of a split, is an imported body; `refs` that body; only with 3b in the tree |

## Shared vocabulary

- **Takes:** `PlaneRefAfter`, `FaceRoles`, `IssueCodes`, `FeatureTypes` and `FeaturePatches` of the preparatory step; `bodySource` of 3a; the copy tag of the pattern (D35, D53); the optional numeric field of 2a.
- **Adds:** the feature types `combine` and `split`, the role `splitFace`, the code `invalidClearance`, `FeatureModule.tagsFaces`. No kind of surface, no kind of edge.

## Rejected alternatives

1. **The sum of Minkowski of the library as the clearance** (a member `offset` of the port). It never refuses, rounds the corners, serves a tool without exact faces (an imported mesh), and is the smaller piece of code. Against it:
   - one face without a description for the whole pocket, so no sketch stands on its floor, nothing in it is measured exactly, and no later feature names a face of it;
   - 3 to 8 times the triangles of the tool in the pocket, which every later boolean of that body then carries;
   - the time: 1.6 to 4.4 ms per triangle of a tool that is not convex (4 s for a motor with screw holes, 8 to 17 s for a housing). Kept by the solid of the tool and the clearance, as the moved tool of this design is, it is paid once per change of the tool or of the clearance and not at every recompute; it is paid at every load of the document (geometry is not stored), in every preview while the clearance is typed, and the recompute is synchronous.

   Kept as the route of the full variant; the names of this design leave room for it (the faces that lie on a moved face of the tool keep the tagged names, the rounding gets one more face).
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
14. **Leaving the result of the kernel unchecked**, with the measured rates as a known limit. The port forbids a silently defective body, and with a combine the cases in which the adapter returns one stop being rare. The checks cost one intersection and one search for sheets per tool.
15. **Renumbering inside the adapter.** The adapter would have to know which numbers are free; the engine owns the table. The adapter refuses shared numbers instead.
16. **A warning on a split for later features that name its body.** Every split of a body that anything names would warn for ever; the app lists them in the entry of the split, and the description for the AI states the rule.
17. **A clearance above 0 only, as a field of a second kind.** `setField` reaches an absent field through the default of its description (D44); a positive-only field would need another rule in `document.ts` and in `describe_api`. A clearance of 0 computes as none.

## Known limits

- **The clearance is more than twice the chord tolerance** on a tool with a face that is not planar (revised): one not more is `tooSmall`. The rule is a margin chosen to keep the bound of a round face at 0.35 c or more; the bound itself reaches nothing only at about 1.18 chord tolerances.
- **The clearance is refused where the tool has detail finer than twice the clearance** (a hole, a slot, a gap), where more than three faces meet at a vertex in a way their moved surfaces do not, and where a face has material on both sides. The message names the faces; the tool has to be simpler (bought parts are modelled simplified here anyway) or the clearance smaller.
- **A tool without exact faces has no clearance**: an imported mesh of 3b, a general surface.
- **Corners are sharp**: the pocket is up to 1.41 c from an outer edge of the tool and 1.73 c from an outer corner, and more where two faces meet at a sharp angle.
- **The pocket may be nearer than the clearance on round faces**: by the chord tolerance everywhere, and by up to 15 % of the clearance next to an edge where a round face meets another face at a slant (0.87 c measured where two cylinders cross). Between planar faces it is exact.
- **The clearance is all round.** A tool that sits on a face of the target floats over it by c. The scenario subtracts from a body that does not reach under the tool.
- **The check of the distance samples** (vertices, middles of edges, centroids). Two faces that come too near only between the samples would pass; nothing stands behind it but the fuzz that is owed and the `gap` query.
- **A narrow face carried along** (narrower than the chord tolerance, at a vertex that cannot meet it) is not moved by the clearance there; the pocket over it is the join of its neighbours, and the face lies on its published moved surface within the chord tolerance (checked), not exactly. A carried face that lies on a curve two other faces cross in (revised) is not published at all: a real face narrower than the chord tolerance there (a ledge of 0.001 between a countersink and its bore) cannot be told from a polygon of the curve and goes the same way; a later reference to it in the pocket is `brokenReference`.
- **A weighed mass is not divided or added**: after a split both parts answer with the mass of the whole when the body had `mass`, and a union keeps the mass of the target.
- **After a split, a later feature that names the body works on the part that kept the ID**, without a word; a patch of `side` moves it to the other part.
- **A part of a split may be several pieces** and is one body; a body of several pieces may come apart without a cut face.
- **A face in the plane of a split that is the underside of an overhang** may take the name of the cut face in part (the limit of the adapter for a cut).
- **Bodies cut apart and joined again**: the seams of the two parts agree only to the precision of the coordinates. Measured with the checks in place: 21 of 436 joins along an axis and 78 of 470 on tilted planes are refused (`kernelFailure`), and 7 and 26 pass wrong: with a remnant of the cut face of at most 1.2 mm² (7 and 23), or with a volume off by at most 0.005 mm³ (4 tilted). A body flush on a tilted face as a model makes it (a mirror image in a face, a body from a sketch on a face) measured clean, 80 of 80.
- **Bodies flush on a round face.** A pin joined to the plate whose hole it fills is exact when the two polygons have the same vertices to the last digit, and is refused by the check of sheets when they differ in the last digit (the wall would stay inside). A pin with a turned polygon leaves gaps of up to the chord tolerance in the union, as the meshes say. The limits of the adapter for an addition and a cut hold for a combine as they are ([ports.md](../../architecture/ports.md), "Omezení"); a tool is now any body, not a prism.
- **The checks of the result do not see everything**: a remnant of a flush face that is no sheet, a volume off by less than the tolerance. When the port refuses the intersection (0.19 % to 2.2 % of the sliver fuzz) the volume is not checked. They refuse what they cannot tell from a defect: material thinner than the sheet tolerance, a near-flush overlap on a piece that is not a slab of its own (the range covers slabs only).
- **A planar face with patches facing opposite ways** (one number on a hole and a pin after a union with a kept tool) gives a sketch on it the orientation of the larger patch, or `brokenReference` when they are equal.
- **An imported body takes no part in a combine or a split** while 3b calls a body with a face of a mesh imported ("Open", 3).
- **An intersection has no tolerance for flush faces.** Where the two bodies also touch from outside, a sheet joined to the result is refused by the check of sheets when it has more than 0.001 mm² (`kernelFailure`; how often an ordinary intersection meets it is for the fuzz of "To verify", 2); one that is a piece of its own is dropped when it holds under 0.001 mm³ and refused when it holds more.
- **The sheet tolerance far from the origin with a fine chord tolerance** is held at 0.5 p, above a tenth of the chord tolerance (revised): a union of a pin whose polygon is turned by less than about a tenth of a side against its hole may be refused for the gaps of the two polygons (with a chord tolerance of 0.001: 3 of 16 at the origin, of which one turned by 0.2 % of a side with gaps under 10⁻⁵ mm, 4 of 16 at 450 mm, 2 of 16 at 2000 mm; with 0.01: 2 unions and 1 difference of 16 each at 2000 mm). The test of a sheet samples seven points of a triangle; a wall thicker than the sheet tolerance only between them is not seen, and where the kernel cuts a crescent into small triangles near the crossing of the two polygons, those triangles are sheets. A wrong union also passes when the port refuses the intersection of the volume check and the result holds no new sheet (1 near-flush union at 2000 mm, 1.19 mm³ off against a tolerance of 0.81). An intersection the second cleaning of D51 answered may hold a triangle without an area under the number of a face that is gone.
- **A face that lies on two bodies** (a pocket without a clearance and its kept tool) is one name; a reference to it says which body.
- **Tags are numbered by the place of the tool in `tools`**: a tool put in front renumbers them, and two tools that share a face name exchange their tagged faces when they are exchanged, without an error.

## To verify before the implementation

1. **A fuzz of `movedOutwards`**, in the manner of the kernel fuzz: bodies of prisms, cylinders, tapers, cuts and holes in random places (holes nearly tangent to round faces among them), clearances from 0.02 up, and more than one chord tolerance. Every accepted mesh has to go through the adapter as the tool of a difference with the pocket no nearer to the body than (1 − `ROUND_ALLOWANCE`) c less the chord tolerance, and has to hold the sum of Minkowski of the body with a ball but for that much (the library through the adapter's `wasm`, tests only). Every refusal is sorted by its reason, and a sample of each is looked at. The allowance (0.15; 0.12 measured on one body, with its cause understood), the set of sample points and the rule of narrow faces are confirmed or changed by it (the lid of E, whose crescents are why faces are carried, was accepted before a carried face had to stay within the chord tolerance of its moved surface: its verdicts are to be taken again with that check); if the share turns out to be hit often, the round faces are divided again after the move.
2. **A fuzz of unions and differences of two finished bodies** with the numbers of the tool made its own and the two checks: tools with bosses, holes and cones, flush on planes along an axis and on tilted ones, flush on round faces; near-flush (offsets from 0 to two bands of guarantee 3, a slab of its own beside a real cut, and a shared piece with one face near-flush); intersections of bodies that overlap and also touch from outside (the rate of refusals by the check of sheets); a turned pin in its hole with a chord tolerance of 0.001, the leftovers of H and a wall left inside a union, everything again 450 and 2000 mm from the origin (`VOLUME_AREA_FACTOR`, the cap and the floor of the sheet tolerance); how often the port refuses the intersection there; and the joins of I again with the three terms of the volume tolerance. What it refuses goes into "Known limits" with its rate; what passes wrong is looked at for a third check, or goes to a repair of the adapter ("Open", 2).
3. **The time of the checks of the result** on bodies of several thousand triangles: `areaOf` with a tolerance compares every triangle with every other (the collisions bound it by a count of triangles for that reason). A grid, or a bound above which the check of sheets is not made and the feature says so.
4. **The crossing test of the moved mesh** (an edge through a triangle): the first prototype had it and the last one did not; its time on 5000 triangles.
5. **`kernel.triangulate` with several outer loops and their holes in one call** (the prototype uses it so, on every planar face of the thirteen bodies), and its time on the cap of a gear (1.5 s once).
6. **The time of the distance check** on a body of 5000 triangles with a grid that is not keyed by strings (the prototype: 0.2 to 0.7 s).
7. **A tool that is a mirrored copy, and a tool that carries tags already**: the tag of the combine goes last.
8. **With 3b in the tree, if the owner allows an imported tool** ("Open", 3): the case 3b measured (a plate less the imported box, 15 % more surface): the check of sheets has to flag it.

## Verified before the implementation

Run on 2026-11-17 by Claude Opus 5.5 on branch `d36/3d`, against the two functions of the recompute as written for the implementation (`booleanOfBodies` and `halfSpaceBox` in `recompute/body-boolean.ts`, `movedOutwards` in `recompute/moved-body.ts`, with the constants of the contract) and the adapter with its new precondition. Spike scripts in the session scratchpad (`3d-impl/`, not in the repository). **Three results contradict statements of the design** (marked); the implementation stopped there, and the design was revised for those three only ("Revision after the verification", below).

**The precondition of the adapter** (a union or a difference whose operands share a face number throws): every test of the repository passes with it (77 files, 1188 tests); no caller of today passes shared numbers.

**1. The fuzz of `movedOutwards`**: 300 random bodies (a block with some of: a boss as a cylinder or a cone, a step, a through hole, a blind hole, a horizontal hole nearly tangent to the boss, a slot; or a lone cylinder or cone), clearances 0.02 to 2 (log-uniform), chord tolerances 0.003, 0.01 and 0.03.

- 218 accepted. Every one went through the adapter as the tool of a difference, and no pocket was nearer to the body than (1 − 0.15) c − the chord tolerance (the smallest, 0.21 c, is a clearance of 0.025 with a chord tolerance of 0.03, where the bound is below zero). The sum of Minkowski with a ball of 16 segments, on 22 of them: the thickest piece of it outside the moved body is 0.029 c. The allowance and the sample points hold.
- 82 refused: `closes` 14; `vertex` 26, every one off by c/10 or more (the samples looked at: the opening a hole leaves in the top face closes as the top moves up and the hole shrinks); `tooNear` 4 (a slot narrower than 2c); `crosses` 1; `outline` 18; `turned` 19.
- **Contradicts "every refusal is right" (E).** Of the `outline` refusals 11 are a side of the outline shorter than 2c that the move reverses: where an arc of a round face meets a line at a slant, the meeting point slides along the line past the next vertex of the polygon of the arc; the moved exact surfaces are fine, the vertex should have vanished. Of the `turned` refusals 13 have every turned triangle narrower than c: long slivers of a hole's side, cut by a boolean with a boss, flip when their vertices move along different surfaces. About 24 of 300 bodies (8 %) are refused although their exact shape moves without a change of topology. The remedy the design names for the allowance (dividing round faces again after the move) would also be the remedy here; it is deferred in the design.
- **Contradicts the purpose of a carried face.** The lid of scenario 12 (a countersink made by hand: a tapered cut and a bore, the crescents of `sink/endCap` between them) is refused at every clearance (0.2 to 2) as `vertex`: at c = 0.3 a vertex of the carried face ends 0.12 from the plane of the face where the moved plane is 0.3 away, so the face is 0.18 mm off its moved surface, more than the chord tolerance. Before the check of round 2 the lid was accepted (0.970 c to 0.996 c). The crescents were the reason faces are carried at all.
- The other bodies of E, verdicts by clearance 0.2 / 0.3 / 0.5 / 1 / 2: block, box with its cavity, plate 0.005 thick, carrier: accepted at all five (1.000 c; carrier 0.996 c); cylinder of scenario 13: accepted at all (0.999 c); NEMA-like motor: accepted to 1 (0.994 c), `closes` at 2 (the four screw holes); sun: accepted to 0.5 (0.994 c), `outline` of its cap at 1, `closes` at 2; housing: accepted at 0.2 and 0.3, `outline` (the cap of the bore with the ring's teeth) at 0.5 and 1, `closes` at 2; L with two crossing cylinders: accepted to 1 (0.872 to 0.885 c), `closes` at 2; C with tips 0.4 apart: accepted at 0.2, `tooNear` above; plate with two pins 0.5 apart: accepted at 0.2, `outline` above; plate with a slot 0.5 wide: accepted at 0.2, `tooNear` above.
- A mirrored copy of the NEMA-like motor and a copy of that copy (two tags): accepted at 0.2, 0.3 and 1 ("To verify", 7; the tags of a combine are not written yet).

**2. Unions, differences and intersections of finished bodies** through `booleanOfBodies`:

- *I again, with the three terms of the volume tolerance* (the joins of D): along an axis, 436 joins: 8 refused by the adapter, 12 flagged (all by sheets, none by the volume); 1 passes with a wrong volume (0.032 mm³: inside the area term of the tolerance, 0.07 on the motor), 7 with a remnant of the cut face of at most 0.18 mm². Tilted, 470 joins: 21 refused by the adapter, 57 flagged (1 by the volume, 56 by sheets); 4 pass with a wrong volume of at most 5.4 · 10⁻³ mm³, 23 with a remnant of at most 1.2 mm². The 80 unions flush on a tilted face as a model makes them (F): none flagged. The pin of J: as measured there (the wall left inside after both bodies are turned in space is refused by sheets, 2 of 2; everything else right).
- *Bodies a model makes flush*, at the origin and 450 and 2000 mm away, along the axes and turned in space, 40 poses each: a tool with a boss and a blind hole standing on a block or sunk into it (union, difference, intersection): all right at the origin and 450 mm; at 2000 mm 1 of 20 unions and differences refused by the volume, in every such case because the kernel's answer was wrong; none passed wrong. A slab near-flush on the target together with a cube inside it (codex's case) as a difference: right in all 120.
- *Near-flush within two bands of guarantee 3*: unions of a box 0 to 2 bands above or into the top, and a box sunk into the top with one side within 2 bands of the target's side: the volume refuses 15 to 45 % (by place and pose); in all but 2 of those the kernel's answer itself was wrong (the adapter, given a gap inside the band, leaves the band its shift opened as material: 0.03 to 15 mm³). 1 passed wrong (2000 mm, turned: 1.19 mm³ against a tolerance of 0.81). This is a silent defect of the adapter's union that the checks turn into a refusal; an extrusion that adds is exposed to it as well (no checks there).
- *Intersections that overlap and also touch from outside*: right at the origin and 450 mm; at 2000 mm, turned in space, 7 of 20 are `kernelFailure` because the piece that is all sheet holds 0.001 to 0.0033 mm³ (the floor of 0.001 mm³ does not grow with the distance). The leftovers of H: an intersection of bodies that only touch on a tilted plane is `emptyResult` in all 120 cases but 3 at 2000 mm, refused the same way.
- *A pin with a turned polygon in its hole* (union and difference, 16 each per row): **contradicts "with the cap a pin far from the origin or with a fine chord tolerance is not refused for them".** With a chord tolerance of 0.01: right at the origin; at 450 mm 6 of 16 unions refused by sheets; at 2000 mm 12 of 16. With 0.001: at the origin 5 of 16 unions refused by sheets (1 by the adapter); at 450 and 2000 mm most unions and some differences refused (by sheets or by the adapter). The ends of the crescents between the two polygons, where the two walls are nearly back to back, count as sheets once the sheet tolerance is 0.001 (the cap, at 450 mm) or 2 p (the floor). The same polygon is exact along the axes and, turned in space, refused for the wall left inside, as designed.
- The port refused the intersection of the volume check in 0 of 288 calls.

**3. The time of the checks**: the housing of scenario 9 (5310 triangles) with the sun (2076) or the carrier (916): 9 to 213 ms for `booleanOfBodies`, of which the port 9 to 156 ms. The search for sheets uses a grid over the boxes of the triangles; no bound is needed.

**4, 6. The crossing test and the distance check of the moved tool**: `movedOutwards` of the housing takes 275 to 281 ms in all (the move, the planar faces, the four checks); the NEMA-like motor 30 to 110 ms; the fuzz 18 ms on average, 221 ms at most (up to 1166 triangles).

**5. `kernel.triangulate` with several loops in one call**: every planar face of the accepted bodies was triangulated so; none failed. The caps of the sun up to 0.5: 96 to 156 ms for the whole move.

**8.** Not applicable: 3b is not in the tree.

## Revision after the verification (2026-11-17)

Decided by the coordinator of D36 within the autonomy the owner gave, written and measured by Claude Opus 5.5: refusals that hit the lid of the design's own scenario 12 and about 8 % of ordinary tools leave the clearance not useful enough to ship as a known limit. The revision changes three rules and nothing else of the design; the sentences it replaces are marked "(revised)" where they stand. Measured on the same spikes as "Verified before the implementation".

### 1. A carried face without extent is exempt from the check of its moved surface

**Rule.** A carried face (a narrow face whose condition was dropped at a vertex) lies on its moved surface within the chord tolerance at every one of its vertices, as before, **unless every vertex of it lies within the chord tolerance on its own surface and on the surfaces of the same two other faces (planes, cylinders or cones that are not carried themselves; swept faces are not asked) whose normals there are at least 1° apart**. Such a face is a polygon of the curve the two surfaces cross in (the crescents of `sink/endCap` lie on the circle where the cone of the countersink meets the bore): it has no extent in the exact shape and is no face of the moved shape. Its triangles take the number of the nearer of the two others (by the distance of the centroid from their moved surfaces), and it has no moved description, so nothing can stand on a description that is not where its triangles are; a reference to it in the pocket is `brokenReference`. For the check of distances its triangles stay a carried face (bound c less the chord tolerance). Two faces that do not cross never exempt it: a riser 0.005 high between two parallel planes, a ring between two coaxial cylinders, a face on two copies of one surface.

**What it cannot tell.** A real face narrower than the chord tolerance on such a curve (a ledge of 0.001 between a countersink and its bore) lies within the chord tolerance on the same three surfaces as a polygon of the curve; the mesh cannot tell them apart, and it goes the same way. The pocket over it is still no nearer than the bound (measured below).

**Measured.**
- The lid of scenario 12: accepted at 0.2, 0.3, 0.5, 1 and 2, the pocket 0.970, 0.979, 0.987, 0.993 and 0.996 c from the lid. The other twelve bodies of E keep their verdicts.
- A block 10 × 10 × 4 with a cone cut from its top (tapered by ±44.98°, its narrow end at z = 2) and a bore of radius 1 through it (codex's case, chord tolerance 0.01), the narrow end of the cone of radius 1 (the crescent), 1.001 (a ledge of 0.001) and 1.01 (a ledge of 0.01), at c 0.3: accepted, the pocket 0.983 to 0.991 c from the block, but the ledge of 0.001 tapered one way, `vertex` (a vertex 0.062 off), and the crescent tapered one way, `vertex` (the face 0.18 off its moved plane, not on a curve of two crossing faces); at c 1 every one `closes`.
- A step whose riser is 0.005 high, a hole through the step: accepted at 0.2 and 0.5, the pocket 0.954 and 0.985 c; the riser is not exempt (its two planes are parallel).
- In the fuzz no case was refused by the check of a carried face.

### 2. Passed-over vertices are dropped, and a clearance is more than twice the chord tolerance

**Rule, a passed-over vertex.** After the vertices are moved and before the planar faces are triangulated again, every edge of the mesh whose direction the move turned round (the moved edge and the edge before at more than 90°) is collapsed when the faces at one of its two vertices are a proper subset of the faces at the other: the vertex with fewer faces is dropped into the other. Where a round face meets another face at a slant, the vertex at the end of their common edge (three faces) slides along that edge past the next vertex of the polygon of the round face (two faces); the part of the polygon between them has no extent in the moved shape. At most one collapse in the neighbourhood of a vertex per pass, passes repeated until no such edge is left. The triangles that end without area go, and so does a flap the collapse folds flat (a triangle and its own copy turned the other way). An edge turned round between two vertices of which neither has a subset of the other's faces is left, and the checks refuse it as before. The planar faces are then triangulated again from the collapsed outline.

**Checked afterwards, not assumed.** The face sets do not prove that a collapse keeps a surface (a face number may cover several patches), so the result is checked: every edge twice, once each way (`outline` otherwise), the triangles round every vertex one fan (`vertex`, "pinched", otherwise), and every face keeps a triangle (`vertex` otherwise). No vertex is lost but those dropped and those a flap took that are passed over as well: a kept vertex within c of it lies on all its faces and more (`vertex` otherwise). A triangle the collapse left alone is checked for turning against its own three vertices before the move; one the collapse changed had no such triangle before, and is checked against the normal at its centroid of the moved surface of the face it came from (a swept face against its vertices before), slivers narrower than the chord tolerance after the move skipped.

**Rule, the smallest clearance.** On a tool with a face that is not planar, a clearance not more than `CHORDS_PER_CLEARANCE` (2) chord tolerances of the document is `tooSmall`, besides one under ten precisions of the coordinates on any tool. It is a margin: the bound of a round face, c (1 − 0.15) less the chord tolerance, is then more than 0.35 c; it reaches nothing at about 1.18 chord tolerances, and with the collapse one fuzz body (c 0.021, chord tolerance 0.03) gave a pocket that touches the body, which the bound allowed. A tool of planar faces only has no polygons and keeps the floor of ten precisions. With the default chord tolerance (0.01) the smallest clearance of a round tool is just above 0.02 mm.

**Measured** (the fuzz of "Verified", 1, the same 300 bodies, case by case against the run before the revision):

| Before | After | Cases |
|---|---|---|
| accepted | accepted | 195 |
| accepted | `tooSmall` (c ≤ 2 chord tolerances on a tool with a round face; all with c under 0.06 and a chord tolerance of 0.01 or 0.03) | 19 |
| accepted | accepted (c ≤ 2 chord tolerances, but planar faces only) | 4 |
| `turned` | accepted | 16 |
| `outline` | accepted | 7 |
| `outline` | `tooSmall` | 1 |
| `outline` | `turned` | 1 |
| `outline` / `turned` | the same | 9 / 3 |
| `vertex` / `closes` / `tooNear` / `crosses` | the same | 26 / 14 / 4 / 1 |

- Of the 37 `outline` and `turned` refusals, 23 are accepted (every one of the 13 slivers that flipped and 3 more of `turned`, 7 of `outline`), 1 is `tooSmall`, 13 stay refused. Every accepted body went through the adapter as the tool of a difference with the pocket no nearer than the bound; the nearest is 0.554 c (c 0.021, chord tolerance 0.01, where the bound is 0.38 c). The sum of Minkowski on 21 of them: the thickest piece outside the moved body 0.028 c.
- The 13 that stay, looked at: in 8 two faces of the tool that share no vertex are nearer than 2c (a slot, a hole by a slot, a step against the top: a gap that closes); in 3 an edge of the tool disappears in the moved shape (the end of a slot nearly tangent to a boss, a hole that meets two walls of a slot at its corner, two cylinders nearly tangent at the window of one in the other); in 2 the nearest such faces are 2.3 and 2.5 c apart, a gap just over twice the clearance, and the refusal was not traced further. The cheap variant refuses a change of topology by design.
- With the collapse limited to edges between two faces and the link condition of an edge collapse (the two vertices share exactly the two neighbours across the edge), two of the accepted were refused (`turned`): a flap the link condition would not fold and an in-face diagonal left uncollapsed; the rule above (any edge, flaps go, the surface checked afterwards) accepts them, right.
- The time: 8.5 to 20 ms on average, 73 to 239 ms at most (by the load of the machine); the housing 180 to 250 ms.
- Three more seeds of the same generator, 400 bodies each (after round 2 of the review): 291, 271 and 292 accepted, every pocket no nearer than the bound (the nearest 0.585, 0.579 and 0.594 c), the sum of Minkowski on 22 to 26 of them at most 0.123 c outside the moved body (c 0.030 with a chord tolerance of 0.01, inside the bound).

### 3. A sheet lies on its partner at seven points; the floor of the sheet tolerance is half a precision

**Rule.** A triangle counts as a sheet when its centroid, its three vertices and the middles of its three edges each lie within the sheet tolerance of a triangle facing the other way, each measured to the nearest such triangle. Facing the other way is normals within 2.6° of opposite, and, for two triangles that share no vertex, within the angle by which an offset of twice the sheet tolerance turns the normal of the narrower of them (up to 90°): the normal of a sliver is noise. Two triangles that touch keep 2.6°, so two faces that meet at a sharp edge are no sheet. The centroid alone was the rule before. The other points keep the crescent between two polygons of one circle from counting where it is thicker than the tolerance: it meets the other polygon at the ends of a side and is thickest in the middle. Measuring to the nearest triangle, not to the plane of one partner, keeps a narrow partner, whose normal is noise of the coordinates, from hiding a sheet. `SHEET_FLOOR` is 0.5 (it was 2). `SHEET_TOLERANCE` (10) and `SHEET_CHORD_SHARE` (0.1) stay. A first form of the rule measured the three vertices to the plane of the partner of the centroid; codex showed it misses a slab that is a sheet (below), and measuring the vertices alone to the nearest triangle counted the crescents again (5 of 16 unions refused at the origin with 0.001), so the middles of the edges were added.

**Measured.**
- Codex's slab: 0.2 × 0.2 at z = 450, its two sides triangulated as strips across each other, every vertex off by one step of single precision (3 · 10⁻⁵), thickness 1 to 4 steps, the sheet tolerance 2.25 · 10⁻⁴: every triangle of both sides a sheet (256 of 320, the rest the rims); the plane test found none of them. The same slab at 450 and 2000 mm with strips 0.025 to 0.001 wide (the second reviewer's case: with 2.6° only, strips of 0.002 and 0.001 at 2000 mm were found in none of their triangles): every triangle a sheet at every width and both chord tolerances. The pins, the joins of D, F, H and the families of "Verified", 2, gave the same verdicts with the wider angle as without it.
- A pin with a turned polygon in its hole, union and difference (16 each per place), at the floor 0.5 p and, for comparison, 2 p:

| Chord tolerance, place | 0.5 p | 2 p |
|---|---|---|
| 0.01, origin and 450 mm | right | right |
| 0.01, 2000 mm | 2 unions, 1 difference refused by sheets (turned by 4 and 13 % of a side) | 5 unions, 1 difference |
| 0.001, origin | 3 unions (turned by 0.2 % of a side, gaps under 10⁻⁵ mm; and by 4.7 %, gaps up to 1.8 · 10⁻⁴) | the same |
| 0.001, 450 mm | 4 unions (turned by 3 to 7 % of a side, gaps up to 2.5 · 10⁻⁴) | 11 unions (also those turned by 20 to 49 %) |
| 0.001, 2000 mm | 2 unions | 4 unions |

  Single precision steps 3 · 10⁻⁵ at 450 mm and 1.2 · 10⁻⁴ at 2000 mm; p is 4.5 · 10⁻⁴ and 2 · 10⁻³ there, so the floor of 0.5 p is 7 and 8 steps. The refusals by the adapter itself are unchanged (none of them by the checks).
- **Contradiction 3 is removed with a chord tolerance of 0.01 near the origin and at 450 mm, not with 0.001.** With 0.001 the sheet tolerance is 10⁻⁴; a union whose polygon is turned by under a tenth of a side leaves crescents of at most 1 to 2.5 · 10⁻⁴, and where the kernel cuts them into small triangles near the crossing of the two polygons, those triangles are thinner than the tolerance at all seven points: a sheet by any rule of thickness. A lower tolerance would miss the wall left inside, a higher one more crescents. Kept refused, a known limit ("Known limits", the sheet tolerance).
- What has to stay seen, still seen: the wall left inside a union of a pin with the same polygon turned in space (refused by sheets at every place and both chord tolerances, but 1 of 4 at 2000 mm with 0.001 that the adapter refused first); the 80 unions of F: none flagged; the leftovers of H dropped as before (3 of 20 at 2000 mm refused); the families of "Verified", 2, the same verdicts case by case. The joins of D lose a little: along an axis 10 flagged (were 12), the same 1 wrong volume and 7 remnants; tilted 55 flagged (were 57), 5 wrong volumes of at most 5.4 · 10⁻³ mm³ (were 4), 24 remnants of at most 1.2 mm² (were 23).
- The one wrong union of "Verified", 2 (near-flush, 2000 mm, turned: 24498.887 mm³ against 24500.076, 1.19 mm³ off, the tolerance 0.81): the port refused the intersection of the volume check, so the volume was not checked (as designed) and the result held no new sheet. A known limit ("Known limits", the sheet tolerance).

## As implemented

On the branch `d36/3d`, by Claude Opus 5.5, after the revision. The owner's three open questions follow the recommendations of "Open": the clearance by faces, joining cut-apart parts a known limit, the rule for an imported tool recorded for 3b (3b is not in the tree). The code is described in [docs/architecture/combine.md](../../architecture/combine.md), the forms in [docs/ui/combine.md](../../ui/combine.md), the tests in [docs/architecture/verification.md](../../architecture/verification.md).

Where it differs from the text above, or says what the text left open:

- **No `onlyFields` in the validators.** The other feature types do not refuse a field they do not know either; a combine and a split follow them.
- **`bodyRefs`** is exported from the engine (`features/index.ts`): the bodies a feature names, which the summary of a split needs to list the later features that still name only the body. `featureRefs` maps a body to the feature that made it and cannot tell the body of a split from its new part.
- **`faceLabel` and `issueText` take an optional `typeOf`.** `app.ts` passes the types of the features, so a tag of a combine reads "in the pocket of tool N of …"; the other callers of `faceLabel` (the plane text of a form, the query panel) still read every tag as a copy.
- **`REF_LABEL.pattern`** reads "a feature that tags copied faces (a pattern, or a combine as a difference)"; the message of a refused tag changed with it.
- **The body panel** says "Made from … (a copy, or a part split off)" instead of "A copy of …".
- **The checks of `movedOutwards`** are those of the revision and its two rounds of review; the fuzz is in the repository as `spikes/moved-fuzz.spike.ts` (120 bodies by default) with the four bodies of the second round pinned as `tooNear`.
- **No schema step.** A document with a combine or a split cannot be written by an older build (it does not know the types and refuses them on load, which is loud), and a copy tag of a combine is a reference to a removed feature after the combine is removed, which every build loads and reports; `SCHEMA_PENDING` stays 0.
- **Codex's ledge of 0.001** between a cone and its bore is refused (`vertex`) by the final rules, not exempted; the known limit of "A narrow face carried along" covers the case where it would be exempted.

## Open

1. **The clearance: by faces, or the sum of Minkowski?** The design moves each face along its own surface: milliseconds, sharp corners, the faces of the pocket exact and named (a sketch on the floor of a pocket, a measure to its wall), and a refusal when the tool has a hole or a gap narrower than twice the clearance, or no exact faces: a bought part imported as a mesh (3b), the backlog's own example, gets no clearance this way. The library's sum never refuses, rounds the corners and serves an imported mesh; it takes 4 to 17 s for a motor or a housing whenever the tool or the clearance changes and at every load, multiplies the triangles of the pocket by 3 to 8, and leaves one face without a description. Recommended: by faces now, the sum later as a second way for the tools the first refuses. *One line: "by faces", "Minkowski", or "both now".*
2. **Bodies cut apart and joined again: a known limit, or a repair of the adapter?** With the checks of this design, a union of two parts whose seams do not match to the last digit is refused in 5 % of the cases along an axis and 17 % on tilted planes, and passes wrong in 2 % and 6 % (a remnant of the cut face of at most 1.2 mm² in 2 % and 5 %, a volume off by at most 0.005 mm³ in 1 % of the tilted ones). Models that join what they made flush (a mirror image, a body sketched on a face) measured clean. Recommended: a known limit now; a repair package for the adapter if the fuzz of "To verify", 2, shows the refusals in models that are made on purpose. *One line: "limit" or "repair after 3d".*
3. **An imported body (3b) as a tool of a combine without a clearance: refused, or allowed with the target becoming an imported body?** 3b calls a body imported when it has a face of a mesh, and refuses every feature that changes one. Allowed, a mount with a bought motor read as a mesh subtracted could get no screw hole afterwards; refused, a bought mesh cannot be subtracted at all until the clearance by Minkowski or a narrower rule of 3b exists. Recommended: refused now, with 3b's rule revisited when the import is used. *One line: "refuse" or "allow".*

No third-party library is needed: `manifold-3d` is approved (D2) and is asked for nothing it is not asked for today.

## For the plan

- **The kernel port**: 3d adds no member to it (the row "Kernel port" of "Shared places" names a split and an offset). It adds a precondition that the adapter enforces: no face number in both operands of a union and a difference. 3b, 3c and 4b call `boolean` too, so the precondition belongs in that row.
- **`booleanOfBodies` is for every boolean of two bodies of a state**: 3c, 4b, a later query. Its checks of the result could be given to `applyTool` as well; that changes every extrusion and is a decision of its own.
- **Kinds of faces**: the face of a split is a plane; `FaceInfo` and `EdgeKind` do not change.
- **3b (import of a mesh)**, designed at the same time: "Imported bodies" above says what a combine and a split do with an imported body. Whichever package is merged second adds the check of `importedTarget` (for the target, every tool and the body of a split) to the two steps and the cases to its tests. The full variant of the clearance (the sum of Minkowski) is what an imported tool needs; its time grows with the triangles of the tool (an imported motor of 20 000 triangles is a minute).
- **4a, 4b**: a surface they add (a sphere, a torus, the general one) needs its line in `movedOutwards` (a sphere and a torus move exactly) or is the problem `noSurface`.
- **Shared places written to**: `features/index.ts` (two lines, `requireRef`), `features/module.ts`, `validation.ts`, `face-roles.ts`, `sketch-tools.ts` (`PROFILE_SOURCES`), `recompute/services.ts`, `sections/body-properties.ts` (a text), `packages/kernel-manifold/src/index.ts` (one check), `packages/mcp/src/api.ts` and `tools.ts` (texts), the app's `issue-text.ts` and `features/index.ts`; each one line, one entry or one text.
- **Docs the implementation owes**: a file of the area in `docs/architecture/` (combine and split) and its row in `architecture.md`; `naming.md` (the role, the tag of a combine, the rows of the table of situations); `ports.md` (the precondition, that the engine now asks an intersection for a body as well, the checks of the result); `document.md`; a file in `docs/ui/`; the rows of `backlog.md`.

## Tests the implementation owes

- Engine, combine: each operation on boxes and cylinders, flush and apart; several tools; a tool used up (later references, a projected edge of it, the entry of its properties, its link) and kept; own numbers (two bodies cut by one feature united; a kept tool subtracted twice: `noEffect`); the adapter's refusal of shared numbers; `noEffect` for each operation; `emptyResult`; the patch of the operation that drops the clearance; `setField` on an absent clearance and a clearance of 0; every refusal of the validator; undo.
- Engine, the checks of the result: a pin with the same polygon joined to its plate, as modelled (exact) and with the coordinates rounded differently (refused); the parts of a split joined again along an axis (the volume, or a refusal, pinned by seed); an intersection of bodies that only touch (`emptyResult`), one that leaves a small real piece and a cavity (both kept), and codex's thin tetrahedron (0.017 mm³ thinner than the sheet tolerance: `kernelFailure`, not dropped); a target less a box 10⁻⁴ from flush on it together with a cube inside it (passes by the range), the box alone as a difference (`noEffect`) and as a union (exact); a kept tool subtracted twice (`noEffect`, no check made); a tool around a large target that trims a sliver off by an intersection (changed); a union that leaves one planar number facing both ways (the sketch on it).
- Engine, the clearance: the thirteen bodies of the prototype with their verdicts pinned; the moved surfaces exact (a plane, a pin, a hole, a cone, gear teeth); the names with the tag, on a tool that carries tags already; a sketch on a face of the pocket and a projected rim of it; every reason of `MoveProblem` with its faces (and `tooSmall` without); a narrow real face (a step 0.005 high) moved or refused (a face with material on both sides: a kept tool united with the body it made a pocket in); the memo; the fuzz of "To verify", 1.
- Engine, split: the planes of "Measured", C; both sides; the cut face as a sketch plane on both bodies; a face of the body as the plane, and a later reference to that face on the part that lost it; a plane beside the body; a body of two pieces with the plane between them; the inherited properties; a pattern of the new body; a split put before a cut through the body (the cut then reaches one part).
- Scenarios: the part of scenario 13 ([calls.ts](calls.ts)); a few of the measured cases in `review.test.ts`.
- App: the two forms in `app.test.ts` (a new record each), the text of an `invalidClearance` with its tool and faces and of a combine's `kernelFailure` with its tool (`NAMED` of `issue-text.ts` gets both codes). MCP: the description of the two types and of the role.

## Reviews

Who wrote what: the first version (commit "the design of the boolean of bodies …") and the measurements A to H were written by Claude Fable 5.2; the fixes of round 1, with the measurements I and J, were written by Claude Fable 5.2 and, after that session stopped on a usage limit, checked against the reviews and the spikes, completed (this section, a few counts) and committed by Claude Opus 5.5 (the owner's decision of 2026-11-17: designs continue on Opus while Fable is unavailable).

### Round 1, on the first version

Three reviewers were asked, read-only, against the code of `master` at `633a6ca`: a fresh subagent (Claude Fable 5.2, effort high): 1 serious, 8 medium, 7 minor; codex (gpt-6-astra, effort high): 6 serious, 6 medium, 1 minor; agy (gemini-4-argon-high) did not run (HTTP 429, quota). 29 findings, 22 after merging those both reported. All were verified against the code or the spikes and accepted.

| Finding | Reviewer | Severity | Accepted | What changed |
|---|---|---|---|---|
| A union of two bodies still comes out wrong without a word after the tool got numbers of its own (12 wrong volumes, 63 remnants of the cut face of 877), against the port's rule that a silently defective body is not returned; the counts of "Known limits" disagreed with "Measured" | subagent, codex | serious (both) | yes | The engine checks the result of a union and a difference (the volume against the identity with the port's intersection, and sheets); measured on the same cases ("Measured", I) and on a pin in its hole (J); "Known limits" and "Open", 2, give the rates with the checks in place |
| The precondition "no number in both operands" lived in one function of the engine by convention; another caller would get the silent error again | subagent | medium | yes | The comment of `SolidKernel` and `ports.md` state it, and the adapter throws when the operands of a union or a difference share a number |
| A split put in front of a cut, or a patch of `side`, moves every later feature to one part without a word | subagent | medium | yes | Stated as the price in the decision, in "Known limits", in `CONVENTIONS` and in the contract; the model panel lists such features; a warning rejected (alternative 16) |
| `CLEARANCE` had no default, so `setField` could not reach an absent clearance as the contract and the calls promised | subagent, codex | medium, serious | yes | `min 0`, `default 0`, a clearance of 0 computes as none; the calls `backBySetField` and `zeroIsNone`; a positive-only field rejected (alternative 17) |
| The checks of the moved tool were presented as proof; they sample, they are unsigned, the adapter is no backstop, and a precision allowance could exceed the clearance | subagent, codex | medium, serious | yes | "A test of samples, not a proof"; the crossing test kept beside the distance test; the adapter no longer named as a backstop; a clearance under ten precisions of the coordinates refused; the fuzz of "To verify", 1 |
| `ROUND_ALLOWANCE` is a share of c, but part of the shortfall is absolute (the chord tolerance) | subagent | medium | yes | The bound is c · (1 − 0.15) less the chord tolerance; the fuzz varies the chord tolerance and clearances down to 0.02 |
| Bodies flush on a round face (a pin in its hole) neither measured nor in "To verify" | subagent | medium | yes | Measured ("Measured", J): exact along the axes, the wall left as a sheet when turned in space, flagged by the check of sheets; a known limit and a line of `CONVENTIONS` |
| What a combine and a split do with an imported body (3b) was unsaid | subagent | medium | yes | The section "Imported bodies"; "Open", 1, says the cheap clearance does not serve the imported bought part |
| The time argument against the sum of Minkowski ignored a memo by the solid of the tool | subagent | medium | yes | Alternative 1 and "Open", 1, weigh the time per change, at load and in a preview; the moved tool of this design is memoised the same way |
| `noEffect` of a difference cannot be decided after the numbers are put back (a kept tool subtracted twice) | subagent, codex | minor, medium | yes | Decided inside `booleanOfBodies` on the temporary numbers, with `onSurface` as `applyTool` does |
| calls.ts did not hold against 3a's `build()` (no mass, no material, no link); `interference.failed` not checked | subagent, codex | minor, medium | yes | `materials()` and `motor()` of 3a called, the link set, `failed` checked, the pose stated, the inheritance asserted |
| Gaps in `movedOutwards`: thin planar faces retriangulated, sliver triangles of swept faces, a radius no larger than c, "the clearance" for "twice the clearance" | subagent | minor | yes | A face carried along keeps its triangles; slivers skipped; the problem `closes` before solving; wording |
| A face in the plane of a split that is the underside of an overhang is renamed in part | subagent | minor | yes | A known limit and the contract |
| A projected edge of a used-up body warns (`brokenProjection`) and keeps its place; queries answer `notAvailable`; `unassigned` needs a link | subagent, codex | minor, medium | yes | The table of "What the code says", `CONVENTIONS` and the tests |
| A tag numbered by the place of the tool retargets a reference silently when two tools share a face | subagent | minor | yes | Stated in "Names of the faces" and "Known limits" |
| The texts of MCP, of the body properties and of the body panel say a body is an extrusion or a copy; `issueText` does not print faces; `faceLabel` cannot word a combine's tag | subagent, codex | minor, medium | yes | "Where the code lives" and "The app and MCP" list each text; `issueText` prints the faces of `invalidClearance`; `faceLabel` gets a function for the type of the tag's feature |
| One face number can need opposite directions (a hole and a pin of one name after a union) | codex | serious | yes | The problem `bothSides` refuses it |
| The rule for thin faces accepted a plate 0.005 thick moved across its thickness only | codex | serious | yes | The rule is per vertex (a narrow face is dropped only at a vertex that cannot meet all its conditions); the plate measured, moved as a box |
| The cleaning of an intersection dropped pieces by their volume, also a real small piece and the shell of a cavity | codex | serious | yes | Only a piece whose whole surface is sheet is dropped; a cavity stays |
| A split can succeed without a cut face (a body of two pieces with the plane between them) | codex | medium | yes | Allowed and said so (contract, "Recompute", "Known limits"); a sketch on the missing face is `brokenReference` |
| Counts in "Measured" contradicted each other; the sum of Minkowski "held" though 0.24 mm³ lay outside | codex | medium | yes | Counts reconciled; "holds it but for …" with the numbers; Opus also corrected the time per triangle in the table at the top and the split of the 26 tilted joins of "Measured", I, after running J1 of the spike again |
| The argument for no schema step assumed a tag of a combine exists only with its combine | codex | minor | yes | Narrowed: after the combine is removed the tag is a reference to a removed feature, which every build loads and reports |

Round 1 had more than 6 findings, of which more than 3 serious, so a second round follows.

### Round 2, on the fixes of round 1

After the rebase on `c2a506c`. The same brief for all three (look mainly at the fixes, `git diff HEAD~1 HEAD`): a fresh subagent (Claude Opus 5.5): 1 serious, 4 medium, 6 minor; codex (gpt-6-astra, effort high): 2 serious, 4 medium, 1 minor, with probes of its own against the adapter; agy did not run (HTTP 429, quota). 18 findings, 16 after merging. The fixes were written by Claude Opus 5.5; every finding was checked against the code (`coordinatePrecision`, `areaOf`, `outward` and `faceFrame` of `solid.ts`, the band of guarantee 3 in `ports.md`, `NAMED` of `issue-text.ts`) and accepted.

| Finding | Reviewer | Severity | Accepted | What changed |
|---|---|---|---|---|
| The cleaning of an intersection deletes real material: a tetrahedron 0.001 thick (0.017 mm³) is all sheet at ten precisions and would be dropped, the feature then `emptyResult` | codex | serious | yes | A piece that is all sheet is dropped only when it holds under 0.001 mm³ (the leftovers of H hold at most 6 · 10⁻⁴); one that holds more is `kernelFailure`; the tetrahedron is a test |
| The volume identity compares a union or a difference, which keep the band of guarantee 3, with an intersection, which does not: a box 10⁻⁴ from flush is refused though right | codex | serious | yes | The shared volume is a range: the pieces of the intersection that are all sheet within the band may count or not. A near-flush face on a shared piece that is no slab of its own is not covered: a possible refusal, loud, in "Known limits" and in the fuzz of "To verify", 2 |
| Under 3b's rule (a body with a face of a mesh is imported) an imported tool without a clearance makes the target imported, so no later feature can change it | subagent | serious | yes | An imported body is refused in any role of a combine; "Open", 3, asks the owner whether to allow it with the target becoming imported |
| One budget of sheet area for the whole result lets the area of a vanished operand hide a new wall | codex | medium | yes | Counted by face number (the tool's numbers are its own for the call), with `SHEET_AREA_FLOOR` over all numbers |
| A carried face keeps its triangles but is published with the exact moved surface; "all triangles narrow" does not make a face negligible | codex | medium | yes | A carried face has to lie on its moved surface within the chord tolerance at every vertex, or it is `vertex`; the contract says its description is exact to the chord tolerance; a test with a real narrow face |
| A planar face with patches facing opposite ways already affects `faceFrame` and `outward` (orientation of the larger patch, `brokenReference` when equal) | codex | medium | yes | "Nothing of today minds" corrected; a known limit; a test |
| The precision of the coordinates was stated as four millionths (it is one, `coordinatePrecision`); the sheet floor of 0.001 mm² was in "Measured" but not in the decision or the contract | codex, subagent | medium, medium, minor | yes | p is `coordinatePrecision` throughout; `SHEET_AREA_FLOOR` in the contract |
| The port's intersection is sometimes refused (up to 2.2 % of the sliver fuzz) and can take seconds; a correct union would become `kernelFailure` | subagent | medium | yes | When the intersection is refused the volume is not checked and the sheets decide; the time is named in the price |
| The volume tolerance follows the volume, the rounding follows the surface and the distance from the origin | subagent | medium | yes | A third term, `VOLUME_AREA_FACTOR` · p · the two areas; the split's tolerance taken with the body alone; the fuzz far from the origin |
| The sheet tolerance (10 p) reaches the chord tolerance far from the origin or with a fine chord tolerance, where the gaps of two polygons are real | subagent | medium | yes | Capped at a tenth of the chord tolerance (`SHEET_CHORD_SHARE`); the turned pin with a chord tolerance of 0.001 and far from the origin in the fuzz |
| The order of `changed` and the checks was unsaid: a kept tool subtracted twice could be refused instead of `noEffect` | subagent | minor | yes | `changed` first; a result without effect is not checked |
| `changed` of an intersection by the volume alone misses a small trim of a large target | subagent | minor | yes | The face test applies to an intersection too |
| An intersection got no check of sheets after the cleaning | subagent | minor | yes | It gets the same check |
| `kernelFailure` of a combine had no `refs`; the clearance under ten precisions was filed under `tooNear`; `NAMED` of `issue-text.ts` lacked the codes | subagent | minor | yes | The tool in `refs`; the reason `tooSmall`; `NAMED` gets `invalidClearance` and `kernelFailure` |
| The rows for the indexes said the port got nothing and left the result checks out | subagent | minor | yes | The rows name the precondition and the checks |
| "Open", 2, gave 6 % of tilted joins with a remnant; it is 5 % with a remnant and 6 % wrong in either way | codex | minor | yes | Reworded |

Round 2 had more than 6 findings with 3 serious, so a third and last round follows, on the diff of these fixes only.

### Round 3, on the diff of the fixes of round 2

The same three were asked to read only the diff of round 2 (`git diff HEAD~1 HEAD`): a fresh subagent (Claude Opus 5.5): 1 serious (borderline), 5 medium, 5 minor; codex (gpt-6-astra, effort high): 1 serious, 2 medium, with a probe against the adapter; agy did not run (HTTP 429, quota). 14 findings, 11 after merging. The fixes were written by Claude Opus 5.5 and checked against the code (`thickestPiece` and `areaOf` of `solid.ts`, "Stejná rovina 1e-5 D, přesah 4e-5 D" in `ports.md`). This was the last round; what it leaves open is in "Known limits" and "To verify".

| Finding | Reviewer | Severity | Accepted | What changed |
|---|---|---|---|---|
| The range of the shared volume counted only pieces that are all sheet, and a slab is never all sheet (its side walls have no partner); the case it was made for passes otherwise (`noEffect` as a difference, exact as a union), and a changed difference beside a slab would still be refused | codex, subagent | serious, serious | yes | A piece counts as a slab when it is no thicker than the band on average (twice its volume over its area); codex's changed case (the near-flush box with a cube inside the target) is the test, the box alone is `noEffect` and exact |
| The band is 10⁻⁵ D (one plane); 4 · 10⁻⁵ D is the shift; and the engine would copy a number the adapter keeps for itself | codex, subagent | medium, medium | yes | 10⁻⁵ D; the implementation writes it into guarantee 3 of `ports.md` as the port's promise, pinned by an adapter test |
| An imported tool with a clearance had two errors in the text | codex, subagent | medium, minor | yes | `importedTarget`, checked before the tool is moved; `noSurface` only for a tool that may take part |
| Deciding `changed` first let a union that lost the tool pass as `noEffect` without the volume identity | subagent | medium | yes | Only the check of sheets is skipped for a result without effect; the identity is made |
| The cap of the sheet tolerance (a tenth of the chord tolerance) falls under p far from the origin, where the H leftovers would stay and a wall inside would not be seen | subagent | medium | yes | A floor of 2 p (`SHEET_FLOOR`), which wins; the conflict is a known limit; the cases in the fuzz |
| "Known limits" still said a sheet joined to an intersection stays; the new check refuses it | subagent | medium | yes | Reworded as a refusal; its rate in the fuzz |
| The area term of the volume tolerance is of the size of the others near the origin, not below them; I was counted with two terms | subagent | medium | yes | Said so with the numbers; I is to be run again with the three ("To verify", 2) |
| The sheet rule read "no number may hold more" and "an excess up to the floor" at once; `areaOf` gives one total | subagent | minor | yes | The sum over numbers of max(0, result − operands); a variant of `areaOf` by face number |
| The `meshNormal` of `body` is a zero vector, not `brokenReference`, when the patches cancel | subagent | minor | yes | Said so |
| The check of a carried face is new and the lid's verdicts were measured without it | subagent | minor | yes | "To verify", 1, takes the lid again |
| A refused intersection could still bound the volume from one side by the intersection as computed (D50) | subagent | minor | noted | A sentence in the decision: left for later, `modules.test.ts` keeps that method to the collisions |

### The revision after the verification, round 1

Written, measured and fixed by Claude Opus 5.5. Two reviewers, read-only, on the revision (the section "Revision after the verification", the code of `moved-body.ts` and `body-boolean.ts` in the tree of 3d, and the measurements pasted as text): a fresh subagent (Claude Opus 5.5): 1 serious, 4 medium, 6 minor; codex (gpt-6-astra, effort high): 2 serious, 2 medium, 1 minor, two of them reproduced against the adapter or the functions. 16 findings, 11 after merging those both reported. All were checked against the code or measured again and accepted.

| Finding | Reviewer | Severity | Accepted | What changed |
|---|---|---|---|---|
| Lying within the chord tolerance of two surfaces does not show that a face has no extent: a riser 0.005 high (two parallel planes), a ring between coaxial cylinders, a ledge 0.001 wide between a cone and a bore (reproduced: accepted, its 48 triangles 0.177 off the plane published for them) | subagent, codex | serious, serious | yes | The two surfaces must cross (normals at least 1° apart) and the face must lie on its own surface too; an exempt face's triangles take the number of one of the two and it has no moved description; a real face under the chord tolerance on such a curve cannot be told from a polygon of it: a known limit; the ledge, the crescent and the riser measured |
| An exempt face was still published with its moved description, 0.586 c off its triangles; texts still said every carried face is exact to the chord tolerance | subagent | medium | yes | As above; "The moved tool", "Known limits" and the contract say so |
| The collapse contradicts "the same vertices, no face added or lost"; nothing makes sure a face keeps a triangle; face sets do not show that a collapse keeps a surface (a face number may cover several patches, an interior diagonal) | subagent, codex | medium, medium | yes | The texts say which vertices and faces go; the result is checked afterwards: closed, one fan of triangles round every vertex (`vertex`, pinched), every face keeps a triangle; flaps folded flat go; at most one collapse round a vertex per pass. The link condition was tried and refused two right bodies |
| The test of the vertices against the plane of one partner can be fooled by a narrow partner whose normal is noise (codex: a slab at 450 mm whose sides are strips across each other, every triangle under the tolerance, found none) | subagent, codex | medium, serious | yes | Seven points of the triangle (centroid, vertices, middles of the edges), each to the nearest triangle facing the other way; the slab measured (all its faces a sheet); the pins, the joins of D, F, H and the families of "Verified", 2, measured again |
| The floor of 0.5 p was not measured on its own | subagent | medium | yes | The pins at 0.5 p and 2 p side by side: 2 p refuses more (11 against 4 at 450 mm with 0.001); single precision steps given |
| The example of where the floor wins was wrong | subagent | minor | yes | A chord tolerance of 0.001 beyond about 200 mm, 0.01 beyond about 2000 mm |
| Stale texts: the comment of `sheetToleranceOf`, the row of `invalidClearance`, the contract on `tooSmall`; "at least twice" though equality is refused; "under a third" and "leaves nothing" at two chord tolerances (it is 0.35 c; nothing only at 1.18) | subagent, codex | minor, minor | yes | Reworded; the two chord tolerances described as a margin |
| The known limit of the pin did not match the counts (a difference refused too at 2000 mm) | subagent | minor | yes | The counts of the new measurement in the limit and in the revision |
| `tooSmall` at two chord tolerances also refused tools of planar faces only, which have no polygons | subagent | minor | yes | Only for a tool with a face that is not planar; 4 fuzz bodies accepted, right |
| The collapse took an edge at exactly 90° ("points against" says more than 90°) | subagent | minor | yes | Strictly more than 90° |
| After a collapse the check of turned triangles compared with a triangle that never existed | subagent | minor | yes | A changed triangle is checked against the normal of its moved surface at its centroid; slivers under the chord tolerance skipped |
| One near-flush union passed 1.19 mm³ off against a tolerance of 0.81, unexplained | codex | medium | yes | Traced: the port refused the intersection of the volume check, so only the sheets decided, as designed; in "Known limits" |

Contradiction 3 is removed for a chord tolerance of 0.01 only; with 0.001 the crescents near the crossings of two polygons are thinner than the sheet tolerance and stay refused, a known limit. The round had 11 findings, 2 serious, and a fix of three rules; a second round on the fix follows.

### The revision after the verification, round 2, on the fixes of round 1

A fresh subagent (Claude Opus 5.5), read-only, on the fixes, with probes of its own (other seeds of the fuzz, a copy of the mover with the collapse switched off, slabs of strips): 1 serious (borderline), 2 medium, 4 minor. All checked and accepted; the fixes by Claude Opus 5.5.

| Finding | Severity | Accepted | What changed |
|---|---|---|---|
| `tooNear` did not see a round face that comes nearer to itself than the bound: its samples skip the triangles round them; 4 of 1726 accepted bodies of other seeds had a pocket 0.657 to 0.737 c from the body, under the bound | serious (borderline) | yes | A point of a cylinder or a cone is also measured against the exact surface of its own face; the 4 are `tooNear`; three seeds of 400 measured again, none under the bound |
| The sheet test still missed a slab whose other side is strips narrower than 0.002 at 2000 mm: the partner has to pass the 2.6° filter, and its normal is noise | medium | yes | For two triangles that share no vertex the angle widens with the narrowness of the narrower (up to 90°); the slab found at every width; every other family the same |
| An exempt face could give its triangles to another exempt face, which then has triangles and no description | medium | yes | Carried faces are no partners of an exemption; the mover throws if a face of the result has no description |
| A flap folded flat could take a vertex that is not on the collapsed edge without any check seeing it | minor | yes | No vertex is lost but the dropped and those a flap took that a kept vertex within c with more faces passes over; #196 of the fuzz is such a case (0.17 c from it) and stays accepted |
| A changed triangle was still skipped by its width before the move, and an exempt triangle given away was compared with the surface of the face it went to | minor | yes | A changed triangle is skipped by its width after the move and compared with the surface of the face it came from |
| An exempt triangle given away was measured by `tooNear` as the face it went to (a looser or a stricter bound) | minor | yes | Measured as the face it came from, a carried face |
| The contract and "The moved tool" said a round face for `turned`; carried planar faces are checked too | minor | yes | Reworded |

The reviewer found sound: the 1° test, the fan check (a bijection per vertex after the closed check; tried on an octahedron and two tetrahedra sharing a vertex), the termination of the collapse and the tracking of changed triangles, the sides of `surfaceAt`, the cost of the seven points, the counts and the numbers of the texts. The fixes of round 2 are small and local; no third round.

## Rows for the indexes

**`docs/d36/README.md`, the row of 3d** (column "Design now"):

> full design, D56 ([3d-body-boolean/design.md](3d-body-boolean/design.md)): two feature types, `combine` (a union, a difference or an intersection of a target with tool bodies that are used up or kept; a difference may have a clearance) and `split` (a body by a plane: the body keeps its ID and one part, the other is a new body under the ID of the feature), the face role `splitFace`, the issue code `invalidClearance`; the kernel port stays as it is (a split is two differences with a box; the clearance moves every face of the tool along its own surface in the engine, measured against the sum of Minkowski of the library); no schema step; its part of scenario 13

In "Shared places": the row "Kernel port" names 3d with a split and an offset; it becomes "3d added no member (D56); it added a precondition: no face number in both operands of a union or a difference, which the adapter refuses; every caller of `boolean` (3b, 3c, 4b) keeps it". In "Numbers": D56 is 3d.

**`docs/decisions.md`, the row:**

> | D56 | [3d Boolean of bodies, subtraction with a clearance, split by a plane](d36/3d-body-boolean/design.md) | designed 2026-11-17. Measured against the real adapter and library: a split as two differences with a box (906 planes, none refused); a union of two bodies that share face numbers comes out wrong unless the tool gets numbers of its own, and with them still in a few per cent of hard cases, which checks of the volume and of sheets turn into a refusal; the clearance by faces against the sum of Minkowski (milliseconds and exact faces against 4 to 17 s and one face without a description) | Two feature types. `combine`: a union, a difference or an intersection of a target body with tool bodies; the target keeps its ID, the tools are used up or kept; a difference may have a clearance, the tool then subtracted with every face moved outwards along its own surface, and the faces of the pocket named after the faces of the tool. `split`: a body by a plane; the body keeps one part and its ID, the other part is a new body, and both get the cut face. The engine checks the result of a boolean of bodies (the volume against the identity with the port's intersection, sheets) and refuses what does not pass. The kernel port gets no member, only the precondition that the operands of a union or a difference share no face number |

**`docs/requirements.md`, scenario 13, the part of 3d:**

> - *A pocket with a clearance, a union and a split (3d, D56).* A ring around the motor is modelled without a thought for the motor and the four screws it runs through (five collisions). One feature subtracts the motor, the screw and its three copies from it with the print clearance as a parameter (`fit = 0.3`), and keeps them: nothing collides and nothing is a fit, the wall of the pocket is the cylinder of the motor with the radius 14.3 exactly and carries the name of the motor's side with the tag of the feature, the smallest gap between the ring and the motor is 0.3 to the accuracy of two polygons, the ceiling of a screw pocket is exactly 0.3 over the screw and a sketch stands on it, and the pocket follows the parameter. Without the clearance the pocket carries the very names of the motor's faces. A clearance of 5 on a tool with holes of radius 4 is an error that names the holes; a tool that misses warns; a clearance on a union and a tool listed twice are invalid commands. What the ring and the motor share, asked as an intersection previewed before the pocket, is a disc of the motor. The ring is joined to the link by a union: the body of the ring leaves the model (a later feature that names it is a broken reference), the link has grown by its volume and carries its faces, and the motor sits on the link and shares nothing with it. The link is split at half its thickness by a plane feature: it keeps its ID and the upper part, the lower shell is a new body named by the feature, the two volumes add up, both carry the cut face and a sketch stands on it with the normal out of each, the new shell takes after the link (material, density) and is named as in no link until the link lists it, and a cut goes through both. The other side is one field; a plane beside the body, a round face and a removed plane are errors of the feature. The document loads to the same model, without a schema step ([d36/3d-body-boolean/calls.ts](d36/3d-body-boolean/calls.ts)).

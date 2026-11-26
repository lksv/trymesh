# 7a Threads (D75)

**State: designed 2026-11-26 on Fable 5.2 against `master` at `4b9f70f` (schema version 10), on the branch `d36/7a` after the spike of the same day; not reviewed yet, not implemented.** The measurements it stands on are in [spike.md](spike.md) (sections A to I by the spike, J and K measured for this design); the code of both is `spikes/thread.spike.ts`. The owner's decisions of 2026-11-26 it starts from are in [backlog.md](../../backlog.md), "Helix and modelled threads". Eight questions wait for the owner ("Open", 43 to 50).

Files: [contract.ts](contract.ts) (the feature with its patch and fields, three face roles, the issue code, the catalog with its 55 rows, what the evaluation, the description of a body, the report of collisions and `hardwareHole` gain, the parts of the recompute), [calls.ts](calls.ts) (validation scenario 18: a plate of tapped holes, a stud in a collar, a jar and its lid, the refusals).

The package in short:

1. **A feature type `thread`** on cylindrical faces of one body: `body`, `faces` (one or more, each a cylinder), the profile as numbers (`diameter`, `pitch`, optionally `flankAngle`, `depth`, `clearance`, `starts`), `hand`, where along the face it is (`direction`, `offset`, `length`, `phase`), and the flag `modelled`. Whether a face is a bore or a pin is read from the body.
2. **Cosmetic** (`modelled: false`): the mesh does not change. The evaluation records the thread (`Evaluation.threads`), `get_model` and `get_body` list it, the view draws its helix as a line, and the check of collisions lists a screw in such a bore as `threaded` instead of a collision.
3. **Modelled** (`modelled: true`): one tool for all faces of the feature, the sweep of the axial profile along the helix (the spike's build), one boolean. A bore gets an internal thread by a cut with the screw shape, a pin an external one by a cut of the groove; the face the thread was placed on stays, under its name, as the crest. No end of the tool lies in a face of the body: it runs past an open end and stops `max(0.05, 2 · tol)` short of a shoulder, and which end is which is read from the mesh of the body at every recompute.
4. **A catalog `metricThreads`**: the 55 threads ISO 262 selects from M2 to M64 (29 coarse, 26 fine) with the pitch, the two diameters of ISO 724 and the tap drill of ISO 2306, every number read in two sources ("The catalog"). The document stores numbers.
5. **A tapped hole is a hole and a thread**: `hardwareHole` gains the use `tapped`, which answers with a plain hole at the tap-drill diameter and the fields of the thread for its bores. The hole feature does not change.
6. **Two stages.** Stage 1: everything of a cosmetic thread (2, 4, 5, the form, MCP). Stage 2: the modelled thread. No schema step in either.

## What the backlog and the spike say, checked against the code

| Statement | What the code says |
|---|---|
| "A feature `thread` placed on a cylindrical face of a body; the axis and the radius from its exact surface" (owner) | `FaceInfo` of a cylinder has `center`, `axis`, `radius` and `along`, the sense of the axis its build gave (D60); `axis()` of `recompute/services.ts` reads them for an `AxisRef` of the kind `face`. Whether the face is a bore or a pin is not in `FaceInfo`: the query `body` computes `convex` from the triangles (`query/body.ts`). The two ends of the face along the axis are nowhere: they are read from the mesh |
| "One feature with a flag: cosmetic is data only" (owner) | Nothing in the state holds data about a face beyond its name and its surface, and those do not change for a face number once given (the description of a body is kept by the identity of its mesh). A cosmetic thread needs a list of its own in the state |
| "A catalog fills the parameters, the document stores numbers" (owner) | `DATA_CATALOGS` with the query `catalog` (D37, D46). The hardware catalogs have M2 to M8; the threads go from M2, to match them, to M64 |
| "The sweep of the axial profile, not the layers" (spike, conclusion 2) | The spike's `buildSwept` is about 70 lines over a pose; a tool build of the engine returns a `Solid` with face numbers and the descriptions of its faces (`BuiltTool`) |
| "No end of the tool in a face of the body; how the feature finds out which end is open is open" (spike) | The tool builds of today measure against their targets when they are built (`toolSpan` for "through all"); D67 reads the faces at the end of an edge from the mesh and proves a run-out by a probe boolean. Nothing classifies an end of a round wall |
| "The flanks are helicoids: `Surface` has no kind for them but `general`" (spike) | `Surface` has `general`, published today only for the face of an imported mesh (`FaceInfo` `mesh`), and `isImported` refuses every change of a body that has such a face. A flank needs a description of its own inside the engine |
| "A pattern of threads should apply its copies as one tool" (spike, F) | A pattern of features calls `applyTool` per copy and per source (`features/pattern.ts`), measures `noEffect` per application and turns a mirrored tool over, which would make a mirrored thread left-handed. A thread feature with several faces is one tool without touching the pattern ("A feature on faces, not a tool of a pattern") |
| "A clearance below the chord tolerance deserves a warning" (spike) | The check of collisions calls such a pair a fit, as a pin in its hole (K of spike.md); it takes seconds over it. No command changes the chord tolerance of a document: it is 0.01 unless the file says otherwise |
| "The hole feature: modelled threads deferred" (D46) | `hardwareHole` composes a hole from the catalogs; its answer is put into a feature by the caller |

## The cheap variant

- **One profile family**: a symmetric trapezoid ridge per pitch, given by the major diameter, the pitch, the angle between the flanks and the depth; the flats follow. With the defaults it is the basic profile of ISO 68-1.
- **Straight threads on whole cylinders**: no taper, no thread on a cone, no profile drawn in a sketch.
- **Flat ends.** No lead-in of its own: a chamfer (D63) or a countersink made before the thread is the lead-in, and the thread runs out through it.
- **One body per feature**, as a chamfer has it.
- **No mate.** Where the helix lies is published, and a screw is seated in a nut by a `phase` computed from it ("The phase").

**Deferred**, none blocked:

- A joint of the mechanism that ties the turn to the travel (a screw joint), and a check that two threads about one axis are one helix.
- A lead-in generated by the feature, a thread relief, a rounded root (the minor diameter d3 of a real screw), tolerance classes (6H, 6g): the model is the basic profile moved by the clearance.
- Trapezoidal (ISO 2904), buttress and round profiles, pipe and inch threads: other profile families and other catalogs.
- Merging the copies of a pattern of features into one boolean, for cuts in general (3.7 times faster on eight threads, F of spike.md). The thread does not need it.
- A command that sets the chord tolerance, and a tolerance per feature.
- A note in an export that a body has cosmetic threads the mesh does not carry (question 50).

## Stages

| | Stage 1: cosmetic | Stage 2: modelled |
|---|---|---|
| Document | the feature type with every field; the validator takes `modelled: false` only and says that this build makes cosmetic threads | `modelled: true` accepted |
| Recompute | the walls, the profile, the checks of the faces, the records (`State.threads`), carried by the pattern of a body and by an insertion | the ends, the tool, the boolean, the faces, the checks that exist because of the mesh; `ends` on every record |
| Engine around it | `Evaluation.threads`, `threads` of the query `body`, `threaded` of the report of collisions, the catalog `metricThreads`, the use `tapped` of `hardwareHole` | the `FaceInfo` `general` through every switch; three face roles; a fuzz of the tool on the real adapter |
| App and MCP | the form with the size picker (the toggle *Modelled* shown, off and disabled), the lines of the model panel, the helix lines in the view and in `view_image`, the row of the hover, `threads` in `get_model`, the text of `describe_api` | the toggle enabled; the time of a modelled thread measured in the browser |
| Scenario 18 | a, b and the refusals | c and d |

Stage 1 does not block stage 2: the document has its final shape from the start, the records have their final shape but for `ends`, and nothing of stage 2 changes a stored field. A document with a modelled thread is refused by a build of stage 1 on load by its validator, which lists the values it takes, so no schema step is needed for the second stage either ("The document and the schema").

## Measured

All of it in [spike.md](spike.md); what this design takes from it:

| Finding | Where | What follows here |
|---|---|---|
| The swept tool is 3 to 22 times smaller than the layered one and its booleans 3 to 14 times faster | A, B | The tool is the sweep |
| A tool with an end in a face of the body is refused in 24 % of random cases; with none, in 0.2 % | C, H | Past an open end, short of a shoulder |
| Running past an open end by `max(0.05, 2 · tol)` instead of 1 mm: 1 of 300 cuts refused, as with 1 mm | J | One distance, `threadLift`, for the run past, the stop short and the distance beside the wall; a tool reaches as little beyond the wall as it can |
| An external thread as a cut of a rod at the major diameter keeps the selected face as the crest | D | Both kinds are cuts; the pin stays at its nominal diameter in both modes |
| A screw and a nut share nothing when the clearance is at least the chord tolerance | E | No check in the feature: the tolerance is 0.01 and printed clearances are ten times that |
| The engine's check of collisions: nothing above the tolerance; a fit below it, in 3.5 to 10 s | K | Said in the description of `clearance`; no warning code |
| A plain rod in a modelled nut, a rod or a modelled screw in a plain hole at the minor diameter: collisions 0.75 to 0.86 mm deep, every vertex of the shared volume within the tolerance of the zone between the wall and the major cylinder | K | The rule of `threaded`; the zone is tested before the depth is measured (the measure is the second it costs) |
| One number per role served any count of starts; the wall keeps its number | G | The face roles |
| Eight threads in one boolean are 3.7 times faster than eight in turn | F | Several faces in one feature are one tool |
| A thread shallower than five chord tolerances is not a thread at that tolerance | H | `MIN_THREAD_DEPTH_TOLERANCES` |

Not measured, and so "To verify before the implementation": the classification of the ends on real bodies, a run-out through a chamfer or a countersink, a thread across a cross hole, the browser.

## Decisions

### A feature on faces, not a tool of a pattern

The thread names a body and faces of it, as a chamfer names a body and edges (D63), and is no source of a pattern (`producesTool` false).

- **A cosmetic thread has no tool.** A pattern of features repeats tool recipes; for the cosmetic half of the feature it would have to repeat something else, through `applyTool` and its accounting of `noEffect`.
- **Several faces are one tool and one boolean**, which is the fast path the spike measured (0.45 s for eight M8 threads at a tolerance of 0.01 against 1.7 s in turn). A pattern applies its copies in turn, and merging them there changes the order of every pattern and what `noEffect` can tell.
- **`copies: true` follows a pattern.** The thread is then made on every face of the body whose name is a listed name with further copy tags: the bores a pattern of a hole made, in the order of their keys. A count that changes needs no change of the thread (`calls.ts`, `fourInARow`). Without the flag only the listed faces get a thread.
- **A mirrored hole keeps a right-hand thread.** The thread of the copy of a face is built at that face from the fields of the feature; it is not the mirror image of the thread of the source. A pattern that mirrored the tool would cut a left-hand thread into the mirrored hole, which no screw of the catalog enters (question 44).
- **A pattern of the body copies its threads with it**, as it copies chamfers. There a mirror does turn the hand over: the copy is the mirror image as a set of points, and the record says `left` ("What the evaluation records").
- The cost: the faces are listed, and taking one out of the middle of the list renames the faces of the threads after it (`face` is the place in the list), the limit a chamfer has.

### The profile

The basic profile in the axial plane is a trapezoid ridge per pitch:

| Field | Meaning | Absent |
|---|---|---|
| `diameter` | the nominal diameter, the major diameter of the basic profile | required |
| `pitch` | from ridge to ridge along the axis; the lead is `pitch · starts` | required |
| `flankAngle` | the angle between the two flanks | `deg(60)` |
| `depth` | the radial height, from the major to the minor diameter | `5 · pitch / (16 · tan(flankAngle / 2))` |
| `starts` | the number of ridges, 1 to 16 | 1 |
| `clearance` | the flanks and the root moved away from the mate along the normal of the profile | 0 |

- **The default depth is the ISO proportion at any angle**: 5/8 of the height of the sharp V. At 60° that is 0.541266 · P, the minor diameter D − 1.082532 · P of ISO 724, computed from the pitch and not copied from a rounded table; at 90° it is 0.3125 · P.
- **The flats follow.** What the flanks leave of a pitch, `pitch − 2 · depth · tan(flankAngle / 2)`, is divided 1 : 2 between the flat at the major diameter and the flat at the minor one: P/8 and P/4 at the defaults, the profile of ISO 68-1. A negative remainder is `invalidThread` (the flanks would cross). Four numbers give the profile; a fifth (the pitch diameter) would make the user of a custom thread compute it (rejected alternative 9).
- **Printing.** The flank angle is the parameter printed threads need: at 60° a flank overhangs by 60° from the vertical, at 90° by 45°. `calls.ts` builds the jar with `deg(90)`, two starts and a clearance of 0.3.
- **The clearance** moves the thread surface of this feature only: an internal thread grows (its major diameter by twice the clearance), an external one shrinks (its minor diameter). The crest is the wall and is not moved: the bore or the pin is the user's geometry, made at the size wanted (`hardwareHole` takes an allowance for it). A modelled screw and nut are free of each other when their clearances add up to the chord tolerance or more (E and K of spike.md); the description of the field says so.
- A flank with no angle (a square thread) is outside the range of `flankAngle`: the builders refuse it.

### Internal or external

Read from the body, never stated: over the triangles of the face, the normals point away from the axis on a pin and towards it on a bore (the pass the query `body` makes for `convex`; the sum of the normals of a full cylinder is zero and tells nothing). A face the body has both ways (one cylinder left as a bore and as a pin by a combine) is `invalidThread`. One feature may hold bores and pins: each is judged by itself, and for the M8 of a catalog row a bore at 6.8 and a pin at 8 both pass.

A stated kind would be a second source for what the body says, and wrong after the first combine that turns a pin into a hole (rejected alternative 7).

### The face against the thread

The face gives the wall; the feature states the thread. They have to agree, in both modes (r the radius of the wall, D/2 the major radius, h the depth):

| Face | Accepted | Otherwise `invalidThread`, with the numbers |
|---|---|---|
| a bore | `D/2 − h ≤ r ≤ D/2 − h/2` | narrower than the minor diameter of the thread (drill it at the tap-drill size), or so wide that less than half of the depth is left |
| a pin | `D/2 − h/2 ≤ r ≤ D/2` | wider than the major diameter, or so narrow that less than half of the depth is left |

- The comparisons take `LENGTH_TOLERANCE`.
- **The wall is the crest as made.** A bore at the tap drill (6.8 for M8, where the minor diameter is 6.647) gives a thread a little shallower than the basic one, as a tapped hole is; a bore with a 50 % thread (D − 0.65 · P) still passes. The tool of a bore never widens it: its root lies inside the hole and only the grooves are cut.
- **An error, not a warning, and in both modes**: a cosmetic thread that says M8 on a bore of 5 is false data, and a cosmetic thread that is accepted can then be switched to modelled without a new kind of failure (question 47). The detail of the error names the sizes, so an AI can correct the hole.
- **The nominal diameter is stated, not read from a pin.** A pin made 0.2 under the nominal for a printed fit is still an M8; a thread that took its diameter from the pin would follow every change of the pin and stop fitting its nut without a word (rejected alternative 8).

### Where the thread is

`direction` is `forward` or `backward`: the thread starts at the end of the face its axis points away from and runs along the axis of the face, or starts at the other end and runs against it. The axis of a face has the sense of D60 (for an extrusion and a hole the normal of the sketch), so for a hole made from a sketch on a face a thread from the mouth is `backward`, as the hole itself is: the vocabulary of an extent. `offset` moves the start along the thread; `length` is how long it is, to the far end of the face when absent.

- The ends of a face are the extreme points of its triangles along the axis, in the body before the feature. A face in several pieces (the bores of two lugs cut by one circle) is one wall from its first point to its last; the tool passes the gap in the air.
- A thread that would pass the far end by more than the precision of the coordinates is `invalidThread`: beyond an open end there is nothing to cut, and beyond a shoulder there is material that must stay.

### The phase

For a screw to sit in a nut their helices have to be one curve. The design makes where the helix lies deterministic, stable, steerable and published.

- **The datum.** `origin` is the point of the axis in the plane of the end of the face the thread starts from; `axis` the direction the thread runs in; `zero` a direction across the axis. The middle of the crest of the basic profile (of a pin the middle of its ridge, of a bore the middle of its groove: one curve for both) passes `origin + s · axis` at the angle θ from `zero` (right-hand rule about `axis`) with `s = ± lead · θ / 2π + k · pitch`, plus for a right-hand thread.
- **`zero` is the X axis of the model made perpendicular to the axis** (the Y axis when the axis is within about 26° of X: the component of the axis along X above 0.9), turned by `phase`. The threshold lies at no angle a model usually has (30°, 45°, 60°, 90° all take X). It is a function of the axis alone: no sketch, no order of features and no tessellation moves it.
- **It is anchored at the end of the face, not at the start of the thread**: `offset` and `length` trim the helix and do not turn it. The end of the face moves when the face is made longer at that end, and the thread moves with it, as "from the mouth" says.
- **`phase` turns it**, and the record publishes the datum (`ThreadResult`), so the phase that seats a mate is one expression: for two threads along the same direction whose starting planes are `g` apart, `2 * pi * g / lead` (`calls.ts`: the collar 4 below the top of the stud, the lid 0.5 above the neck). Two threads that start from one plane in one direction with the same phase fit as they are.
- A copy of the body carries its helix rigidly (`movedThread`); the thread on a copy of a face (`copies`) has its own datum by the same rule at its own axis.

Rejected: a datum at the start of the thread (a change of `offset` would turn every thread on a mate), `zero` from the sketch of the feature that made the face (`FaceInfo` does not carry it, and two builds of one cylinder would disagree), and a datum from the first vertex of the wall (it moves with the chord tolerance).

### The ends

Each end of a thread is `inside` (within the wall, by `offset` or `length`), `open` or `shoulder`. The last two are read from the mesh of the body in the state before the feature, at every recompute (`threadEndAt`):

- **The rim.** The edges of the triangles of the wall whose other triangle belongs to another face and which lie at that end of the wall.
- **A shoulder**: across one of those edges the other triangle leaves the rim towards the air side of the wall (from the middle of the edge to its centroid: inwards for a bore, outwards for a pin). The bottom of a blind hole, a narrower bore, the cone of a drill point; the plate a pin stands on, a wider step, a fillet at its foot.
- **Open** otherwise: the other triangles leave towards the material side (a mouth in a face, the seat of a counterbore, a chamfer or a countersink; the free end of a pin, a chamfered tip) or straight on, within 10° of the axis (the wall goes on under another name).
- **What the tool does.** At a shoulder it ends flat `threadLift = max(0.05, 2 · tol)` short. At an open end it runs past by the lift and the **reach**: how far beyond the end the triangles of the faces next to the rim still lie inside the root cylinder of the thread (found on their edges; zero for a mouth in a plane and for a wall that goes on, the axial depth of a chamfer or a countersink until it is as wide as the major diameter). So a thread runs out through a chamfer as a tap cuts it; a tool that stopped at the end of the wall would leave the grooves closed by a wedge of the cone, and no screw would enter.
- **A rim that is partly a shoulder is a shoulder.** The tool stops short all around and leaves a skin of the lift on the open part (a known limit).
- **A body that changes.** The ends are read again whenever the feature is recomputed, so a change before it in the timeline (a blind hole made through, a plate added under a pin) changes how the thread ends, with no field to go stale. A feature after the thread does not: a shoulder cut away later leaves the thread ending the lift short of where it stood. Shape the ends before the thread.

The reading is from the mesh and costs one pass over the triangles of the body; no boolean probes it. A probe (the intersection of the body with a cylinder beyond the end) would say only whether something is there, not on which side or how far the run-out reaches, and costs a boolean per end (rejected alternative 11). A field of the feature per end would have to be right again after every change of the body (rejected alternative 10).

### The tool and the boolean (stage 2)

- **One tool per wall**, the spike's sweep (`buildThreadTool`): the axial profile with its four points along four helices, the sections at the angles where a helix meets an end plane, a vertex near an end plane moved into it. The division of the turn is the rule of an arc at the major radius for the chord tolerance of the document, as it is (no halving: the vertices lie on the surface).
  - A bore: everything within the thread surface grown by the clearance; its root runs on to `threadLift` inside the wall.
  - A pin: between the thread surface shrunk by the clearance and a cylinder two lifts outside the wall; its flanks run on to one lift outside.
- **One solid of all walls**, their meshes one after another, and one `boolean('difference')` through `applyTool` (its checks of an imported target, of an empty result and of a refusal apply; the recipe is not stored). Two tools of one feature that would cross (two bores that meet) are refused before the build: their order would matter.
- **After the boolean**: no triangle with the number of the root may lie at the radius of the hidden cylinders of the tool (inside a bore, outside a pin); one that does is `kernelFailure`.
- **Checks that exist because of the mesh**, all `invalidThread`: the depth left on a face below five chord tolerances; the flanks of the tool meeting within two chord tolerances of the wall (a profile with no flat at the root on a bore exactly at the minor diameter); more than `MAX_THREAD_TRIANGLES` (200 000) triangles in the tool, counted before it is built.
- **A refusal of the kernel** (0.2 to 0.3 % of random threads, all far from the origin) is `kernelFailure` with the reason; the detail adds that a small change of `phase` or `offset` gives another mesh.

### Faces, surfaces and edges (stage 2)

| Role | Parts | What | Surface |
|---|---|---|---|
| `threadFlank` | `face`, `side` | a flank; `side` is `start` for the one whose normal out of the body points towards the start of the thread, `end` for the other | `general` |
| `threadRoot` | `face` | the bottom of the groove: the minor cylinder of a pin's thread, the major cylinder of a bore's | cylinder about the axis of the wall |
| `threadEnd` | `face`, `end` | the flat end of the groove at a shoulder or inside the wall | plane across the axis |

- **The crest is the face the thread was placed on**, with its name and its exact cylinder. A sketch's projection of its rim, an `AxisRef` of the kind `face` and a joint on it hold whether the thread is modelled or not.
- **`face` is the place in `faces`**, from 0; the thread on a copy of that face carries the further copy tags of the copy. One face per role whatever the number of starts.
- **The two flanks have names of their own** because one of them is the overhang of a print: with the thread starting at the top, `end` of a pin and `start` of a bore face down.
- **A flank is `FaceInfo` `{ planar: false, surface: 'general' }`**, published as `Surface` `general`. It is not `mesh`: a body with a thread can be changed by later features, and `isImported` keeps asking for `mesh`. It is not `swept`: that is a planar curve moved along a straight axis, and the section view and the clearance of a combine read it as such. Every switch on the surface of a face gets the kind (`surfaceOf`, `transformFace`, `normalAt` in `solid.ts`; `query/entity.ts`; the texts of `recompute/edge-blend.ts`, which refuse it as an end face; `recompute/moved-body.ts`, which moves a swept face along its curve and has nothing to move a flank along, so a combine with a clearance whose tool has a modelled thread is refused with that reason).
- **Edges.** A flank with the wall, with the root and with a flat end: `other` (helices and their ends), so not projected, chamfered or filleted. The root with a flat end and a flat end with the wall are circles (a plane across the axis and a cylinder).

### What the evaluation records

`State.threads` is a list of records, one per thread on a face: the number of the face, the profile, the hand, whether it is internal and modelled, the datum and the span (`ThreadRecord`). The step of a thread feature appends its records, in both modes. The evaluation publishes them as `Evaluation.threads` with the name of the face and the bodies that have it (`ThreadResult`).

- **Keyed by the number of the face.** A boolean carries face numbers, so a thread follows its wall through later cuts, into the target of a combine and onto both parts of a split, with no code in those features. A wall that is gone (the hole drilled out) leaves its record without a body; it is not published.
- **Two places copy faces and copy the records with them**: the pattern of a body (the transform of the copy; a mirror turns `hand` over; the face of the copy) and the insertion (its placement; the feature ID prefixed as the face names are). Both call `movedThread`.
- **Not in `FaceInfo`**: the description of a face does not change once its number is given, and the memo of a body's description hangs on that (rejected alternative 12). **Not a new name for the face**: what refers to the bore would break when a thread is put on it (rejected alternative 13).
- **A second thread on a wall** over a part of the same length is `invalidThread` for the later feature, in both modes; two threads on two stretches of one bore are fine.

### The check of collisions

A screw in a bore with a cosmetic thread overlaps it by design: the rod reaches from the tap-drill diameter to the nominal one. So does a bought screw (a plain cylinder) in a modelled nut. The query `interference` lists such a pair under `threaded` and in none of its other lists (`Threaded`):

- **The rule is geometric.** Every vertex of what the two bodies share lies in the zone of one thread on one of them, within the chord tolerance and the precision of the coordinates: between the wall and the root of that thread and between its ends. Measured on three such pairs (K of spike.md): the farthest vertex 0.048 mm outside the exact zone at a tolerance of 0.05.
- **The other body need not carry a thread.** A reference screw is a cylinder; asking for a matching record would make every imported or bought screw collide (question 48). When it does carry one about the same axis and the pitch, the starts, the hand or the nominal diameter differ, the entry says what differs (`mismatch`).
- **Two modelled threads are not excused.** Their meshes are the truth: a nut turned half a pitch against its stud is a collision (`calls.ts`, `wrongPhase`).
- **What still collides**: a rod thicker than the major diameter, a screw longer than the thread into the material beyond it, a head that sinks into the face: their vertices lie outside the zone.
- **The zone is tested before the depth is measured**: the measure is what costs a second on a thread and says nothing here, so an entry has a volume and no depth.
- A posed query moves the zone with its body. `check_interference` prints the list; the view of the query in the app shows the pairs in a third group.

The smallest gap (D40), the mass and the print check read the mesh and say nothing of a cosmetic thread.

### Queries, get_model and get_body

- `Evaluation.threads` is what the app reads.
- The query `body` (the tool `get_body`) adds `threads`: the records on the faces of that body, when it has any.
- `get_model` adds to the row of a body a line per thread: the label or `diameter x pitch`, internal or external, cosmetic or modelled, the face. A thread feature has the default row of a feature with its facts.
- No query of its own: a thread is asked through the body it is on, and the catalog through `catalog` (rejected alternative 15).

### The view and the picture

A cosmetic thread is drawn as its helix: a thin line on the wall, one per start, lifted a hair to the air side, from `from` to `to`, in the colour of annotations (`threadLines` in `draw.ts`, plain geometry over a record; at most 4 000 points per thread, fewer per turn when there are many turns). It moves with the pose of its body and is cut by a section as the edges of a body are. The model of a picture gets the same lines, so `view_image` shows which holes are threaded. A modelled thread needs nothing: it is in the mesh. The rows of what is under the pointer name the thread of a face.

A band of hatching, as drawings have it, was the other candidate: it needs a texture or a second pass over the face, and says less (the hand and the pitch are seen in a helix).

### Export

STL and 3MF write the mesh: a cosmetic thread is not in it, which is the point of it (the bore is tapped after printing, or takes a self-tapping screw). No format carries the record: the outline formats are sections, the robot formats are meshes, and the parts list counts hardware by the labels of holes. Whether an export should say that it left threads out is question 50.

### The hole

A tapped hole is two features: a hole at the tap-drill diameter and a thread on its bores. `hardwareHole` gains the use `tapped` and composes both: `shape` (plain, the tap drill of `metricThreads`, with the allowance as for every use), `label` ("M6 tapped hole") and `thread` (`diameter`, `pitch`, `label`) for a thread feature whose faces are `{ feature: <hole>, role: 'holeBore', point }`.

- **The hole feature does not change**: no field, no schema step, no second place that knows what a thread is. A thread goes on any cylinder (an extruded cut, a revolved bore, a pin), so an option of the hole would cover a part of the cases with a copy of the fields.
- **The cost** is a second feature in the timeline and a list of bores that follows the points of the hole by hand (a point added to the hole is not threaded until its bore is listed; `copies` follows patterns, not points).
- The alternative, `thread` as an optional part of a hole's shape, is rejected alternative 5 and question 45.

### The catalog

One `DataCatalog`, `metricThreads`, keyed by the designation ("M8", "M8x1"), with the columns `diameter`, `pitch`, `pitchDiameter`, `minorDiameter`, `tapDrill`, `series` and `choice`. Its rows are in `contract.ts` (`METRIC_THREAD_ROWS`), typed there from the sources on 2026-11-26; the implementation moves them to `catalogs/threads.ts`.

| What | Primary source | Check | Result |
|---|---|---|---|
| The sizes, their pitches, coarse or fine, first or second choice | ISO 262:1998, Table 1, as reproduced identically in IS 4218 (Part 4):2001 (Bureau of Indian Standards; read as the scan) | the table of the English Wikipedia, "ISO metric screw thread" | every coarse pitch and every fine pitch of ISO 262 from M8 up agrees; the check also lists fine pitches below M8 (0.35, 0.5, 0.75) that are of ISO 261 and that ISO 262 does not select |
| The basic profile (H, 5/8 H, H/8, H/4, 60°) | ISO 68-1:1998, as reproduced identically in IS 4218 (Part 1):2001 | the formulae of ISO 724 and of the Wikipedia article | agree |
| `pitchDiameter` and `minorDiameter` | ISO 724:1993, Table 1 and its formulae (D2 = D − 0.6495 P, D1 = D − 1.0825 P, rounded to the third decimal place), as reproduced identically in IS 4218 (Part 3):1999 | the metric thread chart of Get It Made (get-it-made.co.uk), all rows but the coarse M45; for M45 the chart of Optimas | all 55 rows are the formula rounded, were read in Table 1 and agree with the check. The chart of Optimas has three misprints of D1 (M18, M48, M52), which the formula and the standard settle |
| `tapDrill`, coarse M2 to M56 and fine M8x1 to M52x4 | ISO 2306:1972, Tables 1 and 2 (the standard as the preview of iTeh Standards shows it, all five pages) | Get It Made (all), Optimas (coarse), Engineers Edge (coarse to M39), the DIN 336 column of the German Wikipedia, "Metrisches ISO-Gewinde" (16 coarse sizes), the Wikipedia list of drill and tap sizes (M2, M2.5) | no difference in the rows used |
| `tapDrill` of M56x4, M60, M60x4, M64, M64x4 | not in ISO 2306, whose tables end at M56 and M52x4: the nominal diameter less the pitch, the rule its scope states | Get It Made (all five), Optimas (M60, M64), the German Wikipedia (M64) | agree; `source` of the catalog names the five rows |

- **The rows are ISO 262's selection**: 29 coarse threads (M2, M2.5, M3, M3.5, M4, M5, M6, M7, M8, M10, M12, M14, M16, M18, M20, M22, M24, M27, M30, M33, M36, M39, M42, M45, M48, M52, M56, M60, M64) and the 26 fine ones it gives from M8x1 to M64x4. M2 and M2.5 are there because the hardware catalogs start at M2; ISO 262 also has M1 to M1.8, left out (question 49).
- **One catalog over three standards**, unlike the hardware catalogs (one per standard): here every row has a value in every column, and a caller wants the pitch and the drill of a size in one look. `source` names each standard with its columns.
- **A tap drill is a drill for metal.** ISO 2306 picks stocked drills, so it is not always D − P (6.8 for M8, 10.2 for M12); Engineers Edge lists the fine 0.75 pitches at D − P (5.25) where the standard has 5.2, none of them a row here. A printed bore needs an allowance, which `hardwareHole` takes.
- A test pins the rows and checks what holds without a source (`calls.ts`, `catalogChecks`): the two diameters are the formulae rounded; the tap drill lies between the minor diameter and the bound of a bore of the feature; the key says what the row holds; a fine pitch is finer than the coarse one. No number comes from memory.

### Performance

- **The chord tolerance of the document, as it is**: 0.01 unless the file says otherwise (no command changes it). At 0.01 one thread is a tool of 3 000 to 7 000 triangles and a boolean of 56 to 115 ms in Node (M10, M20, a 40 mm lid thread; B of spike.md); eight M8 threads through a plate 0.45 s as one tool. The body grows by about the triangles of the tool, and every later feature on it pays for them: a modelled thread belongs late in the timeline.
- **Cosmetic costs a pass over the faces** and no boolean; it is the default of the form.
- **The cap**: 200 000 triangles of the tool of one feature, about three seconds by the rate of the spike, refused before the build with the count.
- **The check of collisions**: 40 ms for a screw free of its nut. A pair excused by a thread costs the intersection alone (26 to 110 ms in E), because the zone is tested before the depth is measured; measured with the depth, such a pair took a second. Two modelled threads closer than the tolerance take seconds and are listed as a fit.
- **The app** was not measured: the WASM library in a browser and the renderer with such a body are stage 2's first measurement, before the toggle is enabled.

## Recompute

The step, in `features/thread.ts` over `recompute/thread.ts`:

1. The body from the state (`brokenReference`).
2. The walls. Every listed face by its name on that body (`brokenReference` with the face); with `copies` the faces whose name is a listed name with further copy tags, after the listed ones, in the order of their keys. Each has to be a cylinder (`invalidThread`); its side and its two ends are read from the triangles (`threadWall`).
3. The profile (`threadProfile`; `invalidThread` when it does not fit into a pitch) and the check of every wall against it.
4. The span of every wall from `direction`, `offset` and `length` (`invalidThread` past the far end), and its datum.
5. An earlier thread on a wall over a part of that span: `invalidThread` with that feature in `refs`.
6. Cosmetic: the records are appended, the bodies stay the same objects. Done.
7. Modelled (stage 2): `importedTarget` for a body with an imported face; the ends (`threadEndAt`); the checks of the mesh; the tools into one solid; `applyTool` with a recipe that is not stored; the check of the hidden cylinders; the faces that are in the result enter the table as those of every tool do; the records are appended with `ends`.
8. `facts`: `depth`, `minorDiameter`, `lead`, `crestFlat`, `rootFlat`, `threads`, and `triangles` when modelled.

A feature in error changes nothing and records nothing; what refers to a face of its thread is a `brokenReference`. The step reads the body, the face table and the chord tolerance, so the evaluator's memo holds as for a chamfer.

## The document and the schema

```ts
interface ThreadFeature extends FeatureBase {
  type: 'thread';
  body: Id;
  faces: FaceName[];        // at least one, none twice
  copies?: boolean;         // also the copies of the faces a pattern made
  modelled: boolean;
  diameter: number;         // nominal = major
  pitch: number;
  depth?: number;           // absent: the ISO proportion
  flankAngle?: number;      // absent: deg(60)
  clearance?: number;       // absent: 0
  starts?: number;          // absent: 1
  hand: 'right' | 'left';
  direction: 'forward' | 'backward';
  offset?: number;          // absent: 0
  length?: number;          // absent: to the far end of the face
  phase?: number;           // absent: 0
  label?: string;
}
```

- **Numeric fields** (`THREAD_FIELDS`): all nine take an expression. The five with a default may be absent and `setField` can add them, as `extent/taper`; `depth` and `length` have no fixed default and are added by `updateFeature`. `starts` is an integer field, as the count of a pattern (a fraction from an expression is `notInteger`).
- **Validation** (`features/thread.ts`): the body as a reference of the kind `body`; the faces by `faceName` and `requireFace`, none twice (by `faceKey`); `hand` and `direction` from their two values; `label` as a hole's; the fields it reads are listed, so a misspelt one is refused by `addFeature` (D73). Relations between the numbers are the recompute's (they may be expressions).
- **References**: the body, and every face by `faceRefs` (its feature, and every pattern in its copy tags), so `moveFeature` keeps the thread behind them. A thread on the bores of a hole stands after the hole; with `copies` it has to stand after the pattern too, which no reference says: placed before it, it finds no copies, and `threads` in its facts shows the count.
- **`updateFeature`**: every field; `faces` is replaced whole; `null` removes `copies`, `depth`, `length`, `label` and the fields with a default (`removable` of the module).
- **Registry**: `createsBody` false, `namesFaces` true, `producesTool` false, `tagsFaces` absent, `bodies: 'none'`.
- **No schema step**, by the rules of `schema.ts`: a build without the type refuses a document with it; a build of stage 1 refuses `modelled: true` by its validator; nothing is added to a feature, an extent or a section that exists. `SCHEMA_VERSION` stays 10 and `SCHEMA_PENDING` 0.

## Where the code lives

| File | What 7a does there | Stage |
|---|---|---|
| `types.ts` | `ThreadFeature`, members of `Feature`, `FeaturePatch`, `ErrorCode`; `ThreadResult`, `Evaluation.threads`; `BodyDescription.threads`; `Threaded` and `InterferenceReport.threaded`; the comments are what the AI reads | 1 |
| `types.ts`, `face-roles.ts` | three members of `FaceName` and their entries of `FACE_ROLES`; the comment of `Surface` `general` | 2 |
| `features/thread.ts` | new: the entry of the registry, the validator, the references, the step | 1 |
| `features/index.ts` | one line of the registry | 1 |
| `recompute/thread.ts` | new: `threadProfile`, `threadWall`, the spans and the datum, the records, `movedThread`, `threadResults`; in stage 2 `threadEndAt` and the checks of the mesh | 1, 2 |
| `recompute/tool-thread.ts` | new: `buildThreadTool`, moved from the spike with its tests (the deviation from the exact surface, the exact volume, the two hands) | 2 |
| `recompute/state.ts`, `evaluate.ts` | `State.threads`, empty before the first feature; `Evaluation.threads` | 1 |
| `features/pattern.ts`, `features/insert.ts` | where faces are copied, the records on them are copied (`movedThread`) | 1 |
| `solid.ts`, `query/entity.ts`, `recompute/edge-blend.ts`, `recompute/moved-body.ts` | the `FaceInfo` `general` in every switch | 2 |
| `interference.ts`, `query/interference.ts` | the zones of the pair, the test before the measure, the list `threaded` | 1 |
| `query/body.ts` | `threads` of a body | 1 |
| `catalogs/threads.ts`, `data-catalogs.ts` | new: the table; one entry | 1 |
| `query/hardware-hole.ts` | the use `tapped` | 1 |
| `packages/mcp` | `threads` in the rows of `get_model`; `threaded` in the text of `check_interference`; `CONVENTIONS` of `api.ts`: how a thread is made; the typed rows of `queries.test.ts` for the new option | 1 |
| `packages/app` | below | 1, 2 |
| `packages/kernel-manifold/test` | a fuzz of thread tools on the adapter, as `taper-fuzz.test.ts` | 2 |
| `docs/architecture/thread.md`, `docs/ui/thread.md` | new; `hole.md` (the catalog, `tapped`), `naming.md` (the roles), `api.md` (the report, the body), `ai.md` | 1, 2 |

## The app and MCP

- **MCP** needs no tool: the feature through `execute`, the catalog through `query` (`catalog`), a tapped hole through `query` (`hardwareHole`), the threads through `get_model` and `get_body`. With the selection of D74, "thread this hole M6" is `get_selection` (the picked face as `{ body, face }`), the row `M6` of the catalog and one `addFeature`.
- **The app** gets an entry of `FEATURE_UI`, `features/thread.ts`:
  - a button *Thread*; a cylindrical face selected in the view when it is pressed is the first face;
  - the faces: an armed picker (`picks: { faces: true, before: true }`), a click on a cylindrical face of the body adds or removes it, the first click sets the body; a face that is not a cylinder is refused with a hint;
  - *From the catalog*: a size from the keys of `metricThreads`, which fills `diameter`, `pitch` and `label`, and under it what the picked faces would have to be (the tap drill for a bore, the nominal diameter for a pin) against what they are, read from `faceSurfaces`;
  - the fields from `FEATURE_TYPE_INFO.thread.fields` (angles in degrees for a bare number; an empty depth and length show their defaults as placeholders), the hand and the direction as two-way choices, the checkbox *Also the copies of a pattern*, the label;
  - the toggle *Modelled* (stage 1: off and disabled, with a line that says so);
  - the preview as every form has it: the helix lines for a cosmetic thread, the cut body for a modelled one;
  - the model panel: the label or `diameter x pitch`, the number of threads, cosmetic or modelled; a selected thread highlights its walls and, when modelled, its faces (`ownsFace`).
- `ROLES` of the app gets three texts, `issue-text.ts` the code.

## Issue codes

| Code | Kind | When |
|---|---|---|
| `invalidThread` | error, new | the fields and the faces do not make a thread: the cases of `IssueCodes` in `contract.ts` |
| `brokenReference` | error | the body, or a listed face it does not have |
| `importedTarget`, `emptyResult`, `kernelFailure` | error | modelled: as for a cut |
| `invalidExpression` | error | a field |

No warning is added. A cut that changes nothing cannot pass the checks of the wall; if the kernel returns the body unchanged all the same, the feature has `noEffect` as a cut has.

## Shared vocabulary

- **Takes:** the registry of feature types, `FACE_ROLES`, `IssueCodes`, `DATA_CATALOGS` and the query `catalog`, `Surface` (`general`), `faceRefs` and `requireFace`, `applyTool`, the copy tags of D53, `hardwareHole` of D46, the report of D50.
- **Adds:** the feature type `thread` and its patch; the roles `threadFlank`, `threadRoot`, `threadEnd`; the code `invalidThread`; the catalog `metricThreads`; `Evaluation.threads` with `ThreadResult`; `threads` of the description of a body; `threaded` of the report of collisions; the use `tapped` of `hardwareHole`; the `FaceInfo` `general`.

## Rejected alternatives

1. **A generator of a helical profile on a circle of a sketch, extruded with a twist** (the backlog of 2026-11-14). Replaced by the owner's decision: the thread goes where the cylinder is, whatever made it.
2. **The layered build.** Ten times the triangles at the default tolerance (spike.md, A); it stays the build of a twist on an extrusion.
3. **An external thread joined onto a core at the minor diameter.** The pin would have another diameter in the two modes (spike.md, D).
4. **The thread as a source of a pattern.** Above ("A feature on faces").
5. **`thread` as a part of the hole feature.** Above ("The hole").
6. **The feature stores the size ("M8") and looks the numbers up.** A corrected catalog would change old models without a word (D46).
7. **A stated kind, internal or external.** Above.
8. **The nominal diameter read from a pin.** Above.
9. **The profile by the three diameters of ISO 724** (major, pitch, minor). It reads like the standard and fixes the flats, but a custom thread has no pitch diameter until someone computes one, and the rounded table would replace the exact proportion.
10. **A field per end** (run out or stop). Above.
11. **A probe boolean per end.** Above.
12. **The thread in the description of the face.** Above.
13. **A face role for a threaded bore.** Above.
14. **Collisions excused by a label, by the use of a body, or only when both bodies carry matching threads.** A label is free text, a reference body can collide for real, and a bought screw carries no thread.
15. **A query or an MCP tool that composes a thread.** The mapping is two columns of a row; what needs judgement (the size of the bore) is `hardwareHole`'s.
16. **The flanks as `swept` or as `mesh`.** Above.
17. **A chord tolerance per feature.** The meshes of one document would have two tolerances, and the fit of round faces is judged by one.
18. **A warning for a clearance below the chord tolerance.** The feature cannot know its mate's clearance, and the default tolerance is far below any printed clearance.
19. **A hatched band in the view.** Above.

## Known limits

- **The basic profile, no tolerance class.** The root of a modelled screw is flat at d1; a real screw's is rounded and deeper. A modelled nut fits a real screw; a real nut fits a modelled screw only with a clearance.
- **Flat ends**: no lead-in but a chamfer made before the thread; the thread runs out through it. A chamfer after a modelled thread is refused (the rim is cut by the flanks into edges of the kind `other`).
- **A rim partly open and partly at a shoulder** is treated as a shoulder: a skin of the lift stays over the grooves on the open part.
- **Inside the span the wall is taken as it is.** A thread across a collar or a rib on the air side of the wall cuts into it; across a cross hole or a slot it passes through the air. Only the two ends are read.
- **A feature after the thread does not move its ends.**
- **A wall that goes on under another name** (two coaxial faces of one radius) ends the thread at the end of the listed face; listing both gives two threads whose helices are anchored at two ends and need a `phase` to meet.
- **`zero` is fixed to the model**, not to the body: a part whose sketch is turned about the axis of its thread keeps the helix where it was. It switches from X to Y where the axis comes within about 26° of X.
- **No mate.** A screw is seated by a `phase`; a pose of the mechanism that turns a screw does not advance it, and the check of collisions then reports two modelled threads as colliding.
- **The zone test excuses what lies in the zone**, whatever it is: a rod of the right diameter in a threaded bore with the wrong pitch passes when it carries no thread of its own.
- **`copies` follows patterns, not points**: a point added to a hole feature is threaded when its bore is listed.
- **Taking a face out of the middle of `faces`** renames the faces of the threads after it.
- **The surfaces of the flanks are `general`**: no sketch on them, no measure of an angle to them, and a combine with a clearance refuses a tool that has a modelled thread (it has no surface to move a flank along; a cosmetic thread on the tool is no obstacle).
- **The chord tolerance is the document's**: 0.01 by default, with no command to change it. The triangle counts of this design at 0.05 hold only for a file that carries it.
- **A cosmetic thread is in no export.**
- **A thread shallower than 0.05 mm at the default tolerance cannot be modelled** (a pitch below about 0.1 mm); M2 can (0.217).

## To verify before the implementation

Stage 1 needs none of these. Before stage 2, as an addition to the spike:

1. **The ends on real bodies.** Random walls with every kind of neighbour (a mouth in a plane, a counterbore, a chamfer and a countersink of several angles, a blind bottom, a drill point, a step, a pin on a plate, a filleted foot, a chamfered tip), in random poses: the classification is right, the adapter takes the tool, the volume is that of the exact thread. In particular the run-out through a cone, which no measurement has yet.
2. **A thread across a cross hole and a slot.**
3. **The direction rule of the rim** (from the middle of an edge to the centroid of the triangle across it) on the triangulations the kernel makes of caps: thin triangles along a rim, a rim cut by an earlier feature.
4. **The browser**: the time of a modelled M10 and of the jar in the app, and the frame time of the view with the bodies they leave.
5. **The cap** of 200 000 triangles against a measured boolean of that size.
6. **The zone test on posed pairs** and on a pair the kernel refuses (the second opinion of D50 measures a mesh as computed; the zone is tested on it the same way and may only clear).

## Tests the implementation owes

- Stage 1: the rows of the catalog pinned, with `catalogChecks`; the validator (every field, the faces, `modelled: true` refused); the profile at the defaults against ISO 68-1 (P/8, P/4, 0.541266 P) and at 90°; the walls (a bore, a pin, a face in two pieces, a face both ways); every case of `invalidThread` of both modes; the datum (an axis along each model axis, at 25° and at 27° from X, a copy of a body, a mirrored copy, an insertion); the records through a later cut, a combine, a split and a removed wall; `threaded` (the three pairs of K, a rod too thick, a screw too long, two cosmetic threads with another pitch, a posed pair); the lines of the view over a record; the snapshots of the app with the new form; scenario 18, a and b.
- Stage 2: the tool against the exact surface and the exact volume, both hands, one to three starts (the spike's tests moved); the fuzz on the adapter; the ends (the cases of "To verify", pinned); the faces left and the faces gone, on every kind of end; the `general` face through every consumer (a chamfer that ends at a flank is refused, a section draws it, a combine with a clearance refuses a tool that has one); `wrongPhase`; scenario 18, c and d.

## Open

Questions for the owner, each with the recommendation the design is written to. The numbers continue those of [6-cross-review.md](../6-cross-review.md) (the last answer there is 42).

43. **A list of faces with `copies`, and no pattern of threads**, or one face per feature with the thread as a source of a pattern? *Recommendation: the list.* One boolean for many threads, a cosmetic thread needs no tool, and a mirrored hole keeps its hand. The price is a list to keep and face names by the place in it.
44. **The hand of a thread on the mirrored copy of a hole** (a pattern `mirror` of the hole feature, then a thread with `copies`): the stated hand, or the mirrored one? *Recommendation: the stated hand*; a mirrored body turns the hand over in any case, since its mesh is the mirror image.
45. **A tapped hole as a hole and a thread composed by `hardwareHole`**, or `thread` as an option of the hole feature? *Recommendation: composed.* The hole stays as it is, and the thread is one thing in one place.
46. **One profile family**: the trapezoid by a flank angle and a depth, with the flats divided as ISO divides them. Is that enough for printed lids and fittings, or is a second family wanted now (equal flats, a trapezoidal thread of ISO 2904, a round one)? *Recommendation: enough;* another family is a variant of the feature later.
47. **A face that is not at a size the thread can have is an error, also for a cosmetic thread**, or a warning there? *Recommendation: an error in both modes*, with the sizes in the message.
48. **The check of collisions excuses a pair by the zone of one thread, whether or not the other body carries a thread**, and lists it under `threaded`. Or only pairs in which both carry matching threads? *Recommendation: by the zone alone*, with `mismatch` when both carry one.
49. **The catalog: ISO 262's selection from M2 to M64 in one catalog with the tap drill** (55 rows, five tap drills by the rule of ISO 2306 above its tables). Or also M1 to M1.8, every combination of ISO 261, or other standards (pipe, inch, trapezoidal)? *Recommendation: as designed;* a further standard is a further catalog when a model needs it.
50. **Should an export say that it left cosmetic threads out** (a line in the answer of `export`, and in the print check, naming the bodies)? *Recommendation: yes, as a small addition after stage 1*: it needs a place for notes in `Exported`, which no format has today.

## Reviews

None yet. The design is due an independent review before stage 1 starts (a full one: it adds geometry and a rule to the check of collisions).

## Rows for the indexes

For the merge, not written into the shared files by this branch beyond the two rows below.

- `docs/decisions.md`: the row D75 (written, with the state of today).
- `docs/d36/README.md`: the row 7a and the numbers D75 and scenario 18 (written).
- `docs/requirements.md`: scenario 18, "Threads: a plate of tapped holes, a stud in a collar, a jar and its lid" (D36, package 7a, D75), when stage 1 is implemented.
- `docs/architecture.md`: a row for `architecture/thread.md`; `docs/ui.md`: a row for `ui/thread.md`.
- `docs/backlog.md`, "Helix and modelled threads": a pointer to this design in place of the generator of a helical profile; the twist on an extrusion and helical gears stay there with the layered build of the spike.

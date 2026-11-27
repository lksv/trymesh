# 7a Threads (D76)

**State: designed 2026-11-26 on Fable 5.2 against `master` at `4b9f70f` (schema version 10), on the branch `d36/7a` after the spike of the same day; reviewed in three rounds (the first by an internal reviewer on Fable and by `agy`, the second by the same two and by `codex`, the third, on the diff alone, by the internal reviewer and, as a second opinion, by a reviewer on Opus 5.5) and revised after each on 2026-11-27 ("Reviews"); the owner answered questions 43 to 58 on 2026-11-27 (every recommendation accepted, with four changes: "Open"); stage 1 (the cosmetic thread) implemented on the branch `d36/7a` on 2026-11-27 and not yet reviewed or merged ("As implemented", at the end); the point between the stages and stage 2 are not implemented.** The decision was D75 until 2026-11-27, when `master` gave that number to another decision; the reviews of the time name it so. The measurements it stands on are in [spike.md](spike.md) (sections A to I by the spike, J and K measured for the first version of this design, L to P for the first revision, Q to S for the second, T for the third round); the code of all of them is `spikes/thread.spike.ts`. The owner's decisions of 2026-11-26 it starts from are in [backlog.md](../../backlog.md), "Helix and modelled threads". The sixteen questions it put to the owner (43 to 58) are answered and recorded in "Open".

Files: [contract.ts](contract.ts) (the feature with its patch and fields, three face roles, the issue codes, the catalog with its 55 rows, what the evaluation, the description of a body, the report of collisions, the smallest gap and `hardwareHole` gain, the parts of the recompute), [calls.ts](calls.ts) (validation scenario 18: a plate of tapped holes, a stud in a collar, a jar and its lid, the refusals).

The package in short:

1. **A feature type `thread`** on cylindrical faces of one body: `body`, `faces` (one or more, each a whole cylinder), the profile as numbers (`diameter`, `pitch`, optionally `flankAngle`, `depth`, `clearance`, `starts`), `hand`, where along the face it is (`direction`, `offset`, `length`, `phase`), and the flag `modelled`. Whether a face is a bore or a pin is read from the body.
2. **Cosmetic** (`modelled: false`): the mesh does not change. The evaluation records the thread (`Evaluation.threads`), `get_model` and `get_body` list it, the view draws its helix as a line on the wall, and the check of collisions takes the zone of the thread out of the body before it judges a pair, so a screw in such a bore is listed as `threaded` instead of a collision.
3. **Modelled** (`modelled: true`): one tool for all faces of the feature, the sweep of the axial profile along the helix (the spike's build), one boolean. A bore gets an internal thread by a cut with a ring of the screw shape, a pin an external one by a cut of the groove; the face the thread was placed on stays, under its name, as the crest. No end of the tool lies in a face of the body: it runs past an open end and stops short of a shoulder, and which end is which is read from the mesh of the body at every recompute.
4. **The clearance is radial**: a thread with a clearance `c` is the basic thread of a diameter smaller (a pin) or larger (a bore) by `2c`, cut into the wall as it was made. A pin made at `diameter − 2c` and a bore at the tap drill plus `2c` keep the full crest at any clearance.
5. **A catalog `metricThreads`**: the 55 threads ISO 262 selects from M2 to M64 (29 coarse, 26 fine) with the pitch, the two diameters of ISO 724 and the tap drill of ISO 2306, every number read in two sources ("The catalog"). The document stores numbers.
6. **A tapped hole is a hole and a thread**: `hardwareHole` gains the use `tapped`, which answers with a plain hole at the tap-drill diameter and the fields of the thread for its bores. The hole feature does not change.
7. **Two stages and a point between them.** Stage 1: everything of a cosmetic thread (2, 5, 6, the form, MCP). Then a small point of its own: the note of an export and of the print check about cosmetic threads, and the threads in the parts list. Stage 2: the modelled thread. No schema step in any.

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
| What the check of collisions keeps (review) | `query/interference.ts` keeps the answer for a pair by its two meshes (`context.memo([a.solid, b.solid], 'shared', …)`), and `sharedBy` of `interference.ts` measures the depth inside the same call; a cosmetic thread changes no mesh. In a pose a pair is computed in the frame of its first body (`framed`). The smallest gap asks the same query what a pair shares (`sharedBy` of `query/gap.ts`: a collision when `pairs` has an entry, a fit when `fits` has one, else touching), and keeps its own answer by the two meshes as well |
| Who gives faces new numbers (review) | The pattern of a body and the insertion copy faces under new numbers. A combine with a clearance gives the moved faces of its tool new numbers too (`features/combine.ts`): they are the faces of the pocket, of the opposite sense, and nothing of the tool's thread belongs on them. A combine without a clearance keeps the numbers (`restored` of `recompute/body-boolean.ts`), so a face of a tool lies in the target with the material on its other side |
| What a query sees of the evaluation (review) | `queryContext` takes `bodies` and `faceSurfaces` out of the evaluation it hands to a query and answers for them in the pose (`query/context.ts`); every other field reaches a query as modelled. The description of a body is kept by its mesh (`query/body.ts`) |
| "The hole feature: modelled threads deferred" (D46) | `hardwareHole` composes a hole from the catalogs; its answer is put into a feature by the caller |

## The cheap variant

- **One profile family**: a symmetric trapezoid ridge per pitch, given by the major diameter, the pitch, the angle between the flanks and the depth; the flats follow. With the defaults it is the basic profile of ISO 68-1.
- **Straight threads on whole cylinders**: no taper, no thread on a cone or on a part of a cylinder, no profile drawn in a sketch.
- **Flat ends.** No lead-in of its own: a chamfer (D63) or a countersink made before the thread is the lead-in, and the thread runs out through it.
- **One body per feature**, as a chamfer has it.
- **No mate.** Where the helix lies is published, and a screw is seated in a nut by a `phase` computed from it ("The phase").

**Deferred**, none blocked:

- A joint of the mechanism that ties the turn to the travel (a screw joint), and a check that two threads about one axis are one helix.
- An option for the hand of the thread on a mirrored copy of a face (`mirroredHand: 'same' | 'opposite'`); until then the opposite hand is a second feature ("A feature on faces").
- A flag that threads every bore of a listed hole feature, so that a point added to the hole later is threaded too (owner, 2026-11-27, a candidate for the backlog). It has to be a new optional field: `copies` keeps its meaning, the copies a pattern made.
- A catalog of pipe threads G (ISO 228, flanks at 55°; the owner named fittings, 2026-11-27, a candidate for the backlog). The fields take such a thread by hand already.
- A record for the thread a difference leaves in its target (a nut cut with a modelled screw), and a thread on a part of a cylinder (a slit clamp).
- A lead-in generated by the feature, a thread relief, a rounded root (the minor diameter d3 of a real screw), tolerance classes (6H, 6g): the model is the basic profile moved by the clearance.
- Trapezoidal (ISO 2904), buttress and round profiles, pipe and inch threads: other profile families and other catalogs.
- Merging the copies of a pattern of features into one boolean, for cuts in general (3.7 times faster on eight threads, F of spike.md). The thread does not need it.
- A command that sets the chord tolerance, and a tolerance per feature.

## Stages

| | Stage 1: cosmetic | Stage 2: modelled |
|---|---|---|
| Document | the feature type with every field; the validator takes `modelled: false` only and says that this build makes cosmetic threads | `modelled: true` accepted |
| Recompute | the walls, the profile, the checks of the faces, the ends read from the mesh, the records (`State.threads`) carried by the pattern of a body and by an insertion, the transforms of the copies of a pattern kept in the state | the tool, the boolean, the faces, the checks that exist because of the mesh |
| Engine around it | `Evaluation.threads`, `threads` of the query `body`, `threaded` of the report of collisions and of the smallest gap, the catalog `metricThreads`, the use `tapped` of `hardwareHole` | the `FaceInfo` `general` through every switch; three face roles; a fuzz of the tool on the real adapter |
| App and MCP | the form with the size picker (the toggle *Modelled* shown, off and disabled), the lines of the model panel, the helix lines in the view and in `view_image`, the row of the hover, `threads` in `get_model`, the text of `describe_api` | the toggle enabled; the time of a modelled thread measured in the browser |
| Scenario 18 | a, b and the refusals | c and d |

Stage 1 does not block stage 2: the document and the records have their final shape from the start, and nothing of stage 2 changes a stored field. A document with a modelled thread is refused by a build of stage 1 on load by its validator, which lists the values it takes, so no schema step is needed for the second stage either ("The document and the schema").

**The point between the stages** (owner, 2026-11-27, answers 50, 55 and 56): a small point of its own right after stage 1 and before stage 2, with a light review. Between the stages every thread is cosmetic, and an STL leaves them out without a word; so the note does not wait for "some time after".

- **The notes of an export.** `Exported` gets a place for notes (`notes`, lines of text; no format has one today). `export` of STL and of 3MF, and of every other format that writes the mesh of a body, adds a line per body with cosmetic threads: the body, how many threads, and that the mesh does not carry them. The server prints the notes with the files it wrote.
- **The print check** (D42) names the same bodies (`cosmeticThreads` of its answer).
- **The parts list** (D57) gets the threads of a body: a row says how many of which (`threads`: the label or `diameter x pitch`, internal or external, cosmetic or modelled, the count per body), and the threads of a body go into what makes two bodies one row, so a body with a cosmetic thread and its copy without one are two rows.

**What stage 1 fixes for good.** A cosmetic thread stores `clearance`, `phase`, `flankAngle` and `depth`, and their geometry is first cut in stage 2. What they mean is therefore settled before stage 1 ships: the clearance model (question 51) and the datum of the helix: its base direction (question 58) and how it is carried to the copies of a pattern (question 54). The owner confirmed all three as designed (2026-11-27). A change of either meaning after stage 1 is a change of what stored documents say and needs an upgrade step that converts the fields.

## Measured

All of it in [spike.md](spike.md); what this design takes from it:

| Finding | Where | What follows here |
|---|---|---|
| The swept tool is 3 to 22 times smaller than the layered one and its booleans 3 to 14 times faster | A, B | The tool is the sweep |
| A tool with an end in a face of the body is refused in 24 % of random cases; with none, in 0.2 % | C, H | Past an open end, short of a shoulder |
| Running past an open end by `max(0.05, 2 · tol)` instead of 1 mm: 1 of 300 cuts refused, as with 1 mm | J | One distance, `threadLift`, for the run past, the stop short and the distance beside the wall |
| At the default chord tolerance 0.01, with the short run, a blind hole among the bodies and the ring in the bores, 100 random threads: 2 of 300 cuts refused (an external thread 237 mm from the origin and an internal one 171 mm from it, both turned, both accepted at the origin unturned), none of the 100 into a blind hole; with an end in a face, 14 to 50 %. The solid tool was refused in the same two cases | P | The rule of the ends holds at the tolerance a document has. A refusal far from the origin stays possible and is reported; the 1 mm run past the ends cleared both, a run of 0.1 or 0.02 one of them |
| An external thread as a cut of a rod at the major diameter keeps the selected face as the crest | D | Both kinds are cuts; the pin stays in both modes |
| Every swept tool faces outwards in both hands: a signed volume above zero within 1.4 % of the exact one for the solid, the groove and the ring, one and two starts | L | The builder needs no turn of its triangles for a left-hand thread (a review said it does) |
| A radial clearance on a pin at the nominal radius: the flat left on the wall is `P/8 − 2c · tan α`; at M10 with 0.1 it is 0.072 and the wall is there (29.9 mm² of 28.7 expected), with 0.2 it is below zero and the wall is gone. A pin made at `D − 2c` keeps the full flat at 0.2 and at 0.4 | M | The clearance model, and the refusal when no flat is left |
| A screw in a nut with a radial clearance, the walls made for it: nothing shared at 0.06 and above at a chord tolerance of 0.05, a fit in 7.4 s at 0.02. A pin left at the nominal diameter with a clearance of 0.1, in a nut without one: a fit (its crest lies in the root of the nut) | M | Free of each other when every radial gap, at the flanks and at both crests, is at least the chord tolerance: the walls have to be made for the clearance |
| The engine's check of collisions: nothing above the tolerance; a fit below it, in 3.5 to 10 s | K | Said in the description of `clearance`; no warning code |
| A ring as the tool of a bore takes the same volume as the solid screw shape in the same time, and leaves a post in the middle of the bore, which the solid tool takes without a trace (444 mm³ against 200) | N | The tool of a bore is a ring |
| A key standing into a bore and a rib on a pin leave the hidden faces of the tool in the body | N | The hidden faces carry a number of their own, and a triangle of it in the result is the error |
| A plain rod in a modelled nut, a rod or a modelled screw in a plain hole at the minor diameter: collisions 0.75 to 0.86 mm deep, every vertex of the shared volume within the tolerance of the zone | K | The pairs the check has to excuse |
| A pin pushed through a solid block, a plate or a bar through a pin: every vertex of what they share lies in the zone too. A wall pushed into a pin from one side lies in the zone whole, over 55° of the turn | O | The vertices of what two bodies share cannot be the rule; a piece has to go around the axis |
| A rod in a cosmetic bore with a countersink shares 0.68 mm of the cone beyond the wall | O, Q | The zone runs out through a chamfer as the thread does; the ends are read in both modes |
| A head seated on a face leaves a sheet without thickness in the mesh the two bodies share; a cut of that mesh came out half a per cent wrong or refused. With the body of the thread cut by the ring of the zone instead, 19 pairs come out right in both orders of the bodies: four with flush faces excused, a countersunk head as a fit beside the thread, a pin through a block, a jaw of 100° and a wall as collisions, one half of a split nut excused | Q | The zone is a cut of the body with the thread; what the other body shares with the part in the zone is read by its volume and its centre, and the rest is judged as every pair |
| The ends of nine walls of bodies the engine built, the jar and the lid of scenario 18 among them, read from the mesh: a flat cap has every vertex on the circle of the wall | R | The reading of an end: the surface of the face across the rim, then its third vertex, which counts as inside the cylinder when it lies on it |
| The phase of the second of two threads that run in opposite directions is `−φ₁ − turn · 2π · L / lead`: off by a third of a millimetre with the first phase kept | S | The table of "The phase" |
| A cosmetic stud 0.1 to 0.8 off the axis of its cosmetic bore: each zone alone is taken and the two rests share nothing, while the rest of the plate collides with the whole stud | T | Two threads that meet and are not on one line do not agree; the pair is judged whole |
| One number per role served any count of starts; the wall keeps its number; a flat end is a face of its own | G | The face roles |
| Eight threads in one boolean are 3.7 times faster than eight in turn | F | Several faces in one feature are one tool |
| A thread shallower than five chord tolerances is not a thread at that tolerance | H | `MIN_THREAD_DEPTH_TOLERANCES` |

Not measured, and so "To verify before the implementation": the ends of a wall whose rim is no circle, the cut of the zone on real bodies in poses, a run-out through a chamfer or a countersink cut by the tool, a thread across a cross hole, the browser.

## Decisions

### A feature on faces, not a tool of a pattern

The thread names a body and faces of it, as a chamfer names a body and edges (D63), and is no source of a pattern (`producesTool` false).

- **A cosmetic thread has no tool.** A pattern of features repeats tool recipes; for the cosmetic half of the feature it would have to repeat something else, through `applyTool` and its accounting of `noEffect`.
- **Several faces are one tool and one boolean**, which is the fast path the spike measured (0.45 s for eight M8 threads at a tolerance of 0.01 against 1.7 s in turn). A pattern applies its copies in turn, and merging them there changes the order of every pattern and what `noEffect` can tell.
- **`copies: true` follows the patterns of this document.** The thread is then also made on every face of the body whose name is a listed name with further copy tags of patterns of this document: the bores a pattern of a hole made.
  - A further tag is followed when the state has the transform of that copy (`State.copyTransforms`), which only the step of a pattern of this document writes. So two kinds of tag are not followed. One whose pattern has a slash (a pattern inside an inserted document): a face of the thread on such a copy would be named by a feature of this document with a tag of the inserted one, which the rule of form of a face name forbids ([naming.md](../../architecture/naming.md), "Faces of an insertion"). And the tag a combine with a clearance gives the faces of its pocket (`features/combine.ts`): they are faces of the opposite sense. Such faces are listed, when they are to have a thread.
  - A listed face is never a copy: a face that is listed and is also the copy of another listed face gets its thread once, as listed. A face that is the copy of two listed names belongs to the one with the most tags in common.
  - The copies come after the listed faces, in the order of the listed faces and then of their keys.
  - A count that changes needs no change of the thread (`calls.ts`, `fourInARow`). The thread has to stand after the pattern in the timeline, which no reference says: a thread with `copies` that finds no copy has the warning `noCopies`, and the fact `copies` gives the count.
- **A pattern of the body copies its threads with it**, as it copies chamfers.
- The cost: the faces are listed, and taking one out of the middle of the list renames the faces of the threads after it (`face` is the place in the list), the limit a chamfer has.

**The hand on a mirrored copy** (owner, 2026-11-26: how do other CAD tools do it, and what is wanted). Fusion turns the hand over when a threaded hole is mirrored, as a feature or with its body, and its makers call that correct; Inventor is reported to keep the specification; in Onshape the thread is data of the hole, a mirror of the part copies the geometry and a mirror of the feature rebuilds it as stated. What is wanted differs: for screws the same hand on both sides, for some custom parts the opposite (a left pedal, a turnbuckle). The design:

- **The copy of a face a mirror made (`copies`) gets the stated hand.** The thread is built at that face from the fields of the feature; it is not the mirror image of the thread of the source. Every screw of the catalog enters it.
- **A mirrored body is the mirror image**, as a set of points, so its thread has the opposite hand, cosmetic and modelled alike: the mesh of a modelled thread is mirrored by the pattern, and the record of either is moved by the same transform, which turns `hand` over (`movedThread`). The helix a cosmetic record describes on the mirrored body is exactly the image of the helix on the source ("What the evaluation records").
- **Every published record says the hand the thread has where it lies** (`ThreadResult.hand`), not the stated one, so an AI sees what came out.
- **The opposite hand on a mirrored copy of a face** is a second thread feature with `hand: 'left'` that lists the copy, with the first one listing its face without `copies`. An option of the feature for it (`mirroredHand: 'same' | 'opposite'`) is a candidate for the backlog (question 44).
- **A mirror of a body that turns the hand of a thread says so** (owner, 2026-11-27: a mirrored half of a housing with tapped M3 holes gets left-hand threads without a word, and the screws are right-hand). The pattern feature that mirrors the body has the warning `mirroredThread` when a thread on one of its copies has the hand opposite to the one its thread feature states. The detail says how many threads became left-hand (or right-hand, for a thread stated left), and that a thread feature placed after the mirror, on the faces of the copy, keeps the stated hand; `refs` name the copies. It sits on the pattern, not on the thread: the thread is right where it was made, and the pattern is what changed it. A mirror of a mirror gives the stated hand back, so the second pattern has no warning for those threads (an even number of mirrors gives none); a mirror of features has none either, since `copies` keeps the stated hand. Stage 1: the records are there.

### The profile

The basic profile in the axial plane is a trapezoid ridge per pitch:

| Field | Meaning | Absent |
|---|---|---|
| `diameter` | the nominal diameter, the major diameter of the basic profile | required |
| `pitch` | from ridge to ridge along the axis; the lead is `pitch · starts` | required |
| `flankAngle` | the angle between the two flanks | `deg(60)` |
| `depth` | the radial height, from the major to the minor diameter | `5 · pitch / (16 · tan(flankAngle / 2))` |
| `starts` | the number of ridges, 1 to 16 | 1 |
| `clearance` | the thread moved radially away from its mate | 0 |

- **The default depth is the ISO proportion at any angle**: 5/8 of the height of the sharp V. At 60° that is 0.541266 · P, the minor diameter D − 1.082532 · P of ISO 724, computed from the pitch and not copied from a rounded table; at 90° it is 0.3125 · P.
- **The flats follow.** What the flanks leave of a pitch, `pitch − 2 · depth · tan(flankAngle / 2)`, is divided 1 : 2 between the flat at the major diameter and the flat at the minor one: P/8 and P/4 at the defaults, the profile of ISO 68-1. A negative remainder is `invalidThread` (the flanks would cross). Four numbers give the profile; a fifth (the pitch diameter) would make the user of a custom thread compute it (rejected alternative 9).
- **Printing.** The flank angle is the parameter printed threads need: at 60° a flank overhangs by 60° from the vertical, at 90° by 45°. `calls.ts` builds the jar with `deg(90)`, two starts and a clearance of 0.3.
- A flank with no angle (a square thread) is outside the range of `flankAngle`: the builders refuse it.
- Another profile family (question 46) is a later optional field with the trapezoid as its default: no schema step.

**The clearance is a radial shift** (changed by the review; question 51). The thread of a feature with a clearance `c` is the basic thread of a diameter smaller by `2c` (on a pin) or larger by `2c` (in a bore), with the same pitch, depth and flats: its flanks and its root move radially by `c`, away from the mate.

- **The gaps it gives**, against a mate of the basic profile: `c` at the root and at the crest (when the wall is made at the shifted size), and `c · sin(flankAngle / 2)` between the flanks, measured across them: half of `c` at 60°, 0.71 of it at 90°.
- **The crest is the wall as it was made**, and is not moved: the bore or the pin is the user's geometry. What the grooves leave of the wall between them, the **flat on the wall**, is the flat of the shifted profile at its own crest, wider by `2 · tan(flankAngle / 2)` for every unit the wall truncates the shifted thread, narrower by as much for every unit the wall stands proud of it:

  | Face | The flat on the wall (r the radius of the wall, D/2 the major radius, h the depth, α half the flank angle) |
  |---|---|
  | a pin | `crestFlat + 2 · (D/2 − c − r) · tan α` |
  | a bore | `rootFlat + 2 · (r − (D/2 − h + c)) · tan α` |

  - A pin made at `D − 2c` and a bore made at the minor diameter plus `2c` keep the full flat (P/8 and P/4) at any clearance: that is the way to make a printed pair.
  - A pin at the nominal diameter loses `2c · tan α` of its flat: at 60° it is gone at `c = 0.108 · P` (0.16 for M10, 0.27 for M20). A bore at the minor diameter loses the same of P/4 and is gone at `0.217 · P`.
  - **No flat left is `invalidThread`, in both modes**: the grooves would take the whole wall, and with it the face the thread was placed on (measured: M of spike.md). The detail says what the wall would have to be (`diameter − 2 · clearance` for a pin) and the largest clearance the wall as it is takes.
- **A modelled screw and nut are free of each other when every radial gap between them is the chord tolerance or more**: between the flanks (the two clearances together) and between each crest and the root it faces. A mesh deviates from its surface along the radius, and so does the shift. Measured on M10 at a tolerance of 0.05 (M of spike.md): nothing shared from 0.06 up with the walls made for the clearance; a fit, in seconds, below it (K); and a fit for a pin left at the nominal diameter with a clearance of 0.1 in a nut without one, because the crest of that pin is its wall and lies in the root of the nut. The clearance of a thread frees its flanks and its root; its crest is freed by the size of its wall or by the clearance of the mate. The description of the field says so.
- **It is how ISO 965 places a tolerance**: the fundamental deviation of a class shifts the whole profile radially (question 51, a). Tolerance classes can later be rows of a catalog that fill `clearance`.
- **What the first version had**, a move of the flanks along their normal with the crest held at the wall, could not take the clearances it recommended: on a pin the flat was gone at `0.054 · P` (0.08 for M10), in a bore at the tap drill at `0.129 · P` (0.19 for M10), and no way of making the wall brought it back (review; rejected alternative 20).

### The wall

**A whole cylinder.** The face has to be a cylinder (`Surface` of the kind `cylinder`) whose triangles in the body cover every angle about its axis: the angles of its triangles, seen along the axis, leave no gap. A part of a cylinder (the rounded corner of a pocket, the end of a slot, a fillet of a straight edge) is `invalidThread`: on a convex corner the tool of a pin would cut a slit into the body beside the face. A cylinder that is whole somewhere along its length and interrupted elsewhere (a bore crossed by a hole or a keyway that does not run its whole length) passes; a bore slit along its whole length (a clamp) does not, and gets its slit after the thread (question 53); the message of the refusal says so (cut the slit after the thread).

**Internal or external** is read from the body, never stated: over the triangles of the face, the normals point away from the axis on a pin and towards it on a bore (the pass the query `body` makes for `convex`; the sum of the normals of a full cylinder is zero and tells nothing). A face the body has both ways (one cylinder left as a bore and as a pin by a combine) is `invalidThread`. One feature may hold bores and pins: each is judged by itself, and for the M8 of a catalog row a bore at 6.8 and a pin at 8 both pass.

A stated kind would be a second source for what the body says, and wrong after the first combine that turns a pin into a hole (rejected alternative 7).

### The face against the thread

The face gives the wall; the feature states the thread. They have to agree, in both modes (r the radius of the wall, D/2 the major radius, h the depth, c the clearance):

| Face | Accepted | Otherwise `invalidThread`, with the numbers |
|---|---|---|
| a bore | `D/2 − h ≤ r ≤ D/2 + c − h/2` | narrower than the minor diameter of the thread (drill it at the tap-drill size), or so wide that less than half of the depth is left |
| a pin | `D/2 − c − h/2 ≤ r ≤ D/2` | wider than the major diameter, or so narrow that less than half of the depth is left |
| either | the flat on the wall is above zero ("The profile") | the clearance leaves no crest on the wall: the size the wall would have to be, and the clearance it takes as it is |

- The comparisons take `LENGTH_TOLERANCE`.
- **The window moves with the clearance** on the side the thread is shifted to (review): a bore widened by `2c` for a thread with the clearance `c` is as far from its bound as the plain bore is from the plain bound. Without it a printed bore fell out of the window: the bound lies only 0.23 mm (M3) to 0.37 mm (M5) of diameter above the tap drill, less than a printer's allowance.
- **The wall is the crest as made.** A bore at the tap drill (6.8 for M8, where the minor diameter is 6.647) gives a thread a little shallower than the basic one, as a tapped hole is; a bore with a 50 % thread (D − 0.65 · P) still passes. The tool of a bore never widens it: only the grooves are cut.
- **An error, not a warning, and in both modes** (question 47): a cosmetic thread that says M8 on a bore of 5 is false data. The detail of the error names the sizes, so an AI can correct the hole.
- **The checks of the fields and of the faces are the same in both modes.** A modelled thread adds the checks that exist because of the mesh, which depend on the chord tolerance ("The tool and the boolean"); so a cosmetic thread that is accepted can be modelled unless it is too fine for the tolerance of the document or something stands in the way of its tool. (The first version claimed more.)
- **The nominal diameter is stated, not read from a pin.** A pin made 0.4 under the nominal for a printed fit is still an M8; a thread that took its diameter from the pin would follow every change of the pin and stop fitting its nut without a word (rejected alternative 8).

### Where the thread is

`direction` is `forward` or `backward`: the thread starts at the end of the face its axis points away from and runs along the axis of the face, or starts at the other end and runs against it. The axis of a face has the sense of D60 (for an extrusion and a hole the normal of the sketch), so for a hole made from a sketch on a face a thread from the mouth is `backward`, as the hole itself is: the vocabulary of an extent. `offset` moves the start along the thread; `length` is how long it is, to the far end of the face when absent.

- The ends of a face are the extreme points of its triangles along the axis, in the body before the feature. A face in several pieces (the bores of two lugs cut by one circle) is one wall from its first point to its last; the tool passes the gap in the air.
- A thread that would pass the far end by more than the precision of the coordinates is `invalidThread`: beyond an open end there is nothing to cut, and beyond a shoulder there is material that must stay.
- **An end within the lift of an end of the wall is at that end** (review). The lift is `threadLift`, the distance a tool keeps from what it must not lie in ("The tool and the boolean"). A thread whose `offset` is below the lift starts as one with no offset does, and one that ends less than the lift before the far end ends as one that reaches it: a flat end of a tool 0.01 mm from a shoulder would lie nearer to it than the tool of a thread with no offset, in the band where the kernel adapter refuses, and a skin thinner than the lift at an open end cannot be kept. The record keeps `from` and `to` as stated; the run-out of such an end is counted from the end of the wall, and the tool and the zone of the check of collisions take the end of the wall for the end of the thread there.

### The phase

For a screw to sit in a nut their helices have to be one curve. The design makes where the helix lies deterministic, stable, steerable and published.

- **The datum.** `origin` is the point of the axis in the plane of the end of the face the thread starts from; `axis` the direction the thread runs in; `zero` a direction across the axis. The middle of the crest of the basic profile (of a pin the middle of its ridge, of a bore the middle of its groove: one curve for both) passes `origin + s · axis` at the angle θ from `zero` (right-hand rule about `axis`) with `s = turn · lead · θ / 2π + k · pitch`, `turn` +1 for a right-hand thread and −1 for a left-hand one.
- **`zero` of a listed face is the X axis of the model made perpendicular to the axis** (the Y axis when the axis is within about 26° of X: the component of the axis along X above 0.9), turned by `phase`. The threshold lies at no angle a model usually has (30°, 45°, 60°, 90° all take X). It is a function of the axis alone: no sketch, no order of features and no tessellation moves it.
- **The helix of a copy (`copies`) is that of its listed face, carried by the pattern** (changed by the first review, made whole by the second; question 54). The datum of the listed face, its `origin`, `axis` and `zero`, is moved by the transforms of the copy tags that lead from the listed face to the copy, and the helix of the copy is the one that datum gives with the stated hand.
  - So the helices of a circle of tapped holes are turned with their holes, exactly as the helices of a circle of screws are that a pattern of a body made, and every screw of the circle sits in its hole when one does. With the rule of the model's X axis on every copy they did not: holes along Z copied about Z kept one helix while the screws were turned by the angle of their place, 60° of M10 being a quarter of a millimetre along the axis, more than the play of a printed pair.
  - **The record of a copy starts at the copy's own wall**, as every record does: `origin` and `axis` are read from the wall of the copy. Where that wall starts `δ` further along its axis than the carried origin (the copy of a hole through a step of the body: the copies of a pattern of features are built against their own targets), `zero` is the carried one turned by `turn · 2π · δ / lead` about the axis, which is the same helix seen from the other origin. On a flat flange `δ` is zero.
  - A mirror carries the datum like every transform and keeps the stated hand: the helix of the mirrored copy is not the mirror image of the source's, it is the stated thread through the mirrored datum.
  - The pattern step keeps the transform of every copy in the state (`State.copyTransforms`), for this and for the rule of which tags `copies` follows.
  - A copy that is listed itself has the datum of a listed face.
- **It is anchored at the end of the face, not at the start of the thread**: `offset` and `length` trim the helix and do not turn it. The end of the face moves when the face is made longer at that end, and the thread moves with it, as "from the mouth" says.
- **`phase` turns it**, and the record publishes the datum (`ThreadResult`), so the phase that seats a mate is one expression. For two threads of one hand, pitch and number of starts on one line, the first with the phase `φ₁` (S of spike.md):

  | The second thread runs | Its phase |
  |---|---|
  | the same way, its origin `g` further along that direction | `φ₁ + turn · 2π · g / lead` |
  | the other way (a bolt from above into a nut threaded from below), its origin `L` from the first one's along the first direction | `−φ₁ − turn · 2π · L / lead` |

  The first phase changes its sign in the second row: both threads take the same base direction, and each turns it by its phase about its own direction, which are opposite. (The first revision had `φ₁` there with its sign kept, right only for a first phase of zero: second review.) `calls.ts` has both rows with a first phase that is not zero: the collar 4 below the top of the stud, threaded from above and from below. (The lid, 0.5 above the neck, is the first row with a first phase of zero.) Two threads that start from one plane in one direction with the same phase fit as they are.
- **The base direction is fixed with stage 1** (question 58): the model's X axis, the Y axis within 26° of it. Every stored `phase` is counted from it, so another base later is an upgrade step that converts the phases. A later optional field that names another reference for the direction, with the model as its default, would not change a stored phase.
- A copy of the body carries its helix rigidly (`movedThread`).

Rejected: a datum at the start of the thread (a change of `offset` would turn every thread on a mate), `zero` from the sketch of the feature that made the face (`FaceInfo` does not carry it, and two builds of one cylinder would disagree), and a datum from the first vertex of the wall (it moves with the chord tolerance).

### The ends

Each end of a thread is `inside`, `open` or `shoulder`. An end within the wall, by `offset` or `length`, is `inside`. An end at an end of the wall is read from the mesh of the body in the state before the feature, at every recompute and in both modes (`threadEndAt`): a modelled thread builds its tool by it, and the zone of every thread in the check of collisions runs out by it. The reading below is the second one: the first revision judged the vertex across the rim alone, which reads a flat cap as a wall that goes on (all three reviewers of the second round). It was run as a prototype on nine walls of bodies the engine built, the jar and the lid of scenario 18 among them (R of spike.md).

- **The rim of an end.** The edges the wall shares with other faces form loops. A loop that goes around the axis is a rim (the loop of a cross hole does not go around). The rim of an end is the one that holds the extreme point of the wall at that end. It need not be a circle: a hole in a round or a leaning face has a rim that rises and falls, and the end of the wall is its extreme point.
- **The triangle of another face across an edge of the rim** decides, by two exact things: the surface of its face, and where its third vertex lies against the cylinder of the wall (a distance from the axis, compared with the radius to the precision of the coordinates). The vertices a tool build makes lie on the exact surface of their face; those a boolean makes where two faces cross lie on chords of them, a little inside a round face, and count as inside the cylinder like the vertices on it, so the answer does not turn with the size of the triangles (the third review measured rim vertices 0.006 to 0.010 inside the wall of a pin with a fillet at its tip, read right).
  - Its face is a cylinder about the same axis with the same radius (the directions to `ANGLE_TOLERANCE`, the lines and the radii to `LENGTH_TOLERANCE`): **the wall goes on** there, under another name.
  - Else its third vertex lies beyond the radius: the triangle lies **outside the cylinder**.
  - Else, within the radius or on it: the triangle lies **inside the cylinder**. A vertex on the cylinder is the case of a flat cap, which the engine triangulates from the vertices of its boundary alone: every vertex of the bottom of a blind hole and of the free end of a pin lies on the circle of the wall, and a triangle with three vertices on a cylinder is a chord of it.
  - Inside the cylinder is the air side of a bore and the material side of a pin; outside it the other way round.
- **The order of the tests**, over all triangles across the rim:
  1. **A shoulder**, when one of them lies on the air side: the bottom of a blind hole, flat or not, a narrower bore, the cone of a drill point; the plate a pin stands on, a wider step, a fillet at its foot.
  2. Otherwise the end is **`inside`**, when the wall goes on along the whole rim. The thread ends flat at the end of the listed face, in the material.
  3. Otherwise **open**: every one lies on the material side (a mouth in a face, the seat of a counterbore, a chamfer or a countersink; the free end of a pin, flat or chamfered), or the wall goes on over a part of the rim and is open over the rest (a bore in two faces whose upper one is opened by a pocket). The third review measured two such rims read as `inside` by the rule "at one of them", which put the flat end of a tool in the plane of a face of the body.
- **The run-out of an open end** is how far beyond the end the thread still cuts. The band of the thread is between the wall and the root cylinder of the shifted thread (for a bore within `D/2 + c` of the axis, for a pin beyond `D/2 − h − c`). The faces across the rim, other than those where the wall goes on, are walked from the rim, triangle by triangle across their edges, no further than those faces and only through triangles that have a part in the band beyond the end (the stop the prototype has and the second revision did not say: without it a set-screw hole through the wall of a hub read 11.4 for 0.26, third review); the run-out is the largest distance beyond the end at which a part of a walked triangle lies in the band. Zero for a mouth in a plane across the axis and for the seat of a counterbore; the axial depth of a chamfer or a countersink until it is as wide as the major diameter; the same for the chamfered tip of a pin until it is as narrow as the minor one; what a leaning or a hollow face rises within the band. So a thread runs out through a chamfer as a tap cuts it; a tool that stopped at the end of the wall would leave the grooves closed by a wedge of the cone, and no screw would enter.
  - Only the faces at the rim are walked (the first revision walked on through every face in the band, which followed a step along its whole length: second review). What lies in the band beyond those faces, a relief or a step between the wall and the root of the thread, is not run out through: the tool ends flat one lift into it, and the check of collisions sees a rod of the nominal diameter collide with it, as it does (a known limit).
- **What the tool does.** At a shoulder it ends flat `threadLift` short. At an end `inside` it ends flat where the thread ends. At an open end it runs past by the run-out and the lift.
- **A rim that is partly a shoulder is a shoulder.** The tool stops short all around and leaves a skin of the lift on the open part (a known limit).
- **A rim that is partly open and elsewhere the wall going on is open.** It runs out by what the faces of its open part give; the faces where the wall goes on are not walked (they lie in the band for their whole length, and a walk of them would thread the next face: second opinion on the third review; the prototype never walked them). The tool runs past the end by that run-out and the lift all around, and leaves a flat end that far into the face that goes on.
- **A wrong reading is mild.** Every flat end of a tool is a face of its own (`threadEnd`): an end taken for open that has material beyond it leaves a flat end there, as a thread that ends inside does, and nothing is misnamed.
- **A body that changes.** The ends are read again whenever the feature is recomputed, so a change before it in the timeline (a blind hole made through, a plate added under a pin) changes how the thread ends, with no field to go stale. A feature after the thread does not: a shoulder cut away later leaves the thread ending the lift short of where it stood. Shape the ends before the thread.

The reading is from the mesh and costs one pass over the triangles of the body (4 to 27 ms a wall in the prototype); no boolean probes it. A probe (the intersection of the body with a cylinder beyond the end) would say only whether something is there, not on which side or how far the run-out reaches, and costs a boolean per end (rejected alternative 11). A field of the feature per end would have to be right again after every change of the body (rejected alternative 10).

### The tool and the boolean (stage 2)

- **The lift.** `threadLift = max(0.05, 2 · tol, 2 · band)`: how far a tool keeps from what it must not lie in, and how far it runs past an open end. `band` is the band of the kernel adapter for the body (`bandOf` of `recompute/body-boolean.ts`, 10⁻⁵ of its size or of twice its distance from the origin), as D63 holds its lift above two bands; of the body alone, because the lift is needed in stage 1, where there is no tool, and a tool reaches no further than the lift beyond its body. The third term decides only beyond 1.25 m. (The refusals of P are not its case: at 237 mm the lift is ten bands.)
- **One tool per wall**, the spike's sweep (`buildThreadTool`): the axial profile with its four points along four helices, the sections at the angles where a helix meets an end plane, a vertex near an end plane moved into it. The division of the turn is the rule of an arc at the major radius for the chord tolerance of the document, as it is (no halving: the vertices lie on the surface). The builder makes both hands by the same triangles (the surface is a graph over the angle and the height; L of spike.md). Two things differ from the builder of the spike, which is moved: the middle of the crest of the basic profile lies at `s = 0` at the angle of `zero`, as the datum says (the spike's profile starts half a pitch from it), and the flanks are named by their normals (`start`, `end`), where the spike names them by the side of the profile, which is the other way round in a bore.
  - **A bore: a ring**, between a cylinder two lifts inside the wall and the thread surface (the screw shape of the shifted diameter); between the grooves the ring ends one lift inside the wall, with the flanks run on to there. A solid screw shape would also take whatever stands in the bore, a post or a pin in its middle, without a trace (N of spike.md).
  - **A pin**: between the thread surface and a cylinder two lifts outside the wall; between the grooves it starts one lift outside the wall, with the flanks run on to there.
- **The hidden faces carry a number of their own, one per wall.** The faces of a tool that lie in the air beside the wall (the two cylinders above, and the strips between the grooves) get a number that is no face of the model, another for every wall of the feature, so that what is found names its wall. After the boolean a triangle of such a number in the body means that something crossed the hidden faces of that tool within two lifts of the wall: a rib or a boss on a pin, a key or a wide post in a bore (N of spike.md: both leave such triangles). That is `invalidThread`, with the face of that wall in `refs`, and the body stays as it was. What stands less than two lifts proud of the wall wholly within the footprint of a groove crosses no hidden face and is cut with the groove, as a tap would cut it (a known limit; a reviewer measured a boss 0.03 high). (The first version gave those faces the number of the root and called a triangle left `kernelFailure`: a flat end past an open end that met material was then a planar piece of a face described as a cylinder. Review.)
- **Every flat end is `threadEnd`**, at both ends of every tool, whatever the end was read as. One that lies in the air leaves no triangle.
- **One solid of all walls**, their meshes one after another, and one `boolean('difference')` through `applyTool` (its checks of an imported target, of an empty result and of a refusal apply; the recipe is not stored). The five faces of every wall enter the face table as those of every tool do; one with no triangle in the body is on no body.
- **Checks that exist because of the mesh**, all `invalidThread`, before the build:
  - the depth left on a face below five chord tolerances;
  - a bore no wider than four lifts (the ring of its tool would have no hole);
  - nothing left of the span of a tool once it stops the lift short of a shoulder (a thread no longer than the lift at a shoulder, or than two lifts between two);
  - the flat on the wall so narrow that the flanks of the tool meet within one chord tolerance beyond the wall (the flat below `2 · tol · tan α`): the polygon of the wall lies up to a sagitta inside its circle, and a strip narrower than that cannot be told from none. Measured at 1.25 tolerances beyond the wall (an M10 pin with a clearance of 0.1 at a tolerance of 0.05): the cut is taken and the wall left is what the profile says (M of spike.md); nearer than that is for the fuzz of stage 2;
  - two tools of the feature that would cross: the cylinders that hold them (about the axis of each wall, to two lifts beyond the wall on the air side and to the root on the other, over the span and the run-outs) meet. One solid of two tools that cross is no closed mesh; the threads go into two features. Bores that cross with a cosmetic thread each are fine;
  - more than `MAX_THREAD_TRIANGLES` (200 000) triangles in the tool, counted before it is built: per wall, eight for every line of the turn and every pitch of the span of its tool, and the two ends.
- **A refusal of the kernel** is `kernelFailure` with the reason; the detail adds that a small change of `phase` or `offset` gives another mesh. Measured: 1 of 300 cuts at tolerances of 0.02 to 0.1 (bores cut with the solid screw shape) and 2 of 300 at the default 0.01 (with the ring, and the same two with the solid shape), every one turned and 170 mm or more from the origin and accepted at the origin (J and P of spike.md). Another run past the open ends cleared the refusals of P (both with 1 mm, one of the two with 0.1 and with 0.02), so a second build with another hidden dimension is a candidate for the step before it reports the failure; it is not designed, because a longer run past an end is only harmless where nothing of the body lies beyond it ("To verify").

### Faces, surfaces and edges (stage 2)

| Role | Parts | What | Surface |
|---|---|---|---|
| `threadFlank` | `face`, `side` | a flank; `side` is `start` for the one whose normal out of the body points towards the start of the thread, `end` for the other | `general` |
| `threadRoot` | `face` | the bottom of the groove: the minor cylinder of a pin's thread, the major cylinder of a bore's, each shifted by the clearance | cylinder about the axis of the wall |
| `threadEnd` | `face`, `end` | a flat end of the groove: at a shoulder, inside the wall, or where an end read as open met material | plane across the axis |

- **The crest is the face the thread was placed on**, with its name and its exact cylinder; the checks of the flat on the wall see to it that a strip of it is always left. A sketch's projection of its rim, an `AxisRef` of the kind `face` and a joint on it hold whether the thread is modelled or not.
- **`face` is the place in `faces`**, from 0; the thread on a copy of that face carries the further copy tags of the copy (tags of patterns of this document, so the name obeys the rule of form). One face per role whatever the number of starts.
- **A profile with no flat at its root** (the largest depth a pitch takes) has a root that is an edge: `threadRoot` is then on no body. Nothing reads a thread through its root; the record hangs on the wall.
- **The two flanks have names of their own** because one of them is the overhang of a print: with the thread starting at the top, the flank `end` faces down, on a pin and in a bore alike (its normal out of the body points to the end of the thread). The first revision said `start` for a bore, against its own definition (second review).
- **A flank is `FaceInfo` `{ planar: false, surface: 'general' }`**, published as `Surface` `general`. It is not `mesh`: a body with a thread can be changed by later features, and `isImported` keeps asking for `mesh`. It is not `swept`: that is a planar curve moved along a straight axis, and the section view and the clearance of a combine read it as such. Every switch on the surface of a face gets the kind (`surfaceOf`, `transformFace`, `normalAt` in `solid.ts`; `query/entity.ts`; the texts of `recompute/edge-blend.ts`, which refuse it as an end face; `recompute/moved-body.ts`, which moves a swept face along its curve and has nothing to move a flank along, so a combine with a clearance whose tool has a modelled thread is refused with that reason).
- **Edges.** A flank with the wall, with the root and with a flat end: `other` (helices and their ends), so not projected, chamfered or filleted. The root with a flat end and a flat end with the wall are circles (a plane across the axis and a cylinder).

### What the evaluation records

`State.threads` is a list of records, one per thread on a face: the number of the face, the profile, the hand, whether it is internal and modelled, the datum, the span, how its ends end and how far it runs out (`ThreadRecord`). The step of a thread feature appends its records, in both modes. The evaluation publishes them as `Evaluation.threads` with the name of the face and the bodies that have it (`ThreadResult`).

- **Keyed by the number of the face.** A boolean carries face numbers, so a thread follows its wall through later cuts and onto both parts of a split, with no code in those features. A wall that is gone (the hole drilled out) leaves its record without a body; it is not published.
- **Published on a body only where the face has the sense of the thread** (review; question 52). A combine carries the faces of its tools into its target: in a difference without a clearance the bore of a tool becomes a pin of the target and its threaded pin a bore, under the same number, and with `keepTools` one number lies on two bodies with opposite senses. So `threadResults` reads, for every body that has the face, the side the material is on there (the reading of "The wall", kept by the mesh), and lists the body only when it agrees with `internal` of the record. A union carries a thread into its target; a difference drops it. A nut made by cutting a modelled screw out of a block has the screw's flanks as its geometry and no record (a known limit). A difference with a clearance gives the faces it leaves new numbers, so nothing follows there either.
- **Two places copy faces and copy the records with them**: the pattern of a body (the transform of the copy; a mirror turns `hand` over; the face of the copy) and the insertion (its placement; the feature of the record prefixed as the face names are). Both call `movedThread`.
  - **A mirror, exactly.** With the datum moved by a reflection (`origin` as a point, `axis` and `zero` as directions) and `hand` turned over, the curve the record describes is the mirror image of the curve of the source: a reflection turns the sense of the angle about the moved axis, which the turned hand takes back. The mesh of a modelled thread on the mirrored body is the mirrored mesh, so the record and the geometry agree, and a cosmetic record says what a modelled one would be.
- **`hand` of a published record is the hand the thread has where it lies**: the stated one on the faces of the feature and on their copies, the opposite one on a mirrored copy of the body (the opposite of that again after a second mirror).
- **The span is the one the feature gave, and each body says what it still has of the wall.** A later cut that shortens the wall, and a split, do not shorten `from` and `to` of the record. Beside the bodies, a published thread says for each of them the stretch of the axis its part of the wall still covers (`walls`: from the first to the last point of the triangles of the face in that body, read in the pass that reads the sense). The zone of the check of collisions is the span cut to that stretch, and it runs out only at an end the wall still has. (The first revision let the check use the whole span, and a pin cut short and made longer again with a plain cylinder was excused by the thread it had lost: second review.) A wall cut away in its middle and filled again is not seen by a stretch (a known limit).
- **A published thread keeps its identity.** `threadResults` hands out the same object for a record for as long as its face, its bodies and their stretches are the same, as the states share the records. The queries keep what they compute by those objects, beside the meshes.
- **In a posed query** the records move with their bodies: `queryContext` takes `threads` out of the evaluation it hands to a query, as it takes `bodies` and `faceSurfaces`, and answers `context.threads(body)` with the datum where the pose puts the body, and `context.threadsAsModelled(body)` with the published objects themselves (the frame the mesh of the body is in, and the identity a memo needs). The query `body` adds its `threads` outside what it keeps by the mesh.
- **Not in `FaceInfo`**: the description of a face does not change once its number is given, and the memo of a body's description hangs on that (rejected alternative 12). **Not a new name for the face**: what refers to the bore would break when a thread is put on it (rejected alternative 13).
- **A second thread on a wall** over a part of the same length is `invalidThread` for the later feature, in both modes; two threads on two stretches of one bore are fine.

### The check of collisions

A screw in a bore with a cosmetic thread overlaps it by design: the rod reaches from the tap-drill diameter to the nominal one. So does a bought screw (a plain cylinder) in a modelled nut. The query `interference` lists such a pair under `threaded` (`Threaded`).

This section is the third version of the rule. The first read the vertices of the mesh two bodies share; the second read its vertices and triangles piece by piece. Both fail where a face of the screw lies flush on a face of the tapped body (a seated head, a shoulder, a rod on the bottom of a blind hole): the shared mesh then holds a sheet without thickness, in one order of the two bodies and not in the other, and a connected piece cannot part a thread overlap from a fit joined to it (second review). The rule now makes no boolean of a shared mesh and reads nothing from its vertices (Q of spike.md: 18 pairs, each in both orders).

**The zone** of a thread on a body: between the wall and the root of that thread (a bore: from the radius of the wall to `D/2 + c`; a pin: from `D/2 − h − c` to the radius of the wall), and along the axis over the span the body still has of the wall ("What the evaluation records"), longer by the run-out at an open end the wall still has (the stretch of the body reaches within the lift of that end of the wall as the thread was made on it). Zones of one body about one axis with the same two radii whose spans touch or overlap are one zone, when their threads are the same in every field `threadsAgree` compares and in their clearance (a wall in two faces with the same thread on each; the axes and the radii to the tolerances of "the wall goes on", the spans to the lift). Two different threads on one wall stay two zones.

**The ring** of a zone is the zone grown by the chord tolerance and the precision of the coordinates at the root, into the material of its body, and by the lift (`threadLift`) everywhere else: beside the wall, into the air, and at both ends, into the air of an open end and into the material of a shoulder or of an end inside the wall alike. No face of it lies in a face of the body or nearer to one than the lift. (The second revision grew it by the chord tolerance at an end in the material; the third review measured that the kernel then refuses the cut of a blind bore in a pose, "To verify" 1. The lift excuses an annulus one lift deep beyond the end: a rod 0.02 too long for a blind bore still leaves its core, a collision, Q of spike.md.)

**The rule**, for a pair of which one body has a thread whose ring meets the box of the other body:

1. **The body with the thread is cut by the ring** into the part in its zone and the rest (two booleans of that body, kept by its mesh and the published thread, in the frame the body was modelled in).
2. **What the other body shares with the part in the zone** is computed with the body of the thread first. **Every connected piece of it above `THREAD_PIECE_VOLUME` (0.001 mm³, the value of `INTERFERENCE_THRESHOLD`: the constant, not the threshold a caller gives the query, which may be zero) has to go around the axis, and there has to be one**: a smaller piece is not judged (a sheet comes out as pieces of 10⁻¹⁸ mm³, most of them not around), and with no piece nothing is taken (a rod that passes a tapped hole without touching it has no entry). A piece goes around when its centre of volume lies nearer to the axis than 0.827 of the root of its mean squared distance from the axis, which is where the centre of a third of a ring lies (`THREAD_AROUND`, `sin 60° / (π/3)`; question 57). Both are sums over the triangles of the piece, to which a sheet adds nothing. Then **the zone is taken** and the volume of those pieces is excused.
   - A body pushed into the thread from one side does not go around: a straight wall covers at most `2 · acos(low / high)` of a zone (68° of M8, a ratio of 0.94; below a third of a turn while the root radius is more than half of the other one, which holds for every row of the catalog and fails only for a coarse thread on a thin pin, such as a pitch of 1.5 on a diameter of 2), a jaw of 100° has 0.88. One half of a split nut has 0.64 and goes around; a threshold at a half would lie on that value.
   - A zone of which a piece does not go around, or whose booleans the kernel refuses, is not taken, and changes nothing.
3. **The rest is judged as every pair is**: the body without the rings of its taken zones stands in for it, with its faces and, on the cuts, a number of no face. Nothing left, or noise, and the pair is in `threaded` alone; a fit left (the head of the screw in its counterbore, the cone of a countersunk head in its countersink) and it is in `threaded` and in `fits`; a collision left and it is in `pairs` alone, with the volume and depth of what is left. So a pin through a solid block (its core is left), a rod thicker than the major diameter, a screw longer than the thread into the bottom of a blind hole and a head that sinks into the face still collide. A pair the kernel refuses is failed or cleared as every refused pair is (D50), and stays in `threaded` when a zone was taken.

- **The other body need not carry a thread** (question 48): a reference screw is a cylinder, and a stud with a cosmetic thread in a hole at its tap-drill size is what a tapped hole looks like before it has its thread feature.
- **When the other body has a thread that meets this one, the two have to agree** (`threadsAgree`, on the threads as the pose puts them).
  - **Apart**: the rings of the two zones do not meet in space. On one line (the directions parallel or opposite within `ANGLE_TOLERANCE`, the lines no further apart than the chord tolerance) that is when the zones do not overlap along the axis or across it, in their radii: two threads on two stretches of one line, and the external M10 and the internal M6 of one bushing, each of which meets its own mate. Off one line it is when the two rings share no volume (their boxes first, then one boolean of two rings): two tapped holes side by side in a plate, each with its screw. Threads that are apart do not concern each other.
  - **Agree**: on one line, one internal and the other external, and the pitch, the number of starts, the hand as each lies, the nominal diameter, the flank angle and the depth the same (lengths to `LENGTH_TOLERANCE`, the angle to `ANGLE_TOLERANCE`). The axis of a thread is the direction it runs in, so a bolt from above meets a hole threaded from above the other way: parallel or opposite.
  - **Otherwise they do not agree**: the rings meet and the profiles differ, or both are bores or both pins, or the two axes are not one line (a stud 0.3 off the axis of its hole, or leaning in it). Neither zone is taken, the pair is judged whole, and its entry in `pairs` says what differs (`mismatch`): "a left-hand thread in a right-hand one", "flanks at 90° against 60°", "the axes are 0.3 apart".
  - The last case came out of the second opinion on the third review, measured (T of spike.md): with threads off one line counted as apart, each zone was judged alone, each still held a piece that goes around, and the two rests shared nothing, so a cosmetic stud up to 0.8 off the axis of its cosmetic bore was `threaded`.
- **Two modelled threads are not excused.** Their meshes are the truth: a nut turned half a pitch against its stud is a collision (`calls.ts`, `wrongPhase`). A modelled thread excuses a plain body or one with a cosmetic thread.
  - **When the two agree and the pair still collides, the entry says how to seat them** (owner, 2026-11-27, with answer 48; stage 2). `threadsAgree` says that the profiles agree; the two published datums say how far the helices are turned against each other: the helix of the first, followed along the line to the origin of the second, crosses there at an angle `Δ` from the `zero` of the second, counted about the direction of the second and taken to the nearest of the `starts` positions that seat. The entry in `pairs` carries `seat`: for each of the two threads its feature, its face and what to add to its `phase` so that the two are one helix (`Δ` for the second; for the first `−Δ` when the two run the same way and `Δ` when they run opposite ways). Either one seats the pair.
  - **This is exact from the records**: the middle of the crest of a pin and of the groove of a bore are one curve whatever the clearances (a radial shift moves neither), and the number of starts only says how many positions seat. **What the message cannot say**: that the pair is free afterwards (clearances below the chord tolerance still give a fit, and a shank, a head or an end may collide as well); the new expression of a `phase` that is an expression (it gives the angle to add); and anything for another pose (in a posed query it holds for that pose, and says so). When `Δ` is zero within the angle tolerance, the entry says that the helices are one curve already and the collision has another cause. A `phase` belongs to a feature, so on a thread with several faces or copies it turns them all.
- **An entry of `threaded`** names the pair, the volume excused and the thread of every zone taken (one body in several threaded bores: a U-bolt, a comb). Two agreeing threads about one line are both named and both zones are cut (one may reach further along the line than the other, and excuses the plain shank there); they excuse much the same volume, so `volume` counts the larger of their two and adds the zones about other lines.
- **What is kept.** The two parts of a body by its mesh and the published threads of the zone (one, or the several of a joined zone; each keeps its identity while nothing of it changes); what the other body shares with a part, and with the rest, by the two meshes, as every pair is kept today. So a thread added to an unchanged mesh changes the answer, and nothing new is kept for a pair without a thread.
- **In a pose** the cut is made in the frame the body of the thread was modelled in, and the two meshes of each intersection meet as the two bodies of a pair do: the first as modelled, the second moved by the transform between the two, which `pairInFrame` hands out beside the pair it moves (`relative`, with the precision it keeps; it moves the bodies a context knows, and a part or a rest is no such body). The test of going around is made with the body of the thread first, so its axis is that of the published thread as modelled. A zone of the second body is judged with that body first, the first body moved by the inverse of that transform; when both bodies have a taken zone, the rest of the second is moved by the transform.
- **The cost**: three booleans beside the one of every pair, 5 to 55 ms a pair in Q, 170 ms with a modelled nut. The measure of the depth, which took a second on a thread, is made of the rest alone.
- `check_interference` prints the list, with the volume rounded (an entry has no depth); the view of the query in the app shows the pairs in a third group.

**The smallest gap** (D40) asks `interference` whether a pair that is zero apart, or whose surfaces do not cross, shares a volume, and reads `pairs`, `fits` and `cleared` (`sharedBy` of `query/gap.ts`). A pair excused by a thread would come back as touching, or with a gap between a set screw and the wall of its bore (first review); and a pair cleared after a refusal is read as touching whatever else is said of it (second review). It gains the contact `threaded`, at a distance of zero: for a pair that has an entry in `threaded` and none in `pairs`, `fits` or `failed`, and is not cleared as a fit. What it keeps for a pair is kept by the two meshes today and gets the published threads of the two bodies as well.

The mass and the print check read the mesh and say nothing of a cosmetic thread.

### Queries, get_model and get_body

- `Evaluation.threads` is what the app reads.
- The query `body` (the tool `get_body`) adds `threads`: the records on the faces of that body, when it has any; in a pose, where the pose puts them.
- `get_model` adds to the row of a body a line per thread: the label or `diameter x pitch`, internal or external, cosmetic or modelled, the hand when it is left, the face. A thread feature has the default row of a feature with its facts.
- No query of its own: a thread is asked through the body it is on, and the catalog through `catalog` (rejected alternative 15).
- **The parts list** (D57), stage 1: a hole whose bore carries a thread is left out of `unlabelled` (owner, 2026-11-27: that list points at forgotten labels, and a tapped hole has none on purpose); a hole feature of which some bores have a thread is listed with the count of the others. The list joins a body and its unchanged copies in one row by their meshes. A modelled thread changes the mesh, so a threaded body is a row of its own; a cosmetic one does not, so a body with a cosmetic thread and a copy without one are one row until the point between the stages, which puts the threads of a body into the key of a row and a summary of them into the row ("Stages"; answer 56).

### The view and the picture

A cosmetic thread is drawn as its helix: a thin line on the wall, one per start, lifted a hair to the air side, from `from` to `to`, in the colour of annotations (`threadLines` in `draw.ts`, plain geometry over a record; at most 4 000 points per thread, fewer per turn when there are many turns). It moves with the pose of its body and is cut by a section as the edges of a body are. The model of a picture gets the same lines, so `view_image` shows which holes are threaded. A modelled thread needs nothing: it is in the mesh. The rows of what is under the pointer name the thread of a face.

A band of hatching, as drawings have it, was the other candidate: it needs a texture or a second pass over the face, and says less (the hand and the pitch are seen in a helix).

### Export

STL and 3MF write the mesh: a cosmetic thread is not in it, which is the point of it (the bore is tapped after printing, or takes a self-tapping screw). No format carries the record: the outline formats are sections, the robot formats are meshes, and the parts list counts hardware by the labels of holes. That an export says which bodies have threads it left out is the point between the stages ("Stages"; answer 50).

### The hole

A tapped hole is two features: a hole at the tap-drill diameter and a thread on its bores. `hardwareHole` gains the use `tapped` and composes both: `shape` (plain, the tap drill of `metricThreads`) and `thread` (`diameter`, `pitch`, `label`, and with an allowance `clearance`) for a thread feature whose faces are `{ feature: <hole>, role: 'holeBore', point }`.

- **The hole feature does not change**: no field, no schema step, no second place that knows what a thread is. A thread goes on any cylinder (an extruded cut, a revolved bore, a pin), so an option of the hole would cover a part of the cases with a copy of the fields.
- **The allowance is the clearance.** With an allowance `A` the bore is the tap drill plus `A`, as for every use, and the thread gets the clearance `A / 2` (as an expression of the same text): the printed thread is the thread of the diameter larger by `A`, the bore keeps its place in the window of the thread, and the flat on the wall is what the plain pair has. A tapped M3 with an allowance of 0.3 is accepted (`calls.ts`); with the allowance on the bore alone it was `invalidThread` for every size up to M5 (review).
- **No label for the hole** (review; question 55). The parts list counts a piece of hardware per labelled hole, and says that a hole that takes no piece of its own should have no label (the description of the query `partsList`, `query/parts-list.ts`). A tapped hole takes the screw that comes through the clearance hole above it, which that hole counts: a label on both would count the screw twice. `tapped` answers with a label for the thread ("M6") and none for the hole. The parts list leaves a hole whose bore carries a thread out of its `unlabelled` holes (owner, 2026-11-27).
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
- **The check of collisions**: 40 ms for a screw free of its nut. A pair with a thread costs three booleans beside the one of every pair (the body by the ring, twice, kept by the mesh and the thread; the part in the zone against the other body): 5 to 55 ms in Q of spike.md, 170 ms with a modelled nut. The depth, whose measure took a second on such a pair, is measured of the rest alone. Two modelled threads closer than the tolerance take seconds and are listed as a fit.
- **The app** was not measured: the WASM library in a browser and the renderer with such a body are stage 2's first measurement, before the toggle is enabled.

## Recompute

The step, in `features/thread.ts` over `recompute/thread.ts`:

1. The body from the state (`brokenReference`).
2. The walls. Every listed face by its name on that body (`brokenReference` with the face); with `copies` the copies of the listed faces by the rules of "A feature on faces", after the listed ones (none found: the warning `noCopies`). Each has to be a whole cylinder with the material on one side (`invalidThread`); its side and its two ends are read from the triangles (`threadWall`).
3. The profile (`threadProfile`; `invalidThread` when it does not fit into a pitch) and the check of every wall against it: the window and the flat on the wall.
4. The span of every wall from `direction`, `offset` and `length` (`invalidThread` past the far end), its datum (for a copy the datum of its listed face carried by `State.copyTransforms`, its `zero` turned for where the wall of the copy starts), and its two ends with their run-outs (`threadEndAt`, which reads the surfaces of the faces across the rim).
5. An earlier thread on a wall over a part of that span: `invalidThread` with that feature in `refs`.
6. Cosmetic: the records are appended, the bodies stay the same objects. Done.
7. Modelled (stage 2): `importedTarget` for a body with an imported face; the checks of the mesh; the tools into one solid; `applyTool` with a recipe that is not stored; a triangle with the number of the hidden faces in the result is `invalidThread`; the records are appended.
8. `facts`: `depth`, `minorDiameter`, `lead`, `crestFlat`, `rootFlat`, `threads`, `copies`, and `triangles` when modelled.

A feature in error changes nothing and records nothing; what refers to a face of its thread is a `brokenReference`. The step reads the body, the face table, the transforms of the copies and the chord tolerance, so the evaluator's memo holds as for a chamfer.

## The document and the schema

```ts
interface ThreadFeature extends FeatureBase {
  type: 'thread';
  body: Id;
  faces: FaceName[];        // at least one, none twice
  copies?: boolean;         // also the copies of the faces a pattern of this document made
  modelled: boolean;
  diameter: number;         // nominal = major
  pitch: number;
  depth?: number;           // absent: the ISO proportion
  flankAngle?: number;      // absent: deg(60)
  clearance?: number;       // radial; absent: 0
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
- **References**: the body, and every face by `faceRefs` (its feature, and every pattern in its copy tags), so `moveFeature` keeps the thread behind them. A thread on the bores of a hole stands after the hole; with `copies` it has to stand after the pattern too, which no reference says: placed before it, it finds no copies and has the warning `noCopies`.
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
| `recompute/thread.ts` | new: `threadProfile`, `threadWall`, the spans and the datum, `threadEndAt`, the records, `movedThread`, `threadResults` (with the sense of the face on every body); in stage 2 the checks of the mesh | 1, 2 |
| `recompute/tool-thread.ts` | new: `buildThreadTool`, moved from the spike with its tests (the deviation from the exact surface, the exact volume, the two hands) | 2 |
| `recompute/state.ts`, `evaluate.ts` | `State.threads`, empty before the first feature; `Evaluation.threads` | 1 |
| `features/pattern.ts`, `features/insert.ts` | where faces are copied, the records on them are copied (`movedThread`); the pattern step keeps the transform of every copy (`State.copyTransforms`), of features and of bodies, and a mirror of a body warns of the threads whose hand it turned (`mirroredThread`) | 1 |
| `query/parts-list.ts` | a hole whose bore carries a thread is not `unlabelled` (stage 1); `threads` of a row and the threads in the key of a row (the point between the stages) | 1, between |
| `export/`, `packages/mcp/src/export-writer.ts`, `query/print.ts` | `Exported.notes` and the line per body with cosmetic threads; the server prints the notes; `cosmeticThreads` of the print check | between |
| `solid.ts`, `query/entity.ts`, `recompute/edge-blend.ts`, `recompute/moved-body.ts` | the `FaceInfo` `general` in every switch | 2 |
| `interference.ts`, `query/interference.ts` | the zones of a pair (`threadZone`, joined where they touch), `threadsAgree`, the cut of a body by the ring of a zone (`zoneParts`, kept by the mesh and the published thread), the test of going around (`goesAround`), the pair judged on the rest of the body, the list `threaded`, `mismatch` on an entry of `pairs`. `sharedBy` and `verdictOf` do not change | 1 |
| `query/spec.ts` | `QueryContext.threads` and `threadsAsModelled` | 1 |
| `query/gap.ts` | the contact `threaded` (also for a pair cleared after a refusal that has an entry in `threaded`); its memo of a pair by the published threads too | 1 |
| `query/context.ts` | `threads` taken out of the evaluation a query sees; `context.threads(body)` in the pose and `context.threadsAsModelled(body)` | 1 |
| `query/pose.ts` | `pairInFrame` and `framed` also return the transform that puts the second body into the frame of the first (`relative`), for the parts and the rests of a posed pair | 1 |
| `sketch-cut.ts` | the entry of `PROFILE_SOURCES` (a thread reads no profile; the map does not compile without it), and a case of the rename patches for `faces`, as a chamfer has for `edges`: without it a sketch tool that renames the curve of a threaded cylinder one to one reports the thread as not patched | 1 |
| `query/body.ts` | `threads` of a body, added outside what is kept by the mesh | 1 |
| `catalogs/threads.ts`, `data-catalogs.ts` | new: the table; one entry | 1 |
| `query/hardware-hole.ts` | the use `tapped` | 1 |
| `packages/mcp` | `threads` in the rows of `get_model`; `threaded` in the answer of `check_interference` (it passes the report on; the volume of an entry of the new list is rounded by a helper of its own, since the one of today takes a volume and a depth) and in its description; `CONVENTIONS` of `api.ts`: how a thread is made; the typed rows of `queries.test.ts` for the new option | 1 |
| `packages/app` | below | 1, 2 |
| `packages/kernel-manifold/test` | a fuzz of thread tools on the adapter, as `taper-fuzz.test.ts` | 2 |
| `docs/architecture/thread.md`, `docs/ui/thread.md` | new; `hole.md` (the catalog, `tapped`), `naming.md` (the roles), `api.md` (the report, the body), `ai.md` | 1, 2 |

## The app and MCP

- **MCP** needs no tool: the feature through `execute`, the catalog through `query` (`catalog`), a tapped hole through `query` (`hardwareHole`), the threads through `get_model` and `get_body`. With the selection of D74, "thread this hole M6" is `get_selection` (the picked face as `{ body, face }`), the row `M6` of the catalog and one `addFeature`.
- **The app** gets an entry of `FEATURE_UI`, `features/thread.ts`:
  - a button *Thread*; a cylindrical face selected in the view when it is pressed is the first face;
  - the faces: an armed picker (`picks: { faces: true, before: true }`), a click on a cylindrical face of the body adds or removes it, the first click sets the body; a face that is not a cylinder is refused with a hint;
  - *From the catalog*: a size from the keys of `metricThreads`, which fills `diameter`, `pitch` and `label`, and under it what the picked faces would have to be (the tap drill for a bore, the nominal diameter for a pin, each moved by twice the clearance) against what they are, read from `faceSurfaces`;
  - the fields from `FEATURE_TYPE_INFO.thread.fields` (angles in degrees for a bare number; an empty depth and length show their defaults as placeholders), the hand and the direction as two-way choices, the checkbox *Also the copies of a pattern*, the label;
  - the toggle *Modelled* (stage 1: off and disabled, with a line that says so);
  - the preview as every form has it: the helix lines for a cosmetic thread, the cut body for a modelled one;
  - the model panel: the label or `diameter x pitch`, the number of threads, cosmetic or modelled; a selected thread highlights its walls and, when modelled, its faces (`ownsFace`).
- `ROLES` of the app gets three texts; `issue-text.ts` names the faces in the refs of `invalidThread` (`BY_FACES`).
- `Evaluation.threads` is a new field of every evaluation, so the snapshots of `packages/app/test/app.test.ts` change where they print one; the commit of stage 1 says so.

## Issue codes

| Code | Kind | When |
|---|---|---|
| `invalidThread` | error, new | the fields and the faces do not make a thread: the cases of `IssueCodes` in `contract.ts`; modelled also: something stands in the way of the tool |
| `mirroredThread` | warning, new, on a pattern | a mirror of a body turned the hand of threads on its copies: how many, and that a thread placed after the mirror keeps the stated hand |
| `noCopies` | warning, new | `copies` is true and the body has no copy of a listed face (the thread stands before its pattern, or the pattern is gone) |
| `brokenReference` | error | the body, or a listed face it does not have |
| `importedTarget`, `emptyResult`, `kernelFailure` | error | modelled: as for a cut |
| `invalidExpression` | error | a field |

A cut that changes nothing cannot pass the checks of the wall; if the kernel returns the body unchanged all the same, the feature has `noEffect` as a cut has.

## Shared vocabulary

- **Takes:** the registry of feature types, `FACE_ROLES`, `IssueCodes`, `DATA_CATALOGS` and the query `catalog`, `Surface` (`general`), `faceRefs` and `requireFace`, `applyTool`, the copy tags of D53, `hardwareHole` of D46, the report of D50.
- **Adds:** the feature type `thread` and its patch; the roles `threadFlank`, `threadRoot`, `threadEnd`; the codes `invalidThread`, `noCopies` and `mirroredThread`; the catalog `metricThreads`; `Evaluation.threads` with `ThreadResult`; `threads` of the description of a body and of the context of a query; `threaded` of the report of collisions, `mismatch` of an entry of its `pairs`, `seat` of an entry of `pairs` between two modelled threads that agree; the contact `threaded` of the smallest gap; after stage 1 `notes` of `Exported`, `cosmeticThreads` of the print check and `threads` of a row of the parts list; the use `tapped` of `hardwareHole`; `State.copyTransforms`; the `FaceInfo` `general`.

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
20. **The clearance as a move of the flanks along their normal, the crest held at the wall** (the first version). It cannot take a printed clearance: the flat of a pin is gone at `0.054 · P`, and no size of the pin brings it back ("The profile").
21. **A tool that also turns the wall down to the shifted crest.** The pin could then stay at the nominal diameter with any clearance, but the face the thread was placed on would be gone in the modelled mode and there in the cosmetic one, and with it everything that refers to it.
22. **The zone tested on the vertices alone**, **on the whole shared volume at once**, and **on the vertices and triangles of each connected piece of what two bodies share** (the first revision). Above ("The check of collisions"): a sheet without thickness in the shared mesh defeats every reading of its vertices.
22a. **Cutting the mesh two bodies share by the ring.** The cut of a mesh that holds a sheet came out wrong or refused (Q of spike.md); the body of the thread is cut instead.
22b. **Going around read from the angles of the vertices of a piece.** A sheet adds vertices; the centre of volume does not see it.
22c. **The end of a wall read from the vertex across the rim alone.** A flat cap has all its vertices on the cylinder ("The ends").
23. **A mismatch of two threads as a note on an excused pair.** A reader of the report looks at `pairs`; a bolt in a nut of the other hand is not an assembly.
24. **The model's X axis as `zero` on every copy.** Above ("The phase").
25. **A solid screw shape as the tool of a bore.** Above ("The tool and the boolean").
26. **The hidden faces and the ends beyond an open end under the number of the root.** Above.

## Known limits

- **The basic profile, no tolerance class.** The root of a modelled screw is flat at d1; a real screw's is rounded and deeper. A modelled nut fits a real screw; a real nut fits a modelled screw only with a clearance.
- **The clearance needs the wall made for it.** A pin at the nominal diameter takes a clearance up to `0.108 · P` at 60° (0.16 for M10) before no flat is left and the feature is refused; a printed pair wants the pin at `diameter − 2 · clearance` and the bore wider by as much, which the feature says in its error and does not do itself. A pin that is accepted at the nominal diameter with a clearance still has its crest at the nominal diameter, in the root of a nut without a clearance: the check of collisions calls the pair a fit (M of spike.md).
- **Flat ends**: no lead-in but a chamfer made before the thread; the thread runs out through it. A chamfer of the rim after a modelled thread is refused: the rim is still arcs of a circle, but they end where the grooves run out, at flanks, and a chamfer does not end at a face of the kind `general`.
- **A rim partly open and partly at a shoulder** is treated as a shoulder: a skin of the lift stays over the grooves on the open part.
- **A rim partly open where the wall goes on over the rest** is open: the tool runs the lift past the end all around and leaves a flat end one lift into the face that goes on.
- **A cross bore at an open end.** The run-out is read on the faces at the rim within the band of the thread, and a bore of about the same size that meets the wall there lies in that band for its whole length: an M6 hole into a bore of 6 read a run-out of 4.6 (third review), and two tapped holes of one size that meet do the same. The zone of the check and the tool then reach that far into the other bore.
- **A thread that starts at an end with a fillet or another tangent blend.** The end of the wall is where the triangles of the face end, and next to a tangent blend that is up to `√(2 · radius · tolerance)` late (0.14 mm for a fillet of 1 at 0.01) and moves with the tessellation; the origin of the record, its stretch and the anchor of the helix move with it. After a chamfer it is at most the chord tolerance. Give such a thread an `offset`, or blend after it.
- **Inside the span the wall is taken as it is, on the material side.** A thread across a cross hole or a slot passes through the air. What crosses the hidden faces of a tool on the air side within two lifts of the wall (a rib on a pin, a key in a bore) is found after the boolean and refuses a modelled thread; a cosmetic thread on such a wall is accepted and cannot be modelled. What stands less than two lifts proud wholly within the footprint of a groove is cut with the groove and leaves no trace. A post in a bore further than two lifts from the wall is left alone.
- **A relief or a step between the wall and the root of the thread beyond an open end** (a counterbore narrower than the major diameter) is not run out through: a modelled tool ends flat one lift into it, and a rod of the nominal diameter collides with it. Make a relief at least as wide as the major diameter.
- **A feature after the thread does not move its ends**, and does not shorten the span its record gives: a wall cut shorter, or split, still lists the thread from `from` to `to`, with the stretch each body still has of the wall beside it (`walls`), which is what the check of collisions goes by. A wall cut away in its middle and filled again with other material keeps its zone there.
- **A half that is mirrored and joined.** A body built as one half with a thread, mirrored as a body and united with its image has a left-hand record on the mirrored half (the mirror image of a right-hand thread) beside the right-hand one; the mirror has the warning `mirroredThread`. Put the thread after the union, on the faces of both halves (`copies` follows the mirror of a feature, not of a body: list the faces).
- **A wall that goes on under another name** (two coaxial faces of one radius) ends the thread flat at the end of the listed face; listing both gives two threads whose helices are anchored at two ends and need a `phase` to meet.
- **A difference drops the thread of its tool**: a nut made by cutting a modelled screw out of a block has the geometry and no record, so nothing lists it and the check of collisions does not know it.
- **`zero` is fixed to the model**, not to the body: a part whose sketch is turned about the axis of its thread keeps the helix where it was. It switches from X to Y where the axis comes within about 26° of X. A copy listed by its own name has the datum of a listed face, not that of its source.
- **No mate.** A screw is seated by a `phase`; a pose of the mechanism that turns a screw does not advance it, and the check of collisions then reports two modelled threads as colliding.
- **What the zone excuses.** Anything that lies in the zone and goes around the axis: a rod of the right diameter in a threaded bore with the wrong pitch passes when it carries no thread of its own, and so does a threaded stud in a plain hole between its minor and major diameter, and a half shell of that radius (one half of a split nut, and one half of a plain housing closed around a threaded neck). A mate that covers a third of a turn or less is not excused and is a collision. The pieces are judged one by one: a modelled thread of several starts shorter than a third of its lead against a plain rod is not excused (no ridge of it goes around), and a fork that reaches into a thread from two sides is a collision.
- **Two threaded parts whose axes are more than the chord tolerance apart, or lean, are a collision** with the reason, however small the error; a plain rod in a threaded hole is judged by what the rest of the hole's body shares with it.
- **A zone the kernel cannot cut is not taken**: the pair is then judged whole, which for a mate is a collision.
- **A pair in a pose far from the origin.** The second body of a posed pair carries the noise of its move, and the kernel then refuses what it shares with the part in a zone more often: 3 of 40 at 300 mm and 11 of 40 at 500 mm for a seated head, none at 50 and 150 mm (third review). Each refusal makes a mate a collision. Reading the pieces from the intersection as computed (`intersectionAsComputed`, as D50 does for a refused pair) is the candidate; it is not designed.
- **What goes around is judged piece by piece, above a fixed volume.** A piece of less than 0.001 mm³ in a zone is not judged; a zone with no larger piece is not taken. A concave jaw of the radius of the thread pressed into it over more than a third of a turn is excused (question 57).
- **The ring of a zone reaches one lift beyond each end of the zone**, also into the material of a shoulder: what another body shares with that annulus (a rod up to one lift too long, within the band of the thread) is excused with the thread; its core is not.
- **A wall that is gone takes its thread from the lists**: the record of a thread whose face is on no body is not published. A profile with no flat at its root leaves `threadRoot` on no body.
- **`copies` follows patterns of this document, not points and not the patterns of an inserted one**: a point added to a hole feature is threaded when its bore is listed.
- **Taking a face out of the middle of `faces`** renames the faces of the threads after it.
- **The surfaces of the flanks are `general`**: no sketch on them, no measure of an angle to them, and a combine with a clearance refuses a tool that has a modelled thread (it has no surface to move a flank along; a cosmetic thread on the tool is no obstacle).
- **The chord tolerance is the document's**: 0.01 by default, with no command to change it. The triangle counts of this design at 0.05 hold only for a file that carries it.
- **A cosmetic thread is in no export, and does not make a body a part of its own in the parts list**, and until the point between the stages neither says so. That point ends both: the export and the print check name the bodies, and the parts list keys its rows by the threads too (answers 50 and 56).
- **A point added to a hole feature later is not threaded** until its bore is listed; a flag for every bore of a hole is a candidate for the backlog.
- **A thread shallower than 0.05 mm at the default tolerance cannot be modelled** (a pitch below about 0.1 mm); M2 can (0.217).
- **What a tool swallows.** What stands less than two lifts proud of the wall wholly within the footprint of a groove is cut with the groove and leaves no trace; a post further than two lifts from the wall of a bore is left alone.
- **The kernel refuses a modelled thread now and then far from the origin**: 2 of 300 cuts at the default tolerance, both turned and 170 mm or more away (P of spike.md). The feature is then in error with a hint; a second build with another hidden dimension is a candidate and is not designed.
- **Not measured before the implementation** ("To verify"): the cut of a zone on bodies of many faces and where the kernel refuses it; the ends on a rim that is no circle beyond the reviewer's probes, with the run-out cut exactly; a tool through a chamfer or a countersink; a thread across a cross hole or a slot; flats narrower than two chord tolerances; the cap of 200 000 triangles; the browser. The clearance of a mate was measured on one size at a tolerance of 0.05.
- **What the remedy of two modelled threads says**: the angle to add to a `phase`, for the pose asked about; not that the pair is free afterwards.

## To verify before the implementation

Before stage 1, on the real engine (a prototype of a few lines each; none needs the kernel beyond an intersection):

1. **The cut of the zone on real bodies**: bodies of many faces and in poses, zones far from the origin, how often the kernel refuses one of the three booleans, and what the cut of a large body costs. What the third review measured on a blind bore tapped M6 at a tolerance of 0.01 (30 random poses per cell; the body without the ring, refused):

   | The ring grows at the shoulder by | 150 mm from the origin, askew | 300 mm | 500 mm | The axis along a model axis |
   |---|---|---|---|---|
   | the chord tolerance (0.0101) | 16 | 28 | 19 | 0 |
   | 0.02 | 2 | 13 | 13 | |
   | 0.03 | 0 | 8 | 8 | |
   | the lift (0.05), as designed | 0 | 0 | 0 | |

   And for a posed pair whose second body carries the noise of its move: what that body shares with the part in the zone (a seated head) was refused in 0 of 40 at 50 and at 150 mm, in 3 of 40 at 300 mm and in 11 of 40 at 500 mm. Sheets never joined two pieces of one side into one that goes around (400 random flush cases), and six flush pairs came out the same in both orders. To do: the same on the engine, with the pieces read from `intersectionAsComputed` when the boolean is refused, as the second opinion of D50 reads a refused pair.
2. **The ends on more bodies** than the nine walls of R of spike.md: a rim that is no circle (a hole in a round face from outside and from inside, in a leaning face), a drill point, a filleted foot, a rim partly at a shoulder, a rim partly open where the wall goes on, a cross bore at the end, countersinks of several angles, in random poses, after the cuts the kernel makes of caps (thin triangles along a rim, a rim cut by an earlier feature), and the run-out cut exactly where the prototype samples. In stage 1 a wrong reading costs a wrong run-out of a zone; in stage 2 it places a tool. (The third review read 13 further walls with the prototype, rims made by a later cut and round and leaning mouths among them, and 360 random blends and cuts: right but for the mixed rim and the cross bore, which the text now has.)
3. **The sense of a face on a body** after a combine in every operation, with and without kept tools.

Before stage 2, as an addition to the spike:

4. **The tool through a run-out**: a thread cut out through a chamfer and a countersink (the adapter takes the tool, the volume is that of the exact thread), which no measurement has yet; a tool that ends `inside` where the wall goes on under another name, its flat end in the plane of the loop of edges between the two faces; and a tool at a rim that is partly open where the wall goes on.
5. **A thread across a cross hole and a slot.**
6. **Narrow flats**: profiles whose flanks meet between one and two chord tolerances beyond the wall, at 0.01 (M of spike.md has one case at 0.05).
7. **The fuzz at the default tolerance** with every kind of end the classification makes, the blind hole among them (P of spike.md has 100 random threads at 0.01, with 2 of 300 cuts refused), and with it **a second build after a refusal**: whether another run past the open ends, or other radii of the hidden cylinder, clears it often enough to be worth a retry, and how the step knows that the longer run met nothing (its flat ends left no triangle).
8. **The browser**: the time of a modelled M10 and of the jar in the app, and the frame time of the view with the bodies they leave.
9. **The cap** of 200 000 triangles against a measured boolean of that size.

## Tests the implementation owes

- Stage 1: the warning `mirroredThread` (a mirrored body with threads, the count and the hand; none after a second mirror, none for a mirror of features, none for a body without a thread); a tapped hole left out of `unlabelled`, and a hole with one threaded bore of two; the rows of the catalog pinned, with `catalogChecks`; the validator (every field, the faces, `modelled: true` refused); the profile at the defaults against ISO 68-1 (P/8, P/4, 0.541266 P) and at 90°; the walls (a bore, a pin, a face in two pieces, a face both ways, a rounded corner, a bore slit along its length, a bore crossed by a hole); the window with a clearance and the flat on the wall (a pin at the nominal diameter at and beyond the largest clearance, a tapped M3 with an allowance of 0.3); every case of `invalidThread` of both modes; `copies` (a listed copy, a copy of two listed faces, a pattern inside an insertion not followed, `noCopies`); the datum (an axis along each model axis, at 25° and at 27° from X, the copies of a circle and of a mirror, the copy of a hole through a step of the body, a copy of a body, a mirrored copy of a body with its hand, an insertion); the two phases of a mate with a first phase that is not zero, in both hands; a circle of screws made by a pattern of a body in a circle of threads made by `copies`, both cosmetic, with their helices compared; the ends and their run-outs (the nine walls of R of spike.md and the cases of "To verify", pinned: a flat blind bottom and a flat free end first); the records through a later cut, a union, a difference with and without kept tools, a split and a removed wall; in a posed query; `threaded` (the pairs of K and every pair of Q of spike.md in both orders of the two IDs: a seated head, a head in a counterbore, a seated shoulder, a rod on a blind bottom, a countersunk head as a fit beside the thread; a rod too thick, a screw too long, two threads that disagree in each field of the rule, two threads on two stretches of one line, a bushing with an external and an internal thread in a tapped plate with a screw in it, a stud 0.3 off the axis of its tapped hole and one leaning in it, with two cosmetic threads and with two modelled ones, two different tapped holes side by side with a threaded screw in each, a rim that is open over a part where the wall goes on, two threads that abut on one wall, a rod that passes a tapped hole without touching it, one body in two threaded bores, a half shell and a jaw of 100°, a pin cut short and made longer again, a posed pair, a posed pair of two bodies with a cosmetic thread each, a refused pair) and that its answer changes when a thread is added to an unchanged mesh; the contact `threaded` of the smallest gap (a set screw inside its bore, and a pair cleared after a refusal); the rename patch of a sketch cut; the lines of the view over a record; the snapshots of the app with the new form; scenario 18, a and b.
- The point between the stages: the notes of every format that writes a mesh, for a body with and without cosmetic threads and for a modelled one (no note); `cosmeticThreads` of the print check; `threads` of a row of the parts list, and a body with a cosmetic thread and its copy without one as two rows.
- Stage 2: `seat` of a pair of two modelled threads that agree (the same way and opposite ways, both hands, two starts; applying either entry frees the pair; none when the helices are one curve and something else collides); the tool against the exact surface and the exact volume, both hands, one to three starts, the ring and the groove (the spike's tests moved, L among them); the fuzz on the adapter; the ends (pinned); the faces left and the faces gone, on every kind of end; a post left in a bore, a key and a rib that refuse the thread; two tools that cross; the `general` face through every consumer (a chamfer that ends at a flank is refused, a section draws it, a combine with a clearance refuses a tool that has one); a pin with a clearance at both sizes of M of spike.md; `wrongPhase`; scenario 18, c and d.

## Open

**Nothing is open: the owner answered questions 43 to 58 on 2026-11-27.** In the owner's words, "souhlasím se všemi body i s návrhy na změny": every recommendation is accepted, with the four changes below, which came out of the discussion of the answers, and two candidates for the backlog. The numbers continue those of [6-cross-review.md](../6-cross-review.md) (the last answer there is 42). 51 to 56 came out of the first round of reviews, 57 and 58 out of the second.

| Question | Decided (owner, 2026-11-27) |
|---|---|
| 43 | A list of faces with `copies`; no pattern of threads |
| 44 | The stated hand on a mirrored copy of a face, the opposite hand on a mirrored body. **Changed:** the pattern that mirrors a body warns of the threads whose hand it turned (`mirroredThread`, "A feature on faces"). `mirroredHand` stays a candidate for the backlog |
| 45 | A tapped hole is a hole and a thread, composed by `hardwareHole` |
| 46 | One profile family; another is a later field with a default, no schema step |
| 47 | A face at a size the thread cannot have is an error in both modes |
| 48 | Excused by the zone of one thread; two threads that meet and disagree are a collision with the reason. **Added:** two modelled threads that agree and still collide get the phase that seats them in the entry (`seat`, "The check of collisions"; stage 2) |
| 49 | The catalog as designed: ISO 262 from M2 to M64 with the tap drill. A catalog of pipe threads G is a candidate for the backlog |
| 50 | An export says which bodies have cosmetic threads it left out. **Changed:** not "some time after" but a point of its own right after stage 1 and before stage 2 ("Stages") |
| 51 | (a): the clearance is a radial shift, the wall as made. Confirmed as designed; fixed with stage 1 |
| 52 | A difference drops the thread of its tool |
| 53 | A part of a cylinder is refused; the message says to cut the slit after the thread |
| 54 | The helix of a copy is that of its listed face, carried by the pattern. Confirmed as designed; fixed with stage 1 |
| 55 | The label on the thread, none on the hole. **Changed:** a hole whose bore carries a thread is left out of `unlabelled` of the parts list, in stage 1 |
| 56 | **Changed:** not a known limit for good. The point between the stages gives the parts list a summary of the threads of a row and puts the threads of a body into the key of a row; until then one row |
| 57 | (a): a piece goes around when it covers more than a third of a turn |
| 58 | The model's axes as the base direction of the helix. Confirmed as designed; fixed with stage 1 |

Candidates for the backlog (owner, 2026-11-27; not designed): a flag that threads every bore of a listed hole feature, as a new optional field (`copies` keeps its meaning); a catalog of pipe threads G (55°).

The questions as they were put, each with the recommendation that is now the decision:

43. **A list of faces with `copies`, and no pattern of threads**, or one face per feature with the thread as a source of a pattern? *Recommendation: the list.* One boolean for many threads, a cosmetic thread needs no tool, and a mirrored hole keeps its hand. The price is a list to keep and face names by the place in it.
44. **The hand of a thread on a mirrored copy.** Other tools differ (Fusion turns it over for a mirrored feature and a mirrored body; Inventor is reported to keep the specification; Onshape rebuilds a mirrored feature as stated and copies the geometry of a mirrored part). *Recommendation: the stated hand on the mirrored copy of a face (`copies`), because a screw of the catalog has to enter it; the opposite hand on a mirrored body, because it is the mirror image, cosmetic and modelled alike; every record says the hand that came out.* The opposite hand on a copy of a face (a left pedal, a turnbuckle) is a second thread feature with `hand: 'left'` on that copy; an option `mirroredHand: 'same' | 'opposite'` goes to the backlog as a candidate.
45. **A tapped hole as a hole and a thread composed by `hardwareHole`**, or `thread` as an option of the hole feature? *Recommendation: composed.* The hole stays as it is, and the thread is one thing in one place.
46. **One profile family**: the trapezoid by a flank angle and a depth, with the flats divided as ISO divides them. Is that enough for printed lids and fittings, or is a second family wanted now (equal flats, a trapezoidal thread of ISO 2904, a round one)? *Recommendation: enough;* another family is a variant of the feature later. (Equal flats would give a pin at the nominal diameter twice the clearance before its flat is gone; a pin made for its clearance does not need them.)
47. **A face that is not at a size the thread can have is an error, also for a cosmetic thread**, or a warning there? *Recommendation: an error in both modes*, with the sizes in the message; the window moves with the clearance, so a bore widened for printing stays inside it.
48. **The check of collisions excuses what another body shares with the zone of one thread**, whether or not that body carries a thread, and lists the pair under `threaded`. Or only pairs in which both carry matching threads? *Recommendation: by the zone alone*, as a cut of the body with the thread ("The check of collisions"); when both carry a thread about that axis and the two disagree, in the pitch, the starts, the hand, the diameter, the flank angle or the depth, or are both bores or both pins, the pair is a collision with the reason (the first review made it a collision; the second added the profile).
49. **The catalog: ISO 262's selection from M2 to M64 in one catalog with the tap drill** (55 rows, five tap drills by the rule of ISO 2306 above its tables). Or also M1 to M1.8, every combination of ISO 261, or other standards (pipe, inch, trapezoidal)? *Recommendation: as designed;* a further standard is a further catalog when a model needs it.
50. **Should an export say that it left cosmetic threads out** (a line in the answer of `export`, and in the print check, naming the bodies)? *Recommendation: yes, as a small addition after stage 1*: it needs a place for notes in `Exported`, which no format has today.
51. **The clearance model.** Three ways to give a printed thread its room:
    - (a) *a radial shift, the wall as it was made*: the thread of a diameter smaller or larger by twice the clearance, cut into the pin or the bore the user made; no flat left on the wall is an error that says what the wall would have to be. A pin is made at `diameter − 2 · clearance`;
    - (b) *the flanks moved along their normal, the crest held at the wall* (the first version): the gap between the flanks is the clearance itself, but a pin takes no more than `0.054 · P` (0.08 for M10), whatever its size;
    - (c) *the tool also turns the wall down* to the shifted crest: the pin stays at the nominal diameter at any clearance, but the face the thread was placed on is gone when the thread is modelled, and with it what refers to it.

    *Recommendation: (a).* It is the only one that takes 0.2 and more on M10 and keeps the face (M of spike.md), and it reads simply: a thread with a clearance is the thread of the next diameter. The meaning of the stored field is fixed with stage 1.
52. **Does a combine carry a thread into its target?** A union does (the face keeps its sense). A difference turns a threaded pin into a bore of the nominal diameter, which is no thread of that record. *Recommendation: a difference drops it*, by the rule that a thread is listed only where its face has the sense it was made with. A nut made by cutting a modelled screw out of a block then has the geometry and no record; a record for it (the root of the screw as the wall of the nut) is a later addition.
53. **A part of a cylinder** (a rounded corner, the end of a slot, a bore slit along its whole length as a clamp has it). *Recommendation: refused;* the slit of a clamp is cut after the thread. Allowing a bore with a gap needs a tool cut to the angle of the wall and a rule for a mate that does not go around.
54. **The helix on the copies of a pattern.** *Recommendation: the helix of a copy is that of its listed face carried by the pattern* (the whole datum; where the wall of the copy starts at another height, its `zero` is turned so that the helix is the same), so that a circle of screws made by a pattern sits in a circle of tapped holes made by `copies`; a mirror carries the datum and keeps the stated hand. The alternative, the model's X axis at every copy, is simpler and seats only the pairs that are copied by a shift. It costs the transforms of the copies kept in the state. The meaning of `phase` on a copy is fixed with stage 1.
55. **The label of a tapped hole.** *Recommendation: `hardwareHole` with the use `tapped` gives the hole no label and the thread the label "M6"*, since the screw is counted at the hole it enters through; the tapped hole is then listed among the `unlabelled` holes of the parts list. The alternatives: a label "M6 tapped hole" on the hole (a row of hardware that is no piece, and a screw counted twice where its clearance hole is labelled too), or a parts list that leaves the holes with a thread out of `unlabelled`.
56. **A cosmetic thread and the rows of the parts list.** A body with a cosmetic thread and its copy without one are one row (one mesh); with a modelled thread they are two. *Recommendation: leave it, as a known limit, and settle it with question 50* (a note that names the bodies with cosmetic threads serves both).

57. **How far around the axis a piece has to go to be excused by a thread.** What another body shares with the zone of a thread is excused when it goes around the axis; a body pushed in from one side is a collision. A straight wall cannot cover more than 68° of an M8 zone, a whole mate covers all of it, and between them lie the halves: one half of a split nut, of a clamp, of a two-part housing closed around a threaded neck (180° or a little less each), and a jaw of the same radius.
    - (a) *more than a third of a turn* (the centre of the piece nearer to the axis than 0.827 of its radius): the halves are mates, a jaw of 100° and a straight wall are collisions (every straight wall for the threads of the catalog; not for a thread deeper than half of its radius);
    - (b) *clearly more than a half* (0.5 of the radius, about 217°): the halves are collisions, each to be read by the user as meant; a C-clip of 240° is a mate;
    - (c) *the whole turn*: only what closes around the axis.

    A threshold at a half itself is no candidate: it lies on the value of the commonest case and falls either way with the mesh (Q of spike.md). *Recommendation: (a).* It follows question 48 (a plain bore of the right size around a threaded stud is a mate, and half of it is half of one), and the reports of a split clamp stay clean. The price is that a concave jaw of the right radius pressed into a thread over more than a third of a turn is not reported.
58. **The base direction of the helix.** `zero` of a listed face is the model's X axis made perpendicular to the axis of the thread, and the model's Y axis where the thread lies within about 26° of X (question 54 is about the copies). Every stored `phase` is counted from it, so it is fixed with stage 1, as the clearance model and the datum of copies are. The alternatives: a direction of the body or of the sketch that made the face (it would turn with the part, but a face does not carry one, and two builds of one cylinder would disagree), or of the first vertex of the wall (it moves with the chord tolerance). *Recommendation: the model's axes, as designed*: a function of the axis alone, the same for a screw and its nut wherever they come from, and published with every thread. The price is the known limit that a part turned about the axis of its thread keeps the helix where it was.

## Reviews

### Round 1 (2026-11-26 and 27): an internal reviewer on Fable and `agy`, on commit `c341d0a`

Two independent reviews of the first version; `codex` was started and produced nothing. Every finding was checked against the code and the spike before it was acted on, and five things were measured for the fixes (L to P of spike.md). The second review describes, in about half of its findings, a design this is not (a catalog `ISO_METRIC_THREADS` with fine rows below M8, a tool `add_thread`, a datum read from a sketch, rings drawn at the root radius, a record keyed by the root of a modelled thread, an error `threadDoesNotFit`): none of those names is in the three files, and those findings are rejected with that as the evidence. What it found that holds is fixed.

**The internal review** (1 blocker, 7 majors, 9 minors and a nit):

| # | Finding | Disposition |
|---|---|---|
| 1 | The zone tested on vertices alone excuses a pin through a solid block, a plate or a bar through a pin (blocker) | **Fixed.** Confirmed on the adapter (O of spike.md). The rule is judged per connected piece: the vertices against the outer radius and the ends, no triangle nearer to the axis than the inner radius, and around the axis |
| 2 | The answer of a pair is kept by its two meshes; a cosmetic thread changes none; the depth is measured inside the same call; the frame of a posed pair | **Fixed.** `sharedBy` in two parts; the judgement kept with the records; the zones in the frame of the first body |
| 3 | A record follows its face into the target of a difference, where the face has the other sense | **Fixed.** A thread is listed on a body only where its face has the sense of the thread; put to the owner (52) |
| 4 | The clearance cannot take the values the summary recommends; the spike built no external tool with a clearance | **Fixed.** Confirmed (the flat of a pin gone at 0.054 · P). The clearance is a radial shift with the wall as made, measured (M); no flat left is an error; the summary corrected; put to the owner (51) |
| 5 | An end read as open can leave flat faces under the root's number | **Fixed.** Every flat end is `threadEnd`; the hidden faces have a number of their own; a wall that goes on is an end inside; the run-out is walked |
| 6 | The window of the face ignores the clearance and the allowance of `hardwareHole` | **Fixed.** The window moves with the clearance; `tapped` gives the thread the clearance of half the allowance; a tapped M3 with an allowance of 0.3 is in `calls.ts` |
| 7 | The datum does not turn with a copy, so a circle of screws does not sit in a circle of holes; the mate formula needs the hand and the opposite direction | **Fixed.** A copy carries the datum of its listed face; both formulas; put to the owner (54) |
| 8 | Partial cylinders pass; the tool of a bore takes a post; the tool of a pin cuts through a rib; records go stale | **Fixed** but for the last: a whole cylinder is required (53); the tool of a bore is a ring (N); what stands in the way leaves hidden faces and is `invalidThread` (N). The span of a record after a later cut or a split is a known limit, and the check of collisions no longer rests on it (rule 2) |
| 9 | The classification of an end has no order and depends on the chord; the reach is written for bores only | **Fixed.** Three tests in order, by where a vertex lies against the cylinder; the run-out of a pin written |
| 10 | The lift ignores the band of the kernel | **Fixed.** `max(0.05, 2 · tol, 2 · band)` |
| 11 | The robustness figures do not cover the default tolerance or a blind hole | **Fixed.** Measured (P of spike.md) |
| 12 | The stages contradict themselves; the fields stored in stage 1 get their geometry in stage 2 | **Fixed.** The verification list split by stage; "What stage 1 fixes for good" |
| 13 | Threads in a posed query | **Fixed.** `context.threads`; the query `body` adds them outside its memo |
| 14 | Details of `threaded` left open | **Fixed.** Which thread is named, the same axis, a refused pair, one body in several bores |
| 15 | The check of crossing tools differs between the files and tests the bores | **Fixed.** Modelled only, by the cylinders that hold the tools |
| 16 | The parts list counts a tapped hole as hardware and joins a threaded body with its copy | **Fixed** for the label (55); the row of a cosmetic thread is a known limit, put to the owner (56) |
| 17 | `copies`: a listed copy, a copy of two names, a thread before its pattern | **Fixed.** The rules of "A feature on faces"; the warning `noCopies` |
| 18 | `movedThread` lacks the prefix of an insertion; the reason a chamfer after a thread is refused; the snapshots | **Fixed.** |

**`agy`** (5 blockers, 7 majors, 2 minors and a nit by its count):

| # | Finding | Disposition |
|---|---|---|
| 1 | A crest flat of the tool at `D/2 − c` shaves the wall | **Fixed, as the internal 4.** The tool it describes is not the design's (the crest was never moved), but the wall is lost all the same, by the flanks |
| 2 | Left-hand tools and the ring of a bore are inside out; "the root runs on" names the wrong cylinder | **Rejected, measured** (L of spike.md): the signed volume of every tool is above zero and that of the exact shape, both hands, the solid, the groove and the ring; tests 5 and 6 of the spike had cut left-hand threads through the adapter, with the volume of the exact thread. The wording is corrected |
| 3 | The root's number on hidden faces and ends; `withFaces` enters every face; a tool over several bodies | **Fixed** for the first (internal 5); the sentence on the face table corrected. The last is rejected: a feature has one body |
| 4 | The rings of a cosmetic thread lie inside the solid and are hidden | **Rejected.** The design draws the helix on the wall, lifted to the air side; it has no ring at the root |
| 5 | The zone excuses a body pushed in from one side; a mismatched modelled thread; a bore with a chamfer collides | **Fixed.** Rule 3 (confirmed in O: 55° of the turn); two threads that disagree are a collision, whatever their mode; the zone runs out through a chamfer, so the ends are read in both modes. A stud in a plain hole of its tap-drill size stays excused (question 48) |
| 6 | The smallest gap reads `pairs` and `fits` of `interference` and would report a threaded pair as touching or apart | **Fixed.** Confirmed in `query/gap.ts`; the contact `threaded` |
| 7 | `copies` over a pattern inside an inserted document makes a face name the rule of form forbids | **Fixed.** `copies` follows the patterns of this document |
| 8 | The record of a modelled thread is keyed by its root; `hardwareHole` cannot find it; no callout on a flank | **Rejected.** A record is keyed by the wall in both modes, `hardwareHole` reads no record and no query answers a callout. Noted: a profile with no root flat has a root on no body |
| 9 | The reach of a pin's chamfered tip is inverted | **Fixed** (internal 9) |
| 10 | An end `inside` within the lift of the end of the wall | **Fixed.** Such an end is at the end of the wall |
| 11 | The datum is read from the sketch of the feature that made the face | **Rejected.** The design takes it from the model's X axis; the part about copies is the internal 7 |
| 12 | Places the code map misses | **Fixed in part.** `sketch-cut.ts` (the map of profile sources, the rename patch), `issue-text.ts`, the rounding in `check_interference` (the tool does not drop the list: it spreads the report). Rejected: `shapeOrigin` goes by the identity of a mesh and lists no feature types; a combine with a clearance gives the faces of the pocket new numbers, on which no thread belongs |
| 13 | Four fine sizes below M8 are not ISO; `calls.ts` has 16.933 for M20 | **Rejected.** The catalog has no fine row below M8 (its 26 fine rows start at M8x1) and neither file has that number; 16.933 is d3 of an external M20 thread, 17.294 the D1 of the catalog |
| 14 | Stage 1 with `modelled: true` is left open | **Rejected.** The validator of stage 1 refuses it; the sentence quoted is not in the design |
| 15 | The count of triangles does not say over what | **Fixed.** Per pitch of the span of the tool |

**Whether a second round is due.** Yes, by the rule of CLAUDE.md: more than six findings held, more than three of them serious, and the fix is large (the clearance model, the tool of a bore, the rule of the zone, the datum of copies and the reading of the ends all changed). The second round should look mainly at those five.

### Round 2 (2026-11-27): the internal reviewer on Fable, `codex` and `agy`, on commit `cd75914`

Three independent reviews of the first revision. Every finding was checked against the code, and what rests on geometry was measured (Q to S of spike.md, P again, two rows of M): the end reading on bodies the engine built, the zone in both orders of a pair with flush faces, the phase of a mate. All three found the reading of a flat cap; two the rule of the zone. `agy` quoted the design this time, and its findings hold but for one nit.

**The internal review** (1 blocker, 1 major, 10 minors and nits):

| # | Finding | Disposition |
|---|---|---|
| 1 | The three rules refuse a seated mate and depend on the order of the two IDs: a flush face leaves a sheet in the shared mesh (blocker) | **Fixed, measured** (Q). The rule makes no boolean of a shared mesh and reads no vertex of it: the body with the thread is cut by the ring of the zone, what the other body shares with the part in the zone is read by its volume and its centre of volume, the rest is judged as every pair. The cut of the shared mesh the review proposed was tried first and came out wrong or refused where the mesh holds a sheet. 18 pairs, each in both orders |
| 2 | The end reading takes a flat cap for a wall that goes on, or a flat bottom for an open end | **Fixed, measured** (R, on bodies of the engine; the ends `jarChecks` expects). The wall goes on only where the face across the rim is a coaxial cylinder of the same radius; a third vertex on the cylinder counts as inside it |
| 3 | The formula for the opposite direction holds only for a first phase of zero | **Fixed, measured** (S): `−φ₁ − turn · 2π · L / lead`; `calls.ts` has a first phase that is not zero |
| 4 | The figures for bores were measured with the solid tool | **Fixed.** The spike cuts bores with the ring; P measured again (the same two refusals of 300) |
| 5 | The contract lacks what the check needs: the records in a query, the relative transform, the identity a memo needs, the memory of a kept mesh | **Fixed, otherwise than proposed.** A query needs no record of the state and no relative transform: a published thread keeps its identity (`threadsAsModelled`), the cut is made in the frame of its body and kept by the mesh and that object, each intersection is framed as every pair, and nothing new is kept for a pair without a thread. `query/spec.ts` is in the code map |
| 6 | Two threads that abut on one axis refuse a mate through both | **Fixed.** Zones with the same radii whose spans touch or overlap are one zone |
| 7 | A pair cleared as `threaded` falls through the smallest gap; an entry without an excused piece | **Fixed.** There is no kind `threaded` of `cleared`: the rest is failed or cleared as every refused pair, the pair has its entry in `threaded` only when a zone was taken, and the gap reads that entry |
| 8 | The flank that faces down in a bore is misnamed | **Fixed.** `end` in both |
| 9 | The block of scenario 18 does not reach the axis of the bolt | **Fixed.** A block that holds the axis, and the corner as a case of its own |
| 10 | `copies` and the copy tag of a combine with a clearance | **Fixed.** A tag is followed when the state has its transform, which only a pattern of this document writes |
| 11 | The rim of a wall that is no circle; a hollow mouth has material in the band beyond its extreme point | **Fixed** in the rule (the rim is the loop around the axis that holds the extreme point; the run-out is read on the faces at the rim, within the band). Not measured: in "To verify" |
| 12 | One half of a split nut at the threshold; a half that is mirrored and joined | **Put to the owner** (57), the threshold moved off the half to a third, measured (Q). The mirrored half is a known limit with its remedy |
| 13 | Nits: the source of a sentence on the parts list; "free of each other" rests on one size; the band of a tool in stage 1; an end `inside` at a loop of edges | **Fixed.** The last is in "To verify" |

**`codex`** (6 majors, 4 minors):

| # | Finding | Disposition |
|---|---|---|
| 1 | The end test misclassifies circular caps | **Fixed, measured** (internal 2) |
| 2 | The hidden faces do not see what the tool swallows whole (a boss 0.03 high within a groove) | **Accepted as a known limit, the claim corrected.** What stands less than two lifts proud within the footprint of a groove is cut with the groove, as a tap would cut it; a check for it is one more boolean per feature. The hidden faces see what crosses them |
| 3 | A connected piece cannot part a thread overlap from a fit joined to it (a countersunk head) | **Fixed, measured** (Q: the pair is `threaded` and a fit, 0.0068 deep) |
| 4 | Two threads agree whatever their flank angle and depth | **Fixed.** `threadsAgree` compares the profile too, and asks for one bore and one pin |
| 5 | A span that went stale excuses a collision with other material | **Fixed.** The zone is the span cut to the stretch the body still has of the wall (`walls`). A wall refilled in its middle is a known limit |
| 6 | Carrying `zero` alone does not keep the helix of a copy whose wall starts at another height | **Fixed.** The whole datum is carried; `zero` is turned for the shift of the origin |
| 7 | The phase of the opposite direction | **Fixed, measured** (internal 3) |
| 8 | "Free when the clearances add up" is false for a wall left at the nominal size | **Fixed, measured** (M: a pin at the nominal diameter with a clearance of 0.1 in a plain nut is a fit). The statement names every radial gap |
| 9 | The helper of the inner radius is wrong for a triangle seen edge-on | **Fixed by removal**: the rule it served is gone |
| 10 | The block of scenario 18 | **Fixed** (internal 9) |

**`agy`** (1 blocker, 5 majors, 4 minors and nits by its count):

| # | Finding | Disposition |
|---|---|---|
| 1 | The end reading on flat caps (blocker) | **Fixed, measured** (internal 2), by the two cases it proposed and the surface of the neighbour |
| 2 | The walk of the run-out follows a step along its whole length and can climb a boss | **Fixed.** Only the faces at the rim are walked. A relief between the wall and the root is a known limit |
| 3 | The frame and the type of what the check takes; the memo misses | **Fixed** (internal 5) |
| 4 | The phase of the opposite direction; the builder of the spike has its crest half a pitch from the datum and names the flanks by the profile | **Fixed.** Both differences are stated for `buildThreadTool` |
| 5 | A fit that touches the zone; the three files disagree on a pair with an excused piece and a collision | **Fixed** (codex 3). A collision left puts the pair in `pairs` alone, in all three files |
| 6 | A ring with no hole in a narrow bore; one number for the hidden faces of all walls; a tool with no span left at a shoulder; the band before a tool exists | **Fixed.** Two checks of the mesh, a number per wall, the band of the body alone |
| 7 | The copy tag of a combine | **Fixed** (internal 10), by the test it proposed |
| 8 | `threadsAgree` on two bores and on threads that do not overlap; a short thread of several starts fails the third rule piece by piece | **Fixed** for the first two. The third is a known limit: the pieces stay judged one by one, since their union would excuse a fork that reaches in from two sides |
| 9 | The gap for a cleared pair; the rounding helper of `check_interference` | **Fixed** |
| 10 | No closed form for `threadTriangles` | **Rejected.** The count is made by the loops of the builder without building; a formula in a draft would be a guess the builder then has to match |

**What is still open after this round**, recorded as known limits or as owed verification: the cut of the zone was measured on simple bodies at the origin (not on bodies of many faces, in poses, or where the kernel refuses a cut); the ends were read on nine walls with circular rims (not on a rim that is no circle, a partly open rim or a filleted foot); what a tool swallows inside the footprint of a groove; a relief narrower than the major diameter beyond an open end; a wall refilled in its middle; a short thread of several starts against a plain rod; the refusals of the kernel far from the origin (2 of 300 at the default tolerance) and whether a second build clears them; the browser.

**Whether a third round is due.** Yes, as the last one and on the diff alone (CLAUDE.md): the round held more than six findings, more than three of them serious, and the fix replaced the rule of the zone and the reading of the ends. It should read those two.

### Round 3 (2026-11-27): the internal reviewer on Fable on the diff `cd75914..f0cfe50`, and a second opinion on Opus 5.5

The last round CLAUDE.md allows, on the diff of the second fix. `codex` and `agy` did not run (both had reached their usage limits); a reviewer on Opus 5.5 gave a second opinion after the fix (below). Its verdict: ready for stage 1 once its findings 1 to 3 are corrected in the text. It measured with probes of its own on the adapter and the engine: the cut of the zone in random poses, 400 random flush cases, 13 further walls and 360 random blends and cuts for the ends, the phase table and the rule of `δ` derived again. What it found is fixed in the text or recorded as a known limit; no rule was added beyond what it asked for.

| # | Finding | Disposition |
|---|---|---|
| 1 | `threadsAgree` takes two coaxial threads of different diameters on one part for one mate (a bushing with an external M10 and an internal M6) | **Fixed.** About the same axis only when the zones also overlap in their radii; else apart. The bushing is in the tests owed. `calls.ts` holds: the bolt and the plate overlap in their radii |
| 2 | The ring grown by the chord tolerance at a shoulder makes the kernel refuse the cut of a body in a pose (up to 28 of 30) | **Fixed.** The lift at every end, the chord tolerance at the root alone; the spike's ring follows and Q is measured again (19 pairs, a rod 0.02 too long still a collision). The reviewer's table is in "To verify" 1; the refusals of a posed pair far from the origin are a known limit with the candidate |
| 3 | "With a volume" is not defined, and a zone with no piece would be taken | **Fixed.** A piece is judged above `THREAD_PIECE_VOLUME` (the value of `INTERFERENCE_THRESHOLD`, not the argument of the query), and a zone is taken only when there is one: what the spike did |
| 4 | The walk of the run-out lacks the stop the prototype has; a cross bore still reads long | **Fixed** for the stop (only through triangles with a part in the band beyond the end). The cross bore is a known limit |
| 5 | A rim where the wall goes on over a part and is open over the rest reads `inside` | **Fixed.** `inside` only along the whole rim; the mixed rim is open, and is in "To verify" 2 and 4 and in the known limits |
| 6 | "About the same axis" by the direction a thread runs in makes the bolt and the plate of `calls.ts` apart | **Fixed.** Parallel or opposite, in both files; the scenario holds as written |
| 7 | A posed pair in which both bodies have a taken zone needs the transform between them | **Fixed.** `pairInFrame` hands out `relative`; `query/pose.ts` is in the code map; a posed pair of two cosmetic threads is in the tests owed |
| 8 | "The vertices of every face lie on its exact surface" is false after a boolean; a tangent blend moves the end of the wall | **Fixed** in the wording (such vertices lie on chords and count as inside). A thread that starts at a filleted end is a known limit |
| 9 | Nits: a joined zone is kept by one thread; the jar's phase is zero | **Fixed.** Kept by all the threads of the zone; the sentence on `calls.ts` corrected |

**A second opinion on round 3** (a reviewer on Opus 5.5, on the diff `cd75914..339b9e9`; 2 majors, 4 minors, 2 nits, with a probe of its own on the adapter). The dispositions of the first reviewer of the round hold. Its verdict: ready once its findings 1 and 2 are corrected, which they are here.

| # | Finding | Disposition |
|---|---|---|
| 1 | Two threaded bodies whose axes are off by more than the chord tolerance are excused: each zone is taken alone and only the two rests are judged | **Fixed, measured** (T of spike.md: a cosmetic M10 stud 0.1, 0.3 and 0.8 off the axis of its bore; both rests share nothing while the rest of the plate collides with the whole stud 0.08 to 0.78 deep). `threadsAgree` answers apart only when the two rings do not meet; rings that meet off one line are a mismatch with the reason, no zone is taken and the pair is judged whole. Two tapped holes side by side stay excused, each by its own hole (measured). `calls.ts` holds: the other bores of the plate are apart from the thread of the bolt |
| 2 | The walk of the run-out at a rim that is partly open follows the face where the wall goes on | **Fixed.** Those faces are not walked, as in the prototype; the mixed rim says what it runs out by |
| 3 | The prototype has the old rule for `inside` | **Fixed.** The prototype answers `inside` only when the wall goes on along the whole rim |
| 4 | Where the run-out is counted from; when a wall "still has" an end | **Fixed.** From the end of the wall, which the tool and the zone take for the end of a thread within the lift of it; an end is still had when the stretch reaches within the lift of it |
| 5 | `Threaded.volume` counts twice when both bodies have a taken zone about one line | **Fixed.** Defined: of two agreeing threads about one line the larger excused volume counts; zones about other lines add |
| 6 | A zone on the second body of a posed pair | **Fixed.** That zone is judged with its body first, the other moved by the inverse transform |
| 7 | The comments on `ThreadEnd` disagree with `threadEndAt` | **Fixed** |
| 8 | Wording: the growth at the root; "every straight wall"; the tolerances of "same axis, same radius" and of the joining; two different threads on one wall are joined | **Fixed.** The chord tolerance and the precision of the coordinates; the bound of a straight wall qualified; the tolerances named; zones are joined only when their threads are the same |

After this round nothing is open but what "Known limits" and "To verify before the implementation" list, and the questions for the owner.

## Rows for the indexes

The design was merged with `master` on 2026-11-27 as a design without an implementation. The indexes say what is there today; what describes code is left for stage 1.

Written at the merge:

- `docs/decisions.md`: the row D76 after `master`'s D75 (the state of today: reviewed in three rounds, the questions answered by the owner, not implemented), and a sentence under the table.
- `docs/d36/README.md`: the row 7a, the state line, and the numbers: D76 and scenario 18 are taken by 7a, the next free ones are D77 and scenario 19.
- `docs/backlog.md`, "Helix and modelled threads": a pointer to this design, which stands in place of the generator of a helical profile for threads (a spring or a coil stays that generator's; the twist on an extrusion and helical gears stay there with the layered build of the spike), and the candidates this design defers: the option `mirroredHand`, a record for the thread a difference leaves, a thread on a part of a cylinder, a second build after a refusal of the kernel, and the owner's two of 2026-11-27, a flag that threads every bore of a listed hole and a catalog of pipe threads G.
- `README.md`: the decisions are D1 to D76. (The same words in `CLAUDE.md` are the owner's file to change.)

Left for stage 1, on purpose: nothing of these exists before the code does.

- `docs/requirements.md`: scenario 18, "Threads: a plate of tapped holes, a stud in a collar, a jar and its lid" (D36, package 7a, D76), with its test file, when its parts a and b are tested (stage 1); c and d with stage 2. Until then the number is only reserved in `docs/d36/README.md`.
- `docs/architecture.md`: a row for `architecture/thread.md`, and that file; `docs/ui.md`: a row for `ui/thread.md`, and that file.
- The rows of the other files of `docs/architecture/` and `docs/ui/` that the code map of this design touches (the parts list, the export, the check of collisions, the pattern).

## As implemented

Stage 1, on the branch `d36/7a`, 2026-11-27. The engine, the app and MCP as "Where the code lives" and "The app and MCP" say for stage 1; the docs of the area are [architecture/thread.md](../../architecture/thread.md) and [ui/thread.md](../../ui/thread.md). No schema step. What differs from the text above and from `contract.ts`, and why:

- **The signatures of the parts of the recompute.** `threadProfile` returns the fields in `refs` beside the detail (the error of the feature names them). `threadEndAt(solid, faceInfos, wall, end, band)` takes the radius of the band from its caller (`D/2 + c` for a bore, `D/2 − h − c` for a pin) instead of the profile and the clearance. `threadZone(thread, body, lift)` takes the lift of the body (the stretch of a body "still has" an end of the wall when it reaches within the lift of it) and is undefined for a body without a part of the span; `joinedZones(zones, lift)` joins spans to the lift. `threadsAgree(a, b, chordTolerance, meet)` compares two zones in one frame (the zone of the second body moved by `relative`), not two published threads, and asks `meet()` (the boxes of the two rings, then one boolean of them) only off one line. There is no `zoneParts`: the part of a body in a zone is one intersection kept by the mesh and the threads of the zone (`zoneTake` of `query/interference.ts`), and the rest is the body without the rings of all its taken zones, one difference per ring (`restOf`). `threadTriangles` and `buildThreadTool` are stage 2.
- **The records.** `ThreadRecord` carries `stated`, the hand of its feature, so that a pattern of a body can count the hands it turned (`mirroredThread`); `threadResults` takes the parts of the state it reads. The published threads are kept by their record and by what the final state makes of it (the bodies, their stretches), so an unchanged thread is the same object across recomputes.
- **The numbers of the rings.** The kernel takes face numbers below 2³¹: a ring carries `0x7ffffffe`, and further rings cut out of one body count down from it (a difference takes operands whose face numbers differ). Found by the U-bolt of the tests: with one number for both rings the second difference was refused, the rest was the whole body, and the pair came out as a collision of 137.9 mm³ beside its `threaded` entry.
- **A collision left is in `pairs` alone.** The rule says so (step 3) and so does the comment of `Threaded`; the first build put such a pair in `threaded` as well, which `calls.ts` (`boltChecks`) caught. A pair the kernel refused stays in `threaded` beside `failed` or `cleared`.
- **The description of a body** gives units to the fields of a thread (`diameter`, `pitch`, `depth`, `clearance`, `from`, `to`: mm; `flankAngle`: radians). The units are keyed by the name of a field throughout the answer, so the app now also prints "mm" behind `from`/`to`/`start`/`end` where the description of an edge has them: the snapshots of `packages/app/test/app.test.ts` changed there, besides the new button *Thread*, the new titles of the queries `interference` and `hardwareHole` and the option *tapped* of the hole form.
- **`hardwareHole`**: `HardwareHole.label` is optional (absent for `tapped`); two readers of the answer that took the label as always there were adjusted (`packages/scenarios/test/scenario13.test.ts`, `docs/d36/3e-parts-list/calls.ts`). The hole form drops the label of its draft for a tapped hole and says in the status line to add the thread.
- **The contracts of other packages**: `EvaluationAfter` of `docs/d36/00-prep/contract.ts` and `StateD76` of `contract.ts` leave out the members this package added to the real types, so that the drafts still type-check against them.
- **Face roles**: the texts of `ROLES` for the three roles of stage 2 are not written (no such face exists in stage 1).
- **The view**: `threadLines` of `draw.ts` draws one line per start along the datum, a hair (1 %) off the wall into the air, 48 points a turn and at most about 4000 points a thread (eight a turn at the least), from `from` to `to`; the picture for the AI (`picture.ts`) draws the same lines. The hover marks the thread feature of a face that has a thread (`pickRows`).

### To verify before the implementation: the results of stage 1

1. **The cut of the zone on real bodies.** A blind bore tapped M6 in a block 20 × 20 × 10 with a bolt seated on its bottom by a head on the top face (two flush contacts), both bodies turned about X and about Y by random angles and moved 5, 150, 300 and 500 mm away by patterns of the body (the threads carried by them; 30 poses at each distance, 120 in all): every pair was `threaded` alone, none refused, failed or cleared. A pair costs 0.26 to 0.37 s against 0.09 to 0.11 s for the same pair without the thread; of that, 25 to 60 ms are the booleans of the take and 0.15 to 0.43 s the measure of what the rest shares (the flush faces make many slivers for `depthOf`). Two random poses at 400 × 300 mm are pinned in `packages/scenarios/test/thread-collisions.test.ts`. Not done: the pieces read from `intersectionAsComputed` when a boolean of the take is refused (a refused take takes nothing, and the pair is judged whole), and a large body of many faces.
2. **The ends** (`packages/scenarios/test/thread.test.ts`): a plain mouth (open, 0); countersinks of 90° and 60° (open, the run-out 0.506 and 0.876 against 0.5 / tan of the half angle, 0.5 and 0.866: the facets of the cone, within the chord tolerance); a counterbore wider than the major diameter (open, 0); a flat blind bottom (shoulder); a flat free end (open, 0); a chamfered tip of 1 mm on a pin M8 (open, 0.667 against the depth 0.677: the polygon of the pin); a pin standing on a foot and one with a filleted foot (shoulder); a pin of two extrusions (inside at the joint); a rim partly open where the wall goes on (a notch at the joint: open); a block under half of a mouth (shoulder); a hole across a round bar (open, run-out below 0.02: nothing beyond the extreme points of the rim); a hole into a leaning face of slope 1/2 (open, 0.25 = 0.5 · tan β); the same ends on a copy of the body turned about two axes and moved 2000 mm away (the same kinds, the run-outs within 0.001). Not done: a drill point (the hole feature makes none), a cross bore at the end, thin triangles along a rim and a rim cut by an earlier feature beyond the notch.
3. **The sense of a face after a combine.** A union moves the record of a tool to the target; a difference keeps the threads of the target, those of a kept tool stay on it, and the face of a used tool, now a bore of the target, records nothing (the other side); an intersection keeps a pin a pin and a bore a bore; a split puts a record on both halves with the stretch of each; a pocket that removes the wall drops the record. A cylinder a combine left both ways is refused at the thread.

The browser was not used: the form, the helix and the threaded pairs are covered by the driven test of the app and the tests over answers written by hand, not checked by eye.

### Tests

- `packages/engine/test/thread.test.ts`: the 55 rows pinned and what holds of them (`catalogChecks` of `calls.ts` as assertions), the profile at 60° and 90°, its refusals, the window and the flat (a pin at the nominal diameter at and beyond the largest clearance, a tapped M3 with an allowance of 0.3), the validator (every field, the refusals, `modelled: true` in a command, a patch and a document), the base direction along the axes and at 25° and 27° from X, a record moved by a mirror and by an insertion, the zone and its join, `goesAround` on pieces of rings, `threadsAgree` on every field, the use `tapped`.
- `packages/scenarios/test/thread.test.ts`: the walls (a bore, a pin, a face in two pieces, a bore crossed by a hole, a slit, a rounded corner, a face both ways), the window against real bodies, the span and an earlier thread, the ends (above), `copies` (a row, a circle, a mirror of a hole, a copy through a step of the body, a listed copy, `noCopies`, a pattern inside an insertion not followed), the datum (the phase, an axis near X, offset and length trim one helix, a screw in a nut in both hands with a first phase that is not zero, a second nut further along), a pattern of a body and its mirrored copy (`mirroredThread`, none for a second mirror, a mirror of features or a body without a thread), an insertion, the records through a pocket, a union, a split, a removed wall, a difference with and without kept tools and an intersection, the parts list (`unlabelled`), the rename of a sketch cut (a takeover of a projected circle).
- `packages/scenarios/test/thread-collisions.test.ts`: a plain rod through a tapped hole (and without the thread a collision), a seated head, a head in a counterbore (a fit beside the thread), a rod on a blind bottom and one 0.5 too long, a rod too thick, a rod that misses, a key pushed in from one side, a pin cut short and one made longer, a U-bolt, a half shell and a jaw of 100°, a thread added to an unchanged mesh, two agreeing threads, disagreeing in pitch, hand, starts, flanks, 0.3 off the axis and leaning (and a plain rod off the axis), two stretches of one line, a bushing threaded inside and out, two tapped holes side by side, posed pairs (a prismatic and a revolute joint, the posed datum), a set screw in the smallest gap, far poses; every pair of two bodies in both orders of the IDs.
- `packages/scenarios/test/scenario18.test.ts`: a, b and e of `calls.ts` (the plate, four in a row, the printed tap, the bolt and its checks, the blocks, the seated heads, the flange, the left hand on the mirror, before its pattern, the refusals). Not the point between the stages (`betweenTheStages`), nor c and d.
- MCP: `get_model`, `get_body`, `check_interference`, `describe_api` and `hardwareHole` with `tapped` (`packages/mcp/test/tools.test.ts`, `queries.test.ts`). The app: the form in `app.test.ts` (snapshot `thread.txt`), `draw.test.ts`, `hover.test.ts`, `query-interference.test.ts`.

### Not done in stage 1

- The pieces of a refused take from `intersectionAsComputed` ("To verify" 1).
- A refused pair among the threaded pairs and a pair cleared after a refusal with a thread have no test of their own (no model of the tests gets the kernel to refuse one).
- Everything of the point between the stages and of stage 2.


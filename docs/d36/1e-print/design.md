# 1e Print queries

**Decision D42. State: designed, not implemented; second version, after one round of reviews.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario, the entry and the view as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

Validation scenario 11 (the queries asked about the robot joint of scenario 9), this package's part: the printability of the housing in two orientations.

The engine side takes the precision of the coordinates from [1b](../1b-measure/design.md); the app side builds on the generic form of a query designed there.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Print queries": one query; the input is bodies, a print orientation (a direction, or a face name: "this face lies on the bed", the form an AI will use), a bed size and an overhang angle (45° from the vertical by default); the output per body is the bounds in the print frame and whether they fit the bed, the height, the contact area with the bed and the overhang area; overhangs are reported per named face with their area, which is what makes the answer usable; several orientations in one call; not in the cheap variant: bridges (a lower limit on the area keeps the noise down), wall thickness, the smallest printable detail, an estimate of the support volume.

- **Everything it needs is in a body**: the triangles with the number of the face each belongs to, and the names of the faces. An overhang is a test of the normal of a triangle against the direction that is up; a contact is a test of its height.
- **A face as an orientation.** A surface has no side (the shared vocabulary of the preparatory step); the frame of a planar face has its normal pointing out of the body (`faceFrame` in `solid.ts`, reached by a query through `context.frame`). So "this face lies on the bed" means: up is the opposite of that normal.
- **The arguments can be written.** `calls.ts` of the preparatory step already writes a list of orientations that are each a direction or a face and may add a turn (`list`, `fields`, `oneOf`); this package takes that description over.
- **Round faces are polygons.** A cylinder laid on its side rests on one facet of its polygon; the prototype counted 96 mm² of "contact" for the housing on its side before contact was limited to planar faces.
- **Measured on the model of scenario 9** by a prototype of the pass (kept outside the repository; the internal reviewer reran it), with the rules below: the housing (5310 triangles) takes 3 to 6 ms per orientation. On its seating face: contact 2801.28 mm², overhang 3330.69 mm² on one face, the ceiling of the motor recess, 28 mm up. On its front face: contact 6028.84 mm², overhang 103.13 mm² on six faces, the floors of the nut pockets, 3 mm up. On its side: no contact, overhang 8612.84 mm² on 21 faces.
- **The same with the housing turned out of the axes** (by 30°, 17° and 45° about X, and the direction turned with it), run after the review: the four numbers come out the same to the printed digits when a triangle of a planar face is judged by the normal of its face. Judged by its own normal, as the first version had it, up to 0.42 mm² of the front face moved from the contact to the overhang: long thin triangles of a flat face have a normal that float32 coordinates spoil by more than `ANGLE_TOLERANCE`. The corners of the face on the bed were at most 6e-6 mm above the lowest point, a tenth of the precision of the coordinates.

## The cheap variant

One query, `print`: bodies, a list of orientations, optionally a bed, an overhang angle and two limits of the answer.

**An orientation says what is up**, one of two ways (`oneOf`):

- `up`: a direction in the coordinates of the model;
- `onBed`: a planar face. Up is the opposite of the normal of its frame, which points out of the body. A face that is not planar is `failed` with the path of that orientation (`['orientations', 1, 'by', 'onBed']`).

A face gives a direction, for every body of the call. The bed is always put at the lowest point of each body, so for the body the face belongs to, the answer says whether that face lies on the bed (`onBed`). When something of the body reaches below the face, the contact is elsewhere: the carrier "on" the face of its disc that the pins stand on rests on the ends of the pins. This is reported, not refused: the orientation is still a valid question. `onBed` is taken from the pass, not read off the list of contact faces, which `maxFaces` may cut.

`turn` turns the body about the vertical. It matters only for the size along x and y.

**Per body and orientation** the answer has:

- `size`: the box in the print frame (x, y, the height). The frame is fixed by a rule, so the same question gives the same box: for a direction, x is the X axis of the model laid into the bed (the Y axis when up is within 45° of X); for a face, the x of its frame.
- `fits`, when a bed is given: the height within the bed's, and the footprint within its x and y either way round, because a quarter turn costs nothing. A diagonal placement is tried with `turn`.
- `contact`: the area on the bed, per face. A triangle is contact when its face is planar and all its corners are at the lowest point of the body within the precision of the coordinates (`coordinatePrecision` of 1b). Round faces never count: a line of contact has no area, and a facet of the polygon is not one.
- `overhang`: the area that looks down and leans from the vertical by more than the overhang angle, and is not contact; per named face, with the height above the bed where the overhang of that face starts (`from`), the largest first. The total area and the number of faces are of all of them.
- **Where a triangle looks.** A triangle of a planar face looks where its face looks: the normal of the face out of the body, which the engine knows exactly (`context.frame`). Only a triangle of a face that is not planar is judged by its own normal.

**The threshold on the overhang area** is an argument, `minArea`, 1 mm² by default: the overhang of a face below it is in the totals and not in the list, and `small` says how many such faces there are. It is what the backlog asks for against the noise of small horizontal holes. The nut pockets of the housing (17.19 mm² each) are above it and are listed, which is right: they are what an AI should see.

**The size of the answer.** `maxFaces` (20 by default) caps each of the two lists of a body in an orientation: the faces on the bed and the overhanging faces. Each list comes with the count of all its faces, so a reader sees which one was cut, and `truncated` says how many faces were listed of how many, over the whole answer. The answer is therefore at most twice `maxFaces` faces and a fixed size for every body in every orientation, with at most twelve orientations and the bodies the caller names; `returns` says so.

**A face at exactly the overhang angle is not an overhang.** The limit is taken with `ANGLE_TOLERANCE`, so a chamfer or a roof at 45° drawn on purpose, which the backlog proposes instead of a horizontal overhang, does not come back as one because of the last digit.

**Several orientations in one call** (one to twelve) and several bodies: the answer is a table of bodies by orientations, so an AI can ask about every part along both directions of an axis and pick per part. The pass is a few milliseconds per body and orientation.

Everything about a body is read from the context (`bodies`, `surface`, `frame`), so the query answers at `at`, over `after` and in a pose.

**Deferred** (the backlog's list, and what this design adds to it).

- Bridges: an overhang held at both ends is reported as an overhang.
- Wall thickness, the smallest printable detail, an estimate of the support volume.
- Whether a part stands (its centre of mass over its contact). The mass query gives the centre; nobody combines the two yet.
- The smallest box over all turns about the vertical. `turn` tries one.
- An orientation that travels with the model: a body property (step 3), not an argument.
- Several bodies on one bed.

## Where it lives

```
packages/engine/src/
  queries/print.ts     the entry: the frames of the orientations, the pass (printPass), the lists and limits
packages/app/src/queries/print.ts   the view
```

## What it adds

| To | What |
|---|---|
| The document | nothing |
| Commands | none |
| `Queries` | `print` |
| Issue codes | none |
| MCP | nothing by hand: the tool `query` reaches it |

## What the app shows

The generic form of 1b with a view of its own (`QUERY_VIEWS.print`; `calls.ts` writes it).

- **The form**: the bodies as rows; the orientations as rows, each a choice between a direction (three numbers) and a face taken from a selection in the view, with the turn in degrees; the bed as three numbers; the angle in degrees.
- **The answer**: a row per body and orientation with what decides (whether it fits, whether a face named to lie on the bed does, the height, the area on the bed, the overhang and on how many faces). A picked row paints the overhanging faces of that orientation in one colour and its contact faces in another, on the model as it stands, and lists the overhanging faces under it with their areas and heights. A line says when a list was cut. The view does not turn the model onto a bed: the faces are the answer, and they are where the user would change the design.
- The nested arguments of an orientation (`by`, `up`, `onBed`, `turn`) are labelled by their keys: the description cannot give them titles (a need recorded in 1b).

## Needs from the preparatory step

None of its own. It uses the stand-ins of 1b: the units of a result (the angle, shown in degrees), and `failed` with the path of the argument where the mistake is the caller's and the description cannot say it (a bed with a length that is not above zero, a direction without a length: a `vector` is three numbers with no range).

## Rejected

- **One body per call.** A face on the bed belongs to one body, which suggests it. But "every part along both directions of the axis" is the first question about an assembly, and it would be a call per part; a face gives a direction for all of them and the answer says for which body it is the contact.
- **An error when the named face is not the lowest thing of its body.** It is a fact about the orientation, and often the interesting one (a boss below the face). `onBed` says it.
- **Reading "is the face on the bed" off the list of contact faces** (the first version). The list is cut by `maxFaces`; a body resting on twenty-one faces would hide the answer.
- **Contact as "everything at the lowest height".** It counts the facets of round faces; see the 96 mm² of a cylinder on its side.
- **Every triangle judged by its own normal** (the first version). Right on a body aligned with the axes, and off by a fraction of a square millimetre on a turned one; the face is known exactly, so there is no reason to ask the triangle.
- **A fixed overhang threshold, no argument.** Printers and materials differ; the backlog names 45° as a default, not as a constant.
- **Overhangs as one number per body.** The backlog's own point: without the face the number does not say what to change.
- **The smallest enclosing rectangle of the footprint instead of a fixed frame and `turn`.** It needs the convex hull of the projected vertices and rotating calipers, for a question a quarter-turn check and one argument answer in almost every case.
- **Turning the body in the view onto a bed.** A second pose of the model in the scene, for the sake of a picture of what the numbers already say.

## Open

- The default of `minArea`. A horizontal hole of diameter d through a wall of thickness t overhangs with about a quarter of its wall, πdt/4 at 45°: 1 mm² hides a hole of 1 mm through a wall of 1.2 mm and nothing larger. To settle on real parts.
- Whether `contact` should also warn about a small contact under a tall part. It is a judgement (how small, how tall) that an AI can make from the two numbers.

## Reviews

### Round 1 (2026-11-15): first version

Two independent reviewers, read-only, at commit `b2fdf2d`: `codex` (gpt-6-astra, effort high) and an internal subagent; `agy` did not take part (out of quota). Who they were, what they covered and the findings on the track as a whole are recorded in [1b](../1b-measure/design.md). The internal reviewer reran the prototype and got the contact and overhang numbers, the 96 mm² of facet contact, the sizes and the numbers of the carrier and the sun; both found the print frame right-handed and up the opposite of the normal of the face. The findings on this package, each checked against the code:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The contact faces are cut by `maxFaces`, but only overhangs are counted in `truncated`; a part on twenty-one faces lists twenty and says nothing. And the promise that the list shows whether the named face is the contact fails with it | both (codex: major) | Yes | Contact has its own count and is counted in `truncated`; `onBed` answers the question by itself, from the pass |
| The whole answer is not bounded: bodies by orientations by two lists; one sum does not say which list was cut | internal | Yes for the statement. The bound exists (twelve orientations, two lists of `maxFaces`, the bodies named) but was not stated | The bound is stated in the contract and in `returns`; each list has its count (`small` for the overhangs below `minArea`) |
| "The precision of the coordinates" is 1e-5 here and 1e-6 in 1a and 1c | internal | Yes | `coordinatePrecision` of 1b; the prototype was rerun with it (the same numbers) |
| The nested arguments of an orientation cannot have titles | internal | Yes | A need recorded in 1b; noted under "What the app shows" |

Found while fixing, by no reviewer: rerunning the prototype with the smaller precision on a turned housing showed that a triangle of a flat face judged by its own normal can miss the contact (0.42 mm² of 6028.84). The rule is now that a triangle of a planar face looks where its face looks; see "Measured" and "Rejected".

Nothing was left without action.

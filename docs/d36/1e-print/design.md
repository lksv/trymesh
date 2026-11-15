# 1e Print queries

**Decision D42. State: the engine side (the query `print`) is implemented on the branch `d36/1e`; the view of the app follows. See "As implemented" at the end, which says where the code differs from the text below. The design is in its fourth version, after three rounds of reviews.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario, the entry and the view as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

Validation scenario 11 (the queries asked about the robot joint of scenario 9), this package's part: the printability of the housing in two orientations.

The engine side takes the precision of the coordinates from [1b](../1b-measure/design.md); the app side builds on the generic form of a query designed there.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Print queries": one query; the input is bodies, a print orientation (a direction, or a face name: "this face lies on the bed", the form an AI will use), a bed size and an overhang angle (45° from the vertical by default); the output per body is the bounds in the print frame and whether they fit the bed, the height, the contact area with the bed and the overhang area; overhangs are reported per named face with their area, which is what makes the answer usable; several orientations in one call; not in the cheap variant: bridges (a lower limit on the area keeps the noise down), wall thickness, the smallest printable detail, an estimate of the support volume.

- **Everything it needs is in a body**: the triangles with the number of the face each belongs to, and the names of the faces. An overhang is a test of a direction (where a face, or a triangle of a round face, looks) against the direction that is up; a contact is that test and a test of the height.
- **A face as an orientation.** A surface has no side (the shared vocabulary of the preparatory step); the frame of a planar face has its normal pointing out of the body (`faceFrame` in `solid.ts`, reached by a query through `context.frame`). So "this face lies on the bed" means: up is the opposite of that normal.
- **The arguments can be written.** `calls.ts` of the preparatory step already writes a list of orientations that are each a direction or a face and may add a turn (`list`, `fields`, `oneOf`); this package takes the description of the orientations over. (The bed is written there as a `vector`; here it is three named lengths with a range.)
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
- `fits`, when a bed is given: the height within the bed's, and the footprint within its x and y either way round, because a quarter turn costs nothing. A diagonal placement is tried with `turn`. The bed is three named lengths above zero (`x`, `y`, `height`), so the range is in the description and a bed without a size is refused before the query runs.
- `contact`: the area on the bed, per face. A planar face is contact as a whole when it looks straight down (within `ANGLE_TOLERANCE`) and its lowest corner is at the lowest point of the body within the precision of the coordinates (`coordinatePrecision` of 1b). Round faces never count: a line of contact has no area, and a facet of the polygon is not one.
  - Both tests are needed: the height alone would take the top and the sides of a body thinner than the precision for contact.
  - The face is judged as a whole, by its lowest corner. Asking every corner of every triangle to be at the lowest point would ask a face 100 mm across to be level within 5e-7 rad, some hundred times tighter than the tolerance on its direction: a direction typed with five digits (`up: [0.5, 0, 0.866]`), or a face of another body that is not exactly parallel, would turn the whole bottom face into an overhang "from 0". Rerun on the turned housing with such a direction: contact 6028.84, as with the exact one.
- `overhang`: the area that looks down and leans from the vertical by more than the overhang angle, and is not contact; per named face, with the height above the bed where the overhang of that face starts (`from`), the largest first. The total area and the number of faces are of all of them.
- **Where a triangle looks.** A triangle of a planar face looks where its face looks: the normal of the face out of the body, which the engine knows exactly (`context.frame`). Only a triangle of a face that is not planar is judged by its own normal. This holds for the contact and for the overhang alike.

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
- **The answer**: a row per body and orientation with what decides (whether it fits, whether a face named to lie on the bed does, the height, the area on the bed, the overhang and on how many faces). A picked row paints the overhanging faces of that orientation in one colour and its contact faces in another, on the model as it stands, and lists the overhanging faces under it with their areas and heights. Under that list it says, per list, what is not shown and why: how many faces on the bed and how many overhanging faces `maxFaces` cut, and how many overhangs are below `minArea`. The view does not turn the model onto a bed: the faces are the answer, and they are where the user would change the design.
- The nested arguments of an orientation (`by`, `up`, `onBed`, `turn`) are labelled by their keys: the description cannot give them titles (a need recorded in 1b).

## Needs from the preparatory step

None of its own. It uses the stand-ins of 1b: the units of a result (the angle, shown in degrees), and `failed` with the path of the argument where the mistake is the caller's and the description cannot say it (a direction without a length: a `vector` is three numbers with no range).

## Rejected

- **One body per call.** A face on the bed belongs to one body, which suggests it. But "every part along both directions of the axis" is the first question about an assembly, and it would be a call per part; a face gives a direction for all of them and the answer says for which body it is the contact.
- **An error when the named face is not the lowest thing of its body.** It is a fact about the orientation, and often the interesting one (a boss below the face). `onBed` says it.
- **Reading "is the face on the bed" off the list of contact faces** (the first version). The list is cut by `maxFaces`; a body resting on twenty-one faces would hide the answer.
- **Contact as "everything at the lowest height".** It counts the facets of round faces; see the 96 mm² of a cylinder on its side.
- **Contact triangle by triangle, every corner at the lowest point** (the third version). The direction of the face had a tolerance of 1e-4 rad that the height test then took away; see `contact` above.
- **Contact by the height alone** (the second version, which dropped the test of the direction together with the triangle's own normal). On a slab thinner than the precision of the coordinates the top and the sides are at the lowest point too. The normal of the face costs nothing to test.
- **The bed as a `vector`** (the first two versions). Three numbers with no range, so a bed of size zero had to be refused in `run`, as a failure of the computation. Three named numbers say the range in the description.
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

### Round 2 (2026-11-15): the fixes of round 1

`codex` and a new internal subagent, on what the fix commit `7f03434` changed; `agy` did not take part (out of quota). The round as a whole is recorded in [1b](../1b-measure/design.md). Both found the counting of the two lists right and the new step of the scenario true to the model (the disc of the carrier starts at z = 46.5 and its pins reach down to 34, so the carrier "on" `carrier/startCap` rests on the three pin ends). The internal reviewer ran the contact rule on 192 cases (eight bodies, eight directions, as modelled and turned to coordinates of 200 and 2000) and found no face in contact that does not look down. The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| Contact without a test of the direction takes the top and the sides of a body thinner than the precision of the coordinates for contact (a slab 0.00005 thick at x = 100) | codex (major); the internal reviewer called the risk theoretical and proposed the same fix | Yes: nothing sets a smallest thickness of an extrusion | Contact tests the normal of the face against up as well as the height. Rerun on the housing, as modelled and turned: the same four numbers |
| The view shows only the sum of what `maxFaces` cut, not which list of which orientation, nor the overhangs below `minArea` | codex | Yes | A line per picked orientation: each list's shown and counted faces, and `small` |
| The bed can be written with its range, so its check does not belong in `run` | internal | Yes (a probe: `fields` of three numbers with an open lower bound) | The bed is `{ x, y, height }`; a bed of size zero is `invalidArguments` before `run`; `calls.ts` has the case |

Nothing was left without action.

### Round 3 (2026-11-15): the fixes of round 2, the last round

`codex` and a fresh internal subagent read only what the second fix commit (`bc6a44c`) changed; `agy` did not take part (out of quota). By the rule of the project this is the last round. Neither found a blocker. Both found that the direction together with the height keeps the top and the sides of a thin body out of the contact, that a horizontal face that is not the lowest is an overhang, that `onBed` cannot be true for a face that looks sideways, and that the bed derives `{ x, y, height }` and fails before `run` with the path `['bed', 'height']`. The internal reviewer reran the three orientations of the housing. The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The direction of a face is tested to `ANGLE_TOLERANCE`, but the height of every corner of every triangle to the precision, which is some hundred times tighter for a face of real size: a box tilted by 1e-6 rad has no contact and its whole bottom as overhang | internal | Yes (the reviewer's run; rerun here with a direction of five digits on the turned housing) | A planar face is contact as a whole, by its lowest corner. Rerun: 2801.28, 6028.84, 103.13 and 8612.84 as before, and 6028.84 with the typed direction |
| The opening paragraph still says "a contact is a test of its height", and `returns` and the description of the result leave out the direction | both | Yes | The three texts |
| "This package takes that description over" holds for the orientations only: the bed of the preparatory step's sketch is a `vector` | internal | Yes | Said so |
| `normalOf` is undefined also for a planar face the context gives no frame for | internal | Yes (`faceFrame` answers `brokenReference` when the normals of a face sum to nothing) | Said in the contract: such a face is judged by its triangles |

Nothing was left without action. Not reviewed by anyone: the rule "a planar face is contact as a whole", which is the fix of this round.

## As implemented

### The engine side (2026-11-15)

`packages/engine/src/query/print.ts`: the entry `print` in `QUERIES`, the pass `printPass`, and the frames `frameOfDirection` and `turned`; the types, `printPass` and `frameOfDirection` are exported from the index of the engine. Tests: `packages/engine/test/print.test.ts` (the frame of an orientation and the pass on meshes written by hand: a box on three of its sides, tilted, at exactly the overhang angle, turned with a direction typed with five digits, with a bent bottom, thinner than the precision; a face that looks down above the bed; a cylinder on its side), `packages/scenarios/test/print.test.ts` (the query against the real adapters on a plate with a hole and a pin: by a direction and by a face, `onBed`, the bed, the angle, the limits of the answer, `at`, the errors), three cases of scenario 11 in `scenario11.test.ts`, and the rows of the query in `packages/mcp/test/queries.test.ts`. The review added the tests named `review:`: in the engine the pass on bodies of several boxes and the entry `print.run` over a context written by hand (what the query reads of a context: the names of faces, the boxes of bodies, the frame and the number of a face), and through the real adapters a plate with a block added beside it from the same plane.

**The numbers of the design hold on the joint**, all of them as measured by the prototype: the housing on its seating face has a contact of 2801.28 mm² and an overhang of 3330.69 mm², all of it the ceiling of the motor recess, 28 mm up; on its front face a contact of 6028.84 and an overhang of 103.13 on the floors of the six nut pockets (17.19 each), 3 mm up; on its side no contact and 8612.84 on 21 faces, the largest the outer wall (3949.79, from the bed up). The carrier named to lie on the face its pins stand on rests on the three pin ends (`onBed` false). The carrier pins up: 2826.18 on the bed and no overhang; pins down: the disc overhangs, 2767.58 from 12.5. The sun teeth down: the flange overhangs, 1021.44 from 15.5. (The prototype of the design measured 3 to 6 ms for the housing in one orientation; the test only asks for well under two seconds.)

What differs from the design and from `contract.ts`:

- **A face that is not planar is `notAvailable`**, not `failed`, with the path of its orientation (`['orientations', 1, 'by', 'onBed']`): `QueryFailure` of the engine names that very case under `notAvailable`, as the section does for its plane. **A direction without a length is `invalidArguments`**, the code `QueryFailure` got with 1b; the design wrote `failed`, the stand-in of that time.
- **A planar face that is not contact overhangs as a whole**, by the normal of its face, with all its area and from its lowest corner. The design says the same of its triangles one by one ("a triangle of a planar face looks where its face looks"); the result is the same, and the face is summed once. Only the triangles of a face that is not planar are judged and summed one by one, and `from` of such a face is the lowest corner of the triangles that overhang.
- **How far a face leans** is the angle of its normal below the horizontal: nothing for a wall, a right angle for a ceiling. It is an overhang when that is more than the overhang angle plus `ANGLE_TOLERANCE`. So an angle of a right angle lists nothing, and an angle of zero everything that looks down.
- **`fits` allows the precision of the coordinates**: a body exactly as large as the bed fits.
- **Contact is measured along the normal of the face, not along `up`** (after the review, below). A planar face that looks straight down within `ANGLE_TOLERANCE` is contact when nothing of the body reaches beyond its plane by more than the precision of the coordinates, the distance taken along the normal of that face. The design compares the lowest corner of the face with the lowest point of the body along `up`; that keeps one large face under a direction typed with five digits, and loses all but the lowest of several faces in one plane (the ends of three pins, two feet). So a face is asked what the caller meant: put on this face, does the body rest on it?
- **Faces of one area are listed in the order of their numbers**, so the lists do not depend on the order of the triangles. One area is one to six digits, which is what coordinates in float32 give: the copies of a face made by a pattern differ from the seventh digit on (17.188932 and 17.188922 mm² for the floors of the nut pockets). The areas are rounded and then compared, because an order by a tolerance is not an order; two areas that round apart are listed by their size.
- **A direction of any length a double holds has a unit vector**: it is divided by its largest part before its length is taken, so `[0, 0, 5e-324]` and `[1.7e308, 1.7e308, 1.7e308]` are directions. Only a direction of zeros (or one that is not finite, which the check of the arguments refuses first) has no length.
- **A body named twice is judged once**, and the bodies come in the order they were asked about (without `bodies`, the order of the model).
- **The nested arguments have titles** (`What is up`, `Direction`, `Face on the bed`, `Turn`, the three lengths of the bed): the description can give them since 1b. The design expected them to be labelled by their keys.
- **`units`** are on the entry: `angle` in radians (a form shows degrees), `size` and `from` in millimetres, `area` in mm².
- **The directory is `query/`**, as the preparatory step made it, not `queries/`.

**Known limits** (those of the design, and what the implementation adds).

- An overhang held at both ends (a bridge), the floor of a horizontal hole and the underside of a chamfer are all overhangs of their faces: the query does not know what a printer bridges.
- A round face is judged by its facets, so its overhang is that of the polygon: at the chord tolerance 0.01 mm the overhang of a horizontal hole of 8 mm is within a tenth of π·d·t/4 (the test).
- A planar face for which the engine has no frame (the normals of its triangles sum to nothing) is judged by its triangles and never counts as contact.
- The body is put on the bed at its lowest point whatever is there: a body that would fall over is not noticed.
- Every face that looks straight down within `ANGLE_TOLERANCE` is judged in its own plane. Two faces of one body that both pass, in planes up to 1e-4 rad apart, are both counted as contact; a face 100 mm across counted as contact may have its far end 0.01 mm above the bed along `up`. That is the tolerance on the direction, used for the height as well.

### Review of the engine side (2026-11-15)

One full review by a subagent that did not write the code, read-only, with probes and mutations of its own. One serious finding, in the rule of the contact; the rest are small or gaps in the tests.

| Finding | Held | What was done |
|---|---|---|
| A body that rests on several named faces in one plane lost all but the lowest of them when the direction was not exact: the height of a face was compared along `up` at the precision of the coordinates, and `up: [1e-5, 0, 1]` puts one pin end of the carrier 3e-4 mm below the others (serious: 58.61 mm² of contact came back as 19.54, and the other two ends as overhangs "from 0") | Yes | The height is measured along the normal of the face (above). Tests: two boxes of one body 60 apart, as modelled and turned by 30° with a direction of five digits; the carrier of the joint; a plate with a block added beside it, through the real adapters |
| A direction with parts near the smallest or the largest number a double holds gave an `up` of NaN or of zeros, and passed the test of its length | Yes (`[1e-320, 0, 0]`, `[0, 0, 5e-324]`, `[1.7e308, 1.7e308, 1.7e308]`) | The unit vector is taken after a division by the largest part; the entry refuses by the same function |
| The order of faces of one area was decided by the last digits of the areas, which differ between the copies of a pattern | Yes; and nine digits, the first fix, were not enough: the copies differ at the seventh | Areas are compared rounded to six digits, then by the number of the face |
| The message for a planar face without a frame said the face is not in the state asked about | Possible (a face whose triangles sum to no normal) | The message names both reasons |
| Mutations that passed all tests: `onBed` read from the cut list, the totals of the contact taken from the cut list, the precision handed to the pass, the allowance of `fits`, the 45° at which the axis laid into the bed changes, the x of the frame of a face and `turn` with a face, the lowest corner of a face taken from its first triangle, the count of a cut with `minArea`, `>=` at `minArea`, the order of faces of one area | Yes | Tests named `review:`. The entry is run over a context written by hand for what the real adapters cannot tell apart (the x of the frame of a face is the same as that of a direction on every model at hand) |

After the fix twenty mutations of `print.ts` were run against the test of the engine (the old rule of the contact, the ones above, the unit vector): nineteen fail. The one that passes takes the reach of a planar face along its normal from its first triangle only, which is the same number on a face that is planar.

No second round: one serious finding, and the fix is a change of one rule with the tests of the cases it was found on.

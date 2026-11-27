# 7a Modelled threads: the spike

**State: measured on 2026-11-26, on the branch `d36/7a` from `master` at `4b9f70f`; J and K added for the design on the same day, L to P for its revision after the first reviews on 2026-11-27, Q to S for the revision after the second ones on the same day (P measured again with the ring).** No engine code: the builders of the tool live in the spike, [`spikes/thread.spike.ts`](../../../spikes/thread.spike.ts). The question was the paragraph "To verify by a spike" of [backlog.md](../../backlog.md), "Helix and modelled threads", which a pointer to this file replaces: "The triangle count: one thread of ten turns is tens of thousands of triangles. The kernel adapter was slow on a tool with many faces (192 holes in one boolean took 7.6 s), so the time of a boolean with a threaded tool and of a pattern of such tools has to be measured first." In full: is a modelled thread, built as the twisted extrusion of its planar cross-section, feasible on the real kernel adapter in time and in robustness? The owner's decisions of 2026-11-26 it starts from are recorded in the same section of the backlog. Sections J and K were measured the same day for the design ([design.md](design.md)): a shorter run past an open end, and the engine's check of collisions on a screw and a nut.

**The answer: yes, with three changes to the plan.**

1. **The build.** The layered twisted extrusion is correct, but for a thread it costs 3 to 22 times the triangles of a sweep of the axial profile along the helix, which makes the same solid, and its booleans take 3 to 14 times as long. The sweep is recommended for threads; the layers stay the build of a twist on an extrusion and of helical gears.
2. **The ends.** "Flat ends exactly at the ends of the face" is the one thing the adapter does not take well: a tool with an end in a face of the body was refused in 24 % of 900 random cases (sweep) and takes 3 to 10 times as long. A tool that runs past an open end, and stops a little short of a shoulder, was refused once in 450 and makes the same thread.
3. **The clearance.** A modelled screw and a modelled nut are free of each other only when the clearance is at least the chord tolerance.

With these, one thread costs 25 to 120 ms at the chord tolerances 0.05 and 0.01 (M10 to M20, a 40 mm lid thread), and eight M8 threads through a plate 0.2 to 0.45 s in one boolean.

## What was built

**The profile.** A trapezoid ridge per pitch in the axial plane, given by the major and the minor radius, the half-angle of the flanks and the flat at the crest (`Basic`). `iso` is the basic profile of ISO 68-1 from its definition (H = √3/2 · P, minor diameter D − 2 · 5/8 · H, crest flat P/8); `printed` takes a depth and a half-angle and makes the two flats equal. `shapeOf` turns it into the profile of a tool: an offset along the normal (the clearance of a nut is the screw shape grown by it), and the flanks run on to another radius at the crest or at the root. The thread surface is `r(θ, z) = profile(z − hand · lead · θ / 2π)`, lead = pitch · starts.

**Two builders of the same tool.**

- `buildLayered`, the planned one. The cross-section at z = 0 is a polar loop: arcs for the flats, and for a flank r linear in θ (a spiral of Archimedes), each divided by the rule of an arc for the chord tolerance. The loop is extruded in layers, each turned by `hand · 2π · z / lead`; the count of layers is the twist divided by the step of an arc at the largest radius. Every quad is cut by its shorter diagonal.
- `buildSwept`. The four points of the axial profile run along four helices. In the plane (θ, z) the helices are parallel straight lines, and the mesh is made of axial sections at a list of angles: between two neighbouring sections every strip of the profile is one quad, cut by the planes of the two ends while it is built. The angles are those where a helix meets an end plane, with each gap between them divided by the rule of an arc. A vertex nearer to an end plane than 5 % of the axial step (and than half the chord tolerance) is the vertex of that plane, so no triangle is thinner.

Both place their vertices on the exact surface in float64 and store float32. Both take a pose (a rigid transform applied per vertex), as a frame of the engine would place them.

**Three kinds of tool.**

| Kind | What it is | Used for |
|---|---|---|
| `solid` | everything within the thread surface: the screw shape | an internal thread, cut out of a block with a hole |
| `groove` | between the thread surface and a cylinder outside it | an external thread cut into a rod at the major diameter |
| `ridge` | between a cylinder inside it and the thread surface | an external thread joined onto a core at the minor diameter |

**Beside the wall.** A tool never ends on the wall it works on: the root of the tool of an internal thread lies inside the hole, the crest of a groove tool outside the rod, the root of a ridge tool inside the core, each by `max(0.05, 2 · chord tolerance)`, with the flanks run on to that radius. The wall is a polygon within its circle, so the distance has to exceed its sagitta.

**The faces of a tool**: `start`, `end`, `flankA`, `crest`, `flankB`, `root`, `wall` (the plain cylinder of a groove or a ridge), one number per role whatever the count of starts.

**The bodies** are prisms of the engine (`buildPrism`), joined by the adapter where a rod stands on a plate. Every boolean is `kernel.boolean` of `createManifoldKernel`, with its moving of flush faces, its cleaning and its checks.

## Measured

Triangles and deviations are independent of the machine. **The times are of this machine** (Apple M5, Node 25.9, one thread) and of the adapter in Node. Each is the smaller of two runs unless it says otherwise; the first run of a boolean differed from its repeat by a few per cent (by up to a quarter in a few rows with an end in a face), so nothing has to warm up. The very first boolean of the process took 15 ms.

### A. The tool alone

A screw shape of the basic profile. "Lines" is the division of a full turn at the major radius; "deviation" the largest distance of the mesh from the exact surface (the centroids and the middles of the edges of all triangles of the thread surface, measured in the axial plane).

| Case | Chord tol | Lines per turn | Layers | Triangles, layered | Triangles, swept | Ratio | Deviation, layered / swept |
|---|---|---|---|---|---|---|---|
| M10x1.5, 20 mm | 0.01 | 50 | 663 | 67 728 | 6 192 | 10.9 | 0.0100 / 0.0090 |
| | 0.05 | 23 | 296 | 13 662 | 2 980 | 4.6 | 0.0500 / 0.0428 |
| | 0.1 | 16 | 210 | 6 752 | 2 208 | 3.1 | 0.0991 / 0.0808 |
| M20x2.5, 30 mm | 0.01 | 71 | 843 | 118 160 | 7 092 | 16.7 | 0.0100 / 0.0100 |
| | 0.05 | 32 | 377 | 24 192 | 3 192 | 7.6 | 0.0500 / 0.0482 |
| | 0.1 | 23 | 267 | 12 328 | 2 292 | 5.4 | 0.0995 / 0.0982 |
| M8x1.25, 10 mm | 0.01 | 45 | 356 | 32 130 | 3 120 | 10.3 | 0.0100 / 0.0098 |
| | 0.05 | 20 | 159 | 7 040 | 1 488 | 4.7 | 0.0499 / 0.0492 |
| | 0.1 | 15 | 113 | 3 648 | 1 080 | 3.4 | 0.0985 / 0.0769 |
| Lid 40x4, 15 mm, flanks 45° | 0.01 | 100 | 373 | 74 800 | 3 392 | 22.1 | 0.0100 / 0.0099 |
| | 0.05 | 45 | 167 | 15 456 | 1 624 | 9.5 | 0.0497 / 0.0487 |
| | 0.1 | 32 | 118 | 8 092 | 1 216 | 6.7 | 0.0996 / 0.0805 |

- With n lines per turn, the layered build has about `2 · n² · turns` triangles (the loop has about n points and a turn about n layers) and the swept one about `2 · 4 · n · turns` plus the ends. The ratio is about n / 4 and grows as the tolerance gets finer.
- Both stay within the chord tolerance without dividing for half of it: the vertices lie on the surface, and the chords of the two directions do not add up.
- The mesh is inscribed: the volume of the M10 tool is 0.26 %, 1.3 % and 2.6 % below the exact one at 0.01, 0.05 and 0.1 (the lid: 0.07 %, 0.32 %, 0.62 %). The exact volume of a screw shape of the length l is `π · l ·` the mean of r² over a pitch, because every cross-section has the same area.
- No triangle without an area in any tool. The narrowest triangle is 0.015 mm wide (M10 at 0.01, swept) and 0.027 mm (layered).
- Building a tool takes at most 5 ms (swept) and 27 ms (layered).

### B. One thread through the adapter

The tool ends in no face of the body: an internal thread through a block runs 1 mm past both faces; a groove tool stops `max(0.05, 2 · tol)` short of the shoulder and runs 1 mm past the free end; a ridge tool runs 1 mm into the shoulder and stops as much short of the free end. Milliseconds of the whole `kernel.boolean`; in brackets the same call with nothing moved before and nothing cleaned or checked after, which is the check of the input and the library.

| Case | Chord tol | Internal, cut: swept | layered | External, cut of a rod: swept | layered | External, union on a core: swept | layered |
|---|---|---|---|---|---|---|---|
| M10x1.5, 20 mm | 0.01 | 97 (41) | 952 (234) | 88 (40) | 1 021 (224) | 85 (39) | 925 (224) |
| | 0.05 | 40 (19) | 133 (58) | 45 (21) | 171 (61) | 43 (19) | 127 (56) |
| | 0.1 | 28 (14) | 81 (37) | 29 (13) | 80 (35) | 31 (14) | 92 (36) |
| M20x2.5, 30 mm | 0.01 | 115 (49) | 1 010 (380) | 115 (52) | 1 082 (382) | 110 (50) | 971 (369) |
| | 0.05 | 60 (24) | 217 (91) | 56 (25) | 274 (96) | 51 (24) | 321 (89) |
| Lid 40x4, 15 mm, 45°, clearance 0.3 | 0.01 | 56 (27) | 774 (245) | 75 (27) | 712 (228) | 56 (27) | 700 (220) |
| | 0.05 | 26 (13) | 167 (62) | 30 (13) | 146 (55) | 26 (13) | 154 (57) |
| | 0.1 | 18 (9) | 82 (38) | 19 (10) | 76 (35) | 18 (9) | 75 (35) |

- The lid with a half-angle of the flanks of 30° instead of 45° (the same depth) gives the same times within a few milliseconds at 0.05, the one tolerance it was run at.
- More than half of the time is the adapter's own work in JavaScript (the cleaning and the checks), which grows with the triangles of the result: a body cut by a layered tool at 0.01 has 65 000 to 115 000 triangles, by a swept one 6 500 to 15 000. Every later feature on that body pays for them again.
- The volume of every result matches the exact thread within what the chords take: at most 0.04 % of the body at 0.01, 0.23 % at 0.05 and 0.37 % at 0.1.

### C. The ends of the tool

The same threads with one or both ends of the tool in a face of the body ("flat ends exactly at the ends of the face"). M10x1.5, 20 mm; milliseconds.

| Operation | Ends of the tool | 0.01 swept | 0.01 layered | 0.05 swept | 0.05 layered |
|---|---|---|---|---|---|
| Internal, cut | in both faces of the block | 437 | 2 643 | 115 | 355 |
| | 1 mm past both | 97 | 952 | 40 | 133 |
| External, cut of a rod | in the shoulder and in the free end | 767 | 4 154 | 213 | 625 |
| | in the shoulder, past the free end | 416 | 3 034 | 124 | 449 |
| | short of the shoulder, in the free end | 413 | 2 813 | 125 | 383 |
| | short of the shoulder, past the free end | 88 | 1 021 | 45 | 171 |
| External, union on a core | in the shoulder and in the free end | 692 | 3 568 | 175 | 468 |
| | into the shoulder, in the free end | 384 | 2 437 | 104 | 349 |
| | into the shoulder, short of the free end | 85 | 925 | 43 | 127 |

- Each end in a face adds 0.17 to 0.35 s at 0.01 with the swept tool and 0.85 to 2 s with the layered one, all of it in the adapter (the library takes the same 40 or 230 ms either way): the face of the tool is moved before the boolean and everything it left is put back after it.
- The larger cases cost more: M20 at 0.01 with both ends in faces took 0.64 to 1.1 s swept and 5.5 to 9.5 s layered (measured once; the full run leaves the layered ones out).
- **Refusals.** Of the 150 booleans of the full run, 9 were refused, all of them an external cut with an end in a face: M20x2.5 at 0.01 (swept, both ends in faces) and at 0.05 (both builds), and the lid with 30° flanks at 0.05 (both builds). The message is "the result of the boolean has a folded triangle (a detail smaller than the kernel tolerance at flush faces)". A flat end makes a feather edge where the groove runs out: in the end plane a flank meets the wall of the rod at the angle `atan(lead / (2π · r · tan α))`, about 4° for M20, and next to faces in one plane the adapter cannot keep a detail that thin. No tool that ends in no face was refused in these cases.
- A cut may run past an open end of the wall into the air, and a union past a shoulder into the material, and the result is the same thread. At the other kind of end the tool has to stop short; the thread then ends flat `max(0.05, 2 · tol)` before the shoulder or the free end.

### D. An external thread: a cut or a union

Both work, in the same time, with the same refusals at flush ends (C and H). What differs is what they need and leave:

| | Cut of a rod (`groove`) | Union on a core (`ridge`) |
|---|---|---|
| The body before | a pin at the major diameter, as a cosmetic thread has it | a pin at the minor diameter |
| The face the thread was placed on | stays, with its number and its exact cylinder, as the crest | stays as the root |
| The tool's faces left | the flanks, the root, the flat end | the flanks, the crest, the flat end |
| An open end | the tool runs past it | the tool stops short or lies in it |

**The cut is chosen**: the pin keeps the nominal diameter whether the thread is cosmetic or modelled, so the flag changes nothing else in the model, and an internal thread is a cut too, so the feature always removes material.

### E. A modelled screw in a modelled nut

An M10x1.5 screw of the basic profile (a rod cut by a groove tool) in a nut whose hole and tool are grown by the clearance. What the two share, in mm³ over 20 mm, by `kernel.boolean('intersection')`; `intersectionAsComputed` gives the same volumes.

| Clearance | Chord tol 0.01 | 0.05 | 0.1 |
|---|---|---|---|
| 0.2 | 0 | 0 | 0 |
| 0.1 | 0 | 0 | 0 |
| 0.05 | 0 | 0 | 0.25 |
| 0.02 | 0 | 0.35 | 1.88 |
| 0.01 | 0 | 1.28 | 3.23 |
| 0 | 0.49 | 3.58 | 7.14 |
| −0.05 (exact shapes: 46.23) | 46.31 | 47.54 | 42.66 |

- A clearance of at least the chord tolerance gives exactly nothing; below it the chords of the two meshes cross (the tool of the nut is inscribed, so the nut is up to one sagitta tighter than the exact one). With no clearance the two share slivers; with a negative one they share what the exact shapes do, within 8 %.
- A layered screw in a swept or a layered nut with a clearance of 0.1 shares nothing either.
- The intersection takes 26 to 110 ms when the two are free of each other. Of two coincident threads it takes far longer: 0.27 to 1.5 s swept, and for a layered screw in a swept nut 1 s at 0.1 and 26 s at 0.01 (the last measured once and left out of the full run).

### F. A pattern: eight M8x1.25 threads through a plate 110 x 60 x 10

Holes at the minor diameter; one boolean with a tool of eight pieces, or eight booleans in turn. Milliseconds (in brackets the library, as in B); the columns "in the faces" and "in turn" are one run each.

| Chord tol | Build | Triangles of the eight tools | In the faces: one boolean | in turn | 1 mm past the faces: one boolean | in turn |
|---|---|---|---|---|---|---|
| 0.01 | swept | 24 960 / 30 976 | 9 898 (177) | 2 994 | 447 (186) | 1 721 |
| 0.01 | layered | 257 040 / 308 160 | 51 829 (979) | 19 327 | 3 351 (1 070) | 12 223 |
| 0.05 | swept | 12 448 / 14 816 | 2 551 (87) | 1 083 | 199 (91) | 738 |
| 0.05 | layered | 56 320 / 67 584 | 7 698 (272) | 4 229 | 823 (286) | 3 121 |

- Past the faces, one boolean of eight pieces is 3.7 times faster than eight in turn (each of the eight cleans the whole plate again).
- In the faces it is the other way round: one boolean is 9 to 22 times slower than past the faces, because the putting back of the moved faces grows faster than the count of pieces, and eight in turn (1.5 to 1.7 times slower than past the faces) are then the faster way.
- The layered pattern at 0.01 in the faces was measured once (52 s and 19 s) and is left out of the full run.
- Every result is closed and its volume within 0.012 % of the exact one.

### G. Variants and faces

At a chord tolerance of 0.05, 12 mm long: M10x1.5 right-handed and left-handed, with two starts in both hands, the lid with three starts, and a sharp V without flats (pitch 2, 45°, depth 1).

- Both builds make a closed tool the adapter takes, within the tolerance of the exact surface and 0.3 to 1.3 % below its volume.
- The two builds make the same solid: what they share is 0.09 to 0.45 % less than either, the difference of their chords.
- A tool mirrored in a plane through the axis lies on the surface of the other hand (deviation as before).
- A blind hole cut by each (the thread starts 2 mm above the bottom, the tool runs past the open face): accepted, the volume within 0.05 % of the exact one.
- **Face numbers** (D56). In every accepted result of B, C, F and G the faces of the tool that are left are exactly those that should be, and none that should be gone: an internal thread keeps `flankA`, `flankB` and the `crest` of the tool (the major cylinder of the nut), plus `start` at a blind end; a groove keeps the flanks, its `root` and `start` (the flat end at the shoulder); a ridge keeps the flanks, its `crest` and `end`. The root of a tool inside a hole, the crest of a groove tool outside the rod, the `wall` and the ends beyond the body never appear. The wall of the body keeps its number in every result.

### H. Random threads in random poses

Diameters 6 to 48 mm, pitch 6 to 16 % of the diameter, metric or printed (30° or 45°, depth 30 to 45 % of the pitch), one to three starts, both hands, 0.4 to 7.4 leads long (40 mm at most), chord tolerance 0.02, 0.05 or 0.1 (never more than a fifth of the depth); 70 % of them turned about a random axis and up to 250 mm from the origin. The three operations of B with every variant of the ends of C. The run of 150 threads (seed 1):

| Ends of the tool | Build | Booleans | Refused | Mean ms |
|---|---|---|---|---|
| No end in a face | swept | 450 | 1 (0.2 %) | 46 |
| | layered | 90 | 2 (2.2 %) | 196 |
| An end in a face | swept | 900 | 213 (24 %): external cut 145 of 450, union 54 of 300, internal cut 14 of 150 | 236 |
| | layered | 180 | 75 (42 %) | 709 |

- Every accepted result has the volume the exact surface gives, within 11 % of the bound the chords allow.
- The three refusals with no end in a face:
  - #107, swept, an internal cut: metric 6.91 x 0.955, 3.87 mm long, tolerance 0.02, turned and 76 mm from the origin: a folded triangle. The same thread at the origin, unturned, is accepted. The tolerances of the adapter grow with the distance from the origin (D63 has the same limit).
  - #145, layered, a union: metric 24.33 x 1.845, 10.91 mm, tolerance 0.02, turned and 181 mm from the origin: not a closed surface. Accepted at the origin; the swept tool is accepted in place.
  - #115, layered, an external cut: printed 30°, 25.96 x 2.038, two starts, 7.68 mm, tolerance 0.1, turned and 142 mm from the origin: not a closed surface, at the origin too. The swept tool is accepted.
- In 33 of the 540 the flanks of the tool met before it was the full distance clear of the wall (a profile with narrow flats). None of them was refused; the sample is small.

### I. Pitfalls of the layered build

| Question | Finding |
|---|---|
| Twist per layer against the chord error | The layers have to follow the chord of a helix at the largest radius. Half the layers give four times the deviation: 0.040, 0.149 and 0.522 mm with a half, a quarter and an eighth of the 663 layers of M10 at 0.01 |
| The diagonal of a quad | It matters: the longer diagonal gives 0.0355 mm where the shorter gives 0.0100. With the layer step equal to the step of the loop the shorter diagonal runs along the axis and the mesh is a regular grid |
| The seam where θ wraps | None: the loop is closed and every layer is the same loop turned, with any count of starts |
| Triangles at the flats | No triangle without an area; a flat narrower than nothing is left out of the profile, so a sharp crest or root is one edge |
| The ends | The caps are a fan from the axis (the cross-section is a star about it); for a groove or a ridge the kernel triangulates the ring between the turned loop and the other wall. The caps themselves are fine; what they meet is C |
| The triangles | Slivers by construction: 0.63 mm long and 0.03 mm wide for M10 at 0.01 |

### J. A short run past an open end (measured for the design, 2026-11-26)

B, C and H ran a tool 1 mm past an open end. The design of D75 ([design.md](design.md)) runs it past by no more than it keeps from a shoulder, `max(0.05, 2 · tol)`, so that a tool reaches as little as it can beyond the wall. The run of 150 random threads of H again with that distance at both kinds of end (`THREAD_SPIKE_PAST=beside THREAD_SPIKE_COUNT=150`, the swept build, seed 1; the union on a core is not part of the design and is the row of H):

| Operation | Ends of the tool | Booleans | Refused | Mean ms |
|---|---|---|---|---|
| Internal, cut | `max(0.05, 2 · tol)` past both faces | 150 | 0 | 42 |
| External, cut of a rod | as much short of the shoulder and past the free end | 150 | 1 (0.7 %) | 50 |
| All three operations of H, with 1 mm past | | 450 | 1 (0.2 %) | 46 |

- The one refusal is #104, a metric 20.55 x 1.678, 8.02 mm long, at a tolerance of 0.1, turned and 215 mm from the origin: a folded triangle. At the origin, unturned, it is accepted, as the refusals of H were. With 1 mm past, the refused one was #107 (an internal cut), which this run accepts.
- Every accepted result has the volume of the exact thread within 11 % of the bound of the chords, as in H.
- So the short run is as safe as the long one within what a few hundred booleans show: one refusal either way, far from the origin.

### K. The engine's check of collisions on a screw and a nut (measured for the design, 2026-11-26)

`sharedBy` and `verdictOf` of `interference.ts` (D50), the rule of the query `interference`, on the M10x1.5 screw and nut of E at a chord tolerance of 0.05, and on three pairs that overlap by design: a plain rod at the major diameter (a bought screw, or a pin with a cosmetic thread) in a modelled nut and in a plain hole at the minor diameter (a bore with a cosmetic thread), and a modelled screw in such a hole. Test 3b of the spike; the bodies are described to the check from their meshes (a face is planar when its triangles have one normal).

| Pair | Clearance | Volume mm³ | Depth mm | Verdict | ms |
|---|---|---|---|---|---|
| Modelled screw in a modelled nut | 0.1 | 0 | 0 | nothing | 41 |
| | 0.05 | 0 | 0 | nothing | 45 |
| | 0.02 | 0.482 | 0.027 | fit | 3 491 |
| | 0 | 5.249 | 0.047 | fit | 10 360 |
| Plain rod in a modelled nut | 0.1 | 184.8 | 0.750 | collision | 1 050 |
| Plain rod in a plain hole at the minor diameter | 0 | 465.6 | 0.859 | collision | 7 |
| Modelled screw in a plain hole at the minor diameter | 0 | 204.4 | 0.859 | collision | 1 439 |

- With a clearance of at least the chord tolerance the check finds nothing, in the time of the intersection. Below it the pair is a fit, as a pin in its hole is (the slivers are no deeper than the tolerance and the flanks are not planar), but the measure of the depth takes 3.5 to 10 s: it grows with the square of the triangles of what the two share, and a thread shares a sliver along every flank.
- The pairs that overlap by design are collisions to the check of today, 0.75 to 0.86 mm deep. In all three, every vertex of what the two share lies between the wall of the hole and the major cylinder of the thread (grown by the clearance) and between the ends of the thread, within the chord tolerance (the farthest 0.048 mm outside at a tolerance of 0.05). That is the test the design excuses such a pair by.
- The intersection of the two with a modelled thread takes about a second, most of it the measure of the depth (the intersection alone took 26 to 110 ms in E).

### L. The hands and the kinds of the swept tool (measured for the review of the design, 2026-11-27)

A review of the design claimed that the swept builder makes a left-hand tool, and the ring a bore is cut with, inside out. Test 7 of the spike builds the three kinds (the solid screw shape, the groove tool of a pin, the ring of a bore) in both hands with one and two starts and takes the signed volume of each mesh (`volumeOf`, positive for a mesh that faces outwards), against the exact volume of the shape (M10x1.5, 20 mm, at 0.05):

| Hand | Starts | Kind | Signed volume mm³ | Exact | Difference |
|---|---|---|---|---|---|
| right | 1 | solid | 1291.00 | 1302.83 | −0.908 % |
| right | 1 | groove | 386.02 | 390.66 | −1.189 % |
| right | 1 | ring | 289.90 | 292.49 | −0.883 % |
| right | 2 | solid | 1293.41 | 1302.83 | −0.723 % |
| right | 2 | groove | 385.72 | 390.66 | −1.264 % |
| right | 2 | ring | 291.05 | 292.49 | −0.491 % |
| left | 1 | solid | 1289.97 | 1302.83 | −0.987 % |
| left | 1 | groove | 387.34 | 390.66 | −0.849 % |
| left | 1 | ring | 288.50 | 292.49 | −1.363 % |
| left | 2 | solid | 1291.56 | 1302.83 | −0.865 % |
| left | 2 | groove | 388.25 | 390.66 | −0.616 % |
| left | 2 | ring | 288.54 | 292.49 | −1.349 % |

- Every one is positive and a chord's worth below the exact volume. The builder walks the angle upwards for both hands and puts the hand into the shift of the profile, so the surface is one graph over the angle and the height and its triangles turn the same way.
- The adapter said the same before: tests 5 and 6 cut with left-hand tools (half of the random threads of H), and a tool that faced inwards would have been refused or would have added where it should cut.

### M. A clearance as a radial shift (measured for the review of the design, 2026-11-27)

The first version of the design moved the flanks along their normal and held the crest at the wall; the spike had built such a clearance only on an internal tool. On a pin that takes the crest flat away at `0.054 · P` (0.08 for M10). The revised design shifts the thread radially: with a clearance `c` an external thread is the basic thread of the diameter `D − 2c`, cut into the pin as it was made. Test 7 cuts it with the groove tool (the crest of the tool one lift outside the wall, 20 mm, short of a shoulder and past the free end):

| Thread | Chord tol | Radius of the pin | Clearance | Flat left on the wall, by the profile | ms | Volume against exact | Faces of the tool left | Area of the wall left, mm² | By the flat |
|---|---|---|---|---|---|---|---|---|---|
| M10x1.5 | 0.05 | 5 | 0 | 0.1875 | 79 | 0.190 % | start flankA flankB root | 76.8 | 74.6 |
| M10x1.5 | 0.05 | 5 | 0.1 | 0.0720 | 44 | 0.180 % | start flankA flankB root | 29.9 | 28.7 |
| M10x1.5 | 0.05 | 5 | 0.2 | −0.0434 | 32 | 0.208 % | start flankA flankB root | 0.1 | 0 |
| M10x1.5 | 0.05 | 4.8 | 0.2 | 0.1875 | 53 | 0.238 % | start flankA flankB root | 74.9 | 71.6 |
| M10x1.5 | 0.05 | 4.6 | 0.4 | 0.1875 | 46 | 0.237 % | start flankA flankB root | 71.6 | 68.6 |
| M10x1.5 | 0.01 | 4.8 | 0.2 | 0.1875 | 99 | 0.047 % | start flankA flankB root | 71.8 | 71.6 |
| lid 40x4, 45° | 0.05 | 20 | 0.2 | 0.4000 | 40 | 0.025 % | start flankA flankB root | 237.5 | 238.8 |
| lid 40x4, 45° | 0.05 | 19.7 | 0.3 | 0.8000 | 37 | 0.022 % | start flankA flankB root | 461.9 | 470.4 |

- The flat on the wall is `crestFlat + 2 · (D/2 − c − r) · tan α` (r the radius of the pin, α half the flank angle). The area of the wall left above the foot follows it within the chord (the flat along the helix).
- A pin at the nominal radius keeps a flat of 0.072 at a clearance of 0.1 (the flanks of the tool meet 0.062 beyond the wall, 1.25 chord tolerances; the cut is taken and the wall is a face). At 0.2 the flat is below zero: the cut is taken and nothing of the wall is left. That is the case the design refuses.
- A pin made at `D − 2c` keeps the full flat at 0.2 and at 0.4, at both tolerances.
- No cut was refused, and none left a hidden face of the tool.

A screw in a nut, each thread the basic one shifted by its clearance and cut into a wall of the radius given (the ring tool of N for the nut), through the engine's check of collisions at 0.05. The last two rows were added for the second review:

| Clearance of the screw | Radius of the pin | Clearance of the nut | Radius of the bore | Between the flanks, across them | Crest of the screw to the root of the nut | Crest of the nut to the root of the screw | Shared mm³ | Depth | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 5 | 0.2 | 4.388 | 0.100 | 0.2 | 0.2 | 0 | 0 | nothing |
| 0 | 5 | 0.1 | 4.288 | 0.050 | 0.1 | 0.1 | 0 | 0 | nothing |
| 0 | 5 | 0.06 | 4.248 | 0.030 | 0.06 | 0.06 | 0 | 0 | nothing |
| 0 | 5 | 0.02 | 4.208 | 0.010 | 0.02 | 0.02 | 1.070 | 0.027 | fit (7.4 s) |
| 0.1 | 4.9 | 0 | 4.188 | 0.050 | 0.1 | 0.1 | 0 | 0 | nothing |
| 0.1 | 5 (the nominal one) | 0 | 4.188 | 0.050 | 0 | 0.1 | 0.214 | 0.043 | fit (seconds) |

- The pair is free when the radial gaps, at the flanks and between every crest and the root it faces, are at least the chord tolerance, as with the clearance of E and K, although the flanks are then only half as far apart across: the chords of a mesh deviate along the radius, and so does the shift.
- **The wall has to be made for the clearance.** A pin left at the nominal radius with a clearance of 0.1 is accepted by the feature (a flat of 0.072 is left), but its crest is the wall, and that lies in the root of a nut without a clearance: a fit, measured for seconds. The clearance of a thread frees its flanks and its root; the crest is freed by the size of the wall, or by the clearance of the mate.
- These rows are one size at one tolerance (0.05); the default tolerance of a document, 0.01, was not run here (the fit rows take seconds to a minute).

### N. The tool of a bore as a ring, and what stands in the way (measured for the review of the design, 2026-11-27)

The first version cut a bore with the solid screw shape. A review pointed out that it takes whatever stands in the bore. Test 7 compares it with a ring (the spike's kind `ridge` used in a difference: between a cylinder two lifts inside the wall and the thread surface), M10x1.5, 20 mm, at 0.05:

| Body | Tool | Tool triangles | ms | Volume taken mm³ | The grooves alone | Faces of the tool left | Hidden faces left |
|---|---|---|---|---|---|---|---|
| A through hole | solid | 3 004 | 52 | 203.12 | 200.75 | flankA crest flankB | none |
| | ring | 3 112 | 45 | 203.12 | 200.75 | flankA crest flankB | none |
| A blind hole with a post of 4 in its middle | solid | 2 756 | 43 | 444.08 | 199.74 | start flankA crest flankB | none |
| | ring | 2 856 | 42 | 201.26 | 199.74 | start flankA crest flankB | none |
| A through hole with a key 2 x 2 standing into it | solid | 3 004 | 44 | 212.22 | 200.75 | flankA crest flankB root | root |
| | ring | 3 112 | 46 | 204.78 | 200.75 | flankA crest flankB root wall | root wall |
| A pin with a rib 4 x 2 on its wall | groove | 3 232 | 46 | | | flankA crest flankB root wall | crest wall |

- **The ring cuts the same thread as the solid tool**, to the hundredth of a cubic millimetre, with 4 % more triangles in the same time. (In the names of the spike's roles the `crest` of a tool of a bore is the root of the thread it leaves.)
- **A post in the middle of the bore is taken by the solid tool without a trace** (244 mm³ more than the grooves, and no face of the tool left that would tell); the ring leaves it.
- **What crosses the hidden faces of a tool leaves them in the body**: a key that stands into the bore from its wall leaves the strip of the tool between the grooves (`root`) and, of a ring, its inner cylinder (`wall`); a rib on a pin leaves the strip (`crest` of the groove tool) and the outer cylinder. So a number of their own for those faces, and a look for it after the boolean, tells the feature that something stood in the way.

### O. The zone of a thread on what two bodies share (measured for the review of the design, 2026-11-27)

**Superseded by Q.** The three rules below read the vertices and the triangles of the mesh two bodies share. The second review showed that such a mesh can hold a sheet without thickness where faces of the two lie flush (a head seated on a face), which takes vertices out of the zone and to the axis, differently for the two orders of the bodies. The pairs of the table are measured again in Q by the rule the design has now; the helper of the second rule (`originToTriangle`, which a review found wrong for a triangle seen edge-on) is gone from the spike with it.

The first version excused a pair when every vertex of what the two bodies share lay in the zone of a thread (between the wall and the root, between the ends). A review showed pairs that pass and are no mates. Test 7 intersects the pairs through the adapter and judges every connected piece (`pieceSolids`) by three rules: the vertices in the zone; no triangle nearer to the axis than the lower radius of the zone; the angles of the vertices about the axis with no gap of half a turn. At 0.05, the slack the tolerance and 10⁻⁴:

| Pair | Shared mm³ | Pieces | Every vertex in the zone | No triangle inside the lower radius (nearest to the axis) | Around the axis (widest gap) | By the three rules | What it is |
|---|---|---|---|---|---|---|---|
| M8 pin (cosmetic) in a plain hole at its minor diameter | 153.7 | 1 | yes | yes (3.278) | yes (18°) | excused | a mate |
| M8 pin pushed through a solid block (no hole) | 494.4 | 1 | yes | no (0.000) | yes (18°) | judged as every pair | no mate |
| A plate 1 mm thick through the M8 pin | 49.4 | 1 | yes | no (0.000) | yes (18°) | judged as every pair | no mate |
| A bar 2 x 2 through the axis of the M8 pin | 31.4 | 1 | yes | no (0.000) | yes (151°) | judged as every pair | no mate |
| A wall pushed 0.5 mm into the M8 pin from one side | 11.8 | 1 | yes | yes (3.500) | no (305°) | judged as every pair | no mate |
| A clamp around 200° of the M8 pin, 0.4 mm into it | 52.6 | 1 | yes | yes (3.551) | yes (160°) | excused | a mate |
| A rod 8 in an M8 bore with a countersink, the zone of the wall alone | 128.2 | 1 | no | yes (3.278) | yes (13°) | judged as every pair | no mate (wrongly) |
| The same, the zone run out through the countersink | 128.2 | 1 | yes | yes (3.278) | yes (13°) | excused | a mate |
| A rod 8 too long for a blind M8 bore: 2 mm into its bottom | 252.6 | 1 | no | no (0.000) | yes (18°) | judged as every pair | no mate |
| A plain rod 10 in a modelled M10 nut (clearance 0.1) | 216.5 | 1 | yes | yes (4.240) | yes (9°) | excused | a mate |

- **The vertices alone excuse the first five pairs**, four of which are no mates: what a pin shares with a solid block is the pin itself over that length, a mesh with every vertex on its rim. The triangles of its ends reach the axis, which the second rule sees (the nearest point of a triangle 0.000 from the axis; a mate keeps 3.278, the lower radius less a sagitta).
- **A body pushed in from one side** lies in the zone whole and has no triangle near the axis: it covers 55° of the turn, where every mate that goes around covers all of it. The third rule asks for more than half a turn, so a clamp of 200° still passes and one half of a split nut does not.
- **A countersink.** The rod shares the part of the cone between the wall's end and where the cone reaches the major diameter, 0.68 mm of height here. With the zone ended at the end of the wall the pair is a collision; with the zone run out through the cone (as the thread itself runs out there) it is excused.
- **A screw too long** fails both the ends and the inner radius, and in the design only its part beyond the thread is judged: the test here has one piece, so the pair is a collision as a whole.
- The three rules cost one pass over the triangles of what the two share.

### P. Random threads at the default chord tolerance, with a blind hole (2026-11-27; measured again with the ring after the second review)

H and J drew their chord tolerances from 0.02, 0.05 and 0.1 and had no blind hole. A document has 0.01 unless its file says otherwise. The run of 100 random threads at 0.01 with the short run of J (`THREAD_SPIKE_PAST=beside THREAD_SPIKE_TOLS=0.01 THREAD_SPIKE_COUNT=100`, the swept build, seed 1; 11 minutes), with a fourth body, a hole on a bottom 3 mm thick, whose tool stops the lift short of the bottom and runs the lift past the open face. The tool of the two bores is the ring of N (the first run of this section, like B, C, H and J, cut bores with the solid screw shape; `THREAD_SPIKE_BORE=solid` builds it):

| Operation | Ends of the tool | Booleans | Refused | Mean ms |
|---|---|---|---|---|
| External, cut of a rod | an end in a face | 300 | 150 (50 %) | 766 |
| | no end in a face | 100 | 1 | 125 |
| Internal, cut with a ring | an end in a face | 100 | 14 (14 %) | 916 |
| | no end in a face | 100 | 1 | 102 |
| Internal blind, cut with a ring | an end in a face | 100 | 27 (27 %) | 959 |
| | no end in a face | 100 | 0 | 108 |
| External, union on a core (not part of the design) | an end in a face | 200 | 53 (27 %) | 819 |
| | no end in a face | 100 | 1 | 109 |

- **With no end in a face: 2 of the 300 cuts the design makes** (0.7 %), against 1 of 300 at the coarser tolerances (J). Both are turned and far from the origin and are accepted at the origin, unturned: #77, an external metric 36.05 x 3.554, 10.7 mm long, 237 mm from the origin (the result is not a closed surface), and #91, an internal printed thread 30.71 x 3.999 (45°) with two starts, 38.3 mm long, 171 mm from the origin (a folded triangle).
- **The ring and the solid tool are refused in the same cases**: the first run, with the solid screw shape in the bores, refused the same two cuts (and 26 of the blind ones with an end in a face, where the ring has 27). A reviewer's run of the ring gave the same.
- **None of the 100 cuts into a blind hole** with no end in a face was refused.
- **With an end in a face** the rate is that of C and H or above it (14 to 50 %), and the cuts take six to nine times as long.
- **Another run past the ends changes the two refusals** (measured with the solid tool). The two cases alone (`THREAD_SPIKE_ONLY=77,91`) with 1 mm past the open ends: both cuts accepted. With 0.1 and with 0.02: #91 accepted, #77 refused. (The union of #77, which is not part of the design, is refused at every one.) So a refusal depends on a dimension of the tool that the thread does not depend on, and a second build with another one is a candidate for the implementation; a longer run is harmless only where nothing of the body lies beyond the end.
- The lift at these distances is ten bands of the kernel adapter and more (`bandOf` is 10⁻⁵ of twice the distance from the origin: 0.005 at 237 mm), so the two refusals are not a lift below the band.

### Q. The zone of a thread as a cut of its body (measured for the second review of the design, 2026-11-27)

The second review found that the rules of O fail where a face of the screw lies flush on a face of the tapped body: the mesh the two share then holds a sheet without thickness (the underside of a head on the top face), with vertices far outside the zone or across the axis, in one order of the two bodies and not in the other. Two ways of making the rule deaf to sheets were tried on the pairs below (test 8a):

- **Cutting the mesh the two share by a ring of the zone** does not hold: with a sheet in that mesh, its intersection with the ring came out with 69.29 mm³ where the two share 68.93 (three pairs with a seated face, in the order that leaves the sheet), and its difference with the ring was refused by the adapter (a folded triangle).
- **Cutting the body with the thread** holds, and is what the design has now. The ring of the zone (grown by the chord tolerance where it borders the material of that body, at the root and at an end that is not open; by the lift where it borders its air) cuts the body into the part in its zone and the rest. What the other body shares with the part in the zone is read by sums over its triangles (its volume, its centre of volume, its mean squared radius), to which a sheet adds nothing; every connected piece of it has to go around the axis, its centre nearer to the axis than 0.827 of its radius, where the centre of a third of a ring lies. Then the zone is taken, and the rest of the body is judged against the other body as every pair is (`sharedBy`, `verdictOf`). A zone that is not taken changes nothing.

Every pair in both orders (the body with the thread first, and second), with the same outcome and the same numbers in both; the chord tolerance is 0.05 for the pairs of O and 0.01 for the pairs with flush faces:

| Pair | In the zone: mm³ (centre / radius) | Excused mm³ | The rest shares mm³ | Depth | Which is | The pair is |
|---|---|---|---|---|---|---|
| M8 pin (cosmetic) in a plain hole at its minor diameter | 153.72 (0.000) | 153.72 | 0 | 0 | nothing | threaded |
| M8 pin pushed through a solid block (no hole) | 164.61 (0.000) | 164.61 | 329.82 | 5.000 | collision | a collision |
| A plate 1 mm thick through the M8 pin | 16.46 (0.000) | 16.46 | 32.98 | 3.224 | collision | a collision |
| A bar 2 x 2 through the axis of the M8 pin | 2.94 (0.985), 2.94 (0.985) | 0 | 31.37 | 3.951 | collision | judged whole: a collision |
| A wall pushed 0.5 mm into the M8 pin from one side | 11.76 (0.975) | 0 | 11.76 | 0.500 | collision | judged whole: a collision |
| A jaw around 100° of the M8 pin, 0.4 mm into it | 26.15 (0.879) | 0 | 26.15 | 0.449 | collision | judged whole: a collision |
| A clamp around 180° of the M8 pin (one half of a split nut) | 47.26 (0.637) | 47.26 | 0 | 0 | nothing | threaded |
| A clamp around 200° of the M8 pin, 0.4 mm into it | 52.65 (0.563) | 52.65 | 0 | 0 | nothing | threaded |
| A rod 8 in an M8 bore with a countersink, the zone of the wall alone | 124.39 (0.000) | 124.39 | 3.82 | 0.601 | collision | a collision |
| The same, the zone run out through the countersink | 128.21 (0.000) | 128.21 | 0 | 0 | nothing | threaded |
| A rod 8 too long for a blind M8 bore: 2 mm into its bottom | 154.60 (0.000) | 154.60 | 98.01 | 2.000 | collision | a collision |
| A plain rod 10 in a modelled M10 nut (clearance 0.1) | 216.48 (0.010) | 216.48 | 0 | 0 | nothing | threaded |
| A plain rod 6 through a plate tapped M6 (no flush face) | 68.93 (0.000) | 68.93 | 0 | 0 | nothing | threaded |
| A screw with its head (10 across) seated on the top face | 68.93 (0.000) | 68.93 | 0 | 0 | nothing | threaded |
| A screw with its head in a counterbore of the same diameter | 77.55 (0.000) | 77.55 | 0 | 0 | nothing | threaded |
| A standoff with a cosmetic M6 pin, its shoulder seated on the plate | 68.93 (0.000) | 68.93 | 0 | 0 | nothing | threaded |
| A rod 6 standing on the flat bottom of a blind bore tapped M6 | 51.70 (0.000) | 51.70 | 0 | 0 | nothing | threaded |
| A countersunk screw 8 in an M8 bore with a countersink, the two cones divided differently | 115.68 (0.000) | 115.68 | 0.129 | 0.0068 | fit | threaded and a fit |

- **The four pairs with a flush face** (a seated head, a head in a counterbore, a seated shoulder, a rod on a blind bottom) are excused in both orders, with the volume of the plain rod (68.93) to the hundredth.
- **What is no mate is still a collision**: the pin through a block and the plate through a pin by what the rest of the pin shares with them (its core), the bar, the wall and the jaw because their pieces in the zone do not go around.
- **A fit joined to the thread is a fit**: the cones of a countersunk head and of its countersink, divided differently, share slivers that are one piece with the thread overlap in the mesh the two share (a reviewer measured that piece 0.82 mm deep, a collision by the rules of O). Cut off with the rest of the body they are 0.0068 mm deep, a fit.
- **Going around.** The ratio of the centre to the radius is `sin(φ/2) / (φ/2)` for a piece that covers the angle φ evenly: 0 for a whole ring, 0.563 at 200°, 0.637 at half a ring, 0.827 at a third, 0.879 at 100°, 0.975 for the wall pushed in. A straight wall cannot cover more than `2 · acos(low / high)` of a zone (68° of M8: 0.94). The threshold of a third lets one half of a split nut pass and refuses a jaw of 100°; where it belongs is a question for the owner (design.md, question 57). A threshold at a half would lie on the value of the most common case and fall either way with the noise of the mesh.
- **The cost**: three booleans beside the one of every pair (the body with the ring, twice, and the part in the zone with the other body): 5 to 55 ms a pair here, 170 ms with a modelled nut or with the fit.

### R. The ends of a wall, read from the bodies of the engine (measured for the second review of the design, 2026-11-27)

All three reviewers of the second round found the reading of an end of the first revision wrong for the most common ends: the engine triangulates a flat cap from the vertices of its boundary alone (`buildPrism`), so the bottom of a blind hole and the free end of a pin have every vertex on the circle of the wall. "The vertex across the rim lies on the cylinder: the wall goes on" then reads both as an end inside the wall. Test 8b is a prototype of the corrected reading on bodies the engine built (the kit of the scenarios; chord tolerance 0.01), among them the jar and the lid of scenario 18:

- the rim of an end is the loop of the edges the wall shares with other faces that goes around the axis and holds the extreme point of that end;
- the triangle of another face across an edge of the rim decides: when its face is a cylinder about the same axis with the same radius, the wall goes on; else by its third vertex, which lies outside the cylinder beyond the radius and inside it otherwise, also when it lies on it (a triangle with three vertices on a cylinder is a chord of it). Inside the cylinder is the air of a bore and the material of a pin;
- the run-out of an open end is how far beyond the end the faces across the rim lie within the band of the thread, walked from the rim across their edges (read here on samples of the triangles).

| Wall | Triangles of the body | Side | Low end | High end |
|---|---|---|---|---|
| The neck of the jar: on its foot, a flat free end | 1 044 | a pin | shoulder | open, run-out 0 |
| The socket of the lid: a mouth in a plane, a flat blind bottom | 1 014 | a bore | open, run-out 0 | shoulder |
| A plain hole through a plate (the hole feature) | 868 | a bore | open, run-out 0 | open, run-out 0 |
| A countersunk hole (90°), the cone below | 868 | a bore | open, run-out 0.500 | open, run-out 0 |
| A counterbored hole, the seat below | 868 | a bore | open, run-out 0 | open, run-out 0 |
| A rod 8 with a chamfer of 1 at its top | 462 | a pin | open, run-out 0 | open, run-out 0.667 (exact: 0.677) |
| The lower half of a pin made by two extrusions of one circle | 266 | a pin | open, run-out 0 | inside |
| Its upper half | 266 | a pin | inside | open, run-out 0 |
| A blind hole with a flat bottom, cut from the top | 176 | a bore | shoulder | open, run-out 0 |

- Every end is read as scenario 18 expects it (`jarChecks`: the neck `open` at its free end, the socket `shoulder` at its bottom) and as a tap or a die would meet it.
- The run-out through the countersink is the 0.5 of an M6 thread in a bore of 5; that through the chamfer of the rod is the depth of an M8 thread within the sampling of the prototype.
- The reading took 4 to 27 ms a wall (one pass over the triangles of the body and the samples of the run-out).
- Not measured: a rim that is not a circle (a hole in a round or a leaning face), a rim partly at a shoulder, a fillet at the foot of a pin, bodies in a pose.

### S. The phase of a mate (measured for the second review of the design, 2026-11-27)

Three reviewers found the formula for two threads that run in opposite directions right only when the first has no phase. Test 8c puts a point of the first helix against the second by the formula of the datum (the crest at `origin + s · axis + R · (zero turned by θ)`, `s = turn · lead · θ / 2π + k · pitch`, `zero` the model's X axis turned by the phase about the axis of the thread): M10, the second origin 4.3 along the first axis, both hands, one and two starts.

| Phase of the first | The same way, `φ₁ + turn · 2π · g / lead` | The other way, as the first revision had it: `φ₁ − turn · 2π · L / lead` | The other way, `−φ₁ − turn · 2π · L / lead` |
|---|---|---|---|
| 0 | on it (0.0003) | on it | on it |
| 0.7 rad | on it | 0.334 off (one start), 0.665 off (two starts) | on it |

- The two threads share the model's X axis as the base of `zero`, and each turns it by its phase about its own direction: seen from one side the two phases turn opposite ways. So the second phase takes the first with the other sign.

## Conclusions

1. **Feasible.** A modelled thread on a pin or in a hole is one boolean of 25 to 120 ms with the swept tool, at any of the three tolerances and up to M20 and a 40 mm lid thread, when no end of the tool lies in a face. A pattern of eight is 0.2 s (0.05) to 0.45 s (0.01) in one boolean.
2. **The build for threads is the sweep of the axial profile.** It makes the same solid as the layered build with a tenth of the triangles at the default tolerance, its booleans are 3 to 14 times faster, the bodies it leaves are 3 to 10 times smaller, and of the three refusals of H two were layered tools whose swept twins were accepted. The layered build is still feasible on its own: 0.13 to 0.32 s per thread at 0.05 and about 1 s at 0.01. For the twist of an extrusion and for helical gears it is the right build, because there the twist is a fraction of a turn and the profile is not straight in the axial plane; what it needs is in I.
3. **The divisions.** The chord tolerance of the document as it is, by the rule of an arc at the major radius, for the turn (both builds) and for the layers (layered): 50 lines per turn for M10 at the default 0.01, 71 for M20, 100 for 40 mm. No halving. For printing 0.05 is enough: 23 to 45 lines per turn, a deviation of 0.05 mm against clearances of 0.2 to 0.4 mm, and about half the triangles and half the time. At 0.1 a thread is 15 to 32 lines per turn and takes up to half of a 0.2 mm clearance. Whether 0.05 looks smooth in the view was not looked at (no image was made).
4. **External threads are a cut** of a rod at the major diameter (D).
5. **No end of the tool in a face of the body** (C, H). That is the difference between a thread that is refused in a quarter of the cases and one that is refused in 0.2 %.
6. **A clearance of at least the chord tolerance** (E).

## What the design must take from it

- **The tool builder** is the sweep: the axial profile as a short list of points with roles, the helices, the sections at the angles where a helix meets an end plane, the snap of a vertex next to an end plane. The spike's `buildSwept` is about 70 lines and can be moved with its tests (the deviation from the exact surface, the exact volume, the comparison of the two hands).
- **The ends.** The feature has to know, for each end of the thread, whether the wall ends in the open there or at a shoulder, and build the tool past the first and short of the second by more than the band of the kernel and than twice the chord tolerance (as D63 lifts its tools off round faces). How it finds out is open: from the neighbouring face across the edge, by a probe boolean, or by a field of the feature. A thread that ends in the middle of the wall needs nothing: its end is inside the material.
- **Beside the wall.** The root of an internal tool and the crest of a groove tool lie off the wall by more than its sagitta. Where the flats are too narrow for the flanks to run that far, the tool comes nearer; that passed in the 33 cases met, and a hole whose radius is within a sagitta of where the flanks meet is the case to refuse or to test further.
- **Faces.** The thread's faces are the flanks, the cylinder the tool adds (the major cylinder of a nut, the minor one of a screw) and a flat end; the wall the thread was placed on stays a face with its exact cylinder, so an `AxisRef` of the kind `face` on it still resolves and later features keep their references. The flanks are helicoids: `Surface` has no kind for them but `general` (`swept` means swept along a straight axis). One number per role served any count of starts.
- **Validation.** A clearance below the chord tolerance deserves a warning, since a check of interference will find the pair touching. A thread shallower than about five chord tolerances is not a thread at that tolerance. A cap on the triangles as the revolve has one.
- **A pattern of threads** should apply its copies as one tool when they end in no face (3.7 times faster); today's pattern applies them in turn.
- **The phase.** For a screw to sit in a nut the two helices have to start at matching angles, and a mate has to tie the turn to the travel. The spike builds both about one axis with one phase; where the helix starts on a face is for the design.

## Not measured

- The app: the times are of Node; the WASM library in a browser and the renderer with a body of this size were not run.
- What the engine does around the boolean (the description of the body, the checks of `applyTool`, export): linear passes over the mesh, not timed.
- How a thread looks in the view at each tolerance, and a real print.
- The cosmetic variant, the catalog of metric threads, a lead-in or a chamfer at the end, a thread in a hole that is not at the minor diameter, a thread that crosses another feature (a cross hole, a slot).
- Square threads (flanks with no angle): the builders refuse them.
- The engine's own check of interference on a screw and a nut was not measured by the spike; K has it since.
- A clearance on an external thread, the ring as the tool of a bore, a blind hole and the default tolerance among the random threads were not measured by the spike; M, N and P have them since.
- The reading of the ends from the mesh of a body was not measured by the spike; R has a prototype of it on nine walls since. A rim that is not a circle and bodies in a pose are still owed (design.md, "To verify before the implementation").
- A run-out of a thread into a chamfer or a countersink at its open end (the tool passing through a cone), and an end whose rim is partly open and partly at a shoulder.

## Running it

```
npx vitest run --config spikes/vitest.config.ts spikes/thread.spike.ts
```

The default run takes about 40 s: the tool alone at all three tolerances, everything else at 0.05 with the layered build for M10 only, the check of collisions of K without its two fits, the tests for the reviews (7, and 8a to 8c: 4 s), four random threads. `THREAD_SPIKE_FULL=1` runs the sweeps the tables above come from (about six minutes; 50 random threads) and the rows that take seconds each: the two fits of K (clearances 0.02 and 0) and the two of M. The run of 150 random threads of H is `THREAD_SPIKE_FULL=1 THREAD_SPIKE_COUNT=150` with `-t "^6 "` (about six minutes more), and its three refusals alone `THREAD_SPIKE_ONLY=107,115,145` on top of that. `THREAD_SPIKE_SEED` gives another sequence. `THREAD_SPIKE_PAST` sets how far a tool runs past an open end in tests 2 and 6: a number of millimetres (1 when absent), or `beside` for the distance it keeps from a shoulder; the run of J is `THREAD_SPIKE_PAST=beside THREAD_SPIKE_COUNT=150` with `-t "^6 "` (about four minutes). `THREAD_SPIKE_TOLS` is the list of chord tolerances test 6 picks from (0.02, 0.05 and 0.1 when absent); the run of P is `THREAD_SPIKE_PAST=beside THREAD_SPIKE_TOLS=0.01 THREAD_SPIKE_COUNT=100` with `-t "^6 "` (11 minutes). Since P, tests 2 and 6 have a fourth body, the blind hole, and since the second review they cut the two bores with the ring of N; `THREAD_SPIKE_BORE=solid` cuts them with the solid screw shape, which the tables of B, C, H and J were measured with. Test 7 holds L, M and N; tests 8a, 8b and 8c hold Q, R and S.

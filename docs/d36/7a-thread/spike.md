# 7a Modelled threads: the spike

**State: measured on 2026-11-26, on the branch `d36/7a` from `master` at `4b9f70f`.** No engine code: the builders of the tool live in the spike, [`spikes/thread.spike.ts`](../../../spikes/thread.spike.ts). The question was the paragraph "To verify by a spike" of [backlog.md](../../backlog.md), "Helix and modelled threads", which a pointer to this file replaces: "The triangle count: one thread of ten turns is tens of thousands of triangles. The kernel adapter was slow on a tool with many faces (192 holes in one boolean took 7.6 s), so the time of a boolean with a threaded tool and of a pattern of such tools has to be measured first." In full: is a modelled thread, built as the twisted extrusion of its planar cross-section, feasible on the real kernel adapter in time and in robustness? The owner's decisions of 2026-11-26 it starts from are recorded in the same section of the backlog.

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
- The engine's own check of interference on a screw and a nut; only the two calls of the kernel were made.

## Running it

```
npx vitest run --config spikes/vitest.config.ts spikes/thread.spike.ts
```

The default run takes about 25 s: the tool alone at all three tolerances, everything else at 0.05 with the layered build for M10 only, four random threads. `THREAD_SPIKE_FULL=1` runs the sweeps the tables above come from (about six minutes; 50 random threads). The run of 150 random threads of H is `THREAD_SPIKE_FULL=1 THREAD_SPIKE_COUNT=150` with `-t "^6 "` (about six minutes more), and its three refusals alone `THREAD_SPIKE_ONLY=107,115,145` on top of that. `THREAD_SPIKE_SEED` gives another sequence.

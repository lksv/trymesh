# UI: the thread

Part of [ui.md](../ui.md); how to read the tables is said there. The form of the thread (D76: cosmetic and modelled threads); the engine side is [architecture/thread.md](../architecture/thread.md).

## Thread (D76)

| Function | Command / call | Reads |
|---|---|---|
| Pick the faces in the view from the body before the feature, or take one out of the list by a click | UI logic; the view shows the state before the feature while picking | `evaluation.faceSurfaces` (a cylinder) of the state before the feature |
| Remove a face by its button | UI logic | |
| A size from the catalog: fills the diameter, the pitch and the label | UI logic | `DATA_CATALOGS.metricThreads.rows` |
| What the picked faces would have to be for the thread, against what they are | UI logic | `evaluation.threads` of the preview (side, radius), the row of the size (tap drill) |
| The numbers, the hand, the direction, the copies, the label | UI logic; the numeric fields take expressions | `FEATURE_TYPE_INFO.thread.fields` |
| Preview while the values change | `preview(addFeature)` | `evaluation.features[id].facts` (`threads`, `copies`, `depth`, `minorDiameter`, `lead`), `evaluation.threads` |
| Confirm | `addFeature` (thread) | |
| Change any of it | `updateFeature` (every field; an emptied optional field is `null`) | |

The button *Thread* on the toolbar (after *Fillet*; its title: "A thread on bores or pins of a body (cosmetic: drawn as its helix, the mesh stays; modelled: its grooves cut into the mesh, for printing)") opens the form; a feature on the timeline is edited by a double click like every other. An edited thread whose label is a row of the catalog with its diameter and pitch shows that size in the picker. A new one takes the cylindrical face selected in the view (its body with it), otherwise no face yet and the body selected or the latest one; without a body the button says one is needed. It starts as M6, right-hand, from the end the axis points to (`backward`, the mouth of a hole made from a sketch on a face). Picking is armed when the form opens. Top to bottom:

- **Body**: the body of the faces ("the body of the first face picked" while the list is empty).
- **The list of faces**: each by its label and its key, with a button *Remove*.
- **Pick faces** arms and disarms the picking. While it is armed a click on a cylindrical face adds it and a click on a picked one takes it out; the first face sets the body; a face that is not a cylinder, or a face of another body, is refused at the click with a line in the status bar.
- **Also the copies of a pattern**: the flag `copies`.
- **From the catalog**: *Size (ISO metric)*, the keys of `metricThreads`; choosing one fills the diameter, the pitch and the label, and the status bar says the tap drill. Under it, for the preview: "Plate – bore at h1: a bore of 5, for this thread 5 (the tap drill)" (a pin: the nominal diameter; each moved by twice the clearance).
- **Nominal (major) diameter**, **Pitch**: required. **Depth of the profile**, **Angle between the flanks** (degrees for a bare number), **Clearance, radial**, **Starts**, **Offset**, **Length**, **Phase** (degrees for a bare number): empty leaves the field out and the engine takes its default; the placeholders say which (the depth of the preview, 60, 0, 1, "to the far end").
- **Hand** (*Right-hand*, *Left-hand*), **Direction** (from the end the axis points away from, along it; from the other end, against it).
- **Label** (for people; empty = none).
- **Modelled**: the flag `modelled` (stage 2), off by default, with a line that says what each mode does (cosmetic: the mesh stays and the helix is drawn; modelled: the grooves are cut for printing, and a modelled thread belongs late in the timeline). The preview of a modelled thread is the cut body; its facts add `triangles`.
- **The facts**: "2 threads (1 copy); depth 0.541, minor diameter 4.917, lead 1 mm."
- **Problems of the preview** use the texts of the engine (`invalidThread` with its detail: the window and the size to make, the part of a cylinder, the span) and the app names the faces in `refs` by their labels; the warning `noCopies` and, on a pattern, `mirroredThread` are shown as every warning is.

The view draws the helix of every cosmetic thread as a thin line (a modelled one draws none: it is in the mesh) (one line per start, along the datum of the record: where a screw has to stand to sit in it), in the preview and in the model: on each shown body it lies on, over the stretch of the span that body has, in the pose of that body, cut as the edges are; the picture for the AI draws it too. A face with a thread marks its thread feature among the rows under the pointer. A selected thread highlights its faces (the listed faces and, with `copies`, their copies); the model panel says "M10, left-hand, cosmetic, on 1 face of Pin." ("modelled" for a modelled one; the label, or the diameter and the pitch). It has no body of its own, so its eye on the timeline is disabled.

The query view of collisions shows the threaded pairs in a group of their own ("threaded, 68.9 mm³ excused"), a pair whose two threads do not agree says what differs, and a collision of two modelled threads that agree says how to seat them ("the threads are turned against each other: add −57.3° to the phase of nt (or turn the other)"; "the threads are seated, the collision has another cause" when the helices are one curve). It names an entry of this document first; one of an inserted document only when there is no other, with "(in its inserted document)"; the gap view has the contact `threaded` ([queries.md](queries.md)). The hole form has the use *tapped* among the sizes from the catalogs ([hole.md](hole.md)).

Between the stages (D76): what the meshes leave out is said where the app hands a mesh on or judges one.

| Where | What it shows | Reads |
|---|---|---|
| The status bar after an export of the form *Export* | "Exported model.stl (… bytes). body "plate": 6 cosmetic threads (M6), not in the mesh: tap or cut them after printing." | `notes` of `Engine.export` |
| The status bar after *Export STL* of the toolbar or of the line of a body | "Exported model.stl. body "plate": …"; nothing when no exported body has a cosmetic thread | `meshNotes` with the list given to `exportMesh` |
| The view of the print check | a hint after the rows: "Cosmetic threads, not in the mesh and not judged here: Plate (6). Tap or cut them after printing." | `cosmeticThreads` of `print` |
| The view of the parts list | the detail of a row ends "threads of each: 6 × M6 internal, cosmetic"; a body with a cosmetic thread and its copy without one are two rows | `threads` of a row of `partsList` |

**Implementation status**: stage 1, the point between the stages and stage 2 (the toggle *Modelled*, the summary that says modelled, the line of a seat in the view of collisions) implemented (D76, branch `d36/7a`), covered by `packages/app/test/app.test.ts` (snapshot `thread.txt`), `draw.test.ts` (the lines of a thread), `hover.test.ts` (the rows of a face with a thread), for the point between the stages `export-form.test.ts`, `query-print.test.ts` and `query-parts-list.test.ts` (the detail of a row, the two buttons *Export STL*), and for stage 2 `query-interference.test.ts` (the line of a seat). The time of a modelled thread in the browser is not measured. Not done: a size proposed from the radius of the picked face; checked in a browser only as far as "As implemented" of the design says.

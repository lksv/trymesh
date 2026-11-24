# UI: the revolve

Part of [ui.md](../ui.md); how to read the tables is said there. The form of the revolve (D58); the engine side is [architecture/revolve.md](../architecture/revolve.md).

## Revolve (D58)

| Function | Command / call | Reads |
|---|---|---|
| Choose the sketch and pick its regions in the view, with an offset; or a wall along curves with a thickness | UI logic (`profile-picker.ts`, shared with the extrusion) | regions of the sketch, `FEATURE_TYPE_INFO.revolve.fields` |
| Choose the axis: a base axis, or a line of a sketch | UI logic (`changeAxis`, the axis picker) | sketches before the feature and their lines (own, then projected, then the axes of the origin `origin/x`, `origin/y`, D71) |
| Choose the extent: a whole turn, or an angle with a start | UI logic; fields with an expression | |
| Choose the operation and the targets | UI logic | `bodies` before the feature |
| Preview while the values change, the axis drawn | `preview(addFeature)` | `evaluation.features[id].facts` (`axisPoint`, `axisDirection`, `steps`) |
| Confirm | `addFeature` (revolve) | |
| Change any of it | `updateFeature` (the profile, the axis and the extent whole; an offset the draft no longer has sent as `null`) | |

The button *Revolve* on the toolbar (after *Vysunutí*) opens the form; a revolve on the timeline is edited by a double click like every other feature. A new revolve takes the sketch selected on the timeline or the latest one (without a sketch the button says one is needed), its one region when it has exactly one, a whole turn and a new body; a sketch on a face of a body proposes an addition to that body, as for an extrusion. The default axis is the first construction line of the sketch; else the base axis in the base plane of the sketch (Z for XZ and YZ, Y for XY); else the first line of the sketch; else Z, which the preview then reports. Top to bottom:

- **Profile** (*Sketch regions* or *Wall along curves*), **Sketch**, and the fields of the profile: as in the form of an extrusion ([extrude.md](extrude.md)); regions and curves are picked in the view. A profile of each kind is remembered and returned to. When the profile moves to another sketch and the axis is a line of the sketch it leaves, the axis becomes the default axis of the new sketch (any other axis stays).
- **Axis** is the picker shared with the pattern and the joint (`axis-picker.ts`): the three base axes and *Along a line of a sketch*, offered once a sketch before this place has a line (or the axis already is one); since D71 every sketch has one, its axes of the origin. The latter adds a select of the sketches that have a line and a select of the lines of the chosen one, its own lines first (a construction line marked "(construction)"), then its projected lines ("(projected)"), then `origin/x` and `origin/y`; a line or a sketch that is gone stays listed as missing. A hint says the axis runs from the point a of the line to b and a positive angle turns by the right-hand rule about it. Under the picker a hint: the axis has to lie in the plane of the sketch, with the profile on one side of it.
- **Extent** is *Whole turn* or *Angle*; an angle has *Start angle* (from the sketch plane) and *Angle* (negative turns the other way), each in degrees for a bare number or an expression in radians. A new angle starts at 0 by 90°; the form remembers the angle the draft had last and returns to it from a whole turn. An angle of a whole turn is refused by the field (between −360° and 360°, not those).
- **Operation** and its targets: as for an extrusion (*Body* for an addition, *Target bodies* for a cut).
- **The facts**: "The turn is divided into N steps." from the preview.
- **Problems of the preview** use the texts of the engine: `invalidAxis` with its detail ("the axis is at 90° to the plane of the sketch", "the axis lies 5 mm off the plane of the sketch", the curves that reach to either side of the axis and how far, "the line of the axis has no length"); `invalidProfile` for a tool over a million triangles with the count.

The view of the form draws the picked regions or curves as for an extrusion and the axis of the preview as a line along the profile, from where the profile starts along the axis to where it ends, and a little beyond. A selected revolve highlights its faces as any feature does, and the model panel says its sketch, the axis ("the axis Z", "the line b of Profile"), the extent ("a whole turn", "by -120°", with the expression and the start when they are given), the operation, the regions with the offset or the wall with its thickness and curves, the targets, and the steps of the turn.

**Implementation status**: implemented (D58, branch `d36/4a`), covered by `packages/app/test/app.test.ts` (snapshot `revolve.txt`). Not done: picking the axis in the view (a line of a sketch is chosen from the selects), drawing the axis of a selected revolve that is not being edited.

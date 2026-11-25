# UI: the hole

Part of [ui.md](../ui.md); how to read the tables is said there. The form of the hole (D46).

## Hole (D46)

| Function | Command / call | Reads |
|---|---|---|
| Choose the sketch and tick its points | UI logic | sketches before the feature, their own points and origin |
| Choose the kind of hole and fill in its fields | UI logic; fields with an expression | `FEATURE_TYPE_INFO.hole.fields` |
| Fill the shape and the label from the catalog | `query('hardwareHole', { use, size, fit, allowance })` | `DATA_CATALOGS` (the sizes) |
| Choose the extent: through all with a side, or a distance with a start | UI logic | |
| Start the mouth at a plane or a planar face picked in the view (D66), or at the sketch plane again | UI logic | the plane of a pick in the state before the hole; `facts.startLevel` of the preview |
| Choose the targets | UI logic | `bodies` before the feature |
| A label | UI logic | |
| Preview while the values change | `preview(addFeature)` | |
| Confirm | `addFeature` (hole) | |
| Change any of it | `updateFeature` | |
| Show the depth of the hole and of its head | | `evaluation.features[id].facts` |

The button *Hole* on the toolbar opens the form (after *Extrude*); a hole on the timeline is edited by a double click like every other feature. A new hole takes the sketch selected on the timeline or the latest one, a plain hole of 3 mm through all backward, and as its target the body the sketch stands on (otherwise the latest body); without a sketch or a body the button says what is missing. Top to bottom:

- **Sketch** is a select with the sketches before the hole; another sketch drops the ticked points.
- **Points** has one checkbox per own point of the sketch and its origin, in the order of the sketch; a point that is no longer there stays listed as missing, so that it can be unticked. Points of projected geometry are not offered (the engine refuses them; a point with a `coincident` to one follows it). With no point ticked there is nothing to compute and OK is disabled. The view picks sketch points only inside the sketch mode, so the points are ticked here.
- **Kind** is a select with *Plain*, *Counterbore*, *Countersink* and *Nut pocket*; under it the numeric fields of that kind from the registry, each taking a number or an expression; the angle and the rotation are degrees for a bare number. Another kind keeps the diameter and takes the other fields from the shape that kind had last in the form; a field it never had stays empty and the preview says it is missing (a rotation starts at 0).
- **Extent** is *Through all* with a side (*Against the normal*, the default, or *Along the normal*) or *Distance* with the start of the mouth and the depth of the whole hole (negative into the body under a face). The form remembers the distance it had last.
- **Start at** (D66), under the extent select: as on the form of the extrusion, the line *Start at:* with *Sketch plane* or the label of the plane, the button *Pick the start* and with a plane the button *Sketch plane*, and where the preview has the mouth. While the pick is armed the view picks faces and planes in the state before the hole and the next click sets the plane; a second press, Escape (asked of the form first, `FeatureForm.cancel`) or leaving the form disarms it. The start plane goes along with the extent select, the side select and *Fill from the catalog*; the remembered distance never brings one back. When editing the form sends `from: null` for a draft without one. A counterbore whose point is in a sketch at the bottom of a part gets its head at the top: the top face as the start plane, through all against the normal.
- **Target bodies**: a checkbox per body before the hole; a target that no longer exists stays listed as missing.
- **Label**: free text; empty means none, and editing sends `label: null` then.
- **From the catalog** is a group with *For* (clearance hole, socket head cap screw, countersunk screw, hex nut, heat-set insert), *Size* (the sizes every catalog that use reads has: the inserts by the size as sold, the rest by the thread, so a socket head or a countersunk screw offers no M3.5, which ISO 4762 and ISO 10642 lack), *Series of the through hole* (fine, medium, coarse; not for an insert), *Allowance* (an expression, best the name of a parameter) and the button *Fill from the catalog*. The button asks the query `hardwareHole` and writes its `shape` and `label` into the draft; the status line names the catalogs used and what the extent is, or the reason of a refusal. The rule for the extent: an insert makes it a distance of its `depth`, keeping the start of a distance (0 from "through all") and the direction (the sign of the distance, read from the preview for an expression; for "through all" backward is negative); a screw or a nut leaves the extent as it is, and the status line says so ("the extent stays a distance of -4 mm"), so the blind distance of an earlier insert is not left unnoticed. The app composes nothing itself.
- **Problems of the preview** use the texts of the engine: `invalidHole` with its detail ("the head of 3 mm is not wider than the bore of 3 mm", "the head is 3 mm deep and the hole 2 mm", two points whose holes overlap), a missing field.

A selected hole highlights its faces and the model panel says its label, kind and sizes (with their expressions), its extent, the number of its points and its sketch, its targets, and the depth of the hole and of its head from the facts; with a start plane its label after the extent and where the mouth is. The faces of a hole are named in labels as "bore of a hole (at p1)", "head of a hole (at p1)", "flat of a nut pocket (2 at p1)", "seat of a hole". A hole has no body of its own, so its eye on the timeline is disabled.

**Implementation status**: implemented (D46, branch `d36/2c`), covered by `packages/app/test/app.test.ts` (snapshot `hole.txt`); the start plane (D66) by the snapshot `extent-start.txt`.

# UI: errors

Part of [ui.md](../ui.md); how to read the tables is said there. Errors of features and the repair of references.

## Errors and the repair of references

| Error | What the UI offers | Command |
|---|---|---|
| `brokenReference` to the plane of a sketch | pick a new plane or face | `setSketchPlane` |
| `brokenReference` to the base of a plane of its own | pick a new base | `updateFeature` |
| `brokenProjection` (a warning; the projected edge or entity frozen at its last values, the detail in the message for a projection from a sketch) | pick a new edge (*Project*), or a new point or curve of an earlier sketch (↻ in the row, then *From sketch*; the flag `regions` of the entry is kept), or remove the projection | `updateExternal`, `removeExternal` |
| `brokenReference` to the target body | pick another body | `updateFeature` |
| `brokenReference` to the source sketch of an extrude | pick another sketch and its regions; the ID of the extrude stays | `updateFeature` (`profile.sketch`, `profile.regions`) |
| `noProfile` | pick the regions again, or repair the sketch | `updateFeature` |
| `nonPlanarFace` | pick another face | `setSketchPlane` |
| `degenerateProjection`, `unsupportedProjection` (warnings; for a projection from a sketch the message says why: a source curve with no extent, or the angle of a plane that is not parallel) | pick another edge, or another entity of a sketch on a parallel plane (↻ and *From sketch*), of the same kind; or remove the projection and make a new one | `updateExternal`, `removeExternal` |
| `invalidProfile` | open the sketch and remove the crossings of curves | sketch commands |
| `noEffect` (a warning) | change the distance, the regions or the target | `updateFeature` |
| `emptyResult` | change the distance or the regions | `updateFeature` |
| `sketchConflict` (a warning, the model stays) | open the sketch, delete the conflicting constraint | `removeConstraint` |
| `invalidExpression` (an error; a warning for a sketch, which keeps the last valid value) | fix the expression or the parameter, or enter a number | `setParameter`, `updateFeature`, `setConstraintValue` |
| `invalidExtent` (D47) | pick another plane (not parallel to the direction, not through the start), or a smaller gap | `updateFeature` |
| `invalidHole` (D46) | make the head wider than the bore and shallower than the hole, or move the points apart | `updateFeature`, `setField` |
| `invalidPattern` (D53, a grid) | fewer places (the product of the two counts at most 200), or another step or direction where the message names two copies in one place; or `second: null` for a row | `updateFeature`, `setField`, `setParameter` |

The UI reads the text of an error from `features[id].error`, that of a warning from `features[id].warnings`; the references concerned are in `refs`.

An invalid command (`invalidCommand`) does not change the document; the UI shows the message from `CommandResult`. This includes a driving constraint between fixed entities only (the origin, projected geometry): the UI is to offer it only as a reference dimension.

## Implementation status

What the app (`packages/app`) does differently from the tables above, or beyond them:

- **Repair of references**: the plane of a sketch is changed by a button at the selected sketch; the base of a plane, and the sketch, the regions and the target of an extrusion, in their panel. Projected geometry has a list with its state in the panel of the sketch; from there a projection can be removed, or projected again onto another edge (even when the recompute could not evaluate it and it is not in the view).

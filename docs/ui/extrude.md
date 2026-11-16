# UI: the extrusion

Part of [ui.md](../ui.md); how to read the tables is said there. The form of the extrusion.

## Extrude

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vybrat oblasti skici | | `sketch.regions` |
| Move the outline of the picked regions by an offset | UI logic (`changeExtrude`) | |
| Choose the curves of a wall in the view and its thickness | UI logic (`changeExtrude`) | own curves of the sketch |
| Choose the profile source and fill in a generator's operands, parameters and references | UI logic (`changeExtrude`) | `GENERATORS`; entities of the sketch; earlier extrusions |
| Show what the generator built | | `evaluation.features[id].facts` |
| Navrhnout výchozí operaci a cílové těleso | logika UI | `document` (rovina skici), `bodies` |
| Choose the extent: a distance with a start, or through all with a side | UI logic (`changeExtrude`) | |
| Taper the sides of a distance extent | UI logic (`changeExtrude`) | |
| Choose the targets: one body for an addition, several for a cut | UI logic (`changeExtrude`) | `bodies` before the feature |
| Náhled při změně hodnot | `preview(addFeature)` | |
| Potvrdit | `addFeature` (extrude) | |
| Change the extent, the operation, the regions, the targets | `updateFeature` | |

The form (D35, points 2 and 3; D44), top to bottom: profile, sketch, regions with their offset or the curves of a wall with its thickness or the generator's fields, operation, extent, targets.

- **Profile** is a select with *Sketch regions*, *Wall along curves* and one entry per profile generator (`GENERATORS`; today *Involute gear*). Regions are picked by clicking in the view; a generated profile has none and the view does not offer them.
- **Offset** (D44), for a profile of regions: a field for a number or an expression, positive grows the profile. It is empty while the draft has no offset, and emptying it removes the field from the draft (an optional numeric field: the feature then has none). An offset the outline does not survive is the problem of the preview, with the curves that vanish and what to do.
- **A wall along curves** (D44): the form shows the number of chosen curves, a button that clears them and the field *Thickness* (a new wall starts with 2 mm). In the view the own curves of the sketch are drawn (construction ones too; projected ones are not offered), the chosen ones and the one under the pointer highlighted; a click toggles the curve nearest to the point where the pointer meets the sketch plane, within the reach of a pick (`hitCurve`, the hit test of the sketch mode). Whether the curves form one chain is said by the preview. A chosen curve that is not in the sketch any more is counted in a warning. Changing the sketch drops the curves, as it drops the regions.
- **A generated profile** is a form built from the catalog entry: a select per operand listing the entities of the sketch of the accepted kinds (own curves, construction ones marked, and projected ones, with their diameter), a field per numeric parameter (a number or an expression; an angle is shown in degrees), a checkbox per flag and a select per reference listing the earlier extrusions with an accepted generator, or *(none)*. A new one starts with the first suitable entity of the sketch and the defaults of the catalog (18 teeth). Changing the sketch picks the operands again.
- Below the fields the form shows the facts of the preview (module, pitch, tip and root diameter, rotation); the same line is shown at a selected extrusion in the model panel. Warnings of the generator (`gearMesh` with its reason, `gearInterference`) appear as the problem of the preview in the warning style.
- When editing, the form sends the whole profile; a reference the draft no longer has is sent as `null`, because the patch merges with the feature, and so is the offset of a profile of regions that has none.
- The form remembers the profile of each kind the draft had last (the picked regions and their offset, the curves and the thickness of a wall, the generator's operands, parameters and references) and returns to it when the profile select comes back, as long as the sketch is the same.

- **Extent** is a select with *Distance* and *Through all*. *Through all* is enabled only for the operation *cut*; switching the operation away from a cut turns the extent back into a distance. The form remembers the distance extent the draft had last (start, distance and their expressions) and returns to it, both from the extent select and from the operation; a draft that never had one gets 10 mm from the sketch plane.
- **Distance** shows two fields, *Start* (offset of the start from the sketch plane along its normal, default 0) and *Distance*. Both take a number or an expression.
- **Taper** (D45), below them unless the profile is generated: a bare number is degrees, as for the other angles of the forms, or an expression in radians (`deg(-3)`). Positive widens away from the start. It is empty while the draft has none and emptying it removes it (an optional numeric field); a draft whose profile becomes generated drops it. A taper the far end does not survive is the problem of the preview, which says it is the far end and names the curves. When editing, the form sends `taper: null` for a draft without one, because the patch merges with the feature.
- **Through all** shows the select *Side*: *Both sides* (the default for a new one, D35 decision 13), *Along the normal*, *Against the normal*, and a hint that on a face the normal points out of the body.
- **Targets.** An addition has a select with one body. A cut has one checkbox per body that exists before the feature; a target that no longer exists stays in the list marked as missing, so that it can be unticked. Unticking every target leaves the list empty and the preview says that a cut needs a target; the form does not pick a body on its own. Switching such a draft to an addition does pick one (the last body), because the select always displays some body.
- **Problems of the preview.** An invalid command and an error of the feature are shown in the error style below the form, a warning in the warning style. An issue about bodies names them: the targets a cut missed (`noEffect`), the target a cut would remove (`emptyResult`), a missing target (`brokenReference`). The same text is used in the timeline and in the model panel.
- The model panel describes a selected extrusion by its operation, extent (distance, a non-zero start and the taper in degrees, or through all with the side), its profile (the number of regions and their offset when there is one; the thickness of a wall and its curves; the generator and its operands) and target bodies.
- A face of a wall is labelled with what tells it apart: *side of a wall (left of c5)*, *end of a wall (at p6)*.

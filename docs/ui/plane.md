# UI: the plane

Part of [ui.md](../ui.md); how to read the tables is said there. A plane of its own: offset from a base, the midplane of the base and a second plane, tilted about an axis (D60). Implemented.

## Vlastní rovina

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vybrat základ (rovina nebo rovinná stěna) | | `faces[i].planar`, `features[id].plane` |
| Náhled při zadávání posunu | `preview(addFeature)` | |
| Pick the second plane of a midplane (D60) | UI logic (the pick armed in the form) | `faces[i].planar`, `features[id].plane` |
| Add a tilt, choose its axis, type its angle (D60) | UI logic (`changeAxis` of the axis picker) | sketches before the plane, their points and lines; `faceSurfaces[i].kind` of a picked face |
| Remove the midplane or the tilt (D60) | UI logic; the patch sends `null` | |
| Draw the axis of a tilt in the preview (D60) | | `features[id].facts.axisPoint`, `axisDirection` |
| Potvrdit | `addFeature` (plane) | |
| Změnit posun, základ, the second plane or the tilt | `updateFeature` with `base`, `offset`, `midplaneWith` and `tilt` (`null` for a part the draft no longer has) | |

## The form

- **Base** as before: the form starts on a plane picked in the view or chosen from the base planes, and a click on a plane or a planar face in the view makes it the base while no other pick is armed.
- **Midplane with** (D60): the button *Midplane with… (pick)* arms a pick of the view, and the next click on a plane or a planar face makes it the second plane (the status line says so); the button then reads *Picking… (click to stop)*. With a second plane the form shows *Midplane with: <plane>*, a button *Pick another second plane*, *Remove the midplane* and a hint: the plane halfway between the base and the second plane, for planes at an angle the bisector nearer to the base.
- **Tilt** (D60): *Add a tilt* starts one about the axis X by 30°. Its rows are a heading *Tilt*, the picker of an axis (`axis-picker.ts`, as for a pattern: a base axis, a point of a sketch, a line of a sketch over the sketches before the plane, or *The axis of a round face*), the field *Tilt angle* in degrees (or an expression in radians), a hint (the plane through the axis turned from the base by the right-hand rule; the axis has to be parallel to the base) and *Remove the tilt*. Choosing *The axis of a round face* arms a pick of the view that takes only faces: a click on a cylinder, a cone or a torus makes its axis the axis of the tilt; another face is refused in the status line and the pick stays armed. An axis that is not parallel to the plane is the error of the preview (`invalidAxis` with the angle).
- **Offset** as before, along the normal of the plane after the midplane and the tilt.
- **The preview** draws the square of the plane as before and, for a tilt, the axis as a line through the square (from the facts of the feature).
- **The summary** in the model panel: the offset, "Midplane with <plane>", "Tilted by <angle in degrees, with its expression> about <axis>".
- Not offered: a field that picks the other bisector (the tilt by π/2 about the projected edge reaches it), a plane through three points.

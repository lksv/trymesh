# UI: combine and split

Part of [ui.md](../ui.md); how to read the tables is said there. The forms of the boolean of finished bodies and of the split by a plane (D56).

## Combine (D56)

| Function | Command / call | Reads |
|---|---|---|
| Choose the operation, the target and the tools | UI logic; a click on a body in the view | `bodies` before the feature |
| Keep the tools or use them up | UI logic | |
| A clearance for a difference | UI logic; a field with an expression | `FEATURE_TYPE_INFO.combine.fields` |
| Preview while the values change | `preview(addFeature)` | |
| Confirm | `addFeature` (combine) | |
| Change any of it | `updateFeature` (`clearance: null` for an empty field) | |

The button *Combine* on the toolbar opens the form (after *Pattern*). A new combine is a difference that keeps its tools, with the body selected in the view as its target (otherwise none); without two bodies the button says so. Top to bottom:

- **Operation**: *Union*, *Difference*, *Intersection*. Another operation than a difference drops the clearance from the draft.
- **Target**: a select with the bodies before the feature; a target that is gone stays listed as missing.
- **Tools**: a checkbox per body but the target; one that is gone stays listed as missing. A click on a body in the view sets the target of a new combine first and then ticks or unticks a tool.
- **Keep the tools**: ticked by default; unticked, the tool bodies leave the model with the feature.
- **Clearance** (a difference only): a number or an expression in mm; empty is none.
- **Problems of the preview** use the texts of the engine: `invalidClearance` with its detail and the faces of the tool ("a clearance of 0.0001 mm is under ten precisions of the coordinates", "the moved c/side/cL1 comes within 0.25 mm of c/side/cL5", the faces by their keys), after which the app names the tool and the faces ("C, C – bok, C – bok"), `kernelFailure` and `emptyResult` with the tool, `noEffect` with the tools that missed.

A selected combine highlights the faces of its pockets (those with its tag); the model panel says the operation, the target, the tools, whether they are kept and the clearance with its expression. A face of a pocket is named in labels as "Motor – bok, in the pocket of tool 1 of Pocket". A combine has no body of its own, so its eye on the timeline is disabled.

## Split (D56)

| Function | Command / call | Reads |
|---|---|---|
| Choose the body | UI logic; a click on a body in the view | `bodies` before the feature |
| Pick the plane: a plane or a planar face in the view | UI logic | the pick of the view |
| Choose which part becomes the new body | UI logic | |
| Preview, confirm, change | `preview(addFeature)`, `addFeature` (split), `updateFeature` | |

The button *Split* opens the form (after *Combine*). A new split takes the body selected in the view or the latest one, the plane XY until another is picked, and the part behind the plane as the new body; the pick of the plane is armed when the form opens. Top to bottom: **Body** (a select), **Plane** (its text and the button *Pick*, which arms the pick again; a face the split itself makes is refused), **New body** (*The part in front of the plane*, *The part behind the plane*). A plane that does not cut the body is shown as the problem of the preview.

A selected split highlights its cut face; the model panel says the body, the plane and the new body, and lists the later features that still name only the body (they reach the part that kept the ID). The split has a body of its own, so its eye on the timeline is enabled.

**Implementation status**: implemented (D56, branch `d36/3d`), covered by `packages/app/test/app.test.ts` (snapshot `combine-split.txt`) and `packages/app/test/issue-text.test.ts`.

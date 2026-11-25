# UI: the chamfer and the fillet of edges

Part of [ui.md](../ui.md); how to read the tables is said there. The form of the chamfer and of the fillet of edges (D63); the engine side is [architecture/edge-blend.md](../architecture/edge-blend.md).

## Chamfer and fillet (D63)

| Function | Command / call | Reads |
|---|---|---|
| Pick the edges in the view from the body before the feature, or take one out of the list by a click | UI logic (`edge-picker.ts`); the view shows the state before the feature while picking | `evaluation.bodies[body].edges` (name, kind) of the state before the feature |
| Remove an edge by its button | UI logic | |
| The distance or the radius | UI logic; a field with an expression | `FEATURE_TYPE_INFO.chamfer.fields`, `FEATURE_TYPE_INFO.fillet.fields` |
| Preview while the values change | `preview(addFeature)` | `evaluation.features[id].facts` (`setback/<i>`, `cut/<i>`) |
| Confirm | `addFeature` (chamfer or fillet) | |
| Change any of it | `updateFeature` (the body, the edges whole, the size) | |

The buttons *Chamfer* and *Fillet* on the toolbar (after *Hole*) open the form; a feature on the timeline is edited by a double click like every other. A new one takes the edge selected in the view when it is straight or circular (its body with it), otherwise no edge yet and the body selected or the latest one; without a body the button says one is needed. Picking is armed when the form opens. Top to bottom:

- **Body**: the body of the edges ("the body of the first edge picked" while the list is empty).
- **The list of edges**, numbered as the faces are: each by the labels of its two faces ("Plate – opposite cap × Plate – side"), its kind ("straight", "circular"; "not on the body" for an edge the state before the feature does not have) and the keys of its faces, with a button *Remove*.
- **Pick edges** arms and disarms the picking. While it is armed the view shows the model before the feature with the picked edges drawn over it: a click on an edge adds it, a click on a picked one takes it out; the first edge sets the body; an edge of another body, or of a kind other than straight and circular, is refused at the click with a line in the status bar. Disarmed, the view shows the preview, where the picked edges are gone.
- **Distance** (mm, along both faces) or **Radius** (mm): a number or an expression.
- A hint: each edge gets a face of its own named by its place in the list; an edge that runs on smoothly into another needs that one too; a convex and a concave edge that meet go into two features. When an edited feature's list changed so that edges moved and a later feature names a face of this one, a warning says which features.
- **The facts**: the setbacks of the preview ("Setbacks 2, 2.31 mm") and how many concave edges got material added.
- **Problems of the preview** use the texts of the engine, `unsupportedEdge` and `blendDoesNotFit` with their details, after which the app names the edges by the labels of their faces and the faces ("the edge Plate – opposite cap × Plate – side, the face Plate – side"). The refusals of an edge that ends at a round face (D67: a stop, a bridge, a crossing under 10°, a void check) name that face in refs, so the app names it by its label too; their details say what to do (chamfer the edge before the feature that makes that face, or use a smaller size).

A selected chamfer or fillet highlights its faces (the role of its type with its ID); the model panel says "Chamfer of 2 edges of Plate, distance 2 mm." and the setbacks. It has no body of its own, so its eye on the timeline is disabled. A face of it is labelled "Chamfer 1 – chamfer of edge 1".

**Implementation status**: implemented (D63, branch `d36/4b`), covered by `packages/app/test/app.test.ts` (snapshot `chamfer-fillet.txt`). D67 (branch `d36/4c`) changes nothing in the form: more edges are accepted (those that run out past a round face) and the texts of the engine it prints are new; the snapshots are unchanged. Not done: picking a whole tangent chain by one click, drawing the edges of a selected feature that is not being edited.

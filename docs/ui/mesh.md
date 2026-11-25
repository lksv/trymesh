# UI: the mesh feature

Part of [ui.md](../ui.md); how to read the tables is said there. A bought part read from an STL file and placed as a body (D55, [the design](../d36/3b-mesh-import/design.md)).

## Mesh (D55)

| Function | Command / call | Reads |
|---|---|---|
| Start (the button *Mesh*) | a draft of a mesh feature on XY with the latest stored mesh; without a stored mesh the form opens with the choice of a file | `document.meshes` |
| Import a file (*Import a file…* in the form) | `importMesh('stl', bytes, {}, file name)` in the browser, then `addMesh` (one undo step) under an ID from the name of the file; the draft then uses it | `IMPORT_FORMATS`, `importFormatOf`; the report or the refusal in the status line |
| Choose the stored mesh | the draft | `evaluation.meshes[id]` (name, triangles) |
| Choose the frame: a base plane, a plane feature, a point of a sketch (the sketch and the point by selects), or *Pick* a plane or a planar face in the view | the draft | `features`, the points of a sketch and of its projected geometry |
| Offsets x, y, z and turns rx, ry, rz (numbers or expressions) | `preview(addFeature)` | `features[id].facts` (`origin`, `axisX`, `axisZ` shown below the fields), `values` for the note of an expression |
| *A bought part* (checked for a new feature) | — | |
| Confirm | a new feature: `batch [addFeature, setBodyProperties { use: 'reference' }]`, or `addFeature` alone with the box cleared; an edit: `updateFeature { mesh, placement }`, a number at zero removed with `null` | |
| The line of the feature in the model panel | | the stored mesh with its triangles, the frame and the numbers it has |
| The stored meshes in the model panel; *Remove* of one nothing places | `removeMesh` | `evaluation.meshes` (name, ID, triangles, size, `usedBy`) |

## Implementation status

- Implemented as in the table (`packages/app/src/features/mesh.ts`, `panels/meshes.ts`), tested by `packages/app/test/app.test.ts` (snapshot `mesh.txt`).
- A point of a sketch is chosen by two selects (the sketch, the point), not by the picker of an axis the design names: the picker chooses an axis, and a frame needs only the point.
- A draft that is cancelled leaves the stored mesh; it is listed in the model panel as not placed and can be removed (or undone).
- The view draws the body as any body; it has no edge lines. Not yet tried in a browser with a large file.

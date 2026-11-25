# UI: the model, the file and the timeline

Part of [ui.md](../ui.md); how to read the tables is said there. Opening and saving, undo, the view of the model, the timeline.

## File and history of edits

| Function | Command / call | Reads |
|---|---|---|
| New document | `load` with an empty document | |
| Save | `save()` | |
| Open | `load(json)` | |
| Export of a mesh | `exportMesh('stl')`: the printed bodies (D48) | `printedBodies(evaluation.bodyProperties)` enables the button |
| Export of one body | `exportMesh('stl', [body])` | `bodyFileName(body)` for the file name |
| Export in a format of the catalog (D54) | `export(format, options, { at })`, the menu *Export…* and its form ([bodies.md](bodies.md#the-export-form-d54)) | `EXPORT_FORMATS` |
| Undo, redo | `undo()`, `redo()` | `canUndo`, `canRedo` |
| Stored meshes (D55): a line each, *Remove* of one nothing places | `removeMesh` | `evaluation.meshes`; see [mesh.md](mesh.md) |
| Stored documents (D62): a line each with what inserts it, *Replace…* from a file, *Remove* of one nothing inserts | `replaceDocument`, `removeDocument` | `evaluation.documents`; see [insert.md](insert.md) |
| Redraw after a change | `subscribe(listener)` | the whole `EngineState` |


## The view of the model

| Function | Command / call | Reads |
|---|---|---|
| Draw the bodies | | `bodies[id].solid`; the colour and the use of `bodyProperties[id]` (D48); in the model mode the transform of its link, `mechanism.links[id].transform` (D49, [mechanism.md](mechanism.md)) |
| Draw the outlines | | `bodies[id].edges[i].segments` (line segments; edges of the kind `coplanar` are not drawn), moved by the transform of the link of the body (D49) |
| Draw the sketches in 3D | | `features[id].plane`, `sketch.points`, `sketch.radii`, `document` (curves) |
| Draw the planes | | `features[id].plane` |
| Highlight and select a face | | the index of a triangle → `solid.faceIds` → `evaluation.faceNames`, `faces[i].planar` |
| Highlight and select an edge | | `edges[i].name`, `edges[i].kind`, `edges[i].segments` |
| Highlight and select a region of a sketch | | `sketch.regions[i].ref`, `.loops` |
| Highlight and select an entity of a sketch | | `sketch.points`, `document` (curves); the UI does the hit test |
| Hide and show a body, a sketch, a plane | UI state | |
| Save a picture of the model | `savePicture` over the view (`View.image`) | the state shown, the bodies that are not hidden (where the view draws them: in the pose or as modelled, D49), the answer of a shown section |
| The pose of the mechanism in the view | UI state | `evaluation.mechanism` of the shown state; see [mechanism.md](mechanism.md) |


## Timeline

| Function | Command / call | Reads |
|---|---|---|
| Show the list of features | | `document.features` |
| Show the state of a feature (ok, warning, error, suppressed) | | `features[id].status`, `.error` |
| Insert a feature at a position | `addFeature` with a position | |
| The position marker (where features are inserted) | UI state | |
| Show the model at the moment of a feature | `getState(at)` | |
| Edit a feature | `updateFeature`, sketch commands | `getState(at)` |
| Rename | `renameFeature` | |
| Suppress and unsuppress | `setSuppressed` | |
| Move | `moveFeature` | |
| Delete (dependent features stay in error) | `removeFeature` | |

## Implementation status

What the app (`packages/app`) does differently from the tables above, or beyond them:

- **The link to the AI (D33)**: the button *AI* on the toolbar connects the app to the MCP server. While it is connected, the AI reads and changes the open document; its changes are ordinary commands and can be undone by *Undo*. An extrusion or a plane in progress is cancelled when the AI makes a change. Whether a call changes the document is asked of the MCP package (`changesDocument`): an `execute` or a `sketch_tool` that would be refused or that leaves the content of the document as it is, a `sketch_tool` with `preview`, and an undo with nothing to undo leave the operation in progress alone.
- **Visibility** is switched on the timeline and applies to the feature and to the body it created (a pattern of a body: all its copies).
- **A picture of the model (D43).** *Save picture* on the toolbar saves `model.png`, 1600 by 1200: the bodies that are not hidden, each in its own colour (the palette of `picture.ts`, in the order of the bodies), with their edges, from the camera of the view at a scale that shows at least all the window shows. It is a picture of the model, not of the screen: the selection, the sketches, the planes and the dimensions are not in it. While the section view shows a cut, the picture is cut the same way, each cut filled in a darker shade of the colour of its body; the cuts of hidden bodies are left out. When the section shown is too large to fill, nothing is saved and the status bar says why. The button is disabled when no body is shown. The picture is drawn off the screen: the view does not change.
- **The pose (D49).** In the model mode the bodies, their outlines and highlights, the box *Fit all* fits and the picks are where the pose of the mechanism puts them; in a sketch and in a form the model is shown as modelled, and the status line says which of the two is shown while the document holds a pose ([mechanism.md](mechanism.md)). The panel of the mechanism is the last section of the model panel.
- **Stored meshes (D55).** The model panel lists the stored meshes of the document after the selection and the open query, above the parameters: the name, the ID, the triangles, the size and the features that place each; a mesh nothing places has *Remove*. The form of the mesh feature is in [mesh.md](mesh.md).
- **Stored documents (D62).** Below the stored meshes: the name, the ID, the features and the features that insert each, *Replace…* (a revision from a file) and, for one nothing inserts, *Remove*. The form of an insertion is in [insert.md](insert.md).
- **A picture taken by the AI** (the tool `view_image` over the connection) is drawn the same way from the arguments of the call, in the pose the state holds; the screen does not change, an open form stays, and the status bar says that a picture was taken (unless it shows an error the user has not dealt with). A picture that was refused says nothing in the app: the AI has the reason.
- The picture was run in a browser on 2026-11-15, on a plate with a ledge and a pin and on the joint of scenario 9: the named views, a cut, some bodies only, the camera of the user, and the button with a section shown. What it settled is in the design of D43 ("As implemented"): the colours and the width of the edges at the size of the picture, the size of a picture of the joint (some 100 000 characters of base64 at 800 by 600) and the time (under 120 ms after the first).

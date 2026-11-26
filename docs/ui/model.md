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
| Mark the rows of what is under the pointer: the features on the timeline, the line of the body in the model panel | UI state | `faceNames` of the pick (`feature`, the `pattern` of the copy tags), the ID of the body (`bodyOwner`) |
| The selection for the AI (D74): the mode, the selected feature, the pick, the selected entities of a sketch, the last click (marked in the view) and the pointer | UI state, read by the operation `get_selection` over the bridge | the shown state: `faceNames`, `bodies[id].solid` and `.edges` of the pick, the solved sketch, `mechanism` for the pose |


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
- **The selection for the AI (D74).** The app gives the operation `get_selection` its selection through the member `selection` of the host it hands the bridge (`App.selection()`; the answer is described in [architecture/ai.md](../architecture/ai.md)). Every click in the view (the left button, moved no more than a drag allows; not the drop of a dragged point) is recorded before the click acts, by `spotAt` of `selection.ts` over the pick the click makes (what the model picks, with no edges while a plane is awaited and only faces while the joint form picks a face; in a form what the form picks; in a sketch the point of the sketch plane, the nearest entity and the edge or face under it), and its point is marked in the view (`View.mark`: a magenta square with a white rim over everything). The next click moves the mark; a click outside a sketch that hits nothing removes it; every Escape outside a field of the panel removes it besides its own step back; New, Open, a document loaded by the AI and the AI's `new_document` remove it (a load that fails puts it back). When the AI reads the selection and what the click named is gone (an undo, a removal), the click is reported stale and the mark is removed then. The pointer is remembered while it moves over the view and forgotten when it leaves the view (`pointerleave`); what lies under it is computed only when the AI asks. Nothing of this changes what a click selects or draws, and the status line says nothing when the AI reads the selection, as for any other question.
- **The rows of what is under the pointer (2026-11-26).** While the pointer is over a face, an edge or a plane in the view, the rows that it belongs to are marked (the class `hovered`, the look of a row under the mouse; on a selected or edited row its border still says so), and the marks go when the pointer leaves the object or the view. The rule (`pickRows` of `packages/app/src/hover.ts`): a face marks the feature that made it (`FaceName.feature`), every feature that copied it (the `pattern` of each copy tag: a pattern, or a combine with a clearance, whose pocket faces carry its tag), and the feature that made the body it lies on (the part of the body ID before the first slash: a split, a pattern of a body, a mesh, an insertion), so a face of a copy marks the feature copied and the pattern, and a cut face of a split marks the split; an edge marks the same of both its faces; a feature an insertion brought (`<insertion>/<feature>`, at any depth) marks the row of the insertion; a plane marks the row of a plane feature (the base planes have no row). A combine without a clearance has no face of its own and is not marked. The line of the body under the pointer in the model panel (of the selected feature or of the selection) is marked too. Each row is tagged with its keys as it is built (`hoverRow`); the app marks the rows in a frame (`requestAnimationFrame`) asked for once however many moves come before it, which reads what the move already picked for the highlight of the view (the hover of the model or of a form) and picks nothing itself, and touches the rows only when the set of keys changes; a rebuilt panel is marked again in the next frame. A panel (the timeline, the right panel) none of whose marked rows lies wholly in its visible part is scrolled by the smallest move that shows the first of them (`scrollIntoView({ block: 'nearest' })`), once per new set of rows, so the panels do not jump while the pointer sweeps over the model. The highlight of the view itself is unchanged: it stays on the last object when the pointer leaves the view.
- **The pose (D49).** In the model mode the bodies, their outlines and highlights, the box *Fit all* fits and the picks are where the pose of the mechanism puts them; in a sketch and in a form the model is shown as modelled, and the status line says which of the two is shown while the document holds a pose ([mechanism.md](mechanism.md)). The panel of the mechanism is the last section of the model panel.
- **Stored meshes (D55).** The model panel lists the stored meshes of the document after the selection and the open query, above the parameters: the name, the ID, the triangles, the size and the features that place each; a mesh nothing places has *Remove*. The form of the mesh feature is in [mesh.md](mesh.md).
- **Stored documents (D62).** Below the stored meshes: the name, the ID, the features and the features that insert each, *Replace…* (a revision from a file) and, for one nothing inserts, *Remove*. The form of an insertion is in [insert.md](insert.md).
- **A picture taken by the AI** (the tool `view_image` over the connection) is drawn the same way from the arguments of the call, in the pose the state holds; the screen does not change, an open form stays, and the status bar says that a picture was taken (unless it shows an error the user has not dealt with). A picture that was refused says nothing in the app: the AI has the reason.
- The picture was run in a browser on 2026-11-15, on a plate with a ledge and a pin and on the joint of scenario 9: the named views, a cut, some bodies only, the camera of the user, and the button with a section shown. What it settled is in the design of D43 ("As implemented"): the colours and the width of the edges at the size of the picture, the size of a picture of the joint (some 100 000 characters of base64 at 800 by 600) and the time (under 120 ms after the first).

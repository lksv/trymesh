# UI functions and the API they need

Status: **implemented in `packages/app`** to the extent described at the end of the files of the individual areas (`ui/`). The UI is not the focus of the PoC. The document lists the functions the UI offers and for each says what it needs from the engine. It serves to verify that the API in [architecture.md](architecture.md) is complete. The layout of the screen is not dealt with yet.

Last change: 2026-11-15

## How to read the tables

- **Command** is what the UI sends through `execute` (or `preview` for a preview).
- **Reads** is what the UI needs from `EngineState` (`document`, `evaluation`).
- **UI state** is what the engine does not know about.

## Where it is written

The functions are split by area (D37, part 5), one file per panel or form, each with the implementation status of its area at its end.

| File | What it lists | Sections |
|---|---|---|
| [ui/model.md](ui/model.md) | Opening and saving, undo, the view of the model (with the selection the AI reads and the mark of the last click, D74), the timeline | File and history of edits; The view of the model; Timeline; Implementation status |
| [ui/plane.md](ui/plane.md) | A plane of its own | A plane of its own |
| [ui/sketch.md](ui/sketch.md) | Starting a sketch, drawing (with the fillet and the re-point of D52, trim, extend and split of D65, mirror and pattern entries of D68, projection from another sketch of D69, the spline of D70, *Import an outline…* and the row of an outline with *Replace file…* of D72; of D73 the order of the IDs of the rectangle, its other inputs being for MCP), constraints and dimensions | Sketch: creation; Sketch: drawing; Sketch: constraints and dimensions; Implementation status |
| [ui/extrude.md](ui/extrude.md) | The form of the extrusion, its start at a plane or a face (D66) | Extrude |
| [ui/hole.md](ui/hole.md) | The form of the hole, with the sizes from the catalogs | Hole (D46) |
| [ui/revolve.md](ui/revolve.md) | The form of the revolve: the profile, the axis, a whole turn or an angle | Revolve (D58) |
| [ui/chamfer-fillet.md](ui/chamfer-fillet.md) | The form of the chamfer and of the fillet of edges: the edges picked in the view, the size | Chamfer and fillet (D63) |
| [ui/pattern.md](ui/pattern.md) | The form of the pattern: circular, linear, mirror | Pattern (D35, point 4; the linear pattern and the mirror D53) |
| [ui/combine.md](ui/combine.md) | The forms of the boolean of bodies (with the clearance) and of the split | Combine (D56); Split (D56) |
| [ui/bodies.md](ui/bodies.md) | Collisions, volume and export; the properties of a body; the export form | Bodies: collisions, volume and export (D35, point 5); The properties of a body (D48); The export form (D54) |
| [ui/mesh.md](ui/mesh.md) | The form of a placed mesh and the import of an STL file | Mesh (D55); Implementation status |
| [ui/insert.md](ui/insert.md) | The form of an inserted document, a document file read into a stored one, the stored documents in the model panel | Insert (D62); Implementation status |
| [ui/mechanism.md](ui/mechanism.md) | The mechanism panel: links, joints, the pose and its slider, the view in the pose | The mechanism (D49); The view in the pose (D49); Implementation status |
| [ui/queries.md](ui/queries.md) | The generic form of a query, measuring, the views of queries | Queries (D39); The section view (D38); The gap view (D40); The print view (D42); Implementation status |
| [ui/parameters.md](ui/parameters.md) | Parameters, checks and fields with an expression | Parameters, checks and expressions (D35, point 1); Implementation status |
| [ui/errors.md](ui/errors.md) | Errors of features and the repair of references | Errors and the repair of references; Implementation status |

A new panel or form gets a file of its own and a row here.

## Gaps found while putting it together

These requirements were missing from the original design of the API and have been added to the architecture (D24):

1. The compound command `batch`, so that one action of the user is one step of undo.
2. `addFeature` with a position, for inserting into the middle of the log.
3. `getState(at)` for showing the model at the moment of the feature being edited.
4. Construction geometry (`construction` on a curve, `setConstruction`).
5. Data for selection: whether faces are planar, edges with their segments and kind, regions of a sketch with their loops.
6. Rules of deletion: in a sketch it cascades, on the timeline it does not.
7. `renameFeature`, `updateFeature`, `setSketchPlane`.

8. `updateExternal`: repairing a projected edge keeps its ID, so the constraints on it stay.
9. The UI generates the IDs of new entities and sends them in the commands, so that a batch can refer to entities it has just created.
10. `updateFeature` can change the source sketch, so that an extrude can be repaired after its sketch is deleted without losing its ID.
11. A projection carries `kind`, so both the commands and the loading of a document can be validated without a recompute.

## Left out on purpose

- How constrained each entity of a sketch is (the engine reports the degrees of freedom only for the whole sketch).
- Manipulators in 3D (dragging the arrow of an extrude).
- Trimming and extending curves, mirror, pattern.
- Visibility stored in the document.

## Implementation status

The app (`packages/app`, decided in D31) offers every function of the tables in `ui/`. Where it differs from a table, or does more, is said at the end of the file of that area ("Implementation status"). For the whole app:

- UI texts are in English (owner's instruction of 2026-11-14 for all new text in the repository; the older Czech texts were translated on 2026-11-25).

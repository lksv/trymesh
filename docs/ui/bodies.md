# UI: bodies

Part of [ui.md](../ui.md); how to read the tables is said there. Collisions, volume and export; the properties of a body; the export form (D54).

## Bodies: collisions, volume and export (D35, point 5)

| Function | Command / call | Reads |
|---|---|---|
| Check collisions | `engine.query('interference', {}, { at })` | `pairs` (with `mismatch`, D76), `fits`, `cleared`, `failed`, `threaded` (D76), `checked` |
| Highlight a colliding pair | UI state | the two bodies of the pair |
| Volume and size of a body | | `bodies[id].volume`, `bodies[id].bounds` |
| Export one body | `exportMesh('stl', [body])` | `features[id].bodies`, `bodyFileName` |

- **Collisions** is a button on the toolbar of the model, enabled with two or more bodies. It asks about the state the view shows (the whole model, or the model at the insertion marker) and writes the outcome to the status bar: the number of colliding pairs in the error style, or that nothing collides and how many pairs were checked.
- Since D39 the collisions are the query `interference` in the generic form of a query ([queries.md](queries.md)), with a view of its own: the button opens the form and asks at once. The model panel then has the section *Interference*, with the two optional arguments of the query, the buttons *Ask again* and *Close*, and one row per pair: the two bodies and the shared volume. A click on a row highlights the two bodies in the view (one orange, one red); another click removes the highlight. Below the collisions the section lists the fits, marked "fit", with one sentence on what a fit is (round faces that reach into each other by no more than the chord tolerance, as a pin in a hole of the same diameter has); they do not count as collisions in the heading or in the status bar, which only mentions their number. The tooltip of a row gives the depth: how deep one body reaches into the other. Pairs the kernel could not verify are listed as warnings with its message (since D50: "not verified, neither colliding nor clear", with what it computed when it measured the pair). *Check again* repeats the query, *Close* removes the section. The note in the status bar goes away with the answer when the document changes.
- The answer belongs to the document and the state it was computed for: any change of the document, or moving the insertion marker, hides it.
- **Cleared pairs (D50).** A pair the kernel refused to verify and whose intersection as computed shows no collision (`cleared`) is a row of its own after the fits, under one sentence ("Cleared by a mesh the kernel did not verify: …"): the two bodies and *cleared: a fit, 0.031 mm³* or *cleared: shares nothing*; a click highlights its two bodies like any row. The note in the status bar counts them. A refused pair that measures as a collision stays among the warnings, its message with what was measured. Implemented 2026-11-16 with D50 and tested over answers written by hand (`packages/app/test/query-interference.test.ts`); no model of `app.test.ts` has a refused pair, so its snapshots did not change. Not run in a browser.
- **Threaded pairs (D76).** The pairs a cosmetic thread accounts for (`threaded`: a screw in a tapped hole) are a third group after the cleared ones, under one sentence ("Threaded: a part of what these pairs share is what a thread accounts for …"): the two bodies and *threaded, 68.93 mm³ excused*; a click highlights them like any row, and the note in the status bar counts them. A collision of two threads that do not agree says what differs in its row ("; the threads do not agree: a left-hand thread in a right-hand one"). Tested over an answer written by hand (`packages/app/test/query-interference.test.ts`); not run in a browser.
- **In the pose (D49).** The collisions are asked about the state shown, so in the pose of the mechanism, and a picked pair is highlighted where the pose puts its two bodies. *As modelled* in the form asks about the model as modelled. A body whose link is blocked makes the query fail with the message of the engine ([mechanism.md](mechanism.md)).
- **Body lines.** A selected feature that created bodies (an extrusion with a new body, a pattern of a body) lists them in the model panel, one line each: name, volume, the size of its box and the link *Export STL*, which saves that body alone under the name `bodyFileName(id).stl` (`planets%2F1.stl`). A selected face or edge shows the same line for its body. The export takes the body as it is at the end of the timeline; a body that exists only in a preview cannot be exported.
- *Export STL* on the toolbar saves the printed bodies into one file (D48: the bodies with the use *Printed part*); it is disabled when the model has none. A reference or auxiliary body is exported by the link of its line.
- After either *Export STL*, the status line names the exported bodies that have cosmetic threads, which the mesh does not carry (D76: *Exported model.stl. body "plate": 6 cosmetic threads (M6), not in the mesh: tap or cut them after printing.*); it says nothing when none has.

## The properties of a body (D48)

| Function | Command / call | Reads |
|---|---|---|
| Name, colour, use, material label, density, mass of a body | `setBodyProperties { body, patch }`, one command per change; an empty field sends `null` | `document.bodyProperties[id]`, `evaluation.bodyProperties[id]` |
| Material from the catalog | `setBodyMaterial { body, material }` | `DATA_CATALOGS.materials` |
| Clear the properties of a body | `removeBodyProperties { body }` | |
| The line of a body | | `evaluation.bodyProperties[id]`: name, use, material, mass |
| Entries whose body is gone, with *Remove* | `removeBodyProperties` | `bodyPropertiesWithoutBody(document.bodyProperties, evaluation.bodyProperties)` |
| A body in its colour, an auxiliary body see-through | | `evaluation.bodyProperties[id].color`, `.use` |

- **The form** *Properties of …* is shown for the body of a face or an edge selected in the view, and for a selected feature that created one body. Fields: *Name* (empty: the name of the feature, shown as a placeholder), *Use* (*Default* or, for a copy, *As its source*, then *Printed part*, *Reference part (not printed)*, *Auxiliary (no mass, not printed)*), *Material from the catalog* (a select of the rows with their densities; the title of a row names its data sheet; choosing one sends `setBodyMaterial`), *Material* (a label of one's own), *Density (g/cm3)* and *Mass (g)* (numbers or expressions over the parameters, with the value next to an expression; an empty field removes the value; what the body has without a value of its own, inherited or worked out from the density, is the placeholder), *Colour* (a colour control; *Default* removes the own colour). An error of an expression of the body is shown under the fields. *Clear the properties* removes the entry. A copy of a pattern says which body it takes after.
- **The line of a body** (a selected feature, a selected face or edge) reads `Name [reference]: PETG, 280 g, 12000 mm³, 40 × 30 × 10 mm`: the name of its properties, a mark of a reference or auxiliary body, the material and the mass when it has them.
- **Names.** Wherever the app names a body (the line, the targets of a feature, the bodies an issue names) it takes the name of its properties: its own name, else that of the feature, a copy with ` / <number>`.
- **The view** draws a body in the colour of its properties and an auxiliary body see-through (opacity 0.35). A picture of the model (D43) keeps its palette, which tells the bodies apart.
- **Properties without a body.** Below the selection the panel lists the entries whose body is not in the model (*Properties without a body*), each with *Remove*; a body made again under the same ID would take the entry over.
- **Status line.** A command of the app that adds a feature or an entity under an ID an entry still names says that the ID is used again and that a body made under it takes those properties (`takenOver`); the generator of IDs of the app (`newId`) does not hand such an ID out.

### Implementation status

Implemented on the branch `d36/3a`; the form is driven by `packages/app/test/app.test.ts` (snapshot `properties.txt`). Not run in a browser.

## The export form (D54)

| Function | Command / call | Reads |
|---|---|---|
| The menu *Export…* | | `EXPORT_FORMATS`: the title and the summary of every format |
| The form of a format | | `EXPORT_FORMATS[format].options` (`ArgSpecs`), the controls of the query form |
| A plane or a face picked into the armed option | UI state | the pick of the view, as in the query form |
| *Export* | `engine.export(format, options, marker ? { at: marker } : {})` | `Exported`: `layout`, `files`, `empty`, `notes` |
| Save one file | download under `files[0].path` with its `mediaType` | |
| Save a set | `zip(files)`, stored (no compressor: D54, deflate.md, the second question), downloaded as `<format>.zip` (`application/zip`) | |

- **The menu.** In the model mode the toolbar has the menu *Export…* beside *Queries…*, with every format of the catalog of the engine by its title (`STL`, `3MF`, `DXF (outline)`, `SVG (outline)`; the summary is the tooltip). A format needs nothing in the app to be there. The button *Export STL* and the link of a body line stay as they are.
- **The form** *Export: <title>* takes the place of the query form in the model panel: one of the two is open at a time, and opening one closes the other. It is the generic form of a query over the options of the format (`panels/args.ts`, shared with `panels/query.ts`): the same control per kind of option, the first option that takes a pick armed (the plane of an outline), a plane or a planar face clicked in the view goes to it and not to the selection. *Export* and *Close*.
- ***Export*** exports the state the view shows: with `at` when the insertion marker is after a feature, without it at the end of the timeline. One file is saved under its suggested name (`outline.dxf`, `model.3mf`, whose items the engine deflated with the compressor `main.ts` gives it, D54); a set (`stl` with *A file per body*) is saved as one ZIP `<format>.zip` of the files under their paths, because a browser cannot write a folder. The status line says `Exported <name> (<size> bytes).`, followed by the notes of the export (D76: the written bodies with cosmetic threads), joined by `; `.
- **What is not saved.** A refusal of the engine, the text of an export with nothing in it (`the plane cuts none of the bodies`, `the model has no printed body …`), and a set the ZIP cannot hold (a path over 65 489 bytes, possible because a body ID has no limit of length) stay in the form under the buttons and in the status line, as an error; the row of the option a refusal names is marked with the message as its tooltip. They stay until the next *Export*.

### Implementation status

Implemented on the branch `d36/2g`; the form is driven by `packages/app/test/app.test.ts` (snapshot `export.txt`) and `packages/app/test/export-form.test.ts`. Not run in a browser.

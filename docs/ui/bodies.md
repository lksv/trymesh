# UI: bodies

Part of [ui.md](../ui.md); how to read the tables is said there. Collisions, volume and export.

## Bodies: collisions, volume and export (D35, point 5)

| Function | Command / call | Reads |
|---|---|---|
| Check collisions | `engine.query('interference', {}, { at })` | `pairs`, `fits`, `failed`, `checked` |
| Highlight a colliding pair | UI state | the two bodies of the pair |
| Volume and size of a body | | `bodies[id].volume`, `bodies[id].bounds` |
| Export one body | `exportMesh('stl', [body])` | `features[id].bodies`, `bodyFileName` |

- **Collisions** is a button on the toolbar of the model, enabled with two or more bodies. It asks about the state the view shows (the whole model, or the model at the insertion marker) and writes the outcome to the status bar: the number of colliding pairs in the error style, or that nothing collides and how many pairs were checked.
- Since D39 the collisions are the query `interference` in the generic form of a query ([queries.md](queries.md)), with a view of its own: the button opens the form and asks at once. The model panel then has the section *Interference*, with the two optional arguments of the query, the buttons *Ask again* and *Close*, and one row per pair: the two bodies and the shared volume. A click on a row highlights the two bodies in the view (one orange, one red); another click removes the highlight. Below the collisions the section lists the fits, marked "fit", with one sentence on what a fit is (round faces that reach into each other by no more than the chord tolerance, as a pin in a hole of the same diameter has); they do not count as collisions in the heading or in the status bar, which only mentions their number. The tooltip of a row gives the depth: how deep one body reaches into the other. Pairs the kernel could not compute are listed as warnings with its message. *Check again* repeats the query, *Close* removes the section. The note in the status bar goes away with the answer when the document changes.
- The answer belongs to the document and the state it was computed for: any change of the document, or moving the insertion marker, hides it.
- **Body lines.** A selected feature that created bodies (an extrusion with a new body, a pattern of a body) lists them in the model panel, one line each: name, volume, the size of its box and the link *Export STL*, which saves that body alone under the name `bodyFileName(id).stl` (`planets%2F1.stl`). A selected face or edge shows the same line for its body. The export takes the body as it is at the end of the timeline; a body that exists only in a preview cannot be exported.
- *Export STL* on the toolbar still saves the whole model into one file.

# UI: the model, the file and the timeline

Part of [ui.md](../ui.md); how to read the tables is said there. Opening and saving, undo, the view of the model, the timeline.

## Soubor a historie úprav

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Nový dokument | `load` s prázdným dokumentem | |
| Uložit | `save()` | |
| Otevřít | `load(json)` | |
| Export sítě | `exportMesh('stl')`: the printed bodies (D48) | `printedBodies(evaluation.bodyProperties)` enables the button |
| Export of one body | `exportMesh('stl', [body])` | `bodyFileName(body)` for the file name |
| Undo, redo | `undo()`, `redo()` | `canUndo`, `canRedo` |
| Překreslení po změně | `subscribe(listener)` | celý `EngineState` |


## Zobrazení modelu

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vykreslit tělesa | | `bodies[id].solid`; the colour and the use of `bodyProperties[id]` (D48) |
| Vykreslit obrysy | | `bodies[id].edges[i].segments` (úsečky; hrany druhu `coplanar` se nekreslí) |
| Vykreslit skici ve 3D | | `features[id].plane`, `sketch.points`, `sketch.radii`, `document` (křivky) |
| Vykreslit roviny | | `features[id].plane` |
| Zvýraznit a vybrat stěnu | | index trojúhelníku → `solid.faceIds` → `evaluation.faceNames`, `faces[i].planar` |
| Zvýraznit a vybrat hranu | | `edges[i].name`, `edges[i].kind`, `edges[i].segments` |
| Zvýraznit a vybrat oblast skici | | `sketch.regions[i].ref`, `.loops` |
| Zvýraznit a vybrat entitu skici | | `sketch.points`, `document` (křivky); test zásahu dělá UI |
| Skrýt a zobrazit těleso, skicu, rovinu | stav UI | |
| Save a picture of the model | `savePicture` over the view (`View.image`) | the state shown, the bodies that are not hidden, the answer of a shown section |


## Časová osa

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Zobrazit seznam features | | `document.features` |
| Zobrazit stav feature (ok, varování, chyba, potlačená) | | `features[id].status`, `.error` |
| Vložit feature na pozici | `addFeature` s pozicí | |
| Značka pozice (kam se vkládá) | stav UI | |
| Zobrazit model v okamžiku feature | `getState(at)` | |
| Upravit feature | `updateFeature`, příkazy skici | `getState(at)` |
| Přejmenovat | `renameFeature` | |
| Potlačit a obnovit | `setSuppressed` | |
| Přesunout | `moveFeature` | |
| Smazat (závislé zůstanou v chybě) | `removeFeature` | |

## Implementation status

What the app (`packages/app`) does differently from the tables above, or beyond them:

- **Propojení s AI (D33)**: tlačítko AI na liště připojí aplikaci k MCP serveru. Dokud je připojená, AI čte a mění otevřený dokument; její změny jsou běžné příkazy a jdou vrátit přes Zpět. Rozpracované vysunutí nebo rovina se při změně od AI zruší. Whether a call changes the document is asked of the MCP package (`changesDocument`): an `execute` or a `sketch_tool` that would be refused or that leaves the content of the document as it is, a `sketch_tool` with `preview`, and an undo with nothing to undo leave the operation in progress alone.
- **Viditelnost** se přepíná na časové ose a platí pro feature i těleso, které založila (a pattern of a body: all its copies).
- **A picture of the model (D43).** *Save picture* on the toolbar saves `model.png`, 1600 by 1200: the bodies that are not hidden, each in its own colour (the palette of `picture.ts`, in the order of the bodies), with their edges, from the camera of the view at a scale that shows at least all the window shows. It is a picture of the model, not of the screen: the selection, the sketches, the planes and the dimensions are not in it. While the section view shows a cut, the picture is cut the same way, each cut filled in a darker shade of the colour of its body; the cuts of hidden bodies are left out. When the section shown is too large to fill, nothing is saved and the status bar says why. The button is disabled when no body is shown. The picture is drawn off the screen: the view does not change.
- **A picture taken by the AI** (the tool `view_image` over the connection) is drawn the same way from the arguments of the call; the screen does not change, an open form stays, and the status bar says that a picture was taken (unless it shows an error the user has not dealt with). A picture that was refused says nothing in the app: the AI has the reason.
- The picture was run in a browser on 2026-11-15, on a plate with a ledge and a pin and on the joint of scenario 9: the named views, a cut, some bodies only, the camera of the user, and the button with a section shown. What it settled is in the design of D43 ("As implemented"): the colours and the width of the edges at the size of the picture, the size of a picture of the joint (some 100 000 characters of base64 at 800 by 600) and the time (under 120 ms after the first).

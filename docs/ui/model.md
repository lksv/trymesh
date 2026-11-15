# UI: the model, the file and the timeline

Part of [ui.md](../ui.md); how to read the tables is said there. Opening and saving, undo, the view of the model, the timeline.

## Soubor a historie úprav

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Nový dokument | `load` s prázdným dokumentem | |
| Uložit | `save()` | |
| Otevřít | `load(json)` | |
| Export sítě | `exportMesh('stl')` | |
| Export of one body | `exportMesh('stl', [body])` | `bodyFileName(body)` for the file name |
| Undo, redo | `undo()`, `redo()` | `canUndo`, `canRedo` |
| Překreslení po změně | `subscribe(listener)` | celý `EngineState` |


## Zobrazení modelu

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vykreslit tělesa | | `bodies[id].solid` |
| Vykreslit obrysy | | `bodies[id].edges[i].segments` (úsečky; hrany druhu `coplanar` se nekreslí) |
| Vykreslit skici ve 3D | | `features[id].plane`, `sketch.points`, `sketch.radii`, `document` (křivky) |
| Vykreslit roviny | | `features[id].plane` |
| Zvýraznit a vybrat stěnu | | index trojúhelníku → `solid.faceIds` → `evaluation.faceNames`, `faces[i].planar` |
| Zvýraznit a vybrat hranu | | `edges[i].name`, `edges[i].kind`, `edges[i].segments` |
| Zvýraznit a vybrat oblast skici | | `sketch.regions[i].ref`, `.loops` |
| Zvýraznit a vybrat entitu skici | | `sketch.points`, `document` (křivky); test zásahu dělá UI |
| Skrýt a zobrazit těleso, skicu, rovinu | stav UI | |


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

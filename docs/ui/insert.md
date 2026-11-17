# UI: the inserted document

Part of [ui.md](../ui.md); how to read the tables is said there. Another document stored inside this one and inserted as a part (D62, [the design](../d36/3c-document-insert/design.md), [architecture/insert.md](../architecture/insert.md)).

## Insert (D62)

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Start (the button *Insert*) | a draft of an insertion on XY (or the plane of the selection) with the latest stored document; without a stored document the form opens with the choice of a file | `document.documents` |
| Insert a file (*Insert a document…* in the form) | the JSON of the file read in the browser, then `addDocument` (one undo step) under an ID from the name of the file (`idFromFile`, `document` as the fallback), named by the file; the draft then uses it. A file that is no JSON is said in the status line; a document that does not load is refused with the path of its fault | |
| Choose the stored document | the draft; the values set are dropped | `evaluation.documents[id]` (name, features) |
| Choose the frame: a base plane, a plane feature, a point of a sketch, or *Pick* a plane or a planar face in the view (not a face of the insertion itself) | the draft | as for the mesh feature ([mesh.md](mesh.md)) |
| Offsets x, y, z and turns rx, ry, rz (numbers or expressions) | `preview(addFeature)` | `features[id].facts` (`origin`, `axisX`, `axisZ` below the fields), `values` |
| The parameters of the stored document: a field each, empty for the document's own value, which is shown beside the name and as the placeholder | the draft; `parameters/<name>` a numeric field (a number or an expression of this document) | `evaluation.documents[id].parameters`, `features[id].values` for the value used |
| The bodies that come in, as boxes (shown when the document makes two or more; all ticked is no list) | the draft | the bodies of a preview of the draft without a list, read again when the document or the values change |
| Confirm | a new feature: `addFeature` (the values and the list only when set); an edit: `updateFeature { document, placement, parameters, bodies }`, a number at zero and an emptied value removed with `null`, all ticked `bodies: null` | |
| The line of the feature in the model panel | | the stored document with its features, the frame, the numbers, the values with their expressions, the list of bodies |
| The stored documents in the model panel: a line each with the features that insert it; *Replace…* from a file; *Remove* of one nothing inserts | `replaceDocument` (keeps the name), `removeDocument` | `evaluation.documents` (name, ID, features, `usedBy`) |
| Names of inserted features in issues, faces and the parts list: the insertion and the name there, `Elbow bearing › Ring` | | `featureNameIn` of `issue-text.ts` over `document.documents` |

## Implementation status

- Implemented as in the table (`packages/app/src/features/insert.ts`, `panels/documents.ts`), tested by `packages/app/test/app.test.ts` (snapshot `insert.txt`): the button without a stored document, a file that is no document, the file stored and used, a value of a parameter, a body left out, the confirmed insertion and the name of its body, a value emptied by an edit, the deletion and the removal of the stored document.
- The warning `insertedIssues` names the features of the inserted document in error by the insertion and their name there, with the code, and the checks that fail.
- A draft that is cancelled leaves the stored document; it is listed in the model panel as not inserted and can be removed (or undone).
- The view draws inserted bodies as any body; their faces are picked and highlighted by their names, which the app compares as the engine gives them.
- Not yet tried in a browser.

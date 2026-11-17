# Inserting another document as a part (D62)

A bearing, a motor modelled elsewhere or a printed bracket from a library comes in as a part: the document of the part is stored inside the host, and a feature of the type `insert` recomputes it from its features and places its bodies. The design and its reasons are [docs/d36/3c-document-insert/design.md](../d36/3c-document-insert/design.md); this file is the design as implemented.

```ts
documents: Record<Id, StoredDocument>;           // a section of the document, `{}` when empty
interface StoredDocument { name?: string; document: Document }
interface InsertFeature extends FeatureBase {
  type: 'insert';
  document: Id;                                    // a key of `documents`
  placement: BodyPlacement;                        // as for a mesh feature (D55)
  parameters?: Record<string, number>;             // numeric fields `parameters/<name>`
  bodies?: Id[];                                   // which bodies come in; all without it
}
```

## The section `documents`

`sections/documents.ts`, the fourth section of the document (document.md, "Body properties and the sections of the document").

- **A copy inside the host.** The host stays one file; `save`, `load`, undo and a preview work unchanged, and the stored copy changes only by `replaceDocument`, never because the file it came from did.
- **Validated as a document is on a load**, by `validateDocument` itself: a section cannot import `document.ts`, so the validation and the commands of a section get a context (`SectionContext` of `sections/spec.ts`: `depth` and `document(value, what)`), which `document.ts` builds. `validateDocument(value, what = 'document', depth = 0)` takes the path of its messages and its level below the host, and passes the path to `upgradeDocument` (its fourth argument) and to `validateSections(o, what, context)`. The message of a fault of a stored document names its path (`document.documents.bearing.document.settings.chordTolerance: …`, `addDocument.document.features[0].type: …`); the host keeps the texts it always had (`dokument.settings`, `features[i]`). An older stored document is brought to the schema of this build from its own version by the same steps, so every later upgrade step reaches it without a word; the stored copy is the upgraded one, and `save` writes it with the version of this build. The error of a command that stores a document carries no `expression`: a parameter of a stored document is no parameter of the host.
- **Documents inside documents** down to `MAX_INSERT_DEPTH` (8) levels below the host, counted alike by a load and by the commands (the context of the host has depth 0, a stored document is validated one level deeper). It bounds the recursion, not the work.
- **Strict entries**: `name` (the rules of a body name) and `document`.
- **Commands.** `addDocument { id, document, name? }` refuses an ID the section has; `replaceDocument { id, document, name? }` (absent keeps the name, `null` removes it) needs one; `removeDocument { id }` is refused while a feature inserts it, suppressed or not. `names()` is empty and `renameParameter` leaves the section as it is.
- **The result** `evaluation.documents[id]` (`StoredDocumentResult`): the name, its own parameters with their expressions and values, the number of its features, `usedBy`. No recompute; computed once per entry object.

## The feature type `insert`

`features/insert.ts`.

- **Validation**: `document` a reference of the kind `document` (`RefKind`); the placement by `bodyPlacement` of `features/mesh.ts` (one validator for both); `parameters` a dictionary of numeric fields `parameters/<name>`, each name a parameter name and a reference of the kind `parameter` (`{ id: <name>, document }`), the keys sorted, an empty dictionary not stored; `bodies` a list of body IDs of the inserted document, not empty, none twice, each a reference of the kind `documentBody` (`{ id: <body there>, document }`): a command checks that a feature of the stored document can make it, as `setBodyProperties` of the inserted body asks; a load checks the form only. The catalog lists the fields as `placement/x` … `placement/rz` and `parameters/*` (`INSERT_FIELDS`).
- **References**: the frame, the document, one per value, one per listed body. `featureRefs` leaves out `document`, `parameter` and `documentBody`, which name no feature. `requireRef` checks `document` against the section and `parameter` against the parameters of the stored document; `updateFeature` checks only the references the feature did not have, and the identity of a reference (`refKey` of `document.ts`) includes its stored document, so pointing an insertion at another stored document checks every value and every listed body again. A value the stored document lost by `replaceDocument` stays and is an error of the recompute.
- **The patch** (`patch.dictionaries: ['parameters']`): every function of a patch in `document.ts` (`mergePatch`, `withoutNulls`, `replacedPaths`, `patchPaths`, `removedPaths`) asks one predicate, "this path is a dictionary of the module", and takes such a field key by key, without reading `kind` as a reference or `type` and `generator` as a variant (legal names of parameters). `null` removes one value; `removable` answers for the six numbers of the placement, `parameters`, every `parameters/<name>` and `bodies`. `setField` changes a value that is set.
- **Bodies**: `<feature>/<ID there>`. `createsBody` answers for every local name in the form of a body ID, or for the listed ones; `bodyProblem` and `requireRef` of a body ask further, through the stored document, that a feature there can create that body (`insertedBodyProblem` in `features/index.ts`), so `setBodyProperties { body: 'b1/typo' }` is refused. `namesFaces` true, `producesTool` false, no `bodySource`; `input` the entry of the section.

### The step

1. The entry (`input`; absent: `brokenReference` with `{ document }`), the frame (`frameOf`), the values (a name the stored document does not have: `brokenReference` with `{ parameter }`).
2. The stored document with the expression of each set parameter replaced by its value written without loss (`losslessNumber` in `recompute/insertion.ts`: the shortest text that reads back as the number, −0 as `-0`) and with the settings of the host.
3. **The environment** (`environmentText`): every parameter of that document by name in sorted order with its value (without loss) or its error. An earlier insertion in `State.insertions` of the same entry object with the same environment gives its recompute; otherwise the evaluator's callback `StepContext.insertion(doc)` computes one. So two insertions whose parameters evaluate alike are made from the same solids whatever the memo kept, and the parts list counts them as one part. A field never holds −0 (a field writes no negative zero), but a stored expression may give one, and then the environment differs from 0.
4. The chosen bodies (a listed body the recompute does not have: `brokenReference` with `{ body }`; none: `emptyResult`, "the inserted document has no body to bring").
5. **The faces**: every face number the chosen bodies have, in the order of the numbers, gets one new number, named by `insertedFaceName` (naming.md) and described by `transformFace`. One map for all bodies of the insertion.
6. **The bodies**: `placedSolid` (`recompute/insertion.ts`) moves each by the transform of the placement with `transformSolid`, which records the solid there as the origin (D57), and keeps the result by the solid there, the feature, the transform by its numbers and the new number of every face of that solid (the last four per feature, 256 features per solid there): an edit before the insertion that keeps the face table leaves the inserted bodies the same objects.
7. `State.insertions[feature]` gets `{ stored, environment, recompute }`, `State.inserted[body]` what each body passes on (below); `facts` are `origin`, `axisX`, `axisY`, `axisZ` (`placementFacts`, shared with the mesh feature).
8. **The warning `insertedIssues`**: `{ feature: <prefixed ID>, code }` per feature of the inserted document in error, the refs of the same warning of an insertion inside it carried up (a feature prefixed, a check as `{ check, in: <prefixed ID of that insertion> }`), and `{ check }` per check that fails or cannot be evaluated. Other warnings are not repeated. The bodies that are there come in.

### The recompute of a stored document

`Evaluator.insertion` (`evaluate.ts`), handed to every step as `StepContext.insertion`: `run` of the evaluator over the document the step built (its memo, its adapters; the settings are the host's object, so the state before the first feature is the host's), then the results of its checks and, per body, what it passes on (`inheritedProperties` of `sections/body-properties.ts` over the state's own `inserted`, so a kit passes on what its bearing passes). Nothing is written back: its sketches are solved from the positions it stores. Its sections are not evaluated (nothing reads them).

## Names

naming.md, "Faces of an insertion": every feature ID of a face name gets the prefix `<insertion>/` (the feature and the patterns of the tags), the key of such a face quotes the key of its name there as a JSON string (`b1/"ring/side/outer"`, `kit/"b/\"ring/endCap/@p:1\""`), the validator of a name enforces one rule of form at every level, a reference to a prefixed ID refers to its owner, which must be an insertion (`RefKind` `insertion`), and a face or an edge found by its key is taken only when its name is the name asked for (`faceNumber`, `sameEdgeName` in `util.ts`). The key of a prefixed name is kept by the name object (a weak map in `face-roles.ts`): it costs about five times a plain key, and the faces of an inserted body are keyed many times while its solid is analysed.

`insertedFeature(doc, id)` (`features/index.ts`) finds the feature behind a prefixed ID with the document it is in; `featuresWithInserted(doc)` lists every feature with those of the inserted documents at the place of their insertion, under their prefixed IDs (the parts list counts inserted holes through it).

## Body properties

`resolveChain` of `sections/body-properties.ts` resolves the chain of a body (D48) and, when the chain starts at a body an insertion brought, ends in what its document passed on (`InheritedProperties` of `recompute/state.ts`: the first colour, material and use along its chain there, and the pair with the numbers its expressions gave with the values of the insertion, before the use is applied). One function for the result of the section and for what a stored document passes on. `fromDocument` of the result is the key of the stored document when a field came from it. The name is not inherited: an inserted body is named after the insertion (its name alone when `bodies` lists one body, else `<insertion> / <name there>`, the name there by the same rules), and `partName` of an inserted body without a name of its own here is its part name there; both read the documents alone.

## Features on an inserted body

Allowed: its planar faces are planar face numbers with exact planes, as for a body modelled here. A body with a face of an imported mesh stays `importedTarget` (`isImported` reads the face table, wherever the face came from).

## MCP and the app

ai.md: `insert_document`, `get_document { stored }`, `save_document { stored, path }`, `get_model` with `documents`. ui/insert.md: the form, the stored documents in the model panel, the names of inserted features (`featureNameIn` of `issue-text.ts`).

## Known limits

As the design lists them ("Known limits"), and:

- An insertion costs the recompute of the stored document whenever the memo of the evaluator does not have it; a load validates new objects, so its first recompute misses.
- Nested insertions share a recompute only through the memo (the insertions inside two recomputes of a kit are two chains).
- One part stored twice is two rows of the parts list.
- Only bodies come in: no sketch, plane, point or mechanism of the inserted document.
- The app reads the bodies of a stored document for its boxes by one more preview of the draft without a list, when the entry of the stored document or the values change.

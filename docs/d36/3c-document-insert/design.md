# 3c Inserting another document as a part (D62)

**State: design, first version, written on 2026-11-17 against `master` at `b4c2a86` (every package of steps 1 and 2, 3a, 3e, 5a, 5e and 5f implemented; 3b, 3d, 4a, 5b, 5c and 5d designed). It builds on the design of [3b](../3b-mesh-import/design.md), whose implementation runs at the same time: the placement, `input` of a feature module and the reference kind of a section entry are taken from there. Not implemented.** Written by Claude Opus 5.5 (Fable is unavailable; owner, 2026-11-17). The scenario part was prototyped against the real adapters where a decision depended on them ("Measured").

Files: [contract.ts](contract.ts) (the section, the feature type with its patch and fields, the rule of names inside an insertion, what the recompute and the body properties add, the warning, the commands, the result, the schema step, the tool), [calls.ts](calls.ts) (its part of validation scenario 13: two ball bearings and a cable clip as inserted documents). Both are checked by `npx tsc -p docs/d36/tsconfig.json`.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), the row "Knihovna dílů, vložení jiného dokumentu": a motor, a bearing or a screw as a finished part instead of modelling it by hand; a new feature type that creates bodies from another document; the feature IDs of the inserted document need a prefix, and the validation of a reference to a face then needs the same decomposition of the ID as bodies have. An imported foreign mesh stays outside (it has no named faces; that is 3b). [D36](../../decisions/D36-order-after-d35.md), step 3: "the data cannot travel inside a command through MCP … the tool has to take a path that the server or the app reads".

| Statement | What the code says |
|---|---|
| "A feature type that creates bodies from another document" | A body is the result of a feature (`State.bodies`); a feature type is a module and a line of the registry (`features/index.ts`). A step sees the state before it, the settings and the adapters (`StepContext`), not the document; 3b adds `input`, the one object of the document outside the feature that a step reads, with the memo keyed by it as well |
| "The feature IDs of the inserted document need a prefix" | A face is named by the feature that made it and its role (`FaceName`), with a copy tag per pattern that copied it (`copy: [{ pattern, index }]`). The validator of a face name takes any text as `feature` and as `pattern` (`faceName` in `validation.ts`), so a prefixed ID `b1/ring` is a valid name today. The key of a face is `feature/role/parts` then `/@pattern:index` per tag (`faceKey`) |
| "The validation of a reference to a face then needs the decomposition of bodies" | A reference to a face checks that its `feature` is a feature that names faces (`faceSource`) and that every tag's `pattern` is a pattern, before the referring feature (`requireFace`, `faceRefs`). A body ID is decomposed at its first slash (`bodyOwner`: `screws/2` is the feature `screws` and the local name `2`; the local name may hold more slashes). The same rule on the IDs inside a face name is the change |
| A body of a document as another document's body | A pattern of a body already makes a body from a body: every face of the source gets a new number with its tag, its exact description moved (`transformFace`), the solid moved (`transformSolid`, which records what the copy was made from, `shapeOrigin`, D57). An insertion is the same operation over the bodies of another document's state |
| The document of a part | `Document` is the timeline, the parameters, the checks, and the sections `bodyProperties`, `mechanism` (and `meshes` after 3b). `validateDocument` brings an older document to the schema of this build (`upgradeDocument`, by the named steps of `UPGRADES`) and rebuilds it from the fields it knows, so an unknown top-level field is dropped without a word (probed for 3b) |
| The recompute of another document | `Evaluator.evaluate(doc)` is a pure function of a document with a memo keyed by the identity of the (resolved) feature objects and of the states (`evaluate.ts`). Measured: one evaluator evaluates a second document as it does the first, and the same document again costs nothing ("Measured", 1) |
| Body properties of a part | Resolved after the timeline by the section `bodyProperties` over the chain of sources of a body (`sourceChain`, `bodySource` of the registry), the density and the mass as a pair (D48). The section gets the final state of the recompute as an argument (D49) |
| The parts list | Rows by `shapeOrigin`, the resolved properties and `partName` (D57); hardware by the hole features of this document (`holeCounts` reads `doc.features`). 3e left to this package whether an inserted part brings its hardware and how two insertions of one document count |

## The cheap variant

A document is stored **inside** the host document, in a new section `documents`, as a whole document. A new feature type `insert` places a stored document as a part: it is **recomputed from its features** by the same evaluator, with the values the insertion gives some of its parameters, and the bodies at the end of its timeline come in, moved by the placement of 3b, with every face under its own name with the feature IDs prefixed by the ID of the insertion. Three commands (`addDocument`, `replaceDocument`, `removeDocument`), a tool of the server `insert_document` that takes a path, an insertion in the app.

What an inserted body is good for, by reader:

| Reader | Works | Note |
|---|---|---|
| The view, a picture, the exports, interference, the gap, the posed queries, `measure`, the section, mass | yes | it is a body with named faces and exact surfaces, like one modelled here |
| A sketch or a plane on a planar face of it; a placement or an extent up to it | yes | the frame a sketch on that face has in the inserted document, carried by the placement ("Measured", 3) |
| A projected edge | yes | a seat drawn from the edge of a bearing follows the bearing ("Measured", 3; calls, `seats`) |
| An extrusion, a hole or a pattern of features that changes it; a pattern of the body | yes | its planar faces are planar face numbers, so the kernel adapter keeps its guarantee for flush faces; a body with a face of an imported mesh (3b) stays `importedTarget` |
| Body properties, the mechanism (a link holds it), the parts list | yes | properties inherited from the inserted document; see "Body properties" and "The parts list" |
| A sketch, a plane, a point or the mechanism of the inserted document | no | only its bodies come in; see "Deferred" |

**Deferred**, none of them blocked by what is saved now:

- **The sketches, planes and points of the inserted document as references** (a joint axis through the centre of the motor's bolt pattern). Its faces are references already; a cylinder face gives an axis by the kind `face` of `AxisRef` (5c). It would need prefixed sketch IDs in `FrameRef` and `AxisRef` and the inserted sketches in `State.sketches`.
- **The mechanism of the inserted document** (a gearbox with a joint inside). An insertion is one rigid piece; its links and joints are not read.
- **Parameters of the inserted document in expressions of this one** (`b1.D`). The dot is reserved in names for values of the recompute; an insertion's facts would be the place.
- **A stored document kept as a file beside the host** (a path, an update when the file changes). Another variant of an entry later; see "Rejected", 1.
- **One row of the parts list per insertion** for a bought part modelled as several bodies. "Open", 3.
- **Warnings of the inserted document** beyond its errors and its checks.

## Where the code lives

```
packages/engine/src/
  types.ts                 Document.documents, StoredDocument, InsertFeature, the rule of inserted names
                           (before the marker `porty`); Evaluation.documents, StoredDocumentResult,
                           BodyPropertiesResult.fromDocument, the warning `insertedIssues`, the three
                           commands, the patch (after `přepočet`)
  sections/documents.ts    the section: validation, the three commands, the result
  sections/spec.ts, sections/index.ts
                           `validate` and the commands of a section get a context with the validator of
                           a nested document (`SectionContext.document`), built by document.ts: the
                           section cannot import document.ts, which imports the sections
  document.ts              validateDocument(value, depth) passes itself on as that context; emptyDocument
  features/insert.ts       the feature type: validation, references, the step
  recompute/insertion.ts   the names inside an insertion (`insertedFaceName`), the placed solids kept
  recompute/state.ts       State.inserted; StepContext.insertion
  evaluate.ts              `insertion` of the context: the recompute of a stored document by this
                           evaluator, its sections with results kept apart
  validation.ts            faceRefs and requireFace by the owner of a prefixed ID; the reference kind
                           `document` (RefKind, requireRef, featureRefs, REF_LABEL)
  features/index.ts        one line of the registry; the text of `bodyProblem`; `insertedFeature`
  sections/body-properties.ts
                           the chain of an inserted body ends in what its document resolved; partName
                           of an inserted body; `fromDocument`
  query/parts-list.ts      the hole features of inserted documents
  schema.ts                the step `3c-document-insert`
packages/mcp/src/          server.ts (insert_document), tools.ts (get_document, get_model)
packages/app/src/          features/insert.ts (FEATURE_UI), panels/model.ts (the stored documents),
                           issue-text.ts (the name of an inserted feature)
```

The imports go one way, in the order of the table of `docs/architecture/repository.md`: `sections/documents.ts` with `sections/*` (it validates a nested document only through the context it is given), `recompute/insertion.ts` with `recompute/*`, the module of the feature type imports `recompute/` and 3b's `recompute/placement.ts`, not the registry, `document.ts` or `evaluate.ts`; it reaches the recompute of another document only through its context.

## The section `documents`

```ts
documents: Record<Id, StoredDocument>     // in Document, always present, {} when empty

interface StoredDocument {
  name?: string;        // for people: the file it came from; the rules of a body name
  document: Document;   // a whole document, stored documents of its own included
}
```

- **Inside the document, as a copy.** The host stays the one source of truth and one file: `save`, `load`, `open_document`, `save_document`, the app's "Open" and "Save", undo and a preview work unchanged, and the engine has no input but its commands. A document is small: 1 to 8 KB for the parts tried ("Measured", 1), against a hundred kilobytes to megabytes for a mesh of a part (3b). The file it came from may change afterwards; the stored copy changes only by `replaceDocument`, so a model does not change because a file elsewhere did.
- **Validated as a document is on a load**: by `validateDocument` itself, given to the section as a context. So an older document (saved by an earlier build, or by a build without this package, as the bearing of the scenario is) is brought to the schema of this build from its own `schemaVersion` by the same upgrade steps, and the stored copy is the upgraded one. **Every later upgrade step reaches a stored document without a word**, because it is the same function; a step's author has nothing to do for it. A stored document newer than the build, or of a branch the build does not have, is refused with the host, as the host itself would be.
- **Documents inside documents** are allowed (a kit that inserts a bearing, inserted into the arm), up to `MAX_INSERT_DEPTH` (8) levels, a guard against a stack overflow from a file written by hand. A copy cannot hold itself, so there is no cycle to find. A document inserted at two levels is stored twice.
- **Keyed by an ID the caller chooses**, a namespace of its own (the document `bearing` may be inserted by the feature `bearing`).
- **Strict entries**: `name` and `document`, nothing else, on a command and on a load.

### Commands

- `addDocument { id, document, name? }`: validates `document` as a load does (the message of a refused load is the message of the invalid command) and stores it; `document` is a document as a file holds it, of any version this build reads. An ID the section has is an invalid command.
- `replaceDocument { id, document, name? }`: the same validation; the entry is replaced (`name` absent keeps the name, `null` removes it). Every insertion of it is recomputed. This is how a new revision of a part comes in: a reference to a face the revision no longer has breaks as any reference does (`brokenReference`, `brokenProjection`), a parameter or a listed body it no longer has is an error of the insertion. It is not refused for any of that: what breaks is shown where it breaks.
- `removeDocument { id }`: refused while a feature inserts it, suppressed or not; the message lists them (the rule of `removeMesh` of 3b and `removeLink` of D49).

All three are ordinary commands (`execute`, `preview`, a batch, `after` of the tools `query` and `export`), one undo step each or together with the feature in one batch.

### The result

`evaluation.documents[id]` (`StoredDocumentResult`): the name, the parameters of the stored document with their expressions and values (its own, without the values an insertion sets), the number of its features, and `usedBy`, the features that insert it. Nothing of it needs a recompute of the stored document: the bodies an insertion brought are in the result of its feature (`FeatureResult.bodies`). A document no feature inserts is listed with an empty `usedBy`.

## The feature type `insert`

```ts
interface InsertFeature extends FeatureBase {
  type: 'insert';
  document: Id;                          // a key of Document.documents
  placement: BodyPlacement;              // 3b: a frame, three offsets, three turns
  parameters?: Record<string, number>;   // values of parameters of the inserted document, numeric fields
  bodies?: Id[];                         // which of its bodies come in; all without it
}
```

- **The placement is 3b's** (`BodyPlacement`, `FrameRef`, `frameOf`, `placementTransform` of `recompute/placement.ts`, the six optional numeric fields `placement/x` … `placement/rz`): the origin and the axes of the inserted document are laid on a base plane, a plane feature, a planar face or a sketch point, turned and shifted in that frame. The facts of the result are 3b's too: `origin`, `axisX`, `axisY`, `axisZ`.
- **`document`** is checked by a command that sets it (the section has the entry) and by its form on a load; a document that is not there is the error `brokenReference` with `refs: [{ document }]`. It is a reference of a new kind, `document`, as 3b's `mesh` is: `featureRefs` leaves it out (no feature, no order on the timeline).
- **`bodies`**: without it, every body at the end of the inserted timeline, in its order; with it, the listed ones (not empty, no ID twice). A listed body the inserted document does not have in this recompute (a pattern there whose count a parameter lowered) is the error `brokenReference` with `refs: [{ body }]`, its ID there. The scenario's clip leaves out the channel its document keeps free for the cable.
- **The bodies here are `<feature>/<ID there>`** (`b1/ring`, `kit/screws/2`, `kit/b/ring`). No body has the ID of the feature alone. `createsBody(f, local)` answers for every local name in the form of a body ID, or for the listed ones only; whether the body is there is the recompute's question, as for the copies of a pattern.
- **What the entry of the registry says**: `namesFaces` true; `producesTool` false (a pattern of features cannot repeat an insertion; a pattern of an inserted body copies it like any body); `bodySource` none (see "Body properties"); `refs` those of the frame and the document; `input` the entry of the section (3b's member: the step is remembered only for the same entry object); `patch.fields` `document`, `placement`, `parameters`, `bodies`; `patch.removable` answers for the six numbers of the placement, every `parameters/<name>` and `bodies`.
- **Errors**: `brokenReference` (the document, a parameter, a listed body, the frame), `nonPlanarFace` (the frame), `invalidExpression` (a field), `emptyResult` (no body to bring: the inserted document has none, or none is left after its errors). **Warning**: `insertedIssues` (below).

### The step

1. The stored document is `input` (absent: `brokenReference`). The frame is resolved (`frameOf`), its error is the error of the feature.
2. The parameters the insertion sets: each must be a parameter of the stored document (`brokenReference` with `{ parameter }`); the document is taken with the expression of each replaced by the number the field resolved to. Without any, the stored document is taken as it is.
3. **The recompute of that document** by the same evaluator: `StepContext.insertion(doc)`, a callback the evaluator gives every step, as it gives `done` and `failed`. It returns the state at the end of that timeline and its evaluation (the results of its features and checks, its body properties). Nothing of it is written back: a stored document is never changed by a recompute, and its sketches are solved from the positions it stores, so the result is a function of the stored document and the values. Its sections keep their remembered results apart from the host's (kept by the timeline of the stored document), so the two do not push each other's results out.
4. The bodies chosen; the transform of the placement.
5. **The faces**: every face number the chosen bodies have, in the order of the numbers, gets one new number here, with the name of `insertedFaceName` and its description moved by the transform (`transformFace`). One map for all the bodies of the insertion: a face that two bodies share there (a cut through two bodies leaves one face number in both) is one face here, as its name is one name.
6. **The bodies** `<feature>/<ID there>`: the solid moved by `transformSolid`, which records the solid of the stored document as its origin (D57). The placed solid is kept, as 3b keeps a placed mesh: by the solid there, the transform, the first face number and the ID of the feature, the last few. So a change before the insertion that keeps the number of faces leaves the inserted bodies the same objects, and what the queries remember of them stays (calls, `sameSolid`).
7. `State.inserted` gets, for every body brought, the insertion, the stored document, its ID there and its body properties as the inserted document resolved them (step 3, with these parameters).
8. The warning `insertedIssues` when a feature of the inserted document is in error (`{ feature: <prefixed ID>, code }`) or one of its checks failed or cannot be evaluated (`{ check }`). The bodies that are there come in. The warnings of its features (a projection that degenerates, `noEffect`) are not repeated.

**Measured** ("Measured", 1 and 2): the arm of scenario 13 (22 features) recomputes in 158 ms the first time and in 0.4 ms again by one evaluator; a new list of parameters with the same values costs 0.2 ms; a changed value recomputes only what uses it (a ring with another outer diameter: 15 ms), and back to the first value the evaluator returns the very solid it had. Two insertions of one document with equal values are therefore made from one solid of it, and have one origin.

## Names inside an insertion

The ID of every feature in a face name of the inserted document gets the prefix `<insertion>/`: `feature`, and `pattern` of every copy tag. The fields of the role (a curve, a point, the side of a wall) stay as they are: they are IDs inside that feature. Tags of patterns of this document that copy an inserted body afterwards are appended after them, unprefixed. Edges are pairs of face names, so they follow.

```
{ feature: 'ring', role: 'side', curve: 'outer' }                in the bearing's document
{ feature: 'b1/ring', role: 'side', curve: 'outer' }             inserted by b1        key b1/ring/side/outer
{ feature: 'b/ring', role: 'endCap', copy: [{ pattern: 'b/p', index: 1 }] }   inside a kit, inserted by `kit`:
{ feature: 'kit/b/ring', role: 'endCap', copy: [{ pattern: 'kit/b/p', index: 1 }] }   key kit/b/ring/endCap/@kit/b/p:1
```

- **The key stays unambiguous.** An insertion names no face under its own ID alone, so every face whose key starts with `b1/` is a face of `b1`, and inside it the keys are those of the inserted document with the same prefix, which are unambiguous by the same argument one level down. The tags of the inserted document all carry the prefix and come before the tags of this document, which do not, so the boundary between the two is known. (A tag kept beside the name, `insert: 'b1'`, would lose that order: see "Rejected", 4.)
- **A reference to such a face** checks the owner: the part before the first slash, as `bodyOwner` does for a body ID. `requireFace` and `faceRefs` ask, for a prefixed `feature` and for a prefixed `pattern` of a tag alike, that the owner is a feature that names faces (`faceSource`) and lies before the referring feature; an unprefixed tag is a pattern of this document, as today. Nothing inside the inserted document is checked by a command: whether the face is there is the recompute's question, as it is for any face (a face cut away, a pattern whose count dropped). The face name validator itself does not change (it takes any text).
- **What a reader resolves**: `insertedFeature(doc, id)` finds the feature behind a prefixed ID through the insertions and their stored documents, with the document it is in. The parts list reads the labels of inserted holes through it, and the app the names of inserted features in its texts ("Elbow bearing › Ring – side").
- No ID of this document can meet a prefixed one: an ID has no slash.

**What follows for references into an inserted part**, each measured with a copy made the way an insertion makes its bodies ("Measured", 3): a sketch stands on a planar face with the frame the inserted document would give it (the origin is the image of the origin of the sketch the face was made from); an edge projects as a line or a circle; a seat cut from the projected outer edge of a ring sits around the ring with no collision.

## Parameters of the inserted document

The inserting document sets them, per insertion: `parameters: { D: 'elbowBearingD' }`. Each is a numeric field `parameters/<name>` (the catalog writes `parameters/*`), unit none, a number or an expression over the parameters of this document, written back as every field is. The value replaces the expression of that parameter in the inserted document for this insertion only, and whatever there depends on it follows: one bearing document is a 608 at the shoulder and a larger bearing at the elbow.

- A command checks a name when it adds it (`addFeature`, an `updateFeature` whose patch names it): the stored document must have the parameter. A load checks the form only; a stored document replaced since without it gives `brokenReference` with `{ parameter }`.
- `null` in a patch removes a value: the parameter is the document's own again.
- A value is a number without a unit; the inserted document gives it its meaning (lengths in millimetres, angles in radians, as everywhere).
- The parameters of the inserted document cannot be read by expressions of this one ("Deferred").

## Body properties and mass

An inserted body takes after its document. In the chain of an inserted body (D48), after its own entry and the entries of its chain of sources here, the properties the inserted document resolved for it (`State.inserted`, with the parameters of the insertion) take the place of one more entry: the colour, the material, the use, and the density and the mass as a pair, the pair rule of D48 unchanged. A mass the inserted document derived from a density is taken as that density times the volume here (the same up to the rounding of float32, since the placement is rigid). The name is not inherited, as for a copy: an inserted body without a name of its own is `<name of the insertion> / <its name there>` ("Elbow bearing / 608 bearing"). `fromDocument` on the result names the stored document when a field came from it, so the app can say where a mass came from.

So the bearing's document says once that it is a bought part of 12 g, and every insertion of it is one. An entry here overrides it per body (`setBodyProperties { body: 'b1/ring', … }`), as for any body. A copy of an inserted body by a pattern inherits through its source, which ends in the inserted document. A body that comes in as `part` is printed: a bought part's document should say `use: 'reference'`, and the tool says so when it does not.

Why the state, not the document: the properties of the inserted document are resolved with its parameters, and the parameters are values of the insertion's fields, known to the recompute. The insertion's step has the evaluation of the inserted document in hand; the section reads it after the timeline from the final state, which it is given already (D49).

## The parts list (3e)

- **Two insertions of one document with the same values are one row.** Their bodies are made from one solid of the stored document (the evaluator remembers its recompute), so they have one origin (`shapeOrigin`), the same inherited properties and one part name; `partName` of an inserted body without a name of its own here is its part name in the inserted document. The bearings of the scenario are "608 bearing × 2, 24 g". With another value at the elbow they are two rows of one name ("Measured", 2: another value, another solid).
- **The hardware of an inserted document is counted.** A face of an inserted hole has the prefixed feature (`clip/insertHole`); the query takes the hole features of the inserted documents as well (`insertedFeature`), under their prefixed IDs, and joins them with this document's by the exact text of the label. The clip's insert is the fifth `M3x3x4.5 heat-set insert` of the arm.
- **A bought part modelled as several bodies is several rows** (a bearing as two rings and its balls). As designed, the parts list stays one rule; the bought part's document is modelled as one body, or its other bodies are auxiliary. "Open", 3 asks whether the bought bodies of one insertion should be one row instead.

## Features on an inserted body

Allowed, unlike an imported mesh (3b). The reason 3b refuses is that the kernel adapter knows a planar face by its face number and an imported mesh has one face for its whole surface; an inserted body has the faces its document made, each planar face a planar face number with its exact plane, so the adapter's guarantee for flush faces holds as for a body modelled here. A printed bracket from a library gets a hole. A body with a face of an imported mesh (a stored document that places one) stays `importedTarget`, by the face, wherever it comes from.

## The schema

The step is `3c-document-insert`: a document without the field `documents` gets `{}`; a field that is there, whatever it holds, is left to the validation. It reads and changes only `documents`, so it commutes with every other step. `master` after the merge saves one version more; the branch saves the version of its `master` with `schemaSteps: [..., '3c-document-insert']` and `SCHEMA_PENDING` raised by one (with 3b's step pending as well when 3b is not merged first).

Why a step: the section. A build without it would load the document and drop the section without a word (`validateDocument` rebuilds a document from the fields it knows; probed for 3b's section). The feature type, the commands, the warning and the reference kind need none: a build without them refuses each by itself.

| The document | The build that loads it | Result |
|---|---|---|
| saved by the branch | `master` before the merge, a branch of another package | refused: no step of that name |
| saved by `master` after the merge | a build without the step | refused by the version |
| saved by a build without the package | a build with it | loads; the step adds `{}` |
| with a stored document of an older version | a build with the package | loads; the stored document is upgraded as a document is, by the same steps |
| with a stored document newer than the build, or a field of an entry the build does not know | a build with the package | refused: a stored document is validated as a document, an entry is strict |
| with an insertion whose stored document is not in the section | a build with the package | loads; the insertion is in error (`brokenReference`) |

`save` writes the section always, and every stored document with the version of this build (a stored document is validated, and so upgraded, on every load).

## MCP and the app

**By construction.** The commands and the feature go through `execute`, `preview` and `after`; the types are in the parts of `types.ts` that `describe_api` prints; the numeric fields come from the registry; the section is listed from `SECTION_INFO`; `get_model` summarises an insertion by its updatable fields and its facts. One line of the conventions: the names of inserted bodies and faces, the parameters per insertion, and that properties come from the inserted document.

**By hand**, each with a test:

- **The tool `insert_document { path, id?, name?, replace? }`**, next to `open_document`: it reads the file (a document as the app or `save_document` writes it), and sends `addDocument`, or `replaceDocument` with `replace`, through `execute` to the engine the other tools use. The ID defaults to the name of the file without its extensions reduced to letters, digits and underscores (`document` when that is no ID by the rule of `newId`), with `_2`, `_3` when the section has it; with `replace` it is required and must be in the section. It answers with the parameters of the stored document and the command that inserts it, written out (`addFeature` of an insertion on XY), and with what that command would bring, by a preview of it: the bodies with the use, the material and the mass they inherit, and the warning of the insertion. `say` tells the caller that a body inherited as `part` is printed and a bought part is `use: 'reference'` with the mass of its data sheet.
- **`get_document`** prints a stored document shortened (its name, parameters, the numbers of features and stored documents, the size of the rest); `get_document { stored: id }` prints that one in full. Without this a library part would fill the context of the AI with a timeline it does not need. `save_document` writes everything.
- **`get_model`** lists the stored documents: ID, name, parameter values, number of features, `usedBy`.

**The app.**

- `FEATURE_UI` gets its entry `insert` (without it the app does not compile): a button "Insert"; the form with the stored document (a select, and "Insert a document…", a file input that sends `addDocument` before the draft opens, as 3b stores a mesh first), the frame and the six fields of the placement (3b's), a table of the parameters of the stored document (its value beside a field for the value here, empty for the document's own), and the bodies as boxes (all ticked is no list; the list is read from a preview of the draft without one). The lines of the model panel: the stored document and the values set.
- The model panel lists the stored documents with what inserts them, replaces one from a file, and removes one nothing inserts.
- The texts of issues and of picked faces name an inserted feature by the insertion and its name there (`insertedFeature`).
- The view draws inserted bodies as any body.

## Issue codes

One warning: **`insertedIssues`**, the inserted document did not recompute cleanly with the values of this insertion: `refs` name its features in error (`{ feature: <prefixed ID>, code }`) and its checks that failed or cannot be evaluated (`{ check }`). The existing codes cover the rest: `brokenReference` (the document, a parameter, a listed body, the frame), `nonPlanarFace` (the frame), `emptyResult`, `invalidExpression`.

## Measured

A spike in the session scratchpad (`scratchpad/3c/insert.spike.ts`), run with vitest against the sources of the worktree at `b4c2a86` and the real adapters (planegcs, Manifold) on 2026-11-17. Not in the repository; the recipes are below.

**1. Size and time of a document.** The arm of scenario 13 (`arm()` of `packages/scenarios/test/arm.ts`, 22 features), the box of scenario 12 with its cavity and lid (`box.ts`), and the bearing ring of the scenario (a sketch with two circles and one extrusion), saved as JSON; then loaded into fresh engines, and evaluated twice by one `Evaluator`:

| Document | Size | Load, a fresh engine (first recompute) | Load again, another engine | One evaluator, first | The same document again | A new list of parameters, the same values |
|---|---|---|---|---|---|---|
| the arm | 7 552 characters | 270 ms | 215 ms | 158 ms | 0.4 ms | 0.2 ms |
| the box with cavity and lid | 3 030 | 8 ms | 8 ms | 4 ms | 0.1 ms | 0.2 ms |
| the ring | 949 | 4 to 12 ms | 4 ms | 3 to 6 ms | 0 | 0 |

A stored document is one to three orders of magnitude smaller than a mesh of a part (3b: 0.11 MB of base64 for a coarse motor of 4 606 triangles, 2.5 MB for a fine one), and an insertion of it costs its first recompute once per evaluator and set of values.

**2. A value of a parameter.** The ring with its outer diameter driven by the parameter `D`, evaluated by one evaluator with `D` = 22, then with 24 (a new document object with another parameter list, as the step makes one): 15 ms, the volume 2 307.0 → 2 812.5 mm³. Back to 22 the evaluator returns the same solid object as the first time; 24 again, the same object as the second.

**3. A seat from the edge of a turned part.** The arm, a ring of 22 × 8 × 7 about the elbow pin inside `upper` (z from 0.5 to 7.5), then a copy of it by a circular pattern of the body about the elbow by an angle (`transformSolid` and `transformFace`, what an insertion with `rz` does), the outer edge of the copy (its outer side with its start cap, with the copy tag) projected into a sketch on XY, a circle of the sketch held on it (coincident centre, equal radius), and a cut of `upper` from it. Then `interference` over `upper`, the copy and `forearm` (the pin), and `gap` of `upper` and the copy:

| Turn | Seat | Interference | Gap |
|---|---|---|---|
| 0 (the ring itself) | ok | nothing | 0, touching |
| 17° | ok | no pair; the pin in the bore a fit (0.19 mm³, 0.004 mm deep); the seat and the ring cleared by the second opinion of D50 as a fit (1.02 mm³, 0.010 mm) | 0, a fit |
| 45° | ok | no pair; two fits (0.77 mm³ and 0.40 mm³, under 0.01 mm deep) | 0, a fit |

Round faces of a part turned against the sketch that draws its seat are divided at other angles, so they meet as a fit within the chord tolerance, as the collisions are designed to report it. A sketch on the end cap of the turned copy has the normal +Z and its origin at the image of the origin of the ring's sketch (5.24, −35.08, 7.5 at 17°), as the rule of a sketch on a face says. The projected circle needed a circle of the sketch held on it: a projected curve makes no region (`naming.md`, "Profily a oblasti").

## Rejected

1. **The document referenced by a path** (the section holds a file name, read when the host is loaded). The host would no longer be one file: `save` and `load` take and return one text, the app has no file system, undo would not cover the file, a missing file would break a model, and the engine would need a port to read it, asynchronous in the browser. It would also change a model whenever the file changes, without a command. A document costs kilobytes inside. It stays possible as another variant of an entry, with the stored copy as its last known state.
2. **Frozen as meshes** (the bodies of the part exported and stored as 3b's meshes). Every body would have one face, no names, no exact surfaces: no sketch on it, no projected edge, no feature on it (`importedTarget`), no parameters; geometry would be stored, against the rule that the document is a recipe; and it is tens to hundreds of times larger. The part would not change with a later build of the engine, which is the one thing it gives.
3. **Frozen with its faces** (the solids with their face tables and their exact descriptions stored). It keeps the names but stores `FaceInfo`, an internal type, in every document, so a change of that type becomes a step of the schema; still no parameters, still geometry stored.
4. **A tag beside the name instead of a prefix** (`insert: 'b1'` next to `copy`). Two lists lose the order of the tags: a body of the inserted document copied by its pattern `p` and an inserted body copied here by a pattern `p` would both be `{ copy: [{ pattern: 'p', index: 1 }], insert: 'b1' }`, two faces of one name. A single list of mixed tags would change `CopyTag` and its readers. The prefix is what the backlog proposed, and it needs only the owner rule bodies already have.
5. **The features of the inserted document copied into the timeline** (flattening, prefixed). The timeline would hold the recipe of the part, editable feature by feature, with `at` inside it; a revision could not replace it, two insertions would be two copies of every feature.
6. **One body per insertion** (the bodies of the part united). A union of touching bodies (balls in their races) is the hard case of the kernel; per-body properties, an auxiliary keep-out body and a link per body would be lost.
7. **One inserted body per feature** (`body: Id` required). Two insertions of a two-body part would share no parameters and no placement.
8. **Inserted bodies refused as targets** (3b's rule). 3b's reason is one face for the whole surface; an inserted body has its designed faces.
9. **The recompute writes back into the stored document** (settling it as a load settles the host). The stored copy would change by a recompute; every value of an insertion would make another stored state. Its sketches are solved from the positions it stores, which is deterministic.
10. **A method of `Engine`** to insert a file. A command takes the document; the tool and the file input read the file.
11. **The section validated by its own code** without `validateDocument`. A second validator of a document would drift from the first, and the upgrade steps would not reach a stored document.

## Known limits

- **A first insertion costs the inserted document's recompute**, once per evaluator and set of values: milliseconds for simple parts, 158 ms for the arm, seconds for a document of gears. A load and an undo reuse it.
- **An inserted part follows the engine**: a later build that changes how a feature is computed changes the part, as it changes the rest of the model.
- **The copy does not follow its file**: a corrected part comes in by `replaceDocument` (the tool with `replace`).
- **Only bodies come in**: no sketch, plane, point or link of the inserted document; a joint axis through an inserted part takes a face of it (5c) or a sketch point of this document.
- **A bought part of several bodies is several rows** of the parts list ("Open", 3).
- **Round faces of a turned part and a seat drawn from its edge meet as a fit** within the chord tolerance, not as nothing ("Measured", 3).
- **The inserted document keeps its own chord tolerance**; the measuring queries count the tolerance of this document.
- **Names are long** (`b1/ring/side/outer`, twice prefixed in a kit).
- **The warnings of the inserted document are not repeated**, only its errors and checks.
- **A change before the insertion that changes the number of faces** makes new solids for the inserted bodies (as for 3b), and what the queries remembered of them is computed again.
- **A document inserted at two levels is stored twice.**
- **A value set for a parameter has no unit of its own.**

## To verify before the implementation

- 3b's `input` and `recompute/placement.ts` as implemented; whether the cache of placed solids of 3b can serve both feature types.
- `faceKey` unambiguous with prefixes and tags: a case in `face-roles.test.ts` over every role.
- The results of the sections of a stored document kept apart from the host's in the evaluator (a map per stored timeline), and that the host's results stay the same objects across an insertion.
- The time of an insertion of a heavy document (the gears of scenario 8) in the app, where it blocks the page.
- The memory: the resolutions of inserted features are kept per set of values (8 per feature, as today).
- The app: the labels and the picking of faces with prefixed names; the snapshots of the app test with a stored document of one feature.
- `sectionsDiffer` compares `documents` as JSON only when it is another object (after the three commands and a load).

## Shared vocabulary

**Taken**: from 3b `BodyPlacement`, `FrameRef`, `frameOf`, `placementTransform`, the six fields, the facts `origin`/`axisX`/`axisY`/`axisZ`, `input` of a feature module and `StepContext.input`, the pattern of a reference kind for an entry of a section, the kept placed solid; from 3a the registry of sections, the chain of sources and the pair rule; from 3e `shapeOrigin` and `partName`; `bodyOwner`, `transformSolid`, `transformFace`, `validateDocument`, `upgradeDocument`, `UpgradeStep`.

**Added**, for other packages:

| Name | Where | Who uses it |
|---|---|---|
| `documents` in `Document` and `Evaluation`, `StoredDocument` | `types.ts`, `sections/documents.ts` | |
| The feature type `insert`, the warning `insertedIssues` | `types.ts`, `features/insert.ts` | |
| The owner rule of a prefixed ID in a face name (`faceRefs`, `requireFace`) | `validation.ts` | every reference to a face |
| `insertedFeature`, `insertedFaceName` | `features/index.ts`, `recompute/insertion.ts` | the parts list, the app, a later query that names features |
| `StepContext.insertion`, `State.inserted` | `recompute/state.ts`, `evaluate.ts` | |
| `BodyPropertiesResult.fromDocument` | `types.ts` | the app |
| A context for the validation and the commands of a section (`SectionContext.document`) | `sections/spec.ts` | a later section that holds a document |
| The reference kind `document` | `validation.ts` | |
| step `3c-document-insert` | `UPGRADES` | |

Notes for the plan, which this session does not edit:

- The row of the feature types names 3c; it also adds a member to `StepContext` and to `State`.
- The row of the sections ("What a section of the document touches") gets `documents`, with the context its validation needs.
- 3d's precondition of the kernel port (no face number in both operands) holds for inserted bodies as for any: two bodies of one insertion share a face number where they shared one in their document.
- 5b: an inserted body is a body of a link with its mass, exported like any.

## Open

For the owner, each answerable in one line:

1. **A stored document is a copy inside the host document**, changed only by `replaceDocument` (a new revision is inserted on purpose). *Yes* keeps the design; *no* means a path to the file, read on every load, with the host no longer one file.
2. **An inserted part is recomputed from its features** (its faces keep their names, a sketch and a seat can be drawn from them, its parameters can be set per insertion), not frozen as meshes. *Yes* keeps the design; *no* means 3b's meshes with the properties of the document.
3. **The parts list counts bodies.** A bought part modelled as several bodies (a bearing as two rings and balls) is several rows; the document of a bought part is modelled as one body. *Bodies* keeps the design; *insertion* means the bought bodies of one insertion are one row, named after the stored document, with their masses summed.
4. **Features of the host may change an inserted body** (a hole into an inserted printed bracket); only a body with a face of an imported mesh is refused. *Yes* keeps the design; *no* refuses every inserted body as a target, as 3b refuses a mesh.
5. **Documents inside documents** (a kit that inserts a bearing) are allowed, eight levels deep. *Yes* keeps the design; *one* allows only a document that inserts nothing.

No third-party library is needed for what is designed.

## Reviews

The design was written on Claude Opus 5.5. Three reviewers per round, read-only, each against the code of `master`: a fresh subagent on Opus 5.5 (the internal reviewer while Fable is unavailable), codex (`gpt-6-astra`, high effort) and agy (`gemini-4-argon-high`).

(Rounds to follow.)

## Rows for the indexes

**`docs/d36/README.md`, the row of 3c** ("Design now"):

> full, designed 2026-11-17 ([3c-document-insert/design.md](3c-document-insert/design.md)), D62: the section `documents` (another document stored inside, as a copy, validated and upgraded as a document is; documents inside documents up to 8 levels), the feature type `insert` (3b's placement; values for parameters of the inserted document per insertion; a choice of its bodies) that recomputes the stored document by the same evaluator and brings its bodies as `<insertion>/<ID there>` with every face under its name, the feature IDs prefixed `<insertion>/`; references to those faces check the owner of the prefixed ID; body properties inherited from the inserted document; the parts list counts the hardware of inserted holes and two insertions of one document as one row; the warning `insertedIssues`; the tool `insert_document`; schema step `3c-document-insert`. Open for the owner: five questions (a copy inside, recomputed not frozen, the parts list by bodies, features on an inserted body, nesting)

And in "Numbers": decisions D62 taken by 3c, next D63.

**`docs/decisions.md`, the row of D62**:

> | D62 | [3c Inserting another document as a part](d36/3c-document-insert/design.md) | designed 2026-11-17 | Another document is stored inside the host as a copy (the section `documents`; validated by `validateDocument`, so every upgrade step reaches it) and inserted by a feature `insert` that recomputes it by the same evaluator, with values for some of its parameters, and places its bodies by 3b's placement. The bodies are `<insertion>/<ID there>`, every face keeps its name with the feature IDs prefixed, and a reference to such a face checks the owner of the prefix, as a body ID is decomposed; so sketches, projections, seats and features use an inserted part like a modelled one. Body properties come from the inserted document unless the host sets them; the parts list counts inserted holes and two insertions with the same values as one row. Rejected: a path to the file, freezing as meshes or with face tables, a tag beside the name, flattening the timeline. Measured: a document of a part is 1 to 8 KB, its first recompute milliseconds to 160 ms and nothing after; a seat cut from the projected edge of a turned part meets it as a fit |

**`docs/requirements.md`, scenario 13, the part of this package**:

> - *Parts as inserted documents (3c, D62).* A ball bearing (8 × 22 × 7, test values) modelled as a document of its own by a build without the package (its outer diameter a parameter, a check of its wall, a bought part of 12 g) is stored once in the arm, upgraded on the way, and inserted at the elbow and at the shoulder on the points of `layout`, the outer diameter at the elbow driven by a parameter of the arm. Each comes in as one body `b1/ring`, `b2/ring` named after its insertion, a bought part of 12 g by its own document, with its faces under prefixed names. The seats of both are cut into the upper arm from the projected outer edges of the bearings, and nothing collides; a sketch stands on the top of a ring; the bearings are bodies of the link `upper`; an edit before them leaves their solids the same objects. The parts list has "608 bearing × 2, 24 g"; a larger bearing at the elbow (one parameter of the arm) grows the ring and its seat together and makes two rows; a value the bearing's document does not hold up gives the warning `insertedIssues` with its failed check. A printed cable clip with a heat-set insert is inserted on the top face of the upper arm without its cable channel: a PETG part and the fifth M3 insert of the list; with the channel, the channel is auxiliary. Refused: a second document under a taken ID, a document that does not load, an insertion of a document that is not stored or of a parameter it does not have, removing a stored document in use, a face of an insertion that is not there. A revision of the bearing 8 wide replaces the stored one and the ring at the elbow then runs into the forearm. A document whose stored part is gone loads with the insertion as a broken reference; a stored document with an unknown field or a newer version is refused on load. A kit that inserts the bearing is inserted into the arm with its names prefixed twice ([d36/3c-document-insert/calls.ts](d36/3c-document-insert/calls.ts)).

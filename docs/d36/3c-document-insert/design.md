# 3c Inserting another document as a part (D62)

**State: design, fourth version, after three rounds of reviews, the last allowed ("Reviews"); written on 2026-11-17 against `master` at `b4c2a86` (every package of steps 1 and 2, 3a, 3e, 5a, 5e and 5f implemented; 3b, 3d, 4a, 5b, 5c and 5d designed). It builds on the design of [3b](../3b-mesh-import/design.md), whose implementation runs at the same time: the placement, `input` of a feature module and the reference kind of a section entry are taken from there. Not implemented.** Written by Claude Opus 5.5 (Fable is unavailable; owner, 2026-11-17). The scenario part was prototyped against the real adapters where a decision depended on them ("Measured").

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
  document.ts              validateDocument(value, what, depth) passes itself on as that context; emptyDocument
  features/insert.ts       the feature type: validation, references, the step
  recompute/insertion.ts   the names inside an insertion (`insertedFaceName`), the placed solids kept
  recompute/state.ts       State.insertions, State.inserted; StepContext.insertion
  evaluate.ts              `insertion` of the context: the recompute of a stored document by this
                           evaluator with the settings of the host, its sections with results kept
                           apart, and what its bodies pass on to the body properties here
  face-roles.ts            faceKey of a face of an insertion (the inner key quoted)
  validation.ts            faceName: the prefixed IDs of one name have one owner, its tags first;
                           faceRefs and requireFace by the owner of a prefixed ID; the reference kinds
                           `document`, `insertion` and `parameter` (RefKind, featureRefs, REF_LABEL)
  features/index.ts        one line of the registry; requireRef of the three kinds; bodyProblem and
                           requireRef of an inserted body through the stored document; `insertedFeature`
  document.ts              one predicate "this path is a dictionary of the module" (`patch.dictionaries`)
                           read by mergePatch, replacedPaths, patchPaths, removedPaths and
                           withoutNulls; refKey includes the stored document of a reference
  schema.ts                the step `3c-document-insert`; upgradeDocument takes the path of its messages
  sections/index.ts        validateSections(o, what, context); a helper that finds a face or an edge
                           by its key and compares the name (with recompute/services.ts)
  query/context.ts, query/entity.ts, query/check.ts, query/measure.ts, solid.ts (projectEdge)
                           that helper; labels of inserted faces in messages
  sections/body-properties.ts
                           the chain of an inserted body ends in what its document resolved; partName
                           of an inserted body; `fromDocument`
  query/parts-list.ts      the hole features of inserted documents
packages/mcp/src/          server.ts (insert_document), tools.ts (get_document, get_model)
packages/app/src/          features/insert.ts (FEATURE_UI), panels/model.ts (the stored documents),
                           issue-text.ts and queries/parts-list.ts (the name of an inserted feature),
                           features/draft.ts (the unit of a field whose path has `*`)
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

- **Inside the document, as a copy.** The host stays the one source of truth and one file: `save`, `load`, `open_document`, `save_document`, the app's "Open" and "Save", undo and a preview work unchanged, and the engine has no input but its commands. A document of designed parts is small: 1 to 8 KB for the parts tried ("Measured", 1), against a hundred kilobytes to megabytes for a mesh of a part (3b); a stored document that holds meshes of its own (3b) is as large as they are ("Known limits"). The file it came from may change afterwards; the stored copy changes only by `replaceDocument`, so a model does not change because a file elsewhere did.
- **Validated as a document is on a load**: by `validateDocument` itself, given to the section as a context (`SectionContext.document(value, what)`): the section cannot import `document.ts`, which imports the sections. `validateDocument` takes the path of the document (`what`, `document` for the host) and the depth; the message of a stored document's fault names its path (`document.documents.bearing.document.settings: …`; `upgradeDocument`, `validateSections` (`validateSections(o, what, context)`) and every prefix of `validateDocument` itself are built from the path; the host's messages keep exactly the texts they have today), and the error of a command that adds one carries no `expression` of its own (a parameter of the stored document is no parameter of the host, which the app would otherwise mark). So an older document (saved by an earlier build, or by a build without this package, as the bearing of the scenario is) is brought to the schema of this build from its own `schemaVersion` by the same upgrade steps, and the stored copy is the upgraded one. **Every later upgrade step reaches a stored document without a word**, because it is the same function; a step's author has nothing to do for it. A stored document newer than the build, or of a branch the build does not have, is refused with the host, as the host itself would be.
- **Documents inside documents** are allowed (a kit that inserts a bearing, inserted into the arm), up to `MAX_INSERT_DEPTH` (8) levels below the host, counted alike by a load and by `addDocument` and `replaceDocument` (a stored document's own stored documents count from its level), a guard against a stack overflow from a file written by hand. It bounds the recursion, not the work or the size ("Known limits"). A copy cannot hold itself, so there is no cycle to find. A document inserted at two levels is stored twice.
- **What the registry entry says otherwise**: `names()` is empty (a stored document names nothing of this document), `renameParameter` leaves the section as it is (a stored document has its own parameters; the values an insertion sets are fields of the feature and renamed there).
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
- **`parameters`**: see "Parameters of the inserted document".
- **`bodies`**: without it, every body at the end of the inserted timeline, in its order; with it, the listed ones (not empty, no ID twice). A listed body the inserted document does not have in this recompute (a pattern there whose count a parameter lowered) is the error `brokenReference` with `refs: [{ body }]`, its ID there. The scenario's clip leaves out the channel its document keeps free for the cable.
- **The bodies here are `<feature>/<ID there>`** (`b1/ring`, `kit/screws/2`, `kit/b/ring`). No body has the ID of the feature alone. `createsBody(f, local)`, which sees the feature only, answers for every local name in the form of a body ID, or for the listed ones only. `bodyProblem` and `requireRef` of a body, which see the document, ask further that the stored document has a feature that can create that body there (through `insertedFeature` and that feature's own `createsBody`, down a kit), so `setBodyProperties { body: 'b1/typo' }` is refused as it is for any feature. Whether the body is there in a recompute is the recompute's question, as for the copies of a pattern.
- **What the entry of the registry says**: `namesFaces` true; `producesTool` false (a pattern of features cannot repeat an insertion; a pattern of an inserted body copies it like any body); `bodySource` none (see "Body properties"); `refs` those of the frame, the document (kind `document`) and one per parameter set (kind `parameter`); `input` the entry of the section (3b's member: the step is remembered only for the same entry object); `patch.fields` `document`, `placement`, `parameters`, `bodies`; `patch.dictionaries` `parameters`; `patch.removable` answers for the six numbers of the placement, every `parameters/<name>`, `parameters` and `bodies` (a form sends `null` whether the field is there or not).
- **Errors**: `brokenReference` (the document, a parameter, a listed body, the frame), `nonPlanarFace` (the frame), `invalidExpression` (a field), `emptyResult` with the detail "the inserted document has no body to bring" (it has none, or none is left after its errors; the general text of the code is about a cut). **Warning**: `insertedIssues` (below), with a text of its own in `MESSAGE`.

### The step

1. The stored document is `input` (absent: `brokenReference`). The frame is resolved (`frameOf`), its error is the error of the feature.
2. The parameters the insertion sets: each must be a parameter of the stored document (`brokenReference` with `{ parameter }`); the document is taken with the expression of each replaced by the number the field resolved to, and **with the settings of this document** (its chord tolerance): an inserted part is divided as finely as the bodies it meets, so the measure of a fit, which counts the chord tolerance of this document (`interference.ts`, `meshAccuracy`), holds for it. Its own tolerance is not used.
3. **The recompute of that document.** The step first looks in the state before it for an earlier insertion of the same entry object with the same environment (`State.insertions`); when there is one, it takes that insertion's recompute. The environment is what the parameters of the stored document evaluate to after the values are put in (`evaluateParameters` of the substituted list): every parameter by its name in sorted order, with its value or its error (code and message), written as text without loss: a value as the shortest text that reads back as the same number, and −0 as `-0` (step 2 writes a value it puts in the same way). Without that, −0 and 0 share a key and not a recompute: `atan2` tells them apart (round 3). So an insertion that sets `D` to 22 and one that sets nothing in a document whose `D` is 22 share one recompute, and so do two that set the same values in another order (both reviewers of round 2: a key of the values set would have split the scenario's own pair). Otherwise it asks the evaluator, by `StepContext.insertion(doc)`, a callback the evaluator gives every step as it gives `done` and `failed`. The callback returns the state at the end of that timeline, its evaluation (the results of its features and checks), and what each of its bodies passes on to the body properties here (below). Nothing of it is written back: a stored document is never changed by a recompute, and its sketches are solved from the positions it stores, so the result is a function of the stored document, the values and the settings. Its sections keep their remembered results apart from the host's (kept by the timeline of the stored document), so the two do not push each other's results out.
   - Why the state and not the memo alone: the memo of the evaluator keeps eight resolutions per feature, so a value previewed nine times between two insertions can push the inner recompute out, and a second insertion with the same environment would get other solids than the first (found by both reviewers of round 1, probed again in round 2). Taken from the state before it, two insertions of one entry with the same environment share one recompute whatever happened in between: when the first is taken from the memo, the second runs after it and finds it; when the first runs again, so does the second. The memo only saves time; it decides no identity. This holds for the insertions of one timeline: the insertions inside two recomputes of a kit (a kit inserted twice with different values) are in two chains and do not see each other, so a bearing inside both is shared only while the memo keeps it ("Known limits"; round 3).
4. The bodies chosen; the transform of the placement.
5. **The faces**: every face number the chosen bodies have, in the order of the numbers, gets one new number here, with the name of `insertedFaceName` and its description moved by the transform (`transformFace`). One map for all the bodies of the insertion: a face that two bodies share there (a cut through two bodies leaves one face number in both) is one face here, as its name is one name.
6. **The bodies** `<feature>/<ID there>`: the solid moved by `transformSolid`, which records the solid of the stored document as its origin (D57). The placed solid is kept, as 3b keeps a placed mesh: by the solid there, the transform compared by its numbers, the new number of every face number of that solid, and the ID of the feature, the last few. (The first face number alone is not enough: another choice of bodies, or a body there that gained a face, renumbers the faces of a body without changing its first one; codex, round 1.) So a change before the insertion that keeps the face table as it was leaves the inserted bodies the same objects, and what the queries remember of them stays (calls, `sameSolid`).
7. `State.insertions` gets the insertion's record (the entry, its environment, the recompute); `State.inserted` gets, for every body brought, the insertion, the stored document, its ID there and what it passes on to the body properties.
8. The warning `insertedIssues` when a feature of the inserted document is in error (`{ feature: <prefixed ID>, code }`), one of its checks failed or cannot be evaluated (`{ check }`), or an insertion inside it has the same warning, whose `refs` come up with their IDs prefixed and their checks named with the insertion (`{ check, in: <prefixed ID of that insertion> }`). The bodies that are there come in. Other warnings of its features (a projection that degenerates, `noEffect`) are not repeated.

**Measured** ("Measured", 1 and 2): the arm of scenario 13 (20 features) recomputes in 158 ms the first time and in 0.4 ms again by one evaluator when its memo still has it; a new list of parameters with the same values costs 0.2 ms; a changed value recomputes only what uses it (a ring with another outer diameter: 15 ms; 53 ms on a loaded machine), and back to the first value the evaluator returns the very solid it had, while the value has not been pushed out of its memo (after nine other values it has: probed by the internal reviewer of round 2).

## Names inside an insertion

The ID of every feature in a face name of the inserted document gets the prefix `<insertion>/`: `feature`, and `pattern` of every copy tag. The fields of the role (a curve, a point, the side of a wall) stay as they are: they are IDs inside that feature. Tags of patterns of this document that copy an inserted body afterwards are appended after them, unprefixed. Edges are pairs of face names, so they follow.

```
{ feature: 'ring', role: 'side', curve: 'outer' }                                    in the bearing's document
{ feature: 'b1/ring', role: 'side', curve: 'outer' }                                 inserted by b1
{ feature: 'b/ring', role: 'endCap', copy: [{ pattern: 'b/p', index: 1 }] }          inside a kit,
{ feature: 'kit/b/ring', role: 'endCap', copy: [{ pattern: 'kit/b/p', index: 1 }] }  inserted by `kit`
```

- **What a name may be.** The face name validator gets one rule of form, applied at every level: a tag whose `pattern` has a slash needs a `feature` with a slash; when `feature` has a slash, the tags whose `pattern` has a slash come first, all with the owner of `feature` (the part before the first slash), and the tags after them have no slash; and the name with that owner stripped from `feature` and from those tags obeys the same rule (round 2: checked at the top only, `{ feature: 'kit/b/ring', copy: [kit/kp, kit/b/p] }`, ill-formed one level down, keyed like the real name; and an unprefixed feature with a prefixed tag aliased two tags). Every name the recompute makes obeys it (an inner copy, then the insertion, then a copy here, inside a kit).
- **A name is found by its key and then compared.** A reference to a face looks its key up and takes the face only when the name at that number is the name asked for, field by field; a reference to an edge compares both of its faces the same way (round 3: an edge with one aliased face had the key of the real edge). The places that look a face or an edge up by its key get one helper for it: `recompute/services.ts`, `projectEdge` of `solid.ts`, `query/context.ts`, `query/entity.ts`, `query/check.ts`, `query/measure.ts`. Some names that no feature makes alias a real key whatever the key does, because a text field of a role takes any text (`{ feature: 'ring', role: 'side', curve: 'outer/@p:1' }` keys like the copy `@p:1` of the side `outer`; this is so on `master` already, codex, round 2); the comparison makes such a name a reference to nothing.
- **The key quotes the inner key.** The key of a face of an insertion is `<insertion>/` followed by the key of the face in the inserted document written as a JSON string, then the tags of this document as today: `b1/"ring/side/outer"`, `kit/"b/\"ring/endCap/@p:1\""`, and `b1/"ring/side/outer"/@q:2` for a copy made here. The key of a face of this document does not change (no saved document holds keys; a sketch's stamp holds the projected numbers, not keys). Why: an ID may contain `@` and `:`, so the plain concatenation `b1/ring/side/outer/@b1/p:1` is not unambiguous once an ID holds a slash; codex built two copy histories with one key from legal IDs (round 1). A JSON string ends where its closing quote is, so the boundary between the inner key and the tags of this document is known, and the inner key is unambiguous by the same rule one level down (the internal reviewer of round 2 found no two of 300 000 names, built as the recompute builds them with IDs of `@`, `:`, quotes and backslashes, with one key). The key doubles its escapes at every level (545 characters at depth 8). Texts that print a key today print a label instead for a face of an insertion, through `insertedFeature`: the messages of `query/entity.ts` and `query/check.ts` ("has no face …", "has no edge …") and the label of a picked face in `panels/query.ts` of the app. It also keeps a name that is not there from aliasing a real one (`{ feature: 'b1/x/side', role: 'endCap' }` and `{ feature: 'b1/x', role: 'side', curve: 'endCap' }` are two keys). The comment of `face-roles.ts` that says at most one field of a role holds a free ID gets the exception.
- **A reference to such a face** checks the owner: the part before the first slash, as `bodyOwner` does for a body ID, must be **an insertion** (the reference kind `insertion`: a feature of the type `insert`) before the referring feature, for a prefixed `feature` and for a prefixed `pattern` of a tag alike; an unprefixed `feature` is a feature that names faces and an unprefixed tag a pattern of this document, as today. (A feature that merely names faces is not enough: an extrusion `e` would accept `{ feature: 'e/side', … }`; codex, round 1.) Nothing inside the inserted document is checked by a command: whether the face is there is the recompute's question, as it is for any face (a face cut away, a pattern whose count dropped).
- **What a reader resolves**: `insertedFeature(doc, id)` finds the feature behind a prefixed ID through the insertions and their stored documents, with the document it is in. The parts list reads the labels of inserted holes through it, and the app the names of inserted features in its texts ("Elbow bearing › Ring – side") and in the view of the parts list.
- No ID of this document can meet a prefixed one: an ID has no slash.

**What follows for references into an inserted part**, each measured with a copy made the way an insertion makes its bodies ("Measured", 3): a sketch stands on a planar face with the frame the inserted document would give it (the origin is the image of the origin of the sketch the face was made from); an edge projects as a line or a circle; a seat cut from the projected outer edge of a ring sits around the ring with no collision.

## Parameters of the inserted document

The inserting document sets them, per insertion: `parameters: { D: 'elbowBearingD' }`. Each is a numeric field `parameters/<name>` (the catalog writes `parameters/*`), unit none, a number or an expression over the parameters of this document, written back as every field is. The value replaces the expression of that parameter in the inserted document for this insertion only, and whatever there depends on it follows: one bearing document is a 608 at the shoulder and a larger bearing at the elbow.

- **Every value is a reference** of the kind `parameter` (`{ id: <name>, document: <the stored document> }`), checked by `requireRef` against the section: the stored document must have the parameter. `updateFeature` checks only the references the feature did not have, so a command checks a name when it adds it, or when the insertion is pointed at another stored document (the identity of a reference, `refKey` of `document.ts`, gets its stored document, so every name is then new; without that it would not be, round 2); a value the stored document lost by `replaceDocument` stays and is an error of the recompute (`brokenReference` with `{ parameter }`) until it is removed, and does not block a change of another field. A load checks the form only.
- **The patch takes `parameters` key by key.** The generic handling of a patch in `document.ts` takes an object with a field `kind` for a reference and one with `type` or `generator` for a variant; `kind`, `type` and `generator` are legal names of parameters, so a patch of `{ D: 24 }` to an insertion that sets `kind` would be refused, one that names `type` would replace every value (codex, round 1), and the paths it reports replaced would drop the expressions of the other values (`replacedPaths`, both reviewers of round 2). The module names `parameters` in `patch.dictionaries`, and one predicate, "this path is a dictionary of the module", is read by every function of the patch (`mergePatch`, `replacedPaths`, `patchPaths`, `removedPaths`, `withoutNulls`): such a field is a dictionary of numbers, merged key by key, with only the keys the patch names replaced or removed, and nothing inside it read as a reference or a variant.
- `setField` sets a value that is there (`parameters/D`); a parameter not set yet is set by `updateFeature`, since a value has no default. The app finds the description of the field through the `*` of `parameters/*`.
- `null` in a patch removes a value: the parameter is the document's own again.
- A value is a number without a unit; the inserted document gives it its meaning (lengths in millimetres, angles in radians, as everywhere).
- The parameters of the inserted document cannot be read by expressions of this one ("Deferred").

## Body properties and mass

An inserted body takes after its document. In the chain of an inserted body (D48), after its own entry and the entries of its chain of sources here, what the inserted document states for that body takes the place of one more entry: the colour, the material, the use, and the density and the mass as a pair, the pair rule of D48 unchanged.

- **What is passed on is what the inserted document states, not what it shows.** The result of the inserted document's body properties applies its use: an auxiliary body there has no mass in its result. Passed on is the resolution before that (`InheritedProperties`): the first colour, material and use along the body's chain there, and the pair that chain uses, with the numbers its expressions gave there (with the values of the insertion) and their errors. Names are not passed on: they are read from the documents. So a keep-out body of a motor's document with a stated 12 g that is made a reference part here weighs 12 g, as a copy of it would by D48 (codex, round 1). The evaluator computes it with the inner recompute, by the same function the section uses for its own chains, so the module of the feature type does not import the sections.
- A mass the inserted document derives from a density is that density times the volume here (the same up to the rounding of float32, since the placement is rigid).
- **The name is not inherited**, as for a copy. An inserted body without a name of its own is named after the insertion: the name of the insertion alone when its list `bodies` names one body ("Cable clip"), else `<name of the insertion> / <its name there>` ("Elbow bearing / 608 bearing"), its name there being the name the body properties there would give it and its part name there the `partName` there, both by these same rules applied in the stored document, so a body two levels down is named alike in the kit and in the host. Both are read from the documents alone (through `insertedFeature`), not from a recompute, so a parameter that changes the number of bodies renames nothing. The parts list names the part by `partName` there, read the same way (below).
- `fromDocument` on the result names the stored document when a field came from it, so the app can say where a mass came from.

So the bearing's document says once that it is a bought part of 12 g, and every insertion of it is one. An entry here overrides it per body (`setBodyProperties { body: 'b1/ring', … }`), as for any body. A copy of an inserted body by a pattern inherits through its source, which ends in the inserted document. A body that comes in as `part` is printed: a bought part's document should say `use: 'reference'`, and the tool says so when it does not.

Why the state, not the document: what the inserted document states is resolved with its parameters, and the parameters are values of the insertion's fields, known to the recompute. The insertion's step has the recompute of the inserted document in hand; the section reads `State.inserted` after the timeline from the final state, which it is given already (D49).

## The parts list (3e)

- **Two insertions of one stored document with the same environment are one row.** Their bodies are made from one solid of the stored document (the second insertion takes the recompute of the first from the state, step 3), so they have one origin (`shapeOrigin`), the same inherited properties and one part name; `partName` of an inserted body without a name of its own here is its part name in the inserted document, read from the documents alone as D57 reads it (`insertedFeature`, then `partName` there). The bearings of the scenario are "608 bearing × 2, 24 g". With another value at the elbow they are two rows of one name ("Measured", 2: another value, another solid). One part stored twice (one file added under two IDs, or a bearing inserted directly and also through a kit) is two rows: the two copies are two stored documents, recomputed apart ("Known limits").
- **The hardware of an inserted document is counted.** A face of an inserted hole has the prefixed feature (`clip/clipHole`); the query takes the hole features of the inserted documents as well (`insertedFeature`), under their prefixed IDs, and joins them with this document's by the exact text of the label. An inserted hole feature stands in the order of the timeline at the place of its insertion. The clip's insert is the fifth `M3x3x4.5 heat-set insert` of the arm.
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
- **`get_document`** prints a stored document shortened (its name, parameters, the numbers of features and stored documents, the size of the rest); `get_document { stored: id }` prints that one with its timeline, and its own stored documents and stored meshes shortened the same way (`stored: 'kit/bearing'` reaches one inside). Without this a library part would fill the context of the AI with a timeline it does not need, and a stored mesh inside it with megabytes. `save_document` writes everything.
- **`save_document { stored, path }`** writes one stored document to a file of its own, as a document, so it can be opened, changed and brought back by `insert_document` with `replace` (the way back out that the internal reviewer of round 1 missed).
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

**1. Size and time of a document.** The arm of scenario 13 (`arm()` of `packages/scenarios/test/arm.ts`, 20 features), the box of scenario 12 with its cavity and lid (`box.ts`), and the bearing ring of the scenario (a sketch with two circles and one extrusion), saved as JSON; then loaded into fresh engines, and evaluated twice by one `Evaluator`:

| Document | Size | Load, a fresh engine (first recompute) | Load again, another engine | One evaluator, first | The same document again | A new list of parameters, the same values |
|---|---|---|---|---|---|---|
| the arm | 7 552 characters | 270 ms | 215 ms | 158 ms | 0.4 ms | 0.2 ms |
| the box with cavity and lid | 3 030 | 8 ms | 8 ms | 4 ms | 0.1 ms | 0.2 ms |
| the ring | 949 | 4 to 12 ms | 4 ms | 3 to 6 ms | 0 | 0 |

A stored document is one to three orders of magnitude smaller than a mesh of a part (3b: 0.11 MB of base64 for a coarse motor of 4 606 triangles, 2.5 MB for a fine one), and an insertion of it costs its first recompute, then nothing while the memo of the evaluator keeps it.

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
12. **Rows of the parts list joined by a key of their own** (the stored document, the values, the body there) instead of the origin of the solid. It would join two insertions also when a recompute of one was lost, but it is a second rule beside 3e's; the recompute shared through the state (step 3) makes the origin hold.
13. **The inserted document divided with its own chord tolerance.** The measure of a fit counts the tolerance of the host for every body, so a coarser part would show its facets as collisions with a fine seat and a finer host tolerance would clear a real overlap as a fit (codex, round 1). Carrying a tolerance per body through every query is larger than recomputing the part with the host's.
14. **Another name for the feature type** (the internal reviewer of round 1: `insert` meets the heat-set inserts of the hardware catalogs). Kept: the hardware names its use `heatSetInsert` and its labels "heat-set insert", the feature type is described as "Inserted document", and "insert" is the word of the backlog and of the CAD tools for placing a part; the scenario names its hole `clipHole`.

## Known limits

- **An insertion costs the inserted document's recompute** whenever the memo of the evaluator does not have it: milliseconds for simple parts, 158 ms for the arm, seconds for a document of gears. Undo, redo and a preview reuse it while the memo keeps it (eight sets of values per feature); a load does not (`load` validates the host and every stored document into new objects, so the memo of the evaluator misses: the column "Load" of "Measured", 1).
- **Nesting multiplies the work**: with k insertions of distinct values per level, d levels make k^d recomputes of stored documents. `MAX_INSERT_DEPTH` bounds the recursion, not the work.
- **A stored document that holds meshes (3b)** is as large as they are, and every load of the host checks them again (3b's checks of a stored mesh, up to its bound of work); a command that stores one carries them over the bridge. Shortened in `get_document`.
- **Nested insertions share a recompute only through the memo**: the insertions inside two recomputes of a kit with different values do not see each other's records, so a bearing inside both is one row while the memo of the evaluator keeps its recompute and may be two after many previews.
- **One part stored twice is two rows** of the parts list (one file added under two IDs; a bearing inserted directly and also through a kit): the two copies are recomputed apart, so their solids differ.
- **A stored document saved in a pose comes in as modelled**: its mechanism is not read.
- **An inserted part follows the engine**: a later build that changes how a feature is computed changes the part, as it changes the rest of the model.
- **The copy does not follow its file**: a corrected part comes in by `replaceDocument` (the tool with `replace`).
- **Only bodies come in**: no sketch, plane, point or link of the inserted document; a joint axis through an inserted part takes a face of it (5c) or a sketch point of this document.
- **A bought part of several bodies is several rows** of the parts list ("Open", 3).
- **Round faces of a turned part and a seat drawn from its edge meet as a fit** within the chord tolerance, not as nothing ("Measured", 3).
- **The inserted document is divided with the chord tolerance of this document**, not its own: a part made coarse on purpose comes in finer (more triangles), and one made finer than the host comes in coarser. The tolerance also decides how curves are divided, and the divided outline is checked again (`detectProfile`, its check of the polygons), so an inserted part can be in error here (`insertedIssues`, `emptyResult`) where its own document is not; the answer of `insert_document` shows it, since it previews the insertion (round 2).
- **Names are long** (`b1/ring/side/outer`, twice prefixed in a kit).
- **The warnings of the inserted document are not repeated**, only its errors and checks.
- **A change before the insertion that changes the number of faces** makes new solids for the inserted bodies (as for 3b), and what the queries remembered of them is computed again.
- **A document inserted at two levels is stored twice.**
- **A value set for a parameter has no unit of its own.**

## To verify before the implementation

- 3b's `input` and `recompute/placement.ts` as implemented; whether the cache of placed solids of 3b can serve both feature types.
- `faceKey` unambiguous with prefixes and tags: cases in `face-roles.test.ts` over every role, with IDs that hold `@` and `:`, codex's two copy histories of round 1, the alias pair of the internal reviewer, and two levels of prefixes.
- 3b's kept placed solid compares the transform by its numbers (a change before `layout` solves the sketch again and makes new frame objects with equal numbers).
- Two insertions with the same environment after more than eight other values of the first were previewed, one with `D` set to 22 and one without: one origin, one row (the cases of rounds 1 and 2).
- A patch of `parameters` with the names `kind`, `type` and `generator` keeps the expressions of the other values, and `null` removes only its own.
- The rule of form of face names over the cases of round 2, and the comparison after a key lookup with the alias of `curve: 'outer/@p:1'`.
- An edge with one aliased face (round 3), and an insertion that sets `D` to `-0` against a stored `-0` and a stored `0`.
- A nested fault: a stored document whose own `bodyProperties` is wrong names the full path.
- The results of the sections of a stored document kept apart from the host's in the evaluator (a map per stored timeline), and that the host's results stay the same objects across an insertion.
- The time of an insertion of a heavy document (the gears of scenario 8) in the app, where it blocks the page.
- The memory: the resolutions of inserted features are kept per set of values (8 per feature, as today), and the recompute of every insertion lives in the states that hold it.
- The bridge with a stored document that holds meshes (one SSE event per request, 30 s).
- The app: the labels and the picking of faces with prefixed names; the snapshots of the app test with a stored document of one feature.
- `sectionsDiffer` compares `documents` as JSON only when it is another object (after the three commands and a load).

## Shared vocabulary

**Taken**: from 3b `BodyPlacement`, `FrameRef`, `frameOf`, `placementTransform`, the six fields, the facts `origin`/`axisX`/`axisY`/`axisZ`, `input` of a feature module and `StepContext.input`, the pattern of a reference kind for an entry of a section, the kept placed solid; from 3a the registry of sections, the chain of sources and the pair rule; from 3e `shapeOrigin` and `partName`; `bodyOwner`, `transformSolid`, `transformFace`, `validateDocument`, `upgradeDocument`, `UpgradeStep`.

**Added**, for other packages:

| Name | Where | Who uses it |
|---|---|---|
| `documents` in `Document` and `Evaluation`, `StoredDocument` | `types.ts`, `sections/documents.ts` | |
| The feature type `insert`, the warning `insertedIssues` | `types.ts`, `features/insert.ts` | |
| The owner rule of a prefixed ID in a face name (`faceName`, `faceRefs`, `requireFace`), the key of a face of an insertion (`faceKey`) | `validation.ts`, `face-roles.ts` | every reference to a face |
| `insertedFeature`, `insertedFaceName` | `features/index.ts`, `recompute/insertion.ts` | the parts list, the app, a later query that names features |
| `StepContext.insertion`, `State.insertions`, `State.inserted`, `InheritedProperties` | `recompute/state.ts`, `evaluate.ts`, `sections/body-properties.ts` | |
| `patch.dictionaries` of a feature module | `features/module.ts`, `document.ts` | a later field that is a dictionary of numbers |
| `BodyPropertiesResult.fromDocument` | `types.ts` | the app |
| A context for the validation and the commands of a section (`SectionContext.document`) | `sections/spec.ts` | a later section that holds a document |
| The reference kinds `document`, `insertion`, `parameter` | `validation.ts`, `features/index.ts` | |
| step `3c-document-insert` | `UPGRADES` | |

Notes for the plan, which this session does not edit:

- The row of the feature types names 3c; it also adds a member to `StepContext`, two to `State` and one to the patch of `FeatureModule`.
- The row of the sections ("What a section of the document touches") gets `documents`, with the context its validation needs.
- 3d's precondition of the kernel port (no face number in both operands) holds for inserted bodies as for any: two bodies of one insertion share a face number where they shared one in their document.
- 5b: an inserted body is a body of a link with its mass, exported like any.

## Open

For the owner, each answerable in one line:

1. **A stored document is a copy inside the host document**, changed only by `replaceDocument` (a new revision is inserted on purpose). *Yes* keeps the design; *link* means the entry also keeps the path of its file and the app and the tool can refresh the copy from it on request (the copy stays the source of the model); *path* means the file is read on every load, with the host no longer one file.
2. **An inserted part is recomputed from its features** (its faces keep their names, a sketch and a seat can be drawn from them, its parameters can be set per insertion), not frozen as meshes. *Yes* keeps the design; *no* means 3b's meshes with the properties of the document.
3. **The parts list counts bodies.** A bought part modelled as several bodies (a bearing as two rings and balls) is several rows; the document of a bought part is modelled as one body. *Bodies* keeps the design; *insertion* means the bought bodies of one insertion are one row, named after the stored document, with their masses summed.
4. **Features of the host may change an inserted body** (a hole into an inserted printed bracket); only a body with a face of an imported mesh is refused. *Yes* keeps the design; *no* refuses every inserted body as a target, as 3b refuses a mesh.
5. **Documents inside documents** (a kit that inserts a bearing) are allowed, eight levels deep. *Yes* keeps the design; *one* allows only a document that inserts nothing.

No third-party library is needed for what is designed.

## Reviews

The design was written on Claude Opus 5.5. Three reviewers per round, read-only, each against the code of `master`: a fresh subagent on Opus 5.5 (the internal reviewer while Fable is unavailable), codex (`gpt-6-astra`, high effort) and agy (`gemini-4-argon-high`).

### Round 1 (2026-11-17, on the first version at `51d0fda`)

agy could not run: its account was out of quota (HTTP 429), tried once. Codex gave 15 findings (1 blocker, 7 major), the Opus subagent 23 (3 major, the rest minor, factual or gaps); they share six. Each was checked against the code (`mergePatch` and `sameVariant` of `document.ts`, `RESOLUTIONS_KEPT` of `evaluate.ts`, `faceKey`, `newId`, `requireRef`, `evaluate` of `body-properties.ts`, `measure` of `interference.ts`) or taken from the reviewers' probes, which were read. Both found sound: a copy inside and recomputed as the cheap variant, the rejection of a path, frozen meshes, frozen face tables and flattening; the re-entrant use of one evaluator (apart from the kept results of sections, which the design already separated); `validateDocument` passed to the section as a context against the import cycle, and the upgrade of a stored document from its own version; one map of face numbers per insertion; features on inserted bodies; counting the inserted hardware from faces; the schema step; most of `calls.ts` against the arm (origins, the seats, two rows at another value, the failed check).

| # | Finding | Reviewer | Severity | Accepted | What changed |
|---|---|---|---|---|---|
| 1 | Keys of faces are not unambiguous with prefixes: IDs may hold `@` and `:`, so two copy histories give one key; a name that is not there can alias a real face | codex (blocker), subagent (minor) | blocker | yes (`faceKey`, `newId`) | the key of a face of an insertion quotes the inner key as JSON; the validator of a name requires one owner and the prefixed tags first; "To verify" names the cases |
| 2 | The owner of a prefixed ID must be an insertion, not any feature that names faces | codex | major | yes | the reference kind `insertion` |
| 3 | The kept placed solid by the first face number misses a renumbering of the rest of its faces | codex | major | yes | the key holds the new number of every face of the solid and the transform by its numbers |
| 4 | Two insertions with the same values are one origin only while the memo keeps the resolution (eight per feature); the list then depends on the history of edits | codex, subagent | major | yes (`RESOLUTIONS_KEPT`; both probed it) | an insertion takes the recompute of an earlier one of the same entry and values from the state before it (`State.insertions`); "Rejected", 12 |
| 5 | The published body properties apply the use: an auxiliary body's mass is gone, so a host that makes it a reference part cannot inherit it | codex | major | yes (`evaluate` of `body-properties.ts`) | `InheritedProperties`: what the chain states, before the use, computed by the evaluator |
| 6 | `kind`, `type`, `generator` are legal parameter names, and the merge of a patch reads them as a reference or a variant | codex | major | yes (`mergePatch`, `sameVariant`) | `patch.dictionaries`: the merge takes `parameters` key by key |
| 7 | The check of a parameter name by a command has no mechanism: the validator cannot tell what came from the patch | codex, subagent | major (codex), minor | yes | every value is a reference of the kind `parameter`, checked when new |
| 8 | The inserted document's own chord tolerance changes verdicts of fits, not only accuracy | codex | major | yes (`measure`, `verdictOf` take the host's) | the stored document is recomputed with the settings of the host; "Rejected", 13; the known limit restated |
| 9 | The clip's sketch: the channel overlaps the block, both extrusions `invalidProfile` | codex, subagent | major (subagent), minor | yes (both replayed it) | the channel in a sketch of its own |
| 10 | One `shop` engine models both parts, so the clip document holds the bearing, and the revision is of both | codex, subagent | major (subagent), minor | yes | an engine per part; the old version as a fixture (`asSavedByMaster`) |
| 11 | Exact equality of two placed volumes (float32); the bearing document has two features, not three | codex, subagent | minor, factual | yes (probed: 1.5e-4 mm³ apart) | a relative tolerance; two |
| 12 | Nested `insertedIssues` is lost one level up | codex | minor | yes | it is carried up with prefixed refs |
| 13 | The draft lacks the state after the package, the section context, 3b's `importedTarget`, the failure union of a command | codex | minor | yes | `StateAfter3c`, `SectionContext`, `IssueAfter3c`, `CommandResultAfter3c` from the real failure |
| 14 | Payloads: a stored document may hold meshes and nested documents; `get_document { stored }` prints them; depth counted on add as on load | codex, subagent | minor, gap | yes | "Known limits", the depth rule, `get_document` shortens recursively |
| 15 | `requireRef` lives in `features/index.ts`; a load does not reuse the memo | codex, subagent | factual | yes | "Where the code lives", "Known limits" |
| 16 | The arm has 20 features, not 22 | subagent | factual | yes | corrected |
| 17 | `gone()` leaves the engine without the bearing for the calls after it | subagent | minor | yes | it loads into a second engine |
| 18 | The ring overhangs the rim of `upper` by 1 mm (2 at D = 24), the seats open it; the revision runs 0.5 mm, not 1, into the forearm | subagent | factual | yes | the comments say so |
| 19 | A nested document's error carries no path, and its `expression` would mark a parameter of the host | subagent | minor | yes (probed) | `validateDocument(value, what, depth)`; the error of a command carries no `expression` from a stored document |
| 20 | `refused` #6 is refused by the body reference before the new rule | subagent | minor | yes (`requireRef` of a body) | the body `b1/ring` with a face of `b9` |
| 21 | `emptyResult` has a text about a cut | subagent | minor | yes | a detail of its own; a `MESSAGE` for the warning |
| 22 | `createsBody` answers for any local name, so `setBodyProperties` takes `b1/typo` | subagent | minor | yes | `bodyProblem` and `requireRef` ask the stored document |
| 23 | `parameters/*` against exact paths of `setField` and of the app | subagent | minor | yes | stated: `updateFeature` adds a value, the app matches `*` |
| 24 | k^depth recomputes; a document saved in a pose comes in unposed; no way back out to a file; the app's parts-list view names holes by `document.features` | subagent | gap | yes | "Known limits", `save_document { stored, path }`, "Where the code lives" |
| 25 | Smaller points: the order of inserted hardware rows, `names()` and `renameParameter` of the section, a default name "Cable clip / Cable clip" | subagent | minor | yes | stated; one body brought is named after the insertion alone |
| 26 | The name `insert` meets the heat-set inserts | subagent | minor (naming) | no | "Rejected", 14; the scenario's hole renamed |
| 27 | "Open", 1 is too binary: a link that keeps the copy and refreshes on request is a third answer | codex | minor | yes | the question has three answers |

The fixes are large (the key of a face, the shared recompute, the inherited inputs, three reference kinds, the merge of a patch, the tolerance), so a second round follows.

### Round 2 (2026-11-17, on the fixes of round 1 at `78a646a`)

agy could not run (HTTP 429, tried once). Codex gave 7 findings (4 major), the Opus subagent 9 (2 major); they share four. Each was checked against the code (`refKey`, `replacedPaths`, `patchPaths`, `removedPaths`, `withoutNulls` of `document.ts`; `upgradeDocument`; `validateSections`) and the reviewers' probes, which were read (the subagent ran 300 000 random names through the quoted key, the patch functions copied verbatim, and the memo with real adapters). Both found sound: the quoted key for every name the recompute makes and every consumer of keys (equality only); the owner kind `insertion`; the key of the kept placed solid; the state lookup under a memo hit or miss, `at`, preview, undo, reordering, suppression and load, given a right key; `InheritedProperties` before the use; the host's settings shared through `initial`; the validation context and the depth; `calls.ts` against the arm (the bearing and the clip recipes ran with the real adapters, all features ok).

| # | Finding | Reviewer | Severity | Accepted | What changed |
|---|---|---|---|---|---|
| 1 | The lookup by the values set as text misses the scenario's own pair (b1 sets `D` = 22, b2 nothing) and depends on the order of keys; `onePart` and the contract still credit the memo | codex, subagent | major | yes (both probed it) | the key is the evaluated environment of the stored document's parameters, sorted; the comments cite the state |
| 2 | `patch.dictionaries` reaches `mergePatch` only; `replacedPaths` and the other functions of a patch still read `kind`, `type`, `generator`, and drop the expressions of the other values | codex, subagent | major | yes (`document.ts`) | one predicate read by all five functions; "To verify" |
| 3 | `refKey` ignores the new `document` of a reference, so pointing an insertion at another stored document re-checks no name | codex, subagent | major (codex), minor | yes | `refKey` includes it |
| 4 | The rule of form of names is checked at the top only and says nothing of an unprefixed feature with a prefixed tag; a text field of a role aliases a tag (on `master` already) | codex, subagent | major (codex), minor | yes | the rule at every level and for unprefixed features; a found face is compared with the name asked for |
| 5 | `StateAfter3c` keeps the face and result types of master | codex | minor | yes | widened with 3b's face name and the results after 3c |
| 6 | `asSavedByMaster` must drop `schemaSteps` too, or the steps are taken as done | codex | minor | yes (`upgradeDocument`) | stated in the helper |
| 7 | Reuse of the recompute is stated as a guarantee; it holds only while the memo keeps it | codex | factual | yes | "Measured", "Known limits", the rows |
| 8 | The host's tolerance can make an inserted part invalid, not only finer | subagent | minor | yes (`detectProfile`) | "Known limits" |
| 9 | Paths of messages and the signature of `validateDocument` disagree (`upgradeDocument` and `validateSections` have their own prefixes) | subagent | minor | yes | `validateDocument(value, what, depth)` everywhere, `upgradeDocument` takes the path, the expected text corrected |
| 10 | `partName` can read the documents alone; "brings one body" is ambiguous; default names would flip with a parameter | subagent | minor | yes | names read from the documents; one body means a list of one; `InheritedProperties` has no names |
| 11 | Keys double their escapes per level and are printed raw in labels and messages | subagent | minor | yes | labels through `insertedFeature`; stated |
| 12 | Stale text: fingerprints of sketches hold no keys, "Rounds to follow" | subagent | factual | yes | corrected |

The fixes are of moderate size (a key of the environment, one predicate of the patch, a field of `refKey`, a recursive rule of form); the last round reads only their diff.

### Round 3 (2026-11-17, the last, on the diff of the fixes of round 2, `78a646a..32f27b6`)

agy could not run (HTTP 429, tried once). Codex gave 5 findings (2 major), the Opus subagent 9 (no blocker, no major); they share four. Each was checked against the code named (`validateSections`, the prefixes of `validateDocument`, `projectEdge`, `query/entity.ts`, `query/check.ts`, `query/measure.ts`, `defaultName`, `removedPaths` and `removable`) and the subagent's probe of `evaluateParameters`. Both found sound: the environment as the key of a shared recompute (apart from −0); one dictionary predicate for the five functions of a patch, also for a dictionary absent before the patch; `refKey` with the stored document; the recursive rule of form, which no name the recompute makes breaks and which leaves role fields such as `rim/center` alone; comparing a found face field by field; names from the documents with "a list of one"; `asSavedByMaster`, `StateAfter3c`.

| # | Finding | Reviewer | Severity | Accepted | What changed |
|---|---|---|---|---|---|
| 1 | The environment as text does not tell −0 from 0, which `atan2` does | codex, subagent | major (codex), minor | yes (probed by both) | a lossless writing of values, −0 as `-0`, in the key and in the substitution |
| 2 | The comparison after a key lookup covers faces, not edges; the places of the lookups are not listed | codex, subagent | major (codex), minor | yes | edges compare both faces; one helper; the files listed |
| 3 | Nested insertions share a recompute only through the memo (two recomputes of a kit are two chains) | subagent | minor | yes, as a known limit | step 3 qualified; "Known limits" (nesting is "Open", 5) |
| 4 | Paths of messages: `validateSections` and the prefixes of `validateDocument` are hard-coded | codex, subagent | minor | yes | all built from the path; the host's texts unchanged |
| 5 | "No text shows the key" is false: messages of queries and a label of the app print it | subagent | factual | yes | those sites print a label |
| 6 | "The default name there" is not recursive | subagent | minor | yes | names and part names by the same rules in the stored document |
| 7 | `{ parameters: null }` on an insertion without values is refused | subagent | minor | yes (`removedPaths`, `removable`) | `removable` answers for `parameters` |
| 8 | The tolerance does not refuse "a region thinner than it"; the divided outline is checked | codex | factual | yes (a rectangle 0.001 wide stays valid at 0.01) | reworded |
| 9 | Stale text: step 7 says values, the hardware paragraph `clip/insertHole`, the rows | codex, subagent | factual | yes | corrected |

This was the last round the rule allows. What is still open is in "Known limits": nested insertions shared only through the memo, the work of nesting, a part stored twice as two rows.

## Rows for the indexes

**`docs/d36/README.md`, the row of 3c** ("Design now"):

> full, designed 2026-11-17 ([3c-document-insert/design.md](3c-document-insert/design.md)), D62: the section `documents` (another document stored inside, as a copy, validated and upgraded as a document is; documents inside documents up to 8 levels), the feature type `insert` (3b's placement; values for parameters of the inserted document per insertion; a choice of its bodies) that recomputes the stored document by the same evaluator with the host's chord tolerance (two insertions with the same environment of parameters share one recompute through the state) and brings its bodies as `<insertion>/<ID there>` with every face under its name, the feature IDs prefixed `<insertion>/` and the key quoting the inner key; references to those faces check that the owner of the prefix is an insertion; body properties inherited from the inserted document; the parts list counts the hardware of inserted holes and two insertions of one document as one row; the warning `insertedIssues`; the tool `insert_document`; schema step `3c-document-insert`. Reviewed in three rounds (codex and an Opus subagent; agy out of quota). Open for the owner: five questions (a copy inside, recomputed not frozen, the parts list by bodies, features on an inserted body, nesting)

And in "Numbers": decisions D62 taken by 3c, next D63.

**`docs/decisions.md`, the row of D62**:

> | D62 | [3c Inserting another document as a part](d36/3c-document-insert/design.md) | designed 2026-11-17 | Another document is stored inside the host as a copy (the section `documents`; validated by `validateDocument`, so every upgrade step reaches it) and inserted by a feature `insert` that recomputes it by the same evaluator with the host's chord tolerance, with values for some of its parameters (references of their own, merged key by key), and places its bodies by 3b's placement. The bodies are `<insertion>/<ID there>`, every face keeps its name with the feature IDs prefixed (its key quotes the inner key, since IDs may hold `@` and `:`), and a reference to such a face checks that the owner of the prefix is an insertion, as a body ID is decomposed; so sketches, projections, seats and features use an inserted part like a modelled one. Body properties come from what the inserted document states (before its use is applied) unless the host sets them; the parts list counts inserted holes, and two insertions with the same environment of parameters share one recompute through the state of the recompute and are one row. Rejected: a path to the file, freezing as meshes or with face tables, a tag beside the name, flattening the timeline. Measured: a document of a part is 1 to 8 KB, its recompute milliseconds to 160 ms and nothing while the evaluator remembers it; a seat cut from the projected edge of a turned part meets it as a fit |

**`docs/requirements.md`, scenario 13, the part of this package**:

> - *Parts as inserted documents (3c, D62).* A ball bearing (8 × 22 × 7, test values) modelled as a document of its own by a build without the package (its outer diameter a parameter, a check of its wall, a bought part of 12 g) is stored once in the arm, upgraded on the way, and inserted at the elbow and at the shoulder on the points of `layout`, the outer diameter at the elbow driven by a parameter of the arm. Each comes in as one body `b1/ring`, `b2/ring` named after its insertion and its name there ("Elbow bearing / 608 bearing"), a bought part of 12 g by its own document (saved as `master` before the package saves it, and upgraded when stored), with its faces under prefixed names. The seats of both are cut into the upper arm from the projected outer edges of the bearings, and nothing collides; a sketch stands on the top of a ring; the bearings are bodies of the link `upper`; an edit before them leaves their solids the same objects. The parts list has "608 bearing × 2, 24 g"; a larger bearing at the elbow (one parameter of the arm) grows the ring and its seat together and makes two rows; a value the bearing's document does not hold up gives the warning `insertedIssues` with its failed check. A printed cable clip with a heat-set insert is inserted on the top face of the upper arm without its cable channel: a PETG part and the fifth M3 insert of the list; with the channel, the channel is auxiliary. Refused: a second document under a taken ID, a document that does not load, an insertion of a document that is not stored or of a parameter it does not have, removing a stored document in use, a face whose prefix is not an insertion, a body the stored document cannot make. A revision of the bearing 8 wide replaces the stored one and the ring at the elbow then runs into the forearm. A document whose stored part is gone loads with the insertion as a broken reference; a stored document with an unknown field or a newer version is refused on load. A kit that inserts the bearing is inserted into the arm with its names prefixed twice ([d36/3c-document-insert/calls.ts](d36/3c-document-insert/calls.ts)).

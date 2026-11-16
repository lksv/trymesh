# 5a Mechanism description and the posed queries (D49)

**State: implemented and merged 2026-11-16 (see "As implemented" at the end). Design, third version, after three rounds of reviews (see "Reviews"), with the owner's decisions of 2026-11-16 (see "Open") and checked on that day against the code of `master` with 3a and 2c merged (`a39aba4`, schema version 5); see "Checked against the code (2026-11-16)" and "Verified before the implementation". Written against the sixth version of the contract of the preparatory step (`0dc424b`) and against [3a](../3a-body-properties/design.md).** The types are in [contract.ts](contract.ts), the scenario as calls in [calls.ts](calls.ts); both are checked by `npx tsc -p docs/d36/tsconfig.json`. Validation scenario 13 is shared with 3a; this package writes the part "two revolute joints; the pose stepped through the range of one joint with the collisions asked at each step; the mass of what hangs beyond the first joint".

The package adds a section to the document. The shape of the section, its commands, its upgrade step and the way a pose reaches a query are decided in full; the app, the wording of the MCP answers and what the export of 5b builds on it are described.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Export for simulation": a mechanism description next to the parameters and the checks. A link is a name and a list of bodies that move as one piece; a body belongs to at most one link. A joint has a name, a kind (revolute, continuous, prismatic, fixed), a parent and a child link, an axis (`AxisRef`), limits as numeric fields that take expressions, and a value, the pose. The joints form a tree with one root; a reference to a missing body or link is a broken reference like any other. It replaces the move feature proposed earlier for the pose, and it serves the posed queries as well as the export. "Candidates": the AI steps a parameter and asks for the interference and the smallest gap at each pose.

The preparatory step has already decided how a pose reaches a query (`00-prep/contract.ts`, `QueryContext`): a pose is a state of the document; a query reads the geometry of bodies only from its context, which answers in the pose; what does not belong to a body (a sketch, an axis through a sketch point, a plane feature, a base plane) is never posed; an export always gets the bodies as modelled; over MCP a pose is asked with `after` of the tool `query`.

What the code says:

- **Everything a pose needs exists, in the pattern.** `AxisRef` (a base axis, or the normal of a sketch plane through a sketch point) with its validator `axisRef` and its references; the resolution of an axis against the state (`axis(ref, state)` in `recompute/services.ts`, which the pattern and the context of a query call); `RigidTransform`, `rotation(point, axis, angle)`, `transformPoint`, `transformFrame`, `transformSolid` and `transformFace` in `solid.ts`. A pose is a rigid transform per link, built from the same pieces as a copy of a pattern.
- **A step of the pose needs no solver and no kernel as a preview.** `applyCommand` returns a new document that shares the features; `Evaluator.run` still walks every feature and resolves its expressions, and finds every step in its memo (the memo follows the feature object and the values of its expressions, not the document); `evaluate` builds the map of bodies, where `analyzeBody` remembers its result by the mesh, and evaluates the checks. What remains is linear in the timeline and small.
- **The answers about pairs are remembered by the meshes.** The query `interference` (`query/interference.ts`) keeps what two bodies share through `context.memo`, by the two `Solid` objects. Before that `interferenceReport` (`interference.ts`) rejects a pair by the boxes of the two bodies, and `sharedBy` takes the allowance for the precision of the coordinates from the same boxes (`coordinatePrecision` of `mesh-distance.ts`); every pair of the bodies asked about is visited at every call. So what is remembered is found again only if the same two objects, with the same boxes, come back. The gap of 1c (`gapOf` in `query/gap.ts`) remembers a pair the same way.
- **The expressions know the parameters only.** `Environment` in `expression.ts` is the table of parameters ("later also values produced by the recompute"). A joint value named inside the expression of another joint would be a second kind of name with its own order of evaluation.
- **A command sees the numbers of before its batch.** `Fields` in the mode `update` does not evaluate the expression of a field the command does not name, and the numbers are written back after the whole batch (`settle`). A rule between two fields that is checked against the stored numbers is checked against the parameters of before the batch.
- **The view draws `evaluation.bodies[id].solid`** (`modelScene` in `packages/app/src/scene.ts`), and the app asks the collisions for the state it shows through the generic form of a query (`panels/query.ts`, with the view `interferenceView`), which calls `engine.query` and shows the message of an outcome that is not ok.
- **`interference` is one of the four methods of `Engine` that throw**; it runs the entry of the catalog over the same context as `query` (`contextOf` in `engine.ts`), so it answers in the pose as well. An exception out of it is not a `ToolError`: `callTool` lets it through, the server reports "the tool failed" with its message, and the bridge to the app reports an error of the app that may have changed the document. `check_interference` is the one tool that still calls it.

## The cheap variant

A section `mechanism` of the document with links (a name, bodies) and joints (a kind, a parent and a child link, an axis as `AxisRef`, limits and a value as numeric fields). Five commands. The model as modelled is the zero of every joint. The recompute resolves the section into `evaluation.mechanism`: for every link the transform that takes it from where it is modelled to the pose, for every joint its numbers, its axis and its state. The context of a query applies those transforms to the bodies it hands out, so every query answers in the pose with no change of its own; a pose is stepped by previewing `setPose` (or a parameter) and asking over the previewed state. One query, `mechanism`, returns the resolved description.

**Deferred**, and why each can come later without a change of what is saved now (the entries of the section are validated strictly, so a new optional field is refused by a build that does not know it; no further upgrade step):

- A joint value named in the expression of another joint. A coupled motion goes through a parameter: both values follow `q`.
- A joint whose zero is not the modelled configuration (a field for the value the joint has as modelled), and a flag that reverses its direction.
- The axis of a cylindrical face or of a circular edge as a kind of `AxisRef`. It would serve the pattern as well and belongs to the shared vocabulary.
- An axis or a point that moves with a link as an argument of a query (a reference by joint, resolved to its axis in the pose). Until then an axis given to a query is as modelled while the bodies are posed; the description for the AI says so, and the axis of a joint in the pose is in the answer of the query `mechanism`.
- Effort and velocity limits, rotor inertia and gear ratio: numbers the export of 5b passes through; 5b adds them to the joint.
- Named poses kept in the document.
- A copy of a pattern that follows its source into a link (an option of the link).
- A sweep in one call, and the static load of a joint as a query (the mass beyond it, the torque for a direction of gravity). Scenario 13 composes both from the calls that exist.
- Closed loops, and joints with more than one freedom.
- A picture of a pose that is not written. `view_image` (1f) draws a state of the document, so with this package it draws the pose the document holds; the path of an operation of the app has no `after` (the open need of 1f), so a pose that is only previewed cannot be drawn. It comes with 5b (owner, 2026-11-16; see "Open"); until then a pose is written, drawn and undone.
- In the app: dragging a link in the view.

## The section

```ts
mechanism: { links: Record<Id, Link>; joints: Record<Id, Joint> }   // in Document, always present
```

`Link` and `Joint` are in `contract.ts`. The decisions:

- **The model as modelled is the zero of every joint.** A body stands where the timeline puts it when every value is 0. A joint value is then a displacement from the modelled place, and no link needs a stored placement (see "No placement of a link").
- **Records by ID, with an optional name.** A joint names its links, so a link needs an identity that a rename does not change: an ID chosen by the caller, as for features, and a name for people, by the rules of a body name in 3a. The IDs follow the rules of every ID. They are unique among the links, and among the joints; they do not share the namespace of the features, because the natural ID of the link that holds the body `forearm` is `forearm`.
- **A link lists its bodies.** Membership is explicit: a copy of a pattern is a body of its own and is listed. The result names the bodies of the model that are in no link (`unassigned`), so a forgotten copy shows instead of silently staying behind. A link may be empty. The list keeps the order it was given; the order means nothing beyond how it is shown.
- **A joint is a variant by kind**, like an extent: a revolute and a prismatic joint have an axis, two limits and a value; a continuous joint an axis and a value; a fixed joint nothing. The limits are required where the kind has them: a turn without limits is the continuous kind, and a shift without limits is not a joint anyone builds.
- **The axis is an `AxisRef` as it is today**, given in the modelled configuration. It is never posed by itself: the joints nearer to the root carry it along with the parent link. That is exactly what the preparatory step says of an axis through a sketch point, so the section needs no reference of its own. A positive value turns by the right-hand rule about the direction of the axis, as a pattern does; for a sketch point that direction is the normal of the sketch plane.
- **`value`, `lower` and `upper` are numeric fields** by the rule 3a set for a section: a number or an expression in a command, the last valid number in the document, the expression in `expressions` of the joint, written back by the recompute, renamed with a parameter. The ranges are in `JOINT_FIELDS`: the limits of a revolute joint lie within a full turn each way, so degrees typed by mistake do not pass.
- **Strict entries**: the section, a link and a joint each list the fields they allow, on a command and on a load.

### What is always true of the section, and what may break

The section is small, and every rule about it alone can be checked without a recompute. So, unlike the references between features, the references inside the section are kept whole by the commands, and a load checks them too:

- a body is in at most one link, once;
- the parent and the child of a joint are links of the section and differ;
- a link is the child of at most one joint, and no link hangs on itself through a chain of joints.

Together these make the joints a forest. **One root is not required.** A mechanism built one command at a time has several roots until its joints come, two arms on one table have two, and a pose is well defined for a forest: every root stands as modelled. The result lists the roots; the export of 5b, which needs one, refuses the others.

`removeLink` is refused while a joint names the link. (The backlog proposed that a reference to a missing link be a broken reference "like any other". For features that rule exists so that deleting in the middle of a timeline does not cascade; a joint whose link is gone has nothing left to compute, and one command can check the section whole.)

What a command checks only when it sets it, and what can break later:

- **A body named by a link** has to be one a feature of the document can create, as in 3a; only the bodies the link did not have before are checked. Later the feature may be removed or suppressed: the link then poses its other bodies and lists the body in `missing`.
- **The sketch and the point of an axis** are checked by `axisRef` as for a pattern; only an axis the joint did not have before. Later they may go: the joint is then in error (`brokenReference`).
- **An ID the section names may be taken over.** A link whose body is gone and a joint whose sketch or point is gone keep the ID. The point of an axis may be a derived one (`x1/center`, `x1/a` of a projected entity `x1`; `derivedPoints` in `document.ts`): what a caller chooses and may reuse is then `x1`, so `names` gives the projected entity with the point, as it gives the feature of the body `screws/2`. A feature or a point added later under that ID enters the link, or becomes the axis, without a command about the mechanism. That is wanted when the thing is made again and a trap when the ID is reused for something else (the generator of the app starts at 1 in every session; `freshIds` hands out the ID of a removed point that only a section names). The guards are those of 3a, which belong to the registry of sections: the entry of this section gives `names` (the feature of every body of every link, the sketch and the point of every axis), so the generators of IDs count them as used (`namedBySections`), and `execute` and the status line of the app name what a command took over (`takenOver`).
- **`lower` not above `upper`, and `value` within them.**
  - A command refuses a pose outside the limits; that is what tells an AI at once that a step of its sweep is beyond the range.
  - It compares the numbers as they are for the document it is applied to. A field with an expression is evaluated against the parameters of that document, also when the command does not name the field: the stored number may be that of before the batch. (A command that widens a limit through a parameter and then poses within the new limit, in one batch, is in `calls.ts`.) Nothing of the timeline is computed for it.
  - A field whose expression does not evaluate takes no part in the comparison. So a form that sends a whole joint back with an expression that broke meanwhile is not stopped by it, and the recompute reports it.
  - **Within the limits, to a tolerance** (`LIMIT_TOLERANCE`: the tolerances of the engine for an angle and a length). A value outside by no more than that is the limit, and is used and stored as the limit. The last step of a sweep computed in floating point, and a limit read from a tool that prints six decimal places, are otherwise refused at random.
  - A parameter may move any of the three later, so a load does not ask and the recompute does: `jointLimits`, `jointOutOfLimits`.
  - **What is written back.** A limit is written when it lies in the range of its field, also when the two then cross; the joint is in error and the document says why. A value that an expression takes out of the limits is not written; the field keeps its last valid number, as a field of a feature does when its expression leaves its range. A value without an expression whose limits moved away from it stays what it was set to: the rule of the last valid number is about expressions.

## Commands

`setLink`, `removeLink`, `setJoint`, `removeJoint`, `setPose` (`contract.ts`). They are ordinary commands: `execute`, `preview`, a batch, `after` of the tools.

- **`setLink`** creates the link or changes the fields named; `bodies` replaces the list. Moving a body from one link to another is two commands in a batch.
- **`setJoint`** creates or replaces the whole joint in the input form. A joint has at most three numbers, so a merging patch like that of `updateFeature` is not worth its rules; what is taken over from it is that a string equal to the expression the field already has is kept without evaluation.
- **`setPose`** sets the values of the joints it names. It is the command of a sweep and of `after`. Executed, it is one undo step; previewed, it writes nothing. A number removes the expression of a value, so it also takes a joint out of a coupled motion; that is what the command says, and the app does not send it for a value with an expression (below).
- **An error of a command** about an expression names the field by its address inside the section, as in 3a: the joint, a slash, the field (`elbow/value`).

## The result of the recompute

`evaluation.mechanism` (`MechanismResult` in `contract.ts`), computed after the timeline with the results of the other sections, from the section, the environment of the parameters and the state of the timeline the evaluation is of: the final one, or the one after the feature asked for with `at` (the frames and points of the sketches, for the axes; the bodies, for `missing`).

- **The transform of a link.** A root has the identity. For a joint with the motion M (a rotation about its modelled axis by its value, a translation along it, or the identity for a fixed joint), `T(child) = T(parent) ∘ M`: the child is first moved about the axis where it is modelled, then carried with the parent. The transforms are computed in double precision from the modelled configuration every time; nothing accumulates.
- **A joint in error** has no motion: its axis does not resolve, a field is in error, its limits are crossed or its value is outside them. Its child link and everything beyond it are *blocked*: `blockedBy` names the joint. Their transforms are still there, with the joint counted as standing at zero, so that the app has something to draw; no query reads them (below).
  - **One exception: a joint at zero.** A joint whose only fault is its axis and whose value is 0 moves nothing whatever the axis is (a turn by zero is the identity exactly). It is in error and blocks nothing. So a model whose pose is zero stays readable while the sketch of an axis is being repaired, and so does the body a new axis will be taken from.
- **The axis** of a joint is given as modelled (`axis`) and as the parent link carries it (`axisInPose`).
- **What hangs on a joint** is not in the result, where every joint would repeat the lists of the joints beyond it. `carriedBy(section, result, joint)` gives it: the links beyond the joint, their bodies that the state has, and the bodies they list that the state does not have. A sum over the bodies is short by what is missing, so whoever adds up a mass looks at `missing` first.
- **Stable objects**, as in 3a: the result of a link or a joint is the same object while what it is computed from is the same. (The registry of 3a keeps a result stable by its top-level keys, which for this section are `links` and `joints` as wholes; see "What the implementation takes from 3a".)
- **The bodies of the evaluation do not move.** A feature that refers to a face, a sketch on a face and every export see the model as modelled, whatever the values are.

Two issue codes are added: `jointLimits` and `jointOutOfLimits`. The others a joint can have exist: `brokenReference`, `invalidExpression`.

## How a pose reaches a query

The context of a query (`QueryContext` in `query/spec.ts`) is built by the engine for the state asked about, by one function (`queryContext` in `query/context.ts`). Every query of the catalog reads the geometry of bodies only through it (`body`, `measure` with `entityShape`, `section`, `gap`, `mass`, `print`, `interference`), so this is the one place a pose enters. With this package it reads `evaluation.mechanism` of that state and poses what belongs to a body:

- `bodies[id]`: the body of the evaluation moved by the transform of its link (`poseOfBody`). Positions, the segments of the edges and the bounds are transformed; the volume, the faces and the names stay. A body in no link, or in a link with the identity, is the object of the evaluation itself.
- `surface(body, face)` and the frame of a face (`frame` with a face, an entity that is a face or an edge): moved the same way.
- A plane feature, a base plane, a sketch and its points, an axis: as modelled, by the rule of the preparatory step.

**A state after a feature is posed like any other.** A state asked for with `at` (of `query`, of a tool, of a preview) is a point of the construction of the model. Its `evaluation.mechanism` is the section resolved against that state, and the context poses by it: a body that is not made yet is in `missing`, and a joint whose axis stands on a sketch that comes later is in error at that point.

- With the exception of a joint at zero (above), **a document whose pose is zero and whose joints have no fault other than an axis answers at every point of its timeline as it does today**. That is every document of today, and a model during its construction; `check_interference` with `at` and the marker of the app keep their answers.
- A fault of a limit or of an expression does not depend on the point asked about: the parameters are those of the document whatever `at` is (`Evaluator.run` and `Evaluator.evaluate`). A joint with such a fault blocks at the end of the timeline as it does at every point, also at zero (a parameter that moved the limits away from 0, a limit whose parameter was removed); `at` adds no case of its own. The exception is kept to the axis on purpose: an axis that is not there yet is the normal state of a model under construction, a zero outside the limits is a pose the document says the mechanism cannot take.
- A document whose pose is not zero answers in that pose wherever the axes of the joints that moved exist. A sweep with `at` and `after` together steps the pose of that state.
- Before the sketch of such an axis the bodies beyond the joint are blocked, and a query that reads them fails and names the joint; a query about the other bodies answers. It does not answer for the model as modelled instead: the caller asked about a document with a pose, and would not be told that the pose was dropped (`calls.ts`, `bentAtLayout` and `bentBeforeTheAxes`).
- **The way to a blocked body that writes nothing** is the same question with the joint previewed at zero: `after: { type: 'setPose', values: { elbow: 0 } }`, with or without `at`. A joint at zero whose only fault is its axis blocks nothing. The message of the failure says so, so that the loud failure tells an AI what to do.

**Lazily, and remembered.** A body is posed when a query reads it, so a query about one body moves one body. A posed body is remembered by the modelled solid and the transform (a few poses per solid), so a body that did not move between two steps of a sweep is the same object in both. The transform is compared by its numbers, not by the identity of its object, so the memory does not depend on how the registry of sections keeps a result stable.

**A pair is computed in the frame of its first body.** What two bodies share, and how far apart they are, depends only on how they stand to each other. A query of the engine about a pair (the collisions; the gap of 1c) asks `pairInFrame(a, b)` and gets the first body as modelled, the second moved by the motions of the joints between their two links, and the transform back to the pose. It computes from those two bodies, with their boxes and their faces, and moves a coordinate of its answer back; a volume, a depth and a distance need nothing.

- Two bodies of one link are computed as modelled, once, whatever the pose; flush faces stay bit for bit what they are in the model.
- In a sweep of one joint, only the pairs with one body on each side of that joint are computed at every step. The pairs beyond the joint keep their relation and are found in the memory, as are the pairs before it.
- The motion between two links is composed from the motions of the joints on the way from one to the other, not from their two transforms to the pose. It is therefore the same numbers whenever those joints have the same values, and the moved second body is the same object.
- The answer no longer depends on which pose asked first: the boxes that reject a pair and the allowance for precision are those of the two bodies in the frame of the first.
- It is also what keeps a pair across one joint exact in single precision: one body is as modelled and the other is turned about the axis of that one joint, so faces that are flush across a joint along a coordinate axis stay in one plane bit for bit, however the joints nearer the root stand. Two bodies posed to the world separately are rounded apart, and the kernel then refuses most poses of such a pair ("Verified before the implementation"). A query about a pair asks `pairInFrame`; it does not compute from two entries of `context.bodies`.
- **The pair is ordered.** `pairInFrame(a, b)` and `pairInFrame(b, a)` hand out different objects (the frame is that of the first), and an answer in coordinates is in that frame until it is moved back. A query that remembers an answer about a pair through `context.memo`, whose owners have no order, orders the pair itself before it asks, as the collisions and the gap do by the two IDs (`calls.ts`, `gapInPose`), or puts the order into its key.
- The function gets two bodies of the context and finds their links by itself: the engine keeps, for every posed body it hands out, the modelled body and the motions of the joints from the root to its link. A body the context handed out as the object of the evaluation (in no link, or in a link that stands as modelled) has no such record and counts as standing at a root.
- What the two readers of today get from it. The collisions (`interferenceReport`) take the boxes that reject a pair, the precision and the two meshes from the pair in the frame; their report has no coordinate, so nothing is moved back. The gap (`gapOf`) takes the same and moves its two points back; it orders every pair by ID before it asks, so the frame of a pair is always that of the same body, and it goes on remembering which mesh was the first, as it does today. Its `accuracy` (`meshAccuracy`) is an estimate from the chord tolerance and the size of the coordinates and is read from the pair in the frame as well, so that it does not change with where the pair stands.

**A blocked body cannot be read.** Reading `bodies[id]`, a surface or a frame of a body whose link is blocked throws `QueryFailure('failed', …)` naming the joint. So a query answers for the pose that was asked, or says why it cannot; it never answers for a pose in which a joint silently stood still. A query that does not touch the blocked bodies answers as usual. (`Object.keys(bodies)` reads nothing; the checks before `run` look names up in the evaluation, where they do not depend on the pose.)

- Considered: a joint in error stands at zero and the query answers, as a feature in error is an empty operation. Rejected: a sweep over MCP returns only the answer of the query, so an AI would read "no collisions" at every step of a joint that did not move.
- The one caller of today that does not expect a failure is changed by hand, with this package: `check_interference` calls `Engine.interference`, which throws, so the tool catches the failure and answers with the reason as an error of the call. `get_body` asks `query('body')` and turns an outcome that is not ok into an error of the call already. The collisions of the app are the view of the query `interference` in the generic form of 1b, which asks through `query` and shows the reason of a failed outcome; nothing is caught by hand there.

**Stepping a pose.** In the engine: `preview` of `setPose` (or of `setParameter` for a coupled motion), then `query` with the previewed state; `calls.ts`, section b. Over MCP: the same command in `after` of the tool `query`.

**The query `mechanism`** returns `evaluation.mechanism` of the state asked about, and with the argument `beyond` what hangs on that joint. It exists so that the resolved description is reachable through the tool `query` by construction, with `after`: where the links stand in a pose that is not written, which joint is in error, what a joint carries. Its answer grows with the section, which the caller wrote, as the answer of `get_document` does; `beyond` takes one joint so that the answer does not grow with the square of it.

**What stays as modelled**: every export (the context of a format is never posed), `evaluation.bodies`, and with them `get_model`; a query whose entry says `geometry: 'modelled'` (the print query of 1e); and any query a caller asks with the option `geometry: 'modelled'` (below).

### The model as modelled, by name

Decided by the review over the whole set (rows 18 to 20 of [cross-review.md](../cross-review.md)): the pose appears with this package, so this package makes the additions to the shared types that its own "Needs" asked of the preparatory step. They are in `contract.ts` (`GeometryOption`, `EngineWithPose`, `PoseNote`).

- **An entry may say that it computes from the model as modelled**: `geometry: 'modelled'` on `QuerySpec`. The engine then hands it the context an export gets. The print query is marked: a part is printed as it is modelled, and an orientation given as a direction would otherwise be judged on a turned body.
- **A caller may ask any query about the model as modelled**: `geometry: 'modelled'` in the options of `Engine.query` (next to `at` and `state`) and as an argument of the tool `query` (next to `at` and `after`). Nothing is posed, so nothing is blocked. It is the way to a body beyond a joint that cannot stand at zero or is at fault for more than its axis, and the message of a blocked body names it.
  - It is asked for by name, per call. A state asked for with `at` is still posed (the back door of the second version stays closed): the caller who gets a modelled answer wrote the word.
- **A tool says which pose it answered for.** When the state asked about has a link that is moved and the answer was computed in the pose, the tools `query`, `check_interference` and `get_body` put a note beside their result: the joints whose value is not zero, with their values (`poseNote`). The result itself does not change shape, and a document without a pose answers as today.
  - Where the note travels is for the implementation; proposed: an optional `about` beside `result` in the outcome of a tool (`ToolOutcome`), which the server prints as a second text, as it prints `about` of a picture since 1f. What must hold: the result of a query is the result alone, and the note is there exactly when a link is moved and the answer is posed.
- **`get_body` prints the volume and the bounds of the description** (`query('body')`), not of the state, so that one answer is not half posed.

### No placement of a link

The preparatory step left the placement of a body (any orientation against a directed frame, numbers with expressions, a `RigidTransform` as the result) to the first package that needs it, and named this package as a candidate. It does not need one:

- the bodies of a link stand where they are modelled, and that is the zero configuration;
- the frame of a link that an export needs is derived (below);
- a part that is modelled in its own frame and put into the assembly is an inserted or imported body, and its placement belongs to the feature that inserts it (3b, 3c).

So the requirements written in `00-prep/contract.ts` stay for 3b.

## What the export of 5b will need

Not designed here; listed so that nothing it needs is missing from the section or the result.

- **The tree**: `links`, `joints`, `roots`. The export takes one root. It refuses several roots, a joint in error, and a link that lists a body the model does not have (`missing`): a link without its motor would be exported lighter than it is. Bodies in no link are not part of the mechanism and are left out (`unassigned` lists them).
- **Frames**: the frame of a link has the orientation of the model. Its origin is `axis.origin` of the joint the link is the child of; for the child of a fixed joint, which has no axis, the origin of the frame of its parent link; for the root the origin of the model. The origin of a joint in the frame of its parent is the difference of two such origins; the axis is `axis.direction`. Meshes are only translated.
- **Units**: the engine has millimetres, grams and radians; both formats want metres and kilograms. Lengths ·10⁻³, masses ·10⁻³, inertia ·10⁻⁹, the limits of a prismatic joint ·10⁻³.
- **The mass of a link**: the mass query of 1d over the bodies of the link as one piece, read as modelled (the context of an export), about the frame of the link. It reads the properties of 3a: a reference body counts with its stated mass, an auxiliary body is left out, a body without a mass fails the export with its name.
- **Meshes**: the bodies of a link that are not auxiliary, as modelled.
- **Names**: the IDs of links and joints are unique within their kind and hold no slash.
- **What is missing for the formats** and comes with 5b as optional fields of a joint: effort and velocity limits; for MJCF the rotor inertia and the gear ratio. What each format requires of a joint is checked against the formats by 5b, not here. A coupling of two joints lives in two expressions over one parameter; writing it as an equality of MJCF is 5b's to decide.

## Where the code lives

```
packages/engine/src/
  types.ts                 the section, the commands, the result (before `// --- porty` and after `// --- přepočet`);
                           RigidTransform moves here from solid.ts; `geometry` in QueryOptions
  sections/mechanism.ts    the entry of the registry of sections (3a): validation, commands, the result,
                           poseOfBody, carriedBy, poseNote
  sections/spec.ts, index.ts   the registry of 3a: `evaluate` gets the state of the recompute as well (below)
  schema.ts                the step `5a-mechanism`, SCHEMA_PENDING
  solid.ts                 what a pose composes: the product and the inverse of two transforms, a shift along an axis
  query/pose.ts            the posed bodies, surfaces and frames with their memory; pairInFrame
  query/context.ts         queryContext poses bodies, surfaces and the frame of a face, or hands them out as modelled
  query/spec.ts            `geometry` on QuerySpec
  query/mechanism.ts       the entry of the query; one line in QUERIES (query/index.ts)
  query/interference.ts, interference.ts   a pair in the frame of its first body: the boxes and what the kernel gets
  query/gap.ts             the same, and the two points moved back
  query/print.ts           marked `geometry: 'modelled'`
  export/index.ts, engine.ts   an export and `exportMesh` ask for the modelled context
packages/mcp/src/tools.ts  modelSummary, documentProblems; get_body, check_interference, query (the note, `geometry`)
packages/mcp/src/api.ts    a paragraph of the conventions
packages/mcp/test/queries.test.ts   the rows of the query `mechanism` in the two typed tables
packages/app/src/
  panels/mechanism.ts      the panel, as functions over PanelHost
  scene.ts, viewport.ts, picture.ts   the pose in the view and in a picture (below)
  app.ts                   stateBefore(0); the status line of what a command took over
packages/scenarios/test/scenario13.test.ts   the part of 5a, after the part of 3a
```

The imports go one way (`docs/architecture/repository.md`, guarded by `packages/engine/test/modules.test.ts`): `sections/*` comes before `document.ts` and `evaluate.ts`, `query/*` after them. So what resolves the section (the transforms of the links, `poseOfBody`, `carriedBy`) is in `sections/mechanism.ts` and reads `axis` of `recompute/services.ts`; what makes posed geometry and remembers it is in `query/pose.ts`. `interference.ts` does not import it: `interferenceReport` is handed the pair to compute from, as it is handed `shared` today.

The registry of sections of 3a takes the entry, with `names` for the IDs the section names; `validateDocument`, `applyCommand`, `renameParameter`, `Evaluator.evaluate`, `settle` and `differs` are not edited again, with the one exception named under "What the implementation takes from 3a". The upgrade step is `5a-mechanism` (`MECHANISM_STEP`): it gives a document without the field an empty mechanism, leaves a field that is there to the validation and reads nothing else.

**The life of a document** follows the table of 3a, with `5a-mechanism` for the name and W, the version of the `master` this branch starts from, for V. `master` saves version 5 since 3a was merged (the steps of D35 and D37, `2b-taper` and `3a-body-properties`), so W is 5 unless another step is merged before the branch is cut. On the branch the step is the fifth and last of `UPGRADES`, `SCHEMA_PENDING` is 1, and a document is saved with `schemaVersion: 5` and `schemaSteps: ['5a-mechanism']`; after the merge `master` saves version 6.

- A build that knows the step loads a document of the branch; one with the preparatory step that does not know it refuses it by the name; a build without this package refuses a document of the merged `master` by its version.
- A document saved by a build with 3a and without this package loads in a build with it and gets the empty mechanism. The other way it is refused.
- A field of a link or a joint that a build does not know (the effort limit of 5b) is refused, not dropped.
- **The hole of 3a's table is not here**, and since the preparatory step raised the version to 3 it is not in 3a either. A build from before the preparatory step accepts the versions 1 and 2 only, and a document of this branch has version W. It refuses it.

## MCP and the app

**By construction.** The five commands go through `execute`, `preview` and `after`; the types are in the parts of `types.ts` that `describe_api` prints; the section, its commands and the numeric fields of a joint (with the kind of joint each belongs to, `when`) are listed from `SECTION_INFO` in the generated part *Sections of the document* that 3a added; the query `mechanism` is reached by the tool `query` and listed with the queries, once it has its rows in the two typed tables of `packages/mcp/test/queries.test.ts`; `get_document` returns the section.

**By hand**, with tests:

- `get_model` gets `mechanism` when there is a link: the links with their bodies, the joints with kind, parent, child, the numbers and the expressions, the roots when there are several. The numbers are printed so that a limit read here is accepted as a value (the tolerance of the limits is wider than the rounding). The bodies it lists stay as modelled, and the description of the tool says so. The problems go next to `failedChecks`: joints in error with their code and message, links with missing bodies, bodies in no link. `execute` and `preview` return the same lists. With `at` the three lists are left out, as 3a leaves out its list of entries without a body: at a point of the construction they would name every joint whose sketch comes later and every body not made yet. The query `mechanism` with `at` gives the description resolved at that point to whoever asks for it.
- `get_body` prints the volume and the bounds of `query('body')`, not of the state (`solidInfo(body)` in `bodyDetail` today).
- `check_interference` and `get_body` answer a blocked body with the reason, as an error of the call (`check_interference` has to catch for it, `get_body` does already).
- The tools `query`, `check_interference` and `get_body` say which pose they answered for when a link is moved (`poseNote`; "The model as modelled, by name"), so that an answer for a bent arm is not read as one for the model as modelled. The tool `query` takes `geometry: 'modelled'`.
- `execute` lists what a command took over (`takenOver` of 3a), now also a sketch or a point that became the axis of a joint and a feature whose body entered a link.
- A paragraph of the conventions in `describe_api`: the model as modelled is the zero of every joint; the sign of a turn; a pose is stepped with `after: { type: 'setPose', … }`; a query answers in the pose of the document, also with `at`, where it fails for a body beyond a joint that moved and whose axis is not made yet; a body beyond a joint whose axis is broken or not made yet is read with the joint previewed at zero (`after: setPose`) or with `geometry: 'modelled'`; an axis, a sketch point or a plane feature given to a query is as modelled while the bodies are posed; exports and the print query are always as modelled; a pair in `fits` across a joint is a pin in its hole and not a collision, and is there in nearly every turned pose; a pair in `failed` is neither clear nor colliding, happens for such a pin in about one pose of thirty, and is asked again a little to the side; the axes of joints are best laid along the axes of the model, because the collisions across a joint askew to them fail in most poses.

**The app**:

- A panel *Mechanism* (`panels/mechanism.ts`, functions over `PanelHost` like the other panels): the tree of links and joints, the bodies of each link, the bodies in no link, the problems.
- A joint has a numeric field that takes an expression, and a slider between its limits. Dragging the slider previews `setPose`; releasing it executes it. The slider of a value with an expression is disabled: moving it would replace the expression, and with it a coupling, by a number.
- *Reset pose* sets every value without an expression to the value nearest to zero that its limits allow (zero itself wherever the limits contain it).
- Links and joints are made, changed and removed in forms of the panel: a link by a name and a pick of bodies, a joint by its kind, its two links, its axis (the picker of an axis that the form of the pattern has) and its numbers. Every confirmation is one command; removing a link that a joint names is refused with the reason.
- **The view shows the pose** in the model mode: the app applies the transform of the link to the mesh of each body, without new geometry. In the code of today that is a transform next to `solid` wherever the scene hands a mesh to the view: `SceneModel.bodies` and `SceneModel.faces` (`viewport.ts`; a highlighted face, the two bodies of a picked collision), the outline of a body (`modelScene` in `scene.ts` copies the segments of its edges, which are as modelled), the box the camera is fitted to (`modelBounds`), and the hit of a pick (`pickBody` answers in the pose; the face and the edge it names do not depend on it). What a view of a query adds (`QUERY_VIEWS`, `addToScene`) is in the pose already where it is coordinates of an answer, and gets the transform with the mesh where it names a body or a face. A picture of the model (`pictureModel` in `picture.ts`, the operation `view_image` of 1f) draws the same state the same way. That holds at the marker of the timeline too: the view shows the state at the marker by its own `evaluation.mechanism`, and a blocked link is drawn by its transform of the result (the joint that blocks it counted as standing at zero) and marked, with the joint named in the status line. In a sketch and in the form of a feature the view shows the model as modelled, because that is where sketches, planes and the references of features are; the status line says which of the two is shown.
- The collisions are asked for the state shown, so in the pose; the highlight of a pair follows. A blocked body is reported as the reason the collisions cannot be asked (the generic form shows the message of the outcome).
- The form of a query offers *as modelled* (the option `geometry: 'modelled'`) when the document has a link that is moved.
- `stateBefore(0)` of `app.ts` builds the evaluation of the state before the first feature by hand and has to give it a mechanism without bodies, as 3a gave it empty body properties. The status line of what a command took over (`takenOver`) speaks of body properties only today and has to name the mechanism as well.

## Shared vocabulary

**Taken**: from the preparatory step the additions to the unions, `QueryContext` and its rule of the pose, `QuerySpec`, `IssueAfter`, `UpgradeStep`, the tool `query` with `after`; from 3a the registry of sections with its numeric fields (`sections/fields.ts`), `SECTION_INFO`, the check of a body ID (`bodyProblem`), `namedBySections` and `takenOver` for the IDs the section names, and the properties behind the mass of a body; from track A the queries `gap` (1c) and `mass` (1d) and the generic form of a query (1b); from the engine `AxisRef`, `RigidTransform`.

**Added**:

| Name | Where | Who uses it |
|---|---|---|
| `mechanism` in `DocumentSections` and in `EvaluationAfter` | the shared maps | 5b; the app |
| `setLink`, `removeLink`, `setJoint`, `removeJoint`, `setPose` in `Commands` | | |
| `mechanism` in `Queries` | | |
| `jointLimits`, `jointOutOfLimits` in `IssueCodes` | | |
| step `5a-mechanism` | `UPGRADES` | |
| `geometry: 'modelled'` on `QuerySpec`, in `QueryOptions` and in the input of the tool `query` | the shared types of the queries (row 18 of the cross-review) | `print` of 1e; any caller |
| `poseNote` and the note beside the result of a tool | engine, MCP (row 19) | the tools `query`, `check_interference`, `get_body` |
| `poseOfBody`, `pairInFrame`, `carriedBy` | engine | the context of a query; the queries `interference` and `gap`, for a pair; 5b |

**No stand-in is left.** The first versions stood `standInGap` for the gap of 1c and used `standInMass` of 3a for the mass of 1d. Both queries are merged, and `calls.ts` asks them. What was assumed of them holds or is work of this package:

- `gap` reads the two bodies from its context, tells "further apart than the search distance" (counted in `apart`) from a distance, and names the two points a gap lies between. With this package it computes a pair in the frame of its first body and moves the two points back to the pose.
- `mass` reads the meshes from its context, so the centre of mass and the tensor are in the pose asked about; it reads the mass of a body from the properties of 3a (`massSourceOf`). It remembers the integrals of a mesh by the mesh, so a body that moved is integrated again in every pose it is asked in: a pass over its triangles, no kernel. Moving the remembered integrals by the transform instead is left to the implementation.

## Needs from the preparatory step

The four needs of the third version were read by the review over the whole set ([cross-review.md](../cross-review.md), rows 18 to 21) against the preparatory step as implemented. None is a need of another package any more: three are work of this package, one is answered.

| # | Need | What the review decided | Where it is in this design |
|---|---|---|---|
| 1 | The model as modelled, for a query (the print query by a direction, in a document with a stored pose) and for a caller (a body beyond a joint that cannot stand at zero) | Row 18, with this package: `geometry: 'modelled'` on an entry and as an option of the caller; `print` is marked | "The model as modelled, by name"; `GeometryOption` in `contract.ts`; `forearmAsModelled` in `calls.ts` |
| 2 | The tool `query` does not say which pose it answered for | Row 19, with this package: a note beside the result | The same section; `poseNote` |
| 3 | `get_body` would mix a posed and a modelled answer (the faces and edges of the query, the volume and the bounds of the state) | Row 20, with this package: the tool prints the volume and the bounds of the description | "MCP and the app" |
| 4 | The checks before `run` should not read `context.bodies` | Row 21, answered: the checker reads the evaluation (`checkArgs` with a `CheckScope` of the document and the evaluation), not the context | Nothing to do; the posed context is built after the check |

With need 1 met, the case that had no way out is gone: a body beyond a joint whose limits do not contain zero, or whose limit or value has a broken expression, is read with `geometry: 'modelled'`.

Notes for the plan:

- **Dependencies.** The code of this package needs 3a (the registry of sections) and the preparatory step. Scenario 13 needs 1c and 1d, and the app side the generic form of 1b; all three are merged. The plan has this row since the review over the whole set.
- **Shared places** this package writes to: the context of a query (`query/context.ts`); `interference.ts` and `query/gap.ts`, for a pair in a frame; `query/spec.ts` and `QueryOptions` (`geometry`); `viewport.ts`, `scene.ts` and `picture.ts` (the pose), shared with 1a, 1f and 3a; `get_body`, `check_interference` and `query` in `packages/mcp/src/tools.ts`; the registry of sections of 3a (`sections/spec.ts`, `sections/index.ts`).

## Checked against the code (2026-11-16)

The design was written against `0dc424b`, before parts 1 and 3 of the preparatory step, track A and 2a, 2b and 2f were implemented. It was read again against `master` at `a39aba4`, which has 3a and 2c (both merged on 2026-11-16 during this check; the design of 3a is read by its "As implemented" where the two differ, and 2c touches nothing this package names: a new feature type, its face roles and a query that reads catalogs only, without an upgrade step). Nothing the design decides had to change; what changed is where things are, what is already there, and what this package has to do itself. `contract.ts` and `calls.ts` follow, and `npx tsc -p docs/d36/tsconfig.json` passes.

| The design said | The code has | What changed here |
|---|---|---|
| The resolution of an axis is inline in `Evaluator.transforms`, to be cut out | `axis(ref, state)` in `recompute/services.ts`, which answers a line or the code of a broken reference with what it refers to; `axisRef` in `validation.ts` takes a `RefContext` (`refContext(doc, before)` of `features/index.ts`) | The names. A command of the section checks an axis with `refContext(doc, doc.features.length)`: the target has to exist and be of the right kind, and the rule of the order on the timeline cannot fail, as a section has no place on it |
| `Interferences`, a class with a `WeakMap` by two solids | The query `interference` with `context.memo`; `interferenceReport` and `sharedBy` in `interference.ts`; the allowance is `coordinatePrecision` of `mesh-distance.ts`. The report has no coordinates | The names; `interferenceReport` is handed the pair to compute from, and nothing of its answer is moved back |
| `standInGap`, `standInMass` | `gap` (1c) and `mass` (1d, reading the properties of 3a through `massSourceOf`) are merged | The stand-ins left the contract and the calls; see "Shared vocabulary" |
| The four needs from the preparatory step | Rows 18 to 21 of the cross-review: three are work of this package, one is answered | "The model as modelled, by name"; `geometry: 'modelled'` and `poseNote` in the contract |
| `queries/mechanism.ts`, `pose.ts` | `query/`, one module a query, the catalog in `query/index.ts`; the order of imports puts `sections/*` before `evaluate.ts` and `query/*` after it | `query/mechanism.ts`; the resolution of the section in `sections/mechanism.ts`, the posed geometry in `query/pose.ts` |
| The context of a query "of the preparatory step" | `queryContext` in `query/context.ts`, one function for the queries, the exports (`runExport`) and the four methods of `Engine` (`contextOf`) | It gets the pose or is told to hand out the model as modelled: an export, `exportMesh`, an entry marked `geometry: 'modelled'`, a caller that asks for it |
| A posed surface and the frame of a face | `Surface` is published per face (`evaluation.faceSurfaces`), derived from `FaceInfo` by `surfaceOf`; `transformFace` moves a `FaceInfo`, `transformFrame` a frame | A posed surface is `surfaceOf` of the moved `FaceInfo`, or a small function that moves a `Surface`; both are in reach of `query/pose.ts` |
| `transformSolid`, `rotation` "and the same pieces as a copy of a pattern" | `solid.ts` has those and `transformPoint`, `transformVector`, `transformFrame`; it has no product of two transforms, no inverse and no shift along an axis | Three small functions come with the package |
| `checkCollisions` in `app.ts`, `panels/collisions.ts` | Neither exists: the collisions are the view `interferenceView` of the generic form (`panels/query.ts`), which asks `engine.query` at the marker and shows the message of a failed outcome | Nothing to catch by hand in the app; `check_interference` is the one caller that still gets an exception |
| `get_body` catches | `bodyDetail` turns a failed outcome of `query('body')` into an error of the call already; it reads the volume and the bounds from the state | Only the volume and the bounds change (row 20) |
| "The app applies the transform of the link to the mesh" | `SceneModel` (`viewport.ts`) takes `{ id, solid, color?, opacity? }` per body and `{ solid, faceId }` per highlighted face; `modelScene` copies the segments of the edges; `modelBounds`, `pickBody`; `pictureModel` of 1f | The places are listed under "MCP and the app" |
| A picture is not mentioned | `view_image` (1f) draws the state after `at`, without `after` | It draws the pose the document holds; a pose that is not written is deferred; the owner put it with 5b (2026-11-16, see "Open") |
| "`upgrade` in `document.ts`", W "at least 3" | `schema.ts`: `UPGRADES` has four steps on `master`, the last `3a-body-properties`; `master` saves version 5 and `SCHEMA_PENDING` is 0 | "The life of a document": W is 5, the step of this package is the fifth, and `master` saves version 6 after its merge |
| Scenario 13 "becomes a test" | `packages/scenarios/test/scenario13.test.ts` exists with 3a: `arm()` builds the model of `build`, with the sketch `layout` after the three bodies of the arm | The part of 5a is added to that file |

Checked and found as the design assumes: `Fields` and its three modes (a string in a field is evaluated by a command; the rule that a string equal to the stored expression is kept is in `updateFeature` of `applyCommand` and is repeated by `setJoint`); `Evaluator.run` with `upTo` and the parameters of the whole document; `stateAt` and `preview(cmd, at)` in `engine.ts`; `analyzeBody` remembered by the mesh; `askedState` of the tools (`after` previewed with `at`); `callTool` letting through what is not a `ToolError`; the generators of IDs counting `namedBySections` (`freshIds`, `newId` of the app); the two markers of `types.ts`.

### What the implementation takes from 3a

3a is merged (`7e2445e`, with the fixes of its review; the indexes in `d525a31`). What follows was read in the code of `master`, not in the design of 3a.

- **The registry of sections** (`sections/spec.ts`, `sections/index.ts`): the entry `mechanism` of `DOCUMENT_SECTIONS` with `info`, `empty`, `validate`, `commands`, `renameParameter`, `names` and `evaluate`. The registry is typed by the fields of `Document` and of `Evaluation`, so the two types and the entry come together. `emptyDocument`, `validateDocument`, the default case of `applyCommand`, `renameParameter`, `differs` and `settle` ask the registry and are not edited.
- **One change of the registry itself.** `SectionSpec.evaluate(section, doc, bodies, environment)` gets the bodies of the state and not the state of the recompute (the sketch of the registry in the design of 3a had the state; the code narrowed it to what body properties read). An axis through a sketch point needs the frames and the points of the sketches, so `evaluate` gets the state of the recompute as well: `Evaluator.evaluate` has it at hand where it calls `evaluateSections`, and the entry of 3a does not read it. This is the first commit of the package: one parameter of `SectionSpec.evaluate` and of `evaluateSections`, no change of behaviour, the tests of 3a unchanged.
- **Stable results.** `evaluateSections` replaces a new result by one of the last four that is equal to it (`RESULTS_KEPT`, so that a preview in between does not push out the result of the document), per top-level key of a result: a body for 3a, but `links`, `joints`, `roots` and `unassigned` as wholes for this section. For a link or a joint to be the same object while nothing about it changed, the memory goes one level deeper for this section (an entry says how its result is keyed), or the claim is dropped; nothing in this design depends on it since the memory of posed bodies compares transforms by their numbers.
- **Numeric fields of an entry** (`sections/fields.ts`): `readEntryFields` (through `Fields`, an error addressed `<joint>/<field>`), `resolveEntryFields` (the recompute, and the comparison of the limits by a command against the parameters of the document it is applied to), `writtenEntry`, `renamedEntry`, `storedExpressions`. `SectionFieldSpec` has `when`, for the kind of joint a field belongs to.
- **The check of a body ID**: `bodyProblem(doc, body)` in `features/index.ts` (the feature exists and creates such a body; the order on the timeline is not asked).
- **The IDs a section names**: `namedBySections` and `takenOver` read `names` of every entry. `takenOver` counts features, and points, curves and projections of sketches, which covers a body of a link and the sketch, the point and the projected entity of an axis. The generators (`freshIds`, `newId` of the app) already ask.
- **The schema**: `UPGRADES` ends with `3a-body-properties`, `SCHEMA_PENDING` is 0 and `master` saves version 5. This package appends `5a-mechanism` as the fifth step and sets `SCHEMA_PENDING` to 1; the merge sets it back to 0, and `master` then saves version 6 (CLAUDE.md and `docs/architecture/api.md` name the version). The two steps touch different fields and give the same document in either order; the test of `schema.test.ts` that runs pending steps before and after the merged ones covers it.
- **MCP**: `documentProblems` (where the lists of 3a are) takes the lists of the mechanism, and leaves them out with `at` as 3a does for its entries without a body; the generated part *Sections of the document* and the numeric fields of `describe_api` list the section from `SECTION_INFO` without an edit; `takenOver` of `execute`.
- **The app**: `stateBefore(0)`, which empties `bodyProperties` with the bodies and has to do the same for the mechanism; the status line of `takenOver` ("An ID that body properties name is now used again"), which has to speak of the mechanism as well; `SceneModel.bodies` with `color` and `opacity`, next to which the transform goes; the form of a body (`panels/body.ts`) as the model of a form of the panel.
- **The mass**: the query `mass` reads the mass of a body from `evaluation.bodyProperties` through `massSourceOf`, says per body where its mass came from (`from`), lists auxiliary bodies in `skipped` and fails with the name of a body that has no mass or whose mass cannot be evaluated. The mass beyond a joint of scenario 13 is that query over `carriedBy(...).bodies`.
- **Scenario 13**: `scenario13.test.ts` with `arm()` and the part of 3a; the part of this package follows it in the same file, and the row of scenario 13 in `docs/requirements.md` gets its half. The catalog has no PA12, so nothing of this package's part uses it.
- **The print query** answers `empty` when the model has no printed body (3a); marking the entry `geometry: 'modelled'` does not touch that.

## Verified before the implementation (2026-11-16)

The three checks this section listed were run as spikes against the real adapters (the Manifold kernel, the planegcs solver) and the engine of `master`. The mechanism does not exist, so the spikes posed bodies the way this design says the context will: a body moved by a rigid transform with its positions rounded to single precision (`transformSolid`), a pair in the frame of its first body, and `interferenceReport` with `sharedBy` of `interference.ts` as they are. About 6,000 poses of a pair went to the kernel.

The spikes are not kept: together they run for half an hour, a spike is run before every commit, and what they guard becomes the part of 5a of scenario 13. The numbers are here, and so is the recipe: the model is `arm()` of `packages/scenarios/test/scenario13.test.ts` with the radius of its pins varied; a pose is `transformSolid(rotation([120, 0, 0], [0, 0, 1], angle), forearm.solid, (id) => id)` with the bounds of the moved mesh; the angles are the two ends of a range and `lower + (upper − lower) · frac(i · 0.6180339887)`, so that none is a round number; "askew" is the whole model moved first by a turn of 0.7 rad about (1, 2, 3) and a shift by (37.3, −12.9, 55.1), which stands for a model built on a tilted plane and for a pair that joints nearer the root have turned. The times were taken while other sessions ran their checks on the same machine and are upper bounds.

### 1. A pin in its hole, turned

The forearm with its pin in the hole of `upper`, both of one radius, the plates flush at z = 8, the elbow turned through ±88° (beyond that the forearm reaches the screws). As modelled the pair shares nothing, for every radius.

| Pin radius | Poses | Collision | Fit | Nothing | Failed | Deepest fit, of the tolerance with the allowance |
|---|---|---|---|---|---|---|
| 1.5 | 120 | 0 | 119 | 0 | 1 | 0.92 |
| 2.5 | 120 | 0 | 113 | 1 | 6 | 0.93 |
| 4 | 400 | 0 | 383 | 4 | 13 | 0.96 |
| 12 | 120 | 0 | 118 | 0 | 2 | 0.98 |

The table is the pair in the frame of the parent with the axis along Z. The same pair in the frame of the child (240 poses) and with both bodies moved to a pose by a shoulder about Z (240 poses) gives the same picture: no collision, 233 and 232 fits, 4 and 5 failed.

- **It stays a fit and is never a collision**: none in 3,000 poses of a pin through the adapter, the askew ones included. A planar face of one body reaches into a planar face of the other by at most 10⁻⁴ of the allowance (5 % of it askew), so the rule that tells a fit from a collision has room.
- **It is a fit in nearly every turned pose** (96 %), with 0.2 to 1.2 mm³ of slivers, and in no list as modelled or where the turn is a whole side of the polygon. The depth of a fit comes to 0.98 of the chord tolerance: the corner of one polygon stands out of the flat of the other by the sagitta, which is the tolerance by construction. That is by design of `interference.ts`, and no margin is missing: the limit is the same number.
- **The kernel refuses the pair in about 3 % of the poses** with the axis along a coordinate axis (22 of 760 in the table; pin 4 at −47.883°, −50.198° and 58.576°, to name three that can be pinned), and in 80 % of the poses of the askew model (387 of 484 in the frame of the parent, 188 of 240 with both moved). Such a pair is in `failed`, neither clear nor colliding.
  - The refusal is the adapter's own, after its cleaning: "the result of the boolean is not a closed surface" (186 of the 189 looked at) or "has a folded triangle" (3). The library itself returned a result every time.
  - The arm through the kernel otherwise agrees with the hand computation of the reviews: the forearm first collides with `screws/1` at 90.73° and with the motor at 91.18° (computed: 90.7° and 91.2°); as modelled its 28 pairs have no collision, no fit and no failure.

### 2. The cost of a step, on the joint of scenario 9

The joint of `packages/scenarios/test/joint.ts`: 8 bodies and 28 pairs, 17,146 triangles (the housing 5,310). The spike gave it the links a gearbox has (the housing, the plate and the motor stand; the sun on the input; the carrier on the output; each planet on its pin of the carrier) and computed the collisions as "A pair is computed in the frame of its first body" says, with the second body remembered by its mesh and the motions between the two links, and the answer by the two meshes.

| Sweep of twenty steps | Pairs to the kernel a step | Bodies moved a step | A step | Twenty steps | Steps with a collision |
|---|---|---|---|---|---|
| As modelled, nothing remembered | 13 of 28 | 0 | 110 to 150 ms | | 0 |
| The output alone, 2° a step (the planets carried without turning) | 8 | 7 | 71 to 278 ms, median 226 | 4.1 s | 18 |
| The motion the gears allow, through one parameter (the sun by 17.3° a step, the carrier by Zs/(Zs+Zr) of it, each planet by −Zr/Zp of the carrier) | 12 to 13 | 20 | 94 to 162 ms, median 127 | 2.5 s | 0 |
| The input alone, 1.3° a step | 5 | 1 | 58 to 130 ms, median 100 | 1.9 s | 20 |

- Only the pairs with a body on each side of a moved joint go to the kernel; the others are found in the memory, and the same pose asked again costs 0.1 ms. The side of the engine (a preview of a command that changes no feature, and the query over it with everything remembered) is 0.2 ms a step.
- A sweep of twenty steps is two to four seconds on this model. Over MCP a step is a tool call, which costs more than that; **a sweep in one call is not needed for speed** and stays deferred.
- The coupled motion ran through 346° of the sun without a collision, a fit or a failed pair: the gears of scenario 9, with their backlash of 0.05, stay clear when they turn as gears do. No pair of that model is a pin in a hole of the same diameter (the pins of the carrier have 0.15 of play).

### 3. Single precision: flush faces of two bodies that moved against each other

A washer of the child on the top face of the parent, away from the axis so that it sweeps over the face, over a hole and over the rim, and a plate of the child that covers half the parent; no pin, so the flush face is all the two share. Turned about the axis of the joint, slid along the face (a prismatic joint), in the frame of the parent and with both moved to a pose, at the origin and two metres from it. 1,920 poses, half of them with the axis along Z and half askew.

- **With the axis along a coordinate axis nothing reaches the kernel.** A turn about Z leaves every z as it is, also after the rounding, so the two faces stay in one plane bit for bit, the boxes of the two bodies touch and `interferenceReport` rejects the pair by its boxes: 960 poses, no volume, no time. (With a pin through the face the boxes overlap and the kernel is asked: that is check 1, where the flush faces around the pin cost nothing either.)
- **Askew, the noise stays below the thresholds.** The two faces are then planes only to the last digit of their coordinates, and the kernel returns what lies between them: up to 0.01 mm³ at the origin and 0.24 mm³ two metres away, 240 times the volume threshold. The depth of it is 5 · 10⁻⁵ mm at most at the origin and 2.2 · 10⁻⁴ two metres away, against an allowance of 2.6 · 10⁻⁴ and 1.8 · 10⁻³: a third of the allowance in the worst pose, a tenth in most. No pose of the 960 is a fit or a collision. So `INTERFERENCE_THRESHOLD`, `coordinatePrecision` and `SHEET` stay as they are; it is the rule "no deeper than the precision of the coordinates" that holds, not the volume.
- **Askew, the kernel refuses a quarter of the poses** (237 of 960; from none for a slide at the origin to seven in ten for the plate turned two metres away), with the same message as in check 1, and a pose takes up to 2.4 s (looking for the sheets is the slow part of `depthOf`).

### What follows for the design

- **The thresholds of `interference.ts` need no change**, and a pin in its hole across a joint is what the report calls a fit. `calls.ts` says what a sweep finds in which list.
- **The frame of the first body is what keeps a pair exact, not only what makes it cheap.** Two bodies joined by a joint whose axis lies along a coordinate axis are computed from the one as modelled and the other turned about that axis, whatever the joints nearer the root have done to both. Posed to the world first, the same pair would be two meshes rounded apart from each other, which is the askew case: refused in four poses of five. The design had the frame for the memory; it is now also the reason the collisions work in a chain, and a query about a pair that reads `context.bodies` directly loses it (the description of `pairInFrame` says so).
- **A joint whose axis is not along a coordinate axis is a known limit**: the normal of a sketch on a slanted face, later a tilted plane (5c). Its pairs are never called collisions wrongly, but most poses end in `failed`. The description for the AI says so, with the advice that follows from it: a mechanism is modelled with its axes along the axes of the model where that can be chosen. (After D50, [5e](../5e-kernel-second/design.md): most such poses are cleared by the intersection as computed, a few stay failed, and each costs seconds; the advice stays for that reason. After D51, [5f](../5f-adapter-repair/design.md): the adapter verifies nearly every such pose, and the advice stays for the seconds.)
- **A failed pair in a sweep is common enough to be dealt with**: one pose in thirty for a pin in its hole. As designed, a sweep keeps `failed` and a step is clear only without it. What an AI does with such a step, and whether the engine should do better, is the next section.

### A pair the kernel refuses

What the spikes tried, on the poses the adapter refused. The first two rows are one run (189 refused poses: 9 pins with the axis along Z, 135 pins askew, 45 flush faces askew), the third another (9, 91 and 51):

| Variant | Pins, axis along Z | Pins, askew | Flush faces, askew | Elsewhere |
|---|---|---|---|---|
| The adapter as it is | all failed | all failed | all failed | |
| The intersection as the library returns it (no shift of faces in one plane, no cleaning, no check), measured by `sharedBy` | 8 fits, 1 nothing | 134 fits, 1 nothing | 44 nothing, 1 collision that is not one | Where the adapter does not refuse, it agrees on every pin (436 poses) and every real collision (120 poses of the forearm in the motor and in a screw), and calls 5 of 123 flush poses a collision that the adapter rightly does not |
| The adapter without its two refusals at the end | 7 fits, 1 nothing, 1 collision that is not one | 60 fits, 31 collisions that are not | 11 nothing, 40 collisions that are not | The same mesh where the adapter does not refuse |

So the refusals are honest (a refused mesh measures wrong), and the raw intersection is not a replacement for the adapter (it errs on flush faces, which is what the shift is for). What the numbers support is narrower:

- **Proposed: a second opinion for a refused pair, which may only clear it.** When the adapter refuses the intersection of a pair, the collisions measure the intersection as the library returns it; if that says the pair shares nothing or is a fit, the pair is that; if it says a collision, the pair stays in `failed`. On the 189 refused poses that leaves one failed pair and calls none a collision. It cannot hide a collision the adapter would have found: where the adapter answers, its answer stands, and where it refuses, the raw volume of a real overlap is above the threshold and deeper than a fit, which keeps the pair in `failed`. The errors seen of the raw intersection all go one way, towards a collision that is not one.
  - It needs an addition to the kernel port (the raw intersection is an option of the adapter that only its tests use): a property of `SolidKernel` for "what two solids share, as computed, for measuring only: it may hold sheets and pieces that touch along an edge, and is never a body of the model", with the adapter and the fakes of the tests, by the rule of the plan for an addition to a port. It is new geometry in the collisions and the kernel, so it is a step of its own with a full review, and its own measurement on the pattern cases `interference.ts` was written for.
  - **An addition to the port was the owner's to decide** (as `minGap` of 1c was), and **the owner decided for it on 2026-11-16**: it is a small package of its own after 5a, decision D50, with its design in `docs/d36/5e-kernel-second/`; see "Open". The rest of this design does not depend on it: without it a refused pair is in `failed`, as today.
- Considered: **the adapter repaired** so that an intersection of many slivers comes out closed. The right place in the end, and open-ended work in `clean` and `restoreShifted` with the fuzz of the kernel; recorded for the backlog, not a step of this package. The owner decided on 2026-11-16 that it is the next package right after D50.
- Considered: **the pair asked again at a value next to it** (by the caller, or by the engine). It answers another question, and with four poses in five refused askew it does not converge there. It is what is left to a caller without the proposal, and the description for the AI names it for a failed pair across a joint: ask the step again a hundredth of a degree away, and trust neither.
- Considered: **the two bodies a revolute joint joins declared a fit about its axis** and left out of the collisions. They can collide elsewhere, and a wrong axis is exactly what the collisions should find.
- Rejected by the numbers: the adapter without its refusals, and the raw intersection in place of the adapter.

## Rejected

- **The pose as a move feature at the end of the timeline** (the first proposal of the backlog). It hides the structure in the timeline, where the export would have to guess it back, and it moves the bodies of the evaluation, so every export and every later feature would follow the pose.
- **The pose as an argument of every query.** Decided against by the preparatory step: a pose is a state of the document, so that the app, MCP, undo and a saved file agree on it, and so that a value can be an expression.
- **Membership of a link as a property of the body** (a field of 3a's entry, with the links kept as a list of names). It would make "at most one link" true by construction. Rejected for where it puts things: the mechanism would be spread over two sections, and the export and the pose read links with their bodies.
- **Joints or links as features.** They are not geometry; a change of a value would compute the timeline.
- **A placement stored with the link.** See "No placement of a link".
- **The axis as numbers** (a point and a vector, as in the files of the formats). It would not follow the model, and an AI would compute it from coordinates it recalls. An `AxisRef` follows the sketch.
- **One root as a rule of the commands.** See above: it would force the mechanism into one batch and forbid two arms.
- **A value outside the limits clamped, or only warned about.** A clamped pose is not the pose asked for; a warning is not seen by a caller that reads only the answer of a query. A command refuses it and a recompute reports it as an error of the joint, which blocks the queries.
- **Copies of a pattern follow their source into its link**, as they inherit its properties in 3a. The planets of scenario 9 are copies of one body and each turns on its own pin; the rule would be wrong there, and the list of a link would no longer say what moves. The properties are different: a copy that is not told otherwise should be made of what its source is made of.
- **The value in a record of the section, apart from the joints** (`pose: Record<Id, number>`). Named poses could be added either way; the expression of a value has its place in the joint with the other numeric fields.
- **Bodies that moved by the same transform answered as modelled, and nothing more** (the first version, `movedTogether`). It covered one link and missed the pairs beyond a swept joint, and it handed over solids where the collisions also read boxes. The pair in the frame of its first body covers both.
- **A state asked for with `at` never posed** (the second version). It kept `check_interference` with `at` answering before the sketch of an axis. But it dropped a pose without a word: a sweep with `at` and `after: setPose` would return the same answer at every step, and a saved document with a bent arm would be answered as modelled at its last feature and posed without `at`. A joint at zero that blocks nothing keeps today's answers for every document whose pose is zero, which is what the rule was for; a bent document fails loudly where its pose cannot be computed.

## Open

For the owner. All five were put to the owner and **decided by the owner on 2026-11-16**, each as designed. The first three are places where the design decides otherwise than the brief words it:

- **A coupled motion goes through a parameter: decided by the owner on 2026-11-16.** Not through the name of one joint in the expression of another. Both values follow one parameter; nothing new is needed in the expressions. Names of joints in expressions stay deferred.
- **A forest, not a tree with one root: decided by the owner on 2026-11-16.** Several roots are allowed and listed; the export of 5b asks for one.
- **A missing link is not a broken reference: decided by the owner on 2026-11-16.** A joint cannot name a link that is not there, and a link that a joint names cannot be removed. A missing body and a missing sketch of an axis are broken references, as the brief says.
- **The model as modelled is the zero of every joint: decided by the owner on 2026-11-16.** An arm modelled folded has its zero folded. This package has no field for "the value as modelled"; it stays deferred and can be added without a change of what is saved.
- **The axis of a joint from a cylindrical face: deferred, decided by the owner on 2026-11-16.** "The axis of this bore" comes with the other kinds of `AxisRef`, for the pattern as well. Until then an axis through a sketch point needs the centre of the bore as a point of a sketch, which the model usually has.

Two more were found by the check against the code (neither blocked the implementation) and **decided by the owner on 2026-11-16**, after the package was implemented:

- **A picture of a pose that is not written comes with 5b: decided by the owner on 2026-11-16.** Not with this package and not on its own. `view_image` of 1f has no `after`, so an AI that steps a pose with `after: setPose` cannot see the step; until 5b it writes the pose, takes the picture and undoes. Giving the path of an operation of the app `at` and `after` (the need 1f recorded and did not take up) is a change of 1f's path, not of the mechanism.
- **A second opinion for a pair the kernel refuses is a package of its own after 5a, D50: decided by the owner on 2026-11-16.** The kernel port grows by "the intersection as computed, for measuring only", which may only clear a refused pair ("A pair the kernel refuses"); the design is in `docs/d36/5e-kernel-second/`. Measured: with the proposal one of 189 refused poses stays failed and none is called a collision wrongly. Until D50 a sweep carries its failed pairs. The repair of the adapter itself (`clean` and `restoreShifted` in `packages/kernel-manifold`) is the next package right after D50, by the same decision.

For the implementation:

- How many poses of a solid are remembered, and whether a posed solid shares its triangles with the modelled one (it can: a turn keeps the order of the vertices; `transformSolid` copies them today).
- Whether the view should also offer the model as modelled while the model mode is shown (a switch in the panel), for a model whose stored pose is not zero.
- Where the note about the pose travels in the answer of a tool ("The model as modelled, by name").
- The steps of the sweep of scenario 13 at which the pin of the elbow is refused by the kernel, if any: the test names them and holds that such a step has nothing else in `failed` and nothing in `pairs` below a quarter turn.

No third-party library is needed.

## Reviews

### Round 1 (2026-11-15): first version, with 3a

Two reviewers got the same brief, read-only, at commit `340f8f6`: `codex` (gpt-6-astra, effort high; twenty findings over the two packages) and an internal subagent (seventeen, with type probes and a test run against the code, kept outside the repository). `agy` did not take part: its account is out of quota. Every finding was checked against the code before it was acted on. The findings about 3a are recorded in its design; the ones about this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| A joint in error takes away every query about the bodies beyond it, also the ones that do not depend on the pose; with `at` before the sketch of an axis the collisions stop answering; setting the pose to zero is no way around (limits that exclude zero, a preview) | both, major | Yes (`stateAt` and `Evaluator.run` stop at `upTo`) | A joint at zero blocks nothing; a state asked for with `at` is not posed; the need for the model as modelled is widened to a caller and its workaround is gone; *Reset pose* is defined for limits that exclude zero |
| "`check_interference` passes the message on": the exception is not a `ToolError`, the server calls it a failure of the tool and the bridge an error of the app; the app does not catch | internal, major | Yes (`callTool`, `server.ts`, `bridge-client.ts`, `checkCollisions`) | The statement about the code; the three callers are in the list of edits by hand; the dependency on 1b is a note for the plan |
| The limits are checked against the stored numbers, which inside a batch are those of before it; a form that repeats a broken expression is stopped by the comparison; what is written back when limits cross is not said | both, major | Yes (`Fields` in the mode `update`, `settle` after the batch) | A command evaluates the expressions of the three fields against the parameters of the document it is applied to; a field that does not evaluate takes no part; the rules of the write-back; `calls.ts` has the batch |
| The limit check has no tolerance: the last step of the scenario's own sweep lands above the upper limit for many ranges, and a limit read from a tool is rounded to six decimals | internal, major | Yes (probe of the reviewer: 466 of 2000 ranges; 17 of 36 multiples of 5°) | `LIMIT_TOLERANCE`; a value within it is the limit |
| `movedTogether` hands back solids only: the collisions also read the boxes, for rejecting a pair and for the allowance of precision, so the answer depends on the pose that asked first; the nearest points of a gap would come back as modelled; pairs beyond a swept joint are computed at every step | both, major | Yes (`interference.ts`; probe of the internal reviewer) | `pairInFrame`: the pair in the frame of its first body, with whole bodies and the transform back; the motion between two links composed from the joints between them |
| The mass beyond a joint leaves out a body that is missing, without a word; the export of 5b would too | codex, major | Yes | `carriedBy` returns `missing`; `calls.ts` refuses a sum with a missing body; 5b refuses a link with one |
| The sweep of the scenario drops the pairs the kernel failed on | codex, major | Yes (`failed` is part of a successful report) | The steps keep `failed`, and a step is clear only without it |
| The types are said to go between the two markers, which `describe_api` cuts out | both, factual | Yes | As in 3a |
| The query `mechanism` has no bound: every joint repeats what the joints beyond it carry | codex, minor | Yes | `carries` left the result; the argument `beyond` asks for one joint |
| The frame of the child of a fixed joint is undefined for 5b | both, minor | Yes | It takes the origin of the frame of its parent |
| The lever of the scenario is the distance from the axis, not the lever of gravity | codex, minor | Yes | The torque along the axis for a given gravity |
| The step over MCP for the mass was not written; the app has no way to remove a link or a joint | codex, minor | Yes | `massOverMcp`; the forms remove |
| The upgrade step turns `null` into an empty mechanism; "the same hole as 3a" is false, the branch starts from version 3 or more | codex | Yes | The step asks whether the field is there; the paragraph on the life of a document |
| "Costs the resolution of the section": the loop over the features, the map of bodies, the checks and the pairs with their boxes remain | codex, factual | Yes | Said as it is |
| Three decisions depart from the wording of the brief and are not put to the owner; a slider removes a coupling | internal, minor | Yes | Listed under "Open"; the slider of a value with an expression is disabled |
| An axis or a sketch point given to a query is as modelled against posed bodies | internal, minor | Yes (the rule of the preparatory step) | Deferred by name; in the conventions for the AI |
| Canonical forms: the order of `bodies`, the rules of a name | internal, minor | Yes | Stated in the contract |
| Reasons that do not hold: "both formats require limits" (not checked), a move feature at the end "computes everything after it", membership by the body "cannot say an empty link" | both | Yes | The three reasons are replaced or dropped |
| The plan is not told of 1d, 1b, `interference.ts` and the view; the tool `query` does not say which pose it answered for | internal, minor | Yes | Notes for the plan; need 2 |

Checked by the reviewers and found sound: `T(child) = T(parent) ∘ M` with modelled axes, numerically on a chain of three with a prismatic joint; the invariants of the section and that every command can keep them; that no saved document fails to load; no placement of a link; lazily posed bodies and a throw inside `run` against the contract of the preparatory step; the names in the shared maps.

Not acted on:

- A policy of the mass in place of the pair rule of 3a (codex, as one of two remedies): see 3a.
- A limit on the answer of `mechanism` beyond `beyond` (codex): the answer is linear in what the caller wrote.

### Round 2 (2026-11-15), narrow: the fixes of round 1 and what they introduced

The same two reviewers, read-only, at commit `5cf6f5b`; the internal one was a fresh subagent that had not seen the first round. `agy` is still out of quota. They were asked for blockers, majors and factual errors only. Neither found a blocker. `codex` returned four findings over the two packages, the internal reviewer five; the ones about 3a are in its design, the ones about this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| "A state asked for with `at` is not posed" drops a pose without a word: a sweep with `at` and `after: setPose` returns one answer at every step, and a saved document with a bent arm is answered as modelled with `at` at its last feature and posed without it | internal, major | Yes (the tool `query` takes `at` and `after` together; `stateAt` of the last feature is the whole model) | The reviewer proposed to refuse `at` with an `after` that poses and to give the two hand-made tools a note both ways; that leaves the general tool `query` on a document saved bent, which has no place for a note (need 2). Instead the rule is gone. A state after a feature is posed by the section resolved against that state; with the joint at zero that blocks nothing, a document whose pose is zero answers as today at every point; a bent one fails before the sketch of the axis of a joint that moved. Need 1 lost its "until then"; the conventions for the AI, the view at the marker and "Rejected" follow; `calls.ts` has the three cases, and `build` of 3a puts the sketch of the axes after the bodies of the arm so that they can be written |
| The mechanism names bodies, sketches and points that may be gone, and an unrelated feature or point that reuses the ID enters a link or becomes an axis; the guard of 3a covered the keys of its own section | internal, major | Yes (probe: `freshIds` hands out the ID of a removed point that only a section names) | "An ID the section names may be taken over": the entry gives `names` to the registry, and gets `namedBySections` and `takenOver` |
| `gapInPose` remembers its answer under a key without the order of the pair, while `memo` has unordered owners and `pairInFrame` an ordered pair: asked the other way round, the nearest points come back swapped and in the frame of the other body | codex, major | Yes (`QueryContext.memo` in `00-prep/contract.ts`) | The key carries the order; the rule is stated under "A pair is computed in the frame of its first body" and in the contract |
| `pairInFrame` takes two posed bodies and has to know their links | internal, as a caveat | Yes | Stated: the engine keeps the modelled body and the link of every posed body it hands out |
| "A build from before the preparatory step accepts version 2 only": it accepts 1 and 2 | internal, factual | Yes (`upgrade` in `document.ts`) | Said as it is; the conclusion (a version of 3 or more is refused) stands |
| The model `build` of 3a makes is not the one the calls here describe | internal, factual | Yes | See 3a |

Checked and found holding by both: the limits evaluated against the document a command is applied to; the tolerance of the limits (equal to the tolerances of the engine and wider than the rounding of the tools); the joint at zero (a turn by zero is exactly the identity, by a probe); the rules of the write-back; `carriedBy` with `missing`; `failed` kept by the sweep; the statements about the callers that do not catch; the frame of the child of a fixed joint; the torque; the upgrade step; the departures from the brief listed under "Open"; the pair in the frame of its first body against `interference.ts`. `codex` also counted "the states of the construction stay unposed" among the fixes that hold; the internal reviewer found the hole in it (the first row).

### Round 3 (2026-11-15), narrow: the fixes of round 2

The same two reviewers, read-only, at commit `90033c8`; the internal one was again a fresh subagent. `agy` is still out of quota. Neither found a blocker. `codex` returned three findings (two major, one factual), the internal reviewer three factual errors and no major.

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| "A document whose pose is zero answers at every point of its timeline as today" is too wide: a joint at zero with a fault of a limit or of an expression (a parameter moved the limits away from 0, a limit whose parameter was removed) still blocks | codex (major), internal (factual: "the rule itself needs no change") | Yes. It does not come from `at`: the parameters are those of the document whatever `upTo` is (`Evaluator.run`, `Evaluator.evaluate`), so such a joint blocks at the end as well | The claim is stated with its condition (no fault other than an axis), in the design, the contract and the calls, with the reason the exception is kept to the axis. Widening it to every joint whose value resolves to 0 was considered (codex asked for a decision, the internal reviewer advised against a zero outside valid limits): not taken |
| The point of an axis may be derived from a projected entity (`x1/center`); the guard reserves the point and leaves `x1` free | codex, major | Yes (`derivedPoints`, `entityOf`; `axisRef` accepts any entity that is a point) | `names` gives the projected entity with the point; see 3a |
| Need 1 says a blocked body cannot be read without changing the document; `after: setPose` to zero reads it and writes nothing, also with `at` | internal, factual | Yes (`QueryToolInput.after`; the joint at zero) | The way is stated where the blocking is, in the conventions for the AI and in the message of the failure; `calls.ts` has it in the engine and over MCP; need 1 keeps the case that remains (limits that do not contain zero, a fault beyond the axis) and the case of an entry |
| The sweep expects both pins among `fits` at every step: the shoulder pin has the polygon of its hole and shares nothing, the elbow pin is a fit only where it is turned against its hole | both, factual | Yes (`interference.ts`: a pair enters a list only above the thresholds; `circleLoop` starts every circle at angle 0; `bodies.test.ts`) | The comment of the sweep says what is expected in which list; the forearm against the motor and the screws tells a posed answer from a modelled one |
| The lists of problems of `get_model`, `execute` and `preview` say nothing of `at`, where they would name every joint whose sketch comes later | internal, as a related gap | Yes | Left out with `at`, as 3a does; the query `mechanism` with `at` answers |
| The view draws a blocked link "where it is modelled", the contract gives it the transform with the blocking joint at zero | internal, below its bar | Yes | The view draws by the transform of the result |

Checked and found holding by both: a state after a feature posed by the section resolved against it, implementable on `stateAt`, `preview` and `Evaluator.evaluate` with `upTo` as they are (a body not made yet, a body half made, a prismatic and a fixed joint, a preview with `at`, the checks of the document, `check_interference` and `get_body` with `at`, the marker of the app), without a contradiction with the contract of the preparatory step; that no body handed out has a joint on its way to the root that silently stood still; the ordered pair and its memo key; `names` across the four files; the examples with `at` against the order of the features of `build`.

No finding of this round was left without a change. With six findings, two of them major and none a blocker, and fixes that are a few sentences each, no fourth round was run.

### The check before the implementation (2026-11-16)

Not a review round: one session read the design against the code of `master` (with 3a and 2c, both merged that day), recorded the owner's decisions, and ran the three checks of "To verify before the implementation" against the real kernel. What it changed is listed in "Checked against the code (2026-11-16)" and "Verified before the implementation"; the decisions of the third version stand. New in the design, and read by no second reader yet: the option `geometry: 'modelled'` and the note about the pose as work of this package (they were decided by the review over the whole set, rows 18 to 20, and are written out here for the first time); the reason of precision for the pair in the frame of its first body; the known limit of a joint askew to the axes of the model; the proposal of a second opinion for a pair the kernel refuses, which waited for the owner (decided since as D50, see "Open"). The review of the implementation reads them with the code.

## As implemented

Implemented on the branch `d36/5a`, from `master` at `d5a2c95` (3a and 2c merged, schema version 5), and merged into `master` on 2026-11-16. The step `5a-mechanism` is the fifth of `UPGRADES`. On the branch it was pending (`SCHEMA_PENDING = 1`) and the branch saved version 5 with `schemaSteps: ['5a-mechanism']`; since the merge `SCHEMA_PENDING` is 0 and `master` saves version 6. Two commits on the branch: the first gives `SectionSpec.evaluate` the state of the recompute (no change of behaviour), the second is the package.

| File | What |
|---|---|
| `packages/engine/src/types.ts` | `Document.mechanism`, `Mechanism`, `Link`, `Joint` (before the marker `porty`); `Evaluation.mechanism`, `RigidTransform` (moved from `solid.ts`, which re-exports it), `MechanismResult`, `LinkResult`, `JointResult`, the five commands, the codes `jointLimits` and `jointOutOfLimits`, `geometry` in `QueryOptions` (after `přepočet`) |
| `packages/engine/src/sections/mechanism.ts` | the entry of the registry: validation (strict, the section whole), the five commands, the result (`motionOf`, transforms, joints in error, the write-back), `linkOf`, `poseOfBody`, `motionsTo`, `carriedBy`, `poseNote`, the text of a blocked body; `JOINT_FIELDS`, `LIMIT_TOLERANCE` |
| `packages/engine/src/sections/spec.ts`, `index.ts` | `evaluate` gets the state; `entries`: keys of a result kept stable entry by entry |
| `packages/engine/src/solid.ts` | `IDENTITY`, `isIdentity`, `compose`, `inverse`, `shift`, `transformSurface` |
| `packages/engine/src/query/pose.ts` | `movedBody` (remembered, sized by the links, `keepFor`), `movedBox`, `poseOf` (the bodies of a context in the pose, read lazily; `boxOf`), `pairInFrame`, `framed` |
| `packages/engine/src/query/context.ts`, `spec.ts`, `index.ts`, `export/index.ts`, `engine.ts` | the context poses bodies, surfaces and frames of faces unless `geometry: 'modelled'`; `geometry` on `QuerySpec` and in the options of `query` (checked: `invalidArguments` at `['geometry']`); exports and `exportMesh` as modelled |
| `packages/engine/src/interference.ts`, `query/interference.ts`, `query/gap.ts`, `query/print.ts` | a pair in the frame of its first body for the collisions and the gap (its two points moved back, `meshAccuracy` from the pair); the print query marked `geometry: 'modelled'` |
| `packages/engine/src/query/mechanism.ts` | the query `mechanism` with `beyond`; one line in `QUERIES` |
| `packages/engine/src/schema.ts`, `recompute/services.ts` | the step; the messages of the two codes |
| `packages/app/src/panels/mechanism.ts`, `pose.ts`, `axis-picker.ts`, `app.ts`, `scene.ts`, `viewport.ts`, `camera.ts`, `picture.ts`, `panels/query.ts`, `panels/model.ts`, `issue-text.ts` | the panel *Mechanism* at the end of the model panel; the pose in the view, the pick, the fit of the camera and a picture; *as modelled* in the form of a query; `stateBefore(0)`; the status line of what a command took over and of the pose shown |
| `packages/mcp/src/tools.ts`, `server.ts`, `api.ts` | `get_model` (`mechanism`, `jointErrors`, `linksMissingBodies`, `bodiesInNoLink`), `get_body` (the volume and the bounds of the query), `check_interference` (catches the failure), `query` (`geometry`), the note about the pose (`Noted`, `about` of `ToolOutcome`, a second text of the server), a paragraph of the conventions |

Deviations from the design, and choices it left to the implementation:

- **Stable results one level deeper.** An entry of the registry may name keys of its result whose records are kept entry by entry (`entries: ['links', 'joints']`), so a link or a joint whose result did not change is the same object (the engine test holds it). The memory of posed bodies compares transforms by their numbers anyway.
- **The order of the faults of a joint** (one `error`): `invalidExpression`, `jointLimits`, `jointOutOfLimits`, then `brokenReference` of the axis, so that the fault that blocks also at zero is the one named. `blockedBy` names the joint nearest to the link. Crossed limits (`lower > upper`) are a fault without a tolerance; "within the limits" has `LIMIT_TOLERANCE`.
- **The motion of a joint at zero is `IDENTITY` itself**, not a rotation by zero, and a link of only such joints has the identity transform; a body of it is the object of the evaluation.
- **Where posed bodies are remembered**: in `query/pose.ts`, by the modelled solid (a `WeakMap`) and the numbers of the transform, most recently used last, `keepFor(mechanism)` copies per solid: twice the number of links, at least eight. In one query a body is handed out in its pose once and, as the second body of a pair, once for every other link it is paired with, so one state needs at most as many copies as there are links; twice keeps the state before as well. (Eight for every mechanism, as first implemented, thrashed with more than about eight links, and a state asked again went back to the kernel: review, finding 1.) A posed solid shares the triangles and the face numbers of the modelled one (a rigid motion keeps the order of the vertices) and has its own positions in single precision; its bounds come from those positions, its edges are moved in double precision. What the engine keeps for every posed body it hands out (the modelled body, the transform of its link, the motions from the root) is a `WeakMap` by the posed object.
- **The joints two links share cancel by their numbers**, not by their IDs: the motions from the root of the two links are compared from the root while they are the same numbers. That is geometrically valid whatever context recorded them, and it is what makes the moved second body the same object for the same relative motion.
- **`interferenceReport` is handed the pair** as a function `pair(a, b)` (next to `shared`), which `query/interference.ts` makes with `framed`; it no longer reads the bodies but for their IDs. **A pair far apart is rejected before it is put in a frame**: `boxOf` gives a box that holds the posed body (the eight corners of its modelled box moved, `movedBox`), so the collisions and the gap reject such a pair without moving a mesh (review, finding 1). The box is larger than that of the moved mesh, so it rejects no pair the box of the pair in its frame would keep.
- **The note about the pose** travels as `about` beside `result` in `ToolOutcome`, as proposed: a tool returns `new Noted(result, { pose })` and `callTool` puts the note apart; the server prints it as a second text, the bridge carries it as it is. The values are rounded to six decimal places. A note is given when a joint moves the model and the answer is computed from the bodies in the pose: not with `geometry: 'modelled'`, not for the print query, and not for a query whose entry says `geometry: 'none'` (it reads no geometry of bodies: `catalog`, `hardwareHole`, `sketchDiagnosis`, `constraintExplanation`, `mechanism`; such an entry gets the context of the model as modelled). The note lists the joints that move the model (`status: 'ok'`, a value that is not zero, a child link that is not blocked) with the values they move it by; a joint in error or beyond one is not listed. (`poseNote(mechanism, section)`; review, findings 2 and 3.)
- **The lists of `get_model`** are named `jointErrors` (joint, code, message), `linksMissingBodies` (link, missing) and `bodiesInNoLink`; `get_model` prints a joint with its axis, its numbers rounded to six decimal places, its expressions and `status: 'error'` when it is in error; like `jointErrors`, the status is for the state at the end of the timeline and is left out with `at` (review, finding 8).
- **The text of a blocked body** (`blockedText`) names every joint without a motion on the way from the root to its link, the nearest the root first, with its fault, so that one step of the hint is enough. It offers these joints previewed at zero in one `setPose` only when each of them is at fault for its axis alone and its limits allow zero; `geometry: 'modelled'` always (review, finding 4).
- **`setPose` with the expression the value already has** keeps it without evaluation, as `setJoint` does, so a value whose expression stopped evaluating can be sent again unchanged (review, finding 5).
- **`IDENTITY` is frozen to the last number** (the rows of its matrix and its translation): every root link shares it as its transform and the app gets it by reference (review, finding 6).
- **The memory of stable results keeps the keys of entries that are gone** (a removed link, joint or body): a state after a feature or a preview that lacks the entry would otherwise push out the results of the document. It grows with the IDs an engine has seen, each with at most four small results; a comment in `sections/index.ts` says so (review, finding 7).
- **The commands are strict about their own fields** (`setLink { id, name, bodies }` and so on): a misspelt field is an invalid command, not dropped.
- **The contract**: `JointResult.error` is the `Issue` of the engine in `contract.ts`, because the evaluation of the engine now has the mechanism, and `IssueAfter` of the draft of the preparatory step carries an example code the engine does not have.
- **Scenario 13**: the sweep has eleven steps of 27°; through the real kernel no step is refused for the pin of the elbow, so every step is pinned (the pairs of the forearm with the motor and the screws at ±108° and ±135°, the pin a fit in every turned step, `failed` empty). A step of the sweep sends at most the seven pairs of the forearm to the kernel and nothing when asked again (the test counts the calls of the real kernel). The three refused poses the spikes found are not pinned (the design does not ask for it).
- **The app.** The panel *Mechanism* is the last section of the model panel, shown once the model has a body or the document has a link: the tree from the roots (a link, its joints, the child link of each), the bodies of a link (missing ones marked), a blocked link with a warning, a joint with its kind, axis and issue; the bodies in no link; *New link*, *New joint*, *Reset pose*. The value of a joint is a field (degrees or mm, or an expression; one `setPose` when it is left) and a slider that previews `setPose` at the marker and executes it on release (one undo step); the slider is disabled for a value with an expression and for crossed limits. A continuous joint has a slider over ±180°, widened to its value. *Reset pose* is one `setPose` and skips joints whose limits cross. The form of a link takes a body out of another link in the same batch; the form of a joint has the picker of an axis of the pattern (taken out to `axis-picker.ts`, the pattern form unchanged) and defaults (revolute about Z, ±180°; prismatic 0 to 100 mm). New IDs are `link<n>` and `joint<n>`.
- **The view** applies the transform of a link in the model mode to the meshes, the outline, the faces, the pick, the fit of the camera and a picture (`pose.ts`); a sketch and a form show the model as modelled, and so does the model mode while a shown answer of a query was asked as modelled or comes from the print query, so that its highlights sit where it found them. A blocked body is drawn by its transform and labelled; the status line says whether the pose or the model as modelled is shown, and names a blocking joint. The form of a query offers *As modelled* while the shown state has a moved or blocked link (the print form says it is always as modelled). *Save picture* draws what the view draws; `view_image` draws the pose the document holds.
- **The status line of `takenOver`** has a sentence for the mechanism next to that of body properties, by the `names` of each section. It cannot be reached from the app itself, because `newId` skips the IDs a section names; it is tested by itself.
- **Not in the app**: picking the bodies of a link in the view, drawing the axis of a joint, a sweep.
- **Not done**, as the brief of the implementation says: no addition to the kernel port for a second opinion on refused pairs, no `at`/`after` for `view_image`. The owner decided both on 2026-11-16 (see "Open"): the first is the package of D50 after this one, the second comes with 5b.
- **Snapshots of the app test**: the menu of queries lists `mechanism`; a new document saved on the branch names its pending step and has the empty section `mechanism`; the model panel ends with the section *Mechanism* (a hint, *New link*, *New joint*, *Reset pose*) once the model has a body. The new snapshot `mechanism.txt` drives the panel, the slider, the pose in the view, the query as modelled and a blocked link.

### The review of the implementation (2026-11-16)

One full review of `7c6bef2` by a subagent that did not write the code: no serious bug, eight findings, all fixed in one commit, with regressions in `packages/engine/test/review.test.ts` and `packages/mcp/test/tools.test.ts`:

1. Performance: the memory of moved copies, eight per solid, thrashed with more than about eight links (a chain of twelve asked twice went to the kernel again), and every pair across links moved a mesh before its boxes were compared (40 small bodies in 10 links: 20 to 40 ms against 0.5 ms as modelled). The memory is sized by the links; a pair is rejected by a box that holds the posed body before a mesh is moved.
2. The note about the pose was added to every query not marked `geometry: 'modelled'`, also to those that read no body; entries now say `geometry: 'none'`.
3. The note listed a blocked joint and the out-of-range number of a joint out of its limits; it lists only the joints that move the model.
4. The text of a blocked body named only the nearest blocking joint; it names all of them, the nearest the root first.
5. `setPose` re-evaluated the expression the value already had.
6. `IDENTITY` was frozen only at its top level.
7. The keys of entries that are gone stay in the memory of stable results: kept on purpose, with a comment (above).
8. `get_model` with `at` printed `status: 'error'` of a joint while it left out `jointErrors`.

The changed lines of the snapshots `features`, `offset` and `taper` (and the others) of the first commit were checked to be only the realignment of the line diff around the inserted section *Mechanism*: with the section and the query `mechanism` hidden, every existing snapshot came out as on `master` but for the saved document of `model` and `bridge`, which names the pending step and has the empty section.

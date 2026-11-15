# 5a Mechanism description and the posed queries (D49)

**State: design, third version, after three rounds of reviews (see "Reviews"). Written against the sixth version of the contract of the preparatory step (`0dc424b`) and against [3a](../3a-body-properties/design.md).** Not implemented; the plan puts the implementation after 1c and 3a. The types are in [contract.ts](contract.ts), the scenario as calls in [calls.ts](calls.ts); both are checked by `npx tsc -p docs/d36/tsconfig.json`. Validation scenario 13 is shared with 3a; this package writes the part "two revolute joints; the pose stepped through the range of one joint with the collisions asked at each step; the mass of what hangs beyond the first joint".

The package adds a section to the document. The shape of the section, its commands, its upgrade step and the way a pose reaches a query are decided in full; the app, the wording of the MCP answers and what the export of 5b builds on it are described.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Export for simulation": a mechanism description next to the parameters and the checks. A link is a name and a list of bodies that move as one piece; a body belongs to at most one link. A joint has a name, a kind (revolute, continuous, prismatic, fixed), a parent and a child link, an axis (`AxisRef`), limits as numeric fields that take expressions, and a value, the pose. The joints form a tree with one root; a reference to a missing body or link is a broken reference like any other. It replaces the move feature proposed earlier for the pose, and it serves the posed queries as well as the export. "Candidates": the AI steps a parameter and asks for the interference and the smallest gap at each pose.

The preparatory step has already decided how a pose reaches a query (`00-prep/contract.ts`, `QueryContext`): a pose is a state of the document; a query reads the geometry of bodies only from its context, which answers in the pose; what does not belong to a body (a sketch, an axis through a sketch point, a plane feature, a base plane) is never posed; an export always gets the bodies as modelled; over MCP a pose is asked with `after` of the tool `query`.

What the code says:

- **Everything a pose needs exists, in the pattern.** `AxisRef` (a base axis, or the normal of a sketch plane through a sketch point) with its validator `axisRef` and its references; the resolution of an axis against the state (inline in `Evaluator.transforms`; part 2 of the preparatory step cuts it out as `axis(ref, state)`); `RigidTransform`, `rotation(point, axis, angle)`, `transformSolid` and `transformFace` in `solid.ts`. A pose is a rigid transform per link, built from the same pieces as a copy of a pattern.
- **A step of the pose needs no solver and no kernel as a preview.** `applyCommand` returns a new document that shares the features; `Evaluator.run` still walks every feature and resolves its expressions, and finds every step in its memo (the memo follows the feature object and the values of its expressions, not the document); `evaluate` builds the map of bodies, where `analyzeBody` remembers its result by the mesh, and evaluates the checks. What remains is linear in the timeline and small.
- **The answers about pairs are remembered by the meshes.** `Interferences` keeps what two bodies share in a `WeakMap` by the two `Solid` objects. Before that it rejects a pair by the boxes of the two bodies, and it takes the allowance for the precision of the coordinates from the same boxes; every pair of the bodies asked about is visited at every call. So what is remembered is found again only if the same two objects, with the same boxes, come back.
- **The expressions know the parameters only.** `Environment` in `expression.ts` is the table of parameters ("later also values produced by the recompute"). A joint value named inside the expression of another joint would be a second kind of name with its own order of evaluation.
- **A command sees the numbers of before its batch.** `Fields` in the mode `update` does not evaluate the expression of a field the command does not name, and the numbers are written back after the whole batch (`settle`). A rule between two fields that is checked against the stored numbers is checked against the parameters of before the batch.
- **The view draws `evaluation.bodies[id].solid`** (docs/ui.md), and the app asks the collisions for the state it shows, through `engine.interference`, without a catch (`checkCollisions` in `app.ts`).
- **`interference` is one of the four methods of `Engine` that throw**; after the preparatory step it shares `run` with the query, so it answers in the pose as well. An exception out of it is not a `ToolError`: `callTool` lets it through, the server reports "the tool failed" with its message, and the bridge to the app reports an error of the app that may have changed the document.

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
- **Stable objects**, as in 3a: the result of a link or a joint is the same object while what it is computed from is the same.
- **The bodies of the evaluation do not move.** A feature that refers to a face, a sketch on a face and every export see the model as modelled, whatever the values are.

Two issue codes are added: `jointLimits` and `jointOutOfLimits`. The others a joint can have exist: `brokenReference`, `invalidExpression`.

## How a pose reaches a query

The context of a query (`QueryContext` of the preparatory step) is built by the engine for the state asked about. With this package it reads `evaluation.mechanism` of that state and poses what belongs to a body:

- `bodies[id]`: the body of the evaluation moved by the transform of its link (`poseOfBody`). Positions, the segments of the edges and the bounds are transformed; the volume, the faces and the names stay. A body in no link, or in a link with the identity, is the object of the evaluation itself.
- `surface(body, face)` and the frame of a face (`frame` with a face, an entity that is a face or an edge): moved the same way.
- A plane feature, a base plane, a sketch and its points, an axis: as modelled, by the rule of the preparatory step.

**A state after a feature is posed like any other.** A state asked for with `at` (of `query`, of a tool, of a preview) is a point of the construction of the model. Its `evaluation.mechanism` is the section resolved against that state, and the context poses by it: a body that is not made yet is in `missing`, and a joint whose axis stands on a sketch that comes later is in error at that point.

- With the exception of a joint at zero (above), **a document whose pose is zero and whose joints have no fault other than an axis answers at every point of its timeline as it does today**. That is every document of today, and a model during its construction; `check_interference` with `at` and the marker of the app keep their answers.
- A fault of a limit or of an expression does not depend on the point asked about: the parameters are those of the document whatever `at` is (`Evaluator.run` and `Evaluator.evaluate`). A joint with such a fault blocks at the end of the timeline as it does at every point, also at zero (a parameter that moved the limits away from 0, a limit whose parameter was removed); `at` adds no case of its own. The exception is kept to the axis on purpose: an axis that is not there yet is the normal state of a model under construction, a zero outside the limits is a pose the document says the mechanism cannot take.
- A document whose pose is not zero answers in that pose wherever the axes of the joints that moved exist. A sweep with `at` and `after` together steps the pose of that state.
- Before the sketch of such an axis the bodies beyond the joint are blocked, and a query that reads them fails and names the joint; a query about the other bodies answers. It does not answer for the model as modelled instead: the caller asked about a document with a pose, and would not be told that the pose was dropped (`calls.ts`, `bentAtLayout` and `bentBeforeTheAxes`).
- **The way to a blocked body that writes nothing** is the same question with the joint previewed at zero: `after: { type: 'setPose', values: { elbow: 0 } }`, with or without `at`. A joint at zero whose only fault is its axis blocks nothing. The message of the failure says so, so that the loud failure tells an AI what to do.

**Lazily, and remembered.** A body is posed when a query reads it, so a query about one body moves one body. A posed body is remembered by the modelled solid and the transform (a few poses per solid), so a body that did not move between two steps of a sweep is the same object in both.

**A pair is computed in the frame of its first body.** What two bodies share, and how far apart they are, depends only on how they stand to each other. A query of the engine about a pair (the collisions; the gap of 1c) asks `pairInFrame(a, b)` and gets the first body as modelled, the second moved by the motions of the joints between their two links, and the transform back to the pose. It computes from those two bodies, with their boxes and their faces, and moves a coordinate of its answer back; a volume, a depth and a distance need nothing.

- Two bodies of one link are computed as modelled, once, whatever the pose; flush faces stay bit for bit what they are in the model.
- In a sweep of one joint, only the pairs with one body on each side of that joint are computed at every step. The pairs beyond the joint keep their relation and are found in the memory, as are the pairs before it.
- The motion between two links is composed from the motions of the joints on the way from one to the other, not from their two transforms to the pose. It is therefore the same numbers whenever those joints have the same values, and the moved second body is the same object.
- The answer no longer depends on which pose asked first: the boxes that reject a pair and the allowance for precision are those of the two bodies in the frame of the first.
- **The pair is ordered.** `pairInFrame(a, b)` and `pairInFrame(b, a)` hand out different objects (the frame is that of the first), and an answer in coordinates is in that frame until it is moved back. A query that remembers an answer about a pair through `context.memo`, whose owners have no order, puts the order into its key (`calls.ts`, `gapInPose`), or orders the pair itself before it asks.
- The function gets two bodies of the context and finds their links by itself: the engine keeps, for every posed body it hands out, the modelled body and the link it came from.

**A blocked body cannot be read.** Reading `bodies[id]`, a surface or a frame of a body whose link is blocked throws `QueryFailure('failed', …)` naming the joint. So a query answers for the pose that was asked, or says why it cannot; it never answers for a pose in which a joint silently stood still. A query that does not touch the blocked bodies answers as usual. (`Object.keys(bodies)` reads nothing; the checks before `run` look names up in the evaluation, where they do not depend on the pose.)

- Considered: a joint in error stands at zero and the query answers, as a feature in error is an empty operation. Rejected: a sweep over MCP returns only the answer of the query, so an AI would read "no collisions" at every step of a joint that did not move.
- The callers of today that do not expect a failure are changed by hand, with this package: `check_interference` and `get_body` catch it and answer with the reason as an error of the call; the collisions panel of the app shows it. If the generic form of 1b exists by then the panel asks through `query` and gets the reason as an outcome; if not, `panels/collisions.ts` catches.

**Stepping a pose.** In the engine: `preview` of `setPose` (or of `setParameter` for a coupled motion), then `query` with the previewed state; `calls.ts`, section b. Over MCP: the same command in `after` of the tool `query`.

**The query `mechanism`** returns `evaluation.mechanism` of the state asked about, and with the argument `beyond` what hangs on that joint. It exists so that the resolved description is reachable through the tool `query` by construction, with `after`: where the links stand in a pose that is not written, which joint is in error, what a joint carries. Its answer grows with the section, which the caller wrote, as the answer of `get_document` does; `beyond` takes one joint so that the answer does not grow with the square of it.

**What stays as modelled**: every export (the context of a format is never posed), `evaluation.bodies`, and with them `get_model`.

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
  types.ts                 the section, the commands, the result; RigidTransform moves here from solid.ts
  sections/mechanism.ts    the entry of the registry of sections (3a): validation, commands, the result, carriedBy
  pose.ts                  poseOfBody, the posed bodies and surfaces with their memory, pairInFrame
  queries/mechanism.ts     the entry of the query
  (the context of a query, of the preparatory step)   reads pose.ts for bodies, surfaces and frames
  interference.ts          computes a pair in the frame of its first body
packages/mcp/src/tools.ts  modelSummary, documentProblems; get_body, check_interference
packages/app/src/panels/mechanism.ts, panels/collisions.ts; the scene and viewport.ts
```

The registry of sections of 3a takes the entry, with `names` for the IDs the section names; `validateDocument`, `applyCommand`, `renameParameter`, `Evaluator.evaluate`, `settle` and `differs` are not edited again. The upgrade step is `5a-mechanism` (`MECHANISM_STEP`): it gives a document without the field an empty mechanism, leaves a field that is there to the validation and reads nothing else.

**The life of a document** follows the table of 3a, with `5a-mechanism` for the name and W, the version of the `master` this branch starts from, for V. That `master` has 3a, so W is at least 3.

- A build that knows the step loads a document of the branch; one with the preparatory step that does not know it refuses it by the name; a build without this package refuses a document of the merged `master` by its version.
- A document saved by a build with 3a and without this package loads in a build with it and gets the empty mechanism. The other way it is refused.
- A field of a link or a joint that a build does not know (the effort limit of 5b) is refused, not dropped.
- **The hole of 3a's table is not here.** A build from before the preparatory step accepts the versions 1 and 2 only (`upgrade` and `validateDocument`), and a document of this branch has version W. It refuses it.

## MCP and the app

**By construction.** The five commands go through `execute`, `preview` and `after`; the types are in the parts of `types.ts` that `describe_api` prints; the numeric fields of a joint are listed from `SECTION_INFO` of 3a; the query `mechanism` is reached by the tool `query` and listed with the queries; `get_document` returns the section.

**By hand**, with tests:

- `get_model` gets `mechanism` when there is a link: the links with their bodies, the joints with kind, parent, child, the numbers and the expressions, the roots when there are several. The numbers are printed so that a limit read here is accepted as a value (the tolerance of the limits is wider than the rounding). The bodies it lists stay as modelled, and the description of the tool says so. The problems go next to `failedChecks`: joints in error with their code and message, links with missing bodies, bodies in no link. `execute` and `preview` return the same lists. With `at` the three lists are left out, as 3a leaves out its list of entries without a body: at a point of the construction they would name every joint whose sketch comes later and every body not made yet. The query `mechanism` with `at` gives the description resolved at that point to whoever asks for it.
- `get_body` prints the volume and the bounds of `query('body')`, not of the state (see "Needs").
- `check_interference` and `get_body` answer a blocked body with the reason, as an error of the call, and add a note to their answer when the pose moves any link, so that an answer for a bent arm is not read as one for the model as modelled.
- A paragraph of the conventions in `describe_api`: the model as modelled is the zero of every joint; the sign of a turn; a pose is stepped with `after: { type: 'setPose', … }`; a query answers in the pose of the document, also with `at`, where it fails for a body beyond a joint that moved and whose axis is not made yet; a body beyond a joint whose axis is broken or not made yet is read with the joint previewed at zero (`after: setPose`); an axis, a sketch point or a plane feature given to a query is as modelled while the bodies are posed; exports are always as modelled.

**The app**:

- A panel *Mechanism* (`panels/mechanism.ts`): the tree of links and joints, the bodies of each link, the bodies in no link, the problems.
- A joint has a numeric field that takes an expression, and a slider between its limits. Dragging the slider previews `setPose`; releasing it executes it. The slider of a value with an expression is disabled: moving it would replace the expression, and with it a coupling, by a number.
- *Reset pose* sets every value without an expression to the value nearest to zero that its limits allow (zero itself wherever the limits contain it).
- Links and joints are made, changed and removed in forms of the panel: a link by a name and a pick of bodies, a joint by its kind, its two links, its axis (the picker of an axis that the form of the pattern has) and its numbers. Every confirmation is one command; removing a link that a joint names is refused with the reason.
- **The view shows the pose** in the model mode: the app applies the transform of the link to the mesh of each body, without new geometry. That holds at the marker of the timeline too: the view shows the state at the marker by its own `evaluation.mechanism`, and a blocked link is drawn by its transform of the result (the joint that blocks it counted as standing at zero) and marked, with the joint named in the status line. In a sketch and in the form of a feature the view shows the model as modelled, because that is where sketches, planes and the references of features are; the status line says which of the two is shown.
- The collisions are asked for the state shown, so in the pose; the highlight of a pair follows. A blocked body is reported as the reason the collisions cannot be asked.

## Shared vocabulary

**Taken**: from the preparatory step the additions to the unions, `QueryContext` and its rule of the pose, `QuerySpec`, `IssueAfter`, `UpgradeStep`, the tool `query` with `after`; from 3a the registry of sections with its numeric fields, `SECTION_INFO`, the check of a body ID, `namedBySections` and `takenOver` for the IDs the section names, `standInMass` and the properties behind it; from the engine `AxisRef`, `RigidTransform`.

**Added**:

| Name | Where | Who uses it |
|---|---|---|
| `mechanism` in `DocumentSections` and in `EvaluationAfter` | the shared maps | 5b; the app |
| `setLink`, `removeLink`, `setJoint`, `removeJoint`, `setPose` in `Commands` | | |
| `mechanism` in `Queries` | | |
| `jointLimits`, `jointOutOfLimits` in `IssueCodes` | | |
| step `5a-mechanism` | `UPGRADES` | |
| `standInGap` in `Queries` | a stand-in, removed when 1c is merged | |
| `poseOfBody`, `pairInFrame`, `carriedBy` | engine | the context of a query; `interference.ts`; 1c, for a pair; 5b |

**Stand-ins.** `standInGap` stands for the smallest gap of 1c. Assumed of it: it takes two bodies and a search distance, reads the bodies from its context (so it answers in the pose), tells "farther apart than the search distance" from a distance, and gives the two nearest points in the pose. `standInMass` is declared by 3a and stands for the mass query of 1d; assumed here in addition: the centre of mass it returns is in the pose asked about.

## Needs from the preparatory step

1. **The model as modelled, for a query and for a caller.** Every query gets the posed context, and nothing in the shared contract lets an entry or a caller ask otherwise.
   - The case of an entry: a print query of 1e with an orientation given as a direction (`up: [0, 0, 1]`), asked about `forearm` in a document whose stored pose has the elbow at 1.2. The context hands out the forearm turned by 1.2, and the bounds against the bed and the overhangs are those of the turned body, which is not how it is printed.
   - The case of a caller: the elbow is bent and its axis sketch is broken, so the forearm is blocked. The AI wants `query('body', { body: 'forearm' })` to find the face a new axis can stand on. For most joints it has a way that writes nothing: the same query with `after: setPose` to zero (above). The case that remains is a joint that cannot stand at zero or is at fault for more than its axis: limits that do not contain zero (`setPose` to zero is refused), a limit or a value whose expression is broken. The bodies beyond such a joint cannot be read at all until the joint is repaired, although the model as modelled is well defined.
   - Asked for: `QuerySpec.geometry: 'modelled'` (or the like) for an entry, and an option of the caller in `QueryOptions` and `QueryToolInput`, both giving the query the context an export gets. This package cannot add either: both types are the shared contract.
   - Until then: a print query by a direction is wrong in a pose, and the description for the AI has to say so (the way around is again `after: setPose` to zero, where the limits allow it); the bodies beyond a joint of the remaining case are not readable. (The second version of this design answered a state asked for with `at` as modelled, which gave a caller a back door; it is gone, see "Rejected".)
2. **The tool `query` does not say which pose it answered for.** Its answer is the result of the query alone.
   - The case: `query` with `interference` on a saved document whose pose is not zero. The report is for the bent arm, and nothing in the answer says so; `check_interference` gets a note by hand with this package, the general tool cannot.
   - Asked for: a place beside the result in the answer of the tool for a note of the engine about the state it answered for.
3. **`get_body` would mix a posed and a modelled answer.** The preparatory step has `get_body` read the state "as today" and take the faces and the edges from `query('body')`.
   - The case: `get_body` of `forearm` with the elbow at 1.2: the surfaces and the centres of the edges come posed from the query, the bounds as modelled from the state.
   - Asked for: `get_body` prints `volume` and `bounds` of the `BodyDescription` too. They are equal until this package, so nothing changes in the step itself.
4. **The checks before `run` should not read `context.bodies`.** They look up that a body, a face and an edge exist; these do not depend on the pose, and reading the posed record would pose every named body before the query runs and would throw for a blocked one before the query could be asked about anything else. A note for the implementation of the registry, not a change of a type.

Notes for the plan, which this session does not edit:

- **Dependencies.** The plan lists 1c and 3a. The code of this package needs 3a (the registry of sections) and the preparatory step. Scenario 13 needs 1c and also 1d, for the mass beyond a joint. The app side needs the generic form of 1b for the collisions, or an edit of `panels/collisions.ts`.
- **Shared places** this package writes to that the plan does not name for it: the context of a query (of the preparatory step); `interference.ts`, and the module of 1c for a pair in a frame; `viewport.ts` and the scene (the pose), shared with 1a, 1f and 3a; `get_body` and `check_interference` in `packages/mcp/src/tools.ts`.

## To verify before the implementation

None of this was tried in code.

- **A pair across a joint in a turned pose.** A pin of the child in a hole of the parent, of the same diameter, turned by an arbitrary angle. `interference.ts` was written for exactly this ("a pin in a hole of the same diameter whose polygon is turned differently" is a fit), but for copies of a pattern, at a few angles. To check with the real kernel: that such a pair stays among the fits over a sweep, and how often the kernel fails on it (`failed`). A failed pair is neither clear nor colliding, so a sweep keeps the list (`calls.ts`).
- **The cost of a step** on the joint of scenario 9: how many pairs go to the kernel when one link moves, and how long a sweep of twenty steps takes. If it is too slow, a sweep in one call that stops at the first collision is the next thing to add.
- **Single precision.** The second body of a pair has its coordinates rounded to float32 after the turn. Whether flush faces of two bodies that moved against each other (a washer of the child on a face of the parent) give noise above the thresholds of `interference.ts` has to be seen.

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

For the owner. The first three are places where the design decides otherwise than the brief words it:

- **A coupled motion goes through a parameter**, not through the name of one joint in the expression of another. Both values follow one parameter; nothing new is needed in the expressions. Names of joints in expressions are deferred.
- **A forest, not a tree with one root.** Several roots are allowed and listed; the export of 5b asks for one.
- **A missing link is not a broken reference.** A joint cannot name a link that is not there, and a link that a joint names cannot be removed. A missing body and a missing sketch of an axis are broken references, as the brief says.
- **The model as modelled is the zero of every joint.** An arm modelled folded has its zero folded. A field for "the value as modelled" is deferred and can be added without a change of what is saved; if the first mechanism the owner builds is modelled in a pose that should not be called zero, it should come with this package.
- **The axis of a joint from a cylindrical face** ("the axis of this bore") is deferred with the other kinds of `AxisRef`. An axis through a sketch point needs the centre of the bore as a point of a sketch, which the model usually has.

For the implementation:

- How many poses of a solid are remembered, and whether a posed solid shares its triangles with the modelled one (it can: a turn keeps the order of the vertices).
- Whether the view should also offer the model as modelled while the model mode is shown (a switch in the panel), for a model whose stored pose is not zero.

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

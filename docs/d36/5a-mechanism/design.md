# 5a Mechanism description and the posed queries (D49)

**State: design, first version, written against the sixth version of the contract of the preparatory step (`0dc424b`) and against [3a](../3a-body-properties/design.md).** Not implemented; the plan puts the implementation after 1c and 3a. The types are in [contract.ts](contract.ts), the scenario as calls in [calls.ts](calls.ts); both are checked by `npx tsc -p docs/d36/tsconfig.json`. Validation scenario 13 is shared with 3a; this package writes the part "two revolute joints; the pose stepped through the range of one joint with the collisions asked at each step; the mass of what hangs beyond the first joint".

The package adds a section to the document. The shape of the section, its commands, its upgrade step and the way a pose reaches a query are decided in full; the app, the wording of the MCP answers and what the export of 5b builds on it are described.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Export for simulation": a mechanism description next to the parameters and the checks. A link is a name and a list of bodies that move as one piece; a body belongs to at most one link. A joint has a name, a kind (revolute, continuous, prismatic, fixed), a parent and a child link, an axis (`AxisRef`), limits as numeric fields that take expressions, and a value, the pose. The joints form a tree with one root; a reference to a missing body or link is a broken reference like any other. It replaces the move feature proposed earlier for the pose, and it serves the posed queries as well as the export. "Candidates": the AI steps a parameter and asks for the interference and the smallest gap at each pose.

The preparatory step has already decided how a pose reaches a query (`00-prep/contract.ts`, `QueryContext`): a pose is a state of the document; a query reads the geometry of bodies only from its context, which answers in the pose; what does not belong to a body (a sketch, an axis through a sketch point, a plane feature, a base plane) is never posed; an export always gets the bodies as modelled; over MCP a pose is asked with `after` of the tool `query`.

What the code says:

- **Everything a pose needs exists, in the pattern.** `AxisRef` (a base axis, or the normal of a sketch plane through a sketch point) with its validator `axisRef` and its references; the resolution of an axis against the state (inline in `Evaluator.transforms`; part 2 of the preparatory step cuts it out as `axis(ref, state)`); `RigidTransform`, `rotation(point, axis, angle)`, `transformSolid` and `transformFace` in `solid.ts`. A pose is a rigid transform per link, built from the same pieces as a copy of a pattern.
- **A step of the pose is cheap as a preview.** `applyCommand` returns a new document that shares the features; `Evaluator.run` finds every step in its memo (the memo follows the feature object and the values of its expressions, not the document), and `analyzeBody` remembers its result by the mesh. So `engine.preview` of a command that changes only the section costs the resolution of the section.
- **The answers about pairs are remembered by the meshes.** `Interferences` keeps what two bodies share in a `WeakMap` by the two `Solid` objects and rejects pairs by their boxes first. A posed query hits that memory only if a body that did not move is the same object in both poses.
- **The expressions know the parameters only.** `Environment` in `expression.ts` is the table of parameters ("later also values produced by the recompute"). A joint value named inside the expression of another joint would be a second kind of name with its own order of evaluation.
- **The view draws `evaluation.bodies[id].solid`** (docs/ui.md), and the app asks the collisions for the state it shows.
- **`interference` is one of the four methods of `Engine` that throw**; after the preparatory step it shares `run` with the query, so it answers in the pose as well.

## The cheap variant

A section `mechanism` of the document with links (a name, bodies) and joints (a kind, a parent and a child link, an axis as `AxisRef`, limits and a value as numeric fields). Five commands. The model as modelled is the zero of every joint. The recompute resolves the section into `evaluation.mechanism`: for every link the transform that takes it from where it is modelled to the pose, for every joint its numbers, its axis and its state. The context of a query applies those transforms to the bodies it hands out, so every query answers in the pose with no change of its own; a pose is stepped by previewing `setPose` (or a parameter) and asking over the previewed state. One query, `mechanism`, returns the resolved description.

**Deferred**, and why each can come later without a change of what is saved now (the entries of the section are validated strictly, so a new optional field is refused by a build that does not know it; no further upgrade step):

- A joint value named in the expression of another joint. A coupled motion goes through a parameter: both values follow `q`.
- A joint whose zero is not the modelled configuration (a field for the value the joint has as modelled), and a flag that reverses its direction.
- The axis of a cylindrical face or of a circular edge as a kind of `AxisRef`. It would serve the pattern as well and belongs to the shared vocabulary.
- Effort and velocity limits, rotor inertia and gear ratio: numbers the export of 5b passes through; 5b adds them to the joint.
- Named poses kept in the document.
- A copy of a pattern that follows its source into a link (an option of the link).
- A sweep in one call, and the static load of a joint as a query (the mass beyond it, the lever, the torque for a direction of gravity). Scenario 13 composes both from the calls that exist.
- Closed loops, and joints with more than one freedom.
- In the app: dragging a link in the view.

## The section

```ts
mechanism: { links: Record<Id, Link>; joints: Record<Id, Joint> }   // in Document, always present
```

`Link` and `Joint` are in `contract.ts`. The decisions:

- **The model as modelled is the zero of every joint.** A body stands where the timeline puts it when every value is 0. A joint value is then a displacement from the modelled place, and no link needs a stored placement (see "No placement of a link").
- **Records by ID, with an optional name.** A joint names its links, so a link needs an identity that a rename does not change: an ID chosen by the caller, as for features, and a name for people. The IDs follow the rules of every ID. They are unique among the links, and among the joints; they do not share the namespace of the features, because the natural ID of the link that holds the body `forearm` is `forearm`.
- **A link lists its bodies.** Membership is explicit: a copy of a pattern is a body of its own and is listed. The result names the bodies of the model that are in no link (`unassigned`), so a forgotten copy shows instead of silently staying behind. A link may be empty.
- **A joint is a variant by kind**, like an extent: a revolute and a prismatic joint have an axis, two limits and a value; a continuous joint an axis and a value; a fixed joint nothing. The limits are required where the kind has them (both export formats require them).
- **The axis is an `AxisRef` as it is today**, given in the modelled configuration. It is never posed by itself: the joints nearer to the root carry it along with the parent link. That is exactly what the preparatory step says of an axis through a sketch point, so no reference of its own is needed. A positive value turns by the right-hand rule about the direction of the axis, as a pattern does; for a sketch point that direction is the normal of the sketch plane.
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
- **`lower` not above `upper`, and `value` within them.** A command has the numbers at hand (an expression in a command is evaluated at once) and refuses a pose outside the limits; that is what tells an AI at once that a step of its sweep is beyond the range. A parameter may move any of the three later, so a load does not ask and the recompute does: `jointLimits`, `jointOutOfLimits`. A value that an expression takes out of the limits is not written back; the field keeps its last valid number, as a field of a feature does when its expression leaves its range.

## Commands

`setLink`, `removeLink`, `setJoint`, `removeJoint`, `setPose` (`contract.ts`). They are ordinary commands: `execute`, `preview`, a batch, `after` of the tools.

- **`setLink`** creates the link or changes the fields named; `bodies` replaces the list. Moving a body from one link to another is two commands in a batch.
- **`setJoint`** creates or replaces the whole joint in the input form. A joint has at most three numbers, so a merging patch like that of `updateFeature` is not worth its rules; what is taken over from it is that a string equal to the expression the field already has is kept without evaluation, so a form that sends the whole joint is not stopped by an expression that broke meanwhile.
- **`setPose`** sets the values of the joints it names. It is the command of a sweep and of `after`. Executed, it is one undo step; previewed, it writes nothing.
- **An error of a command** about an expression names the field by its address inside the section, as in 3a: the joint, a slash, the field (`elbow/value`).

## The result of the recompute

`evaluation.mechanism` (`MechanismResult` in `contract.ts`), computed after the timeline with the results of the other sections, from the section, the environment of the parameters and the final state of the timeline (the frames and points of the sketches, for the axes).

- **The transform of a link.** A root has the identity. For a joint with the motion M (a rotation about its modelled axis by its value, a translation along it, or the identity for a fixed joint), `T(child) = T(parent) ∘ M`: the child is first moved about the axis where it is modelled, then carried with the parent. The transforms are computed in double precision from the modelled configuration every time; nothing accumulates.
- **A joint in error** (its axis does not resolve, a field is in error, its limits are crossed or its value is outside them) has no motion. Its child link and everything beyond it are *blocked*: `blockedBy` names the joint. Their transforms are still there, with the joint counted as standing at zero, so that the app has something to draw; no query reads them (below).
- **The axis** of a joint is given as modelled (`axis`) and as the parent link carries it (`axisInPose`).
- **`carries`**: the bodies of the child link and of every link beyond it. It is what "the mass beyond a joint" is asked about.
- **Stable objects**, as in 3a: the result of a link or a joint is the same object while what it is computed from is the same.
- **The bodies of the evaluation do not move.** A feature that refers to a face, a sketch on a face and every export see the model as modelled, whatever the values are.

Two issue codes are added: `jointLimits` and `jointOutOfLimits`. The others a joint can have exist: `brokenReference`, `invalidExpression`.

## How a pose reaches a query

The context of a query (`QueryContext` of the preparatory step) is built by the engine for the state asked about. With this package it reads `evaluation.mechanism` of that state and poses what belongs to a body:

- `bodies[id]`: the body of the evaluation moved by the transform of its link (`poseOfBody`). Positions, the segments of the edges and the bounds are transformed; the volume, the faces and the names stay. A body in no link, or in a link with the identity, is the object of the evaluation itself.
- `surface(body, face)` and the frame of a face (`frame` with a face, an entity that is a face or an edge): moved the same way.
- A plane feature, a base plane, a sketch and its points, an axis: as modelled, by the rule of the preparatory step.

**Lazily, and remembered.** A body is posed when a query reads it, so a query about one body moves one body. A posed body is remembered by the modelled solid and the transform (a few poses per solid). A body that did not move between two steps of a sweep is therefore the same object in both, and what `memo` and the memory of the collisions keep for it is found again: a step computes only the pairs with a body that moved.

**Bodies that moved together are answered as modelled.** Two bodies of one link, or of two links joined by fixed joints, stand to each other as they are modelled. A query of the engine about a pair asks `movedTogether` and computes from the modelled solids: the answer for such a pair is the same at every pose, bit for bit, and is computed once. Without it every step would send the inner pairs of a moved link to the kernel again, with flush faces whose coordinates have been turned.

**A blocked body cannot be read.** Reading `bodies[id]`, a surface or a frame of a body whose link is blocked throws `QueryFailure('failed', …)` naming the joint. So a query answers for the pose that was asked, or says why it cannot; it never answers for a pose in which a joint silently stood still. A query that does not touch the blocked bodies answers as usual. (`Object.keys(bodies)` reads nothing; the checks before `run` look names up in the evaluation, where they do not depend on the pose.)

- Considered: a joint in error stands at zero and the query answers, as a feature in error is an empty operation. Rejected: a sweep over MCP returns only the answer of the query, so an AI would read "no collisions" at every step of a joint that did not move.
- The method `Engine.interference` throws in that case, as it throws for other mistakes of its caller, and `check_interference` passes the message on. The app asks through `query` by then (the generic form of 1b) and shows the reason.

**Stepping a pose.** In the engine: `preview` of `setPose` (or of `setParameter` for a coupled motion), then `query` with the previewed state; `calls.ts`, section b. Over MCP: the same command in `after` of the tool `query`. With `at` as well, the mechanism is resolved against the model up to that feature.

**The query `mechanism`** returns `evaluation.mechanism` of the state asked about. It exists so that the resolved description is reachable through the tool `query` by construction, with `at` and `after`: where the links stand in a pose that is not written, which joint is in error, what a joint carries.

**What stays as modelled**: every export (the context of a format is never posed), `evaluation.bodies`, and with them `get_model`.

### No placement of a link

The preparatory step left the placement of a body (any orientation against a directed frame, numbers with expressions, a `RigidTransform` as the result) to the first package that needs it, and named this package as a candidate. It does not need one:

- the bodies of a link stand where they are modelled, and that is the zero configuration;
- the frame of a link that an export needs is derived: its origin is the point its parent joint's axis was given by, its orientation that of the model (below);
- a part that is modelled in its own frame and put into the assembly is an inserted or imported body, and its placement belongs to the feature that inserts it (3b, 3c).

So the requirements written in `00-prep/contract.ts` stay for 3b.

## What the export of 5b will need

Not designed here; listed so that nothing it needs is missing from the section or the result.

- **The tree**: `links`, `joints`, `roots`. The export takes one root; several roots or a joint in error are refused. Bodies in no link are not part of the mechanism and are left out (`unassigned` lists them).
- **Frames**: the frame of a link has the orientation of the model and its origin at `axis.origin` of the joint the link is the child of (the root: the origin of the model). The origin of a joint in the frame of its parent is the difference of two such origins; the axis is `axis.direction`. Meshes are only translated.
- **Units**: the engine has millimetres, grams and radians; both formats want metres and kilograms. Lengths ·10⁻³, masses ·10⁻³, inertia ·10⁻⁹, the limits of a prismatic joint ·10⁻³.
- **The mass of a link**: the mass query of 1d over the bodies of the link as one piece, read as modelled (the context of an export), about the frame of the link. It reads the properties of 3a: a reference body counts with its stated mass, an auxiliary body is left out, a body without a mass fails the export with its name.
- **Meshes**: the bodies of a link that are not auxiliary, as modelled.
- **Names**: the IDs of links and joints are unique within their kind and hold no slash.
- **What is missing for the formats** and comes with 5b as optional fields of a joint: effort and velocity limits; for MJCF the rotor inertia and the gear ratio. A coupling of two joints lives in two expressions over one parameter; writing it as an equality of MJCF is 5b's to decide.

## Where the code lives

```
packages/engine/src/
  types.ts                 the section, the commands, the result; RigidTransform moves here from solid.ts
  sections/mechanism.ts    the entry of the registry of sections (3a): validation, commands, the result
  pose.ts                  poseOfBody, the posed bodies and surfaces with their memory, movedTogether
  queries/mechanism.ts     the entry of the query
  (the context of a query, of the preparatory step)   reads pose.ts for bodies, surfaces and frames
  interference.ts          asks movedTogether before the kernel
packages/mcp/src/tools.ts  modelSummary, documentProblems; get_body
packages/app/src/panels/mechanism.ts; the scene
```

The registry of sections of 3a takes the entry; `validateDocument`, `applyCommand`, `renameParameter`, `Evaluator.evaluate`, `settle` and `differs` are not edited again. The upgrade step is `5a-mechanism` (`MECHANISM_STEP`): it gives a document without the section an empty mechanism and reads nothing else.

**The life of a document** is that of 3a's table with the other name: a build of the branch saves the version of the `master` it started from (which has 3a) and `schemaSteps: ['5a-mechanism']`; `master` before the merge and other branches refuse it; `master` after the merge loads it; a build with 3a and without this package refuses a document of the merged `master` by its version; a field of a link or a joint that a build does not know (the effort limit of 5b) is refused, not dropped. The hole of 3a's table (a build from before the preparatory step drops what it does not know from a document of a branch) is the same hole here.

## MCP and the app

**By construction.** The five commands go through `execute`, `preview` and `after`; the types are in the part of `types.ts` that `describe_api` prints; the numeric fields of a joint are listed from `SECTION_INFO` of 3a; the query `mechanism` is reached by the tool `query` and listed with the queries; `get_document` returns the section.

**By hand**, with tests:

- `get_model` gets `mechanism` when there is a link: the links with their bodies, the joints with kind, parent, child, the numbers and the expressions, the roots when there are several. The bodies it lists stay as modelled, and the description of the tool says so. The problems go next to `failedChecks`: joints in error with their code and message, links with missing bodies, bodies in no link. `execute` and `preview` return the same lists.
- `get_body` prints the volume and the bounds of `query('body')`, not of the state (see "Needs").
- `check_interference` and `get_body` add a note to their answer when the pose moves any link, so that an answer for a bent arm is not read as one for the model as modelled.
- A paragraph of the conventions in `describe_api`: the model as modelled is the zero of every joint; the sign of a turn; a pose is stepped with `after: { type: 'setPose', … }`; exports are always as modelled.

**The app**:

- A panel *Mechanism* (`panels/mechanism.ts`): the tree of links and joints, the bodies of each link, the bodies in no link, the problems. A joint has a slider between its limits and a numeric field that takes an expression. Dragging the slider previews `setPose`; releasing it executes it. *Reset pose* sets every value to zero.
- Links and joints are made and changed in forms of the panel: a link by a name and a pick of bodies, a joint by its kind, its two links, its axis (the picker of an axis that the form of the pattern has) and its numbers. Every confirmation is one command.
- **The view shows the pose** in the model mode: the app applies the transform of the link to the mesh of each body, without new geometry, also at the marker of the timeline. In a sketch and in the form of a feature the view shows the model as modelled, because that is where sketches, planes and the references of features are; the status line says which of the two is shown.
- The collisions are asked for the state shown, so in the pose; the highlight of a pair follows.

## Shared vocabulary

**Taken**: from the preparatory step the additions to the unions, `QueryContext` and its rule of the pose, `QuerySpec`, `IssueAfter`, `UpgradeStep`, the tool `query` with `after`; from 3a the registry of sections with its numeric fields, `SECTION_INFO`, the check of a body ID, `standInMass` and the properties behind it; from the engine `AxisRef`, `RigidTransform`.

**Added**:

| Name | Where | Who uses it |
|---|---|---|
| `mechanism` in `DocumentSections` and in `EvaluationAfter` | the shared maps | 5b; the app |
| `setLink`, `removeLink`, `setJoint`, `removeJoint`, `setPose` in `Commands` | | |
| `mechanism` in `Queries` | | |
| `jointLimits`, `jointOutOfLimits` in `IssueCodes` | | |
| step `5a-mechanism` | `UPGRADES` | |
| `standInGap` in `Queries` | a stand-in, removed when 1c is merged | |
| `poseOfBody`, `movedTogether` | engine | the context of a query; 1c, for pairs that moved together |

**Stand-ins.** `standInGap` stands for the smallest gap of 1c. Assumed of it: it takes two bodies and a search distance, reads the bodies from its context (so it answers in the pose), and tells "farther apart than the search distance" from a distance. `standInMass` is declared by 3a and stands for the mass query of 1d; assumed here in addition: the centre of mass it returns is in the pose asked about.

**The plan.** The plan lists 1c and 3a as what this package needs. Its code needs 3a (the registry of sections) and the preparatory step; 1c and 1d are needed by the scenario only: the queries of track A answer in a pose without knowing of this package.

## Needs from the preparatory step

1. **A query that has to answer as modelled.** Every query gets the posed context. For some that is wrong.
   - The case: a print query of 1e with an orientation given as a direction (`up: [0, 0, 1]`), asked about `forearm` in a document whose stored pose has the elbow at 1.2. The context hands out the forearm turned by 1.2, and the bounds against the bed and the overhangs are those of the turned body, which is not how it is printed. (An orientation given by a face is not affected; the default list of bodies of a print query is another matter, 3a.)
   - Asked for: an entry of the registry can say that it reads the model as modelled (`QuerySpec.geometry: 'modelled'`, or the like), and the engine then gives it the context an export gets. This package cannot add it: `QuerySpec` is the shared contract.
   - No stand-in is needed for the calls of this package. A caller can get the same today by previewing `setPose` with zeros, which is what the description for the AI would have to say for print queries if the flag is not added.
2. **`get_body` would mix a posed and a modelled answer.** The preparatory step has `get_body` read the state "as today" and take the faces and the edges from `query('body')`.
   - The case: `get_body` of `forearm` with the elbow at 1.2: the surfaces and the centres of the edges come posed from the query, the bounds as modelled from the state.
   - Asked for: `get_body` prints `volume` and `bounds` of the `BodyDescription` too. They are equal until this package, so nothing changes in the step itself.
3. **The checks before `run` should not read `context.bodies`.** They look up that a body, a face and an edge exist; these do not depend on the pose, and reading the posed record would pose every named body before the query runs and would throw for a blocked one before the query could be asked about anything else. A note for the implementation of the registry, not a change of a type.

## To verify before the implementation

None of this was tried in code.

- **A pair across a joint in a turned pose.** A pin of the child in a hole of the parent, of the same diameter, turned by an arbitrary angle. `interference.ts` was written for exactly this ("a pin in a hole of the same diameter whose polygon is turned differently" is a fit), but for copies of a pattern, at a few angles. To check with the real kernel: that such a pair stays among the fits over a sweep, and how often the kernel fails on it (`failed`).
- **The cost of a step** on the joint of scenario 9: how many pairs go to the kernel when one link moves, and how long a sweep of twenty steps takes. If it is too slow, a sweep in one call that stops at the first collision is the next thing to add.
- **Single precision.** A posed body has its coordinates rounded to float32 after the turn. Pairs that moved together are answered as modelled for that reason; whether flush faces of two bodies that moved differently (a washer of the child on a face of the parent) give noise above the thresholds of `interference.ts` has to be seen.

## Rejected

- **The pose as a move feature at the end of the timeline** (the first proposal of the backlog). It hides the structure in the timeline, where the export would have to guess it back; it moves the bodies of the evaluation, so a sketch on a face and every later feature would follow the pose; and a step of the pose would change a feature and compute everything after it.
- **The pose as an argument of every query.** Decided against by the preparatory step: a pose is a state of the document, so that the app, MCP, undo and a saved file agree on it, and so that a value can be an expression.
- **Membership of a link as a property of the body** (a field of 3a's entry). It would make "at most one link" true by construction. Rejected: the mechanism would be spread over two sections, a link would exist only through its bodies (an empty carrier link could not be said), and the export reads links with their bodies.
- **Joints or links as features.** They are not geometry; a change of a value would compute the timeline.
- **A placement stored with the link.** See "No placement of a link".
- **The axis as numbers** (a point and a vector, as in the files of the formats). It would not follow the model, and an AI would compute it from coordinates it recalls. An `AxisRef` follows the sketch.
- **One root as a rule of the commands.** See above: it would force the mechanism into one batch and forbid two arms.
- **A value outside the limits clamped, or only warned about.** A clamped pose is not the pose asked for; a warning is not seen by a caller that reads only the answer of a query. A command refuses it and a recompute reports it as an error of the joint, which blocks the queries.
- **Copies of a pattern follow their source into its link**, as they inherit its properties in 3a. The planets of scenario 9 are copies of one body and each turns on its own pin; the rule would be wrong there, and the list of a link would no longer say what moves. The properties are different: a copy that is not told otherwise should be made of what its source is made of.
- **The value in a record of the section, apart from the joints** (`pose: Record<Id, number>`). Named poses could be added either way; the expression of a value has its place in the joint with the other numeric fields.

## Open

For the owner:

- **The model as modelled is the zero of every joint.** An arm modelled folded has its zero folded. A field for "the value as modelled" is deferred and can be added without a change of what is saved; if the first mechanism the owner builds is modelled in a pose that should not be called zero, it should come with this package.
- **The axis of a joint from a cylindrical face** ("the axis of this bore") is deferred with the other kinds of `AxisRef`. An axis through a sketch point needs the centre of the bore as a point of a sketch, which the model usually has.

For the implementation:

- How many poses of a solid are remembered, and whether a posed solid shares its triangles with the modelled one (it can: a turn keeps the order of the vertices).
- Whether the view should also offer the model as modelled while the model mode is shown (a switch in the panel), for a model whose stored pose is not zero.

No third-party library is needed.

## Reviews

Recorded here after the reviews of the designs of track E.

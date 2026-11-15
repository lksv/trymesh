# 1b Measuring between two named entities, and the generic form of a query in the app

**Decision D39. State: designed, not implemented.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario and the app side as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

Validation scenario 11 (the queries asked about the robot joint of scenario 9), this package's part: the wall between the root circle of the ring gear and the bolt holes.

This package carries two things: the query `measure`, and the generic form of a query in the app, on which the app side of 1a, 1c, 1d and 1e builds.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Proposed order", has one line: measuring between two named entities. The brief of track A adds: distance and angle, the distance of the axes of two cylinders, exact for planes and cylinders, built on the description of a body.

- **What is exact in the engine.** A face has an analytic description (`FaceInfo` in `solid.ts`: a plane with a point and a normal, a cylinder with a point of its axis, the axis and the radius, a swept surface with its direction). The preparatory step publishes it as `Surface` and gives a query `context.surface(body, face)`. The frame of a planar face has its normal pointing out of the body (`faceFrame`: the analytic direction, the sign from the summed normals of the triangles). A straight edge is the line of its two planes and a circular edge the circle of a plane and a cylinder; `projectEdge` computes both analytically and takes only the extent of a line from the mesh. A sketch point is solved in double precision.
- **What is not.** The mesh has float32 vertices and round faces are polygons inscribed in the circle with the chord tolerance of the document (0.01 mm by default). A hole is therefore narrower than its circle at the middle of a chord, and a pin thinner. `edgeShape` in `packages/mcp/src/tools.ts` fits the circle of a circular edge to three of its vertices and leaves it out when it has too few.
- **The scenario does not have an exact answer.** The ring gear of scenario 9 is cut by a generated profile, so its wall is one face `ring/side/teeth` of the kind `swept`: the engine knows only the direction it was swept along. The root circle is a fact the generator publishes (`rootDiameter`), not a surface. So the step of the scenario is exactly the case the brief asks about: a pair without an exact answer.
- **Measured on the model of scenario 9** by a prototype of the pass (kept outside the repository): the smallest distance on the mesh between `ring/side/teeth` and the bolt hole `boltHole/side/bh` is 15.2837 mm against 15.275 exactly (50.5 − 1.7 − 33.525); between the ring gear and the outer wall 21.4638 against 21.475; between a carrier pin and the bore of a planet 0.1405 against 0.15. Every difference is below one chord tolerance per round face, in either direction. A face of 1440 triangles against one of 58 took 6 ms, against one of 330 triangles 23 ms.

## The cheap variant

One query, `measure`, with two arguments `from` and `to`. Each is a face or an edge of a body or a sketch point (`EntityRef` of the shared vocabulary without `body`). The answer has an exact part where the two entities have one, and a part measured on the mesh always.

**What an entity is** (`EntityShape`, resolved by `entityShape`): a point, a line, a circle, a plane, a cylinder, a cone, a swept surface, or `other`. Each has a reference (what a distance is taken to) and may have a direction:

| Shape | From | Reference | Direction |
|---|---|---|---|
| point | a sketch point | the point | none |
| line | an edge of the kind `line` | the line of its two planes | along it |
| circle | an edge of the kind `circle` | its centre | its axis |
| plane | a planar face | the plane | the normal out of the body |
| cylinder, cone | a face | the axis | the axis |
| swept | a face | none | the direction it was swept along |
| other | a general face, an edge of the kind `coplanar` or `other` | none | none |

**The exact part.**

- `distance`: between the two references, taken without their ends. It exists for a point and anything with a reference, for two lines (the common perpendicular; zero when they cross), and for a line and a plane or two planes only when they are parallel within `ANGLE_TOLERANCE`. Two planes that are not parallel cross somewhere, and zero would say nothing about the two faces.
  - Two cylinders: the distance of their axes, which is what the backlog names.
  - A cylinder and a planar face along its axis: how far the axis of the hole is from the wall.
  - Two parallel planar faces: the distance of the planes, also when the faces do not lie over each other (two steps).
- `angle`: between the two directions.
  - Two planes: between the normals out of the bodies, 0 to π. 0 is two faces that look the same way, π the two sides of a wall or the two walls of a slot.
  - A plane and a line or an axis: between the line and the plane, 0 to π/2.
  - Two lines or axes: 0 to π/2. An axis has no sign.
- `facing`, for two planar faces that look opposite ways: `away` (each lies behind the other: a wall, and `distance` is its thickness) or `towards` (they look at each other: a slot or a gap). It is the sign of the offset of one plane along the outward normal of the other. Without it a wall and a slot of the same width give the same numbers.

**The measured part**, `smallest`: the smallest distance between the two entities as they are on the bodies, with their outlines and ends, and the two points it lies between. It is a pass over the triangles of the two faces (or the segments of an edge, or the point), so it exists for every pair, a face of gear teeth included.

- `accuracy` bounds its difference from the exact shape: one chord tolerance of the document for each of the two entities that lies on a body. A sketch point adds nothing. The bound is an upper one: between two planar faces with straight outlines the value is exact to the precision of the coordinates, but a planar face may end in the polygon of an arc, and the pass does not know.
- For a pair with an exact answer both parts are returned and they answer different questions. For a hole next to a wall, `distance` is the axis to the wall and `smallest` the material left between them.

**A pair without an exact answer** gets `smallest` with its accuracy, `angle` when both entities have a direction (a face of gear teeth has one), and no `distance`. Nothing is fitted to the mesh to make up an exact-looking number.

**Circles are read from the surfaces.** `BodyEdge` of the description of a body (which the preparatory step moves into the engine as it is) gets its circle from the two surfaces of the edge instead of a fit to three vertices: the member is always there and gains the axis (`BodyEdgeExact`). This changes what `get_body` prints for a circular edge in the last digits, and gives a circle to an arc with fewer than three inner vertices. The one test that reads those numbers (`packages/mcp/test/tools.test.ts`, the rim of a boss) compares to four decimal places and passes unchanged.

**Deferred.**

- A plane feature, a base plane or a base axis as an operand. The answer already says what each entity is in the coordinates of the model (a point and a direction), so a distance to a base plane is one coordinate of it. Adding them later is one more accepted kind, or an alternative (`oneOf`), and makes every call longer; see "Rejected".
- A whole body as an operand. Two bodies are the smallest gap (1c); a body against a face has no caller yet.
- The largest distance, and the distance along a given direction.
- Cones are in the contract and are filled in by the package that builds the first one (2b); until then no face resolves to a cone.
- A sphere or a torus as a shape: they come with the kinds of surfaces the revolve adds (4a).
- Measuring over a previewed state in the app (the form asks at the marker only). Through MCP it works already: the tool `query` takes `after`.

## Where it lives

```
packages/engine/src/
  entity.ts            entityShape: an EntityRef to an EntityShape, over the context
  mesh-distance.ts     closest: the smallest distance of two parts of the mesh (shared with 1c)
  queries/measure.ts   the entry: arguments, the table of exact answers, the result
packages/app/src/
  panels/query.ts      the generic form: the menu, the controls, the answer, its life
  queries/index.ts     QUERY_VIEWS
  queries/controls.ts  a control per kind of argument
  queries/measure.ts, queries/interference.ts   the two views of this package
```

`queries/` in the engine is this track's proposal for where the modules of queries go; the preparatory step names no directory.

- `mesh-distance.ts` holds the triangle against triangle distance (six vertex to triangle and nine edge to edge distances; `closestOnTriangle` exists in `solid.ts` and moves here) and the pass over two sets with boxes.
  - The pass is quadratic in the worst case, so it starts with an upper bound (the caller's `within`, or the smallest distance among a coarse sample of about fifty triangles of each part) and drops every triangle whose box is further than that from the box of the whole other part. The prototype without this step needed 70 to 280 ms for two whole bodies of the joint (1768 triangles against 916 and against 5310), with it 8 to 47 ms; two whole bodies are the case of 1c.
  - Where the closest point lies on an edge or a corner of a body, triangles of several faces are equally close. The face named is the one that faces the other part most directly. The prototype named the cap of the planet for the gap to the carrier pin before this rule and the wall of its bore after it.
- `entityShape` reads only the context: `surface(body, face)`, `frame` of a face for the normal out of the body, `bodies[body].edges` with the surfaces of the two faces of an edge, `sketch(id)` for a point. So it answers for a pose (5a) without a change. `convex` of a cylinder or a cone comes from the description of the body (`QUERIES.body.run` with the same context).
- The check before `run` has already established that the body, the face, the edge and the point exist in the state asked about. What `run` can still find: a sketch that did not evaluate (it is in the document, so it is a valid argument), answered as `notAvailable` with the path of the argument.

## What it adds

| To | What |
|---|---|
| The document | nothing |
| Commands | none |
| `Queries` | `measure` |
| Issue codes | none: a query answers with a `QueryOutcome` |
| `BodyDescription` | the circle of a circular edge becomes exact and required (`BodyEdgeExact`) |
| The engine's modules | `entityShape` and `closest`, both used by other packages of the track |
| MCP | nothing by hand: the tool `query` reaches it; `returns` describes the answer |

`measure` reads the geometry of bodies only from its context, so it is asked at `at`, over `after` and, later, in a pose.

## The generic form of a query in the app

Part 3 of the preparatory step decides that a form is built from the description of the arguments of a query, that a query may have a view of its own, and that an answer belongs to the document and the place on the timeline it was asked at. It leaves the form itself to this package. What follows is that design; the interfaces are in `contract.ts` as stand-ins (the app's own types cannot be imported into a draft) and, unlike the sketch of part 3, they are type-checked: every query of track A writes its view against them in its `calls.ts`.

**Today.** The collisions are the one query of the model in the app: a toolbar button, a block of the model panel, a field of `App` with the answer and the marker it was asked at, a picked pair that highlights two bodies in the scene, and a note in the status bar that goes when the answer goes (`checkCollisions`, `collisionsPanel`, `shownCollisions` in `app.ts`). A click in the model mode selects a face, an edge or a plane in one place (`onUp`: `this.selected = pick`), and edges are picked only in the model mode. Sketch points are picked only inside the sketch mode.

**The panel.** One query is open at a time, shown in the model panel below the selected feature, where the collisions are today. Its state is one object (`QueryPanelState`) that the app holds and only the panel reads and writes: the name of the query, the arguments being filled in, the control that is armed, and the answer.

- **The menu.** A toolbar button lists the queries of `QUERIES` by title, with the summary as the tooltip. A query needs no entry anywhere to be there: this is the app half of "every function is reachable from the app and through MCP". The button "Collisions" stays and opens `interference`.
- **A control per kind of argument** (`CONTROLS`, typed over the kinds, so a new kind does not compile until it has one):

  | Kind | Control |
  |---|---|
  | `number` | a number field with its unit as a suffix, the range checked while typing. An angle is typed and shown in degrees, as everywhere in the app. It takes a number, not an expression: a query does not live in the document, so there is nothing to keep an expression in. A default is shown as the placeholder |
  | `flag`, `text`, `choice` | a checkbox, a text field, a choice |
  | `body`, `feature`, `sketch` | a choice from the state shown at the marker |
  | `constraint` | a choice from the constraints of the sketch chosen in the argument `of` names |
  | `entity` | a face or an edge: taken from the selection in the view while the control is armed. A body: the same (the body of the face clicked) or a choice. A sketch point: a choice of the sketch and of its point (the origin, own points, points of projected geometry), because the view picks points only inside a sketch |
  | `plane` | a base plane or a plane feature from a choice, or a planar face or a plane selected in the view while armed |
  | `axis` | a base axis from a choice, or a sketch and its point |
  | `vector` | three numbers |
  | `list` | a row per element, added and removed within `min` and `max` |
  | `oneOf` | a choice of the alternative and the control of the chosen one |
  | `record` | a row per key; the key from a choice of bodies or features, or a text |
  | `fields` | a group |

- **Selections.** The app keeps its one place where a click selects. Before it stores the selection it offers it to the panel (`takeSelection`); an armed control that accepts the kind takes it, the next control of the kind `entity` or `plane` that is still empty is armed, and the app keeps no selection of its own for that click. This needs no new way of picking and no new mode: the panel lives in the model mode, where faces, edges and planes are picked already.
- **Asking** is a button, not a side effect of typing: a query may take seconds. The app calls `engine.query(name, args, { at: marker })` through one function with one cast (`askQuery`), because the name is known only at run time; the engine checks the arguments against the description. An error is shown at the control its path names (`error.arg`), the way a field of a feature form is marked today, and in the status bar.
- **The life of an answer** is that of the collisions today: it remembers the marker it was asked at and the arguments it was asked with; it is shown while the marker is there, hidden while it is elsewhere and shown again on return, and dropped when the engine reports a change of the document. The arguments in the form survive the change; an ID in them that is gone is found by the engine at the next ask.
- **The answer without a view** is a tree of names and values. Numbers are rounded as the tool `query` rounds them (six decimal places, or the significant digits `significant` gives). An object with `feature` and `role` is written as the app writes a face name, a body ID as the app names a body. Units: see "Needs from the preparatory step".

**A view of one query** (`QueryView`, `QUERY_VIEWS` by query name, optional): the rows that replace the tree, what the answer adds to the scene (lines, points, fills, highlighted faces and bodies, labels: the fields `SceneModel` has today), the note for the status bar, whether the query is asked as soon as its form opens, and what it is asked with when the view needs more of the answer than the form's arguments give (`prepare`). A view gets the state the answer was asked about, the names the app uses, a picked row (what a row is belongs to the view) and a way to ask again with other arguments.

- **`interference`**: the collisions panel of today becomes this view (`calls.ts` writes it): asked at once, the pairs and the fits as rows, a picked pair highlights its two bodies, the note of today. `panels/collisions.ts` of the preparatory step goes. The app then calls `engine.query('interference', …)` where it called `engine.interference`; the recorded calls of the app test of part 3 change in that one line, and the commit says so.
- **`measure`**: the numbers with units (a distance between faces that look away from each other is labelled as a thickness), the two entities highlighted, and the two points of the smallest distance joined by a line with its length.
- What the other four add is in their designs: the section clips the scene and fills the cut (1a), the gap lists pairs and draws the line of a picked one (1c), the print query lists orientations and highlights the overhanging faces of a picked one (1e); mass properties (1d) need no view.

**What the form does not do**: ask over a preview or while a feature form is open (the model panel is not shown then), keep several answers at once, or save a question with the document.

## Needs from the preparatory step

- **The unit of a number in a result.** `QuerySpec` has `significant` (keys whose numbers are small on purpose) and `returns` (a sentence for the AI), and nothing a program can read about units. The case that cannot be written: the generic form shows the answer of `measure` without a view and has `angle: 1.570796`; it cannot write `90°`, which is how the app shows every other angle (the rule that only the GUI converts bare numbers). Proposed: an optional `units` on `QuerySpec`, keys of the result at any depth to a unit, in the form `significant` has; mass properties (1d) need one unit more than `QuantityUnit` has, `g·mm2`. Stand-in: `ResultUnits`, a map each query of the track exports next to its entry, and `QUERY_UNITS`, which the form reads.
- **A failure in `run` that is the caller's mistake.** `QueryFailure` takes `notAvailable` or `failed`. A relation between arguments that a description cannot express (in this track: a body without a density in 1d, a bed with a size that is not positive in 1e, fewer than two different bodies in 1c) is found in `run` and is neither: nothing is missing from the state and the computation did not give up. Proposed: `invalidArguments` as a third code of `QueryFailure`. Stand-in: `failed` with the path of the argument.
- **Part 3, the scene.** A view adds to the scene (`QueryView.scene`), as a feature form does through `overlay`. For that `scene.ts` has to ask the panel of the queries for its additions when it builds the scene of the model, and resolve a face given by name to its mesh. Nothing of that is a new member of `PanelHost`; it is a call in the scene builder that the commit of this package adds. Stated here because part 3 lists the collisions as the only thing the scene asks a panel about.

Nothing is missing for the query itself: the context has the surfaces, the frames, the edges and the solved sketches, and `calls.ts` writes the entry in full.

## Rejected

- **Only the smallest distance on the mesh.** One number for every pair, as simple as it gets, and what `minGap` of the kernel would give for faces if it took parts of a body. It throws away what the engine knows exactly: the distance of two hole axes would come out a hundredth off and change with the chord tolerance, and an AI that reads 49.99 does not know whether the design says 50.
- **Only the exact part, and an error for a pair without it.** The scenario's own question (the wall next to the ring gear) would have no answer, and neither would any face of a generated profile, which is every gear.
- **Fitting a circle or a cylinder to a face of the mesh** to make gear teeth "exact". A root circle fitted to a tooth profile is a guess with no bound, presented as geometry. The generator publishes the real one as a fact, and the scenario shows the exact route through it.
- **`distance` as the distance of the surfaces, radii included** (for two cylinders the material between them). It has three cases for two parallel cylinders alone (apart, one inside the other, crossing) and none for skew ones; the answer gives both radii, and `smallest` measures the material directly.
- **Base planes, plane features and axes as operands through `oneOf`** (`{ entity } | { plane } | { axis }`). Every call would carry one more level for a case the answer already covers; left for the day a caller needs it.
- **A unit-less angle convention of one range for all pairs** (0 to π/2 everywhere). For two faces it loses the difference between two steps and the two sides of a wall, which is exactly what the outward normals know.
- **A panel class per query, written by hand**, as the collisions are today. Five queries of this step and more later would each repeat the form, the life of the answer and the errors; and a query without a panel would not be reachable from the app at all.
- **A new mode of the app for an open query** (like a draft). A draft previews a change of the document; a query changes nothing, and a mode would block the model panel, the selection and the timeline marker, which the form uses.
- **A pick requested by the panel through a new member of `PanelHost`** (the way `pending` waits for a plane). The existing selection, offered to the panel first, does the same without a second way of picking.

## Open

- Whether the pass needs a grid instead of the boxes of the whole parts. The prototype stays under 50 ms for everything in the joint; two parts of ten thousand triangles each that run close to each other along their whole length (two gears of that size) would keep most of their triangles after the coarse step. To measure in the implementation, on a model larger than scenario 9.
- The labels of the generic tree are the keys of the result, in English, while the app is mixed-language. A table of titles per key would be the next step if the tree is used much.

## Reviews

Not reviewed yet.

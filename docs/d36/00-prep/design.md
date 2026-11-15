# 00 Preparatory step

**State: scope approved; parts 1 and 4 have a contract in its third version and part 2 a design in its second, after two rounds of reviews; the third round is pending.** The owner approved all six parts on 2026-11-14: first the registry of queries and the split of `app.ts`, then the four parts Claude added from reading the code (a module per feature type, the shared vocabulary, documents by area, working in several trees).

| Part | State |
|---|---|
| 1 Registry of queries | signatures in [contract.ts](contract.ts), written out as calls in [calls.ts](calls.ts); reviewed twice and rewritten twice, see "Reviews" |
| 4 Shared vocabulary | same |
| 2 A module per feature type | designed in [part2-feature-modules.md](part2-feature-modules.md); reviewed once and rewritten |
| 3 Panels and forms of the app | proposal below; the context of a panel is not designed |
| 5, 6 Documents by area, several trees | proposal below; no code |

The contract is checked by `npx tsc -p docs/d36/tsconfig.json`. Parts 2 and 3 change no public type, so they get a design and no contract.

The step is the counterpart of step 0 of D35. It adds ways in and moves code; what the existing methods, commands and tools answer stays, with the one exception listed in part 1. Every existing test passes unchanged. Its purpose is that the packages of [the plan](../README.md) add files and single lines instead of rewriting the same places.

It is done by one session, not in parallel, after D35 is closed, and it follows the procedure of CLAUDE.md like any point.

## 1. Registry of queries

**Today.** A query is a method of `Engine` (`diagnoseSketch`, `explainConstraint`, `interference`), and its MCP tool is written by hand in `packages/mcp/src/tools.ts`. Three things follow:

- A new query touches the `Engine` interface, `engine.ts`, `tools.ts` and the guard table. Step 1 of D36 is six queries, so six packages would edit the same four places.
- The three methods throw for a wrong argument (`interference.ts` checks the threshold, the shape of the list and that the bodies exist; `engine.ts` throws for an unknown sketch or constraint). The MCP tools check the arguments themselves first and answer with their own error (`check_interference` also wants at least two different bodies when a list is given); an exception of the engine that gets past those checks is passed on as a failure of the tool. The app calls `interference` and `diagnoseSketch` without catching.
- Part of what the AI is told is computed in the MCP package and the app cannot use it: `bodyDetail` and `edgeShape` (area and normal of a face, length, ends, centre and radius of an edge), `sketchDetail` (areas of regions, advice on what to constrain). That is the mirror image of the rule that the app must not compute.

**Design** (`contract.ts`, third version).

- **A catalog `QUERIES` in the engine**, built like the registry of feature types. An entry has a title, a summary and a description of what it returns (all three go to the description for the AI), a description of its arguments, and a function over a context. `Engine.query(name, args, options)` is the way in for everything new.
- **The four methods of today stay.** `diagnoseSketch`, `explainConstraint`, `interference` and `exportMesh` keep their signatures and keep throwing for a wrong argument, as D35 decided and as about two hundred calls in the tests expect; inside they call `query` and `export`. No further method of this kind is added to `Engine`.
- **A query answers for one state and never recomputes it.** A query reads more than the public state: the diagnosis of a sketch needs the input of the solver, how the solve ended and the analysis of freedom, which live in the internal state of the recompute. The engine therefore keeps, for every state it hands out, the internal state it came from, by the identity of the evaluation, and the context gives a query what it needs from there: `frame`, `axis`, `face` (the number of a named face) and `sketch` (the `SketchState` of the recompute). A drag preview is diagnosed as dragged. `calls.ts` writes the two sketch queries of today as entries over this context.
- **A query reads bodies from the context** (`context.bodies`), never from the evaluation. With the mechanism of step 5 these are the bodies in the asked pose, while the evaluation keeps them where they were modelled; a query written against the context answers for a pose without a change. A query that builds on another calls its `run` with the same context.
- **The state is chosen three ways:** the current one, the one after a feature (`at`), or one that `preview` returned (`state`); the last two exclude each other in the type. A state this engine did not hand out is refused. The app builds one such state by hand (the model before the first feature) and asks nothing about it.
- **Arguments are named and described** (`ArgSpec`): a number with unit and range, a flag, a text, a choice, an ID of a body, a feature or a sketch, a constraint of a sketch, a reference to a named entity with the kinds it accepts, a plane (`PlaneRef`), an axis (`AxisRef`), a vector, and four ways to build structure: a list with a least and a greatest count, exactly one of several named alternatives, a record by ID, and named fields of different kinds. `calls.ts` writes with them a section, a print query with several orientations that are each a direction or a face and may add a turn, a pose and mass properties.
- **The type of the arguments is derived from their description** (`ArgsOf`), so the two cannot disagree. A reference to an entity gets the type of exactly the kinds it accepts; two alternatives of a `oneOf` at once do not compile. `run` gets the same type with the defaults of optional numbers filled in (`RunArgsOf`).
- **The types of queries are a map by name that modules extend by declaration merging** (`Queries`). A package adds its description, its result and its entry in its own file; no shared type is edited. The registry is typed so that an entry cannot disagree with the map, a registry object can be written (the second version could not: its types did not terminate), and the engine dispatches by name without a cast.
- **A query does not throw for what its caller can cause.** `QueryOutcome` is a result or an error with a code: `invalidArguments`, `notAvailable` (the thing asked about does not exist in this state), `failed` (the kernel, a limit), and the name of the argument concerned.
  - Before `run` the engine checks every argument against its description (shape, range, that what is named exists) and fills in defaults. A body or an entity is looked up in the state asked about; a sketch, a feature or a constraint in the document, so a sketch that did not evaluate is still a valid argument, and one that comes after `at` is `notAvailable`.
  - `run` throws `QueryFailure`, with the argument when there is one, for what only the computation finds out. An exception of the kernel inside a query becomes `failed`, because the port says that a boolean throws.
  - An exception of another kind is a defect and passes through, as it does for commands.
- **What is a successful answer today stays one.** A sketch that did not evaluate has the diagnosis `unavailable`; a list of one body has no collisions and `checked: 0` (a test of the scenarios requires it).
- **A cache comes with the context** (`memo(owners, key, compute)`): a result lives as long as all the objects it was computed from. Both solids own an answer about a pair of bodies, as in the cache of `interference` today. The contract names the owners that live across recomputes (a solid, a solved sketch, the document or a section of it) and the ones that never hit (the state, the evaluation, the map of bodies); at least one owner is required, and the keys of different queries are kept apart by the engine.
- **A large answer says that it was cut** (`Truncated`): a query with such an answer has an argument that limits it. The engine is synchronous and cannot cancel, so a query that can be slow bounds its work by its arguments.
- **The description of a body moves into the engine as it is** (`BodyDescription`): what `bodyDetail` and `edgeShape` compute, including the number of segments of an edge, the normal of a planar face summed from its triangles, and a centre and radius fitted to vertices, which may be missing. The step adds the surface of a face and whether a cylinder or a cone is a hole or a pin (one more pass over the triangles of the face). Reading circles from the surfaces instead of fitting them changes numbers and belongs to package 1b.

**One MCP tool `query`** reaches every entry of the catalog, the way `execute` reaches every command and `sketch_tool` every sketch tool. D33 chose few general tools over a tool per operation; the second version of this design generated a tool per query and departed from that without saying so.

- Its input is the name of the query, its arguments, `at` and `after`. `after` is a command: the preview and the query run together where the engine is (in the app when one is connected) and nothing is written. That is how an AI steps a parameter or a pose and asks at each step, for every query, the existing ones included. With both, the previewed document is evaluated up to `at`.
- The answer is the result with numbers rounded to six decimal places, as the tools round geometry today.
- The description of the tool lists the queries from the catalog.

**No existing tool changes its name, its schema or its answers**, with one exception. `check_interference`, `get_sketch`, `explain_constraint` and `get_body` stay hand-written and call `query` inside; `get_model`, `get_document` and `get_parameters` are views of the state and stay as they are. The exception: `check_interference` with an unknown `at` and no `bodies` answers today with the text of an exception of the engine (`getState: feature "nope" neexistuje`, passed on as a failure of the tool), and will answer like the same call with `bodies` does.

**What a tool may answer** (`ToolAnswer`). Today a tool returns JSON and the server prints it as text; `callTool` and the bridge to the app pass the result through JSON, so bytes do not survive, and STL has a base64 envelope of its own in a hidden tool. That envelope becomes general: an answer is data, files (with the layout `file` or `directory`), or an image, which the server returns to the client as image content. `ToolOutcome.result` stays JSON; a `ToolAnswer` is JSON, and the server acts on its kind.

**Operations of the app** (`HostOperation`, `HOST_OPERATIONS`). A picture of the viewport is not a query: the engine has no renderer and the operation is asynchronous. It is an operation of the host, described like a query and offered as a tool; over a document from a file it answers `notAvailable`.

- The operations are a registry in the module the server and the app share, extended by declaration merging like the queries; the description for the AI and a guard read it.
- An operation answers with a `QueryOutcome`, so it has the same error channel as a query.
- `Tool.run`, `callTool` and `connectBridge` carry only the engine today. They carry the host, of which the engine is a part, and the path of a tool call becomes awaitable; the queries of the engine stay synchronous.
- An exception inside an operation or a query is reported over the bridge as a failed question, not with today's text for commands ("the change may have been made").

**The description for the AI.** `describe_api` cuts its types out of the raw text of `types.ts`, so types in query modules do not reach it. It gets four generated sections, like the one for constraints: the queries (name, summary, each argument from its description, what it returns), the operations of the app, the catalogs (name and summary) and the export formats.

**Where the types live.** What a caller of the engine or an AI reads goes to `types.ts` (`Surface`, `EntityRef`, `QueryOutcome`, the additions to `Evaluation` and `Engine`). The machinery (`ArgKind`, `ValueOf`, `ArgsOf`, `QuerySpec`, the registries) goes to modules of its own, so that it does not reach the description for the AI.

**Guards.** A table of fixtures by query name, with arguments of the query's own type: a query without a fixture does not compile, and the test runs each one through the tool `query`. The table over the methods of `Engine` stays. A test checks what types cannot: that every description is a valid `ArgSpecs` and that `of` of a constraint names an argument of the kind `sketch`. The examples of `calls.ts` use names that start with `example`, and its table of fixtures covers only its own names, because the contracts of all packages are type-checked together with it.

**Open.**

- The result types of queries are described to the AI by a text (`returns`). Whether the raw text of the query modules should reach `describe_api` as well, as `types.ts` does, is left to the first package with a result that a sentence does not describe.
- The generated form of a query in the app (part 3).
- How long a query may take over the bridge. The bridge gives up after 30 seconds, but that does not stop a computation in the app.

## 2. A module per feature type

**Today.** `document.ts` (1370 lines) holds the validators of all feature types and the registry `FEATURE_TYPES`. `Evaluator` in `evaluate.ts` has a private method per type (`plane`, `sketch`, `extrude`, `pattern`) and a `switch` over them. D36 adds at least six feature types (hole, import, insert, boolean of bodies, split, revolve, chamfer and fillet), each of which would add a block to both files.

Designed in full in [part2-feature-modules.md](part2-feature-modules.md); this is the summary.

**Proposal.** `packages/engine/src/features/<type>.ts` holds what belongs to one type: its entry of the registry (validation, references, bodies, the fields a patch may change) and its step of the recompute. The registry keeps one line per type and is the one guard of completeness; the `switch` goes.

- A step gets a small context (the state before it, the settings, the adapters, the `done` and `failed` callbacks). The helpers that are private methods of `Evaluator` today (`frame`, `profile`, `applyTool`) become functions over the state that a module imports.
- A validator gets what needs the registry through a validation context, so that no feature module imports the registry. Without it the modules would import each other in a circle.
- What is true of the extrusion only by name today becomes a property of the registry: whether a feature produces a tool that a pattern can repeat, and whether its profile comes from a generator.
- A profile is a service on both sides, the document and the recompute, because the revolve and the profile offset need it without the extrusion.
- This is the most delicate file of the engine. The change gets its own review and is done before any other part touches `evaluate.ts`.

**Open.** Whether tool builds (`buildPrism` in `solid.ts`) become modules of their own. Taper, revolve and twist are tool builds by the design of D35; decided in the design of 2a, the first package that changes them.

## 3. Panels and forms of the app as modules

**Today.** `packages/app/src/app.ts` is one class of 2321 lines. The panels (model, collisions, parameters, sketch, extrusion, plane, pattern) and the forms are its methods, so every package with a form edits the same file.

**Proposal.** A file per panel in `packages/app/src/panels/`, as functions over a context of the app (the engine, the shown state, the mode, the helpers for fields). A form of a feature type is registered by its type (its draft, its panel, its command), so a new type is a new file.

- A panel for a query can be generated from the catalog of queries the way the form of a generator is generated from its catalog entry. Then a new query is reachable from the app without work in the app, which is the other half of the rule "from the app and through MCP". To be decided in the design of 1b, the first query with arguments worth a form.
- The app has four test files (`fields`, `issue-text`, `sketch-diagnosis`, `sketch-tools`), all over pure functions; nothing tests the class. A split without a change of behaviour has to be checked by hand in the running app, or by a smoke test written first.

## 4. Shared vocabulary

Things that several packages need and that must be the same in all of them. They are settled here, before the contracts, not by whichever package is merged first. The types are in `contract.ts`; the table says what had to be decided and the list below it what the contract proposes.

| Item | Who needs it | What has to be decided |
|---|---|---|
| Kinds of faces and edges | 2b, 4a, 4b, 3d | `FaceInfo` has a plane, a cylinder and a swept surface. A cone is needed by the taper, the countersink and the revolve; a general surface by the revolve of an arc, the twist and the fillet. For each kind: can a sketch stand on it, which of its edges are circles or lines and can be projected |
| Roles of faces | 2c, 4a, 4b, 3d | A face is named by its feature and its role there. The roles are a closed union that five more places spell out; every new feature type names faces in new roles |
| Reference to a named entity | 1b, 1e, 1a, 5a | One type for "this face", "this edge", "this sketch point", "this body" in the arguments of a query. `PlaneRef` and `AxisRef` exist for features; queries need the same for faces and edges |
| Placement of a body | 3b, 3c, 5a | A frame and offsets with expressions, for an imported mesh, an inserted part and the links of a mechanism. `RigidTransform` (a matrix and a translation) exists since the pattern; `Placement` in `evaluate.ts` is already the name of something else (the transform and the copy tag of a pattern copy) |
| Export | 2g, 5b | `exportMesh(format, bodies)` returns one array of bytes. A format becomes an entry of a registry and returns a list of files, because a robot description is several. One MCP tool with a format; `export_stl` stays as a name for the first format |
| Data catalogs | 2c (hardware), 3a (materials), 7 (threads) | One shape for a table of data in the engine and one way it reaches the description for the AI. The rule is already decided: a catalog fills fields, the document stores numbers |
| Version of the document schema | 3a, 5a | `SCHEMA_VERSION` is 2 and `upgrade` is one function from version 1. Two branches cannot both raise the version. A new feature type needs no step; a change of what older documents hold does |
| Issue codes | most packages | `IssueCode` only grows. A package states the codes it adds in its design |

What `contract.ts` proposes (third version):

- **Units** (`QuantityUnit`): `Unit` grows by area, volume, mass and density. The threshold of the interference query is a volume already; mass properties and body properties need the rest. A numeric field of the document and an argument of a query use the same description.
- **Surfaces** (`Surface`): plane, cylinder, cone, swept, general. A sketch stands only on a plane. `FaceInfo` stays internal and keeps what only the engine needs (the `y` direction of a planar face, from which the frame of a sketch on the face is built); `Surface` is derived from it and published in the evaluation next to the names of the faces (`faceSurfaces`), so every state the engine returns has it. A general surface says what it is revolved about when it is a surface of revolution.
- **Sides.** A surface has no side; the axis of a cone is the exception, because a cone has two halves. Which side the material is on belongs to the face of a body: the normal of a planar face, and for a cylinder or a cone whether it is a pin or a hole (`BodyFace.convex`). Directions that have a sign are frames: the frame of a face points out of the body and the base planes have fixed normals. A query that takes a face as a direction resolves its frame.
- **Edges.** An edge is a circle where the two faces are two different surfaces of revolution about the same axis, a plane across the axis counting as one, away from the apex of a cone. That covers the mouth of a countersink (a plane and the cone) and its lower rim (the cone and the cylinder). Two faces of the same surface are not a circle: a circle drawn as two arcs gives two cylindrical faces whose seam is straight, `other` as today. `EdgeKind` keeps its four values; `projectEdge` assumes a plane and a cylinder today and changes with the rule.
- **Roles of faces** (`FACE_ROLES`). The union of roles stays in `types.ts`, one member per role, because it is what an AI reads. The validator of a face name, the key of a face and the labels in MCP and in the app are built from a catalog that says, for every role, how it is called and which field of the name tells its faces apart (`curve` for `side`). A package adds one member and one entry, and the compiler ties the two. The key keeps its form for the three roles of today.
- **References** (`EntityRef`): a body, a face, an edge, a sketch point. A plane and an axis are not wrapped: an argument of the kind `plane` or `axis` takes a `PlaneRef` or an `AxisRef` as features do.
- **Export** (`ExportFormats`, `EXPORT_FORMATS`, `Exported`): a format is an entry that returns files and says whether they are one file or a folder; a file has a relative path, so a robot description can have a folder of meshes, and may say what it holds (bodies and triangles for STL). `Engine.export(format, options)` is added and `exportMesh` stays as a caller of it. One MCP tool `export` checks the options against the chosen format, takes `at` and `after` like `query`, and writes with the guarantees `export_stl` has today; `export_stl` stays as it is and uses the same writer. The writer of today knows only files directly in the target folder: creating folders, and removing them again on a failure, is work of the first format with folders (5b) and is stated in the contract.
- **Data catalogs** (`DataCatalog`, `Catalogs`, `DATA_CATALOGS`): a title, a source, columns with units, rows by key. Every catalog has its own columns. Code reads the table with its row type, so a column that does not exist does not compile; an untyped caller uses the query `catalog`; the description for the AI lists catalogs by name only.
- **Schema version** (`UPGRADES`, `SCHEMA_BRANCH`): a list of upgrade steps; the version is its length plus one. Version numbers exist only on `master`: a branch appends its step and the number is fixed at the merge. Until then a build of the branch marks the documents it saves with the name of the branch, and a build with another name, `master` included, refuses them; without the mark two branches would both write "version 3" and `master` would load either as its own. The runner checks the version it gets and refuses one it does not know.
- **Placement of a body: taken out.** The first version had a frame from a plane, three offsets and a turn about its normal, which cannot turn a part upside down or tilt it. The package that needs a placement first (3b, or 5a for the links of a mechanism) designs it, with the requirements written in `contract.ts`.
- **Data coming in** (a mesh to import) does not fit into a tool call: a tool takes a path and the server reads the file. How the content reaches the engine of a connected app is for package 3b.

## 5. Documents by area

`docs/architecture.md` (1091 lines) and `docs/ui.md` are written by every package. Proposed: a file per area in `docs/architecture/` (document, sketch, naming, extrusion, pattern, ports, recompute, API, interface for AI) and a file per panel for the UI, with the present files as their tables of contents. `docs/decisions.md` is already split by the rule of D36.

## 6. Working in several trees

A short description of how a package gets its tree: a branch `d36/<id>`, a git worktree, the install, the build of the MCP bundle of that tree, the ports of the bridge and of the development server. No code; it is a section of CLAUDE.md.

## Order inside the step

1. Shared vocabulary (part 4): a design, no code. The contracts of the packages depend on it.
2. A module per feature type (part 2), reviewed on its own.
3. Registry of queries (part 1).
4. Panels and forms (part 3).
5. Documents by area (part 5) and the trees (part 6).

Parts 2, 3 and 4 touch different packages of code and could be three commits of one point or three points; to be decided when the step is designed in full.

## Reviews

### Round 1 (2026-11-14 and 15): parts 1 and 4, first version of the contract

Three independent reviewers got the same brief, read-only. `codex` (gpt-6-astra, effort high) returned eleven findings. `agy` (gemini-4-argon-high) returned twelve and was cut by a network error in the middle of the twelfth. The internal subagent failed twice on the network and returned nothing; it takes part from the second round. Every finding was checked against the code before it was acted on.

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| A query cannot reach what it needs: the diagnosis of a sketch reads the internal state of the recompute, and the surfaces of faces are not published. Recomputing from the document would diagnose a drag preview as not dragged | both, blocker | Yes (`engine.ts` asks `evaluator.sketchState`; `evaluate.ts` drops `faceInfos` and does not remember a dragged step) | The engine keeps the internal state of every state it hands out; the context gives `frame`, `axis` and `sketch`; `faceSurfaces` in the evaluation |
| `Surface` drops the `y` direction of a planar face, which `faceFrame` needs | agy, blocker | Yes for replacing `FaceInfo`, which the text suggested | `FaceInfo` stays internal with `y`; `Surface` is derived |
| The arguments cannot describe the print query (a list of orientations that are a direction or a face), a pose (a record), a catalog lookup (a text), a bare `PlaneRef`; units stop at millimetres | both, blocker | Yes | `text`, `plane`, `axis`, `list`, `oneOf`, `record`; `QuantityUnit`; `calls.ts` writes the cases |
| A posed query cannot be asked over MCP: a client cannot pass a state | agy, blocker | Yes | `after`: a command the server previews before the query |
| A view image is not a query (the app makes it, asynchronously), and bytes do not survive the path of a tool answer | both, blocker | Yes (`callTool` and the bridge pass results through JSON; the server answers with text only) | `HostOperation`, `ToolAnswer` with files and an image |
| Export: no registry at run time, the answer of `export_stl` loses `bodies` and `triangles`, a file name without a folder, nothing says whether the path is a file or a folder, options differ by format | both, blocker | Yes | `EXPORT_FORMATS`, `ExportFile.path` and `about`, `Exported.layout`, options checked per format |
| The description of the arguments is not tied to their types: a list of bodies described as a flag compiles | both, major | Yes (tried) | `ArgsOf` derives the type from the description |
| The cache in the example is stale when the second body changes | both, major | Yes | `memo` takes all owners; the example uses both solids |
| The step changes more than the rounding: `interference` validates in the engine already, a list of one body is a valid call that a test requires, the tolerance is not in the report, `get_body` has `segments`, the app does not catch | both, major | Yes; two statements of the design about today's code were wrong | No existing tool is regenerated; successful answers stay successful; the body description moves as it is; the statements are corrected |
| The rule for circular edges misses the lower rim of a countersink (a cone and a cylinder) and the apex | both, major | Yes | Circle: two surfaces of revolution about the same axis |
| A cylinder or a cone does not say whether it is a hole or a pin; the axis of a cone needs a direction | agy, major | Yes; the example `holeRadii` returned pins as well | `BodyFace.convex`; the axis of a cone points from the apex to the face |
| `FramePlacement` cannot give a part any orientation; "a normal carries no sign" confuses surfaces with frames | both, major | Yes | Placement taken out and left to 3b with requirements; the text on sides rewritten |
| Two branches that each append an upgrade step both produce "version 3" | codex, major | Yes | Version numbers only on `master`; a document of a branch is not portable; the runner checks the version |
| No example in an entry although the design promised one; fixtures were untyped; `describe_api` does not see types in query modules | both, major | Yes | `returns` in an entry; typed fixtures with the tool call; three generated sections of the description |
| The catalog has no unit for density and its lookup is untyped | agy, major (cut short) | Yes as far as it was readable | `QuantityUnit` in columns; `Catalogs` by name |
| "Never throws" needs a rule for other exceptions; work and output need bounds; asynchrony belongs to the host | codex, note | Yes | The rule on defects; `Truncated`; asynchrony only in `HostOperation` |

One statement of a review did not hold: `agy` quoted a comment of the contract about wrapped tools that is not in the file, and concluded that an entry cannot name its tool; `QuerySpec.tool` was there. Its conclusion that `explain_constraint` must stay hand-written is right and was already the design.

Not acted on: stable identifiers of schema steps instead of numbers (codex, as an alternative). A list with numbers fixed at the merge is enough while documents of branches are not exchanged.

### Round 2 (2026-11-15): second version of the contract of parts 1 and 4, first review of part 2

Three reviewers got the same brief, read-only, at commit `d1dd417`. `codex` (gpt-6-astra, effort high) returned eight findings, the internal subagent eighteen with experiments run on copies, `agy` (gemini-4-argon-high) eleven. Every finding was checked against the code, by a probe where a type was in question.

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The registries cannot be given a value: the type of an entry intersects its description with `ArgSpecs`, and the derived argument type does not terminate (TS2589). It passed only because the registries were declarations | codex, internal (blocker) | Yes (probe) | The intersection and the constraint are gone, `run` is a property; `calls.ts` calls entries of both registries and dispatches by name without a cast |
| `calls.ts` breaks the contract of every package: its table of fixtures is exhaustive over all queries, and its examples take the names `gap`, `urdf`, `viewport` that the packages will declare | internal (blocker) | Yes (all contracts are type-checked together) | The examples are named `example…`; the table covers the names of the file |
| Queries read the bodies of the evaluation, so a pose would have to edit every query | internal | Yes, by the backlog text on the mechanism | `context.bodies`, and the rule that a query reads bodies nowhere else |
| What is checked before `run` is undefined; `QueryFailure` cannot name the argument; an exception of the kernel would count as a defect; the example checks what the engine has checked | internal, agy | Yes | The rules of the checks, by kind of argument and with `at`; `QueryFailure.arg`; kernel exceptions become `failed`; the dead check is gone |
| `after` exists only on generated tools, so the existing queries cannot be asked over a preview; the export tool has neither `at` nor `after`; `at` together with `after` is undefined | codex, agy | Yes | One tool `query` for every query; `ExportToolInput` with both; the rule for both together |
| A tool per query departs from D33 (few general tools); "changes no behaviour" contradicts "a query does not throw": tests assert the throws and about 215 calls use the four methods | internal | Yes | The tool `query`; the four methods stay as throwing callers of `query` and `export` |
| Host operations have no registry, no way for the host to reach a tool and no error channel | internal | Yes (`Tool.run`, `callTool`, `connectBridge` carry the engine only) | `HOST_OPERATIONS`; the answer is a `QueryOutcome`; the host on the path of a tool call; the text of a failure over the bridge |
| The rule for circles makes the straight seam of two faces of one cylinder or cone a circle; a general surface has no axis to compare | all three | Yes (`buildPrism` names a face per arc) | Two different surfaces; `revolvedAbout` on a general surface |
| `oneOf` accepts two alternatives at once, and its keys stay read-only | codex, agy, internal | Yes (probe, both) | The other alternatives are `never`; `-readonly`; a call with both must not compile |
| The surfaces are missing from what the engine returns: `getState`, `preview`, `execute`, `load` and `subscribe` are inherited with the old state | codex | Yes | `EngineAfter` returns the state with the surfaces; `calls.ts` reads them all three ways |
| The app builds the state before the first feature by hand; with `faceSurfaces` it stops compiling, and `query` would refuse such a state | agy | Yes (`stateBefore(0)` in `app.ts`) | Stated in the contract: it empties the surfaces too and is never passed to `query` |
| `SolvedSketch` is a stand-in that the real `SketchState` does not fit, and the two sketch queries are not written as entries | agy | Yes | The context returns `SketchState`; both entries are in `calls.ts`, over `diagnose` and `explain` |
| The writer of `export_stl` knows only files directly in the target folder, while a path of a file may have folders | agy | Yes (`server.ts` writes and renames without creating folders) | The rules of a path and the missing work of the writer are in the contract, assigned to 5b |
| A document saved by a branch loads on `master` as its own version | internal | Yes | `SCHEMA_BRANCH`: such a document is marked and refused |
| `memo`: the state and the evaluation never hit as owners, keys of queries share a namespace, no owner at all is undefined | internal | Yes (`evaluate` builds a new evaluation every time) | The owners that work and the ones that do not; at least one owner in the type; keys kept apart by the engine |
| Gaps in the arguments: no named fields inside a list, no greatest count, `at` and `after` collide with arguments, defaults filled by nobody | internal | Yes | `fields`, `max`; the arguments are nested under `args` of the tool; `RunArgsOf` fills the defaults |
| A typo in a column of a catalog compiles; a plain row interface is refused | internal | Yes (probe) | `DataCatalog` typed by its row; a typo must not compile |
| Six significant digits leave noise where zero is meant and cut coordinates | internal | Yes (`tools.ts` rounds to six decimals) | Six decimal places |
| Two statements about today: the tools do not turn exceptions of the engine into texts; one answer of `check_interference` does change | internal | Yes (run) | Both corrected in part 1 |
| Smaller: the summary of part 2 contradicted its full design; `app.ts` has 2321 lines and the app four test files; nothing said which file gets which type; placement is needed by 5a before 3b; `convex` is not free | internal | Yes | Corrected; "Where the types live" |
| Part 2: the modules as drawn import each other in a circle (`requireRef` reads the registry, `sketch.ts` imports `document.ts`, `toolSpan` has no home) | all three | Yes (skeleton run by the internal reviewer) | A leaf for sketch content, a validation context, `recompute/extent.ts`, a test that imports every module first |
| Part 2: a new type still edits shared special cases: `requireRef` and the app name the extrusion for pattern sources and generated profiles; `featureSummary` of MCP takes an unknown type for a sketch; the roles of faces are a closed union in six places | all three | Yes | Two properties of the registry; a default summary; `FACE_ROLES` in the vocabulary; the list of costs rewritten |
| Part 2: a profile is a service only in the recompute; its validation would move into the extrusion | internal, agy | Yes | `features/profile.ts`; `profile(id, source, state, chordTolerance)` |
| Part 2: dispatch through the registry does not type-check; tests import `document.ts` directly; the cache is keyed by the `Resolution`; the prelude has a branch by type | codex, internal, agy | Yes | One cast in `specOf`; `document.ts` re-exports what moved; the statements corrected; a registry property for the sketch |

Statements of reviews that did not hold: under "checked and found sound" `agy` listed things that are not in the reviewed file (`DataCatalog<Row, Key>`, a `FramePlacement` with any orientation, an `ExportOutcome`), so that list was not relied on. The internal reviewer counted eight of nine engine test files importing `document.ts`; it is seven of ten.

Not acted on:

- `faceId` and the whole `BodyData` on the context (agy, note): the number of a face is there (`context.face`); the data of a body beyond `BodyResult` is added by the package that needs it.
- The normal of a planar face from the surface instead of from the triangles (agy, note): it would change the last digits of `get_body`; the description of a body moves as it is.
- A state before the first feature from the engine itself (agy): the app asks nothing in that mode, so its hand-built state stays.

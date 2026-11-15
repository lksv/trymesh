# 00 Preparatory step

**State: scope approved; parts 1 and 4 have a contract in its sixth version, part 2 a design in its fifth and part 3 a design in its third, after five rounds of reviews.** The owner approved all six parts on 2026-11-14: first the registry of queries and the split of `app.ts`, then the four parts Claude added from reading the code (a module per feature type, the shared vocabulary, documents by area, working in several trees).

| Part | State |
|---|---|
| 1 Registry of queries | signatures in [contract.ts](contract.ts), written out as calls in [calls.ts](calls.ts); reviewed five times, see "Reviews" |
| 4 Shared vocabulary | same |
| 2 A module per feature type | designed in [part2-feature-modules.md](part2-feature-modules.md); reviewed four times |
| 3 Panels and forms of the app | designed in [part3-app-panels.md](part3-app-panels.md); reviewed twice |
| 5, 6 Documents by area, several trees | proposal below; no code |

The contract is checked by `npx tsc -p docs/d36/tsconfig.json`. Parts 2 and 3 change no public type (part 2 adds two functions to the index of the engine), so they get a design and no contract.

The step is the counterpart of step 0 of D35. It adds ways in and moves code; what the existing methods, commands and tools answer stays. Every test of behaviour passes unchanged; three guard tests get new rows (part 1, "No existing tool changes"). Its purpose is that the packages of [the plan](../README.md) add files and single lines instead of rewriting the same places.

It is done by one session, not in parallel, after D35 is closed, and it follows the procedure of CLAUDE.md like any point.

## 1. Registry of queries

**Today.** A query is a method of `Engine` (`diagnoseSketch`, `explainConstraint`, `interference`), and its MCP tool is written by hand in `packages/mcp/src/tools.ts`. Three things follow:

- A new query touches the `Engine` interface, `engine.ts`, `tools.ts` and the guard table. Step 1 of D36 is six queries, so six packages would edit the same four places.
- The three methods throw for a wrong argument (`interference.ts` checks the threshold, the shape of the list and that the bodies exist; `engine.ts` throws for an unknown sketch or constraint). The MCP tools check the arguments themselves first and answer with their own error (`check_interference` also wants at least two different bodies when a list is given); an exception of the engine that gets past those checks is passed on as a failure of the tool. The app calls `interference` and `diagnoseSketch` without catching.
- Part of what the AI is told is computed in the MCP package and the app cannot use it: `bodyDetail` and `edgeShape` (area and normal of a face, length, ends, centre and radius of an edge), `sketchDetail` (areas of regions, advice on what to constrain). That is the mirror image of the rule that the app must not compute.

**Design** (`contract.ts`, sixth version).

- **A catalog `QUERIES` in the engine**, built like the registry of feature types. An entry has a title, a summary and a description of what it returns (all three go to the description for the AI), a description of its arguments, and a function over a context. `Engine.query(name, args, options)` is the way in for everything new.
- **The four methods of today stay.** `diagnoseSketch`, `explainConstraint`, `interference` and `exportMesh` keep their signatures, their own checks of their arguments and their own texts (tests match them, Czech ones included), and keep throwing, as D35 decided and as about two hundred calls in the tests expect. Then they call `run` of the same entry that `query` calls: the computation is shared, the messages are not. No further method of this kind is added to `Engine`.
- **A query answers for one state and never recomputes it.** A query reads more than the public state: the diagnosis of a sketch needs the input of the solver, how the solve ended and the analysis of freedom, which live in the internal state of the recompute. The engine therefore keeps, for every state it hands out, the internal state it came from, by the identity of the evaluation, and the context gives a query what it needs from there: `surface`, `frame`, `axis`, `face` (the number of a named face) and `sketch` (the `SketchState` of the recompute). The internal state is kept weakly, so it lives as long as the caller holds the state it belongs to. A drag preview is diagnosed as dragged. `calls.ts` writes the three queries of today as entries over this context.
- **A query reads the geometry of bodies from the context**, never from the evaluation. With the mechanism of step 5 a query is asked about bodies moved to a pose, while the evaluation keeps them where they were modelled.
  - What belongs to a body is in the pose asked about: `bodies`, the surface of a face (`surface(body, face)`), the frame of a face, a face or an edge given as an entity. The state of the context has neither the bodies nor the surfaces, so a query cannot read them as modelled by mistake, and it answers for a pose without a change.
  - What does not belong to a body is never posed: a sketch and its points, an axis through a sketch point, a plane feature, a base plane or axis. They are where the model has them, also for a sketch on a face of a body that moved. A mechanism that needs a point or an axis that moves with a link takes it from a body, or package 5a adds a reference of its own.
  - A surface is asked by body and face, not by the number of the face: one number can lie in two bodies (a cut through two targets leaves the faces of the one tool in both), and the two may be posed differently.
  - `frame` and `axis` answer with the frame or with the code the recompute gives for the same reference, so a query can tell "not in this state" from "not a plane".
  - An export is the opposite: the context of a format always has the bodies as modelled.
  - A query that builds on another calls its `run` with the same context.
  - The result of a query is plain JSON; it goes through the tool, the bridge and the form of the app as it is. A query that has bytes is an export.
- **The state is chosen three ways:** the current one, the one after a feature (`at`), or one that `preview` returned (`state`); the last two exclude each other in the type. A state this engine did not hand out is refused, and the engine takes the document it kept with the evaluation, so an evaluation cannot be paired with another document. The app builds one state by hand (the model before the first feature) and asks nothing about it.
- **Arguments are named and described** (`ArgSpec`): a number with unit and range, a flag, a text, a choice, an ID of a body, a feature or a sketch, a constraint of a sketch, a reference to a named entity with the kinds it accepts, a plane (`PlaneRef`), an axis (`AxisRef`), a vector, and four ways to build structure: a list with a least and a greatest count, exactly one of several named alternatives, a record whose keys are IDs of bodies or features or free names, and named fields of different kinds. `calls.ts` writes with them a section, a print query with several orientations that are each a direction or a face and may add a turn, values by body and mass properties. A number is checked against its own description only: the limit of ±1e9 on numbers of the document is not applied, so `interference` takes every threshold it takes today.
- **The type of the arguments is derived from their description** (`ArgsOf`), so the two cannot disagree. A reference to an entity gets the type of exactly the kinds it accepts; two alternatives of a `oneOf` at once do not compile. `run` gets the same type with the defaults of optional numbers filled in at every depth (`RunArgsOf`).
- **The types of queries are a map by name that modules extend by declaration merging** (`Queries`). A package adds its description, its result and its entry in its own file; no shared type is edited. The registry is typed by the map, a registry object can be written (the second version could not: its types did not terminate), and the engine dispatches by name without a cast. A description in a map that is not a valid one stops the type check and is named. What the types still let through (an entry whose description, handed over in a variable, has one argument more or marks a required one optional) is caught by the guard test.
- **A query does not throw for what its caller can cause.** `QueryOutcome` is a result or an error with a code and the path of the argument concerned, a list of names and indexes (`['orientations', 1, 'by', 'onBed']`).
  - Before `run` the engine checks every argument against its description and fills in the defaults. `invalidArguments`: the shape or the range is wrong, or the query has no such argument. `notAvailable`: something named is not in the state asked about. That is one rule for every ID wherever it sits (an argument, an entity, a plane, an axis): a body, a face, an edge is looked up in the bodies of the state; a feature, a sketch, a constraint, a sketch point among the features the state evaluated. A mistyped ID and one that comes after `at` are the same answer.
  - A sketch that did not evaluate is in the document, so it is a valid argument.
  - `run` throws `QueryFailure`, with the argument when there is one, for what only the computation finds out. An exception of the kernel inside a query becomes `failed`, because the port says that a boolean throws.
  - An exception of another kind is a defect and passes through, as it does for commands.
- **What is a successful answer today stays one.** A sketch that did not evaluate has the diagnosis `unavailable`; a list of one body has no collisions and `checked: 0` (a test of the scenarios requires it).
- **A cache comes with the context** (`memo(owners, key, compute)`): a result lives as long as all the objects it was computed from. Both solids own an answer about a pair of bodies, as in the cache of `interference` today. The contract names the owners that live across recomputes (a solid, a solved sketch, the document or a section of it) and the ones that never hit (the state, the evaluation, the map of bodies); at least one owner is required, their order does not matter, and the keys of different queries are kept apart by the engine.
- **A large answer says that it was cut** (`Truncated`): a query with such an answer has an argument that limits it. The engine is synchronous and cannot cancel, so a query that can be slow bounds its work by its arguments.
- **The description of a body moves into the engine as it is** (`BodyDescription`): what `bodyDetail` and `edgeShape` compute, including the number of segments of an edge, the normal of a planar face summed from its triangles, and a centre and radius fitted to vertices, which may be missing. The step adds the surface of a face and whether a cylinder or a cone is a hole or a pin (one more pass over the triangles of the face). Reading circles from the surfaces instead of fitting them changes numbers and belongs to package 1b.

**One MCP tool `query`** reaches every entry of the catalog, the way `execute` reaches every command and `sketch_tool` every sketch tool. D33 chose few general tools over a tool per operation; the second version of this design generated a tool per query and departed from that without saying so.

- Its input is the name of the query, its arguments, `at` and `after`. `after` is a command: the preview and the query run together where the engine is (in the app when one is connected) and nothing is written. That is how an AI steps a parameter or a pose and asks at each step, for every query, the existing ones included. With both, the previewed document is evaluated up to `at`.
- The answer is the result with numbers rounded to six decimal places, as the tools round geometry today. An entry names the keys of its result that are small on purpose and how many significant digits they get instead (`significant`): the volume and the depth of a collision, as `check_interference` prints them.
- The description of the tool lists the queries from the catalog.

**No existing tool changes its name, its schema or its answers.**

- `check_interference`, `get_sketch`, `explain_constraint` and `export_stl` keep calling the four methods of `Engine`, with their own checks and texts. The guard over the methods of `Engine` records which method a tool calls, and its rows stay true.
- `get_body` had no method of the engine to call. It keeps its own check that the body exists and its text, reads the state as today, and takes the faces and edges from `query('body')`. `get_model`, `get_document` and `get_parameters` are views of the state and stay as they are.
- What changes in the tests is the guards: the exact list of tools in `packages/mcp/test/tools.test.ts` gets `query`, the one in `server.test.ts` gets `query` and `export` (`export` writes files, so it is a tool of the server like `export_stl`), and the table of coverage gets rows for the two new methods of `Engine`.

(The third version routed the four tools through `query` and listed one answer that would change. The guard of coverage would have failed, and the answer need not change.)

**What a tool may answer** (`ToolAnswer`). Today a tool returns JSON and the server prints it as text; `callTool` and the bridge to the app pass the result through JSON, so bytes do not survive, and STL has a base64 envelope of its own in a hidden tool. That envelope becomes general: an answer is data, files (with the layout `file` or `directory`), or an image, which the server returns to the client as image content. `ToolOutcome.result` stays JSON; a `ToolAnswer` is JSON. A tool says in its definition that it answers with one, and only then does the server act on its kind.

**Operations of the app** (`HostOperation`, `HOST_OPERATIONS`). A picture of the viewport is not a query: the engine has no renderer and the operation is asynchronous. It is an operation of the host, described like a query and offered as a tool of its own; over a document from a file it answers `notAvailable`. One operation is planned (1f); if they multiply they get one general tool like `query`.

- The operations are a registry in the module the server and the app share, extended by declaration merging like the queries; the description for the AI and a guard read it.
- An operation answers with a `QueryOutcome`, so it has the same error channel as a query.
- `Tool.run`, `callTool` and `connectBridge` carry only the engine and are synchronous; the tests call them so, and they stay. An operation of the host goes through an entry of its own next to them, which takes the host and is awaited.
- An exception inside an operation or a query is reported over the bridge as a failed question, not with today's text for commands ("the change may have been made").

**The description for the AI.** `describe_api` cuts its types out of the raw text of `types.ts`, so types in query modules do not reach it. It gets four generated sections, like the one for constraints: the queries (name, summary, each argument from its description, what it returns), the operations of the app, the catalogs (name and summary) and the export formats.

**Where the types live.** What a caller of the engine or an AI reads goes to `types.ts` (`Surface`, `EntityRef`, `QueryOutcome`, the additions to `Evaluation` and `Engine`). The machinery (`ArgKind`, `ValueOf`, `ArgsOf`, `QuerySpec`, the registries) goes to modules of its own, so that it does not reach the description for the AI.

**Guards.** A table of fixtures by query name, with arguments of the query's own type: a query without a fixture does not compile, and the test runs each one through the tool `query`. The table over the methods of `Engine` stays and grows by two rows. A test checks what types let through: that `of` of a constraint names a required argument of the kind `sketch` next to it, and that the names of the arguments of an entry and which of them are optional are those of its fixture. The examples of `calls.ts` use names that start with `example`, and its table of fixtures covers only its own names, because the contracts of all packages are type-checked together with it.

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

**Today.** `packages/app/src/app.ts` is one class of 2321 lines. The panels (model, collisions, parameters, sketch, extrusion, plane, pattern) and the forms are its methods, and a feature type is spelled out in fifteen places of the class, so every package with a form edits the same file.

Designed in full in [part3-app-panels.md](part3-app-panels.md); this is the summary.

**Proposal.** A registry of the app by feature type, guarded by the compiler like the one of the engine: a type added to the engine and forgotten in the app does not compile. An entry is one file with the form of the type, its defaults, what a click in the view means while the form is open, what it draws and its lines in the model panel.

- One draft mode instead of one per type; what a form remembers beyond its draft is its own.
- Panels are functions over an interface of the app (`PanelHost`), in files of their own; no framework and no library.
- A query is reachable from the app without work there: a form is built from the description of its arguments, and a query may add a view of its own, as the collisions have. An answer belongs to the document and the place on the timeline it was asked at, as the collisions do today. The generic form is not part of this step: package 1b designs and builds it, and the app side of the other queries of step 1 builds on it.
- State that belongs to one panel (the collisions, the options of the polygon tool) moves with it.
- The class has no test. The split is checked by a fixed script of clicks in a fresh instance of the running app, run before and after each commit; the calls the app makes on the engine and the document after every step are compared.

**Open.** A DOM in the test suite (`happy-dom` or `jsdom`) would let that script run as a test. It is a new development dependency and needs the owner's approval (D2); the design does without it.

## 4. Shared vocabulary

Things that several packages need and that must be the same in all of them. They are settled here, before the contracts, not by whichever package is merged first. The types are in `contract.ts`; the table says what had to be decided and the list below it what the contract proposes.

| Item | Who needs it | What has to be decided |
|---|---|---|
| What a package adds to the unions | every contract with a feature type, a patch, a command, a section of the document, a face role or an issue code | `Feature`, `FeaturePatch`, `Command`, `Document`, `FaceName` and `IssueCode` are closed, and a draft cannot edit `types.ts`. Without a shared way to write an addition every session invents its own types and the joint type check no longer compares them |
| Kinds of faces and edges | 2b, 4a, 4b, 3d | `FaceInfo` has a plane, a cylinder and a swept surface. A cone is needed by the taper, the countersink and the revolve; a general surface by the revolve of an arc, the twist and the fillet. For each kind: can a sketch stand on it, which of its edges are circles or lines and can be projected |
| Roles of faces | 2c, 4a, 4b, 3d | A face is named by its feature and its role there. The roles are a closed union that five more places spell out; every new feature type names faces in new roles |
| Reference to a named entity | 1b, 1e, 1a, 5a | One type for "this face", "this edge", "this sketch point", "this body" in the arguments of a query. `PlaneRef` and `AxisRef` exist for features; queries need the same for faces and edges |
| Placement of a body | 3b, 3c, 5a | A frame and offsets with expressions, for an imported mesh, an inserted part and the links of a mechanism. `RigidTransform` (a matrix and a translation) exists since the pattern; `Placement` in `evaluate.ts` is already the name of something else (the transform and the copy tag of a pattern copy) |
| Export | 2g, 5b | `exportMesh(format, bodies)` returns one array of bytes. A format becomes an entry of a registry and returns a list of files, because a robot description is several. One MCP tool with a format; `export_stl` stays as a name for the first format |
| Data catalogs | 2c (hardware), 3a (materials), 7 (threads) | One shape for a table of data in the engine and one way it reaches the description for the AI. The rule is already decided: a catalog fills fields, the document stores numbers |
| Version of the document schema | 3a, 5a, and track B where it adds a field that would be dropped (the taper of an extent) | `SCHEMA_VERSION` is 2 and `upgrade` is one function from version 1. Two branches cannot both raise the version. A new feature type needs no step; a change of what older documents hold does |
| Issue codes | most packages | `IssueCode` only grows. A package states the codes it adds in its design |

What `contract.ts` proposes (sixth version):

- **Additions to the unions** (`FeatureTypes`, `FeaturePatches`, `Commands`, `DocumentSections`, `FaceRoles`, `IssueCodes`): six maps that a contract extends by declaration merging, standing for the one line a package adds to a union of `types.ts`. Everything a scenario touches is built from them: the document, the commands of `execute`, `preview` and `after` (a batch of them included), the patch of `updateFeature`, the results of features with their warnings, the names of faces in the evaluation, in the bodies and in a reference to a plane. So the scenario of a package can add its feature, change it, set its section, ask a query over the preview and assert its own warning, and two packages that add the same name differently do not compile. A package that changes an existing type (the extrusion) merges the changed interface under the name of the type, where it stands in place of the interface of today; the packages of one track share that declaration. This is a device of the drafts; the code adds the member to the union.
- **Units** (`QuantityUnit`): `Unit` grows by area, volume, mass and density. The threshold of the interference query is a volume already; mass properties and body properties need the rest. A numeric field of the document and an argument of a query use the same description.
- **Surfaces** (`Surface`): plane, cylinder, cone, swept, general. A sketch stands only on a plane. `FaceInfo` stays internal and keeps what only the engine needs (the `y` direction of a planar face, from which the frame of a sketch on the face is built); `Surface` is derived from it and published in the evaluation next to the names of the faces (`faceSurfaces`), so every state the engine returns has it. A general surface says nothing more; a package that needs the rim of a revolved arc as a circle adds a kind that identifies the surface (a sphere, a torus).
- **Sides.** A surface has no side; the axis of a cone is the exception, because a cone has two halves. Which side the material is on belongs to the face of a body: the normal of a planar face, and for a cylinder or a cone whether it is a pin or a hole (`BodyFace.convex`). Directions that have a sign are frames: the frame of a face points out of the body and the base planes have fixed normals. A query that takes a face as a direction resolves its frame.
- **Edges.** The kind of an edge is decided from the surfaces of its two faces alone, and so are the centre and the radius of a circle, as today. A circle is one of four pairs about one axis: a plane across the axis and a cylinder (today's rule), a plane and a cone (the mouth of a countersink), a cylinder and a cone (its lower rim), two cones that differ. Two faces of one surface stay `other`, as today: a circle drawn as two arcs gives two cylindrical faces whose seam is straight. An edge with a general surface is `other`. `EdgeKind` keeps its four values; `projectEdge` assumes a plane and a cylinder today and changes with the rule.
- **Roles of faces** (`FACE_ROLES`). The union of roles stays in `types.ts`, one member per role, because it is what an AI reads. The validator of a face name, the key of a face and the label in MCP are built from a catalog that says, for every role, how it is called and names every field that tells its faces apart (`curve` for `side`; a point and a step for the wall of a counterbored hole), with whether the field is a text or a whole number, so that the validator can check it. Such a field is always there. A package adds one member and one entry, and the compiler ties the two. The key keeps its form for the three roles of today. The app keeps its own table of texts, typed by the union.
- **References** (`EntityRef`): a body, a face, an edge, a sketch point. A plane and an axis are not wrapped: an argument of the kind `plane` or `axis` takes a `PlaneRef` or an `AxisRef` as features do.
- **Export** (`ExportFormats`, `EXPORT_FORMATS`, `Exported`): a format is an entry that returns files and says whether they are one file or a folder; a file has a relative path, so a robot description can have a folder of meshes, and may say what it holds (bodies and triangles for STL). `Engine.export(format, options)` is added; `exportMesh` stays, with its own checks, and shares `run` of the format with it. One MCP tool `export` checks the options against the chosen format, takes `at` and `after` like `query`, and writes with the guarantees `export_stl` has today; `export_stl` stays as it is and uses the same writer. The engine guarantees the form of a path; what depends on the disk (the length of a name, names that differ only in case) is the writer's to refuse, as today. No body to export is not an error of a format (`exportMesh` of an empty list gives a file without triangles today); the tools refuse it. The writer of today knows only files directly in the target folder: creating folders, and removing them again on a failure, is work of the first format with folders (5b) and is stated in the contract.
- **Data catalogs** (`DataCatalog`, `Catalogs`, `DATA_CATALOGS`): a title, a source, columns with units, rows by key. Every catalog has its own columns. Code reads the table with its row type, so a column that does not exist does not compile, and a column of numbers has a unit; an untyped caller uses the query `catalog`, which answers with the table without its row type; the description for the AI lists catalogs by name only.
- **Schema version** (`UPGRADES`, `SCHEMA_PENDING`): a list of named upgrade steps; on `master` the version is its length plus one.
  - A step is needed for a change of what older documents hold, and for anything a build without the package would drop without a word: loading rebuilds a document from the fields it knows, so an unknown section, an unknown field directly on a feature and an unknown field of an extent are not refused, they are gone. Such an addition gets a step even when there is nothing to convert. No step is needed where a build without the package refuses by itself: a new feature type, a new variant, and a field where the validator lists what it allows (a profile source, the parts of a pattern).
  - A step reads and changes only what its package owns, or what is on `master` already, so steps of different packages give the same document in either order; a test runs the pending steps before and after the steps merged meanwhile and compares.
  - A branch appends its steps and counts them as pending; a build with pending steps saves the version of the `master` it started from and the names of the pending steps the document has. Loading takes the steps from the version of the document on, leaves out the ones it names and runs the rest; a name the build does not have, or a version above the one the build saves, is refused.
  - So a document saved on a branch loads on that branch after a rebase and on `master` after the merge, and is refused by another branch. (The third version marked such a document with the name of its branch, which kept it from being misread and left it unreadable after the merge.)
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

Each part is a point of work of its own, with the procedure of CLAUDE.md. Parts 2 and 3 fix their own order of commits in their designs (six and eight), and part 2 also touches `packages/mcp` and `packages/app` in its last one.

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

### Round 3 (2026-11-15): third version of the contract of parts 1 and 4, second version of part 2

Three reviewers got the same brief, read-only, at commit `d8882f8`. `codex` returned eight findings, the internal subagent fourteen with probes and a check of the module graph of part 2 over the real references, `agy` nine. Every finding was checked against the code.

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The circle rule is not decidable for a general surface: an axis does not identify a surface, and gives neither the centre nor the radius | all three (codex and agy: blocker) | Yes | A general surface says nothing and its edges are `other`; the rule is four named pairs whose circle follows from the two surfaces |
| A package contract cannot add a feature type, a command, a section of the document or a face role, and the pose sweep of scenario 13 does not type-check | internal | Yes (probe) | Four maps for additions to the unions, used by the state, the commands and the face names; `calls.ts`, section j |
| Reading bodies from the context does not make a query independent of the pose: surfaces and frames stay modelled, one face number can lie in two bodies, and exports would come out posed | codex, internal | Yes (a cut through two targets, run by the internal reviewer) | `context.surface(body, face)`; the rule that everything the context says about a body is in the pose; exports always get the modelled bodies |
| `RunArgsOf` fills defaults only at the top level, and not for `interference`, whose description was written as a type | all three (agy: blocker) | Yes (probe) | `RunValueOf` at every depth; the descriptions of the built-in queries are values; assertions in `calls.ts` |
| The per-field rounding the text promised has no place in an entry; six decimals turn the volume of a small collision into zero | internal, agy (blocker) | Yes (`check_interference` uses significant digits) | `QuerySpec.significant` |
| `FACE_ROLES` takes one distinguishing field: two walls of a counterbore get one key, and a field that is an object keys as `[object Object]` | all three | Yes (probe) | `parts` names every field; a field is a text or a number; the key is built from the real name and keeps the copy tags |
| A document saved on a branch is refused by `master` for good after the merge, and is misread on its own branch after a rebase | all three | Yes | Named steps, a count of pending steps, the names of the applied ones in the document |
| "Every existing test passes unchanged" contradicts the design: tools routed through `query` fail the guard of coverage, exact tool lists change, `callTool` is called synchronously, the old methods have texts that tests match | codex, internal | Yes | The four tools keep calling the four methods; the methods keep their checks and texts and share `run`; `callTool` stays synchronous; the three guards that change are listed; no answer changes |
| The limit of ±1e9 on numbers would refuse a threshold that `interference` takes today | codex, internal | Yes (run by both) | Not applied to arguments |
| The check rules have holes: the name of a nested argument, the scope of `of`, an ID inside a reference, a previewed state evaluated up to a feature, why a frame does not resolve | internal, agy | Yes | The argument is a path; `of` names a sibling; one rule for every ID, in terms of what the state evaluated; `frame` and `axis` return the code of the recompute |
| An entry can disagree with its map through a variable; an invalid kind in a merged description compiles; the result of `catalog` needs a cast; a column of numbers may have the unit `text` | internal, agy | Yes (probes) | The guard test compares names and optional flags; `SPECS_ARE_VALID`; `CatalogTable`; the unit follows the column type |
| The rules of a file path contradict `export_stl`: the limit of 255 bytes is reported there with other words, an empty list is a success of `exportMesh` | agy | Yes | The engine guarantees the form, the writer what depends on the disk; an empty export is not an error of a format |
| Part 2: 26 helpers have no home in the file list; `evaluate.ts` has to re-export too; the reference helpers move a commit too early; a command validates a reference without `Fields` | internal (graph check), agy, codex | Yes | Every helper named; the re-exports; the order; `fields` optional in the context |
| Part 2: the picker of generator references in the app names the extrusion; three texts do; the list of costs misses surfaces, tools that are not prisms and reference kinds, and most places of `app.ts` | codex, internal | Yes | `generatorOf`; the texts listed; the cost list; the thirteen places are in part 3 |
| Files out of step: the plan says 1b takes over the description of a body and 2g the registry of formats; `calls.ts` asks a pose as an argument; a comment says edges carry face numbers | internal | Yes | Corrected |
| Smaller: a tool per host operation departs from D33; `memo` owners in another order; which document a previewed query uses; how the server knows a `ToolAnswer` | internal | Yes | Each stated in the contract |

Statements of reviews that did not hold: `agy` again quoted a record of round 2 that is not in this file (about `readonly` arrays), and proposed a constraint on the entries of the registries; with it the engine cannot call `run` of an entry picked by name without a cast, which round 2 removed. Its point that an invalid description compiles holds and is caught another way.

Not acted on:

- The kind of an edge decided from its vertices instead of its surfaces (internal, agy): it would make stacked cylinders of one radius a circle, which is a change of today's answers; left to the package that needs it.
- Memory held by many previews (codex, as a note): the internal state is kept only as long as the caller holds the state, as the evaluation is today.

### Round 4 (2026-11-15): fourth version of the contract of parts 1 and 4, third version of part 2, first review of part 3

Three reviewers got the same brief, read-only, at commit `1d4ee69`. `codex` returned eight findings, the internal subagent sixteen with a second package contract type-checked against the shared one, `agy` six that were readable before its output was cut. No reviewer found a blocker; all found the fixes of round 3 holding, with the remainders below. Every finding was checked against the code.

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The maps for additions stop short of what a scenario touches: a batch cannot carry a command of a package, `updateFeature` cannot patch a new type, a face in a new role cannot be a plane of a query or of a sketch or be read from the state, a scenario cannot assert its own warning | all three (agy: blocker) | Yes (probes) | `CommandAfter` closes over itself; `FeaturePatches`, `IssueCodes`, `PlaneRefAfter`, `ExternalRefAfter`; the evaluation, the bodies and the results of features carry the widened names and codes; how a changed existing type is declared |
| The catalog of face roles has only labels: the validator of a face name cannot tell that a field is a number; an optional field gives two faces one key; an object field compiles because nobody writes the entry of a declaration | codex, internal | Yes (probe) | Every part has a kind tied to the type of the field; fields are required; `ROLES_ARE_VALID` names an invalid role |
| The pose of a sketch point and of an axis through one is undefined; "an entity" has no resolver; the modelled geometry stays reachable through the state of the context | codex, internal | Yes | What belongs to a body is posed, what does not is never posed, said by kind; the state of the context has neither bodies nor surfaces |
| Upgrade steps that only write their own section still depend on order when one reads another's; a section added without a step is dropped without a word by a build that does not know it; "a version above its own" has two readings | all three | Yes (`validateDocument` rebuilds from known fields; simulated by the internal reviewer) | A step reads only what its package owns or `master` has; a step for anything that would be dropped; "the version this build saves"; a test of the order |
| The guard of coverage: `get_body` is recorded under `getState`; a test matches its text for a missing body; `export` is a tool of the server | internal | Yes | `get_body` keeps its check and its read of the state; the lists of the two tests are told apart |
| A record does not say what its keys are, and a body ID with a slash makes a path ambiguous | internal | Yes | `record.keys`; the path is a list of segments |
| Part 3: an answer kept with the evaluation is gone at once: `getState` with a feature gives a new evaluation on every call | codex, internal | Yes (run) | The key is the document and the place on the timeline, as today; hidden against dropped |
| Part 3: `PanelHost` as listed is not enough (the ray onto a plane, the selection in the view, the diagnosis, the export, the engine itself), the state of the collisions has no owner, and a panel cannot be tested with a hand-written host without a DOM | codex, internal | Yes | The real members listed; the engine on the host; state that belongs to a panel moves with it; the interface is type-checked before anything moves; the test claim is under "Open" |
| Part 3: the command of a draft cannot be generic (the update half is per type and tested), and the design said both | internal | Yes | `form.command` per entry; `draftCommand` stays |
| Part 3: the sketch has no draft and starts by a pick of a plane; the table missed that flow | codex, internal | Yes | `button` and `create` on the entry outside `form`; the row; fifteen places |
| Part 3: the eye on the timeline is not "has a body" (a sketch and a plane can be hidden); the extrusion must not get a pick of a face; three fields of a draft live outside the mode; the registry needs a cast | codex, internal | Yes | `hideable`; `picks`; the state of the preview moves to `features/draft.ts`; `uiOf` |
| Part 3: the click script does not show what it promises: IDs are deterministic only in a fresh instance, a preview computed twice leaves the document the same, and it misses the drag, the keys, the bridge and the marker | codex, internal | Yes | A fresh instance and a fixed window; the calls on the engine are compared; the cases added |
| Part 2: commit 2 moved two helpers whose modules do not exist yet; "`index.ts` does not change" against two new exports; an optional reader of fields weakens every validator; nine names without a home | internal | Yes (graph check) | The order; the sentence; `RefContext`; the homes |
| Files out of step: "third version" in part 1, "callers of `query`", "six significant digits", the count of reviews in the plan | internal | Yes | Corrected |

Statements of reviews that did not hold: `agy` reviewed a part 3 that is partly not the one in the file. It quoted a registry `FEATURES`, a method `toCommand` and changed prefixes of IDs (`pl`, `pat`), and missed `warning`, `live` and `summary`, which are there. Its two findings on the contract hold and agree with the others; from the rest came one rule (prefixes and default names stay) and one signature (`create.run` says when a plane was refused).

Not acted on:

- The generic form of a query in full (codex, internal): it is designed with package 1b; this round only fixed what part 3 says about it (a control for every kind, a sketch point from lists).
- `applyCommand` and `validateDocument` stay places that 2d, 3a and 5a all edit (internal, note): added to the table of shared places of the plan, not split.

### Round 5 (2026-11-15), narrow: the fixes of round 4 and a second reading of part 3

Two reviewers, read-only, at commit `1eff310`: `codex` (six findings) and the internal subagent (six and five factual errors), who again merged a second package contract into every map and this time compiled `validateDocument` to see what a load drops. `agy` did not take part: its account ran out of quota. They were asked for blockers, majors and factual errors only. Neither found a blocker; both found the fixes of round 4 holding, with two remainders (the interface of the app and the click script).

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| A changed existing feature type can be added and patched but its new fields cannot be read back: the interface of today stays in the union beside it | both | Yes (probes of both) | The redeclared type stands in place of the old one, and so does a redeclared face role |
| The rule for upgrade steps reaches track B (the taper of an extent would be dropped) and nobody told it; the sentence it rests on is half true: profile sources and the parts of a pattern refuse unknown fields | internal | Yes (run by the reviewer) | The sentence says what is dropped and what is refused; the table, the plan and the brief of track B name the track |
| Part 3: `PanelHost` still lacks members (`invalidate`, the current mode, `enterSketch`, the note of an answer), hands out what the app guards (undo and load through the engine, a writable marker and preview), and "`App` implements it" proves nothing | both | Yes (probe of the reviewer) | The members; the engine as the part a panel may call; a method for an inserted feature; `say` returns its note; every moving method is annotated with `this: PanelHost` in the first commit |
| Part 3: the click script does not compare the toolbar, the timeline or the state of controls, two runs can differ by the measured time of a preview, and it walks neither the remembered values of the forms nor the paths of cancelling | both | Yes | What a user sees and can do in the four areas is compared; the time is pinned; the paths are listed |
| Part 3: the commit of the draft code needs the registry of the commit after it, the mode does not narrow in between, and no commit creates `panels/query.ts` | both | Yes | The registry comes with the draft code, complete, with entries that call the class; the mode is a union until the forms move; `query.ts` is package 1b's |
| Who builds the generic form of a query is said in two files and missing from the plan and the brief of track A | internal | Yes | Package 1b, named in both, with the dependency of the other queries on it for their app side |
| Factual: a new issue code needs no text in the app; the collisions are not the only query the app asks; an invalid role is "named" only when it is one; `SolvedSketch` has no home; the panel that waits for a plane has a header per type; a sentence on the order of the step was out of date | both | Yes | Corrected; the two guards list the names |

Not acted on:

- The result of a section in the evaluation has no map of its own (internal, as a note): a contract merges it into `EvaluationAfter`, which is an interface; said in the contract.


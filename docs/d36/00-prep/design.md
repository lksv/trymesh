# 00 Preparatory step

**State: scope approved; parts 1 and 4 have a contract in its second version, after one round of reviews; the second round is pending.** The owner approved all six parts on 2026-11-14: first the registry of queries and the split of `app.ts`, then the four parts Claude added from reading the code (a module per feature type, the shared vocabulary, documents by area, working in several trees).

| Part | State |
|---|---|
| 1 Registry of queries | signatures in [contract.ts](contract.ts), written out as calls in [calls.ts](calls.ts); reviewed once and rewritten, see "Reviews" |
| 4 Shared vocabulary | same |
| 2 A module per feature type | designed in [part2-feature-modules.md](part2-feature-modules.md); not reviewed |
| 3 Panels and forms of the app | proposal below; the context of a panel is not designed |
| 5, 6 Documents by area, several trees | proposal below; no code |

The contract is checked by `npx tsc -p docs/d36/tsconfig.json`. Parts 2 and 3 change no public type, so they get a design and no contract.

The step is the counterpart of step 0 of D35. It changes no behaviour: every existing test passes unchanged, except where a test calls a method that moved. Its purpose is that the packages of [the plan](../README.md) add files and single lines instead of rewriting the same places.

It is done by one session, not in parallel, after D35 point 7 is closed, and it follows the procedure of CLAUDE.md like any point.

## 1. Registry of queries

**Today.** A query is a method of `Engine` (`diagnoseSketch`, `explainConstraint`, `interference`), and its MCP tool is written by hand in `packages/mcp/src/tools.ts`. Three things follow:

- A new query touches the `Engine` interface, `engine.ts`, `tools.ts` and the guard table. Step 1 of D36 is six queries, so six packages would edit the same four places.
- The three methods throw for a wrong argument (`interference.ts` checks the threshold, the shape of the list and that the bodies exist; `engine.ts` throws for an unknown sketch or constraint). The MCP tools turn the exceptions into error texts and add checks of their own (`check_interference` wants at least two different bodies when a list is given); the app calls `interference` and `diagnoseSketch` without catching.
- Part of what the AI is told is computed in the MCP package and the app cannot use it: `bodyDetail` and `edgeShape` (area and normal of a face, length, ends, centre and radius of an edge), `sketchDetail` (areas of regions, advice on what to constrain). That is the mirror image of the rule that the app must not compute.

**Design** (`contract.ts`, second version).

- **A catalog `QUERIES` in the engine**, built like the registry of feature types. An entry has a title, a summary and a description of what it returns (all three go to the description for the AI), a description of its arguments, and a function over a context. `Engine.query(name, args, options)` is the one way in.
- **A query answers for one state and never recomputes it.** A query reads more than the public state: the diagnosis of a sketch needs the input of the solver, how the solve ended and the analysis of freedom, which live in the internal state of the recompute, and the surfaces of faces are not published at all. The engine therefore keeps, for every state it hands out, the internal state it came from, by the identity of the evaluation, and the context gives a query what it needs from there (`frame`, `axis`, `sketch`). A drag preview is diagnosed as dragged. A state that this engine did not produce is refused.
- **The state is chosen three ways:** the current one, the one after a feature (`at`), or one that `preview` returned (`state`); the last two exclude each other in the type. Over MCP the third is `after`: the tool takes a command, the server previews it and asks the query about the previewed state. That is how an AI steps a parameter or a pose without writing anything.
- **Arguments are named and described** (`ArgSpec`): a number with unit and range, a flag, a text, a choice, an ID of a body, a feature or a sketch, a constraint of a sketch, a reference to a named entity with the kinds it accepts, a plane (`PlaneRef`), an axis (`AxisRef`), a vector, and three ways to build structure: a list, one of several named alternatives, and a record by ID. `calls.ts` writes with them a section, a print query with several orientations that are each a direction or a face, a pose and mass properties.
- **The type of the arguments is derived from their description** (`ArgsOf`), so the two cannot disagree. A reference to an entity gets the type of exactly the kinds it accepts.
- **The types of queries are a map by name that modules extend by declaration merging** (`Queries`). A package adds its description, its result and its entry in its own file; no shared type is edited.
- **A query does not throw for what its caller can cause.** `QueryOutcome` is a result or an error with a code: `invalidArguments` (with the name of the argument), `notAvailable` (the thing asked about does not exist in this state), `failed` (the kernel, a limit). An exception of another kind is a defect and passes through, as it does for commands.
- **What is a successful answer today stays one.** A sketch that did not evaluate has the diagnosis `unavailable`; a list of one body has no collisions and `checked: 0` (a test of the scenarios requires it).
- **A cache comes with the context** (`memo(owners, key, compute)`): a result lives as long as all the objects it was computed from. Both solids own an answer about a pair of bodies, as in the cache of `interference` today; a body ID in the key is not enough, because the body behind an ID changes.
- **A large answer says that it was cut** (`Truncated`): a query with such an answer has an argument that limits it. The engine is synchronous and cannot cancel, so a query that can be slow bounds its work by its arguments.
- **The description of a body moves into the engine as it is** (`BodyDescription`): what `bodyDetail` and `edgeShape` compute, including the number of segments of an edge and a centre and radius fitted to vertices, which may be missing. The step adds what the surfaces give for free: the surface of a face and whether a cylinder or a cone is a hole or a pin. Reading circles from the surfaces instead of fitting them changes numbers and belongs to package 1b.

**No existing tool changes.** `check_interference`, `get_sketch`, `explain_constraint` and `get_body` keep their names, schemas and answers; they stay hand-written and call `query` inside. `get_model`, `get_document` and `get_parameters` are views of the state and stay as they are. Generated tools (name, description and input schema from the catalog, numbers rounded to six significant digits) start with the queries of step 1. The first version of this design generated `check_interference` and called the resulting change of rounding "the one visible change"; the reviews showed three more (the tolerance, the note, the rule about two bodies), so nothing is regenerated.

**What a tool may answer** (`ToolAnswer`). Today a tool returns JSON and the server prints it as text; `callTool` and the bridge to the app pass the result through JSON, so bytes do not survive, and STL has a base64 envelope of its own in a hidden tool. That envelope becomes general: an answer is data, files (with the layout `file` or `directory`), or an image, which the server returns to the client as image content.

**Operations of the app** (`HostOperation`). A picture of the viewport is not a query: the engine has no renderer and the operation is asynchronous. It is an operation of the host, described like a query and offered as a tool; over a document from a file it answers `notAvailable`. The path of a tool call becomes awaitable for these; the queries of the engine stay synchronous. A package adds the capability it needs to the host by declaration merging (`AppHost`).

**The description for the AI.** `describe_api` cuts its types out of the raw text of `types.ts`, so types in query modules do not reach it. It gets three generated sections, like the one for constraints: the queries (name, tool, summary, each argument from its description, what it returns), the catalogs (name and summary) and the export formats.

**Guards.** A table of fixtures by query name, with arguments of the query's own type and the tool call that reaches it: a query without a fixture does not compile, and the test runs each one through its tool. The table over the methods of `Engine` stays, with fewer rows. The consumers in the other packages are part of the type check, so the declaration merging is exercised through the entry of the engine package.

**Open.**

- The result types of queries are described to the AI by a text (`returns`). Whether the raw text of the query modules should reach `describe_api` as well, as `types.ts` does, is left to the first package with a result that a sentence does not describe.
- The generated form of a query in the app (part 3).
- How long a query may take over the bridge. The bridge gives up after 30 seconds, but that does not stop a computation in the app.

## 2. A module per feature type

**Today.** `document.ts` (1370 lines) holds the validators of all feature types and the registry `FEATURE_TYPES`. `Evaluator` in `evaluate.ts` has a private method per type (`plane`, `sketch`, `extrude`, `pattern`) and a `switch` over them. D36 adds at least six feature types (hole, import, insert, boolean of bodies, split, revolve, chamfer and fillet), each of which would add a block to both files.

Designed in full in [part2-feature-modules.md](part2-feature-modules.md); this is the summary.

**Proposal.** `packages/engine/src/features/<type>.ts` holds what belongs to one type: its entry of the registry (validation, references, bodies, the fields a patch may change) and its step of the recompute. The registry and the `switch` keep one line per type, and the compiler still guards that both are complete.

- The step needs what are private methods of `Evaluator` today: `frame`, `profile`, `applyTool`, the `done` and `failed` callbacks. They become an explicit context that a step receives.
- `document.ts` keeps what the types share: the reader of numeric fields, the checks of references, the commands.
- This is the most delicate file of the engine. The change gets its own review and is done before any other part touches `evaluate.ts`.

**Open.** Whether the extrusion splits further (profile sources, extents, tool builds as their own modules). Track B (offset, taper, extent up to a face) and revolve all write there. Proposed: yes for tool builds, because taper, revolve and twist are tool builds by the design of D35; decided in the design of 2a.

## 3. Panels and forms of the app as modules

**Today.** `packages/app/src/app.ts` is one class of 2271 lines and about 120 methods. The panels (model, collisions, parameters, sketch, extrusion, plane, pattern) and the forms are its methods, so every package with a form edits the same file.

**Proposal.** A file per panel in `packages/app/src/panels/`, as functions over a context of the app (the engine, the shown state, the mode, the helpers for fields). A form of a feature type is registered by its type (its draft, its panel, its command), so a new type is a new file.

- A panel for a query can be generated from the catalog of queries the way the form of a generator is generated from its catalog entry. Then a new query is reachable from the app without work in the app, which is the other half of the rule "from the app and through MCP". To be decided in the design of 1b, the first query with arguments worth a form.
- The app has few tests (`packages/app/test/sketch-tools.test.ts`). A split without a change of behaviour has to be checked by hand in the running app, or by a smoke test written first.

## 4. Shared vocabulary

Things that several packages need and that must be the same in all of them. They are settled here, before the contracts, not by whichever package is merged first. The types are in `contract.ts`; the table says what had to be decided and the list below it what the contract proposes.

| Item | Who needs it | What has to be decided |
|---|---|---|
| Kinds of faces and edges | 2b, 4a, 4b, 3d | `FaceInfo` has a plane, a cylinder and a swept surface. A cone is needed by the taper, the countersink and the revolve; a general surface by the revolve of an arc, the twist and the fillet. For each kind: can a sketch stand on it, which of its edges are circles or lines and can be projected |
| Reference to a named entity | 1b, 1e, 1a, 5a | One type for "this face", "this edge", "this sketch point", "this body" in the arguments of a query. `PlaneRef` and `AxisRef` exist for features; queries need the same for faces and edges |
| Placement of a body | 3b, 3c, 5a | A frame and offsets with expressions, for an imported mesh, an inserted part and the links of a mechanism. `RigidTransform` (a matrix and a translation) exists since the pattern; `Placement` in `evaluate.ts` is already the name of something else (the transform and the copy tag of a pattern copy) |
| Export | 2g, 5b | `exportMesh(format, bodies)` returns one array of bytes. A format becomes an entry of a registry and returns a list of files, because a robot description is several. One MCP tool with a format; `export_stl` stays as a name for the first format |
| Data catalogs | 2c (hardware), 3a (materials), 7 (threads) | One shape for a table of data in the engine and one way it reaches the description for the AI. The rule is already decided: a catalog fills fields, the document stores numbers |
| Version of the document schema | 3a, 5a, every new feature type | `SCHEMA_VERSION` is 2 and `upgrade` is one function from version 1. Two branches cannot both raise the version. Proposed: `upgrade` becomes a list of steps, one per version, and the version is raised at the merge, not in the branch of a package |
| Issue codes | most packages | `IssueCode` only grows. A package states the codes it adds in its design |

What `contract.ts` proposes (second version):

- **Units** (`QuantityUnit`): `Unit` grows by area, volume, mass and density. The threshold of the interference query is a volume already; mass properties and body properties need the rest. A numeric field of the document and an argument of a query use the same description.
- **Surfaces** (`Surface`): plane, cylinder, cone, swept, general. A sketch stands only on a plane. `FaceInfo` stays internal and keeps what only the engine needs (the `y` direction of a planar face, from which the frame of a sketch on the face is built); `Surface` is derived from it and published in the evaluation next to the names of the faces (`faceSurfaces`).
- **Sides.** A surface has no side; the axis of a cone is the exception, because a cone has two halves. Which side the material is on belongs to the face of a body: the outward normal of a planar face, and for a cylinder or a cone whether it is a pin or a hole (`BodyFace.convex`). Directions that have a sign are frames: the frame of a face points out of the body and the base planes have fixed normals. A query that takes a face as a direction resolves its frame.
- **Edges.** An edge is a circle where both faces are surfaces of revolution about the same axis, a plane across the axis counting as one, away from the apex of a cone. That covers the mouth of a countersink (a plane and the cone) and its lower rim (the cone and the cylinder). `EdgeKind` keeps its four values; `projectEdge` assumes a plane and a cylinder today and changes with the rule.
- **References** (`EntityRef`): a body, a face, an edge, a sketch point. A plane and an axis are not wrapped: an argument of the kind `plane` or `axis` takes a `PlaneRef` or an `AxisRef` as features do.
- **Export** (`ExportFormats`, `EXPORT_FORMATS`, `Exported`): a format is an entry that returns files and says whether they are one file or a folder; a file has a relative path, so a robot description can have a folder of meshes, and may say what it holds (bodies and triangles for STL). `Engine.export(format, options)` replaces `exportMesh`. One MCP tool `export` checks the options against the chosen format and writes with the guarantees `export_stl` has today; `export_stl` stays as it is and uses the same writer.
- **Data catalogs** (`DataCatalog`, `Catalogs`, `DATA_CATALOGS`): a title, a source, columns with units, rows by key. Every catalog has its own columns. Code reads the table with its row type; an untyped caller uses the query `catalog`; the description for the AI lists catalogs by name only.
- **Schema version** (`UPGRADES`): a list of upgrade steps; the version is its length plus one. Version numbers exist only on `master`: a branch appends its step, the number is fixed at the merge, and a document saved by a build of a branch is not portable. The runner checks the version it gets and refuses one it does not know.
- **Placement of a body: taken out.** The first version had a frame from a plane, three offsets and a turn about its normal, which cannot turn a part upside down or tilt it. Package 3b designs it, with the requirements written in `contract.ts`.
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


# Architecture: the repository

Part of [architecture.md](../architecture.md), the design as implemented. Packages, the modules of the engine and of the app, and which may import which.

## Struktura repozitáře

pnpm workspace. Hranice jsou tím vynucené fyzicky: `engine` nemá v `package.json` žádnou závislost.

```
packages/
  engine/            jádro, čistý TS
  solver-planegcs/   adaptér SketchSolver
  kernel-manifold/   adaptér SolidKernel
  scenarios/         validační scénáře proti skutečným adaptérům (jen testy)
  app/               ukázkové UI + renderer (three.js)
  mcp/               rozhraní pro AI: MCP server a most do běžící aplikace
```

Modules of the app (`packages/app/src`), run by `pnpm dev`:

| File | What it holds |
|---|---|
| `app.ts` | The class `App`: the state of the UI (the mode, the selection, the marker, what is hidden), `refresh`, the toolbar, the timeline, the pointer and key events and their dispatch, the pick in the view, the bridge to MCP. It implements the hosts below |
| `host.ts` | `PanelHost`: what a panel or a form may use of the app. A module of a panel imports this interface and never `app.ts` |
| `features/index.ts` | `FEATURE_UI`: one entry per feature type of the engine, complete by the compiler (how the type starts, how it is edited, its lines in the model panel, its faces, its eye on the timeline, its form), and `TOOLBAR`, the order of the buttons |
| `features/draft.ts` | What the forms share: the mode of a draft (`DraftMode`, which carries its form), the preview and the pause of a slow one, numeric fields, the buttons |
| `features/<type>.ts` | The entry of one type; for the extrusion, the plane and the pattern with the form (`FeatureForm`: the draft and its defaults, the command, the panel, what it wants picked in the view, what a move and a click mean, what it draws) |
| `panels/model.ts`, `parameters.ts`, `sketch.ts` | The panels, as functions over the host |
| `panels/query.ts` | The generic form of a query (D39): the menu of the queries of the catalog, the form built from the description of the arguments, asking, the life of an answer, the tree of an answer without a view. Its state (`QueryPanel`: the open query, its draft, the armed control, the answer) is an object the app holds |
| `queries/controls.ts` | `CONTROLS`: a control per kind of argument, typed over the kinds, so a new kind does not compile without one |
| `queries/index.ts`, `queries/measure.ts`, `queries/interference.ts`, `queries/section.ts`, `queries/gap.ts`, `queries/print.ts` | `QUERY_VIEWS`: the optional view of a query (rows in place of the tree, additions to the scene, the note), and the views there are; the collisions are the view of `interference`, the cut model the view of `section` |
| `sketch-mode.ts` | The sketch mode: its tools, what the events of the view mean in it, the drag of a point, what it draws (`SketchHost`) |
| `scene.ts` | The scene of the model: bodies, outlines, planes, the other sketches, highlights (`SceneHost`); what a view of a query adds, and the cut it may make (`shownCut`, read by the scene and by the pick of the app) |
| `viewport.ts` | three.js: draws the description of a scene, the ray under the pointer, the hit of a body. A scene may be cut (`SceneModel.clip`): the bodies and their highlighted faces are clipped by their materials and not hit in the half-space that is cut away. `image` draws a picture of a model off the screen (a scene, a camera and a light of its own into a render target) and returns it as PNG. `View` is its interface; a test passes its own |
| `camera.ts` | The arithmetic of a picture as plain numbers: the camera of a named view fitted to bodies, the scale of a picture from the user's camera, the rows read back from a render target, the side of a cut that is kept |
| `picture.ts` | A picture of the model (D43): what a request draws (`pictureModel`: a colour per body, the edges, the cut), the capability the app hands to its operations (`viewCapability`), and the button that saves a picture (`savePicture`) |
| `sketch-view.ts`, `sketch-commands.ts`, `sketch-diagnosis.ts` | The geometry of a sketch for drawing, hit tests and measuring; the commands of the drawing tools, constraints and dimensions from a selection; the texts of the diagnosis |
| `draw.ts`, `labels.ts`, `fields.ts`, `issue-text.ts`, `dom.ts` | Shared helpers: drawing into a scene, texts, numeric fields with units, issues named for a human, the DOM |

A new feature type costs the app a file in `features/` and a line of `FEATURE_UI`; without the line the app does not compile. The test `packages/app/test/app.test.ts` drives the class as a user does and compares a record of every step with snapshot files (see `docs/d36/00-prep/part3-app-panels.md`). `packages/app/test/query-controls.test.ts` drives the controls of the form of a query that no query of the catalog reaches yet.

Modules of the engine (`packages/engine/src`), after the preparatory step of D36 (D37):

| Module | Content |
|---|---|
| `catalog.ts`, `generators.ts`, `expression.ts`, `util.ts` | the catalogs (constraints, numeric fields, profile generators), expressions, utilities |
| `face-roles.ts` | the catalog of the roles of faces (`FACE_ROLES`) and the key of a face built from it |
| `data-catalogs.ts` | tables of data the engine carries (`DATA_CATALOGS`), typed by row |
| `sketch-content.ts` | what the content of a sketch is, without validation: entities, operands and keys of constraints, the IDs of a document, the owner of a body ID |
| `validation.ts` | what validators share: `CommandError`, the basic checks, the reader of numeric fields (`Fields`), names of faces and edges, references between features (`FeatureRef`, `planeRef`, `axisRef`), and the context a validator gets (`RefContext`, `ValidationContext`) |
| `sketch.ts`, `analysis.ts`, `diagnose.ts` | the input of the solver and its stamp, reference dimensions, profiles and regions; the analysis of freedom and the diagnosis |
| `mesh-distance.ts`, `surfaces.ts` | the smallest distance of two parts of the mesh, the precision of its coordinates and the accuracy of a number measured on it; the circle two surfaces meet in |
| `solid.ts`, `interference.ts` | rigid transforms, faces and edges of a body, the plane on a face, the projection of an edge, measures of a mesh, STL; interference of bodies |
| `recompute/state.ts` | the state between features and the types a step works with (`State`, `Step`, `StepContext`, `ToolRecipe`, `BuiltTool`, `SketchState`) |
| `recompute/services.ts` | functions over the state that the steps share: `frame` (a plane reference), `axis` (an axis reference), `applyTool`, `withFaces`, the texts of issues |
| `recompute/profile.ts`, `recompute/extent.ts` | a profile source turned into regions; the span of a tool along the normal |
| `recompute/outline.ts` | exact outlines of profiles (D44): the outline of selected regions, an outline moved by an offset, the outline of a wall along a chain of curves, and their division into the polylines of regions with the tests of those polylines; the rings of a taper with the rule of the levels (`taperRings`, D45) |
| `recompute/tool-prism.ts` | a tool build: the mesh of a prism over regions and its faces (`buildPrism`). Every tool build is a module `recompute/tool-*.ts` and returns a `BuiltTool` |
| `recompute/tool-stack.ts` | a tool build (D45): the mesh of a stack of rings of one outline at levels along the normal, with its caps and sides (`buildStack`, `Ring`, `Section`) |
| `recompute/taper.ts` | the section of a tapered extrusion (D45): the rings of its outline and the surfaces of its sides (tilted planes, cones) in the coordinates of the sketch |
| `features/module.ts` | `FeatureModule`: the entry of the registry of feature types plus the step of the recompute |
| `features/profile.ts`, `features/extent.ts` | the document halves of a profile source and of an extent: validation, references, fields |
| `features/plane.ts`, `sketch.ts`, `extrude.ts`, `pattern.ts` | one feature type each: its validator, its entry and its step; `sketch.ts` also the validators of sketch content, which the sketch commands call |
| `features/index.ts` | the registry `FEATURE_TYPES`, `FEATURE_TYPE_INFO`, `specOf`, `requireRef`, `producesTool`, `generatorOf` |
| `schema.ts` | the schema of the document as named upgrade steps: `UPGRADES`, `SCHEMA_PENDING`, the version a build saves and the runner |
| `document.ts` | commands, `validateDocument`, `fieldsOf`, `featureInput`, `featureRefs` |
| `evaluate.ts` | `Evaluator`: the cache, the replay of the timeline, the prelude of a step |
| `query/args.ts`, `query/spec.ts` | how the arguments of a query are described and the type that follows; what a query is given (`QueryContext`, `QuerySpec`, the map `Queries`) |
| `query/check.ts`, `query/context.ts` | the check of arguments against a state; the context over the state of the recompute, and the store of results kept by their owners |
| `query/interference.ts`, `query/sketch.ts`, `query/body.ts`, `query/catalog.ts` | the queries, one module each or a few that belong together |
| `query/entity.ts` | `entityShape`: what a face, an edge or a sketch point is exactly, for a query that takes an entity |
| `query/measure.ts` | the query `measure`: the exact part between two entities and the smallest distance on the mesh |
| `query/section.ts` | the query `section`: the cut of a body by a plane (`cut`), the corners of a loop, the regions, the spans read from the surfaces and the budget; `takenAt` and `completeRegions` for whoever draws a cut |
| `query/gap.ts` | the query `gap`: the smallest distance of every pair of bodies within a search distance, from the pass over the meshes, with `interference` for the kind of a zero and for a body inside another |
| `query/mass.ts` | the query `mass`: the integrals of a mesh (`massIntegrals`), where the density of a body comes from (`massSourceOf`, the seam with body properties), the bodies put together, the tensor and the moment about an axis |
| `query/print.ts` | the query `print`: the print frame of an orientation (`frameOfDirection`, `turned`), the pass over the triangles (`printPass`: the box, the faces on the bed, the overhangs), the lists and their limits |
| `query/index.ts` | the catalog `QUERIES` and the runner |
| `export/spec.ts`, `export/stl.ts`, `export/index.ts` | what an export format is (`ExportFormatSpec`, the map `ExportFormats`); the format `stl`; the catalog `EXPORT_FORMATS`, the runner and the form of the paths of an export |
| `sketch-tools.ts` | sketch tools: whole shapes as batches of commands, shared by the app and MCP (D35, point 7) |
| `engine.ts` | the facade |

The imports go one way, in the order of the table: the leaves, then `sketch-content`, then `validation`, `schema` and `sketch`, then `recompute/*`, then `features/module`, `features/profile` and `features/extent`, then the modules of the types, then `features/index`, then `document.ts` and `evaluate.ts`, then `query/*` and `export/*`, then `sketch-tools.ts` and `engine.ts`. A module of a feature type imports neither the registry, nor `document.ts`, nor `evaluate.ts`; what it has to ask the registry (does the target of a reference exist, is it of the right kind and before this feature) reaches its validator as `context.requireRef`. `document.ts` and `evaluate.ts` re-export what moved out of them, so the import paths of the tests and of the other packages did not change. `packages/engine/test/modules.test.ts` guards the direction: it reads the imports of every module with the TypeScript parser and fails on a cycle among those that load a module at run time. Only a statement that is type-only as a whole (`import type`, `export type … from`) is left out: with `verbatimModuleSyntax` a statement whose names are each marked `type` still loads the module. It also loads every module as the first one, which catches a module that reads another at its top level before that one is set.

Moduly rozhraní pro AI (`packages/mcp/src`): `tools.ts` (nástroje nad enginem, bez závislosti na Node i prohlížeči), `host.ts` (the registry of operations of the app and the entry that runs one, shared by the server and the app), `view-image.ts` (the operation `view_image` and the capability of the view it asks; the app imports it as `@trymesh/mcp/view-image`), `export-writer.ts` (the writer of exported files, for the server), `api.ts` (popis API generovaný ze zdrojů enginu), `server.ts` a `main.ts` (MCP server a jeho spuštění), `bridge.ts` a `bridge-client.ts` (most mezi serverem a aplikací). Sestavuje se `pnpm mcp:build`; je to jediný balíček, který se skládá do jednoho souboru, protože ho spouští Node bez Vite.

Testy: Vitest (`pnpm test`), typová kontrola `pnpm typecheck`. Validační scénáře běží v Node proti skutečným adaptérům. Balíčky se neskládají: každý vystavuje přímo zdrojový TypeScript.

Stav 2026-11-14: oba adaptéry a engine jsou hotové včetně testů; všech šest validačních scénářů prochází v Node proti skutečným adaptérům. Ukázková aplikace pokrývá funkce z [ui.md](../ui.md) potřebné k jejich projití v prohlížeči (D31).

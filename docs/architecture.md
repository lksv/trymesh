# Architecture

State: approved on 2026-11-13 (D10–D28), the assumptions verified by spikes. The changes from the implementation (D29–D31) await confirmation; D32 to D34 were approved on 2026-11-14.

It builds on [requirements.md](requirements.md) and [decisions.md](decisions.md). The design of the UI is in [ui.md](ui.md).

Last change: 2026-11-15

## Overview

```
┌──────────────────────────┐
│ UI + renderer (three.js) │   draws, reports the mouse selection
└───────────┬──────────────┘
            │ commands (JSON) ↓       ↑ state, meshes (typed arrays)
┌───────────┴──────────────────────────────────────────┐
│ Engine (TypeScript, no runtime dependencies)         │
│                                                      │
│  engine     facade: commands, undo/redo, preview     │
│  document   data model, commands, serialization      │
│  sketch     sketch model, profile detection          │
│  solid      body mesh, extrude build, names, STL     │
│  evaluate   log replay, cache, error states          │
│                                                      │
│  ports:  SketchSolver          SolidKernel  Deflater │
└────────────┬──────────────────────┬──────────────┬───┘
             │                      │              │
   ┌─────────┴────────┐   ┌─────────┴────────┐   ┌─┴──────────────┐
   │ solver-planegcs  │   │ kernel-manifold  │   │ deflate-pako   │
   └──────────────────┘   └──────────────────┘   └────────────────┘
     adapters (WASM)                               adapter (JS, D54; optional)
```

The rule of dependencies: the engine knows neither the adapters nor the renderer. The adapters and the renderer know only the public types of the engine, with one exception (D72): the solver adapter imports `commonEnd`, the rule of a tangency of a line and an arc at a common end, from the leaf module `common-end.ts`, which imports nothing at run time; the analysis of the sketch reads the same function, so the adapter and the analysis read one rule ([ports.md](architecture/ports.md), [repository.md](architecture/repository.md); `packages/engine/test/modules.test.ts` guards both). The adapters are given to the engine when it is created.

## Where it is written

The design is split by area (D37, part 5), so that work on one area changes one file. A reference "architecture.md, section X" in the code or in an older document means the section of that name in the file of this table.

| File | What it describes | Sections |
|---|---|---|
| [architecture/repository.md](architecture/repository.md) | Packages, the modules of the engine and of the app, and which may import which | Structure of the repository |
| [architecture/document.md](architecture/document.md) | The two histories, the types of the document, parameters and expressions | Two different histories; Document; Parameters and expressions (D35, point 1); Body properties and the sections of the document (D48); The mechanism (D49) |
| [architecture/sketch.md](architecture/sketch.md) | The sketch, its solution, its diagnosis and the sketch tools, the re-point command and the fillet, mirror and pattern in a sketch (D68), projection from another sketch (D69), the spline (D70), an imported outline (D72), the rectangle by its centre and sizes and the fillet of several corners (D73) | Sketch; Solving the sketch (D12); Sketch diagnosis (D32); Sketch tools (D35, point 7) |
| [architecture/naming.md](architecture/naming.md) | Names of faces and edges, the plane of a sketch on a face, profiles and regions | Naming; Faces; Edges (D22); The plane of a sketch on a face; Profiles and regions |
| [architecture/extrude.md](architecture/extrude.md) | The extrusion, its extent and targets, the offset of a profile and a wall along curves, the taper, profile generators | Extrude; Extent and targets (D35, point 2); Extent up to a plane (D47); Start at a plane (D66); Profile offset and a wall (D44); Taper (D45); Profile generators (D35, point 3; D61) |
| [architecture/hole.md](architecture/hole.md) | The hole feature, its tool of stacked sections, the hardware catalogs and the query `hardwareHole` | Hole (D46); The hardware catalogs (D46); The query `hardwareHole` (D46) |
| [architecture/revolve.md](architecture/revolve.md) | The revolve feature, its tool, the surfaces sphere and torus, the circles two surfaces meet in, the axis of a line of a sketch | Revolve (D58); The circles of two surfaces (D58); The axis of a line of a sketch (D58); Known limits |
| [architecture/edge-blend.md](architecture/edge-blend.md) | The chamfer and the fillet of edges: the edges they take, the corner, the ends, the tools, the checks and the faces of the result | Chamfer and fillet (D63); The app and MCP; Known limits |
| [architecture/pattern.md](architecture/pattern.md) | The pattern of bodies and of features: circular, linear and mirror | Pattern (D35, point 4) |
| [architecture/insert.md](architecture/insert.md) | Another document stored inside the host and inserted as a part: the section `documents`, the feature type `insert`, the recompute of a stored document through the state, the names of inserted faces, what an inserted body inherits | Inserting another document as a part (D62) |
| [architecture/combine.md](architecture/combine.md) | The boolean of finished bodies, the subtraction with a clearance, the split by a plane, and the checks of the result of a boolean of bodies | Combine (D56); The clearance (D56); The boolean of two bodies and its checks (D56); Split (D56) |
| [architecture/ports.md](architecture/ports.md) | The contracts of `SketchSolver` (with the tangency of a line and an arc at a common end, D52), `SolidKernel` and `Deflater` (D54) | Ports; SketchSolver; SolidKernel; The intersection as computed (D50) |
| [architecture/recompute.md](architecture/recompute.md) | The replay of the features, its cache and the states of errors | Recompute |
| [architecture/api.md](architecture/api.md) | The facade, queries, export formats, `importOutline` and the outline formats, bodies, the commands and their validation | The API of the engine; Queries (D37); Export formats (D37); Bodies: volume, export and interference (D35, point 5); Commands; What of the API came from the design of the UI (D24) |
| [architecture/ai.md](architecture/ai.md) | The MCP server, its tools (`import_outline` among them) and the bridge to the running app; describe_api in sections, `new_document`, the reason a bridge cannot listen and taking the port only when asked (D73); the operation `get_selection` and operations without a state path (D74) | Interface for AI (D33) |
| [architecture/verification.md](architecture/verification.md) | The design against the scenarios, the tests of the offset and the wall, of the taper, of the extent up to a plane, of body properties, of the mechanism, of an inserted document, of the second opinion of the kernel and of the second cleaning of an intersection, and the results of the spikes of both libraries | Verification against the scenarios; The offset of a profile and a wall (D44); The taper (D45); The extent up to a plane (D47); Body properties (D48); The mechanism (D49); A second opinion of the kernel for a pair it refuses (D50); The second cleaning of an intersection (D51); Inserting another document (D62); Results of the spikes; Manifold (`manifold-3d` 3.5.5); Coplanar faces in the adapter; planegcs (`@salusoft89/planegcs` 1.3.0) |

A change of the engine, an adapter, the MCP server or the app is described in the file of its area. A new area (a new feature type, a new kind of port) gets a file of its own and a row here.

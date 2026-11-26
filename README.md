# trymesh

A proof of concept of a parametric 3D CAD editor in the style of Autodesk Fusion, running in the browser. Sketches are solved by a constraint solver, extruded, revolved, patterned and combined, and recorded on a feature timeline that can be edited in the middle and recomputed. Models can be built in the app or together with an AI through an MCP server, and every function is reachable both ways.

## An experiment with Claude Fable 5.2

trymesh is an experiment in **how far one can get with Claude Fable 5.2**. The owner of the project set the goals, answered design questions and approved every third-party library. Almost all of the design, code, tests and documentation were written by AI agents in Claude Code:

- **Claude Fable 5.2** did the architecture, the designs of the work packages and the design reviews.
- **Claude Opus 5.5** implemented much of the code, ran the code reviews and made the fixes. Some designs were also reviewed by other vendors' models.

Of the 491 commits, 203 are co-authored by Fable 5.2 and 235 by Opus 5.5. The whole history covers 13 to 25 November 2026.

The work followed a fixed procedure for each point of work (see [CLAUDE.md](CLAUDE.md)):

1. a written design, reviewed independently before any code;
2. implementation;
3. tests;
4. updates to the documentation;
5. an independent review by an agent that did not write the code, as deep as the risk of the change requires;
6. fixes, each round in a commit of its own.

The decisions behind the design are recorded in [docs/decisions.md](docs/decisions.md), D1 to D74, with their reasons and the alternatives considered.

## What it can do

- **Sketches**:
  - entities: points, lines, circles, arcs and splines;
  - constraints and dimensions driven by named parameters and expressions;
  - diagnosis of under- and over-constrained sketches;
  - sketch tools such as rectangle, polygon, fillet, trim, extend, split, mirror and pattern;
  - projection of model edges and of other sketches;
  - outlines imported from DXF and SVG.
- **Features**:
  - extrusion with extents up to faces and planes, taper, profile offset and walls;
  - revolve;
  - holes from hardware catalogs (plain, counterbored, countersunk);
  - chamfers and fillets of edges;
  - circular, linear and mirror patterns of bodies and features;
  - booleans with clearance, and split by a plane;
  - construction planes, imported meshes, and another document inserted as a part.
- **The timeline**: features can be edited, inserted, suppressed or deleted anywhere in the history. References survive a recompute because faces and edges have stable names. A broken reference marks the feature as an error and the recompute goes on.
- **Queries**: sections, measuring, the smallest gap and interference between bodies, mass properties, print checks.
- **Export**: STL, 3MF, DXF, SVG, a parts list (CSV), and URDF and MJCF for robot simulators.
- **AI interface**: an MCP server with tools for the whole engine. It can drive the server's own engine or, over a local bridge, the running app.
- **Onshape converter** (`tools/onshape/`): converts an Onshape Part Studio model into a trymesh document and checks the result. See [docs/onshape-import.md](docs/onshape-import.md).

Solids are closed triangle meshes, not B-rep. Lengths are in millimetres and angles in radians.

## Architecture

```
app (three.js UI)  ──commands (JSON)──▶  engine  ◀──tools──  mcp (MCP server + bridge to the running app)
                                           │ ports
                         solver-planegcs ──┼── kernel-manifold      (WASM adapters)
                                           └── deflate-pako         (3MF compressor, optional)
```

- **`packages/engine`**: the document, commands, the recompute, queries and export. It has no runtime dependencies. The document is an immutable JSON structure and the only source of truth: geometry is never stored, it is derived by replaying the feature list.
- **`packages/solver-planegcs`**, **`packages/kernel-manifold`**, **`packages/deflate-pako`**: adapters that implement the engine's ports over [planegcs](https://github.com/Salusoft89/planegcs), [Manifold](https://github.com/elalish/manifold) and [pako](https://github.com/nodeca/pako).
- **`packages/app`**: the three.js user interface. It only composes commands and shows state.
- **`packages/mcp`**: the MCP server.
- **`packages/scenarios`**: multi-step validation scenarios against the real adapters.

The design is documented in detail in [docs/architecture.md](docs/architecture.md) and [docs/architecture/](docs/architecture/), the requirements and validation scenarios in [docs/requirements.md](docs/requirements.md), and the UI in [docs/ui.md](docs/ui.md). The older parts of the documentation are in Czech and everything newer is in English, so the docs are mixed-language.

## Getting started

Requires Node.js and pnpm 9 (`npx -y pnpm@9.15.9` works if pnpm is not installed).

```sh
pnpm install
pnpm dev            # the app on http://localhost:5173
pnpm test           # all tests (Vitest)
pnpm typecheck
pnpm mcp:build      # bundle the MCP server to packages/mcp/dist/server.js
```

The repository's `.mcp.json` registers the MCP server for Claude Code. Build it first, and rebuild it after a change in the engine.

## Status

This is a proof of concept, not a product. What is not done yet, and why the design does not block it, is listed in [docs/backlog.md](docs/backlog.md).

## License

[MIT](LICENSE). Third-party libraries keep their own licenses:

- `@salusoft89/planegcs`: LGPL-2.0-or-later
- `manifold-3d`: Apache-2.0
- `pako`: MIT and Zlib
- `three`: MIT
- `@modelcontextprotocol/sdk`: MIT

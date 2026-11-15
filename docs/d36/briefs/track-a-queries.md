# Brief: track A, the queries of step 1

Read [README.md](README.md) of this directory first.

Step 1 of D36 is "the AI sees and measures": queries over finished bodies; the document does not change. Five are entries of the registry of queries of the preparatory step; the view image (1f) is an operation of the app (`HostOperation`), because the engine has no renderer.

| ID | Directory | Decision | What the backlog says | To decide in the design |
|---|---|---|---|---|
| 1a | `1a-section` | D38 | A plane gives, per body, closed loops with areas and, per segment, the face it lies on; a pass over triangles in the engine, no kernel. The section view in the app clips in the renderer and fills the cut from the loops | How the plane is given (`PlaneRef`, an offset). The shape of a loop for an AI (points, or lines and arcs rebuilt from the surfaces). A limit on the size of the answer. What the app needs for the filled cut |
| 1b | `1b-measure` | D39 | Distance and angle between two named entities, distance of the axes of two cylinders; exact for planes and cylinders | Which pairs of `EntityRef` kinds have an answer and which answer (smallest distance, distance of parallel planes, angle). What is returned for a pair without an exact answer. It builds on `BodyDescription` of the preparatory step |
| 1c | `1c-gap` | D40 | The smallest gap between two bodies; Manifold has `minGap` | The addition to the kernel port and its guarantee. Bodies that intersect. A search distance. All pairs in one call or one pair |
| 1d | `1d-mass` | D41 | Mass (volume, density, fill factor), centre of mass, moments of inertia | The density is an argument until body properties (3a) exist: how the two meet later. The frame the inertia is given in. A group of bodies as one link |
| 1e | `1e-print` | D42 | Per body and orientation: bounds against the bed, height, contact area, overhang area per named face; several orientations in one call; no bridges, wall thickness or support volume | An orientation by a direction or by a face ("this face lies on the bed"): a surface has no side, the frame of a face points out of the body (`context.frame`). The threshold on the overhang area |
| 1f | `1f-image` | D43 | A picture of a view for the AI, from the viewport of a connected app over the bridge; without an app a rasteriser of its own or nothing | An operation of the app, as `00-prep/calls.ts`, section h, sketches it: the capability the viewport gives to the host. Named views and a view of a cut model (1a). The size of an image in a tool answer. Over a document from a file it answers `notAvailable`; is a rasteriser of its own worth it |

Validation scenario 11, shared by the six: the queries asked about the robot joint of scenario 9 (`packages/scenarios/test/scenario9.test.ts`, `docs/requirements.md`): the wall between the root circle of the ring gear and the bolt holes, the gap between a planet and the carrier, the mass of the carrier beyond the output, the printability of the housing in two orientations, a section through the gears. Each `calls.ts` writes its part.

Code to read: `packages/engine/src/solid.ts`, `interference.ts`, `engine.ts`, `types.ts`; `packages/kernel-manifold/src/index.ts` and the types of `manifold-3d` (`minGap`, `slice`); `packages/mcp/src/tools.ts` (`bodyDetail`, `edgeShape`), `bridge.ts`, `server.ts`; `packages/app/src/viewport.ts`.

Every query is reachable through MCP by construction: the general tool `query` reaches every entry of the registry, with `at` and `after`. A query reads geometry only from its context (`bodies`, `surface(body, face)`, `frame`), so that it answers for a pose later (5a). Say for each what the app shows.

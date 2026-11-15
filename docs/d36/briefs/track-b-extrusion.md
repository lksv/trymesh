# Brief: track B, the extrusion tool

Read [README.md](README.md) of this directory first.

Four packages of step 2 that change the same code (the profile, the extent and the tool of an extrusion), so one session designs them together and in this order. The sketches in [backlog.md](../../backlog.md), part "Print queries and the features of step 2 in detail", are the starting point; none of them was tried in code.

| ID | Directory | Decision | What the backlog says | To decide in the design |
|---|---|---|---|---|
| 2a | `2a-offset` | D44 | An optional numeric field `profile/offset`; computed per curve with mitre joins so that every curve maps to one curve and side faces keep their names; `invalidProfile` when a curve vanishes or loops meet. A wall from a line: an open chain of curves offset to both sides | Where the offset lives so that a revolve gets it too (the preparatory step makes a profile a service on both sides: `features/profile.ts` for the document, `recompute/profile.ts` for the recompute). How an open chain is referred to (`RegionRef` names closed regions). Whether tool builds and extents become modules of their own |
| 2b | `2b-taper` | D45 | An optional field `extent/taper`; the far profile is the near one offset by `distance · tan(taper)`; a ruled surface between the two; a cone for a circle; not with "through all" | The sign. The cone in `Surface` and the rule for circular edges, so that the rim of a countersink can be projected. Tessellation of arcs with two radii |
| 2f | `2f-upto` | D47 | A new variant of the extent: up to a planar face, also a tilted one; the length follows the face | The reference and when it is verified. What happens when the face is behind the start, is not planar, or the tool misses it. With a pattern: per copy, like "through all" |
| 2c | `2c-hole` | D46 | A feature type `hole`: a sketch, a list of its points, a kind (plain, counterbore, countersink, nut pocket), an extent and targets like a cut; a tool recipe, so a pattern repeats it. The catalog fills the fields, the document stores numbers and a free-text label | The names of faces when the feature has several points: new roles in the union of `FaceName` and in `FACE_ROLES` of the preparatory step. The hole as a source of a pattern (`producesTool` in the registry). The catalog as a `DataCatalog` of the preparatory step and how a tool or a form fills the fields from it. The values have to come from the standards, not from memory; say where they will be taken from |

Validation scenario 12, shared by the four: a box with a lid and screw posts. The cavity is the outline offset by the wall; the lid has a lip from the same outline; the posts end at the floor of the lid (up to a face); the screws are countersunk (taper, hole feature) and the posts take heat-set inserts (hole feature from the catalog); a rib from a line stiffens a wall.

Code to read: `packages/engine/src/evaluate.ts` (`extrude`, `profile`, `generated`, `applyTool`, `toolSpan`), `solid.ts` (`buildPrism`, `FaceInfo`, `edgeKind`, `projectEdge`), `sketch.ts` (regions), `document.ts` (`extrudeFeature`, the registry), `generators.ts`, `catalog.ts`; `packages/app/src/app.ts` (`extrudePanel`) and `sketch-commands.ts` (`changeExtrude`); `docs/d36/00-prep/part2-feature-modules.md`.

Every field is a numeric field of the catalog, so it takes an expression and shows up in MCP without work there; say for each package what the form in the app gets.

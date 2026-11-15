# Brief: track E, new sections of the document

Read [README.md](README.md) of this directory first.

Two packages from later steps that are designed now because each adds a section to the document, and the shape of the document is what is expensive to change later. Only the parts that decide that shape get a full contract.

| ID | Directory | Decision | What the backlog says | To decide in the design |
|---|---|---|---|---|
| 3a | `3a-body-properties` | D48 | An optional entry per body ID: name, colour, density, a reference flag (not printed, not exported). A small catalog of printing materials fills the density | Where the section lives and what happens to an entry whose body no longer exists (a broken reference like any other, or dropped). Derived body IDs (`<pattern>/<number>`). "Not printed" and "not part of the mechanism" are two flags. An explicit mass instead of a density. The commands. How the mass query of 1d and the exports read it. The step of the schema upgrade |
| 5a | `5a-mechanism` | D49 | A description next to parameters and checks: links (a name and bodies that move as one piece) and joints (a kind, parent and child link, an axis as `AxisRef`, limits and a value as numeric fields). A tree with one root. A pose is the values of the joints; queries (interference, smallest gap) run over a posed state; a coupled motion is an expression between joint values | The section and its commands. Validation: a tree, a body in at most one link, references. How a posed state is computed and handed to a query (the preparatory step lets a query run over a state). What the app shows. What the export of a robot description (5b, not designed now) will need from it: frames, units, the mass of a link from 1d and 3a |

Validation scenario 13, shared by the two: a link of an arm between two joints. Bodies with materials and a motor as a reference part with the mass of its data sheet; two revolute joints; the pose stepped through the range of one joint with the collisions asked at each step; the mass of what hangs beyond the first joint.

Code to read: `packages/engine/src/types.ts` (the document, `AxisRef`, `PlaneRef`), `document.ts` (parameters and checks as the model of a section: commands, validation, `upgrade`, `SCHEMA_VERSION`), `expression.ts`, `evaluate.ts` (how parameters reach the recompute, the pattern's `RigidTransform`), `interference.ts`; `packages/app/src/app.ts` (`parametersPanel`, `collisionsPanel`); `docs/backlog.md`, parts "Export for simulation" and "Candidates the table above does not have".

Both sections must be readable and changeable through MCP by construction (commands and the generated description); say what `get_model` shows of them.

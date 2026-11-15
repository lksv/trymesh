# 1a Section: the query and the section view in the app

**Decision D38. State: designed, not implemented.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario, the entry and the view as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

Validation scenario 11 (the queries asked about the robot joint of scenario 9), this package's part: a section through the gears.

The app side builds on the generic form of a query of [1b](../1b-measure/design.md).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Future features of requirements.md, assessed", "Section view": the view for a person and the cut as data for the AI share one computation. The query: a plane gives, per body, closed loops with areas and, per segment, the face it lies on; a pass over triangles in the engine, no kernel, which keeps the face names that `slice` of Manifold would not. The view: clipping in the renderer hides one side, and the loops of the query give the filled cut.

- **`slice` of Manifold** (`manifold-encapsulated-types.d.ts`) cuts parallel to the XY plane at a height and returns a `CrossSection` of polygons. It carries no face numbers, and any other plane would need the body transformed first. The backlog's reason holds.
- **A pass over triangles closes its loops.** The mesh of a body is a closed surface: every edge lies in exactly two triangles, once each way. That is guarantee 1 of the kernel port, the adapter checks it on every result (`isClosed`), and `buildPrism` builds its tools that way. So when every crossed triangle gives exactly one segment between two of its edges, the segments chain into closed loops by the edges alone. Vertices that `buildPrism` or the adapter doubled (a body that touches itself along an edge) do not matter, because the chain follows edges, not coordinates.
- **The face of a segment** is `faceIds` of its triangle, and its name `faceNames` of the evaluation; its surface comes from `context.surface(body, face)`.
- **The app can fill a loop already.** `SceneModel.fills` takes a frame and loops, the outer one first and its holes after it; the regions of a sketch are drawn with it. The viewport has no clipping today, and `pickBody` casts its ray against the whole mesh.
- **Measured on the model of scenario 9** by a prototype of the pass (kept outside the repository), at the chord tolerance 0.01 mm:
  - Across the axis at z = 40: six bodies are cut; the area of a planet is 431.379 mm², which is its volume over its height to all printed digits; the housing is one outer loop and seven holes (six bolt holes and the ring gear). The loops have 5584 points together, of which 4410 lie on the five faces of gear teeth.
  - Along the axis (the base plane XZ, which goes exactly through vertices of the round faces): every loop closes; the motor is 2385 mm² (90 by 26.5), the carrier 362.5.
  - In the plane of an end cap (z = 46): half of the segments have no length and are dropped; the areas are those of the caps.
  - One body takes 0.2 to 3 ms.

## The cheap variant

One query, `section`.

**The plane** is a `PlaneRef`, as features use it (a base plane, a plane feature, a planar face), with an `offset` along its normal and a `flip`. It is the argument kind `plane` of the preparatory step; the frame comes from `context.frame`, so a plane given by a face of a body is in the pose the query is asked about.

- For a face the normal points out of the body, so a negative offset cuts into it.
- `flip` turns the frame round (the normal and its x axis reversed), after the offset. It changes which side counts as cut away and from which side the loops are seen, nothing else.
- A face that is not planar is `failed` with the path `['plane']`; a plane that is not in the state asked about is `notAvailable`, found before `run`.

**A vertex in the plane counts as above it.** That one rule makes the pass total: no triangle is crossed twice or lies in the plane undecided. Its consequence is stated in the answer and not hidden: the section is taken a step below the plane. A body that ends in the plane from below shows that face as its section; a body that starts in it from above shows nothing. Planar faces of the bodies that lie in the cutting plane are listed in `inPlane`, so the caller knows the offset is better moved.

**The answer** is, per body the plane cuts, its area and its regions; a region is an outer loop and the holes in it, each with an area and a length. The points are two numbers each, in the x and y of the cutting plane, and the frame is returned once. Two thirds of the numbers of a 3D answer, and the form the app's `fills` and an outline export (2g) take.

**The shape of a loop for an AI: spans, rebuilt from the surfaces.** A loop is cut into runs of segments that lie on one face. What a run is follows from the surface of that face and from how the plane meets it, not from a fit to the points:

| Surface | The plane meets it | Span |
|---|---|---|
| plane | any way | line |
| cylinder | across the axis | arc: centre, radius, sweep |
| cylinder | along the axis | line |
| cone | across the axis | arc |
| swept | along the direction of the sweep | line |
| anything | otherwise | curve: the number of points and the length, and the points while they fit the budget |

So the housing at z = 40 is eight spans: a whole circle of radius 55 on `housing/side/ho`, six whole circles of radius 1.7 with their centres, and one curve of 1440 points on `ring/side/teeth`. An AI reads the bolt circle off the centres; it does not read 1440 points of an involute, and the facts of the gear say more about it than the points would.

**The other shape, `outline: 'polylines'`,** gives every loop as the polygon the mesh has. It is what a renderer fills and it matches the clipped mesh exactly, which rebuilt arcs would not.

**The limit** is `maxPoints`, 500 by default: the points of curves with `spans`, of all loops with `polylines`. A list that does not fit is left out whole (a curve keeps its count and length, a loop its area and length), later smaller ones may still fit, and `truncated` says how many points were listed of how many (`Truncated` of the preparatory step). The number of spans is not limited: it is bounded by the faces of the model, not by the fineness of the mesh.

**What the app needs for the filled cut:** the frame, and regions with their loops as polylines. One `fills` entry per region, the outer loop first. The view asks with `outline: 'polylines'` and a budget that does not matter (`prepare` of the view of 1b).

**Deferred.**

- A section by more than one plane (a stepped or a quarter section), and a section of a slab between two planes.
- The picture of a cut model for the AI: package 1f, which takes the loops and the frame from this query.
- An outline as DXF or SVG: package 2g, a writer over the spans (a line and an arc are what those formats have).
- Hatching, and a fill colour per body.
- Measuring inside the section in the app. The AI has the numbers; a person has `measure` of 1b.
- The section view while a feature form is open, and over a previewed state.
- A memory of sections: one body takes at most 3 ms, and every step of the offset is another plane.

## Where it lives

```
packages/engine/src/
  queries/section.ts   the entry: the frame, the pass (cut), the nesting of loops, the spans, the budget
packages/app/src/
  queries/section.ts   the view: the rows, the clip, the fills and the outline
  viewport.ts          SceneModel.clip; the body material clipped; pickBody ignores the cut-away side
  scene.ts             takes the additions of the view (1b)
```

- `cut(solid, frame)` is the pass: it classifies the vertices, makes one segment per crossed triangle directed so that the material is on its left seen against the normal, and chains the segments by the edges they end on. The point on an edge is computed from its two vertices in a fixed order, so both triangles of the edge get the same numbers.
- The nesting (which loop is a hole of which) is by signed area and one point-in-polygon test per hole.
- Everything of a body is read from the context (`bodies`, `surface`, `frame`), so the query answers at `at`, over `after` and in a pose.

## What it adds

| To | What |
|---|---|
| The document | nothing |
| Commands | none |
| `Queries` | `section` |
| Issue codes | none |
| The kernel port | nothing: the pass is in the engine |
| `SceneModel` of the app | `clip`, the half-space that is not drawn |
| MCP | nothing by hand: the tool `query` reaches it |

## What the app shows

The generic form of 1b with a view of its own (`QUERY_VIEWS.section`; `calls.ts` writes it).

- **The form**: the plane (a base plane or a plane feature from a choice, or a planar face or a plane selected in the view), the offset, the flip, the bodies.
- **While the answer is shown** the view cuts the model: what lies on the side the normal points to is not drawn, the cut is filled per region and outlined. The panel lists the bodies with their areas, says which faces lie in the plane, and has two buttons that step the offset and ask again. Closing the answer, moving the marker elsewhere or a change of the document ends the cut, by the life of an answer in 1b.
- **In the viewport**: `SceneModel` gets `clip`. The material of the bodies is clipped by that plane and drawn two-sided while it is set (a cavity would otherwise show through its culled back faces). The fills lie in the plane itself and are not clipped. The edges of the bodies are clipped too: by the material if the line material of three.js honours a clipping plane (to check in the implementation), otherwise the scene builder cuts the segments by the plane before it hands them over. `pickBody` skips hits on the cut-away side, so a click lands on what is seen.

## Needs from the preparatory step

None of its own. It uses the two stand-ins of 1b (the units of a result, and `failed` where the caller made the mistake: none arises here).

## Rejected

- **`slice` of Manifold behind the kernel port.** It loses the face of every segment, which is half of the answer, and cuts only across Z. Reason of the backlog, confirmed in the types of the library.
- **The cut face as real geometry** (`trimByPlane` or a boolean with a half-space, then the new face). It needs the kernel, makes a face that has no name, and solves the splitting of a body (3d), not looking into one.
- **Points in the coordinates of the model.** Half as many numbers again, and neither the fill of the app nor an outline export wants them. The frame is in the answer for whoever does.
- **Only polylines, with a limit.** A section through a gearbox is thousands of points an AI cannot use, and the limit would cut off the circles that matter together with the teeth that do not.
- **Arcs fitted to the polygon** instead of read from the surface. A fit has a tolerance to choose and gets a filleted corner of a generated profile wrong; the surface is exact and already there.
- **Thinning a curve** to fit the budget. A thinned involute is no longer the profile; a count and a length are honest, and the caller can raise the budget for one body.
- **A band of tolerance around the plane** in which a vertex counts as "in" the plane. It gives triangles that are neither crossed nor not, and with them open chains. The asymmetric rule has no such case and is told to the caller.
- **Capping in the renderer by the stencil buffer**, which fills a cut without any loops. The AI needs the loops anyway, and one computation for both is the point of the backlog.

## Open

- The tolerance of `inPlane` (when does a face "lie in" the cutting plane). Proposed: the normals parallel within `ANGLE_TOLERANCE` and the distance within the precision of the coordinates the kernel adapter uses (a millionth of the largest coordinate, at least `LENGTH_TOLERANCE`).
- Whether a body the plane only touches in an edge or a corner should be said to be touched. Today it is simply not listed.

## Reviews

Not reviewed yet.

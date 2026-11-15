# 1a Section: the query and the section view in the app

**Decision D38. State: designed, not implemented; second version, after one round of reviews.** Step 1 of [D36](../../decisions/D36-order-after-d35.md), track A of [the plan](../README.md). Written against the sixth version of the contract of [the preparatory step](../00-prep/design.md), at commit `0dc424b`. The types are in [contract.ts](contract.ts), the scenario, the entry and the view as calls in [calls.ts](calls.ts); both are type-checked by `npx tsc -p docs/d36/tsconfig.json`.

Validation scenario 11 (the queries asked about the robot joint of scenario 9), this package's part: a section through the gears.

The engine side takes the precision of the coordinates from [1b](../1b-measure/design.md); the app side builds on the generic form of a query designed there. Package 1f builds on this one (the query and the clip of the viewport).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Future features of requirements.md, assessed", "Section view": the view for a person and the cut as data for the AI share one computation. The query: a plane gives, per body, closed loops with areas and, per segment, the face it lies on; a pass over triangles in the engine, no kernel, which keeps the face names that `slice` of Manifold would not. The view: clipping in the renderer hides one side, and the loops of the query give the filled cut.

- **`slice` of Manifold** (`manifold-encapsulated-types.d.ts`) cuts parallel to the XY plane at a height and returns a `CrossSection` of polygons. It carries no face numbers, and any other plane would need the body transformed first. The backlog's reason holds.
- **A pass over triangles closes its loops.** The mesh of a body is a closed surface: every edge lies in exactly two triangles, once each way. That is guarantee 1 of the kernel port, the adapter checks it on every result (`isClosed`), and `buildPrism` builds its tools that way. So when every vertex is on one side or the other and every crossed triangle gives exactly one segment between two of its edges, the segments chain into closed loops by the edges alone. Vertices that `buildPrism` or the adapter doubled (a body that touches itself along an edge) do not matter, because the chain follows edges, not coordinates.
- **The face of a segment** is `faceIds` of its triangle, and its name `faceNames` of the evaluation; its surface comes from `context.surface(body, face)`.
- **The app can fill a loop already.** `SceneModel.fills` takes a frame and loops, the outer one first and its holes after it; the regions of a sketch are drawn with it. The viewport has no clipping today. `pickBody` casts its ray against the whole mesh, and `App.pick` picks edges on its own, from the segments of the edges of the bodies.
- **Measured on the model of scenario 9** by a prototype of the pass (kept outside the repository; the internal reviewer reran the first version of it, and the second version was run after the review), at the chord tolerance 0.01 mm:
  - Across the axis at z = 40: six bodies are cut, in 19 loops; the area of a planet is 431.379 mm², which is its volume over its height to all printed digits; the housing is one outer loop and seven holes (six bolt holes and the ring gear). The loops have 2792 corners together, of which 2205 lie on the five faces of gear teeth (270 the sun, 405 a planet, 720 the ring gear). One segment per crossed triangle gives twice as many points, 5584: a side face is a strip of quads of two triangles each, and the point on the diagonal lies in line with its neighbours.
  - Along the axis (the base plane XZ, which goes exactly through vertices of the round faces): every loop closes; 92 spans, all lines; the motor is 2385 mm² (90 by 26.5), the carrier 362.5.
  - In the plane of an end cap (z = 46, where the planets, the teeth of the sun and the housing end): the planets give 431.379 each and the housing 6028.838, its front face with the nut pockets.
  - The same with a planet turned by 30°, 17° and 45° about X, cut in the plane of its end cap: 2 loops and 431.379 each time; seen from the other side, nothing. This case failed in the first version (see "Reviews").
  - One body takes 0.2 to 3 ms.

## The cheap variant

One query, `section`.

**The plane** is a `PlaneRef`, as features use it (a base plane, a plane feature, a planar face), with an `offset` along its normal and a `flip`. It is the argument kind `plane` of the preparatory step; the frame comes from `context.frame`, so a plane given by a face of a body is in the pose the query is asked about.

- For a face the normal points out of the body, so a negative offset cuts into it.
- `flip` turns the frame round (the normal and its x axis reversed), after the offset. It changes which side counts as cut away and from which side the loops are seen. It also turns "below" (next paragraph): a body that ends in the plane is in the section one way and absent the other.
- A face that is not planar is `failed` with the path `['plane']`; a plane that is not in the state asked about is `notAvailable`, found before `run`.

**The section is taken just below the plane.** The heights of the vertices are measured from the plane moved against its normal by the precision of the coordinates (`coordinatePrecision` of 1b: a millionth of the largest coordinate of the bodies asked about, about 5e-5 mm for the joint), and a vertex at zero or more counts as above. Every vertex is then on one side, so no triangle is crossed twice or left undecided, and every chain closes.

- The frame of the answer is the plane as asked for; the points are in its x and y, where the small move along the normal does not show.
- The consequence is stated in the answer, not hidden. A body that ends in the plane from below shows that face as its section; a body that starts in it from above shows nothing. Bodies with a planar face in the cutting plane are listed in `inPlane` (one face each), so the caller knows the offset is better moved.
- Why not at the plane itself: the vertices of a face that lies in the plane are in float32, a few millionths of a millimetre to either side of it as soon as the body is not aligned with the axes of the model. Comparing their heights with zero splits them at random and the section is a random part of the face. Scenario 9 hides this because every cap is at an exact z.

**The points of a loop are the corners of its polygon.** A segment without length is dropped, and a point in line between its two neighbours on the same face is dropped (within `LENGTH_TOLERANCE`). So the number of points says something about the shape and not about how a face happens to be divided into triangles, which changes after a boolean.

**The answer** is, per body the plane cuts, its area, the number of its loops and its regions; a region is an outer loop and the holes in it, each with an area and a length. The points are two numbers each, in the x and y of the cutting plane, and the frame is returned once. Two thirds of the numbers of a 3D answer, and the form the app's `fills` and an outline export (2g) take.

**The shape of a loop for an AI: spans, rebuilt from the surfaces.** A loop is cut into runs of segments that lie on one face. What a run is follows from the surface of that face and from how the plane meets it, not from a fit to the points:

| Surface | The plane meets it | Span |
|---|---|---|
| plane | any way | line |
| cylinder | across the axis | arc: centre, radius, sweep |
| cylinder | along the axis | line |
| cone | across the axis | arc |
| swept | along the direction of the sweep | line |
| anything | otherwise | curve: the number of points and the length, and the points while they fit the budget |

So the housing at z = 40 is eight spans: a whole circle of radius 55 on `housing/side/ho`, six whole circles of radius 1.7 with their centres, and one curve of 720 points on `ring/side/teeth`. An AI reads the bolt circle off the centres; it does not read 720 points of an involute, and the facts of the gear say more about it than the points would.

**The ends of a span are points of the mesh; the centre and the radius of an arc are those of the surface.** Both are stated, and they need not agree to the last digit:

- The spans of a loop join exactly, because each starts at the corner where the one before it ends.
- An arc that ends in a vertex of its polygon ends on its circle (the outer wall of the housing: 165 corners with radii from 54.999998 to 55.000002). Where another face cuts a round face between two of its vertices, the end lies on a chord, up to one chord tolerance inside the circle. `tools.ts` notes the same about circular edges.
- `sweep` is the angle between the two ends about the centre, taken along the loop.
- The exact corner of two spans is the crossing of their exact shapes (a line and a circle, two circles). Computing it is left to the writer of an outline (2g), which is the caller that needs outlines closed in exact arithmetic; a reader of the section gets the corner within the chord tolerance, and is told so in `returns`.

**The other shape, `outline: 'polylines'`,** gives every loop as the polygon the mesh has. It is what a renderer fills and it matches the clipped mesh exactly, which rebuilt arcs would not.

**The limit** is `maxPoints`, 500 by default, a budget counted in items of the answer: a span is one, a point of a curve or of a polyline is one, a loop written as a polyline is one.

- The bodies are taken in their order. First the outline of a body (its spans, or with `polylines` its loops): if it does not fit, the body is listed with its area and the number of its loops only. Then the points, list by list (a curve, or a loop of a polyline): a list that does not fit is left out whole, a curve keeps its count and length, and a later, smaller list may still fit.
- `truncated` says how many items were listed of how many (`Truncated` of the preparatory step).
- The answer is therefore bounded by `maxPoints` plus three numbers and at most one face in `inPlane` for every body asked about. With `maxPoints: 0` it is the bodies, their areas and the numbers of their loops.
- On the joint at z = 40 the default takes the 19 spans and the 270 points of the teeth of the sun, the first curve that fits: 289 of 2224. One planet alone (2 spans and 405 points) fits the default; the ring gear needs the budget raised.

**What the app needs for the filled cut:** the frame, and all regions with their loops as polylines. One `fills` entry per region, the outer loop first. The view asks with `outline: 'polylines'` and a budget of a million (`prepare` of the view of 1b). A cut is filled only from a complete answer: a region filled without one of its holes would show material across a cavity. An answer that was truncated all the same is clipped, not filled, and the panel says so (`completeRegions` in `calls.ts`, which 1f uses as well).

**Deferred.**

- A section by more than one plane (a stepped or a quarter section), and a section of a slab between two planes.
- The picture of a cut model for the AI: package 1f, which takes the loops and the frame from this query.
- An outline as DXF or SVG: package 2g, a writer over the spans (a line and an arc are what those formats have), with the exact corners.
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
  viewport.ts          SceneModel.clip; what draws a body is clipped; pickBody ignores the cut-away side
  app.ts               the pick of edges ignores the cut-away side
  scene.ts             takes the additions of the view (1b)
```

- `cut(solid, frame, below)` is the pass: it classifies the vertices against the plane moved by `below`, makes one segment per crossed triangle directed so that the material is on its left seen against the normal, chains the segments by the edges they end on, and drops the points that are not corners. The point on an edge is computed from its two vertices in a fixed order, so both triangles of the edge get the same numbers.
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

`viewport.ts` is written by this package and then by 1f; it is not among the shared places of the plan (see "Order inside the track" of 1b).

## What the app shows

The generic form of 1b with a view of its own (`QUERY_VIEWS.section`; `calls.ts` writes it).

- **The form**: the plane (a base plane or a plane feature from a choice, or a planar face or a plane selected in the view), the offset, the flip, the bodies. What the view adds to the question (polylines, the budget) never shows in the form: the view is handed the arguments of the form, and the two buttons that step the offset ask with those.
- **While the answer is shown** the view cuts the model: what lies on the side the normal points to is not drawn, the cut is filled per region and outlined. The panel lists the bodies with their areas, says which bodies have a face in the plane, and has two buttons that step the offset and ask again. Closing the answer, moving the marker elsewhere or a change of the document ends the cut, by the life of an answer in 1b.
- **In the viewport**: `SceneModel` gets `clip`.
  - Everything that draws a part of a body is clipped by that plane: the material of the bodies (drawn two-sided while the clip is set, because a cavity would otherwise show through its culled back faces), the edges of the bodies, and the highlight of a hovered or selected face or edge. For the lines: by the material if the line material of three.js honours a clipping plane (to check in the implementation), otherwise the scene builder cuts the segments by the plane before it hands them over.
  - The fills and the outline of the section lie in the plane itself and are not clipped. The fill is drawn so that it wins over a face of a body that lies in the same plane (a polygon offset).
  - Nothing that is cut away can be picked. `pickBody` skips hits on the cut-away side. The edges are picked elsewhere, in `App.pick`, from the segments of `body.edges`: that loop cuts each segment by the same half-space before it projects it. Without this an edge that is not drawn could be hovered and selected, and with its body cut away it would even pass the test that nothing lies in front of it.

## Needs from the preparatory step

None of its own. It uses the two stand-ins of 1b (the units of a result, and `failed` where the caller made the mistake: none arises here).

## Rejected

- **`slice` of Manifold behind the kernel port.** It loses the face of every segment, which is half of the answer, and cuts only across Z. Reason of the backlog, confirmed in the types of the library.
- **The cut face as real geometry** (`trimByPlane` or a boolean with a half-space, then the new face). It needs the kernel, makes a face that has no name, and solves the splitting of a body (3d), not looking into one.
- **Points in the coordinates of the model.** Half as many numbers again, and neither the fill of the app nor an outline export wants them. The frame is in the answer for whoever does.
- **Only polylines, with a limit.** A section through a gearbox is thousands of points an AI cannot use, and the limit would cut off the circles that matter together with the teeth that do not.
- **Arcs fitted to the polygon** instead of read from the surface. A fit has a tolerance to choose and gets a filleted corner of a generated profile wrong; the surface is exact and already there.
- **The ends of an arc moved onto its circle.** The arc would then be exact in itself and would no longer start where its neighbour ends; the loop would have gaps of up to a chord tolerance. Joining comes first for a reader; the exact corner is computed where it is needed (2g).
- **Thinning a curve** to fit the budget. A thinned involute is no longer the profile; a count and a length are honest, and the caller can raise the budget for one body.
- **A vertex in the plane counts as above it, compared with the plane itself** (the first version). Total and simple, and wrong for a face in the plane of a body that is not aligned with the axes: see above.
- **A band of tolerance around the plane** in which a vertex counts as "in" the plane. It gives triangles that are neither crossed nor not, and with them open chains. Moving the plane keeps two states and has no such case.
- **A budget of points only**, with spans, loops and regions beside it (the first version). The answer then grows with the model whatever the argument says.
- **Capping in the renderer by the stencil buffer**, which fills a cut without any loops. The AI needs the loops anyway, and one computation for both is the point of the backlog.

## Open

- Whether a body the plane only touches in an edge or a corner should be said to be touched. Today it is simply not listed.
- The cut of a body the user has hidden is still filled: the view does not know what is hidden. To settle with the scene builder in the implementation (it knows, and can leave out the fills of hidden bodies if a fill carries its body).
- Whether the default budget should be larger. 500 fits one gear of the joint; the whole section at z = 40 has 2224 items.

## Reviews

### Round 1 (2026-11-15): first version

Two independent reviewers, read-only, at commit `b2fdf2d`: `codex` (gpt-6-astra, effort high) and an internal subagent; `agy` did not take part (out of quota). Who they were, what they covered and the findings on the track as a whole are recorded in [1b](../1b-measure/design.md). The internal reviewer reran the prototype of the pass on the model of scenario 9 and got the areas, the loops and the point counts of the first version, and added two experiments of its own (a turned body; the redundant points). The findings on this package, each checked against the code or by a run of the prototype:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| "A vertex in the plane counts as above" compares a float32 height with zero. A planet turned by 30°, 17° and 45° and cut in the plane of its end cap gave 67, 59 and 82 loops with half of the area | internal (major) | Yes: rerun, the same numbers | The cut is taken at the precision of the coordinates below the plane; rerun: 2 loops and 431.379 at the three angles. `inPlane` uses the same precision, which closes that open item |
| Half of the points of every loop are redundant (the point on the diagonal of a side quad), and the counts, the budget and the test expectations were calibrated on them | internal (major) | Yes: 5584 points, 2792 corners | The pass drops points that are not corners; every number in the design and in `calls.ts` restated from a rerun |
| The ends of an arc need not lie on the circle it states (an end on a chord where another face trims the cylinder); the design does not say which wins | codex (major) | Yes (`packages/mcp/src/tools.ts`, the note on arcs cut short) | Stated: the ends are points of the mesh and the spans join exactly; centre and radius are of the surface; the exact corner is left to 2g, with the reason |
| A truncated answer is filled as if it were whole: a region without one of its holes shows material across a cavity | codex (major) | Yes: the view ignored `truncated` | A cut is filled only from a complete answer (`completeRegions`); the panel says when it is not |
| `maxPoints: 0` still returns any number of bodies, regions, spans and `inPlane` entries | codex (major) | Yes | The budget counts spans and loops as well as points; a body that does not fit keeps its area and the number of its loops; `inPlane` has one face per body; the bound is stated |
| Clipped edges stay pickable: `pickBody` is fixed, but edges are picked in `App.pick` | both (codex: major) | Yes (`app.ts`, the loop over `body.edges`) | The pick of edges cuts by the same half-space; highlights are clipped too |
| `flip` "changes nothing else" is false: it turns which side "below" is | both | Yes | Stated in the contract and here; `calls.ts` has the case (the front face of the housing, seen from outside: no section) |
| The step buttons put the arguments the view prepared into the form; `panel.ask` is untyped | internal | Yes (a probe compiled `ask({ offset: 'x' })`) | 1b: a view gets the arguments of the form, and `ask` is typed by the query |
| 1f and the plan: `viewport.ts` is written by 1a and 1f | internal | Yes | Noted here and in the table of 1b |

Nothing was left without action. One thing changed that no reviewer asked for: `SectionOfBody` has the number of loops, and `regions` became optional, which the budget needs.

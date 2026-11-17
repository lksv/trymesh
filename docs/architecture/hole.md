# Architecture: the hole

Part of [architecture.md](../architecture.md), the design as implemented. The hole feature, its tool, the names of its faces, the hardware catalogs and the query that composes a hole from them (D46). The design with its alternatives and reviews is [d36/2c-hole/design.md](../d36/2c-hole/design.md).

## Hole (D46)

```ts
interface HoleFeature extends FeatureBase {
  type: 'hole';
  sketch: Id;
  points: Id[];          // own points of the sketch or `origin`; at least one, none twice
  shape: HoleShape;      // a variant by `type`
  extent: HoleExtent;    // a distance, or through all forward or backward
  targets: Id[];         // one or more bodies, none twice
  label?: string;        // free text, not empty, at most 200 characters; the name of the piece for the parts list (D57)
}
type HoleShape =
  | { type: 'plain'; diameter: number }
  | { type: 'counterbore'; diameter: number; headDiameter: number; headDepth: number }
  | { type: 'countersink'; diameter: number; headDiameter: number; angle: number }   // the included angle of the cone
  | { type: 'nutPocket'; diameter: number; acrossFlats: number; headDepth: number; rotation: number };
type HoleExtent = { type: 'distance'; start: number; distance: number } | { type: 'throughAll'; side: 'forward' | 'backward' };
```

One feature makes the same hole at every listed point, along the normal of the sketch plane, and cuts it out of every target with one tool. The head is at the mouth, where the extent starts.

**Document** (`features/hole.ts`).

- Every dimension is a numeric field `shape/<name>` and is required; none has a default. `FEATURE_TYPE_INFO.hole.fields` lists them by kind (`when: shape/type`), then `extent/start` and `extent/distance` for a distance. The sizes are positive; the angle lies strictly between 0 and π; the rotation has no range. `HOLE_SHAPES` names the fields of each kind in the order a form shows them; a field of another kind is an invalid command (`onlyFields`).
- The extent is validated by `extentOf` of `features/extent.ts` with `upTo: false`, a reason for no taper and a reason for no `both` (`noBoth`): a hole has a mouth. The registry lists no `extent/taper`, so `setField` cannot add one.
- The keys of the side faces inside the build separate the point from its part by a slash, which no ID of a point the hole takes holds (any other character may be in an ID, `|` included).
- References: the sketch; every point as an entity of the sketch (`accepts: ['point']`, `notProjected`), so a command refuses a point the sketch does not have, a curve, and projected geometry; every target as a body. On load only the shape of a reference is checked, as for every feature.
- `updateFeature` changes `sketch`, `points`, `shape`, `extent`, `targets` and `label`. A shape of the same kind merges by field; another kind replaces it whole, and the expressions of its fields go with it (`mergePatch` decides by `type`). `{ label: null }` removes the label and is accepted also where there is none.
- **The label in the parts list** (D57): the query `partsList` counts one piece of hardware per hole the model has, by the exact text of the label (the engine reads nothing out of it, D46); a feature without a label that made holes is listed apart. The holes are counted from the bores and heads (`holeBore`, `holeHead`) in the bodies that are not auxiliary, by their axes and how far along them they reach ([api.md](api.md), the parts list), so a point that missed or a hole cut away later counts nothing. The label `hardwareHole` gives is a start: what the catalog does not know (the length of a screw) is typed into it; the label of a plain clearance hole names the hole (`M3 clearance hole`) and is listed as it is.
- Registry: `createsBody: false`, `namesFaces: true`, `producesTool: true`, `bodies: 'none'`. No upgrade step: a build without the type refuses a document with it.
- Relations between the numbers are not a command's question (they may be expressions); the recompute checks them.

**Recompute** (the step of `features/hole.ts`).

1. The sketch from the state (`brokenReference` without it). Every point is an own point of the solved sketch or its origin; otherwise `brokenReference` with the point. The sketch needs no region and no valid profile.
2. The shape is checked (`invalidHole`, with a detail that gives the numbers): the head wider than the bore by more than `LENGTH_TOLERANCE` (for a nut pocket the bore narrower than the size across flats); a head deeper than `δ`, the resolution of the kernel adapter below (a head of 0.0005 mm, or the cone of a countersink of 179.9°, would be dropped by the adapter or cut more than the tool); for a distance, a bore below the head longer than `δ` (a counterbore 3 deep in a hole 3.00001 deep would lose its bore without an error), and a plain hole deeper than `δ`; `δ` is computed here from the targets before the feature and the sketch plane, and a copy of a pattern is not checked again; no two points closer than the largest diameter of the hole (for a hexagon the circle through its corners) plus the tolerance, with `refs` the two points. The depth of the head is `headDepth`, or for a countersink `(headDiameter − diameter) / 2 / tan(angle / 2)`.
3. The outlines in the coordinates of the sketch, computed once per step: every circle of the hole has the number of sides of its largest circle (`segments` of `sketch.ts` with the chord tolerance), starting at the X axis of the sketch; the hexagon has six corners, the first where `rotation` points. One region per point.
4. A recipe `{ operation: 'cut', targets, build }`. `build` places the sections of every point in the frame (transformed for a copy of a pattern; a mirrored copy is the mirror image, its flats run the other way round and `applyTool` turns the tool over, D53) and calls `buildStack` with the caches of the triangulations:

   | Shape | Sections from the mouth | Faces |
   |---|---|---|
   | plain | the bore | `holeBore` |
   | counterbore | the head (two rings of the head circle); a step; the bore | `holeHead`, `holeSeat`, `holeBore` |
   | countersink | the cone (the head circle at the mouth, the bore circle at the depth of the head); the bore, sharing that ring | `holeHead`, `holeBore` |
   | nut pocket | the hexagon; a step; the bore | six `holeFlat`, `holeSeat`, `holeBore` |

   The mouths are `startCap` and the bottoms `endCap`, one face each for all points; so is the seat.
5. `applyTool`, and the result by `toolResult` (`recompute/services.ts`), which the extrusion shares: the recipe is stored also when nothing changed; `noEffect` names the targets the tool missed; `emptyResult`, `kernelFailure` and `brokenReference` as for a cut.
6. `facts`: `depth` (the depth of the whole hole for the feature itself) and `headDepth` (absent for a plain hole).

**The depth and "through all".** For a distance the depth is `|distance|` and the mouth is at `start`, the direction the sign of `distance`. For `throughAll` the mouth is in the sketch plane and the depth is the reach of the targets on the side asked for, as `throughAll` of `recompute/extent.ts` measures it (the largest distance of a vertex of a target from the sketch plane on that side, zero when none lies there), without the overshoot. In `build`, per build and per copy:

- a plain hole is the reach and the overshoot long, the tool of an extruded cut;
- a hole with a head whose depth is below the reach by more than `δ = 1e-4 · max(1, c)` (`c` the largest coordinate of the targets and of the sketch plane, the resolution of the kernel adapter) is the reach and the overshoot long; the overshoot only lengthens the bore;
- otherwise the tool is as long as the head and the overshoot and carries the mark `refuseChange: { code: 'invalidHole', detail }` (`BuiltTool`, `recompute/state.ts`). `applyTool` applies it like any tool and then reads the mark: every target unchanged is the usual `noEffect` and the recipe stays for a pattern (a hole pointing away from its targets, whose mouth only touches them); a target changed is `invalidHole` with the changed targets in `refs`, and no body is changed, for the feature and for a copy of a pattern alike.

The case is decided by what the cut did, not by the size of the reach: the reach is measured on float32 meshes against a frame in doubles, so a target that ends in the sketch plane has a reach of noise (a millionth at a height of 33.4, more on a body a pattern turned), and a real target can be thinner than any threshold safe against that noise (a plate 0.005 thick 1000 away from the origin). The kernel tells them apart: a tool that only touches comes back with every target unchanged.

**Surfaces.** The bore and the head of a counterbore are cylinders about the normal through the point. The head of a countersink is a cone with the half angle `angle / 2`, its apex beyond the mouth along the hole at `headDiameter / 2 / tan(angle / 2)`, its axis pointing back towards the mouth. A flat is a plane through its first corner in the sketch plane (not at the mouth: as the side of an extrusion, a sketch on a flat stays when `start` changes), its `y` the normal of the sketch plane. The seat and the caps are planes at their levels with the origin and the Y axis of the sketch. So the mouth of a countersink (a plane and the cone), its lower rim (the cone and the bore, one ring of one tool), both rims of a counterbore and its seat with the bore are circles a sketch can project (`circleBetween`); the edges of a flat are lines.

**Issues.** `invalidHole` is the error of the step (step 2) or of the mark (a head as deep as the reach that cut a target, also one that would remove a target whole: `applyTool` reads the mark before it reports `emptyResult`); its text is "The dimensions do not make a hole." with the detail. The others are those of a cut.

**Limits.**

- The reach is that of the whole targets, not of the material under each point: a head that passes through a thin plate of a body that reaches deeper elsewhere (a lid with a lip) is not detected; the feature is fine, the face `holeSeat` is in no body, and a sketch on it is a `brokenReference`. The same holds for a head deeper than one thin target when another target reaches further.
- Where a target passes the sketch plane by its own rounding or by a tilted face, a hole "through all" away from it cuts that sliver: a headed hole is then `invalidHole` and a plain hole removes the sliver, as an extruded cut from that plane does.
- A head that lies wholly outside the targets with "through all" (a sketch plane 5 above a plate 10 thick, a counterbore 3 deep backward) is not detected: the reach of the targets is 15 and passes the rule, the bore cuts the plate, and the head and the seat are in no body. The hole is `ok` and says nothing; no issue code fits it (it is no error of the dimensions, and `noEffect` means an unchanged target). The same for a head that ends in the air above a target.
- The checks against `δ` of a blind hole are made for the feature itself; a copy of a pattern far from the origin has a larger `δ` and is not checked again.
- Every point of one feature gets the same hole; points of projected geometry are not taken (a point with a `coincident` to the projected one follows it). No `upTo`, no taper, no direction other than the normal of the sketch plane.

## The hardware catalogs (D46)

Five catalogs in `catalogs/hardware.ts`, one per source, each a `DataCatalog` with its row type ([api.md](api.md), "Data catalogs"):

| Catalog | Columns | Key | Primary source | Check |
|---|---|---|---|---|
| `clearanceHoles` | `thread`, `fine`, `medium`, `coarse` | the thread, "M3" | ISO 273:1979 as reproduced identically in IS 1821:1987 | German Wikipedia, "Durchgangsbohrung" |
| `socketHeadScrews` | `thread`, `headDiameter`, `headHeight` | the thread | ISO 4762:2004, Table 1, as reproduced identically in IS 2269:2006 | fasten.it, DIN EN ISO 4762 (06-2004) |
| `countersunkScrews` | `thread`, `headDiameter`, `headAngle` (radians) | the thread | fasten.it, DIN EN ISO 10642 (02/2020, that is EN ISO 10642:2019) | Westfield Fasteners, ISO 10642; for M3 and M4 the text of ISO 10642:1997 |
| `hexNuts` | `thread`, `acrossFlats`, `thickness` | the thread | ISO 4032:1999, Tables 1 and 2, as reproduced identically in IS 1364 (Part 3):2002 | fasten.it, DIN EN ISO 4032 (04-2013, ISO 4032:2012) |
| `heatSetInserts` | `thread`, `outerDiameter`, `length`, `holeDiameter`, `holeDepth` | the size as sold, `M<thread>x<length>x<outer diameter>` ("M3x3x4.5") | the hole rule of ME Design Lab, University of Wisconsin–Madison (diameter = outer diameter − 0.3 mm) and of CNC Kitchen (a straight hole, depth = length + 1 mm), over 20 sizes offered by shops on 2026-11-16 | 3D Printer Gear, Sovol |

- The sizes are M2, M2.5, M3, M3.5 and M4 where the source has them (the owner's range M2 to M4): ISO 273 and ISO 4032 list M3.5, ISO 4762 and ISO 10642 do not, so a socket head or a countersunk screw M3.5 is `notAvailable` and its clearance hole and nut are not. The inserts are 11 sizes of M3 (outer diameter 4.5 and 5) and 9 of M4 (5, 5.5 and 6).
- The heads and the nut are the largest sizes the standards allow, because a pocket has to take the largest part: for a socket head the maximum of a knurled head (ISO 4762 gives a smaller one for a plain head), for a countersunk head the theoretical maximum (the diameter of the sharp cone at the bearing face, which the gauge of the standard uses) and the angle of 90° (the standard allows 90° to 92°), for a nut the size across flats (nominal = maximum) and the largest thickness. The clearance holes are the nominal values of the series.
- The inserts have no standard: their `source` says that the values are typical for unbranded inserts and that the hole is to be tried in a test print. Branded inserts with a smooth pilot (CNC Kitchen, ruthex) take a hole about 0.6 to 0.7 mm under their outer diameter; the rule is stated for the knurled unbranded ones.
- ISO 4032:2023 moved the sizes below M5 into an informative annex; the catalog names the editions read. A 2026 edition of ISO 10642 exists whose tables were not seen.
- `source` of each catalog names its primary table and its check. For the four standards every number was compared with the check and there was no difference in the columns used. For the inserts the check differs: 3D Printer Gear recommends the same hole as the rule at an outer diameter of 4.5 and one 0.1 mm smaller at 5 (M3, 4.6 against 4.7) and at 6 (M4, 5.6 against 5.7); Sovol's range (0.1 to 0.3 mm under the knurl) holds the rule; for M4 with an outer diameter of 5 and 5.5 no second source was found, only the general rule applies. The `source` of the catalog says so. No number comes from memory.
- `packages/engine/test/hardware.test.ts` pins the rows and checks what holds without a source: every column grows with the thread, `fine < medium < coarse`, a head and a nut are wider than their thread, the key of an insert is what its row says, its hole is wider than its thread, narrower than the insert and deeper than it is long.

## The query `hardwareHole` (D46)

`query/hardware-hole.ts`, an entry of `QUERIES`; it reads no state.

- **Arguments**: `use` (`clearance`, `socketHead`, `countersunk`, `nutPocket`, `heatSetInsert`), `size` (a key of the catalogs), `fit` (the clearance series, `medium` when left out), `allowance` (an expression added to every diameter and to the size across flats; its syntax is checked, `invalidArguments` otherwise).
- **Answer**: `shape` in the input form of a hole shape (numbers, or `"<number> + <allowance>"` with an allowance), `label` ("M3 countersunk screw"), `depth` for an insert, `from` (the catalogs used).
- It looks at `use` first and asks only the catalogs that use reads:

  | Use | Shape | From |
  |---|---|---|
  | clearance | plain: the clearance hole of the series | `clearanceHoles` |
  | socketHead | counterbore: the clearance hole, the head diameter, the head height as the depth | `clearanceHoles`, `socketHeadScrews` |
  | countersunk | countersink: the clearance hole, the head diameter, the head angle as `deg(…)` | `clearanceHoles`, `countersunkScrews` |
  | nutPocket | nut pocket: the clearance hole, across flats, the thickness as the depth, rotation 0 | `clearanceHoles`, `hexNuts` |
  | heatSetInsert | plain: the hole diameter; `depth`: the hole depth | `heatSetInserts` |

- The angle of a countersink always comes back as an expression in degrees: the tool `query` prints numbers rounded to six decimal places, which an angle in radians rarely survives.
- A size a catalog does not have is `notAvailable` with the argument `size`; the message names the catalog and the sizes it has.
- MCP reaches it through the tool `query`; the form of the hole in the app calls it with the button *Fill from the catalog* ([ui/hole.md](../ui/hole.md)).

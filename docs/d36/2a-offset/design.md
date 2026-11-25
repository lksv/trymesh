# 2a Profile offset and a wall from a line (D44)

**State: implemented and merged into `master` (2026-11-15); see "As implemented" for where the code differs from this design.** The design below is its fourth version, after three rounds of reviews, the last allowed ("Reviews"; what is still open is listed there as known limits). Written against the sixth version of the contract of the preparatory step ([00-prep/contract.ts](../00-prep/contract.ts)) and against the code at `0dc424b`. Nothing here was run as engine code; statements about today's code name the function they were read in.

Files: [contract.ts](contract.ts) (what the package adds, and the one declaration of the changed extrusion that track B shares), [calls.ts](calls.ts) (its part of validation scenario 12).

The package is the first of track B (2a, 2b, 2c; 2f beside them). It decides three things for the whole track: the shape of the shared declaration, what a profile hands to a tool build, and whether tool builds and extents become modules of their own.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Profile offset" and the row "Wall from a line", propose: an optional numeric field `profile/offset` on a profile of regions, computed per curve with mitre joins so that side faces keep their names; `invalidProfile` when a curve vanishes or loops meet; not for a generated profile; a wall from a line as an extension, a profile from an open chain of curves offset to both sides.

| Statement of the backlog | What the code says |
|---|---|
| "An optional field does not change the document shape" | True for the profile source, and stronger: `profileSource` (`document.ts`) refuses a field its variant does not list (`PROFILE_FIELDS`) and a type it does not know, so a build without the package refuses such a document by itself and no upgrade step is needed. An optional numeric field is new, though: every numeric field of today is always present, and `setField` only takes the address of a field the feature has (`fieldsOf`). See "An optional numeric field" |
| "`ResolvedProfile` already has the form this needs (regions plus `curveOf`)" | Half true. `Region` holds loops as polylines with a curve ID per edge (`Loop` in `sketch.ts`); the exact curves (`Shape`: line, arc, circle) live only inside `detectProfile`. An offset per curve needs them, in the order and direction of the loop. `curveOf` gives a shape by curve ID, which is enough for the surfaces of the side faces and not for the joins |
| "Every curve maps to exactly one curve, so side faces keep their names" | True for the outline of the selection, with one condition the backlog does not state: the offset has to be applied to the selected regions taken together. `buildPrism` (`solid.ts`) drops a curve shared by two selected regions; offsetting each region on its own would make the two overlap across that curve |
| The wall is "an open chain of curves offset to both sides" | `RegionRef` names a closed region by the curves of its outer loop and cannot name a chain. A curve of a chain makes two side faces, and `FaceName` of the role `side` has one `curve`, so the two would share a name. An open non-construction line that ends on another curve makes the profile of the whole sketch invalid (`compatible` in `sketch.ts` allows contact at joined points only) |

## The cheap variant

- **Offset.** `offset?: number` on the profile source `regions` (field `profile/offset`, millimetres, either sign, an expression allowed). The outline of the selected regions is moved curve by curve and joined by mitres. Topology never changes: a curve that vanishes, neighbours that no longer meet, loops that touch, cross or change their nesting are the error `invalidProfile`, with a text that names the curves.
- **Wall.** A third variant of the profile source, `{ type: 'wall', sketch, curves, thickness }`: own curves of the sketch that form one chain, offset by half the thickness to each side. An open chain gets straight ends; a closed chain (a circle, a closed loop) gives a band with a hole. The source reads solved curves and needs neither regions nor a valid sketch profile, so the centre line of a rib is a construction line.
- **Unchanged when not used.** A profile of regions without an offset (the field absent or exactly zero after its expression is evaluated) takes the code path of today; the mesh of every existing document stays what it is.
- **For every feature that takes a profile.** Both live in the profile service of the preparatory step, so the revolve of 4a gets them without importing the extrusion.

**Deferred**, none blocked by the design:

- Curves that drop out. An inward offset larger than a corner radius has a natural result (the arc is gone and its neighbours meet in a sharp corner); here it is an error. This is the limit most likely to be hit: the cavity of a box with rounded outer corners needs a corner radius larger than the wall. The taper of 2b cannot drop curves at all (it pairs the curves of two profiles one to one), which is why the two share one rule for now. See "Open questions".
- Round joins and a mitre limit. A sharp convex corner moves by `offset / sin(half the corner angle)`; nothing caps it. Round joins add corner faces that need a name.
- An offset of a generated profile (its sides are polylines without source curves).
- A wall to one side only or shifted off its chain, rounded ends, projected curves in a chain, a rib that grows until it meets the body (a wall here has an explicit extent like any extrusion).
- The offset as geometry inside the sketch that can be dimensioned against (step 6, needs the solver).

## Document

```ts
type ProfileSource =
  | { type: 'regions'; sketch: Id; regions: RegionRef[]; offset?: number }
  | { type: 'generated'; ... }                                    // unchanged
  | { type: 'wall'; sketch: Id; curves: Id[]; thickness: number };
```

- `PROFILE_FIELDS` gets `offset` for `regions` and the list of `wall`; a generated profile with an offset stays an invalid command.
- `curves` of a wall is a non-empty list of curve IDs, stored sorted and without duplicates (the order of the chain is derived from the joins, like the holes of a region). A command verifies each curve the feature did not have before: it has to be an own curve of the sketch (a line, an arc or a circle; construction or not). Whether the curves form a chain shows in the recompute, because it depends on solved positions.
- References: `profile/sketch` as today; one reference of the kind `entity` per curve of a wall, at `profile/curves`, with `accepts: ['line', 'arc', 'circle']` and a new flag `notProjected: true` on `FeatureRef`: the entity is not projected geometry (an own curve; for a point, an own point or the origin; `Entity.own` of `entityOf` is another thing, false for the origin). It is checked in `requireRef`, which the preparatory step moves to `features/index.ts`. Today `requireRef` takes a projected curve for an entity of the kind `line` (`entityOf` answers for `sketch.external` as well); a generator operand wants that, a wall does not, because the ends of its faces are named by sketch points and a projected line has derived ones (`<id>/a`). The points of a hole (2c) use the same flag.
- `updateFeature` merges a variant with the same `type` by field (`mergePatch`), so `{ profile: { offset: 2 } }` sets the offset; `{ profile: { offset: null } }` removes it, also from a feature that did not have it (`removable` of the extrusion gets the path). Another `type` replaces the profile and has to be complete, as today.
- Numeric fields in the registry (`FEATURE_TYPE_INFO.extrude.fields`): `profile/offset` when `profile/type` is `regions`; `profile/thickness` (positive) when it is `wall`.
- Face names: a wall adds two roles, `wallSide` (`curve`, `side`) and `wallEnd` (`point`); see "Faces of a wall". An offset adds none.
- No upgrade step, no command, no query, no section of the document.

### An optional numeric field

`profile/offset` is the first numeric field of a feature that may be absent. (Parameters of a generator may be left out of a command, but the validator then stores the default, so the document always has them.) The same rule serves `extent/taper` of 2b and `extent/gap` of 2f.

- **Absent means the default, and the default is not stored.** Storing `offset: 0` in every profile of regions would rewrite every extrusion of every document on load and change what the tests and the snapshot of the app class compare. (Rejected alternative 7.)
- **What is given is kept.** `offset: 0` sent by a command stays in the document. Dropping it would break `updateFeature`, which requires every path a patch sets to exist in the validated feature (the check after `validated` in `applyCommand`). The two spellings of "no offset" compute the same.
- **The field is described once.** Its `NumberSpec` has `default: 0`; the rule "a field whose description has a default may be left out" is the one the generator catalog already states for its parameters. `describe_api` and the forms read it from there.
- **`setField` reaches it.** Today `setField` refuses an address `fieldsOf(feature)` does not list, so an AI could not put an expression on the offset of an extrusion that has none without knowing to use `updateFeature` instead. The check stays where it is, before anything is written, and takes one more set of addresses: the fields of the registry (`FEATURE_TYPE_INFO[type].fields`) whose description has a default and whose `when` holds for the feature. Every message of today stays (four tests match "is not a numeric field" for addresses that a validation would refuse with another text). This is one edit of the `setField` branch of `applyCommand`, a shared place of the plan; `calls.ts` (`offsetOnAndOff`) writes the case.
- **`default` has two readings, by where the field is.** For a parameter of a generator (a dictionary the catalog describes) the default is stored when the parameter is left out; for a field of a feature it is what an absent field means. `describe_api` prints "default 0" for both, and the paragraph for the AI says which fields may be absent.
- `fieldsOf` lists the field only while the feature has it; `expressions` may hold `profile/offset` only then, as for any field.

## Recompute

### What a profile hands on

`profile(id, source, state, chordTolerance)` of `recompute/profile.ts` keeps returning regions as polylines, the frame, and a description of the sides. Two things change in what it returns (internal types, not type-checked here):

```ts
interface ResolvedProfile {
  regions: Region[];
  frame: Frame;
  // was `curveOf(id): SideCurve`: the key is what `Loop.curves` holds for an edge. For regions it is
  // the curve ID and the name is `{ role: 'side', curve }`; a wall names its sides itself.
  sideOf(key: string): { name: Omit<FaceName, 'feature' | 'copy'>; shape: SideCurve };
  // The exact outline the regions were tessellated from, after the offset. Asked for by a tool
  // build that has to move it again (the taper of 2b). A generated profile has none.
  outline?: () => Outline | ProfileProblem;
  facts?: Facts;
  warnings?: Issue[];
}
// One closed loop as exact curves in the direction the loop passes them; the material is on the left.
type OutlineCurve = { key: string; forward: boolean /* passed in the direction of the sketch curve */ } & (
  | { type: 'line'; from: Vec2; to: Vec2 }
  | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number }   // sweep signed: positive counter-clockwise
  | { type: 'circle'; center: Vec2; radius: number; ccw: boolean });
interface Outline { regions: { outer: OutlineCurve[]; holes: OutlineCurve[][] }[] }
```

`buildPrism` changes little: its parameter `curveOf` becomes `sideOf`, and the three places that compose `{ feature, role: 'side', curve }` (for a line, a round and a general side) take the name from `sideOf(key).name`. The mesh it builds does not change, and for a profile without an offset neither do the names.

### The outline of the selection

`detectProfile` has the exact shapes of every loop while it builds the polylines: lines and arcs as the half-edges it walks (`polyline`), circles apart from them (`circleLoop`, for the region of a circle and for the hole it makes in the region around it). It gets to keep them: `Loop` gains an optional `exact: OutlineCurve[]`, filled in both places, with the vertex keys of its corners (generated loops have none). From the selected regions the outline is put together as the prism does it for side faces:

1. Take the curves of all loops of all selected regions. A curve that occurs twice (once from each of two selected regions) is dropped.
2. Chain the rest by their vertex keys. At a vertex with one curve leaving it the chain is unambiguous. Where several leave (regions that meet in a point), the chain follows the region it came along; if that curve was dropped as well, the profile is refused (`invalidProfile`: the regions meet in a point in a way the cheap variant does not untangle).
3. A loop with a positive area is an outer loop, the others are holes of the smallest outer loop that contains them (a point-in-loop test on one vertex, as `detectProfile` does for the holes of a region).

Why together and not region by region: a sketch that holds the outline of a box and the circles of its posts has the region "outline with holes" and one region per circle. The cavity wants the whole outline, so all of them are selected; region by region, the circles would grow into the region around them.

### The offset of a loop

Every curve moves to the right of its direction of travel by `d` (the material is on the left, so a positive `d` grows the profile, and holes, which run clockwise, shrink):

- a line becomes the parallel line;
- an arc or a circle keeps its centre; the radius grows by `d` where the centre is on the side of the material (a counter-clockwise pass) and shrinks by `d` otherwise.

The corner between two consecutive moved curves:

- tangent neighbours (directions at the corner equal within `ANGLE_TOLERANCE`): the old corner moved by `d` along the common normal. This is the rounded rectangle; no intersection is computed, because a tangent contact is a double root;
- two lines: the intersection of the moved lines;
- a line and a circle, or two circles: of the two intersections of the moved carriers, the one on the branch of the old corner (for a line and a circle the same one in the order along the line; for two circles the one on the same side of the line of centres). That is the corner that moves continuously with `d`. The two candidates mirror each other about an axis the offset does not move (the perpendicular from the centre to the line; the line of centres), so it is also the one nearer to the old corner; the branch needs no distance.

Refused with `invalidProfile`, `refs` naming the curves:

- a radius that is not above `LENGTH_TOLERANCE`;
- neighbours whose moved carriers do not meet;
- a curve that turned round or has no length: a line whose new ends are not in the old direction by more than the tolerance; an arc whose new sweep (the old one plus the change of its end angle less the change of its start angle, each within half a turn) has lost the sign of the old one, is shorter than the tolerance along the arc, or exceeds a full turn. The sweep is signed (a clockwise arc is negative); `segments` gets its size.

Then the moved outline is tested. First as a sketch profile is, by the two checks `detectProfile` runs, exported from `sketch.ts` for a set of exact loops:

- on the exact curves: two curves may touch only at a corner they share (`compatible`);
- after tessellation: no two edges cross and no loop has fewer than three points (`soundTessellation`).

Those two are not enough, for a moved outline or for a sketch (the reviews found the cases in today's `detectProfile`; "Reviews"): `soundTessellation` looks for proper crossings only, where the ends of each edge lie strictly on opposite sides of the other. An edge that ends on another one, passes through its end or runs along it is not a crossing to it. So the polylines that will be built get three more tests, in this order:

- **clearance:** any two tessellated edges that do not follow each other in one loop are farther apart than `LENGTH_TOLERANCE` (the distance of two segments, which is zero when they meet in any way: at an end of one of them and along a common stretch too); and of two edges that do follow each other (the last and the first of a loop included), the other end of each is farther than the tolerance from the other edge, so neither folds back onto its neighbour. "Follow each other" is by position in the loop, not by a common vertex key: every corner of a moved outline is a vertex of its own, also where the outline of the sketch passes twice through one point (two regions that meet in a corner give a loop that does), so a loop that returns to a place it has been is refused here, and two different loops share no vertex. It runs as the sweep of `soundTessellation` does, with the distance in place of the test of sides and with the boxes that prune its pairs widened by the tolerance (the sweep of today compares only edges whose boxes overlap). After this test every loop is a simple polygon and no two loops have a point in common. An edge shorter than the tolerance fails it as well; only an arc of a radius within about 1.3 tolerances has such edges;
- **area:** every tessellated loop has the sign of area of its exact loop, and an area above `LENGTH_TOLERANCE` times its length. A sliver between an arc and its chord tessellates into points on one line, which the clearance refuses already (its edges fold back); the test stays for the sign, which a loop that is simple can still have lost against its exact loop;
- **nesting:** for every pair of tessellated loops "lies inside" is what it was for the exact loops before the offset, tested with one vertex of the one against the polygon of the other. One vertex decides because of the clearance: two simple polygons without a common point are either nested or apart. (The second version of this design relied on "they do not cross" from `soundTessellation`; a review built a hole that passes through an edge of its outer polygon at two of its own vertices, with one vertex inside.) This catches a hole that grew past its outer loop without touching it (the outer loop shrank inside it), and a small hole that lies inside an exact circle and outside its polygon, between two of its corners.

A profile that fails any of them is `invalidProfile`. What passes hands `buildPrism` simple polygons, none without area, none touching another, and every hole inside its outer loop.

The moved outline is tessellated with the rule of today (`segments` of `sketch.ts`, by the new radius), every vertex with a key of its own, and handed to `buildPrism` as regions with their holes. `sideOf` answers with the moved curves in the direction of the sketch curve, so the surfaces are exact: the plane of a moved line, a cylinder with the new radius.

One consequence to state in the docs: the frame of a sketch on a side face has its origin at the start point of the line (`faceFrame`, architecture/naming.md, "The plane of a sketch on a face"). For a moved line that is the mitred corner, so it moves with the offset.

### The wall

1. The curves are looked up among the own curves of the solved sketch; a missing one is a `brokenReference` (as a missing operand of a generator).
2. They are chained by joined end points. The joining of points (the same point, or a satisfied `coincident`) is the rule of `detectProfile` and becomes a function of `sketch.ts` that both use. Refused with `invalidProfile` and a text: a curve without length, a point where three of the curves meet, curves that are not connected, a circle together with anything else.
3. An open chain is walked from the free end with the smaller vertex key; a closed one counter-clockwise. The chain is moved by `+thickness / 2` and by `−thickness / 2` with the offset of a loop above (for an open chain the first and the last curve have one neighbour only).
4. Open: the loop is the right side forwards, a straight end, the left side backwards, a straight end. Closed: the right side is the outer loop and the left side, reversed, its hole.
5. The same checks as for the offset. A chain that crosses itself, or whose two sides cross at a tight bend, is refused there.

### Faces of a wall

| Face | Name | Surface |
|---|---|---|
| a side from a line | `{ role: 'wallSide', curve, side }` | plane |
| a side from an arc or a circle | the same | cylinder |
| a free end of an open chain | `{ role: 'wallEnd', point }` | plane |
| caps | `startCap`, `endCap` | plane |

`side` is `left` or `right` of the curve in its own direction: a line from its point `a` to `b`; an arc and a circle counter-clockwise, so `left` is the side of the centre. The name therefore depends on the sketch curve alone, not on the order of `curves` or on the end the chain is walked from, and adding a curve to the chain renames nothing. `point` of an end is the point the end curve names (`a`, `b`, `start` or `end`), an own point of the sketch or `origin`.

The validator of a face name checks a part of the kind `text` as a text, so `side: 'top'` is a well-formed name of a face that does not exist: a broken reference, like a `side` with a curve the feature never had.

## Tool builds and extents as modules

The preparatory step left this to the first package that changes them ([part2-feature-modules.md](../00-prep/part2-feature-modules.md), "Open").

- **Tool builds: a module each, under `recompute/`.** After track B and 4a there are three: the prism of today (any regions, a per-curve description of the sides), the stack of sections of 2b (needs the exact outline; the taper, the hole of 2c and later the chamfered ends of an extrusion) and the revolve of 4a. They share only what they return, which is `Prism` today and is renamed `BuiltTool` (a solid and its new faces) in `recompute/state.ts`, next to `ToolRecipe`. This package does the rename and moves `buildPrism` to `recompute/tool-prism.ts` as it is, in a commit of its own with nothing else in it; 2b adds `recompute/tool-stack.ts`. `solid.ts` keeps what is about bodies: transforms, `analyzeBody`, the kinds of edges, frames, projection.
- **The prism stays, beside the stack.** The stack could build a straight prism too, but with other triangles. Keeping the prism for everything without a taper leaves the meshes of existing documents and the pinned fuzz seeds alone, and it is the only build for a generated profile.
- **The extent becomes a service on both sides, like the profile; it is not split by variant.** The hole of 2c takes an extent "like a cut" and the revolve takes none, so the validation of an extent cannot stay inside the validator of the extrusion. `features/extent.ts` gets the document half (the variants, their numeric fields, their references, what a patch may remove), moved out of `extrudeFeature` unchanged; `recompute/extent.ts` (which the preparatory step creates for `toolSpan`) keeps the recompute half. Three variants of a few lines each do not justify a file per variant. Who may use which variant and which field (no taper for a hole) is an argument of the validator.

The two moves are the first commits of 2a's implementation and change no behaviour.

## Where the code lives

After the preparatory step ([part2-feature-modules.md](../00-prep/part2-feature-modules.md)):

| File | What 2a does there |
|---|---|
| `types.ts` | `ProfileSource` (the field and the variant), two members of `FaceName`. Their comments are what the AI reads |
| `features/profile.ts` | validation of `offset` and of `wall`, `PROFILE_FIELDS`, the references of a wall, what a patch may remove, the two field descriptions |
| `features/extrude.ts` | two lines in `info.fields` |
| `features/extent.ts` | new, by a move without change (above) |
| `recompute/outline.ts` | new: `Outline`, the outline of a selection, the offset of a loop, the chain of a wall, tessellation |
| `recompute/profile.ts` | the branches for an offset and for a wall; `sideOf`; `outline` |
| `recompute/tool-prism.ts` | new, by a move (above); `sideOf` in place of `curveOf` |
| `recompute/state.ts` | `Prism` becomes `BuiltTool`; the two new members of `ResolvedProfile` |
| `sketch.ts` | `Loop.exact`; the joining of points, `segments` and the checks of an outline exported, with the three new ones |
| `validation.ts` | `notProjected` on a reference to an entity; the two entries of `FACE_ROLES` |
| `features/index.ts` | `requireRef` checks `notProjected` |
| `document.ts` | the `setField` branch of `applyCommand` |
| `packages/mcp/src/api.ts` | a paragraph of `CONVENTIONS`: the offset and its sign, the wall and its face names |
| `packages/app` | below |

## The app and MCP

- **MCP** needs no code: the fields are in the registry, the types in `types.ts`, the roles in `FACE_ROLES`. `get_sketch` lists the curves an AI names in `curves`.
- **The extrusion form** (`features/extrude.ts` of the app after part 3; `extrudePanel` today):
  - for a profile of regions a field "Offset (mm or an expression; positive grows the profile)". It is empty while the draft has no offset, and emptying it removes the field;
  - the select of the profile source gets "Wall along curves". The form then shows the number of chosen curves, a button that clears them and the field "Thickness". A click in the view toggles the curve of the sketch nearest to the point where the pointer meets the sketch plane: the form already gets that point (it finds regions with it), and `hitCurve` of `sketch-view.ts` is the hit test the sketch mode uses;
  - `changeExtrude` and `ExtrudeChange` (`sketch-commands.ts`) get `offset`, `curves` and `thickness`; `ProfileKind` gets `wall`, so the form remembers the wall of a draft like its regions.
- The table of role texts of the app (`ROLES` in `issue-text.ts`) gets two lines; the compiler asks for them.

## Issue codes

None new.

| Code | When |
|---|---|
| `invalidProfile` | the offset or the wall cannot be built; the message is the package's own and names the curves, as a generator's is today (the general text of the code is about crossing sketch curves) |
| `brokenReference` | a curve of a wall is not in the sketch any more |
| `noProfile` | as today: a selected region is not in the sketch |

## Shared vocabulary

- **Takes:** `FeatureTypes` and `FeaturePatches` (the changed extrusion), `FaceRoles` and `FACE_ROLES`, `PlaneRefAfter` and `setSketchPlane` for a sketch on a wall face, the profile as a service on both sides.
- **Adds:** `extrude` in `FeatureTypes` and `FeaturePatches` (owned here for track B); the roles `wallSide` and `wallEnd`; inside the track the two interfaces `DistanceExtentFields` and `ExtentVariants` that 2b and 2f extend.

## Rejected alternatives

1. **`CrossSection.offset` of Manifold** (the first idea of the backlog). It works on polylines: the identity of curves is lost, and with it the face names and the exact surfaces; convex corners get arcs without a source curve. It would also widen the kernel port.
2. **A polygon offsetting library.** A new third-party library needs the owner's approval (D2) and has the same loss of identity. Not assumed.
3. **The offset as a field of the extrusion** instead of the profile source. The revolve would not get it, and a field directly on a feature is dropped by an older build without a word, so it would need an upgrade step.
4. **The offset of each selected region on its own.** Refuses or distorts the common case of an outline with inner curves in the same sketch (above).
5. **Round joins.** Equal to mitres for tangent corners; elsewhere they add a face per corner that has no source curve to be named by.
6. **"The nearest intersection" for a corner.** It picks the same corner as the branch rule (above); the branch rule is kept because it compares no distances.
7. **Storing the default** (`offset: 0` in every profile). See "An optional numeric field".
8. **A wall as a feature type of its own** (`rib`). It is a profile: as a source it gets every extent, the taper of 2b, patterns and later the revolve for nothing.
9. **A wall as a mode of `regions`** (the band between an outline and its offset). `RegionRef` cannot name an open chain, which is the case a rib needs.
10. **Sides of a wall named by the direction of the chain** (`left` of the walk). The walk starts at an end chosen by a rule; extending the chain at that end would swap every name.
11. **An open chain named by its two end points.** Ambiguous where two paths join them, and a point says less than the curves when one is removed.
12. **Projected curves in a chain.** Possible later; the ends would be named by derived points, and nothing in the scenario needs it.

## Open questions

- **Curves that drop out: decided by the owner on 2026-11-15.** An inward offset that makes a curve vanish stays an error, as designed. The message of `invalidProfile` names the curves that vanished and says what to do about it: a corner radius larger than the offset, or the inner outline drawn in the sketch. An AI that builds the model through MCP corrects itself from such a message.
  - The alternatives put to the owner: the error (chosen); a general loop that removes vanished curves and joins their neighbours, also in a chain (rejected for a proof of concept: neighbours need not meet, and one vanished curve may make the next vanish); and the narrow case only, an arc tangent to both its neighbours that is dropped and its neighbours joined in a sharp corner.
  - The narrow case is recorded in [backlog.md](../../backlog.md) ("Profile offset"), to be done when a real model runs into the limit. It is local to the function of the offset. What it brings with it: the offset and the taper of 2b then differ (a taper pairs the curves of two profiles one to one and cannot drop any), and the face of a dropped arc is gone, so a sketch on it ends in `brokenReference` when a parameter crosses the limit.
- Whether the mitre needs a limit. Left until a model runs into a spike.
- The text of `invalidProfile` for an offset is in English like every new message; the general text of the code stays Czech until its line changes.

## Needs from the preparatory step

- None for the contract of parts 1 and 4: the scenario is written with the six maps as they are.
- A note for part 2, not a change: `FeatureRef` gets the flag `notProjected`, checked in `requireRef`, and `ResolvedProfile` the two members above. All are in files part 2 creates (`validation.ts`, `features/index.ts`, `recompute/state.ts`); the package edits them after the move.

## For the plan

What the maps of [the plan](../README.md) do not have yet; the session that owns it decides.

- **Shared places.**
  - `sketch.ts` is listed for 2d and step 6; this package adds `Loop.exact` and exports four things from it. 2d (re-pointing an end of a curve, a fillet of a corner) changes what the `curves` of a wall and the `point` of a `wallEnd` refer to, as it does for regions.
  - `applyCommand` is listed for 2d, 3a and 5a; this package edits its `setField` branch.
  - `ToolRecipe`, `Prism` and `applyTool` (`recompute/state.ts`, `recompute/services.ts`) have no row. Track B renames `Prism` (here), lets a build fail with a code (2f) and shares the handling of an `Applied` (2c); the pattern of 2e and the revolve of 4a use all three.
- **A finding in today's code**, outside the package: `detectProfile` accepts a region whose polyline has no area, a hole that lies outside the polygon of its outer circle, and a hole that passes through an edge of its outer polygon at its own vertices ("Reviews", both rounds; each was reproduced against the code of today). The three new tests are written for moved outlines; applying them to every sketch profile changes which sketches are valid and is a fix of its own, with its regressions in `review.test.ts`.
- **Numbers.** D44 to D47 and scenario 12 are in the brief; the table "Numbers" of the plan still gives 11 as the next scenario.

## Tests the implementation owes

- Engine: the offset of a rectangle, of a rounded rectangle (tangent joins), of a D shape (an arc meeting a line at an angle, both branches), of an outline with holes, of a selection with a shared curve; every refusal above, with the sliver, the small hole and the hole through an edge at its own vertices of the reviews for the three tests on the polylines; `offset` then `−offset` gives the outline back (a property test over random convex and L-shaped outlines); the wall of one line, of an L, of an arc, of a circle; `setField` on an absent field; the patch that removes it.
- `review.test.ts` of the engine: the mesh of an extrusion without an offset is byte for byte what it was.
- Scenario 12 in `packages/scenarios`, from `calls.ts` of the four packages.

## Reviews

### Round 1 (2026-11-15): the four designs of track B together, at `0839139`

Two reviewers got the same brief, read-only: `codex` (gpt-6-astra, effort high; 14 findings over the four packages) and an internal subagent (15, with probes against the real engine, kernel and compiler, and numeric scripts). `agy` did not take part: its account is out of quota. Every finding was checked against the code before it was acted on. The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The checks of a moved outline can pass polylines that are not sound: a sliver between an arc and its chord tessellates into points on one line (no crossing, no area), and a small hole inside an exact circle can lie outside its polygon. Both reproduced against today's `detectProfile` | codex, blocker | Yes (`soundTessellation` refuses fewer than three points and proper crossings, nothing else) | Two tests on the tessellated loops, area and nesting; the nesting is tested on the polylines, not on the exact loops. The same gap in every sketch profile is under "For the plan" |
| The refusal "the new sweep is not positive" rejects every clockwise arc, whose sweep is negative by the design's own type | codex, major | Yes | The sweep keeps its sign; `segments` gets its size |
| `setField` moved behind the validation changes the message of four tests that match "is not a numeric field" (`pattern.test.ts`, `generated.test.ts`, `parameters.test.ts` twice) | internal, minor | Yes (read in the tests) | The check stays in front and takes the optional fields of the registry as well |
| "The nearest intersection is wrong for large offsets" is false: the two candidates mirror each other about an axis the offset does not move (no difference in 160 000 computed cases) | internal, factual | Yes | The claim is gone; the branch rule stays for another reason |
| "`buildPrism` changes in one line" | both, factual | Yes: three places compose the name, and the parameter changes | Reworded |
| "`detectProfile` walks every loop as half-edges": circles are not half-edges | internal, factual | Yes (`open` filters them out; `circleLoop`) | Reworded; `Loop.exact` is filled in both places |
| The flag `own` means something else than `Entity.own` (false for the origin), and it is enforced in `requireRef`, which moves to `features/index.ts`, not in `validation.ts` | both, minor | Yes | Renamed `notProjected`; the file is in the table |
| Who renames `Prism`: this design said it, and the file table of 2b said 2b | internal, minor | Yes | This package |
| `NumberSpec.default` gets a second reading | internal, minor | Yes | Said in "An optional numeric field" |
| The reason "unreadable for an older build" for not storing the default stops holding once 2b raises the version | internal, minor | Yes | That half of the reason is gone |
| Places of the plan not recorded: `sketch.ts` and track C, `applyCommand`, `ToolRecipe` | internal, minor | Yes | "For the plan" |
| Scenario: the brace of 2f ran through a post; face names were compared by `JSON.stringify`, which depends on the order of keys | internal, minor | Yes (computed) | The rib is longer and the brace beside the post; a helper `sameName` |

Checked by the reviewers and found sound: the direction each curve moves for outer loops and holes, tangent joints, the outline of a selection for a shared edge, a T junction and three of four quadrants, the orientation of the loop of an open and of a closed wall, the names of its faces, the frames of the sketches the scenario puts on faces (probed in the engine), the statements about `profileSource`, `mergePatch`, `requireRef` and `entityOf`, that no upgrade step is needed (a load with `profile.offset` is refused today), and the optional field through `Fields`, `fieldsOf`, `resolve` and a patch.

Not acted on:

- `ProfileSourceB` is a closed alias, so another track could not merge a profile variant (internal, as a note): none plans one, and the extent, which two packages do extend, is open.

### Round 2 (2026-11-15), narrow: the fixes of round 1, at `83c8405`

The same two reviewers, read-only, asked for blockers, majors and factual errors only. `codex` returned four findings over the four packages. The internal subagent returned one major, one factual error and one flag, with probes against the real engine and kernel; it was stopped by a usage limit before it reported and was resumed with the same brief. `agy` did not take part: its account is out of quota. Every finding was checked against the code. The one on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The nesting test rests on "the loops do not cross", which `soundTessellation` does not give: it counts only crossings where the ends of each edge lie strictly on opposite sides of the other. A hole whose two vertices lie on an edge of its outer polygon passes through it, has one vertex inside and a sound area. Built from an inward offset of a valid outline and run through today's `detectProfile` and `buildPrism` | codex, blocker | Yes (`sketch.ts`, the test of sides with `< 0` on both products). The case needs a vertex exactly on an edge, which is rare; the claim was false all the same | A third test, clearance, in front of the other two: edges without a common vertex keep a distance, neighbours do not fold back. With it the loops are simple and disjoint, and one vertex does decide the nesting |

Found holding by both: the signed sweep of an arc for both senses and for outer loops and holes; the area test for the sliver; `notProjected` where it is enforced; the widened pre-check of `setField` with `Fields`, `fieldsOf` and a patch (no existing test changes its message). The internal reviewer worked five cases through the two tests of round 1 and found each refused; what it named as remaining ("a vertex exactly on an edge of another loop") is the finding above.

Not checked by either: a numeric search for counterexamples to the tests on the polylines; they were reasoned through, not fuzzed. The implementation owes a property test (a random outline that passes hands the kernel a mesh it accepts).

### Round 3 (2026-11-15), the last: the diff of the fixes of round 2, at `e4056d1`

The owner's rule allows three rounds, and the third reads only the diff of the fix. The same two reviewers, read-only: `codex` (two majors and three factual errors over the four packages) and a fresh internal subagent (one major, two factual errors, two leftovers; with probes against the real engine and kernel and numeric scripts). `agy` did not take part: its account is out of quota. Neither found a blocker. Every finding was checked against the code. The ones on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The exception of the clearance test for "two edges that share a vertex" covers any two edges with a common key, not only neighbours. A loop of two squares that touch in one vertex with one key passes every test and is not simple; `detectProfile` returns such a loop for a hole around two regions that meet in a corner (`sketch.ts` keeps repeated keys) | codex, major (run) | Yes | The exception is for edges that follow each other in a loop, by position; every corner of a moved outline has a key of its own, so a loop that returns to a point is refused |
| "It runs in the sweep `soundTessellation` has": that sweep compares only edges whose boxes overlap, so two edges nearer than the tolerance with disjoint boxes are never measured. It cannot hide a contact | internal, factual (read) | Yes | The boxes are widened by the tolerance |
| The file table still said "the two new ones" | internal | Yes | Three |

Found holding: the clearance claim (the internal reviewer fuzzed 400 000 loops and 400 000 pairs of loops on integer grids against the test as worded with distinct vertices: none passes and is not simple, none passes and meets another, one vertex always decides the nesting); no false refusals (the edges of a tessellated arc are at least 0.77 of its radius, so only radii under 1.3e-6 are hit; tangent joints are obtuse; a straight wall needs about 2e-6 of thickness); the wall and the rings of 2b, by reading.

Still open, as known limits:

- The three tests were not run on real offset outlines, nor near the tolerance in floating point (the fuzz was on integer grids). The property test owed above is where that shows.
- The wording of this round's fix (neighbours by position, a key per corner, the widened boxes) was read by no reviewer.

## As implemented

### The engine, the app and the tests (2026-11-15)

The two moves came first, each in a commit of its own with the tests unchanged: `buildPrism` to `recompute/tool-prism.ts` with `Prism` renamed `BuiltTool` (and `SideCurve` moved to `recompute/state.ts` with it), and the document half of an extent to `features/extent.ts`. Then the package: `recompute/outline.ts` (the outline of a selection, the move of a chain, the polylines and their tests, the wall), the branches of `recompute/profile.ts`, `sideOf` in the prism build, the validation and the references in `features/profile.ts`, the optional field in the `setField` branch of `applyCommand`, the two roles, the two paragraphs for the AI, and the form of the app. The rules as they are in the code are in [architecture/extrude.md](../../architecture/extrude.md), "Profile offset and a wall"; the form is in [ui/extrude.md](../../ui/extrude.md).

Where the code differs from the design above:

- **`OutlineCurve` carries its end points.** A line and an arc have `from` and `to` (the points) and `ends` (the keys of their two vertices); the start angle of an arc is `start`. The design gave an arc only angles. The points are needed for the test "does this point lie inside this loop" to be exact where a ray passes through a vertex that a line and an arc share: both curves then read the same coordinates.
- **The nesting before the move is asked with the middle of a curve**, not with a vertex. Two loops of a selection may share a vertex (regions that meet in a point give two loops, as the design says), and a vertex of one then lies on the other; the middle of a curve lies on no other loop of a valid profile.
- **The order of the tests of the polylines** is clearance, area, the crossing test of a sketch profile, nesting. The clearance covers every crossing and names the two curves, so the crossing test finds nothing after it; it stays as the design asks for it. A loop of fewer than three points is reported with the area ("leaves no area").
- **A tangent joint with a line uses the normal of the line**, so the moved line passes through the new corner exactly; the moved arc is then off by `d · (1 − cos(angle))`, under 5e-9 of the offset at `ANGLE_TOLERANCE`.
- **The plane of a wall end** is given from the corner on the left of the end curve to the corner on its right (in the direction of the curve), so the frame of a sketch on it does not depend on the end the chain is walked from. The design named the face and not its plane.
- **A closed wall whose inner side has no radius left** (a circle with a thickness of its diameter or more) is refused like any radius that is used up; it does not become a disc.
- **The regression "the mesh without an offset is byte for byte what it was"** is in `packages/scenarios/test/review.test.ts`, not in the tests of the engine: a mesh needs the triangulation of the real kernel. The hash was computed with the engine of the commit before the package and with the package, on the same model, and was the same.
- **The fields of the registry**: `profile/offset` and `profile/thickness` come first in `FEATURE_TYPE_INFO.extrude.fields`, before the parameters of the generators. Two tests that pinned the order say so.
- **Types moved for the modules**: `ProfileProblem` and the new `Outline` and `FaceRole` (a face name without its feature and copy) are in `recompute/state.ts`; `OutlineCurve` is in `sketch.ts`, because `Loop.exact` holds it and `sketch.ts` is imported by `recompute/*`, not the other way.
- **The app** beyond the design: `pixelSize` moved from the host of the sketch mode to `PanelHost` (the form needs the reach of a pick); the label of a wall face adds what tells it apart ("side of a wall (left of c5)"); switching the profile source says in the status line what a click picks now; the kit of the scenarios prints a face name with every part of its role.

The message of a refusal, as the owner decided (open questions): it starts with what moved the outline, names the curves and ends with what to do. For an offset: "The offset of -16 mm leaves no length for the curves "rb", "rd": their neighbours meet before them, so they vanish. Use a smaller offset or give the corners a radius larger than the offset, or draw the moved outline in the sketch and extrude that."

Tests: see [architecture/verification.md](../../architecture/verification.md), "The offset of a profile and a wall". The property test the reviews of the design asked for is there in two parts: an offset and its opposite on 200 random outlines of lines (engine), and 24 random rounded rectangles with a hole built and cut by the real kernel (scenarios).

Seen in a browser (the app of this branch on its own port, with the model of scenario 12 loaded): the box with its cavity, the rib and the mitred bracket in a picture from above; the form of a wall with the curves of the sketch drawn over the body, two of them taken by clicks, the chosen and the hovered one highlighted, and the preview of the wall.

Known limits, besides those of the design:

- A mitre has no limit: a sharp corner moves by `offset / sin(half the corner angle)`.
- Regions that meet in a point can be moved inwards (they come apart) and not outwards (they run into each other); a selection where the common outline cannot be followed through such a point is refused.
- The app offers only own curves for a wall and draws all of them while the form is open, also over the bodies; there is no pick of a chain as a whole.

### Review (2026-11-15)

One full review of the commit of the package by a subagent that did not write it, read-only, with probes against the real adapters and its own fuzz (the numbers are in [architecture/verification.md](../../architecture/verification.md)). No serious finding; one round was enough.

| Finding | Severity | Holds? | What changed |
|---|---|---|---|
| A wall refused by the tests of its polylines names the keys of its outline (`R|ab`, `E|e`) in the message and in `refs`, not curves of the sketch | moderate (run) | Yes | `outlineRegions` takes what a key stands for; a wall answers with the curve of a side and the end curve of an end. Both sides of one curve are worded as such |
| A cusp (a line or an arc that meets an arc tangentially, the loop turning back): the side of the new corner is read from the sign of a number that is zero, so a valid inward offset is refused or built on 1e-9 of noise. Nothing wrong was built | minor (run) | Yes | At a cusp the corner is the intersection in the direction of travel of the curve that starts there |
| An offset that leaves a strip thinner than float32 resolves but above the tolerance gives a body without volume there. The same holds for a sketch drawn that thin | minor (run), not a regression | Yes | Recorded as a limit in the architecture |
| `side` of a `wallSide` accepts any text | minor | By design ("Faces of a wall": a well-formed name of a face that does not exist is a broken reference, like a curve the feature never had) | Nothing |
| The summary of the extrusion in `describe_api` did not mention the offset and the wall | minor | Yes | The summary says it |
| No test of the two findings above | | Yes | `packages/engine/test/review.test.ts` |

Checked by the reviewer and found sound: the geometry of the offset and of the wall on the fuzz and on hand cases with exact areas (both branches of a D, a lens, a keyhole, holes and islands, loops that share a vertex, extremes of the offset); the document level (`setField` on the absent field, patches, load, undo, references, no upgrade step); the claim that a document without an offset is unchanged (the hash test run against the commit before the package); the app by reading. Not checked by it: the app in a browser (done by the author, above), the MCP build, the spikes.


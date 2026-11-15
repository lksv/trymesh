# Architecture: the extrusion

Part of [architecture.md](../architecture.md), the design as implemented. The extrusion, its extent and targets, profile generators.

## Extrude

Krok přepočtu má tři oddělené části (D35 krok 0), aby šla každá později vyměnit nebo zopakovat samostatně:

1. **Profil.** Ze zdroje profilu vzejdou oblasti v rovině a souřadný systém roviny. A generated profile comes from its generator (below). U zdroje `regions` se vyhodnotí rovina skici a vybrané oblasti; neplatný profil → `invalidProfile`, chybějící oblast → `noProfile`. Oblouky a kružnice jsou rozdělené na segmenty podle `chordTolerance`, nejvýš na 4096 úseček na křivku (u obřích poloměrů pak dělení toleranci nedodrží).
2. **Tool.** The engine builds the closed mesh of a prism over an interval along the normal of the sketch plane: two caps (triangulated by the kernel) and the side faces. For the extent `distance` the interval is `start` to `start + distance`; for `throughAll` it is measured against the targets (below). Every triangle gets a face number by name; `startCap` is the cap at the start of the interval and `endCap` at its end, whichever way the interval points.
3. **Application.** `new` stores the tool as a body. `add` and `cut` hand a tool recipe to `applyTool`, which runs one boolean per target body.

**Tool recipe.** `ToolRecipe` is the operation, the targets and the function `build(targets, firstFaceId, placement?)`, which builds the tool again for the given target solids with face numbers from the given number; `placement` is the rigid transform and the copy tag of a copy made by a pattern. `applyTool` works from the recipe alone and knows nothing about extrusions, so any later feature that produces a tool (a revolve) is applied the same way. It is a function of a model (bodies and the face table) that returns the changed model and the targets it left unchanged, or the reason it failed; the caller decides what that means for its feature. The recompute state keeps the recipe of every `add` and `cut`, also when the operation had no effect (`noEffect`); a feature in error (`brokenReference`, `kernelFailure`, `emptyResult`, a profile error) has none. The pattern reads the stored recipe to repeat the tool in another position. A recipe is stored instead of a mesh because the length of "through all" has to be measured again for every copy.

### Extent and targets (D35, point 2)

**Targets.** `new` has no target, `add` exactly one (adding to several bodies would merge them) and `cut` one or more: a screw hole through two bolted parts is one cut with both bodies as targets. A target may not be listed twice. The tool is built once and subtracted from every target in the order of the list; every changed body carries the tool's faces under the same names, which is unambiguous because a face is always referred to together with its body.

**Through all.** `{ type: 'throughAll', side }` is accepted only with the operation `cut`, because its length comes from the targets. The side is always explicit: `forward` is along the normal of the sketch plane, `backward` against it, `both` on both sides. For a sketch on a face the normal points out of the body, so an ordinary hole is `backward`.

- The interval is computed by `toolSpan` from the vertices of all targets together, projected onto the normal of the sketch plane: `forward` is `[0, high + overshoot]`, `backward` is `[0, low − overshoot]` and `both` is `[low − overshoot, high + overshoot]`, where `low ≤ 0 ≤ high` is the extent of the targets measured from the sketch plane.
- The extent of the whole body counts, not only the part under the profile.
- The overshoot is `max(1 mm, 1 % of the largest absolute coordinate of the targets and of the origin of the sketch plane)`. It keeps the cap of the tool out of the plane of a body face. The kernel adapter resolves about 1e-4 of the largest coordinate of body and tool together, so the overshoot is normally two orders of magnitude above it. Where it is not (a profile far larger than the targets), the adapter takes the cap as flush with the face, which it handles like any flush face; holes then still go through.
- The length is measured every time the tool is built, against the targets in the state the tool is applied to. A hole through all therefore follows a later change of the thickness, and a pattern measures it for every copy.
- A side on which no target reaches gets just the overshoot: the tool misses and the result is `noEffect`.
- The extent has no numeric field, so it has no expression; `FEATURE_TYPE_INFO.extrude.fields` lists `extent/start` and `extent/distance` with `when: extent/type = distance`.

### Profile generators (D35, point 3)

A generator turns a few entities of a sketch and a few parameters into the loops an extrusion sweeps. Operation, extent and targets belong to the extrusion, so a generated profile gets "through all", several targets and later the pattern without further work.

**Catalog.** `GENERATORS` in `generators.ts` is the single source of truth, like the constraint catalog. An entry lists:

| Part | Meaning |
|---|---|
| `operands` | Entities of the sketch by name and the entity kinds accepted (a gear: `circle`). Own curves, construction or not, and projected ones qualify |
| `params` | Numbers (`NumberSpec`: unit, range, default) and flags. A number is a numeric field at `profile/params/<name>` and accepts an expression. A number without a default is required. The document type already allows a string, for options and text of later generators |
| `refs` | References to earlier extrusions whose profile comes from one of the listed generators |
| `sides` | Names of the side faces the generator creates |
| `facts` | What the generator publishes about the profile, with descriptions |

Validation, expressions, `FEATURE_TYPE_INFO.extrude.fields` (the parameters with `when: profile/generator = <name>`), the app's form and the API description for AI are built from the catalog. A new generator is an entry and a build function; the document shape does not change.

**Validation.** Dictionaries may hold only the names the catalog knows, and a profile only the fields of its variant (regions with generator parameters are an invalid command, not plain regions). In a patch `null` may name an entry the catalog knows whether the feature has it or not; any other name that is not there is rejected like every unknown field. Parameters a command leaves out get their defaults and are stored; the profile is stored in the order of the catalog. A command verifies the references the feature did not have before, as everywhere: the sketch, the operands (the entity exists in that sketch and has an accepted kind; `FeatureRef` of the kind `entity`) and the references to other features (an earlier extrusion with one of the accepted generators; kind `generated`). Loading a document verifies only the shape.

**Recompute.** The generator is a pure function `(operands, params, refs, frame, chordTolerance) → regions, facts, warnings` or a failure with a message.

- It reads only the solved operands (centre and radius of the circle), so it does not depend on the profile of the sketch being valid. Pitch circles of gears in mesh touch, which invalidates the profile of the sketch unless they are construction circles.
- An operand that is no longer in the sketch is `brokenReference` with the entity in `refs`.
- A failure (a pointed tooth) and a profile above 50 000 points are `invalidProfile` with the generator's message. The gear knows the size of its loop beforehand and refuses before building it; an arc has at most 4096 chords. A tooth whose tip, or a gap whose root, is narrower than the length tolerance counts as pointed or overlapping.
- `refs` are handed over as the facts of the features referred to; a feature that is missing, suppressed or in error has none, and the generator decides what that means (a gear warns and goes on).
- The regions have the shape of sketch regions (outer loop counter-clockwise, holes clockwise), so the prism builder takes them as they are. Every edge carries the name of its side instead of a curve ID.
- `facts` and the generator's warnings become part of the feature result (`FeatureResult.facts`); warnings make the status `warning`. A feature in error publishes no facts.

**Involute gear** (`involuteGear`). The pitch circle is the operand, the module follows from its diameter and the tooth count.

- Parameters: `teeth` (integer, 4 to 500, required), `pressureAngle` (radians, in (0, π/2), default 20°), `backlash` (mm along the pitch arc, default 0), `rotation` (radians, default 0) and the flag `internal`.
- An external profile is the gear: tip circle `r + m`, root circle `r − 1.25 m`. An internal profile is the tool that cuts a ring gear: it reaches from the tip circle of the ring `r − m` to its root circle `r + 1.25 m` and removes the centre as well.
- The flank is an involute from the base circle; below it the flank is radial. No profile shift, no fillet at the root.
- Backlash thins the tooth of an external gear on the pitch circle and widens the tooth space of a ring.
- The flank is divided evenly in arc length until the chords stay within `chordTolerance`. Chords lie inside the exact tooth, which is the safe side for a gear. The flank of the ring tool is moved outwards by the largest distance of the flank from its chords (a curve parallel to an involute is the same involute turned by distance / base radius), and its arcs are made of tangents instead of chords, so the polyline lies outside the exact tool everywhere and gears with zero backlash do not overlap. The distance is searched for along every chord, because the curvature of an involute changes along it and the farthest point is not the middle one. Without the offset the ring's teeth were up to 0.006 mm too thick.
- `rotation` is the direction of the axis of one tooth in sketch coordinates (for a ring of one tooth space).
- **Mesh.** With `refs.meshWith` the rotation is computed from the other gear's facts, which are in model coordinates, so the two gears may come from different sketches with parallel planes, also mirrored ones. The phase of a gear in a direction from its centre is the fractional part of `(direction − rotation) · teeth / 2π`. For two external gears the phases at the pitch point add up to 1/2; for a gear inside a ring they are equal. Either gear of an internal pair may be the one that refers.
- The mesh needs equal modules (relative 1e-6) and pressure angles, parallel axes and tangent pitch circles (1e-6 of the size). If something does not hold, or the other gear has no facts, the feature has the warning `gearMesh` with the reason and uses the parameter `rotation`.
- With the mesh in place the generator checks whether the tip of one gear runs into the root of the other below its base circle (`gearInterference`): the limit is `√(rb² + (a · sin α)²)`, both gears of an external pair are judged, and for a ring the inequality is reversed.
- Facts: `module`, `teeth`, `pressureAngle`, `backlash`, `internal`, `pitchDiameter`, `baseDiameter`, `tipDiameter`, `rootDiameter` (of the gear; for a ring the tip circle is the inner one), `rotation`, `meshed`, and in model coordinates `center`, `axis` and `toothDirection`.

Výsledky, které nejsou běžné:

| Situace | Chování |
|---|---|
| `cut` misses a target, `add` adds nothing | The target stays unchanged and the feature has the warning `noEffect`, whose `refs` list the unchanged targets. The other targets of a cut are cut, and the message then says that only the targets in `refs` were missed. When nothing changed at all, no face of the tool enters the face table. The change of volume is measured against the smaller of the two solids (body, tool), so a small boss on a large plate does have an effect. |
| `add` kusu, který se tělesa nedotýká | Těleso má dvě nesouvislé části; stav je `ok`. |
| `cut` would remove a whole target | Error `emptyResult` with the target in `refs`; the feature behaves as an empty operation and none of its targets changes, not even those cut before the failing one. |
| A target is missing (removed, suppressed, in error) | Error `brokenReference` with the missing targets in `refs`; nothing is cut. |
| Jádro selže | Chyba `kernelFailure`. |

**Koplanární stěny (D19).** Engine staví nástroj přesně podle skici a nic neposouvá. Skica na stěně znamená, že víko nástroje leží v rovině této stěny; že s tím jádro neumí pracovat spolehlivě, je vlastnost konkrétního jádra a řeší ji jeho adaptér (viz záruka č. 3 u SolidKernel).

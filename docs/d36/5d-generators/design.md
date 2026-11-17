# 5d Generators: the cycloidal disc, the GT2 pulley, the profile shift of the gear (D61)

**State: full design, 2026-11-17, against the code of `master` at `d080fa8`.** Written on Opus 5.5 (the owner's note of 2026-11-17: Fable is not available). Reviewed in one round ("Reviews"). Not implemented.

Files: [contract.ts](contract.ts) (the two entries of the catalog, the parameter and the fact of the gear, a point as an operand, the example of an entry), [calls.ts](calls.ts) (its parts of validation scenarios 9 and 13).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md): "Další generátory profilu — cykloidní kotouč, řemenice GT2, řetězové kolo, ozubený hřeben, drážkování, text — položky katalogu generátorů; tvar dokumentu se nemění"; in the trial of D35 "Cykloidní převodovka — profil cykloidního kotouče; výstředník a kolíky umí vysunutí a pole" and "Řemenice, knoflík — profil GT2; klínová drážka; rýhování"; and "Posunutí profilu ozubení — kola s málo zuby, úprava osové vzdálenosti — další parametr generátoru ozubení", with "Profile shift is unrelated and cheap: one more parameter of the generator, useful for small tooth counts" in the part on the sketch. D36 step 5 has "generators for a cycloidal disc and a GT2 pulley, profile shift of the gear".

| Statement | What the code says |
|---|---|
| "Entries of the generator catalog; the document does not change" | `GENERATORS` (`generators.ts`) is keyed by `GeneratorName` (`types.ts`, one member `involuteGear`) and maps to a build function in `BUILD`. A generated profile stores `generator`, `operands`, `params` and `refs` by the names of the catalog (`features/profile.ts`). A new entry is a member of the union, an entry and a build function; validation, the numeric fields (`PROFILE_FIELD_SPECS`), the description for the AI (`generatorCatalog` in `packages/mcp/src/api.ts`) and the app's form follow. True, with two exceptions found below |
| A generator takes "a few entities of a sketch" | `OperandSpec.kinds` is a list of `EntityKind`, which has `point`; but `ResolvedOperand` is a circle only and `generated` of `recompute/profile.ts` resolves every operand as a circle (centre and radius). A pulley is placed by its centre: a point operand needs its resolution there, and the app's list of operands (`operandChoices` of `features/extrude.ts`) lists curves only |
| The example of the description | `generatorCatalog` makes the example of an entry from its required numbers, each `max(min, 18)`; the app starts a draft from `FORM_DEFAULTS` of `sketch-commands.ts`, a table typed over `GeneratorName`. For a disc that gives a pin radius of 18 mm. An `example` in the entry serves both |
| "Profile shift: one more parameter" | The gear builds the tooth from the half angle of the tooth on the pitch circle `psi = π/(2z) ∓ backlash/(2r)` and the circles `r ± m`, `r ∓ 1.25 m`. A shift changes `psi` and the two circles; the involute, the flank from the base circle, the chords and the ring tool stay |
| "… úprava osové vzdálenosti" (a changed centre distance) | `meshRotation` requires the pitch circles to touch (the distance `r1 + r2` or `r_ring − r_gear`, to 1e-6 of the size). A shifted centre distance has no closed form (the inverse of the involute function); see "Deferred" |
| An older build and a new parameter | `profileSource` refuses an entry of `params` the catalog does not know and a generator it does not know, so nothing is dropped without a word: no upgrade step. A parameter left out is stored with its default |

## The cheap variant

Two entries of the catalog, one parameter and one fact of the gear, a point as an operand, an example per entry. Nothing in the document, the feature types, the face roles, the issue codes, the commands or the queries.

1. **`involuteGear` gets `shift`**, the profile shift coefficient x (default 0: the gear of today to the last digit). Gears in mesh keep the reference centre distance, so their shifts must balance (x1 + x2 = 0, or x_ring = x_gear inside a ring). That is what a pinion with few teeth needs: the scenario's sun of 12 teeth with +0.3 and its planets and ring with −0.3 lose the interference the generator reports today.
2. **`cycloidalDisc`** over the circle of the ring pins: the disc of a cycloidal drive, in mesh with the pins at an input angle.
3. **`gt2Pulley`** at a point: a timing pulley for the GT2 belt of 2 mm pitch.

**Deferred:**

- **A shifted centre distance** (x1 + x2 ≠ 0). The centre distance for zero backlash is `a cos α / cos αw` with `inv αw = inv α + 2 tan α (x1 + x2)/(z1 + z2)` (Sources), which has no closed form: a caller would place the gears at a number it cannot write as an expression. Two routes when a part needs it: two functions in the catalog of expression functions (`inv` and its inverse), so that the distance is an expression of the parameters; or a fact `centerDistance` of the gear that refers (`meshWith`), read by the AI and copied into a parameter. Either also needs the tip shortening of the standard (the clearance falls below 0.25 m) and a mesh check against `a_w` in place of the touching pitch circles.
- **Undercut.** The generator makes a radial flank below the base circle, not the trochoid a cutting rack leaves; a gear with few teeth and no shift is reported by the existing warning `gearInterference` against its mate, not cut away. The shift is the answer the warning points to.
- **Holes of the disc** (the bore of the eccentric bearing and the holes of the output pins, `rp + E` each), and the ring of pins. At the input angle 0 they are sketch geometry about the centre of the disc (a point E from the centre of the ring, `facts.center`); the pins are a circle and a circular pattern. A generator that cut them would have to turn them with the disc for other input angles; a part that needs a disc posed elsewhere is a second feature of the same profile.
- **Other belts and pulleys**: GT2 of 3 and 5 mm pitch (other profiles), GT3, HTD, T-profiles; flanges (two discs, plain extrusions).
- **The sprocket, the rack, splines, text, a knurl, a V-groove** of the backlog: no step of the plan asks for them; each is an entry later. A rack has no pitch circle, so it would be the first generator over a line.

## Decisions

### The profile shift

**What the parameter means** (Sources, [S3]): the profile is moved by x · m away from the axis of the gear. For an external gear the tooth gets thicker on the pitch circle by 2 x m tan α and both the tip and the root circle move out by x m:

| | external gear | ring gear (`internal`; its teeth point inwards) |
|---|---|---|
| on the pitch circle | tooth thickness `m (π/2 + 2 x tan α)` | space width `m (π/2 + 2 x tan α)` |
| tip circle | `r + m (1 + x)` | `r − m (1 − x)` (the inner circle) |
| root circle | `r − m (1.25 − x)` | `r + m (1.25 + x)` (the outer circle) |

In the generator that is one term in the half angle of the tooth of the loop (for a ring: of its tooth space) on the pitch circle, `psi = π/(2z) + 2 x tan α / z ∓ backlash/(2r)`, and the two circles. The tool of a ring gear is moved outwards by the deviation of its chords as before.

**Gears in mesh keep the reference centre distance.** The mesh check stays "the pitch circles touch" and gets one more condition: x1 + x2 = 0 for two external gears, x_ring − x_gear = 0 for a gear in a ring, to 1e-9 (shifts are written as numbers or simple expressions; 0.3 and −0.3 are exact). A pair that does not balance is the warning `gearMesh` ("the profile shifts do not keep the reference centre distance: x1 + x2 = 0.1; a shifted centre distance is not supported") and the parameter `rotation` is used, as for every other mesh that does not hold. The rotation of a pair that balances is the rotation of today: a tooth of one gear on the line of centres faces a tooth space of the other whatever the shifts, by symmetry. The check of the tips (`gearInterference`) needs no change: it reads the tip radius of each gear, which the shift moves, and the base radii, which it does not.

**Checked independently** of the formulas ("Measured", the spike `shift`): two gears built with these thicknesses and circles at the reference centre distance, turned through a pitch together in twelve steps, touch (the smallest distance of their outlines 1e-8 to 1.3e-6 mm, with 400 points per flank) and never overlap, for 12/30 teeth with ±0.3, 18/27 with ±0.2 and 10/40 with ±0.5 at module 1; a gear of 30 teeth inside a ring of 72 with x = −0.3 for both, and 27 in 72 with +0.3, touch with an overlap below 3.3e-7 mm (the rounding at the points of contact of two outlines without backlash). Without the shift the pair 12/30 overlaps by 2.2e-3 mm, which is the interference the generator reports today ("Measured", the spike `joint`: the planet's tip 14.4 above the limit 14.237852).

**Rejected:**

- **The shift in mm** (x · m as the parameter). The coefficient is what the standards, the tables and the rules of thumb give (x_min against undercut, the balance of a pair), and it does not change with the module.
- **A shifted centre distance in the first version.** Above, "Deferred".
- **Separate parameters of the tip and the root** (an addendum and a dedendum coefficient). The standard basic rack (1 and 1.25) is what every gear of the model has; a shorter tip is the deferred tip shortening.

### The cycloidal disc

**The profile** is the published one (Sources, [S1]), checked independently by its definition ("Measured", the spike `cycloid`): the ring pins of a drive with a fixed ring were moved through a full turn of the input in 720 steps around a disc built from the equations, and every point of 2000 points of the profile is touched by some pin (to 3e-5, the step of the motion) and none is entered (to 1e-14), for three drives (R/Rr/E/N 25/2.5/1/12, 40/4/1.5/16, 30/3/2/10). The same check fixed the frame the equations are written in: the disc centred at the origin, the centre of the ring at (−E, 0), the pins at the angles 2πk/N from the x axis, the curve clockwise starting at (R − Rr − E, 0), the bottom between two lobes where the pin on the x axis sits. With the centre of the ring on the other side, or the pins half a pitch round, the check fails by about E.

**The operand is the circle of the pins**, as the gear's is its pitch circle: R is its radius, its centre the axis of the input and of the ring. A construction circle; it may be projected.

**The disc stands where it meshes.** `rotation` is the input angle: the centre of the disc is E from the centre of the ring in that direction, and the disc is turned by −rotation/(N − 1), which is how a drive with a fixed ring moves (the spike moves the pins the same way). So a disc with `rotation: 'deg(90)'` is the same disc a quarter of an input turn later, still in mesh, and the second disc of a two-disc drive is `rotation + π`. The pins are not made by the generator; it says where it takes them to be (the angles 2πk/N from the x axis of the sketch: a pin on the x axis and a circular pattern of it).

**The clearance** is the radius of the pins taken larger by it: the envelope of larger pins is the profile moved inwards by exactly that, everywhere. That is the print clearance of a disc against its pins, in the same words as the backlash of a gear.

**The polygon lies inside the exact disc.** A chord of a lobe lies inside the curve, a chord of a bottom between two lobes outside it (the curve bends around the pin there), so a polygon of points on the curve would enter the pins by up to the chord tolerance. The disc is therefore built for pins larger by the largest distance of its chords from the curve (with a margin of 0.1 %), found while the number of points is chosen: the polygon then lies inside the exact profile everywhere, at most twice the chord tolerance away from it, the rule of the tool of a ring gear. Measured on the disc of the scenario: 704 points, the chords within 3.2e-3 of the curve, the smallest distance to pins tessellated as the engine does 0.0022 to 0.0032 mm at four input angles, no overlap; with a clearance of 0.1 it is 0.103.

**When the disc cannot be built** (`invalidProfile` with the message):

- `E · N ≥ R`: the curve of the pin centres makes loops and the profile has no meaning (Sources, [S1]: the condition on the coefficient `E N / R < 1`).
- The pins, taken with the clearance, are not smaller than the smallest radius of curvature of the curve of the pin centres where it bends towards the disc: the profile turns back on itself (undercut). Checked against a direct test ("Measured", the spike `undercut`): for five drives the polygon of the profile crosses itself at 1.05 times that radius and does not at 0.95 times.
- The pins overlap one another: `Rr ≥ R sin(π/N)` (the clearance is not part of a pin).
- The circle of the bottoms is not above zero: `R − Rr − clearance − E ≤ 0`.
- More points than `MAX_PROFILE_POINTS`, as for every generator.

**Rejected:**

- **The centre of the disc as the operand** (a point, with R a parameter). The circle of the pins is what the rest of the drive is drawn on (the pins, the housing), and a dimension of its diameter is the size of the drive, as the pitch circle is for a gear.
- **The disc always at the input angle 0.** A two-disc drive needs the second disc at π, and a check of a drive in another position is a preview of one parameter.
- **Building the profile from the motion** (the envelope of the pins computed numerically). It is the test of the equations, not a better generator: slower, and its accuracy follows the step of the motion.

### The GT2 pulley

**What is published and what is not.** Gates, who make the belt, publish the pitch (2 mm), the tooth height of the belt (0.76 mm) and its thickness (1.52 mm) ([S4]), and a table of pitch and outside diameters of their 2 mm sprockets in which the two differ by 0.51 mm on every row ([S5]: 12 grooves 7.64 / 7.13, 20 grooves 12.73 / 12.22, 30 grooves 19.10 / 18.59, 40 grooves 25.46 / 24.96). **They do not publish the groove.** Their manual says that "the correct groove profile for a sprocket changes as the number of grooves changes" and that Gates supply it on request as a master profile, a dimensioned drawing or digitised points ([S5], "C. Groove Specifications"). What exists in the open is a construction from four arcs with named radii, in the gear workbench of FreeCAD ([S6]: pitch 2, `u` 0.254, `h` 0.75, `r0` 0.555, `r1` 1.0, `rs` 0.15, `offset` 0.40), whose numbers cite no source, and a polygon of a belt tooth taken from a DXF of a supplier in the OpenSCAD pulley of droftarts ([S7]: depth 0.764, width 1.494). Misumi give the tooth height of 2GT as 0.75 mm ([S8]).

**The cheap variant takes the construction of [S6]**, because it is the only one given as dimensions, and it agrees with what Gates publish where the two can be compared ("Measured", the spike `gt2`):

- **The outside diameter** is `teeth · 2/π − 2 · 0.254`. Gates give no pitch line differential in words; 0.254 mm per side (0.01 in) is what their table differs by (0.51 / 2, rounded) and what [S6] and [S7] use. The formula gives 7.131, 12.224, 18.591 and 24.957 for 12, 20, 30 and 40 grooves: the table of Gates to its last digit.
- **The groove**, for one groove whose axis points along +y and whose tip circle has the radius `r5`: the bottom is an arc of `r0 = 0.555` about the point of the axis at `r5 − h + r0` (`h = 0.75`, the depth); each flank an arc of `r1 = 1.0` whose centre lies 0.40 to the other side of the axis and touches the bottom from inside (its centre is `r1 − r0` from the centre of the bottom, so it lies 0.195 further out; with these numbers that is the tip circle, within 0.02 mm); a fillet of `rs = 0.15` touches the flank from outside and the tip circle from inside; the tip circle between two grooves. Every joint is tangent (to 1e-15 in the spike), the depth is 0.75, the groove 1.50 wide at the tip (1.518 at 12 grooves, 1.488 at 60) and the land between two grooves 0.34 mm at 12 grooves, 0.41 at 20.
- **What does not agree**, and is a known limit: the depth 0.75 (Misumi, [S6]) against the tooth height 0.76 of Gates' belt; one groove for every number of grooves, where Gates vary it; nothing says the groove of [S6] is Gates' groove at any count.

**The allowance** moves the outline outwards (negative: inwards) by a distance, every arc about its own centre: the tip circle and the fillets grow, the bottom and the flanks shrink. It is the print compensation of a pulley that comes out too tight or too loose on its belt, the same words as the clearance of the disc. An allowance that makes an arc vanish or the land disappear is a failure with that message.

**The polygon lies inside the exact outline**, by the rule of the ring tool: on the arcs that bend away from the material (the tip circle, the fillets) the points lie on the arc; on those that bend around empty space (the bottom, the flanks) they are the corners of tangents, `radius / cos(step / 2)` from the centre, so no chord enters the space of the belt.

**Parameters**: `teeth` (12 to 500: Gates' tables of 2 mm sprockets start at 12 grooves and so does their smallest recommended idler [S5]; no smaller pulley is sold or rated), `allowance` (mm, default 0), `rotation` (radians, default 0: the direction of the axis of one groove). **Facts**: `teeth`, `pitch`, `pitchDiameter`, `outsideDiameter`, `rootDiameter` (the circle of the bottoms), `allowance`, `rotation`, `center`, `axis`. One side face, `grooves`.

**Rejected:**

- **The polygon of a belt tooth subtracted from a disc** ([S7]). It is a point list from an unnamed DXF of a supplier, not dimensions, and it models the belt rather than the pulley.
- **Asking Gates for the master profile** inside this package. Their profile changes with the number of grooves; a table of profiles per count would be a data catalog of its own and needs the data, which only Gates can give. This is the open question below.
- **A generic timing pulley with the pitch as a parameter.** Other pitches and profiles (GT2 3 mm and 5 mm, HTD, T) are other grooves, not a scaled one.

### A point as an operand

`OperandSpec.kinds` takes `point` today (`EntityKind`), and a command already verifies a point of a sketch (`entityOf` answers `point` for an own point, the origin and a point of projected geometry). What is missing: `ResolvedOperand` gets `{ kind: 'point'; at: Vec2 }` and `generated` of `recompute/profile.ts` resolves an operand by its kind (a point from `points` of the solved geometry; a point that is gone is `brokenReference`); the app lists points in the select of such an operand (the origin, own points, points of projected geometry). The pulley is the first entry that uses it.

**Rejected: the pulley over a circle** of the pitch diameter. The diameter follows from the number of teeth (`2 · teeth / π`), so a circle would be one more thing to keep in step, and a wrong one would have to be an error.

### The example of an entry

`GeneratorSpec` gets `example`: the required parameters of a profile that builds. The description for the AI shows it (in place of the minimum or 18 for every required number) and the app starts a new draft from it (in place of `FORM_DEFAULTS`). The gear's is `{ teeth: 18 }`, which is what both say today; the disc's `{ pins: 12, pinRadius: 2.5, eccentricity: 1 }`, the pulley's `{ teeth: 20 }`. A test runs every example through the engine over a sketch with a circle and a point.

## Where the code lives

| File | What 5d does there |
|---|---|
| `types.ts` | two members of `GeneratorName` |
| `generators.ts` | the parameter `shift` and the fact `shift` of the gear and the shift in `involuteGear`, `meshRotation` (the balance) and the messages; the entries `cycloidalDisc` and `gt2Pulley` and their build functions (a module of their own each if `generators.ts` grows past reading: `generators/cycloid.ts`, `generators/gt2.ts`, imported by the catalog); `ResolvedOperand` with a point; `example` of `GeneratorSpec` |
| `recompute/profile.ts` | the resolution of an operand by its kind |
| `packages/mcp/src/api.ts` | the example from the entry; the paragraph on gears says what the shift is and that gears in mesh must balance it |
| `packages/app/src/sketch-commands.ts` | `FORM_DEFAULTS` gives way to `example` |
| `packages/app/src/features/extrude.ts` | points in the choices of an operand |
| `packages/app/src/labels.ts` | `FACTS_SHOWN` of the two entries (the table is typed over `GeneratorName`, so it does not compile without them) and the shift of the gear |

## The app and MCP

- **MCP** needs no code beyond the text of the gears and the example: the generator catalog of `describe_api` lists the entries, parameters, sides and facts.
- **The extrusion form** picks a generator from the catalog as today; its operands are offered by kind (a circle, now also a point), its parameters are fields from the catalog. The facts shown under the form are those of `FACTS_SHOWN`: the disc its lobes, outer and inner diameter and centre; the pulley its pitch and outside diameter; the gear also the shift. The snapshots of the app change only where the facts of a gear are shown (one more line) and where a draft of a gear starts (none: its example is what `FORM_DEFAULTS` gives).

## Shared vocabulary

- **Takes:** the catalog of generators, the chord tolerance of the document, `MAX_PROFILE_POINTS`, the warnings `gearMesh` and `gearInterference`, `side` faces named by the catalog.
- **Adds:** a point as an operand of a generator (`ResolvedOperand`), `example` of an entry. Nothing in `FaceName`, `IssueCode`, the document or the commands.

## Schema

No upgrade step: a build without the package refuses a generator and a parameter it does not know (the dictionaries of a generated profile hold only the names of the catalog), so nothing is dropped without a word. A document saved by a build with the package holds `shift: 0` in every gear, because a parameter left out is stored with its default; an older build therefore refuses every document with a gear, and says which parameter. That is the rule of the catalog working as designed, not a loss.

## Known limits

- Gears in mesh keep the reference centre distance; a shift that does not balance is a warning, not a changed distance.
- A gear with few teeth has no undercut; the warning against its mate says it interferes.
- The disc is the disc alone: no bore, no output holes, no pins; its pins are taken at fixed angles.
- The pulley is GT2 of 2 mm pitch only, and its groove is the construction of [S6], one groove for every count, 0.75 deep against the 0.76 of Gates' belt tooth (see "The GT2 pulley").
- The polygons of the disc and the pulley are smaller than their exact outlines by up to twice the chord tolerance (the side that keeps them clear of what they mesh with).

## Sources

Read on 2026-11-17 by a research subagent that fetched each and quoted it; equations given as images were read from the rendered pages. ISO 21771, ISO 53, Shin & Kwon (2006) itself, Dudley, Litvin and Maitra were not accessible and are not relied on.

- **[S1] The cycloidal disc.** W. Roozing, G. Roozing, "Experimental comparison of pinwheel and non-pinwheel designs of 3D-printed cycloidal gearing for robotics" (2023), Eq. 1–3: `cx(θ) = R cos θ − Rr cos(θ + ψ) − E cos(Nr θ)`, `cy(θ) = −R sin θ + Rr sin(θ + ψ) + E sin(Nr θ)`, `ψ = tan⁻¹[sin((Nr − 1)θ) / (cos((Nr − 1)θ) − R/(E Nr))]`, R the radius of the circle of the rollers, Rr their radius, E the eccentricity, Nr their number; the reduction `Nl/(Nr − Nl)`, which "reduces to n = Nr − 1"; attributed to J.-H. Shin, S.-M. Kwon, "On the lobe profile design in a cycloid reducer using instant velocity center", Mechanism and Machine Theory 41(5), 2006. The same equations in O. Younis, "Building a Cycloidal Drive with SOLIDWORKS" (SolidWorks blog and tutorial, 2014), with the numerator and the denominator of ψ both negated, which is the same angle (the form of the contract, `atan2(sin((1 − N)t), R/(EN) − cos((1 − N)t))`, is that one with `atan2`, which does not change the quadrant where the denominator is positive, the whole range with `E N < R`). The condition `E N / R < 1`: V. Chianca, MSc thesis, Politecnico di Torino 2018, writes the profile with `K1 = 1 − x` and says it "makes sense only if 0 < x < 1"; Miao et al., arXiv 2604.02387, Eq. 4, write the same curve with `K1 = E N / R` (eccentricity `Rz K1 / zb`). Two discs opposed: Horodincă et al., Bul. Inst. Polit. Iaşi 68(72) no. 4, 2022. **No source read gives the undercut condition in closed form**; the rule of the design (the pin radius below the smallest radius of curvature of the curve of the pin centres where it bends towards the disc) is checked numerically ("Measured", `undercut`), and Chianca's curvature of the theoretical profile (Eq. 2.29) is the same quantity.
- **[S3] The profile shift.** KHK, *Gear Technical Reference* (the technical part of catalogue KHK 3010): Table 5.1, tooth thickness `s = (π/2 + 2 x tan α) m`; Table 3.5, tip diameter `d + 2 m (1 + x)`; Table 4.6, internal pair, `ha2 = (1 − x2) m`, `da2 = d2 − 2 ha2`, `df2 = da2 + 2h`, `h = 2.25 m` (so the ring's root `d2 + 2 m (1.25 + x2)`), and `inv αw = 2 tan α (x2 − x1)/(z2 − z1) + inv α`; Table 4.3, external pair, `inv αw = 2 tan α (x1 + x2)/(z1 + z2) + inv α`, `a = ((z1 + z2)/2 + y) m`, `y = (z1 + z2)/2 (cos α / cos αw − 1)`; Eq. 3.7–3.10, undercut, `z = 2/sin² α` (17 for 20°), `x = 1 − (z/2) sin² α`. The same tooth thickness and tip in tec-science, "Profile shift"; the root `dp + 2 m (−1.25 + x)` in the notebooks of drivetrainhub (citing Maitra). **The sign of a ring's shift** differs between sources: KHK moves the profile of a ring away from its axis for a positive x (the design follows it, so that a balanced internal pair is `x_ring = x_gear`, as KHK's `x2 − x1` says); de.wikipedia "Profilverschiebung" moves it towards the axis. The description for the AI states the rule in words.
- **[S4] The GT2 belt.** Gates, belt identification chart, PowerGrip GT3 2 mm: pitch 2 mm, overall thickness 1.52 mm, tooth height 0.76 mm.
- **[S5] The GT2 sprockets.** Gates, *Light Power & Precision Drive Design Manual*, catalogue 17183 (2015): the 2 mm belt (PowerGrip GT3, 2MGT) runs in "2mm Pitch PowerGrip GT2 Sprockets"; the diameter tables (pp. 73–75) with P.D. − O.D. = 0.51 mm on every row; "C. Groove Specifications", the groove changes with the number of grooves and is supplied on request; Table 9, the smallest inside idler 12 grooves for 2MGT; the tables start at 12 grooves.
- **[S6] The groove as arcs.** The gear workbench of FreeCAD (`freecad/gears/timinggear.py`, github.com/looooo/freecad.gears, GPL): `"gt2": { pitch: 2.0, u: 0.254, h: 0.75, H: 1.38, r0: 0.555, r1: 1.0, rs: 0.15, offset: 0.40 }` and the construction of the arcs; no upstream source is cited. Only the numbers and the construction are taken, written anew; no code.
- **[S7]** droftarts, "Parametric Pulley" (OpenSCAD, 2012): the pulley diameter `2 (N · 2 / (2π) − 0.254)`, a belt tooth of depth 0.764 and width 1.494 from a supplier's DXF.
- **[S8]** Misumi, catalogue 2014, timing pulleys: "Tooth Height … 2GT: 0.75mm".

The independent checks of each are in "Measured": the disc against the envelope of the pins (`cycloid`), the shift against two gears turned in mesh (`shift`), the pulley against Gates' table of diameters (`gt2`).

## Measured

Spikes over the real engine and adapters and over the formulas, run on 2026-11-17 with vitest from the worktree; the recipes are the spikes `cycloid`, `undercut`, `disc`, `shift` and `joint` of the session, described with each number.

| What | Result |
|---|---|
| `cycloid`: the published profile against the envelope of the pins over a full input turn (720 steps, 2000 points of the profile), three drives | every point touched to 3e-5, none entered (overlap below 4e-7); the frame: disc at the origin, ring centre at (−E, 0), pins from the x axis, the curve clockwise from (R − Rr − E, 0); the wrong side or a half-pitch phase fails by E |
| `undercut`: the rule of the radius of curvature against a self-crossing test, five drives (K1 from 0.48 to 0.86) | the profile crosses itself at 1.05 times the smallest radius of curvature and not at 0.95 times, in all five; the pins touch one another before that radius in four of them |
| `disc`: the disc of scenario 13 (R 25, Rr 2.5, E 1, N 12) built as the design builds it, against pins tessellated as the engine does (36 points at the chord tolerance 0.01) | 704 points, chords within 3.2e-3; the smallest gap to the pins 0.0032 (input 0, 90°, 180°) and 0.0022 (1 rad), no overlap; area 1604.684 mm² (exact 1605.165); with the clearance 0.1: gap 0.103, area 1589.654 |
| `shift`: external pairs at the reference distance, turned through a pitch | balanced shifts touch (1e-8 to 1.3e-6) without overlap: 12/30 ±0.3 (tip of the pinion 0.392 mm wide), 18/27 ±0.2, 10/40 ±0.5; unshifted 12/30 overlaps by 2.19e-3 |
| `shift`: internal pairs, x_ring = x_gear | 30 in 72 with −0.3, unshifted, 27 in 72 with +0.3: touch, overlap below 3.3e-7; the ring's tip 31.23 above its limit 31.1247 at −0.3 |
| `gt2`: the groove of [S6] built as the design builds it, 12 to 60 grooves | outside diameters 7.131, 12.224, 18.591, 24.957 for 12, 20, 30, 40 grooves (Gates [S5]: 7.13, 12.22, 18.59, 24.96); every joint tangent to 1e-15; depth 0.7500; groove 1.518 to 1.488 wide at the tip; land 0.337 (12), 0.413 (20), 0.467 (40); the centre of a flank 0.02 mm outside the tip circle at 12 grooves, 0.004 at 60. Area of the exact outline (400 points an arc): 103.020 mm² for 20 grooves, 460.278 for 40 |
| `joint`: the joint of scenario 9 with Zs 12, Zp 30 in the engine of `master` | the planet has `gearInterference` (tip radius 14.4 above the limit 14.237852); sun and ring are `ok`; every check of the scenario holds; the interference query finds no pair (171 ms) |

## To verify before the implementation

- How the flank arc of [S6] is placed in the code of FreeCAD exactly (in polar terms, by angles) against this design's placement (the centre 0.40 to the side of the axis and `r1 − r0` from the centre of the bottom): the spike follows the design's words; a difference would move the flank by hundredths of a millimetre. The implementation writes its own construction from the design, not from that code (GPL).
- That the scenario's expected areas hold for the polygon of the chord rule (the spikes measured exact outlines and a polygon of the disc; the pulley's polygon is smaller than its exact outline by at most the chord tolerance along its length).

## Needs from the preparatory step

- **A member of `GeneratorName` cannot be added in a draft.** The contract of the preparatory step has maps for the unions of `types.ts` a package adds to (`FeatureTypes`, `IssueCodes`, …), none for the names of generators, and the profile of an extrusion is typed with `GeneratorName` as it is. Case: `calls.ts`, the disc and the pulleys, which go through one cast (`withGenerator`). In the code it is one member of the union; recorded so that the cast is not read as a hole of this package.
- The scenario-9 part declares `parametersAndGearSketch` and `bodiesAndHoles` of `packages/scenarios/test/joint.ts` instead of importing them: that module imports the real adapters through `kit.ts`, which the type check of the drafts does not compile.

## Open

Questions for the owner, each answerable in one line:

1. **The groove of the GT2 pulley.** Gates do not publish it; the design takes the arc construction of the FreeCAD gear workbench (its numbers cite no source; its diameters match Gates' table exactly). Accept it as the cheap variant, or ask Gates for their dimensioned profile (it changes with the number of grooves) before the implementation?
2. **A shifted centre distance** (x1 + x2 ≠ 0) is deferred. Is that right for now, or should this package add the functions `inv` and its inverse to the expressions so that a centre distance can be written?

## Tests the implementation owes

- Engine, without adapters: the shift (0 gives the gear of today point for point; the circles and the tooth thickness against the formulas; a ring; the balance in mesh for both kinds of pair, a pair that does not balance is `gearMesh`; a pointed tooth with a large shift; a root at the centre); the disc (the published curve point for point at the input angle 0; the frame at other angles; every failure; the polygon inside the exact curve); the pulley (the diameters, the groove, the polygon inside the outline); a point operand (own, origin, projected; one that is gone); every `example` through the engine.
- Against the real adapters: scenarios 9 and 13 (`calls.ts`).
- App: points as operands; the facts of the two entries; the shift in the facts of a gear.

## Rows for the indexes

**docs/d36/README.md**, the row of 5d:

| 5d | Generators: cycloidal disc, GT2 pulley, profile shift of the gear | 5 | I | none | full design 2026-11-17, D61 ([5d-generators/design.md](5d-generators/design.md)): the parameter `shift` of `involuteGear` (KHK: tooth thickness `m (π/2 + 2x tan α)`, tip `r + m(1 + x)`, root `r − m(1.25 − x)`, a ring the same away from its axis; gears in mesh must balance their shifts, a shifted centre distance deferred); the entries `cycloidalDisc` (over the circle of the ring pins: pins, pin radius, eccentricity, clearance, input angle; the equations of Shin & Kwon as Roozing & Roozing give them) and `gt2Pulley` (at a point: 12 to 500 grooves, allowance, rotation; the outside diameter of Gates' tables, the groove of the FreeCAD gear workbench, since Gates do not publish it); a point as an operand of a generator; `example` of an entry; no schema step. Open for the owner: the groove of the pulley, the shifted centre distance |

**docs/decisions.md**, the row of D61:

| D61 | Generators: the cycloidal disc, the GT2 pulley, the profile shift (D36 5d) | Two entries of the generator catalog and one parameter of the gear, every formula from a named source and checked by an independent computation; polygons that lie inside the exact outline (a disc never enters its pins, a pulley never its belt); gears in mesh keep the reference centre distance, so their shifts must balance. Rejected: the shift in mm, the disc always at the input angle 0, the pulley over a circle, the belt tooth subtracted from a disc. Deferred: a shifted centre distance, the holes of the disc, other belts. [d36/5d-generators/design.md](d36/5d-generators/design.md) |

**docs/requirements.md**, scenario 9, a new item after k:

   - l) *Profile shift (5d, D61): designed, not done yet* ([d36/5d-generators/calls.ts](d36/5d-generators/calls.ts)). The ratio 7 with a sun of 12 teeth (`Zs = 12`, `Zp = 30`, `Zr` stays 72): without a shift every planet reports `gearInterference` (its tip 14.4 above the limit 14.2379); with a parameter `shift = 0.3` on the sun and `-shift` on the planets and the ring the warnings are gone, the centre distances are those of the pitch circles, the sun's tip diameter is 13.14 and the planet's 28.26, the checks of the parameters hold and the collision check finds nothing. Shifts that do not balance (the ring left at 0) are the warning `gearMesh` naming the difference. The document saves and loads unchanged.

**docs/requirements.md**, scenario 13, a new item:

   - *Generators (5d, D61): designed, not done yet* ([d36/5d-generators/calls.ts](d36/5d-generators/calls.ts)). Below the base a cycloidal stage for the shoulder: twelve ring pins of radius 2.5 on a circle of radius 25 (one pin and a circular pattern) and a disc over that circle with an eccentricity of 1: 11 lobes, the ratio 11, the outer diameter 47 and the inner 43, its centre 1 mm off the axis; the disc touches no pin with any volume and its smallest gap to them is a few thousandths; a quarter turn of the input and the second disc at π stay clear; a clearance of 0.1 gives a gap of at least 0.1. A pulley of 20 grooves on the motor and one of 40 at the elbow: outside diameters 12.224 and 24.957 (Gates' table), one face `grooves` each. Refused: an eccentricity of 3 (E · N ≥ R) and pins of radius 7 (they overlap), each `invalidProfile` with the reason; a pulley of 10 grooves an invalid command.

## Reviews

Not yet reviewed.

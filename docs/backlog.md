# Podklady pro další funkce

Pracovní dokument. Sbírá funkce, které se zatím nedělají, a u každé říká, na co navazuje a proč ji současný návrh neznemožňuje. Není to plán ani rozhodnutí: co se rozhodne, přesune se do [requirements.md](requirements.md) a [decisions.md](decisions.md). Stručný výčet budoucích funkcí je v requirements.md; tady je rozbor.

Poslední úprava: 2026-11-14

## Jak se sem věci dostaly

Při přípravě rozšíření pro robotický kloub (D35) se každá zvažovaná funkce třídila podle jedné otázky: změnila by později tvar dokumentu nebo příkazů?

- **Ano:** udělala se hned, i když ji kloub sám nepotřebuje. Je jich sedm a jsou v D35 (katalog generátorů profilu, posun začátku vysunutí, recept nástroje jako rozhraní, obecná ID těles, registr typů features s příkazem `updateFeature`, kontroly parametrů, výřez do více těles).
- **Ne:** jde přidat dodatečně jako nová položka, nový typ nebo nová varianta. Ty jsou tady.

## Kandidáti

Pořadí je odhad užitku pro obecné použití, ne závazek.

| Funkce | K čemu je | Na co navazuje, proč nic nezamyká |
|---|---|---|
| Promítnutí geometrie z jiné skici | Společná kostra pro víc dílů: jedna skica s osami, roztečnými kružnicemi a obrysy, na kterou se ostatní skici odkazují. Dnes jde promítnout jen hrana tělesa, takže konstrukční geometrii jiné skici je potřeba překreslit a svázat stejnými výrazy | Odkaz na promítnutou geometrii (`ExternalRef`) má rozlišovač typu; skica přibude jako další varianta vedle hrany. Promítnutí do rovnoběžné roviny stačí na většinu případů, šikmá rovina naráží na elipsu stejně jako u hran |
| Řez nebo obrázek modelu pro AI | AI model nevidí, ověřuje ho čísly (objem, obálka, kolize). Řez rovinou jako seznam smyček nebo obrázek pohledu by jí dal zpětnou vazbu na tvar | Nový dotaz enginu nad tělesy, vedle kolizí a objemu z D35. Řez poslouží i pro „řez modelem v pohledu" v aplikaci |
| Spojení, rozdělení, zrcadlení a přesun těles | Odečíst jeden díl od druhého (dutina podle vloženého dílu, drážkovaný otvor podle kola), rozříznout díl pro tisk, zrcadlový díl, rozložení dílů | Nové typy features v registru. Stojí na obecném pravidlu, že feature může vytvořit víc těles s ID `<feature>/<místní jméno>`. Nové je jen to, že těleso může zaniknout; odkaz na zaniklé těleso je rozbitá reference jako každá jiná |
| Revolve | Řemenice s klínovou drážkou, knoflíky, kužely, drážky pro O-kroužky, zahloubení pro zápustnou hlavu | Jiná stavba nástroje nad stejným profilem; recept nástroje je rozhraní. Osa je `AxisRef` z pole. Popis stěny má obecný druh vedle roviny a válce (kvůli ozubení) |
| Zkosení a zkrut při vysunutí | Úkos stěn, zápustná hlava, šikmé ozubení, přibližný závit | Další stavby nástroje; parametry jsou číselná pole rozsahu |
| Posuvné pole a zrcadlení features | Větrací otvory v řadě, mřížky, souměrné díly | Další druhy transformace v poli; pole je seznam tuhých transformací a zbytek feature se nemění. Zrcadlení navíc obrací orientaci trojúhelníků |
| Další generátory profilu | Cykloidní kotouč, řemenice GT2, řetězové kolo, ozubený hřeben, drážkování, text | Položky katalogu generátorů; tvar dokumentu se nemění |
| Další nástroje skici | Drážka, obdélník středem, odsazení obrysu (lem víka), rozteč děr | Funkce sdíleného modulu nástrojů; engine se nemění. Odsazení obrysu může chtít novou vazbu |
| Nejmenší vzdálenost těles | Ověření vůle (motor v pouzdře má mít 1 mm), ne jen toho, že se díly neprolínají | Další dotaz nad tělesy |
| Vlastnosti těles | Jméno, barva, příznak referenčního dílu (motor se netiskne a nemá se exportovat) | Nepovinný údaj v dokumentu klíčovaný ID tělesa |
| Jména referenčních kót ve výrazech | Parametr odvozený z naměřené hodnoty | Výrazy se vyhodnocují uvnitř přepočtu; jména jdou rozšířit o hodnoty vzniklé přepočtem a tečka je pro ně ve výrazu vyhrazená. Ověření výrazu při příkazu se pro taková jména musí přesunout do fasády enginu, která stav přepočtu má. This is more than a wider name environment (review of 2026-11-14): a parameter derived from a measured dimension can, through another parameter, drive the very sketch it is measured in, and the cycle check between parameters does not see a cycle that goes through geometry. The rules have to be set first: a measured value is available only to features after its sketch, so the value of a parameter that uses it depends on the position on the timeline (undefined before the sketch), and `Evaluation.parameters` and checks need a defined meaning for that |
| Potlačení feature výrazem, konfigurace | Varianty jednoho dílu (s přírubou a bez) | `suppressed` jako další pole s výrazem; kontroly už zavádějí porovnání |
| Komentáře a skupiny parametrů | Čitelnost větší tabulky parametrů | Nepovinné údaje u parametru |
| Export do 3MF | Víc těles se jmény v jednom souboru | Další formát vedle STL; export po tělesech už je |
| Knihovna dílů, vložení jiného dokumentu | Motor, ložisko nebo šroub jako hotový díl místo ručního modelování | Nový typ feature, který vytvoří tělesa z jiného dokumentu; ID features vloženého dokumentu je potřeba odlišit předponou; validace odkazu na stěnu pak potřebuje stejný rozklad ID jako u těles. Import cizí sítě zůstává mimo (nemá pojmenované stěny) |
| Graf závislostí při přepočtu | Rychlost u větších modelů: dnes se přepočítá vše od první změněné feature | Vnitřní věc přepočtu, dokument se nemění |
| Sloučení nástrojů pole před booleanem, prostorové vyhledávání v adaptéru jádra | Rychlost u stovek kopií | Vnitřní věc pole a adaptéru jádra |
| Pootočení kopií v poli kolem vlastní osy | Satelity v záběru i tehdy, když počty zubů nejsou dělitelné počtem satelitů | Další údaj transformace kopie |
| Posunutí profilu ozubení | Kola s málo zuby, úprava osové vzdálenosti | Další parametr generátoru ozubení |

## Co tahle architektura levně nedá

- **Zaoblení a zkosení hran těles.** Těleso je síť, ne přesné plochy. Zaoblení ve skice pokryje svislé hrany, ostatní ne.
- **Sestava s vazbami a pohybem.** Vyžadovala by druhý, prostorový constraint solver. Místo ní je víc těles v jednom dokumentu.
- **STEP a import přesné geometrie.** Vyžadovaly by výměnu geometrického jádra.
- **Jemný detail u velkého modelu.** Adaptér jádra spolehlivě nerozliší detail menší než asi desetitisícinu rozměru modelu těsně u lícujících stěn (u modelu 110 mm kolem 0,01 mm).

## Srovnání s jinými konstrukcemi

Myšlenková zkouška: co by jiný díl potřeboval navíc proti kloubu a jestli to návrh unese.

| Konstrukce | Co potřebuje navíc | Kam to patří |
|---|---|---|
| Krabička na elektroniku s víkem | Díry skrz víko i krabičku; větrací otvory v řadě; lem víka; zaoblené hrany | Výřez do více těles (D35). Posuvné pole a odsazení obrysu později. Zaoblení hran ne |
| Cykloidní převodovka | Profil cykloidního kotouče; výstředník a kolíky umí vysunutí a pole | Katalog generátorů (D35), nová položka později |
| Řemenice, knoflík | Profil GT2; klínová drážka; rýhování | Generátor a pole (D35). Klínová drážka je revolve, později |
| Konzole s žebrem | Žebro vysunuté na obě strany roviny | Posun začátku vysunutí (D35) |
| Držák z více dílů podle společné kostry | Odkaz na geometrii jiné skici | Později; do té doby stejné výrazy ve více skicách |
| Šroubovací víčko, šikmé ozubení | Zkrut při vysunutí | Později |
| Zahloubení pro zápustnou hlavu | Kuželový výřez | Revolve nebo zkosení, později |
| Děrovaný panel se stovkami děr | Výkon: jeden boolean na desce se 192 otvory trval v adaptéru jádra 7,6 s | Riziko; sloučení nástrojů pole a prostorové vyhledávání později |
| Díl kolem kupovaných součástek (motor, ložisko) | Hotové modely součástek; ověření vůle | Ruční zjednodušené těleso dnes; knihovna dílů a nejmenší vzdálenost později |

Závěr zkoušky: žádná z konstrukcí nevyžaduje jiný tvar dokumentu, než jaký zavádí D35. Opakovaně se vracejí tři věci: odkaz mezi skicami, revolve a zpětná vazba na tvar pro AI.

## Direction after D35 (discussion of 2026-11-14)

From a discussion with the owner. The owner confirmed the intended use and, on 2026-11-14, the order of the steps in "Proposed order" (recorded as D36 in [decisions/D36-order-after-d35.md](decisions/D36-order-after-d35.md); the plan of the work is [d36/README.md](d36/README.md)). The designs of the individual features below remain proposals: each step gets its own decision when its work starts.

**Intended use (owner, 2026-11-14).** Design for a 3D printer and tinkering. Brackets and boxes are the base; most parts will be for a robotic arm and similar mechanisms. Models are mostly not drawn by hand: they are built together with an AI through MCP.

**What follows from that.** Comfort of manual drawing matters less. The limits are that the AI does not see the model, cannot tell whether a part prints and fits, and that a robotic arm is built around bought parts (motors, bearings, screws) and has to move without colliding. The table of candidates above was ordered for general use; for this use the order changes:

- Feedback on shape for the AI moves to the top.
- Projection from another sketch moves down: an AI repeats the same expressions in several sketches cheaply. For manual work the old order would hold.
- Reference parts and posing bodies move up; the table has them late or only as a part of another row.

### Candidates the table above does not have

| Feature | What it is for | What it builds on |
|---|---|---|
| Print queries | Overhang area against a given print direction, bounds against the bed size, contact area with the bed. Numbers an AI can judge by itself | Queries over bodies; overhang is a pass over triangle normals. Wall thickness is more expensive and can wait. Detail below |
| Mass properties | Mass (volume, density, fill factor), centre of mass, moments of inertia. For an arm: the torque a joint has to hold is the mass beyond it times the lever | Same kind of integral over the mesh as the volume, which D35 point 5 adds |
| Profile offset | Print clearance of a fit (a hole larger by `clearance` than the peg from the same sketch), wall of a box, lip of a lid, pocket for lightening a link | Cheap variant: a modifier of the profile source of an extrusion, not a new sketch constraint; computed per curve in the engine. Detail below |
| Taper on extrusion | Countersinks, chamfered hole edges, chamfer of the bottom edge against elephant foot, dovetails, 45° faces that print without support. In the table above as "Zkosení a zkrut při vysunutí" | Done (D45): the field `extent/taper`, a stack of rings, tilted planes and cones. Not done: chamfered ends as fields of one extrusion, a taper with "through all" or up to a face, a generated profile, angles per curve |
| Hole feature with a hardware catalog | Clearance hole, counterbore, countersink, nut pocket, hole for a heat-set insert; bearing seats from a bearing catalog. Dimensions recalled by an AI are a source of silent errors, a catalog in the engine removes them | A feature type in the registry; the tool is a stack of cylinders and cones, so the countersink needs the tapered tool. Positions come from sketch points. Detail below |
| Fillet of a sketch corner | Rounded vertical edges; by hand it is an arc, two tangencies and two trimmed lines | Shared sketch-tools module of D35 point 7. Not free of the engine after all: see the detail below |
| Pose of bodies driven by a parameter | Range of motion of an arm without an assembly solver: a move feature at the end of the timeline rotates a group of bodies about an axis by an expression (`q1`); the AI steps the parameter and asks for interference and the smallest gap at each pose | The row "Spojení, rozdělení, zrcadlení a přesun těles" (move is a feature type). With `setParameter`, `check_interference` and undo it works without anything else; a sweep query that does this in one call without touching the history is a convenience. If export for simulation is wanted, the pose should not be a move feature but a value of a joint in a mechanism description; see "Export for simulation" below |
| Subtracting a body with a clearance | Pocket for a motor or a board shaped by the part itself | Body boolean from the same row; the clearance needs a 3D offset (`minkowskiSum` in Manifold), speed not measured |

### Print queries and the features of step 2 in detail

Sketches of a cheap variant for each, in the manner of D35: what the cheap variant is, what it puts into the document, and what stays open. None of them was tried in code.

**Print queries.** One engine query and one MCP tool; the document does not change.

- Input: bodies, a print orientation, a bed size, an overhang angle (default 45° from the vertical). The orientation is either a direction or a face name ("this face lies on the bed"); the face name is the form an AI will use.
- Output per body: bounds in the print frame and whether they fit the bed, height, contact area with the bed, overhang area.
- Overhangs are reported per named face, with area. This is what makes the answer usable: "the overhang is `H3/endCap`" points at the feature to change. Faces are named already, so this costs nothing extra.
- Several orientations in one call, so that an AI can compare the six axis directions and pick one.
- Not in the cheap variant: bridges (a small horizontal hole is reported as an overhang; a lower limit on the area keeps the noise down), wall thickness, the smallest printable detail, an estimate of the support volume.
- Later, if the orientation should travel with the model: a body property (see step 3). Using query results in `checks` runs into the same problem as names of reference dimensions in expressions and is not proposed.

**Profile offset. Done (D44, 2026-11-15; [architecture/extrude.md](architecture/extrude.md), "Profile offset and a wall"), with the wall from a line; what stays open is marked below.** An optional numeric field of the profile source (`profile/offset`, a length, either sign, default 0, an expression is allowed). An optional field does not change the document shape.

- Positive grows the region: the outer loop moves outward and the holes shrink.
- Computed per curve, not on the polyline: a line becomes a parallel line, an arc or a circle changes its radius, neighbours are joined at the intersection of their offsets (mitre). Every curve maps to exactly one curve, so side faces keep their names (`side/<curve>`) and their exact description (plane, cylinder). `ResolvedProfile` in `recompute/state.ts` already has the form this needs (regions plus `curveOf`).
- An outline with tangent corners (a rounded rectangle) gives the same result with mitre and with round joins, so the common case loses nothing.
- Error `invalidProfile` when a curve vanishes (an arc with a radius not larger than an inward offset, a segment that shrinks to nothing), when loops meet after the offset, or when the region vanishes. The cheap variant does not change topology.
- **Not done, by the owner's decision of 2026-11-15 (D44): corner arcs that drop out.** The cavity of a box with rounded outer corners and a wall thicker than the corner radius is the case: the natural result has sharp inner corners, and the offset refuses it with a message that says what to do (a larger radius, or the inner outline drawn in the sketch). The narrow variant to add when a real model runs into it: an arc tangent to both its neighbours is dropped and the neighbours are joined in a sharp corner; everything else stays an error. It is local to the function of the offset. Its costs: a rule that differs from the taper's (which cannot drop curves), and a face that disappears when a parameter crosses the limit, so a reference to it breaks.
- Correction to the first idea of using `CrossSection.offset` from Manifold: it works on polylines, so curve identity is lost (face names, cylinders) and convex corners get new arcs that have no source curve. It stays an option for the full variant (round joins, topology changes), which then needs a name for a corner face.
- Uses: clearance of a fit (`profile/offset: "clearance"` on the cut), a box (cavity is the outline offset by `-wall`, with `start` at the floor), a lid lip, a lightening pocket.
- For a generated profile (`swept` side) the per-curve rule does not apply; the cheap variant allows the offset only for `regions`.
- Deferred: a wall as one feature (the band between a loop and its offset), and the offset as geometry inside the sketch that can be dimensioned against (needs the solver; the row "Další nástroje skici").

**Taper on extrusion. Done (D45, 2026-11-16; [architecture/extrude.md](architecture/extrude.md), "Taper"); what stays open is the "Later" below.** An optional numeric field of the distance extent (`extent/taper`, an angle in radians, open range −π/2 to π/2, default 0).

- The profile at the far end is the profile at the start offset by `distance · tan(taper)`. Positive widens away from the start, the same sign as the offset. The sign convention is a proposal.
- Built as a ruled surface between the two profiles, which is why it comes after the offset: the 1:1 mapping of curves gives the correspondence of vertices for free. Arcs are divided by the larger of the two radii, the same count at both ends.
- Faces: a side from a line is a tilted plane (a sketch can stand on it). A side from an arc or a circle is a cone; `FaceInfo` needs a cone next to the cylinder so that its edges at the caps stay circles that can be projected (the rim of a countersink). Reporting it as `swept` first would work but loses that.
- With "through all" the taper is an invalid command in the cheap variant: the size at the far end would depend on the target.
- Errors as for the offset, evaluated at the far end.
- Uses: countersink (a circle, `taper` of 45°), chamfer of a hole edge, chamfer of the bottom edge of a part (a slab from `profile/offset: -c` over `distance: c` with 45°, the rest straight above it), dovetail, a 45° roof instead of a horizontal overhang.
- Later: chamfered ends as fields of one extrusion (the tool becomes a stack of three sections), which covers most of what an edge chamfer would be used for on prisms. Twist stays a separate row.

**Hole feature with a hardware catalog.** A feature type `hole`: a sketch, a list of its points, a description of the hole, an extent and targets like a cut.

- One feature makes a hole at every listed point, along the normal of the sketch plane. It stores a tool recipe, so a pattern repeats it like any cut.
- The description is a variant by kind: plain, counterbore (head diameter and depth), countersink (head diameter and angle), nut pocket (across flats, depth, rotation). A hole for a heat-set insert or a bearing seat is one of these with catalog values. Every dimension is a numeric field of the catalog, so it takes an expression.
- The tool is a stack of sections along the axis. Plain and counterbore need only cylinders; the countersink needs the cone of the tapered tool, the nut pocket a hexagon.
- **The catalog fills the fields, the document stores the numbers.** A feature that stored `M3` and looked the dimensions up at recompute would change old models whenever the catalog is corrected. So the catalog is data exported by the engine and listed in `describe_api` (and a query for one size), a tool composes the feature from it, and the feature keeps plain numbers or expressions plus a free-text label ("M3 socket head") for people. A print compensation is then an ordinary parameter added in the expression (`3.4 + hole_comp`).
- Catalog content: clearance holes, socket head and countersunk head dimensions, hex nut across flats and thickness, common bearing sizes. They have to be taken from the standards (ISO 273, 4762, 10642, 4032), not from memory. Heat-set inserts have no standard; the entries are typical values and are marked so.
- Why a feature and not a sketch tool: after D35 a hole can be composed from a circle and one or two cuts, but that is one circle per position and two or three features per kind of hole, and changing the screw size means touching all of them.
- Open: names of the faces when the feature has several points (the side name has to carry the point and the section; `FaceName.curve` holds one ID today). Holes on a face that is not planar and directions other than the plane normal are deferred, as are modelled threads.

**Fillet of a sketch corner.** A tool of the shared module: sketch, the corner point, radius.

- Result: an arc with its centre point, two tangencies, a radius dimension (which can be an expression), and the two lines shortened to the ends of the arc.
- Two things in the engine stand in the way, found when checking this against the code:
  - There is no command that changes the end point of a curve (only `addCurve` and `removeEntity`). Shortening a line therefore means removing it and adding a new one, which changes its ID and with it the names of the faces it produced. A command that re-points an end of a curve keeps the ID.
  - A region is identified by the set of curve IDs on its outer loop (`sameRegion`). The arc joins the loop, so every extrusion that uses the region becomes a broken reference. The tool can see the document, so it can return `updateFeature` patches for those features in the same batch; the alternative is a region reference that tolerates an added curve, which is a wider change.
- So the cheap variant is the tool plus a re-point command, with the patches for dependent features in the batch. Filleting a corner of a fresh sketch works without any of that.
- Open: what happens to dimensions and constraints attached to the corner point (keep the point as a free construction point, or move them to the arc ends).

Order inside step 2 follows from the dependencies: offset, then taper, then the hole feature; the fillet and the print queries are independent of the three.

### Proposed order

Confirmed by the owner on 2026-11-14 (D36). Revised the same day, before the confirmation, after going through the future features of requirements.md (see "Future features of requirements.md, assessed" below).

1. **The AI sees and measures.** View image and section through MCP, smallest gap between bodies, measuring between two named entities, mass properties, print queries. Only queries over finished bodies, the document does not change. The image can come from the app's viewport over the bridge; without a connected app it needs its own rasteriser. The section view in the app comes with the section query.
2. **Bracket and box.** Profile offset, a wall from a line (thin extrusion, rib), taper on extrusion (countersinks, chamfered hole edges, chamfer of the bottom edge against elephant foot; with the offset it covers a large part of what "edge chamfer" would give on prisms), hole feature with the catalog, sketch fillet with the command that re-points an end of a curve, linear pattern and mirror of features and bodies, extent "up to a planar face", 3MF export, export of an outline as DXF and SVG.
3. **Around bought parts.** Body properties (name, colour, density, reference flag: not printed, not exported) with a catalog of materials, import of a mesh as a reference body, inserting another document as a part (motor, bearing, servo), boolean of bodies (union, difference, intersection), subtracting a body with a clearance, splitting a body by a plane (two shells of a link, a part larger than the bed, printing without supports), parts list.
4. **Beyond prisms.** Revolve, then chamfer and fillet of straight and circular edges, after a spike.
5. **Mechanism.** Mechanism description (links and joints), pose and the sweep, export for simulation (URDF, MJCF), a plane tilted about a line (links whose axes are not at right angles) and a midplane of two faces, generators for a cycloidal disc and a GT2 pulley, profile shift of the gear.
6. **Sketch.** Derived geometry in a sketch as one mechanism, then what stands on it: projection from another sketch, mirror and pattern in a sketch, the gear as a block in a sketch, import of an outline. Splines from control points. Trim and extend.
7. **Last.** A tube along a path through points (in place of 3D sketches), twist on extrusion with helix and modelled threads, names of reference dimensions in expressions.

Not proposed at all: an assembly with mates and a spatial solver, 3D sketches with constraints, fillets of general edges, collaboration, exact geometry.

Steps 1 and 2 serve any printed part; steps 3 to 5 are what an arm adds; step 6 mostly serves drawing by hand. Each step would get a validation scenario like scenario 9, for example a box with a lid and screw posts for step 2 and a link between two joints (motor pocket, bearing seats, two shells, range of motion without collision) for steps 3 and 5.

### Export for simulation: URDF, MJCF, USD (discussion of 2026-11-14)

The owner asked whether exporting a robot description makes sense here. Claude's view: yes for URDF and MJCF, as an export, because the data such a file needs lives in this tool (geometry, mass properties, joint axes) and every other tool would have to be told them again. Simulation itself, controllers, sensors and convex decomposition belong elsewhere. Not decided.

**What the formats need and the document does not have.** A robot description is a tree of links joined by joints. Each link has a visual mesh, a collision mesh, a mass, a centre of mass and an inertia tensor. Each joint has a kind, a parent and a child link, an axis and limits. The document has bodies and nothing that says which bodies move together or about what.

**A mechanism description in the document**, next to parameters and checks:

- Link: a name and a list of bodies that move as one piece. A body belongs to at most one link.
- Joint: a name, a kind (revolute, continuous, prismatic, fixed), a parent and a child link, an axis (`AxisRef` of D35 point 4: a base axis, or the normal of a sketch plane through a sketch point), limits as numeric fields that take expressions, and a value (the pose). Effort and velocity limits are numbers passed through to the file.
- Rules: the joints form a tree with one root link. A reference to a missing body or link is a broken reference like any other.
- This replaces the move feature proposed for the pose. A move feature hides the structure in the timeline and the export would have to guess it back; a description states it once and serves the posed queries (interference and smallest gap at given joint values, the sweep) as well as the export. It is the kind of choice that changes the document shape later, so it should be made before the pose is implemented.

**What else it stands on** (all proposed above for other reasons): mass properties (step 1); body properties with a density or an explicit mass (step 3). A reference part such as a motor is not printed but does belong in the robot description, with the mass from its data sheet, so "not printed" and "not part of the mechanism" are two different flags.

**The exporter** is a pure function over the evaluation and the mechanism description. The common part builds the link tree with frames, masses and meshes; a writer per format is thin.

- Units: the engine works in millimetres, both formats expect metres and kilograms.
- Frames: a child link frame sits at a point of its joint axis with the orientation of the model, so meshes are only translated and the axis is written as a vector.
- Meshes: one binary STL per link (`toStl` writes binary already). The output is several files (the description and a mesh folder): a folder through MCP, an archive in the app.
- Collision: the visual mesh, or the convex hull per body (`hull` in Manifold 3.5.5; another extension of the kernel port). MuJoCo takes the convex hull of a mesh by itself.
- MJCF can carry more: reflected rotor inertia and a gear ratio of the actuator.

**Limits of the cheap variant.**

- Closed loops are out. URDF cannot describe them at all, so the planetary stage of scenario 9 is exported as one revolute joint between the housing and the carrier, with the gears lumped into the two links as mass. MJCF can couple joints by equality constraints; that is a later addition.
- The inertia assumes uniform density. A printed part has shells and infill, so the density is an effective one, or the mass is overridden by a weighed value.
- USD is not proposed. As plain geometry it gives what 3MF gives; with the physics schema it is a large surface to write and there is no library for it in the project (D2), while the simulators that use USD import URDF and MJCF.

**Cheaper first step.** With mass properties and per-body STL export in place, an AI can write the URDF itself from the numbers the queries return. It works without anything new, but frames and inertia transforms are easy to get wrong by hand; the exporter makes them deterministic.

### Sphere and ellipsoid (discussion of 2026-11-14)

Neither can be made today or after D35: a body is a prism from a sketch of lines, circles and arcs. An approximation by stacked discs is not worth using.

- **Sphere, dome, ball socket, torus** come with revolve (in the table above): a half circle closed by a line on the axis, revolved about that line. No separate primitive is needed. The engine builds the mesh of revolution itself as it builds the prism; the kernel port does not change. The spherical face is of the general kind (no sketch on it, edges not projected), unless `FaceInfo` gets a sphere.
- **Ellipsoid of revolution** needs an ellipse as a sketch curve and then the same revolve. planegcs 1.3.0 has `ellipse` and `arc_of_ellipse` primitives (found in its types, not run); in the engine it is a new curve kind through the sketch, the profile detection and the analysis of freedom, so it is not cheap. The projection of a circular edge onto a tilted plane (requirements.md, future features) wants the same curve.
- **Ellipsoid with three different axes** is a sphere scaled unevenly: a body transform with a general matrix instead of a rigid one. Easy on a mesh (Manifold has `scale`), but cylinders stop being cylinders, so the curved faces of the scaled body fall to the general kind. Not proposed until a part needs it.

### Future features of requirements.md, assessed (discussion of 2026-11-14)

The owner considers moving three groups of the future features of requirements.md here and asked what each would take. Assessed by reading the code and the library types; nothing was tried.

**Sketch**

- **Derived geometry in a sketch.** Not an item of the list but the mechanism four of its items share. Derived geometry is computed from solved entities after the solver ran; it takes part in profiles and face names, later sketches can project it, but it is not a solver variable, so nothing in its own sketch can be constrained to it. That one rule is the limit a user has to know. Projected edges already enter the solver as fixed geometry (`fixed` in `sketch.ts`); derived geometry is the counterpart on the output side.
- **Pattern and mirror in a sketch.** Two variants. As a sketch tool it is a batch of copies tied by existing constraints (mirror by `symmetric`, a circular pattern like the polygon tool); cheap, but the count is not a parameter, and running it again changes IDs and breaks region references, the same problem as the sketch fillet. As derived geometry the count is a numeric field and the copies follow, but they cannot be constrained. For hole positions a pattern of the hole feature does the job without either.
- **Gear as a generated block in a sketch.** The generator output placed into the sketch as derived geometry, so that a gear outline can share a profile with other curves. The gain is small while a gear extrusion followed by cuts works. **Profile shift** is unrelated and cheap: one more parameter of the generator, useful for small tooth counts.
- **Splines.** Cheap variant: a clamped B-spline whose control points are ordinary sketch points. The solver then sees only points; tangency at an end is a constraint on the first or last leg of the control polygon, which existing constraints express. The side face is of the `swept` kind, as for gear teeth. Not in the cheap variant: a point on the spline, tangency in the middle, a spline through given points. planegcs 1.3.0 has `bspline`, `point_on_bspline` and `tangent_at_bspline_knot` (in its types, not run) for the full variant. Use: outlines of covers and grips, cams, shapes that are not arcs.
- **Names of reference dimensions in expressions.** Already in the table of candidates with its problems (a cycle through geometry, a value that depends on the position on the timeline). With an AI as the author it matters less: the AI reads the measured value and sets a parameter.
- **3D sketches.** A sketch that is not confined to a plane: lines, arcs and splines in space with spatial constraints. By itself it makes no body; it is the path for a sweep or the rails for a loft. It is used for tubes and tube frames, cable and hose routes, cooling ducts, frames from profiles. The full form needs a spatial constraint solver, which planegcs is not; the cost is of the same class as an assembly solver. Cheap replacement, when a part asks for it: a path as a list of points (coordinates with expressions, or points of planar sketches) with a corner radius and no constraints, and a tube swept along it, built from cylinders and bends. That covers a cable channel through a link.

**Bodies and features**

- **Extent "up to a face".** The cheap variant, up to a planar face, is done (D47, [d36/2f-upto/design.md](d36/2f-upto/design.md)). Still open: up to a curved face, and up to the next face the tool meets.
- **Linear pattern and mirror of features and bodies.** Further kinds of the transform of the D35 pattern. Mirror reverses the winding, which the transform function of point 4 handles.
- **Chamfer and fillet of edges: realistic in a restricted form.** A body is a mesh, but faces carry an exact description (plane, cylinder) and edges a kind (`line`, `circle`, `coplanar`, `other`), so a tool can be built for two cases:
  - a straight edge between two planar faces: a prism along the edge with a triangular profile (chamfer) or a corner minus a quarter circle (fillet); cut on a convex edge, added on a concave one;
  - a circular edge between a plane and a coaxial cylinder (rim of a hole, top of a boss): the same profile revolved about the axis, so it needs the tool of the revolve.
  - That covers plates, brackets, boxes, bosses and holes. The limit is one a user can see: only edges of the kinds `line` and `circle` can be picked, which is the same distinction the projection of edges already shows.
  - Chamfer first: its faces are planar and can carry a sketch. A fillet face on a straight edge is a cylinder, on a circular edge a general surface.
  - Risks, to be settled by a spike before anything is promised: the ends of an edge (the tool has to stop at the faces that meet the edge at its end points, or it notches a neighbour), a concave edge (the tool lies flush on two faces; the kernel adapter guarantees coplanar faces, D19, not verified for this), a radius larger than the neighbouring face (an error when a face next to the edge would vanish), corners where three fillets meet (creases instead of a spherical patch; three chamfers are exact).
  - Not possible: edges of the kind `other` (where a cylinder meets a cylinder, gear teeth), selection that follows tangent edges, variable radius. Rounding everything with a Minkowski sum was considered and rejected: it is not selective and it destroys face names, so nothing could follow it on the timeline.
  - Taper, the sketch fillet and chamfered ends of an extrusion (step 2) cover most needs before this.
- **Assembly with mates and motion: not realistic here.** It needs a spatial constraint solver for six degrees of freedom per part, there is none in the project, and its failures are the kind a user does not understand (a mate that flips, an over-constrained set with no hint which mate is to blame). What is proposed in its place is the mechanism description (see "Export for simulation"): parts are modelled in place in one document, joints are declared, and a pose is computed by composing transforms down the tree, with no solving. Its limits can be stated in one sentence: a tree of joints, no closed loops. A coupled motion (a planet turning with the carrier) is an expression between joint values. A part used several times is a pattern of bodies, or an inserted part placed by a frame and offsets.

**View and files**

- **Section view.** The item of requirements.md means the view in the app for a person. The AI needs the same cut as data. They share one computation and should be done together:
  - the query: a plane gives, per body, closed loops with areas and, per segment, the face it lies on. A pass over triangles in the engine, no kernel; done that way it keeps face names, which Manifold's `slice` would not;
  - the view: clipping in the renderer hides one side, and the loops of the query give the filled cut surface;
  - for the AI: the loops as numbers (wall thickness in the cut, a cavity that an outside view does not show, gears inside a housing), and a picture of the cut model.
- **Import of files.** Three different things:
  - a mesh (STL, 3MF) as a reference body: realistic. It serves display, interference, smallest gap, subtraction with a clearance, mass and the robot description, which is the role of a bought part. It has no named faces, so no sketch stands on it and its edges are not projected; a bolt pattern is drawn from the data sheet and checked against the imported body. The mesh has to be a closed solid, otherwise the kernel cannot use it and the import says so. Open: where the mesh lives (inside the document, which keeps it self-contained, or a file next to it) and a placement by a frame and offsets;
  - STEP as a mesh: motors, bearings and boards are published as STEP. The statement of requirements.md that STEP needs another kernel holds for export and for exact geometry; reading STEP into a mesh needs only a converter. That would be a new third-party library (D2, approval of the owner); which one, its size and licence were not looked up. Until then the conversion is done outside;
  - an outline into a sketch (DXF, SVG; a board outline with holes from a PCB tool): it enters as derived geometry, not as solver variables, so it belongs to step 6.

### Compared with Onshape, FreeCAD and Fusion (discussion of 2026-11-14)

The owner asked whether something basic is missing. The comparison is from Claude's knowledge of the three tools (Part Studio of Onshape, Sketcher and Part Design of FreeCAD, the Design workspace of Fusion), not from their current documentation, and against this project as it will be after D35 and the steps of D36. The owner agreed to the additions of the first table on 2026-11-14; they are in the steps of D36 now.

**Gaps that are basic and cheap; added to D36**

| Gap | In the three tools | Here | Proposed |
|---|---|---|---|
| Measuring between two entities | A measure tool: distance and angle between faces, edges and points; distance of two axes | `get_body` gives per face its area and normal and per edge its length, ends, centre and radius; nothing measures a pair. The smallest gap of D36 is between whole bodies | A query over two named entities (face, edge, sketch point): distance, angle, distance of axes of two cylinders. Exact for planes and cylinders, because faces carry their description. Step 1; for an AI it is the direct way to check a wall thickness or a centre distance |
| Outline as DXF or SVG | Export of a sketch or a face; full drawings | STL only (3MF in step 2) | Export of the outline of a planar face or of a section as DXF and SVG: plates for laser cutting, drilling templates. A thin writer over the loops of the section query. Step 1 or 2. Dimensioned drawings are not proposed |
| Trim and extend in a sketch; regions from crossing curves | Trim and extend in all three. Onshape and Fusion also split overlapping curves into regions by themselves; FreeCAD does not | Crossing curves are an error of the profile (architecture.md, Profily a oblasti); trim and extend are consciously left out of the UI (ui.md) | Trim and extend as sketch tools. They need the command that re-points an end of a curve, the same one the sketch fillet needs, so that command belongs to step 2 and the tools to step 6. An AI computes end points and does not need them; a person drawing by hand does |
| Wall from a line (thin extrusion, rib) | Thin extrude in Onshape and Fusion, rib in all three | The band has to be drawn as a closed profile | Done (D44): the profile source `wall`, a chain of curves moved by half a thickness to each side. Not done: a wall to one side only, rounded ends, projected curves in a chain, a rib that grows until it meets the body |
| Union and intersection of bodies | Boolean or combine with all three operations | The kernel port has all three; D36 names only the subtraction | Body boolean with union, difference and intersection as one feature. Step 3 |
| Parts list | Bill of materials | Nothing | A query: bodies with their properties, reference parts, and hardware from the labels of hole features with counts. What to print and what to buy. Step 3 |
| Materials | A material library with densities | Density as a body property (step 3) | A small catalog of printing materials with densities that fills the property, like the hardware catalog. Step 3 |
| More planes | Midplane of two faces, plane through three points, plane at an angle | Offset planes; the tilted plane is in step 5 | Midplane together with the tilted plane; it is the natural plane for a mirror. Until then an offset by half an expression does the same |

**Basic in the three tools and not within cheap reach here**

- **Shell.** Hollowing a body to a wall thickness with chosen faces removed. On a mesh it is a spatial offset. For prismatic boxes the profile offset of step 2 replaces it; a shell of a general body is not proposed.
- **Sweep and loft.** A profile along a path, a transition between profiles. Only the tube along a path of step 7 is proposed. Ducts and organic transitions stay outside.
- **Helix, threads.** Modelled threads and springs. Assessed after this comparison as realistic through a generator and a twisted extrusion; see "Helix and modelled threads" below. Added to step 7.
- **Fillet of any edge, variable fillet.** Step 4 gives straight and circular edges only.
- **Exact export (STEP).** A model cannot be handed to another CAD tool or to a machining service as exact geometry. Follows from the mesh kernel (principle 6 of requirements.md).

**Outside the tool on purpose**

Dimensioned drawings, CAM and slicing, strength analysis, sheet metal, surfacing and sculpting, rendering, versions and collaboration (a document is a JSON file, so versions come from the file system or git), units other than millimetres.

**Small things noticed**

- Concentric and collinear exist in all three as named constraints. Here concentric is a coincidence of the centre points; whether collinear can be composed from the existing constraints was not checked.
- Rectangle from the centre and a slot are in the table of candidates ("Další nástroje skici"); text is there as a generator.
- Copying a sketch or a feature. An AI replays the commands; a person would miss it.

**Where this project is ahead for the intended use**

Not a gap, but worth keeping while extending: a broken reference never silently points elsewhere and can be repaired, the sketch diagnosis explains which constraints follow from which, checks guard design conditions on every recompute, and the whole model can be read and changed through MCP with descriptions generated from the engine.

### Helix and modelled threads (discussion of 2026-11-14)

The owner asked for them to be added if they are realistic. They are, and without a sweep along a helix. Nothing was tried in code; the kernel needs a spike before anything is promised.

**Why it is realistic.** A body with a helical shape has the same cross-section at every height, only rotated: at the height `z` it is the section at zero turned by `2π · z / pitch`. A threaded rod, a threaded hole and a spring are therefore an extrusion of one planar profile with a twist. Both halves have a place in the design already: the profile comes from the generator catalog (D35 point 3) and the twist is another build of the tool (the row "Zkosení a zkrut při vysunutí").

**Twist on extrusion.** The tool is built in layers along the normal, each layer turned about an axis that goes through a point of the sketch.

- For a region of a sketch it is a numeric field of the extent (an angle per length, or a total angle) plus the point of the axis.
- For a generated profile the generator states the rate itself, in its result, so the pitch and the twist cannot disagree. A helical gear is then a parameter of the gear generator (the helix angle) and needs nothing else.
- The number of layers follows from `chordTolerance`, as the division of arcs does.
- Side faces are of a general kind: no sketch on them and no projected edges.

**Generator of a helical profile.** A catalog entry that turns a profile given in the axial plane (radius against height over one pitch) into the cross-section, by mapping the height to the angle.

- Thread: operand is a circle of the sketch (the nominal diameter). Parameters: pitch, flank angle, external or internal, clearance, number of starts, left-handed. As with the gear, the internal profile is the shape of the tool that is cut out of the body, wider by the clearance.
- Spring or coil: the same entry with a wire section (round, square) that does not reach the axis.
- A catalog of metric threads (diameter and pitch) fills the parameters, like the hardware catalog: the document stores numbers. The values have to be taken from the standards, not from memory.
- The flank angle is a parameter because the standard 60° profile has flanks that overhang when printed; printed threads often use a steeper profile.

**Limits of the cheap variant.**

- The axial profile comes from the catalog. A thread with a profile drawn in a sketch is the full variant.
- The ends are flat. A lead-in is a separate cut with a tapered or revolved tool; the edge chamfer of step 4 does not apply, because thread edges are of the kind `other`.
- An internal thread is cut into solid material or into a hole clearly smaller than the minor diameter. A hole exactly on it gives coincident cylindrical surfaces, the case the ring gear of D35 avoids for the same reason.
- No tapered threads. The profile has to fit into one pitch, otherwise neighbouring turns intersect; that is an `invalidProfile`.
- Printing sets its own limit: a thread finer than what the printer resolves (small metric sizes) is modelled correctly and prints as a rough cylinder. For those the hole feature with an insert or a nut pocket stays the answer; modelled threads are for larger diameters and for custom ones (lids, fittings).

**To verify by a spike.** The triangle count: one thread of ten turns is tens of thousands of triangles. The kernel adapter was slow on a tool with many faces (192 holes in one boolean took 7.6 s, table "Srovnání s jinými konstrukcemi"), so the time of a boolean with a threaded tool and of a pattern of such tools has to be measured first.

### To verify first

- The kernel port has only `boolean` and `triangulate`. Every new Manifold operation (`slice`, `offset`, `splitByPlane`, `minGap`, `minkowskiSum`) extends it; whether face names survive them was not checked. It matters most for splitting by a plane, which creates a new face that later features will want to sketch on.
- Speed of `minkowskiSum` on a body of the size of the joint housing.
- Still out of cheap reach: lofts and sweeps (cooling ducts, cable channels along a curve), fillets of general edges, exact printed threads.

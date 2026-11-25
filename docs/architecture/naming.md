# Architecture: naming

Part of [architecture.md](../architecture.md), the design as implemented. Names of faces and edges, the plane of a sketch on a face, profiles and regions.

## Pojmenování

### Stěny

Stěna má strukturované jméno odvozené z původu:

```ts
type FaceName = (
  | { feature: Id; role: 'side'; curve: Id }     // z křivky skici; for a generated profile the side name of the catalog (`teeth`)
  | { feature: Id; role: 'startCap' }            // víko na začátku rozsahu (při nulovém `start` v rovině skici)
  | { feature: Id; role: 'endCap' }              // protější víko
  | { feature: Id; role: 'wallSide'; curve: Id; side: 'left' | 'right' }   // a side of a wall along curves (D44)
  | { feature: Id; role: 'wallEnd'; point: Id }                            // a straight end of such a wall
  | { feature: Id; role: 'holeBore'; point: Id }                           // the bore of a hole at a point (D46)
  | { feature: Id; role: 'holeHead'; point: Id }                           // the cylinder of a counterbore or the cone of a countersink
  | { feature: Id; role: 'holeFlat'; point: Id; flat: number }             // a side of the hexagon of a nut pocket, from 1
  | { feature: Id; role: 'holeSeat' }                                      // the step between head and bore, one face for all points
  | { feature: Id; role: 'mesh' }                                          // the whole surface of an imported mesh (D55)
  | { feature: Id; role: 'splitFace' }                                     // the face a split cuts, on both bodies (D56)
  | { feature: Id; role: 'chamfer'; edge: number }                         // the chamfer of the edge at that place of `edges`, from 0 (D63)
  | { feature: Id; role: 'fillet'; edge: number }                          // the fillet of the edge at that place of `edges`, from 0 (D63)
) & { copy?: { pattern: Id; index: number }[] }; // a face of a copy made by a pattern, or of a pocket a combine with a clearance left (D56)
```

The faces of a wall (a profile of the type `wall`, [extrude.md](extrude.md), "Profile offset and a wall"): every curve of the chain makes two sides, told apart by the side of the curve in its own direction, and every free end of an open chain makes an end named by the sketch point the chain ends at. A profile of regions with an offset adds no role: its side faces keep `side` with their curve.

The faces of a hole ([hole.md](hole.md)) are named by what they are and by the point, not by a count of sections, so the bore keeps its name when a plain hole becomes a counterbore or a point is added. The seat, the mouths (`startCap`) and the bottoms (`endCap`) are one face each for all points of the feature, as the caps of an extrusion with several regions are.

Víko nenese označení oblasti. Všechna víka jedné extrude leží v jedné rovině, takže tvoří jednu logickou stěnu, i když je extrude složená z více oblastí. Nový výběr profilu tak víko nepřejmenuje a skici na něm se nerozbijí.

Každý trojúhelník tělesa nese číslo stěny, tabulka čísel → jmen patří k výsledku přepočtu. Čísla se neukládají, ukládají se jen jména.

| Situace | Chování |
|---|---|
| Booleovská operace | Trojúhelník dědí jméno stěny, ze které pochází. Horní stěna kvádru je i po vyříznutí díry „endCap extrude E1". |
| Stěna se rozdělí na víc částí | Zůstává jednou logickou stěnou (nesouvislou). |
| Stěna zanikne | Jméno nemá žádný trojúhelník → reference je rozbitá → feature je v chybě. |
| Dvě stěny splynou do jedné roviny | Zůstávají dvě stěny s různými jmény. |
| Kružnice nebo oblouk | Všechny segmenty mají stejné jméno, válcová plocha je jedna stěna. |
| A copy made by a pattern | The face has the name of the face it copies with `copy` added: the pattern and the number of the copy. The original keeps its name. The copy of a grid i steps along the first direction and j along the second has the number i + 1000 · j (D53, [pattern.md](pattern.md)): one tag per face as for a row, a number with gaps that does not depend on the counts, so a larger count renames no face. `faceKey` appends `/@<pattern>:<index>` as for a row; nothing compares the numbers of two tags as numbers. |
| A combine without a clearance (D56) | The faces keep their names, from the target or the tool; where a face of a tool lies flush on one of the target and they overlap, the overlapped part takes the tool's name (an intersection: the target's). A face may lie on two bodies, the target and a kept tool. |
| A combine with a clearance (D56) | The faces a tool leaves are new faces: the name of the face of the tool with `{ pattern: <combine>, index: <the place of the tool in tools> }` appended, described by the moved surface. A crescent of a tool that only marks where two of its faces cross has no face in the pocket ([combine.md](combine.md)). The registry member `tagsFaces` says which features may stand in a tag. |
| A split (D56) | Both bodies get the cut face `{ feature: <split>, role: 'splitFace' }`, one name on two bodies; the other faces keep their names on the part they lie on. A face of the body in the plane keeps its name, but under an overhang the part the cut face lies on takes its name. |
| A chamfer or a fillet of edges (D63) | One new face per edge, `{ feature, role, edge }`, the role `chamfer` or `fillet` and `edge` the place of the edge in the list from 0, whatever the pieces of the edge; the faces of the edge keep their names and get narrower. What a tool leaves in the plane of a face it ends at (the riser of a step, the end faces of an added fillet) takes that face's name; a cap where two tools meet goes to the blend. Taking an edge out of the middle of the list renames the faces of the edges after it ([edge-blend.md](edge-blend.md)). |
| A side of a generated profile | All its segments have one name from the generator catalog: the teeth of a gear are one face `{ feature, role: 'side', curve: 'teeth' }`. The name does not depend on the operand, so another pitch circle does not rename the face. |
| A body an insertion brought (D62) | Every face keeps the name it has in the inserted document with every feature ID in it prefixed `<insertion>/`: `feature` and the `pattern` of every tag; the fields of the role stay. Tags of patterns of this document that copy the body afterwards come after them, unprefixed. See "Faces of an insertion" below. |

The analytic description of a face (`FaceInfo` in `solid.ts`, internal) has five kinds: a plane, a cylinder, a cone (the side of an arc or a circle of a tapered extrusion, D45; the head of a countersink, D46), a general surface swept along the extrusion axis (the side of a generated profile) and the surface of an imported mesh (`surface: 'mesh'`, D55: published as `general`, unchanged by a transform; it may have flat regions, which nothing sees). Only a plane can carry a sketch, and an edge is a circle where its two surfaces meet in one (`circleBetween`, [extrude.md](extrude.md), "Taper").

**Roles (D37).** The roles are a closed union in `types.ts`, one member per role, because that is what an AI reads. The catalog `FACE_ROLES` (`face-roles.ts`) says for every role how it is called and names every field that tells apart the faces of that role within one feature (`curve` for `side`, none for a cap), each a text or a whole number and always present. The validator of a face name (`faceName` in `validation.ts`), the key of a face (`faceKey`) and the label the MCP tools print are built from the catalog, and the app imports `faceKey` instead of keeping a copy. A feature type that names faces in a new role adds one member to the union and one entry; the compiler ties the two (a role without an entry, an entry without a field of the name or with the other kind do not compile), and the app's own table of texts (`ROLES` in `issue-text.ts`) is typed by the union as well. The key is `<feature>/<role>`, then the values of those fields in the alphabetical order of their names, then `/@<pattern>:<index>` for every copy tag; for the three roles of an extrusion that is the key it always was, which the fingerprints of solved sketches and the face table depend on (a flat of a nut pocket: `H/holeFlat/2/p1`). A text field may hold any ID a sketch can have, also a derived ID with its slash (the point of projected geometry `rim/center`, the copy of a mirror or pattern `m/1/c2`, D68). **A text field that holds a slash or starts with a quotation mark is written as a JSON string** (`lid/side/"m/1/c2"`, `lid/side/"m/1/c2"/@p:2`, `H/holeBore/"rim/center"`), as the key of an insertion quotes its inner key: a field that is not quoted has no slash and does not start with a quotation mark, and a quoted one ends at its closing quote, so a key reads back in one way and no two names share a key (`face-roles.test.ts` checks it over every name of a small alphabet, for the roles of the catalog and for a role with two texts). Quoting a field with a slash alone is not enough for a role with two texts: `{ curve: '/', side: '"' }` and `{ curve: '"', side: '/' }` would share a key. A face whose curve or point ID starts with a quotation mark, which a caller may choose, got another key with D68; keys are never stored. No face of the timeline before D68 had a slash in such a field.

**Surfaces (D37).** The evaluation publishes what a face is, next to its name: `faceSurfaces[number]`, derived from `FaceInfo` by `surfaceOf` in `solid.ts`.

```ts
type Surface =
  | { kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { kind: 'cylinder'; origin: Vec3; axis: Vec3; radius: number }   // origin: a point of the axis
  | { kind: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number }      // the side of an arc or a circle of a tapered extrusion (D45)
  | { kind: 'swept'; axis: Vec3 }                                    // a planar curve moved along `axis`: gear teeth
  | { kind: 'general' };                                             // the surface of an imported mesh (D55); later a revolve of an arc, a twist, a fillet
```

A surface has no side: `normal` of a plane and `axis` of a cylinder carry no sign (the axis of a cone is the exception, it points from the apex towards the face). Which side the material is on belongs to the face of a body. `FaceInfo` stays internal, because it also keeps what only the engine needs (the `y` direction of a planar face, from which the frame of a sketch on it is built). The list is kept by the identity of the face table, so states with the same faces share one list. The surfaces are where the model was modelled.

### Faces of an insertion (D62)

A face of a body an insertion brought ([insert.md](insert.md)) is named by its name in the inserted document with the prefix `<insertion>/` on every feature ID: `{ feature: 'b1/ring', role: 'side', curve: 'outer' }`; two levels down `{ feature: 'kit/b/ring', role: 'endCap', copy: [{ pattern: 'kit/b/p', index: 1 }] }` (`insertedFaceName` of `recompute/insertion.ts`). Edges are pairs of face names, so they follow.

- **The rule of form** (`faceName` of `validation.ts`, at every level): a tag whose `pattern` has a slash needs a `feature` with a slash; when `feature` has one, the tags whose `pattern` has one come first, all with the owner of `feature` (the part before its first slash), the tags after them have none, and the name with that owner stripped from `feature` and from those tags obeys the same rule. Every name the recompute makes obeys it.
- **The key** (`faceKey` of `face-roles.ts`): for a face of an insertion `<insertion>/`, then the key of its name there written as a JSON string, then the tags of this document: `b1/"ring/side/outer"`, `b1/"ring/side/outer"/@q:2`, `kit/"b/\"ring/endCap/@p:1\""`. An ID may hold `@` and `:`, so the plain concatenation would not be unambiguous once an ID holds a slash; a JSON string ends at its closing quote. The key of a face of this document does not change. Messages print the plain concatenation (`faceText`), which is no identity.
- **A name is found by its key and then compared.** Before D68 a text field of a role took any text unquoted, so a name no feature makes could key like a real one (`{ feature: 'ring', role: 'side', curve: 'outer/@p:1' }` keyed like the side `outer` of the copy `@p:1`); since the key quotes a field that could hold a separator, no two names share a key, and the comparison stays as what holds if a later role breaks the rule. Every place that looks a face up by its key takes it only when the name at that number is the name asked for, field by field (`faceNumber` of `util.ts`: the frame of a plane on a face, the surface and the face number of a query), and an edge only when both of its faces are (`sameEdgeName`: the projection of an edge, the queries `measure`, the entities of a query, the arguments of a query).
- **A reference** to a prefixed ID refers to its owner, which must be an insertion before the referring feature (the reference kind `insertion`; `faceRefs`, `requireFace`); an unprefixed `feature` is a feature that names faces and an unprefixed tag a pattern, as before. Nothing inside the inserted document is checked by a command: whether the face is there is the recompute's question.

### Hrany (D22)

Hrana je rozhraní dvou různě pojmenovaných stěn. Jejím jménem je neuspořádaná dvojice jmen stěn:

```ts
interface EdgeName { a: FaceName; b: FaceName }   // a < b v lexikografickém pořadí zápisu feature/role/curve
```

- Hrana existuje, pokud v síti sousedí aspoň jedna dvojice trojúhelníků s těmito jmény. Jinak je reference rozbitá.
- Hrana rozdělená na víc úseků zůstává jednou logickou hranou.
- Přímá hrana (obě stěny rovinné a různoběžné) leží na průsečnici jejich analytických rovin. Poloha a směr přímky se počítají analyticky, ze sítě se bere jen rozsah (krajní body).
- Přímka je orientovaná směrem n_a × n_b, kde `a`, `b` jsou stěny v kanonickém pořadí jmen a n jejich normály ven z tělesa. Krajní bod `<id>/a` promítnuté úsečky je ten s menším parametrem v tomto směru. Pořadí konců se tak při přepočtu neprohodí.
- On a copy made by a pattern the ends are those of this rule, not those of the source carried over (D53). A mirror reverses the cross product, so on a mirrored copy `<id>/a` is normally the image of the source's `<id>/b`; and a copy tag appended to both keys can turn their order where one key begins the other (`edge` and `edge-2`; a face and its own mirrored copy on a body copied later), which swaps the ends on a shifted or turned copy and cancels the swap on a mirrored one ([pattern.md](pattern.md), "The order of two face keys").
- Krajní body mají přesnost sítě (viz Přesnost u SolidKernel). Přímka samotná je přesná. Geometrie přichycená na krajní bod proto dá stěny nástroje jen téměř koplanární se stěnami tělesa; s tím počítá záruka jádra č. 3.
- Hrana mezi dvěma stěnami v téže rovině (výstupek zarovnaný s horní stěnou) má druh `coplanar`. Průsečnice neexistuje a hranice nemusí být přímá. Nekreslí se a nejde promítnout. „V téže rovině" znamená, že normály obou stěn svírají úhel pod úhlovou tolerancí enginu. Přesná rovnoběžnost nestačí: stěna z úsečky přichycené na krajní body promítnutých hran je od stěny tělesa odkloněná o zlomek úhlové vteřiny a průsečnice takových rovin by vyšla kilometry daleko.
- Hrana se vrací jako seznam úseček (`segments`), ne jako jedna lomená čára: hrana rozdělená výřezem má víc nesouvislých úseků a jedna čára by je spojila přes prázdný prostor.
- A circular edge is where the surfaces of its two faces meet in a circle (`circleBetween` in `surfaces.ts`): a plane across the axis of a cylinder or a cone, a cylinder and a cone about one axis, two cones about one axis (D45). The centre and the radius are computed from the two surfaces; the mesh only shows that the edge exists.
- D58 ([revolve.md](revolve.md)) adds the sphere and the torus and replaces the test by `circlesBetween`, every circle two surfaces meet in, with `circleBetween(a, b, points, tolerance)` choosing of two by the points of the edge and the reach of each circle; the pairs above give the circles they gave before. `analyzeBody` decides the kind after the segments of the edge are collected and takes the chord tolerance of the document (`State.chordTolerance`). A revolve names its faces as an extrusion of the same profile (`side` with the curve, `startCap`, `endCap`, the `wall…` roles); a curve along its axis has no face.
- D63 ([edge-blend.md](edge-blend.md)): a chamfer meets its planes in `line` edges, a cone or a torus of a circular edge meets its coaxial faces in `circle` edges, a fillet cylinder meets the planes it touches in `other` edges (a plane touching a cylinder) and a plane across it in a `circle`; the joins of the tools of a chain or a mitre of fillets are `other`.
- Other edges (a cylinder or a cone cut by a tilted plane, two cylinders also on one axis, a cone and a tilted plane of a tapered extrusion, the edge of a cap with the side of a generated profile) have the kind `other` and cannot be projected.

Pojmenování hran je zároveň předpokladem pro budoucí rovinu nakloněnou kolem hrany; the chamfer and the fillet of edges (D63) name their edges so.

### Rovina skici na stěně

Počítá se analyticky z definice feature, ne prokládáním trojúhelníků. Souřadný systém je pravotočivý a jeho normála míří vždy **ven z tělesa**:

| Stěna | Počátek | Osa Y | Normála N |
|---|---|---|---|
| víko | počátek rodičovské skici promítnutý do roviny víka | osa Y rodičovské skici | ven z tělesa |
| boční stěna z úsečky | počáteční bod úsečky (`a`) v rovině rodičovské skici | normála rodičovské skici | ven z tělesa |
| a side from a line moved by an offset, a side of a wall from a line | the start of the moved line in the direction of the sketch curve: the mitred corner, so it moves with the offset or the thickness | the normal of the parent sketch | out of the body |
| an end of a wall | its corner on the left of the end curve (in the direction of the curve) | the normal of the parent sketch | out of the body |
| boční stěna z kružnice nebo oblouku | není rovinná → chyba `nonPlanarFace` | | |
| the side of a generated profile | not planar → error `nonPlanarFace` | | |
| a side of a revolve from a line across its axis (D58) | the start `a` of the line turned to the start of the turn | the direction the angle grows at the start | out of the body |
| the caps of a partial revolve (D58) | the origin of the parent sketch turned to the start or the end | the Y axis of the parent sketch turned likewise | out of the body |
| any other side of a revolve (a cylinder, a cone, a sphere, a torus) | not planar → error `nonPlanarFace` | | |
| a chamfer of a straight edge (D63) | where the chamfer meets the first face of the edge (`a` of its name) at the end the projection of the edge calls `a` (the smaller parameter along n_a × n_b) | along the edge in that direction | out of the body |
| a chamfer of a circular edge that is a plane across its axis (D63) | as a side of a revolve from a line across its axis, the turn starting at the radial direction of the start of the piece (the model's X projected for a whole circle) | the direction the angle grows there | out of the body |
| any other face of a chamfer or a fillet (a cone, a cylinder, a torus, a sphere) | not planar → error `nonPlanarFace` | | |

Osa X se dopočítá jako Y × N. Nezávisí tedy na pořadí bodů úsečky ani na orientaci smyčky.

**A curve re-pointed (D52).** A side face is named by its curve and a region by the curves of its outer loop, so `setCurvePoint`, which keeps the ID of the curve, keeps those names; that is why the fillet of a corner keeps every face of the body under its name and only adds the round face `side` (or `wallSide`) of the arc. What follows the new point is the geometry: the origin of a planar side face is the start `a` of the line, so a sketch or a plane on the side face of a line whose start was re-pointed moves along the line (the fillet names such features in `ids.moved`), and the straight end of a wall is named by the point its chain ends at (`wallEnd`), so it is renamed when that end is re-pointed.

On a face of a mirrored copy (D53) the rule is the same: the origin and the Y axis are the images of those of the source face, the normal points out of the copy, and X = Y × N is the opposite of the image of the source's X. A sketch on a face of a mirrored copy is right-handed like every sketch and is not the mirror image of the same sketch on the source face: its `x` coordinates run the other way. A mirror of a mirror (an even number of mirrors among the tags of a face) is a turned copy again.

Směr „ven" se bere ze sítě: je to součet normál všech trojúhelníků s daným jménem vážený plochou. Jediný trojúhelník by mohl být úzký a dát špatné znaménko. Síť zároveň ověří, že stěna stále existuje. Ze sítě se bere jen znaménko, poloha a osy jsou analytické.

Důsledek: kladná `distance` (i kladný `start`) u extrude ze skici na stěně vždy znamená ven z tělesa, záporná dovnitř.

**Vlastní rovina** (`PlaneFeature`) přebírá souřadný systém základu posunutý o `offset` ve směru jeho normály; with the optional parts of D60 the frame is built as the next section says.

### The plane feature (D60)

The design and its reasons are [d36/5c-more-planes/design.md](../d36/5c-more-planes/design.md). The step (`features/plane.ts`) builds the frame in a fixed order, in the state before the feature, each part optional but the base:

1. **The base**: `frame(base)` as for the plane of a sketch (a base plane, a plane feature, a planar face with the normal out of the body). Errors: `brokenReference`, `nonPlanarFace` with the base in `refs`.
2. **The midplane** (`midplaneWith`): `frame(midplaneWith)` with the same errors and that reference in `refs`, then `midplaneFrame(base, second)`. With `n1`, `n2` the normals and `s1`, `s2` the signed distances from the two planes: when `n1 · n2 ≤ sin(ANGLE_TOLERANCE)` (the normals look away from each other, or are at a right angle within the tolerance, so that two perpendicular faces of a turned body do not choose by the noise of their product) the plane `s1 = s2` with the normal `normalize(n1 − n2)`, otherwise the plane `s1 = −s2` with the normal `normalize(n1 + n2)`; both vectors are at least √2 long, so it never fails. That is the bisector nearer to the base (the base turned by at most 45°), and for parallel planes the plane in the middle with the normal of the base. The frame is the frame of the base turned by the smallest rotation that takes `n1` to the new normal (about `n1 × n`; written as `v c + k × v + k (k · v) / (1 + c)`, stable for a small turn), its origin moved along the new normal into the midplane. It does not know where material is: two faces at a convex edge with an inner angle above 90° (neighbouring sides of a hexagonal prism) give the plane outside the body that touches it along the edge; the plane of symmetry is that midplane tilted by π/2 about the edge projected as a line. Where the two normals pass through a right angle the choice switches.
3. **The tilt** (`tilt: { axis, angle }`): `axis(tilt.axis, state)` (its errors end the step), then `tiltedFrame(frame, line, angle)`: the axis has to be parallel to the plane of steps 1 and 2 within `ANGLE_TOLERANCE` (the sine of its angle to the plane at most `sin(1e-4)`), otherwise `invalidAxis` with the axis in `refs` and the angle in the message; its direction is then made exactly parallel (the part along the normal removed). The frame is moved along its normal until it contains the point of the axis and turned about the axis by `angle` (Rodrigues; the right-hand rule about the direction of the axis): its origin about the point of the axis, its x, y and normal as directions. So a point of the base plane on the axis keeps its sketch coordinates on the tilted plane, the angle 0 gives the base moved onto the axis, and the origin turned with it may lie far from the axis (131 mm up for a hinge 230 mm from the origin of its sketch).
4. **The offset** along the normal of the plane of steps 1 to 3.

The frame is published in `FeatureResult.plane` and `state.planes`, as before; a tilted plane also tells in its facts `axisPoint` and `axisDirection` (the axis used, its direction made parallel), from which the app draws the axis. A plane with neither optional field is the plane of before, to the last bit. `midplaneFrame` and `tiltedFrame` are exported pure functions over frames; the engine tests call them directly.

**Document and validation.** `planeFeature` reads `midplaneWith` with `planeRef` and `tilt` as an object with exactly the fields `axis` (`axisRef`) and `angle` (`fields.number` at `tilt/angle`, `TILT_ANGLE`: radians from −π to π, both included, **without a default**). The references are `planeRefs(base, 'base')`, `planeRefs(midplaneWith, 'midplaneWith')` and `axisRefs(tilt.axis, 'tilt/axis')`, so a second plane or an axis of a later feature is an invalid command and `moveFeature` keeps a plane behind them. `updateFeature` may change `base`, `offset`, `midplaneWith` and `tilt`: the tilt merges by fields and its axis (a reference) is replaced whole, so `{ tilt: { angle } }` changes the angle of a plane that has a tilt and is refused on one without (the axis is missing); `{ midplaneWith: null }` and `{ tilt: null }` remove them (the module's `removable`), with the expression of `tilt/angle`. `setField` reaches `tilt/angle` only on a plane that has a tilt (D44: the field has no default). The upgrade step `5c-more-planes` ([api.md](api.md), `load`) makes a build without these fields refuse a document instead of dropping them.

### The axis of a round face (D60)

`AxisRef` has the kind `face` (`{ kind: 'face', body, face }`), the axis of a round face of a body, for every consumer of an axis (a pattern, its grid, a joint, the tilt of a plane, the revolve, the argument `axis` of a query). The body and the face are validated as for a sketch on a face (`requireRef` of the body, `requireFace`: the feature that named the face and every pattern of its copy tags before the referring feature); `axisRefs` lists the body, the face source and the patterns.

`axis()` (`recompute/services.ts`): the body has to be in the state and the face on it (`analyzeBody(…).normalSum`), otherwise `brokenReference` with the body or the face in `refs`. A cylinder gives the line through its `center`, a cone through its `apex`, a torus through its `center`, each along the unit `axis` of its surface turned to point along `along`; a plane, a sphere, a swept or a general surface is `invalidAxis` with the axis in `refs` and the detail "the face is a plane and has no axis" (or "a surface of the kind sphere").

**The sense** is the one the build gives the face, `along` of the round members of `FaceInfo` (`solid.ts`; internal, `Evaluation.faceSurfaces` publishes the surfaces as before). It is required on the cylinder, the cone and the torus, so that a later build of round faces does not compile until it says which sense it gives. `axis` of a surface does not carry it: a cylinder's has no sign, and a cone's points from its apex to the face, so it turns round with the sign of a taper or the direction of a hole.

| Build | `along` |
|---|---|
| the side of an arc or a circle of an extrusion (`buildPrism`) | `frame.normal`, the normal of the sketch |
| the cone of a tapered side (`recompute/taper.ts`) | `[0, 0, 1]` in the coordinates of the sketch, mapped to its normal by `local` of `buildStack` |
| the bore, the counterbore and the countersink of a hole (`features/hole.ts`) | `[0, 0, 1]` likewise, whichever way the hole goes |
| a cylinder, a cone or a torus of a revolve (`recompute/tool-revolve.ts`) | the direction of the axis of the revolve |
| a copy of a pattern or of a mirror (`transformFace`) | moved as `axis` is; a mirrored copy has the mirror image |
| a tool moved outwards by a clearance (`movedOutwards`, 3d) | kept: the face keeps its axis |

So the axis of a bore of an extrusion or of a hole is the normal of its sketch: out of the body for a sketch on a face, and a joint about a bore drilled from the top turns counter-clockwise seen from above. In a posed query the axis of a face moves with its body (`query/context.ts`), while a `sketchLine` projected from the edge of that bore stays as modelled.

### Profily a oblasti

**Spojování bodů.** Dva body skici se pro účely profilu považují za jeden, když je to tentýž bod, nebo když je spojuje vazba `coincident`, která je v použitých polohách skutečně splněná (vzdálenost do délkové tolerance enginu). Samotná existence vazby nestačí: konfliktní `coincident` mezi dvěma rohy obdélníku, která se nesplnila, profil nezmění. Spojování je tranzitivní a jde i přes počátek a promítnuté body: dva konce přichycené vazbou ke stejnému promítnutému bodu jsou jeden vrchol grafu.

**Graf.** Křivky skici (bez konstrukčních a promítnutých) tvoří rovinný graf. Křivky se smějí dotýkat jen ve spojených bodech. Když se dvě křivky kříží nebo se k sobě jinde přiblíží pod délkovou toleranci, třeba proto, že se profil po vyřešení sám protnul, je profil neplatný a extrude nad touto skicou skončí v chybě `invalidProfile`. Totéž se ověřuje ještě jednou po rozdělení oblouků na úsečky, protože těleso vzniká z lomených čar a ty se od oblouku liší až o `chordTolerance`: když se hranice oblastí po rozdělení kříží (křivka míjí oblouk těsněji, než dělení rozliší) nebo oblast splaskne do dvou bodů (je tenčí než tolerance), je profil také neplatný. Engine tak jádru nikdy nepředá síť, která není uzavřeným tělesem. Platí to i pro tečný dotyk: kružnice tečná k hraně obdélníku, pokud nejsou jedna z nich konstrukční, zneplatní profil celé skici. Je to záměrně přísné a jednoduché; těleso s nulovou tloušťkou stěny by stejně vzniknout nemohlo.

**Oblast** je omezená stěna tohoto grafu, tedy nejmenší uzavřená plocha, kterou křivky ohraničují. Obdélník rozdělený příčkou má dvě oblasti, ne tři. Křivky, které žádnou plochu neuzavírají, se ignorují. Oblast může mít díry: jsou to hranice dalších, do ní vnořených souvislých částí grafu.

```ts
interface RegionRef { outerLoop: Id[] }   // ID křivek na vnější hranici oblasti, seřazená
```

Díry se v referenci neukládají, odvozují se při přepočtu. Když se do skici přidá další kružnice uvnitř obdélníku, oblast „obdélník" ji automaticky dostane jako díru.

Když některá oblast z `regions` neexistuje, extrude skončí celý v chybě `noProfile`. Částečný výsledek se nevytváří. Pravidlo je záměrně striktní: i náhrada jedné křivky hranice jinou mezi stejnými body oblast zruší a uživatel musí profil vybrat znovu. Identifikace hranice body by to obešla, ale je nejednoznačná, když dva body spojuje víc křivek.

**Sousední oblasti.** Boční stěna vznikne jen z křivky, která leží na hranici (vnější nebo na hranici díry) právě jedné z vybraných oblastí. Křivka sdílená dvěma vybranými oblastmi se vyruší. Platí to pro příčku mezi dvěma polovinami obdélníku i pro kružnici mezi obdélníkem s dírou a kruhem v té díře. Jinak by uvnitř tělesa zůstala stěna.

Omezení PoC: oblasti vzniklé křížením křivek se nedetekují, křížení je chyba (viz výše).

**The broad phase (D68).** The profile does not test every pair of curves: each curve has a box (a line its two ends; a circle its centre and radius; an arc its two ends as given, the point where it ends on the circle of its first end, and the ends of that circle's diameters along x and y that it passes, since an arc is read as the circle of its first end between two angles and in a sketch that is not solved its second end may lie off that circle), and a pair is tested only when the two boxes, each widened by the length tolerance, overlap (`nearPairs` of `sketch.ts`: the boxes sorted along x and swept, the pairs in the order of the double loop they replace). It is exact: a pair the test rejects has a point within the tolerance of both, which lies in both widened boxes, or is two rounds on one circle, whose boxes coincide; a line of no length is paired with everything, as the test rejects it with every curve. A part of the graph is a hole of a face only when its sample point lies in the box of the face's boundary (an arc taken as its whole circle and its two ends, which is what the ray test reads; outside that box the ray crosses the boundary an even number of times or not at all). The check of a moved outline (`touchingCurves`) uses the same pairs and answers the same first pair. 200 slots in a rectangle (804 curves) take 9 ms where the double loop took 350.

**Regions after a cut (D65).** Crossing curves are repaired by the sketch tools `split` and `trim` ([sketch.md](sketch.md), "Trim, extend and split"): every crossing becomes a common point and each piece is a curve of its own, so the regions between crossing curves get names that tell them apart (a line through a circle gives `{k, middle}` and `{k', middle}`, the arc that keeps the ID of the circle and the new one). The piece with the start of a cut curve keeps its ID, so a side face named by it keeps its name; the other pieces name new side faces. A region a cut changes is followed by geometry, not by names: it is replaced, in the same batch, by every region after the cut that holds a face of the cut sketch lying inside the region as it was (the face rule). A split region is replaced by all its parts, so the body does not change; a region merged with a neighbour by a trim follows into the merged region; a region that is opened is dropped. The region as it was keeps the holes the profile would give it had the curves that do not cross its outline been cut first, so the answer does not depend on the order of the tools. A region whose name stays while one of its holes is opened or closed is not patched (its reference is right) and its feature is listed in `reshaped`. The edges of chamfers and fillets on the side faces of a cut curve are rewritten to its pieces in the same batch, each edge keeping its place in the list, since a face of the blend is named by that place.

**A spline in a profile (D70).** Its side face is one face for the whole spline, open or closed, `{ feature, role: 'side', curve: <spline> }`, a swept surface along the extrusion (the prism builds the side of the shape `general` so, as for gear teeth); its edges are of the kind `other`, also the straight one where it meets a planar side, so they are not projected, chamfered or filleted, and an edge that ends at a spline face or runs on smoothly into one of its edges is refused too: an edge can be chamfered or filleted only when it is not an edge of a spline face and neither of its ends lies on one. A copy of 6c is named by the copy, `m/1/c2`. No rule of names changes.

**Projected curves in a profile (D69).** A projection from another sketch with `regions: true` is a curve of its sketch like an own one for the profile: its side face is named by the ID of the entry, `{ feature, role: 'side', curve: 'sh0' }` (the bore of a standoff of scenario 15 over the projected hole circle `sh0`), and its ends are the points of the entry (`rl0/a`, `ra0/start`). The ends of such curves are joined to each other and to an own end at their place by position, in 6c's stage, not by keys; the name of a face never depends on which curve of the source the entry projects, so a repair to another source of the same kind (`updateExternal`) keeps every name built on the entry.

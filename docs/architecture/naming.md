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

The analytic description of a face (`FaceInfo` in `solid.ts`, internal) has five kinds: a plane, a cylinder, a cone (the side of an arc or a circle of a tapered extrusion, D45; the head of a countersink, D46), a general surface swept along the extrusion axis (the side of a generated profile) and the surface of an imported mesh (`surface: 'mesh'`, D55: published as `general`, unchanged by a transform; it may have flat regions, which nothing sees). Only a plane can carry a sketch, and an edge is a circle where its two surfaces meet in one (`circleBetween`, [extrude.md](extrude.md), "Taper").

**Roles (D37).** The roles are a closed union in `types.ts`, one member per role, because that is what an AI reads. The catalog `FACE_ROLES` (`face-roles.ts`) says for every role how it is called and names every field that tells apart the faces of that role within one feature (`curve` for `side`, none for a cap), each a text or a whole number and always present. The validator of a face name (`faceName` in `validation.ts`), the key of a face (`faceKey`) and the label the MCP tools print are built from the catalog, and the app imports `faceKey` instead of keeping a copy. A feature type that names faces in a new role adds one member to the union and one entry; the compiler ties the two (a role without an entry, an entry without a field of the name or with the other kind do not compile), and the app's own table of texts (`ROLES` in `issue-text.ts`) is typed by the union as well. The key is `<feature>/<role>`, then the values of those fields in the alphabetical order of their names, then `/@<pattern>:<index>` for every copy tag; for the three roles of an extrusion that is the key it always was, which the fingerprints of solved sketches and the face table depend on (a flat of a nut pocket: `H/holeFlat/2/p1`). A text field may hold any ID a sketch can have, also the derived ID of a point of projected geometry with its slash (`rim/center`); the key stays unambiguous because at most one field of a role holds a free ID and the others are whole numbers or words of a closed set (the side of a wall side). A new role keeps that rule; `face-roles.test.ts` checks it for every role.

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

**Vlastní rovina** (`PlaneFeature`) přebírá souřadný systém základu posunutý o `offset` ve směru jeho normály.

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

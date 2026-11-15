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
) & { copy?: { pattern: Id; index: number }[] }; // a face of a copy made by a pattern, see Pattern
```

Víko nenese označení oblasti. Všechna víka jedné extrude leží v jedné rovině, takže tvoří jednu logickou stěnu, i když je extrude složená z více oblastí. Nový výběr profilu tak víko nepřejmenuje a skici na něm se nerozbijí.

Každý trojúhelník tělesa nese číslo stěny, tabulka čísel → jmen patří k výsledku přepočtu. Čísla se neukládají, ukládají se jen jména.

| Situace | Chování |
|---|---|
| Booleovská operace | Trojúhelník dědí jméno stěny, ze které pochází. Horní stěna kvádru je i po vyříznutí díry „endCap extrude E1". |
| Stěna se rozdělí na víc částí | Zůstává jednou logickou stěnou (nesouvislou). |
| Stěna zanikne | Jméno nemá žádný trojúhelník → reference je rozbitá → feature je v chybě. |
| Dvě stěny splynou do jedné roviny | Zůstávají dvě stěny s různými jmény. |
| Kružnice nebo oblouk | Všechny segmenty mají stejné jméno, válcová plocha je jedna stěna. |
| A copy made by a pattern | The face has the name of the face it copies with `copy` added: the pattern and the number of the copy. The original keeps its name. |
| A side of a generated profile | All its segments have one name from the generator catalog: the teeth of a gear are one face `{ feature, role: 'side', curve: 'teeth' }`. The name does not depend on the operand, so another pitch circle does not rename the face. |

The analytic description of a face (`FaceInfo` in `solid.ts`, internal) has three kinds: a plane, a cylinder and a general surface swept along the extrusion axis (the side of a generated profile). Only a plane can carry a sketch, and only an edge between a plane and a cylinder is a circle.

**Roles (D37).** The roles are a closed union in `types.ts`, one member per role, because that is what an AI reads. The catalog `FACE_ROLES` (`face-roles.ts`) says for every role how it is called and names every field that tells apart the faces of that role within one feature (`curve` for `side`, none for a cap), each a text or a whole number and always present. The validator of a face name (`faceName` in `validation.ts`), the key of a face (`faceKey`) and the label the MCP tools print are built from the catalog, and the app imports `faceKey` instead of keeping a copy. A feature type that names faces in a new role adds one member to the union and one entry; the compiler ties the two (a role without an entry, an entry without a field of the name or with the other kind do not compile), and the app's own table of texts (`ROLES` in `issue-text.ts`) is typed by the union as well. The key is `<feature>/<role>`, then the values of those fields in the alphabetical order of their names, then `/@<pattern>:<index>` for every copy tag; for the three roles of today that is the key it always was, which the fingerprints of solved sketches and the face table depend on.

**Surfaces (D37).** The evaluation publishes what a face is, next to its name: `faceSurfaces[number]`, derived from `FaceInfo` by `surfaceOf` in `solid.ts`.

```ts
type Surface =
  | { kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { kind: 'cylinder'; origin: Vec3; axis: Vec3; radius: number }   // origin: a point of the axis
  | { kind: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number }      // no feature makes one yet (taper, countersink, revolve)
  | { kind: 'swept'; axis: Vec3 }                                    // a planar curve moved along `axis`: gear teeth
  | { kind: 'general' };                                             // no feature makes one yet (revolve of an arc, twist, fillet)
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
- Krajní body mají přesnost sítě (viz Přesnost u SolidKernel). Přímka samotná je přesná. Geometrie přichycená na krajní bod proto dá stěny nástroje jen téměř koplanární se stěnami tělesa; s tím počítá záruka jádra č. 3.
- Hrana mezi dvěma stěnami v téže rovině (výstupek zarovnaný s horní stěnou) má druh `coplanar`. Průsečnice neexistuje a hranice nemusí být přímá. Nekreslí se a nejde promítnout. „V téže rovině" znamená, že normály obou stěn svírají úhel pod úhlovou tolerancí enginu. Přesná rovnoběžnost nestačí: stěna z úsečky přichycené na krajní body promítnutých hran je od stěny tělesa odkloněná o zlomek úhlové vteřiny a průsečnice takových rovin by vyšla kilometry daleko.
- Hrana se vrací jako seznam úseček (`segments`), ne jako jedna lomená čára: hrana rozdělená výřezem má víc nesouvislých úseků a jedna čára by je spojila přes prázdný prostor.
- Kruhová hrana je rozhraní boční stěny vzniklé z kružnice nebo oblouku a rovinné stěny kolmé na osu extrude. Střed a poloměr se počítají analyticky z vyřešené zdrojové křivky skici, ze sítě se nebere nic kromě ověření existence.
- Ostatní hrany (válec říznutý šikmou rovinou, průnik dvou válců, the edge of a cap with the side of a generated profile) mají druh `other` a promítnout nejdou.

Pojmenování hran je zároveň předpokladem pro budoucí rovinu nakloněnou kolem hrany, zaoblení a zkosení.

### Rovina skici na stěně

Počítá se analyticky z definice feature, ne prokládáním trojúhelníků. Souřadný systém je pravotočivý a jeho normála míří vždy **ven z tělesa**:

| Stěna | Počátek | Osa Y | Normála N |
|---|---|---|---|
| víko | počátek rodičovské skici promítnutý do roviny víka | osa Y rodičovské skici | ven z tělesa |
| boční stěna z úsečky | počáteční bod úsečky (`a`) v rovině rodičovské skici | normála rodičovské skici | ven z tělesa |
| boční stěna z kružnice nebo oblouku | není rovinná → chyba `nonPlanarFace` | | |
| the side of a generated profile | not planar → error `nonPlanarFace` | | |

Osa X se dopočítá jako Y × N. Nezávisí tedy na pořadí bodů úsečky ani na orientaci smyčky.

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

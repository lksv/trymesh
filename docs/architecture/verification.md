# Architecture: verification

Part of [architecture.md](../architecture.md), the design as implemented. The design against the scenarios, and the results of the spikes of both libraries.

## Ověření proti scénářům

| Scénář | Jak ho návrh pokrývá |
|---|---|
| 1 Základní průchod | Změna kóty → nový dokument → přepočet od první skici. Výřez odkazuje na `endCap` extrude E1, jméno přežije. Díra okótovaná k promítnuté hraně se posune s okrajem. |
| 2a Přidání díry | Oblast ji získá automaticky, žádné ID se neposune, pozdější reference platí. |
| 2b Smazání úsečky obdélníku | Profil se rozpadne, první extrude skončí v chybě `noProfile`. Těleso nevznikne, takže vše, co na něm závisí, skončí v chybě `brokenReference`. |
| 2c Nahrazení úsečky jinou | Úsečka L3 se smaže a mezi stejné body se nakreslí L9. Oblast z původních křivek zanikla, extrude skončí v chybě `noProfile`. Uživatel vybere profil znovu a extrude projde. Víka si jméno nechají, skici na nich platí dál; pokud mají promítnutou hranu k zaniklé stěně z L3, dostanou varování `brokenProjection` a hrana zůstane zmrazená. Skica přímo na stěně „side E1/L3" skončí v chybě `brokenReference` a uživatel vybere novou stěnu. |
| 3 Solver | `SolveResult` nese stupně volnosti a konfliktní vazby. Konfliktní skica má stav `warning` a model nezmizí. Tažení přes `preview` s `drag`. |
| 4 Round-trip | Dokument je jediný zdroj pravdy, `evaluate` je čistá deterministická funkce. Po načtení se skici neřeší znovu, protože razítko odpovídá. Dokument s feature v chybě se načte také: odkaz na smazanou feature validaci neporušuje. |
| 5 Časová osa a undo | Vlastní rovina je feature jako každá jiná. Vložení, potlačení a přesun jsou příkazy nad seznamem features, validace hlídá pořadí závislostí. Undo vrací předchozí dokument. |
| 9 Robot joint (in progress) | As far as point 3 of D35 reaches (`packages/scenarios/test/scenario9.test.ts`): parameters, checks, pitch circles dimensioned by expressions, save and load (parts a, k); the sun gear, one planet and the ring gear in mesh without overlap (part b); the plate, the sun flange and the housing with holes through all, one of them through two bodies (parts d, e, f without patterns and pockets); the change of the ratio to 4 and to 6 with everything recomputed and in mesh (part i). A parameter change recomputes the joint so far in about 0.6 s. The rest follows with points 4 to 7. |
| 6 Navazování geometrie | Promítnutá kružnice dává pevný střed, soustředná díra ho sleduje. Lícující nálitek nechá obě stěny a hranu druhu `coplanar`, i když je jeho bok vedle roviny o chybu float32. Další operace na zbytku posunuté stěny funguje díky návratu do roviny v adaptéru. Po odříznutém nálitku nezůstanou zbytky jeho stěn, takže reference na ně se rozbijí. |


## The offset of a profile and a wall (D44)

- `packages/engine/test/outline.test.ts`, without adapters, on sketches given with their solved positions: the outline of a selection (a shared curve, an island in a hole, regions that meet in a point), the offset of a rectangle, a triangle, a rounded rectangle, a D shape on both branches, a lens of two arcs and an outline with a hole, with areas against the exact formulas; an offset and its opposite on 200 random convex and L-shaped outlines; every refusal with its curves and its text (a corner radius used up, a line its neighbours meet before, a hole that closes, a hole that runs into the outer loop, a hole that grows past it, the sliver, the small hole between two corners of a polygon); the tests of the polylines on hand-made loops (a hole through an edge at its own vertices, a loop that returns to a point, loops nearer than the tolerance with boxes apart, a fold, a loop walked the other way); walls of a line, an L, a chain joined by a constraint, an arc, a circle, a closed loop, and what is not one chain.
- `packages/engine/test/offset.test.ts`, at the document level: the optional field (absent, given, zero, an expression, `setField` on a feature without it, a patch that sets, changes and removes it), which variant has it, the wall (own curves only, sorted, the thickness), its references and the names of its faces.
- `packages/scenarios/test/offset.test.ts`, against the real adapters: volumes, face names, surfaces and boxes of faces of moved profiles and of walls; a sketch on a moved side face, on a side and on an end of a wall; a wall added to a body and repeated by a pattern; the errors as the engine reports them; 24 random rounded rectangles with a hole, each either refused for a reason the test names or built with the volume of the moved outline and then cut by the kernel.
- `packages/scenarios/test/review.test.ts`: the meshes, the face numbers and the face names of a model without an offset are, by a hash, what the code before D44 built (computed with both and equal).
- `packages/scenarios/test/scenario12.test.ts`: validation scenario 12, the part of 2a.
- `packages/engine/test/review.test.ts`, the findings of the review of the package: a cusp between a line and an arc and between two arcs, with the end point on the line and 1e-9 to either side of it; a wall refused for its polylines names curves of the sketch.
- Run by the reviewer of the package and not kept in the suite: 25 000 random star polygons against an independent mitre, about 16 000 random outlines of lines and arcs (both directions, sweeps above half a turn, loops of two arcs) checked for a simple polygon, the area of the exact curves and the distance of every boundary point from the original outline, 7 100 filleted polygons, 4 000 random chains of a wall, and 400 random outlines with arcs through the real adapters. Nothing wrong was accepted and nothing right refused; what they found is in the tests above.
- Not measured: an outline thinner than float32 resolves and thicker than the length tolerance (a limit, see [extrude.md](extrude.md)).

## The taper (D45)

- `packages/engine/test/taper.test.ts`, without adapters: the optional field (absent, given, zero, an expression, the open range, `setField` on a feature without it, a patch that sets, changes and removes it, also from a feature without it); the refusals (a generated profile by `addFeature`, `setField` and a patch; the key on "through all" by `addFeature` and a patch; `setField` on "through all"); another variant replacing a tapered extent; the upgrade step (a document with a taper loads to itself and the list without the step refuses it); `circleBetween` for the four pairs, both orders, and nine pairs that are no circle; the rings of a slot with a circular hole (two rings, one count per curve), and the levels of a half disc of radius 10 under 45°, the clipped disc of the reviews (radius 2.26 at x = −1.995, far offset −1.598), a lens of two arcs and a half disc as a hole of a square, each with more than one interval and under the cap, every side triangle of an arc sampled on a grid of 861 points against its exact cone within the chord tolerance; a refusal with the text of its level.
- `packages/scenarios/test/taper.test.ts`, against the real adapters: the volumes of a tapered box and of a frustum of a circle against the formulas; the tilted plane of a line, the cone of a hole of a profile and the cones of a circle for both signs of the taper and of the distance (apex, axis, half angle), and the circles of the rims; a sketch on a tilted side whose origin stays when a taper is added at a start of zero and moves to where the plane meets the sketch plane at a start of 2, with a hole cut through it; a taper of zero giving the prism triangle for triangle; a pattern of a tapered cut with the cone of the copy turned; the error of a far end that vanishes; a tapered wall with the volume of its formula, whose refusal names the sketch curve and not a key of the outline.
- `packages/kernel-manifold/test/taper-fuzz.test.ts`: random booleans of a box with frustums of rectangles and regular polygons in a general position, among them tilted sides in one plane with those of an earlier tool and caps flush with faces of the box, against the volume of cross sections; 300 cases in the suite, 5 000 run once with no failure and no refusal (`TAPER_FUZZ_COUNT`, `TAPER_FUZZ_FIRST`). The generator of the older fuzz is unchanged, so its seeds keep their cases.
- `packages/app/test/sketch-tools.test.ts` and `app.test.ts` (snapshot `taper.txt`): the field in the draft (set, changed, a zero, removed, dropped with a generated profile, kept over "through all" and back), the patch that removes it, and the form driven as a user drives it.
- `packages/scenarios/test/scenario12.test.ts`: validation scenario 12, the part of 2b.

## Výsledky spiků

Provedeno 2026-11-13 v Node 25. Skripty ověřující samotné knihovny jsou ve složce `spikes/` a jdou spustit znovu (`npm install`, pak `node <skript>`). Adaptéry, které ze spiků vzešly, jsou od 2026-11-14 v balíčcích `kernel-manifold` a `solver-planegcs` a jejich případy běží jako testy.

### Manifold (`manifold-3d` 3.5.5)

Skripty: `manifold-spike.mjs`, `manifold-ghost.mjs`, `manifold-determinism.mjs`. Každý případ běžel v osově zarovnané i v obecně natočené poloze.

| Předpoklad | Výsledek |
|---|---|
| `faceID` ze vstupu přežije booleany | Platí. Čísla stěn obou operandů jsou ve výstupu zachovaná. |
| Válcová plocha zůstane jednou stěnou, normály míří ven z materiálu | Platí. |
| Rozdělená stěna si nechá číslo v obou částech | Platí. |
| Stěny v jedné rovině s různými čísly nesplynou | Platí. |
| Výstup je uzavřené těleso, objem odpovídá | Platí ve všech případech. |
| Koplanární plochy, osově | Bez potíží i bez přesahu. |
| Koplanární plochy, šikmo | **Neplatí bez úprav.** Nálitek bez přesahu zůstal oddělený vnitřní stěnou; kapsa s bokem v rovině boku tělesa nechala v ústí blánu. Přesah 0,01 obojí odstranil. Nastavení tolerance ani `simplify` nepomáhá. Vedlo k záruce č. 3 a úpravě v adaptéru (D19). |
| Přesnost | Vstup i výstup jen `Float32Array`, API pro float64 neexistuje. Vedlo k rozhodnutí D20. |
| `triangulate` v JS API | Platí, včetně polygonu s dírou. |
| Determinismus | Opakovaný boolean dá bitově stejný výstup. |
| Běh v Node | Platí. |

Úzké trojúhelníky se objevily jen v jednom případě (dva v šikmém sjednocení lícujících těles).

### Koplanární stěny v adaptéru

Adaptér: `packages/kernel-manifold/src` (`coplanar.ts` posun a návrat stěn, `clean.ts` čištění sítě, `geometry.ts` roviny a tolerance). Testy: `test/coplanar.test.ts` (jednotlivé případy), `test/fuzz.test.ts` (náhodné) a `test/review.test.ts` (případy z revize). Ověřují, že záruku č. 3 jde splnit uvnitř adaptéru jen ze sítě a čísel stěn, bez znalosti jmen a bez zásahu do core. Nástroje jsou postavené přesně, bez ručního přesahu.

Jednotlivé případy, každý osově i šikmo: nálitek a kapsa přesně na stěně, kapsa s bokem v rovině boku tělesa, výřez přesně na tloušťku, válcová díra a válcový čep, bok kapsy vychýlený o ±3e-6 (napodobuje přichycení na bod s přesností float32), bok 0,05 od roviny (posunout se nesmí), nástroj dosedající zvenku, lícující sjednocení, stupňovité těleso, částečný překryv, stejná rovina bez překryvu.

Řetězené případy, každý osově i šikmo: nálitek zavěšený na stropě tunelu a kapsa do téhož stropu (strop je zbytek posunuté stěny), blok pod převisem nálitku, který přesahuje okraj stěny.

Případy ze čtvrté revize, každý osově i šikmo:
- schod přidaný sjednocením a zase celý odříznutý (jeho boky lícují s boky kvádru),
- nálitek s bokem lícujícím s bokem kvádru a s odchylkou ±3e-6, potom kapsa do horní stěny,
- válcový výřez pod schodem, kde dva vrcholy válce leží v rovině boku schodu (čtyři roviny v jednom vrcholu),
- blok pod převisem, jehož horní stěna zároveň lícuje s horní stěnou kvádru,
- drážka do nálitku od jeho spodku nástrojem, který zároveň leží na horní stěně kvádru.

Každý případ kontroluje čísla stěn, objem, uzavřenost sítě a to, že žádná rovinná stěna nemá přeložený trojúhelník.

| Varianta adaptéru | Prošlo |
|---|---|
| Posun před booleanem, přesný návrat a vyčištění sítě po něm | 46 z 46 |
| Verze po třetí revizi (vracel se jen zbytek posunuté stěny, lícující stěny u sjednocení se neposouvaly) | případy ze čtvrté revize selhaly: po odříznutém schodu zůstaly proužky jeho boků, lícující nálitek šikmo zneplatnil rovinnost horní stěny a další kapsa nechala blánu, strop válcového výřezu ležel 9,999988 až 10,000244 |
| Jen posun, bez návratu (první verze) | řetězené případy selhaly: nálitek na stropě tunelu byl samostatná komponenta |
| Bez úprav | selhává většina šikmých případů |

S návratem leží strop tunelu přesně na zadané výšce (bez něj o 0,002 až 0,003 výš).

**Náhodné testy.** Generátor skládá na kvádr 40 × 30 × 10 jednu až čtyři operace (sjednocení nebo rozdíl) s kvádry, trojbokými hranoly a válci. Rozměry bere z hrubé mřížky, takže stěny často lícují, dosedají nebo se překrývají zčásti; 80 % případů běží v náhodně natočené a posunuté soustavě a 30 % kvádrů má bok vychýlený: o ±3e-6 (napodobuje přichycení na bod s přesností float32), nebo o ±3e-5 (pásmo mezi přesností float32 a tolerancí, mimo návrhový rozsah). Výsledek se porovnává se dvěma orákuly nezávislými na adaptéru:
- mřížkový model (případy jen z kvádrů): přesný objem a pro každé číslo stěny rozsah plochy, kterou smí mít,
- řezy po vrstvách přes 2D booleany: objem a povrch (všechny případy),
- u případů s válci a šikmými stěnami navíc shoda čísel stěn s během téhož případu v osové poloze.

Každý výsledek musí být uzavřený, bez přeloženého trojúhelníku a jádro ho musí načíst se stejným objemem. Adaptér smí případ odmítnout vlastní chybou (neuzavřená nebo přeložená síť); odmítnutí se počítají zvlášť a test hlídá, že jsou vzácná.

Poslední běh (2026-11-14, po opravách z revize): 30 000 případů, žádný vadný výsledek. Tři případy adaptér odmítl chybou: jeden v návrhovém rozsahu (válec, kvádry s odchylkou 3e-6) a dva s odchylkou boku 3e-5. Tisíc případů běží při každém `pnpm test`; rozsah jde změnit proměnnými `FUZZ_COUNT` a `FUZZ_FIRST`.

Vedle toho běží případy z revize (`test/review.test.ts`), každý v desítkách náhodných poloh: mezera a průnik pod rozlišením adaptéru, dotyk hranou následovaný dalšími operacemi, model 450 a 1300 mm od počátku.

Co náhodné testy našly a pevné případy ne:
- Jádro síť, která není uzavřenou plochou, načte bez chyby, část trojúhelníků zahodí a změní objem. Stav knihovny zůstane `NoError`. Proto adaptér uzavřenost kontroluje sám.
- Vrácení posunutých vrcholů „do roviny" nechávalo průsečíky natočených hran o zlomek přesahu vedle; pozdější nástroj se stěnou přesně v tom místě síť přeložil. Návrat se proto počítá z původní geometrie.
- Kde se nástroj tělesa dotkne jen hranou a nic se neposouvá, nechává jádro nulové trojúhelníky s číslem stěny nástroje. Čistí se proto vždy.
- Sloučení vrcholů podle polohy vytvoří v místě, kde se těleso samo sebe dotýká hranou, hranu se čtyřmi trojúhelníky; dělit jen koncové vrcholy nestačilo.
- Průsečík hrany, která rovinu protíná pod malým úhlem, vyšel 1e-4 vedle skutečného vrcholu a vznikl přeložený trojúhelník. Bod blízko konce hrany se bere jako ten konec.
- Jehlové trojúhelníky se při čištění zahazovaly jako nulové (14 případů z 30 000, všechny v natočené poloze s válci). Opraveno přísnějším určením nulového trojúhelníku; po revizi se navíc dělí jen hrany bez protějšku.

Adaptér má asi 900 řádků TypeScriptu; zhruba třetinu tvoří čištění sítě.

### planegcs (`@salusoft89/planegcs` 1.3.0)

Skript: `planegcs-spike.mjs`. Prošlo 36 z 37 kontrol; neprošlá je kontrola referenčních kót, viz tabulka.

| Předpoklad | Výsledek |
|---|---|
| Stupně volnosti | Platí (`dof()`). |
| Konfliktní vazby | Platí. Vrací celou skupinu vazeb v konfliktu, ne jen tu naposled přidanou. Stav řešení je pak většinou `Failed`, ale ne vždy: konflikt se objevil i se stavem `Success`. Adaptér proto rozhoduje podle seznamu konfliktních vazeb. |
| Nadbytečné vazby | Platí. |
| Pevné body | Platí (`fixed: true`), nepohnou se ani o bit. |
| Pevný poloměr promítnuté kružnice | Platí přes vazbu `circle_radius`; soustředná díra i tečna k pevné kružnici fungují. |
| Podmínky oblouku | Platí přes `arc_rules`. Adaptér musí dopočítat poloměr a úhly z bodů, planegcs je chce na vstupu. |
| Mapování variant vazeb | Všechny varianty mají protějšek (24 kombinací vazby a druhu křivky v testech adaptéru). `horizontalDistance` a `verticalDistance` se mapují na vazbu `difference` nad souřadnicemi bodů. |
| Znaménka | Ověřeno testy adaptéru: `difference` dává b − a včetně záporných hodnot, `l2l_angle_ll` měří od první úsečky ke druhé proti směru hodin. |
| Splněný vstup se vrátí beze změny | Platí bitově, pro plně určenou i podurčenou skicu. |
| Determinismus | Platí bitově. |
| Tažení přes dočasné vazby | Platí. 30 kroků, vazby drží, bod sleduje cíl ve volném směru, žádné skoky. Ověřeno navazujícími kroky i bezstavově, kdy každý krok začíná z uložených poloh a cíl se vzdaluje (tak to volá `preview`). |
| Referenční kóty | **Neplatí.** Neřídicí kóta přidala stupeň volnosti a vrátila nesmyslnou hodnotu. Engine je proto solveru neposílá. |
| Vazba jen mezi pevnými entitami | **Solver ji tiše ignoruje.** Šikmá pevná úsečka s vazbou `horizontal` skončí úspěchem bez konfliktu. Takovou vazbu proto odmítá validace příkazů. |
| Diagnostika konfliktu | Mezi konfliktními vazbami se vracejí i pomocné vazby adaptéru; `dof()` při konfliktu nemá význam (pozorováno −1 i 0 až 2). Adaptér pomocné vazby odfiltruje a vrací 0. |
| Běh v Node | Platí. |

Poznámky pro adaptér:
- Solver při hledání nadbytečných vazeb vypisuje ladicí text na standardní výstup. Vypíná se nastavením `debug_mode` na `DebugMode.NoDebug` (ověřeno).
- Úspěšné řešení hlásí knihovna stavem `Success` nebo `Converged`. `Converged` ale znamená jen to, že vazba, kterou knihovna vyhodnotila jako nadbytečnou, nebyla ve výchozím odhadu splněná; nikdo neověří, že je splněná ve výsledku. Adaptér proto řeší znovu z výsledku, dokud nedostane `Success`.
- Paměť WASM se uvolňuje ručně (`destroy_gcs_module`).
- Tečnost s obloukem (`tangent_la`, `tangent_ca`, `tangent_aa`), bod na oblouku (`point_on_arc`) a kóty oblouku jsou ověřené až testy adaptéru (`packages/solver-planegcs/test`), ve spiku nebyly.

Známá omezení solveru, která adaptér neřeší (z revize 2026-11-14, náhodné skici proti nezávislé kontrole zbytků vazeb):
- Nadbytečná vazba, která ve výchozím odhadu není splněná, může skončit konfliktem, i když řešení existuje (nepřesně nakreslený obdélník a k němu rovnoběžnost protějších stran). Z přesnějšího odhadu projde. Není to obecné: kolmost nebo druhá kóta ze stejného odhadu projdou.
- Kóta vzdálenosti mezi dvěma body, které ve výchozím odhadu leží na sobě, skončí konfliktem.
- Oblouk se může překlopit na svůj doplněk (konce si vymění strany) a výsledek je přesto řešením vazeb. Port o rozsahu oblouku nic neříká; engine to zatím nekontroluje.
- U tečnosti dvou kružnic drží knihovna vnější nebo vnitřní dotyk podle výchozího odhadu. Kde druhá varianta vede k zápornému poloměru, vrací adaptér `failed`.
- Výchozí algoritmus selhal (`failed`, bez seznamu vazeb) asi u 4 % náhodných skic. Záložní Levenberg–Marquardt z nich vyřeší asi desetinu; zbytek zůstává `failed`.

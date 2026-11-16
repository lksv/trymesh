# Architecture: ports

Part of [architecture.md](../architecture.md), the design as implemented. The contracts of `SketchSolver` and `SolidKernel`.

## Porty

### SketchSolver

```ts
interface SketchSolver {
  solve(input: SolveInput): SolveResult;
}

interface SolveInput {
  points: Record<Id, { x: number; y: number }>;   // počáteční odhad
  radii: Record<Id, number>;                      // počáteční odhad poloměrů kružnic
  curves: Record<Id, Curve>;                      // včetně promítnutých křivek
  constraints: Record<Id, Constraint>;
  fixed: Id[];                                    // body, které se nehýbou, a kružnice s pevným poloměrem
  drag?: { point: Id; target: { x: number; y: number } };
}

interface SolveResult {
  status: 'solved' | 'conflict' | 'failed';
  points: Record<Id, { x: number; y: number }>;
  radii: Record<Id, number>;
  degreesOfFreedom: number;          // 0 = plně určená
  conflicting: Id[];                 // vazby v konfliktu
  redundant: Id[];
}
```

Bezstavová funkce. Načtení WASM je asynchronní a proběhne při vytvoření adaptéru, `solve` je synchronní.

Záruky implementace:
1. Body ve `fixed` se nepohnou, kružnice ve `fixed` nezmění poloměr.
2. U každého oblouku leží `start` i `end` na stejném poloměru kolem `center`.
3. Stejný vstup dá vždy stejný výstup.

planegcs navíc vrací splněný vstup bitově beze změny (ověřeno spikem), ale návrh se o to neopírá.

Když solver najde stav, který není použitelná geometrie (nekonečná hodnota, nekladný poloměr, oblouk s konci na různých poloměrech), vrací adaptér `failed`.

Jak adaptér planegcs řeší:
1. Při tažení nejdřív vyřeší skicu bez tažení a zjistí nadbytečné vazby. S dočasným cílem tažení by je knihovna ohlásila jako konflikt, proto se při tažení vynechají. They are left out by the constraints of the library, not of the engine: of a fixed point only the coordinate the library called redundant goes (a point fixed on a horizontal line from the origin), the other one keeps the point in place during the drag.
2. Vyřeší skicu. Když výchozí algoritmus (DogLeg) nedoběhne a konflikt nehlásí, zkusí Levenberg–Marquardt; stejně postupuje FreeCAD.
3. Řeší znovu z nalezeného stavu, dokud není ustálený. Knihovna totiž stupně volnosti a nadbytečné vazby hlásí podle výchozího odhadu, ne podle výsledku, a ve stavu `Converged` může nechat nadbytečnou vazbu nesplněnou. Vrácená diagnostika tak popisuje vrácenou geometrii a opakované řešení z výsledku dá totéž; o to se opírá krok 2 řešení skici (jen diagnostika z uložených proměnných).

Adaptér překládá každou variantu `Constraint` na odpovídající vazbu knihovny jedna ku jedné podle `type`. Two exceptions (D35, point 6): `equalRadius` becomes `equal_radius_cc`, `equal_radius_ca` or `equal_radius_aa` by the kinds of its two curves (the library wants the circle first in the mixed one), and `fixed` becomes two constraints of the library, `coordinate_x` under the ID of the constraint and `coordinate_y` under a derived ID that the adapter maps back, so `conflicting` and `redundant` name the constraint once. A point with a `fixed` constraint starts every pass at the coordinates of the constraint and not at its estimate: from a rough estimate the library could stop where a dimension agreeing with the coordinates looked like a conflict. Neznámý druh křivky nebo ID ve `fixed`, které není bod ani kružnice, je výjimka. Pomocné vazby, které si přidává sám (podmínky oblouku, pevný poloměr promítnuté kružnice), z `conflicting` a `redundant` odfiltruje: výsledek smí obsahovat jen ID ze vstupu. Při stavu `conflict` nebo `failed` nemá `degreesOfFreedom` význam: knihovna vrací −1, adaptér předá 0 a UI se řídí varováním `sketchConflict` a seznamem `conflicting`.

Referenční kóty (`driving: false`) se solveru neposílají. Engine je před voláním odfiltruje a jejich hodnotu spočítá z vyřešených poloh. planegcs s nimi podle spiku nepracuje spolehlivě.

### SolidKernel

```ts
interface Solid {
  positions: Float32Array;   // xyz
  triangles: Uint32Array;    // indexy vrcholů
  faceIds: Uint32Array;      // číslo stěny pro každý trojúhelník
}

interface ComputedMesh { unverified: Solid }       // a mesh the kernel computed and did not verify (D50)

interface SolidKernel {
  boolean(op: 'union' | 'difference' | 'intersection', a: Solid, b: Solid): Solid;
  triangulate(loops: Float64Array[]): Uint32Array;   // 2D polygon s dírami: vnější smyčka proti směru hodin, díry po směru
  intersectionAsComputed(a: Solid, b: Solid): ComputedMesh;   // for measuring only (D50)
}
```

Předpoklad na vstupu: čísla stěn v `a` i `b` pocházejí z jedné společné tabulky. Stejné číslo znamená stejnou stěnu, různé stěny mají různá čísla. Zajišťuje to engine (viz tabulka čísel stěn v sekci Přepočet).

Záruky implementace:
1. Výstup `boolean` je uzavřené těleso.
2. Každý výstupní trojúhelník má `faceId` stěny, ze které pochází.
3. Rovinné stěny obou operandů, které leží v jedné rovině v rámci tolerance jádra a překrývají se, se berou jako shodné. Výsledek neobsahuje blány, vnitřní stěny ani zbytky stěn, které měly zaniknout. Platí pro sjednocení a rozdíl. The engine uses an intersection only in the query of collisions (`interference`), which wants its volume, not its faces: the Manifold adapter does not keep this guarantee for an intersection, does not adjust the tool before it and only cleans and verifies the result; when it cannot verify it, it throws, and the query then asks for the intersection as computed (below) and may clear the pair by it, or reports it as failed.
4. Stejný vstup dá vždy stejný výstup.

Když adaptér výsledek zaručit nedokáže, skončí výjimkou a engine ji ohlásí jako `kernelFailure`. Potichu vadné těleso vrátit nesmí. Výjimkou končí i vadný vstup: neuzavřená nebo dovnitř orientovaná síť, nesedící počet čísel stěn.

#### The intersection as computed (D50)

`intersectionAsComputed(a, b)` is what the two solids share as the kernel computes it, **for measuring only**. The collisions (`sharedBy` in `interference.ts`, the only caller; `packages/engine/test/modules.test.ts` holds it) ask it about a pair whose `boolean('intersection')` threw, and may only clear such a pair by it ([api.md](api.md), "Interference"). The result is wrapped (`ComputedMesh`, the field `unverified`), so it cannot be handed to `boolean`, put into a body or exported without writing `.unverified`.

What an implementation guarantees:
1. The common part of the two solids as the kernel computed it, with nothing done to it: no faces moved before, nothing welded, dropped, split or repaired after.
2. **What the two solids share is in the mesh**: every part of their common volume thicker than the precision of their coordinates (a millionth of the largest coordinate of the two, and of a millimetre at least). The mesh may hold more than they share, never less. This is what a cleared pair rests on; no test can prove it of a kernel.
3. It is closed by its indices: every edge in two triangles, once each way, so every connected piece has a volume. Two solids that are apart give a mesh without triangles.
4. Every triangle carries the number of the face of `a` or `b` it comes from.
5. The same input gives the same output.
6. It throws for an input `boolean` throws for, when the library reports an error, and when the mesh would not keep guarantee 3 (that is the one check); never because the mesh is not clean.

Not guaranteed, as `boolean` guarantees it: that the mesh is a solid (it may hold unjoined vertices at one place, triangles without an area, sheets where faces coincide, slivers thinner than the precision, pieces that touch along an edge or at a vertex, and pieces of noise that are inside out, each below 10⁻⁵ mm³ on the arm of scenario 13); a tolerance for faces in one plane (guarantee 3 of `boolean`); that another operation of the kernel takes it (Manifold would load it and silently drop a part, step 7 below); the same answer with `a` and `b` swapped (nor is a refusal of `boolean` the same both ways). A kernel whose intersection is exact (B-rep) may return that result here.

**The adapter of Manifold**: the boolean of the library as it is (the inner `rawBoolean`: both inputs checked as for `boolean`, the library asked, its error thrown, the arrays copied out), then `isClosed` of `clean.ts` on the result, then the wrapper. No shift of faces before, no cleaning after, no check of folded triangles, no tolerances. Every mesh looked at was closed (136 refused poses of the design and the poses of its tests). The library has a floor of its own: triangles colinear within its tolerance are removed and shorter edges may be collapsed; that tolerance follows the largest coordinate as the precision of the coordinates does and is about an eighth of it, so what it may lose is thinner than what the collisions call nothing ([the design](../d36/5e-kernel-second/design.md), "The port"). The option `{ prepare: false }` of `ManifoldKernel.boolean` is the same raw boolean for the tests of the adapter, without the check and the wrapper.

**Jak záruku č. 3 plní adaptér Manifoldu.** Manifold sám toleranci ke skoro-koplanárním plochám nemá a na šikmých stěnách kvůli float32 selhává. Adaptér se proto řídí jedním pravidlem: stěny nástroje a tělesa se v jedné rovině nesmějí jen dotýkat. Každý takový styk změní před booleanem na skutečný průnik a po booleanu posunuté stěny vrátí.

Před booleanem:
1. Proloží roviny stěnami obou těles (podle čísel stěn). Stěna je rovinná, když její vrcholy leží do tolerance od proložené roviny. Podle normál jednotlivých trojúhelníků se nerozhoduje: úzký trojúhelník z dřívějšího booleanu má normálu nespolehlivou a celou stěnu by označil za nerovinnou.
2. Najde dvojice stěn nástroje a tělesa v jedné rovině, které se překrývají, dotýkají, nebo je dělí mezera do dvou přesahů. Dotyk se počítá, protože bok nálitku se boku tělesa dotýká jen hranou. Mezera se počítá, protože se stěny posunem sousedních stěn o přesah protáhnou.
3. Stěnu nástroje posune o přesah tak, aby se nástroj zvětšil. Jediná výjimka: u rozdílu, když nástroj na těleso dosedá zvenku, se nástroj zmenší. Když stěna nástroje potká ve své rovině stěny obou orientací (horní stěnu a spodek převisu), má zvětšení přednost; zmenšení by na lícující části nechalo blánu.
4. Vrcholy posouvá podél průsečnic sousedních stěn, aby se sousední stěny nenaklonily.

Po booleanu:
5. Vrátí zpět vše, co po posunu ve výsledku zůstalo. Polohy se neodhadují z okolí, dopočítají se přesně z původní, neposunuté geometrie. Každý vrchol výsledku je totiž buď vrchol jednoho z těles, nebo průsečík hrany jednoho tělesa se stěnou druhého:
   - posunutý vrchol nástroje se vrátí na původní vrchol,
   - průsečík hrany nástroje, jejíž konec se posunul (včetně úhlopříček triangulace), se stěnou tělesa se přesune do průsečíku původní hrany s rovinou té stěny,
   - průsečík hrany tělesa s posunutou stěnou nástroje, a každý jiný vrchol v pásu mezi původní a posunutou rovinou, se přesune po té hraně tělesa do původní roviny,
   - průsečík, který by na původní hraně ležel mimo její konce, v přesné geometrii neexistuje; stáhne se do bližšího konce.
6. Vyčistí síť, a to vždy, i když se nic neposouvalo:
   - sloučí vrcholy na stejném místě,
   - zahodí trojúhelníky s vrcholy v přímce a blány nulové tloušťky,
   - hrany, které tím zůstaly bez protějšku, dorovná: trojúhelník s takovou hranou rozdělí ve vrcholu, který na ní leží a ve kterém protější strana navazuje (T-spoj),
   - the two steps before can undo each other (a split leaves a piece the dropping takes for a null triangle, which opens the same edge again) and go round in a cycle of a few states, so the cleanup remembers the states it has split and stops after splitting one of them for the second time; where the mesh used to end closed it ends closed, and a cycle without a closed state fails the check of step 7 after a few passes instead of a thousand,
   - kde se těleso samo sebe dotýká jen hranou, rozdělí povrch po klínech materiálu.
7. Ověří výsledek a jinak skončí chybou (`kernelFailure`):
   - síť je uzavřená plocha (každá hrana právě ve dvou trojúhelnících, jednou v každém směru),
   - žádná rovinná stěna nemá trojúhelník otočený proti své normále.

Proč jsou kroky 5 až 7 nutné:
- Bez návratu leží zbylá stěna o přesah vedle roviny, kterou pro ni engine počítá analyticky, a další operace na ní selže: nálitek zavěšený na takové stěně skončil ve spiku jako samostatná komponenta s mezerou 0,002 mm. Výstup adaptéru tedy musí být konzistentní s analytickou geometrií v rámci přesnosti float32, ne v rámci přesahu.
- Bez čištění zůstanou po pásu nulové šířky trojúhelníky, které dál nesou číslo zaniklé stěny, a reference na ni by se nerozbila. Totéž nechává jádro samo tam, kde se nástroj tělesa jen dotkne hranou; proto se čistí vždy.
- Bez kontroly by chyba prošla potichu. Manifold síť, která není uzavřenou plochou, při dalším booleanu načte bez chyby, část trojúhelníků zahodí a změní objem (ve spiku o stovky mm³).

Co se ukázalo až v obecně natočené poloze a v náhodných testech:
- Roviny stěn se prokládají přes celou stěnu. Normály jednotlivých trojúhelníků výsledku použít nejde: úzké trojúhelníky je mají vychýlené o desítky stupňů.
- Návrat jen „do roviny" nestačí. Průsečík hrany, která se posunem natočila, zůstane ve správných rovinách, ale o zlomek přesahu vedle. Sám nevadí, dokud pozdější nástroj nemá stěnu přesně v tom místě; pak se síť přeloží. Proto se polohy dopočítávají z původních hran.
- Svislá hrana válce může ležet celá v rovině boku tělesa. Průsečík s takovou rovinou není určený; bere se nejpříčnější ze stěn tělesa, kterých se vrchol dotýká.
- Posun vrcholů nástroje před booleanem se počítá v ortonormální bázi normál. Výpočet přes regularizovanou soustavu 3×3 byl pro vrchol držený jedinou šikmou rovinou nestabilní.
- Tenký trojúhelník není totéž co trojúhelník s vrcholy v přímce. Jádro běžně vrací jehly: dva vrcholy pár desetitisícin od sebe a třetí daleko. Jehla má plochu a do sítě patří. Za nulový se proto bere trojúhelník užší než čtvrtina tolerance slučování (přesnost float32), širší jen tehdy, když jeho prostřední vrchol leží zřetelně uvnitř nejdelší strany.
- Dělit se smějí jen hrany bez protějšku. První verze dělila každou hranu, u které ležel cizí vrchol dost blízko její přímky. U zdravé hrany vycházející pod malým úhlem to vedlo ke střídání dvou stavů, z nichž ani jeden nebyl uzavřený.
- Po dotyku hranou se zdvojené vrcholy při dalším booleanu zase sloučí a dělí znovu. Dělení přes nový vrchol uprostřed hrany tak při každé další operaci zdvojnásobilo počet trojúhelníků v místě dotyku. Kde to jde, zdvojí se proto existující vrchol.
- Přesnost float32 klesá se vzdáleností od počátku. Tolerance odvozené jen z rozměru modelu selhávaly u modelu 60 mm velkého a 450 mm vzdáleného od počátku.
- Zmenšený nástroj mohl přeskočit stěnu tělesa ležící těsně za jeho stěnou; materiál mezi nimi zůstal jako blána. Posouvá se proto nejvýš do poloviny mezery.

Důsledek pro jména: kde stěna nástroje lícuje se stěnou tělesa a překrývají se plochou, nese překrytou část ve výsledku jméno stěny nástroje. Obě stěny dál existují a dělí je hrana druhu `coplanar`.

Všechny tolerance odvozuje adaptér z rozměru D: úhlopříčka obálky obou těles, nejméně však dvojnásobek největší souřadnice (model daleko od počátku má horší přesnost float32). Stejná rovina 1e-5 D, přesah 4e-5 D, slučování vrcholů 1e-6 D. V dokumentu ani v core se nenastavují.

Omezení:
- **Rozlišení.** Detail menší než asi 1e-4 D (u modelu 70 mm kolem 0,01 mm) těsně u lícujících stěn adaptér nezvládá spolehlivě: schod nebo mezera této velikosti, o kterou se nástroj posouvá. Výsledek je pak buď správný, nebo chyba `kernelFailure`; testy z revize potvrzují, že potichu vadný není. Od 0,05 mm výš prošly všechny zkoušené polohy.
- Řeší se jen rovinné stěny. Válcová stěna nástroje shodná s válcovou stěnou tělesa (rozšíření díry na stejný poloměr, výřez přesně podle válcového nálitku) ne; povrch pak vyjde špatně a chyba se neohlásí.
- Stěna nástroje užší než 8e-5 D (kapsa hluboká pár tisícin) se pro určení roviny nepoužije a lícování na ní se nepozná.
- Průnik se neupravuje (viz záruka č. 3).
- Návrat posunutých stěn porovnává každý vrchol výsledku se všemi posunutými hranami nástroje a hranami tělesa. U těles do několika tisíc trojúhelníků to nevadí; u desky se 192 kruhovými otvory (19 tisíc trojúhelníků) trval jeden boolean 7,6 s, samotné jádro 0,07 s. Prostorové vyhledávání je možná pozdější optimalizace.
- Vyčištění průchodem přes Manifold nejde použít: nulové trojúhelníky sbalil špatným směrem a poškodil těleso. Síť si adaptér čistí sám.
- Těleso, které se samo sebe dotýká jen hranou, adaptér zpracuje (v síti jsou v místě dotyku zdvojené vrcholy). Geometricky je to ale mezní stav a další operace přesně v místě dotyku zkoušené nejsou.
- Zkoušené nástroje jsou hranoly (kvádry, trojboké hranoly se šikmou stěnou) a válce. Jiné v PoC nevznikají, nástroj je vždy extrude.
- Výřez, jehož víko zároveň lícuje se spodkem převisu a leží na opačně orientované stěně v téže rovině, přejmenuje dotčenou část té stěny na víko nástroje. Geometrie je správná.
- Obalová funkce `triangulate` v knihovně neuvolňuje paměť WASM (u smyčky s 256 body 8 kB na volání). Adaptér proto volá funkci pod ní a paměť uvolňuje sám; je to vnitřní rozhraní knihovny a při její aktualizaci se musí ověřit.

**Přesnost (D20).** Manifold přijímá i vrací souřadnice jen ve `Float32Array`, proto je má `Solid` také v tomto typu. Engine geometrii nikdy neodvozuje ze sítě, pokud ji umí spočítat analyticky; analytické výpočty běží ve float64. Naměřená odchylka vrcholů od roviny po 12 booleanech za sebou na šikmé stěně byla 2e-6.

`Solid` jsou čistá data. Přechod na B-rep by znamenal jiný typ tělesa a jiný adaptér; jména, reference a přepočet zůstanou.

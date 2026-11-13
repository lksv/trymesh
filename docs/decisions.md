# Rozhodnutí

Živý dokument. Zapisuje, co bylo rozhodnuto, proč a co se zvažovalo. Rozhodnutí nejsou neměnná; při změně se záznam přepíše a původní stav se uvede v poznámce.

Poslední úprava: 2026-11-13

## Přehled

| # | Téma | Stav | Rozhodnutí |
|---|---|---|---|
| D1 | Jazyk enginu | rozhodnuto | TypeScript |
| D2 | Knihovny třetích stran | rozhodnuto | Povolené, každá se schvaluje zvlášť a je za vlastním rozhraním |
| D3 | Model dokumentu | rozhodnuto | Log operací se záměrem, geometrie odvozená přehráním |
| D4 | Reference na geometrii | rozhodnuto | ID odvozená z původu entity, ne z pořadí |
| D5 | Skici | rozhodnuto | Constraint solver od začátku |
| D6 | Constraint solver | rozhodnuto | planegcs (WASM) za vlastním rozhraním |
| D7 | Reprezentace těles | rozhodnuto | Mesh/CSG, bez B-rep |
| D8 | Mesh/CSG jádro | rozhodnuto | Manifold (`manifold-3d`) za vlastním rozhraním |
| D9 | Extrude | rozhodnuto | Síť staví engine sám, jádro dělá jen booleany |
| D10 | Časová osa vs. historie příkazů | rozhodnuto | Skica je jedna feature; undo je oddělená historie příkazů |
| D11 | Dokument | rozhodnuto | Neměnná struktura, undo = zásobník dokumentů, cache = memoizace |
| D12 | Řešení skici | rozhodnuto (přepracováno), doplňky v D25 a D27 | Skica se řeší při přepočtu, když se změnily vstupy solveru; engine pak řešené proměnné v dokumentu aktualizuje |
| D13 | Rozdělená stěna | rozhodnuto | Zůstává jednou logickou stěnou |
| D14 | Rovina skici na stěně | rozhodnuto | Počítá se analyticky z definice feature |
| D15 | Struktura repa | rozhodnuto | pnpm workspace: engine, dva adaptéry, app; Vitest |
| D16 | Kotva skici | rozhodnuto | Rezervovaný pevný bod `origin` v každé skice |
| D17 | Tvar vazeb | rozhodnuto | Každá varianta má pojmenované operandy; podmínky oblouku zajišťuje solver; referenční kóty počítá engine |
| D18 | Orientace roviny na stěně | rozhodnuto | Normála vždy ven z tělesa, znaménko ze sítě, X = Y × N |
| D19 | Koplanární booleany | rozhodnuto (přepracováno), doplněk v D27 | Tolerance ke koplanárním stěnám je záruka portu jádra; adaptér Manifoldu ji plní posunem stěn nástroje před booleanem a jejich návratem po něm |
| D20 | Přesnost jádra | rozhodnuto | `Solid.positions` je `Float32Array`, analytické výpočty ve float64 |
| D21 | Vlastní rovina | rozhodnuto | `PlaneFeature` s posunem od roviny nebo stěny; náklon kolem hrany je budoucí funkce |
| D22 | Pojmenování hran | rozhodnuto | Hrana = dvojice jmen stěn; přímka analyticky, rozsah ze sítě |
| D23 | Promítnutá geometrie | rozhodnuto | Přímé a kruhové hrany tělesa jako pevné referenční křivky ve skice |
| D24 | Rozšíření API z návrhu UI | rozhodnuto | `batch`, pozice v `addFeature`, `getState(at)`, konstrukční geometrie, data pro výběr |
| D25 | Úpravy z druhé revize | rozhodnuto | Víko bez označení oblasti, stav `warning`, razítko řešení skici, hrana `coplanar`, pořadí konců promítnuté úsečky a další |
| D26 | Formát exportu | rozhodnuto | STL v PoC, 3MF později |
| D27 | Úpravy z třetí revize | rozhodnuto | Návrat posunutých stěn v adaptéru, jednotné pravidlo řešení skici, kontrakt příkazů, přesná definice oblastí a další |

D1–D27 jsou odsouhlasené (D10–D27 dne 2026-11-13). Podrobnosti jsou v [architecture.md](architecture.md), návrh UI v [ui.md](ui.md).

## D1 Jazyk enginu: TypeScript

Rozhodnuto 2026-11-12. Engine běží v browseru i v Node. Výpočetně náročné části mohou být WASM knihovny (viz D2).

## D2 Knihovny třetích stran

Rozhodnuto 2026-11-12. Použití knihoven nevadí, ale každou vlastník projektu schvaluje výslovně. Každá knihovna je schovaná za úzkým rozhraním definovaným v enginu, aby šla vyměnit a aby šla napsat testovací implementace.

Schválené: planegcs (D6), Manifold (D8).

## D3 Model dokumentu: log operací

Rozhodnuto 2026-11-10. Dokument je uspořádaný seznam operací. Operace ukládá záměr: typ, parametry a reference na entity vytvořené dřívějšími operacemi. Výsledná geometrie se neukládá, vzniká přehráním logu.

Důsledky:
- Úprava operace uprostřed logu = změna parametru a přehrání od ní dál.
- Undo/redo a serializace pracují s logem, ne s geometrií.

## D4 Reference na geometrii: ID odvozená z původu

Rozhodnuto 2026-11-12. Operace odkazují na entity přes ID. ID se neodvozuje z pořadí vzniku (to se při změně dřívější operace posune a reference by tiše ukázala jinam), ale z původu entity. Příklady:

- „boční stěna extrude E3 vzniklá z úsečky L12 skici S1",
- „horní víko extrude E3".

Pravidla:
- Entity skici mají vlastní trvalá ID přidělená při vytvoření.
- Stěny těles dědí jméno z operace a ze zdrojové entity skici.
- Při booleovské operaci se jména přenášejí podle toho, ze které vstupní stěny výsledný trojúhelník pochází (viz D8, sledování původu).
- Pokud referenci nejde vyhodnotit (entita zanikla), operace se označí jako chybná a uživatel referenci opraví ručně. Tiché přesměrování je nepřípustné.
- Rozdělená stěna chybou není, zůstává jednou logickou stěnou (D13).

Schéma jmen je v architecture.md, sekce Pojmenování.

## D5 Skici: constraint solver od začátku

Rozhodnuto 2026-11-12. Geometrie skici není výsledkem jednosměrných konstrukcí, ale řešením soustavy vazeb a kót. Zvažovaná alternativa (jednosměrné konstrukční operace, solver později) byla zamítnuta.

## D6 Constraint solver: planegcs

Rozhodnuto 2026-11-13. Použije se `@salusoft89/planegcs`, WASM port 2D solveru z FreeCADu, schovaný za rozhraním enginu (entity, vazby, výsledek, diagnostika).

Proč:
- Solver je roky prověřený ve FreeCADu.
- Má to, co je na vlastním solveru nejpracnější: diagnostiku pod- a přeurčených skic a dočasné vazby pro tažení myší. Referenční kóty podle spiku spolehlivě neumí, počítá je engine (D17).
- Má TypeScript typy.
- Hlavní riziko PoC je historie a pojmenování, ne solver.

Rizika:
- Licence LGPL-2.1. Samostatný WASM modul je s ní obvykle slučitelný; u uzavřeného produktu je potřeba právně ověřit.
- Wrapper je malý projekt s nízkou adopcí.
- Paměť WASM se uvolňuje ručně.
- B-spline nejsou dokončené (netýká se PoC).

Ověřeno spikem 2026-11-13, výsledky jsou v architecture.md.

Zvažované alternativy:

| Knihovna | Proč ne |
|---|---|
| ezpz (KittyCAD, Rust, MIT) | Mladý, bez hotového npm balíku, neověřená diagnostika. Záložní volba, pokud by vadila LGPL. |
| SolveSpace `slvs` (C++ → WASM) | GPL-3.0 by se přenesla na celý projekt. |
| neoscad/sketch-solver (Rust, MIT/Apache) | Nový malý projekt, bez hotového browser buildu. |
| Vlastní solver v TS | Realizovatelné, ale diagnostika a stabilní tažení jsou pracné. Možné později za stejným rozhraním, planegcs pak slouží jako testovací orákulum. |
| jsketcher, protractr, assemble2d, 2d-solver | Solver není samostatná knihovna nebo jde o experiment s neúplnou sadou vazeb. |
| Kiwi.js (Cassowary) | Jen lineární vazby. |
| D-Cubed DCM, LGS, C3D Solver | Komerční. |

## D7 Reprezentace těles: mesh/CSG

Rozhodnuto 2026-11-13. Těleso je uzavřená trojúhelníková síť. B-rep (přesné plochy) se nepoužije.

Původně se zvažoval B-rep kvůli přesnému STEP exportu (OpenCascade ve WASM). Zamítnuto kvůli složitosti.

Důsledky:
- STEP export není možný. Výstupem je STL, později i 3MF (D26).
- Kružnice a oblouky se při extrude převádějí na segmenty. Skica zůstává přesná.
- Zaoblení a zkosení hran jsou obtížná, jsou mimo PoC.
- Přechod na B-rep by nebyl pouhou výměnou adaptéru. Změnil by se typ tělesa a stavba extrude, kterou si engine dělá sám (D9). Zůstal by model dokumentu, jména stěn a hran, reference, přepočet a skici.

## D8 Mesh/CSG jádro: Manifold

Rozhodnuto 2026-11-13: Manifold (`manifold-3d`) za vlastním rozhraním.

Jádro dělá booleovské operace nad tělesy (sjednocení, rozdíl, průnik). Engine od něj potřebuje dvě záruky:

1. **Výstup je vždy uzavřené těleso** (manifold). Jinak další operace v logu selhávají nepředvídatelně.
2. **Sledování původu.** U každého výstupního trojúhelníku jde zjistit, ze které vstupní stěny pochází. Bez toho nejde udělat stabilní pojmenování (D4).

Zvolen **Manifold** (`manifold-3d`, C++ → WASM, Apache-2.0).

| Knihovna | Běh | Licence | Uzavřený výstup | Sledování původu | Hodnocení |
|---|---|---|---|---|---|
| **Manifold** | WASM | Apache-2.0 | Zaručený | Ano (`originalID`, `faceID` přežijí booleany) | Zvoleno |
| three-bvh-csg | JS nad three.js | MIT | Nezaručený (README sám odkazuje na Manifold) | Jen přes materiálové skupiny | Zamítnout: nespolehlivé a závisí na rendereru |
| @jscad/modeling | čistý JS | MIT | Nezaručený (BSP algoritmus) | Ne | Zamítnout pro booleany |
| trueform | WASM | neověřeno | Dle vlastního benchmarku ano | Neověřeno | Nový, málo informací |
| MeshLib | WASM/JS vazby | komerční podmínky, neověřeno | Ano | Neověřeno | Nevhodná licence pro PoC |
| csgrs | Rust (vlastní WASM build) | MIT | Jen v pomalejším režimu | Neověřeno | Zbytečná práce navíc |
| OpenCascade | WASM | LGPL | B-rep | Ano | Vyřazeno rozhodnutím D7 |

Proč ne přímo three.js: je to vykreslovací knihovna. Umí vytáhnout profil do sítě pro zobrazení, ale neumí booleovské operace a nezaručuje uzavřené těleso. Navíc by engine závisel na rendereru, což porušuje základní princip 1.

Rizika Manifoldu:
- Při téměř shodných plochách selhává (blány, nespojená tělesa). Spike to potvrdil, řeší to adaptér (D19).
- Vstupem musí být uzavřené těleso (to engine zaručí, protože sítě staví sám).
- Zda `faceID` přežije i vestavěný extrude, se neověřovalo; engine si extrude staví sám (D9).

## D9 Extrude staví engine sám

Rozhodnuto 2026-11-13. Síť extrudovaného profilu sestaví engine v TypeScriptu a jádru ji předá hotovou i s ID stěn. Jádro se použije jen pro booleany.

Proč:
- Engine při stavbě sítě ví, ze které entity skici každá stěna vzniká, a může ji rovnou pojmenovat (D4).
- Všechny segmenty jedné kružnice dostanou stejné ID stěny, takže válcová plocha zůstane jednou logickou stěnou.
- Rozhraní jádra je užší (jen booleany), a tedy snáz vyměnitelné.

Potřebuje triangulaci 2D profilu s dírami (víka). Používá se triangulace z Manifoldu přes rozhraní jádra, bez další knihovny; spike ji ověřil.

## D10 Časová osa a historie příkazů

Časová osa je recept na model, historie příkazů slouží jen undo. Skica je na časové ose jedna položka a její obsah je stav, ne log.

Proč: kdyby každá úsečka byla krok časové osy, osa by měla stovky položek a reference mezi nimi by se staly nepřehlednými. Stejné rozdělení má Fusion. Zamítnutá alternativa: jediný log všech uživatelských akcí, který by byl receptem i historií zároveň.

## D11 Neměnný dokument

Každý příkaz vrátí nový dokument, nezměněné části se sdílejí.

Proč: undo je zásobník dokumentů bez inverzních operací, cache přepočtu je memoizace podle identity objektů a `evaluate` může být čistá funkce. Zamítnutá alternativa: měnitelný dokument s inverzními příkazy a ručním zneplatňováním cache, která je náchylnější k chybám.

## D12 Řešení skici (přepracováno)

Vývoj rozhodnutí:
1. Původně: polohy uložené v dokumentu, solver běží jen v příkazech, přepočet skicu neřeší. Zamítnuto 2026-11-13: skica na stěně neviděla geometrii stěny, takže díra při změně rozměru tělesa zůstala na absolutních souřadnicích.
2. Skica se řeší při každém přepočtu, uložené polohy jsou odhad. Opíralo se to o to, že solver vrátí splněný vstup bitově beze změny.
3. D25: skica si pamatuje, pro jakou promítnutou geometrii polohy platí, a při shodě se neřeší.
4. D27: razítko pokrývá všechny vstupy solveru (křivky, vazby i promítnutou geometrii), ne jen promítnutou geometrii. Řešení tak probíhá na jediném místě, při přepočtu, a stejné pravidlo platí pro změnu tělesa i úpravu skici. Zapisují se atomicky všechny řešené proměnné včetně poloměrů.

Vědomý důsledek: `execute` počítá kvůli zápisu výsledku vždy celý model.

## D13 Rozdělená stěna

Stěna, kterou výřez rozdělí na víc částí, zůstává jednou logickou stěnou.

Proč: části leží v jedné rovině, takže pro skicu na stěně na rozdělení nezáleží, a jméno zůstane stabilní. Zamítnutá alternativa: brát rozdělení jako nejednoznačnost a referenci rozbít; rozbíjelo by to reference při běžných úpravách. Stejně se chovají víka jedné extrude složené z více oblastí (D25).

## D14 Rovina skici na stěně analyticky

Rovina se počítá z definice feature, ze sítě se bere jen existence stěny a směr ven.

Proč: síť má přesnost float32 a po booleanech se její vrcholy mění, analytická rovina je přesná a stabilní. Podmínkou je, že výstup jádra s analytickou geometrií souhlasí (D19, D27).

## D15 Struktura repa

pnpm workspace se čtyřmi balíčky: `engine`, `solver-planegcs`, `kernel-manifold`, `app`. Testy ve Vitestu.

Proč: oddělení enginu od knihoven a rendereru je vynucené fyzicky, `engine` nemá žádnou runtime závislost. Zamítnutá alternativa: jeden balíček se složkami, kde hranice hlídá jen disciplína.

## D16 Kotva skici

Každá skica má rezervovaný pevný bod `origin`.

Proč: bez něj zbývají vždy aspoň dva stupně volnosti a skica nejde plně určit. Zamítnutá alternativa: obecná vazba „fix" na libovolný bod; je to možné rozšíření, ale počátek je potřeba i jako společný vztažný bod pro skici na stěnách.

## D17 Tvar vazeb

Každá varianta vazby má pojmenované operandy s pevným významem. Implicitní podmínky oblouku zajišťuje solver. Referenční kóty počítá engine.

Proč: obecný seznam `refs` nechával význam na pořadí a druhu operandů a adaptér by musel hádat, kterou vazbu knihovny použít. Referenční kóty: spike ukázal, že je planegcs nezvládá spolehlivě.

## D18 Orientace roviny na stěně

Normála míří vždy ven z tělesa, osa X se dopočítá jako Y × N.

Proč: kladná vzdálenost extrude pak vždy znamená ven z tělesa, nezávisle na pořadí bodů úsečky nebo orientaci smyčky. Směr ven se bere ze sítě jako součet normál vážený plochou, protože závisí i na operaci (výřez stěny nástroje obrací).

## D19 Koplanární booleany (přepracováno)

Vývoj rozhodnutí:
1. Původně: engine posune počáteční víko nástroje o `overlap` z nastavení dokumentu.
2. Po spiku Manifoldu: návrh rozšířit pravidlo na všechny rovinné stěny nástroje, stále v core.
3. Rozhodnuto 2026-11-13: přesah je obcházení slabiny konkrétního jádra, proto patří do jeho adaptéru. Port `SolidKernel` dostal záruku tolerance ke koplanárním stěnám. Core staví nástroj přesně, `overlap` z nastavení dokumentu zmizel.

Důvody pro adaptér:
- B-rep jádro by záruku splnilo samo, core by obsahoval kód jen kvůli Manifoldu.
- Ověření, že se koplanární stěny skutečně překrývají, potřebuje síť tak jako tak.
- Velikost přesahu závisí na přesnosti jádra, kterou zná jen adaptér.
- Přesah se použije jen tam, kde stěny opravdu lícují. Nepodmíněný přesah by prodloužil výstupek ze skici na rovině mimo těleso.

Cena: detekce je podle tolerance ze zaokrouhlené sítě, ne přesně ze jmen stěn. Spike ukázal, že to stačí. Omezení jsou v architecture.md.

4. Doplněk 2026-11-13 (D27): samotný posun nestačil. Když stěna nástroje lícovala jen zčásti, zůstal její zbytek ve výsledku o přesah vedle roviny, kterou pro ni engine počítá analyticky, a další operace na ní selhala (nálitek na takové stěně skončil jako samostatná komponenta). Adaptér proto po booleanu vrací zbytky posunutých stěn do původní roviny a slučuje splynulé vrcholy. Spike s řetězenými případy: 34 z 34.

## D20 Přesnost jádra

`Solid.positions` je `Float32Array`, analytické výpočty enginu běží ve float64.

Proč: Manifold jiný typ v JS API nenabízí. Engine proto geometrii neodvozuje ze sítě, pokud ji umí spočítat analyticky.

## D21 Vlastní rovina

`PlaneFeature` s posunem od základní roviny, rovinné stěny nebo jiné vlastní roviny.

Proč jen posun: náklon kolem hrany tělesa a rovina třemi body jsou budoucí funkce. Reference na hrany, které náklon potřebuje, už v PoC jsou (D22).

## D22 Pojmenování hran

Vynuceno promítnutou geometrií (D23); zároveň je to předpoklad pro budoucí rovinu nakloněnou kolem hrany, zaoblení a zkosení. Hrana se nepojmenovává samostatně, její jméno je dvojice jmen sousedních stěn. Přímka přímé hrany se počítá analyticky jako průsečnice rovin obou stěn, ze sítě se bere jen rozsah.

Omezení: krajní body promítnuté hrany mají přesnost sítě (D20).

## D23 Promítnutá geometrie

PoC promítá přímé hrany jako úsečky a kruhové hrany do rovnoběžné roviny jako kružnice (rozšířeno 2026-11-13 kvůli soustřednosti napříč skicami). Promítnutí kruhové hrany do šikmé roviny (elipsa) a vrcholy jsou budoucí funkce; architektura je na elipsu připravená. Promítnutí všech hran stěny při založení skici je věc UI (dávka příkazů), engine umí jen jednotlivou hranu.

## D24 Rozšíření API z návrhu UI

Sepsání funkcí UI a potřebného API (ui.md) ukázalo, co v API chybělo: složený příkaz `batch`, pozice v `addFeature`, `getState(at)`, konstrukční geometrie, data pro výběr myší, `renameFeature`, `updatePlane`, `setSketchPlane`, `updateExternal`.

Proč: UI není těžištěm PoC, ale bez tohoto průchodu by mezery vyšly najevo až při implementaci.

## D25 Úpravy z druhé revize

Revize 2026-11-13 našla jeden rozpor a několik mezer. Všechny připomínky byly oprávněné:

| Nález | Úprava |
|---|---|
| Scénář 2c tvrdil, že extrude po náhradě úsečky projde, ale podle pravidla pro oblasti skončí v `noProfile` | Pravidlo zůstává striktní, scénář je přepsaný. Identifikace smyčky body byla zamítnuta jako nejednoznačná. |
| Jméno víka obsahovalo oblast, takže nový výběr profilu víko přejmenoval | Víko je jen `{feature, role}`. |
| Přesah nástroje byl nepodmíněný | Vyřešeno přesunem do adaptéru (D19), který testuje koplanaritu i překryv. |
| Hrana mezi stěnami v téže rovině nemá průsečnici | Nový druh hrany `coplanar`, nekreslí se a nejde promítnout. |
| Konce promítnuté úsečky neměly určené pořadí | Přímka je orientovaná n_a × n_b v kanonickém pořadí jmen. |
| `sketchConflict` měl dvojí význam | Je to varování: skica použije uložené polohy a model nezmizí. Nový stav `warning`. |
| Determinismus stál na tom, že solver vrátí splněný vstup beze změny, a chyběl mechanismus pro cache | Skica si pamatuje razítko vstupů (původně `solvedFor`, od D27 `solved`); při shodě se neřeší. Záznam v cache se po zápisu převěsí na nový objekt. |
| Sousední oblasti v jedné extrude by nechaly vnitřní stěnu | Sdílené smyčky se vyruší. |
| Kontrakt `boolean` neříkal, kdo zajistí jedinečnost čísel stěn | Je to předpoklad na vstupu, zajišťuje engine. |
| Směr „ven" z jednoho trojúhelníku | Součet normál vážený plochou. |
| D4 odporovalo D13 | Opraveno. |
| Náhled při úpravě skici přepočítával celý model | `preview(cmd, at)` a `evaluate` s koncem u zadané feature. |

## D26 Formát exportu: STL, 3MF později

Rozhodnuto 2026-11-13. PoC exportuje jen binární STL, které engine zapíše sám. 3MF je budoucí funkce.

Důvod odkladu: 3MF je archiv ZIP s XML, takže by engine potřeboval zápis ZIP (vlastní, nebo knihovnu ke schválení podle D2).

Poznámka pro později: STL nenese topologii, 3MF ano, a dokumentace Manifoldu proto doporučuje 3MF. API s více formáty počítá (`exportMesh(format)`).

## D27 Úpravy z třetí revize

Dvě nezávislé revize 2026-11-13. Všechny nálezy jsem ověřil a považuji je za oprávněné; dva z nich jsem ověřil spikem.

Chyby:

| Nález | Úprava |
|---|---|
| Posun stěn v adaptéru rozbíjel navazování na analytické stěny | Reprodukováno. Adaptér po booleanu vrací zbytky posunutých stěn do roviny (D19, bod 4). |
| Pravidlo pro spuštění solveru nepokrývalo úpravy samotné skici | Razítko pokrývá všechny vstupy solveru; řeší se jednotně při přepočtu pro `execute`, `preview` i `batch`. |
| Zápis výsledku solveru nezahrnoval poloměry | Poloměry jsou řešené proměnné vedle bodů (`radii`) a zapisují se atomicky s nimi. |
| Konfliktní `coincident` mohla změnit profil | Body se spojují jen vazbou, která je skutečně splněná. |

Mezery:

| Nález | Úprava |
|---|---|
| Rozbitá promítnutá hrana shodila celou skicu | Je to varování; hrana zůstane zmrazená na posledních platných hodnotách. |
| Kontrakt příkazů nebyl popsaný | Doplněn typ `Command` a `CommandResult`, pravidla validace, generování ID volajícím, kaskády mazání, `load`. |
| Tažení bylo ověřené jinak, než je navržené | Doplněn spike bezstavového tažení; drží. |
| Detekce profilů byla nedourčená | Oblast je omezená stěna rovinného grafu; ruší se sdílené křivky; křížení křivek je chyba `invalidProfile`. |
| Čísla stěn neseděla s cache | Tabulka čísel je součást memoizovaného stavu a je jedna společná. |
| Zápis výsledku vynucuje plný přepočet | Zapsáno jako vědomý důsledek D12. |
| Nadbytečné vazby neměly určený význam | Nejsou chyba ani varování. |
| Chybělo chování pro prázdný výsledek | Varování `noEffect`, chyba `emptyResult`. |
| Nedefinované konvence | Doplněno pořadí jmen, řazení ID, zákaz `/` v ID, orientace úhlu. |
| Validační scénáře nepokrývaly řadu funkcí | Přidány scénáře 5 a 6. |
| Výřez skrz | Zapsáno jako budoucí funkce. |

Rozpory a zastaralý text: referenční kóty (počítá engine, pole `measurements`), oprava promítnuté hrany v ui.md, tvrzení o Web Workeru, slib snadného přechodu na B-rep v D7, zastaralé části D6 a D8, pořadí a rozsah čísel rozhodnutí, chybějící zdůvodnění D10–D21 a D24.

## Spiky 2026-11-13

Obě knihovny předpoklady návrhu splnily, podrobné výsledky jsou v architecture.md. Tři nálezy změnily návrh:

- **D19 přepracováno.** Na šikmých stěnách nestačí posunout počáteční víko. Stejný problém mají boční stěny a koncové víko nástroje, pokud leží v rovině stěny tělesa. Řešení se přesunulo do adaptéru jádra, viz D19.
- **D20 uzavřeno.** Manifold pracuje jen s float32, `Solid` proto také.
- **D17 doplněno.** planegcs nezvládá referenční kóty spolehlivě, počítá je engine.

## Otevřené otázky

Žádné.

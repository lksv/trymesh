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
| D12 | Řešení skici | rozhodnuto (přepracováno), doplněk v D25 | Skica se řeší při přepočtu, jen když se změnila promítnutá geometrie; engine pak polohy v dokumentu aktualizuje |
| D13 | Rozdělená stěna | rozhodnuto | Zůstává jednou logickou stěnou |
| D14 | Rovina skici na stěně | rozhodnuto | Počítá se analyticky z definice feature |
| D15 | Struktura repa | rozhodnuto | pnpm workspace: engine, dva adaptéry, app; Vitest |
| D16 | Kotva skici | rozhodnuto | Rezervovaný pevný bod `origin` v každé skice |
| D17 | Tvar vazeb | rozhodnuto | Každá varianta má pojmenované operandy; podmínky oblouku zajišťuje solver; referenční kóty počítá engine |
| D18 | Orientace roviny na stěně | rozhodnuto | Normála vždy ven z tělesa, znaménko ze sítě, X = Y × N |
| D19 | Koplanární booleany | rozhodnuto (přepracováno) | Tolerance ke koplanárním stěnám je záruka portu jádra; adaptér Manifoldu ji plní úpravou nástroje, core nic neposouvá |
| D20 | Přesnost jádra | rozhodnuto | `Solid.positions` je `Float32Array`, analytické výpočty ve float64 |
| D21 | Vlastní rovina | rozhodnuto | `PlaneFeature` s posunem od roviny nebo stěny; náklon kolem hrany je budoucí funkce |
| D22 | Pojmenování hran | rozhodnuto | Hrana = dvojice jmen stěn; přímka analyticky, rozsah ze sítě |
| D23 | Promítnutá geometrie | rozhodnuto | Přímé a kruhové hrany tělesa jako pevné referenční křivky ve skice |
| D25 | Úpravy z druhé revize | rozhodnuto | Víko bez označení oblasti, stav `warning`, `solvedFor`, hrana `coplanar`, pořadí konců promítnuté úsečky a další |
| D24 | Rozšíření API z návrhu UI | rozhodnuto | `batch`, pozice v `addFeature`, `getState(at)`, konstrukční geometrie, data pro výběr |

D10–D24 odsouhlaseny 2026-11-13. Podrobnosti jsou v [architecture.md](architecture.md), návrh UI v [ui.md](ui.md).

## D12 Řešení skici (přepracováno)

Původní znění (polohy uložené v dokumentu, solver běží jen v příkazech, přepočet skicu neřeší) bylo zamítnuto 2026-11-13. Důvod: skica na stěně neviděla geometrii stěny, takže díra při změně rozměru tělesa zůstala na absolutních souřadnicích. Uživatel by na to narazil jako na první věc.

Nové znění: skica může obsahovat promítnuté hrany tělesa (D23), a proto se řeší při každém přepočtu. Uložené polohy slouží jako počáteční odhad a engine je po každém příkazu aktualizuje na poslední řešení. Determinismus drží díky tomu, že `evaluate` je čistá funkce dokumentu a solver vrací splněný vstup beze změny.

## D22 Pojmenování hran

Vynuceno promítnutou geometrií (D23); zároveň je to předpoklad pro budoucí rovinu nakloněnou kolem hrany, zaoblení a zkosení. Hrana se nepojmenovává samostatně, její jméno je dvojice jmen sousedních stěn. Přímka přímé hrany se počítá analyticky jako průsečnice rovin obou stěn, ze sítě se bere jen rozsah.

Omezení: krajní body promítnuté hrany mají přesnost sítě (D20).

## D23 Promítnutá geometrie

PoC promítá přímé hrany jako úsečky a kruhové hrany do rovnoběžné roviny jako kružnice (rozšířeno 2026-11-13 kvůli soustřednosti napříč skicami). Promítnutí kruhové hrany do šikmé roviny (elipsa) a vrcholy jsou budoucí funkce; architektura je na elipsu připravená. Promítnutí všech hran stěny při založení skici je věc UI (dávka příkazů), engine umí jen jednotlivou hranu.

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
- Má vše, co je na vlastním solveru nejpracnější: diagnostiku pod- a přeurčených skic, dočasné vazby pro tažení myší, referenční kóty.
- Má TypeScript typy.
- Hlavní riziko PoC je historie a pojmenování, ne solver.

Rizika:
- Licence LGPL-2.1. Samostatný WASM modul je s ní obvykle slučitelný; u uzavřeného produktu je potřeba právně ověřit.
- Wrapper je malý projekt s nízkou adopcí.
- Paměť WASM se uvolňuje ručně.
- B-spline nejsou dokončené (netýká se PoC).

Zbývá ověřit prakticky na validačním scénáři 3.

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
- STEP export není možný. Výstupem je STL nebo 3MF.
- Kružnice a oblouky se při extrude převádějí na segmenty. Skica zůstává přesná.
- Zaoblení a zkosení hran jsou obtížná, jsou mimo PoC.
- Jádro je za rozhraním, takže pozdější přechod na B-rep znamená výměnu implementace, ne přepis enginu. Rozhraní se má navrhnout tak, aby to šlo.

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
- Při téměř shodných plochách vznikají úzké trojúhelníky (slivery), které mohou komplikovat pojmenování.
- Vstupem musí být uzavřené těleso (to engine zaručí, protože sítě staví sám).
- Neověřeno: zda `faceID` přežije i vestavěný extrude. Obchází to D9.

## D9 Extrude staví engine sám

Rozhodnuto 2026-11-13. Síť extrudovaného profilu sestaví engine v TypeScriptu a jádru ji předá hotovou i s ID stěn. Jádro se použije jen pro booleany.

Proč:
- Engine při stavbě sítě ví, ze které entity skici každá stěna vzniká, a může ji rovnou pojmenovat (D4).
- Všechny segmenty jedné kružnice dostanou stejné ID stěny, takže válcová plocha zůstane jednou logickou stěnou.
- Rozhraní jádra je užší (jen booleany), a tedy snáz vyměnitelné.

Potřebuje triangulaci 2D profilu s dírami (víka). Návrh: použít triangulaci z Manifoldu přes rozhraní jádra, bez další knihovny.

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

Cena: detekce je podle tolerance ze zaokrouhlené sítě, ne přesně ze jmen stěn. Spike (28 z 28 případů) ukázal, že to stačí. Omezení jsou v architecture.md.

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
| Determinismus stál na tom, že solver vrátí splněný vstup beze změny, a chyběl mechanismus pro cache | Skica si pamatuje `solvedFor`; při shodě se neřeší. Záznam v cache se po zápisu převěsí na nový objekt. |
| Sousední oblasti v jedné extrude by nechaly vnitřní stěnu | Sdílené smyčky se vyruší. |
| Kontrakt `boolean` neříkal, kdo zajistí jedinečnost čísel stěn | Je to předpoklad na vstupu, zajišťuje engine. |
| Směr „ven" z jednoho trojúhelníku | Součet normál vážený plochou. |
| D4 odporovalo D13 | Opraveno. |
| Náhled při úpravě skici přepočítával celý model | `preview(cmd, at)` a `evaluate` s koncem u zadané feature. |

## Spiky 2026-11-13

Obě knihovny předpoklady návrhu splnily, podrobné výsledky jsou v architecture.md. Tři nálezy změnily návrh:

- **D19 přepracováno.** Na šikmých stěnách nestačí posunout počáteční víko. Stejný problém mají boční stěny a koncové víko nástroje, pokud leží v rovině stěny tělesa. Řešení se přesunulo do adaptéru jádra, viz D19.
- **D20 uzavřeno.** Manifold pracuje jen s float32, `Solid` proto také.
- **D17 doplněno.** planegcs nezvládá referenční kóty spolehlivě, počítá je engine.

## Otevřené otázky

- Formát exportu: STL, 3MF, nebo obojí.

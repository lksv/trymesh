# Rozhodnutí

Živý dokument. Zapisuje, co bylo rozhodnuto, proč a co se zvažovalo. Rozhodnutí nejsou neměnná; při změně se záznam přepíše a původní stav se uvede v poznámce.

Poslední úprava: 2026-11-14

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
| D19 | Koplanární booleany | rozhodnuto (přepracováno), doplňky v D27, D28 a D29 | Tolerance ke koplanárním stěnám je záruka portu jádra; adaptér Manifoldu ji plní tak, že každý styk v jedné rovině změní před booleanem na průnik a po něm stěny vrátí a síť vyčistí |
| D20 | Přesnost jádra | rozhodnuto | `Solid.positions` je `Float32Array`, analytické výpočty ve float64 |
| D21 | Vlastní rovina | rozhodnuto | `PlaneFeature` s posunem od roviny nebo stěny; náklon kolem hrany je budoucí funkce |
| D22 | Pojmenování hran | rozhodnuto | Hrana = dvojice jmen stěn; přímka analyticky, rozsah ze sítě |
| D23 | Promítnutá geometrie | rozhodnuto, doplněk v D28 | Přímé a kruhové hrany tělesa jako pevné referenční křivky ve skice; druh křivky se ukládá |
| D24 | Rozšíření API z návrhu UI | rozhodnuto | `batch`, pozice v `addFeature`, `getState(at)`, konstrukční geometrie, data pro výběr |
| D25 | Úpravy z druhé revize | rozhodnuto | Víko bez označení oblasti, stav `warning`, razítko řešení skici, hrana `coplanar`, pořadí konců promítnuté úsečky a další |
| D26 | Formát exportu | rozhodnuto | STL v PoC, 3MF později |
| D27 | Úpravy z třetí revize | rozhodnuto | Návrat posunutých stěn v adaptéru, jednotné pravidlo řešení skici, kontrakt příkazů, přesná definice oblastí a další |
| D28 | Úpravy ze čtvrté revize | rozhodnuto | Druh promítnutí v dokumentu, validace odděluje odkazy ve skice a mezi features, přepracovaný adaptér jádra, oprava zdrojové skici extrude a další |
| D29 | Náhodné testy adaptéru jádra, adaptéry v balíčcích | provedeno při implementaci, vlastník projektu zatím nepotvrdil | Adaptér jádra se ověřuje náhodnými posloupnostmi booleanů proti dvěma nezávislým orákulům; návrat stěn je přesný, síť se čistí vždy a uzavřenost se kontroluje; oba adaptéry jsou v balíčcích s testy |
| D30 | Rozhodnutí z implementace enginu | provedeno při implementaci, vlastník projektu zatím nepotvrdil | Upřesnění, která návrh nechával otevřená: tažení mimo dávku, kritérium „bez účinku", profil dotýkající se v bodě, načtení dokumentu s odkazem na feature v jiném pořadí a další |

| D31 | Ukázková aplikace | provedeno při implementaci, vlastník projektu zatím nepotvrdil | `packages/app`: three.js a Vite bez UI frameworku; pokrývá funkce z ui.md potřebné k projití validačních scénářů; co UI odvozuje samo a co je vynecháno |
| D34 | Souměrnost a střed úsečky | rozhodnuto | Dvě nové geometrické vazby; přidání vazby je položka katalogu, typ, rovnice rozboru a překlad pro solver, aplikace a MCP ji převezmou samy |
| D33 | Rozhraní pro AI (MCP server) | rozhodnuto | `packages/mcp`: obecné nástroje nad enginem s popisem generovaným ze zdrojů enginu; pracuje nad souborem i nad běžící aplikací přes místní most |
| D32 | Diagnostika skici | rozhodnuto | Engine z vlastního rozboru rovnic vazeb řekne, kolik má skica volnosti, které vazby jsou navíc, z čeho plynou, kterou sadu jde odebrat a co se ještě hýbe; stejnou řídicí vazbu nejde přidat dvakrát |
| D35 | Rozšíření pro robotický kloub | rozhodnuto včetně oprav po dvou revizích návrhu a po revizi kontraktu; spike ozubení proveden, implementace nezačala | Sedm funkcí v levných variantách, které nezavírají cestu k plným: parametry a výrazy nad katalogem číselných polí, rozsah vysunutí jako varianta („skrz vše"), ozubení jako generátor profilu pro vysunutí, pole jako seznam transformací (features i těles), export po tělesech a dotazy nad tělesy, stejný poloměr a pevný bod, sdílené nástroje skici (mnohoúhelník). Plná sestava, pole ve skice, import a zaoblení se nedělají |

D1–D28 jsou odsouhlasené (D10–D28 dne 2026-11-13). D29, D30 a D31 vznikly při samostatné práci na implementaci a čekají na potvrzení. D32 až D35 jsou odsouhlasené 2026-11-14. Podrobnosti jsou v [architecture.md](architecture.md), návrh UI v [ui.md](ui.md).

## D1 Jazyk enginu: TypeScript

Rozhodnuto 2026-11-12. Engine běží v browseru i v Node. Výpočetně náročné části mohou být WASM knihovny (viz D2).

## D2 Knihovny třetích stran

Rozhodnuto 2026-11-12. Použití knihoven nevadí, ale každou vlastník projektu schvaluje výslovně. Každá knihovna je schovaná za úzkým rozhraním definovaným v enginu, aby šla vyměnit a aby šla napsat testovací implementace.

Schválené: planegcs (D6), Manifold (D8), `@modelcontextprotocol/sdk` pro MCP server (D33, schváleno 2026-11-14).

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

5. Doplněk 2026-11-13 (D28): čtvrtá revize našla tři případy, které verze z bodu 4 nezvládla. Všechny se podařilo reprodukovat.
   - Bok nálitku lícující s bokem tělesa sahal po sjednocení o přesah pod dosedací rovinu. Vracel se jen zbytek posunuté stěny, a ta v tomto případě zanikla celá. Po odříznutí nálitku zůstaly proužky jeho boků.
   - Lícující stěny se u sjednocení neposouvaly a spoléhalo se, že je jádro spojí samo. S odchylkou float32 mezi nimi zůstal proužek horní stěny s úzkým trojúhelníkem; test rovinnosti podle normál trojúhelníků pak horní stěnu označil za nerovinnou a další operace na ní nechala blánu.
   - Po válcovém výřezu ležel strop mimo rovinu o 2e-4 mm, protože posun vrcholů vycházel z normál úzkých trojúhelníků.

   Adaptér je proto postavený na jednom pravidle místo výčtu případů: stěny nástroje a tělesa se v jedné rovině nesmějí jen dotýkat. Před booleanem se každý takový styk (překryv, dotyk hranou, mezera do dvou přesahů) změní na průnik, po něm se vrátí vše, co s posunutou stěnou odjelo, a síť se vyčistí. Rovinnost se určuje vzdáleností vrcholů od proložené roviny. Podrobnosti jsou v architecture.md. Spike: 46 z 46.

   Zvažované a zamítnuté: zarovnat lícující stěnu nástroje do roviny stěny tělesa a nechat spojení na jádru. Fungovalo jen někdy; jestli boky v šikmé poloze opravdu sousedí, záviselo na zaokrouhlení.

   Cena: adaptér má asi 300 řádků a obsahuje vlastní čištění sítě. Kde stěna nástroje lícuje se stěnou tělesa a překrývají se plochou, nese překrytou část jméno stěny nástroje.

6. Doplněk 2026-11-14 (D29): náhodné testy našly další vady, které pevné případy nezachytily. Návrat stěn se od té doby počítá přesně z původní geometrie, síť se čistí po každém booleanu a adaptér kontroluje uzavřenost výsledku. Podrobnosti a čísla jsou v D29.

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

Doplněk D28: promítnutí ukládá, jako jaký druh křivky se má hrana promítnout (`kind`). Původně se druh odvozoval až při přepočtu. To nešlo dohromady s validací příkazů a načítaného dokumentu, která má pracovat jen se strukturou: z druhu plynou odvozená ID (`<id>/a`, `<id>/center`) a přípustné vazby, a dávka potřebuje na promítnutou křivku navázat dřív, než přepočet proběhne. Když se hrana promítne jinak, než `kind` říká, je to varování a křivka zůstane zmrazená.

Vlastní křivky na promítnuté body neodkazují, připojují se k nim vazbou `coincident`. Jinak by smazání promítnutí nechalo křivku bez koncového bodu.

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

## D28 Úpravy ze čtvrté revize

Dvě nezávislé revize 2026-11-13. Každý nález je ověřený: chyby adaptéru a chování solveru spuštěním (případy jsou doplněné do spiků), ostatní proti textu dokumentů. Všechny nálezy byly oprávněné.

Rozpory:

| Nález | Úprava |
|---|---|
| Promítnutí neukládalo druh křivky, ale validace i `load` ho potřebují znát bez přepočtu | `ExternalRef.kind`, typované hodnoty v razítku (D23). |
| `load` vyžadoval existenci všech odkazovaných entit, takže dokument po `removeFeature` nešel načíst | Validace odděluje odkazy uvnitř skici (musí existovat vždy) a mezi features (ověřují se jen při nastavení; chybějící cíl je chyba přepočtu, ne dokumentu). |

Chyby adaptéru jádra (reprodukováno, opraveno, viz D19 bod 5):

| Nález | Úprava |
|---|---|
| Po sjednocení zůstal bok nálitku protažený pod dosedací rovinu; po odříznutí nálitku zbyly proužky stěn | Návrat zahrnuje i hranice sousedních stěn, když posunutá stěna zanikla. |
| Lícující nálitek s odchylkou float32 nevytvořil hranu `coplanar` a zneplatnil rovinnost horní stěny | Lícující stěny se u sjednocení také posouvají a vracejí; rovinnost se určuje vzdáleností vrcholů od roviny. |
| Hledání dvojice stěn skončilo na první shodě, i když nevedla k posunu | Pravidlo je jednotné, posun vzniká vždy; zvětšení nástroje má přednost před zmenšením. |
| Po válcovém výřezu ležel strop mimo rovinu o 2e-4 mm | Roviny pro posun vrcholu se berou proložené přes stěnu, úzké trojúhelníky se vynechají. |

Při opravě vyšly najevo ještě dvě věci, které revize nenašly: výpočet posunu vrcholu byl pro jedinou šikmou rovinu numericky nestabilní a samotné slučování vrcholů nechávalo v síti nulové trojúhelníky s čísly zaniklých stěn. Obojí je opravené.

Mezery:

| Nález | Úprava |
|---|---|
| `updateExtrude` neuměl změnit zdrojovou skicu, oprava po smazání skici znamenala nové ID | Pole `sketch` v `updateExtrude`. |
| Přichycení na promítnutý bod mohlo vést ke křivce odkazující na odvozený bod; `removeExternal` by ji nechal bez konce | Křivka smí odkazovat jen na vlastní body a počátek; k promítnutému bodu se váže přes `coincident`. |
| `evaluate` neměl jak dostat cíl tažení; `execute(dragPoint)` nezapisoval razítko | Parametr `drag`; tažení zapisuje proměnné i razítko. |
| Rozdělená hrana měla jedinou lomenou čáru | `segments`, seznam úseček. |
| Spojování bodů profilu neřeklo, co s počátkem a promítnutými body | Je tranzitivní a jde i přes ně. |
| Druh hrany `coplanar` neměl toleranci | Úhlová tolerance enginu 1e-4 rad; délková 1e-6 mm pro skicu. |
| Chyběly souřadné systémy základních rovin a znaménko vodorovné a svislé kóty | Doplněno do konvencí; kóty jsou orientované. |
| planegcs: pomocné vazby v diagnostice, výpisy, vazby mezi pevnými entitami | Adaptér filtruje a vypíná výpisy; vazbu jen mezi pevnými entitami odmítá validace. Ověřeno spikem. |
| Okrajové vstupy a potlačená feature | Nulová vzdálenost, prázdné oblasti a nekladný poloměr jsou neplatný příkaz; potlačená feature je prázdná operace. |
| Formát razítka v `addFeature` a tolerance dotyku křivek (z kontroly oprav třetí revize) | Razítko počítá engine, volající posílá prázdné; dotyk křivek používá délkovou toleranci. |

Volby z této revize, které vlastník projektu výslovně potvrdil 2026-11-13:

1. Druh promítnutí se ukládá do dokumentu (místo odvozování při přepočtu).
2. Vlastní křivka nesmí odkazovat na promítnutý bod; UI vytváří vlastní bod a vazbu.
3. Vodorovná a svislá kóta jsou orientované a smějí být záporné.
4. V překryvu lícujících stěn u sjednocení nese plochu jméno stěny nástroje.
5. Tečný dotyk dvou nekonstrukčních křivek mimo spojený bod zneplatní profil celé skici.

## D29 Náhodné testy adaptéru jádra, adaptéry v balíčcích

Provedeno 2026-11-13 a 14 při implementaci. Vlastník projektu zadal pokračovat samostatně; tento záznam shrnuje, co se přitom rozhodlo, a čeká na jeho potvrzení.

**Náhodné testy adaptéru jádra.** 46 pevných případů prošlo, ale adaptér je založený na tolerancích a pevné případy pokrývají jen situace, které někoho napadly. Generátor proto skládá náhodné posloupnosti sjednocení a rozdílů kvádrů, trojbokých hranolů a válců, které často lícují, v náhodně natočené poloze, a výsledek porovnává se dvěma orákuly nezávislými na adaptéru (mřížkový model se jmény stěn, řezy po vrstvách). Popis a čísla jsou v architecture.md, Výsledky spiků.

Co náhodné testy v adaptéru změnily (D19, bod 6):
- Návrat posunutých stěn se nepočítá posunem „do roviny", ale přesně z původní geometrie nástroje a tělesa. Zbytková odchylka zlomku přesahu jinak při pozdější operaci přeložila síť.
- Síť se čistí po každém booleanu, i když se nic neposouvalo.
- Adaptér po každém booleanu ověří, že výsledek je uzavřená plocha, a jinak skončí chybou (`kernelFailure`). Manifold takovou síť při dalším booleanu načte bez chyby a potichu z ní část zahodí.
- Těleso, které se samo sebe dotýká jen hranou, má v místě dotyku zdvojené vrcholy.
- Čištění rozlišuje nulový trojúhelník (vrcholy v přímce) od jehly (dva blízké vrcholy, třetí daleko). Jehla do sítě patří.
- Adaptér ověřuje i to, že žádná rovinná stěna nemá přeložený trojúhelník.

Zvažované a zamítnuté:
- Čistit síť průchodem přes Manifold. Nulové trojúhelníky sbalil špatným směrem.
- Slučovat vrcholy jen po hranách (sbalení hrany), aby nevznikaly hrany se čtyřmi trojúhelníky. Nenašly se tak blány ze dvou listů, které na sebe po návratu dolehly, a jádro je pak načetlo špatně (objem menší o stovky mm³).
- Dělit při čištění každou hranu, u které leží cizí vrchol blízko její přímky. U zdravých hran pod malým úhlem se střídaly dva neuzavřené stavy; dělí se jen hrany bez protějšku.
- Nechat vrcholy, které jádro vrátí bitově na stejném místě, vždy oddělené (kvůli dotyku hranou). Na stejném místě ale vycházejí i vrcholy, které se spojit musí.

Cena: adaptér jádra má asi 900 řádků a je nejsložitější částí mimo engine. Chování stojí na tolerancích odvozených z rozměru modelu; správnost není dokázaná, jen ověřená testy. Selhání je ale bezpečné: adaptér vrátí chybu, ne poškozené těleso.

Stav po opravách z revize: 46 pevných případů prošlo; z 30 000 náhodných žádný vadný výsledek, tři adaptér odmítl chybou (jeden v návrhovém rozsahu).

**Nezávislé revize adaptérů (2026-11-14).** Oba adaptéry prošly revizí, která nálezy ověřovala spuštěním. Všechny níže uvedené nálezy se potvrdily.

Adaptér jádra, opraveno:

| Nález | Úprava |
|---|---|
| Zmenšený nástroj přeskočil stěnu tělesa těsně za svou stěnou a nechal po ní blánu, bez chyby | Posun nejvýš do poloviny mezery; výsledek se kontroluje na přeložené trojúhelníky. |
| Čištění bralo zdravé tenké trojúhelníky jako nulové (blok pronikající bokem o 0,005 až 0,02 mm: chyba ve třetině až polovině poloh) | Dělí se jen hrany bez protějšku; nulový trojúhelník se určuje přísněji. |
| Tolerance nepočítaly se vzdáleností od počátku (model 450 mm od počátku: chyby i potichu vadné výsledky) | Rozměr pro tolerance je nejméně dvojnásobek největší souřadnice. |
| Po dotyku hranou se při každém dalším booleanu zdvojnásobil počet trojúhelníků (28 → 32 980 po dvanácti operacích) | Zdvojí se existující vrchol místo nového uprostřed hrany. |
| Náhodné testy nezkoušely odchylku boku mezi přesností float32 a tolerancí | Přidána odchylka ±3e-5; případy s ní smějí skončit chybou, ne vadným výsledkem. |

Adaptér jádra, ponecháno jako popsané omezení (architecture.md, Omezení): rozlišení kolem 1e-4 rozměru modelu u lícujících stěn, shodné válcové plochy, úzké stěny nástroje, průnik, kvadratická složitost návratu stěn.

Obal jádra, opraveno: obalová funkce `triangulate` v knihovně neuvolňovala paměť WASM (adaptér volá funkci pod ní a uvolňuje sám); vadný vstup (neuzavřená nebo obrácená síť, špatný počet nebo rozsah čísel stěn) se odmítne před předáním knihovně; `triangulate` ověřuje vstup a má popsanou orientaci smyček.

Adaptér solveru, opraveno:

| Nález | Úprava |
|---|---|
| Tažení ve skice s nadbytečnou vazbou skončilo konfliktem (nadbytečné vazby budou běžné) | Nadbytečné vazby se zjistí bez tažení a při tažení se vynechají. |
| Stav `Converged` se bral jako úspěch, i když nadbytečná vazba zůstala nesplněná | Řeší se znovu z výsledku až do stavu `Success`. |
| Stupně volnosti a nadbytečné vazby popisovaly výchozí odhad, ne výsledek; opakované řešení z výsledku dalo jinou diagnostiku | Diagnostika se bere z průchodu, který z výsledku vychází. |
| Řešení se záporným poloměrem; oblouk s pevnými body na různých poloměrech | Takový výsledek je `failed`. |
| Poloměr pevné kružnice s volným středem se měnil v posledních bitech | Vrací se vstupní hodnota. |
| Neznámý druh křivky se bral jako oblouk; nepřípustné ID ve `fixed` se tiše ignorovalo | Výjimka. |
| Výchozí algoritmus často nedoběhl | Záložní Levenberg–Marquardt. |

Adaptér solveru, ponecháno jako popsané omezení (architecture.md, planegcs): falešný konflikt nadbytečné vazby z nepřesného odhadu, kóta mezi totožnými body, překlopení oblouku.

Testy: doplněny případy ke každému opravenému nálezu a kontroly, že vazby dávají geometrii, kterou slibují (dosavadní testy mapování hlídaly jen úbytek stupňů volnosti).

**Adaptéry v balíčcích (D15).** Workspace je založený: `packages/engine` (zatím jen typy přepsané z architecture.md), `packages/kernel-manifold`, `packages/solver-planegcs`. Případy ze spiků běží jako testy ve Vitestu, tisíc náhodných případů při každém spuštění. Kopie adaptéru jádra ve `spikes/` zanikla, aby neexistovaly dvě verze; ve `spikes/` zůstaly jen skripty ověřující samotné knihovny.

Drobná rozhodnutí při tom:
- Balíčky se neskládají, vystavují přímo zdrojový TypeScript (`exports` míří na `src/index.ts`). Sestavení bude potřeba až pro `app`.
- pnpm se spouští přes `npx pnpm@9`, globálně nainstalovaný není. Verze je zapsaná v `packageManager`.
- Vývojové závislosti navíc k D15: `typescript`, `vitest`, `@types/node`. Jsou to nástroje, ne knihovny v běhu; přesto je vlastník projektu výslovně neschvaloval.
- Adaptér solveru vyhodí výjimku na vstup, který odkazuje na neexistující bod nebo křivku nebo dává tečnost dvou úseček. Takový vstup má odmítnout validace příkazů; výjimka je pojistka.
- Adaptér jádra vyhodí výjimku i na vstupní těleso, které jádro nepřijme.

## D30 Rozhodnutí z implementace enginu

Provedeno 2026-11-14. Engine je napsaný podle architecture.md; tady jsou místa, kde návrh nechával volbu na implementaci. Čeká na potvrzení vlastníka projektu.

Příkazy a dokument:
- **`dragPoint` nejde zařadit do dávky.** Tažení dokument nemění, cíl dostane přepočet; v dávce by nebylo jasné, kterému stavu patří. Zvažováno: brát poslední tažení v dávce.
- **ID jsou jedinečná v celém dokumentu**, napříč features a entitami všech skic (tak to říká konvence), a nesmějí být prázdná ani `__proto__`.
- **`load` nekontroluje typ a pořadí cíle odkazu mezi features**, jen jeho tvar. Důvod: po smazání feature jde přidat jinou se stejným ID na jiné místo, a dokument vzniklý povolenými příkazy se musí dát načíst. Špatný cíl se projeví při přepočtu jako `brokenReference`.
- **`updateExtrude` ověřuje jen odkazy, které příkaz mění.** Jinak by nešla změnit vzdálenost u extrude, jehož skica byla smazána.
- **`updateExternal` zahodí zmrazené hodnoty promítnutí**, protože patřily původní hraně.
- **Oblasti a jméno hrany se ukládají v kanonickém tvaru** (seřazená ID křivek, stěny hrany v pořadí jmen), i když je volající pošle jinak.
- **`load` zapisuje výsledek řešení stejně jako `execute`** a maže historii undo. `preview` do vráceného dokumentu výsledek řešení nezapisuje.
- **`execute`, které dokument nezmění** (tažení, které solver nevyřeší), nepřidá krok undo.

Skica:
- **Razítko** je 64bitový otisk kanonického zápisu vstupu solveru: křivky bez konstrukčního příznaku, řídicí vazby, hodnoty promítnuté geometrie. Referenční kóty a konstrukční příznak ho nemění.
- **Tečné napojení ve společném bodě je platné** (zaoblení rohu). Dotyk se bere jako dotyk ve vrcholu až do vzdálenosti √(8·R·tolerance) od něj, protože tečné křivky leží pod tolerancí i kus od bodu dotyku. Cena: skutečné křížení blíž než tato vzdálenost (setiny mm při R = 10) se nepozná.
- **Křivka nulové délky** (úsečka nebo oblouk se spojenými konci) zneplatní profil.
- **Křivky, které žádnou plochu neuzavírají**, se poznají tak, že mají po obou stranách stejnou stěnu grafu; platí to i pro spojku mezi dvěma uzavřenými tvary.

Tělesa a přepočet:
- **Oblasti, které se dotýkají jen v bodě** (nebo oblast, jejíž hranice prochází jedním bodem dvakrát), dají těleso, které se samo sebe dotýká svislou hranou. Síť nástroje má v tom místě zdvojené vrcholy, aby byla uzavřenou plochou.
- **Bez účinku (`noEffect`)**: objem tělesa se nezměnil (relativně do 1e-6); u výřezu navíc ve výsledku nesmí být žádná stěna nástroje. U přidání být může: nástroj uvnitř tělesa, jehož stěna lícuje se stěnou tělesa, ji podle D28 přejmenuje. Cena: přidání nebo výřez menší než miliontina objemu tělesa se ohlásí jako bez účinku.
- **Feature v chybě nebo bez účinku nepřidá jména stěn do tabulky.**
- **Stěny a hrany tělesa se počítají až pro výsledek přepočtu** a pamatují se podle identity sítě.
- **Scénáře jsou ve vlastním balíčku** `packages/scenarios`, aby `engine` nezávisel na adaptérech ani v testech.

Doplněk po nezávislé revizi enginu (2026-11-14). Revize našla čtrnáct chyb, všechny reprodukované spuštěním kódu; opravy mají testy v `packages/engine/test/review.test.ts` a `packages/scenarios/test/review.test.ts`.

| Nález | Oprava |
|---|---|
| Úsečka a oblouk vycházející z vrcholu tečně stejným směrem: pořadí kolem vrcholu určoval šum solveru, takže oblasti chyběly nebo byly špatně (podle natočení skici ve třetině případů) | Pořadí se bere podle směru k bodu křivky v malé vzdálenosti od vrcholu, ne podle tečny |
| ID nebo odkaz se jménem vlastnosti objektu (`constructor`, `toString`) shodily přepočet výjimkou nebo daly špatný kód chyby | Taková ID jsou nepřípustná a odkazy se hledají jen mezi vlastními klíči záznamů |
| Přidání drobného výstupku na velké těleso se ohlásilo jako bez účinku | Změna objemu se měří proti menšímu z obou těles |
| Tažení, které solver nevyřešil, nechalo ve stavu enginu přechodný konflikt | Takové tažení stav nemění |
| Kružnice s obřím poloměrem vyžádala nekonečně mnoho úseček a vyčerpala paměť | Strop 4096 úseček na křivku, čísla dokumentu v rozsahu ±1e9 |
| Křivka těsně míjející oblouk (pod tolerancí dělení) dala těleso, které se samo protíná a na kterém selhal každý další boolean | Profil se po rozdělení oblouků ověří znovu; křížení nebo splasknutá oblast ho zneplatní |
| Bod smazaný a v téže dávce přidaný pod stejným ID zůstal nevyřešený, protože otisk vstupů solveru se nezměnil | Nový bod a nová křivka ruší razítko |
| Konstrukční příznak měnil pořadí klíčů, takže uložení, načtení a uložení nedalo stejný text | Pořadí klíčů je stejné jako při načtení |
| `load` smazal historii dřív, než přepočet doběhl | Historie se maže až po úspěšném přepočtu |
| Příkazy bez účinku (přejmenování na stejné jméno, tažení plně určeného bodu) přidávaly krok undo | Krok undo vzniká jen změnou obsahu |
| Výjimka posluchače připravila ostatní o zprávu; vnořené volání enginu doručilo stavy ve špatném pořadí | Viz „Chování fasády" v architecture.md |
| Tatáž oblast dvakrát skončila zavádějící chybou jádra | Oblasti se při validaci slučují |
| Pomocná tabulka přepočtu rostla s každou feature, která kdy existovala | Tabulka žije jen po dobu jednoho přepočtu |
| Drobnosti: záporná nula, vzdálenost 1e300, záporný poloměr zmrazeného promítnutí | Validace |

Rozhodnutí, která z toho plynou:
- **Platnost profilu závisí i na `chordTolerance`.** Tvar, který je geometricky v pořádku, ale jemnější než dělení oblouků, je neplatný. Zvažováno: vyžadovat u přesných křivek odstup větší než výška úseče (bez druhé kontroly; vyžadovalo by počítat vzdálenost úsečky od oblouku a oblouku od oblouku) a zjemnit dělení jen v místě těsného míjení (složitější, sousední oblasti by přestaly sdílet vrcholy).
- **Odkaz na stěnu nebo hranu zahrnuje extrude, který je pojmenoval:** skicu na dně kapsy nejde přesunout před výřez, který kapsu vytvořil.
- **`getState(at)` s neznámou feature je výjimka, ne chybový výsledek:** je to chyba volajícího, ne stav dokumentu.
- **Posluchač, který vyhodí výjimku, shodí volání `execute` až po zápisu stavu.** Zvažováno: výjimky posluchačů tiše zahodit (chyba v UI by zůstala neviditelná).

Co revize našla a zůstává: skutečné křížení blíž než √(8·R·tolerance) od společného vrcholu se nepozná (viz výše); `add` kusu, který se tělesa nedotýká, dá jedno těleso se dvěma částmi a stav `ok`; validační scénáře nepokrývají samostatně moduly `solid.ts` a `evaluate.ts` (jsou ověřené jen přes scénáře a náhodné posloupnosti revize).

## D31 Ukázková aplikace

Provedeno 2026-11-14. `packages/app` je ukázkové UI podle [ui.md](ui.md). Čeká na potvrzení vlastníka projektu.

Knihovny a nástroje:
- **three.js** (`three` 0.187) pro vykreslení. Je v návrhu od začátku (D15, architecture.md).
- **Vite** (8.x) jako vývojový server a sestavení, **`@types/three`** pro typy. Jsou to vývojové nástroje, v běhu aplikace nejsou; vlastník projektu je výslovně neschvaloval. Zvažováno: esbuild s vlastním skriptem (méně závislostí, ale ruční obsluha WASM souborů a obnovování stránky).
- **Bez UI frameworku.** Panely se při změně stavu postaví znovu z `EngineState` malou pomocnou funkcí. Zvažováno: React nebo Svelte; pro rozsah PoC by přidaly závislost a sestavovací krok bez přínosu.

Rozdělení: `viewport.ts` kreslí obecný popis scény a o enginu neví; `sketch-view.ts` a `sketch-commands.ts` jsou čisté funkce (geometrie skici, příkazy nástrojů, vazby z výběru) a mají testy proti skutečnému enginu v Node; `app.ts` drží stav UI. Engine se o UI nedozvěděl nic nového: aplikace používá jen veřejné API a žádná změna enginu kvůli ní nebyla potřeba.

Co UI rozhoduje samo (ui.md to nechával na něm):
- **Pohled** je rovnoběžný (bez perspektivy). Levé tlačítko vybírá a kreslí, pravé otáčí, kolečko přibližuje, prostřední nebo Shift + pravé posouvá. Bez myši (touchpad): Alt/Option + tažení otáčí, Alt + Shift + tažení posouvá, posun dvěma prsty nebo roztažení přibližuje.
- **Výběr v pohledu**: hrana má přednost před stěnou, stěna před rovinou. Rovinu jde v pohledu vybrat jen tam, kde pod kurzorem není těleso; základní roviny jdou zvolit i tlačítkem. Důvod: základní roviny procházejí modelem a zakrývaly by stěny.
- **ID nových entit**: předpona a pořadové číslo (`p12`, `c7`, `k3`, `s2`), které v dokumentu není; čítač se během sezení nevrací. Cena: ID entity smazané v dřívějším sezení se může použít znovu. Zvažováno: náhodná ID (nikdy se neopakují, ale v seznamu vazeb se nedají číst).
- **Skica na stěně promítne její obrys** hned při založení, v jednom kroku undo se založením skici.
- **Nová kóta dostane současnou míru** zaokrouhlenou na setinu milimetru (úhel na celé stupně) a upravuje se v seznamu vazeb. Kótu jen mezi pevnými entitami engine jako řídicí odmítne; UI ji přidá jako referenční a oznámí to.
- **Řetěz úseček** pokračuje z konce poslední úsečky a končí napojením na existující bod nebo klávesou Esc. Odvozuje se jen vodorovnost a svislost volného konce.
- **Smazání křivky** smaže i její body, které už nic nepoužívá.
- **Značka pozice**: model se zobrazí po zvolené feature a nové features se vkládají za ni.
- **Vysunutí a rovina** se zadávají v panelu s živým náhledem přes `preview`; dokument se změní až potvrzením. Skica s jedinou oblastí ji vybere sama; skica na stěně tělesa navrhne přidání k tomuto tělesu.
- **Viditelnost** těles, skic a rovin je stav UI a neukládá se.

Vynecháno proti ui.md: přichycení a odvozené vazby jiné než vodorovná a svislá, umístění kóty myší (vodorovná a svislá kóta mají vlastní tlačítko), ikony vazeb v pohledu (vazby jsou v seznamu, kóty i jako popisky), oprava odkazu na cílové těleso jinak než v panelu vysunutí, dotykové ovládání.

Doplněk po nezávislé revizi aplikace (2026-11-14). Revize našla jednu vážnou chybu a devět středních; opravené jsou všechny, čisté části mají testy v `packages/app/test/sketch-tools.test.ts`.

| Nález | Oprava |
|---|---|
| Dvojklik nástrojem Úsečka (běžné ukončení řetězu) založil úsečku nulové délky a zneplatnil skicu | Křivka mezi body na stejném místě nevznikne; místo pod kurzorem se po každé změně skici počítá znovu |
| Výběr v pohledu přežil posun značky pozice, takže šla založit skica na stěně, která v tom místě osy neexistuje | Výběr platí jen pro to, co je vidět, a končí se změnou režimu |
| Úprava vysunutí s chybějícím cílem ho při změně vzdálenosti tiše přepsala jiným tělesem | Chybějící cíl se sám nepřepisuje |
| Neúspěšné otevření souboru nechalo UI v rozporu samo se sebou; úspěšné nechalo skrytá tělesa z minulého dokumentu | Stav UI se vrací při chybě a čistí při úspěchu |
| Vyprázdněné pole kóty nastavilo hodnotu 0 | Prázdný vstup hodnotu nemění |
| Úhlová kóta těsně u −180° se zaokrouhlila na hodnotu, kterou engine odmítá | Úhel se převádí do (−π, π] |
| Rozpracovaná rovina šla zvolit jako svůj vlastní základ | V pohledu ji vybrat nejde |
| Tažení bodu nešlo zrušit a po ztrátě ukazatele bod dál sledoval kurzor | Esc, ztráta ukazatele i změna dokumentu tažení ruší |
| Promítnutí, které nejde vyhodnotit, nebylo v UI vidět a nešlo zrušit ani opravit | Panel skici má seznam promítnutí se stavem, opravou a zrušením |
| Pohled na skicu na stěně obrácené dolů byl otočený o 180° | Úklon kamery se řídí směrem normály |

Drobnosti opravené zároveň: stará chyba ve stavovém řádku po úspěšném příkazu, značka pozice po zmizení své feature, skrývání u přidání a výřezu (těleso se skrývá u prvku, který ho založil), odznak „Plně určená" u prázdné a nevyřešené skici, hláška u nového vysunutí bez oblastí, zaokrouhlení nové kóty, rozlišení plátna po přesunu na jiný monitor. Undo a redo jsou při rozpracovaném vysunutí nebo rovině vypnuté.

Co zůstává: export STL vždy exportuje celý model, i když je zobrazen stav u značky pozice; logika třídy `App` (režimy, události) nemá automatické testy, jen ruční průchody v prohlížeči.

Ověření: testy čistých modulů ve Vitestu a ruční průchod v prohlížeči (skica, kóty, vysunutí, výřez na stěně, rovina, úprava, značka pozice, potlačení, smazání s chybou závislé feature, undo a redo, uložení a načtení, export STL).

## D32 Diagnostika skici

Rozhodnuto 2026-11-14 na podnět vlastníka projektu. Skica nakreslená v aplikaci měla dva stupně volnosti a šest vazeb navíc (tři z nich přesné duplicity) a z aplikace nešlo poznat ani jedno: solver jako nadbytečné označil dvě vazby ze šesti a o tom, co je volné, neříkal nic.

- **Dva dotazy enginu,** `diagnoseSketch` a `explainConstraint`. Jsou na vyžádání a nic nemění; popis je v architecture.md, sekce Diagnostika skici. Stejná data použije aplikace i rozhraní pro AI.
- **Rozbor v prvním řádu z vlastních rovnic vazeb,** ne dotazy na solver. Engine má pro každý typ vazby její rovnici, z derivací ve vyřešeném stavu sestaví Jacobiho matici a stupně volnosti, závislosti i volnost entit z ní počítá lineární algebrou. Stejný rozbor dává i počet stupňů volnosti ve výsledku skici.
  - **První verze používala solver jako orákulum** (skica se řešila znovu bez každé vazby a s každým zafixovaným bodem). Nezávislá revize ji vyvrátila: solver ohlásí cyklus shodných délek jako plně určený, u úsečky stažené do bodu mu volnost s přidanou vazbou vzroste, šum ve vyřešené poloze označil pevný bod za volný a třicet obdélníků ve skice trvalo přes dvacet sekund.
  - **Cena rozhodnutí:** engine teď zná rovnici každé vazby, což solver dřív zapouzdřoval. Je to jedna krátká funkce na typ vazby; shodu se solverem hlídají testy a úplnost tabulky typy. Solver zůstává vyměnitelný, protože rovnice popisují význam vazby, ne způsob řešení.
  - **Zvažováno:** rozšířit port solveru o dotaz na závislosti (planegcs takový dotaz nemá a jeho vlastní hodnost je právě to, co selhalo).
- **Nadbytečné jsou všechny členy závislé skupiny,** ne jen poslední přidaná vazba. Uživatel si má vybrat, kterou odebere; engine k tomu nabízí jednu konkrétní sadu, ve které zůstávají starší vazby.
- **Volnost se udává po entitách,** ne po směrech. Bod přichycený na šikmou úsečku se může hýbat v obou osách, ale má jeden stupeň volnosti; počet stupňů to vystihuje, dvojice příznaků pro osy ne. Položka „stav určenosti po jednotlivých entitách" tím přešla z budoucích funkcí do PoC.
- **Přesnou duplicitu engine odmítne** už v příkazu (`addConstraint`, přepnutí kóty na řídicí). Druhá kóta téhož s jinou hodnotou je také duplicita: správná cesta je upravit tu stávající. Načtení duplicity přijímá, jinak by nešly otevřít dokumenty ze starší verze; hodnotu takové kóty jde dál měnit.
- **Katalog vazeb** (`engine/src/catalog.ts`) je jediný zdroj pravdy o tom, jaké vazby engine zná, jaké mají operandy a hodnoty. Řídí se jím validace příkazů, hledání duplicit i rozbor.
- **Validační scénář 7** (skica krok za krokem s diagnostikou) a testy nad skicou, ze které podnět vzešel.
- **Zobrazení v aplikaci.** V seznamu vazeb je označená jen sada navržená k odebrání, ne všechny členy závislých skupin: souhrn „6 vazeb navíc" tak odpovídá šesti označeným řádkům. Z čeho vazba plyne, ukáže kliknutí na ni (podbarvení v seznamu, zvýraznění v pohledu, věta v panelu). Hromadně jde smazat jen duplicity; u ostatních je na uživateli, kterou vazbu ze skupiny nechá. Volné entity jsou modré a určené tmavé, jak je v CAD zvykem. Podrobnosti jsou v ui.md, Stav implementace.

Nálezy revize a jejich řešení:

| Nález | Řešení |
|---|---|
| Úsečka stažená solverem do bodu: volnost 9 místo 5, všechny vazby „navíc" | Rozbor z vlastních rovnic; tento stav pro něj není zvláštní |
| Cyklus shodných délek: skica ohlášená jako plně určená, potřebná kóta označená za nadbytečnou, vysvětlení nebylo nejmenší | Totéž; stav skici i diagnostika teď vycházejí z jednoho rozboru |
| Pevný bod dotyku v drážce označený za volný | Totéž; tečnost ve společném bodě má vlastní rovnici (kolmost poloměru) |
| V načteném dokumentu s duplicitními kótami nešla změnit hodnota žádné z nich | Duplicita se hlídá jen při přepnutí referenční kóty na řídicí |
| Nulová vzdálenost vedle totožnosti neměla vysvětlení | Nulová vzdálenost se počítá jako totožnost |
| Diagnostika trvala sekundy až desítky sekund | Rozbor nevolá solver; 240 vazeb kolem 0,1 s |

Druhá revize (už nad rozborem z vlastních rovnic) našla chyby v jeho číselné stránce:

| Nález | Řešení |
|---|---|
| Tečnost se počítala jako kolmost poloměru, kdykoli konec úsečky nebo oblouku na kružnici ležel, i jen shodou rozměrů nebo díky tečnosti samé: z rozboru vypadl poloměr (volnost o 1 vyšší, tečnost „navíc") | Podoba pro společný bod se použije, jen když bod na kružnici drží ostatní vazby; pozná se to z prostoru jejich řádků |
| Body splynulé jen na přesnost solveru: krok derivace podtekl a vazba mezi nimi se nepočítala (volnost až o 2 vyšší) | Rovnice se vyhodnocují v souřadnicích vzhledem k bodu vazby a posun se přičítá až k nim |
| Volnost entit: pomocné vektory pokrývaly jen dva rozměry, při volnosti skici 3 a víc vycházela bodům volnost nižší | Pomocné vektory z generátoru pseudonáhodných čísel s pevným semínkem |
| Kolmost a rovnoběžnost stejně dlouhých úseček: dělení větší z obou délek má zlom, řádek měl chybu na hraně prahu (čtverec s volností 3 místo 4, kóta navíc ve vysvětlení) | Dělitelem je délka ve vyřešeném stavu |
| Malý útvar daleko od počátku ztrácel nadbytečnost | Souřadnice vzhledem k bodu vazby (viz výše) |
| Vysvětlení obsahovalo vazbu, bez které se obejde (totožnost zastoupená v bázi jen jednou rovnicí) | Ze sady se zkouší ubírat, dokud vazba plyne ze zbytku |
| Počet vazeb v sadě k odebrání závisí na pořadí, když je mezi nimi vazba se dvěma rovnicemi | Chování zůstává, dokumentace opravena: na pořadí nezávisí počet odebraných rovnic, ne vazeb |
| Rozbor běží při každém vyhodnocení a roste se třetí mocninou | Druhý průchod ortogonalizace jen tam, kde je potřeba; cena změřena a zapsána, u stovek vazeb zůstává omezením |

Revize zobrazení v aplikaci:

| Nález | Řešení |
|---|---|
| Vysvětlení tvrdilo, že odebrat jde i kterákoli z vazeb, ze kterých označená plyne; u vazby se dvěma rovnicemi (střed úsečky, totožnost) to neplatí | „Kterákoli z nich" se nabízí, jen když jsou ty vazby samy celé navíc |
| Rada k ukotvení doporučovala totožnost s počátkem i tam, kde stáhne geometrii do bodu | Radí se dvě kóty od počátku |
| Vysvětlení nad seznamem vazeb posouvalo řádky, takže druhé kliknutí trefilo jinou vazbu | Vysvětlení je hned pod označeným řádkem |
| Stejná referenční kóta šla přidat opakovaně (kóta mezi pevnými entitami) | Aplikace ji podruhé nepřidá |
| U skici v konfliktu byly duplicity označené, ale chyběl jejich počet a tlačítko pro smazání | Souhrn duplicit a tlačítko jsou i u nevyřešené skici |
| Nevyřešená skica byla celá v barvě „volné" | Neutrální barva, dokud se o volnosti nedá nic říct |
| Vazba vynechaná při řešení (ztracená promítnutá geometrie) se vysvětlovala jako potřebná | Vlastní věta |
| Tvary slov („body p1", „a dalších 3") | Opraveno a pokryto testy |

Omezení:

- Závislost se posuzuje v prvním řádu. Vazba plynoucí z ostatních jen díky konkrétním hodnotám se jako nadbytečná neoznačí a výsledek u ní může záviset na šumu ve vyřešených polohách; tečnost ve společném bodě je ošetřená jen tehdy, když je tím bodem konec úsečky nebo oblouku a na kružnici ho drží jiné vazby než tečnosti. Skica na hraně singulárního stavu může dát výsledek závislý na pořadí vazeb.
- Vysvětlení vazby je sada, ze které nejde nic ubrat, ne nutně ta s nejmenším počtem vazeb. Do sady k odebrání se dostane jen celá vazba; vazba, ze které je navíc jedna rovnice ze dvou, označená není.
- Při konfliktu diagnostika nadbytečnost ani volnost nepočítá a konfliktní vazby přebírá ze solveru, který jich označí víc, než je nutné.
- „Starší vazby zůstávají" se řídí pořadím klíčů v dokumentu; ID ve tvaru celého čísla řadí JavaScript číselně, takže u nich pořadí vzniku neplatí.
- Nadbytečnou vazbu, kterou solver sám nepozná (třetí rovnost délek v trojúhelníku), bere solver dál jako plnohodnotnou: skica se chová jako plně určená a bodem nejde táhnout, dokud se vazba neodebere. Diagnostika ji ukáže.
- Cena roste se třetí mocninou počtu vazeb a rozbor běží při každém vyhodnocení skici včetně kroků tažení: 240 vazeb kolem 15 ms, 480 kolem 0,1 s, 960 kolem 0,8 s. Diagnostika a vysvětlení přidají čas stejného řádu.

## D33 Rozhraní pro AI (MCP server)

Rozhodnuto 2026-11-14 na podnět vlastníka projektu: místo předávání souboru má stačit říct „mám narýsovanou skicu se dvěma stupni volnosti, proč" a AI se na model podívá sama.

- **Balíček `packages/mcp`** s MCP serverem nad standardním vstupem a výstupem. Používá oficiální knihovnu `@modelcontextprotocol/sdk` (schválena vlastníkem; táhne s sebou zhruba devadesát tranzitivních balíčků, v běhu aplikace není).
- **Málo obecných nástrojů místo nástroje na každou operaci:** `describe_api`, `get_model`, `get_document`, `get_sketch`, `explain_constraint`, `get_body`, `execute`, `preview`, `undo`, `redo` a pro soubory `session_status`, `open_document`, `save_document`, `export_stl`. Příkaz je hodnota typu `Command` enginu, validuje ho engine a vrací srozumitelnou chybu.
- **Popis se generuje ze zdrojů enginu,** aby se rozhraní nerozcházelo s enginem a nové vazby a příkazy se v něm objevily samy: typy dokumentu a příkazů se berou přímo ze zdrojového textu `types.ts`, vazby z katalogu (`catalog.ts`), kterým se řídí i validace. Ručně psané jsou jen konvence (jednotky, ID, jak se staví skica). Test ověřuje, že každou vazbu z katalogu engine podle příkladu z popisu přijme. Zvažováno: nástroj na každý příkaz se schématem JSON (přesnější nápověda pro klienta, ale schémata by se psala ručně vedle typů a s každou vazbou by přibýval nástroj).
- **Dva režimy, stejné nástroje.** Server má vlastní engine pro dokument ze souboru. Když se k němu připojí běžící aplikace, nástroje se provádějí nad jejím enginem: uživatel změny hned vidí a jdou vrátit přes Zpět. Soubory čte a zapisuje vždy server.
- **Most do aplikace** je místní HTTP na `127.0.0.1` (výchozí port 4517): aplikace čte požadavky jako proud událostí a odpovědi posílá zpět. Bez další knihovny (WebSocket by v Node potřeboval balíček `ws`). Propojení se v aplikaci zapíná tlačítkem AI, samo se nenavazuje; platí poslední připojená aplikace.
- **Kdo se smí k mostu připojit.** Jen stránka z tohoto počítače. Hlídají to tři věci zároveň: původ stránky (`Origin`), cílová adresa v hlavičce `Host` (obrana proti přesměrování DNS) a vlastní hlavička požadavku, kterou cizí stránka bez svolení serveru poslat nemůže a prvky jako obrázek ji neposílají vůbec. Sama kontrola původu nestačila: požadavek bez hlavičky `Origin` dokázal odpojit skutečnou aplikaci a převzít příkazy určené pro ni.
- **Každý dokument má svůj soubor.** Server si pamatuje zvlášť soubor vlastního dokumentu a soubor dokumentu v aplikaci (jen po dobu jednoho připojení). Uložení bez cesty tak nezapíše dokument jednoho enginu přes soubor druhého.
- **Rozpracovaná operace v aplikaci** (vysunutí, rovina) se zruší, když AI dokument opravdu změní; neplatný příkaz ani undo bez historie ji nechají. Načtení dokumentu od AI vymění stav UI stejně jako Otevřít a při neúspěchu ho vrátí.
- **Neplatný příkaz je chyba volání** (příznak chyby v odpovědi), ne výsledek: klient i aplikace ho tak poznají bez čtení těla odpovědi.
- **Spuštění:** `pnpm mcp:build` sestaví `packages/mcp/dist/server.js`; klient AI ho spouští příkazem `node packages/mcp/dist/server.js [--file model.json] [--port 4517] [--no-bridge]`. V kořeni repa je `.mcp.json`, takže Claude Code server nabídne sám.

Nálezy nezávislé revize a jejich řešení:

| Nález | Řešení |
|---|---|
| Uložení bez cesty zapsalo dokument aplikace přes soubor serveru a naopak | Soubor se pamatuje pro každý dokument zvlášť |
| Server po zavření vstupu neskončil a dál držel port mostu | Končí i při zavření standardního vstupu |
| Most přijal požadavek bez hlavičky `Origin` a nehlídal `Host` | Kontrola `Host` a povinná vlastní hlavička |
| Konce hran v `get_body` byly u oblouků, kružnic a přerušených hran špatně | Přímá hrana má krajní body a příznak mezery, kruhová střed a poloměr, každá délku |
| Rada u skici s jedním stupněm volnosti navrhovala totožnost, která končí konfliktem | Rada se řídí počtem stupňů volnosti (i v panelu aplikace) |
| Neplatný příkaz se vracel bez příznaku chyby; aplikace kvůli němu rušila rozpracovanou operaci | Chyba volání; operace se ruší jen při skutečné změně |
| Neúspěšné otevření dokumentu od AI nechalo UI ve výchozím stavu | Stav UI se při neúspěchu vrací |
| Výjimka v obsluze aplikace nechala volajícího bez odpovědi | Odpověď se pošle vždy; hlášení říká, že změna už mohla proběhnout |
| Nevyřešená skica vypadala v přehledech jako „0 stupňů volnosti" | Přehledy mají příznak `solved` a volnost uvádějí jen u vyřešené skici |
| Volby příkazové řádky: neplatný port, chybějící hodnota a neznámá volba se tiše ignorovaly | Jsou to chyby spuštění s nápovědou |

Další revize (2026-11-14, dodaná vlastníkem projektu):

| Nález | Řešení |
|---|---|
| Po Nový nebo Otevřít v aplikaci zůstal zapamatovaný soubor předchozího dokumentu a `save_document` bez cesty ho přepsal novým dokumentem | Aplikace s každou odpovědí hlásí pořadové číslo dokumentu; zapamatovaný soubor platí jen pro dokument, ke kterému patří. `session_status` si číslo před odpovědí ověří |
| Dvě aplikace se zapnutým propojením si spojení přebíraly dokola (vytlačená se po třech sekundách připojila znovu) a příkaz mohl změnit nesprávný dokument | Vytlačená aplikace dostane událost `displaced`, propojení v ní zhasne a sama se nepřipojuje |
| `explain_constraint` radil odebrat kteroukoli vazbu z `impliedBy`, i když by se tím skica uvolnila (bod na úsečce plyne ze středu úsečky) | Rada se řídí tím, které z těch vazeb jsou samy navíc; každá má příznak `removableInstead` (stejné pravidlo jako v panelu aplikace) |

Omezení: most nemá přihlášení, spoléhá na místní adresu a kontroly popsané výše; připojit se může kterákoli stránka běžící na tomto počítači. Velikost odpovědi není omezená (model se stovkami těles dá megabajty) a `save_document` i `export_stl` existující soubor přepíšou bez ptaní. Běží-li dva MCP servery, most otevře jen první; druhý pracuje jen se soubory. Typy v `describe_api` jsou zdrojový text v TypeScriptu, ne schéma JSON, takže klient vstup příkazu sám nevaliduje. Texty nástrojů jsou česky jako zbytek projektu.

## D34 Souměrnost a střed úsečky

Rozhodnuto 2026-11-14. Konstrukční křivky byly bez těchto dvou vazeb málo užitečné: osa souměrnosti nešla použít jako osa.

- **`symmetric`** (`a`, `b`, `line`): body `a`, `b` jsou souměrné podle přímky, na které úsečka leží. Na pořadí bodů nezáleží. Bod, který je koncem osy, souměrný být nesmí (byla by to totožnost).
- **`midpoint`** (`point`, `line`): bod leží v polovině úsečky. Koncem téže úsečky být nesmí.
- **Obě vazby mají dvě rovnice,** ubírají tedy dva stupně volnosti. V solveru je souměrnost vazba `p2p_symmetric_ppl`; střed úsečky je souměrnost jejích konců podle bodu (`p2p_symmetric_ppp`).
- **Co přidání vazby stojí.** Čtyři místa v enginu a adaptéru: typ v `types.ts`, položka katalogu (operandy, zaměnitelnost, kontrola), rovnice v `analysis.ts` a překlad v adaptéru solveru. Úplnost rovnic i překladu hlídají typy (bez nich se projekt nepřeloží) a test, který pro každý typ vazby ověřuje shodu rovnic se solverem.
- **Aplikace a MCP se neměnily kvůli těmto dvěma vazbám, ale kvůli všem dalším.** Aplikace bere seznam geometrických vazeb, jejich jména a nápovědu z katalogu a výběr rozděluje mezi operandy podle druhů, které katalog uvádí (zvláštní pravidla zůstala jen tam, kde jedna akce zakládá víc vazeb). MCP server nové vazby převzal bez jediné změny; jeho test, který každou vazbu z katalogu posílá enginu, je pokryl sám.
- **Validační scénář 8** (souměrný díl s konstrukční osou).

- **Splynulá dvojice v adaptéru solveru.** Knihovna počítá souměrnost ze spojnice obou bodů (a střed úsečky ze spojnice jejích konců). Leží-li body ve stejném místě, hlásí vazbu jako konflikt, přestože je splněná: souměrná dvojice na ose je platný stav. Adaptér proto při takovém konfliktu zkusí dvě náhradní cesty: nejdřív body o kousek rozestoupí a řeší původní soustavu (najde se tak řešení, ve kterém nesplývají), a když to nepomůže, nahradí vazbu jejím splynulým tvarem (totožnost bodů a bod na ose, u středu úsečky totožnost bodu s oběma konci). Každé řešení náhradního tvaru původní vazbu splňuje, takže skutečný konflikt zůstává konfliktem.

Nálezy revize a jejich řešení:

| Nález | Řešení |
|---|---|
| Souměrná dvojice, kterou jiná vazba stáhne na osu (bod na ose, totožnost bodů, totožnost s počátkem, nulová vzdálenost), se hlásila jako konflikt; stejně dvojice splynulá už na vstupu | Náhradní cesty v adaptéru solveru (viz výše) |
| Střed úsečky, jejíž konce leží přesně ve stejném místě, se hlásil jako konflikt | Totéž |
| Aplikace nabízela souměrnost a střed úsečky i pro výběr, který engine vždy odmítne (souměrný bod je koncem osy) | Nabídka podle katalogu se řídí i vlastním pravidlem vazby |
| Přiřazení výběru operandům bylo hladové a u budoucí vazby s překrývajícími se druhy operandů by platné přiřazení nenašlo | Přiřazení zkouší všechny možnosti |
| Rada „totožností s počátkem" (aplikace i MCP) vedla u souměrné dvojice a u úsečky z počátku ke stažení geometrie do bodu | Radí se dvě kóty od počátku |

Omezení:

- Solver souměrnost nevyřeší, když oba body leží na téže straně osy a osu nic nedrží (stáhne osu do bodu a ohlásí neúspěch, nebo tím „splní" i vazby, které si odporují). S osou drženou vazbami nebo s body nakreslenými zhruba souměrně problém není; v aplikaci se osa obvykle kreslí jako konstrukční úsečka z počátku.
- Přidání středu úsečky nebo souměrnosti dá platné řešení, ale tvar okolní geometrie nemusí zachovat (úsečka se může natáhnout nebo pootočit). Je to vlastnost solveru: hledá nejbližší řešení ve svých proměnných, ne nejmenší změnu tvaru.
- Souměrnou dvojici splynulou na ose rozestoupí kóta nebo tažení jednoho z bodů; samotné odebrání vazby, která ji stáhla, ji nechá na místě.

## D35 Rozšíření pro robotický kloub

Rozsah, návrh provedení i upřesnění scénáře 9 odsouhlasil vlastník projektu 2026-11-14. Implementace nezačala. Tvary typů níže jsou návrh, který se při implementaci může upřesnit; rozhodnutá jsou pravidla v textu. Návrh pak prošel dvěma nezávislými revizemi a spikem ozubení; co se podle nich změnilo, je v částech Revize návrhu a Spike ozubení na konci. Opravy podle revize i rozhodnutí po ní vlastník potvrdil týž den.

**Podnět.** Ukázkový díl: planetová převodovka s převodem 4 až 6 jako robotický kloub. Uvnitř je celý motor Eaglepower LA8308, za motorem se montuje řídicí jednotka MKS XDrive Mini. Rozměry dílů nese validační scénář 9; podklady, ze kterých pocházejí, jsou v adresáři `robot-joint-parts-schemas/` (není v repozitáři). Rozbor ukázal, že takový díl dnes nejde rozumně udělat v aplikaci ani přes MCP: skica zná jen úsečku, kružnici a oblouk, takže do ní nejde dostat ozubení, a chybí opakování, parametry a práce s více díly.

**Posun zadání.** Parametry s výrazy a vysunutí „skrz vše" byly budoucí funkce mimo PoC; teď do PoC patří. Cílem už není jen ověřit architekturu, ale dojít k vytištěnému kloubu (requirements.md, Cíl).

**Zásady výběru.** U každého bodu platí levná varianta. Kde malé rozšíření dá obecnější nástroj, má přednost. Levná varianta nemá zavřít cestu k plné: tvar dokumentu se volí tak, aby se plná varianta dala přidat bez jeho změny.

**Rozsah.** Číslování je pořadí implementace. Parametry jsou první, protože jimi začíná scénář 9; pole přichází až po rozsahu a ozubení, aby umělo opakovat všechny druhy nástrojů.

| # | Funkce | Varianta (rozhodnuto) | Odloženo; návrh to nemá znemožnit |
|---|---|---|---|
| 1 | Parametry a výrazy | Tabulka parametrů v dokumentu; výraz jde dát do každého číselného pole, které uvádí katalog číselných polí. Kontroly: výrazy, které mají platit | Jména referenčních kót ve výrazech |
| 2 | Rozsah vysunutí | Rozsah je varianta: vzdálenost s posunem začátku od roviny skici, nebo „skrz vše" (dopředu, dozadu, oběma směry). Výřez smí mít víc cílových těles | „Po stěnu"; revolve, zkosení a zkrut (kloub se bez nich obejde skládáním vysunutí) |
| 3 | Ozubení | Katalog generátorů profilu pro vysunutí; první položka je ozubení nad kružnicí skici. Vnější, nebo vnitřní ozubení se zadává výslovně | Generovaný blok uvnitř skici: zasahuje do solveru, detekce profilů i pojmenování stěn. Posunutí profilu |
| 4 | Pole | Feature „pole" jako seznam transformací; první druh je kruhové pole kolem osy. Opakuje seznam features, nebo hotové těleso | Posuvné pole a zrcadlení (další druhy transformací). Pole uvnitř skici: kopie by musely být entity solveru svázané vazbami |
| 5 | Více dílů | Export STL po tělesech; dotazy nad tělesy: kolize dvojic, objem a obálka | Sestava s vazbami mezi díly a pohybem: druhý constraint solver, tentokrát prostorový; největší nafouknutí projektu ze všech zvažovaných věcí. Řez modelem v pohledu |
| 6 | Vazby | Stejný poloměr, pevný bod | Úhlová poloha bodu na kružnici (jde složit z konstrukční úsečky a úhlu) |
| 7 | Nástroje skici | Sdílený modul nástrojů (dávky příkazů) pro aplikaci i MCP; nový nástroj je pravidelný mnohoúhelník | Mnohoúhelník jako nová entita skici |

**Proč ne sestava.** Kloub má sedm tištěných dílů, ale ty sdílejí rozměry (osová vzdálenost kol, rozteč šroubů motoru). Více těles v jednom dokumentu, která se o sebe opírají promítnutím hran, je pro to výhodnější než díly kreslené zvlášť a skládané vazbami. Ze sestavy kloub potřebuje jen opakované použití dílu (satelit třikrát), a to pokryje pole těles.

**Co se nedělá vůbec:** import souborů (importovaná síť nemá pojmenované stěny, nešlo by na ni kreslit ani ji promítat; STEP bez výměny jádra nejde; motor a řídicí jednotka se modelují ručně jako zjednodušená tělesa) a zaoblení a zkosení hran (na síti obtížné, pro funkci kloubu nepodstatné).

### Návrh provedení

**0. Úvodní krok: rozdělení vysunutí a verze schématu.** Bez změny chování, připravuje body 2 až 4.

- Krok vysunutí se rozdělí na tři části: profil (rovinné smyčky, u každé hrany křivka, ze které vznikla), nástroj (síť a nové stěny) a použití (nové těleso, nebo booleovská operace s cílem). Dnes je to jedna metoda a nástroj po ní zanikne.
- Do stavu přepočtu se uloží recept nástroje: profil s rovinnou triangulací, rovina skici a rozsah. Síť nástroje se z něj staví pro každé použití zvlášť, tedy i pro každou kopii v poli. Hotovou síť uložit nestačí: nástroj „skrz vše" musí mít délku podle cíle v místě a směru každé kopie (viz bod 2). Recept je rozhraní („postav nástroj pro tuto transformaci a tyto cíle"), ne data hranolu; revolve, zkosený nebo zkroucený hranol jsou později jen jiné stavby nástroje.
- Stavba hranolu dostane interval podél normály roviny skici místo jedné vzdálenosti. „Skrz vše" na obě strany a nástroj, který začíná mimo rovinu skici, jinak postavit nejde.
- Feature vysunutí dostane zdroj profilu a rozsah jako varianty:

  ```ts
  interface ExtrudeFeature extends FeatureBase {
    type: 'extrude';
    profile: ProfileSource;
    extent: Extent;
    operation: 'new' | 'add' | 'cut';
    targets?: Id[];   // add: právě jedno těleso; cut: jedno nebo víc (bod 2)
  }
  type ProfileSource =
    | { type: 'regions'; sketch: Id; regions: RegionRef[] }
    | {                                   // bod 3
        type: 'generated';
        generator: string;                // položka katalogu generátorů, například 'involuteGear'
        sketch: Id;
        operands: Record<string, Id>;     // entity skici, které generátor potřebuje (roztečná kružnice)
        params: Record<string, number | boolean>;
        refs?: Record<string, Id>;        // odkazy na jiné features (kolo „v záběru s")
      };
  type Extent =
    | { type: 'distance'; start: number; distance: number }            // start: posun začátku od roviny skici
    | { type: 'throughAll'; side: 'forward' | 'backward' | 'both' };   // bod 2
  ```

- **Registr typů features.** Typ feature je položka registru: validace, odkazy na jiné features, krok přepočtu, číselná pole a tělesa, která vytváří. Dnes se engine podle typu větví na dvanácti místech; nový typ (pole a další později) je pak jedna položka.
- **Obecný příkaz `updateFeature`** (`{ id, patch }`) nahrazuje `updatePlane` a `updateExtrude`. Je to slučovací změna: vnořený objekt se stejnou variantou se slučuje po polích (pole, která změna neuvádí, zůstávají včetně svých výrazů), jiná varianta dosavadní nahradí, seznamy se nahrazují celé a `null` odebírá nepovinné pole. Změna na nové těleso odebere cíle sama. Znovu se ověřují jen odkazy, které změna mění, jako dnes; jinak by oprava jedné rozbité reference narazila na jinou. Typ a ID měnit nejde. Příkazy skici včetně `setSketchPlane` zůstávají. Nový typ feature tak nepotřebuje vlastní příkaz ani vlastní popis pro MCP.
- **Tělesa a jejich ID.** Feature může vytvořit víc těles. Těleso má buď ID feature (vysunutí s operací `new`), nebo `<feature>/<místní jméno>` (kopie v poli). O tom, která tělesa feature vytváří, rozhoduje jedna funkce registru; validace odkazů na ni spoléhá a nezná výjimky pro jednotlivé typy. Rozdělení, zrcadlení nebo spojení těles pak přibudou jako nové typy bez zásahu do validace.
- Verze schématu se zvedne na 2. Dokument verze 1 se při načtení převede (vzdálenost na rozsah s nulovým začátkem, skica a oblasti na zdroj profilu, cíl na seznam cílů, prázdná tabulka parametrů a kontrol); ukládá se vždy verze 2. Zvednutí je potřeba, protože se mění tvar vysunutí a starší kód má nový dokument odmítnout srozumitelně.

  **Stav: provedeno 2026-11-14.** Chování stávajících dokumentů se nezměnilo (dokument verze 1 dává po převodu bitově stejný model). Jak provedení návrh upřesnilo a co z něj zůstává na další body:

  - Registr (`FEATURE_TYPES` v `document.ts`) drží validaci, odkazy s cestou ve feature, tělesa, pojmenování stěn a pole pro `updateFeature`. Krok přepočtu je větev úplného `switch` v `evaluate.ts`; chybějící větev nebo položku registru odmítne překladač. Číselná pole přidá bod 1.
  - Recept nástroje je `ToolRecipe { operation, targets, build(firstFaceId) }`. Transformaci dostane `build` s bodem 4, cíle jako argument s bodem 2. Recept zatím nikdo nečte.
  - Posun začátku rozsahu (`extent.start`) engine už počítá, protože interval stavba hranolu dostala tak jako tak; pole v UI přidá bod 2.
  - `targets` smí mít zatím právě jedno těleso i u výřezu (víc bod 2).
  - `parameters` a `checks` jsou ve schématu verze 2, ale musí být prázdné; dokument, který je má, engine odmítne, aby je tiše nezahodil (bod 1).
  - `updateFeature` ověřuje odkazy, které feature dosud neměla (porovnává místo, druh a ID). Proti `updateExtrude` je to mírnější ve dvou případech: změna, která rozbitý odkaz jen zopakuje, projde (formulář aplikace posílá vysunutí celé, takže dřív nešla v UI změnit vzdálenost u vysunutí se smazanou skicou), a změna operace bez cílů cíl znovu neověřuje. Nový rozbitý stav tím vzniknout nemůže. Pravidlo platí i pro víc cílů v bodě 2: oprava jednoho cíle nenarazí na druhý.
  - Změna s polem, které výsledná feature nemá, a půlka odkazu (objekt bez `kind`) jsou neplatné příkazy; pole s hodnotou `undefined` se přeskočí. Vzešlo z revize: překlep jinak končil úspěchem bez účinku a půlka odkazu vybrala jinou stěnu.
  - Popis API pro AI (`describe_api`) vypisuje typy features z registru včetně polí, která mění `updateFeature`.

  Na co musí navázat další body (z nezávislé revize kroku 0):

  - Bod 3: slučování pozná variantu a odkaz podle obsahu změny (`type`, `kind`), ne podle schématu. Slovníky generátoru (`params`, `operands`, `refs`) a pravidla „jiný generátor nahrazuje" a „`null` v parametrech vrací výchozí hodnotu" potřebují v registru popis cest (varianta, odkaz, slovník).
  - Bod 1: zápis po přepočtu umí jen vyřešenou skicu (`WriteBack` v `engine.ts`); hodnoty výrazů potřebují totéž pro ostatní features.
  - Bod 4: `FeatureTypeInfo.bodies` nemá hodnotu pro odvozená tělesa, aplikace na pěti místech bere ID tělesa jako ID feature (`app.ts`: skrývání a názvy těles) a recept při každé stavbě znovu trianguluje profil, tedy u pole pro každou kopii.

**1. Parametry a výrazy.**

- **Tabulka.** Dokument dostane seřazenou tabulku parametrů (jméno, výraz). Pořadí je jen pro zobrazení; parametr se může odkazovat na kterýkoli jiný, cyklus je chyba. U příkazů pro parametry a kontroly je neplatným příkazem jen syntaktická chyba a nepřípustné jméno; neznámé jméno a cyklus se přijmou a stav je ve výsledku přepočtu, jinak by nešlo založit `Zr` dřív než `Zs`. Funkce se ve výrazu pozná podle závorky za jménem, takže parametr se smí jmenovat jako funkce a pozdější funkce nezneplatní starší dokument; vyhrazená jsou jen jména konstant.
- **Katalog číselných polí.** Po vzoru katalogu vazeb (D34) říká u každého číselného pole každé feature jeho jednotku (délka, úhel, počet) a pravidlo (libovolné, kladné, nenulové, celé číslo od dané hodnoty). Hodnoty kót jednotku a pravidlo v katalogu vazeb už mají. Katalogem se řídí validace, vyhodnocení výrazů a popis API pro aplikaci a MCP. Výraz tak jde dát do každého číselného pole včetně těch, která přibudou; nové pole je položka katalogu. V katalogu jsou jen řídicí vstupy: souřadnice a poloměry, které počítá solver, a hodnoty referenčních kót do něj nepatří. Katalog je statický popis podle typu feature, vazby a generátoru, ne jen výčet polí hotové feature: potřebuje ho popis pro MCP i formulář rozpracované feature. Katalog vazeb má pojmenované hodnoty místo jedné (kóta `value`, pevný bod `x` a `y`).
- **Rozsah pole.** Pole má minimum a maximum s příznakem otevřenosti, případně zákaz nuly, ne pojmenované pravidlo. Celé číslo se pozná s tolerancí 1e-9 (`0.3 / 0.1` není přesně 3). Počet kopií má horní mez, aby překlep ve výrazu nespustil milión booleanů.
- **Uložení.** Výrazy jsou v jedné mapě u feature, klíčem je adresa pole (`extent/distance`, `constraints/<id>/value`). Mapa smí obsahovat jen adresy existujících polí: smazání vazby a změna varianty ji čistí, referenční kóta výraz ztrácí a dokument s neznámou adresou je neplatný. Číslo vedle výrazu je poslední vyhodnocená hodnota. Zadání čísla výraz zruší. Číslo bez výrazu se chová jako dnes, takže stávající příkazy se nemění.
- **Výrazy:** čísla, `+ − * /`, zbytek po dělení `%`, závorky, jména parametrů, několik funkcí; v kontrolách navíc porovnání a logické spojky. Rovnost se porovnává s tolerancí. Parser vlastní, bez knihovny (D2: každá knihovna by se schvalovala zvlášť a rozsah je malý).
- **Vyhodnocení a cache.** Výraz se vyhodnotí ve smyčce přepočtu těsně před krokem feature: z feature vznikne feature s dosazenými čísly a krok počítá s ní. Dosazená feature se pamatuje podle původní feature a hodnot, které její výrazy daly, takže její identita se změní, jen když se změní některá hodnota. Cache kroků se nemění (klíčem je identita feature a předchozího stavu): změna parametru přepočítá model od první feature, která ho používá, do konce časové osy; začátek před ní se bere z cache a změna nepoužitého parametru nepřepočítá nic. Features za první změněnou se přepočítají, i když na ní nezávisí; graf závislostí je možná pozdější optimalizace, stejně jako dosud.
- **Příkaz s výrazem.** Příkaz, který nastavuje výraz, ho hned vyhodnotí proti tabulce parametrů a číslo doplní; číslo v příkazu je pak nepovinné. Výraz, který v té chvíli nejde vyhodnotit, je neplatný příkaz. Chybou feature se výraz stane až pozdější změnou (smazaný parametr, hodnota mimo pravidlo). Číslo v dokumentu je vždy poslední platná hodnota, takže dokument uložený s chybným výrazem jde načíst.
- **Zápis hodnot.** Poslední vyhodnocená hodnota se do dokumentu zapíše stejnou cestou jako vyřešené proměnné skici (zápis po přepočtu a převěšení cache).
- **Chyby.** Neznámé jméno, cyklus, neplatný výraz, nekonečná hodnota a hodnota mimo rozsah pole jsou chyba feature, která výraz používá; přepočet pokračuje a chyba jde opravit, stejně jako rozbitá reference. Necelé číslo u počtu je chyba, nezaokrouhluje se. Výjimkou je skica: chybný výraz kóty je u ní varování a skica se spočítá s poslední platnou hodnotou. Feature v chybě nemá rovinu ani vyřešenou skicu, takže by nešla otevřít a opravit a spadlo by vše, co z ní vychází; stejně se dnes chová promítnutí, které nejde vyhodnotit.
- **Úhly.** Úhel je v radiánech všude, v čísle i ve výrazu; `30` a `"30"` znamenají totéž. Stupně se píšou funkcí `deg(x)`, `pi` je konstanta a goniometrické funkce berou radiány. Aplikace převádí jen čísla: číslo ukazuje a přijímá ve stupních. Výraz zobrazuje a ukládá beze změny, v jednotkách enginu, a vedle něj ukáže výslednou hodnotu ve stupních; automatické obalování do `deg(...)` by tiše změnilo výraz vytvořený jinde (`pi / 2` z MCP by se stal 1,57°). Úhlová pole mají rozsahy v radiánech (úhel záběru mezi 0 a π/2, úhel pole nejvýš 2π), takže hodnota zadaná omylem ve stupních je neplatný příkaz, ne tichá chyba. Původní rozhodnutí (výraz ve stupních, číslo v radiánech) revize kontraktu označila za zdroj tichých chyb: `angle: 360` bylo 360 radiánů. Zamítnuto: volba jednotky nastavením (totéž číslo by znamenalo dvě věci podle příznaku jinde) a stupně na celé veřejné hranici (hodnota zadaná omylem v radiánech je malé číslo a rozsahem projde vždy).
- **Kontroly.** Dokument nese vedle parametrů seznam kontrol (jméno, výraz s porovnáním), například `modul * (Zs / 2 + 1) < 12.75` nebo `Zs % 3 == 0`. Vyhodnotí se při každém přepočtu; nesplněná kontrola je varování u dokumentu, model se počítá dál. Výsledek kontrol je součástí výsledku přepočtu, takže ho vidí aplikace i AI přes MCP. Jméno kontroly je volný text pro člověka, ne identifikátor. Porovnání má toleranci: `a == b`, když se liší nejvýš o 1e-9 · max(1, |a|, |b|); jen relativní tolerance by selhala u nuly. Důvod: podmínky, které plynou z konstrukce a po změně parametru je jinak nikdo nehlídá (u kloubu čtyři: hlavový poloměr centrálního kola, dělitelnost počtu zubů počtem satelitů, odstup sousedních satelitů, stěna u koruny).
- **Otevřené pro později.** Výraz se vyhodnocuje uvnitř přepočtu, ne při příkazu. Jména ve výrazu tak půjde rozšířit o hodnoty, které vznikají až přepočtem (referenční kóty dřívějších skic).

**2. Rozsah vysunutí.**

- **Začátek.** Rozsah se vzdáleností má posun začátku od roviny skici ve směru její normály (výchozí 0, smí být záporný); vzdálenost se měří od začátku. Jedna skica tak poslouží features v různých výškách: u kloubu vycházejí kola i čepy z jedné skici roztečných kružnic. Vysunutí na obě strany roviny je začátek `-t / 2` a vzdálenost `t`, zvláštní symetrický rozsah není potřeba. Víko `startCap` je víko na začátku; v rovině skici leží jen při nulovém posunu.
- **Víc cílů.** Výřez smí mít víc cílových těles (díra skrz dva sešroubované díly); přidání má právě jedno, jinak by tělesa splynula. Chybějící cíl je rozbitá reference. Výřez, který by některý cíl odebral celý, je chyba a nezmění žádný z cílů. Varování „bez účinku" vyjmenuje cíle, které výřez minul.
- „Skrz vše" je jen u výřezu a při víc cílech se bere rozsah všech cílů dohromady. Hloubka se při přepočtu určí z rozsahu cílového tělesa ve směru normály roviny skici (průmět vrcholů tělesa na normálu) a přidá se přesah, aby víko nástroje neleželo v rovině stěny tělesa.
- Strana: `forward` je ve směru normály roviny skici, `backward` proti ní, `both` na obě strany. U skici na stěně míří normála ven z tělesa, takže běžná díra je `backward`.
- Bere se rozsah celého tělesa, ne jen místa pod profilem.
- Délka se počítá při každém použití nástroje znovu, proti cíli ve stavu, ve kterém se nástroj používá, a ve směru, kterým nástroj právě míří. V poli tedy pro každou kopii zvlášť: po otočení kolem osy, která není rovnoběžná se směrem vysunutí, je těleso v novém směru jinak dlouhé, a mezi zdrojovým výřezem a polem mohl k tělesu přibýt materiál.
- Cíl, který leží celý na druhé straně roviny, se nezmění a varování „bez účinku" ho vyjmenuje. Přesah nástroje se odvozuje z rozměru cílů a musí být zřetelně nad rozlišením adaptéru jádra, jinak by ho adaptér vzal jako lícování.
- „Po stěnu" bude další varianta téhož pole; zatím se nedělá.

**3. Ozubené kolo.** Generátor profilu pro vysunutí. Operaci, cíl a rozsah má od vysunutí, takže ozubení dostává „skrz vše", pole i budoucí rozsahy bez další práce.

- **Katalog generátorů.** Po vzoru katalogu vazeb: položka říká, které entity skici generátor potřebuje (operandy podle druhu entity), jaké má parametry (číselná pole s jednotkou a pravidlem, příznaky), na které features se smí odkazovat a jak pojmenuje boční stěny. K ní patří čistá funkce, která z vyřešených operandů a parametrů vrátí rovinné smyčky a případná varování. Validace, výrazy v parametrech, popis pro aplikaci a MCP se řídí katalogem. Ozubení je první položka (`involuteGear`: operand `circle`, parametry `teeth`, `pressureAngle`, `backlash`, `rotation`, `internal`, odkaz `meshWith`). Cykloidní kotouč, řemenice, řetězové kolo nebo text jsou později další položky beze změny tvaru dokumentu; parametr generátoru proto smí být i volba z výčtu nebo text. Generátor zveřejňuje údaje o profilu (u ozubení modul, roztečný, hlavový a patní průměr, použité natočení): čte je generátor, který se na něj odkazuje, a jsou ve výsledku feature, aby jimi AI ověřila, co postavila.

- Generátor je čistá funkce parametrů, která vrací rovinné smyčky. Odkazuje na skicu a její kružnici, která je roztečnou kružnicí; parametry jsou počet zubů, úhel záběru (výchozí 20°), vůle, natočení a příznak vnitřního ozubení. Modul se nezadává, plyne z průměru kružnice a počtu zubů.
- Vnější, nebo vnitřní ozubení se zadává výslovně, neodvozuje se z operace. Vnější profil je tvar kola; vnitřní profil je tvar, který se vyřízne z tělesa, aby vzniklo korunové kolo. Výřez vnějším profilem dá drážkované spojení (otvor, do kterého kolo zapadne).
- Roztečná kružnice smí být konstrukční a generátor nezávisí na platnosti profilu skici: čte jen vyřešený střed a poloměr kružnice. Roztečné kružnice kol v záběru se dotýkají, a dotyk dvou běžných křivek mimo spojený bod profil skici zneplatní (D28). Ve skice kol proto mají být konstrukční; pak ve stejné skice mohou být i běžné oblasti (díra pro čep).
- Rozměry profilu (potvrzené spikem): hlavová kružnice `r + m`, patní `r − 1,25 m`; u vnitřního profilu sahá nástroj od hlavové kružnice koruny `r − m` k její patní `r + 1,25 m`. Bok je evolventa od základní kružnice; pod ní pokračuje radiální úsečkou, bez přechodového zaoblení.
- Vůle je úbytek tloušťky zubu jednoho kola na roztečné kružnici, v milimetrech po oblouku. Vnější zub je o ni tenčí; u vnitřního profilu je o ni širší zubová mezera koruny (nástroj je tlustší). Dvojice kol s vůlemi `b1` a `b2` má na každé straně zubu normálovou mezeru `(b1 + b2) / 2 · cos α`.
- Vnitřní profil se vyřezává do plného materiálu, nebo do díry zřetelně menší, než je hlavová kružnice koruny. Nástroj je uzavřený tvar, vyřízne středový otvor i zubové mezery naráz. Díra přesně na hlavové kružnici by dala shodné válcové plochy nástroje a tělesa, které adaptér jádra neřeší; ve spiku po ní zůstaly zbytky stěny díry.
- Záběr hlídá skica: roztečné kružnice dvou kol v záběru jsou tečné, osovou vzdálenost tak drží stávající vazba tečnosti.
- Natočení zubů má dvě cesty. Základ je číslo (výchozí 0); první kolo v řetězu jinou možnost nemá. Volitelně kolo nese odkaz „v záběru s" na jiné ozubené kolo: natočení se pak dopočítá tak, aby na spojnici středů ležel zub jednoho kola proti mezeře druhého, a zadané číslo se nepoužije. Platí pro dvojici vnějších kol i pro vnější kolo s vnitřním. Pro tisk na natočení nezáleží; potřebuje ho kontrola kolizí a pohled na model.
- Odkaz „v záběru s" smí vést jen na dřívější vysunutí s profilem ozubení. Kola v záběru musí mít stejný modul a úhel záběru a tečné roztečné kružnice (vnější dvojice zvenku, vnější s vnitřním zevnitř); tečnost sama stejný modul nezaručí. Když odkazované kolo chybí, je v chybě nebo některá podmínka neplatí, je to varování a použije se zadané číslo natočení.
- Vzorec natočení (potvrzený spikem). Fáze kola ve směru `β` od jeho středu je zlomková část `(β − natočení) · z / 2π`; nula znamená, že tím směrem míří osa zubu. U vnější dvojice dávají fáze obou kol v roztečném bodě dohromady 1/2. U vnitřního záběru leží roztečný bod od obou středů stejným směrem a fáze satelitu se rovná fázi zubové mezery koruny.
- Evolventa se nahrazuje lomenou čarou podle `chordTolerance`, stejně jako oblouky. Lomená čára vnějšího kola leží uvnitř přesného tvaru. U vnitřního profilu musí ležet vně přesného tvaru nástroje (tečny místo tětiv, nebo odsazení o toleranci): tětivy by zuby koruny ztlustily až o toleranci a kola s nulovou vůlí by se prolínala (ve spiku 0,006 mm, 0,012 mm³).
- Stěny: obě víka jako u vysunutí a jedna logická boční stěna pro celé ozubení, pojmenovaná podle katalogu generátoru (`teeth`), ne podle roztečné kružnice; výměna kružnice ji tak nepřejmenuje. Popis stěny dostane třetí druh vedle roviny a válce (obecná plocha rovnoběžná s osou vysunutí); není rovinná, nejde na ni kreslit a její hrany nejdou promítnout.
- Omezení první verze: bez posunutí profilu. Hranice 17 zubů platí pro kola vyráběná odvalováním, kde nástroj patu podřízne; generovaný profil podříznutý není. U malého počtu zubů jde o to, jestli hlava protikola narazí do paty pod základní kružnicí. Podmínka pro dvojici se středy ve vzdálenosti `a` používá mez `√(rb² + (a · sin α)²)`, kde `rb` je základní poloměr kola, jehož hlava se posuzuje. U vnější dvojice nesmí hlavový poloměr žádného z obou kol mez přesáhnout; ověřují se obě kola, protože u dvojice 12/24 naráží hlava většího kola do paty menšího, ne naopak. U vnitřního záběru je nerovnost pro korunu obrácená: její hlavová kružnice (`r − m`, zuby míří dovnitř) nesmí být menší než mez; stejná nerovnost jako u vnějšího kola by dala falešné varování už u sestavy 18/27/72. Při odkazu „v záběru s" feature podmínku ověří a při porušení dá varování. Jiné druhy kolize vnitřního záběru (malý rozdíl počtu zubů) podmínka nepokrývá; zachytí je kontrola kolizí. Ve spiku dvojice 15/30 zabírá bez průniku, 12/24 a 10/20 se prolínají; výpočet podmínky dává totéž a u všech tří sestav scénáře 9 je splněná. Posunutí profilu je později další parametr generátoru.
- Otevřené pro později: plná varianta (ozubení jako blok ve skice) zavolá tentýž generátor a výsledek vloží do skici jako odvozenou geometrii.

**4. Pole.** Feature, která zdroj opakuje podle seznamu tuhých transformací. Druh transformace je varianta; první je kruhové pole. Posuvné pole a zrcadlení jsou později jen další druhy, zbytek feature se nemění.

```ts
interface PatternFeature extends FeatureBase {
  type: 'pattern';
  source: { type: 'features'; features: Id[] } | { type: 'body'; body: Id };
  transform: { type: 'circular'; axis: AxisRef; count: number; span: { type: 'full' } | { type: 'angle'; angle: number } };
}
type AxisRef =
  | { kind: 'base'; axis: 'X' | 'Y' | 'Z' }
  | { kind: 'sketchPoint'; sketch: Id; point: Id };   // normála roviny skici vedená bodem skici
```

- **Osa** je typ odkazu jako rovina. Později k němu přibude přímá hrana a osa válcové stěny; poslouží i pro revolve.
- **Počet a rozsah.** Počet zahrnuje originál. Rozsah je výslovná volba: plný kruh (krok 2π děleno počtem), nebo úhel mezi první a poslední kopií (krok úhel děleno počtem bez jedné). Původní pravidlo „při plném kruhu" bylo nespojité: počet 4 s úhlem 360° dával krok 90°, s úhlem 359,999° krok 120°.
- **Zdroj features** (vysunutí s operací `add` nebo `cut`, tedy i ozubení): pro každou kopii se z receptu každé zdrojové feature postaví otočený nástroj a použije se v pořadí seznamu na cílech té feature. Zdrojové features nemusí mít společné cíle. Seznam dovoluje opakovat díru i s jejím zapuštěním.
- **Pravidla.** Počet je celé číslo od 1; jednička znamená jen originál. Zdroj, který chybí, je potlačený nebo v chybě, dává chybu pole (rozbitá reference). Zdroj, který skončil varováním „bez účinku", je platný: jeho nástroj se opakuje, protože otočená kopie cíl zasáhnout může. Pole je nedělitelné: když selže kterákoli kopie, je v chybě celé pole a model zůstane ve stavu před ním. Kopie bez účinku je varování.
- **Zdroj těleso:** těleso ve stavu před polem se zkopíruje jako nová tělesa. Je potřeba pro díl složený z více features (satelit je ozubené kolo a díra pro čep). Opakování jednotlivých features by u každé kopie muselo přesměrovat cíl výřezu na odpovídající kopii tělesa.
- **ID kopií těles** je `<pole>/<číslo>`, číslo od 1; je to případ obecného pravidla `<feature>/<místní jméno>` z kroku 0. Lomítko je v ID zadávaných uživatelem zakázané, takže odvozené ID s jiným ID nekoliduje (stejně jsou pojmenované konce promítnutých hran).
- **Kopie jsou plnohodnotná tělesa.** Jde na ně kreslit, řezat do nich a promítat jejich hrany. Validace odkazu přeloží `<pole>/<číslo>` na feature pole, která musí ležet před odkazující feature. Jestli kopie s tím číslem existuje, se ukáže až při přepočtu (počet může být výraz); když ne, je to rozbitá reference.
- **Jména stěn kopií.** Jméno stěny dostane volitelný údaj o kopii (pole a číslo kopie; u pole z pole seznam) na konci zápisu jména. Stěny originálu a všechna dosavadní jména se nemění. Analytický popis stěny se otočí s kopií.
- Obě cesty sdílejí osu, otočení sítě i pojmenování kopií; liší se jen posledním krokem (boolean s cílem, nebo nové těleso).
- Omezení: kopie jsou tuhá otočení. Kopie satelitu zůstanou v záběru, jen když jsou počty zubů centrálního i korunového kola dělitelné počtem satelitů. Obecná podmínka smontovatelnosti (součet obou počtů dělitelný počtem satelitů) je slabší a vyžadovala by každou kopii pootočit kolem vlastní osy; seznam transformací to později dovolí.

**5. Export po tělesech a dotazy nad tělesy.**

- `exportMesh` dostane volitelný seznam těles (dnes exportuje vždy celý model).
- Kontrola kolizí je dotaz enginu nad vybranými tělesy nebo nad všemi: vrací dvojice s objemem průniku nad prahem. Operaci `intersection` port jádra už má; záruku pro lícující stěny u ní adaptér neplní, ve spiku ale lícující víka, čep v díře i shodné válce daly objem přesně nula. Práh je 0,001 mm³: šum vyšel nulový, kola se zápornou vůlí 0,05 mm dala 0,5 až 1,7 mm³. Průnik může v adaptéru selhat (výsledek se čistí a kontroluje); dotaz proto vrací vedle prolínajících se dvojic i dvojice, které se nepodařilo spočítat. Text záruky portu jádra se s tím upraví: průnik engine nově používá.
- Objem a obálka tělesa jsou součástí popisu tělesa; AI jimi ověřuje, co postavila.
- V aplikaci tlačítko, které vypíše kolidující dvojice; v MCP nástroj.
- Otevřené pro později: sestava by stála nad tělesy dokumentu a odkazovala se na jejich ID. Proto mají kopie těles stabilní odvozená ID.

**6. Vazby.** Stejný poloměr a pevný bod se přidávají podle D34 (typ, katalog, rovnice rozboru, překlad pro solver).

- Stejný poloměr: planegcs má vazby `equal_radius_cc`, `equal_radius_ca` a `equal_radius_aa` (nalezeno v typech knihovny 1.3.0, nespuštěno).
- Pevný bod je vazba se souřadnicemi: `{ type: 'fixed'; point: Id; x: number; y: number }`. V rozboru volnosti jsou to dvě rovnice nad běžným proměnným bodem (`x − x0 = 0`, `y − y0 = 0`), pro solver se překládá na `coordinate_x` a `coordinate_y` (planegcs je má). Diagnostika, vysvětlení nadbytečných vazeb i konflikt s kótou tak fungují jako u ostatních vazeb.
- Souřadnice jsou číselná pole katalogu, mohou tedy být výraz a pevný bod se může hýbat s parametry. Příkaz bez souřadnic doplní současnou polohu bodu.
- Katalog vazeb dnes počítá s jednou hodnotou na vazbu; dvě hodnoty jsou jeho rozšíření.
- Zamítnuto: seznam pevných entit, který solver dostává pro počátek a promítnutou geometrii (první návrh). Bod z tohoto seznamu rozbor volnosti vynechává z proměnných, takže vazba na něm by neměla žádnou rovnici a diagnostika by ji neuměla vysvětlit ani ohlásit konflikt s kótou. Seznam zůstává jen pro počátek a promítnutou geometrii.

**7. Nástroje skici.** Sdílený modul čistých funkcí, které z několika údajů složí dávku příkazů. Aplikace je volá ze svých nástrojů, MCP je nabízí jako nástroj s popisem generovaným ze seznamu funkcí. Engine se nemění. AI tak neskládá desítky příkazů podle textového receptu a každý další nástroj je hned na obou místech. Do modulu se přesune stávající obdélník; nový je pravidelný mnohoúhelník. Kde modul leží (balíček enginu, nebo vlastní), se určí při implementaci.

- Mnohoúhelník: konstrukční opsaná kružnice, vrcholy na ní (`pointOnCurve`) a shodné délky stran.
- Zbývající volnost jsou čtyři stupně: střed, velikost, natočení.
- Velikost se kótuje průměrem opsané kružnice, nebo u sudého počtu stran rozměrem přes plochy (kóta bod–úsečka mezi vrcholem a protější stranou), což je u matice rozměr klíče.
- Zvažováno: vepsaná kružnice s tečnými stranami (její průměr by byl přímo rozměr přes plochy). Zamítnuto: tečný mnohoúhelník se shodnými stranami nemusí být pravidelný (kosočtverec).
- Zapuštění matice je pak šestiúhelník a výřez do hloubky; nic dalšího nepotřebuje.

### Co potvrdil vlastník projektu

Při prvním návrhu 2026-11-14 tři body, které návrh nechával otevřené:

- **Natočení zubů** jde zadat číslem i odkazem „v záběru s". Číslo je základ, který první kolo v řetězu potřebuje vždy; odkaz je volitelná nadstavba. Bez odkazu by kontrola kolizí u kol v záběru hlásila průnik, dokud by uživatel natočení nedopočítal ručně.
- **Pole** opakuje features i hotové těleso. Samotné opakování features nestačí na díl složený z více features (satelit s dírou pro čep); samotné pole těles nepokryje díry na roztečné kružnici.
- **Úhel ve výrazu** se píše ve stupních, engine dál počítá v radiánech. (Změněno po revizi kontraktu: radiány všude a funkce `deg()`, viz bod 1.)

Po revizi návrhu téhož dne:

- Zobecnění všech sedmi funkcí (sloupec „Varianta" v tabulce rozsahu) a zásadu, že levná varianta nemá zavřít cestu k plné.
- Rozhodnutí, která se dělají před implementací: vyhodnocení výrazů a cache, necelý počet jako chyba, jména a ID kopií, počet včetně originálu, verze schématu 2 s převodem, úvodní rozdělení vysunutí a pořadí implementace.
- Upřesnění scénáře 9 v další části.

Po dvou revizích a spiku ozubení téhož dne:

- Všechny opravy z části Revize návrhu.
- Čtyři rozhodnutí z části Rozhodnutí po revizi: dva milníky, převod 6 jako akceptační případ, pevný bod jako vazba se souřadnicemi a kopie těles jako plnohodnotná tělesa.

Po rozboru obecnosti téhož dne (kloub je ukázkový příklad postupu, ne dodávka; rozšíření mají sloužit i jiným konstrukcím) sedm zobecnění, která jdou do tvaru dokumentu nebo příkazů a později by znamenala jeho změnu:

| Zobecnění | Kde | Proč teď |
|---|---|---|
| Katalog generátorů profilu místo pevné varianty ozubení | bod 3 | Další profily (cykloida, řemenice, text) bez změny schématu |
| Posun začátku rozsahu vysunutí | bod 2 | Jedna skica pro features v různých výškách; potřebuje to sám kloub. Pokrývá i symetrické vysunutí |
| Recept nástroje jako rozhraní | krok 0 | Revolve, zkosení a zkrut později jako jiné stavby nástroje |
| Feature může vytvořit víc těles, obecné ID `<feature>/<místní jméno>` | krok 0, bod 4 | Rozdělení, zrcadlení a spojení těles bez výjimek ve validaci |
| Registr typů features a obecný příkaz `updateFeature` | krok 0 | Nový typ je jedna položka; tvar vysunutí se mění a přibývá pole, psalo by se to znovu |
| Kontroly v tabulce parametrů | bod 1 | Konstrukční podmínky, které po změně parametru jinak nikdo nehlídá; parser výrazů vzniká teď |
| Výřez do více těles | bod 2 | Šroubovaný spoj prochází dvěma díly; tvar vysunutí se mění teď |

Co se odložilo a proč to architekturu nezamyká, je v pracovním souboru [backlog.md](backlog.md).

### Návrh kontraktu

V adresáři [d35-contract](d35-contract/README.md) je návrh kontraktu jako typy, které projdou typovou kontrolou, scénář 9 zapsaný jako příkazy proti nim a tabulky toho, co potřebuje GUI a co přibude v MCP. Je to výchozí bod pro implementaci, ne zmrazené rozhraní.

Návrh prošel 2026-11-14 nezávislou revizí (jiná instance modelu bez znalosti předchozí práce), která ho porovnala s kódem, spustila testy a spike a přepočítala geometrii scénáře. Implementaci neblokoval žádný nález, čtrnáct doporučila opravit předem. Vlastník projektu přijal všechny nálezy a potvrdil rozhodnutí v README návrhu (dvaadvacet: třináct z psaní kontraktu, devět po revizi). Do textu výše se z nich promítly ty, které mění dřívější rozhodnutí:

| Změna | Kde |
|---|---|
| Úhly v radiánech všude, stupně funkcí `deg()`, úhlová pole s rozsahy | bod 1, Úhly |
| `updateFeature` je slučovací změna a ověřuje jen měněné odkazy | krok 0 |
| Chybný výraz kóty je u skici varování a skica se spočítá s poslední platnou hodnotou | bod 1, Chyby |
| Kruhové pole má výslovný rozsah: plný kruh, nebo úhel | bod 4 |
| Rozsahy číselných polí, statický katalog polí, pojmenované hodnoty vazeb | bod 1 |
| Boční stěna ozubení se jmenuje podle katalogu generátoru | bod 3 |
| Kontrola kolizí hlásí i dvojice, které se nepodařilo spočítat | bod 5 |

Ostatní rozhodnutí, nálezy revize a poznámky pro implementaci jsou v README návrhu.

Po zapracování dodal vlastník další dvě revize od jiných modelů. Všech deset nálezů platilo a jsou zapracované: aplikace převádí mezi stupni a radiány jen čísla, jména exportovaných souborů jsou jednoznačná, jméno kontroly je volný text, porovnání má toleranci i u nuly, podmínka nárazu hlavy do paty se ověřuje pro obě kola a u koruny má obrácenou nerovnost, slučovací změna rozlišuje varianty a odkazy, a přibyly poznámky pro implementaci (zápis hodnot výrazů u všech typů features, odkaz na stěnu kopie, recept nástroje při varování, pevný bod v katalogu a solveru).

Po kroku 0 dodal vlastník třetí revizi (slabší model) a zadal projít [backlog.md](backlog.md) proti návrhu. Revize měla osm skupin nálezů a dvě doporučení; platí všechny kromě části druhého doporučení a několik jich návrh už řešil. Tvar dokumentu se nemění. Co se podle ní změnilo:

- Engine vyváží vstupní tvar feature (`featureInput`: výrazy dosazené zpět do polí). Formulář aplikace, který při úpravě posílá feature celou, z něj vychází; jinak by čísla v příkazu zrušila výrazy polí, která uživatel neměnil.
- `setConstraintValue` bez hodnoty výraz nemění; výraz zadaný referenční kótě je neplatný příkaz.
- Operandem generátoru smí být i promítnutá kružnice. Příkaz ověřuje operandy, které feature dosud neměla; operand smazaný později je při přepočtu rozbitá reference.
- Generátor může selhat (špičatý zub); vysunutí pak končí chybou `invalidProfile`. Parametr generátoru bez výchozí hodnoty je povinný.
- Generátor vrací oblasti (vnější smyčka a díry) jako profil skici, ne plochý seznam smyček; profil z více ostrovů (text) tak nepotřebuje jiný tvar.
- Tuhá transformace je matice a posun; při záporném determinantu se obrací pořadí vrcholů trojúhelníků. Zrcadlení tak později nepotřebuje jinou funkci.
- `get_sketch` nemá parametr `at`.

Rozbor backlogu nenašel funkci, kterou by návrh zamykal. Dal pět pravidel pro provedení bodů 1, 2 a 4 (cache dosazené feature podle hodnot, vyhrazená tečka ve výrazu, typ výsledku výrazu, použití nástroje nad receptem, seznam transformací pole) a dvě místa, kde bude pozdější práce větší, než backlog naznačuje (knihovna dílů, jména referenčních kót). Tabulky jsou v README návrhu, části Třetí kolo revize a Obecnost proti backlogu.

### Upřesnění scénáře 9

Vlastník projektu zadal vyřešit nejasnosti scénáře; řešení navrhl Claude a vlastník je potvrdil 2026-11-14.

| Nejasnost | Řešení | Důvod |
|---|---|---|
| Pouzdro mělo dno s dírami do statoru | Pouzdro je válec otevřený na straně motoru (vybrání pro motor, nad ním plný materiál pro korunu), dno je zadní deska (jeden díl s deskou pro řídicí jednotku) | Hlavová kružnice korunového kola je menší než motor, takže motor nejde vložit shora. Korunové kolo větší než motor by při převodu 4 a 5 chtělo centrální kolo, kolem kterého už nejdou zasunout šrouby do rotoru |
| Zapuštění matice bylo u díry M3, která vede do závitu rotoru | Matice jsou ve spoji pouzdra se zadní deskou: šest šroubů M3 skrz stěnu pouzdra, zapuštění na čele u korunového kola | Do závitu se matice nedává; spoj pouzdra s deskou po rozdělení pouzdra stejně vzniknout musí |
| Scénář neměl unašeč | Přidán unašeč se třemi čepy; ložisko výstupu scénář neřeší | Bez unašeče kloub nemá výstup. Čep přidaný k tělesu a zopakovaný polem navíc ověřuje pole s operací přidání |
| Chyběl otvor pro magnet enkodéru | Zadní deska má středový otvor průměru 20 mm | Enkodér řídicí jednotky čte magnet na hřídeli motoru |
| Pevný bod scénář nepoužíval | Levou trojici děr řídicí jednotky drží pevné body na souřadnicích z výkresu | Souřadnice z katalogového listu jsou typické použití pevného bodu, hlavně pro AI přes MCP |
| Modul nebyl zadaný | `modul = 0,9` | Šrouby M3 do rotoru (roztečná kružnice 31 mm, hlava 5,5 mm) se zasouvají podél ozubení centrálního kola; jeho hlavový poloměr musí být pod 12,75 mm. Při `Zs = 24` dává modul 1 poloměr 13 mm, modul 0,9 dává 11,7 mm |
| Satelit tečný k centrálnímu kolu mohl kolem něj obíhat | Střed satelitu leží na vodorovné přímce počátkem | Bez toho skica není plně určená |
| „Uvnitř je celý motor" nic neověřovalo | Motor je zjednodušené těleso a kontrola kolizí ho porovná s pouzdrem | S ručně modelovaným motorem D35 počítá |

Tři údaje z podkladů jsou nejisté a scénář na nich nestojí: strana středicího čepu motoru, konec hřídele na straně statoru (kam přijde magnet) a hloubka závitů.

### Revize návrhu (2026-11-14)

Dvě nezávislé revize dodané vlastníkem projektu. Tvrzení o kódu jsou ověřená proti zdrojům nebo spikem. Řešení navrhl Claude a vlastník je potvrdil týž den.

| Nález | Platí? | Řešení |
|---|---|---|
| Do trubky s vnitřním průměrem 92 mm nejde vyříznout koruna o průměru 63 mm, není tam materiál | Ano, scénář byl nepřesný | Pouzdro je plný válec s vybráním pro motor; koruna se řeže do plné části nad ním (scénář 9e) |
| „Skrz vše" a opakování uloženého nástroje: délka nástroje po otočení kolem obecné osy nebo po přidání materiálu nestačí | Ano | Ukládá se recept nástroje, délka se počítá pro každou kopii (kroky 0 a 2) |
| Slib „přepočítá se jen to, co na parametru závisí" neodpovídá cache | Ano | Opravena formulace: přepočet od první ovlivněné feature dál (bod 1) |
| Tečné roztečné kružnice zneplatní profil skici a vysunutí z ní skončí chybou | Ano, potvrzeno spikem | Roztečné kružnice jsou konstrukční, generátor na platnosti profilu nezávisí (bod 3, scénář 9a) |
| Ozubení nemá přesný kontrakt: význam vůle, hlava a pata, kontroly u „v záběru s" | Ano | Doplněno do bodu 3 |
| Nulový průnik při otáčení není důkaz správného profilu, projdou i příliš malé zuby | Ano | Spike měří i mezeru boků a tloušťku zubu; kontrolní případ s menšími zuby pozná |
| Spike má jít přes adaptér jádra, ne přímo přes Manifold | Ano | Spike používá `buildPrism` enginu a adaptér jádra |
| Vůle u vnitřního profilu má opačné znaménko, patní kružnice koruny je `m · (Zr + 2,5)` | Ano | Doplněno do bodu 3 a potvrzeno spikem |
| Koruna do díry přesně na hlavové kružnici naráží na shodné válcové plochy | Zčásti: chyba nenastala a objem sedí, ale zůstaly zbytky stěny díry | Koruna se řeže do plného materiálu (bod 3) |
| Pevný bod přes seznam pevných entit rozbije diagnostiku | Ano | Vazba se souřadnicemi (bod 6, rozhodnutí 3) |
| Stavba hranolu potřebuje interval místo jedné vzdálenosti | Ano | Krok 0 |
| ID kopií těles: validace odkazů zná jen těleso jako vysunutí s operací `new` | Ano | Kopie jsou plnohodnotná tělesa, validace odkaz přeloží na feature pole (bod 4, rozhodnutí 4) |
| Příkaz s výrazem a načtení dokumentu s chybným výrazem | Ano | Bod 1, Příkaz s výrazem |
| Výrazy nemají zahrnovat hodnoty počítané solverem a referenční kóty | Ano | Bod 1, katalog |
| Pole nemá pravidla pro počet, neplatný zdroj a selhání kopie | Ano | Bod 4, Pravidla |
| architecture.md tvrdí, že „skrz vše" je mimo PoC | Ano | Opraveno, architecture.md odkazuje na D35 |
| Scénář neověřuje převod 6 | Ano | Scénář 9i má změnu na 18/36/90 (rozhodnutí 2) |
| Scénář není sestavitelný mechanismus: chybí osové uspořádání, uložení unašeče a satelitů, uchycení magnetu, tiskové vůle | Ano | Dva milníky; scénář 9 má osové uspořádání, zbytek je druhý milník (rozhodnutí 1) |

Zbývá doplnit při implementaci bodu 1: přesný seznam funkcí ve výrazech a pravidla jmen a přejmenování parametrů.

### Spike ozubení (2026-11-14)

Skript `spikes/gear.spike.ts`, spuštění z kořene repozitáře: `npx vitest run --config spikes/vitest.config.ts`. Běží přes `buildPrism` enginu, adaptér jádra a solver planegcs. Modul 0,9, tolerance dělení 0,01 mm, tři sestavy: 18/27/72, 24/24/72 a 18/36/90.

| Otázka | Výsledek |
|---|---|
| Je profil evolventy správně? | Ano. Při otáčení v převodovém poměru přes jednu rozteč se vnější kola s nulovou vůlí neprolínají a mezera boků zůstává 0,000 až 0,006 mm, boky se tedy po celou dobu dotýkají. Kontrolní případ se zuby o 3 % menšími dá mezeru 0,23 mm. Tloušťka zubu na roztečné kružnici vychází o 0,000 až 0,008 mm menší než `π · m / 2 − vůle` (tětivy) |
| Odpovídá vůle definici? | Ano. Při vůli 0,05 a 0,1 mm na každém kole vychází normálová mezera 0,047 až 0,050 a 0,094 až 0,100 mm; výpočet `(b1 + b2) / 2 · cos α` dává 0,047 a 0,094 |
| Vnitřní profil | Tětivy nástroje ztlušťují zuby koruny: při nulové vůli průnik se satelitem 0,005 až 0,006 mm (0,011 až 0,012 mm³ při šířce 8 mm), při vůli 0,05 mm mezera 0,041 až 0,044 mm místo 0,047. Lomená čára vnitřního profilu proto musí ležet vně přesného tvaru |
| Vzorec natočení ze záběru | Platí pro vnější dvojici i pro satelit s korunou, ve všech třech sestavách. Tuhé kopie satelitu po 120° se s centrálním kolem ani s korunou neprolínají (objem 0) |
| Málo zubů | Dvojice 15/30 zabírá bez průniku i při nulové vůli; 12/24 se prolíná o 0,002 mm a 10/20 o 0,007 mm. Odpovídá podmínce nárazu hlavy do paty, ne hranici 17 zubů |
| Jádro: výřez koruny | 72 zubů do plného kotouče 75 až 180 ms, výsledek 2964 trojúhelníků; 90 zubů 73 až 138 ms, 3540 trojúhelníků. Žádná chyba jádra |
| Jádro: celé pouzdro | Válec, vybrání pro motor, koruna skrz vše, šest děr a šest zapuštění: 14 booleanů, každý 17 až 103 ms, dohromady asi 1 s, 4432 trojúhelníků. Centrální kolo (příruba, ozubení přidáním, čtyři díry): přidání ozubení 389 ms, díry 27 až 61 ms |
| Šum objemu průniku | Nulový: kola s vůlí 0,05 a 0,1 mm, lícující víka, čep v díře s vůlí i shodné válce dávají přesně 0 mm³. Záporná vůle 0,05 mm dá 0,46 až 1,75 mm³. Práh kontroly kolizí 0,001 mm³ |
| Zůstane tečnost vnější? | Ano. Po změně 18/27 → 24/24 → 18/27, po změně kol jednotlivě, po 18/36/90 i po skoku na průměry 2 a 60 mm leží střed satelitu ve vzdálenosti součtu poloměrů |
| Platnost profilu skici | Běžné tečné kružnice: profil neplatný. Konstrukční: profil platný, skica plně určená |

Co spike neověřoval: stejný poloměr a pevný bod v solveru, ozubení v obecně natočené rovině, čas přepočtu celého kloubu v enginu.

### Rozhodnutí po revizi

Čtyři otázky, které revize otevřela. Doporučení dal Claude, vlastník projektu je potvrdil 2026-11-14.

1. **Dva milníky.** První milník je scénář 9: model kloubu v editoru. Scénář dostal osové uspořádání (tloušťky a polohy dílů v ose), aby byl model geometricky úplný a kontrola kolizí měla smysl. Druhý milník je fyzický prototyp: uložení a osové zajištění unašeče a satelitů, držák magnetu a jeho vzdálenost od enkodéru, prostor pro desku a kabely, tiskové vůle. Práci na editoru neblokuje. Vlastník téhož dne upřesnil, že kloub je ukázkový příklad postupu, ne dodávka: druhý milník je proto volitelný, rozhodne se o něm po prvním a scénář 10 se doplní, jen pokud se bude dělat. Měření nejistých údajů na skutečném motoru tím zatím odpadá.
2. **Převod 6 je akceptační případ.** Scénář 9i má vedle změny 5 → 4 (stejná koruna) i změnu 5 → 6: `Zp` z 27 na 36, tedy 18/36/90. Koruna se zvětší na roztečný průměr 81 mm a vejde se do pouzdra; `Zs` i `Zr` jsou dělitelné třemi a centrální kolo má 18 zubů. Zvažováno: 15/30/75 s menší korunou; zamítnuto, protože 18 zubů je dál od hranice, kde hlava protikola naráží do paty, a změna koruny ověří i přepočet pouzdra.
3. **Pevný bod je vazba se souřadnicemi.** Podrobnosti a zamítnutá varianta jsou v návrhu provedení, bod 6.
4. **Kopie těles jsou plnohodnotná tělesa.** Podrobnosti jsou v návrhu provedení, bod 4. Scénář 9 to nepotřebuje, ale kopie, na které nejde navázat, by byly druhořadá tělesa.

Osové uspořádání scénáře 9 (nula na dosedací ploše statoru, kladný směr k rotoru) vychází z těchto úvah:

- Vybrání pro motor končí 1,5 mm nad čelem rotoru (28 mm), aby se rotor neotíral o plný materiál s korunou.
- Příruba centrálního kola má průměr 40 mm (náboj rotoru podle podkladů) a tloušťku 4 mm. Hlavy šroubů M3 na ní sahají do 33,5 mm; satelity proto začínají na 34 mm a ozubení centrálního kola je delší než satelity.
- Unašeč leží 0,5 mm nad čelem pouzdra a kol, čepy míří dolů do děr satelitů. Průměr kotouče 60 mm pokryje čepy i při převodu 6 (osová vzdálenost 24,3 mm).
- Sousední satelity se nepotkají v žádné ze tří sestav: nejmenší vzdálenost středů je 35,1 mm při hlavovém průměru 26,1 mm (převod 5), 37,4 a 23,4 mm (převod 4), 42,1 a 34,2 mm (převod 6).
- Stěna mezi patní kružnicí koruny a dírami pro šrouby pouzdra je i při převodu 6 silná 7,2 mm (patní poloměr 41,6 mm, díry na poloměru 50,5 mm).

Ověření: validační scénář 9.

## Spiky 2026-11-13

Obě knihovny předpoklady návrhu splnily, podrobné výsledky jsou v architecture.md. Tři nálezy změnily návrh:

- **D19 přepracováno.** Na šikmých stěnách nestačí posunout počáteční víko. Stejný problém mají boční stěny a koncové víko nástroje, pokud leží v rovině stěny tělesa. Řešení se přesunulo do adaptéru jádra, viz D19.
- **D20 uzavřeno.** Manifold pracuje jen s float32, `Solid` proto také.
- **D17 doplněno.** planegcs nezvládá referenční kóty spolehlivě, počítá je engine.

## Otevřené otázky

Žádné.

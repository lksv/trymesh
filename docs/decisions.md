# Rozhodnutí

Živý dokument. Zapisuje, co bylo rozhodnuto, proč a co se zvažovalo. Rozhodnutí nejsou neměnná; při změně se záznam přepíše a původní stav se uvede v poznámce.

Poslední úprava: 2026-11-15

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
| D35 | [Rozšíření pro robotický kloub](decisions/D35-robot-joint.md) | rozhodnuto včetně oprav po dvou revizích návrhu a po revizi kontraktu; spike ozubení proveden; all implemented: step 0 and points 1 to 7 | Sedm funkcí v levných variantách, které nezavírají cestu k plným: parametry a výrazy nad katalogem číselných polí, rozsah vysunutí jako varianta („skrz vše"), ozubení jako generátor profilu pro vysunutí, pole jako seznam transformací (features i těles), export po tělesech a dotazy nad tělesy, stejný poloměr a pevný bod, sdílené nástroje skici (mnohoúhelník). Plná sestava, pole ve skice, import a zaoblení se nedělají |
| D36 | [Order of work after D35](decisions/D36-order-after-d35.md) | decided 2026-11-14; the preparatory step (D37) is done; the plan is in [d36/README.md](d36/README.md) | Seven steps for the intended use (printed parts, mostly for a robotic arm, built with an AI through MCP): queries that let the AI see and measure, bracket and box, bought parts, shapes beyond prisms, mechanism, sketch, the rest. No assembly with mates, no 3D sketches with constraints, no fillets of general edges. Designs of the features are proposals in backlog.md |
| D37 | [Preparatory step of D36](d36/00-prep/design.md) | scope decided 2026-11-14, design 2026-11-15 after five rounds of reviews; implemented 2026-11-15, all six parts | Six parts that turn the places every package of D36 would write to into places where things are only added: a registry of queries with one general MCP tool `query`, a module per feature type, panels and forms of the app as modules, a shared vocabulary, documents by area, working in several trees. No change of behaviour. The design with its reviews is the record of the decision |

D1–D28 jsou odsouhlasené (D10–D28 dne 2026-11-13). D29, D30 a D31 vznikly při samostatné práci na implementaci a čekají na potvrzení. D32 až D35 jsou odsouhlasené 2026-11-14. D36 was approved on 2026-11-14 as well, and the scope of D37 with it. Podrobnosti jsou v [architecture.md](architecture.md) a v souborech `architecture/`, návrh UI v [ui.md](ui.md) a `ui/`.

## D1 Jazyk enginu: TypeScript

Rozhodnuto 2026-11-12. Engine běží v browseru i v Node. Výpočetně náročné části mohou být WASM knihovny (viz D2).

## D2 Knihovny třetích stran

Rozhodnuto 2026-11-12. Použití knihoven nevadí, ale každou vlastník projektu schvaluje výslovně. Každá knihovna je schovaná za úzkým rozhraním definovaným v enginu, aby šla vyměnit a aby šla napsat testovací implementace.

Schválené: planegcs (D6), Manifold (D8), `@modelcontextprotocol/sdk` pro MCP server (D33, schváleno 2026-11-14).

Approved on 2026-11-15: a DOM for the tests of the app in Vitest, `happy-dom` or `jsdom`, one of the two, as a development dependency of `packages/app`. It lets the class `App` and its panels be tested without a browser (part 3 of the preparatory step of D36, [d36/00-prep/part3-app-panels.md](d36/00-prep/part3-app-panels.md)). Which of the two is taken is decided by the first test written with it and recorded here. Only tests import it and nothing of it is shipped, so it has no interface of its own.

Taken on 2026-11-15: `happy-dom` 21.0.4. The first test (`packages/app/test/app.test.ts`) needs pointer events with capture, keyboard events, handlers set as properties (`onclick`, `oninput`, `onchange`) and the form controls of the app; all of them work in it, so `jsdom` was not tried. The test makes the window itself (`new Window()`) and does not use the test environment of Vitest, because the WASM adapters have to load as in Node before a `window` exists.

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

## Spiky 2026-11-13

Obě knihovny předpoklady návrhu splnily, podrobné výsledky jsou v architecture.md. Tři nálezy změnily návrh:

- **D19 přepracováno.** Na šikmých stěnách nestačí posunout počáteční víko. Stejný problém mají boční stěny a koncové víko nástroje, pokud leží v rovině stěny tělesa. Řešení se přesunulo do adaptéru jádra, viz D19.
- **D20 uzavřeno.** Manifold pracuje jen s float32, `Solid` proto také.
- **D17 doplněno.** planegcs nezvládá referenční kóty spolehlivě, počítá je engine.

## Otevřené otázky

Žádné.

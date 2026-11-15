# Požadavky

Živý dokument. Popisuje, co má PoC umět a co ne. Důvody jednotlivých voleb jsou v [decisions.md](decisions.md).

Poslední úprava: 2026-11-14

## Cíl

PoC jednoduchého parametrického 3D editoru ve stylu Autodesk Fusion. Těžištěm je návrh a engine, ne GUI.

Od 2026-11-14 má PoC navíc dojít tak daleko, aby v něm šel navrhnout a vytisknout konkrétní díl: robotický kloub s planetovou převodovkou (viz Rozšíření pro robotický kloub a validační scénář 9). Kloub je ukázkový příklad postupu, který má nástroj zvládnout, ne zakázka na dodání konkrétního dílu (upřesnění vlastníka 2026-11-14). Cílem je nástroj, ve kterém takový díl jde navrhnout až k tisku; rozšíření se proto mají volit tak, aby sloužila i jiným konstrukcím.

Ke kloubu vedou dva milníky (D35):

1. **Model kloubu v editoru.** Validační scénář 9: všechny díly s osovým uspořádáním, bez kolizí, parametricky měnitelný převod, export po dílech. Ověřuje funkce editoru.
2. **Fyzický prototyp (volitelný).** Kloub, který jde vytisknout, smontovat a protočit: uložení a osové zajištění unašeče a satelitů, držák magnetu enkodéru, prostor pro desku a kabely, tiskové vůle. Kloub je ukázkový příklad, ne dodávka, takže o tomto milníku se rozhodne až po prvním: podle toho, jestli má nástroj prověřit i skutečný výtisk. Práci na editoru neblokuje; validační scénář 10 se doplní, jen pokud se milník bude dělat.

## Základní principy

1. **Engine je oddělený od rendereru.** Engine nic nekreslí a nezávisí na žádné vykreslovací knihovně. Jde spustit a testovat bez browseru (Node).
2. **Běží v browseru.** Engine je v TypeScriptu. Knihovny třetích stran (i WASM) jsou přípustné, ale každou schvaluje vlastník projektu jednotlivě a každá je schovaná za vlastním rozhraním.
3. **Dokument je log operací.** I když uživatel model „nakliká", ukládá se posloupnost operací se záměrem (reference + parametry), ne výsledná geometrie. Geometrie je vždy odvozená přehráním logu.
4. **Log jde zpětně upravovat.** Změna operace uprostřed logu vyvolá přepočet všeho, co na ní závisí.
5. **Skici řeší constraint solver.** Uživatel kreslí přibližně a geometrii určují vazby a kóty.
6. **Tělesa jsou mesh, ne B-rep.** Uvnitř enginu je těleso uzavřená trojúhelníková síť. Přesné plochy se nevedou.

## Funkce PoC

### Dokument a historie

- Log operací (features) s parametry a referencemi na entity.
- Úprava parametru libovolné operace a přepočet od ní dál.
- Vložení, smazání a potlačení operace uprostřed logu.
- Chybové stavy: operace s rozbitou referencí se označí jako chybná, přepočet se nezhroutí a referenci jde opravit.
- Undo/redo.
- Serializace dokumentu do JSON a zpět.

### Skica (2D)

- Entity: bod, úsečka, kružnice, oblouk.
- Pevný počátek skici, ke kterému jde geometrii vázat a kótovat.
- Geometrické vazby: totožnost, vodorovnost, svislost, rovnoběžnost, kolmost, tečnost, shodná délka, bod na křivce, souměrnost dvou bodů podle úsečky (osy) a bod ve středu úsečky.
- Kóty: vzdálenost bod–bod, bod–úsečka, vodorovná a svislá vzdálenost, úhel, poloměr/průměr.
- Stav skici: plně určená, podurčená, přeurčená (včetně označení konfliktních vazeb).
- Diagnostika skici na vyžádání: které vazby jsou navíc (duplicitní i plynoucí z ostatních) a ze kterých vazeb plynou, kterou sadu jde odebrat, a které body a poloměry se ještě mohou hýbat. Stejnou řídicí vazbu nejde přidat dvakrát.
- Tažení podurčené geometrie, při kterém solver drží vazby.
- Konstrukční geometrie (pomocné křivky, které netvoří profil).
- Promítnutí hrany tělesa do skici jako referenční geometrie, ke které jde vázat a kótovat: přímá hrana jako úsečka, kruhová hrana do rovnoběžné roviny jako kružnice. Při změně tělesa se skica přepočítá, takže například díra drží vzdálenost od okraje nebo soustřednost s válcem.
- Detekce uzavřených profilů pro extrude.

### 3D

- Základní roviny (XY, XZ, YZ).
- Vlastní rovina definovaná posunem od základní roviny, od rovinné stěny tělesa nebo od jiné vlastní roviny.
- Skica na základní rovině, na vlastní rovině a na rovinné stěně tělesa.
- Extrude: nové těleso, přidání k tělesu, odebrání z tělesa. Kladná vzdálenost u skici na stěně míří ven z tělesa.
- Stabilní pojmenování stěn a hran, které přežije přepočet. Na stěny i hrany jde odkazovat z pozdějších operací.

### Výstup

- Geometrie pro renderer: trojúhelníky s mapováním trojúhelník → ID stěny (kvůli výběru myší), hrany k vykreslení.
- Export do STL.

### Rozhraní pro AI

- MCP server (`packages/mcp`), přes který AI model čte a mění dokument: přehled modelu, skica včetně diagnostiky („proč má skica dva stupně volnosti"), tělesa se jmény stěn a hran, provedení a náhled příkazů, undo a redo, soubory (otevřít, uložit, export STL).
- Dva režimy se stejnými nástroji: nad dokumentem ze souboru (engine běží v serveru) a nad dokumentem otevřeným v běžící aplikaci (změny od AI uživatel hned vidí a může je vrátit).
- Nástroje jsou obecné a jejich popis se generuje ze zdrojů enginu (typy příkazů a dokumentu, katalog vazeb). Nová vazba nebo příkaz v enginu se v rozhraní objeví bez zásahu do serveru.

### Rozšíření pro robotický kloub (D35)

Status: **implemented** (2026-11-14): all seven points. Číslování je pořadí implementace. Ukázkový díl je planetová převodovka s převodem 4 až 6 jako robotický kloub: uvnitř je celý motor Eaglepower LA8308, za motorem se montuje řídicí jednotka MKS XDrive Mini. Rozměry dílů, které návrh potřebuje, nese validační scénář 9.

U každého bodu platí levná varianta, navržená tak, aby šla později rozšířit na plnou; kde malé rozšíření dá obecnější nástroj, má přednost. Co do PoC nepatří, je v budoucích funkcích; důvody a návrh provedení jsou v D35. Každá funkce má být dostupná z aplikace i přes MCP.

1. **Pojmenované parametry a výrazy.** Tabulka parametrů v dokumentu. Výraz nad parametry jde zadat do každého číselného pole feature a do hodnoty každé kóty (vzdálenost vysunutí, posun roviny, počet zubů, počet kopií, úhly), například `Zr = Zs + 2 * Zp`. Která pole to jsou a jakou mají jednotku a pravidlo, říká katalog číselných polí; nové pole je položka katalogu a výrazy i popis pro AI ho převezmou. Úhly jsou v radiánech v čísle i ve výrazu; stupně se píšou funkcí `deg()`. Aplikace ukazuje a přijímá ve stupních čísla; výraz nechává beze změny a ukáže k němu výslednou hodnotu ve stupních. Změna parametru přepočítá model od první feature, která ho používá. Neznámé jméno, cyklus, neplatný výraz, hodnota mimo rozsah pole a necelý počet jsou chyby, které přepočet neshodí a jdou opravit; skica s chybným výrazem kóty zůstane vidět a počítá s poslední platnou hodnotou. Vedle parametrů nese dokument kontroly: výrazy, které mají platit (například `Zs % 3 == 0`); nesplněná kontrola je varování, které vidí uživatel i AI.
2. **Rozsah vysunutí.** Vzdálenost s posunem začátku od roviny skici (jedna skica tak poslouží features v různých výškách a vysunutí na obě strany roviny je jen záporný začátek), nebo „skrz vše" (dopředu, dozadu, oběma směry): výřez, který po změně tloušťky tělesa dál prochází celým tělesem. Výřez smí mít víc cílových těles (díra skrz dva sešroubované díly).
3. **Ozubené kolo.** Vysunutí bere profil buď z oblastí skici, nebo z generátoru. Generátory jsou položky katalogu (potřebné entity skici, parametry, odkazy), takže další profil je nová položka bez změny tvaru dokumentu. Ozubené kolo je první generátor, nad kružnicí skici (i konstrukční), která je roztečnou kružnicí kola. Zadává se počet zubů, úhel záběru, vůle, natočení a zda je ozubení vnější, nebo vnitřní; modul plyne z průměru kružnice a počtu zubů. Operace, cíl a rozsah jsou stejné jako u každého vysunutí: vnější ozubení jako nové těleso nebo přidání k tělesu, korunové kolo jako výřez vnitřním profilem, výřez vnějším profilem dá drážkované spojení. Správnou osovou vzdálenost kol drží tečnost roztečných kružnic ve skice. Natočení zubů se zadává číslem, nebo se dopočítá z odkazu na kolo, se kterým je kolo v záběru.
4. **Pole.** Feature, která zdroj opakuje podle seznamu transformací; první druh je kruhové pole kolem osy (bod skici s normálou její roviny, nebo základní osa). Zdrojem je seznam features (výřezy a přidání: díra se zapuštěním na roztečné kružnici), nebo hotové těleso (tři satelity). Počet zahrnuje originál; kopie jdou po celém kruhu, nebo v zadaném úhlu mezi první a poslední. Kopie tělesa je těleso jako každé jiné: jde na ni kreslit, řezat do ní a promítat její hrany. Obecně smí feature vytvořit víc těles. Pole uvnitř skici ne.
5. **Práce s více díly.** Export STL po jednotlivých tělesech. Dotazy nad tělesy: kolize (objem průniku dvojic těles; dvojice, kterou se nepodařilo spočítat, se ohlásí zvlášť), objem a obálka tělesa.
6. **Vazby.** Stejný poloměr kružnic a oblouků. Pevný bod: vazba drží bod na zadaných souřadnicích skici; souřadnice mohou být výraz a diagnostika s ní pracuje jako s každou jinou vazbou.
7. **Nástroje skici.** Sdílený modul nástrojů, které z několika údajů složí dávku příkazů; používá ho aplikace i MCP. Patří do něj stávající obdélník a nový pravidelný mnohoúhelník z úseček a vazeb. Hlavní použití mnohoúhelníku je zapuštění matice: šestiúhelník s kótou přes plochy (rozměr klíče) a výřez do hloubky.

## Budoucí funkce (mimo PoC, návrh je nemá znemožnit)

- Vlastní rovina nakloněná pod úhlem kolem hrany tělesa. Předpoklad (stabilní reference na hrany) je součástí PoC.
- Vlastní rovina nakloněná kolem úsečky skici a rovina třemi body.
- Promítnutí kruhové hrany do šikmé roviny (elipsa). Architektura s tím počítá od začátku, viz architecture.md.
- Promítnutí vrcholů tělesa do skici.
- Export do 3MF.
- Rozsah extrude „po stěnu". („Skrz vše" a posun začátku, který pokrývá i vysunutí na obě strany, jsou součástí rozšíření pro robotický kloub; rozsah je tam varianta, další druhy se přidají bez změny tvaru dokumentu.)
- Revolve.
- Zaoblení a zkosení hran (na meshi obtížné).
- Splajny ve skice.
- Ozubení jako generovaný blok uvnitř skici (v PoC je ozubené kolo generátor profilu pro vysunutí). Posunutí profilu ozubení.
- Jména referenčních kót ve výrazech.
- Posuvné pole a zrcadlení features a těles (další druhy transformací pole).
- Pole a zrcadlení uvnitř skici.
- Sestavy s vazbami mezi díly a pohybem. Vyžadovaly by druhý, prostorový constraint solver. Opakované použití dílu řeší v PoC pole těles.
- Řez modelem v pohledu.
- 3D skici.
- Import souborů. Importovaná síť nemá pojmenované stěny, takže by na ni nešlo kreslit ani ji promítat; STEP bez výměny jádra nejde.
- Kolaborace.
- Přesná geometrie (B-rep) a STEP export. Vyžadovalo by výměnu geometrického jádra.

Pracovní rozbor kandidátů na další milníky (co každý potřebuje a proč ho současný návrh neznemožňuje) je v [backlog.md](backlog.md).

Intended use and order after D35 (owner, 2026-11-14): the tool is meant for designing parts for a 3D printer and tinkering, with brackets and boxes as the base and most parts for a robotic arm and similar mechanisms; models are mostly built together with an AI through MCP. The order in which the features above and the candidates of backlog.md are taken up after D35 is decided in D36 ([decisions/D36-order-after-d35.md](decisions/D36-order-after-d35.md)); the working plan is [d36/README.md](d36/README.md). Three items of the list above change with it: an assembly with mates is replaced by a mechanism description, 3D sketches by a path through points, and import is planned as a mesh used as a reference body.

## Validační scénáře

Slouží k ověření návrhu (architektura, moduly, kontrakty) a později jako akceptační testy.

1. **Základní průchod.** Skica na rovině (obdélník, kružnice, kóty) → extrude → skica na stěně tělesa s dírou okótovanou k promítnuté hraně → výřez → změna kóty v první skice. Vše se přepočítá včetně výřezu a díra drží vzdálenost od okraje.
2. **Změna topologie.** Pozdější reference buď vydrží, nebo se čistě ohlásí jako rozbité. Nikdy tiše neukážou na jinou entitu.
   - a) Do první skici se přidá další díra: vše platí dál.
   - b) Z obdélníku se smaže úsečka: profil se rozpadne, první extrude skončí v chybě a s ním vše, co na něm závisí.
   - c) Úsečka obdélníku se nahradí jinou mezi stejnými body: extrude ohlásí chybějící profil. Po novém výběru profilu projde, skici na víkách platí dál, ale skica na stěně vzniklé z původní úsečky ohlásí rozbitou referenci.
3. **Solver.** Podurčená skica, tažení bodu, přidání konfliktní vazby. Engine vrátí srozumitelnou diagnostiku a zbytek modelu zůstane zobrazený.
4. **Round-trip.** Uložit dokument, načíst, přepočítat, exportovat. Výsledek je identický s původním. Platí i pro dokument s chybou: po smazání zdrojové skici jde dokument uložit a načíst, extrude je v chybě a po výběru jiné skici projde se stejným ID.
5. **Časová osa a undo.** Vlastní rovina s posunem, skica na ní a extrude. Potlačení dřívějšího výřezu, vložení nové feature doprostřed logu, přesun feature. Po každém kroku undo a redo vrátí přesně předchozí a následující stav.
6. **Navazování geometrie.**
   - a) Válec mimo počátek, skica na jeho víku s promítnutou kružnicí a soustřednou dírou. Po posunu válce v původní skice díra zůstane soustředná.
   - b) Nálitek, jehož bok lícuje s bokem tělesa: výsledkem je jedno těleso, obě stěny zůstanou pojmenované a horní stěna tělesa zůstane použitelná pro další skicu. Platí i tehdy, když je bok nálitku přichycený na krajní bod promítnuté hrany.
   - c) Výřez, jehož stěna lícuje se stěnou tělesa jen zčásti, a další operace na nově vzniklé stěně: výsledkem je jedno těleso bez mezer.
   - d) Výřez, který těleso mine, a výřez, který by ho odebral celé: model zůstane, feature ohlásí varování, respektive chybu.
   - e) Nálitek se stejným půdorysem se zase celý odřízne: po jeho stěnách nezůstane nic a skica na některé z nich ohlásí rozbitou referenci.
7. **Skica krok za krokem s diagnostikou.** Obrys úhelníku od ruky, pak směry stran, rozměry a ukotvení. Po každém kroku diagnostika řekne, kolik volnosti zbývá a které body se hýbou; u určeného tvaru bez ukotvení ukáže, že volná je jen poloha. Vazby navíc označí, vysvětlí, z čeho plynou, a navrhne sadu k odebrání; po jejím odebrání se geometrie nezmění. Přesnou duplicitu engine odmítne.
8. **Souměrný díl s konstrukční osou.** Konstrukční svislá osa z počátku, lichoběžník souměrný podle ní a díra ve středu osy. Souměrnost ubere každé dvojici bodů dva stupně volnosti a diagnostika to ukáže. Po změně šířky a výšky zůstane díl souměrný a díra uprostřed; bez kóty šířky jde rohem táhnout a protější roh ho zrcadlí. Vodorovnost základny přidaná navíc se označí jako plynoucí ze souměrnosti a svislosti osy. Dokument s novými vazbami se uloží a načte beze změny.
9. **Robotický kloub s planetovou převodovkou** (tested in `packages/scenarios/test/scenario9.test.ts`, all parts a to k; ověřuje rozšíření z D35). Planetová převodovka s převodem 4 až 6, uvnitř pouzdra je celý motor, za motorem je deska pro řídicí jednotku. Rozměry dílů, kolem kterých se kloub staví:

   | Díl | Rozměr |
   |---|---|
   | Motor Eaglepower LA8308, obálka | průměr 90 mm, délka 26,5 mm; plášť se točí s rotorem |
   | Motor, strana statoru (pevná) | 4 závity M4 na roztečné kružnici 40 mm, po 90° |
   | Motor, strana rotoru (výstup) | 4 závity M3 na roztečné kružnici 31 mm, po 90° |
   | Motor, středicí čep | průměr 3 mm, délka 6 mm, v ose; strana rotoru je předpoklad |
   | Řídicí jednotka MKS XDrive Mini, deska | 63 × 58 mm |
   | Řídicí jednotka, montážní díry | 6 děr průměru 3,3 mm; středy vůči středu desky: x = ±28,3 mm, y = 25,75, 1,75 a −25,75 mm (rozteče 56,6, 24 a 27,5 mm jsou z výkresu; svislá poloha vůči středu předpokládá řadu děr vystředěnou na desce) |
   | Řídicí jednotka, enkodér | ve středu desky; musí ležet v ose motoru |
   | Šroub M3 s válcovou hlavou | průměr hlavy 5,5 mm |
   | Matice M3 | rozměr přes plochy 5,5 mm |

   Kloub má sedm tištěných dílů: centrální kolo s přírubou, tři satelity, pouzdro s korunovým kolem, zadní desku a unašeč. Motor je v modelu jako zjednodušené těleso. Uložení a osové zajištění unašeče a satelitů scénář neřeší; patří do druhého milníku (scénář 10). Důvody uspořádání jsou v D35, Upřesnění scénáře 9.

   Osové uspořádání. Osa je osa motoru, nula leží na dosedací ploše statoru a kladný směr míří k rotoru:

   | Díl | Rozsah v ose (mm) |
   |---|---|
   | Zadní deska | −5 až 0 |
   | Motor | 0 až 26,5 |
   | Pouzdro | 0 až 46; vybrání pro motor 0 až 28, plný materiál s korunovým kolem 28 až 46 |
   | Centrální kolo, příruba průměru 40 mm | 26,5 až 30,5 |
   | Centrální kolo, ozubení | 30,5 až 46 |
   | Satelity | 34 až 46 (nad hlavami šroubů M3 v přírubě, které sahají do 33,5) |
   | Unašeč, čepy průměru 5 mm (díra v satelitu 5,3 mm) | 34 až 46,5 |
   | Unašeč, kotouč průměru 60 mm | 46,5 až 51,5 |
   | Zapuštění matic v čele pouzdra | 43 až 46 |

   Ozubená kola i čepy unašeče vycházejí z jedné skici roztečných kružnic v rovině nula; do své výšky je dostane posun začátku rozsahu vysunutí.

   - a) Parametry `modul = 0,9`, `Zs = 18`, `Zp = 27` a `Zr = Zs + 2 * Zp`. Skica roztečných kružnic, všechny tři konstrukční (dotýkající se běžné kružnice by zneplatnily profil skici): centrální kolo v počátku, satelit tečně k němu se středem na vodorovné přímce počátkem (bez toho by mohl kolem centrálního kola obíhat), korunové kolo soustředné s centrálním; průměry jsou výrazy `modul * Zs`, `modul * Zp`, `modul * Zr`. Že se korunové kolo satelitu dotýká, plyne z parametrů. Dokument má kontroly `modul * (Zs / 2 + 1) < 12.75` (šrouby do rotoru jdou zasunout podél ozubení), `Zs % 3 == 0` a `Zr % 3 == 0` (tuhé kopie satelitu zůstanou v záběru) a kontrolu, že se sousední satelity nepotkají.
   - b) Ozubená kola z těchto kružnic: centrální kolo a satelit jako tělesa, korunové jako výřez vnitřním profilem do pouzdra. Natočení satelitu se dopočítá ze záběru s centrálním kolem, natočení korunového ze záběru se satelitem.
   - c) Satelit dostane díru pro čep a jako hotové těleso se kruhovým polem zopakuje třikrát.
   - d) Centrální kolo má přírubu se čtyřmi dírami pro šrouby M3 na roztečné kružnici 31 mm (do rotoru motoru): jedna díra vyříznutá skrz vše a zopakovaná polem. V ose má díru pro středicí čep motoru. Šrouby se zasouvají podél ozubení, takže hlavový poloměr centrálního kola `modul * (Zs / 2 + 1)` musí zůstat pod 12,75 mm (15,5 mm mínus polovina hlavy šroubu). Proto je modul 0,9: při `Zs = 24` vychází 11,7 mm, při modulu 1 by to bylo 13 mm.
   - e) Pouzdro je válec průměru 110 mm otevřený na straně motoru. Zezadu má vybrání průměru 92 mm na délku motoru (motor průměru 90 mm se v něm točí s vůlí); nad vybráním zůstává plný materiál a do něj je skrz vše vyříznuté korunové kolo z bodu b. Hlavová kružnice korunového kola (63 mm) je menší než motor, takže motor se vkládá zezadu a dno pouzdra je samostatný díl, zadní deska. Šest děr pro šrouby M3 na roztečné kružnici 101 mm prochází zadní deskou i stěnou pouzdra: jeden výřez skrz vše do obou těles. Na čele pouzdra u korunového kola má každá díra šestihranné zapuštění pro matici s rozměrem přes plochy 5,5 mm. Díra a zapuštění se nakreslí jednou a zopakují společně jedním polem.
   - f) Zadní deska je kotouč průměru 110 mm se středem v ose motoru. Uzavírá pouzdro a nese motor i řídicí jednotku:
     - čtyři díry pro šrouby M4 na roztečné kružnici 40 mm (do statoru), jedna díra a pole;
     - šest děr na roztečné kružnici 101 mm vzniká společným výřezem s pouzdrem (bod e);
     - středový otvor průměru 20 mm, kterým magnet na hřídeli míří na enkodér;
     - šest děr průměru 3,3 mm pro řídicí jednotku v polohách z tabulky. Mají stejný poloměr, levou trojici drží pevné body na souřadnicích z tabulky a pravá je k ní souměrná podle svislé osy. Skica je plně určená.
   - g) Unašeč je kotouč se třemi čepy pro satelity. Čep leží na kružnici o poloměru osové vzdálenosti `modul * (Zs + Zp) / 2`; jeden čep vznikne přidáním k tělesu a zopakuje se polem. Čep prochází dírou satelitu s vůlí.
   - h) Motor je zjednodušené těleso: válec průměru 90 mm a délky 26,5 mm mezi zadní deskou a přírubou centrálního kola.
   - i) Změna převodu. Po každé z obou změn se vše přepočítá bez chyby, roztečné kružnice zůstanou tečné, zuby v záběru, čepy unašeče v dírách satelitů, díry dál procházejí a kontrola kolizí z bodu j nic nenajde:
     - převod 5 → 4 se stejnou korunou: `Zs` z 18 na 24 a `Zp` z 27 na 24, `Zr` zůstává 72;
     - převod 5 → 6 s větší korunou: z výchozího stavu `Zp` z 27 na 36, `Zr` vyjde 90. Roztečný průměr koruny vzroste z 64,8 na 81 mm a koruna se dál vejde do pouzdra;
     - kontroly parametrů v obou stavech platí. Po změně `modul` na 1 při `Zs = 24` kontrola hlavového poloměru ohlásí varování a model se dál přepočítá.
   - j) Kontrola kolizí nenajde průnik mezi koly v záběru (s nenulovou vůlí), mezi motorem a pouzdrem, mezi čepy a satelity ani mezi dalšími tělesy, která se nemají prolínat; po záměrně příliš velkém satelitu průnik ohlásí.
   - k) Každé těleso jde exportovat do vlastního STL. Dokument se uloží a načte beze změny.
10. **Fyzický prototyp kloubu** (druhý milník, volitelný, zatím nespecifikováno). Doplní se po dokončení scénáře 9, pokud se milník bude dělat. Má pokrýt, co scénář 9 vynechává: uložení a osové zajištění unašeče a satelitů, držák magnetu a jeho vzdálenost od enkodéru, prostor pro desku řídicí jednotky a kabely, tiskové vůle čepů, šroubů a matic. Tři údaje o motoru je před tím potřeba ověřit na skutečném dílu: stranu středicího čepu, konec hřídele na straně statoru a hloubku závitů.
11. **Queries about the robot joint** (D36, step 1; tested in `packages/scenarios/test/scenario11.test.ts`, which builds the joint of scenario 9 from `packages/scenarios/test/joint.ts`). The queries that let an AI see and measure a model are asked about the joint; each package of track A adds its part.
    - *Measuring (1b, D39), done.* The wall between the root circle of the ring gear and a bolt hole: the ring gear is a face of gear teeth with no exact form, so the pair has no exact distance and gets the smallest distance on the mesh, 15.2837 mm with an accuracy of 0.020055 mm; the same wall exactly is 15.275 mm (the distance of the axis of the gear from the axis of the hole, less the radius of the hole and the root radius the generator publishes), and the two agree within the accuracy. Also exact: the pitch of two bolt holes of the pattern (50.5 mm between their axes), the floor above the motor recess (two planar faces that look away from each other, 18 mm), and the mouth of a bolt hole as the circle of its two surfaces, which the description of the body carries as well. A face that is not in the state asked about is refused with the path of its argument.
    - *Section (1a), smallest gap (1c), mass properties (1d), print queries (1e), view image (1f):* not implemented yet.

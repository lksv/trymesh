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
    - *Section (1a, D38), the query done.* Across the axis at z = 40 the plane cuts the sun, the three planets, the housing and the carrier in 19 loops of one span each: 14 whole circles and the five faces of gear teeth as curves of 270, 405 and 720 points. A planet has 431.379 mm², its volume over its height. The housing reads as its outer wall (a circle of radius 55), six bolt holes of radius 1.7 whose centres are 50.5 from the axis, and the ring gear. The default budget of 500 lists the 19 spans and the teeth of the sun (289 of 2224 items); a budget of 30 still gives every body its outline. Along the axis (the base plane XZ) the 92 spans are all lines. A plane in the front face of the housing shows that face from inside (6028.838 mm², with the bodies that end in the plane named) and nothing from outside; 1.5 mm into the body it goes through the six hexagonal nut pockets.
    - *Smallest gap (1c, D40), done.* The pin of the carrier (diameter 5) in the bore of a planet (5.3) is 0.15 mm by design and 0.1405 mm on the meshes, with an accuracy of 0.02 mm; the gap is named on the wall of the bore (`planetHole`) and on the pin (`carrierPin`), not on the cap of the planet the bore ends in. One call over the whole joint examines 28 pairs: 15 are within 5 mm, the closest first: three seating faces that touch (motor and plate, motor and sun, plate and housing), the backlash of the gears (0.0497 between each planet and the ring gear, 0.0499 between the sun and each planet), the pins in the bores, the sun and the carrier (0.5), the motor in its recess (0.99, 1 by design) and the housing and the carrier (1.5812); 13 are counted as further apart. The plate and the carrier are measured (34 mm) with a larger search distance. A planet made too large in a preview has the distance zero to the housing with the contact `collision`, and the gap of the sun and a planet follows the backlash stepped in a preview.
    - *Mass properties (1d, D41), done.* The carrier alone, printed solid in PLA (1.24 g/cm³): 14863.496 mm³, 18.431 g, its centre of mass on the axis at z = 48.569, 8256.9 g·mm² about the axis and 4242.9 across it. What turns with the output, the carrier and the three planets as one piece: 37.687 g, the centre of mass on the axis (three planets a third of a turn apart cancel out) at z = 44.19, and 17639 g·mm² about the axis of the joint, which is the sum of the moments of the four bodies about it; one planet is 20.25 mm from that axis. A bought motor with its own density next to a carrier printed with 40 % of its volume as material: the fill factor reaches the carrier only (7.372 g). A fill factor that reaches no body and a body left without a density are refused at their arguments.
    - *Print check (1e, D42), done.* The housing in two orientations, each given by the face that lies on the bed, in one call with a bed of 220 × 220 × 250: both fit and both faces lie on the bed. On its seating face the contact is 2801.28 mm² and 3330.69 mm² overhang, all of it one face, the ceiling of the motor recess, 28 mm up; on its front face the contact is 6028.84 mm² and 103.13 mm² overhang on six faces, the floors of the nut pockets, 3 mm up. So the front face goes on the bed, and the faces to change are named. On its side (by a direction) a cylinder has no contact and 8612.84 mm² overhang on 21 faces. The carrier named to lie on the face its pins stand on rests on the three pin ends, and the answer says that the face is not on the bed; with a direction a hair off the axis it still rests on all three. All printed parts both ways along the axis in one call: the carrier prints pins up, the sun flange down. A round face cannot lie on the bed, and a bed with a length of zero is refused at that length.
    - *View image (1f, D43), done.* Three pictures of the joint, asked by the tool `view_image`: the whole joint as the app starts with it; the gears alone from above (the sun and the three planets; the carrier is left out, its disc lies over them); and the joint cut across its axis 40 above the seating face, from above: the cut goes through the sun, the three planets, the three pins of the carrier and the housing, whose region has the ring gear and the six bolt holes as its holes. Also the model before the ring gear was cut (`at`), cut along the axis from the front, and the camera of the user. A body that is not there and a round face as the plane are refused with the argument; without a view there is no picture. The test checks what the view is asked to draw; the pictures themselves were looked at in a browser.
12. **A box with a lid and screw posts** (D36, step 2; tested in `packages/scenarios/test/scenario12.test.ts`, which builds the box from `packages/scenarios/test/box.ts`). A printed enclosure built from few sketches, the way the features of track B make it short; each package of the track adds its part. Parameters: the outer size 80 × 50 × 30, the wall and the floor 2, the print clearance 0.2, the lid 3 thick with a lip 4 high and 1.5 thick, ribs 1.6 thick and 12 high.
    - *Offset and wall (2a, D44), done.* The box is the outline extruded to its height; the cavity is the same outline with the offset `-wall`, cut from the floor up, so the body has the volume 80·50·30 − 76·46·28 and follows the parameter of the wall. The side faces of the cavity keep the names of the curves of the outline and are planes. An offset of −30 is an error of the feature (`invalidProfile`) that names the two short sides, which vanish, and says what to do. The lid is a plate on the box, a lip from the outline moved by `-(wall + clearance)` and its inside moved by `-(wall + clearance + lipT)`: the box and the lid do not collide, and the lip is 0.2 from the wall of the cavity. The offset is an optional field: `setField` gives it to the plate of the lid, `updateFeature` changes it on the lip and removes it again. A rib is a wall along one construction line on the floor of the cavity, from inside the long wall towards the middle: the box has its two sides (`wallSide`, left and right of the line) and its free end (`wallEnd` with the point of the line), the end inside the wall is swallowed, and a sketch stands on a side. A bracket is a wall along a chain of two lines with a mitred corner, its thickness set as a field. Curves that do not form one chain are an error of the feature; a curve that is not in the sketch is an invalid command. The document saves and loads to the same model.
    - *Taper (2b, D45), done.* The rib gets a draft of three degrees by a patch of its extent (`extent: { taper: 'deg(-3)' }`): its sides stay planes with their names, its top is 1.6 − 2 · 12 tan 3° wide, the box loses volume, and a sketch stands on the tilted side. The lip of the lid gets a lead-in of ten degrees by `setField` (the field was absent): it narrows to 0.795 at its free end, measured on its faces, and the lid still clears the box. A countersink by hand on the top of the lid: a cut of the disc of a circle of 8 narrowing by 45° to the circle of 5 (`distance: '-(wideD - narrowD) / 2'`, `taper: 'deg(-45)'`), and a bore through. The side of the cut is a cone (a hole, half angle 45°, the apex 4 below the mouth), the volume taken is that of the frustum and the bore, and both rims (the top and the cone, the cone and the bore) are circles a sketch projects with the radii 4 and 2.5. A taper of −80° is an error of the feature that says it is the far end; a taper on "through all" is an invalid command, and a patch to "through all" drops the taper. The step `2b-taper` is in the list and the document loads to the same model.
    - *Extent up to a face (2f, D47), done.* Two screw posts on the floor of the cavity end at the underside of the lid (`extent: { type: 'upTo', plane: <the start cap of the lid> }`): one length, 28, from the floor to the lid, and a circular pattern adds the other two; they touch the lid without interference. A higher box (H = 40) makes them 38 long; a gap of 0.2 stops them short of the lid, a gap of 100 is an error (`invalidExtent`). A sketch stands on the top of a post. A brace from the wall of the cavity ends in the drafted side of the rib: its lengths differ by 3 · tan 3° over its diameter. Refused: a wall parallel to the direction, the floor the posts stand on, a face of a later feature (an invalid command), a round face (`nonPlanarFace`); a base plane works. The document loads to the same model.
    - *Holes with hardware (2c): not done yet.*

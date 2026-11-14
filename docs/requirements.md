# Požadavky

Živý dokument. Popisuje, co má PoC umět a co ne. Důvody jednotlivých voleb jsou v [decisions.md](decisions.md).

Poslední úprava: 2026-11-14

## Cíl

PoC jednoduchého parametrického 3D editoru ve stylu Autodesk Fusion. Těžištěm je návrh a engine, ne GUI.

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
- Geometrické vazby: totožnost, vodorovnost, svislost, rovnoběžnost, kolmost, tečnost, shodná délka, bod na křivce.
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

## Budoucí funkce (mimo PoC, návrh je nemá znemožnit)

- Vlastní rovina nakloněná pod úhlem kolem hrany tělesa. Předpoklad (stabilní reference na hrany) je součástí PoC.
- Vlastní rovina nakloněná kolem úsečky skici a rovina třemi body.
- Promítnutí kruhové hrany do šikmé roviny (elipsa). Architektura s tím počítá od začátku, viz architecture.md.
- Promítnutí vrcholů tělesa do skici.
- Export do 3MF.
- Rozsah extrude „skrz vše" a „po stěnu" (díra, která po změně tloušťky tělesa dál prochází).
- Revolve.
- Zaoblení a zkosení hran (na meshi obtížné).
- Pojmenované parametry a výrazy v kótách.
- Splajny ve skice.
- Sestavy.
- 3D skici.
- Import souborů.
- Kolaborace.
- Přesná geometrie (B-rep) a STEP export. Vyžadovalo by výměnu geometrického jádra.

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

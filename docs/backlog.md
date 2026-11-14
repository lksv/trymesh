# Podklady pro další funkce

Pracovní dokument. Sbírá funkce, které se zatím nedělají, a u každé říká, na co navazuje a proč ji současný návrh neznemožňuje. Není to plán ani rozhodnutí: co se rozhodne, přesune se do [requirements.md](requirements.md) a [decisions.md](decisions.md). Stručný výčet budoucích funkcí je v requirements.md; tady je rozbor.

Poslední úprava: 2026-11-14

## Jak se sem věci dostaly

Při přípravě rozšíření pro robotický kloub (D35) se každá zvažovaná funkce třídila podle jedné otázky: změnila by později tvar dokumentu nebo příkazů?

- **Ano:** udělala se hned, i když ji kloub sám nepotřebuje. Je jich sedm a jsou v D35 (katalog generátorů profilu, posun začátku vysunutí, recept nástroje jako rozhraní, obecná ID těles, registr typů features s příkazem `updateFeature`, kontroly parametrů, výřez do více těles).
- **Ne:** jde přidat dodatečně jako nová položka, nový typ nebo nová varianta. Ty jsou tady.

## Kandidáti

Pořadí je odhad užitku pro obecné použití, ne závazek.

| Funkce | K čemu je | Na co navazuje, proč nic nezamyká |
|---|---|---|
| Promítnutí geometrie z jiné skici | Společná kostra pro víc dílů: jedna skica s osami, roztečnými kružnicemi a obrysy, na kterou se ostatní skici odkazují. Dnes jde promítnout jen hrana tělesa, takže konstrukční geometrii jiné skici je potřeba překreslit a svázat stejnými výrazy | Odkaz na promítnutou geometrii (`ExternalRef`) má rozlišovač typu; skica přibude jako další varianta vedle hrany. Promítnutí do rovnoběžné roviny stačí na většinu případů, šikmá rovina naráží na elipsu stejně jako u hran |
| Řez nebo obrázek modelu pro AI | AI model nevidí, ověřuje ho čísly (objem, obálka, kolize). Řez rovinou jako seznam smyček nebo obrázek pohledu by jí dal zpětnou vazbu na tvar | Nový dotaz enginu nad tělesy, vedle kolizí a objemu z D35. Řez poslouží i pro „řez modelem v pohledu" v aplikaci |
| Spojení, rozdělení, zrcadlení a přesun těles | Odečíst jeden díl od druhého (dutina podle vloženého dílu, drážkovaný otvor podle kola), rozříznout díl pro tisk, zrcadlový díl, rozložení dílů | Nové typy features v registru. Stojí na obecném pravidlu, že feature může vytvořit víc těles s ID `<feature>/<místní jméno>`. Nové je jen to, že těleso může zaniknout; odkaz na zaniklé těleso je rozbitá reference jako každá jiná |
| Revolve | Řemenice s klínovou drážkou, knoflíky, kužely, drážky pro O-kroužky, zahloubení pro zápustnou hlavu | Jiná stavba nástroje nad stejným profilem; recept nástroje je rozhraní. Osa je `AxisRef` z pole. Popis stěny má obecný druh vedle roviny a válce (kvůli ozubení) |
| Zkosení a zkrut při vysunutí | Úkos stěn, zápustná hlava, šikmé ozubení, přibližný závit | Další stavby nástroje; parametry jsou číselná pole rozsahu |
| Posuvné pole a zrcadlení features | Větrací otvory v řadě, mřížky, souměrné díly | Další druhy transformace v poli; pole je seznam tuhých transformací a zbytek feature se nemění. Zrcadlení navíc obrací orientaci trojúhelníků |
| Další generátory profilu | Cykloidní kotouč, řemenice GT2, řetězové kolo, ozubený hřeben, drážkování, text | Položky katalogu generátorů; tvar dokumentu se nemění |
| Další nástroje skici | Drážka, obdélník středem, odsazení obrysu (lem víka), rozteč děr | Funkce sdíleného modulu nástrojů; engine se nemění. Odsazení obrysu může chtít novou vazbu |
| Nejmenší vzdálenost těles | Ověření vůle (motor v pouzdře má mít 1 mm), ne jen toho, že se díly neprolínají | Další dotaz nad tělesy |
| Vlastnosti těles | Jméno, barva, příznak referenčního dílu (motor se netiskne a nemá se exportovat) | Nepovinný údaj v dokumentu klíčovaný ID tělesa |
| Jména referenčních kót ve výrazech | Parametr odvozený z naměřené hodnoty | Výrazy se vyhodnocují uvnitř přepočtu; jména jdou rozšířit o hodnoty vzniklé přepočtem a tečka je pro ně ve výrazu vyhrazená. Ověření výrazu při příkazu se pro taková jména musí přesunout do fasády enginu, která stav přepočtu má |
| Potlačení feature výrazem, konfigurace | Varianty jednoho dílu (s přírubou a bez) | `suppressed` jako další pole s výrazem; kontroly už zavádějí porovnání |
| Komentáře a skupiny parametrů | Čitelnost větší tabulky parametrů | Nepovinné údaje u parametru |
| Export do 3MF | Víc těles se jmény v jednom souboru | Další formát vedle STL; export po tělesech už je |
| Knihovna dílů, vložení jiného dokumentu | Motor, ložisko nebo šroub jako hotový díl místo ručního modelování | Nový typ feature, který vytvoří tělesa z jiného dokumentu; ID features vloženého dokumentu je potřeba odlišit předponou; validace odkazu na stěnu pak potřebuje stejný rozklad ID jako u těles. Import cizí sítě zůstává mimo (nemá pojmenované stěny) |
| Graf závislostí při přepočtu | Rychlost u větších modelů: dnes se přepočítá vše od první změněné feature | Vnitřní věc přepočtu, dokument se nemění |
| Sloučení nástrojů pole před booleanem, prostorové vyhledávání v adaptéru jádra | Rychlost u stovek kopií | Vnitřní věc pole a adaptéru jádra |
| Pootočení kopií v poli kolem vlastní osy | Satelity v záběru i tehdy, když počty zubů nejsou dělitelné počtem satelitů | Další údaj transformace kopie |
| Posunutí profilu ozubení | Kola s málo zuby, úprava osové vzdálenosti | Další parametr generátoru ozubení |

## Co tahle architektura levně nedá

- **Zaoblení a zkosení hran těles.** Těleso je síť, ne přesné plochy. Zaoblení ve skice pokryje svislé hrany, ostatní ne.
- **Sestava s vazbami a pohybem.** Vyžadovala by druhý, prostorový constraint solver. Místo ní je víc těles v jednom dokumentu.
- **STEP a import přesné geometrie.** Vyžadovaly by výměnu geometrického jádra.
- **Jemný detail u velkého modelu.** Adaptér jádra spolehlivě nerozliší detail menší než asi desetitisícinu rozměru modelu těsně u lícujících stěn (u modelu 110 mm kolem 0,01 mm).

## Srovnání s jinými konstrukcemi

Myšlenková zkouška: co by jiný díl potřeboval navíc proti kloubu a jestli to návrh unese.

| Konstrukce | Co potřebuje navíc | Kam to patří |
|---|---|---|
| Krabička na elektroniku s víkem | Díry skrz víko i krabičku; větrací otvory v řadě; lem víka; zaoblené hrany | Výřez do více těles (D35). Posuvné pole a odsazení obrysu později. Zaoblení hran ne |
| Cykloidní převodovka | Profil cykloidního kotouče; výstředník a kolíky umí vysunutí a pole | Katalog generátorů (D35), nová položka později |
| Řemenice, knoflík | Profil GT2; klínová drážka; rýhování | Generátor a pole (D35). Klínová drážka je revolve, později |
| Konzole s žebrem | Žebro vysunuté na obě strany roviny | Posun začátku vysunutí (D35) |
| Držák z více dílů podle společné kostry | Odkaz na geometrii jiné skici | Později; do té doby stejné výrazy ve více skicách |
| Šroubovací víčko, šikmé ozubení | Zkrut při vysunutí | Později |
| Zahloubení pro zápustnou hlavu | Kuželový výřez | Revolve nebo zkosení, později |
| Děrovaný panel se stovkami děr | Výkon: jeden boolean na desce se 192 otvory trval v adaptéru jádra 7,6 s | Riziko; sloučení nástrojů pole a prostorové vyhledávání později |
| Díl kolem kupovaných součástek (motor, ložisko) | Hotové modely součástek; ověření vůle | Ruční zjednodušené těleso dnes; knihovna dílů a nejmenší vzdálenost později |

Závěr zkoušky: žádná z konstrukcí nevyžaduje jiný tvar dokumentu, než jaký zavádí D35. Opakovaně se vracejí tři věci: odkaz mezi skicami, revolve a zpětná vazba na tvar pro AI.

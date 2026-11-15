# D35 Rozšíření pro robotický kloub

Moved here from [decisions.md](../decisions.md) on 2026-11-15, when the last point of D35 was closed; the text is unchanged. File names in it (`architecture.md`, `ui.md`, `backlog.md`, `requirements.md`, `d35-contract/`) are relative to `docs/`.

Rozsah, návrh provedení i upřesnění scénáře 9 odsouhlasil vlastník projektu 2026-11-14. Implementation status: step 0 and all seven points are done, see the paragraphs "Stav: provedeno" and "Status: done" below. Tvary typů níže jsou návrh, který se při implementaci může upřesnit; rozhodnutá jsou pravidla v textu. Návrh pak prošel dvěma nezávislými revizemi a spikem ozubení; co se podle nich změnilo, je v částech Revize návrhu a Spike ozubení na konci. Opravy podle revize i rozhodnutí po ní vlastník potvrdil týž den.

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
  - Recept nástroje je `ToolRecipe { operation, targets, build(firstFaceId) }`. Transformaci dostane `build` s bodem 4, cíle jako argument s bodem 2 (done: `build(targets, firstFaceId)`). Recept zatím nikdo nečte.
  - Posun začátku rozsahu (`extent.start`) engine už počítá, protože interval stavba hranolu dostala tak jako tak; pole v UI přidá bod 2.
  - `targets` smí mít zatím právě jedno těleso i u výřezu (víc bod 2). (No longer true since point 2: a cut takes one or more.)
  - `parameters` a `checks` jsou ve schématu verze 2, ale musí být prázdné; dokument, který je má, engine odmítne, aby je tiše nezahodil (bod 1). (No longer true since point 1: both are validated and evaluated.)
  - `updateFeature` ověřuje odkazy, které feature dosud neměla (porovnává místo, druh a ID). Proti `updateExtrude` je to mírnější ve dvou případech: změna, která rozbitý odkaz jen zopakuje, projde (formulář aplikace posílá vysunutí celé, takže dřív nešla v UI změnit vzdálenost u vysunutí se smazanou skicou), a změna operace bez cílů cíl znovu neověřuje. Nový rozbitý stav tím vzniknout nemůže. Pravidlo platí i pro víc cílů v bodě 2: oprava jednoho cíle nenarazí na druhý.
  - Změna s polem, které výsledná feature nemá, a půlka odkazu (objekt bez `kind`) jsou neplatné příkazy; pole s hodnotou `undefined` se přeskočí. Vzešlo z revize: překlep jinak končil úspěchem bez účinku a půlka odkazu vybrala jinou stěnu.
  - Popis API pro AI (`describe_api`) vypisuje typy features z registru včetně polí, která mění `updateFeature`.

  Na co musí navázat další body (z nezávislé revize kroku 0):

  - Bod 3: slučování pozná variantu a odkaz podle obsahu změny (`type`, `kind`), ne podle schématu. Slovníky generátoru (`params`, `operands`, `refs`) a pravidla „jiný generátor nahrazuje" a „`null` v parametrech vrací výchozí hodnotu" potřebují v registru popis cest (varianta, odkaz, slovník).
  - Bod 1: zápis po přepočtu umí jen vyřešenou skicu (`WriteBack` v `engine.ts`); hodnoty výrazů potřebují totéž pro ostatní features. (Done with point 1.)
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

  **Status: done 2026-11-14.** The rules above are implemented as written; the description of the code is in architecture.md, section Parameters and expressions. What the implementation settled or changed:

  - **Functions and operators.** `deg sin cos tan asin acos atan atan2 sqrt abs min max floor ceil round`, the constant `pi`, and the power operator `^` in addition to the operators listed above. Parameter names are identifiers of letters of any alphabet, digits and underscores. A dot inside a name is a syntax error and stays reserved for names of values produced by the recompute.
  - **Kind of result.** An expression is a number or a truth value and the kind is decided without evaluating. A check that is a number, or a parameter that is a comparison, is therefore an invalid command like a syntax error, not a state found later. The same mechanism later serves a `suppressed` field driven by an expression.
  - **One reader for numeric fields.** Feature validators read every numeric field through one reader, which takes the range from the catalog, accepts a string as an expression where the mode allows it, and records what it saw. `fieldsOf` is a validation pass in collecting mode, so the catalog of a concrete feature cannot differ from what commands accept. The static list (`FEATURE_TYPE_INFO[type].fields`, `CONSTRAINTS[type].values`) serves descriptions and forms; a test compares the two.
  - **Three validation modes** (load, add, update). A document is loaded without evaluating its expressions. `addFeature` evaluates them, also when the feature arrives in the document form (numbers plus the `expressions` map). A change evaluates only what it sets: an expression of a field the change does not touch is kept even if it no longer evaluates, so fixing one field does not trip over another. This is the same principle as verifying only new references.
  - **Input form.** `featureInput(feature)` puts the expressions back into the fields. The app's drafts for editing an extrusion and a plane are in this form; the rule that a number removes the expression stays explicit (third review, finding A).
  - **Cache.** The feature with substituted values is memoised by the original feature object and by the values and errors of its expressions, at most eight per feature object. The step cache is keyed by it. A parameter no feature uses recomputes nothing, and a parameter with the same value from a different expression recomputes nothing either. The environment of names is an argument, so names from the recompute can be added later.
  - **Write-back** covers every feature type and does not depend on the sketch having solved. Re-hanging the cache carries the substituted feature along.
  - **Ranges replace named rules** in the constraint catalog as well (`values` with a `NumberSpec`, the flag `dimension`). Error messages for numbers out of range are generated from the range. `isDimension` reads the flag, not the presence of `value`.
  - **MCP.** New tool `get_parameters`. `execute`, `preview`, `undo`, `redo` and `get_model` report failed checks and parameters in error; a feature in the result carries `fieldErrors`; `get_sketch` shows the expression of a dimension; `describe_api` lists the expression syntax and the numeric fields.
  - **App.** Parameter table and checks in the model panel; text fields that take a number or an expression for the extrusion distance, the plane offset and dimension values (ui.md).
  - **Tests.** Unit tests of the parser and of the commands, a multi-step scenario of the recompute (`packages/scenarios/test/parameters.test.ts`), and the start of scenario 9 as a real test (`scenario9.test.ts`: parts a, i and k as far as point 1 reaches). The scenario uses English parameter names (`module` for `modul`, `backlash`, `centers`).

  **Review of point 1 (2026-11-14).** An independent review (another instance of the model, read-only) ran its own scripts against the commit, including a fuzz of about 1400 commands that checked after every command that the document validates, that its numbers equal the evaluated values, and that reload, undo and redo are exact. Document, recompute, cache and undo held. What it found and what changed:

  | Finding | Fix |
  |---|---|
  | A check that compares a non-finite number reported `ok` or `failed` (`1 / gap == 5` with `gap = 0` was `ok`: infinity equals anything within a relative tolerance) | Comparing a non-finite number is an error `notFinite` |
  | `&&` and `\|\|` short-circuited, so `w > 1 \|\| nope > 1` was `ok` with an unknown name | Both sides are always evaluated |
  | `r % 3 == 0` failed for `r = 0.3 / 0.1` although `r == 3` held | The remainder is 0 when the quotient is within the equality tolerance of an integer |
  | Deep nesting and a chain of thousands of parameters ran out of stack and escaped as an exception | Limits of 1000 characters and 100 levels; the parameter table is evaluated without recursion |
  | Not every parameter on a cycle got `cycle` (`a = b + c; b = a; c = a` gave `c` the error `dependsOnError`) | A parameter is on a cycle when it can be reached from itself |
  | The hint about a decimal comma was unreachable | Reported where the comma is left over |
  | App: a broken `extent/start` expression blocked the extrusion form, which has no input for it | See the next table, finding 1 |
  | App: an expression that is a bare number in an angle field read as radians but would be retyped as degrees | Such an expression is shown as the converted number |
  | `describe_api` printed `atan2(a, b)` next to a summary about `atan2(y, x)` | Functions carry their signature |

  The owner then supplied a review of the remaining plan from a weaker model. All five findings hold:

  | Finding | Resolution |
  |---|---|
  | 1. A form sends the whole feature in the input form, and every expression in a command is evaluated strictly; an unchanged expression that stopped evaluating blocks a change of another field | `updateFeature` treats a string equal to the field's existing expression as unchanged (kept, not evaluated). Single-field commands stay strict |
  | 2. Scenario 9 does not exercise the reason the tool recipe exists: every pattern goes around Z and every extrusion is along Z, so an implementation that only rotates the finished mesh would pass | Point 4 gets its own test: a pattern axis perpendicular to the extrusion, a target with different sizes along the directions, and material added between the source cut and the pattern |
  | 3. `get_sketch` returned one `expr` per constraint, but a fixed point will have two expressions | Expressions are listed by value name (`expressions: { value }`, later `{ x, y }`) |
  | 4. The tooth count has only a lower bound; a typo blocks the synchronous engine before any geometry error appears | Point 3: an upper bound for the tooth count in the catalog and a limit on the number of points of a generated profile (`invalidProfile`) |
  | 5. Names of reference dimensions in expressions need more than a wider name environment: a cycle can go through geometry | Recorded in backlog.md; D35 is not affected |

  What later points have to pick up:

  - Point 2: the field `extent/start` is in the catalog and the engine, the app has no input for it yet. A new variant of the extent needs its fields listed with `when`.
  - Point 3: the tooth count needs an upper bound and the generated profile a limit on its number of points. Generator parameters are numeric fields under `profile/params/<name>` with specs from the generator catalog; the reader takes a spec per call, so this needs no change to the reader. Expressions under a replaced variant are dropped by address prefix; a different generator must count as a different variant there.
  - Point 4: the count of copies is an `integer` field with an upper bound. A test must cover a pattern whose axis is perpendicular to the extrusion direction (through-all length per copy), with material added between the source feature and the pattern.
  - Point 6: `fixed` has the values `x` and `y`; `constraintPath(id, name)` already takes the value name, the dimension row in the app reads only `value`.
  - Names from the recompute (backlog): the check of a field expression at command time knows only the parameter table.

**2. Rozsah vysunutí.**

- **Začátek.** Rozsah se vzdáleností má posun začátku od roviny skici ve směru její normály (výchozí 0, smí být záporný); vzdálenost se měří od začátku. Jedna skica tak poslouží features v různých výškách: u kloubu vycházejí kola i čepy z jedné skici roztečných kružnic. Vysunutí na obě strany roviny je začátek `-t / 2` a vzdálenost `t`, zvláštní symetrický rozsah není potřeba. Víko `startCap` je víko na začátku; v rovině skici leží jen při nulovém posunu.
- **Víc cílů.** Výřez smí mít víc cílových těles (díra skrz dva sešroubované díly); přidání má právě jedno, jinak by tělesa splynula. Chybějící cíl je rozbitá reference. Výřez, který by některý cíl odebral celý, je chyba a nezmění žádný z cílů. Varování „bez účinku" vyjmenuje cíle, které výřez minul.
- „Skrz vše" je jen u výřezu a při víc cílech se bere rozsah všech cílů dohromady. Hloubka se při přepočtu určí z rozsahu cílového tělesa ve směru normály roviny skici (průmět vrcholů tělesa na normálu) a přidá se přesah, aby víko nástroje neleželo v rovině stěny tělesa.
- Strana: `forward` je ve směru normály roviny skici, `backward` proti ní, `both` na obě strany. U skici na stěně míří normála ven z tělesa, takže běžná díra je `backward`.
- Bere se rozsah celého tělesa, ne jen místa pod profilem.
- Délka se počítá při každém použití nástroje znovu, proti cíli ve stavu, ve kterém se nástroj používá, a ve směru, kterým nástroj právě míří. V poli tedy pro každou kopii zvlášť: po otočení kolem osy, která není rovnoběžná se směrem vysunutí, je těleso v novém směru jinak dlouhé, a mezi zdrojovým výřezem a polem mohl k tělesu přibýt materiál.
- Cíl, který leží celý na druhé straně roviny, se nezmění a varování „bez účinku" ho vyjmenuje. Přesah nástroje se odvozuje z rozměru cílů a musí být zřetelně nad rozlišením adaptéru jádra, jinak by ho adaptér vzal jako lícování.
- „Po stěnu" bude další varianta téhož pole; zatím se nedělá.

  **Status: done 2026-11-14.** The rules above are implemented as written; the description of the code is in architecture.md, section Extrude, Extent and targets. What the implementation settled:

  - **Applying a tool is a function over the recipe** (`applyTool` in `evaluate.ts`), not over the extrusion, as the generality check against the backlog asked. The recipe is `ToolRecipe { operation, targets, build(targets, firstFaceId) }`; the transform argument comes with point 4.
  - **Overshoot** of the through-all tool is `max(1 mm, 1 % of the largest absolute coordinate of the targets and of the origin of the sketch plane)`. The kernel adapter resolves about 1e-4 of the model size, so the overshoot is normally a hundred times that. Verified against the real adapter for a plate 500 and 800 mm from the sketch plane, a plate 0.1 mm thin and one 300 mm thick.
  - **The interval starts at the sketch plane** for `forward` and `backward`. A side on which no target reaches gets just the overshoot, so the tool misses and the feature reports `noEffect`.
  - **Through all without a cut is an invalid command**, also when it arises from `updateFeature` changing only the operation. The app therefore turns the extent back into a distance when the operation changes away from a cut.
  - **Several targets:** one tool, one boolean per target in the order of the list. A duplicate target is an invalid command. `emptyResult` names the target that would vanish and `brokenReference` the missing targets; in both cases no target changes. The `noEffect` warning lists the unchanged targets in `refs` and the feature is `warning` even if other targets were cut.
  - **`updateFeature`** needed no change: another `extent.type` replaces the extent and drops the expressions under `extent/`, the same type merges (only `side` changes), and a field of the other variant is an invalid command. Fixing one target does not trip over another broken one, because only references the feature did not have before are verified.
  - **MCP.** The conventions describe both extents and several targets. An error or a warning in the result of `execute`, `preview` and `get_model` now carries `refs` (the missed targets of a cut, the target that would vanish, the missing reference).
  - **App.** The extrusion form has the extent select, the start field, the side select and a checkbox list of targets for a cut (ui.md, Extrude).
  - **Tests.** `packages/engine/test/extent.test.ts` (validation and `updateFeature`), `packages/scenarios/test/extent.test.ts` (recompute against the real adapters) and scenario 9 grown by the plate, the sun flange and the housing with holes through all, one of them through two bodies.

  **Review of point 2 (2026-11-14).** An independent review (another instance of the model, read-only) probed the commit with its own tests against the real kernel and solver and drove the app in a browser. It found no defect in the engine, the validation or MCP: all three sides on the base planes, offset planes and a tilted face, bodies straddling or only touching the plane, targets up to 100 m apart, and undo, redo, save and load gave the same evaluation as a fresh engine. A random walk of 1500 sequences of form changes found one rejected state. What it found and what changed:

  | Finding | Fix |
  |---|---|
  | App: a cut with every target unticked, switched to an addition, kept an empty target list while the select showed a body; with one body the form was stuck | An addition with an empty list gets the last body |
  | App: the text of `noEffect`, `emptyResult` and `brokenReference` did not name the bodies, and a partial miss read as "nothing happened" in the error style | The app names the bodies from `refs`; a warning of the preview is shown as a warning; the engine's message for a partial miss says that only the targets in `refs` were missed |
  | App: switching the extent to through all and back lost the start, the distance and their expressions | The form remembers the last distance extent of the draft |
  | Tests covered through all only along +Z | Tests on the XZ and YZ planes, an offset XZ plane and a tilted face |
  | A kernel failure on one of several targets was untested | A test with the real kernel failing on the second boolean: no target changes |
  | MCP: `refs` on an error was untested | Tested for `brokenReference` |
  | Docs claimed the overshoot always exceeds the adapter resolution a hundred times; a sketch plane or a profile far from the targets makes the tool larger than the targets | The largest coordinate of the plane origin counts as well, and the sentence says what happens otherwise (the adapter treats the cap as flush, holes still go through) |

  Behaviour the review noted that predates the commit and stays: a cut identical to an existing hole reports `ok` (the tool's wall replaces the old one), so with several targets an already drilled target is not listed as unchanged; a model 300 m from the origin is beyond the float32 resolution of the kernel.

  What later points have to pick up:

  - Point 4: `build` gets the transform; the through-all span must then be measured along the transformed normal and from the transformed plane origin (`toolSpan` takes the frame). `applyTool` builds the tool once for all targets of a feature; a pattern calls it per copy.
  - Point 3: a generated profile only replaces the profile part of the step; extent, targets and `applyTool` stay as they are.

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

  **Status: done 2026-11-14.** The rules above are implemented as written; the description of the code is in architecture.md, section Extrude, Profile generators. What the implementation settled or changed:

  - **Catalog** `GENERATORS` (`generators.ts`) with one entry, `involuteGear`. A parameter is a number (`NumberSpec`) or a flag. Options from a list and text are not implemented because no generator needs them; the document type already allows a string in `params`, so they stay an addition without a change of the document shape. A reference of the catalog has a title and a summary; none is required.
  - **Ranges.** `teeth` is an integer from 4 to 500 (the upper bound keeps a typo from blocking the synchronous engine), `pressureAngle` lies in (0, π/2), `backlash` is not negative. A generated profile above 50 000 points is `invalidProfile`. Numbers the ranges allow can still fail in the generator (a pointed tooth, teeth that overlap at the root); the error then carries the generator's own message, not the general text about sketch curves.
  - **References in the registry.** `FeatureRef` got two kinds: `entity` (an operand: an entity of a given sketch with accepted kinds) and `generated` (an earlier extrusion with an accepted generator). They go through the same rule as every reference: a command verifies those the feature did not have before, loading only the shape, and `moveFeature` respects `meshWith`.
  - **Merging.** A variant is told by `type` and `generator`. Dictionaries merge by entry; `null` removes an entry, and removing one that is not there is not an error (a form sends `refs: { meshWith: null }` whether the feature had the reference or not).
  - **Third kind of face.** The side of a generated profile is a general surface swept along the extrusion axis: not planar (`nonPlanarFace` for a sketch on it), and its edges with the caps are of the kind `other`, so they cannot be projected as a circle.
  - **The ring tool lies outside the exact shape.** Its flank is moved outwards by the largest deviation of its chords (see the review below): a curve parallel to an involute is the same involute turned by distance / base radius, so the offset is a rotation of the flank. Its arcs are made of tangents. The planar measurement that gave an overlap of 0.006 mm in the spike gives less than 1e-9 mm now, for all three trains of the scenario.
  - **Mesh.** The facts of a gear are in model coordinates (`center`, `axis`, `toothDirection`), so the reference works between sketches in parallel planes, also when one looks at the plane from the other side. Either gear of an internal pair may be the one that refers (a planet placed into an existing ring). Tolerances: modules relative 1e-6, pressure angles 1e-9, tangency 1e-6 of the size, axes within the angular tolerance of the engine. `gearInterference` is judged only when the mesh holds.
  - **Facts** also list `baseDiameter`, `backlash`, `meshed` (whether the rotation came from the reference) and the placement in the model. A feature in error or suppressed publishes none; a gear that refers to it gets `gearMesh` and keeps building with its own rotation, so a broken mate does not take the whole train down.
  - **MCP.** `describe_api` has a section Profile generators built from the catalog, with an example the engine accepts; `get_model` returns `facts`; the conventions say how to build gears. Generator warnings show up in `problems` like every other warning.
  - **App.** The extrusion form has a profile select and, for a generator, a form built from the catalog (ui.md, Extrude).
  - **Time.** The joint as far as it is built (four bodies, the ring cut through all, three through holes) recomputes after a parameter change in 0.5 to 0.65 s on the development machine; the spike estimated about 1 s for the housing alone.
  - **Tests.** `packages/engine/test/gear.test.ts` (the generator as a pure function: dimensions, backlash, contact of the flanks while turning, mesh rules), `generated.test.ts` (validation, `updateFeature`), `packages/scenarios/test/gear.test.ts` (recompute against the real adapters, overlap of the bodies by the kernel) and scenario 9 grown by the sun teeth, a planet and the ring gear, with the change of the ratio to 4 and to 6.

  **Review of point 3 (2026-11-14).** An independent review (another instance of the model, read-only) re-derived the tooth geometry, the mesh rotation and the interference limit, built 1269 gears through the real kernel, turned pairs through 600 poses and drove the app in a browser. It found no defect that gives wrong geometry beyond microns, a crash or a loss of data. What it found and what changed:

  | Finding | Fix |
  |---|---|
  | The ring tool was not outside the exact shape everywhere: the offset of the flank was the distance at the middle of each chord, but the curvature of an involute changes along the chord, so the exact flank stuck out by up to 1e-4 mm between vertices and a planet could enter the ring by microns (60/33 teeth). The arcs of the tool were chords inside their circles | The offset is the largest distance of the flank from its chords, found by a search, with a margin. The arcs of the tool are made of tangents. A test samples the exact boundary of the tool densely |
  | `updateFeature` accepted `null` for any name: `params: { rotaton: null }` reported success and reset nothing | `null` may name what the feature has, an optional field, or an entry the generator catalog knows; anything else is "no such field" |
  | The limit of 50 000 points was checked after the loop was built (hundreds of megabytes for a tiny chord tolerance in a loaded document), and the arc rule had no cap | The gear computes its size first and refuses before building; an arc has at most 4096 chords, as in a sketch |
  | A tooth exactly at the pointed or the overlap limit passed with edges of zero length | Tip width and root gap are compared as lengths with the length tolerance |
  | App: switching the profile to regions and back reset every input of the generator | The form remembers the profile of each kind while the sketch stays the same |
  | `gearMesh` said "missing, suppressed or in error" for a healthy feature that is not a gear | The message names that case too |
  | A profile with fields of the other variant was accepted and the fields dropped (regions with gear parameters became plain regions) | A field the variant does not have is an invalid command, on creation and on loading |
  | Missing tests | Mirrored planes through the engine, a loaded document whose operand is not a circle, a mate that is not a gear, a chain through a gear with a warning, `noEffect` together with `gearMesh`, a repeated expression of a generator parameter |

  Limits the review confirmed and that stay: `gearInterference` does not cover an internal pair with a small difference of tooth counts (the interference query of point 5 finds those), and at the default chord tolerance a marginal interference can hide in the slack of the chords, so the warning is the only signal there.

  What later points have to pick up:

  - Point 4: a pattern of a body copies the planet with its faces; the facts of a copy are not published (only the source feature has them). A pattern of features repeats a gear tool through the same recipe as any other tool.
  - Point 5: the scenario test measures overlap through the kernel directly; `interference` replaces that.

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

  **Status: done 2026-11-14.** The rules above are implemented as written; the description of the code is in architecture.md, section Pattern. What the implementation settled or changed:

  - **The tool is built in the place of the copy, not moved there.** `ToolRecipe.build(targets, firstFaceId, placement?)` transforms the frame of the sketch plane and builds the prism in it. A finished mesh that is only turned would keep the length measured for the original; "through all" has to be measured along the direction the copy points in and against the targets as they are at the pattern. The dedicated test turns a hole by 90° around an axis perpendicular to the extrusion: the copy passes 55 mm of a body whose original hole passed 30 mm, including a boss added between the hole and the pattern.
  - **`applyTool` is a function of a model.** It takes bodies and the face table and returns the changed ones with the targets left unchanged, or a failure. The extrusion turns that into its result; the pattern chains the applications and throws the chain away when one fails, which is what makes it atomic.
  - **Count** has the upper bound 200 (`MAX_PATTERN_COUNT`); the **angle** lies in [−2π, 2π] and is not zero, so an angle typed in degrees by mistake is an invalid command. With an angle the step is `angle / (count − 1)`; the count 1 creates no copy and ignores the span.
  - **Issues.** A failed copy: the code of the failure and `refs` starting with `{ copy, feature }` (the message named the copy too until the review below). Copies without effect: one warning `noEffect` with `refs` of the shape `{ copy, feature, targets }`. A missing source or axis is `brokenReference` with its ID.
  - **A copy onto the original** (an angle of a full turn, an axis the source lies on) was first not reported as `noEffect`: the cut removes nothing, but the faces of the hole were taken over by the later tool, exactly as when an extrusion repeats a cut. The review below changed it: such a copy has no effect.
  - **References in the registry.** Two more kinds of `FeatureRef`: `tool` (an extrusion with the operation add or cut) and `pattern` (the pattern a face of a copy names). The axis through a sketch point is a `sketch` reference and an `entity` reference with the kind `point`. `FEATURE_TYPE_INFO[type].bodies` has the third value `derived`.
  - **`FeatureResult.bodies`** is filled for every feature: an extrusion with the operation `new` lists its own body, a pattern of a body its copies, everything else an empty list.
  - **Face names.** `faceName()` keeps `copy`, rejects a number of a copy that is not an integer from 1 and drops an empty list. The key used for comparing appends `/@<pattern>:<index>`.
  - **Rigid transforms** (`RigidTransform` in `solid.ts`): `transformSolid` covers a mirror already, it reverses the triangles when the determinant is negative. The tool recipe does not: `buildPrism` in a mirrored frame gives a prism turned inside out, so a mirror pattern of features will have to flip the winding there. No feature produces a mirror yet.
  - **MCP.** `get_model` returns the source and transform of a pattern and `bodies` of every feature that created some; `get_body` takes a derived ID and labels faces of copies `<name>@<pattern>:<number>`; the conventions of `describe_api` describe the pattern, derived IDs and copy tags.
  - **App.** The form is described in ui.md, section Pattern. The app no longer takes a body ID for a feature ID: names and hiding go through `bodyOwner`.
  - **Time.** The joint with the patterns (seven bodies, 4 + 4 + 6 repeated holes, two copies of the planet, three carrier pins) recomputes after a parameter change in 0.9 to 1.4 s on the development machine.
  - **Tests.** `packages/engine/test/pattern.test.ts` (validation, merging, derived body IDs, copy tags, rigid transforms), `packages/scenarios/test/pattern.test.ts` (recompute against the real adapters: counts and angles, the axis through a sketch point, the perpendicular through-all test, several sources, copies that miss or fail, bodies and patterns of patterns), scenario 9 grown by the four patterns of holes, the copies of the planet and the carrier with its pins, an MCP test and a test of the form logic in the app.

  **Review of point 4 (2026-11-14).** An independent review (another instance of the model, read-only) probed the recompute with throw-away scenarios against the real kernel and solver, loaded 43 malformed documents, swept the counts 2 to 48 on three geometries and drove the app and the MCP tools. It found no crash and no wrong geometry in the engine. What it found and what changed:

  | Finding | Fix |
  |---|---|
  | Some counts took a minute: 25 holes in a disc of radius 100 took 60 s where 24 or 26 took 1 s (one count in 47 on two of three geometries). The mesh cleanup of the kernel adapter alternated between two states, a split of a T-junction and the dropping of the piece the split left, and ran all its 1000 passes for every boolean. The code is older than point 4; the pattern is what reaches it | The cleanup remembers the states it has split and stops after splitting one for the second time (see the second review below for what state that is). 25 holes take 1.4 s. A scenario test compares the count with its neighbour |
  | A pattern of features is slow at high counts even so: 10 s for 100 holes and 32 s for 200, because every copy is a boolean on the body grown so far. The form previewed on every keystroke, so typing 200 ran three previews | A preview that took more than 150 ms is recomputed only after a pause in typing (ui.md, Pattern). The quadratic time stays and is written down in architecture.md and in `describe_api`; joining the copies of one cut into a single boolean per target would remove it and is left for later, because it changes how a copy without effect and a failed copy are told apart |
  | A cut copy that lands on the original (5 copies over 360°) was `ok` without a warning and took most of the faces of the original hole over, so a later sketch on its rim lost its reference; the same case with `add` was `noEffect` | A cut copy whose tool lies on what is cut already has no effect (first by the volume alone, after the second review by the volume and the faces of the tool). The copy is listed in the warning and the hole keeps its faces |
  | A failed copy was named twice in the app, once by the raw ID from the message of the engine and once from `refs`; `kernelFailure` showed the raw ID only | The message of the engine no longer names the copy; `refs` do. The app names it once, for every issue (`issue-text.ts`, with tests) |
  | The sense of rotation was written nowhere a client reads, and no test told the two senses apart for an axis through a sketch point | One sentence in architecture.md and in `describe_api`; a test with a quarter turn around the three base axes, sketches on XY, XZ and YZ and a sketch on a face |
  | The form listed new bodies by raw ID, and the plane form named a base face without its body or copy | Both use the names used everywhere else |
  | `get_body` sometimes returned a circular edge without `center` and `radius`, or with an imprecise radius: the three points for the centre were picked by position in a list of segments that has no order | The three points are the first vertex, the one farthest from it and the one farthest from the line through the two. Older than point 4; faces of copies hit it readily |
  | `addFeature` dropped fields of the other variant in `source`, `span` and `axis` silently, while `updateFeature` rejected them | Such a field is an invalid command, on creation and on loading |
  | Texts in the app: an angle out of range typed in degrees was reported in radians, a missing source read `((hole2))`, a missing derived point would read `(x1) / center` | The form checks a typed angle itself and reports it in degrees; a reference the document does not know is shown as its ID |
  | Documentation behind the code: the `Feature` union, derived body IDs "prepared for" patterns, the `updateFeature` rules without the pattern, the mirror claim, the copy onto the original, "copies that change none of their targets" | Corrected |
  | Missing tests | The count that looped, the sense of rotation, a gear pocket and a gear boss repeated by a pattern of features, a copy of an addition onto the original, five copies over 360°, the face table and the solids after a failed pattern, `getState(at)` and `preview` with a pattern, fields of another variant, circular edges of copies in `get_body`, the texts of issues |

  Not done: a time bound for a pattern at a high count (the time is quadratic, see above), and tests of the pattern highlight and of hiding copies, which live in `app.ts` without a seam for a test.

  **Second review, of the fixes (2026-11-14).** The owner asked for another round after a review with many findings or a complex fix. A second reviewer went through the fix commit with the real kernel (8 geometries at counts 2 to 64, 6000 fuzz seeds for the cleanup). The fixes held; what it added:

  | Finding | Fix |
  |---|---|
  | The new rule "a copy has no effect whenever the volume stays" dropped real cuts: a copy that clips a corner of a 100 × 100 × 10 plate by a triangle with legs of 0.05 to 0.13 mm removes less than the tolerance of the volume comparison (a millionth of the smaller body, 0.1 mm³ here) and was reported as `noEffect` | A cut copy has no effect when the volume stays and every face of its tool in the result lies on the surface the target had; the test is by the centroids of the triangles, because the kernel may add vertices on an edge without changing the shape |
  | `get_body`: the centre of an arc (a hole cut short by another face) was still off, by up to 1 mm for a hole of radius 50 that nicks a corner: the ends of an arc lie on a chord of the polygon | The three points are chosen among the vertices shared by two segments when there are at least three |
  | The texts on the cleanup said more than the code guarantees: the cycle has two to four states, the state it stops in differs from the old result in a few triangles, and a cycle without a closed state still ends in `kernelFailure` (after 5 passes instead of 1000) | Reworded in the code, architecture.md and here |
  | App: confirming an edit of a slow pattern computed it three times (preview, command, the same preview again from the refresh) | The refresh during a confirmation skips the preview |
  | App: the cost of the last preview stayed when a form had nothing to compute, so the next form waited for a pause without reason | The cost is reset when nothing is computed |
  | A key with the value `undefined` counted as a field of another variant | Skipped |

  It also found that the review worktrees resolved the workspace packages through symlinks into the main tree; the later reviews run with their own copies.

  What later points have to pick up:

  - Point 5: `interference` should take the derived IDs from `FeatureResult.bodies`; export per body needs a file name for `planets/1`.
  - Point 7: the pattern `bolts` of the scenario repeats only the hole; the nut pocket joins it once the polygon tool exists.

**5. Export po tělesech a dotazy nad tělesy.**

- `exportMesh` dostane volitelný seznam těles (dnes exportuje vždy celý model).
- Kontrola kolizí je dotaz enginu nad vybranými tělesy nebo nad všemi: vrací dvojice s objemem průniku nad prahem. Operaci `intersection` port jádra už má; záruku pro lícující stěny u ní adaptér neplní, ve spiku ale lícující víka, čep v díře i shodné válce daly objem přesně nula. Práh je 0,001 mm³: šum vyšel nulový, kola se zápornou vůlí 0,05 mm dala 0,5 až 1,7 mm³. Průnik může v adaptéru selhat (výsledek se čistí a kontroluje); dotaz proto vrací vedle prolínajících se dvojic i dvojice, které se nepodařilo spočítat. Text záruky portu jádra se s tím upraví: průnik engine nově používá.
- Objem a obálka tělesa jsou součástí popisu tělesa; AI jimi ověřuje, co postavila.
- V aplikaci tlačítko, které vypíše kolidující dvojice; v MCP nástroj.
- Otevřené pro později: sestava by stála nad tělesy dokumentu a odkazovala se na jejich ID. Proto mají kopie těles stabilní odvozená ID.

  **Status: done 2026-11-14.** The rules above are implemented as written; the description of the code is in architecture.md, section API enginu, Bodies. What the implementation settled or changed:

  - **`interference` is a query of the engine, not a command.** It reads the state (also the state after a feature, `at`) and returns pairs above the threshold, pairs that failed and the number of pairs examined. Wrong input (an unknown body, a negative threshold) throws, as `getState` does for an unknown feature.
  - **Pairs are remembered by the identity of the meshes.** The joint of the scenario (eight bodies, 28 pairs) takes about 0.1 s the first time and nothing when repeated; after a change only pairs with a rebuilt body are computed. Boxes that do not overlap never reach the kernel.
  - **Flush faces through the real kernel.** Bodies lying on each other, a pin in the hole cut by its own circle, a body nested in another and identical bodies behave as the spike measured: zero for the first two, the whole volume for the others. (A pin whose polygon is turned differently from the hole is another matter, see the review below.) No pair of the joint fails. The absolute value of the volume is taken, so a sliver left inside out cannot hide a collision.
  - **Volume and bounds** are fields of `BodyResult`, computed with the faces and edges of the body. MCP reads them from there instead of computing its own.
  - **Export.** `exportMesh('stl', bodies)` keeps the order of the list and writes a body listed twice once. The file name of a body is `bodyFileName(id)` in the engine, because the server and the app both need it.
  - **MCP.** `check_interference` is new. `export_stl` takes `bodies` and `perBody`; its result is now `{ files: [{ path, bodies, triangles, bytes }] }` in both modes. Per body it writes nothing if a file exists or two names differ only in the case of letters. The option `overwrite` was added: without it a second export after a change of the model would need a new directory every time. One file with an explicit path is overwritten as before, because the caller named it.
  - **App.** A button *Collisions* with the pairs in the model panel and a highlight of the picked pair; volume, size and an export link for every body of a selected feature and for the body of a selected face (ui.md, Bodies).
  - **Tests.** `packages/scenarios/test/bodies.test.ts` (volume and bounds, export of chosen bodies, the query with flush faces, nesting, thresholds, `at`, copies, a failing kernel and the memory of pairs), scenario 9 parts h, j and k (the motor body, no collisions in the joint, the deliberately oversized planet reported with every copy, one STL per body), MCP tests of `check_interference` and of the export per body on disk.

  What later points have to pick up: nothing; the scenario test no longer calls the kernel directly.

  **Review of point 5 (2026-11-14).** An independent review (another instance of the model, read-only) probed the query through the real kernel (stacked, nested, tangent and identical bodies, flush wedges of patterns, thresholds, `at`), the export on disk with odd names, the tools over the bridge and the app in a browser. It found no crash and no loss of data in the main paths. What it found and what changed:

  | Finding | Fix |
  |---|---|
  | A pin in a hole of the same diameter was reported as a collision whenever the two circles were faceted in different phases: a pin drawn on a plane looking the other way, or a copy turned by a pattern (0.6 mm³ for radius 4 and length 10, 600 times the threshold). The docs and the tool description promised that such a fit is not reported; that held only for identical vertices | Every pair has a `depth`, the mean thickness of the shared volume. A pair no deeper than the chord tolerance of the document goes to the new list `fits`, the others stay in `pairs`. The app and `check_interference` show both; the texts say what a fit is and that a real overlap that thin cannot be told from one |
  | Export per body could leave some files written when a later one failed (a name over 255 bytes), although "nothing is written unless every file can be written" was documented; with `overwrite` a failure left a mix of new and old files | Names over 255 bytes and targets that are not files are refused before anything is written; the files are written under temporary names and renamed once all are on disk, and the temporary files are removed after a failure |
  | The threshold is not the only floor: the kernel welds away an overlap thinner than about a millionth of the model size (two plates 300 mm wide overlapping by 0.0005 mm share 45 mm³ and are clear) | Written into architecture.md and the tool description |
  | `threshold: 0` over MCP returned pairs with `volume: 0` (noise rounded to six decimal places) | Volumes are rounded to six significant digits; the schema says that zero reports noise |
  | Arguments were not checked against the published schema: `perBody: "true"` wrote one file, `perbody` and `body` were ignored (the latter checked all bodies) | Every public tool refuses an argument its schema does not have and a value of another type (`argumentProblem`) |
  | `export_stl` with an empty list said the model has no body; `check_interference` with one body returned an empty answer that reads as "no collisions" | An empty list and a list with fewer than two different bodies are errors that say what to do; a model with fewer than two bodies gets a note |
  | App: the status bar kept "Collisions: 2 pair(s)" after the document changed | The note goes with the answer |
  | A test said "identical bodies share everything" and asserted flush faces | The test now checks a body against the same body without its hole and two identical bodies |
  | Missing tests | A fit with different phases and a pin thicker than the tolerance, a failure before and during an export per body, arguments outside the schema, the body tools over the bridge |

  Left as they are: file names a system reserves (`CON` on Windows) are not escaped; integer-like body IDs (`9`, `10`) are listed before the others by the order of object keys, which also sets the order of pairs (older than this point); the collision panel of the app has no automated test.

  **Second review of point 5 (2026-11-14),** of the fixes above. It ran the query on the real kernel (pins with keys, shafts with collars, flush blocks with ribs, jammed gears, other chord tolerances) and the export on disk, with mutations of the tests. Two of the fixes had introduced regressions:

  | Finding | Fix |
  |---|---|
  | The depth as a mean thickness (twice the volume over the surface) hid real collisions as fits. The kernel leaves sheets without thickness in an intersection where faces of the two bodies coincide, and they counted into the surface: a key of 1 mm³ on a pin in its own hole, a rib between flush blocks, a pin 0.2 mm into the floor of its hole all came out thinner than the tolerance. The slivers of a fit diluted a real chunk on a turned copy the same way | The depth is how far one body reaches into the other, measured point by point on the surface of what they share (`penetration`); a sheet lies on both surfaces and gives zero. The mean thickness stays as the second measure for a volume whose surfaces coincide all around (identical bodies), with the sheets left out of its surface. Tested on the cases of the review |
  | A fit could be an overlap no polygon explains: two planar plates overlapping by less than a coarse tolerance, an overlap along an edge | A fit needs a face that is not planar in what the two bodies share; planar bodies collide however shallow. An overlap along an edge shows with its real depth (the middles of edges are measured too) |
  | Two exports per body at once into one directory wrote the mesh of one body under the name of another: the temporary names were the same for every call of the process | A new directory for every call (`mkdtemp`) inside the target; exports run one after another |
  | A failure while the files were renamed left a part of the set and the message said the unfinished files were removed; a path too long for the final name only showed there | The files are written under their final names inside the directory of the call, so a name or a path the system refuses fails before anything is moved. If a move fails, the new files that replaced nothing are removed and the replaced ones are named |
  | Tests that did not test what they claimed: the failure while writing passed with the old code and depended on file permissions (root, Windows); a threshold test had no tiny pair; a comment announced a finer tolerance that was never set; scenario 9 did not look at the fits | Failures are injected into the file operations of the server (the second write, the second and third move); a pair of 4e-7 mm³ over MCP; a document loaded with another tolerance; `fits` empty in scenario 9 |
  | A call with an argument outside the schema cancelled the user's operation in progress in the app and was refused only then | The bridge client asks the tools first; a refused call does not reach `beforeCall` |
  | Smaller: a file of the user named like a temporary file was overwritten; a failing cleanup replaced the original error; `perBody` with the path of an existing file gave a raw system error; `save_document({ path: null })` was refused; the note of a collision check stayed in the status bar after the marker moved; "a object"; the answer of `check_interference` did not say by which tolerance fits were judged | All fixed; the answer has `tolerance` |

  What stays true and is documented: a real overlap of round faces shallower than the chord tolerance is a fit (jammed gears whose flanks overlap by less than the tolerance, a pin thicker than its hole by less than the tolerance when its polygon is turned the same way). The depth is measured at the vertices, the middles of edges and the centroids of the triangles of the shared mesh, so on a coarse mesh it can come out a little under the true value.

  **Third review of point 5 (2026-11-14 to 15),** of the new depth and of the export, because the second fix replaced a measure that had failed. The reviewing agent was cut off by lost connections three times; its notes were kept in a file and the open points were finished by the author with the reviewer's probes (a sweep of pins in holes over radii, lengths, turns and tolerances; shallow planar overlaps; lumps beside slivers). What it found:

  | Finding | Fix |
  |---|---|
  | Legitimate fits came out as collisions for some turns of a copy (pins of radius 25 turned by 1.234 rad: depth 0.039 at a tolerance of 0.01; pins far from the origin). The polygons nearly coincided there, the slivers were thinner than the precision of a depth, and the search for sheets took their faces for sheets: the volume was left with next to no surface and a mean thickness forty times too large | Sheets are looked for within a thousandth of that precision (their two sides have the same coordinates). Unit tests of the measures on meshes written by hand, and the case in the scenario test |
  | A shallow overlap of planar faces passed as a fit whenever the shared mesh had any round triangle: a disc 0.005 mm inside the top of a plate, a pin 0.005 mm too long for its blind hole, two plates overlapping by 0.005 mm with one hole through both | The depth has a planar part: the points of a planar face measured against a planar face of the other body. A fit must not have one |
  | A cube of 1 mm³ that both bodies had at the same place hid behind the slivers of a long fit: its surfaces coincide, so nothing reaches into anything, and the mean thickness was taken over the whole shared mesh | The mean thickness is taken for each connected piece and the thickest one counts |
  | Flush planar faces of turned copies of a large body (a ring of wedges 3000 mm across) were collisions of 0.5 mm³ at a depth of 0.00001 mm: planar pairs collide however shallow, so noise did too | A shared volume no deeper than the precision of the coordinates is not a pair |
  | One point that is not a number (a degenerate triangle) set the whole measure to zero | Such a point is left out |
  | Export: a directory of the call that could not be removed was hidden; directories created for an export that failed stayed; the staging path is 23 characters longer than the final one | The answer names a directory it could not remove; created directories are removed after a failure; the length is documented |
  | Tests: nothing covered the search for sheets, the centroids, the slack or the fall-back to the whole surface | Unit tests in `packages/engine/test/solid-depth.test.ts` |

  Left as they are: two identical round bodies thinner than the chord tolerance are a fit (their mean thickness is under the tolerance and a round face is there); the measure is brute force over the points and the nearby triangles, about two seconds for one pair at a chord tolerance of 0.0001; an export waiting for an app that does not answer holds the queue of exports for the 30 seconds of the bridge timeout.

  **Fourth review of point 5 (2026-11-15),** of the rule of the third fix only (collision, fit or not reported), by another instance of the model, read-only, with probes against the real kernel. The checks of the third round were repeated and held: a pin too thick for its hole, a key in the wall of a bore, a splined shaft in its hub, small planar overlaps, fits at tolerances from 0.0005 to 0.1.

  | Finding | Fix |
  |---|---|
  | Serious: a turned pin that ends on a planar face of the other body was a collision at every tolerance: seated on the floor of a blind hole, with a collar on the plate, with a head in a counterbore, also drawn on a plane that looks the other way. The end of a sliver is a point of the cap of the pin inside the plate, as near to the floor as to the wall of the hole, and the tie went to the planar face. The planar condition of the third fix caused it | A point of a planar face does not count for the planar part of the depth when a round face of the body it is in lies within the tolerance (`excuse` of `penetration`) |
  | A pin standing out of its through hole by less than the sagitta, or as much below the top, was a collision (0.003 mm; at 0.02 a fit) | The same rule covers it |
  | `pieces` joined pieces that touch at one vertex, so a lump touching the slivers was thinned out again | Pieces are joined by shared edges |
  | An intersection with a coordinate that is not a number had a volume that compares false with the threshold: the pair was clear | Such a pair is in `failed` |
  | Docs: the floor of the kernel for planar faces is two millionths of the largest coordinate, not one of "the size"; a fit may be deeper than the tolerance by the precision; two round faces bulging towards each other overlap by up to twice the tolerance before they collide; the kernel fails far from the origin also at the default tolerance | Said in architecture.md, in the comment of `InterferenceReport` and in the description of `check_interference` |

  Left as it is: an overlap of planar faces lying wholly within the tolerance of a round face (a lip narrower than about twice the tolerance) is now a fit.

**6. Vazby.** Stejný poloměr a pevný bod se přidávají podle D34 (typ, katalog, rovnice rozboru, překlad pro solver).

- Stejný poloměr: planegcs má vazby `equal_radius_cc`, `equal_radius_ca` a `equal_radius_aa` (nalezeno v typech knihovny 1.3.0, nespuštěno).
- Pevný bod je vazba se souřadnicemi: `{ type: 'fixed'; point: Id; x: number; y: number }`. V rozboru volnosti jsou to dvě rovnice nad běžným proměnným bodem (`x − x0 = 0`, `y − y0 = 0`), pro solver se překládá na `coordinate_x` a `coordinate_y` (planegcs je má). Diagnostika, vysvětlení nadbytečných vazeb i konflikt s kótou tak fungují jako u ostatních vazeb.
- Souřadnice jsou číselná pole katalogu, mohou tedy být výraz a pevný bod se může hýbat s parametry. Příkaz bez souřadnic doplní současnou polohu bodu.
- Katalog vazeb dnes počítá s jednou hodnotou na vazbu; dvě hodnoty jsou jeho rozšíření.
- Zamítnuto: seznam pevných entit, který solver dostává pro počátek a promítnutou geometrii (první návrh). Bod z tohoto seznamu rozbor volnosti vynechává z proměnných, takže vazba na něm by neměla žádnou rovnici a diagnostika by ji neuměla vysvětlit ani ohlásit konflikt s kótou. Seznam zůstává jen pro počátek a promítnutou geometrii.

  **Status: done 2026-11-14.** The rules above are implemented as written; the description of the code is in architecture.md (the constraint types, Diagnostika skici, the solver adapter). What the implementation settled or changed:

  - **The library has the constraints** and they behave as expected: `equal_radius_cc`, `equal_radius_ca` (circle first) and `equal_radius_aa`, `coordinate_x` and `coordinate_y`. A fixed point is two constraints of the library; the second one carries a derived ID and the adapter maps it back, so a conflict or a redundancy names the constraint once.
  - **The equations of the analysis.** `fixed` is measured from the origin of the sketch, because the analysis evaluates positions relative to a local point to keep small shapes far from the origin precise. The complete table of the analysis against the solver covers both constraints: circle with circle and with an arc in both orders in the table, two arcs in a case of their own.
  - **The catalog** got named values for a constraint that is not a dimension (`values: { x, y }` without the flag `dimension`). Validation reads them through the same reader of numeric fields, so `fieldsOf`, `setField`, expressions, `renameParameter` and the API description took them over without code of their own. `setConstraintValue` stays for dimensions.
  - **A coordinate left out** in `addConstraint` (`FixedInput`) is filled in from the position the document has for the point. `null` is rejected: only a missing coordinate is filled in. A loaded document must have both.
  - **What a fixed point refuses:** the origin and points of projected geometry (they are fixed already and the constraint would never show), a second `fixed` on the same point (a duplicate, whatever the coordinates), a curve as its operand.
  - **A known limit of the library, not new:** a point held by a horizontal distance, a vertical distance of zero and a plain distance of the same length is reported as a conflict although the three agree (found while testing a fixed point with the same dimensions). Such a sketch shows `sketchConflict`; removing one of the three dimensions resolves it. A fixed point with a distance that agrees does not have the problem: the point starts at its coordinates (see the review below).
  - **MCP.** `get_sketch` lists the expressions of a fixed point as `expressions: { x, y }` (prepared in point 1); `describe_api` lists the named values of the constraint, the two numeric fields and a convention on fixing a point and sharing one diameter.
  - **App.** Buttons for both constraints come from the catalog; *Fixed point* fixes every selected own point where it is. The row of a constraint with named values has a field for each (ui.md, Skica: vazby a kóty).
  - **Scenario 9** got the six holes of the controller as the contract has them: three centres fixed at the coordinates of the drawing, three mirrored about a construction axis whose end is a fixed point, one diameter shared by equal radii. The sketch is fully determined with nothing redundant.
  - **Tests.** `packages/solver-planegcs/test/solver.test.ts` (both constraints in the solver: every combination of circle and arc, chains, conflicts and redundancy by ID, dragging a fixed point), `packages/engine/test/parameters.test.ts` (validation, expressions, `setField`, what is refused, save and load), `packages/scenarios/test/analysis.test.ts` (the table of equations), `packages/scenarios/test/constraints.test.ts` (a plate with holes at coordinates that follow a parameter, diagnosis and explanations, conflicts), an MCP test, an app test of what the buttons offer, and scenario 9.

  **Review of point 6 (2026-11-14).** An independent review (another instance of the model, read-only) probed both constraints in the solver adapter (every pair of circle and arc, chains and cycles, conflicts and redundancy on one coordinate, dragging), the analysis against the solver, validation and expressions in the document, recompute through parameters and undo, the app in a browser and the MCP description. It found no wrong geometry and no difference after save and load. What it found and what was done:

  | Finding | Fix |
  |---|---|
  | Dragging moved the sketch wrongly next to a fixed point whose one coordinate repeated another constraint (a point fixed on a horizontal line from the origin): the library calls one coordinate redundant, the adapter took that for the whole constraint and dropped both coordinates for the drag, so the fixed point came loose during the pass. Whether it happened depended on the order of the IDs | The drag leaves out the redundant constraints of the library one by one: of a fixed point only the coordinate named. Tested in both orders of the IDs |
  | A fixed point and a distance that agrees with it, sent in one batch with a rough estimate, came out as a conflict (the limit of the library below, reached from the estimate) | A point with a `fixed` constraint starts at its coordinates in the solver. The sentence about this combination here was wrong for a point on the axis and is corrected |
  | `fixed` without coordinates on the origin or on a projected point complained about a missing number and not about the point | The check of fixed operands runs before the values are read; the catalog and the MCP convention say "an own point" |
  | "Fixed where it is" inside a batch means the estimate of `addPoint`, which the texts did not say | Said in architecture.md, in the comment and in the MCP convention, with the advice to give such a point its coordinates |
  | The warning about a broken expression of a coordinate said "the dimension keeps its last valid value"; the summary of the constraint, which is also the tooltip of the button in the app, talked about commands | "The field keeps…"; the sentence about commands moved to the MCP convention |
  | The doc claimed the analysis table covers every pair of circle and arc, the test had no two arcs | A case for two arcs added; the sentence corrected |
  | Missing tests | The drag in both ID orders, the agreeing distance from a rough estimate (solver and engine), `fixed` without coordinates in a batch and on the origin and a projected point, equal radius with a projected circle, a parameter of a coordinate that disappears, a loaded document with two `fixed` on one point, the input form of a sketch with fixed points added again |

  Left as it is: the list `redundant` of the solver result may name the fixed point where the diagnosis names the other constraint (nothing reads the solver's list; the app and MCP use the diagnosis); the row with the fields X and Y in the app has no automated test.

  What point 7 has to pick up: nothing from this point.

**7. Nástroje skici.** Sdílený modul čistých funkcí, které z několika údajů složí dávku příkazů. Aplikace je volá ze svých nástrojů, MCP je nabízí jako nástroj s popisem generovaným ze seznamu funkcí. Engine se nemění. AI tak neskládá desítky příkazů podle textového receptu a každý další nástroj je hned na obou místech. Do modulu se přesune stávající obdélník; nový je pravidelný mnohoúhelník. Kde modul leží (balíček enginu, nebo vlastní), se určí při implementaci.

- Mnohoúhelník: konstrukční opsaná kružnice, vrcholy na ní (`pointOnCurve`) a shodné délky stran.
- Zbývající volnost jsou čtyři stupně: střed, velikost, natočení.
- Velikost se kótuje průměrem opsané kružnice, nebo u sudého počtu stran rozměrem přes plochy (kóta bod–úsečka mezi vrcholem a protější stranou), což je u matice rozměr klíče.
- Zvažováno: vepsaná kružnice s tečnými stranami (její průměr by byl přímo rozměr přes plochy). Zamítnuto: tečný mnohoúhelník se shodnými stranami nemusí být pravidelný (kosočtverec).
- Zapuštění matice je pak šestiúhelník a výřez do hloubky; nic dalšího nepotřebuje.

  **Status: done 2026-11-14.** The rules above are implemented as written; the description of the code is in architecture.md, section Sketch tools. What the implementation settled or changed:

  - **The module lives in the engine package** (`packages/engine/src/sketch-tools.ts`). The tools work only with types of the engine and return commands; the engine package has no dependency and both the app and MCP depend on it already. A package of its own would add a boundary and nothing else. The engine's behaviour did not change: the tools are functions beside it, not commands.
  - **The catalog `SKETCH_TOOLS`** describes the inputs (anchor, number with its range, option; optional or not) and the lists of IDs a tool returns. `sketchTool` checks the input against it, so a wrong input from an AI gets a message that names the input and what the tool takes. A number input may be marked as taking an expression (`size`).
  - **Snapping moved with the rectangle.** `placeAnchor` and `anchorPosition`, which every drawing tool of the app uses, are in the module, and the app calls them from the engine (`anchorPosition` since the review below; until then the app kept a copy). The app's rectangle is the engine's.
  - **The polygon.** 3 to 64 sides. With a `size` it is drawn at that size, so the solver starts from a shape that already holds (how that goes with anchors that snap is in architecture.md, Sketch tools); `sizeKind` without `size` dimensions the size as drawn, rounded to 0.01 unless the vertex snaps; `size` without `sizeKind` means the circumscribed circle; across flats with an odd number of sides is refused. The dimension across flats is `distancePointLine` from the first vertex to the line of the opposite side.
  - **IDs.** `freshIds(document, prefix)` hands out `<prefix><kind><number>` the whole document does not have. MCP uses it; the app keeps its counter.
  - **MCP.** The tool `sketch_tool` `{ sketch, tool, input, prefix?, preview? }` writes the batch as one command, so one undo takes the shape back, and returns `ids` with what `execute` returns (the problems and the state of the sketches). `describe_api` has the section *Sketch tools* generated from the catalog, with an example of input for each tool that a test runs. Over the bridge the app asks `changesDocument` whether a call would be written before it cancels an operation in progress.
  - **App.** The tool *Polygon* with its options in the panel (ui.md, Stav implementace).
  - **Scenario 9 is complete:** the nut pockets of the housing are a hexagon 5.5 across flats drawn by the polygon tool around the screw hole, cut 3 mm deep and repeated with the hole by the pattern `bolts`. The sketch is fully determined with nothing redundant.
  - **Tests.** `packages/scenarios/test/sketch-tools.test.ts` (the tools against the real solver: regular polygons of 3 to 12 sides, the size kinds, snapping, refusals, IDs, a nut pocket cut), `packages/mcp/test/tools.test.ts` (the description against the catalog, `sketch_tool`, IDs that avoid the document, snapping to projected geometry, refusals, preview, `changesDocument`), the bridge test in `server.test.ts`, `packages/app/test/sketch-tools.test.ts` (the polygon of the app) and scenario 9.

  **Review of point 7 (2026-11-14 to 15).** An independent review (another instance of the model, read-only) ran the tools against the real solver for every number of sides, 45 mutations of the new code, the MCP tool, the description and scenario 9. It was cut off by lost connections before the app in a browser (checked by the author before the commit: options, rubber band, drawing, odd numbers of sides); its notes were kept in a file. What it found and what was done:

  | Finding | Fix |
  |---|---|
  | The construction decided here has folded solutions besides the regular polygon (every step between vertices may go backwards, all vertices may meet), and the docs said that vertices on a circle with equal chords are a regular polygon and that the rotation is fixed by a constraint on a side. A side held horizontal that needed a turn over 30° to 45° left about half of the polygons folded, with status `ok` | Not a change of the construction (it is the decision above, and FreeCAD's polygon). The docs and the description for the AI now say what holds: draw the polygon turned as it should be, a constraint only holds it; a folded polygon shows as a sketch without a region. A test pins what is promised (sides within 25° of an axis for 3 to 12 sides) and shows the limit. The construction without folded solutions (oriented angles between neighbouring sides) is described in architecture.md as the way out |
  | The size across flats folded polygons when it changed by five to ten times, and a polygon whose drawn size was far from its dimension was born folded (a size as an expression, a vertex that snapped). The circumscribed diameter never broke | A size that is given is always the size drawn: an expression through the values of the parameters, which MCP passes to the tool, and also with a vertex that snaps. Changes within the range of wrench sizes are tested; the limit for large jumps is documented |
  | `sizeKind` without `size` and a vertex snapped to a point that cannot move: the dimension rounded to 0.01 contradicted the geometry, the sketch was in conflict | With a vertex that snaps the dimension is the size as it is, not rounded |
  | `freshIds` handed out the ID of a removed curve that a profile still named: a new rectangle elsewhere silently became the profile of an extrusion that was in error | The supplier leaves alone every text the features of the document contain |
  | Inputs: a polygon with sides shorter than a point, a size of 1e-9, coordinates out of range reported by the engine in Czech, `at` over the limit called "not finite", extra keys in `snap` accepted, an empty `prefix` refused in Czech | Checked by the tool with messages of its own; an empty prefix is the default |
  | `changesDocument` said yes to an empty batch and to a call with arguments outside the schema | It asks the tools first and compares the document a preview returns |
  | Docs said the app uses the engine's `anchorPosition`; it kept a copy | The app calls the engine's; the copy in `sketch-commands.ts` is gone (`closestOn` of `sketch-view.ts` stays: it serves hit testing over the shapes of the view) |
  | The description said `at` is ignored with a point snap, though it is required | The text says it must be given |
  | Scenario 9 did not check the volume the pockets take (a term of 308 mm³ inside a window of 7400) | The housing is compared with its state after the first hole: five holes and six pockets, to a tenth of a mm³ |
  | Mutations no test caught | Tests of snapping to a line and to an arc, of `at` out of range, of `sketch_tool` among the changing tools, of the size drawn with a snapped vertex |

  Left as they are: one drag of a vertex exactly through the centre collapses the polygon; a polygon very far from the origin (1e7 mm) or that large does not solve, as other shapes there do not either.

  **Second review of point 7 (2026-11-15),** of the fixes above only (another instance of the model, read-only): 351 polygons and a matrix of 864 starts against the real solver, 46 calls of `changesDocument` compared with what the call then did, 17 mutations of the new lines.

  | Finding | Fix |
  |---|---|
  | A size given with a vertex that snaps still folded polygons: the other vertices were drawn at the size while the first one stayed at the snap place, so the start did not hold. 44 of 864 starts folded where the snap place was four to ten times further than the size, also with the circumscribed circle, which never folded before the first fix | With a centre that does not snap the centre is drawn where the size holds. With both anchors snapped the other vertices are drawn at the larger of the two sizes. A matrix of 3888 starts (eight ways of snapping, ratios 0.1 to 10, 3 to 64 sides, three directions) leaves one fold: twelve sides across flats, both anchors on points ten times further apart than the size |
  | `changesDocument` said no to a drag of a point: a preview does not write back what the solver finds, so the document it returns is the same object (a regression of the first fix) | An accepted drag counts as a change |
  | `changesDocument` said yes to accepted commands that leave the content as it is (a rename to the same name, a point added and removed in one batch) | The content is compared as `execute` compares it for an undo step, without the `solved` of a sketch, which a preview does not write |
  | Docs and a comment still described the size and the construction as before the first fix; the app's `closestOn` was called gone | Corrected |
  | Mutations no test caught: a size as drawn that rounds to nothing, an expression with a value that is not positive, the range of a polygon on each of its four sides, the parameters handed to the tool by `sketch_tool` | Tests added |

  Left as they are: a polygon of many sides only a few times larger than what counts as one place (12 sides at a size of 0.000005 mm) is accepted and has no region; `changesDocument` runs a preview, so in a draft mode of the app a call of `execute` or `sketch_tool` from the AI is computed twice (0.4 s more on a sketch of 3000 points).

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

The list of functions in expressions and the rules for names and renaming of parameters were settled with point 1 (see its status paragraph).

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

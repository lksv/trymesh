# Návrh kontraktu pro D35

**Stav: návrh.** Výchozí bod pro implementaci rozšíření z [D35](../decisions.md), ne zmrazené rozhraní. Když se při implementaci ukáže lepší tvar, změní se tento návrh i D35. Zdrojem pravdy o tom, co je v kódu, zůstává [architecture.md](../architecture.md) a `packages/engine/src/types.ts`; po implementaci každého bodu se kontrakt přepíše tam a odsud zmizí.

Poslední úprava: 2026-11-14

| Soubor | Co v něm je |
|---|---|
| `contract.ts` | Typy: dokument verze 2, příkazy, API enginu, výsledek přepočtu, katalogy, nové nástroje MCP, vnitřní rozhraní |
| `scenario9.ts` | Validační scénář 9 zapsaný jako příkazy proti těm typům |
| `README.md` | Co potřebuje GUI, co přibude v MCP, co je veřejné v enginu, rozhodnutí, nálezy z psaní a výsledek nezávislé revize |

Soubory se nespouštějí, jen typově kontrolují:

```
npx tsc -p docs/d35-contract/tsconfig.json
```

Účel je prověřit návrh před implementací. Krok scénáře, který nejde zapsat, je díra v kontraktu. Po implementaci se ze `scenario9.ts` stane skutečný test v `packages/scenarios`.

## Veřejné rozhraní enginu

Co balíček `@trymesh/engine` vyváží navíc proti dnešku. Tvary jsou v `contract.ts`.

| Co | K čemu |
|---|---|
| Typy dokumentu verze 2 | `Document.parameters`, `Document.checks`, `FeatureBase.expressions`, `ExtrudeFeature` se zdrojem profilu, rozsahem a seznamem cílů, `PatternFeature`, vazby `equalRadius` a `fixed`, `FaceName.copy` |
| Příkazy | `updateFeature`, `setField`, `setParameter`, `renameParameter`, `removeParameter`, `setCheck`, `renameCheck`, `removeCheck`; `updatePlane` a `updateExtrude` zanikají, příkazy skici včetně `setSketchPlane` zůstávají |
| `Engine.interference(options)` | Kolize těles: prolínající se dvojice a dvojice, které se nepodařilo spočítat |
| `Engine.exportMesh(format, bodies)` | Export vybraných těles |
| `Evaluation.parameters`, `Evaluation.checks` | Hodnoty a chyby parametrů, výsledky kontrol |
| `FeatureResult.bodies`, `fieldErrors`, `values`, `facts` | Která tělesa feature vytvořila; chyby a hodnoty polí s výrazem; údaje generátoru (modul, průměry ozubení) |
| `CommandResult.error.expression` | Kde a proč příkaz odmítl výraz |
| `BodyResult.volume`, `bounds` | Objem a obálka tělesa |
| `fieldsOf(feature)` | Číselná pole konkrétní feature s jednotkou, pravidlem, hodnotou a výrazem |
| `FEATURE_TYPE_INFO` | Registr typů features (veřejná část: název, popis, číselná pole, pole pro `updateFeature`, jestli vytváří tělesa) |
| `featureInput(feature)` | Vstupní tvar feature: výrazy dosazené zpět do polí jako řetězce. Z něj vychází formulář, který při úpravě posílá feature celou |
| `GENERATORS` | Katalog generátorů profilu |
| `SKETCH_TOOLS`, `sketchTool(...)` | Nástroje skici jako dávky příkazů |
| `EXPRESSION_FUNCTIONS`, `EXPRESSION_CONSTANTS`, `analyzeExpression(expr, context)` | Syntaxe výrazů pro kontrolu při psaní a pro popis API |

Rozhraní portů (`SketchSolver`, `SolidKernel`) se nemění. Solver dostane dvě nové vazby k překladu. U jádra se mění text záruky: průnik engine nově používá (kontrola kolizí), i když pro něj adaptér záruku lícujících stěn neplní.

## Co potřebuje GUI

Čte se jako tabulky v [ui.md](../ui.md): **Příkaz** je to, co UI posílá přes `execute` nebo `preview`, **Čte** je to, co potřebuje z `EngineState` nebo z katalogů.

### Parametry a kontroly

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Zobrazit tabulku parametrů s hodnotami | | `document.parameters`, `evaluation.parameters` |
| Přidat nebo změnit parametr | `setParameter` | chyba syntaxe z `error.expression`, ostatní z `evaluation.parameters[name]` |
| Kontrola výrazu při psaní | `analyzeExpression` | `EXPRESSION_FUNCTIONS`, `EXPRESSION_CONSTANTS`, jména parametrů |
| Přejmenovat, smazat, přesunout parametr | `renameParameter`, `removeParameter`, `setParameter` s `index` | |
| Zobrazit kontroly a jejich stav | | `document.checks`, `evaluation.checks` |
| Přidat, změnit, přejmenovat, smazat kontrolu | `setCheck`, `renameCheck`, `removeCheck` | |
| Upozornit na nesplněnou kontrolu | | `evaluation.checks` (stav `failed` nebo `error`) |

### Číselné pole s výrazem

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Zjistit, která pole feature mají jednotku, rozsah a výraz | `fieldsOf(feature)`; u rozpracované feature `FEATURE_TYPE_INFO[type].fields` a katalogy | `document` |
| Zobrazit pole: výraz, vedle něj hodnota | | `feature.expressions[path]`, číslo v poli |
| Zadat číslo nebo výraz | `setField`, u kóty `setConstraintValue` | |
| Zobrazit a zadat úhel | číslo UI převádí mezi stupni a radiány; výraz zobrazuje a ukládá beze změny, v jednotkách enginu, a vedle něj ukáže výslednou hodnotu ve stupních | jednotka z `fieldsOf`, `values` z náhledu |
| Odmítnutý výraz (neznámé jméno, mimo rozsah) | | `error.expression` (pole, kód, pozice) |
| Označit pole s chybným výrazem | | `evaluation.features[id].fieldErrors` |
| Náhled při psaní | `preview(setField)` | `evaluation.features[id].values` |

### Vysunutí

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Zvolit zdroj profilu: oblasti skici, nebo generátor | | `GENERATORS` |
| Formulář generátoru (operandy, parametry, odkazy) | | položka `GENERATORS`; entity skici podle druhu; dřívější features s tímtéž generátorem |
| Zvolit rozsah: vzdálenost se začátkem, nebo „skrz vše" a strana | | |
| Vybrat cíle (u výřezu víc) | | `evaluation.bodies` |
| Náhled a potvrzení | `preview(addFeature)`, `addFeature` | |
| Změna | `updateFeature` | |
| Varování ozubení | | `warnings` s kódem `gearMesh`, `gearInterference` |

### Pole

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vybrat zdroj: features z časové osy, nebo těleso | | `document.features`, `evaluation.bodies` |
| Vybrat osu: základní osa, nebo bod skici | | body skic |
| Počet; plný kruh, nebo úhel mezi první a poslední kopií | pole s výrazem | |
| Náhled a potvrzení | `preview(addFeature)`, `addFeature` | |
| Změna | `updateFeature` | |
| Zobrazit vzniklá tělesa | | `evaluation.features[id].bodies` |

### Více dílů

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Kontrola kolizí | `engine.interference()` | `pairs`, `failed` |
| Zvýraznit kolidující dvojici | stav UI | `Interference` |
| Export vybraných těles, soubor na těleso | `engine.exportMesh('stl', [body])` | `evaluation.bodies` |
| Objem a obálka tělesa | | `evaluation.bodies[id].volume`, `bounds` |

### Skica

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Nové vazby v nabídce | `addConstraint` | `CONSTRAINTS` (přibudou samy) |
| Pevný bod: zamknout na místě | `addConstraint` s `fixed` bez souřadnic | |
| Pevný bod: upravit souřadnice | `setField` (`constraints/<id>/x`) | `fieldsOf` |
| Mnohoúhelník, obdélník | `sketchTool(...)`, pak `batch` | `SKETCH_TOOLS`; skica a její vyřešený stav |

## Co přibude v MCP

`execute` a `preview` přijímají nové příkazy bez zásahu, protože berou typ `Command`. Tvary vstupů a výstupů jsou v `contract.ts` (`McpAdditions`).

| Nástroj | Změna |
|---|---|
| `get_parameters` | Nový. Parametry s hodnotami a chybami, kontroly s výsledkem |
| `check_interference` | Nový. Kolidující dvojice těles s objemem průniku a dvojice, které se nepodařilo spočítat |
| `sketch_tool` | Nový. Provede nástroj skici (mnohoúhelník, obdélník) a vrátí ID toho, co vzniklo; ID generuje server tak, aby v dokumentu nebyla |
| `execute`, `preview`, `undo`, `redo` | Výsledek navíc hlásí nesplněné kontroly, chyby parametrů a chyby polí. Dnes hlásí jen features mimo stav `ok`, takže po změně parametru by selhaná kontrola nebyla vidět |
| `export_stl` | Seznam těles a volba „soubor na těleso". Jméno souboru je ID tělesa s jednoznačným zápisem znaků, které do jména nepatří (`planets/1` je `planets%2F1.stl`); před zápisem se ověří, že jména nekolidují ani velikostí písmen a že soubor neexistuje |
| `get_model` | Navíc parametry, nesplněné kontroly, objem a obálka těles, tělesa vytvořená každou feature a údaje generátoru |
| `get_sketch` | A constraint also lists its expressions by value name (`expressions: { value }`, for a fixed point `{ x, y }`); the document keeps them in the feature's map, not on the constraint |
| `get_body` | Navíc objem a obálka; ID tělesa smí být odvozené (`<pole>/<číslo>`); jména stěn kopií se odliší |
| `describe_api` | Navíc syntaxe výrazů, katalog číselných polí, generátorů, typů features a nástrojů skici; konvence o výrazech, úhlech a ID těles |

## Rozhodnutí

D35 je nechával otevřená. Prvních třináct vzniklo při psaní kontraktu, další po nezávislé revizi. Vlastník projektu je potvrdil 2026-11-14.

1. **Adresa číselného pole** je cesta oddělená lomítky (`extent/distance`, `profile/params/teeth`, `constraints/<id>/value`). Lomítko v ID být nesmí, takže cesta je jednoznačná.
2. **Výrazy jsou v jedné mapě u feature** (`expressions`), ne u jednotlivých polí. Typy číselných polí zůstávají čísla. Mapa smí obsahovat jen cesty existujících polí: smazání vazby a změna varianty ji čistí, referenční kóta výraz ztrácí, dokument s neznámou cestou je neplatný.
3. **V příkazu smí být místo čísla řetězec s výrazem** (typ `Input`). Řetězec v poli a položka mapy pro tutéž cestu zároveň je neplatný příkaz. Typ dovolí řetězec i tam, kde ho engine odmítne (souřadnice bodu skici).
4. **Úhly jsou v radiánech všude, v čísle i ve výrazu.** `30` a `"30"` znamenají totéž. Stupně se píšou funkcí `deg(x)`, `pi` je konstanta, goniometrické funkce berou radiány. GUI převádí jen čísla: číslo ukazuje a přijímá ve stupních. Výraz zobrazuje a ukládá beze změny, v jednotkách enginu, a vedle něj ukáže výslednou hodnotu ve stupních; kdo chce stupně ve výrazu, napíše `deg()` sám. Automatické obalování výrazu do `deg(...)` by tiše změnilo výraz vytvořený jinde (`pi / 2` z MCP by se po potvrzení v GUI stal 1,57°). Úhlová pole mají rozsahy v radiánech, takže hodnota zadaná omylem ve stupních (úhel záběru 20, úhel pole 360) je neplatný příkaz, ne tichá chyba.
   - Původní návrh (číslo v radiánech, výraz ve stupních) revize označila za zdroj tichých chyb.
   - Zamítnuto: volba jednotky nastavením dokumentu nebo parametrem příkazu. Totéž číslo by znamenalo dvě věci podle příznaku jinde.
   - Zvažováno: stupně na celé veřejné hranici (doporučení revize). Zamítnuto, protože záměnu jednotek pak rozsah nezachytí: hodnota v radiánech je malé číslo a projde vždy.
5. **`updateFeature` je slučovací změna.** Varianta (objekt s `type`) se stejným `type` a u generovaného profilu stejným `generator` se slučuje po polích, jiná nahrazuje. Odkaz (objekt s `kind`: rovina, osa) se nahrazuje vždy celý. Seznamy se nahrazují, `null` odebírá nepovinné pole nebo jednu položku slovníku (`params`, `refs`), změna na `operation: 'new'` odebere cíle. Znovu se ověřují jen odkazy, které změna mění. Původní návrh (náhrada celých polí) by při změně jednoho parametru generátoru zrušil výrazy ostatních.
6. **`setField` je obecný příkaz pro jedno číselné pole.** Číslo výraz ruší, řetězec ho nastaví. Hodnotu kóty umí stejně i `setConstraintValue`, který navíc přepíná `driving`.
7. **Boční stěna ozubení se jmenuje podle katalogu** (`curve: 'teeth'`), ne podle roztečné kružnice. Výměna kružnice pak stěnu nepřejmenuje.
8. **Stěna kopie nese seznam `copy`** (pole a číslo kopie), stěny originálu nic.
9. **Výsledek feature říká, která tělesa vytvořila** (`bodies`). Volající tak nemusí odvozená ID skládat sám.
10. **Chyby výrazů jsou u feature po polích** (`fieldErrors`) a hodnoty použité při přepočtu také (`values`), protože náhled do dokumentu nezapisuje. Příkaz odmítnutý kvůli výrazu vrací strukturovanou chybu (`error.expression`).
11. **Nástroje skici mají jednu úroveň:** vstup je `Anchor` (místo a volitelné přichycení). Vstupy jsou ploché, aby je šlo popsat katalogem; výsledek může být chyba; pořadí vrácených ID je definované.
12. **Generátor zveřejňuje „fakta"** (střed, roztečný poloměr, modul, počet zubů, natočení). Slouží dalšímu generátoru při odkazu „v záběru s" a jsou ve výsledku feature, aby jimi AI ověřila, co postavila.
13. **Strana „skrz vše" je v dokumentu vždy výslovná.** GUI nabízí jako výchozí `both` a popis pro AI ji doporučuje; u tělesa na obou stranách roviny může `both` říznout i nechtěnou část.
14. **Chybný výraz kóty skicu neshodí.** U skici je `invalidExpression` varování a skica se spočítá s poslední platnou hodnotou. Feature v chybě nemá rovinu ani vyřešenou skicu, takže by nešla otevřít a vše za ní by spadlo. U ostatních typů features zůstává chyba.
15. **Kruhové pole má výslovný rozsah:** plný kruh (krok 2π děleno počtem), nebo úhel mezi první a poslední kopií. Původní pravidlo „při plném kruhu“ bylo nespojité: počet 4 s úhlem 360° dával krok 90°, s úhlem 359,999° krok 120°.
16. **Číselné pole má rozsah, ne pojmenované pravidlo:** minimum a maximum s příznakem otevřenosti, zákaz nuly, celé číslo s tolerancí 1e-9 (`0.3 / 0.1` není přesně 3). Počet kopií má horní mez.
17. **Katalog číselných polí je statický** (`FEATURE_TYPE_INFO[type].fields`, katalog vazeb, katalog generátorů) a `fieldsOf` se z něj odvozuje. Popis pro MCP a formulář rozpracované feature potřebují popis bez hotové feature. Katalog vazeb má pojmenované hodnoty místo jedné (`value` u kót, `x` a `y` u pevného bodu).
18. **Parametry a kontroly: neplatný příkaz je jen syntaktická chyba a nepřípustné jméno.** Jméno parametru je identifikátor, protože se používá ve výrazech. Jméno kontroly je volný text pro člověka (neprázdný, jedinečný mezi kontrolami). Neznámé jméno a cyklus se přijmou a stav je ve výsledku; jinak by nešlo založit `Zr` dřív než `Zs`. Výraz v poli feature je přísnější: co nejde vyhodnotit hned, je neplatný příkaz.
19. **Funkce se pozná podle závorky za jménem.** Parametr se smí jmenovat jako funkce, takže pozdější funkce nezneplatní starší dokument. Vyhrazená jsou jen jména konstant a vlastností každého objektu.
20. **Porovnání v kontrolách má toleranci:** `a == b`, když se liší nejvýš o 1e-9 · max(1, |a|, |b|), tedy absolutně u nuly a relativně u velkých čísel. `!=` je negace, `<` znamená menší a zároveň ne rovno. Jen relativní tolerance by u nuly selhala: `(0.1 + 0.2) - 0.3 == 0`.
21. **Kontrola kolizí hlásí i selhání.** Průnik je operace bez záruky adaptéru jádra; dvojice, kterou se nepodařilo spočítat, je ve `failed`.
22. **Parametry generátoru unesou text a výčet.** Jestli je řetězec výraz, volba, nebo text, říká katalog. Bez toho by text nebo typ řemenice byly pozdější změnou tvaru dokumentu.

## Nálezy ze zápisu scénáře 9

Co se ukázalo, když se scénář psal příkaz po příkazu.

1. **Jedna společná skica nestačí na všechno.** Obrysy různých dílů se v jedné skice kříží (příruba centrálního kola a díra satelitu), a křížení běžných křivek profil zneplatní. Skica kol proto nese jen roztečné kružnice a to, co se s ničím nekříží; každý další díl má vlastní skicu a polohy opakuje kótami. Scénář to unese, ale je to důvod, proč je promítnutí geometrie z jiné skici první v [backlog.md](../backlog.md).
2. **Díra satelitu jsou dvě oblasti.** Čep a díra jsou soustředné kružnice ve stejné skice, takže díra je mezikruží a kruh vybrané dohromady. Funguje to, ale kdo to neví, vyřízne jen mezikruží.
3. **Strana „skrz vše" se plete.** Deska leží pod rovinou skici (`backward`), příruba nad ní (`forward`), šroub prochází oběma (`both`). Viz rozhodnutí 13. Revize strany ve skriptu přepočítala a jsou správně.
4. **ID musí být jedinečná v celém dokumentu,** včetně entit všech skic. První verze skriptu měla feature `pin` a křivku `pin`. Nástroj skici v MCP proto musí generovat ID, která v dokumentu nejsou, a `sketch_tool` to má hlídat.
5. **Osa pole přes bod skici ve scénáři není potřeba.** Všechna pole jdou kolem základní osy Z. Varianta `sketchPoint` zůstává pro pole mimo osu modelu.
6. **Odkaz „v záběru s" vede na feature, ne na těleso.** Satelit se odkazuje na `sunTeeth` (přidání k tělesu `sun`), koruna na `planet`. Je to správně, jen to GUI musí nabízet jako výběr vysunutí s ozubením.
7. **Odvozená ID těles se musí dát zjistit.** Export po tělesech potřebuje `planets/1` a `planets/2`; scénář je čte z `features.planets.bodies` (rozhodnutí 9).

## Revize návrhu (2026-11-14)

Nezávislá revize (jiná instance modelu bez znalosti předchozí práce) prošla kontrakt, skript a D35 proti kódu. Spustila stávající testy (360 z 360) a spike, přepočítala geometrii scénáře pro všechny tři sestavy a skici ověřila proti dnešnímu enginu a solveru. Implementaci neblokoval žádný nález; čtrnáct doporučila opravit předem.

| Nález | Řešení |
|---|---|
| Úhly: číslo v radiánech, výraz ve stupních dává tichý nesmysl | Rozhodnutí 4 |
| `updateFeature` s náhradou celých polí ztrácí výrazy a ověřuje víc, než má | Rozhodnutí 5 |
| Skica s chybným výrazem kóty zmizí z vyhodnocení a nejde otevřít | Rozhodnutí 14 |
| Chybí statický katalog číselných polí; katalog vazeb má jen jednu hodnotu | Rozhodnutí 17 |
| Pravidla čísel neumí rozsahy; „plný kruh" je nespojité pravidlo | Rozhodnutí 15 a 16 |
| Mapa výrazů nemá pravidla soužití a úklidu | Rozhodnutí 2 a 3 |
| Není určeno, co je neplatný příkaz u parametrů a kontrol | Rozhodnutí 18 a 20 |
| Neplatný příkaz nenese strukturovanou chybu výrazu | Rozhodnutí 10 |
| Kontrola kolizí nemá kanál pro selhání | Rozhodnutí 21 |
| Parametry generátoru neunesou text ani výčet | Rozhodnutí 22 |
| Zákaz jména parametru shodného s funkcí zamyká přidávání funkcí | Rozhodnutí 19 |
| MCP: výsledek příkazu neukáže kontroly ani chyby polí | Tabulka Co přibude v MCP |
| Nástroje skici: popis neunese vnořený vstup, chybí chyba a pořadí ID | Rozhodnutí 11 |
| „Skrz vše": cíl na opačné straně a velikost přesahu | Komentář u `Extent` v `contract.ts` |
| Skript: rozměr matice 5,6 místo 5,5; ID kopií napevno; nepoužitý parametr; slabá očekávání; nezkoušené příkazy | Opraveno ve `scenario9.ts`; přibyla funkce `contractCoverage` |
| README rušil `setSketchPlane`, D35 říká, že příkazy skici zůstávají | `setSketchPlane` zůstává |

## Druhé kolo revizí (2026-11-14)

Dvě revize od jiných modelů dodané vlastníkem projektu po zapracování první. Tvrzení jsou ověřená proti kódu a výpočtem; všech deset nálezů platí.

| Nález | Platí? | Řešení |
|---|---|---|
| GUI obalující výraz do `deg(...)` tiše změní výraz vytvořený jinde | Ano | Rozhodnutí 4: GUI převádí jen čísla, výrazy nechává v jednotkách enginu |
| Jména exportovaných souborů nejsou jednoznačná (`planets/1` a `planets_1`) | Ano | Jednoznačný zápis znaků a kontrola kolizí před zápisem (tabulka MCP) |
| Pravidlo jmen kontrol odporuje scénáři, který používá věty | Ano | Rozhodnutí 18: jméno kontroly je volný text |
| Jen relativní tolerance rovnosti selže u nuly | Ano | Rozhodnutí 20 |
| Podmínka nárazu hlavy do paty neplatí pro vnitřní ozubení a ověřuje jen jedno kolo | Ano; číselný příklad v revizi pro 12/24/60 nesedí (koruna tam podmínku splní, 26,10 proti 25,97) | D35, bod 3: obě kola dvojice, u koruny obrácená nerovnost |
| Slučovací změna rozlišuje variantu jen podle `type`, ale rovina a osa mají `kind`; `null` nejde použít na jeden odkaz | Ano | Rozhodnutí 5 |
| Odkaz na stěnu kopie je i odkazem na pole; prázdné `copy` dá dva zápisy téže stěny | Ano | Komentář u `FaceName`, poznámky pro implementaci |
| Zápis vyhodnocených hodnot do dokumentu dnes umí jen skica | Ano | Poznámky pro implementaci |
| Pole nad zdrojem, který skončil varováním „bez účinku" | Ano | Recept se ukládá i při varování (komentář u `ToolRecipe`, D35 bod 4) |
| Pevný bod: kód pozná kótu podle hodnoty v katalogu; překlad na dvě primitiva solveru | Ano | Příznak `dimension` v katalogu vazeb, poznámky pro implementaci |

## Poznámky pro implementaci

Nálezy revize, které nemění kontrakt, ale implementace na ně narazí.

- **Tolerance u ozubení.** Shoda modulů a tečnost se porovnávají s tolerancí: 16,2 / 18 je 0,8999999999999999 a střed satelitu vychází 20,250000000000128. Přesné porovnání by dalo falešné varování `gearMesh` už ve výchozím stavu.
- **Cache u chyby výrazu.** Krok feature s chybou výrazu se musí pamatovat podle výsledku výrazů. Jinak vzniká při každém vyhodnocení nový stav, vše za ním se počítá znovu a cache diagnostiky skici se míjí.
- **Validace.** `validateDocument` a `featureRefs` je potřeba rozšířit o nové typy, odkazy generátoru a odvozená ID těles. `faceName()` v `document.ts` dnes neznámá pole zahodí, tedy i `copy`.
- **Které stěny dostanou značku kopie.** Kopírované těleso se skládá ze stěn více features (i dřívějších polí). Pole těles projde stěny, které těleso v té chvíli má, každé založí nové číslo se jménem doplněným o značku kopie a otočeným popisem a v síti kopie čísla přemapuje.
- **Odkaz na stěnu kopie.** Stěna s `copy` existuje až po poli, i když těleso i zdrojová feature leží před ním. Validace roviny skici, promítnuté hrany i `featureRefs` proto musí zahrnout každé pole z `copy` (u hrany z obou stěn): musí to být feature typu pole před odkazující feature a číslo kopie celé číslo od 1. Prázdné `copy` se odmítne nebo sjednotí na chybějící.
- **Zápis hodnot výrazů.** Dnes se po přepočtu zapisuje do dokumentu jen vyřešená skica, a jen když solver uspěl. Hodnoty výrazů se musí zapisovat u všech typů features (rovina, vysunutí, pole) a u skici i tehdy, když solver skončí konfliktem; jinak v dokumentu zůstanou staré hodnoty a při pozdější chybě výrazu by se použily jako „poslední platné".
- **Recept nástroje při varování.** Vysunutí dnes při „bez účinku" končí dřív, než by recept uložilo. Recept se musí uložit i tehdy; pole nad takovým zdrojem není chyba.
- **Kóta, nebo vazba s hodnotami.** Kód na čtyřech místech předpokládá, že vazba s hodnotou v katalogu je kóta s `driving` (validace v `document.ts`, výběr geometrických vazeb v `sketch-commands.ts`, příklad v `mcp/src/api.ts`). Nově rozhoduje příznak `dimension`. U pevného bodu bez souřadnic se nejdřív ověří, že bod existuje, a teprve pak se doplní jeho poloha.
- **Pevný bod v solveru.** Adaptér překládá jednu vazbu na jedno primitivum a pomocná ID z hlášení filtruje; konflikt druhé souřadnice by se ztratil. Buď mapa z ID vazby na víc primitiv (`coordinate_x` a `coordinate_y`), nebo pomocný pevný bod a vazba totožnosti pod ID vazby.
- **Pevný bod v rozboru volnosti.** Rozbor počítá v souřadnicích posunutých k prvnímu bodu vazby, takže bod vazby tam má souřadnice nula. Rovnice pevného bodu proto musí být rozdílem proti bodu `origin`: `bod − origin − (x, y)`. Bez toho by pevný bod mimo počátek vyšel jako nesplněná vazba.
- **Stejný poloměr v solveru.** Primitiva planegcs mají pole `c1_id`, `c2_id` (dvě kružnice), `c1_id`, `a2_id` (kružnice a oblouk) a `a1_id`, `a2_id` (dva oblouky); liší se od tečnosti, která má `c_id` a `a_id`.
- **Třetí druh stěny.** `edgeKind` a `projectEdge` v `solid.ts` berou každou nerovinnou stěnu jako válec; hrana víka s ozubením by vyšla jako kružnice.
- **Výkon.** Skica kol je první feature, takže každá změna parametru přepočítá celý model. Náhled při psaní potřebuje `at` nebo prodlevu.
- **Neověřeno.** Nové vazby ve skutečném solveru (`equal_radius` na obloucích, pevný bod), otočení sítě u kopií těles, přesah „skrz vše" proti adaptéru jádra, výřez do více cílů, kontrola kolizí na celých tělesech scénáře a čas přepočtu celého kloubu.

### Po kroku 0 (2026-11-14)

Krok 0 je v kódu (`docs/decisions.md`, D35, odstavec „Stav: provedeno"). Od tohoto návrhu se liší takto:

- Veřejná část registru se jmenuje `FEATURE_TYPE_INFO` a pole pro `updateFeature` nese jako `updatable`; `FEATURE_TYPES` s `fields` (číselná pole) přijde s bodem 1. Aplikace má zatím vlastní mapu názvů typů (`FEATURE_TYPES` v `app.ts`), kterou má registr nahradit.
- `updateFeature` navíc odmítá pole, které výsledná feature nemá, a půlku odkazu; odkazy ověřuje podle toho, zda je feature dosud měla, ne podle toho, zda je změna uvádí.
- `ToolRecipe.build` má zatím jen `firstFaceId`.

## Třetí kolo revize (2026-11-14)

Revize od slabšího modelu dodaná vlastníkem po kroku 0. Každý bod je ověřený proti kódu. Nic z ní nemění tvar dokumentu; přijaté změny jsou v `contract.ts` a v poznámkách výše.

| Nález | Platí? | Řešení |
|---|---|---|
| A. Formulář aplikace posílá při úpravě vysunutí celé (`draftCommand`); čísla v příkazu by zrušila výrazy polí, která uživatel neměnil | Ano | Engine vyváží `featureInput(feature)`: feature s výrazy dosazenými do polí. Rozpracovaná feature ve formuláři je tento vstupní tvar (pole stejně musí ukazovat výraz). Pravidlo „číslo výraz ruší" zůstává výslovné; výjimka „stejné číslo výraz nechá" by nešla odlišit od záměru výraz zmrazit |
| B. Zápis hodnot výrazů po přepočtu a převěšení cache musí fungovat pro všechny typy features | Ano; bylo v poznámkách | Bod 1: dosazená feature se pamatuje podle původní feature a hodnot výrazů, zapisuje se u všech typů a cache se převěsí i s dosazením |
| B. Poznámka o `differs` je po kroku 0 neaktuální | Ano | Odstraněna |
| C. `setConstraintValue` bez `value` nesmí zrušit výraz; výraz u referenční kóty | Ano; přepnutí na referenční kótu už kontrakt řešil (výraz se odebere) | Doplněno: bez `value` se výraz nemění, výraz zadaný referenční kótě je neplatný příkaz |
| D. Popis `updateFeature` v `types.ts` (odtud jde do `describe_api`) říká starou formulaci o ověřování odkazů | Ano | Opraveno v `types.ts` i v `contract.ts` |
| D. Kontrakt má `FEATURE_TYPES` s `fields`, kód `FEATURE_TYPE_INFO` s `updatable` | Ano; bylo v části Po kroku 0 | Jméno z kódu, typ má `fields` i `updatable` |
| D. Pole se zdrojem features žádná tělesa nevytváří | Ano | `bodies` v popisu typu říká, co typ vytvořit může; rozhoduje funkce registru (bod 4) |
| E1. Není řečeno, kdy se ověřují operandy generátoru a jaká chyba je smazaný operand | Ano | Příkaz ověří operandy, které feature dosud neměla; načtení jen tvar; při přepočtu `brokenReference` |
| E2. Operandem může být i promítnutá kružnice | Ano, stojí málo | Přijato. S pozdějším promítnutím z jiné skici tak ozubení může stát na kružnici společné kostry |
| E3. Generátor může selhat (špičatý zub) a kontrakt pro to nemá kanál | Ano | Generátor vrací výsledek, nebo zprávu; vysunutí pak končí chybou `invalidProfile` |
| E4. Parametr bez výchozí hodnoty a `null` | Ano | Parametr bez výchozí hodnoty je povinný; `null` u něj je neplatný příkaz, jinak vrátí výchozí hodnotu a zruší výraz |
| F1, F2, F4. Otočení popisu stěn u kopií, které stěny dostanou `copy`, třetí druh stěny | Ano; F1 a F4 už v návrhu byly | F2 doplněno do poznámek k bodu 4: značku dostane každá stěna, kterou kopírované těleso v té chvíli má |
| F3. Počet 1 s rozsahem úhlu dělí nulou; popis čísla kopie | Kontrakt případ řešil (žádná kopie); popis zpřesněn | Číslo kopie je 1 až počet − 1 |
| G1. Rovnice pevného bodu v rozboru volnosti musí odečíst bod `origin` | Ano; poznámka byla omylem u stejného poloměru | Poznámka přesunuta a zpřesněna |
| G2, G3. Pevný bod: dvě primitiva solveru, panel vazeb v aplikaci čte jen `value` | Ano; G2 už v poznámkách | G3 se řeší v bodě 6 podle katalogu (`values`) |
| H. `get_sketch` nepotřebuje `at`, skica je sama bodem časové osy | Ano | Vypuštěno |
| Doporučení 1. Výstup generátoru jako oblasti místo plochého seznamu smyček | Ano, stojí málo | Přijato: `regions` s vnější smyčkou a dírami, stejně jako profil skici |
| Doporučení 2. Příznak zrcadlení v tuhé transformaci | Zčásti | Příznak ne. Transformace je matice a posun; funkce, která transformuje síť, při záporném determinantu obrátí pořadí vrcholů. Popis stěny nese normálu bez znaménka, takže ji obracet netřeba (revize tvrdila opak) |

## Obecnost proti backlogu (2026-11-14)

Před bodem 1 prošel každý řádek [backlog.md](../backlog.md) proti kódu po kroku 0 a proti tomuto návrhu s otázkou, jestli by ho návrh zkomplikoval. Tvar dokumentu ani příkazů se nemění. Vzešlo z toho pět pravidel pro provedení, která stojí málo a pozdější rozšíření zlevní:

| Pravidlo | Kde | Čemu slouží |
|---|---|---|
| Dosazená feature se pamatuje podle hodnot výrazů, ne podle identity tabulky parametrů; prostředí jmen dostává krok přepočtu jako argument | bod 1 | Jména referenčních kót ve výrazech: prostředí se později rozšíří o hodnoty vzniklé přepočtem a cache se nemění |
| Tečka je ve výrazu vyhrazená (dnes chyba syntaxe) | bod 1 | Zápis `skica.kóta` pro hodnoty z přepočtu |
| Výraz má typ výsledku (číslo, nebo pravda); pole říká, který čeká | bod 1 | Potlačení feature výrazem je pak další pole s výrazem, jen typu pravda |
| „Použití nástroje" (nové těleso, nebo boolean s cíli, varování „bez účinku") je funkce nad receptem, ne nad vysunutím; zdrojem pole je feature s receptem, ne výslovně vysunutí | body 2 a 4 | Revolve je nový typ feature se stejným použitím; pole ho opakuje bez zásahu |
| Pole dostane seznam transformací od funkce podle druhu; zbytek kroku o druhu neví | bod 4 | Posuvné pole, zrcadlení, pootočení kopií |

Co se zvažovalo a nedělá:

- **Popis tvaru feature schématem** (jeden strom, ze kterého by plynula validace, slučování, katalog polí i formulář). Bylo by to čistší, ale je to přepis validace všech typů. Stačí, že číselná pole čte validace přes katalog a `fieldsOf` vzniká z téhož průchodu.
- **Neutrální jméno značky kopie** (`pattern` ve `FaceName.copy`). Zrcadlení i posun jsou druhy pole, takže kopii vždy vytváří pole.
- **Stěny generátoru po hranách** (rovné boky hřebene jako rovinné stěny, na které jde kreslit). Jména stěn dává katalog generátoru, popis stěny je vnitřní; půjde přidat bez změny dokumentu.

Dvě místa, kde backlog slibuje víc, než kolik dnes platí, a pozdější práce s nimi musí počítat:

- **Knihovna dílů.** Stěny vloženého dílu nesou ID features vloženého dokumentu s předponou (`<vložení>/<feature>`). Validace odkazu na stěnu dnes hledá feature přímo; bude potřebovat stejný rozklad jako ID těles (`bodyOwner`).
- **Jména referenčních kót.** Výraz v poli feature se ověřuje už při příkazu, a to jen proti tabulce parametrů. Jméno, jehož hodnota vzniká až přepočtem, příkaz vyhodnotit neumí; ověření při příkazu se pro taková jména bude muset přesunout do fasády enginu, která stav přepočtu má.

### After point 1 (2026-11-14)

Point 1 is in the code (`docs/decisions.md`, D35, point 1, "Status: done"; `docs/architecture.md`, Parameters and expressions). The types of point 1 now live in `packages/engine/src/types.ts`; `contract.ts` keeps its copies only so that `scenario9.ts` type-checks. Differences from this draft:

- The patch type is still called `Patch` (the draft says `Merge`); it gains dictionaries with point 3.
- `EXPRESSION_FUNCTIONS` entries have `variadic` (for `min` and `max`); there is also `EXPRESSION_SYNTAX` (a text for the API description) and the operator `^`.
- The kind of an expression (number or truth value) is checked without evaluating, so `setCheck` with a number and `setParameter` with a comparison are invalid commands with the code `type`.
- `ExpressionError.position` is filled for an unknown name as well as for a syntax error.
- The engine also exports `fieldsOf`, `featureInput`, `constraintPath`, `isDimension`, `checkNumber`, `rangeText`, `atPath` and `withPath`.
- `Evaluation.checks` holds a result for every check, and `Evaluation.parameters` for every parameter, also when the recompute stops early (`at`).
- MCP: the outcome of `execute` carries `failedChecks` and `parameterErrors` only when they are not empty; `fieldErrors` is part of the feature entry in `problems`. `get_model` lists `parameters` as name → value.
- Implementation notes that are now done: cache for a feature in error, write-back for all feature types, the `dimension` flag in the constraint catalog and its four call sites.
- The scenario test uses English names; `scenario9.ts` keeps the names of the draft.
- After the review of point 1 and a further review of the plan (both in `docs/decisions.md`, D35, point 1): `updateFeature` keeps a repeated expression without evaluating it; both sides of `&&` and `||` are always evaluated; comparing a non-finite number is an error; the remainder is tolerant; expressions are limited to 1000 characters and 100 levels of nesting; `get_sketch` lists the expressions of a constraint by value name instead of a single `expr`.

## Co kontrakt neřeší

- Rozložení a vzhled UI; to patří do `ui.md` při implementaci každého bodu.
- Vnitřní stavbu přepočtu: dosazení výrazů, cache, zápis hodnot. Rozhraní receptu nástroje a generátoru jsou v `contract.ts` jen pro úplnost.
- Převod dokumentu verze 1 na verzi 2 krok po kroku.

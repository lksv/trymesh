# Návrh kontraktu pro D35

**Stav: návrh.** Výchozí bod pro implementaci rozšíření z [D35](../decisions.md), ne zmrazené rozhraní. Když se při implementaci ukáže lepší tvar, změní se tento návrh i D35. Zdrojem pravdy o tom, co je v kódu, zůstává [architecture.md](../architecture.md) a `packages/engine/src/types.ts`; po implementaci každého bodu se kontrakt přepíše tam a odsud zmizí.

Poslední úprava: 2026-11-14

| Soubor | Co v něm je |
|---|---|
| `contract.ts` | Typy: dokument verze 2, příkazy, API enginu, výsledek přepočtu, katalogy, nové nástroje MCP, vnitřní rozhraní |
| `scenario9.ts` | Validační scénář 9 zapsaný jako příkazy proti těm typům |
| `README.md` | Co potřebuje GUI, co přibude v MCP, co je veřejné v enginu, rozhodnutí a nálezy z psaní |

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
| Příkazy | `updateFeature`, `setField`, `setParameter`, `renameParameter`, `removeParameter`, `setCheck`, `removeCheck`; `updatePlane`, `updateExtrude` a `setSketchPlane` zanikají |
| `Engine.interference(options)` | Kolize těles |
| `Engine.exportMesh(format, bodies)` | Export vybraných těles |
| `Evaluation.parameters`, `Evaluation.checks` | Hodnoty a chyby parametrů, výsledky kontrol |
| `FeatureResult.bodies`, `fieldErrors`, `values` | Která tělesa feature vytvořila; chyby a hodnoty polí s výrazem |
| `BodyResult.volume`, `bounds` | Objem a obálka tělesa |
| `fieldsOf(feature)` | Číselná pole konkrétní feature s jednotkou, pravidlem, hodnotou a výrazem |
| `FEATURE_TYPES` | Registr typů features (veřejná část: název, popis, jestli vytváří tělesa) |
| `GENERATORS` | Katalog generátorů profilu |
| `SKETCH_TOOLS`, `sketchTool(...)` | Nástroje skici jako dávky příkazů |
| `EXPRESSION_FUNCTIONS`, `analyzeExpression(expr)` | Syntaxe výrazů pro kontrolu při psaní a pro popis API |

Porty (`SketchSolver`, `SolidKernel`) se nemění. Solver dostane dvě nové vazby k překladu; jádro nic nového.

## Co potřebuje GUI

Čte se jako tabulky v [ui.md](../ui.md): **Příkaz** je to, co UI posílá přes `execute` nebo `preview`, **Čte** je to, co potřebuje z `EngineState` nebo z katalogů.

### Parametry a kontroly

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Zobrazit tabulku parametrů s hodnotami | | `document.parameters`, `evaluation.parameters` |
| Přidat nebo změnit parametr | `setParameter` | chyba výrazu z `evaluation.parameters[name]` |
| Kontrola výrazu při psaní | `analyzeExpression` | `EXPRESSION_FUNCTIONS`, jména parametrů |
| Přejmenovat, smazat, přesunout parametr | `renameParameter`, `removeParameter`, `setParameter` s `index` | |
| Zobrazit kontroly a jejich stav | | `document.checks`, `evaluation.checks` |
| Přidat, změnit, smazat kontrolu | `setCheck`, `removeCheck` | |
| Upozornit na nesplněnou kontrolu | | `evaluation.checks` (stav `failed` nebo `error`) |

### Číselné pole s výrazem

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Zjistit, která pole feature mají jednotku, pravidlo a výraz | `fieldsOf(feature)` | `document` |
| Zobrazit pole: výraz, vedle něj hodnota | | `feature.expressions[path]`, číslo v poli |
| Zadat číslo nebo výraz | `setField`, u kóty `setConstraintValue` | |
| Zobrazit úhel | převod radiánů na stupně v UI | jednotka z `fieldsOf` |
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
| Počet a úhel | pole s výrazem | |
| Náhled a potvrzení | `preview(addFeature)`, `addFeature` | |
| Změna | `updateFeature` | |
| Zobrazit vzniklá tělesa | | `evaluation.features[id].bodies` |

### Více dílů

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Kontrola kolizí | `engine.interference()` | |
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
| `check_interference` | Nový. Kolidující dvojice těles s objemem průniku |
| `sketch_tool` | Nový. Provede nástroj skici (mnohoúhelník, obdélník) a vrátí ID toho, co vzniklo |
| `export_stl` | Seznam těles a volba „soubor na těleso" |
| `get_model` | Navíc parametry, nesplněné kontroly, objem a obálka těles, tělesa vytvořená každou feature |
| `get_body` | Navíc objem a obálka; ID tělesa smí být odvozené (`<pole>/<číslo>`) |
| `describe_api` | Navíc syntaxe výrazů, katalog číselných polí, generátorů, typů features a nástrojů skici; konvence o výrazech, úhlech a ID těles |

## Rozhodnutí udělaná při psaní

D35 je nechával otevřená; tady jsou rozhodnutá tak, aby šel kontrakt napsat. Každé je kandidát na revizi.

1. **Adresa číselného pole** je cesta oddělená lomítky (`extent/distance`, `profile/params/teeth`, `constraints/<id>/value`). Lomítko v ID být nesmí, takže cesta je jednoznačná.
2. **Výrazy jsou v jedné mapě u feature** (`expressions`), ne u jednotlivých polí. Typy číselných polí zůstávají čísla a stávající kód se nemění.
3. **V příkazu smí být místo čísla řetězec s výrazem** (typ `Input`). Pro AI i GUI je to jedno místo zadání. Cena: typ příkazu dovolí řetězec i tam, kde ho engine odmítne (souřadnice bodu skici).
4. **Úhel: číslo je v radiánech, výraz ve stupních.** `"30"` je třicet stupňů, `30` je třicet radiánů. Je to past; alternativa je brát v příkazech úhly vždy ve stupních, což by změnilo dnešní chování.
5. **`updateFeature` nahrazuje uvedená pole celá.** Varianty (`profile`, `extent`, `transform`) se neslučují po částech.
6. **`setField` je obecný příkaz pro jedno číselné pole.** Nahrazuje zvláštní příkaz pro výraz; číslo výraz ruší, řetězec ho nastaví.
7. **Boční stěna ozubení se jmenuje podle katalogu** (`curve: 'teeth'`), ne podle roztečné kružnice, jak říká D35. Výměna kružnice pak stěnu nepřejmenuje.
8. **Stěna kopie nese seznam `copy`** (pole a číslo kopie), stěny originálu nic.
9. **Výsledek feature říká, která tělesa vytvořila** (`bodies`). Volající tak nemusí odvozená ID skládat sám.
10. **Chyby výrazů jsou u feature po polích** (`fieldErrors`) a hodnoty použité při přepočtu také (`values`), protože náhled do dokumentu nezapisuje.
11. **Nástroje skici mají jednu úroveň:** vstup je `Anchor` (místo a volitelné přichycení). Aplikace do něj dává kliknutí, AI souřadnice nebo existující bod.
12. **Generátor předává „fakta"** (střed, roztečný poloměr, počet zubů, natočení) dalšímu generátoru, který se na něj odkazuje. Tím je odkaz „v záběru s" obecný mechanismus katalogu, ne výjimka ozubení.
13. **Strana „skrz vše" nemá výchozí hodnotu.** Scénář ukázal, že záleží na poloze roviny skici vůči tělesu; kandidát na výchozí hodnotu je `both`.

## Nálezy ze zápisu scénáře 9

Co se ukázalo, když se scénář psal příkaz po příkazu.

1. **Jedna společná skica nestačí na všechno.** Obrysy různých dílů se v jedné skice kříží (příruba centrálního kola a díra satelitu), a křížení běžných křivek profil zneplatní. Skica kol proto nese jen roztečné kružnice a to, co se s ničím nekříží; každý další díl má vlastní skicu a polohy opakuje kótami. Scénář to unese, ale je to důvod, proč je promítnutí geometrie z jiné skici první v [backlog.md](../backlog.md).
2. **Díra satelitu jsou dvě oblasti.** Čep a díra jsou soustředné kružnice ve stejné skice, takže díra je mezikruží a kruh vybrané dohromady. Funguje to, ale kdo to neví, vyřízne jen mezikruží.
3. **Strana „skrz vše" se plete.** Deska leží pod rovinou skici (`backward`), příruba nad ní (`forward`), šroub prochází oběma (`both`). Viz rozhodnutí 13.
4. **ID musí být jedinečná v celém dokumentu,** včetně entit všech skic. První verze skriptu měla feature `pin` a křivku `pin`. Nástroj skici v MCP proto musí generovat ID, která v dokumentu nejsou, a `sketch_tool` to má hlídat.
5. **Osa pole přes bod skici ve scénáři není potřeba.** Všechna pole jdou kolem základní osy Z. Varianta `sketchPoint` zůstává pro pole mimo osu modelu.
6. **Odkaz „v záběru s" vede na feature, ne na těleso.** Satelit se odkazuje na `sunTeeth` (přidání k tělesu `sun`), koruna na `planet`. Je to správně, jen to GUI musí nabízet jako výběr vysunutí s ozubením.
7. **Odvozená ID těles se musí dát zjistit.** Export po tělesech potřebuje `planets/1` a `planets/2`; scénář je čte z `features.planets.bodies` (rozhodnutí 9).

## Co kontrakt neřeší

- Rozložení a vzhled UI; to patří do `ui.md` při implementaci každého bodu.
- Přesný seznam funkcí ve výrazech a pravidla jmen parametrů (v typech je jen místo pro ně).
- Vnitřní stavbu přepočtu: dosazení výrazů, cache, zápis hodnot. Rozhraní receptu nástroje a generátoru jsou v `contract.ts` jen pro úplnost.
- Převod dokumentu verze 1 na verzi 2 krok po kroku.

# Funkce UI a potřebné API

Stav: **návrh**. UI není těžištěm PoC. Dokument vyjmenovává funkce, které UI nabídne, a ke každé uvádí, co k ní potřebuje od enginu. Slouží k ověření, že API v [architecture.md](architecture.md) je úplné. Rozložení obrazovky se zatím neřeší.

Poslední úprava: 2026-11-13

## Jak číst tabulky

- **Příkaz** je to, co UI posílá přes `execute` (nebo `preview` pro náhled).
- **Čte** je to, co UI potřebuje z `EngineState` (`document`, `evaluation`).
- **Stav UI** jsou věci, o kterých engine neví.

## Soubor a historie úprav

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Nový dokument | `load` s prázdným dokumentem | |
| Uložit | `save()` | |
| Otevřít | `load(json)` | |
| Export sítě | `exportMesh('stl' \| '3mf')` | |
| Undo, redo | `undo()`, `redo()` | `canUndo`, `canRedo` |
| Překreslení po změně | `subscribe(listener)` | celý `EngineState` |

## Zobrazení modelu

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vykreslit tělesa | | `bodies[id].solid` |
| Vykreslit obrysy | | `bodies[id].edges[i].polyline` |
| Vykreslit skici ve 3D | | `features[id].plane`, `sketch.points`, `sketch.radii`, `document` (křivky) |
| Vykreslit roviny | | `features[id].plane` |
| Zvýraznit a vybrat stěnu | | index trojúhelníku → `solid.faceIds` → `faces[i].name`, `faces[i].planar` |
| Zvýraznit a vybrat hranu | | `edges[i].name`, `edges[i].kind`, `edges[i].polyline` |
| Zvýraznit a vybrat oblast skici | | `sketch.regions[i].ref`, `.loops` |
| Zvýraznit a vybrat entitu skici | | `sketch.points`, `document` (křivky); test zásahu dělá UI |
| Skrýt a zobrazit těleso, skicu, rovinu | stav UI | |

## Časová osa

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Zobrazit seznam features | | `document.features` |
| Zobrazit stav feature (ok, varování, chyba, potlačená) | | `features[id].status`, `.error` |
| Vložit feature na pozici | `addFeature` s pozicí | |
| Značka pozice (kam se vkládá) | stav UI | |
| Zobrazit model v okamžiku feature | `getState(at)` | |
| Upravit feature | `updatePlane`, `updateExtrude`, příkazy skici | `getState(at)` |
| Přejmenovat | `renameFeature` | |
| Potlačit a obnovit | `setSuppressed` | |
| Přesunout | `moveFeature` | |
| Smazat (závislé zůstanou v chybě) | `removeFeature` | |

## Vlastní rovina

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vybrat základ (rovina nebo rovinná stěna) | | `faces[i].planar`, `features[id].plane` |
| Náhled při zadávání posunu | `preview(addFeature)` | |
| Potvrdit | `addFeature` (plane) | |
| Změnit posun nebo základ | `updatePlane` | |

## Skica: založení

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vybrat rovinu nebo rovinnou stěnu | | `faces[i].planar`, `features[id].plane` |
| Založit skicu | `addFeature` (sketch) | |
| Natočit kameru na rovinu | stav UI | `features[id].plane` |
| Promítnout obrys stěny při založení | `batch` z `addExternal` | hrany, jejichž jméno obsahuje danou stěnu a mají `kind` `line` nebo `circle` |
| Změnit rovinu skici | `setSketchPlane` | |

## Skica: kreslení

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Bod | `addPoint` | |
| Úsečka, řetězená úsečka | `batch`: `addPoint`, `addCurve` | |
| Obdélník | `batch`: body, čtyři úsečky, vazby | |
| Kružnice, oblouk | `batch`: `addPoint`, `addCurve` | |
| Přichycení na existující bod | znovu použije ID bodu, žádná vazba | `sketch.points` |
| Přichycení na křivku | `addConstraint` (`pointOnCurve`) ve stejném `batch` | |
| Odvozené vazby při kreslení (vodorovná, svislá, kolmá…) | `addConstraint` ve stejném `batch`; odvozuje UI | `sketch.points` |
| Tažení bodu | `preview(dragPoint, at)` při pohybu (počítá jen po upravovanou skicu), `execute(dragPoint)` při puštění | |
| Přepnout konstrukční geometrii | `setConstruction` | |
| Smazat entitu (i se závislými vazbami) | `removeEntity` | |
| Promítnout hranu tělesa | `addExternal` | `edges[i].name`, `.kind` |
| Zrušit promítnutí | `removeExternal` | |

## Skica: vazby a kóty

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Přidat geometrickou vazbu | `addConstraint` | typy vybraných entit (`document`) |
| Přidat kótu (typ podle výběru, viz níže) | `addConstraint` | |
| Změnit hodnotu kóty | `setConstraintValue` | |
| Přepnout řídicí a referenční kótu | `setConstraintValue` (`driving`) | |
| Smazat vazbu nebo kótu | `removeConstraint` | |
| Zobrazit vazby a kóty | | `document` (vazby), `sketch.points` |
| Zobrazit hodnotu referenční kóty | | spočítá UI ze `sketch.points` |
| Zobrazit stav skici | | `sketch.degreesOfFreedom` |
| Zvýraznit konfliktní a nadbytečné vazby | | `sketch.conflicting`, `sketch.redundant` |

Typ kóty podle výběru:

| Výběr | Vazba |
|---|---|
| dva body | `distance`, při vodorovném nebo svislém umístění `horizontalDistance` / `verticalDistance` |
| úsečka | `distance` mezi jejími koncovými body |
| bod a úsečka | `distancePointLine` |
| dvě úsečky | `angle` |
| kružnice | `diameter` |
| oblouk | `radius` |

## Extrude

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vybrat oblasti skici | | `sketch.regions` |
| Navrhnout výchozí operaci a cílové těleso | logika UI | `document` (rovina skici), `bodies` |
| Náhled při změně hodnot | `preview(addFeature)` | |
| Potvrdit | `addFeature` (extrude) | |
| Změnit vzdálenost, operaci, oblasti, cíl | `updateExtrude` | |

## Chyby a oprava referencí

| Chyba | Co UI nabídne | Příkaz |
|---|---|---|
| `brokenReference` na rovinu skici | vybrat novou rovinu nebo stěnu | `setSketchPlane` |
| `brokenReference` na základ vlastní roviny | vybrat nový základ | `updatePlane` |
| `brokenReference` na promítnutou hranu | vybrat novou hranu, nebo promítnutí zrušit | `removeExternal`, `addExternal` |
| `brokenReference` na cílové těleso | vybrat jiné těleso | `updateExtrude` |
| `noProfile` | vybrat oblasti znovu, nebo opravit skicu | `updateExtrude` |
| `nonPlanarFace` | vybrat jinou stěnu | `setSketchPlane` |
| `degenerateProjection`, `unsupportedProjection` | zrušit promítnutí nebo vybrat jinou hranu | `removeExternal`, `updateExternal` |
| `sketchConflict` (varování, model zůstává) | otevřít skicu, smazat konfliktní vazbu | `removeConstraint` |

Text chyby čte UI z `features[id].error.message`, dotčené reference z `error.refs`.

## Mezery nalezené při sestavování

Tyto požadavky v původním návrhu API chyběly a jsou do architektury doplněné (D24):

1. Složený příkaz `batch`, aby jedna uživatelská akce byla jeden krok undo.
2. `addFeature` s pozicí pro vkládání doprostřed logu.
3. `getState(at)` pro zobrazení modelu v okamžiku upravované feature.
4. Konstrukční geometrie (`construction` u křivky, `setConstruction`).
5. Data pro výběr: rovinnost stěn, hrany s lomenou čarou a druhem, oblasti skici se smyčkami.
6. Pravidla mazání: ve skice kaskáduje, na časové ose ne.
7. `renameFeature`, `updatePlane`, `setSketchPlane`.

Otevřená mezera: výměna promítnuté hrany přes `removeExternal` + `addExternal` změní ID, takže vazby na původní promítnutí zaniknou. Pro opravu rozbité reference se hodí příkaz `updateExternal`, který ID zachová. Doplněno do architektury.

## Vědomě vynecháno

- Stav určenosti po jednotlivých entitách skici (engine hlásí stupně volnosti jen za celou skicu).
- Manipulátory ve 3D (tažení šipky u extrude).
- Ořez a prodloužení křivek, zrcadlení, pole.
- Viditelnost uložená v dokumentu.

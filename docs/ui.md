# Funkce UI a potřebné API

Stav: **implementováno v `packages/app`** v rozsahu popsaném na konci dokumentu. UI není těžištěm PoC. Dokument vyjmenovává funkce, které UI nabídne, a ke každé uvádí, co k ní potřebuje od enginu. Slouží k ověření, že API v [architecture.md](architecture.md) je úplné. Rozložení obrazovky se zatím neřeší.

Poslední úprava: 2026-11-14

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
| Export sítě | `exportMesh('stl')` | |
| Undo, redo | `undo()`, `redo()` | `canUndo`, `canRedo` |
| Překreslení po změně | `subscribe(listener)` | celý `EngineState` |

## Zobrazení modelu

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Vykreslit tělesa | | `bodies[id].solid` |
| Vykreslit obrysy | | `bodies[id].edges[i].segments` (úsečky; hrany druhu `coplanar` se nekreslí) |
| Vykreslit skici ve 3D | | `features[id].plane`, `sketch.points`, `sketch.radii`, `document` (křivky) |
| Vykreslit roviny | | `features[id].plane` |
| Zvýraznit a vybrat stěnu | | index trojúhelníku → `solid.faceIds` → `evaluation.faceNames`, `faces[i].planar` |
| Zvýraznit a vybrat hranu | | `edges[i].name`, `edges[i].kind`, `edges[i].segments` |
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
| Promítnout obrys stěny při založení | `batch` z `addExternal` | hrany, jejichž jméno obsahuje danou stěnu a mají `kind` `line` nebo `circle`; `kind` hrany se zapíše do promítnutí |
| Změnit rovinu skici | `setSketchPlane` | |

## Skica: kreslení

| Funkce | Příkaz / volání | Čte |
|---|---|---|
| Bod | `addPoint` | |
| Úsečka, řetězená úsečka | `batch`: `addPoint`, `addCurve` | |
| Obdélník | `batch`: body, čtyři úsečky, vazby | |
| Kružnice, oblouk | `batch`: `addPoint`, `addCurve` | |
| Přichycení na existující vlastní bod nebo počátek | znovu použije ID bodu, žádná vazba | `sketch.points`, `document` (které body jsou vlastní) |
| Přichycení na promítnutý bod | nový vlastní bod a `addConstraint` (`coincident`) ve stejném `batch`; křivka na promítnutý bod odkazovat nesmí | `sketch.points` |
| Přichycení na křivku | `addConstraint` (`pointOnCurve`) ve stejném `batch` | |
| Odvozené vazby při kreslení (vodorovná, svislá, kolmá…) | `addConstraint` ve stejném `batch`; odvozuje UI | `sketch.points` |
| Tažení bodu | `preview(dragPoint, at)` při pohybu (počítá jen po upravovanou skicu), `execute(dragPoint)` při puštění | |
| Přepnout konstrukční geometrii | `setConstruction` | |
| Kreslit rovnou konstrukčně | `addCurve` s `construction: true` | |
| Smazat entitu (i se závislými vazbami) | `removeEntity` | |
| Promítnout hranu tělesa | `addExternal` (s `kind` podle hrany) | `edges[i].name`, `.kind` |
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
| Zobrazit hodnotu referenční kóty | | `sketch.measurements` (počítá engine) |
| Zobrazit stav skici | | `sketch.degreesOfFreedom` |
| Zvýraznit konfliktní vazby | | `sketch.conflicting` |
| Ukázat vazby navíc a duplicity, smazat duplicity | `removeConstraint` | `diagnoseSketch` (`removable`, `duplicates`) |
| Vysvětlit označenou vazbu: ze kterých vazeb plyne | | `explainConstraint` |
| Odlišit volné a určené entity, poradit s ukotvením | | `diagnoseSketch` (`free`, `degreesOfFreedom`) |
| Upozornit na křížící se křivky | | `sketch.valid` |

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
| `brokenProjection` (varování, hrana zmrazená na poslední hodnotě) | vybrat novou hranu, nebo promítnutí zrušit | `updateExternal`, `removeExternal` |
| `brokenReference` na cílové těleso | vybrat jiné těleso | `updateExtrude` |
| `brokenReference` na zdrojovou skicu extrude | vybrat jinou skicu a její oblasti; ID extrude zůstane | `updateExtrude` (`sketch`, `regions`) |
| `noProfile` | vybrat oblasti znovu, nebo opravit skicu | `updateExtrude` |
| `nonPlanarFace` | vybrat jinou stěnu | `setSketchPlane` |
| `degenerateProjection`, `unsupportedProjection` (varování) | vybrat jinou hranu stejného druhu, nebo promítnutí zrušit a založit nové | `updateExternal`, `removeExternal` |
| `invalidProfile` | otevřít skicu a odstranit křížení křivek | příkazy skici |
| `noEffect` (varování) | upravit vzdálenost, oblasti nebo cíl | `updateExtrude` |
| `emptyResult` | upravit vzdálenost nebo oblasti | `updateExtrude` |
| `sketchConflict` (varování, model zůstává) | otevřít skicu, smazat konfliktní vazbu | `removeConstraint` |

Text chyby čte UI z `features[id].error`, varování z `features[id].warnings`; dotčené reference jsou v `refs`.

Neplatný příkaz (`invalidCommand`) dokument nezmění; UI zobrazí zprávu z `CommandResult`. Patří sem i řídicí vazba jen mezi pevnými entitami (počátek, promítnutá geometrie): UI ji má nabídnout jen jako referenční kótu.

## Mezery nalezené při sestavování

Tyto požadavky v původním návrhu API chyběly a jsou do architektury doplněné (D24):

1. Složený příkaz `batch`, aby jedna uživatelská akce byla jeden krok undo.
2. `addFeature` s pozicí pro vkládání doprostřed logu.
3. `getState(at)` pro zobrazení modelu v okamžiku upravované feature.
4. Konstrukční geometrie (`construction` u křivky, `setConstruction`).
5. Data pro výběr: rovinnost stěn, hrany s úsečkami a druhem, oblasti skici se smyčkami.
6. Pravidla mazání: ve skice kaskáduje, na časové ose ne.
7. `renameFeature`, `updatePlane`, `setSketchPlane`.

8. `updateExternal`: oprava promítnuté hrany zachová její ID, takže vazby na ni zůstanou.
9. ID nových entit generuje UI a posílá je v příkazech, aby dávka mohla odkazovat na právě vytvořené entity.
10. `updateExtrude` umí změnit zdrojovou skicu, aby šla extrude po smazání skici opravit bez ztráty ID.
11. Promítnutí nese `kind`, takže příkazy i načtení dokumentu jdou ověřit bez přepočtu.

## Vědomě vynecháno

- Stav určenosti po jednotlivých entitách skici (engine hlásí stupně volnosti jen za celou skicu).
- Manipulátory ve 3D (tažení šipky u extrude).
- Ořez a prodloužení křivek, zrcadlení, pole.
- Viditelnost uložená v dokumentu.

## Stav implementace

Ukázková aplikace (`packages/app`, rozhodnutí v D31) nabízí všechny funkce z tabulek výše s těmito rozdíly:

- **Přichycení a odvozené vazby**: přichycení na bod a na křivku je hotové; z odvozených vazeb jen vodorovná a svislá u volného konce úsečky.
- **Kóta mezi dvěma body** je vždy `distance`; vodorovná a svislá mají vlastní tlačítko, podle umístění myší se nerozlišují.
- **Vazby se zobrazují v seznamu** v panelu skici (s hodnotou, přepínačem řídicí/referenční a zvýrazněním konfliktních); v pohledu jsou jen popisky kót.
- **Konstrukční kreslení**: přepínač Konstrukčně na liště skici. Dokud je zapnutý, kreslicí nástroje zakládají konstrukční křivky (čárkovaně, netvoří profil); odvozené vazby vznikají stejně. Existující křivky se přepínají tlačítkem v panelu jako dřív.
- **Diagnostika skici (D32)** je v panelu pod stavem skici:
  - Souhrn „Vazby navíc: N, z toho duplicity: M". V seznamu jsou označené právě vazby ze sady, kterou engine navrhuje odebrat (`navíc`, `duplicita`); starší vazby ze stejné závislé skupiny označené nejsou. Tlačítko maže jen duplicity, u ostatních volí uživatel.
  - Kliknutí na řádek vazby ji označí. Panel pak jednou větou řekne, jestli je potřebná, nebo ze kterých vazeb plyne; ty se v seznamu podbarví a v pohledu se zvýrazní entity označené vazby (azurově) a vazeb, ze kterých plyne (fialově). Druhé kliknutí nebo Esc označení ruší.
  - Volné entity jsou v pohledu modré, určené tmavé. Panel volné body a poloměry vyjmenuje, umí je vybrat a poradí, když skicu dourčí ukotvení jednoho bodu.
  - Vazbu, kterou skica už má, aplikace nepřidá a řekne to; ze sady vazeb přidá jen ty, které chybí.
- **Oprava referencí**: rovina skici se mění tlačítkem u vybrané skici, základ roviny a skica, oblasti a cíl vysunutí v jejich panelu. Promítnutá geometrie má v panelu skici seznam se stavem; odtud jde promítnutí zrušit nebo promítnout znovu na jinou hranu (i když ho přepočet nedokázal vyhodnotit a v pohledu není).
- **Viditelnost** se přepíná na časové ose a platí pro feature i těleso, které založila.


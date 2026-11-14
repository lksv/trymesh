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
| Upravit feature | `updateFeature`, příkazy skici | `getState(at)` |
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
| Změnit posun nebo základ | `updateFeature` | |

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
| Choose the profile source and fill in a generator's operands, parameters and references | UI logic (`changeExtrude`) | `GENERATORS`; entities of the sketch; earlier extrusions |
| Show what the generator built | | `evaluation.features[id].facts` |
| Navrhnout výchozí operaci a cílové těleso | logika UI | `document` (rovina skici), `bodies` |
| Choose the extent: a distance with a start, or through all with a side | UI logic (`changeExtrude`) | |
| Choose the targets: one body for an addition, several for a cut | UI logic (`changeExtrude`) | `bodies` before the feature |
| Náhled při změně hodnot | `preview(addFeature)` | |
| Potvrdit | `addFeature` (extrude) | |
| Change the extent, the operation, the regions, the targets | `updateFeature` | |

The form (D35, points 2 and 3), top to bottom: profile, sketch, regions or the generator's fields, operation, extent, targets.

- **Profile** is a select with *Sketch regions* and one entry per profile generator (`GENERATORS`; today *Involute gear*). Regions are picked by clicking in the view; a generated profile has none and the view does not offer them.
- **A generated profile** is a form built from the catalog entry: a select per operand listing the entities of the sketch of the accepted kinds (own curves, construction ones marked, and projected ones, with their diameter), a field per numeric parameter (a number or an expression; an angle is shown in degrees), a checkbox per flag and a select per reference listing the earlier extrusions with an accepted generator, or *(none)*. A new one starts with the first suitable entity of the sketch and the defaults of the catalog (18 teeth). Changing the sketch picks the operands again.
- Below the fields the form shows the facts of the preview (module, pitch, tip and root diameter, rotation); the same line is shown at a selected extrusion in the model panel. Warnings of the generator (`gearMesh` with its reason, `gearInterference`) appear as the problem of the preview in the warning style.
- When editing, the form sends the whole profile; a reference the draft no longer has is sent as `null`, because the patch merges with the feature.
- The form remembers the profile of each kind the draft had last (the picked regions, the generator's operands, parameters and references) and returns to it when the profile select comes back, as long as the sketch is the same.

- **Extent** is a select with *Distance* and *Through all*. *Through all* is enabled only for the operation *cut*; switching the operation away from a cut turns the extent back into a distance. The form remembers the distance extent the draft had last (start, distance and their expressions) and returns to it, both from the extent select and from the operation; a draft that never had one gets 10 mm from the sketch plane.
- **Distance** shows two fields, *Start* (offset of the start from the sketch plane along its normal, default 0) and *Distance*. Both take a number or an expression.
- **Through all** shows the select *Side*: *Both sides* (the default for a new one, D35 decision 13), *Along the normal*, *Against the normal*, and a hint that on a face the normal points out of the body.
- **Targets.** An addition has a select with one body. A cut has one checkbox per body that exists before the feature; a target that no longer exists stays in the list marked as missing, so that it can be unticked. Unticking every target leaves the list empty and the preview says that a cut needs a target; the form does not pick a body on its own. Switching such a draft to an addition does pick one (the last body), because the select always displays some body.
- **Problems of the preview.** An invalid command and an error of the feature are shown in the error style below the form, a warning in the warning style. An issue about bodies names them: the targets a cut missed (`noEffect`), the target a cut would remove (`emptyResult`), a missing target (`brokenReference`). The same text is used in the timeline and in the model panel.
- The model panel describes a selected extrusion by its operation, extent (distance and a non-zero start, or through all with the side), number of regions and target bodies.

## Parameters, checks and expressions (D35, point 1)

| Function | Command / call | Reads |
|---|---|---|
| Show the parameter table with values | | `document.parameters`, `evaluation.parameters` |
| Add or change a parameter | `setParameter` | syntax error from `error.expression`; other errors from `evaluation.parameters[name]` |
| Check an expression while typing | `analyzeExpression` | parameter names |
| Rename, delete a parameter | `renameParameter`, `removeParameter` | |
| Show checks and their state | | `document.checks`, `evaluation.checks` |
| Add, change, rename, delete a check | `setCheck`, `renameCheck`, `removeCheck` | |
| Warn about a check a command made fail | | `evaluation.checks` before and after the command |
| Which fields of a feature take an expression, with unit and range | `fieldsOf(feature)`; for a draft `FEATURE_TYPE_INFO[type].fields` | |
| Show a field: the expression, next to it its value | | `feature.expressions[path]`, the number in the field |
| Enter a number or an expression | `updateFeature` from the draft, `setConstraintValue` for a dimension | |
| Edit an existing feature without losing expressions | the draft starts from `featureInput(feature)` | |
| Enter and show an angle | a bare number is in degrees and is converted; an expression is sent unchanged (`deg(30)`) and its value is shown in degrees | unit from the catalog |
| Rejected expression (unknown name, out of range) | | `error.message`, `error.expression` |
| Mark a field whose expression stopped evaluating | | `evaluation.features[id].fieldErrors` |
| Preview while typing | `preview(...)` | `evaluation.features[id].values` |

## Chyby a oprava referencí

| Chyba | Co UI nabídne | Příkaz |
|---|---|---|
| `brokenReference` na rovinu skici | vybrat novou rovinu nebo stěnu | `setSketchPlane` |
| `brokenReference` na základ vlastní roviny | vybrat nový základ | `updateFeature` |
| `brokenProjection` (varování, hrana zmrazená na poslední hodnotě) | vybrat novou hranu, nebo promítnutí zrušit | `updateExternal`, `removeExternal` |
| `brokenReference` na cílové těleso | vybrat jiné těleso | `updateFeature` |
| `brokenReference` na zdrojovou skicu extrude | vybrat jinou skicu a její oblasti; ID extrude zůstane | `updateFeature` (`profile.sketch`, `profile.regions`) |
| `noProfile` | vybrat oblasti znovu, nebo opravit skicu | `updateFeature` |
| `nonPlanarFace` | vybrat jinou stěnu | `setSketchPlane` |
| `degenerateProjection`, `unsupportedProjection` (varování) | vybrat jinou hranu stejného druhu, nebo promítnutí zrušit a založit nové | `updateExternal`, `removeExternal` |
| `invalidProfile` | otevřít skicu a odstranit křížení křivek | příkazy skici |
| `noEffect` (varování) | upravit vzdálenost, oblasti nebo cíl | `updateFeature` |
| `emptyResult` | upravit vzdálenost nebo oblasti | `updateFeature` |
| `sketchConflict` (varování, model zůstává) | otevřít skicu, smazat konfliktní vazbu | `removeConstraint` |
| `invalidExpression` (an error; a warning for a sketch, which keeps the last valid value) | fix the expression or the parameter, or enter a number | `setParameter`, `updateFeature`, `setConstraintValue` |

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
7. `renameFeature`, `updateFeature`, `setSketchPlane`.

8. `updateExternal`: oprava promítnuté hrany zachová její ID, takže vazby na ni zůstanou.
9. ID nových entit generuje UI a posílá je v příkazech, aby dávka mohla odkazovat na právě vytvořené entity.
10. `updateFeature` umí změnit zdrojovou skicu, aby šla extrude po smazání skici opravit bez ztráty ID.
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
- **Vazby z katalogu (D34)**: tlačítka geometrických vazeb v panelu skici se berou z katalogu enginu včetně jména a nápovědy. Souměrnost: vyberte dva body a osu; střed úsečky: bod a úsečku. Tlačítko je dostupné, jen když výběr projde i vlastním pravidlem vazby (souměrný bod nesmí být koncem osy).
- **Propojení s AI (D33)**: tlačítko AI na liště připojí aplikaci k MCP serveru. Dokud je připojená, AI čte a mění otevřený dokument; její změny jsou běžné příkazy a jdou vrátit přes Zpět. Rozpracované vysunutí nebo rovina se při změně od AI zruší.
- **Konstrukční kreslení**: přepínač Konstrukčně na liště skici. Dokud je zapnutý, kreslicí nástroje zakládají konstrukční křivky (čárkovaně, netvoří profil); odvozené vazby vznikají stejně. Existující křivky se přepínají tlačítkem v panelu jako dřív.
- **Diagnostika skici (D32)** je v panelu pod stavem skici:
  - Souhrn „Vazby navíc: N, z toho duplicity: M". V seznamu jsou označené právě vazby ze sady, kterou engine navrhuje odebrat (`navíc`, `duplicita`); starší vazby ze stejné závislé skupiny označené nejsou. Tlačítko maže jen duplicity, u ostatních volí uživatel.
  - U skici v konfliktu se ze souhrnu ukáže jen počet duplicit a tlačítko pro jejich smazání (smazání může konflikt odstranit).
  - Kliknutí na řádek vazby ji označí. Pod řádkem se pak jednou větou řekne, jestli je potřebná, nebo ze kterých vazeb plyne; ty se v seznamu podbarví a v pohledu se zvýrazní entity označené vazby (azurově) a vazeb, ze kterých plyne (fialově). Druhé kliknutí nebo Esc označení ruší.
  - Volné entity jsou v pohledu modré, určené tmavé. Konstrukční křivky si nechávají svou barvu a čárkování; volnost ukazují jejich body. Dokud skica není vyřešená, o volnosti se nedá nic říct a vlastní geometrie je šedomodrá. Panel volné body a poloměry vyjmenuje, umí je vybrat a poradí, když skicu dourčí ukotvení jednoho bodu.
  - Vazbu, kterou skica už má, aplikace nepřidá a řekne to; ze sady vazeb přidá jen ty, které chybí. Platí to i pro referenční kótu mezi pevnými entitami.
- **Oprava referencí**: rovina skici se mění tlačítkem u vybrané skici, základ roviny a skica, oblasti a cíl vysunutí v jejich panelu. Promítnutá geometrie má v panelu skici seznam se stavem; odtud jde promítnutí zrušit nebo promítnout znovu na jinou hranu (i když ho přepočet nedokázal vyhodnotit a v pohledu není).
- **Viditelnost** se přepíná na časové ose a platí pro feature i těleso, které založila.
- **Parameters and checks (D35, point 1)** are in the model panel, below the selected feature. A row is name, expression and value (or state of a check); both name and expression are edited in place and sent when the field is committed. An expression is checked while typing (red field, the reason in the tooltip). A check that a command made fail is announced in the status bar; failed checks are highlighted in the list.
- **Fields with an expression**: the distance of an extrusion, the offset of a plane and the value of a driving dimension are text fields that take a number or an expression. Next to an expression in a draft is its value from the preview; a dimension shows it in the tooltip and in the label in the view. A bare number in an angle field is in degrees; an expression is in radians (`deg(30)`). A decimal comma in a bare number is accepted. An expression that is itself a bare number (`"0.5"` set over MCP) is shown as that number converted to degrees, so what the field shows always reads the same way as what the user would type.
- New UI texts are in English (owner's instruction of 2026-11-14 for all new text in the repository); older texts stay in Czech until they are translated.


# UI: the sketch

Part of [ui.md](../ui.md); how to read the tables is said there. Starting a sketch, drawing, constraints and dimensions.

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
| Obdélník | `sketchTool('rectangle', …)` of the engine, then `batch` | `SKETCH_TOOLS`; the sketch and its solved state |
| Polygon (regular) | `sketchTool('polygon', …)` of the engine, then `batch` | `SKETCH_TOOLS`, `MAX_POLYGON_SIDES`; the sketch and its solved state |
| Fillet of a corner (D52) | `sketchTool('fillet', …)` of the engine, then `batch` as the tool made it (with `setCurvePoint` and the `updateFeature` patches) | `SKETCH_TOOLS`; the sketch, its solved state, the parameters and the document (`SketchContext.tool`); `ids.patched`, `moved`, `shortened` for the status line |
| Re-point a point of a curve (D52) | `setCurvePoint` | `CURVE_POINTS` (the points by the kind of the curve), `nearestCurvePoint` (the one chosen at first) |
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
| Change a coordinate of a fixed point | `setField` (`constraints/<id>/x`, `…/y`) | `document` (the constraint and its expressions) |
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

## Implementation status

What the app (`packages/app`) does differently from the tables above, or beyond them:

- **Přichycení a odvozené vazby**: přichycení na bod a na křivku je hotové; z odvozených vazeb jen vodorovná a svislá u volného konce úsečky.
- **Kóta mezi dvěma body** je vždy `distance`; vodorovná a svislá mají vlastní tlačítko, podle umístění myší se nerozlišují.
- **Vazby se zobrazují v seznamu** v panelu skici (s hodnotou, přepínačem řídicí/referenční a zvýrazněním konfliktních); v pohledu jsou jen popisky kót.
- **Vazby z katalogu (D34)**: tlačítka geometrických vazeb v panelu skici se berou z katalogu enginu včetně jména a nápovědy. Souměrnost: vyberte dva body a osu; střed úsečky: bod a úsečku. Tlačítko je dostupné, jen když výběr projde i vlastním pravidlem vazby (souměrný bod nesmí být koncem osy).
- **Equal radius and fixed point (D35, point 6)**: both are buttons from the catalog. *Equal radius* takes two circles or arcs. *Fixed point* takes one or more own points and fixes each where it is, with the unrounded position (a rounded coordinate could contradict what already holds the point); the origin and points of projected geometry are not offered. The row of a fixed point in the list of constraints has the fields *X* and *Y*: each takes a number or an expression, shows the value of an expression in its tooltip and is sent by `setField`. A constraint with named values other than a dimension gets such fields from the catalog, so the next one needs no change of the app.
- **Polygon (D35, point 7)**: the tool *Polygon* on the sketch bar takes two clicks, the centre and a vertex; both snap like the ends of any curve. While it is active the panel has its options: the number of sides (3 to 64, a hexagon by default) and the dimension of the size (none, the diameter of the circumscribed circle, or the size across flats, which is offered for an even number of sides only; with an odd number the choice falls back to the circle, as the select shows). The rubber band shows the circle and the polygon as it will be drawn. The dimension takes the size as drawn (rounded to 0.01 unless the vertex snapped to a point or a curve) and is then edited in the list of constraints like any other. The polygon is drawn turned as it should be and a constraint on a side then holds it: a constraint that has to turn it by more than about 30° can leave it folded (the sketch then has no closed region; *Zpět* brings the polygon back), see architecture.md, Sketch tools. The rectangle and the polygon are drawn by the sketch tools of the engine, the same ones MCP runs, and the snapping of all drawing tools uses the engine's `placeAnchor` and `anchorPosition`.
- **Fillet (D52)**: the tool *Fillet* on the sketch bar takes one click on a point where two lines meet; a click on no point says what the tool wants. While it is active the panel has its option *Radius*, a number or an expression (2 mm at first, remembered for the next corner; a radius that is not positive or an expression in error is marked and not taken). A refusal of the tool is said in the status line with its reason (the corner that is not one, the bound of a radius that does not fit). After a fillet the status line says how many features got the arc in their profile and names the features of `moved` and `shortened`. The batch is sent as the tool made it: the switch *Konstrukčně* does not turn its arc into a construction curve (the arc is one when its lines are). The context of the tool is made with the open sketch (`sketchContextOf`): the sketch, its solved state, the values of the parameters and the document; the rectangle and the polygon take the same context.
- **Re-point (D52)**: when the selection is one own curve and one own point or the origin that is not a point of the curve already, the panel of the sketch has a row *Point of* the curve (by its ID, *Point of c1*) with a choice of the points of the curve by its kind (*Start*, *End* of a line; *Centre* of a circle; *Centre*, *Start*, *End* of an arc) and the button *Re-point*, which sends `setCurvePoint`. The point of the curve nearest to the selected point is chosen at first; which one that is comes from the engine (`nearestCurvePoint`).
- **Konstrukční kreslení**: přepínač Konstrukčně na liště skici. Dokud je zapnutý, kreslicí nástroje zakládají konstrukční křivky (čárkovaně, netvoří profil); odvozené vazby vznikají stejně. Existující křivky se přepínají tlačítkem v panelu jako dřív.
- **Diagnostika skici (D32)** je v panelu pod stavem skici:
  - Souhrn „Vazby navíc: N, z toho duplicity: M". V seznamu jsou označené právě vazby ze sady, kterou engine navrhuje odebrat (`navíc`, `duplicita`); starší vazby ze stejné závislé skupiny označené nejsou. Tlačítko maže jen duplicity, u ostatních volí uživatel.
  - U skici v konfliktu se ze souhrnu ukáže jen počet duplicit a tlačítko pro jejich smazání (smazání může konflikt odstranit).
  - Kliknutí na řádek vazby ji označí. Pod řádkem se pak jednou větou řekne, jestli je potřebná, nebo ze kterých vazeb plyne; ty se v seznamu podbarví a v pohledu se zvýrazní entity označené vazby (azurově) a vazeb, ze kterých plyne (fialově). Druhé kliknutí nebo Esc označení ruší.
  - Volné entity jsou v pohledu modré, určené tmavé. Konstrukční křivky si nechávají svou barvu a čárkování; volnost ukazují jejich body. Dokud skica není vyřešená, o volnosti se nedá nic říct a vlastní geometrie je šedomodrá. Panel volné body a poloměry vyjmenuje, umí je vybrat a poradí, když skicu dourčí ukotvení jednoho bodu.
  - Vazbu, kterou skica už má, aplikace nepřidá a řekne to; ze sady vazeb přidá jen ty, které chybí. Platí to i pro referenční kótu mezi pevnými entitami.

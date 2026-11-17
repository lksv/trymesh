# Funkce UI a potřebné API

Stav: **implementováno v `packages/app`** v rozsahu popsaném na konci souborů jednotlivých oblastí (`ui/`). UI není těžištěm PoC. Dokument vyjmenovává funkce, které UI nabídne, a ke každé uvádí, co k ní potřebuje od enginu. Slouží k ověření, že API v [architecture.md](architecture.md) je úplné. Rozložení obrazovky se zatím neřeší.

Poslední úprava: 2026-11-15

## Jak číst tabulky

- **Příkaz** je to, co UI posílá přes `execute` (nebo `preview` pro náhled).
- **Čte** je to, co UI potřebuje z `EngineState` (`document`, `evaluation`).
- **Stav UI** jsou věci, o kterých engine neví.

## Where it is written

The functions are split by area (D37, part 5), one file per panel or form, each with the implementation status of its area at its end.

| File | What it lists | Sections |
|---|---|---|
| [ui/model.md](ui/model.md) | Opening and saving, undo, the view of the model, the timeline | Soubor a historie úprav; Zobrazení modelu; Časová osa; Implementation status |
| [ui/plane.md](ui/plane.md) | A plane of its own | Vlastní rovina |
| [ui/sketch.md](ui/sketch.md) | Starting a sketch, drawing (with the fillet and the re-point of D52), constraints and dimensions | Skica: založení; Skica: kreslení; Skica: vazby a kóty; Implementation status |
| [ui/extrude.md](ui/extrude.md) | The form of the extrusion, its start at a plane or a face (D66) | Extrude |
| [ui/hole.md](ui/hole.md) | The form of the hole, with the sizes from the catalogs | Hole (D46) |
| [ui/revolve.md](ui/revolve.md) | The form of the revolve: the profile, the axis, a whole turn or an angle | Revolve (D58) |
| [ui/chamfer-fillet.md](ui/chamfer-fillet.md) | The form of the chamfer and of the fillet of edges: the edges picked in the view, the size | Chamfer and fillet (D63) |
| [ui/pattern.md](ui/pattern.md) | The form of the pattern: circular, linear, mirror | Pattern (D35, point 4; the linear pattern and the mirror D53) |
| [ui/combine.md](ui/combine.md) | The forms of the boolean of bodies (with the clearance) and of the split | Combine (D56); Split (D56) |
| [ui/bodies.md](ui/bodies.md) | Collisions, volume and export; the properties of a body; the export form | Bodies: collisions, volume and export (D35, point 5); The properties of a body (D48); The export form (D54) |
| [ui/mesh.md](ui/mesh.md) | The form of a placed mesh and the import of an STL file | Mesh (D55); Implementation status |
| [ui/insert.md](ui/insert.md) | The form of an inserted document, a document file read into a stored one, the stored documents in the model panel | Insert (D62); Implementation status |
| [ui/mechanism.md](ui/mechanism.md) | The mechanism panel: links, joints, the pose and its slider, the view in the pose | The mechanism (D49); The view in the pose (D49); Implementation status |
| [ui/queries.md](ui/queries.md) | The generic form of a query, measuring, the views of queries | Queries (D39); The section view (D38); The gap view (D40); The print view (D42); Implementation status |
| [ui/parameters.md](ui/parameters.md) | Parameters, checks and fields with an expression | Parameters, checks and expressions (D35, point 1); Implementation status |
| [ui/errors.md](ui/errors.md) | Errors of features and the repair of references | Chyby a oprava referencí; Implementation status |

A new panel or form gets a file of its own and a row here.

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

The app (`packages/app`, decided in D31) offers every function of the tables in `ui/`. Where it differs from a table, or does more, is said at the end of the file of that area ("Implementation status"). For the whole app:

- New UI texts are in English (owner's instruction of 2026-11-14 for all new text in the repository); older texts stay in Czech until they are translated.

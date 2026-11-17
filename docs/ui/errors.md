# UI: errors

Part of [ui.md](../ui.md); how to read the tables is said there. Errors of features and the repair of references.

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
| `invalidExtent` (D47) | pick another plane (not parallel to the direction, not through the start), or a smaller gap | `updateFeature` |
| `invalidHole` (D46) | make the head wider than the bore and shallower than the hole, or move the points apart | `updateFeature`, `setField` |
| `invalidPattern` (D53, a grid) | fewer places (the product of the two counts at most 200), or another step or direction where the message names two copies in one place; or `second: null` for a row | `updateFeature`, `setField`, `setParameter` |

Text chyby čte UI z `features[id].error`, varování z `features[id].warnings`; dotčené reference jsou v `refs`.

Neplatný příkaz (`invalidCommand`) dokument nezmění; UI zobrazí zprávu z `CommandResult`. Patří sem i řídicí vazba jen mezi pevnými entitami (počátek, promítnutá geometrie): UI ji má nabídnout jen jako referenční kótu.

## Implementation status

What the app (`packages/app`) does differently from the tables above, or beyond them:

- **Oprava referencí**: rovina skici se mění tlačítkem u vybrané skici, základ roviny a skica, oblasti a cíl vysunutí v jejich panelu. Promítnutá geometrie má v panelu skici seznam se stavem; odtud jde promítnutí zrušit nebo promítnout znovu na jinou hranu (i když ho přepočet nedokázal vyhodnotit a v pohledu není).

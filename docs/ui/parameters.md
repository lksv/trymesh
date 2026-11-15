# UI: parameters

Part of [ui.md](../ui.md); how to read the tables is said there. Parameters, checks and fields with an expression.

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

## Implementation status

What the app (`packages/app`) does differently from the tables above, or beyond them:

- **Parameters and checks (D35, point 1)** are in the model panel, below the selected feature. A row is name, expression and value (or state of a check); both name and expression are edited in place and sent when the field is committed. An expression is checked while typing (red field, the reason in the tooltip). A check that a command made fail is announced in the status bar; failed checks are highlighted in the list.
- **Fields with an expression**: the distance of an extrusion, the offset of a plane and the value of a driving dimension are text fields that take a number or an expression. Next to an expression in a draft is its value from the preview; a dimension shows it in the tooltip and in the label in the view. A bare number in an angle field is in degrees; an expression is in radians (`deg(30)`). A decimal comma in a bare number is accepted. An expression that is itself a bare number (`"0.5"` set over MCP) is shown as that number converted to degrees, so what the field shows always reads the same way as what the user would type.

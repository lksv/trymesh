# UI: the pattern

Part of [ui.md](../ui.md); how to read the tables is said there. The form of the pattern.

## Pattern (D35, point 4)

| Function | Command / call | Reads |
|---|---|---|
| Choose the source: features of the timeline, or a body | UI logic (`changePattern`, `patternSource`) | `document.features` before the pattern, `bodies` before the pattern |
| Choose the axis: a base axis, or a point of a sketch | UI logic (`changePattern`) | sketches before the pattern and their points |
| Count; the full circle, or an angle between the first and the last copy | fields with an expression | `FEATURE_TYPE_INFO.pattern.fields` |
| Preview while the values change | `preview(addFeature)` | |
| Confirm | `addFeature` (pattern) | |
| Change the source, the axis, the count, the span | `updateFeature` | |
| Show the bodies the pattern created | | `evaluation.features[id].bodies` |

The button *Pattern* on the toolbar opens the form; a pattern on the timeline is edited by a double click like every other feature. Top to bottom:

- **Repeat** is a select with *Features* and *A body*. A new pattern takes the feature selected on the timeline when it can be a source (an extrusion that adds or cuts, or one that created a body), otherwise the latest extrusion that adds or cuts, otherwise the latest body. Without either the button says what is missing.
- **Features** shows one checkbox per feature that applies a tool (an extrusion with the operation add or cut, a hole) that lies before the pattern. The list sent to the engine keeps the order of the timeline, whatever the order of the clicks. A source that is no longer there stays in the list marked as missing, so that it can be unticked. With nothing ticked there is nothing to compute and OK is disabled.
- **A body** is a select with the bodies that exist before the pattern; a click on a body in the view picks it too. A body that no longer exists stays selected and marked as missing.
- **Axis** is a select with the three base axes and *Through a point of a sketch*. The latter adds a select with the sketches before the pattern and a select with the points of the chosen sketch (its origin, own points and the points of projected geometry); it starts at the origin of the latest sketch.
- **Count** takes a whole number or an expression and includes the original. **Span** is *Full circle* or *Angle between the first and the last copy*; the angle is a field in degrees, or an expression in radians. The form remembers the angle the draft had last and returns to it from the full circle.
- Below the fields the form lists the bodies the previewed pattern creates, by name ("Pattern 5 / 1"). The view shows the preview: the copies of a tool cut or added, the copies of a body in place.
- **Problems of the preview** use the same texts as everywhere (`issue-text.ts`): a copy the issue is about is named once as "copy N of <feature name>" from `refs` of the shape `{ copy, feature }`, whatever the issue is. A reference to something the document no longer has (a removed source, a point of a sketch) is shown as its ID. An angle typed in degrees outside the range is reported in degrees by the form; an expression is checked by the engine in radians, as it is written.
- **A slow preview waits for a pause in typing.** When the last preview took more than 150 ms (a pattern of features with many copies takes seconds), a change typed into a field is previewed 500 ms after the last keystroke, and the form says so meanwhile. Selects, checkboxes and OK act at once; OK computes the change once, without previewing it again. This holds for every draft form, not only the pattern.

A body is named after the feature that created it; a copy is "<pattern name> / <number>" wherever a body is listed (targets of an extrusion, issues, the model panel). The eye of a pattern of a body hides all its copies at once; a pattern of features has no body of its own, like an addition or a cut. Selecting a pattern on the timeline highlights the faces its copies made, and the model panel says its count, axis, span, source and bodies. A face of a copy is described with its copy ("copy 2 of Pattern 1"); the plane form names the face its base stands on the same way and adds the body.

# UI: queries

Part of [ui.md](../ui.md); how to read the tables is said there. The generic form of a query, measuring, and what a view of a query adds (D39); the section view (D38); the gap view (D40); the print view (D42).

## Queries (D39)

| Function | Command / call | Reads |
|---|---|---|
| List the queries | | `QUERIES`: title and summary of every entry |
| Fill in the arguments | UI state | the description of the arguments (`QUERIES[name].args`); bodies, features, sketches, faces and edges of the shown state for the lists |
| Take a face, an edge or a plane selected in the view | UI state | the pick of the view |
| Ask | `engine.query(name, args, { at })` | the outcome: the result, or the code, the message and the path of the argument |
| Show an answer | UI state | the result; `units` and `significant` of the entry; a view of the query when it has one |

- **The menu.** In the model mode the toolbar has the menu *Queries…* with every query of the catalog of the engine by its title (the summary is the tooltip). A query needs nothing in the app to be there. The button *Collisions* stays and opens the query `interference`.
- **The form** is in the model panel, below the selected feature. One query is open at a time. It has a row per argument, built from the description of the argument:

  | Kind of argument | Control |
  |---|---|
  | a number | a field with its unit; an angle is typed in degrees. A number only: a query does not live in the document, so there is nowhere to keep an expression. The default is the placeholder |
  | a flag, a text, a choice | a checkbox, a text field, a list |
  | a body, a feature, a sketch | a list from the state shown |
  | a constraint | a list of the constraints of the sketch chosen next to it |
  | an entity | what it is (a face, an edge, a sketch point, a body), then its body and its face or edge from lists, or its sketch and point; or *Pick in the view* |
  | a plane | a base plane or a plane feature from a list, or *Pick in the view* for a plane or a planar face |
  | an axis | a base axis, or a sketch and its point |
  | a vector | three numbers |
  | a list | a row per item with *Add* and ✕ |
  | one of several alternatives | a list of the alternatives and the control of the chosen one |
  | a record by key | a row per key; the key from a list of bodies or features, or typed |
  | named fields | a group with a row per field |

- **Selections.** A control of an entity or a plane can be armed (*Pick in the view*); the first such argument that is empty is armed when the form opens. A click in the view on a face, an edge or a plane then goes to the armed argument instead of becoming the selection of the app, and the next empty one is armed. The lists are needed as well: the view never picks an edge that lies inside a flat face, and a face may be hidden behind others.
- **Asking** is the button *Ask* (*Ask again* once there is an answer), not a side effect of typing: a query may take seconds. The engine checks the arguments. An error is written under the form and in the status bar, and the row of the argument it names is marked. A number out of its range, or a text that is not a number, is marked while it is typed and still sent as typed, so the form never asks with a value other than the one it shows. Nothing is armed after a question; *Pick in the view* arms an argument again.
- **The answer** belongs to the document and the place on the timeline it was asked at: it is shown while the insertion marker is there, hidden while it is elsewhere, and dropped when the document changes. The arguments in the form stay. A note in the status bar goes with the answer.
- **Without a view** the answer is a tree of names and values, each level set in from the one it belongs to: numbers rounded as the MCP tool `query` rounds them, with the unit the query gives for their key (an angle in degrees, rounded after it was converted; the items of a list keep the key of the list, so the rows of the tensor under `inertia` of the query `mass` have its unit), a face by its label and its key (the sides of a body share a label), a body by its name. A long list shows its first thirty items.
- **A view** of a query (`QUERY_VIEWS`) replaces the tree with rows of its own, adds to the scene and words the note. Four exist:
  - **Measure**: the exact distance (labelled *Thickness* for two faces that look away from each other, *Gap* for two that look at each other) and the exact angle, when the pair has them; the smallest distance on the mesh with its accuracy, to a thousandth of a millimetre; the faces asked about highlighted; the two points of the smallest distance joined by a line with its length.
  - **Interference** (the collisions, [bodies.md](bodies.md)): asked as soon as it opens; a row per colliding pair and per fit, a click on a row highlights its two bodies.
  - **Section**: the model cut by the plane, below.
  - **Smallest gap**: the pairs of bodies that are close, below.

## The section view (D38)

| Function | Command / call | Reads |
|---|---|---|
| Cut the model by a plane | `engine.query('section', { plane, offset, flip, bodies, outline: 'polylines', maxPoints: 1000000 }, { at })` | the frame of the answer and `below` (the plane the section was taken at), the regions of every body as polygons, `inPlane`, `truncated` |
| Step the plane along its normal | the same, with the offset of the form moved by 1 mm | |

- **The form** is the generic one: the plane (a base plane or a plane feature from the list, or a planar face or a plane picked in the view), the offset, *From the other side*, the bodies. What the view adds to the question (polygons instead of spans, a budget far above any model the app can show) never shows in the form.
- **While the answer is shown the model is cut.** What lies on the side the normal of the plane points to is not drawn: the bodies (drawn two-sided meanwhile, so that a cavity shows its walls), their edges, and a highlighted face or edge. The cut is filled per region, with its holes, and outlined. The model is cut at the plane the section was taken at (the precision of the coordinates under the plane asked for), and the fills lie in that plane, so the edge of the cut bodies and the outline of the fills meet. Sketches and planes do not belong to a body and are not cut.
- **The panel** lists the bodies the plane cuts with their areas (to a thousandth of a square millimetre) and the number of their pieces, says which bodies have a face in the plane (such a body shows that face from one side and nothing from the other), and has the buttons *−1 mm* and *+1 mm*, which move the offset of the form and ask again.
- **Nothing that is cut away is picked**, and nothing is picked through the cut: a click that meets a filled region before anything that is drawn selects nothing, because behind the fill is the inside of a body. A click into a cavity of the cut picks its wall; a click on a wall below the cut picks as ever.
- **A hidden body** loses its fill and its outline with it.
- **An answer too large to draw** (one that was truncated) cuts the model and fills nothing, and the panel says so: a region filled without one of its holes would show material across a cavity.
- The cut ends when the answer goes: on *Close*, when the marker moves elsewhere, on a change of the document.

## The gap view (D40)

| Function | Command / call | Reads |
|---|---|---|
| List the pairs of bodies that are close | `engine.query('gap', { bodies, within, maxPairs }, { at })` | `pairs` (the distance and accuracy, or the contact; the two points and faces), `failed`, `close`, `apart`, `refused`, `checked`, `truncated` |

- **The form** is the generic one: the bodies (all of them when the list is empty), the search distance and the most pairs to list. The query is asked by *Ask*, not when the form opens: it may take a second on a model of many bodies.
- **The panel** has a row per pair, the closest first: the names of the two bodies and the gap with its accuracy, to a thousandth of a millimetre (`0.49 mm ± 0.02 mm`). The accuracy is left out when it rounds to nothing (two bodies of planar faces), and a gap that rounds to nothing reads *under 0.001 mm*. A pair at zero says its contact instead: *touching*, *fit*, *collision*, or *touching or colliding* when the kernel could not tell. The pairs that could not be measured follow with the reason, and a line says when a list was cut and how many pairs there are.
- **A picked row** draws its two bodies in the two colours of a picked collision. For a gap it also highlights the two faces the gap lies between, names them under the row (the features to change), and joins the two points of the gap by a line with its length. A click on the picked row drops the pick.
- **The note** in the status bar counts the pairs within the search distance, those further apart and those that could not be measured.

## The print view (D42)

| Function | Command / call | Reads |
|---|---|---|
| Judge how bodies print in given orientations | `engine.query('print', { bodies, orientations, bed, overhang, minArea, maxFaces }, { at })` | `bodies` (per body its orientations: `up`, `size`, `fits`, `onBed`, `contact` and `overhang` with their areas, counts and faces), `truncated` |

- **The form** is the generic one: the bodies (all of them when the list is empty); the orientations as rows, each a choice between a direction (three numbers) and a face (chosen from the lists of its body or picked in the view), with a turn in degrees; the bed as three lengths; the overhang angle in degrees; the smallest overhang listed and the most faces in a list.
- **The panel** has a row per body and orientation, in the order of the answer: the name of the body and the orientation as it was asked (*on* the face named, for the body the face belongs to; otherwise *up* with the direction to two places; and the turn when there is one), and the overhang area or *no overhang*. Under each row a line gives the height, the area on the bed with the number of its faces (*nothing flat on the bed* for a body that rests on a round face or on an edge) and the number of overhanging faces. An orientation that does not fit the bed says so with its three sizes, and a face named to lie on the bed that does not (something of the body reaches below it) says that. Areas and lengths are shown to a hundredth.
- **A picked row** paints the faces of that orientation on the model as it stands: those on the bed in the colour of a hover, the overhanging ones in the colour of a collision. Under the row it says which colour is which, and that the faces look away from what is up, so they may be on the far side of the model; then the overhanging faces, the largest first, each with its area and the height above the bed where it starts (*from the bed* when that is nothing). A last line says what the lists leave out and why: how many of the faces on the bed are painted and how many of the overhanging faces are listed, when the limit cut either, and how many overhangs are below the smallest area listed. A click on the picked row drops the pick. The view does not turn the model onto a bed.
- **Under all rows** a line says how many faces were listed of how many (those on the bed and those overhanging by the smallest area listed or more), when the limit cut any list.
- **The note** in the status bar counts the bodies and the orientations, and the rows that do not fit the bed.

## Implementation status

- The print view was run in a browser on 2026-11-15 on a plate with a wider ledge on its top and a pin on the ledge, and a bar beside it: three orientations (as modelled, on the top of the ledge, on a side), a bed too small. The rows, the two warnings (the pin reaches below the top of the ledge), the picked rows. What it showed and the tests of the app could not: as modelled, the painted faces are underneath and nothing is seen until the model is turned; the line under a picked row now says so.
- The form of `mass` (D41), which has no view, was run in a browser on 2026-11-15 on two blocks: two bodies in the list, a density for all with a fill factor, a density by body, an axis; the answer as a tree with its units. What it showed and the tests of the app could not, because they added one item only: a body chosen in a list was thrown away when *Add* was pressed after it (a value chosen inside a list or a record does not build the panel again, and *Add*, ✕ and the list of keys wrote the list as it was when the panel was built). The form of `interference`, `gap` and `section` had the same defect for a second body. The controls now read the draft when they are pressed.
- The gap view was run in a browser on 2026-11-15 on a plate with a pin in a larger hole, a bar 2 mm beside it, a block flush with the bar and a block that reaches into the plate: the rows, the three kinds of a picked row, the limit of the list. What it showed: `± 0 mm` after the gap of two bodies of planar faces, which is now left out. A gap of half a millimetre is not seen at the size of the model; its label and the two highlighted faces show where it is.
- Run in a browser on 2026-11-15 (the form of `measure`, of `interference` and of `section`, the lists, the picks in the view, a number out of its range, the marker moved). What it showed and the tests of the app could not: the tree was laid out as a row, the unit of a number wrapped under its field, an angle was rounded in radians before it was converted, and the sides of a body were listed under one label. All four are fixed.

- Not offered: asking over a preview or while a form of a feature is open (the model panel is not shown then), several answers at once, a question saved with the document.
- The section view, not offered: a section by more than one plane, hatching and a colour per body, measuring inside the section, a click on the filled cut that selects its body, a step other than 1 mm, dragging the plane.
- The gap view, not offered: a zoom to the picked gap, the gap of two groups of bodies, a sweep of a parameter.
- The print view, not offered: the model turned onto a bed, a view from below at a click, the faces on the bed listed by name (they are painted and counted), a comparison that names the best orientation.
- The labels of the tree are the keys of the result, in English.

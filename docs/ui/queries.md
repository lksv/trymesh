# UI: queries

Part of [ui.md](../ui.md); how to read the tables is said there. The generic form of a query, measuring, and what a view of a query adds (D39).

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
- **Without a view** the answer is a tree of names and values, each level set in from the one it belongs to: numbers rounded as the MCP tool `query` rounds them, with the unit the query gives for their key (an angle in degrees, rounded after it was converted), a face by its label and its key (the sides of a body share a label), a body by its name. A long list shows its first thirty items.
- **A view** of a query (`QUERY_VIEWS`) replaces the tree with rows of its own, adds to the scene and words the note. Two exist:
  - **Measure**: the exact distance (labelled *Thickness* for two faces that look away from each other, *Gap* for two that look at each other) and the exact angle, when the pair has them; the smallest distance on the mesh with its accuracy, to a thousandth of a millimetre; the faces asked about highlighted; the two points of the smallest distance joined by a line with its length.
  - **Interference** (the collisions, [bodies.md](bodies.md)): asked as soon as it opens; a row per colliding pair and per fit, a click on a row highlights its two bodies.

## Implementation status

- Run in a browser on 2026-11-15 (the form of `measure`, of `interference` and of `section`, the lists, the picks in the view, a number out of its range, the marker moved). What it showed and the tests of the app could not: the tree was laid out as a row, the unit of a number wrapped under its field, an angle was rounded in radians before it was converted, and the sides of a body were listed under one label. All four are fixed.

- Not offered: asking over a preview or while a form of a feature is open (the model panel is not shown then), several answers at once, a question saved with the document.
- The labels of the tree are the keys of the result, in English.

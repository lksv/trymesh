# 00 Preparatory step, part 3: panels and forms of the app as modules

**State: fourth version: the third, after two rounds of reviews, with the check changed from a script of clicks in a browser to a test of the class once the owner approved a DOM for the tests (2026-11-15). The changed check has not been reviewed; it is reviewed with its first commit.** Written from reading `packages/app/src/app.ts` at commit `371bcd7`. It changes no public type of the engine, so it has no `contract.ts`; the interfaces below are internal to the app and are shown as a sketch that is not type-checked. The scope is in [design.md](design.md), part 3; the reviews that led to this version are recorded there under "Reviews", rounds 4 and 5.

## What is there today

`packages/app/src/app.ts` is one class `App` of 2321 lines. Next to it are modules that are already separate, all of them pure or self-contained: `sketch-commands.ts` (drawing commands, and the changes of an extrusion draft and a pattern draft), `sketch-view.ts`, `sketch-diagnosis.ts`, `fields.ts`, `issue-text.ts`, `viewport.ts`, `dom.ts`. The four test files of the app cover those modules; none imports `app.ts`.

**Modes.** The app is in one mode: the model, a sketch, or a draft of a feature (`ExtrudeMode`, `PlaneMode`, `PatternMode`). A draft is the input form of a feature that is not in the document until confirmed; every change of it is previewed by the engine (`engine.preview(draftCommand(...), draft.id)`), and the preview is the state the view shows. Three pieces of state of a draft live outside the mode, as fields of the class: the cost of the last preview, the timer of a delayed one, and the flag that a draft is being confirmed.

**A feature type is spelled out in these places of the class:**

| Place | What it does per type |
|---|---|
| the union `Mode` and `isDraft` | a mode interface per type, with what the form remembers (the last distance extent, the last profile of each kind, the hovered region; the last angle) |
| `renderToolbar` | a button |
| `pending`, `startOnPlane`, `usePlane`, `createSketch`, the header in `modelPanel` | the features that start by picking a plane: the sketch (created at once by a batch, then entered) and the plane (a draft on the picked base); the panel that waits for the pick has a header per type ("Nová skica", "Nová rovina") |
| `edit` | what opens an existing feature |
| `startExtrude`, `startPlane`, `startPattern` | a new draft with defaults, or the draft of an existing feature |
| `renderPanel` | which panel is shown |
| `extrudePanel`, `planePanel`, `patternPanel` | the form, with helpers of their own (`regionsFields`, `generatorFields`, `operandChoices`, `patternBodies`) |
| `onMove`, `onUp` | what a move and a click in the view mean while the form is open. The extrusion returns before any pick and finds the region of the sketch under the pointer itself (a ray onto the plane of the sketch); the pattern and the plane get the pick of a face or a plane |
| `updatePreview`, `draftButtons` | when a draft has nothing to compute yet (`unpicked`, `patternIncomplete`) |
| `showDraft` | the parts of a panel that follow the preview without a rebuild (the facts of a gear, the bodies of a pattern) |
| `draftCommand` in `sketch-commands.ts` | the command of a draft: `addFeature`, or `updateFeature` with a patch built per type (the extrusion sends `refs: null` for a dropped reference and leaves out `targets` of a new body) |
| `renderScene` | what the draft draws (the regions of a sketch, the square of a plane), and which faces a selected feature highlights |
| `modelPanel` | the lines about a selected feature |
| `renderTimeline` | whether the eye of the feature is enabled (`bodiless`: not for an extrusion that adds or cuts, nor for a pattern of features; a sketch and a plane can be hidden) |
| `planes`, `patternChoices`, `generatorFields` | single conditions by type |

That is fifteen places for one new type. D36 adds forms for the hole, the import, the insert, the boolean of bodies, the split, the revolve, the chamfer and the fillet, and new fields to the extrusion form (offset, taper, a new extent).

**Panels that are not forms**: the model panel (the selected feature, the bodies with their export), the collisions, the parameters with the checks, and the sketch panel (the status, the diagnosis, the list of constraints, the options of the polygon tool).

**State that belongs to one panel but is a field of the class**: the collisions (the answer, the marker it was asked at, the picked pair, the note in the status line; read in seven places), the options of the polygon tool, the explanation of the constraint shown last.

**The collisions and the state they belong to.** The answer remembers the marker it was asked at. It is shown while the marker is the same, hidden while it is another and shown again on return, and dropped when the engine reports a change of the document. It survives entering and leaving a sketch.

**What the panels use of the class**, all of it private today:

- the engine: `getState` with and without a feature, `execute` (through `run` and twice directly), `preview` (of a draft), `diagnoseSketch`, `explainConstraint`, `interference`, `exportMesh`;
- the shown state and names: `doc`, `view`, `stateBefore`, `feature`, `nameOf`, `bodyName`, `featureNames`, `issueText`, `issues`, `describe`;
- the selection: the feature selected on the timeline, the pick selected in the view and `planeRefOf`, `pending` and `usePlane`, the marker and `insertIndex`, `bodyHidden`;
- the view: `planePoint` (a pointer event to a point of a plane), `planeSize`, `sketchContext`;
- the mode: the current one is read (the timer of a delayed preview asks whether a draft is still open), `setMode`, `enterSketch` (it also turns the camera to the sketch and fits the view);
- the cache of the shown state: `invalidate`, called by the preview of a draft before and after it replaces the preview, and by the drag of a point, both without a refresh;
- actions: `say` and the note it leaves (the collisions keep the very note object of their answer, and a refresh compares it by identity), `run`, `refresh`, `renderPanel`, `renderScene`, `edit`, `setTool`, `draftChanged`, `newId`;
- helpers of fields: `draftField`, `markProblem`.

The sketch mode and the scene use more than the panels: the viewport, the pick under the pointer, the pointer state, the hidden features, the base planes switch, `fit`.

## Proposal

```
packages/app/src/
  app.ts            App: the state of the app, the engine, modes, refresh, the toolbar, the timeline,
                    pointer and key events and their dispatch
  host.ts           PanelHost: what a panel or a form may use of the app
  features/
    index.ts        FEATURE_UI: the registry by feature type, and uiOf
    draft.ts        what forms share: the draft mode and its state, numeric fields, the buttons,
                    the preview and its pause
    extrude.ts      one file per type: the form, its defaults, its command, its picks, its overlay,
    plane.ts        its summary
    pattern.ts
    sketch.ts       the entry of the sketch: it has no form, it is created on a plane and opens the
                    sketch mode
  panels/
    model.ts        the selected feature and the bodies
    parameters.ts   parameters and checks
    collisions.ts   the collisions, with the state they own
    sketch.ts       status, diagnosis, constraints, options of the drawing tools
  sketch-mode.ts    the sketch mode: tools, clicks, the drag of a point, its scene
  scene.ts          the scene of the model: bodies, outlines, planes, highlights
```

An entry of the registry:

```ts
// not type-checked; Pick, SceneModel and the drafts are internal to the app
interface FeatureUi<F extends Feature, Extra = unknown> {
  // every type
  button?: { label: string; title: string };
  // How a new feature starts. `plane`: a plane or a planar face is picked first and handed over;
  // `header` is the title of the panel that waits for the pick. The sketch creates itself with
  // a batch and enters its mode; the others open their form. `run` answers false when it refused
  // the picked plane; the app then keeps waiting for another.
  create?: { plane?: { header: string }; run(host: PanelHost, at: { index: number; plane?: PlaneRef }): boolean };
  edit(host: PanelHost, feature: F): void;                       // the sketch enters its mode, the others open their form
  summary(host: PanelHost, feature: F, result: FeatureResult | undefined): HTMLElement[];   // lines of the model panel
  ownsFace?(feature: F, name: FaceName): boolean;                // the faces a selected feature highlights
  hideable(feature: F): boolean;                                 // is its eye on the timeline enabled
  // types with a form
  form?: {
    draft(host: PanelHost, at: { index: number; plane?: PlaneRef }): { draft: Input<F>; extra: Extra; say?: string } | { problem: string };
    command(draft: Input<F>, editing: boolean, index: number): Command;   // the three of today call draftCommand
    incomplete?(draft: Input<F>): boolean;                       // nothing to compute or confirm yet
    panel(mode: DraftMode<F, Extra>, host: PanelHost): HTMLElement[];
    live?(mode: DraftMode<F, Extra>, host: PanelHost): void;      // parts of the panel that follow the preview
    // What the form wants picked in the view. Without it the app picks nothing while the form is
    // open and hands over the bare event (the extrusion finds its region with `host.planePoint`).
    picks?: { faces?: true; planes?: true };
    hover?(mode: DraftMode<F, Extra>, event: PointerEvent, pick: Pick | undefined, host: PanelHost): boolean;   // true: redraw the scene
    click?(mode: DraftMode<F, Extra>, event: PointerEvent, pick: Pick | undefined, host: PanelHost): void;
    overlay?(mode: DraftMode<F, Extra>, scene: SceneModel, host: PanelHost): void;
  };
}
interface DraftMode<F extends Feature, Extra> {
  kind: 'draft';
  type: F['type'];
  editing: boolean;
  index: number;                // the place of the feature on the timeline
  draft: Input<F>;
  extra: Extra;                 // what the form remembers beyond the draft: the last extent, the hovered region
  preview?: EngineState;
  problem?: string;
  warning?: boolean;
}
const FEATURE_UI: { [K in Feature['type']]: FeatureUi<Extract<Feature, { type: K }>, any> } = { plane, sketch, extrude, pattern };
const TOOLBAR: readonly Feature['type'][] = ['sketch', 'extrude', 'plane', 'pattern'];   // the order of the buttons, as today
```

Decisions inside the proposal:

- **One registry over all feature types, and the compiler guards it.** A feature type without an entry does not compile, the same way as in the engine. This is the app half of the rule "reachable from the app and through MCP": a type cannot be added to the engine and forgotten here. An entry without `form` is allowed, for a type that is edited another way (the sketch), and has to say how in `create` and `edit`.
- **The types of the registry.** Each entry is written with its own `Extra` and checked there; the registry forgets it. Picking the entry of an open draft loses the tie between the mode and the entry, as picking a step by feature type does in the engine, so it goes through one helper `uiOf(mode)` with one cast. `mode.type === 'extrude'` does not narrow the draft; code that needs the draft of one type lives in the file of that type, where the mode is typed.
- **One draft mode instead of one per type.** `ExtrudeMode`, `PlaneMode` and `PatternMode` differ only in the type of the draft and in what the form remembers; that becomes `extra`. `updatePreview`, `draftChanged`, `showDraft`, `confirmDraft` and `draftButtons` move to `features/draft.ts`, once, and ask the entry (`incomplete`, `live`, `command`). The cost of the last preview, the timer and the confirming flag move there with them as one object. The slow-preview pause and the rule that a confirmed draft is not previewed again stay as they are.
- **The command of a draft stays per type.** The update half differs by type and is tested. `draftCommand` stays in `sketch-commands.ts` with its tests and the three entries call it; a new type writes its own `command`.
- **A form gets its events from the app; it does not listen itself.** `App` keeps the pointer handlers and the rules that are the same for every form (a drag of the view is not a click). It picks in the view only what the open form asks for, so no face lights up under the pointer while regions of a sketch are being chosen, as today.
- **A panel is a function, not a class.** `panel(mode, host) => HTMLElement[]`, as the methods are today; the DOM helper `h` stays. No component framework and no library.
- **State that belongs to one panel moves with it.** The collisions, the options of the polygon tool and the explanation shown last become objects that the app holds and only their panel reads and writes; the app calls the panel for what it needs of them (is an answer shown, which bodies to highlight).
- **`PanelHost` is an interface that `App` implements**, with the members listed under "What the panels use of the class". A panel imports the interface, never `app.ts`, so the modules do not import each other in a circle.
  - **It is checked before anything moves.** In the first commit every method that will move gets `this: PanelHost` as its first parameter, where it stands. The compiler then lists every member such a method uses and the interface lacks. (That `App` implements the interface shows nothing: a class may implement an interface and still use more of itself.)
  - **The host does not hand out what the app guards.** The engine on it is the part a panel may call: `getState`, `preview`, `execute`, the queries and `exportMesh`. Undo, redo and load stay with the app, which blocks them while a draft is open and tells the bridge about a replaced document.
  - **Nothing on it can leave the cached view stale.** The marker is read-only; a feature inserted at it is reported by one method that the app follows with its refresh. A form does not write the preview of its mode: it reports a changed draft, and the code of `features/draft.ts` replaces the preview and invalidates the cache.
  - **The note of an answer.** `say` returns the note it left, so that the panel of the collisions can keep it and the app can tell whether it is still the one shown.
  - The sketch mode and the scene get interfaces of their own that extend it (the viewport, the pick, the pointer state), written and checked the same way in their commit.
- **What a user sees and what is saved stay the same**: the prefixes of generated IDs (`e`, `r`, `n` and the others), the default names of new features and the texts are those of today. The test of the class compares documents, so a changed prefix would show.
- **What the engine knows is asked of the engine**: the sources a pattern accepts and the earlier features with a profile from a generator (`producesTool` and `generatorOf` of part 2). Whether the eye of a feature is enabled is not the engine's question (a sketch has no body and can be hidden) and belongs to the entry.

### Queries in the app

The collisions are the one query of the model with a panel of its own today, written by hand (the sketch panel also asks the diagnosis of a sketch and the explanation of a constraint). Step 1 of D36 adds five more and the later steps more again.

- **A form is built from the description of the arguments of a query** (`ArgSpecs` of part 1; `QUERIES` is exported from the index of the engine), the way the form of a profile generator is built from its catalog entry today. Every kind has a control: a number field with its unit and range (`fields.ts`), a flag, a text, a choice, a body, a feature or a sketch from a list, a constraint from the list of its sketch, a face or an edge by a click in the view, a sketch point from two lists (the view picks points only inside the sketch mode), a plane by a click or from the base planes, an axis from the base axes or as a sketch point, a vector as three numbers, a list by adding rows, alternatives as a choice of one sub-form, fields as a group, a record as rows by key. The answer is shown as a tree of names and values, with numbers in the units `returns` states.
- **A query may have a view of its own** (`QUERY_VIEWS`, by query name, optional): what it draws into the scene and how it lists its answer. The collisions panel becomes the view of `interference`. A section, a gap and a print query will want one; a mass or a catalog lookup will not.
- **Every query is reachable from the app by construction**: the generic form needs no entry. A toolbar menu lists the queries of the catalog.
- **An answer belongs to the document and the place on the timeline it was asked at**, as the collisions do today: shown while the marker is that place, hidden while it is another, dropped when the engine reports a change of the document. The identity of the evaluation cannot be the key: `getState` with a feature computes a new evaluation on every call, and the view is asked for again after every refresh.

The generic form is not part of this step. Package 1b designs and builds it (`panels/query.ts`, `QUERY_VIEWS`), as the first query with arguments worth a form, and the app side of the other queries of step 1 builds on it; the plan and the brief of track A say so. This step leaves the collisions as a panel of its own in `panels/collisions.ts`, calling `engine.interference`; it becomes the view of `interference` when the form exists.

## What a new feature type costs in the app afterwards

1. `features/<type>.ts`: the entry with its form.
2. `features/index.ts`: one line.
3. The text of a new face role in `issue-text.ts`: one line, and the compiler asks for it (the table is typed by the union of the engine). A new issue code needs nothing in the app: the app shows the message of the engine. Only an issue whose references are bodies or features that should be named is added to a short list there.

A new field of an existing form (offset, taper) is an edit of that form's file only. A new query costs nothing, or one file for its view.

## How it is done without changing behaviour

The class has no test, and the split moves event handling and DOM building, which the type check does not cover. So the check is written first.

**A test of the class, written before anything moves.** A fixed sequence of actions on an instance of `App` in Vitest, with a DOM from the library the owner approved on 2026-11-15 (D2: `happy-dom` or `jsdom`; the first commit takes the one in which the pointer events with capture and the form controls of the app work, and records the choice in D2). The engine is the real one with the real adapters, as in `packages/scenarios`.

The view is the one thing a DOM without layout and without WebGL cannot run. `App` creates its `Viewport` itself today; the first commit gives the constructor a second, optional argument typed by an interface with the public methods of `Viewport` (`setScene`, `requestRender`, `ray`, `pickBody`, `projector`, `pixelSize`, `lookAt`, `fit`), and the test passes a stub. The stub keeps the scenes it is given, has one fixed camera for `ray` and `projector`, and answers `pickBody` with what the step of the test names. Every case starts a fresh instance: IDs come from counters per prefix that are not reset within an instance and that a cancelled draft also advances.

What the test does:

- a sketch with a rectangle, a chain of lines with an inferred constraint, a circle, an arc, a polygon with its options, a construction curve, two dimensions and a reference one; a selection with Shift; the drag of a point; a projected edge and the repair of one; the focus and the explanation of a constraint;
- an extrusion; a sketch on a face and a cut through all; a plane; a pattern of the cut; a gear from the generator; each opened again and changed, one cancelled, one confirm refused by the engine;
- in the forms, every remembered value there and back: the extent from a distance to through all and back, the profile from regions to a generator and back, the span of a pattern from an angle to the full circle and back; an angle out of range typed in degrees; the base of a plane changed by a click, and a click on a face that is not planar; the body of a pattern picked by a click;
- a sketch and a plane started with a plane selected beforehand, and started by a pick that is refused first;
- in the model: a face and an edge selected, a feature renamed, suppressed and deleted, a sketch moved to a selected plane, one body exported;
- a feature added at a marker in the middle of the timeline; move, hide and show on the timeline;
- a parameter and a check; the collisions asked, a pair picked, hidden by moving the marker and shown again, checked again and closed;
- the keys: Escape through its chain (a shape in progress, a tool, a draft, a drag), Delete in a sketch, undo while a draft is open (it must do nothing) and after;
- a drag ended by `pointercancel`, and by a change of the document under it;
- a confirmation while a delayed preview is pending;
- over the bridge to MCP while a draft is open: a command, a command the engine refuses, a load, and a load that fails.

Whether a typed change is previewed at once depends on how long the last preview took, so two runs of the same code could differ. The test pins the time: it replaces `performance.now` with a clock it steps itself, and takes both branches on purpose.

What is recorded after every step and kept as a snapshot file next to the test:

- the calls the app makes on the engine, in order, with their arguments (`execute`, `preview`, `getState`, the queries); the test hands the app an engine wrapped to write them down. This is what catches a preview computed twice or a command sent in another order, which leave the document the same;
- the document, read from the engine (saving is a download);
- the toolbar, the timeline, the panel and the status line, each written out with what a user sees and can do: the text, the value of every control, whether it is disabled, its class and its title. That covers the order of the buttons, the eye of a feature, the OK of an incomplete draft and the marks of a warning, an error or a selected row;
- what the app asked of the view: the scenes given to `setScene`, reduced to the bodies, their colours and visibility, the overlays and the highlighted names, and the calls of `lookAt` and `fit`.

The snapshot is written once, by the commit that adds the test, against the class as it is. Every later commit of this part must leave the snapshot file untouched; a commit that has to change it has changed behaviour and says in its message what and why. The test lives in `packages/app/test/app.test.ts` and runs with `npx vitest run`, so it stays as the regression test of the app after the step.

**What the stub cannot see** is the rendering itself, the real camera and the picking through three.js. `viewport.ts` is not touched by this part; `scene.ts` (commit 5) is where a mistake could show only on the screen. So the real app is opened in a browser three times (before the first commit, after commit 4 and after commit 5), a short fixed tour is clicked through (a sketch, an extrusion, a cut on a face, a pattern, the collisions, the timeline marker) and the screenshots at its fixed steps are compared. This uses the Playwright MCP server of the development setup and is not a dependency of the project.

A panel can also be tested alone, with a `PanelHost` written by hand; the packages that add a panel or a form do that in their own tests.

Order, one commit each:

0. The DOM library as a development dependency of `packages/app`, the interface of the view with the optional argument of the constructor, the test and its snapshot. No other change of the class.
1. `host.ts`: the interface; the members of `App` it names made public; every method that will move annotated with `this: PanelHost`. No code moves.
2. `panels/parameters.ts`, `panels/collisions.ts` with its state, `panels/model.ts`: the panels that are not forms.
3. `features/draft.ts` and the registry. The three mode interfaces become one `DraftMode` with `extra`; while the forms still live in the class, the mode is the union of its three instantiations, so the code there narrows it by `type` as before. `FEATURE_UI` exists from this commit, complete, with entries whose members call the methods still in the class; the shared draft code asks the entries. This is the commit with real edits, not moves.
4. `features/plane.ts`, `features/pattern.ts`, `features/extrude.ts`, `features/sketch.ts`, one commit each: the bodies move into the entries, and the chains of conditions over the type go.
5. `scene.ts` and `sketch-mode.ts` with `panels/sketch.ts`, behind interfaces of their own.

Checks after each: the type check, the tests of the app with the snapshot untouched, and `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change` read for what is not a move.

Part 3 needs nothing of part 1 and only two functions of part 2 (`producesTool`, `generatorOf`); until those exist the two conditions stay as they are in the entries of the pattern and the extrusion.

## Open

- **The sketch mode** is about 600 lines and is moved as one piece. Splitting it by drawing tool is not needed for D36 (step 6 adds the fillet of a corner as a sketch tool of the engine catalog, which the app runs already).
- **The toolbar** grows by a button per feature type. A menu by group (create, modify, bodies) is a question of step 2, when the count is known.
- **Czech texts.** The moved code keeps its texts; a line that changes anyway is written in English, as the rule of the project says.

# 00 Preparatory step, part 3: panels and forms of the app as modules

**State: second version, after one round of reviews.** Written from reading `packages/app/src/app.ts` at commit `371bcd7`. It changes no public type of the engine, so it has no `contract.ts`; the interfaces below are internal to the app and are shown as a sketch that is not type-checked. The scope is in [design.md](design.md), part 3; the review that led to this version is recorded there under "Reviews", round 4.

## What is there today

`packages/app/src/app.ts` is one class `App` of 2321 lines. Next to it are modules that are already separate, all of them pure or self-contained: `sketch-commands.ts` (drawing commands, and the changes of an extrusion draft and a pattern draft), `sketch-view.ts`, `sketch-diagnosis.ts`, `fields.ts`, `issue-text.ts`, `viewport.ts`, `dom.ts`. The four test files of the app cover those modules; none imports `app.ts`.

**Modes.** The app is in one mode: the model, a sketch, or a draft of a feature (`ExtrudeMode`, `PlaneMode`, `PatternMode`). A draft is the input form of a feature that is not in the document until confirmed; every change of it is previewed by the engine (`engine.preview(draftCommand(...), draft.id)`), and the preview is the state the view shows. Three pieces of state of a draft live outside the mode, as fields of the class: the cost of the last preview, the timer of a delayed one, and the flag that a draft is being confirmed.

**A feature type is spelled out in these places of the class:**

| Place | What it does per type |
|---|---|
| the union `Mode` and `isDraft` | a mode interface per type, with what the form remembers (the last distance extent, the last profile of each kind, the hovered region; the last angle) |
| `renderToolbar` | a button |
| `pending`, `startOnPlane`, `usePlane`, `createSketch`, the header in `modelPanel` | the features that start by picking a plane: the sketch (created at once by a batch, then entered) and the plane (a draft on the picked base) |
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
- actions: `say`, `run`, `refresh`, `renderPanel`, `renderScene`, `setMode`, `edit`, `setTool`, `draftChanged`, `newId`;
- helpers of fields: `draftField`, `markProblem`.

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
    query.ts        a form and an answer for any query of the catalog (see below)
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
  // How a new feature starts. `plane: true`: a plane or a planar face is picked first and handed
  // over. The sketch creates itself with a batch and enters its mode; the others open their form.
  // `run` answers false when it refused the picked plane; the app then keeps waiting for another.
  create?: { plane?: true; run(host: PanelHost, at: { index: number; plane?: PlaneRef }): boolean };
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
```

Decisions inside the proposal:

- **One registry over all feature types, and the compiler guards it.** A feature type without an entry does not compile, the same way as in the engine. This is the app half of the rule "reachable from the app and through MCP": a type cannot be added to the engine and forgotten here. An entry without `form` is allowed, for a type that is edited another way (the sketch), and has to say how in `create` and `edit`.
- **The types of the registry.** Each entry is written with its own `Extra` and checked there; the registry forgets it. Picking the entry of an open draft loses the tie between the mode and the entry, as picking a step by feature type does in the engine, so it goes through one helper `uiOf(mode)` with one cast. `mode.type === 'extrude'` does not narrow the draft; code that needs the draft of one type lives in the file of that type, where the mode is typed.
- **One draft mode instead of one per type.** `ExtrudeMode`, `PlaneMode` and `PatternMode` differ only in the type of the draft and in what the form remembers; that becomes `extra`. `updatePreview`, `draftChanged`, `showDraft`, `confirmDraft` and `draftButtons` move to `features/draft.ts`, once, and ask the entry (`incomplete`, `live`, `command`). The cost of the last preview, the timer and the confirming flag move there with them as one object. The slow-preview pause and the rule that a confirmed draft is not previewed again stay as they are.
- **The command of a draft stays per type.** The update half differs by type and is tested. `draftCommand` stays in `sketch-commands.ts` with its tests and the three entries call it; a new type writes its own `command`.
- **A form gets its events from the app; it does not listen itself.** `App` keeps the pointer handlers and the rules that are the same for every form (a drag of the view is not a click). It picks in the view only what the open form asks for, so no face lights up under the pointer while regions of a sketch are being chosen, as today.
- **A panel is a function, not a class.** `panel(mode, host) => HTMLElement[]`, as the methods are today; the DOM helper `h` stays. No component framework and no library.
- **State that belongs to one panel moves with it.** The collisions, the options of the polygon tool and the explanation shown last become objects that the app holds and only their panel reads and writes; the app calls the panel for what it needs of them (is an answer shown, which bodies to highlight).
- **`PanelHost` is an interface that `App` implements**, with the members listed under "What the panels use of the class" and the engine as a read-only member. The members become public for it; that is the content of the first commit, which is therefore not empty. A panel imports the interface, never `app.ts`, so the modules do not import each other in a circle. The interface is written and type-checked in that first commit, before anything moves, so that what is missing shows before the extraction and not during it.
- **What a user sees and what is saved stay the same**: the prefixes of generated IDs (`e`, `r`, `n` and the others), the default names of new features and the texts are those of today. The click script compares documents, so a changed prefix would show.
- **What the engine knows is asked of the engine**: the sources a pattern accepts and the earlier features with a profile from a generator (`producesTool` and `generatorOf` of part 2). Whether the eye of a feature is enabled is not the engine's question (a sketch has no body and can be hidden) and belongs to the entry.

### Queries in the app

The collisions are the one query the app asks today, with a panel written by hand. Step 1 of D36 adds five more and the later steps more again.

- **`panels/query.ts` builds a form from the description of the arguments of a query** (`ArgSpecs` of part 1; `QUERIES` is exported from the index of the engine), the way the form of a profile generator is built from its catalog entry today. Every kind has a control: a number field with its unit and range (`fields.ts`), a flag, a text, a choice, a body, a feature or a sketch from a list, a constraint from the list of its sketch, a face or an edge by a click in the view, a sketch point from two lists (the view picks points only inside the sketch mode), a plane by a click or from the base planes, an axis from the base axes or as a sketch point, a vector as three numbers, a list by adding rows, alternatives as a choice of one sub-form, fields as a group, a record as rows by key. The answer is shown as a tree of names and values, with numbers in the units `returns` states.
- **A query may have a view of its own** (`QUERY_VIEWS`, by query name, optional): what it draws into the scene and how it lists its answer. The collisions panel becomes the view of `interference`. A section, a gap and a print query will want one; a mass or a catalog lookup will not.
- **Every query is reachable from the app by construction**: the generic form needs no entry. A toolbar menu lists the queries of the catalog.
- **An answer belongs to the document and the place on the timeline it was asked at**, as the collisions do today: shown while the marker is that place, hidden while it is another, dropped when the engine reports a change of the document. The identity of the evaluation cannot be the key: `getState` with a feature computes a new evaluation on every call, and the view is asked for again after every refresh.

The generic form is designed in full with package 1b (the first query with arguments worth a form); this step only makes the place for it: `panels/query.ts` with the view of the collisions, which keeps calling `engine.interference` until then.

## What a new feature type costs in the app afterwards

1. `features/<type>.ts`: the entry with its form.
2. `features/index.ts`: one line.
3. Texts of new issue codes and face roles in `issue-text.ts` (one line each; the compiler asks for them, the tables are typed by the unions of the engine).

A new field of an existing form (offset, taper) is an edit of that form's file only. A new query costs nothing, or one file for its view.

## How it is done without changing behaviour

The class has no test, and the split moves event handling and DOM building, which the type check does not cover. So the check is written first.

**A click script, run before and after every commit.** A fixed sequence of actions in the running app, driven through the browser (the Playwright MCP server of the development setup; no dependency of the project). Every run starts a fresh instance of the app in a window of a fixed size: IDs come from counters per prefix that are not reset within an instance and that a cancelled draft also advances, and coordinates of a sketch come through the camera.

What the script does:

- a sketch with a rectangle, a circle and two dimensions; the drag of a point; a projected edge;
- an extrusion; a sketch on a face and a cut through all; a plane; a pattern of the cut; a gear from the generator; each opened again and changed, one cancelled;
- a feature added at a marker in the middle of the timeline; move, hide and show on the timeline;
- a parameter and a check; the collisions, asked, hidden by moving the marker and shown again;
- the keys: Escape through its chain (a shape in progress, a tool, a draft), Delete in a sketch, undo while a draft is open (it must do nothing) and after;
- a confirmation while a delayed preview is pending, with the slow-preview branch forced;
- a command and a load arriving over the bridge to MCP while a draft is open.

What is compared between the two runs:

- the calls the app makes on the engine, in order, with their arguments (`execute`, `preview`, `getState`, the queries). The app instance is on `window.trymesh` in development already; the script wraps the engine there. This is what catches a preview computed twice or a command sent in another order, which leave the document the same;
- the document after every step, read from the engine (saving is a download);
- the text of the panel and of the status line after every step;
- a screenshot of the view at fixed steps.

The script is kept in `packages/app/test/smoke/` as a list of steps that a session replays; it is not part of `npx vitest run`.

Order, one commit each:

1. `host.ts`: the interface, the members of `App` it names made public, `App` declared to implement it. No code moves.
2. `panels/parameters.ts`, `panels/collisions.ts` with its state, `panels/model.ts`: the panels that are not forms.
3. `features/draft.ts`: the one draft mode; the three mode interfaces become `DraftMode` with `extra`. This is the commit with real edits, not moves.
4. `features/plane.ts`, `features/pattern.ts`, `features/extrude.ts`, `features/sketch.ts`, one commit each, and `features/index.ts` in place of the chains of conditions.
5. `scene.ts` and `sketch-mode.ts` with `panels/sketch.ts`.

Checks after each: the type check, the four test files of the app, the click script, and `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change` read for what is not a move.

Part 3 needs nothing of part 1 and only two functions of part 2 (`producesTool`, `generatorOf`); until those exist the two conditions stay as they are in the entries of the pattern and the extrusion.

## Open

- **A test of the class in the test suite.** A DOM in Vitest (`happy-dom` or `jsdom`) would let the click script run as a test, with the viewport replaced by a stub, and would let a panel be tested alone with a host written by hand (a panel builds DOM, so that needs a DOM as well). It is a new development dependency and needs the owner's approval (D2); the proposal above does without it.
- **The sketch mode** is about 600 lines and is moved as one piece. Splitting it by drawing tool is not needed for D36 (step 6 adds the fillet of a corner as a sketch tool of the engine catalog, which the app runs already).
- **The toolbar** grows by a button per feature type. A menu by group (create, modify, bodies) is a question of step 2, when the count is known.
- **Czech texts.** The moved code keeps its texts; a line that changes anyway is written in English, as the rule of the project says.

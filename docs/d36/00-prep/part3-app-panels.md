# 00 Preparatory step, part 3: panels and forms of the app as modules

**State: design, not reviewed.** Written from reading `packages/app/src/app.ts` at commit `371bcd7`. It changes no public type of the engine, so it has no `contract.ts`; the interfaces below are internal to the app and are shown as a sketch that is not type-checked. The scope is in [design.md](design.md), part 3.

## What is there today

`packages/app/src/app.ts` is one class `App` of 2321 lines. Next to it are modules that are already separate, all of them pure or self-contained: `sketch-commands.ts` (drawing commands, and the changes of an extrusion draft and a pattern draft), `sketch-view.ts`, `sketch-diagnosis.ts`, `fields.ts`, `issue-text.ts`, `viewport.ts`, `dom.ts`. The four test files of the app cover those modules; nothing tests the class.

**Modes.** The app is in one mode: the model, a sketch, or a draft of a feature (`ExtrudeMode`, `PlaneMode`, `PatternMode`). A draft is the input form of a feature that is not in the document until confirmed; every change of it is previewed by the engine (`engine.preview(draftCommand(...), draft.id)`), and the preview is the state the view shows.

**A feature type with a form is spelled out in these places of the class:**

| Place | What it does per type |
|---|---|
| the union `Mode` and `isDraft` | a mode interface per type, with what the form remembers (the last distance extent, the last profile of each kind, the last angle) |
| `renderToolbar` | a button |
| `edit` | which form opens an existing feature |
| `startExtrude`, `startPlane`, `startPattern` | a new draft with defaults, or the draft of an existing feature |
| `renderPanel` | which panel is shown |
| `extrudePanel`, `planePanel`, `patternPanel` | the form, with helpers of their own (`regionsFields`, `generatorFields`, `operandChoices`, `patternBodies`) |
| `onMove`, `onUp` | what a move and a click in the view mean while the form is open (a region, a body, a base plane) |
| `updatePreview`, `draftButtons` | when a draft has nothing to compute yet (`unpicked`, `patternIncomplete`) |
| `showDraft` | the parts of a panel that follow the preview without a rebuild (the facts of a gear, the bodies of a pattern) |
| `renderScene` | what the draft draws (the regions of a sketch, the square of a plane), and which faces a selected feature highlights |
| `modelPanel` | the lines about a selected feature |
| `renderTimeline` | whether the feature has a body to hide (`bodiless`) |
| `planes`, `patternChoices` | single conditions by type |

That is thirteen places for one new type. D36 adds forms for the hole, the import, the insert, the boolean of bodies, the split, the revolve, the chamfer and the fillet, and new fields to the extrusion form (offset, taper, a new extent).

**Panels that are not forms**: the model panel (the selected feature, the bodies), the collisions (the one query the app asks; its answer, the picked pair and its note are fields of the class), the parameters with the checks, and the sketch panel (the status, the diagnosis, the list of constraints, the options of the polygon tool).

**What a panel uses of the class**: the document and the shown state (`doc`, `view`, `stateBefore`), names (`feature`, `nameOf`, `bodyName`, `issueText`), the engine through `run` and through the preview of a draft, the status line (`say`), redrawing (`refresh`, `renderPanel`, `renderScene`, `draftChanged`), the mode (`setMode`), new IDs (`newId`), the place of insertion (`insertIndex`), the selection on the timeline, and the helpers for numeric fields (`draftField`, `markProblem`).

## Proposal

```
packages/app/src/
  app.ts            App: the state of the app, the engine, modes, refresh, the toolbar, the timeline,
                    pointer and key events and their dispatch
  host.ts           PanelHost: what a panel or a form may use of the app
  features/
    index.ts        FEATURE_UI: the registry by feature type
    draft.ts        what forms share: the draft mode, numeric fields, the buttons, the preview
    extrude.ts      one file per type: the form, its defaults, its picks, its overlay, its summary
    plane.ts
    pattern.ts
    sketch.ts       the entry of the sketch: it has no form, it opens the sketch mode
  panels/
    model.ts        the selected feature and the bodies
    parameters.ts   parameters and checks
    collisions.ts   the view of the query `interference`
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
  edit(host: PanelHost, feature: F): void;                       // the sketch enters its mode, the others open their form
  summary(host: PanelHost, feature: F, result: FeatureResult | undefined): HTMLElement[];   // lines of the model panel
  ownsFace?(feature: F, name: FaceName): boolean;                // the faces a selected feature highlights
  hasBody(feature: F): boolean;                                  // can it be hidden on the timeline
  // types with a form
  form?: {
    button: { label: string; title: string; needsPlane?: true }; // needsPlane: a plane or a planar face is picked first
    start(host: PanelHost, at: { index: number; plane?: PlaneRef }): { draft: Input<F>; extra: Extra; say?: string } | { problem: string };
    incomplete?(draft: Input<F>): boolean;                       // nothing to compute or confirm yet
    panel(mode: DraftMode<F, Extra>, host: PanelHost): HTMLElement[];
    live?(mode: DraftMode<F, Extra>, host: PanelHost): void;      // parts of the panel that follow the preview
    hover?(mode: DraftMode<F, Extra>, event: PointerEvent, host: PanelHost): boolean;   // true: redraw the scene
    click?(mode: DraftMode<F, Extra>, pick: Pick | undefined, event: PointerEvent, host: PanelHost): void;
    overlay?(mode: DraftMode<F, Extra>, scene: SceneModel, host: PanelHost): void;
  };
}
interface DraftMode<F extends Feature, Extra> {
  kind: 'draft';
  type: F['type'];
  editing: boolean;
  index: number;                // the place of the feature on the timeline
  draft: Input<F>;
  extra: Extra;                 // what the form remembers beyond the draft
  preview?: EngineState;
  problem?: string;
  warning?: boolean;
}
const FEATURE_UI: { [K in Feature['type']]: FeatureUi<Extract<Feature, { type: K }>> } = { plane, sketch, extrude, pattern };
```

Decisions inside the proposal:

- **One registry over all feature types, and the compiler guards it.** A feature type without an entry does not compile, the same way as in the engine. This is the app half of the rule "reachable from the app and through MCP": a type cannot be added to the engine and forgotten here. An entry without `form` is allowed, for a type that is edited another way (the sketch), and has to say how in `edit`.
- **One draft mode instead of one per type.** `ExtrudeMode`, `PlaneMode` and `PatternMode` differ only in the type of the draft and in what the form remembers; that becomes `extra`. `updatePreview`, `draftChanged`, `showDraft`, `confirmDraft` and `draftButtons` stay in `features/draft.ts`, once, and ask the entry (`incomplete`, `live`). The slow-preview pause and the rule that a confirmed draft is not previewed again stay as they are.
- **A form gets its events from the app; it does not listen itself.** `App` keeps the pointer handlers, resolves the pick as today and hands it to `click` of the open form. So the rules that are the same for every form (a drag of the view is not a click, the reach of a pick) stay in one place.
- **A panel is a function, not a class.** `panel(mode, host) => HTMLElement[]`, as the methods are today; the DOM helper `h` stays. No component framework and no library.
- **`PanelHost` is an interface that `App` implements**, with the members listed under "What a panel uses of the class". A panel imports the interface, never `app.ts`, so the modules do not import each other in a circle and a panel can be exercised in a test with a host written by hand.
- **The pure halves stay where they are.** `changeExtrude`, `changePattern`, `draftCommand`, `patternSource` live in `sketch-commands.ts` and two test files import them from there. They are not sketch commands, and they move to their forms when the first package changes them; moving them now would edit tests for no gain.
- **`draftCommand` and the default name of a new feature become generic** (`addFeature` or `updateFeature` from any draft), so that an entry does not write them.
- **What the engine knows is asked of the engine**: `hasBody` and the sources a pattern accepts (`producesTool` of part 2) come from the engine's registry where it has them; the entry adds only what is about showing.

### Queries in the app

The collisions are the one query the app asks today, with a panel written by hand. Step 1 of D36 adds five more and the later steps more again.

- **`panels/query.ts` builds a form from the description of the arguments of a query** (`ArgSpecs` of part 1), the way the form of a profile generator is built from its catalog entry today: a number field with its unit and range (`fields.ts`), a flag, a choice, a body from a list, a named entity by a click in the view (the pick the app has), a plane, a list by adding rows. The answer is shown as a tree of names and values, with numbers in the units `returns` states.
- **A query may have a view of its own** (`QUERY_VIEWS`, by query name, optional): what it draws into the scene and how it lists its answer. The collisions panel becomes the view of `interference`. A section, a gap and a print query will want one; a mass or a catalog lookup will not.
- **Every query is reachable from the app by construction**: the generic form needs no entry. A toolbar menu lists the queries of the catalog.
- **An answer belongs to the state it was asked about.** Today the collisions remember the marker they were computed at and their note goes when the model changes. That rule becomes general: the app keeps the answer with the evaluation it was asked about and drops it when the shown state is another.

The generic form is designed in full with package 1b (the first query with arguments worth a form); this step only makes the place for it: `panels/query.ts` with the view of the collisions, asked through `engine.query`.

## What a new feature type costs in the app afterwards

1. `features/<type>.ts`: the entry with its form.
2. `features/index.ts`: one line.
3. Texts of new issue codes and face roles in `issue-text.ts` (one line each; the compiler asks for them, the tables are typed by the unions of the engine).

A new field of an existing form (offset, taper) is an edit of that form's file only. A new query costs nothing, or one file for its view.

## How it is done without changing behaviour

The class has no test, and the split moves event handling and DOM building, which the type check does not cover. So the check is written first.

**A click script, run before and after every commit.** A fixed sequence of actions in the running app, driven through the browser (the Playwright MCP server of the development setup; no dependency of the project): a sketch with a rectangle, a circle and two dimensions; an extrusion; a sketch on a face and a cut through all; a plane; a pattern of the cut; a gear from the generator; each feature opened again and changed; a parameter and a check; the collisions; hide and show; move on the timeline; undo and redo; save. IDs are generated by counters, so the run is deterministic. Compared between the two runs:

- the saved document, byte for byte,
- the text of the panel and of the status line after every step,
- a screenshot of the view at fixed steps.

The script is kept in `packages/app/test/smoke/` as a list of steps that a session replays; it is not part of `npx vitest run`.

Order, one commit each:

1. `host.ts`: the interface, and `App` declared to implement it. No code moves.
2. `panels/parameters.ts`, `panels/collisions.ts`, `panels/model.ts`: the panels that are not forms.
3. `features/draft.ts`: the one draft mode; the three mode interfaces become `DraftMode` with `extra`. This is the commit with real edits, not moves.
4. `features/plane.ts`, `features/pattern.ts`, `features/extrude.ts`, `features/sketch.ts`, one commit each, and `features/index.ts` in place of the chains of conditions.
5. `scene.ts` and `sketch-mode.ts` with `panels/sketch.ts`.
6. `panels/query.ts` with the collisions asked through `engine.query` (after part 1 of the step).

Checks after each: the type check, the four test files of the app, the click script, and `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change` read for what is not a move.

## Open

- **A test of the class in the test suite.** A DOM in Vitest (`happy-dom` or `jsdom`) would let the click script run as a test, with the viewport replaced by a stub. It is a new development dependency and needs the owner's approval (D2); the proposal above does without it.
- **The sketch mode** is about 600 lines and is moved as one piece. Splitting it by drawing tool is not needed for D36 (step 6 adds the fillet of a corner as a sketch tool of the engine catalog, which the app runs already).
- **The toolbar** grows by a button per feature type. A menu by group (create, modify, bodies) is a question of step 2, when the count is known.
- **Czech texts.** The moved code keeps its texts; a line that changes anyway is written in English, as the rule of the project says.

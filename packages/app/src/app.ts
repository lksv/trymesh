// Demo app over the engine: timeline, 3D view, sketcher, extrusion panel, planes and patterns. Holds only
// the state of the UI (mode, selection, position marker, visibility); it reads everything else from
// EngineState.
import {
  type Command,
  type EdgeKind,
  type Engine,
  type EngineState,
  type FaceName,
  type Feature,
  type FeatureResult,
  type Frame,
  type Id,
  type Issue,
  type MechanismResult,
  type PlaneRef,
  type SectionResult,
  type Vec2,
  type Vec3,
  bodyOwner,
  emptyDocument,
  faceKey,
  insertedFeature,
  namedBySections,
  printedBodies,
  takenOver,
} from '@trymesh/engine';
import { type BridgeConnection, type BridgeStatus, MUTATING, changesDocument, connectBridge, outlineSaid } from '@trymesh/mcp/bridge-client';
import type { AppMode, AppSelection, SelectionSpot } from '@trymesh/mcp/get-selection';
import type { ViewCapability } from '@trymesh/mcp/view-image';
import { byId, download, h } from './dom';
import { insideFill, keptSegments } from './draw';
import { type AnyDraft, type DraftState, updatePreview } from './features/draft';
import { FEATURE_UI, TOOLBAR, uiOf } from './features/index';
import { type Note, PICK_REACH, type ViewPick, pickKey } from './host';
import { exportMenu, takeExportSelection } from './panels/export';
import { type QueryPanel, answeredAsModelled, dropAnswer, followQueries, openQuery, queryMenu, queryScene, shownAnswer, takeSelection } from './panels/query';
import { type MechanismPanel, blockedNote, jointPicksFace, takeMechanismSelection } from './panels/mechanism';
import { modelPanel } from './panels/model';
import { drawPicture, savePicture, viewCapability } from './picture';
import { type Pose, holdsPose, placedSegments, poseOf } from './pose';
import { sketchPanel, updateSketchStatus } from './panels/sketch';
import { type SceneHost, modelBounds, modelScene, shownCut } from './scene';
import { type Want, entityOf, namesFeature, pickAnswer, spotAt, spotStillThere } from './selection';
import { type SketchContext, type SketchHost, type SketchMode, type SketchState, deleteSelection, dropPoint, setTool, settleSketch, sketchClick, sketchContextOf, sketchDown, sketchEscape, sketchFinish, sketchMode, sketchMove, sketchScene } from './sketch-mode';
import { SKETCH_TOOL_UI, type SketchToolName } from './sketch-tools';
import { type View, Viewport } from './viewport';
import { bodyName, faceLabel, featureName, featureNameIn, issueText, takenOverText } from './issue-text';

type Pick = ViewPick;
type Mode = { kind: 'model' } | SketchMode | AnyDraft;
const isDraft = (m: Mode): m is AnyDraft => m.kind === 'draft';

// The same frames of the base planes as in the engine (which does not expose them outside the result of the recompute).
const BASE: Record<'XY' | 'XZ' | 'YZ', Frame> = {
  XY: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
};

export class App implements SketchHost, SceneHost {
  private readonly viewport: View;
  private readonly pictures: ViewCapability; // a picture of a model, for the AI and for the button that saves one
  private mode: Mode = { kind: 'model' };
  selected?: Pick; // selection in the view (model mode)
  hover?: Pick;
  selectedFeature?: Id; // selection on the timeline
  marker: Id | null = null; // the feature after which features are inserted; null = end of the timeline
  private markerIndex = 0; // where the marker lay last, in case its feature disappears
  readonly hidden = new Set<Id>();
  private showBasePlanes = true;
  pending?: Feature['type']; // a new feature of this type waits for its plane to be picked
  private readonly queries: QueryPanel = {}; // the query open in the model panel, with its answer
  private readonly mechanism: MechanismPanel = {}; // the form open in the panel of the mechanism, the pose a slider previews
  note: Note = { text: '', error: false };
  private readonly counters = new Map<string, number>();
  private cache?: EngineState;
  readonly drafting: DraftState = { cost: 0, confirming: false };
  readonly sketching: SketchState = { tools: {} }; // remembered between sketches
  private contextCache?: SketchContext | null;
  private down?: { x: number; y: number; button: number };
  // For the AI (D74): the last click in the view, as it was then (marked in the view), and where
  // the pointer is while it is over the view.
  private click?: SelectionSpot;
  private pointerAt?: { clientX: number; clientY: number };

  // `view`: the view to draw into and to pick in; the real one by default (a test passes its own).
  constructor(readonly engine: Engine, view?: View) {
    this.viewport = view ?? new Viewport(byId('viewport'));
    this.pictures = viewCapability(this.viewport);
    engine.subscribe(() => {
      dropAnswer(this.queries); // the answer of a query belonged to the document as it was
      this.refresh();
    });
    const canvas = this.viewport.element;
    canvas.addEventListener('pointerdown', (event) => this.onDown(event));
    canvas.addEventListener('pointermove', (event) => this.onMove(event));
    canvas.addEventListener('pointerup', (event) => this.onUp(event));
    // a drag interrupted by the system (pointer lost) is discarded; after a normal release none is running any more
    for (const type of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => this.cancelDrag() && this.refresh());
    canvas.addEventListener('pointerleave', () => (this.pointerAt = undefined));
    window.addEventListener('keydown', (event) => this.onKey(event));
    this.say('Start with a sketch: the Sketch button and a choice of plane.');
    this.refresh();
    this.fit();
  }

  // ---------------------------------------------------------------- state

  get doc() {
    return this.engine.getState().document;
  }
  feature(id: Id | undefined | null): Feature | undefined {
    return id == null ? undefined : this.doc.features.find((f) => f.id === id);
  }
  // Names for a human: see issue-text.ts.
  // a feature an insertion brought (D62) by the insertion and its name there
  readonly featureNames = (id: Id): string | undefined => featureNameIn(this.doc, id);
  nameOf(id: Id): string {
    return featureName(id, this.featureNames);
  }
  // A body by the name of its properties (D48): of the shown model, else of the whole one.
  readonly bodyNames = (body: Id): string | undefined => {
    for (const { evaluation } of [this.view(), this.engine.getState()]) if (Object.prototype.hasOwnProperty.call(evaluation.bodyProperties, body)) return evaluation.bodyProperties[body].name;
    return undefined;
  };
  bodyName(body: Id): string {
    return bodyName(body, this.featureNames, this.bodyNames);
  }
  // A body is hidden at the feature that created it; the copies of a pattern all at once.
  bodyHidden(body: Id): boolean {
    return this.hidden.has(bodyOwner(body).feature);
  }

  // The state being shown: the model after the position marker, after the feature being edited, or a preview.
  // In the model mode a slider of the mechanism being dragged previews a pose (D49).
  view(): EngineState {
    if (this.cache) return this.cache;
    const m = this.mode;
    if (m.kind === 'sketch') this.cache = m.preview ?? this.engine.getState(m.id);
    else if (m.kind === 'model') this.cache = this.mechanism.preview ?? (this.marker ? this.engine.getState(this.marker) : this.engine.getState());
    // a form that picks from the model before its feature shows that model while it picks
    else this.cache = (m.form.picks?.(m)?.before ? undefined : m.preview) ?? this.stateBefore(m.index);
    return this.cache;
  }
  // Before the first feature there is no state of the engine: it is the whole one without what the
  // timeline makes. The mechanism keeps its joints and the transforms of its links (nothing at that
  // place reads them: a form shows the model as modelled), and its links have no body.
  stateBefore(index: number): EngineState {
    const previous = this.doc.features[index - 1];
    if (previous) return this.engine.getState(previous.id);
    const state = this.engine.getState();
    const { mechanism } = state.evaluation;
    const links = Object.fromEntries(Object.entries(mechanism.links).map(([id, link]) => [id, { ...link, bodies: [], missing: [...link.bodies, ...link.missing] }]));
    return { ...state, evaluation: { ...state.evaluation, features: {}, bodies: {}, faceNames: [], faceSurfaces: [], bodyProperties: {}, mechanism: { ...mechanism, links, unassigned: [] } } };
  }
  // The mechanism whose pose the view shows (D49): that of the shown state in the model mode. A
  // sketch and a form show the model as modelled, where sketches, planes and the references of
  // features are; so does the answer of a query asked as modelled while it is shown.
  shownMechanism(): MechanismResult | undefined {
    if (this.mode.kind !== 'model' || answeredAsModelled(this.queries, this)) return undefined;
    return this.view().evaluation.mechanism;
  }
  pose(): Pose {
    return poseOf(this.shownMechanism());
  }
  invalidate(): void {
    this.cache = undefined;
    this.contextCache = undefined;
  }

  insertIndex(): number {
    const at = this.doc.features.findIndex((f) => f.id === this.marker);
    return at < 0 ? this.doc.features.length : at + 1;
  }

  // The ID of a new entity: a prefix and a sequence number that does not occur in the document yet. The counter
  // does not go back during work, so the ID of a deleted entity is not used again. An ID a section of the
  // document still names (the feature of body properties whose body is gone) counts as used.
  readonly newId = (prefix: string): Id => {
    // the links and the joints of the mechanism (D49) have IDs of their own
    const used = new Set<Id>([...namedBySections(this.doc), ...Object.keys(this.doc.mechanism.links), ...Object.keys(this.doc.mechanism.joints)]);
    for (const f of this.doc.features) {
      used.add(f.id);
      if (f.type === 'sketch') for (const group of [f.points, f.curves, f.constraints, f.external]) for (const id of Object.keys(group)) used.add(id);
    }
    let n = this.counters.get(prefix) ?? 1;
    while (used.has(`${prefix}${n}`)) n++;
    this.counters.set(prefix, n + 1);
    return `${prefix}${n}`;
  };

  // Connection to the MCP server: the AI then works with the document open in the app.
  private bridge?: BridgeConnection;
  private bridgeStatus: BridgeStatus = 'off';
  private toggleBridge(): void {
    if (this.bridge) {
      this.bridge.stop();
      this.bridge = undefined;
      return this.say('Connection to the AI turned off.');
    }
    let restore: (() => void) | undefined;
    this.bridge = connectBridge(this.engine, {
      // what the operations of the app need of it (AppHost), with its engine
      host: { engine: this.engine, view: this.pictures, selection: { selection: () => this.selection() } },
      onStatus: (status) => {
        this.bridgeStatus = status;
        if (status === 'connected') this.say('Connected to the MCP server: the AI sees and changes this document.');
        else if (status === 'connecting') this.say('Waiting for the MCP server (the AI client starts it)…');
        this.renderToolbar();
      },
      onDisplaced: () => {
        this.bridge = undefined;
        this.say('Another app (another window or tab) has connected to the AI; the connection is off here.', true);
      },
      // A change from the AI under an operation in progress (extrusion, plane) would pull the ground from
      // under it, so the operation is cancelled before the change; only when the command really changes the
      // document. Loading another document replaces the state of the UI too, just as Open does; on failure
      // the state is restored.
      beforeCall: (name, args) => {
        if (!MUTATING.includes(name)) return;
        if (name === '_load') {
          restore = this.swapUi();
          return;
        }
        if (!isDraft(this.mode)) return;
        if (changesDocument(this.engine, name, args)) this.setMode({ kind: 'model' });
      },
      onCall: (name, outcome, args) => {
        // A picture is drawn off the screen: nothing shows that one was taken but this line. It
        // is a question, like the others the AI asks without a word here: one that is refused
        // says nothing (the AI has the reason), and one that is taken does not replace an error
        // the user has not dealt with.
        if (name === 'view_image') return outcome.ok && !this.note.error ? this.say('AI: a picture of the model was taken.') : undefined;
        if (!MUTATING.includes(name)) return;
        // the import of an outline (D72) answers ok also when its command was refused, since the
        // answer carries the report: the line reads the answer. A look at a file is a question and
        // says nothing, also when the file cannot be read; a placement that fails is said in words,
        // not by the name of the internal tool
        if (name === '_outline') {
          if (!outcome.ok) return args.sketch === undefined || args.sketch === null ? undefined : this.say(`AI: the outline was not imported: ${outcome.error}`, true);
          const said = outlineSaid(outcome.result);
          return said ? this.say(said.text, said.error) : undefined;
        }
        // the AI emptied the document (D74): the click was on the document that went
        if (name === 'new_document' && outcome.ok) this.markClick(undefined);
        if (name === '_load') {
          if (!outcome.ok) restore?.();
          restore = undefined;
          this.refresh();
        }
        this.say(outcome.ok ? `AI: ${name === '_load' ? 'document opened' : name}` : `AI: ${name === '_load' ? 'opening the document' : name} failed: ${outcome.error}`, !outcome.ok);
      },
    });
  }

  say(text: string, error = false): void {
    this.note = { text, error };
    this.renderStatus();
  }
  // The note, and after it which of the two the view shows while the document holds a pose of the
  // mechanism (D49): the pose, or the model as modelled.
  private renderStatus(): void {
    const bar = byId('status');
    const pose = this.poseText();
    bar.replaceChildren(this.note.text, ...(pose ? [h('span', { className: 'pose' }, `${this.note.text ? ' · ' : ''}${pose}`)] : []));
    bar.classList.toggle('error', this.note.error);
  }
  private poseText(): string {
    const shown = this.shownMechanism();
    if (shown) return holdsPose(shown) ? `The view shows the pose of the mechanism.${blockedNote(this, shown)}` : '';
    if (this.mode.kind === 'model') return holdsPose(this.view().evaluation.mechanism) ? 'The view shows the model as modelled, as the answer of the query was asked.' : '';
    return holdsPose(this.engine.getState().evaluation.mechanism) ? 'The view shows the model as modelled: sketches and features are edited there.' : '';
  }

  // Runs a command; an invalid command does not change the document and the message shows in the status line.
  run(command: Command, done?: string): boolean {
    const now = this.engine.getState();
    const before = this.failedChecks(now);
    const result = this.engine.execute(command);
    if (!result.ok) return this.say(result.error.message, true), false;
    // a check the command made fail takes precedence over the ordinary message
    const failed = this.failedChecks(result.state).filter((name) => !before.includes(name));
    // what an entry of a section kept for an ID the command used again (D48, D49)
    const taken = takenOver(now.document, command);
    if (failed.length > 0) this.say(`Check failed: ${failed.join('; ')}`, true);
    else if (taken.length > 0) this.say(`${done === undefined ? '' : `${done} `}${takenOverText(now.document, taken)}`);
    else if (done !== undefined) this.say(done);
    else if (this.note.error) this.say(''); // an old error no longer holds after a successful command
    return true;
  }
  private failedChecks(state: EngineState): string[] {
    return state.document.checks.map((check) => check.name).filter((name) => state.evaluation.checks[name]?.status !== 'ok');
  }

  // ---------------------------------------------------------------- redraw

  refresh(): void {
    this.cancelDrag(); // the document may have changed under a drag in progress
    this.mechanism.preview = undefined; // a pose previewed by a slider ends with its drag
    this.invalidate();
    const m = this.mode;
    // A marker whose feature disappeared (undo, deletion) falls to the feature before it.
    const features = this.doc.features;
    const at = features.findIndex((f) => f.id === this.marker);
    if (this.marker && at < 0) this.marker = features[Math.min(this.markerIndex, features.length) - 1]?.id ?? null;
    if (this.marker && this.marker === features[features.length - 1]?.id) this.marker = null;
    this.markerIndex = features.findIndex((f) => f.id === this.marker);
    followQueries(this.queries, this);
    if (this.selectedFeature && !this.feature(this.selectedFeature)) this.selectedFeature = undefined;
    if (m.kind === 'sketch' && this.feature(m.id)?.type !== 'sketch') this.mode = { kind: 'model' };
    if (isDraft(m) && m.editing && !this.feature(m.draft.id)) this.mode = { kind: 'model' };
    if (isDraft(this.mode) && !this.drafting.confirming) updatePreview(this);
    if (this.mode.kind === 'sketch') settleSketch(this.mode, this.sketchContext());
    // A selection in the view holds only for what is visible now (another state of the model, hiding, undo).
    this.hover = undefined;
    if (this.selected && !this.stillThere(this.selected)) this.selected = undefined;
    this.renderToolbar();
    this.renderTimeline();
    this.renderPanel();
    this.renderScene();
    this.renderStatus();
  }

  // Discards a drag of a point in progress and its preview. Returns whether one was running.
  private cancelDrag(): boolean {
    const m = this.mode;
    if (m.kind !== 'sketch' || !m.drag) return false;
    m.drag = undefined;
    m.preview = undefined;
    this.invalidate();
    return true;
  }

  // Is a face, edge or plane selected in the state of the model shown now?
  private stillThere(pick: Pick): boolean {
    const state = this.view();
    if (pick.kind === 'plane') return this.planes(state).some((plane) => plane.key === pick.key);
    const body = state.evaluation.bodies[pick.body];
    if (!body || this.bodyHidden(pick.body)) return false;
    if (pick.kind === 'face') return body.faces.some((face) => face.id === pick.faceId) && faceKey(state.evaluation.faceNames[pick.faceId]) === faceKey(pick.name);
    const edge = body.edges[pick.index];
    return edge !== undefined && faceKey(edge.name.a) === faceKey(pick.name.a) && faceKey(edge.name.b) === faceKey(pick.name.b);
  }

  // ----- what the forms use of the mode (PanelHost)
  get draft(): AnyDraft | undefined {
    return isDraft(this.mode) ? this.mode : undefined;
  }
  openDraft(mode: AnyDraft): void {
    this.setMode(mode);
  }
  closeDraft(deselect: boolean): void {
    if (deselect) this.selectedFeature = undefined;
    this.setMode({ kind: 'model' });
  }
  inserted(id: Id): void {
    if (this.marker) this.marker = id;
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.pending = undefined;
    this.hover = undefined;
    this.selected = undefined; // a selection in the view belongs to one action; the new sketch must not inherit it
    this.refresh();
  }

  // ---------------------------------------------------------------- toolbar

  private renderToolbar(): void {
    const m = this.mode;
    const state = this.engine.getState();
    const button = (label: string, action: () => void, options: { title?: string; disabled?: boolean; active?: boolean } = {}) =>
      h('button', { textContent: label, onclick: action, title: options.title ?? '', disabled: options.disabled === true, className: options.active ? 'active' : '' });
    const group = (...items: HTMLElement[]) => h('div', { className: 'group' }, ...items);
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => void this.open(file) });
    // An extrusion or plane in progress is not in the document yet; an undo under it would pull the ground
    // from under it.
    const drafting = isDraft(m);

    const groups = [
      group(
        button('New', () => this.newDocument(), { title: 'Empty document' }),
        button('Open', () => file.click()),
        button('Save', () => download('model.trymesh.json', this.engine.save(), 'application/json')),
        // the printed bodies into one file (D48); a reference or auxiliary body by the link of its line
        button('Export STL', () => download('model.stl', new Uint8Array(this.engine.exportMesh('stl')), 'model/stl'), { disabled: printedBodies(state.evaluation.bodyProperties).length === 0 }),
        file,
      ),
      group(
        button(this.bridgeStatus === 'connected' ? 'AI: connected' : this.bridgeStatus === 'connecting' ? 'AI: waiting…' : 'AI', () => this.toggleBridge(), {
          title: 'Connect to the MCP server (packages/mcp): the AI then reads and changes the document open in the app',
          active: this.bridgeStatus !== 'off',
        }),
      ),
      group(
        button('↶ Undo', () => this.engine.undo(), { disabled: !state.canUndo || drafting, title: 'Ctrl+Z' }),
        button('↷ Redo', () => this.engine.redo(), { disabled: !state.canRedo || drafting, title: 'Ctrl+Shift+Z' }),
      ),
    ];
    if (m.kind === 'model') {
      groups.push(
        // a button per feature type that has one, in the order of TOOLBAR
        group(...TOOLBAR.flatMap((type) => (FEATURE_UI[type].button ? [button(FEATURE_UI[type].button.label, () => this.create(type), { title: FEATURE_UI[type].button.title, active: this.pending === type })] : []))),
        // every query of the catalog of the engine from one menu; the collisions keep their button;
        // every export format from another (D54), its form where the form of a query is
        group(
          queryMenu(this.queries, this),
          exportMenu(this.queries, this),
          button('Collisions', () => openQuery(this.queries, this, 'interference'), { title: 'Check which bodies share a volume', disabled: Object.keys(this.view().evaluation.bodies).length < 2, active: this.queries.open?.name === 'interference' && shownAnswer(this.queries, this) !== undefined }),
        ),
      );
    } else if (m.kind === 'sketch') {
      groups.push(
        group(...(Object.keys(SKETCH_TOOL_UI) as SketchToolName[]).map((tool) => button(SKETCH_TOOL_UI[tool].label, () => setTool(this, tool), { title: SKETCH_TOOL_UI[tool].hint, active: m.tool === tool }))),
        group(
          button('Construction', () => ((m.construction = !m.construction), this.say(m.construction ? 'New curves will be construction curves: they help with constraints but do not form a profile.' : 'New curves will be normal.'), this.refresh()), {
            title: 'The drawing tools create construction (helper) curves',
            active: m.construction === true,
          }),
        ),
        group(h('button', { textContent: 'Finish sketch', className: 'primary', onclick: () => this.finishSketch() })),
      );
    }
    groups.push(
      group(
        button('Fit all', () => this.fit()),
        button('Save picture', () => void this.savePicture(), {
          title: 'Save a picture of the model as PNG: the bodies that are shown, from the camera of the view and cut as the view is; without the selection, sketches, planes and dimensions',
          disabled: Object.keys(this.view().evaluation.bodies).every((body) => this.bodyHidden(body)),
        }),
        button('Base planes', () => ((this.showBasePlanes = !this.showBasePlanes), this.refresh()), { active: this.showBasePlanes, title: 'Show or hide the planes XY, XZ, YZ' }),
      ),
    );
    byId('toolbar').replaceChildren(...groups);
  }

  private newDocument(): void {
    this.resetUi();
    this.engine.load(JSON.stringify(emptyDocument()));
    this.bridge?.documentReplaced();
    this.say('New document.');
  }

  private async open(input: HTMLInputElement): Promise<void> {
    const text = await input.files?.[0]?.text();
    if (text === undefined) return;
    // The state of the UI is replaced before loading (the engine sends out the new state during it) and
    // restored on error.
    const restore = this.swapUi();
    const result = this.engine.load(text);
    if (result.ok) {
      this.bridge?.documentReplaced();
      this.say('Document loaded.');
      return this.fit();
    }
    restore();
    this.say(`The file cannot be opened: ${result.error.message}`, true);
  }

  // Returns the UI to its initial state and gives a function that restores the original state.
  private swapUi(): () => void {
    const saved = { mode: this.mode, marker: this.marker, hidden: [...this.hidden], pending: this.pending, selectedFeature: this.selectedFeature, click: this.click };
    this.resetUi();
    return () => {
      Object.assign(this, { mode: saved.mode, marker: saved.marker, pending: saved.pending, selectedFeature: saved.selectedFeature });
      for (const id of saved.hidden) this.hidden.add(id);
      this.markClick(saved.click);
    };
  }

  private resetUi(): void {
    this.mode = { kind: 'model' };
    this.marker = null;
    this.pending = undefined;
    this.selectedFeature = undefined;
    this.selected = undefined;
    this.hidden.clear();
    this.markClick(undefined); // the click was on the document that goes
  }

  // ---------------------------------------------------------------- timeline

  private renderTimeline(): void {
    const full = this.engine.getState();
    const markerIndex = this.insertIndex();
    const editing: Id | undefined = this.mode.kind === 'sketch' ? this.mode.id : isDraft(this.mode) ? this.mode.draft.id : undefined;
    const busy = this.mode.kind !== 'model';
    const rows: HTMLElement[] = [h('h2', {}, 'Timeline')];
    const markerRow = () => h('div', { className: 'marker', title: 'New features are inserted here' }, 'insert here');

    const bodiless = (f: Feature): boolean => !uiOf(f.type).hideable(f);
    full.document.features.forEach((f, index) => {
      const result: FeatureResult | undefined = full.evaluation.features[f.id];
      const status = result?.status ?? 'ok';
      const issue = result?.error ? this.issueText(result.error) : (result?.warnings.map((w) => this.issueText(w)).join(' ') ?? '');
      const icon = (label: string, title: string, action: () => void, disabled = false) =>
        h('button', {
          className: 'icon',
          textContent: label,
          title,
          disabled: disabled || busy,
          onclick: (event: MouseEvent) => {
            event.stopPropagation();
            action();
          },
        });
      const row = h(
        'div',
        {
          className: ['row', status, f.id === this.selectedFeature ? 'selected' : '', f.id === editing ? 'editing' : '', index >= markerIndex ? 'later' : '', this.hidden.has(f.id) ? 'hidden' : ''].join(' '),
          title: issue,
          onclick: () => {
            if (busy) return;
            this.selectedFeature = this.selectedFeature === f.id ? undefined : f.id;
            this.refresh();
          },
          ondblclick: () => !busy && this.edit(f.id),
        },
        h('span', { className: 'dot', textContent: status === 'error' ? '✖' : status === 'warning' ? '▲' : status === 'suppressed' ? '○' : '●' }),
        h('span', { className: 'name', textContent: f.name }),
        // A body is hidden at the feature that created it: an addition, a cut and a pattern of
        // features have no body of their own; a pattern of a body hides all its copies.
        icon(
          this.hidden.has(f.id) ? '◌' : '👁',
          bodiless(f) ? 'A body is hidden at the feature that created it' : 'Hide or show',
          () => {
            if (!this.hidden.delete(f.id)) this.hidden.add(f.id);
            this.refresh();
          },
          bodiless(f),
        ),
        icon('↑', 'Move earlier', () => this.run({ type: 'moveFeature', id: f.id, index: index - 1 }), index === 0),
        icon('↓', 'Move later', () => this.run({ type: 'moveFeature', id: f.id, index: index + 1 }), index === full.document.features.length - 1),
        icon('⇤', 'Roll the model back to here: further features are inserted after this one', () => {
          this.marker = index === full.document.features.length - 1 ? null : f.id;
          this.refresh();
        }),
      );
      rows.push(row);
      if (index + 1 === markerIndex && markerIndex < full.document.features.length) rows.push(markerRow());
    });
    if (full.document.features.length === 0) rows.push(h('p', { className: 'hint' }, 'Empty so far. New features will appear here.'));
    else if (this.marker) rows.push(h('button', { className: 'link', textContent: 'Show the whole model', disabled: busy, onclick: () => ((this.marker = null), this.refresh()) }));
    byId('timeline').replaceChildren(...rows);
  }

  edit(id: Id): void {
    const f = this.feature(id);
    if (!f) return;
    uiOf(f.type).edit(this, f);
  }

  // ---------------------------------------------------------------- right panel

  renderPanel(): void {
    const m = this.mode;
    const panel = byId('panel');
    if (m.kind === 'sketch') panel.replaceChildren(...sketchPanel(this, m));
    else if (isDraft(m)) panel.replaceChildren(...m.form.panel(m, this));
    else panel.replaceChildren(...modelPanel(this, this.queries, this.mechanism));
  }

  // The text of an issue for a human, with the bodies, features and copies it is about named.
  issueText(issue: Issue): string {
    return issueText(issue, this.featureNames, this.bodyNames, (id) => insertedFeature(this.doc, id)?.feature.type);
  }

  issues(result: FeatureResult | undefined): HTMLElement[] {
    if (!result) return [];
    const out: HTMLElement[] = [];
    if (result.error) out.push(h('p', { className: 'issue error' }, this.issueText(result.error)));
    for (const warning of result.warnings) out.push(h('p', { className: 'issue warning' }, this.issueText(warning)));
    // expression errors by field
    for (const [path, error] of Object.entries(result.fieldErrors ?? {})) out.push(h('p', { className: 'issue error' }, `Field ${path}: ${error.message}`));
    return out;
  }

  describe(pick: Pick): string {
    if (pick.kind === 'plane') return pick.ref.kind === 'base' ? `Plane ${pick.ref.plane}` : pick.ref.kind === 'plane' ? `Plane "${this.nameOf(pick.ref.feature)}"` : 'Plane';
    const face = (name: FaceName) => faceLabel(name, this.featureNames, (id) => insertedFeature(this.doc, id)?.feature.type);
    if (pick.kind === 'face') return `Face: ${face(pick.name)}${pick.planar ? '' : ' (not planar)'}`;
    const kinds: Record<EdgeKind, string> = { line: 'line', circle: 'circle', coplanar: 'between coplanar faces', other: 'general curve' };
    return `Edge (${kinds[pick.edgeKind]}): ${face(pick.name.a)} × ${face(pick.name.b)}`;
  }

  planeRefOf(pick: Pick | undefined): PlaneRef | undefined {
    if (pick?.kind === 'plane') return pick.ref;
    if (pick?.kind === 'face' && pick.planar) return { kind: 'face', body: pick.body, face: pick.name };
    return undefined;
  }

  // ---------------------------------------------------------------- selection in the view

  planeSize(state: EngineState): number {
    const { min, max } = modelBounds(state);
    return Math.max(20, 0.7 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
  }

  // Saves a picture of the model as the user has it: the bodies that are not hidden, from the
  // camera of the view, cut as the section view cuts it.
  private async savePicture(): Promise<void> {
    const state = this.view();
    const visible = Object.keys(state.evaluation.bodies).filter((body) => !this.bodyHidden(body));
    // the section the view shows: only the model mode draws what a query adds
    const answer = this.mode.kind === 'model' && this.queries.open?.name === 'section' ? shownAnswer(this.queries, this) : undefined;
    const shown = answer?.outcome.ok ? (answer.outcome.result as SectionResult) : undefined;
    // the bodies where the view puts them: in the pose, or as modelled (D49)
    const pose = this.pose();
    try {
      const said = await savePicture({ image: (request) => drawPicture(this.viewport, request, pose) }, state, visible, shown, (name, base64) => download(name, Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)), 'image/png'));
      this.say(said.text, said.error);
    } catch (error) {
      this.say(`The picture could not be drawn: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  private fit(): void {
    const { min, max } = modelBounds(this.view(), this.pose());
    this.viewport.fit(min, max);
  }

  // Planes that are visible and can be selected.
  planes(state: EngineState): Extract<Pick, { kind: 'plane' }>[] {
    const out: Extract<Pick, { kind: 'plane' }>[] = [];
    if (this.showBasePlanes) for (const plane of ['XY', 'XZ', 'YZ'] as const) out.push({ kind: 'plane', key: plane, ref: { kind: 'base', plane }, frame: BASE[plane] });
    for (const f of state.document.features) {
      const frame = state.evaluation.features[f.id]?.plane;
      const drafted = isDraft(this.mode) && this.mode.draft.id === f.id; // a plane cannot be its own base
      if (f.type === 'plane' && frame && !this.hidden.has(f.id) && !drafted) out.push({ kind: 'plane', key: f.id, ref: { kind: 'plane', feature: f.id }, frame });
    }
    return out;
  }

  // What is under the cursor: an edge takes precedence over a face, a face over a plane.
  pick(event: { clientX: number; clientY: number }, want: { edges?: boolean; faces?: boolean; planes?: boolean }): Pick | undefined {
    const state = this.view();
    const pose = this.pose(); // the bodies are picked where the view draws them (D49)
    const hit = this.viewport.pickBody(event.clientX, event.clientY); // the view skips what is cut away
    // A cut model: nothing is picked through the filled cut. A ray that meets a filled region
    // before anything that is drawn would otherwise pick the far wall of the body, or a body
    // behind it, by a click on what looks like solid material.
    const cut = this.mode.kind === 'model' ? shownCut(queryScene(this.queries, this), this) : undefined;
    if (cut) {
      for (const fill of cut.fills) {
        const p = this.planePoint(event, fill.frame);
        if (p && p.depth > 0 && insideFill(p.at, fill.loops) && (!hit || p.depth < hit.depth)) return undefined; // in front of the eye
      }
    }
    if (want.edges) {
      const project = this.viewport.projector();
      const slack = 8 * this.viewport.pixelSize();
      let best: Pick | undefined;
      let bestDistance = PICK_REACH;
      for (const [body, data] of Object.entries(state.evaluation.bodies)) {
        if (this.bodyHidden(body)) continue;
        data.edges.forEach((edge, index) => {
          if (edge.kind === 'coplanar') return;
          const s = keptSegments(placedSegments(edge.segments, pose(body).transform), cut?.clip); // an edge that is cut away is not drawn
          for (let i = 0; i < s.length; i += 6) {
            const [a, b] = [project(s[i], s[i + 1], s[i + 2]), project(s[i + 3], s[i + 4], s[i + 5])];
            const [dx, dy] = [b.x - a.x, b.y - a.y];
            const length2 = dx * dx + dy * dy;
            const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((event.clientX - a.x) * dx + (event.clientY - a.y) * dy) / length2));
            const distance = Math.hypot(a.x + t * dx - event.clientX, a.y + t * dy - event.clientY);
            const depth = a.depth + t * (b.depth - a.depth);
            // an edge hidden behind a body is not selected
            if (distance < bestDistance && (!hit || depth <= hit.depth + slack)) {
              bestDistance = distance;
              best = { kind: 'edge', body, index, name: edge.name, edgeKind: edge.kind };
            }
          }
        });
      }
      if (best) return best;
    }
    if (hit && want.faces) {
      const body = state.evaluation.bodies[hit.body];
      const faceId = body.solid.faceIds[hit.triangle];
      return { kind: 'face', body: hit.body, faceId, name: state.evaluation.faceNames[faceId], planar: body.faces.find((f) => f.id === faceId)?.planar === true };
    }
    if (!hit && want.planes) {
      const half = this.planeSize(state) / 2;
      let best: Pick | undefined;
      let bestDepth = Infinity;
      for (const plane of this.planes(state)) {
        const p = this.planePoint(event, plane.frame);
        if (p && Math.abs(p.at[0]) <= half && Math.abs(p.at[1]) <= half && p.depth < bestDepth) {
          best = plane;
          bestDepth = p.depth;
        }
      }
      return best;
    }
    return undefined;
  }

  // The intersection of the ray under the cursor with a plane, in the plane's coordinates.
  planePoint(event: { clientX: number; clientY: number }, frame: Frame): { at: Vec2; depth: number } | undefined {
    const { origin, direction } = this.viewport.ray(event.clientX, event.clientY);
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const facing = dot(direction, frame.normal);
    if (Math.abs(facing) < 1e-6) return undefined;
    const relative: Vec3 = [frame.origin[0] - origin[0], frame.origin[1] - origin[1], frame.origin[2] - origin[2]];
    const depth = dot(relative, frame.normal) / facing;
    const p: Vec3 = [origin[0] + depth * direction[0] - frame.origin[0], origin[1] + depth * direction[1] - frame.origin[1], origin[2] + depth * direction[2] - frame.origin[2]];
    return { at: [dot(p, frame.x), dot(p, frame.y)], depth };
  }

  // ---------------------------------------------------------------- events of the view

  private onDown(event: PointerEvent): void {
    this.pointerAt = { clientX: event.clientX, clientY: event.clientY };
    // Alt/Option + drag belongs to the view (rotating without a mouse), not to selection or drawing.
    this.down = { x: event.clientX, y: event.clientY, button: event.altKey ? -1 : event.button };
    const m = this.mode;
    if (this.down.button !== 0 || m.kind !== 'sketch') return;
    if (sketchDown(this, m, event)) this.viewport.element.setPointerCapture(event.pointerId);
  }

  private onMove(event: PointerEvent): void {
    this.pointerAt = { clientX: event.clientX, clientY: event.clientY };
    const m = this.mode;
    if (event.buttons !== 0 && !(m.kind === 'sketch' && m.drag)) return; // rotating and panning the view
    if (m.kind === 'sketch') {
      const moved = sketchMove(this, m, event, this.down);
      // while dragging, the panel is not rebuilt, only the state of how constrained the sketch is
      if (moved === 'drag') updateSketchStatus(this, m);
      return moved ? this.renderScene() : undefined;
    }
    // a form that asks for no pick of the view gets the bare event
    const wanted = isDraft(m) ? m.form.picks?.(m) : undefined;
    if (isDraft(m) && !wanted) return m.form.hover?.(m, event, undefined, this) ? this.renderScene() : undefined;
    const hover = this.pick(event, isDraft(m) ? { ...wanted } : this.modelPicks());
    if (pickKey(hover) === pickKey(this.hover)) return;
    this.hover = hover;
    this.renderScene();
  }

  // What the view picks outside a form: faces only while the form of a joint picks a round face for
  // its axis (D60), otherwise edges too (not while a plane is awaited) and planes.
  private modelPicks(): { edges?: boolean; faces: true; planes?: true } {
    return jointPicksFace(this.mechanism) ? { faces: true } : { edges: !this.pending, faces: true, planes: true };
  }

  private onUp(event: PointerEvent): void {
    const down = this.down;
    this.down = undefined;
    const m = this.mode;
    if (m.kind === 'sketch' && m.drag) {
      const drag = m.drag;
      m.drag = undefined;
      this.viewport.element.releasePointerCapture(event.pointerId);
      if (drag.moved) return dropPoint(this, m, drag.point, event);
    }
    if (!down || down.button !== 0 || event.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    // a form gets its clicks from the app: the bare event, or what it asked to be picked
    const wanted = isDraft(m) ? m.form.picks?.(m) : undefined;
    // the click as the AI reads it (D74), taken before the click acts: what it was on, not what it
    // made, picked as the click picks (a form that asks for no pick: as the model picks)
    this.recordClick(event, wanted ? { ...wanted } : this.modelPicks());
    if (m.kind === 'sketch') return sketchClick(this, m, event);
    if (isDraft(m) && !wanted) return m.form.click?.(m, event, undefined, this);
    const pick = this.pick(event, isDraft(m) ? { ...wanted } : this.modelPicks());
    if (isDraft(m)) return m.form.click?.(m, event, pick, this);
    const ref = this.planeRefOf(pick);
    if (this.pending) {
      const what = this.pending;
      if (!ref) this.say('Select a plane or a planar face.', true);
      else if (!this.usePlane(ref)) {
        this.pending = what; // the engine refused the selection (the message is in the status line); another one is awaited
        this.refresh();
      }
      return;
    }
    // an armed control of the open query or export, or the joint form picking a face, takes the selection; the app then keeps none of its own
    if (!pick || !(takeSelection(this.queries, pick) || takeExportSelection(this.queries, pick) || takeMechanismSelection(this, this.mechanism, pick))) this.selected = pick;
    this.renderPanel();
    this.renderScene();
  }

  private onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
    const m = this.mode;
    const drafting = isDraft(m);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (drafting) this.say('First confirm or cancel the feature in progress.', true);
      else if (event.shiftKey) this.engine.redo();
      else this.engine.undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      if (!drafting) this.engine.redo();
    } else if (event.key === 'Escape') {
      this.markClick(undefined); // every Escape removes the mark of the click (D74), besides its step back
      if (this.cancelDrag()) this.refresh();
      else if (m.kind === 'sketch') {
        sketchEscape(m);
        this.refresh();
      } else if (m.kind === 'model') {
        this.pending = undefined;
        this.selected = undefined;
        this.refresh();
      } else if (!m.form.cancel?.(m, this)) this.setMode({ kind: 'model' });
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && m.kind === 'sketch') {
      event.preventDefault();
      deleteSelection(this, m);
    } else if (event.key === 'Enter' && m.kind === 'sketch' && sketchFinish(this, m)) event.preventDefault(); // not also a click of the button in focus
  }

  // ---------------------------------------------------------------- the selection for the AI (D74)

  // The click as it was: in a form whose view shows its preview, a hit on the previewed feature
  // says so (the document does not have it yet).
  private recordClick(event: { clientX: number; clientY: number }, want: Want): void {
    const m = this.mode;
    const spot = spotAt(this, this.viewport, event, want);
    const previewed = spot && isDraft(m) && m.preview !== undefined && this.view() === m.preview && namesFeature(spot, m.draft.id);
    this.markClick(spot && previewed ? { ...spot, preview: true } : spot);
  }

  // The click the AI is given, and its mark in the view; undefined removes both.
  private markClick(spot: SelectionSpot | undefined): void {
    if (!spot && !this.click) return;
    this.click = spot;
    this.viewport.mark(spot?.point);
  }

  // What the operation get_selection answers: the mode, the selection on the timeline, in the view
  // and in the sketch, the last click, and what is under the pointer now.
  selection(): AppSelection {
    const m = this.mode;
    const mode: AppMode =
      m.kind === 'sketch'
        ? { kind: 'sketch', sketch: m.id, tool: m.tool }
        : isDraft(m)
          ? { kind: 'form', type: (m.draft as Feature).type, feature: m.draft.id, editing: m.editing }
          : { kind: 'model', ...(this.marker ? { at: this.marker } : {}), ...(this.pending ? { pending: this.pending } : {}) };
    const feature = this.feature(this.selectedFeature);
    const view = m.kind === 'sketch' ? this.sketchContext()?.view : undefined;
    const selected = m.kind === 'sketch' && view ? m.selection.flatMap((id) => entityOf(view, id) ?? []) : [];
    const pointer = this.pointerAt && spotAt(this, this.viewport, this.pointerAt);
    // A click whose body, face, edge, plane or sketch is gone (undo, removal) keeps only its point,
    // and its mark leaves the view. It is looked up in the state shown (a model rolled back, the
    // model before a form's feature) and in the whole document; a hit on a preview in the state
    // shown only.
    const click = this.click;
    if (click && !click.stale && !spotStillThere(click, this.view()) && (click.preview || !spotStillThere(click, this.engine.getState()))) {
      this.click = { point: click.point, stale: true };
      this.viewport.mark(undefined);
    }
    return {
      mode,
      ...(feature ? { feature: { id: feature.id, type: feature.type, name: feature.name } } : {}),
      ...(this.selected ? { pick: pickAnswer(this.selected) } : {}),
      ...(m.kind === 'sketch' && selected.length > 0 ? { sketch: { sketch: m.id, selected } } : {}),
      ...(this.click ? { click: this.click } : {}),
      ...(pointer ? { pointer } : {}),
    };
  }

  // ---------------------------------------------------------------- new sketch and plane

  // The button of a feature type: a type that starts on a plane waits for one, the others start at once.
  private create(type: Feature['type']): void {
    const create = FEATURE_UI[type].create;
    if (create?.plane) this.startOnPlane(type);
    else create?.run(this, { index: this.insertIndex() });
  }

  private startOnPlane(what: Feature['type']): void {
    const selected = this.feature(this.selectedFeature);
    // a plane selected on the timeline is used only when it lies before the insertion point
    const before = selected?.type === 'plane' && this.doc.features.indexOf(selected) < this.insertIndex();
    const ref = this.planeRefOf(this.selected) ?? (selected && before ? ({ kind: 'plane', feature: selected.id } as PlaneRef) : undefined);
    this.pending = what;
    if (ref && this.usePlane(ref)) return;
    // without a usable selection (or when the engine refused it), a click in the view is awaited
    this.pending = what;
    if (!ref) this.say('Select a plane or a planar face.');
    this.refresh();
  }

  cancelPending(): void {
    this.pending = undefined;
    this.refresh();
  }

  usePlane(ref: PlaneRef): boolean {
    const what = this.pending;
    this.pending = undefined;
    return what !== undefined && FEATURE_UI[what].create?.run(this, { index: this.insertIndex(), plane: ref }) === true;
  }

  // ---------------------------------------------------------------- sketch

  enterSketch(id: Id): void {
    this.selectedFeature = id;
    this.setMode(sketchMode(id));
    const frame = this.sketchContext()?.frame;
    if (frame) {
      this.viewport.lookAt(frame);
      this.fit();
    }
    this.say(SKETCH_TOOL_UI.select.hint);
  }

  private finishSketch(): void {
    this.setMode({ kind: 'model' });
    this.say('Sketch finished.');
  }

  // ----- what the sketch mode uses of the app (SketchHost)
  get sketch(): SketchMode | undefined {
    return this.mode.kind === 'sketch' ? this.mode : undefined;
  }
  sketchContext(): SketchContext | undefined {
    if (this.contextCache !== undefined) return this.contextCache ?? undefined;
    this.contextCache = null;
    const m = this.mode;
    if (m.kind !== 'sketch') return undefined;
    this.contextCache = sketchContextOf(this.view(), m.id) ?? null;
    return this.contextCache ?? undefined;
  }
  pixelSize(): number {
    return this.viewport.pixelSize();
  }

  // ---------------------------------------------------------------- scene

  // The scene of the model, then what the open sketch or the open form adds to it.
  renderScene(): void {
    const m = this.mode;
    const model = modelScene(this, this.queries, m.kind === 'sketch' ? m : undefined);
    if (m.kind === 'sketch') sketchScene(this, m, model);
    if (isDraft(m)) m.form.overlay?.(m, model, this);
    this.viewport.setScene(model);
  }
}

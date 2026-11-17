// Ukázková aplikace nad enginem: časová osa, 3D pohled, skicář, panel vysunutí, roviny a pole (pattern).
// Drží jen stav UI (režim, výběr, značku pozice, viditelnost); vše ostatní čte z EngineState.
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
  namedBySections,
  printedBodies,
  takenOver,
} from '@trymesh/engine';
import { type BridgeConnection, type BridgeStatus, MUTATING, changesDocument, connectBridge } from '@trymesh/mcp/bridge-client';
import type { ViewCapability } from '@trymesh/mcp/view-image';
import { byId, download, h } from './dom';
import { insideFill, keptSegments } from './draw';
import { type AnyDraft, type DraftState, updatePreview } from './features/draft';
import { FEATURE_UI, TOOLBAR, uiOf } from './features/index';
import { type Note, PICK_REACH, type ViewPick, pickKey } from './host';
import { exportMenu, takeExportSelection } from './panels/export';
import { type QueryPanel, answeredAsModelled, dropAnswer, followQueries, openQuery, queryMenu, queryScene, shownAnswer, takeSelection } from './panels/query';
import { type MechanismPanel, blockedNote } from './panels/mechanism';
import { modelPanel } from './panels/model';
import { drawPicture, savePicture, viewCapability } from './picture';
import { type Pose, holdsPose, placedSegments, poseOf } from './pose';
import { sketchPanel, updateSketchStatus } from './panels/sketch';
import { type SceneHost, modelBounds, modelScene, shownCut } from './scene';
import { type SketchContext, type SketchHost, type SketchMode, type SketchState, TOOLS, deleteSelection, dropPoint, setTool, settleSketch, sketchClick, sketchContextOf, sketchDown, sketchEscape, sketchMode, sketchMove, sketchScene } from './sketch-mode';
import { DEFAULT_FILLET, DEFAULT_POLYGON } from './sketch-commands';
import { type View, Viewport } from './viewport';
import { bodyName, faceLabel, featureName, issueText, takenOverText } from './issue-text';

type Pick = ViewPick;
type Mode = { kind: 'model' } | SketchMode | AnyDraft;
const isDraft = (m: Mode): m is AnyDraft => m.kind === 'draft';

// Stejné soustavy základních rovin jako v enginu (ten je mimo výsledek přepočtu nevystavuje).
const BASE: Record<'XY' | 'XZ' | 'YZ', Frame> = {
  XY: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
};

export class App implements SketchHost, SceneHost {
  private readonly viewport: View;
  private readonly pictures: ViewCapability; // a picture of a model, for the AI and for the button that saves one
  private mode: Mode = { kind: 'model' };
  selected?: Pick; // výběr v pohledu (režim modelu)
  hover?: Pick;
  selectedFeature?: Id; // výběr na časové ose
  marker: Id | null = null; // feature, za kterou se vkládá; null = konec osy
  private markerIndex = 0; // kde značka naposledy ležela, pro případ, že její feature zmizí
  readonly hidden = new Set<Id>();
  private showBasePlanes = true;
  pending?: Feature['type']; // a new feature of this type waits for its plane to be picked
  private readonly queries: QueryPanel = {}; // the query open in the model panel, with its answer
  private readonly mechanism: MechanismPanel = {}; // the form open in the panel of the mechanism, the pose a slider previews
  note: Note = { text: '', error: false };
  private readonly counters = new Map<string, number>();
  private cache?: EngineState;
  readonly drafting: DraftState = { cost: 0, confirming: false };
  readonly sketching: SketchState = { polygon: DEFAULT_POLYGON, fillet: DEFAULT_FILLET }; // remembered between sketches
  private contextCache?: SketchContext | null;
  private down?: { x: number; y: number; button: number };

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
    // tažení přerušené systémem (ztráta ukazatele) se zahodí; po běžném puštění už žádné neběží
    for (const type of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => this.cancelDrag() && this.refresh());
    window.addEventListener('keydown', (event) => this.onKey(event));
    this.say('Začněte skicou: tlačítko Skica a výběr roviny.');
    this.refresh();
    this.fit();
  }

  // ---------------------------------------------------------------- stav

  get doc() {
    return this.engine.getState().document;
  }
  feature(id: Id | undefined | null): Feature | undefined {
    return id == null ? undefined : this.doc.features.find((f) => f.id === id);
  }
  // Names for a human: see issue-text.ts.
  readonly featureNames = (id: Id): string | undefined => this.feature(id)?.name;
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

  // Stav, který se právě zobrazuje: model po značce pozice, po upravované feature, nebo náhled.
  // In the model mode a slider of the mechanism being dragged previews a pose (D49).
  view(): EngineState {
    if (this.cache) return this.cache;
    const m = this.mode;
    if (m.kind === 'sketch') this.cache = m.preview ?? this.engine.getState(m.id);
    else if (m.kind === 'model') this.cache = this.mechanism.preview ?? (this.marker ? this.engine.getState(this.marker) : this.engine.getState());
    else this.cache = m.preview ?? this.stateBefore(m.index);
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

  // ID nové entity: předpona a pořadové číslo, které se v dokumentu ještě nevyskytuje. Čítač se
  // během práce nevrací, takže se ID smazané entity znovu nepoužije. An ID a section of the
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

  // Propojení s MCP serverem: AI pak pracuje s dokumentem otevřeným v aplikaci.
  private bridge?: BridgeConnection;
  private bridgeStatus: BridgeStatus = 'off';
  private toggleBridge(): void {
    if (this.bridge) {
      this.bridge.stop();
      this.bridge = undefined;
      return this.say('Propojení s AI vypnuto.');
    }
    let restore: (() => void) | undefined;
    this.bridge = connectBridge(this.engine, {
      // what the operations of the app need of it (AppHost), with its engine
      host: { engine: this.engine, view: this.pictures },
      onStatus: (status) => {
        this.bridgeStatus = status;
        if (status === 'connected') this.say('Propojeno s MCP serverem: AI vidí a mění tento dokument.');
        else if (status === 'connecting') this.say('Čekám na MCP server (spouští ho klient AI)…');
        this.renderToolbar();
      },
      onDisplaced: () => {
        this.bridge = undefined;
        this.say('K AI se připojila jiná aplikace (jiné okno nebo záložka); tady je propojení vypnuté.', true);
      },
      // Změna od AI pod rozpracovanou operací (vysunutí, rovina) by jí vzala půdu, proto se
      // operace ruší ještě před změnou; jen když příkaz dokument opravdu změní. Načtení jiného
      // dokumentu vymění i stav UI, stejně jako Otevřít; při neúspěchu se stav vrátí.
      beforeCall: (name, args) => {
        if (!MUTATING.includes(name)) return;
        if (name === '_load') {
          restore = this.swapUi();
          return;
        }
        if (!isDraft(this.mode)) return;
        if (changesDocument(this.engine, name, args)) this.setMode({ kind: 'model' });
      },
      onCall: (name, outcome) => {
        // A picture is drawn off the screen: nothing shows that one was taken but this line. It
        // is a question, like the others the AI asks without a word here: one that is refused
        // says nothing (the AI has the reason), and one that is taken does not replace an error
        // the user has not dealt with.
        if (name === 'view_image') return outcome.ok && !this.note.error ? this.say('AI: a picture of the model was taken.') : undefined;
        if (!MUTATING.includes(name)) return;
        if (name === '_load') {
          if (!outcome.ok) restore?.();
          restore = undefined;
          this.refresh();
        }
        this.say(outcome.ok ? `AI: ${name === '_load' ? 'otevřen dokument' : name}` : `AI: ${name === '_load' ? 'otevření dokumentu' : name} selhalo: ${outcome.error}`, !outcome.ok);
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

  // Provede příkaz; neplatný příkaz dokument nezmění a zpráva se ukáže ve stavovém řádku.
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
    else if (this.note.error) this.say(''); // stará chyba po úspěšném příkazu už neplatí
    return true;
  }
  private failedChecks(state: EngineState): string[] {
    return state.document.checks.map((check) => check.name).filter((name) => state.evaluation.checks[name]?.status !== 'ok');
  }

  // ---------------------------------------------------------------- překreslení

  refresh(): void {
    this.cancelDrag(); // dokument se mohl změnit pod rozpracovaným tažením
    this.mechanism.preview = undefined; // a pose previewed by a slider ends with its drag
    this.invalidate();
    const m = this.mode;
    // Značka, jejíž feature zmizela (undo, smazání), spadne na feature před ní.
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
    // Výběr v pohledu platí jen pro to, co je právě vidět (jiný stav modelu, skrytí, undo).
    this.hover = undefined;
    if (this.selected && !this.stillThere(this.selected)) this.selected = undefined;
    this.renderToolbar();
    this.renderTimeline();
    this.renderPanel();
    this.renderScene();
    this.renderStatus();
  }

  // Zahodí rozpracované tažení bodu i jeho náhled. Vrací, zda nějaké běželo.
  private cancelDrag(): boolean {
    const m = this.mode;
    if (m.kind !== 'sketch' || !m.drag) return false;
    m.drag = undefined;
    m.preview = undefined;
    this.invalidate();
    return true;
  }

  // Je vybraná stěna, hrana nebo rovina v právě zobrazeném stavu modelu?
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
    this.selected = undefined; // výběr v pohledu patří jedné akci; nová skica ho nemá zdědit
    this.refresh();
  }

  // ---------------------------------------------------------------- lišta

  private renderToolbar(): void {
    const m = this.mode;
    const state = this.engine.getState();
    const button = (label: string, action: () => void, options: { title?: string; disabled?: boolean; active?: boolean } = {}) =>
      h('button', { textContent: label, onclick: action, title: options.title ?? '', disabled: options.disabled === true, className: options.active ? 'active' : '' });
    const group = (...items: HTMLElement[]) => h('div', { className: 'group' }, ...items);
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => void this.open(file) });
    // Rozpracované vysunutí nebo rovina v dokumentu ještě nejsou; undo pod nimi by jim vzalo půdu.
    const drafting = isDraft(m);

    const groups = [
      group(
        button('Nový', () => this.newDocument(), { title: 'Prázdný dokument' }),
        button('Otevřít', () => file.click()),
        button('Uložit', () => download('model.trymesh.json', this.engine.save(), 'application/json')),
        // the printed bodies into one file (D48); a reference or auxiliary body by the link of its line
        button('Export STL', () => download('model.stl', new Uint8Array(this.engine.exportMesh('stl')), 'model/stl'), { disabled: printedBodies(state.evaluation.bodyProperties).length === 0 }),
        file,
      ),
      group(
        button(this.bridgeStatus === 'connected' ? 'AI: připojeno' : this.bridgeStatus === 'connecting' ? 'AI: čeká…' : 'AI', () => this.toggleBridge(), {
          title: 'Propojit s MCP serverem (packages/mcp): AI pak čte a mění dokument otevřený v aplikaci',
          active: this.bridgeStatus !== 'off',
        }),
      ),
      group(
        button('↶ Zpět', () => this.engine.undo(), { disabled: !state.canUndo || drafting, title: 'Ctrl+Z' }),
        button('↷ Znovu', () => this.engine.redo(), { disabled: !state.canRedo || drafting, title: 'Ctrl+Shift+Z' }),
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
        group(...TOOLS.map(([tool, label, hint]) => button(label, () => setTool(this, tool), { title: hint, active: m.tool === tool }))),
        group(
          button('Konstrukčně', () => ((m.construction = !m.construction), this.say(m.construction ? 'Nové křivky budou konstrukční: pomáhají s vazbami, ale netvoří profil.' : 'Nové křivky budou běžné.'), this.refresh()), {
            title: 'Kreslicí nástroje zakládají konstrukční (pomocné) křivky',
            active: m.construction === true,
          }),
        ),
        group(h('button', { textContent: 'Dokončit skicu', className: 'primary', onclick: () => this.finishSketch() })),
      );
    }
    groups.push(
      group(
        button('Zobrazit vše', () => this.fit()),
        button('Save picture', () => void this.savePicture(), {
          title: 'Save a picture of the model as PNG: the bodies that are shown, from the camera of the view and cut as the view is; without the selection, sketches, planes and dimensions',
          disabled: Object.keys(this.view().evaluation.bodies).every((body) => this.bodyHidden(body)),
        }),
        button('Základní roviny', () => ((this.showBasePlanes = !this.showBasePlanes), this.refresh()), { active: this.showBasePlanes, title: 'Zobrazit nebo skrýt roviny XY, XZ, YZ' }),
      ),
    );
    byId('toolbar').replaceChildren(...groups);
  }

  private newDocument(): void {
    this.resetUi();
    this.engine.load(JSON.stringify(emptyDocument()));
    this.bridge?.documentReplaced();
    this.say('Nový dokument.');
  }

  private async open(input: HTMLInputElement): Promise<void> {
    const text = await input.files?.[0]?.text();
    if (text === undefined) return;
    // Stav UI se vymění před načtením (engine při něm rozešle nový stav) a při chybě se vrátí.
    const restore = this.swapUi();
    const result = this.engine.load(text);
    if (result.ok) {
      this.bridge?.documentReplaced();
      this.say('Dokument načten.');
      return this.fit();
    }
    restore();
    this.say(`Soubor nejde otevřít: ${result.error.message}`, true);
  }

  // Vrátí UI do výchozího stavu a dá funkci, která původní stav obnoví.
  private swapUi(): () => void {
    const saved = { mode: this.mode, marker: this.marker, hidden: [...this.hidden], pending: this.pending, selectedFeature: this.selectedFeature };
    this.resetUi();
    return () => {
      Object.assign(this, { mode: saved.mode, marker: saved.marker, pending: saved.pending, selectedFeature: saved.selectedFeature });
      for (const id of saved.hidden) this.hidden.add(id);
    };
  }

  private resetUi(): void {
    this.mode = { kind: 'model' };
    this.marker = null;
    this.pending = undefined;
    this.selectedFeature = undefined;
    this.selected = undefined;
    this.hidden.clear();
  }

  // ---------------------------------------------------------------- časová osa

  private renderTimeline(): void {
    const full = this.engine.getState();
    const markerIndex = this.insertIndex();
    const editing: Id | undefined = this.mode.kind === 'sketch' ? this.mode.id : isDraft(this.mode) ? this.mode.draft.id : undefined;
    const busy = this.mode.kind !== 'model';
    const rows: HTMLElement[] = [h('h2', {}, 'Časová osa')];
    const markerRow = () => h('div', { className: 'marker', title: 'Sem se vkládají nové prvky' }, 'zde se vkládá');

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
        icon('↑', 'Posunout dřív', () => this.run({ type: 'moveFeature', id: f.id, index: index - 1 }), index === 0),
        icon('↓', 'Posunout později', () => this.run({ type: 'moveFeature', id: f.id, index: index + 1 }), index === full.document.features.length - 1),
        icon('⇤', 'Vrátit model sem: další prvky se vloží za tento', () => {
          this.marker = index === full.document.features.length - 1 ? null : f.id;
          this.refresh();
        }),
      );
      rows.push(row);
      if (index + 1 === markerIndex && markerIndex < full.document.features.length) rows.push(markerRow());
    });
    if (full.document.features.length === 0) rows.push(h('p', { className: 'hint' }, 'Zatím prázdná. Nové prvky se objeví zde.'));
    else if (this.marker) rows.push(h('button', { className: 'link', textContent: 'Zobrazit celý model', disabled: busy, onclick: () => ((this.marker = null), this.refresh()) }));
    byId('timeline').replaceChildren(...rows);
  }

  edit(id: Id): void {
    const f = this.feature(id);
    if (!f) return;
    uiOf(f.type).edit(this, f);
  }

  // ---------------------------------------------------------------- pravý panel

  renderPanel(): void {
    const m = this.mode;
    const panel = byId('panel');
    if (m.kind === 'sketch') panel.replaceChildren(...sketchPanel(this, m));
    else if (isDraft(m)) panel.replaceChildren(...m.form.panel(m, this));
    else panel.replaceChildren(...modelPanel(this, this.queries, this.mechanism));
  }

  // The text of an issue for a human, with the bodies, features and copies it is about named.
  issueText(issue: Issue): string {
    return issueText(issue, this.featureNames, this.bodyNames, (id) => this.feature(id)?.type);
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
    if (pick.kind === 'plane') return pick.ref.kind === 'base' ? `Rovina ${pick.ref.plane}` : pick.ref.kind === 'plane' ? `Rovina „${this.nameOf(pick.ref.feature)}“` : 'Rovina';
    const face = (name: FaceName) => faceLabel(name, this.featureNames, (id) => this.feature(id)?.type);
    if (pick.kind === 'face') return `Stěna: ${face(pick.name)}${pick.planar ? '' : ' (není rovinná)'}`;
    const kinds: Record<EdgeKind, string> = { line: 'úsečka', circle: 'kružnice', coplanar: 'v ploše', other: 'obecná křivka' };
    return `Hrana (${kinds[pick.edgeKind]}): ${face(pick.name.a)} × ${face(pick.name.b)}`;
  }

  planeRefOf(pick: Pick | undefined): PlaneRef | undefined {
    if (pick?.kind === 'plane') return pick.ref;
    if (pick?.kind === 'face' && pick.planar) return { kind: 'face', body: pick.body, face: pick.name };
    return undefined;
  }

  // ---------------------------------------------------------------- výběr v pohledu

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

  // Roviny, které jsou vidět a dají se vybrat.
  planes(state: EngineState): Extract<Pick, { kind: 'plane' }>[] {
    const out: Extract<Pick, { kind: 'plane' }>[] = [];
    if (this.showBasePlanes) for (const plane of ['XY', 'XZ', 'YZ'] as const) out.push({ kind: 'plane', key: plane, ref: { kind: 'base', plane }, frame: BASE[plane] });
    for (const f of state.document.features) {
      const frame = state.evaluation.features[f.id]?.plane;
      const drafted = isDraft(this.mode) && this.mode.draft.id === f.id; // rovina nemůže být svým vlastním základem
      if (f.type === 'plane' && frame && !this.hidden.has(f.id) && !drafted) out.push({ kind: 'plane', key: f.id, ref: { kind: 'plane', feature: f.id }, frame });
    }
    return out;
  }

  // Co je pod kurzorem: hrana má přednost před stěnou, stěna před rovinou.
  pick(event: PointerEvent, want: { edges?: boolean; faces?: boolean; planes?: boolean }): Pick | undefined {
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
            // hrana schovaná za tělesem se nevybírá
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

  // Průsečík paprsku pod kurzorem s rovinou, v souřadnicích roviny.
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

  // ---------------------------------------------------------------- události pohledu

  private onDown(event: PointerEvent): void {
    // Alt/Option + tažení patří pohledu (otáčení bez myši), ne výběru ani kreslení.
    this.down = { x: event.clientX, y: event.clientY, button: event.altKey ? -1 : event.button };
    const m = this.mode;
    if (this.down.button !== 0 || m.kind !== 'sketch') return;
    if (sketchDown(this, m, event)) this.viewport.element.setPointerCapture(event.pointerId);
  }

  private onMove(event: PointerEvent): void {
    const m = this.mode;
    if (event.buttons !== 0 && !(m.kind === 'sketch' && m.drag)) return; // otáčení a posun pohledu
    if (m.kind === 'sketch') {
      const moved = sketchMove(this, m, event, this.down);
      // při tažení se panel nepřestavuje, jen stav určenosti
      if (moved === 'drag') updateSketchStatus(this, m);
      return moved ? this.renderScene() : undefined;
    }
    // a form that asks for no pick of the view gets the bare event
    const wanted = isDraft(m) ? m.form.picks?.(m) : undefined;
    if (isDraft(m) && !wanted) return m.form.hover?.(m, event, undefined, this) ? this.renderScene() : undefined;
    const hover = this.pick(event, isDraft(m) ? { ...wanted } : { edges: !this.pending, faces: true, planes: true });
    if (pickKey(hover) === pickKey(this.hover)) return;
    this.hover = hover;
    this.renderScene();
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
    if (m.kind === 'sketch') return sketchClick(this, m, event);
    // a form gets its clicks from the app: the bare event, or what it asked to be picked
    const wanted = isDraft(m) ? m.form.picks?.(m) : undefined;
    if (isDraft(m) && !wanted) return m.form.click?.(m, event, undefined, this);
    const pick = this.pick(event, isDraft(m) ? { ...wanted } : { edges: !this.pending, faces: true, planes: true });
    if (isDraft(m)) return m.form.click?.(m, event, pick, this);
    const ref = this.planeRefOf(pick);
    if (this.pending) {
      const what = this.pending;
      if (!ref) this.say('Vyberte rovinu nebo rovinnou stěnu.', true);
      else if (!this.usePlane(ref)) {
        this.pending = what; // engine výběr odmítl (zpráva je ve stavovém řádku); čeká se na jiný
        this.refresh();
      }
      return;
    }
    // an armed control of the open query or export takes the selection; the app then keeps none of its own
    if (!pick || !(takeSelection(this.queries, pick) || takeExportSelection(this.queries, pick))) this.selected = pick;
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
      if (drafting) this.say('Nejdřív potvrďte nebo zrušte rozpracovaný prvek.', true);
      else if (event.shiftKey) this.engine.redo();
      else this.engine.undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      if (!drafting) this.engine.redo();
    } else if (event.key === 'Escape') {
      if (this.cancelDrag()) this.refresh();
      else if (m.kind === 'sketch') {
        sketchEscape(m);
        this.refresh();
      } else if (m.kind === 'model') {
        this.pending = undefined;
        this.selected = undefined;
        this.refresh();
      } else this.setMode({ kind: 'model' });
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && m.kind === 'sketch') {
      event.preventDefault();
      deleteSelection(this, m);
    }
  }

  // ---------------------------------------------------------------- nová skica a rovina

  // The button of a feature type: a type that starts on a plane waits for one, the others start at once.
  private create(type: Feature['type']): void {
    const create = FEATURE_UI[type].create;
    if (create?.plane) this.startOnPlane(type);
    else create?.run(this, { index: this.insertIndex() });
  }

  private startOnPlane(what: Feature['type']): void {
    const selected = this.feature(this.selectedFeature);
    // rovina vybraná na časové ose se použije, jen když leží před místem vkládání
    const before = selected?.type === 'plane' && this.doc.features.indexOf(selected) < this.insertIndex();
    const ref = this.planeRefOf(this.selected) ?? (selected && before ? ({ kind: 'plane', feature: selected.id } as PlaneRef) : undefined);
    this.pending = what;
    if (ref && this.usePlane(ref)) return;
    // bez použitelného výběru (nebo když ho engine odmítl) se čeká na kliknutí v pohledu
    this.pending = what;
    if (!ref) this.say('Vyberte rovinu nebo rovinnou stěnu.');
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

  // ---------------------------------------------------------------- skica

  enterSketch(id: Id): void {
    this.selectedFeature = id;
    this.setMode(sketchMode(id));
    const frame = this.sketchContext()?.frame;
    if (frame) {
      this.viewport.lookAt(frame);
      this.fit();
    }
    this.say(TOOLS[0][2]);
  }

  private finishSketch(): void {
    this.setMode({ kind: 'model' });
    this.say('Skica dokončena.');
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

  // ---------------------------------------------------------------- scéna

  // The scene of the model, then what the open sketch or the open form adds to it.
  renderScene(): void {
    const m = this.mode;
    const model = modelScene(this, this.queries, m.kind === 'sketch' ? m : undefined);
    if (m.kind === 'sketch') sketchScene(this, m, model);
    if (isDraft(m)) m.form.overlay?.(m, model, this);
    this.viewport.setScene(model);
  }
}

// Ukázková aplikace nad enginem: časová osa, 3D pohled, skicář, panel vysunutí, roviny a pole (pattern).
// Drží jen stav UI (režim, výběr, značku pozice, viditelnost); vše ostatní čte z EngineState.
import {
  type Command,
  type CommandResult,
  type Constraint,
  type ConstraintExplanation,
  type EdgeKind,
  type Engine,
  type EngineState,
  type Expr,
  type FaceName,
  type Feature,
  type FeatureResult,
  type Frame,
  type Id,
  type Issue,
  type PlaneRef,
  type SketchDiagnosis,
  type SketchFeature,
  type SketchResult,
  type Solid,
  type Unit,
  type Vec2,
  type Vec3,
  CONSTRAINTS,
  MAX_POLYGON_SIDES,
  bodyOwner,
  constraintKey,
  constraintPath,
  duplicateOf,
  emptyDocument,
  faceKey,
  isDimension,
} from '@trymesh/engine';
import { type BridgeConnection, type BridgeStatus, MUTATING, changesDocument, connectBridge } from '@trymesh/mcp/bridge-client';
import { byId, download, fmt, h, markProblem } from './dom';
import { COLOR, loopSegments, planeSquare, pushPolyline, toWorld } from './draw';
import { type AnyDraft, type DraftState, updatePreview } from './features/draft';
import { FEATURE_UI, TOOLBAR, uiOf } from './features/index';
import type { Note, PanelHost, ViewPick } from './host';
import { type Collisions, checkCollisions, followCollisions, pickedPair, shownCollisions } from './panels/collisions';
import { modelPanel } from './panels/model';
import { expressionProblem, fieldText, parseField, valueText } from './fields';
import {
  type Anchor,
  type DimensionVariant,
  GEOMETRIC_KINDS,
  arcCommands,
  asConstruction,
  circleCommands,
  deleteCommands,
  dimensionFor,
  geometricFor,
  lineCommands,
  normalizeAngle,
  pointCommands,
  positionOf,
  rectangleCommands,
  DEFAULT_POLYGON,
  type PolygonOptions,
  polygonCommands,
  polygonSizeKind,
} from './sketch-commands';
import { duplicateTwins, explanationText, freeEntities, freeSummary, markOf } from './sketch-diagnosis';
import { type Shape, type SketchView, anchorOf, closestOn, hitCurve, hitPoint, kindOf, measure, operandsOf, polyline, sketchView } from './sketch-view';
import { type SceneModel, type View, Viewport } from './viewport';
import { bodyName, faceLabel, featureName, issueText } from './issue-text';

type Tool = 'select' | 'point' | 'line' | 'rect' | 'polygon' | 'circle' | 'arc' | 'project';

type Pick = ViewPick;

interface SketchMode {
  kind: 'sketch';
  id: Id;
  tool: Tool;
  clicks: Anchor[]; // dosud zadané body rozpracovaného tvaru
  cursor?: Anchor;
  infer?: 'horizontal' | 'vertical';
  selection: Id[];
  hover?: Id;
  hoverConstraint?: Id;
  focus?: Id; // vazba označená v seznamu: pohled ukáže ji a vazby, ze kterých plyne
  construction?: boolean; // kreslicí nástroje zakládají konstrukční křivky
  hoverEdge?: Pick;
  drag?: { point: Id; moved: boolean };
  preview?: EngineState; // stav při tažení bodu
  repair?: Id; // promítnutí, které další kliknutí nástrojem Promítnout opraví
}
type Mode = { kind: 'model' } | SketchMode | AnyDraft;
const isDraft = (m: Mode): m is AnyDraft => m.kind === 'draft';

interface SketchContext {
  feature: SketchFeature;
  result: SketchResult;
  frame: Frame;
  view: SketchView;
}

// Stejné soustavy základních rovin jako v enginu (ten je mimo výsledek přepočtu nevystavuje).
const BASE: Record<'XY' | 'XZ' | 'YZ', Frame> = {
  XY: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
};

// Jména vazeb jsou v katalogu enginu; nová vazba se tu objeví sama.
const constraintName = (type: Constraint['type']): string => CONSTRAINTS[type].title;
const TOOLS: [Tool, string, string][] = [
  ['select', 'Výběr', 'Klikněte na bod nebo křivku (Shift přidává). Bod lze táhnout.'],
  ['point', 'Bod', 'Klikněte na místo bodu.'],
  ['line', 'Úsečka', 'Klikejte na konce úseček; řetěz ukončí Esc nebo napojení na existující bod.'],
  ['rect', 'Obdélník', 'Klikněte na dva protilehlé rohy.'],
  ['polygon', 'Polygon', 'Click the centre and then a vertex; the number of sides is set in the panel.'],
  ['circle', 'Kružnice', 'Klikněte na střed a pak na bod obvodu.'],
  ['arc', 'Oblouk', 'Klikněte na střed, začátek a konec (proti směru hodin).'],
  ['project', 'Promítnout', 'Klikněte na hranu tělesa (úsečku nebo kružnici).'],
];
const PICK_REACH = 7; // px
const pickKey = (pick: Pick | undefined): string => (!pick ? '' : pick.kind === 'face' ? `f/${pick.body}/${pick.faceId}` : pick.kind === 'edge' ? `e/${pick.body}/${pick.index}` : `p/${pick.key}`);

export class App implements PanelHost {
  private readonly viewport: View;
  private mode: Mode = { kind: 'model' };
  selected?: Pick; // výběr v pohledu (režim modelu)
  private hover?: Pick;
  selectedFeature?: Id; // výběr na časové ose
  marker: Id | null = null; // feature, za kterou se vkládá; null = konec osy
  private markerIndex = 0; // kde značka naposledy ležela, pro případ, že její feature zmizí
  private readonly hidden = new Set<Id>();
  private showBasePlanes = true;
  pending?: Feature['type']; // a new feature of this type waits for its plane to be picked
  private readonly collisions: Collisions = {};
  note: Note = { text: '', error: false };
  private readonly counters = new Map<string, number>();
  private cache?: EngineState;
  readonly drafting: DraftState = { cost: 0, confirming: false };
  private polygon: PolygonOptions = DEFAULT_POLYGON; // what the polygon tool draws; remembered between sketches
  private contextCache?: SketchContext | null;
  private down?: { x: number; y: number; button: number };
  private readonly boxes = new WeakMap<Solid, { min: Vec3; max: Vec3 }>();

  // `view`: the view to draw into and to pick in; the real one by default (a test passes its own).
  constructor(readonly engine: Engine, view?: View) {
    this.viewport = view ?? new Viewport(byId('viewport'));
    engine.subscribe(() => {
      this.collisions.answer = undefined; // the answer belonged to the document as it was
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
  bodyName(body: Id): string {
    return bodyName(body, this.featureNames);
  }
  // A body is hidden at the feature that created it; the copies of a pattern all at once.
  private bodyHidden(body: Id): boolean {
    return this.hidden.has(bodyOwner(body).feature);
  }

  // Stav, který se právě zobrazuje: model po značce pozice, po upravované feature, nebo náhled.
  view(): EngineState {
    if (this.cache) return this.cache;
    const m = this.mode;
    if (m.kind === 'sketch') this.cache = m.preview ?? this.engine.getState(m.id);
    else if (m.kind === 'model') this.cache = this.marker ? this.engine.getState(this.marker) : this.engine.getState();
    else this.cache = m.preview ?? this.stateBefore(m.index);
    return this.cache;
  }
  stateBefore(index: number): EngineState {
    const previous = this.doc.features[index - 1];
    if (previous) return this.engine.getState(previous.id);
    const state = this.engine.getState();
    return { ...state, evaluation: { ...state.evaluation, features: {}, bodies: {}, faceNames: [], faceSurfaces: [] } };
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
  // během práce nevrací, takže se ID smazané entity znovu nepoužije.
  readonly newId = (prefix: string): Id => {
    const used = new Set<Id>();
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
      // what the operations of the app need of it (AppHost), with its engine; the compiler asks for a new member here
      host: { engine: this.engine },
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
    const bar = byId('status');
    bar.textContent = text;
    bar.classList.toggle('error', error);
  }

  // Provede příkaz; neplatný příkaz dokument nezmění a zpráva se ukáže ve stavovém řádku.
  run(command: Command, done?: string): boolean {
    const before = this.failedChecks(this.engine.getState());
    const result = this.engine.execute(command);
    if (!result.ok) return this.say(result.error.message, true), false;
    // a check the command made fail takes precedence over the ordinary message
    const failed = this.failedChecks(result.state).filter((name) => !before.includes(name));
    if (failed.length > 0) this.say(`Check failed: ${failed.join('; ')}`, true);
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
    this.invalidate();
    const m = this.mode;
    // Značka, jejíž feature zmizela (undo, smazání), spadne na feature před ní.
    const features = this.doc.features;
    const at = features.findIndex((f) => f.id === this.marker);
    if (this.marker && at < 0) this.marker = features[Math.min(this.markerIndex, features.length) - 1]?.id ?? null;
    if (this.marker && this.marker === features[features.length - 1]?.id) this.marker = null;
    this.markerIndex = features.findIndex((f) => f.id === this.marker);
    followCollisions(this.collisions, this);
    if (this.selectedFeature && !this.feature(this.selectedFeature)) this.selectedFeature = undefined;
    if (m.kind === 'sketch' && this.feature(m.id)?.type !== 'sketch') this.mode = { kind: 'model' };
    if (isDraft(m) && m.editing && !this.feature(m.draft.id)) this.mode = { kind: 'model' };
    if (isDraft(this.mode) && !this.drafting.confirming) updatePreview(this);
    if (this.mode.kind === 'sketch') {
      const context = this.sketchContext();
      const view = context?.view;
      this.mode.selection = this.mode.selection.filter((id) => view && kindOf(view, id));
      this.mode.clicks = this.mode.clicks.filter((a) => !a.snap || (view && kindOf(view, a.snap.id)));
      if (this.mode.repair && !context?.feature.external[this.mode.repair]) this.mode.repair = undefined;
      // místo pod kurzorem se po změně skici počítá znovu: přichycení mohlo vzniknout nebo zaniknout
      this.mode.cursor = undefined;
      this.mode.infer = undefined;
      this.mode.hover = undefined;
    }
    // Výběr v pohledu platí jen pro to, co je právě vidět (jiný stav modelu, skrytí, undo).
    this.hover = undefined;
    if (this.selected && !this.stillThere(this.selected)) this.selected = undefined;
    this.renderToolbar();
    this.renderTimeline();
    this.renderPanel();
    this.renderScene();
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
        button('Export STL', () => download('model.stl', new Uint8Array(this.engine.exportMesh('stl')), 'model/stl'), { disabled: Object.keys(state.evaluation.bodies).length === 0 }),
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
        group(button('Collisions', () => checkCollisions(this.collisions, this), { title: 'Check which bodies share a volume', disabled: Object.keys(this.view().evaluation.bodies).length < 2, active: shownCollisions(this.collisions, this) !== undefined })),
      );
    } else if (m.kind === 'sketch') {
      groups.push(
        group(...TOOLS.map(([tool, label, hint]) => button(label, () => this.setTool(tool), { title: hint, active: m.tool === tool }))),
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
    if (m.kind === 'sketch') panel.replaceChildren(...this.sketchPanel(m));
    else if (isDraft(m)) panel.replaceChildren(...m.form.panel(m, this));
    else panel.replaceChildren(...modelPanel(this, this.collisions));
  }

  // The text of an issue for a human, with the bodies, features and copies it is about named.
  issueText(issue: Issue): string {
    return issueText(issue, this.featureNames);
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
    const face = (name: FaceName) => faceLabel(name, this.featureNames);
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

  private modelSize(state: EngineState): { min: Vec3; max: Vec3 } {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    const grow = (p: ArrayLike<number>, offset = 0) => {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], p[offset + axis]);
        max[axis] = Math.max(max[axis], p[offset + axis]);
      }
    };
    for (const body of Object.values(state.evaluation.bodies)) {
      let box = this.boxes.get(body.solid);
      if (!box) {
        const [lo, hi]: [Vec3, Vec3] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
        for (let i = 0; i < body.solid.positions.length; i++) {
          lo[i % 3] = Math.min(lo[i % 3], body.solid.positions[i]);
          hi[i % 3] = Math.max(hi[i % 3], body.solid.positions[i]);
        }
        box = { min: lo, max: hi };
        this.boxes.set(body.solid, box);
      }
      grow(box.min);
      grow(box.max);
    }
    for (const f of state.document.features) {
      const result = state.evaluation.features[f.id];
      if (!result?.plane || !result.sketch) continue;
      for (const p of Object.values(result.sketch.points)) grow(toWorld(result.plane, p.x, p.y));
    }
    if (min[0] > max[0]) return { min: [-20, -20, -20], max: [20, 20, 20] };
    // prázdná skica nebo drobný model: pohled se nepřibližuje víc než na 40 mm
    const pad = (40 - Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])) / 2;
    if (pad > 0) return { min: [min[0] - pad, min[1] - pad, min[2] - pad], max: [max[0] + pad, max[1] + pad, max[2] + pad] };
    return { min, max };
  }

  planeSize(state: EngineState): number {
    const { min, max } = this.modelSize(state);
    return Math.max(20, 0.7 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
  }

  private fit(): void {
    const { min, max } = this.modelSize(this.view());
    this.viewport.fit(min, max);
  }

  // Roviny, které jsou vidět a dají se vybrat.
  private planes(state: EngineState): Extract<Pick, { kind: 'plane' }>[] {
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
  private pick(event: PointerEvent, want: { edges?: boolean; faces?: boolean; planes?: boolean }): Pick | undefined {
    const state = this.view();
    const hit = this.viewport.pickBody(event.clientX, event.clientY);
    if (want.edges) {
      const project = this.viewport.projector();
      const slack = 8 * this.viewport.pixelSize();
      let best: Pick | undefined;
      let bestDistance = PICK_REACH;
      for (const [body, data] of Object.entries(state.evaluation.bodies)) {
        if (this.bodyHidden(body)) continue;
        data.edges.forEach((edge, index) => {
          if (edge.kind === 'coplanar') return;
          const s = edge.segments;
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
    if (this.down.button !== 0 || m.kind !== 'sketch' || m.tool !== 'select') return;
    const context = this.sketchContext();
    const anchor = context && this.anchorAt(event, context);
    const id = anchor?.snap?.kind === 'point' ? anchor.snap.id : undefined;
    if (id && context?.view.points.get(id)?.own) {
      m.drag = { point: id, moved: false };
      this.viewport.element.setPointerCapture(event.pointerId);
    }
  }

  private onMove(event: PointerEvent): void {
    const m = this.mode;
    if (event.buttons !== 0 && !(m.kind === 'sketch' && m.drag)) return; // otáčení a posun pohledu
    if (m.kind === 'sketch') return this.sketchMove(event, m);
    // a form that asks for no pick of the view gets the bare event
    if (isDraft(m) && !m.form.picks) return m.form.hover?.(m, event, undefined, this) ? this.renderScene() : undefined;
    const hover = this.pick(event, isDraft(m) ? { ...m.form.picks } : { edges: !this.pending, faces: true, planes: true });
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
      if (drag.moved) {
        const p = this.sketchPlanePoint(event);
        m.preview = undefined;
        this.invalidate();
        if (!p || !this.run({ type: 'dragPoint', sketch: m.id, point: drag.point, x: p[0], y: p[1] })) this.refresh();
        return;
      }
    }
    if (!down || down.button !== 0 || event.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    if (m.kind === 'sketch') return this.sketchClick(event, m);
    // a form gets its clicks from the app: the bare event, or what it asked to be picked
    if (isDraft(m) && !m.form.picks) return m.form.click?.(m, event, undefined, this);
    const pick = this.pick(event, isDraft(m) ? { ...m.form.picks } : { edges: !this.pending, faces: true, planes: true });
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
    this.selected = pick;
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
        if (m.clicks.length > 0) m.clicks = [];
        else if (m.repair) m.repair = undefined;
        else if (m.tool !== 'select') m.tool = 'select';
        else if (m.selection.length > 0) m.selection = [];
        else m.focus = undefined;
        this.refresh();
      } else if (m.kind === 'model') {
        this.pending = undefined;
        this.selected = undefined;
        this.refresh();
      } else this.setMode({ kind: 'model' });
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && m.kind === 'sketch') {
      event.preventDefault();
      this.deleteSelection(m);
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
    this.setMode({ kind: 'sketch', id, tool: 'select', clicks: [], selection: [] });
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

  private setTool(tool: Tool): void {
    if (this.mode.kind !== 'sketch') return;
    Object.assign(this.mode, { tool, clicks: [], cursor: undefined, infer: undefined, hover: undefined, hoverEdge: undefined, repair: undefined });
    this.say(TOOLS.find(([name]) => name === tool)?.[2] ?? '');
    this.refresh();
  }

  private sketchContext(): SketchContext | undefined {
    if (this.contextCache !== undefined) return this.contextCache ?? undefined;
    this.contextCache = null;
    const m = this.mode;
    if (m.kind !== 'sketch') return undefined;
    const state = this.view();
    const feature = state.document.features.find((f) => f.id === m.id);
    const result = state.evaluation.features[m.id];
    if (feature?.type !== 'sketch' || !result?.sketch || !result.plane) return undefined;
    this.contextCache = { feature, result: result.sketch, frame: result.plane, view: sketchView(feature, result.sketch) };
    return this.contextCache;
  }

  private sketchPlanePoint(event: { clientX: number; clientY: number }): Vec2 | undefined {
    const frame = this.sketchContext()?.frame;
    return frame && this.planePoint(event, frame)?.at;
  }

  // Místo pod kurzorem ve skice a přichycení: bod má přednost před křivkou.
  private anchorAt(event: { clientX: number; clientY: number }, context: SketchContext): Anchor | undefined {
    const p = this.planePoint(event, context.frame)?.at;
    if (!p) return undefined;
    const reach = PICK_REACH * this.viewport.pixelSize();
    const point = hitPoint(context.view, p, reach);
    if (point) return { at: point.at, snap: { kind: 'point', id: point.id } };
    const curve = hitCurve(context.view, p, reach);
    if (curve) return { at: closestOn(curve.shape, p), snap: { kind: 'curve', id: curve.id } };
    return { at: p };
  }

  private sketchMove(event: PointerEvent, m: SketchMode): void {
    const context = this.sketchContext();
    if (!context) return;
    if (m.drag) {
      const p = this.planePoint(event, context.frame)?.at;
      const down = this.down;
      if (!p || !down) return;
      if (!m.drag.moved && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 4) return;
      m.drag.moved = true;
      // náhled počítá jen po upravovanou skicu a dokument nemění
      const result = this.engine.preview({ type: 'dragPoint', sketch: m.id, point: m.drag.point, x: p[0], y: p[1] }, m.id);
      if (!result.ok) return;
      m.preview = result.state;
      this.invalidate();
      this.updateSketchStatus();
      return this.renderScene();
    }
    if (m.tool === 'project') {
      const edge = this.pick(event, { edges: true });
      if (pickKey(edge) === pickKey(m.hoverEdge)) return;
      m.hoverEdge = edge;
      return this.renderScene();
    }
    const anchor = this.anchorAt(event, context);
    m.hover = m.tool === 'select' ? anchor?.snap?.id : undefined;
    m.infer = undefined;
    // odvozená vazba: volný konec úsečky skoro vodorovně nebo svisle od začátku
    if (anchor && !anchor.snap && m.tool === 'line' && m.clicks.length === 1) {
      const from = positionOf(context.view, m.clicks[0]);
      const reach = PICK_REACH * this.viewport.pixelSize();
      const [dx, dy] = [Math.abs(anchor.at[0] - from[0]), Math.abs(anchor.at[1] - from[1])];
      if (dy <= reach && dx > reach) [anchor.at, m.infer] = [[anchor.at[0], from[1]], 'horizontal'];
      else if (dx <= reach && dy > reach) [anchor.at, m.infer] = [[from[0], anchor.at[1]], 'vertical'];
    }
    m.cursor = anchor;
    this.renderScene();
  }

  private sketchClick(event: PointerEvent, m: SketchMode): void {
    const context = this.sketchContext();
    if (!context) return;
    if (m.tool === 'project') return this.projectEdge(event, m, context);
    // místo kliknutí včetně odvozené vazby spočítal poslední pohyb myši; bez něj se dopočítá
    const anchor = m.cursor && m.tool !== 'select' ? m.cursor : this.anchorAt(event, context);
    if (!anchor) return;
    const { view } = context;
    const batch = (commands: Command[] | undefined): boolean => commands !== undefined && commands.length > 0 && this.run({ type: 'batch', commands: m.construction ? asConstruction(commands) : commands });

    if (m.tool === 'select') {
      const id = anchor.snap?.id;
      if (!id) m.selection = event.shiftKey ? m.selection : [];
      else if (!event.shiftKey) m.selection = [id];
      else m.selection = m.selection.includes(id) ? m.selection.filter((other) => other !== id) : [...m.selection, id];
      this.renderPanel();
      return this.renderScene();
    }
    if (m.tool === 'point') {
      batch(pointCommands(m.id, view, anchor, this.newId));
      return;
    }
    const needed = m.tool === 'arc' ? 3 : 2;
    if (m.clicks.length + 1 < needed) {
      m.clicks = [...m.clicks, anchor];
      return this.renderScene();
    }
    const clicks = m.clicks;
    m.clicks = [];
    if (m.tool === 'line') {
      const line = lineCommands(m.id, view, clicks[0], anchor, this.newId, m.infer);
      // řetěz pokračuje z konce, dokud se nenapojí na existující bod
      if (line && batch(line.commands) && anchor.snap?.kind !== 'point' && this.mode === m) m.clicks = [{ at: anchor.at, snap: { kind: 'point', id: line.end } }];
    } else if (m.tool === 'rect') batch(rectangleCommands(m.id, view, clicks[0], anchor, this.newId));
    else if (m.tool === 'polygon') batch(polygonCommands(m.id, view, clicks[0], anchor, this.polygon, this.newId));
    else if (m.tool === 'circle') batch(circleCommands(m.id, view, clicks[0], anchor, this.newId));
    else batch(arcCommands(m.id, view, clicks[0], clicks[1], anchor, this.newId));
    m.infer = undefined;
    this.renderScene();
  }

  // Promítne hranu tělesa; je-li vybrané jedno promítnutí, opraví ho (ID zůstane, vazby drží).
  private projectEdge(event: PointerEvent, m: SketchMode, context: SketchContext): void {
    const edge = this.pick(event, { edges: true });
    if (edge?.kind !== 'edge') return;
    if (edge.edgeKind !== 'line' && edge.edgeKind !== 'circle') return this.say('Promítnout jde jen hrana, která je úsečka nebo kružnice.', true);
    const ref = { type: 'edge' as const, body: edge.body, edge: edge.name, kind: edge.edgeKind };
    const repaired = m.repair ?? (m.selection.length === 1 && context.feature.external[m.selection[0]] ? m.selection[0] : undefined);
    if (repaired) {
      if (this.run({ type: 'updateExternal', sketch: m.id, id: repaired, ref }, 'Promítnutí opraveno.')) m.repair = undefined;
    } else this.run({ type: 'addExternal', sketch: m.id, id: this.newId('x'), ref }, 'Hrana promítnuta.');
  }

  private addConstraints(m: SketchMode, constraints: Constraint[] | undefined): void {
    if (!constraints) return;
    // Vazbu, kterou skica už má, engine odmítne; ze sady se přidá jen to, co chybí.
    const feature = this.sketchContext()?.feature;
    const fresh = feature ? constraints.filter((c) => duplicateOf(feature, c) === undefined) : constraints;
    if (fresh.length === 0) return this.say(constraints.some(isDimension) ? 'Tuhle kótu už skica má; její hodnotu upravíte v seznamu vazeb.' : 'Tuhle vazbu už skica má.', true);
    constraints = fresh;
    const commands = (list: Constraint[]): Command => ({ type: 'batch', commands: list.map((constraint): Command => ({ type: 'addConstraint', sketch: m.id, id: this.newId('k'), constraint })) });
    const result: CommandResult = this.engine.execute(commands(constraints));
    if (result.ok) return this.say('Vazba přidána.');
    // kótu jen mezi pevnými entitami engine odmítne jako řídicí; nabídne se jako referenční
    const reference = constraints.map((c) => (isDimension(c) ? { ...c, driving: false } : c));
    // stejná referenční kóta už ve skice je: engine duplicity hlídá jen u řídicích vazeb
    const keys = new Set(Object.values(feature?.constraints ?? {}).map(constraintKey));
    if (reference.every((c) => isDimension(c) && keys.has(constraintKey(c)))) return this.say('Tuhle kótu už skica má.', true);
    if (constraints.some(isDimension) && this.engine.execute(commands(reference)).ok) return this.say('Kóta je mezi pevnými entitami, proto je jen referenční.');
    this.say(result.error.message, true);
  }

  // The options of the polygon tool, shown while the tool is active: the number of sides and
  // whether the drawn size gets a dimension (rounded to 0.01 mm, like a dimension added by hand).
  private polygonOptions(): HTMLElement[] {
    const set = (change: Partial<PolygonOptions>) => {
      this.polygon = { ...this.polygon, ...change };
      this.renderPanel();
      this.renderScene();
    };
    const sides = h('input', {
      type: 'number',
      min: '3',
      max: String(MAX_POLYGON_SIDES),
      step: '1',
      value: String(this.polygon.sides),
      onchange: () => {
        const count = Number(sides.value);
        // a number outside the range of the tool leaves the count as it was
        set(Number.isInteger(count) && count >= 3 && count <= MAX_POLYGON_SIDES ? { sides: count } : {});
      },
    });
    const kind = polygonSizeKind(this.polygon);
    const option = (value: PolygonOptions['sizeKind'], label: string, disabled = false) => h('option', { value, textContent: label, selected: kind === value, disabled });
    const size = h(
      'select',
      { onchange: () => set({ sizeKind: size.value as PolygonOptions['sizeKind'] }) },
      option('none', 'No dimension'),
      option('circumscribed', 'Diameter of the circumscribed circle'),
      option('acrossFlats', 'Size across flats (even number of sides)', this.polygon.sides % 2 === 1),
    );
    return [
      h('h2', {}, 'Polygon'),
      h('label', {}, `Sides (3 to ${MAX_POLYGON_SIDES})`, sides),
      h('label', {}, 'Dimension of the size', size),
      h('p', { className: 'hint' }, 'Click the centre, then a vertex. The polygon is a construction circle with the vertices on it and sides of the same length; a dimension takes the size as drawn and is edited in the list of constraints. Draw it turned as it should be: a constraint on a side then holds it, but one that has to turn it far can leave it folded.'),
    ];
  }

  // Smaže vybrané entity; s křivkou zmizí i její body, které už nic dalšího nepoužívá.
  private deleteSelection(m: SketchMode): void {
    const context = this.sketchContext();
    if (!context || m.selection.length === 0) return;
    const commands = deleteCommands(m.id, context.feature, context.view, m.selection);
    if (commands.length === 0) return this.say('Počátek a body promítnuté geometrie smazat nejdou; promítnutí se maže výběrem jeho křivky.', true);
    m.selection = [];
    this.run({ type: 'batch', commands }, 'Smazáno.');
  }

  private sketchStatus(m: SketchMode): HTMLElement[] {
    const context = this.sketchContext();
    const result = this.view().evaluation.features[m.id];
    if (!context) return [h('p', { className: 'issue error' }, result?.status === 'suppressed' ? 'Skica je potlačená.' : 'Skicu nelze zobrazit: její rovina není k dispozici.'), ...this.issues(result)];
    const r = context.result;
    const unsolved = result?.warnings.some((w) => w.code === 'sketchConflict') === true; // stupně volnosti pak nic neříkají
    const empty = Object.keys(context.feature.points).length + Object.keys(context.feature.curves).length === 0;
    const state =
      r.conflicting.length > 0
        ? ['Vazby jsou v konfliktu', 'error']
        : unsolved
          ? ['Skicu se nepodařilo vyřešit', 'error']
          : empty
            ? ['Prázdná skica', 'open']
            : r.degreesOfFreedom === 0
              ? ['Plně určená', 'ok']
              : [`Stupně volnosti: ${r.degreesOfFreedom}`, 'open'];
    return [
      h('p', { className: `badge ${state[1]}` }, state[0]),
      r.valid ? h('p', { className: 'hint' }, `Uzavřených oblastí: ${r.regions.length}`) : h('p', { className: 'issue error' }, 'Profil je neplatný: křivky se kříží nebo dotýkají mimo spojené body, nebo jsou si blíž, než rozliší dělení oblouků.'),
      ...this.issues(result).filter((element) => !element.classList.contains('error') || r.valid),
    ];
  }

  // Při tažení se panel nepřestavuje, jen stav určenosti.
  private updateSketchStatus(): void {
    if (this.mode.kind !== 'sketch') return;
    document.getElementById('sketch-status')?.replaceChildren(...this.sketchStatus(this.mode));
  }

  // Vysvětlení označené vazby. Pamatuje se podle diagnostiky, aby se při každém překreslení
  // pohledu nepočítalo znovu.
  private explained?: { diagnosis: SketchDiagnosis; id: Id; value: ConstraintExplanation };
  private explain(sketch: Id, id: Id, diagnosis: SketchDiagnosis): ConstraintExplanation {
    if (this.explained?.diagnosis !== diagnosis || this.explained.id !== id) this.explained = { diagnosis, id, value: this.engine.explainConstraint(sketch, id) };
    return this.explained.value;
  }

  // Souhrn diagnostiky pod stavem skici: vazby navíc a co se ještě může hýbat.
  private diagnosisSummary(m: SketchMode, d: SketchDiagnosis): HTMLElement[] {
    const out: HTMLElement[] = [];
    const twins = duplicateTwins(d);
    const removeTwins = (): HTMLElement => {
      const commands = twins.map((id): Command => ({ type: 'removeConstraint', sketch: m.id, id }));
      return h('div', { className: 'buttons' }, h('button', { textContent: `Smazat duplicity (${twins.length})`, onclick: () => this.run({ type: 'batch', commands }, twins.length === 1 ? 'Duplicitní vazba smazána.' : 'Duplicitní vazby smazány.') }));
    };
    if (d.status !== 'solved') {
      // duplicity engine hlásí i u nevyřešené skici; jejich smazání může konflikt odstranit
      if (twins.length > 0) out.push(h('p', { className: 'issue warning' }, `Duplicitní vazby: ${twins.length}. V seznamu jsou označené.`), removeTwins());
      return out;
    }
    if (d.removable.length > 0) {
      out.push(
        h('p', { className: 'issue warning' }, `Vazby navíc: ${d.removable.length}${twins.length > 0 ? `, z toho duplicity: ${twins.length}` : ''}. V seznamu jsou označené; kliknutím na vazbu se ukáže, z čeho plyne.`),
      );
      if (twins.length > 0) out.push(removeTwins());
    }
    const free = freeSummary(d);
    if (free !== undefined) {
      const select = d.free.map((entity) => entity.id);
      out.push(
        h('p', { className: 'hint' }, free),
        h('div', { className: 'buttons' }, h('button', { textContent: 'Vybrat volné', title: 'Vybere volné body a kružnice s volným poloměrem', onclick: () => ((m.selection = select), this.refresh()) })),
      );
    }
    return out;
  }

  private sketchPanel(m: SketchMode): HTMLElement[] {
    const context = this.sketchContext();
    const out: HTMLElement[] = [h('h2', {}, `Skica: ${this.nameOf(m.id)}`), h('div', { id: 'sketch-status' }, ...this.sketchStatus(m))];
    if (!context) return out;
    const { feature, view, result } = context;
    const action = (label: string, enabled: boolean, run: () => void, title = '') => h('button', { textContent: label, disabled: !enabled, title, onclick: run });
    const diagnosis = this.engine.diagnoseSketch(m.id);
    if (m.focus && !feature.constraints[m.focus]) m.focus = undefined;
    const explanation = m.focus ? this.explain(m.id, m.focus, diagnosis) : undefined;
    const label = (id: Id): string => (feature.constraints[id] ? `${constraintName(feature.constraints[id].type)} (${operandsOf(feature.constraints[id]).join(', ')})` : id);
    const parameterNames = this.doc.parameters.map((p) => p.name);
    out.push(...this.issues(this.view().evaluation.features[m.id]).filter((element) => element.textContent?.startsWith('Field ')));
    out.push(...this.diagnosisSummary(m, diagnosis));
    if (m.tool === 'polygon') out.push(...this.polygonOptions());

    const dimension = (label: string, variant: DimensionVariant, title: string) => {
      const d = dimensionFor(variant, view, m.selection);
      return action(label, d !== undefined, () => this.addConstraints(m, d && [d]), title);
    };
    const ownCurves = m.selection.filter((id) => feature.curves[id]);
    const construction = ownCurves.length > 0 && ownCurves.every((id) => feature.curves[id].construction);
    out.push(
      h('h2', {}, `Výběr (${m.selection.length})`),
      h(
        'div',
        { className: 'buttons' },
        // tlačítko pro každou geometrickou vazbu z katalogu enginu; nápověda je její popis
        ...GEOMETRIC_KINDS.map((kind) => {
          const constraints = geometricFor(kind, view, m.selection);
          return action(constraintName(kind), constraints !== undefined, () => this.addConstraints(m, constraints), CONSTRAINTS[kind].summary);
        }),
      ),
      h(
        'div',
        { className: 'buttons' },
        dimension('Kóta', 'auto', 'Dva body nebo úsečka: vzdálenost; bod a úsečka: vzdálenost; dvě úsečky: úhel; kružnice: průměr; oblouk: poloměr'),
        dimension('Kóta ↔', 'horizontal', 'Vodorovná vzdálenost dvou bodů nebo konců úsečky'),
        dimension('Kóta ↕', 'vertical', 'Svislá vzdálenost dvou bodů nebo konců úsečky'),
      ),
      h(
        'div',
        { className: 'buttons' },
        action(construction ? 'Běžná křivka' : 'Konstrukční', ownCurves.length > 0, () =>
          this.run({ type: 'batch', commands: ownCurves.map((id): Command => ({ type: 'setConstruction', sketch: m.id, id, construction: !construction })) }),
        ),
        action('Smazat', m.selection.length > 0, () => this.deleteSelection(m), 'Delete'),
      ),
    );

    // vazby, které solver nedostal, protože odkazují na geometrii, kterou nešlo promítnout
    const skipped = new Set((this.view().evaluation.features[m.id]?.warnings ?? []).flatMap((w) => (w.code !== 'sketchConflict' && Array.isArray(w.refs) ? w.refs.slice(1) : [])));
    const rows = Object.entries(feature.constraints).flatMap(([id, c]) => {
      const mark = markOf(diagnosis, id);
      const tone = result.conflicting.includes(id) ? 'conflict' : mark ? 'redundant' : '';
      const row = h('div', {
        className: `constraint clickable ${tone} ${m.focus === id ? 'focus' : ''} ${explanation?.impliedBy.includes(id) ? 'implies' : ''}`,
        title:
          tone === 'conflict'
            ? 'V konfliktu s jinou vazbou'
            : mark === 'duplicate'
              ? 'Duplicita: stejnou vazbu už skica má'
              : mark === 'surplus'
                ? 'Navíc: plyne z ostatních vazeb. Kliknutím se ukáže, ze kterých.'
                : 'Kliknutím se ukáže, jestli vazba plyne z jiných',
        onmouseenter: () => ((m.hoverConstraint = id), this.renderScene()),
        onmouseleave: () => ((m.hoverConstraint = undefined), this.renderScene()),
        // klik na řádek (ne na jeho pole a tlačítka) vazbu označí nebo označení zruší
        onclick: (event: Event) => {
          if ((event.target as HTMLElement).closest('input, button, label')) return;
          m.focus = m.focus === id ? undefined : id;
          this.renderPanel();
          this.renderScene();
        },
      });
      const tag = mark === 'duplicate' ? ' · duplicita' : mark === 'surplus' ? ' · navíc' : '';
      row.append(h('span', { className: 'name' }, `${constraintName(c.type)} `, h('small', {}, `${operandsOf(c).join(', ')}${tag}`)));
      if (isDimension(c)) {
        const unit: Unit = CONSTRAINTS[c.type].values?.value.unit ?? 'mm';
        const shown = c.driving ? c.value : (result.measurements[id] ?? measure(c, view) ?? c.value);
        const expression: Expr | undefined = c.driving ? feature.expressions?.[constraintPath(id)] : undefined;
        const input = h('input', {
          className: 'value',
          value: fieldText(expression ?? shown, unit),
          disabled: !c.driving,
          title: expression ? `= ${valueText(shown, unit)}` : unit === 'rad' ? 'degrees, or an expression in radians (deg(30))' : 'mm, or an expression',
          oninput: () => {
            const parsed = parseField(input.value, unit);
            markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', parameterNames) : undefined);
          },
          onchange: () => {
            // an empty field does not change the value; an angle number is wrapped into the range the engine accepts
            const parsed = parseField(input.value, unit);
            const value = typeof parsed === 'number' && c.type === 'angle' ? normalizeAngle(parsed) : parsed;
            if (value === undefined || !this.run({ type: 'setConstraintValue', sketch: m.id, id, value }, 'Hodnota kóty změněna.')) this.refresh();
          },
        });
        row.append(
          input,
          h(
            'label',
            { className: 'check', title: 'Řídicí kóta geometrii určuje, referenční ji jen měří' },
            h('input', {
              type: 'checkbox',
              checked: c.driving,
              // referenční kóta se při přepnutí stane řídicí s právě naměřenou hodnotou
              onchange: () => !this.run({ type: 'setConstraintValue', sketch: m.id, id, driving: !c.driving, ...(c.driving ? {} : { value: shown }) }) && this.refresh(),
            }),
            'řídicí',
          ),
        );
      } else {
        // Named values of a constraint that is not a dimension (the coordinates of a fixed point):
        // numeric fields of the sketch, changed one at a time by setField.
        for (const [name, spec] of Object.entries(CONSTRAINTS[c.type].values ?? {})) {
          const path = constraintPath(id, name);
          const current = (c as unknown as Record<string, number>)[name];
          const expression: Expr | undefined = feature.expressions?.[path];
          const input = h('input', {
            className: 'value',
            value: fieldText(expression ?? current, spec.unit),
            title: expression ? `= ${valueText(current, spec.unit)}` : `${spec.unit === 'rad' ? 'degrees, or an expression in radians (deg(30))' : `${spec.unit}, or an expression`}`,
            oninput: () => {
              const parsed = parseField(input.value, spec.unit);
              markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', parameterNames) : undefined);
            },
            onchange: () => {
              // an empty field does not change the value
              const value = parseField(input.value, spec.unit);
              if (value === undefined || !this.run({ type: 'setField', feature: m.id, path, value }, `${constraintName(c.type)}: ${spec.title} changed.`)) this.refresh();
            },
          });
          row.append(h('label', { className: 'named' }, spec.title, input));
        }
      }
      row.append(h('button', { className: 'icon', textContent: '✕', title: 'Smazat vazbu', onclick: () => this.run({ type: 'removeConstraint', sketch: m.id, id }) }));
      // Vysvětlení je hned pod označeným řádkem: řádky nad ním se nehnou a druhé kliknutí
      // na stejném místě označení zruší.
      return m.focus === id && explanation ? [row, h('p', { className: 'explain' }, explanationText(c, id, explanation, diagnosis, label, skipped.has(id)))] : [row];
    });
    out.push(h('h2', {}, `Vazby a kóty (${Object.keys(feature.constraints).length})`));
    out.push(...(rows.length > 0 ? rows : [h('p', { className: 'hint' }, 'Vyberte entity a přidejte vazbu tlačítky výše.')]));

    // Promítnutá geometrie: i ta, kterou přepočet nedokázal promítnout a v pohledu proto není vidět.
    const warnings = this.view().evaluation.features[m.id]?.warnings ?? [];
    const projections = Object.entries(feature.external).map(([id, ref]) => {
      const problem = warnings.find((w) => w.code !== 'sketchConflict' && Array.isArray(w.refs) && w.refs[0] === id);
      return h(
        'div',
        {
          className: `constraint ${problem ? 'conflict' : ''} ${m.repair === id ? 'repair' : ''}`,
          title: problem?.message ?? '',
          onmouseenter: () => ((m.hover = id), this.renderScene()),
          onmouseleave: () => ((m.hover = undefined), this.renderScene()),
        },
        h('span', { className: 'name' }, `${ref.kind === 'line' ? 'Úsečka' : 'Kružnice'} `, h('small', {}, `${id} · ${this.bodyName(ref.body)}${view.curves.has(id) ? '' : ' · bez geometrie'}`)),
        h('button', {
          className: 'icon',
          textContent: '↻',
          title: 'Promítnout znovu: klikněte potom na novou hranu tělesa',
          onclick: () => {
            this.setTool('project');
            m.repair = id;
            this.say('Klikněte na hranu, která má promítnutí nahradit (Esc ruší).');
            this.renderPanel();
          },
        }),
        h('button', { className: 'icon', textContent: '✕', title: 'Zrušit promítnutí', onclick: () => this.run({ type: 'removeExternal', sketch: m.id, id }, 'Promítnutí zrušeno.') }),
      );
    });
    if (projections.length > 0) out.push(h('h2', {}, `Promítnutá geometrie (${projections.length})`), ...projections);
    return out;
  }

  // ---------------------------------------------------------------- scéna

  renderScene(): void {
    const state = this.view();
    const { evaluation, document: doc } = state;
    const m = this.mode;
    const model: SceneModel = { bodies: [], lines: [], points: [], fills: [], faces: [], labels: [] };
    const highlighted = this.feature(this.selectedFeature);

    // tělesa a jejich obrysy
    const outline: number[] = [];
    for (const [id, body] of Object.entries(evaluation.bodies)) {
      if (this.bodyHidden(id)) continue;
      model.bodies.push({ id, solid: body.solid });
      for (const edge of body.edges) if (edge.kind !== 'coplanar') for (let i = 0; i < edge.segments.length; i++) outline.push(edge.segments[i]);
      // the faces of the selected extrusion, or of the copies the selected pattern made
      const owns = highlighted && m.kind === 'model' ? uiOf(highlighted.type).ownsFace : undefined;
      if (highlighted && owns) for (const face of body.faces) if (owns(highlighted, evaluation.faceNames[face.id])) model.faces.push({ solid: body.solid, faceId: face.id, color: COLOR.select, opacity: 0.3 });
    }
    model.lines.push({ segments: outline, color: COLOR.edge, width: 1.5 });
    // the two bodies of the picked collision
    const clash = m.kind === 'model' ? pickedPair(this.collisions, this) : undefined;
    for (const [id, color] of clash ? ([[clash.a, COLOR.select], [clash.b, COLOR.clash]] as [Id, number][]) : []) {
      const body = evaluation.bodies[id];
      if (body && !this.bodyHidden(id)) for (const face of body.faces) model.faces.push({ solid: body.solid, faceId: face.id, color, opacity: 0.45 });
    }

    // roviny
    const square = planeSquare(this.planeSize(state));
    for (const plane of this.planes(state)) {
      const active = pickKey(plane) === pickKey(this.selected) || (plane.ref.kind === 'plane' && plane.ref.feature === this.selectedFeature);
      const hovered = pickKey(plane) === pickKey(this.hover);
      model.fills.push({ frame: plane.frame, loops: [square], color: active ? COLOR.select : hovered ? COLOR.hover : COLOR.plane, opacity: active || hovered ? 0.25 : 0.08 });
      model.lines.push({ segments: loopSegments(plane.frame, square), color: active ? COLOR.select : hovered ? COLOR.hover : COLOR.plane, width: 1 });
    }

    // skici mimo tu, která se právě upravuje
    for (const f of doc.features) {
      const result = evaluation.features[f.id];
      if (f.type !== 'sketch' || this.hidden.has(f.id) || !result?.sketch || !result.plane || (m.kind === 'sketch' && m.id === f.id)) continue;
      const frame = result.plane;
      const [solid, dashed]: number[][] = [[], []];
      for (const curve of sketchView(f, result.sketch).curves.values()) if (curve.own) pushPolyline(curve.construction ? dashed : solid, frame, polyline(curve.shape));
      const color = f.id === this.selectedFeature ? COLOR.select : COLOR.idle;
      model.lines.push({ segments: solid, color, width: f.id === this.selectedFeature ? 2.5 : 1.5 }, { segments: dashed, color, width: 1, dashed: true });
    }

    // výběr a zvýraznění v modelu
    for (const [pick, color, opacity] of [[this.hover, COLOR.hover, 0.3], [m.kind === 'sketch' ? m.hoverEdge : undefined, COLOR.hover, 0.3], [this.selected, COLOR.select, 0.5]] as [Pick | undefined, number, number][]) {
      const body = pick && pick.kind !== 'plane' ? evaluation.bodies[pick.body] : undefined;
      if (!pick || !body) continue;
      if (pick.kind === 'face') model.faces.push({ solid: body.solid, faceId: pick.faceId, color, opacity });
      else if (pick.kind === 'edge' && body.edges[pick.index]) model.lines.push({ segments: body.edges[pick.index].segments, color, width: 4, onTop: true });
    }

    if (m.kind === 'sketch') this.sketchScene(model, m);
    if (isDraft(m)) m.form.overlay?.(m, model, this);
    this.viewport.setScene(model);
  }

  private sketchScene(model: SceneModel, m: SketchMode): void {
    const context = this.sketchContext();
    if (!context) return;
    const { feature, view, result, frame } = context;
    const selected = new Set(m.selection);
    const hovered = new Set(m.hoverConstraint && feature.constraints[m.hoverConstraint] ? operandsOf(feature.constraints[m.hoverConstraint]) : m.hover ? [m.hover] : []);
    // Diagnostika: volné entity modře, určené tmavě; označená vazba a vazby, ze kterých plyne.
    const diagnosis = this.engine.diagnoseSketch(m.id);
    const free = freeEntities(diagnosis, view);
    const focus = m.focus && feature.constraints[m.focus] ? m.focus : undefined;
    const focused = new Set(focus ? operandsOf(feature.constraints[focus]) : []);
    const implying = new Set(focus ? this.explain(m.id, focus, diagnosis).impliedBy.flatMap((id) => operandsOf(feature.constraints[id])) : []);

    if (result.valid) for (const region of result.regions) model.fills.push({ frame, loops: region.loops, color: COLOR.region, opacity: 0.1 });

    // `unknown`: skica není vyřešená a o volnosti se nedá nic říct
    const lines: Record<'own' | 'determined' | 'unknown' | 'construction' | 'external' | 'selected' | 'hover' | 'focus' | 'implying', number[]> = { own: [], determined: [], unknown: [], construction: [], external: [], selected: [], hover: [], focus: [], implying: [] };
    for (const curve of view.curves.values()) {
      const bucket = selected.has(curve.id)
        ? 'selected'
        : hovered.has(curve.id)
          ? 'hover'
          : focused.has(curve.id)
            ? 'focus'
            : implying.has(curve.id)
              ? 'implying'
              : !curve.own
                ? 'external'
                : curve.construction
                  ? 'construction'
                  : !free
                    ? 'unknown'
                    : free.curves.has(curve.id)
                      ? 'own'
                      : 'determined';
      pushPolyline(lines[bucket], frame, polyline(curve.shape));
    }
    model.lines.push(
      { segments: lines.determined, color: COLOR.determined, width: 2, onTop: true },
      { segments: lines.own, color: COLOR.sketch, width: 2, onTop: true },
      { segments: lines.unknown, color: COLOR.idle, width: 2, onTop: true },
      { segments: lines.construction, color: COLOR.construction, width: 1.5, dashed: true, onTop: true },
      { segments: lines.external, color: COLOR.external, width: 2, onTop: true },
      { segments: lines.implying, color: COLOR.implied, width: 3, onTop: true },
      { segments: lines.focus, color: COLOR.hover, width: 4, onTop: true },
      { segments: lines.hover, color: COLOR.hover, width: 3, onTop: true },
      { segments: lines.selected, color: COLOR.select, width: 3, onTop: true },
    );

    const points: Record<'own' | 'determined' | 'unknown' | 'fixed' | 'selected' | 'hover' | 'focus' | 'implying', number[]> = { own: [], determined: [], unknown: [], fixed: [], selected: [], hover: [], focus: [], implying: [] };
    for (const point of view.points.values()) {
      const bucket = selected.has(point.id)
        ? 'selected'
        : hovered.has(point.id)
          ? 'hover'
          : focused.has(point.id)
            ? 'focus'
            : implying.has(point.id)
              ? 'implying'
              : !point.own
                ? 'fixed'
                : !free
                  ? 'unknown'
                  : free.points.has(point.id)
                    ? 'own'
                    : 'determined';
      points[bucket].push(...toWorld(frame, point.at[0], point.at[1]));
    }
    model.points.push(
      { positions: points.determined, color: COLOR.determined, size: 7 },
      { positions: points.unknown, color: COLOR.idle, size: 7 },
      { positions: points.own, color: COLOR.sketch, size: 7 },
      { positions: points.fixed, color: COLOR.external, size: 7 },
      { positions: points.implying, color: COLOR.implied, size: 10 },
      { positions: points.focus, color: COLOR.hover, size: 11 },
      { positions: points.hover, color: COLOR.hover, size: 10 },
      { positions: points.selected, color: COLOR.select, size: 10 },
    );

    // kóty jako popisky u svých operandů
    for (const [id, c] of Object.entries(feature.constraints)) {
      if (!isDimension(c)) continue;
      const at = anchorOf(c, view);
      if (!at) continue;
      const value = c.driving ? c.value : (result.measurements[id] ?? c.value);
      const text = c.type === 'angle' ? `${fmt((value * 180) / Math.PI)}°` : `${c.type === 'radius' ? 'R' : c.type === 'diameter' ? '⌀' : ''}${fmt(value)}`;
      model.labels.push({ at: toWorld(frame, at[0], at[1]), text: c.driving ? text : `(${text})`, tone: result.conflicting.includes(id) ? 'problem' : c.driving ? 'driving' : 'reference' });
    }

    // rozpracovaný tvar
    const cursor = m.cursor;
    if (cursor && m.tool !== 'select' && m.tool !== 'project') {
      const rubber: number[] = [];
      const at = cursor.at;
      const first = m.clicks[0] && positionOf(view, m.clicks[0]);
      const shape = (s: Shape) => pushPolyline(rubber, frame, polyline(s));
      if (first && m.tool === 'line') shape({ type: 'line', a: first, b: at });
      if (first && m.tool === 'rect') pushPolyline(rubber, frame, [first, [at[0], first[1]], at, [first[0], at[1]], first]);
      if (first && m.tool === 'circle') shape({ type: 'circle', center: first, radius: Math.hypot(at[0] - first[0], at[1] - first[1]) });
      if (first && m.tool === 'polygon') {
        // the circumscribed circle and the polygon with its first vertex at the cursor
        const [radius, direction, sides] = [Math.hypot(at[0] - first[0], at[1] - first[1]), Math.atan2(at[1] - first[1], at[0] - first[0]), this.polygon.sides];
        shape({ type: 'circle', center: first, radius });
        pushPolyline(rubber, frame, Array.from({ length: sides + 1 }, (_, i): Vec2 => [first[0] + radius * Math.cos(direction + (2 * Math.PI * i) / sides), first[1] + radius * Math.sin(direction + (2 * Math.PI * i) / sides)]));
      }
      if (first && m.tool === 'arc') {
        const start = m.clicks[1] ? positionOf(view, m.clicks[1]) : at;
        shape({ type: 'line', a: first, b: start });
        if (m.clicks[1]) {
          const from = Math.atan2(start[1] - first[1], start[0] - first[0]);
          const sweep = (Math.atan2(at[1] - first[1], at[0] - first[0]) - from + 4 * Math.PI) % (2 * Math.PI);
          shape({ type: 'arc', center: first, radius: Math.hypot(start[0] - first[0], start[1] - first[1]), from, sweep: sweep || 2 * Math.PI });
        }
      }
      model.lines.push({ segments: rubber, color: m.infer ? COLOR.select : m.construction ? COLOR.construction : COLOR.rubber, width: 1.5, dashed: true, onTop: true });
      if (cursor.snap) model.points.push({ positions: toWorld(frame, at[0], at[1]), color: 0x16a34a, size: 12 });
      if (m.infer) model.labels.push({ at: toWorld(frame, at[0], at[1]), text: m.infer === 'horizontal' ? 'vodorovně' : 'svisle', tone: 'reference' });
    }
  }
}

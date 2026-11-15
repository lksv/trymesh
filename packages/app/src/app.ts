// Ukázková aplikace nad enginem: časová osa, 3D pohled, skicář, panel vysunutí, roviny a pole (pattern).
// Drží jen stav UI (režim, výběr, značku pozice, viditelnost); vše ostatní čte z EngineState.
import {
  type Command,
  type CommandResult,
  type Constraint,
  type ConstraintExplanation,
  type EdgeKind,
  type EdgeName,
  type Engine,
  type EngineState,
  type Expr,
  type ExtrudeFeature,
  type FaceName,
  type Feature,
  type FeatureResult,
  type Frame,
  type Id,
  type Interference,
  type InterferenceReport,
  type Issue,
  type PatternFeature,
  type PlaneFeature,
  type PlaneRef,
  type RegionRef,
  type SketchDiagnosis,
  type SketchFeature,
  type SketchResult,
  type Solid,
  type Unit,
  type Vec2,
  type Vec3,
  CONSTRAINTS,
  MAX_POLYGON_SIDES,
  FEATURE_TYPE_INFO,
  GENERATORS,
  type GeneratorName,
  bodyFileName,
  bodyOwner,
  constraintKey,
  constraintPath,
  duplicateOf,
  emptyDocument,
  emptySketch,
  faceKey,
  featureInput,
  generatorOf,
  isDimension,
  isFlag,
  producesTool,
} from '@trymesh/engine';
import { type BridgeConnection, type BridgeStatus, MUTATING, changesDocument, connectBridge } from '@trymesh/mcp/bridge-client';
import { byId, download, fmt, h } from './dom';
import { expressionProblem, fieldNote, fieldText, parseField, plainNumber, valueText } from './fields';
import {
  type Anchor,
  type AxisKind,
  type DimensionVariant,
  type ExtentKind,
  type ExtentSide,
  type ExtrudeDraft,
  GEOMETRIC_KINDS,
  type PatternChange,
  type PatternChoices,
  type PatternDraft,
  type PatternSpan,
  type PlaneDraft,
  arcCommands,
  asConstruction,
  axisKind,
  type ExtrudeChange,
  type ProfileKind,
  type RememberedProfiles,
  changeExtrude,
  changePattern,
  patternIncomplete,
  patternSource,
  rememberedProfile,
  generatedProfile,
  profileKind,
  circleCommands,
  deleteCommands,
  dimensionFor,
  draftCommand,
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
import { type Shape, type SketchView, anchorOf, closestOn, hitCurve, hitPoint, insideLoop, kindOf, measure, operandsOf, polyline, sketchView } from './sketch-view';
import { type SceneModel, type View, Viewport } from './viewport';
import { angleProblem, bodyName, faceLabel, featureName, issueText } from './issue-text';

type Tool = 'select' | 'point' | 'line' | 'rect' | 'polygon' | 'circle' | 'arc' | 'project';

type Pick =
  | { kind: 'face'; body: Id; faceId: number; name: FaceName; planar: boolean }
  | { kind: 'edge'; body: Id; index: number; name: EdgeName; edgeKind: EdgeKind }
  | { kind: 'plane'; key: string; ref: PlaneRef; frame: Frame };

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
interface ExtrudeMode {
  kind: 'extrude';
  editing: boolean;
  index: number; // pozice feature na časové ose
  draft: ExtrudeDraft; // input form: a numeric field holds a number or an expression
  distance?: ExtrudeDraft['extent']; // the distance extent the draft had last, to return to from "through all"
  profiles?: RememberedProfiles; // the profile of each kind the draft had last, to return to from the other source
  preview?: EngineState;
  problem?: string;
  warning?: boolean; // the problem is a warning of the preview, not an error
  hover?: RegionRef;
}
interface PlaneMode {
  kind: 'plane';
  editing: boolean;
  index: number;
  draft: PlaneDraft;
  preview?: EngineState;
  problem?: string;
  warning?: boolean;
}
interface PatternMode {
  kind: 'pattern';
  editing: boolean;
  index: number;
  draft: PatternDraft;
  angle?: PatternSpan; // the angle span the draft had last, to return to from the full circle
  preview?: EngineState;
  problem?: string;
  warning?: boolean;
}
// A feature being created or changed in a form; it is not in the document until confirmed.
type DraftMode = ExtrudeMode | PlaneMode | PatternMode;
type Mode = { kind: 'model' } | SketchMode | DraftMode;
const isDraft = (m: Mode): m is DraftMode => m.kind === 'extrude' || m.kind === 'plane' || m.kind === 'pattern';

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
const FEATURE_TYPES = Object.fromEntries(Object.entries(FEATURE_TYPE_INFO).map(([type, info]) => [type, info.title])) as Record<Feature['type'], string>;
const CHECK_STATUS = { ok: '✓ holds', failed: '✗ fails', error: '! cannot be evaluated' };
const OPERATIONS: Record<ExtrudeFeature['operation'], string> = { new: 'Nové těleso', add: 'Přidat k tělesu', cut: 'Odebrat z tělesa' };
// Facts of a generated profile shown below the form and at the selected feature, with their units.
const FACTS_SHOWN: Record<GeneratorName, [name: string, label: string, unit: Unit][]> = {
  involuteGear: [
    ['module', 'module', 'mm'],
    ['pitchDiameter', 'pitch ⌀', 'mm'],
    ['tipDiameter', 'tip ⌀', 'mm'],
    ['rootDiameter', 'root ⌀', 'mm'],
    ['rotation', 'rotation', 'rad'],
  ],
};
const EXTENTS: Record<ExtentKind, string> = { distance: 'Distance', throughAll: 'Through all' };
const SIDES: Record<ExtentSide, string> = { both: 'Both sides', forward: 'Along the normal', backward: 'Against the normal' };
const AXES: Record<AxisKind, string> = { X: 'Axis X', Y: 'Axis Y', Z: 'Axis Z', sketchPoint: 'Through a point of a sketch' };
const PICK_REACH = 7; // px
const SLOW_PREVIEW = 150; // ms; a preview slower than this is not recomputed on every keystroke
const PREVIEW_PAUSE = 500; // ms without typing before such a preview is computed
const COLOR = { edge: 0x26303c, select: 0xf97316, hover: 0x0ea5e9, sketch: 0x1d4ed8, determined: 0x1c2430, implied: 0x7c3aed, idle: 0x5b7aa8, construction: 0xb45309, external: 0xa21caf, rubber: 0x64748b, plane: 0x8b9bb4, region: 0x2563eb, clash: 0xdc2626 };

const toWorld = (frame: Frame, u: number, v: number): Vec3 => [
  frame.origin[0] + u * frame.x[0] + v * frame.y[0],
  frame.origin[1] + u * frame.x[1] + v * frame.y[1],
  frame.origin[2] + u * frame.x[2] + v * frame.y[2],
];
const sameRegion = (a: RegionRef, b: RegionRef): boolean => a.outerLoop.length === b.outerLoop.length && a.outerLoop.every((id, i) => id === b.outerLoop[i]);
const pickKey = (pick: Pick | undefined): string => (!pick ? '' : pick.kind === 'face' ? `f/${pick.body}/${pick.faceId}` : pick.kind === 'edge' ? `e/${pick.body}/${pick.index}` : `p/${pick.key}`);

export class App {
  private readonly viewport: View;
  private mode: Mode = { kind: 'model' };
  private selected?: Pick; // výběr v pohledu (režim modelu)
  private hover?: Pick;
  private selectedFeature?: Id; // výběr na časové ose
  private marker: Id | null = null; // feature, za kterou se vkládá; null = konec osy
  private markerIndex = 0; // kde značka naposledy ležela, pro případ, že její feature zmizí
  private readonly hidden = new Set<Id>();
  private showBasePlanes = true;
  private pending?: 'sketch' | 'plane'; // čeká se na výběr roviny
  // The last answer to "which bodies collide", for the state after `at` (null = the whole model);
  // `picked` is the pair highlighted in the view. A change of the document throws it away.
  private collisions?: { at: Id | null; report: InterferenceReport; picked?: number };
  private note = { text: '', error: false };
  private collisionNote?: { text: string; error: boolean }; // the note of the last collision check, while it is the one shown
  private readonly counters = new Map<string, number>();
  private cache?: EngineState;
  private previewCost = 0; // ms the last preview of a draft took
  private polygon: PolygonOptions = DEFAULT_POLYGON; // what the polygon tool draws; remembered between sketches
  private previewTimer?: number;
  private confirming = false; // a draft is being confirmed: no preview in between
  private contextCache?: SketchContext | null;
  private down?: { x: number; y: number; button: number };
  private readonly boxes = new WeakMap<Solid, { min: Vec3; max: Vec3 }>();

  // `view`: the view to draw into and to pick in; the real one by default (a test passes its own).
  constructor(private readonly engine: Engine, view?: View) {
    this.viewport = view ?? new Viewport(byId('viewport'));
    engine.subscribe(() => {
      this.collisions = undefined; // the answer belonged to the document as it was
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

  private get doc() {
    return this.engine.getState().document;
  }
  private feature(id: Id | undefined | null): Feature | undefined {
    return id == null ? undefined : this.doc.features.find((f) => f.id === id);
  }
  // Names for a human: see issue-text.ts.
  private readonly featureNames = (id: Id): string | undefined => this.feature(id)?.name;
  private nameOf(id: Id): string {
    return featureName(id, this.featureNames);
  }
  private bodyName(body: Id): string {
    return bodyName(body, this.featureNames);
  }
  // A body is hidden at the feature that created it; the copies of a pattern all at once.
  private bodyHidden(body: Id): boolean {
    return this.hidden.has(bodyOwner(body).feature);
  }

  // Stav, který se právě zobrazuje: model po značce pozice, po upravované feature, nebo náhled.
  private view(): EngineState {
    if (this.cache) return this.cache;
    const m = this.mode;
    if (m.kind === 'sketch') this.cache = m.preview ?? this.engine.getState(m.id);
    else if (m.kind === 'model') this.cache = this.marker ? this.engine.getState(this.marker) : this.engine.getState();
    else this.cache = m.preview ?? this.stateBefore(m.index);
    return this.cache;
  }
  private stateBefore(index: number): EngineState {
    const previous = this.doc.features[index - 1];
    if (previous) return this.engine.getState(previous.id);
    const state = this.engine.getState();
    return { ...state, evaluation: { ...state.evaluation, features: {}, bodies: {}, faceNames: [], faceSurfaces: [] } };
  }
  private invalidate(): void {
    this.cache = undefined;
    this.contextCache = undefined;
  }

  private insertIndex(): number {
    const at = this.doc.features.findIndex((f) => f.id === this.marker);
    return at < 0 ? this.doc.features.length : at + 1;
  }

  // ID nové entity: předpona a pořadové číslo, které se v dokumentu ještě nevyskytuje. Čítač se
  // během práce nevrací, takže se ID smazané entity znovu nepoužije.
  private readonly newId = (prefix: string): Id => {
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

  private say(text: string, error = false): void {
    this.note = { text, error };
    const bar = byId('status');
    bar.textContent = text;
    bar.classList.toggle('error', error);
  }

  // Provede příkaz; neplatný příkaz dokument nezmění a zpráva se ukáže ve stavovém řádku.
  private run(command: Command, done?: string): boolean {
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

  private refresh(): void {
    this.cancelDrag(); // dokument se mohl změnit pod rozpracovaným tažením
    this.invalidate();
    const m = this.mode;
    // Značka, jejíž feature zmizela (undo, smazání), spadne na feature před ní.
    const features = this.doc.features;
    const at = features.findIndex((f) => f.id === this.marker);
    if (this.marker && at < 0) this.marker = features[Math.min(this.markerIndex, features.length) - 1]?.id ?? null;
    if (this.marker && this.marker === features[features.length - 1]?.id) this.marker = null;
    this.markerIndex = features.findIndex((f) => f.id === this.marker);
    // The note of a collision check goes with its answer: when the document changed, the marker
    // moved to another state or the section was closed.
    if (this.collisionNote && !this.shownCollisions()) {
      if (this.note === this.collisionNote) this.say('');
      this.collisionNote = undefined;
    }
    if (this.selectedFeature && !this.feature(this.selectedFeature)) this.selectedFeature = undefined;
    if (m.kind === 'sketch' && this.feature(m.id)?.type !== 'sketch') this.mode = { kind: 'model' };
    if (isDraft(m) && m.editing && !this.feature(m.draft.id)) this.mode = { kind: 'model' };
    if (isDraft(this.mode) && !this.confirming) this.updatePreview();
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
        group(
          button('Skica', () => this.startOnPlane('sketch'), { title: 'Nová skica na rovině nebo rovinné stěně', active: this.pending === 'sketch' }),
          button('Vysunutí', () => this.startExtrude(), { title: 'Vysunout oblasti skici' }),
          button('Rovina', () => this.startOnPlane('plane'), { title: 'Rovina posunutá od roviny nebo rovinné stěny', active: this.pending === 'plane' }),
          button('Pattern', () => this.startPattern(), { title: 'Repeat extrusions that add or cut, or a body, around an axis' }),
        ),
        group(button('Collisions', () => this.checkCollisions(), { title: 'Check which bodies share a volume', disabled: Object.keys(this.view().evaluation.bodies).length < 2, active: this.shownCollisions() !== undefined })),
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
    const editing = this.mode.kind === 'sketch' ? this.mode.id : isDraft(this.mode) ? this.mode.draft.id : undefined;
    const busy = this.mode.kind !== 'model';
    const rows: HTMLElement[] = [h('h2', {}, 'Časová osa')];
    const markerRow = () => h('div', { className: 'marker', title: 'Sem se vkládají nové prvky' }, 'zde se vkládá');

    const bodiless = (f: Feature): boolean => (f.type === 'extrude' && f.operation !== 'new') || (f.type === 'pattern' && f.source.type === 'features');
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

  private edit(id: Id): void {
    const f = this.feature(id);
    if (!f) return;
    if (f.type === 'sketch') this.enterSketch(id);
    else if (f.type === 'extrude') this.startExtrude(f);
    else if (f.type === 'pattern') this.startPattern(f);
    else this.startPlane(f.base, f);
  }

  // ---------------------------------------------------------------- pravý panel

  private renderPanel(): void {
    const m = this.mode;
    const panel = byId('panel');
    if (m.kind === 'sketch') panel.replaceChildren(...this.sketchPanel(m));
    else if (m.kind === 'extrude') panel.replaceChildren(...this.extrudePanel(m));
    else if (m.kind === 'plane') panel.replaceChildren(...this.planePanel(m));
    else if (m.kind === 'pattern') panel.replaceChildren(...this.patternPanel(m));
    else panel.replaceChildren(...this.modelPanel());
  }

  // The text of an issue for a human, with the bodies, features and copies it is about named.
  private issueText(issue: Issue): string {
    return issueText(issue, this.featureNames);
  }

  private issues(result: FeatureResult | undefined): HTMLElement[] {
    if (!result) return [];
    const out: HTMLElement[] = [];
    if (result.error) out.push(h('p', { className: 'issue error' }, this.issueText(result.error)));
    for (const warning of result.warnings) out.push(h('p', { className: 'issue warning' }, this.issueText(warning)));
    // expression errors by field
    for (const [path, error] of Object.entries(result.fieldErrors ?? {})) out.push(h('p', { className: 'issue error' }, `Field ${path}: ${error.message}`));
    return out;
  }

  private describe(pick: Pick): string {
    if (pick.kind === 'plane') return pick.ref.kind === 'base' ? `Rovina ${pick.ref.plane}` : pick.ref.kind === 'plane' ? `Rovina „${this.nameOf(pick.ref.feature)}“` : 'Rovina';
    const face = (name: FaceName) => faceLabel(name, this.featureNames);
    if (pick.kind === 'face') return `Stěna: ${face(pick.name)}${pick.planar ? '' : ' (není rovinná)'}`;
    const kinds: Record<EdgeKind, string> = { line: 'úsečka', circle: 'kružnice', coplanar: 'v ploše', other: 'obecná křivka' };
    return `Hrana (${kinds[pick.edgeKind]}): ${face(pick.name.a)} × ${face(pick.name.b)}`;
  }

  private planeRefOf(pick: Pick | undefined): PlaneRef | undefined {
    if (pick?.kind === 'plane') return pick.ref;
    if (pick?.kind === 'face' && pick.planar) return { kind: 'face', body: pick.body, face: pick.name };
    return undefined;
  }

  private modelPanel(): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (this.pending) {
      out.push(
        h('h2', {}, this.pending === 'sketch' ? 'Nová skica' : 'Nová rovina'),
        h('p', { className: 'hint' }, 'Klikněte v pohledu na rovinu nebo rovinnou stěnu, nebo zvolte základní rovinu:'),
        h('div', { className: 'buttons' }, ...(['XY', 'XZ', 'YZ'] as const).map((plane) => h('button', { textContent: plane, onclick: () => this.usePlane({ kind: 'base', plane }) }))),
        h('div', { className: 'buttons' }, h('button', { textContent: 'Zrušit', onclick: () => ((this.pending = undefined), this.refresh()) })),
      );
      return out;
    }
    const f = this.feature(this.selectedFeature);
    if (f) {
      const result = this.engine.getState().evaluation.features[f.id];
      const ref = this.planeRefOf(this.selected);
      out.push(
        h('h2', {}, FEATURE_TYPES[f.type]),
        h('label', {}, 'Název', h('input', { value: f.name, onchange: (event: Event) => this.run({ type: 'renameFeature', id: f.id, name: (event.target as HTMLInputElement).value }) })),
        ...this.issues(result),
        h(
          'div',
          { className: 'buttons' },
          h('button', { textContent: 'Upravit', className: 'primary', onclick: () => this.edit(f.id) }),
          h('button', { textContent: f.suppressed ? 'Obnovit' : 'Potlačit', onclick: () => this.run({ type: 'setSuppressed', id: f.id, suppressed: !f.suppressed }) }),
          h('button', { textContent: 'Smazat', onclick: () => this.run({ type: 'removeFeature', id: f.id }, `Smazáno: ${f.name}. Závislé prvky zůstávají a hlásí chybu.`) }),
        ),
      );
      if (f.type === 'sketch') {
        out.push(
          h('button', { textContent: 'Přenést skicu na vybranou rovinu', disabled: !ref, title: 'Nejdřív vyberte v pohledu rovinu nebo rovinnou stěnu', onclick: () => ref && this.run({ type: 'setSketchPlane', sketch: f.id, plane: ref }, 'Rovina skici změněna.') }),
        );
      }
      const shown = (path: string, value: number): string => (f.expressions?.[path] ? `${f.expressions[path]} = ${fmt(value)}` : fmt(value));
      if (f.type === 'extrude') {
        const start = f.extent.type === 'distance' && (f.extent.start !== 0 || f.expressions?.['extent/start']) ? `, start ${shown('extent/start', f.extent.start)} mm` : '';
        const extent = f.extent.type === 'distance' ? `distance ${shown('extent/distance', f.extent.distance)} mm${start}` : `through all (${SIDES[f.extent.side].toLowerCase()})`;
        const targets = f.targets?.length ? `, bodies: ${f.targets.map((id) => this.bodyName(id)).join(', ')}` : '';
        const profile = f.profile.type === 'regions' ? `regions: ${f.profile.regions.length}` : `${GENERATORS[f.profile.generator].title.toLowerCase()} over ${Object.values(f.profile.operands).join(', ')}`;
        out.push(h('p', { className: 'hint' }, `${OPERATIONS[f.operation]}, ${extent}, ${profile}${targets}.`));
        const facts = this.factsText(f, this.view().evaluation.features[f.id]);
        if (facts) out.push(h('p', { className: 'hint' }, facts));
      }
      if (f.type === 'plane') out.push(h('p', { className: 'hint' }, `Posun ${shown('offset', f.offset)} mm.`));
      if (f.type === 'pattern') {
        const { axis, count, span } = f.transform;
        const field = (path: string, value: number, unit: Unit): string => (f.expressions?.[path] ? `${f.expressions[path]} = ${valueText(value, unit)}` : valueText(value, unit));
        const source = f.source.type === 'features' ? `features: ${f.source.features.map((id) => this.nameOf(id)).join(', ')}` : `body: ${this.bodyName(f.source.body)}`;
        const around = axis.kind === 'base' ? `axis ${axis.axis}` : `the point ${axis.point} of ${this.nameOf(axis.sketch)}`;
        const extent = span.type === 'full' ? 'the full circle' : `an angle of ${field('transform/span/angle', span.angle, 'rad')}`;
        out.push(h('p', { className: 'hint' }, `Count ${field('transform/count', count, 'count')} with the original, around ${around}, ${extent}; ${source}.`));
      }
      // the bodies the feature created, each with its volume, size and its own export
      out.push(...this.bodyRows(result?.bodies ?? []));
    } else {
      out.push(h('h2', {}, 'Model'), h('p', { className: 'hint' }, 'Pravé tlačítko myši otáčí, kolečko přibližuje, prostřední tlačítko (nebo Shift + pravé) posouvá. Na touchpadu: Alt/Option + tažení otáčí, Alt + Shift + tažení posouvá, dva prsty přibližují. Prvek na časové ose se upravuje dvojklikem.'));
    }
    if (this.selected) {
      out.push(h('h2', {}, 'Výběr'), h('p', {}, this.describe(this.selected)));
      if (this.selected.kind !== 'plane') out.push(...this.bodyRows([this.selected.body]));
    }
    out.push(...this.collisionsPanel());
    out.push(...this.parametersPanel());
    return out;
  }

  // A line per body: name, volume, size of its box, and the export of that body alone. The file
  // is named by the body ID (a copy of a pattern: `planets%2F1.stl`).
  private bodyRows(ids: Id[]): HTMLElement[] {
    const bodies = this.view().evaluation.bodies;
    return ids
      .filter((id) => Object.prototype.hasOwnProperty.call(bodies, id))
      .map((id) => {
        const { volume, bounds } = bodies[id];
        const size = bounds.max.map((high, axis) => fmt(high - bounds.min[axis])).join(' × ');
        const exportable = Object.prototype.hasOwnProperty.call(this.engine.getState().evaluation.bodies, id);
        return h(
          'p',
          { className: 'hint body' },
          `${this.bodyName(id)}: ${fmt(volume)} mm³, ${size} mm `,
          h('button', { className: 'link', textContent: 'Export STL', disabled: !exportable, title: 'This body alone, as it is at the end of the timeline', onclick: () => download(`${bodyFileName(id)}.stl`, new Uint8Array(this.engine.exportMesh('stl', [id])), 'model/stl') }),
        );
      });
  }

  // ---------------------------------------------------------------- collisions

  // The answer is shown only for the state it was computed for.
  private shownCollisions() {
    return this.collisions && this.collisions.at === this.marker ? this.collisions : undefined;
  }

  private checkCollisions(): void {
    const report = this.engine.interference(this.marker ? { at: this.marker } : {});
    this.collisions = { at: this.marker, report };
    const failed = report.failed.length ? ` ${report.failed.length} pair(s) could not be computed.` : '';
    const fits = report.fits.length ? ` ${report.fits.length} fit(s) within the chord tolerance.` : '';
    if (report.pairs.length) this.say(`Collisions: ${report.pairs.length} pair(s) of bodies share a volume.${fits}${failed}`, true);
    else this.say(`No collisions: ${report.checked} pair(s) checked.${fits}${failed}`, report.failed.length > 0);
    this.collisionNote = this.note; // the note states a fact about the model: it goes when the model changes
    this.refresh();
  }

  // The colliding pairs; a click on one highlights its two bodies in the view.
  private collisionsPanel(): HTMLElement[] {
    const shown = this.shownCollisions();
    if (!shown) return [];
    const { report } = shown;
    const pick = (index: number) => {
      shown.picked = shown.picked === index ? undefined : index;
      this.renderPanel();
      this.renderScene();
    };
    // collisions first, then the fits; `picked` counts through both lists
    const row = (pair: Interference, index: number, fit: boolean) =>
      h(
        'div',
        { className: `row ${shown.picked === index ? 'selected' : ''}`, title: `Highlight the two bodies. One reaches ${fmt(pair.depth)} mm into the other`, onclick: () => pick(index) },
        h('span', { className: 'name', textContent: `${this.bodyName(pair.a)} × ${this.bodyName(pair.b)}` }),
        h('small', {}, `${fit ? 'fit, ' : ''}${fmt(pair.volume)} mm³`),
      );
    const rows: (HTMLElement | null)[] = [
      h('h2', {}, `Collisions (${report.pairs.length})`),
      report.pairs.length === 0 && report.failed.length === 0 ? h('p', { className: 'hint' }, `No two bodies collide; ${report.checked} pair(s) checked. Bodies that only touch do not count.`) : null,
      ...report.pairs.map((pair, index) => row(pair, index, false)),
      report.fits.length ? h('p', { className: 'hint' }, 'Fits: round faces that reach into each other by no more than the chord tolerance. Round faces are polygons, so a pin in a hole of the same diameter overlaps its wall by slivers; that is not a collision of the design.') : null,
      ...report.fits.map((pair, index) => row(pair, report.pairs.length + index, true)),
      ...report.failed.map((pair) => h('p', { className: 'issue warning' }, `${this.bodyName(pair.a)} × ${this.bodyName(pair.b)}: could not be computed (${pair.message})`)),
      h('div', { className: 'buttons' }, h('button', { textContent: 'Check again', onclick: () => this.checkCollisions() }), h('button', { textContent: 'Close', onclick: () => ((this.collisions = undefined), this.refresh()) })),
    ];
    return rows.filter((element): element is HTMLElement => element !== null);
  }

  // The parameter table and checks. An expression is only checked while typing; the command is sent once the field is committed.
  private parametersPanel(): HTMLElement[] {
    const { document: doc, evaluation } = this.engine.getState();
    const expr = (value: string, kind: 'number' | 'check', commit: (text: string) => boolean): HTMLInputElement => {
      const input = h('input', {
        className: 'expr',
        value,
        placeholder: kind === 'number' ? 'expression, e.g. 2 * a' : 'condition, e.g. a < b',
        oninput: () => this.markProblem(input, input.value.trim() === '' ? undefined : expressionProblem(input.value, kind)),
        onchange: () => {
          if (input.value.trim() === value || !commit(input.value)) this.refresh();
        },
      });
      return input;
    };
    const rename = (value: string, title: string, commit: (text: string) => boolean): HTMLInputElement => {
      const input = h('input', { className: 'pname', value, title, onchange: () => (input.value.trim() === value || !commit(input.value.trim())) && this.refresh() });
      return input;
    };
    const adder = (label: string, kind: 'number' | 'check', add: (name: string, text: string) => boolean): HTMLElement => {
      const name = h('input', { className: 'pname', placeholder: 'name' });
      const value = expr('', kind, () => true);
      value.onchange = null;
      const submit = () => {
        if (name.value.trim() === '' || value.value.trim() === '') return this.say(`${label}: fill in both the name and the expression.`, true);
        add(name.value.trim(), value.value);
      };
      for (const input of [name, value]) input.onkeydown = (event: KeyboardEvent) => event.key === 'Enter' && submit();
      return h('div', { className: 'constraint' }, name, value, h('button', { textContent: 'Add', onclick: submit }));
    };

    const out: HTMLElement[] = [h('h2', {}, `Parameters (${doc.parameters.length})`)];
    for (const p of doc.parameters) {
      const result = evaluation.parameters[p.name];
      out.push(
        h(
          'div',
          { className: `constraint ${result && !result.ok ? 'conflict' : ''}`, title: result && !result.ok ? result.error.message : '' },
          rename(p.name, 'Parameter name; renaming also rewrites the expressions that use it', (to) => this.run({ type: 'renameParameter', name: p.name, to }, 'Parameter renamed.')),
          expr(p.expr, 'number', (text) => this.run({ type: 'setParameter', name: p.name, expr: text })),
          h('small', { className: 'computed' }, result?.ok ? `= ${plainNumber(result.value)}` : 'error'),
          h('button', { className: 'icon', textContent: '✕', title: 'Delete parameter', onclick: () => this.run({ type: 'removeParameter', name: p.name }, `Parameter ${p.name} deleted. Expressions that use it report an error.`) }),
        ),
      );
    }
    out.push(
      adder('Parameter', 'number', (name, text) => {
        if (doc.parameters.some((p) => p.name === name)) return this.say(`Parameter ${name} already exists.`, true), false;
        return this.run({ type: 'setParameter', name, expr: text }, `Parameter ${name} added.`);
      }),
      h('p', { className: 'hint' }, 'An expression can be typed into numeric fields and dimensions instead of a number. Angles in an expression are in radians; write degrees as deg(30).'),
      h('h2', {}, `Checks (${doc.checks.length})`),
    );
    for (const c of doc.checks) {
      const result = evaluation.checks[c.name];
      const status = result?.status ?? 'error';
      out.push(
        h(
          'div',
          { className: `constraint ${status === 'ok' ? '' : status === 'failed' ? 'redundant' : 'conflict'}`, title: result?.error?.message ?? '' },
          rename(c.name, 'Check name', (to) => this.run({ type: 'renameCheck', name: c.name, to })),
          expr(c.expr, 'check', (text) => this.run({ type: 'setCheck', name: c.name, expr: text })),
          h('small', { className: 'computed' }, CHECK_STATUS[status]),
          h('button', { className: 'icon', textContent: '✕', title: 'Delete check', onclick: () => this.run({ type: 'removeCheck', name: c.name }) }),
        ),
      );
    }
    out.push(
      adder('Check', 'check', (name, text) => {
        if (doc.checks.some((c) => c.name === name)) return this.say(`Check "${name}" already exists.`, true), false;
        return this.run({ type: 'setCheck', name, expr: text }, 'Check added.');
      }),
    );
    return out;
  }

  private markProblem(input: HTMLInputElement, problem: string | undefined): void {
    input.classList.toggle('invalid', problem !== undefined);
    input.title = problem ?? '';
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

  private planeSize(state: EngineState): number {
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
      const drafted = this.mode.kind === 'plane' && this.mode.draft.id === f.id; // rovina nemůže být svým vlastním základem
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
  private planePoint(event: { clientX: number; clientY: number }, frame: Frame): { at: Vec2; depth: number } | undefined {
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
    if (m.kind === 'extrude') {
      const region = m.draft.profile.type === 'regions' ? this.regionAt(event, m) : undefined;
      if ((region && m.hover && sameRegion(region, m.hover)) || region === m.hover) return;
      m.hover = region;
      return this.renderScene();
    }
    const hover = this.pick(event, { edges: m.kind === 'model' && !this.pending, faces: true, planes: true });
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
    if (m.kind === 'extrude') {
      const profile = m.draft.profile;
      const region = profile.type === 'regions' ? this.regionAt(event, m) : undefined; // a generated profile has no regions to pick
      if (!region || profile.type !== 'regions') return;
      const at = profile.regions.findIndex((r) => sameRegion(r, region));
      m.draft = { ...m.draft, profile: { ...profile, regions: at < 0 ? [...profile.regions, region] : profile.regions.filter((_, i) => i !== at) } };
      return this.draftChanged();
    }
    const pick = this.pick(event, { edges: m.kind === 'model' && !this.pending, faces: true, planes: true });
    const ref = this.planeRefOf(pick);
    if (m.kind === 'pattern') {
      // a click on a body picks it as the source of a pattern of a body (not a copy of the preview itself)
      const choices = this.patternChoices(m.index);
      if (m.draft.source.type !== 'body' || !pick || pick.kind === 'plane' || !choices.bodies.includes(pick.body)) return;
      m.draft = changePattern(m.draft, { body: pick.body }, choices, m.angle);
      return this.draftChanged();
    }
    if (m.kind === 'plane') {
      if (!ref) return this.say('Základem roviny může být rovina nebo rovinná stěna.', true);
      m.draft = { ...m.draft, base: ref };
      return this.draftChanged();
    }
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

  private startOnPlane(what: 'sketch' | 'plane'): void {
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

  private usePlane(ref: PlaneRef): boolean {
    const what = this.pending;
    this.pending = undefined;
    if (what === 'plane') {
      this.startPlane(ref);
      return true;
    }
    return this.createSketch(ref);
  }

  // Založí skicu; na stěně rovnou promítne její obrys (hrany druhu úsečka a kružnice).
  private createSketch(ref: PlaneRef): boolean {
    const id = this.newId('s');
    const index = this.insertIndex();
    const commands: Command[] = [{ type: 'addFeature', feature: emptySketch(id, `Skica ${id.slice(1)}`, ref), index }];
    if (ref.kind === 'face') {
      const key = faceKey(ref.face);
      for (const edge of this.view().evaluation.bodies[ref.body]?.edges ?? []) {
        if ((edge.kind === 'line' || edge.kind === 'circle') && (faceKey(edge.name.a) === key || faceKey(edge.name.b) === key)) {
          commands.push({ type: 'addExternal', sketch: id, id: this.newId('x'), ref: { type: 'edge', body: ref.body, edge: edge.name, kind: edge.kind } });
        }
      }
    }
    if (!this.run({ type: 'batch', commands })) return false;
    if (this.marker) this.marker = id;
    this.enterSketch(id);
    return true;
  }

  // ---------------------------------------------------------------- skica

  private enterSketch(id: Id): void {
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
            this.markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', parameterNames) : undefined);
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
              this.markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', parameterNames) : undefined);
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

  // ---------------------------------------------------------------- vysunutí a rovina

  private sketchRegions(id: Id): { result: SketchResult; frame: Frame } | undefined {
    if (!this.feature(id)) return undefined; // skica vysunutí mohla být smazána
    const result = this.engine.getState(id).evaluation.features[id];
    return result?.sketch && result.plane ? { result: result.sketch, frame: result.plane } : undefined;
  }

  private regionAt(event: PointerEvent, m: ExtrudeMode): RegionRef | undefined {
    const info = this.sketchRegions(m.draft.profile.sketch);
    const p = info && this.planePoint(event, info.frame)?.at;
    if (!info || !p) return undefined;
    return info.result.regions.find((region) => insideLoop(region.loops[0], p) && !region.loops.slice(1).some((hole) => insideLoop(hole, p)))?.ref;
  }

  private startExtrude(existing?: ExtrudeFeature): void {
    if (existing) {
      const index = this.doc.features.findIndex((f) => f.id === existing.id);
      return this.setMode({ kind: 'extrude', editing: true, index, draft: featureInput(existing) });
    }
    const index = this.insertIndex();
    const sketches = this.doc.features.slice(0, index).filter((f): f is SketchFeature => f.type === 'sketch');
    const chosen = sketches.find((f) => f.id === this.selectedFeature) ?? sketches[sketches.length - 1];
    if (!chosen) return this.say('Vysunutí potřebuje skicu. Nejdřív nějakou nakreslete.', true);
    const id = this.newId('e');
    this.setMode({ kind: 'extrude', editing: false, index, draft: { id, name: `Vysunutí ${id.slice(1)}`, suppressed: false, type: 'extrude', extent: { type: 'distance', start: 0, distance: 10 }, ...this.extrudeDefaults(chosen, index) } });
    this.say('Klikáním v pohledu vyberte oblasti skici.');
  }

  // Výchozí volby: jediná oblast se vybere sama; skica na stěně tělesa navrhne přidání k němu.
  private extrudeDefaults(sketch: SketchFeature, index: number): Pick2<ExtrudeFeature, 'profile' | 'operation' | 'targets'> {
    const regions = this.sketchRegions(sketch.id)?.result.regions ?? [];
    const bodies = Object.keys(this.stateBefore(index).evaluation.bodies);
    const target = sketch.plane.kind === 'face' && bodies.includes(sketch.plane.body) ? sketch.plane.body : undefined;
    return { profile: { type: 'regions', sketch: sketch.id, regions: regions.length === 1 ? [regions[0].ref] : [] }, operation: target ? 'add' : 'new', ...(target ? { targets: [target] } : {}) };
  }

  private startPlane(base: PlaneRef, existing?: PlaneFeature): void {
    if (existing) return this.setMode({ kind: 'plane', editing: true, index: this.doc.features.findIndex((f) => f.id === existing.id), draft: featureInput(existing) });
    const id = this.newId('r');
    this.setMode({ kind: 'plane', editing: false, index: this.insertIndex(), draft: { id, name: `Rovina ${id.slice(1)}`, suppressed: false, type: 'plane', base, offset: 10 } });
    this.say('Zadejte posun; kliknutím v pohledu lze změnit základ.');
  }

  // A new pattern: its source is the feature selected on the timeline when it can be one, otherwise
  // the latest extrusion that adds or cuts, otherwise the latest body.
  private startPattern(existing?: PatternFeature): void {
    if (existing) return this.setMode({ kind: 'pattern', editing: true, index: this.doc.features.findIndex((f) => f.id === existing.id), draft: featureInput(existing) });
    const index = this.insertIndex();
    const source = patternSource(this.patternChoices(index), this.selectedFeature);
    if (!source) return this.say('A pattern needs an extrusion that adds or cuts, or a body. Create one first.', true);
    const id = this.newId('n');
    this.setMode({ kind: 'pattern', editing: false, index, draft: { id, name: `Pattern ${id.slice(1)}`, suppressed: false, type: 'pattern', source, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 4, span: { type: 'full' } } } });
    this.say('Choose what to repeat, the axis and the count.');
  }

  // What a pattern at this place of the timeline can repeat and turn around.
  private patternChoices(index: number): PatternChoices {
    const before = this.doc.features.slice(0, index);
    return {
      tools: before.filter(producesTool).map((f) => f.id),
      bodies: Object.keys(this.stateBefore(index).evaluation.bodies),
      sketches: before.filter((f) => f.type === 'sketch').map((f) => f.id),
    };
  }

  // Náhled: příkaz se spočítá po upravovanou feature a dokument se nemění.
  private updatePreview(): void {
    window.clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
    const m = this.mode;
    if (!isDraft(m)) return;
    this.invalidate();
    // An angle typed in degrees and out of range is reported in degrees here; the engine would
    // report the radians it was converted to.
    const angle = FEATURE_TYPE_INFO[m.draft.type].fields.map((field) => angleProblem(this.draftValue(m, field.path), field.spec)).find((problem) => problem !== undefined);
    if (angle !== undefined) {
      m.preview = undefined;
      m.problem = angle;
      m.warning = false;
      this.previewCost = 0; // nothing was computed
      return;
    }
    // vysunutí bez oblastí ještě není co počítat; panel na výběr upozorní sám (a pattern without a source likewise)
    if ((m.kind === 'extrude' && this.unpicked(m)) || (m.kind === 'pattern' && patternIncomplete(m.draft))) {
      m.preview = undefined;
      m.problem = undefined;
      m.warning = false;
      this.previewCost = 0; // nothing was computed
      return;
    }
    const started = performance.now();
    const result = this.engine.preview(draftCommand(m.draft, m.editing, m.index), m.draft.id);
    this.previewCost = performance.now() - started;
    m.preview = result.ok ? result.state : undefined;
    const outcome = result.ok ? result.state.evaluation.features[m.draft.id] : undefined;
    m.problem = result.ok ? (outcome?.error ? this.issueText(outcome.error) : outcome?.warnings.map((w) => this.issueText(w)).join(' ')) || undefined : result.error.message;
    // a warning does not stop the feature from being confirmed; it is shown as one
    m.warning = result.ok && !outcome?.error;
    this.invalidate();
  }

  // A change of the draft shows in the preview at once. When the last preview was slow (a pattern
  // with many copies takes seconds), a change typed into a field waits for a pause in the typing
  // instead: every keystroke would otherwise block the app for that long.
  private draftChanged(rebuild = true): void {
    if (!rebuild && this.previewCost > SLOW_PREVIEW) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = window.setTimeout(() => isDraft(this.mode) && this.showDraft(false), PREVIEW_PAUSE);
      const problem = document.getElementById('draft-problem');
      if (problem) {
        problem.textContent = 'The preview takes a while; it follows after a pause in typing.';
        problem.className = 'issue warning';
      }
      return;
    }
    this.showDraft(rebuild);
  }
  private showDraft(rebuild: boolean): void {
    this.updatePreview();
    if (rebuild) this.renderPanel();
    else {
      const m = this.mode as DraftMode;
      const problem = document.getElementById('draft-problem');
      if (problem) {
        problem.textContent = m.problem ?? '';
        problem.className = `issue ${m.warning ? 'warning' : 'error'}`;
      }
      // expression values next to the fields
      for (const note of Array.from(document.querySelectorAll<HTMLElement>('#panel [data-field]'))) note.textContent = this.draftNote(m, note.dataset.field as string, note.dataset.unit as Unit);
      const facts = document.getElementById('draft-facts');
      if (facts && m.kind === 'extrude') facts.textContent = this.factsText(m.draft, m.preview?.evaluation.features[m.draft.id]);
      const bodies = document.getElementById('draft-bodies');
      if (bodies && m.kind === 'pattern') bodies.textContent = this.patternBodies(m);
    }
    this.renderScene();
  }

  private confirmDraft(m: DraftMode): void {
    // The form is left as soon as the command is in: the refresh the engine triggers must not
    // preview the same change once more on top of the changed document (seconds for a slow pattern).
    this.confirming = true;
    const done = this.run(draftCommand(m.draft, m.editing, m.index), m.editing ? 'Změna uložena.' : `${FEATURE_TYPES[m.draft.type]} přidáno.`);
    this.confirming = false;
    if (!done) return;
    if (!m.editing && this.marker) this.marker = m.draft.id;
    this.selectedFeature = undefined;
    this.setMode({ kind: 'model' });
  }

  private draftButtons(m: DraftMode): HTMLElement[] {
    return [
      h('p', { id: 'draft-problem', className: `issue ${m.warning ? 'warning' : 'error'}` }, m.problem ?? ''),
      h(
        'div',
        { className: 'buttons' },
        h('button', { textContent: 'OK', className: 'primary', disabled: (m.kind === 'extrude' && this.unpicked(m)) || (m.kind === 'pattern' && patternIncomplete(m.draft)), onclick: () => this.confirmDraft(m) }),
        h('button', { textContent: 'Zrušit', onclick: () => this.setMode({ kind: 'model' }) }),
      ),
    ];
  }

  // A draft with a profile of regions and none picked yet: there is nothing to compute.
  private unpicked(m: ExtrudeMode): boolean {
    return m.draft.profile.type === 'regions' && m.draft.profile.regions.length === 0;
  }

  // Entities of a sketch a generator operand accepts: own curves and projected ones of the given kinds.
  private operandChoices(sketch: Id, kinds: readonly string[]): { id: Id; label: string }[] {
    const f = this.feature(sketch);
    if (f?.type !== 'sketch') return [];
    const radii = this.sketchRegions(sketch)?.result.radii ?? {};
    const size = (id: Id): string => (radii[id] === undefined ? '' : ` ⌀ ${fmt(2 * radii[id])}`);
    return [
      ...Object.entries(f.curves).filter(([, curve]) => kinds.includes(curve.type)).map(([id, curve]) => ({ id, label: `${id}${size(id)}${curve.construction ? ' (construction)' : ''}` })),
      ...Object.entries(f.external).filter(([, ref]) => kinds.includes(ref.kind)).map(([id]) => ({ id, label: `${id}${size(id)} (projected)` })),
    ];
  }
  // The first entity of each operand of a generator in a sketch; an operand without one is left out
  // and the engine says what is missing.
  private defaultOperands(generator: GeneratorName, sketch: Id): Record<string, Id> {
    return Object.fromEntries(GENERATORS[generator].operands.flatMap((operand) => this.operandChoices(sketch, operand.kinds).slice(0, 1).map((choice) => [operand.field, choice.id])));
  }
  // What the generator of a feature published, for a human: "module 0.9 mm, pitch ⌀ 16.2 mm, …".
  private factsText(f: { profile: ExtrudeDraft['profile'] }, result: FeatureResult | undefined): string {
    if (f.profile.type !== 'generated' || !result?.facts) return '';
    const facts = result.facts;
    return FACTS_SHOWN[f.profile.generator].filter(([name]) => typeof facts[name] === 'number').map(([name, label, unit]) => `${label} ${valueText(facts[name] as number, unit)}`).join(', ');
  }

  // A numeric field of a feature draft: a number or an expression. Next to an expression is its value from the preview.
  private draftField(m: DraftMode, label: string, path: string, change: (value: number | Expr) => void): HTMLElement {
    const unit = FEATURE_TYPE_INFO[m.draft.type].fields.find((field) => field.path === path)?.spec.unit ?? 'mm';
    const names = this.doc.parameters.map((p) => p.name);
    const input = h('input', {
      value: fieldText(this.draftValue(m, path), unit),
      oninput: () => {
        const parsed = parseField(input.value, unit);
        this.markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', names) : undefined);
        change(parsed ?? NaN); // the engine rejects an empty field and the preview says so
      },
    });
    const note = h('small', { className: 'computed' }, this.draftNote(m, path, unit));
    note.dataset.field = path;
    note.dataset.unit = unit;
    return h('label', {}, label, h('span', { className: 'field' }, input, note));
  }
  private draftValue(m: DraftMode, path: string): number | Expr {
    return path.split('/').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], m.draft) as number | Expr;
  }
  private draftNote(m: DraftMode, path: string, unit: Unit): string {
    return fieldNote(this.draftValue(m, path), m.preview?.evaluation.features[m.draft.id]?.values?.[path], unit);
  }

  private extrudePanel(m: ExtrudeMode): HTMLElement[] {
    const sketches = this.doc.features.slice(0, m.index).filter((f) => f.type === 'sketch');
    const bodies = Object.keys(this.stateBefore(m.index).evaluation.bodies);
    const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
    const set = (change: ExtrudeChange, rebuild = true) => {
      // the distance extent the draft had last comes back when the extent or the operation returns to it
      if (m.draft.extent.type === 'distance') m.distance = m.draft.extent;
      m.profiles = { ...m.profiles, [profileKind(m.draft.profile)]: m.draft.profile };
      m.draft = changeExtrude(m.draft, change, bodies, m.distance, m.profiles);
      this.draftChanged(rebuild);
    };
    const targets = m.draft.targets ?? [];
    const missing = targets.filter((id) => !bodies.includes(id));
    const extent = m.draft.extent;
    const cut = m.draft.operation === 'cut';
    const profile = m.draft.profile;
    const kind = profileKind(profile);
    // another sketch: the regions are picked again and the operands of a generator are found in it
    const toSketch = (sketch: Id): ExtrudeChange => (profile.type === 'regions' ? { sketch, regions: [] } : { sketch, operands: this.defaultOperands(profile.generator, sketch) });
    // a source the draft already had in this sketch comes back as it was; a new one finds its operands
    const toSource = (source: ProfileKind): ExtrudeChange => (source === 'regions' || rememberedProfile(m.profiles ?? {}, source, profile.sketch) ? { source } : { source, operands: this.defaultOperands(source, profile.sketch) });
    return [
      h('h2', {}, m.editing ? `Úprava: ${m.draft.name}` : 'Nové vysunutí'),
      // The profile: regions of the sketch, or a profile generator from the catalog.
      h(
        'label',
        {},
        'Profile',
        h(
          'select',
          { onchange: (event: Event) => set(toSource((event.target as HTMLSelectElement).value as ProfileKind)) },
          option('regions', 'Sketch regions', kind === 'regions'),
          ...(Object.keys(GENERATORS) as GeneratorName[]).map((generator) => option(generator, GENERATORS[generator].title, kind === generator)),
        ),
      ),
      h(
        'label',
        {},
        'Skica',
        h(
          'select',
          { onchange: (event: Event) => set(toSketch((event.target as HTMLSelectElement).value)) },
          ...sketches.map((f) => option(f.id, f.name, f.id === profile.sketch)),
          sketches.some((f) => f.id === profile.sketch) ? null : option(profile.sketch, '(chybí)', true),
        ),
      ),
      ...(profile.type === 'regions' ? this.regionsFields(profile, set) : this.generatorFields(m, profile, set)),
      h(
        'label',
        {},
        'Operace',
        h(
          'select',
          { onchange: (event: Event) => set({ operation: (event.target as HTMLSelectElement).value as ExtrudeFeature['operation'] }) },
          ...(Object.keys(OPERATIONS) as ExtrudeFeature['operation'][]).map((operation) => option(operation, OPERATIONS[operation], operation === m.draft.operation)),
        ),
      ),
      // The extent: a distance with a start, or through all targets (a cut only).
      h(
        'label',
        {},
        'Extent',
        h(
          'select',
          { onchange: (event: Event) => set({ extent: (event.target as HTMLSelectElement).value as ExtentKind }) },
          option('distance', EXTENTS.distance, extent.type === 'distance'),
          h('option', { value: 'throughAll', textContent: cut ? EXTENTS.throughAll : `${EXTENTS.throughAll} (a cut only)`, selected: extent.type === 'throughAll', disabled: !cut }),
        ),
      ),
      ...(extent.type === 'distance'
        ? [
            this.draftField(m, 'Start (mm or an expression; offset from the sketch plane along its normal)', 'extent/start', (start) => set({ start }, false)),
            this.draftField(m, 'Distance (mm or an expression; negative = against the normal)', 'extent/distance', (distance) => set({ distance }, false)),
          ]
        : [
            h(
              'label',
              {},
              'Side',
              h(
                'select',
                { onchange: (event: Event) => set({ side: (event.target as HTMLSelectElement).value as ExtentSide }) },
                ...(Object.keys(SIDES) as ExtentSide[]).map((side) => option(side, SIDES[side], side === extent.side)),
              ),
            ),
            h('p', { className: 'hint' }, 'The length follows the target bodies at every recompute. On a face the normal points out of the body, so an ordinary hole goes against it.'),
          ]),
      m.draft.operation === 'add'
        ? h(
            'label',
            {},
            'Těleso',
            h(
              'select',
              { onchange: (event: Event) => set({ target: (event.target as HTMLSelectElement).value }) },
              ...bodies.map((body) => option(body, this.bodyName(body), body === targets[0])),
              ...missing.map((body) => option(body, '(chybí)', true)),
            ),
          )
        : null,
      // A cut may go through several bodies: one checkbox per body. A target that no longer exists
      // stays listed so that it can be unticked.
      cut
        ? h(
            'fieldset',
            { className: 'targets' },
            h('legend', {}, 'Target bodies'),
            ...[...bodies, ...missing].map((body) =>
              h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: targets.includes(body), onchange: () => set({ toggleTarget: body }) }), bodies.includes(body) ? this.bodyName(body) : `${body} (missing)`),
            ),
            bodies.length === 0 && missing.length === 0 ? h('p', { className: 'hint' }, 'There is no body to cut yet.') : null,
          )
        : null,
      ...this.draftButtons(m),
    ].filter((element): element is HTMLElement => element !== null);
  }

  // The part of the extrusion form for a profile of sketch regions.
  private regionsFields(profile: Extract<ExtrudeDraft['profile'], { type: 'regions' }>, set: (change: ExtrudeChange) => void): (HTMLElement | null)[] {
    const available = this.sketchRegions(profile.sketch)?.result.regions ?? [];
    const stale = profile.regions.filter((region) => !available.some((other) => sameRegion(other.ref, region))).length;
    return [
      h('p', { className: 'hint' }, `Vybraných oblastí: ${profile.regions.length}. Oblasti se vybírají kliknutím v pohledu.`),
      stale > 0 ? h('p', { className: 'issue warning' }, `${stale} z vybraných oblastí už ve skice není. Zrušte výběr a vyberte oblasti znovu.`) : null,
      h('div', { className: 'buttons' }, h('button', { textContent: 'Zrušit výběr oblastí', disabled: profile.regions.length === 0, onclick: () => set({ regions: [] }) })),
    ];
  }

  // The part of the extrusion form for a generated profile, built from the generator catalog:
  // a select per operand, a field per number, a checkbox per flag and a select per reference.
  private generatorFields(m: ExtrudeMode, profile: Extract<ExtrudeDraft['profile'], { type: 'generated' }>, set: (change: ExtrudeChange, rebuild?: boolean) => void): (HTMLElement | null)[] {
    const spec = GENERATORS[profile.generator];
    const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
    const earlier = this.doc.features.slice(0, m.index).filter((f) => f.id !== m.draft.id);
    return [
      ...spec.operands.map((operand) => {
        const choices = this.operandChoices(profile.sketch, operand.kinds);
        const chosen = profile.operands[operand.field];
        return h(
          'label',
          {},
          `${operand.field} (${operand.kinds.join(' or ')} of the sketch)`,
          h(
            'select',
            { onchange: (event: Event) => set({ operands: { [operand.field]: (event.target as HTMLSelectElement).value } }) },
            ...choices.map((choice) => option(choice.id, choice.label, choice.id === chosen)),
            choices.some((choice) => choice.id === chosen) ? null : option(chosen ?? '', chosen === undefined ? '(none in the sketch)' : `${chosen} (missing)`, true),
          ),
        );
      }),
      ...Object.entries(spec.params).map(([name, param]) =>
        isFlag(param)
          ? h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: profile.params[name] === true, onchange: (event: Event) => set({ params: { [name]: (event.target as HTMLInputElement).checked } }) }), param.title)
          : this.draftField(m, `${param.title}${param.unit === 'rad' ? ' (° or an expression in radians)' : param.unit === 'mm' ? ' (mm or an expression)' : ''}`, `profile/params/${name}`, (value) => set({ params: { [name]: value } }, false)),
      ),
      ...Object.entries(spec.refs).map(([name, ref]) => {
        const choices = earlier.filter((f) => (ref.generators as readonly (string | undefined)[]).includes(generatorOf(f)));
        const chosen = profile.refs?.[name];
        return h(
          'label',
          { title: ref.summary },
          ref.title,
          h(
            'select',
            { onchange: (event: Event) => set({ refs: { [name]: (event.target as HTMLSelectElement).value || null } }) },
            option('', '(none)', chosen === undefined),
            ...choices.map((f) => option(f.id, f.name, f.id === chosen)),
            chosen === undefined || choices.some((f) => f.id === chosen) ? null : option(chosen, `${this.nameOf(chosen)} (missing)`, true),
          ),
        );
      }),
      h('p', { id: 'draft-facts', className: 'hint' }, this.factsText(m.draft, m.preview?.evaluation.features[m.draft.id])),
    ];
  }

  private planePanel(m: PlaneMode): HTMLElement[] {
    const base = m.draft.base;
    const label = base.kind === 'base' ? `rovina ${base.plane}` : base.kind === 'plane' ? `rovina „${this.nameOf(base.feature)}“` : `stěna ${faceLabel(base.face as FaceName, this.featureNames)} (${this.bodyName(base.body)})`;
    return [
      h('h2', {}, m.editing ? `Úprava: ${m.draft.name}` : 'Nová rovina'),
      h('p', {}, `Základ: ${label}`),
      h('p', { className: 'hint' }, 'Jiný základ zvolíte kliknutím na rovinu nebo rovinnou stěnu v pohledu.'),
      this.draftField(m, 'Offset along the normal (mm or an expression)', 'offset', (offset) => {
        m.draft = { ...m.draft, offset };
        this.draftChanged(false);
      }),
      ...this.draftButtons(m),
    ];
  }

  // The pattern form: what to repeat (extrusions that add or cut, or one body), the axis and the
  // count with the span. The preview shows the result; a source or an axis that no longer exists
  // stays in the form marked as missing, so that it can be replaced.
  private patternPanel(m: PatternMode): HTMLElement[] {
    const choices = this.patternChoices(m.index);
    const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
    const select = (label: string, change: (value: string) => void, ...options: (HTMLElement | null)[]) => h('label', {}, label, h('select', { onchange: (event: Event) => change((event.target as HTMLSelectElement).value) }, ...options));
    const set = (change: PatternChange, rebuild = true) => {
      if (m.draft.transform.span.type === 'angle') m.angle = m.draft.transform.span;
      m.draft = changePattern(m.draft, change, choices, m.angle);
      this.draftChanged(rebuild);
    };
    const { source } = m.draft;
    const { axis, span } = m.draft.transform;
    const out: (HTMLElement | null)[] = [
      h('h2', {}, m.editing ? `Úprava: ${m.draft.name}` : 'New pattern'),
      select('Repeat', (value) => set({ source: value as 'features' | 'body' }), option('features', 'Features (extrusions that add or cut)', source.type === 'features'), option('body', 'A body', source.type === 'body')),
    ];
    if (source.type === 'features') {
      const missing = source.features.filter((id) => !choices.tools.includes(id));
      out.push(
        h(
          'fieldset',
          {},
          h('legend', {}, 'Features'),
          ...[...missing, ...choices.tools].map((id) =>
            h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: source.features.includes(id), onchange: () => set({ toggleFeature: id }) }), choices.tools.includes(id) ? this.nameOf(id) : `${this.nameOf(id)} (missing)`),
          ),
          choices.tools.length === 0 && missing.length === 0 ? h('p', { className: 'hint' }, 'There is no extrusion that adds or cuts before this place of the timeline.') : null,
        ),
        h('p', { className: 'hint' }, 'Every copy is built again in its place and applied to the targets of its feature, in the order of the timeline. A cut through all is measured for every copy.'),
      );
    } else {
      out.push(
        select(
          'Body',
          (value) => set({ body: value }),
          ...choices.bodies.map((body) => option(body, this.bodyName(body), body === source.body)),
          choices.bodies.includes(source.body) ? null : option(source.body, source.body === '' ? '(no body yet)' : `${source.body} (missing)`, true),
        ),
        h('p', { className: 'hint' }, 'The copies are new bodies; what is added to the source after the pattern is not copied.'),
      );
    }
    out.push(select('Axis', (value) => set({ axis: value as AxisKind }), ...(Object.keys(AXES) as AxisKind[]).map((kind) => option(kind, AXES[kind], kind === axisKind(axis)))));
    if (axis.kind === 'sketchPoint') {
      const sketch = this.feature(axis.sketch);
      const points = sketch?.type === 'sketch' && choices.sketches.includes(axis.sketch) ? ['origin', ...Object.keys(sketch.points), ...Object.entries(sketch.external).flatMap(([id, ref]) => (ref.kind === 'line' ? [`${id}/a`, `${id}/b`] : [`${id}/center`]))] : [];
      out.push(
        select(
          'Sketch',
          (value) => set({ sketch: value }),
          ...choices.sketches.map((id) => option(id, this.nameOf(id), id === axis.sketch)),
          choices.sketches.includes(axis.sketch) ? null : option(axis.sketch, `${this.nameOf(axis.sketch)} (missing)`, true),
        ),
        select('Point', (value) => set({ point: value }), ...points.map((id) => option(id, id === 'origin' ? 'origin of the sketch' : id, id === axis.point)), points.includes(axis.point) ? null : option(axis.point, `${axis.point} (missing)`, true)),
        h('p', { className: 'hint' }, 'The axis is the normal of the sketch plane through the point.'),
      );
    } else if (choices.sketches.length === 0) out.push(h('p', { className: 'hint' }, 'An axis through a point needs a sketch before this place of the timeline.'));
    out.push(
      this.draftField(m, 'Count with the original (a whole number or an expression)', 'transform/count', (count) => set({ count }, false)),
      select('Span', (value) => set({ span: value as PatternSpan['type'] }), option('full', 'Full circle', span.type === 'full'), option('angle', 'Angle between the first and the last copy', span.type === 'angle')),
      span.type === 'angle' ? this.draftField(m, 'Angle (° or an expression in radians)', 'transform/span/angle', (angle) => set({ angle }, false)) : null,
      h('p', { id: 'draft-bodies', className: 'hint' }, this.patternBodies(m)),
      ...this.draftButtons(m),
    );
    return out.filter((element): element is HTMLElement => element !== null);
  }
  // The bodies the previewed pattern creates, for the form.
  private patternBodies(m: PatternMode): string {
    const bodies = m.preview?.evaluation.features[m.draft.id]?.bodies ?? [];
    // a new pattern is not in the document yet: its copies take the name of the draft
    const nameOf = (id: Id): string | undefined => (id === m.draft.id ? m.draft.name : this.featureNames(id));
    return bodies.length ? `New bodies: ${bodies.map((body) => bodyName(body, nameOf)).join(', ')}.` : '';
  }

  // ---------------------------------------------------------------- scéna

  private renderScene(): void {
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
      if ((highlighted?.type === 'extrude' || highlighted?.type === 'pattern') && m.kind === 'model') {
        const own = (name: FaceName): boolean => (highlighted.type === 'extrude' ? name.feature === highlighted.id : (name.copy ?? []).some((tag) => tag.pattern === highlighted.id));
        for (const face of body.faces) if (own(evaluation.faceNames[face.id])) model.faces.push({ solid: body.solid, faceId: face.id, color: COLOR.select, opacity: 0.3 });
      }
    }
    model.lines.push({ segments: outline, color: COLOR.edge, width: 1.5 });
    // the two bodies of the picked collision
    const collisions = m.kind === 'model' ? this.shownCollisions() : undefined;
    const clash = collisions?.picked === undefined ? undefined : [...collisions.report.pairs, ...collisions.report.fits][collisions.picked];
    for (const [id, color] of clash ? ([[clash.a, COLOR.select], [clash.b, COLOR.clash]] as [Id, number][]) : []) {
      const body = evaluation.bodies[id];
      if (body && !this.bodyHidden(id)) for (const face of body.faces) model.faces.push({ solid: body.solid, faceId: face.id, color, opacity: 0.45 });
    }

    // roviny
    const half = this.planeSize(state) / 2;
    const square = [-half, -half, half, -half, half, half, -half, half];
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
    if (m.kind === 'extrude') {
      const info = this.sketchRegions(m.draft.profile.sketch);
      const picked = m.draft.profile.type === 'regions' ? m.draft.profile.regions : undefined; // a generated profile shows no regions
      for (const region of picked ? (info?.result.regions ?? []) : []) {
        const chosen = picked!.some((r) => sameRegion(r, region.ref));
        const hovered = m.hover !== undefined && sameRegion(m.hover, region.ref);
        model.fills.push({ frame: info!.frame, loops: region.loops, color: chosen ? COLOR.region : hovered ? COLOR.hover : COLOR.rubber, opacity: chosen ? (hovered ? 0.6 : 0.45) : hovered ? 0.35 : 0.15, onTop: true });
      }
    }
    if (m.kind === 'plane') {
      const frame = evaluation.features[m.draft.id]?.plane;
      if (frame) {
        model.fills.push({ frame, loops: [square], color: COLOR.select, opacity: 0.3 });
        model.lines.push({ segments: loopSegments(frame, square), color: COLOR.select, width: 2 });
      }
    }
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

type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

function pushPolyline(out: number[], frame: Frame, points: Vec2[]): void {
  for (let i = 0; i + 1 < points.length; i++) out.push(...toWorld(frame, points[i][0], points[i][1]), ...toWorld(frame, points[i + 1][0], points[i + 1][1]));
}

// Uzavřená smyčka (dvojice souřadnic v rovině) jako úsečky ve světě.
function loopSegments(frame: Frame, loop: number[]): number[] {
  const points: Vec2[] = [];
  for (let i = 0; i < loop.length; i += 2) points.push([loop[i], loop[i + 1]]);
  points.push(points[0]);
  const out: number[] = [];
  pushPolyline(out, frame, points);
  return out;
}

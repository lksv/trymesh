// Přepočet: přehrání časové osy s memoizací. Pravidla jsou v docs/architecture.md, sekce Přepočet.
import { SketchAnalysis } from './analysis';
import { constraintOperands } from './document';
import { type Profile, type Region, type SketchGeometry, detectProfile, measure, ownVariables, sameRegion, solverSetup } from './sketch';
import { type FaceInfo, type Prism, type SideCurve, analyzeBody, buildPrism, faceFrame, projectEdge, toWorld, volumeOf } from './solid';
import type {
  Document,
  Evaluation,
  ExtrudeFeature,
  FaceName,
  Feature,
  FeatureResult,
  Frame,
  Id,
  Issue,
  IssueCode,
  PlaneFeature,
  PlaneRef,
  Point2,
  Projected,
  SketchFeature,
  SketchSolver,
  Solid,
  SolidKernel,
  SolveInput,
  SolveResult,
} from './types';
import { faceKey, has } from './util';

export interface Deps {
  solver: SketchSolver;
  kernel: SolidKernel;
}
export interface DragTarget {
  sketch: Id;
  point: Id;
  target: Point2;
}
export interface EvaluateOptions {
  upTo?: Id; // skončit u této feature
  drag?: DragTarget; // tažení bodu, viz Řešení skici
}

// Stav modelu po feature. Neměnný; nezměněné části sdílí s předchozím stavem.
interface State {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, Solid>;
  faceNames: FaceName[]; // společná tabulka, index = číslo stěny
  faceInfos: FaceInfo[];
  faceIds: Map<string, number>; // jméno stěny → číslo
  planes: Record<Id, Frame>; // vyhodnocené vlastní roviny
  sketches: Record<Id, SketchState>;
  tools: Record<Id, ToolRecipe>; // recepty nástrojů vysunutí s operací add a cut
}

// Recept nástroje: jak z vyhodnoceného profilu a rozsahu postavit síť nástroje a jeho stěny.
// Ukládá se do stavu, aby pozdější feature (pole) mohla tentýž nástroj postavit znovu; hotová síť
// nestačí, protože čísla stěn i poloha nástroje se při opakování liší. Recept zůstává i tehdy, když
// vysunutí samo skončilo varováním „bez účinku".
export interface ToolRecipe {
  operation: 'add' | 'cut';
  targets: Id[];
  build(firstFaceId: number): Prism;
}

// Vyhodnocený profil vysunutí: oblasti v rovině skici a popis křivek, ze kterých vznikají boční stěny.
interface ResolvedProfile {
  regions: Region[];
  frame: Frame;
  curveOf: (id: Id) => SideCurve;
}
// `input`: vstup solveru s použitými polohami; `solve`: jak řešení dopadlo; `analysis`: rozbor
// určenosti (jen u vyřešené skici). Z nich vychází diagnostika skici.
export interface SketchState {
  feature: SketchFeature;
  frame: Frame;
  geometry: SketchGeometry;
  profile: Profile;
  input: SolveInput;
  solve: { status: SolveResult['status']; conflicting: Id[] };
  analysis?: SketchAnalysis;
}
// Záznam podle ID, které v něm nemusí být. ID přichází z odkazu v dokumentu a může se jmenovat
// jako vlastnost každého objektu (`constructor`, `toString`); ta se za záznam nepočítá.
const lookup = <T>(record: Record<Id, T>, id: Id): T | undefined => (has(record, id) ? record[id] : undefined);

// Z jakého stavu a kam vedl krok feature, která se při přepočtu vyřešila.
export type Trace = Map<Id, { before: State; after: State }>;

// Skica vyřešená při přepočtu: řešené proměnné a razítko k zápisu do dokumentu.
export type WriteBack = Pick<SketchFeature, 'points' | 'radii' | 'solved'>;
interface Step {
  state: State;
  writeBack?: WriteBack;
}

const BASE: Record<'XY' | 'XZ' | 'YZ', Frame> = {
  XY: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
};

const MESSAGE: Record<IssueCode, string> = {
  brokenReference: 'Odkaz vede na rovinu, stěnu, skicu nebo těleso, které v tomto místě časové osy neexistuje.',
  noProfile: 'Vybraná oblast ve skice není.',
  invalidProfile: 'Křivky skici se kříží nebo dotýkají mimo spojené body, nebo jsou si blíž, než rozliší dělení oblouků na úsečky.',
  nonPlanarFace: 'Stěna není rovinná.',
  emptyResult: 'Operace by odebrala celé těleso.',
  kernelFailure: 'Geometrické jádro operaci nezvládlo.',
  sketchConflict: 'Vazby skici si odporují nebo se skicu nepodařilo vyřešit.',
  brokenProjection: 'Promítnutá hrana už na tělese není.',
  degenerateProjection: 'Hrana je kolmá na rovinu skici a nejde promítnout.',
  unsupportedProjection: 'Hranu nejde promítnout jako zvolený druh křivky.',
  noEffect: 'Operace těleso nezměnila.',
};
const issue = (code: IssueCode, refs?: unknown[], detail?: string): Issue => ({ code, message: detail ? `${MESSAGE[code]} (${detail})` : MESSAGE[code], ...(refs ? { refs } : {}) });

// Přepočet s cache. Stav po každé feature se pamatuje podle identity objektu feature a identity
// předchozího stavu, takže nezměněný začátek časové osy se nepočítá znovu.
export class Evaluator {
  private readonly memo = new WeakMap<Feature, WeakMap<State, Step>>();
  private readonly initial = new WeakMap<Document['settings'], State>();

  constructor(private readonly deps: Deps) {}

  evaluate(doc: Document, options: EvaluateOptions = {}): { evaluation: Evaluation; writeBacks: Map<Id, WriteBack>; trace: Trace } {
    const { state: final, writeBacks, trace } = this.run(doc, options);
    const bodies = Object.fromEntries(Object.entries(final.bodies).map(([id, solid]) => [id, analyzeBody(solid, final.faceNames, final.faceInfos).result]));
    return { evaluation: { features: final.features, bodies, faceNames: final.faceNames }, writeBacks, trace };
  }

  // Vyhodnocená skica ve svém místě časové osy; undefined, když se nevyhodnotila (potlačená,
  // chybná rovina). Objekt je pro nezměněný dokument tentýž, hodí se jako klíč cache.
  sketchState(doc: Document, sketch: Id): SketchState | undefined {
    return lookup(this.run(doc, { upTo: sketch }).state.sketches, sketch);
  }

  private run(doc: Document, options: EvaluateOptions): { state: State; writeBacks: Map<Id, WriteBack>; trace: Trace } {
    let state: State = this.initial.get(doc.settings) ?? { features: {}, bodies: {}, faceNames: [], faceInfos: [], faceIds: new Map(), planes: {}, sketches: {}, tools: {} };
    this.initial.set(doc.settings, state);
    const writeBacks = new Map<Id, WriteBack>();
    const trace: Trace = new Map();
    for (const feature of doc.features) {
      const dragged = options.drag && options.drag.sketch === feature.id ? options.drag : undefined;
      let step: Step | undefined = dragged ? undefined : this.memo.get(feature)?.get(state);
      if (!step) {
        step = this.step(feature, state, doc.settings.chordTolerance, dragged);
        if (!dragged) this.remember(feature, state, step);
      }
      if (step.writeBack) {
        writeBacks.set(feature.id, step.writeBack);
        trace.set(feature.id, { before: state, after: step.state }); // pro převěšení cache po zápisu výsledku
      }
      state = step.state;
      if (feature.id === options.upTo) break;
    }
    return { state, writeBacks, trace };
  }

  // Zápis výsledku vytvoří nový objekt feature. Záznam v cache se na něj převěsí: nový objekt by
  // při přepočtu použil uložené proměnné a dal přesně tentýž stav.
  rehang(replaced: Map<Id, Feature>, trace: Trace): void {
    for (const [id, feature] of replaced) {
      const record = trace.get(id);
      if (record) this.remember(feature, record.before, { state: record.after });
    }
  }

  private remember(feature: Feature, before: State, step: Step): void {
    let map = this.memo.get(feature);
    if (!map) this.memo.set(feature, (map = new WeakMap()));
    map.set(before, step);
  }

  private step(feature: Feature, state: State, chordTolerance: number, drag?: DragTarget): Step {
    const done = (result: FeatureResult, change: Partial<State> = {}): State => ({ ...state, ...change, features: { ...state.features, [feature.id]: result } });
    const failed = (code: IssueCode, refs?: unknown[], detail?: string): Step => ({ state: done({ status: 'error', error: issue(code, refs, detail), warnings: [] }) });
    // Potlačená feature je prázdná operace; co na ní závisí, skončí v chybě.
    if (feature.suppressed) return { state: done({ status: 'suppressed', warnings: [] }) };
    // Krok podle typu feature; úplnost hlídá překladač (viz registr typů v document.ts).
    switch (feature.type) {
      case 'plane':
        return this.plane(feature, state, done, failed);
      case 'sketch':
        return this.sketch(feature, state, chordTolerance, drag, done, failed);
      case 'extrude':
        return this.extrude(feature, state, done, failed);
      default: {
        const unknown: never = feature;
        throw new Error(`přepočet: neznámý typ feature ${String((unknown as Feature).type)}`);
      }
    }
  }

  private frame(ref: PlaneRef, state: State): Frame | IssueCode {
    if (ref.kind === 'base') return BASE[ref.plane];
    if (ref.kind === 'plane') return lookup(state.planes, ref.feature) ?? 'brokenReference';
    const solid = lookup(state.bodies, ref.body);
    const id = state.faceIds.get(faceKey(ref.face));
    if (!solid || id === undefined) return 'brokenReference';
    return faceFrame(analyzeBody(solid, state.faceNames, state.faceInfos), id, state.faceInfos[id]);
  }

  private plane(feature: PlaneFeature, state: State, done: Done, failed: Failed): Step {
    const base = this.frame(feature.base, state);
    if (typeof base === 'string') return failed(base, [feature.base]);
    const frame: Frame = { ...base, origin: toWorld(base, 0, 0, feature.offset) };
    return { state: done({ status: 'ok', warnings: [], plane: frame }, { planes: { ...state.planes, [feature.id]: frame } }) };
  }

  private sketch(feature: SketchFeature, state: State, chordTolerance: number, drag: DragTarget | undefined, done: Done, failed: Failed): Step {
    const frame = this.frame(feature.plane, state);
    if (typeof frame === 'string') return failed(frame, [feature.plane]);
    const warnings: Issue[] = [];

    // 1. promítnutá geometrie ze stavu těles před skicou
    const external: Record<Id, Projected> = {};
    const lost: [Id, IssueCode][] = [];
    for (const id of Object.keys(feature.external).sort()) {
      const ref = feature.external[id];
      const solid = lookup(state.bodies, ref.body);
      const projected = solid ? projectEdge(analyzeBody(solid, state.faceNames, state.faceInfos), ref.edge, ref.kind, frame, state.faceInfos) : 'brokenProjection';
      if (typeof projected !== 'string') external[id] = projected;
      else {
        // Promítnutí, které nejde vyhodnotit, skicu neshodí: křivka zůstane na posledních platných hodnotách.
        const frozen = lookup(feature.solved.external, id);
        if (frozen && frozen.kind === ref.kind) external[id] = frozen;
        lost.push([id, projected]);
      }
    }
    const setup = solverSetup(feature, external);
    for (const [id, code] of lost) {
      const skipped = setup.skipped.filter((c) => constraintOperands(feature.constraints[c]).some((operand) => operand === id || operand.startsWith(`${id}/`)));
      warnings.push(issue(code, [id, ...skipped], skipped.length ? 'vazby na ni se při řešení vynechaly' : undefined));
    }

    // 2.–4. řešení: uložené proměnné platí, když se otisk vstupů shoduje s razítkem a netáhne se
    const stored: SketchGeometry = { points: setup.input.points, radii: setup.input.radii };
    const mustSolve = setup.stamp !== feature.solved.inputs || drag !== undefined;
    let result: SolveResult;
    try {
      result = this.deps.solver.solve(drag ? { ...setup.input, drag: { point: drag.point, target: drag.target } } : setup.input);
    } catch (error) {
      result = { status: 'failed', points: stored.points, radii: stored.radii, degreesOfFreedom: 0, conflicting: [], redundant: [] };
      warnings.push(issue('sketchConflict', undefined, error instanceof Error ? error.message : String(error)));
    }
    let geometry = stored;
    let writeBack: WriteBack | undefined;
    if (result.status === 'solved') {
      if (mustSolve) {
        geometry = { points: result.points, radii: result.radii };
        writeBack = { ...ownVariables(feature, geometry), solved: { inputs: setup.stamp, external } };
      }
    } else if (warnings.every((w) => w.code !== 'sketchConflict')) warnings.push(issue('sketchConflict', result.conflicting));

    // Stupně volnosti počítá engine z vlastního rozboru; počet ze solveru není spolehlivý.
    // Polohy v pořadí dokumentu (solver je vrací seřazené podle ID), aby i rozbor šel v tomto pořadí.
    const inOrder = <T>(order: Record<Id, T>, values: Record<Id, T>): Record<Id, T> => Object.fromEntries(Object.keys(order).map((id) => [id, values[id]]));
    const input: SolveInput = { ...setup.input, points: inOrder(setup.input.points, geometry.points), radii: inOrder(setup.input.radii, geometry.radii) };
    const analysis = result.status === 'solved' ? new SketchAnalysis(input) : undefined;
    const profile = detectProfile(feature, geometry, chordTolerance);
    const sketchResult: FeatureResult = {
      status: warnings.length ? 'warning' : 'ok',
      warnings,
      plane: frame,
      sketch: {
        points: geometry.points,
        radii: geometry.radii,
        degreesOfFreedom: analysis?.degreesOfFreedom ?? 0,
        conflicting: result.conflicting,
        redundant: result.redundant,
        measurements: measure(feature, setup.input.curves, geometry),
        valid: profile.valid,
        regions: profile.regions.map((region) => ({ ref: region.ref, loops: [region.outer, ...region.holes].map((loop) => Float64Array.from(loop.xy)) })),
      },
    };
    const solve = { status: result.status, conflicting: result.conflicting };
    return { state: done(sketchResult, { sketches: { ...state.sketches, [feature.id]: { feature, frame, geometry, profile, input, solve, analysis } } }), writeBack };
  }

  // Vysunutí má tři části: profil (odkud se bere tvar), nástroj (síť a nové stěny) a použití
  // (nové těleso, nebo booleovská operace s cílem).
  private extrude(feature: ExtrudeFeature, state: State, done: Done, failed: Failed): Step {
    const profile = this.profile(feature, state);
    if ('code' in profile) return failed(profile.code, profile.refs);
    const targetIds = feature.operation === 'new' ? [] : (feature.targets ?? []);
    const missing = targetIds.filter((id) => !lookup(state.bodies, id));
    if (missing.length || (feature.operation !== 'new' && targetIds.length === 0)) return failed('brokenReference', missing.length ? missing : [feature.targets]);

    // nástroj
    const { start, distance } = feature.extent;
    const build = (firstFaceId: number): Prism => buildPrism(feature.id, profile.regions, profile.frame, [start, start + distance], profile.curveOf, firstFaceId, this.deps.kernel);
    const first = state.faceNames.length;
    let tool: Prism;
    try {
      tool = build(first);
    } catch (error) {
      return failed('kernelFailure', undefined, error instanceof Error ? error.message : String(error));
    }
    // Nové stěny přidá feature na konec tabulky předchozího stavu.
    const tables = {
      faceNames: [...state.faceNames, ...tool.faces.map((f) => f.name)],
      faceInfos: [...state.faceInfos, ...tool.faces.map((f) => f.info)],
      faceIds: new Map([...state.faceIds, ...tool.faces.map((f, i): [string, number] => [faceKey(f.name), first + i])]),
    };

    // použití
    if (feature.operation === 'new') return { state: done({ status: 'ok', warnings: [] }, { ...tables, bodies: { ...state.bodies, [feature.id]: tool.solid } }) };
    const tools = { ...state.tools, [feature.id]: { operation: feature.operation, targets: targetIds, build } };
    const targetId = targetIds[0];
    const target = state.bodies[targetId];
    let result: Solid;
    try {
      result = this.deps.kernel.boolean(feature.operation === 'add' ? 'union' : 'difference', target, tool.solid);
    } catch (error) {
      return failed('kernelFailure', undefined, error instanceof Error ? error.message : String(error));
    }
    if (result.triangles.length === 0) return failed('emptyResult');
    // Bez účinku: objem se nezměnil. U výřezu navíc ve výsledku nesmí být žádná stěna nástroje;
    // u přidání být může (nástroj uvnitř tělesa, jehož stěna lícuje se stěnou tělesa, ji přejmenuje).
    // Změna objemu se měří proti menšímu z obou těles: drobný výstupek na velké desce účinek má.
    const before = volumeOf(target);
    const scale = Math.min(Math.abs(before), Math.abs(volumeOf(tool.solid)));
    const sameVolume = Math.abs(volumeOf(result) - before) <= 1e-6 * Math.max(1, scale);
    const unchanged = sameVolume && (feature.operation === 'add' || !result.faceIds.some((id) => id >= first));
    if (unchanged) return { state: done({ status: 'warning', warnings: [issue('noEffect')] }, { tools }) };
    return { state: done({ status: 'ok', warnings: [] }, { ...tables, tools, bodies: { ...state.bodies, [targetId]: result } }) };
  }

  // Profil vysunutí podle jeho zdroje. Další zdroje (generátor profilu) přibudou jako další větve.
  private profile(feature: ExtrudeFeature, state: State): ResolvedProfile | { code: IssueCode; refs: unknown[] } {
    const source = feature.profile;
    const sketch = lookup(state.sketches, source.sketch);
    if (!sketch) return { code: 'brokenReference', refs: [source.sketch] };
    if (!sketch.profile.valid) return { code: 'invalidProfile', refs: [source.sketch] };
    const regions = source.regions.map((ref) => sketch.profile.regions.find((region) => sameRegion(region.ref, ref)));
    const missing = source.regions.filter((_, i) => !regions[i]);
    if (missing.length) return { code: 'noProfile', refs: missing };
    const { points, radii } = sketch.geometry;
    const curveOf = (id: Id): SideCurve => {
      const curve = sketch.feature.curves[id];
      const at = (point: Id): [number, number] => [points[point].x, points[point].y];
      if (curve.type === 'line') return { type: 'line', a: at(curve.a), b: at(curve.b) };
      const center = at(curve.center);
      return { type: 'round', center, radius: curve.type === 'circle' ? radii[id] : Math.hypot(points[curve.start].x - center[0], points[curve.start].y - center[1]) };
    };
    return { regions: regions as Region[], frame: sketch.frame, curveOf };
  }
}

type Done = (result: FeatureResult, change?: Partial<State>) => State;
type Failed = (code: IssueCode, refs?: unknown[], detail?: string) => Step;

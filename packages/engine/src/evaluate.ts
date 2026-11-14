// Přepočet: přehrání časové osy s memoizací. Pravidla jsou v docs/architecture.md, sekce Přepočet.
import { SketchAnalysis } from './analysis';
import { checkNumber } from './catalog';
import { atPath, constraintOperands, fieldsOf, withPath } from './document';
import { type Environment, evaluateCheck, evaluateNumber, evaluateParameters } from './expression';
import { type Profile, type Region, type SketchGeometry, detectProfile, measure, ownVariables, sameRegion, solverSetup } from './sketch';
import { type FaceInfo, type Prism, type SideCurve, analyzeBody, buildPrism, faceFrame, projectEdge, toWorld, volumeOf } from './solid';
import type {
  Document,
  Evaluation,
  ExpressionError,
  ExtrudeFeature,
  FaceName,
  Feature,
  FeatureResult,
  FieldPath,
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
  // `targets`: the bodies the tool is about to be applied to, in the state it is applied in. An
  // extent that depends on them ("through all") is measured here, every time the tool is built.
  build(targets: Solid[], firstFaceId: number): Prism;
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

// The state a feature's step started from and led to, for features whose result is written back to the document.
export type Trace = Map<Id, { before: State; after: State }>;

// A sketch solved during the recompute: solved variables and the stamp to write back to the document.
type SolvedSketch = Pick<SketchFeature, 'points' | 'radii' | 'solved'>;
// What the recompute writes back to the document: the feature with expression values substituted
// into its fields and, for a sketch, the solved variables.
export interface WriteBack {
  feature: Feature;
  solved?: SolvedSketch;
}
interface Step {
  state: State;
  writeBack?: SolvedSketch;
}

// A feature with its expression values substituted. The recompute step works with `feature`; a field
// whose expression cannot be evaluated or gave a value out of range keeps the last valid number from
// the document. The object is memoised by the original feature and the expression results, so its
// identity (and with it the step cache) changes only when a value or an error changes.
interface Resolution {
  feature: Feature;
  values?: Record<FieldPath, number>;
  errors?: Record<FieldPath, ExpressionError>;
}
const RESOLUTIONS_KEPT = 8; // per feature; a preview while typing alternates between a few values

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
  invalidExpression: 'The expression of a numeric field cannot be evaluated or gives a value outside the range of the field.',
};
const issue = (code: IssueCode, refs?: unknown[], detail?: string): Issue => ({ code, message: detail ? `${MESSAGE[code]} (${detail})` : MESSAGE[code], ...(refs ? { refs } : {}) });

// Přepočet s cache. Stav po každé feature se pamatuje podle identity objektu feature a identity
// předchozího stavu, takže nezměněný začátek časové osy se nepočítá znovu.
export class Evaluator {
  private readonly memo = new WeakMap<Resolution, WeakMap<State, Step>>();
  private readonly resolutions = new WeakMap<Feature, Map<string, Resolution>>();
  private readonly initial = new WeakMap<Document['settings'], State>();

  constructor(private readonly deps: Deps) {}

  evaluate(doc: Document, options: EvaluateOptions = {}): { evaluation: Evaluation; writeBacks: Map<Id, WriteBack>; trace: Trace } {
    const { state: final, writeBacks, trace } = this.run(doc, options);
    const bodies = Object.fromEntries(Object.entries(final.bodies).map(([id, solid]) => [id, analyzeBody(solid, final.faceNames, final.faceInfos).result]));
    const parameters = evaluateParameters(doc.parameters);
    const checks = Object.fromEntries(doc.checks.map((check) => [check.name, evaluateCheck(check.expr, parameters)]));
    return { evaluation: { features: final.features, bodies, faceNames: final.faceNames, parameters, checks }, writeBacks, trace };
  }

  // Substitutes the values of the feature's expressions. `environment` holds the values of the names
  // expressions may use; the cache follows the expression values, not the identity of the
  // environment, so changing a parameter the feature does not use does not recompute its step.
  private resolve(feature: Feature, environment: Environment): Resolution {
    let known = this.resolutions.get(feature);
    if (!known) this.resolutions.set(feature, (known = new Map()));
    if (!feature.expressions) {
      let plain = known.get('');
      if (!plain) known.set('', (plain = { feature }));
      return plain;
    }
    const specs = new Map(fieldsOf(feature).map((field) => [field.path, field.spec]));
    const values: Record<FieldPath, number> = {};
    const errors: Record<FieldPath, ExpressionError> = {};
    for (const [path, expr] of Object.entries(feature.expressions)) {
      const spec = specs.get(path);
      if (!spec) continue; // validation does not let an address without a field into the document
      const result = evaluateNumber(expr, environment);
      const checked = result.ok ? checkNumber(result.value, spec) : undefined;
      if (checked?.ok) values[path] = checked.value;
      else errors[path] = result.ok ? { code: (checked as { code: ExpressionError['code'] }).code, message: (checked as { message: string }).message } : result.error;
    }
    const key = JSON.stringify([values, errors]);
    let resolution = known.get(key);
    if (resolution) {
      known.delete(key); // most recently used goes last
    } else {
      const changed = Object.entries(values).filter(([path, value]) => atPath(feature, path) !== value);
      const resolved = changed.reduce((f, [path, value]) => withPath(f, path, value), feature);
      resolution = { feature: resolved, values, ...(Object.keys(errors).length ? { errors } : {}) };
      if (known.size >= RESOLUTIONS_KEPT) known.delete(known.keys().next().value as string);
    }
    known.set(key, resolution);
    return resolution;
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
    const environment = evaluateParameters(doc.parameters);
    for (const feature of doc.features) {
      const dragged = options.drag && options.drag.sketch === feature.id ? options.drag : undefined;
      const resolution = this.resolve(feature, environment);
      let step: Step | undefined = dragged ? undefined : this.memo.get(resolution)?.get(state);
      if (!step) {
        step = this.step(resolution, state, doc.settings.chordTolerance, dragged);
        if (!dragged) this.remember(resolution, state, step);
      }
      if (step.writeBack || resolution.feature !== feature) {
        writeBacks.set(feature.id, { feature: resolution.feature, ...(step.writeBack ? { solved: step.writeBack } : {}) });
        trace.set(feature.id, { before: state, after: step.state }); // pro převěšení cache po zápisu výsledku
      }
      state = step.state;
      if (feature.id === options.upTo) break;
    }
    return { state, writeBacks, trace };
  }

  // Writing the result back creates a new feature object. The cache entry is re-hung onto it: on
  // a recompute the new object would use the stored variables and expression values and give exactly
  // the same state.
  rehang(doc: Document, replaced: Map<Id, Feature>, trace: Trace): void {
    const environment = evaluateParameters(doc.parameters);
    for (const [id, feature] of replaced) {
      const record = trace.get(id);
      if (record) this.remember(this.resolve(feature, environment), record.before, { state: record.after });
    }
  }

  private remember(resolution: Resolution, before: State, step: Step): void {
    let map = this.memo.get(resolution);
    if (!map) this.memo.set(resolution, (map = new WeakMap()));
    map.set(before, step);
  }

  private step(resolution: Resolution, state: State, chordTolerance: number, drag?: DragTarget): Step {
    const { feature, errors } = resolution;
    // Expression values and errors belong to the feature result in every state, suppressed included.
    const fields = { ...(resolution.values && Object.keys(resolution.values).length ? { values: resolution.values } : {}), ...(errors ? { fieldErrors: errors } : {}) };
    const done = (result: FeatureResult, change: Partial<State> = {}): State => ({ ...state, ...change, features: { ...state.features, [feature.id]: { ...result, ...fields } } });
    const failed = (code: IssueCode, refs?: unknown[], detail?: string): Step => ({ state: done({ status: 'error', error: issue(code, refs, detail), warnings: [] }) });
    // Potlačená feature je prázdná operace; co na ní závisí, skončí v chybě.
    if (feature.suppressed) return { state: done({ status: 'suppressed', warnings: [] }) };
    // A bad expression is an error of the feature. A sketch is the exception: it is computed with the
    // last valid value and reports a warning, so that it stays visible, can be fixed and everything
    // built on it does not fail.
    if (errors && feature.type !== 'sketch') return failed('invalidExpression', Object.keys(errors));
    // Krok podle typu feature; úplnost hlídá překladač (viz registr typů v document.ts).
    switch (feature.type) {
      case 'plane':
        return this.plane(feature, state, done, failed);
      case 'sketch':
        return this.sketch(feature, state, chordTolerance, drag, done, failed, errors ? Object.keys(errors) : []);
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

  private sketch(feature: SketchFeature, state: State, chordTolerance: number, drag: DragTarget | undefined, done: Done, failed: Failed, badFields: FieldPath[]): Step {
    const frame = this.frame(feature.plane, state);
    if (typeof frame === 'string') return failed(frame, [feature.plane]);
    const warnings: Issue[] = badFields.length ? [issue('invalidExpression', badFields, 'the dimension keeps its last valid value')] : [];

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
    let writeBack: SolvedSketch | undefined;
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
    // The tool: the length of "through all" is measured against the targets it is built for.
    const build: ToolRecipe['build'] = (targets, firstFaceId) =>
      buildPrism(feature.id, profile.regions, profile.frame, toolSpan(feature.extent, profile.frame, targets), profile.curveOf, firstFaceId, this.deps.kernel);
    if (feature.operation !== 'new') return this.applyTool(feature.id, { operation: feature.operation, targets: feature.targets ?? [], build }, state, done, failed);
    const first = state.faceNames.length;
    let tool: Prism;
    try {
      tool = build([], first);
    } catch (error) {
      return failed('kernelFailure', undefined, error instanceof Error ? error.message : String(error));
    }
    return { state: done({ status: 'ok', warnings: [] }, { ...withFaces(state, tool, first), bodies: { ...state.bodies, [feature.id]: tool.solid } }) };
  }

  // Applies a tool to its targets: a boolean operation with each of them. It works from the recipe
  // alone, so any feature that produces a tool (an extrusion today) is applied the same way.
  // - A missing target is a broken reference.
  // - A cut that would remove a whole target is an error and changes none of them.
  // - Targets the tool did not change are named in the `noEffect` warning; the recipe is stored even
  //   then, because a copy in a pattern can hit what the original missed.
  private applyTool(id: Id, recipe: ToolRecipe, state: State, done: Done, failed: Failed): Step {
    const missing = recipe.targets.filter((target) => !lookup(state.bodies, target));
    if (missing.length || recipe.targets.length === 0) return failed('brokenReference', missing.length ? missing : [recipe.targets]);
    const first = state.faceNames.length;
    const bodies = { ...state.bodies };
    const unchanged: Id[] = [];
    let tool: Prism;
    try {
      tool = recipe.build(recipe.targets.map((target) => state.bodies[target]), first);
      for (const target of recipe.targets) {
        const before = state.bodies[target];
        const result = this.deps.kernel.boolean(recipe.operation === 'add' ? 'union' : 'difference', before, tool.solid);
        if (result.triangles.length === 0) return failed('emptyResult', [target]);
        // Bez účinku: objem se nezměnil. U výřezu navíc ve výsledku nesmí být žádná stěna nástroje;
        // u přidání být může (nástroj uvnitř tělesa, jehož stěna lícuje se stěnou tělesa, ji přejmenuje).
        // Změna objemu se měří proti menšímu z obou těles: drobný výstupek na velké desce účinek má.
        const volume = volumeOf(before);
        const scale = Math.min(Math.abs(volume), Math.abs(volumeOf(tool.solid)));
        const sameVolume = Math.abs(volumeOf(result) - volume) <= 1e-6 * Math.max(1, scale);
        if (sameVolume && (recipe.operation === 'add' || !result.faceIds.some((face) => face >= first))) unchanged.push(target);
        else bodies[target] = result;
      }
    } catch (error) {
      return failed('kernelFailure', undefined, error instanceof Error ? error.message : String(error));
    }
    const tools = { ...state.tools, [id]: recipe };
    const warnings = unchanged.length ? [issue('noEffect', unchanged)] : [];
    // Nothing changed: the tool's faces are in no body, so they do not enter the table either.
    if (unchanged.length === recipe.targets.length) return { state: done({ status: 'warning', warnings }, { tools }) };
    return { state: done({ status: warnings.length ? 'warning' : 'ok', warnings }, { ...withFaces(state, tool, first), tools, bodies }) };
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

// The face tables of a state with the faces of a new tool appended.
function withFaces(state: State, tool: Prism, first: number): Pick<State, 'faceNames' | 'faceInfos' | 'faceIds'> {
  return {
    faceNames: [...state.faceNames, ...tool.faces.map((f) => f.name)],
    faceInfos: [...state.faceInfos, ...tool.faces.map((f) => f.info)],
    faceIds: new Map([...state.faceIds, ...tool.faces.map((f, i): [string, number] => [faceKey(f.name), first + i])]),
  };
}

// The interval of the tool along the normal of the sketch plane, measured from the plane: [start,
// end]. "Through all" takes the extent of all targets together along the normal (their vertices
// projected onto it) and adds an overshoot, so that the cap of the tool does not lie in a face of
// a body. The overshoot follows the size of the targets and stays far above the resolution of the
// kernel adapter (about 1e-4 of the largest coordinate), which would otherwise treat it as flush.
// A side on which the targets do not reach gets just the overshoot: the tool then misses them and
// the feature reports `noEffect`.
function toolSpan(extent: ExtrudeFeature['extent'], frame: Frame, targets: Solid[]): [number, number] {
  if (extent.type === 'distance') return [extent.start, extent.start + extent.distance];
  let [low, high, reach] = [0, 0, 0];
  for (const solid of targets) {
    const p = solid.positions;
    for (let i = 0; i < p.length; i += 3) {
      const along = (p[i] - frame.origin[0]) * frame.normal[0] + (p[i + 1] - frame.origin[1]) * frame.normal[1] + (p[i + 2] - frame.origin[2]) * frame.normal[2];
      low = Math.min(low, along);
      high = Math.max(high, along);
      reach = Math.max(reach, Math.abs(p[i]), Math.abs(p[i + 1]), Math.abs(p[i + 2]));
    }
  }
  const overshoot = Math.max(1, 0.01 * reach);
  if (extent.side === 'forward') return [0, high + overshoot];
  if (extent.side === 'backward') return [0, low - overshoot];
  return [low - overshoot, high + overshoot];
}

type Done = (result: FeatureResult, change?: Partial<State>) => State;
type Failed = (code: IssueCode, refs?: unknown[], detail?: string) => Step;

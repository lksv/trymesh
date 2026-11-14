// Přepočet: přehrání časové osy s memoizací. Pravidla jsou v docs/architecture.md, sekce Přepočet.
import { SketchAnalysis } from './analysis';
import { checkNumber } from './catalog';
import { atPath, constraintOperands, fieldsOf, withPath } from './document';
import { type Environment, evaluateCheck, evaluateNumber, evaluateParameters } from './expression';
import { GENERATORS, type ResolvedOperand, generateProfile } from './generators';
import { type Loop, type Profile, type Region, type SketchGeometry, detectProfile, measure, ownVariables, sameRegion, solverSetup } from './sketch';
import { type FaceInfo, type Prism, type RigidTransform, type SideCurve, analyzeBody, buildPrism, faceFrame, projectEdge, rotation, onSurface, toWorld, transformFace, transformFrame, transformSolid, volumeOf } from './solid';
import type {
  CopyTag,
  Document,
  Evaluation,
  ExpressionError,
  ExtrudeFeature,
  FaceName,
  Facts,
  Feature,
  FeatureResult,
  FieldPath,
  Frame,
  Id,
  Issue,
  IssueCode,
  PatternFeature,
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
  Vec3,
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
  // `placement`: where a copy made by a pattern stands and how its faces are tagged. The tool is
  // built there, not moved afterwards, so that what depends on the targets is measured in the
  // direction the copy points in.
  build(targets: Solid[], firstFaceId: number, placement?: Placement): Prism;
}
export interface Placement {
  transform: RigidTransform;
  copy: CopyTag;
}

// The part of the state a tool changes: bodies and the face table.
type Model = Pick<State, 'bodies' | 'faceNames' | 'faceInfos' | 'faceIds'>;
// The model after a tool was applied and the targets it did not change, or why it could not be applied.
type Applied = { ok: true; model: Model; unchanged: Id[] } | { ok: false; code: IssueCode; refs?: unknown[]; detail?: string };

// Vyhodnocený profil vysunutí: oblasti v rovině skici a popis křivek, ze kterých vznikají boční stěny.
// A generated profile adds what its generator published and warned about.
interface ResolvedProfile {
  regions: Region[];
  frame: Frame;
  curveOf: (id: Id) => SideCurve;
  facts?: Facts;
  warnings?: Issue[];
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
  gearMesh: 'The gear cannot be put in mesh with the gear it refers to.',
  gearInterference: 'The tip of one gear of the pair runs into the root of the other.',
  invalidExpression: 'The expression of a numeric field cannot be evaluated or gives a value outside the range of the field.',
};
const issue = (code: IssueCode, refs?: unknown[], detail?: string): Issue => ({ code, message: detail ? `${MESSAGE[code]} (${detail})` : MESSAGE[code], ...(refs ? { refs } : {}) });

// The largest coordinate of a solid: the scale its float32 positions are precise to.
const reach = (s: Solid): number => s.positions.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

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
    const done: Done = (result, change = {}) => ({ ...state, ...change, features: { ...state.features, [feature.id]: { bodies: [], ...result, ...fields } } });
    const failed: Failed = (code, refs, detail) => ({ state: done({ status: 'error', error: issue(code, refs, detail), warnings: [] }) });
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
        return this.extrude(feature, state, chordTolerance, done, failed);
      case 'pattern':
        return this.pattern(feature, state, done, failed);
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
      bodies: [],
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
  private extrude(feature: ExtrudeFeature, state: State, chordTolerance: number, finish: Done, failed: Failed): Step {
    const profile = this.profile(feature, state, chordTolerance);
    // a generator explains its failure itself; the general text of the code is about sketch curves
    if ('code' in profile) return profile.message === undefined ? failed(profile.code, profile.refs) : { state: finish({ status: 'error', error: { code: profile.code, message: profile.message, refs: profile.refs }, warnings: [] }) };
    // What the profile generator published and warned about belongs to the result whatever the
    // application of the tool ends with, short of an error.
    const done: Done = (result, change) => {
      const warnings = [...(profile.warnings ?? []), ...result.warnings];
      return finish({ ...result, status: result.status === 'ok' && warnings.length ? 'warning' : result.status, warnings, ...(profile.facts ? { facts: profile.facts } : {}) }, change);
    };
    // The tool: the length of "through all" is measured against the targets it is built for, and
    // a copy of a pattern is built in its own position. The planar triangulation is shared by all builds.
    const triangulation = new Map<Region, Uint32Array>();
    const build: ToolRecipe['build'] = (targets, firstFaceId, placement) => {
      const frame = placement ? transformFrame(placement.transform, profile.frame) : profile.frame;
      const prism = buildPrism(feature.id, profile.regions, frame, toolSpan(feature.extent, frame, targets), profile.curveOf, firstFaceId, this.deps.kernel, triangulation);
      return placement ? { ...prism, faces: prism.faces.map((face) => ({ ...face, name: { ...face.name, copy: [placement.copy] } })) } : prism;
    };
    if (feature.operation !== 'new') {
      const recipe: ToolRecipe = { operation: feature.operation, targets: feature.targets ?? [], build };
      const applied = this.applyTool(recipe, state);
      if (!applied.ok) return failed(applied.code, applied.refs, applied.detail);
      // The recipe is stored even when nothing changed: a copy in a pattern can hit what the original missed.
      const tools = { ...state.tools, [feature.id]: recipe };
      const { unchanged } = applied;
      if (unchanged.length === recipe.targets.length) return { state: done({ status: 'warning', warnings: [issue('noEffect', unchanged)] }, { tools }) };
      // Only some targets were missed: the general text would read as if nothing had happened.
      const warnings = unchanged.length ? [issue('noEffect', unchanged, 'only the targets in refs; the others were changed')] : [];
      return { state: done({ status: warnings.length ? 'warning' : 'ok', warnings }, { ...applied.model, tools }) };
    }
    const first = state.faceNames.length;
    let tool: Prism;
    try {
      tool = build([], first);
    } catch (error) {
      return failed('kernelFailure', undefined, error instanceof Error ? error.message : String(error));
    }
    return { state: done({ status: 'ok', warnings: [], bodies: [feature.id] }, { ...withFaces(state, tool, first), bodies: { ...state.bodies, [feature.id]: tool.solid } }) };
  }

  // Applies a tool to its targets: a boolean operation with each of them. It works from the recipe
  // alone, so any feature that produces a tool (an extrusion today) is applied the same way, and
  // a pattern applies it again in another placement.
  // - A missing target is a broken reference.
  // - A cut that would remove a whole target is an error and changes none of them.
  // - Targets the tool did not change are returned in `unchanged`. When it changed none, its faces
  //   are in no body and do not enter the face table either.
  private applyTool(recipe: ToolRecipe, model: Model, placement?: Placement): Applied {
    const missing = recipe.targets.filter((target) => !lookup(model.bodies, target));
    if (missing.length || recipe.targets.length === 0) return { ok: false, code: 'brokenReference', refs: missing.length ? missing : [recipe.targets] };
    const first = model.faceNames.length;
    const bodies = { ...model.bodies };
    const unchanged: Id[] = [];
    let tool: Prism;
    try {
      tool = recipe.build(recipe.targets.map((target) => model.bodies[target]), first, placement);
      for (const target of recipe.targets) {
        const before = model.bodies[target];
        const result = this.deps.kernel.boolean(recipe.operation === 'add' ? 'union' : 'difference', before, tool.solid);
        if (result.triangles.length === 0) return { ok: false, code: 'emptyResult', refs: [target] };
        // Bez účinku: objem se nezměnil. U výřezu navíc ve výsledku nesmí být žádná stěna nástroje;
        // u přidání být může (nástroj uvnitř tělesa, jehož stěna lícuje se stěnou tělesa, ji přejmenuje).
        // Změna objemu se měří proti menšímu z obou těles: drobný výstupek na velké desce účinek má.
        // A cut copy of a pattern has no effect also when faces of its tool are in the result but
        // the shape is what it was: a copy that lands on what is cut already (five copies over
        // 360°) would otherwise only take the faces of the original over, silently. The shape is
        // what it was when every face of the tool in the result lies on the surface the target had;
        // the volume alone does not say it, because its tolerance grows with the bodies and a copy
        // that cuts a small corner off a large plate does have an effect.
        const volume = volumeOf(before);
        const scale = Math.min(Math.abs(volume), Math.abs(volumeOf(tool.solid)));
        const sameVolume = Math.abs(volumeOf(result) - volume) <= 1e-6 * Math.max(1, scale);
        const renamedOnly = () => placement !== undefined && onSurface(result, first, before, 1e-5 * Math.max(1, reach(before)));
        if (sameVolume && (recipe.operation === 'add' || !result.faceIds.some((face) => face >= first) || renamedOnly())) unchanged.push(target);
        else bodies[target] = result;
      }
    } catch (error) {
      return { ok: false, code: 'kernelFailure', detail: error instanceof Error ? error.message : String(error) };
    }
    if (unchanged.length === recipe.targets.length) return { ok: true, model, unchanged };
    return { ok: true, model: { ...withFaces(model, tool, first), bodies }, unchanged };
  }

  // A pattern: the transforms of its copies, then either the tools of the source features applied
  // in each of them, or the source body copied into each of them. The rest of the step does not
  // know what kind of transform it is.
  private pattern(feature: PatternFeature, state: State, done: Done, failed: Failed): Step {
    const transforms = this.transforms(feature.transform, state);
    if ('code' in transforms) return failed(transforms.code, transforms.refs);
    const placements = transforms.map((transform, i): Placement => ({ transform, copy: { pattern: feature.id, index: i + 1 } }));
    const { source } = feature;

    if (source.type === 'body') {
      const solid = lookup(state.bodies, source.body);
      if (!solid) return failed('brokenReference', [source.body]);
      // Every face the body has at this moment (faces of several features, of earlier patterns too)
      // gets a new number for each copy, with the copy tag appended to its name and its description
      // moved with the copy.
      const faces = [...new Set(solid.faceIds)].sort((a, b) => a - b);
      const model: Model = { bodies: { ...state.bodies }, faceNames: [...state.faceNames], faceInfos: [...state.faceInfos], faceIds: new Map(state.faceIds) };
      const created: Id[] = [];
      for (const { transform, copy } of placements) {
        const renumbered = new Map<number, number>();
        for (const face of faces) {
          const name: FaceName = { ...state.faceNames[face], copy: [...(state.faceNames[face].copy ?? []), copy] };
          renumbered.set(face, model.faceNames.length);
          model.faceIds.set(faceKey(name), model.faceNames.length);
          model.faceNames.push(name);
          model.faceInfos.push(transformFace(transform, state.faceInfos[face]));
        }
        const id = `${feature.id}/${copy.index}`;
        model.bodies[id] = transformSolid(transform, solid, (face) => renumbered.get(face) as number);
        created.push(id);
      }
      return { state: done({ status: 'ok', warnings: [], bodies: created }, model) };
    }

    // Features: a source that is missing, suppressed or in error has no recipe. A source that ended
    // with `noEffect` has one, because a turned copy can hit what the original missed.
    const missing = source.features.filter((id) => !lookup(state.tools, id));
    if (missing.length) return failed('brokenReference', missing);
    let model: Model = state;
    const idle: { copy: number; feature: Id; targets: Id[] }[] = [];
    for (const placement of placements) {
      for (const id of source.features) {
        const applied = this.applyTool(state.tools[id], model, placement);
        // The pattern is atomic: one failed copy and the model stays as it was before the pattern.
        // The copy is named by the first of `refs`, not in the text: a client names it its own way.
        if (!applied.ok) return failed(applied.code, [{ copy: placement.copy.index, feature: id }, ...(applied.refs ?? [])], applied.detail);
        if (applied.unchanged.length) idle.push({ copy: placement.copy.index, feature: id, targets: applied.unchanged });
        model = applied.model;
      }
    }
    const warnings = idle.length ? [issue('noEffect', idle, 'some copies changed none or only some of their targets')] : [];
    return { state: done({ status: warnings.length ? 'warning' : 'ok', warnings }, model) };
  }

  // The transforms of the copies of a pattern, the original excluded: copy 1 first.
  private transforms(transform: PatternFeature['transform'], state: State): RigidTransform[] | { code: IssueCode; refs: unknown[] } {
    const { axis, count, span } = transform;
    let point: Vec3 = [0, 0, 0];
    let direction: Vec3 = axis.kind === 'base' ? [axis.axis === 'X' ? 1 : 0, axis.axis === 'Y' ? 1 : 0, axis.axis === 'Z' ? 1 : 0] : [0, 0, 1];
    if (axis.kind === 'sketchPoint') {
      const sketch = lookup(state.sketches, axis.sketch);
      if (!sketch) return { code: 'brokenReference', refs: [axis.sketch] };
      const at = lookup(sketch.geometry.points, axis.point);
      if (!at) return { code: 'brokenReference', refs: [axis.point] };
      point = toWorld(sketch.frame, at.x, at.y);
      direction = sketch.frame.normal;
    }
    // full circle: the copies divide it evenly; an angle: it lies between the first and the last copy
    const step = span.type === 'full' ? (2 * Math.PI) / count : count > 1 ? span.angle / (count - 1) : 0;
    return Array.from({ length: count - 1 }, (_, i) => rotation(point, direction, step * (i + 1)));
  }

  // Profil vysunutí podle jeho zdroje.
  private profile(feature: ExtrudeFeature, state: State, chordTolerance: number): ResolvedProfile | { code: IssueCode; refs: unknown[]; message?: string } {
    const source = feature.profile;
    const sketch = lookup(state.sketches, source.sketch);
    if (!sketch) return { code: 'brokenReference', refs: [source.sketch] };
    if (source.type === 'generated') return this.generated(feature.id, source, sketch, state, chordTolerance);
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

  // A profile from a generator. The generator reads only the solved operands, so it does not depend
  // on the sketch profile being valid: the pitch circles of gears in mesh touch, which would
  // invalidate it if they were not construction geometry.
  private generated(id: Id, source: Extract<ExtrudeFeature['profile'], { type: 'generated' }>, sketch: SketchState, state: State, chordTolerance: number): ResolvedProfile | { code: IssueCode; refs: unknown[]; message?: string } {
    const spec = GENERATORS[source.generator];
    const { points, radii } = sketch.geometry;
    const operands: Record<string, ResolvedOperand> = {};
    for (const { field } of spec.operands) {
      // own curves and projected ones; validation let only the kinds of the catalog in (circles today)
      const entity = source.operands[field];
      const curve = lookup(sketch.input.curves, entity);
      const center = curve?.type === 'circle' ? lookup(points, curve.center) : undefined;
      const radius = lookup(radii, entity);
      if (!center || radius === undefined) return { code: 'brokenReference', refs: [entity] };
      operands[field] = { kind: 'circle', center: [center.x, center.y], radius };
    }
    // facts of the features referred to; a feature that is missing, suppressed or in error has none
    const refs = Object.fromEntries(Object.entries(source.refs ?? {}).map(([name, feature]) => [name, lookup(state.features, feature)?.facts]));
    let result: ReturnType<typeof generateProfile>;
    try {
      result = generateProfile(source.generator, { operands, params: source.params, refs, frame: sketch.frame, chordTolerance });
    } catch (error) {
      return { code: 'invalidProfile', refs: [id], message: `The profile generator failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!result.ok) return { code: 'invalidProfile', refs: [id], message: `The profile generator cannot build the profile: ${result.message}.` };
    // Regions in the shape the prism builder takes: every vertex has its own key and every edge the
    // name of its side in place of a curve ID.
    const loop = (generated: { xy: number[]; side: string }, tag: string): Loop => {
      const count = generated.xy.length / 2;
      return { xy: generated.xy, keys: Array.from({ length: count }, (_, i) => `g:${tag}:${i}`), curves: Array.from({ length: count }, () => generated.side) };
    };
    const regions = result.regions.map((region, r): Region => ({ ref: { outerLoop: [region.outer.side] }, outer: loop(region.outer, `${r}`), holes: region.holes.map((hole, h) => loop(hole, `${r}:${h}`)) }));
    const warnings = result.warnings.map((warning) => issue(warning.code, warning.refs, warning.detail));
    return { regions, frame: sketch.frame, curveOf: () => ({ type: 'general' }), facts: result.facts, warnings };
  }
}

// The face tables of a model with the faces of a new tool appended.
function withFaces(state: Model, tool: Prism, first: number): Pick<State, 'faceNames' | 'faceInfos' | 'faceIds'> {
  return {
    faceNames: [...state.faceNames, ...tool.faces.map((f) => f.name)],
    faceInfos: [...state.faceInfos, ...tool.faces.map((f) => f.info)],
    faceIds: new Map([...state.faceIds, ...tool.faces.map((f, i): [string, number] => [faceKey(f.name), first + i])]),
  };
}

// The interval of the tool along the normal of the sketch plane, measured from the plane: [start,
// end]. "Through all" takes the extent of all targets together along the normal (their vertices
// projected onto it) and adds an overshoot, so that the cap of the tool does not lie in a face of
// a body. The overshoot follows the largest coordinate of the targets and of the sketch plane, so
// it normally stays far above the resolution of the kernel adapter (about 1e-4 of the largest
// coordinate of body and tool). Where it does not (a profile much larger than the targets), the
// adapter takes the cap as flush with the face, which it handles like any flush face.
// A side on which the targets do not reach gets just the overshoot: the tool then misses them and
// the feature reports `noEffect`.
function toolSpan(extent: ExtrudeFeature['extent'], frame: Frame, targets: Solid[]): [number, number] {
  if (extent.type === 'distance') return [extent.start, extent.start + extent.distance];
  let [low, high, reach] = [0, 0, Math.max(...frame.origin.map(Math.abs))];
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

// `bodies` of a result may be left out: most steps create none.
type Done = (result: Omit<FeatureResult, 'bodies'> & { bodies?: Id[] }, change?: Partial<State>) => State;
type Failed = (code: IssueCode, refs?: unknown[], detail?: string) => Step;

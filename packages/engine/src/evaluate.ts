// Přepočet: přehrání časové osy s memoizací. Pravidla jsou v docs/architecture.md, sekce Přepočet.
import { SketchAnalysis } from './analysis';
import { checkNumber } from './catalog';
import { atPath, constraintOperands, fieldsOf, withPath } from './document';
import { type Environment, evaluateCheck, evaluateNumber, evaluateParameters } from './expression';
import { toolSpan } from './recompute/extent';
import { profile as resolveProfile } from './recompute/profile';
import { applyTool, axis, frame as frameOf, issue, lookup, withFaces } from './recompute/services';
import type { Deps, Done, DragTarget, Failed, Model, Placement, SketchState, SolvedSketch, State, Step, ToolRecipe, WriteBack } from './recompute/state';
import { type Region, type SketchGeometry, detectProfile, measure, ownVariables, solverSetup } from './sketch';
import { type Prism, type RigidTransform, analyzeBody, buildPrism, projectEdge, rotation, toWorld, transformFace, transformFrame, transformSolid } from './solid';
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
  PatternFeature,
  PlaneFeature,
  Projected,
  SketchFeature,
  SolveInput,
  SolveResult,
} from './types';
import { faceKey } from './util';

// The types of the state moved to recompute/state.ts; what the engine and the contracts import from
// here keeps its path.
export type { Deps, DragTarget, SketchState, WriteBack } from './recompute/state';

export interface EvaluateOptions {
  upTo?: Id; // skončit u této feature
  drag?: DragTarget; // tažení bodu, viz Řešení skici
}

// The state a feature's step started from and led to, for features whose result is written back to the document.
export type Trace = Map<Id, { before: State; after: State }>;

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

  private plane(feature: PlaneFeature, state: State, done: Done, failed: Failed): Step {
    const base = frameOf(feature.base, state);
    if (typeof base === 'string') return failed(base, [feature.base]);
    const frame: Frame = { ...base, origin: toWorld(base, 0, 0, feature.offset) };
    return { state: done({ status: 'ok', warnings: [], plane: frame }, { planes: { ...state.planes, [feature.id]: frame } }) };
  }

  private sketch(feature: SketchFeature, state: State, chordTolerance: number, drag: DragTarget | undefined, done: Done, failed: Failed, badFields: FieldPath[]): Step {
    const frame = frameOf(feature.plane, state);
    if (typeof frame === 'string') return failed(frame, [feature.plane]);
    const warnings: Issue[] = badFields.length ? [issue('invalidExpression', badFields, 'the field keeps its last valid value')] : [];

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
    const profile = resolveProfile(feature.id, feature.profile, state, chordTolerance);
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
      const applied = applyTool(recipe, state, this.deps.kernel);
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
        const applied = applyTool(state.tools[id], model, this.deps.kernel, placement);
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
    const { count, span } = transform;
    const line = axis(transform.axis, state);
    if ('code' in line) return line;
    const { point, direction } = line;
    // full circle: the copies divide it evenly; an angle: it lies between the first and the last copy
    const step = span.type === 'full' ? (2 * Math.PI) / count : count > 1 ? span.angle / (count - 1) : 0;
    return Array.from({ length: count - 1 }, (_, i) => rotation(point, direction, step * (i + 1)));
  }
}


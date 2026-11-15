// Přepočet: přehrání časové osy s memoizací. Pravidla jsou v docs/architecture.md, sekce Přepočet.
import { checkNumber } from './catalog';
import { atPath, fieldsOf, withPath } from './document';
import { type Environment, evaluateCheck, evaluateNumber, evaluateParameters } from './expression';
import { specOf } from './features/index';
import { issue, lookup } from './recompute/services';
import type { Deps, Done, DragTarget, Failed, SketchState, State, Step, WriteBack } from './recompute/state';
import { analyzeBody } from './solid';
import type { Document, Evaluation, ExpressionError, Feature, FieldPath, Id } from './types';

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
        step = this.step(resolution, state, doc.settings, dragged);
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

  private step(resolution: Resolution, state: State, settings: Document['settings'], drag?: DragTarget): Step {
    const { feature, errors } = resolution;
    // Expression values and errors belong to the feature result in every state, suppressed included.
    const fields = { ...(resolution.values && Object.keys(resolution.values).length ? { values: resolution.values } : {}), ...(errors ? { fieldErrors: errors } : {}) };
    const done: Done = (result, change = {}) => ({ ...state, ...change, features: { ...state.features, [feature.id]: { bodies: [], ...result, ...fields } } });
    const failed: Failed = (code, refs, detail) => ({ state: done({ status: 'error', error: issue(code, refs, detail), warnings: [] }) });
    // Potlačená feature je prázdná operace; co na ní závisí, skončí v chybě.
    if (feature.suppressed) return { state: done({ status: 'suppressed', warnings: [] }) };
    const spec = specOf(feature);
    // A bad expression is an error of the feature. A type that keeps the last valid values (the
    // sketch) is the exception: it is computed with them and reports a warning, so that it stays
    // visible, can be fixed and everything built on it does not fail.
    if (errors && !spec.keepsLastValidValues) return failed('invalidExpression', Object.keys(errors));
    // The step of the feature type. The registry is the one guard of completeness: an entry without
    // a step does not compile (features/index.ts).
    return spec.step(feature, { state, settings, deps: this.deps, done, failed, drag, badFields: errors ? Object.keys(errors) : [] });
  }

}


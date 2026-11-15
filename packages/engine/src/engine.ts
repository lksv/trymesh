// Fasáda enginu: příkazy, undo/redo, náhled, načtení a uložení, export.
import { CommandError, applyCommand, emptyDocument, validateDocument } from './document';
import { type DragTarget, type Deps, type EvaluateOptions, Evaluator, type WriteBack } from './evaluate';
import { has } from './util';
import { INTERFERENCE_THRESHOLD, checkInterferenceOptions } from './interference';
import { EXPORT_FORMATS, runExport } from './export/index';
import { type Internals, Memo, queryContext } from './query/context';
import { QUERIES, runQuery } from './query/index';
import type { Command, CommandResult, Document, Engine, EngineState, Evaluation, Feature, Id, QueryOptions, QueryOutcome } from './types';

export function createEngine(deps: Deps): Engine {
  const evaluator = new Evaluator(deps);
  // What a query needs beyond the evaluation: the state of the recompute it was made from and the
  // document it belongs to, kept for every evaluation the engine hands out. Kept weakly, so it
  // lives as long as a caller holds the state.
  const internals = new WeakMap<Evaluation, Internals>();
  const evaluate = (doc: Document, options?: EvaluateOptions) => {
    const result = evaluator.evaluate(doc, options);
    internals.set(result.evaluation, { document: doc, state: result.state });
    return result;
  };
  const queryDeps = { kernel: deps.kernel, memo: new Memo() };
  let document = emptyDocument();
  let evaluation: Evaluation = evaluate(document).evaluation;
  let undoStack: Document[] = [];
  let redoStack: Document[] = [];
  const listeners = new Set<(state: EngineState) => void>();

  // A state handed out. The document is the one the state shows: after a recompute wrote its
  // results back, that is the document with them.
  const state = (doc: Document, result: Evaluation): EngineState => {
    const kept = internals.get(result);
    if (kept) kept.document = doc;
    return { document: doc, evaluation: result, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
  };
  // Posluchači dostanou stavy v pořadí, v jakém vznikly, i když některý z nich sám zavolá engine:
  // vnořená změna se rozešle až po dokončení právě běžícího kola. Výjimka posluchače ostatní
  // posluchače o zprávu nepřipraví; vyhodí se až nakonec (stav je v té chvíli už zapsaný).
  let notifying = false;
  let again = false;
  const notify = () => {
    if (notifying) {
      again = true;
      return;
    }
    notifying = true;
    const failures: unknown[] = [];
    try {
      do {
        again = false;
        const current = state(document, evaluation);
        for (const listener of [...listeners]) {
          try {
            listener(current);
          } catch (error) {
            failures.push(error);
          }
        }
      } while (again);
    } finally {
      notifying = false;
    }
    if (failures.length > 0) throw failures[0];
  };
  // Liší se dokumenty obsahem? Features se stejnou identitou se neporovnávají.
  const differs = (a: Document, b: Document): boolean =>
    a !== b &&
    (a.settings.chordTolerance !== b.settings.chordTolerance ||
      JSON.stringify([a.parameters, a.checks]) !== JSON.stringify([b.parameters, b.checks]) ||
      a.features.length !== b.features.length ||
      a.features.some((feature, i) => feature !== b.features[i] && JSON.stringify(feature) !== JSON.stringify(b.features[i])));
  const invalid = (error: unknown, code: 'invalidCommand' | 'invalidDocument'): CommandResult => {
    if (!(error instanceof CommandError) && !(error instanceof SyntaxError)) throw error;
    const commandIndex = error instanceof CommandError ? error.commandIndex : undefined;
    const expression = error instanceof CommandError ? error.expression : undefined;
    return { ok: false, error: { code, message: error.message, ...(commandIndex === undefined ? {} : { commandIndex }), ...(expression ? { expression } : {}) } };
  };
  const dragOf = (cmd: Command): DragTarget | undefined => (cmd.type === 'dragPoint' ? { sketch: cmd.sketch, point: cmd.point, target: { x: cmd.x, y: cmd.y } } : undefined);

  // Recomputes the document and writes back what the recompute determined: expression values in
  // numeric fields and, for sketches solved along the way, the solved variables and the stamp. The
  // cache is re-hung onto the new feature objects.
  const settle = (doc: Document, drag?: DragTarget): { document: Document; evaluation: Evaluation } => {
    const { evaluation: result, writeBacks, trace } = evaluate(doc, { drag });
    if (writeBacks.size === 0) return { document: doc, evaluation: result };
    const replaced = new Map<Id, Feature>();
    const features = doc.features.map((feature) => {
      const written: WriteBack | undefined = writeBacks.get(feature.id);
      if (!written) return feature;
      const next = { ...written.feature, ...written.solved } as Feature;
      replaced.set(feature.id, next);
      return next;
    });
    const document = { ...doc, features };
    evaluator.rehang(document, replaced, trace);
    return { document, evaluation: result };
  };
  const commit = (next: { document: Document; evaluation: Evaluation }) => {
    document = next.document;
    evaluation = next.evaluation;
  };

  const stateAt = (at?: Id): EngineState => {
    if (at !== undefined && !document.features.some((feature) => feature.id === at)) throw new Error(`getState: feature "${at}" neexistuje`);
    return state(document, at === undefined ? evaluation : evaluate(document, { upTo: at }).evaluation);
  };

  // The state a query or an export is asked about: the current one, the one after `at`, or one this
  // engine handed out. The document is the one kept with the evaluation, not `state.document`, so
  // an evaluation cannot be paired with another document.
  const askedState = (name: string, options: QueryOptions): { evaluation: Evaluation; internals: Internals } | QueryOutcome<never> => {
    const refused = (code: 'invalidArguments' | 'notAvailable', message: string, arg: string): QueryOutcome<never> => ({ ok: false, error: { code, message, arg: [arg] } });
    let asked: Evaluation;
    if (typeof options !== 'object' || options === null) return refused('invalidArguments', `${name}: the options are an object with \`at\` or \`state\``, 'options');
    if (options.state !== undefined) {
      if (options.at !== undefined) return refused('invalidArguments', `${name}: \`at\` or \`state\` is given, not both`, 'state');
      if (typeof options.state !== 'object' || options.state === null || !internals.has(options.state.evaluation)) return refused('invalidArguments', `${name}: \`state\` is not a state this engine handed out`, 'state');
      asked = options.state.evaluation;
    } else if (options.at !== undefined) {
      if (!document.features.some((feature) => feature.id === options.at)) return refused('notAvailable', `${name}: \`at\`: the feature "${String(options.at)}" is not in the document`, 'at');
      asked = stateAt(options.at).evaluation;
    } else asked = stateAt().evaluation;
    return { evaluation: asked, internals: internals.get(asked) as Internals };
  };

  // The methods that were queries before the catalog keep their own checks and their own texts,
  // and throw; then they run the entry of the catalog that `query` runs, over the same context.
  const contextOf = (name: string, of: EngineState) => queryContext(name, of.evaluation, internals.get(of.evaluation) as Internals, queryDeps);
  const sketchOf = (id: Id, what: string): void => {
    if (!document.features.some((feature) => feature.id === id && feature.type === 'sketch')) throw new Error(`${what}: skica "${id}" neexistuje`);
  };

  return {
    execute(cmd) {
      let applied: Document;
      try {
        applied = applyCommand(document, cmd);
      } catch (error) {
        return invalid(error, 'invalidCommand');
      }
      const drag = dragOf(cmd);
      const next = settle(applied, drag);
      // Krok undo vzniká jen změnou obsahu: přejmenování na stejné jméno nebo tažení plně určeného
      // bodu historii nezaplní. Tažení, které dokument nezměnilo (solver cíl nevyřešil), nechává
      // i předchozí vyhodnocení, aby v něm nezůstal konflikt z neúspěšného pokusu.
      const changed = differs(next.document, document);
      if (changed) {
        undoStack = [...undoStack, document];
        redoStack = [];
      }
      if (changed || !drag) commit(next);
      notify();
      return { ok: true, state: state(document, evaluation) };
    },

    preview(cmd, at) {
      let applied: Document;
      try {
        applied = applyCommand(document, cmd);
      } catch (error) {
        return invalid(error, 'invalidCommand');
      }
      if (at !== undefined && !applied.features.some((feature) => feature.id === at)) {
        return { ok: false, error: { code: 'invalidCommand', message: `preview: feature "${at}" v dokumentu po příkazu není` } };
      }
      return { ok: true, state: state(applied, evaluate(applied, { upTo: at, drag: dragOf(cmd) }).evaluation) };
    },

    undo() {
      const previous = undoStack[undoStack.length - 1];
      if (!previous) return;
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, document];
      commit({ document: previous, evaluation: evaluate(previous).evaluation });
      notify();
    },

    redo() {
      const next = redoStack[redoStack.length - 1];
      if (!next) return;
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack, document];
      commit({ document: next, evaluation: evaluate(next).evaluation });
      notify();
    },

    getState: stateAt,

    diagnoseSketch(id) {
      sketchOf(id, 'diagnoseSketch');
      return QUERIES.sketchDiagnosis.run(contextOf('sketchDiagnosis', stateAt()), { sketch: id });
    },

    explainConstraint(id, constraint) {
      sketchOf(id, 'explainConstraint');
      const feature = document.features.find((f) => f.id === id);
      if (feature?.type !== 'sketch' || !has(feature.constraints, constraint)) throw new Error(`explainConstraint: vazba "${constraint}" ve skice "${id}" není`);
      return QUERIES.constraintExplanation.run(contextOf('constraintExplanation', stateAt()), { sketch: id, constraint });
    },

    load(json) {
      let loaded: Document;
      try {
        loaded = validateDocument(JSON.parse(json));
      } catch (error) {
        return invalid(error, 'invalidDocument');
      }
      const next = settle(loaded); // selže-li přepočet výjimkou, engine zůstane v původním stavu
      undoStack = [];
      redoStack = [];
      commit(next);
      notify();
      return { ok: true, state: state(document, evaluation) };
    },

    save() {
      return JSON.stringify(document);
    },

    // Without a list all bodies, otherwise the listed ones in the order of the list, each once.
    exportMesh(format, bodies) {
      if (format !== 'stl') throw new Error(`export: formát ${String(format)} není podporovaný`);
      const all = evaluation.bodies;
      if (bodies !== undefined && (!Array.isArray(bodies) || bodies.some((id) => typeof id !== 'string'))) throw new Error('exportMesh: bodies is a list of body IDs');
      for (const id of bodies ?? []) if (!has(all, id)) throw new Error(`exportMesh: the body "${id}" does not exist`);
      // the entry of the catalog that `export` runs: one file with the chosen bodies
      return EXPORT_FORMATS.stl.run(contextOf('export:stl', stateAt()), bodies === undefined ? {} : { bodies }).files[0].bytes;
    },

    interference(options = {}) {
      const asked = stateAt(options.at);
      checkInterferenceOptions(asked.evaluation.bodies, options.bodies, options.threshold);
      return QUERIES.interference.run(contextOf('interference', asked), { ...(options.bodies === undefined ? {} : { bodies: options.bodies }), threshold: options.threshold ?? INTERFERENCE_THRESHOLD });
    },

    query(name, args, options = {}) {
      const asked = askedState(typeof name === 'string' ? name : 'query', options);
      return 'ok' in asked ? asked : (runQuery(name, args, asked.evaluation, asked.internals, queryDeps) as QueryOutcome<never>);
    },

    export(format, options, queryOptions = {}) {
      const asked = askedState(typeof format === 'string' ? format : 'export', queryOptions);
      return 'ok' in asked ? asked : runExport(format, options, asked.evaluation, asked.internals, queryDeps);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

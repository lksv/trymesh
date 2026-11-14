// Fasáda enginu: příkazy, undo/redo, náhled, načtení a uložení, export.
import { CommandError, applyCommand, emptyDocument, validateDocument } from './document';
import { type DragTarget, type Deps, Evaluator, type WriteBack } from './evaluate';
import { toStl } from './solid';
import type { Command, CommandResult, Document, Engine, EngineState, Evaluation, Feature, Id } from './types';

export function createEngine(deps: Deps): Engine {
  const evaluator = new Evaluator(deps);
  let document = emptyDocument();
  let evaluation: Evaluation = evaluator.evaluate(document).evaluation;
  let undoStack: Document[] = [];
  let redoStack: Document[] = [];
  const listeners = new Set<(state: EngineState) => void>();

  const state = (doc: Document, result: Evaluation): EngineState => ({ document: doc, evaluation: result, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
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
      a.features.length !== b.features.length ||
      a.features.some((feature, i) => feature !== b.features[i] && JSON.stringify(feature) !== JSON.stringify(b.features[i])));
  const invalid = (error: unknown, code: 'invalidCommand' | 'invalidDocument'): CommandResult => {
    if (!(error instanceof CommandError) && !(error instanceof SyntaxError)) throw error;
    const commandIndex = error instanceof CommandError ? error.commandIndex : undefined;
    return { ok: false, error: { code, message: error.message, ...(commandIndex === undefined ? {} : { commandIndex }) } };
  };
  const dragOf = (cmd: Command): DragTarget | undefined => (cmd.type === 'dragPoint' ? { sketch: cmd.sketch, point: cmd.point, target: { x: cmd.x, y: cmd.y } } : undefined);

  // Přepočítá dokument a zapíše do něj výsledek skic, které se při tom vyřešily (řešené proměnné
  // a razítko). Cache se převěsí na nové objekty features.
  const settle = (doc: Document, drag?: DragTarget): { document: Document; evaluation: Evaluation } => {
    const { evaluation: result, writeBacks, trace } = evaluator.evaluate(doc, { drag });
    if (writeBacks.size === 0) return { document: doc, evaluation: result };
    const replaced = new Map<Id, Feature>();
    const features = doc.features.map((feature) => {
      const solved: WriteBack | undefined = writeBacks.get(feature.id);
      if (!solved || feature.type !== 'sketch') return feature;
      const next = { ...feature, ...solved };
      replaced.set(feature.id, next);
      return next;
    });
    evaluator.rehang(replaced, trace);
    return { document: { ...doc, features }, evaluation: result };
  };
  const commit = (next: { document: Document; evaluation: Evaluation }) => {
    document = next.document;
    evaluation = next.evaluation;
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
      return { ok: true, state: state(applied, evaluator.evaluate(applied, { upTo: at, drag: dragOf(cmd) }).evaluation) };
    },

    undo() {
      const previous = undoStack[undoStack.length - 1];
      if (!previous) return;
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, document];
      commit({ document: previous, evaluation: evaluator.evaluate(previous).evaluation });
      notify();
    },

    redo() {
      const next = redoStack[redoStack.length - 1];
      if (!next) return;
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack, document];
      commit({ document: next, evaluation: evaluator.evaluate(next).evaluation });
      notify();
    },

    getState(at) {
      if (at !== undefined && !document.features.some((feature) => feature.id === at)) throw new Error(`getState: feature "${at}" neexistuje`);
      return state(document, at === undefined ? evaluation : evaluator.evaluate(document, { upTo: at }).evaluation);
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

    exportMesh(format) {
      if (format !== 'stl') throw new Error(`export: formát ${String(format)} není podporovaný`);
      return toStl(Object.values(evaluation.bodies).map((body) => body.solid));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

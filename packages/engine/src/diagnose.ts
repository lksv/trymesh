// Diagnostika skici: duplicitní a nadbytečné vazby, volnost bodů a poloměrů, vysvětlení vazby.
// Pravidla jsou v docs/architecture.md, sekce Diagnostika skici; počítá se z rozboru v analysis.ts.
import type { SketchAnalysis } from './analysis';
import { constraintKey, constraintOperands, curvePoints } from './document';
import type { ConstraintExplanation, Constraint, Id, SketchDiagnosis, SolveInput } from './types';
import { has } from './util';

export const UNAVAILABLE: SketchDiagnosis = { status: 'unavailable', degreesOfFreedom: 0, conflicting: [], duplicates: [], redundant: [], removable: [], free: [] };

// Co je o vyhodnocené skice potřeba: vstup solveru s použitými polohami, výsledek řešení a rozbor
// (ten je jen u vyřešené skici).
export interface Diagnosable {
  input: SolveInput;
  solve: { status: 'solved' | 'conflict' | 'failed'; conflicting: Id[] };
  analysis?: SketchAnalysis;
}

// Skupiny vazeb se stejným typem a operandy, v pořadí dokumentu.
function duplicateGroups(constraints: Record<Id, Constraint>): Id[][] {
  const groups = new Map<string, Id[]>();
  for (const [id, c] of Object.entries(constraints)) {
    const key = constraintKey(c);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function diagnose(sketch: Diagnosable): SketchDiagnosis {
  const duplicates = duplicateGroups(sketch.input.constraints);
  if (!sketch.analysis || sketch.solve.status !== 'solved') {
    return { ...UNAVAILABLE, status: sketch.solve.status === 'solved' ? 'failed' : sketch.solve.status, conflicting: sketch.solve.conflicting, duplicates };
  }
  const { redundant, removable } = sketch.analysis.surplus();
  return { status: 'solved', degreesOfFreedom: sketch.analysis.degreesOfFreedom, conflicting: [], duplicates, redundant, removable, free: sketch.analysis.free() };
}

// Entity, kterých se vazba dotýká: operandy a body křivek.
function touched(input: SolveInput, c: Constraint): Set<Id> {
  const out = new Set<Id>();
  for (const id of constraintOperands(c)) {
    out.add(id);
    if (has(input.curves, id)) for (const point of curvePoints(input.curves[id])) out.add(point);
  }
  return out;
}

// Nejmenší sada ostatních vazeb, ze kterých vazba plyne. Sad může být víc; přednost má duplicita
// a pak vazby na stejných entitách. Prázdná sada u nadbytečné vazby: plyne z definice křivky
// (podmínka oblouku), nebo její rovnice v tomto stavu nic neurčuje.
export function explain(sketch: Diagnosable, constraint: Id): ConstraintExplanation {
  const all = sketch.input.constraints;
  if (!sketch.analysis || sketch.solve.status !== 'solved' || !has(all, constraint)) return { redundant: false, impliedBy: [] };
  const key = constraintKey(all[constraint]);
  const near = touched(sketch.input, all[constraint]);
  const prefer = (other: Id): number => (constraintKey(all[other]) === key ? 0 : [...touched(sketch.input, all[other])].some((entity) => near.has(entity)) ? 1 : 2);
  const impliedBy = sketch.analysis.explain(constraint, prefer);
  return impliedBy ? { redundant: true, impliedBy } : { redundant: false, impliedBy: [] };
}

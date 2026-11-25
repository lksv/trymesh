// Sketch diagnosis: duplicate and redundant constraints, freedom of points and radii, explanation
// of a constraint. The rules are in docs/architecture/sketch.md, section "Sketch diagnosis"; it is computed
// from the analysis in analysis.ts.
import type { SketchAnalysis } from './analysis';
import { constraintKey, constraintOperands, curvePoints } from './sketch-content';
import type { ConstraintExplanation, Constraint, Id, SketchDiagnosis, SolveInput } from './types';
import { has } from './util';

export const UNAVAILABLE: SketchDiagnosis = { status: 'unavailable', degreesOfFreedom: 0, conflicting: [], duplicates: [], redundant: [], removable: [], free: [] };

// What is needed about an evaluated sketch: the input of the solver with the positions used, the
// result of solving and the analysis (which only a solved sketch has).
export interface Diagnosable {
  input: SolveInput;
  solve: { status: 'solved' | 'conflict' | 'failed'; conflicting: Id[] };
  analysis?: SketchAnalysis;
}

// Groups of constraints with the same type and operands, in the order of the document.
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

// The entities a constraint touches: the operands and the points of curves.
function touched(input: SolveInput, c: Constraint): Set<Id> {
  const out = new Set<Id>();
  for (const id of constraintOperands(c)) {
    out.add(id);
    if (has(input.curves, id)) for (const point of curvePoints(input.curves[id])) out.add(point);
  }
  return out;
}

// The smallest set of other constraints the constraint follows from. There can be more such sets;
// a duplicate takes precedence, and then constraints on the same entities. An empty set for a
// redundant constraint: it follows from the definition of a curve (the condition of an arc), or
// its equation determines nothing in this state.
export function explain(sketch: Diagnosable, constraint: Id): ConstraintExplanation {
  const all = sketch.input.constraints;
  if (!sketch.analysis || sketch.solve.status !== 'solved' || !has(all, constraint)) return { redundant: false, impliedBy: [] };
  const key = constraintKey(all[constraint]);
  const near = touched(sketch.input, all[constraint]);
  const prefer = (other: Id): number => (constraintKey(all[other]) === key ? 0 : [...touched(sketch.input, all[other])].some((entity) => near.has(entity)) ? 1 : 2);
  const impliedBy = sketch.analysis.explain(constraint, prefer);
  return impliedBy ? { redundant: true, impliedBy } : { redundant: false, impliedBy: [] };
}

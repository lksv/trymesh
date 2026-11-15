// The queries about a sketch: its diagnosis and the explanation of a constraint (D32).
import { UNAVAILABLE, diagnose, explain } from '../diagnose';
import type { ConstraintExplanation, SketchDiagnosis } from '../types';
import type { ArgSpecs } from './args';
import type { QuerySpec } from './spec';

export const SKETCH_ARGS = { sketch: { kind: 'sketch', title: 'Sketch' } } as const satisfies ArgSpecs;
export const CONSTRAINT_ARGS = { sketch: { kind: 'sketch', title: 'Sketch' }, constraint: { kind: 'constraint', of: 'sketch', title: 'Constraint' } } as const satisfies ArgSpecs;

declare module './spec' {
  interface Queries {
    sketchDiagnosis: { spec: typeof SKETCH_ARGS; result: SketchDiagnosis };
    constraintExplanation: { spec: typeof CONSTRAINT_ARGS; result: ConstraintExplanation };
  }
}

// A sketch that did not evaluate (it is suppressed, or its plane is broken) has the diagnosis
// `unavailable`; that is an answer, not an error. The diagnosis is kept by the evaluated sketch:
// while neither the sketch nor the state before it changes, it is not computed again.
export const sketchDiagnosis: QuerySpec<typeof SKETCH_ARGS, SketchDiagnosis> = {
  title: 'Diagnosis of a sketch',
  summary: 'How far a sketch is determined: its degrees of freedom, the entities that can still move, and the constraints that are duplicate, redundant or in conflict.',
  returns: '`status` (solved, conflict, failed, unavailable), `degreesOfFreedom`, `free` (what still moves and how), `duplicates`, `redundant`, `removable` (a set of constraints that can be removed without a change), `conflicting`.',
  args: SKETCH_ARGS,
  run: (context, { sketch }) => {
    const state = context.sketch(sketch);
    return state ? context.memo([state], 'diagnosis', () => diagnose(state)) : UNAVAILABLE;
  },
};

export const constraintExplanation: QuerySpec<typeof CONSTRAINT_ARGS, ConstraintExplanation> = {
  title: 'Explanation of a constraint',
  summary: 'Whether a constraint of a sketch follows from other constraints, and from which.',
  returns: '`redundant` and `impliedBy`: the smallest set of other constraints the constraint follows from (empty when it is not redundant, or when it follows from the definition of a curve).',
  args: CONSTRAINT_ARGS,
  run: (context, { sketch, constraint }) => {
    const state = context.sketch(sketch);
    return state ? explain(state, constraint) : { redundant: false, impliedBy: [] };
  },
};

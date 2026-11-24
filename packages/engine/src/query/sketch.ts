// The queries about a sketch: its diagnosis and the explanation of a constraint (D32), and where
// the curves that form regions meet (D65).
import { UNAVAILABLE, diagnose, explain } from '../diagnose';
import { type SketchContact, contactPlaces, sketchContactsOf } from '../sketch-cut';
import type { TightPlace } from '../sketch';
import type { ConstraintExplanation, Id, SketchDiagnosis } from '../types';
import type { ArgSpecs } from './args';
import type { QuerySpec } from './spec';

export const SKETCH_ARGS = { sketch: { kind: 'sketch', title: 'Sketch' } } as const satisfies ArgSpecs;
export const CONSTRAINT_ARGS = { sketch: { kind: 'sketch', title: 'Sketch' }, constraint: { kind: 'constraint', of: 'sketch', title: 'Constraint' } } as const satisfies ArgSpecs;

export const SKETCH_CONTACTS_ARGS = {
  sketch: { kind: 'sketch', title: 'Sketch' },
  max: { kind: 'number', title: 'Most contacts', summary: 'The most contacts to list; `total` counts them all.', optional: true, spec: { title: 'Most contacts to list', unit: 'count', integer: true, min: { value: 1 }, default: 100 } },
} as const satisfies ArgSpecs;

// - `status`: `unavailable` when the sketch did not evaluate (suppressed, its plane broken); the
//   other fields are then empty and `valid` false.
// - `valid`: the profile of the sketch. A valid profile has no contact.
// - `contacts`: at most `max`, in the order of the IDs of their curves and then along the first
//   curve; `total` counts all of them. `fix` is what split without a curve does there.
// - `lying`: pairs that lie on each other along a stretch or on one circle; `degenerate`: curves of
//   no length; `tight`: the curves around a region thinner than the chord tolerance, or whose
//   polygons cross, when nothing else explains an invalid profile; `reason`: why the profile is
//   invalid when a cut cannot repair it, the text split without a curve refuses with.
export interface SketchContactsResult {
  status: 'ok' | 'unavailable';
  valid: boolean;
  contacts: SketchContact[];
  total: number;
  lying: [Id, Id][];
  degenerate: Id[];
  tight?: TightPlace;
  reason?: string;
}

declare module './spec' {
  interface Queries {
    sketchDiagnosis: { spec: typeof SKETCH_ARGS; result: SketchDiagnosis };
    constraintExplanation: { spec: typeof CONSTRAINT_ARGS; result: ConstraintExplanation };
    sketchContacts: { spec: typeof SKETCH_CONTACTS_ARGS; result: SketchContactsResult };
  }
}

// A sketch that did not evaluate (it is suppressed, or its plane is broken) has the diagnosis
// `unavailable`; that is an answer, not an error. The diagnosis is kept by the evaluated sketch:
// while neither the sketch nor the state before it changes, it is not computed again.
export const sketchDiagnosis: QuerySpec<typeof SKETCH_ARGS, SketchDiagnosis> = {
  geometry: 'none', // reads no geometry of bodies (D49)
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
  geometry: 'none', // reads no geometry of bodies (D49)
  title: 'Explanation of a constraint',
  summary: 'Whether a constraint of a sketch follows from other constraints, and from which.',
  returns: '`redundant` and `impliedBy`: the smallest set of other constraints the constraint follows from (empty when it is not redundant, or when it follows from the definition of a curve).',
  args: CONSTRAINT_ARGS,
  run: (context, { sketch, constraint }) => {
    const state = context.sketch(sketch);
    return state ? explain(state, constraint) : { redundant: false, impliedBy: [] };
  },
};

// Where the curves of a sketch that form regions meet apart from common points (D65). It reads what
// the recompute kept of the sketch (its curves, joins, positions and profile), so it sees the sketch
// as the profile does. The places are kept by the solved sketch alone; what a split would do at
// each (`fix`) also reads the document (a circle a generated profile names is not cut), so the
// answer is kept by the sketch and the document together.
export const sketchContacts: QuerySpec<typeof SKETCH_CONTACTS_ARGS, SketchContactsResult> = {
  geometry: 'none', // reads no geometry of bodies (D49)
  title: 'Contacts of the outline curves of a sketch',
  summary:
    'Where the curves of a sketch that form regions cross, touch, end on each other or overlap apart from common points, which is what makes its profile invalid, and what the sketch tool split would do at each place. Ask it when a sketch reports `valid: false`, before split and trim.',
  returns:
    '`status` (ok, unavailable), `valid` (the profile), `contacts` (each `at` [x, y] in mm in the sketch, `kind`: crossing, touch, end, overlap or ends; `curves`; `fix`: what split without a curve does there, cut, join or none with `why`), `total`, `lying` (pairs lying on each other), `degenerate` (curves of no length), `tight` (the curves around a region thinner than the chord tolerance, and a place on them), `reason` (why the profile is invalid when a cut cannot repair it, with the curves and the place).',
  args: SKETCH_CONTACTS_ARGS,
  run: (context, { sketch, max }) => {
    const state = context.sketch(sketch);
    if (!state) return { status: 'unavailable', valid: false, contacts: [], total: 0, lying: [], degenerate: [] };
    const document = context.state.document;
    const chord = document.settings.chordTolerance;
    const places = context.memo([state], `places ${chord}`, () => contactPlaces(state, state.profile.valid, chord));
    const answer = context.memo([state, document], 'contacts', () => sketchContactsOf(places, state.curves, document, state.feature, state.profile.valid));
    return { status: 'ok', valid: state.profile.valid, contacts: answer.contacts.slice(0, max), total: answer.contacts.length, lying: answer.lying, degenerate: answer.degenerate, ...(answer.tight ? { tight: answer.tight } : {}), ...(answer.reason ? { reason: answer.reason } : {}) };
  },
};

// The query `mechanism` (D49): the mechanism of the state asked about as the evaluation has it, and
// on request what hangs on one joint. With `after` of the tool `query` it answers for a pose that is
// not written: where the links stand, which joint is in error, where an axis is in the pose.
import { type Carried, carriedBy } from '../sections/mechanism';
import type { MechanismResult } from '../types';
import { has } from '../util';
import type { ArgSpecs } from './args';
import { QueryFailure, type QuerySpec } from './spec';

export const MECHANISM_ARGS = {
  beyond: { kind: 'text', title: 'Joint', summary: 'The ID of a joint: the answer adds what hangs on it.', optional: true },
} as const satisfies ArgSpecs;

// `beyond`: the links beyond the joint (its child and every link that hangs on it), their bodies the
// state has, and the bodies they list that the state does not have (a sum of masses over `bodies`
// is short by those).
export type MechanismAnswer = MechanismResult & { beyond?: Carried };

declare module './spec' {
  interface Queries {
    mechanism: { spec: typeof MECHANISM_ARGS; result: MechanismAnswer };
  }
}

export const mechanism: QuerySpec<typeof MECHANISM_ARGS, MechanismAnswer> = {
  geometry: 'none', // reads no geometry of bodies (D49)
  title: 'Mechanism',
  summary:
    'The links and joints of the model as resolved for the state asked about: where each link stands in the pose, the numbers and the axis of each joint, and what is in error. With `beyond`, what hangs on that joint. ' +
    'Asked with `after: { type: "setPose", … }` it answers for a pose that is not written.',
  returns:
    '`links` (per link: `bodies` the state has, `missing` bodies it lists that the state has not, `transform` from as modelled to the pose as `matrix` rows and `translation`, `blockedBy` the joint that has no motion), ' +
    '`joints` (per joint: `status`, `error`, `fieldErrors`, the numbers used `value`, `lower`, `upper`, `axis` as modelled and `axisInPose`, each `origin` and unit `direction`), `roots` and `unassigned` (bodies in no link); ' +
    'with `beyond`: `beyond` with `links`, `bodies` and `missing` beyond that joint. Lengths in mm, angles in rad.',
  args: MECHANISM_ARGS,
  units: { origin: 'mm', translation: 'mm' },
  run(context, args) {
    const { document, evaluation } = context.state;
    if (args.beyond === undefined) return evaluation.mechanism;
    if (!has(document.mechanism.joints, args.beyond)) throw new QueryFailure('notAvailable', `the mechanism has no joint "${args.beyond}"`, ['beyond']);
    return { ...evaluation.mechanism, beyond: carriedBy(document.mechanism, evaluation.mechanism, args.beyond) };
  },
};

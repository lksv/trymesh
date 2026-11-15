// The query `interference`: which bodies share a volume (D35, point 5).
import { INTERFERENCE_THRESHOLD, interferenceReport, sharedBy } from '../interference';
import type { InterferenceReport } from '../types';
import type { ArgSpecs } from './args';
import type { QuerySpec } from './spec';

export const INTERFERENCE_ARGS = {
  bodies: { kind: 'list', of: { kind: 'body' }, title: 'Bodies', summary: 'The bodies to check against each other; without it all bodies.', optional: true },
  threshold: { kind: 'number', title: 'Threshold', summary: 'The smallest shared volume that counts.', optional: true, spec: { title: 'Threshold', unit: 'mm3', min: { value: 0 }, default: INTERFERENCE_THRESHOLD } },
} as const satisfies ArgSpecs;

declare module './spec' {
  interface Queries {
    interference: { spec: typeof INTERFERENCE_ARGS; result: InterferenceReport };
  }
}

export const interference: QuerySpec<typeof INTERFERENCE_ARGS, InterferenceReport> = {
  title: 'Interference',
  summary: 'Which bodies share a volume, pair by pair. Bodies that only touch are not reported.',
  returns:
    '`pairs`: the collisions, each `{ a, b, volume, depth }` (mm³, mm; `a` is the smaller ID). `fits`: pairs that overlap no deeper than the chord tolerance where round faces meet (a pin in a hole of the same diameter), not collisions of the design. ' +
    '`failed`: pairs the geometric kernel could not intersect, with its message. `checked`: the number of pairs looked at.',
  args: INTERFERENCE_ARGS,
  significant: { volume: 6, depth: 4 },
  units: { volume: 'mm3', depth: 'mm' },
  // What a pair shares is kept by its two meshes: after a change of the model only the pairs with
  // a changed body go to the kernel again.
  run: (context, { bodies, threshold }) => {
    const tolerance = context.state.document.settings.chordTolerance;
    return interferenceReport(context.bodies, bodies, threshold, tolerance, (a, b) => context.memo([a.solid, b.solid], 'shared', () => sharedBy(context.kernel, a, b, tolerance)));
  },
};

// The document half of the extent of a tool along the normal of its sketch plane: its validation
// and its numeric fields. Every feature that takes an extent uses it; the recompute half is
// recompute/extent.ts.
import type { FieldSpec, NumberSpec } from '../catalog';
import type { ExtrudeFeature } from '../types';
import { type ValidationContext, fail, object, oneOf } from '../validation';

const EXTENT_START: NumberSpec = { title: 'Start', unit: 'mm' };
const EXTENT_DISTANCE: NumberSpec = { title: 'Distance', unit: 'mm', nonZero: true };
// The taper is an optional field: its description has a default, which is what its absence means.
const EXTENT_TAPER: NumberSpec = { title: 'Taper', unit: 'rad', min: { value: -Math.PI / 2, open: true }, max: { value: Math.PI / 2, open: true }, default: 0 };

// The numeric fields of an extent, as the registry of feature types lists them.
export const EXTENT_FIELD_SPECS: FieldSpec[] = [
  { path: 'extent/start', spec: EXTENT_START, when: { path: 'extent/type', equals: 'distance' } },
  { path: 'extent/distance', spec: EXTENT_DISTANCE, when: { path: 'extent/type', equals: 'distance' } },
  { path: 'extent/taper', spec: EXTENT_TAPER, when: { path: 'extent/type', equals: 'distance' } },
];

// The extent of a feature. Which variants the feature may use is the caller's to say: `throughAll`
// takes its length from the targets, so there must be some, and only a cut goes through all.
// `noTaper`: why the feature may have no taper (a generated profile has no curves to move), or
// undefined when it may. The taper is stored only when it is given (also a zero). On another
// variant than `distance` the key is refused rather than dropped: the size of the far end would
// depend on the targets.
export function extentOf(context: ValidationContext, v: unknown, what: string, allows: { throughAll: boolean; noTaper?: string }): ExtrudeFeature['extent'] {
  const { fields } = context;
  const given = object(v, what);
  if (oneOf(given.type, ['distance', 'throughAll'] as const, `${what}.type`) === 'distance') {
    const start = fields.number(given.start, 'extent/start', EXTENT_START, `${what}.start`);
    const distance = fields.number(given.distance, 'extent/distance', EXTENT_DISTANCE, `${what}.distance`);
    if (given.taper === undefined) return { type: 'distance', start, distance };
    if (allows.noTaper !== undefined) fail(`${what}.taper: ${allows.noTaper}`);
    return { type: 'distance', start, distance, taper: fields.number(given.taper, 'extent/taper', EXTENT_TAPER, `${what}.taper`) };
  }
  if (given.taper !== undefined) fail(`${what}.taper: only the extent distance has a taper; the size of the far end of ${given.type} would depend on the targets`);
  if (!allows.throughAll) fail(`${what}.type: throughAll is only for the operation cut`);
  return { type: 'throughAll', side: oneOf(given.side, ['forward', 'backward', 'both'] as const, `${what}.side`) };
}

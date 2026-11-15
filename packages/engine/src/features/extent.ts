// The document half of the extent of a tool along the normal of its sketch plane: its validation
// and its numeric fields. Every feature that takes an extent uses it; the recompute half is
// recompute/extent.ts.
import type { FieldSpec, NumberSpec } from '../catalog';
import type { ExtrudeFeature } from '../types';
import { type ValidationContext, fail, object, oneOf } from '../validation';

const EXTENT_START: NumberSpec = { title: 'Start', unit: 'mm' };
const EXTENT_DISTANCE: NumberSpec = { title: 'Distance', unit: 'mm', nonZero: true };

// The numeric fields of an extent, as the registry of feature types lists them.
export const EXTENT_FIELD_SPECS: FieldSpec[] = [
  { path: 'extent/start', spec: EXTENT_START, when: { path: 'extent/type', equals: 'distance' } },
  { path: 'extent/distance', spec: EXTENT_DISTANCE, when: { path: 'extent/type', equals: 'distance' } },
];

// The extent of a feature. Which variants the feature may use is the caller's to say: `throughAll`
// takes its length from the targets, so there must be some, and only a cut goes through all.
export function extentOf(context: ValidationContext, v: unknown, what: string, allows: { throughAll: boolean }): ExtrudeFeature['extent'] {
  const { fields } = context;
  const given = object(v, what);
  if (oneOf(given.type, ['distance', 'throughAll'] as const, `${what}.type`) === 'distance') {
    const start = fields.number(given.start, 'extent/start', EXTENT_START, `${what}.start`);
    return { type: 'distance', start, distance: fields.number(given.distance, 'extent/distance', EXTENT_DISTANCE, `${what}.distance`) };
  }
  if (!allows.throughAll) fail(`${what}.type: throughAll is only for the operation cut`);
  return { type: 'throughAll', side: oneOf(given.side, ['forward', 'backward', 'both'] as const, `${what}.side`) };
}

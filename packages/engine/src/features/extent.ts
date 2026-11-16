// The document half of the extent of a tool along the normal of its sketch plane: its validation,
// its references and its numeric fields. Every feature that takes an extent uses it; the recompute
// half is recompute/extent.ts.
import type { FieldSpec, NumberSpec } from '../catalog';
import type { ExtrudeFeature } from '../types';
import { type FeatureRef, type ValidationContext, fail, object, oneOf, onlyFields, planeRef, planeRefs } from '../validation';

const EXTENT_START: NumberSpec = { title: 'Start', unit: 'mm' };
const EXTENT_DISTANCE: NumberSpec = { title: 'Distance', unit: 'mm', nonZero: true };
// The taper is an optional field: its description has a default, which is what its absence means.
const EXTENT_TAPER: NumberSpec = { title: 'Taper', unit: 'rad', min: { value: -Math.PI / 2, open: true }, max: { value: Math.PI / 2, open: true }, default: 0 };
// So is the gap before the plane of an extent `upTo`.
const EXTENT_GAP: NumberSpec = { title: 'Gap before the plane', unit: 'mm', default: 0 };

// The numeric fields of an extent, as the registry of feature types lists them.
export const EXTENT_FIELD_SPECS: FieldSpec[] = [
  { path: 'extent/start', spec: EXTENT_START, when: { path: 'extent/type', equals: 'distance' } },
  { path: 'extent/distance', spec: EXTENT_DISTANCE, when: { path: 'extent/type', equals: 'distance' } },
  { path: 'extent/taper', spec: EXTENT_TAPER, when: { path: 'extent/type', equals: 'distance' } },
  { path: 'extent/start', spec: EXTENT_START, when: { path: 'extent/type', equals: 'upTo' } },
  { path: 'extent/gap', spec: EXTENT_GAP, when: { path: 'extent/type', equals: 'upTo' } },
];

// The extent of a feature. Which variants the feature may use is the caller's to say: `throughAll`
// takes its length from the targets, so there must be some, and only a cut goes through all;
// `upTo` ends in a plane. `noTaper`: why the feature may have no taper (a generated profile has no
// curves to move), or undefined when it may. `noBoth`: why "through all" may not go to both sides
// (a hole has a mouth), or undefined when it may. The taper is stored only when it is given (also
// a zero). On another variant than `distance` the key is refused rather than dropped: the size of
// the far end would depend on the targets or on the plane.
// The variant `upTo` lists its own fields, so a key it does not know is refused (the older two
// variants drop such keys).
export function extentOf(context: ValidationContext, v: unknown, what: string, allows: { throughAll: boolean; upTo: boolean; noTaper?: string; noBoth?: string }): ExtrudeFeature['extent'] {
  const { fields } = context;
  const given = object(v, what);
  const type = oneOf(given.type, ['distance', 'throughAll', 'upTo'] as const, `${what}.type`);
  if (type === 'distance') {
    const start = fields.number(given.start, 'extent/start', EXTENT_START, `${what}.start`);
    const distance = fields.number(given.distance, 'extent/distance', EXTENT_DISTANCE, `${what}.distance`);
    if (given.taper === undefined) return { type: 'distance', start, distance };
    if (allows.noTaper !== undefined) fail(`${what}.taper: ${allows.noTaper}`);
    return { type: 'distance', start, distance, taper: fields.number(given.taper, 'extent/taper', EXTENT_TAPER, `${what}.taper`) };
  }
  if (given.taper !== undefined) fail(`${what}.taper: only the extent distance has a taper; the size of the far end of ${type} would depend on the ${type === 'upTo' ? 'plane' : 'targets'}`);
  if (type === 'upTo') {
    if (!allows.upTo) fail(`${what}.type: this feature has no extent upTo`);
    onlyFields(given, ['type', 'plane', 'start', 'gap'], what, 'the extent upTo');
    const plane = planeRef(context, given.plane, `${what}.plane`);
    const start = fields.number(given.start, 'extent/start', EXTENT_START, `${what}.start`);
    return given.gap === undefined ? { type, plane, start } : { type, plane, start, gap: fields.number(given.gap, 'extent/gap', EXTENT_GAP, `${what}.gap`) };
  }
  if (!allows.throughAll) fail(`${what}.type: throughAll is only for the operation cut`);
  const side = oneOf(given.side, ['forward', 'backward', 'both'] as const, `${what}.side`);
  if (side === 'both' && allows.noBoth !== undefined) fail(`${what}.side: ${allows.noBoth}`);
  return { type: 'throughAll', side };
}

// The references of an extent: the plane an extent `upTo` ends in.
export const extentRefs = (extent: ExtrudeFeature['extent']): FeatureRef[] => (extent.type === 'upTo' ? planeRefs(extent.plane, 'extent/plane') : []);

// What `null` in a patch may remove from an extent: its optional fields. A patch that asks for an
// extent without one is accepted also where the extent has none, or becomes another variant.
export const removableFromExtent = (path: string[]): boolean => path.length === 1 && (path[0] === 'taper' || path[0] === 'gap');

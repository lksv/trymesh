// The numbers of a pattern (D53), shared by the pattern of features (features/pattern.ts) and the
// mirror and pattern in a sketch (references/pattern.ts, D68): the bounds and the specs of the
// numeric fields. A leaf of the engine: it imports only the types of the catalog.
import type { NumberSpec } from './catalog';

// The count of a pattern includes the original. The upper bound keeps a typo in an expression from
// starting thousands of booleans.
export const MAX_PATTERN_COUNT = 200;
// A pattern has at most this many places, the original included, in a row or in a grid (D53): the
// bound of a count, for the product of the two counts of a grid. Judged by the recompute, because
// either count may be an expression.
export const MAX_PATTERN_PLACES = 200;
// The copy of a grid i steps along the first direction and j along the second has the number
// i + GRID_STRIDE · j (D53). Above the largest step of the first direction (`MAX_PATTERN_COUNT − 1`)
// and part of the meaning of every document with a grid: never changed.
export const GRID_STRIDE = 1000;
export const PATTERN_COUNT: NumberSpec = { title: 'Count', unit: 'count', integer: true, min: { value: 1 }, max: { value: MAX_PATTERN_COUNT } };
export const PATTERN_ANGLE: NumberSpec = { title: 'Angle', unit: 'rad', min: { value: -2 * Math.PI }, max: { value: 2 * Math.PI }, nonZero: true };
// The spans of a linear pattern: no bound of their own (the general bound of a document number
// holds); negative runs against the direction.
export const PATTERN_SPACING: NumberSpec = { title: 'Spacing', unit: 'mm', nonZero: true };
export const PATTERN_LENGTH: NumberSpec = { title: 'Length', unit: 'mm', nonZero: true };

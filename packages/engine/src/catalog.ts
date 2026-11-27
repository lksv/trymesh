// Catalogs: the description of numeric fields and the constraint catalog. The constraint catalog is
// the single source of truth about which constraints the engine knows and what operands and values
// they have. Command validation, duplicate detection and the API description for the UI and for AI
// (MCP) follow it. A new constraint is an entry here, its type in types.ts and its translation in the
// solver adapter; nothing else needs to know about it.
import type { Constraint, Id } from './types';
import { isOriginAxis } from './util';

export type EntityKind = 'point' | 'line' | 'circle' | 'arc' | 'spline';

export interface OperandSpec {
  field: string; // name of the operand in the constraint
  kinds: EntityKind[]; // which sketch entities the operand accepts
}

// ---------------------------------------------------------------- numeric fields

// Lengths are millimetres and angles radians; areas, volumes, masses and densities are derived (an
// argument of a query such as a threshold on a shared volume, the properties of a body). The drive
// of a joint (5b) keeps them: a force in newtons, so a torque in N·mm, a speed in rad/s or mm/s, an
// inertia in g·mm² (the unit of the query `mass`).
export type Unit = 'mm' | 'rad' | 'count' | 'none' | 'mm2' | 'mm3' | 'g' | 'g/cm3' | 'N' | 'N·mm' | 'rad/s' | 'mm/s' | 'g·mm2';

export interface Bound {
  value: number;
  open?: boolean; // true: the bound itself is not allowed
}

// Description of a numeric field: unit and range. Validation of numbers and of expression values,
// the app's forms and the API description follow it. Angle ranges are in radians, so a value entered
// in degrees by mistake does not pass.
export interface NumberSpec {
  title: string;
  unit: Unit;
  min?: Bound;
  max?: Bound;
  nonZero?: boolean;
  integer?: boolean; // the value may differ from an integer by at most 1e-9 and is rounded; otherwise an error
  default?: number;
}

// A numeric field of a feature type: static description. `path` is the field address (parts
// separated by slashes, `*` in place of an ID); `when` says which variant has the field.
export interface FieldSpec {
  path: string;
  spec: NumberSpec;
  when?: { path: string; equals: string };
}

// A bound as text; multiples of π are written with the symbol.
function boundText(value: number): string {
  const turns = value / Math.PI;
  for (const [factor, text] of [[1, 'π'], [2, '2π'], [0.5, 'π/2']] as const) if (Math.abs(Math.abs(turns) - factor) < 1e-12) return (turns < 0 ? '−' : '') + text;
  return String(value).replace('-', '−');
}

// The range of a field in words, for error messages and the API description.
export function rangeText(spec: NumberSpec): string {
  const parts: string[] = [];
  if (spec.integer) parts.push('an integer');
  const { min, max } = spec;
  if (min && max) parts.push(`in the interval ${min.open ? '(' : '['}${boundText(min.value)}, ${boundText(max.value)}${max.open ? ')' : ']'}`);
  else if (min) parts.push(min.value === 0 ? (min.open ? 'positive' : 'non-negative') : `${min.open ? 'greater than' : 'at least'} ${boundText(min.value)}`);
  else if (max) parts.push(`${max.open ? 'less than' : 'at most'} ${boundText(max.value)}`);
  if (spec.nonZero) parts.push('non-zero');
  return parts.length ? parts.join(', ') : 'any';
}

// Document numbers stay in a sane range: solid coordinates are float32.
export const MAX_NUMBER = 1e9;

export type NumberProblem = { code: 'notFinite' | 'outOfRange' | 'notInteger'; message: string };

// Checks a value against the field description. An integer is returned rounded. `limit` is the
// largest magnitude allowed whatever the description says: numbers of the document have one
// (coordinates of bodies are float32), an argument of a query has none.
export function checkNumber(value: number, spec: NumberSpec, limit = MAX_NUMBER): { ok: true; value: number } | ({ ok: false } & NumberProblem) {
  if (!Number.isFinite(value)) return { ok: false, code: 'notFinite', message: 'the value is not a finite number' };
  if (Math.abs(value) > limit) return { ok: false, code: 'outOfRange', message: `the number is outside the range ±${limit}` };
  let checked = value + 0; // no negative zero
  if (spec.integer) {
    const rounded = Math.round(value) + 0;
    if (Math.abs(value - rounded) > 1e-9) return { ok: false, code: 'notInteger', message: `the value ${value} is not an integer` };
    checked = rounded;
  }
  const { min, max } = spec;
  const outOfRange = (message: string) => ({ ok: false as const, code: 'outOfRange' as const, message });
  if (min && (min.open ? checked <= min.value : checked < min.value)) {
    if (!max && min.value === 0) return outOfRange(min.open ? 'the value must be positive' : 'the value must not be negative');
    return outOfRange(`the value ${checked} is not ${rangeText({ ...spec, nonZero: false, integer: false })}`);
  }
  if (max && (max.open ? checked >= max.value : checked > max.value)) return outOfRange(`the value ${checked} is not ${rangeText({ ...spec, nonZero: false, integer: false })}`);
  if (spec.nonZero && checked === 0) return outOfRange('the value must not be zero');
  return { ok: true, value: checked };
}

// ---------------------------------------------------------------- constraints

export interface ConstraintSpec {
  title: string; // short name for the user
  summary: string; // what the constraint ensures and how its operands read
  operands: OperandSpec[];
  unordered?: string[]; // operands whose order does not matter (for oriented dimensions a swap only flips the sign)
  // Named values of the constraint (numeric fields): a dimension has `value`, a fixed point `x` and `y`.
  values?: Record<string, NumberSpec>;
  dimension?: boolean; // true: the constraint is a dimension, has `driving` and can be a reference dimension
  // An additional rule over the operands (in the order of `operands`): their kinds, IDs and the points
  // that define a curve. Returns the text of the error.
  check?: (kinds: EntityKind[], ids: Id[], pointsOf: (curve: Id) => Id[]) => string | undefined;
}

const POINT: EntityKind[] = ['point'];
const LINE: EntityKind[] = ['line'];
const ROUND: EntityKind[] = ['circle', 'arc'];
const CURVE: EntityKind[] = ['line', 'circle', 'arc'];
const pair = (kinds: EntityKind[]): Pick<ConstraintSpec, 'operands' | 'unordered'> => ({
  operands: [
    { field: 'a', kinds },
    { field: 'b', kinds },
  ],
  unordered: ['a', 'b'],
});
const dimension = (spec: NumberSpec): Pick<ConstraintSpec, 'values' | 'dimension'> => ({ values: { value: spec }, dimension: true });
// The rule of a constraint that measures a line as the stretch between its ends (`midpoint`,
// `equalLength`): an axis of the origin is a whole line, with no length and no middle (D71).
const wholeLine = (lines: Id[]): string | undefined => {
  const axis = lines.find(isOriginAxis);
  return axis === undefined ? undefined : `${axis} is an axis of the origin, a whole line: it has no length and no middle`;
};
const LENGTH = dimension({ title: 'Distance', unit: 'mm', min: { value: 0 } });
const ORIENTED = dimension({ title: 'Distance', unit: 'mm' });

export const CONSTRAINTS: Record<Constraint['type'], ConstraintSpec> = {
  coincident: { title: 'Coincident', summary: 'Two points lie at the same place.', ...pair(POINT) },
  pointOnCurve: {
    title: 'Point on curve',
    summary: 'A point lies on a line (also on its extension), a circle or an arc.',
    operands: [
      { field: 'point', kinds: POINT },
      { field: 'curve', kinds: CURVE },
    ],
  },
  horizontal: { title: 'Horizontal', summary: 'A line is parallel to the X axis of the sketch.', operands: [{ field: 'line', kinds: LINE }] },
  vertical: { title: 'Vertical', summary: 'A line is parallel to the Y axis of the sketch.', operands: [{ field: 'line', kinds: LINE }] },
  horizontalPoints: { title: 'Horizontal points', summary: 'Two points have the same Y coordinate: they lie on one line parallel to the X axis of the sketch.', ...pair(POINT) },
  verticalPoints: { title: 'Vertical points', summary: 'Two points have the same X coordinate: they lie on one line parallel to the Y axis of the sketch.', ...pair(POINT) },
  parallel: { title: 'Parallel', summary: 'Two lines are parallel.', ...pair(LINE) },
  perpendicular: { title: 'Perpendicular', summary: 'Two lines are perpendicular to each other.', ...pair(LINE) },
  equalLength: { title: 'Equal length', summary: 'Two lines have the same length.', ...pair(LINE), check: (_kinds, ids) => wholeLine(ids) },
  tangent: {
    title: 'Tangent',
    summary: 'A line touches a circle or an arc, or two circles or arcs touch.',
    ...pair(CURVE),
    check: (kinds) => (kinds.every((kind) => kind === 'line') ? 'tangency of two lines makes no sense' : undefined),
  },
  symmetric: {
    title: 'Symmetric',
    summary: 'Points a, b are symmetric about the infinite line on which the line `line` lies (the axis of symmetry).',
    operands: [
      { field: 'a', kinds: POINT },
      { field: 'b', kinds: POINT },
      { field: 'line', kinds: LINE },
    ],
    unordered: ['a', 'b'],
    check: (_kinds, [a, b, line], pointsOf) => (pointsOf(line).includes(a) || pointsOf(line).includes(b) ? 'a symmetric point must not be an end of the axis' : undefined),
  },
  midpoint: {
    title: 'Midpoint',
    summary: 'A point lies exactly halfway along a line.',
    operands: [
      { field: 'point', kinds: POINT },
      { field: 'line', kinds: LINE },
    ],
    check: (_kinds, [point, line], pointsOf) => wholeLine([line]) ?? (pointsOf(line).includes(point) ? 'the midpoint of a line cannot be its end' : undefined),
  },
  midpointPoints: {
    title: 'Midpoint of two points',
    summary: 'A point lies exactly halfway between points a and b, which need no line between them.',
    operands: [
      { field: 'point', kinds: POINT },
      { field: 'a', kinds: POINT },
      { field: 'b', kinds: POINT },
    ],
    unordered: ['a', 'b'],
  },
  equalRadius: { title: 'Equal radius', summary: 'Two circles or arcs have the same radius.', ...pair(ROUND) },
  fixed: {
    title: 'Fixed point',
    summary: 'An own point of the sketch lies at the coordinates x, y of the sketch.',
    operands: [{ field: 'point', kinds: POINT }],
    values: { x: { title: 'X', unit: 'mm' }, y: { title: 'Y', unit: 'mm' } },
  },
  distance: { title: 'Distance', summary: 'The distance between two points.', ...pair(POINT), ...LENGTH },
  distancePointLine: {
    title: 'Point to line distance',
    summary: 'The perpendicular distance of a point from the infinite line on which the line lies.',
    operands: [
      { field: 'point', kinds: POINT },
      { field: 'line', kinds: LINE },
    ],
    ...LENGTH,
  },
  distanceLineLine: {
    title: 'Line to line distance',
    summary: 'Two lines are parallel and their infinite lines lie this far apart; 0 puts them on one line. It holds the lines parallel by itself.',
    ...pair(LINE),
    ...LENGTH,
  },
  distanceLineCircle: {
    title: 'Line to circle distance',
    summary: 'The gap between the infinite line of the line and a circle or an arc (its whole circle): the distance of the centre from the line less the radius, positive. The circle stays on one side of the line. A gap of 0 is a tangency: use tangent. For the distance to the centre use the point to line distance with the centre.',
    operands: [
      { field: 'line', kinds: LINE },
      { field: 'curve', kinds: ROUND },
    ],
    // positive: at 0 it would be a tangency without the forms a tangency has at a common end (D52)
    ...dimension({ title: 'Distance', unit: 'mm', min: { value: 0, open: true } }),
  },
  horizontalDistance: { title: 'Horizontal distance', summary: 'The oriented difference of the X coordinates: b.x − a.x.', ...pair(POINT), ...ORIENTED },
  verticalDistance: { title: 'Vertical distance', summary: 'The oriented difference of the Y coordinates: b.y − a.y.', ...pair(POINT), ...ORIENTED },
  angle: {
    title: 'Angle',
    summary: 'The angle from the direction of line a to the direction of line b, counterclockwise, in the interval (−π, π]. The direction of a line goes from its point a to its point b.',
    ...pair(LINE),
    ...dimension({ title: 'Angle', unit: 'rad', min: { value: -Math.PI, open: true }, max: { value: Math.PI } }),
  },
  radius: { title: 'Radius', summary: 'The radius of a circle or an arc.', operands: [{ field: 'curve', kinds: ROUND }], ...dimension({ title: 'Radius', unit: 'mm', min: { value: 0, open: true } }) },
  diameter: { title: 'Diameter', summary: 'The diameter of a circle or an arc.', operands: [{ field: 'curve', kinds: ROUND }], ...dimension({ title: 'Diameter', unit: 'mm', min: { value: 0, open: true } }) },
};

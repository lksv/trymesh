// Catalogs: the description of numeric fields and the constraint catalog. The constraint catalog is
// the single source of truth about which constraints the engine knows and what operands and values
// they have. Command validation, duplicate detection and the API description for the UI and for AI
// (MCP) follow it. A new constraint is an entry here, its type in types.ts and its translation in the
// solver adapter; nothing else needs to know about it.
import type { Constraint, Id } from './types';

export type EntityKind = 'point' | 'line' | 'circle' | 'arc';

export interface OperandSpec {
  field: string; // jméno operandu ve vazbě
  kinds: EntityKind[]; // jaké entity skici operand přijímá
}

// ---------------------------------------------------------------- numeric fields

export type Unit = 'mm' | 'rad' | 'count' | 'none';

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

// Checks a value against the field description. An integer is returned rounded.
export function checkNumber(value: number, spec: NumberSpec): { ok: true; value: number } | ({ ok: false } & NumberProblem) {
  if (!Number.isFinite(value)) return { ok: false, code: 'notFinite', message: 'the value is not a finite number' };
  if (Math.abs(value) > MAX_NUMBER) return { ok: false, code: 'outOfRange', message: `the number is outside the range ±${MAX_NUMBER}` };
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

// ---------------------------------------------------------------- vazby

export interface ConstraintSpec {
  title: string; // krátké jméno pro uživatele
  summary: string; // co vazba zajišťuje a jak se čtou operandy
  operands: OperandSpec[];
  unordered?: string[]; // operandy, na jejichž pořadí nezáleží (u orientovaných kót záměna jen obrací znaménko)
  // Named values of the constraint (numeric fields): a dimension has `value`.
  values?: Record<string, NumberSpec>;
  dimension?: boolean; // true: the constraint is a dimension, has `driving` and can be a reference dimension
  // Dodatečné pravidlo nad operandy (v pořadí `operands`): jejich druhy, ID a body, kterými je
  // křivka určená. Vrací text chyby.
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
const LENGTH = dimension({ title: 'Distance', unit: 'mm', min: { value: 0 } });
const ORIENTED = dimension({ title: 'Distance', unit: 'mm' });

export const CONSTRAINTS: Record<Constraint['type'], ConstraintSpec> = {
  coincident: { title: 'Totožné', summary: 'Dva body leží na stejném místě.', ...pair(POINT) },
  pointOnCurve: {
    title: 'Bod na křivce',
    summary: 'Bod leží na úsečce (i na jejím prodloužení), kružnici nebo oblouku.',
    operands: [
      { field: 'point', kinds: POINT },
      { field: 'curve', kinds: CURVE },
    ],
  },
  horizontal: { title: 'Vodorovně', summary: 'Úsečka je rovnoběžná s osou X skici.', operands: [{ field: 'line', kinds: LINE }] },
  vertical: { title: 'Svisle', summary: 'Úsečka je rovnoběžná s osou Y skici.', operands: [{ field: 'line', kinds: LINE }] },
  parallel: { title: 'Rovnoběžně', summary: 'Dvě úsečky jsou rovnoběžné.', ...pair(LINE) },
  perpendicular: { title: 'Kolmo', summary: 'Dvě úsečky jsou na sebe kolmé.', ...pair(LINE) },
  equalLength: { title: 'Stejná délka', summary: 'Dvě úsečky mají stejnou délku.', ...pair(LINE) },
  tangent: {
    title: 'Tečně',
    summary: 'Úsečka se dotýká kružnice nebo oblouku, nebo se dotýkají dvě kružnice či oblouky.',
    ...pair(CURVE),
    check: (kinds) => (kinds.every((kind) => kind === 'line') ? 'tečnost dvou úseček nedává smysl' : undefined),
  },
  symmetric: {
    title: 'Souměrně',
    summary: 'Body a, b jsou souměrné podle přímky, na které leží úsečka line (osa souměrnosti).',
    operands: [
      { field: 'a', kinds: POINT },
      { field: 'b', kinds: POINT },
      { field: 'line', kinds: LINE },
    ],
    unordered: ['a', 'b'],
    check: (_kinds, [a, b, line], pointsOf) => (pointsOf(line).includes(a) || pointsOf(line).includes(b) ? 'souměrný bod nesmí být koncem osy' : undefined),
  },
  midpoint: {
    title: 'Střed úsečky',
    summary: 'Bod leží přesně v polovině úsečky.',
    operands: [
      { field: 'point', kinds: POINT },
      { field: 'line', kinds: LINE },
    ],
    check: (_kinds, [point, line], pointsOf) => (pointsOf(line).includes(point) ? 'středem úsečky nemůže být její konec' : undefined),
  },
  distance: { title: 'Vzdálenost', summary: 'Vzdálenost dvou bodů.', ...pair(POINT), ...LENGTH },
  distancePointLine: {
    title: 'Vzdálenost bodu od úsečky',
    summary: 'Kolmá vzdálenost bodu od přímky, na které úsečka leží.',
    operands: [
      { field: 'point', kinds: POINT },
      { field: 'line', kinds: LINE },
    ],
    ...LENGTH,
  },
  horizontalDistance: { title: 'Vodorovná vzdálenost', summary: 'Orientovaný rozdíl souřadnic X: b.x − a.x.', ...pair(POINT), ...ORIENTED },
  verticalDistance: { title: 'Svislá vzdálenost', summary: 'Orientovaný rozdíl souřadnic Y: b.y − a.y.', ...pair(POINT), ...ORIENTED },
  angle: {
    title: 'Úhel',
    summary: 'Úhel od směru úsečky a ke směru úsečky b, proti směru hodin, v intervalu (−π, π]. Směr úsečky vede od jejího bodu a k bodu b.',
    ...pair(LINE),
    ...dimension({ title: 'Angle', unit: 'rad', min: { value: -Math.PI, open: true }, max: { value: Math.PI } }),
  },
  radius: { title: 'Poloměr', summary: 'Poloměr kružnice nebo oblouku.', operands: [{ field: 'curve', kinds: ROUND }], ...dimension({ title: 'Radius', unit: 'mm', min: { value: 0, open: true } }) },
  diameter: { title: 'Průměr', summary: 'Průměr kružnice nebo oblouku.', operands: [{ field: 'curve', kinds: ROUND }], ...dimension({ title: 'Diameter', unit: 'mm', min: { value: 0, open: true } }) },
};

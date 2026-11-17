// Numeric fields of forms: a number, or an expression over parameters. Pure functions, no DOM.
// Rule (D35, point 1): the app converts bare numbers only (it shows and accepts an angle in degrees);
// it shows and sends an expression unchanged, in engine units, and displays its resulting value next to it.
import { type Expr, type ExprKind, type ResultUnit, type Unit, analyzeExpression } from '@trymesh/engine';

const NUMBER = /^[+-]?(?:\d+[.,]?\d*|[.,]\d+)(?:[eE][+-]?\d+)?$/;
const DEGREES = 180 / Math.PI;

// A number for a form field: at most six decimal places, no trailing zeros.
export const plainNumber = (value: number): string => String(Math.round(value * 1e6) / 1e6 + 0);

// Field text → the value for a command. A bare number is a number (a decimal comma counts as a dot,
// an angle is in degrees and is converted to radians); anything else is an expression. An empty
// field means nothing.
export function parseField(text: string, unit: Unit): number | Expr | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (!NUMBER.test(trimmed)) return trimmed;
  const value = Number(trimmed.replace(',', '.'));
  return unit === 'rad' ? value / DEGREES : value;
}

// What the field shows: an expression unchanged, a number in units for a human. An expression that
// is just a number (set elsewhere as `"0.5"`) is shown as that number, converted like any other:
// shown as typed it would read as radians here but as degrees once the user retyped it.
export function fieldText(value: number | Expr, unit: Unit): string {
  const shown = typeof value === 'string' && NUMBER.test(value.trim()) ? Number(value.trim().replace(',', '.')) : value;
  if (typeof shown === 'string') return shown;
  return Number.isFinite(shown) ? plainNumber(unit === 'rad' ? shown * DEGREES : shown) : '';
}

const UNIT_LABEL: Record<Unit, string> = { mm: ' mm', rad: '°', count: '', none: '', mm2: ' mm²', mm3: ' mm³', g: ' g', 'g/cm3': ' g/cm³', N: ' N', 'N·mm': ' N·mm', 'rad/s': ' rad/s', 'mm/s': ' mm/s', 'g·mm2': ' g·mm²' };

// A number as it is shown: six decimal places, or that many significant digits (a value that is
// small on purpose, which six decimal places would round to zero).
const shownNumber = (value: number, significant?: number): string => (significant === undefined ? plainNumber(value) : String(Number(value.toPrecision(significant)) + 0));

// A value with its unit for a human: "16.2 mm", "30°".
export const valueText = (value: number, unit: Unit, significant?: number): string => `${shownNumber(unit === 'rad' ? value * DEGREES : value, significant)}${UNIT_LABEL[unit]}`;

// The unit as it is written after a number.
export const unitLabel = (unit: Unit): string => UNIT_LABEL[unit].trim();
// A number of the result of a query with its unit, which may be one only a result has.
export const resultText = (value: number, unit: ResultUnit, significant?: number): string => (unit === 'g·mm2' ? `${shownNumber(value, significant)} g·mm²` : valueText(value, unit, significant));

// The note next to a field with an expression: its resulting value.
export const fieldNote = (value: number | Expr, computed: number | undefined, unit: Unit): string => (typeof value !== 'string' ? '' : computed === undefined ? '= ?' : `= ${valueText(computed, unit)}`);

// What is wrong with an expression while the user is typing it; undefined = fine. Given a list of
// names an unknown name is reported too (in a feature field it is an invalid command, for
// a parameter it is not).
export function expressionProblem(text: string, kind: ExprKind, names?: string[]): string | undefined {
  const result = analyzeExpression(text, { kind, ...(names ? { names } : {}) });
  return result.ok ? undefined : result.error.message;
}

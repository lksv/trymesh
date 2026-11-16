// Numeric fields of an entry of a section of the document (D48). One rule for a number of the
// document wherever it is: a command takes a number or an expression, the field holds the last
// valid number and the expression is kept beside it, in `expressions` of the entry under the name
// of the field. Validation goes through the one reader of the engine (`Fields`); the recompute
// evaluates, the engine writes the numbers back, a renamed parameter is renamed here as well.
// Written once for every section with numeric fields.
import { type NumberSpec, checkNumber } from '../catalog';
import { type Environment, evaluateNumber, renameInExpression } from '../expression';
import type { Expr, ExpressionError } from '../types';
import { has } from '../util';
import { CommandError, type Dict, type FieldMode, Fields, fail, object, string } from '../validation';

// A numeric field of an entry: its name in the entry and its description.
export interface EntryField {
  path: string;
  spec: NumberSpec;
}

// The expressions of an entry as a document stores them: an object of texts by field.
export function storedExpressions(o: Dict, what: string): Record<string, Expr> {
  if (o.expressions === undefined) return {};
  return Object.fromEntries(Object.entries(object(o.expressions, `${what}.expressions`)).map(([path, expr]) => [path, string(expr, `${what}.expressions.${path}`)]));
}

// Reads the numeric fields an entry has, with `given` the expressions it keeps (see `FieldMode`:
// `load` checks their syntax, `update` evaluates a string in a field). `key` is the key of the
// entry: an error of an expression is addressed by `<key>/<field>`. An expression of a field the
// entry does not have is an error. Returns the numbers of the fields that are there, and the
// expressions sorted by field.
export function readEntryFields(o: Dict, given: Record<string, Expr>, fields: readonly EntryField[], mode: FieldMode, environment: () => Environment, key: string, what: string): { numbers: Record<string, number>; expressions?: Record<string, Expr> } {
  for (const path of Object.keys(given)) if (!fields.some((field) => field.path === path && o[path] !== undefined)) fail(`${what}.expressions.${path}: the entry has no numeric field "${path}"`);
  const reader = new Fields(mode, given, environment);
  const numbers: Record<string, number> = {};
  for (const { path, spec } of fields) {
    if (o[path] === undefined) continue;
    try {
      numbers[path] = reader.number(o[path], path, spec, `${what}.${path}`);
    } catch (error) {
      // the address of the field inside the section, not inside the entry
      if (error instanceof CommandError && error.expression?.path !== undefined) error.expression = { ...error.expression, path: `${key}/${path}` };
      throw error;
    }
  }
  return { numbers, ...(reader.expressions(what) ? { expressions: reader.expressions(what) } : {}) };
}

// The values of the fields of an entry for one environment: a field with an expression has the
// value of the expression or an error, a field without one its number.
export interface EntryValues {
  values: Record<string, number>;
  errors: Record<string, ExpressionError>;
}
export function resolveEntryFields(entry: Dict & { expressions?: Record<string, Expr> }, fields: readonly EntryField[], environment: Environment): EntryValues {
  const values: Record<string, number> = {};
  const errors: Record<string, ExpressionError> = {};
  for (const { path, spec } of fields) {
    if (typeof entry[path] !== 'number') continue;
    const expr = entry.expressions !== undefined && has(entry.expressions, path) ? entry.expressions[path] : undefined;
    if (expr === undefined) {
      values[path] = entry[path] as number;
      continue;
    }
    const result = evaluateNumber(expr, environment);
    const checked = result.ok ? checkNumber(result.value, spec) : undefined;
    if (checked?.ok) values[path] = checked.value;
    else errors[path] = result.ok ? { code: (checked as { code: ExpressionError['code'] }).code, message: (checked as { message: string }).message } : result.error;
  }
  return { values, errors };
}

// The entry with the values of its expressions written into its fields; the same object when no
// number changed.
export function writtenEntry<E extends Dict>(entry: E, { values }: EntryValues): E {
  const changed = Object.entries(values).filter(([path, value]) => entry[path] !== value);
  return changed.length ? { ...entry, ...Object.fromEntries(changed) } : entry;
}

// The entry with the parameter `from` renamed to `to` in its expressions; the same object when no
// expression uses it.
export function renamedEntry<E extends { expressions?: Record<string, Expr> }>(entry: E, from: string, to: string): E {
  if (!entry.expressions) return entry;
  const expressions = Object.fromEntries(Object.entries(entry.expressions).map(([path, expr]) => [path, renameInExpression(expr, from, to)]));
  return Object.keys(expressions).every((path) => expressions[path] === entry.expressions?.[path as keyof typeof entry.expressions]) ? entry : { ...entry, expressions };
}

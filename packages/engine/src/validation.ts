// What the validators of commands and documents share: the error, the basic checks, the reader of
// numeric fields, names of faces and edges, and references between features. Nothing here reads the
// registry of feature types; what needs it reaches a validator through its context (`RefContext`).
import { MAX_NUMBER, type NumberSpec, checkNumber } from './catalog';
import { type Environment, analyzeExpression, evaluateNumber } from './expression';
import { FACE_ROLES, type RoleCatalog } from './face-roles';
import type { AxisRef, CommandResult, CopyTag, Document, EdgeName, Expr, FaceName, FieldPath, Id, PlaneRef } from './types';
import { ORIGIN, canonicalEdge, faceKey, has } from './util';

// Neplatný příkaz nebo dokument. `commandIndex` říká, který příkaz dávky to byl.
export type ExpressionProblem = NonNullable<Extract<CommandResult, { ok: false }>['error']['expression']>;
export class CommandError extends Error {
  commandIndex?: number;
  expression?: ExpressionProblem; // when the command rejected an expression: where and why
}
export const fail = (message: string, expression?: ExpressionProblem): never => {
  const error = new CommandError(message);
  if (expression) error.expression = expression;
  throw error;
};

// ---------------------------------------------------------------- základní kontroly

export type Dict = Record<string, unknown>;
export const isObject = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
export const object = (v: unknown, what: string): Dict => (isObject(v) ? v : fail(`${what}: čeká se objekt`));
export const string = (v: unknown, what: string): string => (typeof v === 'string' ? v : fail(`${what}: čeká se řetězec`));
// Čísla dokumentu: konečná a v rozumném rozsahu (souřadnice tělesa jsou float32). Záporná nula
// se ukládá jako nula, aby se uložený a znovu načtený dokument nelišil.
export const finite = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${what}: čeká se konečné číslo`);
  if (Math.abs(v) > MAX_NUMBER) return fail(`${what}: číslo je mimo rozsah ±${MAX_NUMBER}`);
  return v + 0;
};
export const boolean = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(`${what}: čeká se true nebo false`));
export const oneOf = <T extends string>(v: unknown, options: readonly T[], what: string): T =>
  options.includes(v as T) ? (v as T) : fail(`${what}: čeká se jedna z hodnot ${options.join(', ')}`);

// ID generuje volající. Nesmí obsahovat `/` (odvozená ID promítnuté geometrie), nesmí být `origin`
// ani jméno vlastnosti, kterou má každý objekt (`constructor`, `toString`…): ID jsou klíče záznamů.
export function newId(v: unknown, what: string): Id {
  const id = string(v, what);
  if (id === '' || id.includes('/') || id === ORIGIN || id in Object.prototype) fail(`${what}: ID "${id}" není přípustné`);
  return id;
}

// A field of another variant is a mistake, not something to drop silently: a pattern of a body
// given a list of features too would otherwise be stored as something else than what was sent.
export function onlyFields(o: Dict, fields: readonly string[], what: string, owner: string): void {
  // a key without a value is not a field (in-process callers build objects that way; JSON has none)
  for (const key of Object.keys(o)) if (o[key] !== undefined && !fields.includes(key)) fail(`${what}.${key}: ${owner} has no such field`);
}

export function base(o: Dict, what: string): { id: Id; name: string; suppressed: boolean } {
  return { id: newId(o.id, `${what}.id`), name: string(o.name, `${what}.name`), suppressed: boolean(o.suppressed, `${what}.suppressed`) };
}

// ---------------------------------------------------------------- numeric fields and expressions

// A numeric field of a particular feature: address, catalog description, value and expression, if any.
export interface FieldInfo {
  path: FieldPath;
  spec: NumberSpec;
  value: number;
  expr?: Expr;
}

// How validation treats expressions:
// - load: a document. The field holds a number (the last valid value), the expression is in
//   `expressions` and only its syntax is checked; the recompute evaluates it.
// - add: a command creates a feature. The expression may be in the field as a string or in
//   `expressions`; it is evaluated right away and what cannot be evaluated is an invalid command.
// - update: a command changes a feature. A string in a field is evaluated right away; expressions
//   of fields the change does not touch stay unevaluated (fixing one field must not trip over an
//   error in another) and expressions of fields that ceased to exist are dropped.
export type FieldMode = 'load' | 'add' | 'update';

// Reads the numeric fields of a feature during validation. The fields validation went through are
// the fields the feature has; `fieldsOf` and the check that `expressions` holds no address of
// a non-existent field both follow from that.
export class Fields {
  readonly found: FieldInfo[] = [];
  private readonly used = new Set<FieldPath>();

  constructor(
    private readonly mode: FieldMode,
    private readonly given: Record<FieldPath, Expr>,
    private readonly environment: () => Environment,
  ) {}

  number(value: unknown, path: FieldPath, spec: NumberSpec, what: string): number {
    const given = has(this.given, path) ? this.given[path] : undefined;
    if (typeof value === 'string') {
      if (this.mode === 'load') fail(`${what}: a number is expected; an expression belongs in expressions`);
      if (given !== undefined) fail(`${what}: the expression is given both in the field and in expressions`);
      return this.add(path, spec, this.evaluate(value, path, spec, what), value);
    }
    const number = finite(value, what);
    if (given === undefined) return this.add(path, spec, plain(number, spec, what));
    this.used.add(path);
    if (this.mode === 'add') return this.add(path, spec, this.evaluate(given, path, spec, what), given);
    const syntax = analyzeExpression(given);
    if (!syntax.ok) fail(`${what}: expression "${given}": ${syntax.error.message}`, { path, error: syntax.error });
    return this.add(path, spec, plain(number, spec, what), given);
  }

  private add(path: FieldPath, spec: NumberSpec, value: number, expr?: Expr): number {
    this.found.push({ path, spec, value, ...(expr === undefined ? {} : { expr: expr.trim() }) });
    return value;
  }

  private evaluate(expr: Expr, path: FieldPath, spec: NumberSpec, what: string): number {
    const result = evaluateNumber(expr, this.environment());
    if (!result.ok) return fail(`${what}: expression "${expr}": ${result.error.message}`, { path, error: result.error });
    const checked = checkNumber(result.value, spec);
    if (!checked.ok) return fail(`${what}: expression "${expr}" gives ${result.value}: ${checked.message}`, { path, error: { code: checked.code, message: checked.message } });
    return checked.value;
  }

  // Expressions of the fields the feature has, sorted by address. An expression for an address
  // validation did not go through is an error; when a feature is being changed it is dropped (the
  // field ceased to exist with the change).
  expressions(what: string): Record<FieldPath, Expr> | undefined {
    if (this.mode !== 'update') for (const path of Object.keys(this.given)) if (!this.used.has(path)) fail(`${what}.expressions: "${path}" is not a numeric field of this feature`);
    const entries = this.found.filter((field) => field.expr !== undefined).map((field): [FieldPath, Expr] => [field.path, field.expr as Expr]);
    return entries.length ? Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1))) : undefined;
  }
}

// The number of a field without an expression.
export function plain(value: number, spec: NumberSpec, what: string): number {
  const checked = checkNumber(value, spec);
  return checked.ok ? checked.value : fail(`${what}: ${checked.message}`);
}

// ---------------------------------------------------------------- jména a odkazy mezi features

// A face name in its canonical form. An empty `copy` is the same as none, so that one face has one
// spelling.
export function faceName(v: unknown, what: string, roles: RoleCatalog = FACE_ROLES): FaceName {
  const o = object(v, what);
  const feature = string(o.feature, `${what}.feature`);
  const role = oneOf(o.role, Object.keys(roles), `${what}.role`);
  // the fields that tell apart the faces of the role, as its entry of the catalog describes them
  const parts: Record<string, string | number> = {};
  for (const [part, spec] of Object.entries(roles[role].parts)) {
    if (spec.kind === 'text') parts[part] = string(o[part], `${what}.${part}`);
    else {
      parts[part] = finite(o[part], `${what}.${part}`);
      if (!Number.isInteger(parts[part])) fail(`${what}.${part}: a whole number is expected`);
    }
  }
  const name = { feature, role, ...parts } as FaceName;
  if (o.copy === undefined) return name;
  if (!Array.isArray(o.copy)) return fail(`${what}.copy: a list of { pattern, index } is expected`);
  const copy = (o.copy as unknown[]).map((item, i): CopyTag => {
    const tag = object(item, `${what}.copy[${i}]`);
    const index = finite(tag.index, `${what}.copy[${i}].index`);
    if (!Number.isInteger(index) || index < 1) fail(`${what}.copy[${i}].index: the number of a copy is an integer from 1`);
    return { pattern: string(tag.pattern, `${what}.copy[${i}].pattern`), index };
  });
  return copy.length ? { ...name, copy } : name;
}

export const faceRefs = (face: FaceName, path: string): FeatureRef[] => [{ path, id: face.feature, kind: 'faceSource' }, ...(face.copy ?? []).map((tag): FeatureRef => ({ path, id: tag.pattern, kind: 'pattern' }))];

export function edgeName(v: unknown, what: string): EdgeName {
  const o = object(v, what);
  const edge = { a: faceName(o.a, `${what}.a`), b: faceName(o.b, `${what}.b`) };
  if (faceKey(edge.a) === faceKey(edge.b)) fail(`${what}: hrana je rozhraní dvou různých stěn`);
  return canonicalEdge(edge);
}

// Odkaz jedné feature na jinou. `path` je místo odkazu uvnitř feature (cesta oddělená lomítky).
// - `entity` is a reference to an entity of a sketch (an operand of a profile generator, a curve of
//   a wall): `id` is the entity, `sketch` its sketch and `accepts` the entity kinds allowed. With
//   `notProjected` the entity must not be projected geometry: an own curve; for a point, an own
//   point or the origin.
// - `generated` is a reference to an extrusion whose profile comes from one of the generators in
//   `accepts` (a gear in mesh with another gear).
// - `tool` is a reference to a feature that applies a tool to bodies and can be repeated by
//   a pattern: an extrusion with the operation add or cut, a hole.
// - `pattern` is a reference to a pattern (the one that made the copy a face name speaks of).
export type RefKind = 'plane' | 'sketch' | 'body' | 'faceSource' | 'entity' | 'generated' | 'tool' | 'pattern';
export interface FeatureRef {
  path: string;
  id: Id; // u `body` ID tělesa, u `entity` ID entity skici, jinak ID feature
  kind: RefKind;
  sketch?: Id;
  accepts?: readonly string[];
  notProjected?: boolean;
}
export const REF_LABEL: Record<Exclude<RefKind, 'entity' | 'generated' | 'tool'>, string> = { plane: 'rovina', sketch: 'skica', body: 'těleso', faceSource: 'a feature that names faces', pattern: 'a feature that tags copied faces (a pattern, or a combine as a difference)' };

// What a helper that checks a reference needs. Whether the target of a reference exists, is of the
// right kind and lies before the referring feature is a question for the registry of feature types
// (`requireRef`, next to the registry). It reaches a validator through this context, so that no
// validator and no feature module imports the registry.
export interface RefContext {
  doc: Document;
  before: number | undefined; // the index of the referring feature; absent when a document is loaded, see requireRef
  requireRef(ref: Omit<FeatureRef, 'path'>, what: string): void;
}
// What the validator of a feature gets.
export interface ValidationContext extends RefContext {
  fields: Fields; // the reader of numeric fields
}

// A face exists only after the feature that named it and after every pattern that copied it.
export function requireFace(context: RefContext, face: FaceName, what: string): void {
  context.requireRef({ id: face.feature, kind: 'faceSource' }, what);
  for (const tag of face.copy ?? []) context.requireRef({ id: tag.pattern, kind: 'pattern' }, what);
}

export function planeRef(context: RefContext, v: unknown, what: string): PlaneRef {
  const o = object(v, what);
  const kind = oneOf(o.kind, ['base', 'plane', 'face'] as const, `${what}.kind`);
  if (kind === 'base') return { kind, plane: oneOf(o.plane, ['XY', 'XZ', 'YZ'] as const, `${what}.plane`) };
  if (kind === 'plane') {
    const feature = string(o.feature, `${what}.feature`);
    context.requireRef({ id: feature, kind: 'plane' }, what);
    return { kind, feature };
  }
  const body = string(o.body, `${what}.body`);
  context.requireRef({ id: body, kind: 'body' }, what);
  const face = faceName(o.face, `${what}.face`);
  requireFace(context, face, `${what}.face`);
  return { kind, body, face };
}

export const planeRefs = (ref: PlaneRef, path: string): FeatureRef[] =>
  ref.kind === 'plane' ? [{ path, id: ref.feature, kind: 'plane' }] : ref.kind === 'face' ? [{ path, id: ref.body, kind: 'body' }, ...faceRefs(ref.face, path)] : [];

export function axisRef(context: RefContext, v: unknown, what: string): AxisRef {
  const o = object(v, what);
  const kind = oneOf(o.kind, ['base', 'sketchPoint'] as const, `${what}.kind`);
  onlyFields(o, kind === 'base' ? ['kind', 'axis'] : ['kind', 'sketch', 'point'], what, `an axis of the kind ${kind}`);
  if (kind === 'base') return { kind, axis: oneOf(o.axis, ['X', 'Y', 'Z'] as const, `${what}.axis`) };
  const sketch = string(o.sketch, `${what}.sketch`);
  context.requireRef({ id: sketch, kind: 'sketch' }, `${what}.sketch`);
  const point = string(o.point, `${what}.point`);
  context.requireRef({ id: point, kind: 'entity', sketch, accepts: ['point'] }, `${what}.point`);
  return { kind, sketch, point };
}
export const axisRefs = (axis: AxisRef, path: string): FeatureRef[] =>
  axis.kind === 'base'
    ? []
    : [
        { path, id: axis.sketch, kind: 'sketch' },
        { path, id: axis.point, kind: 'entity', sketch: axis.sketch, accepts: ['point'] },
      ];

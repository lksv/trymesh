// Dokument: validace a provedení příkazů. Vše pracuje jen se strukturou dokumentu, bez přepočtu.
// Pravidla jsou v docs/architecture.md, sekce Příkazy.
import type {
  AxisRef,
  Check,
  Command,
  CommandResult,
  Constraint,
  CopyTag,
  Curve,
  Dimension,
  Document,
  EdgeName,
  Expr,
  ExternalRef,
  ExtrudeFeature,
  FaceName,
  Feature,
  FieldPath,
  GeneratorName,
  Id,
  Input,
  Parameter,
  PatternFeature,
  PlaneFeature,
  PlaneRef,
  ProfileSource,
  Projected,
  RegionRef,
  SketchFeature,
} from './types';
import { CONSTRAINTS, type EntityKind, type FieldSpec, MAX_NUMBER, type NumberSpec, checkNumber } from './catalog';
import { GENERATORS, isFlag } from './generators';
import { type Environment, analyzeExpression, evaluateNumber, evaluateParameters, parameterNameProblem, renameInExpression } from './expression';
import { ORIGIN, canonicalEdge, faceKey, has } from './util';

export const SCHEMA_VERSION = 2;

export const emptyDocument = (): Document => ({ schemaVersion: SCHEMA_VERSION, settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [] });

export const emptySketch = (id: Id, name: string, plane: PlaneRef): SketchFeature => ({
  id,
  name,
  suppressed: false,
  type: 'sketch',
  plane,
  points: {},
  radii: {},
  curves: {},
  constraints: {},
  external: {},
  solved: { inputs: '', external: {} },
});

// Neplatný příkaz nebo dokument. `commandIndex` říká, který příkaz dávky to byl.
type ExpressionProblem = NonNullable<Extract<CommandResult, { ok: false }>['error']['expression']>;
export class CommandError extends Error {
  commandIndex?: number;
  expression?: ExpressionProblem; // when the command rejected an expression: where and why
}
const fail = (message: string, expression?: ExpressionProblem): never => {
  const error = new CommandError(message);
  if (expression) error.expression = expression;
  throw error;
};

// ---------------------------------------------------------------- základní kontroly

type Dict = Record<string, unknown>;
const isObject = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const object = (v: unknown, what: string): Dict => (isObject(v) ? v : fail(`${what}: čeká se objekt`));
const string = (v: unknown, what: string): string => (typeof v === 'string' ? v : fail(`${what}: čeká se řetězec`));
// Čísla dokumentu: konečná a v rozumném rozsahu (souřadnice tělesa jsou float32). Záporná nula
// se ukládá jako nula, aby se uložený a znovu načtený dokument nelišil.
const finite = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${what}: čeká se konečné číslo`);
  if (Math.abs(v) > MAX_NUMBER) return fail(`${what}: číslo je mimo rozsah ±${MAX_NUMBER}`);
  return v + 0;
};
const boolean = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(`${what}: čeká se true nebo false`));
const oneOf = <T extends string>(v: unknown, options: readonly T[], what: string): T =>
  options.includes(v as T) ? (v as T) : fail(`${what}: čeká se jedna z hodnot ${options.join(', ')}`);

// ID generuje volající. Nesmí obsahovat `/` (odvozená ID promítnuté geometrie), nesmí být `origin`
// ani jméno vlastnosti, kterou má každý objekt (`constructor`, `toString`…): ID jsou klíče záznamů.
function newId(v: unknown, what: string): Id {
  const id = string(v, what);
  if (id === '' || id.includes('/') || id === ORIGIN || id in Object.prototype) fail(`${what}: ID "${id}" není přípustné`);
  return id;
}

// Všechna ID v dokumentu: features a entity všech skic.
function allIds(doc: Document): Set<Id> {
  const ids = new Set<Id>();
  for (const f of doc.features) {
    ids.add(f.id);
    if (f.type === 'sketch') for (const group of [f.points, f.curves, f.constraints, f.external]) for (const id of Object.keys(group)) ids.add(id);
  }
  return ids;
}
const sketchIds = (s: SketchFeature): Id[] => [s.points, s.curves, s.constraints, s.external].flatMap((group) => Object.keys(group));

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
type FieldMode = 'load' | 'add' | 'update';

// Reads the numeric fields of a feature during validation. The fields validation went through are
// the fields the feature has; `fieldsOf` and the check that `expressions` holds no address of
// a non-existent field both follow from that.
class Fields {
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
function plain(value: number, spec: NumberSpec, what: string): number {
  const checked = checkNumber(value, spec);
  return checked.ok ? checked.value : fail(`${what}: ${checked.message}`);
}

const expressionsOf = (o: Dict, what: string): Record<FieldPath, Expr> =>
  o.expressions === undefined ? {} : Object.fromEntries(Object.entries(object(o.expressions, `${what}.expressions`)).map(([path, expr]) => [path, string(expr, `${what}.expressions.${path}`)]));

const NO_ENVIRONMENT = (): Environment => ({});

const OFFSET: NumberSpec = { title: 'Offset', unit: 'mm' };
const EXTENT_START: NumberSpec = { title: 'Start', unit: 'mm' };
const EXTENT_DISTANCE: NumberSpec = { title: 'Distance', unit: 'mm', nonZero: true };
// The count of a pattern includes the original. The upper bound keeps a typo in an expression from
// starting thousands of booleans.
export const MAX_PATTERN_COUNT = 200;
const PATTERN_COUNT: NumberSpec = { title: 'Count', unit: 'count', integer: true, min: { value: 1 }, max: { value: MAX_PATTERN_COUNT } };
const PATTERN_ANGLE: NumberSpec = { title: 'Angle', unit: 'rad', min: { value: -2 * Math.PI }, max: { value: 2 * Math.PI }, nonZero: true };

// ---------------------------------------------------------------- jména a odkazy mezi features

// A face name in its canonical form. An empty `copy` is the same as none, so that one face has one
// spelling.
function faceName(v: unknown, what: string): FaceName {
  const o = object(v, what);
  const feature = string(o.feature, `${what}.feature`);
  const role = oneOf(o.role, ['side', 'startCap', 'endCap'] as const, `${what}.role`);
  const name: FaceName = role === 'side' ? { feature, role, curve: string(o.curve, `${what}.curve`) } : { feature, role };
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

// A face exists only after the feature that named it and after every pattern that copied it.
function requireFace(doc: Document, before: number | undefined, face: FaceName, what: string): void {
  requireRef(doc, before, { id: face.feature, kind: 'faceSource' }, what);
  for (const tag of face.copy ?? []) requireRef(doc, before, { id: tag.pattern, kind: 'pattern' }, what);
}
const faceRefs = (face: FaceName, path: string): FeatureRef[] => [{ path, id: face.feature, kind: 'faceSource' }, ...(face.copy ?? []).map((tag): FeatureRef => ({ path, id: tag.pattern, kind: 'pattern' }))];

function edgeName(v: unknown, what: string): EdgeName {
  const o = object(v, what);
  const edge = { a: faceName(o.a, `${what}.a`), b: faceName(o.b, `${what}.b`) };
  if (faceKey(edge.a) === faceKey(edge.b)) fail(`${what}: hrana je rozhraní dvou různých stěn`);
  return canonicalEdge(edge);
}

// Odkaz jedné feature na jinou. `path` je místo odkazu uvnitř feature (cesta oddělená lomítky).
// - `entity` is a reference to an entity of a sketch (an operand of a profile generator): `id` is the
//   entity, `sketch` its sketch and `accepts` the entity kinds allowed.
// - `generated` is a reference to an extrusion whose profile comes from one of the generators in
//   `accepts` (a gear in mesh with another gear).
// - `tool` is a reference to a feature that applies a tool to bodies and can be repeated by
//   a pattern: an extrusion with the operation add or cut.
// - `pattern` is a reference to a pattern (the one that made the copy a face name speaks of).
export type RefKind = 'plane' | 'sketch' | 'body' | 'faceSource' | 'entity' | 'generated' | 'tool' | 'pattern';
export interface FeatureRef {
  path: string;
  id: Id; // u `body` ID tělesa, u `entity` ID entity skici, jinak ID feature
  kind: RefKind;
  sketch?: Id;
  accepts?: readonly string[];
}
const REF_LABEL: Record<Exclude<RefKind, 'entity' | 'generated' | 'tool'>, string> = { plane: 'rovina', sketch: 'skica', body: 'těleso', faceSource: 'extrude', pattern: 'pole (pattern)' };

// ID tělesa je ID feature, která ho vytvořila, nebo `<feature>/<místní jméno>`, když jich feature
// vytváří víc. Lomítko v ID zadaném volajícím být nesmí, takže rozklad je jednoznačný.
export function bodyOwner(body: Id): { feature: Id; local?: string } {
  const slash = body.indexOf('/');
  return slash < 0 ? { feature: body } : { feature: body.slice(0, slash), local: body.slice(slash + 1) };
}

// Kde odkaz nastavuje příkaz (`before` je index odkazující feature), musí cíl existovat, mít
// správný druh a ležet před ní. Při načítání dokumentu (`before` není) se ověřuje jen tvar:
// odkaz na feature, která v dokumentu není, vzniká povoleným smazáním.
function requireRef(doc: Document, before: number | undefined, ref: Omit<FeatureRef, 'path'>, what: string): void {
  if (before === undefined) return;
  if (ref.kind === 'entity') {
    // The sketch itself is verified by its own reference; here only the entity inside it.
    const sketch = doc.features.find((f) => f.id === ref.sketch);
    if (!sketch || sketch.type !== 'sketch') return fail(`${what}: the sketch "${String(ref.sketch)}" of the entity "${ref.id}" does not exist`);
    const entity = entityOf(sketch, ref.id);
    if (!entity) return fail(`${what}: the sketch "${sketch.id}" has no entity "${ref.id}"`);
    if (!ref.accepts?.includes(entity.kind)) fail(`${what}: "${ref.id}" is a ${entity.kind}, expected ${(ref.accepts ?? []).join(' or ')}`);
    return;
  }
  const { feature, local } = ref.kind === 'body' ? bodyOwner(ref.id) : { feature: ref.id, local: undefined };
  const index = doc.features.findIndex((f) => f.id === feature);
  if (index < 0) fail(`${what}: feature "${ref.id}" neexistuje`);
  const target = doc.features[index];
  const spec = FEATURE_TYPES[target.type] as FeatureTypeSpec<Feature>;
  if (ref.kind === 'generated') {
    const generator = target.type === 'extrude' && target.profile.type === 'generated' ? target.profile.generator : undefined;
    if (generator === undefined || !ref.accepts?.includes(generator)) fail(`${what}: feature "${ref.id}" is not an extrusion with a profile from the generator ${(ref.accepts ?? []).join(' or ')}`);
  } else if (ref.kind === 'tool') {
    if (target.type !== 'extrude' || target.operation === 'new') fail(`${what}: feature "${ref.id}" is not an extrusion with the operation add or cut`);
  } else {
    const accepted = ref.kind === 'body' ? spec.createsBody(target, local) : ref.kind === 'faceSource' ? spec.namesFaces : target.type === ref.kind;
    if (!accepted) fail(`${what}: feature "${ref.id}" není ${REF_LABEL[ref.kind]}`);
  }
  if (index >= before) fail(`${what}: feature "${ref.id}" musí ležet před odkazující feature`);
}

function planeRef(doc: Document, before: number | undefined, v: unknown, what: string): PlaneRef {
  const o = object(v, what);
  const kind = oneOf(o.kind, ['base', 'plane', 'face'] as const, `${what}.kind`);
  if (kind === 'base') return { kind, plane: oneOf(o.plane, ['XY', 'XZ', 'YZ'] as const, `${what}.plane`) };
  if (kind === 'plane') {
    const feature = string(o.feature, `${what}.feature`);
    requireRef(doc, before, { id: feature, kind: 'plane' }, what);
    return { kind, feature };
  }
  const body = string(o.body, `${what}.body`);
  requireRef(doc, before, { id: body, kind: 'body' }, what);
  const face = faceName(o.face, `${what}.face`);
  requireFace(doc, before, face, `${what}.face`);
  return { kind, body, face };
}

function externalRef(doc: Document, before: number | undefined, v: unknown, what: string): ExternalRef {
  const o = object(v, what);
  if (o.type !== 'edge') fail(`${what}: promítnout jde jen hranu`);
  const body = string(o.body, `${what}.body`);
  requireRef(doc, before, { id: body, kind: 'body' }, what);
  const edge = edgeName(o.edge, `${what}.edge`);
  for (const face of [edge.a, edge.b]) requireFace(doc, before, face, `${what}.edge`);
  return { type: 'edge', body, edge, kind: oneOf(o.kind, ['line', 'circle'] as const, `${what}.kind`) };
}

function regions(v: unknown, what: string): RegionRef[] {
  if (!Array.isArray(v) || v.length === 0) fail(`${what}: čeká se neprázdný seznam oblastí`);
  const seen = new Set<string>();
  const out: RegionRef[] = [];
  (v as unknown[]).forEach((r, i) => {
    const loop = object(r, `${what}[${i}]`).outerLoop;
    if (!Array.isArray(loop) || loop.length === 0) fail(`${what}[${i}].outerLoop: čeká se neprázdný seznam ID křivek`);
    const ids = [...new Set((loop as unknown[]).map((id, k) => string(id, `${what}[${i}].outerLoop[${k}]`)))].sort();
    const key = JSON.stringify(ids);
    if (!seen.has(key)) out.push({ outerLoop: ids }); // tatáž oblast dvakrát je jedna oblast
    seen.add(key);
  });
  return out;
}

// ---------------------------------------------------------------- entity skici

export type { EntityKind };
export interface Entity {
  kind: EntityKind;
  own: boolean; // false = počátek nebo promítnutá geometrie: solver s ní nehýbe
}

// Odvozené entity promítnuté geometrie plynou z `kind`: `<id>`, `<id>/a`, `<id>/b` u úsečky,
// `<id>`, `<id>/center` u kružnice.
export function derivedPoints(id: Id, ref: ExternalRef): Id[] {
  return ref.kind === 'line' ? [`${id}/a`, `${id}/b`] : [`${id}/center`];
}

export function entityOf(sketch: SketchFeature, id: Id): Entity | undefined {
  if (id === ORIGIN) return { kind: 'point', own: false };
  if (has(sketch.points, id)) return { kind: 'point', own: true };
  if (has(sketch.curves, id)) return { kind: sketch.curves[id].type, own: true };
  if (has(sketch.external, id)) return { kind: sketch.external[id].kind, own: false };
  const slash = id.indexOf('/');
  if (slash > 0) {
    const parent = id.slice(0, slash);
    if (has(sketch.external, parent) && derivedPoints(parent, sketch.external[parent]).includes(id)) return { kind: 'point', own: false };
  }
  return undefined;
}

export function curvePoints(curve: Curve): Id[] {
  if (curve.type === 'line') return [curve.a, curve.b];
  if (curve.type === 'circle') return [curve.center];
  return [curve.center, curve.start, curve.end];
}

// Operandy vazby v pořadí katalogu.
export function constraintOperands(c: Constraint): Id[] {
  return CONSTRAINTS[c.type].operands.map((operand) => (c as unknown as Record<string, Id>)[operand.field]);
}

// A dimension is a constraint the catalog marks with the `dimension` flag: it has a value and `driving`.
export const isDimension = (c: Constraint): c is Dimension => CONSTRAINTS[c.type].dimension === true;

// The address of a constraint value among the numeric fields of a sketch.
export const constraintPath = (constraint: Id, value = 'value'): FieldPath => `constraints/${constraint}/${value}`;

// Vazby, které dostává solver: geometrické a řídicí kóty.
export const isDriving = (c: Constraint): boolean => !isDimension(c) || c.driving;

// Klíč vazby pro hledání duplicit: typ a operandy. Operandy, které katalog označuje za
// zaměnitelné (u orientovaných kót a úhlu záměna jen obrací znaménko hodnoty), se seřadí.
export function constraintKey(c: Constraint): string {
  const spec = CONSTRAINTS[c.type];
  const value = (field: string): Id => (c as unknown as Record<string, Id>)[field];
  const unordered = (spec.unordered ?? []).map(value).sort();
  const ordered = spec.operands.filter((operand) => !spec.unordered?.includes(operand.field)).map((operand) => value(operand.field));
  return JSON.stringify([c.type, ...unordered, ...ordered]);
}

// Řídicí vazba se stejným typem a operandy, která už ve skice je (kromě vazby `except`).
export function duplicateOf(sketch: SketchFeature, c: Constraint, except?: Id): Id | undefined {
  if (!isDriving(c)) return undefined;
  const key = constraintKey(c);
  return Object.keys(sketch.constraints).find((id) => id !== except && isDriving(sketch.constraints[id]) && constraintKey(sketch.constraints[id]) === key);
}

// A fixed point given without a coordinate is fixed where it is: the coordinate is filled in from
// the position the sketch has stored for the point. That is its last solved position; for a point
// added earlier in the same batch it is the estimate the batch gave it, since the sketch is solved
// once after the whole batch.
function withPosition(sketch: SketchFeature, given: unknown): unknown {
  if (!isObject(given) || given.type !== 'fixed' || typeof given.point !== 'string' || !has(sketch.points, given.point)) return given;
  const at = sketch.points[given.point];
  return { ...given, x: given.x === undefined ? at.x : given.x, y: given.y === undefined ? at.y : given.y };
}

// Křivka smí odkazovat jen na vlastní body skici a na počátek.
function curve(sketch: SketchFeature, v: unknown, what: string): Curve {
  const o = object(v, what);
  const type = oneOf(o.type, ['line', 'circle', 'arc'] as const, `${what}.type`);
  const point = (field: string): Id => {
    const id = string(o[field], `${what}.${field}`);
    if (id !== ORIGIN && !has(sketch.points, id)) fail(`${what}.${field}: "${id}" není vlastní bod skici ani počátek`);
    return id;
  };
  const construction = o.construction === undefined ? {} : { construction: boolean(o.construction, `${what}.construction`) };
  if (type === 'line') {
    const [a, b] = [point('a'), point('b')];
    if (a === b) fail(`${what}: úsečka potřebuje dva různé body`);
    return { ...construction, type, a, b };
  }
  if (type === 'circle') return { ...construction, type, center: point('center') };
  const [center, start, end] = [point('center'), point('start'), point('end')];
  if (center === start || center === end || start === end) fail(`${what}: oblouk potřebuje tři různé body`);
  return { ...construction, type, center, start, end };
}

// Vazba podle katalogu: operandy existují, mají správný druh a jsou navzájem různé, hodnota
// splňuje konvenci znamének a aspoň jedním operandem může solver hýbat (řídicí vazbu jen mezi
// pevnými entitami solver tiše ignoruje).
function constraint(sketch: SketchFeature, v: unknown, what: string, fields: Fields, id: Id): Constraint {
  const o = object(v, what);
  const type = string(o.type, `${what}.type`);
  if (!has(CONSTRAINTS, type)) return fail(`${what}.type: neznámá vazba "${type}"`);
  const spec = CONSTRAINTS[type as Constraint['type']];
  const operands: Record<string, Id> = {};
  const kinds: EntityKind[] = [];
  for (const { field, kinds: accepted } of spec.operands) {
    const id = string(o[field], `${what}.${field}`);
    const entity = entityOf(sketch, id);
    if (!entity) return fail(`${what}.${field}: entita "${id}" ve skice není`);
    if (!accepted.includes(entity.kind)) fail(`${what}.${field}: "${id}" je ${entity.kind}, čeká se ${accepted.join(' nebo ')}`);
    operands[field] = id;
    kinds.push(entity.kind);
  }
  if (new Set(Object.values(operands)).size < spec.operands.length) fail(`${what}: vazba potřebuje ${spec.operands.length === 2 ? 'dvě' : spec.operands.length} různé entity`);
  const pointsOf = (id: Id): Id[] => (has(sketch.curves, id) ? curvePoints(sketch.curves[id]) : has(sketch.external, id) ? derivedPoints(id, sketch.external[id]) : []);
  const problem = spec.check?.(kinds, Object.values(operands), pointsOf);
  if (problem) fail(`${what}: ${problem}`);
  const movable = Object.values(operands).some((operand) => entityOf(sketch, operand)?.own);
  const onlyFixed = (): never => fail(`${what}: vazba jen mezi pevnými entitami (počátek, promítnutá geometrie) by se nikdy neprojevila`);
  // said before the values are read: a fixed point on the origin has no coordinates to complain about
  if (!spec.dimension && !movable) onlyFixed();
  let values: Record<string, number | boolean> = {};
  if (spec.dimension && spec.values) {
    // A driving dimension is a numeric field and may have an expression; a reference one only measures.
    const driving = boolean(o.driving, `${what}.driving`);
    if (!driving && typeof o.value === 'string') fail(`${what}.value: a reference dimension cannot have an expression`);
    const value = driving ? fields.number(o.value, constraintPath(id), spec.values.value, `${what}.value`) : plain(finite(o.value, `${what}.value`), spec.values.value, `${what}.value`);
    values = { value, driving };
  } else if (spec.values) {
    // values of a constraint that is not a dimension (the coordinates of a fixed point): numeric fields
    for (const [name, number] of Object.entries(spec.values)) values[name] = fields.number(o[name], constraintPath(id, name), number, `${what}.${name}`);
  }
  const result = { type, ...operands, ...values } as Constraint;
  if (isDriving(result) && !movable) onlyFixed();
  return result;
}

function projected(v: unknown, what: string): Projected {
  const o = object(v, what);
  const vec2 = (value: unknown, name: string): [number, number] => {
    if (!Array.isArray(value) || value.length !== 2) fail(`${what}.${name}: čeká se dvojice čísel`);
    const pair = value as unknown[];
    return [finite(pair[0], `${what}.${name}`), finite(pair[1], `${what}.${name}`)];
  };
  if (o.kind === 'line') return { kind: 'line', a: vec2(o.a, 'a'), b: vec2(o.b, 'b') };
  if (o.kind === 'circle') {
    const radius = finite(o.radius, `${what}.radius`);
    if (radius <= 0) fail(`${what}.radius: poloměr musí být kladný`);
    return { kind: 'circle', center: vec2(o.center, 'center'), radius };
  }
  return fail(`${what}.kind: čeká se line nebo circle`);
}

// ---------------------------------------------------------------- features

function base(o: Dict, what: string): { id: Id; name: string; suppressed: boolean } {
  return { id: newId(o.id, `${what}.id`), name: string(o.name, `${what}.name`), suppressed: boolean(o.suppressed, `${what}.suppressed`) };
}

function planeFeature(doc: Document, before: number | undefined, o: Dict, what: string, fields: Fields): PlaneFeature {
  return { ...base(o, what), type: 'plane', base: planeRef(doc, before, o.base, `${what}.base`), offset: fields.number(o.offset, 'offset', OFFSET, `${what}.offset`) };
}

const PROFILE_FIELDS: Record<ProfileSource['type'], readonly string[]> = { regions: ['type', 'sketch', 'regions'], generated: ['type', 'generator', 'sketch', 'operands', 'params', 'refs'] };

// What `null` in a patch may remove from a profile that does not have it: an entry of a dictionary
// the generator catalog knows (a parameter returns to its default, a reference is not set) and the
// dictionary of references itself. Anything else that is not there is a typo.
function removableFromProfile(profile: ProfileSource, path: string[]): boolean {
  if (profile.type !== 'generated') return false;
  const spec = GENERATORS[profile.generator];
  const [dictionary, name, ...rest] = path;
  if (rest.length) return false;
  if (name === undefined) return dictionary === 'refs';
  if (dictionary === 'params') return has(spec.params, name);
  if (dictionary === 'refs') return has(spec.refs, name);
  return dictionary === 'operands' && spec.operands.some((operand) => operand.field === name);
}

// The profile source of an extrusion. A generated profile follows the generator catalog: operands
// and references by its names, parameters with its ranges and defaults, in the order of the catalog.
function profileSource(doc: Document, before: number | undefined, v: unknown, what: string, fields: Fields): ProfileSource {
  const profile = object(v, what);
  const type = oneOf(profile.type, ['regions', 'generated'] as const, `${what}.type`);
  // A field of the other variant is a mistake: a profile of regions with generator parameters would
  // otherwise be accepted as plain regions.
  for (const key of Object.keys(profile)) if (!PROFILE_FIELDS[type].includes(key)) fail(`${what}.${key}: a profile of the type ${type} has no such field`);
  const sketch = string(profile.sketch, `${what}.sketch`);
  requireRef(doc, before, { id: sketch, kind: 'sketch' }, `${what}.sketch`);
  if (type === 'regions') return { type, sketch, regions: regions(profile.regions, `${what}.regions`) };
  const generator = oneOf(profile.generator, Object.keys(GENERATORS) as GeneratorName[], `${what}.generator`);
  const spec = GENERATORS[generator];
  // a dictionary of the profile: only the names the catalog knows
  const dictionary = (name: string, known: object, optional = false): Dict => {
    if (optional && profile[name] === undefined) return {};
    const given = object(profile[name], `${what}.${name}`);
    for (const key of Object.keys(given)) if (!has(known, key)) fail(`${what}.${name}.${key}: the generator ${generator} has no such entry`);
    return given;
  };
  const givenOperands = dictionary('operands', Object.fromEntries(spec.operands.map((operand) => [operand.field, true])));
  const operands: Record<string, Id> = {};
  for (const { field, kinds } of spec.operands) {
    operands[field] = string(givenOperands[field], `${what}.operands.${field}`);
    requireRef(doc, before, { id: operands[field], kind: 'entity', sketch, accepts: kinds }, `${what}.operands.${field}`);
  }
  const givenParams = dictionary('params', spec.params);
  const params: Record<string, number | boolean | string> = {};
  for (const [name, param] of Object.entries(spec.params)) {
    const value = givenParams[name];
    const at = `${what}.params.${name}`;
    if (isFlag(param)) params[name] = value === undefined ? param.default : boolean(value, at);
    else if (value === undefined && param.default === undefined) fail(`${at}: the parameter is required`);
    else params[name] = fields.number(value === undefined ? param.default : value, `profile/params/${name}`, param, at);
  }
  const givenRefs = dictionary('refs', spec.refs, true);
  const refs: Record<string, Id> = {};
  for (const [name, ref] of Object.entries(spec.refs)) {
    if (givenRefs[name] === undefined) continue;
    refs[name] = string(givenRefs[name], `${what}.refs.${name}`);
    requireRef(doc, before, { id: refs[name], kind: 'generated', accepts: ref.generators }, `${what}.refs.${name}`);
  }
  return { type, generator, sketch, operands, params, ...(Object.keys(refs).length ? { refs } : {}) };
}

// References of a profile source to other features and to entities of its sketch.
function profileRefs(profile: ProfileSource): FeatureRef[] {
  const sketch: FeatureRef = { path: 'profile/sketch', id: profile.sketch, kind: 'sketch' };
  if (profile.type === 'regions') return [sketch];
  const spec = GENERATORS[profile.generator];
  return [
    sketch,
    ...spec.operands.map((operand): FeatureRef => ({ path: `profile/operands/${operand.field}`, id: profile.operands[operand.field], kind: 'entity', sketch: profile.sketch, accepts: operand.kinds })),
    ...Object.entries(profile.refs ?? {}).map(([name, id]): FeatureRef => ({ path: `profile/refs/${name}`, id, kind: 'generated', accepts: spec.refs[name].generators })),
  ];
}

function extrudeFeature(doc: Document, before: number | undefined, o: Dict, what: string, fields: Fields): ExtrudeFeature {
  const profile = profileSource(doc, before, o.profile, `${what}.profile`, fields);
  const operation = oneOf(o.operation, ['new', 'add', 'cut'] as const, `${what}.operation`);
  const given = object(o.extent, `${what}.extent`);
  let extent: ExtrudeFeature['extent'];
  if (oneOf(given.type, ['distance', 'throughAll'] as const, `${what}.extent.type`) === 'distance') {
    const start = fields.number(given.start, 'extent/start', EXTENT_START, `${what}.extent.start`);
    extent = { type: 'distance', start, distance: fields.number(given.distance, 'extent/distance', EXTENT_DISTANCE, `${what}.extent.distance`) };
  } else {
    // The length comes from the targets, so there must be some: only a cut goes through all.
    if (operation !== 'cut') fail(`${what}.extent.type: throughAll is only for the operation cut`);
    extent = { type: 'throughAll', side: oneOf(given.side, ['forward', 'backward', 'both'] as const, `${what}.extent.side`) };
  }
  const feature: ExtrudeFeature = {
    ...base(o, what),
    type: 'extrude',
    profile,
    extent,
    operation,
  };
  if (operation === 'new') {
    if (o.targets !== undefined) fail(`${what}.targets: nové těleso nemá cíl`);
    return feature;
  }
  // Adding to several bodies would merge them; a cut may go through several (a screw hole through
  // two bolted parts).
  if (!Array.isArray(o.targets) || o.targets.length === 0 || (operation === 'add' && o.targets.length !== 1)) {
    return fail(`${what}.targets: operation ${operation} needs ${operation === 'add' ? 'exactly one target body' : 'at least one target body'}`);
  }
  const targets = (o.targets as unknown[]).map((target, i) => string(target, `${what}.targets[${i}]`));
  if (new Set(targets).size < targets.length) fail(`${what}.targets: a target body is listed twice`);
  for (const target of targets) requireRef(doc, before, { id: target, kind: 'body' }, `${what}.targets`);
  return { ...feature, targets };
}

// A field of another variant is a mistake, not something to drop silently: a pattern of a body
// given a list of features too would otherwise be stored as something else than what was sent.
function onlyFields(o: Dict, fields: readonly string[], what: string, owner: string): void {
  // a key without a value is not a field (in-process callers build objects that way; JSON has none)
  for (const key of Object.keys(o)) if (o[key] !== undefined && !fields.includes(key)) fail(`${what}.${key}: ${owner} has no such field`);
}

function axisRef(doc: Document, before: number | undefined, v: unknown, what: string): AxisRef {
  const o = object(v, what);
  const kind = oneOf(o.kind, ['base', 'sketchPoint'] as const, `${what}.kind`);
  onlyFields(o, kind === 'base' ? ['kind', 'axis'] : ['kind', 'sketch', 'point'], what, `an axis of the kind ${kind}`);
  if (kind === 'base') return { kind, axis: oneOf(o.axis, ['X', 'Y', 'Z'] as const, `${what}.axis`) };
  const sketch = string(o.sketch, `${what}.sketch`);
  requireRef(doc, before, { id: sketch, kind: 'sketch' }, `${what}.sketch`);
  const point = string(o.point, `${what}.point`);
  requireRef(doc, before, { id: point, kind: 'entity', sketch, accepts: ['point'] }, `${what}.point`);
  return { kind, sketch, point };
}
const axisRefs = (axis: AxisRef, path: string): FeatureRef[] =>
  axis.kind === 'base'
    ? []
    : [
        { path, id: axis.sketch, kind: 'sketch' },
        { path, id: axis.point, kind: 'entity', sketch: axis.sketch, accepts: ['point'] },
      ];

function patternFeature(doc: Document, before: number | undefined, o: Dict, what: string, fields: Fields): PatternFeature {
  const given = object(o.source, `${what}.source`);
  let source: PatternFeature['source'];
  const sourceType = oneOf(given.type, ['features', 'body'] as const, `${what}.source.type`);
  onlyFields(given, ['type', sourceType === 'features' ? 'features' : 'body'], `${what}.source`, `a source of the type ${sourceType}`);
  if (sourceType === 'features') {
    if (!Array.isArray(given.features) || given.features.length === 0) return fail(`${what}.source.features: a non-empty list of feature IDs is expected`);
    const features = (given.features as unknown[]).map((id, i) => string(id, `${what}.source.features[${i}]`));
    if (new Set(features).size < features.length) fail(`${what}.source.features: a feature is listed twice`);
    for (const id of features) requireRef(doc, before, { id, kind: 'tool' }, `${what}.source.features`);
    source = { type: 'features', features };
  } else {
    const body = string(given.body, `${what}.source.body`);
    requireRef(doc, before, { id: body, kind: 'body' }, `${what}.source.body`);
    source = { type: 'body', body };
  }
  const transform = object(o.transform, `${what}.transform`);
  const type = oneOf(transform.type, ['circular'] as const, `${what}.transform.type`);
  onlyFields(transform, ['type', 'axis', 'count', 'span'], `${what}.transform`, `a transform of the type ${type}`);
  const axis = axisRef(doc, before, transform.axis, `${what}.transform.axis`);
  const count = fields.number(transform.count, 'transform/count', PATTERN_COUNT, `${what}.transform.count`);
  const span = object(transform.span, `${what}.transform.span`);
  const full = oneOf(span.type, ['full', 'angle'] as const, `${what}.transform.span.type`) === 'full';
  onlyFields(span, full ? ['type'] : ['type', 'angle'], `${what}.transform.span`, `a span of the type ${full ? 'full' : 'angle'}`);
  return {
    ...base(o, what),
    type: 'pattern',
    source,
    transform: { type, axis, count, span: full ? { type: 'full' } : { type: 'angle', angle: fields.number(span.angle, 'transform/span/angle', PATTERN_ANGLE, `${what}.transform.span.angle`) } },
  };
}

function sketchFeature(doc: Document, before: number | undefined, o: Dict, what: string, fields: Fields): SketchFeature {
  const sketch = emptySketch(newId(o.id, `${what}.id`), string(o.name, `${what}.name`), planeRef(doc, before, o.plane, `${what}.plane`));
  sketch.suppressed = boolean(o.suppressed, `${what}.suppressed`);
  const seen = new Set<Id>();
  const entries = (v: unknown, name: string): [Id, unknown][] =>
    Object.entries(object(v, `${what}.${name}`)).map(([key, value]) => {
      const id = newId(key, `${what}.${name}`);
      if (seen.has(id)) fail(`${what}.${name}: ID "${id}" je ve skice dvakrát`);
      seen.add(id);
      return [id, value];
    });
  for (const [id, value] of entries(o.points, 'points')) {
    const p = object(value, `${what}.points.${id}`);
    sketch.points[id] = { x: finite(p.x, `${what}.points.${id}.x`), y: finite(p.y, `${what}.points.${id}.y`) };
  }
  for (const [id, value] of entries(o.external, 'external')) sketch.external[id] = externalRef(doc, before, value, `${what}.external.${id}`);
  for (const [id, value] of entries(o.curves, 'curves')) sketch.curves[id] = curve(sketch, value, `${what}.curves.${id}`);
  for (const [id, value] of Object.entries(object(o.radii, `${what}.radii`))) {
    if (!has(sketch.curves, id) || sketch.curves[id].type !== 'circle') fail(`${what}.radii: "${id}" není kružnice`);
    sketch.radii[id] = finite(value, `${what}.radii.${id}`);
    if (sketch.radii[id] <= 0) fail(`${what}.radii.${id}: poloměr musí být kladný`);
  }
  for (const [id, c] of Object.entries(sketch.curves)) if (c.type === 'circle' && !has(sketch.radii, id)) fail(`${what}.radii: kružnice "${id}" nemá poloměr`);
  for (const [id, value] of entries(o.constraints, 'constraints')) sketch.constraints[id] = constraint(sketch, value, `${what}.constraints.${id}`, fields, id);
  const solved = object(o.solved, `${what}.solved`);
  sketch.solved.inputs = string(solved.inputs, `${what}.solved.inputs`);
  for (const [id, value] of Object.entries(object(solved.external, `${what}.solved.external`))) {
    const stored = projected(value, `${what}.solved.external.${id}`);
    if (!has(sketch.external, id) || sketch.external[id].kind !== stored.kind) fail(`${what}.solved.external: "${id}" neodpovídá promítnuté geometrii skici`);
    sketch.solved.external[id] = stored;
  }
  return sketch;
}

// ---------------------------------------------------------------- registr typů features

// Veřejný popis typu feature (pro UI a popis API).
export interface FeatureTypeInfo {
  title: string;
  summary: string;
  // Numeric fields of the type (unit, range) that accept an expression. Sketch constraint values are
  // not listed here: the constraint catalog describes them (`values`), the address is
  // `constraints/<id>/<value name>`.
  fields: readonly FieldSpec[];
  // Which bodies the type can create: `self` a body with the feature's ID, `derived` bodies
  // `<feature>/<local name>`. Whether a particular feature does is up to the registry (an extrusion
  // only with the operation new, a pattern only with a body as its source).
  bodies: 'none' | 'self' | 'derived';
  updatable: readonly string[]; // pole, která mění příkaz updateFeature; prázdné = má vlastní příkazy
}

// Typ feature jako položka registru: vše, co o něm dokument potřebuje vědět. Krok přepočtu typu
// je v evaluate.ts; úplnost obou míst hlídá překladač (záznam podle `Feature['type']`).
interface FeatureTypeSpec<F extends Feature> {
  info: Omit<FeatureTypeInfo, 'updatable'>;
  // Ověří feature a vrátí její kanonickou kopii. `before`: viz requireRef.
  // Numeric fields are read through `fields`.
  validate(doc: Document, before: number | undefined, o: Dict, what: string, fields: Fields): F;
  // Odkazy na jiné features s místem, kde ve feature leží.
  refs(f: F): FeatureRef[];
  // Vytváří feature těleso s tímto ID? `local` je část ID za lomítkem (bez lomítka chybí).
  createsBody(f: F, local: string | undefined): boolean;
  namesFaces: boolean; // pojmenovává feature stěny těles?
  // Pole, která smí měnit updateFeature; bez nich feature tímto příkazem měnit nejde.
  // `removable`: may `null` in a patch name this path although the feature did not have it? (An
  // optional field, an entry of a dictionary with known names.) `f` is the feature after the change.
  patch?: { fields: readonly string[]; normalize?(merged: Dict, patch: Dict): void; removable?(f: F, path: string[]): boolean };
}

const planeRefs = (ref: PlaneRef, path: string): FeatureRef[] =>
  ref.kind === 'plane' ? [{ path, id: ref.feature, kind: 'plane' }] : ref.kind === 'face' ? [{ path, id: ref.body, kind: 'body' }, ...faceRefs(ref.face, path)] : [];

const FEATURE_TYPES: { [K in Feature['type']]: FeatureTypeSpec<Extract<Feature, { type: K }>> } = {
  plane: {
    info: { title: 'Rovina', summary: 'Vlastní rovina posunutá od základní roviny, jiné vlastní roviny nebo rovinné stěny tělesa.', fields: [{ path: 'offset', spec: OFFSET }], bodies: 'none' },
    validate: planeFeature,
    refs: (f) => planeRefs(f.base, 'base'),
    createsBody: () => false,
    namesFaces: false,
    patch: { fields: ['base', 'offset'] },
  },
  sketch: {
    info: { title: 'Skica', summary: 'Rovinná skica: body, křivky, vazby a kóty; její uzavřené oblasti se vysouvají.', fields: [], bodies: 'none' },
    validate: sketchFeature,
    refs: (f) => [
      ...planeRefs(f.plane, 'plane'),
      ...Object.entries(f.external).flatMap(([id, ref]): FeatureRef[] => [
        { path: `external/${id}`, id: ref.body, kind: 'body' },
        ...faceRefs(ref.edge.a, `external/${id}`),
        ...faceRefs(ref.edge.b, `external/${id}`),
      ]),
    ],
    createsBody: () => false,
    namesFaces: false,
  },
  extrude: {
    info: {
      title: 'Vysunutí',
      summary:
        'Vysune profil ve směru normály roviny skici: nové těleso, přidání k tělesu, nebo odebrání z tělesa. A cut may have several target bodies and may go through all of them (extent throughAll). ' +
        'The profile is a set of regions of a sketch, or comes from a profile generator (see Profile generators).',
      fields: [
        ...Object.entries(GENERATORS).flatMap(([generator, spec]) =>
          Object.entries(spec.params).flatMap(([name, param]): FieldSpec[] => (isFlag(param) ? [] : [{ path: `profile/params/${name}`, spec: param, when: { path: 'profile/generator', equals: generator } }])),
        ),
        { path: 'extent/start', spec: EXTENT_START, when: { path: 'extent/type', equals: 'distance' } },
        { path: 'extent/distance', spec: EXTENT_DISTANCE, when: { path: 'extent/type', equals: 'distance' } },
      ],
      bodies: 'self',
    },
    validate: extrudeFeature,
    refs: (f) => [...profileRefs(f.profile), ...(f.targets ?? []).map((id): FeatureRef => ({ path: 'targets', id, kind: 'body' }))],
    createsBody: (f, local) => local === undefined && f.operation === 'new',
    namesFaces: true,
    patch: {
      fields: ['profile', 'extent', 'operation', 'targets'],
      // změna na nové těleso ruší cíle, pokud je změna sama neuvádí
      normalize: (merged, patch) => {
        if (merged.operation === 'new' && !has(patch, 'targets')) delete merged.targets;
      },
      removable: (f, [field, ...rest]) => (field === 'targets' ? rest.length === 0 : field === 'profile' && removableFromProfile(f.profile, rest)),
    },
  },
  pattern: {
    info: {
      title: 'Pattern',
      summary:
        'Repeats its source around an axis: a list of extrusions with the operation add or cut (each copy of their tools is applied to the targets of the feature it comes from), or a finished body (the copies are new bodies `<pattern>/<number>`, numbered from 1). ' +
        'The count includes the original. The copies go around the full circle (`span: { type: "full" }`) or within an angle between the first and the last copy.',
      fields: [
        { path: 'transform/count', spec: PATTERN_COUNT },
        { path: 'transform/span/angle', spec: PATTERN_ANGLE, when: { path: 'transform/span/type', equals: 'angle' } },
      ],
      bodies: 'derived',
    },
    validate: patternFeature,
    refs: (f) => [
      ...(f.source.type === 'features' ? f.source.features.map((id): FeatureRef => ({ path: 'source/features', id, kind: 'tool' })) : [{ path: 'source/body', id: f.source.body, kind: 'body' } as FeatureRef]),
      ...axisRefs(f.transform.axis, 'transform/axis'),
    ],
    // Copies are numbered from 1. Whether the copy with that number exists shows in the recompute:
    // the count may be an expression.
    createsBody: (f, local) => f.source.type === 'body' && local !== undefined && /^[1-9][0-9]*$/.test(local),
    namesFaces: false,
    patch: { fields: ['source', 'transform'] },
  },
};

// Veřejná část registru.
export const FEATURE_TYPE_INFO: Record<Feature['type'], FeatureTypeInfo> = Object.fromEntries(
  Object.entries(FEATURE_TYPES).map(([type, spec]) => [type, { ...spec.info, updatable: (spec as FeatureTypeSpec<Feature>).patch?.fields ?? [] }]),
) as Record<Feature['type'], FeatureTypeInfo>;

const specOf = (f: Feature): FeatureTypeSpec<Feature> => FEATURE_TYPES[f.type] as FeatureTypeSpec<Feature>;

// Validates a feature and returns its canonical copy. `before`: see requireRef; `mode`: see FieldMode.
function feature(doc: Document, before: number | undefined, v: unknown, what: string, mode: FieldMode): Feature {
  const o = object(v, what);
  const type = oneOf(o.type, Object.keys(FEATURE_TYPES) as Feature['type'][], `${what}.type`);
  return validated(FEATURE_TYPES[type] as FeatureTypeSpec<Feature>, doc, before, o, what, mode);
}

function validated(spec: FeatureTypeSpec<Feature>, doc: Document, before: number | undefined, o: Dict, what: string, mode: FieldMode): Feature {
  const fields = new Fields(mode, expressionsOf(o, what), () => evaluateParameters(doc.parameters));
  const checked = spec.validate(doc, before, o, what, fields);
  const expressions = fields.expressions(what);
  return expressions ? { ...checked, expressions } : checked;
}

const EMPTY: Document = { schemaVersion: SCHEMA_VERSION, settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [] };
const fieldCache = new WeakMap<Feature, FieldInfo[]>();

// Numeric fields of a feature that accept an expression: driving inputs only, not the coordinates
// and radii the solver computes, nor the values of reference dimensions. Derived from a validation
// pass, so it matches what commands accept.
export function fieldsOf(f: Feature): FieldInfo[] {
  let found = fieldCache.get(f);
  if (!found) {
    const fields = new Fields('load', f.expressions ?? {}, NO_ENVIRONMENT);
    specOf(f).validate(EMPTY, undefined, f as unknown as Dict, 'feature', fields);
    fieldCache.set(f, (found = fields.found));
  }
  return found;
}

// The value at an address inside an object, and a copy of the object with another value at the address.
export function atPath(value: unknown, path: FieldPath): unknown {
  let current = value;
  for (const key of path.split('/')) {
    if (!isObject(current) || !has(current, key)) return undefined;
    current = current[key];
  }
  return current;
}
export function withPath<T>(value: T, path: FieldPath, leaf: unknown): T {
  const set = (current: unknown, keys: string[]): unknown => (keys.length === 0 ? leaf : { ...(isObject(current) ? current : {}), [keys[0]]: set(isObject(current) ? current[keys[0]] : undefined, keys.slice(1)) });
  return set(value, path.split('/')) as T;
}

// The input form of a feature: numeric fields that have an expression carry it as a string and the
// `expressions` map is absent. `addFeature` with this form gives the same feature back; a form that
// sends the whole feature when editing starts from it, otherwise the numbers in the command would
// remove the expressions.
export function featureInput<F extends Feature>(f: F): Input<F> {
  const { expressions, ...rest } = f;
  return Object.entries(expressions ?? {}).reduce((input, [path, expr]) => withPath(input, path, expr), rest as unknown) as Input<F>;
}

// Features, na které feature odkazuje: rovina, skica, feature, která vytvořila těleso, a extrude,
// které pojmenovaly stěnu (stěna i hrana existují až po feature, která je vytvořila).
export function featureRefs(f: Feature): Id[] {
  return [
    ...new Set(
      specOf(f)
        .refs(f)
        .filter((ref) => ref.kind !== 'entity') // an entity belongs to a sketch that is referred to anyway
        .map((ref) => (ref.kind === 'body' ? bodyOwner(ref.id).feature : ref.id)),
    ),
  ];
}

// What makes an object a variant: its `type` and, for a generated profile, its `generator`. A patch
// that names another one replaces the object; a patch that names none or the same one merges.
const VARIANT_KEYS = ['type', 'generator'];
const sameVariant = (old: Dict, patch: Dict): boolean => VARIANT_KEYS.every((key) => patch[key] === undefined || patch[key] === old[key]);

// Slučovací změna (příkaz updateFeature): varianta se stejným `type` se slučuje po polích, jiná
// varianta, odkaz (objekt s `kind`) a seznam dosavadní hodnotu nahradí, `null` pole odebere.
// A dictionary (operands, parameters and references of a generated profile) merges by entry.
function mergePatch(old: unknown, patch: unknown, what: string): unknown {
  if (!isObject(patch) || has(patch, 'kind')) return patch;
  // odkaz se po polích neslučuje: půlka odkazu by vybrala jinou stěnu téhož tělesa
  if (isObject(old) && has(old, 'kind')) fail(`${what}: odkaz se nahrazuje celý, čeká se objekt s polem kind`);
  // Nothing to merge with: the patch is the new value. A `null` in it removes an entry that is not
  // there (a form sends `refs: { meshWith: null }` whether the feature had the reference or not).
  if (!isObject(old) || !sameVariant(old, patch)) return withoutNulls(patch);
  const out: Dict = { ...old };
  for (const [key, value] of Object.entries(patch)) {
    if (key in Object.prototype) fail(`${what}.${key}: takové pole feature nemá`);
    if (value === null) delete out[key];
    else out[key] = mergePatch(old[key], value, `${what}.${key}`);
  }
  return out;
}

const withoutNulls = (value: unknown): unknown =>
  isObject(value) && !has(value, 'kind')
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== null)
          .map(([key, item]) => [key, withoutNulls(item)]),
      )
    : value;

// Addresses the patch overwrites as a whole (a leaf, a list, a reference, another variant, a removed
// field). Expressions at and below them cease to exist; fields the patch does not mention keep theirs.
function replacedPaths(old: unknown, patch: Dict, prefix: string[] = []): string[] {
  return Object.entries(patch).flatMap(([key, value]) => {
    const before = isObject(old) ? old[key] : undefined;
    const merges = isObject(value) && !has(value, 'kind') && isObject(before) && sameVariant(before, value);
    return merges ? replacedPaths(before, value as Dict, [...prefix, key]) : [[...prefix, key].join('/')];
  });
}

// Cesty k hodnotám, které změna nastavuje: listy, seznamy a odkazy (odebraná pole ne).
function patchPaths(patch: Dict, prefix: string[] = []): string[][] {
  return Object.entries(patch).flatMap(([key, value]) => (value === null ? [] : isObject(value) && !has(value, 'kind') ? patchPaths(value, [...prefix, key]) : [[...prefix, key]]));
}
// Paths the patch removes (`null`).
function removedPaths(patch: Dict, prefix: string[] = []): string[][] {
  return Object.entries(patch).flatMap(([key, value]) => (value === null ? [[...prefix, key]] : isObject(value) && !has(value, 'kind') ? removedPaths(value, [...prefix, key]) : []));
}

// Změna bez polí s hodnotou `undefined`: v JSON nejsou a volající z kódu jimi myslí „neměnit".
const withoutUndefined = (value: unknown): unknown =>
  isObject(value)
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => [key, withoutUndefined(item)]),
      )
    : value;

const hasPath = (value: unknown, path: string[]): boolean => path.length === 0 || (isObject(value) && has(value, path[0]) && hasPath(value[path[0]], path.slice(1)));
const refKey = (ref: FeatureRef): string => JSON.stringify([ref.path, ref.kind, ref.id, ref.sketch]);

// ---------------------------------------------------------------- načtení dokumentu

// Ověří celý dokument stejnými pravidly jako příkazy. Odkazy na features, které v dokumentu nejsou
// nebo leží jinde, jsou přípustné: projeví se až při přepočtu.
export function validateDocument(value: unknown): Document {
  const o = upgrade(object(value, 'dokument'));
  if (o.schemaVersion !== SCHEMA_VERSION) fail(`dokument: verze schématu ${String(o.schemaVersion)} není podporovaná (čeká se ${SCHEMA_VERSION})`);
  const chordTolerance = finite(object(o.settings, 'dokument.settings').chordTolerance, 'dokument.settings.chordTolerance');
  if (chordTolerance <= 0) fail('dokument.settings.chordTolerance: musí být kladná');
  // Parameters and checks: names and expression syntax. Values, unknown names and cycles are up to the recompute.
  const named = <T extends Parameter | Check>(list: unknown, what: string, kind: 'number' | 'check', nameOf: (name: unknown, at: string) => string): T[] => {
    if (!Array.isArray(list)) return fail(`${what}: a list is expected`);
    const seen = new Set<string>();
    return list.map((item, i) => {
      const entry = object(item, `${what}[${i}]`);
      const name = nameOf(entry.name, `${what}[${i}].name`);
      if (seen.has(name)) fail(`${what}[${i}].name: the name "${name}" is in the list twice`);
      seen.add(name);
      return { name, expr: expression(entry.expr, `${what}[${i}].expr`, kind, kind === 'number' ? { parameter: name } : { check: name }) } as T;
    });
  };
  const parameters = named<Parameter>(o.parameters, 'document.parameters', 'number', parameterName);
  const checks = named<Check>(o.checks, 'document.checks', 'check', checkName);
  if (!Array.isArray(o.features)) fail('dokument.features: čeká se seznam');
  const doc: Document = { schemaVersion: SCHEMA_VERSION, settings: { chordTolerance }, parameters, checks, features: [] };
  const ids = new Set<Id>();
  (o.features as unknown[]).forEach((item, i) => {
    const f = feature(doc, undefined, item, `features[${i}]`, 'load');
    for (const id of [f.id, ...(f.type === 'sketch' ? sketchIds(f) : [])]) {
      if (ids.has(id)) fail(`features[${i}]: ID "${id}" je v dokumentu dvakrát`);
      ids.add(id);
    }
    doc.features.push(f);
  });
  return doc;
}

// Převod staršího dokumentu na současné schéma. Mění jen tvar; obsah ověří validace po něm.
// Verze 1 → 2: vysunutí má zdroj profilu, rozsah a seznam cílů; dokument má parametry a kontroly.
function upgrade(o: Dict): Dict {
  if (o.schemaVersion !== 1) return o;
  const extrude = (f: Dict): Dict => {
    const { sketch, regions: list, distance, target, ...rest } = f;
    return {
      ...rest,
      profile: { type: 'regions', sketch, regions: list },
      extent: { type: 'distance', start: 0, distance },
      ...(target === undefined ? {} : { targets: [target] }),
    };
  };
  const features = Array.isArray(o.features) ? o.features.map((f: unknown) => (isObject(f) && f.type === 'extrude' ? extrude(f) : f)) : o.features;
  // parametry a kontroly verze 1 neměla; co tam přesto je, se nezahodí a posoudí to validace
  return { ...o, schemaVersion: 2, parameters: o.parameters ?? [], checks: o.checks ?? [], features };
}

// ---------------------------------------------------------------- parameters and checks

function parameterName(v: unknown, what: string): string {
  const name = string(v, what);
  const problem = parameterNameProblem(name);
  return problem ? fail(`${what}: ${problem}`) : name;
}

// A check name is free text for a human; it is the key in commands and in the recompute result.
function checkName(v: unknown, what: string): string {
  const name = string(v, what);
  if (name === '' || name !== name.trim() || name in Object.prototype) fail(`${what}: the check name "${name}" is not allowed (non-empty, no leading or trailing spaces)`);
  return name;
}

// The expression of a parameter or a check: only the syntax and the result type are verified.
function expression(v: unknown, what: string, kind: 'number' | 'check', owner: { parameter: string } | { check: string }): Expr {
  const expr = string(v, what).trim();
  const result = analyzeExpression(expr, { kind });
  if (!result.ok) fail(`${what}: expression "${expr}": ${result.error.message}`, { ...owner, error: result.error });
  return expr;
}

// Inserts or replaces a list entry by name; `index` moves it.
function upsert<T extends { name: string }>(list: T[], entry: T, index: unknown, what: string): T[] {
  const at = list.findIndex((item) => item.name === entry.name);
  if (index === undefined) return at < 0 ? [...list, entry] : list.map((item, i) => (i === at ? entry : item));
  const rest = list.filter((_, i) => i !== at);
  const to = finite(index, `${what}.index`);
  if (!Number.isInteger(to) || to < 0 || to > rest.length) fail(`${what}.index: mimo rozsah seznamu`);
  return [...rest.slice(0, to), entry, ...rest.slice(to)];
}

function existing<T extends { name: string }>(list: T[], name: unknown, what: string): number {
  const at = list.findIndex((item) => item.name === name);
  return at < 0 ? fail(`${what}: "${String(name)}" is not in the document`) : at;
}

// A sketch with new constraints. Expressions of constraints that are no longer in the sketch or
// stopped being a driving dimension cease to exist; `changes` sets (a string) or removes (null) the
// expression of one address.
function withConstraints(s: SketchFeature, constraints: Record<Id, Constraint>, changes: Record<FieldPath, Expr | null> = {}): SketchFeature {
  const { expressions: old, ...rest } = s;
  const kept = Object.entries({ ...old, ...changes }).filter(([path, expr]) => {
    const [group, id] = path.split('/');
    const c = has(constraints, id) ? constraints[id] : undefined;
    // the address must be a value of a constraint that is still there and still driving
    return expr !== null && group === 'constraints' && c !== undefined && isDriving(c) && has(CONSTRAINTS[c.type].values ?? {}, path.split('/')[2] ?? '');
  }) as [FieldPath, Expr][];
  return { ...rest, constraints, ...(kept.length ? { expressions: Object.fromEntries(kept.sort(([a], [b]) => (a < b ? -1 : 1))) } : {}) };
}

// ---------------------------------------------------------------- příkazy

function indexOf(doc: Document, id: unknown, what: string): number {
  const index = doc.features.findIndex((f) => f.id === id);
  return index < 0 ? fail(`${what}: feature "${String(id)}" neexistuje`) : index;
}
const replaceAt = (doc: Document, index: number, f: Feature): Document =>
  doc.features[index] === f ? doc : { ...doc, features: doc.features.map((old, i) => (i === index ? f : old)) };

function unique(doc: Document, v: unknown, what: string): Id {
  const id = newId(v, what);
  if (allIds(doc).has(id)) fail(`${what}: ID "${id}" už v dokumentu je`);
  return id;
}

function editSketch(doc: Document, id: unknown, edit: (sketch: SketchFeature, index: number) => SketchFeature): Document {
  const index = indexOf(doc, id, 'sketch');
  const f = doc.features[index];
  if (f.type !== 'sketch') return fail(`sketch: feature "${f.id}" není skica`);
  return replaceAt(doc, index, edit(f, index));
}

// Příkaz, který zapisuje řešené proměnné přímo (nový bod, nová křivka), zruší razítko: uložené
// hodnoty už neodpovídají poslednímu řešení, i kdyby se otisk vstupů solveru shodoval (bod smazaný
// a přidaný znovu pod stejným ID na jiném místě).
const unsolved = (s: SketchFeature): SketchFeature['solved'] => ({ ...s.solved, inputs: '' });

const without = <T>(record: Record<Id, T>, drop: (id: Id, value: T) => boolean): Record<Id, T> =>
  Object.fromEntries(Object.entries(record).filter(([id, value]) => !drop(id, value)));

// Provede příkaz a vrátí nový dokument; původní se nemění. Neplatný příkaz vyhodí CommandError.
// Příkaz `dragPoint` dokument nemění (cíl tažení dostane přepočet), jen se ověří.
export function applyCommand(doc: Document, command: Command): Document {
  const cmd = object(command, 'příkaz') as Dict & { type?: unknown };
  switch (cmd.type) {
    case 'batch': {
      if (!Array.isArray(cmd.commands)) return fail('batch.commands: čeká se seznam příkazů');
      let current = doc;
      (cmd.commands as Command[]).forEach((inner, i) => {
        try {
          if (isObject(inner) && inner.type === 'dragPoint') fail('dragPoint: tažení nejde zařadit do dávky');
          current = applyCommand(current, inner);
        } catch (error) {
          if (error instanceof CommandError) error.commandIndex = i;
          throw error;
        }
      });
      return current;
    }

    case 'addFeature': {
      const index = cmd.index === undefined ? doc.features.length : finite(cmd.index, 'addFeature.index');
      if (!Number.isInteger(index) || index < 0 || index > doc.features.length) fail('addFeature.index: mimo rozsah časové osy');
      const f = feature(doc, index, cmd.feature, 'addFeature.feature', 'add');
      const ids = allIds(doc);
      const added = [f.id, ...(f.type === 'sketch' ? sketchIds(f) : [])];
      for (const id of added) if (ids.has(id) || added.indexOf(id) !== added.lastIndexOf(id)) fail(`addFeature: ID "${id}" už v dokumentu je`);
      return { ...doc, features: [...doc.features.slice(0, index), f, ...doc.features.slice(index)] };
    }

    case 'removeFeature': {
      const index = indexOf(doc, cmd.id, 'removeFeature');
      return { ...doc, features: doc.features.filter((_, i) => i !== index) };
    }

    case 'moveFeature': {
      const from = indexOf(doc, cmd.id, 'moveFeature');
      const to = finite(cmd.index, 'moveFeature.index');
      if (!Number.isInteger(to) || to < 0 || to >= doc.features.length) fail('moveFeature.index: mimo rozsah časové osy');
      const moved = doc.features[from];
      const features = doc.features.filter((_, i) => i !== from);
      features.splice(to, 0, moved);
      const position = new Map(features.map((f, i) => [f.id, i]));
      for (const ref of featureRefs(moved)) {
        if ((position.get(ref) ?? -1) > to) fail(`moveFeature: "${moved.id}" by se dostala před feature "${ref}", na kterou odkazuje`);
      }
      for (const f of features) {
        if (f !== moved && featureRefs(f).includes(moved.id) && (position.get(f.id) as number) < to) {
          fail(`moveFeature: "${moved.id}" by se dostala za feature "${f.id}", která na ni odkazuje`);
        }
      }
      return from === to ? doc : { ...doc, features };
    }

    case 'renameFeature': {
      const index = indexOf(doc, cmd.id, 'renameFeature');
      return replaceAt(doc, index, { ...doc.features[index], name: string(cmd.name, 'renameFeature.name') });
    }

    case 'setSuppressed': {
      const index = indexOf(doc, cmd.id, 'setSuppressed');
      return replaceAt(doc, index, { ...doc.features[index], suppressed: boolean(cmd.suppressed, 'setSuppressed.suppressed') });
    }

    case 'updateFeature': {
      const index = indexOf(doc, cmd.id, 'updateFeature');
      const f = doc.features[index];
      const spec = specOf(f);
      if (!spec.patch) return fail(`updateFeature: feature "${f.id}" je ${spec.info.title.toLowerCase()}; její obsah mění vlastní příkazy`);
      const title = spec.info.title.toLowerCase();
      const patch = withoutUndefined(object(cmd.patch, 'updateFeature.patch')) as Dict;
      for (const key of Object.keys(patch)) if (!spec.patch.fields.includes(key)) fail(`updateFeature.patch.${key}: ${title} takové pole nemá`);
      const merged = mergePatch(f, patch, 'updateFeature.patch') as Dict;
      spec.patch.normalize?.(merged, patch);
      // Expressions of fields the patch overwrites cease to exist: a number removes one, a string sets a new one.
      const replaced = replacedPaths(f, patch);
      // A string equal to the expression the field already has is not a change: the field keeps its
      // number and its expression without evaluation. A form sends the whole feature in the input
      // form, and an expression that stopped evaluating must not block a change of another field
      // (the same rule as a repeated broken reference).
      const repeated = replaced.filter((path) => {
        const given = atPath(merged, path);
        return typeof given === 'string' && f.expressions !== undefined && has(f.expressions, path) && given.trim() === f.expressions[path];
      });
      const input = repeated.reduce((current, path) => withPath(current, path, atPath(f, path)), merged);
      const gone = replaced.filter((path) => !repeated.includes(path));
      input.expressions = without(f.expressions ?? {}, (path) => gone.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)));
      const checked = validated(spec, doc, undefined, input, 'updateFeature.patch', 'update');
      // Validace neznámá pole zahazuje; ve změně je to překlep nebo pole jiné varianty, které by
      // jinak skončilo úspěchem bez účinku.
      for (const path of patchPaths(patch)) if (!hasPath(checked, path)) fail(`updateFeature.patch.${path.join('.')}: ${title} takové pole nemá`);
      // The same for `null`: removing what the feature did not have is fine only for a name the
      // feature knows (a form sends `refs: { meshWith: null }` whether the reference was set or
      // not); `params: { rotaton: null }` must not report success and reset nothing.
      for (const path of removedPaths(patch)) if (!hasPath(f, path) && !spec.patch.removable?.(checked, path)) fail(`updateFeature.patch.${path.join('.')}: ${title} takové pole nemá`);
      // Tvar se ověří celý, odkazy jen ty, které feature dosud neměla: oprava jedné rozbité
      // reference nesmí narazit na jinou, kterou změna nechává být (i když ji zopakuje).
      const kept = new Set(spec.refs(f).map(refKey));
      for (const ref of spec.refs(checked)) if (!kept.has(refKey(ref))) requireRef(doc, index, ref, `updateFeature.patch.${ref.path.split('/').join('.')}`);
      return replaceAt(doc, index, checked);
    }

    case 'setField': {
      const index = indexOf(doc, cmd.feature, 'setField');
      const f = doc.features[index];
      const path = string(cmd.path, 'setField.path');
      if (!fieldsOf(f).some((field) => field.path === path)) fail(`setField.path: "${path}" is not a numeric field of feature "${f.id}"`);
      if (typeof cmd.value !== 'number' && typeof cmd.value !== 'string') fail('setField.value: a number or an expression is expected');
      const { expressions, ...rest } = f;
      const input = { ...withPath(rest, path, cmd.value), expressions: without(expressions ?? {}, (other) => other === path) } as Dict;
      return replaceAt(doc, index, validated(specOf(f), doc, undefined, input, 'setField', 'update'));
    }

    case 'setParameter': {
      const name = parameterName(cmd.name, 'setParameter.name');
      const entry: Parameter = { name, expr: expression(cmd.expr, 'setParameter.expr', 'number', { parameter: name }) };
      return { ...doc, parameters: upsert(doc.parameters, entry, cmd.index, 'setParameter') };
    }

    case 'renameParameter': {
      const at = existing(doc.parameters, cmd.name, 'renameParameter.name');
      const from = doc.parameters[at].name;
      const to = parameterName(cmd.to, 'renameParameter.to');
      if (from === to) return doc;
      if (doc.parameters.some((p) => p.name === to)) fail(`renameParameter.to: parameter "${to}" is already in the document`);
      const renamed = <T extends { expr: Expr }>(entry: T): T => {
        const expr = renameInExpression(entry.expr, from, to);
        return expr === entry.expr ? entry : { ...entry, expr };
      };
      return {
        ...doc,
        parameters: doc.parameters.map((p, i) => renamed(i === at ? { ...p, name: to } : p)),
        checks: doc.checks.map(renamed),
        features: doc.features.map((f) => {
          if (!f.expressions) return f;
          const expressions = Object.fromEntries(Object.entries(f.expressions).map(([path, expr]) => [path, renameInExpression(expr, from, to)]));
          return Object.keys(expressions).every((path) => expressions[path] === f.expressions?.[path]) ? f : { ...f, expressions };
        }),
      };
    }

    case 'removeParameter': {
      const at = existing(doc.parameters, cmd.name, 'removeParameter.name');
      return { ...doc, parameters: doc.parameters.filter((_, i) => i !== at) };
    }

    case 'setCheck': {
      const name = checkName(cmd.name, 'setCheck.name');
      const entry: Check = { name, expr: expression(cmd.expr, 'setCheck.expr', 'check', { check: name }) };
      return { ...doc, checks: upsert(doc.checks, entry, cmd.index, 'setCheck') };
    }

    case 'renameCheck': {
      const at = existing(doc.checks, cmd.name, 'renameCheck.name');
      const to = checkName(cmd.to, 'renameCheck.to');
      if (doc.checks[at].name === to) return doc;
      if (doc.checks.some((c) => c.name === to)) fail(`renameCheck.to: check "${to}" is already in the document`);
      return { ...doc, checks: doc.checks.map((c, i) => (i === at ? { ...c, name: to } : c)) };
    }

    case 'removeCheck': {
      const at = existing(doc.checks, cmd.name, 'removeCheck.name');
      return { ...doc, checks: doc.checks.filter((_, i) => i !== at) };
    }

    case 'setSketchPlane':
      return editSketch(doc, cmd.sketch, (s, index) => ({ ...s, plane: planeRef(doc, index, cmd.plane, 'setSketchPlane.plane') }));

    case 'addPoint':
      return editSketch(doc, cmd.sketch, (s) => ({
        ...s,
        points: { ...s.points, [unique(doc, cmd.id, 'addPoint.id')]: { x: finite(cmd.x, 'addPoint.x'), y: finite(cmd.y, 'addPoint.y') } },
        solved: unsolved(s),
      }));

    case 'addCurve':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = unique(doc, cmd.id, 'addCurve.id');
        const c = curve(s, cmd.curve, 'addCurve.curve');
        if (c.type !== 'circle') {
          if (cmd.radius !== undefined) fail('addCurve.radius: poloměr se zadává jen u kružnice');
          return { ...s, curves: { ...s.curves, [id]: c }, solved: unsolved(s) };
        }
        const radius = finite(cmd.radius, 'addCurve.radius');
        if (radius <= 0) fail('addCurve.radius: poloměr musí být kladný');
        return { ...s, curves: { ...s.curves, [id]: c }, radii: { ...s.radii, [id]: radius }, solved: unsolved(s) };
      });

    case 'removeEntity':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'removeEntity.id');
        const entity = entityOf(s, id);
        if (!entity?.own) fail(`removeEntity: "${id}" není vlastní bod ani křivka skici (počátek a promítnutou geometrii smazat nejde)`);
        // Mazání kaskáduje: bod vezme křivky, které na něm stojí; bod i křivka vezmou své vazby.
        const gone = new Set<Id>([id]);
        for (const [curveId, c] of Object.entries(s.curves)) if (curvePoints(c).includes(id)) gone.add(curveId);
        const left = { ...s, points: without(s.points, (p) => gone.has(p)), curves: without(s.curves, (c) => gone.has(c)), radii: without(s.radii, (c) => gone.has(c)) };
        return withConstraints(
          left,
          without(s.constraints, (_, c) => constraintOperands(c).some((operand) => gone.has(operand))),
        );
      });

    case 'setConstruction':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'setConstruction.id');
        if (!has(s.curves, id)) fail(`setConstruction: "${id}" není křivka skici`);
        const { construction: _old, ...rest } = s.curves[id];
        // pořadí klíčů jako při načtení dokumentu, aby se uložený a znovu načtený dokument nelišil
        const flagged = boolean(cmd.construction, 'setConstruction.construction') ? { construction: true, ...rest } : rest;
        return { ...s, curves: { ...s.curves, [id]: flagged as Curve } };
      });

    case 'addConstraint':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = unique(doc, cmd.id, 'addConstraint.id');
        const fields = new Fields('add', {}, () => evaluateParameters(doc.parameters));
        const added = constraint(s, withPosition(s, cmd.constraint), 'addConstraint.constraint', fields, id);
        const twin = duplicateOf(s, added);
        if (twin !== undefined) fail(`addConstraint: stejná vazba už ve skice je ("${twin}")`);
        return withConstraints(s, { ...s.constraints, [id]: added }, fields.expressions('addConstraint.constraint') ?? {});
      });

    case 'removeConstraint':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'removeConstraint.id');
        if (!has(s.constraints, id)) fail(`removeConstraint: vazba "${id}" ve skice není`);
        return withConstraints(s, without(s.constraints, (c) => c === id));
      });

    case 'setConstraintValue':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'setConstraintValue.id');
        if (!has(s.constraints, id)) fail(`setConstraintValue: vazba "${id}" ve skice není`);
        const old = s.constraints[id];
        if (!isDimension(old)) return fail(`setConstraintValue: vazba "${id}" není kóta`);
        // Without `value` neither the value nor the expression changes; a number removes the
        // expression, a string sets it. The expression of a reference dimension is dropped in
        // withConstraints.
        const path = constraintPath(id);
        const kept = cmd.value === undefined && s.expressions && has(s.expressions, path) ? { [path]: s.expressions[path] } : {};
        const fields = new Fields('update', kept, () => evaluateParameters(doc.parameters));
        const changed = { ...old, value: cmd.value === undefined ? old.value : cmd.value, driving: cmd.driving === undefined ? old.driving : cmd.driving };
        const next = constraint(s, changed, 'setConstraintValue', fields, id);
        // Duplicitu smí vyrobit jen přepnutí referenční kóty na řídicí. Změna hodnoty projde
        // i u kót, které jsou duplicitní už z načteného dokumentu.
        const twin = old.driving ? undefined : duplicateOf(s, next, id);
        if (twin !== undefined) fail(`setConstraintValue: stejnou řídicí kótu už skica má ("${twin}")`);
        return withConstraints(s, { ...s.constraints, [id]: next }, { [path]: fields.expressions('setConstraintValue')?.[path] ?? null });
      });

    case 'dragPoint':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.point, 'dragPoint.point');
        if (!has(s.points, id)) fail(`dragPoint: "${id}" není vlastní bod skici (počátkem a promítnutou geometrií táhnout nejde)`);
        finite(cmd.x, 'dragPoint.x');
        finite(cmd.y, 'dragPoint.y');
        return s;
      });

    case 'addExternal':
      return editSketch(doc, cmd.sketch, (s, index) => ({
        ...s,
        external: { ...s.external, [unique(doc, cmd.id, 'addExternal.id')]: externalRef(doc, index, cmd.ref, 'addExternal.ref') },
      }));

    case 'updateExternal':
      return editSketch(doc, cmd.sketch, (s, index) => {
        const id = string(cmd.id, 'updateExternal.id');
        if (!has(s.external, id)) fail(`updateExternal: promítnutí "${id}" ve skice není`);
        const ref = externalRef(doc, index, cmd.ref, 'updateExternal.ref');
        // Změna druhu by změnila odvozená ID; kdo chce jiný druh, promítnutí smaže a založí nové.
        if (ref.kind !== s.external[id].kind) fail('updateExternal: druh promítnutí změnit nejde');
        // Zmrazené hodnoty patřily původní hraně.
        return { ...s, external: { ...s.external, [id]: ref }, solved: { ...s.solved, external: without(s.solved.external, (e) => e === id) } };
      });

    case 'removeExternal':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'removeExternal.id');
        if (!has(s.external, id)) fail(`removeExternal: promítnutí "${id}" ve skice není`);
        const derived = (operand: Id) => operand === id || operand.startsWith(`${id}/`);
        const left = { ...s, external: without(s.external, (e) => e === id), solved: { ...s.solved, external: without(s.solved.external, (e) => e === id) } };
        return withConstraints(
          left,
          without(s.constraints, (_, c) => constraintOperands(c).some(derived)),
        );
      });

    default:
      return fail(`neznámý příkaz "${String(cmd.type)}"`);
  }
}

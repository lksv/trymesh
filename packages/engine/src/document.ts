// Document: validation and execution of commands. Everything works only with the structure of the
// document, without a recompute. The rules are in docs/architecture/api.md, section "Commands".
import type {
  Check,
  Command,
  Constraint,
  Curve,
  Document,
  Expr,
  ExternalRef,
  Feature,
  FieldPath,
  Id,
  Input,
  Parameter,
  SketchFeature,
} from './types';
import { CONSTRAINTS } from './catalog';
import { type Environment, analyzeExpression, evaluateParameters, parameterNameProblem, renameInExpression } from './expression';
import { CURVE_POINTS, bodyOwner, constraintOperands, constraintPath, curvePoints, documentIds, duplicateOf, isDimension, isDriving } from './sketch-content';
import { entityOf, externalRef, kindOf, updateProblem } from './references/index';
import { schemaHeader, upgradeDocument } from './schema';
import { has } from './util';
import {
  CommandError,
  type Dict,
  type FeatureRef,
  type FieldInfo,
  type FieldMode,
  Fields,
  boolean,
  fail,
  finite,
  isObject,
  newId,
  object,
  oneOf,
  planeRef,
  string,
} from './validation';
import { FEATURE_TYPES, FEATURE_TYPE_INFO, refContext, requireRef, specOf } from './features/index';
import { applySectionCommand, emptySections, renamedSections, validateSections } from './sections/index';
import { MAX_INSERT_DEPTH } from './sections/documents';
import type { SectionContext } from './sections/spec';
import type { FeatureModule } from './features/module';
import { SET_CURVE_POINT_SPLINE, constraint, constraintRuleProblem, curve } from './features/sketch';

// What moved to the leaf modules keeps its path here: the tests and the modules above import it from
// the document.
export {
  type Entity,
  type EntityKind,
  bodyOwner,
  constraintKey,
  constraintOperands,
  constraintPath,
  CURVE_POINTS,
  curvePoints,
  documentIds,
  duplicateOf,
  emptySketch,
  isDimension,
  isDriving,
} from './sketch-content';
export { entityOf, referenceEntities } from './references/index';
export { CommandError, type FeatureRef, type FieldInfo, type RefKind } from './validation';
export { FEATURE_TYPE_INFO } from './features/index';
export type { FeatureTypeInfo } from './features/module';
export { MAX_PATTERN_COUNT } from './features/pattern';

export { SCHEMA_VERSION } from './schema';

export const emptyDocument = (): Document => ({ ...schemaHeader(), settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [], ...emptySections() });

const sketchIds = (s: SketchFeature): Id[] => [s.points, s.curves, s.constraints, s.external].flatMap((group) => Object.keys(group));

const expressionsOf = (o: Dict, what: string): Record<FieldPath, Expr> =>
  o.expressions === undefined ? {} : Object.fromEntries(Object.entries(object(o.expressions, `${what}.expressions`)).map(([path, expr]) => [path, string(expr, `${what}.expressions.${path}`)]));

const NO_ENVIRONMENT = (): Environment => ({});

// ---------------------------------------------------------------- entities of a sketch

// A fixed point given without a coordinate is fixed where it is: the coordinate is filled in from
// the position the sketch has stored for the point. That is its last solved position; for a point
// added earlier in the same batch it is the estimate the batch gave it, since the sketch is solved
// once after the whole batch.
function withPosition(sketch: SketchFeature, given: unknown): unknown {
  if (!isObject(given) || given.type !== 'fixed' || typeof given.point !== 'string' || !has(sketch.points, given.point)) return given;
  const at = sketch.points[given.point];
  return { ...given, x: given.x === undefined ? at.x : given.x, y: given.y === undefined ? at.y : given.y };
}

// ---------------------------------------------------------------- features

// ---------------------------------------------------------------- registry of feature types

// The defaults of a new feature in addFeature (D73, `NewFeature`): `name` is the ID and
// `suppressed` false when left out, and a sketch gets what it leaves out of its empty parts. Only
// the command fills them in: a document keeps every field, so a load still asks for them.
const EMPTY_SKETCH_PARTS = ['points', 'radii', 'curves', 'constraints', 'external'] as const;
function newFeature(v: unknown): unknown {
  if (!isObject(v)) return v;
  const filled: Dict = { ...v };
  if (filled.name === undefined && typeof filled.id === 'string') filled.name = filled.id;
  if (filled.suppressed === undefined) filled.suppressed = false;
  if (filled.type === 'sketch') {
    for (const part of EMPTY_SKETCH_PARTS) if (filled[part] === undefined) filled[part] = {};
    if (filled.solved === undefined) filled.solved = { inputs: '', external: {} };
  }
  return filled;
}

// Validates a feature and returns its canonical copy. `before`: see requireRef; `mode`: see FieldMode.
function feature(doc: Document, before: number | undefined, v: unknown, what: string, mode: FieldMode): Feature {
  const o = object(v, what);
  const type = oneOf(o.type, Object.keys(FEATURE_TYPES) as Feature['type'][], `${what}.type`);
  return validated(FEATURE_TYPES[type] as FeatureModule<Feature>, doc, before, o, what, mode);
}

// The feature of addFeature. Validation keeps only the fields it knows, and with the defaults of
// `NewFeature` a misspelt optional field (`supressed`, `nmae`, `point` for `points`) would end in
// success without effect; so a top-level key of the input that the validator of the type never
// reads is refused, naming the fields it reads (D73, review). A key without a value is no field.
function addedFeature(doc: Document, before: number, v: unknown, what: string): Feature {
  const input = newFeature(v);
  if (!isObject(input)) return feature(doc, before, input, what, 'add');
  const read = new Set<string>(['type', 'expressions']);
  const note = (key: string | symbol): void => void (typeof key === 'string' && read.add(key));
  const watched = new Proxy(input, {
    get: (target, key, receiver) => (note(key), Reflect.get(target, key, receiver)),
    has: (target, key) => (note(key), Reflect.has(target, key)),
    getOwnPropertyDescriptor: (target, key) => (note(key), Reflect.getOwnPropertyDescriptor(target, key)),
  });
  const checked = feature(doc, before, watched, what, 'add');
  const unknown = Object.keys(input).filter((key) => input[key] !== undefined && !read.has(key));
  if (unknown.length) fail(`${what}.${unknown[0]}: a feature of the type ${checked.type} has no field "${unknown[0]}"; its fields are ${['type', ...[...read].filter((key) => key !== 'type' && key !== 'expressions'), 'expressions'].join(', ')}`);
  return checked;
}

function validated(spec: FeatureModule<Feature>, doc: Document, before: number | undefined, o: Dict, what: string, mode: FieldMode): Feature {
  const fields = new Fields(mode, expressionsOf(o, what), () => evaluateParameters(doc.parameters));
  const checked = spec.validate(o, what, { ...refContext(doc, before), fields });
  const expressions = fields.expressions(what);
  return expressions ? { ...checked, expressions } : checked;
}

const EMPTY: Document = emptyDocument();
const fieldCache = new WeakMap<Feature, FieldInfo[]>();

// Numeric fields of a feature that accept an expression: driving inputs only, not the coordinates
// and radii the solver computes, nor the values of reference dimensions. Derived from a validation
// pass, so it matches what commands accept.
export function fieldsOf(f: Feature): FieldInfo[] {
  let found = fieldCache.get(f);
  if (!found) {
    const fields = new Fields('load', f.expressions ?? {}, NO_ENVIRONMENT);
    specOf(f).validate(f as unknown as Dict, 'feature', { ...refContext(EMPTY, undefined), fields });
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

// The features a feature refers to: a plane, a sketch, the feature that created a body, and the
// extrudes that named a face (a face and an edge exist only after the feature that created them).
export function featureRefs(f: Feature): Id[] {
  return [
    ...new Set(
      specOf(f)
        .refs(f)
        // an entity belongs to a sketch that is referred to anyway; a stored mesh (D55), a stored
        // document, a parameter and a body of one (D62) are no features
        .filter((ref) => ref.kind !== 'entity' && ref.kind !== 'mesh' && ref.kind !== 'document' && ref.kind !== 'parameter' && ref.kind !== 'documentBody')
        .map((ref) => (ref.kind === 'body' ? bodyOwner(ref.id).feature : ref.id)),
    ),
  ];
}

// What makes an object a variant: its `type` and, for a generated profile, its `generator`. A patch
// that names another one replaces the object; a patch that names none or the same one merges.
const VARIANT_KEYS = ['type', 'generator'];
const sameVariant = (old: Dict, patch: Dict): boolean => VARIANT_KEYS.every((key) => patch[key] === undefined || patch[key] === old[key]);

// Is this path of a feature a dictionary of numbers by free names (`patch.dictionaries` of its
// module, D62)? Every function of a patch below asks it and takes such a field key by key, without
// reading `kind` as a reference or `type` and `generator` as a variant.
type IsDictionary = (path: readonly string[]) => boolean;
const NO_DICTIONARY: IsDictionary = () => false;

// A merging change (command updateFeature): a variant with the same `type` merges field by field,
// another variant, a reference (an object with `kind`) and a list replace the current value, `null`
// removes a field.
// A dictionary (operands, parameters and references of a generated profile) merges by entry.
function mergePatch(old: unknown, patch: unknown, what: string, dictionary: IsDictionary = NO_DICTIONARY, path: string[] = []): unknown {
  if (dictionary(path) && isObject(patch)) {
    const out: Dict = isObject(old) ? { ...old } : {};
    for (const [key, value] of Object.entries(patch)) {
      if (key in Object.prototype) fail(`${what}.${key}: the feature has no such field`);
      if (value === null) delete out[key];
      else out[key] = value;
    }
    return out;
  }
  if (!isObject(patch) || has(patch, 'kind')) return patch;
  // a reference does not merge field by field: half of a reference would select another face of
  // the same body
  if (isObject(old) && has(old, 'kind')) fail(`${what}: a reference is replaced whole, an object with the field kind is expected`);
  // Nothing to merge with: the patch is the new value. A `null` in it removes an entry that is not
  // there (a form sends `refs: { meshWith: null }` whether the feature had the reference or not).
  if (!isObject(old) || !sameVariant(old, patch)) return withoutNulls(patch, dictionary, path);
  const out: Dict = { ...old };
  for (const [key, value] of Object.entries(patch)) {
    if (key in Object.prototype) fail(`${what}.${key}: the feature has no such field`);
    if (value === null) delete out[key];
    else out[key] = mergePatch(old[key], value, `${what}.${key}`, dictionary, [...path, key]);
  }
  return out;
}

const withoutNulls = (value: unknown, dictionary: IsDictionary = NO_DICTIONARY, path: string[] = []): unknown =>
  isObject(value) && (dictionary(path) || !has(value, 'kind'))
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== null)
          .map(([key, item]) => [key, dictionary(path) ? item : withoutNulls(item, dictionary, [...path, key])]),
      )
    : value;

// Addresses the patch overwrites as a whole (a leaf, a list, a reference, another variant, a removed
// field; in a dictionary each value it names). Expressions at and below them cease to exist; fields
// the patch does not mention keep theirs.
function replacedPaths(old: unknown, patch: Dict, dictionary: IsDictionary = NO_DICTIONARY, prefix: string[] = []): string[] {
  return Object.entries(patch).flatMap(([key, value]) => {
    const path = [...prefix, key];
    if (dictionary(path) && isObject(value)) return Object.keys(value).map((name) => [...path, name].join('/'));
    const before = isObject(old) ? old[key] : undefined;
    const merges = isObject(value) && !has(value, 'kind') && isObject(before) && sameVariant(before, value);
    return merges ? replacedPaths(before, value as Dict, dictionary, path) : [path.join('/')];
  });
}

// The paths to the values the change sets: leaves, lists and references (not removed fields).
function patchPaths(patch: Dict, dictionary: IsDictionary = NO_DICTIONARY, prefix: string[] = []): string[][] {
  return Object.entries(patch).flatMap(([key, value]) => {
    const path = [...prefix, key];
    if (value === null) return [];
    if (dictionary(path) && isObject(value)) return Object.keys(value).filter((name) => value[name] !== null).map((name) => [...path, name]);
    return isObject(value) && !has(value, 'kind') ? patchPaths(value, dictionary, path) : [path];
  });
}
// Paths the patch removes (`null`).
function removedPaths(patch: Dict, dictionary: IsDictionary = NO_DICTIONARY, prefix: string[] = []): string[][] {
  return Object.entries(patch).flatMap(([key, value]) => {
    const path = [...prefix, key];
    if (value === null) return [path];
    if (dictionary(path) && isObject(value)) return Object.keys(value).filter((name) => value[name] === null).map((name) => [...path, name]);
    return isObject(value) && !has(value, 'kind') ? removedPaths(value, dictionary, path) : [];
  });
}

// The change without fields whose value is `undefined`: they are not in JSON, and a caller from code
// means "do not change" by them.
const withoutUndefined = (value: unknown): unknown =>
  isObject(value)
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => [key, withoutUndefined(item)]),
      )
    : value;

const hasPath = (value: unknown, path: string[]): boolean => path.length === 0 || (isObject(value) && has(value, path[0]) && hasPath(value[path[0]], path.slice(1)));
// the identity of a reference: a parameter of another stored document is another reference (D62)
const refKey = (ref: FeatureRef): string => JSON.stringify([ref.path, ref.kind, ref.id, ref.sketch, ref.document]);

// ---------------------------------------------------------------- loading a document

// Validates the whole document by the same rules as the commands. References to features that are
// not in the document or lie elsewhere are allowed: they show only in the recompute.
// `what` is the path of the document in the messages and `depth` its level below the host: a stored
// document (D62) is validated by this same function, one level deeper, and the message of its
// fault names its path (`document.documents.bearing.document.settings: …`). The host keeps the
// texts it has always had.
export function validateDocument(value: unknown, what = 'document', depth = 0): Document {
  const host = depth === 0;
  // the old prefixes of the host, and the path of a stored document
  const at = (old: string, path: string): string => (host ? old : `${what}${path}`);
  // older documents are brought to the schema of this build first (schema.ts); it changes only the shape
  const o = upgradeDocument(object(value, at('document', '')), undefined, undefined, what);
  const chordTolerance = finite(object(o.settings, at('document.settings', '.settings')).chordTolerance, at('document.settings.chordTolerance', '.settings.chordTolerance'));
  if (chordTolerance <= 0) fail(`${at('document.settings.chordTolerance', '.settings.chordTolerance')}: must be positive`);
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
  const parameters = named<Parameter>(o.parameters, `${what}.parameters`, 'number', parameterName);
  const checks = named<Check>(o.checks, `${what}.checks`, 'check', checkName);
  if (!Array.isArray(o.features)) fail(`${at('document.features', '.features')}: a list is expected`);
  // the sections (body properties) after the timeline; the form of their references only, as for every reference
  const doc: Document = { ...schemaHeader(), settings: { chordTolerance }, parameters, checks, features: [], ...validateSections(o, what, sectionContext(depth)) };
  const ids = new Set<Id>();
  (o.features as unknown[]).forEach((item, i) => {
    const f = feature(doc, undefined, item, at(`features[${i}]`, `.features[${i}]`), 'load');
    for (const id of [f.id, ...(f.type === 'sketch' ? sketchIds(f) : [])]) {
      if (ids.has(id)) fail(`${at(`features[${i}]`, `.features[${i}]`)}: the ID "${id}" is in the document twice`);
      ids.add(id);
    }
    doc.features.push(f);
  });
  return doc;
}

// What the validation and the commands of a section get (D62): the validator of a nested document,
// one level deeper than the document the section belongs to, refused beyond `MAX_INSERT_DEPTH`.
// The error of a nested document carries no `expression`: a parameter of a stored document is no
// parameter of the host, which a caller would otherwise mark.
function sectionContext(depth: number): SectionContext {
  return {
    depth,
    document(value, what) {
      if (depth + 1 > MAX_INSERT_DEPTH) fail(`${what}: documents inside documents are allowed down to ${MAX_INSERT_DEPTH} levels below the host`);
      try {
        return validateDocument(value, what, depth + 1);
      } catch (error) {
        if (error instanceof CommandError && error.expression) throw new CommandError(error.message);
        throw error;
      }
    },
  };
}
const HOST_CONTEXT = sectionContext(0);

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
  if (!Number.isInteger(to) || to < 0 || to > rest.length) fail(`${what}.index: outside the range of the list`);
  return [...rest.slice(0, to), entry, ...rest.slice(to)];
}

function existing<T extends { name: string }>(list: T[], name: unknown, what: string): number {
  const at = list.findIndex((item) => item.name === name);
  return at < 0 ? fail(`${what}: "${String(name)}" is not in the document`) : at;
}

// A sketch with new constraints. Expressions of constraints that are no longer in the sketch or
// stopped being a driving dimension cease to exist; `changes` sets (a string) or removes (null) the
// expression of one address.
// The expressions of an entry of `external` are kept while the entry is there and its kind reads
// their address (`external/<id>/…`, D68).
function withConstraints(s: SketchFeature, constraints: Record<Id, Constraint>, changes: Record<FieldPath, Expr | null> = {}): SketchFeature {
  const { expressions: old, ...rest } = s;
  const read = new Map<Id, Set<FieldPath>>();
  const entryReads = (id: Id, path: FieldPath): boolean => {
    if (!has(s.external, id)) return false;
    if (!read.has(id)) read.set(id, entryFieldPaths(s, id));
    return (read.get(id) as Set<FieldPath>).has(path);
  };
  const kept = Object.entries({ ...old, ...changes }).filter(([path, expr]) => {
    const [group, id] = path.split('/');
    if (expr !== null && group === 'external') return entryReads(id, path);
    const c = has(constraints, id) ? constraints[id] : undefined;
    // the address must be a value of a constraint that is still there and still driving
    return expr !== null && group === 'constraints' && c !== undefined && isDriving(c) && has(CONSTRAINTS[c.type].values ?? {}, path.split('/')[2] ?? '');
  }) as [FieldPath, Expr][];
  return { ...rest, constraints, ...(kept.length ? { expressions: Object.fromEntries(kept.sort(([a], [b]) => (a < b ? -1 : 1))) } : {}) };
}

// The addresses of the numeric fields an entry of `external` reads (`external/<id>/…`), learnt by
// validating the entry once, as `fieldsOf` learns those of a feature.
function entryFieldPaths(s: SketchFeature, id: Id): Set<FieldPath> {
  const fields = new Fields('load', {}, NO_ENVIRONMENT);
  try {
    externalRef({ ...refContext(EMPTY, undefined), fields }, s, id, s.external[id], 'entry');
  } catch {
    return new Set();
  }
  return new Set(fields.found.map((field) => field.path));
}

// A sketch whose expressions under `external/<id>/` are those given: every address of the entry is
// set anew, so a number removes an expression.
function withEntryExpressions(s: SketchFeature, id: Id, given: Record<FieldPath, Expr>): SketchFeature {
  const { expressions: old, ...rest } = s;
  const kept = Object.entries(old ?? {}).filter(([path]) => !path.startsWith(`external/${id}/`));
  const all = [...kept, ...Object.entries(given)].sort(([a], [b]) => (a < b ? -1 : 1));
  return { ...rest, ...(all.length ? { expressions: Object.fromEntries(all) } : {}) };
}

// The entry an update of a kind with `partial` (an outline, D72) stands for: the fields the command
// gives, its `undefined` ones dropped, laid over the input form of the entry (`entryInput`, with its
// expressions), when the command's `type` is the entry's. A field left out then arrives as the
// expression the entry has, is found unchanged, and keeps its last value without being evaluated.
// Any other update is the whole entry.
function partialInput(s: SketchFeature, id: Id, given: unknown): unknown {
  const before = s.external[id];
  const kind = kindOf(before);
  if (kind.source !== 'reference' || !kind.partial || !isObject(given) || given.type !== before.type) return given;
  const fields = Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined));
  return { ...(entryInput(s, id) as object), ...fields };
}

// The input form of one entry of `external` (as `featureInput` of a feature): its numeric fields
// with the sketch's expressions under `external/<id>/` put back as strings. What sends
// `updateExternal` for an entry with fields (a sketch tool that patches it, the app's form) starts
// from it, so an expression stays an expression.
export function entryInput(s: SketchFeature, id: Id): Input<ExternalRef> {
  const prefix = `external/${id}/`;
  return Object.entries(s.expressions ?? {})
    .filter(([path]) => path.startsWith(prefix))
    .reduce((input, [path, expr]) => withPath(input, path.slice(prefix.length), expr), s.external[id] as unknown) as Input<ExternalRef>;
}

// ---------------------------------------------------------------- commands

function indexOf(doc: Document, id: unknown, what: string): number {
  const index = doc.features.findIndex((f) => f.id === id);
  return index < 0 ? fail(`${what}: the feature "${String(id)}" does not exist`) : index;
}
const replaceAt = (doc: Document, index: number, f: Feature): Document =>
  doc.features[index] === f ? doc : { ...doc, features: doc.features.map((old, i) => (i === index ? f : old)) };

function unique(doc: Document, v: unknown, what: string): Id {
  const id = newId(v, what);
  if (documentIds(doc).has(id)) fail(`${what}: the ID "${id}" is already in the document`);
  return id;
}

// What the validator of an entry of `external` gets in a command: the references of the sketch at
// its place, and a fresh reader of numeric fields over no expressions, as addConstraint has (a kind
// with fields hands its expressions on; the edge has none).
const entryContext = (doc: Document, index: number) => ({ ...refContext(doc, index), fields: new Fields('add', {}, () => evaluateParameters(doc.parameters)) });

function editSketch(doc: Document, id: unknown, edit: (sketch: SketchFeature, index: number) => SketchFeature): Document {
  const index = indexOf(doc, id, 'sketch');
  const f = doc.features[index];
  if (f.type !== 'sketch') return fail(`sketch: feature "${f.id}" is not a sketch`);
  return replaceAt(doc, index, edit(f, index));
}

// A command that writes solved variables directly (a new point, a new curve) clears the stamp: the
// stored values no longer match the last solution, even if the fingerprint of the solver's inputs
// matched (a point deleted and added again under the same ID at another place).
const unsolved = (s: SketchFeature): SketchFeature['solved'] => ({ ...s.solved, inputs: '' });

const without = <T>(record: Record<Id, T>, drop: (id: Id, value: T) => boolean): Record<Id, T> =>
  Object.fromEntries(Object.entries(record).filter(([id, value]) => !drop(id, value)));

// Runs a command and returns the new document; the original does not change. An invalid command
// throws CommandError. The command `dragPoint` does not change the document (the recompute gets the
// target of the drag), it is only validated.
export function applyCommand(doc: Document, command: Command): Document {
  const cmd = object(command, 'command') as Dict & { type?: unknown };
  switch (cmd.type) {
    case 'batch': {
      if (!Array.isArray(cmd.commands)) return fail('batch.commands: a list of commands is expected');
      let current = doc;
      (cmd.commands as Command[]).forEach((inner, i) => {
        try {
          if (isObject(inner) && inner.type === 'dragPoint') fail('dragPoint: a drag cannot be put in a batch');
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
      if (!Number.isInteger(index) || index < 0 || index > doc.features.length) fail('addFeature.index: outside the range of the timeline');
      const f = addedFeature(doc, index, cmd.feature, 'addFeature.feature');
      const ids = documentIds(doc);
      const added = [f.id, ...(f.type === 'sketch' ? sketchIds(f) : [])];
      for (const id of added) if (ids.has(id) || added.indexOf(id) !== added.lastIndexOf(id)) fail(`addFeature: the ID "${id}" is already in the document`);
      return { ...doc, features: [...doc.features.slice(0, index), f, ...doc.features.slice(index)] };
    }

    case 'removeFeature': {
      const index = indexOf(doc, cmd.id, 'removeFeature');
      return { ...doc, features: doc.features.filter((_, i) => i !== index) };
    }

    case 'moveFeature': {
      const from = indexOf(doc, cmd.id, 'moveFeature');
      const to = finite(cmd.index, 'moveFeature.index');
      if (!Number.isInteger(to) || to < 0 || to >= doc.features.length) fail('moveFeature.index: outside the range of the timeline');
      const moved = doc.features[from];
      const features = doc.features.filter((_, i) => i !== from);
      features.splice(to, 0, moved);
      const position = new Map(features.map((f, i) => [f.id, i]));
      for (const ref of featureRefs(moved)) {
        if ((position.get(ref) ?? -1) > to) fail(`moveFeature: "${moved.id}" would get before the feature "${ref}" it refers to`);
      }
      for (const f of features) {
        if (f !== moved && featureRefs(f).includes(moved.id) && (position.get(f.id) as number) < to) {
          fail(`moveFeature: "${moved.id}" would get after the feature "${f.id}" that refers to it`);
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
      if (!spec.patch) return fail(`updateFeature: feature "${f.id}" is a ${spec.info.title.toLowerCase()}; its content is changed by its own commands`);
      const title = spec.info.title.toLowerCase();
      const patch = withoutUndefined(object(cmd.patch, 'updateFeature.patch')) as Dict;
      for (const key of Object.keys(patch)) if (!spec.patch.fields.includes(key)) fail(`updateFeature.patch.${key}: this ${title} has no such field`);
      const dictionaries = spec.patch.dictionaries ?? [];
      const dictionary: IsDictionary = (path) => dictionaries.includes(path.join('/'));
      const merged = mergePatch(f, patch, 'updateFeature.patch', dictionary) as Dict;
      spec.patch.normalize?.(merged, patch);
      // Expressions of fields the patch overwrites cease to exist: a number removes one, a string sets a new one.
      const replaced = replacedPaths(f, patch, dictionary);
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
      // Validation drops unknown fields; in a change it is a typo or a field of another variant,
      // which would otherwise end in success without effect.
      for (const path of patchPaths(patch, dictionary)) if (!hasPath(checked, path)) fail(`updateFeature.patch.${path.join('.')}: this ${title} has no such field`);
      // The same for `null`: removing what the feature did not have is fine only for a name the
      // feature knows (a form sends `refs: { meshWith: null }` whether the reference was set or
      // not); `params: { rotaton: null }` must not report success and reset nothing.
      for (const path of removedPaths(patch, dictionary)) if (!hasPath(f, path) && !spec.patch.removable?.(checked, path)) fail(`updateFeature.patch.${path.join('.')}: this ${title} has no such field`);
      // The shape is validated whole, the references only those the feature did not have yet: a
      // fix of one broken reference must not run into another one the change leaves alone (even
      // when it repeats it).
      const kept = new Set(spec.refs(f).map(refKey));
      for (const ref of spec.refs(checked)) if (!kept.has(refKey(ref))) requireRef(doc, index, ref, `updateFeature.patch.${ref.path.split('/').join('.')}`);
      return replaceAt(doc, index, checked);
    }

    case 'setField': {
      const index = indexOf(doc, cmd.feature, 'setField');
      const f = doc.features[index];
      const path = string(cmd.path, 'setField.path');
      // An optional field (its description in the registry has a default, which is what its absence
      // means) is reached also while the feature does not have it: the command then adds it.
      const optional = (): boolean => FEATURE_TYPE_INFO[f.type].fields.some((field) => field.path === path && field.spec.default !== undefined && (!field.when || atPath(f, field.when.path) === field.when.equals));
      if (!fieldsOf(f).some((field) => field.path === path) && !optional()) fail(`setField.path: "${path}" is not a numeric field of feature "${f.id}"`);
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
        ...renamedSections(doc, from, to),
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
      return editSketch(doc, cmd.sketch, (s, index) => ({ ...s, plane: planeRef(refContext(doc, index), cmd.plane, 'setSketchPlane.plane') }));

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
          if (cmd.radius !== undefined) fail('addCurve.radius: a radius is given only for a circle');
          return { ...s, curves: { ...s.curves, [id]: c }, solved: unsolved(s) };
        }
        const radius = finite(cmd.radius, 'addCurve.radius');
        if (radius <= 0) fail('addCurve.radius: the radius must be positive');
        return { ...s, curves: { ...s.curves, [id]: c }, radii: { ...s.radii, [id]: radius }, solved: unsolved(s) };
      });

    case 'removeEntity':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'removeEntity.id');
        const entity = entityOf(s, id);
        if (!entity?.own) fail(`removeEntity: "${id}" is neither an own point nor a curve of the sketch (the origin and projected geometry cannot be deleted)`);
        // Deletion cascades: a point takes the curves that stand on it; a point and a curve take
        // their constraints.
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
        if (!has(s.curves, id)) fail(`setConstruction: "${id}" is not a curve of the sketch`);
        const { construction: _old, ...rest } = s.curves[id];
        // the order of keys as when a document is loaded, so that a saved and reloaded document
        // does not differ
        const flagged = boolean(cmd.construction, 'setConstruction.construction') ? { construction: true, ...rest } : rest;
        return { ...s, curves: { ...s.curves, [id]: flagged as Curve } };
      });

    case 'setCurvePoint':
      // D52: three checks: the name of the point, the changed curve as a curve, and the own rule of
      // every constraint on it. Nothing is solved; the stamp of the sketch no longer matches.
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'setCurvePoint.id');
        if (!has(s.curves, id)) fail(`setCurvePoint.id: "${id}" is not an own curve of the sketch`);
        const old = s.curves[id];
        // D70: a spline has no named points; said before the generic text, which would list none
        if (old.type === 'spline') fail(SET_CURVE_POINT_SPLINE(id));
        const names: readonly string[] = CURVE_POINTS[old.type];
        const point = string(cmd.point, 'setCurvePoint.point');
        if (!names.includes(point)) fail(`setCurvePoint.point: a ${old.type} has the points ${names.join(', ')}, not "${point}"`);
        const to = string(cmd.to, 'setCurvePoint.to');
        if ((old as unknown as Record<string, Id>)[point] === to) return s;
        const changed = curve(s, { ...old, [point]: to }, 'setCurvePoint');
        const next = { ...s, curves: { ...s.curves, [id]: changed } };
        for (const [constraintId, c] of Object.entries(s.constraints)) {
          if (!constraintOperands(c).includes(id)) continue;
          const problem = constraintRuleProblem(next, c);
          if (problem) fail(`setCurvePoint: the constraint "${constraintId}" on "${id}" would not hold: ${problem}`);
        }
        return next;
      });

    case 'addConstraint':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = unique(doc, cmd.id, 'addConstraint.id');
        const fields = new Fields('add', {}, () => evaluateParameters(doc.parameters));
        const added = constraint(s, withPosition(s, cmd.constraint), 'addConstraint.constraint', fields, id);
        const twin = duplicateOf(s, added);
        if (twin !== undefined) fail(`addConstraint: the same constraint is already in the sketch ("${twin}")`);
        return withConstraints(s, { ...s.constraints, [id]: added }, fields.expressions('addConstraint.constraint') ?? {});
      });

    case 'removeConstraint':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'removeConstraint.id');
        if (!has(s.constraints, id)) fail(`removeConstraint: the constraint "${id}" is not in the sketch`);
        return withConstraints(s, without(s.constraints, (c) => c === id));
      });

    case 'setConstraintValue':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'setConstraintValue.id');
        if (!has(s.constraints, id)) fail(`setConstraintValue: the constraint "${id}" is not in the sketch`);
        const old = s.constraints[id];
        if (!isDimension(old)) return fail(`setConstraintValue: the constraint "${id}" is not a dimension`);
        // Without `value` neither the value nor the expression changes; a number removes the
        // expression, a string sets it. The expression of a reference dimension is dropped in
        // withConstraints.
        const path = constraintPath(id);
        const kept = cmd.value === undefined && s.expressions && has(s.expressions, path) ? { [path]: s.expressions[path] } : {};
        const fields = new Fields('update', kept, () => evaluateParameters(doc.parameters));
        const changed = { ...old, value: cmd.value === undefined ? old.value : cmd.value, driving: cmd.driving === undefined ? old.driving : cmd.driving };
        const next = constraint(s, changed, 'setConstraintValue', fields, id);
        // Only switching a reference dimension to driving may create a duplicate. A change of the
        // value passes even for dimensions that are duplicate already from the loaded document.
        const twin = old.driving ? undefined : duplicateOf(s, next, id);
        if (twin !== undefined) fail(`setConstraintValue: the sketch already has the same driving dimension ("${twin}")`);
        return withConstraints(s, { ...s.constraints, [id]: next }, { [path]: fields.expressions('setConstraintValue')?.[path] ?? null });
      });

    case 'dragPoint':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.point, 'dragPoint.point');
        if (!has(s.points, id)) fail(`dragPoint: "${id}" is not an own point of the sketch (the origin and projected geometry cannot be dragged)`);
        finite(cmd.x, 'dragPoint.x');
        finite(cmd.y, 'dragPoint.y');
        return s;
      });

    case 'addExternal':
      return editSketch(doc, cmd.sketch, (s, index) => {
        const id = unique(doc, cmd.id, 'addExternal.id');
        // the numeric fields of the entry may be expressions (its input form), read at external/<id>/…
        const context = entryContext(doc, index);
        const ref = externalRef(context, s, id, cmd.ref, 'addExternal.ref');
        const kind = kindOf(ref);
        const problem = kind.source === 'derived' ? kind.commandProblem(s, ref, undefined, (entity) => entityOf(s, entity)) : undefined;
        if (problem) fail(`addExternal.ref: ${problem}`);
        return withEntryExpressions({ ...s, external: { ...s.external, [id]: ref } }, id, context.fields.expressions('addExternal.ref') ?? {});
      });

    case 'updateExternal':
      return editSketch(doc, cmd.sketch, (s, index) => {
        const id = string(cmd.id, 'updateExternal.id');
        if (!has(s.external, id)) fail(`updateExternal: the projection "${id}" is not in the sketch`);
        // A string equal to the expression a field has is no change and is not evaluated again (as
        // updateFeature keeps a repeated expression): the field gets its number and the expression is
        // handed to the reader as given. Every other address of the entry is set anew.
        const prefix = `external/${id}/`;
        const given: Record<FieldPath, Expr> = {};
        let input = partialInput(s, id, cmd.ref);
        for (const [path, expr] of Object.entries(s.expressions ?? {})) {
          if (!path.startsWith(prefix)) continue;
          const local = path.slice(prefix.length);
          const sent = atPath(input, local);
          const stored = atPath(s.external[id], local);
          if (typeof sent === 'string' && sent.trim() === expr && typeof stored === 'number') {
            input = withPath(input, local, stored);
            given[path] = expr;
          }
        }
        // The form of the new entry first, with no reference checked. An update that keeps the
        // source of the entry (`keepsValue` of its kind: a projection from a sketch with its flag
        // switched, D69) brings in no reference and checks none, so it is taken also when the source
        // is gone; any other is validated again with every reference.
        const before = s.external[id];
        const fieldsOf = () => new Fields('update', given, () => evaluateParameters(doc.parameters));
        const form = { ...refContext(doc, undefined), fields: fieldsOf() };
        const shaped = externalRef(form, s, id, input, 'updateExternal.ref');
        const kindOfShaped = kindOf(shaped);
        const keeps = kindOfShaped.source === 'reference' && before.type === shaped.type && ((kindOfShaped as { keepsValue?: (a: ExternalRef, b: ExternalRef) => boolean }).keepsValue?.(before, shaped) ?? false);
        // an entry of reference geometry that names nothing of the model (an outline, D72) has
        // nothing a second pass could check: its form is taken, once
        const namesNothing = kindOfShaped.source === 'reference' && kindOfShaped.refs(shaped, prefix).length === 0 && kindOfShaped.faces(shaped).length === 0;
        const context = keeps || namesNothing ? form : { ...refContext(doc, index), fields: fieldsOf() };
        const ref = keeps || namesNothing ? shaped : externalRef(context, s, id, input, 'updateExternal.ref');
        // A change of the kind would change the derived IDs; whoever wants another kind deletes the
        // projection and creates a new one.
        const problem = updateProblem(s, id, before, ref);
        if (problem) fail(`updateExternal: ${problem}`);
        // of a derived entry only what the update brings in is checked against the sketch
        const kind = kindOf(ref);
        const brought = kind.source === 'derived' ? kind.commandProblem(s, ref, before, (entity) => entityOf(s, entity)) : undefined;
        if (brought) fail(`updateExternal.ref: ${brought}`);
        // The stored value belonged to the source replaced, unless the update keeps the source.
        const next = { ...s, external: { ...s.external, [id]: ref }, solved: keeps ? s.solved : { ...s.solved, external: without(s.solved.external, (e) => e === id) } };
        return withEntryExpressions(next, id, context.fields.expressions('updateExternal.ref') ?? {});
      });

    case 'removeExternal':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'removeExternal.id');
        if (!has(s.external, id)) fail(`removeExternal: the projection "${id}" is not in the sketch`);
        const derived = (operand: Id) => operand === id || operand.startsWith(`${id}/`);
        // the expressions of the entry go with it (withConstraints keeps none of an entry that is gone)
        const left = { ...s, external: without(s.external, (e) => e === id), solved: { ...s.solved, external: without(s.solved.external, (e) => e === id) } };
        return withConstraints(
          left,
          without(s.constraints, (_, c) => constraintOperands(c).some(derived)),
        );
      });

    default:
      // a command of a section of the document (body properties), or none at all
      return applySectionCommand(doc, cmd, HOST_CONTEXT) ?? fail(`unknown command "${String(cmd.type)}"`);
  }
}

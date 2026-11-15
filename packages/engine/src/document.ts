// Dokument: validace a provedení příkazů. Vše pracuje jen se strukturou dokumentu, bez přepočtu.
// Pravidla jsou v docs/architecture.md, sekce Příkazy.
import type {
  Check,
  Command,
  Constraint,
  Curve,
  Document,
  Expr,
  Feature,
  FieldPath,
  Id,
  Input,
  Parameter,
  SketchFeature,
} from './types';
import { CONSTRAINTS } from './catalog';
import { type Environment, analyzeExpression, evaluateParameters, parameterNameProblem, renameInExpression } from './expression';
import { bodyOwner, constraintOperands, constraintPath, curvePoints, documentIds, duplicateOf, entityOf, isDimension, isDriving } from './sketch-content';
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
import { FEATURE_TYPES, refContext, requireRef, specOf } from './features/index';
import type { FeatureModule } from './features/module';
import { constraint, curve, externalRef } from './features/sketch';

// What moved to the leaf modules keeps its path here: the tests and the modules above import it from
// the document.
export {
  type Entity,
  type EntityKind,
  bodyOwner,
  constraintKey,
  constraintOperands,
  constraintPath,
  curvePoints,
  derivedPoints,
  documentIds,
  duplicateOf,
  emptySketch,
  entityOf,
  isDimension,
  isDriving,
} from './sketch-content';
export { CommandError, type FeatureRef, type FieldInfo, type RefKind } from './validation';
export { FEATURE_TYPE_INFO } from './features/index';
export type { FeatureTypeInfo } from './features/module';
export { MAX_PATTERN_COUNT } from './features/pattern';

export { SCHEMA_VERSION } from './schema';

export const emptyDocument = (): Document => ({ ...schemaHeader(), settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [] });

const sketchIds = (s: SketchFeature): Id[] => [s.points, s.curves, s.constraints, s.external].flatMap((group) => Object.keys(group));

const expressionsOf = (o: Dict, what: string): Record<FieldPath, Expr> =>
  o.expressions === undefined ? {} : Object.fromEntries(Object.entries(object(o.expressions, `${what}.expressions`)).map(([path, expr]) => [path, string(expr, `${what}.expressions.${path}`)]));

const NO_ENVIRONMENT = (): Environment => ({});

// ---------------------------------------------------------------- entity skici

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

// ---------------------------------------------------------------- registr typů features

// Validates a feature and returns its canonical copy. `before`: see requireRef; `mode`: see FieldMode.
function feature(doc: Document, before: number | undefined, v: unknown, what: string, mode: FieldMode): Feature {
  const o = object(v, what);
  const type = oneOf(o.type, Object.keys(FEATURE_TYPES) as Feature['type'][], `${what}.type`);
  return validated(FEATURE_TYPES[type] as FeatureModule<Feature>, doc, before, o, what, mode);
}

function validated(spec: FeatureModule<Feature>, doc: Document, before: number | undefined, o: Dict, what: string, mode: FieldMode): Feature {
  const fields = new Fields(mode, expressionsOf(o, what), () => evaluateParameters(doc.parameters));
  const checked = spec.validate(o, what, { ...refContext(doc, before), fields });
  const expressions = fields.expressions(what);
  return expressions ? { ...checked, expressions } : checked;
}

const EMPTY: Document = { ...schemaHeader(), settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [] };
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
  // older documents are brought to the schema of this build first (schema.ts); it changes only the shape
  const o = upgradeDocument(object(value, 'dokument'));
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
  const doc: Document = { ...schemaHeader(), settings: { chordTolerance }, parameters, checks, features: [] };
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
  if (documentIds(doc).has(id)) fail(`${what}: ID "${id}" už v dokumentu je`);
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
      const ids = documentIds(doc);
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
        external: { ...s.external, [unique(doc, cmd.id, 'addExternal.id')]: externalRef(refContext(doc, index), cmd.ref, 'addExternal.ref') },
      }));

    case 'updateExternal':
      return editSketch(doc, cmd.sketch, (s, index) => {
        const id = string(cmd.id, 'updateExternal.id');
        if (!has(s.external, id)) fail(`updateExternal: promítnutí "${id}" ve skice není`);
        const ref = externalRef(refContext(doc, index), cmd.ref, 'updateExternal.ref');
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

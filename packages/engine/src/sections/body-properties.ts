// The section `bodyProperties` (D48): the name, colour, material, use, density and mass of a body,
// by body ID. Validation (strict: a field this build does not know is refused), the three commands,
// the result of the recompute with what a copy inherits, and the two helpers other packages read.
import type { NumberSpec } from '../catalog';
import { DATA_CATALOGS } from '../data-catalogs';
import { type Environment, evaluateParameters } from '../expression';
import { bodyProblem, bodySource } from '../features/index';
import { bodyOwner } from '../sketch-content';
import type { BodyProperties, BodyPropertiesResult, BodyResult, BodyUse, Document, Expr, ExpressionError, Id } from '../types';
import { has } from '../util';
import { type Dict, type FieldMode, fail, newId, object, oneOf, onlyFields, string } from '../validation';
import { type EntryField, type EntryValues, readEntryFields, renamedEntry, resolveEntryFields, storedExpressions, writtenEntry } from './fields';
import type { SectionSpec } from './spec';

type Section = Record<Id, BodyProperties>;
type Results = Record<Id, BodyPropertiesResult>;

// The upper bound of the density lies above the densest element (osmium, 22.6 g/cm3) and keeps a
// value in another unit (1240 kg/m3) from passing. The arguments of the mass query share it.
export const DENSITY: NumberSpec = { title: 'Density', unit: 'g/cm3', min: { value: 0, open: true }, max: { value: 25 } };
export const MASS: NumberSpec = { title: 'Mass', unit: 'g', min: { value: 0, open: true } };
const FIELDS: readonly EntryField[] = [
  { path: 'density', spec: DENSITY },
  { path: 'mass', spec: MASS },
];
const USES: readonly BodyUse[] = ['part', 'reference', 'auxiliary'];
const ENTRY_FIELDS = ['name', 'color', 'material', 'use', 'density', 'mass'] as const;
const TEXT_LIMIT = 200;
const NO_ENVIRONMENT = (): Environment => ({});

// ---------------------------------------------------------------- validation

// A text for people (a name of a body, a link or a joint; a material).
export function label(v: unknown, what: string): string {
  const text = string(v, what);
  if (text === '' || text !== text.trim() || text.length > TEXT_LIMIT) fail(`${what}: a text that is not empty, has no leading or trailing space and at most ${TEXT_LIMIT} characters is expected`);
  return text;
}
function color(v: unknown, what: string): string {
  const text = string(v, what);
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) fail(`${what}: a colour is written "#rrggbb", such as "#30343a"`);
  return text.toLowerCase();
}

// The form of a key: a body ID whose part before the first slash could be an ID. Whether a feature
// creates the body is not asked on a load, as for every reference of a document.
export function bodyKey(key: string, what: string): void {
  const { feature, local } = bodyOwner(key);
  newId(feature, what);
  if (local === '') fail(`${what}: "${key}" is not a body ID`);
}

// An entry in its canonical form (the fields in one order, the expressions sorted); undefined when
// no field is left, so that "nothing set" has one spelling.
function entry(o: Dict, given: Record<string, Expr>, mode: FieldMode, environment: () => Environment, key: string, what: string): BodyProperties | undefined {
  onlyFields(o, [...ENTRY_FIELDS, 'expressions'], what, 'the properties of a body');
  const name = o.name === undefined ? undefined : label(o.name, `${what}.name`);
  const shade = o.color === undefined ? undefined : color(o.color, `${what}.color`);
  const material = o.material === undefined ? undefined : label(o.material, `${what}.material`);
  const use = o.use === undefined ? undefined : oneOf(o.use, USES, `${what}.use`);
  const { numbers, expressions } = readEntryFields(o, given, FIELDS, mode, environment, key, what);
  const out: BodyProperties = {
    ...(name === undefined ? {} : { name }),
    ...(shade === undefined ? {} : { color: shade }),
    ...(material === undefined ? {} : { material }),
    ...(use === undefined ? {} : { use }),
    ...(numbers.density === undefined ? {} : { density: numbers.density }),
    ...(numbers.mass === undefined ? {} : { mass: numbers.mass }),
    ...(expressions ? { expressions } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

// The section with the entry of `key` set, or removed when there is none; the place of a key that
// stays does not change.
function withEntry(section: Section, key: Id, value: BodyProperties | undefined): Section {
  if (value === undefined) return has(section, key) ? Object.fromEntries(Object.entries(section).filter(([other]) => other !== key)) : section;
  if (has(section, key) && JSON.stringify(section[key]) === JSON.stringify(value)) return section;
  return { ...section, [key]: value };
}

function requireBody(doc: Document, v: unknown, what: string): Id {
  const body = string(v, what);
  const problem = bodyProblem(doc, body);
  if (problem) fail(`${what}: ${problem}`);
  return body;
}

const ownEntry = (section: Section, key: Id): BodyProperties | undefined => (has(section, key) ? section[key] : undefined);

// ---------------------------------------------------------------- commands

function setBodyProperties(doc: Document, cmd: Dict): Section {
  const body = requireBody(doc, cmd.body, 'setBodyProperties.body');
  const patch = object(cmd.patch, 'setBodyProperties.patch');
  onlyFields(patch, ENTRY_FIELDS, 'setBodyProperties.patch', 'the properties of a body');
  const { expressions, ...fields } = ownEntry(doc.bodyProperties, body) ?? {};
  const merged: Dict = { ...fields };
  const given: Record<string, Expr> = { ...expressions };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // a field the patch names loses its expression: a number removes it, a string sets a new one
    delete given[key];
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  const next = entry(merged, given, 'update', () => evaluateParameters(doc.parameters), body, 'setBodyProperties.patch');
  return withEntry(doc.bodyProperties, body, next);
}

// The catalog fills the label and the density; the document keeps the number.
function setBodyMaterial(doc: Document, cmd: Dict): Section {
  const body = requireBody(doc, cmd.body, 'setBodyMaterial.body');
  const key = string(cmd.material, 'setBodyMaterial.material');
  const rows = DATA_CATALOGS.materials.rows;
  if (!has(rows, key)) return fail(`setBodyMaterial.material: the catalog "materials" has no row "${key}"; its rows are ${Object.keys(rows).join(', ')}. A material of your own is setBodyProperties with \`material\` and \`density\``);
  const { expressions, ...fields } = ownEntry(doc.bodyProperties, body) ?? {};
  const given: Record<string, Expr> = expressions?.mass === undefined ? {} : { mass: expressions.mass };
  const next = entry({ ...fields, material: key, density: rows[key].density }, given, 'update', () => evaluateParameters(doc.parameters), body, 'setBodyMaterial');
  return withEntry(doc.bodyProperties, body, next);
}

function removeBodyProperties(doc: Document, cmd: Dict): Section {
  const body = string(cmd.body, 'removeBodyProperties.body');
  if (!has(doc.bodyProperties, body)) fail(`removeBodyProperties.body: the document has no properties of the body "${body}"`);
  return withEntry(doc.bodyProperties, body, undefined);
}

// ---------------------------------------------------------------- the result

// The name of a body without a name of its own: after the feature that created it; a copy adds its
// number, as the app has named bodies since D35.
function defaultName(doc: Document, body: Id): string {
  const { feature, local } = bodyOwner(body);
  const name = doc.features.find((f) => f.id === feature)?.name ?? feature;
  return local === undefined ? name : `${name} / ${local}`;
}

function evaluate(section: Section, doc: Document, bodies: Readonly<Record<Id, BodyResult>>, environment: Environment): { result: Results; written?: Section } {
  // every entry once, whether its body is there or not: its numbers are written back either way
  const values = new Map<Id, EntryValues>();
  const valuesOf = (key: Id): EntryValues => {
    let found = values.get(key);
    if (!found) values.set(key, (found = resolveEntryFields(section[key] as Dict, FIELDS, environment)));
    return found;
  };
  let written: Section | undefined;
  for (const [key, own] of Object.entries(section)) {
    const next = writtenEntry(own as Dict & BodyProperties, valuesOf(key));
    if (next !== own) (written ??= { ...section })[key] = next;
  }

  const result: Results = {};
  for (const [id, body] of Object.entries(bodies)) {
    // the body and the bodies it was copied from, nearest first; a cycle (a document edited by hand)
    // stops at a body seen already
    const chain: Id[] = [id];
    for (let source = bodySource(doc, id); source !== undefined && !chain.includes(source); source = bodySource(doc, source)) chain.push(source);
    const entries = chain.map((key) => ownEntry(section, key));
    const first = <K extends 'color' | 'material' | 'use'>(field: K): BodyProperties[K] => entries.find((e) => e?.[field] !== undefined)?.[field];
    const use = first('use') ?? 'part';
    const own = entries[0];
    // the density and the mass are inherited together
    const pairAt = entries.findIndex((e) => e !== undefined && (e.density !== undefined || e.mass !== undefined));
    const pair = pairAt < 0 ? undefined : (entries[pairAt] as BodyProperties);
    const { values: numbers, errors } = pairAt < 0 ? { values: {}, errors: {} as Record<string, ExpressionError> } : valuesOf(chain[pairAt]);
    let mass: { mass: number; massFrom: 'mass' | 'density' } | undefined;
    if (use !== 'auxiliary' && pair) {
      if (pair.mass !== undefined) mass = numbers.mass === undefined ? undefined : { mass: numbers.mass, massFrom: 'mass' };
      else if (numbers.density !== undefined) mass = { mass: (numbers.density * body.volume) / 1000, massFrom: 'density' };
    }
    const fieldErrors = Object.keys(errors).length ? (errors as BodyPropertiesResult['fieldErrors']) : undefined;
    const colour = first('color');
    const material = first('material');
    result[id] = {
      name: own?.name ?? defaultName(doc, id),
      ...(colour === undefined ? {} : { color: colour }),
      ...(material === undefined ? {} : { material }),
      use,
      ...(numbers.density === undefined ? {} : { density: numbers.density }),
      ...(mass ?? {}),
      ...(chain.length > 1 ? { from: chain[1] } : {}),
      ...(fieldErrors ? { fieldErrors } : {}),
    };
  }
  return { result, ...(written ? { written } : {}) };
}

// ---------------------------------------------------------------- the entry of the registry

export const bodyProperties: SectionSpec<Section, Results> = {
  info: {
    title: 'Body properties',
    summary:
      'The name, colour, material, use, density and mass of a body, by body ID (also `<pattern>/<number>`; a mirror only `<pattern>/1`). The use is `part` (printed; the default), `reference` (a bought part: not printed, has a mass) or `auxiliary` (no physical thing: not printed, no mass; it still takes part in the interference and gap queries). ' +
      'A copy made by a pattern of a body, and the part a split cuts off, inherits from its source what its own entry does not state, the density and the mass as a pair; its name is not inherited. The mass of a body is its `mass` (a weighed part, a data sheet) or density × volume. ' +
      'The catalog `materials` fills the label and the density (command setBodyMaterial); the document keeps the number. An entry whose body is gone stays in the document and is taken over by a body made again under that ID; get_model lists such entries.',
    commands: ['setBodyProperties', 'setBodyMaterial', 'removeBodyProperties'],
    fields: FIELDS.map((field) => ({ owner: 'body', ...field })),
  },
  empty: () => ({}),
  validate(value, what) {
    const o = object(value, what);
    const out: Section = {};
    for (const [key, item] of Object.entries(o)) {
      bodyKey(key, `${what}.${key}`);
      const given = object(item, `${what}.${key}`);
      const checked = entry(given, storedExpressions(given, `${what}.${key}`), 'load', NO_ENVIRONMENT, key, `${what}.${key}`);
      if (checked) out[key] = checked;
    }
    return out;
  },
  commands: { setBodyProperties, setBodyMaterial, removeBodyProperties },
  renameParameter(section, from, to) {
    const renamed = Object.fromEntries(Object.entries(section).map(([key, own]) => [key, renamedEntry(own, from, to)]));
    return Object.keys(renamed).every((key) => renamed[key] === section[key]) ? section : renamed;
  },
  // the feature of every key, and a derived key itself
  names: (section) => Object.keys(section).flatMap((key) => (bodyOwner(key).local === undefined ? [key] : [key, bodyOwner(key).feature])),
  evaluate,
};

// ---------------------------------------------------------------- helpers for the readers

// The bodies a print export or a print query takes when the caller names none: those with the use
// `part`, in the order of the model. It takes the result of the recompute, which the context of
// a query or of an export format has (`context.state.evaluation.bodyProperties`) as well as a state.
export const printedBodies = (properties: Readonly<Results>): Id[] => Object.keys(properties).filter((id) => properties[id].use === 'part');

// Entries of the section whose body the state does not have: the keys of the section that are not
// keys of the result. Meant for the state at the end of the timeline.
export const bodyPropertiesWithoutBody = (section: Readonly<Section>, properties: Readonly<Results>): Id[] => Object.keys(section).filter((key) => !has(properties, key));

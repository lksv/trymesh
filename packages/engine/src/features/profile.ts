// The document half of a profile source: its validation, its references, what a patch may remove
// from it and its numeric fields. Every feature that takes a profile uses it; the recompute half is
// recompute/profile.ts.
import type { FieldSpec, NumberSpec } from '../catalog';
import { GENERATORS, isFlag } from '../generators';
import type { GeneratorName, Id, ProfileSource, RegionRef } from '../types';
import { has } from '../util';
import { type Dict, type FeatureRef, type ValidationContext, boolean, fail, object, oneOf, string } from '../validation';

function regions(v: unknown, what: string): RegionRef[] {
  if (!Array.isArray(v) || v.length === 0) fail(`${what}: a non-empty list of regions is expected`);
  const seen = new Set<string>();
  const out: RegionRef[] = [];
  (v as unknown[]).forEach((r, i) => {
    const loop = object(r, `${what}[${i}]`).outerLoop;
    if (!Array.isArray(loop) || loop.length === 0) fail(`${what}[${i}].outerLoop: a non-empty list of curve IDs is expected`);
    const ids = [...new Set((loop as unknown[]).map((id, k) => string(id, `${what}[${i}].outerLoop[${k}]`)))].sort();
    const key = JSON.stringify(ids);
    if (!seen.has(key)) out.push({ outerLoop: ids }); // the same region twice is one region
    seen.add(key);
  });
  return out;
}

// The curves of a wall: a non-empty list of IDs, stored sorted and without duplicates (the order of
// the chain follows from the joins of the curves, not from the list).
function curves(v: unknown, what: string): Id[] {
  if (!Array.isArray(v) || v.length === 0) fail(`${what}: a non-empty list of curve IDs is expected`);
  return [...new Set((v as unknown[]).map((id, i) => string(id, `${what}[${i}]`)))].sort();
}
const WALL_CURVE_KINDS = ['line', 'arc', 'circle'] as const;

const PROFILE_FIELDS: Record<ProfileSource['type'], readonly string[]> = {
  regions: ['type', 'sketch', 'regions', 'offset'],
  generated: ['type', 'generator', 'sketch', 'operands', 'params', 'refs'],
  wall: ['type', 'sketch', 'curves', 'thickness'],
};

// The offset of a profile of regions is an optional field: its description has a default, which is
// what an absent field means, and the default is not stored (a field of a feature, unlike
// a parameter of a generator, whose default is stored when the parameter is left out).
const PROFILE_OFFSET: NumberSpec = { title: 'Offset', unit: 'mm', default: 0 };
const WALL_THICKNESS: NumberSpec = { title: 'Thickness', unit: 'mm', min: { value: 0, open: true } };

// The numeric fields of a profile, as the registry of feature types lists them: the offset of
// regions, the thickness of a wall, and the parameters of every generator, each present when the
// profile comes from that generator.
export const PROFILE_FIELD_SPECS: FieldSpec[] = [
  { path: 'profile/offset', spec: PROFILE_OFFSET, when: { path: 'profile/type', equals: 'regions' } },
  { path: 'profile/thickness', spec: WALL_THICKNESS, when: { path: 'profile/type', equals: 'wall' } },
  ...Object.entries(GENERATORS).flatMap(([generator, spec]) =>
    Object.entries(spec.params).flatMap(([name, param]): FieldSpec[] => (isFlag(param) ? [] : [{ path: `profile/params/${name}`, spec: param, when: { path: 'profile/generator', equals: generator } }])),
  ),
];

// What `null` in a patch may remove from a profile that does not have it: the offset of regions
// (an optional field), an entry of a dictionary the generator catalog knows (a parameter returns to
// its default, an optional one is removed, a reference is not set) and the dictionary of references
// itself. Anything else that
// is not there is a typo.
export function removableFromProfile(profile: ProfileSource, path: string[]): boolean {
  if (profile.type === 'regions') return path.length === 1 && path[0] === 'offset';
  if (profile.type !== 'generated') return false;
  const spec = GENERATORS[profile.generator];
  const [dictionary, name, ...rest] = path;
  if (rest.length) return false;
  if (name === undefined) return dictionary === 'refs';
  if (dictionary === 'params') return has(spec.params, name);
  if (dictionary === 'refs') return has(spec.refs, name);
  return dictionary === 'operands' && spec.operands.some((operand) => operand.field === name);
}

// The profile source of a feature. A generated profile follows the generator catalog: operands
// and references by its names, parameters with its ranges and defaults, in the order of the catalog;
// an optional parameter is stored only when it is given.
// The offset of regions is stored only when it is given (also a zero), and a wall takes own curves
// of its sketch: whether they form a chain depends on solved positions and shows in the recompute.
export function profileSource(context: ValidationContext, v: unknown, what: string): ProfileSource {
  const { fields } = context;
  const profile = object(v, what);
  const type = oneOf(profile.type, ['regions', 'generated', 'wall'] as const, `${what}.type`);
  // A field of the other variant is a mistake: a profile of regions with generator parameters would
  // otherwise be accepted as plain regions.
  for (const key of Object.keys(profile)) if (!PROFILE_FIELDS[type].includes(key)) fail(`${what}.${key}: a profile of the type ${type} has no such field`);
  const sketch = string(profile.sketch, `${what}.sketch`);
  context.requireRef({ id: sketch, kind: 'sketch' }, `${what}.sketch`);
  if (type === 'regions') {
    const selected = regions(profile.regions, `${what}.regions`);
    return profile.offset === undefined ? { type, sketch, regions: selected } : { type, sketch, regions: selected, offset: fields.number(profile.offset, 'profile/offset', PROFILE_OFFSET, `${what}.offset`) };
  }
  if (type === 'wall') {
    const chain = curves(profile.curves, `${what}.curves`);
    for (const curve of chain) context.requireRef({ id: curve, kind: 'entity', sketch, accepts: WALL_CURVE_KINDS, notProjected: true }, `${what}.curves`);
    return { type, sketch, curves: chain, thickness: fields.number(profile.thickness, 'profile/thickness', WALL_THICKNESS, `${what}.thickness`) };
  }
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
    context.requireRef({ id: operands[field], kind: 'entity', sketch, accepts: kinds }, `${what}.operands.${field}`);
  }
  const givenParams = dictionary('params', spec.params);
  const params: Record<string, number | boolean | string> = {};
  for (const [name, param] of Object.entries(spec.params)) {
    const value = givenParams[name];
    const at = `${what}.params.${name}`;
    if (isFlag(param)) params[name] = value === undefined ? param.default : boolean(value, at);
    else if (value === undefined && param.optional) continue; // its absence is its default
    else if (value === undefined && param.default === undefined) fail(`${at}: the parameter is required`);
    else params[name] = fields.number(value === undefined ? param.default : value, `profile/params/${name}`, param, at);
  }
  const givenRefs = dictionary('refs', spec.refs, true);
  const refs: Record<string, Id> = {};
  for (const [name, ref] of Object.entries(spec.refs)) {
    if (givenRefs[name] === undefined) continue;
    refs[name] = string(givenRefs[name], `${what}.refs.${name}`);
    context.requireRef({ id: refs[name], kind: 'generated', accepts: ref.generators }, `${what}.refs.${name}`);
  }
  return { type, generator, sketch, operands, params, ...(Object.keys(refs).length ? { refs } : {}) };
}

// References of a profile source to other features and to entities of its sketch.
export function profileRefs(profile: ProfileSource): FeatureRef[] {
  const sketch: FeatureRef = { path: 'profile/sketch', id: profile.sketch, kind: 'sketch' };
  if (profile.type === 'regions') return [sketch];
  if (profile.type === 'wall') return [sketch, ...profile.curves.map((id): FeatureRef => ({ path: 'profile/curves', id, kind: 'entity', sketch: profile.sketch, accepts: WALL_CURVE_KINDS, notProjected: true }))];
  const spec = GENERATORS[profile.generator];
  return [
    sketch,
    ...spec.operands.map((operand): FeatureRef => ({ path: `profile/operands/${operand.field}`, id: profile.operands[operand.field], kind: 'entity', sketch: profile.sketch, accepts: operand.kinds })),
    ...Object.entries(profile.refs ?? {}).map(([name, id]): FeatureRef => ({ path: `profile/refs/${name}`, id, kind: 'generated', accepts: spec.refs[name].generators })),
  ];
}

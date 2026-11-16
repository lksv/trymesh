// The section `mechanism` (D49): links (bodies that move as one piece) and joints between them.
// Validation (strict, and the section is checked whole: a forest of joints, a body in at most one
// link), the five commands, the result of the recompute (the transform of every link, the numbers
// and the axis of every joint, what is in error), and what the readers of the pose ask: the pose of
// a body, the motions from a root to a link, what hangs on a joint, the note about a pose.
import type { NumberSpec } from '../catalog';
import { type Environment, evaluateParameters } from '../expression';
import { bodyProblem, refContext } from '../features/index';
import { axis as axisOf, issue } from '../recompute/services';
import type { State } from '../recompute/state';
import { bodyOwner } from '../sketch-content';
import { IDENTITY, compose, isIdentity, rotation, shift, transformPoint, transformVector } from '../solid';
import type { BodyResult, Document, Expr, Id, Issue, Joint, JointResult, Link, LinkResult, Mechanism, MechanismResult, RigidTransform } from '../types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, has, unit3 } from '../util';
import { CommandError, type Dict, type FieldMode, Fields, type RefContext, axisRef, fail, newId, object, oneOf, onlyFields, string } from '../validation';
import { bodyKey, label } from './body-properties';
import { type EntryField, type EntryValues, readEntryFields, renamedEntry, resolveEntryFields, storedExpressions, writtenEntry } from './fields';
import type { SectionSpec } from './spec';

type JointType = Joint['type'];
const JOINT_TYPES: readonly JointType[] = ['revolute', 'continuous', 'prismatic', 'fixed'];

// The numeric fields of a joint, by its type. The limits of a revolute joint stay within a full turn
// each way, so a limit typed in degrees does not pass; its value is held by the limits. The value of
// a continuous joint may be many turns (a planet gear that follows its carrier).
const TURN = 2 * Math.PI;
const limit = (title: string, unit: 'rad' | 'mm'): NumberSpec => (unit === 'rad' ? { title, unit, min: { value: -TURN }, max: { value: TURN } } : { title, unit });
export const JOINT_FIELDS: { readonly [T in JointType]: readonly EntryField[] } = {
  revolute: [
    { path: 'lower', spec: limit('Lower limit', 'rad') },
    { path: 'upper', spec: limit('Upper limit', 'rad') },
    { path: 'value', spec: { title: 'Angle', unit: 'rad' } },
  ],
  continuous: [{ path: 'value', spec: { title: 'Angle', unit: 'rad' } }],
  prismatic: [
    { path: 'lower', spec: limit('Lower limit', 'mm') },
    { path: 'upper', spec: limit('Upper limit', 'mm') },
    { path: 'value', spec: { title: 'Travel', unit: 'mm' } },
  ],
  fixed: [],
};
// "Within the limits" has a tolerance, the tolerances of the engine: a value outside by no more
// than that is the limit, and is used and stored as the limit. The last step of a sweep computed in
// floating point, and a limit read from a tool that prints six decimal places, are otherwise
// refused at random.
export const LIMIT_TOLERANCE = { rad: ANGLE_TOLERANCE, mm: LENGTH_TOLERANCE } as const;
const toleranceOf = (type: JointType): number => (type === 'prismatic' ? LIMIT_TOLERANCE.mm : LIMIT_TOLERANCE.rad);
const unitOf = (type: JointType): string => (type === 'prismatic' ? 'mm' : 'rad');
const hasAxis = (type: JointType): boolean => type !== 'fixed';
const hasLimits = (type: JointType): boolean => type === 'revolute' || type === 'prismatic';

const NO_ENVIRONMENT = (): Environment => ({});
// A load checks the shape of a reference only, as for every reference of a document.
const SHAPE_ONLY: RefContext = { doc: undefined as unknown as Document, before: undefined, requireRef: () => undefined };
const number = (value: number): string => String(Number(value.toPrecision(12)));

// ---------------------------------------------------------------- validation

function bodyList(v: unknown, what: string): Id[] {
  if (!Array.isArray(v)) return fail(`${what}: a list of body IDs is expected`);
  const out: Id[] = [];
  v.forEach((item, i) => {
    const body = string(item, `${what}[${i}]`);
    bodyKey(body, `${what}[${i}]`);
    if (out.includes(body)) fail(`${what}[${i}]: the body "${body}" is in the list twice`);
    out.push(body);
  });
  return out;
}

function link(o: Dict, what: string): Link {
  onlyFields(o, ['name', 'bodies'], what, 'a link');
  const name = o.name === undefined ? undefined : label(o.name, `${what}.name`);
  return { ...(name === undefined ? {} : { name }), bodies: bodyList(o.bodies, `${what}.bodies`) };
}

// A joint in its canonical form (the fields in one order, the expressions sorted). The axis is
// checked for its shape; a command checks its target where it sets a new one.
function joint(o: Dict, given: Record<string, Expr>, mode: FieldMode, environment: () => Environment, key: Id, what: string): Joint {
  const type = oneOf(o.type, JOINT_TYPES, `${what}.type`);
  const fields = JOINT_FIELDS[type];
  onlyFields(o, ['type', 'name', 'parent', 'child', ...(hasAxis(type) ? ['axis'] : []), ...fields.map((field) => field.path), ...(fields.length ? ['expressions'] : [])], what, `a joint of the type ${type}`);
  const name = o.name === undefined ? undefined : label(o.name, `${what}.name`);
  const parent = newId(o.parent, `${what}.parent`);
  const child = newId(o.child, `${what}.child`);
  const axis = hasAxis(type) ? axisRef(SHAPE_ONLY, o.axis, `${what}.axis`) : undefined;
  for (const { path } of fields) if (o[path] === undefined) fail(`${what}.${path}: a joint of the type ${type} has ${fields.map((field) => `\`${field.path}\``).join(', ')}`);
  const { numbers, expressions } = readEntryFields(o, given, fields, mode, environment, key, what);
  return {
    type,
    ...(name === undefined ? {} : { name }),
    parent,
    child,
    ...(axis === undefined ? {} : { axis }),
    ...Object.fromEntries(fields.map(({ path }) => [path, numbers[path]])),
    ...(expressions ? { expressions } : {}),
  } as Joint;
}

// What always holds of the section: a body in at most one link, the joints a forest of the links.
function invariants(section: Mechanism, what: string): void {
  const owner = new Map<Id, Id>();
  for (const [id, own] of Object.entries(section.links)) {
    for (const body of own.bodies) {
      const other = owner.get(body);
      if (other !== undefined) fail(`${what}: the body "${body}" is in the links "${other}" and "${id}"; a body is in at most one link`);
      owner.set(body, id);
    }
  }
  const parentOf = new Map<Id, { joint: Id; parent: Id }>();
  for (const [id, j] of Object.entries(section.joints)) {
    for (const end of ['parent', 'child'] as const) if (!has(section.links, j[end])) fail(`${what}: the ${end} of the joint "${id}" is "${j[end]}", which is not a link of the mechanism`);
    if (j.parent === j.child) fail(`${what}: the joint "${id}" has the link "${j.child}" as its parent and its child`);
    const other = parentOf.get(j.child);
    if (other !== undefined) fail(`${what}: the link "${j.child}" is the child of the joints "${other.joint}" and "${id}"; a link hangs on at most one joint`);
    parentOf.set(j.child, { joint: id, parent: j.parent });
  }
  for (const start of parentOf.keys()) {
    const seen = new Set<Id>([start]);
    for (let at = parentOf.get(start); at !== undefined; at = parentOf.get(at.parent)) {
      if (seen.has(at.parent)) fail(`${what}: the link "${at.parent}" would hang on itself through the joints (the joint "${at.joint}" closes the loop); the joints form a tree`);
      seen.add(at.parent);
    }
  }
}

// A joint whose limits and value are compared as they are for the document the command is applied
// to: a field with an expression is evaluated against `environment`, a field whose expression does
// not evaluate takes no part. A value within the tolerance outside a limit is that limit.
function limitsChecked(j: Joint, environment: Environment, what: string): Joint {
  if (!hasLimits(j.type)) return j;
  const { values } = resolveEntryFields(j as unknown as Dict, JOINT_FIELDS[j.type], environment);
  const { lower, upper, value } = values;
  const unit = unitOf(j.type);
  if (lower !== undefined && upper !== undefined && lower > upper) fail(`${what}: the lower limit ${number(lower)} ${unit} is above the upper limit ${number(upper)} ${unit}`);
  if (value === undefined) return j;
  const tolerance = toleranceOf(j.type);
  const outside = (bound: number) => fail(`${what}: the value ${number(value)} ${unit} is outside the limits of the joint, ${lower === undefined ? '…' : number(lower)} to ${upper === undefined ? '…' : number(upper)} ${unit}${unit === 'rad' ? ' (radians: write degrees as deg(x))' : ''}; the nearest value allowed is ${number(bound)}`);
  if (lower !== undefined && value < lower) return value < lower - tolerance ? outside(lower) : ({ ...j, value: lower } as Joint);
  if (upper !== undefined && value > upper) return value > upper + tolerance ? outside(upper) : ({ ...j, value: upper } as Joint);
  return j;
}

// ---------------------------------------------------------------- commands

type Section = Mechanism;
const withEntry = <T>(record: Record<Id, T>, id: Id, value: T | undefined): Record<Id, T> => {
  if (value !== undefined) return { ...record, [id]: value };
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const known = (record: object, kind: string): string => (Object.keys(record).length ? `; its ${kind} are ${Object.keys(record).join(', ')}` : `; it has no ${kind}`);

function setLink(doc: Document, cmd: Dict): Section {
  onlyFields(cmd, ['type', 'id', 'name', 'bodies'], 'setLink', 'the command setLink');
  const section = doc.mechanism;
  const id = newId(cmd.id, 'setLink.id');
  const old = has(section.links, id) ? section.links[id] : undefined;
  const name = cmd.name === undefined ? old?.name : cmd.name === null ? undefined : label(cmd.name, 'setLink.name');
  const bodies = cmd.bodies === undefined ? (old?.bodies ?? []) : bodyList(cmd.bodies, 'setLink.bodies');
  bodies.forEach((body, i) => {
    if (old?.bodies.includes(body)) return; // only the bodies the link did not have before
    const problem = bodyProblem(doc, body);
    if (problem) fail(`setLink.bodies[${i}]: ${problem}`);
    const other = Object.keys(section.links).find((key) => key !== id && section.links[key].bodies.includes(body));
    if (other !== undefined) fail(`setLink.bodies[${i}]: the body "${body}" is in the link "${other}"; a body is in at most one link: take it out there first, in the same batch`);
  });
  const next: Link = { ...(name === undefined ? {} : { name }), bodies };
  if (old && same(old, next)) return section;
  return { ...section, links: withEntry(section.links, id, next) };
}

function removeLink(doc: Document, cmd: Dict): Section {
  onlyFields(cmd, ['type', 'id'], 'removeLink', 'the command removeLink');
  const section = doc.mechanism;
  const id = string(cmd.id, 'removeLink.id');
  if (!has(section.links, id)) fail(`removeLink.id: the mechanism has no link "${id}"${known(section.links, 'links')}`);
  const naming = Object.keys(section.joints).filter((key) => section.joints[key].parent === id || section.joints[key].child === id);
  if (naming.length) fail(`removeLink.id: the link "${id}" is named by the joint${naming.length > 1 ? 's' : ''} ${naming.map((key) => `"${key}"`).join(', ')}; remove or change ${naming.length > 1 ? 'them' : 'it'} first, in the same batch`);
  return { ...section, links: withEntry(section.links, id, undefined) };
}

function setJoint(doc: Document, cmd: Dict): Section {
  onlyFields(cmd, ['type', 'id', 'joint'], 'setJoint', 'the command setJoint');
  const section = doc.mechanism;
  const id = newId(cmd.id, 'setJoint.id');
  const input = object(cmd.joint, 'setJoint.joint');
  const old = has(section.joints, id) ? section.joints[id] : undefined;
  const type = oneOf(input.type, JOINT_TYPES, 'setJoint.joint.type');
  // The input form: an expression in `expressions` stands for its field. A string equal to the
  // expression the field already has is kept without evaluation, as in updateFeature.
  const { expressions: listed, ...o } = input;
  for (const [path, expr] of Object.entries(listed === undefined ? {} : storedExpressions(input, 'setJoint.joint'))) {
    if (typeof o[path] === 'string') fail(`setJoint.joint.${path}: the expression is given both in the field and in expressions`);
    if (typeof o[path] !== 'number') fail(`setJoint.joint.expressions.${path}: the joint has no numeric field "${path}"`);
    o[path] = expr;
  }
  const given: Record<string, Expr> = {};
  if (old?.type === type) {
    for (const { path } of JOINT_FIELDS[type]) {
      const stored = old.expressions?.[path as 'value'];
      if (stored !== undefined && typeof o[path] === 'string' && (o[path] as string).trim() === stored) {
        o[path] = (old as unknown as Dict)[path];
        given[path] = stored;
      }
    }
  }
  const environment = evaluateParameters(doc.parameters);
  let next = joint(o, given, 'update', () => environment, id, 'setJoint.joint');
  // only an axis the joint did not have before is checked against the document
  if ('axis' in next && !(old && 'axis' in old && same(old.axis, next.axis))) axisRef(refContext(doc, doc.features.length), next.axis, 'setJoint.joint.axis');
  next = limitsChecked(next, environment, 'setJoint.joint');
  const after = { ...section, joints: withEntry(section.joints, id, next) };
  invariants(after, 'setJoint');
  return old && same(old, next) ? section : after;
}

function removeJoint(doc: Document, cmd: Dict): Section {
  onlyFields(cmd, ['type', 'id'], 'removeJoint', 'the command removeJoint');
  const section = doc.mechanism;
  const id = string(cmd.id, 'removeJoint.id');
  if (!has(section.joints, id)) fail(`removeJoint.id: the mechanism has no joint "${id}"${known(section.joints, 'joints')}`);
  return { ...section, joints: withEntry(section.joints, id, undefined) };
}

function setPose(doc: Document, cmd: Dict): Section {
  onlyFields(cmd, ['type', 'values'], 'setPose', 'the command setPose');
  const section = doc.mechanism;
  const values = object(cmd.values, 'setPose.values');
  const environment = evaluateParameters(doc.parameters);
  let joints = section.joints;
  for (const [id, given] of Object.entries(values)) {
    const what = `setPose.values.${id}`;
    if (!has(section.joints, id)) fail(`${what}: the mechanism has no joint "${id}"${known(section.joints, 'joints')}`);
    const old = section.joints[id];
    if (old.type === 'fixed') fail(`${what}: the joint "${id}" is fixed and has no value`);
    const spec = (JOINT_FIELDS[old.type].find((field) => field.path === 'value') as EntryField).spec;
    // a number removes the expression of the value, a string sets one
    const reader = new Fields('update', {}, () => environment);
    let value: number;
    try {
      value = reader.number(given, 'value', spec, what);
    } catch (error) {
      if (error instanceof CommandError && error.expression?.path !== undefined) error.expression = { ...error.expression, path: `${id}/value` };
      throw error;
    }
    const expr = reader.expressions(what)?.value;
    const { value: _value, expressions, ...rest } = old as Joint & { value: number };
    const others = Object.fromEntries(Object.entries(expressions ?? {}).filter(([path]) => path !== 'value'));
    const kept = { ...others, ...(expr === undefined ? {} : { value: expr }) };
    const sorted = Object.fromEntries(Object.entries(kept).sort(([a], [b]) => (a < b ? -1 : 1)));
    const next = limitsChecked({ ...rest, value, ...(Object.keys(sorted).length ? { expressions: sorted } : {}) } as Joint, environment, what);
    if (!same(next, old)) joints = withEntry(joints, id, next);
  }
  return joints === section.joints ? section : { ...section, joints };
}

// ---------------------------------------------------------------- the result

// The motion of a joint: a turn about its axis by its value, a shift along it, or nothing (a fixed
// joint, a value of zero). From the numbers of the result, so the readers of the pose (the pair in
// the frame of its first body) compose the same numbers as the recompute.
export function motionOf(type: JointType, result: Pick<JointResult, 'value' | 'axis'>): RigidTransform {
  if (type === 'fixed' || !result.value || !result.axis) return IDENTITY;
  return type === 'prismatic' ? shift(result.axis.direction, result.value) : rotation(result.axis.origin, result.axis.direction, result.value);
}

interface Resolved {
  result: JointResult;
  moves: boolean; // has a motion (possibly none at all); false: blocks what hangs on it
}
function resolveJoint(id: Id, j: Joint, entry: EntryValues, state: State): Resolved {
  const values: Record<string, number> = { ...entry.values };
  const fieldErrors = Object.keys(entry.errors).length ? (entry.errors as JointResult['fieldErrors']) : undefined;
  const faults: Issue[] = [];
  if (fieldErrors) faults.push(issue('invalidExpression', Object.keys(entry.errors).map((path) => `${id}/${path}`)));
  const unit = unitOf(j.type);
  if (hasLimits(j.type)) {
    const { lower, upper, value } = values;
    const tolerance = toleranceOf(j.type);
    if (lower !== undefined && upper !== undefined && lower > upper) faults.push(issue('jointLimits', [id], `${number(lower)} ${unit} above ${number(upper)} ${unit}`));
    else if (value !== undefined) {
      if (lower !== undefined && value < lower) {
        if (value < lower - tolerance) faults.push(issue('jointOutOfLimits', [id], `${number(value)} ${unit} below ${number(lower)} ${unit}`));
        else values.value = lower;
      } else if (upper !== undefined && value > upper) {
        if (value > upper + tolerance) faults.push(issue('jointOutOfLimits', [id], `${number(value)} ${unit} above ${number(upper)} ${unit}`));
        else values.value = upper;
      }
    }
  }
  let axis: JointResult['axis'];
  let axisFault: Issue | undefined;
  if ('axis' in j) {
    const line = axisOf(j.axis, state);
    if ('code' in line) axisFault = issue(line.code, line.refs, `the axis of the joint "${id}"`);
    else axis = { origin: line.point, direction: unit3(line.direction) };
  }
  const error = faults[0] ?? axisFault;
  const result: JointResult = {
    status: error ? 'error' : 'ok',
    ...(error ? { error } : {}),
    ...(fieldErrors ? { fieldErrors } : {}),
    ...Object.fromEntries(['value', 'lower', 'upper'].filter((path) => values[path] !== undefined).map((path) => [path, values[path]])),
    ...(axis ? { axis } : {}),
  };
  // A joint at zero whose only fault is its axis moves nothing, whatever the axis is.
  return { result, moves: !error || (faults.length === 0 && values.value === 0) };
}

function evaluate(section: Section, doc: Document, bodies: Readonly<Record<Id, BodyResult>>, environment: Environment, state: State): { result: MechanismResult; written?: Section } {
  const entries = new Map<Id, EntryValues>();
  const resolved = new Map<Id, Resolved>();
  let written: Record<Id, Joint> | undefined;
  for (const [id, j] of Object.entries(section.joints)) {
    const entry = resolveEntryFields(j as unknown as Dict, JOINT_FIELDS[j.type], environment);
    entries.set(id, entry);
    const done = resolveJoint(id, j, entry, state);
    resolved.set(id, done);
    // What is written back: the limits whenever they are in the range of their fields; a value that
    // its expression takes out of the limits is not, and keeps its last valid number.
    const out = done.result.error?.code === 'jointOutOfLimits' ? { ...entry.values, value: (j as { value: number }).value } : { ...entry.values, ...(done.result.value === undefined ? {} : { value: done.result.value }) };
    const next = writtenEntry(j as unknown as Dict, { values: out, errors: entry.errors }) as unknown as Joint;
    if (next !== j) (written ??= { ...section.joints })[id] = next;
  }

  const jointOf = new Map<Id, Id>(); // child link → joint
  for (const [id, j] of Object.entries(section.joints)) jointOf.set(j.child, id);
  const links = new Map<Id, LinkResult>();
  const linkResult = (id: Id, path: Set<Id> = new Set()): LinkResult => {
    const found = links.get(id);
    if (found) return found;
    const own = section.links[id];
    const present = own.bodies.filter((body) => has(bodies, body));
    const missing = own.bodies.filter((body) => !has(bodies, body));
    const by = jointOf.get(id);
    let out: LinkResult;
    if (by === undefined || path.has(id)) out = { bodies: present, missing, transform: IDENTITY };
    else {
      const j = section.joints[by];
      const parent = linkResult(j.parent, new Set([...path, id]));
      const { result, moves } = resolved.get(by) as Resolved;
      const transform = compose(parent.transform, moves ? motionOf(j.type, result) : IDENTITY);
      const blockedBy = moves ? parent.blockedBy : by;
      out = { bodies: present, missing, transform, ...(blockedBy === undefined ? {} : { blockedBy }) };
    }
    links.set(id, out);
    return out;
  };
  const linkResults = Object.fromEntries(Object.keys(section.links).map((id) => [id, linkResult(id)]));
  const joints: Record<Id, JointResult> = {};
  for (const [id, j] of Object.entries(section.joints)) {
    const { result } = resolved.get(id) as Resolved;
    const parent = linkResults[j.parent];
    joints[id] = result.axis && parent && parent.blockedBy === undefined ? { ...result, axisInPose: { origin: transformPoint(parent.transform, result.axis.origin), direction: transformVector(parent.transform, result.axis.direction) } } : result;
  }
  const inLink = new Set(Object.values(section.links).flatMap((own) => own.bodies));
  const result: MechanismResult = {
    links: linkResults,
    joints,
    roots: Object.keys(section.links).filter((id) => !jointOf.has(id)),
    unassigned: Object.keys(section.links).length ? Object.keys(bodies).filter((body) => !inLink.has(body)) : [],
  };
  return { result, ...(written ? { written: { ...section, joints: written } } : {}) };
}

// ---------------------------------------------------------------- the entry of the registry

const FIELD_INFO = JOINT_TYPES.flatMap((type) => JOINT_FIELDS[type].map((field) => ({ owner: 'joint', ...field, when: { path: 'type', equals: type } })));

export const mechanism: SectionSpec<Section, MechanismResult> = {
  info: {
    title: 'Mechanism',
    summary:
      'Links (bodies that move as one piece; a body in at most one link) and joints between them (revolute, continuous, prismatic, fixed), each with a parent and a child link, an axis (`AxisRef`, as modelled), limits and a value. The joints form a forest; a link that is no joint\'s child is a root and stands as modelled. ' +
      'The model as modelled is the zero of every joint: the values are displacements from it (rad, by the right-hand rule about the direction of the axis; mm along it). The bodies of the evaluation stay as modelled; queries answer in the pose (`evaluation.mechanism`). ' +
      'A pose is stepped by previewing setPose (with `after` of the tool query); a coupled motion is two values that follow one parameter.',
    commands: ['setLink', 'removeLink', 'setJoint', 'removeJoint', 'setPose'],
    fields: FIELD_INFO,
  },
  empty: () => ({ links: {}, joints: {} }),
  // The section alone, strict, and whole: a field this build does not know is refused, and so is a
  // section that breaks what always holds of it. References out of the section are not resolved.
  validate(value, what) {
    const o = object(value, what);
    onlyFields(o, ['links', 'joints'], what, 'the mechanism');
    const links: Record<Id, Link> = {};
    for (const [key, item] of Object.entries(object(o.links, `${what}.links`))) {
      newId(key, `${what}.links.${key}`);
      links[key] = link(object(item, `${what}.links.${key}`), `${what}.links.${key}`);
    }
    const joints: Record<Id, Joint> = {};
    for (const [key, item] of Object.entries(object(o.joints, `${what}.joints`))) {
      newId(key, `${what}.joints.${key}`);
      const given = object(item, `${what}.joints.${key}`);
      joints[key] = joint(given, storedExpressions(given, `${what}.joints.${key}`), 'load', NO_ENVIRONMENT, key, `${what}.joints.${key}`);
    }
    const section = { links, joints };
    invariants(section, what);
    return section;
  },
  commands: { setLink, removeLink, setJoint, removeJoint, setPose },
  renameParameter(section, from, to) {
    const joints = Object.fromEntries(Object.entries(section.joints).map(([key, own]) => [key, renamedEntry(own, from, to)]));
    return Object.keys(joints).every((key) => joints[key] === section.joints[key]) ? section : { ...section, joints };
  },
  // the feature of every body of every link (and a derived body itself); the sketch and the point of
  // every axis, and the projected entity a derived point is of (`x1` of `x1/center`)
  names: (section) => [
    ...Object.values(section.links).flatMap((own) => own.bodies.flatMap((body) => (bodyOwner(body).local === undefined ? [body] : [body, bodyOwner(body).feature]))),
    ...Object.values(section.joints).flatMap((j) => ('axis' in j && j.axis.kind === 'sketchPoint' ? [j.axis.sketch, j.axis.point, ...(j.axis.point.includes('/') ? [j.axis.point.split('/')[0]] : [])] : [])),
  ],
  // the records of links and joints are kept stable entry by entry
  entries: ['links', 'joints'],
  evaluate,
};

// ---------------------------------------------------------------- what the readers ask

const linksOfBodies = new WeakMap<MechanismResult, Map<Id, Id>>();
// The link of a body of the state, by the result.
export function linkOf(mechanism: MechanismResult, body: Id): Id | undefined {
  let map = linksOfBodies.get(mechanism);
  if (!map) {
    map = new Map(Object.entries(mechanism.links).flatMap(([id, own]) => own.bodies.map((member): [Id, Id] => [member, id])));
    linksOfBodies.set(mechanism, map);
  }
  return map.get(body);
}

// How a body is posed: the transform of its link, nothing for a body in no link or in a link that
// stands as modelled, or the joint that blocks it.
export function poseOfBody(mechanism: MechanismResult, body: Id): RigidTransform | { blockedBy: Id } | undefined {
  const id = linkOf(mechanism, body);
  if (id === undefined) return undefined;
  const own = mechanism.links[id];
  if (own.blockedBy !== undefined) return { blockedBy: own.blockedBy };
  return isIdentity(own.transform) ? undefined : own.transform;
}

// The motions of the joints from a root to the link, nearest the root first, leaving out those that
// move nothing. Their product is the transform of the link.
export function motionsTo(section: Mechanism, mechanism: MechanismResult, link: Id): RigidTransform[] {
  const jointOf = new Map(Object.entries(section.joints).map(([id, j]): [Id, Id] => [j.child, id]));
  const out: RigidTransform[] = [];
  const seen = new Set<Id>();
  for (let at = link, by = jointOf.get(at); by !== undefined && !seen.has(at); at = section.joints[by].parent, by = jointOf.get(at)) {
    seen.add(at);
    const motion = has(mechanism.joints, by) ? motionOf(section.joints[by].type, mechanism.joints[by]) : IDENTITY;
    if (!isIdentity(motion)) out.unshift(motion);
  }
  return out;
}

// What hangs on a joint: its child link and every link beyond it, their bodies that the state has,
// and the bodies those links list that the state does not have.
export interface Carried {
  joint: Id;
  links: Id[];
  bodies: Id[];
  missing: Id[];
}
export function carriedBy(section: Mechanism, mechanism: MechanismResult, joint: Id): Carried {
  const beyond = new Set<Id>([section.joints[joint].child]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const j of Object.values(section.joints)) if (beyond.has(j.parent) && !beyond.has(j.child)) grew = beyond.add(j.child) !== undefined;
  }
  const links = Object.keys(section.links).filter((id) => beyond.has(id));
  return { joint, links, bodies: links.flatMap((id) => mechanism.links[id]?.bodies ?? []), missing: links.flatMap((id) => mechanism.links[id]?.missing ?? []) };
}

// What a tool says beside its result when the answer is for a pose that moves a link: the joints
// whose value is not zero, with their values (rad or mm). Undefined while every link stands as
// modelled.
export interface PoseNote {
  pose: Record<Id, number>;
}
export function poseNote(mechanism: MechanismResult | undefined): PoseNote | undefined {
  if (!mechanism || Object.values(mechanism.links).every((own) => isIdentity(own.transform))) return undefined;
  return { pose: Object.fromEntries(Object.entries(mechanism.joints).flatMap(([id, j]): [Id, number][] => (j.value ? [[id, j.value]] : []))) };
}

// The text of a body that cannot be read in the pose: the joint, its fault, and the ways to it.
export function blockedText(mechanism: MechanismResult, body: Id, joint: Id): string {
  const result = has(mechanism.joints, joint) ? mechanism.joints[joint] : undefined;
  const fault = result?.error ? `${result.error.code}: ${result.error.message}` : 'it is in error';
  // the joint at zero moves nothing whatever its axis is, where its limits allow zero
  const atZero = result?.error?.code === 'brokenReference' && !((result.lower ?? 0) > 0) && !((result.upper ?? 0) < 0);
  return (
    `the pose of the body "${body}" is not known: the joint "${joint}" has no motion (${fault}). ` +
    (atZero ? `The bodies beyond it can be read with the joint at zero, which writes nothing: after: { "type": "setPose", "values": { "${joint}": 0 } }; or ` : 'The bodies beyond it can be read ') +
    `as modelled with geometry: 'modelled'`
  );
}

// The revolve feature (D58): a profile of a sketch turned about an axis in the plane of the sketch.
import type { NumberSpec } from '../catalog';
import { profile as resolveProfile } from '../recompute/profile';
import { applyTool, axis as axisOf, toolResult, withFaces } from '../recompute/services';
import type { BuiltTool, Done, Step, StepContext, ToolRecipe } from '../recompute/state';
import { buildRevolve, revolveSetup } from '../recompute/tool-revolve';
import type { Region } from '../sketch';
import { toWorld, transformFrame } from '../solid';
import type { Facts, RevolveFeature, Vec3 } from '../types';
import { has, sub3, unit3 } from '../util';
import { type Dict, type FeatureRef, type ValidationContext, axisRef, axisRefs, base, fail, object, oneOf, onlyFields, string } from '../validation';
import type { FeatureModule } from './module';
import { PROFILE_FIELD_SPECS, profileRefs, profileSource, removableFromProfile } from './profile';

const REVOLVE_START: NumberSpec = { title: 'Start angle', unit: 'rad' };
const REVOLVE_ANGLE: NumberSpec = { title: 'Angle', unit: 'rad', min: { value: -2 * Math.PI, open: true }, max: { value: 2 * Math.PI, open: true }, nonZero: true };

function revolveFeature(o: Dict, what: string, context: ValidationContext): RevolveFeature {
  const given = object(o.profile, `${what}.profile`);
  if (given.type === 'generated') fail(`${what}.profile: a revolve takes regions or a wall, not a generated profile`);
  const profile = profileSource(context, o.profile, `${what}.profile`) as RevolveFeature['profile'];
  const axis = axisRef(context, o.axis, `${what}.axis`);
  const extentGiven = object(o.extent, `${what}.extent`);
  const type = oneOf(extentGiven.type, ['full', 'angle'] as const, `${what}.extent.type`);
  let extent: RevolveFeature['extent'];
  if (type === 'full') {
    onlyFields(extentGiven, ['type'], `${what}.extent`, 'the extent full (a whole turn)');
    extent = { type };
  } else {
    onlyFields(extentGiven, ['type', 'start', 'angle'], `${what}.extent`, 'the extent angle');
    const start = context.fields.number(extentGiven.start, 'extent/start', REVOLVE_START, `${what}.extent.start`);
    extent = { type, start, angle: context.fields.number(extentGiven.angle, 'extent/angle', REVOLVE_ANGLE, `${what}.extent.angle`) };
  }
  const operation = oneOf(o.operation, ['new', 'add', 'cut'] as const, `${what}.operation`);
  const feature: RevolveFeature = { ...base(o, what), type: 'revolve', profile, axis, extent, operation };
  if (operation === 'new') {
    if (o.targets !== undefined) fail(`${what}.targets: a new body has no target`);
    return feature;
  }
  if (!Array.isArray(o.targets) || o.targets.length === 0 || (operation === 'add' && o.targets.length !== 1)) {
    return fail(`${what}.targets: operation ${operation} needs ${operation === 'add' ? 'exactly one target body' : 'at least one target body'}`);
  }
  const targets = (o.targets as unknown[]).map((target, i) => string(target, `${what}.targets[${i}]`));
  if (new Set(targets).size < targets.length) fail(`${what}.targets: a target body is listed twice`);
  for (const target of targets) context.requireRef({ id: target, kind: 'body' }, `${what}.targets`);
  return { ...feature, targets };
}

// The profile, the axis, the setup of the turn once, then the tool as an extrusion applies its own.
function step(feature: RevolveFeature, { state, settings, deps, done: finish, failed }: StepContext): Step {
  const profile = resolveProfile(feature.id, feature.profile, state, settings.chordTolerance);
  if ('code' in profile) return profile.message === undefined ? failed(profile.code, profile.refs) : { state: finish({ status: 'error', error: { code: profile.code, message: profile.message, refs: profile.refs }, warnings: [] }) };
  const line = axisOf(feature.axis, state);
  if ('code' in line) return failed(line.code, line.refs, line.detail);
  const setup = revolveSetup(profile, line, feature.axis, feature.extent, settings.chordTolerance);
  if ('code' in setup) return setup.message === undefined ? failed(setup.code, setup.refs, setup.detail) : { state: finish({ status: 'error', error: { code: setup.code, message: setup.message, refs: setup.refs }, warnings: [] }) };
  const { frame } = profile;
  const point = toWorld(frame, setup.axis.point[0], setup.axis.point[1]);
  const direction: Vec3 = unit3(sub3(toWorld(frame, setup.axis.point[0] + setup.axis.direction[0], setup.axis.point[1] + setup.axis.direction[1]), point));
  const facts: Facts = { axisPoint: point, axisDirection: direction, steps: setup.steps };
  const done: Done = (result, change) => {
    const warnings = [...(profile.warnings ?? []), ...result.warnings];
    return finish({ ...result, status: result.status === 'ok' && warnings.length ? 'warning' : result.status, warnings, facts }, change);
  };
  // The tool is the same for every target; a copy of a pattern is built in its own frame. The
  // planar triangulation of the caps is shared by all builds.
  const triangulation = new Map<Region, Uint32Array>();
  const build: ToolRecipe['build'] = (_targets, firstFaceId, placement) => {
    const placed = placement ? transformFrame(placement.transform, frame) : frame;
    const tool = buildRevolve(feature.id, setup, feature.extent, placed, profile.sideOf, firstFaceId, deps.kernel, triangulation);
    return placement ? { ...tool, faces: tool.faces.map((face) => ({ ...face, name: { ...face.name, copy: [placement.copy] } })) } : tool;
  };
  if (feature.operation !== 'new') {
    const recipe: ToolRecipe = { operation: feature.operation, targets: feature.targets ?? [], build };
    return toolResult(feature.id, recipe, applyTool(recipe, state, deps.kernel), state, done, failed);
  }
  const first = state.faceNames.length;
  let tool: BuiltTool;
  try {
    tool = build([], first);
  } catch (error) {
    return failed('kernelFailure', undefined, error instanceof Error ? error.message : String(error));
  }
  return { state: done({ status: 'ok', warnings: [], bodies: [feature.id] }, { ...withFaces(state, tool, first), bodies: { ...state.bodies, [feature.id]: tool.solid } }) };
}

export const revolve: FeatureModule<RevolveFeature> = {
  info: {
    title: 'Revolve',
    summary:
      'Turns a profile of a sketch (regions, optionally with an offset, or a wall along curves) about an axis that lies in the plane of the sketch: a new body, an addition to a body or a cut from bodies. ' +
      'The axis is an AxisRef: a base axis in the plane of the sketch (Z for a sketch on XZ or YZ), or a line of a sketch (`sketchLine`), best a construction line. The profile lies on one side of the axis and may touch it. ' +
      'The extent is a whole turn (`full`) or `angle` from `start` (radians, by the right-hand rule about the axis). ' +
      'The faces are named as for an extrusion of the same profile: `side` per curve (a line gives a plane across the axis, a cylinder or a cone; an arc a sphere when its centre is on the axis, a torus otherwise), `startCap` and `endCap` for a partial turn; a curve on the axis makes no face. ' +
      'The result tells in facts: `axisPoint`, `axisDirection` (the axis used) and `steps` (the turn is a polygon of that many sides).',
    fields: [
      ...PROFILE_FIELD_SPECS.filter((field) => !field.path.startsWith('profile/params/')),
      { path: 'extent/start', spec: REVOLVE_START, when: { path: 'extent/type', equals: 'angle' } },
      { path: 'extent/angle', spec: REVOLVE_ANGLE, when: { path: 'extent/type', equals: 'angle' } },
    ],
    bodies: 'self',
  },
  validate: revolveFeature,
  refs: (f) => [...profileRefs(f.profile), ...axisRefs(f.axis, 'axis'), ...(f.targets ?? []).map((id): FeatureRef => ({ path: 'targets', id, kind: 'body' }))],
  createsBody: (f, local) => local === undefined && f.operation === 'new',
  namesFaces: true,
  producesTool: (f) => f.operation !== 'new',
  patch: {
    fields: ['profile', 'axis', 'extent', 'operation', 'targets'],
    // a change to a new body drops the targets unless the change gives them
    normalize: (merged, patch) => {
      if (merged.operation === 'new' && !has(patch, 'targets')) delete merged.targets;
    },
    // a revolve has no taper and no gap: `null` may remove the targets and the offset only
    removable: (f, [field, ...rest]) => (field === 'targets' ? rest.length === 0 : field === 'profile' && removableFromProfile(f.profile, rest)),
  },
  step,
};

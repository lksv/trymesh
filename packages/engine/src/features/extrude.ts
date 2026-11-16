// The extrusion feature.
import { type EndPlane, toolSpan, upToSpan } from '../recompute/extent';
import { profile as resolveProfile } from '../recompute/profile';
import { applyTool, frame as frameOf, toolResult, withFaces } from '../recompute/services';
import { type BuiltTool, type Done, type Step, type StepContext, type ToolRecipe, ToolProblem } from '../recompute/state';
import { taperedSection, tapers } from '../recompute/taper';
import { buildPrism } from '../recompute/tool-prism';
import { type Section, buildStack } from '../recompute/tool-stack';
import type { Region } from '../sketch';
import { transformFrame } from '../solid';
import type { ExtrudeFeature, Facts } from '../types';
import { has } from '../util';
import { type Dict, type FeatureRef, type ValidationContext, base, fail, oneOf, string } from '../validation';
import { EXTENT_FIELD_SPECS, extentOf, extentRefs, removableFromExtent } from './extent';
import type { FeatureModule } from './module';
import { PROFILE_FIELD_SPECS, profileRefs, profileSource, removableFromProfile } from './profile';

function extrudeFeature(o: Dict, what: string, context: ValidationContext): ExtrudeFeature {
  const profile = profileSource(context, o.profile, `${what}.profile`);
  const operation = oneOf(o.operation, ['new', 'add', 'cut'] as const, `${what}.operation`);
  const extent = extentOf(context, o.extent, `${what}.extent`, { throughAll: operation === 'cut', upTo: true, noTaper: profile.type === 'generated' ? 'a generated profile has no curves to move, so it cannot taper' : undefined });
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
  for (const target of targets) context.requireRef({ id: target, kind: 'body' }, `${what}.targets`);
  return { ...feature, targets };
}

// Vysunutí má tři části: profil (odkud se bere tvar), nástroj (síť a nové stěny) a použití
// (nové těleso, nebo booleovská operace s cílem).
function step(feature: ExtrudeFeature, { state, settings, deps, done: finish, failed }: StepContext): Step {
  const profile = resolveProfile(feature.id, feature.profile, state, settings.chordTolerance);
  // a generator, an offset and a wall explain their failure themselves; the general text of the code is about sketch curves
  if ('code' in profile) return profile.message === undefined ? failed(profile.code, profile.refs) : { state: finish({ status: 'error', error: { code: profile.code, message: profile.message, refs: profile.refs }, warnings: [] }) };
  // An extent up to a plane: the plane is resolved here, in the state before the feature, and kept
  // for every build; the lengths of the feature's own tool are measured here, so a plane it cannot
  // reach is an error of the step. A copy of a pattern measures its own in `build`.
  const { extent: upTo } = feature;
  let endPlane: EndPlane | undefined;
  let lengths: Facts | undefined;
  if (upTo.type === 'upTo') {
    const resolved = frameOf(upTo.plane, state);
    if (typeof resolved === 'string') return failed(resolved, [upTo.plane]);
    endPlane = { point: resolved.origin, normal: resolved.normal };
    const measured = upToSpan(upTo, endPlane, profile.frame, profile.regions);
    if ('detail' in measured) return failed('invalidExtent', [upTo.plane], measured.detail);
    lengths = { lengthMin: measured.lengthMin, lengthMax: measured.lengthMax, forward: measured.forward };
  }
  // What the profile generator published and warned about belongs to the result whatever the
  // application of the tool ends with, short of an error; so do the lengths an extent up to
  // a plane gave.
  const facts = profile.facts || lengths ? { ...profile.facts, ...lengths } : undefined;
  const done: Done = (result, change) => {
    const warnings = [...(profile.warnings ?? []), ...result.warnings];
    return finish({ ...result, status: result.status === 'ok' && warnings.length ? 'warning' : result.status, warnings, ...(facts ? { facts } : {}) }, change);
  };
  // A taper that moves the far end by more than the length tolerance makes the tool a stack of
  // rings, computed here once: an outline that cannot be moved to the far end is an error of the
  // feature before any tool is built. Without such a taper the tool is the prism.
  const { extent } = feature;
  let section: Section | undefined;
  if (tapers(extent)) {
    const tapered = taperedSection(profile, extent, settings.chordTolerance, feature.profile.type === 'wall');
    if ('code' in tapered) return tapered.message === undefined ? failed(tapered.code, tapered.refs) : { state: finish({ status: 'error', error: { code: tapered.code, message: tapered.message, refs: tapered.refs }, warnings: [] }) };
    section = tapered;
  }
  // The tool: the length of "through all" is measured against the targets it is built for, and
  // a copy of a pattern is built in its own position. The planar triangulation is shared by all builds.
  const triangulation = new Map<Region, Uint32Array>();
  const build: ToolRecipe['build'] = (targets, firstFaceId, placement) => {
    const frame = placement ? transformFrame(placement.transform, profile.frame) : profile.frame;
    let span: ReturnType<typeof upToSpan> | ReturnType<typeof toolSpan>;
    if (feature.extent.type === 'upTo') {
      span = upToSpan(feature.extent, endPlane as EndPlane, frame, profile.regions);
      if ('detail' in span) throw new ToolProblem('invalidExtent', [feature.extent.plane], span.detail);
    } else span = toolSpan(feature.extent, frame, targets);
    const tool = section ? buildStack(feature.id, section, frame, firstFaceId, deps.kernel, triangulation) : buildPrism(feature.id, profile.regions, frame, 'span' in span ? span.span : span, profile.sideOf, firstFaceId, deps.kernel, triangulation);
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
    // the own span was measured above, so this is a guard, not a path a test reaches
    if (error instanceof ToolProblem) return failed(error.code, error.refs, error.detail);
    return failed('kernelFailure', undefined, error instanceof Error ? error.message : String(error));
  }
  return { state: done({ status: 'ok', warnings: [], bodies: [feature.id] }, { ...withFaces(state, tool, first), bodies: { ...state.bodies, [feature.id]: tool.solid } }) };
}

export const extrude: FeatureModule<ExtrudeFeature> = {
  info: {
    title: 'Vysunutí',
    summary:
      'Vysune profil ve směru normály roviny skici: nové těleso, přidání k tělesu, nebo odebrání z tělesa. A cut may have several target bodies and may go through all of them (extent throughAll). ' +
      'The profile is a set of regions of a sketch (optionally moved by an offset), a wall along curves of a sketch that close no region (a rib, a ring), or comes from a profile generator (see Profile generators). ' +
      'An extent of a distance may taper (extent/taper): the sides tilt by the angle, lines give tilted planes and arcs and circles cones. ' +
      'An extent upTo ends in a plane (a planar face, a plane feature or a base plane), tilted or not, on whichever side of the start it lies; the result tells the lengths in facts.',
    fields: [
      ...PROFILE_FIELD_SPECS,
      ...EXTENT_FIELD_SPECS,
    ],
    bodies: 'self',
  },
  validate: extrudeFeature,
  refs: (f) => [...profileRefs(f.profile), ...extentRefs(f.extent), ...(f.targets ?? []).map((id): FeatureRef => ({ path: 'targets', id, kind: 'body' }))],
  createsBody: (f, local) => local === undefined && f.operation === 'new',
  namesFaces: true,
  producesTool: (f) => f.operation !== 'new',
  generator: (f) => (f.profile.type === 'generated' ? f.profile.generator : undefined),
  patch: {
    fields: ['profile', 'extent', 'operation', 'targets'],
    // změna na nové těleso ruší cíle, pokud je změna sama neuvádí
    normalize: (merged, patch) => {
      if (merged.operation === 'new' && !has(patch, 'targets')) delete merged.targets;
    },
    // `null` for the taper is accepted also where the extent has none, or becomes "through all":
    // the patch asks for an extent without a taper, which it is
    removable: (f, [field, ...rest]) => (field === 'targets' ? rest.length === 0 : field === 'extent' ? removableFromExtent(rest) : field === 'profile' && removableFromProfile(f.profile, rest)),
  },
  step,
};

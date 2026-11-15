// The extrusion feature.
import { toolSpan } from '../recompute/extent';
import { profile as resolveProfile } from '../recompute/profile';
import { applyTool, issue, withFaces } from '../recompute/services';
import type { BuiltTool, Done, Step, StepContext, ToolRecipe } from '../recompute/state';
import { buildPrism } from '../recompute/tool-prism';
import type { Region } from '../sketch';
import { transformFrame } from '../solid';
import type { ExtrudeFeature } from '../types';
import { has } from '../util';
import { type Dict, type FeatureRef, type ValidationContext, base, fail, oneOf, string } from '../validation';
import { EXTENT_FIELD_SPECS, extentOf } from './extent';
import type { FeatureModule } from './module';
import { PROFILE_FIELD_SPECS, profileRefs, profileSource, removableFromProfile } from './profile';

function extrudeFeature(o: Dict, what: string, context: ValidationContext): ExtrudeFeature {
  const profile = profileSource(context, o.profile, `${what}.profile`);
  const operation = oneOf(o.operation, ['new', 'add', 'cut'] as const, `${what}.operation`);
  const extent = extentOf(context, o.extent, `${what}.extent`, { throughAll: operation === 'cut' });
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
  // What the profile generator published and warned about belongs to the result whatever the
  // application of the tool ends with, short of an error.
  const done: Done = (result, change) => {
    const warnings = [...(profile.warnings ?? []), ...result.warnings];
    return finish({ ...result, status: result.status === 'ok' && warnings.length ? 'warning' : result.status, warnings, ...(profile.facts ? { facts: profile.facts } : {}) }, change);
  };
  // The tool: the length of "through all" is measured against the targets it is built for, and
  // a copy of a pattern is built in its own position. The planar triangulation is shared by all builds.
  const triangulation = new Map<Region, Uint32Array>();
  const build: ToolRecipe['build'] = (targets, firstFaceId, placement) => {
    const frame = placement ? transformFrame(placement.transform, profile.frame) : profile.frame;
    const prism = buildPrism(feature.id, profile.regions, frame, toolSpan(feature.extent, frame, targets), profile.sideOf, firstFaceId, deps.kernel, triangulation);
    return placement ? { ...prism, faces: prism.faces.map((face) => ({ ...face, name: { ...face.name, copy: [placement.copy] } })) } : prism;
  };
  if (feature.operation !== 'new') {
    const recipe: ToolRecipe = { operation: feature.operation, targets: feature.targets ?? [], build };
    const applied = applyTool(recipe, state, deps.kernel);
    if (!applied.ok) return failed(applied.code, applied.refs, applied.detail);
    // The recipe is stored even when nothing changed: a copy in a pattern can hit what the original missed.
    const tools = { ...state.tools, [feature.id]: recipe };
    const { unchanged } = applied;
    if (unchanged.length === recipe.targets.length) return { state: done({ status: 'warning', warnings: [issue('noEffect', unchanged)] }, { tools }) };
    // Only some targets were missed: the general text would read as if nothing had happened.
    const warnings = unchanged.length ? [issue('noEffect', unchanged, 'only the targets in refs; the others were changed')] : [];
    return { state: done({ status: warnings.length ? 'warning' : 'ok', warnings }, { ...applied.model, tools }) };
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

export const extrude: FeatureModule<ExtrudeFeature> = {
  info: {
    title: 'Vysunutí',
    summary:
      'Vysune profil ve směru normály roviny skici: nové těleso, přidání k tělesu, nebo odebrání z tělesa. A cut may have several target bodies and may go through all of them (extent throughAll). ' +
      'The profile is a set of regions of a sketch (optionally moved by an offset), a wall along curves of a sketch that close no region (a rib, a ring), or comes from a profile generator (see Profile generators).',
    fields: [
      ...PROFILE_FIELD_SPECS,
      ...EXTENT_FIELD_SPECS,
    ],
    bodies: 'self',
  },
  validate: extrudeFeature,
  refs: (f) => [...profileRefs(f.profile), ...(f.targets ?? []).map((id): FeatureRef => ({ path: 'targets', id, kind: 'body' }))],
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
    removable: (f, [field, ...rest]) => (field === 'targets' ? rest.length === 0 : field === 'profile' && removableFromProfile(f.profile, rest)),
  },
  step,
};

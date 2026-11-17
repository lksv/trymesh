// The feature `combine` (D56): a boolean of finished bodies. The target is changed and keeps its
// ID; the tools are used up or kept; a difference may subtract every tool moved outwards by
// a clearance. The design is docs/d36/3d-body-boolean/design.md.
import type { NumberSpec } from '../catalog';
import { type BodyBoolean, booleanOfBodies } from '../recompute/body-boolean';
import { isMoveProblem, movedOutwards } from '../recompute/moved-body';
import { issue, lookup } from '../recompute/services';
import type { Step, StepContext } from '../recompute/state';
import type { FaceInfo } from '../solid';
import type { CombineFeature, FaceName, Id, Solid } from '../types';
import { faceKey, has } from '../util';
import { type Dict, type FeatureRef, type ValidationContext, base, boolean, fail, oneOf, string } from '../validation';
import type { FeatureModule } from './module';

// The default is what an absent field means (D44, "An optional numeric field"): no clearance.
export const CLEARANCE: NumberSpec = { title: 'Clearance', unit: 'mm', min: { value: 0 }, default: 0 };
const OPERATIONS = ['union', 'difference', 'intersection'] as const;

function combineFeature(o: Dict, what: string, context: ValidationContext): CombineFeature {
  const operation = oneOf(o.operation, OPERATIONS, `${what}.operation`);
  const target = string(o.target, `${what}.target`);
  context.requireRef({ id: target, kind: 'body' }, `${what}.target`);
  if (!Array.isArray(o.tools) || o.tools.length === 0) return fail(`${what}.tools: a non-empty list of body IDs is expected`);
  const tools = (o.tools as unknown[]).map((tool, i) => string(tool, `${what}.tools[${i}]`));
  if (new Set(tools).size < tools.length) fail(`${what}.tools: a tool body is listed twice`);
  if (tools.includes(target)) fail(`${what}.tools: the target "${target}" is not its own tool`);
  tools.forEach((tool, i) => context.requireRef({ id: tool, kind: 'body' }, `${what}.tools[${i}]`));
  if (o.keepTools === undefined) fail(`${what}.keepTools: say whether the tool bodies stay (true) or leave the model (false); there is no default`);
  const feature: CombineFeature = { ...base(o, what), type: 'combine', operation, target, tools, keepTools: boolean(o.keepTools, `${what}.keepTools`) };
  if (o.clearance === undefined) return feature;
  if (operation !== 'difference') fail(`${what}.clearance: only a difference has a clearance`);
  return { ...feature, clearance: context.fields.number(o.clearance, 'clearance', CLEARANCE, `${what}.clearance`) };
}

// The boolean with one tool after another. With a clearance above 0 every tool is moved outwards
// first; its moved faces get the next free numbers and the names of the tool's faces with the copy
// tag of this feature, and enter the face table when the tool changed the target.
function step(feature: CombineFeature, { state, settings, deps, done, failed }: StepContext): Step {
  const missing = [feature.target, ...feature.tools].filter((id) => !lookup(state.bodies, id));
  if (missing.length) return failed('brokenReference', missing);
  const clearance = feature.operation === 'difference' ? (feature.clearance ?? 0) : 0;
  const faceNames: FaceName[] = [...state.faceNames];
  const faceInfos: FaceInfo[] = [...state.faceInfos];
  const faceIds = new Map(state.faceIds);
  let current = state.bodies[feature.target];
  const idle: Id[] = [];
  for (const [i, id] of feature.tools.entries()) {
    let tool: Solid = state.bodies[id];
    let added: { name: FaceName; info: FaceInfo }[] = [];
    if (clearance > 0) {
      const moved = movedOutwards(tool, state.faceInfos, state.faceNames, clearance, settings.chordTolerance, deps.kernel);
      if (isMoveProblem(moved)) return failed('invalidClearance', [id, ...moved.faces], moved.detail);
      const faces = [...new Set(moved.solid.faceIds)].sort((a, b) => a - b);
      const number = new Map(faces.map((face, k) => [face, faceNames.length + k]));
      added = faces.map((face) => ({ name: { ...state.faceNames[face], copy: [...(state.faceNames[face].copy ?? []), { pattern: feature.id, index: i + 1 }] }, info: moved.infos.get(face) as FaceInfo }));
      tool = { ...moved.solid, faceIds: moved.solid.faceIds.map((face) => number.get(face) as number) };
    }
    let result: BodyBoolean;
    try {
      result = booleanOfBodies(deps.kernel, feature.operation, current, tool, faceNames.length + added.length, settings.chordTolerance);
    } catch (error) {
      return failed('kernelFailure', [id], error instanceof Error ? error.message : String(error));
    }
    if (result.solid.triangles.length === 0) return failed('emptyResult', [feature.target, id]);
    if (!result.changed) {
      idle.push(id);
      continue;
    }
    current = result.solid;
    for (const face of added) {
      faceIds.set(faceKey(face.name), faceNames.length);
      faceNames.push(face.name);
      faceInfos.push(face.info);
    }
  }
  const bodies = { ...state.bodies, [feature.target]: current };
  if (!feature.keepTools) for (const id of feature.tools) delete bodies[id];
  const warnings = idle.length ? [issue('noEffect', idle, idle.length < feature.tools.length ? 'only the tools in refs; the others changed the target' : undefined)] : [];
  return { state: done({ status: warnings.length ? 'warning' : 'ok', warnings }, { bodies, faceNames, faceInfos, faceIds }) };
}

export const combine: FeatureModule<CombineFeature> = {
  info: {
    title: 'Combine',
    summary:
      'A boolean of finished bodies: the target is joined with the tools (`union`), has them subtracted (`difference`) or keeps what it shares with them (`intersection`), one tool after another. The target keeps its ID; with `keepTools: false` the tool bodies leave the model (there is no default). ' +
      'A difference may have a `clearance`: every tool is subtracted moved outwards by that much on every face (a pocket for a motor or a board shaped by the part itself); the faces of the pocket are then the faces of the tool with a copy tag of this feature.',
    fields: [{ path: 'clearance', spec: CLEARANCE, when: { path: 'operation', equals: 'difference' } }],
    bodies: 'none',
  },
  validate: combineFeature,
  refs: (f) => [{ path: 'target', id: f.target, kind: 'body' }, ...f.tools.map((id): FeatureRef => ({ path: 'tools', id, kind: 'body' }))],
  createsBody: () => false,
  namesFaces: false,
  producesTool: () => false,
  // A difference tags the faces its tools leave when it has a clearance; whether it has one above 0
  // is a matter of the recompute (a tag that names no face is a broken reference there).
  tagsFaces: (f) => f.operation === 'difference',
  patch: {
    fields: ['operation', 'target', 'tools', 'keepTools', 'clearance'],
    // a patch to another operation removes the clearance, as a patch to `new` removes the targets of an extrusion
    normalize: (merged, patch) => {
      if (merged.operation !== 'difference' && !has(patch, 'clearance')) delete merged.clearance;
    },
    removable: (_f, path) => path.length === 1 && path[0] === 'clearance',
  },
  step,
};

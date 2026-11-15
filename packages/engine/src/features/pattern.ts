// The pattern feature: repeats the tools of earlier features, or a finished body, in the transforms
// of its copies.
import type { NumberSpec } from '../catalog';
import { applyTool, axis, issue, lookup } from '../recompute/services';
import type { Model, Placement, State, Step, StepContext } from '../recompute/state';
import { type RigidTransform, rotation, transformFace, transformSolid } from '../solid';
import type { FaceName, Id, IssueCode, PatternFeature } from '../types';
import { faceKey } from '../util';
import { type Dict, type FeatureRef, type ValidationContext, axisRef, axisRefs, base, fail, object, oneOf, onlyFields, string } from '../validation';
import type { FeatureModule } from './module';

// The count of a pattern includes the original. The upper bound keeps a typo in an expression from
// starting thousands of booleans.
export const MAX_PATTERN_COUNT = 200;
const PATTERN_COUNT: NumberSpec = { title: 'Count', unit: 'count', integer: true, min: { value: 1 }, max: { value: MAX_PATTERN_COUNT } };
const PATTERN_ANGLE: NumberSpec = { title: 'Angle', unit: 'rad', min: { value: -2 * Math.PI }, max: { value: 2 * Math.PI }, nonZero: true };

function patternFeature(o: Dict, what: string, context: ValidationContext): PatternFeature {
  const { fields } = context;
  const given = object(o.source, `${what}.source`);
  let source: PatternFeature['source'];
  const sourceType = oneOf(given.type, ['features', 'body'] as const, `${what}.source.type`);
  onlyFields(given, ['type', sourceType === 'features' ? 'features' : 'body'], `${what}.source`, `a source of the type ${sourceType}`);
  if (sourceType === 'features') {
    if (!Array.isArray(given.features) || given.features.length === 0) return fail(`${what}.source.features: a non-empty list of feature IDs is expected`);
    const features = (given.features as unknown[]).map((id, i) => string(id, `${what}.source.features[${i}]`));
    if (new Set(features).size < features.length) fail(`${what}.source.features: a feature is listed twice`);
    for (const id of features) context.requireRef({ id, kind: 'tool' }, `${what}.source.features`);
    source = { type: 'features', features };
  } else {
    const body = string(given.body, `${what}.source.body`);
    context.requireRef({ id: body, kind: 'body' }, `${what}.source.body`);
    source = { type: 'body', body };
  }
  const transform = object(o.transform, `${what}.transform`);
  const type = oneOf(transform.type, ['circular'] as const, `${what}.transform.type`);
  onlyFields(transform, ['type', 'axis', 'count', 'span'], `${what}.transform`, `a transform of the type ${type}`);
  const axis = axisRef(context, transform.axis, `${what}.transform.axis`);
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

// A pattern: the transforms of its copies, then either the tools of the source features applied
// in each of them, or the source body copied into each of them. The rest of the step does not
// know what kind of transform it is.
function step(feature: PatternFeature, { state, deps, done, failed }: StepContext): Step {
  const transforms = transformsOf(feature.transform, state);
  if ('code' in transforms) return failed(transforms.code, transforms.refs);
  const placements = transforms.map((transform, i): Placement => ({ transform, copy: { pattern: feature.id, index: i + 1 } }));
  const { source } = feature;

  if (source.type === 'body') {
    const solid = lookup(state.bodies, source.body);
    if (!solid) return failed('brokenReference', [source.body]);
    // Every face the body has at this moment (faces of several features, of earlier patterns too)
    // gets a new number for each copy, with the copy tag appended to its name and its description
    // moved with the copy.
    const faces = [...new Set(solid.faceIds)].sort((a, b) => a - b);
    const model: Model = { bodies: { ...state.bodies }, faceNames: [...state.faceNames], faceInfos: [...state.faceInfos], faceIds: new Map(state.faceIds) };
    const created: Id[] = [];
    for (const { transform, copy } of placements) {
      const renumbered = new Map<number, number>();
      for (const face of faces) {
        const name: FaceName = { ...state.faceNames[face], copy: [...(state.faceNames[face].copy ?? []), copy] };
        renumbered.set(face, model.faceNames.length);
        model.faceIds.set(faceKey(name), model.faceNames.length);
        model.faceNames.push(name);
        model.faceInfos.push(transformFace(transform, state.faceInfos[face]));
      }
      const id = `${feature.id}/${copy.index}`;
      model.bodies[id] = transformSolid(transform, solid, (face) => renumbered.get(face) as number);
      created.push(id);
    }
    return { state: done({ status: 'ok', warnings: [], bodies: created }, model) };
  }

  // Features: a source that is missing, suppressed or in error has no recipe. A source that ended
  // with `noEffect` has one, because a turned copy can hit what the original missed.
  const missing = source.features.filter((id) => !lookup(state.tools, id));
  if (missing.length) return failed('brokenReference', missing);
  let model: Model = state;
  const idle: { copy: number; feature: Id; targets: Id[] }[] = [];
  for (const placement of placements) {
    for (const id of source.features) {
      const applied = applyTool(state.tools[id], model, deps.kernel, placement);
      // The pattern is atomic: one failed copy and the model stays as it was before the pattern.
      // The copy is named by the first of `refs`, not in the text: a client names it its own way.
      if (!applied.ok) return failed(applied.code, [{ copy: placement.copy.index, feature: id }, ...(applied.refs ?? [])], applied.detail);
      if (applied.unchanged.length) idle.push({ copy: placement.copy.index, feature: id, targets: applied.unchanged });
      model = applied.model;
    }
  }
  const warnings = idle.length ? [issue('noEffect', idle, 'some copies changed none or only some of their targets')] : [];
  return { state: done({ status: warnings.length ? 'warning' : 'ok', warnings }, model) };
}

// The transforms of the copies of a pattern, the original excluded: copy 1 first.
function transformsOf(transform: PatternFeature['transform'], state: State): RigidTransform[] | { code: IssueCode; refs: unknown[] } {
  const { count, span } = transform;
  const line = axis(transform.axis, state);
  if ('code' in line) return line;
  const { point, direction } = line;
  // full circle: the copies divide it evenly; an angle: it lies between the first and the last copy
  const step = span.type === 'full' ? (2 * Math.PI) / count : count > 1 ? span.angle / (count - 1) : 0;
  return Array.from({ length: count - 1 }, (_, i) => rotation(point, direction, step * (i + 1)));
}

export const pattern: FeatureModule<PatternFeature> = {
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
  producesTool: () => false,
  patch: { fields: ['source', 'transform'] },
  step,
};

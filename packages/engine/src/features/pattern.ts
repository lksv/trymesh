// The pattern feature: repeats the tools of earlier features, or a finished body, in the transforms
// of its copies: turned around an axis, shifted along a direction, or mirrored in a plane (D53).
import type { NumberSpec } from '../catalog';
import { applyTool, axis, frame, issue, lookup } from '../recompute/services';
import type { Model, Placement, State, Step, StepContext } from '../recompute/state';
import { type RigidTransform, reflection, rotation, shift, transformFace, transformSolid } from '../solid';
import type { FaceName, Id, IssueCode, PatternFeature, PatternTransform } from '../types';
import { faceKey } from '../util';
import { type Dict, type FeatureRef, type ValidationContext, axisRef, axisRefs, base, fail, object, oneOf, onlyFields, planeRef, planeRefs, string } from '../validation';
import type { FeatureModule } from './module';

// The count of a pattern includes the original. The upper bound keeps a typo in an expression from
// starting thousands of booleans.
export const MAX_PATTERN_COUNT = 200;
const PATTERN_COUNT: NumberSpec = { title: 'Count', unit: 'count', integer: true, min: { value: 1 }, max: { value: MAX_PATTERN_COUNT } };
const PATTERN_ANGLE: NumberSpec = { title: 'Angle', unit: 'rad', min: { value: -2 * Math.PI }, max: { value: 2 * Math.PI }, nonZero: true };
// The spans of a linear pattern: no bound of their own (the general bound of a document number
// holds); negative runs against the direction.
const PATTERN_SPACING: NumberSpec = { title: 'Spacing', unit: 'mm', nonZero: true };
const PATTERN_LENGTH: NumberSpec = { title: 'Length', unit: 'mm', nonZero: true };

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
  return { ...base(o, what), type: 'pattern', source, transform: patternTransform(object(o.transform, `${what}.transform`), `${what}.transform`, context) };
}

// The transform by its kind; every kind lists its fields, so a field of another kind is refused.
function patternTransform(transform: Dict, what: string, context: ValidationContext): PatternTransform {
  const { fields } = context;
  const type = oneOf(transform.type, ['circular', 'linear', 'mirror'] as const, `${what}.type`);
  const owner = `a transform of the type ${type}`;
  if (type === 'mirror') {
    onlyFields(transform, ['type', 'plane'], what, owner);
    return { type, plane: planeRef(context, transform.plane, `${what}.plane`) };
  }
  if (type === 'linear') {
    onlyFields(transform, ['type', 'direction', 'count', 'span'], what, owner);
    const direction = axisRef(context, transform.direction, `${what}.direction`);
    const count = fields.number(transform.count, 'transform/count', PATTERN_COUNT, `${what}.count`);
    const span = object(transform.span, `${what}.span`);
    const kind = oneOf(span.type, ['spacing', 'length'] as const, `${what}.span.type`);
    onlyFields(span, ['type', kind], `${what}.span`, `a span of the type ${kind}`);
    return {
      type,
      direction,
      count,
      span:
        kind === 'spacing'
          ? { type: kind, spacing: fields.number(span.spacing, 'transform/span/spacing', PATTERN_SPACING, `${what}.span.spacing`) }
          : { type: kind, length: fields.number(span.length, 'transform/span/length', PATTERN_LENGTH, `${what}.span.length`) },
    };
  }
  onlyFields(transform, ['type', 'axis', 'count', 'span'], what, owner);
  const axis = axisRef(context, transform.axis, `${what}.axis`);
  const count = fields.number(transform.count, 'transform/count', PATTERN_COUNT, `${what}.count`);
  const span = object(transform.span, `${what}.span`);
  const full = oneOf(span.type, ['full', 'angle'] as const, `${what}.span.type`) === 'full';
  onlyFields(span, full ? ['type'] : ['type', 'angle'], `${what}.span`, `a span of the type ${full ? 'full' : 'angle'}`);
  return { type, axis, count, span: full ? { type: 'full' } : { type: 'angle', angle: fields.number(span.angle, 'transform/span/angle', PATTERN_ANGLE, `${what}.span.angle`) } };
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
function transformsOf(transform: PatternTransform, state: State): RigidTransform[] | { code: IssueCode; refs: unknown[] } {
  if (transform.type === 'mirror') {
    // the plane is resolved as the plane of a sketch is; its error is the error of the pattern
    const plane = frame(transform.plane, state);
    if (typeof plane === 'string') return { code: plane, refs: [transform.plane] };
    return [reflection(plane.origin, plane.normal)];
  }
  if (transform.type === 'linear') {
    const { count, span } = transform;
    const line = axis(transform.direction, state);
    if ('code' in line) return line;
    // only the direction of the axis is used; a length lies between the original and the last copy
    const step = span.type === 'spacing' ? span.spacing : count > 1 ? span.length / (count - 1) : 0;
    return Array.from({ length: count - 1 }, (_, i) => shift(line.direction, step * (i + 1)));
  }
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
      'Repeats its source: a list of features that apply a tool: extrusions with the operation add or cut, holes (each copy of their tools is built again in its place and applied to the targets of the feature it comes from), or a finished body (the copies are new bodies `<pattern>/<number>`, numbered from 1). ' +
      'Three kinds of `transform`: `circular` turns the copies around an axis, over the full circle (`span: { type: "full" }`) or within an angle between the first and the last copy; `linear` shifts them along the direction of an axis by a `spacing` between neighbours or over a `length` between the original and the last copy; `mirror` makes one copy, number 1, the mirror image in a plane. The count includes the original.',
    // the count once per kind that has one: a condition names one value
    fields: [
      { path: 'transform/count', spec: PATTERN_COUNT, when: { path: 'transform/type', equals: 'circular' } },
      { path: 'transform/span/angle', spec: PATTERN_ANGLE, when: { path: 'transform/span/type', equals: 'angle' } },
      { path: 'transform/count', spec: PATTERN_COUNT, when: { path: 'transform/type', equals: 'linear' } },
      { path: 'transform/span/spacing', spec: PATTERN_SPACING, when: { path: 'transform/span/type', equals: 'spacing' } },
      { path: 'transform/span/length', spec: PATTERN_LENGTH, when: { path: 'transform/span/type', equals: 'length' } },
    ],
    bodies: 'derived',
  },
  validate: patternFeature,
  refs: (f) => [
    ...(f.source.type === 'features' ? f.source.features.map((id): FeatureRef => ({ path: 'source/features', id, kind: 'tool' })) : [{ path: 'source/body', id: f.source.body, kind: 'body' } as FeatureRef]),
    ...(f.transform.type === 'mirror' ? planeRefs(f.transform.plane, 'transform/plane') : f.transform.type === 'linear' ? axisRefs(f.transform.direction, 'transform/direction') : axisRefs(f.transform.axis, 'transform/axis')),
  ],
  // Copies are numbered from 1. Whether the copy with that number exists shows in the recompute:
  // the count may be an expression. A mirror has the one copy 1, which the document tells.
  createsBody: (f, local) => f.source.type === 'body' && local !== undefined && (f.transform.type === 'mirror' ? local === '1' : /^[1-9][0-9]*$/.test(local)),
  // a copy takes after the body it was copied from (body properties, D48)
  bodySource: (f) => (f.source.type === 'body' ? f.source.body : undefined),
  namesFaces: false,
  producesTool: () => false,
  patch: { fields: ['source', 'transform'] },
  step,
};

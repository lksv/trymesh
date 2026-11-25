// The sketch feature: the validators of the feature and of its content (which the sketch commands in
// document.ts call as well) and the step that projects, solves and analyses it.
import { SketchAnalysis } from '../analysis';
import { CONSTRAINTS, type EntityKind } from '../catalog';
import { type ResolvedReference, copyInConstraint, derivedOrigin, entityOf, externalRef, kindOf, resolveReferences, storedValue } from '../references/index';
import { frame as frameOf, issue } from '../recompute/services';
import type { SolvedSketch, Step, StepContext } from '../recompute/state';
import { entryOrder } from '../references/derive';
import type { DerivedGeometry } from '../references/spec';
import { sketchWorld, stepBase } from '../references/world';
import { type SketchGeometry, measure, ownVariables, profileOf, solverSetup } from '../sketch';
import { MAX_SPLINE_POINTS, MIN_SPLINE_POINTS } from '../spline';
import { AXES_GEOMETRY, CURVE_KINDS, CURVE_POINTS, constraintOperands, constraintPath, curvePoints, emptySketch, isDriving } from '../sketch-content';
import type { Constraint, Curve, FeatureResult, Id, Issue, ResultCurve, SketchFeature, SolveInput, SolveResult, StoredValue } from '../types';
import { ORIGIN, has, isOriginAxis, unreachable } from '../util';
import { type Dict, type Fields, type ValidationContext, boolean, fail, finite, newId, object, oneOf, plain, planeRef, planeRefs, string } from '../validation';
import type { FeatureModule } from './module';

// The texts of the refusals of a spline (D70); `what` is the path of the curve.
export const SPLINE_REFUSALS = {
  count: (what: string, n: number): string => `${what}.points: a spline has ${MIN_SPLINE_POINTS} to ${MAX_SPLINE_POINTS} control points, not ${n}`,
  repeated: (what: string, point: Id): string => `${what}.points: "${point}" is listed twice; only the first point may come again, as the last, closing the spline`,
  closedTooShort: (what: string): string => `${what}.points: a closed spline needs at least three different points`,
};
// The refusal of `setCurvePoint` for a spline (D52, D70).
export const SET_CURVE_POINT_SPLINE = (id: Id): string => `setCurvePoint.id: "${id}" is a spline, which has no named points; to change its control points, remove it and add it again under its ID in one batch`;

// A curve may refer only to the sketch's own points and to the origin.
export function curve(sketch: SketchFeature, v: unknown, what: string): Curve {
  const o = object(v, what);
  const type = oneOf(o.type, CURVE_KINDS, `${what}.type`);
  const pointAt = (v: unknown, path: string): Id => {
    const id = string(v, path);
    if (id !== ORIGIN && !has(sketch.points, id)) fail(`${path}: "${id}" is neither an own point of the sketch nor the origin`);
    return id;
  };
  const point = (field: string): Id => pointAt(o[field], `${what}.${field}`);
  const construction = o.construction === undefined ? {} : { construction: boolean(o.construction, `${what}.construction`) };
  switch (type) {
    case 'line': {
      const [a, b] = [point('a'), point('b')];
      if (a === b) fail(`${what}: a line needs two different points`);
      return { ...construction, type, a, b };
    }
    case 'circle':
      return { ...construction, type, center: point('center') };
    case 'arc': {
      const [center, start, end] = [point('center'), point('start'), point('end')];
      if (center === start || center === end || start === end) fail(`${what}: an arc needs three different points`);
      return { ...construction, type, center, start, end };
    }
    case 'spline': {
      if (!Array.isArray(o.points)) return fail(`${what}.points: an array of point IDs is expected`);
      const n = o.points.length;
      if (n < MIN_SPLINE_POINTS || n > MAX_SPLINE_POINTS) fail(SPLINE_REFUSALS.count(what, n));
      const points = o.points.map((v, i) => pointAt(v, `${what}.points[${i}]`));
      const closed = points[0] === points[n - 1];
      points.forEach((id, i) => {
        if (points.indexOf(id) !== i && !(i === n - 1 && closed)) fail(SPLINE_REFUSALS.repeated(what, id));
      });
      if (closed && n < 4) fail(SPLINE_REFUSALS.closedTooShort(what));
      return { ...construction, type, points };
    }
    default:
      return unreachable(type, `${what}.type`);
  }
}

// The own rule of a constraint in the catalog (`check` of CONSTRAINTS), which reads the points of
// the curves it names: `constraint` asks it when a constraint is validated, and the command
// setCurvePoint asks it again for every constraint on the curve it changes (D52).
// The points of a curve of an entry are the point entities under `<curve>/` by the names a curve
// can have (`a`, `b`, `center`, `start`, `end`), asked of `entityOf` one by one, for every kind (an
// edge `e/a`, a curve of an outline `o/l1/a`, D72) and never by a listing of the entry; the point of
// an axis of the origin is `origin` (its far point is no entity, D71).
const POINT_NAMES = [...new Set(Object.values(CURVE_POINTS).flat())];
function ruleProblem(sketch: SketchFeature, type: Constraint['type'], operands: Id[], kinds: EntityKind[]): string | undefined {
  const entryPoints = (id: Id): Id[] => POINT_NAMES.map((name) => `${id}/${name}`).filter((point) => entityOf(sketch, point)?.kind === 'point');
  const pointsOf = (id: Id): Id[] => (has(sketch.curves, id) ? curvePoints(sketch.curves[id]) : isOriginAxis(id) ? [ORIGIN] : entityOf(sketch, id) ? entryPoints(id) : []);
  return CONSTRAINTS[type].check?.(kinds, operands, pointsOf);
}
export function constraintRuleProblem(sketch: SketchFeature, c: Constraint): string | undefined {
  const operands = constraintOperands(c);
  return ruleProblem(sketch, c.type, operands, operands.map((id) => entityOf(sketch, id)?.kind as EntityKind));
}

// A constraint by the catalog: the operands exist, have the right kind and differ from each other,
// the value meets the sign convention and the solver can move at least one operand (the solver
// silently ignores a driving constraint between fixed entities only).
export function constraint(sketch: SketchFeature, v: unknown, what: string, fields: Fields, id: Id): Constraint {
  const o = object(v, what);
  const type = string(o.type, `${what}.type`);
  if (!has(CONSTRAINTS, type)) return fail(`${what}.type: unknown constraint "${type}"`);
  const spec = CONSTRAINTS[type as Constraint['type']];
  const operands: Record<string, Id> = {};
  const kinds: EntityKind[] = [];
  for (const { field, kinds: accepted } of spec.operands) {
    const id = string(o[field], `${what}.${field}`);
    const entity = entityOf(sketch, id);
    if (!entity) return fail(`${what}.${field}: the entity "${id}" is not in the sketch`);
    if (entity.derived) {
      const origin = derivedOrigin(sketch, id) as { entry: Id; source: Id };
      return fail(`${what}.${field}: ${copyInConstraint(id, origin.entry, origin.source)}`);
    }
    if (!accepted.includes(entity.kind)) fail(`${what}.${field}: "${id}" is ${/^[aeiou]/.test(entity.kind) ? 'an' : 'a'} ${entity.kind}, expected ${accepted.join(' or ')}`);
    operands[field] = id;
    kinds.push(entity.kind);
  }
  if (new Set(Object.values(operands)).size < spec.operands.length) fail(`${what}: the constraint needs ${spec.operands.length === 2 ? 'two' : spec.operands.length} different entities`);
  const problem = ruleProblem(sketch, type as Constraint['type'], Object.values(operands), kinds);
  if (problem) fail(`${what}: ${problem}`);
  const movable = Object.values(operands).some((operand) => entityOf(sketch, operand)?.own);
  const onlyFixed = (): never => fail(`${what}: a constraint only between fixed entities (the origin, its axes origin/x and origin/y, projected geometry) would never take effect`);
  // said before the values are read: a fixed point on the origin has no coordinates to complain about
  if (!spec.dimension && !movable) onlyFixed();
  let values: Record<string, number | boolean> = {};
  if (spec.dimension && spec.values) {
    // A driving dimension is a numeric field and may have an expression; a reference one only measures.
    const driving = boolean(o.driving, `${what}.driving`);
    if (!driving && typeof o.value === 'string') fail(`${what}.value: a reference dimension cannot have an expression`);
    const value = driving ? fields.number(o.value, constraintPath(id), spec.values.value, `${what}.value`) : plain(finite(o.value, `${what}.value`), spec.values.value, `${what}.value`);
    values = { value, driving };
  } else if (spec.values) {
    // values of a constraint that is not a dimension (the coordinates of a fixed point): numeric fields
    for (const [name, number] of Object.entries(spec.values)) values[name] = fields.number(o[name], constraintPath(id, name), number, `${what}.${name}`);
  }
  const result = { type, ...operands, ...values } as Constraint;
  if (isDriving(result) && !movable) onlyFixed();
  return result;
}

function sketchFeature(o: Dict, what: string, context: ValidationContext): SketchFeature {
  const { fields } = context;
  const sketch = emptySketch(newId(o.id, `${what}.id`), string(o.name, `${what}.name`), planeRef(context, o.plane, `${what}.plane`));
  sketch.suppressed = boolean(o.suppressed, `${what}.suppressed`);
  const seen = new Set<Id>();
  const entries = (v: unknown, name: string): [Id, unknown][] =>
    Object.entries(object(v, `${what}.${name}`)).map(([key, value]) => {
      const id = newId(key, `${what}.${name}`);
      if (seen.has(id)) fail(`${what}.${name}: the ID "${id}" is in the sketch twice`);
      seen.add(id);
      return [id, value];
    });
  for (const [id, value] of entries(o.points, 'points')) {
    const p = object(value, `${what}.points.${id}`);
    sketch.points[id] = { x: finite(p.x, `${what}.points.${id}.x`), y: finite(p.y, `${what}.points.${id}.y`) };
  }
  for (const [id, value] of entries(o.external, 'external')) sketch.external[id] = externalRef(context, sketch, id, value, `${what}.external.${id}`);
  for (const [id, value] of entries(o.curves, 'curves')) sketch.curves[id] = curve(sketch, value, `${what}.curves.${id}`);
  for (const [id, value] of Object.entries(object(o.radii, `${what}.radii`))) {
    if (!has(sketch.curves, id) || sketch.curves[id].type !== 'circle') fail(`${what}.radii: "${id}" is not a circle`);
    sketch.radii[id] = finite(value, `${what}.radii.${id}`);
    if (sketch.radii[id] <= 0) fail(`${what}.radii.${id}: the radius must be positive`);
  }
  for (const [id, c] of Object.entries(sketch.curves)) if (c.type === 'circle' && !has(sketch.radii, id)) fail(`${what}.radii: the circle "${id}" has no radius`);
  for (const [id, value] of entries(o.constraints, 'constraints')) sketch.constraints[id] = constraint(sketch, value, `${what}.constraints.${id}`, fields, id);
  const solved = object(o.solved, `${what}.solved`);
  sketch.solved.inputs = string(solved.inputs, `${what}.solved.inputs`);
  for (const [id, value] of Object.entries(object(solved.external, `${what}.solved.external`))) {
    // the form of the value first, then whether it fits its entry
    const stored = storedValue(value, `${what}.solved.external.${id}`);
    // a value is stored for an entry of reference geometry only: derived geometry is never stored
    const kind = has(sketch.external, id) ? kindOf(sketch.external[id]) : undefined;
    if (kind?.source !== 'reference' || kind.value(stored, sketch.external[id], `${what}.solved.external.${id}`) === undefined) fail(`${what}.solved.external: "${id}" does not match the projected geometry of the sketch`);
    sketch.solved.external[id] = stored;
  }
  return sketch;
}

// The curves of the result that are not own, in the order of the entries (`entryOrder`) and within
// an entry in the order of its kind: those of an entry of reference geometry from the resolved
// references, those of an entry of derived geometry from the stage after the solver (D68), with
// the regions the occupation pass left them.
function resultCurves(feature: SketchFeature, resolved: Record<Id, ResolvedReference>, derived: DerivedGeometry): Record<Id, ResultCurve> {
  const out: Record<Id, ResultCurve> = {};
  for (const id of entryOrder(feature)) {
    const source = kindOf(feature.external[id]).source;
    const geometry = source === 'reference' ? resolved[id]?.geometry : derived.entries[id];
    if (geometry) for (const [curve, shape] of Object.entries(geometry.curves)) out[curve] = { shape, source, regions: geometry.regions.includes(curve) };
  }
  return out;
}

// The geometry after the solver with the points and the radii of every entry whose solver input
// was narrowed (D72): the solver returns only what it got, and a circle of an outline that no
// constraint names has no radius without it. In one order whatever is named: the geometry of the
// solve without those entries' points first, then the entries by ID.
function withEntries(geometry: SketchGeometry, resolved: Record<Id, ResolvedReference>): SketchGeometry {
  const narrowed = Object.keys(resolved)
    .filter((id) => resolved[id].solver)
    .sort();
  if (narrowed.length === 0) return geometry;
  const theirs = new Set(narrowed.flatMap((id) => [...Object.keys(resolved[id].geometry.points), ...Object.keys(resolved[id].geometry.radii)]));
  const points = Object.fromEntries(Object.entries(geometry.points).filter(([id]) => !theirs.has(id)));
  const radii = Object.fromEntries(Object.entries(geometry.radii).filter(([id]) => !theirs.has(id)));
  for (const id of narrowed) {
    Object.assign(points, resolved[id].geometry.points);
    Object.assign(radii, resolved[id].geometry.radii);
  }
  return { points, radii };
}

function step(feature: SketchFeature, { state, settings, deps, done, failed, drag, badFields }: StepContext): Step {
  const frame = frameOf(feature.plane, state);
  if (typeof frame === 'string') return failed(frame, [feature.plane]);
  const warnings: Issue[] = badFields.length ? [issue('invalidExpression', badFields, 'the field keeps its last valid value')] : [];

  // 1. the reference geometry from the state before the sketch (the registry of kinds); an entry
  // that cannot be computed keeps its last valid value
  const { resolved, lost } = resolveReferences(feature, { state, frame });
  const external: Record<Id, StoredValue> = {};
  for (const [id, reference] of Object.entries(resolved)) if (reference.value) external[id] = reference.value;
  const setup = solverSetup(feature, resolved);
  for (const [id, code, detail] of lost) {
    const skipped = setup.skipped.filter((c) => constraintOperands(feature.constraints[c]).some((operand) => operand === id || operand.startsWith(`${id}/`)));
    // the detail of the kind (D69), then what was left out of the solve
    const said = [detail, skipped.length ? 'the constraints on it were left out of the solve' : undefined].filter((text) => text !== undefined).join('; ');
    warnings.push(issue(code, [id, ...skipped], said || undefined));
  }

  // 2.–4. solving: the stored variables hold when the fingerprint of the inputs matches the stamp
  // and nothing is dragged
  const stored: SketchGeometry = { points: setup.input.points, radii: setup.input.radii };
  const mustSolve = setup.stamp !== feature.solved.inputs || drag !== undefined;
  let result: SolveResult;
  try {
    result = deps.solver.solve(drag ? { ...setup.input, drag: { point: drag.point, target: drag.target } } : setup.input);
  } catch (error) {
    result = { status: 'failed', points: stored.points, radii: stored.radii, degreesOfFreedom: 0, conflicting: [], redundant: [] };
    warnings.push(issue('sketchConflict', undefined, error instanceof Error ? error.message : String(error)));
  }
  let geometry = stored;
  let writeBack: SolvedSketch | undefined;
  if (result.status === 'solved') {
    if (mustSolve) {
      geometry = { points: result.points, radii: result.radii };
      writeBack = { ...ownVariables(feature, geometry), solved: { inputs: setup.stamp, external } };
    }
  } else if (warnings.every((w) => w.code !== 'sketchConflict')) warnings.push(issue('sketchConflict', result.conflicting));
  // the points and the radii of the entries the solver did not get (an outline, D72), on each path
  geometry = withEntries(geometry, resolved);
  // the far points of the axes of the origin are in the geometry of every sketch, so what reads the
  // state finds the axes whatever the constraints (D71)
  geometry = { points: { ...geometry.points, ...AXES_GEOMETRY.points }, radii: geometry.radii };

  // The engine computes the degrees of freedom from its own analysis; the count from the solver is
  // not reliable. Positions in the order of the document (the solver returns them sorted by ID), so
  // that the analysis goes in this order too.
  const inOrder = <T>(order: Record<Id, T>, values: Record<Id, T>): Record<Id, T> => Object.fromEntries(Object.keys(order).map((id) => [id, values[id]]));
  const input: SolveInput = { ...setup.input, points: inOrder(setup.input.points, geometry.points), radii: inOrder(setup.input.radii, geometry.radii) };
  const analysis = result.status === 'solved' ? new SketchAnalysis(input) : undefined;
  // the curves of the sketch and its joins, read by the profile and by what a later feature reads:
  // the world of the sketch (D65), which the sketch tools build their profiles from as well; it
  // makes the copies of the derived entries after the solver (D68), with their positions, which come
  // after the values to write back were taken
  const world = sketchWorld(stepBase(feature, resolved, geometry));
  const { curves, joins, derived } = world;
  geometry = world.geometry;
  for (const failure of derived.warnings) warnings.push(issue(failure.code, failure.refs, failure.detail));
  const profile = profileOf([...curves.values()], joins, geometry, settings.chordTolerance);
  // the result lists no hidden point (the far points of the axes)
  const hidden = new Set([...(AXES_GEOMETRY.hidden ?? []), ...Object.values(resolved).flatMap((reference) => reference.geometry.hidden ?? []), ...Object.values(derived.entries).flatMap((entry) => entry.hidden ?? [])]);
  const resultPoints = Object.fromEntries(Object.entries(geometry.points).filter(([id]) => !hidden.has(id)));
  const sketchResult: FeatureResult = {
    status: warnings.length ? 'warning' : 'ok',
    warnings,
    bodies: [],
    plane: frame,
    sketch: {
      points: resultPoints,
      radii: geometry.radii,
      curves: resultCurves(feature, resolved, derived),
      degreesOfFreedom: analysis?.degreesOfFreedom ?? 0,
      conflicting: result.conflicting,
      redundant: result.redundant,
      measurements: measure(feature, setup.input.curves, geometry),
      valid: profile.valid,
      regions: profile.regions.map((region) => ({ ref: region.ref, loops: [region.outer, ...region.holes].map((loop) => Float64Array.from(loop.xy)) })),
      ...(derived.openEnds ? { openEnds: derived.openEnds } : {}),
    },
  };
  const solve = { status: result.status, conflicting: result.conflicting };
  return { state: done(sketchResult, { sketches: { ...state.sketches, [feature.id]: { feature, frame, geometry, curves, joins, profile, input, solve, analysis } } }), writeBack };
}

export const sketch: FeatureModule<SketchFeature> = {
  info: { title: 'Sketch', summary: 'A planar sketch: points, curves, constraints and dimensions; its closed regions are extruded.', fields: [], bodies: 'none' },
  validate: sketchFeature,
  refs: (f) => [
    ...planeRefs(f.plane, 'plane'),
    ...Object.entries(f.external).flatMap(([id, ref]) => kindOf(ref).refs(ref, `external/${id}`)),
  ],
  createsBody: () => false,
  namesFaces: false,
  producesTool: () => false,
  keepsLastValidValues: true,
  step,
};

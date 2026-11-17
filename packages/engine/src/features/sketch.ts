// The sketch feature: the validators of the feature and of its content (which the sketch commands in
// document.ts call as well) and the step that projects, solves and analyses it.
import { SketchAnalysis } from '../analysis';
import { CONSTRAINTS, type EntityKind } from '../catalog';
import { externalRef, kindOf, resolveReferences, storedValue } from '../references/index';
import { derivedPoints, entityOf } from '../references/index';
import { frame as frameOf, issue } from '../recompute/services';
import type { SolvedSketch, Step, StepContext } from '../recompute/state';
import { type SketchGeometry, joinPairs, joinsOf, measure, ownVariables, profileOf, sketchCurves, solverSetup } from '../sketch';
import { CURVE_KINDS, constraintOperands, constraintPath, curvePoints, emptySketch, isDriving } from '../sketch-content';
import type { Constraint, Curve, FeatureResult, Id, Issue, Projected, SketchFeature, SolveInput, SolveResult } from '../types';
import { ORIGIN, has, unreachable } from '../util';
import { type Dict, type Fields, type ValidationContext, boolean, fail, finite, newId, object, oneOf, plain, planeRef, planeRefs, string } from '../validation';
import type { FeatureModule } from './module';

// Křivka smí odkazovat jen na vlastní body skici a na počátek.
export function curve(sketch: SketchFeature, v: unknown, what: string): Curve {
  const o = object(v, what);
  const type = oneOf(o.type, CURVE_KINDS, `${what}.type`);
  const point = (field: string): Id => {
    const id = string(o[field], `${what}.${field}`);
    if (id !== ORIGIN && !has(sketch.points, id)) fail(`${what}.${field}: "${id}" není vlastní bod skici ani počátek`);
    return id;
  };
  const construction = o.construction === undefined ? {} : { construction: boolean(o.construction, `${what}.construction`) };
  switch (type) {
    case 'line': {
      const [a, b] = [point('a'), point('b')];
      if (a === b) fail(`${what}: úsečka potřebuje dva různé body`);
      return { ...construction, type, a, b };
    }
    case 'circle':
      return { ...construction, type, center: point('center') };
    case 'arc': {
      const [center, start, end] = [point('center'), point('start'), point('end')];
      if (center === start || center === end || start === end) fail(`${what}: oblouk potřebuje tři různé body`);
      return { ...construction, type, center, start, end };
    }
    default:
      return unreachable(type, `${what}.type`);
  }
}

// The own rule of a constraint in the catalog (`check` of CONSTRAINTS), which reads the points of
// the curves it names: `constraint` asks it when a constraint is validated, and the command
// setCurvePoint asks it again for every constraint on the curve it changes (D52).
function ruleProblem(sketch: SketchFeature, type: Constraint['type'], operands: Id[], kinds: EntityKind[]): string | undefined {
  const pointsOf = (id: Id): Id[] => (has(sketch.curves, id) ? curvePoints(sketch.curves[id]) : has(sketch.external, id) ? derivedPoints(id, sketch.external[id]) : []);
  return CONSTRAINTS[type].check?.(kinds, operands, pointsOf);
}
export function constraintRuleProblem(sketch: SketchFeature, c: Constraint): string | undefined {
  const operands = constraintOperands(c);
  return ruleProblem(sketch, c.type, operands, operands.map((id) => entityOf(sketch, id)?.kind as EntityKind));
}

// Vazba podle katalogu: operandy existují, mají správný druh a jsou navzájem různé, hodnota
// splňuje konvenci znamének a aspoň jedním operandem může solver hýbat (řídicí vazbu jen mezi
// pevnými entitami solver tiše ignoruje).
export function constraint(sketch: SketchFeature, v: unknown, what: string, fields: Fields, id: Id): Constraint {
  const o = object(v, what);
  const type = string(o.type, `${what}.type`);
  if (!has(CONSTRAINTS, type)) return fail(`${what}.type: neznámá vazba "${type}"`);
  const spec = CONSTRAINTS[type as Constraint['type']];
  const operands: Record<string, Id> = {};
  const kinds: EntityKind[] = [];
  for (const { field, kinds: accepted } of spec.operands) {
    const id = string(o[field], `${what}.${field}`);
    const entity = entityOf(sketch, id);
    if (!entity) return fail(`${what}.${field}: entita "${id}" ve skice není`);
    if (!accepted.includes(entity.kind)) fail(`${what}.${field}: "${id}" je ${entity.kind}, čeká se ${accepted.join(' nebo ')}`);
    operands[field] = id;
    kinds.push(entity.kind);
  }
  if (new Set(Object.values(operands)).size < spec.operands.length) fail(`${what}: vazba potřebuje ${spec.operands.length === 2 ? 'dvě' : spec.operands.length} různé entity`);
  const problem = ruleProblem(sketch, type as Constraint['type'], Object.values(operands), kinds);
  if (problem) fail(`${what}: ${problem}`);
  const movable = Object.values(operands).some((operand) => entityOf(sketch, operand)?.own);
  const onlyFixed = (): never => fail(`${what}: vazba jen mezi pevnými entitami (počátek, promítnutá geometrie) by se nikdy neprojevila`);
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
      if (seen.has(id)) fail(`${what}.${name}: ID "${id}" je ve skice dvakrát`);
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
    if (!has(sketch.curves, id) || sketch.curves[id].type !== 'circle') fail(`${what}.radii: "${id}" není kružnice`);
    sketch.radii[id] = finite(value, `${what}.radii.${id}`);
    if (sketch.radii[id] <= 0) fail(`${what}.radii.${id}: poloměr musí být kladný`);
  }
  for (const [id, c] of Object.entries(sketch.curves)) if (c.type === 'circle' && !has(sketch.radii, id)) fail(`${what}.radii: kružnice "${id}" nemá poloměr`);
  for (const [id, value] of entries(o.constraints, 'constraints')) sketch.constraints[id] = constraint(sketch, value, `${what}.constraints.${id}`, fields, id);
  const solved = object(o.solved, `${what}.solved`);
  sketch.solved.inputs = string(solved.inputs, `${what}.solved.inputs`);
  for (const [id, value] of Object.entries(object(solved.external, `${what}.solved.external`))) {
    // the form of the value first, then whether it fits its entry
    const stored = storedValue(value, `${what}.solved.external.${id}`);
    if (!has(sketch.external, id) || kindOf(sketch.external[id]).value(stored, sketch.external[id], `${what}.solved.external.${id}`) === undefined) fail(`${what}.solved.external: "${id}" neodpovídá promítnuté geometrii skici`);
    sketch.solved.external[id] = stored;
  }
  return sketch;
}

function step(feature: SketchFeature, { state, settings, deps, done, failed, drag, badFields }: StepContext): Step {
  const frame = frameOf(feature.plane, state);
  if (typeof frame === 'string') return failed(frame, [feature.plane]);
  const warnings: Issue[] = badFields.length ? [issue('invalidExpression', badFields, 'the field keeps its last valid value')] : [];

  // 1. the reference geometry from the state before the sketch (the registry of kinds); an entry
  // that cannot be computed keeps its last valid value
  const { resolved, lost } = resolveReferences(feature, { state, frame });
  const external: Record<Id, Projected> = {};
  for (const [id, reference] of Object.entries(resolved)) if (reference.value) external[id] = reference.value;
  const setup = solverSetup(feature, resolved);
  for (const [id, code] of lost) {
    const skipped = setup.skipped.filter((c) => constraintOperands(feature.constraints[c]).some((operand) => operand === id || operand.startsWith(`${id}/`)));
    warnings.push(issue(code, [id, ...skipped], skipped.length ? 'vazby na ni se při řešení vynechaly' : undefined));
  }

  // 2.–4. řešení: uložené proměnné platí, když se otisk vstupů shoduje s razítkem a netáhne se
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

  // Stupně volnosti počítá engine z vlastního rozboru; počet ze solveru není spolehlivý.
  // Polohy v pořadí dokumentu (solver je vrací seřazené podle ID), aby i rozbor šel v tomto pořadí.
  const inOrder = <T>(order: Record<Id, T>, values: Record<Id, T>): Record<Id, T> => Object.fromEntries(Object.keys(order).map((id) => [id, values[id]]));
  const input: SolveInput = { ...setup.input, points: inOrder(setup.input.points, geometry.points), radii: inOrder(setup.input.radii, geometry.radii) };
  const analysis = result.status === 'solved' ? new SketchAnalysis(input) : undefined;
  // the curves of the sketch and its joins, read by the profile and by what a later feature reads
  const curves = new Map(sketchCurves(feature, resolved).map((curve) => [curve.id, curve]));
  const joins = joinsOf(joinPairs(feature, resolved), geometry);
  const profile = profileOf([...curves.values()], joins, geometry, settings.chordTolerance);
  const sketchResult: FeatureResult = {
    status: warnings.length ? 'warning' : 'ok',
    warnings,
    bodies: [],
    plane: frame,
    sketch: {
      points: geometry.points,
      radii: geometry.radii,
      degreesOfFreedom: analysis?.degreesOfFreedom ?? 0,
      conflicting: result.conflicting,
      redundant: result.redundant,
      measurements: measure(feature, setup.input.curves, geometry),
      valid: profile.valid,
      regions: profile.regions.map((region) => ({ ref: region.ref, loops: [region.outer, ...region.holes].map((loop) => Float64Array.from(loop.xy)) })),
    },
  };
  const solve = { status: result.status, conflicting: result.conflicting };
  return { state: done(sketchResult, { sketches: { ...state.sketches, [feature.id]: { feature, frame, geometry, curves, joins, profile, input, solve, analysis } } }), writeBack };
}

export const sketch: FeatureModule<SketchFeature> = {
  info: { title: 'Skica', summary: 'Rovinná skica: body, křivky, vazby a kóty; její uzavřené oblasti se vysouvají.', fields: [], bodies: 'none' },
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

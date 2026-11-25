// Presentation of the diagnosis of a sketch (engine.diagnoseSketch, explainConstraint) for the panel and
// the view. Pure functions with no dependency on the browser.
import type { Constraint, ConstraintExplanation, Id, SketchDiagnosis } from '@trymesh/engine';
import type { SketchView } from './sketch-view';

// The newer members of groups of duplicates: they can be deleted without second thoughts, the older twin stays.
export const duplicateTwins = (d: SketchDiagnosis): Id[] => d.duplicates.flatMap((group) => group.slice(1));

// The mark of a constraint in the list: an exact duplicate, a constraint proposed for removal, or nothing.
export function markOf(d: SketchDiagnosis, id: Id): 'duplicate' | 'surplus' | undefined {
  if (duplicateTwins(d).includes(id)) return 'duplicate';
  return d.removable.includes(id) ? 'surplus' : undefined;
}

// Entities of the sketch that can still move. A curve is free when one of its defining points is free
// or its radius is. undefined = the sketch is not solved and nothing can be said about freedom.
export function freeEntities(d: SketchDiagnosis, view: SketchView): { points: Set<Id>; curves: Set<Id> } | undefined {
  if (d.status !== 'solved') return undefined;
  const points = new Set(d.free.filter((entity) => entity.kind === 'point').map((entity) => entity.id));
  const radii = new Set(d.free.filter((entity) => entity.kind === 'radius').map((entity) => entity.id));
  const curves = new Set<Id>();
  for (const curve of view.curves.values()) {
    if (curve.own && (radii.has(curve.id) || curve.points.some((id) => points.has(id)))) curves.add(curve.id);
  }
  return { points, curves };
}

// Points whose anchoring fixes the whole sketch: their freedom equals the freedom of the sketch.
export const anchorPoints = (d: SketchDiagnosis): Id[] =>
  d.status === 'solved' && d.degreesOfFreedom > 0 ? d.free.filter((entity) => entity.kind === 'point' && entity.freedom === d.degreesOfFreedom).map((entity) => entity.id) : [];

// A list of IDs in a sentence; a long one is shortened.
export function listed(ids: Id[], limit = 8): string {
  const rest = ids.length - limit;
  if (rest <= 0) return ids.join(', ');
  return `${ids.slice(0, limit).join(', ')} and ${rest} more`;
}

// A sentence about what can still move in the sketch, and advice when anchoring one point fully constrains
// the sketch. undefined = nothing is free (or the sketch is not solved).
export function freeSummary(d: SketchDiagnosis): string | undefined {
  if (d.status !== 'solved') return undefined;
  const points = d.free.filter((entity) => entity.kind === 'point').map((entity) => entity.id);
  const radii = d.free.filter((entity) => entity.kind === 'radius').map((entity) => entity.id);
  if (points.length + radii.length === 0) return undefined;
  const what = [points.length > 0 ? `${points.length === 1 ? 'point' : 'points'} ${listed(points)}` : '', radii.length > 0 ? `${radii.length === 1 ? 'radius' : 'radii'} ${listed(radii)}` : ''].filter((part) => part !== '').join('; ');
  const anchors = anchorPoints(d);
  if (anchors.length === 0) return `Free (blue in the view): ${what}.`;
  const which = anchors.length === 1 ? `the point ${anchors[0]}` : anchors.length === points.length ? 'any of them' : `any of the points ${listed(anchors)}`;
  // Coincidence with the origin is not advised: a point whose geometry already starts at the origin would
  // pull the shape into a point.
  const how = d.degreesOfFreedom === 2 ? 'for example by two dimensions from the origin' : 'one dimension or constraint in the direction it can move is enough';
  return `Free (blue in the view): ${what}. Fixing the position of ${which} fully constrains the sketch: ${how}.`;
}

// One sentence about why a constraint in the sketch is there or need not be. `label` names the constraint
// for the user. `skipped`: the constraint was left out of solving because it refers to geometry that could
// not be projected.
export function explanationText(constraint: Constraint, id: Id, explanation: ConstraintExplanation, d: SketchDiagnosis, label: (id: Id) => string, skipped = false): string {
  if ('value' in constraint && !constraint.driving) return 'A reference dimension only measures; it does not drive the geometry.';
  if (skipped) return 'The constraint was left out of the solve: it refers to geometry that could not be projected.';
  if (d.status === 'unavailable') return 'The sketch was not evaluated, so its constraints cannot be judged.';
  if (d.status !== 'solved') return 'The sketch is not solved, so it cannot be told which constraints are surplus.';
  if (!explanation.redundant) return 'The constraint is needed: it does not follow from the others.';
  if (explanation.impliedBy.length === 0) return 'The constraint is surplus: it already follows from the definition of the curve.';
  const [first] = explanation.impliedBy;
  if (explanation.impliedBy.length === 1 && d.duplicates.some((group) => group.includes(id) && group.includes(first))) return 'The constraint is a duplicate: the sketch already has the same constraint (highlighted in the list).';
  const names = explanation.impliedBy.map(label).join('; ');
  const one = explanation.impliedBy.length === 1;
  // It can be replaced only by constraints that are wholly redundant themselves; a constraint with two
  // equations (coincidence) may need only one of them for this one, and removing it would free the sketch.
  const interchangeable = explanation.impliedBy.every((other) => d.redundant.includes(other));
  const removal = interchangeable ? `Either it or ${one ? 'the other one' : 'any one of them'} can be removed without changing the geometry.` : 'This constraint can be removed without changing the geometry.';
  return `The constraint follows from ${one ? 'the constraint' : 'the constraints'}: ${names}. ${removal}`;
}

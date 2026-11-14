// Podání diagnostiky skici (engine.diagnoseSketch, explainConstraint) pro panel a pohled.
// Čisté funkce bez závislosti na prohlížeči.
import type { Constraint, ConstraintExplanation, Id, SketchDiagnosis } from '@trymesh/engine';
import type { SketchView } from './sketch-view';

// Novější členy skupin duplicit: ty jde smazat bez rozmýšlení, starší dvojče zůstává.
export const duplicateTwins = (d: SketchDiagnosis): Id[] => d.duplicates.flatMap((group) => group.slice(1));

// Označení vazby v seznamu: přesná duplicita, vazba navržená k odebrání, nebo nic.
export function markOf(d: SketchDiagnosis, id: Id): 'duplicate' | 'surplus' | undefined {
  if (duplicateTwins(d).includes(id)) return 'duplicate';
  return d.removable.includes(id) ? 'surplus' : undefined;
}

// Entity skici, které se ještě mohou hýbat. Křivka je volná, když je volný některý její určující
// bod nebo její poloměr. undefined = skica není vyřešená a o volnosti se nedá nic říct.
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

// Body, jejichž ukotvení skicu určí celou: jejich volnost se rovná volnosti skici.
export const anchorPoints = (d: SketchDiagnosis): Id[] =>
  d.status === 'solved' && d.degreesOfFreedom > 0 ? d.free.filter((entity) => entity.kind === 'point' && entity.freedom === d.degreesOfFreedom).map((entity) => entity.id) : [];

// Jedna věta o tom, proč vazba ve skice je nebo být nemusí. `label` pojmenuje vazbu pro uživatele.
export function explanationText(constraint: Constraint, id: Id, explanation: ConstraintExplanation, d: SketchDiagnosis, label: (id: Id) => string): string {
  if ('value' in constraint && !constraint.driving) return 'Referenční kóta jen měří, geometrii neurčuje.';
  if (d.status === 'unavailable') return 'Skica se nevyhodnotila, vazby nejde posoudit.';
  if (d.status !== 'solved') return 'Skica není vyřešená, proto se nedá říct, které vazby jsou navíc.';
  if (!explanation.redundant) return 'Vazba je potřebná: z ostatních neplyne.';
  if (explanation.impliedBy.length === 0) return 'Vazba je navíc: plyne už z definice křivky.';
  const [first] = explanation.impliedBy;
  if (explanation.impliedBy.length === 1 && d.duplicates.some((group) => group.includes(id) && group.includes(first))) return `Vazba je duplicita vazby ${label(first)}.`;
  const names = explanation.impliedBy.map(label).join('; ');
  return `Vazba plyne z ${explanation.impliedBy.length === 1 ? 'vazby' : 'vazeb'}: ${names}. Odebrat jde ona nebo kterákoli z nich, geometrie se tím nezmění.`;
}

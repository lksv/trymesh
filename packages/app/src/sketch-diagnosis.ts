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

// Výčet ID do věty; dlouhý se zkrátí.
export function listed(ids: Id[], limit = 8): string {
  const rest = ids.length - limit;
  if (rest <= 0) return ids.join(', ');
  return `${ids.slice(0, limit).join(', ')} a ${rest === 1 ? '1 další' : rest < 5 ? `další ${rest}` : `dalších ${rest}`}`;
}

// Věta o tom, co se ve skice ještě může hýbat, a rada, když skicu dourčí ukotvení jednoho bodu.
// undefined = nic volného (nebo skica není vyřešená).
export function freeSummary(d: SketchDiagnosis): string | undefined {
  if (d.status !== 'solved') return undefined;
  const points = d.free.filter((entity) => entity.kind === 'point').map((entity) => entity.id);
  const radii = d.free.filter((entity) => entity.kind === 'radius').map((entity) => entity.id);
  if (points.length + radii.length === 0) return undefined;
  const what = [points.length > 0 ? `${points.length === 1 ? 'bod' : 'body'} ${listed(points)}` : '', radii.length > 0 ? `${radii.length === 1 ? 'poloměr' : 'poloměry'} ${listed(radii)}` : ''].filter((part) => part !== '').join('; ');
  const anchors = anchorPoints(d);
  if (anchors.length === 0) return `Volné (v pohledu modře): ${what}.`;
  const which = anchors.length === 1 ? `bodu ${anchors[0]}` : anchors.length === points.length ? 'kteréhokoli z nich' : `kteréhokoli z bodů ${listed(anchors)}`;
  // Totožnost s počátkem se neradí: bod, jehož geometrie už z počátku vychází, by tvar stáhla do bodu.
  const how = d.degreesOfFreedom === 2 ? 'například dvěma kótami od počátku' : 'stačí jedna kóta nebo vazba ve směru, kterým se může hýbat';
  return `Volné (v pohledu modře): ${what}. Skicu dourčí určení polohy ${which}: ${how}.`;
}

// Jedna věta o tom, proč vazba ve skice je nebo být nemusí. `label` pojmenuje vazbu pro uživatele.
// `skipped`: vazba se při řešení vynechala, protože odkazuje na geometrii, kterou nešlo promítnout.
export function explanationText(constraint: Constraint, id: Id, explanation: ConstraintExplanation, d: SketchDiagnosis, label: (id: Id) => string, skipped = false): string {
  if ('value' in constraint && !constraint.driving) return 'Referenční kóta jen měří, geometrii neurčuje.';
  if (skipped) return 'Vazba se při řešení vynechala: odkazuje na geometrii, kterou se nepodařilo promítnout.';
  if (d.status === 'unavailable') return 'Skica se nevyhodnotila, vazby nejde posoudit.';
  if (d.status !== 'solved') return 'Skica není vyřešená, proto se nedá říct, které vazby jsou navíc.';
  if (!explanation.redundant) return 'Vazba je potřebná: z ostatních neplyne.';
  if (explanation.impliedBy.length === 0) return 'Vazba je navíc: plyne už z definice křivky.';
  const [first] = explanation.impliedBy;
  if (explanation.impliedBy.length === 1 && d.duplicates.some((group) => group.includes(id) && group.includes(first))) return 'Vazba je duplicita: stejnou vazbu už skica má (v seznamu podbarvená).';
  const names = explanation.impliedBy.map(label).join('; ');
  const one = explanation.impliedBy.length === 1;
  // Zaměnit ji jde jen za vazby, které jsou samy celé navíc; vazba se dvěma rovnicemi (totožnost)
  // může téhle stačit jen jednou z nich a po jejím odebrání by se skica uvolnila.
  const interchangeable = explanation.impliedBy.every((other) => d.redundant.includes(other));
  const removal = interchangeable ? `Odebrat jde ona nebo ${one ? 'ta druhá' : 'kterákoli z nich'}, geometrie se tím nezmění.` : 'Odebrat jde tahle vazba, geometrie se tím nezmění.';
  return `Vazba plyne z ${one ? 'vazby' : 'vazeb'}: ${names}. ${removal}`;
}

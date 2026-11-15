// The text of a recompute issue and the names of what it refers to, for a human. Pure functions, no DOM.
import { type FaceName, type Id, type Issue, type IssueCode, type NumberSpec, bodyOwner } from '@trymesh/engine';

// The name of a feature of the document; undefined when the document has no such feature.
export type NameOf = (feature: Id) => string | undefined;

export const ROLES: Record<FaceName['role'], string> = { side: 'bok', startCap: 'víko ve skice', endCap: 'protější víko', wallSide: 'side of a wall', wallEnd: 'end of a wall' };
// What tells apart the faces of a wall: the side of its curve, the point of its end.
const wallPart = (name: FaceName): string => (name.role === 'wallSide' ? ` (${name.side} of ${name.curve})` : name.role === 'wallEnd' ? ` (at ${name.point})` : '');

// A feature by its name; one the document does not have by its ID in parentheses.
export const featureName = (id: Id, nameOf: NameOf): string => nameOf(id) ?? `(${id})`;

// A body is named after the feature that created it; a copy made by a pattern adds its number.
export function bodyName(body: Id, nameOf: NameOf): string {
  const { feature, local } = bodyOwner(body);
  return local === undefined ? featureName(feature, nameOf) : `${featureName(feature, nameOf)} / ${local}`;
}

// A face by the feature that made it and its role; a face of a copy names the copy and its pattern.
export const faceLabel = (name: FaceName, nameOf: NameOf): string =>
  `${featureName(name.feature, nameOf)} – ${ROLES[name.role]}${wallPart(name)}${(name.copy ?? []).map((tag) => `, copy ${tag.index} of ${featureName(tag.pattern, nameOf)}`).join('')}`;

// A string in `refs`: a feature or a body the document has is named; anything else (a feature that
// is gone, a point of a sketch such as `x1/center`) stays the ID it is.
export function refName(ref: string, nameOf: NameOf): string {
  const { feature, local } = bodyOwner(ref);
  const name = nameOf(feature);
  return name === undefined ? ref : local === undefined ? name : `${name} / ${local}`;
}

interface CopyRef {
  copy: number;
  feature: Id;
}
const isCopy = (ref: unknown): ref is CopyRef => typeof ref === 'object' && ref !== null && typeof (ref as { copy?: unknown }).copy === 'number' && typeof (ref as { feature?: unknown }).feature === 'string';

// Issues whose string refs are bodies and features (the targets a cut missed or would remove,
// a missing target or source). Other issues keep their refs to themselves (constraints, field paths).
const NAMED: readonly IssueCode[] = ['noEffect', 'emptyResult', 'brokenReference'];

// The message of the engine with what the issue is about appended. A pattern names the copy that
// failed or had no effect as `{ copy, feature }` in refs, whatever the issue is.
export function issueText(issue: Issue, nameOf: NameOf): string {
  const named = (issue.refs ?? []).flatMap((ref): string[] => {
    if (isCopy(ref)) return [`copy ${ref.copy} of ${refName(ref.feature, nameOf)}`];
    return typeof ref === 'string' && NAMED.includes(issue.code) ? [refName(ref, nameOf)] : [];
  });
  return named.length ? `${issue.message} (${named.join(', ')})` : issue.message;
}

// A number typed in degrees that lies outside the range of an angle field, in degrees; undefined =
// fine or not a number (the engine checks expressions and reports them in radians, as they are written).
export function angleProblem(value: unknown, spec: NumberSpec): string | undefined {
  if (spec.unit !== 'rad' || typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const degrees = (radians: number): string => `${Math.round(((radians * 180) / Math.PI) * 1e6) / 1e6 + 0}°`;
  const below = spec.min !== undefined && (value < spec.min.value || (spec.min.open === true && value === spec.min.value));
  const above = spec.max !== undefined && (value > spec.max.value || (spec.max.open === true && value === spec.max.value));
  if (!below && !above) return undefined;
  if (spec.min && spec.max) return `${spec.title}: ${degrees(value)} is not between ${degrees(spec.min.value)} and ${degrees(spec.max.value)}`;
  const bound = (below ? spec.min : spec.max) as NonNullable<NumberSpec['min']>;
  return `${spec.title}: ${degrees(value)} must be ${bound.open ? (below ? 'above' : 'below') : below ? 'at least' : 'at most'} ${degrees(bound.value)}`;
}

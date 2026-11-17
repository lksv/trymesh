// The text of a recompute issue and the names of what it refers to, for a human. Pure functions, no DOM.
import { DOCUMENT_SECTIONS, type Document, type FaceName, type Feature, type Id, type Issue, type IssueCode, type NumberSpec, bodyOwner } from '@trymesh/engine';

// The name of a feature of the document; undefined when the document has no such feature.
export type NameOf = (feature: Id) => string | undefined;
// The name of a body from its properties (D48); undefined when the shown model has no such body.
export type BodyNameOf = (body: Id) => string | undefined;
// The type of a feature of the document; undefined when the document has no such feature.
export type TypeOf = (feature: Id) => Feature['type'] | undefined;

export const ROLES: Record<FaceName['role'], string> = {
  side: 'bok',
  startCap: 'víko ve skice',
  endCap: 'protější víko',
  wallSide: 'side of a wall',
  wallEnd: 'end of a wall',
  holeBore: 'bore of a hole',
  holeHead: 'head of a hole',
  holeFlat: 'flat of a nut pocket',
  holeSeat: 'seat of a hole',
  mesh: 'surface of an imported mesh',
  splitFace: 'cut face of a split',
};
// What tells apart the faces of a wall and of a hole: the side of its curve, the point of its end
// or of the hole, the number of a flat.
const wallPart = (name: FaceName): string =>
  name.role === 'wallSide' ? ` (${name.side} of ${name.curve})` : name.role === 'wallEnd' || name.role === 'holeBore' || name.role === 'holeHead' ? ` (at ${name.point})` : name.role === 'holeFlat' ? ` (${name.flat} at ${name.point})` : '';

// A feature by its name; one the document does not have by its ID in parentheses.
export const featureName = (id: Id, nameOf: NameOf): string => nameOf(id) ?? `(${id})`;

// A body is named by its properties (D48), which name it after the feature that created it unless
// it has a name of its own; a copy made by a pattern adds its number.
export function bodyName(body: Id, nameOf: NameOf, bodyNameOf?: BodyNameOf): string {
  const named = bodyNameOf?.(body);
  if (named !== undefined) return named;
  const { feature, local } = bodyOwner(body);
  return local === undefined ? featureName(feature, nameOf) : `${featureName(feature, nameOf)} / ${local}`;
}

// A face by the feature that made it and its role; a face of a copy names the copy and its pattern,
// a face a combine moved by a clearance (D56) the tool and the combine (`typeOf` tells them apart;
// without it every tag reads as a copy).
export const faceLabel = (name: FaceName, nameOf: NameOf, typeOf?: TypeOf): string =>
  `${featureName(name.feature, nameOf)} – ${ROLES[name.role]}${wallPart(name)}${(name.copy ?? []).map((tag) => (typeOf?.(tag.pattern) === 'combine' ? `, in the pocket of tool ${tag.index} of ${featureName(tag.pattern, nameOf)}` : `, copy ${tag.index} of ${featureName(tag.pattern, nameOf)}`)).join('')}`;

// A string in `refs`: a feature or a body the document has is named; anything else (a feature that
// is gone, a point of a sketch such as `x1/center`) stays the ID it is.
export function refName(ref: string, nameOf: NameOf, bodyNameOf?: BodyNameOf): string {
  const named = bodyNameOf?.(ref);
  if (named !== undefined) return named;
  const { feature, local } = bodyOwner(ref);
  const name = nameOf(feature);
  return name === undefined ? ref : local === undefined ? name : `${name} / ${local}`;
}

interface CopyRef {
  copy: number;
  feature: Id;
}
const isCopy = (ref: unknown): ref is CopyRef => typeof ref === 'object' && ref !== null && typeof (ref as { copy?: unknown }).copy === 'number' && typeof (ref as { feature?: unknown }).feature === 'string';
const isFace = (ref: unknown): ref is FaceName => typeof ref === 'object' && ref !== null && typeof (ref as { feature?: unknown }).feature === 'string' && typeof (ref as { role?: unknown }).role === 'string';

// Issues whose string refs are bodies and features (the targets a cut missed or would remove,
// a missing target or source). Other issues keep their refs to themselves (constraints, field paths).
// A combine names its tool in an invalidClearance (then the faces) and in a kernelFailure (D56).
const NAMED: readonly IssueCode[] = ['noEffect', 'emptyResult', 'brokenReference', 'invalidClearance', 'kernelFailure'];

// The message of the engine with what the issue is about appended. A pattern names the copy that
// failed or had no effect as `{ copy, feature }` in refs, whatever the issue is.
export function issueText(issue: Issue, nameOf: NameOf, bodyNameOf?: BodyNameOf, typeOf?: TypeOf): string {
  const named = (issue.refs ?? []).flatMap((ref): string[] => {
    if (isCopy(ref)) return [`copy ${ref.copy} of ${refName(ref.feature, nameOf)}`];
    if (issue.code === 'invalidClearance' && isFace(ref)) return [faceLabel(ref, nameOf, typeOf)];
    return typeof ref === 'string' && NAMED.includes(issue.code) ? [refName(ref, nameOf, bodyNameOf)] : [];
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

// The status line of a command that used again IDs a section of the document still names (`taken`,
// from `takenOver` of the engine, against the document before the command): what the entry gives
// to what was made under such an ID. Body properties (D48) go to a body; the mechanism (D49) puts
// a body made under the ID into its link, and leads the axis of a joint through a sketch or a point.
export function takenOverText(doc: Document, taken: Id[]): string {
  const properties = taken.filter((id) => DOCUMENT_SECTIONS.bodyProperties.names(doc.bodyProperties).includes(id));
  const mechanism = taken.filter((id) => DOCUMENT_SECTIONS.mechanism.names(doc.mechanism).includes(id));
  return [
    ...(properties.length ? [`An ID that body properties name is now used again: ${properties.join(', ')}. A body made under it takes those properties; if it is another thing, remove them in the model panel.`] : []),
    ...(mechanism.length ? [`An ID that the mechanism names is now used again: ${mechanism.join(', ')}. A body made under it is in its link, and a sketch or a point made under it carries the axis of its joint; if it is another thing, change the mechanism in the model panel.`] : []),
  ].join(' ');
}

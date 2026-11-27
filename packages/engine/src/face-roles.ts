// The roles of faces. A face is named by the feature that made it and its role there (`FaceName` in
// types.ts, one member of the union per role, because that is what an AI reads). This catalog says,
// for every role, how it is called and names every field that tells apart the faces of that role
// within one feature. The validator of a face name, the key of a face and the label a tool prints
// are built from it, so a new role is one member of the union and one entry here.
// - Such a field is a text (an ID) or a whole number, and is always there: a key cannot be built
//   from an object, and a field that may be missing would give two faces one key.
// - A text field may hold any ID a sketch can have, the derived ID of a point of projected
//   geometry (`rim/center`) or of a copy of a mirror or pattern (`m/1/c2`, D68) included, although
//   the key separates its fields by slashes. The key stays unambiguous because a text field that
//   holds a slash or starts with a quotation mark is written as a JSON string (`lid/side/"m/1/c2"`):
//   a field that is not quoted has no slash and does not start with a quotation mark, and a quoted
//   one ends at its closing quote, so a key reads back in one way whatever the fields hold.
// - The compiler ties the union and the catalog: a role without an entry does not compile, nor an
//   entry that leaves out a field of the name or gives it the other kind. A role whose name has
//   a field of another type, or an optional one, has no entry that compiles.
import type { FaceName } from './types';

type FaceParts<R extends FaceName['role']> = Omit<Extract<FaceName, { role: R }>, 'feature' | 'role' | 'copy'>;
export interface FaceRoleSpec<R extends FaceName['role']> {
  title: string;
  parts: { readonly [P in keyof FaceParts<R>]-?: { title: string; kind: FaceParts<R>[P] extends string ? 'text' : FaceParts<R>[P] extends number ? 'integer' : never } };
}

// The order of the entries shows in an error message and is the order the roles were added in.
export const FACE_ROLES: { [R in FaceName['role']]: FaceRoleSpec<R> } = {
  side: { title: 'side', parts: { curve: { title: 'curve of the profile', kind: 'text' } } },
  startCap: { title: 'start cap', parts: {} },
  endCap: { title: 'end cap', parts: {} },
  wallSide: { title: 'side of a wall', parts: { curve: { title: 'curve of the chain', kind: 'text' }, side: { title: 'side of the curve (left or right)', kind: 'text' } } },
  wallEnd: { title: 'end of a wall', parts: { point: { title: 'point the chain ends at', kind: 'text' } } },
  holeBore: { title: 'bore of a hole', parts: { point: { title: 'point of the hole', kind: 'text' } } },
  holeHead: { title: 'head of a hole', parts: { point: { title: 'point of the hole', kind: 'text' } } },
  holeFlat: { title: 'flat of a nut pocket', parts: { point: { title: 'point of the hole', kind: 'text' }, flat: { title: 'flat, from 1', kind: 'integer' } } },
  holeSeat: { title: 'seat of a hole', parts: {} },
  mesh: { title: 'surface of an imported mesh', parts: {} },
  splitFace: { title: 'cut face of a split', parts: {} },
  chamfer: { title: 'chamfer of an edge', parts: { edge: { title: 'the place of the edge in the list of the feature, from 0', kind: 'integer' } } },
  fillet: { title: 'fillet of an edge', parts: { edge: { title: 'the place of the edge in the list of the feature, from 0', kind: 'integer' } } },
  threadFlank: { title: 'flank of a thread', parts: { face: { title: 'the place of the face in the list of the feature, from 0', kind: 'integer' }, side: { title: 'the end of the thread the flank faces (start or end)', kind: 'text' } } },
  threadRoot: { title: 'root of a thread', parts: { face: { title: 'the place of the face in the list of the feature, from 0', kind: 'integer' } } },
  threadEnd: { title: 'flat end of a thread', parts: { face: { title: 'the place of the face in the list of the feature, from 0', kind: 'integer' }, end: { title: 'the end of the thread (start or end)', kind: 'text' } } },
};

// A catalog of roles as code that handles any role reads it. The functions below take one so that
// they can be tested with roles no feature has yet.
export type RoleCatalog = { readonly [role: string]: { readonly title: string; readonly parts: { readonly [part: string]: { readonly title: string; readonly kind: 'text' | 'integer' } } } };

const NO_PARTS: readonly string[] = [];
const sortedParts = (roles: RoleCatalog): Record<string, readonly string[]> => Object.fromEntries(Object.entries(roles).map(([role, spec]) => [role, Object.keys(spec.parts).sort()]));
const OWN_PARTS = sortedParts(FACE_ROLES);
const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

// The names of the fields that tell apart the faces of a role, in alphabetical order: the order
// they have in a key and in a label.
export function facePartNames(role: string, roles: RoleCatalog = FACE_ROLES): readonly string[] {
  const parts = roles === FACE_ROLES ? OWN_PARTS : sortedParts(roles);
  return has(parts, role) ? parts[role] : NO_PARTS;
}

// The values of those fields of a face name, in that order.
export function faceParts(name: FaceName, roles: RoleCatalog = FACE_ROLES): (string | number)[] {
  return facePartNames(name.role, roles).map((part) => (name as unknown as Record<string, string | number>)[part]);
}

// The key of a face: `<feature>/<role>`, then the values of the fields of the role (a text that
// holds a slash or starts with a quotation mark as a JSON string), then `/@<pattern>:<index>` for
// every copy tag. For the three roles of an extrusion that is `<feature>/side/<curve>`,
// `<feature>/startCap` and `<feature>/endCap`, and for the side of a copy of a mirror or pattern
// in a sketch `<feature>/side/"<entry>/<copy>/<curve>"`; the face table depends on it.
// A face of an insertion (D62: `feature` has a slash) is keyed `<insertion>/`, then the key of its
// name in the inserted document written as a JSON string, then the tags of this document:
// `b1/"ring/side/outer"`, `b1/"ring/side/outer"/@q:2`, `kit/"b/\"ring/endCap/@p:1\""`. An ID may
// hold `@` and `:`, so the plain concatenation would not be unambiguous once an ID holds a slash;
// a JSON string ends at its closing quote, and the inner key is unambiguous by the same rule one
// level down. Its name in the inserted document is the name with the insertion stripped from
// `feature` and from the tags that come first and have a slash (the rule of form of a face name,
// `faceName` in validation.ts). The exception to "at most one field holds a free ID" above: the
// quoted key keeps the prefixed IDs apart from the fields of the role.
// The key of a face of an insertion is kept by its name object (a name is not changed once made):
// the solids of an insertion look up every face many times, and the key of a prefixed name is a
// few times dearer than a plain one.
const PREFIXED_KEYS = new WeakMap<FaceName, string>();

// A field of a role in a key: a text with a slash or a leading quotation mark as a JSON string.
const partKey = (part: string | number): string => (typeof part === 'string' && (part.includes('/') || part.startsWith('"')) ? JSON.stringify(part) : String(part));

export function faceKey(name: FaceName, roles: RoleCatalog = FACE_ROLES): string {
  const tags = name.copy ?? [];
  const tagKey = (tag: { pattern: string; index: number }): string => `/@${tag.pattern}:${tag.index}`;
  const slash = name.feature.indexOf('/');
  if (slash < 0) return [name.feature, name.role, ...faceParts(name, roles).map(partKey)].join('/') + tags.map(tagKey).join('');
  if (roles === FACE_ROLES) {
    const kept = PREFIXED_KEYS.get(name);
    if (kept !== undefined) return kept;
  }
  const key = prefixedKey(name, tags, slash, roles, tagKey);
  if (roles === FACE_ROLES) PREFIXED_KEYS.set(name, key);
  return key;
}

function prefixedKey(name: FaceName, tags: readonly { pattern: string; index: number }[], slash: number, roles: RoleCatalog, tagKey: (tag: { pattern: string; index: number }) => string): string {
  let inner = 0;
  while (inner < tags.length && tags[inner].pattern.includes('/')) inner++;
  const there = tags.slice(0, inner).map((tag) => ({ pattern: tag.pattern.slice(tag.pattern.indexOf('/') + 1), index: tag.index }));
  const { copy: _copy, ...rest } = name;
  const nameThere = { ...rest, feature: name.feature.slice(slash + 1), ...(there.length ? { copy: there } : {}) } as FaceName;
  return `${name.feature.slice(0, slash)}/${JSON.stringify(faceKey(nameThere, roles))}${tags.slice(inner).map(tagKey).join('')}`;
}

// A face name written for people, as a message prints it: the plain concatenation of the key
// without the quotes of an insertion (`b1/ring/side/outer`). Not an identity: two names may share
// it.
export function faceText(name: FaceName, roles: RoleCatalog = FACE_ROLES): string {
  return [name.feature, name.role, ...faceParts(name, roles)].join('/') + (name.copy ?? []).map((tag) => `/@${tag.pattern}:${tag.index}`).join('');
}

// Are two face names one name, field by field (the feature, the role, the fields of the role, the
// copy tags)? A face is looked up by its key and then compared (D62): a text field of a role takes
// any text, so a name that no feature makes may key like a real one.
export function sameFaceName(a: FaceName, b: FaceName, roles: RoleCatalog = FACE_ROLES): boolean {
  if (a.feature !== b.feature || a.role !== b.role) return false;
  const [pa, pb] = [faceParts(a, roles), faceParts(b, roles)];
  if (pa.some((part, i) => part !== pb[i])) return false;
  const [ta, tb] = [a.copy ?? [], b.copy ?? []];
  return ta.length === tb.length && ta.every((tag, i) => tag.pattern === tb[i].pattern && tag.index === tb[i].index);
}

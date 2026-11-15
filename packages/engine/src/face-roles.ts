// The roles of faces. A face is named by the feature that made it and its role there (`FaceName` in
// types.ts, one member of the union per role, because that is what an AI reads). This catalog says,
// for every role, how it is called and names every field that tells apart the faces of that role
// within one feature. The validator of a face name, the key of a face and the label a tool prints
// are built from it, so a new role is one member of the union and one entry here.
// - Such a field is a text (an ID) or a whole number, and is always there: a key cannot be built
//   from an object, and a field that may be missing would give two faces one key.
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

// The key of a face: `<feature>/<role>`, then the values of the fields of the role, then
// `/@<pattern>:<index>` for every copy tag. For the three roles of an extrusion that is
// `<feature>/side/<curve>`, `<feature>/startCap` and `<feature>/endCap`; fingerprints of solved
// sketches and the face table depend on it.
export function faceKey(name: FaceName, roles: RoleCatalog = FACE_ROLES): string {
  return [name.feature, name.role, ...faceParts(name, roles)].join('/') + (name.copy ?? []).map((tag) => `/@${tag.pattern}:${tag.index}`).join('');
}

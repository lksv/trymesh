// The section `meshes` (D55): stored meshes by ID, kept inside the document. Validation (strict, the
// mesh checked in full), the two commands, and the result of the recompute (what a stored mesh is,
// without its data, and which features place it).
import { type IndexedMesh, MESH_LIMITS, indexedMesh, meshBounds, meshPieces, meshProblem, meshVolume } from '../mesh';
import type { Document, Id, MeshResult, StoredMesh } from '../types';
import { has } from '../util';
import { type Dict, fail, newId, object, onlyFields, string } from '../validation';
import { label } from './body-properties';
import type { SectionSpec } from './spec';

type Section = Record<Id, StoredMesh>;
type Results = Record<Id, MeshResult>;

const ENTRY_FIELDS = ['name', 'positions', 'triangles'] as const;

// An entry in its canonical form, its mesh checked by the checks of a stored mesh with `limit`.
// The decoded mesh is kept by the new entry object, so the recompute does not decode it again.
function entry(v: unknown, what: string, limit: number): StoredMesh {
  const o = object(v, what);
  onlyFields(o, ENTRY_FIELDS, what, 'a stored mesh');
  const name = o.name === undefined ? undefined : label(o.name, `${what}.name`);
  const stored: StoredMesh = { ...(name === undefined ? {} : { name }), positions: string(o.positions, `${what}.positions`), triangles: string(o.triangles, `${what}.triangles`) };
  const problem = meshProblem(indexedMesh(stored, what), limit);
  if (problem) fail(`${what}: ${problem.message}`);
  return stored;
}

// The features of a document that place a stored mesh, in the order of the timeline.
const usersOf = (doc: Document, id: Id): Id[] => doc.features.filter((f) => f.type === 'mesh' && f.mesh === id).map((f) => f.id);

function addMesh(doc: Document, cmd: Dict): Section {
  const id = newId(cmd.id, 'addMesh.id');
  if (has(doc.meshes, id)) fail(`addMesh.id: the document has a stored mesh "${id}" already; a stored mesh never changes, add a new revision under another ID`);
  return { ...doc.meshes, [id]: entry(cmd.mesh, 'addMesh.mesh', MESH_LIMITS.triangles) };
}

function removeMesh(doc: Document, cmd: Dict): Section {
  const id = string(cmd.id, 'removeMesh.id');
  if (!has(doc.meshes, id)) fail(`removeMesh.id: the document has no stored mesh "${id}"`);
  const users = usersOf(doc, id);
  if (users.length) fail(`removeMesh.id: the stored mesh "${id}" is placed by the features ${users.join(', ')}; remove them or point them to another mesh first, in the same batch`);
  return Object.fromEntries(Object.entries(doc.meshes).filter(([key]) => key !== id));
}

// What a stored mesh is, without `usedBy`: computed once per entry object.
const DESCRIBED = new WeakMap<StoredMesh, Omit<MeshResult, 'usedBy'>>();
function described(stored: StoredMesh): Omit<MeshResult, 'usedBy'> {
  let found = DESCRIBED.get(stored);
  if (!found) {
    const mesh: IndexedMesh = indexedMesh(stored);
    found = {
      ...(stored.name === undefined ? {} : { name: stored.name }),
      vertices: mesh.positions.length / 3,
      triangles: mesh.triangles.length / 3,
      bounds: meshBounds(mesh),
      volume: meshVolume(mesh),
      shells: meshPieces(mesh).length,
    };
    DESCRIBED.set(stored, found);
  }
  return found;
}

export const meshes: SectionSpec<Section, Results> = {
  info: {
    title: 'Stored meshes',
    summary:
      'Triangle meshes read from files (the tool import_mesh, or "Import a file" in the app), stored inside the document by ID. A feature of the type `mesh` places one as a body; the same mesh may be placed several times. ' +
      'A stored mesh is a closed solid in millimetres and never changes; `removeMesh` is refused while a feature uses it. get_document leaves out the data of a stored mesh, get_model lists the stored meshes with what uses them. ' +
      'The one exception to "a section recomputes no geometry": a mesh feature reads its entry, so addMesh under an ID a feature already names computes that feature again.',
    commands: ['addMesh', 'removeMesh'],
    fields: [],
  },
  empty: () => ({}),
  validate(value, what) {
    const o = object(value, what);
    const out: Section = {};
    for (const [key, item] of Object.entries(o)) out[newId(key, `${what}.${key}`)] = entry(item, `${what}.${key}`, MESH_LIMITS.stored);
    return out;
  },
  commands: { addMesh, removeMesh },
  renameParameter: (section) => section,
  // the IDs of the stored meshes are a namespace of their own: they name no feature
  names: () => [],
  evaluate(section, doc) {
    return { result: Object.fromEntries(Object.entries(section).map(([id, stored]) => [id, { ...described(stored), usedBy: usersOf(doc, id) }])) };
  },
};

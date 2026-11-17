// The mesh feature (D55): a stored mesh of the section `meshes` placed as a body, with one face for
// its whole surface. The step reads the entry of the section through `input`, the one place where
// a feature reads the document beside itself.
import type { FieldSpec, NumberSpec } from '../catalog';
import { indexedMesh } from '../mesh';
import { frameOf, placementTransform } from '../recompute/placement';
import type { Step, StepContext } from '../recompute/state';
import { type FaceInfo, type RigidTransform, transformSolid } from '../solid';
import type { BodyPlacement, FaceName, MeshFeature, Solid, StoredMesh, Vec3 } from '../types';
import { faceKey, has } from '../util';
import { type Dict, type ValidationContext, base, fail, frameRef, frameRefs, object, onlyFields, string } from '../validation';
import type { FeatureModule } from './module';

const OFFSET: NumberSpec = { title: 'Offset', unit: 'mm', default: 0 };
const TURN: NumberSpec = { title: 'Turn', unit: 'rad', min: { value: -2 * Math.PI }, max: { value: 2 * Math.PI }, default: 0 };
const NUMBERS = ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const;
// The six numbers of a placement: optional numeric fields, absent meaning 0.
export const PLACEMENT_FIELDS: readonly FieldSpec[] = [
  { path: 'placement/x', spec: { ...OFFSET, title: 'Offset along X' } },
  { path: 'placement/y', spec: { ...OFFSET, title: 'Offset along Y' } },
  { path: 'placement/z', spec: { ...OFFSET, title: 'Offset along the normal' } },
  { path: 'placement/rx', spec: { ...TURN, title: 'Turn about X' } },
  { path: 'placement/ry', spec: { ...TURN, title: 'Turn about Y' } },
  { path: 'placement/rz', spec: { ...TURN, title: 'Turn about the normal' } },
];
const SPECS = new Map(PLACEMENT_FIELDS.map((field) => [field.path, field.spec]));

function meshFeature(o: Dict, what: string, context: ValidationContext): MeshFeature {
  const mesh = string(o.mesh, `${what}.mesh`);
  if (mesh === '') fail(`${what}.mesh: the ID of a stored mesh is expected`);
  context.requireRef({ id: mesh, kind: 'mesh' }, `${what}.mesh`);
  const given = object(o.placement, `${what}.placement`);
  onlyFields(given, ['frame', ...NUMBERS], `${what}.placement`, 'a placement');
  const placement: BodyPlacement = { frame: frameRef(context, given.frame, `${what}.placement.frame`) };
  // a number is stored only when it is given (also a zero)
  for (const name of NUMBERS) {
    const path = `placement/${name}`;
    if (given[name] !== undefined) placement[name] = context.fields.number(given[name], path, SPECS.get(path) as NumberSpec, `${what}.placement.${name}`);
  }
  return { ...base(o, what), type: 'mesh', mesh, placement };
}

const FACE: FaceInfo = { planar: false, surface: 'mesh' };

// The mesh of an entry in its own frame, as a solid with the face 0: kept by the entry object.
const UNPLACED = new WeakMap<StoredMesh, Solid>();
function unplaced(entry: StoredMesh): Solid {
  let solid = UNPLACED.get(entry);
  if (!solid) {
    const mesh = indexedMesh(entry);
    UNPLACED.set(entry, (solid = { positions: mesh.positions, triangles: mesh.triangles, faceIds: new Uint32Array(mesh.triangles.length / 3) }));
  }
  return solid;
}
// The placed solid: kept by the entry object, the transform, the number of its face and the ID of
// the feature, the last few of each entry, so that a step run again for an edit before the feature
// gives the same object (what the queries remember by a solid stays). It is a copy of the mesh in
// its own frame (`transformSolid`), so two bodies placed from one entry are one shape to the parts
// list.
const PLACED_KEPT = 4;
const PLACED = new WeakMap<StoredMesh, Map<string, Solid>>();
function placed(entry: StoredMesh, transform: RigidTransform, face: number, feature: string): Solid {
  let kept = PLACED.get(entry);
  if (!kept) PLACED.set(entry, (kept = new Map()));
  const key = JSON.stringify([transform.matrix, transform.translation, face, feature]);
  let solid = kept.get(key);
  if (solid) kept.delete(key);
  else solid = transformSolid(transform, unplaced(entry), () => face);
  kept.set(key, solid);
  if (kept.size > PLACED_KEPT) kept.delete(kept.keys().next().value as string);
  return solid;
}

const tidy = (v: Vec3): Vec3 => [v[0] + 0, v[1] + 0, v[2] + 0];

function step(feature: MeshFeature, { state, done, failed, input }: StepContext): Step {
  const entry = input as StoredMesh | undefined;
  if (!entry) return failed('brokenReference', [{ mesh: feature.mesh }], `the document has no stored mesh "${feature.mesh}"`);
  const frame = frameOf(feature.placement.frame, state);
  if (typeof frame === 'string') return failed(frame, [feature.placement.frame]);
  const transform = placementTransform(feature.placement, frame);
  const face = state.faceNames.length;
  const name: FaceName = { feature: feature.id, role: 'mesh' };
  const column = (j: number): Vec3 => tidy([transform.matrix[0][j], transform.matrix[1][j], transform.matrix[2][j]]);
  return {
    state: done(
      { status: 'ok', warnings: [], bodies: [feature.id], facts: { origin: tidy(transform.translation), axisX: column(0), axisY: column(1), axisZ: column(2) } },
      {
        bodies: { ...state.bodies, [feature.id]: placed(entry, transform, face, feature.id) },
        faceNames: [...state.faceNames, name],
        faceInfos: [...state.faceInfos, FACE],
        faceIds: new Map([...state.faceIds, [faceKey(name), face]]),
      },
    ),
  };
}

export const mesh: FeatureModule<MeshFeature> = {
  info: {
    title: 'Mesh',
    summary:
      'A stored mesh (the section `meshes`) placed as a body: a bought or given part to design around. `placement` lays the origin and the axes of the mesh on a frame (a base plane, a plane feature, a planar face, or a sketch point: the frame of its sketch moved to the point), turned by rx, ry, rz about the X axis, the Y axis and the normal of the frame and shifted by x, y, z in it. ' +
      'The body has the ID of the feature and one face without edges: no sketch stands on it, nothing of it is projected, and no extrusion or hole may have it as a target. It takes part in the collisions, the gap, the mass and the exports like any body; make a bought part a reference part in the same batch (setBodyProperties with `use: "reference"` and its `mass`).',
    fields: PLACEMENT_FIELDS,
    bodies: 'self',
  },
  validate: meshFeature,
  refs: (f) => [{ path: 'mesh', id: f.mesh, kind: 'mesh' }, ...frameRefs(f.placement.frame, 'placement/frame')],
  createsBody: (_f, local) => local === undefined,
  namesFaces: true,
  producesTool: () => false,
  patch: { fields: ['mesh', 'placement'], removable: (_f, path) => path.length === 2 && path[0] === 'placement' && (NUMBERS as readonly string[]).includes(path[1]) },
  input: (f, doc) => (has(doc.meshes, f.mesh) ? doc.meshes[f.mesh] : undefined),
  step,
};

// The query `mass` (D41): the mass, the centre of mass and the inertia of one body or of several
// taken as one rigid piece, from the volume and a density.
import type { Id, Solid, Vec3 } from '../types';
import { cross3, dot3, has, len3, mul3, sub3 } from '../util';
import type { ArgSpecs } from './args';
import { type QueryContext, QueryFailure, type QuerySpec } from './spec';

// ---------------------------------------------------------------- the arguments

const DENSITY = { title: 'Density', unit: 'g/cm3', min: { value: 0, open: true } } as const;

// - `bodies`: the bodies taken as one rigid piece (a link of a mechanism); one body is a list of
//   one. A body named twice counts once.
// - `densities`: the density of single bodies, by body ID. It wins over everything else and is
//   taken as it is (an effective density).
// - `density`: the density of every listed body that has none of its own: none in `densities`
//   and none in the document (`massSourceOf`).
// - `fill`: the part of the volume that is material, for a printed part with infill. It goes
//   with `density`: the mass and the inertia of the bodies that take `density` are multiplied by
//   it, and no other body is touched (a motor given in `densities`, a body with a density or
//   a mass of its own). A `fill` other than 1 that applies to no listed body is refused and not
//   ignored: the caller meant it for something. It assumes the material is spread evenly, which
//   a part with solid shells and a sparse core is not; an effective density measured on a printed
//   sample is better.
// - `about`: an axis (`AxisRef`); the answer then also has the moment of inertia about it.
export const MASS_ARGS = {
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'Taken together as one rigid piece.' },
  density: { kind: 'number', title: 'Density', summary: 'Of every listed body that has none of its own.', optional: true, spec: DENSITY },
  densities: { kind: 'record', keys: 'body', of: { kind: 'number', spec: DENSITY }, title: 'Density by body', summary: 'Of single bodies; taken as it is, before `density`.', optional: true },
  fill: {
    kind: 'number',
    title: 'Fill factor',
    summary: 'The part of the volume that is material; 1 is solid. It applies to the bodies that take `density`, and assumes the material is spread evenly: for a print with solid shells give an effective density instead.',
    optional: true,
    spec: { title: 'Fill factor', unit: 'none', min: { value: 0, open: true }, max: { value: 1 }, default: 1 },
  },
  about: { kind: 'axis', title: 'Axis', summary: 'Adds the moment of inertia about this axis.', optional: true },
} as const satisfies ArgSpecs;

// ---------------------------------------------------------------- the result

// Lengths are millimetres and masses grams, so an inertia is in g·mm². (For a robot description
// in kilograms and metres: 1 g·mm² is 1e-9 kg·m².)
// - `mass`, `volume`: of all listed bodies together. Bodies that overlap are counted twice;
//   `interference` says whether they do.
// - `centerOfMass`: in the coordinates of the model (and of the pose the query is asked about).
// - `inertia`: the inertia tensor about the centre of mass, in the axes of the model, as three
//   rows. The diagonal holds the moments about lines through the centre of mass along X, Y and
//   Z; an element off the diagonal is the negative product of inertia (row x, column y:
//   −∫ x·y dm), which is the convention of URDF and MJCF.
// - `about`, with the argument: `moment` is the moment of inertia about that axis; `distance`
//   is the perpendicular distance of the centre of mass from it. (It is not the lever of the
//   weight: that also depends on the direction of gravity. A centre of mass straight above
//   a horizontal axis is at a distance and has no lever.)
// - `bodies`: every listed body by itself: its mass, its volume, the density of its material
//   (before the fill factor; for a body with an explicit mass, that mass over its volume), the
//   fill factor that was applied to it (1 when none was) and its centre of mass. In the units
//   of the answer, mass (g) = density (g/cm3) × fill × volume (mm3) / 1000.
export interface MassProperties {
  mass: number; // g
  volume: number; // mm3
  centerOfMass: Vec3; // mm
  inertia: [Vec3, Vec3, Vec3]; // g·mm2
  about?: { moment: number; distance: number }; // g·mm2, mm
  bodies: { body: Id; mass: number; volume: number; density: number; fill: number; centerOfMass: Vec3 }[];
}

declare module './spec' {
  interface Queries {
    mass: { spec: typeof MASS_ARGS; result: MassProperties };
  }
}

// ---------------------------------------------------------------- the pass over triangles

// The second moments of a volume: ∫ x·x, y·y, z·z, x·y, y·z, z·x.
type Second = [number, number, number, number, number, number];
const PAIRS: readonly [number, number][] = [[0, 0], [1, 1], [2, 2], [0, 1], [1, 2], [2, 0]];

// The integrals of a closed mesh for a density of one: its volume (mm3), its centroid (mm) and
// its second moments about the centroid (mm5).
// - They are summed by signed tetrahedra, as `volumeOf` in solid.ts sums the volume, but from
//   a vertex of the mesh and not from the origin of the model, and the second moments are then
//   moved to the centroid. A body far from the origin therefore loses no digits: every number
//   summed is of the size of the body, not of its distance.
// - They scale with a density, and a group is put together from its bodies by the parallel axis
//   theorem (`together`).
export interface MassIntegrals {
  volume: number;
  centroid: Vec3;
  central: Second;
}
export function massIntegrals(solid: Solid): MassIntegrals {
  const { positions: p, triangles } = solid;
  const from: Vec3 = p.length >= 3 ? [p[0], p[1], p[2]] : [0, 0, 0];
  const at = (i: number): Vec3 => [p[3 * i] - from[0], p[3 * i + 1] - from[1], p[3 * i + 2] - from[2]];
  let volume = 0;
  const first: Vec3 = [0, 0, 0];
  const second: Second = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [at(triangles[t]), at(triangles[t + 1]), at(triangles[t + 2])];
    // six times the signed volume of the tetrahedron of the triangle and `from`
    const det = dot3(a, cross3(b, c));
    const sum: Vec3 = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
    volume += det / 6;
    // over a tetrahedron with one corner at zero: ∫ x_i = V·(sum_i) / 4 and
    // ∫ x_i·x_j = V·(a_i·a_j + b_i·b_j + c_i·c_j + sum_i·sum_j) / 20
    for (let k = 0; k < 3; k++) first[k] += (det / 24) * sum[k];
    PAIRS.forEach(([i, j], k) => {
      second[k] += (det / 120) * (a[i] * a[j] + b[i] * b[j] + c[i] * c[j] + sum[i] * sum[j]);
    });
  }
  if (!(volume > 0)) return { volume, centroid: from, central: [0, 0, 0, 0, 0, 0] };
  const offset: Vec3 = [first[0] / volume, first[1] / volume, first[2] / volume];
  return {
    volume,
    centroid: [from[0] + offset[0], from[1] + offset[1], from[2] + offset[2]],
    central: PAIRS.map(([i, j], k) => second[k] - volume * offset[i] * offset[j]) as Second,
  };
}

// Pieces as one: the mass, the centre of mass and the second moments about that centre. A piece
// is its integrals and what a cubic millimetre of it weighs.
function together(pieces: readonly { unit: MassIntegrals; perVolume: number }[]): { mass: number; center: Vec3; central: Second } {
  let mass = 0;
  const weighted: Vec3 = [0, 0, 0];
  for (const { unit, perVolume } of pieces) {
    const own = perVolume * unit.volume;
    mass += own;
    for (let k = 0; k < 3; k++) weighted[k] += own * unit.centroid[k];
  }
  const center: Vec3 = [weighted[0] / mass, weighted[1] / mass, weighted[2] / mass];
  const central: Second = [0, 0, 0, 0, 0, 0];
  for (const { unit, perVolume } of pieces) {
    const own = perVolume * unit.volume;
    const away = sub3(unit.centroid, center);
    PAIRS.forEach(([i, j], k) => {
      central[k] += perVolume * unit.central[k] + own * away[i] * away[j];
    });
  }
  return { mass, center, central };
}

// The inertia tensor from the second moments about the same point: the moment about X is what
// lies away from X (y·y + z·z), and off the diagonal stands the negative product.
function tensor([xx, yy, zz, xy, yz, zx]: Second): [Vec3, Vec3, Vec3] {
  return [
    [yy + zz, -xy, -zx],
    [-xy, zz + xx, -yz],
    [-zx, -yz, xx + yy],
  ];
}

// ---------------------------------------------------------------- where the density comes from

// What the document says about the mass of a body: a density, or an explicit mass for a bought
// part with a data sheet. The seam with body properties (package 3a of D36): today no body has
// anything of its own and this is undefined for every body; 3a makes it read its section of the
// document. It reads the document, not the geometry of a body, so the state of the context is
// the right place. With an explicit mass the body counts with the density that gives it that
// mass, spread evenly. `fill` of the call applies to neither kind.
export type MassSource = { density: number } | { mass: number };
export function massSourceOf(_context: QueryContext, _body: Id): MassSource | undefined {
  return undefined;
}

// ---------------------------------------------------------------- the entry

const GRAMS_PER_MM3 = 1e-3; // a density in g/cm3 times this is in g/mm3

export const mass: QuerySpec<typeof MASS_ARGS, MassProperties> = {
  title: 'Mass properties',
  summary:
    'Mass, centre of mass and inertia of one body or of several taken as one rigid piece, from the volume and a density. Until bodies have a material of their own the density is given here: `density` for all, `densities` by body. A fill factor scales a printed part with infill.',
  returns:
    '`mass` (g), `volume` (mm3), `centerOfMass` (mm, model coordinates), `inertia` (g·mm2; the tensor about the centre of mass in the axes of the model, three rows; off the diagonal the negative products of inertia, as URDF writes them; 1 g·mm2 = 1e-9 kg·m2), ' +
    '`about` (with an axis: `moment` in g·mm2 and `distance`, the perpendicular distance of the centre of mass from the axis in mm; not the lever of the weight, which depends on the direction of gravity), ' +
    '`bodies` (each body with its `mass`, `volume`, the `density` of its material in g/cm3, the `fill` factor applied to it and its `centerOfMass`; mass in g = density × fill × volume in mm3 / 1000). Bodies that overlap are counted twice.',
  args: MASS_ARGS,
  significant: { mass: 6, inertia: 6, moment: 6 },
  units: { mass: 'g', volume: 'mm3', density: 'g/cm3', centerOfMass: 'mm', inertia: 'g·mm2', moment: 'g·mm2', distance: 'mm' },
  run(context, args) {
    const pieces: { unit: MassIntegrals; perVolume: number }[] = [];
    const bodies: MassProperties['bodies'] = [];
    // a body named twice counts once
    for (const id of new Set(args.bodies)) {
      const solid = context.bodies[id].solid; // from the context: the same code answers for a pose
      // one pass over the triangles, remembered by the mesh
      const unit = context.memo([solid], 'integrals', () => massIntegrals(solid));
      if (!(unit.volume > 0)) throw new QueryFailure('failed', `the body "${id}" has no volume`, ['bodies', args.bodies.indexOf(id)]); // the place in the argument, not in the set
      // Whose density: the call's by body, then the body's own, then the call's for all. An own
      // key of the record only: a body may have an ID that every object has by inheritance.
      const named = args.densities !== undefined && has(args.densities, id) ? { density: args.densities[id] } : undefined;
      const own = named ?? massSourceOf(context, id);
      const source = own ?? (args.density === undefined ? undefined : { density: args.density });
      if (!source) throw new QueryFailure('invalidArguments', `density: the body "${id}" has no density of its own: give \`density\`, or its density in \`densities\``, ['density']);
      const density = 'mass' in source ? source.mass / unit.volume / GRAMS_PER_MM3 : source.density; // g/cm3, of the material
      const fill = own ? 1 : args.fill; // the fill factor goes with the fallback `density` only
      const perVolume = density * GRAMS_PER_MM3 * fill; // g per mm3
      pieces.push({ unit, perVolume });
      bodies.push({ body: id, mass: perVolume * unit.volume, volume: unit.volume, density, fill, centerOfMass: [...unit.centroid] });
    }
    // a fill factor that reached no body was meant for something: say so instead of ignoring it
    if (args.fill !== 1 && bodies.every((body) => body.fill === 1)) {
      throw new QueryFailure('invalidArguments', 'fill: the fill factor applies to the bodies that take `density`, and none of the listed bodies does: give their densities as effective ones', ['fill']);
    }
    const whole = together(pieces);
    const inertia = tensor(whole.central);
    const result: MassProperties = { mass: whole.mass, volume: bodies.reduce((sum, body) => sum + body.volume, 0), centerOfMass: whole.center, inertia, bodies };
    if (!args.about) return result;
    const axis = context.axis(args.about); // a base axis or a sketch point: never posed
    if ('problem' in axis) throw new QueryFailure('notAvailable', 'about: the axis is not in the state asked about', ['about']);
    // About a line: the moment about the parallel line through the centre of mass, and the mass
    // times the square of the distance between the two (the parallel axis theorem).
    const along = mul3(axis.direction, 1 / len3(axis.direction));
    const through = dot3(along, [dot3(inertia[0], along), dot3(inertia[1], along), dot3(inertia[2], along)]);
    const distance = len3(cross3(sub3(whole.center, axis.origin), along));
    return { ...result, about: { moment: through + whole.mass * distance * distance, distance } };
  },
};

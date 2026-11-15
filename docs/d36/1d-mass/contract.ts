// Contract of package 1d of D36 (decision D41): mass properties of bodies. A draft, only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). The design is design.md.

import type { Id, Solid, Vec3 } from '../../../packages/engine/src/index';
import type { ArgSpecs, QuantitySpec, QueryContext } from '../00-prep/contract';
import type { ResultUnits } from '../1b-measure/contract';

// ---------------------------------------------------------------- the arguments

const DENSITY = { title: 'Density', unit: 'g/cm3', min: { value: 0, open: true } } as const satisfies QuantitySpec;

// - `bodies`: the bodies taken as one rigid piece (a link of a mechanism); one body is a list of
//   one.
// - `densities`: the density of single bodies, by body ID. It wins over everything else.
// - `density`: the density of every listed body that has none of its own: none in `densities`
//   and, once body properties exist (3a), none in the document.
// - `fill`: the part of the volume that is material, for a printed part with infill: the mass
//   and the inertia are multiplied by it. It assumes the material is spread evenly, which a part
//   with solid shells and a sparse core is not; an effective density measured on a printed
//   sample is better.
// - `about`: an axis (`AxisRef`); the answer then also has the moment of inertia about it.
export const MASS_ARGS = {
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'Taken together as one rigid piece.' },
  density: { kind: 'number', title: 'Density', summary: 'Of every listed body that has none of its own.', optional: true, spec: DENSITY },
  densities: { kind: 'record', keys: 'body', of: { kind: 'number', spec: DENSITY }, title: 'Density by body', optional: true },
  fill: { kind: 'number', title: 'Fill factor', summary: 'The part of the volume that is material; 1 is solid.', optional: true, spec: { title: 'Fill factor', unit: 'none', min: { value: 0, open: true }, max: { value: 1 }, default: 1 } },
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
//   is how far the centre of mass lies from it (the lever of the weight when the axis is
//   horizontal).
// - `bodies`: every listed body by itself, with the density that was used for it.
export interface MassProperties {
  mass: number; // g
  volume: number; // mm3
  centerOfMass: Vec3; // mm
  inertia: [Vec3, Vec3, Vec3]; // g·mm2
  about?: { moment: number; distance: number }; // g·mm2, mm
  bodies: { body: Id; mass: number; volume: number; density: number; centerOfMass: Vec3 }[];
}

declare module '../00-prep/contract' {
  interface Queries {
    mass: { spec: typeof MASS_ARGS; result: MassProperties };
  }
}
export const MASS_UNITS = { mass: 'g', volume: 'mm3', density: 'g/cm3', centerOfMass: 'mm', inertia: 'g·mm2', moment: 'g·mm2', distance: 'mm' } as const satisfies ResultUnits;

// ---------------------------------------------------------------- the pass over triangles

// The integrals of a closed mesh for a density of one, by signed tetrahedra from the origin, as
// `volumeOf` in solid.ts sums the volume: the volume (mm3), the first moments (mm4) and the six
// second moments about the origin (mm5: xx, yy, zz, xy, yz, zx). They add up over bodies and
// scale with a density, so a group is the sum of its bodies; the tensor about the centre of mass
// follows by the parallel axis theorem. Remembered by the mesh.
export interface MassIntegrals {
  volume: number;
  first: Vec3;
  second: [number, number, number, number, number, number];
}
export declare function massIntegrals(solid: Solid): MassIntegrals;

// ---------------------------------------------------------------- where the density comes from later

// The seam with body properties (3a). Today no body has anything of its own and this returns
// undefined for every body; the package of 3a makes it read its section of the document (a
// density, or an explicit mass for a bought part with a data sheet). It reads the document, not
// the geometry of a body, so the state of the context is the right place. With an explicit mass
// the body counts with the density that gives it that mass, spread evenly, and `fill` does not
// apply to it.
export type MassSource = { density: number } | { mass: number };
export declare function massSourceOf(context: QueryContext, body: Id): MassSource | undefined;

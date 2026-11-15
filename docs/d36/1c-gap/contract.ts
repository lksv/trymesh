// Contract of package 1c of D36 (decision D40): the smallest gap between bodies. A draft, only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). The design is design.md.

import type { Id, Solid, SolidKernel, Vec3 } from '../../../packages/engine/src/index';
import type { ArgSpecs, FaceNameAfter, Truncated } from '../00-prep/contract';
import type { ResultUnits } from '../1b-measure/contract';

// ---------------------------------------------------------------- the kernel port

// One method is added to `SolidKernel` in types.ts. A draft cannot edit that file, so the port
// after this package is written as a type of its own; in the code it is one line of the
// interface. The ports lie between the section comments `// --- porty` and `// --- přepočet`,
// the part `describe_api` leaves out: an AI learns what the gap means from the description of
// the query, not from the port.
//
// What an implementation guarantees:
// 1. The value is the smallest distance between a point of the surface of `a` and a point of the
//    surface of `b`, of the two meshes as they are given, when that distance is below `within`.
//    When no two points are closer than `within`, the value is `within` itself: the caller reads
//    a result equal to `within` as "not within".
// 2. It is zero when the two solids touch or share a volume, and it does not tell the two apart.
//    A solid that lies wholly inside the material of the other shares a volume with it: zero.
//    A solid that lies in a cavity of the other has the distance to the wall of the cavity.
// 3. It measures the meshes, without a tolerance: a round face is its polygon, and two faces
//    a millionth apart are a millionth apart. What counts as touching is the caller's decision.
// 4. An empty solid is at `within` from everything.
// 5. `within` is finite and above zero, otherwise the method throws. A solid the kernel cannot
//    take (not closed, turned inside out) throws as it does for `boolean`.
// 6. The same input gives the same output. With `a` and `b` swapped the last digit may differ.
// 7. The cost grows with `within`: the kernel looks at every pair of triangles whose boxes are
//    closer than that.
export interface SolidKernelAfter extends SolidKernel {
  minGap(a: Solid, b: Solid, within: number): number;
}

// ---------------------------------------------------------------- the query

// - `bodies`: only pairs among these; without it every pair of bodies of the state. One pair is
//   asked by naming its two bodies.
// - `within`: the search distance. Pairs further apart are counted, not measured; raising it
//   costs time (see the port). 5 mm by default: the gaps a printed assembly is checked for are
//   below that.
// - `maxPairs`: the most pairs the answer lists, the closest first.
export const GAP_ARGS = {
  bodies: { kind: 'list', of: { kind: 'body' }, min: 2, title: 'Bodies', summary: 'Only pairs among these; without it all bodies.', optional: true },
  within: { kind: 'number', title: 'Search distance', summary: 'Pairs further apart than this are counted, not measured. A larger distance takes longer.', optional: true, spec: { title: 'Search distance', unit: 'mm', min: { value: 0, open: true }, default: 5 } },
  maxPairs: { kind: 'number', title: 'Most pairs', optional: true, spec: { title: 'Most pairs to list', unit: 'count', integer: true, min: { value: 1 }, default: 50 } },
} as const satisfies ArgSpecs;

// A pair of bodies closer than `within`; `a` is the smaller ID in string order, as in the
// report of collisions.
// - `distance`: of the two meshes. Zero for a pair that touches or shares a volume; a distance
//   no larger than the precision of the coordinates (a millionth of the largest coordinate of
//   the pair, as for collisions) is reported as zero.
// - `contact`, for a distance of zero, from the query `interference` over the same pair:
//   `collision` (they share a volume above its threshold), `fit` (round faces within the chord
//   tolerance of each other), `touching` (neither: flush faces, or less than that query
//   reports), `unknown` (the kernel could not compute what they share).
// - `between`, for a distance above zero: the two points the gap lies between, `a` on the body
//   `a`, and the face each lies on. Where a point lies on an edge or a corner, the face named is
//   the one that faces the other body most directly.
// - `accuracy`, with `between`: how far the distance of the meshes may be from that of the
//   exact shapes: the chord tolerance of the document for each of the two faces that is not
//   planar.
export interface Gap {
  a: Id;
  b: Id;
  distance: number; // mm
  contact?: 'touching' | 'fit' | 'collision' | 'unknown';
  between?: { a: Vec3; b: Vec3; faceA: FaceNameAfter; faceB: FaceNameAfter };
  accuracy?: number; // mm
}
// - `pairs`: the pairs closer than `within`, the closest first, at most `maxPairs` of them.
// - `apart`: the number of pairs further apart than `within` (not measured beyond that).
// - `failed`: pairs the kernel refused; they are neither close nor apart.
// - `checked`: the number of pairs examined: `pairs` before the limit, `apart` and `failed`.
export interface GapReport extends Truncated {
  within: number;
  pairs: Gap[];
  apart: number;
  failed: { a: Id; b: Id; message: string }[];
  checked: number;
}

declare module '../00-prep/contract' {
  interface Queries {
    gap: { spec: typeof GAP_ARGS; result: GapReport };
  }
}
export const GAP_UNITS = { distance: 'mm', accuracy: 'mm', within: 'mm' } as const satisfies ResultUnits;

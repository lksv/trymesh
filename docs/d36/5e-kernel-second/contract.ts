// Contract of package 5e of D36 (decision D50): a second opinion of the kernel for a pair of
// bodies whose intersection the adapter refuses. A draft, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and states what
// the package adds or changes. The design is design.md; the calls are calls.ts.
//
// First version, before its review.
//
// Three things change: the kernel port gets one member, the answer about one pair
// (`sharedBy` of `interference.ts`) carries what the second opinion measured, and the report of
// the collisions says which pairs it cleared.

import type { BodyResult, Id, Solid, SolidKernel } from '../../../packages/engine/src/index';

// ---------------------------------------------------------------- the kernel port

// A mesh the kernel computed and did not verify. The field is named so that reading it says what
// the reader takes on: the mesh is measured (a volume, a depth), and is never a body of the
// model, the input of another operation of the kernel, or something an export writes.
// It lives with the ports in `types.ts`, between the section comments `// --- porty` and
// `// --- přepočet`, the part `describe_api` leaves out.
export interface ComputedMesh {
  unverified: Solid;
}

// One member is added to `SolidKernel`. In the code it is one line of the interface, in method
// syntax like `boolean`; the draft merges it into the interface of the engine and declares it as
// a property, by the rule of the plan for an addition to a port (a second declaration of the
// name with another type is then an error, where two methods would merge as overloads). The
// merge changes `SolidKernel` for every draft checked together with this one, as `minGap` of the
// contract of 1c does (the variant of 1c that was not taken; it is in this program and not in the
// code): a draft that builds a kernel as an object literal has to give it both.
//
// `intersectionAsComputed(a, b)`: what the two solids share, as the kernel computes it, for
// measuring only.
//
// What an implementation guarantees:
// 1. The mesh is the common part of the two solids as the kernel computed it. Nothing is done to
//    it afterwards: no faces are moved before, nothing is welded, dropped, split or checked
//    after.
// 2. It is closed by its indices (every edge in exactly two triangles, once each way) and its
//    pieces are oriented outwards, so its volume is defined and is not negative. Two solids
//    that share nothing give a mesh without triangles.
// 3. Every triangle carries the number of the face of `a` or of `b` it comes from (guarantee 2
//    of `boolean`).
// 4. The same input gives the same output (guarantee 4 of `boolean`).
// 5. It throws for an input `boolean` throws for (a mesh that is not closed or is turned inside
//    out, face numbers that do not fit) and when the library reports an error. It does not throw
//    because the result could not be verified: there is no verification.
//
// What it does not guarantee, and `boolean` does:
// - That the mesh is a solid. It may hold vertices at one place that are not joined, triangles
//   without an area, sheets without thickness where faces of the two solids coincide, slivers
//   thinner than the precision of the coordinates, and pieces that touch along an edge or at
//   a vertex.
// - Any tolerance for faces in one plane (guarantee 3 of `boolean`): flush faces may leave
//   a sheet or a sliver of noise. What that noise counts as is the caller's decision.
// - That another operation of the kernel takes it. The adapter of Manifold would load such a mesh
//   without an error and silently drop a part of it (docs/architecture/ports.md, step 7).
//
// A kernel whose `boolean('intersection', a, b)` is exact (a B-rep kernel) may return that
// result here: it has every guarantee above. A fake of a test that wraps a kernel passes the
// member on; a fake without a kernel behind it throws, as its `boolean` does.
declare module '../../../packages/engine/src/types' {
  interface SolidKernel {
    intersectionAsComputed: (a: Solid, b: Solid) => ComputedMesh;
  }
}

// ---------------------------------------------------------------- one pair

// What was measured of what two bodies share: `Shared` of `interference.ts` as it is today,
// stated here because the second opinion is the same measure of another mesh.
export interface Measured {
  volume: number; // mm³, the absolute value
  depth: number; // mm, see `depthOf` of interference.ts
  planar: number; // the part of the depth that planar faces reach into each other
  round: boolean; // what they share has a face that is not planar
  slack: number; // how precisely a depth is known (`coordinatePrecision` of the pair)
}

// What one pair is, by one measure. The rule is the one `interferenceReport` has today, cut out
// as a function so that the answer of the adapter and the second opinion cannot be judged by two
// rules:
// - `nothing`: the volume is at most `threshold`, or the depth at most `slack`;
// - `fit`: otherwise, when what they share has a round face, no planar face reaches into
//   a planar face further than `slack`, and the depth is at most `tolerance + slack`;
// - `collision`: otherwise.
export type Verdict = 'nothing' | 'fit' | 'collision';
export declare function verdictOf(measured: Measured, threshold: number, tolerance: number): Verdict;

// The answer of `sharedBy` about one pair of meshes, as it is remembered by the two meshes
// (`context.memo`). It does not depend on the threshold of a call.
// - A measure: `boolean('intersection')` answered and its result was measured. The second
//   opinion was not asked.
// - A message: the pair has no verified answer. `asComputed` is there when `boolean` threw, the
//   kernel then returned the intersection as computed and that mesh could be measured. Without
//   it the pair is failed whatever the threshold: the second call threw too, its mesh had
//   a volume that is not a number, or it was the adapter's own answer that could not be measured
//   (then the second opinion is not asked).
export type SharedVolumeAfter = Measured | { message: string; asComputed?: Measured };
export declare function sharedBy(kernel: SolidKernel, a: BodyResult, b: BodyResult, tolerance: number): SharedVolumeAfter;

// ---------------------------------------------------------------- the report

// `InterferenceReport` gets one optional list.
// - `cleared`: the pairs the kernel refused and its intersection as computed shows to be no
//   collision, in the order of the report. Such a pair shares nothing (it is in no other list)
//   or is a fit (it is in `fits` as well, with the volume and the depth measured on the mesh as
//   computed). The list is there only when it has an entry, so the answer for a model without
//   a refused pair is the answer of today, field for field.
// - `pairs`: unchanged, and never from the second opinion. A pair is a collision only by a mesh
//   the kernel verified.
// - `failed`: a pair the kernel refused and the second opinion did not clear, or that has no
//   second opinion. Neither colliding nor clear, as today. When the mesh as computed was
//   measured, the message says what it measured after the reason of the refusal (`failedMessage`).
declare module '../../../packages/engine/src/types' {
  interface InterferenceReport {
    cleared?: { a: Id; b: Id }[];
  }
}

// The message of a failed pair that has a second opinion: the reason of the refusal, then what
// the mesh as computed measures, said as what it is.
// "<reason>; as computed the two share 12.3 mm³, 0.52 mm deep, which the kernel could not verify"
export declare function failedMessage(reason: string, asComputed: Measured): string;

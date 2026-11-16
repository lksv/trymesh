// Contract of package 5e of D36 (decision D50): a second opinion of the kernel for a pair of
// bodies whose intersection the adapter refuses. A draft, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and states what
// the package adds or changes. The design is design.md; the calls are calls.ts.
//
// Third version, after two rounds of review (design.md, "Reviews").
//
// Four things change: the kernel port gets one member, the answer about one pair (`sharedBy` of
// `interference.ts`) carries what the second opinion measured, the report of the collisions
// lists the pairs it cleared, and the report of the gap names the pairs whose answer went through
// one of those.

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
//    it afterwards: no faces are moved before, nothing is welded, dropped, split or repaired
//    after.
// 2. What the two solids share is in the mesh: every part of their common volume that is thicker
//    than the precision of their coordinates (a millionth of the largest coordinate of the two
//    solids, and of a millimetre at least). The mesh may hold more than they share (see below);
//    it does not hold less. A caller that clears a pair of bodies by this mesh trusts this, and
//    so does the measure of how far one body reaches into the other (`penetration` of solid.ts),
//    which looks only at points of the mesh.
// 3. It is closed by its indices: every edge is in exactly two triangles, once each way. So every
//    connected piece has a volume. Two solids that are apart give a mesh without triangles.
// 4. Every triangle carries the number of the face of `a` or of `b` it comes from (guarantee 2
//    of `boolean`).
// 5. The same input gives the same output (guarantee 4 of `boolean`).
// 6. It throws for an input `boolean` throws for (a mesh that is not closed or is turned inside
//    out, face numbers that do not fit), when the library reports an error, and when the mesh
//    would not keep guarantee 3. It does not throw because the mesh is not clean.
//
// What it does not guarantee, and `boolean` does:
// - That the mesh is a solid. It may hold vertices at one place that are not joined, triangles
//   without an area, sheets without thickness where faces of the two solids coincide, slivers
//   thinner than the precision of the coordinates, pieces that touch along an edge or at
//   a vertex, and pieces that are inside out (a piece of noise with a volume a little below
//   zero). Two solids that only touch may give triangles that enclose nothing.
// - Any tolerance for faces in one plane (guarantee 3 of `boolean`): flush faces may leave
//   a sheet or a sliver of noise. What that noise counts as is the caller's decision.
// - That another operation of the kernel takes it. The adapter of Manifold would load such a mesh
//   without an error and silently drop a part of it (docs/architecture/ports.md, step 7).
// - That the answer is the same with `a` and `b` swapped. (Nor is the refusal of `boolean`: the
//   adapter refuses some pairs given one way and answers them given the other.)
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
// - `volume` of a mesh the kernel verified is the absolute value of the volume of the whole, as
//   today. Of a mesh as computed it is the sum of the volumes of its connected pieces, each
//   without its sign: a piece of noise that is inside out must not subtract from what is shared.
// - Everything else is measured the same way for both.
export interface Measured {
  volume: number; // mm³
  depth: number; // mm, see `depthOf` of interference.ts
  planar: number; // the part of the depth that planar faces reach into each other
  round: boolean; // what they share has a face that is not planar
  slack: number; // how precisely a depth is known (`coordinatePrecision` of the pair)
}

// The volume of a mesh piece by piece (solid.ts, beside `thickestPiece`, whose pieces it uses).
export declare function volumeOfPieces(solid: Solid): number;

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
//   kernel then returned the intersection as computed (asked with the two bodies in the same
//   order) and that mesh was measured. Without it the pair is failed whatever the threshold: the
//   second call threw too, its mesh had a volume that is not a number or more triangles than the
//   measure of a second opinion takes on (`SECOND_OPINION_TRIANGLES`), or it was the adapter's
//   own answer that could not be measured (then the second opinion is not asked).
export type SharedVolumeAfter = Measured | { message: string; asComputed?: Measured };
export declare function sharedBy(kernel: SolidKernel, a: BodyResult, b: BodyResult, tolerance: number): SharedVolumeAfter;

// The most triangles of a mesh as computed that the second opinion measures. The search for
// sheets in `depthOf` grows with the square of the triangles of a piece; above the bound the pair
// stays failed, which is always allowed, and its message says after the reason of the refusal
// that the mesh as computed was not measured, with the bound. The number comes from
// a measurement of the implementation and lies above every mesh the tests pin (the meshes of the
// design had 854 to 7,452 triangles).
export declare const SECOND_OPINION_TRIANGLES: number;

// ---------------------------------------------------------------- the report of the collisions

// A pair the kernel refused and its intersection as computed shows to be no collision.
// - `kind`: what the mesh as computed measures as, by `verdictOf` with the threshold of the
//   call: `nothing` (the pair shares nothing, or only touches) or `fit` (round faces that
//   overlap no deeper than the chord tolerance).
// - `volume`, `depth`: of the mesh as computed, as for an entry of `fits`. A tool that rounds
//   the entries of `pairs` and `fits` rounds these the same way.
// The pair is clear. What it rests on was not verified by the kernel, and the kind is less sure
// than that of a verified pair (flush faces far from the origin have measured as a fit).
export interface Cleared {
  a: Id; // the smaller ID, as in the other lists
  b: Id;
  kind: 'nothing' | 'fit';
  volume: number; // mm³
  depth: number; // mm
}

// `InterferenceReport` gets one optional list.
// - `cleared`: in the order of the report. It is there only when it has an entry, so the answer
//   for a model without a refused pair is the answer of today, field for field.
// - `pairs` and `fits`: unchanged, and never from the second opinion. A pair is in either only
//   by a mesh the kernel verified.
// - `failed`: a pair the kernel refused and the second opinion did not clear, or that has no
//   second opinion. Neither colliding nor clear, as today. When the mesh as computed was
//   measured, the message says what it measured after the reason of the refusal (`failedMessage`).
declare module '../../../packages/engine/src/types' {
  interface InterferenceReport {
    cleared?: Cleared[];
  }
}

// The message of a failed pair that has a second opinion: the reason of the refusal as the
// kernel gave it, then what the mesh as computed measures, said as what it is, with three
// significant digits.
// "<reason>; as computed the two share 6.04 mm³, 0.0394 mm deep, which the kernel could not verify"
export declare function failedMessage(reason: string, asComputed: Measured): string;

// ---------------------------------------------------------------- the report of the gap

// The gap of 1c asks the collisions about a pair (the kind of a zero; whether one body lies
// inside the other). `GapReport` gets an optional list of the pairs whose answer went through
// a pair the collisions cleared, whether the pair ends at zero, at a distance or apart. It is
// there only when it has an entry, in the order of the bodies in the model. It is not cut by
// `maxPairs` and takes no part in `truncated`: `pairs` is sorted by distance and cut, and a list
// cut in another order could drop the mark of a pair that is shown.
// - A pair cleared as a fit has `contact: 'fit'`; one cleared as nothing has `'touching'` when
//   its surfaces meet and goes on to its distance when they do not.
declare module '../../../packages/engine/src/query/gap' {
  interface GapReport {
    cleared?: { a: Id; b: Id }[];
  }
}
// The drafts of this directory are checked against the report of the gap as the contract of 1c
// states it (the map `Queries` of the drafts names that one), so the same field is merged there.
declare module '../1c-gap/contract' {
  interface GapReport {
    cleared?: { a: Id; b: Id }[];
  }
}

// Interference of bodies: the volume two bodies share, pair by pair (D35, point 5).
import { coordinatePrecision } from './mesh-distance';
import { type Reach, penetration, thickestPiece, volumeOf, volumeOfPieces } from './solid';
import type { BodyResult, Id, InterferenceReport, Solid, SolidKernel } from './types';
import { has } from './util';

// Volumes up to this are noise, not a collision. In the spike flush faces, a pin in the hole cut
// by the same circle and identical cylinders gave exactly zero, and gears with a negative backlash
// of 0.05 mm 0.5 to 1.7 mm³. The kernel has a floor of its own below that: an overlap thinner than
// about a millionth of the size of the two bodies is welded away and counts as touching. Their
// size is the larger of their diagonal and twice their largest coordinate, so for planar faces
// the floor is about two millionths of the largest coordinate of the pair.
// A pin in a hole of the same diameter whose polygon is turned differently shares far more than
// this (slivers at the corners); how deep the bodies reach into each other tells it apart, see
// `report`.
export const INTERFERENCE_THRESHOLD = 0.001; // mm³

// A text that can be a file name on every common file system and still tells one body ID from
// another: letters, digits, dot, dash and underscore stay, every other character is written as %XX
// per byte of its UTF-8 form (`planets/1` is `planets%2F1`). The percent sign is escaped too, so
// two IDs never give the same name. Names that differ only in the case of letters are still
// different names here; a file system that ignores case needs a check by the caller. So does the
// length of the name, and a system with reserved names (`CON`, `NUL` on Windows) is not covered.
export function bodyFileName(body: Id): string {
  let name = '';
  for (const byte of new TextEncoder().encode(body)) {
    const char = String.fromCharCode(byte);
    name += /[A-Za-z0-9._-]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return name;
}

// What was measured of what two bodies share.
export interface Measured {
  volume: number;
  depth: number; // see `depthOf`
  planar: number; // the part of the depth that planar faces reach into each other
  round: boolean; // what they share has a face that is not planar
  slack: number; // how precisely a depth is known
}
const NOTHING: Measured = { volume: 0, depth: 0, planar: 0, round: false, slack: 0 };

// Faces of the two bodies that coincide leave sheets without thickness in their intersection.
// Their two sides have the same coordinates, so they are looked for within a small part of the
// precision of a depth: a real sliver as thin as that precision must keep its surface, or its
// mean thickness comes out many times too large.
const SHEET = 1e-3;

// How deep what two bodies share is: the larger of two measures.
// - How far one body reaches into the other (`penetration`). It finds a real overlap whatever
//   else the pair shares, but it is zero where the two surfaces coincide all around a volume
//   (two identical bodies, an identical part of two bodies).
// - The mean thickness of the thickest connected piece of what they share, twice its volume over
//   its surface. It finds a volume enclosed by coincident surfaces. Sheets would thin a piece
//   out; they are left out of the surface, but only when the depth is at most `limit` without
//   that, since looking for them is the slow part and can only raise the result.
function depthOf(common: Solid, a: Solid, b: Solid, isPlanar: (face: number) => boolean, limit: number, slack: number): Reach {
  const reached = penetration(common, a, b, isPlanar, limit);
  const rough = Math.max(reached.depth, thickestPiece(common));
  return { depth: rough > limit ? rough : Math.max(reached.depth, thickestPiece(common, SHEET * slack)), planar: reached.planar };
}

// The measure of a mesh two bodies share, with its volume handed in (a verified mesh and a mesh
// as computed take it differently). It throws when the volume is not a number.
function measure(common: Solid, volume: number, a: BodyResult, b: BodyResult, tolerance: number): Measured {
  if (!Number.isFinite(volume)) throw new Error('the intersection has a volume that is not a number');
  const planar = new Map([...a.faces, ...b.faces].map((face) => [face.id, face.planar]));
  // coordinates are single precision: a depth is known to about a millionth of the largest coordinate
  const slack = coordinatePrecision(a, b);
  // a face the two lists do not have cannot be called planar
  const isPlanar = (face: number): boolean => planar.get(face) === true;
  const deep = volume > 0 ? depthOf(common, a.solid, b.solid, isPlanar, tolerance + slack, slack) : { depth: 0, planar: 0 };
  return { volume, ...deep, round: common.faceIds.some((id) => planar.get(id) === false), slack };
}

// The most triangles of an intersection as computed that the second opinion measures (D50). The
// measure is the slow part (the search for sheets in `depthOf` grows with the square of the
// triangles of a piece); above the bound the pair stays failed, which is always allowed. Measured
// (2026-11-16): the arm of scenario 13 gives 512 to 888 triangles with the axis of its joint along
// a coordinate axis (0.1 to 0.2 s) and 1,806 to 7,452 askew (0.7 to 2.4 s); the largest
// intersection of two parts of the joint of scenario 9 (the housing and itself turned a little)
// has 9,174 and takes 3.7 s, as much through the kernel's verified answer. The bound lies above
// all of them, so it never changes what the tests pin, and holds a refused pair to about five
// seconds.
export const SECOND_OPINION_TRIANGLES = 12000;

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// What two bodies share. The kernel gives no guarantee for an intersection with flush faces and may
// refuse one (its result is cleaned and verified); then the answer is the reason of the refusal,
// with a second opinion when the kernel's intersection as computed could be measured (D50).
// `tolerance` belongs to the meshes (a document with another chord tolerance has other meshes), so
// the answer for a pair of meshes does not depend on the call and can be kept by the two meshes.
// - The second opinion is asked only when `boolean` threw, with the two bodies in the same order:
//   a pair the kernel answers keeps its answer and its cost.
// - When `boolean` answered with a mesh that cannot be measured, the pair is failed and the second
//   opinion is not asked: a kernel that hands out such a mesh is not asked again.
// - When the second call throws, its mesh cannot be measured or is above the bound, the answer is
//   the reason of the refusal alone (with the bound named when that was the cause).
// - The volume of a verified mesh is the absolute value of the whole (a sliver the cleaning left
//   inside out must not hide as a negative volume); that of a mesh as computed is added piece by
//   piece.
export type SharedVolume = Measured | { message: string; asComputed?: Measured };
export function sharedBy(kernel: SolidKernel, a: BodyResult, b: BodyResult, tolerance: number): SharedVolume {
  let common: Solid;
  try {
    common = kernel.boolean('intersection', a.solid, b.solid);
  } catch (refusal) {
    const message = text(refusal);
    try {
      const mesh = kernel.intersectionAsComputed(a.solid, b.solid).unverified;
      if (mesh.triangles.length / 3 > SECOND_OPINION_TRIANGLES) return { message: `${message}; the intersection as computed has more than ${SECOND_OPINION_TRIANGLES} triangles and was not measured` };
      return { message, asComputed: measure(mesh, volumeOfPieces(mesh), a, b, tolerance) };
    } catch {
      return { message };
    }
  }
  try {
    return measure(common, Math.abs(volumeOf(common)), a, b, tolerance);
  } catch (error) {
    return { message: text(error) };
  }
}

// What one pair is, by one measure: the rule of the report, for the answer of the kernel and for
// the second opinion alike.
// - `nothing`: a volume at most the threshold, or no deeper than the precision of the coordinates
//   (noise of flush faces, whatever its size: large flush faces of turned copies share
//   a fraction of a mm³).
// - `fit`: otherwise, when neither body reaches deeper into the other than `tolerance` (the chord
//   tolerance of the document), what they share has a round face and no planar face of one body
//   reaches into a planar face of the other further than the polygon of a round face next to it
//   explains.
// - `collision`: otherwise; see InterferenceReport.
export type Verdict = 'nothing' | 'fit' | 'collision';
export function verdictOf(measured: Measured, threshold: number, tolerance: number): Verdict {
  if (!(measured.volume > threshold && measured.depth > measured.slack)) return 'nothing';
  return measured.round && measured.planar <= measured.slack && measured.depth <= tolerance + measured.slack ? 'fit' : 'collision';
}

// Three significant digits, without an exponent for the sizes a model has.
const digits = (value: number): string => String(Number(value.toPrecision(3)));

// The message of a refused pair whose intersection as computed measures as a collision: the
// reason of the refusal as the kernel gave it, then what was measured, said as what it is.
export function failedMessage(reason: string, asComputed: Measured): string {
  return `${reason}; as computed the two share ${digits(asComputed.volume)} mm³, ${digits(asComputed.depth)} mm deep, which the kernel could not verify`;
}

// The arguments as the method `Engine.interference` takes them: a mistake of the caller throws.
export function checkInterferenceOptions(bodies: Record<Id, BodyResult>, chosen: unknown, threshold: unknown): void {
  if (threshold !== undefined && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0)) throw new Error('interference: the threshold is a volume in mm³, zero or more');
  if (chosen !== undefined && (!Array.isArray(chosen) || chosen.some((id) => typeof id !== 'string'))) throw new Error('interference: bodies is a list of body IDs');
  for (const id of (chosen as Id[] | undefined) ?? []) if (!has(bodies, id)) throw new Error(`interference: the body "${id}" does not exist`);
}

// Boxes that do not overlap (touching counts as apart): the two bodies share no volume.
export const boxesApart = (a: BodyResult['bounds'], b: BodyResult['bounds']): boolean => [0, 1, 2].some((axis) => a.max[axis] <= b.min[axis] || b.max[axis] <= a.min[axis]);

// The report over the bodies of one state. `chosen`: the bodies to check, all without a list.
// `pair` hands out the two bodies a pair is computed from: with a mechanism (D49) the first one as
// modelled and the second in its frame, so that the boxes that reject a pair, the precision of the
// coordinates and the meshes do not depend on where the pair stands; or nothing for a pair it
// rejected already by boxes that hold the two bodies (it then builds no moved mesh). `shared` answers for one pair;
// the caller keeps its answers by the two meshes, so that after a change of the model only the
// pairs with a changed body go to the kernel again.
// - A pair is reported by `verdictOf`: a fit or a collision when the volume of its intersection is
//   above the threshold and deeper than the precision of the coordinates; `a` is the smaller ID
//   in string order. Pairs come in the order of the bodies in the model.
// - A pair the kernel refused is judged by its second opinion with the same rule: `nothing` or
//   a fit puts it in `cleared`; a collision, or no second opinion, leaves it in `failed`, neither
//   colliding nor clear. The second opinion never puts a pair in `pairs` or `fits`.
// - Boxes that do not overlap need no kernel: the volume is zero.
export function interferenceReport(
  bodies: Readonly<Record<Id, unknown>>,
  chosen: readonly Id[] | undefined,
  threshold: number,
  tolerance: number,
  pair: (a: Id, b: Id) => { a: BodyResult; b: BodyResult } | undefined,
  shared: (a: BodyResult, b: BodyResult) => SharedVolume,
): InterferenceReport {
  const wanted = chosen === undefined ? undefined : new Set(chosen);
  const ids = Object.keys(bodies).filter((id) => wanted === undefined || wanted.has(id));
  const report: InterferenceReport = { pairs: [], fits: [], failed: [], checked: 0 };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      report.checked++;
      const computed = pair(a, b);
      const result = !computed || boxesApart(computed.a.bounds, computed.b.bounds) ? NOTHING : shared(computed.a, computed.b);
      if (!('message' in result)) {
        // `pairs` and `fits` are written here only, from a mesh the kernel verified
        const verdict = verdictOf(result, threshold, tolerance);
        if (verdict !== 'nothing') (verdict === 'fit' ? report.fits : report.pairs).push({ a, b, volume: result.volume, depth: result.depth });
        continue;
      }
      const second = result.asComputed;
      const kind = second && verdictOf(second, threshold, tolerance);
      if (!second || kind === undefined) report.failed.push({ a, b, message: result.message });
      else if (kind === 'collision') report.failed.push({ a, b, message: failedMessage(result.message, second) });
      else (report.cleared ??= []).push({ a, b, kind, volume: second.volume, depth: second.depth });
    }
  }
  return report;
}

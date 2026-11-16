// Interference of bodies: the volume two bodies share, pair by pair (D35, point 5).
import { coordinatePrecision } from './mesh-distance';
import { type Reach, penetration, thickestPiece, volumeOf } from './solid';
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

interface Shared {
  volume: number;
  depth: number; // see `depthOf`
  planar: number; // the part of the depth that planar faces reach into each other
  round: boolean; // what they share has a face that is not planar
  slack: number; // how precisely a depth is known
}
const NOTHING: Shared = { volume: 0, depth: 0, planar: 0, round: false, slack: 0 };

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

// What two bodies share. The kernel gives no guarantee for an intersection with flush faces and may
// fail (its result is cleaned and verified); then the answer is the message of the failure.
// `tolerance` belongs to the meshes (a document with another chord tolerance has other meshes), so
// the answer for a pair of meshes does not depend on the call and can be kept by the two meshes.
export type SharedVolume = Shared | { message: string };
export function sharedBy(kernel: SolidKernel, a: BodyResult, b: BodyResult, tolerance: number): SharedVolume {
  try {
    // the absolute value: a sliver the cleaning left inside out must not hide as a negative volume
    const common = kernel.boolean('intersection', a.solid, b.solid);
    const volume = Math.abs(volumeOf(common));
    if (!Number.isFinite(volume)) throw new Error('the intersection has a volume that is not a number');
    const planar = new Map([...a.faces, ...b.faces].map((face) => [face.id, face.planar]));
    // coordinates are single precision: a depth is known to about a millionth of the largest coordinate
    const slack = coordinatePrecision(a, b);
    // a face the two lists do not have cannot be called planar
    const isPlanar = (face: number): boolean => planar.get(face) === true;
    const deep = volume > 0 ? depthOf(common, a.solid, b.solid, isPlanar, tolerance + slack, slack) : { depth: 0, planar: 0 };
    return { volume, ...deep, round: common.faceIds.some((id) => planar.get(id) === false), slack };
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
}

// The arguments as the method `Engine.interference` takes them: a mistake of the caller throws.
export function checkInterferenceOptions(bodies: Record<Id, BodyResult>, chosen: unknown, threshold: unknown): void {
  if (threshold !== undefined && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0)) throw new Error('interference: the threshold is a volume in mm³, zero or more');
  if (chosen !== undefined && (!Array.isArray(chosen) || chosen.some((id) => typeof id !== 'string'))) throw new Error('interference: bodies is a list of body IDs');
  for (const id of (chosen as Id[] | undefined) ?? []) if (!has(bodies, id)) throw new Error(`interference: the body "${id}" does not exist`);
}

// The report over the bodies of one state. `chosen`: the bodies to check, all without a list.
// `pair` hands out the two bodies a pair is computed from: with a mechanism (D49) the first one as
// modelled and the second in its frame, so that the boxes that reject a pair, the precision of the
// coordinates and the meshes do not depend on where the pair stands. `shared` answers for one pair;
// the caller keeps its answers by the two meshes, so that after a change of the model only the
// pairs with a changed body go to the kernel again.
// - A pair is reported when the volume of its intersection is above the threshold; `a` is the
//   smaller ID in string order. Pairs come in the order of the bodies in the model.
// - A volume no deeper than the precision of the coordinates is noise of flush faces, not
//   a pair, whatever its size (large flush faces of turned copies share a fraction of a mm³).
// - A reported pair is a fit when neither body reaches deeper into the other than `tolerance`
//   (the chord tolerance of the document), what they share has a round face and no planar face
//   of one body reaches into a planar face of the other further than the polygon of a round
//   face next to it explains; otherwise it is a collision: see InterferenceReport.
// - A pair the kernel failed on is in `failed`, neither colliding nor clear.
// - Boxes that do not overlap need no kernel: the volume is zero.
export function interferenceReport(
  bodies: Readonly<Record<Id, unknown>>,
  chosen: readonly Id[] | undefined,
  threshold: number,
  tolerance: number,
  pair: (a: Id, b: Id) => { a: BodyResult; b: BodyResult },
  shared: (a: BodyResult, b: BodyResult) => SharedVolume,
): InterferenceReport {
  const wanted = chosen === undefined ? undefined : new Set(chosen);
  const ids = Object.keys(bodies).filter((id) => wanted === undefined || wanted.has(id));
  const report: InterferenceReport = { pairs: [], fits: [], failed: [], checked: 0 };
  const apart = (a: BodyResult, b: BodyResult): boolean => [0, 1, 2].some((axis) => a.bounds.max[axis] <= b.bounds.min[axis] || b.bounds.max[axis] <= a.bounds.min[axis]);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      report.checked++;
      const computed = pair(a, b);
      const result = apart(computed.a, computed.b) ? NOTHING : shared(computed.a, computed.b);
      if ('message' in result) report.failed.push({ a, b, message: result.message });
      else if (result.volume > threshold && result.depth > result.slack) {
        const fit = result.round && result.planar <= result.slack && result.depth <= tolerance + result.slack;
        (fit ? report.fits : report.pairs).push({ a, b, volume: result.volume, depth: result.depth });
      }
    }
  }
  return report;
}

// Interference of bodies: the volume two bodies share, pair by pair (D35, point 5).
import { areaOf, volumeOf } from './solid';
import type { BodyResult, Id, InterferenceReport, Solid, SolidKernel } from './types';
import { has } from './util';

// Volumes up to this are noise, not a collision. In the spike flush faces, a pin in the hole cut
// by the same circle and identical cylinders gave exactly zero, and gears with a negative backlash
// of 0.05 mm 0.5 to 1.7 mm³. The kernel has a floor of its own below that: an overlap thinner than
// about a millionth of the size of the two bodies is welded away and counts as touching.
// A pin in a hole of the same diameter whose polygon is turned differently shares far more than
// this (slivers at the corners); the depth of the shared volume tells it apart, see `report`.
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
  depth: number;
}
const NOTHING: Shared = { volume: 0, depth: 0 };

// The query with a memory of the pairs it has computed, by the identity of the two meshes: after
// a change of the model only the pairs with a changed body go to the kernel again.
export class Interferences {
  private readonly known = new WeakMap<Solid, WeakMap<Solid, Shared | { message: string }>>();

  constructor(private readonly kernel: SolidKernel) {}

  // `bodies`: the bodies of the state asked about. `chosen`: the bodies to check, all without
  // a list; a body that does not exist is the caller's mistake and throws.
  // - A pair is reported when the volume of its intersection is above the threshold; `a` is the
  //   smaller ID in string order. Pairs come in the order of the bodies in the model.
  // - A reported pair is a collision when what it shares is deeper than `tolerance` (the chord
  //   tolerance of the document), otherwise a fit: see InterferenceReport.
  // - The kernel gives no guarantee for an intersection with flush faces and may fail (its result
  //   is cleaned and verified); such a pair is in `failed`, neither colliding nor clear.
  // - Boxes that do not overlap need no kernel: the volume is zero.
  report(bodies: Record<Id, BodyResult>, chosen: Id[] | undefined, threshold: number = INTERFERENCE_THRESHOLD, tolerance = 0): InterferenceReport {
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) throw new Error('interference: the threshold is a volume in mm³, zero or more');
    if (chosen !== undefined && (!Array.isArray(chosen) || chosen.some((id) => typeof id !== 'string'))) throw new Error('interference: bodies is a list of body IDs');
    for (const id of chosen ?? []) if (!has(bodies, id)) throw new Error(`interference: the body "${id}" does not exist`);
    const wanted = chosen === undefined ? undefined : new Set(chosen);
    const ids = Object.keys(bodies).filter((id) => wanted === undefined || wanted.has(id));
    const report: InterferenceReport = { pairs: [], fits: [], failed: [], checked: 0 };
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        report.checked++;
        const shared = this.shared(bodies[a], bodies[b]);
        if ('message' in shared) report.failed.push({ a, b, message: shared.message });
        else if (shared.volume > threshold) (shared.depth > tolerance ? report.pairs : report.fits).push({ a, b, ...shared });
      }
    }
    return report;
  }

  private shared(a: BodyResult, b: BodyResult): Shared | { message: string } {
    for (let axis = 0; axis < 3; axis++) if (a.bounds.max[axis] <= b.bounds.min[axis] || b.bounds.max[axis] <= a.bounds.min[axis]) return NOTHING;
    let row = this.known.get(a.solid);
    if (!row) this.known.set(a.solid, (row = new WeakMap()));
    let result = row.get(b.solid);
    if (result === undefined) {
      try {
        // the absolute value: a sliver the cleaning left inside out must not hide as a negative volume
        const common = this.kernel.boolean('intersection', a.solid, b.solid);
        const [volume, area] = [Math.abs(volumeOf(common)), areaOf(common)];
        result = { volume, depth: area > 0 ? (2 * volume) / area : 0 };
      } catch (error) {
        result = { message: error instanceof Error ? error.message : String(error) };
      }
      row.set(b.solid, result);
    }
    return result;
  }
}

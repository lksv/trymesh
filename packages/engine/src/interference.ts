// Interference of bodies: the volume two bodies share, pair by pair (D35, point 5).
import { volumeOf } from './solid';
import type { BodyResult, Id, InterferenceReport, Solid, SolidKernel } from './types';
import { has } from './util';

// Volumes up to this are noise, not a collision. In the spike flush faces, a pin in its hole and
// identical cylinders gave exactly zero, and gears with a negative backlash of 0.05 mm 0.5 to 1.7 mm³.
export const INTERFERENCE_THRESHOLD = 0.001; // mm³

// A text that can be a file name on every common file system and still tells one body ID from
// another: letters, digits, dot, dash and underscore stay, every other character is written as %XX
// per byte of its UTF-8 form (`planets/1` is `planets%2F1`). The percent sign is escaped too, so
// two IDs never give the same name. Names that differ only in the case of letters are still
// different names here; a file system that ignores case needs a check by the caller.
export function bodyFileName(body: Id): string {
  let name = '';
  for (const byte of new TextEncoder().encode(body)) {
    const char = String.fromCharCode(byte);
    name += /[A-Za-z0-9._-]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return name;
}

// The query with a memory of the pairs it has computed, by the identity of the two meshes: after
// a change of the model only the pairs with a changed body go to the kernel again.
export class Interferences {
  private readonly known = new WeakMap<Solid, WeakMap<Solid, number | { message: string }>>();

  constructor(private readonly kernel: SolidKernel) {}

  // `bodies`: the bodies of the state asked about. `chosen`: the bodies to check, all without
  // a list; a body that does not exist is the caller's mistake and throws.
  // - A pair is reported when the volume of its intersection is above the threshold; `a` is the
  //   smaller ID in string order. Pairs come in the order of the bodies in the model.
  // - The kernel gives no guarantee for an intersection with flush faces and may fail (its result
  //   is cleaned and verified); such a pair is in `failed`, neither colliding nor clear.
  // - Boxes that do not overlap need no kernel: the volume is zero.
  report(bodies: Record<Id, BodyResult>, chosen: Id[] | undefined, threshold: number = INTERFERENCE_THRESHOLD): InterferenceReport {
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) throw new Error('interference: the threshold is a volume in mm³, zero or more');
    if (chosen !== undefined && (!Array.isArray(chosen) || chosen.some((id) => typeof id !== 'string'))) throw new Error('interference: bodies is a list of body IDs');
    for (const id of chosen ?? []) if (!has(bodies, id)) throw new Error(`interference: the body "${id}" does not exist`);
    const wanted = chosen === undefined ? undefined : new Set(chosen);
    const ids = Object.keys(bodies).filter((id) => wanted === undefined || wanted.has(id));
    const report: InterferenceReport = { pairs: [], failed: [], checked: 0 };
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        report.checked++;
        const shared = this.shared(bodies[a], bodies[b]);
        if (typeof shared !== 'number') report.failed.push({ a, b, message: shared.message });
        else if (shared > threshold) report.pairs.push({ a, b, volume: shared });
      }
    }
    return report;
  }

  private shared(a: BodyResult, b: BodyResult): number | { message: string } {
    for (let axis = 0; axis < 3; axis++) if (a.bounds.max[axis] <= b.bounds.min[axis] || b.bounds.max[axis] <= a.bounds.min[axis]) return 0;
    let row = this.known.get(a.solid);
    if (!row) this.known.set(a.solid, (row = new WeakMap()));
    let result = row.get(b.solid);
    if (result === undefined) {
      try {
        // the absolute value: a sliver the cleaning left inside out must not hide as a negative volume
        result = Math.abs(volumeOf(this.kernel.boolean('intersection', a.solid, b.solid)));
      } catch (error) {
        result = { message: error instanceof Error ? error.message : String(error) };
      }
      row.set(b.solid, result);
    }
    return result;
  }
}

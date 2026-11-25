// The stage after the solver (D68): the geometry of the derived entries of `external` (the copies of
// a mirror or a pattern), computed from the base of `sketchWorld` (world.ts), the sketch with its
// curves that are not derived and the positions after the solver. It is the inside of
// `sketchWorld`, which the sketch step and every sketch tool call, so the step and the tools have
// the same copies. docs/d36/6c-sketch-mirror-pattern/design.md, "The registry, split by source".
import type { Id, SketchFeature } from '../types';
import { kindOf } from './index';
import type { DerivedFailure, DerivedGeometry, EntryGeometry } from './spec';
import type { SketchBase } from './world';

// The order of the entries of a sketch: the keys of `external` as the document holds them, which is
// the order they were added in, except that JavaScript puts a key that is a whole number before
// every other key, in numeric order. A function of the document alone, so a save and a load keep
// it; the stage after the solver, the result's curves, the sketch tools and the lists of the app
// and of `get_sketch` read it.
export const entryOrder = (sketch: SketchFeature): Id[] => Object.keys(sketch.external);

const isFailure = (answer: EntryGeometry | DerivedFailure): answer is DerivedFailure => 'code' in answer;

// Every derived entry in the order of the entries, its `derive` over the base. A failure is
// a warning of the sketch, with the geometry the entry could make.
export function deriveAll(base: SketchBase): DerivedGeometry {
  const entries: Record<Id, EntryGeometry> = {};
  const warnings: DerivedFailure[] = [];
  for (const id of entryOrder(base.sketch)) {
    const ref = base.sketch.external[id];
    const kind = kindOf(ref);
    if (kind.source !== 'derived') continue;
    const answer = kind.derive(id, ref, base);
    if (isFailure(answer)) {
      warnings.push(answer);
      if (answer.geometry) entries[id] = answer.geometry;
    } else entries[id] = answer;
  }
  return { entries, joins: [], warnings };
}

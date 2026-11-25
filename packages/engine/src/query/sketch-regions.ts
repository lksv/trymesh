// The query `sketchRegions` (D72): the regions of a sketch with their whole references, a page at a
// time. A command names a region by its whole sorted outer loop and there is no other form; get_sketch
// prints a long loop short, so this is the way to a region of more than twenty curves through MCP
// (an imported outline mostly is one). It reads the solved sketch, no body.
import type { Id, RegionRef } from '../types';
import type { ArgSpecs } from './args';
import type { QuerySpec } from './spec';

export const SKETCH_REGIONS_ARGS = {
  sketch: { kind: 'sketch', title: 'Sketch' },
  curve: { kind: 'text', title: 'Curve', summary: 'Only the regions bounded by this curve, by its ID in the sketch (own, of an entry, or a copy).', optional: true },
  index: { kind: 'number', title: 'Region', summary: 'Only the region at this place among the regions of the sketch, as a row of get_sketch gives it.', optional: true, spec: { title: 'Place of the region', unit: 'count', integer: true, min: { value: 0 } } },
  holes: { kind: 'flag', title: 'Holes', summary: 'List the curves of the holes of each region too; without it only their count.', optional: true },
  from: { kind: 'number', title: 'From', summary: 'How many of the regions that match to pass over, for the next page.', optional: true, spec: { title: 'Regions to pass over', unit: 'count', integer: true, min: { value: 0 }, default: 0 } },
  max: { kind: 'number', title: 'Most regions', summary: 'The most regions to list; `total` counts all that match.', optional: true, spec: { title: 'Most regions to list', unit: 'count', integer: true, min: { value: 1 }, max: { value: 100 }, default: 20 } },
} as const satisfies ArgSpecs;

// A page ends when it has listed this many IDs (outer loops, and holes when listed), but never
// before its first region, however long its loop.
export const REGION_PAGE_IDS = 2000;

// - `index`: the place of the region among the regions of the sketch, whatever the filter and the page.
// - `ref`: the reference of the region as a command takes it, whole.
// - `area`: mm², less the holes; `box`: of the outer loop [x0, y0, x1, y1], in the sketch.
// - `holes`: how many loops lie inside it; `holeLoops`, when asked for: each by the IDs of its curves.
export interface RegionRow {
  index: number;
  ref: RegionRef;
  area: number;
  box: [number, number, number, number];
  holes: number;
  holeLoops?: Id[][];
}
// - `status`: `unavailable` when the sketch did not evaluate; `invalid` when its profile is (then it
//   has no regions; the query sketchContacts says why).
// - `total`: the regions that match (`curve`, `index`), in their order in the sketch; `from`: how
//   many of them were passed over.
export interface SketchRegionsResult {
  status: 'ok' | 'unavailable' | 'invalid';
  total: number;
  from: number;
  regions: RegionRow[];
}

declare module './spec' {
  interface Queries {
    sketchRegions: { spec: typeof SKETCH_REGIONS_ARGS; result: SketchRegionsResult };
  }
}

const loopArea = (xy: ArrayLike<number>): number => {
  let sum = 0;
  for (let i = 0; i < xy.length; i += 2) {
    const j = (i + 2) % xy.length;
    sum += xy[i] * xy[j + 1] - xy[j] * xy[i + 1];
  }
  return Math.abs(sum / 2);
};
const boxOf = (xy: ArrayLike<number>): [number, number, number, number] => {
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < xy.length; i += 2) {
    box[0] = Math.min(box[0], xy[i]);
    box[1] = Math.min(box[1], xy[i + 1]);
    box[2] = Math.max(box[2], xy[i]);
    box[3] = Math.max(box[3], xy[i + 1]);
  }
  return box;
};
// the IDs of the curves of a loop, one per edge, made unique, in the order of the loop
const loopIds = (curves: readonly Id[]): Id[] => [...new Set(curves)];

export const sketchRegions: QuerySpec<typeof SKETCH_REGIONS_ARGS, SketchRegionsResult> = {
  geometry: 'none', // reads no geometry of bodies (D49)
  title: 'The regions of a sketch',
  summary:
    'The regions of a sketch with their whole references, as an extrusion or a revolution names them (`{ outerLoop: [...] }`), a page at a time: get_sketch prints a loop of more than twenty curves short, with the `index` to ask here. `curve` keeps the regions a curve bounds (the way from a curve of an imported outline to the region to extrude); `holes` lists the curves of the holes too.',
  returns:
    '`status` (ok, unavailable, invalid), `total` (the regions that match), `from`, and `regions`, each with `index` (its place among the regions of the sketch), `ref` (whole), `area` (mm², less the holes), `box` [x0, y0, x1, y1], `holes` (their count) and with `holes: true` `holeLoops`. A page ends at `max` regions or 2000 IDs, but never before its first region.',
  args: SKETCH_REGIONS_ARGS,
  run: (context, { sketch, curve, index, holes, from, max }) => {
    const state = context.sketch(sketch);
    const result = context.state.evaluation.features[sketch]?.sketch;
    if (!state || !result) return { status: 'unavailable', total: 0, from, regions: [] };
    if (!state.profile.valid) return { status: 'invalid', total: 0, from, regions: [] };
    const profile = state.profile.regions;
    // the IDs of the holes from the kept profile, one per edge, made unique
    const holeIds = (i: number): Id[][] => profile[i].holes.map((loop) => loopIds(loop.curves));
    const matching = result.regions.flatMap((region, i) => {
      if (index !== undefined && i !== index) return [];
      if (curve !== undefined && !region.ref.outerLoop.includes(curve) && !holeIds(i).some((loop) => loop.includes(curve))) return [];
      return [i];
    });
    const regions: RegionRow[] = [];
    let ids = 0;
    for (const i of matching.slice(from)) {
      if (regions.length >= max) break;
      const region = result.regions[i];
      const loops = holes ? holeIds(i) : undefined;
      const count = region.ref.outerLoop.length + (loops ? loops.reduce((sum, loop) => sum + loop.length, 0) : 0);
      if (regions.length > 0 && ids + count > REGION_PAGE_IDS) break;
      const [outer, ...inner] = region.loops;
      regions.push({
        index: i,
        ref: { outerLoop: [...region.ref.outerLoop] },
        area: loopArea(outer) - inner.reduce((sum, loop) => sum + loopArea(loop), 0),
        box: boxOf(outer),
        holes: inner.length,
        ...(loops ? { holeLoops: loops } : {}),
      });
      ids += count;
    }
    return { status: 'ok', total: matching.length, from, regions };
  },
};

// A profile source of a feature turned into regions in the plane of its sketch. A service of the
// recompute, not a part of the extrusion: every feature that builds a tool over a profile uses it.
import { GENERATORS, type ResolvedOperand, generateProfile } from '../generators';
import { type Loop, type Region, sameRegion } from '../sketch';
import type { Id, ProfileSource } from '../types';
import { type Move, movedOutline, nestingOf, outlineRegions, selectionOutline, shown, sideShape, wallOutline } from './outline';
import { issue, lookup } from './services';
import type { ProfileProblem, ResolvedProfile, SideCurve, SketchState, State } from './state';

export type { ProfileProblem } from './state';

// The profile of a feature by its source. `id` is the feature, named in the references of an error.
export function profile(id: Id, source: ProfileSource, state: State, chordTolerance: number): ResolvedProfile | ProfileProblem {
  const sketch = lookup(state.sketches, source.sketch);
  if (!sketch) return { code: 'brokenReference', refs: [source.sketch] };
  if (source.type === 'generated') return generated(id, source, sketch, state, chordTolerance);
  if (source.type === 'wall') return wall(source, sketch, chordTolerance);
  if (!sketch.profile.valid) return { code: 'invalidProfile', refs: [source.sketch] };
  const regions = source.regions.map((ref) => sketch.profile.regions.find((region) => sameRegion(region.ref, ref)));
  const missing = source.regions.filter((_, i) => !regions[i]);
  if (missing.length) return { code: 'noProfile', refs: missing };
  const { points, radii } = sketch.geometry;
  const curveOf = (id: Id): SideCurve => {
    const curve = sketch.feature.curves[id];
    const at = (point: Id): [number, number] => [points[point].x, points[point].y];
    if (curve.type === 'line') return { type: 'line', a: at(curve.a), b: at(curve.b) };
    const center = at(curve.center);
    return { type: 'round', center, radius: curve.type === 'circle' ? radii[id] : Math.hypot(points[curve.start].x - center[0], points[curve.start].y - center[1]) };
  };
  const selected = regions as Region[];
  // Without an offset (the field absent, or zero) the regions are those of the sketch, as they
  // always were: the mesh of a document that does not use the offset does not change.
  if (!source.offset) return { regions: selected, frame: sketch.frame, sideOf: (curve) => ({ name: { role: 'side', curve }, shape: curveOf(curve) }), outline: () => selectionOutline(selected) };
  const move: Move = {
    subject: `The offset of ${shown(source.offset)} mm`,
    cure: 'Use a smaller offset or give the corners a radius larger than the offset, or draw the moved outline in the sketch and extrude that.',
  };
  const outline = selectionOutline(selected);
  if ('code' in outline) return outline;
  const moved = movedOutline(outline, source.offset, move);
  if ('code' in moved) return moved;
  const built = outlineRegions(moved, nestingOf(outline), chordTolerance, move);
  if ('code' in built) return built;
  // every curve of the outline is there once, so its ID still names its side
  const shapes = new Map(moved.regions.flatMap((region) => [region.outer, ...region.holes]).flatMap((loop) => loop.map((curve): [string, SideCurve] => [curve.key, sideShape(curve)])));
  return { regions: built, frame: sketch.frame, sideOf: (curve) => ({ name: { role: 'side', curve }, shape: shapes.get(curve) as SideCurve }), outline: () => moved };
}

// A wall along curves of the sketch. It reads the solved curves only, so it does not depend on the
// sketch profile being valid: the centre line of a rib ends on the wall it stiffens.
function wall(source: Extract<ProfileSource, { type: 'wall' }>, sketch: SketchState, chordTolerance: number): ResolvedProfile | ProfileProblem {
  const move: Move = { subject: `The wall ${shown(source.thickness)} mm thick`, cure: 'Make the wall thinner or its bends wider, or draw its outline in the sketch and extrude that.' };
  const found = wallOutline(sketch.feature, sketch.geometry, source.curves, source.thickness, move);
  if ('code' in found) return found;
  const built = outlineRegions(found.outline, found.nesting, chordTolerance, move, found.curveOf);
  if ('code' in built) return built;
  return { regions: built, frame: sketch.frame, sideOf: (key) => found.sides.get(key) as { name: ReturnType<ResolvedProfile['sideOf']>['name']; shape: SideCurve }, outline: () => found.outline, curveOf: found.curveOf };
}

// A profile from a generator. The generator reads only the solved operands, so it does not depend
// on the sketch profile being valid: the pitch circles of gears in mesh touch, which would
// invalidate it if they were not construction geometry.
function generated(id: Id, source: Extract<ProfileSource, { type: 'generated' }>, sketch: SketchState, state: State, chordTolerance: number): ResolvedProfile | ProfileProblem {
  const spec = GENERATORS[source.generator];
  const { points, radii } = sketch.geometry;
  const operands: Record<string, ResolvedOperand> = {};
  for (const { field } of spec.operands) {
    // own curves and projected ones; validation let only the kinds of the catalog in (circles today)
    const entity = source.operands[field];
    const curve = lookup(sketch.input.curves, entity);
    const center = curve?.type === 'circle' ? lookup(points, curve.center) : undefined;
    const radius = lookup(radii, entity);
    if (!center || radius === undefined) return { code: 'brokenReference', refs: [entity] };
    operands[field] = { kind: 'circle', center: [center.x, center.y], radius };
  }
  // facts of the features referred to; a feature that is missing, suppressed or in error has none
  const refs = Object.fromEntries(Object.entries(source.refs ?? {}).map(([name, feature]) => [name, lookup(state.features, feature)?.facts]));
  let result: ReturnType<typeof generateProfile>;
  try {
    result = generateProfile(source.generator, { operands, params: source.params, refs, frame: sketch.frame, chordTolerance });
  } catch (error) {
    return { code: 'invalidProfile', refs: [id], message: `The profile generator failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!result.ok) return { code: 'invalidProfile', refs: [id], message: `The profile generator cannot build the profile: ${result.message}.` };
  // Regions in the shape the prism builder takes: every vertex has its own key and every edge the
  // name of its side in place of a curve ID.
  const loop = (generated: { xy: number[]; side: string }, tag: string): Loop => {
    const count = generated.xy.length / 2;
    return { xy: generated.xy, keys: Array.from({ length: count }, (_, i) => `g:${tag}:${i}`), curves: Array.from({ length: count }, () => generated.side) };
  };
  const regions = result.regions.map((region, r): Region => ({ ref: { outerLoop: [region.outer.side] }, outer: loop(region.outer, `${r}`), holes: region.holes.map((hole, h) => loop(hole, `${r}:${h}`)) }));
  const warnings = result.warnings.map((warning) => issue(warning.code, warning.refs, warning.detail));
  return { regions, frame: sketch.frame, sideOf: (curve) => ({ name: { role: 'side', curve }, shape: { type: 'general' } }), facts: result.facts, warnings };
}

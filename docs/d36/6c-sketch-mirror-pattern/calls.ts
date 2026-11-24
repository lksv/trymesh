// Validation scenario 15 (a cover for a controller board), the part of package 6c, written as calls
// against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot
// be written here is a hole in the contract. Lines marked `@ts-expect-error` must not compile.
//
// Step 4 of the scenario: the lid outline, one half drawn and mirrored about the Y axis of the
// origin; the mirrored half closes into one region with the original. Step 5: vents, one slot and
// a linear pattern with the count `vents`: a row in the lid's own sketch, whose copies are holes of
// the lid's region and follow the count with no patch, and a row in a sketch of its own, of which
// a cut takes the regions of copies 1 and 3. Step 6, the second notch: a circle across the top line
// of the lid's source half, trimmed in either order; the entry of the mirror is patched and its copy
// follows. Step 7, the part of 6c: `vents` from 5 to 7 keeps the cut's region references; 3 makes
// copy 3 a broken reference, and 5 brings it back. Then the rest of the mechanism: a circular
// pattern (the bolt circle the Onshape converter lost), a grid, a copy that lies on its source, the
// fillet of a source corner, a split by a rib the mirror does not list (also under a chamfer of the
// lid's rim), an own curve across a copy, an end that stays open, and the refusals.
//
// Fixed 2026-11-24 after the second round of reviews: the two trims of the second notch are given
// by their places alone (after a cut the ID of a curve names only its first piece, and 6e refuses
// a place on another piece), and the notch is run on the four paths the third round measured (both
// orders; under the lid, where the repair is on by default, and before it, where it is off).
//
// Written after 6a2 (the axes of the origin, implemented before 6c: the owner's answer 1): the
// mirror is about `origin/y`, the rows run along `origin/x`, the grid's second direction is
// `origin/y`. The numbers in the comments were measured (design.md, "Measured": the stage after the
// solver prototyped outside the repository, the copies put into the real `profileOf`, the sketches
// solved by the real planegcs adapter); the half was measured with a construction line through the
// origin in the place of `origin/y`, which stands at the same place.
// The grip flank of step 4 is a spline of 6d; here it is a line, so that the volume can be computed
// by hand, and 6d puts the spline in (design.md, "Later kinds"). The second row of vents is
// dimensioned without a projection of a copy, which 6b adds.

import type { Id, SketchFeature } from '../../../packages/engine/src/index';
import { faceKey } from '../../../packages/engine/src/index';
import type { CommandAfter, StateAfter } from '../00-prep/contract';
import { done, engine, fail, run, unwrap } from '../2a-offset/calls';
import { contextOf } from '../6e-trim-extend-split/calls';
import { freshIds, sketchTool } from '../6e-trim-extend-split/contract';
import type { CopyPatchIds, CutIdsAfter, SketchPattern, SketchResultAfter } from './contract';
import { COPY_AS_SNAP, COPY_IN_CONSTRAINT, COPY_IN_TOOL, KEY_OF_SIDE_OF_A_COPY, OWN_CROSSES_COPY, SIDE_OF_A_COPY } from './contract';

const XY = { kind: 'base', plane: 'XY' } as const;
const near = (value: number | undefined, expected: number, tolerance: number): boolean => value !== undefined && Math.abs(value - expected) < tolerance;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const sketchOf = (state: StateAfter, id: Id): SketchFeature => {
  const feature = state.document.features.find((f) => f.id === id);
  return feature?.type === 'sketch' ? (feature as SketchFeature) : fail(`no sketch "${id}"`);
};
const resultOf = (state: StateAfter, id: Id): SketchResultAfter => (state.evaluation.features[id].sketch as SketchResultAfter | undefined) ?? fail(`no result of "${id}"`);
const regionsOf = (state: StateAfter, sketch: Id): Id[][] => resultOf(state, sketch).regions.map((region) => region.ref.outerLoop);
const volumeOf = (state: StateAfter, body: Id): number => state.evaluation.bodies[body]?.volume ?? fail(`no body "${body}"`);
const point = (sketch: Id, id: Id, x: number, y: number): CommandAfter => ({ type: 'addPoint', sketch, id, x, y });
const line = (sketch: Id, id: Id, a: Id, b: Id, construction = false): CommandAfter => ({ type: 'addCurve', sketch, id, curve: { ...(construction ? { construction: true } : {}), type: 'line', a, b } });
const arc = (sketch: Id, id: Id, center: Id, start: Id, end: Id): CommandAfter => ({ type: 'addCurve', sketch, id, curve: { type: 'arc', center, start, end } });
const constrain = (sketch: Id, id: Id, constraint: object): CommandAfter => ({ type: 'addConstraint', sketch, id, constraint } as CommandAfter);
const extrudeRegions = (id: Id, sketch: Id, regions: Id[][], distance: number | string, operation: 'new' | 'cut' = 'new', targets?: Id[]): CommandAfter => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: regions.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) }, extent: { type: 'distance', start: 0, distance }, operation, ...(targets ? { targets } : {}) },
});
const addPattern = (sketch: Id, id: Id, ref: import('../../../packages/engine/src/index').Input<SketchPattern>): CommandAfter => ({ type: 'addExternal', sketch, id, ref });

// ---------------------------------------------------------------- the numbers

// The lid W × H with corners of radius R, T thick; the slot 12 × 3 (the area of a stadium); the
// row of vents spaced `ventPitch`.
const [W, H, R, T] = [84, 54, 5, 2];
const SLOT = 3 * 9 + Math.PI * 1.5 * 1.5; // 34.0686
const LID = W * H - (4 - Math.PI) * R * R; // 4514.5398
// The arcs are polygons within the chord tolerance (0.01 mm): the outline's polygon is 0.19 mm²
// below the area by hand, a slot's 0.06 mm² ("Measured"), so a lid with n holes is within
// (0.2 + 0.06 n) T of the volume by hand.
const lidAllowance = (holes: number): number => (0.2 + 0.06 * holes) * T;

export function parameters(): StateAfter {
  return run(
    { type: 'setParameter', name: 'W', expr: `${W}` },
    { type: 'setParameter', name: 'H', expr: `${H}` },
    { type: 'setParameter', name: 'R', expr: `${R}` },
    { type: 'setParameter', name: 'T', expr: `${T}` },
    { type: 'setParameter', name: 'vents', expr: '5' },
    { type: 'setParameter', name: 'ventPitch', expr: '6' },
  );
}

// A stand under the lid, before its sketch: a body an edge projection may name (the refusal of
// a change from derived to reference geometry needs a valid edge, which only a body before the
// sketch gives).
export function stand(): StateAfter {
  run({ type: 'addFeature', feature: { id: 'standSketch', name: 'Stand', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  run(point('standSketch', 'b1', -10, -10), point('standSketch', 'b2', 10, -10), point('standSketch', 'b3', 0, -20), line('standSketch', 'bl1', 'b1', 'b2'), line('standSketch', 'bl2', 'b2', 'b3'), line('standSketch', 'bl3', 'b3', 'b1'));
  return run(extrudeRegions('stand', 'standSketch', [['bl1', 'bl2', 'bl3']], 1));
}

// ================================================================ step 4: the lid outline

// The right half, drawn off its place and solved: `c1` along the bottom from the origin, the corner
// arc `r1`, the flank `c2` (6d: a spline), the corner arc `r2`, the top `c3`, which ends at `a5` on
// the Y axis by a constraint (`pointOnCurve` with `origin/y`). Fully determined (measured: 0 degrees
// of freedom; `a5` solved to x = 0 exactly).
export function lidHalf(): StateAfter {
  const s = 'lidSketch';
  run({ type: 'addFeature', feature: { id: s, name: 'Lid', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  run(
    point(s, 'a1', 37.3, 0.2),
    point(s, 'q1', 36.8, 5.1),
    point(s, 'a2', 42.2, 4.7),
    point(s, 'a3', 41.9, 49.4),
    point(s, 'q2', 37.3, 48.8),
    point(s, 'a4', 36.8, 54.3),
    point(s, 'a5', 0.7, 53.8),
    line(s, 'c1', 'origin', 'a1'),
    arc(s, 'r1', 'q1', 'a1', 'a2'),
    line(s, 'c2', 'a2', 'a3'),
    arc(s, 'r2', 'q2', 'a3', 'a4'),
    line(s, 'c3', 'a4', 'a5'),
  );
  return run(
    constrain(s, 'k1', { type: 'horizontal', line: 'c1' }),
    constrain(s, 'k2', { type: 'vertical', line: 'c2' }),
    constrain(s, 'k3', { type: 'horizontal', line: 'c3' }),
    constrain(s, 'k4', { type: 'tangent', a: 'c1', b: 'r1' }),
    constrain(s, 'k5', { type: 'tangent', a: 'r1', b: 'c2' }),
    constrain(s, 'k6', { type: 'tangent', a: 'c2', b: 'r2' }),
    constrain(s, 'k7', { type: 'tangent', a: 'r2', b: 'c3' }),
    constrain(s, 'k8', { type: 'radius', curve: 'r1', value: 'R', driving: true }),
    constrain(s, 'k9', { type: 'equalRadius', a: 'r1', b: 'r2' }),
    constrain(s, 'k10', { type: 'horizontalDistance', a: 'origin', b: 'a2', value: 'W / 2', driving: true }),
    constrain(s, 'k11', { type: 'verticalDistance', a: 'origin', b: 'a4', value: 'H', driving: true }),
    // the end of the top on the Y axis of the origin (6a2)
    constrain(s, 'k12', { type: 'pointOnCurve', point: 'a5', curve: 'origin/y' }),
  );
}

// The mirror: one entry, the five curves about the Y axis. Its copies are `m/1/c1` … `m/1/c3`, over
// `m/1/origin`, `m/1/a1` … `m/1/a5` and the centres; the end `m/1/origin` joins `origin` and the end
// `m/1/a5` joins `a5` by position, so the outline is one loop (measured: the only two joins).
export function mirrored(): StateAfter {
  parameters();
  stand();
  lidHalf();
  return run(addPattern('lidSketch', 'm', { type: 'pattern', sources: ['c1', 'r1', 'c2', 'r2', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } }));
}
export const LID_REGION: Id[] = ['c1', 'c2', 'c3', 'm/1/c1', 'm/1/c2', 'm/1/c3', 'm/1/r1', 'm/1/r2', 'r1', 'r2'];

// One region whose outer loop holds both halves (measured: its polygon 4514.3488 mm², by hand
// 4514.5398); the arcs of the copy run counter-clockwise from the image of the source's end
// (`m/1/r1` from the image of `a2` to the image of `a1`); the copies are in the result as curves
// that are not own; the solver saw none of them (the freedom of the half, 0), and no end of a copy
// is open.
export function oneRegion(state: StateAfter): boolean {
  const result = resultOf(state, 'lidSketch');
  return (
    result.valid &&
    same(regionsOf(state, 'lidSketch'), [LID_REGION]) &&
    same(result.curves['m/1/r1'], { shape: { type: 'arc', center: 'm/1/q1', start: 'm/1/a2', end: 'm/1/a1' }, source: 'derived', regions: true }) &&
    near(result.points['m/1/a2']?.x, -W / 2, 1e-9) &&
    result.degreesOfFreedom === 0 &&
    result.openEnds === undefined &&
    state.evaluation.features['lidSketch'].status === 'ok'
  );
}

// The lid from that region. Its side faces are named by the curves, the copies included: the face
// `{ role: 'side', curve: 'm/1/c2' }` is the flank of the left half, keyed with the slashed ID quoted.
export function lid(): StateAfter {
  return run(extrudeRegions('lid', 'lidSketch', [LID_REGION], 'T'));
}
export const lidChecks = (state: StateAfter): boolean =>
  near(volumeOf(state, 'lid'), LID * T, lidAllowance(0)) &&
  state.evaluation.faceNames.some((name) => name.role === 'side' && name.feature === 'lid' && name.curve === SIDE_OF_A_COPY.curve) &&
  faceKey(SIDE_OF_A_COPY) === KEY_OF_SIDE_OF_A_COPY; // `lid/side/"m/1/c2"`: true after 6c

// A change of the source moves the copy: the width 90 moves `m/1/a2` to x = −45, and the lid
// follows. (Run after `lid` and before the vents, whose holes the volume does not count.)
export const wider = (): boolean => {
  const state = done(engine.preview({ type: 'setParameter', name: 'W', expr: '90' }));
  return near(resultOf(state, 'lidSketch').points['m/1/a2']?.x, -45, 1e-6) && near(volumeOf(state, 'lid'), (90 * H - (4 - Math.PI) * R * R) * T, lidAllowance(0));
};

// ================================================================ step 5: the vents

// Row A, in the lid's sketch: one slot at x = −12, y = 14 (the centres `o1`, `o2` 9 apart, the ends
// `s1` … `s4`; dimensioned in the code of the scenario, placed here), and a linear pattern along the
// X axis of the origin with the count `vents` and the spacing `ventPitch`. The copies lie inside
// the outline, so they are holes of the lid's region, which is named by its outer loop alone: the
// lid has the vents, and more vents need no patch.
function slot(sketch: Id, p: string, x: number, y: number): CommandAfter[] {
  return [
    point(sketch, `${p}o1`, x, y - 4.5),
    point(sketch, `${p}o2`, x, y + 4.5),
    point(sketch, `${p}s1`, x - 1.5, y - 4.5),
    point(sketch, `${p}s2`, x + 1.5, y - 4.5),
    point(sketch, `${p}s3`, x + 1.5, y + 4.5),
    point(sketch, `${p}s4`, x - 1.5, y + 4.5),
    arc(sketch, `${p}g1`, `${p}o1`, `${p}s1`, `${p}s2`),
    line(sketch, `${p}e1`, `${p}s2`, `${p}s3`),
    arc(sketch, `${p}g2`, `${p}o2`, `${p}s3`, `${p}s4`),
    line(sketch, `${p}e2`, `${p}s4`, `${p}s1`),
  ];
}
export function rowA(): StateAfter {
  run(...slot('lidSketch', 'v', -12, 14));
  return run(addPattern('lidSketch', 'va', { type: 'pattern', sources: ['vg1', 've1', 'vg2', 've2'], transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } } }));
}
// Measured: 6 regions (the lid with 5 holes, the slot, copies 1 to 4); the lid's region unchanged.
export const rowAChecks = (state: StateAfter): boolean =>
  regionsOf(state, 'lidSketch').length === 6 &&
  regionsOf(state, 'lidSketch').some((loop) => same(loop, ['va/4/ve1', 'va/4/ve2', 'va/4/vg1', 'va/4/vg2'])) &&
  near(volumeOf(state, 'lid'), (LID - 5 * SLOT) * T, lidAllowance(5)) && // measured 8688.604
  sketchOf(state, 'lidSketch').expressions?.['external/va/transform/count'] === 'vents';

// Row B, in a sketch of its own on the lid (here on XY, through which the cut goes): the same slot
// at y = 40 and a pattern of it with the count `vents`; the cut takes the regions of copies 1 and 3.
export function rowB(): StateAfter {
  const s = 'ventSketch';
  run({ type: 'addFeature', feature: { id: s, name: 'Vents', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  run(...slot(s, 'w', -12, 40));
  run(addPattern(s, 'vb', { type: 'pattern', sources: ['wg1', 'we1', 'wg2', 'we2'], transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } } }));
  return run(extrudeRegions('ventCut', s, [copyRegion(1), copyRegion(3)], 'T', 'cut', ['lid']));
}
const copyRegion = (copy: number): Id[] => ['wg1', 'we1', 'wg2', 'we2'].map((curve) => `vb/${copy}/${curve}`);
export const rowBChecks = (state: StateAfter): boolean => state.evaluation.features['ventCut'].status === 'ok' && near(volumeOf(state, 'lid'), (LID - 7 * SLOT) * T, lidAllowance(7));

// ================================================================ step 7: vents from 5 to 7, then 3

// 7: row A has 7 holes, the lid loses two more slots; the cut keeps copies 1 and 3, which stand
// where they stood (the spacing moves none of them). No feature is patched (measured: copies 1 and
// 3 of row B, 34.0094 mm² each, with 5 and with 7).
export function sevenVents(): boolean {
  const before = engine.getState();
  const state = run({ type: 'setParameter', name: 'vents', expr: '7' });
  const cut = state.document.features.find((f) => f.id === 'ventCut');
  const cutBefore = before.document.features.find((f) => f.id === 'ventCut');
  // the copies are in no input of the solver: the stamp of the sketch is what it was
  const stamp = (of: StateAfter): string => sketchOf(of, 'lidSketch').solved.inputs;
  return (
    stamp(state) === stamp(before) &&
    regionsOf(state, 'lidSketch').length === 8 &&
    near(volumeOf(state, 'lid'), (LID - 9 * SLOT) * T, lidAllowance(9)) && // from the measured areas 8416.528, by hand 8415.845
    same(cut, cutBefore) &&
    state.evaluation.features['ventCut'].status === 'ok'
  );
}
// 3: copy 3 of row B is gone: the cut is in error with the region it names (`noProfile`), as a
// feature that names a copy of a pattern beyond its count is. 5 again: the copy is back, and so is
// the cut, unchanged.
export function threeVents(): boolean {
  const three = done(engine.preview({ type: 'setParameter', name: 'vents', expr: '3' }));
  const error = three.evaluation.features['ventCut'].error;
  const back = run({ type: 'setParameter', name: 'vents', expr: '5' });
  return error?.code === 'noProfile' && same(error.refs, [{ outerLoop: [...copyRegion(3)].sort() }]) && back.evaluation.features['ventCut'].status === 'ok';
}
// The count is a numeric field of the sketch at `external/va/transform/count`: `setField` with the
// sketch as the feature changes it (here back to an expression), and `renameParameter` renames in it.
export function countAsField(): boolean {
  const set = run({ type: 'setField', feature: 'lidSketch', path: 'external/va/transform/count', value: 'vents + 1' });
  const renamed = run({ type: 'renameParameter', name: 'vents', to: 'ventCount' });
  return regionsOf(set, 'lidSketch').length === 7 && sketchOf(renamed, 'lidSketch').expressions?.['external/va/transform/count'] === 'ventCount + 1';
}

// ================================================================ what is refused

// A copy is no operand of a constraint of its own sketch, no point a drawn curve may run over, no
// entity to remove or drag, no source of another entry, no axis; a command names a source and an
// axis the sketch has; a count stays in its range; 6e's tools and the fillet do not cut a copy.
export function refusals(): (string | undefined)[] {
  const refused = (command: CommandAfter): string | undefined => {
    const result = engine.preview(command);
    return result.ok ? undefined : result.error.message;
  };
  const tool = sketchTool('trim', contextOf(engine.getState(), 'lidSketch'), { curve: 'm/1/c2', at: [-42, 27] }, freshIds(engine.getState().document, 'x_'));
  // the same place without a curve: it lies on the copy, which is nearer than any own curve (6e
  // refuses a place that means a curve that is not own, with the reason of the copy)
  const placed = sketchTool('trim', contextOf(engine.getState(), 'lidSketch'), { at: [-42, 27] }, freshIds(engine.getState().document, 'x_'));
  // a rectangle whose first corner snaps to a copied point: the batch would tie a new point to the copy
  const snapped = sketchTool('rectangle', contextOf(engine.getState(), 'lidSketch'), { first: { at: [-42, 5], snap: { kind: 'point', id: 'm/1/a2' } }, opposite: { at: [-30, 12] } }, freshIds(engine.getState().document, 'x_'));
  return [
    refused(constrain('lidSketch', 'kx', { type: 'horizontal', line: 'm/1/c3' })), // COPY_IN_CONSTRAINT('m/1/c3', 'm', 'c3')
    refused(line('lidSketch', 'lx', 'm/1/a1', 'a1')), // a curve runs over own points and the origin only
    refused({ type: 'removeEntity', sketch: 'lidSketch', id: 'm/1/c1' }),
    refused({ type: 'dragPoint', sketch: 'lidSketch', point: 'm/1/a2', x: 0, y: 0 }),
    refused(addPattern('lidSketch', 'p2', { type: 'pattern', sources: ['m/1/c2'], transform: { type: 'mirror', axis: 'c1' } })), // a pattern of a copy (deferred)
    refused(addPattern('lidSketch', 'p3', { type: 'pattern', sources: ['c2'], transform: { type: 'mirror', axis: 'r1' } })), // an arc is no axis
    refused(addPattern('lidSketch', 'p4', { type: 'pattern', sources: ['nothing'], transform: { type: 'mirror', axis: 'origin/y' } })),
    refused(addPattern('lidSketch', 'p5', { type: 'pattern', sources: ['c2'], transform: { type: 'linear', direction: 'm/1/c1', count: 3, span: { type: 'spacing', spacing: 5 } } })), // a copy as the direction
    refused(addPattern('lidSketch', 'p6', { type: 'pattern', sources: ['c2'], transform: { type: 'circular', center: 'origin', count: 201, span: { type: 'full' } } })),
    refused(addPattern('lidSketch', 'p7', { type: 'pattern', sources: ['c2', 'c2'], transform: { type: 'mirror', axis: 'origin/y' } })),
    refused(addPattern('lidSketch', 'p8', { type: 'pattern', sources: ['origin/y'], transform: { type: 'mirror', axis: 'c1' } })), // an axis of the origin is no source
    refused({ type: 'addExternal', sketch: 'lidSketch', id: 'p9', ref: { type: 'pattern', sources: ['c2'], transform: { type: 'mirror', plane: 'origin/y' } } } as unknown as CommandAfter), // D53's name: "a mirror in a sketch is about a line: `axis`, not `plane`"
    refused({ type: 'updateExternal', sketch: 'lidSketch', id: 'm', ref: { type: 'edge', body: 'stand', edge: { a: { feature: 'stand', role: 'endCap' }, b: { feature: 'stand', role: 'side', curve: 'bl1' } }, kind: 'line' } }), // derived to reference
    tool.ok ? undefined : tool.message, // COPY_IN_TOOL('m/1/c2', 'm', 'c2')
    placed.ok ? undefined : placed.message, // names `m/1/c2`, with COPY_IN_TOOL('m/1/c2', 'm', 'c2')
    snapped.ok ? undefined : snapped.message, // first: COPY_AS_SNAP('m/1/a2', 'm', 'a2')
  ];
}
export const constraintText = COPY_IN_CONSTRAINT('m/1/c3', 'm', 'c3');
export const snapText = COPY_AS_SNAP('m/1/a2', 'm', 'a2');
export const toolText = COPY_IN_TOOL('m/1/c2', 'm', 'c2');

// A source removed by hand: the entry stays valid (the document saves and loads), the copies of the
// rest are made, and the sketch warns which source is gone.
export function sourceRemoved(): boolean {
  const state = done(engine.preview({ type: 'removeEntity', sketch: 'lidSketch', id: 'c2' }));
  const warning = state.evaluation.features['lidSketch'].warnings.find((w) => w.code === 'brokenCopies');
  return same(warning?.refs, ['m', 'c2']) && resultOf(state, 'lidSketch').curves['m/1/c3'] !== undefined && resultOf(state, 'lidSketch').curves['m/1/c2'] === undefined;
}

// ================================================================ a circular pattern: the bolt circle

// What the Onshape converter lost (docs/onshape-import.md, "Constraints": sketch patterns): a flange
// with six bolt holes on a circle. Onshape keeps the six circles as curves tied by a
// `CIRCULAR_PATTERN` constraint; the converter can keep the first circle and write the rest as one
// entry. The holes are holes of the flange's region, so a count of 8 needs no patch.
export function boltCircle(): boolean {
  const s = 'flange';
  run({ type: 'addFeature', feature: { id: s, name: 'Flange', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  run(
    { type: 'addCurve', sketch: s, id: 'rim', curve: { type: 'circle', center: 'origin' }, radius: 30 },
    point(s, 'b1', 22, 0),
    { type: 'addCurve', sketch: s, id: 'bolt', curve: { type: 'circle', center: 'b1' }, radius: 1.6 },
    addPattern(s, 'bc', { type: 'pattern', sources: ['bolt'], transform: { type: 'circular', center: 'origin', count: 6, span: { type: 'full' } } }),
    extrudeRegions('flangeBody', s, [['rim']], 4),
  );
  const six = engine.getState();
  const eight = done(engine.preview({ type: 'setField', feature: s, path: 'external/bc/transform/count', value: 8 }));
  const flange = (count: number): number => (Math.PI * 900 - count * Math.PI * 1.6 * 1.6) * 4;
  return (
    regionsOf(six, s).length === 7 && // the flange with 6 holes, the bolt and copies 1 to 5
    near(resultOf(six, s).points['bc/3/b1']?.x, -22, 1e-9) && // copy 3 turned by π
    near(volumeOf(six, 'flangeBody'), flange(6), 5) && // the circles are polygons within the chord tolerance (about −3.5 mm³)
    near(volumeOf(eight, 'flangeBody'), flange(8), 5)
  );
}

// A ring that a pattern of an open chain closes: a tooth of three lines `l1`, `l2`, `l3` from (20, 0)
// to the point at 15° on the same radius, turned 24 times. The end of each copy is the start of the
// next, at one place, and joins it (measured: the solved end 8.9e-16 off its place; one region of
// 72 lines, 1606.455 mm²; with 23 copies the chain stays open and there is no region).
const polar = (r: number, degrees: number): [number, number] => [r * Math.cos((degrees * Math.PI) / 180), r * Math.sin((degrees * Math.PI) / 180)];
export function gearSketch(): StateAfter {
  const s = 'gear';
  run({ type: 'addFeature', feature: { id: s, name: 'Ring', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  return run(point(s, 't0', ...polar(20, 0)), point(s, 't1', ...polar(24, 5)), point(s, 't2', ...polar(24, 10)), point(s, 't3', ...polar(20, 15)), line(s, 'l1', 't0', 't1'), line(s, 'l2', 't1', 't2'), line(s, 'l3', 't2', 't3'));
}
export const toothRing = (): CommandAfter => addPattern('gear', 'teeth', { type: 'pattern', sources: ['l1', 'l2', 'l3'], transform: { type: 'circular', center: 'origin', count: 24, span: { type: 'full' } } });
export function ring(): boolean {
  gearSketch();
  const closed = run(toothRing());
  const open = done(engine.preview({ type: 'setField', feature: 'gear', path: 'external/teeth/transform/count', value: 23 }));
  return regionsOf(closed, 'gear').length === 1 && regionsOf(closed, 'gear')[0].length === 72 && resultOf(closed, 'gear').valid && regionsOf(open, 'gear').length === 0;
}

// ================================================================ a grid

// Square vents in rows and columns: copy i along the first direction and j along the second is
// `<entry>/<i + 1000 · j>/<source>`, as in a grid of features (D53); 14 × 14 places at most 200.
export const gridCopy = (i: number, j: number, source: Id): Id => `g/${i + 1000 * j}/${source}`;
// A square of side 2 at (−20, −10) in the vents sketch; the second direction is the Y axis.
export const grid = (): StateAfter =>
  run(
    point('ventSketch', 'q1', -20, -10),
    point('ventSketch', 'q2', -18, -10),
    point('ventSketch', 'q3', -18, -8),
    point('ventSketch', 'q4', -20, -8),
    line('ventSketch', 'sq1', 'q1', 'q2'),
    line('ventSketch', 'sq2', 'q2', 'q3'),
    line('ventSketch', 'sq3', 'q3', 'q4'),
    line('ventSketch', 'sq4', 'q4', 'q1'),
    addPattern('ventSketch', 'g', { type: 'pattern', sources: ['sq1', 'sq2', 'sq3', 'sq4'], transform: { type: 'linear', direction: 'origin/x', count: 14, span: { type: 'spacing', spacing: 3 }, second: { direction: 'origin/y', count: 14, span: { type: 'spacing', spacing: -3 } } } }),
  );
export const gridTooLarge = (): string | undefined => {
  const state = done(engine.preview({ type: 'setField', feature: 'ventSketch', path: 'external/g/transform/second/count', value: 15 }));
  const warning = state.evaluation.features['ventSketch'].warnings.find((w) => w.code === 'brokenCopies');
  return warning?.message; // "… 14 × 15 is 210 places; a pattern has at most 200, the source included"
};

// ================================================================ a copy that lies on its source

// A D shape (a half circle `h` and its diameter `dia` on the axis) mirrored: the image of `dia` lies
// on `dia` and forms no regions; the image of `h` is the other half. Measured: two regions
// `{dia, h}` and `{dia, m/1/h}`, 156.880 mm² each.
export function dShapeSketch(): StateAfter {
  const s = 'half';
  run({ type: 'addFeature', feature: { id: s, name: 'D', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  return run(point(s, 'top', 0, 10), point(s, 'bot', 0, -10), arc(s, 'h', 'origin', 'bot', 'top'), line(s, 'dia', 'top', 'bot'), addPattern(s, 'm', { type: 'pattern', sources: ['h', 'dia'], transform: { type: 'mirror', axis: 'origin/y' } }));
}
export const dShape = (state: StateAfter): boolean =>
  same(regionsOf(state, 'half'), [['dia', 'h'], ['dia', 'm/1/h']]) && resultOf(state, 'half').curves['m/1/dia']?.regions === false;

// ================================================================ the fillet of a source corner

// A corner of two source lines filleted (D52): the fillet re-points the two lines to the ends of
// its arc, which leaves each with an open end, and the arc it makes stands between those two open
// ends of the entry's listed curves, so it joins the entry (measured, design.md, Q5), by
// `updateExternal` of the entry's input form, so the count stays the expression `copies`; the copy
// of the arc joins every stored region that holds the copies of both lines with one number, read
// from the region, so the region of copy 2, which the count 2 does not make now, is patched too
// and is right when the count reaches 3. The sketch `tri`: an own triangle `ul1`, `ul2`, `ul3` with the corner `u2`
// between `ul1` and `ul2`, a row of it along `ul1`; `triangles` extrudes the source and copy 1,
// `third` the region of copy 2.
const TRIANGLE = ['ul1', 'ul2', 'ul3'];
const copyOf = (copy: number, curves: Id[]): Id[] => curves.map((curve) => `tr/${copy}/${curve}`);
export function triangles(): StateAfter {
  const s = 'tri';
  run({ type: 'setParameter', name: 'copies', expr: '2' }, { type: 'addFeature', feature: { id: s, name: 'Triangles', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  run(point(s, 'u1', 0, 100), point(s, 'u2', 30, 100), point(s, 'u3', 0, 120), line(s, 'ul1', 'u1', 'u2'), line(s, 'ul2', 'u2', 'u3'), line(s, 'ul3', 'u3', 'u1'));
  run(addPattern(s, 'tr', { type: 'pattern', sources: TRIANGLE, transform: { type: 'linear', direction: 'ul1', count: 'copies', span: { type: 'spacing', spacing: 40 } } }));
  return run(extrudeRegions('triangles', s, [TRIANGLE, copyOf(1, TRIANGLE)], 3), extrudeRegions('third', s, [copyOf(2, TRIANGLE)], 3));
}
export function filletOfSource(): boolean {
  const state = engine.getState();
  const before = state.evaluation.features['third'].error?.code; // noProfile: the count makes no copy 2
  const made = sketchTool('fillet', contextOf(state, 'tri'), { corner: 'u2', radius: 3 }, freshIds(state.document, 'f_'));
  if (!made.ok) return false;
  const after = run(...made.commands);
  const arc = made.ids.arc[0];
  const entry = sketchOf(after, 'tri').external['tr'] as unknown as SketchPattern;
  const regionOf = (feature: Id): Id[][] => {
    const f = after.document.features.find((g) => g.id === feature);
    return f?.type === 'extrude' && f.profile.type === 'regions' ? f.profile.regions.map((r) => r.outerLoop) : [];
  };
  const three = run({ type: 'setParameter', name: 'copies', expr: '3' });
  return (
    before === 'noProfile' &&
    same((made.ids as unknown as CopyPatchIds).entries, ['tr']) &&
    entry.sources.includes(arc) &&
    sketchOf(after, 'tri').expressions?.['external/tr/transform/count'] === 'copies' &&
    regionOf('triangles').every((loop) => loop.includes(arc) || loop.includes(`tr/1/${arc}`)) &&
    regionOf('third').every((loop) => loop.includes(`tr/2/${arc}`)) &&
    three.evaluation.features['third'].status === 'ok'
  );
}

// ================================================================ step 6: the second notch

// A cable notch in the top line `c3` of the lid's source half: a circle `nk` of radius 4 whose
// centre lies on the line at x = 20 crosses it at x = 16 and x = 24. Two trims leave the notch:
// the piece of the line inside the circle, and the arc of the circle outside the outline, each
// given by a place on it and no curve (6e: "An AI names a piece by a place"). On each of the four
// paths the entry of the mirror ends with the two pieces of `c3` and the arc inside in the place of
// `c3`, the copy has the notch at x = −20, and the lid is one region less two half discs (measured
// on the four, design.md, Q1: 7 sources, no open end, 4464.240 mm² against 4464.274 by hand).
// What joins the entry, and in which batch (the open-end rule, design.md, "Copies and the sketch
// tools"):
// - under the lid (a feature reads regions, so the repair is on), the line first: the first trim
//   cuts the circle into two arcs and takes the stretch of `c3` between them; both arcs are made
//   by the batch and stand between the two open ends of `c3`'s pieces, so both join; the second
//   trim removes the outer arc whole, and it leaves the list;
// - under the lid, the circle first: the first trim cuts `c3` in three and leaves the inner arc,
//   whose ends are ends of two listed pieces each, so it stays out; the second removes the middle
//   piece whole, which opens both ends the arc stands at, and the arc, there already, joins;
// - before the lid (nothing reads regions, so the repair is off), the line first: the first trim
//   cuts `c3` alone; the second turns the circle into the arc between the two open ends, and it
//   joins (the path the rule of the revision missed);
// - before the lid, the circle first: the first trim turns the circle into an arc held on `c3`,
//   which is not cut, so no entry is patched; the second cuts `c3` at the ends of the arc and takes
//   the stretch between them, and the arc, there already, joins.
const NOTCH_R = 4;
export function secondNotch(lineFirst: boolean, underTheLid: boolean): boolean {
  // run after `lid()` (underTheLid) or after `mirrored()` alone
  run({ type: 'addPoint', sketch: 'lidSketch', id: 'nc', x: 20, y: H }, { type: 'addCurve', sketch: 'lidSketch', id: 'nk', curve: { type: 'circle', center: 'nc' }, radius: NOTCH_R });
  const trim = (at: [number, number], prefix: string): CopyPatchIds => {
    const state = engine.getState();
    const made = sketchTool('trim', contextOf(state, 'lidSketch'), { at }, freshIds(state.document, prefix));
    if (!made.ok) return fail(made.message);
    run(...made.commands);
    return made.ids as unknown as CopyPatchIds;
  };
  const [inLine, outside]: [number, number][] = [[20, H], [20, H + NOTCH_R]];
  const first = trim(lineFirst ? inLine : outside, 'n1_');
  const second = trim(lineFirst ? outside : inLine, 'n2_');
  let state = engine.getState();
  const sketch = sketchOf(state, 'lidSketch');
  const entry = sketch.external['m'] as unknown as SketchPattern;
  // the arc of the notch: under the ID of the circle unless both arcs were made in the first batch
  // (the repair on, the line first), where which of the two keeps the ID is not asked
  const arcs = entry.sources.filter((id) => sketch.curves[id]?.type === 'arc' && id !== 'r1' && id !== 'r2');
  const lidLoop = regionsOf(state, 'lidSketch').find((loop) => loop.includes('c1')) ?? [];
  if (!underTheLid) state = run(extrudeRegions('lid', 'lidSketch', [lidLoop], 'T'));
  return (
    // the circle trimmed first with the repair off changes no listed curve
    same(first.entries, !lineFirst && !underTheLid ? [] : ['m']) &&
    same(second.entries, ['m']) &&
    entry.sources.includes('c3') &&
    arcs.length === 1 &&
    ((lineFirst && underTheLid) || arcs[0] === 'nk') &&
    entry.sources.length === 7 && // c1, r1, c2, r2, the two pieces of c3, the arc
    regionsOf(state, 'lidSketch').length === 1 &&
    lidLoop.includes(arcs[0]) &&
    lidLoop.includes(`m/1/${arcs[0]}`) &&
    resultOf(state, 'lidSketch').valid &&
    resultOf(state, 'lidSketch').openEnds === undefined &&
    state.evaluation.features['lid'].status === 'ok' &&
    // two half discs of radius 4 gone, within the chord tolerance (the lid without the vents)
    near(volumeOf(state, 'lid'), (LID - Math.PI * NOTCH_R * NOTCH_R) * T, lidAllowance(2))
  );
}
export const NOTCH_PATHS: [lineFirst: boolean, underTheLid: boolean][] = [[true, true], [false, true], [true, false], [false, false]];

// A split by a rib the mirror does not list (run on the lid of `lid()`, before the notch and the
// vents): a line from below the bottom `c1` to above the top `c3` of the source half, cut where it
// meets them by `split` without a curve. A split adds only pieces: the entry gets the pieces of
// `c1` and `c3` in their place and nothing of the rib (each cut is the end of two listed pieces, so
// no piece of the rib stands between open ends: measured, design.md, Q2); the lid's extrusion is
// patched to the two regions the rib makes of it, and its body is the same.
export function ribSplit(): boolean {
  const before = volumeOf(engine.getState(), 'lid');
  run(point('lidSketch', 'rb0', 30, -3), point('lidSketch', 'rb1', 30, H + 3), line('lidSketch', 'rib', 'rb0', 'rb1'));
  const state = engine.getState();
  const made = sketchTool('split', contextOf(state, 'lidSketch'), {}, freshIds(state.document, 'r_'));
  if (!made.ok) return false;
  const after = run(...made.commands);
  const sketch = sketchOf(after, 'lidSketch');
  const entry = sketch.external['m'] as unknown as SketchPattern;
  // the pieces of the rib: `rib` and the new lines that stand at x = 30
  const ofRib = ['rib', ...made.ids.added.filter((id) => { const c = sketch.curves[id]; return c?.type === 'line' && near(resultOf(after, 'lidSketch').points[c.a]?.x, 30, 1e-9) && near(resultOf(after, 'lidSketch').points[c.b]?.x, 30, 1e-9); })];
  const ids = made.ids as unknown as CutIdsAfter;
  return (
    same(ids.entries, ['m']) &&
    Object.keys(made.ids).indexOf('entries') === 15 && // the sixteenth list, after `broken`
    ofRib.length === 3 &&
    ofRib.every((id) => !entry.sources.includes(id)) &&
    entry.sources.length === 7 && // c1 and c3 in two pieces each, r1, c2, r2
    regionsOf(after, 'lidSketch').length === 2 &&
    near(volumeOf(after, 'lid'), before, 1e-6)
  );
}

// The same split under a chamfer of the lid's rim (run on the lid of `lid()` in place of
// `ribSplit`). The rim is one smooth chain, so the chamfer lists the edge of the top with the side
// of every curve of the outline, the copies among them (D63). The split cuts `c1` and `c3`, and
// with them their copies: 6e rewrites the edge of a cut side to its pieces, and reads a copy
// through the same function (`piecesOf`), which 6c makes answer `m/1/<piece>`; so the chamfer has
// an edge for each of the four new pieces too, appended after the ten it had (a face of the
// chamfer is named by the place of its edge), and stays `ok`. Without the rewrite of the copies'
// sides it is `unsupportedEdge`: the edge along `m/1/c3` continues smoothly into one that is not
// listed (the error 6e measured for own curves). Not run: no code has both packages yet.
export function ribSplitUnderChamfer(): boolean {
  const top = { feature: 'lid', role: 'endCap' } as const;
  const edgeOf = (curve: Id) => ({ a: top, b: { feature: 'lid', role: 'side', curve } as const });
  run({ type: 'addFeature', feature: { id: 'rim', name: 'Rim', suppressed: false, type: 'chamfer', body: 'lid', edges: LID_REGION.map(edgeOf), distance: 0.5 } });
  const split = ribSplit();
  const state = engine.getState();
  const rim = state.document.features.find((f) => f.id === 'rim');
  const sides = rim?.type === 'chamfer' ? rim.edges.map((edge) => (edge.b.role === 'side' ? edge.b.curve : '')) : [];
  const sketch = sketchOf(state, 'lidSketch');
  const entry = sketch.external['m'] as unknown as SketchPattern;
  const pieces = entry.sources.filter((id) => !['c1', 'r1', 'c2', 'r2', 'c3'].includes(id)); // the new piece of c1 and of c3
  return (
    split &&
    state.evaluation.features['rim'].status === 'ok' &&
    same(sides.slice(0, 10), LID_REGION) && // every place kept
    same([...sides.slice(10)].sort(), [...pieces, ...pieces.map((id) => `m/1/${id}`)].sort())
  );
}

// An own curve across a copy (run on the lid of `lid()`): a line drawn across the copied flank
// `m/1/c2`. The profile is invalid and no tool can cut there: a copy is not cut, and a point
// cannot be held on it. The query of 6e lists the place with `fix: 'none'` and the reason of 6c
// (`contactFix`); `split` without a curve refuses with that reason; an extension that would end on
// the copy while the profile is valid is refused by 6e. Moving the line off the copy cures it.
export function ownAcrossACopy(): boolean {
  const valid = sketchTool('extend', contextOf(run(point('lidSketch', 'xa', -30, 27), point('lidSketch', 'xb', -35, 27), line('lidSketch', 'across', 'xa', 'xb')), 'lidSketch'), { curve: 'across', end: 'b' }, freshIds(engine.getState().document, 'x_'));
  const state = run({ type: 'dragPoint', sketch: 'lidSketch', point: 'xb', x: -50, y: 27 });
  const found = unwrap(engine.query('sketchContacts', { sketch: 'lidSketch' }));
  const split = sketchTool('split', contextOf(state, 'lidSketch'), {}, freshIds(state.document, 'x_'));
  return (
    !valid.ok && // the extension would end on `m/1/c2`
    !found.valid &&
    found.total === 1 &&
    same(found.contacts.map((c) => [c.kind, c.curves, c.fix, c.why]), [['crossing', ['across', 'm/1/c2'], 'none', OWN_CROSSES_COPY('m/1/c2', 'm')]]) &&
    !split.ok &&
    state.evaluation.features['lid'].error?.code === 'invalidProfile'
  );
}

// ================================================================ an end that stays open

// A half whose top ends 0.01 mm off the axis, with no constraint that holds it there: the outline
// of the copies does not close, the sketch has no region, and the result says which end is open and
// how far it is from what (measured: `m/1/e5`, nearest `e5`, 0.02 mm).
export function openEnd(): boolean {
  const s = 'open';
  run({ type: 'addFeature', feature: { id: s, name: 'Open', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  const state = run(point(s, 'e1', 10, 0), point(s, 'e2', 10, 8), point(s, 'e5', 0.01, 8), line(s, 'o1', 'origin', 'e1'), line(s, 'o2', 'e1', 'e2'), line(s, 'o3', 'e2', 'e5'), addPattern(s, 'm', { type: 'pattern', sources: ['o1', 'o2', 'o3'], transform: { type: 'mirror', axis: 'origin/y' } }));
  const open = resultOf(state, s).openEnds;
  return resultOf(state, s).valid && regionsOf(state, s).length === 0 && open?.count === 1 && same(open.ends.map((end) => [end.end, end.reason, end.near]), [['m/1/e5', 'apart', ['e5']]]) && near(open.ends[0].distance, 0.02, 1e-9) && state.evaluation.features[s].warnings.length === 0;
}

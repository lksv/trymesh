// Validation scenario 15 (a cover for a controller board), the part of package 6c, written as calls
// against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot
// be written here is a hole in the contract. Lines marked `@ts-expect-error` must not compile.
//
// Step 4 of the scenario: the lid outline, one half drawn and mirrored about the Y axis of the
// origin; the mirrored half closes into one region with the original. Step 5: vents, one slot and
// a linear pattern with the count `vents`: a row in the lid's own sketch, whose copies are holes of
// the lid's region and follow the count with no patch, and a row in a sketch of its own, of which
// a cut takes the regions of copies 1 and 3. Step 7, the part of 6c: `vents` from 5 to 7 keeps the
// cut's region references; 3 makes copy 3 a broken reference, and 5 brings it back. Then the
// rest of the mechanism: a circular pattern (the bolt circle the Onshape converter lost), a grid,
// a copy that lies on its source, the fillet of a source corner, and the refusals.
//
// The axes `origin/x` and `origin/y` are 6b's. 6c is implemented before 6b; its own tests mirror
// about a construction line through the origin instead (`ay` below), which is what the numbers in
// the comments were measured with (design.md, "Measured": the derive prototyped in the scratchpad,
// the copies put into the real `detectProfile`, the sketches solved by the real planegcs adapter).
// The grip flank of step 4 is a spline of 6d; here it is a line, so that the volume can be computed
// by hand, and 6d puts the spline in (design.md, "Later kinds").

import type { Id, SketchFeature } from '../../../packages/engine/src/index';
import type { CommandAfter, StateAfter } from '../00-prep/contract';
import { done, engine, fail, run } from '../2a-offset/calls';
import type { SketchResultAfter } from '../6a-sketch-prep/contract';
import { contextOf } from '../6e-trim-extend-split/calls';
import { freshIds, sketchTool } from '../6e-trim-extend-split/contract';
import type { SketchPattern } from './contract';
import { COPY_IN_CONSTRAINT, KEY_OF_SIDE_OF_A_COPY, SIDE_OF_A_COPY } from './contract';

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
// The arcs are polygons within the chord tolerance (0.01 mm): the measured areas are below these
// by up to 0.2 mm² for the outline and 0.06 mm² per slot ("Measured").
const CHORD = 0.3;

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

// ================================================================ step 4: the lid outline

// The right half, drawn off its place and solved: `c1` along the bottom from the origin, the corner
// arc `r1`, the flank `c2` (6d: a spline), the corner arc `r2`, the top `c3`, which ends at `a5` on
// the Y axis by a constraint. Fully determined (measured: 0 degrees of freedom; `a5` solved to
// x = 0 exactly).
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
    // 6b: the Y axis of the origin; before 6b a vertical construction line from the origin
    constrain(s, 'k12', { type: 'pointOnCurve', point: 'a5', curve: 'origin/y' }),
  );
}

// The mirror: one entry, the five curves about the Y axis. Its copies are `m/1/c1` … `m/1/c3`, over
// `m/1/origin`, `m/1/a1` … `m/1/a5` and the centres; `m/1/origin` joins `origin` and `m/1/a5` joins
// `a5` by position, so the outline is one loop (measured: the only pairs the derive declares).
export function mirrored(): StateAfter {
  parameters();
  lidHalf();
  return run(addPattern('lidSketch', 'm', { type: 'pattern', entities: ['c1', 'r1', 'c2', 'r2', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } }));
}
export const LID_REGION: Id[] = ['c1', 'c2', 'c3', 'm/1/c1', 'm/1/c2', 'm/1/c3', 'm/1/r1', 'm/1/r2', 'r1', 'r2'];

// One region whose outer loop holds both halves (measured: its polygon 4514.3488 mm², by hand
// 4514.5398); the arcs of the copy run counter-clockwise from the image of the source's end
// (`m/1/r1` from the image of `a2` to the image of `a1`); the copies are in the result as curves
// that are not own; the solver saw none of them (the freedom of the half, 0).
export function oneRegion(state: StateAfter): boolean {
  const result = resultOf(state, 'lidSketch');
  return (
    result.valid &&
    same(regionsOf(state, 'lidSketch'), [LID_REGION]) &&
    same(result.curves['m/1/r1'], { shape: { type: 'arc', center: 'm/1/q1', start: 'm/1/a2', end: 'm/1/a1' }, source: 'derived', regions: true }) &&
    near(result.points['m/1/a2']?.x, -W / 2, 1e-9) &&
    result.degreesOfFreedom === 0 &&
    state.evaluation.features['lidSketch'].status === 'ok'
  );
}

// The lid from that region. Its side faces are named by the curves, the copies included: the face
// `{ role: 'side', curve: 'm/1/c2' }` is the flank of the left half, keyed with the slashed ID quoted.
export function lid(): StateAfter {
  return run(extrudeRegions('lid', 'lidSketch', [LID_REGION], 'T'));
}
export const lidChecks = (state: StateAfter): boolean =>
  near(volumeOf(state, 'lid'), LID * T, CHORD * T) &&
  state.evaluation.faceNames.some((name) => name.role === 'side' && name.feature === 'lid' && name.curve === (SIDE_OF_A_COPY as { curve: Id }).curve) &&
  KEY_OF_SIDE_OF_A_COPY === 'lid/side/"m/1/c2"';

// A change of the source moves the copy: the width 90 moves `m/1/c2` to x = −45, and the lid follows.
export const wider = (): boolean => {
  const state = done(engine.preview({ type: 'setParameter', name: 'W', expr: '90' }));
  return near(resultOf(state, 'lidSketch').points['m/1/a2']?.x, -45, 1e-6) && near(volumeOf(state, 'lid'), (90 * H - (4 - Math.PI) * R * R) * T, CHORD * T);
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
  return run(addPattern('lidSketch', 'va', { type: 'pattern', entities: ['vg1', 've1', 'vg2', 've2'], transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } } }));
}
// Measured: 6 regions (the lid with 5 holes, the slot, copies 1 to 4); the lid's region unchanged.
export const rowAChecks = (state: StateAfter): boolean =>
  regionsOf(state, 'lidSketch').length === 6 &&
  regionsOf(state, 'lidSketch').some((loop) => same(loop, ['va/4/ve1', 'va/4/ve2', 'va/4/vg1', 'va/4/vg2'])) &&
  near(volumeOf(state, 'lid'), (LID - 5 * SLOT) * T, CHORD * T) && // measured 8688.604
  sketchOf(state, 'lidSketch').expressions?.['external/va/transform/count'] === 'vents';

// Row B, in a sketch of its own on the lid (here on XY, through which the cut goes): the same slot
// at y = 40 and a pattern of it with the count `vents`; the cut takes the regions of copies 1 and 3.
export function rowB(): StateAfter {
  const s = 'ventSketch';
  run({ type: 'addFeature', feature: { id: s, name: 'Vents', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  run(...slot(s, 'w', -12, 40));
  run(addPattern(s, 'vb', { type: 'pattern', entities: ['wg1', 'we1', 'wg2', 'we2'], transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } } }));
  return run(extrudeRegions('ventCut', s, [copyRegion(1), copyRegion(3)], 'T', 'cut', ['lid']));
}
const copyRegion = (copy: number): Id[] => ['wg1', 'we1', 'wg2', 'we2'].map((curve) => `vb/${copy}/${curve}`);
export const rowBChecks = (state: StateAfter): boolean => state.evaluation.features['ventCut'].status === 'ok' && near(volumeOf(state, 'lid'), (LID - 7 * SLOT) * T, CHORD * T);

// ================================================================ step 7: vents from 5 to 7, then 3

// 7: row A has 7 holes, the lid loses two more slots; the cut keeps copies 1 and 3, which stand
// where they stood (the spacing moves none of them). No feature is patched (measured: copies 1 and
// 3 of row B, 34.0094 mm² each, with 5 and with 7).
export function sevenVents(): boolean {
  const before = engine.getState();
  const state = run({ type: 'setParameter', name: 'vents', expr: '7' });
  const cut = state.document.features.find((f) => f.id === 'ventCut');
  const cutBefore = before.document.features.find((f) => f.id === 'ventCut');
  return (
    regionsOf(state, 'lidSketch').length === 8 &&
    near(volumeOf(state, 'lid'), (LID - 7 * SLOT - 2 * SLOT) * T, CHORD * T) && // measured row A 8552.566 before the cut
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
  return [
    refused(constrain('lidSketch', 'kx', { type: 'horizontal', line: 'm/1/c3' })), // COPY_IN_CONSTRAINT('m/1/c3', 'm', 'c3')
    refused(line('lidSketch', 'lx', 'm/1/a1', 'a1')), // a curve runs over own points and the origin only
    refused({ type: 'removeEntity', sketch: 'lidSketch', id: 'm/1/c1' }),
    refused({ type: 'dragPoint', sketch: 'lidSketch', point: 'm/1/a2', x: 0, y: 0 }),
    refused(addPattern('lidSketch', 'p2', { type: 'pattern', entities: ['m/1/c2'], transform: { type: 'mirror', axis: 'origin/x' } })), // a pattern of a copy (deferred)
    refused(addPattern('lidSketch', 'p3', { type: 'pattern', entities: ['c2'], transform: { type: 'mirror', axis: 'r1' } })), // an arc is no axis
    refused(addPattern('lidSketch', 'p4', { type: 'pattern', entities: ['nothing'], transform: { type: 'mirror', axis: 'origin/y' } })),
    refused(addPattern('lidSketch', 'p5', { type: 'pattern', entities: ['c2'], transform: { type: 'linear', direction: 'm/1/c1', count: 3, span: { type: 'spacing', spacing: 5 } } })), // a copy as the direction
    refused(addPattern('lidSketch', 'p6', { type: 'pattern', entities: ['c2'], transform: { type: 'circular', center: 'origin', count: 201, span: { type: 'full' } } })),
    refused(addPattern('lidSketch', 'p7', { type: 'pattern', entities: ['c2', 'c2'], transform: { type: 'mirror', axis: 'origin/y' } })),
    refused({ type: 'updateExternal', sketch: 'lidSketch', id: 'm', ref: { type: 'edge', body: 'lid', edge: { a: { feature: 'lid', role: 'endCap' }, b: { feature: 'lid', role: 'side', curve: 'c1' } }, kind: 'line' } }), // derived to reference
    tool.ok ? undefined : tool.message, // COPY_IN_TOOL('m/1/c2', 'm', 'c2')
  ];
}
export const constraintText = COPY_IN_CONSTRAINT('m/1/c3', 'm', 'c3');

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
    addPattern(s, 'bc', { type: 'pattern', entities: ['bolt'], transform: { type: 'circular', center: 'origin', count: 6, span: { type: 'full' } } }),
    extrudeRegions('flangeBody', s, [['rim']], 4),
  );
  const six = engine.getState();
  const eight = done(engine.preview({ type: 'setField', feature: s, path: 'external/bc/transform/count', value: 8 }));
  const flange = (count: number): number => (Math.PI * 900 - count * Math.PI * 1.6 * 1.6) * 4;
  return (
    regionsOf(six, s).length === 7 && // the flange with 6 holes, the bolt and copies 1 to 5
    near(resultOf(six, s).points['bc/3/b1']?.x, -22, 1e-9) && // copy 3 turned by π
    near(volumeOf(six, 'flangeBody'), flange(6), 1) && // the circles are polygons within the chord tolerance
    near(volumeOf(eight, 'flangeBody'), flange(8), 1)
  );
}

// A ring that a pattern of an open chain closes: a tooth of three lines `l1`, `l2`, `l3` in the
// sketch `gear` from (20, 0) to the point at 15° on the same radius, turned 24 times. The end of each copy is the start of the next, at one
// place, and joins it (measured: the solved end 8.9e-16 off its place; one region of 72 lines,
// 1606.455 mm²; with 23 copies the chain stays open and there is no region).
export const toothRing = (): CommandAfter => addPattern('gear', 'teeth', { type: 'pattern', entities: ['l1', 'l2', 'l3'], transform: { type: 'circular', center: 'origin', count: 24, span: { type: 'full' } } });

// ================================================================ a grid

// Square vents in rows and columns: copy i along the first direction and j along the second is
// `<entry>/<i + 1000 · j>/<source>`, as in a grid of features (D53); 14 × 14 places at most 200.
export const gridCopy = (i: number, j: number, source: Id): Id => `g/${i + 1000 * j}/${source}`;
export const grid = (): CommandAfter =>
  addPattern('ventSketch', 'g', { type: 'pattern', entities: ['sq1', 'sq2', 'sq3', 'sq4'], transform: { type: 'linear', direction: 'origin/x', count: 14, span: { type: 'spacing', spacing: 3 }, second: { direction: 'origin/y', count: 14, span: { type: 'spacing', spacing: -3 } } } });
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
  return run(point(s, 'top', 0, 10), point(s, 'bot', 0, -10), arc(s, 'h', 'origin', 'bot', 'top'), line(s, 'dia', 'top', 'bot'), addPattern(s, 'm', { type: 'pattern', entities: ['h', 'dia'], transform: { type: 'mirror', axis: 'origin/y' } }));
}
export const dShape = (state: StateAfter): boolean =>
  same(regionsOf(state, 'half'), [['dia', 'h'], ['dia', 'm/1/h']]) && resultOf(state, 'half').curves['m/1/dia']?.regions === false;

// ================================================================ the fillet of a source corner

// A corner of two source lines filleted (D52): the arc joins the entry, so the copy gets the copy of
// the arc, and the region of the outline gets both arcs in the same batch. The sketch `trapezoid`:
// the right half of a triangle, from the origin to `t2` to `t3` on the axis, mirrored, extruded
// as `plate`.
export function trapezoid(): StateAfter {
  const s = 'trapezoid';
  run({ type: 'addFeature', feature: { id: s, name: 'Trapezoid', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  run(point(s, 't2', 30, 0), point(s, 't3', 0, 20), line(s, 'tl1', 'origin', 't2'), line(s, 'tl2', 't2', 't3'), addPattern(s, 'tm', { type: 'pattern', entities: ['tl1', 'tl2'], transform: { type: 'mirror', axis: 'origin/y' } }));
  return run(extrudeRegions('plate', s, [['tl1', 'tl2', 'tm/1/tl1', 'tm/1/tl2']], 3));
}
export function filletOfSource(): boolean {
  const state = engine.getState();
  const made = sketchTool('fillet', contextOf(state, 'trapezoid'), { corner: 't2', radius: 3 }, freshIds(state.document, 'f_'));
  if (!made.ok) return false;
  const after = run(...made.commands);
  const arcId = made.ids.arc[0];
  const entry = sketchOf(after, 'trapezoid').external['tm'] as unknown as SketchPattern;
  return same(made.ids.entries, ['tm']) && entry.entities.includes(arcId) && regionsOf(after, 'trapezoid').some((loop) => loop.includes(arcId) && loop.includes(`tm/1/${arcId}`)) && after.evaluation.features['plate'].status === 'ok';
}

// Validation scenario 15 (a cover for a controller board), the part of package 6e, written as calls
// against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that
// cannot be written here is a hole in the contract. Lines marked `@ts-expect-error` are calls that
// must not compile.
//
// Step 6 of the scenario: a cable notch. The base of the cover is extruded from an outline of own
// curves (design.md, "Open", 1: the outline of the base is drawn as own lines over the projection
// of 6b, which does not form regions, so that it can be cut). A circle drawn across its bottom edge
// makes the profile invalid; two trims leave one closed loop, and the extrusion of the base is
// patched in the same batches. Then the cases the Onshape converter met: two outlines that
// overlap, split at their crossings and trimmed into one; a line extended to a side; refusals.
//
// The numbers in the comments were measured on 2026-11-17 with a prototype of the rules against
// the real solver and kernel (design.md, "Measured"; the prototype was given the crossings, the
// contact search of the tools was not run).

import { emptySketch } from '../../../packages/engine/src/index';
import type { Id } from '../../../packages/engine/src/index';
import type { CommandAfter, StateAfter } from '../00-prep/contract';
import { done, engine, fail, pointAt, rectangle, run } from '../2a-offset/calls';
import type { CutIds, SketchToolCallAfter, SketchToolInputsAfter } from './contract';
import { EXTEND, SPLIT, TRIM, freshIds, sketchTool } from './contract';

const XY = { kind: 'base', plane: 'XY' } as const;
const near = (value: number | undefined, expected: number, tolerance: number): boolean => value !== undefined && Math.abs(value - expected) < tolerance;
const allOk = (state: StateAfter): boolean => state.document.features.every((feature) => state.evaluation.features[feature.id].status === 'ok');

// What a sketch tool is given: the sketch, its solved state, the values of the parameters and the
// document (D52).
export function contextOf(state: StateAfter, sketch: Id): SketchToolCallAfter {
  const feature = state.document.features.find((f) => f.id === sketch);
  if (feature?.type !== 'sketch') return fail(`no sketch "${sketch}"`);
  return { sketch: feature, result: state.evaluation.features[sketch].sketch, parameters: state.evaluation.parameters, document: state.document };
}
// One tool: the batch is made from the state and executed; one undo takes it back.
function tool<K extends 'trim' | 'extend' | 'split'>(name: K, sketch: Id, input: SketchToolInputsAfter[K], prefix: string): CutIds {
  const state = engine.getState();
  const made = sketchTool(name, contextOf(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) return fail(made.message);
  run(...made.commands);
  return made.ids as CutIds;
}
const refusal = <K extends 'trim' | 'extend' | 'split'>(name: K, sketch: Id, input: SketchToolInputsAfter[K]): string | undefined => {
  const state = engine.getState();
  const made = sketchTool(name, contextOf(state, sketch), input, freshIds(state.document, 'x_'));
  return made.ok ? undefined : made.message;
};
const regionsOf = (state: StateAfter, feature: Id): Id[][] => {
  const f = state.document.features.find((g) => g.id === feature);
  return f?.type === 'extrude' && f.profile.type === 'regions' ? f.profile.regions.map((r) => r.outerLoop) : [];
};

// ---------------------------------------------------------------- a. the base and the notch

// The base: an outline of own lines `ba` (bottom, b1 to b2), `bb`, `bc`, `bd`, W × H with a corner at
// the origin, extruded T up. The notch: a circle of the diameter `cableD` whose centre is `notchY`
// above the middle of the bottom edge.
export function baseWithNotch(): StateAfter {
  run({ type: 'setParameter', name: 'W', expr: '84' }, { type: 'setParameter', name: 'H', expr: '54' }, { type: 'setParameter', name: 'T', expr: '2' });
  run({ type: 'setParameter', name: 'cableD', expr: '8' }, { type: 'setParameter', name: 'notchY', expr: '1.5' });
  run({ type: 'addFeature', feature: emptySketch('baseSketch', 'baseSketch', XY) }, ...rectangle('baseSketch', 'b', 'W', 'H'));
  run({ type: 'addFeature', feature: { id: 'base', name: 'base', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'baseSketch', regions: [{ outerLoop: ['ba', 'bb', 'bc', 'bd'] }] }, extent: { type: 'distance', start: 0, distance: 'T' }, operation: 'new' } });
  return run(
    ...pointAt('baseSketch', 'nc', 'W / 2', 'notchY'),
    { type: 'addCurve', sketch: 'baseSketch', id: 'notch', curve: { type: 'circle', center: 'nc' }, radius: 4 },
    { type: 'addConstraint', sketch: 'baseSketch', id: 'notchD', constraint: { type: 'diameter', curve: 'notch', value: 'cableD', driving: true } },
  );
}
// The circle crosses the bottom edge: the profile is invalid and the base is in error.
export const crossed = (state: StateAfter): boolean => state.evaluation.features['baseSketch'].sketch?.valid === false && state.evaluation.features['base'].error?.code === 'invalidProfile';

// The area of the circle above the edge, by hand: the circle less the segment below the chord.
const above = (centreY: number, r: number): number => {
  const segment = (d: number): number => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
  return centreY >= 0 ? Math.PI * r * r - segment(centreY) : segment(-centreY);
};
const expectedVolume = (W: number, H: number, T: number, cableD: number, notchY: number): number => (W * H - above(notchY, cableD / 2)) * T;

export function notch(): boolean {
  const before = baseWithNotch();
  // Trim 1: the piece of the circle below the edge. The circle becomes an arc under its ID (its
  // diameter dimension with it), and the edge `ba` is cut at the two crossings: `ba` keeps the
  // piece from b1, two new lines follow it, held on its line.
  // Measured: the sketch is valid and as determined as before (0 degrees of freedom, nothing
  // redundant); the base is patched to the two regions that cover the old rectangle (the
  // rectangle less the half disc, and the half disc) and has the volume it had before the circle.
  const first = tool('trim', 'baseSketch', { curve: 'notch', at: [42, -3] }, 't1_');
  const afterFirst = engine.getState();
  const [inner] = first.added; // the piece of `ba` inside the circle (the second piece of `ba`)
  const one =
    first.changed.join() === ['ba', 'notch'].join() &&
    first.added.length === 2 &&
    first.points.length === 2 &&
    first.patched.join() === 'base' &&
    regionsOf(afterFirst, 'base').length === 2 &&
    afterFirst.evaluation.features['baseSketch'].sketch?.degreesOfFreedom === 0 &&
    near(afterFirst.evaluation.bodies['base'].volume, 84 * 54 * 2, 1e-6);
  // Trim 2: the piece of the edge inside the circle, a curve now with no cut inside it: removed
  // whole. The half disc is no longer enclosed: dropped from the base, which keeps the notched
  // outline. Its outer loop is `ba`, the far piece of the edge, `bb`, `bc`, `bd` and the arc.
  const second = tool('trim', 'baseSketch', { curve: inner, at: [42, 0] }, 't2_');
  const state = engine.getState();
  const loop = regionsOf(state, 'base');
  const two = second.removed.includes(inner) && second.dropped.join() === 'base' && loop.length === 1 && loop[0].includes('notch') && loop[0].includes('ba') && !loop[0].includes(inner);
  // Measured on the numbers of a-notch.spike (W 80, H 50, T 10, r 6, notchY 2): 39200.48 for
  // 39199.04 by hand; the arc is a polygon within the chord tolerance, so the hand value is
  // matched to 1e-4 of the volume.
  const volume = near(state.evaluation.bodies['base'].volume, expectedVolume(84, 54, 2, 8, 1.5), 84 * 54 * 2 * 1e-4);
  // the faces: the caps, the four sides of the edges, the side of the arc and of the far piece
  const faces = state.evaluation.faceNames.filter((name) => name.feature === 'base' && name.role === 'side').length === 6;
  return crossed(before) && one && two && volume && faces && allOk(state);
}

// The notch follows its parameters: the dimensions of the circle and of the outline are where they
// were. Measured (on the spike's numbers): r 8 and 4, the centre moved along the edge and across
// it (to 1 below the edge), the outline 20 narrower: solved, valid, the volume by hand within
// the chord tolerance. A circle that no longer reaches the edge is a conflict of the sketch (the
// ends of the arc have to be on the edge), and the base keeps its last shape.
export function notchFollows(): boolean {
  const cases: [string, string, number, number][] = [['cableD', '12', 12, 1.5], ['cableD', '5', 5, 1.5], ['notchY', '-1', 8, -1]];
  const follows = cases.every(([name, expr, d, y]) => {
    const state = done(engine.preview({ type: 'setParameter', name, expr }));
    return allOk(state) && near(state.evaluation.bodies['base'].volume, expectedVolume(84, 54, 2, d, y), 84 * 54 * 2 * 1e-4);
  });
  const away = done(engine.preview({ type: 'setParameter', name: 'notchY', expr: '6' }));
  return follows && away.evaluation.features['baseSketch'].warnings.some((w) => w.code === 'sketchConflict');
}

// ---------------------------------------------------------------- b. what the converter met

// Two outlines that overlap, each dimensioned and extruded on its own, then drawn into one sketch:
// both extrusions are invalid. Split of the whole sketch: four lines cut at two crossings, three
// regions; each extrusion is patched to the regions that cover its rectangle, and the bodies are
// as before (measured: 6000 and 3600). Then the four inner pieces are trimmed into one outline;
// measured: the sketch stays at 0 degrees of freedom through all four, and both extrusions end
// on the union.
export function overlapping(): boolean {
  run({ type: 'addFeature', feature: emptySketch('pads', 'pads', XY) }, ...rectangle('pads', 'A', '40', '30'));
  run({ type: 'addFeature', feature: { id: 'padA', name: 'padA', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'pads', regions: [{ outerLoop: ['Aa', 'Ab', 'Ac', 'Ad'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } });
  // B: 40 × 30 with its corner B1 at (20, 10), dimensioned from the origin
  run(
    ...pointAt('pads', 'B1', '20', '10'),
    ...pointAt('pads', 'B3', '60', '40'),
    { type: 'addPoint', sketch: 'pads', id: 'B2', x: 60, y: 10 },
    { type: 'addPoint', sketch: 'pads', id: 'B4', x: 20, y: 40 },
    ...(['B1', 'B2', 'B3', 'B4'] as const).map((p, i): CommandAfter => ({ type: 'addCurve', sketch: 'pads', id: `B${'abcd'[i]}`, curve: { type: 'line', a: p, b: `B${((i + 1) % 4) + 1}` } })),
    { type: 'addConstraint', sketch: 'pads', id: 'Bh1', constraint: { type: 'horizontal', line: 'Ba' } },
    { type: 'addConstraint', sketch: 'pads', id: 'Bv1', constraint: { type: 'vertical', line: 'Bb' } },
    { type: 'addConstraint', sketch: 'pads', id: 'Bh2', constraint: { type: 'horizontal', line: 'Bc' } },
    { type: 'addConstraint', sketch: 'pads', id: 'Bv2', constraint: { type: 'vertical', line: 'Bd' } },
  );
  const crossedPads = run({ type: 'addFeature', feature: { id: 'padB', name: 'padB', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'pads', regions: [{ outerLoop: ['Ba', 'Bb', 'Bc', 'Bd'] }] }, extent: { type: 'distance', start: 0, distance: 3 }, operation: 'new' } });
  const split = tool('split', 'pads', {}, 's_');
  const state = engine.getState();
  const splitOk =
    crossedPads.evaluation.features['padA'].error?.code === 'invalidProfile' &&
    split.changed.join() === ['Ab', 'Ac', 'Ba', 'Bd'].join() &&
    split.points.length === 2 && // (40, 10), where Ab and Ba are cut, and (20, 30), where Ac and Bd are
    split.patched.join() === ['padA', 'padB'].join() &&
    regionsOf(state, 'padA').length === 2 &&
    regionsOf(state, 'padB').length === 2 &&
    near(state.evaluation.bodies['padA'].volume, 6000, 1e-6) &&
    near(state.evaluation.bodies['padB'].volume, 3600, 1e-6) &&
    state.evaluation.features['pads'].sketch?.degreesOfFreedom === 0;
  // One undo takes the split back, the patches of the two extrusions included.
  engine.undo();
  const undone = regionsOf(engine.getState(), 'padA')[0].join() === ['Aa', 'Ab', 'Ac', 'Ad'].join();
  engine.redo();
  // The inner pieces, each trimmed at a point of it. `added` holds the new piece of each cut curve
  // in the order of `changed`: Ab's from (40, 10) up to A3, Ac's from (20, 30) to A4, Ba's from
  // (40, 10) to B2, Bd's from (20, 30) down to B1. Inside the other rectangle are Ab's new piece,
  // the keeper Ac (A3 to (20, 30)), the keeper Ba (B1 to (40, 10)) and Bd's new piece.
  const inner: [Id, [number, number]][] = [[split.added[0], [40, 20]], ['Ac', [30, 30]], ['Ba', [30, 10]], [split.added[3], [20, 20]]];
  for (const [curve, at] of inner) tool('trim', 'pads', { curve, at }, `u_${curve}_`);
  const union = engine.getState();
  const one = regionsOf(union, 'padA').length === 1 && regionsOf(union, 'padA')[0].join() === regionsOf(union, 'padB')[0].join();
  return splitOk && undone && one && near(union.evaluation.bodies['padA'].volume, 2000 * 5, 1e-6) && near(union.evaluation.bodies['padB'].volume, 2000 * 3, 1e-6) && union.evaluation.features['pads'].sketch?.degreesOfFreedom === 0;
}

// A construction line inside the base outline (the centre line of a rib) that stops short of the
// top edge, extended to it. The old end stays on the line because a dimension names it, so the
// length it gave still measures to it. A construction line is not part of the profile, so the top
// edge is not cut: the new end is held on it. (Measured with a profile line in place of the
// construction line, c-more.spike: 0 degrees of freedom before and after; the top edge cut at the
// new end and the region of the base patched with its new piece; the new end follows the height
// of the outline and the place of the line, the old end the length dimension.)
export function extended(): boolean {
  run(...pointAt('baseSketch', 'ea', '10', '10'), { type: 'addPoint', sketch: 'baseSketch', id: 'eb', x: 10, y: 20 }, { type: 'addCurve', sketch: 'baseSketch', id: 'rib', curve: { type: 'line', a: 'ea', b: 'eb', construction: true } });
  run({ type: 'addConstraint', sketch: 'baseSketch', id: 'ribV', constraint: { type: 'vertical', line: 'rib' } }, { type: 'addConstraint', sketch: 'baseSketch', id: 'ribL', constraint: { type: 'distance', a: 'ea', b: 'eb', value: 10, driving: true } });
  const ids = tool('extend', 'baseSketch', { curve: 'rib', end: 'b' }, 'e_');
  const state = engine.getState();
  const sketch = state.document.features.find((f) => f.id === 'baseSketch');
  const end = sketch?.type === 'sketch' && sketch.curves['rib'].type === 'line' ? sketch.curves['rib'].b : undefined;
  const top = state.evaluation.features['baseSketch'].sketch?.points[end ?? ''];
  // A construction line is not part of the profile, so the top edge is not cut: the new end is
  // held on it, and the base needs no patch.
  return ids.changed.join() === 'rib' && ids.patched.length === 0 && ids.constraints.length === 2 && near(top?.y, 54, 1e-6) && allOk(state);
}

// ---------------------------------------------------------------- c. refusals and inputs

export function refusals(): (string | undefined)[] {
  return [
    // a curve the sketch does not have
    refusal('trim', 'baseSketch', { curve: 'noSuchCurve', at: [0, 0] }),
    // split of one curve that nothing touches: the left edge
    refusal('split', 'baseSketch', { curve: 'bd' }),
    // an extension that meets nothing: the rib, already at the top edge, further up
    refusal('extend', 'baseSketch', { curve: 'rib', end: 'b' }),
    // an end that another curve ends at too: the corner b2
    refusal('extend', 'baseSketch', { curve: 'bb', end: 'a' }),
    // a line has no end called start
    refusal('extend', 'baseSketch', { curve: 'bb', end: 'start' }),
    // `with` that the curve does not touch
    refusal('split', 'baseSketch', { curve: 'bb', with: 'rib' }),
  ]; // each a text; nothing was drawn
}
export const wrongInputs = (): void => {
  const context = contextOf(engine.getState(), 'baseSketch');
  const newId = freshIds(engine.getState().document);
  // @ts-expect-error the place is coordinates, not an anchor
  sketchTool('trim', context, { curve: 'ba', at: { at: [0, 0] } }, newId);
  // @ts-expect-error trim needs a place
  sketchTool('trim', context, { curve: 'ba' }, newId);
  // @ts-expect-error a centre is not an end
  sketchTool('extend', context, { curve: 'notch', end: 'center' }, newId);
  // @ts-expect-error no such tool
  sketchTool('break', context, { curve: 'ba' }, newId);
};
// The description for the AI is generated from the entries.
export const describedInputs: string[][] = [Object.keys(TRIM.inputs), Object.keys(EXTEND.inputs), Object.keys(SPLIT.inputs)]; // curve, at, with; curve, end, with; curve, with, at
export const returnedLists: string[] = Object.keys(TRIM.ids); // the same fourteen lists for the three tools

// ---------------------------------------------------------------- the part of the scenario

export function scenario15e(): boolean {
  const notched = notch() && notchFollows();
  const converter = overlapping() && extended();
  const refused = refusals().every((reason) => reason !== undefined);
  return notched && converter && refused;
}

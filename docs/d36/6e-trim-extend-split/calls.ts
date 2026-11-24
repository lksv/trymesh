// Validation scenario 15 (a cover for a controller board), the part of package 6e, written as calls
// against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that
// cannot be written here is a hole in the contract. Lines marked `@ts-expect-error` are calls that
// must not compile.
//
// Step 6 of the scenario, the cable notches, on stand-ins (6-plan.md, "Who builds what": 6e comes
// before the projection of 6b, so its outlines are plain own outlines):
// a. a round notch, a circle across the bottom edge of an outline extruded without an offset: two
//    trims turn the circle into an arc under its ID and leave one closed loop;
// b. a rectangular notch, three lines across the bottom edge of a floor extruded with the offset of
//    the clearance and the wall (2a): three trims.
// Which of the two stands on the floor of the assembled model waits for the owner (design.md,
// "Open", 1); 6e tests both, and the numbers of an offset that a round notch fits are in design.md,
// "Measured for the revision".
// Then the cases the Onshape converter met: two outlines that overlap, split at their crossings
// and trimmed into one; a line extended to a side. Then the query of the contacts, a sketch of
// walls, the refusals, and the three entries of the app's table.
//
// The numbers in the comments were measured on 2026-11-17 with a prototype of the rules against
// the real solver and kernel, and on 2026-11-24 with the tools of the started implementation and
// a prototype of the revised rules (design.md, "Measured" and "Measured for the revision").

import { emptySketch } from '../../../packages/engine/src/index';
import type { Id, Vec2 } from '../../../packages/engine/src/index';
import type { CommandAfter, StateAfter } from '../00-prep/contract';
import { done, engine, fail, pointAt, rectangle, run, unwrap } from '../2a-offset/calls';
import type { HTMLElementStandIn, PlaceStandIn, SketchContextStandIn, SketchHostStandIn, SketchModeStandIn, SketchPlaceTool } from '../6a-sketch-prep/contract';
import type { CutIds, CutOptions, SketchContactsResult, SketchToolCallAfter, SketchToolInputsAfter, SplitOptions } from './contract';
import { EXTEND, SPLIT, TRIM, curveUnder, extendEnd, extendReach, freshIds, repairsByDefault, sketchTool, trimPiece } from './contract';

const XY = { kind: 'base', plane: 'XY' } as const;
const near = (value: number | undefined, expected: number, tolerance: number): boolean => value !== undefined && Math.abs(value - expected) < tolerance;
const allOk = (state: StateAfter): boolean => state.document.features.every((feature) => state.evaluation.features[feature.id].status === 'ok');
const extrusion = (id: Id) => ({ id, name: id, suppressed: false, type: 'extrude' }) as const;

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
const contactsOf = (sketch: Id): SketchContactsResult => unwrap(engine.query('sketchContacts', { sketch }));

// ---------------------------------------------------------------- a. the round notch

// The stand-in: an outline of own lines `ba` (bottom, b1 to b2), `bb`, `bc`, `bd`, W × H with
// a corner at the origin, extruded T up without an offset. The notch: a circle of the diameter
// `cableD` whose centre is `notchY` above the middle of the bottom edge.
export function baseWithNotch(): StateAfter {
  run({ type: 'setParameter', name: 'W', expr: '84' }, { type: 'setParameter', name: 'H', expr: '54' }, { type: 'setParameter', name: 'T', expr: '2' });
  run({ type: 'setParameter', name: 'cableD', expr: '8' }, { type: 'setParameter', name: 'notchY', expr: '1.5' });
  run({ type: 'addFeature', feature: emptySketch('baseSketch', 'baseSketch', XY) }, ...rectangle('baseSketch', 'b', 'W', 'H'));
  run({ type: 'addFeature', feature: { ...extrusion('base'), profile: { type: 'regions', sketch: 'baseSketch', regions: [{ outerLoop: ['ba', 'bb', 'bc', 'bd'] }] }, extent: { type: 'distance', start: 0, distance: 'T' }, operation: 'new' } });
  return run(
    ...pointAt('baseSketch', 'nc', 'W / 2', 'notchY'),
    { type: 'addCurve', sketch: 'baseSketch', id: 'notch', curve: { type: 'circle', center: 'nc' }, radius: 4 },
    { type: 'addConstraint', sketch: 'baseSketch', id: 'notchD', constraint: { type: 'diameter', curve: 'notch', value: 'cableD', driving: true } },
  );
}
// The circle crosses the bottom edge: the profile is invalid and the base is in error.
export const crossed = (state: StateAfter): boolean => state.evaluation.features['baseSketch'].sketch?.valid === false && state.evaluation.features['base'].error?.code === 'invalidProfile';

// Where the curves cross, for the AI and for the marks of the app: the circle crosses the bottom
// edge at two places, and a split would cut both there.
export function contactsOfTheNotch(): boolean {
  const found = contactsOf('baseSketch');
  return !found.valid && found.total === 2 && found.contacts.every((c) => c.kind === 'crossing' && c.repair === 'cut' && c.curves.join() === ['ba', 'notch'].join()) && found.lying.length === 0;
}

// The area of the circle above the edge, by hand: the circle less the segment below the chord.
const above = (centreY: number, r: number): number => {
  const segment = (d: number): number => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
  return centreY >= 0 ? Math.PI * r * r - segment(centreY) : segment(-centreY);
};
const expectedVolume = (W: number, H: number, T: number, cableD: number, notchY: number): number => (W * H - above(notchY, cableD / 2)) * T;

export function notch(): boolean {
  const before = baseWithNotch();
  const marked = contactsOfTheNotch();
  // Trim 1: the piece of the circle below the edge, found by a place on it (no ID is needed). The
  // base reads regions of the sketch, so the repair is on by default: the circle becomes an arc
  // under its ID (its diameter dimension with it), and the edge `ba` is cut at the two crossings:
  // `ba` keeps the piece from b1, two new lines follow it, held on its line.
  // Measured: the sketch is valid and as determined as before (0 degrees of freedom, nothing
  // redundant); the base is patched to the two regions that cover the old rectangle (the
  // rectangle less the half disc, and the half disc) and has the volume it had before the circle.
  const first = tool('trim', 'baseSketch', { at: [42, -2.5] }, 't1_');
  const afterFirst = engine.getState();
  const one =
    first.changed.join() === ['ba', 'notch'].join() &&
    first.added.length === 2 &&
    first.points.length === 2 &&
    first.patched.join() === 'base' &&
    regionsOf(afterFirst, 'base').length === 2 &&
    afterFirst.evaluation.features['baseSketch'].sketch?.degreesOfFreedom === 0 &&
    contactsOf('baseSketch').valid &&
    near(afterFirst.evaluation.bodies['base'].volume, 84 * 54 * 2, 1e-6);
  // Trim 2: the piece of the edge inside the circle, by a place on it: a curve now with no cut
  // inside it, removed whole. The half disc is no longer enclosed: dropped from the base, which
  // keeps the notched outline. Its outer loop is `ba`, the far piece of the edge, `bb`, `bc`, `bd`
  // and the arc.
  const [inner] = first.added; // the second piece of `ba`: the piece inside the circle
  // Naming `ba` with a place on that piece is refused: the place is on a sibling piece, and the
  // tool says which (before the revision it removed the piece from b1 to the circle without a word).
  const wrongPiece = refusal('trim', 'baseSketch', { curve: 'ba', at: [42, 0] });
  const second = tool('trim', 'baseSketch', { at: [42, 0] }, 't2_');
  const state = engine.getState();
  const loop = regionsOf(state, 'base');
  const two = wrongPiece !== undefined && wrongPiece.includes(inner) && second.removed.includes(inner) && second.dropped.join() === 'base' && loop.length === 1 && loop[0].includes('notch') && loop[0].includes('ba') && !loop[0].includes(inner);
  // Measured on these numbers with the tools of the started implementation: 8998.51 for 8998.31 by
  // hand; the arc is a polygon within the chord tolerance, so the hand value is matched to 1e-4 of
  // the volume.
  const volume = near(state.evaluation.bodies['base'].volume, expectedVolume(84, 54, 2, 8, 1.5), 84 * 54 * 2 * 1e-4);
  // the faces: the caps, the four sides of the edges, the side of the arc and of the far piece
  const faces = state.evaluation.faceNames.filter((name) => name.feature === 'base' && name.role === 'side').length === 6;
  return crossed(before) && marked && one && two && volume && faces && allOk(state);
}

// The notch follows its parameters: the dimensions of the circle and of the outline are where they
// were. Measured: the diameter 12 and 5, the centre 1 below the edge: solved, valid, the volume by
// hand within the chord tolerance. A circle that no longer reaches the edge is a conflict of the
// sketch (the ends of the arc have to be on the edge), and the base keeps its last shape.
export function notchFollows(): boolean {
  const cases: [string, string, number, number][] = [['cableD', '12', 12, 1.5], ['cableD', '5', 5, 1.5], ['notchY', '-1', 8, -1]];
  const follows = cases.every(([name, expr, d, y]) => {
    const state = done(engine.preview({ type: 'setParameter', name, expr }));
    return allOk(state) && near(state.evaluation.bodies['base'].volume, expectedVolume(84, 54, 2, d, y), 84 * 54 * 2 * 1e-4);
  });
  const away = done(engine.preview({ type: 'setParameter', name: 'notchY', expr: '6' }));
  return follows && away.evaluation.features['baseSketch'].warnings.some((w) => w.code === 'sketchConflict');
}

// ---------------------------------------------------------------- b. the rectangular notch on the offset floor

// The floor: an own outline W × H extruded with the offset `clearance + wall` (2.5 mm outward,
// mitred corners, 2a). The notch is a U of three lines across its bottom edge: `ua` from the point
// `sa` below the edge up to the corner `u1`, `ub` across to `u2`, `uc` down to `sc`; drawn
// `slotW + 2 · (clearance + wall)` wide, because the offset narrows it by the offset on each side,
// and `slotD` deep. Fully determined: the corner `u1` is dimensioned from the origin, the sides are
// vertical and the top horizontal, and each lower end is dimensioned 3 below the edge.
export function floorWithSlot(): StateAfter {
  run({ type: 'setParameter', name: 'clearance', expr: '0.5' }, { type: 'setParameter', name: 'wall', expr: '2' }, { type: 'setParameter', name: 'slotW', expr: '8' }, { type: 'setParameter', name: 'slotD', expr: '5' });
  run({ type: 'addFeature', feature: emptySketch('floorSketch', 'floorSketch', XY) }, ...rectangle('floorSketch', 'f', 'W', 'H'));
  run({ type: 'addFeature', feature: { ...extrusion('floor'), profile: { type: 'regions', sketch: 'floorSketch', regions: [{ outerLoop: ['fa', 'fb', 'fc', 'fd'] }], offset: 'clearance + wall' }, extent: { type: 'distance', start: 0, distance: 'T' }, operation: 'new' } });
  const line = (id: Id, a: Id, b: Id): CommandAfter => ({ type: 'addCurve', sketch: 'floorSketch', id, curve: { type: 'line', a, b } });
  return run(
    ...pointAt('floorSketch', 'u1', 'W / 2 - slotW / 2 - clearance - wall', 'slotD'),
    { type: 'addPoint', sketch: 'floorSketch', id: 'sa', x: 35, y: -3 },
    { type: 'addPoint', sketch: 'floorSketch', id: 'u2', x: 50, y: 5 },
    { type: 'addPoint', sketch: 'floorSketch', id: 'sc', x: 50, y: -3 },
    line('ua', 'sa', 'u1'),
    line('ub', 'u1', 'u2'),
    line('uc', 'u2', 'sc'),
    { type: 'addConstraint', sketch: 'floorSketch', id: 'uav', constraint: { type: 'vertical', line: 'ua' } },
    { type: 'addConstraint', sketch: 'floorSketch', id: 'ubh', constraint: { type: 'horizontal', line: 'ub' } },
    { type: 'addConstraint', sketch: 'floorSketch', id: 'ucv', constraint: { type: 'vertical', line: 'uc' } },
    { type: 'addConstraint', sketch: 'floorSketch', id: 'uw', constraint: { type: 'horizontalDistance', a: 'u1', b: 'u2', value: 'slotW + 2 * (clearance + wall)', driving: true } },
    { type: 'addConstraint', sketch: 'floorSketch', id: 'say', constraint: { type: 'verticalDistance', a: 'origin', b: 'sa', value: -3, driving: true } },
    { type: 'addConstraint', sketch: 'floorSketch', id: 'scy', constraint: { type: 'verticalDistance', a: 'origin', b: 'sc', value: -3, driving: true } },
  );
}
// The floor by hand: the outline grown by the offset on every side, less the notch, which the
// offset narrows by twice the offset and leaves as deep as drawn.
const floorVolume = (W: number, H: number, T: number, o: number, drawnW: number, depth: number): number => ((W + 2 * o) * (H + 2 * o) - (drawnW - 2 * o) * depth) * T;

export function slot(): boolean {
  const before = floorWithSlot();
  const invalid = before.evaluation.features['floor'].error?.code === 'invalidProfile' && contactsOf('floorSketch').total === 2;
  // Three trims, each by a place: the piece of the edge inside the U (the repair cuts `fa`, `ua`
  // and `uc` at the two crossings first), then the two stubs below the edge. The lower ends of the
  // stubs are named by their dimensions, so they stay, held on the lines of the U.
  // Measured on these numbers (the U drawn 13 wide, 5 deep, offset 2.5): 0 degrees of freedom and
  // nothing redundant after each trim; the floor 10422.000 after the first trim and after the
  // third, exactly the value by hand.
  const first = tool('trim', 'floorSketch', { at: [42, 0] }, 's1_');
  const afterFirst = engine.getState();
  tool('trim', 'floorSketch', { at: [35.5, -1.5] }, 's2_');
  tool('trim', 'floorSketch', { at: [48.5, -1.5] }, 's3_');
  const state = engine.getState();
  const cut = first.changed.join() === ['fa', 'ua', 'uc'].join() && first.patched.join() === 'floor' && afterFirst.evaluation.features['floorSketch'].sketch?.valid === true;
  const body = near(state.evaluation.bodies['floor'].volume, floorVolume(84, 54, 2, 2.5, 13, 5), 1e-6) && state.evaluation.features['floorSketch'].sketch?.degreesOfFreedom === 0 && regionsOf(state, 'floor').length === 1;
  // The slot follows its parameters (measured: 17 wide 10382.000, 8 deep 10374.000, both by hand).
  // A slot no wider than nothing after the offset is an error of the floor (2a: "leaves no length
  // for the curve"), not of the sketch.
  const wider = done(engine.preview({ type: 'setParameter', name: 'slotW', expr: '12' }));
  const deeper = done(engine.preview({ type: 'setParameter', name: 'slotD', expr: '8' }));
  const vanishes = done(engine.preview({ type: 'setParameter', name: 'slotW', expr: '0' }));
  const follows = near(wider.evaluation.bodies['floor'].volume, floorVolume(84, 54, 2, 2.5, 17, 5), 1e-6) && near(deeper.evaluation.bodies['floor'].volume, floorVolume(84, 54, 2, 2.5, 13, 8), 1e-6) && vanishes.evaluation.features['floor'].error?.code === 'invalidProfile';
  return invalid && cut && body && follows && allOk(state);
}

// ---------------------------------------------------------------- c. what the converter met

// Two outlines that overlap, each dimensioned and extruded on its own, then drawn into one sketch:
// both extrusions are invalid. Split of the whole sketch: four lines cut at two crossings, three
// regions; each extrusion is patched to the regions that cover its rectangle, and the bodies are
// as before (measured: 6000 and 3600). Then the four inner pieces are trimmed into one outline;
// measured: the sketch stays at 0 degrees of freedom through all four, and both extrusions end
// on the union.
export function overlapping(): boolean {
  run({ type: 'addFeature', feature: emptySketch('pads', 'pads', XY) }, ...rectangle('pads', 'A', '40', '30'));
  run({ type: 'addFeature', feature: { ...extrusion('padA'), profile: { type: 'regions', sketch: 'pads', regions: [{ outerLoop: ['Aa', 'Ab', 'Ac', 'Ad'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } });
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
  const crossedPads = run({ type: 'addFeature', feature: { ...extrusion('padB'), profile: { type: 'regions', sketch: 'pads', regions: [{ outerLoop: ['Ba', 'Bb', 'Bc', 'Bd'] }] }, extent: { type: 'distance', start: 0, distance: 3 }, operation: 'new' } });
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
  // The inner pieces, each trimmed by a place on it; which of them kept the ID of its line and
  // which is a new curve does not matter to the caller. Inside the other rectangle are the piece of
  // Ab from (40, 10) up to A3, of Ac from A3 to (20, 30), of Ba from B1 to (40, 10) and of Bd from
  // (20, 30) down to B1.
  const inner: Vec2[] = [[40, 20], [30, 30], [30, 10], [20, 20]];
  inner.forEach((at, i) => tool('trim', 'pads', { at }, `u${i}_`));
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

// ---------------------------------------------------------------- d. a sketch of walls: the repair off

// Wall centre lines, where T shapes are meant: a long wall `wa`, two ribs that end on it (held by
// pointOnCurve), and a brace `wd` across the second rib, drawn too long. No feature reads regions
// of the sketch, so a trim repairs nothing by default: the brace alone is cut at the rib, its new
// end held on the rib, its old end (fixed) held on its line.
// Measured: `changed` is the brace alone, two constraints added, 0 degrees of freedom, nothing
// redundant, and the four walls keep their curves and the names of their faces; the wall of the
// brace is shorter (600 to 400 mm³). With the repair on, the same trim cuts all four lines (four
// new curves, three walls patched to pieces with their faces renamed) and the library names
// a fixed point of the brace redundant.
export function walls(): boolean {
  const fixed = (id: Id, x: number, y: number): CommandAfter[] => [
    { type: 'addPoint', sketch: 'ribs', id, x, y },
    { type: 'addConstraint', sketch: 'ribs', id: `${id}f`, constraint: { type: 'fixed', point: id, x, y } },
  ];
  const line = (id: Id, a: Id, b: Id): CommandAfter => ({ type: 'addCurve', sketch: 'ribs', id, curve: { type: 'line', a, b } });
  const wall = (id: Id, curve: Id): CommandAfter => ({ type: 'addFeature', feature: { ...extrusion(id), profile: { type: 'wall', sketch: 'ribs', curves: [curve], thickness: 2 }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } });
  run({ type: 'addFeature', feature: emptySketch('ribs', 'ribs', XY) });
  run(
    ...fixed('a1', 0, 0),
    ...fixed('a2', 60, 0),
    line('wa', 'a1', 'a2'),
    ...fixed('b1', 20, 30),
    { type: 'addPoint', sketch: 'ribs', id: 'b2', x: 20, y: 0 },
    line('wb', 'b1', 'b2'),
    { type: 'addConstraint', sketch: 'ribs', id: 'bv', constraint: { type: 'vertical', line: 'wb' } },
    { type: 'addConstraint', sketch: 'ribs', id: 'bt', constraint: { type: 'pointOnCurve', point: 'b2', curve: 'wa' } },
    ...fixed('c1', 40, 30),
    { type: 'addPoint', sketch: 'ribs', id: 'c2', x: 40, y: 0 },
    line('wc', 'c1', 'c2'),
    { type: 'addConstraint', sketch: 'ribs', id: 'cv', constraint: { type: 'vertical', line: 'wc' } },
    { type: 'addConstraint', sketch: 'ribs', id: 'ct', constraint: { type: 'pointOnCurve', point: 'c2', curve: 'wa' } },
    ...fixed('d1', 20, 20),
    ...fixed('d2', 50, 20),
    line('wd', 'd1', 'd2'),
  );
  run(wall('wallA', 'wa'), wall('wallB', 'wb'), wall('wallC', 'wc'), wall('wallD', 'wd'));
  const byDefault = !repairsByDefault(engine.getState().document, 'ribs');
  const ids = tool('trim', 'ribs', { at: [45, 20] }, 'w_');
  const state = engine.getState();
  const kept = ids.changed.join() === 'wd' && ids.added.length === 0 && ids.constraints.length === 2 && ids.patched.length === 0 && ids.shortened.join() === 'wallD';
  const names = state.evaluation.faceNames.filter((n) => n.feature === 'wallA' && n.role === 'wallSide').length === 2;
  // The same trim asked to repair cuts the other lines too: an AI that wants one outline from
  // a sketch nothing reads yet says so, or calls split without a curve when it has trimmed.
  engine.undo();
  const state2 = engine.getState();
  const repaired = sketchTool('trim', contextOf(state2, 'ribs'), { at: [45, 20], repair: 'on' }, freshIds(state2.document, 'r_'));
  engine.redo();
  return byDefault && kept && names && repaired.ok && (repaired.ids as CutIds).changed.length === 4 && state.evaluation.features['ribs'].sketch?.degreesOfFreedom === 0 && allOk(state);
}

// ---------------------------------------------------------------- e. refusals and inputs

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
    // a place on another piece of the line the curve was split off
    refusal('trim', 'baseSketch', { curve: 'ba', at: [70, 0] }),
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
  // @ts-expect-error the repair is on or off
  sketchTool('trim', context, { at: [0, 0], repair: true }, newId);
  // @ts-expect-error no such tool
  sketchTool('break', context, { curve: 'ba' }, newId);
  // @ts-expect-error the query takes a sketch
  engine.query('sketchContacts', {});
};
// The description for the AI is generated from the entries.
export const describedInputs: string[][] = [Object.keys(TRIM.inputs), Object.keys(EXTEND.inputs), Object.keys(SPLIT.inputs)]; // at, curve, with, repair; curve, end, with, repair; curve, with, at
export const returnedLists: string[] = Object.keys(TRIM.ids); // the same fifteen lists for the three tools

// ---------------------------------------------------------------- f. the three entries of the app's table

// The entries of `SKETCH_TOOL_UI` (6a, part 4), written against 6a's contract, whose stand-ins
// have the members the table uses. What 6e reads beyond them is in the real types already: the
// context of a tool with the document (`SketchContext.tool`), the mode of the open sketch on the
// host (`SketchHost.sketch`, for the selection), and the IDs the host hands out. `finish` is not
// used (6a's fix lets it keep places; these tools keep none), and neither is `clicks`: each click
// runs the tool.
interface CutContext extends SketchContextStandIn {
  tool: SketchToolCallAfter;
}
interface CutHost extends SketchHostStandIn {
  sketch?: SketchModeStandIn;
  sketchContext(): CutContext | undefined;
  newId: Parameters<typeof sketchTool>[3];
}
declare function row(label: string, ...parts: HTMLElementStandIn[]): HTMLElementStandIn;
declare function button(label: string, onclick: () => void, enabled?: boolean): HTMLElementStandIn;
declare function checkbox(label: string, checked: boolean, onchange: (checked: boolean) => void): HTMLElementStandIn;
declare function polyline(piece: NonNullable<ReturnType<typeof trimPiece>>): Vec2[];
declare function notes(ids: Record<string, Id[]>): string; // what the status line says of the lists

// The batch of the engine's tool run as it was made (not through `drawn`: the switch of
// construction curves does not apply), a refusal said with its reason.
function runCut<K extends 'trim' | 'extend' | 'split'>(host: CutHost, context: CutContext, name: K, input: SketchToolInputsAfter[K], done: string): void {
  const made = sketchTool(name, context.tool, input, host.newId);
  if (!made.ok) return host.say(`${name}: ${made.message}`, true);
  if (made.commands.length === 0) return host.say(`${name}: nothing to cut.`);
  host.run({ type: 'batch', commands: made.commands }, `${done}; ${notes(made.ids)}.`);
}
const ownCurve = (curve: Id, context: SketchContextStandIn): boolean => curve in context.feature.curves;
// `with` of the options, while the open sketch has that curve (the options outlive a sketch).
const bound = (context: SketchContextStandIn, id: Id | undefined): Id | undefined => (id !== undefined && (id in context.feature.curves || id in context.result.curves) ? id : undefined);
// What the three panels share: the curve the tool is bounded by, taken from the one curve selected
// when the button is pressed, and cleared.
const boundRows = <O extends { with?: Id }>(host: CutHost, value: O, set: (value: O) => void): HTMLElementStandIn[] => {
  const selected = host.sketch?.selection ?? [];
  return [row(`Up to: ${value.with ?? 'the nearest curves'}`, button('Use the selected curve', () => set({ ...value, with: selected[0] }), selected.length === 1), button('Clear', () => set({ ...value, with: undefined }), value.with !== undefined))];
};
// The repair as a checkbox whose state without a choice is the default of the document.
const repairRow = (host: CutHost, value: CutOptions, set: (value: CutOptions) => void): HTMLElementStandIn[] => {
  const context = host.sketchContext();
  const byDefault = context ? repairsByDefault(context.tool.document, context.feature.id) : false;
  return [checkbox('Cut the other crossings of the outline first', value.repair === undefined ? byDefault : value.repair === 'on', (checked) => set({ ...value, repair: checked === byDefault ? undefined : checked ? 'on' : 'off' }))];
};

export const trimEntry: SketchPlaceTool<CutOptions> = {
  label: 'Trim',
  hint: 'Click the piece of a curve to remove.',
  picks: 'curve',
  eligible: ownCurve,
  options: { initial: {}, panel: (host: CutHost, value, set) => [...boundRows(host, value, set), ...repairRow(host, value, set)] },
  click: (host: CutHost, _m, places: PlaceStandIn[], context: CutContext, options) => {
    const place = places[places.length - 1];
    if (place.snap?.kind !== 'curve') return host.say('Click the piece of a curve to remove.', true);
    // the curve the click means: a span line lies over the pieces of its line, and the picker takes
    // the first of equally near curves
    runCut(host, context, 'trim', { at: place.at, curve: curveUnder(context.tool, place.at, place.snap.id), with: bound(context, options.with), repair: options.repair }, 'Trimmed');
  },
  draw: (_places, cursor, context: CutContext, options) => {
    if (cursor.snap?.kind !== 'curve') return [];
    const piece = trimPiece(context.tool, { at: cursor.at, curve: curveUnder(context.tool, cursor.at, cursor.snap.id), with: bound(context, options.with), repair: options.repair });
    return piece ? [polyline(piece)] : [];
  },
};

export const extendEntry: SketchPlaceTool<CutOptions> = {
  label: 'Extend',
  hint: 'Click a line or an arc near the end to extend.',
  picks: 'curve',
  eligible: (curve, context) => ownCurve(curve, context) && context.feature.curves[curve].type !== 'circle',
  options: { initial: {}, panel: (host: CutHost, value, set) => [...boundRows(host, value, set), ...repairRow(host, value, set)] },
  click: (host: CutHost, _m, places: PlaceStandIn[], context: CutContext, options) => {
    const place = places[places.length - 1];
    if (place.snap?.kind !== 'curve') return host.say('Click a line or an arc near the end to extend.', true);
    const end = extendEnd(context.tool, place.snap.id, place.at);
    if (!end) return host.say('That curve has no end to extend.', true);
    runCut(host, context, 'extend', { curve: place.snap.id, end, with: bound(context, options.with), repair: options.repair }, 'Extended');
  },
  draw: (_places, cursor, context: CutContext, options) => {
    if (cursor.snap?.kind !== 'curve') return [];
    const end = extendEnd(context.tool, cursor.snap.id, cursor.at);
    const reach = end && extendReach(context.tool, { curve: cursor.snap.id, end, with: bound(context, options.with), repair: options.repair });
    const from = end && context.result.points[(context.feature.curves[cursor.snap.id] as unknown as Record<string, Id>)[end]];
    return reach && from ? [[[from.x, from.y], reach]] : [];
  },
};

export const splitEntry: SketchPlaceTool<SplitOptions> = {
  label: 'Split',
  hint: 'Click a curve to cut it where other curves cross it.',
  picks: 'curve',
  eligible: ownCurve,
  options: {
    initial: { nearest: false },
    panel: (host: CutHost, value, set) => [
      // every crossing of the outline at once: the repair of an invalid profile
      row(
        '',
        button('Split crossings', () => {
          const context = host.sketchContext();
          if (context) runCut(host, context, 'split', {}, 'Crossings split');
        }),
      ),
      ...boundRows(host, value, set),
      checkbox('Only at the crossing nearest to the click', value.nearest, (nearest) => set({ ...value, nearest })),
    ],
  },
  click: (host: CutHost, _m, places: PlaceStandIn[], context: CutContext, options) => {
    const place = places[places.length - 1];
    if (place.snap?.kind !== 'curve') return host.say('Click a curve to split, or Split crossings in the panel.', true);
    runCut(host, context, 'split', { curve: curveUnder(context.tool, place.at, place.snap.id), with: bound(context, options.with), ...(options.nearest ? { at: place.at } : {}) }, 'Split');
  },
};

// ---------------------------------------------------------------- the part of the scenario

export function scenario15e(): boolean {
  const notched = notch() && notchFollows() && slot();
  const converter = overlapping() && extended();
  const refused = refusals().every((reason) => reason !== undefined);
  return notched && converter && walls() && refused;
}

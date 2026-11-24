// Validation scenario 15 (a cover for a controller board), the part of package 6b, written as calls
// against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot
// be written here is a hole in the contract.
//
// Step 2 of the scenario: the skeleton `frame` on a plane parallel to the board's projects the board
// outline and its hole circles, and measures the hole pair symmetric about `origin/y`. Step 3: the
// base in three features: the floor from an own outline held on the projected outline (drawn by the
// sketch tool `projectSketch` with `as: 'own'`; 6e trims the cable notch into it, step 6), the rim
// from the outline projected with the region flag (added and pocketed with the offsets of 2a), and
// four standoffs whose bores are projected hole circles inside own circles. Step 5, the seam with
// 6c: a sketch projects one copy of the lid's mirror and is dimensioned from it. Step 7, the part of
// 6b: the board 2 mm wider, everything follows. Then the rest of the mechanism: a profile in memory
// with a projected outline (a trim of 6e), a source on the other side (an arc swapped), a tilted
// plane, a lost source, the flag switched on a frozen projection, the roles of the tool, a
// projection repaired, the query, and the refusals.
//
// Written as 6b's own test runs it, before 6f: the board of step 1 is the stand-in of 6a2
// (../6a2-origin-axes/calls.ts). With 6f it is the imported DXF, and the projections name the
// outline's entities (`o1/l3`). The numbers in the comments were measured (design.md, "Measured":
// a prototype of the kind, of the position stage and of the tool in the real engine, with the real
// planegcs and manifold adapters).

import type { Id } from '../../../packages/engine/src/index';
import type { CommandAfter, StateAfter } from '../00-prep/contract';
import { engine, fail, run } from '../2a-offset/calls';
import { OUTLINE, XY, board, boardDetermined, circle, constrain, dimension, extrude, line, near, parameters, plane, point, refused, regionsOf, resultOf, rounded, same, sketch, sketchOf, statusOf, volumeOf, warned } from '../6a2-origin-axes/calls';
import { freshIds } from '../6e-trim-extend-split/contract';
import type { ProjectSketchInput, SketchProjection, SketchProjectionInput, SketchToolCall6b } from './contract';
import { DUPLICATE, ENTITY_GONE, LYING, REGIONS_ON_A_POINT, TILTED, UNDER_ORIGIN, sketchTool } from './contract';

const project = (s: Id, id: Id, ref: SketchProjectionInput): CommandAfter => ({ type: 'addExternal', sketch: s, id, ref });
const fromSketch = (source: Id, entity: Id, kind: SketchProjection['kind'], regions?: boolean): SketchProjectionInput => ({ type: 'sketch', sketch: source, entity, kind, ...(regions === undefined ? {} : { regions }) });
// What a sketch tool is given: the sketch, its result, the document and the results of the features.
const contextOf = (state: StateAfter, s: Id): SketchToolCall6b => ({ sketch: sketchOf(state, s), result: resultOf(state, s), parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features });
const projectSketch = (s: Id, input: ProjectSketchInput, prefix: string) => {
  const state = engine.getState();
  return sketchTool('projectSketch', contextOf(state, s), input, freshIds(state.document, prefix));
};

// ---------------------------------------------------------------- the numbers

// The board 60 × 40 with corners of 3 and holes of 3.2 (6a2); standoffs of 6 and 5 high; a floor of
// 2; a clearance of 0.5 and a wall of 2 around the board; a rim 4 high.
// The base by hand: the floor (offset 2.5, 2 thick), the rim (offset 2.5 less offset 0.5, 4 high),
// four rings (6 outside, 3.2 inside, 5 high). 7836.90 for W = 60; measured 7835.04 (the arcs are
// polygons within the chord tolerance), and 8048.90 / 8047.04 for W = 62.
const baseByHand = (W: number): number => rounded(W, 40, 3, 2.5) * 2 + (rounded(W, 40, 3, 2.5) - rounded(W, 40, 3, 0.5)) * 4 + ((4 * Math.PI * (6 * 6 - 3.2 * 3.2)) / 4) * 5;
const ALLOWANCE = 3; // mm³: the polygons of the arcs and circles
const FRAME_OUTLINE = ['fa0', 'fl0', 'fa1', 'fl1', 'fa2', 'fl2', 'fa3', 'fl3'];

// ================================================================ step 2: the skeleton

// `frame` on the plane of the floor's top (`standoffH` below the board), parallel to the board:
// the eight outline curves (`fa<i>`, `fl<i>`) and the four hole circles (`fh<i>`, whose centres
// `fh<i>/center` are the hole centres), none forming regions (the flag left out is `false`). Two
// reference dimensions measure the hole pair from `origin/y` (fixed operands only: allowed for
// a reference dimension). It constrains nothing of the board: the symmetry is the board's.
export function frame(): StateAfter {
  const f = 'frame';
  run(plane('framePl', '-standoffH'), sketch(f, { kind: 'plane', feature: 'framePl' }));
  run(...[0, 1, 2, 3].flatMap((i) => [project(f, `fa${i}`, fromSketch('board', `ba${i}`, 'arc')), project(f, `fl${i}`, fromSketch('board', `bl${i}`, 'line')), project(f, `fh${i}`, fromSketch('board', `bh${i}`, 'circle'))]));
  return run(
    constrain(f, 'm1', { type: 'distancePointLine', point: 'fh0/center', line: 'origin/y', value: 1, driving: false }),
    constrain(f, 'm2', { type: 'distancePointLine', point: 'fh1/center', line: 'origin/y', value: 1, driving: false }),
  );
}
// Measured: 26.5 from both (boardW / 2 − holeInset); valid, no region (no flag).
export const holesSymmetric = (state: StateAfter, expected: number): boolean => {
  const m = resultOf(state, 'frame').measurements;
  return near(m.m1, expected, 1e-9) && near(m.m2, expected, 1e-9) && regionsOf(state, 'frame').length === 0 && resultOf(state, 'frame').valid;
};
// The entities of a projection from the sketch alone; the document holds the flag as a boolean; the
// stored value is positions and nothing else (measured: `{ kind: 'arc', center, start, end }`).
export const frameEntities = (state: StateAfter): boolean => {
  const f = sketchOf(state, 'frame');
  const fa0 = f.external.fa0 as unknown as SketchProjection;
  return (
    same(Object.keys(f.external).slice(0, 3), ['fa0', 'fl0', 'fh0']) &&
    fa0.regions === false &&
    same(Object.keys(f.solved.external.fa0).sort(), ['center', 'end', 'kind', 'start']) &&
    resultOf(state, 'frame').curves.fa0?.shape.type === 'arc' &&
    resultOf(state, 'frame').curves.fa0?.regions === false
  );
};

// ================================================================ step 3: the base

// 3a. The floor: `baseSk` on a plane `standoffH + baseT` below the board. One call of the tool: the
// outline of `frame` projected without the flag, and an own curve held on each projected curve: an
// own point at each of the eight corners of the chain, `coincident` with a projected end; own lines
// between them; each own arc with a centre of its own, a construction line from it to the arc's
// start, and the projected centre on that line. Measured: 44 commands (8 entries, 12 points, 8 own
// curves, 4 construction lines, 12 constraints); 0 degrees of freedom, no redundancy, one region of
// the own curves. Extruded `baseT` with the offset `clearance + wall`; 6e trims the rectangular
// cable notch into this outline (step 6).
export let FLOOR: Id[] = [];
export function floor(): StateAfter {
  run(plane('basePl', '-(standoffH + baseT)'), sketch('baseSk', { kind: 'plane', feature: 'basePl' }));
  const made = projectSketch('baseSk', { sketch: 'frame', entities: FRAME_OUTLINE, as: 'own' }, 'o');
  if (!made.ok) return fail(made.message);
  run({ type: 'batch', commands: made.commands });
  FLOOR = made.ids.curves;
  return run(extrude('base', 'baseSk', [FLOOR], 'baseT', 'new', 'clearance + wall'));
}
export const floorHeld = (state: StateAfter): boolean => {
  const diagnosis = engine.diagnoseSketch('baseSk');
  return diagnosis.status === 'solved' && diagnosis.degreesOfFreedom === 0 && diagnosis.redundant.length === 0 && resultOf(state, 'baseSk').redundant.length === 0 && same(regionsOf(state, 'baseSk'), [[...FLOOR].sort()]);
};

// 3b. The rim: `rimSk` on the frame's plane projects the outline with the flag. The ends of the
// eight entries join at their places by position: one region named by them (measured; with the
// joins of the `coincident` constraints alone the profile is invalid). Added `rimH` with the offset
// `clearance + wall`, pocketed with the offset `clearance`.
export const RIM = ['ra0', 'ra1', 'ra2', 'ra3', 'rl0', 'rl1', 'rl2', 'rl3'];
export function rim(): StateAfter {
  const r = 'rimSk';
  run(sketch(r, { kind: 'plane', feature: 'framePl' }), ...[0, 1, 2, 3].flatMap((i) => [project(r, `ra${i}`, fromSketch('frame', `fa${i}`, 'arc', true)), project(r, `rl${i}`, fromSketch('frame', `fl${i}`, 'line', true))]));
  return run(extrude('rim', r, [RIM], 'rimH', 'add', 'clearance + wall'), extrude('pocket', r, [RIM], 'rimH', 'cut', 'clearance'));
}
export const rimRegion = (state: StateAfter): boolean => same(regionsOf(state, 'rimSk'), [RIM]) && resultOf(state, 'rimSk').valid;

// 3c. The standoffs: `standSk` on the frame's plane: the hole circles projected from `frame` with
// the flag (`sh<i>`), own circles `so<i>` of `standoffD` centred on own points coincident with the
// projected centres. Regions (measured): four discs `[sh<i>]` and four rings `[so<i>]` with the
// projected circle as their hole. The rings are added `standoffH`; their bores are the faces
// `{ feature: 'standoffs', role: 'side', curve: 'sh<i>' }`.
export function standoffs(): StateAfter {
  const t = 'standSk';
  const commands: CommandAfter[] = [sketch(t, { kind: 'plane', feature: 'framePl' })];
  [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sy], i) => {
    commands.push(
      project(t, `sh${i}`, fromSketch('frame', `fh${i}`, 'circle', true)),
      point(t, `sc${i}`, sx * 26.4, sy * 16.6),
      circle(t, `so${i}`, `sc${i}`, 2.9),
      constrain(t, `sk${i}`, { type: 'coincident', a: `sc${i}`, b: `sh${i}/center` }),
      i === 0 ? dimension(t, 'sd', { type: 'diameter', curve: 'so0' }, 'standoffD') : constrain(t, `se${i}`, { type: 'equalRadius', a: 'so0', b: `so${i}` }),
    );
  });
  run(...commands);
  return run(extrude('standoffs', t, [['so0'], ['so1'], ['so2'], ['so3']], 'standoffH', 'add'));
}
export const BORE: { feature: Id; role: 'side'; curve: Id } = { feature: 'standoffs', role: 'side', curve: 'sh0' };

export function stepsTwoAndThree(): boolean {
  parameters();
  let state = board();
  const determined = boardDetermined(state);
  state = frame();
  const skeleton = holesSymmetric(state, 26.5) && frameEntities(state);
  floor();
  rim();
  state = standoffs();
  const base = floorHeld(state) && rimRegion(state) && ['base', 'rim', 'pocket', 'standoffs'].every((id) => statusOf(state, id) === 'ok') && near(volumeOf(state, 'base'), baseByHand(60), ALLOWANCE);
  return determined && skeleton && base;
}

// ================================================================ step 7, the part of 6b

// The board 2 mm wider: the board, the frame, the floor (its own outline held on the projection),
// the rim and the standoffs follow; no feature in error. Measured: +212.00 mm³ (by hand +212.00),
// the frame measures 27.5.
export function wider(): boolean {
  const before = volumeOf(engine.getState(), 'base');
  const state = run({ type: 'setParameter', name: 'boardW', expr: '62' });
  const ids = ['board', 'pcb', 'frame', 'baseSk', 'base', 'rimSk', 'rim', 'pocket', 'standSk', 'standoffs'];
  return ids.every((id) => statusOf(state, id) === 'ok') && near(volumeOf(state, 'base') - before, baseByHand(62) - baseByHand(60), 0.01) && holesSymmetric(state, 27.5) && floorHeld(state);
}
// The own outline follows the corner radius and the size in one step each, its arcs on the
// projected ones (measured: `boardR` 9, 0.5 and 30 with the board 120 × 80; the floor's volume by
// hand each time; the own centres within 1e-11 mm of the projected ones).
export function ownOutlineFollows(): boolean {
  const state = run({ type: 'setParameter', name: 'boardR', expr: '6' });
  const back = run({ type: 'setParameter', name: 'boardR', expr: '3' });
  return statusOf(state, 'base') === 'ok' && floorHeld(state) && floorHeld(back);
}

// ================================================================ step 5, the seam with 6c

// The sketch of the second row of vents projects one copy of the lid's mirror, the mirrored flank
// `m/1/c2` of `lidSketch` (6c's calls.ts), as a line, and places the first slot of the row from it:
// a projection of a copy (a slashed `entity`, read from the source's curves after its derived
// stage). Written against 6c's calls; run by 6b's test once 6c is implemented.
export function projectsACopy(): CommandAfter[] {
  return [
    project('rowSketch', 'lf', fromSketch('lidSketch', 'm/1/c2', 'line')),
    // the first slot of the row 12 mm inside the mirrored flank
    dimension('rowSketch', 'lfd', { type: 'distancePointLine', point: 'g1a', line: 'lf' }, 12),
  ];
}

// ================================================================ the rest of the mechanism

// A profile in memory with a flagged projected outline. `padSk` on the frame's plane: the outline
// projected with the flag, an own pocket of four lines inside it, and `pad`, the region between the
// two. An own line drawn across the pocket and past both its sides makes the profile invalid; two
// trims of 6e remove its ends. A tool that built its joins from the `coincident` constraints alone
// would see the outline as open and the whole profile as invalid before and after (measured), and
// follow nothing: `pending` would name `pad`. With the joins of the step the profile after the
// second trim is valid and `pad` keeps its region, whose outer loop no cut touched.
export function trimBesideAnOutline(): boolean {
  const s = 'padSk';
  const PAD = ['ya0', 'ya1', 'ya2', 'ya3', 'yl0', 'yl1', 'yl2', 'yl3'];
  run(sketch(s, { kind: 'plane', feature: 'framePl' }), ...[0, 1, 2, 3].flatMap((i) => [project(s, `ya${i}`, fromSketch('frame', `fa${i}`, 'arc', true)), project(s, `yl${i}`, fromSketch('frame', `fl${i}`, 'line', true))]));
  run(point(s, 'q1', -5, -5), point(s, 'q2', 5, -5), point(s, 'q3', 5, 5), point(s, 'q4', -5, 5), line(s, 'n1', 'q1', 'q2'), line(s, 'n2', 'q2', 'q3'), line(s, 'n3', 'q3', 'q4'), line(s, 'n4', 'q4', 'q1'));
  run(extrude('pad', s, [PAD], '1', 'add'));
  let state = run(point(s, 'q5', -8, 0), point(s, 'q6', 8, 0), line(s, 'n5', 'q5', 'q6'));
  const invalid = !resultOf(state, s).valid;
  for (const at of [[-7, 0], [7, 0]] as const) {
    const made = sketchTool('trim', contextOf(state, s), { curve: 'n5', at: [...at] }, freshIds(state.document, 't'));
    if (!made.ok) return fail(made.message);
    if (made.ids.pending.length > 0 && at[0] > 0) return false;
    state = run({ type: 'batch', commands: made.commands });
  }
  return invalid && resultOf(state, s).valid && statusOf(state, 'pad') === 'ok' && regionsOf(state, s).some((loop) => same(loop, PAD));
}

// Two routes to one corner: the outline from `frame` with one line straight from `board`. The ends
// meet by position whatever their sources (measured: valid, one region, no redundant constraint).
// A source made of projected edges of a body closes the same way (measured: four edges of a box,
// projected again with the flag: one region, the body 400.000 mm³).
export function twoRoutes(): boolean {
  const s = 'twoSk';
  const state = run(
    sketch(s, { kind: 'plane', feature: 'framePl' }),
    ...[0, 1, 2, 3].flatMap((i) => [project(s, `ta${i}`, fromSketch('frame', `fa${i}`, 'arc', true)), i === 0 ? project(s, 'tl0', fromSketch('board', 'bl0', 'line', true)) : project(s, `tl${i}`, fromSketch('frame', `fl${i}`, 'line', true))]),
  );
  return resultOf(state, s).valid && regionsOf(state, s).length === 1;
}
// An own end at the end of a flagged projection. Tied by `coincident`, or placed there by its own
// constraints: one loop with the projection (measured: the region `[n1, n2, x]` both ways). Two own
// ends there that are two vertices: the projection's end joins neither, and the profile is invalid,
// as two unjoined ends at one place are today (measured).
export function ownEnds(): boolean {
  run(sketch('edgeSk', XY), point('edgeSk', 'a', 0, 60), point('edgeSk', 'b', 20, 60), line('edgeSk', 's1', 'a', 'b'), constrain('edgeSk', 'fa', { type: 'fixed', point: 'a', x: 0, y: 60 }), constrain('edgeSk', 'fb', { type: 'fixed', point: 'b', x: 20, y: 60 }));
  let state = run(
    sketch('loopSk', XY),
    project('loopSk', 'x', fromSketch('edgeSk', 's1', 'line', true)),
    point('loopSk', 'u1', 0, 60),
    point('loopSk', 'u2', 20, 60),
    point('loopSk', 'u3', 10, 72),
    line('loopSk', 'n1', 'u1', 'u3'),
    line('loopSk', 'n2', 'u3', 'u2'),
    constrain('loopSk', 'f1', { type: 'fixed', point: 'u1', x: 0, y: 60 }),
    constrain('loopSk', 'f2', { type: 'fixed', point: 'u2', x: 20, y: 60 }),
  );
  const joined = same(regionsOf(state, 'loopSk'), [['n1', 'n2', 'x']]);
  state = run(point('loopSk', 'u4', 0, 60), point('loopSk', 'u5', -5, 68), line('loopSk', 'n3', 'u4', 'u5'), constrain('loopSk', 'f4', { type: 'fixed', point: 'u4', x: 0, y: 60 }));
  return joined && !resultOf(state, 'loopSk').valid;
}

// A source on the other side: a sketch on the bottom face of the board (normal −Z, its x along −X)
// projects the arc `ba0` of the board: the arc stays counter-clockwise, so its ends swap (measured:
// the centre (27, 17) at (−27, 17), `start` the image of the board's `end`). The own outline of the
// tool there: 0 degrees of freedom, no redundancy, a pad of 2 with the offset 1 at 5180.24 mm³
// against 5180.53 by hand.
export function otherSide(): boolean {
  let state = run(sketch('under', { kind: 'face', body: 'pcb', face: { feature: 'pcb', role: 'startCap' } }), project('under', 'u0', fromSketch('board', 'ba0', 'arc')));
  const r = resultOf(state, 'under');
  const boardResult = resultOf(state, 'board');
  const swapped = near(r.points['u0/start']?.x, -(boardResult.points.be0?.x ?? NaN), 1e-9) && near(r.points['u0/end']?.y, boardResult.points.bs0?.y ?? NaN, 1e-9);
  run(sketch('under2', { kind: 'face', body: 'pcb', face: { feature: 'pcb', role: 'startCap' } }));
  const made = projectSketch('under2', { sketch: 'board', entities: OUTLINE, as: 'own' }, 'u');
  if (!made.ok) return fail(made.message);
  state = run({ type: 'batch', commands: made.commands });
  const diagnosis = engine.diagnoseSketch('under2');
  return swapped && diagnosis.degreesOfFreedom === 0 && diagnosis.redundant.length === 0 && same(regionsOf(state, 'under2'), [[...made.ids.curves].sort()]);
}

// A plane tilted by 0.3 rad: the warning `unsupportedProjection` with the angle; no value ever, so
// the entry has no geometry and a constraint on it is left out of the solve. The tool, which knows
// the planes, refuses with the angle and makes nothing; the query says `tilted`.
export function tilted(): boolean {
  run({ type: 'addFeature', feature: { id: 'tiltPl', name: 'tiltPl', suppressed: false, type: 'plane', base: XY, offset: 20, tilt: { axis: { kind: 'base', axis: 'X' }, angle: 0.3 } } } as CommandAfter);
  const state = run(sketch('tilted', { kind: 'plane', feature: 'tiltPl' }), project('tilted', 't0', fromSketch('frame', 'fl0', 'line')));
  const made = projectSketch('tilted', { sketch: 'frame' }, 'w');
  const asked = engine.query('sketchSources', { sketch: 'tilted', from: 'frame' });
  return (
    warned(state, 'tilted', 'unsupportedProjection', '17.2°') &&
    !('t0' in resultOf(state, 'tilted').curves) &&
    !made.ok &&
    made.message.includes(TILTED('frame', 17.2)) &&
    asked.ok &&
    asked.result.sources[0].status === 'tilted' &&
    asked.result.entities === undefined
  );
}

// The query: what `rimSk` can project. Without `from` the earlier sketches (`board` and `frame`
// among them, both parallel); with `from: 'frame'` its twelve curves where a projection puts them,
// none forming regions there, the eight of the outline already projected by `rimSk`'s entries.
export function sources(): boolean {
  const all = engine.query('sketchSources', { sketch: 'rimSk' });
  const one = engine.query('sketchSources', { sketch: 'rimSk', from: 'frame' });
  if (!all.ok || !one.ok || !one.result.entities) return false;
  const fa0 = one.result.entities.find((entity) => entity.id === 'fa0');
  return (
    all.result.sources.some((source) => source.sketch === 'board' && source.status === 'parallel' && !source.flips) &&
    all.result.entities === undefined &&
    one.result.total === 12 &&
    fa0?.kind === 'arc' &&
    fa0.entry === 'ra0' &&
    !fa0.regions &&
    one.result.entities.filter((entity) => entity.entry !== undefined).length === 8
  );
}

// A lost source: a hole removed from the board. The frame's `fh3` keeps its circle with
// `brokenProjection` and the detail; the standoff on it keeps its bore.
export function lostSource(): boolean {
  const state = run({ type: 'removeEntity', sketch: 'board', id: 'bh3' });
  return warned(state, 'frame', 'brokenProjection', ENTITY_GONE('board', 'bh3', 'circle')) && resultOf(state, 'frame').curves.fh3?.shape.type === 'circle' && statusOf(state, 'standoffs') === 'ok';
}
// The flag switched on the frozen projection keeps its geometry (`keepsValue`). The command does
// not check again the references the entry had already (`bh3` is gone), as `updateFeature` does not.
export function flagOnFrozen(): boolean {
  const state = run({ type: 'updateExternal', sketch: 'frame', id: 'fh3', ref: fromSketch('board', 'bh3', 'circle', true) });
  return sketchOf(state, 'frame').solved.external.fh3 !== undefined && resultOf(state, 'frame').curves.fh3?.regions === true;
}

// The roles of the tool, a whole sketch each time (measured, with a prototype of the tool):
// - `board` as it is in its source: twelve entries, all forming regions (its own curves do): the
//   outline with four holes, and four discs;
// - `frame` as it is in its source: twelve entries, none forming regions (a skeleton stays one);
// - `baseSk`, whose own outline lies over its projections: sixteen entries, the eight of the own
//   outline forming regions, one region. With `as: 'regions'` all sixteen would, two on each place,
//   and the profile would be invalid (measured): refused, naming the first pair.
export function wholeSketch(): boolean {
  const count = (s: Id): number => Object.values(sketchOf(engine.getState(), s).external).filter((ref) => (ref as unknown as SketchProjection).regions).length;
  const into = (target: Id, input: ProjectSketchInput, prefix: string): StateAfter => {
    run(sketch(target, { kind: 'plane', feature: 'framePl' }));
    const made = projectSketch(target, input, prefix);
    return made.ok ? run({ type: 'batch', commands: made.commands }) : fail(made.message);
  };
  const fromBoard = regionsOf(into('copyB', { sketch: 'board' }, 'b'), 'copyB').length === 5 && count('copyB') === 12;
  const fromFrame = regionsOf(into('copyF', { sketch: 'frame' }, 'c'), 'copyF').length === 0 && count('copyF') === 0;
  const fromFloor = regionsOf(into('copyS', { sketch: 'baseSk' }, 'd'), 'copyS').length === 1 && count('copyS') === 8;
  run(sketch('copyR', { kind: 'plane', feature: 'framePl' }));
  const all = projectSketch('copyR', { sketch: 'baseSk', as: 'regions' }, 'e');
  // the refusal names the first two curves that lie on each other (LYING)
  return fromBoard && fromFrame && fromFloor && !all.ok && all.message.includes(LYING('', '', 'baseSk').slice(LYING('', '', 'baseSk').indexOf(' of baseSk')));
}
// Run again: everything is projected already, so the tool has nothing to do.
export function wholeSketchAgain(): boolean {
  return !projectSketch('copyB', { sketch: 'board' }, 'f').ok;
}

// A projection repaired: `rl0` of the rim's sketch moved to a line of another earlier sketch
// (`bl0` of the board, the line the frame's `fl0` projects) keeps its ID, its flag and the region
// named by it; to an arc it is refused (6a's rule: an entity that stays keeps its kind). Moving it
// to `fl1` would be refused as a duplicate: `rl1` projects that line already.
export function repaired(): boolean {
  const kept = engine.preview({ type: 'updateExternal', sketch: 'rimSk', id: 'rl0', ref: fromSketch('board', 'bl0', 'line', true) });
  return (
    kept.ok &&
    refused({ type: 'updateExternal', sketch: 'rimSk', id: 'rl0', ref: fromSketch('board', 'ba1', 'arc', true) }, 'druh promítnutí změnit nejde') &&
    refused({ type: 'updateExternal', sketch: 'rimSk', id: 'rl0', ref: fromSketch('frame', 'fl1', 'line', true) }, DUPLICATE('fl1', 'frame', 'rl1'))
  );
}

// The refusals of the commands.
export function refusals(): boolean {
  return (
    // a sketch later on the timeline, and itself
    refused(project('frame', 'z1', fromSketch('rimSk', 'ra0', 'arc')), 'musí ležet před odkazující feature') &&
    refused(project('frame', 'z2', fromSketch('frame', 'fl0', 'line')), 'musí ležet před odkazující feature') &&
    // the kind differs from the source's
    refused(project('frame', 'z3', fromSketch('board', 'bh0', 'arc')), 'expected arc') &&
    // an axis of another sketch, and its far point
    refused(project('frame', 'z4', fromSketch('board', 'origin/x', 'line')), UNDER_ORIGIN('origin/x', 'board')) &&
    refused(project('frame', 'z5', fromSketch('board', 'origin/x/b', 'point')), UNDER_ORIGIN('origin/x/b', 'board')) &&
    // a second projection of one entity
    refused(project('frame', 'z6', fromSketch('board', 'ba0', 'arc')), DUPLICATE('ba0', 'board', 'fa0')) &&
    // regions on a point
    refused(project('frame', 'z7', fromSketch('board', 'hc0', 'point', true)), REGIONS_ON_A_POINT) &&
    // a constraint between two fixed entities: an axis and a projected point
    refused(constrain('frame', 'z8', { type: 'pointOnCurve', point: 'fh0/center', curve: 'origin/x' }), 'vazba jen mezi pevnými entitami')
  );
}

export function scenario(): boolean {
  return (
    stepsTwoAndThree() &&
    wider() &&
    ownOutlineFollows() &&
    trimBesideAnOutline() &&
    twoRoutes() &&
    ownEnds() &&
    otherSide() &&
    tilted() &&
    sources() &&
    wholeSketch() &&
    wholeSketchAgain() &&
    lostSource() &&
    flagOnFrozen() &&
    repaired() &&
    refusals()
  );
}

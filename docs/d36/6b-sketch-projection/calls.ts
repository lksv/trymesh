// Validation scenario 15 (a cover for a controller board), the part of package 6b, written as calls
// against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot
// be written here is a hole in the contract.
//
// Step 2 of the scenario: the skeleton `frame` on a plane parallel to the board's projects the board
// outline and its hole circles, and measures the hole pair symmetric about `origin/y`. Step 3: the
// base in three features: the floor from an own outline held on the projected outline (6e trims the
// cable notch into it, step 6), the rim from the outline projected with the region flag (added and
// pocketed with the offsets of 2a), and four standoffs whose bores are projected hole circles inside
// own circles. Step 7, the part of 6b: the board 2 mm wider, everything follows. Then the rest of the
// mechanism: a source on the other side (an arc swapped), a tilted plane, a lost source, the flag
// switched on a frozen projection, the whole sketch by the tool, a projection repaired, and the
// refusals.
//
// Written as 6b's own test runs it, before 6f: the board of step 1 is a stand-in drawn by hand (four
// lines, four corner arcs, four holes), its corners and holes placed by `symmetric` constraints about
// `origin/x` and `origin/y`. With 6f it is the imported DXF, placed by the import's point and turn,
// and the projections name the outline's entities (`o1/l3`). The numbers in the comments were
// measured so (design.md, "Measured", spike c: a prototype of the kind and of the axes registered in
// the real engine, the real planegcs and manifold adapters).

import type { Id, SketchFeature } from '../../../packages/engine/src/index';
import type { CommandAfter, StateAfter } from '../00-prep/contract';
import { engine, fail, run } from '../2a-offset/calls';
import { freshIds } from '../6e-trim-extend-split/contract';
import type { SketchProjection, SketchProjectionInput } from './contract';
import { AXIS_HAS_NO_LENGTH, AXIS_OF_ANOTHER_SKETCH, DUPLICATE, REGIONS_ON_A_POINT, sketchTool } from './contract';

const XY = { kind: 'base', plane: 'XY' } as const;
const near = (value: number | undefined, expected: number, tolerance: number): boolean => value !== undefined && Math.abs(value - expected) < tolerance;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const sketchOf = (state: StateAfter, id: Id): SketchFeature => {
  const feature = state.document.features.find((f) => f.id === id);
  return feature?.type === 'sketch' ? (feature as SketchFeature) : fail(`no sketch "${id}"`);
};
const resultOf = (state: StateAfter, id: Id) => state.evaluation.features[id].sketch ?? fail(`no result of "${id}"`);
const regionsOf = (state: StateAfter, sketch: Id): Id[][] => resultOf(state, sketch).regions.map((region) => region.ref.outerLoop);
const volumeOf = (state: StateAfter, body: Id): number => state.evaluation.bodies[body]?.volume ?? fail(`no body "${body}"`);
const statusOf = (state: StateAfter, id: Id): string => state.evaluation.features[id].status;
const warned = (state: StateAfter, id: Id, code: string, text?: string): boolean =>
  state.evaluation.features[id].warnings.some((w) => w.code === code && (text === undefined || w.message.includes(text)));
const refused = (command: CommandAfter, text: string): boolean => {
  const result = engine.execute(command);
  return !result.ok && result.error.message.includes(text);
};

const sketch = (id: Id, plane: object): CommandAfter =>
  ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'sketch', plane, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } }) as CommandAfter;
const plane = (id: Id, offset: string): CommandAfter => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset } }) as CommandAfter;
const point = (s: Id, id: Id, x: number, y: number): CommandAfter => ({ type: 'addPoint', sketch: s, id, x, y });
const line = (s: Id, id: Id, a: Id, b: Id): CommandAfter => ({ type: 'addCurve', sketch: s, id, curve: { type: 'line', a, b } });
const arc = (s: Id, id: Id, center: Id, start: Id, end: Id): CommandAfter => ({ type: 'addCurve', sketch: s, id, curve: { type: 'arc', center, start, end } });
const circle = (s: Id, id: Id, center: Id, radius: number): CommandAfter => ({ type: 'addCurve', sketch: s, id, curve: { type: 'circle', center }, radius });
const constrain = (s: Id, id: Id, constraint: object): CommandAfter => ({ type: 'addConstraint', sketch: s, id, constraint }) as CommandAfter;
const dimension = (s: Id, id: Id, constraint: object, value: number | string): CommandAfter => constrain(s, id, { ...constraint, value, driving: true });
const project = (s: Id, id: Id, ref: SketchProjectionInput): CommandAfter => ({ type: 'addExternal', sketch: s, id, ref });
const fromSketch = (source: Id, entity: Id, kind: SketchProjection['kind'], regions = false): SketchProjectionInput => ({ type: 'sketch', sketch: source, entity, kind, ...(regions ? { regions } : {}) });
const extrude = (id: Id, s: Id, regions: Id[][], distance: string, operation: 'new' | 'add' | 'cut', offset?: string): CommandAfter =>
  ({
    type: 'addFeature',
    feature: {
      id,
      name: id,
      suppressed: false,
      type: 'extrude',
      profile: { type: 'regions', sketch: s, regions: regions.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })), ...(offset ? { offset } : {}) },
      extent: { type: 'distance', start: 0, distance },
      operation,
      ...(operation === 'new' ? {} : { targets: ['base'] }),
    },
  }) as CommandAfter;

// ---------------------------------------------------------------- the numbers

// The board 60 × 40, corners of radius 3, holes of 3.2 at 3.5 from the edges; standoffs of 6 and 5
// high; a floor of 2; a clearance of 0.5 and a wall of 2 around the board; a rim 4 high.
const CORNERS = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const; // corner i, counter-clockwise from +x +y
const OUTLINE = ['ba0', 'ba1', 'ba2', 'ba3', 'bl0', 'bl1', 'bl2', 'bl3'];
// A rounded rectangle W × H with corners R grown by o (the offset of 2a): its area.
const rounded = (W: number, H: number, R: number, o: number): number => (W + 2 * o) * (H + 2 * o) - (4 - Math.PI) * (R + o) ** 2;
// The base by hand: the floor (offset 2.5, 2 thick), the rim (offset 2.5 less offset 0.5, 4 high),
// four rings (6 outside, 3.2 inside, 5 high). 7836.90 for W = 60; measured 7835.04 (the arcs are
// polygons within the chord tolerance), and 8048.90 / 8047.04 for W = 62.
const baseByHand = (W: number): number => rounded(W, 40, 3, 2.5) * 2 + (rounded(W, 40, 3, 2.5) - rounded(W, 40, 3, 0.5)) * 4 + ((4 * Math.PI * (6 * 6 - 3.2 * 3.2)) / 4) * 5;
const ALLOWANCE = 3; // mm³: the polygons of the arcs and circles

export function parameters(): StateAfter {
  return run(
    ...(
      [
        ['boardW', '60'],
        ['boardH', '40'],
        ['boardR', '3'],
        ['holeInset', '3.5'],
        ['holeD', '3.2'],
        ['standoffD', '6'],
        ['standoffH', '5'],
        ['baseT', '2'],
        ['clearance', '0.5'],
        ['wall', '2'],
        ['rimH', '4'],
      ] as const
    ).map(([name, expr]): CommandAfter => ({ type: 'setParameter', name, expr })),
  );
}

// ================================================================ step 1, a stand-in until 6f

// The board on XY: corner arcs `ba<i>` over `bc<i>` (centre), `bs<i>`, `be<i>`; lines `bl<i>` from
// `be<i>` to `bs<i+1>`; holes `bh<i>` at `hc<i>`. The corners and the holes are placed by symmetry
// about the axes of the origin, which puts the board's centre lines on them: fully determined
// (measured: 0 degrees of freedom). `pcb` is the board 1.6 thick.
export function board(): StateAfter {
  const b = 'board';
  const commands: CommandAfter[] = [sketch(b, XY)];
  CORNERS.forEach(([sx, sy], i) => {
    const turn = (i * Math.PI) / 2;
    const s = [Math.round(Math.cos(turn)), Math.round(Math.sin(turn))];
    const e = [Math.round(Math.cos(turn + Math.PI / 2)), Math.round(Math.sin(turn + Math.PI / 2))];
    const [cx, cy] = [sx * 27, sy * 17];
    commands.push(
      point(b, `bc${i}`, cx, cy),
      point(b, `bs${i}`, cx + 3 * s[0], cy + 3 * s[1]),
      point(b, `be${i}`, cx + 3 * e[0], cy + 3 * e[1]),
      arc(b, `ba${i}`, `bc${i}`, `bs${i}`, `be${i}`),
      dimension(b, `bks${i}x`, { type: 'horizontalDistance', a: `bc${i}`, b: `bs${i}` }, `${s[0]} * boardR`),
      dimension(b, `bks${i}y`, { type: 'verticalDistance', a: `bc${i}`, b: `bs${i}` }, `${s[1]} * boardR`),
      dimension(b, `bke${i}x`, { type: 'horizontalDistance', a: `bc${i}`, b: `be${i}` }, `${e[0]} * boardR`),
      dimension(b, `bke${i}y`, { type: 'verticalDistance', a: `bc${i}`, b: `be${i}` }, `${e[1]} * boardR`),
      point(b, `hc${i}`, sx * 26.5, sy * 16.5),
      circle(b, `bh${i}`, `hc${i}`, 1.6),
    );
  });
  for (let i = 0; i < 4; i++) commands.push(line(b, `bl${i}`, `be${i}`, `bs${(i + 1) % 4}`));
  commands.push(
    dimension(b, 'bw', { type: 'horizontalDistance', a: 'origin', b: 'bc0' }, 'boardW / 2 - boardR'),
    dimension(b, 'bh', { type: 'verticalDistance', a: 'origin', b: 'bc0' }, 'boardH / 2 - boardR'),
    // the axes of the origin as operands: the corners and the holes mirror each other about them
    constrain(b, 'bsy', { type: 'symmetric', a: 'bc0', b: 'bc1', line: 'origin/y' }),
    constrain(b, 'bsx0', { type: 'symmetric', a: 'bc0', b: 'bc3', line: 'origin/x' }),
    constrain(b, 'bsx1', { type: 'symmetric', a: 'bc1', b: 'bc2', line: 'origin/x' }),
    dimension(b, 'hw', { type: 'horizontalDistance', a: 'origin', b: 'hc0' }, 'boardW / 2 - holeInset'),
    dimension(b, 'hh', { type: 'verticalDistance', a: 'origin', b: 'hc0' }, 'boardH / 2 - holeInset'),
    constrain(b, 'hsy', { type: 'symmetric', a: 'hc0', b: 'hc1', line: 'origin/y' }),
    constrain(b, 'hsx0', { type: 'symmetric', a: 'hc0', b: 'hc3', line: 'origin/x' }),
    constrain(b, 'hsx1', { type: 'symmetric', a: 'hc1', b: 'hc2', line: 'origin/x' }),
    dimension(b, 'hd', { type: 'diameter', curve: 'bh0' }, 'holeD'),
    constrain(b, 'he1', { type: 'equalRadius', a: 'bh0', b: 'bh1' }),
    constrain(b, 'he2', { type: 'equalRadius', a: 'bh0', b: 'bh2' }),
    constrain(b, 'he3', { type: 'equalRadius', a: 'bh0', b: 'bh3' }),
  );
  run(...commands);
  return run(extrude('pcb', b, [OUTLINE], '1.6', 'new'));
}
export const boardDetermined = (state: StateAfter): boolean => resultOf(state, 'board').degreesOfFreedom === 0 && statusOf(state, 'pcb') === 'ok';
// The axes are in the board's solver input (its constraints name them), and not in its result.
export const axesNotInResult = (state: StateAfter): boolean => !('origin/x' in resultOf(state, 'board').curves) && !('origin/x/b' in resultOf(state, 'board').points);

// ================================================================ step 2: the skeleton

// `frame` on the plane of the floor's top (`standoffH` below the board), parallel to the board:
// the eight outline curves (`fa<i>`, `fl<i>`) and the four hole circles (`fh<i>`, whose centres
// `fh<i>/center` are the hole centres), none forming regions. Two reference dimensions measure the
// hole pair from `origin/y` (fixed operands only: allowed for a reference dimension).
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
// The entities of a projection, from the sketch alone.
export const frameEntities = (state: StateAfter): boolean => {
  const f = sketchOf(state, 'frame');
  return same(Object.keys(f.external).slice(0, 3), ['fa0', 'fl0', 'fh0']) && resultOf(state, 'frame').curves.fa0?.shape.type === 'arc' && resultOf(state, 'frame').curves.fa0?.regions === false;
};

// ================================================================ step 3: the base

// 3a. The floor: `baseSk` on a plane `standoffH + baseT` below the board. The outline projected
// from `frame` without the flag (`pa<i>`, `pl<i>`), and an own outline held on it: own points
// coincident with the projected ends, own lines over them, own arcs by their ends and `equalRadius`
// with the projected arcs (not by their centres: measured, a conflict). Measured: 0 degrees of
// freedom, no redundancy, one region of the own curves. Extruded `baseT` with the offset
// `clearance + wall`; 6e trims the notch into this outline (step 6).
export function floor(): StateAfter {
  const s = 'baseSk';
  const commands: CommandAfter[] = [plane('basePl', '-(standoffH + baseT)'), sketch(s, { kind: 'plane', feature: 'basePl' })];
  for (let i = 0; i < 4; i++) commands.push(project(s, `pa${i}`, fromSketch('frame', `fa${i}`, 'arc')), project(s, `pl${i}`, fromSketch('frame', `fl${i}`, 'line')));
  CORNERS.forEach(([sx, sy], i) => {
    const turn = (i * Math.PI) / 2;
    const s0 = [Math.round(Math.cos(turn)), Math.round(Math.sin(turn))];
    const e0 = [Math.round(Math.cos(turn + Math.PI / 2)), Math.round(Math.sin(turn + Math.PI / 2))];
    const [cx, cy] = [sx * 27, sy * 17];
    commands.push(
      point(s, `oc${i}`, cx + 0.2, cy - 0.1),
      point(s, `os${i}`, cx + 3 * s0[0] + 0.1, cy + 3 * s0[1]),
      point(s, `oe${i}`, cx + 3 * e0[0], cy + 3 * e0[1] - 0.1),
      arc(s, `oa${i}`, `oc${i}`, `os${i}`, `oe${i}`),
      constrain(s, `hs${i}`, { type: 'coincident', a: `os${i}`, b: `pa${i}/start` }),
      constrain(s, `he${i}`, { type: 'coincident', a: `oe${i}`, b: `pa${i}/end` }),
      constrain(s, `hr${i}`, { type: 'equalRadius', a: `oa${i}`, b: `pa${i}` }),
    );
  });
  for (let i = 0; i < 4; i++) commands.push(line(s, `ol${i}`, `oe${i}`, `os${(i + 1) % 4}`));
  run(...commands);
  return run(extrude('base', s, [['oa0', 'oa1', 'oa2', 'oa3', 'ol0', 'ol1', 'ol2', 'ol3']], 'baseT', 'new', 'clearance + wall'));
}
export const floorHeld = (state: StateAfter): boolean => {
  const diagnosis = engine.diagnoseSketch('baseSk');
  return diagnosis.status === 'solved' && diagnosis.degreesOfFreedom === 0 && diagnosis.redundant.length === 0 && same(regionsOf(state, 'baseSk'), [['oa0', 'oa1', 'oa2', 'oa3', 'ol0', 'ol1', 'ol2', 'ol3']]);
};

// 3b. The rim: `rimSk` on the frame's plane projects the outline with the flag. The eight entries
// join at their common points by the keys of the board's vertices: one region named by them
// (measured). Added `rimH` with the offset `clearance + wall`, pocketed with the offset `clearance`.
export const RIM = ['ra0', 'ra1', 'ra2', 'ra3', 'rl0', 'rl1', 'rl2', 'rl3'];
export function rim(): StateAfter {
  const r = 'rimSk';
  run(sketch(r, { kind: 'plane', feature: 'framePl' }), ...[0, 1, 2, 3].flatMap((i) => [project(r, `ra${i}`, fromSketch('frame', `fa${i}`, 'arc', true)), project(r, `rl${i}`, fromSketch('frame', `fl${i}`, 'line', true))]));
  return run(extrude('rim', r, [RIM], 'rimH', 'add', 'clearance + wall'), extrude('pocket', r, [RIM], 'rimH', 'cut', 'clearance'));
}
export const rimRegion = (state: StateAfter): boolean => same(regionsOf(state, 'rimSk'), [RIM]);

// 3c. The standoffs: `standSk` on the frame's plane: the hole circles projected from `frame` with
// the flag (`sh<i>`), own circles `so<i>` of `standoffD` centred on own points coincident with the
// projected centres. Regions (measured): four discs `[sh<i>]` and four rings `[so<i>]` with the
// projected circle as their hole. The rings are added `standoffH`; their bores are the faces
// `{ feature: 'standoffs', role: 'side', curve: 'sh<i>' }`.
export function standoffs(): StateAfter {
  const t = 'standSk';
  const commands: CommandAfter[] = [sketch(t, { kind: 'plane', feature: 'framePl' })];
  CORNERS.forEach(([sx, sy], i) => {
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
  const determined = boardDetermined(state) && axesNotInResult(state);
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
  return ids.every((id) => statusOf(state, id) === 'ok') && near(volumeOf(state, 'base') - before, baseByHand(62) - baseByHand(60), 0.01) && holesSymmetric(state, 27.5) && resultOf(state, 'baseSk').degreesOfFreedom === 0;
}

// ================================================================ the rest of the mechanism

// A source on the other side: a sketch on the bottom face of the board (normal −Z, its x along −X)
// projects the arc `ba0` of the board: the arc stays counter-clockwise, so its ends swap (measured
// in spike b: the centre (26, 16) at (−26, 16), `start` the image of the board's `end`).
export function otherSide(): boolean {
  const state = run(sketch('under', { kind: 'face', body: 'pcb', face: { feature: 'pcb', role: 'startCap' } }), project('under', 'u0', fromSketch('board', 'ba0', 'arc')));
  const r = resultOf(state, 'under');
  const board = resultOf(state, 'board');
  return near(r.points['u0/start']?.x, -(board.points.be0?.x ?? NaN), 1e-9) && near(r.points['u0/end']?.y, board.points.bs0?.y ?? NaN, 1e-9);
}

// A plane tilted by 0.3 rad: the warning `unsupportedProjection` with the angle; no value ever, so
// the entry has no geometry and a constraint on it is left out of the solve.
export function tilted(): boolean {
  run({ type: 'addFeature', feature: { id: 'tiltPl', name: 'tiltPl', suppressed: false, type: 'plane', base: XY, offset: 20, tilt: { axis: { kind: 'base', axis: 'X' }, angle: 0.3 } } } as CommandAfter);
  const state = run(sketch('tilted', { kind: 'plane', feature: 'tiltPl' }), project('tilted', 't0', fromSketch('frame', 'fl0', 'line')));
  return warned(state, 'tilted', 'unsupportedProjection', '17.2°') && !('t0' in resultOf(state, 'tilted').curves);
}

// A lost source: a hole removed from the board. The frame's `fh3` keeps its circle with
// `brokenProjection`; the standoff on it keeps its bore (measured in spike b for a hole).
export function lostSource(): boolean {
  const state = run({ type: 'removeEntity', sketch: 'board', id: 'bh3' });
  return warned(state, 'frame', 'brokenProjection', 'board has no circle bh3') && resultOf(state, 'frame').curves.fh3?.shape.type === 'circle' && statusOf(state, 'standoffs') === 'ok';
}
// The flag switched on the frozen projection keeps its geometry (`keepsValue`). The command does
// not check again the references the entry had already (`bh3` is gone), as `updateFeature` does not.
export function flagOnFrozen(): boolean {
  const state = run({ type: 'updateExternal', sketch: 'frame', id: 'fh3', ref: fromSketch('board', 'bh3', 'circle', true) });
  return sketchOf(state, 'frame').solved.external.fh3 !== undefined && resultOf(state, 'frame').curves.fh3?.regions === true;
}

// The whole skeleton into a new sketch by the tool, forming regions: twelve entries (eight outline
// curves, four holes), one region of the outline with four holes, and four discs.
export function wholeSketch(): boolean {
  let state = run(sketch('copySk', { kind: 'plane', feature: 'framePl' }));
  const result = sketchTool('projectSketch', { sketch: sketchOf(state, 'copySk'), result: resultOf(state, 'copySk'), document: state.document }, { sketch: 'frame', as: 'regions' }, freshIds(state.document));
  if (!result.ok) return fail(result.message);
  state = run({ type: 'batch', commands: result.commands });
  return result.ids.entries.length === 12 && result.ids.skipped.length === 0 && regionsOf(state, 'copySk').length === 5;
}
// Run again: everything is projected already, so the tool has nothing to do.
export function wholeSketchAgain(): boolean {
  const state = engine.getState();
  const result = sketchTool('projectSketch', { sketch: sketchOf(state, 'copySk'), result: resultOf(state, 'copySk'), document: state.document }, { sketch: 'frame' }, freshIds(state.document));
  return !result.ok;
}

// A projection repaired: `pl0` of the floor sketch moved to a line of another earlier sketch
// (`bl0` of the board, the line the frame's `fl0` projects) keeps its ID and whatever is constrained
// to it; to an arc it is refused (6a's rule: an entity that stays keeps its kind). Moving it to
// `fl1` would be refused as a duplicate: `pl1` projects that line already.
export function repaired(): boolean {
  const kept = engine.preview({ type: 'updateExternal', sketch: 'baseSk', id: 'pl0', ref: fromSketch('board', 'bl0', 'line') });
  return (
    kept.ok &&
    refused({ type: 'updateExternal', sketch: 'baseSk', id: 'pl0', ref: fromSketch('board', 'ba1', 'arc') }, 'druh promítnutí změnit nejde') &&
    refused({ type: 'updateExternal', sketch: 'baseSk', id: 'pl0', ref: fromSketch('frame', 'fl1', 'line') }, DUPLICATE('fl1', 'frame', 'pl1'))
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
    // an axis of another sketch
    refused(project('frame', 'z4', fromSketch('board', 'origin/x', 'line')), AXIS_OF_ANOTHER_SKETCH('board')) &&
    // a second projection of one entity
    refused(project('frame', 'z5', fromSketch('board', 'ba0', 'arc')), DUPLICATE('ba0', 'board', 'fa0')) &&
    // regions on a point
    refused(project('frame', 'z6', fromSketch('board', 'hc0', 'point', true)), REGIONS_ON_A_POINT) &&
    // a midpoint on an axis
    refused(constrain('baseSk', 'z7', { type: 'midpoint', point: 'oc0', line: 'origin/x' }), AXIS_HAS_NO_LENGTH('origin/x')) &&
    // a constraint between two fixed entities: an axis and a projected point
    refused(constrain('frame', 'z8', { type: 'pointOnCurve', point: 'fh0/center', curve: 'origin/x' }), 'vazba jen mezi pevnými entitami')
  );
}

// 6c after 6b: the lid's mirror about the Y axis names `origin/y` (6c's calls.ts uses a construction
// line `ay` until 6b). Written, not run here.
export const mirrorAboutY = (): CommandAfter =>
  ({ type: 'addExternal', sketch: 'lidSketch', id: 'm', ref: { type: 'pattern', sources: ['c1', 'r1', 'c2', 'r2', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } } }) as CommandAfter;

export function scenario(): boolean {
  return stepsTwoAndThree() && wider() && otherSide() && tilted() && lostSource() && flagOnFrozen() && wholeSketch() && wholeSketchAgain() && repaired() && refusals();
}

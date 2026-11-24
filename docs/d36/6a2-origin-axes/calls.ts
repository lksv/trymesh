// Validation scenario 15 (a cover for a controller board), the part of the point 6a2: the stand-in
// board of step 1, written as calls against the contract. Only type-checked (`npx tsc -p
// docs/d36/tsconfig.json`). A step that cannot be written here is a hole in the contract.
//
// The board is drawn by hand until 6f imports one: four lines, four corner arcs, four holes, placed
// symmetric about the axes of the origin and fully determined, with no redundant constraint. 6c and
// 6b build on it (6b's calls import it from here). Then the rest of the axes: a reference dimension
// to an axis, a body revolved about `origin/x`, and the refusals.
//
// The numbers in the comments were measured (design.md, "Measured": the axes prototyped by mocks of
// `entityOf`, `resolveReferences` and `sketchCurves` in the real engine, with the real planegcs and
// manifold adapters).

import type { Id, SketchFeature } from '../../../packages/engine/src/index';
import type { CommandAfter, StateAfter } from '../00-prep/contract';
import { engine, fail, run } from '../2a-offset/calls';
import { AXIS_CURVES, AXIS_HAS_NO_LENGTH, AXIS_REACH, lineExtent, solvedCurves } from './contract';

export const XY = { kind: 'base', plane: 'XY' } as const;
export const near = (value: number | undefined, expected: number, tolerance: number): boolean => value !== undefined && Math.abs(value - expected) < tolerance;
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export const sketchOf = (state: StateAfter, id: Id): SketchFeature => {
  const feature = state.document.features.find((f) => f.id === id);
  return feature?.type === 'sketch' ? (feature as SketchFeature) : fail(`no sketch "${id}"`);
};
export const resultOf = (state: StateAfter, id: Id) => state.evaluation.features[id].sketch ?? fail(`no result of "${id}"`);
export const regionsOf = (state: StateAfter, sketch: Id): Id[][] => resultOf(state, sketch).regions.map((region) => region.ref.outerLoop);
export const volumeOf = (state: StateAfter, body: Id): number => state.evaluation.bodies[body]?.volume ?? fail(`no body "${body}"`);
export const statusOf = (state: StateAfter, id: Id): string => state.evaluation.features[id].status;
export const warned = (state: StateAfter, id: Id, code: string, text?: string): boolean =>
  state.evaluation.features[id].warnings.some((w) => w.code === code && (text === undefined || w.message.includes(text)));
export const refused = (command: CommandAfter, text: string): boolean => {
  const result = engine.execute(command);
  return !result.ok && result.error.message.includes(text);
};

export const sketch = (id: Id, plane: object): CommandAfter =>
  ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'sketch', plane, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } }) as CommandAfter;
export const plane = (id: Id, offset: string): CommandAfter => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset } }) as CommandAfter;
export const point = (s: Id, id: Id, x: number, y: number): CommandAfter => ({ type: 'addPoint', sketch: s, id, x, y });
export const line = (s: Id, id: Id, a: Id, b: Id): CommandAfter => ({ type: 'addCurve', sketch: s, id, curve: { type: 'line', a, b } });
export const arc = (s: Id, id: Id, center: Id, start: Id, end: Id): CommandAfter => ({ type: 'addCurve', sketch: s, id, curve: { type: 'arc', center, start, end } });
export const circle = (s: Id, id: Id, center: Id, radius: number): CommandAfter => ({ type: 'addCurve', sketch: s, id, curve: { type: 'circle', center }, radius });
export const constrain = (s: Id, id: Id, constraint: object): CommandAfter => ({ type: 'addConstraint', sketch: s, id, constraint }) as CommandAfter;
export const dimension = (s: Id, id: Id, constraint: object, value: number | string): CommandAfter => constrain(s, id, { ...constraint, value, driving: true });
export const extrude = (id: Id, s: Id, regions: Id[][], distance: string, operation: 'new' | 'add' | 'cut', offset?: string): CommandAfter =>
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

// The board 60 × 40, corners of radius 3, holes of 3.2 at 3.5 from the edges. The other parameters
// are those of the cover (6b: standoffs of 6 and 5 high, a floor of 2, a clearance of 0.5 and a wall
// of 2 around the board, a rim 4 high).
export const CORNERS = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const; // corner i, counter-clockwise from +x +y
export const OUTLINE = ['ba0', 'ba1', 'ba2', 'ba3', 'bl0', 'bl1', 'bl2', 'bl3'];
// A rounded rectangle W × H with corners R grown by o (the offset of 2a): its area.
export const rounded = (W: number, H: number, R: number, o: number): number => (W + 2 * o) * (H + 2 * o) - (4 - Math.PI) * (R + o) ** 2;
// The board 1.6 thick with its four holes: 3776.17 by hand for W = 60; measured 3776.38 (the arcs
// and the holes are polygons within the chord tolerance).
export const pcbByHand = (W: number): number => (rounded(W, 40, 3, 0) - Math.PI * 1.6 * 1.6 * 4) * 1.6;

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

// The board on XY: corner arcs `ba<i>` over `bc<i>` (centre), from `bs<i>` to `be<i>`; lines `bl<i>`
// from `be<i>` to `bs<i+1>`; holes `bh<i>` at `hc<i>`.
// Every point is placed by a linear constraint, so the sketch has one solution:
// - the two ends of the first corner by four dimensions from the origin;
// - the ends of the other three corners by `symmetric` about `origin/y` and `origin/x`, which is
//   what puts the board's centre lines on the axes;
// - each centre by one distance of 0 to the end of its arc (straight below it, or beside it); the
//   rule of the arc (both ends at one radius) gives its other coordinate. A centre placed by two
//   dimensions would leave that rule redundant, which is what the first draft of this board did
//   (four dimensions a corner: eight redundant constraints, measured by the review of 6b's design).
// - the first hole by two dimensions, the others by `symmetric`; one diameter and `equalRadius`.
// Measured: 0 degrees of freedom, no redundant constraint (the solver's list and the diagnosis).
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
      point(b, `hc${i}`, sx * 26.5, sy * 16.5),
      circle(b, `bh${i}`, `hc${i}`, 1.6),
    );
  });
  for (let i = 0; i < 4; i++) commands.push(line(b, `bl${i}`, `be${i}`, `bs${(i + 1) % 4}`));
  commands.push(
    // the first corner: its start on the right side, its end on the top
    dimension(b, 'bw', { type: 'horizontalDistance', a: 'origin', b: 'bs0' }, 'boardW / 2'),
    dimension(b, 'bwy', { type: 'verticalDistance', a: 'origin', b: 'bs0' }, 'boardH / 2 - boardR'),
    dimension(b, 'bhx', { type: 'horizontalDistance', a: 'origin', b: 'be0' }, 'boardW / 2 - boardR'),
    dimension(b, 'bh', { type: 'verticalDistance', a: 'origin', b: 'be0' }, 'boardH / 2'),
    // the axes of the origin as operands: the ends of the corners mirror each other about them
    constrain(b, 'bsy0', { type: 'symmetric', a: 'be0', b: 'bs1', line: 'origin/y' }),
    constrain(b, 'bsy1', { type: 'symmetric', a: 'bs0', b: 'be1', line: 'origin/y' }),
    constrain(b, 'bsx0', { type: 'symmetric', a: 'be1', b: 'bs2', line: 'origin/x' }),
    constrain(b, 'bsx1', { type: 'symmetric', a: 'bs1', b: 'be2', line: 'origin/x' }),
    constrain(b, 'bsx2', { type: 'symmetric', a: 'be0', b: 'bs3', line: 'origin/x' }),
    constrain(b, 'bsx3', { type: 'symmetric', a: 'bs0', b: 'be3', line: 'origin/x' }),
    // each centre straight below, or beside, the end of its arc
    dimension(b, 'bc0x', { type: 'horizontalDistance', a: 'bc0', b: 'be0' }, 0),
    dimension(b, 'bc1y', { type: 'verticalDistance', a: 'bc1', b: 'be1' }, 0),
    dimension(b, 'bc2x', { type: 'horizontalDistance', a: 'bc2', b: 'be2' }, 0),
    dimension(b, 'bc3y', { type: 'verticalDistance', a: 'bc3', b: 'be3' }, 0),
    // the holes
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
// Fully determined means no freedom and no constraint that follows from the others; a count of the
// degrees of freedom alone does not say the second.
export const boardDetermined = (state: StateAfter): boolean => {
  const diagnosis = engine.diagnoseSketch('board');
  return (
    diagnosis.status === 'solved' &&
    diagnosis.degreesOfFreedom === 0 &&
    diagnosis.redundant.length === 0 &&
    resultOf(state, 'board').redundant.length === 0 &&
    statusOf(state, 'pcb') === 'ok' &&
    near(volumeOf(state, 'pcb'), pcbByHand(60), 1)
  );
};
// The axes are in the board's solver input (its constraints name them), and not in its result.
export const axesNotInResult = (state: StateAfter): boolean => !('origin/x' in resultOf(state, 'board').curves) && !('origin/x/b' in resultOf(state, 'board').points);

// The board follows its parameters one at a time and back (measured: every single change from the
// drawn state between 30 and 120 wide, 20 and 120 high and 0.2 and 8 of radius solves; the volume
// by hand each time).
export function follows(): boolean {
  const wider = run({ type: 'setParameter', name: 'boardW', expr: '62' });
  const ok = boardDetermined(run({ type: 'setParameter', name: 'boardW', expr: '60' }));
  return near(volumeOf(wider, 'pcb'), pcbByHand(62), 1) && statusOf(wider, 'board') === 'ok' && ok;
}

// ================================================================ the rest of the axes

// A reference dimension from an own point to an axis is measured (the axis is in the curves of the
// input, since a dimension names it). Measured: 26.5.
export function measured(): boolean {
  const state = run(constrain('board', 'mh', { type: 'distancePointLine', point: 'hc0', line: 'origin/y', value: 1, driving: false }));
  return near(resultOf(state, 'board').measurements.mh, 26.5, 1e-9);
}

// A body revolved about the X axis of its sketch: a rectangle from 2 to 5 above the axis, 10 long.
// No constraint of that sketch names an axis, so the axes are not in its solver input, and the axis
// of the revolve reads them from the curves and the geometry of the state. Measured (with one
// corner held on `origin/y`, which the mock of the axes needed): 658.87 mm³ against π (5² − 2²) 10
// = 659.73 by hand.
export function revolved(): boolean {
  const t = 'turnSk';
  run(sketch(t, XY), point(t, 't1', 0, 2), point(t, 't2', 10, 2), point(t, 't3', 10, 5), point(t, 't4', 0, 5), line(t, 'u1', 't1', 't2'), line(t, 'u2', 't2', 't3'), line(t, 'u3', 't3', 't4'), line(t, 'u4', 't4', 't1'));
  const state = run({
    type: 'addFeature',
    feature: { id: 'ring', name: 'ring', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: t, regions: [{ outerLoop: ['u1', 'u2', 'u3', 'u4'] }] }, axis: { kind: 'sketchLine', sketch: t, line: 'origin/x' }, extent: { type: 'full' }, operation: 'new' },
  } as CommandAfter);
  return statusOf(state, 'ring') === 'ok' && near(volumeOf(state, 'ring'), Math.PI * (25 - 4) * 10, 2);
}

// The refusals.
export function refusals(): boolean {
  return (
    // a midpoint on an axis, and an equal length with one
    refused(constrain('board', 'z1', { type: 'midpoint', point: 'hc0', line: 'origin/x' }), AXIS_HAS_NO_LENGTH('origin/x')) &&
    refused(constrain('board', 'z2', { type: 'equalLength', a: 'bl0', b: 'origin/y' }), AXIS_HAS_NO_LENGTH('origin/y')) &&
    // a constraint between two fixed entities: an axis and the origin
    refused(constrain('board', 'z3', { type: 'pointOnCurve', point: 'origin', curve: 'origin/x' }), 'vazba jen mezi pevnými entitami') &&
    // the origin is an end of both axes: it is no point symmetric about one
    refused(constrain('board', 'z4', { type: 'symmetric', a: 'origin', b: 'hc0', line: 'origin/y' }), 'souměrný bod nesmí být koncem osy') &&
    // an axis is no curve of the sketch to change or to remove, and its far point no entity
    refused({ type: 'removeEntity', sketch: 'board', id: 'origin/x' }, 'origin/x') &&
    refused(constrain('board', 'z5', { type: 'coincident', a: 'hc0', b: 'origin/x/b' }), 'origin/x/b')
  );
}

// An axis is a whole line. The reader of a solved sketch gives the two axes as curves, each the
// segment of 1 mm from `origin` to its far point; a reader that clamps a line to its ends asks
// `lineExtent`, which gives ∓AXIS_REACH along an axis and the two ends of any other line. (The foot
// of (10, 7.3) on the segment of 1 mm is (1, 0); on the extent it is (10, 0) within 1.5e-10 mm,
// computed.) A point of the sketch the result does not have yet is read from the sketch.
export function wholeLines(): boolean {
  const state = engine.getState();
  const before = solvedCurves(sketchOf(state, 'board'), resultOf(state, 'board'));
  const x = before.curves.get('origin/x');
  const side = before.curves.get('bl0');
  if (!x || !side) return false;
  const [axis, own] = [lineExtent(x, before.geometry), lineExtent(side, before.geometry)];
  // the sketch after a batch that adds a point, with the result from before it
  const later = run(point('board', 'late', 5, 7));
  const after = solvedCurves(sketchOf(later, 'board'), resultOf(state, 'board'));
  engine.undo();
  return (
    same(AXIS_CURVES.map((curve) => curve.id), ['origin/x', 'origin/y']) &&
    x.source === 'reference' &&
    !x.regions &&
    near(before.geometry.points['origin/x/b']?.x, 1, 1e-12) &&
    axis !== undefined &&
    near(axis.a.x, -AXIS_REACH, 1e-6) &&
    near(axis.b.x, AXIS_REACH, 1e-6) &&
    own !== undefined &&
    near(own.a.x, resultOf(state, 'board').points.be0?.x ?? NaN, 1e-12) &&
    near(after.geometry.points.late?.x, 5, 1e-12)
  );
}

export function scenario(): boolean {
  parameters();
  const state = board();
  return boardDetermined(state) && axesNotInResult(state) && wholeLines() && follows() && measured() && revolved() && refusals();
}

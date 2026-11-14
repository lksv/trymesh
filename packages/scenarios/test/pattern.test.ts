// D35 point 4 in the recompute, against the real adapters: a circular pattern of features (the
// tool is built again in every copy) and of a body (the copies are new bodies).
import { describe, expect, it } from 'vitest';
import type { Command, CopyTag, EngineState, ExtrudeFeature, FaceName, Id, Input, PatternFeature } from '@trymesh/engine';
import { XY, addSketch, cap, circle, expectAllOk, extrude, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, status, volume } from './kit';

type Side = 'forward' | 'backward' | 'both';
type Transform = Input<PatternFeature>['transform'];
const through = (id: Id, sketch: Id, curves: Id[][], side: Side, targets: Id[]): Command => ({
  type: 'addFeature',
  feature: { ...extrude(id, sketch, curves, 1, 'cut'), extent: { type: 'throughAll', side }, targets } as ExtrudeFeature,
});
const span = (id: Id, sketch: Id, curves: Id[][], start: number, distance: number, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { ...extrude(id, sketch, curves, distance, operation), extent: { type: 'distance', start, distance }, ...(targets ? { targets } : {}) },
});
const pattern = (id: Id, source: PatternFeature['source'], count: number | string, transform: Partial<Transform> = {}): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'pattern', source, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count, span: { type: 'full' }, ...transform } },
});
const features = (...ids: Id[]): PatternFeature['source'] => ({ type: 'features', features: ids });
const setCount = (id: Id, count: number | string): Command => ({ type: 'updateFeature', id, patch: { transform: { count } } });
const copy = (name: FaceName, ...tags: [Id, number][]): FaceName => ({ ...name, copy: tags.map(([p, index]): CopyTag => ({ pattern: p, index })) });

const volumeOf = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
// Face names of a body with the copy tags (`H/side/k@P:1`), optionally of one feature only.
const names = (state: EngineState, body: Id, feature?: Id): string[] => faceNames(state, body).filter((name) => feature === undefined || name.startsWith(`${feature}/`));
// The middle of the bounding box of a face.
const middle = (state: EngineState, body: Id, name: FaceName): number[] => {
  const box = faceBox(state, body, name);
  if (!box) throw new Error(`the body ${body} has no face ${JSON.stringify(name)}`);
  return box.min.map((low, axis) => (low + box.max[axis]) / 2);
};
const bounds = (state: EngineState, body: Id): { min: number[]; max: number[] } => {
  const p = state.evaluation.bodies[body].solid.positions;
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < p.length; i++) {
    box.min[i % 3] = Math.min(box.min[i % 3], p[i]);
    box.max[i % 3] = Math.max(box.max[i % 3], p[i]);
  }
  return box;
};
// Area of a circle as the engine builds it: a polygon inscribed with the chord tolerance 0.01.
const disc = (radius: number): number => {
  const sides = Math.ceil(Math.PI / Math.acos(1 - 0.01 / radius));
  return (sides / 2) * radius * radius * Math.sin((2 * Math.PI) / sides);
};
const near = (actual: number, expected: number, tolerance = 0.02) => expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThan(tolerance);
const nearPoint = (actual: number[], expected: number[], tolerance = 0.01) => actual.forEach((value, axis) => near(value, expected[axis], tolerance));
const HOLE = disc(2);
const DISC = disc(20);

// A disc of radius 20 and thickness 5 around the Z axis, and a hole of radius 2 through it at (12, 0).
function drilled(side: Side = 'forward') {
  const engine = newEngine();
  run(engine, addSketch('S1', XY), circle('S1', 'o', 0, 0, 20), span('A', 'S1', [['o']], 0, 5), addSketch('S2', XY), circle('S2', 'k', 12, 0, 2), through('H', 'S2', [['k']], side, ['A']));
  return engine;
}
const hole = side('H', 'k');

describe('a circular pattern of features', () => {
  it('repeats a hole around the Z axis; the faces of the copies carry the pattern and the number', () => {
    const engine = drilled();
    let state = run(engine, pattern('P', features('H'), 4));
    expectAllOk(state);
    near(volumeOf(state, 'A'), (DISC - 4 * HOLE) * 5, 0.05);
    expect(names(state, 'A', 'H')).toEqual(['H/side/k', 'H/side/k@P:1', 'H/side/k@P:2', 'H/side/k@P:3']);
    nearPoint(middle(state, 'A', hole), [12, 0, 2.5]);
    nearPoint(middle(state, 'A', copy(hole, ['P', 1])), [0, 12, 2.5]);
    nearPoint(middle(state, 'A', copy(hole, ['P', 2])), [-12, 0, 2.5]);
    nearPoint(middle(state, 'A', copy(hole, ['P', 3])), [0, -12, 2.5]);
    // a pattern of features creates no bodies, the extrusion its own
    expect(state.evaluation.features.P.bodies).toEqual([]);
    expect(state.evaluation.features.A.bodies).toEqual(['A']);
    expect(state.evaluation.features.H.bodies).toEqual([]);
    expect(Object.keys(state.evaluation.bodies)).toEqual(['A']);

    state = run(engine, setCount('P', 6));
    expectAllOk(state);
    near(volumeOf(state, 'A'), (DISC - 6 * HOLE) * 5, 0.05);
    nearPoint(middle(state, 'A', copy(hole, ['P', 1])), [6, 12 * Math.sin(Math.PI / 3), 2.5]);
    // the count 1 is the original alone
    state = run(engine, setCount('P', 1));
    expectAllOk(state);
    near(volumeOf(state, 'A'), (DISC - HOLE) * 5, 0.05);
    expect(names(state, 'A', 'H')).toEqual(['H/side/k']);
    // undo, save and load
    engine.undo();
    near(volumeOf(engine.getState(), 'A'), (DISC - 6 * HOLE) * 5, 0.05);
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.save()).toBe(engine.save());
    expect(other.getState().evaluation).toEqual(engine.getState().evaluation);
  });

  it('the count as an expression: a value that is not an integer is an error of the field, not a rounding', () => {
    const engine = drilled();
    let state = run(engine, { type: 'setParameter', name: 'n', expr: '3' }, pattern('P', features('H'), 'n'));
    expectAllOk(state);
    expect(state.evaluation.features.P.values).toEqual({ 'transform/count': 3 });
    near(volumeOf(state, 'A'), (DISC - 3 * HOLE) * 5, 0.05);
    state = run(engine, { type: 'setParameter', name: 'n', expr: '5' });
    near(volumeOf(state, 'A'), (DISC - 5 * HOLE) * 5, 0.05);
    state = run(engine, { type: 'setParameter', name: 'n', expr: '2.5' });
    expect(status(state).P).toBe('error:invalidExpression');
    expect(state.evaluation.features.P.fieldErrors?.['transform/count']).toMatchObject({ code: 'notInteger' });
    near(volumeOf(state, 'A'), (DISC - HOLE) * 5, 0.05); // the model as before the pattern
    expect(names(state, 'A', 'H')).toEqual(['H/side/k']);
    state = run(engine, { type: 'setParameter', name: 'n', expr: '1000' });
    expect(state.evaluation.features.P.fieldErrors?.['transform/count']).toMatchObject({ code: 'outOfRange' });
    state = run(engine, { type: 'setParameter', name: 'n', expr: '4' });
    expectAllOk(state);
    near(volumeOf(state, 'A'), (DISC - 4 * HOLE) * 5, 0.05);
  });

  it('an angle lies between the first and the last copy and may be negative', () => {
    const engine = drilled();
    const quarter = (angle: number | string, count = 3): Command => pattern('P', features('H'), count, { span: { type: 'angle', angle } });
    let state = run(engine, quarter(Math.PI / 2));
    expectAllOk(state);
    near(volumeOf(state, 'A'), (DISC - 3 * HOLE) * 5, 0.05);
    const diagonal = 12 * Math.SQRT1_2;
    nearPoint(middle(state, 'A', copy(hole, ['P', 1])), [diagonal, diagonal, 2.5]);
    nearPoint(middle(state, 'A', copy(hole, ['P', 2])), [0, 12, 2.5]);
    // the other way round, as an expression in degrees
    state = run(engine, { type: 'updateFeature', id: 'P', patch: { transform: { span: { angle: 'deg(-90)' } } } });
    expectAllOk(state);
    nearPoint(middle(state, 'A', copy(hole, ['P', 1])), [diagonal, -diagonal, 2.5]);
    nearPoint(middle(state, 'A', copy(hole, ['P', 2])), [0, -12, 2.5]);
    // two copies: the angle is the step
    state = run(engine, { type: 'updateFeature', id: 'P', patch: { transform: { count: 2, span: { angle: Math.PI } } } });
    nearPoint(middle(state, 'A', copy(hole, ['P', 1])), [-12, 0, 2.5]);
    // the full circle with the same count divides it evenly instead
    state = run(engine, { type: 'updateFeature', id: 'P', patch: { transform: { count: 3, span: { type: 'full' } } } });
    nearPoint(middle(state, 'A', copy(hole, ['P', 1])), [-6, 12 * Math.sin(Math.PI / 3), 2.5]);
    // A full turn as an angle puts the last copy onto the original. As with an extrusion that cuts
    // the same hole again, faces of the hole are taken over by the later tool and nothing else changes.
    state = run(engine, { type: 'updateFeature', id: 'P', patch: { transform: { count: 2, span: { type: 'angle', angle: 2 * Math.PI } } } });
    expect(status(state).P).toBe('ok');
    near(volumeOf(state, 'A'), (DISC - HOLE) * 5, 0.05);
    expect(names(state, 'A', 'H')).toContain('H/side/k@P:1');
  });

  it('the axis through a point of a sketch is the normal of its plane', () => {
    const engine = drilled('both');
    // a point at (6, 0) of a sketch in the XY plane: half a turn moves the hole from (12, 0) to the origin
    run(engine, addSketch('S3', XY), { type: 'addPoint', sketch: 'S3', id: 'q', x: 6, y: 0 });
    let state = run(engine, pattern('P', features('H'), 2, { axis: { kind: 'sketchPoint', sketch: 'S3', point: 'q' } }));
    expectAllOk(state);
    nearPoint(middle(state, 'A', copy(hole, ['P', 1])), [0, 0, 2.5]);
    near(volumeOf(state, 'A'), (DISC - 2 * HOLE) * 5, 0.05);
    // the origin of the sketch is a point as well
    state = run(engine, { type: 'updateFeature', id: 'P', patch: { transform: { axis: { kind: 'sketchPoint', sketch: 'S3', point: 'origin' } } } });
    nearPoint(middle(state, 'A', copy(hole, ['P', 1])), [-12, 0, 2.5]);
    // a sketch in the YZ plane: its normal is X. The point (3, 0) of the sketch is (0, 3, 0) in the
    // model, so half a turn moves the hole from (12, 0) to (12, 6).
    run(engine, { type: 'addFeature', feature: { ...extrude('x', 'S3', [], 1), id: 'S4', name: 'S4', type: 'sketch', plane: { kind: 'base', plane: 'YZ' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } as never, index: 4 });
    run(engine, { type: 'addPoint', sketch: 'S4', id: 'w', x: 3, y: 0 });
    state = run(engine, { type: 'updateFeature', id: 'P', patch: { transform: { axis: { kind: 'sketchPoint', sketch: 'S4', point: 'w' } } } });
    expectAllOk(state);
    nearPoint(middle(state, 'A', copy(hole, ['P', 1])), [12, 6, 2.5]);
    // the base axis X goes through the origin: the copy falls onto the original
    state = run(engine, { type: 'updateFeature', id: 'P', patch: { transform: { axis: { kind: 'base', axis: 'X' } } } });
    expect(status(state).P).toBe('ok');
    near(volumeOf(state, 'A'), (DISC - HOLE) * 5, 0.05);
    // a missing point or sketch is a broken reference
    state = run(engine, { type: 'updateFeature', id: 'P', patch: { transform: { axis: { kind: 'sketchPoint', sketch: 'S4', point: 'w' } } } }, { type: 'removeEntity', sketch: 'S4', id: 'w' });
    expect(status(state).P).toBe('error:brokenReference');
    expect(state.evaluation.features.P.error?.refs).toEqual(['w']);
    state = run(engine, { type: 'removeFeature', id: 'S4' });
    expect(status(state).P).toBe('error:brokenReference');
    expect(state.evaluation.features.P.error?.refs).toEqual(['S4']);
    near(volumeOf(state, 'A'), (DISC - HOLE) * 5, 0.05);
  });

  it('a cut through all is measured again in every copy: an axis perpendicular to the extrusion, material added in between', () => {
    // A block 40 × 20 × 30 (z from −15 to 15) with a hole along Z at (10, 10). After the hole a boss
    // 15 × 20 × 10 is added to the side x = 40. The pattern turns the hole by 90° around the Y axis:
    // the copy runs along X at y = 10, z = −10 and has to pass 55 mm of material, not the 30 mm the
    // original passed, and through the boss that did not exist when the original was cut.
    const engine = newEngine();
    run(
      engine,
      addSketch('S1', XY),
      rectangle('S1', 'r', 0, 0, 40, 20),
      span('A', 'S1', [rectLoop('r')], -15, 30),
      addSketch('S2', XY),
      circle('S2', 'k', 10, 10, 2),
      through('H', 'S2', [['k']], 'both', ['A']),
      addSketch('S3', XY),
      rectangle('S3', 'b', 40, 0, 15, 20, null),
      span('B', 'S3', [rectLoop('b')], -15, 10, 'add', ['A']),
    );
    let state = run(engine, pattern('P', features('H'), 2, { axis: { kind: 'base', axis: 'Y' }, span: { type: 'angle', angle: Math.PI / 2 } }));
    expectAllOk(state);
    // a through hole: only its side is in the body, and it spans the block and the boss
    expect(names(state, 'A', 'H')).toEqual(['H/side/k', 'H/side/k@P:1']);
    const turned = faceBox(state, 'A', copy(hole, ['P', 1]))!;
    nearPoint(turned.min, [0, 8, -12]);
    nearPoint(turned.max, [55, 12, -8]);
    // the two holes cross: their common part is counted once (16 r³ / 3 for ideal cylinders)
    const crossing = (16 * 2 ** 3) / 3;
    near(volumeOf(state, 'A'), 40 * 20 * 30 + 15 * 20 * 10 - HOLE * 30 - HOLE * 55 + crossing, 1);

    // without the boss the copy is 40 mm long
    state = run(engine, { type: 'setSuppressed', id: 'B', suppressed: true });
    nearPoint(faceBox(state, 'A', copy(hole, ['P', 1]))!.max, [40, 12, -8]);
    near(volumeOf(state, 'A'), 40 * 20 * 30 - HOLE * 30 - HOLE * 40 + crossing, 1);
    // the target changes: the block is 60 mm wide in Y, which neither hole cares about, and 80 mm long
    state = run(engine, { type: 'setSuppressed', id: 'B', suppressed: false }, { type: 'setConstraintValue', sketch: 'S1', id: 'rw', value: 80 });
    expect(status(state).P).toBe('ok');
    // the boss now lies inside the block; the copy passes all 80 mm
    nearPoint(faceBox(state, 'A', copy(hole, ['P', 1]))!.min, [0, 8, -12]);
    nearPoint(faceBox(state, 'A', copy(hole, ['P', 1]))!.max, [80, 12, -8]);

    // one side only: the copy starts in the turned sketch plane (x = 0) and goes along the turned normal
    state = run(engine, { type: 'updateFeature', id: 'H', patch: { extent: { side: 'forward' } } });
    expect(status(state)).toMatchObject({ H: 'ok', P: 'ok' });
    nearPoint(faceBox(state, 'A', copy(hole, ['P', 1]))!.max, [80, 12, -8]);
    // against the turned normal there is nothing to cut: the original still cuts, the copy does not
    state = run(engine, { type: 'updateFeature', id: 'H', patch: { extent: { side: 'backward' } } });
    expect(status(state)).toMatchObject({ H: 'ok', P: 'warning:noEffect' });
    expect(state.evaluation.features.P.warnings[0].refs).toEqual([{ copy: 1, feature: 'H', targets: ['A'] }]);
  });

  it('several sources keep their own targets and their order: a hole through two bodies with a pocket in one', () => {
    // two discs on top of each other; the hole goes through both, the pocket is in the upper one
    const engine = newEngine();
    run(
      engine,
      addSketch('S1', XY),
      circle('S1', 'o', 0, 0, 20),
      span('A', 'S1', [['o']], 0, 5),
      span('B', 'S1', [['o']], 5, 5),
      addSketch('S2', XY),
      circle('S2', 'k', 12, 0, 2),
      { type: 'addCurve', sketch: 'S2', id: 'm', curve: { type: 'circle', center: 'kc' }, radius: 4 },
      { type: 'addConstraint', sketch: 'S2', id: 'mr', constraint: { type: 'radius', curve: 'm', value: 4, driving: true } },
      through('H', 'S2', [['k']], 'forward', ['A', 'B']),
      span('K', 'S2', [['m'], ['k']], 8, 2, 'cut', ['B']),
    );
    let state = run(engine, pattern('P', features('H', 'K'), 3));
    expectAllOk(state);
    near(volumeOf(state, 'A'), (DISC - 3 * HOLE) * 5, 0.05);
    near(volumeOf(state, 'B'), DISC * 5 - 3 * (HOLE * 3 + disc(4) * 2), 0.1);
    expect(names(state, 'A', 'H')).toEqual(['H/side/k', 'H/side/k@P:1', 'H/side/k@P:2']);
    expect(names(state, 'A', 'K')).toEqual([]);
    expect(names(state, 'B', 'K')).toEqual(['K/side/m', 'K/side/m@P:1', 'K/side/m@P:2', 'K/startCap', 'K/startCap@P:1', 'K/startCap@P:2']);
    nearPoint(middle(state, 'B', copy(cap('K', 'startCap'), ['P', 2])), [-6, -12 * Math.sin(Math.PI / 3), 8]);
    // the order of the list does not change the result here
    const swapped = run(engine, { type: 'updateFeature', id: 'P', patch: { source: { features: ['K', 'H'] } } });
    expectAllOk(swapped);
    near(volumeOf(swapped, 'B'), volumeOf(state, 'B'), 1e-3);
    // a source that is suppressed has no tool: the pattern is in error and changes nothing
    state = run(engine, { type: 'setSuppressed', id: 'K', suppressed: true });
    expect(status(state).P).toBe('error:brokenReference');
    expect(state.evaluation.features.P.error?.refs).toEqual(['K']);
    near(volumeOf(state, 'A'), (DISC - HOLE) * 5, 0.05);
    near(volumeOf(state, 'B'), (DISC - HOLE) * 5, 0.05);
    // and so is one in error
    state = run(engine, { type: 'setSuppressed', id: 'K', suppressed: false }, { type: 'setSuppressed', id: 'B', suppressed: true });
    expect(status(state)).toMatchObject({ H: 'error:brokenReference', K: 'error:brokenReference', P: 'error:brokenReference' });
    expect(state.evaluation.features.P.error?.refs).toEqual(['K', 'H']);
  });

  it('a source that missed its target still has a tool; copies that miss are named; one failed copy fails the pattern', () => {
    // a block at x from 5 to 25; the hole is drawn on the other side of the axis and misses it
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 5, -5, 20, 10, null), span('A', 'S1', [rectLoop('r')], 0, 5), addSketch('S2', XY), circle('S2', 'k', -15, 0, 2));
    let state = run(engine, through('H', 'S2', [['k']], 'forward', ['A']), pattern('P', features('H'), 2));
    expect(status(state)).toMatchObject({ H: 'warning:noEffect', P: 'ok' });
    near(volumeOf(state, 'A'), 1000 - HOLE * 5);
    expect(names(state, 'A', 'H')).toEqual(['H/side/k@P:1']);
    nearPoint(middle(state, 'A', copy(hole, ['P', 1])), [15, 0, 2.5]);
    // four copies: the first and the third miss the block
    state = run(engine, setCount('P', 4));
    expect(status(state).P).toBe('warning:noEffect');
    expect(state.evaluation.features.P.warnings[0].refs).toEqual([
      { copy: 1, feature: 'H', targets: ['A'] },
      { copy: 3, feature: 'H', targets: ['A'] },
    ]);
    near(volumeOf(state, 'A'), 1000 - HOLE * 5);
    expect(names(state, 'A', 'H')).toEqual(['H/side/k@P:2']);

    // A small pin above the block where the second copy lands: the copy would remove it whole. The
    // pattern is atomic, so the block keeps even the hole that copy would have made.
    run(engine, { type: 'addFeature', feature: { ...extrude('x', 'S1', [], 1), id: 'S3', name: 'S3', type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } as never, index: 2 });
    run(engine, circle('S3', 'c', 15, 0, 1.5), { type: 'addFeature', feature: { ...extrude('C', 'S3', [['c']], 5), extent: { type: 'distance', start: 10, distance: 5 } }, index: 3 });
    state = run(engine, { type: 'updateFeature', id: 'H', patch: { targets: ['A', 'C'] } });
    expect(status(state)).toMatchObject({ H: 'warning:noEffect', P: 'error:emptyResult' });
    expect(state.evaluation.features.P.error?.refs).toEqual([{ copy: 2, feature: 'H' }, 'C']);
    expect(state.evaluation.features.P.error?.message).toMatch(/copy 2 of "H"/);
    near(volumeOf(state, 'A'), 1000);
    near(volumeOf(state, 'C'), disc(1.5) * 5);
    expect(names(state, 'A', 'H')).toEqual([]);
    // fewer copies and the pattern recovers
    state = run(engine, setCount('P', 2), { type: 'updateFeature', id: 'P', patch: { transform: { span: { type: 'angle', angle: Math.PI / 2 } } } });
    expect(status(state).P).toBe('warning:noEffect');
  });
});

describe('a circular pattern of a body', () => {
  // A block 4 × 4 × 6 at x from 10 to 14 with a hole of radius 1 through it, copied three times around Z.
  function blocks() {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 10, -2, 4, 4, null), span('A', 'S1', [rectLoop('r')], 0, 6), addSketch('S2', XY), circle('S2', 'k', 12, 0, 1), through('H', 'S2', [['k']], 'forward', ['A']));
    run(engine, pattern('P', { type: 'body', body: 'A' }, 3));
    return engine;
  }
  const BLOCK = (16 - disc(1)) * 6;
  const tag = (name: FaceName, index: number): FaceName => copy(name, ['P', index]);

  it('the copies are new bodies with the faces of every feature the source has', () => {
    const engine = blocks();
    const state = engine.getState();
    expectAllOk(state);
    expect(state.evaluation.features.P.bodies).toEqual(['P/1', 'P/2']);
    expect(Object.keys(state.evaluation.bodies)).toEqual(['A', 'P/1', 'P/2']);
    for (const body of ['A', 'P/1', 'P/2']) near(volumeOf(state, body), BLOCK, 0.01);
    expect(names(state, 'A')).toEqual(['A/endCap', 'A/side/ra', 'A/side/rb', 'A/side/rc', 'A/side/rd', 'A/startCap', 'H/side/k']);
    expect(names(state, 'P/1')).toEqual(['A/endCap@P:1', 'A/side/ra@P:1', 'A/side/rb@P:1', 'A/side/rc@P:1', 'A/side/rd@P:1', 'A/startCap@P:1', 'H/side/k@P:1']);
    expect(names(state, 'P/2')).toEqual(['A/endCap@P:2', 'A/side/ra@P:2', 'A/side/rb@P:2', 'A/side/rc@P:2', 'A/side/rd@P:2', 'A/startCap@P:2', 'H/side/k@P:2']);
    const [c, s] = [Math.cos((2 * Math.PI) / 3), Math.sin((2 * Math.PI) / 3)];
    nearPoint(middle(state, 'P/1', tag(hole, 1)), [12 * c, 12 * s, 3], 0.02);
    nearPoint(middle(state, 'P/2', tag(hole, 2)), [12 * c, -12 * s, 3], 0.02);
    // the top of a copy is planar and still on top; the hole is still a cylinder
    const faces = (body: Id) => Object.fromEntries(state.evaluation.bodies[body].faces.map((f) => [names(state, body)[0] && JSON.stringify(state.evaluation.faceNames[f.id]), f.planar]));
    expect(faces('P/1')[JSON.stringify(tag(cap('A'), 1))]).toBe(true);
    expect(faces('P/1')[JSON.stringify(tag(hole, 1))]).toBe(false);
    expect(faceBox(state, 'P/1', tag(cap('A'), 1))).toMatchObject({ min: [expect.anything(), expect.anything(), 6], max: [expect.anything(), expect.anything(), 6] });
    // the edges of a copy keep their kinds: the rim of the hole is a circle
    const kinds = (body: Id) => state.evaluation.bodies[body].edges.map((e) => e.kind).sort();
    expect(kinds('P/1')).toEqual(kinds('A'));
    expect(kinds('P/1')).toContain('circle');
    // undo, save and load
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.getState().evaluation).toEqual(state.evaluation);
    engine.undo();
    expect(Object.keys(engine.getState().evaluation.bodies)).toEqual(['A']);
  });

  it('a copy is a body like any other: a sketch on its face, a projected edge, a cut', () => {
    const engine = blocks();
    const top = tag(cap('A'), 1);
    // the rim of the hole of the copy, projected into a sketch on the top of the copy
    const rim = { a: top, b: tag(hole, 1) };
    let state = run(engine, addSketch('S3', onFace('P/1', top)), { type: 'addExternal', sketch: 'S3', id: 'x', ref: { type: 'edge', body: 'P/1', edge: rim, kind: 'circle' } });
    expectAllOk(state);
    expect(state.evaluation.features.S3.plane?.origin[2]).toBeCloseTo(6, 6);
    expect(state.evaluation.features.S3.sketch?.radii.x).toBeCloseTo(1, 6);
    // a wide circle cut 1 mm into the copy takes its top millimetre and nothing of the other bodies
    state = run(engine, { type: 'addCurve', sketch: 'S3', id: 'w', curve: { type: 'circle', center: 'origin' }, radius: 100 }, span('C', 'S3', [['w']], 0, -1, 'cut', ['P/1']));
    expectAllOk(state);
    near(volumeOf(state, 'P/1'), (16 - disc(1)) * 5, 0.01);
    near(volumeOf(state, 'A'), BLOCK, 0.01);
    near(volumeOf(state, 'P/2'), BLOCK, 0.01);
    expect(names(state, 'P/1')).toContain('C/endCap');
    // one cut through several copies
    state = run(engine, { type: 'updateFeature', id: 'C', patch: { targets: ['P/1', 'P/2', 'A'] } });
    expectAllOk(state);
    for (const body of ['A', 'P/1', 'P/2']) near(volumeOf(state, body), (16 - disc(1)) * 5, 0.01);
    // fewer copies: the feature that refers to a copy that is gone is a broken reference, as is the sketch on it
    state = run(engine, { type: 'updateFeature', id: 'C', patch: { targets: ['P/2'] } }, setCount('P', 2));
    expect(state.evaluation.features.P.bodies).toEqual(['P/1']);
    expect(status(state).C).toBe('error:brokenReference');
    expect(state.evaluation.features.C.error?.refs).toEqual(['P/2']);
    expect(status(state).S3).toBe('ok');
    state = run(engine, setCount('P', 1));
    expect(state.evaluation.features.P.bodies).toEqual([]);
    expect(status(state)).toMatchObject({ P: 'ok', S3: 'error:brokenReference', C: 'error:brokenReference' });
  });

  it('a change of the source changes the copies; what is added after the pattern does not', () => {
    const engine = blocks();
    // a boss on the source added after the pattern
    let state = run(engine, addSketch('S3', XY), circle('S3', 'b', 12, 0, 1.5), span('T', 'S3', [['b']], 6, 2, 'add', ['A']));
    expectAllOk(state);
    near(volumeOf(state, 'A'), BLOCK + disc(1.5) * 2, 0.02);
    near(volumeOf(state, 'P/1'), BLOCK, 0.01);
    // the same boss moved before the pattern is copied with the body
    state = run(engine, { type: 'moveFeature', id: 'S3', index: 4 }, { type: 'moveFeature', id: 'T', index: 5 });
    expectAllOk(state);
    for (const body of ['A', 'P/1', 'P/2']) near(volumeOf(state, body), BLOCK + disc(1.5) * 2, 0.02);
    // the boss is wider than the hole, so its bottom shows inside the hole
    expect(names(state, 'P/2', 'T')).toEqual(['T/endCap@P:2', 'T/side/b@P:2', 'T/startCap@P:2']);
    // the height of the source
    state = run(engine, { type: 'updateFeature', id: 'A', patch: { extent: { distance: 3 } } });
    expect(bounds(state, 'P/2').max[2]).toBeCloseTo(8, 5);
    // a missing source
    state = run(engine, { type: 'setSuppressed', id: 'A', suppressed: true });
    expect(status(state).P).toBe('error:brokenReference');
    expect(state.evaluation.features.P.error?.refs).toEqual(['A']);
    expect(state.evaluation.features.P.bodies).toEqual([]);
    expect(Object.keys(state.evaluation.bodies)).toEqual([]);
  });

  it('a pattern of a pattern: the tags of a face grow, the latest pattern last', () => {
    const engine = blocks();
    // the first copy turned around the X axis, and holes repeated in the source before it was copied
    let state = run(engine, pattern('Q', { type: 'body', body: 'P/1' }, 2, { axis: { kind: 'base', axis: 'X' } }));
    expectAllOk(state);
    expect(state.evaluation.features.Q.bodies).toEqual(['Q/1']);
    expect(names(state, 'Q/1')).toEqual(['A/endCap@P:1@Q:1', 'A/side/ra@P:1@Q:1', 'A/side/rb@P:1@Q:1', 'A/side/rc@P:1@Q:1', 'A/side/rd@P:1@Q:1', 'A/startCap@P:1@Q:1', 'H/side/k@P:1@Q:1']);
    // half a turn around X: the copy lies below the XY plane, mirrored in Y
    expect(bounds(state, 'Q/1').min[2]).toBeCloseTo(-6, 5);
    expect(bounds(state, 'Q/1').max[2]).toBeCloseTo(0, 5);
    const first = bounds(state, 'P/1');
    expect(bounds(state, 'Q/1').min[1]).toBeCloseTo(-first.max[1], 4);
    near(volumeOf(state, 'Q/1'), BLOCK, 0.01);
    // a sketch on the bottom of the copy of the copy
    const bottom = copy(cap('A'), ['P', 1], ['Q', 1]);
    state = run(engine, addSketch('S3', onFace('Q/1', bottom)));
    expectAllOk(state);
    expect(state.evaluation.features.S3.plane?.origin[2]).toBeCloseTo(-6, 5);

    // a pattern of features inside the source, then the body pattern over it
    const inner = newEngine();
    run(inner, addSketch('S1', XY), circle('S1', 'o', 30, 0, 8), span('A', 'S1', [['o']], 0, 4), addSketch('S2', XY), circle('S2', 'k', 34, 0, 1), through('H', 'S2', [['k']], 'forward', ['A']));
    run(inner, addSketch('S3', XY), { type: 'addPoint', sketch: 'S3', id: 'q', x: 30, y: 0 }, pattern('P', features('H'), 4, { axis: { kind: 'sketchPoint', sketch: 'S3', point: 'q' } }));
    state = run(inner, pattern('Q', { type: 'body', body: 'A' }, 2));
    expectAllOk(state);
    expect(names(state, 'Q/1', 'H')).toEqual(['H/side/k@P:1@Q:1', 'H/side/k@P:2@Q:1', 'H/side/k@P:3@Q:1', 'H/side/k@Q:1']);
    near(volumeOf(state, 'Q/1'), (disc(8) - 4 * disc(1)) * 4, 0.02);
    nearPoint(middle(state, 'Q/1', copy(hole, ['P', 1], ['Q', 1])), [-30, -4, 2], 0.02);
  });
});

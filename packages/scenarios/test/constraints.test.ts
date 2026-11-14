// The constraints of D35 point 6 (equal radius, fixed point) against the real solver: a plate with
// holes whose centres are given by coordinates and whose size comes from one dimension.
import { describe, expect, it } from 'vitest';
import { type Command, type Constraint, type Engine, type FixedInput, type Id, type Input, type SketchResult, fieldsOf } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, constrain, dimension, newEngine, rectLoop, rectangle, run, status, volume } from './kit';

const HOLES = ['q1', 'q2', 'q3', 'q4'];
const add = (sketch: Id, id: Id, constraint: Input<Constraint> | FixedInput): Command => ({ type: 'addConstraint', sketch, id, constraint });
const sketchOf = (engine: Engine, id: Id): SketchResult => engine.getState().evaluation.features[id].sketch!;
const at = (engine: Engine, sketch: Id, point: Id): [number, number] => {
  const p = sketchOf(engine, sketch).points[point];
  return [p.x, p.y];
};
const near = (expected: [number, number]) => [expect.closeTo(expected[0], 6), expect.closeTo(expected[1], 6)];

// A plate 60 × 40 × 5 with its corner in the origin and four holes drawn by hand: the centres are
// fixed at coordinates that follow the parameter `margin`, the first hole has a diameter and the
// others the same radius.
function plate(): Engine {
  const engine = newEngine();
  run(
    engine,
    { type: 'setParameter', name: 'margin', expr: '6' },
    { type: 'setParameter', name: 'bore', expr: '4' },
    addSketch('S1', XY),
    rectangle('S1', 'r', 0, 0, 60, 40),
    addExtrude('plate', 'S1', [rectLoop('r')], 5),
    addSketch('S2', XY),
    batch(
      ...HOLES.flatMap((id, i): Command[] => [
        { type: 'addPoint', sketch: 'S2', id: `${id}c`, x: 10 + 9 * i, y: 12 + 3 * i },
        { type: 'addCurve', sketch: 'S2', id, curve: { type: 'circle', center: `${id}c` }, radius: 1 + i },
      ]),
    ),
    add('S2', 'f1', { type: 'fixed', point: 'q1c', x: 'margin', y: 'margin' }),
    add('S2', 'f2', { type: 'fixed', point: 'q2c', x: '60 - margin', y: 'margin' }),
    add('S2', 'f3', { type: 'fixed', point: 'q3c', x: '60 - margin', y: '40 - margin' }),
    add('S2', 'f4', { type: 'fixed', point: 'q4c', x: 'margin', y: '40 - margin' }),
    dimension('S2', 'd', { type: 'diameter', curve: 'q1' }, 4),
    { type: 'setField', feature: 'S2', path: 'constraints/d/value', value: 'bore' },
    add('S2', 'e12', { type: 'equalRadius', a: 'q1', b: 'q2' }),
    add('S2', 'e23', { type: 'equalRadius', a: 'q2', b: 'q3' }),
    add('S2', 'e34', { type: 'equalRadius', a: 'q3', b: 'q4' }),
    { type: 'addFeature', feature: { id: 'holes', name: 'holes', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S2', regions: HOLES.map((id) => ({ outerLoop: [id] })) }, extent: { type: 'throughAll', side: 'both' }, operation: 'cut', targets: ['plate'] } },
  );
  return engine;
}
const plateVolume = (bore: number): number => 60 * 40 * 5 - 4 * Math.PI * (bore / 2) ** 2 * 5;

describe('a plate with holes at coordinates (D35, point 6)', () => {
  it('fixed centres and equal radii determine the sketch fully and follow the parameters', () => {
    const engine = plate();
    let state = engine.getState();
    expect(status(state)).toEqual({ S1: 'ok', plate: 'ok', S2: 'ok', holes: 'ok' });
    expect(sketchOf(engine, 'S2')).toMatchObject({ degreesOfFreedom: 0, conflicting: [], redundant: [], valid: true });
    expect(engine.diagnoseSketch('S2')).toEqual({ status: 'solved', degreesOfFreedom: 0, conflicting: [], duplicates: [], redundant: [], removable: [], free: [] });
    expect(HOLES.map((id) => at(engine, 'S2', `${id}c`))).toEqual([near([6, 6]), near([54, 6]), near([54, 34]), near([6, 34])]);
    for (const id of HOLES) expect(sketchOf(engine, 'S2').radii[id]).toBeCloseTo(2, 8);
    expect(volume(state.evaluation.bodies.plate.solid) / plateVolume(4)).toBeCloseTo(1, 3);
    // the numeric fields of the sketch: the dimension and two coordinates for each fixed point
    expect(fieldsOf(state.document.features.find((f) => f.id === 'S2')!).map((f) => [f.path, f.expr, f.value])).toEqual([
      ['constraints/f1/x', 'margin', 6],
      ['constraints/f1/y', 'margin', 6],
      ['constraints/f2/x', '60 - margin', 54],
      ['constraints/f2/y', 'margin', 6],
      ['constraints/f3/x', '60 - margin', 54],
      ['constraints/f3/y', '40 - margin', 34],
      ['constraints/f4/x', 'margin', 6],
      ['constraints/f4/y', '40 - margin', 34],
      ['constraints/d/value', 'bore', 4],
    ]);

    // one parameter moves all four centres, another one sizes all four holes
    state = run(engine, { type: 'setParameter', name: 'margin', expr: '10' }, { type: 'setParameter', name: 'bore', expr: '6' });
    expect(status(state)).toEqual({ S1: 'ok', plate: 'ok', S2: 'ok', holes: 'ok' });
    expect(HOLES.map((id) => at(engine, 'S2', `${id}c`))).toEqual([near([10, 10]), near([50, 10]), near([50, 30]), near([10, 30])]);
    for (const id of HOLES) expect(sketchOf(engine, 'S2').radii[id]).toBeCloseTo(3, 8);
    expect(volume(state.evaluation.bodies.plate.solid) / plateVolume(6)).toBeCloseTo(1, 3);
    // the stored document keeps the last values and the expressions
    const stored = JSON.parse(engine.save()).features.find((f: { id: Id }) => f.id === 'S2');
    expect(stored.constraints.f3).toEqual({ type: 'fixed', point: 'q3c', x: 50, y: 30 });
    expect(stored.expressions['constraints/f3/x']).toBe('60 - margin');

    // one coordinate changed by setField: a number replaces the expression
    state = run(engine, { type: 'setField', feature: 'S2', path: 'constraints/f3/y', value: 25 });
    expect(at(engine, 'S2', 'q3c')).toEqual(near([50, 25]));
    expect(sketchOf(engine, 'S2').degreesOfFreedom).toBe(0);
    // undo, redo and a load of the saved document give the same model
    const saved = engine.save();
    const solid = state.evaluation.bodies.plate.solid;
    engine.undo();
    expect(at(engine, 'S2', 'q3c')).toEqual(near([50, 30]));
    engine.redo();
    expect(at(engine, 'S2', 'q3c')).toEqual(near([50, 25]));
    const again = newEngine();
    expect(again.load(saved).ok).toBe(true);
    expect(again.save()).toBe(saved);
    expect(volume(again.getState().evaluation.bodies.plate.solid)).toBeCloseTo(volume(solid), 6);
  });

  it('a fixed point does not move when dragged, the rest of the sketch does', () => {
    const engine = plate();
    run(engine, { type: 'dragPoint', sketch: 'S2', point: 'q1c', x: 30, y: 20 });
    expect(at(engine, 'S2', 'q1c')).toEqual(near([6, 6]));
    // without the equal radii and the dimension a hole is free to grow, its centre is not
    run(engine, { type: 'removeConstraint', sketch: 'S2', id: 'e34' });
    expect(engine.diagnoseSketch('S2')).toMatchObject({ degreesOfFreedom: 1, free: [{ id: 'q4', kind: 'radius', freedom: 1 }] });
    // a point fixed where it is: the command gives no coordinates
    run(engine, { type: 'addPoint', sketch: 'S2', id: 'loose', x: 21.5, y: 17.25 });
    expect(sketchOf(engine, 'S2').degreesOfFreedom).toBe(3);
    const state = run(engine, add('S2', 'here', { type: 'fixed', point: 'loose' }));
    expect(sketchOf(engine, 'S2').degreesOfFreedom).toBe(1);
    expect(state.document.features.find((f) => f.id === 'S2')).toMatchObject({ constraints: { here: { type: 'fixed', point: 'loose', x: 21.5, y: 17.25 } } });
    run(engine, { type: 'dragPoint', sketch: 'S2', point: 'loose', x: 0, y: 0 });
    expect(at(engine, 'S2', 'loose')).toEqual(near([21.5, 17.25]));
  });

  it('a dimension against a fixed point is a conflict, one that agrees is redundant', () => {
    const engine = plate();
    // 20 mm from the origin horizontally cannot hold for a centre fixed at x = 6
    let state = run(engine, dimension('S2', 'clash', { type: 'horizontalDistance', a: 'origin', b: 'q1c' }, 20));
    expect(status(state).S2).toBe('warning:sketchConflict');
    expect(sketchOf(engine, 'S2').conflicting).toEqual(expect.arrayContaining(['clash', 'f1']));
    expect(engine.diagnoseSketch('S2')).toMatchObject({ status: 'conflict' });
    // the value that agrees with the coordinate is accepted and reported as redundant, explained by the fixed point
    state = run(engine, { type: 'setConstraintValue', sketch: 'S2', id: 'clash', value: 6 });
    expect(status(state).S2).toBe('ok');
    expect(engine.diagnoseSketch('S2')).toMatchObject({ status: 'solved', degreesOfFreedom: 0 });
    expect(engine.diagnoseSketch('S2').redundant).toContain('clash');
    expect(engine.explainConstraint('S2', 'clash')).toEqual({ redundant: true, impliedBy: ['f1'] });
    run(engine, { type: 'removeConstraint', sketch: 'S2', id: 'clash' });

    // a distance between two fixed centres: redundant, implied by both of them
    run(engine, dimension('S2', 'span', { type: 'distance', a: 'q1c', b: 'q2c' }, 48));
    expect(engine.explainConstraint('S2', 'span')).toEqual({ redundant: true, impliedBy: ['f1', 'f2'] });
    // the parameter moves the centres, the dimension does not follow: a conflict that names it
    state = run(engine, { type: 'setParameter', name: 'margin', expr: '8' });
    expect(status(state).S2).toBe('warning:sketchConflict');
    expect(sketchOf(engine, 'S2').conflicting).toContain('span');
    run(engine, { type: 'removeConstraint', sketch: 'S2', id: 'span' });
    expect(status(engine.getState()).S2).toBe('ok');
  });

  it('equal radius: the closing constraint of a chain is redundant, two different dimensions clash', () => {
    const engine = plate();
    run(engine, add('S2', 'e41', { type: 'equalRadius', a: 'q4', b: 'q1' }));
    const d = engine.diagnoseSketch('S2');
    expect(d).toMatchObject({ status: 'solved', degreesOfFreedom: 0 });
    expect(d.redundant).toEqual(['e12', 'e23', 'e34', 'e41']);
    expect(d.removable).toEqual(['e41']);
    expect(engine.explainConstraint('S2', 'e41')).toEqual({ redundant: true, impliedBy: ['e12', 'e23', 'e34'] });
    expect(engine.explainConstraint('S2', 'd')).toEqual({ redundant: false, impliedBy: [] });
    run(engine, { type: 'removeConstraint', sketch: 'S2', id: 'e41' });
    // a second size in the chain
    let state = run(engine, dimension('S2', 'd3', { type: 'radius', curve: 'q3' }, 5));
    expect(status(state).S2).toBe('warning:sketchConflict');
    expect(sketchOf(engine, 'S2').conflicting).toEqual(expect.arrayContaining(['d', 'd3']));
    // as a reference dimension it only measures the radius the chain gives
    state = run(engine, { type: 'setConstraintValue', sketch: 'S2', id: 'd3', driving: false });
    expect(status(state).S2).toBe('ok');
    expect(sketchOf(engine, 'S2').measurements.d3).toBeCloseTo(2, 8);
    // an arc joins the chain: its radius follows the dimension too
    run(
      engine,
      { type: 'addPoint', sketch: 'S2', id: 'ac', x: 30, y: 20 },
      { type: 'addPoint', sketch: 'S2', id: 'as', x: 33, y: 20 },
      { type: 'addPoint', sketch: 'S2', id: 'ae', x: 30, y: 23.5 },
      { type: 'addCurve', sketch: 'S2', id: 'arc', curve: { type: 'arc', center: 'ac', start: 'as', end: 'ae' } },
      add('S2', 'ea', { type: 'equalRadius', a: 'arc', b: 'q4' }),
    );
    state = run(engine, { type: 'setParameter', name: 'bore', expr: '7' });
    const [c, s, e] = ['ac', 'as', 'ae'].map((id) => at(engine, 'S2', id));
    expect(Math.hypot(s[0] - c[0], s[1] - c[1])).toBeCloseTo(3.5, 6);
    expect(Math.hypot(e[0] - c[0], e[1] - c[1])).toBeCloseTo(3.5, 6);
    expect(sketchOf(engine, 'S2').measurements.d3).toBeCloseTo(3.5, 8);
  });
});

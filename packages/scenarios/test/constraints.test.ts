// The constraints of D35 point 6 (equal radius, fixed point) against the real solver: a plate with
// holes whose centres are given by coordinates and whose size comes from one dimension.
import { describe, expect, it } from 'vitest';
import { type Command, type Constraint, type Engine, type FixedInput, type Id, type Input, type SketchFeature, type SketchResult, featureInput, fieldsOf } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, cap, constrain, dimension, newEngine, rectLoop, rectangle, run, side, status, volume } from './kit';

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

describe('findings of the review of point 6', () => {
  const refused = (engine: Engine, command: Command): string => {
    const result = engine.execute(command);
    if (result.ok) throw new Error('the command should have been refused');
    return result.error.message;
  };
  const feature = (engine: Engine, id: Id): SketchFeature => engine.getState().document.features.find((f) => f.id === id) as SketchFeature;

  it('a fixed point and a dimension that agrees with it, in one batch from a rough estimate', () => {
    const engine = newEngine();
    let state = run(
      engine,
      { type: 'setParameter', name: 'w', expr: '6' },
      addSketch('S1', XY),
      batch({ type: 'addPoint', sketch: 'S1', id: 'p', x: 6.2, y: 0.3 }, add('S1', 'f', { type: 'fixed', point: 'p', x: 'w', y: 0 }), add('S1', 'dd', { type: 'distance', a: 'origin', b: 'p', value: 'w', driving: true })),
    );
    expect(status(state).S1).toBe('ok');
    expect(at(engine, 'S1', 'p')).toEqual(near([6, 0]));
    expect(engine.explainConstraint('S1', 'dd')).toEqual({ redundant: true, impliedBy: ['f'] });
    // both follow the parameter
    state = run(engine, { type: 'setParameter', name: 'w', expr: '9.5' });
    expect(status(state).S1).toBe('ok');
    expect(at(engine, 'S1', 'p')).toEqual(near([9.5, 0]));
  });

  it('fixed without coordinates: inside a batch it is the estimate; the origin and projected points say why they are refused', () => {
    const engine = plate();
    // the point is new in the batch, so the sketch has only the estimate of addPoint for it
    run(engine, batch({ type: 'addPoint', sketch: 'S2', id: 'n', x: 33.25, y: 21.5 }, add('S2', 'fn', { type: 'fixed', point: 'n' })));
    expect(feature(engine, 'S2').constraints.fn).toEqual({ type: 'fixed', point: 'n', x: 33.25, y: 21.5 });
    expect(at(engine, 'S2', 'n')).toEqual(near([33.25, 21.5]));
    // the origin and projected geometry cannot be fixed, with or without coordinates
    expect(refused(engine, add('S2', 'o', { type: 'fixed', point: 'origin' }))).toMatch(/by se nikdy neprojevila/);
    expect(refused(engine, add('S2', 'o', { type: 'fixed', point: 'origin', x: 0, y: 0 }))).toMatch(/by se nikdy neprojevila/);
    run(engine, { type: 'addExternal', sketch: 'S2', id: 'x', ref: { type: 'edge', body: 'plate', edge: { a: cap('plate'), b: side('plate', 'ra') }, kind: 'line' } });
    expect(refused(engine, add('S2', 'o', { type: 'fixed', point: 'x/a' }))).toMatch(/by se nikdy neprojevila/);
    expect(refused(engine, add('S2', 'o', { type: 'fixed', point: 'x/a', x: 1, y: 1 }))).toMatch(/by se nikdy neprojevila/);
    expect(refused(engine, add('S2', 'o', { type: 'equalRadius', a: 'q1', b: 'q1' }))).toMatch(/různé entity/);
  });

  it('equal radius with a projected circle: the own circle follows the body', () => {
    const engine = plate();
    run(
      engine,
      addSketch('S3', XY),
      { type: 'addExternal', sketch: 'S3', id: 'rim', ref: { type: 'edge', body: 'plate', edge: { a: cap('plate'), b: { feature: 'holes', role: 'side', curve: 'q1' } }, kind: 'circle' } },
      batch({ type: 'addPoint', sketch: 'S3', id: 'c', x: 30, y: 20 }, { type: 'addCurve', sketch: 'S3', id: 'k', curve: { type: 'circle', center: 'c' }, radius: 5 }),
    );
    // the projected circle on either side
    for (const [a, b] of [['k', 'rim'], ['rim', 'k']]) {
      const state = run(engine, add('S3', 'eq', { type: 'equalRadius', a, b }));
      expect(status(state).S3).toBe('ok');
      expect(sketchOf(engine, 'S3').radii.k).toBeCloseTo(2, 6);
      expect(sketchOf(engine, 'S3').degreesOfFreedom).toBe(2);
      expect(engine.diagnoseSketch('S3')).toMatchObject({ status: 'solved', degreesOfFreedom: 2, redundant: [] });
      if (a === 'k') engine.undo();
    }
    run(engine, { type: 'setParameter', name: 'bore', expr: '7' });
    expect(sketchOf(engine, 'S3').radii.k).toBeCloseTo(3.5, 6);
    // two projected circles have nothing to move
    run(engine, { type: 'addExternal', sketch: 'S3', id: 'rim2', ref: { type: 'edge', body: 'plate', edge: { a: cap('plate'), b: { feature: 'holes', role: 'side', curve: 'q2' } }, kind: 'circle' } });
    expect(refused(engine, add('S3', 'both', { type: 'equalRadius', a: 'rim', b: 'rim2' }))).toMatch(/by se nikdy neprojevila/);
  });

  it('a parameter of a fixed coordinate that disappears: the sketch warns with the paths and keeps the values', () => {
    const engine = plate();
    const state = run(engine, { type: 'removeParameter', name: 'margin' });
    expect(status(state).S2).toBe('warning:invalidExpression');
    const warning = state.evaluation.features.S2.warnings[0];
    expect(warning.refs).toEqual(['constraints/f1/x', 'constraints/f1/y', 'constraints/f2/x', 'constraints/f2/y', 'constraints/f3/x', 'constraints/f3/y', 'constraints/f4/x', 'constraints/f4/y']);
    expect(warning.message).toMatch(/the field keeps its last valid value/);
    expect(feature(engine, 'S2').constraints.f3).toEqual({ type: 'fixed', point: 'q3c', x: 54, y: 34 });
    expect(at(engine, 'S2', 'q3c')).toEqual(near([54, 34]));
    // one coordinate can be repaired while the other is still broken
    const repaired = run(engine, { type: 'setField', feature: 'S2', path: 'constraints/f3/x', value: 50 });
    expect(repaired.evaluation.features.S2.warnings[0].refs).not.toContain('constraints/f3/x');
    expect(at(engine, 'S2', 'q3c')).toEqual(near([50, 34]));
  });

  it('a loaded document with two fixed constraints on one point reports the duplicate; removing it repairs the sketch', () => {
    const stored = JSON.parse(plate().save());
    const sketch = stored.features.find((f: { id: Id }) => f.id === 'S2');
    sketch.constraints.again = { type: 'fixed', point: 'q1c', x: 6, y: 6 };
    const engine = newEngine();
    expect(engine.load(JSON.stringify(stored)).ok).toBe(true);
    expect(engine.diagnoseSketch('S2')).toMatchObject({ status: 'solved', degreesOfFreedom: 0, duplicates: [['f1', 'again']] });
    expect(at(engine, 'S2', 'q1c')).toEqual(near([6, 6]));
    run(engine, { type: 'removeConstraint', sketch: 'S2', id: 'again' });
    expect(engine.diagnoseSketch('S2')).toMatchObject({ status: 'solved', degreesOfFreedom: 0, duplicates: [], redundant: [] });
  });

  it('the input form of a sketch with fixed points and equal radii adds the same sketch again', () => {
    const engine = plate();
    const original = feature(engine, 'S2');
    const copy = newEngine();
    run(copy, { type: 'setParameter', name: 'margin', expr: '6' }, { type: 'setParameter', name: 'bore', expr: '4' }, { type: 'addFeature', feature: featureInput(original) });
    const added = feature(copy, 'S2');
    expect(added.constraints).toEqual(original.constraints);
    expect(added.expressions).toEqual(original.expressions);
    expect(HOLES.map((id) => at(copy, 'S2', `${id}c`))).toEqual(HOLES.map((id) => near(at(engine, 'S2', `${id}c`))));
  });
});

// Validation scenarios 1 to 3 (docs/requirements.md) against the real adapters.
import { describe, expect, it } from 'vitest';
import type { Command, EngineState } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, cap, circle, constrain, dimension, expectAllOk, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, status, volume } from './kit';

// A plate 40 × 30 × 10 with a through hole, and on its top face a blind hole dimensioned to projected edges.
function plateWithHoles() {
  const engine = newEngine();
  run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), circle('S1', 'k', 10, 10, 4), addExtrude('E1', 'S1', [rectLoop('r')], 10));
  run(
    engine,
    addSketch('S2', onFace('E1', cap('E1'))),
    batch(
      { type: 'addExternal', sketch: 'S2', id: 'right', ref: { type: 'edge', body: 'E1', edge: { a: cap('E1'), b: side('E1', 'rb') }, kind: 'line' } },
      { type: 'addExternal', sketch: 'S2', id: 'bottom', ref: { type: 'edge', body: 'E1', edge: { a: cap('E1'), b: side('E1', 'ra') }, kind: 'line' } },
      { type: 'addPoint', sketch: 'S2', id: 'hc', x: 30, y: 9 },
      { type: 'addCurve', sketch: 'S2', id: 'hole', curve: { type: 'circle', center: 'hc' }, radius: 2.5 },
      dimension('S2', 'fromRight', { type: 'distancePointLine', point: 'hc', line: 'right' }, 8),
      dimension('S2', 'fromBottom', { type: 'distancePointLine', point: 'hc', line: 'bottom' }, 8),
      dimension('S2', 'hr', { type: 'radius', curve: 'hole' }, 3),
    ),
    addExtrude('E2', 'S2', [['hole']], -5, 'cut', 'E1'),
  );
  return engine;
}
const circleArea = (r: number, state: EngineState) => {
  // the area of the polygon by which the engine replaced the circle
  const n = Math.max(8, Math.ceil(Math.PI / Math.acos(1 - state.document.settings.chordTolerance / r) - 1e-9));
  return (n / 2) * r * r * Math.sin((2 * Math.PI) / n);
};

describe('scenario 1: basic pass', () => {
  it('a sketch, an extrude, a sketch on a face with a hole dimensioned to a projected edge, a cut', () => {
    const state = plateWithHoles().getState();
    expectAllOk(state);
    expect(state.evaluation.features.S1.sketch).toMatchObject({ degreesOfFreedom: 0, valid: true, conflicting: [] });
    expect(state.evaluation.features.S2.sketch?.degreesOfFreedom).toBe(0);
    // projected edges: the right edge of the top face is x = 40, the bottom one y = 0
    const points = state.evaluation.features.S2.sketch!.points;
    expect(points['right/a'].x).toBeCloseTo(40, 5);
    expect(points['right/b'].x).toBeCloseTo(40, 5);
    expect(points.hc.x).toBeCloseTo(32, 5);
    expect(points.hc.y).toBeCloseTo(8, 5);
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(12000 - circleArea(4, state) * 10 - circleArea(3, state) * 5, 1);
    expect(faceNames(state, 'E1')).toEqual(['E1/endCap', 'E1/side/k', 'E1/side/ra', 'E1/side/rb', 'E1/side/rc', 'E1/side/rd', 'E1/startCap', 'E2/endCap', 'E2/side/hole']);
    const blind = faceBox(state, 'E1', side('E2', 'hole'))!;
    expect(blind.min[2]).toBeCloseTo(5, 4);
    expect(blind.max[2]).toBeCloseTo(10, 4);
    expect((blind.min[0] + blind.max[0]) / 2).toBeCloseTo(32, 1); // the centre of the bounding box of the polygon
  });

  it('a change of a dimension in the first sketch recomputes everything and the hole keeps its distance from the edge', () => {
    const engine = plateWithHoles();
    const state = run(engine, { type: 'setConstraintValue', sketch: 'S1', id: 'rw', value: 50 });
    expectAllOk(state);
    expect(state.evaluation.features.S2.sketch!.points.hc.x).toBeCloseTo(42, 5);
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(15000 - circleArea(4, state) * 10 - circleArea(3, state) * 5, 1);
    const blind = faceBox(state, 'E1', side('E2', 'hole'))!;
    expect((blind.min[0] + blind.max[0]) / 2).toBeCloseTo(42, 1);
    // the solved variables were written to the document, also for the sketch on the face
    const s2 = state.document.features.find((f) => f.id === 'S2');
    expect(s2).toMatchObject({ points: { hc: { x: expect.closeTo(42, 5) } } });
    // undo returns the previous state including the geometry
    engine.undo();
    expect(engine.getState().evaluation.features.S2.sketch!.points.hc.x).toBeCloseTo(32, 5);
    expect(volume(engine.getState().evaluation.bodies.E1.solid)).toBeCloseTo(12000 - circleArea(4, state) * 10 - circleArea(3, state) * 5, 1);
  });
});

describe('scenario 2: change of topology', () => {
  it('a) another hole in the first sketch: everything still holds', () => {
    const engine = plateWithHoles();
    const before = engine.getState();
    const state = run(engine, circle('S1', 'm', 25, 20, 3));
    expectAllOk(state);
    expect(faceNames(state, 'E1')).toEqual([...faceNames(before, 'E1'), 'E1/side/m'].sort());
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(volume(before.evaluation.bodies.E1.solid) - circleArea(3, state) * 10, 1);
    expect(state.evaluation.features.S2.sketch!.points.hc.x).toBeCloseTo(32, 5);
  });

  it('b) deleting a line of the rectangle: the extrude has no profile and everything that depends on it ends in an error', () => {
    const engine = plateWithHoles();
    const state = run(engine, { type: 'removeEntity', sketch: 'S1', id: 'rc' });
    expect(status(state)).toEqual({ S1: 'ok', E1: 'error:noProfile', S2: 'error:brokenReference', E2: 'error:brokenReference' });
    expect(state.evaluation.bodies).toEqual({});
    expect(state.evaluation.features.E1.error?.refs).toEqual([{ outerLoop: ['ra', 'rb', 'rc', 'rd'] }]);
    // the model stayed in the document and undo returns all of it
    engine.undo();
    expectAllOk(engine.getState());
  });

  it('c) replacing a line by another between the same points', () => {
    const engine = plateWithHoles();
    // a sketch directly on the face from the line rb; the sketch on the cap with a projected edge to this face already exists (S2)
    run(engine, addSketch('S3', onFace('E1', side('E1', 'rb'))));
    expect(status(engine.getState()).S3).toBe('ok');
    const replaced = run(engine, batch({ type: 'removeEntity', sketch: 'S1', id: 'rb' }, { type: 'addCurve', sketch: 'S1', id: 'r9', curve: { type: 'line', a: 'r2', b: 'r3' } }, constrain('S1', 'r9v', { type: 'vertical', line: 'r9' })));
    expect(status(replaced)).toMatchObject({ S1: 'ok', E1: 'error:noProfile' });
    // after a new choice of the profile the extrude passes with the same ID
    const state = run(engine, { type: 'updateFeature', id: 'E1', patch: { profile: { regions: [{ outerLoop: ['r9', 'ra', 'rc', 'rd'] }] } } });
    expect(status(state)).toEqual({ S1: 'ok', E1: 'ok', S2: 'warning:brokenProjection', E2: 'ok', S3: 'error:brokenReference' });
    // the sketch on the cap still holds; the projected edge to the vanished face stayed frozen, the hole did not move
    expect(state.evaluation.features.S2.sketch!.points.hc.x).toBeCloseTo(32, 5);
    expect(state.evaluation.features.S2.warnings[0].refs).toEqual(['right']);
    expect(faceNames(state, 'E1')).toContain('E1/side/r9');
    // repairs without losing IDs: the projection onto the new edge, the sketch onto the new face
    const fixed = run(
      engine,
      { type: 'updateExternal', sketch: 'S2', id: 'right', ref: { type: 'edge', body: 'E1', edge: { a: cap('E1'), b: side('E1', 'r9') }, kind: 'line' } },
      { type: 'setSketchPlane', sketch: 'S3', plane: onFace('E1', side('E1', 'r9')) },
    );
    expectAllOk(fixed);
  });
});

describe('scenario 3: solver', () => {
  const underdetermined = () => {
    const engine = newEngine();
    const commands: Command[] = [
      addSketch('S1', XY),
      batch(
        { type: 'addPoint', sketch: 'S1', id: 'p1', x: 0.3, y: -0.2 },
        { type: 'addPoint', sketch: 'S1', id: 'p2', x: 38, y: 1 },
        { type: 'addPoint', sketch: 'S1', id: 'p3', x: 41, y: 27 },
        { type: 'addPoint', sketch: 'S1', id: 'p4', x: -1, y: 31 },
        { type: 'addCurve', sketch: 'S1', id: 'a', curve: { type: 'line', a: 'p1', b: 'p2' } },
        { type: 'addCurve', sketch: 'S1', id: 'b', curve: { type: 'line', a: 'p2', b: 'p3' } },
        { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'line', a: 'p3', b: 'p4' } },
        { type: 'addCurve', sketch: 'S1', id: 'd', curve: { type: 'line', a: 'p4', b: 'p1' } },
        constrain('S1', 'fix', { type: 'coincident', a: 'p1', b: 'origin' }),
        constrain('S1', 'ha', { type: 'horizontal', line: 'a' }),
        constrain('S1', 'vb', { type: 'vertical', line: 'b' }),
        constrain('S1', 'hc', { type: 'horizontal', line: 'c' }),
        constrain('S1', 'vd', { type: 'vertical', line: 'd' }),
        dimension('S1', 'w', { type: 'distance', a: 'p1', b: 'p2' }, 40),
      ),
      addExtrude('E1', 'S1', [['a', 'b', 'c', 'd']], 10),
    ];
    run(engine, ...commands);
    return engine;
  };

  it('an underconstrained sketch: degrees of freedom, solved positions in the document, the body exists', () => {
    const state = underdetermined().getState();
    expectAllOk(state);
    expect(state.evaluation.features.S1.sketch).toMatchObject({ degreesOfFreedom: 1, conflicting: [], redundant: [] });
    const s1 = state.document.features[0] as Extract<(typeof state.document.features)[number], { type: 'sketch' }>;
    expect(s1.points.p2).toEqual({ x: expect.closeTo(40, 8), y: expect.closeTo(0, 8) });
    expect(s1.solved.inputs).not.toBe('');
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(40 * s1.points.p3.y * 10, 2);
  });

  it('dragging a point: a preview writes nothing, running it writes and can be undone', () => {
    const engine = underdetermined();
    const height = (s: EngineState) => s.evaluation.features.S1.sketch!.points.p3.y;
    const before = engine.getState();
    const preview = engine.preview({ type: 'dragPoint', sketch: 'S1', point: 'p3', x: 55, y: 20 });
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.state.evaluation.features.S1.sketch!.points.p3).toEqual({ x: expect.closeTo(40, 6), y: expect.closeTo(20, 6) });
    expect(volume(preview.state.evaluation.bodies.E1.solid)).toBeCloseTo(8000, 2); // the features after the sketch are computed from the drag
    expect(engine.getState()).toEqual(before);
    // a preview only up to the sketch: the body is not computed
    const partial = engine.preview({ type: 'dragPoint', sketch: 'S1', point: 'p3', x: 55, y: 20 }, 'S1');
    expect(partial.ok && Object.keys(partial.state.evaluation.features)).toEqual(['S1']);
    const state = run(engine, { type: 'dragPoint', sketch: 'S1', point: 'p3', x: 55, y: 20 });
    expect(height(state)).toBeCloseTo(20, 6);
    expect(state.document.features[0]).toMatchObject({ points: { p3: { y: expect.closeTo(20, 6) } } });
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(8000, 2);
    engine.undo();
    expect(height(engine.getState())).toBeCloseTo(height(before), 9);
  });

  it('a conflicting constraint: the diagnosis, the model stays displayed, after the constraint is removed everything returns', () => {
    const engine = underdetermined();
    const before = engine.getState();
    const state = run(engine, dimension('S1', 'w2', { type: 'distance', a: 'p4', b: 'p3' }, 50));
    expect(status(state)).toEqual({ S1: 'warning:sketchConflict', E1: 'ok' });
    expect(state.evaluation.features.S1.sketch!.conflicting).toContain('w2');
    expect(state.evaluation.features.S1.warnings[0].refs).toContain('w2');
    // the stored variables were used: the body is the same as before the conflict and nothing was written
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(volume(before.evaluation.bodies.E1.solid), 6);
    expect(state.document.features[0]).toMatchObject({ points: (before.document.features[0] as { points: object }).points });
    const fixed = run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'w2' });
    expectAllOk(fixed);
    expect(fixed.evaluation.features.S1.sketch!.degreesOfFreedom).toBe(1);
  });

  it('a redundant constraint is neither an error nor a warning', () => {
    const engine = underdetermined();
    const state = run(engine, dimension('S1', 'w2', { type: 'distance', a: 'p4', b: 'p3' }, 40));
    expectAllOk(state);
    expect(state.evaluation.features.S1.sketch!.redundant).toEqual(['w2']);
  });

  it('a reference dimension measures and does not drive the geometry', () => {
    const engine = underdetermined();
    const state = run(engine, constrain('S1', 'm', { type: 'distance', a: 'p2', b: 'p3', value: 1, driving: false }));
    const sketch = state.evaluation.features.S1.sketch!;
    expect(sketch.measurements.m).toBeCloseTo(sketch.points.p3.y, 9);
    expect(sketch.degreesOfFreedom).toBe(1);
  });
});

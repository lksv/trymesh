// Validation scenario 15 (a cover for a controller board, docs/requirements.md). The parts of the
// points of step 6 of D36 each have a `describe` of their own; the board of step 1 is a stand-in
// until 6f imports one, and 6c and 6b build on it.
import { describe, expect, it } from 'vitest';
import { type Command, type Engine, type EngineState, type Id, type SketchFeature, type SketchResult, AXIS_CURVES, AXIS_REACH, lineExtent, solvedCurves } from '@trymesh/engine';
import { pcbByHand, point, standInBoard } from './board-kit';
import { XY, addSketch, batch, constrain, newEngine, run } from './kit';

const resultOf = (state: EngineState, id: Id): SketchResult => state.evaluation.features[id].sketch as SketchResult;
const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
const set = (engine: Engine, name: string, expr: string): EngineState => run(engine, { type: 'setParameter', name, expr });
const refusal = (engine: Engine, command: Command): string => {
  const result = engine.execute(command);
  return result.ok ? 'accepted' : result.error.message;
};

// Fully determined: no freedom and no constraint that follows from the others, in the solver's
// list and in the diagnosis; the body as by hand.
function expectDetermined(engine: Engine, state: EngineState, width: number): void {
  const diagnosis = engine.diagnoseSketch('board');
  expect(diagnosis.status).toBe('solved');
  expect(diagnosis.degreesOfFreedom).toBe(0);
  expect(diagnosis.redundant).toEqual([]);
  expect(resultOf(state, 'board').redundant).toEqual([]);
  expect(resultOf(state, 'board').degreesOfFreedom).toBe(0);
  expect(state.evaluation.features.board.status).toBe('ok');
  expect(state.evaluation.features.pcb.status).toBe('ok');
  expect(state.evaluation.bodies.pcb.volume).toBeCloseTo(pcbByHand(width), 0);
}

describe('scenario 15, step 1: the stand-in board on the axes of the origin (6a2, D71)', () => {
  it('is fully determined, with no redundant constraint, and symmetric about both axes', () => {
    const engine = newEngine();
    const state = standInBoard(engine);
    expectDetermined(engine, state, 60);
    const points = resultOf(state, 'board').points;
    expect(points.bs0.x).toBeCloseTo(30, 9);
    expect(points.be2.x).toBeCloseTo(-27, 9);
    expect(points.be2.y).toBeCloseTo(-20, 9);
    expect(points.hc2.x).toBeCloseTo(-26.5, 9);
    expect(points.hc2.y).toBeCloseTo(-16.5, 9);
    expect(points.bc2.x).toBeCloseTo(-27, 9);
    expect(points.bc2.y).toBeCloseTo(-17, 9);
  });

  it('has the axes in its solver and not in its result', () => {
    const engine = newEngine();
    const state = standInBoard(engine);
    const result = resultOf(state, 'board');
    expect(Object.keys(result.curves)).toEqual([]);
    expect(Object.keys(result.points).filter((id) => id.startsWith('origin/'))).toEqual([]);
    const solved = state.document.features.find((f) => f.id === 'board') as SketchFeature;
    expect(solved.solved.inputs).not.toBe('');
  });

  it('follows its width to 62 and back', () => {
    const engine = newEngine();
    standInBoard(engine);
    const wider = set(engine, 'boardW', '62');
    expect(wider.evaluation.features.board.status).toBe('ok');
    expect(wider.evaluation.bodies.pcb.volume).toBeCloseTo(pcbByHand(62), 0);
    expect(resultOf(wider, 'board').points.hc1.x).toBeCloseTo(-27.5, 9);
    expectDetermined(engine, set(engine, 'boardW', '60'), 60);
  });

  it('follows one parameter at a time from the drawn state', () => {
    for (const [name, values] of [
      ['boardW', ['30', '45', '80', '120']],
      ['boardH', ['20', '60', '120']],
      ['boardR', ['0.2', '8']],
    ] as const) {
      for (const value of values) {
        const engine = newEngine();
        standInBoard(engine);
        const state = set(engine, name, value);
        expect(`${name} ${value}: ${state.evaluation.features.board.status} ${state.evaluation.features.pcb.status}`).toBe(`${name} ${value}: ok ok`);
        const W = name === 'boardW' ? Number(value) : 60;
        const H = name === 'boardH' ? Number(value) : 40;
        const R = name === 'boardR' ? Number(value) : 3;
        expect(state.evaluation.bodies.pcb.volume).toBeCloseTo((W * H - (4 - Math.PI) * R * R - Math.PI * 1.6 * 1.6 * 4) * 1.6, 0);
      }
    }
  });

  it('measures a reference dimension from a hole centre to origin/y: 26.5', () => {
    const engine = newEngine();
    standInBoard(engine);
    const state = run(engine, constrain('board', 'mh', { type: 'distancePointLine', point: 'hc0', line: 'origin/y', value: 1, driving: false }));
    expect(resultOf(state, 'board').measurements.mh).toBeCloseTo(26.5, 9);
  });

  it('a ring revolved about origin/x of a sketch whose constraints name no axis', () => {
    const engine = newEngine();
    const t = 'turnSk';
    run(
      engine,
      addSketch(t, XY),
      batch(
        point(t, 't1', 0, 2),
        point(t, 't2', 10, 2),
        point(t, 't3', 10, 5),
        point(t, 't4', 0, 5),
        ...[
          ['u1', 't1', 't2'],
          ['u2', 't2', 't3'],
          ['u3', 't3', 't4'],
          ['u4', 't4', 't1'],
        ].map(([id, a, b]): Command => ({ type: 'addCurve', sketch: t, id, curve: { type: 'line', a, b } })),
      ),
    );
    const state = run(engine, {
      type: 'addFeature',
      feature: { id: 'ring', name: 'ring', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: t, regions: [{ outerLoop: ['u1', 'u2', 'u3', 'u4'] }] }, axis: { kind: 'sketchLine', sketch: t, line: 'origin/x' }, extent: { type: 'full' }, operation: 'new' },
    });
    expect(state.evaluation.features.ring.status).toBe('ok');
    expect(state.evaluation.bodies.ring.volume).toBeCloseTo(Math.PI * (25 - 4) * 10, -1);
    expect(Math.abs(state.evaluation.bodies.ring.volume - Math.PI * 21 * 10)).toBeLessThan(2);
  });

  it('refuses a midpoint or an equal length with an axis, a constraint of fixed operands, the origin as a symmetric point, a far point', () => {
    const engine = newEngine();
    standInBoard(engine);
    expect(refusal(engine, constrain('board', 'z1', { type: 'midpoint', point: 'hc0', line: 'origin/x' }))).toContain('origin/x is an axis of the origin, a whole line: it has no length and no middle');
    expect(refusal(engine, constrain('board', 'z2', { type: 'equalLength', a: 'bl0', b: 'origin/y' }))).toContain('origin/y is an axis of the origin, a whole line: it has no length and no middle');
    expect(refusal(engine, constrain('board', 'z3', { type: 'pointOnCurve', point: 'origin', curve: 'origin/x' }))).toContain('only between fixed entities');
    expect(refusal(engine, constrain('board', 'z4', { type: 'symmetric', a: 'origin', b: 'hc0', line: 'origin/y' }))).toContain('souměrný bod nesmí být koncem osy');
    expect(refusal(engine, { type: 'removeEntity', sketch: 'board', id: 'origin/x' })).toContain('origin/x');
    expect(refusal(engine, constrain('board', 'z5', { type: 'coincident', a: 'hc0', b: 'origin/x/b' }))).toContain('origin/x/b');
  });

  it('the reader of a solved sketch gives the axes as whole lines, and a point the result lacks from the sketch', () => {
    const engine = newEngine();
    const state = standInBoard(engine);
    const before = solvedCurves(sketchOf(state, 'board'), resultOf(state, 'board'));
    const [x, side] = [before.curves.get('origin/x'), before.curves.get('bl0')];
    expect(AXIS_CURVES.map((curve) => curve.id)).toEqual(['origin/x', 'origin/y']);
    expect(x).toMatchObject({ source: 'reference', regions: false });
    expect(before.geometry.points['origin/x/b']).toEqual({ x: 1, y: 0 });
    expect(lineExtent(x!, before.geometry)).toEqual({ a: { x: -AXIS_REACH, y: 0 }, b: { x: AXIS_REACH, y: 0 } });
    expect(lineExtent(side!, before.geometry)?.a).toEqual(resultOf(state, 'board').points.be0);
    // the sketch after a batch that adds a point, with the result from before it
    const later = run(engine, point('board', 'late', 5, 7));
    const after = solvedCurves(sketchOf(later, 'board'), resultOf(state, 'board'));
    expect(after.geometry.points.late).toEqual({ x: 5, y: 7 });
  });
});

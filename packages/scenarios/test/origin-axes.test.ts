// The axes of the origin (D36 6a2, D71) against the real solver and kernel: `origin/x` and
// `origin/y` are lines of every sketch, an operand of a constraint and the line of an axis; they are
// in the solver only when a constraint names one, not in the result, and a reader without the
// recompute gets them from `solvedCurves`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Anchor, type Command, type Constraint, type Engine, type EngineState, type Id, type SketchFeature, type SketchResult, AXIS_REACH, freshIds, isOriginAxis, lineExtent, sketchTool, solvedCurves, underOrigin } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { Evaluator } from '../../engine/src/evaluate';
import { entityOf, referenceEntities, resolveReferences } from '../../engine/src/references/index';
import { sketchCurves, solverSetup } from '../../engine/src/sketch';
import { AXES_GEOMETRY } from '../../engine/src/sketch-content';
import { XY, addExtrude, addSketch, batch, cap, constrain, dimension, newEngine, rectLoop, rectangle, run, side, status } from './kit';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() };
const sketchOf = (engine: Engine, id: Id): SketchFeature => engine.getState().document.features.find((f) => f.id === id) as SketchFeature;
const resultOf = (engine: Engine, id: Id): SketchResult => engine.getState().evaluation.features[id].sketch as SketchResult;
const at = (engine: Engine, sketch: Id, id: Id): [number, number] => [resultOf(engine, sketch).points[id].x, resultOf(engine, sketch).points[id].y];
const point = (sketch: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
const line = (sketch: Id, id: Id, a: Id, b: Id): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b } });
const refused = (engine: Engine, command: Command): string => {
  const result = engine.execute(command);
  return result.ok ? 'accepted' : result.error.message;
};
const stampOf = (engine: Engine, id: Id): string => sketchOf(engine, id).solved.inputs;
// The stamp an engine without the axes computes for a sketch with no entry of `external`.
const stampWithoutAxes = (sketch: SketchFeature): string => solverSetup(sketch, {}).stamp;
// The state of the recompute (what the step put there), by the evaluator of the engine.
const stateOf = (engine: Engine) => new Evaluator(deps).evaluate(engine.getState().document).state;

// A plate 60 × 40 extruded from S1, and the sketch S2 on XY that projects its bottom edge `ra`.
function plateWithProjection(): Engine {
  const engine = newEngine();
  run(
    engine,
    addSketch('S1', XY),
    rectangle('S1', 'r', 0, 0, 60, 40),
    addExtrude('plate', 'S1', [rectLoop('r')], 5),
    addSketch('S2', XY),
    { type: 'addExternal', sketch: 'S2', id: 'e', ref: { type: 'edge', body: 'plate', edge: { a: cap('plate', 'startCap'), b: side('plate', 'ra') }, kind: 'line' } },
    batch(point('S2', 'p', 10, 10), point('S2', 'q', 20, 15), line('S2', 'l', 'p', 'q')),
  );
  return engine;
}

describe('the axes of the origin: entities', () => {
  it('entityOf answers both axes as lines that are not own, and nothing for a far point', () => {
    const engine = plateWithProjection();
    const sketch = sketchOf(engine, 'S2');
    expect(entityOf(sketch, 'origin/x')).toEqual({ kind: 'line', own: false });
    expect(entityOf(sketch, 'origin/y')).toEqual({ kind: 'line', own: false });
    expect(entityOf(sketch, 'origin/x/b')).toBeUndefined();
    expect(entityOf(sketch, 'origin/y/b')).toBeUndefined();
    expect(entityOf(sketch, 'origin/z')).toBeUndefined();
    expect(Object.keys(referenceEntities(sketch, 'e'))).toEqual(['e', 'e/a', 'e/b']);
    expect([isOriginAxis('origin/x'), isOriginAxis('origin/x/b'), isOriginAxis('origin')]).toEqual([true, false, false]);
    expect([underOrigin('origin/x'), underOrigin('origin/y/b'), underOrigin('origin')]).toEqual([true, true, false]);
  });

  it('every sketch has them in its list of curves and its geometry, with no constraint on them; the result has neither', () => {
    const engine = plateWithProjection();
    const state = stateOf(engine).sketches.S2;
    expect(state.curves.get('origin/x')).toEqual({ id: 'origin/x', shape: { type: 'line', a: 'origin', b: 'origin/x/b' }, source: 'reference', regions: false });
    expect(state.curves.get('origin/y')).toEqual({ id: 'origin/y', shape: { type: 'line', a: 'origin', b: 'origin/y/b' }, source: 'reference', regions: false });
    expect(state.geometry.points['origin/x/b']).toEqual({ x: 1, y: 0 });
    expect(state.geometry.points['origin/y/b']).toEqual({ x: 0, y: 1 });
    // not in the solver: no constraint names them
    expect(Object.keys(state.input.curves).filter(underOrigin)).toEqual([]);
    expect(Object.keys(state.input.points).filter(underOrigin)).toEqual([]);
    const result = resultOf(engine, 'S2');
    expect(Object.keys(result.curves)).toEqual(['e']);
    expect(Object.keys(result.points).filter(underOrigin)).toEqual([]);
    // the list of curves of a sketch without references
    expect(sketchCurves(sketchOf(engine, 'S1'), {}).filter((curve) => isOriginAxis(curve.id)).map((curve) => curve.id)).toEqual(['origin/x', 'origin/y']);
  });

  it('they are in the solver once a constraint names one, under the key origin, and still once in the list', () => {
    const engine = plateWithProjection();
    run(engine, constrain('S2', 'on', { type: 'pointOnCurve', point: 'p', curve: 'origin/x' }));
    const sketch = sketchOf(engine, 'S2');
    const state = stateOf(engine).sketches.S2;
    expect(Object.keys(state.input.curves).filter(underOrigin)).toEqual(['origin/x', 'origin/y']);
    expect(state.input.fixed).toEqual(expect.arrayContaining(['origin', 'origin/x/b', 'origin/y/b']));
    expect([...state.curves.keys()].filter(underOrigin)).toEqual(['origin/x', 'origin/y']);
    expect(Object.keys(resultOf(engine, 'S2').points).filter(underOrigin)).toEqual([]);
    const { resolved } = resolveReferences(sketch, { state: stateOf(engine), frame: state.frame });
    expect(resolved.origin).toEqual({ geometry: AXES_GEOMETRY });
  });
});

describe('the axes of the origin: constraints against the real solver', () => {
  const solve = (constraints: [Id, Constraint][], points: [Id, number, number][], curves: Command[] = []): Engine => {
    const engine = newEngine();
    run(engine, addSketch('S', XY), batch(...points.map(([id, x, y]) => point('S', id, x, y)), ...curves), batch(...constraints.map(([id, c]) => constrain('S', id, c))));
    expect(status(engine.getState()).S).toBe('ok');
    return engine;
  };

  it('a point on each axis, far from the origin', () => {
    const engine = solve(
      [
        ['k1', { type: 'pointOnCurve', point: 'p', curve: 'origin/x' }],
        ['k2', { type: 'pointOnCurve', point: 'q', curve: 'origin/y' }],
      ],
      [
        ['p', 500, 3],
        ['q', -4, -700],
      ],
    );
    expect(at(engine, 'S', 'p')[1]).toBeCloseTo(0, 9);
    expect(at(engine, 'S', 'p')[0]).toBeCloseTo(500, 1);
    expect(at(engine, 'S', 'q')[0]).toBeCloseTo(0, 9);
    expect(at(engine, 'S', 'q')[1]).toBeCloseTo(-700, 1);
  });

  it('two points symmetric about each axis', () => {
    const engine = solve(
      [
        ['f', { type: 'fixed', point: 'a', x: 7, y: 3 }],
        ['k1', { type: 'symmetric', a: 'a', b: 'b', line: 'origin/y' }],
        ['k2', { type: 'symmetric', a: 'a', b: 'c', line: 'origin/x' }],
      ],
      [
        ['a', 7, 3],
        ['b', -6, 2],
        ['c', 8, -4],
      ],
    );
    expect(at(engine, 'S', 'b')).toEqual([expect.closeTo(-7, 9), expect.closeTo(3, 9)]);
    expect(at(engine, 'S', 'c')).toEqual([expect.closeTo(7, 9), expect.closeTo(-3, 9)]);
    expect(resultOf(engine, 'S').degreesOfFreedom).toBe(0);
  });

  it('a circle tangent to the X axis, lines parallel and perpendicular to it, an angle and a distance to the Y axis', () => {
    const engine = solve(
      [
        ['fc', { type: 'fixed', point: 'c', x: 5, y: 3 }],
        ['t', { type: 'tangent', a: 'origin/x', b: 'k' }],
        ['pa', { type: 'parallel', a: 'h', b: 'origin/x' }],
        ['pe', { type: 'perpendicular', a: 'origin/x', b: 'v' }],
        ['an', { type: 'angle', a: 'origin/x', b: 'w', value: Math.PI / 6, driving: true } as Constraint],
        ['d', { type: 'distancePointLine', point: 'p', line: 'origin/y', value: 12, driving: true } as Constraint],
      ],
      [
        ['c', 5, 3],
        ['h1', 0, 10],
        ['h2', 10, 11],
        ['v1', 20, 0],
        ['v2', 21, 10],
        ['w1', 30, 0],
        ['w2', 39, 4],
        ['p', 10, 20],
      ],
      [
        { type: 'addCurve', sketch: 'S', id: 'k', curve: { type: 'circle', center: 'c' }, radius: 2.5 },
        line('S', 'h', 'h1', 'h2'),
        line('S', 'v', 'v1', 'v2'),
        line('S', 'w', 'w1', 'w2'),
      ],
    );
    const result = resultOf(engine, 'S');
    expect(result.radii.k).toBeCloseTo(3, 9);
    expect(at(engine, 'S', 'h1')[1]).toBeCloseTo(at(engine, 'S', 'h2')[1], 9);
    expect(at(engine, 'S', 'v1')[0]).toBeCloseTo(at(engine, 'S', 'v2')[0], 9);
    const [w1, w2] = [at(engine, 'S', 'w1'), at(engine, 'S', 'w2')];
    expect(Math.atan2(w2[1] - w1[1], w2[0] - w1[0])).toBeCloseTo(Math.PI / 6, 9);
    expect(Math.abs(at(engine, 'S', 'p')[0])).toBeCloseTo(12, 9);
  });

  it('refuses a constraint of two fixed operands and a midpoint of an axis; the origin is the point of an axis for the own rules', () => {
    const engine = solve([], [['p', 3, 4]]);
    expect(refused(engine, constrain('S', 'z1', { type: 'perpendicular', a: 'origin/x', b: 'origin/y' }))).toContain('only between fixed entities');
    expect(refused(engine, constrain('S', 'z2', { type: 'midpoint', point: 'p', line: 'origin/y' }))).toContain('origin/y is an axis of the origin, a whole line');
    expect(refused(engine, constrain('S', 'z3', { type: 'symmetric', a: 'p', b: 'origin', line: 'origin/x' }))).toContain('souměrný bod nesmí být koncem osy');
    expect(refused(engine, constrain('S', 'z4', { type: 'pointOnCurve', point: 'origin/y/b', curve: 'origin/x' }))).toContain('"origin/y/b" ve skice není');
    expect(refused(engine, { type: 'setCurvePoint', sketch: 'S', id: 'origin/x', point: 'a', to: 'p' })).toContain('origin/x');
    expect(refused(engine, constrain('S', 'z5', { type: 'parallel', a: 'origin/x', b: 'origin/y' }))).toContain('a constraint only between fixed entities (the origin, its axes origin/x and origin/y, projected geometry) would never take effect');
    // an axis is no curve of a wall, and the refusal says what it is
    expect(refused(engine, { type: 'addFeature', feature: { id: 'W', name: 'W', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 'S', curves: ['origin/x'], thickness: 2 }, extent: { type: 'distance', start: 0, distance: 3 }, operation: 'new' } })).toContain('"origin/x" is an axis of the origin; an own line or arc or circle of the sketch "S" is expected');
    // a reference dimension between fixed operands only is allowed: it measures
    const state = run(engine, constrain('S', 'ref', { type: 'angle', a: 'origin/x', b: 'origin/y', value: 1, driving: false } as Constraint));
    expect(state.evaluation.features.S.sketch?.measurements.ref).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('the axes of the origin: the stamp', () => {
  it('a sketch whose constraints name no axis keeps the stamp it had before the axes; one that names one changes it', () => {
    const engine = newEngine();
    run(engine, addSketch('S', XY), batch(point('S', 'p', 3, 4), point('S', 'q', 9, 6), line('S', 'l', 'p', 'q')));
    const before = sketchOf(engine, 'S');
    expect(stampOf(engine, 'S')).toBe(stampWithoutAxes(before));
    run(engine, constrain('S', 'on', { type: 'pointOnCurve', point: 'p', curve: 'origin/y' }));
    expect(at(engine, 'S', 'p')[0]).toBeCloseTo(0, 9);
    expect(stampOf(engine, 'S')).not.toBe(stampWithoutAxes(sketchOf(engine, 'S')));
    expect(stampOf(engine, 'S')).toBe(solverSetup(sketchOf(engine, 'S'), { origin: { geometry: AXES_GEOMETRY } }).stamp);
  });

  it('the first reference dimension to an axis changes the stamp once, a second does not', () => {
    const engine = newEngine();
    run(engine, addSketch('S', XY), rectangle('S', 'r', 2, 3, 10, 5, null));
    const first = stampOf(engine, 'S');
    const measured = run(engine, constrain('S', 'm1', { type: 'distancePointLine', point: 'r3', line: 'origin/y', value: 1, driving: false } as Constraint));
    const second = stampOf(engine, 'S');
    expect(second).not.toBe(first);
    expect(measured.evaluation.features.S.sketch?.measurements.m1).toBeCloseTo(12, 9);
    const again = run(engine, constrain('S', 'm2', { type: 'distancePointLine', point: 'r3', line: 'origin/x', value: 1, driving: false } as Constraint));
    expect(stampOf(engine, 'S')).toBe(second);
    expect(again.evaluation.features.S.sketch?.measurements.m2).toBeCloseTo(8, 9);
    // the positions did not move
    expect(at(engine, 'S', 'r3')).toEqual([expect.closeTo(12, 9), expect.closeTo(8, 9)]);
  });

  // (The slot saved in a conflict kept the stamp of before its last change and is solved on load,
  // as before the axes: tangent.test.ts.)
  it('the stored documents of the tests load with their stamps unchanged', () => {
    const saved = Object.values(JSON.parse(readFileSync(new URL('./fixtures/d52-saved-by-master.json', import.meta.url), 'utf8')) as Record<string, { status: string; document: unknown }>);
    const fixtures = [readFileSync(new URL('./fixtures/v1-plate.json', import.meta.url), 'utf8'), ...saved.filter((entry) => entry.status === 'ok').map((entry) => JSON.stringify(entry.document))];
    let compared = 0;
    for (const text of fixtures) {
      const stored = JSON.parse(text) as { features: { id: Id; type: string; solved?: { inputs: string } }[] };
      const engine = newEngine();
      expect(engine.load(text).ok).toBe(true);
      for (const feature of stored.features) {
        if (feature.type !== 'sketch') continue;
        expect(`${feature.id}: ${stampOf(engine, feature.id)}`).toBe(`${feature.id}: ${feature.solved?.inputs}`);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(5);
  });
});

describe('the axes of the origin: the reader of a solved sketch', () => {
  it('solvedCurves holds the curves and the positions of the state, for a sketch with an edge projection', () => {
    for (const named of [false, true]) {
      const engine = plateWithProjection();
      if (named) run(engine, constrain('S2', 'on', { type: 'pointOnCurve', point: 'q', curve: 'origin/x' }));
      const state = stateOf(engine).sketches.S2;
      const solved = solvedCurves(sketchOf(engine, 'S2'), resultOf(engine, 'S2'));
      expect(new Map([...solved.curves].sort())).toEqual(new Map([...state.curves].sort()));
      expect(solved.geometry).toEqual(state.geometry);
    }
  });

  it('without a result: the own curves and the axes over the positions of the sketch', () => {
    const engine = plateWithProjection();
    const sketch = sketchOf(engine, 'S2');
    const solved = solvedCurves(sketch, undefined);
    expect([...solved.curves.keys()]).toEqual(['l', 'origin/x', 'origin/y']);
    expect(solved.geometry.points).toEqual({ origin: { x: 0, y: 0 }, p: sketch.points.p, q: sketch.points.q, 'origin/x/b': { x: 1, y: 0 }, 'origin/y/b': { x: 0, y: 1 } });
  });

  it('lineExtent: an axis reaches 1 km to each side, any other line is the stretch between its ends', () => {
    const engine = plateWithProjection();
    const solved = solvedCurves(sketchOf(engine, 'S2'), resultOf(engine, 'S2'));
    expect(lineExtent(solved.curves.get('origin/y')!, solved.geometry)).toEqual({ a: { x: 0, y: -AXIS_REACH }, b: { x: 0, y: AXIS_REACH } });
    expect(lineExtent(solved.curves.get('l')!, solved.geometry)).toEqual({ a: resultOf(engine, 'S2').points.p, b: resultOf(engine, 'S2').points.q });
    expect(lineExtent(solved.curves.get('e')!, solved.geometry)).toEqual({ a: resultOf(engine, 'S2').points['e/a'], b: resultOf(engine, 'S2').points['e/b'] });
    expect(lineExtent({ id: 'k', shape: { type: 'circle', center: 'p' }, source: 'own', regions: true }, solved.geometry)).toBeUndefined();
    expect(lineExtent({ id: 'gone', shape: { type: 'line', a: 'p', b: 'nowhere' }, source: 'own', regions: true }, solved.geometry)).toBeUndefined();
  });
});

describe('the axes of the origin: what takes a line of a sketch', () => {
  // A square 4 × 4 at (0, 2) on XY, whose sketch names no axis.
  function square(engine: Engine): EngineState {
    return run(engine, addSketch('Q', XY), rectangle('Q', 's', 0, 2, 4, 4, null), addExtrude('cube', 'Q', [rectLoop('s')], 4));
  }

  it('a pattern along origin/y and about origin/x', () => {
    const engine = newEngine();
    square(engine);
    const linear = run(engine, { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'cube' }, transform: { type: 'linear', direction: { kind: 'sketchLine', sketch: 'Q', line: 'origin/y' }, count: 2, span: { type: 'spacing', spacing: 10 } } } });
    expect(linear.evaluation.features.P.status).toBe('ok');
    expect(linear.evaluation.bodies['P/1'].bounds.min).toEqual([expect.closeTo(0, 6), expect.closeTo(12, 6), expect.closeTo(0, 6)]);
    engine.undo();
    const turned = run(engine, { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'cube' }, transform: { type: 'circular', axis: { kind: 'sketchLine', sketch: 'Q', line: 'origin/x' }, count: 2, span: { type: 'full' } } } });
    expect(turned.evaluation.features.P.status).toBe('ok');
    // half a turn about X: y and z change sign
    expect(turned.evaluation.bodies['P/1'].bounds.min).toEqual([expect.closeTo(0, 6), expect.closeTo(-6, 6), expect.closeTo(-4, 6)]);
  });

  it('a plane tilted about origin/x of a sketch on XY', () => {
    const engine = newEngine();
    square(engine);
    const state = run(engine, { type: 'addFeature', feature: { id: 'T', name: 'T', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 0, tilt: { axis: { kind: 'sketchLine', sketch: 'Q', line: 'origin/x' }, angle: 'deg(30)' } } });
    const result = state.evaluation.features.T;
    expect(result.status).toBe('ok');
    expect(result.facts?.axisDirection).toEqual([expect.closeTo(1, 12), expect.closeTo(0, 12), expect.closeTo(0, 12)]);
    expect(result.plane?.normal).toEqual([expect.closeTo(0, 9), expect.closeTo(-0.5, 9), expect.closeTo(Math.sqrt(3) / 2, 9)]);
  });

  it('a sketch tool snaps an anchor to each axis away from the origin, on both sides', () => {
    const engine = newEngine();
    run(engine, addSketch('S', XY));
    const cases: [Id, [number, number], [number, number]][] = [
      ['origin/x', [500, 7.3], [500, 0]],
      ['origin/x', [-500, -7.3], [-500, 0]],
      ['origin/y', [7.3, 500], [0, 500]],
      ['origin/y', [-7.3, -500], [0, -500]],
    ];
    for (const [axis, click, expected] of cases) {
      const first: Anchor = { at: click, snap: { kind: 'curve', id: axis } };
      const opposite: Anchor = { at: [click[0] + 20, click[1] + 15] };
      const context = { sketch: sketchOf(engine, 'S'), result: resultOf(engine, 'S'), document: engine.getState().document };
      const made = sketchTool('rectangle', context, { first, opposite }, freshIds(engine.getState().document, `${axis.slice(-1)}${click[0] > 0 ? 'p' : 'n'}`));
      if (!made.ok) throw new Error(made.message);
      const added = made.commands.find((command) => command.type === 'addPoint' && command.id === made.ids.points[0]);
      expect(added).toMatchObject({ x: expect.closeTo(expected[0], 9), y: expect.closeTo(expected[1], 9) });
      expect(made.commands).toContainEqual(expect.objectContaining({ type: 'addConstraint', constraint: { type: 'pointOnCurve', point: made.ids.points[0], curve: axis } }));
      run(engine, batch(...made.commands));
      expect(status(engine.getState()).S).toBe('ok');
      expect(at(engine, 'S', made.ids.points[0])).toEqual([expect.closeTo(expected[0], 6), expect.closeTo(expected[1], 6)]);
    }
  });

  it('the fillet of a corner held on an axis', () => {
    const engine = newEngine();
    run(engine, addSketch('S', XY), rectangle('S', 'r', 3, 0, 10, 5, null));
    run(engine, constrain('S', 'on', { type: 'pointOnCurve', point: 'r2', curve: 'origin/x' }));
    const context = { sketch: sketchOf(engine, 'S'), result: resultOf(engine, 'S'), document: engine.getState().document };
    const made = sketchTool('fillet', context, { corner: 'r3', radius: 1 }, freshIds(engine.getState().document));
    if (!made.ok) throw new Error(made.message);
    expect(made.ids).toMatchObject({ lines: ['rb', 'rc'], patched: [], moved: [], shortened: [] });
    expect(status(run(engine, batch(...made.commands))).S).toBe('ok');
  });
});

describe('the axes of the origin: dimensions from an axis', () => {
  it('a distance to origin/x is a driving dimension of an own point', () => {
    const engine = newEngine();
    run(engine, addSketch('S', XY), batch(point('S', 'p', 3, 4)), dimension('S', 'd', { type: 'distancePointLine', point: 'p', line: 'origin/x' }, 9));
    expect(at(engine, 'S', 'p')[1]).toBeCloseTo(9, 9);
  });
});

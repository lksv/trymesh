// D35 point 5 against the real adapters: volume and bounds of a body, export of chosen bodies and
// the interference query.
import { describe, expect, it } from 'vitest';
import { type Command, type Engine, type EngineState, type Id, type SolidKernel, bodyFileName, createEngine, INTERFERENCE_THRESHOLD } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { XY, addSketch, circle, expectAllOk, extrude, newEngine, rectLoop, rectangle, run } from './kit';

const span = (id: Id, sketch: Id, curves: Id[][], start: number, distance: number, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { ...extrude(id, sketch, curves, distance, operation), extent: { type: 'distance', start, distance }, ...(targets ? { targets } : {}) },
});
const body = (state: EngineState, id: Id) => state.evaluation.bodies[id];
const triangles = (stl: Uint8Array): number => new DataView(stl.buffer, stl.byteOffset).getUint32(80, true);
const count = (state: EngineState, ...ids: Id[]): number => ids.reduce((sum, id) => sum + body(state, id).solid.triangles.length / 3, 0);
// Area of a circle as the engine builds it: a polygon inscribed with the chord tolerance 0.01.
const disc = (radius: number): number => {
  const sides = Math.ceil(Math.PI / Math.acos(1 - 0.01 / radius));
  return (sides / 2) * radius * radius * Math.sin((2 * Math.PI) / sides);
};

// A plate A 40 × 30 × 10 and a block B 20 × 20 × 10 that enters it by 10 × 10 × 5 mm at a corner.
function overlapping(engine: Engine = newEngine()): Engine {
  run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), span('A', 'S1', [rectLoop('r')], 0, 10), addSketch('S2', XY), rectangle('S2', 'q', 30, 20, 20, 20, null), span('B', 'S2', [rectLoop('q')], 5, 10));
  return engine;
}

// The real kernel with a count of intersections and a switch that makes them fail.
async function watchedEngine() {
  const real = await createManifoldKernel();
  const watch = { intersections: 0, fail: false };
  const kernel: SolidKernel = {
    triangulate: (loops) => real.triangulate(loops),
    boolean: (op, a, b) => {
      if (op === 'intersection') {
        watch.intersections++;
        if (watch.fail) throw new Error('the kernel gave up');
      }
      return real.boolean(op, a, b);
    },
  };
  return { engine: createEngine({ solver: await createPlanegcsSolver(), kernel }), watch };
}

describe('volume and bounds of a body', () => {
  it('are part of the body and follow the model', () => {
    const engine = newEngine();
    let state = run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), span('A', 'S1', [rectLoop('r')], -2, 10));
    expect(body(state, 'A').volume).toBeCloseTo(12000, 3);
    expect(body(state, 'A').bounds).toEqual({ min: [0, 0, -2], max: [40, 30, 8] });
    // a hole changes the volume, a boss the bounds as well
    state = run(engine, addSketch('S2', XY), circle('S2', 'k', 20, 15, 4), span('H', 'S2', [['k']], -2, 10, 'cut', ['A']));
    expect(body(state, 'A').volume).toBeCloseTo(12000 - disc(4) * 10, 2);
    expect(body(state, 'A').bounds).toEqual({ min: [0, 0, -2], max: [40, 30, 8] });
    state = run(engine, addSketch('S3', XY), circle('S3', 'b', 5, 5, 3), span('T', 'S3', [['b']], 8, 6, 'add', ['A']));
    expect(body(state, 'A').volume).toBeCloseTo(12000 - disc(4) * 10 + disc(3) * 6, 2);
    expect(body(state, 'A').bounds.max).toEqual([40, 30, 14]);
    // a copy made by a pattern has the same volume and its own bounds
    state = run(engine, { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'A' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } });
    expect(body(state, 'P/1').volume).toBeCloseTo(body(state, 'A').volume, 2);
    expect(body(state, 'P/1').bounds.min.map((value) => Math.round(value * 1e4) / 1e4)).toEqual([-40, -30, -2]);
    expect(body(state, 'P/1').bounds.max.map((value) => Math.round(value * 1e4) / 1e4 + 0)).toEqual([0, 0, 14]);
  });
});

describe('export of chosen bodies', () => {
  it('without a list all bodies, with a list those bodies in its order', () => {
    const engine = overlapping();
    const state = engine.getState();
    expect(triangles(engine.exportMesh('stl'))).toBe(count(state, 'A', 'B'));
    expect(engine.exportMesh('stl').length).toBe(84 + 50 * count(state, 'A', 'B'));
    expect(triangles(engine.exportMesh('stl', ['B']))).toBe(count(state, 'B'));
    expect(triangles(engine.exportMesh('stl', ['A']))).toBe(count(state, 'A'));
    // the order of the list is the order in the file; a body listed twice is written once
    const both = engine.exportMesh('stl', ['B', 'A', 'B']);
    expect(triangles(both)).toBe(count(state, 'A', 'B'));
    expect([...both.subarray(84, 84 + 50 * count(state, 'B'))]).toEqual([...engine.exportMesh('stl', ['B']).subarray(84)]);
    expect(triangles(engine.exportMesh('stl', []))).toBe(0);
    expect(() => engine.exportMesh('stl', ['A', 'X'])).toThrow(/the body "X" does not exist/);
    expect(() => engine.exportMesh('stl', ['S1'])).toThrow(/the body "S1" does not exist/);
    expect(() => engine.exportMesh('stl', 'A' as never)).toThrow(/a list of body IDs/);
    expect(() => engine.exportMesh('obj' as never)).toThrow();
  });

  it('a copy made by a pattern is exported by its derived ID; the file name of a body is unambiguous', () => {
    const engine = overlapping();
    const state = run(engine, { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'B' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } } } });
    for (const id of state.evaluation.features.P.bodies) expect(triangles(engine.exportMesh('stl', [id]))).toBe(count(state, 'B'));
    expect(state.evaluation.features.P.bodies.map(bodyFileName)).toEqual(['P%2F1', 'P%2F2']);
    expect(bodyFileName('A.b-c_d9')).toBe('A.b-c_d9');
    expect(bodyFileName('a b')).toBe('a%20b');
    expect(bodyFileName('100%')).toBe('100%25');
    expect(bodyFileName('kolo ž')).toBe('kolo%20%C5%BE');
    // an ID that looks like an escaped one does not collide with the ID it looks like
    expect(bodyFileName('planets%2F1')).not.toBe(bodyFileName('planets/1'));
    expect(bodyFileName('..')).toBe('..');
    expect(bodyFileName('a\\b:c*d')).toBe('a%5Cb%3Ac%2Ad');
  });
});

describe('interference of bodies', () => {
  it('reports pairs that share a volume, with the volume', () => {
    const engine = overlapping();
    const report = engine.interference();
    expect(report).toEqual({ pairs: [{ a: 'A', b: 'B', volume: expect.closeTo(500, 3), depth: expect.closeTo((2 * 500) / (2 * 100 + 2 * 50 + 2 * 50), 3) }], fits: [], failed: [], checked: 1 });
    // the threshold: a pair is reported only above it
    expect(engine.interference({ threshold: 499 }).pairs).toHaveLength(1);
    expect(engine.interference({ threshold: 501 }).pairs).toEqual([]);
    expect(engine.interference({ threshold: 0 }).pairs).toHaveLength(1);
    expect(INTERFERENCE_THRESHOLD).toBe(0.001);
    // the state after an earlier feature: B does not exist yet
    expect(engine.interference({ at: 'A' })).toEqual({ pairs: [], fits: [], failed: [], checked: 0 });
    expect(engine.interference({ at: 'B' }).pairs).toHaveLength(1);
    // wrong input is the caller's mistake
    expect(() => engine.interference({ bodies: ['A', 'X'] })).toThrow(/the body "X" does not exist/);
    expect(() => engine.interference({ threshold: -1 })).toThrow(/threshold/);
    expect(() => engine.interference({ threshold: Number.NaN })).toThrow(/threshold/);
    expect(() => engine.interference({ at: 'X' })).toThrow(/feature "X"/);
    expect(() => engine.interference({ bodies: 'A' as never })).toThrow(/a list of body IDs/);
    // the query changes nothing
    expect(engine.getState().canUndo).toBe(true);
    const saved = engine.save();
    engine.interference();
    expect(engine.save()).toBe(saved);
  });

  it('bodies that only touch, fit or sit in each other: flush faces are not a collision, a nested body is', () => {
    const engine = overlapping();
    // C lies on top of A, D beside it: common faces, no common volume
    run(engine, span('C', 'S1', [rectLoop('r')], 10, 5), addSketch('S3', XY), rectangle('S3', 'd', 40, 0, 10, 30, null), span('D', 'S3', [rectLoop('d')], 0, 10));
    // a hole in A and a pin of the same diameter in it; E fills the corner B does not reach, inside A's box
    run(engine, addSketch('S4', XY), circle('S4', 'k', 12, 12, 4), span('H', 'S4', [['k']], 0, 10, 'cut', ['A']), span('PIN', 'S4', [['k']], 0, 10));
    let report = engine.interference();
    expectAllOk(engine.getState());
    expect(report.failed).toEqual([]);
    expect(report.checked).toBe(10);
    // B enters A and D (x from 40 to 50, y from 20 to 30, z from 5 to 10) and C (z from 10 to 15 over 10 × 10)
    expect(report.pairs.map((pair) => [pair.a, pair.b, Math.round(pair.volume)])).toEqual([
      ['A', 'B', 500],
      ['B', 'C', 500],
      ['B', 'D', 500],
    ]);
    // only some bodies: pairs among them
    expect(engine.interference({ bodies: ['A', 'C', 'D', 'PIN'] })).toEqual({ pairs: [], fits: [], failed: [], checked: 6 });
    expect(engine.interference({ bodies: ['PIN', 'A'] })).toEqual({ pairs: [], fits: [], failed: [], checked: 1 });
    expect(engine.interference({ bodies: ['A'] })).toEqual({ pairs: [], fits: [], failed: [], checked: 0 });
    expect(engine.interference({ bodies: [] })).toEqual({ pairs: [], fits: [], failed: [], checked: 0 });
    // a pin thicker than its hole collides by the ring between the two radii
    run(engine, { type: 'setConstraintValue', sketch: 'S4', id: 'kr', value: 4 }, addSketch('S5', XY), circle('S5', 'w', 12, 12, 5), span('WIDE', 'S5', [['w']], 0, 10));
    report = engine.interference({ bodies: ['A', 'WIDE'] });
    expect(report.pairs).toEqual([{ a: 'A', b: 'WIDE', volume: expect.closeTo((disc(5) - disc(4)) * 10, 1), depth: expect.any(Number) }]);
    // a body inside another one shares its whole volume; identical bodies share everything
    run(engine, addSketch('S6', XY), rectangle('S6', 'n', 25, 2, 5, 5, null), span('IN', 'S6', [rectLoop('n')], 2, 5), span('A2', 'S1', [rectLoop('r')], 0, 10));
    report = engine.interference({ bodies: ['A', 'IN'] });
    expect(report.pairs).toEqual([{ a: 'A', b: 'IN', volume: expect.closeTo(125, 3), depth: expect.any(Number) }]);
    report = engine.interference({ bodies: ['C', 'A2', 'D'] });
    expect(report).toEqual({ pairs: [], fits: [], failed: [], checked: 3 }); // A2 lies under C and beside D
    // A2 is the plate A without its hole: the two share all of A; two identical bodies share everything
    report = engine.interference({ bodies: ['A', 'A2'] });
    expect(report.failed).toEqual([]);
    expect(report.pairs).toEqual([{ a: 'A', b: 'A2', volume: expect.closeTo(body(engine.getState(), 'A').volume, 2), depth: expect.any(Number) }]);
    run(engine, span('A3', 'S1', [rectLoop('r')], 0, 10));
    report = engine.interference({ bodies: ['A2', 'A3'] });
    expect(report).toEqual({ pairs: [{ a: 'A2', b: 'A3', volume: expect.closeTo(12000, 2), depth: expect.closeTo((2 * 12000) / (2 * 1200 + 140 * 10), 3) }], fits: [], failed: [], checked: 1 });
  });

  it('a pin in a hole of the same diameter is a fit, not a collision, however the two polygons are turned', () => {
    // A plate with two holes of radius 4 and a pin in the first one. The copy of the pin lands in
    // the second hole turned by half a turn: a circle of radius 4 is a polygon with an odd number
    // of sides, so the corners of the copy stick out of the wall of the hole.
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', -20, -10, 40, 20, null), circle('S1', 'h1', 10, 0, 4), circle('S1', 'h2', -10, 0, 4));
    run(engine, span('PLATE', 'S1', [rectLoop('r'), ['h1'], ['h2']], 0, 10), span('holes', 'S1', [['h1'], ['h2']], 0, 10, 'cut', ['PLATE']), span('PIN', 'S1', [['h1']], 0, 10));
    const pattern = (count: number): Command => ({ type: 'addFeature', feature: { id: 'PP', name: 'PP', suppressed: false, type: 'pattern', source: { type: 'body', body: 'PIN' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count, span: { type: 'full' } } } });
    expectAllOk(run(engine, pattern(2)));
    let report = engine.interference();
    expect(report.failed).toEqual([]);
    expect(report.pairs).toEqual([]);
    // the slivers: up to a quarter of the chord tolerance times the wall of the hole, far above the volume threshold
    expect(report.fits).toEqual([{ a: 'PLATE', b: 'PP/1', volume: expect.any(Number), depth: expect.any(Number) }]);
    const [fit] = report.fits;
    expect(fit.volume).toBeGreaterThan(100 * INTERFERENCE_THRESHOLD);
    expect(fit.volume).toBeLessThan((2 * Math.PI * 4 * 10 * 0.01) / 4);
    expect(fit.depth).toBeLessThan(0.01);
    // the pin in the hole it was drawn with shares nothing at all
    expect(engine.interference({ bodies: ['PLATE', 'PIN'] })).toEqual({ pairs: [], fits: [], failed: [], checked: 1 });
    // a pin thicker by more than the chord tolerance is a collision whatever its turn
    run(engine, { type: 'setConstraintValue', sketch: 'S1', id: 'h1r', value: 4.05 });
    report = engine.interference();
    expect(report.pairs.map((pair) => [pair.a, pair.b])).toEqual([['PLATE', 'PP/1']]);
    expect(report.pairs[0].depth).toBeGreaterThan(0.02);
    expect(report.fits).toEqual([]);
    // a finer chord tolerance of the document narrows what counts as a fit
    run(engine, { type: 'setConstraintValue', sketch: 'S1', id: 'h1r', value: 4 });
    expect(engine.interference().fits).toHaveLength(1);
  });

  it('`a` is the smaller ID whatever the order of the bodies; copies are named by their derived IDs', () => {
    const engine = newEngine();
    // `z` is created before `a`; the copies of `a` turn by 10° and overlap their neighbours
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 10, -5, 20, 10, null), span('z', 'S1', [rectLoop('r')], 0, 5), span('a', 'S1', [rectLoop('r')], 2, 5));
    expect(engine.interference().pairs).toEqual([{ a: 'a', b: 'z', volume: expect.closeTo(600, 3), depth: expect.any(Number) }]);
    const state = run(engine, { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'a' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'angle', angle: Math.PI / 9 } } } });
    expect(state.evaluation.features.P.bodies).toEqual(['P/1', 'P/2']);
    const report = engine.interference();
    expect(report.failed).toEqual([]);
    expect(report.checked).toBe(6);
    expect(report.pairs.map((pair) => `${pair.a} ${pair.b}`)).toEqual(['a z', 'P/1 z', 'P/2 z', 'P/1 a', 'P/2 a', 'P/1 P/2']);
    // the copy next to the original shares more with it than the one after it
    const shared = Object.fromEntries(report.pairs.map((pair) => [`${pair.a} ${pair.b}`, pair.volume]));
    expect(shared['P/1 a']).toBeGreaterThan(shared['P/2 a']);
    expect(shared['P/1 a']).toBeCloseTo(shared['P/1 P/2'], 1);
  });

  it('a pair the kernel cannot compute is reported as failed; computed pairs are remembered', async () => {
    const { engine, watch } = await watchedEngine();
    overlapping(engine);
    run(engine, span('C', 'S1', [rectLoop('r')], 8, 5));
    // A and B, A and C, B and C: three intersections; A and C overlap by 2 mm
    let report = engine.interference();
    expect(report.pairs.map((pair) => [pair.a, pair.b])).toEqual([['A', 'B'], ['A', 'C'], ['B', 'C']]);
    expect(watch.intersections).toBe(3);
    // the same question again costs nothing
    engine.interference();
    engine.interference({ bodies: ['A', 'C'] });
    expect(watch.intersections).toBe(3);
    // After a change of C, the last body, only its pairs are computed again: the meshes of A and B
    // are the same objects. (A change of B would rebuild C as well, because C is replayed after it.)
    run(engine, { type: 'updateFeature', id: 'C', patch: { extent: { start: 9 } } });
    report = engine.interference();
    expect(watch.intersections).toBe(5);
    expect(report.pairs.find((pair) => pair.a === 'A' && pair.b === 'C')?.volume).toBeCloseTo(1200, 2);
    // bodies whose boxes do not overlap never reach the kernel
    run(engine, addSketch('S3', XY), rectangle('S3', 'f', 100, 100, 5, 5, null), span('FAR', 'S3', [rectLoop('f')], 0, 5));
    engine.interference();
    expect(watch.intersections).toBe(5);

    // the kernel fails: the pairs it was asked about are neither colliding nor clear
    watch.fail = true;
    run(engine, { type: 'updateFeature', id: 'C', patch: { extent: { start: 7 } } });
    report = engine.interference();
    expect(report.failed).toEqual([
      { a: 'A', b: 'C', message: 'the kernel gave up' },
      { a: 'B', b: 'C', message: 'the kernel gave up' },
    ]);
    expect(report.pairs.map((pair) => [pair.a, pair.b])).toEqual([['A', 'B']]);
    expect(report.checked).toBe(6);
    // undo brings back the meshes whose pairs are remembered
    engine.undo();
    watch.fail = false;
    expect(engine.interference().failed).toEqual([]);
  });
});

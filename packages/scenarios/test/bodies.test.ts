// D35 point 5 against the real adapters: volume and bounds of a body, export of chosen bodies and
// the interference query.
import { afterAll, describe, expect, it } from 'vitest';
import { type Command, type Engine, type EngineState, type Id, type InterferenceOptions, type InterferenceReport, type SolidKernel, bodyFileName, createEngine, INTERFERENCE_THRESHOLD } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { XY, addSketch, circle, expectAllOk, extrude, newEngine as plainEngine, rectLoop, rectangle, run } from './kit';

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

// Every collision this file asks of an engine made by `newEngine` is asked a second time (D50,
// docs/d36/5e-kernel-second/design.md, "Tests", 3): of the same document loaded into an engine
// whose kernel refuses every intersection and answers its intersection as computed, so that the
// second opinion decides every pair that reaches the kernel. The models of this file are the ones
// `interference.ts` was written on (flush faces, a pin in its hole turned by a pattern, identical
// bodies, shallow overlaps of planar and of round faces). What holds for each:
// - nothing is a collision or a fit by the second opinion;
// - a pair the kernel verified as a collision is failed, never cleared;
// - on these models a cleared pair has the kind the kernel verified (a fit where it verified a fit,
//   `nothing` where it verified nothing). That is a property of these models, not of the rule.
// A pair the kernel verified clear may stay failed (the mesh as computed errs towards a collision
// on flush faces); those are counted.
const real = await createManifoldKernel();
const refusingSolver = await createPlanegcsSolver();
const refusing: SolidKernel = {
  triangulate: (loops) => real.triangulate(loops),
  boolean: (op, a, b) => {
    if (op === 'intersection') throw new Error('the kernel gave up');
    return real.boolean(op, a, b);
  },
  intersectionAsComputed: (a, b) => real.intersectionAsComputed(a, b),
};
const SECOND = { asked: 0, collisions: 0, fits: 0, clearedFits: 0, clearedNothing: 0, notCleared: 0 };
const key = (pair: { a: Id; b: Id }) => `${pair.a} ${pair.b}`;
function compared(verified: InterferenceReport, second: InterferenceReport): void {
  SECOND.asked++;
  expect([second.pairs, second.fits]).toEqual([[], []]);
  const cleared = new Map((second.cleared ?? []).map((pair) => [key(pair), pair.kind]));
  const failed = new Set(second.failed.map(key));
  for (const pair of verified.pairs) {
    expect(cleared.has(key(pair)), `${key(pair)} collides and was cleared`).toBe(false);
    expect(failed.has(key(pair)), `${key(pair)} collides and is not failed`).toBe(true);
  }
  const fits = new Set(verified.fits.map(key));
  for (const [pair, kind] of cleared) expect(kind, `${pair} cleared as another kind`).toBe(fits.has(pair) ? 'fit' : 'nothing');
  const notClear = new Set([...verified.pairs, ...verified.failed].map(key));
  SECOND.collisions += verified.pairs.length;
  SECOND.fits += verified.fits.length;
  SECOND.clearedFits += [...cleared.values()].filter((kind) => kind === 'fit').length;
  SECOND.clearedNothing += [...cleared.values()].filter((kind) => kind === 'nothing').length;
  SECOND.notCleared += second.failed.filter((pair) => !notClear.has(key(pair))).length;
}
const newEngine = (): Engine => {
  const engine = plainEngine();
  return new Proxy(engine, {
    get(target, property, receiver) {
      if (property !== 'interference') return Reflect.get(target, property, receiver);
      return (options?: InterferenceOptions): InterferenceReport => {
        const verified = target.interference(options);
        const twin = createEngine({ solver: refusingSolver, kernel: refusing });
        expect(twin.load(target.save()).ok).toBe(true);
        compared(verified, twin.interference(options));
        return verified;
      };
    },
  });
};
afterAll(() => {
  // the second opinion was asked about every model, saw collisions and fits, and cleared fits
  expect(SECOND.asked).toBeGreaterThan(20);
  expect(SECOND.collisions).toBeGreaterThan(20);
  expect(SECOND.clearedFits).toBe(SECOND.fits);
  console.log(`bodies: the second opinion over ${SECOND.asked} reports: ${SECOND.collisions} verified collisions all failed, ${SECOND.clearedFits} of ${SECOND.fits} fits cleared as fits, ${SECOND.clearedNothing} pairs cleared as nothing, ${SECOND.notCleared} verified clear pairs left failed`);
});

// A plate A 40 × 30 × 10 and a block B 20 × 20 × 10 that enters it by 10 × 10 × 5 mm at a corner.
function overlapping(engine: Engine = newEngine()): Engine {
  run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), span('A', 'S1', [rectLoop('r')], 0, 10), addSketch('S2', XY), rectangle('S2', 'q', 30, 20, 20, 20, null), span('B', 'S2', [rectLoop('q')], 5, 10));
  return engine;
}

// The real kernel with a count of intersections, a switch that makes them fail (both the
// intersection and the intersection as computed, D50), one that makes only the intersection
// fail (the second opinion then decides) and one that makes it return a mesh with a coordinate
// that is not a number.
async function watchedEngine() {
  const real = await createManifoldKernel();
  const watch = { intersections: 0, asComputed: 0, fail: false, refuse: false, broken: false };
  const kernel: SolidKernel = {
    triangulate: (loops) => real.triangulate(loops),
    boolean: (op, a, b) => {
      if (op === 'intersection') {
        watch.intersections++;
        if (watch.fail || watch.refuse) throw new Error('the kernel gave up');
        if (watch.broken) return { positions: Float32Array.from([NaN, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), triangles: Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]), faceIds: Uint32Array.from([0, 0, 0, 0]) };
      }
      return real.boolean(op, a, b);
    },
    intersectionAsComputed: (a, b) => {
      watch.asComputed++;
      if (watch.fail) throw new Error('the kernel gave up again');
      return real.intersectionAsComputed(a, b);
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
    expect(report).toEqual({ pairs: [{ a: 'A', b: 'B', volume: expect.closeTo(500, 3), depth: expect.closeTo(5, 4) }], fits: [], failed: [], checked: 1 }); // B goes 5 mm down into A
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
    expect(report.pairs).toEqual([{ a: 'A', b: 'WIDE', volume: expect.closeTo((disc(5) - disc(4)) * 10, 1), depth: expect.closeTo(1, 1) }]); // a millimetre into the wall
    // a body inside another one shares its whole volume; identical bodies share everything
    run(engine, addSketch('S6', XY), rectangle('S6', 'n', 25, 2, 5, 5, null), span('IN', 'S6', [rectLoop('n')], 2, 5), span('A2', 'S1', [rectLoop('r')], 0, 10));
    report = engine.interference({ bodies: ['A', 'IN'] });
    expect(report.pairs).toEqual([{ a: 'A', b: 'IN', volume: expect.closeTo(125, 3), depth: expect.any(Number) }]);
    expect(report.pairs[0].depth).toBeGreaterThan(3); // IN lies from 2 to 7 mm under the faces of A
    expect(report.pairs[0].depth).toBeLessThanOrEqual(5);
    report = engine.interference({ bodies: ['C', 'A2', 'D'] });
    expect(report).toEqual({ pairs: [], fits: [], failed: [], checked: 3 }); // A2 lies under C and beside D
    // A2 is the plate A without its hole: the two share all of A; two identical bodies share everything
    report = engine.interference({ bodies: ['A', 'A2'] });
    expect(report.failed).toEqual([]);
    expect(report.pairs).toEqual([{ a: 'A', b: 'A2', volume: expect.closeTo(body(engine.getState(), 'A').volume, 2), depth: expect.any(Number) }]);
    run(engine, span('A3', 'S1', [rectLoop('r')], 0, 10));
    report = engine.interference({ bodies: ['A2', 'A3'] });
    // neither reaches into the other (their surfaces coincide), so the depth is the mean thickness of what they share
    expect(report).toEqual({ pairs: [{ a: 'A2', b: 'A3', volume: expect.closeTo(12000, 2), depth: expect.closeTo((2 * 12000) / (2 * 1200 + 140 * 10), 3) }], fits: [], failed: [], checked: 1 });
    // the same with round bodies: two identical pins are a collision, not a fit
    run(engine, span('PIN2', 'S4', [['k']], 0, 10));
    report = engine.interference({ bodies: ['PIN', 'PIN2'] });
    expect(report).toEqual({ pairs: [{ a: 'PIN', b: 'PIN2', volume: expect.closeTo(disc(4) * 10, 1), depth: expect.closeTo((2 * disc(4) * 10) / (2 * disc(4) + 2 * Math.PI * 4 * 10), 2) }], fits: [], failed: [], checked: 1 });
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
    // no corner of the pin is deeper in the wall than the sagitta of the polygon
    expect(fit.depth).toBeGreaterThan(0.001);
    expect(fit.depth).toBeLessThanOrEqual(0.01);
    // the pin in the hole it was drawn with shares nothing at all
    expect(engine.interference({ bodies: ['PLATE', 'PIN'] })).toEqual({ pairs: [], fits: [], failed: [], checked: 1 });
    // a pin thicker by more than the chord tolerance is a collision whatever its turn
    run(engine, { type: 'setConstraintValue', sketch: 'S1', id: 'h1r', value: 4.05 });
    report = engine.interference();
    expect(report.pairs.map((pair) => [pair.a, pair.b])).toEqual([['PLATE', 'PP/1']]);
    expect(report.pairs[0].depth).toBeGreaterThan(0.05);
    expect(report.pairs[0].depth).toBeLessThan(0.07); // the 0.05 of the radius and up to the sagitta
    expect(report.fits).toEqual([]);
  });

  it('a real overlap is a collision whatever else the pair shares: next to coincident faces, on a turned copy', () => {
    // The plate and the pins of the test above, with a key of 1 mm on the pin and no keyway in the
    // plate. The pin sits in the hole cut by its own circle (the two walls coincide), its copy is
    // turned in the other hole (slivers of a fit all around). The key must show in both.
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', -20, -10, 40, 20, null), circle('S1', 'h1', 10, 0, 4), circle('S1', 'h2', -10, 0, 4));
    run(engine, span('PLATE', 'S1', [rectLoop('r'), ['h1'], ['h2']], 0, 10), span('holes', 'S1', [['h1'], ['h2']], 0, 10, 'cut', ['PLATE']), span('PIN', 'S1', [['h1']], 0, 10));
    run(engine, addSketch('S2', XY), rectangle('S2', 'k', 13.5, -0.5, 1.5, 1, null), span('KEY', 'S2', [rectLoop('k')], 0, 1, 'add', ['PIN']));
    expectAllOk(run(engine, { type: 'addFeature', feature: { id: 'PP', name: 'PP', suppressed: false, type: 'pattern', source: { type: 'body', body: 'PIN' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } }));
    const report = engine.interference();
    expect(report.failed).toEqual([]);
    expect(report.fits).toEqual([]);
    expect(report.pairs.map((pair) => [pair.a, pair.b])).toEqual([['PIN', 'PLATE'], ['PLATE', 'PP/1']]);
    // the key is 1 mm outside the wall of the hole; its volume there is small next to the slivers of the copy
    expect(report.pairs[0].volume).toBeCloseTo(1, 1);
    expect(report.pairs[0].depth).toBeCloseTo(1, 2);
    expect(report.pairs[1].depth).toBeCloseTo(1, 2);

    // planar bodies only: two blocks flush on a face 30 × 10, a rib of 1 mm of one inside the other
    const blocks = newEngine();
    run(blocks, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 30, 10, null), span('X', 'S1', [rectLoop('r')], 0, 10), span('Y', 'S1', [rectLoop('r')], 10, 10));
    expect(blocks.interference()).toEqual({ pairs: [], fits: [], failed: [], checked: 1 });
    run(blocks, addSketch('S2', XY), rectangle('S2', 'q', 5, 5, 1, 1, null), span('RIB', 'S2', [rectLoop('q')], 10, 1, 'add', ['X']));
    expect(blocks.interference()).toEqual({ pairs: [{ a: 'X', b: 'Y', volume: expect.closeTo(1, 4), depth: expect.closeTo(1, 4) }], fits: [], failed: [], checked: 1 });
    // an overlap along an edge, 0.02 × 0.02 × 10: its corners lie on the common top and bottom faces
    run(blocks, addSketch('S3', XY), rectangle('S3', 'e', 29.98, 9.98, 20, 20, null), span('E', 'S3', [rectLoop('e')], 0, 10));
    expect(blocks.interference({ bodies: ['X', 'E'] })).toEqual({ pairs: [{ a: 'E', b: 'X', volume: expect.closeTo(0.004, 4), depth: expect.closeTo(0.02, 4) }], fits: [], failed: [], checked: 1 });
  });

  it('a fit needs a round face and the chord tolerance of the document: thin overlaps of planar bodies are collisions', () => {
    // a pin thicker than its hole by 0.005 and then by 0.05 on the radius, drawn around the same centre
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', -20, -10, 40, 20, null), circle('S1', 'h1', 10, 0, 4), circle('S1', 'p1', 10, 0, 4.005));
    run(engine, span('PLATE', 'S1', [rectLoop('r'), ['p1'], ['h1']], 0, 10), span('holes', 'S1', [['h1']], 0, 10, 'cut', ['PLATE']), span('PIN', 'S1', [['p1'], ['h1']], 0, 10));
    // half the tolerance into the wall all around: far above the volume threshold, and a fit
    let report = engine.interference();
    expect(report).toEqual({ pairs: [], fits: [{ a: 'PIN', b: 'PLATE', volume: expect.any(Number), depth: expect.closeTo(0.005, 4) }], failed: [], checked: 1 });
    expect(report.fits[0].volume).toBeGreaterThan(1);
    run(engine, { type: 'setConstraintValue', sketch: 'S1', id: 'p1r', value: 4.05 });
    report = engine.interference();
    expect(report).toEqual({ pairs: [{ a: 'PIN', b: 'PLATE', volume: expect.any(Number), depth: expect.closeTo(0.05, 4) }], fits: [], failed: [], checked: 1 });
    // the same document with a chord tolerance of 0.1: the circles are coarser and 0.05 is within it
    const stored = JSON.parse(engine.save());
    stored.settings.chordTolerance = 0.1;
    const coarse = newEngine();
    expect(coarse.load(JSON.stringify(stored)).ok).toBe(true);
    report = coarse.interference();
    expect(report).toEqual({ pairs: [], fits: [{ a: 'PIN', b: 'PLATE', volume: expect.any(Number), depth: expect.closeTo(0.05, 4) }], failed: [], checked: 1 });

    // two plates that overlap by 0.05 over 20 × 20: no round face, so nothing a polygon could explain
    const plates = newEngine();
    run(plates, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 20, 20, null), span('LOW', 'S1', [rectLoop('r')], 0, 5), span('HIGH', 'S1', [rectLoop('r')], 4.95, 5));
    const flat = JSON.parse(plates.save());
    flat.settings.chordTolerance = 0.1;
    expect(plates.load(JSON.stringify(flat)).ok).toBe(true);
    expect(plates.interference()).toEqual({ pairs: [{ a: 'HIGH', b: 'LOW', volume: expect.closeTo(20, 2), depth: expect.closeTo(0.05, 4) }], fits: [], failed: [], checked: 1 });
  });

  it('findings of the third review: slivers thinner than the precision, planar faces beside a round one, a lump behind slivers, noise of flush faces', () => {
    const turned = (id: Id, body: Id, count: number, angle?: number): Command => ({
      type: 'addFeature',
      feature: { id, name: id, suppressed: false, type: 'pattern', source: { type: 'body', body }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count, span: angle === undefined ? { type: 'full' } : { type: 'angle', angle } } },
    });
    // 1. Pins of radius 25 in three holes on a ring, the copies turned by 1.234 rad each. The
    //    polygons nearly coincide here, so the slivers are thinner than a ten-thousandth of
    //    a millimetre. Taking them for sheets without thickness left the volume with next to no
    //    surface and a mean thickness of 0.04: a collision out of a fit.
    let engine = newEngine();
    const holes = [0, 1, 2].map((k): [Id, number, number] => [`h${k}`, 75 * Math.cos(1.234 * k), 75 * Math.sin(1.234 * k)]);
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', -150, -150, 300, 300, null), ...holes.map(([id, x, y]) => circle('S1', id, x, y, 25)));
    run(engine, span('PLATE', 'S1', [rectLoop('r'), ...holes.map(([id]) => [id])], 0, 10), span('holes', 'S1', holes.map(([id]) => [id]), 0, 10, 'cut', ['PLATE']), span('PIN', 'S1', [['h0']], 0, 10));
    expectAllOk(run(engine, turned('PP', 'PIN', 3, 2 * 1.234)));
    let report = engine.interference();
    expect(report.failed).toEqual([]);
    expect(report.pairs).toEqual([]);
    // the first copy is within the precision of the coordinates and not reported at all
    expect(report.fits).toEqual([{ a: 'PLATE', b: 'PP/2', volume: expect.any(Number), depth: expect.any(Number) }]);
    expect(report.fits[0].depth).toBeLessThanOrEqual(0.01);

    // 2. A shallow overlap of planar faces is a collision also when a round face is nearby:
    //    a disc 0.005 inside the top of a plate, a pin 0.005 too long for its blind hole, two
    //    plates overlapping by 0.005 with one hole through both.
    const plate = (): Engine => {
      const made = newEngine();
      run(made, addSketch('S1', XY), rectangle('S1', 'r', -20, -20, 40, 40, null), span('PLATE', 'S1', [rectLoop('r')], 0, 10));
      return made;
    };
    engine = plate();
    run(engine, addSketch('S2', XY), circle('S2', 'k', 0, 0, 5), span('DISC', 'S2', [['k']], 9.995, 5));
    expect(engine.interference()).toEqual({ pairs: [{ a: 'DISC', b: 'PLATE', volume: expect.closeTo(disc(5) * 0.005, 3), depth: expect.closeTo(0.005, 4) }], fits: [], failed: [], checked: 1 });
    engine = plate();
    run(engine, addSketch('S2', XY), circle('S2', 'k', 0, 0, 4), span('H', 'S2', [['k']], 5, 5, 'cut', ['PLATE']), span('PIN', 'S2', [['k']], 4.995, 8));
    expect(engine.interference()).toEqual({ pairs: [{ a: 'PIN', b: 'PLATE', volume: expect.closeTo(disc(4) * 0.005, 3), depth: expect.closeTo(0.005, 4) }], fits: [], failed: [], checked: 1 });
    engine = plate();
    run(engine, span('TOP', 'S1', [rectLoop('r')], 9.995, 5), addSketch('S2', XY), circle('S2', 'k', 0, 0, 4), span('H', 'S2', [['k']], 0, 15, 'cut', ['PLATE', 'TOP']));
    expect(engine.interference()).toEqual({ pairs: [{ a: 'PLATE', b: 'TOP', volume: expect.closeTo((1600 - disc(4)) * 0.005, 2), depth: expect.closeTo(0.005, 4) }], fits: [], failed: [], checked: 1 });
    // a round face reaching into a planar one by as little stays a fit: a cylinder 0.005 into the side of a plate
    engine = plate();
    run(engine, addSketch('S2', XY), circle('S2', 'k', 24.995, 0, 5), span('CYL', 'S2', [['k']], 0, 10));
    report = engine.interference();
    expect(report).toEqual({ pairs: [], fits: [{ a: 'CYL', b: 'PLATE', volume: expect.any(Number), depth: expect.closeTo(0.005, 4) }], failed: [], checked: 1 });

    // 3. A cube of 1 mm³ that both bodies have at the same place, next to the slivers of a long
    //    fit: its surfaces coincide, so nothing reaches into anything, and the mean thickness of
    //    the whole shared volume is that of the slivers. Taken piece by piece the cube shows.
    engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', -20, -10, 40, 20, null), circle('S1', 'h1', 10, 0, 4), circle('S1', 'h2', -10, 0, 4));
    run(engine, span('PLATE', 'S1', [rectLoop('r'), ['h1'], ['h2']], 0, 100), span('holes', 'S1', [['h1'], ['h2']], 0, 100, 'cut', ['PLATE']));
    run(engine, addSketch('S3', XY), rectangle('S3', 'q', -0.5, 30, 1, 1, null), span('CUBE', 'S3', [rectLoop('q')], 0, 1, 'add', ['PLATE']));
    run(engine, addSketch('S2', XY), rectangle('S2', 'w', -0.5, -31, 1, 1, null), circle('S2', 'p', 10, 0, 4));
    expectAllOk(run(engine, span('PIN', 'S2', [['p']], 0, 100), span('PCUBE', 'S2', [rectLoop('w')], 0, 1, 'add', ['PIN']), turned('PP', 'PIN', 2)));
    report = engine.interference({ bodies: ['PLATE', 'PP/1'] });
    expect(report.fits).toEqual([]);
    expect(report.pairs).toEqual([{ a: 'PLATE', b: 'PP/1', volume: expect.any(Number), depth: expect.closeTo(1 / 3, 2) }]); // a cube of 1 mm: twice its volume over its surface
    expect(report.pairs[0].volume).toBeGreaterThan(1);

    // 4. Wedges of a big ring turned by a pattern lie flush on each other. What the kernel finds
    //    between them is noise of single precision (half a mm³ at a depth of 0.00001 mm), far
    //    below what the coordinates can tell: not a pair at all.
    engine = newEngine();
    const corners: [number, number][] = [[300, 0], [3000, 0], [3000 * Math.cos(Math.PI / 6), 3000 * Math.sin(Math.PI / 6)], [300 * Math.cos(Math.PI / 6), 300 * Math.sin(Math.PI / 6)]];
    run(
      engine,
      addSketch('S1', XY),
      ...corners.map(([x, y], i): Command => ({ type: 'addPoint', sketch: 'S1', id: `w${i}`, x, y })),
      ...corners.map((_, i): Command => ({ type: 'addCurve', sketch: 'S1', id: `e${i}`, curve: { type: 'line', a: `w${i}`, b: `w${(i + 1) % 4}` } })),
    );
    expectAllOk(run(engine, span('W', 'S1', [['e0', 'e1', 'e2', 'e3']], 0, 600), turned('P', 'W', 12)));
    expect(engine.interference()).toEqual({ pairs: [], fits: [], failed: [], checked: 66 });
    expect(engine.interference({ threshold: 0 })).toEqual({ pairs: [], fits: [], failed: [], checked: 66 });
  });

  it('findings of the fourth review: a turned fit that ends on a planar face of the other body', () => {
    // A plate with two holes of radius 4 and a pin drawn by the circle of the first one; its copy
    // turned by half a turn sits in the second hole with its corners elsewhere. `more` shapes
    // the holes and the pin. The answer is that of the turned copy; the pin in its own hole
    // coincides with it and has to be clear, or to collide where `collides` says so.
    const seated = (collides: boolean, holeFrom: number, pinFrom: number, pinLength: number, ...more: Command[]): InterferenceReport => {
      const engine = newEngine();
      run(engine, addSketch('S1', XY), rectangle('S1', 'r', -20, -10, 40, 20, null), circle('S1', 'h1', 10, 0, 4), circle('S1', 'h2', -10, 0, 4));
      run(engine, span('PLATE', 'S1', [rectLoop('r'), ['h1'], ['h2']], 0, 10), span('holes', 'S1', [['h1'], ['h2']], holeFrom, 10 - holeFrom, 'cut', ['PLATE']));
      run(engine, span('PIN', 'S1', [['h1']], pinFrom, pinLength), addSketch('S2', XY), circle('S2', 'c', 10, 0, 6), circle('S2', 'c2', -10, 0, 6));
      expectAllOk(run(engine, ...more, { type: 'addFeature', feature: { id: 'PP', name: 'PP', suppressed: false, type: 'pattern', source: { type: 'body', body: 'PIN' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } }));
      const own = engine.interference({ bodies: ['PLATE', 'PIN'] });
      expect(own).toEqual({ pairs: collides ? [{ a: 'PIN', b: 'PLATE', volume: expect.any(Number), depth: expect.closeTo(0.005, 4) }] : [], fits: [], failed: [], checked: 1 });
      return engine.interference({ bodies: ['PLATE', 'PP/1'] });
    };
    const fit = { pairs: [], fits: [{ a: 'PLATE', b: 'PP/1', volume: expect.any(Number), depth: expect.closeTo(0.0097, 3) }], failed: [], checked: 1 };
    // The end of a sliver is a point of the cap of the pin inside the plate, as near to the floor
    // of the hole as to its wall. Taken for a planar face in a planar face it made a collision of:
    // a pin seated on the floor of a blind hole, standing out of it, flush and below the top
    expect(seated(false, 5, 5, 8)).toEqual(fit);
    expect(seated(false, 5, 5, 5)).toEqual(fit);
    expect(seated(false, 5, 5, 4)).toEqual(fit);
    // a pin with a collar that lies on the plate
    expect(seated(false, 0, 0, 10, span('COLLAR', 'S2', [['c']], 10, 2, 'add', ['PIN']))).toEqual(fit);
    // a pin with a head in a counterbore
    expect(seated(false, 0, 0, 6, span('bores', 'S2', [['c'], ['c2']], 6, 4, 'cut', ['PLATE']), span('HEAD', 'S2', [['c']], 6, 4, 'add', ['PIN']))).toEqual(fit);
    // a pin standing 0.003 out of its through hole, and as much below the top: the cap is nearer
    // to the top of the plate than the wall of the hole is
    expect(seated(false, 0, 0, 10.003)).toEqual(fit);
    expect(seated(false, 0, 0, 9.997)).toEqual(fit);
    // What a polygon does not explain stays a collision: the pin 0.005 too long for the blind
    // hole, the collar 0.005 inside the top of the plate.
    let report = seated(true, 5, 4.995, 8);
    expect(report).toEqual({ pairs: [{ a: 'PLATE', b: 'PP/1', volume: expect.any(Number), depth: expect.closeTo(0.011, 3) }], fits: [], failed: [], checked: 1 });
    report = seated(true, 0, 0, 10, span('COLLAR', 'S2', [['c']], 9.995, 2, 'add', ['PIN']));
    expect(report).toEqual({ pairs: [{ a: 'PLATE', b: 'PP/1', volume: expect.any(Number), depth: expect.closeTo(0.011, 3) }], fits: [], failed: [], checked: 1 });
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
    // a mesh the kernel returns with a coordinate that is not a number is a failure too, not a clear pair
    watch.broken = true;
    run(engine, { type: 'updateFeature', id: 'C', patch: { extent: { start: 6 } } });
    expect(engine.interference().failed).toEqual([
      { a: 'A', b: 'C', message: 'the intersection has a volume that is not a number' },
      { a: 'B', b: 'C', message: 'the intersection has a volume that is not a number' },
    ]);
    engine.undo();
    watch.broken = false;
    expect(watch.asComputed).toBe(2); // asked only where `boolean` threw: the two pairs of `fail`
    // only the intersection refused (D50): the intersection as computed decides, and it may only
    // clear. C inside A shares 6000 mm³ with it and 500 with B: both stay failed with the measure
    watch.refuse = true;
    run(engine, { type: 'updateFeature', id: 'C', patch: { extent: { start: 5 } } });
    report = engine.interference();
    expect(report.failed.map((pair) => [pair.a, pair.b])).toEqual([['A', 'C'], ['B', 'C']]);
    expect(report.failed[0].message).toMatch(/^the kernel gave up; as computed the two share 6000 mm³, [\d.]+ mm deep, which the kernel could not verify$/);
    expect(report.failed[1].message).toBe('the kernel gave up; as computed the two share 500 mm³, 5 mm deep, which the kernel could not verify');
    expect([report.pairs.map((pair) => [pair.a, pair.b]), report.fits, report.cleared]).toEqual([[['A', 'B']], [], undefined]);
    expect(watch.asComputed).toBe(4);
    engine.undo();
    watch.refuse = false;
  });
});

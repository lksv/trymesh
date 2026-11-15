// The query `gap` (D40) against the real adapters: the distance of a pair and where it is, what
// a distance of zero is, a body inside the material of another, the search distance, the limit
// of the answer, a pair the kernel fails on, and the errors.
import { type Command, type Engine, type Gap, type GapReport, type Id, type QueryArgs, type QueryOptions, type SolidKernel, createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { XY, addSketch, circle, expectAllOk, extrude, newEngine, rectLoop, rectangle, run, side } from './kit';

const span = (id: Id, sketch: Id, curves: Id[][], start: number, distance: number, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { ...extrude(id, sketch, curves, distance, operation), extent: { type: 'distance', start, distance }, ...(targets ? { targets } : {}) },
});
// A block from a rectangle of its own sketch `s<id>`: x, y, width, height, and from `z` up by `tall`.
// The rectangle is named by the ID in lower case: the block `A` has the lines `aa` to `ad`.
const block = (id: Id, x: number, y: number, width: number, height: number, z = 0, tall = 10): Command[] => {
  const name = id.toLowerCase();
  return [addSketch(`s${id}`, XY), rectangle(`s${id}`, name, x, y, width, height, null), span(id, `s${id}`, [rectLoop(name)], z, tall)];
};

function gap(engine: Engine, args: QueryArgs<'gap'> = {}, options: QueryOptions = {}): GapReport {
  const answer = engine.query('gap', args, options);
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  return answer.result;
}
const only = (report: GapReport): Gap => {
  expect(report.pairs).toHaveLength(1);
  return report.pairs[0];
};

// Five blocks of 10 × 10 × 10 along X: A, B 2 mm from it, C flush with B, D that enters C by
// 2 × 5 × 10, and E far away.
function blocks(engine: Engine = newEngine()): Engine {
  run(engine, ...block('A', 0, 0, 10, 10), ...block('B', 12, 0, 10, 10), ...block('C', 22, 0, 10, 10), ...block('D', 30, 5, 10, 10), ...block('E', 100, 0, 10, 10));
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

describe('the query gap', () => {
  it('one pair: the distance, the two points, the faces they lie on and the accuracy', () => {
    const engine = blocks();
    const report = gap(engine, { bodies: ['B', 'A'] });
    expect(report).toMatchObject({ within: 5, close: 1, apart: 0, failed: [], refused: 0, checked: 1 });
    expect(report.truncated).toBeUndefined();
    const pair = only(report);
    if (!('between' in pair)) throw new Error('a gap above zero says where it is');
    // `a` is the smaller ID, whatever the order of the list
    expect(pair).toMatchObject({ a: 'A', b: 'B', distance: expect.closeTo(2, 9) });
    expect(pair.between.a[0]).toBeCloseTo(10, 9);
    expect(pair.between.b[0]).toBeCloseTo(12, 9);
    expect(pair.between.a.slice(1)).toEqual(pair.between.b.slice(1)); // straight across
    expect(pair.between.faceA).toEqual(side('A', 'ab'));
    expect(pair.between.faceB).toEqual(side('B', 'bd'));
    // two bodies of planar faces only: the precision of the coordinates of a pair that reaches 22 mm
    expect(pair.accuracy).toBeCloseTo(22e-6, 12);
    expect(pair.contact).toBeUndefined();
  });

  it('all pairs: the closest first, a distance of zero with its kind, and the rest counted', () => {
    const engine = blocks();
    const report = gap(engine);
    expect(report).toMatchObject({ within: 5, close: 3, apart: 7, refused: 0, checked: 10 });
    expect(report.truncated).toBeUndefined();
    // the two at zero in the order of the bodies in the model, then the open gap
    expect(report.pairs.map((pair) => [pair.a, pair.b, pair.distance, pair.contact])).toEqual([
      ['B', 'C', 0, 'touching'],
      ['C', 'D', 0, 'collision'],
      ['A', 'B', expect.closeTo(2, 9), undefined],
    ]);
    // only pairs among the bodies named
    expect(gap(engine, { bodies: ['A', 'B', 'E'] })).toMatchObject({ close: 1, apart: 2, checked: 3 });
    // the pairs at one distance come in the order of the bodies in the model, whatever the order of the list
    expect(gap(engine, { bodies: ['D', 'C', 'B'] }).pairs.map((pair) => [pair.a, pair.b, pair.contact])).toEqual([
      ['B', 'C', 'touching'],
      ['C', 'D', 'collision'],
    ]);
    // a list that names a body twice asks about the pairs of the different ones
    expect(gap(engine, { bodies: ['A', 'B', 'A'] })).toMatchObject({ close: 1, apart: 0, checked: 1 });
  });

  it('the search distance: a pair further apart is counted, a pair exactly that far apart is not within', () => {
    const engine = blocks();
    expect(gap(engine, { bodies: ['A', 'B'], within: 1 })).toMatchObject({ within: 1, pairs: [], close: 0, apart: 1, checked: 1 });
    expect(gap(engine, { bodies: ['A', 'B'], within: 2 })).toMatchObject({ pairs: [], close: 0, apart: 1 });
    expect(gap(engine, { bodies: ['A', 'B'], within: 2.001 })).toMatchObject({ close: 1, apart: 0 });
    // B and D: 8 along X, 5 along Y between the nearest corners... D starts at y 5, so they face each other
    const far = gap(engine, { within: 100 });
    expect(far).toMatchObject({ close: 10, apart: 0, checked: 10 });
    expect(far.pairs.map((pair) => pair.distance)).toEqual([0, 0, 2, 8, 12, 20, 60, 68, 78, 90].map((value) => (value === 0 ? 0 : expect.closeTo(value, 6))));
    expect(far.pairs[9]).toMatchObject({ a: 'A', b: 'E' });
  });

  it('the limit of the answer cuts the list, not the counts', () => {
    const engine = blocks();
    const cut = gap(engine, { maxPairs: 1 });
    expect(cut).toMatchObject({ close: 3, apart: 7, checked: 10, truncated: { shown: 1, total: 3 } });
    expect(cut.pairs).toEqual([{ a: 'B', b: 'C', distance: 0, contact: 'touching' }]);
    expect(gap(engine, { maxPairs: 3 }).truncated).toBeUndefined();
  });

  it('a body inside the material of another collides, though no surfaces meet; in a cavity it has a gap', () => {
    const engine = newEngine();
    // IN: a cube of 4 in the middle of OUT, a cube of 20; every wall is 8 mm away
    run(engine, ...block('OUT', 0, 0, 20, 20, 0, 20), ...block('IN', 8, 8, 4, 4, 8, 4));
    expect(only(gap(engine, { bodies: ['OUT', 'IN'] }))).toEqual({ a: 'IN', b: 'OUT', distance: 0, contact: 'collision' });
    expect(only(gap(engine, { bodies: ['OUT', 'IN'], within: 20 }))).toEqual({ a: 'IN', b: 'OUT', distance: 0, contact: 'collision' });
    // HOLLOW: a cube of 20 with a closed cavity of 10 (a pocket and a lid); CORE: a cube of 4 in
    // the middle of the cavity, 3 mm from every wall
    run(engine, ...block('HOLLOW', 30, 0, 20, 20, 0, 20), addSketch('sc', XY), rectangle('sc', 'c', 35, 5, 10, 10, null), span('pocket', 'sc', [rectLoop('c')], 5, 15, 'cut', ['HOLLOW']), span('lid', 'sc', [rectLoop('c')], 15, 5, 'add', ['HOLLOW']));
    expectAllOk(run(engine, ...block('CORE', 38, 8, 4, 4, 8, 4)));
    expect(engine.getState().evaluation.bodies.HOLLOW.volume).toBeCloseTo(8000 - 1000, 3);
    const inCavity = only(gap(engine, { bodies: ['HOLLOW', 'CORE'] }));
    expect(inCavity).toMatchObject({ a: 'CORE', b: 'HOLLOW', distance: expect.closeTo(3, 6) });
    expect('between' in inCavity && Math.hypot(...inCavity.between.a.map((value, axis) => value - inCavity.between.b[axis]))).toBeCloseTo(3, 6);
    // Review: the search distance is part of what is remembered for a pair. The boxes of these two
    // overlap, so nothing but the measurement tells that 3 mm is not within 2.
    expect(gap(engine, { bodies: ['HOLLOW', 'CORE'], within: 2 })).toMatchObject({ pairs: [], close: 0, apart: 1 });
    expect(gap(engine, { bodies: ['HOLLOW', 'CORE'], within: 5 })).toMatchObject({ close: 1, apart: 0, pairs: [{ distance: expect.closeTo(3, 6) }] });
    expect(gap(engine, { bodies: ['HOLLOW', 'CORE'], within: 3 })).toMatchObject({ close: 0, apart: 1 }); // exactly that far is not within
    expect(gap(engine, { bodies: ['HOLLOW', 'CORE'], within: 2 })).toMatchObject({ close: 0, apart: 1 });
    // a body of two pieces: one inside SOLID, the other far outside it, so the box of the whole
    // is not inside the box of SOLID
    run(engine, ...block('SOLID', 55, 0, 20, 20, 0, 20), addSketch('st', XY), rectangle('st', 'p', 63, 8, 4, 4, null), rectangle('st', 'q', 90, 8, 4, 4, null));
    expectAllOk(run(engine, span('TWO', 'st', [rectLoop('p'), rectLoop('q')], 8, 4)));
    expect(only(gap(engine, { bodies: ['SOLID', 'TWO'] }))).toEqual({ a: 'SOLID', b: 'TWO', distance: 0, contact: 'collision' });
  });

  it('round faces: a pin in a larger hole has a gap on the wall of the hole; in a hole of its own diameter it touches or fits', () => {
    // A plate with two holes of radius 4, a pin from the circle of the first one, and its copy in
    // the second hole turned by half a turn, so that its corners stick out of the wall.
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', -20, -10, 40, 20, null), circle('S1', 'h1', 10, 0, 4), circle('S1', 'h2', -10, 0, 4));
    run(engine, span('PLATE', 'S1', [rectLoop('r'), ['h1'], ['h2']], 0, 10), span('holes', 'S1', [['h1'], ['h2']], 0, 10, 'cut', ['PLATE']), span('PIN', 'S1', [['h1']], 0, 10));
    expectAllOk(run(engine, { type: 'addFeature', feature: { id: 'PP', name: 'PP', suppressed: false, type: 'pattern', source: { type: 'body', body: 'PIN' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } }));
    expect(only(gap(engine, { bodies: ['PLATE', 'PIN'] }))).toEqual({ a: 'PIN', b: 'PLATE', distance: 0, contact: 'touching' });
    expect(only(gap(engine, { bodies: ['PLATE', 'PP/1'] }))).toEqual({ a: 'PLATE', b: 'PP/1', distance: 0, contact: 'fit' });
    // a thinner pin, 2 mm taller than the plate: the gap is on the walls, not on the caps the pin
    // goes through, and both bodies have round faces
    run(engine, addSketch('S2', XY), circle('S2', 'k', 10, 0, 3.5), span('THIN', 'S2', [['k']], -1, 12));
    const pair = only(gap(engine, { bodies: ['PLATE', 'THIN'] }));
    if (!('between' in pair)) throw new Error('a gap above zero says where it is');
    expect(pair.distance).toBeGreaterThan(0.5 - 0.02);
    expect(pair.distance).toBeLessThan(0.5 + 0.02);
    expect(pair.between.faceA).toEqual(side('holes', 'h1'));
    expect(pair.between.faceB).toEqual(side('THIN', 'k'));
    expect(pair.accuracy).toBeCloseTo(0.02 + 20e-6, 9); // two chord tolerances and the coordinates
    expect(Math.abs(pair.distance - 0.5)).toBeLessThan(pair.accuracy);
  });

  it('review: a distance within the precision of the coordinates is zero, whatever the search distance', () => {
    // Two blocks 5 m from the origin and 0.004 mm apart: coordinates there are known to 0.005 mm.
    const engine = newEngine();
    run(engine, ...block('P', 5000, 0, 10, 10), ...block('Q', 5010.004, 0, 10, 10));
    const { P, Q } = engine.getState().evaluation.bodies;
    const raw = Q.bounds.min[0] - P.bounds.max[0];
    expect(raw).toBeGreaterThan(0.001); // not zero on the mesh
    expect(raw).toBeLessThan(0.005);
    expect(gap(engine).pairs).toEqual([{ a: 'P', b: 'Q', distance: 0, contact: 'touching' }]);
    // a search distance below that precision does not make the pair apart: zero is within any distance
    expect(gap(engine, { within: 0.002 })).toMatchObject({ pairs: [{ a: 'P', b: 'Q', distance: 0, contact: 'touching' }], close: 1, apart: 0 });
    expect(gap(engine, { within: 1e-9 })).toMatchObject({ close: 1, apart: 0 });
    // the same blocks at the origin are 0.004 mm apart, and that is measured
    const near = newEngine();
    run(near, ...block('P', 0, 0, 10, 10), ...block('Q', 10.004, 0, 10, 10));
    expect(only(gap(near))).toMatchObject({ distance: expect.closeTo(0.004, 5), accuracy: expect.closeTo(20.004e-6, 9) });
    expect(gap(near, { within: 0.002 })).toMatchObject({ close: 0, apart: 1 });
  });

  it('review: an answer that is changed by its reader does not change the next one', () => {
    const engine = blocks();
    const first = only(gap(engine, { bodies: ['A', 'B'] }));
    if (!('between' in first)) throw new Error('a gap above zero says where it is');
    const kept = JSON.parse(JSON.stringify(first));
    first.distance = 99;
    first.between.a[0] = -1;
    first.a = 'Z';
    expect(only(gap(engine, { bodies: ['A', 'B'] }))).toEqual(kept);
  });

  it('answers after a feature and about a change that is not written', () => {
    const engine = blocks();
    expect(gap(engine, {}, { at: 'B' })).toMatchObject({ close: 1, apart: 0, checked: 1 });
    expect(gap(engine, {}, { at: 'A' })).toMatchObject({ pairs: [], checked: 0 });
    // B moved 1 mm away, as a preview
    const moved = engine.preview({ type: 'setConstraintValue', sketch: 'sB', id: 'bx', value: 13 });
    if (!moved.ok) throw new Error(moved.error.message);
    expect(only(gap(engine, { bodies: ['A', 'B'] }, { state: moved.state })).distance).toBeCloseTo(3, 9);
    expect(only(gap(engine, { bodies: ['A', 'B'] })).distance).toBeCloseTo(2, 9);
  });

  it('the kernel is asked only where boxes overlap, and once per pair of meshes', async () => {
    const { engine, watch } = await watchedEngine();
    blocks(engine);
    // only C and D have boxes that overlap; B and C only touch
    expect(gap(engine)).toMatchObject({ close: 3, apart: 7 });
    expect(watch.intersections).toBe(1);
    gap(engine);
    gap(engine, { bodies: ['C', 'D'] });
    expect(watch.intersections).toBe(1);
    // another search distance measures again, but what a pair shares is kept by its two meshes
    gap(engine, { within: 6 });
    expect(watch.intersections).toBe(1);
    // a moved body is another mesh
    run(engine, { type: 'setConstraintValue', sketch: 'sD', id: 'dx', value: 31 });
    expect(gap(engine)).toMatchObject({ close: 3, apart: 7 });
    expect(watch.intersections).toBe(2);
  });

  it('a pair the kernel fails on: unknown where the surfaces meet, not measured where one body may lie inside the other', async () => {
    const { engine, watch } = await watchedEngine();
    blocks(engine);
    // a pin in a larger hole of F: their boxes overlap, their surfaces do not meet
    // and the same again further on, G and PIN2
    run(engine, ...block('F', 200, 0, 20, 20), addSketch('sh', XY), circle('sh', 'h', 210, 10, 4), circle('sh', 'k', 210, 10, 3), span('hole', 'sh', [['h'], ['k']], 0, 10, 'cut', ['F']), span('PIN', 'sh', [['k']], 0, 10));
    run(engine, ...block('G', 300, 0, 20, 20), addSketch('sg', XY), circle('sg', 'm', 310, 10, 4), circle('sg', 'n', 310, 10, 3), span('hole2', 'sg', [['m'], ['n']], 0, 10, 'cut', ['G']), span('PIN2', 'sg', [['n']], 0, 10));
    watch.fail = true;
    const report = gap(engine);
    expect(report).toMatchObject({ close: 3, refused: 2, apart: 31, checked: 36 });
    const message = 'the kernel could not tell whether one body lies inside the other: the kernel gave up';
    expect(report.failed).toEqual([
      { a: 'F', b: 'PIN', message },
      { a: 'G', b: 'PIN2', message },
    ]);
    expect(report.pairs.map((pair) => [pair.a, pair.b, pair.contact])).toEqual([
      ['B', 'C', 'touching'], // flush: their boxes do not overlap, the kernel is not needed
      ['C', 'D', 'unknown'],
      ['A', 'B', undefined],
    ]);
    // the refused pairs are limited like the close ones, and counted
    const cut = gap(engine, { maxPairs: 1 });
    expect(cut).toMatchObject({ close: 3, refused: 2, truncated: { shown: 2, total: 5 } });
    expect(cut.failed).toEqual([{ a: 'F', b: 'PIN', message }]);
  });

  it('errors: one body is not a pair, a body that is not there, a search distance of zero', () => {
    const engine = blocks();
    expect(engine.query('gap', { bodies: ['A', 'A'] })).toMatchObject({ ok: false, error: { code: 'invalidArguments', message: 'gap: bodies: two different bodies are needed for a pair', arg: ['bodies'] } });
    expect(engine.query('gap', { bodies: ['A'] })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['bodies'] } });
    expect(engine.query('gap', { bodies: ['A', 'nope'] })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['bodies', 1] } });
    expect(engine.query('gap', { within: 0 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['within'] } });
    expect(engine.query('gap', { maxPairs: 0 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['maxPairs'] } });
    // a model with one body or none has no pair
    expect(gap(engine, {}, { at: 'A' })).toEqual({ within: 5, pairs: [], close: 0, apart: 0, failed: [], refused: 0, checked: 0 });
  });
});

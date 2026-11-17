// The grid of D53 (an addition to package 2e of D36, docs/d36/2e-pattern-mirror/grid.md) in the
// recompute, against the real adapters: a second direction of the linear pattern, the copy at
// (i, j) numbered i + 1000 · j, at most 200 places and no two places in one place.
import type { Command, EdgeName, Engine, EngineState, FaceName, HoleFeature, Id, Input, PatternFeature } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addSketch, batch, cap, circle, expectAllOk, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, status, volume } from './kit';

type Transform = Input<PatternFeature>['transform'];
type Direction = { kind: 'base'; axis: 'X' | 'Y' | 'Z' } | { kind: 'sketchPoint'; sketch: Id; point: Id };
const X: Direction = { kind: 'base', axis: 'X' };
const Y: Direction = { kind: 'base', axis: 'Y' };
const volumeOf = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const near = (actual: number, expected: number, tolerance = 1e-3) => expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThan(tolerance);
const pattern = (id: Id, source: PatternFeature['source'], transform: Transform): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'pattern', source, transform } });
const features = (...ids: Id[]): PatternFeature['source'] => ({ type: 'features', features: ids });
const ofBody = (body: Id): PatternFeature['source'] => ({ type: 'body', body });
const spacing = (value: number | string) => ({ type: 'spacing' as const, spacing: value });
// A grid: `count` along `first` with `step`, and `count2` along `second` with `step2`.
const grid = (first: Direction, count: number | string, step: number | string, second: Direction, count2: number | string, step2: number | string | { type: 'length'; length: number }): Transform => ({
  type: 'linear',
  direction: first,
  count,
  span: spacing(step),
  second: { direction: second, count: count2, span: typeof step2 === 'object' ? step2 : spacing(step2) },
});
const tag = (name: FaceName, ...tags: [Id, number][]): FaceName => (tags.length ? { ...name, copy: tags.map(([pattern, index]) => ({ pattern, index })) } : name);
const previewOf = (engine: Engine, ...commands: Command[]): EngineState => {
  const result = engine.preview(commands.length === 1 ? commands[0] : batch(...commands));
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};
// The copy numbers in the tags of the faces a pattern made in a body, sorted as numbers.
const tagged = (state: EngineState, body: Id, pattern: Id): number[] =>
  [...new Set(state.evaluation.bodies[body].faces.flatMap((face) => (state.evaluation.faceNames[face.id].copy ?? []).filter((t) => t.pattern === pattern).map((t) => t.index)))].sort((a, b) => a - b);
const extrusion = (id: Id, sketch: Id, loops: Id[][], extent: object, operation: 'new' | 'add' | 'cut', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: loops.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) }, extent, operation, ...(targets ? { targets } : {}) } as never,
});
const hole = (id: Id, sketch: Id, points: Id[], shape: HoleFeature['shape'], extent: HoleFeature['extent'], targets: Id[]): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'hole', sketch, points, shape, extent, targets } });
// A closed polygon of sketch points and lines `${p}l<i>`, without constraints.
function polygon(sketch: Id, p: string, corners: [number, number][]): Command {
  return batch(
    ...corners.map(([x, y], i): Command => ({ type: 'addPoint', sketch, id: `${p}${i}`, x, y })),
    ...corners.map((_, i): Command => ({ type: 'addCurve', sketch, id: `${p}l${i}`, curve: { type: 'line', a: `${p}${i}`, b: `${p}${(i + 1) % corners.length}` } })),
  );
}
const loop = (p: string, n: number): Id[] => Array.from({ length: n }, (_, i) => `${p}l${i}`);
const rect = (x: number, y: number, w: number, h: number): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

// ---------------------------------------------------------------- a grid of features

// A plate `w` × `h` × 4 and a slot `sw` × `sh` cut through it with its corner at (x, y), in a sketch T
// on the base plane XY; the counts of a grid are the parameters n and m.
function slotted(w = 120, h = 80, [x, y, sw, sh] = [5, 5, 2, 6]): Engine {
  const engine = newEngine();
  run(
    engine,
    { type: 'setParameter', name: 'n', expr: '4' },
    { type: 'setParameter', name: 'm', expr: '3' },
    addSketch('S', XY),
    rectangle('S', 'r', 0, 0, w, h),
    extrusion('A', 'S', [rectLoop('r')], { type: 'distance', start: 0, distance: 4 }, 'new'),
    addSketch('T', XY),
    polygon('T', 's', rect(x, y, sw, sh)),
    extrusion('slot', 'T', [loop('s', 4)], { type: 'throughAll', side: 'both' }, 'cut', ['A']),
  );
  return engine;
}
const PLATE = 120 * 80 * 4;
const SLOT = 2 * 6 * 4;
// The bottom side of the slot of the copy `index` (the line from s0 to s1).
const slotSide = (index: number): FaceName => tag(side('slot', 'sl0'), ['G', index]);
const at = (state: EngineState, index: number): number[] => {
  const box = faceBox(state, 'A', slotSide(index));
  if (!box) throw new Error(`no copy ${index}`);
  return [box.min[0], box.min[1]];
};

describe('a grid of features: the numbers and the places (D53)', () => {
  it('a grid 4 × 3: the copies 1 … 3, 1000 … 1003, 2000 … 2003, each where its number says', () => {
    const engine = slotted();
    const state = run(engine, pattern('G', features('slot'), grid(X, 'n', 5, Y, 'm', 10)));
    expectAllOk(state);
    near(PLATE - volumeOf(state, 'A'), 12 * SLOT);
    expect(tagged(state, 'A', 'G')).toEqual([1, 2, 3, 1000, 1001, 1002, 1003, 2000, 2001, 2002, 2003]);
    for (const [index, x, y] of [
      [3, 20, 5],
      [1000, 5, 15],
      [1002, 15, 15],
      [2003, 20, 25],
    ]) {
      const [px, py] = at(state, index);
      near(px, x, 1e-4);
      near(py, y, 1e-4);
    }
  });

  it('a larger count in either direction moves none: a sketch on a face of a copy stays; a smaller one breaks it', () => {
    const engine = slotted();
    run(engine, pattern('G', features('slot'), grid(X, 'n', 5, Y, 'm', 10)), addSketch('on', onFace('A', slotSide(1002))));
    const was = engine.getState().evaluation.features.on.plane?.origin as number[];
    const larger = previewOf(engine, { type: 'setParameter', name: 'n', expr: '5' }, { type: 'setParameter', name: 'm', expr: '4' });
    expectAllOk(larger);
    near(PLATE - volumeOf(larger, 'A'), 20 * SLOT);
    (larger.evaluation.features.on.plane?.origin as number[]).forEach((value, axis) => near(value, was[axis], 1e-9));
    for (const index of [1, 2, 3, 1000, 1001, 1002, 1003, 2000, 2001, 2002, 2003]) expect(at(larger, index)).toEqual(at(engine.getState(), index));
    near(at(larger, 4)[0], 25, 1e-4);
    expect(at(larger, 3004)).toEqual([expect.closeTo(25, 4), expect.closeTo(35, 4)]);
    // one row: the copies of a row, and the sketch on the copy 1002 has no face
    const one = previewOf(engine, { type: 'setParameter', name: 'n', expr: '5' }, { type: 'setParameter', name: 'm', expr: '1' });
    expect(tagged(one, 'A', 'G')).toEqual([1, 2, 3, 4]);
    expect(status(one).on).toBe('error:brokenReference');
  });

  it('a row that gets a second direction keeps its copies; `second: null` gives the row back', () => {
    const engine = slotted();
    const row = run(engine, pattern('G', features('slot'), { type: 'linear', direction: X, count: 4, span: spacing(5) }));
    const places = [1, 2, 3].map((index) => at(row, index));
    const gridded = run(engine, { type: 'updateFeature', id: 'G', patch: { transform: { second: { direction: Y, count: 2, span: spacing(10) } } } });
    expect([1, 2, 3].map((index) => at(gridded, index))).toEqual(places);
    expect(tagged(gridded, 'A', 'G')).toEqual([1, 2, 3, 1000, 1001, 1002, 1003]);
    const back = run(engine, { type: 'updateFeature', id: 'G', patch: { transform: { second: null } } });
    expect(tagged(back, 'A', 'G')).toEqual([1, 2, 3]);
    expect(volumeOf(back, 'A')).toBe(volumeOf(row, 'A'));
  });

  it('copies past the end of the plate: noEffect names them row by row', () => {
    const engine = slotted();
    // the slot at x = 5 + 5i fits up to i = 22 (115 … 117); 23, 24 and 25 run past the end of 120
    const state = run(engine, pattern('G', features('slot'), grid(X, 26, 5, Y, 2, 10)));
    expect(state.evaluation.features.G.warnings[0]).toMatchObject({ code: 'noEffect' });
    expect(state.evaluation.features.G.warnings[0].refs?.map((ref) => (ref as { copy: number }).copy)).toEqual([23, 24, 25, 1023, 1024, 1025]);
  });

  it('a copy that fails names its number, and the model stays as it was before the pattern', () => {
    const engine = slotted();
    // a small block B inside the place (1, 1) of the slot, which cuts A and B: the copy 1001 would remove B whole
    // (before the slot on the timeline)
    run(engine, addSketch('U', XY, 3), polygon('U', 'b', rect(10.5, 16, 1, 2)), { ...extrusion('B', 'U', [loop('b', 4)], { type: 'distance', start: 0, distance: 4 }, 'new'), index: 4 } as Command, { type: 'updateFeature', id: 'slot', patch: { targets: ['A', 'B'] } });
    const before = engine.getState();
    const state = run(engine, pattern('G', features('slot'), grid(X, 'n', 5, Y, 'm', 10)));
    expect(state.evaluation.features.G.error).toMatchObject({ code: 'emptyResult', refs: [{ copy: 1001, feature: 'slot' }, 'B'] });
    expect(volumeOf(state, 'A')).toBe(volumeOf(before, 'A'));
    expect(volumeOf(state, 'B')).toBe(volumeOf(before, 'B'));
  });

  it('the second span as a length, negative steps, a count of 1', () => {
    const engine = slotted();
    run(engine, pattern('G', features('slot'), grid(X, 2, 5, Y, 3, { type: 'length', length: 40 })));
    expect(at(engine.getState(), 2001)).toEqual([expect.closeTo(10, 4), expect.closeTo(45, 4)]);
    expect(at(engine.getState(), 1000)).toEqual([expect.closeTo(5, 4), expect.closeTo(25, 4)]);
    // the slot at (60, 40), and the grid against both directions
    const middle = slotted(120, 80, [60, 40, 2, 6]);
    const back = run(middle, pattern('G', features('slot'), grid(X, 2, -5, Y, 3, { type: 'length', length: -20 })));
    expectAllOk(back);
    expect(at(back, 2001)).toEqual([expect.closeTo(55, 4), expect.closeTo(20, 4)]);
    // a count of 1 along the second direction: the copies of a row
    const single = run(middle, { type: 'setField', feature: 'G', path: 'transform/second/count', value: 1 });
    expect(tagged(single, 'A', 'G')).toEqual([1]);
  });
});

// ---------------------------------------------------------------- the two rules of a grid

// A block 2 × 2 × 2 with its corner at (x, 0, 0); the counts of a grid are the parameters n and m.
function block(x = 0): Engine {
  const engine = newEngine();
  run(
    engine,
    { type: 'setParameter', name: 'n', expr: '3' },
    { type: 'setParameter', name: 'm', expr: '2' },
    addSketch('S', XY),
    polygon('S', 'q', rect(x, 0, 2, 2)),
    extrusion('A', 'S', [loop('q', 4)], { type: 'distance', start: 0, distance: 2 }, 'new'),
    addSketch('onXZ', { kind: 'base', plane: 'XZ' }),
    addSketch('onYZ', { kind: 'base', plane: 'YZ' }),
  );
  return engine;
}
const normalOf = (sketch: Id): Direction => ({ kind: 'sketchPoint', sketch, point: 'origin' });

describe('a grid has at most 200 places, and no two in one place (D53)', () => {
  it('200 places pass and 201 do not; the bound is judged by the recompute, also through parameters', () => {
    const engine = block();
    for (const [n, m] of [
      [20, 10],
      [200, 1],
      [1, 200],
    ]) {
      const state = previewOf(engine, pattern('G', ofBody('A'), grid(X, n, 3, Y, m, 3)));
      expect(state.evaluation.features.G.status).toBe('ok');
      expect(state.evaluation.features.G.bodies).toHaveLength(199);
    }
    const over = previewOf(engine, pattern('G', ofBody('A'), grid(X, 67, 3, Y, 3, 3)));
    expect(over.evaluation.features.G.error).toEqual({
      code: 'invalidPattern',
      message: 'The counts, the directions and the spans do not make a pattern. (67 × 3 is 201 places; a pattern has at most 200, the original included)',
      refs: ['transform/count', 'transform/second/count'],
    });
    expect(Object.keys(over.evaluation.bodies)).toEqual(['A']);
    // two counts that are each in range: the document holds them and loads, the pattern in error
    run(engine, pattern('G', ofBody('A'), grid(X, 'n', 3, Y, 'm', 3)), { type: 'setParameter', name: 'n', expr: '30' }, { type: 'setParameter', name: 'm', expr: '20' });
    const saved = engine.save();
    const transform = (JSON.parse(saved) as { features: PatternFeature[] }).features.find((f) => f.id === 'G')?.transform;
    expect(transform).toMatchObject({ count: 30, second: { count: 20 } });
    const other = newEngine();
    const loaded = other.load(saved);
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(status(loaded.state).G).toBe('error:invalidPattern');
    expect(loaded.state.document).toEqual(engine.getState().document);
  });

  it('places that meet: the same step along parallel axes, a base axis against a sketch normal along it and against it', () => {
    const engine = block();
    const detail = (transform: Transform): string | undefined => {
      const state = previewOf(engine, pattern('G', ofBody('A'), transform));
      return state.evaluation.features.G.error?.message.replace('The counts, the directions and the spans do not make a pattern. ', '');
    };
    expect(detail(grid(X, 2, 5, X, 2, 5))).toBe('(the copies 1 and 1000 would stand in one place)');
    expect(detail(grid(X, 4, 5, X, 3, 10))).toBe('(the copies 2 and 1000 would stand in one place)');
    expect(detail(grid(X, 3, 5, X, 2, -5))).toBe('(the copy 1001 would stand in the place of the original)');
    // the normal of a sketch on XZ is −Y, on YZ +X
    expect(detail(grid(Y, 2, 5, normalOf('onXZ'), 2, 5))).toBe('(the copy 1001 would stand in the place of the original)');
    expect(detail(grid(X, 2, 5, normalOf('onYZ'), 2, 5))).toBe('(the copies 1 and 1000 would stand in one place)');
    // parallel directions whose places do not meet, directions across each other, a count of 1
    for (const [transform, copies] of [
      [grid(X, 2, 5, normalOf('onXZ'), 2, 5), 3],
      [grid(X, 4, 5, X, 3, 6), 11],
      [grid(X, 3, 5, X, 2, 15), 5],
      [grid(X, 1, 5, X, 3, 5), 2],
      [grid(X, 3, 5, X, 1, 5), 2],
    ] as [Transform, number][]) {
      const state = previewOf(engine, pattern('G', ofBody('A'), transform));
      expect(state.evaluation.features.G.status).toBe('ok');
      expect(state.evaluation.features.G.bodies).toHaveLength(copies);
    }
  });

  it('a step below the tolerance: refused in a grid, also across and with a count of 1; the same row without `second` makes its copies', () => {
    const engine = block();
    const tiny = { type: 'length' as const, length: 2e-6 };
    const across = previewOf(engine, pattern('G', ofBody('A'), { type: 'linear', direction: X, count: 5, span: tiny, second: { direction: Y, count: 2, span: spacing(5) } }));
    expect(across.evaluation.features.G.error?.message).toContain('(the copy 1 would stand in the place of the original)');
    const column = previewOf(engine, pattern('G', ofBody('A'), { type: 'linear', direction: X, count: 1, span: spacing(5), second: { direction: Y, count: 5, span: tiny } }));
    expect(column.evaluation.features.G.error?.message).toContain('(the copy 1000 would stand in the place of the original)');
    const row = previewOf(engine, pattern('G', ofBody('A'), { type: 'linear', direction: X, count: 5, span: tiny }));
    expect(row.evaluation.features.G.status).toBe('ok');
    expect(row.evaluation.features.G.bodies).toHaveLength(4);
  });

  it('the limit: places compared, not meshes. A cube at x = 64 with the steps 5 and 5.000002 passes, and two copies are one mesh', () => {
    const engine = block(64);
    const state = previewOf(engine, pattern('G', ofBody('A'), grid(X, 2, 5, X, 2, 5.000002)));
    expect(state.evaluation.features.G.status).toBe('ok');
    expect(state.evaluation.features.G.bodies).toEqual(['G/1', 'G/1000', 'G/1001']);
    // the places are 2e-6 mm apart, the step of float32 at x = 69 is 7.6e-6 mm
    expect([...state.evaluation.bodies['G/1000'].solid.positions]).toEqual([...state.evaluation.bodies['G/1'].solid.positions]);
  });
});

// ---------------------------------------------------------------- the order in which the copies are applied

describe('the order of application changes with the first count (a known limit of D53)', () => {
  it('slots along one line, the steps 5 and 2.5: one more column comes before the copy 1003, which then cuts nothing', () => {
    // a plate 120 × 20 × 4 and a slot 6 × 2 through it; the first direction X with the step 5, the
    // second X with the step 2.5 and the count 2
    const engine = slotted(120, 20, [10, 5, 6, 2]);
    const state = run(engine, pattern('G', features('slot'), { type: 'linear', direction: X, count: 'n', span: spacing(5), second: { direction: X, count: 2, span: spacing(2.5) } }));
    const idle = (s: EngineState): number[] => (s.evaluation.features.G.warnings[0]?.refs ?? []).map((ref) => (ref as { copy: number }).copy);
    expect(idle(state)).toEqual([1000, 1001, 1002]);
    expect(tagged(state, 'A', 'G')).toEqual([1, 2, 3, 1003]);
    const five = previewOf(engine, { type: 'setParameter', name: 'n', expr: '5' });
    expect(idle(five)).toEqual([1000, 1001, 1002, 1003]);
    expect(tagged(five, 'A', 'G')).toEqual([1, 2, 3, 4, 1004]);
  });

  it('a blind round pocket on a grid X × Y and the same places with the directions swapped: the floor of the place (3, 1) differs', () => {
    // a plate 60 × 40 × 10, a pocket of radius 4 and 3 deep from its top at (10, 10)
    const engine = newEngine();
    run(
      engine,
      addSketch('S', XY),
      rectangle('S', 'r', 0, 0, 60, 40),
      extrusion('A', 'S', [rectLoop('r')], { type: 'distance', start: 0, distance: 10 }, 'new'),
      addSketch('T', onFace('A', cap('A'))),
      circle('T', 'k', 10, 10, 4),
      extrusion('pocket', 'T', [['k']], { type: 'distance', start: 0, distance: -3 }, 'cut', ['A']),
    );
    const floor = (transform: Transform, index: number): number => {
      const state = previewOf(engine, pattern('G', features('pocket'), transform));
      expect(state.evaluation.features.G.status).toBe('ok');
      return (faceBox(state, 'A', tag(cap('pocket'), ['G', index])) as { area: number }).area;
    };
    const xFirst = floor(grid(X, 5, 5, Y, 2, 5), 1003);
    const yFirst = floor(grid(Y, 2, 5, X, 5, 5), 3001);
    // measured by the design: 25.0000 against 25.7418 mm²
    near(xFirst, 25.0000, 1e-4);
    near(yFirst, 25.7418, 1e-4);
  });
});

// ---------------------------------------------------------------- sources of a grid of features

describe('the sources of a grid of features (D53)', () => {
  it('a post with a counterbored hole through all, the sources in their order: twelve times what one adds', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('S', XY),
      rectangle('S', 'r', 0, 0, 80, 60),
      extrusion('A', 'S', [rectLoop('r')], { type: 'distance', start: 0, distance: 3 }, 'new'),
      addSketch('T', onFace('A', cap('A'))),
      circle('T', 'p', 10, 10, 4),
      extrusion('post', 'T', [['p']], { type: 'distance', start: 0, distance: 6 }, 'add', ['A']),
      addSketch('U', onFace('A', cap('post'))),
      { type: 'addPoint', sketch: 'U', id: 'h', x: 10, y: 10 },
      hole('bore', 'U', ['h'], { type: 'counterbore', diameter: 2, headDiameter: 4, headDepth: 2 }, { type: 'throughAll', side: 'backward' }, ['A']),
    );
    const plate = volumeOf(engine.getState('A'), 'A');
    const one = volumeOf(engine.getState(), 'A') - plate;
    const state = run(engine, pattern('G', features('post', 'bore'), grid(X, 4, 15, Y, 3, 15)));
    expectAllOk(state);
    near(volumeOf(state, 'A') - plate, 12 * one, 1e-3);
    expect(faceBox(state, 'A', tag({ feature: 'bore', role: 'holeBore', point: 'h' }, ['G', 2003]))).toBeDefined();
  });

  it('a post up to a tilted plane: each place has its own length', () => {
    // a roof above a plate: its underside rises along X (z = 20 + x · tan 2°)
    const TAN = Math.tan(Math.PI / 90);
    const engine = newEngine();
    run(
      engine,
      addSketch('S', XY),
      rectangle('S', 'r', 0, 0, 60, 40),
      extrusion('A', 'S', [rectLoop('r')], { type: 'distance', start: 0, distance: 10 }, 'new'),
      addSketch('R', { kind: 'base', plane: 'YZ' }),
      polygon('R', 'f', rect(0, 20, 40, 5)),
      extrusion('roof', 'R', [loop('f', 4)], { type: 'distance', start: 0, distance: 60, taper: 'deg(-2)' }, 'new'),
      addSketch('T', onFace('A', cap('A'))),
      circle('T', 'p', 15, 10, 2),
      extrusion('post', 'T', [['p']], { type: 'upTo', plane: onFace('roof', side('roof', 'fl0')), start: 0 }, 'add', ['A']),
    );
    const state = run(engine, pattern('G', features('post'), grid(X, 3, 10, Y, 2, 15)));
    expectAllOk(state);
    const top = (...tags: [Id, number][]): number => (faceBox(state, 'A', tag(cap('post'), ...tags)) as { max: number[] }).max[2];
    near(top(['G', 1001]), 20 + 27 * TAN, 1e-3);
    near(top(['G', 2]), 20 + 37 * TAN, 1e-3);
    near(top(['G', 1000]), 20 + 17 * TAN, 1e-3);
  });

  it('a headed hole as deep as the targets: the source misses, a copy that hits is the error of its mark with its number', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('S', XY),
      rectangle('S', 'r', 0, 0, 60, 40),
      extrusion('A', 'S', [rectLoop('r')], { type: 'distance', start: 0, distance: 10 }, 'new'),
      addSketch('T', onFace('A', cap('A'))),
      // outside the plate at x = -10: the head is deeper than the plate, so the hole may only miss
      { type: 'addPoint', sketch: 'T', id: 'h', x: -10, y: 20 },
      hole('H', 'T', ['h'], { type: 'counterbore', diameter: 3, headDiameter: 6, headDepth: 12 }, { type: 'throughAll', side: 'backward' }, ['A']),
    );
    expect(status(engine.getState()).H).toBe('warning:noEffect');
    // along Y every place misses; the second row along X lands on the plate
    const state = previewOf(engine, pattern('G', features('H'), grid(Y, 2, 5, X, 2, 20)));
    expect(state.evaluation.features.G.error).toMatchObject({ code: 'invalidHole', refs: [{ copy: 1000, feature: 'H' }, 'A'] });
  });
});

// ---------------------------------------------------------------- a grid of a body

// A block 10 × 10 × 2 and a grid of it, 3 × 2 with the steps 15 along X and Y.
function blocks(): Engine {
  const engine = newEngine();
  run(
    engine,
    addSketch('S', XY),
    polygon('S', 'q', rect(0, 0, 10, 10)),
    extrusion('A', 'S', [loop('q', 4)], { type: 'distance', start: 0, distance: 2 }, 'new'),
    pattern('G', ofBody('A'), grid(X, 3, 15, Y, 2, 15)),
    { type: 'setBodyMaterial', body: 'A', material: 'PETG' },
  );
  return engine;
}
const GRID = ['G/1', 'G/2', 'G/1000', 'G/1001', 'G/1002'];

describe('a grid of a body (D53)', () => {
  it('the copies, their places and the tags of their faces; body properties inherited; the queries and an export take them', () => {
    const engine = blocks();
    const state = engine.getState();
    expectAllOk(state);
    expect(state.evaluation.features.G.bodies).toEqual(GRID);
    for (const id of GRID) near(volumeOf(state, id), 200, 1e-4);
    expect(state.evaluation.bodies['G/1002'].bounds).toMatchObject({ min: [expect.closeTo(30, 5), expect.closeTo(15, 5), 0], max: [expect.closeTo(40, 5), expect.closeTo(25, 5), 2] });
    expect(faceNames(state, 'G/1002')).toEqual(faceNames(state, 'A').map((name) => `${name}@G:1002`));
    expect(state.evaluation.bodyProperties['G/1002']).toMatchObject({ material: 'PETG', from: 'A' });
    const mass = engine.query('mass', { bodies: ['A', ...GRID] });
    if (!mass.ok) throw new Error(mass.error.message);
    near(mass.result.mass, 6 * (mass.result.bodies[0].mass as number), 1e-6);
    const report = engine.query('interference', { bodies: ['A', ...GRID] });
    expect(report).toMatchObject({ ok: true, result: { pairs: [], failed: [], checked: 15 } });
    const section = engine.query('section', { plane: XY, offset: 1, bodies: ['G/1001'] });
    if (!section.ok) throw new Error(section.error.message);
    near((section.result as { bodies: { area: number }[] }).bodies[0].area, 100, 1e-3);
    const exported = engine.export('stl', { bodies: ['A', ...GRID], perBody: true });
    expect(exported.ok && exported.result.files).toHaveLength(6);
  });

  it('a cut into a copy, a grid of a copy (both tags), body properties set on a copy stay when a count grows', () => {
    const engine = blocks();
    run(
      engine,
      addSketch('C', XY),
      circle('C', 'k', 35, 20, 2),
      extrusion('cut', 'C', [['k']], { type: 'throughAll', side: 'both' }, 'cut', ['G/1002']),
      pattern('H', ofBody('G/1002'), grid(X, 2, 50, Y, 2, 50)),
      { type: 'setBodyProperties', body: 'G/1001', patch: { color: '#ff0000' } },
    );
    const state = engine.getState();
    expectAllOk(state);
    // the circle of radius 2 is a polygon inside it
    near(volumeOf(state, 'G/1002'), 200 - Math.PI * 4 * 2, 0.2);
    expect(state.evaluation.features.H.bodies).toEqual(['H/1', 'H/1000', 'H/1001']);
    expect(faceNames(state, 'H/1001')).toContain('A/endCap@G:1002@H:1001');
    expect(state.evaluation.bodyProperties['H/1001']).toMatchObject({ from: 'G/1002' });
    const grown = run(engine, { type: 'setField', feature: 'G', path: 'transform/count', value: 4 });
    expect(grown.evaluation.features.G.bodies).toEqual(['G/1', 'G/2', 'G/3', 'G/1000', 'G/1001', 'G/1002', 'G/1003']);
    expect(grown.evaluation.bodyProperties['G/1001']).toMatchObject({ color: '#ff0000' });
    near(volumeOf(grown, 'G/1002'), volumeOf(state, 'G/1002'), 1e-9);
  });

  it('a grid that shrinks: what stood on a lost copy is reported as each place reports a body that is not there', () => {
    const engine = blocks();
    const top = tag(cap('A'), ['G', 1001]);
    const edge: EdgeName = { a: top, b: tag(side('A', 'ql0'), ['G', 1001]) };
    run(
      engine,
      addSketch('C', XY),
      circle('C', 'k', 20, 20, 2),
      extrusion('cut', 'C', [['k']], { type: 'throughAll', side: 'both' }, 'cut', ['G/1001']),
      addSketch('onIt', onFace('G/1001', top)),
      addSketch('Top', XY),
      { type: 'addExternal', sketch: 'Top', id: 'e', ref: { type: 'edge', body: 'G/1001', edge, kind: 'line' } },
      { type: 'setLink', id: 'base', bodies: ['A', 'G/1001'] },
      { type: 'setBodyProperties', body: 'G/1001', patch: { color: '#ff0000' } },
    );
    expectAllOk(engine.getState());
    const kept = engine.getState().evaluation.features.Top.sketch?.points['e/a'];
    const state = run(engine, { type: 'setField', feature: 'G', path: 'transform/second/count', value: 1 });
    expect(state.evaluation.features.G.bodies).toEqual(['G/1', 'G/2']);
    expect(status(state)).toMatchObject({ cut: 'error:brokenReference', onIt: 'error:brokenReference', Top: 'warning:brokenProjection' });
    expect(state.evaluation.features.Top.sketch?.points['e/a']).toEqual(kept);
    expect(state.evaluation.mechanism.links.base).toMatchObject({ bodies: ['A'], missing: ['G/1001'] });
    expect(state.document.bodyProperties['G/1001']).toEqual({ color: '#ff0000' });
    expect(state.evaluation.bodies['G/1001']).toBeUndefined();
  });

  it('a link lists copies of both rows; a body properties entry of a number no grid has is accepted', () => {
    const engine = blocks();
    const state = run(engine, { type: 'setLink', id: 'base', bodies: ['A', 'G/1', 'G/1002'] }, { type: 'setBodyProperties', body: 'G/7', patch: { color: '#000000' } });
    expect(state.evaluation.mechanism.links.base).toMatchObject({ bodies: ['A', 'G/1', 'G/1002'], missing: [] });
    expect(state.evaluation.bodies['G/7']).toBeUndefined();
  });
});

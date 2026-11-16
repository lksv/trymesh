// D47 (package 2f of D36) in the recompute, against the real adapters: the extent up to a plane or
// a planar face, its lengths and its end cap, the gap, the refusals, and patterns.
import { describe, expect, it } from 'vitest';
import type { Command, Engine, EngineState, ExtrudeFeature, FaceName, Id, Input, PlaneRef, Surface } from '@trymesh/engine';
import { XY, addSketch, batch, cap, circle, expectAllOk, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, volume } from './kit';

type Profile = Input<ExtrudeFeature>['profile'];
type Extent = Input<ExtrudeFeature>['extent'];
const feature = (id: Id, profile: Profile, extent: Extent, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile, extent, operation, ...(targets ? { targets } : {}) },
});
const regions = (sketch: Id, loops: Id[][]): Profile => ({ type: 'regions', sketch, regions: loops.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) });
const upTo = (plane: PlaneRef, start: number | string = 0, gap?: number | string): Extent => ({ type: 'upTo', plane, start, ...(gap === undefined ? {} : { gap }) });
const volumeOf = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const near = (actual: number, expected: number, tolerance = 1e-3) => expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThan(tolerance);
const surface = (state: EngineState, name: FaceName): Surface => state.evaluation.faceSurfaces[state.evaluation.faceNames.findIndex((other) => JSON.stringify(other) === JSON.stringify(name))];
const errorOf = (state: EngineState, id: Id) => state.evaluation.features[id].error;
const factsOf = (state: EngineState, id: Id) => state.evaluation.features[id].facts;
// The area of a circle as the engine builds it: a regular polygon inscribed with the chord tolerance 0.01.
const disc = (radius: number): number => {
  const sides = Math.ceil((2 * Math.PI) / (2 * Math.acos(1 - 0.01 / radius)) - 1e-9);
  return (sides / 2) * radius * radius * Math.sin((2 * Math.PI) / sides);
};
const LID = (feature: Id): PlaneRef => ({ kind: 'face', body: feature, face: cap(feature, 'startCap') });

// The box A 40 × 30 × 10 at the origin; a lid L 40 × 30 from z = h to h + 3 (the parameter h,
// 20); a sketch T on the top of A with a circle `p` of radius 3 at (10, 15).
function model(): Engine {
  const engine = newEngine();
  run(
    engine,
    { type: 'setParameter', name: 'h', expr: '20' },
    addSketch('S', XY),
    rectangle('S', 'r', 0, 0, 40, 30),
    feature('A', regions('S', [rectLoop('r')]), { type: 'distance', start: 0, distance: 10 }),
    feature('L', regions('S', [rectLoop('r')]), { type: 'distance', start: 'h', distance: 3 }),
    addSketch('T', onFace('A', cap('A'))),
    circle('T', 'p', 10, 15, 3),
  );
  return engine;
}
// A wedge W above the box: its underside rises from z = 20 at x = 0 to z = 24 at x = 40.
function wedge(engine: Engine): EngineState {
  return run(
    engine,
    addSketch('X', { kind: 'base', plane: 'XZ' }),
    batch(
      { type: 'addPoint', sketch: 'X', id: 'w1', x: 0, y: 20 },
      { type: 'addPoint', sketch: 'X', id: 'w2', x: 40, y: 24 },
      { type: 'addPoint', sketch: 'X', id: 'w3', x: 40, y: 30 },
      { type: 'addPoint', sketch: 'X', id: 'w4', x: 0, y: 30 },
      { type: 'addCurve', sketch: 'X', id: 'wa', curve: { type: 'line', a: 'w1', b: 'w2' } },
      { type: 'addCurve', sketch: 'X', id: 'wb', curve: { type: 'line', a: 'w2', b: 'w3' } },
      { type: 'addCurve', sketch: 'X', id: 'wc', curve: { type: 'line', a: 'w3', b: 'w4' } },
      { type: 'addCurve', sketch: 'X', id: 'wd', curve: { type: 'line', a: 'w4', b: 'w1' } },
    ),
    // the plane XZ has its normal along −y: a distance of −30 runs over the box
    feature('W', regions('X', [['wa', 'wb', 'wc', 'wd']]), { type: 'distance', start: 0, distance: -30 }),
  );
}
const UNDER: FaceName = { feature: 'W', role: 'side', curve: 'wa' };

describe('an extent up to a plane', () => {
  it('a post up to the parallel underside of the lid: one length, the mesh of a distance extent; it follows the lid', () => {
    const engine = model();
    const state = run(engine, feature('post', regions('T', [['p']]), upTo(LID('L')), 'add', ['A']));
    expectAllOk(state);
    expect(factsOf(state, 'post')).toEqual({ lengthMin: 10, lengthMax: 10, forward: true });
    near(volumeOf(state, 'A'), 12000 + disc(3) * 10);
    expect(surface(state, cap('post'))).toMatchObject({ kind: 'plane', origin: [0, 0, 20], normal: [0, 0, 1] });
    // the same post by a distance of 10: the same mesh
    const other = model();
    const same = run(other, feature('post', regions('T', [['p']]), { type: 'distance', start: 0, distance: 10 }, 'add', ['A']));
    expect(Array.from(state.evaluation.bodies.A.solid.positions)).toEqual(Array.from(same.evaluation.bodies.A.solid.positions));
    // a higher lid: the post grows with it
    const higher = run(engine, { type: 'setParameter', name: 'h', expr: '25' });
    expect(factsOf(higher, 'post')).toEqual({ lengthMin: 15, lengthMax: 15, forward: true });
    near(volumeOf(higher, 'A'), 12000 + disc(3) * 15);
  });

  it('a gap stops the post before the plane, a negative one passes it; a gap as large as the way is an error', () => {
    const engine = model();
    run(engine, feature('post', regions('T', [['p']]), upTo(LID('L'), 0, 0.2), 'add', ['A']));
    expect(factsOf(engine.getState(), 'post')).toMatchObject({ lengthMin: expect.closeTo(9.8, 9) });
    expect(factsOf(run(engine, { type: 'setField', feature: 'post', path: 'extent/gap', value: -1 }), 'post')).toMatchObject({ lengthMax: expect.closeTo(11, 9) });
    const far = run(engine, { type: 'setField', feature: 'post', path: 'extent/gap', value: 10 });
    expect(errorOf(far, 'post')).toMatchObject({ code: 'invalidExtent' });
    expect(errorOf(far, 'post')?.message).toMatch(/the gap of 10 mm is as large as the way to the plane/);
  });

  it('a post up to a tilted face: the volume of a cylinder cut by a plane, a tilted end cap a sketch stands on', () => {
    const engine = model();
    wedge(engine);
    const state = run(engine, feature('post', regions('T', [['p']]), upTo({ kind: 'face', body: 'W', face: UNDER }), 'add', ['A']));
    expectAllOk(state);
    // the centre at x = 10 is under z = 21: a length of 11 there, 10.7 to 11.3 over the circle
    near(volumeOf(state, 'A'), 12000 + disc(3) * 11);
    const facts = factsOf(state, 'post');
    expect(facts?.forward).toBe(true);
    expect(facts?.lengthMin).toBeLessThan(10.71);
    expect(facts?.lengthMax).toBeGreaterThan(11.29);
    const end = surface(state, cap('post')) as Extract<Surface, { kind: 'plane' }>;
    expect(end.kind).toBe('plane');
    // the normal of the underside of the wedge, up to its sign
    near(Math.abs(end.normal[0] * 40 + end.normal[2] * 4) / Math.hypot(...end.normal), 0, 1e-9);
    const onTop = run(engine, addSketch('E', onFace('A', cap('post'))), circle('E', 'h', 0, 0, 1));
    expect(onTop.evaluation.features.E.status).toBe('ok');
  });

  it('a cut down to the bottom face of its own target and a post down to a base plane, the other way', () => {
    const engine = model();
    const state = run(engine, feature('hole', regions('T', [['p']]), upTo(LID('A')), 'cut', ['A']));
    expectAllOk(state);
    expect(factsOf(state, 'hole')).toEqual({ lengthMin: 10, lengthMax: 10, forward: false });
    near(volumeOf(state, 'A'), 12000 - disc(3) * 10);
    // a sketch on XY and a plane below it: the tool runs against the normal
    const under = run(engine, { type: 'addFeature', feature: { id: 'Q', name: 'Q', suppressed: false, type: 'plane', base: XY, offset: -4 } }, addSketch('B', XY), circle('B', 'b', 60, 0, 2), feature('foot', regions('B', [['b']]), upTo({ kind: 'plane', feature: 'Q' })));
    expect(factsOf(under, 'foot')).toEqual({ lengthMin: 4, lengthMax: 4, forward: false });
    near(volumeOf(under, 'foot'), disc(2) * 4);
  });

  it('refusals: a parallel plane, a plane through the start, a face that is not planar, a face that is gone', () => {
    const engine = model();
    run(engine, feature('post', regions('T', [['p']]), upTo(LID('L')), 'add', ['A']));
    const withPlane = (plane: PlaneRef) => {
      const result = engine.preview({ type: 'updateFeature', id: 'post', patch: { extent: { plane } } });
      if (!result.ok) throw new Error(result.error.message);
      return result.state.evaluation.features.post.error;
    };
    expect(withPlane({ kind: 'face', body: 'A', face: side('A', 'ra') })).toMatchObject({ code: 'invalidExtent', message: expect.stringMatching(/parallel to the direction/) });
    expect(withPlane({ kind: 'face', body: 'A', face: cap('A') })).toMatchObject({ code: 'invalidExtent', message: expect.stringMatching(/passes through the start/) });
    // a round face before the feature: the side of a stud
    run(engine, addSketch('U', XY), circle('U', 'u', 70, 0, 2), feature('stud', regions('U', [['u']]), { type: 'distance', start: 0, distance: 5 }));
    run(engine, { type: 'moveFeature', id: 'post', index: engine.getState().document.features.length - 1 });
    expect(withPlane({ kind: 'face', body: 'stud', face: side('stud', 'u') })).toMatchObject({ code: 'nonPlanarFace' });
    // the lid suppressed: its face is not in the state before the post
    const gone = run(engine, { type: 'setSuppressed', id: 'L', suppressed: true });
    expect(errorOf(gone, 'post')).toMatchObject({ code: 'brokenReference' });
  });

  it('a pattern of posts under a tilted face: a length per copy, each end in the plane', () => {
    const engine = model();
    wedge(engine);
    const one = volumeOf(run(engine, feature('post', regions('T', [['p']]), upTo({ kind: 'face', body: 'W', face: UNDER }), 'add', ['A'])), 'A');
    const state = run(engine, {
      type: 'addFeature',
      feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'features', features: ['post'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'T', point: 'origin' }, count: 2, span: { type: 'full' } } },
    });
    expectAllOk(state);
    // the copy turned half a turn about (0, 0): its centre at x = −10, where the underside is at z = 19
    near(volumeOf(state, 'A') - one, disc(3) * 9, 2e-3);
    const copyCap = surface(state, { ...cap('post'), copy: [{ pattern: 'P', index: 1 }] }) as Extract<Surface, { kind: 'plane' }>;
    const end = surface(state, cap('post')) as Extract<Surface, { kind: 'plane' }>;
    // one plane: the same normal up to the sign, and the origin of each on the other's plane
    const along = (s: Extract<Surface, { kind: 'plane' }>, p: number[]) => (p[0] - s.origin[0]) * s.normal[0] + (p[1] - s.origin[1]) * s.normal[1] + (p[2] - s.origin[2]) * s.normal[2];
    near(along(end, copyCap.origin), 0, 1e-6);
  });

  it('a copy of a pattern that runs parallel to the plane is an error of the pattern, named by the copy', () => {
    const engine = model();
    run(engine, feature('post', regions('T', [['p']]), upTo(LID('L')), 'add', ['A']));
    const state = run(engine, {
      type: 'addFeature',
      feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'features', features: ['post'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'X' }, count: 4, span: { type: 'full' } } },
    });
    expect(errorOf(state, 'P')).toMatchObject({ code: 'invalidExtent', refs: [{ copy: 1, feature: 'post' }, LID('L')] });
  });

  it('an addition that swallows the face it ends on, and its copies, which keep the plane', () => {
    const engine = model();
    // a boss on the top of A, and a wider disc (the ring around the boss and the disc of the boss,
    // the two regions of the sketch) from the top to 1 past the top of the boss: it covers the boss
    run(engine, circle('T', 'k', 10, 15, 1), feature('boss', regions('T', [['k']]), { type: 'distance', start: 0, distance: 2 }, 'add', ['A']));
    const state = run(engine, feature('cover', regions('T', [['p'], ['k']]), upTo({ kind: 'face', body: 'A', face: cap('boss') }, 0, -1), 'add', ['A']));
    expect(state.evaluation.features.cover.status).toBe('ok');
    // the top of the boss is inside the cover and no face of the body any more
    expect(faceNames(state, 'A')).not.toContain('boss/endCap');
    const pattern = run(engine, {
      type: 'addFeature',
      feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'features', features: ['cover'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } },
    });
    // the copy measures to the plane the feature saw, not to the face, which is gone
    expect(pattern.evaluation.features.P.status).toBe('ok');
    near(volumeOf(pattern, 'A'), volumeOf(state, 'A') + disc(3) * 3, 2e-3);
  });
});

// The block B from −40 to 40 in x, −30 to 30 in y and z, and the wedge V whose underside lies in
// the plane z = x − 5 (45°, through z = 0 at x = 5); sketches on XY cut B up to that plane.
function steep(): Engine {
  const engine = newEngine();
  run(
    engine,
    addSketch('S', XY),
    rectangle('S', 'r', -40, -30, 80, 60, null),
    feature('B', regions('S', [rectLoop('r')]), { type: 'distance', start: -30, distance: 60 }),
    addSketch('X', { kind: 'base', plane: 'XZ' }),
    batch(
      { type: 'addPoint', sketch: 'X', id: 'v1', x: -20, y: -25 },
      { type: 'addPoint', sketch: 'X', id: 'v2', x: 20, y: 15 },
      { type: 'addPoint', sketch: 'X', id: 'v3', x: 20, y: 40 },
      { type: 'addPoint', sketch: 'X', id: 'v4', x: -20, y: 40 },
      { type: 'addCurve', sketch: 'X', id: 'va', curve: { type: 'line', a: 'v1', b: 'v2' } },
      { type: 'addCurve', sketch: 'X', id: 'vb', curve: { type: 'line', a: 'v2', b: 'v3' } },
      { type: 'addCurve', sketch: 'X', id: 'vc', curve: { type: 'line', a: 'v3', b: 'v4' } },
      { type: 'addCurve', sketch: 'X', id: 'vd', curve: { type: 'line', a: 'v4', b: 'v1' } },
    ),
    feature('V', regions('X', [['va', 'vb', 'vc', 'vd']]), { type: 'distance', start: 0, distance: -30 }),
    addSketch('C', XY),
  );
  return engine;
}
const SLOPE: PlaneRef = { kind: 'face', body: 'V', face: { feature: 'V', role: 'side', curve: 'va' } };
const BLOCK = 80 * 60 * 60;
const circularZ = (count: number): Command => ({
  type: 'addFeature',
  feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'features', features: ['h'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count, span: { type: 'full' } } },
});

describe('an extent up to a plane, findings of the review', () => {
  it('a tilted tool that runs against the normal: the volume, the facts, the end cap in the plane', () => {
    const engine = steep();
    const state = run(engine, circle('C', 'c', -10, 15, 2), feature('h', regions('C', [['c']]), upTo(SLOPE), 'cut', ['B']));
    expectAllOk(state);
    const facts = factsOf(state, 'h');
    expect(facts?.forward).toBe(false);
    expect(facts?.lengthMin).toBeCloseTo(13, 1);
    expect(facts?.lengthMax).toBeCloseTo(17, 1);
    near(volumeOf(state, 'B'), BLOCK - disc(2) * 15, 2e-3);
    const end = surface(state, cap('h')) as Extract<Surface, { kind: 'plane' }>;
    // the end cap lies in z = x − 5: its normal along ±(1, 0, −1)
    near(Math.abs(end.normal[0] + end.normal[2]), 0, 1e-9);
    near(end.origin[2] - (end.origin[0] - 5), 0, 1e-6);
  });

  it('a copy of a pattern on the other side of the plane runs the other way', () => {
    const engine = steep();
    run(engine, circle('C', 'c', 10, 15, 2), feature('h', regions('C', [['c']]), upTo(SLOPE), 'cut', ['B']));
    expect(factsOf(engine.getState(), 'h')?.forward).toBe(true);
    near(volumeOf(engine.getState(), 'B'), BLOCK - disc(2) * 5, 2e-3);
    // the copy at (−10, −15): the plane is at z = −15 there, below the sketch
    const state = run(engine, circularZ(2));
    expectAllOk(state);
    near(volumeOf(state, 'B'), BLOCK - disc(2) * 20, 4e-3);
    expect(run(engine, addSketch('E', onFace('B', { ...cap('h'), copy: [{ pattern: 'P', index: 1 }] }))).evaluation.features.E.status).toBe('ok');
  });

  it('a copy whose profile the plane passes through is an error of the pattern, named by the copy', () => {
    const engine = steep();
    run(engine, circle('C', 'c', 0, 5, 2), feature('h', regions('C', [['c']]), upTo(SLOPE), 'cut', ['B']));
    expect(factsOf(engine.getState(), 'h')?.forward).toBe(false);
    // the copy at (5, 0) of four: the plane z = x − 5 meets the sketch plane under it
    const state = run(engine, circularZ(4));
    expect(errorOf(state, 'P')).toMatchObject({ code: 'invalidExtent', refs: [{ copy: 3, feature: 'h' }, SLOPE] });
    expect(errorOf(state, 'P')?.message).toMatch(/passes through the start/);
  });

  it('a wall along a line up to the underside of the lid', () => {
    const engine = model();
    const state = run(
      engine,
      batch(
        { type: 'addPoint', sketch: 'T', id: 'l1', x: 5, y: 5 },
        { type: 'addPoint', sketch: 'T', id: 'l2', x: 35, y: 5 },
        { type: 'addCurve', sketch: 'T', id: 'l', curve: { type: 'line', a: 'l1', b: 'l2' } },
      ),
      feature('wall', { type: 'wall', sketch: 'T', curves: ['l'], thickness: 2 }, upTo(LID('L')), 'add', ['A']),
    );
    expectAllOk(state);
    expect(factsOf(state, 'wall')).toEqual({ lengthMin: 10, lengthMax: 10, forward: true });
    near(volumeOf(state, 'A'), 12000 + 30 * 2 * 10);
  });
});

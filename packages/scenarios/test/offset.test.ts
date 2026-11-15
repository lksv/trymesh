// D44 (package 2a of D36) in the recompute, against the real adapters: the offset of a profile of
// regions and a wall along curves of a sketch, built into bodies by the kernel.
import { describe, expect, it } from 'vitest';
import type { Command, Engine, EngineState, ExtrudeFeature, FaceName, Id, Input } from '@trymesh/engine';
import { XY, addSketch, batch, circle, expectAllOk, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, status, volume } from './kit';

type Profile = Input<ExtrudeFeature>['profile'];
const feature = (id: Id, profile: Profile, distance: number, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[], start = 0): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile, extent: { type: 'distance', start, distance }, operation, ...(targets ? { targets } : {}) },
});
const regions = (sketch: Id, loops: Id[][], offset?: number | string): Profile => ({ type: 'regions', sketch, regions: loops.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })), ...(offset === undefined ? {} : { offset }) });
const wall = (sketch: Id, curves: Id[], thickness: number | string): Profile => ({ type: 'wall', sketch, curves, thickness });
const volumeOf = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const near = (actual: number, expected: number, tolerance = 0.02) => expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThan(tolerance);
const errorOf = (state: EngineState, id: Id) => state.evaluation.features[id].error;
const surface = (state: EngineState, name: FaceName) => state.evaluation.faceSurfaces[state.evaluation.faceNames.findIndex((other) => JSON.stringify(other) === JSON.stringify(name))];
// Points and curves of a sketch at given places, held there (no constraints: the solver leaves them).
const points = (sketch: Id, at: Record<Id, [number, number]>): Command => batch(...Object.entries(at).map(([id, [x, y]]): Command => ({ type: 'addPoint', sketch, id, x, y })));
const line = (sketch: Id, id: Id, a: Id, b: Id, construction = false): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b, ...(construction ? { construction } : {}) } });

// A sketch S1 with a rectangle `r` 40 × 30 at the origin and a circle `k` of radius 4 in its middle.
function plate(): Engine {
  const engine = newEngine();
  run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), circle('S1', 'k', 20, 15, 4));
  return engine;
}
// The area of a circle as the engine builds it: a polygon inscribed with the chord tolerance 0.01.
const disc = (radius: number): number => {
  const sides = Math.ceil(Math.PI / Math.acos(1 - 0.01 / radius));
  return (sides / 2) * radius * radius * Math.sin((2 * Math.PI) / sides);
};

describe('the offset of a profile', () => {
  it('moves the outline: the outer loop grows, the hole shrinks, the side faces keep their names and surfaces', () => {
    const engine = plate();
    const state = run(engine, feature('A', regions('S1', [rectLoop('r')], 2), 10), feature('B', regions('S1', [rectLoop('r')], -2), 10, 'new', undefined, 20));
    expectAllOk(state);
    near(volumeOf(state, 'A'), (44 * 34 - disc(2)) * 10);
    near(volumeOf(state, 'B'), (36 * 26 - disc(6)) * 10);
    expect(faceNames(state, 'A')).toEqual(['A/endCap', 'A/side/k', 'A/side/ra', 'A/side/rb', 'A/side/rc', 'A/side/rd', 'A/startCap']);
    expect(surface(state, side('A', 'ra'))).toMatchObject({ kind: 'plane', origin: [expect.closeTo(-2, 6), expect.closeTo(-2, 6), 0] });
    expect(surface(state, side('A', 'k'))).toMatchObject({ kind: 'cylinder', radius: expect.closeTo(2, 6) });
    expect(surface(state, side('B', 'k'))).toMatchObject({ kind: 'cylinder', radius: expect.closeTo(6, 6) });
    expect(faceBox(state, 'A', side('A', 'rb'))).toMatchObject({ min: [42, -2, 0], max: [42, 32, 10] });
  });

  it('a sketch on a moved side face stands on the moved face: its origin is the moved start of the line', () => {
    const engine = plate();
    run(engine, feature('A', regions('S1', [rectLoop('r'), ['k']], 3), 10));
    const state = run(engine, addSketch('S2', onFace('A', side('A', 'ra'))), circle('S2', 'h', 5, 5, 1), feature('H', regions('S2', [['h']]), -2, 'cut', ['A']));
    expectAllOk(state);
    expect(state.evaluation.features.S2.plane?.origin).toEqual([expect.closeTo(-3, 6), expect.closeTo(-3, 6), 0]);
    near(volumeOf(state, 'A'), 46 * 36 * 10 - disc(1) * 2);
    // the offset follows a parameter, and the sketch on the face follows the offset
    run(engine, { type: 'setParameter', name: 'grow', expr: '1' });
    const followed = run(engine, { type: 'setField', feature: 'A', path: 'profile/offset', value: 'grow * 5' });
    expectAllOk(followed);
    expect(followed.evaluation.features.S2.plane?.origin).toEqual([expect.closeTo(-5, 6), expect.closeTo(-5, 6), 0]);
    // the value an expression gave is in the result of the feature
    expect(followed.evaluation.features.A.values).toMatchObject({ 'profile/offset': 5 });
    near(volumeOf(followed, 'A'), 50 * 40 * 10 - disc(1) * 2);
  });

  it('absent, zero and an expression that gives zero are the same body, built without an offset', () => {
    const engine = plate();
    run(engine, { type: 'setParameter', name: 'zero', expr: '0' });
    const state = run(engine, feature('A', regions('S1', [rectLoop('r')]), 10), feature('B', regions('S1', [rectLoop('r')], 0), 10), feature('C', regions('S1', [rectLoop('r')], 'zero * 3'), 10));
    expectAllOk(state);
    const bytes = (id: Id): number[] => [...state.evaluation.bodies[id].solid.positions, ...state.evaluation.bodies[id].solid.triangles];
    expect(bytes('B')).toEqual(bytes('A'));
    expect(bytes('C')).toEqual(bytes('A'));
    expect(state.document.features.find((f) => f.id === 'B')).toMatchObject({ profile: { offset: 0 } });
  });

  it('a cut by an inward offset leaves a wall: a shell from one sketch', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), { type: 'setParameter', name: 'wall', expr: '2' });
    let state = run(engine, feature('A', regions('S1', [rectLoop('r')]), 20), feature('C', regions('S1', [rectLoop('r')], '-wall'), 20, 'cut', ['A'], 2));
    expectAllOk(state);
    near(volumeOf(state, 'A'), 40 * 30 * 20 - 36 * 26 * 18);
    state = run(engine, { type: 'setParameter', name: 'wall', expr: '3' });
    expectAllOk(state);
    near(volumeOf(state, 'A'), 40 * 30 * 20 - 34 * 24 * 18);
    expect(state.evaluation.features.C.values).toMatchObject({ 'profile/offset': -3 });
  });

  it('what cannot be moved is an error of the feature that names the curves and says what to do', () => {
    const engine = plate();
    let state = run(engine, feature('A', regions('S1', [rectLoop('r')], -16), 10));
    expect(status(state)).toMatchObject({ A: 'error:invalidProfile' });
    expect(errorOf(state, 'A')).toMatchObject({ code: 'invalidProfile', refs: ['rb', 'rd'] });
    expect(errorOf(state, 'A')?.message).toBe(
      'The offset of -16 mm leaves no length for the curves "rb", "rd": their neighbours meet before them, so they vanish. Use a smaller offset or give the corners a radius larger than the offset, or draw the moved outline in the sketch and extrude that.',
    );
    expect(state.evaluation.bodies.A).toBeUndefined();
    // the hole closes
    state = run(engine, { type: 'setField', feature: 'A', path: 'profile/offset', value: 4 });
    expect(errorOf(state, 'A')).toMatchObject({ code: 'invalidProfile', refs: ['k'], message: expect.stringMatching(/^The offset of 4 mm leaves no radius for the circle "k" \(its radius is 4 mm\)\./) });
    // and what depends on the feature is a broken reference, as after any error
    state = run(engine, addSketch('S2', onFace('A', side('A', 'ra'))));
    expect(status(state)).toMatchObject({ S2: 'error:brokenReference' });
    // a smaller offset and everything is back
    state = run(engine, { type: 'updateFeature', id: 'A', patch: { profile: { offset: null } } });
    expectAllOk(state);
  });

  it('a random outline that passes hands the kernel a mesh it accepts', () => {
    // rounded rectangles with a round hole, moved by a random distance: an error of the profile, or a
    // body with the volume of the moved outline that the kernel takes into a boolean operation
    let seed = 44;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let built = 0;
    for (let round = 0; round < 24; round++) {
      const [w, h, r] = [20 + 30 * random(), 15 + 20 * random(), 1 + 4 * random()];
      const hole = 1 + 2 * random();
      const d = (random() < 0.6 ? -1 : 1) * 4 * random();
      const engine = newEngine();
      run(
        engine,
        addSketch('S1', XY),
        points('S1', { a1: [r, 0], a2: [w - r, 0], b1: [w, r], b2: [w, h - r], c1: [w - r, h], c2: [r, h], d1: [0, h - r], d2: [0, r], ca: [w - r, r], cb: [w - r, h - r], cc: [r, h - r], cd: [r, r], ck: [w / 2, h / 2] }),
        batch(
          line('S1', 'la', 'a1', 'a2'), { type: 'addCurve', sketch: 'S1', id: 'ra', curve: { type: 'arc', center: 'ca', start: 'a2', end: 'b1' } },
          line('S1', 'lb', 'b1', 'b2'), { type: 'addCurve', sketch: 'S1', id: 'rb', curve: { type: 'arc', center: 'cb', start: 'b2', end: 'c1' } },
          line('S1', 'lc', 'c1', 'c2'), { type: 'addCurve', sketch: 'S1', id: 'rc', curve: { type: 'arc', center: 'cc', start: 'c2', end: 'd1' } },
          line('S1', 'ld', 'd1', 'd2'), { type: 'addCurve', sketch: 'S1', id: 'rd', curve: { type: 'arc', center: 'cd', start: 'd2', end: 'a1' } },
          { type: 'addCurve', sketch: 'S1', id: 'k', curve: { type: 'circle', center: 'ck' }, radius: hole },
        ),
      );
      const state = run(engine, feature('A', regions('S1', [['la', 'ra', 'lb', 'rb', 'lc', 'rc', 'ld', 'rd']], d), 5));
      const what = `w ${w} h ${h} r ${r} hole ${hole} d ${d}`;
      if (state.evaluation.features.A.status === 'error') {
        expect(errorOf(state, 'A')?.code, what).toBe('invalidProfile');
        // it is refused only when a radius is used up (the corner arcs inwards, the hole outwards)
        // or when the hole, which grows as the outline shrinks, reaches the outline
        expect(d <= -r + 1e-6 || d >= hole - 1e-6 || 2 * (hole - d) >= Math.min(w, h) + 2 * d - 0.05, what).toBe(true);
        continue;
      }
      const exact = (w + 2 * d) * (h + 2 * d) - (4 - Math.PI) * (r + d) ** 2 - Math.PI * (hole - d) ** 2;
      expect(Math.abs(volumeOf(state, 'A') - exact * 5), what).toBeLessThan(0.02 * 5 * 2 * Math.PI * (r + hole + 8));
      // the kernel takes the body into a boolean operation: a block cut out of its middle
      const cut = run(engine, addSketch('S2', XY), rectangle('S2', 'q', w / 2 - 1, -10, 2, h + 20, null), feature('Q', regions('S2', [rectLoop('q')]), 5, 'cut', ['A'], 2));
      expect(status(cut), what).toMatchObject({ A: 'ok', Q: 'ok' });
      expect(volumeOf(cut, 'A'), what).toBeLessThan(volumeOf(state, 'A'));
      built++;
    }
    expect(built).toBeGreaterThan(10);
  });
});

describe('a wall along curves of a sketch', () => {
  // A sketch W with construction lines: `ab` and `bc` (an L), an arc `bend` that goes on from c
  // tangent to `bc`, a line apart from them and a circle `ring`.
  function lines(): Engine {
    const engine = newEngine();
    run(
      engine,
      addSketch('W', XY),
      points('W', { a: [0, 0], b: [20, 0], c: [20, 10], o: [10, 10], e: [10, 20], far: [60, 0], far2: [70, 0], m: [50, 30] }),
      batch(
        line('W', 'ab', 'a', 'b', true),
        line('W', 'bc', 'b', 'c', true),
        { type: 'addCurve', sketch: 'W', id: 'bend', curve: { type: 'arc', center: 'o', start: 'c', end: 'e', construction: true } },
        line('W', 'apart', 'far', 'far2', true),
        { type: 'addCurve', sketch: 'W', id: 'ring', curve: { type: 'circle', center: 'm', construction: true }, radius: 8 },
      ),
    );
    return engine;
  }
  const wallSide = (feature: Id, curve: Id, which: 'left' | 'right'): FaceName => ({ feature, role: 'wallSide', curve, side: which });
  const wallEnd = (feature: Id, point: Id): FaceName => ({ feature, role: 'wallEnd', point });

  it('one line: a bar with two sides, two ends and two caps; a construction line that closes no region', () => {
    const engine = lines();
    const state = run(engine, feature('R', wall('W', ['ab'], 2), 5));
    expectAllOk(state);
    near(volumeOf(state, 'R'), 20 * 2 * 5, 1e-3);
    expect(faceNames(state, 'R')).toEqual(['R/endCap', 'R/startCap', 'R/wallEnd/a', 'R/wallEnd/b', 'R/wallSide/ab/left', 'R/wallSide/ab/right']);
    // left of the line from a to b is +y
    expect(faceBox(state, 'R', wallSide('R', 'ab', 'left'))).toMatchObject({ min: [0, 1, 0], max: [20, 1, 5] });
    expect(faceBox(state, 'R', wallSide('R', 'ab', 'right'))).toMatchObject({ min: [0, -1, 0], max: [20, -1, 5] });
    expect(faceBox(state, 'R', wallEnd('R', 'b'))).toMatchObject({ min: [20, -1, 0], max: [20, 1, 5] });
    expect(surface(state, wallSide('R', 'ab', 'left'))).toMatchObject({ kind: 'plane' });
  });

  it('an L and a bend: mitred corners, a cylinder on both sides of the arc; the thickness is a field', () => {
    const engine = lines();
    let state = run(engine, feature('R', wall('W', ['ab', 'bc', 'bend'], 2), 5));
    expectAllOk(state);
    // the centre line is 20 + 10 + a quarter of a circle of radius 10; a right-angled mitre and
    // a tangent joint keep the area of a band
    near(volumeOf(state, 'R'), (30 * 2 + (Math.PI / 4) * (121 - 81)) * 5, 0.2);
    expect(faceNames(state, 'R')).toEqual([
      'R/endCap', 'R/startCap', 'R/wallEnd/a', 'R/wallEnd/e',
      'R/wallSide/ab/left', 'R/wallSide/ab/right', 'R/wallSide/bc/left', 'R/wallSide/bc/right', 'R/wallSide/bend/left', 'R/wallSide/bend/right',
    ]);
    // the arc runs counter-clockwise from c to e around o: left is the side of the centre
    expect(surface(state, wallSide('R', 'bend', 'left'))).toMatchObject({ kind: 'cylinder', radius: expect.closeTo(9, 6) });
    expect(surface(state, wallSide('R', 'bend', 'right'))).toMatchObject({ kind: 'cylinder', radius: expect.closeTo(11, 6) });
    state = run(engine, { type: 'setParameter', name: 't', expr: '2' }, { type: 'setField', feature: 'R', path: 'profile/thickness', value: 't * 2' });
    expectAllOk(state);
    expect(state.evaluation.features.R.values).toMatchObject({ 'profile/thickness': 4 });
    near(volumeOf(state, 'R'), (30 * 4 + (Math.PI / 4) * (144 - 64)) * 5, 0.4);
  });

  it('a circle: a ring with its outside on the right of the circle', () => {
    const engine = lines();
    const state = run(engine, feature('R', wall('W', ['ring'], 2), 5));
    expectAllOk(state);
    near(volumeOf(state, 'R'), (disc(9) - disc(7)) * 5, 0.05);
    expect(faceNames(state, 'R')).toEqual(['R/endCap', 'R/startCap', 'R/wallSide/ring/left', 'R/wallSide/ring/right']);
    expect(surface(state, wallSide('R', 'ring', 'right'))).toMatchObject({ kind: 'cylinder', radius: expect.closeTo(9, 6) });
    expect(surface(state, wallSide('R', 'ring', 'left'))).toMatchObject({ kind: 'cylinder', radius: expect.closeTo(7, 6) });
  });

  it('a rib added to a body, a sketch on its side and on its end, and a pattern of it', () => {
    const engine = lines();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', -30, -30, 100, 80, null), feature('A', regions('S1', [rectLoop('r')]), -4));
    let state = run(engine, feature('R', wall('W', ['ab', 'bc'], 2), 6, 'add', ['A']));
    expectAllOk(state);
    near(volumeOf(state, 'A'), 100 * 80 * 4 + 30 * 2 * 6, 1e-2);
    // a sketch on a side of the rib and one on its end
    state = run(engine, addSketch('S2', onFace('A', wallSide('R', 'ab', 'left'))), addSketch('S3', onFace('A', wallEnd('R', 'c'))));
    expectAllOk(state);
    expect(state.evaluation.features.S2.plane?.normal).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9), expect.closeTo(0, 9)]);
    expect(state.evaluation.features.S3.plane?.normal).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9), expect.closeTo(0, 9)]);
    // a hole through the rib from its side (the x axis of the sketch on that face runs against the line)
    state = run(engine, circle('S2', 'h', -5, 3, 1), feature('H', regions('S2', [['h']]), -2, 'cut', ['A']));
    expectAllOk(state);
    near(volumeOf(state, 'A'), 100 * 80 * 4 + 30 * 2 * 6 - disc(1) * 2, 1e-2);
    // the rib repeated around the z axis: the faces of the copy carry the tag of the pattern
    state = run(engine, { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'features', features: ['R'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } });
    expectAllOk(state);
    expect(faceNames(state, 'A')).toContain('R/wallSide/bc/right@P:1');
    expect(faceNames(state, 'A')).toContain('R/wallEnd/c@P:1');
    // the copy turned by half a turn starts where the rib starts: the two ends at `a` meet and are inside the body
    expect(faceNames(state, 'A').filter((name) => name.startsWith('R/wallEnd/a'))).toEqual([]);
  });

  it('curves that are not one chain, a bend the wall does not fit, a curve that is gone', () => {
    const engine = lines();
    let state = run(engine, feature('R', wall('W', ['ab', 'apart'], 2), 5));
    expect(errorOf(state, 'R')).toMatchObject({ code: 'invalidProfile', refs: ['ab', 'apart'] });
    expect(errorOf(state, 'R')?.message).toBe('The curves of the wall are not connected: "apart" is not joined to the chain of "ab". A wall follows one chain of curves: each joined to the next at an end point, without a branch.');
    // the arc has a radius of 10: a wall 20 thick leaves its inner side nothing
    state = run(engine, { type: 'updateFeature', id: 'R', patch: { profile: { curves: ['bc', 'bend'], thickness: 20 } } });
    expect(errorOf(state, 'R')).toMatchObject({ code: 'invalidProfile', refs: ['bend'], message: expect.stringMatching(/^The wall 20 mm thick leaves no radius for the arc "bend" .* Make the wall thinner or its bends wider/) });
    state = run(engine, { type: 'updateFeature', id: 'R', patch: { profile: { thickness: 2 } } });
    expectAllOk(state);
    // the curve removed from the sketch: a broken reference that names it
    state = run(engine, { type: 'removeEntity', sketch: 'W', id: 'bend' });
    expect(errorOf(state, 'R')).toMatchObject({ code: 'brokenReference', refs: ['bend'] });
    // a curve that is not in the sketch is refused by the command
    expect(engine.execute({ type: 'updateFeature', id: 'R', patch: { profile: { curves: ['bc', 'nope'] } } })).toMatchObject({ ok: false });
  });

  it('a wall does not need a valid profile of the sketch: its line may end on another curve', () => {
    const engine = newEngine();
    // a rectangle and a line (not a construction line) that ends in the middle of its bottom side
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), points('S1', { t1: [20, 0], t2: [20, 15] }), line('S1', 'stem', 't1', 't2'));
    run(engine, { type: 'addConstraint', sketch: 'S1', id: 'on', constraint: { type: 'pointOnCurve', point: 't1', curve: 'ra' } });
    const state = run(engine, feature('A', regions('S1', [rectLoop('r')]), 4), feature('R', wall('S1', ['stem'], 2), 4));
    // the regions of the sketch are invalid (the line touches the side where they are not joined), the wall stands
    expect(status(state)).toMatchObject({ A: 'error:invalidProfile', R: 'ok' });
    near(volumeOf(state, 'R'), 15 * 2 * 4, 1e-3);
  });
});

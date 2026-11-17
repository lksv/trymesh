// D66 (package 2h of D36) in the recompute, against the real adapters: the start of an extent at
// a plane or a planar face. A boss, a pocket, a cut and a hole from a face equal the same features
// with the start written as a number; "through all" from a start; `from` with `upTo`, a taper,
// a wall and a generated profile; the refusals; the start follows the model; a copy of a pattern
// carries its start; the guards of a hole whose mouth is far from its targets.
import { describe, expect, it } from 'vitest';
import type { Command, Engine, EngineState, ExtrudeFeature, FaceName, HoleFeature, Id, Input, PlaneRef, Surface } from '@trymesh/engine';
import { XY, addSketch, batch, cap, circle, expectAllOk, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, volume } from './kit';

type Profile = Input<ExtrudeFeature>['profile'];
type Extent = Input<ExtrudeFeature>['extent'];
const feature = (id: Id, profile: Profile, extent: Extent, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile, extent, operation, ...(targets ? { targets } : {}) },
});
const hole = (id: Id, extent: Input<HoleFeature>['extent'], shape: Input<HoleFeature>['shape'] = { type: 'counterbore', diameter: 3.4, headDiameter: 6, headDepth: 3 }, targets: Id[] = ['A']): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'hole', sketch: 'S', points: ['h'], shape, extent, targets },
});
const regions = (sketch: Id, loops: Id[][]): Profile => ({ type: 'regions', sketch, regions: loops.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) });
const plane = (id: Id, offset: number | string, extra: object = {}): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset, ...extra } as never });
const pattern = (id: Id, features: Id[], transform: object): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'pattern', source: { type: 'features', features }, transform } as never });
const volumeOf = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const near = (actual: number | undefined, expected: number, tolerance = 1e-3) => expect(Math.abs((actual ?? NaN) - expected), `${actual} is not near ${expected}`).toBeLessThan(tolerance);
const surface = (state: EngineState, name: FaceName): Surface => state.evaluation.faceSurfaces[state.evaluation.faceNames.findIndex((other) => JSON.stringify(other) === JSON.stringify(name))];
const levelOf = (state: EngineState, name: FaceName): number | undefined => {
  const found = surface(state, name);
  return found?.kind === 'plane' ? found.origin[2] : undefined;
};
const errorOf = (state: EngineState, id: Id) => state.evaluation.features[id].error;
const factsOf = (state: EngineState, id: Id) => state.evaluation.features[id].facts;
const preview = (engine: Engine, ...commands: Command[]): EngineState => {
  const result = engine.preview(commands.length === 1 ? commands[0] : batch(...commands));
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
};
const TOP: PlaneRef = onFace('A', cap('A'));
const CIRCLE = regions('S', [['p']]);
const disc = (radius: number): number => {
  const sides = Math.ceil((2 * Math.PI) / (2 * Math.acos(1 - 0.01 / radius)) - 1e-9);
  return (sides / 2) * radius * radius * Math.sin((2 * Math.PI) / sides);
};

// The plate A, 40 × 30 × `t` (10) from the sketch S on XY, with a circle `p` of radius 3 at
// (10, 15), a circle `q` of radius 2 at (30, 15) and a point `h` at (30, 15) in its sketch; the plane
// feature P at `t`, the height of the top.
function model(): Engine {
  const engine = newEngine();
  run(
    engine,
    { type: 'setParameter', name: 't', expr: '10' },
    addSketch('S', XY),
    rectangle('S', 'r', 0, 0, 40, 30),
    circle('S', 'p', 10, 15, 3),
    circle('S', 'q', 30, 15, 2),
    batch({ type: 'addPoint', sketch: 'S', id: 'h', x: 25, y: 8 }, { type: 'addConstraint', sketch: 'S', id: 'hFix', constraint: { type: 'fixed', point: 'h', x: 25, y: 8 } }),
    feature('A', regions('S', [rectLoop('r'), ['p'], ['q']]), { type: 'distance', start: 0, distance: 't' }),
    plane('P', 't'),
  );
  return engine;
}
// The same feature on a fresh model with the start written as a number, for comparison.
function numeric(command: Command): EngineState {
  return run(model(), command);
}

describe('the start of an extent at a plane: equal to the same start written as a number', () => {
  it('a boss from the top face, from a plane feature and from a base plane: the mesh and the faces of a numeric start', () => {
    const expected = numeric(feature('B', CIRCLE, { type: 'distance', start: 10, distance: 5 }, 'add', ['A']));
    for (const [from, start] of [
      [TOP, 0],
      [{ kind: 'plane', feature: 'P' }, 0],
      [XY, 10],
    ] as [PlaneRef, number][]) {
      const state = run(model(), feature('B', CIRCLE, { type: 'distance', from, start, distance: 5 }, 'add', ['A']));
      expectAllOk(state);
      expect(Array.from(state.evaluation.bodies.A.solid.positions)).toEqual(Array.from(expected.evaluation.bodies.A.solid.positions));
      expect(faceNames(state, 'A')).toEqual(faceNames(expected, 'A'));
      expect(factsOf(state, 'B')).toEqual({ startLevel: 10 });
    }
    // without `from`, no fact
    expect(factsOf(expected, 'B')).toBeUndefined();
  });

  it('a pocket under the top: 0.6 down from the face, 3 deep; a cavity closed by a skin', () => {
    const expected = numeric(feature('K', regions('S', [['q']]), { type: 'distance', start: 9.4, distance: -3 }, 'cut', ['A']));
    const state = run(model(), feature('K', regions('S', [['q']]), { type: 'distance', from: TOP, start: -0.6, distance: -3 }, 'cut', ['A']));
    expectAllOk(state);
    expect(Array.from(state.evaluation.bodies.A.solid.positions)).toEqual(Array.from(expected.evaluation.bodies.A.solid.positions));
    near(factsOf(state, 'K')?.startLevel as number, 9.4, 1e-12);
    near(volumeOf(state, 'A'), 12000 - disc(2) * 3);
  });

  it('a taper from the face, a wall from the face, a generated profile from the face', () => {
    const taper: Extent = { type: 'distance', start: 10, distance: 5, taper: 'deg(-10)' };
    const tapered = numeric(feature('B', CIRCLE, taper, 'add', ['A']));
    const fromTop = run(model(), feature('B', CIRCLE, { ...taper, start: 0, from: TOP }, 'add', ['A']));
    expectAllOk(fromTop);
    expect(Array.from(fromTop.evaluation.bodies.A.solid.positions)).toEqual(Array.from(tapered.evaluation.bodies.A.solid.positions));
    expect(surface(fromTop, side('B', 'p'))).toEqual(surface(tapered, side('B', 'p')));
    // a wall along a line of another sketch
    const wallSketch = [addSketch('W', XY), batch({ type: 'addPoint', sketch: 'W', id: 'w1', x: 5, y: 5 }, { type: 'addPoint', sketch: 'W', id: 'w2', x: 35, y: 5 }, { type: 'addCurve', sketch: 'W', id: 'w', curve: { type: 'line', a: 'w1', b: 'w2' } })];
    const wall = (extent: Extent): Command => feature('R', { type: 'wall', sketch: 'W', curves: ['w'], thickness: 2 }, extent, 'add', ['A']);
    const ribs = [run(model(), ...wallSketch, wall({ type: 'distance', start: 10, distance: 3 })), run(model(), ...wallSketch, wall({ type: 'distance', from: TOP, start: 0, distance: 3 }))];
    expectAllOk(ribs[1]);
    expect(Array.from(ribs[1].evaluation.bodies.A.solid.positions)).toEqual(Array.from(ribs[0].evaluation.bodies.A.solid.positions));
    // a pulley of the catalog standing on the plate, a body of its own
    const pulley = (extent: Extent): Command => feature('G', { type: 'generated', generator: 'gt2Pulley', sketch: 'S', operands: { center: 'h' }, params: { teeth: 12 } } as never, extent);
    const pulleys = [numeric(pulley({ type: 'distance', start: 10, distance: 4 })), run(model(), pulley({ type: 'distance', from: TOP, start: 0, distance: 4 }))];
    expectAllOk(pulleys[1]);
    expect(Array.from(pulleys[1].evaluation.bodies.G.solid.positions)).toEqual(Array.from(pulleys[0].evaluation.bodies.G.solid.positions));
    expect(factsOf(pulleys[1], 'G')).toMatchObject({ startLevel: 10 });
  });
});

describe('"through all" and a hole from a face', () => {
  it('a cut through all from the top of the plate upward cuts the lid above and nothing between the sketch and the face', () => {
    const engine = model();
    run(engine, feature('L', regions('S', [rectLoop('r'), ['p'], ['q']]), { type: 'distance', start: 20, distance: 3 }));
    const state = run(engine, feature('C', CIRCLE, { type: 'throughAll', side: 'forward', from: TOP }, 'cut', ['A', 'L']));
    near(volumeOf(state, 'A'), 12000);
    near(volumeOf(state, 'L'), 3600 - disc(3) * 3);
    // the plate is the target the tool missed
    expect(state.evaluation.features.C.warnings.map((warning) => [warning.code, warning.refs])).toEqual([['noEffect', ['A']]]);
    expect(factsOf(state, 'C')).toEqual({ startLevel: 10 });
    // without `from` the same cut goes through the plate too
    const through = preview(engine, { type: 'updateFeature', id: 'C', patch: { extent: { from: null } } });
    near(volumeOf(through, 'A'), 12000 - disc(3) * 10);
  });

  it('a counterbore through all from the top of a plate whose sketch is at the bottom: the head at the top, the depth from the mouth', () => {
    const engine = model();
    const state = run(engine, hole('H', { type: 'throughAll', side: 'backward', from: TOP }));
    expectAllOk(state);
    expect(factsOf(state, 'H')).toMatchObject({ headDepth: 3, depth: expect.closeTo(10, 5), startLevel: 10 });
    near(levelOf(state, { feature: 'H', role: 'holeSeat' }), 7, 1e-6);
    // a distance from the face: the mouth 0.5 under the top, 4 deep
    const blind = preview(engine, { type: 'updateFeature', id: 'H', patch: { extent: { type: 'distance', from: TOP, start: -0.5, distance: -4 } } });
    expect(factsOf(blind, 'H')).toEqual({ headDepth: 3, depth: 4, startLevel: 9.5 });
    near(levelOf(blind, { feature: 'H', role: 'holeSeat' }), 6.5, 1e-6);
  });

  it('a counterbore from the top of a plate thinner than its head is refused: the head reaches no bore', () => {
    const engine = model();
    run(engine, { type: 'setParameter', name: 't', expr: '2' });
    const state = run(engine, hole('H', { type: 'throughAll', side: 'backward', from: TOP }));
    expect(errorOf(state, 'H')).toMatchObject({ code: 'invalidHole', message: expect.stringMatching(/the head is 3 mm deep and the targets reach only 2 mm from the mouth/) });
  });

  it('"through all" from a start 500 above the sketch: the overshoot follows the start and still clears the target', () => {
    const engine = model();
    const state = run(engine, plane('High', 500), feature('C', CIRCLE, { type: 'throughAll', side: 'backward', from: { kind: 'plane', feature: 'High' } }, 'cut', ['A']));
    expectAllOk(state);
    near(volumeOf(state, 'A'), 12000 - disc(3) * 10);
    expect(factsOf(state, 'C')).toEqual({ startLevel: 500 });
  });
});

describe('the start with upTo', () => {
  it('from the top of the plate up to a plane: the lengths from the effective start; the end plane as the start is refused at 0, a tool of 2 at -2', () => {
    const engine = model();
    const state = run(engine, plane('L', 20), feature('post', CIRCLE, { type: 'upTo', from: TOP, start: 0, plane: { kind: 'plane', feature: 'L' } }, 'add', ['A']));
    expectAllOk(state);
    expect(factsOf(state, 'post')).toEqual({ lengthMin: 10, lengthMax: 10, forward: true, startLevel: 10 });
    near(volumeOf(state, 'A'), 12000 + disc(3) * 10);
    const same = (start: number) => preview(engine, { type: 'updateFeature', id: 'post', patch: { extent: { type: 'upTo', from: { kind: 'plane', feature: 'L' }, start, plane: { kind: 'plane', feature: 'L' } } } });
    expect(errorOf(same(0), 'post')).toMatchObject({ code: 'invalidExtent', refs: [{ kind: 'plane', feature: 'L' }], message: expect.stringMatching(/passes through the start/) });
    expect(factsOf(same(-2), 'post')).toEqual({ lengthMin: 2, lengthMax: 2, forward: true, startLevel: 18 });
  });
});

describe('the refusals of a start plane', () => {
  it('a side wall, a plane 0.005 rad off the direction, a round face, a face that is gone', () => {
    const engine = model();
    // a stud beside the plate, whose side is round
    run(engine, feature('stud', regions('S', [['q']]), { type: 'distance', start: 0, distance: 15 }));
    run(engine, feature('B', CIRCLE, { type: 'distance', from: TOP, start: 0, distance: 5 }, 'add', ['A']), feature('K', CIRCLE, { type: 'distance', from: onFace('A', cap('B')), start: 0, distance: -2 }, 'cut', ['A']));
    const withFrom = (from: PlaneRef, ...before: Command[]) => preview(engine, ...before, { type: 'updateFeature', id: 'B', patch: { extent: { from } } });
    expect(errorOf(withFrom(onFace('A', side('A', 'ra'))), 'B')).toMatchObject({ code: 'invalidExtent', refs: [onFace('A', side('A', 'ra'))], message: expect.stringMatching(/start plane is parallel to the direction of the extrusion/) });
    const steep = withFrom({ kind: 'plane', feature: 'steep' }, { ...(plane('steep', 0, { tilt: { axis: { kind: 'base', axis: 'X' }, angle: Math.PI / 2 - 0.005 } }) as { feature: object }), index: 2 } as Command);
    expect(errorOf(steep, 'B')).toMatchObject({ code: 'invalidExtent', message: expect.stringMatching(/within 0\.01 rad/) });
    expect(errorOf(withFrom(onFace('stud', side('stud', 'q'))), 'B')).toMatchObject({ code: 'nonPlanarFace', refs: [onFace('stud', side('stud', 'q'))] });
    // the boss suppressed or removed: the top the cut starts at is not there
    expect(errorOf(preview(engine, { type: 'setSuppressed', id: 'B', suppressed: true }), 'K')).toMatchObject({ code: 'brokenReference', refs: [onFace('A', cap('B'))] });
    expect(errorOf(preview(engine, { type: 'removeFeature', id: 'B' }), 'K')).toMatchObject({ code: 'brokenReference' });
  });

  it('a plane tilted by 1e-6 rad under a profile 1000 from the origin: refused when the level spreads by more than 1e-6 over it, built when not', () => {
    const engine = newEngine();
    run(engine, addSketch('S', XY), circle('S', 'big', 0, 1000, 1), circle('S', 'small', 0, 1100, 0.4), plane('slant', 5, { tilt: { axis: { kind: 'base', axis: 'X' }, angle: 1e-6 } }));
    const state = run(engine, feature('bigX', regions('S', [['big']]), { type: 'distance', from: { kind: 'plane', feature: 'slant' }, start: 0, distance: 2 }), feature('smallX', regions('S', [['small']]), { type: 'distance', from: { kind: 'plane', feature: 'slant' }, start: 0, distance: 2 }));
    expect(errorOf(state, 'bigX')).toMatchObject({ code: 'invalidExtent', message: expect.stringMatching(/tilted against the sketch plane by 1e-6 rad: its level differs by 2e-6 mm/) });
    expect(state.evaluation.features.smallX.status).toBe('ok');
    // the level under the small circle: 5 ± 1100 · tan(1e-6), far from the origin of the sketch
    near(Math.abs((factsOf(state, 'smallX')?.startLevel as number) - 5), 1100e-6, 1e-6);
  });
});

describe('the start follows the model', () => {
  it('a thicker plate, and a post whose length is the way to a lid', () => {
    const engine = model();
    run(engine, { type: 'setParameter', name: 'lid', expr: '20' }, plane('L', 'lid'), feature('post', CIRCLE, { type: 'upTo', from: TOP, start: 0, plane: { kind: 'plane', feature: 'L' } }, 'add', ['A']));
    // a cap on the top of the post, a body of its own
    const state = run(engine, feature('cap', CIRCLE, { type: 'distance', from: onFace('A', cap('post')), start: 0, distance: 1 }));
    expect(factsOf(state, 'cap')).toEqual({ startLevel: 20 });
    expect(factsOf(preview(engine, { type: 'setParameter', name: 't', expr: '12' }), 'post')).toMatchObject({ lengthMin: 8, startLevel: 12 });
    expect(factsOf(preview(engine, { type: 'setParameter', name: 'lid', expr: '25' }), 'cap')).toEqual({ startLevel: 25 });
  });
});

describe('a copy of a pattern carries its start', () => {
  it('a layer stacked along the normal: the copies follow the layer below only when the spacing is its thickness', () => {
    const engine = newEngine();
    run(engine, { type: 'setParameter', name: 'th', expr: '3' }, addSketch('S', XY), rectangle('S', 'r', 0, 0, 40, 30), feature('A', regions('S', [rectLoop('r')]), { type: 'distance', start: 0, distance: 10 }));
    run(engine, feature('layer', regions('S', [rectLoop('r')]), { type: 'distance', from: TOP, start: 0, distance: 'th' }, 'add', ['A']));
    const stack = run(engine, pattern('stack', ['layer'], { type: 'linear', direction: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'spacing', spacing: 'th' } }));
    expectAllOk(stack);
    near(volumeOf(stack, 'A'), 1200 * 19);
    near(levelOf(stack, { feature: 'layer', role: 'endCap', copy: [{ pattern: 'stack', index: 2 }] }), 19, 1e-6);
    // a spacing other than the thickness: the copy 1 starts at 15, 2 above the layer below
    const apart = preview(engine, { type: 'setField', feature: 'stack', path: 'transform/span/spacing', value: 5 });
    near(levelOf(apart, { feature: 'layer', role: 'startCap', copy: [{ pattern: 'stack', index: 1 }] }), 15, 1e-6);
  });

  it('a circle of pockets about the normal keeps their floors; a boss mirrored in the middle of the plate starts at its underside', () => {
    const engine = model();
    run(engine, feature('K', regions('S', [['q']]), { type: 'distance', from: TOP, start: 0, distance: -2 }, 'cut', ['A']));
    const turned = preview(engine, pattern('ring', ['K'], { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'S', point: 'h' }, count: 4, span: { type: 'full' } }));
    expect(turned.evaluation.features.ring.status).toBe('ok');
    for (const index of [1, 2, 3]) near(levelOf(turned, { feature: 'K', role: 'endCap', copy: [{ pattern: 'ring', index }] }), 8, 1e-6);
    run(engine, feature('B', CIRCLE, { type: 'distance', from: TOP, start: 0, distance: 5 }, 'add', ['A']));
    const mirrored = run(engine, plane('mid', 't / 2'), pattern('flip', ['B'], { type: 'mirror', plane: { kind: 'plane', feature: 'mid' } }));
    expectAllOk(mirrored);
    near(levelOf(mirrored, { feature: 'B', role: 'startCap', copy: [{ pattern: 'flip', index: 1 }] }), 0, 1e-6);
    near(levelOf(mirrored, { feature: 'B', role: 'endCap', copy: [{ pattern: 'flip', index: 1 }] }), -5, 1e-6);
  });

  it('a cut from the top of the plate up to the top of a lid, mirrored in the middle of the plate, runs from the underside up through the plate', () => {
    const engine = model();
    run(engine, feature('lid', regions('S', [rectLoop('r'), ['p'], ['q']]), { type: 'distance', start: 20, distance: 3 }), plane('L', 23));
    const once = run(engine, feature('bore', CIRCLE, { type: 'upTo', from: TOP, start: 0, plane: { kind: 'plane', feature: 'L' } }, 'cut', ['A', 'lid']));
    near(volumeOf(once, 'A'), 12000);
    near(volumeOf(once, 'lid'), 3600 - disc(3) * 3);
    // the copy starts at the image of the top, the underside of the plate, and ends at the same lid
    const state = run(engine, plane('mid', 't / 2'), pattern('flip', ['bore'], { type: 'mirror', plane: { kind: 'plane', feature: 'mid' } }));
    expect(state.evaluation.features.flip.error).toBeUndefined();
    near(volumeOf(state, 'A'), 12000 - disc(3) * 10);
    near(volumeOf(state, 'lid'), 3600 - disc(3) * 3);
  });
});

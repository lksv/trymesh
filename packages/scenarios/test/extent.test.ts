// D35 point 2 in the recompute, against the real adapters: a cut through all and a cut with several
// target bodies.
import { describe, expect, it } from 'vitest';
import type { Command, Engine, EngineState, ExtrudeFeature, Id } from '@trymesh/engine';
import { XY, addExtrude, addSketch, cap, circle, expectAllOk, extrude, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, status, volume } from './kit';

type Side = 'forward' | 'backward' | 'both';
const through = (id: Id, sketch: Id, curves: Id[][], side: Side, targets: Id[]): ExtrudeFeature => ({ ...extrude(id, sketch, curves, 1, 'cut'), extent: { type: 'throughAll', side }, targets });
const addThrough = (...args: Parameters<typeof through>): Command => ({ type: 'addFeature', feature: through(...args) });
const span = (id: Id, sketch: Id, curves: Id[][], start: number, distance: number, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { ...extrude(id, sketch, curves, distance, operation), extent: { type: 'distance', start, distance }, ...(targets ? { targets } : {}) },
});
const volumeOf = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const zRange = (state: EngineState, body: Id): number[] => {
  const p = state.evaluation.bodies[body].solid.positions;
  let [low, high] = [Infinity, -Infinity];
  for (let i = 2; i < p.length; i += 3) [low, high] = [Math.min(low, p[i]), Math.max(high, p[i])];
  return [low, high];
};
// Area of a circle as the engine builds it: a polygon inscribed with the chord tolerance 0.01.
const disc = (radius: number): number => {
  const sides = Math.ceil(Math.PI / Math.acos(1 - 0.01 / radius));
  return (sides / 2) * radius * radius * Math.sin((2 * Math.PI) / sides);
};
const HOLE = disc(4);
const near = (actual: number, expected: number, tolerance = 0.02) => expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThan(tolerance);

// A plate 40 × 30 from z = `start` with the given thickness, and a sketch S2 in the XY plane with
// a circle `k` of radius 4 in the middle of the plate.
function plate(start: number, thickness: number): Engine {
  const engine = newEngine();
  run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), span('A', 'S1', [rectLoop('r')], start, thickness), addSketch('S2', XY), circle('S2', 'k', 20, 15, 4));
  return engine;
}

describe('a cut through all', () => {
  it('goes through the whole target and follows a change of its thickness', () => {
    const engine = plate(0, 10);
    let state = run(engine, addThrough('H', 'S2', [['k']], 'forward', ['A']));
    expectAllOk(state);
    near(volumeOf(state, 'A'), 12000 - HOLE * 10);
    // a through hole has no caps: only its side is a face of the body
    expect(faceNames(state, 'A').filter((name) => name.startsWith('H/'))).toEqual(['H/side/k']);
    expect(zRange(state, 'A')).toEqual([0, 10]);

    for (const thickness of [25, 0.5, 300]) {
      state = run(engine, { type: 'updateFeature', id: 'A', patch: { extent: { distance: thickness } } });
      expectAllOk(state);
      near(volumeOf(state, 'A'), (1200 - HOLE) * thickness, 0.02 + 1e-4 * thickness);
      expect(faceNames(state, 'A').filter((name) => name.startsWith('H/'))).toEqual(['H/side/k']);
      expect(zRange(state, 'A')).toEqual([0, thickness]);
    }
    // undo restores the model, save and load give the same one
    engine.undo();
    near(volumeOf(engine.getState(), 'A'), (1200 - HOLE) * 0.5);
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.save()).toBe(engine.save());
    expect(other.getState().evaluation).toEqual(engine.getState().evaluation);
  });

  it('the side: forward is along the normal of the sketch plane, backward against it, both on both sides', () => {
    // the sketch plane cuts the plate at 4 mm of its 10 mm
    const cut = (side: Side): EngineState => run(plate(-4, 10), addThrough('H', 'S2', [['k']], side, ['A']));
    const forward = cut('forward');
    expectAllOk(forward);
    near(volumeOf(forward, 'A'), 12000 - HOLE * 6);
    // a blind hole from the plane up: its bottom is the start cap in the sketch plane
    expect(faceNames(forward, 'A').filter((name) => name.startsWith('H/'))).toEqual(['H/side/k', 'H/startCap']);
    expect(faceBox(forward, 'A', cap('H', 'startCap'))).toMatchObject({ min: [expect.anything(), expect.anything(), 0], max: [expect.anything(), expect.anything(), 0] });

    const backward = cut('backward');
    expectAllOk(backward);
    near(volumeOf(backward, 'A'), 12000 - HOLE * 4);
    expect(faceNames(backward, 'A').filter((name) => name.startsWith('H/'))).toEqual(['H/side/k', 'H/startCap']);

    const both = cut('both');
    expectAllOk(both);
    near(volumeOf(both, 'A'), 12000 - HOLE * 10);
    expect(faceNames(both, 'A').filter((name) => name.startsWith('H/'))).toEqual(['H/side/k']);
  });

  it('on a face the normal points out of the body: an ordinary hole is backward, forward has no effect', () => {
    const engine = plate(0, 10);
    run(engine, addSketch('S3', onFace('A', cap('A'))), circle('S3', 'q', 10, 10, 3));
    const hole = run(engine, addThrough('H', 'S3', [['q']], 'backward', ['A']));
    expectAllOk(hole);
    near(volumeOf(hole, 'A'), 12000 - disc(3) * 10);
    const missed = run(engine, { type: 'updateFeature', id: 'H', patch: { extent: { side: 'forward' } } });
    expect(status(missed).H).toBe('warning:noEffect');
    expect(missed.evaluation.features.H.warnings[0].refs).toEqual(['A']);
    expect(volumeOf(missed, 'A')).toBeCloseTo(12000, 6);
    // both sides from a face is the same hole
    const both = run(engine, { type: 'updateFeature', id: 'H', patch: { extent: { side: 'both' } } });
    expectAllOk(both);
    near(volumeOf(both, 'A'), 12000 - disc(3) * 10);
  });

  it('takes the extent of the whole body, not only of the part under the profile', () => {
    // a step: 10 mm thick with a 30 mm high boss in one corner; the hole is under the thin part
    const engine = plate(0, 10);
    run(engine, addSketch('S3', XY), rectangle('S3', 'b', 0, 0, 8, 8), span('Boss', 'S3', [rectLoop('b')], 10, 30, 'add', ['A']));
    const state = run(engine, addThrough('H', 'S2', [['k']], 'forward', ['A']));
    expectAllOk(state);
    near(volumeOf(state, 'A'), 12000 + 64 * 30 - HOLE * 10);
    expect(zRange(state, 'A')).toEqual([0, 40]);
  });

  it('goes through a target far from the sketch plane and through a large one', () => {
    for (const [start, thickness] of [[500, 10], [-800, 300], [0.2, 0.1]]) {
      const engine = plate(start, thickness);
      const state = run(engine, addThrough('H', 'S2', [['k']], 'both', ['A']));
      expectAllOk(state);
      near(volumeOf(state, 'A'), (1200 - HOLE) * thickness, 0.02 + 1e-4 * thickness);
      expect(faceNames(state, 'A').filter((name) => name.startsWith('H/')), `${start}/${thickness}`).toEqual(['H/side/k']);
    }
  });

  it('a preview and a change to a distance and back', () => {
    const engine = plate(0, 10);
    run(engine, span('H', 'S2', [['k']], 0, 3, 'cut', ['A']));
    near(volumeOf(engine.getState(), 'A'), 12000 - HOLE * 3);
    const preview = engine.preview({ type: 'updateFeature', id: 'H', patch: { extent: { type: 'throughAll', side: 'forward' } } });
    expect(preview.ok && status(preview.state).H).toBe('ok');
    near(preview.ok ? volumeOf(preview.state, 'A') : 0, 12000 - HOLE * 10);
    near(volumeOf(engine.getState(), 'A'), 12000 - HOLE * 3); // the preview did not write
    const all = run(engine, { type: 'updateFeature', id: 'H', patch: { extent: { type: 'throughAll', side: 'forward' } } });
    near(volumeOf(all, 'A'), 12000 - HOLE * 10);
    const back = run(engine, { type: 'updateFeature', id: 'H', patch: { extent: { type: 'distance', start: 2, distance: 5 } } });
    expectAllOk(back);
    near(volumeOf(back, 'A'), 12000 - HOLE * 5);
  });
});

describe('a cut with several target bodies', () => {
  // Plate A at z 0..10, plate B of the same outline at z 20..30 and a cylinder C of radius 5 at z 40..45
  // above the hole sketch S2 (circle `k` of radius 4 at 20, 15).
  function stack(): Engine {
    const engine = plate(0, 10);
    run(engine, span('B', 'S1', [rectLoop('r')], 20, 10), addSketch('S3', XY), circle('S3', 'c', 20, 15, 5), span('C', 'S3', [['c']], 40, 5));
    return engine;
  }
  const untouched = (state: EngineState) => ({ A: volumeOf(state, 'A'), B: volumeOf(state, 'B'), C: volumeOf(state, 'C') });

  it('through all: the length covers all targets together', () => {
    const engine = stack();
    const before = untouched(engine.getState());
    const state = run(engine, addThrough('H', 'S2', [['k']], 'forward', ['A', 'B']));
    expectAllOk(state);
    near(volumeOf(state, 'A'), 12000 - HOLE * 10);
    near(volumeOf(state, 'B'), 12000 - HOLE * 10);
    expect(volumeOf(state, 'C')).toBe(before.C); // not a target
    // both bodies carry the side of the hole under the same name
    expect(faceNames(state, 'A').filter((name) => name.startsWith('H/'))).toEqual(['H/side/k']);
    expect(faceNames(state, 'B').filter((name) => name.startsWith('H/'))).toEqual(['H/side/k']);
    // a sketch can stand on a face of either body after the cut
    expectAllOk(run(engine, addSketch('S4', onFace('B', cap('B'))), addSketch('S5', onFace('A', cap('A', 'startCap')))));
  });

  it('a distance: a blind cut that reaches two bodies', () => {
    const engine = stack();
    const state = run(engine, span('H', 'S2', [['k']], 5, 20, 'cut', ['A', 'B']));
    expectAllOk(state);
    near(volumeOf(state, 'A'), 12000 - HOLE * 5);
    near(volumeOf(state, 'B'), 12000 - HOLE * 5);
    expect(faceNames(state, 'A').filter((name) => name.startsWith('H/'))).toEqual(['H/side/k', 'H/startCap']);
    expect(faceNames(state, 'B').filter((name) => name.startsWith('H/'))).toEqual(['H/endCap', 'H/side/k']);
  });

  it('a target the tool misses is named in the noEffect warning, the others are cut', () => {
    const engine = stack();
    // the sketch plane lies between the plates: forward reaches only B
    run(engine, { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'plane', base: XY, offset: 15 } }, addSketch('S4', { kind: 'plane', feature: 'P' }), circle('S4', 'q', 20, 15, 4));
    const before = untouched(engine.getState());
    let state = run(engine, addThrough('H', 'S4', [['q']], 'forward', ['A', 'B']));
    expect(status(state).H).toBe('warning:noEffect');
    expect(state.evaluation.features.H.warnings).toMatchObject([{ code: 'noEffect', refs: ['A'] }]);
    expect(volumeOf(state, 'A')).toBe(before.A);
    near(volumeOf(state, 'B'), 12000 - HOLE * 10);
    expect(faceNames(state, 'A').some((name) => name.startsWith('H/'))).toBe(false);
    // backward reaches only A, both reaches both
    state = run(engine, { type: 'updateFeature', id: 'H', patch: { extent: { side: 'backward' } } });
    expect(state.evaluation.features.H.warnings).toMatchObject([{ code: 'noEffect', refs: ['B'] }]);
    near(volumeOf(state, 'A'), 12000 - HOLE * 10);
    expect(volumeOf(state, 'B')).toBe(before.B);
    state = run(engine, { type: 'updateFeature', id: 'H', patch: { extent: { side: 'both' } } });
    expectAllOk(state);
    near(volumeOf(state, 'A'), 12000 - HOLE * 10);
    near(volumeOf(state, 'B'), 12000 - HOLE * 10);
    // no target is hit: a warning that names all of them, and no face of the tool enters the model
    const faces = state.evaluation.faceNames.length;
    state = run(engine, { type: 'updateFeature', id: 'H', patch: { profile: { sketch: 'S3', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 100, distance: 5 } } });
    expect(state.evaluation.features.H.warnings).toMatchObject([{ code: 'noEffect', refs: ['A', 'B'] }]);
    expect(untouched(state)).toEqual(before);
    expect(state.evaluation.faceNames.length).toBeLessThan(faces);
  });

  it('a cut that would remove a whole target is an error and changes none of them', () => {
    const engine = stack();
    const before = untouched(engine.getState());
    const faces = engine.getState().evaluation.faceNames.length;
    // a circle of radius 6 around the cylinder C of radius 5: the plates get a hole, the cylinder would vanish
    run(engine, addSketch('S4', XY), circle('S4', 'big', 20, 15, 6));
    for (const targets of [['A', 'C', 'B'], ['C', 'A'], ['A', 'B', 'C']]) {
      const state = run(engine, addThrough('H', 'S4', [['big']], 'forward', targets));
      expect(status(state).H).toBe('error:emptyResult');
      expect(state.evaluation.features.H.error?.refs).toEqual(['C']);
      expect(untouched(state)).toEqual(before);
      expect(state.evaluation.faceNames.length).toBe(faces);
      engine.undo();
    }
    // without the cylinder among the targets the cut is fine
    const state = run(engine, addThrough('H', 'S4', [['big']], 'forward', ['A', 'B']));
    expectAllOk(state);
    expect(volumeOf(state, 'C')).toBe(before.C);
  });

  it('a missing target is a broken reference that names it; suppressing a target breaks the cut as well', () => {
    const engine = stack();
    run(engine, addThrough('H', 'S2', [['k']], 'forward', ['A', 'B']));
    let state = run(engine, { type: 'removeFeature', id: 'B' });
    expect(status(state).H).toBe('error:brokenReference');
    expect(state.evaluation.features.H.error?.refs).toEqual(['B']);
    expect(volumeOf(state, 'A')).toBeCloseTo(12000, 6); // nothing was cut
    state = run(engine, { type: 'updateFeature', id: 'H', patch: { targets: ['A'] } });
    expectAllOk(state);
    near(volumeOf(state, 'A'), 12000 - HOLE * 10);
    state = run(engine, { type: 'setSuppressed', id: 'A', suppressed: true });
    expect(status(state).H).toBe('error:brokenReference');
  });

  it('an addition still has exactly one target and behaves as before', () => {
    const engine = stack();
    const state = run(engine, addExtrude('N', 'S2', [['k']], 15, 'add', 'A'));
    expectAllOk(state);
    near(volumeOf(state, 'A'), 12000 + HOLE * 5);
    expect(engine.execute(span('N2', 'S2', [['k']], 0, 15, 'add', ['A', 'B'])).ok).toBe(false);
  });
});

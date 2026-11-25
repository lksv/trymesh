// Validation scenarios 4 to 6 (docs/requirements.md) against the real adapters.
import { describe, expect, it } from 'vitest';
import type { Engine, EngineState, Feature } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, cap, circle, constrain, dimension, expectAllOk, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, status, volume } from './kit';

// A plate 40 × 30 × 10 (E1).
function plate(): Engine {
  const engine = newEngine();
  run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), addExtrude('E1', 'S1', [rectLoop('r')], 10));
  return engine;
}
// The plate and a blind pocket 10 × 10 × 5 from the top face (E2).
function plateWithPocket(): Engine {
  const engine = plate();
  run(engine, addSketch('S2', onFace('E1', cap('E1'))), rectangle('S2', 'q', 10, 10, 10, 10, null), addExtrude('E2', 'S2', [rectLoop('q')], -5, 'cut', 'E1'));
  return engine;
}
const snapshot = (engine: Engine) => {
  const state = engine.getState();
  return { document: JSON.stringify(state.document), evaluation: state.evaluation, stl: Array.from(engine.exportMesh('stl')) };
};

describe('scenario 4: round-trip', () => {
  it('after loading, the document, the recompute and the export are bit for bit the same and the sketches are not solved again', () => {
    const engine = plateWithPocket();
    const before = snapshot(engine);
    const other = newEngine();
    const loaded = other.load(engine.save());
    expect(loaded.ok).toBe(true);
    const after = snapshot(other);
    expect(after.document).toBe(before.document); // the stamps matched, nothing was written
    expect(after.stl).toEqual(before.stl);
    expect(after.evaluation).toEqual(before.evaluation);
    expect(other.getState()).toMatchObject({ canUndo: false, canRedo: false });
    expect(before.stl.length).toBe(84 + 50 * (engine.getState().evaluation.bodies.E1.solid.triangles.length / 3));
  });

  it('a document with an error can be saved and loaded; the extrude passes with the same ID after another sketch is chosen', () => {
    const engine = plateWithPocket();
    run(engine, { type: 'removeFeature', id: 'S2' });
    expect(status(engine.getState())).toEqual({ S1: 'ok', E1: 'ok', E2: 'error:brokenReference' });
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(status(other.getState())).toEqual({ S1: 'ok', E1: 'ok', E2: 'error:brokenReference' });
    expect(volume(other.getState().evaluation.bodies.E1.solid)).toBeCloseTo(12000, 3);
    run(other, addSketch('S9', onFace('E1', cap('E1')), 2), rectangle('S9', 'n', 5, 5, 20, 10, null));
    const state = run(other, { type: 'updateFeature', id: 'E2', patch: { profile: { sketch: 'S9', regions: [{ outerLoop: rectLoop('n') }] } } });
    expectAllOk(state);
    expect(state.document.features.map((f) => f.id)).toEqual(['S1', 'E1', 'S9', 'E2']);
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(12000 - 20 * 10 * 5, 3);
  });

  it('an invalid document does not load and the state of the engine does not change', () => {
    const engine = plateWithPocket();
    const before = snapshot(engine);
    const broken = JSON.parse(engine.save());
    broken.features[0].curves.ra.b = 'nowhere';
    expect(engine.load(JSON.stringify(broken))).toMatchObject({ ok: false, error: { code: 'invalidDocument' } });
    expect(engine.load('{ this is not JSON')).toMatchObject({ ok: false, error: { code: 'invalidDocument' } });
    expect(engine.load(JSON.stringify({ ...broken, schemaVersion: 99 }))).toMatchObject({ ok: false });
    expect(snapshot(engine)).toEqual(before);
    expect(engine.getState().canUndo).toBe(true);
  });
});

describe('scenario 5: timeline and undo', () => {
  it('a custom plane, a sketch on it and an extrude', () => {
    const engine = plateWithPocket();
    const plane: Feature = { id: 'P1', name: 'Plane', suppressed: false, type: 'plane', base: onFace('E1', cap('E1')), offset: 5 };
    run(engine, { type: 'addFeature', feature: plane }, addSketch('S3', { kind: 'plane', feature: 'P1' }), circle('S3', 'k', 30, 20, 4), addExtrude('E3', 'S3', [['k']], 3));
    const state = engine.getState();
    expectAllOk(state);
    expect(state.evaluation.features.P1.plane).toMatchObject({ origin: [0, 0, 15], normal: [0, 0, 1] });
    const top = faceBox(state, 'E3', cap('E3'))!;
    expect([top.min[2], top.max[2]]).toEqual([18, 18]);
    // moving the plane moves the body; a plane from a plane
    const moved = run(engine, { type: 'updateFeature', id: 'P1', patch: { offset: 20 } }, { type: 'addFeature', feature: { ...plane, id: 'P2', base: { kind: 'plane', feature: 'P1' }, offset: -2 } });
    expect(faceBox(moved, 'E3', cap('E3'))!.max[2]).toBe(33);
    expect(moved.evaluation.features.P2.plane?.origin).toEqual([0, 0, 28]);
  });

  it('suppressing, inserting in the middle and moving; undo and redo return exactly the previous and the next state', () => {
    const engine = plateWithPocket();
    const states: ReturnType<typeof snapshot>[] = [snapshot(engine)];
    const step = (...commands: Parameters<typeof run>[1][]) => {
      run(engine, ...commands);
      states.push(snapshot(engine));
      return engine.getState();
    };
    // suppressing an earlier cut
    const suppressed = step({ type: 'setSuppressed', id: 'E2', suppressed: true });
    expect(status(suppressed)).toEqual({ S1: 'ok', E1: 'ok', S2: 'ok', E2: 'suppressed' });
    expect(volume(suppressed.evaluation.bodies.E1.solid)).toBeCloseTo(12000, 3);
    // inserting a new feature in the middle of the timeline (a sketch before S2) and its extrude
    step(batch(addSketch('S0', XY, 1), circle('S0', 'k', 30, 20, 3)));
    const inserted = step({ type: 'addFeature', feature: { id: 'E0', name: 'Hole', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S0', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'cut', targets: ['E1'] }, index: 3 });
    expect(inserted.document.features.map((f) => f.id)).toEqual(['S1', 'S0', 'E1', 'E0', 'S2', 'E2']);
    expect(status(inserted)).toEqual({ S1: 'ok', S0: 'ok', E1: 'ok', E0: 'ok', S2: 'ok', E2: 'suppressed' });
    expect(faceNames(inserted, 'E1')).toContain('E0/side/k');
    // restoring the cut and moving: the hole E0 to after the pocket
    step({ type: 'setSuppressed', id: 'E2', suppressed: false });
    const moved = step({ type: 'moveFeature', id: 'E0', index: 5 });
    expect(moved.document.features.map((f) => f.id)).toEqual(['S1', 'S0', 'E1', 'S2', 'E2', 'E0']);
    expectAllOk(moved);
    expect(engine.execute({ type: 'moveFeature', id: 'E0', index: 0 })).toMatchObject({ ok: false, error: { code: 'invalidCommand' } });
    expect(snapshot(engine)).toEqual(states[states.length - 1]); // the invalid command changed nothing

    // undo back to the start and redo forward again: each step exactly
    for (let i = states.length - 2; i >= 0; i--) {
      engine.undo();
      expect(snapshot(engine)).toEqual(states[i]);
    }
    expect(engine.getState().canRedo).toBe(true);
    for (let i = 1; i < states.length; i++) {
      engine.redo();
      expect(snapshot(engine)).toEqual(states[i]);
    }
    expect(engine.getState().canRedo).toBe(false);
    // a new command after undo discards redo
    engine.undo();
    run(engine, { type: 'renameFeature', id: 'E0', name: 'Opening' });
    expect(engine.getState().canRedo).toBe(false);
  });

  it('the state after a given feature and subscribing to changes', () => {
    const engine = plateWithPocket();
    const partial = engine.getState('E1');
    expect(Object.keys(partial.evaluation.features)).toEqual(['S1', 'E1']);
    expect(volume(partial.evaluation.bodies.E1.solid)).toBeCloseTo(12000, 3);
    const seen: EngineState[] = [];
    const unsubscribe = engine.subscribe((state) => seen.push(state));
    run(engine, { type: 'renameFeature', id: 'E1', name: 'Plate' });
    engine.undo();
    unsubscribe();
    engine.redo();
    expect(seen.map((s) => s.document.features[1].name)).toEqual(['Plate', 'E1']);
  });
});

describe('scenario 6: building on geometry', () => {
  it('a) a concentric hole follows the cylinder', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), circle('S1', 'k', 30, 20, 10), addExtrude('E1', 'S1', [['k']], 15));
    run(
      engine,
      addSketch('S2', onFace('E1', cap('E1'))),
      batch(
        { type: 'addExternal', sketch: 'S2', id: 'rim', ref: { type: 'edge', body: 'E1', edge: { a: cap('E1'), b: side('E1', 'k') }, kind: 'circle' } },
        { type: 'addPoint', sketch: 'S2', id: 'hc', x: 28, y: 21 },
        { type: 'addCurve', sketch: 'S2', id: 'hole', curve: { type: 'circle', center: 'hc' }, radius: 3.5 },
        constrain('S2', 'conc', { type: 'coincident', a: 'hc', b: 'rim/center' }),
        dimension('S2', 'hd', { type: 'diameter', curve: 'hole' }, 8),
      ),
      addExtrude('E2', 'S2', [['hole']], -15, 'cut', 'E1'),
    );
    const centre = (state: EngineState) => state.evaluation.features.S2.sketch!.points.hc;
    let state = engine.getState();
    expectAllOk(state);
    expect(state.evaluation.bodies.E1.edges.find((e) => e.kind === 'circle')).toBeDefined();
    expect(centre(state)).toEqual({ x: 30, y: 20 });
    expect(state.evaluation.features.S2.sketch!.radii).toMatchObject({ rim: 10, hole: expect.closeTo(4, 8) });
    // moving the cylinder in the original sketch
    state = run(engine, { type: 'setConstraintValue', sketch: 'S1', id: 'kx', value: 55 }, { type: 'setConstraintValue', sketch: 'S1', id: 'ky', value: -10 });
    expectAllOk(state);
    expect(centre(state)).toEqual({ x: 55, y: -10 });
    const wall = faceBox(state, 'E1', side('E2', 'hole'))!;
    expect((wall.min[0] + wall.max[0]) / 2).toBeCloseTo(55, 1);
    expect((wall.min[1] + wall.max[1]) / 2).toBeCloseTo(-10, 1);
  });

  it('b) a boss flush with the side of the body, even when it is attached to an end point of a projected edge', () => {
    const engine = plate();
    run(
      engine,
      addSketch('S3', onFace('E1', cap('E1'))),
      batch(
        { type: 'addExternal', sketch: 'S3', id: 'right', ref: { type: 'edge', body: 'E1', edge: { a: cap('E1'), b: side('E1', 'rb') }, kind: 'line' } },
        rectangle('S3', 'n', 30, 10, 10, 10, null),
      ),
    );
    // the bottom right corner of the boss attached to the edge of the body (instead of a dimension of the width): the side has the precision of the mesh
    run(engine, batch({ type: 'removeConstraint', sketch: 'S3', id: 'nw' }, constrain('S3', 'snap', { type: 'pointOnCurve', point: 'n2', curve: 'right' })));
    const state = run(engine, addExtrude('E3', 'S3', [rectLoop('n')], 5, 'add', 'E1'));
    expectAllOk(state);
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(12000 + 500, 2);
    // both faces stayed named and an edge of the kind coplanar divides them
    expect(faceNames(state, 'E1')).toEqual(expect.arrayContaining(['E1/side/rb', 'E3/side/nb', 'E1/endCap', 'E3/endCap']));
    expect(faceNames(state, 'E1')).not.toContain('E3/startCap');
    const seam = state.evaluation.bodies.E1.edges.find((e) => JSON.stringify(e.name) === JSON.stringify({ a: side('E1', 'rb'), b: side('E3', 'nb') }));
    expect(seam?.kind).toBe('coplanar');
    // the top face of the body stays usable for another sketch and operation
    const next = run(engine, addSketch('S4', onFace('E1', cap('E1'))), rectangle('S4', 'm', 5, 5, 10, 10, null), addExtrude('E4', 'S4', [rectLoop('m')], -5, 'cut', 'E1'));
    expectAllOk(next);
    expect(volume(next.evaluation.bodies.E1.solid)).toBeCloseTo(12000 + 500 - 500, 2);
    expect(faceNames(next, 'E1')).not.toContain('E4/startCap');
  });

  it('c) a cut flush only in part and a further operation on the newly created face', () => {
    const engine = plate();
    // a step on the left half of the top face
    run(engine, addSketch('S2', onFace('E1', cap('E1'))), rectangle('S2', 's', 0, 0, 20, 30), addExtrude('E2', 'S2', [rectLoop('s')], 10, 'add', 'E1'));
    // a tunnel: a pocket (10..30) × (10..20) × (5..10) from a sketch on a plane at the height 5; its ceiling under the step is a new face
    const plane: Feature = { id: 'P1', name: 'Plane', suppressed: false, type: 'plane', base: XY, offset: 5 };
    run(engine, { type: 'addFeature', feature: plane }, addSketch('S3', { kind: 'plane', feature: 'P1' }), rectangle('S3', 't', 10, 10, 20, 10, null));
    // the plane cannot be moved after the sketch that lies on it
    expect(engine.execute({ type: 'moveFeature', id: 'P1', index: 5 })).toMatchObject({ ok: false, error: { code: 'invalidCommand' } });
    let state = run(engine, addExtrude('E3', 'S3', [rectLoop('t')], 5, 'cut', 'E1'));
    expectAllOk(state);
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(18000 - 1000, 2);
    const ceiling = faceBox(state, 'E1', cap('E3'))!; // the cap of the tool at the height 10: the ceiling of the tunnel under the step
    expect(ceiling.area).toBeCloseTo(100, 1);
    expect([ceiling.min[2], ceiling.max[2]]).toEqual([10, 10]);
    // a further operation on the ceiling of the tunnel: a boss hanging from it
    // The normal of the sketch on the ceiling points out of the body, so down; the axis X = Y × N is
    // therefore against the X axis of the world.
    state = run(engine, addSketch('S4', onFace('E1', cap('E3'))), rectangle('S4', 'h', -18, 12, 6, 6, null), addExtrude('E4', 'S4', [rectLoop('h')], 3, 'add', 'E1'));
    expectAllOk(state);
    expect(state.evaluation.features.S4.plane).toMatchObject({ origin: [0, 0, 10], x: [-1, 0, 0], y: [0, 1, 0], normal: [0, 0, -1] });
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(18000 - 1000 + 108, 2);
    expect(faceNames(state, 'E1')).not.toContain('E4/startCap'); // the seating face vanished: one body without a gap
    const boss = faceBox(state, 'E1', cap('E4'))!;
    expect([boss.min[2], boss.max[2]]).toEqual([7, 7]);
    expect([boss.min[0], boss.max[0]]).toEqual([12, 18]);
  });

  it('d) a cut that misses the body, and a cut that would remove all of it', () => {
    const engine = plateWithPocket();
    const before = volume(engine.getState().evaluation.bodies.E1.solid);
    run(engine, addSketch('S3', XY), rectangle('S3', 'm', 100, 100, 10, 10, null), rectangle('S3', 'w', -5, -5, 50, 40, null));
    let state = run(engine, addExtrude('E3', 'S3', [rectLoop('m')], 10, 'cut', 'E1'));
    expect(status(state).E3).toBe('warning:noEffect');
    expect(volume(state.evaluation.bodies.E1.solid)).toBe(before);
    state = run(engine, addExtrude('E4', 'S3', [rectLoop('w')], 10, 'cut', 'E1'));
    expect(status(state).E4).toBe('error:emptyResult');
    expect(volume(state.evaluation.bodies.E1.solid)).toBe(before);
    // an addition that adds nothing
    state = run(engine, addSketch('S5', XY), rectangle('S5', 'i', 30, 20, 5, 5, null), addExtrude('E5', 'S5', [rectLoop('i')], 5, 'add', 'E1'));
    expect(status(state).E5).toBe('warning:noEffect');
  });

  it('e) a boss with the same footprint is cut off again entirely', () => {
    const engine = plate();
    run(engine, addSketch('S3', onFace('E1', cap('E1'))), rectangle('S3', 'n', 0, 0, 20, 30), addExtrude('E3', 'S3', [rectLoop('n')], 10, 'add', 'E1'));
    run(engine, addSketch('S4', onFace('E1', side('E3', 'nb')))); // a sketch on the side of the boss
    expectAllOk(engine.getState());
    const state = run(engine, { type: 'addFeature', feature: { id: 'E5', name: 'Cut off', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S3', regions: [{ outerLoop: rectLoop('n') }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'cut', targets: ['E1'] }, index: 4 });
    expect(state.document.features.map((f) => f.id)).toEqual(['S1', 'E1', 'S3', 'E3', 'E5', 'S4']);
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(12000, 2);
    expect(faceNames(state, 'E1').filter((name) => name.startsWith('E3/'))).toEqual([]);
    expect(status(state)).toMatchObject({ E5: 'ok', S4: 'error:brokenReference' });
  });
});

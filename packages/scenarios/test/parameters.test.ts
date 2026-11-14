// Parameters and expressions in the recompute: writing values back to the document, cache, undo, errors and preview (D35 point 1).
import { describe, expect, it } from 'vitest';
import type { Command, ExtrudeFeature, PlaneFeature, SketchFeature } from '@trymesh/engine';
import { XY, addSketch, circle, newEngine, onFace, cap, run, status, volume } from './kit';

const param = (name: string, expr: string): Command => ({ type: 'setParameter', name, expr });
const extrudeBy = (id: string, sketch: string, curve: string, distance: number | string, start: number | string = 0): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop: [curve] }] }, extent: { type: 'distance', start, distance }, operation: 'new' },
});

// A cylinder: diameter `d`, height `h`; a plane offset by `h / 2` and a second cylinder on its cap.
function model() {
  const engine = newEngine();
  run(engine, param('d', '20'), param('h', '10'), param('unused', '1'), addSketch('S1', XY), circle('S1', 'c', 0, 0, 10));
  run(engine, { type: 'setConstraintValue', sketch: 'S1', id: 'cr', value: 'd / 2' }, extrudeBy('E1', 'S1', 'c', 'h'));
  run(engine, { type: 'addFeature', feature: { id: 'P1', name: 'P1', suppressed: false, type: 'plane', base: XY, offset: 'h / 2' } });
  run(engine, addSketch('S2', onFace('E1', cap('E1'))), circle('S2', 'k', 0, 0, 3), extrudeBy('E2', 'S2', 'k', 4));
  return engine;
}
const cylinder = (d: number, h: number) => (Math.PI * d * d * h) / 4;
// The cylinder is a polyhedron: its volume is a fraction of a percent below the exact one.
const near = (actual: number | false, expected: number) => expect(Math.abs((actual as number) / expected - 1)).toBeLessThan(0.003);
const feature = <F>(engine: ReturnType<typeof newEngine>, id: string): F => engine.getState().document.features.find((f) => f.id === id) as F;

describe('parameters in the recompute', () => {
  it('changing a parameter recomputes the model and writes expression values back to the document', () => {
    const engine = model();
    let state = engine.getState();
    expect(status(state)).toEqual({ S1: 'ok', E1: 'ok', P1: 'ok', S2: 'ok', E2: 'ok' });
    near(volume(state.evaluation.bodies.E1.solid), cylinder(20, 10));
    expect(state.evaluation.features.E1.values).toEqual({ 'extent/distance': 10 });
    expect(state.evaluation.features.S1.values).toEqual({ 'constraints/cr/value': 10 });

    state = run(engine, param('h', '16'));
    expect(status(state)).toEqual({ S1: 'ok', E1: 'ok', P1: 'ok', S2: 'ok', E2: 'ok' });
    near(volume(state.evaluation.bodies.E1.solid), cylinder(20, 16));
    expect(feature<ExtrudeFeature>(engine, 'E1').extent.distance).toBe(16);
    expect(feature<PlaneFeature>(engine, 'P1').offset).toBe(8);
    expect(state.evaluation.features.P1.plane?.origin).toEqual([0, 0, 8]);
    // the second cylinder stands on the cap of the first one and moved with it
    const top = Math.max(...Array.from(state.evaluation.bodies.E2.solid.positions).filter((_, i) => i % 3 === 2));
    expect(top).toBeCloseTo(20, 5);

    state = run(engine, param('d', '30'));
    near(volume(state.evaluation.bodies.E1.solid), cylinder(30, 16));
    expect(feature<SketchFeature>(engine, 'S1').constraints.cr).toMatchObject({ value: 15 });
    expect(feature<SketchFeature>(engine, 'S1').radii.c).toBeCloseTo(15, 9);
  });

  it('the unchanged start of the timeline comes from the cache; an unused parameter recomputes nothing', () => {
    const engine = model();
    const before = engine.getState();
    // a parameter no feature uses: the feature results are the same objects
    let state = run(engine, param('unused', '2'));
    for (const id of ['S1', 'E1', 'P1', 'S2', 'E2']) expect(state.evaluation.features[id]).toBe(before.evaluation.features[id]);
    expect(state.evaluation.bodies.E1.solid).toBe(before.evaluation.bodies.E1.solid);
    expect(state.canUndo).toBe(true);

    // sketch S1 does not use `h`: it stays, the extrusion and everything after it is recomputed
    state = run(engine, param('h', '12'));
    expect(state.evaluation.features.S1).toBe(before.evaluation.features.S1);
    expect(state.evaluation.features.E1).not.toBe(before.evaluation.features.E1);

    // a recompute of the same document computes nothing: the state after the write-back is cached
    const again = engine.getState('E2');
    for (const id of ['S1', 'E1', 'P1', 'S2', 'E2']) expect(again.evaluation.features[id]).toBe(state.evaluation.features[id]);
    // a parameter with the same value from a different expression recomputes nothing
    const same = run(engine, param('h', '6 * 2'));
    for (const id of ['S1', 'E1', 'P1', 'S2', 'E2']) expect(same.evaluation.features[id]).toBe(state.evaluation.features[id]);
  });

  it('undo and redo restore the parameter and the field values', () => {
    const engine = model();
    const saved = engine.save();
    run(engine, param('h', '16'));
    const changed = engine.save();
    expect(changed).not.toBe(saved);
    engine.undo();
    expect(engine.save()).toBe(saved);
    expect(feature<ExtrudeFeature>(engine, 'E1').extent.distance).toBe(10);
    near(volume(engine.getState().evaluation.bodies.E1.solid), cylinder(20, 10));
    engine.redo();
    expect(engine.save()).toBe(changed);
    // a command that changes nothing adds no undo step
    engine.undo();
    const result = engine.execute(param('h', '10'));
    expect(result.ok && result.state.canRedo).toBe(true);
  });

  it('a bad expression: the feature is in error, a sketch keeps the last valid value, a fix restores everything', () => {
    const engine = model();
    let state = run(engine, { type: 'removeParameter', name: 'h' });
    // the extrusion and the plane are in error, what stands on the extrusion has a broken reference
    expect(status(state)).toEqual({ S1: 'ok', E1: 'error:invalidExpression', P1: 'error:invalidExpression', S2: 'error:brokenReference', E2: 'error:brokenReference' });
    expect(state.evaluation.features.E1.fieldErrors).toMatchObject({ 'extent/distance': { code: 'unknownName' } });
    expect(state.evaluation.features.E1.error?.refs).toEqual(['extent/distance']);
    // the number in the document stays the last valid value; the document can be saved and loaded
    expect(feature<ExtrudeFeature>(engine, 'E1').extent.distance).toBe(10);
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(status(other.getState())).toEqual(status(state));
    expect(other.save()).toBe(engine.save());

    // a sketch with a bad dimension expression stays visible and computes with the last valid value
    state = run(engine, { type: 'removeParameter', name: 'd' });
    expect(status(state).S1).toBe('warning:invalidExpression');
    expect(state.evaluation.features.S1.fieldErrors).toMatchObject({ 'constraints/cr/value': { code: 'unknownName' } });
    expect(state.evaluation.features.S1.sketch?.radii.c).toBeCloseTo(10, 9);
    expect(state.evaluation.features.S1.warnings[0].refs).toEqual(['constraints/cr/value']);

    // the result of a feature in error is memoised: another query computes nothing
    expect(engine.getState('E1').evaluation.features.E1).toBe(state.evaluation.features.E1);
    expect(engine.diagnoseSketch('S1')).toBe(engine.diagnoseSketch('S1'));

    // the fix: bring the parameters back, or a number instead of the expression
    state = run(engine, param('d', '20'), { type: 'setField', feature: 'E1', path: 'extent/distance', value: 10 }, { type: 'setField', feature: 'P1', path: 'offset', value: 'd / 4' });
    expect(status(state)).toEqual({ S1: 'ok', E1: 'ok', P1: 'ok', S2: 'ok', E2: 'ok' });
    expect(state.evaluation.features.E1.fieldErrors).toBeUndefined();
  });

  it('a value out of range, a cycle and division by zero are field errors, not a failed recompute', () => {
    const engine = model();
    let state = run(engine, param('h', '0'));
    expect(state.evaluation.features.E1.fieldErrors).toMatchObject({ 'extent/distance': { code: 'outOfRange' } });
    expect(status(state).P1).toBe('ok'); // a plane offset may be zero
    state = run(engine, param('h', 'd'), param('d', 'h'));
    expect(state.evaluation.parameters).toMatchObject({ h: { ok: false, error: { code: 'cycle' } }, d: { ok: false, error: { code: 'cycle' } } });
    expect(state.evaluation.features.E1.fieldErrors).toMatchObject({ 'extent/distance': { code: 'dependsOnError' } });
    expect(status(state).S1).toBe('warning:invalidExpression');
    state = run(engine, param('d', '20'), param('h', '1 / (d - 20)'));
    expect(state.evaluation.parameters.h).toMatchObject({ ok: false, error: { code: 'notFinite' } });
    state = run(engine, param('h', '10'));
    expect(status(state)).toEqual({ S1: 'ok', E1: 'ok', P1: 'ok', S2: 'ok', E2: 'ok' });
    // a negative radius from an expression: the sketch keeps the last valid value
    state = run(engine, param('d', '-4'));
    expect(state.evaluation.features.S1.fieldErrors).toMatchObject({ 'constraints/cr/value': { code: 'outOfRange' } });
    expect(state.evaluation.features.S1.sketch?.radii.c).toBeCloseTo(10, 9);
  });

  it('a preview returns field values and does not write to the document', () => {
    const engine = model();
    const saved = engine.save();
    const preview = engine.preview(param('h', '25'));
    expect(preview.ok && preview.state.evaluation.features.E1.values).toEqual({ 'extent/distance': 25 });
    near(preview.ok && volume(preview.state.evaluation.bodies.E1.solid), cylinder(20, 25));
    // the document in the preview still has the old field value
    expect(preview.ok && (preview.state.document.features.find((f) => f.id === 'E1') as ExtrudeFeature).extent.distance).toBe(10);
    const field = engine.preview({ type: 'setField', feature: 'E1', path: 'extent/distance', value: 'h * 3' }, 'E1');
    expect(field.ok && field.state.evaluation.features.E1.values).toEqual({ 'extent/distance': 30 });
    const bad = engine.preview({ type: 'setField', feature: 'E1', path: 'extent/distance', value: 'h *' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalidCommand', expression: { path: 'extent/distance', error: { code: 'syntax', position: 3 } } } });
    expect(engine.save()).toBe(saved);
    // the state after the preview did not change and nothing is recomputed
    const state = engine.getState();
    expect(engine.getState('E2').evaluation.features.E2).toBe(state.evaluation.features.E2);
  });

  it('a batch: a parameter and a feature that uses it in one undo step', () => {
    const engine = newEngine();
    const result = engine.execute({ type: 'batch', commands: [param('r', '5'), addSketch('S1', XY), circle('S1', 'c', 0, 0, 4), { type: 'setConstraintValue', sketch: 'S1', id: 'cr', value: 'r' }, extrudeBy('E1', 'S1', 'c', 'r * 2', '-r')] });
    expect(result.ok).toBe(true);
    const state = engine.getState();
    near(volume(state.evaluation.bodies.E1.solid), cylinder(10, 10));
    expect(feature<ExtrudeFeature>(engine, 'E1').extent).toEqual({ type: 'distance', start: -5, distance: 10 });
    engine.undo();
    expect(engine.getState().document.features).toEqual([]);
    expect(engine.getState().document.parameters).toEqual([]);
    // an error in the middle of a batch says which command it was and where the expression error is
    const failed = engine.execute({ type: 'batch', commands: [param('r', '5'), { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'plane', base: XY, offset: 'q' } }] });
    expect(failed).toMatchObject({ ok: false, error: { commandIndex: 1, expression: { path: 'offset', error: { code: 'unknownName' } } } });
  });
});

// Validation scenario 9: a robot joint with a planetary gearbox (docs/requirements.md).
// It grows with the points of D35; so far part a) parameters, checks and the sketch of pitch circles,
// and the parts of i) and k) that need nothing else.
// Parameter names are English: `module` for `modul` of the requirements, `backlash` for `vule`,
// `centers` (centre distance) for `osa`.
import { describe, expect, it } from 'vitest';
import type { Command, Constraint, Engine, EngineState, Id, Input, SketchFeature } from '@trymesh/engine';
import { XY, addSketch, batch, newEngine, run, status } from './kit';

const point = (sk: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: sk, id, x, y });
const circle = (sk: Id, id: Id, center: Id, radius: number, construction = false): Command => ({ type: 'addCurve', sketch: sk, id, curve: { type: 'circle', center, ...(construction ? { construction: true } : {}) }, radius });
const constrain = (sk: Id, id: Id, constraint: Input<Constraint>): Command => ({ type: 'addConstraint', sketch: sk, id, constraint });
const dim = (sk: Id, id: Id, shape: object, value: number | string): Command => constrain(sk, id, { ...shape, value, driving: true } as Input<Constraint>);
const param = (name: string, expr: string): Command => ({ type: 'setParameter', name, expr });
const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;

const CHECKS = {
  screws: 'rotor screws can be inserted',
  sun: 'planet copies mesh with the sun',
  ring: 'planet copies mesh with the ring',
  planets: 'neighbouring planets do not touch',
};

// a) Parameters, checks and the sketch of pitch circles. The pitch circles are construction geometry
// (they touch); the ordinary curves are the planet bore `ph`, the pin `pin` and the bore for the
// centring pin `sb`.
function parametersAndGearSketch(engine: Engine): EngineState {
  run(
    engine,
    param('module', '0.9'),
    param('Zs', '18'),
    param('Zp', '27'),
    param('Zr', 'Zs + 2 * Zp'),
    param('backlash', '0.05'),
    param('centers', 'module * (Zs + Zp) / 2'),
    { type: 'setCheck', name: CHECKS.screws, expr: 'module * (Zs / 2 + 1) < 12.75' },
    { type: 'setCheck', name: CHECKS.sun, expr: 'Zs % 3 == 0' },
    { type: 'setCheck', name: CHECKS.ring, expr: 'Zr % 3 == 0' },
    // centres of neighbouring planets are centers · √3 apart, the tip diameter of a planet is module · (Zp + 2)
    { type: 'setCheck', name: CHECKS.planets, expr: 'centers * sqrt(3) > module * (Zp + 2)' },
  );
  return run(
    engine,
    addSketch('skGears', XY),
    batch(
      point('skGears', 'cp', 20, 1),
      circle('skGears', 's', 'origin', 8, true),
      circle('skGears', 'p', 'cp', 12, true),
      circle('skGears', 'r', 'origin', 32, true),
      circle('skGears', 'ph', 'cp', 2.6),
      circle('skGears', 'pin', 'cp', 2.4),
      circle('skGears', 'sb', 'origin', 1.5),
      constrain('skGears', 'tsp', { type: 'tangent', a: 's', b: 'p' }),
      dim('skGears', 'cpy', { type: 'verticalDistance', a: 'origin', b: 'cp' }, 0),
      dim('skGears', 'ds', { type: 'diameter', curve: 's' }, 'module * Zs'),
      dim('skGears', 'dp', { type: 'diameter', curve: 'p' }, 'module * Zp'),
      dim('skGears', 'dr', { type: 'diameter', curve: 'r' }, 'module * Zr'),
      dim('skGears', 'dph', { type: 'diameter', curve: 'ph' }, 5.3),
      dim('skGears', 'dpin', { type: 'diameter', curve: 'pin' }, 5),
      dim('skGears', 'dsb', { type: 'diameter', curve: 'sb' }, 3.2),
    ),
  );
}

const allChecks = (state: EngineState): Record<string, string> => Object.fromEntries(Object.entries(state.evaluation.checks).map(([name, result]) => [name, result.status]));
const gears = (state: EngineState) => {
  const sketch = state.evaluation.features.skGears.sketch;
  if (!sketch) throw new Error('the gear sketch was not evaluated');
  return { sun: sketch.radii.s, planet: sketch.radii.p, ring: sketch.radii.r, center: sketch.points.cp, dof: sketch.degreesOfFreedom, valid: sketch.valid, regions: sketch.regions.map((r) => r.ref.outerLoop.join()) };
};

describe('scenario 9: robot joint', () => {
  it('a) parameters, checks and the sketch of pitch circles', () => {
    const engine = newEngine();
    const state = parametersAndGearSketch(engine);
    expect(status(state)).toEqual({ skGears: 'ok' });
    expect(state.evaluation.parameters).toMatchObject({ module: { ok: true, value: 0.9 }, Zr: { ok: true, value: 72 }, centers: { ok: true, value: 20.25 } });
    expect(allChecks(state)).toEqual({ [CHECKS.screws]: 'ok', [CHECKS.sun]: 'ok', [CHECKS.ring]: 'ok', [CHECKS.planets]: 'ok' });

    // the sketch: fully constrained, valid profile (the pitch circles are construction), planet centre on the X axis
    const g = gears(state);
    expect(g.dof).toBe(0);
    expect(g.valid).toBe(true);
    expect(g.regions.sort()).toEqual(['ph', 'pin', 'sb']);
    expect(g.sun).toBeCloseTo(8.1, 9);
    expect(g.planet).toBeCloseTo(12.15, 9);
    expect(g.ring).toBeCloseTo(32.4, 9);
    expect(g.center.x).toBeCloseTo(20.25, 6);
    expect(g.center.y).toBeCloseTo(0, 6);
    // the ring touches the planet from inside: it follows from the parameters, the sketch has no constraint for it
    expect(g.ring - (g.center.x + g.planet)).toBeCloseTo(0, 6);

    // the dimension's expression is in the document under the field address and the number is the evaluated value
    const sketch = sketchOf(state, 'skGears');
    expect(sketch.expressions).toEqual({ 'constraints/dp/value': 'module * Zp', 'constraints/dr/value': 'module * Zr', 'constraints/ds/value': 'module * Zs' });
    expect(sketch.constraints.ds).toMatchObject({ value: 16.2, driving: true });
    expect(sketch.constraints.dr).toMatchObject({ value: 64.8 });
  });

  it('i) changing the ratio: the circles are recomputed, stay tangent and the checks hold', () => {
    const engine = newEngine();
    parametersAndGearSketch(engine);

    // ratio 5 → 4 with the same ring
    let state = run(engine, batch(param('Zs', '24'), param('Zp', '24')));
    expect(state.evaluation.parameters.Zr).toEqual({ ok: true, value: 72 });
    let g = gears(state);
    expect([g.sun, g.planet, g.ring].map((r) => Math.round(r * 1e6) / 1e6)).toEqual([10.8, 10.8, 32.4]);
    expect(g.center.x).toBeCloseTo(21.6, 6);
    expect(g.dof).toBe(0);
    expect(Object.values(allChecks(state))).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(sketchOf(state, 'skGears').constraints.ds).toMatchObject({ value: 21.6 });

    // module 1 with Zs = 24: tip radius 13 mm, the screws cannot be inserted; the model keeps computing
    state = run(engine, param('module', '1'));
    expect(allChecks(state)[CHECKS.screws]).toBe('failed');
    expect(status(state)).toEqual({ skGears: 'ok' });
    engine.undo();

    // back to the initial state and ratio 5 → 6 with a larger ring
    engine.undo();
    state = run(engine, param('Zp', '36'));
    expect(state.evaluation.parameters.Zr).toEqual({ ok: true, value: 90 });
    g = gears(state);
    expect(g.ring).toBeCloseTo(40.5, 9);
    expect(g.center.x).toBeCloseTo(24.3, 6);
    expect(g.ring - (g.center.x + g.planet)).toBeCloseTo(0, 6);
    expect(Object.values(allChecks(state))).toEqual(['ok', 'ok', 'ok', 'ok']);

    // a tooth count not divisible by three: the check reports it
    state = run(engine, param('Zs', '19'));
    expect(allChecks(state)).toMatchObject({ [CHECKS.sun]: 'failed', [CHECKS.ring]: 'failed' });
  });

  it('k) a document with parameters, checks and expressions saves and loads unchanged', () => {
    const engine = newEngine();
    const state = parametersAndGearSketch(engine);
    const saved = engine.save();
    const other = newEngine();
    const loaded = other.load(saved);
    expect(loaded.ok).toBe(true);
    expect(other.save()).toBe(saved);
    expect(other.getState().evaluation.parameters).toEqual(state.evaluation.parameters);
    expect(other.getState().evaluation.checks).toEqual(state.evaluation.checks);
    expect(gears(other.getState())).toEqual(gears(state));
  });
});

// The query `mass` (D41) against the real adapters: one body and several as one piece, where the
// density of a body comes from, the fill factor, the moment about an axis, and the errors.
import type { Command, Engine, Id, MassProperties, QueryArgs, QueryOptions } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addSketch, circle, expectAllOk, extrude, newEngine, rectLoop, rectangle, run } from './kit';

const span = (id: Id, sketch: Id, curves: Id[][], start: number, distance: number, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { ...extrude(id, sketch, curves, distance, operation), extent: { type: 'distance', start, distance }, ...(targets ? { targets } : {}) },
});
function mass(engine: Engine, args: QueryArgs<'mass'>, options: QueryOptions = {}): MassProperties {
  const answer = engine.query('mass', args, options);
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  return answer.result;
}
const near = (values: number[], digits = 6) => values.map((value) => expect.closeTo(value, digits));
const PLA = 1.24; // g/cm3

// A: a block 40 × 30 × 10 with a corner at the origin. B: a block 10 × 30 × 10 flush beside it
// along X, so the two together are a block 50 × 30 × 10. The sketch of A has a point at the
// middle of A (the centre of a construction circle).
function model(): Engine {
  const engine = newEngine();
  run(engine, addSketch('sA', XY), rectangle('sA', 'a', 0, 0, 40, 30), circle('sA', 'm', 20, 15, 2), span('A', 'sA', [rectLoop('a')], 0, 10));
  run(engine, addSketch('sB', XY), rectangle('sB', 'b', 40, 0, 10, 30, null), span('B', 'sB', [rectLoop('b')], 0, 10));
  expectAllOk(engine.getState());
  return engine;
}

describe('the query mass', () => {
  // the circle in the sketch of A cuts its region: the block is the annulus and the disc together
  const whole = (engine: Engine): void => {
    run(engine, span('disc', 'sA', [['m']], 0, 10, 'add', ['A']));
  };

  it('one body: the mass from the volume and the density, the centre of mass, the tensor of a block', () => {
    const engine = model();
    whole(engine);
    const found = mass(engine, { bodies: ['A'], density: PLA });
    expect(found.volume).toBeCloseTo(12000, 3);
    expect(found.mass).toBeCloseTo(14.88, 6); // 12 cm3 of 1.24 g/cm3
    expect(found.centerOfMass).toEqual(near([20, 15, 5], 4));
    // m·(b² + c²)/12 about X, and so on; nothing off the diagonal for a block along the axes
    const m = found.mass;
    expect(found.inertia).toEqual([near([(m * (900 + 100)) / 12, 0, 0], 2), near([0, (m * (1600 + 100)) / 12, 0], 2), near([0, 0, (m * (1600 + 900)) / 12], 2)]);
    expect(found.about).toBeUndefined();
    expect(found.bodies).toEqual([{ body: 'A', mass: found.mass, volume: found.volume, density: PLA, fill: 1, centerOfMass: near([20, 15, 5], 4) }]);
    // in the units of the answer: mass = density × fill × volume / 1000
    expect(found.bodies[0].mass).toBeCloseTo((found.bodies[0].density * found.bodies[0].fill * found.bodies[0].volume) / 1000, 9);
  });

  it('the moment about an axis: through the centre of mass, and beside it by the parallel axis theorem', () => {
    const engine = model();
    whole(engine);
    const own = mass(engine, { bodies: ['A'], density: PLA });
    // the normal of the sketch plane through the middle of the block: the axis goes through the centre of mass
    const through = mass(engine, { bodies: ['A'], density: PLA, about: { kind: 'sketchPoint', sketch: 'sA', point: 'mc' } });
    expect(through.about?.distance).toBeCloseTo(0, 4);
    expect(through.about?.moment).toBeCloseTo(own.inertia[2][2], 3);
    // the Z axis of the model: 25 mm from the centre of mass
    const beside = mass(engine, { bodies: ['A'], density: PLA, about: { kind: 'base', axis: 'Z' } });
    expect(beside.about?.distance).toBeCloseTo(25, 4);
    expect(beside.about?.moment).toBeCloseTo(own.inertia[2][2] + own.mass * 625, 2);
    // the X axis: the centre of mass is 15 across and 5 up from it
    const along = mass(engine, { bodies: ['A'], density: PLA, about: { kind: 'base', axis: 'X' } });
    expect(along.about?.distance).toBeCloseTo(Math.hypot(15, 5), 4);
    expect(along.about?.moment).toBeCloseTo(own.inertia[0][0] + own.mass * 250, 2);
    // the answer without the axis is the same answer
    expect({ ...beside, about: undefined }).toEqual({ ...own, about: undefined });
  });

  it('several bodies as one piece: two blocks side by side are the block they make', () => {
    const engine = model();
    whole(engine);
    const found = mass(engine, { bodies: ['A', 'B'], density: PLA });
    const m = (15000 * PLA) / 1000;
    expect(found.mass).toBeCloseTo(m, 6);
    expect(found.volume).toBeCloseTo(15000, 3);
    expect(found.centerOfMass).toEqual(near([25, 15, 5], 4));
    expect(found.inertia).toEqual([near([(m * (900 + 100)) / 12, 0, 0], 2), near([0, (m * (2500 + 100)) / 12, 0], 2), near([0, 0, (m * (2500 + 900)) / 12], 2)]);
    expect(found.bodies.map((body) => [body.body, body.centerOfMass[0]])).toEqual([['A', expect.closeTo(20, 4)], ['B', expect.closeTo(45, 4)]]);
    // the order of the list is the order of the answer; a body named twice counts once
    const again = mass(engine, { bodies: ['B', 'A', 'B'], density: PLA });
    expect(again.bodies.map((body) => body.body)).toEqual(['B', 'A']);
    expect(again.mass).toBeCloseTo(m, 6);
    // a heavier B pulls the centre of mass towards it and turns the tensor off its axes only where the shape does
    const heavy = mass(engine, { bodies: ['A', 'B'], density: PLA, densities: { B: 4 * PLA } });
    expect(heavy.mass).toBeCloseTo(2 * 14.88, 6);
    expect(heavy.centerOfMass).toEqual(near([32.5, 15, 5], 4)); // two equal masses at 20 and 45
  });

  it('a hole takes its material away: the mass, and the centre of mass moves from it', () => {
    const engine = model(); // the disc of the circle is not added: A is a block with a hole of radius 2 through its middle
    const holed = mass(engine, { bodies: ['A'], density: PLA });
    expect(holed.volume).toBeLessThan(12000 - 0.99 * Math.PI * 4 * 10);
    expect(holed.volume).toBeGreaterThan(12000 - Math.PI * 4 * 10);
    expect(holed.centerOfMass).toEqual(near([20, 15, 5], 4)); // the hole is in the middle
    // a hole off the middle
    run(engine, addSketch('sH', XY), circle('sH', 'h', 30, 15, 5), span('hole', 'sH', [['h']], 0, 10, 'cut', ['A']));
    const off = mass(engine, { bodies: ['A'], density: PLA });
    expect(off.centerOfMass[0]).toBeLessThan(19.5);
    expect(off.centerOfMass[1]).toBeCloseTo(15, 3);
    // before the hole was cut
    expect(mass(engine, { bodies: ['A'], density: PLA }, { at: 'A' }).volume).toBeCloseTo(holed.volume, 9);
  });

  it('the density of a body: by body first, then for all; the fill factor goes with the one for all', () => {
    const engine = model();
    whole(engine);
    // B is a bought part with its own density, A is printed with 40 % of its volume as material
    const mixed = mass(engine, { bodies: ['A', 'B'], densities: { B: 2.9 }, density: PLA, fill: 0.4 });
    expect(mixed.bodies).toEqual([
      { body: 'A', mass: expect.closeTo(14.88 * 0.4, 6), volume: expect.closeTo(12000, 3), density: PLA, fill: 0.4, centerOfMass: expect.anything() },
      { body: 'B', mass: expect.closeTo(8.7, 6), volume: expect.closeTo(3000, 3), density: 2.9, fill: 1, centerOfMass: expect.anything() },
    ]);
    expect(mixed.mass).toBeCloseTo(14.88 * 0.4 + 8.7, 6);
    // the inertia scales with the fill factor as the mass does
    const solid = mass(engine, { bodies: ['A'], density: PLA });
    const sparse = mass(engine, { bodies: ['A'], density: PLA, fill: 0.4 });
    expect(sparse.mass).toBeCloseTo(0.4 * solid.mass, 9);
    expect(sparse.inertia[2][2]).toBeCloseTo(0.4 * solid.inertia[2][2], 6);
    expect(sparse.centerOfMass).toEqual(solid.centerOfMass);
    // review: an answer changed by its reader does not change the next one (the centre of a body is remembered by its mesh)
    sparse.bodies[0].centerOfMass[0] = -1;
    sparse.centerOfMass[1] = -1;
    sparse.inertia[2][2] = -1;
    expect(mass(engine, { bodies: ['A'], density: PLA, fill: 0.4 })).toMatchObject({ centerOfMass: solid.centerOfMass, bodies: [{ centerOfMass: solid.centerOfMass }], inertia: [expect.anything(), expect.anything(), near([0, 0, 0.4 * solid.inertia[2][2]], 6)] });
    // every body by `densities`: `density` is not needed
    expect(mass(engine, { bodies: ['A', 'B'], densities: { A: 1, B: 2 } }).mass).toBeCloseTo(12 + 6, 6);
    // a density for a body that is not asked about is allowed and does nothing
    expect(mass(engine, { bodies: ['A'], densities: { A: 1, B: 2 } }).mass).toBeCloseTo(12, 6);
  });

  it('errors: a body without a density, a fill factor for nobody, a body that is not there', () => {
    const engine = model();
    expect(engine.query('mass', { bodies: ['A'] })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['density'], message: expect.stringContaining('the body "A" has no density of its own') } });
    expect(engine.query('mass', { bodies: ['A', 'B'], densities: { A: 1 } })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['density'], message: expect.stringContaining('"B"') } });
    // B has its own density here, so the fill factor reaches nobody: refused, not ignored
    expect(engine.query('mass', { bodies: ['B'], densities: { B: 2.9 }, fill: 0.4 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['fill'] } });
    expect(engine.query('mass', { bodies: ['B'], densities: { B: 2.9 }, fill: 1 })).toMatchObject({ ok: true });
    // the body without a density is reported before the fill factor
    expect(engine.query('mass', { bodies: ['A', 'B'], densities: { B: 2.9 }, fill: 0.4 })).toMatchObject({ ok: false, error: { arg: ['density'] } });
    expect(engine.query('mass', { bodies: ['A'], densities: { nope: 1 }, density: 1 })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['densities', 'nope'] } });
    expect(engine.query('mass', { bodies: ['A', 'nope'], density: 1 })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['bodies', 1] } });
    expect(engine.query('mass', { bodies: [], density: 1 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['bodies'] } });
    expect(engine.query('mass', { bodies: ['A'], density: 0 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['density'] } });
    expect(engine.query('mass', { bodies: ['A'], density: 1001 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['density'] } });
    expect(engine.query('mass', { bodies: ['A'], density: 1e-322 })).toMatchObject({ ok: false, error: { code: 'failed' } }); // a mass of zero
    expect(engine.query('mass', { bodies: ['A'], density: 1, fill: 1.5 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['fill'] } });
    expect(engine.query('mass', { bodies: ['A'], density: 1, fill: 0 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['fill'] } });
    expect(engine.query('mass', { bodies: ['A'], densities: { A: -1 } })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['densities', 'A'] } });
    expect(engine.query('mass', { bodies: ['A'], density: 1, about: { kind: 'sketchPoint', sketch: 'sA', point: 'nope' } })).toMatchObject({ ok: false, error: { arg: ['about', 'point'] } });
    // review: an axis through a point of a sketch whose plane is gone (a face of a body that was removed)
    run(engine, addSketch('sF', { kind: 'face', body: 'B', face: { feature: 'B', role: 'endCap' } }));
    expect(engine.query('mass', { bodies: ['A'], density: 1, about: { kind: 'sketchPoint', sketch: 'sF', point: 'origin' } })).toMatchObject({ ok: true });
    const without = engine.preview({ type: 'removeFeature', id: 'B' });
    if (!without.ok) throw new Error(without.error.message);
    expect(engine.query('mass', { bodies: ['A'], density: 1, about: { kind: 'sketchPoint', sketch: 'sF', point: 'origin' } }, { state: without.state })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['about'] } });
    // B is not there yet after A
    expect(engine.query('mass', { bodies: ['B'], density: 1 }, { at: 'A' })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['bodies', 0] } });
  });

  it('a name that every object has by inheritance is no body and no key of a record', () => {
    // The engine refuses such an ID for a feature, so no body can have it; the query still reads
    // `densities` by its own keys only, and the check of the arguments refuses such a key.
    const engine = model();
    expect(engine.execute(span('constructor', 'sA', [rectLoop('a')], 0, 10)).ok).toBe(false);
    expect(engine.query('mass', { bodies: ['constructor'], density: 1 })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['bodies', 0] } });
    expect(engine.query('mass', { bodies: ['A'], density: 1, densities: { constructor: 3 } })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['densities', 'constructor'] } });
  });
});

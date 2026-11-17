// The generators of 5d (D61) through the engine with the real adapters: every example of the
// catalog builds a body, and a point as an operand is resolved from the solved sketch (an own
// point, the origin, a point of projected geometry; one that is gone is a broken reference).
import { type Command, GENERATORS, type GeneratorName, type Id, emptySketch } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { newEngine, run, status } from './kit';

const generated = (id: Id, sketch: Id, generator: GeneratorName, operands: Record<string, Id>, params: Record<string, unknown>, start = 0): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'generated', generator, sketch, operands, params }, extent: { type: 'distance', start, distance: 4 }, operation: 'new' } as never,
});
// A sketch with a construction circle of radius 25 about the origin and a point at (60, 0).
const sketch = (): Command[] => [
  { type: 'addFeature', feature: emptySketch('S', 'S', { kind: 'base', plane: 'XY' }) },
  { type: 'addCurve', sketch: 'S', id: 'circle', curve: { type: 'circle', center: 'origin', construction: true }, radius: 25 },
  { type: 'addConstraint', sketch: 'S', id: 'r', constraint: { type: 'radius', curve: 'circle', value: 25, driving: true } },
  { type: 'addPoint', sketch: 'S', id: 'p', x: 60, y: 0 },
  { type: 'addConstraint', sketch: 'S', id: 'pFix', constraint: { type: 'fixed', point: 'p', x: 60, y: 0 } },
];
const operandsOf = (generator: GeneratorName): Record<string, Id> => Object.fromEntries(GENERATORS[generator].operands.map((operand) => [operand.field, operand.kinds.includes('circle') ? 'circle' : 'p']));

describe('the generators of the catalog through the engine', () => {
  it('every example builds a body over a circle of radius 25 and a point', () => {
    const engine = newEngine();
    run(engine, { type: 'batch', commands: sketch() });
    (Object.keys(GENERATORS) as GeneratorName[]).forEach((generator, i) => {
      const state = run(engine, generated(generator, 'S', generator, operandsOf(generator), GENERATORS[generator].example, 10 * i));
      expect(state.evaluation.features[generator].status, generator).toBe('ok');
      expect(state.evaluation.bodies[generator].volume, generator).toBeGreaterThan(0);
    });
  });

  it('a point operand: an own point, the origin and the centre of a projected circle; one that is gone is a broken reference', () => {
    const engine = newEngine();
    run(
      engine,
      {
        type: 'batch',
        commands: [
          ...sketch(),
          { type: 'addCurve', sketch: 'S', id: 'boss', curve: { type: 'circle', center: 'p' }, radius: 3 },
          { type: 'addFeature', feature: { id: 'shaft', name: 'shaft', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['boss'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
          // a sketch on the end of the shaft that projects its rim
          { type: 'addFeature', feature: emptySketch('T', 'T', { kind: 'face', body: 'shaft', face: { feature: 'shaft', role: 'endCap' } }) },
          { type: 'addExternal', sketch: 'T', id: 'rim', ref: { type: 'edge', body: 'shaft', edge: { a: { feature: 'shaft', role: 'endCap' }, b: { feature: 'shaft', role: 'side', curve: 'boss' } }, kind: 'circle' } },
          { type: 'addPoint', sketch: 'T', id: 'q', x: 0, y: 0 },
        ],
      },
    );
    const state = run(
      engine,
      generated('own', 'S', 'gt2Pulley', { center: 'p' }, { teeth: 20 }, 20),
      generated('atOrigin', 'S', 'gt2Pulley', { center: 'origin' }, { teeth: 12 }, 30),
      generated('onShaft', 'T', 'gt2Pulley', { center: 'rim/center' }, { teeth: 16 }),
      generated('gone', 'T', 'gt2Pulley', { center: 'q' }, { teeth: 16 }, 10),
    );
    expect(status(state)).toMatchObject({ own: 'ok', atOrigin: 'ok', onShaft: 'ok', gone: 'ok' });
    expect(state.evaluation.features.own.facts?.center).toEqual([60, 0, 0]);
    expect(state.evaluation.features.atOrigin.facts?.center).toEqual([0, 0, 0]);
    // the pulley on the end of the shaft: its centre is the centre of the projected rim, 10 up
    const onShaft = state.evaluation.features.onShaft.facts?.center as number[];
    expect(onShaft.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([60, 0, 10]);
    expect(state.evaluation.bodies.onShaft.bounds.min[2]).toBeCloseTo(10, 6);
    // the point removed: the pulley over it is a broken reference that names it
    const broken = run(engine, { type: 'removeEntity', sketch: 'T', id: 'q' });
    expect(broken.evaluation.features.gone).toMatchObject({ status: 'error', error: { code: 'brokenReference', refs: ['q'] } });
  });
});

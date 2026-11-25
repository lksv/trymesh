// Mirror and pattern in a sketch (D36 6c, D68) against the real solver and kernel: the kind
// `pattern` of `external`, its copies made after the solver, the occupation pass, the joins by
// position and the open ends, the quoted face keys of the sides of copies, the numeric fields.
// docs/d36/6c-sketch-mirror-pattern/design.md; scenario 15's part is in scenario15.test.ts.
import { describe, expect, it } from 'vitest';
import { type Command, type Engine, type EngineState, type ExternalRef, type Id, type Input, type SketchFeature, type SketchPattern, type SketchResult, emptySketch, entryInput, faceKey, fieldsOf, profileOf, sketchWorld, toolBase } from '@trymesh/engine';
import { solverSetup } from '../../engine/src/sketch';
import { XY, newEngine, run } from './kit';

const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
const resultOf = (state: EngineState, id: Id): SketchResult => state.evaluation.features[id].sketch as SketchResult;
const loops = (state: EngineState, id: Id): Id[][] => resultOf(state, id).regions.map((region) => region.ref.outerLoop);
const point = (sketch: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
const line = (sketch: Id, id: Id, a: Id, b: Id, construction = false): Command => ({ type: 'addCurve', sketch, id, curve: { ...(construction ? { construction: true } : {}), type: 'line', a, b } });
const arc = (sketch: Id, id: Id, center: Id, start: Id, end: Id): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'arc', center, start, end } });
const circle = (sketch: Id, id: Id, center: Id, radius: number): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'circle', center }, radius });
const constrain = (sketch: Id, id: Id, constraint: object): Command => ({ type: 'addConstraint', sketch, id, constraint } as Command);
const addPattern = (sketch: Id, id: Id, ref: Input<SketchPattern>): Command => ({ type: 'addExternal', sketch, id, ref: ref as Input<ExternalRef> });
const sketch = (id: Id): Command => ({ type: 'addFeature', feature: emptySketch(id, id, XY) });
const extrude = (id: Id, sketchId: Id, regions: Id[][], distance: number | string, operation: 'new' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: sketchId, regions: regions.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) }, extent: { type: 'distance', start: 0, distance }, operation, ...(targets ? { targets } : {}) },
});
const refused = (engine: Engine, command: Command): string => {
  const result = engine.execute(command);
  return result.ok ? 'accepted' : result.error.message;
};
const preview = (engine: Engine, command: Command): EngineState => {
  const result = engine.preview(command);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};
// the regions of the step against those of the world a tool builds from the sketch and its result
function sameAsTool(state: EngineState, id: Id): void {
  const world = sketchWorld(toolBase(sketchOf(state, id), resultOf(state, id)));
  const profile = profileOf([...world.curves.values()], world.joins, world.geometry, state.document.settings.chordTolerance);
  expect(profile.valid).toBe(resultOf(state, id).valid);
  expect(profile.regions.map((r) => r.ref)).toEqual(resultOf(state, id).regions.map((r) => r.ref));
}

// The lid half of scenario 15 (W 84, H 54, R 5): `c1` from the origin, the corner arcs, the flank,
// the top `c3` ending at `a5` on the Y axis by a constraint; drawn off its place and solved.
const [W, H, R] = [84, 54, 5];
const LID = W * H - (4 - Math.PI) * R * R;
function lidHalf(engine: Engine, s = 'lid'): EngineState {
  run(engine, { type: 'setParameter', name: 'W', expr: `${W}` }, { type: 'setParameter', name: 'H', expr: `${H}` }, { type: 'setParameter', name: 'R', expr: `${R}` }, sketch(s));
  run(engine, point(s, 'a1', 37.3, 0.2), point(s, 'q1', 36.8, 5.1), point(s, 'a2', 42.2, 4.7), point(s, 'a3', 41.9, 49.4), point(s, 'q2', 37.3, 48.8), point(s, 'a4', 36.8, 54.3), point(s, 'a5', 0.7, 53.8));
  run(engine, line(s, 'c1', 'origin', 'a1'), arc(s, 'r1', 'q1', 'a1', 'a2'), line(s, 'c2', 'a2', 'a3'), arc(s, 'r2', 'q2', 'a3', 'a4'), line(s, 'c3', 'a4', 'a5'));
  return run(
    engine,
    constrain(s, 'k1', { type: 'horizontal', line: 'c1' }),
    constrain(s, 'k2', { type: 'vertical', line: 'c2' }),
    constrain(s, 'k3', { type: 'horizontal', line: 'c3' }),
    constrain(s, 'k4', { type: 'tangent', a: 'c1', b: 'r1' }),
    constrain(s, 'k5', { type: 'tangent', a: 'r1', b: 'c2' }),
    constrain(s, 'k6', { type: 'tangent', a: 'c2', b: 'r2' }),
    constrain(s, 'k7', { type: 'tangent', a: 'r2', b: 'c3' }),
    constrain(s, 'k8', { type: 'radius', curve: 'r1', value: 'R', driving: true }),
    constrain(s, 'k9', { type: 'equalRadius', a: 'r1', b: 'r2' }),
    constrain(s, 'k10', { type: 'horizontalDistance', a: 'origin', b: 'a2', value: 'W / 2', driving: true }),
    constrain(s, 'k11', { type: 'verticalDistance', a: 'origin', b: 'a4', value: 'H', driving: true }),
    constrain(s, 'k12', { type: 'pointOnCurve', point: 'a5', curve: 'origin/y' }),
  );
}
const MIRROR: Input<SketchPattern> = { type: 'pattern', sources: ['c1', 'r1', 'c2', 'r2', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } };
const LID_REGION = ['c1', 'c2', 'c3', 'm/1/c1', 'm/1/c2', 'm/1/c3', 'm/1/r1', 'm/1/r2', 'r1', 'r2'];

describe('a mirror closes a half into one region (scenario 15, step 4)', () => {
  it('the lid half mirrored about origin/y: one region of both halves, the copies after the solver', () => {
    const engine = newEngine();
    const half = lidHalf(engine);
    const stamp = sketchOf(half, 'lid').solved.inputs;
    const state = run(engine, addPattern('lid', 'm', MIRROR));
    const result = resultOf(state, 'lid');
    expect(result.valid).toBe(true);
    expect(loops(state, 'lid')).toEqual([LID_REGION]);
    // the reflected arc runs from the image of the source's end
    expect(result.curves['m/1/r1']).toEqual({ shape: { type: 'arc', center: 'm/1/q1', start: 'm/1/a2', end: 'm/1/a1' }, source: 'derived', regions: true });
    expect(result.points['m/1/a2'].x).toBeCloseTo(-W / 2, 9);
    expect(result.degreesOfFreedom).toBe(0);
    expect(result.openEnds).toBeUndefined();
    expect(state.evaluation.features.lid.status).toBe('ok');
    // the copies are in no input of the solver: the stamp is that of the half
    expect(sketchOf(state, 'lid').solved.inputs).toBe(stamp);
    sameAsTool(state, 'lid');
    // the lid: the region's area by the volume, the side of a copy named with its ID quoted
    const lid = run(engine, extrude('L', 'lid', [LID_REGION], 2));
    expect(lid.evaluation.bodies.L.volume).toBeCloseTo(LID * 2, 0);
    expect(Math.abs(lid.evaluation.bodies.L.volume - LID * 2)).toBeLessThan(0.4);
    const side = lid.evaluation.faceNames.find((name) => name.role === 'side' && name.curve === 'm/1/c2');
    expect(side && faceKey(side)).toBe('L/side/"m/1/c2"');
    // the width moves the copy
    const wider = preview(engine, { type: 'setParameter', name: 'W', expr: '90' });
    expect(resultOf(wider, 'lid').points['m/1/a2'].x).toBeCloseTo(-45, 6);
    expect(Math.abs(wider.evaluation.bodies.L.volume - (90 * H - (4 - Math.PI) * R * R) * 2)).toBeLessThan(0.4);
  });

  it('an end 0.01 mm off the axis: no region, and the open end with its distance', () => {
    const engine = newEngine();
    run(engine, sketch('o'), point('o', 'e1', 10, 0), point('o', 'e2', 10, 8), point('o', 'e5', 0.01, 8), line('o', 'o1', 'origin', 'e1'), line('o', 'o2', 'e1', 'e2'), line('o', 'o3', 'e2', 'e5'));
    const state = run(engine, addPattern('o', 'm', { type: 'pattern', sources: ['o1', 'o2', 'o3'], transform: { type: 'mirror', axis: 'origin/y' } }));
    const result = resultOf(state, 'o');
    expect(result.valid).toBe(true);
    expect(result.regions).toHaveLength(0);
    expect(result.openEnds?.count).toBe(1);
    expect(result.openEnds?.ends.map((end) => [end.end, end.reason, end.near])).toEqual([['m/1/e5', 'apart', ['e5']]]);
    expect(result.openEnds?.ends[0].distance).toBeCloseTo(0.02, 9);
    expect(state.evaluation.features.o.warnings).toEqual([]);
  });

  it('a D whose diameter lies on the axis: the image of the diameter forms no regions', () => {
    const engine = newEngine();
    run(engine, sketch('d'), point('d', 'top', 0, 10), point('d', 'bot', 0, -10), arc('d', 'h', 'origin', 'bot', 'top'), line('d', 'dia', 'top', 'bot'));
    const state = run(engine, addPattern('d', 'm', { type: 'pattern', sources: ['h', 'dia'], transform: { type: 'mirror', axis: 'origin/y' } }));
    expect(loops(state, 'd')).toEqual([['dia', 'h'], ['dia', 'm/1/h']]);
    expect(resultOf(state, 'd').curves['m/1/dia'].regions).toBe(false);
    sameAsTool(state, 'd');
  });
});

describe('patterns', () => {
  it('a ring of teeth closed by a circular pattern of an open chain; 23 leave it open', () => {
    const engine = newEngine();
    const polar = (r: number, degrees: number): [number, number] => [r * Math.cos((degrees * Math.PI) / 180), r * Math.sin((degrees * Math.PI) / 180)];
    run(engine, sketch('g'), point('g', 't0', ...polar(20, 0)), point('g', 't1', ...polar(24, 5)), point('g', 't2', ...polar(24, 10)), point('g', 't3', ...polar(20, 15)), line('g', 'l1', 't0', 't1'), line('g', 'l2', 't1', 't2'), line('g', 'l3', 't2', 't3'));
    const closed = run(engine, addPattern('g', 'teeth', { type: 'pattern', sources: ['l1', 'l2', 'l3'], transform: { type: 'circular', center: 'origin', count: 24, span: { type: 'full' } } }));
    expect(loops(closed, 'g')).toHaveLength(1);
    expect(loops(closed, 'g')[0]).toHaveLength(72);
    expect(resultOf(closed, 'g').openEnds).toBeUndefined();
    const open = preview(engine, { type: 'setField', feature: 'g', path: 'external/teeth/transform/count', value: 23 });
    expect(loops(open, 'g')).toHaveLength(0);
    expect(resultOf(open, 'g').valid).toBe(true);
    expect(resultOf(open, 'g').openEnds?.count).toBe(44);
    expect(resultOf(open, 'g').openEnds?.ends).toHaveLength(20);
    expect(resultOf(open, 'g').openEnds?.ends[0].distance).toBeCloseTo(0.2277, 3);
  });

  it('a bolt circle: six holes of a flange, eight by the count, copy 3 turned by π', () => {
    const engine = newEngine();
    run(engine, sketch('f'), circle('f', 'rim', 'origin', 30), point('f', 'b1', 22, 0), circle('f', 'bolt', 'b1', 1.6), addPattern('f', 'bc', { type: 'pattern', sources: ['bolt'], transform: { type: 'circular', center: 'origin', count: 6, span: { type: 'full' } } }), extrude('flange', 'f', [['rim']], 4));
    const six = engine.getState();
    expect(loops(six, 'f')).toHaveLength(7);
    expect(resultOf(six, 'f').points['bc/3/b1'].x).toBeCloseTo(-22, 9);
    const volume = (n: number): number => (Math.PI * 900 - n * Math.PI * 1.6 * 1.6) * 4;
    expect(Math.abs(six.evaluation.bodies.flange.volume - volume(6))).toBeLessThan(5);
    const eight = preview(engine, { type: 'setField', feature: 'f', path: 'external/bc/transform/count', value: 8 });
    expect(Math.abs(eight.evaluation.bodies.flange.volume - volume(8))).toBeLessThan(5);
  });
});

// A square `q` (2..12 × 0..10) with a point `b` at its middle, a construction line `ax` at x = 20 and
// a circle `cc`; a row of them along X with the count `n`, and a mirror about origin/y.
function consumers(engine: Engine): EngineState {
  run(engine, { type: 'setParameter', name: 'n', expr: '3' }, sketch('k'));
  run(engine, point('k', 'q1', 2, 0), point('k', 'q2', 12, 0), point('k', 'q3', 12, 10), point('k', 'q4', 2, 10), point('k', 'b', 7, 5), point('k', 'x1', 30, 0), point('k', 'x2', 30, 10), point('k', 'cp', 5, 25));
  run(engine, line('k', 'qa', 'q1', 'q2'), line('k', 'qb', 'q2', 'q3'), line('k', 'qc', 'q3', 'q4'), line('k', 'qd', 'q4', 'q1'), line('k', 'ax', 'x1', 'x2', true), circle('k', 'cc', 'cp', 3));
  for (const [id, p] of [['f1', 'q1'], ['f2', 'q2'], ['f3', 'q3'], ['f4', 'q4'], ['f5', 'b'], ['f6', 'x1'], ['f7', 'x2'], ['f8', 'cp']]) run(engine, constrain('k', id, { type: 'fixed', point: p }));
  return run(
    engine,
    addPattern('k', 'r', { type: 'pattern', sources: ['qa', 'qb', 'qc', 'qd', 'b', 'cc'], transform: { type: 'linear', direction: 'origin/x', count: 'n', span: { type: 'spacing', spacing: 40 } } }),
    addPattern('k', 'm', { type: 'pattern', sources: ['qa', 'qb', 'qc', 'qd', 'b', 'ax', 'cc'], transform: { type: 'mirror', axis: 'origin/y' } }),
  );
}
const copyOf = (entry: Id, n: number): Id[] => ['qa', 'qb', 'qc', 'qd'].map((id) => `${entry}/${n}/${id}`);

describe('what reads a copy', () => {
  it('a region of a copy extruded with an offset and a taper, and a copy tag of a later pattern of the body', () => {
    const engine = newEngine();
    const state = consumers(engine);
    expect(resultOf(state, 'k').valid).toBe(true);
    sameAsTool(state, 'k');
    const plain = run(engine, extrude('E', 'k', [copyOf('m', 1)], 2));
    expect(plain.evaluation.bodies.E.volume).toBeCloseTo(200, 6);
    const grown = preview(engine, { type: 'updateFeature', id: 'E', patch: { profile: { offset: 1 } } } as Command);
    expect(grown.evaluation.features.E.status).toBe('ok');
    expect(grown.evaluation.bodies.E.volume).toBeGreaterThan(200);
    const tapered = preview(engine, { type: 'updateFeature', id: 'E', patch: { extent: { taper: 0.1 } } } as Command);
    expect(tapered.evaluation.features.E.status).toBe('ok');
    expect(Math.abs(tapered.evaluation.bodies.E.volume - 200)).toBeGreaterThan(1);
    const copied = run(engine, { type: 'addFeature', feature: { id: 'p', name: 'p', suppressed: false, type: 'pattern', source: { type: 'body', body: 'E' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'spacing', spacing: 50 } } } } as Command);
    const keys = copied.evaluation.faceNames.map((name) => faceKey(name));
    expect(keys).toContain('E/side/"m/1/qa"');
    expect(keys).toContain('E/side/"m/1/qa"/@p:1');
  });

  it('a revolve about a copied line, a generator at a copied point; a hole and a wall at a copy refused', () => {
    const engine = newEngine();
    consumers(engine);
    const revolve: Command = { type: 'addFeature', feature: { id: 'V', name: 'V', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 'k', regions: [{ outerLoop: [...copyOf('m', 1)].sort() }] }, axis: { kind: 'sketchLine', sketch: 'k', line: 'm/1/ax' }, extent: { type: 'full' }, operation: 'new' } } as Command;
    const revolved = preview(engine, revolve);
    expect(revolved.evaluation.features.V.status).toBe('ok');
    // the square 10 × 10 from 18 to 28 mm off the axis at x = −30: 2π · 23 · 100
    expect(Math.abs(revolved.evaluation.bodies.V.volume - 2 * Math.PI * 23 * 100)).toBeLessThan(5);
    const pulley: Command = { type: 'addFeature', feature: { id: 'G', name: 'G', suppressed: false, type: 'extrude', profile: { type: 'generated', generator: 'gt2Pulley', sketch: 'k', operands: { center: 'r/2/b' }, params: { teeth: 12 } }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } } as Command;
    const generated = run(engine, pulley);
    expect(generated.evaluation.features.G.status).toBe('ok');
    expect(generated.evaluation.bodies.G.bounds.min[0] + generated.evaluation.bodies.G.bounds.max[0]).toBeCloseTo(2 * 87, 3);
    // the count drops below the copy the generator names, and comes back
    const two = preview(engine, { type: 'setParameter', name: 'n', expr: '2' });
    expect(two.evaluation.features.G.error?.code).toBe('brokenReference');
    expect(run(engine, { type: 'setParameter', name: 'n', expr: '4' }).evaluation.features.G.status).toBe('ok');
    run(engine, extrude('P', 'k', [['qa', 'qb', 'qc', 'qd']], 2));
    const hole = refused(engine, { type: 'addFeature', feature: { id: 'H', name: 'H', suppressed: false, type: 'hole', sketch: 'k', points: ['m/1/b'], shape: { type: 'plain', diameter: 3 }, extent: { type: 'throughAll', side: 'backward' }, targets: ['P'] } } as Command);
    expect(hole).toContain('"m/1/b" is a copy of the mirror or pattern "m"');
    const wall = refused(engine, { type: 'addFeature', feature: { id: 'Wl', name: 'Wl', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 'k', curves: ['m/1/qa'], thickness: 1 }, extent: { type: 'distance', start: 0, distance: 3 }, operation: 'new' } } as Command);
    expect(wall).toContain('"m/1/qa" is a copy of the mirror or pattern "m"');
  });

  it('a lower count makes the cut of a copy noProfile, a higher one brings it back unchanged; the stamp stays', () => {
    const engine = newEngine();
    consumers(engine);
    const state = run(engine, extrude('E', 'k', [copyOf('r', 2)], 2));
    const stamp = sketchOf(state, 'k').solved.inputs;
    const two = preview(engine, { type: 'setParameter', name: 'n', expr: '2' });
    expect(two.evaluation.features.E.error).toMatchObject({ code: 'noProfile', refs: [{ outerLoop: [...copyOf('r', 2)].sort() }] });
    expect(sketchOf(two, 'k').solved.inputs).toBe(stamp);
    const five = run(engine, { type: 'setParameter', name: 'n', expr: '5' });
    expect(five.evaluation.features.E.status).toBe('ok');
    expect(sketchOf(five, 'k').solved.inputs).toBe(stamp);
    // the count is a field of the sketch: written back as a number, its expression kept
    expect((sketchOf(five, 'k').external.r as SketchPattern).transform).toMatchObject({ count: 5 });
    expect(sketchOf(five, 'k').expressions).toEqual({ 'external/r/transform/count': 'n' });
    expect(fieldsOf(sketchOf(five, 'k')).map((field) => field.path)).toContain('external/r/transform/count');
    expect(entryInput(sketchOf(five, 'k'), 'r')).toMatchObject({ transform: { count: 'n' } });
    // the solver never sees a copy
    expect(Object.keys(solverSetup(sketchOf(five, 'k'), {}).input.curves).some((id) => id.includes('/'))).toBe(false);
  });
});

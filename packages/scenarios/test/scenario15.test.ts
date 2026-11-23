// Validation scenario 15 (docs/requirements.md, item 15), the part of package 6e (D65): a cable
// notch trimmed into the outline of the base, two overlapping pads split and trimmed into one
// outline, a line extended to an edge, and the refusals. Written after
// docs/d36/6e-trim-extend-split/calls.ts, against the real solver and kernel.
import { describe, expect, it } from 'vitest';
import { type Command, type Engine, type EngineState, type Expr, type Id, type SketchToolInputs, emptySketch, freshIds, sketchTool } from '@trymesh/engine';
import { XY, newEngine, volume } from './kit';

type CutTool = 'trim' | 'extend' | 'split';

function run(engine: Engine, ...commands: Command[]): EngineState {
  const result = engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}
const dimension = (sketch: Id, id: Id, type: 'horizontalDistance' | 'verticalDistance', a: Id, b: Id, value: number | Expr): Command => ({ type: 'addConstraint', sketch, id, constraint: { type, a, b, value, driving: true } });
const pointAt = (sketch: Id, id: Id, x: Expr, y: Expr): Command[] => [{ type: 'addPoint', sketch, id, x: 1, y: 1 }, dimension(sketch, `${id}x`, 'horizontalDistance', 'origin', id, x), dimension(sketch, `${id}y`, 'verticalDistance', 'origin', id, y)];
// A rectangle with a corner at the origin: `${p}a` (bottom), `${p}b` (right), `${p}c` (top), `${p}d` (left).
function rectangle(sketch: Id, p: string, width: Expr, height: Expr): Command[] {
  const corners: [number, number][] = [
    [0, 0],
    [10, 1],
    [11, 9],
    [1, 10],
  ];
  return [
    ...corners.map(([x, y], i): Command => ({ type: 'addPoint', sketch, id: `${p}${i + 1}`, x, y })),
    ...['a', 'b', 'c', 'd'].map((name, i): Command => ({ type: 'addCurve', sketch, id: `${p}${name}`, curve: { type: 'line', a: `${p}${i + 1}`, b: `${p}${((i + 1) % 4) + 1}` } })),
    { type: 'addConstraint', sketch, id: `${p}h1`, constraint: { type: 'horizontal', line: `${p}a` } },
    { type: 'addConstraint', sketch, id: `${p}v1`, constraint: { type: 'vertical', line: `${p}b` } },
    { type: 'addConstraint', sketch, id: `${p}h2`, constraint: { type: 'horizontal', line: `${p}c` } },
    { type: 'addConstraint', sketch, id: `${p}v2`, constraint: { type: 'vertical', line: `${p}d` } },
    { type: 'addConstraint', sketch, id: `${p}fix`, constraint: { type: 'coincident', a: `${p}1`, b: 'origin' } },
    dimension(sketch, `${p}w`, 'horizontalDistance', `${p}1`, `${p}2`, width),
    dimension(sketch, `${p}h`, 'verticalDistance', `${p}2`, `${p}3`, height),
  ];
}
const contextOf = (state: EngineState, sketch: Id) => {
  const feature = state.document.features.find((f) => f.id === sketch);
  if (feature?.type !== 'sketch') throw new Error(`no sketch "${sketch}"`);
  return { sketch: feature, result: state.evaluation.features[sketch].sketch, parameters: state.evaluation.parameters, document: state.document };
};
function tool<K extends CutTool>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix: string): Record<string, Id[]> {
  const state = engine.getState();
  const made = sketchTool(name, contextOf(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) throw new Error(made.message);
  run(engine, ...made.commands);
  return made.ids;
}
function refusal<K extends CutTool>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K]): string | undefined {
  const state = engine.getState();
  const made = sketchTool(name, contextOf(state, sketch), input, freshIds(state.document, 'x_'));
  return made.ok ? undefined : made.message;
}
const regionsOf = (state: EngineState, feature: Id): Id[][] => {
  const f = state.document.features.find((g) => g.id === feature);
  return f?.type === 'extrude' && f.profile.type === 'regions' ? f.profile.regions.map((r) => r.outerLoop) : [];
};
const bodyVolume = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const allOk = (state: EngineState): boolean => state.document.features.every((feature) => state.evaluation.features[feature.id].status === 'ok');
// The area of the circle above the edge, by hand: the circle less the segment below the chord.
const above = (centreY: number, r: number): number => {
  const segment = (d: number): number => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
  return centreY >= 0 ? Math.PI * r * r - segment(centreY) : segment(-centreY);
};
const expectedVolume = (W: number, H: number, T: number, cableD: number, notchY: number): number => (W * H - above(notchY, cableD / 2)) * T;

// The base: an outline of own lines W × H with a corner at the origin, extruded T; a circle of the
// diameter `cableD` whose centre is `notchY` above the middle of the bottom edge.
function baseWithNotch(engine: Engine): EngineState {
  run(engine, { type: 'setParameter', name: 'W', expr: '84' }, { type: 'setParameter', name: 'H', expr: '54' }, { type: 'setParameter', name: 'T', expr: '2' });
  run(engine, { type: 'setParameter', name: 'cableD', expr: '8' }, { type: 'setParameter', name: 'notchY', expr: '1.5' });
  run(engine, { type: 'addFeature', feature: emptySketch('baseSketch', 'baseSketch', XY) }, ...rectangle('baseSketch', 'b', 'W', 'H'));
  run(engine, { type: 'addFeature', feature: { id: 'base', name: 'base', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'baseSketch', regions: [{ outerLoop: ['ba', 'bb', 'bc', 'bd'] }] }, extent: { type: 'distance', start: 0, distance: 'T' }, operation: 'new' } });
  return run(
    engine,
    ...pointAt('baseSketch', 'nc', 'W / 2', 'notchY'),
    { type: 'addCurve', sketch: 'baseSketch', id: 'notch', curve: { type: 'circle', center: 'nc' }, radius: 4 },
    { type: 'addConstraint', sketch: 'baseSketch', id: 'notchD', constraint: { type: 'diameter', curve: 'notch', value: 'cableD', driving: true } },
  );
}

describe('scenario 15, the part of 6e: trim, extend and split', () => {
  const engine = newEngine();

  it('a cable notch: two trims leave the notched outline, the base patched in the same batches', () => {
    const before = baseWithNotch(engine);
    expect(before.evaluation.features['baseSketch'].sketch?.valid).toBe(false);
    expect(before.evaluation.features['base'].error?.code).toBe('invalidProfile');
    // trim 1: the piece of the circle below the edge; the circle becomes an arc under its ID and
    // the edge is cut at the two crossings
    const first = tool(engine, 'trim', 'baseSketch', { curve: 'notch', at: [42, -3] }, 't1_');
    const afterFirst = engine.getState();
    expect(first.changed).toEqual(['ba', 'notch']);
    expect(first.added).toHaveLength(2);
    expect(first.points).toHaveLength(2);
    expect(first.patched).toEqual(['base']);
    expect(regionsOf(afterFirst, 'base')).toHaveLength(2);
    const sketchAfter = afterFirst.evaluation.features['baseSketch'].sketch;
    expect(sketchAfter?.valid).toBe(true);
    expect(sketchAfter?.degreesOfFreedom).toBe(0);
    expect(sketchAfter?.redundant).toEqual([]);
    expect(bodyVolume(afterFirst, 'base')).toBeCloseTo(84 * 54 * 2, 6);
    const notch = afterFirst.document.features.find((f) => f.id === 'baseSketch');
    expect(notch?.type === 'sketch' && notch.curves['notch'].type).toBe('arc');
    expect(notch?.type === 'sketch' && notch.constraints['notchD']).toMatchObject({ type: 'diameter', curve: 'notch' });
    expect(notch?.type === 'sketch' && notch.expressions?.['constraints/notchD/value']).toBe('cableD');
    // trim 2: the piece of the edge inside the circle, now a curve with no cut inside it
    const inner = first.added[0];
    const second = tool(engine, 'trim', 'baseSketch', { curve: inner, at: [42, 0] }, 't2_');
    const state = engine.getState();
    expect(second.removed).toContain(inner);
    expect(second.dropped).toEqual(['base']);
    const loop = regionsOf(state, 'base');
    expect(loop).toHaveLength(1);
    expect(loop[0]).toContain('notch');
    expect(loop[0]).toContain('ba');
    expect(loop[0]).not.toContain(inner);
    expect(state.evaluation.features['baseSketch'].sketch?.degreesOfFreedom).toBe(0);
    expect(bodyVolume(state, 'base')).toBeCloseTo(expectedVolume(84, 54, 2, 8, 1.5), -1);
    expect(Math.abs(bodyVolume(state, 'base') - expectedVolume(84, 54, 2, 8, 1.5))).toBeLessThan(84 * 54 * 2 * 1e-4);
    expect(state.evaluation.faceNames.filter((name) => name.feature === 'base' && name.role === 'side')).toHaveLength(6);
    expect(allOk(state)).toBe(true);
  });

  it('the notch follows its parameters; a notch off the edge is a conflict of the sketch', () => {
    const cases: [string, string, number, number][] = [
      ['cableD', '12', 12, 1.5],
      ['cableD', '5', 5, 1.5],
      ['notchY', '-1', 8, -1],
    ];
    for (const [name, expr, d, y] of cases) {
      const previewed = engine.preview({ type: 'setParameter', name, expr });
      if (!previewed.ok) throw new Error(previewed.error.message);
      expect(allOk(previewed.state)).toBe(true);
      expect(Math.abs(bodyVolume(previewed.state, 'base') - expectedVolume(84, 54, 2, d, y))).toBeLessThan(84 * 54 * 2 * 1e-4);
    }
    const away = engine.preview({ type: 'setParameter', name: 'notchY', expr: '6' });
    if (!away.ok) throw new Error(away.error.message);
    expect(away.state.evaluation.features['baseSketch'].warnings.map((w) => w.code)).toContain('sketchConflict');
  });

  it('two overlapping pads: one split, each extrusion keeps its body; the inner pieces trimmed into one outline', () => {
    run(engine, { type: 'addFeature', feature: emptySketch('pads', 'pads', XY) }, ...rectangle('pads', 'A', '40', '30'));
    run(engine, { type: 'addFeature', feature: { id: 'padA', name: 'padA', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'pads', regions: [{ outerLoop: ['Aa', 'Ab', 'Ac', 'Ad'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } });
    run(
      engine,
      ...pointAt('pads', 'B1', '20', '10'),
      ...pointAt('pads', 'B3', '60', '40'),
      { type: 'addPoint', sketch: 'pads', id: 'B2', x: 60, y: 10 },
      { type: 'addPoint', sketch: 'pads', id: 'B4', x: 20, y: 40 },
      ...(['B1', 'B2', 'B3', 'B4'] as const).map((p, i): Command => ({ type: 'addCurve', sketch: 'pads', id: `B${'abcd'[i]}`, curve: { type: 'line', a: p, b: `B${((i + 1) % 4) + 1}` } })),
      { type: 'addConstraint', sketch: 'pads', id: 'Bh1', constraint: { type: 'horizontal', line: 'Ba' } },
      { type: 'addConstraint', sketch: 'pads', id: 'Bv1', constraint: { type: 'vertical', line: 'Bb' } },
      { type: 'addConstraint', sketch: 'pads', id: 'Bh2', constraint: { type: 'horizontal', line: 'Bc' } },
      { type: 'addConstraint', sketch: 'pads', id: 'Bv2', constraint: { type: 'vertical', line: 'Bd' } },
    );
    const crossed = run(engine, { type: 'addFeature', feature: { id: 'padB', name: 'padB', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'pads', regions: [{ outerLoop: ['Ba', 'Bb', 'Bc', 'Bd'] }] }, extent: { type: 'distance', start: 0, distance: 3 }, operation: 'new' } });
    expect(crossed.evaluation.features['padA'].error?.code).toBe('invalidProfile');
    const split = tool(engine, 'split', 'pads', {}, 's_');
    const state = engine.getState();
    expect(split.changed).toEqual(['Ab', 'Ac', 'Ba', 'Bd']);
    expect(split.points).toHaveLength(2);
    expect(split.patched).toEqual(['padA', 'padB']);
    expect(regionsOf(state, 'padA')).toHaveLength(2);
    expect(regionsOf(state, 'padB')).toHaveLength(2);
    expect(bodyVolume(state, 'padA')).toBeCloseTo(6000, 6);
    expect(bodyVolume(state, 'padB')).toBeCloseTo(3600, 6);
    expect(state.evaluation.features['pads'].sketch?.degreesOfFreedom).toBe(0);
    // one undo takes the split back, the patches included
    engine.undo();
    expect(regionsOf(engine.getState(), 'padA')[0]).toEqual(['Aa', 'Ab', 'Ac', 'Ad']);
    engine.redo();
    // the inner pieces, each trimmed at a point of it
    const inner: [Id, [number, number]][] = [
      [split.added[0], [40, 20]],
      ['Ac', [30, 30]],
      ['Ba', [30, 10]],
      [split.added[3], [20, 20]],
    ];
    for (const [curve, at] of inner) {
      tool(engine, 'trim', 'pads', { curve, at }, `u_${curve}_`);
      expect(engine.getState().evaluation.features['pads'].sketch?.degreesOfFreedom).toBe(0);
    }
    const union = engine.getState();
    expect(regionsOf(union, 'padA')).toHaveLength(1);
    expect(regionsOf(union, 'padA')[0]).toEqual(regionsOf(union, 'padB')[0]);
    expect(bodyVolume(union, 'padA')).toBeCloseTo(2000 * 5, 6);
    expect(bodyVolume(union, 'padB')).toBeCloseTo(2000 * 3, 6);
  });

  it('a construction line extended to the top edge keeps its length dimension; the edge is not cut', () => {
    run(engine, ...pointAt('baseSketch', 'ea', '10', '10'), { type: 'addPoint', sketch: 'baseSketch', id: 'eb', x: 10, y: 20 }, { type: 'addCurve', sketch: 'baseSketch', id: 'rib', curve: { type: 'line', a: 'ea', b: 'eb', construction: true } });
    run(engine, { type: 'addConstraint', sketch: 'baseSketch', id: 'ribV', constraint: { type: 'vertical', line: 'rib' } }, { type: 'addConstraint', sketch: 'baseSketch', id: 'ribL', constraint: { type: 'distance', a: 'ea', b: 'eb', value: 10, driving: true } });
    const ids = tool(engine, 'extend', 'baseSketch', { curve: 'rib', end: 'b' }, 'e_');
    const state = engine.getState();
    const sketch = state.document.features.find((f) => f.id === 'baseSketch');
    const end = sketch?.type === 'sketch' && sketch.curves['rib'].type === 'line' ? sketch.curves['rib'].b : '';
    expect(ids.changed).toEqual(['rib']);
    expect(ids.patched).toEqual([]);
    expect(ids.constraints).toHaveLength(2);
    expect(state.evaluation.features['baseSketch'].sketch?.points[end].y).toBeCloseTo(54, 6);
    expect(state.evaluation.features['baseSketch'].sketch?.points['eb'].y).toBeCloseTo(20, 6);
    expect(state.evaluation.features['baseSketch'].sketch?.degreesOfFreedom).toBe(0);
    expect(allOk(state)).toBe(true);
  });

  it('refusals: each says why and nothing is drawn', () => {
    const reasons = [
      refusal(engine, 'trim', 'baseSketch', { curve: 'noSuchCurve', at: [0, 0] }),
      refusal(engine, 'split', 'baseSketch', { curve: 'bd' }),
      refusal(engine, 'extend', 'baseSketch', { curve: 'rib', end: 'b' }),
      refusal(engine, 'extend', 'baseSketch', { curve: 'bb', end: 'a' }),
      refusal(engine, 'extend', 'baseSketch', { curve: 'bb', end: 'start' }),
      refusal(engine, 'split', 'baseSketch', { curve: 'bb', with: 'rib' }),
    ];
    expect(reasons.every((reason) => typeof reason === 'string')).toBe(true);
    expect(reasons[0]).toMatch(/no curve "noSuchCurve"/);
    expect(reasons[1]).toMatch(/nothing crosses or touches "bd"/);
    expect(reasons[3]).toMatch(/ends at "b2" too/);
    expect(reasons[4]).toMatch(/has the ends a and b, not "start"/);
    expect(reasons[5]).toMatch(/no contact with "rib"/);
  });
});

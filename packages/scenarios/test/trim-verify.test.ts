// Trim, extend and split (D65): what the design left to verify before the implementation
// (docs/d36/6e-trim-extend-split/design.md, "To verify"), against the real solver and kernel.
import { describe, expect, it } from 'vitest';
import { type Command, type Engine, type EngineState, type Id, type SketchFeature, type SketchToolInputs, freshIds, sketchTool } from '@trymesh/engine';
import { XY, addExtrude, addSketch, cap, circle, constrain, dimension, newEngine, onFace, rectLoop, rectangle, run, side, volume } from './kit';

type CutTool = 'trim' | 'extend' | 'split';
const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
function cut<K extends CutTool>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix = 'x_'): Record<string, Id[]> {
  const state = engine.getState();
  const made = sketchTool(name, { sketch: sketchOf(state, sketch), result: state.evaluation.features[sketch].sketch, parameters: state.evaluation.parameters, document: state.document }, input, freshIds(state.document, prefix));
  if (!made.ok) throw new Error(made.message);
  run(engine, { type: 'batch', commands: made.commands });
  return made.ids;
}
const solved = (state: EngineState, sketch = 's') => state.evaluation.features[sketch].sketch!;
const vol = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const regions = (state: EngineState, feature: Id): Id[][] => {
  const f = state.document.features.find((g) => g.id === feature);
  return f?.type === 'extrude' && f.profile.type === 'regions' ? f.profile.regions.map((r) => r.outerLoop) : [];
};
function preview(engine: Engine, command: Command): EngineState {
  const result = engine.preview(command);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}
const setValue = (id: Id, value: number, sketch = 's'): Command => ({ type: 'setConstraintValue', sketch, id, value });
const fixedLine = (id: Id, a: [number, number], b: [number, number], sketch = 's'): Command[] => [
  { type: 'addPoint', sketch, id: `${id}a`, x: a[0], y: a[1] },
  { type: 'addPoint', sketch, id: `${id}b`, x: b[0], y: b[1] },
  { type: 'addCurve', sketch, id, curve: { type: 'line', a: `${id}a`, b: `${id}b` } },
  constrain(sketch, `${id}fa`, { type: 'fixed', point: `${id}a`, x: a[0], y: a[1] }),
  constrain(sketch, `${id}fb`, { type: 'fixed', point: `${id}b`, x: b[0], y: b[1] }),
];

describe('to verify: the face rule over the contact search', () => {
  it('a circle across two sides near a corner (four crossings), trimmed piece by piece', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 2), circle('s', 'k', 57, 3, 5));
    // the piece of the circle outside the plate: it crosses the bottom and the right side
    const first = cut(engine, 'trim', 's', { curve: 'k', at: [62, -1] });
    let state = engine.getState();
    expect(first.changed).toEqual(['k', 'ra', 'rb']);
    expect(solved(state).valid).toBe(true);
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(vol(state, 'plate')).toBeCloseTo(4800, 6);
    // the corner piece of the bottom side (its new piece from the crossing to the corner), then of
    // the right side (its keeper, from the corner to the crossing): the corner is cut away
    expect(first.added).toHaveLength(2);
    cut(engine, 'trim', 's', { curve: first.added[0], at: [59, 0] });
    state = engine.getState();
    expect(solved(state).valid).toBe(true);
    cut(engine, 'trim', 's', { curve: 'rb', at: [60, 1] });
    state = engine.getState();
    expect(solved(state).valid).toBe(true);
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(regions(state, 'plate')).toHaveLength(1);
    expect(state.evaluation.features['plate'].status).toBe('ok');
    // the plate less the part of the disc inside it near the corner
    expect(vol(state, 'plate')).toBeLessThan(4800);
    expect(vol(state, 'plate')).toBeGreaterThan(4800 - Math.PI * 25 * 2);
  });

  it('a face bounded by an arc at a coarse chord tolerance: the regions follow on the exact curves', () => {
    const engine = newEngine();
    const saved = JSON.parse(engine.save());
    saved.settings.chordTolerance = 1;
    engine.load(JSON.stringify(saved));
    run(engine, addSketch('s', XY), rectangle('s', 'b', 0, 0, 80, 50), addExtrude('base', 's', [rectLoop('b')], 10), circle('s', 'k', 40, 2, 6));
    const first = cut(engine, 'trim', 's', { curve: 'k', at: [40, -3] });
    expect(first.patched).toEqual(['base']);
    expect(regions(engine.getState(), 'base')).toHaveLength(2);
    const second = cut(engine, 'trim', 's', { curve: first.added[0], at: [40, 0] });
    expect(second.dropped).toEqual(['base']);
    expect(regions(engine.getState(), 'base')).toEqual([['ba', 'bb', 'bc', 'bd', 'k', first.added[1]].sort()]);
  });

  it('a duplicate side trimmed while a feature names it: the region is kept', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 40, 30), addExtrude('plate', 's', [rectLoop('r')], 2));
    // a second line on the bottom side, from corner to corner
    run(engine, { type: 'addCurve', sketch: 's', id: 'dup', curve: { type: 'line', a: 'r1', b: 'r2' } });
    expect(solved(engine.getState()).valid).toBe(false);
    const ids = cut(engine, 'trim', 's', { curve: 'ra', at: [20, 0] });
    const state = engine.getState();
    expect(ids.removed).toContain('ra');
    expect(solved(state).valid).toBe(true);
    expect(regions(state, 'plate')).toEqual([['dup', 'rb', 'rc', 'rd']]);
    expect(vol(state, 'plate')).toBeCloseTo(2400, 6);
  });

  it('a corner joined by the batch: ends at one place re-pointed or joined, the region closes', () => {
    const engine = newEngine();
    // a triangle whose third side ends at a point of its own at the first corner
    run(
      engine,
      addSketch('s', XY),
      { type: 'addPoint', sketch: 's', id: 'a', x: 0, y: 0 },
      { type: 'addPoint', sketch: 's', id: 'b', x: 30, y: 0 },
      { type: 'addPoint', sketch: 's', id: 'c', x: 0, y: 20 },
      { type: 'addPoint', sketch: 's', id: 'a2', x: 0, y: 0 },
      { type: 'addCurve', sketch: 's', id: 'ab', curve: { type: 'line', a: 'a', b: 'b' } },
      { type: 'addCurve', sketch: 's', id: 'bc', curve: { type: 'line', a: 'b', b: 'c' } },
      { type: 'addCurve', sketch: 's', id: 'ca', curve: { type: 'line', a: 'c', b: 'a2' } },
      constrain('s', 'fa', { type: 'fixed', point: 'a', x: 0, y: 0 }),
      constrain('s', 'fb', { type: 'fixed', point: 'b', x: 30, y: 0 }),
      constrain('s', 'fc', { type: 'fixed', point: 'c', x: 0, y: 20 }),
    );
    expect(solved(engine.getState()).valid).toBe(false);
    const ids = cut(engine, 'split', 's', {});
    const state = engine.getState();
    expect(ids.changed).toEqual(['ca']);
    expect(ids.removed).toEqual(['a2']);
    expect(solved(state).valid).toBe(true);
    expect(solved(state).regions).toHaveLength(1);
    // the point a2 was named by nothing but its line: the line now ends at `a`, and the sketch is
    // as determined as before (a2 was free)
    expect(solved(state).degreesOfFreedom).toBe(0);
  });

  it('joins of determined points: a coincident of two fixed ends is redundant and named by the analysis', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('s', XY),
      { type: 'addPoint', sketch: 's', id: 'a', x: 0, y: 0 },
      { type: 'addPoint', sketch: 's', id: 'b', x: 30, y: 0 },
      { type: 'addPoint', sketch: 's', id: 'c', x: 0, y: 20 },
      { type: 'addPoint', sketch: 's', id: 'a2', x: 0, y: 0 },
      { type: 'addCurve', sketch: 's', id: 'ab', curve: { type: 'line', a: 'a', b: 'b' } },
      { type: 'addCurve', sketch: 's', id: 'bc', curve: { type: 'line', a: 'b', b: 'c' } },
      { type: 'addCurve', sketch: 's', id: 'ca', curve: { type: 'line', a: 'c', b: 'a2' } },
      constrain('s', 'fa', { type: 'fixed', point: 'a', x: 0, y: 0 }),
      constrain('s', 'fb', { type: 'fixed', point: 'b', x: 30, y: 0 }),
      constrain('s', 'fc', { type: 'fixed', point: 'c', x: 0, y: 20 }),
      constrain('s', 'fa2', { type: 'fixed', point: 'a2', x: 0, y: 0 }),
    );
    const ids = cut(engine, 'split', 's', {});
    const state = engine.getState();
    // a2 is named by its own fixed constraint: joined by a coincident, not re-pointed
    expect(ids.constraints).toHaveLength(1);
    expect(sketchOf(state, 's').constraints[ids.constraints[0]]).toMatchObject({ type: 'coincident' });
    expect(solved(state).valid).toBe(true);
    expect(solved(state).redundant.length).toBeGreaterThan(0);
    // the analysis names the newer of the two fixed constraints
    expect(solved(state).redundant).toEqual(['fa2']);
    expect(state.evaluation.features['s'].status).not.toBe('error');
  });
});

describe('to verify: with against the repair', () => {
  it('a trim with `with` past another crossing leaves no crossing', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 2));
    // two lines across the bottom side; the bottom trimmed back to the second, past the first
    run(engine, ...fixedLine('p', [20, -5], [20, 5]), ...fixedLine('q', [40, -5], [40, 5]));
    const ids = cut(engine, 'trim', 's', { curve: 'ra', at: [30, 0], with: 'q' });
    const state = engine.getState();
    // the piece from the start of the bottom side to q goes with the crossing of p inside it, which
    // is cut on neither curve
    expect(ids.changed).toEqual(['q', 'ra']);
    expect(solved(state).valid).toBe(true);
    expect(solved(state).degreesOfFreedom).toBe(0);
  });

  it('an extend with `with` past another curve cuts the stretch at the curve it crosses', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('s', XY),
      rectangle('s', 'r', 0, 0, 60, 40),
      addExtrude('plate', 's', [rectLoop('r')], 2),
      ...fixedLine('m', [30, 5], [30, 35]),
      { type: 'addPoint', sketch: 's', id: 'ea', x: 10, y: 20 },
      { type: 'addPoint', sketch: 's', id: 'eb', x: 20, y: 20 },
      { type: 'addCurve', sketch: 's', id: 'e', curve: { type: 'line', a: 'ea', b: 'eb' } },
      constrain('s', 'efa', { type: 'fixed', point: 'ea', x: 10, y: 20 }),
      constrain('s', 'efb', { type: 'fixed', point: 'eb', x: 20, y: 20 }),
    );
    const ids = cut(engine, 'extend', 's', { curve: 'e', end: 'b', with: 'rb' });
    const state = engine.getState();
    expect(ids.changed).toEqual(['e', 'm', 'rb']);
    expect(solved(state).valid).toBe(true);
    const end = (sketchOf(state, 's').curves[ids.added[0]] as { b: Id }).b;
    expect(solved(state).points[end].x).toBeCloseTo(60, 6);
  });
});

describe('to verify: faces of the pieces', () => {
  it('a split line whose pieces stay in one region: two coplanar side faces; a chamfer of the side takes both edges', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('E', 's', [rectLoop('r')], 20), ...fixedLine('t', [30, -5], [30, 5]));
    const ids = cut(engine, 'split', 's', { curve: 'ra', with: 't' });
    // the line t stays crossing nothing but the side, cut there: trim its outer half, then its inner half
    cut(engine, 'trim', 's', { curve: 't', at: [30, -3] });
    expect(ids.changed).toEqual(['ra', 't']);
    cut(engine, 'trim', 's', { curve: ids.added[1], at: [30, 3] });
    const state = engine.getState();
    expect(solved(state).valid).toBe(true);
    const pieces = ['ra', ids.added[0]];
    expect(state.evaluation.faceNames.filter((f) => f.feature === 'E' && f.role === 'side').map((f) => (f.role === 'side' ? f.curve : '')).sort()).toEqual([...pieces, 'rb', 'rc', 'rd'].sort());
    expect(vol(state, 'E')).toBeCloseTo(48000, 6);
    // a chamfer of the top edge of one piece alone, then of both edges
    const one = engine.preview({ type: 'addFeature', feature: { id: 'c', name: 'c', suppressed: false, type: 'chamfer', body: 'E', edges: [{ a: cap('E'), b: side('E', 'ra') }], distance: 2 } });
    // one edge alone runs on smoothly into the other and is refused with it named (D63)
    expect(one.ok && one.state.evaluation.features['c'].error?.code).toBe('unsupportedEdge');
    const both = run(engine, { type: 'addFeature', feature: { id: 'c', name: 'c', suppressed: false, type: 'chamfer', body: 'E', edges: pieces.map((curve) => ({ a: cap('E'), b: side('E', curve) })), distance: 2 } });
    expect(both.evaluation.features['c'].status).toBe('ok');
    expect(vol(both, 'E')).toBeCloseTo(48000 - 2 * 60, 3);
  });

  it('a circle turned into an arc: a projection of its rim and a fillet of its edge still work', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'b', 0, 0, 80, 50), circle('s', 'k', 40, 10, 6), addExtrude('base', 's', [rectLoop('b')], 10), addExtrude('boss', 's', [['k']], 15));
    run(engine, addSketch('t', onFace('base', cap('base'))), { type: 'addExternal', sketch: 't', id: 'rim', ref: { type: 'edge', body: 'boss', edge: { a: cap('boss'), b: side('boss', 'k') }, kind: 'circle' } });
    run(engine, { type: 'addFeature', feature: { id: 'f', name: 'f', suppressed: false, type: 'fillet', body: 'boss', edges: [{ a: cap('boss'), b: side('boss', 'k') }], radius: 1 } });
    expect(engine.getState().evaluation.features['f'].status).toBe('ok');
    // a line across the circle, split into arcs: the boss keeps its regions, the rim is two arcs now
    run(engine, ...fixedLine('l', [20, 10], [60, 10]));
    const ids = cut(engine, 'split', 's', {});
    const state = engine.getState();
    expect(ids.shortened).toEqual(['t']);
    expect(ids.patched).toEqual(['boss', 'f']);
    expect(state.evaluation.features['boss'].status).toBe('ok');
    // the projection of the rim still finds the circle; the fillet of the rim gets an edge per arc,
    // the first in the place of the old one (D63 asks for both, since one runs smoothly into the
    // other), and works
    expect(state.evaluation.features['t'].status).toBe('ok');
    expect(state.evaluation.features['t'].sketch?.radii['rim']).toBeCloseTo(6, 6);
    const fillet = state.document.features.find((f) => f.id === 'f') as { edges: unknown[] };
    expect(fillet.edges).toEqual(['k', ids.added[0]].map((curve) => ({ a: cap('boss'), b: side('boss', curve) })));
    expect(state.evaluation.features['f'].status).toBe('ok');
  });

  it('the arc of a trimmed circle under a large change: the centre pulled far across the edge', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'b', 0, 0, 80, 50), addExtrude('base', 's', [rectLoop('b')], 10), circle('s', 'k', 40, 2, 6));
    const first = cut(engine, 'trim', 's', { curve: 'k', at: [40, -3] });
    cut(engine, 'trim', 's', { curve: first.added[0], at: [40, 0] });
    for (const y of [-3, -5, 4, 5.5]) {
      const changed = preview(engine, setValue('ky', y));
      expect(changed.evaluation.features['s'].status, `y ${y}`).toBe('ok');
      const arc = sketchOf(changed, 's').curves['k'] as { start: Id; end: Id; center: Id };
      const p = solved(changed).points;
      // the arc that stays runs above the edge: its middle is above y = 0
      const [s0, e0, c0] = [p[arc.start], p[arc.end], p[arc.center]];
      const from = Math.atan2(s0.y - c0.y, s0.x - c0.x);
      const sweep = (((Math.atan2(e0.y - c0.y, e0.x - c0.x) - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      expect(c0.y + 6 * Math.sin(from + sweep / 2), `y ${y}`).toBeGreaterThan(0);
    }
  });
});

describe('to verify: performance', () => {
  it('split of a sketch with many crossings: a grid of 2 × 20 lines across a plate', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 210, 210), addExtrude('plate', 's', [rectLoop('r')], 1));
    const lines: Command[] = [];
    for (let i = 1; i <= 20; i++) lines.push(...fixedLine(`v${i}`, [i * 10, -5], [i * 10, 215]), ...fixedLine(`h${i}`, [-5, i * 10], [215, i * 10]));
    run(engine, ...lines);
    const started = performance.now();
    const state = engine.getState();
    const made = sketchTool('split', { sketch: sketchOf(state, 's'), result: solved(state), parameters: state.evaluation.parameters, document: state.document }, {}, freshIds(state.document, 'g_'));
    const took = performance.now() - started;
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.ids.points.length).toBe(400 + 80);
    expect(took).toBeLessThan(30000);
    return took;
  });
});

// Trim, extend and split (D65) against the real solver and kernel: the cases measured for the
// design (docs/d36/6e-trim-extend-split/design.md, "Measured") as regressions: the freedom of the
// sketch, nothing redundant, the regions of the features followed, and the volumes after changes.
import { describe, expect, it } from 'vitest';
import { type Command, type Engine, type EngineState, type Id, type SketchFeature, type SketchToolInputs, freshIds, sketchTool } from '@trymesh/engine';
import { XY, addExtrude, addSketch, circle, constrain, dimension, newEngine, rectLoop, rectangle, run, volume } from './kit';

type CutTool = 'trim' | 'extend' | 'split';

const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
function cut<K extends CutTool | 'polygon'>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix = 'x_'): Record<string, Id[]> {
  const state = engine.getState();
  const made = sketchTool(name, { sketch: sketchOf(state, sketch), result: state.evaluation.features[sketch].sketch, parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features }, input, freshIds(state.document, prefix));
  if (!made.ok) throw new Error(made.message);
  run(engine, { type: 'batch', commands: made.commands });
  return made.ids;
}
function refused<K extends CutTool>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K]): string {
  const state = engine.getState();
  const made = sketchTool(name, { sketch: sketchOf(state, sketch), result: state.evaluation.features[sketch].sketch, parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features }, input, freshIds(state.document, 'r_'));
  if (made.ok) throw new Error(`${name} was not refused`);
  return made.message;
}
const solved = (state: EngineState, sketch = 's') => state.evaluation.features[sketch].sketch!;
const vol = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const regions = (state: EngineState, feature: Id): Id[][] => {
  const f = state.document.features.find((g) => g.id === feature);
  return (f?.type === 'extrude' || f?.type === 'revolve') && f.profile.type === 'regions' ? f.profile.regions.map((r) => r.outerLoop) : [];
};
function preview(engine: Engine, command: Command): EngineState {
  const result = engine.preview(command);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}
const setValue = (id: Id, value: number, sketch = 's'): Command => ({ type: 'setConstraintValue', sketch, id, value });
// A line fixed by the coordinates of its ends.
const fixedLine = (id: Id, a: [number, number], b: [number, number], sketch = 's'): Command[] => [
  { type: 'addPoint', sketch, id: `${id}a`, x: a[0], y: a[1] },
  { type: 'addPoint', sketch, id: `${id}b`, x: b[0], y: b[1] },
  { type: 'addCurve', sketch, id, curve: { type: 'line', a: `${id}a`, b: `${id}b` } },
  constrain(sketch, `${id}fa`, { type: 'fixed', point: `${id}a`, x: a[0], y: a[1] }),
  constrain(sketch, `${id}fb`, { type: 'fixed', point: `${id}b`, x: b[0], y: b[1] }),
];
const above = (centreY: number, r: number): number => {
  const segment = (d: number): number => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
  return centreY >= 0 ? Math.PI * r * r - segment(centreY) : segment(-centreY);
};

describe('the notch (scenario 15, step 6, on the numbers of the design)', () => {
  const notched = (): Engine => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'b', 0, 0, 80, 50), addExtrude('base', 's', [rectLoop('b')], 10), circle('s', 'k', 40, 2, 6));
    return engine;
  };

  it('the circle first: the arc keeps the ID of the circle, the half disc is dropped; changes follow', () => {
    const engine = notched();
    const first = cut(engine, 'trim', 's', { curve: 'k', at: [40, -3] });
    let state = engine.getState();
    expect(first.changed).toEqual(['ba', 'k']);
    expect(first.patched).toEqual(['base']);
    expect(regions(state, 'base')).toHaveLength(2);
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(solved(state).redundant).toEqual([]);
    expect(vol(state, 'base')).toBeCloseTo(40000, 6);
    const second = cut(engine, 'trim', 's', { curve: first.added[0], at: [40, 0] });
    state = engine.getState();
    expect(second.dropped).toEqual(['base']);
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(vol(state, 'base')).toBeCloseTo(39200.48, 1);
    // the side faces: the four of the outline, the arc and the far piece of the bottom edge
    expect(state.evaluation.faceNames.filter((f) => f.feature === 'base' && f.role === 'side').map((f) => (f.role === 'side' ? f.curve : '')).sort()).toEqual(['ba', 'bb', 'bc', 'bd', 'k', first.added[1]].sort());
    // changes of the dimensions: the volume by hand within the chord tolerance
    for (const [id, value, cy, r, width] of [
      ['kr', 8, 2, 8, 80],
      ['kr', 4, 2, 4, 80],
      ['kx', 30, 2, 6, 80],
      ['ky', -1, -1, 6, 80],
      ['ky', 5, 5, 6, 80],
      ['bw', 60, 2, 6, 60],
    ] as [Id, number, number, number, number][]) {
      const changed = preview(engine, setValue(id, value));
      expect(changed.evaluation.features['s'].status, `${id} ${value}`).toBe('ok');
      expect(Math.abs(vol(changed, 'base') - (width * 50 - above(cy, r)) * 10)).toBeLessThan(width * 50 * 10 * 1e-4);
    }
    const away = preview(engine, setValue('kr', 1.5));
    expect(away.evaluation.features['s'].warnings.map((w) => w.code)).toContain('sketchConflict');
  });

  it('the edge first: the half disc below follows the merged region until its arc is trimmed', () => {
    const engine = notched();
    const first = cut(engine, 'trim', 's', { curve: 'ba', at: [40, 0] });
    let state = engine.getState();
    expect(first.changed).toEqual(['ba', 'k']);
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(regions(state, 'base')).toHaveLength(2);
    expect(vol(state, 'base')).toBeCloseTo(40329.08, 1);
    // the circle is cut into two arcs at the edge; the keeper is the first counter-clockwise from the
    // angle 0, the lower one
    const lower = 'k';
    expect(regions(state, 'base').some((loop) => loop.join() === ['k', first.added[1]].join())).toBe(true);
    const second = cut(engine, 'trim', 's', { curve: lower, at: [40, -3] });
    state = engine.getState();
    expect(second.removed).toContain(lower);
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(regions(state, 'base')).toHaveLength(1);
    expect(vol(state, 'base')).toBeCloseTo(39200.48, 1);
  });
});

describe('a circle split into two arcs', () => {
  it('the boss is patched to the two halves and keeps its body; changes and trims of the line follow', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), circle('s', 'k', 2, 1, 10), addExtrude('boss', 's', [['k']], 5));
    run(
      engine,
      { type: 'addPoint', sketch: 's', id: 'la', x: -20, y: 3 },
      { type: 'addPoint', sketch: 's', id: 'lb', x: 20, y: 3 },
      { type: 'addCurve', sketch: 's', id: 'l', curve: { type: 'line', a: 'la', b: 'lb' } },
      constrain('s', 'lh', { type: 'horizontal', line: 'l' }),
      dimension('s', 'lx', { type: 'horizontalDistance', a: 'origin', b: 'la' }, -20),
      dimension('s', 'ly', { type: 'verticalDistance', a: 'origin', b: 'la' }, 3),
      dimension('s', 'll', { type: 'distance', a: 'la', b: 'lb' }, 40),
    );
    const split = cut(engine, 'split', 's', {});
    let state = engine.getState();
    expect(split.changed).toEqual(['k', 'l']);
    expect(split.added).toHaveLength(3); // one arc, two pieces of the line
    expect(split.patched).toEqual(['boss']);
    expect(regions(state, 'boss')).toHaveLength(2);
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(solved(state).redundant).toEqual([]);
    expect(vol(state, 'boss')).toBeCloseTo(1568.75, 1);
    for (const [id, value] of [
      ['kr', 12],
      ['kr', 9],
      ['kx', 5],
      ['ly', 7],
      ['ly', -5],
      ['ly', 10.9],
    ] as [Id, number][]) {
      const changed = preview(engine, setValue(id, value));
      expect(changed.evaluation.features['s'].status, `${id} ${value}`).toBe('ok');
      expect(changed.evaluation.features['s'].sketch?.degreesOfFreedom).toBe(0);
      const r = id === 'kr' ? value : 10;
      expect(vol(changed, 'boss')).toBeCloseTo(Math.PI * r * r * 5, -1);
    }
    expect(preview(engine, setValue('ly', 12)).evaluation.features['s'].warnings.map((w) => w.code)).toContain('sketchConflict');
    // the keeper of the line (from its start) trimmed: a whole piece, its carrier moved to the middle piece
    const first = cut(engine, 'trim', 's', { curve: 'l', at: [-15, 3] });
    state = engine.getState();
    expect(first.removed).toContain('l');
    expect(first.reattached).toContain('lh');
    expect(solved(state).degreesOfFreedom).toBe(0);
    const far = split.added.find((id) => sketchOf(state, 's').curves[id]?.type === 'line' && solved(state).points[(sketchOf(state, 's').curves[id] as { b: Id }).b].x > 15) as Id;
    cut(engine, 'trim', 's', { curve: far, at: [18, 3] });
    state = engine.getState();
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(preview(engine, setValue('ly', 7)).evaluation.features['s'].status).toBe('ok');
    expect(preview(engine, setValue('kr', 12)).evaluation.features['s'].status).toBe('ok');
    // three undos give the crossed sketch back
    engine.undo();
    engine.undo();
    engine.undo();
    expect(regions(engine.getState(), 'boss')).toEqual([['k']]);
  });
});

describe('regions inside a region, and a hole', () => {
  it('a grid: the plate keeps all nine cells, the centre one included', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 60), addExtrude('plate', 's', [rectLoop('r')], 2));
    run(engine, ...fixedLine('v1', [20, -10], [20, 70]), ...fixedLine('v2', [40, -10], [40, 70]), ...fixedLine('h1', [-10, 20], [70, 20]), ...fixedLine('h2', [-10, 40], [70, 40]));
    const split = cut(engine, 'split', 's', {});
    const state = engine.getState();
    expect(split.patched).toEqual(['plate']);
    expect(regions(state, 'plate')).toHaveLength(9);
    expect(vol(state, 'plate')).toBeCloseTo(7200, 6);
    expect(solved(state).degreesOfFreedom).toBe(0);
  });

  it('a plate with a hole crossed by a line from its outline: the regions around the hole, not the halves of the disc', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), circle('s', 'k', 30, 20, 8), addExtrude('plate', 's', [rectLoop('r')], 2));
    const plate = vol(engine.getState(), 'plate');
    run(engine, ...fixedLine('l', [-10, 22], [70, 22]));
    cut(engine, 'split', 's', {});
    const state = engine.getState();
    expect(regions(state, 'plate')).toHaveLength(2);
    expect(regions(state, 'plate').some((loop) => loop.length === 2)).toBe(false);
    expect(vol(state, 'plate')).toBeCloseTo(plate, 1);
    expect(solved(state).degreesOfFreedom).toBe(0);
  });

  for (const diagonal of [false, true]) {
    it(`a plate with a hole crossed ${diagonal ? 'from corner to corner' : 'only by an inner line'}, the outline notched in the same batch: the hole stays`, () => {
      const engine = newEngine();
      run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), circle('s', 'h', 30, 20, 8), addExtrude('plate', 's', [rectLoop('r')], 2));
      const plate = vol(engine.getState(), 'plate');
      run(engine, circle('s', 'k', 10, 1, 4), ...(diagonal ? [{ type: 'addCurve', sketch: 's', id: 'L', curve: { type: 'line', a: 'r1', b: 'r3' } } as Command] : fixedLine('L', [20, 22], [40, 22])));
      cut(engine, 'split', 's', {});
      const state = engine.getState();
      // the plate around the hole (and the half disc of the notch inside the outline)
      const notchInside = Math.PI * 16 - (16 * Math.acos(1 / 4) - Math.sqrt(15));
      expect(vol(state, 'plate')).toBeCloseTo(plate, 0);
      expect(state.evaluation.features['plate'].status).toBe('ok');
      void notchInside;
    });
  }
});

describe('arcs and tangencies', () => {
  it('the middle of an arc trimmed: the arcs that stay are tied by equalRadius', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('s', XY),
      { type: 'addPoint', sketch: 's', id: 'as', x: 10, y: 0 },
      { type: 'addPoint', sketch: 's', id: 'ae', x: -10, y: 0 },
      { type: 'addCurve', sketch: 's', id: 'a', curve: { type: 'arc', center: 'origin', start: 'as', end: 'ae' } },
      dimension('s', 'ar', { type: 'radius', curve: 'a' }, 10),
      dimension('s', 'asy', { type: 'verticalDistance', a: 'origin', b: 'as' }, 0),
      dimension('s', 'aey', { type: 'verticalDistance', a: 'origin', b: 'ae' }, 0),
      ...fixedLine('l', [-20, 6], [20, 6]),
    );
    const ids = cut(engine, 'trim', 's', { curve: 'a', at: [0, 10] });
    const state = engine.getState();
    const tie = ids.constraints.map((id) => sketchOf(state, 's').constraints[id]).find((c) => c.type === 'equalRadius');
    expect(tie).toBeDefined();
    expect(solved(state).degreesOfFreedom).toBe(0);
    const bigger = preview(engine, setValue('ar', 12));
    const p = bigger.evaluation.features['s'].sketch!.points;
    for (const id of ['as', 'ae']) expect(Math.hypot(p[id].x, p[id].y)).toBeCloseTo(12, 6);
    const far = ids.added[0];
    const arc = sketchOf(state, 's').curves[far] as { start: Id };
    expect(Math.hypot(p[arc.start].x, p[arc.start].y)).toBeCloseTo(12, 6);
    // the other arc trimmed whole: its sibling keeps the circle, the tie with it goes
    const again = cut(engine, 'trim', 's', { curve: far, at: [-9, 2] });
    expect(again.removed).toContain(far);
    expect(solved(engine.getState()).degreesOfFreedom).toBe(0);
  });

  it('a slot whose arc is split: the tangency moves to the piece with the common end; changes solve', () => {
    const engine = newEngine();
    const at = (id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: 's', id, x, y });
    run(
      engine,
      addSketch('s', XY),
      at('c1', 0, 0),
      at('c2', 30, 0),
      at('p1', 0, -6),
      at('p2', 30, -6),
      at('p3', 30, 6),
      at('p4', 0, 6),
      { type: 'addCurve', sketch: 's', id: 'bot', curve: { type: 'line', a: 'p1', b: 'p2' } },
      { type: 'addCurve', sketch: 's', id: 'top', curve: { type: 'line', a: 'p3', b: 'p4' } },
      { type: 'addCurve', sketch: 's', id: 'ar', curve: { type: 'arc', center: 'c2', start: 'p2', end: 'p3' } },
      { type: 'addCurve', sketch: 's', id: 'al', curve: { type: 'arc', center: 'c1', start: 'p4', end: 'p1' } },
      constrain('s', 't1', { type: 'tangent', a: 'bot', b: 'ar' }),
      constrain('s', 't2', { type: 'tangent', a: 'top', b: 'ar' }),
      constrain('s', 't3', { type: 'tangent', a: 'top', b: 'al' }),
      constrain('s', 't4', { type: 'tangent', a: 'bot', b: 'al' }),
      constrain('s', 'c1o', { type: 'coincident', a: 'c1', b: 'origin' }),
      constrain('s', 'hb', { type: 'horizontal', line: 'bot' }),
      dimension('s', 'r', { type: 'radius', curve: 'ar' }, 6),
      constrain('s', 'er', { type: 'equalRadius', a: 'ar', b: 'al' }),
      dimension('s', 'len', { type: 'distance', a: 'c1', b: 'c2' }, 30),
      addExtrude('slot', 's', [['al', 'ar', 'bot', 'top']], 4),
      at('va', 33, -20),
      at('vb', 33, 20),
      { type: 'addCurve', sketch: 's', id: 'v', curve: { type: 'line', a: 'va', b: 'vb' } },
      constrain('s', 'vv', { type: 'vertical', line: 'v' }),
      dimension('s', 'vx', { type: 'horizontalDistance', a: 'origin', b: 'va' }, 33),
      dimension('s', 'vy', { type: 'verticalDistance', a: 'origin', b: 'va' }, -20),
      dimension('s', 'vl', { type: 'distance', a: 'va', b: 'vb' }, 40),
    );
    const slot = (30 * 12 + Math.PI * 36) * 4;
    expect(engine.getState().evaluation.features['slot'].error?.code).toBe('invalidProfile');
    const ids = cut(engine, 'split', 's', { curve: 'ar' });
    const state = engine.getState();
    expect(ids.reattached).toContain('t2');
    const t2 = sketchOf(state, 's').constraints['t2'] as { a: Id; b: Id };
    // the pieces of the arc come first in `added` (the order of `changed`), the last one has the end at p3
    expect(ids.changed).toEqual(['ar', 'v']);
    expect([t2.a, t2.b]).toEqual(['top', ids.added[1]]);
    expect(solved(state).redundant).toEqual([]);
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(Math.abs(vol(state, 'slot') - slot)).toBeLessThan(slot * 1e-3);
    for (const [id, value] of [
      ['r', 8],
      ['r', 4],
      ['len', 32],
      ['len', 28],
      ['vx', 31],
    ] as [Id, number][]) {
      const changed = preview(engine, setValue(id, value));
      expect(changed.evaluation.features['s'].status, `${id} ${value}`).toBe('ok');
      expect(changed.evaluation.features['s'].sketch?.redundant).toEqual([]);
    }
    expect(preview(engine, setValue('len', 40)).evaluation.features['s'].warnings.map((w) => w.code)).toContain('sketchConflict');
  });

  it('a hexagon notched at the middle of a side: equalLength and midpoint move to the span line', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY));
    const hex = cut(engine, 'polygon', 's', { center: { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, vertex: { at: [10, 0] }, sides: 6, sizeKind: 'circumscribed', size: 20 }, 'h');
    const [side] = hex.lines;
    run(
      engine,
      dimension('s', 'v0y', { type: 'verticalDistance', a: 'origin', b: hex.points[0] }, 0),
      { type: 'addPoint', sketch: 's', id: 'kc', x: 7.5, y: 4.33 },
      { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'kc' }, radius: 2 },
      constrain('s', 'kmid', { type: 'midpoint', point: 'kc', line: side }),
      dimension('s', 'kr', { type: 'radius', curve: 'k' }, 2),
      addExtrude('nut', 's', [hex.lines], 3),
    );
    expect(solved(engine.getState()).degreesOfFreedom).toBe(0);
    // the piece of the circle outside the hexagon, then the middle of the side
    const first = cut(engine, 'trim', 's', { curve: 'k', at: [7.5 + 2 * Math.cos(Math.PI / 6), 4.33 + 2 * Math.sin(Math.PI / 6)] });
    expect(first.span).toHaveLength(1);
    let state = engine.getState();
    expect(solved(state).degreesOfFreedom).toBe(0);
    const middle = first.added.find((id) => {
      const c = sketchOf(state, 's').curves[id];
      return c?.type === 'line';
    }) as Id;
    cut(engine, 'trim', 's', { curve: middle, at: [7.5, 4.33] });
    state = engine.getState();
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(vol(state, 'nut')).toBeCloseTo(760.69, 1);
    const bigger = preview(engine, setValue(hex.size[0], 30));
    const p = bigger.evaluation.features['s'].sketch!.points;
    for (let i = 0; i < 6; i++) {
      const [a, b] = [p[hex.points[i]], p[hex.points[(i + 1) % 6]]];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(15, 6);
    }
    expect(p['kc'].x).toBeCloseTo(11.25, 6);
    expect(vol(bigger, 'nut')).toBeCloseTo(1734.97, 1);
  });
});

describe('overlaps, corners, an extend', () => {
  it('a line across a corner: the corner piece trimmed leaves the region without the corner triangle', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 2), ...fixedLine('w', [40, -10], [70, 20]));
    const ids = cut(engine, 'trim', 's', { curve: 'ra', at: [55, 0] });
    const state = engine.getState();
    expect(ids.patched).toEqual(['plate']);
    expect(solved(state).degreesOfFreedom).toBe(0);
    expect(vol(state, 'plate')).toBeCloseTo(4700, 6);
    expect(vol(preview(engine, setValue('rw', 65)), 'plate')).toBeCloseTo(4975, 6);
  });

  it('extend a line to the top side: the side is cut there, the old end stays on the line by its dimension', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('s', XY),
      rectangle('s', 'r', 0, 0, 40, 30),
      addExtrude('ex', 's', [rectLoop('r')], 5),
      { type: 'addPoint', sketch: 's', id: 'ea', x: 10, y: 10 },
      { type: 'addPoint', sketch: 's', id: 'eb', x: 10, y: 20 },
      { type: 'addCurve', sketch: 's', id: 'e', curve: { type: 'line', a: 'ea', b: 'eb' } },
      constrain('s', 'ev', { type: 'vertical', line: 'e' }),
      dimension('s', 'ex1', { type: 'horizontalDistance', a: 'origin', b: 'ea' }, 10),
      dimension('s', 'ey1', { type: 'verticalDistance', a: 'origin', b: 'ea' }, 10),
      dimension('s', 'el', { type: 'distance', a: 'ea', b: 'eb' }, 10),
    );
    const ids = cut(engine, 'extend', 's', { curve: 'e', end: 'b' });
    const state = engine.getState();
    expect(ids.changed).toEqual(['e', 'rc']);
    expect(ids.patched).toEqual(['ex']);
    expect(solved(state).degreesOfFreedom).toBe(0);
    const end = (sketchOf(state, 's').curves['e'] as { b: Id }).b;
    expect(solved(state).points[end].y).toBeCloseTo(30, 6);
    expect(vol(state, 'ex')).toBeCloseTo(6000, 6);
    const taller = preview(engine, setValue('rh', 50)).evaluation.features['s'].sketch!.points;
    expect(taller[end].y).toBeCloseTo(50, 6);
    expect(taller['eb'].y).toBeCloseTo(20, 6);
    expect(preview(engine, setValue('el', 15)).evaluation.features['s'].sketch!.points['eb'].y).toBeCloseTo(25, 6);
  });

  it('a trim at a corner: the corner stays on the line of the side; the opened outline is dropped', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 40, 30), addExtrude('ex', 's', [rectLoop('r')], 5), ...fixedLine('w', [25, -5], [25, 5]));
    const ids = cut(engine, 'trim', 's', { curve: 'ra', at: [35, 0] });
    const state = engine.getState();
    expect(ids.dropped).toEqual(['ex']);
    expect(state.evaluation.features['ex'].error?.code).toBe('noProfile');
    expect(solved(state).degreesOfFreedom).toBe(0);
    const wider = preview(engine, setValue('rw', 60)).evaluation.features['s'].sketch!.points;
    expect(wider['r2'].x).toBeCloseTo(60, 6);
    expect(wider['r2'].y).toBeCloseTo(0, 6);
  });
});

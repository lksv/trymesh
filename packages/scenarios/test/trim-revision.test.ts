// Trim, extend and split (D65): the rules of the revised design (docs/d36/6e-trim-extend-split/
// design.md, revised 2026-11-24, "Tests the implementation owes") against the real solver and
// kernel: a touch, a whole arc piece removed, a piece named by a place, the repair, the regions as
// they were, `reshaped`, the edge lists of chamfers and fillets, the world of a sketch, the query
// of the contacts and the extensions near the axes of the origin.
import { describe, expect, it } from 'vitest';
import { type Command, type CutIds, type Engine, type EngineState, type Id, type SketchFeature, type SketchResult, type SketchToolInputs, freshIds, profileOf, repairsByDefault, sketchTool, sketchWorld, toolBase } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, cap, circle, constrain, dimension, newEngine, onFace, rectLoop, rectangle, run, side } from './kit';

type CutTool = 'trim' | 'extend' | 'split';
const sketchOf = (state: EngineState, id = 's'): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
const solved = (state: EngineState, sketch = 's'): SketchResult => state.evaluation.features[sketch].sketch as SketchResult;
const contextOf = (state: EngineState, sketch: Id) => ({ sketch: sketchOf(state, sketch), result: solved(state, sketch), parameters: state.evaluation.parameters, document: state.document });
function cut<K extends CutTool>(engine: Engine, name: K, input: SketchToolInputs[K], sketch = 's', prefix = 'x_'): CutIds {
  const state = engine.getState();
  const made = sketchTool(name, contextOf(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) throw new Error(made.message);
  run(engine, batch(...made.commands));
  return made.ids as CutIds;
}
function refusal<K extends CutTool>(engine: Engine, name: K, input: SketchToolInputs[K], sketch = 's'): string {
  const state = engine.getState();
  const made = sketchTool(name, contextOf(state, sketch), input, freshIds(state.document, 'x_'));
  if (made.ok) throw new Error(`${name} was not refused: ${JSON.stringify(made.ids)}`);
  return made.message;
}
const volumeOf = (state: EngineState, body: Id): number => state.evaluation.bodies[body].volume;
const regions = (state: EngineState, feature: Id): Id[][] => {
  const f = state.document.features.find((g) => g.id === feature);
  return (f?.type === 'extrude' || f?.type === 'revolve') && f.profile.type === 'regions' ? f.profile.regions.map((r) => r.outerLoop) : [];
};
function preview(engine: Engine, command: Command): EngineState {
  const result = engine.preview(command);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}
const fixedPoint = (id: Id, x: number, y: number, sketch = 's'): Command[] => [{ type: 'addPoint', sketch, id, x, y }, constrain(sketch, `${id}f`, { type: 'fixed', point: id, x, y } as never)];
const fixedLine = (id: Id, a: [number, number], b: [number, number], sketch = 's', construction = false): Command[] => [
  ...fixedPoint(`${id}a`, a[0], a[1], sketch),
  ...fixedPoint(`${id}b`, b[0], b[1], sketch),
  { type: 'addCurve', sketch, id, curve: { type: 'line', a: `${id}a`, b: `${id}b`, ...(construction ? { construction: true } : {}) } },
];
const contacts = (engine: Engine, sketch = 's') => {
  const outcome = engine.query('sketchContacts', { sketch });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result;
};
const determined = (state: EngineState, sketch = 's'): void => {
  expect(solved(state, sketch).degreesOfFreedom).toBe(0);
  expect(solved(state, sketch).redundant).toEqual([]);
};
// a union of two discs of radius r with centres d apart
const union = (r: number, d: number): number => 2 * Math.PI * r * r - (2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d));
const above = (centreY: number, r: number): number => {
  const segment = (d: number): number => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
  return centreY >= 0 ? Math.PI * r * r - segment(centreY) : segment(-centreY);
};

// The lower half of a circle of radius 5 about (0, 5) closed by its chord, and a fixed line on
// y = 0 that touches it at (0, 0). `tangent`: the two are tangent by a constraint and the height of
// the centre is free; else the centre is placed by two dimensions.
function touching(engine: Engine, tangent: boolean): EngineState {
  run(engine, addSketch('s', XY));
  return run(
    engine,
    batch(
      ...fixedLine('L', [-10, 0], [10, 0]),
      { type: 'addPoint', sketch: 's', id: 'c', x: 0, y: 5 },
      { type: 'addPoint', sketch: 's', id: 'p', x: -5, y: 5 },
      { type: 'addPoint', sketch: 's', id: 'q', x: 5, y: 5 },
      { type: 'addCurve', sketch: 's', id: 'A', curve: { type: 'arc', center: 'c', start: 'p', end: 'q' } },
      { type: 'addCurve', sketch: 's', id: 'ch', curve: { type: 'line', a: 'q', b: 'p' } },
      constrain('s', 'chh', { type: 'horizontal', line: 'ch' }),
      constrain('s', 'mid', { type: 'midpoint', point: 'c', line: 'ch' }),
      dimension('s', 'r', { type: 'radius', curve: 'A' }, 5),
      dimension('s', 'cx', { type: 'horizontalDistance', a: 'origin', b: 'c' }, 0),
      ...(tangent ? [constrain('s', 't', { type: 'tangent', a: 'L', b: 'A' })] : [dimension('s', 'cy', { type: 'verticalDistance', a: 'origin', b: 'c' }, 5)]),
    ),
  );
}

describe('a touch is cut only where a tangency can hold it', () => {
  it('a line and an arc with a tangent in the sketch: both cut at the touch, the tangent moved to the pieces; the point follows', () => {
    const engine = newEngine();
    determined(touching(engine, true));
    const ids = cut(engine, 'split', {});
    const state = engine.getState();
    expect(ids.changed).toEqual(['A', 'L']);
    // the tangent names the pieces that have the touch as their common end (here the keepers); none is added
    const t = sketchOf(state).constraints['t'] as { a: Id; b: Id };
    const ends = (id: Id): Id[] => Object.values(sketchOf(state).curves[id]).filter((v) => typeof v === 'string');
    expect(ends(t.a).filter((p) => ends(t.b).includes(p))).toEqual([ids.points[0]]);
    expect(ids.constraints.map((id) => sketchOf(state).constraints[id].type)).not.toContain('tangent');
    determined(state);
    // the centre moved and the radius changed: solved, the touch follows
    const moved = preview(engine, { type: 'setConstraintValue', sketch: 's', id: 'cx', value: 2 });
    expect(moved.evaluation.features['s'].status).toBe('ok');
    expect(solved(moved).points[ids.points[0]].x).toBeCloseTo(2, 6);
    expect(preview(engine, { type: 'setConstraintValue', sketch: 's', id: 'r', value: 6 }).evaluation.features['s'].status).toBe('ok');
  });

  it('a line and an arc that touch by dimensions alone: both cut, a tangent added between the pieces; the centre moved is solved', () => {
    const engine = newEngine();
    determined(touching(engine, false));
    const ids = cut(engine, 'split', {});
    const state = engine.getState();
    const added = ids.constraints.map((id) => sketchOf(state).constraints[id]);
    expect(added.filter((c) => c.type === 'tangent')).toHaveLength(1);
    expect(solved(state).degreesOfFreedom).toBe(0);
    const moved = preview(engine, { type: 'setConstraintValue', sketch: 's', id: 'cx', value: 2 });
    expect(moved.evaluation.features['s'].status).toBe('ok');
    expect(solved(moved).points[ids.points[0]].x).toBeCloseTo(2, 6);
  });

  it('two circles that only touch are left whole, both listed; split of the sketch is refused with the reason, a trim through the touch too', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), circle('s', 'k1', 0, 0, 5), circle('s', 'k2', 8, 0, 3));
    expect(contacts(engine).contacts).toEqual([{ at: [expect.closeTo(5, 6), expect.closeTo(0, 6)], kind: 'touch', curves: ['k1', 'k2'], fix: 'none', why: expect.stringMatching(/two round curves that only touch/) }]);
    expect(refusal(engine, 'split', {})).toMatch(/two round curves that only touch/);
    expect(refusal(engine, 'trim', { at: [-5, 0], repair: 'on' })).toMatch(/only touches "k2".*two round curves/);
  });

  it('a trim on one side of a touch is refused with the touch named; a piece of the same curve that does not hold it is trimmed', () => {
    const engine = newEngine();
    touching(engine, true);
    // the repair is off (no feature reads the sketch): the arc is not cut, the touch is no cut
    expect(refusal(engine, 'trim', { at: [5, 0] })).toMatch(/passes \[0, 0\], where it only touches "A".*the repair is off.*repair: 'on'/);
    expect(refusal(engine, 'trim', { at: [5, 0], with: 'A' })).toMatch(/only touches "A"/);
    // a second line across L at x = -5: the piece from its other end to the crossing is trimmed
    run(engine, batch(...fixedLine('M', [-5, -3], [-5, 3])));
    expect(refusal(engine, 'trim', { at: [5, 0] })).toMatch(/only touches "A"/);
    const ids = cut(engine, 'trim', { at: [-8, 0] });
    expect(ids.changed).toEqual(['L']);
    // with the repair on, the line is cut at the touch with the arc and its half goes
    const on = cut(engine, 'trim', { at: [5, 0], repair: 'on' });
    expect(on.changed).toContain('A');
  });
});

describe('a whole arc piece removed: the arcs that stay are tied without a redundant constraint', () => {
  // an arc of radius 10 about the origin over the upper half, its ends on the x axis
  function upperArc(engine: Engine): void {
    run(
      engine,
      addSketch('s', XY),
      batch(
        { type: 'addPoint', sketch: 's', id: 'as', x: 10, y: 0 },
        { type: 'addPoint', sketch: 's', id: 'ae', x: -10, y: 0 },
        { type: 'addCurve', sketch: 's', id: 'arc', curve: { type: 'arc', center: 'origin', start: 'as', end: 'ae' } },
        dimension('s', 'r', { type: 'radius', curve: 'arc' }, 10),
        dimension('s', 'asy', { type: 'verticalDistance', a: 'origin', b: 'as' }, 0),
        dimension('s', 'aey', { type: 'verticalDistance', a: 'origin', b: 'ae' }, 0),
      ),
    );
  }

  it('an arc in three, the middle removed whole: freedom 0, nothing redundant, both arcs follow the radius', () => {
    const engine = newEngine();
    upperArc(engine);
    run(engine, batch(...fixedLine('m1', [4, 5], [4, 15]), ...fixedLine('m2', [-4, 5], [-4, 15])));
    cut(engine, 'split', { curve: 'arc' });
    determined(engine.getState());
    cut(engine, 'trim', { at: [0, 10], curve: undefined });
    const state = engine.getState();
    determined(state);
    const bigger = preview(engine, { type: 'setConstraintValue', sketch: 's', id: 'r', value: 12 });
    expect(bigger.evaluation.features['s'].status).toBe('ok');
    const arcs = Object.values(sketchOf(bigger).curves).filter((c) => c.type === 'arc') as { start: Id; end: Id }[];
    expect(arcs).toHaveLength(2);
    for (const arc of arcs) for (const p of [arc.start, arc.end]) expect(Math.hypot(solved(bigger).points[p].x, solved(bigger).points[p].y)).toBeCloseTo(12, 6);
  });

  it('a circle in four, two opposite pieces removed: freedom 0 and nothing redundant after each trim', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), batch({ type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 10 }, dimension('s', 'r', { type: 'radius', curve: 'k' }, 10)));
    run(engine, batch(...fixedLine('h', [-15, 0], [15, 0], 's', true), ...fixedLine('v', [0, -15], [0, 15], 's', true)));
    cut(engine, 'split', { curve: 'k', with: 'h' });
    cut(engine, 'split', { curve: 'k', with: 'v' });
    for (const at of [
      [7.07, 7.07],
      [-7.07, -7.07],
    ] as [number, number][]) {
      cut(engine, 'trim', { at });
      determined(engine.getState());
    }
    expect(preview(engine, { type: 'setConstraintValue', sketch: 's', id: 'r', value: 12 }).evaluation.features['s'].status).toBe('ok');
  });
});

describe('an AI names a piece by a place', () => {
  it('trim by a place alone, a span line under the place, and a place on a sibling piece refused with its name', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 40, 30), addExtrude('plate', 's', [rectLoop('r')], 2), constrain('s', 'eq', { type: 'equalLength', a: 'ra', b: 'rc' }));
    run(engine, batch(...fixedLine('v', [20, -5], [20, 5], 's', true)));
    // the construction line cuts the bottom side only when named
    const split = cut(engine, 'split', { curve: 'ra', with: 'v' });
    expect(split.span).toHaveLength(1);
    expect(refusal(engine, 'trim', { curve: 'ra', at: [30, 0] })).toContain(`"${split.added[0]}"`);
    // the place lies on the piece and on the span line over it: the piece is trimmed
    const ids = cut(engine, 'trim', { at: [30, 0], with: 'v' });
    expect(ids.removed).toContain(split.added[0]);
    expect(sketchOf(engine.getState()).curves[split.span[0]]).toBeDefined();
  });

  it('a sketch in conflict is refused; so is a cut at a point a symmetric constraint mirrors about the line', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), batch(...fixedLine('L', [-10, 0], [10, 0]), { type: 'addPoint', sketch: 's', id: 'p', x: 3, y: 0 }, { type: 'addPoint', sketch: 's', id: 'q', x: 3, y: 0 }, { type: 'addPoint', sketch: 's', id: 'u', x: 3, y: 5 }));
    run(engine, batch({ type: 'addCurve', sketch: 's', id: 'M', curve: { type: 'line', a: 'p', b: 'u' } }, constrain('s', 'pon', { type: 'pointOnCurve', point: 'p', curve: 'L' }), constrain('s', 'sym', { type: 'symmetric', a: 'p', b: 'q', line: 'L' })));
    expect(refusal(engine, 'split', { curve: 'L' })).toMatch(/"sym"/);
    run(engine, dimension('s', 'bad1', { type: 'distance', a: 'La', b: 'Lb' }, 5));
    expect(solved(engine.getState()).conflicting.length).toBeGreaterThan(0);
    expect(refusal(engine, 'trim', { at: [0, 0] })).toMatch(/in conflict/);
  });

  it('a circle cut by a line through its centre keeps its upper arc under its ID, the line 1e-12 mm above or below', () => {
    for (const dy of [1e-12, -1e-12]) {
      const engine = newEngine();
      run(engine, addSketch('s', XY), batch(...fixedPoint('kc', 0, 0), { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'kc' }, radius: 10 }, dimension('s', 'r', { type: 'radius', curve: 'k' }, 10)));
      run(engine, batch(...fixedLine('L', [-20, dy], [20, dy])));
      cut(engine, 'split', {});
      const arc = sketchOf(engine.getState()).curves['k'] as { start: Id; end: Id };
      const p = solved(engine.getState()).points;
      const middle = Math.atan2(p[arc.start].y, p[arc.start].x) + Math.PI / 2;
      expect(Math.sin(middle), `dy ${dy}`).toBeGreaterThan(0.9);
    }
  });

  it('a place on a projected edge is refused with its name; an own line over it is trimmed; the axes of the origin do not count', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 2));
    run(engine, addSketch('t', XY), { type: 'addExternal', sketch: 't', id: 'x', ref: { type: 'edge', body: 'plate', edge: { a: cap('plate', 'startCap'), b: side('plate', 'ra') }, kind: 'line' } });
    // an own circle about (20, 0) of diameter 25/3: the place (20 + 4.1667, 0) lies on the projected
    // edge and 3e-5 mm off the circle
    run(engine, batch(...fixedPoint('kc', 20, 0, 't'), { type: 'addCurve', sketch: 't', id: 'k', curve: { type: 'circle', center: 'kc' }, radius: 25 / 6 }, dimension('t', 'kd', { type: 'diameter', curve: 'k' }, 25 / 3)));
    expect(refusal(engine, 'trim', { at: [24.1667, 0] }, 't')).toMatch(/not an own curve of the sketch/);
    expect(cut(engine, 'trim', { at: [24.1667, 0], curve: 'k' }, 't').removed).toContain('k');
    // an own line drawn over the projected edge is as near as the projection: it is trimmed
    run(engine, batch(...fixedLine('own', [0, 0], [60, 0], 't')));
    expect(cut(engine, 'trim', { at: [30, 0] }, 't').removed).toContain('own');
    // a circle about the origin and a place on origin/x, 3e-5 mm off the circle: trimmed
    run(engine, addSketch('u', XY), batch({ type: 'addCurve', sketch: 'u', id: 'o', curve: { type: 'circle', center: 'origin' }, radius: 25 / 6 }, dimension('u', 'od', { type: 'diameter', curve: 'o' }, 25 / 3)));
    expect(cut(engine, 'trim', { at: [4.1667, 0] }, 'u').removed).toContain('o');
  });
});

describe('the region as it was: holes that only a cut closes, in any order of the tools', () => {
  // a plate 60 × 40 extruded 1 with two overlapping circles of radius 6 inside, and a notch circle
  // of radius 4 whose centre is 1.5 above the bottom edge
  function plate(engine: Engine): void {
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 1), circle('s', 'k1', 24, 20, 6), circle('s', 'k2', 32, 20, 6), circle('s', 'n', 30, 1.5, 4));
  }
  const hole = union(6, 8);

  it('the circles and the notch cut in one batch: the hole stays', () => {
    const engine = newEngine();
    plate(engine);
    cut(engine, 'split', {});
    expect(volumeOf(engine.getState(), 'plate')).toBeCloseTo(2400 - hole, 0);
  });

  it('the circles cut first, then the notch: the same', () => {
    const engine = newEngine();
    plate(engine);
    cut(engine, 'split', { curve: 'k1' });
    cut(engine, 'split', {});
    expect(volumeOf(engine.getState(), 'plate')).toBeCloseTo(2400 - hole, 0);
  });

  it('the notch trimmed by two trims, the circles never cut by the user: the hole stays', () => {
    const engine = newEngine();
    plate(engine);
    cut(engine, 'trim', { at: [30, -2.4] });
    expect(volumeOf(engine.getState(), 'plate')).toBeCloseTo(2400 - hole, 0);
    cut(engine, 'trim', { at: [30, 0] });
    expect(Math.abs(volumeOf(engine.getState(), 'plate') - (2400 - hole - above(1.5, 4)))).toBeLessThan(1);
  });

  it('a # of four lines inside the plate and the notch in one batch: the centre cell is a hole', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 1), circle('s', 'n', 30, 1.5, 4));
    run(engine, batch(...fixedLine('h1', [20, 15], [40, 15]), ...fixedLine('h2', [20, 25], [40, 25]), ...fixedLine('v1', [25, 10], [25, 30]), ...fixedLine('v2', [35, 10], [35, 30])));
    cut(engine, 'split', {});
    expect(volumeOf(engine.getState(), 'plate')).toBeCloseTo(2300, 6);
  });
});

describe('which regions are followed', () => {
  it('a region whose curves were only cut waits in pending, and the tool that makes the sketch valid follows it, though it changes none of its curves', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 1), circle('s', 'n', 30, 1.5, 4));
    run(engine, batch(...fixedLine('X1', [100, 0], [110, 10]), ...fixedLine('X2', [100, 10], [110, 0])));
    const first = cut(engine, 'split', { curve: 'n' });
    expect(first.pending).toEqual(['plate']);
    expect(first.patched).toEqual(['plate']);
    const second = cut(engine, 'split', { curve: 'X1' });
    expect(second.changed).toEqual(['X1', 'X2']);
    expect(second.patched).toEqual(['plate']);
    expect(second.dropped).toEqual([]);
    const state = engine.getState();
    expect(state.evaluation.features['plate'].status).toBe('ok');
    expect(volumeOf(state, 'plate')).toBeCloseTo(2400, 6);
  });

  it('the round notch with the repair off, the edge trimmed first: pending, then dropped at the trim of the circle', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 1), circle('s', 'n', 30, 1.5, 4));
    const first = cut(engine, 'trim', { at: [30, 0], repair: 'off' });
    expect(first.changed).toEqual(['ra']);
    expect(first.pending).toEqual(['plate']);
    const second = cut(engine, 'trim', { at: [30, -2.4], repair: 'off' });
    expect(second.changed).toEqual(['n']);
    expect(second.dropped).toEqual(['plate']);
    expect(engine.getState().evaluation.features['plate'].error?.code).toBe('noProfile');
  });

  it('a region that names a curve the sketch does not have is left out of every list', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 1), addExtrude('ghost', 's', [['ghost1', 'ghost2']], 1), circle('s', 'n', 30, 1.5, 4));
    const ids = cut(engine, 'trim', { at: [30, -2.4] });
    for (const list of ['patched', 'dropped', 'pending', 'reshaped'] as const) expect(ids[list], list).not.toContain('ghost');
  });

  it('a region joined with its neighbour under a cut: the pocket takes the neighbour as well', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 4));
    run(engine, batch(...fixedLine('d', [30, 0], [30, 40])));
    cut(engine, 'split', {});
    const state = engine.getState();
    const [left] = solved(state).regions.map((r) => r.ref.outerLoop).filter((loop) => loop.includes('rd'));
    run(engine, addExtrude('pocket', 's', [left], 2, 'cut', 'plate'));
    expect(volumeOf(engine.getState(), 'plate')).toBeCloseTo(60 * 40 * 4 - 30 * 40 * 2, 6);
    const ids = cut(engine, 'trim', { at: [30, 20] });
    expect(ids.patched).toContain('pocket');
    expect(volumeOf(engine.getState(), 'plate')).toBeCloseTo(60 * 40 * 2, 6);
  });
});

describe('reshaped: a region that keeps its name while its holes change', () => {
  it('a hole opened by a trim, and a loop closed by an extend', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 1));
    run(engine, batch(...fixedLine('u1', [10, 10], [20, 10]), ...fixedLine('u2', [20, 10], [20, 20]), ...fixedLine('u3', [20, 20], [10, 20])));
    run(engine, batch({ type: 'addPoint', sketch: 's', id: 'w', x: 10, y: 15 }, { type: 'addCurve', sketch: 's', id: 'u4', curve: { type: 'line', a: 'u3b', b: 'w' } }, constrain('s', 'u4v', { type: 'vertical', line: 'u4' }), dimension('s', 'u4l', { type: 'distance', a: 'u3b', b: 'w' }, 5)));
    run(engine, batch(constrain('s', 'j12', { type: 'coincident', a: 'u1b', b: 'u2a' }), constrain('s', 'j23', { type: 'coincident', a: 'u2b', b: 'u3a' })));
    expect(volumeOf(engine.getState(), 'plate')).toBeCloseTo(2400, 6);
    const closed = cut(engine, 'extend', { curve: 'u4', end: 'b' });
    expect(closed.reshaped).toEqual(['plate']);
    expect(closed.patched).toEqual([]);
    expect(volumeOf(engine.getState(), 'plate')).toBeCloseTo(2300, 6);
    // the trim of a side of the hole opens it again
    const opened = cut(engine, 'trim', { at: [15, 10] });
    expect(opened.reshaped).toEqual(['plate']);
    expect(volumeOf(engine.getState(), 'plate')).toBeCloseTo(2400, 6);
  });

  it('a split changes no hole by this measure', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('plate', 's', [rectLoop('r')], 1), circle('s', 'n', 30, 1.5, 4));
    expect(cut(engine, 'split', {}).reshaped).toEqual([]);
  });
});

describe('the edges of chamfers and fillets on the sides of cut curves', () => {
  // a box 60 × 40 × 20
  function box(engine: Engine): void {
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addExtrude('box', 's', [rectLoop('r')], 20));
  }

  const edgesOf = (state: EngineState, id: Id): string[] => (state.document.features.find((f) => f.id === id) as unknown as { edges: { a: object; b: object }[] }).edges.map((e) => [e.a, e.b].map((face) => JSON.stringify(face)).sort().join(' | '));
  const edge = (a: object, b: object): string => [a, b].map((face) => JSON.stringify(face)).sort().join(' | ');

  it('a fillet of the vertical edge at the far corner of a cut side follows its piece', () => {
    const engine = newEngine();
    box(engine);
    run(engine, { type: 'addFeature', feature: { id: 'f', name: 'f', suppressed: false, type: 'fillet', body: 'box', edges: [{ a: side('box', 'ra'), b: side('box', 'rb') }], radius: 2 } });
    const volume = volumeOf(engine.getState(), 'box');
    run(engine, batch(...fixedLine('v', [20, -5], [20, 5], 's', true)));
    const ids = cut(engine, 'split', { curve: 'ra', with: 'v' });
    const state = engine.getState();
    expect(ids.patched).toEqual(['box', 'f']);
    expect(edgesOf(state, 'f')).toEqual([edge(side('box', ids.added[0]), side('box', 'rb'))]);
    expect(state.evaluation.features['f'].status).toBe('ok');
    expect(volumeOf(state, 'box')).toBeCloseTo(volume, 3);
  });

  it('a chamfer along a cut side gets an edge per piece: the old place kept, the new edge appended', () => {
    const engine = newEngine();
    box(engine);
    run(engine, { type: 'addFeature', feature: { id: 'ch', name: 'ch', suppressed: false, type: 'chamfer', body: 'box', edges: [{ a: side('box', 'ra'), b: cap('box') }, { a: side('box', 'rc'), b: cap('box') }], distance: 1 } });
    const volume = volumeOf(engine.getState(), 'box');
    run(engine, batch(...fixedLine('v', [20, -5], [20, 5], 's', true)));
    const ids = cut(engine, 'split', { curve: 'ra', with: 'v' });
    const state = engine.getState();
    expect(ids.patched).toEqual(['box', 'ch']);
    expect(ids.shortened).toEqual([]);
    expect(edgesOf(state, 'ch')).toEqual([edge(side('box', 'ra'), cap('box')), edge(side('box', 'rc'), cap('box')), edge(side('box', ids.added[0]), cap('box'))]);
    expect(state.evaluation.features['ch'].status).toBe('ok');
    expect(volumeOf(state, 'box')).toBeCloseTo(volume, 3);
  });

  // a corner of the box cut away by a line across it: the vertical edge at the corner has no piece
  function corner(engine: Engine, edges: { a: object; b: object }[], namedAt?: number): CutIds {
    box(engine);
    run(engine, { type: 'addFeature', feature: { id: 'ch', name: 'ch', suppressed: false, type: 'chamfer', body: 'box', edges, distance: 1 } as never });
    if (namedAt !== undefined) run(engine, addSketch('t', onFace('box', { feature: 'ch', role: 'chamfer', edge: namedAt })));
    run(engine, batch(...fixedLine('w', [50, -5], [65, 10])));
    // the corner piece of the bottom side: the vertical edge at the corner has no piece any more
    return cut(engine, 'trim', { at: [57, 0] });
  }
  const atCorner = { a: side('box', 'ra'), b: side('box', 'rb') };
  const top = { a: side('box', 'rc'), b: cap('box') };

  it('an edge no piece has is taken out when nothing names a face of the blend at its place or later', () => {
    const engine = newEngine();
    const ids = corner(engine, [atCorner, top]);
    expect(edgesOf(engine.getState(), 'ch')).toEqual([edge(top.a, top.b)]);
    expect(ids.broken).not.toContain('ch');
    expect(ids.patched).toContain('ch');
    expect(engine.getState().evaluation.features['ch'].status).toBe('ok');
  });

  it('it stays, and the chamfer is broken, when a sketch stands on its face or on a later one', () => {
    for (const namedAt of [0, 1]) {
      const engine = newEngine();
      const ids = corner(engine, [atCorner, top], namedAt);
      expect(edgesOf(engine.getState(), 'ch')[0], `edge ${namedAt}`).toEqual(edge(atCorner.a, atCorner.b));
      expect(ids.broken, `edge ${namedAt}`).toContain('ch');
    }
  });
});

describe('the world of a sketch: the step and the tools build the same profile', () => {
  it('toolBase of a sketch and its result gives the regions of the step', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), circle('s', 'k', 20, 20, 5), circle('s', 'n', 30, 1.5, 4), addExtrude('plate', 's', [rectLoop('r')], 1));
    const check = (state: EngineState): void => {
      const world = sketchWorld(toolBase(sketchOf(state), solved(state)));
      const profile = profileOf([...world.curves.values()], world.joins, world.geometry, state.document.settings.chordTolerance);
      expect(profile.valid).toBe(solved(state).valid);
      expect(profile.regions.map((r) => r.ref)).toEqual(solved(state).regions.map((region) => region.ref));
    };
    check(engine.getState());
    cut(engine, 'trim', { at: [30, -2.4] });
    check(engine.getState());
    cut(engine, 'trim', { at: [30, 0] });
    check(engine.getState());
  });
});

describe('extend', () => {
  it('onto a circle: refused in a valid profile, taken in an invalid one', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), circle('s', 'k', 0, 0, 10), addExtrude('disc', 's', [['k']], 1));
    run(engine, batch(...fixedPoint('la', 0, 0), { type: 'addPoint', sketch: 's', id: 'lb', x: 4, y: 0 }, { type: 'addCurve', sketch: 's', id: 'l', curve: { type: 'line', a: 'la', b: 'lb' } }));
    expect(solved(engine.getState()).valid).toBe(true);
    expect(refusal(engine, 'extend', { curve: 'l', end: 'b' })).toMatch(/one point/);
    // a second line across the circle makes the profile invalid: the extend is taken
    run(engine, batch(...fixedLine('m', [-15, 5], [15, 5])));
    const ids = cut(engine, 'extend', { curve: 'l', end: 'b' });
    expect(ids.changed).toContain('l');
  });

  it('the axes of the origin: a construction line split with origin/x, one extended onto origin/y, also 900 m away', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY));
    for (const x of [10, -10]) {
      run(engine, batch(...fixedLine(`c${x < 0 ? 'm' : 'p'}`, [x, -5], [x, 5], 's', true)));
      const ids = cut(engine, 'split', { curve: `c${x < 0 ? 'm' : 'p'}`, with: 'origin/x' });
      expect(solved(engine.getState()).points[ids.points[0]].y).toBeCloseTo(0, 9);
    }
    for (const [id, y] of [
      ['e1', 25],
      ['e2', -25],
      ['e3', 900000],
    ] as const) {
      run(engine, batch(...fixedPoint(`${id}a`, -30, y), { type: 'addPoint', sketch: 's', id: `${id}b`, x: -10, y }, { type: 'addCurve', sketch: 's', id, curve: { type: 'line', a: `${id}a`, b: `${id}b`, construction: true } }, constrain('s', `${id}h`, { type: 'horizontal', line: id })));
      cut(engine, 'extend', { curve: id, end: 'b', with: 'origin/y' });
      const end = (sketchOf(engine.getState()).curves[id] as { b: Id }).b;
      expect(solved(engine.getState()).points[end].x, id).toBeCloseTo(0, 6);
    }
  });
});

describe('the query of the contacts', () => {
  it('every kind with what split without a curve does there; lying pairs, a curve of no length, max and total', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY));
    run(
      engine,
      batch(
        ...fixedLine('a', [0, 0], [20, 0]),
        ...fixedLine('b', [10, -5], [10, 5]), // a crossing with a
        ...fixedLine('c', [15, 0], [15, 5]), // an end on a
        ...fixedLine('d', [30, 0], [50, 0]),
        ...fixedLine('e', [40, 0], [60, 0]), // an overlap with d
      ),
    );
    const found = contacts(engine);
    expect(found.valid).toBe(false);
    expect(found.contacts.map((c) => [c.kind, c.curves.join(), c.fix])).toEqual([
      ['crossing', 'a,b', 'cut'],
      ['end', 'a,c', 'cut'],
      ['overlap', 'd,e', 'cut'],
      ['overlap', 'd,e', 'cut'],
    ]);
    expect(found.total).toBe(4);
    expect(found.lying).toEqual([['d', 'e']]);
    const outcome = engine.query('sketchContacts', { sketch: 's', max: 1 });
    expect(outcome.ok && [outcome.result.contacts.length, outcome.result.total]).toEqual([1, 4]);
  });

  it('a line entering an arc by less than the chord tolerance: once split, the region between is too thin, and the query names it', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), batch(...fixedLine('L', [-10, 0], [10, 0]), ...fixedPoint('c', 0, 5 - 0.005), { type: 'addPoint', sketch: 's', id: 'p', x: -5, y: 5 }, { type: 'addPoint', sketch: 's', id: 'q', x: 5, y: 5 }));
    run(engine, batch({ type: 'addCurve', sketch: 's', id: 'A', curve: { type: 'arc', center: 'c', start: 'p', end: 'q' } }, { type: 'addCurve', sketch: 's', id: 'ch', curve: { type: 'line', a: 'q', b: 'p' } }, constrain('s', 'chh', { type: 'horizontal', line: 'ch' }), constrain('s', 'mid', { type: 'midpoint', point: 'c', line: 'ch' }), dimension('s', 'r', { type: 'radius', curve: 'A' }, 5)));
    expect(contacts(engine).contacts.map((c) => c.kind)).toEqual(['crossing', 'crossing']);
    cut(engine, 'split', {});
    const found = contacts(engine);
    expect(found.valid).toBe(false);
    expect(found.total).toBe(0);
    expect(found.tight?.curves).toHaveLength(2);
    expect(found.reason).toMatch(/thinner than the chord tolerance/);
  });

  it('a generated profile over a circle added and removed between two queries without a change of the sketch: fix follows', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), circle('s', 'k', 0, 0, 10), batch(...fixedLine('L', [-20, 0], [20, 0])));
    expect(contacts(engine).contacts.map((c) => c.fix)).toEqual(['cut', 'cut']);
    run(engine, { type: 'addFeature', feature: { id: 'gear', name: 'gear', suppressed: false, type: 'extrude', profile: { type: 'generated', generator: 'involuteGear', sketch: 's', operands: { circle: 'k' }, params: { teeth: 20 } }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } as never });
    expect(contacts(engine).contacts.map((c) => c.fix)).toEqual(['none', 'none']);
    run(engine, { type: 'removeFeature', id: 'gear' });
    expect(contacts(engine).contacts.map((c) => c.fix)).toEqual(['cut', 'cut']);
  });
});

describe('the repair by default', () => {
  it('on with a feature over regions of the sketch, off without one and with walls alone', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40), addSketch('w', XY), batch(...fixedLine('wl', [0, 0], [10, 0], 'w')), addSketch('n', XY));
    run(engine, addExtrude('plate', 's', [rectLoop('r')], 1), { type: 'addFeature', feature: { id: 'wall', name: 'wall', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 'w', curves: ['wl'], thickness: 2 }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } });
    const document = engine.getState().document;
    expect([repairsByDefault(document, 's'), repairsByDefault(document, 'w'), repairsByDefault(document, 'n')]).toEqual([true, false, false]);
  });
});

describe('a circle turned into an arc under the chamfer of D67 (4c)', () => {
  // a circle of radius 10 about the origin, its rim chamfered; a line at x = 6 across it, and
  // three trims leave a D (the arc under the circle's ID and the piece of the line)
  function dShape(engine: Engine, body: Id): CutIds[] {
    run(engine, { type: 'addFeature', feature: { id: 'ch', name: 'ch', suppressed: false, type: 'chamfer', body, edges: [{ a: side('boss', 'k'), b: cap(body) }], distance: 1 } });
    expect(engine.getState().evaluation.features['ch'].status).toBe('ok');
    run(engine, batch(...fixedLine('L', [6, -15], [6, 15])));
    return [cut(engine, 'trim', { at: [10, 0] }), cut(engine, 'trim', { at: [6, 12] }), cut(engine, 'trim', { at: [6, -12] })];
  }

  it('the chamfer of a D-shaped boss runs out past the side of the line', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), circle('s', 'k', 0, 0, 10), addExtrude('boss', 's', [['k']], 10));
    const [first] = dShape(engine, 'boss');
    expect(first.patched).toEqual(['boss']);
    const state = engine.getState();
    expect(regions(state, 'boss')).toEqual([['k', first.added[0]]]);
    expect(state.evaluation.features['ch'].status).toBe('ok');
    // the D less what the chamfer takes along the arc
    const d = (Math.PI * 100 - (100 * Math.acos(0.6) - 48)) * 10;
    expect(volumeOf(state, 'boss')).toBeLessThan(d);
    expect(volumeOf(state, 'boss')).toBeGreaterThan(d - 0.5 * 2 * Math.PI * 10);
  });

  it('the chamfer of the rim of a D-shaped hole is refused: the line is a stop it cannot end at', () => {
    const engine = newEngine();
    run(engine, addSketch('p', XY), rectangle('p', 'r', -30, -30, 60, 60, null), addExtrude('plate', 'p', [rectLoop('r')], 10));
    run(engine, addSketch('s', XY), circle('s', 'k', 0, 0, 10), addExtrude('boss', 's', [['k']], 10, 'cut', 'plate'));
    dShape(engine, 'plate');
    expect(engine.getState().evaluation.features['ch'].error?.code).toBe('unsupportedEdge');
  });
});

describe('the belt: two circles and two lines tangent to both', () => {
  it('one split cuts each circle once at each tangent point, nothing conflicts; two trims leave the outline of a belt', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), batch(...fixedPoint('c1', 0, 0), ...fixedPoint('c2', 40, 0)));
    const line = (id: Id, y: number): Command[] => [
      { type: 'addPoint', sketch: 's', id: `${id}a`, x: 0, y },
      { type: 'addPoint', sketch: 's', id: `${id}b`, x: 40, y },
      { type: 'addCurve', sketch: 's', id, curve: { type: 'line', a: `${id}a`, b: `${id}b` } },
      constrain('s', `${id}t1`, { type: 'tangent', a: id, b: 'k1' }),
      constrain('s', `${id}t2`, { type: 'tangent', a: id, b: 'k2' }),
      constrain('s', `${id}o1`, { type: 'pointOnCurve', point: `${id}a`, curve: 'k1' }),
      constrain('s', `${id}o2`, { type: 'pointOnCurve', point: `${id}b`, curve: 'k2' }),
    ];
    run(
      engine,
      batch(
        { type: 'addCurve', sketch: 's', id: 'k1', curve: { type: 'circle', center: 'c1' }, radius: 10 },
        { type: 'addCurve', sketch: 's', id: 'k2', curve: { type: 'circle', center: 'c2' }, radius: 10 },
        dimension('s', 'r1', { type: 'radius', curve: 'k1' }, 10),
        constrain('s', 'eq', { type: 'equalRadius', a: 'k1', b: 'k2' }),
        ...line('top', 10),
        ...line('bottom', -10),
      ),
    );
    const before = engine.getState();
    expect(solved(before).valid).toBe(false);
    expect(contacts(engine).contacts.map((c) => [c.kind, c.fix])).toEqual([
      ['end', 'cut'],
      ['end', 'cut'],
      ['end', 'cut'],
      ['end', 'cut'],
    ]);
    const ids = cut(engine, 'split', {});
    expect(ids.changed).toEqual(['k1', 'k2']);
    let state = engine.getState();
    expect(state.evaluation.features['s'].status).toBe('ok');
    expect(solved(state).degreesOfFreedom).toBe(solved(before).degreesOfFreedom);
    cut(engine, 'trim', { at: [10, 0] });
    cut(engine, 'trim', { at: [30, 0] });
    state = engine.getState();
    expect(solved(state).valid).toBe(true);
    expect(solved(state).regions).toHaveLength(1);
    run(engine, addExtrude('belt', 's', [solved(state).regions[0].ref.outerLoop], 1));
    expect(volumeOf(engine.getState(), 'belt')).toBeCloseTo(40 * 20 + Math.PI * 100, 0);
    expect(preview(engine, { type: 'setConstraintValue', sketch: 's', id: 'r1', value: 12 }).evaluation.features['s'].status).toBe('ok');
  });
});

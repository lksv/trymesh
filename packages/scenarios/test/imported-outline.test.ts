// The imported outline (D72) with the real solver and kernel: an outline that bounds regions and
// names side faces, a closed spline, an open outline closed by own curves, the packages before it
// over an outline (6e's contacts and tools, 6c's mirror, 6b's projections, 6d's spline), a revised
// outline in a model, and the input of the solver narrowed to what the constraints name. The pure
// parts are in packages/engine/test/imported-outline.test.ts; scenario 15 in scenario15.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { type Command, type Engine, type EngineState, type Id, type ImportedCurve, type SketchFeature, type SketchResult, type SketchToolInputs, freshIds, repairsByDefault, sketchTool } from '@trymesh/engine';
import { IMPORTED_OUTLINE, addOutline, boardCurves, pcbByHand } from './board-kit';
import { XY, addExtrude, addSketch, batch, constrain, newEngine, run, side, status, volume } from './kit';

// The narrowing of the solver's input switched off for a comparison with the whole input (the
// kind of the registry is the module's object, so its `narrow` is read at every recompute).
const flags = vi.hoisted(() => ({ narrow: true }));
vi.mock('../../engine/src/references/outline', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../engine/src/references/outline')>();
  const outline = { ...original.outline };
  Object.defineProperty(outline, 'narrow', { get: () => (flags.narrow ? true : undefined), enumerable: true });
  return { ...original, outline };
});

const resultOf = (state: EngineState, id: Id): SketchResult => state.evaluation.features[id].sketch as SketchResult;
const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
const loopsOf = (state: EngineState, sketch: Id): Id[][] => resultOf(state, sketch).regions.map((region) => region.ref.outerLoop);
const pt = (sketch: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
const ln = (sketch: Id, id: Id, a: Id, b: Id): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b } });
const update = (sketch: Id, id: Id, ref: Record<string, unknown>): Command => ({ type: 'updateExternal', sketch, id, ref: { type: 'outline', ...ref } }) as Command;
const project = (sketch: Id, id: Id, source: Id, entity: Id, kind: string, regions = false): Command => ({ type: 'addExternal', sketch, id, ref: { type: 'sketch', sketch: source, entity, kind, regions } }) as Command;
const loopArea = (loop: Float64Array): number => {
  let sum = 0;
  for (let i = 0; i < loop.length; i += 2) {
    const j = (i + 2) % loop.length;
    sum += loop[i] * loop[j + 1] - loop[j] * loop[i + 1];
  }
  return Math.abs(sum / 2);
};
const regionArea = (state: EngineState, sketch: Id): number => resultOf(state, sketch).regions.reduce((sum, region) => sum + region.loops.reduce((part, loop, i) => part + (i === 0 ? 1 : -1) * loopArea(loop), 0), 0);
const toolContext = (state: EngineState, sketch: Id) => ({ sketch: sketchOf(state, sketch), result: resultOf(state, sketch), parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features });
function tool<K extends keyof SketchToolInputs>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix: string): { ok: true; state: EngineState } | { ok: false; message: string } {
  const state = engine.getState();
  const made = sketchTool(name, toolContext(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) return { ok: false, message: made.message };
  return { ok: true, state: run(engine, batch(...made.commands)) };
}
const contacts = (engine: Engine, sketch: Id) => {
  const outcome = engine.query('sketchContacts', { sketch });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result;
};
// the board placed by the centre of its box on the origin of the sketch `board`
const board = (engine: Engine, more: Record<string, unknown> = {}, curves: Record<Id, ImportedCurve> = boardCurves()): EngineState =>
  run(engine, addSketch('board', XY), addOutline('board', 'o', { curves, anchor: 'center', ...more }));

describe('an imported outline in a sketch (D72)', () => {
  it('bounds one region with four holes, named by its curves; extruded, its side faces are named by them', () => {
    const engine = newEngine();
    let state = board(engine);
    const result = resultOf(state, 'board');
    expect(status(state).board).toBe('ok');
    expect(result.valid).toBe(true);
    expect(result.degreesOfFreedom).toBe(0);
    expect(result.openEnds).toBeUndefined();
    expect(loopsOf(state, 'board')).toContainEqual(IMPORTED_OUTLINE('o'));
    expect(loopsOf(state, 'board').filter((loop) => loop.length === 1)).toHaveLength(4);
    expect(result.points['o/c1/center'].x).toBeCloseTo(-26.5, 9);
    expect(result.points['o/c1/center'].y).toBeCloseTo(-16.5, 9);
    expect(result.curves['o/a1']).toMatchObject({ source: 'reference', regions: true, shape: { type: 'arc' } });
    expect(sketchOf(state, 'board').solved.external.o).toMatchObject({ kind: 'outline', at: [-130, -100], turn: 0 });
    state = run(engine, addExtrude('pcb', 'board', [IMPORTED_OUTLINE('o')], 1.6));
    expect(status(state).pcb).toBe('ok');
    // the arcs and the circles are divided within the chord tolerance: 3776.38 against 3776.17 by hand
    expect(Math.abs(volume(state.evaluation.bodies.pcb.solid) - pcbByHand(60))).toBeLessThan(0.3);
    const faces = state.evaluation.bodies.pcb.faces.map((f) => state.evaluation.faceNames[f.id]);
    expect(faces).toContainEqual(side('pcb', 'o/a1'));
    expect(faces).toContainEqual(side('pcb', 'o/l3'));
  });

  it('with the flag off bounds nothing, and the stamp stays', () => {
    const engine = newEngine();
    let state = board(engine);
    const stamp = sketchOf(state, 'board').solved.inputs;
    state = run(engine, update('board', 'o', { regions: false }));
    expect(loopsOf(state, 'board')).toEqual([]);
    expect(resultOf(state, 'board').valid).toBe(true);
    expect(sketchOf(state, 'board').solved.inputs).toBe(stamp);
  });

  it('a closed spline bounds its region and has no open end', () => {
    const engine = newEngine();
    const curves: Record<Id, ImportedCurve> = { s1: { type: 'spline', points: [[0, 0], [10, -5], [20, 5], [10, 15], [0, 0]] } };
    const state = run(engine, addSketch('s', XY), addOutline('s', 'o', { curves }));
    expect(loopsOf(state, 's')).toEqual([['o/s1']]);
    expect(resultOf(state, 's').openEnds).toBeUndefined();
  });

  it('an outline without its bottom side lists two open ends; own lines held on them close it', () => {
    const engine = newEngine();
    const { l1: _side, ...rest } = boardCurves();
    let state = run(engine, addSketch('board', XY), addOutline('board', 'o', { curves: rest, x: -130, y: -100 }));
    const open = resultOf(state, 'board').openEnds;
    expect(open?.count).toBe(2);
    expect(open?.ends.map((end) => end.end).sort()).toEqual(['o/a1/start', 'o/a4/end']);
    expect(open?.ends[0]).toMatchObject({ reason: 'apart' });
    state = run(
      engine,
      batch(
        pt('board', 'e1', -27, -20),
        pt('board', 'e2', 27, -20),
        pt('board', 'm1', -5, -20),
        pt('board', 'm2', -5, -14),
        pt('board', 'm3', 5, -14),
        pt('board', 'm4', 5, -20),
        constrain('board', 'k1', { type: 'coincident', a: 'e1', b: 'o/a4/end' }),
        constrain('board', 'k2', { type: 'coincident', a: 'e2', b: 'o/a1/start' }),
        ln('board', 'b1', 'e1', 'm1'),
        ln('board', 'b2', 'm1', 'm2'),
        ln('board', 'b3', 'm2', 'm3'),
        ln('board', 'b4', 'm3', 'm4'),
        ln('board', 'b5', 'm4', 'e2'),
      ),
    );
    expect(resultOf(state, 'board').valid).toBe(true);
    expect(resultOf(state, 'board').openEnds).toBeUndefined();
    expect(loopsOf(state, 'board').filter((loop) => loop.length > 1)).toHaveLength(1);
    // the region with its holes and the four discs: the outline less the notch
    expect(regionArea(state, 'board')).toBeCloseTo(2400 - (4 - Math.PI) * 9 - 60, 0);
  });

  it('two outlines on each other make the profile invalid, and the query lists the pairs', () => {
    const engine = newEngine();
    let state = board(engine);
    state = run(engine, addOutline('board', 'p', { curves: boardCurves(), anchor: 'center', x: 70 }));
    expect(resultOf(state, 'board').valid).toBe(true);
    state = run(engine, { type: 'setField', feature: 'board', path: 'external/p/x', value: 0 } as Command);
    expect(resultOf(state, 'board').valid).toBe(false);
    expect(contacts(engine, 'board').lying.length).toBeGreaterThanOrEqual(12);
  });
});

describe('the packages before 6f over an imported outline (D72)', () => {
  const notch = (engine: Engine): EngineState => run(engine, batch(pt('board', 'n1', 0, -25), pt('board', 'n2', 0, -15), ln('board', 'n', 'n1', 'n2')));

  it("6e: an own line across a side of an outline that forms regions gets the outline's reason; split refuses it", () => {
    const engine = newEngine();
    board(engine);
    const state = notch(engine);
    expect(resultOf(state, 'board').valid).toBe(false);
    const found = contacts(engine, 'board');
    const crossing = found.contacts.find((c) => c.curves.includes('o/l1'));
    expect(crossing).toMatchObject({ fix: 'none' });
    expect(crossing?.why).toContain('is a curve of the imported outline o, which forms regions and is not cut');
    const split = tool(engine, 'split', 'board', {}, 's');
    expect(split.ok).toBe(false);
  });

  it('6e: a spline of an outline that an own line crosses gets the outline reason, not "move the control points"', () => {
    const engine = newEngine();
    const curves: Record<Id, ImportedCurve> = { l1: { type: 'line', a: [0, 0], b: [20, 0] }, s1: { type: 'spline', points: [[20, 0], [20, 10], [0, 10], [0, 0]] } };
    run(engine, addSketch('s', XY), addOutline('s', 'o', { curves }), batch(pt('s', 'p', 10, 5), pt('s', 'q', 10, 20), ln('s', 'n', 'p', 'q')));
    const crossing = contacts(engine, 's').contacts.find((c) => c.curves.includes('o/s1'));
    expect(crossing?.why).toContain('is a curve of the imported outline o');
  });

  it('6e: with the flag off a trim with a line of the outline cuts the own line and holds its end there; an extend reaches a side', () => {
    const engine = newEngine();
    board(engine, { regions: false });
    notch(engine);
    expect(resultOf(engine.getState(), 'board').valid).toBe(true);
    const trimmed = tool(engine, 'trim', 'board', { curve: 'n', at: [0, -23], with: 'o/l1' } as never, 't');
    expect(trimmed.ok).toBe(true);
    const constraints = Object.values(sketchOf(engine.getState(), 'board').constraints);
    expect(constraints).toContainEqual(expect.objectContaining({ type: 'pointOnCurve', curve: 'o/l1' }));
    const extended = tool(engine, 'extend', 'board', { curve: 'n', end: 'b', with: 'o/l3' } as never, 'v');
    expect(extended.ok).toBe(true);
    const n = sketchOf(engine.getState(), 'board').curves.n as { b: Id };
    expect(resultOf(engine.getState(), 'board').points[n.b].y).toBeCloseTo(20, 6);
  });

  it('6e: an extension toward a spline of an outline is told that a spline stops nothing', () => {
    const engine = newEngine();
    const curves: Record<Id, ImportedCurve> = { s1: { type: 'spline', points: [[20, -10], [25, 0], [20, 10], [25, 20]] } };
    run(engine, addSketch('s', XY), addOutline('s', 'o', { curves, regions: false }), batch(pt('s', 'p', 0, 5), pt('s', 'q', 5, 5), ln('s', 'n', 'p', 'q')));
    const extended = tool(engine, 'extend', 's', { curve: 'n', end: 'b' } as never, 'v');
    expect(extended.ok).toBe(false);
    if (!extended.ok) expect(extended.message).toContain('only the spline "o/s1"');
  });

  it('6c: a mirror about a line of an outline; a curve of an outline is no source', () => {
    const engine = newEngine();
    board(engine, { regions: false });
    const state = run(
      engine,
      batch(pt('board', 'q1', 30, -5), pt('board', 'q2', 40, 0), pt('board', 'q3', 30, 5), ln('board', 'g1', 'q1', 'q2'), ln('board', 'g2', 'q2', 'q3'), constrain('board', 'h1', { type: 'pointOnCurve', point: 'q1', curve: 'o/l2' }), constrain('board', 'h2', { type: 'pointOnCurve', point: 'q3', curve: 'o/l2' })),
      { type: 'addExternal', sketch: 'board', id: 'm', ref: { type: 'pattern', sources: ['g1', 'g2'], transform: { type: 'mirror', axis: 'o/l2' } } } as Command,
    );
    expect(status(state).board).toBe('ok');
    expect(resultOf(state, 'board').points['m/1/q2'].x).toBeCloseTo(20, 6);
    expect(loopsOf(state, 'board')).toHaveLength(1);
    const refused = engine.execute({ type: 'addExternal', sketch: 'board', id: 'm2', ref: { type: 'pattern', sources: ['o/c1'], transform: { type: 'mirror', axis: 'origin/y' } } } as Command);
    expect(refused.ok).toBe(false);
  });

  it('6c: a mirror whose axis a revised outline takes away loses its copies (brokenCopies), and the document loads', () => {
    const engine = newEngine();
    board(engine, { regions: false });
    run(engine, batch(pt('board', 'q1', 30, -5), pt('board', 'q2', 40, 0), ln('board', 'g1', 'q1', 'q2')), { type: 'addExternal', sketch: 'board', id: 'm', ref: { type: 'pattern', sources: ['g1'], transform: { type: 'mirror', axis: 'o/l2' } } } as Command);
    const { l2: _gone, ...fewer } = boardCurves();
    const state = run(engine, update('board', 'o', { curves: fewer }));
    expect(state.evaluation.features.board.warnings.map((w) => w.code)).toContain('brokenCopies');
    const loaded = newEngine().load(JSON.stringify(state.document));
    expect(loaded.ok).toBe(true);
  });

  it('6b: a later sketch projects a circle, a point and an arc of an outline; a revised file without the circle freezes it', () => {
    const engine = newEngine();
    board(engine);
    let state = run(engine, addSketch('later', XY), project('later', 'x1', 'board', 'o/c4', 'circle', true), project('later', 'x2', 'board', 'o/l1/a', 'point'), project('later', 'x3', 'board', 'o/a1', 'arc'));
    expect(status(state).later).toBe('ok');
    expect(resultOf(state, 'later').points.x2.x).toBeCloseTo(-27, 9);
    expect(loopsOf(state, 'later')).toEqual([['x1']]);
    expect(repairsByDefault(state.document, 'board')).toBe(true);
    const { c4: _gone, ...fewer } = boardCurves();
    state = run(engine, update('board', 'o', { curves: fewer }));
    expect(state.evaluation.features.later.warnings.map((w) => `${w.code}: ${w.message}`).join()).toContain('board has no circle o/c4');
    expect(resultOf(state, 'later').points['x1/center'].x).toBeCloseTo(-26.5, 9);
  });

  it('6b, 6d: a spline of an outline is refused as a projection with the text of 6d, and the whole sketch projected leaves it out; a point on it is refused', () => {
    const engine = newEngine();
    const curves: Record<Id, ImportedCurve> = { l1: { type: 'line', a: [0, 0], b: [20, 0] }, s1: { type: 'spline', points: [[20, 0], [20, 10], [0, 10], [0, 0]] } };
    run(engine, addSketch('s', XY), addOutline('s', 'o', { curves }), addSketch('s2', XY));
    const projected = engine.execute(project('s2', 'x', 's', 'o/s1', 'line'));
    expect(projected.ok).toBe(false);
    if (!projected.ok) expect(projected.error.message).toContain('is a spline, and a spline is not projected yet');
    const whole = tool(engine, 'projectSketch', 's2', { sketch: 's' } as never, 'w');
    expect(whole.ok).toBe(true);
    if (whole.ok) expect(Object.values(sketchOf(whole.state, 's2').external).map((ref) => (ref as { entity: Id }).entity)).toEqual(['o/l1']);
    const onSpline = engine.execute(constrain('s', 'k', { type: 'pointOnCurve', point: 'origin', curve: 'o/s1' }));
    expect(onSpline.ok).toBe(false);
  });

  it('6b: projectSketch as own draws an own outline over the import, determined, which follows a revised file', () => {
    const engine = newEngine();
    board(engine);
    run(engine, addSketch('floor', XY));
    const made = tool(engine, 'projectSketch', 'floor', { sketch: 'board', as: 'own' } as never, 'f');
    expect(made.ok).toBe(true);
    let state = engine.getState();
    expect(resultOf(state, 'floor').degreesOfFreedom).toBe(0);
    expect(resultOf(state, 'floor').redundant).toEqual([]);
    const before = regionArea(state, 'floor');
    state = run(engine, update('board', 'o', { curves: boardCurves(62) }));
    expect(status(state).floor).toBe('ok');
    expect(regionArea(state, 'floor') - before).toBeCloseTo(80, 1);
  });

  it('a hole at the centre of a circle of an outline is refused; the disc is cut again', () => {
    const engine = newEngine();
    board(engine);
    run(engine, addExtrude('pcb', 'board', [IMPORTED_OUTLINE('o')], 1.6));
    const hole = engine.preview({ type: 'addFeature', feature: { id: 'h', name: 'h', suppressed: false, type: 'hole', sketch: 'board', points: ['o/c1/center'], shape: { type: 'plain', diameter: 2 }, extent: { type: 'throughAll' }, targets: ['pcb'] } } as unknown as Command);
    expect(hole.ok).toBe(false);
    const cut = run(engine, addExtrude('c', 'board', [['o/c1']], 1.6, 'cut', 'pcb'));
    expect(status(cut).c).toBe('ok');
  });
});

describe('a revised outline (D72)', () => {
  it('the board 2 mm wider keeps every ID and what is built on it follows', () => {
    const engine = newEngine();
    board(engine);
    let state = run(engine, addExtrude('pcb', 'board', [IMPORTED_OUTLINE('o')], 1.6));
    const before = volume(state.evaluation.bodies.pcb.solid);
    state = run(engine, update('board', 'o', { curves: boardCurves(62) }));
    expect(status(state)).toMatchObject({ board: 'ok', pcb: 'ok' });
    expect(volume(state.evaluation.bodies.pcb.solid) - before).toBeCloseTo(2 * 40 * 1.6, 3);
    expect(resultOf(state, 'board').points['o/c1/center'].x).toBeCloseTo(-27.5, 9);
  });

  it('the turn as an expression, and setField of the place', () => {
    const engine = newEngine();
    run(engine, { type: 'setParameter', name: 'boardTurn', expr: 'deg(90)' });
    let state = board(engine, { turn: 'boardTurn' });
    expect(sketchOf(state, 'board').expressions).toEqual({ 'external/o/turn': 'boardTurn' });
    expect(resultOf(state, 'board').points['o/c1/center'].x).toBeCloseTo(16.5, 9);
    expect(resultOf(state, 'board').points['o/c1/center'].y).toBeCloseTo(-26.5, 9);
    state = run(engine, { type: 'setField', feature: 'board', path: 'external/o/x', value: 5 } as Command);
    expect(resultOf(state, 'board').points['o/c1/center'].x).toBeCloseTo(21.5, 9);
    state = run(engine, { type: 'renameParameter', name: 'boardTurn', to: 'turn' } as Command);
    expect(sketchOf(state, 'board').expressions?.['external/o/turn']).toBe('turn');
  });
});

describe('the input of the solver narrowed to what the constraints name (D72)', () => {
  const holes = (): Record<Id, ImportedCurve> => Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`c${i + 1}`, { type: 'circle', center: [i * 10, 0], radius: 1 + i / 10 }]));

  it('a circle no constraint names, and one whose centre alone is named, keep their radii on each path of the step', () => {
    const engine = newEngine();
    let state = run(engine, addSketch('s', XY), addOutline('s', 'o', { curves: holes() }), pt('s', 'p', 1, 1), constrain('s', 'k', { type: 'coincident', a: 'p', b: 'o/c3/center' }));
    const check = (s: EngineState): void => {
      const result = resultOf(s, 's');
      expect(result.radii['o/c1']).toBe(1);
      expect(result.radii['o/c3']).toBeCloseTo(1.2, 12);
      expect(loopsOf(s, 's')).toHaveLength(20);
    };
    // a new stamp
    check(state);
    // the stamp kept
    state = run(engine, pt('s', 'r', 50, 50));
    check(state);
    // a failed solve: two fixed points at different places
    state = run(engine, constrain('s', 'k2', { type: 'coincident', a: 'p', b: 'o/c5/center' }));
    expect(state.evaluation.features.s.warnings.map((w) => w.code)).toContain('sketchConflict');
    check(state);
  });

  it('the result and the diagnosis equal those of the whole input', () => {
    const model = (): Engine => {
      const engine = newEngine();
      board(engine);
      run(
        engine,
        batch(pt('board', 'p', 20, -20), pt('board', 'q', 5, 5), pt('board', 'r', 0, 0), pt('board', 'u', 22, -16), pt('board', 'v', 10, 0)),
        ln('board', 'n', 'u', 'v'),
        constrain('board', 'k1', { type: 'pointOnCurve', point: 'p', curve: 'o/a1' }),
        constrain('board', 'k2', { type: 'distance', a: 'q', b: 'o/c1/center', value: 4, driving: true } as never),
        constrain('board', 'k3', { type: 'distancePointLine', point: 'q', line: 'o/l2', value: 1, driving: false } as never),
        constrain('board', 'k4', { type: 'coincident', a: 'r', b: 'o/c3/center' }),
        constrain('board', 'k5', { type: 'parallel', a: 'n', b: 'o/l1' }),
        constrain('board', 'k6', { type: 'radius', curve: 'o/c2', value: 1, driving: false } as never),
        constrain('board', 'k7', { type: 'tangent', a: 'n', b: 'o/a2' }),
      );
      run(engine, { type: 'dragPoint', sketch: 'board', point: 'q', x: 6, y: 7 } as Command);
      return engine;
    };
    const sorted = <T>(record: Record<Id, T>): Record<Id, T> => Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));
    const seen = (engine: Engine) => {
      const state = engine.getState();
      const { points, radii, ...rest } = resultOf(state, 'board');
      return { points: sorted(points), radii: sorted(radii), rest: JSON.stringify({ ...rest, regions: rest.regions.map((r) => r.ref) }), diagnosis: engine.diagnoseSketch('board'), status: status(state) };
    };
    const narrowed = seen(model());
    flags.narrow = false;
    try {
      const whole = seen(model());
      expect(narrowed).toEqual(whole);
    } finally {
      flags.narrow = true;
    }
    // the keys of the points: own geometry first, then the entry, whatever is named
    const keys = Object.keys(resultOf(model().getState(), 'board').points);
    expect(keys.slice(0, 7)).toEqual(['origin', 'p', 'q', 'r', 'u', 'v', 'o/l1/a']);
  });

  it('2000 curves of an outline and repeated drags', () => {
    const engine = newEngine();
    const many: Record<Id, ImportedCurve> = {};
    for (let i = 0; i < 1000; i++) {
      many[`l${i + 1}`] = { type: 'line', a: [i * 2, 0], b: [i * 2 + 1, 0] };
      many[`c${i + 1}`] = { type: 'circle', center: [i * 2, 10], radius: 0.4 };
    }
    run(engine, addSketch('s', XY), addOutline('s', 'o', { curves: many, regions: false }), pt('s', 'p', 1, 1), constrain('s', 'k', { type: 'pointOnCurve', point: 'p', curve: 'o/c7' }));
    for (let i = 0; i < 50; i++) {
      const dragged = engine.execute({ type: 'dragPoint', sketch: 's', point: 'p', x: 12 + Math.cos(i), y: 10 + Math.sin(i) } as Command);
      expect(dragged.ok).toBe(true);
    }
    const state = engine.getState();
    expect(state.evaluation.features.s.status).toBe('ok');
    const p = resultOf(state, 's').points.p;
    expect(Math.hypot(p.x - 12, p.y - 10)).toBeCloseTo(0.4, 9);
  });
});

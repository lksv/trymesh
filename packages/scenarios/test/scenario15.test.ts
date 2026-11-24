// Validation scenario 15 (a cover for a controller board, docs/requirements.md). The parts of the
// points of step 6 of D36 each have a `describe` of their own; the board of step 1 is a stand-in
// until 6f imports one, and 6c and 6b build on it.
import { describe, expect, it } from 'vitest';
import { type Command, type CutIds, type Engine, type EngineState, type Expr, type Id, type SketchFeature, type SketchResult, type SketchToolInputs, AXIS_CURVES, AXIS_REACH, emptySketch, freshIds, lineExtent, repairsByDefault, sketchTool, solvedCurves } from '@trymesh/engine';
import { pcbByHand, point, standInBoard } from './board-kit';
import { XY, addSketch, batch, constrain, newEngine, run } from './kit';

const resultOf = (state: EngineState, id: Id): SketchResult => state.evaluation.features[id].sketch as SketchResult;
const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
const set = (engine: Engine, name: string, expr: string): EngineState => run(engine, { type: 'setParameter', name, expr });
const refusal = (engine: Engine, command: Command): string => {
  const result = engine.execute(command);
  return result.ok ? 'accepted' : result.error.message;
};

// Fully determined: no freedom and no constraint that follows from the others, in the solver's
// list and in the diagnosis; the body as by hand.
function expectDetermined(engine: Engine, state: EngineState, width: number): void {
  const diagnosis = engine.diagnoseSketch('board');
  expect(diagnosis.status).toBe('solved');
  expect(diagnosis.degreesOfFreedom).toBe(0);
  expect(diagnosis.redundant).toEqual([]);
  expect(resultOf(state, 'board').redundant).toEqual([]);
  expect(resultOf(state, 'board').degreesOfFreedom).toBe(0);
  expect(state.evaluation.features.board.status).toBe('ok');
  expect(state.evaluation.features.pcb.status).toBe('ok');
  expect(state.evaluation.bodies.pcb.volume).toBeCloseTo(pcbByHand(width), 0);
}

describe('scenario 15, step 1: the stand-in board on the axes of the origin (6a2, D71)', () => {
  it('is fully determined, with no redundant constraint, and symmetric about both axes', () => {
    const engine = newEngine();
    const state = standInBoard(engine);
    expectDetermined(engine, state, 60);
    const points = resultOf(state, 'board').points;
    expect(points.bs0.x).toBeCloseTo(30, 9);
    expect(points.be2.x).toBeCloseTo(-27, 9);
    expect(points.be2.y).toBeCloseTo(-20, 9);
    expect(points.hc2.x).toBeCloseTo(-26.5, 9);
    expect(points.hc2.y).toBeCloseTo(-16.5, 9);
    expect(points.bc2.x).toBeCloseTo(-27, 9);
    expect(points.bc2.y).toBeCloseTo(-17, 9);
  });

  it('has the axes in its solver and not in its result', () => {
    const engine = newEngine();
    const state = standInBoard(engine);
    const result = resultOf(state, 'board');
    expect(Object.keys(result.curves)).toEqual([]);
    expect(Object.keys(result.points).filter((id) => id.startsWith('origin/'))).toEqual([]);
    const solved = state.document.features.find((f) => f.id === 'board') as SketchFeature;
    expect(solved.solved.inputs).not.toBe('');
  });

  it('follows its width to 62 and back', () => {
    const engine = newEngine();
    standInBoard(engine);
    const wider = set(engine, 'boardW', '62');
    expect(wider.evaluation.features.board.status).toBe('ok');
    expect(wider.evaluation.bodies.pcb.volume).toBeCloseTo(pcbByHand(62), 0);
    expect(resultOf(wider, 'board').points.hc1.x).toBeCloseTo(-27.5, 9);
    expectDetermined(engine, set(engine, 'boardW', '60'), 60);
  });

  it('follows one parameter at a time from the drawn state', () => {
    for (const [name, values] of [
      ['boardW', ['30', '45', '80', '120']],
      ['boardH', ['20', '60', '120']],
      ['boardR', ['0.2', '8']],
    ] as const) {
      for (const value of values) {
        const engine = newEngine();
        standInBoard(engine);
        const state = set(engine, name, value);
        expect(`${name} ${value}: ${state.evaluation.features.board.status} ${state.evaluation.features.pcb.status}`).toBe(`${name} ${value}: ok ok`);
        const W = name === 'boardW' ? Number(value) : 60;
        const H = name === 'boardH' ? Number(value) : 40;
        const R = name === 'boardR' ? Number(value) : 3;
        expect(state.evaluation.bodies.pcb.volume).toBeCloseTo((W * H - (4 - Math.PI) * R * R - Math.PI * 1.6 * 1.6 * 4) * 1.6, 0);
      }
    }
  });

  it('measures a reference dimension from a hole centre to origin/y: 26.5', () => {
    const engine = newEngine();
    standInBoard(engine);
    const state = run(engine, constrain('board', 'mh', { type: 'distancePointLine', point: 'hc0', line: 'origin/y', value: 1, driving: false }));
    expect(resultOf(state, 'board').measurements.mh).toBeCloseTo(26.5, 9);
  });

  it('a ring revolved about origin/x of a sketch whose constraints name no axis', () => {
    const engine = newEngine();
    const t = 'turnSk';
    run(
      engine,
      addSketch(t, XY),
      batch(
        point(t, 't1', 0, 2),
        point(t, 't2', 10, 2),
        point(t, 't3', 10, 5),
        point(t, 't4', 0, 5),
        ...[
          ['u1', 't1', 't2'],
          ['u2', 't2', 't3'],
          ['u3', 't3', 't4'],
          ['u4', 't4', 't1'],
        ].map(([id, a, b]): Command => ({ type: 'addCurve', sketch: t, id, curve: { type: 'line', a, b } })),
      ),
    );
    const state = run(engine, {
      type: 'addFeature',
      feature: { id: 'ring', name: 'ring', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: t, regions: [{ outerLoop: ['u1', 'u2', 'u3', 'u4'] }] }, axis: { kind: 'sketchLine', sketch: t, line: 'origin/x' }, extent: { type: 'full' }, operation: 'new' },
    });
    expect(state.evaluation.features.ring.status).toBe('ok');
    expect(state.evaluation.bodies.ring.volume).toBeCloseTo(Math.PI * (25 - 4) * 10, -1);
    expect(Math.abs(state.evaluation.bodies.ring.volume - Math.PI * 21 * 10)).toBeLessThan(2);
  });

  it('refuses a midpoint or an equal length with an axis, a constraint of fixed operands, the origin as a symmetric point, a far point', () => {
    const engine = newEngine();
    standInBoard(engine);
    expect(refusal(engine, constrain('board', 'z1', { type: 'midpoint', point: 'hc0', line: 'origin/x' }))).toContain('origin/x is an axis of the origin, a whole line: it has no length and no middle');
    expect(refusal(engine, constrain('board', 'z2', { type: 'equalLength', a: 'bl0', b: 'origin/y' }))).toContain('origin/y is an axis of the origin, a whole line: it has no length and no middle');
    expect(refusal(engine, constrain('board', 'z3', { type: 'pointOnCurve', point: 'origin', curve: 'origin/x' }))).toContain('only between fixed entities');
    expect(refusal(engine, constrain('board', 'z4', { type: 'symmetric', a: 'origin', b: 'hc0', line: 'origin/y' }))).toContain('souměrný bod nesmí být koncem osy');
    expect(refusal(engine, { type: 'removeEntity', sketch: 'board', id: 'origin/x' })).toContain('origin/x');
    expect(refusal(engine, constrain('board', 'z5', { type: 'coincident', a: 'hc0', b: 'origin/x/b' }))).toContain('origin/x/b');
  });

  it('the reader of a solved sketch gives the axes as whole lines, and a point the result lacks from the sketch', () => {
    const engine = newEngine();
    const state = standInBoard(engine);
    const before = solvedCurves(sketchOf(state, 'board'), resultOf(state, 'board'));
    const [x, side] = [before.curves.get('origin/x'), before.curves.get('bl0')];
    expect(AXIS_CURVES.map((curve) => curve.id)).toEqual(['origin/x', 'origin/y']);
    expect(x).toMatchObject({ source: 'reference', regions: false });
    expect(before.geometry.points['origin/x/b']).toEqual({ x: 1, y: 0 });
    expect(lineExtent(x!, before.geometry)).toEqual({ a: { x: -AXIS_REACH, y: 0 }, b: { x: AXIS_REACH, y: 0 } });
    expect(lineExtent(side!, before.geometry)?.a).toEqual(resultOf(state, 'board').points.be0);
    // the sketch after a batch that adds a point, with the result from before it
    const later = run(engine, point('board', 'late', 5, 7));
    const after = solvedCurves(sketchOf(later, 'board'), resultOf(state, 'board'));
    expect(after.geometry.points.late).toEqual({ x: 5, y: 7 });
  });
});

// ---------------------------------------------------------------- step 6: the cable notches (6e, D65)

// On stand-ins, since 6e comes before the projection of 6b: plain own outlines. Written after
// docs/d36/6e-trim-extend-split/calls.ts.
type CutTool = 'trim' | 'extend' | 'split';
const dim = (sketch: Id, id: Id, type: 'horizontalDistance' | 'verticalDistance', a: Id, b: Id, value: number | Expr): Command => ({ type: 'addConstraint', sketch, id, constraint: { type, a, b, value, driving: true } });
const pointAt = (sketch: Id, id: Id, x: Expr, y: Expr): Command[] => [{ type: 'addPoint', sketch, id, x: 1, y: 1 }, dim(sketch, `${id}x`, 'horizontalDistance', 'origin', id, x), dim(sketch, `${id}y`, 'verticalDistance', 'origin', id, y)];
// A rectangle with a corner at the origin: `${p}a` (bottom), `${p}b` (right), `${p}c` (top), `${p}d` (left).
function outline(sketch: Id, p: string, width: Expr, height: Expr): Command[] {
  const corners: [number, number][] = [
    [0, 0],
    [10, 1],
    [11, 9],
    [1, 10],
  ];
  return [
    ...corners.map(([x, y], i): Command => ({ type: 'addPoint', sketch, id: `${p}${i + 1}`, x, y })),
    ...['a', 'b', 'c', 'd'].map((name, i): Command => ({ type: 'addCurve', sketch, id: `${p}${name}`, curve: { type: 'line', a: `${p}${i + 1}`, b: `${p}${((i + 1) % 4) + 1}` } })),
    constrain(sketch, `${p}h1`, { type: 'horizontal', line: `${p}a` }),
    constrain(sketch, `${p}v1`, { type: 'vertical', line: `${p}b` }),
    constrain(sketch, `${p}h2`, { type: 'horizontal', line: `${p}c` }),
    constrain(sketch, `${p}v2`, { type: 'vertical', line: `${p}d` }),
    constrain(sketch, `${p}fix`, { type: 'coincident', a: `${p}1`, b: 'origin' }),
    dim(sketch, `${p}w`, 'horizontalDistance', `${p}1`, `${p}2`, width),
    dim(sketch, `${p}h`, 'verticalDistance', `${p}2`, `${p}3`, height),
  ];
}
const toolContext = (state: EngineState, sketch: Id) => ({ sketch: sketchOf(state, sketch), result: resultOf(state, sketch), parameters: state.evaluation.parameters, document: state.document });
function cut<K extends CutTool>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix: string): CutIds {
  const state = engine.getState();
  const made = sketchTool(name, toolContext(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) throw new Error(made.message);
  run(engine, batch(...made.commands));
  return made.ids as CutIds;
}
function cutRefusal<K extends CutTool>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K]): string | undefined {
  const state = engine.getState();
  const made = sketchTool(name, toolContext(state, sketch), input, freshIds(state.document, 'x_'));
  return made.ok ? undefined : made.message;
}
const regionsOf = (state: EngineState, feature: Id): Id[][] => {
  const f = state.document.features.find((g) => g.id === feature);
  return f?.type === 'extrude' && f.profile.type === 'regions' ? f.profile.regions.map((r) => r.outerLoop) : [];
};
const allOk = (state: EngineState): boolean => state.document.features.every((feature) => state.evaluation.features[feature.id].status === 'ok');
const contactsOf = (engine: Engine, sketch: Id) => {
  const outcome = engine.query('sketchContacts', { sketch });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result;
};
const previewOf = (engine: Engine, command: Command): EngineState => {
  const previewed = engine.preview(command);
  if (!previewed.ok) throw new Error(previewed.error.message);
  return previewed.state;
};
const extrusion = (id: Id, sketch: Id, outerLoop: Id[], distance: Expr, offset?: Expr): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop }], ...(offset === undefined ? {} : { offset }) }, extent: { type: 'distance', start: 0, distance }, operation: 'new' },
});
// The area of the circle above the edge, by hand: the circle less the segment below the chord.
const above = (centreY: number, r: number): number => {
  const segment = (d: number): number => r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
  return centreY >= 0 ? Math.PI * r * r - segment(centreY) : segment(-centreY);
};
const notchedVolume = (W: number, H: number, T: number, cableD: number, notchY: number): number => (W * H - above(notchY, cableD / 2)) * T;

// The round notch: an outline 84 × 54 extruded 2 without an offset, a circle of the diameter
// `cableD` whose centre is `notchY` above the middle of the bottom edge.
function baseWithNotch(engine: Engine): EngineState {
  run(engine, { type: 'setParameter', name: 'W', expr: '84' }, { type: 'setParameter', name: 'H', expr: '54' }, { type: 'setParameter', name: 'T', expr: '2' });
  run(engine, { type: 'setParameter', name: 'cableD', expr: '8' }, { type: 'setParameter', name: 'notchY', expr: '1.5' });
  run(engine, { type: 'addFeature', feature: emptySketch('baseSketch', 'baseSketch', XY) }, ...outline('baseSketch', 'b', 'W', 'H'));
  run(engine, extrusion('base', 'baseSketch', ['ba', 'bb', 'bc', 'bd'], 'T'));
  return run(engine, ...pointAt('baseSketch', 'nc', 'W / 2', 'notchY'), { type: 'addCurve', sketch: 'baseSketch', id: 'notch', curve: { type: 'circle', center: 'nc' }, radius: 4 }, constrain('baseSketch', 'notchD', { type: 'diameter', curve: 'notch', value: 'cableD', driving: true } as never));
}

describe('scenario 15, step 6: the cable notches on stand-ins (6e, D65)', () => {
  it('a round notch: the query lists the two crossings; two trims by a place leave the notched outline, the base followed', () => {
    const engine = newEngine();
    const before = baseWithNotch(engine);
    expect(resultOf(before, 'baseSketch').valid).toBe(false);
    expect(before.evaluation.features['base'].error?.code).toBe('invalidProfile');
    const found = contactsOf(engine, 'baseSketch');
    expect(found.valid).toBe(false);
    expect(found.total).toBe(2);
    expect(found.contacts.map((c) => [c.kind, c.fix, c.curves.join()])).toEqual([
      ['crossing', 'cut', 'ba,notch'],
      ['crossing', 'cut', 'ba,notch'],
    ]);
    // trim 1: the piece of the circle below the edge, by a place on it (no ID needed); the base
    // reads regions of the sketch, so the repair is on: the circle becomes an arc under its ID and
    // the edge is cut at the two crossings
    const first = cut(engine, 'trim', 'baseSketch', { at: [42, -2.5] }, 't1_');
    const afterFirst = engine.getState();
    expect(first.changed).toEqual(['ba', 'notch']);
    expect(first.added).toHaveLength(2);
    expect(first.points).toHaveLength(2);
    expect(first.patched).toEqual(['base']);
    expect(first.reshaped).toEqual([]);
    expect(regionsOf(afterFirst, 'base')).toHaveLength(2);
    expect(resultOf(afterFirst, 'baseSketch')).toMatchObject({ valid: true, degreesOfFreedom: 0, redundant: [] });
    expect(contactsOf(engine, 'baseSketch')).toMatchObject({ valid: true, total: 0 });
    expect(afterFirst.evaluation.bodies['base'].volume).toBeCloseTo(84 * 54 * 2, 6);
    const arc = sketchOf(afterFirst, 'baseSketch');
    expect(arc.curves['notch'].type).toBe('arc');
    expect(arc.constraints['notchD']).toMatchObject({ type: 'diameter', curve: 'notch' });
    expect(arc.expressions?.['constraints/notchD/value']).toBe('cableD');
    // naming the edge with a place on its piece inside the circle is refused, with the piece named
    const inner = first.added[0];
    expect(cutRefusal(engine, 'trim', 'baseSketch', { curve: 'ba', at: [42, 0] })).toContain(`"${inner}"`);
    // trim 2: the piece of the edge inside the circle, by a place: a curve with no cut inside it
    const second = cut(engine, 'trim', 'baseSketch', { at: [42, 0] }, 't2_');
    const state = engine.getState();
    expect(second.removed).toContain(inner);
    expect(second.dropped).toEqual(['base']);
    const loop = regionsOf(state, 'base');
    expect(loop).toHaveLength(1);
    expect(loop[0]).toContain('notch');
    expect(loop[0]).toContain('ba');
    expect(loop[0]).not.toContain(inner);
    expect(resultOf(state, 'baseSketch')).toMatchObject({ degreesOfFreedom: 0, redundant: [] });
    expect(Math.abs(state.evaluation.bodies['base'].volume - notchedVolume(84, 54, 2, 8, 1.5))).toBeLessThan(84 * 54 * 2 * 1e-4);
    expect(state.evaluation.faceNames.filter((name) => name.feature === 'base' && name.role === 'side')).toHaveLength(6);
    expect(allOk(state)).toBe(true);
    // the notch follows its parameters; a notch moved off the edge is a conflict of the sketch
    for (const [name, expr, d, y] of [
      ['cableD', '12', 12, 1.5],
      ['cableD', '5', 5, 1.5],
      ['notchY', '-1', 8, -1],
    ] as const) {
      const changed = previewOf(engine, { type: 'setParameter', name, expr });
      expect(allOk(changed), `${name} ${expr}`).toBe(true);
      expect(Math.abs(changed.evaluation.bodies['base'].volume - notchedVolume(84, 54, 2, d, y))).toBeLessThan(84 * 54 * 2 * 1e-4);
    }
    const away = previewOf(engine, { type: 'setParameter', name: 'notchY', expr: '6' });
    expect(away.evaluation.features['baseSketch'].warnings.map((w) => w.code)).toContain('sketchConflict');
    // refusals: a place on another piece of the line the curve was split off, and the others of calls.ts
    expect(cutRefusal(engine, 'trim', 'baseSketch', { curve: 'ba', at: [70, 0] })).toMatch(/another piece on the line of "ba"/);
    expect(cutRefusal(engine, 'trim', 'baseSketch', { curve: 'noSuchCurve', at: [0, 0] })).toMatch(/no curve "noSuchCurve"/);
    expect(cutRefusal(engine, 'split', 'baseSketch', { curve: 'bd' })).toMatch(/nothing crosses or touches "bd"/);
    expect(cutRefusal(engine, 'extend', 'baseSketch', { curve: 'bb', end: 'a' })).toMatch(/ends at "b2" too/);
    expect(cutRefusal(engine, 'extend', 'baseSketch', { curve: 'bb', end: 'start' })).toBe('a line has the ends a and b, not "start"');
  });

  it('a rectangular notch on a floor with the offset of the clearance and the wall: three trims, the volume exactly by hand', () => {
    const engine = newEngine();
    run(engine, { type: 'setParameter', name: 'W', expr: '84' }, { type: 'setParameter', name: 'H', expr: '54' }, { type: 'setParameter', name: 'T', expr: '2' });
    run(engine, { type: 'setParameter', name: 'clearance', expr: '0.5' }, { type: 'setParameter', name: 'wall', expr: '2' }, { type: 'setParameter', name: 'slotW', expr: '8' }, { type: 'setParameter', name: 'slotD', expr: '5' });
    run(engine, { type: 'addFeature', feature: emptySketch('floorSketch', 'floorSketch', XY) }, ...outline('floorSketch', 'f', 'W', 'H'));
    run(engine, extrusion('floor', 'floorSketch', ['fa', 'fb', 'fc', 'fd'], 'T', 'clearance + wall'));
    const line = (id: Id, a: Id, b: Id): Command => ({ type: 'addCurve', sketch: 'floorSketch', id, curve: { type: 'line', a, b } });
    const before = run(
      engine,
      ...pointAt('floorSketch', 'u1', 'W / 2 - slotW / 2 - clearance - wall', 'slotD'),
      { type: 'addPoint', sketch: 'floorSketch', id: 'sa', x: 35, y: -3 },
      { type: 'addPoint', sketch: 'floorSketch', id: 'u2', x: 50, y: 5 },
      { type: 'addPoint', sketch: 'floorSketch', id: 'sc', x: 50, y: -3 },
      line('ua', 'sa', 'u1'),
      line('ub', 'u1', 'u2'),
      line('uc', 'u2', 'sc'),
      constrain('floorSketch', 'uav', { type: 'vertical', line: 'ua' }),
      constrain('floorSketch', 'ubh', { type: 'horizontal', line: 'ub' }),
      constrain('floorSketch', 'ucv', { type: 'vertical', line: 'uc' }),
      dim('floorSketch', 'uw', 'horizontalDistance', 'u1', 'u2', 'slotW + 2 * (clearance + wall)'),
      dim('floorSketch', 'say', 'verticalDistance', 'origin', 'sa', -3),
      dim('floorSketch', 'scy', 'verticalDistance', 'origin', 'sc', -3),
    );
    const floorVolume = (drawnW: number, depth: number): number => ((84 + 5) * (54 + 5) - (drawnW - 5) * depth) * 2;
    expect(before.evaluation.features['floor'].error?.code).toBe('invalidProfile');
    expect(contactsOf(engine, 'floorSketch').total).toBe(2);
    const first = cut(engine, 'trim', 'floorSketch', { at: [42, 0] }, 's1_');
    expect(first.changed).toEqual(['fa', 'ua', 'uc']);
    expect(first.patched).toEqual(['floor']);
    expect(resultOf(engine.getState(), 'floorSketch')).toMatchObject({ valid: true, degreesOfFreedom: 0, redundant: [] });
    expect(engine.getState().evaluation.bodies['floor'].volume).toBeCloseTo(floorVolume(13, 5), 6);
    for (const [at, prefix] of [
      [[35.5, -1.5], 's2_'],
      [[48.5, -1.5], 's3_'],
    ] as const) {
      cut(engine, 'trim', 'floorSketch', { at: [...at] }, prefix);
      expect(resultOf(engine.getState(), 'floorSketch')).toMatchObject({ valid: true, degreesOfFreedom: 0, redundant: [] });
    }
    const state = engine.getState();
    expect(regionsOf(state, 'floor')).toHaveLength(1);
    expect(state.evaluation.bodies['floor'].volume).toBeCloseTo(floorVolume(13, 5), 6);
    expect(allOk(state)).toBe(true);
    // the width and the depth follow; a slot no wider than the offset takes is an error of the floor
    expect(previewOf(engine, { type: 'setParameter', name: 'slotW', expr: '12' }).evaluation.bodies['floor'].volume).toBeCloseTo(floorVolume(17, 5), 6);
    expect(previewOf(engine, { type: 'setParameter', name: 'slotD', expr: '8' }).evaluation.bodies['floor'].volume).toBeCloseTo(floorVolume(13, 8), 6);
    expect(previewOf(engine, { type: 'setParameter', name: 'slotW', expr: '0' }).evaluation.features['floor'].error?.code).toBe('invalidProfile');
  });

  it('two overlapping pads: one split, each extrusion keeps its body; the inner pieces trimmed by places into one outline', () => {
    const engine = newEngine();
    run(engine, { type: 'addFeature', feature: emptySketch('pads', 'pads', XY) }, ...outline('pads', 'A', '40', '30'));
    run(engine, extrusion('padA', 'pads', ['Aa', 'Ab', 'Ac', 'Ad'], '5'));
    run(
      engine,
      ...pointAt('pads', 'B1', '20', '10'),
      ...pointAt('pads', 'B3', '60', '40'),
      { type: 'addPoint', sketch: 'pads', id: 'B2', x: 60, y: 10 },
      { type: 'addPoint', sketch: 'pads', id: 'B4', x: 20, y: 40 },
      ...(['B1', 'B2', 'B3', 'B4'] as const).map((p, i): Command => ({ type: 'addCurve', sketch: 'pads', id: `B${'abcd'[i]}`, curve: { type: 'line', a: p, b: `B${((i + 1) % 4) + 1}` } })),
      constrain('pads', 'Bh1', { type: 'horizontal', line: 'Ba' }),
      constrain('pads', 'Bv1', { type: 'vertical', line: 'Bb' }),
      constrain('pads', 'Bh2', { type: 'horizontal', line: 'Bc' }),
      constrain('pads', 'Bv2', { type: 'vertical', line: 'Bd' }),
    );
    const crossed = run(engine, extrusion('padB', 'pads', ['Ba', 'Bb', 'Bc', 'Bd'], '3'));
    expect(crossed.evaluation.features['padA'].error?.code).toBe('invalidProfile');
    const split = cut(engine, 'split', 'pads', {}, 's_');
    const state = engine.getState();
    expect(split.changed).toEqual(['Ab', 'Ac', 'Ba', 'Bd']);
    expect(split.points).toHaveLength(2);
    expect(split.patched).toEqual(['padA', 'padB']);
    expect(regionsOf(state, 'padA')).toHaveLength(2);
    expect(regionsOf(state, 'padB')).toHaveLength(2);
    expect(state.evaluation.bodies['padA'].volume).toBeCloseTo(6000, 6);
    expect(state.evaluation.bodies['padB'].volume).toBeCloseTo(3600, 6);
    expect(resultOf(state, 'pads').degreesOfFreedom).toBe(0);
    engine.undo();
    expect(regionsOf(engine.getState(), 'padA')[0]).toEqual(['Aa', 'Ab', 'Ac', 'Ad']);
    engine.redo();
    for (const [i, at] of ([[40, 20], [30, 30], [30, 10], [20, 20]] as [number, number][]).entries()) {
      cut(engine, 'trim', 'pads', { at }, `u${i}_`);
      expect(resultOf(engine.getState(), 'pads').degreesOfFreedom).toBe(0);
    }
    const union = engine.getState();
    expect(regionsOf(union, 'padA')).toHaveLength(1);
    expect(regionsOf(union, 'padA')[0]).toEqual(regionsOf(union, 'padB')[0]);
    expect(union.evaluation.bodies['padA'].volume).toBeCloseTo(2000 * 5, 6);
    expect(union.evaluation.bodies['padB'].volume).toBeCloseTo(2000 * 3, 6);
  });

  it('a construction line extended to the top edge keeps its length dimension; the edge is not cut', () => {
    const engine = newEngine();
    baseWithNotch(engine);
    run(engine, ...pointAt('baseSketch', 'ea', '10', '10'), { type: 'addPoint', sketch: 'baseSketch', id: 'eb', x: 10, y: 20 }, { type: 'addCurve', sketch: 'baseSketch', id: 'rib', curve: { type: 'line', a: 'ea', b: 'eb', construction: true } });
    run(engine, constrain('baseSketch', 'ribV', { type: 'vertical', line: 'rib' }), constrain('baseSketch', 'ribL', { type: 'distance', a: 'ea', b: 'eb', value: 10, driving: true }));
    const ids = cut(engine, 'extend', 'baseSketch', { curve: 'rib', end: 'b' }, 'e_');
    const state = engine.getState();
    const end = (sketchOf(state, 'baseSketch').curves['rib'] as { b: Id }).b;
    expect(ids.changed).toEqual(['rib']);
    expect(ids.patched).toEqual([]);
    expect(ids.constraints).toHaveLength(2);
    expect(resultOf(state, 'baseSketch').points[end].y).toBeCloseTo(54, 6);
    expect(resultOf(state, 'baseSketch').points['eb'].y).toBeCloseTo(20, 6);
    // a second extension of the same end is refused: it lies on the top edge now
    expect(cutRefusal(engine, 'extend', 'baseSketch', { curve: 'rib', end: 'b' })).toBeDefined();
    expect(cutRefusal(engine, 'split', 'baseSketch', { curve: 'bb', with: 'rib' })).toMatch(/no contact with "rib"/);
  });

  it('a sketch of wall centre lines, which no feature reads regions of: a trim cuts its own line alone, the walls keep their curves and faces', () => {
    const engine = newEngine();
    const fixed = (id: Id, x: number, y: number): Command[] => [
      { type: 'addPoint', sketch: 'ribs', id, x, y },
      constrain('ribs', `${id}f`, { type: 'fixed', point: id, x, y } as never),
    ];
    const line = (id: Id, a: Id, b: Id): Command => ({ type: 'addCurve', sketch: 'ribs', id, curve: { type: 'line', a, b } });
    const wall = (id: Id, curve: Id): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 'ribs', curves: [curve], thickness: 2 }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } });
    run(engine, { type: 'addFeature', feature: emptySketch('ribs', 'ribs', XY) });
    run(
      engine,
      ...fixed('a1', 0, 0),
      ...fixed('a2', 60, 0),
      line('wa', 'a1', 'a2'),
      ...fixed('b1', 20, 30),
      { type: 'addPoint', sketch: 'ribs', id: 'b2', x: 20, y: 0 },
      line('wb', 'b1', 'b2'),
      constrain('ribs', 'bv', { type: 'vertical', line: 'wb' }),
      constrain('ribs', 'bt', { type: 'pointOnCurve', point: 'b2', curve: 'wa' }),
      ...fixed('c1', 40, 30),
      { type: 'addPoint', sketch: 'ribs', id: 'c2', x: 40, y: 0 },
      line('wc', 'c1', 'c2'),
      constrain('ribs', 'cv', { type: 'vertical', line: 'wc' }),
      constrain('ribs', 'ct', { type: 'pointOnCurve', point: 'c2', curve: 'wa' }),
      ...fixed('d1', 20, 20),
      ...fixed('d2', 50, 20),
      line('wd', 'd1', 'd2'),
    );
    run(engine, wall('wallA', 'wa'), wall('wallB', 'wb'), wall('wallC', 'wc'), wall('wallD', 'wd'));
    expect(repairsByDefault(engine.getState().document, 'ribs')).toBe(false);
    const sides = (state: EngineState): string[] => state.evaluation.faceNames.filter((n) => n.feature === 'wallA' && n.role === 'wallSide').map((n) => JSON.stringify(n));
    const sidesBefore = sides(engine.getState());
    const ids = cut(engine, 'trim', 'ribs', { at: [45, 20] }, 'w_');
    const state = engine.getState();
    expect(ids.changed).toEqual(['wd']);
    expect(ids.added).toEqual([]);
    expect(ids.constraints).toHaveLength(2);
    expect(ids.patched).toEqual([]);
    expect(ids.shortened).toEqual(['wallD']);
    expect(sides(state)).toEqual(sidesBefore);
    expect(sides(state)).toHaveLength(2);
    expect(state.evaluation.bodies['wallD'].volume).toBeCloseTo(400, 6);
    expect(resultOf(state, 'ribs')).toMatchObject({ degreesOfFreedom: 0, redundant: [] });
    expect(allOk(state)).toBe(true);
    // the same trim asked to repair cuts the other lines too
    engine.undo();
    const again = engine.getState();
    const repaired = sketchTool('trim', toolContext(again, 'ribs'), { at: [45, 20], repair: 'on' }, freshIds(again.document, 'r_'));
    expect(repaired.ok && (repaired.ids as CutIds).changed).toHaveLength(4);
  });

  it('a line that only touches a circle cannot be trimmed on one side of the touch; the query lists the touch as something no split cuts', () => {
    const engine = newEngine();
    const fixed = (id: Id, x: number, y: number): Command[] => [
      { type: 'addPoint', sketch: 'tan', id, x, y },
      constrain('tan', `${id}f`, { type: 'fixed', point: id, x, y } as never),
    ];
    run(engine, { type: 'addFeature', feature: emptySketch('tan', 'tan', XY) });
    run(
      engine,
      ...fixed('t1', -10, 0),
      ...fixed('t2', 10, 0),
      { type: 'addCurve', sketch: 'tan', id: 'tl', curve: { type: 'line', a: 't1', b: 't2' } },
      ...fixed('tc', 0, 5),
      { type: 'addCurve', sketch: 'tan', id: 'tk', curve: { type: 'circle', center: 'tc' }, radius: 5 },
      constrain('tan', 'tr', { type: 'radius', curve: 'tk', value: 5, driving: true }),
    );
    const found = contactsOf(engine, 'tan');
    expect(found.total).toBe(1);
    expect(found.contacts[0]).toMatchObject({ kind: 'touch', fix: 'none', curves: ['tk', 'tl'] });
    expect(found.reason).toMatch(/one point/);
    for (const repair of ['on', 'off'] as const) {
      const reason = cutRefusal(engine, 'trim', 'tan', { at: [5, 0], repair });
      expect(reason, repair).toContain('"tk"');
      expect(reason, repair).toMatch(/only touches/);
    }
  });
});

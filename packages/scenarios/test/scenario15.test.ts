// Validation scenario 15 (a cover for a controller board, docs/requirements.md). The parts of the
// points of step 6 of D36 each have a `describe` of their own; the board of step 1 is a stand-in
// until 6f imports one, and 6c and 6b build on it.
import { describe, expect, it } from 'vitest';
import { type Command, type CutIds, type Engine, type EngineState, type Expr, type Id, type SketchFeature, type SketchResult, type SketchToolInputs, AXIS_CURVES, AXIS_REACH, DUPLICATE, REGIONS_ON_A_POINT, UNDER_ORIGIN, emptySketch, faceKey, freshIds, lineExtent, profileOf, repairsByDefault, sketchTool, sketchWorld, solvedCurves, toolBase } from '@trymesh/engine';
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
const toolContext = (state: EngineState, sketch: Id) => ({ sketch: sketchOf(state, sketch), result: resultOf(state, sketch), parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features });
function cut<K extends CutTool>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix: string): CutIds {
  const state = engine.getState();
  const made = sketchTool(name, toolContext(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) throw new Error(made.message);
  const after = run(engine, batch(...made.commands));
  // the world a tool builds gives the profile of the step, after every batch of a tool here
  const world = sketchWorld(toolBase(sketchOf(after, sketch), resultOf(after, sketch)));
  const profile = profileOf([...world.curves.values()], world.joins, world.geometry, after.document.settings.chordTolerance);
  expect(profile.valid).toBe(resultOf(after, sketch).valid);
  expect(profile.regions.map((r) => r.ref)).toEqual(resultOf(after, sketch).regions.map((region) => region.ref));
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

// ================================================================ 6c (D68): the lid and the vents

// docs/d36/6c-sketch-mirror-pattern/calls.ts, on the stand-ins: the lid half mirrored about the Y
// axis of the origin, the vents as linear patterns with the count `vents`, the second notch
// trimmed into the source half on four paths, the fillet of a source corner, a split by a rib, an
// own curve across a copy, an end that stays open, and the refusals.
const [LW, LH, LR, LT] = [84, 54, 5, 2];
const SLOT = 3 * 9 + Math.PI * 1.5 * 1.5;
const LID = LW * LH - (4 - Math.PI) * LR * LR;
// the arcs are polygons within the chord tolerance (0.01 mm): the outline's polygon is 0.19 mm²
// below the area by hand, a slot's 0.06 mm²
const lidAllowance = (holes: number): number => (0.2 + 0.06 * holes) * LT;
const LID_REGION = ['c1', 'c2', 'c3', 'm/1/c1', 'm/1/c2', 'm/1/c3', 'm/1/r1', 'm/1/r2', 'r1', 'r2'];
const pt = (sketch: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
const ln = (sketch: Id, id: Id, a: Id, b: Id): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b } });
const ac = (sketch: Id, id: Id, center: Id, start: Id, end: Id): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'arc', center, start, end } });
const addPattern = (sketch: Id, id: Id, ref: object): Command => ({ type: 'addExternal', sketch, id, ref } as Command);
const loopsOf = (state: EngineState, sketch: Id): Id[][] => resultOf(state, sketch).regions.map((region) => region.ref.outerLoop);
const extrudeLoops = (id: Id, sketch: Id, regions: Id[][], distance: Expr, operation: 'new' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: regions.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) }, extent: { type: 'distance', start: 0, distance }, operation, ...(targets ? { targets } : {}) },
});
const patternOf = (state: EngineState, sketch: Id, entry: Id) => sketchOf(state, sketch).external[entry] as { sources: Id[] };

function mirroredLid(engine: Engine): EngineState {
  run(engine, ...(['W', 'H', 'R', 'T'] as const).map((name, i): Command => ({ type: 'setParameter', name, expr: `${[LW, LH, LR, LT][i]}` })), { type: 'setParameter', name: 'vents', expr: '5' }, { type: 'setParameter', name: 'ventPitch', expr: '6' });
  const s = 'lidSketch';
  run(engine, { type: 'addFeature', feature: emptySketch(s, 'Lid', XY) });
  run(engine, pt(s, 'a1', 37.3, 0.2), pt(s, 'q1', 36.8, 5.1), pt(s, 'a2', 42.2, 4.7), pt(s, 'a3', 41.9, 49.4), pt(s, 'q2', 37.3, 48.8), pt(s, 'a4', 36.8, 54.3), pt(s, 'a5', 0.7, 53.8));
  run(engine, ln(s, 'c1', 'origin', 'a1'), ac(s, 'r1', 'q1', 'a1', 'a2'), ln(s, 'c2', 'a2', 'a3'), ac(s, 'r2', 'q2', 'a3', 'a4'), ln(s, 'c3', 'a4', 'a5'));
  run(
    engine,
    constrain(s, 'k1', { type: 'horizontal', line: 'c1' }),
    constrain(s, 'k2', { type: 'vertical', line: 'c2' }),
    constrain(s, 'k3', { type: 'horizontal', line: 'c3' }),
    constrain(s, 'k4', { type: 'tangent', a: 'c1', b: 'r1' }),
    constrain(s, 'k5', { type: 'tangent', a: 'r1', b: 'c2' }),
    constrain(s, 'k6', { type: 'tangent', a: 'c2', b: 'r2' }),
    constrain(s, 'k7', { type: 'tangent', a: 'r2', b: 'c3' }),
    constrain(s, 'k8', { type: 'radius', curve: 'r1', value: 'R', driving: true } as never),
    constrain(s, 'k9', { type: 'equalRadius', a: 'r1', b: 'r2' }),
    dim(s, 'k10', 'horizontalDistance', 'origin', 'a2', 'W / 2'),
    dim(s, 'k11', 'verticalDistance', 'origin', 'a4', 'H'),
    constrain(s, 'k12', { type: 'pointOnCurve', point: 'a5', curve: 'origin/y' }),
  );
  return run(engine, addPattern(s, 'm', { type: 'pattern', sources: ['c1', 'r1', 'c2', 'r2', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } }));
}
// a slot (12 × 3, the centres 9 apart) at (x, y) in a sketch: arcs `${p}g1`, `${p}g2`, lines `${p}e1`, `${p}e2`
function slot(sketch: Id, p: string, x: number, y: number): Command[] {
  return [
    pt(sketch, `${p}o1`, x, y - 4.5),
    pt(sketch, `${p}o2`, x, y + 4.5),
    pt(sketch, `${p}s1`, x - 1.5, y - 4.5),
    pt(sketch, `${p}s2`, x + 1.5, y - 4.5),
    pt(sketch, `${p}s3`, x + 1.5, y + 4.5),
    pt(sketch, `${p}s4`, x - 1.5, y + 4.5),
    ac(sketch, `${p}g1`, `${p}o1`, `${p}s1`, `${p}s2`),
    ln(sketch, `${p}e1`, `${p}s2`, `${p}s3`),
    ac(sketch, `${p}g2`, `${p}o2`, `${p}s3`, `${p}s4`),
    ln(sketch, `${p}e2`, `${p}s4`, `${p}s1`),
  ];
}
const copyRegion = (copy: number): Id[] => ['wg1', 'we1', 'wg2', 'we2'].map((curve) => `vb/${copy}/${curve}`);

describe('scenario 15, steps 4, 5 and 7: the lid mirrored, the vents as patterns (6c, D68)', () => {
  it('the half closes with its image into one region; the lid, the side of a copy, the width moving the copy', () => {
    const engine = newEngine();
    const state = mirroredLid(engine);
    const result = resultOf(state, 'lidSketch');
    expect(result.valid).toBe(true);
    expect(loopsOf(state, 'lidSketch')).toEqual([LID_REGION]);
    expect(result.curves['m/1/r1']).toEqual({ shape: { type: 'arc', center: 'm/1/q1', start: 'm/1/a2', end: 'm/1/a1' }, source: 'derived', regions: true });
    expect(result.points['m/1/a2'].x).toBeCloseTo(-LW / 2, 9);
    expect(result.degreesOfFreedom).toBe(0);
    expect(result.openEnds).toBeUndefined();
    const lid = run(engine, extrudeLoops('lid', 'lidSketch', [LID_REGION], 'T'));
    expect(Math.abs(lid.evaluation.bodies.lid.volume - LID * LT)).toBeLessThan(lidAllowance(0));
    expect(lid.evaluation.faceNames.some((name) => name.role === 'side' && name.feature === 'lid' && name.curve === 'm/1/c2')).toBe(true);
    const wider = previewOf(engine, { type: 'setParameter', name: 'W', expr: '90' });
    expect(resultOf(wider, 'lidSketch').points['m/1/a2'].x).toBeCloseTo(-45, 6);
    expect(Math.abs(wider.evaluation.bodies.lid.volume - (90 * LH - (4 - Math.PI) * LR * LR) * LT)).toBeLessThan(lidAllowance(0));
  });

  it('the vents: a row in the lid sketch as holes of its region, a row in a sketch of its own cut by copies 1 and 3; 7, 3 and 5 vents', () => {
    const engine = newEngine();
    mirroredLid(engine);
    run(engine, extrudeLoops('lid', 'lidSketch', [LID_REGION], 'T'));
    run(engine, ...slot('lidSketch', 'v', -12, 14));
    const rowA = run(engine, addPattern('lidSketch', 'va', { type: 'pattern', sources: ['vg1', 've1', 'vg2', 've2'], transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } } }));
    expect(loopsOf(rowA, 'lidSketch')).toHaveLength(6);
    expect(loopsOf(rowA, 'lidSketch')).toContainEqual(['va/4/ve1', 'va/4/ve2', 'va/4/vg1', 'va/4/vg2']);
    expect(Math.abs(rowA.evaluation.bodies.lid.volume - (LID - 5 * SLOT) * LT)).toBeLessThan(lidAllowance(5));
    expect(sketchOf(rowA, 'lidSketch').expressions?.['external/va/transform/count']).toBe('vents');
    run(engine, { type: 'addFeature', feature: emptySketch('ventSketch', 'Vents', XY) }, ...slot('ventSketch', 'w', -12, 40));
    run(engine, addPattern('ventSketch', 'vb', { type: 'pattern', sources: ['wg1', 'we1', 'wg2', 'we2'], transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } } }));
    const rowB = run(engine, extrudeLoops('ventCut', 'ventSketch', [copyRegion(1), copyRegion(3)], 'T', 'cut', ['lid']));
    expect(rowB.evaluation.features.ventCut.status).toBe('ok');
    expect(Math.abs(rowB.evaluation.bodies.lid.volume - (LID - 7 * SLOT) * LT)).toBeLessThan(lidAllowance(7));
    // 7: two more holes, no feature patched, the stamp kept
    const stamp = sketchOf(rowB, 'lidSketch').solved.inputs;
    const cut = rowB.document.features.find((f) => f.id === 'ventCut');
    const seven = set(engine, 'vents', '7');
    expect(sketchOf(seven, 'lidSketch').solved.inputs).toBe(stamp);
    expect(loopsOf(seven, 'lidSketch')).toHaveLength(8);
    expect(Math.abs(seven.evaluation.bodies.lid.volume - (LID - 9 * SLOT) * LT)).toBeLessThan(lidAllowance(9));
    expect(seven.document.features.find((f) => f.id === 'ventCut')).toEqual(cut);
    expect(seven.evaluation.features.ventCut.status).toBe('ok');
    // 3: the cut is noProfile naming the region of copy 3; 5 brings it back
    const three = previewOf(engine, { type: 'setParameter', name: 'vents', expr: '3' });
    expect(three.evaluation.features.ventCut.error).toMatchObject({ code: 'noProfile', refs: [{ outerLoop: [...copyRegion(3)].sort() }] });
    expect(set(engine, 'vents', '5').evaluation.features.ventCut.status).toBe('ok');
    // the count as a field of the sketch: setField, renameParameter
    const field = run(engine, { type: 'setField', feature: 'lidSketch', path: 'external/va/transform/count', value: 'vents + 1' });
    expect(loopsOf(field, 'lidSketch')).toHaveLength(7);
    const renamed = run(engine, { type: 'renameParameter', name: 'vents', to: 'ventCount' });
    expect(sketchOf(renamed, 'lidSketch').expressions?.['external/va/transform/count']).toBe('ventCount + 1');
    // the count as a number in the field: 9 slots across the lid
    const many = previewOf(engine, { type: 'setField', feature: 'lidSketch', path: 'external/va/transform/count', value: 9 });
    expect(many.evaluation.features.lidSketch.status).toBe('ok');
    expect(loopsOf(many, 'lidSketch')).toHaveLength(10);
  });

  it('200 slots recomputed: a grid of 14 × 14 slots in a plate, 784 curves of copies, end to end within a bound', () => {
    const engine = newEngine();
    const s = 'plate';
    run(engine, { type: 'addFeature', feature: emptySketch(s, 'Plate', XY) }, pt(s, 'b1', -10, -10), pt(s, 'b2', 150, -10), pt(s, 'b3', 150, 250), pt(s, 'b4', -10, 250), ln(s, 'ba', 'b1', 'b2'), ln(s, 'bb', 'b2', 'b3'), ln(s, 'bc', 'b3', 'b4'), ln(s, 'bd', 'b4', 'b1'));
    run(engine, ...slot(s, 'v', 0, 0), extrudeLoops('P', s, [['ba', 'bb', 'bc', 'bd']], '2'), { type: 'setParameter', name: 'n', expr: '2' });
    run(engine, addPattern(s, 'g', { type: 'pattern', sources: ['vg1', 've1', 'vg2', 've2'], transform: { type: 'linear', direction: 'origin/x', count: 'n', span: { type: 'spacing', spacing: 10 }, second: { direction: 'origin/y', count: 'n', span: { type: 'spacing', spacing: 17 } } } }));
    const start = performance.now();
    const grid = set(engine, 'n', '14');
    const elapsed = performance.now() - start;
    expect(Object.keys(resultOf(grid, s).curves).filter((id) => id.startsWith('g/'))).toHaveLength(14 * 14 * 4 - 4);
    expect(loopsOf(grid, s)).toHaveLength(1 + 14 * 14);
    expect(allOk(grid)).toBe(true);
    expect(Math.abs(volumeOf(grid, 'P') - (160 * 260 - 14 * 14 * SLOT) * 2)).toBeLessThan(0.06 * 14 * 14 * 2);
    // measured about 0.2 s (the solver's time is the same with one slot); the bound leaves room for
    // a loaded machine
    expect(elapsed).toBeLessThan(10_000);
  });
});

const volumeOf = (state: EngineState, body: Id): number => state.evaluation.bodies[body]?.volume ?? Number.NaN;
// a tool on the sketch: its answer, the batch run
function tool<K extends 'fillet' | CutTool>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix: string): Record<string, Id[]> {
  const state = engine.getState();
  const made = sketchTool(name, toolContext(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) throw new Error(made.message);
  run(engine, ...made.commands);
  return made.ids;
}
const toolRefusal = <K extends 'fillet' | 'rectangle' | CutTool>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K]): string | undefined => {
  const state = engine.getState();
  const made = sketchTool(name, toolContext(state, sketch), input, freshIds(state.document, 'x_'));
  return made.ok ? undefined : made.message;
};

describe('scenario 15, step 6 on the mirrored lid: the sketch tools and the copies (6c, D68)', () => {
  // the second notch: a circle of radius 4 at x = 20 on the top line c3, two trims by a place each;
  // on the four paths the entry ends with the two pieces of c3 and the arc inside (design.md, Q1)
  const NOTCH_R = 4;
  for (const [lineFirst, underTheLid] of [
    [true, true],
    [false, true],
    [true, false],
    [false, false],
  ] as const) {
    it(`the second notch, ${lineFirst ? 'the line' : 'the circle'} trimmed first, ${underTheLid ? 'under the lid (repair on)' : 'before the lid (repair off)'}`, () => {
      const engine = newEngine();
      mirroredLid(engine);
      if (underTheLid) run(engine, extrudeLoops('lid', 'lidSketch', [LID_REGION], 'T'));
      run(engine, pt('lidSketch', 'nc', 20, LH), { type: 'addCurve', sketch: 'lidSketch', id: 'nk', curve: { type: 'circle', center: 'nc' }, radius: NOTCH_R });
      const [inLine, outside]: [number, number][] = [
        [20, LH],
        [20, LH + NOTCH_R],
      ];
      const first = tool(engine, 'trim', 'lidSketch', { at: lineFirst ? inLine : outside }, 'n1_');
      const second = tool(engine, 'trim', 'lidSketch', { at: lineFirst ? outside : inLine }, 'n2_');
      let state = engine.getState();
      const sketch = sketchOf(state, 'lidSketch');
      const entry = patternOf(state, 'lidSketch', 'm');
      expect(first.entries).toEqual(!lineFirst && !underTheLid ? [] : ['m']);
      expect(second.entries).toEqual(['m']);
      const arcs = entry.sources.filter((id) => sketch.curves[id]?.type === 'arc' && id !== 'r1' && id !== 'r2');
      expect(arcs).toHaveLength(1);
      if (!(lineFirst && underTheLid)) expect(arcs[0]).toBe('nk');
      expect(entry.sources).toContain('c3');
      expect(entry.sources).toHaveLength(7);
      const loops = loopsOf(state, 'lidSketch');
      expect(loops).toHaveLength(1);
      const lidLoop = loops[0];
      expect(lidLoop).toContain(arcs[0]);
      expect(lidLoop).toContain(`m/1/${arcs[0]}`);
      expect(resultOf(state, 'lidSketch').openEnds).toBeUndefined();
      if (!underTheLid) state = run(engine, extrudeLoops('lid', 'lidSketch', [lidLoop], 'T'));
      expect(state.evaluation.features.lid.status).toBe('ok');
      expect(Math.abs(volumeOf(state, 'lid') - (LID - Math.PI * NOTCH_R * NOTCH_R) * LT)).toBeLessThan(lidAllowance(2));
    });
  }

  it('the fillet of a source corner: the arc joins the entry, its copy every stored region of copies, also one the count does not make', () => {
    const engine = newEngine();
    const s = 'tri';
    const TRIANGLE = ['ul1', 'ul2', 'ul3'];
    const copyOf = (copy: number | string): Id[] => TRIANGLE.map((curve) => `tr/${copy}/${curve}`);
    run(engine, { type: 'setParameter', name: 'copies', expr: '2' }, { type: 'addFeature', feature: emptySketch(s, 'Triangles', XY) });
    run(engine, pt(s, 'u1', 0, 100), pt(s, 'u2', 30, 100), pt(s, 'u3', 0, 120), ln(s, 'ul1', 'u1', 'u2'), ln(s, 'ul2', 'u2', 'u3'), ln(s, 'ul3', 'u3', 'u1'));
    run(engine, addPattern(s, 'tr', { type: 'pattern', sources: TRIANGLE, transform: { type: 'linear', direction: 'ul1', count: 'copies', span: { type: 'spacing', spacing: 40 } } }));
    const before = run(engine, extrudeLoops('triangles', s, [TRIANGLE, copyOf(1)], '3'), extrudeLoops('third', s, [copyOf(2)], '3'));
    expect(before.evaluation.features.third.error?.code).toBe('noProfile');
    const ids = tool(engine, 'fillet', s, { corner: 'u2', radius: 3 }, 'f_');
    const after = engine.getState();
    const arc = ids.arc[0];
    expect(ids.entries).toEqual(['tr']);
    expect(patternOf(after, s, 'tr').sources).toEqual([...TRIANGLE, arc]);
    expect(sketchOf(after, s).expressions?.['external/tr/transform/count']).toBe('copies');
    expect(ids.patched).toEqual(['triangles', 'third']);
    const loops = (feature: Id): Id[][] => {
      const f = after.document.features.find((g) => g.id === feature);
      return f?.type === 'extrude' && f.profile.type === 'regions' ? f.profile.regions.map((r) => r.outerLoop) : [];
    };
    expect(loops('triangles')).toEqual([[...TRIANGLE, arc].sort(), [...copyOf(1), `tr/1/${arc}`].sort()]);
    expect(loops('third')).toEqual([[...copyOf(2), `tr/2/${arc}`].sort()]);
    expect(after.evaluation.features.triangles.status).toBe('ok');
    const three = set(engine, 'copies', '3');
    expect(three.evaluation.features.third.status).toBe('ok');
  });

  it('a split by a rib the mirror does not list: the pieces of c1 and c3 in their place, nothing of the rib; the lid follows', () => {
    const engine = newEngine();
    mirroredLid(engine);
    const lid = run(engine, extrudeLoops('lid', 'lidSketch', [LID_REGION], 'T'));
    const volume = volumeOf(lid, 'lid');
    run(engine, pt('lidSketch', 'rb0', 30, -3), pt('lidSketch', 'rb1', 30, LH + 3), ln('lidSketch', 'rib', 'rb0', 'rb1'));
    const ids = tool(engine, 'split', 'lidSketch', {}, 'r_');
    const after = engine.getState();
    const entry = patternOf(after, 'lidSketch', 'm');
    expect(ids.entries).toEqual(['m']);
    expect(Object.keys(ids).indexOf('entries')).toBe(15);
    const ofRib = ['rib', ...ids.added.filter((id) => {
      const curve = sketchOf(after, 'lidSketch').curves[id];
      const points = resultOf(after, 'lidSketch').points;
      return curve?.type === 'line' && Math.abs(points[curve.a].x - 30) < 1e-9 && Math.abs(points[curve.b].x - 30) < 1e-9;
    })];
    expect(ofRib).toHaveLength(3);
    expect(ofRib.filter((id) => entry.sources.includes(id))).toEqual([]);
    expect(entry.sources).toHaveLength(7);
    expect(loopsOf(after, 'lidSketch')).toHaveLength(2);
    expect(after.evaluation.features.lid.status).toBe('ok');
    expect(volumeOf(after, 'lid')).toBeCloseTo(volume, 6);
  });

  it('the same split under a chamfer of the rim: the edges of the copies of the cut curves are rewritten to the copies of the pieces', () => {
    const engine = newEngine();
    mirroredLid(engine);
    run(engine, extrudeLoops('lid', 'lidSketch', [LID_REGION], 'T'));
    const top = { feature: 'lid', role: 'endCap' } as const;
    run(engine, { type: 'addFeature', feature: { id: 'rim', name: 'Rim', suppressed: false, type: 'chamfer', body: 'lid', edges: LID_REGION.map((curve) => ({ a: top, b: { feature: 'lid', role: 'side', curve } })), distance: 0.5 } } as Command);
    expect(engine.getState().evaluation.features.rim.status).toBe('ok');
    run(engine, pt('lidSketch', 'rb0', 30, -3), pt('lidSketch', 'rb1', 30, LH + 3), ln('lidSketch', 'rib', 'rb0', 'rb1'));
    tool(engine, 'split', 'lidSketch', {}, 'r_');
    const state = engine.getState();
    const rim = state.document.features.find((f) => f.id === 'rim');
    const sides = rim?.type === 'chamfer' ? rim.edges.map((edge) => (edge.b.role === 'side' ? edge.b.curve : '')) : [];
    const pieces = patternOf(state, 'lidSketch', 'm').sources.filter((id) => !['c1', 'r1', 'c2', 'r2', 'c3'].includes(id));
    expect(pieces).toHaveLength(2);
    expect(sides.slice(0, 10)).toEqual(LID_REGION);
    expect([...sides.slice(10)].sort()).toEqual([...pieces, ...pieces.map((id) => `m/1/${id}`)].sort());
    expect(state.evaluation.features.rim.status).toBe('ok');
  });

  it('an own curve across a copy: listed with fix none and the reason of the copy; split refuses; an extension onto the copy is refused', () => {
    const engine = newEngine();
    mirroredLid(engine);
    run(engine, extrudeLoops('lid', 'lidSketch', [LID_REGION], 'T'));
    run(engine, pt('lidSketch', 'xa', -30, 27), pt('lidSketch', 'xb', -35, 27), ln('lidSketch', 'across', 'xa', 'xb'));
    expect(toolRefusal(engine, 'extend', 'lidSketch', { curve: 'across', end: 'b' })).toBeDefined();
    const state = run(engine, { type: 'dragPoint', sketch: 'lidSketch', point: 'xb', x: -50, y: 27 });
    const found = contactsOf(engine, 'lidSketch');
    expect(found.valid).toBe(false);
    expect(found.total).toBe(1);
    expect(found.contacts.map((c) => [c.kind, c.curves, c.fix, c.why])).toEqual([['crossing', ['across', 'm/1/c2'], 'none', 'it is a copy of the mirror or pattern "m" ("m/1/c2"), which is never cut: move the curve or change the source of the copy']]);
    expect(toolRefusal(engine, 'split', 'lidSketch', {})).toContain('never cut');
    expect(state.evaluation.features.lid.error?.code).toBe('invalidProfile');
  });

  it('a copy named to a tool, a place on a copy, a snap to a copied point: refused with the source to change', () => {
    const engine = newEngine();
    mirroredLid(engine);
    const inTool = '"m/1/c2" is a copy of the mirror or pattern "m"; change its source "c2", and the copies follow';
    expect(toolRefusal(engine, 'trim', 'lidSketch', { curve: 'm/1/c2', at: [-42, 27] })).toBe(`curve: ${inTool}`);
    expect(toolRefusal(engine, 'trim', 'lidSketch', { at: [-42, 27] })).toContain(inTool);
    expect(toolRefusal(engine, 'extend', 'lidSketch', { curve: 'c1', end: 'a', with: 'm/1/c2' })).toContain(inTool);
    expect(toolRefusal(engine, 'rectangle', 'lidSketch', { first: { at: [-42, 5], snap: { kind: 'point', id: 'm/1/a2' } }, opposite: { at: [-30, 12] } })).toBe(
      'first: "m/1/a2" is a copy of the mirror or pattern "m": a new point cannot be tied to a copy; snap to its source "a2", or place the point by its coordinates',
    );
    expect(toolRefusal(engine, 'fillet', 'lidSketch', { corner: 'm/1/a5', radius: 1 })).toBe('corner: "m/1/a5" is a copy of the mirror or pattern "m"; change its source "a5", and the copies follow');
  });
});

describe('scenario 15 with the mirrored lid: what is refused, a source removed by hand, a grid of vents (6c, D68)', () => {
  // a stand under the lid, before its sketch: a body an edge projection may name
  function withStand(engine: Engine): void {
    run(engine, { type: 'addFeature', feature: emptySketch('standSketch', 'Stand', XY) }, pt('standSketch', 'b1', -10, -10), pt('standSketch', 'b2', 10, -10), pt('standSketch', 'b3', 0, -20), ln('standSketch', 'bl1', 'b1', 'b2'), ln('standSketch', 'bl2', 'b2', 'b3'), ln('standSketch', 'bl3', 'b3', 'b1'));
    run(engine, extrudeLoops('stand', 'standSketch', [['bl1', 'bl2', 'bl3']], '1'));
  }

  it('a copy is no operand, no point of a curve, nothing to remove or drag, no source and no axis; the forms and the counts are checked; derived does not become reference', () => {
    const engine = newEngine();
    withStand(engine);
    mirroredLid(engine);
    const refused = (command: Command): string => {
      const outcome = engine.preview(command);
      return outcome.ok ? 'accepted' : outcome.error.message;
    };
    const lid = (id: Id, ref: object): Command => addPattern('lidSketch', id, ref);
    expect(refused(constrain('lidSketch', 'kx', { type: 'horizontal', line: 'm/1/c3' }))).toContain('"m/1/c3" is a copy of the mirror or pattern "m": a copy cannot be constrained in its own sketch');
    expect(refused(ln('lidSketch', 'lx', 'm/1/a1', 'a1'))).not.toBe('accepted');
    expect(refused({ type: 'removeEntity', sketch: 'lidSketch', id: 'm/1/c1' })).not.toBe('accepted');
    expect(refused({ type: 'dragPoint', sketch: 'lidSketch', point: 'm/1/a2', x: 0, y: 0 })).not.toBe('accepted');
    expect(refused(lid('p2', { type: 'pattern', sources: ['m/1/c2'], transform: { type: 'mirror', axis: 'c1' } }))).toContain('a mirror or pattern copies own curves and points of the sketch');
    expect(refused(lid('p3', { type: 'pattern', sources: ['c2'], transform: { type: 'mirror', axis: 'r1' } }))).toContain('the axis "r1" is an own arc');
    expect(refused(lid('p4', { type: 'pattern', sources: ['nothing'], transform: { type: 'mirror', axis: 'origin/y' } }))).not.toBe('accepted');
    expect(refused(lid('p5', { type: 'pattern', sources: ['c2'], transform: { type: 'linear', direction: 'm/1/c1', count: 3, span: { type: 'spacing', spacing: 5 } } }))).not.toBe('accepted');
    expect(refused(lid('p6', { type: 'pattern', sources: ['c2'], transform: { type: 'circular', center: 'origin', count: 201, span: { type: 'full' } } }))).not.toBe('accepted');
    expect(refused(lid('p7', { type: 'pattern', sources: ['c2', 'c2'], transform: { type: 'mirror', axis: 'origin/y' } }))).not.toBe('accepted');
    expect(refused(lid('p8', { type: 'pattern', sources: ['origin/y'], transform: { type: 'mirror', axis: 'c1' } }))).not.toBe('accepted');
    expect(refused(lid('p9', { type: 'pattern', sources: ['c2'], transform: { type: 'mirror', plane: 'origin/y' } }))).toContain('a mirror in a sketch is about a line: `axis`, not `plane`');
    expect(refused({ type: 'updateExternal', sketch: 'lidSketch', id: 'm', ref: { type: 'edge', body: 'stand', edge: { a: { feature: 'stand', role: 'endCap' }, b: { feature: 'stand', role: 'side', curve: 'bl1' } }, kind: 'line' } } as Command)).toBe(
      'updateExternal: an entry of reference geometry cannot become derived geometry, or the other way; remove it and add the other',
    );
    // the place of the copy keyed with its slashed ID quoted
    const state = run(engine, extrudeLoops('lid', 'lidSketch', [LID_REGION], 'T'));
    expect(faceKey({ feature: 'lid', role: 'side', curve: 'm/1/c2' })).toBe('lid/side/"m/1/c2"');
    expect(state.evaluation.faceNames.some((name) => name.role === 'side' && name.feature === 'lid' && name.curve === 'm/1/c2')).toBe(true);
  });

  it('a source removed by hand: the entry stays, the rest is copied, the sketch warns which source is gone', () => {
    const engine = newEngine();
    mirroredLid(engine);
    const state = previewOf(engine, { type: 'removeEntity', sketch: 'lidSketch', id: 'c2' });
    const warning = state.evaluation.features.lidSketch.warnings.find((w) => w.code === 'brokenCopies');
    expect(warning?.refs).toEqual(['m', 'c2']);
    expect(resultOf(state, 'lidSketch').curves['m/1/c3']).toBeDefined();
    expect(resultOf(state, 'lidSketch').curves['m/1/c2']).toBeUndefined();
  });

  it('square vents in a grid of 14 × 14: copy i, j is i + 1000 · j; 14 × 15 places are too many', () => {
    const engine = newEngine();
    const s = 'ventSketch';
    run(engine, { type: 'addFeature', feature: emptySketch(s, 'Vents', XY) }, pt(s, 'q1', -20, -10), pt(s, 'q2', -18, -10), pt(s, 'q3', -18, -8), pt(s, 'q4', -20, -8), ln(s, 'sq1', 'q1', 'q2'), ln(s, 'sq2', 'q2', 'q3'), ln(s, 'sq3', 'q3', 'q4'), ln(s, 'sq4', 'q4', 'q1'));
    const grid = run(engine, addPattern(s, 'g', { type: 'pattern', sources: ['sq1', 'sq2', 'sq3', 'sq4'], transform: { type: 'linear', direction: 'origin/x', count: 14, span: { type: 'spacing', spacing: 3 }, second: { direction: 'origin/y', count: 14, span: { type: 'spacing', spacing: -3 } } } }));
    expect(loopsOf(grid, s)).toHaveLength(196);
    expect(resultOf(grid, s).points['g/13013/q1']).toEqual({ x: expect.closeTo(-20 + 39, 9), y: expect.closeTo(-10 - 39, 9) });
    const large = previewOf(engine, { type: 'setField', feature: s, path: 'external/g/transform/second/count', value: 15 });
    expect(large.evaluation.features[s].warnings.find((w) => w.code === 'brokenCopies')?.message).toContain('14 × 15 is 210 places; a pattern has at most 200, the source included');
  });
});

// ================================================================ 6b (D69): projection from another sketch

// The board of step 1 (6a2's stand-in), the skeleton `frame` on a plane `standoffH` below it, the
// base in three features: the floor drawn by projectSketch as an own outline over the frame's
// outline, the rim projected with the flag, the standoffs around the projected hole circles.
// docs/d36/6b-sketch-projection/calls.ts.
const FRAME_OUTLINE = ['fa0', 'fl0', 'fa1', 'fl1', 'fa2', 'fl2', 'fa3', 'fl3'];
const RIM = ['ra0', 'ra1', 'ra2', 'ra3', 'rl0', 'rl1', 'rl2', 'rl3'];
const COVER: [string, string][] = [['standoffH', '5'], ['baseT', '2'], ['clearance', '0.5'], ['wall', '2'], ['rimH', '4'], ['standoffD', '6']];
// A rounded rectangle W × H with corners R moved outwards by o: its area.
const roundedArea = (W: number, H: number, R: number, o: number): number => (W + 2 * o) * (H + 2 * o) - (4 - Math.PI) * (R + o) * (R + o);
// The base by hand: the floor (offset 2.5, 2 thick), the rim (offset 2.5 less 0.5, 4 high), four rings
// (6 outside, 3.2 inside, 5 high); 7836.90 for W = 60.
const baseByHand = (W: number): number => roundedArea(W, 40, 3, 2.5) * 2 + (roundedArea(W, 40, 3, 2.5) - roundedArea(W, 40, 3, 0.5)) * 4 + ((4 * Math.PI * (6 * 6 - 3.2 * 3.2)) / 4) * 5;
const ALLOWANCE = 3; // mm³: the polygons of the arcs and circles
const fromSketch = (sketch: Id, id: Id, source: Id, entity: Id, kind: 'point' | 'line' | 'circle' | 'arc', regions?: boolean): Command =>
  ({ type: 'addExternal', sketch, id, ref: { type: 'sketch', sketch: source, entity, kind, ...(regions === undefined ? {} : { regions }) } }) as Command;
const planeAt = (id: Id, offset: Expr): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset } as never });
const extrudeOp = (id: Id, sketch: Id, regions: Id[][], distance: Expr, operation: 'new' | 'add' | 'cut', offset?: Expr, targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: regions.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })), ...(offset === undefined ? {} : { offset }) }, extent: { type: 'distance', start: 0, distance }, operation, ...(targets ? { targets } : {}) } as never,
});
function projectWith(engine: Engine, sketch: Id, input: SketchToolInputs['projectSketch'], prefix: string): Record<string, Id[]> {
  const state = engine.getState();
  const made = sketchTool('projectSketch', toolContext(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) throw new Error(made.message);
  run(engine, batch(...made.commands));
  return made.ids;
}
// How far the own curves are from the projections they were drawn over (`curves[i]` over `entries[i]`).
function offProjection(state: EngineState, s: Id, curves: Id[], entries: Id[]): number {
  const [f, r] = [sketchOf(state, s), resultOf(state, s)];
  const far = (own: Id, projected: Id): number => Math.hypot((r.points[own]?.x ?? NaN) - (r.points[projected]?.x ?? NaN), (r.points[own]?.y ?? NaN) - (r.points[projected]?.y ?? NaN));
  return Math.max(
    ...curves.map((own, i) => {
      const curve = f.curves[own];
      if (curve.type === 'arc') return Math.max(far(curve.center, `${entries[i]}/center`), far(curve.start, `${entries[i]}/start`), far(curve.end, `${entries[i]}/end`));
      return curve.type === 'line' ? Math.max(far(curve.a, `${entries[i]}/a`), far(curve.b, `${entries[i]}/b`)) : far(curve.center, `${entries[i]}/center`);
    }),
  );
}

// Steps 2 and 3. Answers the IDs of the floor's own curves and of the entries under them.
function skeletonAndBase(engine: Engine): { floor: Id[]; entries: Id[] } {
  standInBoard(engine);
  run(engine, ...COVER.map(([name, expr]): Command => ({ type: 'setParameter', name, expr })));
  // step 2: the skeleton, the outline and the holes without the flag, the hole pair measured from origin/y
  const f = 'frame';
  run(engine, planeAt('framePl', '-standoffH'), addSketch(f, { kind: 'plane', feature: 'framePl' }));
  run(engine, ...[0, 1, 2, 3].flatMap((i) => [fromSketch(f, `fa${i}`, 'board', `ba${i}`, 'arc'), fromSketch(f, `fl${i}`, 'board', `bl${i}`, 'line'), fromSketch(f, `fh${i}`, 'board', `bh${i}`, 'circle')]));
  run(engine, constrain(f, 'm1', { type: 'distancePointLine', point: 'fh0/center', line: 'origin/y', value: 1, driving: false } as never), constrain(f, 'm2', { type: 'distancePointLine', point: 'fh1/center', line: 'origin/y', value: 1, driving: false } as never));
  // step 3a: the floor, one call of the tool
  run(engine, planeAt('basePl', '-(standoffH + baseT)'), addSketch('baseSk', { kind: 'plane', feature: 'basePl' }));
  const ids = projectWith(engine, 'baseSk', { sketch: 'frame', entities: FRAME_OUTLINE, as: 'own' }, 'o');
  run(engine, extrudeOp('base', 'baseSk', [ids.curves], 'baseT', 'new', 'clearance + wall'));
  // 3b: the rim, the outline of the frame with the flag, added and pocketed
  run(engine, addSketch('rimSk', { kind: 'plane', feature: 'framePl' }), ...[0, 1, 2, 3].flatMap((i) => [fromSketch('rimSk', `ra${i}`, 'frame', `fa${i}`, 'arc', true), fromSketch('rimSk', `rl${i}`, 'frame', `fl${i}`, 'line', true)]));
  run(engine, extrudeOp('rim', 'rimSk', [RIM], 'rimH', 'add', 'clearance + wall', ['base']), extrudeOp('pocket', 'rimSk', [RIM], 'rimH', 'cut', 'clearance', ['base']));
  // 3c: the standoffs, own circles of standoffD around the projected hole circles
  const t = 'standSk';
  const commands: Command[] = [addSketch(t, { kind: 'plane', feature: 'framePl' })];
  [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sy], i) => {
    commands.push(
      fromSketch(t, `sh${i}`, 'frame', `fh${i}`, 'circle', true),
      point(t, `sc${i}`, sx * 26.4, sy * 16.6),
      { type: 'addCurve', sketch: t, id: `so${i}`, curve: { type: 'circle', center: `sc${i}` }, radius: 2.9 },
      constrain(t, `sk${i}`, { type: 'coincident', a: `sc${i}`, b: `sh${i}/center` }),
      i === 0 ? constrain(t, 'sd', { type: 'diameter', curve: 'so0', value: 'standoffD', driving: true } as never) : constrain(t, `se${i}`, { type: 'equalRadius', a: 'so0', b: `so${i}` }),
    );
  });
  run(engine, ...commands);
  run(engine, extrudeOp('standoffs', t, [['so0'], ['so1'], ['so2'], ['so3']], 'standoffH', 'add', undefined, ['base']));
  return { floor: ids.curves, entries: ids.entries };
}

describe('scenario 15, steps 2, 3, 5 and 7: the skeleton and the base by projections (6b, D69)', () => {
  const floorHeld = (engine: Engine, floor: Id[], entries: Id[]): void => {
    const state = engine.getState();
    const diagnosis = engine.diagnoseSketch('baseSk');
    expect(diagnosis.status).toBe('solved');
    expect(diagnosis.degreesOfFreedom).toBe(0);
    expect(diagnosis.redundant).toEqual([]);
    expect(resultOf(state, 'baseSk').redundant).toEqual([]);
    expect(loopsOf(state, 'baseSk')).toEqual([[...floor].sort()]);
    expect(offProjection(state, 'baseSk', floor, entries)).toBeLessThan(1e-7);
  };

  it('step 2: the skeleton measures the holes from origin/y; step 3: the floor held on its projections, the rim of eight entries, the standoffs; the base as by hand', () => {
    const engine = newEngine();
    const { floor, entries } = skeletonAndBase(engine);
    const state = engine.getState();
    expect(resultOf(state, 'frame').measurements.m1).toBeCloseTo(26.5, 9);
    expect(resultOf(state, 'frame').measurements.m2).toBeCloseTo(26.5, 9);
    expect(loopsOf(state, 'frame')).toEqual([]);
    expect(resultOf(state, 'frame').valid).toBe(true);
    expect((sketchOf(state, 'frame').external.fa0 as { regions: boolean }).regions).toBe(false);
    expect(Object.keys(sketchOf(state, 'frame').solved.external.fa0).sort()).toEqual(['center', 'end', 'kind', 'start']);
    expect(floor).toHaveLength(8);
    floorHeld(engine, floor, entries);
    expect(loopsOf(state, 'rimSk')).toEqual([RIM]);
    expect(resultOf(state, 'rimSk').valid).toBe(true);
    // four discs and four rings with the projected circle as their hole
    expect(loopsOf(state, 'standSk')).toHaveLength(8);
    expect(['base', 'rim', 'pocket', 'standoffs'].map((id) => state.evaluation.features[id].status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(Math.abs(state.evaluation.bodies.base.volume - baseByHand(60))).toBeLessThan(ALLOWANCE);
    // the bore of a standoff is named by the projection
    const faces = state.evaluation.bodies.base.faces.map((face) => faceKey(state.evaluation.faceNames[face.id]));
    expect(faces).toContain(faceKey({ feature: 'standoffs', role: 'side', curve: 'sh0' }));
    expect(faces).toContain(faceKey({ feature: 'rim', role: 'side', curve: 'ra0' }));
  });

  it('step 7, the part of 6b: the board 2 mm wider, everything follows; the floor held through jumps of the size and the corners', () => {
    const engine = newEngine();
    const { floor, entries } = skeletonAndBase(engine);
    const before = engine.getState().evaluation.bodies.base.volume;
    const wider = set(engine, 'boardW', '62');
    expect(allOk(wider)).toBe(true);
    expect(wider.evaluation.bodies.base.volume - before).toBeCloseTo(baseByHand(62) - baseByHand(60), 1);
    expect(resultOf(wider, 'frame').measurements.m1).toBeCloseTo(27.5, 9);
    floorHeld(engine, floor, entries);
    for (const [name, expr] of [['boardR', '6'], ['boardR', '3'], ['boardW', '80'], ['boardW', '60']] as const) {
      expect(allOk(set(engine, name, expr)), `${name} ${expr}`).toBe(true);
      floorHeld(engine, floor, entries);
    }
  });

  it('step 5, the seam with 6c: a sketch projects a copy of the lid\'s mirror and places a slot from it', () => {
    const engine = newEngine();
    mirroredLid(engine);
    run(engine, planeAt('rowPl', '2'), addSketch('rowSketch', { kind: 'plane', feature: 'rowPl' }), fromSketch('rowSketch', 'lf', 'lidSketch', 'm/1/c2', 'line'), ...slot('rowSketch', 'g', -25, 27));
    const state = run(engine, constrain('rowSketch', 'lfd', { type: 'distancePointLine', point: 'gs1', line: 'lf', value: 12, driving: true } as never));
    expect(state.evaluation.features.rowSketch.status).toBe('ok');
    expect(resultOf(state, 'rowSketch').points['lf/a'].x).toBeCloseTo(-LW / 2, 9);
    expect(resultOf(state, 'rowSketch').points.gs1.x).toBeCloseTo(-LW / 2 + 12, 6);
    // the width of the lid moves the copy, the projection and the slot with it
    const wider = set(engine, 'W', `${LW + 4}`);
    expect(resultOf(wider, 'rowSketch').points.gs1.x).toBeCloseTo(-(LW + 4) / 2 + 12, 6);
  });

  // A known limit, pinned (calls.ts, ownAfterANotch): an own outline drawn by the tool over the
  // frame, a rectangular notch trimmed into its bottom side, the result projected whole as own: the
  // own bottom side is two pieces, the projection under it one whole line, which lies at the place of
  // neither piece, so an own line is drawn over it too: 13 own curves, no region. Named by
  // `entities` (the own curves): one region. The implementation keeps "doubled" to a curve at the
  // same place (design.md, "To verify"); if it ever lists a curve that lies along one with regions,
  // `whole` below turns to one region and this test says so.
  it('the outline after a rectangular notch, projected again as own: whole leaves no region (the known limit), named by its own curves one', () => {
    const engine = newEngine();
    skeletonAndBase(engine);
    const s = 'notchSk';
    run(engine, addSketch(s, { kind: 'plane', feature: 'framePl' }));
    const outline = projectWith(engine, s, { sketch: 'frame', entities: FRAME_OUTLINE, as: 'own' }, 'n');
    run(engine, point(s, 'q1', -4, -23), point(s, 'q2', -4, -17), point(s, 'q3', 4, -17), point(s, 'q4', 4, -23), ln(s, 'ua', 'q1', 'q2'), ln(s, 'ub', 'q2', 'q3'), ln(s, 'uc', 'q3', 'q4'));
    run(engine, ...(['q1', 'q2', 'q3', 'q4'] as const).map((q, i) => constrain(s, `f${q}`, { type: 'fixed', point: q, x: [-4, -4, 4, 4][i], y: [-23, -17, -17, -23][i] } as never)));
    // the bottom side is the own curve over fl2, the sixth of the outline; the place lies as near to
    // the projection under it as to the own line, so it is named
    const bottom = outline.curves[5];
    for (const [i, place] of ([[0, -20], [-4, -21.5], [4, -21.5]] as const).entries()) cut(engine, 'trim', s, { at: [...place], repair: 'on', ...(i === 0 ? { curve: bottom } : {}) }, 't');
    const notched = engine.getState();
    const own = Object.entries(sketchOf(notched, s).curves).filter(([, curve]) => !curve.construction).map(([id]) => id);
    expect(resultOf(notched, s).valid).toBe(true);
    expect(loopsOf(notched, s)).toHaveLength(1);
    expect(own).toHaveLength(12);
    run(engine, addSketch('notchW', { kind: 'plane', feature: 'basePl' }), addSketch('notchN', { kind: 'plane', feature: 'basePl' }));
    const whole = projectWith(engine, 'notchW', { sketch: s, as: 'own' }, 'w');
    const named = projectWith(engine, 'notchN', { sketch: s, entities: own, as: 'own' }, 'm');
    const state = engine.getState();
    expect(whole.curves).toHaveLength(13);
    expect(resultOf(state, 'notchW').valid).toBe(false);
    expect(loopsOf(state, 'notchW')).toEqual([]);
    expect(named.curves).toHaveLength(12);
    expect(resultOf(state, 'notchN').valid).toBe(true);
    expect(loopsOf(state, 'notchN')).toHaveLength(1);
    expect(engine.diagnoseSketch('notchN').degreesOfFreedom).toBe(0);
  });

  it('a projection repaired keeps its ID, its flag and its region; another kind and a duplicate refused; the refusals of the commands', () => {
    const engine = newEngine();
    skeletonAndBase(engine);
    const kept = engine.preview({ type: 'updateExternal', sketch: 'rimSk', id: 'rl0', ref: { type: 'sketch', sketch: 'board', entity: 'bl0', kind: 'line', regions: true } });
    expect(kept.ok && loopsOf(kept.state, 'rimSk')).toEqual([RIM]);
    const update = (entity: Id, sketch: Id, kind: 'line' | 'arc'): Command => ({ type: 'updateExternal', sketch: 'rimSk', id: 'rl0', ref: { type: 'sketch', sketch, entity, kind, regions: true } });
    expect(refusal(engine, update('ba1', 'board', 'arc'))).toContain('druh promítnutí změnit nejde');
    expect(refusal(engine, update('fl1', 'frame', 'line'))).toContain(DUPLICATE('fl1', 'frame', 'rl1'));
    // a sketch later on the timeline, and itself
    expect(refusal(engine, fromSketch('frame', 'z1', 'rimSk', 'ra0', 'arc'))).toContain('musí ležet před odkazující feature');
    expect(refusal(engine, fromSketch('frame', 'z2', 'frame', 'fl0', 'line'))).toContain('musí ležet před odkazující feature');
    // the kind differs from the source's (the circle of the frame into the rim, which does not
    // project it: a duplicate is refused before the kind is read)
    expect(refusal(engine, fromSketch('rimSk', 'z3', 'frame', 'fh0', 'arc'))).toContain('expected arc');
    // an axis of another sketch, and its far point
    expect(refusal(engine, fromSketch('frame', 'z4', 'board', 'origin/x', 'line'))).toContain(UNDER_ORIGIN('origin/x', 'board'));
    expect(refusal(engine, fromSketch('frame', 'z5', 'board', 'origin/x/b', 'point'))).toContain(UNDER_ORIGIN('origin/x/b', 'board'));
    // a second projection of one entity, regions on a point
    expect(refusal(engine, fromSketch('frame', 'z6', 'board', 'ba0', 'arc'))).toContain(DUPLICATE('ba0', 'board', 'fa0'));
    expect(refusal(engine, fromSketch('frame', 'z7', 'board', 'hc0', 'point', true))).toContain(REGIONS_ON_A_POINT);
    // a constraint between two fixed entities: an axis and a projected point
    expect(refusal(engine, constrain('frame', 'z8', { type: 'pointOnCurve', point: 'fh0/center', curve: 'origin/x' }))).toContain('only between fixed entities');
  });
});

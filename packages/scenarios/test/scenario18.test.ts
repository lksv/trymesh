// Validation scenario 18 (D76, threads), the parts of stage 1 (cosmetic threads): a, the catalog;
// b, a plate of tapped holes with a bolt in it, a flange with a circle and a mirror of tapped
// holes, a printed tapped hole; e, the refusals. Built from the calls of
// docs/d36/7a-thread/calls.ts against the real adapters, and the point between the stages (the
// notes of an export, the print check and the parts list, `betweenTheStages`), and stage 2: c, a
// stud in a collar, d, a jar and its lid, both modelled.
import type { Command, EngineState, FaceName, HardwareHole, Id, InterferenceReport, ThreadResult } from '@trymesh/engine';
import { DATA_CATALOGS } from '@trymesh/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { XY, addSketch, circle, newEngine, onFace, rectangle, run } from './kit';
import { dot, point, thread, threadsOf } from './thread-kit';

type Engine = ReturnType<typeof newEngine>;
let engine: Engine;
const unwrap = <T>(outcome: { ok: true; result: T } | { ok: false; error: { message: string } }): T => {
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result;
};
const done = (outcome: ReturnType<Engine['preview']>): EngineState => {
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.state;
};
const tappedHole = (args: { use: 'tapped'; size: string; allowance?: string }): HardwareHole => unwrap(engine.query('hardwareHole', args));
const allOk = (state: EngineState): void => {
  for (const feature of state.document.features) expect(['ok', 'warning'], feature.id).toContain(state.evaluation.features[feature.id].status);
};
const codeOf = (command: Command, id: Id): string | undefined => done(engine.preview(command)).evaluation.features[id]?.error?.code;
const side = (feature: Id, curve: Id): FaceName => ({ feature, role: 'side', curve });
const sketchOn = (id: Id, plane: Parameters<typeof addSketch>[1]): Command[] => [addSketch(id, XY), { type: 'setSketchPlane', sketch: id, plane }];
const extrudeOf = (id: Id, sketch: Id, loop: Id[], start: number, distance: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop: [...loop].sort() }] }, extent: { type: 'distance', start, distance }, operation: 'new' } });
const M6 = DATA_CATALOGS.metricThreads.rows.M6;
const PLATE_TOP: FaceName = { feature: 'plate', role: 'endCap' };
const bore = (p: Id): FaceName => ({ feature: 'taps', role: 'holeBore', point: p });
const ringBore = (...copy: { pattern: Id; index: number }[]): FaceName => ({ feature: 'ringTap', role: 'holeBore', point: 'r1', ...(copy.length ? { copy } : {}) });

beforeAll(() => {
  engine = newEngine();
});

describe('scenario 18, a: the catalog', () => {
  it('code reads a row with its type; an AI reads it through the query catalog with its source', () => {
    expect(M6.tapDrill).toBe(5);
    const row = unwrap(engine.query('catalog', { name: 'metricThreads', key: 'M8x1' })) as { source: string };
    expect(row.source).toMatch(/ISO 262/);
  });
});

describe('scenario 18, b: a plate of tapped holes', () => {
  let before: EngineState;
  let state: EngineState;
  it('the plate, two tapped holes at the tap drill, a row of three, one thread feature with copies', () => {
    const preset = tappedHole({ use: 'tapped', size: 'M6' });
    expect(preset.label).toBeUndefined();
    expect(preset.thread).toEqual({ diameter: 6, pitch: 1, label: 'M6' });
    run(
      engine,
      addSketch('plateS', XY),
      rectangle('plateS', 'o', 0, 0, 60, 30),
      extrudeOf('plate', 'plateS', ['oa', 'ob', 'oc', 'od'], 0, 8),
      ...sketchOn('tapsS', onFace('plate', PLATE_TOP)),
      ...point('tapsS', 'h1', 10, 10),
      ...point('tapsS', 'h2', 10, 20),
      { type: 'addFeature', feature: { id: 'taps', name: 'taps', suppressed: false, type: 'hole', sketch: 'tapsS', points: ['h1', 'h2'], shape: preset.shape as never, extent: { type: 'throughAll', side: 'backward' }, targets: ['plate'] } },
      { type: 'addFeature', feature: { id: 'row', name: 'row', suppressed: false, type: 'pattern', source: { type: 'features', features: ['taps'] }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: { type: 'spacing', spacing: 15 } } } },
    );
    before = engine.getState();
    state = run(engine, thread('m6', { body: 'plate', faces: [bore('h1'), bore('h2')], copies: true, modelled: false, ...preset.thread!, hand: 'right', direction: 'backward' }));
    allOk(state);
  });

  it('six threads, each as the catalog says, from the mouths down, open at both ends; the mesh unchanged', () => {
    const threads = threadsOf(state, 'm6');
    expect(threads).toHaveLength(6);
    expect([threads[0].face, threads[1].face]).toEqual([bore('h1'), bore('h2')]);
    expect(threads.slice(2).every((t) => t.face.role === 'holeBore' && t.face.copy?.[0].pattern === 'row')).toBe(true);
    for (const t of threads) {
      expect(t).toMatchObject({ internal: true, modelled: false, bodies: ['plate'], diameter: M6.diameter, pitch: M6.pitch, starts: 1, clearance: 0, hand: 'right', label: 'M6', from: 0, ends: { start: 'open', end: 'open' }, runOut: { start: 0, end: 0 } });
      expect(2 * t.radius).toBeCloseTo(M6.tapDrill, 6);
      expect(t.flankAngle).toBeCloseTo(Math.PI / 3, 12);
      expect(t.depth).toBeCloseTo((M6.diameter - M6.minorDiameter) / 2, 3);
      expect(t.axis[2]).toBeCloseTo(-1, 9);
      expect(t.origin[2]).toBeCloseTo(8, 5);
      expect(t.to).toBeCloseTo(8, 5);
      expect(t.walls).toEqual([{ from: expect.closeTo(0, 5), to: expect.closeTo(8, 5) }]);
      // a copy by a shift has the helix of its listed face: the model's X axis
      expect(dot(t.zero, threads[0].zero)).toBeCloseTo(1, 9);
      expect(t.zero[0]).toBeCloseTo(1, 9);
    }
    expect(threads.map((t) => [Number(t.origin[0].toFixed(6)), Number(t.origin[1].toFixed(6))]).sort()).toEqual([[10, 10], [10, 20], [25, 10], [25, 20], [40, 10], [40, 20]]);
    expect(state.evaluation.bodies.plate.solid).toBe(before.evaluation.bodies.plate.solid);
    expect(unwrap(engine.query('body', { body: 'plate' })).threads).toHaveLength(6);
    expect(state.evaluation.features.m6.facts).toMatchObject({ threads: 6, copies: 4, lead: 1, crestFlat: expect.closeTo(1 / 8, 9), rootFlat: expect.closeTo(1 / 4, 9) });
    // the parts list counts no piece for a tapped hole and does not call it unlabelled
    const parts = unwrap(engine.query('partsList', {}));
    expect(parts.hardware.every((row) => !row.label.startsWith('M6'))).toBe(true);
    expect(parts.unlabelled?.some((hole) => hole.feature === 'taps') ?? false).toBe(false);
  });

  it('the point between the stages: the export says the threads of the plate are not in its mesh, the print check names it, its row of the parts list says them', () => {
    const exported = unwrap(engine.export('stl', { bodies: ['plate'] }));
    expect(exported.notes).toHaveLength(1);
    expect(exported.notes![0]).toContain('plate');
    expect(exported.notes![0]).toContain('6 cosmetic threads (M6)');
    const print = unwrap(engine.query('print', { bodies: ['plate'], orientations: [{ by: { up: [0, 0, 1] } }] }));
    expect(print.cosmeticThreads).toEqual([{ body: 'plate', threads: 6 }]);
    const row = unwrap(engine.query('partsList', {})).printed.find((part) => part.bodies.includes('plate'));
    expect(row?.threads).toEqual([{ label: 'M6', internal: true, modelled: false, count: 6 }]);
  });

  it('four in the row: eight threads, the thread feature untouched', () => {
    expect(threadsOf(done(engine.preview({ type: 'updateFeature', id: 'row', patch: { transform: { count: 4 } } as never })), 'm6')).toHaveLength(8);
  });

  it('a printed tapped M3: the bore at the tap drill plus 0.3, the thread with half of it as its clearance', () => {
    const preset = tappedHole({ use: 'tapped', size: 'M3', allowance: '0.3' });
    expect(preset.thread?.clearance).toBe('(0.3) / 2');
    const printed = done(
      engine.preview({
        type: 'batch',
        commands: [
          ...sketchOn('m3S', onFace('plate', PLATE_TOP)),
          ...point('m3S', 'q1', 50, 25),
          { type: 'addFeature', feature: { id: 'm3', name: 'm3', suppressed: false, type: 'hole', sketch: 'm3S', points: ['q1'], shape: preset.shape as never, extent: { type: 'throughAll', side: 'backward' }, targets: ['plate'] } },
          thread('m3Thread', { body: 'plate', faces: [{ feature: 'm3', role: 'holeBore', point: 'q1' }], modelled: false, ...preset.thread!, hand: 'right', direction: 'backward' }),
        ],
      }),
    );
    expect(printed.evaluation.features.m3Thread.status).toBe('ok');
    const [made] = threadsOf(printed, 'm3Thread');
    expect(made.clearance).toBeCloseTo(0.15, 12);
    expect(2 * made.radius).toBeCloseTo(DATA_CATALOGS.metricThreads.rows.M3.tapDrill + 0.3, 6);
  });

  it('a bolt of the nominal diameter through the first hole: threaded, and the smallest gap says threaded', () => {
    run(engine, { type: 'setParameter', name: 'boltD', expr: String(M6.diameter) }, addSketch('boltS', XY), circle('boltS', 'shank', 10, 10, 3), { type: 'setConstraintValue', sketch: 'boltS', id: 'shankr', value: 'boltD / 2' } as never, extrudeOf('bolt', 'boltS', ['shank'], -2, 14));
    allOk(engine.getState());
    const report = unwrap(engine.query('interference', { bodies: ['bolt', 'plate'] }));
    expect(report.pairs).toEqual([]);
    expect(report.fits).toEqual([]);
    expect(report.threaded).toEqual([{ a: 'bolt', b: 'plate', volume: expect.any(Number), threads: [{ feature: 'm6', face: bore('h1'), body: 'plate' }] }]);
    expect(report.threaded![0].volume).toBeGreaterThan(0);
    expect(unwrap(engine.query('gap', { bodies: ['bolt', 'plate'] })).pairs[0]).toEqual({ a: 'bolt', b: 'plate', distance: 0, contact: 'threaded' });
  });

  it('too thick a bolt collides; its own thread agrees, another pitch, hand or profile does not', () => {
    const at = (command: Command): InterferenceReport => unwrap(engine.query('interference', { bodies: ['bolt', 'plate'] }, { state: done(engine.preview(command)) }));
    const tooThick = at({ type: 'setParameter', name: 'boltD', expr: '8' });
    expect([tooThick.pairs.length, tooThick.threaded]).toEqual([1, undefined]);
    const boltThread = (pitch: number, hand: 'right' | 'left' = 'right', flankAngle?: string): Command => thread('boltThread', { body: 'bolt', faces: [side('bolt', 'shank')], modelled: false, diameter: 'boltD', pitch, hand, direction: 'forward', ...(flankAngle ? { flankAngle } : {}) });
    expect(at(boltThread(M6.pitch)).threaded?.[0].threads).toHaveLength(2);
    for (const other of [boltThread(DATA_CATALOGS.metricThreads.rows.M5.pitch), boltThread(M6.pitch, 'left'), boltThread(M6.pitch, 'right', 'deg(90)')]) {
      const report = at(other);
      expect(report.threaded).toBeUndefined();
      expect(report.pairs).toHaveLength(1);
      expect(typeof report.pairs[0].mismatch).toBe('string');
    }
  });

  it('a block over the bolt keeps its core, a block at its corner reaches in from one side: both collide', () => {
    for (const size of [20, 8]) {
      const state = done(
        engine.preview({
          type: 'batch',
          commands: [thread('boltThread', { body: 'bolt', faces: [side('bolt', 'shank')], modelled: false, diameter: 'boltD', pitch: M6.pitch, hand: 'right', direction: 'forward' }), addSketch('blockS', XY), rectangle('blockS', 'k', 0, 0, size, size), extrudeOf('block', 'blockS', ['ka', 'kb', 'kc', 'kd'], 9, 2)],
        }),
      );
      const report = unwrap(engine.query('interference', { bodies: ['bolt', 'block'] }, { state }));
      expect([report.pairs.length, report.threaded], `a block of ${size}`).toEqual([1, undefined]);
    }
  });

  it('a head seated on the plate: excused whichever ID comes first', () => {
    for (const id of ['aScrew', 'zScrew']) {
      const state = done(
        engine.preview({
          type: 'batch',
          commands: [addSketch('headS', XY), circle('headS', 'head', 10, 10, 5), extrudeOf(id, 'headS', ['head'], 8, 3), { type: 'addFeature', feature: { id: `${id}Joined`, name: `${id}Joined`, suppressed: false, type: 'combine', operation: 'union', target: id, tools: ['bolt'], keepTools: true } }],
        }),
      );
      const report = unwrap(engine.query('interference', { bodies: [id, 'plate'] }, { state }));
      expect([report.pairs, report.fits, report.threaded?.length], id).toEqual([[], [], 1]);
    }
  });
});

describe('scenario 18, b: a flange', () => {
  let state: EngineState;
  it('one tapped hole, a circle of three and its mirror image, one thread with copies and a phase of 30°', () => {
    const preset = tappedHole({ use: 'tapped', size: 'M6' });
    state = run(
      engine,
      addSketch('flangeS', XY),
      circle('flangeS', 'disc', 0, 0, 30),
      extrudeOf('flange', 'flangeS', ['disc'], 20, 6),
      addSketch('ringS', XY),
      ...point('ringS', 'r1', 20, 0),
      { type: 'addFeature', feature: { id: 'ringTap', name: 'ringTap', suppressed: false, type: 'hole', sketch: 'ringS', points: ['r1'], shape: preset.shape as never, extent: { type: 'throughAll', side: 'forward' }, targets: ['flange'] } },
      { type: 'addFeature', feature: { id: 'ring', name: 'ring', suppressed: false, type: 'pattern', source: { type: 'features', features: ['ringTap'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } } } },
      { type: 'addFeature', feature: { id: 'across', name: 'across', suppressed: false, type: 'pattern', source: { type: 'features', features: ['ringTap'] }, transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } } },
      thread('flangeThread', { body: 'flange', faces: [ringBore()], copies: true, modelled: false, ...preset.thread!, hand: 'right', direction: 'forward', phase: 'deg(30)' }),
    );
    allOk(state);
  });

  it('the datum of the listed face, turned with the circle, mirrored by the mirror with the stated hand', () => {
    const threads = threadsOf(state, 'flangeThread');
    expect(threads).toHaveLength(4);
    const at = (...copy: { pattern: Id; index: number }[]): ThreadResult => threads.find((t) => JSON.stringify(t.face) === JSON.stringify(ringBore(...copy)))!;
    const [listed, second, third, mirrored] = [at(), at({ pattern: 'ring', index: 1 }), at({ pattern: 'ring', index: 2 }), at({ pattern: 'across', index: 1 })];
    const turned = (v: readonly number[], angle: number): number[] => [v[0] * Math.cos(angle) - v[1] * Math.sin(angle), v[0] * Math.sin(angle) + v[1] * Math.cos(angle), v[2]];
    expect(dot(listed.zero, turned([1, 0, 0], Math.PI / 6))).toBeCloseTo(1, 9);
    expect(dot(second.zero, turned(listed.zero, (2 * Math.PI) / 3))).toBeCloseTo(1, 9);
    expect(dot(third.zero, turned(listed.zero, (4 * Math.PI) / 3))).toBeCloseTo(1, 9);
    expect(dot(mirrored.zero, [-listed.zero[0], listed.zero[1], listed.zero[2]])).toBeCloseTo(1, 9);
    expect(mirrored.hand).toBe('right');
    expect(mirrored.origin[0]).toBeCloseTo(-20, 5);
    expect(state.evaluation.features.flangeThread.facts?.copies).toBe(3);
  });

  it('the other hand on the mirrored copy is a second feature on that face', () => {
    const state = done(
      engine.preview({
        type: 'batch',
        commands: [
          { type: 'updateFeature', id: 'flangeThread', patch: { copies: false, faces: [ringBore(), ringBore({ pattern: 'ring', index: 1 }), ringBore({ pattern: 'ring', index: 2 })] } },
          thread('flangeLeft', { body: 'flange', faces: [ringBore({ pattern: 'across', index: 1 })], modelled: false, diameter: 6, pitch: M6.pitch, hand: 'left', direction: 'forward' }),
        ],
      }),
    );
    expect(threadsOf(state, 'flangeThread')).toHaveLength(3);
    expect(threadsOf(state, 'flangeLeft')[0].hand).toBe('left');
    allOk(state);
  });

  it('before its pattern the thread finds no copy and says so', () => {
    const state = done(engine.preview({ type: 'moveFeature', id: 'flangeThread', index: engine.getState().document.features.findIndex((feature) => feature.id === 'ring') }));
    expect(state.evaluation.features.flangeThread.warnings.map((w) => w.code)).toContain('noCopies');
    expect(threadsOf(state, 'flangeThread')).toHaveLength(1);
    expect(state.evaluation.features.flangeThread.facts?.copies).toBe(0);
  });
});

describe('scenario 18, e: refusals', () => {
  const m6 = { modelled: false, diameter: 6, pitch: 1, hand: 'right', direction: 'backward' } as const;
  it('a face that is no cylinder, a face the body does not have, a bore too narrow, too long a thread, a second thread on a bore, a profile that does not fit, a part of a cylinder, a thread as a source of a pattern', () => {
    expect(codeOf(thread('onTop', { body: 'plate', faces: [PLATE_TOP], ...m6 }), 'onTop')).toBe('invalidThread');
    expect(codeOf(thread('nowhere', { body: 'plate', faces: [bore('h9')], ...m6 }), 'nowhere')).toBe('brokenReference');
    expect(done(engine.preview({ type: 'updateFeature', id: 'taps', patch: { shape: { diameter: 4 } } as never })).evaluation.features.m6.error?.code).toBe('invalidThread');
    expect(done(engine.preview({ type: 'updateFeature', id: 'm6', patch: { length: 20 } })).evaluation.features.m6.error?.code).toBe('invalidThread');
    expect(codeOf(thread('again', { body: 'plate', faces: [bore('h1')], ...m6 }), 'again')).toBe('invalidThread');
    expect(done(engine.preview({ type: 'updateFeature', id: 'm6', patch: { flankAngle: 'deg(150)', depth: 0.54 } })).evaluation.features.m6.error?.code).toBe('invalidThread');
    const rounded = done(
      engine.preview({
        type: 'batch',
        commands: [
          { type: 'addFeature', feature: { id: 'round', name: 'round', suppressed: false, type: 'fillet', body: 'plate', edges: [{ a: PLATE_TOP, b: side('plate', 'oa') }], radius: 3 } },
          thread('onRound', { body: 'plate', faces: [{ feature: 'round', role: 'fillet', edge: 0 }], ...m6 }),
        ],
      }),
    );
    expect(rounded.evaluation.features.onRound.error?.code).toBe('invalidThread');
    expect(engine.execute({ type: 'addFeature', feature: { id: 'more', name: 'more', suppressed: false, type: 'pattern', source: { type: 'features', features: ['m6'] }, transform: { type: 'linear', direction: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'spacing', spacing: 5 } } } }).ok).toBe(false);
  });
});


// ---------------------------------------------------------------- stage 2: modelled threads
// A circle with its own centre point fixed at (x, y) and a radius that is an expression.
const circleAt = (sketch: Id, id: Id, x: number, y: number, radius: string): Command[] => [
  ...point(sketch, `${id}c`, x, y),
  { type: 'addCurve', sketch, id, curve: { type: 'circle', center: `${id}c` }, radius: 1 },
  { type: 'addConstraint', sketch, id: `${id}r`, constraint: { type: 'radius', curve: id, value: radius as never, driving: true } },
];
const regionsOf = (...curves: Id[][]) => curves.map((loop) => ({ outerLoop: [...loop].sort() }));
const extrudeExpr = (id: Id, sketch: Id, regions: Id[][], start: string | number, distance: number, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command =>
  ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: regionsOf(...regions) }, extent: { type: 'distance', start, distance }, operation, ...(targets ? { targets } : {}) } }) as Command;

describe('scenario 18, c: a stud in a collar (stage 2)', () => {
  const M10 = DATA_CATALOGS.metricThreads.rows.M10;
  const STUD = side('stud', 'rod');
  const COLLAR = side('collar', 'hole');
  let plain: EngineState;
  let state: EngineState;
  const names = (s: EngineState, body: Id): FaceName[] => s.evaluation.bodies[body].faces.map((face) => s.evaluation.faceNames[face.id]);
  const has = (s: EngineState, body: Id, name: FaceName): boolean => names(s, body).some((other) => JSON.stringify(other) === JSON.stringify(name));
  const surface = (s: EngineState, body: Id, name: FaceName) => s.evaluation.faceSurfaces[s.evaluation.bodies[body].faces.find((face) => JSON.stringify(s.evaluation.faceNames[face.id]) === JSON.stringify(name))?.id ?? -1];
  const report = (s?: EngineState) => unwrap(engine.query('interference', { bodies: ['stud', 'collar'] }, s ? { state: s } : {}));

  it('an M10 stud threaded 14 down from its top and a collar with the clearance 0.2, both modelled', () => {
    run(
      engine,
      { type: 'setParameter', name: 'clr', expr: '0.2' },
      { type: 'setParameter', name: 'studD', expr: String(M10.diameter) },
      { type: 'setParameter', name: 'studP', expr: String(M10.pitch) },
      { type: 'setParameter', name: 'collarTop', expr: '16' },
      { type: 'setParameter', name: 'studPhase', expr: 'deg(40)' },
      addSketch('studS', XY),
      ...circleAt('studS', 'rod', 100, 15, 'studD / 2'),
      extrudeExpr('stud', 'studS', [['rod']], 0, 20),
      addSketch('collarS', XY),
      ...circleAt('collarS', 'outer', 100, 15, '12'),
      ...circleAt('collarS', 'hole', 100, 15, `(${M10.tapDrill} + 2 * clr) / 2`),
      extrudeExpr('collar', 'collarS', [['outer']], 'collarTop - 8', 8),
    );
    plain = engine.getState();
    state = run(
      engine,
      thread('studThread', { body: 'stud', faces: [STUD], modelled: true, diameter: 'studD', pitch: 'studP', hand: 'right', direction: 'backward', length: 14, phase: 'studPhase', label: 'M10' }),
      thread('collarThread', { body: 'collar', faces: [COLLAR], modelled: true, diameter: 'studD', pitch: 'studP', clearance: 'clr', hand: 'right', direction: 'backward', phase: 'studPhase + 2 * pi * (20 - collarTop) / studP', label: 'M10' }),
    );
    allOk(state);
  });

  it('the faces, the ends, the records, the volumes; the two free of each other', () => {
    const root = surface(state, 'stud', { feature: 'studThread', role: 'threadRoot', face: 0 });
    expect(has(state, 'stud', { feature: 'studThread', role: 'threadFlank', face: 0, side: 'start' })).toBe(true);
    expect(has(state, 'stud', { feature: 'studThread', role: 'threadFlank', face: 0, side: 'end' })).toBe(true);
    expect(root?.kind === 'cylinder' && 2 * root.radius).toBeCloseTo(M10.minorDiameter, 3);
    expect(surface(state, 'stud', { feature: 'studThread', role: 'threadFlank', face: 0, side: 'start' })?.kind).toBe('general');
    expect(has(state, 'stud', { feature: 'studThread', role: 'threadEnd', face: 0, end: 'end' })).toBe(true);
    expect(has(state, 'stud', { feature: 'studThread', role: 'threadEnd', face: 0, end: 'start' })).toBe(false);
    expect(surface(state, 'stud', STUD)?.kind).toBe('cylinder');
    const collarRoot = surface(state, 'collar', { feature: 'collarThread', role: 'threadRoot', face: 0 });
    expect(collarRoot?.kind === 'cylinder' && 2 * collarRoot.radius).toBeCloseTo(M10.diameter + 0.4, 9);
    expect(names(state, 'collar').some((name) => name.role === 'threadEnd')).toBe(false);
    expect(has(state, 'collar', COLLAR)).toBe(true);
    expect(state.evaluation.bodies.stud.edges.filter((edge) => edge.name.a.role === 'threadFlank' || edge.name.b.role === 'threadFlank').every((edge) => edge.kind === 'other')).toBe(true);
    const [stud] = threadsOf(state, 'studThread');
    const [collar] = threadsOf(state, 'collarThread');
    expect([stud.ends, collar.ends, collar.runOut.start, stud.internal, collar.internal, stud.modelled, collar.modelled]).toEqual([{ start: 'open', end: 'inside' }, { start: 'open', end: 'open' }, 0, false, true, true, true]);
    expect([stud.origin[2], collar.origin[2], stud.axis[2], stud.to]).toEqual([expect.closeTo(20, 5), expect.closeTo(16, 5), expect.closeTo(-1, 9), expect.closeTo(14, 9)]);
    const cut = (body: Id): number => plain.evaluation.bodies[body].volume - state.evaluation.bodies[body].volume;
    expect(cut('stud')).toBeGreaterThan(0);
    expect(cut('stud')).toBeLessThan(Math.PI * 14 * ((M10.diameter / 2) ** 2 - (M10.minorDiameter / 2) ** 2));
    expect(cut('collar')).toBeGreaterThan(0);
    expect(report()).toMatchObject({ pairs: [], fits: [], failed: [] });
    expect(report().threaded).toBeUndefined();
  });

  it('the clearance of the pin: refused on the nominal diameter in both modes, taken on a pin made for it', () => {
    const onNominal = (modelled: boolean) => done(engine.preview({ type: 'updateFeature', id: 'studThread', patch: { clearance: 'clr', modelled } } as never)).evaluation.features.studThread.error?.code;
    expect([onNominal(true), onNominal(false)]).toEqual(['invalidThread', 'invalidThread']);
    const made = done(engine.preview({ type: 'batch', commands: [{ type: 'setConstraintValue', sketch: 'studS', id: 'rodr', value: '(studD - 2 * clr) / 2' }, { type: 'updateFeature', id: 'studThread', patch: { clearance: 'clr' } }] } as never));
    expect(made.evaluation.features.studThread.status).toBe('ok');
    const root = surface(made, 'stud', { feature: 'studThread', role: 'threadRoot', face: 0 });
    expect(root?.kind === 'cylinder' && 2 * root.radius).toBeCloseTo(M10.minorDiameter - 0.4, 3);
  });

  it('the collar threaded from below with the phase of the other row: still free', () => {
    const below = done(engine.preview({ type: 'updateFeature', id: 'collarThread', patch: { direction: 'forward', phase: '-studPhase - 2 * pi * (20 - (collarTop - 8)) / studP' } } as never));
    const [collar] = threadsOf(below, 'collarThread');
    expect([collar.axis[2], collar.origin[2]]).toEqual([expect.closeTo(1, 9), expect.closeTo(8, 5)]);
    expect(report(below)).toMatchObject({ pairs: [], fits: [], failed: [] });
  });

  it('wrongPhase: the collar turned by half a pitch collides, the entry says what to add to either phase, and that frees it', () => {
    const turned = done(engine.preview({ type: 'updateFeature', id: 'collarThread', patch: { phase: 'studPhase + 2 * pi * (20 - collarTop) / studP + pi' } } as never));
    const wrong = report(turned);
    expect(wrong.pairs).toHaveLength(1);
    expect(wrong.threaded).toBeUndefined();
    const seat = wrong.pairs[0].seat ?? [];
    expect(seat).toHaveLength(2);
    const forCollar = seat.find((entry) => entry.feature === 'collarThread');
    expect(Math.abs(forCollar?.addToPhase ?? 0)).toBeCloseTo(Math.PI, 6);
    const seated = done(engine.preview({ type: 'updateFeature', id: 'collarThread', patch: { phase: `studPhase + 2 * pi * (20 - collarTop) / studP + pi + ${forCollar?.addToPhase}` } } as never));
    expect(report(seated).pairs).toEqual([]);
  });

  it('cosmetic again: the meshes are the plain ones, the threads are recorded, the pair is excused', () => {
    const again = done(engine.preview({ type: 'batch', commands: [{ type: 'updateFeature', id: 'studThread', patch: { modelled: false } }, { type: 'updateFeature', id: 'collarThread', patch: { modelled: false } }] } as never));
    expect(again.evaluation.bodies.stud.volume).toBe(plain.evaluation.bodies.stud.volume);
    expect(again.evaluation.bodies.collar.volume).toBe(plain.evaluation.bodies.collar.volume);
    expect(threadsOf(again, 'studThread')).toHaveLength(1);
    expect(threadsOf(again, 'collarThread')[0].modelled).toBe(false);
    expect(report(again)).toMatchObject({ pairs: [], threaded: [{ a: 'collar', b: 'stud' }] });
  });
});

describe('scenario 18, d: a jar and its lid (stage 2)', () => {
  const NECK = side('neckUp', 'neck');
  const SOCKET = side('socketCut', 'socket');
  const common = { diameter: 'neck', pitch: 'lidP', flankAngle: 'deg(90)', starts: 2, hand: 'right', modelled: true, label: 'lid 40 x 4' } as const;
  let state: EngineState;

  it('a neck 40 x 4 with two starts at 90° on a jar, its lid with the clearance 0.3', () => {
    state = run(
      engine,
      { type: 'setParameter', name: 'neck', expr: '40' },
      { type: 'setParameter', name: 'lidP', expr: '4' },
      { type: 'setParameter', name: 'lidClr', expr: '0.3' },
      addSketch('jarS', XY),
      ...circleAt('jarS', 'foot', 200, 30, '25'),
      ...circleAt('jarS', 'neck', 200, 30, 'neck / 2'),
      extrudeExpr('jar', 'jarS', [['foot'], ['neck']], 0, 5),
      extrudeExpr('neckUp', 'jarS', [['neck']], 5, 15, 'add', ['jar']),
      addSketch('lidS', XY),
      ...circleAt('lidS', 'rim', 200, 30, '24'),
      ...circleAt('lidS', 'socket', 200, 30, '(neck - 2 * 5 * lidP / 16) / 2 + lidClr'),
      extrudeExpr('lid', 'lidS', [['rim'], ['socket']], 12, 10),
      extrudeExpr('socketCut', 'lidS', [['socket']], 12, 8.5, 'cut', ['lid']),
      thread('jarThread', { body: 'jar', faces: [NECK], ...common, direction: 'backward', length: 10 }),
      thread('lidThread', { body: 'lid', faces: [SOCKET], ...common, clearance: 'lidClr', direction: 'backward', phase: '-2 * pi * 0.5 / (lidP * 2)' }),
    );
    allOk(state);
  });

  it('the profile, the ends, the flat end of the socket; the lid screwed on is free of the jar', () => {
    const [jar] = threadsOf(state, 'jarThread');
    const [lid] = threadsOf(state, 'lidThread');
    const facts = state.evaluation.features.jarThread.facts ?? {};
    expect([facts.depth, facts.lead, jar.depth, jar.starts, jar.flankAngle]).toEqual([expect.closeTo(1.25, 9), expect.closeTo(8, 9), expect.closeTo(1.25, 9), 2, expect.closeTo(Math.PI / 2, 12)]);
    expect([jar.ends, lid.ends, lid.internal, jar.internal]).toEqual([{ start: 'open', end: 'inside' }, { start: 'shoulder', end: 'open' }, true, false]);
    expect(state.evaluation.bodies.lid.faces.some((face) => JSON.stringify(state.evaluation.faceNames[face.id]) === JSON.stringify({ feature: 'lidThread', role: 'threadEnd', face: 0, end: 'start' }))).toBe(true);
    const report = unwrap(engine.query('interference', { bodies: ['jar', 'lid'] }));
    expect(report).toMatchObject({ pairs: [], failed: [] });
    expect(report.threaded).toBeUndefined();
  });

  it('a mirrored copy of the lid is left-handed and says so, in both modes, with the same datum', () => {
    const twin: Command = { type: 'addFeature', feature: { id: 'twin', name: 'twin', suppressed: false, type: 'pattern', source: { type: 'body', body: 'lid' }, transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } } } as Command;
    const pair = (s: EngineState) => ({ copy: s.evaluation.threads.find((t) => t.feature === 'lidThread' && t.bodies.includes('twin/1')), original: s.evaluation.threads.find((t) => t.feature === 'lidThread' && t.bodies.includes('lid')) });
    const modelledState = done(engine.preview(twin));
    const cosmeticState = done(engine.preview({ type: 'batch', commands: [{ type: 'updateFeature', id: 'lidThread', patch: { modelled: false } }, twin] } as Command));
    for (const s of [modelledState, cosmeticState]) expect(s.evaluation.features.twin.warnings.map((w) => w.code)).toContain('mirroredThread');
    const [modelled, cosmetic] = [pair(modelledState), pair(cosmeticState)];
    for (const { copy, original } of [modelled, cosmetic]) {
      expect([copy?.hand, original?.hand]).toEqual(['left', 'right']);
      expect(copy!.origin[0]).toBeCloseTo(-original!.origin[0], 5);
      expect(dot(copy!.zero, [-original!.zero[0], original!.zero[1], original!.zero[2]])).toBeCloseTo(1, 9);
      expect(dot(copy!.axis, original!.axis)).toBeCloseTo(1, 9);
      expect(copy!.face.copy?.[0].pattern).toBe('twin');
    }
    expect([modelled.copy?.modelled, cosmetic.copy?.modelled]).toEqual([true, false]);
    expect(dot(modelled.copy!.zero, cosmetic.copy!.zero)).toBeCloseTo(1, 9);
  });
});

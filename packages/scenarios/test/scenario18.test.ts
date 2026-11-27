// Validation scenario 18 (D76, threads), the parts of stage 1 (cosmetic threads): a, the catalog;
// b, a plate of tapped holes with a bolt in it, a flange with a circle and a mirror of tapped
// holes, a printed tapped hole; e, the refusals. Built from the calls of
// docs/d36/7a-thread/calls.ts against the real adapters, and the point between the stages (the
// notes of an export, the print check and the parts list, `betweenTheStages`). Stage 2 (c, a stud
// in a collar; d, a jar and its lid) is not part of this build.
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


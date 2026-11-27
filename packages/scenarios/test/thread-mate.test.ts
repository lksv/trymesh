// Modelled threads (D76, stage 2) in pairs, against the real adapters: a screw in a nut, the seat of
// two that are turned against each other (also through mirrors), a modelled thread against a plain
// rod and a cosmetic one, and the measurements of "Performance". Apart from
// thread-modelled.test.ts and each test starting with a turn of the event loop, so that no worker
// stays in synchronous code for a minute under the load of the full suite (the review of stage 2).
import { type Command, type EngineState, type Id, emptyDocument } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { phaseSense, withPhaseSense } from '../../engine/src/recompute/thread';
import { newEngine, run } from './kit';
import { M10, aTurn, blindHole, bodyPattern, bore, box, hole, mirrorIn, preview, rod, rodSide, statusOf, thread, threadsOf } from './thread-kit';

type Engine = ReturnType<typeof newEngine>;
const interference = (engine: Engine, bodies: Id[], state?: EngineState) => {
  const outcome = engine.query('interference', { bodies }, state ? { state } : {});
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result;
};
const timed = <T>(f: () => T): [T, number] => {
  const t0 = performance.now();
  const value = f();
  return [value, performance.now() - t0];
};

describe('a screw in a nut', () => {
  // an M10 stud 20 long, threaded 14 down from its top; a nut 8 high from z = 8 to 16 with the
  // clearance 0.2 and its bore widened by twice it; the helix of the nut starts 4 below the stud's
  const studAndNut = (engine: Engine, nutPhase: (base: number) => number = (b) => b, hand: 'right' | 'left' = 'right', starts = 1) => {
    const base = (hand === 'left' ? -1 : 1) * (2 * Math.PI * 4) / (1.5 * starts);
    run(
      engine,
      rod('stud', 0, 0, 5, 0, 20),
      box('nut', -10, -10, 10, 10, 8, 16),
      hole('nh', [['h', 0, 0]], 10 - 2 * 0.811899 + 0.4, 'nut'),
      thread('st', { body: 'stud', faces: [rodSide('stud')], modelled: true, ...M10, hand, starts, length: 14 }),
      thread('nt', { body: 'nut', faces: [bore('nh', 'h')], modelled: true, ...M10, hand, starts, clearance: 0.2, phase: nutPhase(base) }),
    );
    return base;
  };

  it('seated, free of each other; turned by half a pitch, a collision whose entry says how to seat either; seated so, free again', { timeout: 120_000 }, async () => {
    await aTurn();
    const engine = newEngine();
    const base = studAndNut(engine);
    expect(interference(engine, ['stud', 'nut'])).toMatchObject({ pairs: [], fits: [], failed: [] });
    const turned = preview(engine, { type: 'updateFeature', id: 'nt', patch: { phase: base + Math.PI } } as Command);
    const report = interference(engine, ['stud', 'nut'], turned);
    expect(report.pairs).toHaveLength(1);
    expect(report.threaded).toBeUndefined();
    const seat = report.pairs[0].seat ?? [];
    expect(seat.map((s) => s.feature).sort()).toEqual(['nt', 'st']);
    const forNut = seat.find((s) => s.feature === 'nt')!;
    const forStud = seat.find((s) => s.feature === 'st')!;
    expect(Math.abs(forNut.addToPhase)).toBeCloseTo(Math.PI, 6);
    for (const [id, add, phase] of [['nt', forNut.addToPhase, base + Math.PI], ['st', forStud.addToPhase, 0]] as const) {
      const seated = preview(engine, { type: 'batch', commands: [{ type: 'updateFeature', id: 'nt', patch: { phase: base + Math.PI } }, { type: 'updateFeature', id, patch: { phase: phase + add } }] } as Command);
      expect(interference(engine, ['stud', 'nut'], seated).pairs, id).toEqual([]);
    }
  });

  // The other seats in a document of the chord tolerance 0.05 (the clearance 0.2 is above it), so
  // that a colliding pair is measured in about a second; the values for the hands, the starts and
  // the two ways are also tested without meshes (packages/engine/test/seat.test.ts).
  const coarse = (): Engine => {
    const engine = newEngine();
    const loaded = engine.load(JSON.stringify({ ...emptyDocument(), settings: { chordTolerance: 0.05 } }));
    if (!loaded.ok) throw new Error(loaded.error.message);
    return engine;
  };
  // applying either entry of `seat` frees the pair
  const eitherFrees = (engine: Engine, a: Id, b: Id, base: Command[]): void => {
    const report = interference(engine, [a, b], base.length ? preview(engine, { type: 'batch', commands: base } as Command) : undefined);
    expect(report.pairs).toHaveLength(1);
    const seat = report.pairs[0].seat ?? [];
    expect(seat).toHaveLength(2);
    for (const entry of seat) {
      const phase = (engine.getState().document.features.find((f) => f.id === entry.feature) as { phase?: number }).phase ?? 0;
      const patched = base.find((c) => c.type === 'updateFeature' && c.id === entry.feature) as { patch?: { phase?: number } } | undefined;
      const seated = preview(engine, { type: 'batch', commands: [...base, { type: 'updateFeature', id: entry.feature, patch: { phase: (patched?.patch?.phase ?? phase) + entry.addToPhase } }] } as Command);
      expect(interference(engine, [a, b], seated).pairs, entry.feature).toEqual([]);
    }
  };

  it('a turn of 1 radian in both hands and with two starts, and the nut threaded the other way (chord tolerance 0.05)', { timeout: 120_000 }, async () => {
    await aTurn();
    for (const [hand, starts] of [['right', 1], ['left', 1], ['right', 2]] as const) {
      await aTurn();
      const engine = coarse();
      const base = studAndNut(engine, (b) => b + 1, hand, starts);
      const forNut = interference(engine, ['stud', 'nut']).pairs[0]?.seat?.find((s) => s.feature === 'nt');
      expect(forNut?.addToPhase, `${hand} ${starts}`).toBeCloseTo(-1, 6);
      expect(interference(engine, ['stud', 'nut'], preview(engine, { type: 'updateFeature', id: 'nt', patch: { phase: base } } as Command)).pairs, `${hand} ${starts}`).toEqual([]);
    }
    const engine = coarse();
    studAndNut(engine);
    eitherFrees(engine, 'nut', 'stud', [{ type: 'updateFeature', id: 'nt', patch: { direction: 'forward', phase: -(2 * Math.PI * 12) / 1.5 + 0.7 } } as Command]);
  });

  // the review of stage 2: a phase turns a record that went through a mirror the other way
  it('a stud and a nut both mirrored by patterns of the bodies: the seat of the mirrored pair frees it (chord tolerance 0.05)', { timeout: 120_000 }, async () => {
    await aTurn();
    const engine = coarse();
    run(engine, rod('stud', 20, 0, 5, 0, 20), box('nut', 10, -10, 30, 10, 8, 16), hole('nh', [['h', 20, 0]], 10 - 2 * 0.811899 + 0.4, 'nut'), thread('st', { body: 'stud', faces: [rodSide('stud')], modelled: true, ...M10, length: 14 }), thread('nt', { body: 'nut', faces: [bore('nh', 'h')], modelled: true, ...M10, clearance: 0.2, phase: (2 * Math.PI * 4) / 1.5 + 1 }), bodyPattern('ms', 'stud', mirrorIn('YZ')), bodyPattern('mn', 'nut', mirrorIn('YZ')));
    const mirrored = interference(engine, ['ms/1', 'mn/1']).pairs[0]?.seat;
    expect(mirrored?.find((s) => s.feature === 'nt')?.addToPhase).toBeCloseTo(-1, 6);
    // the sense of the phase: +1 on the listed face, −1 on the copy through the mirror; a copy made
    // by withPhaseSense keeps it, and any other object is refused loudly (the second review)
    const nuts = threadsOf(engine.getState(), 'nt');
    const [plain, copy] = ['nut', 'mn/1'].map((body) => nuts.find((t) => t.bodies.includes(body))!);
    expect([phaseSense(plain), phaseSense(copy), phaseSense(withPhaseSense({ ...copy }, copy))]).toEqual([1, -1, -1]);
    expect(() => phaseSense({ ...copy })).toThrow(/not an object the evaluation published/);
    eitherFrees(engine, 'mn/1', 'ms/1', []);
  });

  it('only one of the two went through a mirror: a mirrored stud in a left-hand nut; and a nut threaded through a mirror pattern of features (chord tolerance 0.05)', { timeout: 120_000 }, async () => {
    await aTurn();
    const engine = coarse();
    run(engine, rod('stud', 20, 0, 5, 0, 20), thread('st', { body: 'stud', faces: [rodSide('stud')], modelled: true, ...M10, length: 14 }), bodyPattern('ms', 'stud', mirrorIn('YZ')), box('nut', -30, -10, -10, 10, 8, 16), hole('nh', [['h', -20, 0]], 10 - 2 * 0.811899 + 0.4, 'nut'), thread('nt', { body: 'nut', faces: [bore('nh', 'h')], modelled: true, ...M10, hand: 'left', clearance: 0.2, phase: 0.4 }));
    eitherFrees(engine, 'ms/1', 'nut', []);
    const copies = coarse();
    run(copies, rod('stud', -20, 0, 5, 0, 20), thread('st', { body: 'stud', faces: [rodSide('stud')], modelled: true, ...M10, length: 14 }), box('nut', -30, -10, 30, 10, 8, 16), hole('nh', [['h', 20, 0]], 10 - 2 * 0.811899 + 0.4, 'nut'), { type: 'addFeature', feature: { id: 'mf', name: 'mf', suppressed: false, type: 'pattern', source: { type: 'features', features: ['nh'] }, transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } } } as Command, thread('nt', { body: 'nut', faces: [bore('nh', 'h')], copies: true, modelled: true, ...M10, clearance: 0.2, phase: 0.4 }));
    eitherFrees(copies, 'nut', 'stud', []);
  });

  it('a modelled thread excuses a plain rod and a cosmetic thread; the flag changes the mesh and nothing else', async () => {
    await aTurn();
    const engine = newEngine();
    studAndNut(engine);
    const plainRod = preview(engine, { type: 'setSuppressed', id: 'st', suppressed: true } as Command);
    expect(interference(engine, ['stud', 'nut'], plainRod)).toMatchObject({ pairs: [], threaded: [{ a: 'nut', b: 'stud' }] });
    const cosmeticStud = preview(engine, { type: 'updateFeature', id: 'st', patch: { modelled: false } } as Command);
    expect(interference(engine, ['stud', 'nut'], cosmeticStud)).toMatchObject({ pairs: [], threaded: [{ a: 'nut', b: 'stud' }] });
    expect(cosmeticStud.evaluation.bodies.stud.volume).toBe(engine.getState('nh').evaluation.bodies.stud.volume);
    expect(threadsOf(cosmeticStud, 'st')[0].modelled).toBe(false);
  });
});

describe('measured (design.md, "Performance")', () => {
  it('M10x1.5 20 long at 0.01, eight M8 in one boolean, a lid thread 40 x 4: the triangles and the times', async () => {
    await aTurn();
    const rows: string[] = [];
    const engine = newEngine();
    run(engine, rod('pin', 0, 0, 5, 0, 20));
    const [m10, m10ms] = timed(() => run(engine, thread('pt', { body: 'pin', faces: [rodSide('pin')], modelled: true, ...M10 })));
    expect(statusOf(m10, 'pt')).toBe('ok');
    rows.push(`M10x1.5 x 20 pin: tool ${m10.evaluation.features.pt.facts?.triangles} triangles (counted), the body ${m10.evaluation.bodies.pin.solid.triangles.length / 3} triangles, ${m10ms.toFixed(0)} ms`);
    const plate = newEngine();
    const points: [string, number, number][] = Array.from({ length: 8 }, (_, i) => [`p${i}`, -42 + 12 * i, 0]);
    run(plate, box('plate', -50, -10, 50, 10, 0, 10), hole('h', points, 6.8, 'plate'));
    const [eight, eightMs] = timed(() => run(plate, thread('t', { body: 'plate', faces: points.map(([p]) => bore('h', p)), modelled: true, diameter: 8, pitch: 1.25, hand: 'right', direction: 'backward' })));
    expect(statusOf(eight, 't')).toBe('ok');
    rows.push(`eight M8x1.25 through 10: tools ${eight.evaluation.features.t.facts?.triangles} triangles, ${eightMs.toFixed(0)} ms`);
    const lid = newEngine();
    run(lid, box('cap', -25, -25, 25, 25, 0, 20), blindHole('s', 0, 0, 40 - 2.5 + 0.6, 0, 15, 'cap'));
    const [lidState, lidMs] = timed(() => run(lid, thread('lt', { body: 'cap', faces: [bore('s', 'p')], modelled: true, diameter: 40, pitch: 4, flankAngle: Math.PI / 2, starts: 2, clearance: 0.3, hand: 'right', direction: 'forward' })));
    expect(statusOf(lidState, 'lt')).toBe('ok');
    rows.push(`lid 40 x 4, two starts, 90°, 15 deep: tool ${lidState.evaluation.features.lt.facts?.triangles} triangles, ${lidMs.toFixed(0)} ms`);
    // a screw in a nut, each modelled, at the default tolerance 0.01: the clearance of the nut
    for (const clearance of [0.2, 0.02]) {
      const pair = newEngine();
      run(pair, rod('stud', 0, 0, 5, 0, 20), box('nut', -10, -10, 10, 10, 8, 16), hole('nh', [['h', 0, 0]], 10 - 2 * 0.811899 + 2 * clearance, 'nut'), thread('st', { body: 'stud', faces: [rodSide('stud')], modelled: true, ...M10, length: 14 }), thread('nt', { body: 'nut', faces: [bore('nh', 'h')], modelled: true, ...M10, clearance, phase: (2 * Math.PI * 4) / 1.5 }));
      const [report, ms] = timed(() => interference(pair, ['stud', 'nut']));
      rows.push(`an M10 screw in a nut with the clearance ${clearance}: ${report.pairs.length} collisions, ${report.fits.length} fits, ${ms.toFixed(0)} ms`);
      expect(report).toMatchObject({ pairs: [], fits: [], failed: [] });
    }
    console.log(rows.join('\n'));
  });
});

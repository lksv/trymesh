// A round bowl and its screw-on lid with modelled threads (D76), against the real adapters: what
// a trial of the threads on a whole model found (2026-11-28). The bowl is a cylinder 80 across and
// 40 high with its outer wall threaded 12 down from the rim; the lid is a cap whose socket, 10
// deep, is seated with its ceiling on the rim. Printed proportions: 80 x 3, two starts, flanks at
// 90°, the clearance 0.3 on the lid, whose socket is the minor diameter and twice the clearance.
// Each test starts with a turn of the event loop, as the tests of thread-mate.test.ts do.
import type { Command, EngineState, Id } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { newEngine, run } from './kit';
import { aTurn, rod, rodSide, thread, threadsOf, top } from './thread-kit';

type Engine = ReturnType<typeof newEngine>;
const LEAD = 6;
const DEPTH = (5 * 3) / 16;
const common = { diameter: 80, pitch: 3, flankAngle: 'deg(90)', starts: 2, hand: 'right', direction: 'backward', modelled: true } as const;
const interference = (engine: Engine, bodies: Id[]) => {
  const outcome = engine.query('interference', { bodies });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result;
};
const gap = (engine: Engine, bodies: Id[]) => {
  const outcome = engine.query('gap', { bodies });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result;
};
// The bowl and the lid, the lid lifted by `lift` and its thread turned to `lidPhase(z)`, with z
// the height the helix of the bowl starts at; `leadIn` chamfers the rim of the bowl before its thread.
function bowlAndLid(engine: Engine, leadIn: number, lift: number, lidPhase: (bowlStart: number) => number): EngineState {
  run(
    engine,
    rod('bowl', 0, 0, 40, 0, 40),
    rod('pocket', 0, 0, 37, 3, 40, 'cut', 'bowl'),
    rod('lid', 0, 0, 44, 30 + lift, 43 + lift),
    rod('socket', 0, 0, 40 - DEPTH + 0.3, 30 + lift, 40 + lift, 'cut', 'lid'),
    ...(leadIn > 0 ? [{ type: 'addFeature', feature: { id: 'leadIn', name: 'leadIn', suppressed: false, type: 'chamfer', body: 'bowl', edges: [{ a: top('bowl'), b: rodSide('bowl') }], distance: leadIn } } as Command] : []),
  );
  const state = run(engine, thread('bowlThread', { body: 'bowl', faces: [rodSide('bowl')], ...common, length: 12 }));
  const bowlStart = threadsOf(state, 'bowlThread')[0].origin[2];
  return run(engine, thread('lidThread', { body: 'lid', faces: [rodSide('socket')], ...common, clearance: 0.3, phase: lidPhase(bowlStart) }));
}
// The phase of the lid's thread, which starts at its ceiling `ceiling` high and runs down as the
// bowl's does from `bowlStart`: the bowl's origin is `ceiling − bowlStart` further along.
const seated = (ceiling: number) => (bowlStart: number) => (-2 * Math.PI * (ceiling - bowlStart)) / LEAD;

describe('a bowl and its screw-on lid', () => {
  it('seated on the plain rim, the lid meets the ring its thread leaves under the ceiling: a collision the lift deep, with nothing to add to a phase, whose entry names the ring', { timeout: 120_000 }, async () => {
    await aTurn();
    const engine = newEngine();
    const state = bowlAndLid(engine, 0, 0, seated(40));
    // both helices start in the plane of the rim: one curve
    expect(threadsOf(state, 'bowlThread')[0].origin[2]).toBeCloseTo(40, 6);
    expect(threadsOf(state, 'lidThread')[0].ends).toEqual({ start: 'shoulder', end: 'open' });
    const report = interference(engine, ['bowl', 'lid']);
    expect(report.pairs).toHaveLength(1);
    // the groove of the socket stops the lift (0.05) short of the ceiling; the ridges of the bowl run to the rim
    expect(report.pairs[0].depth).toBeGreaterThan(0.04);
    expect(report.pairs[0].depth).toBeLessThan(0.06);
    expect(report.pairs[0].volume).toBeLessThan(5);
    expect(report.pairs[0].seat?.map((entry) => Math.abs(entry.addToPhase) < 1e-6)).toEqual([true, true]);
    // the entry names the cause: the ring of the lid's thread under its ceiling, where the bowl's wall stands
    expect(report.pairs[0].shortOfShoulder).toEqual([{ feature: 'lidThread', face: rodSide('socket'), end: 'start', height: 0.05, mate: { feature: 'bowlThread', face: rodSide('bowl') } }]);
  });

  it('with a lead-in chamfer on the rim, placed before the thread, the helix of the bowl starts lower; seated by that distance the lid is free and touches', { timeout: 120_000 }, async () => {
    await aTurn();
    const engine = newEngine();
    const state = bowlAndLid(engine, 1, 0, seated(40));
    const [bowl] = threadsOf(state, 'bowlThread');
    // the wall ends where the chamfer starts (read from the mesh: within the chord tolerance of it)
    expect(Math.abs(bowl.origin[2] - 39)).toBeLessThan(0.02);
    expect(bowl.ends.start).toBe('open');
    expect(bowl.runOut.start).toBeGreaterThan(0.5);
    expect(interference(engine, ['bowl', 'lid'])).toMatchObject({ pairs: [], fits: [], failed: [] });
    expect(gap(engine, ['bowl', 'lid']).pairs[0]).toMatchObject({ distance: 0, contact: 'touching' });
  });

  it('unscrewed along the helix (lifted a quarter of the lead and turned a quarter of a turn) the lid stays free', { timeout: 120_000 }, async () => {
    await aTurn();
    const engine = newEngine();
    // the thread of the lid is anchored at its ceiling and rises with it; the phase follows the lift
    bowlAndLid(engine, 1, LEAD / 4, seated(40 + LEAD / 4));
    expect(interference(engine, ['bowl', 'lid'])).toMatchObject({ pairs: [], fits: [], failed: [] });
  });
});

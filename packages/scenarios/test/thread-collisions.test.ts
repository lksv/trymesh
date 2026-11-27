// Threads in the check of collisions (D76, stage 1) against the real adapters: what a cosmetic
// thread excuses (`threaded`), what is still judged (the rest of the pair), when two threads have
// to agree (`mismatch`), the pairs in a pose and the contact `threaded` of the smallest gap.
import type { Command, Engine, EngineState, Id, InterferenceReport } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, newEngine, run } from './kit';
import { blindHole, bodyPattern, bore, box, combine, hole, m6, prism, rod, rodSide, statusOf, thread, threadsOf } from './thread-kit';

interface Seen {
  pairs: [Id, Id, number, string | undefined][];
  fits: [Id, Id][];
  threaded: [Id, Id, number, string[]][];
}
function seen(engine: Engine, bodies?: Id[], state?: EngineState): Seen {
  const outcome = engine.query('interference', bodies ? { bodies } : {}, state ? { state } : {});
  if (!outcome.ok) throw new Error(outcome.error.message);
  const report: InterferenceReport = outcome.result;
  expect(report.failed).toEqual([]);
  return {
    pairs: report.pairs.map((p) => [p.a, p.b, Number(p.volume.toFixed(1)), p.mismatch]),
    fits: report.fits.map((p) => [p.a, p.b]),
    threaded: (report.threaded ?? []).map((t) => [t.a, t.b, Number(t.volume.toFixed(1)), t.threads.map((x) => `${x.feature}@${x.body}`)]),
  };
}
// Built in a new engine; every feature ok; the report the same whichever body is named first.
function check(...commands: Command[]): Seen {
  const engine = newEngine();
  const state = run(engine, ...commands);
  for (const id of Object.keys(state.evaluation.features)) expect(statusOf(state, id), id).toBe('ok');
  const all = seen(engine);
  const ids = Object.keys(state.evaluation.bodies);
  if (ids.length === 2) {
    const strip = (s: Seen) => JSON.stringify({ ...s, threaded: s.threaded.map(([a, b, v, t]) => [a, b, v, [...t].sort()]) });
    expect(strip(seen(engine, [ids[1], ids[0]]))).toEqual(strip(all));
  }
  return all;
}
// The volume of the annulus of a thread of the nominal diameter `d` in a bore of `bore`, `length` long.
const annulus = (d: number, bore: number, length: number) => Number(((Math.PI / 4) * (d * d - bore * bore) * length).toFixed(1));
const tapped = (): Command[] => [box('plate', -10, -10, 10, 10, 0, 8), hole('taps', [['h', 0, 0]], 5, 'plate'), thread('m6', m6('plate', [bore('taps', 'h')]))];

describe('a body in a cosmetic thread', () => {
  it('a plain rod of the nominal diameter through a tapped hole is threaded alone; without the thread it is a collision', () => {
    const plain = check(box('plate', -10, -10, 10, 10, 0, 8), hole('taps', [['h', 0, 0]], 5, 'plate'), rod('bolt', 0, 0, 3, -2, 10));
    expect(plain.pairs.map(([a, b]) => [a, b])).toEqual([['bolt', 'plate']]);
    expect(plain.threaded).toEqual([]);
    const result = check(...tapped(), rod('bolt', 0, 0, 3, -2, 10));
    expect(result).toEqual({ pairs: [], fits: [], threaded: [['bolt', 'plate', expect.closeTo(annulus(6, 5, 8), 0), ['m6@plate']]] });
  });

  it('a seated head, a head in a counterbore (a fit beside the thread), a rod on a blind bottom', () => {
    expect(check(...tapped(), rod('bolt', 0, 0, 3, -2, 8), rod('head', 0, 0, 5, 8, 12, 'add', 'bolt'))).toMatchObject({ pairs: [], fits: [], threaded: [['bolt', 'plate', expect.any(Number), ['m6@plate']]] });
    const counterbore = check(
      box('plate', -10, -10, 10, 10, 0, 8),
      hole('taps', [['h', 0, 0]], 5, 'plate', 'forward', XY, { type: 'counterbore', diameter: 5, headDiameter: 10, headDepth: 3 }),
      thread('m6', m6('plate', [bore('taps', 'h')])),
      rod('bolt', 0, 0, 5.005, 0, 3),
      rod('shank', 0, 0, 3, 3, 8, 'add', 'bolt'),
    );
    expect(counterbore).toEqual({ pairs: [], fits: [['bolt', 'plate']], threaded: [['bolt', 'plate', expect.closeTo(annulus(6, 5, 5), 0), ['m6@plate']]] });
    const blind = (bottom: number) => check(box('block', -10, -10, 10, 10, 0, 10), blindHole('blind', 0, 0, 5, 10, -6, 'block'), thread('m6', m6('block', [bore('blind', 'p')])), rod('bolt', 0, 0, 3, bottom, 14));
    expect(blind(4)).toMatchObject({ pairs: [], threaded: [['block', 'bolt', expect.any(Number), ['m6@block']]] });
    // half a millimetre too long for the blind bore: its end is left, a collision (less the lift
    // the ring reaches into the shoulder, 0.05 deep from the radius 2.45 out)
    const long = blind(3.5);
    expect(long.pairs).toEqual([['block', 'bolt', expect.closeTo(Math.PI * 9 * 0.5 - Math.PI * (9 - 2.45 ** 2) * 0.05, 0), undefined]]);
    expect(long.threaded).toEqual([]);
  });

  it('a rod thicker than the major diameter, a rod that misses the hole, a key pushed into the thread from one side', () => {
    const thick = check(...tapped(), rod('bolt', 0, 0, 3.2, -2, 10));
    // what lies beyond the root of the thread: below the annulus from 6 to 6.4 (the ring reaches
    // past the root by the chord tolerance, and the rod is a polygon inside its circle)
    expect(thick.pairs).toEqual([['bolt', 'plate', expect.any(Number), undefined]]);
    expect(thick.pairs[0][2]).toBeGreaterThan(0.85 * annulus(6.4, 6, 8));
    expect(thick.pairs[0][2]).toBeLessThan(annulus(6.4, 6, 8));
    expect(thick.threaded).toEqual([]);
    expect(check(...tapped(), rod('bolt', 20, 0, 3, -2, 10))).toEqual({ pairs: [], fits: [], threaded: [] });
    const key = check(...tapped(), box('key', 2.6, -1, 4, 1, 0, 8));
    expect(key.pairs.map(([a, b]) => [a, b])).toEqual([['key', 'plate']]);
    expect(key.threaded).toEqual([]);
  });

  it('a pin cut short is threaded where it still is; a pin made longer after its thread collides with the part added', () => {
    const plate = (): Command[] => [box('plate', -10, -10, 10, 10, 0, 16), hole('plain', [['h', 0, 0]], 5, 'plate')];
    const short = check(rod('pin', 0, 0, 3, 0, 20), thread('pt', m6('pin', [rodSide('pin')])), box('short', -5, -5, 5, 5, 10, 21, 'cut', 'pin'), ...plate());
    expect(short).toMatchObject({ pairs: [], threaded: [['pin', 'plate', expect.any(Number), ['pt@pin']]] });
    const longer = check(rod('pin', 0, 0, 3, 0, 10), thread('pt', m6('pin', [rodSide('pin')])), rod('more', 0, 0, 3, 10, 20, 'add', 'pin'), ...plate());
    expect(longer.pairs).toEqual([['pin', 'plate', expect.any(Number), undefined]]);
    expect(longer.pairs[0][2]).toBeGreaterThan(0.95 * annulus(6, 5, 6));
    expect(longer.pairs[0][2]).toBeLessThan(annulus(6, 5, 6));
  });

  it('one body in two threaded bores (a U-bolt): both zones are taken', () => {
    const result = check(
      box('plate', -10, -10, 30, 10, 0, 8),
      hole('taps', [['h', 0, 0], ['k', 20, 0]], 5, 'plate'),
      thread('m6', m6('plate', [bore('taps', 'h'), bore('taps', 'k')])),
      rod('u', 0, 0, 3, -2, 12),
      rod('leg', 20, 0, 3, -2, 12, 'add', 'u'),
      box('bridge', -3, -3, 23, 3, 12, 15, 'add', 'u'),
    );
    expect(result).toEqual({ pairs: [], fits: [], threaded: [['plate', 'u', expect.closeTo(2 * annulus(6, 5, 8), 0), ['m6@plate', 'm6@plate']]] });
  });

  it('a half shell around a threaded pin goes around; a jaw of 100° does not', () => {
    const pin = (): Command[] => [rod('pin', 0, 0, 3, 0, 20), thread('pt', m6('pin', [rodSide('pin')])), rod('shell', 0, 0, 6, 5, 15), hole('sb', [['q', 0, 0]], 5.2, 'shell')];
    expect(check(...pin(), box('halfcut', -7, -7, 0, 7, 0, 20, 'cut', 'shell'))).toMatchObject({ pairs: [], threaded: [['pin', 'shell', expect.any(Number), ['pt@pin']]] });
    const t = 10 * Math.tan((50 * Math.PI) / 180);
    const jaw = check(...pin(), prism('wedge', XY, [[0, 0], [10, -t], [10, t]], 0, 20), combine('jaw', 'intersection', 'shell', ['wedge']));
    expect(jaw.pairs.map(([a, b]) => [a, b])).toEqual([['pin', 'shell']]);
    expect(jaw.threaded).toEqual([]);
  });

  it('the answer changes when a thread is added to an unchanged mesh', () => {
    const engine = newEngine();
    run(engine, box('plate', -10, -10, 10, 10, 0, 8), hole('taps', [['h', 0, 0]], 5, 'plate'), rod('bolt', 0, 0, 3, -2, 10));
    expect(seen(engine).pairs).toHaveLength(1);
    run(engine, thread('m6', m6('plate', [bore('taps', 'h')])));
    expect(seen(engine)).toMatchObject({ pairs: [], threaded: [['bolt', 'plate', expect.any(Number), ['m6@plate']]] });
  });
});

describe('two threads', () => {
  const bolt = (more = {}, x = 0): Command[] => [rod('bolt', x, 0, 3, -2, 10), thread('bt', m6('bolt', [rodSide('bolt')], more))];
  it('agreeing: both named, the larger volume counted once', () => {
    expect(check(...tapped(), ...bolt())).toEqual({ pairs: [], fits: [], threaded: [['bolt', 'plate', expect.closeTo(annulus(6, 5, 8), 0), ['bt@bolt', 'm6@plate']]] });
  });

  it('disagreeing in a field of the rule, off the axis or leaning: judged whole, with what differs', () => {
    const mismatch = (...commands: Command[]) => {
      const result = check(...commands);
      expect(result.threaded).toEqual([]);
      expect(result.pairs).toHaveLength(1);
      return result.pairs[0][3];
    };
    expect(mismatch(...tapped(), rod('bolt', 0, 0, 3, -2, 10), thread('bt', { ...m6('bolt', [rodSide('bolt')]), pitch: 1.25 }))).toBe('pitch 1.25 against 1, depth 0.677 against 0.541');
    expect(mismatch(...tapped(), ...bolt({ hand: 'left' }))).toBe('a right-hand thread in a left-hand one');
    expect(mismatch(...tapped(), ...bolt({ starts: 2 }))).toMatch(/starts/);
    expect(mismatch(...tapped(), ...bolt({ flankAngle: Math.PI / 2 }))).toMatch(/flanks at 90° against 60°/);
    expect(mismatch(...tapped(), ...bolt({}, 0.3))).toBe('the axes are 0.3 apart');
    // a plain rod 0.3 off the axis: the zone is taken, the rest collides; the pair is in pairs alone
    const plain = check(...tapped(), rod('bolt', 0.3, 0, 3, -2, 10));
    expect([plain.pairs.length, plain.threaded.length]).toEqual([1, 0]);
    // leaning: the copy of the bolt turned by 0.01 about X through the mouth
    const engine = newEngine();
    run(engine, ...tapped(), ...bolt(), bodyPattern('lean', 'bolt', { type: 'circular', axis: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'angle', angle: 0.01 } }));
    const lean = seen(engine, ['plate', 'lean/1']);
    expect(lean.threaded).toEqual([]);
    expect(lean.pairs[0][3]).toBe('the axes meet at 0.573°');
  });

  it('two stretches of one line, a bushing threaded inside and out, two tapped holes side by side each with its screw', () => {
    // the plate threaded on its lower half, the bolt only on its upper half: each zone meets the plain part of the other
    expect(
      check(box('plate', -10, -10, 10, 10, 0, 8), hole('taps', [['h', 0, 0]], 5, 'plate'), thread('m6', m6('plate', [bore('taps', 'h')], { direction: 'forward', length: 4 })), rod('bolt', 0, 0, 2.6, -2, 10), rod('top', 0, 0, 3, 4, 10, 'add', 'bolt'), thread('bt', m6('bolt', [rodSide('top')], { direction: 'forward' }))),
    ).toMatchObject({ pairs: [], threaded: [['bolt', 'plate', expect.any(Number), ['bt@bolt', 'm6@plate']]] });
    const bushing = check(
      box('plate', -15, -15, 15, 15, 0, 8),
      hole('taps', [['h', 0, 0]], 8.4, 'plate'),
      thread('m10', { ...m6('plate', [bore('taps', 'h')]), diameter: 10, pitch: 1.5 }),
      rod('bush', 0, 0, 5, 0, 8),
      hole('inner', [['i', 0, 0]], 5, 'bush'),
      thread('outer', { ...m6('bush', [rodSide('bush')]), diameter: 10, pitch: 1.5 }),
      thread('in', m6('bush', [bore('inner', 'i')])),
      rod('screw', 0, 0, 3, -2, 10),
    );
    expect(bushing).toEqual({ pairs: [], fits: [], threaded: [['bush', 'plate', expect.any(Number), ['outer@bush', 'm10@plate']], ['bush', 'screw', expect.any(Number), ['in@bush']]] });
    const sideBySide = check(
      box('plate', -10, -10, 30, 10, 0, 8),
      hole('taps', [['h', 0, 0], ['k', 8, 0]], 5, 'plate'),
      thread('m6', m6('plate', [bore('taps', 'h'), bore('taps', 'k')])),
      rod('s1', 0, 0, 3, -2, 10),
      thread('t1', m6('s1', [rodSide('s1')])),
      rod('s2', 8, 0, 3, -2, 10),
      thread('t2', m6('s2', [rodSide('s2')])),
    );
    expect(sideBySide).toMatchObject({ pairs: [], threaded: [['plate', 's1', expect.any(Number), ['m6@plate', 't1@s1']], ['plate', 's2', expect.any(Number), ['m6@plate', 't2@s2']]] });
  });
});

describe('in a pose', () => {
  it('a bolt modelled above the plate and moved into it by a joint: threaded in the pose, apart as modelled; its datum is posed', () => {
    const engine = newEngine();
    run(
      engine,
      ...tapped(),
      rod('bolt', 0, 0, 3, 28, 40),
      thread('bt', m6('bolt', [rodSide('bolt')])),
      { type: 'setLink', id: 'plate', bodies: ['plate'] },
      { type: 'setLink', id: 'bolt', bodies: ['bolt'] },
      { type: 'setJoint', id: 'j', joint: { type: 'prismatic', parent: 'plate', child: 'bolt', axis: { kind: 'base', axis: 'Z' }, lower: -50, upper: 50, value: 0 } } as Command,
    );
    expect(seen(engine)).toEqual({ pairs: [], fits: [], threaded: [] });
    const posed = engine.preview({ type: 'setPose', values: { j: -30 } });
    if (!posed.ok) throw new Error(posed.error.message);
    expect(seen(engine, undefined, posed.state)).toEqual({ pairs: [], fits: [], threaded: [['bolt', 'plate', expect.closeTo(annulus(6, 5, 8), 0), ['bt@bolt', 'm6@plate']]] });
    const body = engine.query('body', { body: 'bolt' }, { state: posed.state });
    if (!body.ok) throw new Error(body.error.message);
    const near = (v: number[]) => v.map((x) => expect.closeTo(x, 9));
    expect(body.result.threads?.[0]).toMatchObject({ origin: near([0, 0, 10]), axis: near([0, 0, -1]), zero: near([1, 0, 0]) });
    expect(threadsOf(posed.state, 'bt')[0].origin[2]).toBeCloseTo(40, 5); // the evaluation stays as modelled
  });

  it('a bolt turned by a revolute joint: the zero of its datum turns with it', () => {
    const engine = newEngine();
    run(
      engine,
      ...tapped(),
      rod('bolt', 0, 0, 3, -2, 10),
      thread('bt', m6('bolt', [rodSide('bolt')])),
      { type: 'setLink', id: 'plate', bodies: ['plate'] },
      { type: 'setLink', id: 'bolt', bodies: ['bolt'] },
      { type: 'setJoint', id: 'j', joint: { type: 'revolute', parent: 'plate', child: 'bolt', axis: { kind: 'base', axis: 'Z' }, lower: -4, upper: 4, value: 0 } } as Command,
    );
    const posed = engine.preview({ type: 'setPose', values: { j: 0.5 } });
    if (!posed.ok) throw new Error(posed.error.message);
    const body = engine.query('body', { body: 'bolt' }, { state: posed.state });
    if (!body.ok) throw new Error(body.error.message);
    expect(body.result.threads?.[0].zero).toEqual([expect.closeTo(Math.cos(0.5), 9), expect.closeTo(Math.sin(0.5), 9), expect.closeTo(0, 9)]);
    // turned about its own axis the bolt stays in its thread
    expect(seen(engine, undefined, posed.state)).toMatchObject({ pairs: [], threaded: [['bolt', 'plate', expect.any(Number), ['bt@bolt', 'm6@plate']]] });
  });
});

describe('the smallest gap', () => {
  it('a set screw inside its tapped bore touches by its thread: the contact threaded', () => {
    const engine = newEngine();
    run(engine, ...tapped(), rod('screw', 0, 0, 3, 2, 6));
    const outcome = engine.query('gap', {});
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.result.pairs).toEqual([{ a: 'plate', b: 'screw', distance: 0, contact: 'threaded' }]);
    // without the thread the same pair is a collision
    run(engine, { type: 'removeFeature', id: 'm6' } as Command);
    const plain = engine.query('gap', {});
    if (!plain.ok) throw new Error(plain.error.message);
    expect(plain.result.pairs).toEqual([{ a: 'plate', b: 'screw', distance: 0, contact: 'collision' }]);
  });
});

describe('far from the origin, askew', () => {
  // "To verify" 1 of the design: a blind bore tapped M6 with a seated bolt on its bottom, both bodies
  // turned about X and Y and moved 500 mm away by patterns of the body (the threads carried by
  // them). 120 such poses from 5 to 500 mm were all threaded, none refused (As implemented).
  it('a seated bolt on a blind bottom stays threaded alone', () => {
    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 2; i++) {
      const [ax, ay] = [random() * 2 * Math.PI, random() * 2 * Math.PI];
      const posed = (b: Id): Command[] => [
        bodyPattern(`${b}X`, b, { type: 'circular', axis: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'angle', angle: ax } }),
        bodyPattern(`${b}Y`, `${b}X/1`, { type: 'circular', axis: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'angle', angle: ay } }),
        bodyPattern(`${b}F`, `${b}Y/1`, { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: 400 }, second: { direction: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'spacing', spacing: 300 } } }),
      ];
      const engine = newEngine();
      run(engine, box('block', -10, -10, 10, 10, 0, 10), blindHole('blind', 0, 0, 5, 10, -6, 'block'), thread('m6', m6('block', [bore('blind', 'p')])), rod('bolt', 0, 0, 3, 4, 10), rod('head', 0, 0, 5, 10, 13, 'add', 'bolt'), ...posed('block'), ...posed('bolt'));
      expect(seen(engine, ['blockF/1001', 'boltF/1001'])).toEqual({ pairs: [], fits: [], threaded: [['blockF/1001', 'boltF/1001', expect.any(Number), ['m6@blockF/1001']]] });
    }
  });
});

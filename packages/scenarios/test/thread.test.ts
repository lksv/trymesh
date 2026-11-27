// Threads (D76, stage 1: cosmetic) against the real adapters: the walls, the ends and their
// run-outs, the window and the flat, every refusal, the copies and the datum, the records through
// later features, the warning of a mirror, the parts list. The check of collisions is in
// thread-collisions.test.ts.
import { type AxisRef, type Command, type Document, type EngineState, type FaceName, type SketchFeature, type ThreadFeature, type ThreadResult, freshIds, sketchTool } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addSketch, batch, circle, constrain, dimension, newEngine, run } from './kit';
import { along, blindHole, bodyPattern, bore, box, chamfer, combine, dot, featurePattern, fillet, helixPoint, hole, m6, mirrorIn, offHelix, plane, prism, rod, rodSide, split, statusOf, thread, threadsOf, top, turnAbout } from './thread-kit';

const end = (kind: string, runOut = 0) => ({ kind, runOut });
const ends = (t: ThreadResult) => ({ start: end(t.ends.start, t.runOut.start), end: end(t.ends.end, t.runOut.end) });
const near = (expected: number, digits = 3) => expect.closeTo(expected, digits);

describe('the wall of a thread', () => {
  it('a bore and a pin: the side read from the body, the radius of the wall, the mesh left as it was', () => {
    const engine = newEngine();
    const before = run(engine, box('plate', 0, 0, 60, 30, 0, 8), hole('taps', [['h1', 10, 10], ['h2', 10, 20]], 5, 'plate'), rod('pin', 40, 15, 3, 0, 20));
    const state = run(engine, thread('m6', m6('plate', [bore('taps', 'h1'), bore('taps', 'h2')], { direction: 'forward' })), thread('pinThread', m6('pin', [rodSide('pin')])));
    expect([statusOf(state, 'm6'), statusOf(state, 'pinThread')]).toEqual(['ok', 'ok']);
    expect(state.evaluation.bodies.plate.solid).toBe(before.evaluation.bodies.plate.solid);
    const [h1, h2] = threadsOf(state, 'm6');
    for (const t of [h1, h2]) {
      expect(t).toMatchObject({ internal: true, modelled: false, radius: near(2.5, 9), bodies: ['plate'], from: 0, to: near(8, 5), hand: 'right', starts: 1, clearance: 0, flankAngle: near(Math.PI / 3, 12) });
      expect(t.depth).toBeCloseTo((5 * 1) / (16 * Math.tan(Math.PI / 6)), 12);
      expect(t.axis[2]).toBeCloseTo(1, 12);
      expect(t.origin[2]).toBeCloseTo(0, 5);
      expect(t.walls).toEqual([{ from: near(0, 5), to: near(8, 5) }]);
    }
    const [pin] = threadsOf(state, 'pinThread');
    // backward: from the top of the pin down
    expect(pin).toMatchObject({ internal: false, radius: near(3, 9), from: 0, to: near(20, 5) });
    expect(pin.axis[2]).toBeCloseTo(-1, 12);
    expect(pin.origin[2]).toBeCloseTo(20, 5);
    expect(ends(pin)).toEqual({ start: end('open'), end: end('open') });
    expect(state.evaluation.features.m6.facts).toMatchObject({ threads: 2, lead: 1, depth: near(0.541266, 6), minorDiameter: near(6 - 2 * 0.541266, 6), crestFlat: near(1 / 8, 12), rootFlat: near(1 / 4, 12) });
  });

  it('a face in two pieces is one wall from its first point to its last', () => {
    const engine = newEngine();
    // two plates joined by a wall at one side, one hole through both
    const state = run(engine, box('base', 0, 0, 30, 30, 0, 4), box('wall', 0, 0, 5, 30, 4, 10, 'add', 'base'), box('roof', 0, 0, 30, 30, 10, 14, 'add', 'base'), hole('taps', [['h', 20, 15]], 5, 'base'), thread('m6', m6('base', [bore('taps', 'h')], { direction: 'forward' })));
    expect(statusOf(state, 'm6')).toBe('ok');
    const [t] = threadsOf(state, 'm6');
    expect(t).toMatchObject({ from: 0, to: near(14, 5), walls: [{ from: near(0, 5), to: near(14, 5) }] });
    expect(ends(t)).toEqual({ start: end('open'), end: end('open') });
  });

  it('a bore crossed by a hole passes; a part of a cylinder does not (a rounded corner, a slit along the whole bore)', () => {
    const engine = newEngine();
    run(engine, box('plate', 0, 0, 30, 30, 0, 10), hole('taps', [['h', 15, 15]], 5, 'plate'));
    // a cross hole along X through the bore, from a sketch on YZ
    run(engine, hole('cross', [['c', 15, 5]], 2, 'plate', 'forward', { kind: 'base', plane: 'YZ' }));
    let state = run(engine, thread('m6', m6('plate', [bore('taps', 'h')], { direction: 'forward' })));
    expect(statusOf(state, 'm6')).toBe('ok');
    // a slit along the whole bore: cut after the thread, the thread stays; cut before it, it is refused
    state = run(engine, box('slit', 15, 14.5, 31, 15.5, -1, 11, 'cut', 'plate'));
    expect(statusOf(state, 'm6')).toBe('ok');
    state = run(engine, { type: 'moveFeature', id: 'm6', index: state.document.features.length - 1 });
    expect(statusOf(state, 'm6')).toBe('error:invalidThread');
    expect(state.evaluation.features.m6.error?.message).toMatch(/only a part of a cylinder.*cut a slit after the thread/);
    // a rounded corner of a box: a fillet of a straight edge
    const corner = newEngine();
    const rounded = run(corner, box('b', 0, 0, 20, 20, 0, 10), fillet('round', 'b', [{ a: { feature: 'b', role: 'side', curve: 'bra' }, b: { feature: 'b', role: 'side', curve: 'brb' } }], 3), thread('t', m6('b', [{ feature: 'round', role: 'fillet', edge: 0 }])));
    expect(statusOf(rounded, 'round')).toBe('ok');
    expect(statusOf(rounded, 't')).toBe('error:invalidThread');
    expect(rounded.evaluation.features.t.error?.refs).toEqual([{ feature: 'round', role: 'fillet', edge: 0 }]);
  });

  it('a face the body has both as a bore and as a pin is refused', () => {
    const engine = newEngine();
    // a rod cut out of a block with the tool kept, the rod split and its lower part joined to the
    // block: the side of the rod is a pin below the block and a bore in it
    const state = run(
      engine,
      rod('r', 0, 0, 3, 0, 20),
      box('block', -10, -10, 10, 10, 10, 20),
      combine('cutOut', 'difference', 'block', ['r'], true),
      plane('mid', 'XY', 10),
      split('cutRod', 'r', { kind: 'plane', feature: 'mid' }, 'forward'),
      combine('joined', 'union', 'block', ['r']),
      thread('t', m6('block', [rodSide('r')])),
    );
    expect(statusOf(state, 'joined')).toBe('ok');
    expect(statusOf(state, 't')).toBe('error:invalidThread');
    expect(state.evaluation.features.t.error?.message).toMatch(/both as a bore and as a pin/);
  });
});

describe('the face against the thread: the window, the clearance and the flat on the wall', () => {
  const pinWith = (radius: number, clearance: number) => {
    const engine = newEngine();
    return run(engine, rod('pin', 0, 0, radius, 0, 10), thread('t', { ...m6('pin', [rodSide('pin')]), diameter: 10, pitch: 1.5, clearance }));
  };
  it('a pin at the nominal diameter takes a clearance up to (P/8) / (2 tan 30°), not beyond; made at D − 2c it takes 0.2 with the full flat', () => {
    const largest = 1.5 / 8 / (2 * Math.tan(Math.PI / 6)); // 0.162
    expect(statusOf(pinWith(5, largest - 0.002), 't')).toBe('ok');
    const refused = pinWith(5, largest + 0.002);
    expect(statusOf(refused, 't')).toBe('error:invalidThread');
    expect(refused.evaluation.features.t.error?.message).toMatch(/leaves no crest.*make it a pin of 9\.6\d*.*below 0\.162/);
    expect(statusOf(pinWith(5 - 0.2, 0.2), 't')).toBe('ok');
  });
  it('a bore narrower than the minor diameter, a bore too wide, a pin too wide or too narrow', () => {
    const bore = (diameter: number, clearance = 0) => {
      const engine = newEngine();
      return run(engine, box('plate', 0, 0, 20, 20, 0, 8), hole('h', [['p', 10, 10]], diameter, 'plate'), thread('t', m6('plate', [{ feature: 'h', role: 'holeBore', point: 'p' }], { clearance })));
    };
    const minor = 6 - 2 * ((5 * 1) / (16 * Math.tan(Math.PI / 6)));
    expect(statusOf(bore(minor - 0.01), 't')).toBe('error:invalidThread');
    expect(bore(minor - 0.01).evaluation.features.t.error?.message).toMatch(/narrower than the minor diameter 4\.917/);
    expect(statusOf(bore(5), 't')).toBe('ok');
    // the bound for a bore: D − depth, moved by twice the clearance
    expect(statusOf(bore(6 - 0.541 - 0.01), 't')).toBe('ok');
    expect(statusOf(bore(6 - 0.541 + 0.01), 't')).toBe('error:invalidThread');
    expect(statusOf(bore(6 - 0.541 + 0.2, 0.15), 't')).toBe('ok');
    expect(statusOf(pinWith(5.01, 0), 't')).toBe('error:invalidThread');
    expect(statusOf(pinWith(5 - 0.65, 0), 't')).toBe('error:invalidThread');
  });
});

describe('where the thread is along its face', () => {
  const plate = () => {
    const engine = newEngine();
    run(engine, box('plate', 0, 0, 20, 20, 0, 8), hole('h', [['p', 10, 10]], 5, 'plate'));
    return engine;
  };
  const h = { feature: 'h', role: 'holeBore', point: 'p' } as FaceName;
  it('offset and length: the ends inside, the span as stated; an end within the lift of the end of the wall is at it', () => {
    const state = run(plate(), thread('t', m6('plate', [h], { direction: 'forward', offset: 2, length: 3 })));
    const [t] = threadsOf(state, 't');
    expect([t.from, t.to]).toEqual([2, 5]);
    expect(ends(t)).toEqual({ start: end('inside'), end: end('inside') });
    const close = run(plate(), thread('t', m6('plate', [h], { direction: 'forward', offset: 0.02, length: 7.97 })));
    const [c] = threadsOf(close, 't');
    expect([c.from, c.to]).toEqual([0.02, near(7.99, 9)]);
    expect(ends(c)).toEqual({ start: end('open'), end: end('open') });
  });
  it('past the far end, no length, a second thread over a part of one', () => {
    expect(statusOf(run(plate(), thread('t', m6('plate', [h], { length: 9 }))), 't')).toBe('error:invalidThread');
    expect(statusOf(run(plate(), thread('t', m6('plate', [h], { offset: 8 }))), 't')).toBe('error:invalidThread');
    const engine = plate();
    run(engine, thread('first', m6('plate', [h], { direction: 'forward', length: 4 })));
    // the other half of the same bore is fine, from either end; an overlap is not
    const other = run(engine, thread('second', m6('plate', [h], { direction: 'backward', length: 4 })));
    expect(statusOf(other, 'second')).toBe('ok');
    const overlap = run(engine, thread('third', m6('plate', [h], { direction: 'backward', length: 4.5 })));
    expect(statusOf(overlap, 'third')).toBe('error:invalidThread');
    expect(overlap.evaluation.features.third.error?.refs).toEqual([h, { feature: 'first' }]);
  });
});

describe('the ends of a wall, read from the mesh', () => {
  const m = (body: string, face: FaceName, more = {}) => m6(body, [face], { direction: 'forward', ...more });
  it('a plain hole, a countersink of 90° and of 60°, a counterbore', () => {
    const engine = newEngine();
    const state = run(
      engine,
      box('plate', 0, 0, 80, 20, 0, 8),
      hole('plain', [['a', 10, 10]], 5, 'plate'),
      hole('sunk', [['b', 30, 10]], 5, 'plate', 'forward', XY, { type: 'countersink', diameter: 5, headDiameter: 10, angle: Math.PI / 2 }),
      hole('sunk60', [['c', 50, 10]], 5, 'plate', 'forward', XY, { type: 'countersink', diameter: 5, headDiameter: 10, angle: Math.PI / 3 }),
      hole('bored', [['d', 70, 10]], 5, 'plate', 'forward', XY, { type: 'counterbore', diameter: 5, headDiameter: 10, headDepth: 3 }),
      thread('t1', m('plate', bore('plain', 'a'))),
      thread('t2', m('plate', bore('sunk', 'b'))),
      thread('t3', m('plate', bore('sunk60', 'c'))),
      thread('t4', m('plate', bore('bored', 'd'))),
    );
    expect(ends(threadsOf(state, 't1')[0])).toEqual({ start: end('open'), end: end('open') });
    // the heads are at the mouth, at z = 0 where the thread starts: the run-out through the cone to
    // the major diameter (within the facets of the cone)
    expect(ends(threadsOf(state, 't2')[0])).toEqual({ start: end('open', near(0.5 / Math.tan(Math.PI / 4), 1)), end: end('open') });
    expect(ends(threadsOf(state, 't3')[0])).toEqual({ start: end('open', near(0.5 / Math.tan(Math.PI / 6), 1)), end: end('open') });
    expect(ends(threadsOf(state, 't4')[0])).toEqual({ start: end('open'), end: end('open') });
  });

  it('a flat blind bottom, a flat free end, a chamfered tip, a pin on a foot, a pin with a filleted foot', () => {
    const engine = newEngine();
    const state = run(
      engine,
      box('block', 0, 0, 20, 20, 0, 10),
      blindHole('blind', 10, 10, 5, 10, -6, 'block'),
      rod('rod', 40, 0, 4, 0, 20),
      chamfer('tip', 'rod', [{ a: top('rod'), b: rodSide('rod') }], 1),
      box('foot', 60, -10, 80, 10, 0, 5),
      rod('neck', 70, 0, 4, 5, 15, 'add', 'foot'),
      box('base', 90, -10, 110, 10, 0, 5),
      rod('post', 100, 0, 4, 5, 15, 'add', 'base'),
      fillet('round', 'base', [{ a: top('base'), b: rodSide('post') }], 1),
      thread('blindT', m('block', bore('blind', 'p'), { direction: 'backward' })),
      thread('rodT', { ...m('rod', rodSide('rod')), diameter: 8, pitch: 1.25 }),
      thread('neckT', { ...m('foot', rodSide('neck')), diameter: 8, pitch: 1.25 }),
      thread('postT', { ...m('base', rodSide('post')), diameter: 8, pitch: 1.25 }),
    );
    for (const id of ['blind', 'tip', 'neck', 'round', 'blindT', 'rodT', 'neckT', 'postT']) expect(statusOf(state, id), id).toBe('ok');
    // the blind hole from its mouth (z = 10) down to its flat bottom (z = 4)
    expect(ends(threadsOf(state, 'blindT')[0])).toEqual({ start: end('open'), end: end('shoulder') });
    // the rod from its flat bottom up to the chamfer: the run-out is the depth of the thread
    const depth = (5 * 1.25) / (16 * Math.tan(Math.PI / 6));
    expect(ends(threadsOf(state, 'rodT')[0])).toEqual({ start: end('open'), end: end('open', near(depth, 1)) });
    expect(ends(threadsOf(state, 'neckT')[0])).toEqual({ start: end('shoulder'), end: end('open') });
    expect(ends(threadsOf(state, 'postT')[0])).toEqual({ start: end('shoulder'), end: end('open') });
  });

  it('a pin of two extrusions goes on under another name: inside; a rim partly open where it goes on is open; a rim partly at a shoulder is a shoulder', () => {
    const engine = newEngine();
    const state = run(
      engine,
      batch(addSketch('twoS', XY), circle('twoS', 'twoc', 0, 0, 4)),
      { type: 'addFeature', feature: { id: 'lower', name: 'lower', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'twoS', regions: [{ outerLoop: ['twoc'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
      { type: 'addFeature', feature: { id: 'upper', name: 'upper', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'twoS', regions: [{ outerLoop: ['twoc'] }] }, extent: { type: 'distance', start: 10, distance: 10 }, operation: 'add', targets: ['lower'] } },
      thread('lowerT', { ...m('lower', { feature: 'lower', role: 'side', curve: 'twoc' }), diameter: 8, pitch: 1.25 }),
      thread('upperT', { ...m('lower', { feature: 'upper', role: 'side', curve: 'twoc' }), diameter: 8, pitch: 1.25 }),
    );
    expect(ends(threadsOf(state, 'lowerT')[0])).toEqual({ start: end('open'), end: end('inside') });
    expect(ends(threadsOf(state, 'upperT')[0])).toEqual({ start: end('inside'), end: end('open') });
    // a pocket opens a part of the upper face at the joint: the rim of the lower face is mixed, open
    const notched = run(
      newEngine(),
      batch(addSketch('twoS', XY), circle('twoS', 'twoc', 0, 0, 4)),
      { type: 'addFeature', feature: { id: 'lower', name: 'lower', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'twoS', regions: [{ outerLoop: ['twoc'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
      { type: 'addFeature', feature: { id: 'upper', name: 'upper', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'twoS', regions: [{ outerLoop: ['twoc'] }] }, extent: { type: 'distance', start: 10, distance: 10 }, operation: 'add', targets: ['lower'] } },
      box('notch', 2, -5, 6, 5, 10, 12, 'cut', 'lower'),
      thread('lowerT', { ...m('lower', { feature: 'lower', role: 'side', curve: 'twoc' }), diameter: 8, pitch: 1.25 }),
    );
    expect(statusOf(notched, 'notch')).toBe('ok');
    expect(ends(threadsOf(notched, 'lowerT')[0])).toMatchObject({ start: end('open'), end: { kind: 'open' } });
    // a block under half of the mouth of a through hole: partly a shoulder, a shoulder
    const half = newEngine();
    const covered = run(half, box('plate', 0, 0, 20, 20, 0, 8), hole('h', [['p', 10, 10]], 5, 'plate'), box('under', 10, 0, 20, 20, -4, 0, 'add', 'plate'), thread('t', m('plate', bore('h', 'p'))));
    expect(ends(threadsOf(covered, 't')[0])).toEqual({ start: end('shoulder'), end: end('open') });
  });

  it('rims that are no circle: a hole through a round face, a hole into a leaning face', () => {
    const engine = newEngine();
    // a hole along X through a round bar about Z: both rims rise and fall, nothing beyond their extreme points
    const round = run(engine, rod('bar', 0, 0, 10, -10, 10), plane('outside', 'YZ', -20), hole('across', [['p', 0, 0]], 5, 'bar', 'forward', { kind: 'plane', feature: 'outside' }), thread('t', m('bar', bore('across', 'p'))));
    expect(statusOf(round, 't')).toBe('ok');
    const [t] = threadsOf(round, 't');
    expect(t.ends).toEqual({ start: 'open', end: 'open' });
    expect(t.runOut.start).toBeLessThan(0.02);
    expect(t.runOut.end).toBeLessThan(0.02);
    // a leaning top z = 10 + x / 2: the plane rises within the band of M6 beyond the highest point of the rim by 0.5 / 2
    const leaning = newEngine();
    const lean = run(leaning, prism('wedge', { kind: 'base', plane: 'XZ' }, [[-10, 0], [10, 0], [10, 15], [-10, 5]], -10, 20), hole('h', [['p', 0, 0]], 5, 'wedge'), thread('t', m('wedge', bore('h', 'p'))));
    expect(statusOf(lean, 't')).toBe('ok');
    const [w] = threadsOf(lean, 't');
    expect(ends(w)).toEqual({ start: end('open'), end: end('open', near(0.25, 2)) });
    expect(w.to).toBeCloseTo(10 + 2.5 / 2, 4);
  });

  it('the ends read alike on a copy of the body turned about two axes and moved far from the origin', () => {
    const engine = newEngine();
    const angle = (a: number) => ({ type: 'circular', axis: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'angle', angle: a } });
    const state = run(
      engine,
      box('block', 0, 0, 20, 20, 0, 10),
      hole('sunk', [['b', 14, 10]], 5, 'block', 'forward', XY, { type: 'countersink', diameter: 5, headDiameter: 10, angle: Math.PI / 2 }),
      blindHole('blind', 5, 5, 5, 10, -6, 'block'),
      bodyPattern('tilt', 'block', angle(0.61)),
      bodyPattern('turn', 'tilt/1', { type: 'circular', axis: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'angle', angle: 1.13 } }),
      bodyPattern('far', 'turn/1', along('X', 2, 2000)),
      thread('here', m6('block', [bore('sunk', 'b'), bore('blind', 'p')], { direction: 'forward' })),
    );
    const tags = [{ pattern: 'tilt', index: 1 }, { pattern: 'turn', index: 1 }, { pattern: 'far', index: 1 }];
    const there = run(engine, thread('there', m6('far/1', [bore('sunk', 'b', tags), bore('blind', 'p', tags)], { direction: 'forward' })));
    expect(statusOf(there, 'there')).toBe('ok');
    const [a, b] = threadsOf(there, 'here');
    const [c, d] = threadsOf(there, 'there');
    for (const [x, y] of [[a, c], [b, d]]) {
      expect(y.ends).toEqual(x.ends);
      expect(y.runOut.start).toBeCloseTo(x.runOut.start, 3);
      expect(y.runOut.end).toBeCloseTo(x.runOut.end, 3);
      expect(y.to - y.from).toBeCloseTo(x.to - x.from, 3);
    }
    expect(b.ends).toEqual({ start: 'shoulder', end: 'open' });
    void state;
  });
});

// The helix of `b` is the helix of `a` carried by `move` when points of the one lie on the other.
function expectSameHelix(a: ThreadResult, b: ThreadResult, move: (p: number[]) => number[] = (p) => p): void {
  for (const theta of [0, 1, 2.5, 4, 5.9]) {
    const off = offHelix(b, move(helixPoint(a, theta)));
    expect(off.along, `θ = ${theta}`).toBeLessThan(1e-6);
    expect(off.across).toBeLessThan(1e-6);
  }
}
const turnZ = (angle: number) => (p: number[]) => [p[0] * Math.cos(angle) - p[1] * Math.sin(angle), p[0] * Math.sin(angle) + p[1] * Math.cos(angle), p[2]];
const shift = (x: number, y = 0, z = 0) => (p: number[]) => [p[0] + x, p[1] + y, p[2] + z];
const Z: AxisRef = { kind: 'base', axis: 'Z' };

describe('the copies of a face and the datum of the helix', () => {
  it('a row of holes: the copies by their tags, the datum carried, the facts', () => {
    const engine = newEngine();
    const state = run(engine, box('plate', 0, 0, 60, 20, 0, 8), hole('taps', [['h', 10, 10]], 5, 'plate'), featurePattern('row', ['taps'], along('X', 3, 15)), thread('m6', m6('plate', [bore('taps', 'h')], { copies: true })));
    expect(statusOf(state, 'm6')).toBe('ok');
    expect(state.evaluation.features.m6.facts).toMatchObject({ threads: 3, copies: 2 });
    const [listed, ...copies] = threadsOf(state, 'm6');
    expect(listed.face).toEqual(bore('taps', 'h'));
    expect(copies.map((t) => t.face)).toEqual([bore('taps', 'h', [{ pattern: 'row', index: 1 }]), bore('taps', 'h', [{ pattern: 'row', index: 2 }])]);
    copies.forEach((t, i) => {
      expect(t.origin).toEqual([near(10 + 15 * (i + 1), 9), near(10, 9), near(8, 5)]);
      expect(t.zero).toEqual(listed.zero);
      expectSameHelix(listed, t, shift(15 * (i + 1)));
    });
    // without `copies` only the listed face; a copy listed by its name alone; no copy: the warning
    const alone = run(engine, { type: 'updateFeature', id: 'm6', patch: { copies: false } });
    expect(threadsOf(alone, 'm6')).toHaveLength(1);
    const copy = run(engine, { type: 'updateFeature', id: 'm6', patch: { faces: [bore('taps', 'h', [{ pattern: 'row', index: 2 }])] } });
    expect(threadsOf(copy, 'm6').map((t) => t.origin[0])).toEqual([near(40, 9)]);
    const none = run(newEngine(), box('plate', 0, 0, 60, 20, 0, 8), hole('taps', [['h', 10, 10]], 5, 'plate'), thread('m6', m6('plate', [bore('taps', 'h')], { copies: true })));
    expect(statusOf(none, 'm6')).toBe('warning:noCopies');
    expect(none.evaluation.features.m6.facts).toMatchObject({ threads: 1, copies: 0 });
    expect(threadsOf(none, 'm6')).toHaveLength(1);
  });

  it('a circle of holes and a mirror of a hole: the helices turn and mirror with their holes, the hand stays as stated', () => {
    const engine = newEngine();
    const state = run(
      engine,
      rod('disc', 0, 0, 30, 0, 6),
      hole('taps', [['h', 20, 0]], 5, 'disc'),
      featurePattern('circle', ['taps'], turnAbout(Z, 5)),
      hole('side', [['s', 0, 12]], 5, 'disc'),
      featurePattern('mirrored', ['side'], mirrorIn('XZ')),
      thread('m6', m6('disc', [bore('taps', 'h')], { copies: true, phase: 0.4 })),
      thread('left', m6('disc', [bore('side', 's')], { copies: true, hand: 'left' })),
    );
    const [listed, ...copies] = threadsOf(state, 'm6');
    expect(copies).toHaveLength(4);
    copies.forEach((t, i) => expectSameHelix(listed, t, turnZ(((i + 1) * 2 * Math.PI) / 5)));
    const [s, mirrored] = threadsOf(state, 'left');
    expect([s.hand, mirrored.hand]).toEqual(['left', 'left']);
    // the mirror carries the datum: the origin and zero mirrored, the axis as it was (a hole along Z)
    expect(mirrored.origin).toEqual([near(0, 9), near(-12, 9), near(6, 5)]);
    expect(mirrored.zero).toEqual([near(s.zero[0], 12), near(-s.zero[1], 12), near(s.zero[2], 12)]);
  });

  it('a copy whose wall starts further along: the same helix from its own origin', () => {
    // a plate stepped from 8 to 12 high, a hole at 10 and its copy at 30 threaded from the top
    const engine = newEngine();
    const state = run(engine, box('plate', 0, 0, 40, 20, 0, 8), box('step', 20, 0, 40, 20, 8, 12, 'add', 'plate'), hole('taps', [['h', 10, 10]], 5, 'plate'), featurePattern('row', ['taps'], along('X', 2, 20)), thread('m', { ...m6('plate', [bore('taps', 'h')], { copies: true }), pitch: 1.5 }));
    const [listed, copy] = threadsOf(state, 'm');
    expect([listed.origin[2], copy.origin[2]]).toEqual([near(8, 5), near(12, 5)]);
    expect(copy.to).toBeCloseTo(12, 5);
    // −4 along the axis −Z is −2.67 turns: zero is turned by a third of a turn against the hand
    expect(dot(copy.zero, listed.zero)).toBeCloseTo(Math.cos((2 * Math.PI * 8) / 3), 6);
    expectSameHelix(listed, copy, shift(20));
  });

  it('phase, an axis near X, and offset and length trim one helix', () => {
    const engine = newEngine();
    const state = run(engine, box('plate', 0, 0, 20, 20, 0, 8), hole('taps', [['h', 10, 10]], 5, 'plate'), thread('m6', m6('plate', [bore('taps', 'h')], { phase: Math.PI / 2 })));
    const [t] = threadsOf(state, 'm6');
    // backward: the axis is −Z; X turned by a quarter about −Z is −Y
    expect(t.zero).toEqual([near(0, 12), near(-1, 12), near(0, 12)]);
    const trimmed = run(engine, { type: 'updateFeature', id: 'm6', patch: { offset: 2, length: 3 } });
    const [u] = threadsOf(trimmed, 'm6');
    expect([u.origin, u.axis, u.zero]).toEqual([t.origin, t.axis, t.zero]);
    expect([u.from, u.to]).toEqual([2, 5]);
    const across = run(newEngine(), box('block', 0, 0, 20, 20, 0, 20), hole('x', [['p', 10, 10]], 5, 'block', 'forward', { kind: 'base', plane: 'YZ' }), thread('t', m6('block', [bore('x', 'p')])));
    const [x] = threadsOf(across, 't');
    expect(Math.abs(x.axis[0])).toBeCloseTo(1, 12);
    expect(x.zero).toEqual([near(0, 12), near(1, 12), near(0, 12)]);
  });

  it('a screw in a nut: the phases of the datum make one curve, either hand', () => {
    for (const hand of ['right', 'left'] as const) {
      const turn = hand === 'left' ? -1 : 1;
      const phi = 0.7;
      const L = 14.3; // the origin of the bolt (its top) above the origin of the nut (its bottom face)
      const engine = newEngine();
      const state = run(
        engine,
        box('nut', -10, -10, 10, 10, 0, 8),
        hole('taps', [['h', 0, 0]], 5, 'nut'),
        thread('inNut', m6('nut', [bore('taps', 'h')], { direction: 'forward', hand, phase: phi })),
        rod('bolt', 0, 0, 3, -3, L),
        thread('onBolt', m6('bolt', [rodSide('bolt')], { direction: 'backward', hand, phase: -phi - (turn * 2 * Math.PI * L) / 1 })),
      );
      expectSameHelix(threadsOf(state, 'inNut')[0], threadsOf(state, 'onBolt')[0]);
      // a second nut 11.4 above the first, threaded the same way: the phase of the rule for a gap
      const g = 11.4;
      const second = run(engine, box('nut2', -10, -10, 10, 10, g, g + 2), hole('taps2', [['h2', 0, 0]], 5, 'nut2'), thread('inNut2', m6('nut2', [bore('taps2', 'h2')], { direction: 'forward', hand, phase: phi + (turn * 2 * Math.PI * g) / 1 })));
      expectSameHelix(threadsOf(second, 'inNut')[0], threadsOf(second, 'inNut2')[0]);
    }
  });

  it('a pattern of a body carries its threads; a mirrored copy of the body is the other hand and the pattern warns', () => {
    const engine = newEngine();
    const state = run(engine, rod('pin', 0, 30, 3, 0, 20), thread('pt', m6('pin', [rodSide('pin')], { phase: 0.3 })), bodyPattern('screws', 'pin', turnAbout(Z, 3)), bodyPattern('mir', 'pin', mirrorIn('XZ')));
    expect(statusOf(state, 'screws')).toBe('ok');
    const [pin, first, second, mirrored] = threadsOf(state, 'pt');
    expect([pin.bodies, first.bodies, second.bodies, mirrored.bodies]).toEqual([['pin'], ['screws/1'], ['screws/2'], ['mir/1']]);
    expectSameHelix(pin, first, turnZ((2 * Math.PI) / 3));
    expectSameHelix(pin, second, turnZ((4 * Math.PI) / 3));
    expect(mirrored.hand).toBe('left');
    expectSameHelix(pin, mirrored, (p) => [p[0], -p[1], p[2]]);
    expect(statusOf(state, 'mir')).toBe('warning:mirroredThread');
    expect(state.evaluation.features.mir.warnings[0].refs).toEqual(['mir/1']);
    // a mirror of the mirrored copy gives the stated hand back and has no warning; neither has a
    // mirror of a body without a thread, nor a mirror of features
    const twice = run(engine, bodyPattern('back', 'mir/1', mirrorIn('YZ')), rod('plain', 50, 0, 3, 0, 5), bodyPattern('plainMir', 'plain', mirrorIn('XZ')));
    expect([statusOf(twice, 'back'), statusOf(twice, 'plainMir')]).toEqual(['ok', 'ok']);
    expect(threadsOf(twice, 'pt').find((t) => t.bodies[0] === 'back/1')?.hand).toBe('right');
    const left = run(newEngine(), rod('pin', 0, 30, 3, 0, 20), thread('pt', m6('pin', [rodSide('pin')], { hand: 'left' })), bodyPattern('mir', 'pin', mirrorIn('XZ')));
    expect(left.evaluation.features.mir.warnings[0].message).toMatch(/\(1 thread became right-hand on the mirrored copy;/);
    // a mirror of features keeps the stated hand on the copies: no warning
    const features = run(newEngine(), box('plate', -10, -20, 10, 20, 0, 8), hole('taps', [['h', 0, 10]], 5, 'plate'), thread('m6', m6('plate', [bore('taps', 'h')])), featurePattern('m', ['taps'], mirrorIn('XZ')));
    expect(statusOf(features, 'm')).toBe('ok');
    // a thread feature after the mirror, on the faces of the copy, keeps the stated hand
    const after = run(newEngine(), rod('pin', 0, 30, 3, 0, 20), bodyPattern('mir', 'pin', mirrorIn('XZ')), thread('pt', m6('mir/1', [{ ...rodSide('pin'), copy: [{ pattern: 'mir', index: 1 }] }])));
    expect(statusOf(after, 'mir')).toBe('ok');
    expect(threadsOf(after, 'pt')[0].hand).toBe('right');
  });

  it('an insertion carries the threads of the inserted document; the tags of its patterns are not followed', () => {
    const shop = newEngine();
    const made = run(shop, box('plate', 0, 0, 60, 20, 0, 8), hole('taps', [['h', 10, 10]], 5, 'plate'), featurePattern('row', ['taps'], along('X', 3, 15)), hole('one', [['o', 50, 15]], 5, 'plate'), thread('m6', m6('plate', [bore('one', 'o')], { phase: 0.5 })));
    const part = JSON.parse(shop.save()) as Document;
    const inner = threadsOf(made, 'm6')[0];
    const engine = newEngine();
    const state = run(engine, { type: 'addDocument', id: 'p', document: part }, { type: 'addFeature', feature: { id: 'ins', name: 'ins', suppressed: false, type: 'insert', document: 'p', placement: { frame: XY, x: 100 } } as never }, thread('outer', m6('ins/plate', [bore('ins/taps', 'h')], { copies: true })));
    const [carried] = threadsOf(state, 'ins/m6');
    expect(carried).toMatchObject({ face: bore('ins/one', 'o'), bodies: ['ins/plate'] });
    expectSameHelix(inner, carried, shift(100));
    expect(statusOf(state, 'outer')).toBe('warning:noCopies');
    // a copy inside the insertion is listed by its name
    const listed = run(engine, { type: 'updateFeature', id: 'outer', patch: { copies: false, faces: [bore('ins/taps', 'h'), bore('ins/taps', 'h', [{ pattern: 'ins/row', index: 1 }])] } });
    expect(statusOf(listed, 'outer')).toBe('ok');
    expect(threadsOf(listed, 'outer').map((t) => t.origin[0])).toEqual([near(110, 9), near(125, 9)]);
  });
});

describe('the record through later features', () => {
  it('a pocket shortens the wall, a union moves the record to the target, a split puts it on both bodies; the span stays', () => {
    const engine = newEngine();
    run(engine, box('plate', 0, 0, 30, 20, 0, 8), hole('taps', [['h', 10, 10]], 5, 'plate'), thread('m6', m6('plate', [bore('taps', 'h')])), rod('pin', 25, 10, 3, 0, 20), thread('pt', m6('pin', [rodSide('pin')])));
    const records = (state: EngineState) => state.evaluation.threads.map((t) => [t.feature, t.bodies, t.from, t.to, t.walls.map((w) => [Number(w.from.toFixed(4)), Number(w.to.toFixed(4))])]);
    expect(records(run(engine, box('pocket', 5, 5, 15, 15, 5, 9, 'cut', 'plate')))).toEqual([['m6', ['plate'], 0, 8, [[3, 8]]], ['pt', ['pin'], 0, 20, [[0, 20]]]]);
    expect(records(run(engine, combine('u', 'union', 'plate', ['pin'])))).toEqual([['m6', ['plate'], 0, 8, [[3, 8]]], ['pt', ['plate'], 0, 20, [[0, 12]]]]);
    const state = run(engine, plane('mid', 'XY', 4), split('cut', 'plate', { kind: 'plane', feature: 'mid' }));
    expect(records(state)).toEqual([['m6', ['plate', 'cut'], 0, 8, [[4, 8], [3, 4]]], ['pt', ['cut'], 0, 20, [[0, 12]]]]);
    // a thread whose face is gone records nothing
    const gone = run(engine, box('away', 5, 5, 15, 15, -1, 9, 'cut', 'plate'), box('awayToo', 5, 5, 15, 15, -1, 9, 'cut', 'cut'));
    expect(records(gone)).toEqual([['pt', ['cut'], 0, 20, [[0, 12]]]]);
  });

  it('a difference keeps the threads of the target; the tools take theirs along when kept, lose them when used up', () => {
    const build = (keepTools: boolean) =>
      run(newEngine(), box('plate', 0, 0, 30, 20, 0, 8), hole('taps', [['h', 10, 10]], 5, 'plate'), thread('m6', m6('plate', [bore('taps', 'h')])), rod('pin', 25, 10, 3, 0, 20), thread('pt', m6('pin', [rodSide('pin')])), combine('d', 'difference', 'plate', ['pin'], keepTools));
    const kept = build(true);
    expect(kept.evaluation.threads.map((t) => [t.feature, t.bodies, t.internal])).toEqual([['m6', ['plate'], true], ['pt', ['pin'], false]]);
    // the hole the pin left in the plate is the side of the pin used as a bore: not the pin's thread
    const used = build(false);
    expect(used.evaluation.threads.map((t) => [t.feature, t.bodies])).toEqual([['m6', ['plate']]]);
  });

  it('an intersection keeps the pin of the target a pin; the bore of a tool intersected keeps its side', () => {
    const state = run(newEngine(), rod('pin', 0, 0, 3, 0, 20), thread('pt', m6('pin', [rodSide('pin')])), box('cage', -5, -5, 5, 5, 5, 15), combine('i', 'intersection', 'pin', ['cage']));
    expect(state.evaluation.threads.map((t) => [t.feature, t.bodies, t.internal, t.walls.map((w) => Number(w.from.toFixed(4)))])).toEqual([['pt', ['pin'], false, [5]]]);
    const bored = run(newEngine(), box('plate', -10, -10, 10, 10, 0, 8), hole('taps', [['h', 0, 0]], 5, 'plate'), thread('m6', m6('plate', [bore('taps', 'h')])), box('cage', -5, -5, 5, 5, -1, 9), combine('i', 'intersection', 'cage', ['plate']));
    expect(bored.evaluation.threads.map((t) => [t.feature, t.bodies, t.internal])).toEqual([['m6', ['cage'], true]]);
  });
});

describe('the parts list', () => {
  it('a threaded bore is no unlabelled hole', () => {
    const engine = newEngine();
    run(engine, box('plate', 0, 0, 40, 20, 0, 8), hole('taps', [['h', 10, 10], ['k', 30, 10]], 5, 'plate'), hole('free', [['f', 20, 15]], 3, 'plate'));
    const unlabelled = () => {
      const outcome = engine.query('partsList', {});
      if (!outcome.ok) throw new Error(outcome.error.message);
      return outcome.result.unlabelled;
    };
    expect(unlabelled()).toEqual([{ feature: 'taps', count: 2 }, { feature: 'free', count: 1 }]);
    run(engine, thread('m6', m6('plate', [bore('taps', 'h')])));
    expect(unlabelled()).toEqual([{ feature: 'taps', count: 1 }, { feature: 'free', count: 1 }]);
    run(engine, { type: 'updateFeature', id: 'm6', patch: { faces: [bore('taps', 'h'), bore('taps', 'k')] } });
    expect(unlabelled()).toEqual([{ feature: 'free', count: 1 }]);
  });
});

describe('a takeover of a projected circle', () => {
  // the rename patch of a sketch cut (D69): the wall of a thread is renamed with its curve
  it('renames the face in the list of a thread in the same batch; the thread stays ok', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('src', XY),
      { type: 'addPoint', sketch: 'src', id: 'hc', x: 0, y: 0 },
      { type: 'addCurve', sketch: 'src', id: 'h', curve: { type: 'circle', center: 'hc' }, radius: 3 },
      constrain('src', 'fhc', { type: 'fixed', point: 'hc', x: 0, y: 0 }),
      dimension('src', 'rh', { type: 'radius', curve: 'h' }, 3),
      addSketch('dst', XY),
      { type: 'addExternal', sketch: 'dst', id: 'x', ref: { type: 'sketch', sketch: 'src', entity: 'h', kind: 'circle', regions: true } } as Command,
      { type: 'addFeature', feature: { id: 'ex', name: 'ex', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'dst', regions: [{ outerLoop: ['x'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
      thread('t', m6('ex', [{ feature: 'ex', role: 'side', curve: 'x' }])),
    );
    expect(statusOf(engine.getState(), 't')).toBe('ok');
    const state = engine.getState();
    const sketch = state.document.features.find((f) => f.id === 'dst') as SketchFeature;
    const made = sketchTool('projectSketch', { sketch, result: state.evaluation.features.dst.sketch, parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features }, { sketch: 'src', entities: ['h'], as: 'own' } as never, freshIds(state.document, 'o'));
    if (!made.ok) throw new Error(made.message);
    const after = run(engine, batch(...made.commands));
    const own = made.ids.curves[0];
    expect(made.ids.patched).toContain('t');
    expect((after.document.features.find((f) => f.id === 't') as ThreadFeature).faces).toEqual([{ feature: 'ex', role: 'side', curve: own }]);
    expect(statusOf(after, 't')).toBe('ok');
    expect(threadsOf(after, 't')).toHaveLength(1);
  });
});

// The review of stage 1 (D76).
describe('the review of stage 1', () => {
  // finding 2 (P1): the record of a threaded rod cut out of a block blocked a thread on the bore
  it('a bore made by cutting a threaded rod out of a block takes a thread', () => {
    const state = run(
      newEngine(),
      rod('r', 0, 0, 2.5, -1, 11),
      thread('m5', { body: 'r', faces: [rodSide('r')], modelled: false, diameter: 5, pitch: 0.8, hand: 'right', direction: 'forward' }),
      box('block', -10, -10, 10, 10, 0, 10),
      combine('cut', 'difference', 'block', ['r']),
      thread('m6in', { body: 'block', faces: [rodSide('r')], modelled: false, diameter: 6, pitch: 1, hand: 'right', direction: 'forward' }),
    );
    expect(statusOf(state, 'm6in')).toBe('ok');
    expect(state.evaluation.threads.map((t) => [t.feature, t.bodies, t.internal])).toEqual([['m6in', ['block'], true]]);
    // the earlier thread of the same body and sense is still found
    const again = run(newEngine(), box('plate', 0, 0, 20, 20, 0, 8), hole('h', [['p', 10, 10]], 5, 'plate'), thread('a', m6('plate', [bore('h', 'p')])), thread('b', m6('plate', [bore('h', 'p')])));
    expect(statusOf(again, 'b')).toBe('error:invalidThread');
  });

  // finding 1: a pattern of a body copies only the threads made on it
  it('a pattern of the untapped one of two plates a hole goes through copies no thread', () => {
    const engine = newEngine();
    const state = run(
      engine,
      box('A', -10, -10, 10, 10, 0, 8),
      box('B', -10, -10, 10, 10, 8, 16),
      batch(addSketch('tapsS', XY), { type: 'addPoint', sketch: 'tapsS', id: 'h', x: 0, y: 0 }, constrain('tapsS', 'hf', { type: 'fixed', point: 'h', x: 0, y: 0 }), { type: 'addFeature', feature: { id: 'taps', name: 'taps', suppressed: false, type: 'hole', sketch: 'tapsS', points: ['h'], shape: { type: 'plain', diameter: 5 }, extent: { type: 'throughAll', side: 'forward' }, targets: ['A', 'B'] } }),
      thread('t', m6('A', [bore('taps', 'h')], { direction: 'forward' })),
      bodyPattern('copyB', 'B', along('X', 2, 40)),
      bodyPattern('copyA', 'A', along('Y', 2, 40)),
    );
    expect(threadsOf(state, 't').map((t) => t.bodies)).toEqual([['A'], ['copyA/1']]);
  });
});

// `seat` of two modelled threads that agree (D76, stage 2) without meshes: for hand-made records
// in both hands, with one to three starts, running the same way and opposite ways, with a record
// that went through a mirror (its phase turns it the other way, the review of stage 2): applying
// either entry, as the phase of its feature turns its `zero`, makes the two one helix. The pairs
// on real meshes are in packages/scenarios/test/thread-mate.test.ts.
import { describe, expect, it } from 'vitest';
import { seatOf } from '../src/query/interference';
import { turned } from '../src/recompute/thread';
import type { ThreadResult, Vec3 } from '../src/types';

const thread = (feature: string, more: Partial<ThreadResult>): ThreadResult => ({
  feature,
  face: { feature: 'f', role: 'side', curve: 'c' },
  bodies: ['b'],
  internal: false,
  modelled: true,
  diameter: 10,
  pitch: 1.5,
  depth: 0.81,
  flankAngle: Math.PI / 3,
  clearance: 0,
  starts: 1,
  hand: 'right',
  radius: 5,
  origin: [0, 0, 20],
  axis: [0, 0, -1],
  zero: [1, 0, 0],
  from: 0,
  to: 14,
  ends: { start: 'open', end: 'inside' },
  runOut: { start: 0, end: 0 },
  walls: [{ from: 0, to: 20 }],
  ...more,
});
// the record after `x` was added to the phase of its feature: `zero` turned by sense · x
const applied = (t: ThreadResult, x: number, sense: 1 | -1): ThreadResult => ({ ...t, zero: turned(t.zero, t.axis, sense * x) });
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

describe('seat', () => {
  const cases: { name: string; hand: 'right' | 'left'; starts: number; opposite: boolean; senses: [1 | -1, 1 | -1] }[] = [];
  for (const hand of ['right', 'left'] as const) for (const starts of [1, 2, 3]) for (const opposite of [false, true]) for (const senses of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as [1 | -1, 1 | -1][]) cases.push({ name: `${hand}, ${starts} start(s), ${opposite ? 'opposite ways' : 'the same way'}, senses ${senses.join(' ')}`, hand, starts, opposite, senses });
  it.each(cases)('$name: either entry makes the two one helix', ({ hand, starts, opposite, senses }) => {
    const first = thread('a', { hand, starts, zero: unit([Math.cos(0.3), Math.sin(0.3), 0]) });
    // the second 4 further along, or from 12 below running up; turned by 0.9 rad against a seat
    const second = thread('b', { hand, starts, internal: true, origin: opposite ? [0, 0, 4] : [0, 0, 16], axis: opposite ? [0, 0, 1] : [0, 0, -1], zero: unit([Math.cos(1.7), Math.sin(1.7), 0]) });
    const sense = new Map<ThreadResult, 1 | -1>([[first, senses[0]], [second, senses[1]]]);
    const seat = seatOf(first, second, undefined, (t) => sense.get(t) ?? 1);
    expect(seat.map((s) => s.feature)).toEqual(['a', 'b']);
    const residue = (a: ThreadResult, b: ThreadResult): number => seatOf(a, b, undefined, () => 1)[1].addToPhase;
    expect(residue(applied(first, seat[0].addToPhase, senses[0]), second)).toBeCloseTo(0, 9);
    expect(residue(first, applied(second, seat[1].addToPhase, senses[1]))).toBeCloseTo(0, 9);
    // the angle is taken to the nearest of the starts
    expect(Math.abs(seat[1].addToPhase)).toBeLessThanOrEqual(Math.PI / starts + 1e-12);
  });

  it('one curve already: both zero; an entry of an inserted document is marked and comes last', () => {
    const first = thread('a', {});
    const seated = thread('b', { internal: true, origin: [0, 0, 16], zero: turned([1, 0, 0], [0, 0, -1], (2 * Math.PI * 4) / 1.5) });
    expect(seatOf(first, seated, undefined, () => 1).map((s) => s.addToPhase)).toEqual([0, 0]);
    const inserted = thread('ins/a', {});
    const seat = seatOf(inserted, thread('b', { internal: true, origin: [0, 0, 16] }), undefined, () => 1);
    expect(seat.map((s) => [s.feature, s.inserted])).toEqual([['b', undefined], ['ins/a', true]]);
  });
});

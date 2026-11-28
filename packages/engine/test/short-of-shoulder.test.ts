// `shortOfShoulder` of two modelled threads that agree (D76, the cause named in the report,
// 2026-11-28) without meshes: the ring a groove leaves under a shoulder, one lift high, and the wall
// of the mate standing in it. A socket with its shoulder at the start and at the end, a pin standing
// on a base against a nut seated on it, the cases with no entry (the wall of the mate ends before
// the ring or within the precision of its edge, the radii do not overlap, the end is open or inside,
// the body no longer has the end), the ring as the tool left it, the run-out of the mate, a record
// on several bodies, a posed pair, a mirrored pair and an entry of an inserted document.
// The pairs on real meshes are in packages/scenarios/test/thread-bowl.test.ts and thread-mate.test.ts.
import { describe, expect, it } from 'vitest';
import { type ThreadOnBody, shortOfShoulderOf } from '../src/query/interference';
import { inverse, transformPoint, transformVector } from '../src/solid';
import type { RigidTransform, ThreadResult } from '../src/types';

const LIFT = 0.05;
const TOLERANCE = 0.01; // the chord tolerance, across the axis
const PRECISION = 2e-5; // the precision of the coordinates, along it
const TOL = { across: TOLERANCE, along: PRECISION };
const face = (feature: string) => ({ feature, role: 'side', curve: 'c' }) as const;
const thread = (feature: string, more: Partial<ThreadResult>): ThreadResult => ({
  feature,
  face: face(feature),
  bodies: ['b'],
  internal: false,
  modelled: true,
  diameter: 80,
  pitch: 3,
  depth: 0.9375,
  flankAngle: Math.PI / 2,
  clearance: 0,
  starts: 2,
  hand: 'right',
  radius: 40,
  origin: [0, 0, 40],
  axis: [0, 0, -1],
  zero: [1, 0, 0],
  from: 0,
  to: 12,
  ends: { start: 'open', end: 'inside' },
  runOut: { start: 0, end: 0 },
  walls: [{ from: 0, to: 40 }],
  ...more,
});
const on = (t: ThreadResult, lift = LIFT): ThreadOnBody => ({ thread: t, body: t.bodies[0], lift });
const ring = (t: ThreadResult, mate: ThreadResult, end: 'start' | 'end') => ({ feature: t.feature, face: t.face, end, height: LIFT, mate: { feature: mate.feature, face: mate.face } });

// A bowl 80 across threaded from its rim (z = 40) down, and a lid whose socket, 10 deep, has its
// ceiling (the shoulder) on the rim: its thread runs from the ceiling down.
const bowl = thread('bowlThread', { bodies: ['bowl'] });
const lid = thread('lidThread', { bodies: ['lid'], internal: true, radius: 39.3625, clearance: 0.3, to: 10, ends: { start: 'shoulder', end: 'open' }, walls: [{ from: 0, to: 10 }] });
// An M10 pin 15 high on a base at z = 5, threaded from its top down to the base; a nut 8 high.
const M10 = { diameter: 10, pitch: 1.5, depth: 0.811899, flankAngle: Math.PI / 3, starts: 1 };
const pin = thread('pinThread', { ...M10, bodies: ['base'], radius: 5, origin: [0, 0, 20], to: 15, ends: { start: 'open', end: 'shoulder' }, walls: [{ from: 0, to: 15 }] });
const nutAt = (bottom: number, more: Partial<ThreadResult> = {}): ThreadResult =>
  thread('nutThread', { ...M10, bodies: ['nut'], internal: true, radius: 4.3881, clearance: 0.2, origin: [0, 0, bottom + 8], to: 8, ends: { start: 'open', end: 'open' }, walls: [{ from: 0, to: 8 }], ...more });

describe('shortOfShoulder', () => {
  it('a socket whose shoulder is its start: the wall of the mate stands in the ring under it; either order', () => {
    expect(shortOfShoulderOf(on(bowl), on(lid), undefined, TOL)).toEqual([ring(lid, bowl, 'start')]);
    expect(shortOfShoulderOf(on(lid), on(bowl), undefined, TOL)).toEqual([ring(lid, bowl, 'start')]);
  });

  it('a socket whose shoulder is its end (threaded from its mouth up to the ceiling)', () => {
    const fromMouth = { ...lid, origin: [0, 0, 30], axis: [0, 0, 1], ends: { start: 'open', end: 'shoulder' } } as ThreadResult;
    expect(shortOfShoulderOf(on(bowl), on(fromMouth), undefined, TOL)).toEqual([ring(fromMouth, bowl, 'end')]);
  });

  it('a pin standing on a base against a nut seated on the base: the wall of the nut stands in the ring of the pin', () => {
    expect(shortOfShoulderOf(on(pin), on(nutAt(5)), undefined, TOL)).toEqual([ring(pin, nutAt(5), 'end')]);
    expect(shortOfShoulderOf(on(nutAt(5)), on(pin), undefined, TOL)).toEqual([ring(pin, nutAt(5), 'end')]);
    // the ring is the lift of the body of the pin high
    expect(shortOfShoulderOf(on(pin, 0.1), on(nutAt(5)), undefined, TOL)[0].height).toBe(0.1);
  });

  it('no entry: the wall of the mate ends before the ring or within the precision of the coordinates of its far edge; the radii do not overlap', () => {
    // lifted off the base by more than the lift, by the lift exactly, and by the lift less the noise of the coordinates
    for (const bottom of [5.2, 5 + LIFT, 5 + LIFT - PRECISION / 2]) expect(shortOfShoulderOf(on(pin), on(nutAt(bottom)), undefined, TOL), String(bottom)).toEqual([]);
    // in the ring by less than the chord tolerance (the review: such a pair collides that deep)
    expect(shortOfShoulderOf(on(pin), on(nutAt(5 + LIFT - TOLERANCE / 2)), undefined, TOL)).toHaveLength(1);
    // a mate whose wall does not reach past the wall of the thread across the axis
    expect(shortOfShoulderOf(on(pin), on(nutAt(5, { radius: 5.2 })), undefined, TOL)).toEqual([]);
    expect(shortOfShoulderOf(on(pin), on(nutAt(5, { radius: 5 - TOLERANCE / 2 })), undefined, TOL)).toEqual([]);
    expect(shortOfShoulderOf(on(lid), on({ ...bowl, radius: 39.2 }), undefined, TOL)).toEqual([]);
  });

  it('no entry: the end is open or inside, or the body no longer has the end of the wall', () => {
    for (const ends of [{ start: 'open', end: 'open' }, { start: 'inside', end: 'open' }, { start: 'open', end: 'inside' }] as const) expect(shortOfShoulderOf(on({ ...lid, ends }), on(bowl), undefined, TOL)).toEqual([]);
    // a later cut took 0.5 of the wall under the shoulder: the stretch starts further than the lift from the span
    expect(shortOfShoulderOf(on({ ...lid, walls: [{ from: 0.5, to: 10 }] }), on(bowl), undefined, TOL)).toEqual([]);
    // the same at the end: threaded from the mouth, the wall cut 0.5 short of the ceiling
    const fromMouth = { ...lid, origin: [0, 0, 30], axis: [0, 0, 1], ends: { start: 'open', end: 'shoulder' } } as ThreadResult;
    expect(shortOfShoulderOf(on({ ...fromMouth, walls: [{ from: 0, to: 9.5 }] }), on(bowl), undefined, TOL)).toEqual([]);
    // a cosmetic thread leaves no ring
    expect(shortOfShoulderOf(on({ ...lid, modelled: false }), on(bowl), undefined, TOL)).toEqual([]);
  });

  it('the ring is the one the tool left: at the start from the origin of the record, at the end from the end of the span; cut to what the body still has', () => {
    // a cut took 0.03 under the ceiling: the ring left is 0.03 to 0.05 from the origin, not 0.03 to 0.08
    const trimmed = { ...lid, walls: [{ from: 0.03, to: 10 }] };
    const bowlAt = (rim: number): ThreadResult => ({ ...bowl, origin: [0, 0, rim] });
    expect(shortOfShoulderOf(on(trimmed), on(bowlAt(40 - 0.06)), undefined, TOL)).toEqual([]);
    expect(shortOfShoulderOf(on(trimmed), on(bowlAt(40 - 0.04)), undefined, TOL)).toEqual([ring(trimmed, bowl, 'start')]);
    // threaded from the mouth up, the wall cut 0.03 under the ceiling: the ring left is 9.95 to 9.97
    const fromMouth = { ...lid, origin: [0, 0, 30], axis: [0, 0, 1], ends: { start: 'open', end: 'shoulder' }, walls: [{ from: 0, to: 9.97 }] } as ThreadResult;
    expect(shortOfShoulderOf(on(fromMouth), on(bowlAt(40 - 0.06)), undefined, TOL)).toEqual([]);
    expect(shortOfShoulderOf(on(fromMouth), on(bowlAt(40 - 0.04)), undefined, TOL)).toEqual([ring(fromMouth, bowl, 'end')]);
  });

  it('the run-out of the mate at an open end it still has counts: a chamfer of the nut shallower than the profile still reaches into the ring', () => {
    // a chamfer of 0.5 on the bottom of the bore before the thread: the wall ends 0.5 above the base, the run-out 0.5
    expect(shortOfShoulderOf(on(pin), on(nutAt(5, { to: 7.5, walls: [{ from: 0, to: 7.5 }], runOut: { start: 0, end: 0.5 } })), undefined, TOL)).toEqual([ring(pin, nutAt(5), 'end')]);
    // a chamfer of 1.0: the run-out of 0.81 ends 0.19 above the base, above the ring
    expect(shortOfShoulderOf(on(pin), on(nutAt(5, { to: 7, walls: [{ from: 0, to: 7 }], runOut: { start: 0, end: 0.81 } })), undefined, TOL)).toEqual([]);
    // the run-out of an end the body no longer has does not count
    expect(shortOfShoulderOf(on(pin), on(nutAt(5, { to: 8, walls: [{ from: 0, to: 7.5 }], runOut: { start: 0, end: 0.5 } })), undefined, TOL)).toEqual([]);
  });

  it('a record on several bodies: the stretch of the body of the pair, also when it is not the first', () => {
    // the socket on two bodies: on the first its wall was cut away under the ceiling, on the lid it is whole
    const shared = { ...lid, bodies: ['other', 'lid'], walls: [{ from: 3, to: 10 }, { from: 0, to: 10 }] };
    expect(shortOfShoulderOf({ thread: shared, body: 'lid', lift: LIFT }, on(bowl), undefined, TOL)).toEqual([ring(shared, bowl, 'start')]);
    expect(shortOfShoulderOf({ thread: shared, body: 'other', lift: LIFT }, on(bowl), undefined, TOL)).toEqual([]);
    expect(shortOfShoulderOf({ thread: shared, body: 'nowhere', lift: LIFT }, on(bowl), undefined, TOL)).toEqual([]);
  });

  it('in a pose: the second moved into the frame of the first by `relative`, in either order; a pair mirrored as a whole', () => {
    // turned by 90° about X and moved: the bowl as modelled, and where the lid sees it
    const relative: RigidTransform = { matrix: [[1, 0, 0], [0, 0, -1], [0, 1, 0]], translation: [5, 6, 7] };
    const back = inverse(relative);
    const bowlModelled: ThreadResult = { ...bowl, origin: transformPoint(back, bowl.origin), axis: transformVector(back, bowl.axis) };
    expect(shortOfShoulderOf(on(lid), on(bowlModelled), relative, TOL)).toEqual([ring(lid, bowl, 'start')]);
    // the bowl first: the lid moved into the frame of the bowl as modelled
    expect(shortOfShoulderOf(on(bowlModelled), on(lid), back, TOL)).toEqual([ring(lid, bowl, 'start')]);
    // posed so that the bowl stands 0.2 lower: the lid is above the rim, free of the ring
    const lowered: RigidTransform = { ...relative, translation: [5, 6, 6.8] };
    expect(shortOfShoulderOf(on(lid), on(bowlModelled), lowered, TOL)).toEqual([]);
    // both mirrored in the plane z = 0 (the records of a mirrored copy: origin and axis carried, the hand turned)
    const mirrored = (t: ThreadResult): ThreadResult => ({ ...t, origin: [t.origin[0], t.origin[1], -t.origin[2]], axis: [t.axis[0], t.axis[1], -t.axis[2]], hand: 'left' });
    expect(shortOfShoulderOf(on(mirrored(bowl)), on(mirrored(lid)), undefined, TOL)).toEqual([ring(lid, bowl, 'start')]);
  });

  it('a cap nut on a pin standing on a base: both rings, the entry of an inserted document last and marked', () => {
    const capNut = nutAt(5, { ends: { start: 'shoulder', end: 'open' } }); // the ceiling of the cap at z = 13, on the top of a pin cut to 13
    const shortPin: ThreadResult = { ...pin, feature: 'ins/pinThread', origin: [0, 0, 13], to: 8, walls: [{ from: 0, to: 8 }] };
    const entries = shortOfShoulderOf(on(shortPin), on(capNut), undefined, TOL);
    expect(entries).toEqual([ring(capNut, shortPin, 'start'), { ...ring(shortPin, capNut, 'end'), inserted: true }]);
  });
});

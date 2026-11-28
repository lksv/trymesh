// The views of the queries `interference` and `gap` over answers written by hand with pairs the
// kernel refused and its intersection as computed cleared (D50): no model of `app.test.ts` has
// such a pair. The page of the tests is the one of `app.test.ts`.
import type { FaceName, GapReport, InterferenceReport } from '@trymesh/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewPanel } from '../src/queries';
import { gapView } from '../src/queries/gap';
import { interferenceView } from '../src/queries/interference';
import { type Harness, startApp } from './app-kit';

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});

const panelOf = <Q extends 'interference' | 'gap'>(picked?: number): ViewPanel<Q> =>
  ({ state: { document: { settings: { chordTolerance: 0.01 } } }, bodyName: (body: string) => `body ${body}`, faceLabel: (name: FaceName) => `${name.feature}/${name.role}`, number: (value: number, unit: string) => `${value} ${unit}`, picked, pick: () => undefined, ask: () => undefined }) as unknown as ViewPanel<Q>;
const texts = (elements: HTMLElement[]): string[] => elements.map((element) => element.textContent ?? '');

describe('the views of the collisions and of the gap with cleared pairs (D50)', () => {
  it('the collisions: cleared pairs are rows of their own after the fits, a picked one draws its two bodies, and the note counts them', async () => {
    harness = await startApp();
    const result: InterferenceReport = {
      pairs: [],
      fits: [{ a: 'p', b: 'q', volume: 0.4, depth: 0.008 }],
      failed: [{ a: 'r', b: 's', message: 'refused; as computed the two share 6.04 mm³, 0.0394 mm deep, which the kernel could not verify' }],
      cleared: [
        { a: 'forearm', b: 'upper', kind: 'fit', volume: 0.0313, depth: 0.0006 },
        { a: 'plate', b: 'upper', kind: 'nothing', volume: 0.003, depth: 0.00001 },
      ],
      checked: 6,
    };
    expect(texts(interferenceView.answer?.(result, {} as never, panelOf()) ?? [])).toEqual([
      expect.stringMatching(/^Fits: /),
      'body p × body qfit, 0.4 mm³',
      expect.stringMatching(/^Cleared by a mesh the kernel did not verify: /),
      'body forearm × body uppercleared: a fit, 0.031 mm³',
      'body plate × body uppercleared: shares nothing',
      'body r × body s: not verified, neither colliding nor clear (refused; as computed the two share 6.04 mm³, 0.0394 mm deep, which the kernel could not verify)',
    ]);
    expect(interferenceView.note?.(result, panelOf())).toEqual({ text: 'No collisions: 6 pair(s) checked. 1 fit(s) within the chord tolerance. 2 pair(s) cleared by a mesh the kernel did not verify. 1 pair(s) could not be verified.', error: true });
    // the picked row counts through the collisions, the fits and the cleared pairs
    expect(interferenceView.scene?.(result, {} as never, panelOf(2))).toMatchObject({ bodies: [{ body: 'plate' }, { body: 'upper' }] });
    // an answer without cleared pairs is shown as before
    const plain = { ...result, cleared: undefined, failed: [] };
    expect(texts(interferenceView.answer?.(plain, {} as never, panelOf()) ?? []).some((text) => text.includes('cleared'))).toBe(false);
    expect(interferenceView.note?.(plain, panelOf())).toEqual({ text: 'No collisions: 6 pair(s) checked. 1 fit(s) within the chord tolerance.', error: false });
  });

  it('the gap: a pair whose answer went through a cleared pair is marked in its row, and the note counts such pairs', async () => {
    harness = await startApp();
    const result: GapReport = {
      within: 5,
      pairs: [
        { a: 'forearm', b: 'upper', distance: 0, contact: 'fit' },
        { a: 'F', b: 'PIN', distance: 1, between: { a: [0, 0, 0], b: [1, 0, 0], faceA: { feature: 'F', role: 'startCap' }, faceB: { feature: 'PIN', role: 'endCap' } }, accuracy: 0.02 },
        { a: 'A', b: 'B', distance: 2, between: { a: [0, 0, 0], b: [2, 0, 0], faceA: { feature: 'A', role: 'startCap' }, faceB: { feature: 'B', role: 'endCap' } }, accuracy: 0 },
      ],
      close: 3,
      apart: 1,
      failed: [],
      refused: 0,
      checked: 4,
      cleared: [
        { a: 'forearm', b: 'upper' },
        { a: 'F', b: 'PIN' },
      ],
    };
    expect(texts(gapView.answer?.(result, {} as never, panelOf()) ?? [])).toEqual(['body forearm × body upperfit (cleared)', 'body F × body PIN1 mm ± 0.02 mm (cleared)', 'body A × body B2 mm']);
    expect(gapView.note?.(result, panelOf())).toEqual({ text: 'Gaps: 3 pair(s) of bodies within 5 mm of each other. 1 further apart. 2 pair(s) rest on a mesh the kernel did not verify.', error: false });
  });
});

describe('the views of the collisions and of the gap with threads (D76)', () => {
  it('threaded pairs are a group of their own after the cleared ones, a picked one draws its two bodies; a mismatch is said in the row of its collision; the note counts them', async () => {
    harness = await startApp();
    const result: InterferenceReport = {
      pairs: [{ a: 'nut', b: 'stud', volume: 68.9, depth: 0.5, mismatch: 'a left-hand thread in a right-hand one' }],
      fits: [],
      failed: [],
      threaded: [{ a: 'bolt', b: 'plate', volume: 68.93, threads: [{ feature: 'm6', face: { feature: 'taps', role: 'holeBore', point: 'h' }, body: 'plate' }] }],
      checked: 6,
    };
    expect(texts(interferenceView.answer?.(result, {} as never, panelOf()) ?? [])).toEqual([
      'body nut × body stud68.9 mm³; the threads do not agree: a left-hand thread in a right-hand one',
      expect.stringMatching(/^Threaded: /),
      'body bolt × body platethreaded, 68.93 mm³ excused',
    ]);
    expect(interferenceView.note?.(result, panelOf())).toMatchObject({ text: expect.stringMatching(/^Collisions: 1 pair\(s\) of bodies share a volume\. 1 pair\(s\) threaded\./), error: true });
    expect(interferenceView.scene?.(result, {} as never, panelOf(1))).toMatchObject({ bodies: [{ body: 'bolt' }, { body: 'plate' }] });
  });

  it('a collision of two modelled threads that agree says how to seat them, or that they are seated', async () => {
    harness = await startApp();
    const face = { feature: 'stud', role: 'side', curve: 'c' } as const;
    const turned: InterferenceReport = { pairs: [{ a: 'nut', b: 'stud', volume: 17.8, depth: 0.11, seat: [{ feature: 'nt', face, addToPhase: -Math.PI / 2 }, { feature: 'st', face, addToPhase: Math.PI / 2 }] }], fits: [], failed: [], checked: 1 };
    expect(texts(interferenceView.answer?.(turned, {} as never, panelOf()) ?? [])).toEqual(['body nut × body stud17.8 mm³; the threads are turned against each other: add -90° to the phase of nt (or turn the other)']);
    const seated: InterferenceReport = { ...turned, pairs: [{ ...turned.pairs[0], seat: [{ feature: 'nt', face, addToPhase: 0 }, { feature: 'st', face, addToPhase: 0 }] }] };
    expect(texts(interferenceView.answer?.(seated, {} as never, panelOf()) ?? [])).toEqual(['body nut × body stud17.8 mm³; the threads are seated, the collision has another cause']);
    // an entry of an inserted document (it comes last) is named only when no entry of this document is there
    const inserted: InterferenceReport = { ...turned, pairs: [{ ...turned.pairs[0], seat: [{ feature: 'st', face, addToPhase: Math.PI / 2 }, { feature: 'ins/nt', face, addToPhase: -Math.PI / 2, inserted: true }] }] };
    expect(texts(interferenceView.answer?.(inserted, {} as never, panelOf()) ?? [])).toEqual(['body nut × body stud17.8 mm³; the threads are turned against each other: add 90° to the phase of st']);
    const bothInserted: InterferenceReport = { ...turned, pairs: [{ ...turned.pairs[0], seat: [{ feature: 'ins/nt', face, addToPhase: -Math.PI / 2, inserted: true }, { feature: 'ins/st', face, addToPhase: Math.PI / 2, inserted: true }] }] };
    expect(texts(interferenceView.answer?.(bothInserted, {} as never, panelOf()) ?? [])).toEqual(['body nut × body stud17.8 mm³; the threads are turned against each other: add -90° to the phase of ins/nt (in its inserted document)']);
  });

  it('a collision by the ring a groove leaves under a shoulder names it, instead of another cause and beside a turn', async () => {
    harness = await startApp();
    const lidFace = { feature: 'socket', role: 'side', curve: 'c' } as const;
    const bowlFace = { feature: 'bowl', role: 'side', curve: 'c' } as const;
    const ring = { feature: 'lidThread', face: lidFace, end: 'start', height: 0.05, mate: { feature: 'bowlThread', face: bowlFace } } as const;
    const seated: InterferenceReport = { pairs: [{ a: 'bowl', b: 'lid', volume: 2.68, depth: 0.05, seat: [{ feature: 'bowlThread', face: bowlFace, addToPhase: 0 }, { feature: 'lidThread', face: lidFace, addToPhase: 0 }], shortOfShoulder: [ring] }], fits: [], failed: [], checked: 1 };
    const named = 'the groove of lidThread stops 0.05 mm short of its shoulder, where bowlThread still stands: chamfer the end of the mate before its thread, or let the mate stop more than that short of the shoulder (a deeper socket, a mate seated higher)';
    expect(texts(interferenceView.answer?.(seated, {} as never, panelOf()) ?? [])).toEqual([`body bowl × body lid2.68 mm³; ${named}`]);
    // deeper than the ring by more than the chord tolerance (0.01): the ring is not all of it
    const pushed: InterferenceReport = { ...seated, pairs: [{ ...seated.pairs[0], volume: 185.6, depth: 1.173 }] };
    expect(texts(interferenceView.answer?.(pushed, {} as never, panelOf()) ?? [])).toEqual([`body bowl × body lid185.6 mm³; ${named}; the pair collides 1.173 mm deep, deeper than that: the collision has another cause as well`]);
    const withinTolerance: InterferenceReport = { ...seated, pairs: [{ ...seated.pairs[0], depth: 0.055 }] };
    expect(texts(interferenceView.answer?.(withinTolerance, {} as never, panelOf()) ?? [])).toEqual([`body bowl × body lid2.68 mm³; ${named}`]);
    const turned: InterferenceReport = { ...seated, pairs: [{ ...seated.pairs[0], seat: [{ feature: 'bowlThread', face: bowlFace, addToPhase: Math.PI / 2 }, { feature: 'lidThread', face: lidFace, addToPhase: Math.PI / 2 }] }] };
    expect(texts(interferenceView.answer?.(turned, {} as never, panelOf()) ?? [])).toEqual([`body bowl × body lid2.68 mm³; the threads are turned against each other: add 90° to the phase of bowlThread (or turn the other); ${named}`]);
    const inserted: InterferenceReport = { ...seated, pairs: [{ ...seated.pairs[0], shortOfShoulder: [{ ...ring, feature: 'ins/lidThread', inserted: true }] }] };
    expect(texts(interferenceView.answer?.(inserted, {} as never, panelOf()) ?? [])[0]).toContain('the groove of ins/lidThread (in its inserted document) stops 0.05 mm short');
  });
});

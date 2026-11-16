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
  ({ bodyName: (body: string) => `body ${body}`, faceLabel: (name: FaceName) => `${name.feature}/${name.role}`, number: (value: number, unit: string) => `${value} ${unit}`, picked, pick: () => undefined, ask: () => undefined }) as unknown as ViewPanel<Q>;
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
      'body r × body s: could not be computed (refused; as computed the two share 6.04 mm³, 0.0394 mm deep, which the kernel could not verify)',
    ]);
    expect(interferenceView.note?.(result, panelOf())).toEqual({ text: 'No collisions: 6 pair(s) checked. 1 fit(s) within the chord tolerance. 2 pair(s) cleared by a mesh the kernel did not verify. 1 pair(s) could not be computed.', error: true });
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

// The view of the query `partsList` (D57) over answers written by hand: the threads of each body
// of a row (D76), which the model of `app.test.ts` has none of. The page of the tests is the one of
// `app.test.ts`. And the buttons Export STL, which say the bodies with cosmetic threads.
import type { Command, PartRow, PartsList } from '@trymesh/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewPanel } from '../src/queries';
import { partsListView } from '../src/queries/parts-list';
import { type Harness, startApp } from './app-kit';

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});

const panel = { bodyName: (body: string) => `body ${body}`, number: (value: number, unit: string) => `${value} ${unit}`, picked: undefined, pick: () => undefined } as unknown as ViewPanel<'partsList'>;
const row = (parts: Partial<PartRow>): PartRow => ({ name: 'plate', count: 1, bodies: ['plate'], volume: 1000, mass: 1.2, massFrom: 'density', totalMass: 1.2, ...parts });
const sum = { count: 0, mass: 0, withoutMass: 0 };

describe('the view of the query partsList', () => {
  it('a row says the threads of each of its bodies; a row without threads says none', async () => {
    harness = await startApp();
    const result: PartsList = {
      printed: [
        row({ count: 2, bodies: ['plate', 'plates/1'], totalMass: 2.4, threads: [{ label: 'M6', internal: true, modelled: false, count: 6 }, { label: '10 x 1.5', internal: false, modelled: false, count: 1 }] }),
        row({ name: 'pin', bodies: ['pin'], copyOf: 'plate', differs: true }),
      ],
      bought: [],
      hardware: [],
      totals: { printed: { ...sum, count: 3, mass: 3.6 }, bought: sum, hardware: { count: 0 } },
    };
    const details = (partsListView.answer?.(result, {}, panel) ?? []).flatMap((element) => Array.from(element.querySelectorAll('small')).map((small) => small.textContent));
    expect(details).toEqual(['1.2 g each, 2.4 g · threads of each: 6 × M6 internal, cosmetic; 1 × 10 x 1.5 external, cosmetic', '1.2 g · differs from body plate']);
  });
});

describe('the buttons Export STL (D76)', () => {
  it('say in the status bar the bodies with cosmetic threads, which the mesh does not carry; a body without one is exported without a word', async () => {
    harness = await startApp();
    const disc = (id: string, start: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start, distance: 10 }, operation: 'new' } });
    const done = harness.engine.execute({
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: { id: 's', name: 's', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
        { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 },
        disc('low', 0),
        disc('high', 20),
        { type: 'addFeature', feature: { id: 'm10', name: 'm10', suppressed: false, type: 'thread', body: 'low', faces: [{ feature: 'low', role: 'side', curve: 'k' }], modelled: false, diameter: 10, pitch: 1.5, hand: 'right', direction: 'backward', label: 'M10' } },
      ],
    } as Command);
    expect(done.ok).toBe(true);
    const status = (): string => harness?.document.getElementById('status')?.textContent ?? '';
    harness.press('toolbar', 'Export STL');
    expect(harness.downloads.at(-1)).toBe('model.stl');
    expect(status()).toBe('Exported model.stl. body "low": 1 cosmetic thread (M10), not in the mesh: tap or cut it after printing.');
    // the button of a body in the model panel, under the feature that made it
    harness.row('high').click();
    harness.press('panel', 'Export STL');
    expect(harness.downloads.at(-1)).toBe('high.stl');
    expect(status()).toBe('Exported model.stl. body "low": 1 cosmetic thread (M10), not in the mesh: tap or cut it after printing.'); // nothing said
    harness.row('low').click();
    harness.press('panel', 'Export STL');
    expect(harness.downloads.at(-1)).toBe('low.stl');
    expect(status()).toBe('Exported low.stl. body "low": 1 cosmetic thread (M10), not in the mesh: tap or cut it after printing.');
  });
});

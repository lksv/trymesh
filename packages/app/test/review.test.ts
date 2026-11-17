// Regressions from reviews of the app that no driven form of `app.test.ts` reaches.
import { afterEach, describe, expect, it } from 'vitest';
import { FIRST_DIRECTION, SECOND_DIRECTION, axisRows } from '../src/axis-picker';
import type { PanelHost } from '../src/host';
import { emptyDocument, emptySketch } from '@trymesh/engine';
import { type Harness, startApp } from './app-kit';

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('the grid: the review of D53', () => {
  // the hint that there is no sketch was shown by both pickers of a grid
  it('a picker with an empty hint shows none; with a hint it shows it', async () => {
    harness = await startApp();
    const host = {} as PanelHost; // a base axis reads nothing of the host
    const X = { kind: 'base', axis: 'X' } as const;
    const hints = (rows: HTMLElement[]): string[] => rows.filter((row) => row.className === 'hint').map((row) => row.textContent ?? '');
    expect(hints(axisRows(host, X, [], () => undefined, 'Needs a sketch.', FIRST_DIRECTION))).toEqual(['Needs a sketch.']);
    expect(hints(axisRows(host, X, [], () => undefined, '', SECOND_DIRECTION))).toEqual([]);
  });
});

describe('the inserted document: the review of D62', () => {
  // a disc of the height `H` and a pin, as a document file holds it
  const part = {
    ...emptyDocument(),
    parameters: [{ name: 'H', expr: '5' }],
    features: [
      { ...emptySketch('s', 'Disc', { kind: 'base', plane: 'XY' }), curves: { c: { type: 'circle', center: 'origin' } }, radii: { c: 5 } },
      { id: 'disc', name: 'Disc', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new', expressions: { 'extent/distance': 'H' } },
      { id: 'pin', name: 'Pin', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 20, distance: 2 }, operation: 'new' },
    ],
  };
  const start = async (): Promise<Harness> => {
    const h = (harness = await startApp());
    const done = h.engine.execute({
      type: 'batch',
      commands: [
        { type: 'addDocument', id: 'a', document: part as never },
        { type: 'addDocument', id: 'b', document: part as never },
        { type: 'addFeature', feature: { id: 'i1', name: 'Part 1', suppressed: false, type: 'insert', document: 'a', placement: { frame: { kind: 'base', plane: 'XY' } }, parameters: { H: 8 }, bodies: ['disc'] } },
      ],
    });
    expect(done.ok).toBe(true);
    h.row('Part 1').dispatchEvent(new (h.document.defaultView as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent('dblclick'));
    return h;
  };

  // an edit that chose another stored document kept the values (merged key by key) and the list
  it('another stored document in the edit removes the values the feature had and its list of bodies', async () => {
    const h = await start();
    h.choose('Stored document', 'b');
    h.timers();
    h.press('panel', 'OK');
    expect(h.engine.getState().document.features[0]).toEqual({ id: 'i1', name: 'Part 1', suppressed: false, type: 'insert', document: 'b', placement: { frame: { kind: 'base', plane: 'XY' } } });
    expect(h.engine.getState().evaluation.features.i1.bodies).toEqual(['i1/disc', 'i1/pin']);
  });

  // the boxes of the bodies were kept by the place of the ID, not by the stored entry
  it('a revision of the stored document while the form is open lists its bodies again', async () => {
    const h = await start();
    const boxes = (): string[] => Array.from(h.document.querySelectorAll<HTMLElement>('#panel label.check')).map((label) => label.textContent ?? '');
    expect(boxes()).toEqual(['disc', 'pin']);
    const third = { ...part, features: [...part.features, { ...part.features[2], id: 'cap', name: 'Cap', extent: { type: 'distance', start: 30, distance: 2 } }] };
    expect(h.engine.execute({ type: 'replaceDocument', id: 'a', document: third as never }).ok).toBe(true);
    expect(h.document.querySelector('#panel h2')?.textContent).toBe('Edit: Part 1');
    expect(boxes()).toEqual(['disc', 'pin', 'cap']);
  });

  // a value of a parameter the stored document no longer has could not be emptied in the form
  it('a value the stored document does not have has its field and can be emptied', async () => {
    const h = await start();
    expect(h.engine.execute({ type: 'replaceDocument', id: 'a', document: { ...part, parameters: [], features: part.features.map((f) => (f.id === 'disc' ? { ...f, expressions: undefined } : f)) } as never }).ok).toBe(true);
    h.row('Part 1').dispatchEvent(new (h.document.defaultView as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent('dblclick'));
    h.type(h.field('H (not in the stored document)'), '');
    h.timers();
    h.press('panel', 'OK');
    expect(h.engine.getState().document.features[0]).not.toHaveProperty('parameters');
  });
});

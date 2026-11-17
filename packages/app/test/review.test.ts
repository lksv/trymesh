// Regressions from reviews of the app that no driven form of `app.test.ts` reaches.
import { afterEach, describe, expect, it } from 'vitest';
import { FIRST_DIRECTION, SECOND_DIRECTION, axisRows } from '../src/axis-picker';
import type { PanelHost } from '../src/host';
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
